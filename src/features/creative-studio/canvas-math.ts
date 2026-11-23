/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AlignmentAxis,
  LayerTransform,
  MAX_LAYER_DIMENSION,
  MIN_CROP_FRACTION,
  MIN_LAYER_DIMENSION,
  NormalizedCropRect,
  StudioCanvasCamera,
  StudioLayer
} from './types';

/**
 * C6 — Pure Canvas Mathematics Engine for Creative Studio
 *
 * Coordinate Model:
 *   World coordinates (wx, wy) represent unscaled board pixels at zoom = 1.0.
 *   Screen coordinates (sx, sy) are relative to the canvas viewport container top-left:
 *     sx = wx * zoom + panX
 *     sy = wy * zoom + panY
 *     wx = (sx - panX) / zoom
 *     wy = (sy - panY) / zoom
 *
 * All outputs pass through roundCoord() (3 decimal places = 0.001px) to prevent
 * cumulative IEEE-754 floating-point drift across repeated drag/zoom/group transforms.
 */

export const MIN_STUDIO_ZOOM = 0.2;
export const MAX_STUDIO_ZOOM = 4.0;
export const DEFAULT_SNAP_THRESHOLD_SCREEN_PX = 8;

export interface Point2D {
  x: number;
  y: number;
}

export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
  sourceLayerId: string | 'grid';
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface WorldResolvedTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
  centerX: number;
  centerY: number;
}

export function roundCoord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function normalizeAngleDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let normalized = ((deg + 180) % 360 + 360) % 360 - 180;
  if (normalized === 180) normalized = -180;
  return roundCoord(normalized);
}

export function clampStudioZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return roundCoord(Math.min(MAX_STUDIO_ZOOM, Math.max(MIN_STUDIO_ZOOM, zoom)));
}

export function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 1;
  return roundCoord(Math.min(1, Math.max(0, opacity)));
}

export function clampTransform(transform: LayerTransform): LayerTransform {
  const width = Number.isFinite(transform.width)
    ? Math.min(MAX_LAYER_DIMENSION, Math.max(MIN_LAYER_DIMENSION, transform.width))
    : MIN_LAYER_DIMENSION;
  const height = Number.isFinite(transform.height)
    ? Math.min(MAX_LAYER_DIMENSION, Math.max(MIN_LAYER_DIMENSION, transform.height))
    : MIN_LAYER_DIMENSION;
  const scaleX = Number.isFinite(transform.scaleX) && Math.abs(transform.scaleX) >= 0.1
    ? Math.min(20, Math.max(-20, transform.scaleX))
    : 1;
  const scaleY = Number.isFinite(transform.scaleY) && Math.abs(transform.scaleY) >= 0.1
    ? Math.min(20, Math.max(-20, transform.scaleY))
    : 1;

  return {
    x: roundCoord(Number.isFinite(transform.x) ? transform.x : 0),
    y: roundCoord(Number.isFinite(transform.y) ? transform.y : 0),
    width: roundCoord(width),
    height: roundCoord(height),
    rotationDeg: normalizeAngleDeg(transform.rotationDeg),
    scaleX: roundCoord(scaleX),
    scaleY: roundCoord(scaleY)
  };
}

export function worldToScreen(point: Point2D, camera: StudioCanvasCamera): Point2D {
  const z = clampStudioZoom(camera.zoom);
  return {
    x: roundCoord(point.x * z + camera.panX),
    y: roundCoord(point.y * z + camera.panY)
  };
}

export function screenToWorld(point: Point2D, camera: StudioCanvasCamera): Point2D {
  const z = clampStudioZoom(camera.zoom);
  return {
    x: roundCoord((point.x - camera.panX) / z),
    y: roundCoord((point.y - camera.panY) / z)
  };
}

/**
 * Computes a new camera zoomed to targetZoom while keeping the world point under
 * anchorScreen fixed at anchorScreen.
 */
export function zoomAtScreenPoint(
  camera: StudioCanvasCamera,
  targetZoom: number,
  anchorScreen: Point2D
): StudioCanvasCamera {
  const prevZoom = clampStudioZoom(camera.zoom);
  const nextZoom = clampStudioZoom(targetZoom);
  if (nextZoom === prevZoom) return { ...camera, zoom: prevZoom };

  const worldUnderCursorX = (anchorScreen.x - camera.panX) / prevZoom;
  const worldUnderCursorY = (anchorScreen.y - camera.panY) / prevZoom;

  return {
    zoom: nextZoom,
    panX: roundCoord(anchorScreen.x - worldUnderCursorX * nextZoom),
    panY: roundCoord(anchorScreen.y - worldUnderCursorY * nextZoom)
  };
}

/**
 * Resolves a layer's effective world-space transform by walking its authoritative
 * parentId chain from root down to the target layer (C1 + C6).
 * Guarded against malformed cycles by a visited set.
 */
export function resolveWorldTransform(
  layerId: string,
  layersById: Record<string, StudioLayer>
): WorldResolvedTransform | null {
  const target = layersById[layerId];
  if (!target) return null;

  const chain: StudioLayer[] = [];
  const visited = new Set<string>();
  let cursor: StudioLayer | undefined = target;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentId ? layersById[cursor.parentId] : undefined;
  }

  let accX = 0;
  let accY = 0;
  let accRotationDeg = 0;
  let accScaleX = 1;
  let accScaleY = 1;

  for (let i = 0; i < chain.length - 1; i++) {
    const parent = chain[i];
    const rad = (accRotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const px = parent.transform.x * accScaleX;
    const py = parent.transform.y * accScaleY;
    accX += px * cos - py * sin;
    accY += px * sin + py * cos;
    accRotationDeg = normalizeAngleDeg(accRotationDeg + parent.transform.rotationDeg);
    accScaleX *= parent.transform.scaleX;
    accScaleY *= parent.transform.scaleY;
  }

  const rad = (accRotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = target.transform.x * accScaleX;
  const ly = target.transform.y * accScaleY;
  const worldX = roundCoord(accX + lx * cos - ly * sin);
  const worldY = roundCoord(accY + lx * sin + ly * cos);
  const width = roundCoord(target.transform.width * Math.abs(accScaleX));
  const height = roundCoord(target.transform.height * Math.abs(accScaleY));
  const rotationDeg = normalizeAngleDeg(accRotationDeg + target.transform.rotationDeg);
  const scaleX = roundCoord(accScaleX * target.transform.scaleX);
  const scaleY = roundCoord(accScaleY * target.transform.scaleY);

  // Center of rotated rectangle starting at (worldX, worldY) rotated around its own center
  const centerX = roundCoord(worldX + width / 2);
  const centerY = roundCoord(worldY + height / 2);

  return {
    x: worldX,
    y: worldY,
    width,
    height,
    rotationDeg,
    scaleX,
    scaleY,
    centerX,
    centerY
  };
}

/**
 * Converts a world-space drag delta into the local coordinate space of a layer's parent.
 */
export function worldDeltaToParentLocalDelta(
  worldDelta: Point2D,
  parentId: string | null,
  layersById: Record<string, StudioLayer>
): Point2D {
  if (!parentId || !layersById[parentId]) {
    return { x: roundCoord(worldDelta.x), y: roundCoord(worldDelta.y) };
  }
  const parentWorld = resolveWorldTransform(parentId, layersById);
  if (!parentWorld) {
    return { x: roundCoord(worldDelta.x), y: roundCoord(worldDelta.y) };
  }
  const rad = (-parentWorld.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = worldDelta.x * cos - worldDelta.y * sin;
  const ry = worldDelta.x * sin + worldDelta.y * cos;
  const sx = Math.abs(parentWorld.scaleX) < 1e-6 ? 1 : parentWorld.scaleX;
  const sy = Math.abs(parentWorld.scaleY) < 1e-6 ? 1 : parentWorld.scaleY;
  return {
    x: roundCoord(rx / sx),
    y: roundCoord(ry / sy)
  };
}

/**
 * Computes the 4 world-space corners of a rectangle rotated around its center.
 */
export function getRotatedCorners(transform: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
}): [Point2D, Point2D, Point2D, Point2D] {
  const cx = transform.x + transform.width / 2;
  const cy = transform.y + transform.height / 2;
  const hw = transform.width / 2;
  const hh = transform.height / 2;
  const rad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotate = (lx: number, ly: number): Point2D => ({
    x: roundCoord(cx + lx * cos - ly * sin),
    y: roundCoord(cy + lx * sin + ly * cos)
  });

  return [
    rotate(-hw, -hh),
    rotate(hw, -hh),
    rotate(hw, hh),
    rotate(-hw, hh)
  ];
}

/**
 * Computes the axis-aligned bounding box (AABB) enclosing a rotated rectangle.
 */
export function getRotatedAabb(transform: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
}): Rect2D {
  const corners = getRotatedCorners(transform);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of corners) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  return {
    x: roundCoord(minX),
    y: roundCoord(minY),
    width: roundCoord(maxX - minX),
    height: roundCoord(maxY - minY)
  };
}

/**
 * Computes the union AABB of multiple rects.
 */
export function getUnionRect(rects: readonly Rect2D[]): Rect2D | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return {
    x: roundCoord(minX),
    y: roundCoord(minY),
    width: roundCoord(maxX - minX),
    height: roundCoord(maxY - minY)
  };
}

/**
 * Rotation-aware point-in-rectangle hit test in world coordinates.
 */
export function isPointInRotatedRect(
  worldPoint: Point2D,
  transform: { x: number; y: number; width: number; height: number; rotationDeg: number }
): boolean {
  const cx = transform.x + transform.width / 2;
  const cy = transform.y + transform.height / 2;
  const dx = worldPoint.x - cx;
  const dy = worldPoint.y - cy;
  const rad = (-transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return (
    Math.abs(localX) <= transform.width / 2 &&
    Math.abs(localY) <= transform.height / 2
  );
}

export function rectsIntersect(a: Rect2D, b: Rect2D): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/**
 * Returns the topmost visible, unlocked leaf layer hit at worldPoint given bottom-to-top render order.
 */
export function hitTestTopmostLayer(
  worldPoint: Point2D,
  orderedLayersBottomToTop: readonly StudioLayer[],
  layersById: Record<string, StudioLayer>
): StudioLayer | null {
  for (let i = orderedLayersBottomToTop.length - 1; i >= 0; i--) {
    const layer = orderedLayersBottomToTop[i];
    if (!layer.visible || layer.locked || layer.type === 'group') continue;
    const world = resolveWorldTransform(layer.id, layersById);
    if (!world) continue;
    if (isPointInRotatedRect(worldPoint, world)) {
      return layer;
    }
  }
  return null;
}

/**
 * Computes smart edge/center snapping plus optional grid snapping.
 * Threshold is specified in screen pixels and converted cleanly to world units by dividing by zoom.
 */
export function computeSmartSnap(options: {
  movingAabb: Rect2D;
  targetAabbs: ReadonlyArray<{ id: string; rect: Rect2D }>;
  zoom: number;
  screenThresholdPx?: number;
  gridSizeWorld?: number;
}): SnapResult {
  const z = clampStudioZoom(options.zoom);
  const thresholdWorld = (options.screenThresholdPx ?? DEFAULT_SNAP_THRESHOLD_SCREEN_PX) / z;
  const m = options.movingAabb;

  const movingXs = [m.x, m.x + m.width / 2, m.x + m.width];
  const movingYs = [m.y, m.y + m.height / 2, m.y + m.height];

  let bestDx: number | null = null;
  let bestAbsDx = thresholdWorld + 1e-9;
  let bestXGuide: SnapGuide | null = null;

  let bestDy: number | null = null;
  let bestAbsDy = thresholdWorld + 1e-9;
  let bestYGuide: SnapGuide | null = null;

  for (const target of options.targetAabbs) {
    const t = target.rect;
    const targetXs = [t.x, t.x + t.width / 2, t.x + t.width];
    const targetYs = [t.y, t.y + t.height / 2, t.y + t.height];

    for (const mx of movingXs) {
      for (const tx of targetXs) {
        const diff = tx - mx;
        const absDiff = Math.abs(diff);
        if (absDiff <= thresholdWorld && absDiff < bestAbsDx) {
          bestAbsDx = absDiff;
          bestDx = diff;
          bestXGuide = {
            orientation: 'vertical',
            position: roundCoord(tx),
            start: roundCoord(Math.min(m.y, t.y) - 16),
            end: roundCoord(Math.max(m.y + m.height, t.y + t.height) + 16),
            sourceLayerId: target.id
          };
        }
      }
    }

    for (const my of movingYs) {
      for (const ty of targetYs) {
        const diff = ty - my;
        const absDiff = Math.abs(diff);
        if (absDiff <= thresholdWorld && absDiff < bestAbsDy) {
          bestAbsDy = absDiff;
          bestDy = diff;
          bestYGuide = {
            orientation: 'horizontal',
            position: roundCoord(ty),
            start: roundCoord(Math.min(m.x, t.x) - 16),
            end: roundCoord(Math.max(m.x + m.width, t.x + t.width) + 16),
            sourceLayerId: target.id
          };
        }
      }
    }
  }

  // Optional grid snap fallback if no object guide snapped on that axis
  if (options.gridSizeWorld && options.gridSizeWorld > 0) {
    const g = options.gridSizeWorld;
    if (bestDx === null) {
      const snappedX = Math.round(m.x / g) * g;
      const diff = snappedX - m.x;
      if (Math.abs(diff) <= thresholdWorld) {
        bestDx = diff;
      }
    }
    if (bestDy === null) {
      const snappedY = Math.round(m.y / g) * g;
      const diff = snappedY - m.y;
      if (Math.abs(diff) <= thresholdWorld) {
        bestDy = diff;
      }
    }
  }

  const guides: SnapGuide[] = [];
  if (bestXGuide) guides.push(bestXGuide);
  if (bestYGuide) guides.push(bestYGuide);

  return {
    dx: roundCoord(bestDx ?? 0),
    dy: roundCoord(bestDy ?? 0),
    guides
  };
}

/**
 * Computes world-space translation deltas for aligning or distributing a set of boxes.
 * Alignment requires >= 2 items; distribution requires >= 3 items.
 */
export function computeAlignmentDeltas(
  items: ReadonlyArray<{ id: string; rect: Rect2D }>,
  axis: AlignmentAxis
): Record<string, Point2D> {
  const deltas: Record<string, Point2D> = {};
  if (items.length < 2) return deltas;

  const union = getUnionRect(items.map(i => i.rect));
  if (!union) return deltas;

  if (axis === 'distribute-horizontal') {
    if (items.length < 3) return deltas;
    const sorted = [...items].sort((a, b) => a.rect.x - b.rect.x);
    const totalItemWidth = sorted.reduce((sum, item) => sum + item.rect.width, 0);
    const first = sorted[0].rect;
    const last = sorted[sorted.length - 1].rect;
    const totalSpan = last.x + last.width - first.x;
    const gap = (totalSpan - totalItemWidth) / (sorted.length - 1);
    let cursorX = first.x;
    for (const item of sorted) {
      deltas[item.id] = { x: roundCoord(cursorX - item.rect.x), y: 0 };
      cursorX += item.rect.width + gap;
    }
    return deltas;
  }

  if (axis === 'distribute-vertical') {
    if (items.length < 3) return deltas;
    const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y);
    const totalItemHeight = sorted.reduce((sum, item) => sum + item.rect.height, 0);
    const first = sorted[0].rect;
    const last = sorted[sorted.length - 1].rect;
    const totalSpan = last.y + last.height - first.y;
    const gap = (totalSpan - totalItemHeight) / (sorted.length - 1);
    let cursorY = first.y;
    for (const item of sorted) {
      deltas[item.id] = { x: 0, y: roundCoord(cursorY - item.rect.y) };
      cursorY += item.rect.height + gap;
    }
    return deltas;
  }

  const unionCenterX = union.x + union.width / 2;
  const unionCenterY = union.y + union.height / 2;

  for (const item of items) {
    let dx = 0;
    let dy = 0;
    switch (axis) {
      case 'align-left':
        dx = union.x - item.rect.x;
        break;
      case 'align-center-x':
        dx = unionCenterX - (item.rect.x + item.rect.width / 2);
        break;
      case 'align-right':
        dx = union.x + union.width - (item.rect.x + item.rect.width);
        break;
      case 'align-top':
        dy = union.y - item.rect.y;
        break;
      case 'align-center-y':
        dy = unionCenterY - (item.rect.y + item.rect.height / 2);
        break;
      case 'align-bottom':
        dy = union.y + union.height - (item.rect.y + item.rect.height);
        break;
    }
    deltas[item.id] = { x: roundCoord(dx), y: roundCoord(dy) };
  }

  return deltas;
}

/**
 * Normalizes a non-destructive crop rectangle strictly into [0, 1] with minimum
 * MIN_CROP_FRACTION width/height and guaranteed x + width <= 1, y + height <= 1.
 */
export function normalizeCropRect(crop: Partial<NormalizedCropRect>): NormalizedCropRect {
  const rawX = Number.isFinite(crop.x) ? (crop.x as number) : 0;
  const rawY = Number.isFinite(crop.y) ? (crop.y as number) : 0;
  const rawW = Number.isFinite(crop.width) ? (crop.width as number) : 1;
  const rawH = Number.isFinite(crop.height) ? (crop.height as number) : 1;

  const clampedW = Math.min(1, Math.max(MIN_CROP_FRACTION, rawW));
  const clampedH = Math.min(1, Math.max(MIN_CROP_FRACTION, rawH));
  const clampedX = Math.min(1 - clampedW, Math.max(0, rawX));
  const clampedY = Math.min(1 - clampedH, Math.max(0, rawY));

  const x = roundCoord(clampedX);
  const y = roundCoord(clampedY);
  const width = roundCoord(Math.min(1 - x, Math.max(MIN_CROP_FRACTION, clampedW)));
  const height = roundCoord(Math.min(1 - y, Math.max(MIN_CROP_FRACTION, clampedH)));

  return { x, y, width, height };
}

/**
 * Computes a camera that frames all given bounding rects cleanly inside viewportSize.
 */
export function computeFitCamera(
  rects: readonly Rect2D[],
  viewportWidth: number,
  viewportHeight: number,
  paddingPx: number = 64
): StudioCanvasCamera {
  const union = getUnionRect(rects);
  if (!union || viewportWidth <= 0 || viewportHeight <= 0) {
    return { zoom: 1, panX: 48, panY: 48 };
  }
  const availW = Math.max(120, viewportWidth - paddingPx * 2);
  const availH = Math.max(120, viewportHeight - paddingPx * 2);
  const zoom = clampStudioZoom(
    Math.min(availW / Math.max(1, union.width), availH / Math.max(1, union.height), 1.25)
  );
  const panX = roundCoord((viewportWidth - union.width * zoom) / 2 - union.x * zoom);
  const panY = roundCoord((viewportHeight - union.height * zoom) / 2 - union.y * zoom);
  return { zoom, panX, panY };
}
