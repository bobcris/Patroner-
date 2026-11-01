/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BoundingBox, Point } from '../../types';
import { approximateBezierLength, cubicBezierPoint, cubicBezierTangent, distance, normalize, vector } from './math';

export type SegmentType = 'line' | 'bezier';
export type SegmentRole = 'stitching' | 'offset' | 'miter' | 'bevel' | 'fold-extension' | 'bridge';

export interface BaseSegment {
  id: string;
  type: SegmentType;
  seamId?: string;
  sourceSegmentId?: string;
  role?: SegmentRole;
  isFold?: boolean;
  seamAllowanceCm: number;
  start: Point;
  end: Point;
  lengthCm(): number;
  tangentAt(t: number): Point;
  normalAt(t: number, outwardSign?: number): Point;
  pointAt(t: number): Point;
  toSvgPath(includeMove?: boolean): string;
}

export class LineSegment implements BaseSegment {
  readonly type = 'line' as const;

  constructor(
    public readonly id: string,
    public readonly start: Point,
    public readonly end: Point,
    public readonly seamAllowanceCm: number = 1.5,
    public readonly isFold: boolean = false,
    public readonly seamId?: string,
    public readonly sourceSegmentId?: string,
    public readonly role: SegmentRole = isFold ? 'stitching' : 'offset'
  ) {}

  lengthCm(): number {
    return Number(distance(this.start, this.end).toFixed(2));
  }

  tangentAt(_t = 0): Point {
    const v = vector(this.start, this.end);
    const len = Math.hypot(v.x, v.y);
    if (len < 1e-9) {
      return { x: 1, y: 0 }; // Default unit vector for degenerate zero-length line
    }
    return { x: v.x / len, y: v.y / len };
  }

  /**
   * Outward unit normal for screen-space traversal (X right, Y down):
   * For standard clockwise traversal, outward normal is (-ty, tx).
   * outwardSign allows inverting normal if contour winding is counter-clockwise.
   */
  normalAt(_t = 0, outwardSign = 1): Point {
    const t = this.tangentAt();
    return {
      x: -t.y * outwardSign,
      y: t.x * outwardSign
    };
  }

  pointAt(t: number): Point {
    const clampedT = Math.max(0, Math.min(1, t));
    return {
      x: Number((this.start.x + (this.end.x - this.start.x) * clampedT).toFixed(3)),
      y: Number((this.start.y + (this.end.y - this.start.y) * clampedT).toFixed(3))
    };
  }

  toSvgPath(includeMove = false): string {
    const move = includeMove ? `M ${this.start.x.toFixed(2)} ${this.start.y.toFixed(2)} ` : '';
    return `${move}L ${this.end.x.toFixed(2)} ${this.end.y.toFixed(2)}`;
  }
}

export class CubicBezierCurve implements BaseSegment {
  readonly type = 'bezier' as const;

  constructor(
    public readonly id: string,
    public readonly p0: Point,
    public readonly cp1: Point,
    public readonly cp2: Point,
    public readonly p3: Point,
    public readonly seamAllowanceCm: number = 1.5,
    public readonly isFold: boolean = false,
    public readonly seamId?: string,
    public readonly sourceSegmentId?: string,
    public readonly role: SegmentRole = isFold ? 'stitching' : 'offset'
  ) {}

  get start(): Point {
    return this.p0;
  }

  get end(): Point {
    return this.p3;
  }

  lengthCm(): number {
    return approximateBezierLength(this.p0, this.cp1, this.cp2, this.p3, 30);
  }

  pointAt(t: number): Point {
    return cubicBezierPoint(this.p0, this.cp1, this.cp2, this.p3, Math.max(0, Math.min(1, t)));
  }

  /**
   * Evaluates unit tangent at t.
   * Handles degenerate control points (e.g. p0 === cp1 or cp2 === p3) safely.
   */
  tangentAt(t: number): Point {
    const clampedT = Math.max(0, Math.min(1, t));
    let tan = cubicBezierTangent(this.p0, this.cp1, this.cp2, this.p3, clampedT);
    const len = Math.hypot(tan.x, tan.y);

    if (len < 1e-7) {
      // Degenerate tangent at t=0 or t=1, fallback to secant or intermediate control vector
      if (clampedT < 0.5) {
        const v1 = vector(this.p0, this.cp2);
        if (Math.hypot(v1.x, v1.y) > 1e-7) return normalize(v1);
        return normalize(vector(this.p0, this.p3));
      } else {
        const v2 = vector(this.cp1, this.p3);
        if (Math.hypot(v2.x, v2.y) > 1e-7) return normalize(v2);
        return normalize(vector(this.p0, this.p3));
      }
    }

    return tan;
  }

  normalAt(t: number, outwardSign = 1): Point {
    const tan = this.tangentAt(t);
    return {
      x: -tan.y * outwardSign,
      y: tan.x * outwardSign
    };
  }

  samplePoints(numSamples = 16): Point[] {
    const pts: Point[] = [];
    const count = Math.max(2, numSamples);
    for (let i = 0; i <= count; i++) {
      pts.push(this.pointAt(i / count));
    }
    return pts;
  }

  /**
   * Performs De Casteljau subdivision at parameter t in [0, 1].
   * Retains semantic attributes (seamAllowanceCm, isFold, seamId, sourceSegmentId, role).
   */
  subdivide(t: number): { left: CubicBezierCurve; right: CubicBezierCurve } {
    const clampedT = Math.max(0, Math.min(1, t));
    const p0 = this.p0;
    const p1 = this.cp1;
    const p2 = this.cp2;
    const p3 = this.p3;

    const p01 = { x: p0.x + (p1.x - p0.x) * clampedT, y: p0.y + (p1.y - p0.y) * clampedT };
    const p12 = { x: p1.x + (p2.x - p1.x) * clampedT, y: p1.y + (p2.y - p1.y) * clampedT };
    const p23 = { x: p2.x + (p3.x - p2.x) * clampedT, y: p2.y + (p3.y - p2.y) * clampedT };

    const p012 = { x: p01.x + (p12.x - p01.x) * clampedT, y: p01.y + (p12.y - p01.y) * clampedT };
    const p123 = { x: p12.x + (p23.x - p12.x) * clampedT, y: p12.y + (p23.y - p12.y) * clampedT };

    const mid = { x: p012.x + (p123.x - p012.x) * clampedT, y: p012.y + (p123.y - p012.y) * clampedT };

    const left = new CubicBezierCurve(
      `${this.id}-L`,
      p0,
      p01,
      p012,
      mid,
      this.seamAllowanceCm,
      this.isFold,
      this.seamId,
      this.sourceSegmentId,
      this.role
    );

    const right = new CubicBezierCurve(
      `${this.id}-R`,
      mid,
      p123,
      p23,
      p3,
      this.seamAllowanceCm,
      this.isFold,
      this.seamId,
      this.sourceSegmentId,
      this.role
    );

    return { left, right };
  }

  /**
   * Recursively flattens the Bezier curve into points within the given geometric flatness tolerance (cm).
   * Uses chord-to-control-point maximum perpendicular deviation.
   */
  flatten(flatnessToleranceCm = 0.05, maxDepth = 6): Point[] {
    const distToChord = (p: Point, a: Point, b: Point): number => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-10) {
        return Math.hypot(p.x - a.x, p.y - a.y);
      }
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };

    const d1 = distToChord(this.cp1, this.p0, this.p3);
    const d2 = distToChord(this.cp2, this.p0, this.p3);
    const maxDev = Math.max(d1, d2);

    if (maxDev <= flatnessToleranceCm || maxDepth <= 0) {
      return [this.p0, this.p3];
    }

    const { left, right } = this.subdivide(0.5);
    const leftPts = left.flatten(flatnessToleranceCm, maxDepth - 1);
    const rightPts = right.flatten(flatnessToleranceCm, maxDepth - 1);

    return [...leftPts, ...rightPts.slice(1)];
  }

  /**
   * Determines the curve parameter t in [0, 1] that minimizes the Euclidean distance to a target point.
   */
  closestParamToPoint(target: Point, samples = 20): number {
    let bestT = 0;
    let minD = Infinity;
    const n = Math.max(5, samples);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const pt = this.pointAt(t);
      const d = distance(pt, target);
      if (d < minD) {
        minD = d;
        bestT = t;
      }
    }

    let leftT = Math.max(0, bestT - 1 / n);
    let rightT = Math.min(1, bestT + 1 / n);
    for (let iter = 0; iter < 12; iter++) {
      const m1 = leftT + (rightT - leftT) / 3;
      const m2 = rightT - (rightT - leftT) / 3;
      const d1 = distance(this.pointAt(m1), target);
      const d2 = distance(this.pointAt(m2), target);
      if (d1 < d2) {
        rightT = m2;
      } else {
        leftT = m1;
      }
    }
    return (leftT + rightT) / 2;
  }

  toSvgPath(includeMove = false): string {
    const move = includeMove ? `M ${this.p0.x.toFixed(2)} ${this.p0.y.toFixed(2)} ` : '';
    return `${move}C ${this.cp1.x.toFixed(2)} ${this.cp1.y.toFixed(2)}, ${this.cp2.x.toFixed(2)} ${this.cp2.y.toFixed(2)}, ${this.p3.x.toFixed(2)} ${this.p3.y.toFixed(2)}`;
  }
}

export type GeometricSegment = LineSegment | CubicBezierCurve;

export class GeometricContour {
  constructor(
    public readonly id: string,
    public readonly segments: GeometricSegment[] = [],
    public readonly isClosed: boolean = true
  ) {}

  totalLengthCm(): number {
    return Number(this.segments.reduce((acc, seg) => acc + seg.lengthCm(), 0).toFixed(2));
  }

  toSvgPath(): string {
    if (this.segments.length === 0) return '';
    const parts: string[] = [];
    parts.push(`M ${this.segments[0].start.x.toFixed(2)} ${this.segments[0].start.y.toFixed(2)}`);

    for (const seg of this.segments) {
      if (seg.type === 'line') {
        parts.push(`L ${seg.end.x.toFixed(2)} ${seg.end.y.toFixed(2)}`);
      } else {
        parts.push(
          `C ${seg.cp1.x.toFixed(2)} ${seg.cp1.y.toFixed(2)}, ${seg.cp2.x.toFixed(2)} ${seg.cp2.y.toFixed(2)}, ${seg.p3.x.toFixed(2)} ${seg.p3.y.toFixed(2)}`
        );
      }
    }

    if (this.isClosed) {
      parts.push('Z');
    }

    return parts.join(' ');
  }

  getVertices(): Point[] {
    const pts: Point[] = [];
    for (const seg of this.segments) {
      pts.push(seg.start);
    }
    return pts;
  }

  /**
   * Returns a dense polyline representation of the contour by adaptively flattening curved segments.
   */
  toPolyline(samplesPerCurve = 16, flatnessToleranceCm = 0.05): Point[] {
    const poly: Point[] = [];
    for (const seg of this.segments) {
      if (seg.type === 'line') {
        poly.push(seg.start);
      } else {
        const samples = (seg as CubicBezierCurve).flatten(flatnessToleranceCm);
        for (let i = 0; i < samples.length - 1; i++) {
          poly.push(samples[i]);
        }
      }
    }
    return poly;
  }

  /**
   * Computes the signed area of the contour using the Shoelace formula on sampled vertices.
   * In screen space (X right, Y down):
   * - A negative signed area indicates Clockwise (CW) traversal.
   * - A positive signed area indicates Counter-Clockwise (CCW) traversal.
   */
  signedArea(): number {
    const poly = this.toPolyline(16);
    const n = poly.length;
    if (n < 3) return 0;

    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    }
    return area / 2;
  }

  getWinding(): 'clockwise' | 'counter-clockwise' | 'collinear' {
    const area = this.signedArea();
    if (Math.abs(area) < 1e-4) return 'collinear';
    // In SVG / screen coordinate system (Y increases downwards):
    // Standard shoelace formula: negative area is CLOCKWISE, positive is COUNTER_CLOCKWISE
    return area < 0 ? 'clockwise' : 'counter-clockwise';
  }

  isWindingClockwise(): boolean {
    return this.getWinding() === 'clockwise';
  }

  boundingBox(): BoundingBox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const seg of this.segments) {
      const pts = seg.type === 'line' 
        ? [seg.start, seg.end] 
        : (seg as CubicBezierCurve).samplePoints(10);

      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }

    if (minX === Infinity) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthCm: 0, heightCm: 0 };
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
}

/**
 * Calculates line-line intersection of two infinite 2D lines:
 * Line 1: p1 + s * v1
 * Line 2: p2 + t * v2
 */
export function lineLineIntersection(
  p1: Point,
  v1: Point,
  p2: Point,
  v2: Point
): Point | null {
  const det = v1.x * v2.y - v1.y * v2.x;
  // Parallel or collinear lines
  if (Math.abs(det) < 1e-8) {
    return null;
  }

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const s = (dx * v2.y - dy * v2.x) / det;

  return {
    x: Number((p1.x + s * v1.x).toFixed(3)),
    y: Number((p1.y + s * v1.y).toFixed(3))
  };
}

/**
 * Checks whether two 2D line segments [p1, p2] and [p3, p4] intersect strictly within their spans.
 */
export function doSegmentsIntersect(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point
): boolean {
  // Segments sharing an endpoint touch at a vertex rather than self-intersecting
  if (
    distance(p1, p3) < 0.02 ||
    distance(p1, p4) < 0.02 ||
    distance(p2, p3) < 0.02 ||
    distance(p2, p4) < 0.02
  ) {
    return false;
  }

  const ccw = (a: Point, b: Point, c: Point): number => {
    return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
  };

  const d1 = ccw(p1, p2, p3);
  const d2 = ccw(p1, p2, p4);
  const d3 = ccw(p3, p4, p1);
  const d4 = ccw(p3, p4, p2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}
