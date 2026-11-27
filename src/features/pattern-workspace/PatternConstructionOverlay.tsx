/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A2 Canvas Overlay — Construction Lines, Reference Axes, Circles/Arcs,
 * Internal Lines, Technical Callouts, Live 2-Click Draw Preview & Unified Snap Indicator.
 *
 * Strictly read-only SVG presentation (`pointer-events-none`). Non-cutting geometry only.
 */

import React from 'react';
import type { RenderPoint2D } from './contracts/pattern-render-artifact';
import type {
  ConstructionEntity,
  UnifiedSnapResult
} from './contracts/wp-a-shared-contracts';

export interface ActiveConstructionDrawPreview {
  readonly kind: 'construction-line' | 'construction-circle' | 'reference-axis' | 'internal-line';
  readonly pieceId: string | null;
  readonly startLocalCm: RenderPoint2D;
  readonly currentLocalCm: RenderPoint2D;
}

export interface PatternConstructionOverlayProps {
  readonly constructions: Readonly<Record<string, ConstructionEntity>>;
  readonly getEffectiveOffset: (pieceId: string) => { offsetXCm: number; offsetYCm: number };
  readonly showConstructions: boolean;
  readonly showInternalLines: boolean;
  readonly showAnnotations: boolean;
  readonly selectedConstructionId: string | null;
  readonly drawPreview: ActiveConstructionDrawPreview | null;
  readonly activeSnapResult: UnifiedSnapResult | null;
  readonly activeSnapPieceId: string | null;
  readonly invScale: number;
  readonly isYUp: boolean;
}

export const PatternConstructionOverlay: React.FC<PatternConstructionOverlayProps> = ({
  constructions,
  getEffectiveOffset,
  showConstructions,
  showInternalLines,
  showAnnotations,
  selectedConstructionId,
  drawPreview,
  activeSnapResult,
  activeSnapPieceId,
  invScale,
  isYUp
}) => {
  const entities = Object.values(constructions);
  const fontSizeCm = 9.5 * invScale;
  const textTransform = (x: number, y: number) =>
    isYUp ? `translate(${x} ${y}) scale(1 -1)` : `translate(${x} ${y})`;

  const getOffset = (pieceId: string | null) =>
    pieceId ? getEffectiveOffset(pieceId) : { offsetXCm: 0, offsetYCm: 0 };

  return (
    <g data-testid="cad-construction-overlay" className="pointer-events-none">
      {entities.map((entity) => {
        if (!entity.visible) return null;
        if (entity.layerId === 'construction' && !showConstructions) return null;
        if (entity.layerId === 'internal-lines' && !showInternalLines) return null;
        if (entity.layerId === 'annotations' && !showAnnotations) return null;

        const off = getOffset(entity.pieceId);
        const isSelected = entity.id === selectedConstructionId;
        const baseWidth = (isSelected ? 2.1 : 1.25) * invScale;

        if (
          entity.kind === 'construction-line' ||
          entity.kind === 'construction-ray' ||
          entity.kind === 'parallel-guide' ||
          entity.kind === 'perpendicular-guide' ||
          entity.kind === 'reference-axis'
        ) {
          const x1 = off.offsetXCm + entity.start.x;
          const y1 = off.offsetYCm + entity.start.y;
          const x2 = off.offsetXCm + entity.end.x;
          const y2 = off.offsetYCm + entity.end.y;
          const stroke =
            entity.kind === 'reference-axis'
              ? '#7c3aed'
              : entity.kind === 'parallel-guide' || entity.kind === 'perpendicular-guide'
                ? '#0284c7'
                : '#2563eb';
          const dash =
            entity.kind === 'reference-axis'
              ? `${9 * invScale} ${3 * invScale} ${2 * invScale} ${3 * invScale}`
              : `${5 * invScale} ${3.5 * invScale}`;

          return (
            <g key={entity.id} data-construction-id={entity.id}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isSelected ? '#f59e0b' : stroke}
                strokeWidth={baseWidth}
                strokeDasharray={dash}
                opacity={entity.locked ? 0.6 : 0.9}
              />
              <circle cx={x1} cy={y1} r={2.2 * invScale} fill={stroke} />
              <circle cx={x2} cy={y2} r={2.2 * invScale} fill={stroke} />
              <g transform={textTransform(x1 + 6 * invScale, y1 - 4 * invScale)}>
                <rect
                  x={-2 * invScale}
                  y={-fontSizeCm * 1.02}
                  width={Math.max(36, entity.label.length * 5.8 + 4) * invScale}
                  height={fontSizeCm * 1.32}
                  rx={2 * invScale}
                  fill="rgba(255, 255, 255, 0.88)"
                />
                <text
                  fontSize={fontSizeCm}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fill={stroke}
                >
                  {entity.label}
                </text>
              </g>
            </g>
          );
        }

        if (entity.kind === 'construction-circle') {
          const cx = off.offsetXCm + entity.center.x;
          const cy = off.offsetYCm + entity.center.y;
          return (
            <g key={entity.id} data-construction-id={entity.id}>
              <circle
                cx={cx}
                cy={cy}
                r={entity.radiusCm}
                fill="none"
                stroke={isSelected ? '#f59e0b' : '#2563eb'}
                strokeWidth={baseWidth}
                strokeDasharray={`${5 * invScale} ${3.5 * invScale}`}
              />
              <circle cx={cx} cy={cy} r={2.4 * invScale} fill="#2563eb" />
              <g transform={textTransform(cx, cy - entity.radiusCm - 4 * invScale)}>
                <rect
                  x={-Math.max(24, entity.label.length * 3.1 + 4) * invScale}
                  y={-fontSizeCm * 1.02}
                  width={Math.max(48, entity.label.length * 6.2 + 8) * invScale}
                  height={fontSizeCm * 1.32}
                  rx={2 * invScale}
                  fill="rgba(255, 255, 255, 0.88)"
                />
                <text
                  textAnchor="middle"
                  fontSize={fontSizeCm}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fill="#2563eb"
                >
                  {entity.label}
                </text>
              </g>
            </g>
          );
        }

        if (entity.kind === 'construction-arc') {
          const cx = off.offsetXCm + entity.center.x;
          const cy = off.offsetYCm + entity.center.y;
          const sx = cx + Math.cos(entity.startAngleRad) * entity.radiusCm;
          const sy = cy + Math.sin(entity.startAngleRad) * entity.radiusCm;
          const ex = cx + Math.cos(entity.endAngleRad) * entity.radiusCm;
          const ey = cy + Math.sin(entity.endAngleRad) * entity.radiusCm;
          const largeArc = Math.abs(entity.endAngleRad - entity.startAngleRad) > Math.PI ? 1 : 0;
          const sweep = entity.endAngleRad >= entity.startAngleRad ? 1 : 0;
          return (
            <g key={entity.id} data-construction-id={entity.id}>
              <path
                d={`M ${sx} ${sy} A ${entity.radiusCm} ${entity.radiusCm} 0 ${largeArc} ${sweep} ${ex} ${ey}`}
                fill="none"
                stroke={isSelected ? '#f59e0b' : '#0284c7'}
                strokeWidth={baseWidth}
                strokeDasharray={`${5 * invScale} ${3.5 * invScale}`}
              />
              <circle cx={cx} cy={cy} r={2 * invScale} fill="#0284c7" />
            </g>
          );
        }

        if (entity.kind === 'internal-line') {
          return (
            <g key={entity.id} data-construction-id={entity.id}>
              {entity.segments.map((seg) => (
                <line
                  key={seg.id}
                  x1={off.offsetXCm + seg.p0.x}
                  y1={off.offsetYCm + seg.p0.y}
                  x2={off.offsetXCm + seg.p3.x}
                  y2={off.offsetYCm + seg.p3.y}
                  stroke={isSelected ? '#f59e0b' : '#0f766e'}
                  strokeWidth={baseWidth}
                  strokeDasharray={
                    entity.role === 'fold-line'
                      ? `${8 * invScale} ${3 * invScale} ${2 * invScale} ${3 * invScale}`
                      : `${3 * invScale} ${2.5 * invScale}`
                  }
                />
              ))}
              {entity.segments[0] && (
                <g
                  transform={textTransform(
                    off.offsetXCm + (entity.segments[0].p0.x + entity.segments[0].p3.x) * 0.5,
                    off.offsetYCm + (entity.segments[0].p0.y + entity.segments[0].p3.y) * 0.5 - 4 * invScale
                  )}
                >
                  <rect
                    x={-Math.max(24, entity.label.length * 3.1 + 4) * invScale}
                    y={-fontSizeCm * 1.02}
                    width={Math.max(48, entity.label.length * 6.2 + 8) * invScale}
                    height={fontSizeCm * 1.32}
                    rx={2 * invScale}
                    fill="rgba(255, 255, 255, 0.88)"
                  />
                  <text
                    textAnchor="middle"
                    fontSize={fontSizeCm}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fill="#0f766e"
                  >
                    {entity.label}
                  </text>
                </g>
              )}
            </g>
          );
        }

        if (entity.kind === 'technical-callout') {
          const ax = off.offsetXCm + entity.anchor.x;
          const ay = off.offsetYCm + entity.anchor.y;
          return (
            <g key={entity.id} data-construction-id={entity.id}>
              {entity.leaderTarget && (
                <line
                  x1={ax}
                  y1={ay}
                  x2={off.offsetXCm + entity.leaderTarget.x}
                  y2={off.offsetYCm + entity.leaderTarget.y}
                  stroke="#475569"
                  strokeWidth={1.1 * invScale}
                />
              )}
              <circle cx={ax} cy={ay} r={2.5 * invScale} fill="#334155" />
              <g transform={textTransform(ax + 5 * invScale, ay - 3 * invScale)}>
                <rect
                  x={-2 * invScale}
                  y={-fontSizeCm * 1.05}
                  width={Math.max(44, entity.text.length * 6.2) * invScale}
                  height={fontSizeCm * 1.4}
                  rx={2.5 * invScale}
                  fill="rgba(255, 255, 255, 0.92)"
                  stroke="#94a3b8"
                  strokeWidth={0.8 * invScale}
                />
                <text fontSize={fontSizeCm} fontFamily="ui-sans-serif, system-ui, sans-serif" fill="#0f172a">
                  {entity.text}
                </text>
              </g>
            </g>
          );
        }

        return null;
      })}

      {/* Live 2-click interactive draw preview */}
      {drawPreview && (() => {
        const off = getOffset(drawPreview.pieceId);
        const x1 = off.offsetXCm + drawPreview.startLocalCm.x;
        const y1 = off.offsetYCm + drawPreview.startLocalCm.y;
        const x2 = off.offsetXCm + drawPreview.currentLocalCm.x;
        const y2 = off.offsetYCm + drawPreview.currentLocalCm.y;
        const r = Math.hypot(x2 - x1, y2 - y1);
        return (
          <g data-testid="cad-construction-draw-preview">
            {drawPreview.kind === 'construction-circle' ? (
              <circle
                cx={x1}
                cy={y1}
                r={Math.max(0.05, r)}
                fill="rgba(37, 99, 235, 0.05)"
                stroke="#2563eb"
                strokeWidth={1.5 * invScale}
                strokeDasharray={`${4 * invScale} ${3 * invScale}`}
              />
            ) : (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#2563eb"
                strokeWidth={1.6 * invScale}
                strokeDasharray={`${4 * invScale} ${3 * invScale}`}
              />
            )}
            <circle cx={x1} cy={y1} r={3 * invScale} fill="#2563eb" stroke="#ffffff" strokeWidth={1 * invScale} />
          </g>
        );
      })()}

      {/* Unified CAD Precision Snap Reticle */}
      {activeSnapResult && activeSnapResult.kind !== 'none' && (() => {
        const off = getOffset(activeSnapPieceId);
        const sx = off.offsetXCm + activeSnapResult.pointCm.x;
        const sy = off.offsetYCm + activeSnapResult.pointCm.y;
        const guide = activeSnapResult.guide;
        return (
          <g data-testid="cad-unified-snap-indicator">
            {guide && (
              <line
                x1={off.offsetXCm + guide.startCm.x}
                y1={off.offsetYCm + guide.startCm.y}
                x2={off.offsetXCm + guide.endCm.x}
                y2={off.offsetYCm + guide.endCm.y}
                stroke="#0ea5e9"
                strokeWidth={1.1 * invScale}
                strokeDasharray={`${3 * invScale} ${3 * invScale}`}
              />
            )}
            <rect
              x={sx - 4 * invScale}
              y={sy - 4 * invScale}
              width={8 * invScale}
              height={8 * invScale}
              fill="none"
              stroke="#0284c7"
              strokeWidth={1.5 * invScale}
            />
            <g transform={textTransform(sx + 7 * invScale, sy - 6 * invScale)}>
              <text fontSize={8.5 * invScale} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#0369a1">
                {activeSnapResult.kind}
              </text>
            </g>
          </g>
        );
      })()}
    </g>
  );
};
