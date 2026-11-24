/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CoordinateYAxisDirection,
  PatternPieceRenderModel,
  RenderBoundingBoxCm,
  RenderPoint2D
} from './contracts/pattern-render-artifact';

/**
 * UX-2.3.1 — Pure Centimeter Coordinate Mathematics Engine for Pattern Atelier
 *
 * Framework-agnostic viewport math (zero DOM / React / Vite dependencies).
 *
 * Coordinate Conventions:
 * - World coordinates are strictly in centimeters (`cm`).
 * - At `zoom = 1.0`, `1 cm = BASE_PX_PER_CM` CSS pixels (`10 px`).
 * - `yAxisDirection`:
 *   - `'svg-y-down'` (C0-Legacy prototype): +Y points downward on screen.
 *       screenX = worldX * scale + panX
 *       screenY = worldY * scale + panY
 *   - `'cartesian-y-up'` (Python contracts.py right-handed Cartesian): +Y points upward on screen.
 *       screenX = worldX * scale + panX
 *       screenY = -worldY * scale + panY
 *
 * Note: This module performs viewport projection, camera framing, and ruler/grid
 * layout only. It NEVER computes authoritative pattern geometry, offsets, arc lengths,
 * or grading curves (ADR-001).
 */

export const BASE_PX_PER_CM = 10;
export const MIN_CAD_ZOOM = 0.15;
export const MAX_CAD_ZOOM = 12.0;

export interface CadCamera {
  readonly zoom: number;
  readonly panX: number; // screen px offset of world origin (0 cm, 0 cm)
  readonly panY: number; // screen px offset of world origin (0 cm, 0 cm)
}

export interface CadCoordinateProjection {
  readonly yAxisDirection: CoordinateYAxisDirection;
  readonly basePxPerCm?: number;
}

export interface CadRectCm {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface AdaptiveGridSpacingCm {
  readonly minorCm: number;
  readonly majorCm: number;
  readonly minorPx: number;
  readonly majorPx: number;
}

export interface RulerTick {
  readonly valueCm: number;
  readonly screenPx: number;
  readonly isMajor: boolean;
  readonly label?: string;
}

export interface PieceTablePlacementCm {
  readonly pieceId: string;
  readonly offsetXCm: number;
  readonly offsetYCm: number;
  readonly boundsCm: CadRectCm;
}

export function roundCad(value: number, decimals: number = 6): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function clampCadZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1.0;
  return roundCad(Math.min(MAX_CAD_ZOOM, Math.max(MIN_CAD_ZOOM, zoom)), 4);
}

export function getPixelsPerCm(
  zoom: number,
  basePxPerCm: number = BASE_PX_PER_CM
): number {
  const safeBase = Number.isFinite(basePxPerCm) && basePxPerCm > 0 ? basePxPerCm : BASE_PX_PER_CM;
  return clampCadZoom(zoom) * safeBase;
}

export function worldCmToScreen(
  pointCm: RenderPoint2D,
  camera: CadCamera,
  projection: CadCoordinateProjection
): RenderPoint2D {
  const scale = getPixelsPerCm(camera.zoom, projection.basePxPerCm);
  const ySign = projection.yAxisDirection === 'cartesian-y-up' ? -1 : 1;
  return {
    x: roundCad(pointCm.x * scale + camera.panX),
    y: roundCad(pointCm.y * ySign * scale + camera.panY)
  };
}

export function screenToWorldCm(
  pointPx: RenderPoint2D,
  camera: CadCamera,
  projection: CadCoordinateProjection
): RenderPoint2D {
  const scale = getPixelsPerCm(camera.zoom, projection.basePxPerCm);
  const ySign = projection.yAxisDirection === 'cartesian-y-up' ? -1 : 1;
  return {
    x: roundCad((pointPx.x - camera.panX) / scale),
    y: roundCad(((pointPx.y - camera.panY) / scale) * ySign)
  };
}

/**
 * Computes a new camera zoomed to `targetZoom` while preserving the exact world
 * centimeter point directly under `anchorScreenPx`.
 */
export function zoomCadAtScreenPoint(
  camera: CadCamera,
  targetZoom: number,
  anchorScreenPx: RenderPoint2D,
  projection: CadCoordinateProjection
): CadCamera {
  const prevZoom = clampCadZoom(camera.zoom);
  const nextZoom = clampCadZoom(targetZoom);
  if (nextZoom === prevZoom) {
    return { zoom: prevZoom, panX: roundCad(camera.panX), panY: roundCad(camera.panY) };
  }

  const worldAnchor = screenToWorldCm(anchorScreenPx, { ...camera, zoom: prevZoom }, projection);
  const nextScale = getPixelsPerCm(nextZoom, projection.basePxPerCm);
  const ySign = projection.yAxisDirection === 'cartesian-y-up' ? -1 : 1;

  return {
    zoom: nextZoom,
    panX: roundCad(anchorScreenPx.x - worldAnchor.x * nextScale),
    panY: roundCad(anchorScreenPx.y - worldAnchor.y * ySign * nextScale)
  };
}

/**
 * Translates camera pan by a screen-space pointer delta (in CSS pixels).
 */
export function panCadByScreenDelta(
  camera: CadCamera,
  dxPx: number,
  dyPx: number
): CadCamera {
  const safeDx = Number.isFinite(dxPx) ? dxPx : 0;
  const safeDy = Number.isFinite(dyPx) ? dyPx : 0;
  return {
    zoom: clampCadZoom(camera.zoom),
    panX: roundCad(camera.panX + safeDx),
    panY: roundCad(camera.panY + safeDy)
  };
}

/**
 * Computes a camera that centers and fits `boundsCm` cleanly inside a viewport
 * of size `viewportWidthPx × viewportHeightPx` with `paddingPx` margin on all sides.
 */
export function computeFitCameraCm(
  boundsCm: CadRectCm | null,
  viewportWidthPx: number,
  viewportHeightPx: number,
  projection: CadCoordinateProjection,
  paddingPx: number = 48
): CadCamera {
  if (
    !boundsCm ||
    !Number.isFinite(viewportWidthPx) ||
    !Number.isFinite(viewportHeightPx) ||
    viewportWidthPx <= 0 ||
    viewportHeightPx <= 0
  ) {
    return { zoom: 1.0, panX: 48, panY: 48 };
  }

  const basePx = projection.basePxPerCm ?? BASE_PX_PER_CM;
  const widthCm = Math.max(0.1, boundsCm.maxX - boundsCm.minX);
  const heightCm = Math.max(0.1, boundsCm.maxY - boundsCm.minY);
  const availW = Math.max(80, viewportWidthPx - paddingPx * 2);
  const availH = Math.max(80, viewportHeightPx - paddingPx * 2);

  const rawZoom = Math.min(availW / (widthCm * basePx), availH / (heightCm * basePx));
  const zoom = clampCadZoom(rawZoom);
  const scale = getPixelsPerCm(zoom, basePx);

  const centerWorldX = (boundsCm.minX + boundsCm.maxX) / 2;
  const centerWorldY = (boundsCm.minY + boundsCm.maxY) / 2;
  const ySign = projection.yAxisDirection === 'cartesian-y-up' ? -1 : 1;

  return {
    zoom,
    panX: roundCad(viewportWidthPx / 2 - centerWorldX * scale),
    panY: roundCad(viewportHeightPx / 2 - centerWorldY * ySign * scale)
  };
}

/**
 * Deterministic side-by-side cutting-table placement in cm so pieces never overlap,
 * replacing hardcoded 3-column pixel offsets.
 */
export function computeAutoTableLayoutCm(
  pieces: readonly Pick<PatternPieceRenderModel, 'pieceId' | 'boundingBoxCm'>[],
  gapCm: number = 8
): {
  readonly placements: readonly PieceTablePlacementCm[];
  readonly unionBoundsCm: CadRectCm | null;
} {
  if (pieces.length === 0) {
    return { placements: [], unionBoundsCm: null };
  }

  const safeGap = Number.isFinite(gapCm) && gapCm >= 0 ? gapCm : 8;
  const placements: PieceTablePlacementCm[] = [];
  let cursorX = 0;

  let uMinX = Infinity;
  let uMinY = Infinity;
  let uMaxX = -Infinity;
  let uMaxY = -Infinity;

  for (const piece of pieces) {
    const bb: RenderBoundingBoxCm = piece.boundingBoxCm;
    const widthCm = Math.max(1, bb.widthCm || bb.maxX - bb.minX);
    const heightCm = Math.max(1, bb.heightCm || bb.maxY - bb.minY);

    // Shift piece so its local minX aligns cleanly to cursorX and local minY aligns to 0
    const offsetXCm = roundCad(cursorX - bb.minX);
    const offsetYCm = roundCad(-bb.minY);

    const boundsCm: CadRectCm = {
      minX: roundCad(cursorX),
      minY: 0,
      maxX: roundCad(cursorX + widthCm),
      maxY: roundCad(heightCm)
    };

    placements.push({
      pieceId: piece.pieceId,
      offsetXCm,
      offsetYCm,
      boundsCm
    });

    if (boundsCm.minX < uMinX) uMinX = boundsCm.minX;
    if (boundsCm.minY < uMinY) uMinY = boundsCm.minY;
    if (boundsCm.maxX > uMaxX) uMaxX = boundsCm.maxX;
    if (boundsCm.maxY > uMaxY) uMaxY = boundsCm.maxY;

    cursorX = roundCad(cursorX + widthCm + safeGap);
  }

  return {
    placements,
    unionBoundsCm: {
      minX: uMinX,
      minY: uMinY,
      maxX: uMaxX,
      maxY: uMaxY
    }
  };
}

const GRID_TIERS_CM: ReadonlyArray<{ readonly minorCm: number; readonly majorCm: number }> = [
  { minorCm: 0.2, majorCm: 1 },
  { minorCm: 0.5, majorCm: 2 },
  { minorCm: 1, majorCm: 5 },
  { minorCm: 2, majorCm: 10 },
  { minorCm: 5, majorCm: 20 },
  { minorCm: 10, majorCm: 50 },
  { minorCm: 20, majorCm: 100 }
];

/**
 * Selects human-readable minor/major centimeter grid intervals so minor grid lines
 * stay visually legible (`>= minMinorScreenPx`) across the full `0.15x..12.0x` zoom range.
 */
export function computeAdaptiveGridSpacingCm(
  zoom: number,
  basePxPerCm: number = BASE_PX_PER_CM,
  minMinorScreenPx: number = 14
): AdaptiveGridSpacingCm {
  const pxPerCm = getPixelsPerCm(zoom, basePxPerCm);
  for (const tier of GRID_TIERS_CM) {
    const minorPx = tier.minorCm * pxPerCm;
    if (minorPx >= minMinorScreenPx) {
      return {
        minorCm: tier.minorCm,
        majorCm: tier.majorCm,
        minorPx: roundCad(minorPx, 3),
        majorPx: roundCad(tier.majorCm * pxPerCm, 3)
      };
    }
  }
  const last = GRID_TIERS_CM[GRID_TIERS_CM.length - 1];
  return {
    minorCm: last.minorCm,
    majorCm: last.majorCm,
    minorPx: roundCad(last.minorCm * pxPerCm, 3),
    majorPx: roundCad(last.majorCm * pxPerCm, 3)
  };
}

function formatRulerLabelCm(valueCm: number): string {
  const rounded = roundCad(valueCm, 2);
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

/**
 * Generates synchronized centimeter ticks for the horizontal (`'x'`) or vertical (`'y'`) ruler.
 * Every tick's `screenPx` matches `worldCmToScreen` exactly.
 */
export function generateRulerTicks(
  axis: 'x' | 'y',
  viewportLengthPx: number,
  camera: CadCamera,
  projection: CadCoordinateProjection
): readonly RulerTick[] {
  if (!Number.isFinite(viewportLengthPx) || viewportLengthPx <= 0) return [];

  const spacing = computeAdaptiveGridSpacingCm(camera.zoom, projection.basePxPerCm, 12);
  const startWorld = screenToWorldCm(
    axis === 'x' ? { x: 0, y: 0 } : { x: 0, y: 0 },
    camera,
    projection
  );
  const endWorld = screenToWorldCm(
    axis === 'x' ? { x: viewportLengthPx, y: 0 } : { x: 0, y: viewportLengthPx },
    camera,
    projection
  );

  const worldMin = Math.min(axis === 'x' ? startWorld.x : startWorld.y, axis === 'x' ? endWorld.x : endWorld.y);
  const worldMax = Math.max(axis === 'x' ? startWorld.x : startWorld.y, axis === 'x' ? endWorld.x : endWorld.y);

  const step = spacing.minorCm;
  const firstIdx = Math.floor(worldMin / step) - 1;
  const lastIdx = Math.ceil(worldMax / step) + 1;
  const maxTicks = 600;
  const clampedLastIdx = Math.min(lastIdx, firstIdx + maxTicks);
  const majorMultiple = Math.max(1, Math.round(spacing.majorCm / spacing.minorCm));

  const ticks: RulerTick[] = [];
  for (let idx = firstIdx; idx <= clampedLastIdx; idx++) {
    const valueCm = roundCad(idx * step, 4);
    const screenPt = worldCmToScreen(
      axis === 'x' ? { x: valueCm, y: 0 } : { x: 0, y: valueCm },
      camera,
      projection
    );
    const screenPx = axis === 'x' ? screenPt.x : screenPt.y;
    if (screenPx < -2 || screenPx > viewportLengthPx + 2) continue;

    const isMajor = ((idx % majorMultiple) + majorMultiple) % majorMultiple === 0;
    ticks.push({
      valueCm,
      screenPx: roundCad(screenPx, 2),
      isMajor,
      label: isMajor ? formatRulerLabelCm(valueCm) : undefined
    });
  }

  return ticks;
}
