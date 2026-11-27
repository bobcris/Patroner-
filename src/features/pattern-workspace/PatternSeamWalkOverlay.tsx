/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A1 Canvas Overlay — Seam Correspondence Highlight, Scrubbed Ghost Piece Alignment,
 * Bounded Walk Ticks, Endpoint Join Badges & Notch Discrepancy Indicators.
 *
 * Strictly read-only SVG presentation (`pointer-events-none`). Never mutates artifacts.
 */

import React, { useMemo } from 'react';
import type {
  PatternArtifactBundle,
  PatternPieceRenderModel,
  RenderCurveSegment
} from './contracts/pattern-render-artifact';
import type {
  SeamCorrespondencePair,
  SeamWalkEvaluation
} from './contracts/wp-a-shared-contracts';

export interface PatternSeamWalkOverlayProps {
  readonly artifact: PatternArtifactBundle;
  readonly visiblePieces: readonly PatternPieceRenderModel[];
  readonly getEffectiveOffset: (pieceId: string) => { offsetXCm: number; offsetYCm: number };
  readonly activePair: SeamCorrespondencePair | null;
  readonly evaluation: SeamWalkEvaluation | null;
  readonly showGhostPieceB: boolean;
  readonly visible: boolean;
  readonly invScale: number;
  readonly isYUp: boolean;
}

function segmentToBoardPathD(seg: RenderCurveSegment, ox: number, oy: number): string {
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    return `M ${seg.p0.x + ox} ${seg.p0.y + oy} C ${seg.p1.x + ox} ${seg.p1.y + oy}, ${seg.p2.x + ox} ${seg.p2.y + oy}, ${seg.p3.x + ox} ${seg.p3.y + oy}`;
  }
  return `M ${seg.p0.x + ox} ${seg.p0.y + oy} L ${seg.p3.x + ox} ${seg.p3.y + oy}`;
}

function pieceLocalSegmentsToPathD(segments: readonly RenderCurveSegment[]): string {
  if (segments.length === 0) return '';
  let d = `M ${segments[0].p0.x} ${segments[0].p0.y}`;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i > 0) {
      const prev = segments[i - 1];
      if (Math.hypot(prev.p3.x - seg.p0.x, prev.p3.y - seg.p0.y) > 1e-4) {
        d += ` M ${seg.p0.x} ${seg.p0.y}`;
      }
    }
    if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
      d += ` C ${seg.p1.x} ${seg.p1.y}, ${seg.p2.x} ${seg.p2.y}, ${seg.p3.x} ${seg.p3.y}`;
    } else {
      d += ` L ${seg.p3.x} ${seg.p3.y}`;
    }
  }
  return `${d} Z`;
}

export const PatternSeamWalkOverlay: React.FC<PatternSeamWalkOverlayProps> = ({
  artifact,
  visiblePieces,
  getEffectiveOffset,
  activePair,
  evaluation,
  showGhostPieceB,
  visible,
  invScale,
  isYUp
}) => {
  const pieceMap = useMemo(() => {
    const m = new Map<string, PatternPieceRenderModel>();
    for (const p of visiblePieces) m.set(p.pieceId, p);
    return m;
  }, [visiblePieces]);

  if (!visible || !activePair || !evaluation) return null;

  const pieceA = pieceMap.get(activePair.sideA.pieceId) ?? artifact.pieces.find((p) => p.pieceId === activePair.sideA.pieceId);
  const pieceB = pieceMap.get(activePair.sideB.pieceId) ?? artifact.pieces.find((p) => p.pieceId === activePair.sideB.pieceId);
  if (!pieceA || !pieceB) return null;

  const offA = getEffectiveOffset(pieceA.pieceId);
  const offB = getEffectiveOffset(pieceB.pieceId);

  const resolvedSetA = new Set(evaluation.resolvedSegmentIdsA);
  const resolvedSetB = new Set(evaluation.resolvedSegmentIdsB);
  const segsA = pieceA.sewSegments.filter((s) => resolvedSetA.has(s.id));
  const segsB = pieceB.sewSegments.filter((s) => resolvedSetB.has(s.id));

  const tx = evaluation.rigidTransformBToA;
  const rotDeg = tx ? (tx.rotationRad * 180) / Math.PI : 0;
  const ghostTransform = tx
    ? `translate(${offA.offsetXCm + tx.targetACm.x} ${offA.offsetYCm + tx.targetACm.y}) rotate(${rotDeg}) translate(${-tx.pivotBCm.x} ${-tx.pivotBCm.y})`
    : undefined;

  const fontSizeCm = 10.5 * invScale;
  const markerR = 4.5 * invScale;
  const textTransform = (x: number, y: number) =>
    isYUp ? `translate(${x} ${y}) scale(1 -1)` : `translate(${x} ${y})`;

  return (
    <g data-testid="cad-seam-walk-overlay" className="pointer-events-none">
      {/* Side A chain highlight (Indigo) */}
      {segsA.map((seg) => (
        <path
          key={`seam-a-${seg.id}`}
          d={segmentToBoardPathD(seg, offA.offsetXCm, offA.offsetYCm)}
          fill="none"
          stroke="#4f46e5"
          strokeWidth={3.2 * invScale}
          strokeLinecap="round"
          opacity={0.85}
        />
      ))}

      {/* Side B chain highlight (Teal) */}
      {segsB.map((seg) => (
        <path
          key={`seam-b-${seg.id}`}
          d={segmentToBoardPathD(seg, offB.offsetXCm, offB.offsetYCm)}
          fill="none"
          stroke="#0d9488"
          strokeWidth={3.2 * invScale}
          strokeLinecap="round"
          opacity={0.85}
        />
      ))}

      {/* Read-only Ghost Piece B walked onto Piece A at scrubbed arc position */}
      {showGhostPieceB && ghostTransform && (
        <g data-testid="cad-seam-walk-ghost-b" transform={ghostTransform} opacity={0.55}>
          <path
            d={pieceLocalSegmentsToPathD(pieceB.sewSegments)}
            fill="rgba(13, 148, 136, 0.08)"
            stroke="#0d9488"
            strokeWidth={1.6 * invScale}
            strokeDasharray={`${5 * invScale} ${3 * invScale}`}
          />
          {segsB.map((seg) => (
            <path
              key={`ghost-seg-b-${seg.id}`}
              d={segmentToBoardPathD(seg, 0, 0)}
              fill="none"
              stroke="#0f766e"
              strokeWidth={2.4 * invScale}
            />
          ))}
        </g>
      )}

      {/* Active Walk Contact Point + Tangent Vector */}
      {evaluation.status === 'ok' && evaluation.pointOnACm && (
        <g data-testid="cad-seam-walk-cursor">
          <circle
            cx={offA.offsetXCm + evaluation.pointOnACm.x}
            cy={offA.offsetYCm + evaluation.pointOnACm.y}
            r={markerR}
            fill="#4f46e5"
            stroke="#ffffff"
            strokeWidth={1.5 * invScale}
          />
          {tx && (
            <line
              x1={offA.offsetXCm + evaluation.pointOnACm.x}
              y1={offA.offsetYCm + evaluation.pointOnACm.y}
              x2={offA.offsetXCm + evaluation.pointOnACm.x + tx.tangentACm.x * 2.2}
              y2={offA.offsetYCm + evaluation.pointOnACm.y + tx.tangentACm.y * 2.2}
              stroke="#4f46e5"
              strokeWidth={1.8 * invScale}
            />
          )}
          <g
            transform={textTransform(
              offA.offsetXCm + evaluation.pointOnACm.x + 10 * invScale,
              offA.offsetYCm + evaluation.pointOnACm.y - 8 * invScale
            )}
          >
            <rect
              x={-3 * invScale}
              y={-fontSizeCm * 1.05}
              width={120 * invScale}
              height={fontSizeCm * 1.45}
              rx={3 * invScale}
              fill="rgba(15, 23, 42, 0.88)"
            />
            <text
              x={2 * invScale}
              y={0}
              fontSize={fontSizeCm}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill="#f8fafc"
            >
              {`s=${evaluation.walkCursorArcCm.toFixed(1)}cm Δ${evaluation.rawDeltaCm >= 0 ? '+' : ''}${evaluation.rawDeltaCm.toFixed(2)}`}
            </text>
          </g>
        </g>
      )}

      {/* Endpoint Join Classification Markers */}
      {(['start', 'end'] as const).map((epKey) => {
        const ep = evaluation.endpointAnalysis[epKey];
        if (!ep) return null;
        const fill =
          ep.classification === 'smooth-join'
            ? '#059669'
            : ep.classification === 'mild-angle'
              ? '#d97706'
              : '#dc2626';
        return (
          <g key={`seam-ep-${epKey}`}>
            <circle
              cx={offA.offsetXCm + ep.pointACm.x}
              cy={offA.offsetYCm + ep.pointACm.y}
              r={3.5 * invScale}
              fill={fill}
              stroke="#ffffff"
              strokeWidth={1.2 * invScale}
            />
          </g>
        );
      })}
    </g>
  );
};
