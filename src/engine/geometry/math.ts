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

export function vector(from: Point, to: Point): Point {
  return {
    x: to.x - from.x,
    y: to.y - from.y
  };
}

export function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { x: 0, y: 0 };
  return {
    x: v.x / len,
    y: v.y / len
  };
}

export function dotProduct(v1: Point, v2: Point): number {
  return v1.x * v2.x + v1.y * v2.y;
}

/**
 * Calculates angle in degrees between two 2D vectors in range [0, 180].
 */
export function angleBetweenVectors(v1: Point, v2: Point): number {
  const n1 = normalize(v1);
  const n2 = normalize(v2);
  const dot = Math.max(-1.0, Math.min(1.0, dotProduct(n1, n2)));
  const rad = Math.acos(dot);
  return Number(((rad * 180) / Math.PI).toFixed(2));
}

/**
 * Validates whether two vectors are perpendicular (90 degrees).
 * Returns exact angle and absolute deviation in degrees.
 */
export function checkPerpendicularity(
  v1: Point,
  v2: Point,
  toleranceDegrees = 0.5
): {
  isPerpendicular: boolean;
  measuredAngleDeg: number;
  deviationDeg: number;
} {
  const measuredAngleDeg = angleBetweenVectors(v1, v2);
  const deviationDeg = Number(Math.abs(measuredAngleDeg - 90.0).toFixed(2));
  return {
    isPerpendicular: deviationDeg <= toleranceDegrees,
    measuredAngleDeg,
    deviationDeg
  };
}

/**
 * Computes point on a cubic Bezier curve at parameter t in [0, 1].
 */
export function cubicBezierPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number
): Point {
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
  return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
}

/**
 * Computes first derivative (tangent vector) of a cubic Bezier curve at parameter t.
 */
export function cubicBezierTangent(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number
): Point {
  const inv = 1 - t;
  const dx =
    3 * inv * inv * (p1.x - p0.x) +
    6 * inv * t * (p2.x - p1.x) +
    3 * t * t * (p3.x - p2.x);
  const dy =
    3 * inv * inv * (p1.y - p0.y) +
    6 * inv * t * (p2.y - p1.y) +
    3 * t * t * (p3.y - p2.y);
  return normalize({ x: dx, y: dy });
}

export interface AdaptiveBezierLengthResult {
  lengthCm: number;
  lowerBoundCm: number;
  upperBoundCm: number;
  errorBoundCm: number;
  toleranceAchieved: boolean;
  subdivisions: number;
  maxDepthReached: boolean;
}

/**
 * Computes cubic Bézier curve arc length adaptively using recursive De Casteljau subdivision.
 * Uses chord length as lower bound and control-polygon length as upper bound.
 * Both bounds are mathematically proven: L_chord <= ArcLength <= L_poly.
 * Returns the computed length and an independently calculated, proven error bound.
 */
export function computeAdaptiveBezierLength(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  toleranceCm = 0.005,
  maxDepth = 14
): AdaptiveBezierLengthResult {
  let subdivisions = 0;
  let maxDepthReached = false;

  function subdivideAndMeasure(
    q0: Point,
    q1: Point,
    q2: Point,
    q3: Point,
    depth: number,
    localTol: number
  ): { lower: number; upper: number; est: number } {
    const chord = distance(q0, q3);
    const poly = distance(q0, q1) + distance(q1, q2) + distance(q2, q3);
    const diff = poly - chord;

    if (diff <= localTol || depth >= maxDepth) {
      if (depth >= maxDepth && diff > localTol) {
        maxDepthReached = true;
      }
      return {
        lower: chord,
        upper: poly,
        // Midpoint of bounds provides minimax error <= diff / 2
        est: (chord + poly) / 2
      };
    }

    subdivisions++;

    // De Casteljau subdivision at t = 0.5
    const q01 = { x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 };
    const q12 = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };
    const q23 = { x: (q2.x + q3.x) / 2, y: (q2.y + q3.y) / 2 };

    const q012 = { x: (q01.x + q12.x) / 2, y: (q01.y + q12.y) / 2 };
    const q123 = { x: (q12.x + q23.x) / 2, y: (q12.y + q23.y) / 2 };

    const mid = { x: (q012.x + q123.x) / 2, y: (q012.y + q123.y) / 2 };

    const left = subdivideAndMeasure(q0, q01, q012, mid, depth + 1, localTol / 2);
    const right = subdivideAndMeasure(mid, q123, q23, q3, depth + 1, localTol / 2);

    return {
      lower: left.lower + right.lower,
      upper: left.upper + right.upper,
      est: left.est + right.est
    };
  }

  const res = subdivideAndMeasure(p0, p1, p2, p3, 0, toleranceCm);
  const errorBoundCm = Number(((res.upper - res.lower) / 2).toFixed(5));
  const toleranceAchieved = errorBoundCm <= toleranceCm;

  return {
    lengthCm: Number(res.est.toFixed(3)),
    lowerBoundCm: Number(res.lower.toFixed(3)),
    upperBoundCm: Number(res.upper.toFixed(3)),
    errorBoundCm,
    toleranceAchieved,
    subdivisions,
    maxDepthReached
  };
}

/**
 * Calculates cubic Bezier curve length using adaptive subdivision with guaranteed error bounds.
 */
export function approximateBezierLength(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  steps = 30
): number {
  return Number(computeAdaptiveBezierLength(p0, p1, p2, p3, 0.002).lengthCm.toFixed(2));
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
