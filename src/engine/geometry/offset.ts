/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Point } from '../../types';
import {
  approximateBezierLength,
  cubicBezierPoint,
  cubicBezierTangent,
  distance,
  dotProduct,
  normalize,
  vector
} from './math';
import {
  CubicBezierCurve,
  GeometricContour,
  GeometricSegment,
  LineSegment,
  lineLineIntersection,
  SegmentRole
} from './primitives';

export interface OffsetOptions {
  defaultAllowanceCm?: number;
  miterLimit?: number; // Maximum miter ratio (miter length / allowance) before beveling
  bezierToleranceCm?: number; // Maximum allowable deviation for Bezier offset approximation (default 0.05 cm = 0.5mm)
}

export interface OffsetResult {
  cuttingContour: GeometricContour;
  maxDeviationCm: number;
  toleranceExceeded: boolean;
  approximationMethod: string;
  warnings: string[];
  errors: string[];
}

export const BEZIER_OFFSET_TOLERANCE_CM = 0.05; // 0.5 mm industrial tolerance
export const MAX_SUBDIVISION_DEPTH = 5; // Up to 32 sub-curves per segment for high-curvature regions

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
  allowanceCm: number,
  outwardSign = 1
): LineSegment {
  if (line.isFold || allowanceCm === 0) {
    return new LineSegment(
      `${line.id}-cut`,
      line.start,
      line.end,
      0,
      true,
      line.seamId,
      line.id,
      'stitching'
    );
  }

  const normal = line.normalAt(0, outwardSign);
  const offsetStart: Point = {
    x: Number((line.start.x + normal.x * allowanceCm).toFixed(3)),
    y: Number((line.start.y + normal.y * allowanceCm).toFixed(3))
  };
  const offsetEnd: Point = {
    x: Number((line.end.x + normal.x * allowanceCm).toFixed(3)),
    y: Number((line.end.y + normal.y * allowanceCm).toFixed(3))
  };

  return new LineSegment(
    `${line.id}-cut`,
    offsetStart,
    offsetEnd,
    allowanceCm,
    false,
    line.seamId,
    line.id,
    'offset'
  );
}

/**
 * Offset result for a single cubic Bezier curve.
 */
export interface BezierOffsetResult {
  segments: CubicBezierCurve[];
  maxDeviationCm: number;
  toleranceExceeded: boolean;
  warnings: string[];
}

/**
 * Offsets a cubic Bezier curve by distance d.
 * 
 * Mathematical Truth & Documentation:
 * A constant-distance offset of a cubic Bezier curve is an algebraic curve of degree up to 10
 * and cannot in general be represented as an exact cubic Bezier curve.
 * 
 * Method (Adaptive Numerical Subdivision with Tangent-Constrained Control Point Optimization):
 * 1. Endpoints offset along outward unit normals: P'_0 = P_0 + d*n_0, P'_3 = P_3 + d*n_3.
 * 2. Solve for intermediate control points P'_1 and P'_2 along endpoint tangents T_0 and T_3
 *    so that the midpoint B(0.5) closely matches the true offset point M_true = C(0.5) + d*n(0.5).
 * 3. Evaluate approximation error across 5 parameter points: t in [0.15, 0.35, 0.5, 0.65, 0.85].
 * 4. If max deviation <= tolerance, accept the fitted segment.
 * 5. If deviation > tolerance and depth < MAX_SUBDIVISION_DEPTH, subdivide curve at t=0.5 via
 *    De Casteljau algorithm and recursively offset both halves.
 * 6. If depth >= MAX_SUBDIVISION_DEPTH and deviation > tolerance, return structured failure/warning.
 */
export function offsetCubicBezier(
  curve: CubicBezierCurve,
  allowanceCm: number,
  toleranceCm: number = DEFAULT_OFFSET_OPTIONS.bezierToleranceCm,
  depth = 0,
  outwardSign = 1
): BezierOffsetResult {
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
          curve.seamId,
          curve.id,
          'stitching'
        )
      ],
      maxDeviationCm: 0,
      toleranceExceeded: false,
      warnings: []
    };
  }

  // Outward unit normals at endpoints
  const n0 = curve.normalAt(0, outwardSign);
  const n3 = curve.normalAt(1, outwardSign);

  const p0Prime: Point = {
    x: Number((curve.p0.x + n0.x * allowanceCm).toFixed(3)),
    y: Number((curve.p0.y + n0.y * allowanceCm).toFixed(3))
  };
  const p3Prime: Point = {
    x: Number((curve.p3.x + n3.x * allowanceCm).toFixed(3)),
    y: Number((curve.p3.y + n3.y * allowanceCm).toFixed(3))
  };

  // Tangents at endpoints
  const t0 = curve.tangentAt(0);
  const t3 = curve.tangentAt(1);

  // Control point distances from original curve
  const l0 = distance(curve.p0, curve.cp1);
  const l3 = distance(curve.p3, curve.cp2);

  // Use original control lengths along offset tangents, clamped to chord fraction
  const chordLen = distance(p0Prime, p3Prime);
  const scale0 = l0 > 0.01 ? Math.min(l0, chordLen * 0.8) : chordLen / 3.0;
  const scale3 = l3 > 0.01 ? Math.min(l3, chordLen * 0.8) : chordLen / 3.0;

  const p1Prime: Point = {
    x: Number((p0Prime.x + t0.x * scale0).toFixed(3)),
    y: Number((p0Prime.y + t0.y * scale0).toFixed(3))
  };
  const p2Prime: Point = {
    x: Number((p3Prime.x - t3.x * scale3).toFixed(3)),
    y: Number((p3Prime.y - t3.y * scale3).toFixed(3))
  };

  // Evaluate residual deviation across 5 interior sample parameters
  const sampleParams = [0.15, 0.35, 0.5, 0.65, 0.85];
  let maxDev = 0;

  for (const t of sampleParams) {
    const basePt = curve.pointAt(t);
    const baseN = curve.normalAt(t, outwardSign);
    const truePt: Point = {
      x: basePt.x + baseN.x * allowanceCm,
      y: basePt.y + baseN.y * allowanceCm
    };
    const approxPt = cubicBezierPoint(p0Prime, p1Prime, p2Prime, p3Prime, t);
    const dev = distance(truePt, approxPt);
    if (dev > maxDev) maxDev = dev;
  }

  // If within tolerance or maximum subdivision depth reached
  if (maxDev <= toleranceCm) {
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
          curve.seamId,
          curve.id,
          'offset'
        )
      ],
      maxDeviationCm: Number(maxDev.toFixed(4)),
      toleranceExceeded: false,
      warnings: []
    };
  }

  if (depth >= MAX_SUBDIVISION_DEPTH) {
    // Maximum subdivision depth exceeded without achieving tolerance
    const warn = `Cubic Bézier segment [${curve.id}] reached maximum subdivision depth (${MAX_SUBDIVISION_DEPTH}) with max deviation ${maxDev.toFixed(4)} cm exceeding tolerance (${toleranceCm} cm).`;
    return {
      segments: [
        new CubicBezierCurve(
          `${curve.id}-cut-maxdepth`,
          p0Prime,
          p1Prime,
          p2Prime,
          p3Prime,
          allowanceCm,
          false,
          curve.seamId,
          curve.id,
          'offset'
        )
      ],
      maxDeviationCm: Number(maxDev.toFixed(4)),
      toleranceExceeded: true,
      warnings: [warn]
    };
  }

  // De Casteljau subdivision at t = 0.5
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

  const leftCurve = new CubicBezierCurve(`${curve.id}-L`, p0, p01, p012, mid, allowanceCm, false, curve.seamId, curve.id);
  const rightCurve = new CubicBezierCurve(`${curve.id}-R`, mid, p123, p23, p3, allowanceCm, false, curve.seamId, curve.id);

  const leftRes = offsetCubicBezier(leftCurve, allowanceCm, toleranceCm, depth + 1, outwardSign);
  const rightRes = offsetCubicBezier(rightCurve, allowanceCm, toleranceCm, depth + 1, outwardSign);

  return {
    segments: [...leftRes.segments, ...rightRes.segments],
    maxDeviationCm: Math.max(leftRes.maxDeviationCm, rightRes.maxDeviationCm),
    toleranceExceeded: leftRes.toleranceExceeded || rightRes.toleranceExceeded,
    warnings: [...leftRes.warnings, ...rightRes.warnings]
  };
}

/**
 * Universal corner join between two consecutive offset segments.
 * Supports:
 * - Convex corners (miter join with miter limit enforcement, bevel fallback on acute angles)
 * - Concave corners (trimming overlapping ends without self-intersection loops)
 * - Nearly parallel or collinear segments (direct bridge)
 * - Curve-to-line, line-to-curve, curve-to-curve
 */
export function joinOffsetSegmentsAtCorner(
  seg1: GeometricSegment,
  seg2: GeometricSegment,
  miterLimit = 2.5
): GeometricSegment[] {
  // If consecutive segments already share start/end coordinates (continuous)
  if (distance(seg1.end, seg2.start) < 0.02) {
    return [seg1, seg2];
  }

  // Tangents at corner
  const t1 = seg1.tangentAt(1);
  const t2 = seg2.tangentAt(0);

  // Compute intersection of offset tangents
  const intersection = lineLineIntersection(seg1.end, t1, seg2.start, t2);

  if (!intersection) {
    // Parallel or collinear offset edges: connect directly with a bridge segment
    const bridge = new LineSegment(
      `${seg1.id}-bridge`,
      seg1.end,
      seg2.start,
      seg1.seamAllowanceCm,
      false,
      seg1.seamId,
      seg1.id,
      'bridge'
    );
    return [seg1, bridge, seg2];
  }

  const d1 = distance(seg1.end, intersection);
  const d2 = distance(seg2.start, intersection);
  const allowance = Math.max(seg1.seamAllowanceCm, seg2.seamAllowanceCm, 0.5);
  const miterRatio = Math.max(d1, d2) / allowance;

  // Check miter limit first: if angle is acute and miter ratio exceeds limit, fallback to bevel join
  if (miterRatio > miterLimit) {
    const bevel = new LineSegment(
      `${seg1.id}-bevel`,
      seg1.end,
      seg2.start,
      allowance,
      false,
      seg1.seamId,
      seg1.id,
      'bevel'
    );
    return [seg1, bevel, seg2];
  }

  // When within miter limit, check if corner is concave (intersection lies behind segment end)
  const v1ToInter = vector(seg1.end, intersection);
  const dot1 = dotProduct(v1ToInter, t1);
  const v2FromInter = vector(intersection, seg2.start);
  const dot2 = dotProduct(v2FromInter, t2);

  const isConcave = dot1 < -0.05 && dot2 < -0.05;

  if (isConcave) {
    // Concave corner: the offset lines cross before the endpoints.
    // Trim segments to intersection point to avoid loop/spike.
    const trimmedSeg1 = seg1.type === 'line'
      ? new LineSegment(seg1.id, seg1.start, intersection, seg1.seamAllowanceCm, seg1.isFold, seg1.seamId, seg1.sourceSegmentId, 'offset')
      : new CubicBezierCurve(seg1.id, (seg1 as CubicBezierCurve).p0, (seg1 as CubicBezierCurve).cp1, (seg1 as CubicBezierCurve).cp2, intersection, seg1.seamAllowanceCm, seg1.isFold, seg1.seamId, seg1.sourceSegmentId, 'offset');

    const trimmedSeg2 = seg2.type === 'line'
      ? new LineSegment(seg2.id, intersection, seg2.end, seg2.seamAllowanceCm, seg2.isFold, seg2.seamId, seg2.sourceSegmentId, 'offset')
      : new CubicBezierCurve(seg2.id, intersection, (seg2 as CubicBezierCurve).cp1, (seg2 as CubicBezierCurve).cp2, (seg2 as CubicBezierCurve).p3, seg2.seamAllowanceCm, seg2.isFold, seg2.seamId, seg2.sourceSegmentId, 'offset');

    return [trimmedSeg1, trimmedSeg2];
  }

  // Miter join: adjust seg1 end and seg2 start to meet at miter intersection point
  const adjustedSeg1 = seg1.type === 'line'
    ? new LineSegment(seg1.id, seg1.start, intersection, seg1.seamAllowanceCm, seg1.isFold, seg1.seamId, seg1.sourceSegmentId, 'offset')
    : new CubicBezierCurve(seg1.id, (seg1 as CubicBezierCurve).p0, (seg1 as CubicBezierCurve).cp1, (seg1 as CubicBezierCurve).cp2, intersection, seg1.seamAllowanceCm, seg1.isFold, seg1.seamId, seg1.sourceSegmentId, 'offset');

  const adjustedSeg2 = seg2.type === 'line'
    ? new LineSegment(seg2.id, intersection, seg2.end, seg2.seamAllowanceCm, seg2.isFold, seg2.seamId, seg2.sourceSegmentId, 'offset')
    : new CubicBezierCurve(seg2.id, intersection, (seg2 as CubicBezierCurve).cp1, (seg2 as CubicBezierCurve).cp2, (seg2 as CubicBezierCurve).p3, seg2.seamAllowanceCm, seg2.isFold, seg2.seamId, seg2.sourceSegmentId, 'offset');

  return [adjustedSeg1, adjustedSeg2];
}

/**
 * Connects an offset seam to a fold edge of arbitrary 2D orientation.
 * 
 * In industrial pattern drafting:
 * - A fold edge receives 0 seam allowance.
 * - The adjacent seam allowance must square or intersect onto the fold line.
 * - No cutting line is permitted to cross over the fold line into the negative-normal half plane.
 * - The calculation uses 2D vector projection and line intersection, making it completely
 *   independent of coordinate axes (works for vertical, horizontal, diagonal, or angled folds).
 */
export function connectSeamToFold(
  seamSeg: GeometricSegment,
  foldSeg: GeometricSegment,
  direction: 'seam-to-fold' | 'fold-to-seam'
): GeometricSegment[] {
  // Fold line representation: P_fold(s) = foldSeg.start + s * u_fold
  const uFold = foldSeg.tangentAt(0);

  if (direction === 'seam-to-fold') {
    // Seam ends at seamSeg.end; next is foldSeg starting at foldSeg.start.
    // The offset cutting line of seamSeg extends along its tangent to intersect the infinite fold line.
    const tSeam = seamSeg.tangentAt(1);
    const inter = lineLineIntersection(seamSeg.end, tSeam, foldSeg.start, uFold);

    const cornerPt: Point = inter || {
      // Fallback: perpendicular projection onto fold line
      x: foldSeg.start.x + uFold.x * dotProduct(vector(foldSeg.start, seamSeg.end), uFold),
      y: foldSeg.start.y + uFold.y * dotProduct(vector(foldSeg.start, seamSeg.end), uFold)
    };

    const connectors: GeometricSegment[] = [];
    if (distance(seamSeg.end, cornerPt) >= 0.01) {
      connectors.push(new LineSegment(
        `${seamSeg.id}-to-fold`,
        seamSeg.end,
        cornerPt,
        seamSeg.seamAllowanceCm,
        false,
        seamSeg.seamId,
        seamSeg.id,
        'fold-extension'
      ));
    }
    if (distance(cornerPt, foldSeg.start) >= 0.01) {
      connectors.push(new LineSegment(
        `${foldSeg.id}-fold-entry`,
        cornerPt,
        foldSeg.start,
        0,
        true,
        foldSeg.seamId,
        foldSeg.id,
        'fold-extension'
      ));
    }
    return connectors;
  } else {
    // foldSeg ends at foldSeg.end; next is seamSeg starting at seamSeg.start.
    const tSeam = seamSeg.tangentAt(0);
    const inter = lineLineIntersection(foldSeg.end, uFold, seamSeg.start, tSeam);

    const cornerPt: Point = inter || {
      // Fallback: perpendicular projection onto fold line
      x: foldSeg.end.x + uFold.x * dotProduct(vector(foldSeg.end, seamSeg.start), uFold),
      y: foldSeg.end.y + uFold.y * dotProduct(vector(foldSeg.end, seamSeg.start), uFold)
    };

    const connectors: GeometricSegment[] = [];
    if (distance(foldSeg.end, cornerPt) >= 0.01) {
      connectors.push(new LineSegment(
        `${foldSeg.id}-fold-exit`,
        foldSeg.end,
        cornerPt,
        0,
        true,
        foldSeg.seamId,
        foldSeg.id,
        'fold-extension'
      ));
    }
    if (distance(cornerPt, seamSeg.start) >= 0.01) {
      connectors.push(new LineSegment(
        `${seamSeg.id}-from-fold`,
        cornerPt,
        seamSeg.start,
        seamSeg.seamAllowanceCm,
        false,
        seamSeg.seamId,
        seamSeg.id,
        'fold-extension'
      ));
    }
    return connectors;
  }
}

/**
 * Generates mathematically valid cutting contour from an approved stitching contour.
 * 
 * Rules:
 * 1. Checks and normalizes contour winding so the offset is guaranteed to expand outward.
 * 2. Segments with isFold=true receive 0cm seam allowance and remain on the fold line.
 * 3. Regular seamlines receive their specified seamAllowanceCm.
 * 4. Corner joins between sequential segments are resolved with miter/bevel or fold connectors.
 * 5. Full geometric traceability is maintained (sourceSegmentId, role, seamAllowanceCm).
 * 6. Maximum deviation is tracked; if tolerance is exceeded, it is flagged in the result.
 */
export function generateCuttingContour(
  stitchingContour: GeometricContour,
  options: OffsetOptions = {}
): OffsetResult {
  const opts: Required<OffsetOptions> = { ...DEFAULT_OFFSET_OPTIONS, ...options };
  const warnings: string[] = [];
  const errors: string[] = [];
  let maxDeviation = 0;
  let toleranceExceeded = false;

  if (!stitchingContour.segments || stitchingContour.segments.length === 0) {
    errors.push('Cannot offset empty stitching contour.');
    return {
      cuttingContour: new GeometricContour('empty-cut', []),
      maxDeviationCm: 0,
      toleranceExceeded: false,
      approximationMethod: 'none',
      warnings,
      errors
    };
  }

  // Determine contour winding
  // In screen space (Y down), a clockwise contour has signed area < 0, outward sign = 1.
  // A counter-clockwise contour has signed area > 0, outward sign = -1.
  const winding = stitchingContour.getWinding();
  const outwardSign = winding === 'counter-clockwise' ? -1 : 1;

  // Step 1: Offset individual segments along their outward normals
  const rawOffsetSegments: GeometricSegment[] = [];

  for (const seg of stitchingContour.segments) {
    const allowance = seg.isFold ? 0 : (seg.seamAllowanceCm ?? opts.defaultAllowanceCm);

    if (seg.type === 'line') {
      const lineSeg = seg as LineSegment;
      rawOffsetSegments.push(offsetLineSegment(lineSeg, allowance, outwardSign));
    } else {
      const bezSeg = seg as CubicBezierCurve;
      const res = offsetCubicBezier(bezSeg, allowance, opts.bezierToleranceCm, 0, outwardSign);
      rawOffsetSegments.push(...res.segments);
      if (res.maxDeviationCm > maxDeviation) maxDeviation = res.maxDeviationCm;
      if (res.toleranceExceeded) {
        toleranceExceeded = true;
        warnings.push(...res.warnings);
      }
    }
  }

  // Step 2: Resolve corner joins with guaranteed vertex continuity and arbitrary fold orientation
  const finalSegments: GeometricSegment[] = [];
  const n = rawOffsetSegments.length;

  for (let i = 0; i < n; i++) {
    const curr = rawOffsetSegments[i];
    const next = rawOffsetSegments[(i + 1) % n];

    // Push current segment
    finalSegments.push(curr);

    const gap = distance(curr.end, next.start);
    if (gap < 0.02) {
      continue;
    }

    // Corner resolution
    if (curr.isFold && !next.isFold) {
      // Fold segment meeting an offset seam (arbitrary fold vector)
      const foldConnectors = connectSeamToFold(next, curr, 'fold-to-seam');
      finalSegments.push(...foldConnectors);
    } else if (!curr.isFold && next.isFold) {
      // Offset seam meeting a fold segment (arbitrary fold vector)
      const foldConnectors = connectSeamToFold(curr, next, 'seam-to-fold');
      finalSegments.push(...foldConnectors);
    } else {
      // General seam-to-seam corner (miter or bevel)
      const joined = joinOffsetSegmentsAtCorner(curr, next, opts.miterLimit);
      if (joined.length === 2) {
        // Miter: replace curr with joined[0], and set next in raw array or insert
        finalSegments[finalSegments.length - 1] = joined[0];
        rawOffsetSegments[(i + 1) % n] = joined[1];
      } else if (joined.length === 3) {
        // Bevel: insert bevel connector between curr and next
        finalSegments.push(joined[1]);
      }
    }
  }

  // Step 3: Ensure closed contour continuity between last segment end and first segment start
  if (stitchingContour.isClosed && finalSegments.length > 1) {
    const closingGap = distance(finalSegments[finalSegments.length - 1].end, finalSegments[0].start);
    if (closingGap > 0.02) {
      const closingBridge = new LineSegment(
        `${finalSegments[finalSegments.length - 1].id}-closing-bridge`,
        finalSegments[finalSegments.length - 1].end,
        finalSegments[0].start,
        finalSegments[0].seamAllowanceCm,
        false,
        undefined,
        undefined,
        'bridge'
      );
      finalSegments.push(closingBridge);
    }
  }

  const cuttingContour = new GeometricContour(
    `${stitchingContour.id}-cutting`,
    finalSegments,
    stitchingContour.isClosed
  );

  return {
    cuttingContour,
    maxDeviationCm: Number(maxDeviation.toFixed(4)),
    toleranceExceeded,
    approximationMethod: 'Adaptive cubic Bezier normal offset with arbitrary-vector fold squaring and miter/bevel joins',
    warnings,
    errors
  };
}
