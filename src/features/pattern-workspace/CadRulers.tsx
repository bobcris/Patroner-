/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  CadCamera,
  CadCoordinateProjection,
  generateRulerTicks,
  worldCmToScreen
} from './cad-math';
import type { RenderPoint2D } from './contracts/pattern-render-artifact';
import { useOptionalPatternAtelierCursor } from './PatternAtelierViewContext';

export const RULER_THICKNESS_PX = 24;

export interface CadRulersProps {
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  readonly camera: CadCamera;
  readonly projection: CadCoordinateProjection;
  readonly cursorCm?: RenderPoint2D | null;
}

const CadRulerCursorLine: React.FC<{
  readonly axis: 'x' | 'y';
  readonly viewportLimitPx: number;
  readonly camera: CadCamera;
  readonly projection: CadCoordinateProjection;
  readonly fallbackCursorCm?: RenderPoint2D | null;
}> = React.memo(({ axis, viewportLimitPx, camera, projection, fallbackCursorCm }) => {
  const contextCursorCm = useOptionalPatternAtelierCursor();
  const effectiveCursor = contextCursorCm ?? fallbackCursorCm ?? null;
  if (!effectiveCursor) return null;
  const screen = worldCmToScreen(effectiveCursor, camera, projection);
  if (axis === 'x') {
    if (screen.x < 0 || screen.x > viewportLimitPx) return null;
    return (
      <line
        x1={screen.x}
        y1={0}
        x2={screen.x}
        y2={RULER_THICKNESS_PX}
        stroke="#2563eb"
        strokeWidth={1.5}
      />
    );
  }
  if (screen.y < 0 || screen.y > viewportLimitPx) return null;
  return (
    <line
      x1={0}
      y1={screen.y}
      x2={RULER_THICKNESS_PX}
      y2={screen.y}
      stroke="#2563eb"
      strokeWidth={1.5}
    />
  );
});

CadRulerCursorLine.displayName = 'CadRulerCursorLine';

/**
 * Synchronized horizontal and vertical centimeter rulers for the Pattern Atelier CAD canvas.
 * Tick positions are derived directly from `generateRulerTicks` in `cad-math.ts`.
 */
export const CadRulers: React.FC<CadRulersProps> = React.memo(
  ({ viewportWidthPx, viewportHeightPx, camera, projection, cursorCm }) => {
    const xTicks = useMemo(
      () => generateRulerTicks('x', viewportWidthPx, camera, projection),
      [viewportWidthPx, camera, projection]
    );

    const yTicks = useMemo(
      () => generateRulerTicks('y', viewportHeightPx, camera, projection),
      [viewportHeightPx, camera, projection]
    );

    return (
      <>
        {/* Top-left cm unit corner */}
        <div
          aria-hidden="true"
          data-testid="cad-ruler-corner"
          className="absolute top-0 left-0 z-20 flex items-center justify-center bg-[#EAE7E0] border-r border-b border-neutral-300 text-[9px] font-mono font-semibold text-neutral-600 select-none"
          style={{ width: RULER_THICKNESS_PX, height: RULER_THICKNESS_PX }}
        >
          cm
        </div>

        {/* Horizontal Top Ruler */}
        <div
          aria-hidden="true"
          data-testid="cad-ruler-horizontal"
          className="absolute top-0 right-0 z-10 bg-[#F3F1EC] border-b border-neutral-300 overflow-hidden select-none pointer-events-none"
          style={{ left: RULER_THICKNESS_PX, height: RULER_THICKNESS_PX }}
        >
          <svg
            width={Math.max(1, viewportWidthPx)}
            height={RULER_THICKNESS_PX}
            className="block"
          >
            {xTicks.map(tick => (
              <g key={`rx-${tick.valueCm}`}>
                <line
                  x1={tick.screenPx}
                  y1={tick.isMajor ? 7 : 16}
                  x2={tick.screenPx}
                  y2={RULER_THICKNESS_PX}
                  stroke={tick.isMajor ? '#52525b' : '#a1a1aa'}
                  strokeWidth={tick.isMajor ? 1 : 0.75}
                />
                {tick.isMajor && tick.label !== undefined && (
                  <text
                    x={tick.screenPx + 3}
                    y={11}
                    fontSize="9"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fill="#3f3f46"
                  >
                    {tick.label}
                  </text>
                )}
              </g>
            ))}
            <CadRulerCursorLine
              axis="x"
              viewportLimitPx={viewportWidthPx}
              camera={camera}
              projection={projection}
              fallbackCursorCm={cursorCm}
            />
          </svg>
        </div>

        {/* Vertical Left Ruler */}
        <div
          aria-hidden="true"
          data-testid="cad-ruler-vertical"
          className="absolute bottom-0 left-0 z-10 bg-[#F3F1EC] border-r border-neutral-300 overflow-hidden select-none pointer-events-none"
          style={{ top: RULER_THICKNESS_PX, width: RULER_THICKNESS_PX }}
        >
          <svg
            width={RULER_THICKNESS_PX}
            height={Math.max(1, viewportHeightPx)}
            className="block"
          >
            {yTicks.map(tick => (
              <g key={`ry-${tick.valueCm}`}>
                <line
                  x1={tick.isMajor ? 7 : 16}
                  y1={tick.screenPx}
                  x2={RULER_THICKNESS_PX}
                  y2={tick.screenPx}
                  stroke={tick.isMajor ? '#52525b' : '#a1a1aa'}
                  strokeWidth={tick.isMajor ? 1 : 0.75}
                />
                {tick.isMajor && tick.label !== undefined && (
                  <text
                    x={10}
                    y={tick.screenPx + 3}
                    fontSize="9"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fill="#3f3f46"
                    transform={`rotate(-90 10 ${tick.screenPx + 3})`}
                    textAnchor="end"
                  >
                    {tick.label}
                  </text>
                )}
              </g>
            ))}
            <CadRulerCursorLine
              axis="y"
              viewportLimitPx={viewportHeightPx}
              camera={camera}
              projection={projection}
              fallbackCursorCm={cursorCm}
            />
          </svg>
        </div>
      </>
    );
  }
);

CadRulers.displayName = 'CadRulers';
