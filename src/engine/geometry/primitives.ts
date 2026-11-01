/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BoundingBox, Point } from '../../types';
import { approximateBezierLength, cubicBezierPoint, cubicBezierTangent, distance, normalize, vector } from './math';

export type SegmentType = 'line' | 'bezier';

export interface BaseSegment {
  id: string;
  type: SegmentType;
  seamId?: string;
  isFold?: boolean;
  seamAllowanceCm: number;
  start: Point;
  end: Point;
  lengthCm(): number;
  tangentAt(t: number): Point;
  normalAt(t: number): Point;
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
    public readonly seamId?: string
  ) {}

  lengthCm(): number {
    return Number(distance(this.start, this.end).toFixed(2));
  }

  tangentAt(_t = 0): Point {
    return normalize(vector(this.start, this.end));
  }

  /**
   * Outward unit normal for counter-clockwise contour (Down-Right-Up-Left in screen space):
   * Given tangent (tx, ty), outward normal is (-ty, tx)
   */
  normalAt(_t = 0): Point {
    const t = this.tangentAt();
    return { x: -t.y, y: t.x };
  }

  pointAt(t: number): Point {
    const clampedT = Math.max(0, Math.min(1, t));
    return {
      x: Number((this.start.x + (this.end.x - this.start.x) * clampedT).toFixed(2)),
      y: Number((this.start.y + (this.end.y - this.start.y) * clampedT).toFixed(2))
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
    public readonly seamId?: string
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

  tangentAt(t: number): Point {
    return cubicBezierTangent(this.p0, this.cp1, this.cp2, this.p3, Math.max(0, Math.min(1, t)));
  }

  normalAt(t: number): Point {
    const tan = this.tangentAt(t);
    return { x: -tan.y, y: tan.x };
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

  boundingBox(): BoundingBox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const seg of this.segments) {
      const pts = seg.type === 'line' 
        ? [seg.start, seg.end] 
        : [seg.start, seg.cp1, seg.cp2, seg.end];

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
  if (Math.abs(det) < 1e-9) {
    return null;
  }

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const s = (dx * v2.y - dy * v2.x) / det;

  return {
    x: Number((p1.x + s * v1.x).toFixed(2)),
    y: Number((p1.y + s * v1.y).toFixed(2))
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
    distance(p1, p3) < 0.05 ||
    distance(p1, p4) < 0.05 ||
    distance(p2, p3) < 0.05 ||
    distance(p2, p4) < 0.05
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
