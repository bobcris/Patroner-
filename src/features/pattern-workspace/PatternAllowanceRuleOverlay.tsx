/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A4 Canvas Overlay — Declarative Seam Allowance Rule Badges, Corner Join Markers
 * & Production Annotation Callouts.
 *
 * STRICT GOVERNANCE INVARIANT (ADR-001, D2):
 * - Renders ONLY declarative sew-edge highlights, numeric badges, and corner symbols.
 * - ZERO offset-curve or cutting-contour synthesis. Never draws synthetic cut polygons.
 */

import React from 'react';
import type { PatternPieceRenderModel, RenderCurveSegment } from './contracts/pattern-render-artifact';
import type {
  DeclarativeAllowanceEdgeRole,
  ExtendedPieceEngineeringOverlay
} from './contracts/wp-a-shared-contracts';
import { formatDeclarativeRuleBadge } from './seam-allowance-rules';
import { evaluateSegmentPointExact } from './spatial-diagnostics';

export interface PatternAllowanceRuleOverlayProps {
  readonly visiblePieces: readonly PatternPieceRenderModel[];
  readonly pieceEngineering: Readonly<Record<string, ExtendedPieceEngineeringOverlay>>;
  readonly getEffectiveOffset: (pieceId: string) => { offsetXCm: number; offsetYCm: number };
  readonly selectedSegmentId: string | null;
  readonly showRuleBadges: boolean;
  readonly showProductionAnnotations: boolean;
  readonly isAllowanceToolActive: boolean;
  readonly invScale: number;
  readonly isYUp: boolean;
}

const ROLE_COLORS: Readonly<Partial<Record<DeclarativeAllowanceEdgeRole, string>>> = {
  'seam-edge': '#0284c7',
  'structural-seam': '#0284c7',
  hem: '#d97706',
  'hem-turn-up': '#d97706',
  'fold-edge': '#7c3aed',
  'facing-edge': '#0d9488',
  'raw-bound-edge': '#64748b',
  'dart-cap': '#e11d48'
};

function segmentToBoardPathD(seg: RenderCurveSegment, ox: number, oy: number): string {
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    return `M ${seg.p0.x + ox} ${seg.p0.y + oy} C ${seg.p1.x + ox} ${seg.p1.y + oy}, ${seg.p2.x + ox} ${seg.p2.y + oy}, ${seg.p3.x + ox} ${seg.p3.y + oy}`;
  }
  return `M ${seg.p0.x + ox} ${seg.p0.y + oy} L ${seg.p3.x + ox} ${seg.p3.y + oy}`;
}

export const PatternAllowanceRuleOverlay: React.FC<PatternAllowanceRuleOverlayProps> = ({
  visiblePieces,
  pieceEngineering,
  getEffectiveOffset,
  selectedSegmentId,
  showRuleBadges,
  showProductionAnnotations,
  isAllowanceToolActive,
  invScale,
  isYUp
}) => {
  if (!showRuleBadges && !showProductionAnnotations && !isAllowanceToolActive) return null;

  const fontSizeCm = 9 * invScale;
  const textTransform = (x: number, y: number) =>
    isYUp ? `translate(${x} ${y}) scale(1 -1)` : `translate(${x} ${y})`;

  return (
    <g data-testid="cad-allowance-rule-overlay" className="pointer-events-none">
      {visiblePieces.map((piece) => {
        const eng = pieceEngineering[piece.pieceId];
        const evaluation = eng?.allowanceEvaluation;
        const proposal = eng?.allowanceRules;
        if (!evaluation) return null;

        const off = getEffectiveOffset(piece.pieceId);
        const conflictSegTargets = new Set(
          evaluation.conflicts.filter((c) => c.targetRef.startsWith('seg:')).map((c) => c.targetRef.slice(4))
        );

        const bboxCenter = {
          x: off.offsetXCm + (piece.boundingBoxCm.minX + piece.boundingBoxCm.maxX) * 0.5,
          y: off.offsetYCm + (piece.boundingBoxCm.minY + piece.boundingBoxCm.maxY) * 0.5
        };

        return (
          <g key={`allow-overlay-${piece.pieceId}`}>
            {/* Declarative sew-edge role highlight & numeric badge (NO offset curves!) */}
            {(showRuleBadges || isAllowanceToolActive) &&
              piece.sewSegments.map((seg) => {
                const rule = evaluation.resolvedRulesBySegmentId[seg.id];
                if (!rule) return null;
                const isSelected = seg.id === selectedSegmentId;
                const hasConflict = conflictSegTargets.has(seg.id);
                const roleColor = hasConflict ? '#dc2626' : (ROLE_COLORS[rule.edgeRole] ?? '#0284c7');
                const mid = evaluateSegmentPointExact(seg, 0.5);
                const badgeText = formatDeclarativeRuleBadge(rule);

                const hasExplicitOverride = Boolean(proposal?.segmentRuleOverrides?.[seg.id]);
                const segChordCm = Math.hypot(seg.p3.x - seg.p0.x, seg.p3.y - seg.p0.y);
                const showBadgeForSeg =
                  Boolean(mid) &&
                  (isSelected ||
                    hasConflict ||
                    hasExplicitOverride ||
                    (isAllowanceToolActive && segChordCm >= 5.0));

                return (
                  <g key={`allow-seg-${seg.id}`}>
                    {(isAllowanceToolActive || isSelected || hasConflict) && (
                      <path
                        d={segmentToBoardPathD(seg, off.offsetXCm, off.offsetYCm)}
                        fill="none"
                        stroke={roleColor}
                        strokeWidth={(isSelected ? 3.2 : 2.0) * invScale}
                        opacity={isSelected ? 0.95 : 0.65}
                      />
                    )}
                    {mid && showBadgeForSeg && (
                      <g transform={textTransform(off.offsetXCm + mid.x, off.offsetYCm + mid.y - 4 * invScale)}>
                        <rect
                          x={-24 * invScale}
                          y={-fontSizeCm * 1.05}
                          width={48 * invScale}
                          height={fontSizeCm * 1.38}
                          rx={2.5 * invScale}
                          fill={hasConflict ? '#fef2f2' : 'rgba(255, 255, 255, 0.92)'}
                          stroke={roleColor}
                          strokeWidth={0.9 * invScale}
                        />
                        <text
                          textAnchor="middle"
                          fontSize={fontSizeCm}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fontWeight="600"
                          fill={roleColor}
                        >
                          {badgeText}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

            {/* Vertex corner join markers */}
            {(showRuleBadges || isAllowanceToolActive) &&
              Object.values(evaluation.cornerOverridesByVertexRef).map((ov) => {
                const [segId, slot] = ov.vertexRef.split(':');
                const seg = piece.sewSegments.find((s) => s.id === segId);
                if (!seg) return null;
                const pt = slot === 'p3' ? seg.p3 : seg.p0;
                const cx = off.offsetXCm + pt.x;
                const cy = off.offsetYCm + pt.y;
                return (
                  <g key={`corner-ov-${ov.vertexRef}`}>
                    <rect
                      x={cx - 3.6 * invScale}
                      y={cy - 3.6 * invScale}
                      width={7.2 * invScale}
                      height={7.2 * invScale}
                      fill="#ffffff"
                      stroke="#7c3aed"
                      strokeWidth={1.3 * invScale}
                    />
                    <g transform={textTransform(cx + 6 * invScale, cy - 4 * invScale)}>
                      <text fontSize={8 * invScale} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#6d28d9">
                        {ov.joinStyle}
                      </text>
                    </g>
                  </g>
                );
              })}

            {/* Production annotation summary tag on piece interior (only when SA tool active or custom notes exist) */}
            {showProductionAnnotations &&
              proposal &&
              (isAllowanceToolActive ||
                Boolean(proposal.fabricNote) ||
                Boolean(proposal.interfacingNote) ||
                Boolean(proposal.productionNotes?.trim())) && (() => {
                const cutNote = proposal.cutQuantityNote?.trim() || null;
                const alreadySaysFold = Boolean(cutNote && /fold/i.test(cutNote));
                const parts = [
                  cutNote,
                  proposal.onFoldDeclared && !alreadySaysFold ? 'CUT ON FOLD' : null,
                  proposal.fabricNote?.trim() || null,
                  proposal.interfacingNote?.trim() || null
                ].filter(Boolean);
                if (parts.length === 0) return null;
                const text = parts.join(' · ');
                return (
                  <g transform={textTransform(bboxCenter.x, bboxCenter.y + 38 * invScale)}>
                    <text
                      textAnchor="middle"
                      fontSize={8.5 * invScale}
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      fill="#475569"
                    >
                      {text}
                    </text>
                  </g>
                );
              })()}
          </g>
        );
      })}
    </g>
  );
};
