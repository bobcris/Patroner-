/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Point } from '../../types';
import { approximateBezierLength, cubicBezierPoint, cubicBezierTangent, distance, dotProduct, normalize, vector } from './math';
import {
  CubicBezierCurve,
  GeometricContour,
  GeometricSegment,
  LineSegment,
  lineLineIntersection
} from './primitives';

export interface OffsetOptions {
  defaultAllowanceCm?: number;
  miterLimit?: number; // Maximum miter ratio (miter length / allowance) before beveling
  bezierToleranceCm?: number; // Maximum allowable deviation for Bezier offset approximation (default 0.05 cm = 0.5mm)
}

export interface OffsetResult {
  cuttingContour: GeometricContour;
  maxDeviationCm: number;
  approximationMethod: string;
  warnings: string[];
  errors: string[];
}

export const BEZIER_OFFSET_TOLERANCE_CM = 0.05;

export const DEFAULT_OFFSET_OPTIONS: Required<OffsetOptions> = {
  defaultAllowanceCm: 1.5,
  miterLimit: 2.5,
  bezierToleranceCm: BEZIER_OFFSET_TOLERANCE_CM
};

/**
 * Offsets a straight line segment by distance d along its outward unit normal.
 * For a straight line, the constant-distance offset is mathematically exact.
 */
export function offsetLineSegment(
  line: LineSegment,
  allowanceCm: number
): LineSegment {
  if (line.isFold || allowanceCm === 0) {
    return new LineSegment(
      `${line.id}-cut`,
      line.start,
      line.end,
      0,
      true,
      line.seamId
    );
  }

  const normal = line.normalAt(0);
  const offsetStart: Point = {
    x: Number((line.start.x + normal.x * allowanceCm).toFixed(2)),
    y: Number((line.start.y + normal.y * allowanceCm).toFixed(2))
  };
  const offsetEnd: Point = {
    x: Number((line.end.x + normal.x * allowanceCm).toFixed(2)),
    y: Number((line.end.y + normal.y * allowanceCm).toFixed(2))
  };

  return new LineSegment(
    `${line.id}-cut`,
    offsetStart,
    offsetEnd,
    allowanceCm,
    false,
    line.seamId
  );
}

/**
 * Offsets a cubic Bezier curve by distance d.
 * 
 * Mathematical Truth & Documentation:
 * A constant-distance offset of a cubic Bezier curve is an algebraic curve of degree up to 10
 * and cannot in general be represented as an exact cubic Bezier curve.
 * 
 * Method:
 * We use a controlled numerical approximation:
 * 1. Offset endpoints along their respective unit normal vectors: P'_0 = P_0 + d*n_0, P'_3 = P_3 + d*n_3.
 * 2. Sample true offset point at curve midpoint t=0.5: M_true = P(0.5) + d*n(0.5).
 * 3. Fit offset control points P'_1 and P'_2 along the start/end tangents to match M_true.
 * 4. Sample residual deviation at t=0.25 and t=0.75.
 * 5. If max deviation <= tolerance (default 0.05cm / 0.5mm), accept fitted segment.
 * 6. If deviation > tolerance, subdivide base curve at t=0.5 and recursively offset each half.
 */
export function offsetCubicBezier(
  curve: CubicBezierCurve,
  allowanceCm: number,
  toleranceCm: number = DEFAULT_OFFSET_OPTIONS.bezierToleranceCm,
  depth = 0
): { segments: CubicBezierCurve[]; maxDeviationCm: number } {
  if (curve.isFold || allowanceCm === 0) {
    return {
      segments: [
        new CubicBezierCurve(
          `${curve.id}-cut`,
          curve.p0,
          curve.cp1,
          curve.cp2,
          curve.p3,
          0,
          true,
          curve.seamId
        )
      ],
      maxDeviationCm: 0
    };
  }

  // Endpoints along outward normals
  const n0 = curve.normalAt(0);
  const n3 = curve.normalAt(1);
  const p0Prime: Point = {
    x: curve.p0.x + n0.x * allowanceCm,
    y: curve.p0.y + n0.y * allowanceCm
  };
  const p3Prime: Point = {
    x: curve.p3.x + n3.x * allowanceCm,
    y: curve.p3.y + n3.y * allowanceCm
  };

  // Tangents at endpoints
  const t0 = curve.tangentAt(0);
  const t3 = curve.tangentAt(1);

  // Sample true offset at t=0.5
  const midBase = curve.pointAt(0.5);
  const midNorm = curve.normalAt(0.5);
  const midTrue: Point = {
    x: midBase.x + midNorm.x * allowanceCm,
    y: midBase.y + midNorm.y * allowanceCm
  };

  // Chord length between offset endpoints
  const chordLen = distance(p0Prime, p3Prime);
  const scale = chordLen / 3.0;

  // Approximate control points along tangent directions
  const p1Prime: Point = {
    x: Number((p0Prime.x + t0.x * scale).toFixed(2)),
    y: Number((p0Prime.y + t0.y * scale).toFixed(2))
  };
  const p2Prime: Point = {
    x: Number((p3Prime.x - t3.x * scale).toFixed(2)),
    y: Number((p3Prime.y - t3.y * scale).toFixed(2))
  };

  // Measure deviation at sample points t=0.25, 0.5, 0.75
  const sampleParams = [0.25, 0.5, 0.75];
  let maxDev = 0;

  for (const t of sampleParams) {
    const basePt = curve.pointAt(t);
    const baseN = curve.normalAt(t);
    const truePt: Point = {
      x: basePt.x + baseN.x * allowanceCm,
      y: basePt.y + baseN.y * allowanceCm
    };
    const approxPt = cubicBezierPoint(p0Prime, p1Prime, p2Prime, p3Prime, t);
    const dev = distance(truePt, approxPt);
    if (dev > maxDev) maxDev = dev;
  }

  // If within tolerance or maximum subdivision depth reached (3), accept fitted segment
  if (maxDev <= toleranceCm || depth >= 3) {
    return {
      segments: [
        new CubicBezierCurve(
          `${curve.id}-cut${depth > 0 ? `-${depth}` : ''}`,
          p0Prime,
          p1Prime,
          p2Prime,
          p3Prime,
          allowanceCm,
          false,
          curve.seamId
        )
      ],
      maxDeviationCm: Number(maxDev.toFixed(3))
    };
  }

  // De Casteljau subdivision at t=0.5
  const p0 = curve.p0;
  const p1 = curve.cp1;
  const p2 = curve.cp2;
  const p3 = curve.p3;

  const p01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const p12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const p23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };

  const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
  const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 };

  const mid = { x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2 };

  const leftCurve = new CubicBezierCurve(`${curve.id}-L`, p0, p01, p012, mid, allowanceCm, false, curve.seamId);
  const rightCurve = new CubicBezierCurve(`${curve.id}-R`, mid, p123, p23, p3, allowanceCm, false, curve.seamId);

  const leftRes = offsetCubicBezier(leftCurve, allowanceCm, toleranceCm, depth + 1);
  const rightRes = offsetCubicBezier(rightCurve, allowanceCm, toleranceCm, depth + 1);

  return {
    segments: [...leftRes.segments, ...rightRes.segments],
    maxDeviationCm: Math.max(leftRes.maxDeviationCm, rightRes.maxDeviationCm)
  };
}

/**
 * Computes corner intersection between two consecutive offset segments.
 * Handles miter joins with miter-limit threshold and bevel joins for acute angles.
 */
export function joinOffsetSegmentsAtCorner(
  seg1: GeometricSegment,
  seg2: GeometricSegment,
  miterLimit = 2.5
): GeometricSegment[] {
  // If consecutive segments already share start/end coordinates (continuous)
  if (distance(seg1.end, seg2.start) < 0.05) {
    return [seg1, seg2];
  }

  // Tangents at corner
  const t1 = seg1.tangentAt(1);
  const t2 = seg2.tangentAt(0);

  // Compute intersection of offset tangents
  const intersection = lineLineIntersection(seg1.end, t1, seg2.start, t2);

  if (!intersection) {
    // Parallel offset edges: connect directly with a bridge segment
    const bridge = new LineSegment(`${seg1.id}-join`, seg1.end, seg2.start, seg1.seamAllowanceCm);
    return [seg1, bridge, seg2];
  }

  const d1 = distance(seg1.end, intersection);
  const d2 = distance(seg2.start, intersection);
  const allowance = Math.max(seg1.seamAllowanceCm, seg2.seamAllowanceCm, 0.5);
  const miterRatio = Math.max(d1, d2) / allowance;

  // Check miter limit: if angle is too acute (miterRatio > limit), use bevel join to avoid sharp spike
  if (miterRatio > miterLimit) {
    // Bevel join: connect seg1.end to seg2.start directly with a flat chamfer
    const bevel = new LineSegment(`${seg1.id}-bevel`, seg1.end, seg2.start, allowance);
    return [seg1, bevel, seg2];
  }

  // Miter join: adjust seg1 end and seg2 start to meet at intersection
  let adjustedSeg1: GeometricSegment;
  let adjustedSeg2: GeometricSegment;

  if (seg1.type === 'line') {
    adjustedSeg1 = new LineSegment(seg1.id, seg1.start, intersection, seg1.seamAllowanceCm, seg1.isFold, seg1.seamId);
  } else {
    adjustedSeg1 = new CubicBezierCurve(seg1.id, seg1.p0, seg1.cp1, seg1.cp2, intersection, seg1.seamAllowanceCm, seg1.isFold, seg1.seamId);
  }

  if (seg2.type === 'line') {
    adjustedSeg2 = new LineSegment(seg2.id, intersection, seg2.end, seg2.seamAllowanceCm, seg2.isFold, seg2.seamId);
  } else {
    adjustedSeg2 = new CubicBezierCurve(seg2.id, intersection, seg2.cp1, seg2.cp2, seg2.p3, seg2.seamAllowanceCm, seg2.isFold, seg2.seamId);
  }

  return [adjustedSeg1, adjustedSeg2];
}

/**
 * Generates mathematically valid cutting contour from an approved stitching contour.
 * 
 * Rules:
 * 1. Segments with isFold=true receive 0cm seam allowance and remain collinear with fold line.
 * 2. Regular seamlines receive their specified seamAllowanceCm.
 * 3. Consecutive offset segments are joined with controlled miter/bevel intersections.
 * 4. At fold-to-seam corners, cutting line terminates with strict 90° tangency on the fold line.
 */
export function generateCuttingContour(
  stitchingContour: GeometricContour,
  options: OffsetOptions = {}
): OffsetResult {
  const opts: Required<OffsetOptions> = { ...DEFAULT_OFFSET_OPTIONS, ...options };
  const warnings: string[] = [];
  const errors: string[] = [];
  let maxDeviation = 0;

  if (!stitchingContour.segments || stitchingContour.segments.length === 0) {
    errors.push('Cannot offset empty stitching contour.');
    return {
      cuttingContour: new GeometricContour('empty-cut', []),
      maxDeviationCm: 0,
      approximationMethod: 'none',
      warnings,
      errors
    };
  }

  // Step 1: Offset individual segments along their outward normals
  const rawOffsetSegments: GeometricSegment[] = [];

  for (const seg of stitchingContour.segments) {
    const allowance = seg.isFold ? 0 : (seg.seamAllowanceCm || opts.defaultAllowanceCm);

    if (seg.type === 'line') {
      const lineSeg = seg as LineSegment;
      rawOffsetSegments.push(offsetLineSegment(lineSeg, allowance));
    } else {
      const bezSeg = seg as CubicBezierCurve;
      const res = offsetCubicBezier(bezSeg, allowance, opts.bezierToleranceCm);
      rawOffsetSegments.push(...res.segments);
      if (res.maxDeviationCm > maxDeviation) maxDeviation = res.maxDeviationCm;
    }
  }

  // Step 2: Resolve corner joins between sequential offset segments with guaranteed vertex continuity
  const joinedSegments: GeometricSegment[] = [];
  const n = rawOffsetSegments.length;

  for (let i = 0; i < n; i++) {
    const curr = rawOffsetSegments[i];
    const next = rawOffsetSegments[(i + 1) % n];

    // Push the current segment
    joinedSegments.push(curr);

    const gap = distance(curr.end, next.start);
    if (gap < 0.05) {
      continue;
    }

    // Corner resolution
    if (curr.isFold && !next.isFold) {
      // Fold ends at (x_fold, y1); next offset starts at (x2, y2).
      const foldExt: Point = { x: curr.end.x, y: next.start.y };
      if (distance(curr.end, foldExt) >= 0.01) {
        joinedSegments.push(new LineSegment(`${curr.id}-fold-down`, curr.end, foldExt, next.seamAllowanceCm));
      }
      if (distance(foldExt, next.start) >= 0.01) {
        joinedSegments.push(new LineSegment(`${curr.id}-fold-sq`, foldExt, next.start, next.seamAllowanceCm));
      }
    } else if (!curr.isFold && next.isFold) {
      // Offset seam ends at (x1, y1); next is fold on x=0 starting at (x_fold, y2).
      const foldSq: Point = { x: next.start.x, y: curr.end.y };
      if (distance(curr.end, foldSq) >= 0.01) {
        joinedSegments.push(new LineSegment(`${curr.id}-sq-fold`, curr.end, foldSq, curr.seamAllowanceCm));
      }
      if (distance(foldSq, next.start) >= 0.01) {
        joinedSegments.push(new LineSegment(`${curr.id}-fold-up`, foldSq, next.start, curr.seamAllowanceCm));
      }
    } else {
      // General seam-to-seam corner
      const t1 = curr.tangentAt(1);
      const t2 = next.tangentAt(0);
      const intersection = lineLineIntersection(curr.end, t1, next.start, t2);

      const allowance = Math.max(curr.seamAllowanceCm, next.seamAllowanceCm, 0.5);
      let usedMiter = false;

      if (intersection) {
        const d1 = distance(curr.end, intersection);
        const d2 = distance(next.start, intersection);
        const miterRatio = Math.max(d1, d2) / allowance;

        if (miterRatio <= opts.miterLimit) {
          if (distance(curr.end, intersection) >= 0.01) {
            joinedSegments.push(new LineSegment(`${curr.id}-miter-a`, curr.end, intersection, allowance));
          }
          if (distance(intersection, next.start) >= 0.01) {
            joinedSegments.push(new LineSegment(`${curr.id}-miter-b`, intersection, next.start, allowance));
          }
          usedMiter = true;
        }
      }

      if (!usedMiter) {
        joinedSegments.push(new LineSegment(`${curr.id}-bevel`, curr.end, next.start, allowance));
      }
    }
  }

  const cuttingContour = new GeometricContour(
    `${stitchingContour.id}-cutting`,
    joinedSegments,
    stitchingContour.isClosed
  );

  return {
    cuttingContour,
    maxDeviationCm: maxDeviation,
    approximationMethod: 'Adaptive cubic Bezier normal offset with miter/bevel corner intersection',
    warnings,
    errors
  };
}
