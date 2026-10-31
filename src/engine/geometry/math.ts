/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BoundingBox, Point } from '../../types';

export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function midPoint(p1: Point, p2: Point): Point {
  return {
    x: Number(((p1.x + p2.x) / 2).toFixed(2)),
    y: Number(((p1.y + p2.y) / 2).toFixed(2))
  };
}

/**
 * Calculates cubic Bezier curve length using Gaussian numerical integration or subdivision.
 */
export function approximateBezierLength(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  steps = 30
): number {
  let len = 0;
  let prev = p0;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;
    const x =
      inv * inv * inv * p0.x +
      3 * inv * inv * t * p1.x +
      3 * inv * t * t * p2.x +
      t * t * t * p3.x;
    const y =
      inv * inv * inv * p0.y +
      3 * inv * inv * t * p1.y +
      3 * inv * t * t * p2.y +
      t * t * t * p3.y;
    const curr = { x, y };
    len += distance(prev, curr);
    prev = curr;
  }

  return Number(len.toFixed(2));
}

/**
 * Calculates polygon/polyline length.
 */
export function polylineLength(points: Point[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += distance(points[i], points[i + 1]);
  }
  return Number(total.toFixed(2));
}

/**
 * Computes axis-aligned bounding box for a series of coordinates.
 */
export function computeBoundingBox(points: Point[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthCm: 0, heightCm: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    minX: Number(minX.toFixed(2)),
    minY: Number(minY.toFixed(2)),
    maxX: Number(maxX.toFixed(2)),
    maxY: Number(maxY.toFixed(2)),
    widthCm: Number((maxX - minX).toFixed(2)),
    heightCm: Number((maxY - minY).toFixed(2))
  };
}

/**
 * Offsets a simple 2D polygon outward by a specific distance (seam allowance in cm).
 * Computes mitered/normal corners.
 */
export function offsetPolygon(polygon: Point[], offsetCm: number): Point[] {
  if (polygon.length < 3) return polygon;
  const n = polygon.length;
  const offsetPoints: Point[] = [];

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];

    // Vector 1 (prev -> curr)
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const len1 = Math.hypot(v1.x, v1.y) || 1;
    const n1 = { x: -v1.y / len1, y: v1.x / len1 };

    // Vector 2 (curr -> next)
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len2 = Math.hypot(v2.x, v2.y) || 1;
    const n2 = { x: -v2.y / len2, y: v2.x / len2 };

    // Average normal
    const avgNormal = { x: n1.x + n2.x, y: n1.y + n2.y };
    const avgLen = Math.hypot(avgNormal.x, avgNormal.y) || 1;
    const normAvg = { x: avgNormal.x / avgLen, y: avgNormal.y / avgLen };

    // Miter scaling
    const cosAngle = n1.x * normAvg.x + n1.y * normAvg.y;
    const miterLimit = Math.min(Math.max(cosAngle, 0.3), 1.0);
    const d = offsetCm / miterLimit;

    offsetPoints.push({
      x: Number((curr.x + normAvg.x * d).toFixed(2)),
      y: Number((curr.y + normAvg.y * d).toFixed(2))
    });
  }

  return offsetPoints;
}

/**
 * Converts point array to clean SVG Path D string.
 */
export function pointsToSvgPath(points: Point[], close = true): string {
  if (!points || points.length === 0) return '';
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  return close ? `${d} Z` : d;
}
