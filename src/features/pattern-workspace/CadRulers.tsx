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

    const xGeometry = useMemo(() => {
      const majorParts: string[] = [];
      const minorParts: string[] = [];
      const labels: Array<{ readonly key: number; readonly screenPx: number; readonly label: string }> = [];
      for (const tick of xTicks) {
        if (tick.isMajor) {
          majorParts.push(`M${tick.screenPx} 7V${RULER_THICKNESS_PX}`);
          if (tick.label !== undefined) {
            labels.push({ key: tick.valueCm, screenPx: tick.screenPx, label: tick.label });
          }
        } else {
          minorParts.push(`M${tick.screenPx} 16V${RULER_THICKNESS_PX}`);
        }
      }
      return {
        majorD: majorParts.join(' '),
        minorD: minorParts.join(' '),
        labels
      };
    }, [xTicks]);

    const yGeometry = useMemo(() => {
      const majorParts: string[] = [];
      const minorParts: string[] = [];
      const labels: Array<{ readonly key: number; readonly screenPx: number; readonly label: string }> = [];
      for (const tick of yTicks) {
        if (tick.isMajor) {
          majorParts.push(`M7 ${tick.screenPx}H${RULER_THICKNESS_PX}`);
          if (tick.label !== undefined) {
            labels.push({ key: tick.valueCm, screenPx: tick.screenPx, label: tick.label });
          }
        } else {
          minorParts.push(`M16 ${tick.screenPx}H${RULER_THICKNESS_PX}`);
        }
      }
      return {
        majorD: majorParts.join(' '),
        minorD: minorParts.join(' '),
        labels
      };
    }, [yTicks]);

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
            {xGeometry.minorD && (
              <path d={xGeometry.minorD} stroke="#a1a1aa" strokeWidth={0.75} fill="none" />
            )}
            {xGeometry.majorD && (
              <path d={xGeometry.majorD} stroke="#52525b" strokeWidth={1} fill="none" />
            )}
            {xGeometry.labels.map(t => (
              <text
                key={`rx-${t.key}`}
                x={t.screenPx + 3}
                y={11}
                fontSize="9"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill="#3f3f46"
              >
                {t.label}
              </text>
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
            {yGeometry.minorD && (
              <path d={yGeometry.minorD} stroke="#a1a1aa" strokeWidth={0.75} fill="none" />
            )}
            {yGeometry.majorD && (
              <path d={yGeometry.majorD} stroke="#52525b" strokeWidth={1} fill="none" />
            )}
            {yGeometry.labels.map(t => (
              <text
                key={`ry-${t.key}`}
                x={10}
                y={t.screenPx + 3}
                fontSize="9"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill="#3f3f46"
                transform={`rotate(-90 10 ${t.screenPx + 3})`}
                textAnchor="end"
              >
                {t.label}
              </text>
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
