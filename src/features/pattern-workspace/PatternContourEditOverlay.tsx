/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type {
  PatternArtifactBundle,
  PatternPieceRenderModel,
  RenderCurveSegment,
  RenderPoint2D
} from './contracts/pattern-render-artifact';
import {
  closestPointOnCubicBezier,
  closestPointOnLineSegment
} from './entity-hit-test';
import {
  ContourEditSelection,
  getEditableSewVerticesForPiece,
  PatternGeometryProposalState,
  PendingApproximateOperationPreview,
  ProposalIntegrityReport,
  SnapConstraintResult
} from './geometry-edit-proposal';

export interface ActiveContourDragPreview {
  readonly pieceId: string;
  readonly dragKind: 'vertex' | 'handle';
  readonly vertexRef?: string;
  readonly segmentId?: string;
  readonly handleSlot?: 'p1' | 'p2';
  readonly originLocalCm: RenderPoint2D;
  readonly currentLocalCm: RenderPoint2D;
  readonly snapResult: SnapConstraintResult;
  readonly previewSewSegments: readonly RenderCurveSegment[];
}

export interface ContourEditHoverTarget {
  readonly pieceId: string;
  readonly kind: 'vertex' | 'handle' | 'segment';
  readonly vertexRef?: string;
  readonly segmentId?: string;
  readonly handleSlot?: 'p1' | 'p2';
  readonly localPointCm: RenderPoint2D;
  readonly parameterT?: number;
}

export interface PatternContourEditOverlayProps {
  readonly artifact: PatternArtifactBundle;
  readonly visiblePieces: readonly PatternPieceRenderModel[];
  readonly getEffectiveOffset: (pieceId: string) => { offsetXCm: number; offsetYCm: number };
  readonly proposalState: PatternGeometryProposalState | null;
  readonly proposalIntegrity: ProposalIntegrityReport | null;
  readonly isEditContourMode: boolean;
  readonly compareOriginalGeometry: boolean;
  readonly selection: ContourEditSelection | null;
  readonly hoverTarget: ContourEditHoverTarget | null;
  readonly dragPreview: ActiveContourDragPreview | null;
  readonly pendingApproximatePreview: PendingApproximateOperationPreview | null;
  readonly invScale: number;
  readonly isYUp: boolean;
}

function segmentToBoardPathD(
  seg: RenderCurveSegment,
  offsetXCm: number,
  offsetYCm: number
): string {
  const x0 = seg.p0.x + offsetXCm;
  const y0 = seg.p0.y + offsetYCm;
  const x3 = seg.p3.x + offsetXCm;
  const y3 = seg.p3.y + offsetYCm;
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    return `M ${x0} ${y0} C ${seg.p1.x + offsetXCm} ${seg.p1.y + offsetYCm}, ${seg.p2.x + offsetXCm} ${seg.p2.y + offsetYCm}, ${x3} ${y3}`;
  }
  return `M ${x0} ${y0} L ${x3} ${y3}`;
}

function segmentsToBoardPathD(
  segments: readonly RenderCurveSegment[],
  offsetXCm: number,
  offsetYCm: number
): string {
  if (segments.length === 0) return '';
  let d = '';
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const x0 = seg.p0.x + offsetXCm;
    const y0 = seg.p0.y + offsetYCm;
    const x3 = seg.p3.x + offsetXCm;
    const y3 = seg.p3.y + offsetYCm;
    if (i === 0) {
      d += `M ${x0} ${y0} `;
    } else {
      const prev = segments[i - 1];
      if (Math.hypot(prev.p3.x - seg.p0.x, prev.p3.y - seg.p0.y) > 1e-4) {
        d += `M ${x0} ${y0} `;
      }
    }
    if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
      d += `C ${seg.p1.x + offsetXCm} ${seg.p1.y + offsetYCm}, ${seg.p2.x + offsetXCm} ${seg.p2.y + offsetYCm}, ${x3} ${y3} `;
    } else {
      d += `L ${x3} ${y3} `;
    }
  }
  return d.trim();
}

/**
 * Deterministic sew-only hit-testing for `edit-contour` mode.
 * Priority: active Bézier handles > sew vertices > sew segments.
 * Strictly ignores `cutSegments` (D2).
 */
export function hitTestContourEditTarget(
  worldPtCm: RenderPoint2D,
  visiblePieces: readonly PatternPieceRenderModel[],
  proposalState: PatternGeometryProposalState | null,
  getEffectiveOffset: (pieceId: string) => { offsetXCm: number; offsetYCm: number },
  selection: ContourEditSelection | null,
  hitRadiusCm: number
): ContourEditHoverTarget | null {
  if (!Number.isFinite(worldPtCm.x) || !Number.isFinite(worldPtCm.y) || hitRadiusCm <= 0) {
    return null;
  }

  const handleRadius = hitRadiusCm * 1.15;
  const vertexRadius = hitRadiusCm * 1.1;
  const segmentRadius = hitRadiusCm * 0.9;

  // Iterate top-most pieces first (reverse render order)
  const orderedTopDown = [...visiblePieces].reverse();

  // Priority 1: Visible cubic Bézier handles (all cubic handles on selected piece, or incident handles)
  let bestHandle: { target: ContourEditHoverTarget; dist: number } | null = null;
  for (const piece of orderedTopDown) {
    const off = getEffectiveOffset(piece.pieceId);
    const localPt = { x: worldPtCm.x - off.offsetXCm, y: worldPtCm.y - off.offsetYCm };
    const sewSegments =
      proposalState?.reconciliationStatus === 'aligned' &&
      proposalState.pieceProposals[piece.pieceId]
        ? proposalState.pieceProposals[piece.pieceId].sewSegments
        : piece.sewSegments;

    for (const seg of sewSegments) {
      if (seg.kind !== 'cubic-bezier' || !seg.p1 || !seg.p2) continue;
      // Prioritize handles when piece is selected or segment is selected, but keep all cubic handles reachable
      const slots: Array<{ slot: 'p1' | 'p2'; pt: RenderPoint2D }> = [
        { slot: 'p1', pt: seg.p1 },
        { slot: 'p2', pt: seg.p2 }
      ];
      for (const { slot, pt } of slots) {
        const d = Math.hypot(localPt.x - pt.x, localPt.y - pt.y);
        if (d <= handleRadius) {
          const bonus =
            selection?.pieceId === piece.pieceId && selection.segmentId === seg.id ? 0.5 : 1.0;
          const score = d * bonus;
          if (!bestHandle || score < bestHandle.dist) {
            bestHandle = {
              dist: score,
              target: {
                pieceId: piece.pieceId,
                kind: 'handle',
                segmentId: seg.id,
                handleSlot: slot,
                localPointCm: pt
              }
            };
          }
        }
      }
    }
  }
  if (bestHandle) return bestHandle.target;

  // Priority 2: Editable sew vertices
  let bestVertex: { target: ContourEditHoverTarget; dist: number } | null = null;
  for (const piece of orderedTopDown) {
    const off = getEffectiveOffset(piece.pieceId);
    const localPt = { x: worldPtCm.x - off.offsetXCm, y: worldPtCm.y - off.offsetYCm };
    const sewSegments =
      proposalState?.reconciliationStatus === 'aligned' &&
      proposalState.pieceProposals[piece.pieceId]
        ? proposalState.pieceProposals[piece.pieceId].sewSegments
        : piece.sewSegments;

    const vertices = getEditableSewVerticesForPiece(piece.pieceId, sewSegments);
    for (const v of vertices) {
      const d = Math.hypot(localPt.x - v.localPointCm.x, localPt.y - v.localPointCm.y);
      if (d <= vertexRadius && (!bestVertex || d < bestVertex.dist)) {
        bestVertex = {
          dist: d,
          target: {
            pieceId: piece.pieceId,
            kind: 'vertex',
            vertexRef: v.entityRef,
            segmentId: v.segmentId,
            localPointCm: v.localPointCm
          }
        };
      }
    }
  }
  if (bestVertex) return bestVertex.target;

  // Priority 3: Editable sew segments (lines and cubics)
  let bestSeg: { target: ContourEditHoverTarget; dist: number } | null = null;
  for (const piece of orderedTopDown) {
    const off = getEffectiveOffset(piece.pieceId);
    const localPt = { x: worldPtCm.x - off.offsetXCm, y: worldPtCm.y - off.offsetYCm };
    const sewSegments =
      proposalState?.reconciliationStatus === 'aligned' &&
      proposalState.pieceProposals[piece.pieceId]
        ? proposalState.pieceProposals[piece.pieceId].sewSegments
        : piece.sewSegments;

    for (const seg of sewSegments) {
      if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
        const res = closestPointOnCubicBezier(localPt, seg.p0, seg.p1, seg.p2, seg.p3);
        if (res.ok && res.distanceCm <= segmentRadius && (!bestSeg || res.distanceCm < bestSeg.dist)) {
          bestSeg = {
            dist: res.distanceCm,
            target: {
              pieceId: piece.pieceId,
              kind: 'segment',
              segmentId: seg.id,
              localPointCm: res.pointCm,
              parameterT: res.parameterT
            }
          };
        }
      } else {
        const res = closestPointOnLineSegment(localPt, seg.p0, seg.p3);
        if (res.ok && res.distanceCm <= segmentRadius && (!bestSeg || res.distanceCm < bestSeg.dist)) {
          bestSeg = {
            dist: res.distanceCm,
            target: {
              pieceId: piece.pieceId,
              kind: 'segment',
              segmentId: seg.id,
              localPointCm: res.pointCm,
              parameterT: res.parameterT
            }
          };
        }
      }
    }
  }
  return bestSeg ? bestSeg.target : null;
}

export const PatternContourEditOverlay: React.FC<PatternContourEditOverlayProps> = React.memo(
  ({
    visiblePieces,
    getEffectiveOffset,
    proposalState,
    proposalIntegrity,
    isEditContourMode,
    compareOriginalGeometry,
    selection,
    hoverTarget,
    dragPreview,
    pendingApproximatePreview,
    invScale,
    isYUp
  }) => {
    const isAligned = !proposalState || proposalState.reconciliationStatus === 'aligned';
    const hasAlignedEdits = Boolean(isAligned && proposalState?.hasEdits);

    if (!isEditContourMode && !hasAlignedEdits && !dragPreview && !pendingApproximatePreview) {
      return null;
    }

    const invalidPieceIds = new Set(
      (proposalIntegrity?.checks ?? [])
        .filter((c) => c.status === 'invalid-proposal' && c.pieceId)
        .map((c) => c.pieceId!)
    );

    const fontCm = Math.max(0.75, 9 * invScale);
    const labelTransform = (bx: number, by: number) =>
      isYUp
        ? `translate(${bx}, ${by}) scale(1, -1)`
        : `translate(${bx}, ${by})`;

    return (
      <g
        data-testid="cad-contour-edit-overlay"
        data-edit-mode={isEditContourMode ? 'active' : 'passive'}
        data-has-edits={hasAlignedEdits ? 'true' : 'false'}
        className="pointer-events-none"
      >
        {visiblePieces.map((piece) => {
          const off = getEffectiveOffset(piece.pieceId);
          const pieceProp = isAligned ? proposalState?.pieceProposals[piece.pieceId] : undefined;
          const isPieceDragging = dragPreview?.pieceId === piece.pieceId;
          const activeSewSegments = isPieceDragging
            ? dragPreview.previewSewSegments
            : pieceProp?.sewSegments ?? piece.sewSegments;
          const isPieceModified = Boolean(pieceProp?.modifiedFromOriginal || isPieceDragging);
          const isPieceInvalid = invalidPieceIds.has(piece.pieceId);

          const originalSewD = isPieceModified
            ? segmentsToBoardPathD(piece.sewSegments, off.offsetXCm, off.offsetYCm)
            : '';
          const proposedSewD = isPieceModified
            ? segmentsToBoardPathD(activeSewSegments, off.offsetXCm, off.offsetYCm)
            : '';

          const vertices = isEditContourMode
            ? getEditableSewVerticesForPiece(piece.pieceId, activeSewSegments)
            : [];

          // Determine which cubic segments should display handles brightly vs subtly
          const selectedVertex =
            selection?.pieceId === piece.pieceId && selection.kind === 'vertex'
              ? vertices.find((v) => v.entityRef === selection.vertexRef)
              : undefined;
          const activeCubicSegmentIds = new Set<string>();
          if (selection?.pieceId === piece.pieceId) {
            if (selection.segmentId) activeCubicSegmentIds.add(selection.segmentId);
            if (selectedVertex?.incomingSegmentId) {
              activeCubicSegmentIds.add(selectedVertex.incomingSegmentId);
            }
            if (selectedVertex?.outgoingSegmentId) {
              activeCubicSegmentIds.add(selectedVertex.outgoingSegmentId);
            }
          }

          const pieceTagX = piece.boundingBoxCm.minX + off.offsetXCm;
          const pieceTagY = isYUp
            ? piece.boundingBoxCm.maxY + off.offsetYCm + 2.8
            : piece.boundingBoxCm.minY + off.offsetYCm - 2.8;

          return (
            <g key={`contour-edit-${piece.pieceId}`} data-testid={`cad-proposal-piece-${piece.pieceId}`}>
              {/* Original sew reference ghost when modified */}
              {isPieceModified && originalSewD && (
                <path
                  d={originalSewD}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth={1.3 * invScale}
                  strokeDasharray={`${4 * invScale} ${3 * invScale}`}
                  opacity={compareOriginalGeometry ? 0.95 : 0.6}
                  data-testid={`cad-original-sew-ghost-${piece.pieceId}`}
                />
              )}

              {/* Proposed sew contour (UNVERIFIED_VISUAL_PROPOSAL) */}
              {isPieceModified && proposedSewD && (
                <path
                  d={proposedSewD}
                  fill="none"
                  stroke={isPieceInvalid ? '#dc2626' : '#4f46e5'}
                  strokeWidth={(compareOriginalGeometry ? 1.8 : 2.5) * invScale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={compareOriginalGeometry ? 0.55 : 0.96}
                  data-testid={`cad-proposed-sew-contour-${piece.pieceId}`}
                />
              )}

              {/* D2: Visible stale cut-contour disclosure callout on edited pieces */}
              {isPieceModified && piece.cutSegments.length > 0 && (
                <g
                  transform={labelTransform(pieceTagX, pieceTagY)}
                  data-testid={`cad-stale-cut-badge-${piece.pieceId}`}
                >
                  <text
                    x={0}
                    y={0}
                    fontSize={fontCm}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight="700"
                    fill="#b45309"
                    stroke="#ffffff"
                    strokeWidth={2.5 * invScale}
                    paintOrder="stroke"
                  >
                    PROPOSAL (UNVERIFIED) · CUT OFFSET ORIGINAL / STALE
                  </text>
                </g>
              )}

              {/* Interactive Edit-Contour controls (only when tool active & proposal aligned) */}
              {isEditContourMode && isAligned && (
                <>
                  {/* Hovered or selected sew segment highlight */}
                  {activeSewSegments.map((seg) => {
                    const isSegSelected =
                      selection?.pieceId === piece.pieceId &&
                      selection.kind === 'segment' &&
                      selection.segmentId === seg.id;
                    const isSegHovered =
                      hoverTarget?.pieceId === piece.pieceId &&
                      hoverTarget.kind === 'segment' &&
                      hoverTarget.segmentId === seg.id;

                    if (!isSegSelected && !isSegHovered) return null;
                    return (
                      <path
                        key={`seg-hl-${seg.id}`}
                        d={segmentToBoardPathD(seg, off.offsetXCm, off.offsetYCm)}
                        fill="none"
                        stroke={isSegSelected ? '#4338ca' : '#6366f1'}
                        strokeWidth={(isSegSelected ? 3.4 : 2.6) * invScale}
                        strokeDasharray={isSegSelected ? undefined : `${5 * invScale} ${2.5 * invScale}`}
                        strokeLinecap="round"
                        data-testid={
                          isSegSelected ? `cad-edit-selected-segment-${seg.id}` : undefined
                        }
                      />
                    );
                  })}

                  {/* Cubic Bézier tangent arms & control handles */}
                  {activeSewSegments.map((seg) => {
                    if (seg.kind !== 'cubic-bezier' || !seg.p1 || !seg.p2) return null;
                    const isHighlightedCurve =
                      activeCubicSegmentIds.has(seg.id) ||
                      (hoverTarget?.pieceId === piece.pieceId && hoverTarget.segmentId === seg.id);
                    const armOpacity = isHighlightedCurve ? 0.92 : 0.36;
                    const handleRadius = (isHighlightedCurve ? 4.0 : 3.0) * invScale;

                    const p0x = seg.p0.x + off.offsetXCm;
                    const p0y = seg.p0.y + off.offsetYCm;
                    const p1x = seg.p1.x + off.offsetXCm;
                    const p1y = seg.p1.y + off.offsetYCm;
                    const p2x = seg.p2.x + off.offsetXCm;
                    const p2y = seg.p2.y + off.offsetYCm;
                    const p3x = seg.p3.x + off.offsetXCm;
                    const p3y = seg.p3.y + off.offsetYCm;

                    const isP1Selected =
                      selection?.pieceId === piece.pieceId &&
                      selection.kind === 'handle' &&
                      selection.segmentId === seg.id &&
                      selection.handleSlot === 'p1';
                    const isP2Selected =
                      selection?.pieceId === piece.pieceId &&
                      selection.kind === 'handle' &&
                      selection.segmentId === seg.id &&
                      selection.handleSlot === 'p2';
                    const isP1Hovered =
                      hoverTarget?.pieceId === piece.pieceId &&
                      hoverTarget.kind === 'handle' &&
                      hoverTarget.segmentId === seg.id &&
                      hoverTarget.handleSlot === 'p1';
                    const isP2Hovered =
                      hoverTarget?.pieceId === piece.pieceId &&
                      hoverTarget.kind === 'handle' &&
                      hoverTarget.segmentId === seg.id &&
                      hoverTarget.handleSlot === 'p2';

                    return (
                      <g key={`cubic-handles-${seg.id}`} opacity={armOpacity}>
                        <line
                          x1={p0x}
                          y1={p0y}
                          x2={p1x}
                          y2={p1y}
                          stroke="#7c3aed"
                          strokeWidth={(isHighlightedCurve ? 1.3 : 0.9) * invScale}
                          strokeDasharray={`${3 * invScale} ${2 * invScale}`}
                        />
                        <line
                          x1={p3x}
                          y1={p3y}
                          x2={p2x}
                          y2={p2y}
                          stroke="#7c3aed"
                          strokeWidth={(isHighlightedCurve ? 1.3 : 0.9) * invScale}
                          strokeDasharray={`${3 * invScale} ${2 * invScale}`}
                        />
                        <circle
                          cx={p1x}
                          cy={p1y}
                          r={isP1Selected || isP1Hovered ? 5.2 * invScale : handleRadius}
                          fill={isP1Selected ? '#7c3aed' : isP1Hovered ? '#ede9fe' : '#ffffff'}
                          stroke="#6d28d9"
                          strokeWidth={(isP1Selected ? 2.1 : 1.5) * invScale}
                          data-testid={`cad-edit-handle-${piece.pieceId}-${seg.id}-p1`}
                        />
                        <circle
                          cx={p2x}
                          cy={p2y}
                          r={isP2Selected || isP2Hovered ? 5.2 * invScale : handleRadius}
                          fill={isP2Selected ? '#7c3aed' : isP2Hovered ? '#ede9fe' : '#ffffff'}
                          stroke="#6d28d9"
                          strokeWidth={(isP2Selected ? 2.1 : 1.5) * invScale}
                          data-testid={`cad-edit-handle-${piece.pieceId}-${seg.id}-p2`}
                        />
                      </g>
                    );
                  })}

                  {/* Editable Sew Vertices */}
                  {vertices.map((v) => {
                    const bx = v.localPointCm.x + off.offsetXCm;
                    const by = v.localPointCm.y + off.offsetYCm;
                    const isSelected =
                      selection?.pieceId === piece.pieceId &&
                      selection.kind === 'vertex' &&
                      selection.vertexRef === v.entityRef;
                    const isHovered =
                      hoverTarget?.pieceId === piece.pieceId &&
                      hoverTarget.kind === 'vertex' &&
                      hoverTarget.vertexRef === v.entityRef;
                    const half = (isSelected ? 4.8 : isHovered ? 4.3 : 3.4) * invScale;

                    return (
                      <g
                        key={`vtx-${v.entityRef}`}
                        data-testid={`cad-edit-vertex-${v.entityRef}`}
                        data-selected={isSelected ? 'true' : 'false'}
                      >
                        <rect
                          x={bx - half}
                          y={by - half}
                          width={half * 2}
                          height={half * 2}
                          rx={v.isShared ? 0.6 * invScale : half}
                          fill={isSelected ? '#4f46e5' : isHovered ? '#e0e7ff' : '#ffffff'}
                          stroke={isSelected ? '#312e81' : '#4f46e5'}
                          strokeWidth={(isSelected ? 2.0 : 1.4) * invScale}
                        />
                      </g>
                    );
                  })}
                </>
              )}
            </g>
          );
        })}

        {/* R1 / R2: Pending Approximate Operation Preview Overlay */}
        {pendingApproximatePreview && pendingApproximatePreview.previewSegment && (
          (() => {
            const off = getEffectiveOffset(pendingApproximatePreview.pieceId);
            const strokeColor = pendingApproximatePreview.exceedsTolerance ? '#dc2626' : '#ea580c';
            const previewD = segmentToBoardPathD(
              pendingApproximatePreview.previewSegment,
              off.offsetXCm,
              off.offsetYCm
            );
            const worstA = pendingApproximatePreview.worstCurvePointCm
              ? {
                  x: pendingApproximatePreview.worstCurvePointCm.x + off.offsetXCm,
                  y: pendingApproximatePreview.worstCurvePointCm.y + off.offsetYCm
                }
              : null;
            const worstB = pendingApproximatePreview.closestPreviewPointCm
              ? {
                  x: pendingApproximatePreview.closestPreviewPointCm.x + off.offsetXCm,
                  y: pendingApproximatePreview.closestPreviewPointCm.y + off.offsetYCm
                }
              : null;

            return (
              <g data-testid="cad-approx-operation-preview">
                <path
                  d={previewD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={3.2 * invScale}
                  strokeDasharray={`${6 * invScale} ${3 * invScale}`}
                  strokeLinecap="round"
                />
                {worstA && worstB && (
                  <>
                    <line
                      x1={worstA.x}
                      y1={worstA.y}
                      x2={worstB.x}
                      y2={worstB.y}
                      stroke={strokeColor}
                      strokeWidth={2.0 * invScale}
                    />
                    <circle
                      cx={worstA.x}
                      cy={worstA.y}
                      r={4.2 * invScale}
                      fill={strokeColor}
                      stroke="#ffffff"
                      strokeWidth={1.3 * invScale}
                    />
                    <g
                      transform={labelTransform(
                        worstA.x + 8 * invScale,
                        isYUp ? worstA.y + 6 * invScale : worstA.y - 6 * invScale
                      )}
                    >
                      <text
                        x={0}
                        y={0}
                        fontSize={fontCm}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontWeight="700"
                        fill={strokeColor}
                        stroke="#ffffff"
                        strokeWidth={2.5 * invScale}
                        paintOrder="stroke"
                      >
                        {pendingApproximatePreview.isExact
                          ? 'EXACT (Δ 0.000 cm)'
                          : `APPROX Δmax ${pendingApproximatePreview.maxDeviationCm.toFixed(3)} cm`}
                      </text>
                    </g>
                  </>
                )}
              </g>
            );
          })()
        )}

        {/* Live Drag Snap / Axis Constraint Guide */}
        {dragPreview && (
          (() => {
            const off = getEffectiveOffset(dragPreview.pieceId);
            const curX = dragPreview.currentLocalCm.x + off.offsetXCm;
            const curY = dragPreview.currentLocalCm.y + off.offsetYCm;
            const origX = dragPreview.originLocalCm.x + off.offsetXCm;
            const origY = dragPreview.originLocalCm.y + off.offsetYCm;
            const { snapResult } = dragPreview;

            return (
              <g data-testid="cad-contour-drag-guide">
                <line
                  x1={origX}
                  y1={origY}
                  x2={curX}
                  y2={curY}
                  stroke="#0284c7"
                  strokeWidth={1.2 * invScale}
                  strokeDasharray={`${3 * invScale} ${2 * invScale}`}
                />
                {snapResult.snappedKind !== 'none' && snapResult.snapTargetPointCm && (
                  <circle
                    cx={snapResult.snapTargetPointCm.x + off.offsetXCm}
                    cy={snapResult.snapTargetPointCm.y + off.offsetYCm}
                    r={6.5 * invScale}
                    fill="none"
                    stroke="#059669"
                    strokeWidth={1.8 * invScale}
                  />
                )}
                <g
                  transform={labelTransform(
                    curX + 9 * invScale,
                    isYUp ? curY + 7 * invScale : curY - 7 * invScale
                  )}
                >
                  <text
                    x={0}
                    y={0}
                    fontSize={fontCm}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight="700"
                    fill="#1e1b4b"
                    stroke="#ffffff"
                    strokeWidth={2.5 * invScale}
                    paintOrder="stroke"
                  >
                    ({dragPreview.currentLocalCm.x.toFixed(2)}, {dragPreview.currentLocalCm.y.toFixed(2)}) cm
                    {snapResult.constrainedAxisAngleDeg !== null
                      ? ` · ${snapResult.constrainedAxisAngleDeg}°`
                      : ''}
                    {snapResult.snappedKind !== 'none'
                      ? ` · SNAP ${snapResult.snappedKind.toUpperCase()}`
                      : ''}
                  </text>
                </g>
              </g>
            );
          })()
        )}
      </g>
    );
  }
);

PatternContourEditOverlay.displayName = 'PatternContourEditOverlay';
