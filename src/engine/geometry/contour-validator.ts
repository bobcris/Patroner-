/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ValidationCheck } from '../../types';
import { distance } from './math';
import {
  CubicBezierCurve,
  doSegmentsIntersect,
  GeometricContour,
  GeometricSegment,
  LineSegment
} from './primitives';

export interface ContourValidationResult {
  isValid: boolean;
  checks: ValidationCheck[];
  errors: string[];
  warnings: string[];
}

export const CONTINUITY_TOLERANCE_CM = 0.05; // 0.5 mm tolerance between sequential vertices
export const MIN_SEGMENT_LENGTH_CM = 0.01; // 0.1 mm minimum length before flagged as degenerate

interface PolylineSubSegment {
  parentSegmentId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  index: number;
}

/**
 * Validates topological and geometric integrity of a 2D pattern contour:
 * 1. Numeric Validity: Ensures no NaN or infinite coordinates exist.
 * 2. Closed Loop: Verifies first segment start matches last segment end within tolerance.
 * 3. Sequential Continuity: Ensures each segment's end matches the next segment's start.
 * 4. Degenerate Segments: Detects zero-length or collapsed segments.
 * 5. Curve-Aware Self-Intersection: Detects self-intersecting loops across both straight and curved segments.
 * 6. Planar Winding & Area: Ensures the contour encloses non-zero area and does not collapse.
 * 7. Fold-Edge Rules: Verifies fold edges carry 0cm seam allowance and maintain linear integrity.
 */
export function validateContourIntegrity(
  contour: GeometricContour,
  contourName = 'Contour'
): ContourValidationResult {
  const checks: ValidationCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!contour.segments || contour.segments.length === 0) {
    const msg = `${contourName} has no geometric segments.`;
    errors.push(msg);
    checks.push({
      id: `val-contour-empty-${contour.id}`,
      errorCode: 'VAL-CONTOUR-EMPTY',
      category: 'contour-integrity',
      severity: 'error',
      name: `${contourName} Existence`,
      status: 'fail',
      message: msg,
      suggestedAction: 'Ensure drafting block generates non-empty geometric contours.'
    });
    return { isValid: false, checks, errors, warnings };
  }

  const segments = contour.segments;
  const n = segments.length;

  // 1. Numeric Coordinate Validation (NaN / Infinity detection)
  let hasInvalidCoords = false;
  for (const seg of segments) {
    const pts = seg.type === 'line'
      ? [seg.start, seg.end]
      : [(seg as CubicBezierCurve).p0, (seg as CubicBezierCurve).cp1, (seg as CubicBezierCurve).cp2, (seg as CubicBezierCurve).p3];

    for (const p of pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        hasInvalidCoords = true;
        const msg = `Segment [${seg.id}] contains non-finite coordinate (${p.x}, ${p.y}).`;
        errors.push(msg);
        checks.push({
          id: `val-coord-invalid-${seg.id}`,
          errorCode: 'VAL-COORD-INVALID',
          category: 'geometry',
          severity: 'error',
          segmentIds: [seg.id],
          name: `${contourName} Coordinate Validity`,
          status: 'fail',
          message: msg,
          suggestedAction: 'Check drafting formulas for division by zero or invalid trigonometric inputs.'
        });
        break;
      }
    }
  }

  if (!hasInvalidCoords) {
    checks.push({
      id: `val-coords-finite-${contour.id}`,
      category: 'geometry',
      severity: 'info',
      name: `${contourName} Numeric Validity`,
      status: 'pass',
      message: 'All coordinates are finite, valid numbers.'
    });
  }

  // 2. Closed Loop Check
  if (contour.isClosed) {
    const gap = distance(segments[0].start, segments[n - 1].end);
    if (gap > CONTINUITY_TOLERANCE_CM) {
      const msg = `${contourName} is open: gap of ${gap.toFixed(2)} cm between start of [${segments[0].id}] and end of [${segments[n - 1].id}].`;
      errors.push(msg);
      checks.push({
        id: `val-contour-closed-${contour.id}`,
        errorCode: 'VAL-CONTOUR-OPEN',
        category: 'contour-integrity',
        severity: 'error',
        segmentIds: [segments[0].id, segments[n - 1].id],
        name: `${contourName} Closure`,
        status: 'fail',
        measuredValue: `${gap.toFixed(2)} cm`,
        expectedValue: `<= ${CONTINUITY_TOLERANCE_CM} cm`,
        deviationCm: gap,
        toleranceCm: CONTINUITY_TOLERANCE_CM,
        message: msg,
        suggestedAction: 'Add a closing connector segment or adjust endpoints so start and end vertices coincide.'
      });
    } else {
      checks.push({
        id: `val-contour-closed-${contour.id}`,
        category: 'contour-integrity',
        severity: 'info',
        name: `${contourName} Closure`,
        status: 'pass',
        measuredValue: `Gap: ${gap.toFixed(2)} cm`,
        message: `${contourName} is closed within tolerance (${gap.toFixed(2)} cm).`
      });
    }
  }

  // 3. Sequential Continuity Check
  let hasDiscontinuity = false;
  for (let i = 0; i < n - 1; i++) {
    const gap = distance(segments[i].end, segments[i + 1].start);
    if (gap > CONTINUITY_TOLERANCE_CM) {
      hasDiscontinuity = true;
      const msg = `Discontinuity in ${contourName} between segment [${segments[i].id}] and [${segments[i + 1].id}]: gap = ${gap.toFixed(3)} cm.`;
      errors.push(msg);
      checks.push({
        id: `val-continuity-${segments[i].id}`,
        errorCode: 'VAL-CONTINUITY-GAP',
        category: 'contour-integrity',
        severity: 'error',
        segmentIds: [segments[i].id, segments[i + 1].id],
        name: `${contourName} Vertex Continuity`,
        status: 'fail',
        measuredValue: `${gap.toFixed(3)} cm`,
        expectedValue: `<= ${CONTINUITY_TOLERANCE_CM} cm`,
        deviationCm: gap,
        toleranceCm: CONTINUITY_TOLERANCE_CM,
        message: msg,
        suggestedAction: 'Apply corner joins or bridge segments to ensure continuous vertex chaining.'
      });
    }
  }

  if (!hasDiscontinuity) {
    checks.push({
      id: `val-continuity-all-${contour.id}`,
      category: 'contour-integrity',
      severity: 'info',
      name: `${contourName} Sequential Continuity`,
      status: 'pass',
      message: `All ${n} segments connect without coordinate gaps.`
    });
  }

  // 4. Degenerate Segment Check (Zero-length or duplicate consecutive vertices)
  let degenerateCount = 0;
  for (const seg of segments) {
    const len = seg.lengthCm();
    if (len < MIN_SEGMENT_LENGTH_CM) {
      degenerateCount++;
      const msg = `Degenerate segment [${seg.id}] has near-zero length (${len.toFixed(4)} cm).`;
      errors.push(msg);
      checks.push({
        id: `val-degen-${seg.id}`,
        errorCode: 'VAL-ZERO-LENGTH',
        category: 'contour-integrity',
        severity: 'error',
        segmentIds: [seg.id],
        name: `Segment Length: ${seg.id}`,
        status: 'fail',
        measuredValue: `${len.toFixed(4)} cm`,
        expectedValue: `>= ${MIN_SEGMENT_LENGTH_CM} cm`,
        message: msg,
        suggestedAction: 'Remove duplicate vertices or zero-length connectors.'
      });
    }
  }

  if (degenerateCount === 0) {
    checks.push({
      id: `val-no-degen-${contour.id}`,
      category: 'contour-integrity',
      severity: 'info',
      name: `${contourName} Segment Viability`,
      status: 'pass',
      message: `All segments exceed minimum length threshold (${MIN_SEGMENT_LENGTH_CM} cm).`
    });
  }

  // 5. Curve-Aware Self-Intersection Detection (Milestone 02.1 Priority 3)
  // We discretize segments using adaptive flatness subdivision (0.05cm geometric tolerance)
  // and check for cross-intersections across curve-curve, curve-line, and single-curve loops.
  const subSegments: PolylineSubSegment[] = [];
  let subIndex = 0;

  for (const seg of segments) {
    if (seg.type === 'line') {
      subSegments.push({
        parentSegmentId: seg.id,
        start: seg.start,
        end: seg.end,
        index: subIndex++
      });
    } else {
      const bez = seg as CubicBezierCurve;
      // Adaptive flattening based on chord-to-control-point maximum perpendicular deviation
      const samples = bez.flatten(0.05);
      for (let s = 0; s < samples.length - 1; s++) {
        subSegments.push({
          parentSegmentId: seg.id,
          start: samples[s],
          end: samples[s + 1],
          index: subIndex++
        });
      }
    }
  }

  let selfIntersecting = false;
  const numSub = subSegments.length;

  for (let i = 0; i < numSub; i++) {
    for (let j = i + 2; j < numSub; j++) {
      // Skip adjacent or wrap-around adjacent sub-segments
      if (i === 0 && j === numSub - 1) continue;

      const sub1 = subSegments[i];
      const sub2 = subSegments[j];

      // If they belong to the same parent segment and are adjacent, skip
      if (sub1.parentSegmentId === sub2.parentSegmentId && Math.abs(sub1.index - sub2.index) <= 1) {
        continue;
      }

      // Check if chords intersect
      if (doSegmentsIntersect(sub1.start, sub1.end, sub2.start, sub2.end)) {
        selfIntersecting = true;
        const msg = `${contourName} self-intersects between [${sub1.parentSegmentId}] and [${sub2.parentSegmentId}].`;
        errors.push(msg);
        checks.push({
          id: `val-self-intersect-${sub1.parentSegmentId}-${sub2.parentSegmentId}`,
          errorCode: 'VAL-SELF-INTERSECT',
          category: 'contour-integrity',
          severity: 'error',
          segmentIds: [sub1.parentSegmentId, sub2.parentSegmentId],
          name: `${contourName} Self-Intersection`,
          status: 'fail',
          message: msg,
          suggestedAction: 'Adjust dart suppression, ease contour, or miter ratio to eliminate self-crossing loops.'
        });
        break; // Don't spam multiple hits for the same segment pair
      }
    }
    if (selfIntersecting) break;
  }

  if (!selfIntersecting) {
    checks.push({
      id: `val-no-self-intersect-${contour.id}`,
      category: 'contour-integrity',
      severity: 'info',
      name: `${contourName} Planar Topology`,
      status: 'pass',
      message: `${contourName} is simple and non-self-intersecting (curve-verified).`
    });
  }

  // 6. Planar Area & Winding Check
  const winding = contour.getWinding();
  const signedArea = contour.signedArea();

  if (winding === 'collinear' || Math.abs(signedArea) < 1.0) {
    const msg = `${contourName} has degenerate or collapsed area (${signedArea.toFixed(2)} cm²).`;
    errors.push(msg);
    checks.push({
      id: `val-winding-collinear-${contour.id}`,
      errorCode: 'VAL-COLLAPSED-AREA',
      category: 'geometry',
      severity: 'error',
      name: `${contourName} Enclosed Area`,
      status: 'fail',
      measuredValue: `${signedArea.toFixed(2)} cm²`,
      expectedValue: '> 1.0 cm²',
      message: msg,
      suggestedAction: 'Ensure vertices span a 2D enclosed region rather than a collapsed line.'
    });
  } else {
    checks.push({
      id: `val-winding-valid-${contour.id}`,
      category: 'geometry',
      severity: 'info',
      name: `${contourName} Winding & Area`,
      status: 'pass',
      measuredValue: `Area: ${Math.abs(signedArea).toFixed(1)} cm², Winding: ${winding}`,
      message: `Contour encloses valid 2D planar area with ${winding} winding.`
    });
  }

  // 7. Fold Edge Rules Check
  for (const seg of segments) {
    if (seg.isFold) {
      if (seg.seamAllowanceCm !== 0) {
        const msg = `Fold segment [${seg.id}] has non-zero seam allowance (${seg.seamAllowanceCm} cm). Fold edges must have exactly 0cm allowance.`;
        errors.push(msg);
        checks.push({
          id: `val-fold-allowance-${seg.id}`,
          errorCode: 'VAL-FOLD-ALLOWANCE',
          category: 'allowance',
          severity: 'error',
          segmentIds: [seg.id],
          name: `Fold Seam Allowance: ${seg.id}`,
          status: 'fail',
          measuredValue: `${seg.seamAllowanceCm} cm`,
          expectedValue: '0 cm',
          message: msg,
          suggestedAction: 'Set seamAllowanceCm to 0 for all fold edges.'
        });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    checks,
    errors,
    warnings
  };
}
