/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A3 Canvas Overlay — Dart Pivot Apex Crosshair, Backed-Off Sewing Apex,
 * Intake Angle Arc, Leg Vectors, Fold Direction Indicator & Slash Transfer Preview.
 *
 * Strictly read-only SVG presentation (`pointer-events-none`).
 */

import React from 'react';
import type { PatternPieceRenderModel, RenderPoint2D } from './contracts/pattern-render-artifact';
import type { ExtendedPieceEngineeringOverlay } from './contracts/wp-a-shared-contracts';

export interface PatternDartOverlayProps {
  readonly visiblePieces: readonly PatternPieceRenderModel[];
  readonly pieceEngineering: Readonly<Record<string, ExtendedPieceEngineeringOverlay>>;
  readonly getEffectiveOffset: (pieceId: string) => { offsetXCm: number; offsetYCm: number };
  readonly selectedDartId: string | null;
  readonly transferPreview?: {
    readonly pieceId: string;
    readonly pivotApexCm: RenderPoint2D;
    readonly targetPointCm: RenderPoint2D;
  } | null;
  readonly visible: boolean;
  readonly invScale: number;
  readonly isYUp: boolean;
}

export const PatternDartOverlay: React.FC<PatternDartOverlayProps> = ({
  visiblePieces,
  pieceEngineering,
  getEffectiveOffset,
  selectedDartId,
  transferPreview,
  visible,
  invScale,
  isYUp
}) => {
  if (!visible) return null;

  const fontSizeCm = 9.5 * invScale;
  const textTransform = (x: number, y: number) =>
    isYUp ? `translate(${x} ${y}) scale(1 -1)` : `translate(${x} ${y})`;

  return (
    <g data-testid="cad-dart-engineering-overlay" className="pointer-events-none">
      {visiblePieces.map((piece) => {
        const eng = pieceEngineering[piece.pieceId];
        if (!eng || eng.proposedDarts.length === 0) return null;
        const off = getEffectiveOffset(piece.pieceId);

        return (
          <g key={`dart-group-${piece.pieceId}`}>
            {eng.proposedDarts.map((dart) => {
              const isSelected = dart.id === selectedDartId;
              const px = off.offsetXCm + dart.pivotApexCm.x;
              const py = off.offsetYCm + dart.pivotApexCm.y;
              const sx = off.offsetXCm + dart.sewingApexCm.x;
              const sy = off.offsetYCm + dart.sewingApexCm.y;
              const lx = off.offsetXCm + dart.legLeftOpeningCm.x;
              const ly = off.offsetYCm + dart.legLeftOpeningCm.y;
              const rx = off.offsetXCm + dart.legRightOpeningCm.x;
              const ry = off.offsetYCm + dart.legRightOpeningCm.y;
              const stroke = dart.isClosed ? '#64748b' : isSelected ? '#db2777' : '#e11d48';
              const intakeDeg = (dart.intakeAngleRad * 180) / Math.PI;

              return (
                <g key={dart.id} data-dart-id={dart.id}>
                  {/* Dart shaded intake wedge */}
                  {!dart.isClosed && (
                    <polygon
                      points={`${sx},${sy} ${lx},${ly} ${rx},${ry}`}
                      fill={isSelected ? 'rgba(219, 39, 119, 0.14)' : 'rgba(225, 29, 72, 0.08)'}
                      stroke="none"
                    />
                  )}

                  {/* Dart leg lines */}
                  <line
                    x1={sx}
                    y1={sy}
                    x2={lx}
                    y2={ly}
                    stroke={stroke}
                    strokeWidth={(isSelected ? 2.2 : 1.5) * invScale}
                    strokeDasharray={dart.isClosed ? `${4 * invScale} ${3 * invScale}` : undefined}
                  />
                  <line
                    x1={sx}
                    y1={sy}
                    x2={rx}
                    y2={ry}
                    stroke={stroke}
                    strokeWidth={(isSelected ? 2.2 : 1.5) * invScale}
                    strokeDasharray={dart.isClosed ? `${4 * invScale} ${3 * invScale}` : undefined}
                  />

                  {/* Backoff connector from true pivot apex to sewing apex */}
                  <line
                    x1={px}
                    y1={py}
                    x2={sx}
                    y2={sy}
                    stroke="#be185d"
                    strokeWidth={1.1 * invScale}
                    strokeDasharray={`${2.5 * invScale} ${2.5 * invScale}`}
                  />

                  {/* True pivot apex crosshair */}
                  <line x1={px - 4.5 * invScale} y1={py} x2={px + 4.5 * invScale} y2={py} stroke="#9d174d" strokeWidth={1.3 * invScale} />
                  <line x1={px} y1={py - 4.5 * invScale} x2={px} y2={py + 4.5 * invScale} stroke="#9d174d" strokeWidth={1.3 * invScale} />
                  <circle cx={px} cy={py} r={3.5 * invScale} fill="none" stroke="#9d174d" strokeWidth={1.2 * invScale} />

                  {/* Backed-off sewing apex drill dot */}
                  <circle cx={sx} cy={sy} r={2.8 * invScale} fill="#ffffff" stroke={stroke} strokeWidth={1.4 * invScale} />

                  {/* Concise intake angle & fold readout */}
                  {(() => {
                    const midOpenX = (lx + rx) * 0.5;
                    const midOpenY = (ly + ry) * 0.5;
                    const labelX = dart.isClosed ? px + 8 * invScale : (sx + midOpenX) * 0.5;
                    const labelY = dart.isClosed ? py + 12 * invScale : (sy + midOpenY) * 0.5;
                    const labelText = `${dart.label} ${intakeDeg.toFixed(1)}°`;
                    const boxW = Math.max(48, labelText.length * 5.8 + 8) * invScale;
                    return (
                      <g transform={textTransform(labelX, labelY)}>
                        <rect
                          x={-boxW * 0.5}
                          y={-fontSizeCm * 1.02}
                          width={boxW}
                          height={fontSizeCm * 1.32}
                          rx={2 * invScale}
                          fill="rgba(255, 255, 255, 0.9)"
                          stroke={stroke}
                          strokeWidth={0.6 * invScale}
                        />
                        <text
                          textAnchor="middle"
                          fontSize={fontSizeCm}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fill={stroke}
                        >
                          {labelText}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Transfer slash-line preview */}
      {transferPreview && (() => {
        const off = getEffectiveOffset(transferPreview.pieceId);
        return (
          <line
            data-testid="cad-dart-transfer-slash-preview"
            x1={off.offsetXCm + transferPreview.pivotApexCm.x}
            y1={off.offsetYCm + transferPreview.pivotApexCm.y}
            x2={off.offsetXCm + transferPreview.targetPointCm.x}
            y2={off.offsetYCm + transferPreview.targetPointCm.y}
            stroke="#db2777"
            strokeWidth={1.8 * invScale}
            strokeDasharray={`${5 * invScale} ${3 * invScale}`}
          />
        );
      })()}
    </g>
  );
};
