/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ValidationCheck } from '../../types';
import { distance } from './math';
import { doSegmentsIntersect, GeometricContour } from './primitives';

export interface ContourValidationResult {
  isValid: boolean;
  checks: ValidationCheck[];
  errors: string[];
  warnings: string[];
}

export const CONTINUITY_TOLERANCE_CM = 0.05; // 0.5 mm tolerance between sequential vertices
export const MIN_SEGMENT_LENGTH_CM = 0.01; // 0.1 mm minimum length before flagged as degenerate

/**
 * Validates topological integrity of a 2D pattern contour:
 * 1. Closure: First segment start matches last segment end.
 * 2. Continuity: Each segment's end matches the next segment's start without open gaps.
 * 3. Degenerate Segments: Detects zero-length or collapsed segments.
 * 4. Self-Intersections: Detects self-intersecting loops in the contour.
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
      category: 'contour-integrity',
      name: `${contourName} Existence`,
      status: 'fail',
      message: msg
    });
    return { isValid: false, checks, errors, warnings };
  }

  const segments = contour.segments;
  const n = segments.length;

  // 1. Closed Loop Check
  if (contour.isClosed) {
    const gap = distance(segments[0].start, segments[n - 1].end);
    if (gap > CONTINUITY_TOLERANCE_CM) {
      const msg = `${contourName} is open: gap of ${gap.toFixed(2)} cm between first vertex and last vertex.`;
      errors.push(msg);
      checks.push({
        id: `val-contour-closed-${contour.id}`,
        category: 'contour-integrity',
        name: `${contourName} Closure`,
        status: 'fail',
        measuredValue: `Gap: ${gap.toFixed(2)} cm`,
        expectedValue: `<= ${CONTINUITY_TOLERANCE_CM} cm`,
        deviationCm: gap,
        toleranceCm: CONTINUITY_TOLERANCE_CM,
        message: msg
      });
    } else {
      checks.push({
        id: `val-contour-closed-${contour.id}`,
        category: 'contour-integrity',
        name: `${contourName} Closure`,
        status: 'pass',
        measuredValue: `Gap: ${gap.toFixed(2)} cm`,
        message: `${contourName} is closed within tolerance (${gap.toFixed(2)} cm).`
      });
    }
  }

  // 2. Sequential Continuity Check
  let hasDiscontinuity = false;
  for (let i = 0; i < n - 1; i++) {
    const gap = distance(segments[i].end, segments[i + 1].start);
    if (gap > CONTINUITY_TOLERANCE_CM) {
      hasDiscontinuity = true;
      const msg = `Discontinuity in ${contourName} between segment [${segments[i].id}] and [${segments[i + 1].id}]: gap = ${gap.toFixed(2)} cm.`;
      errors.push(msg);
      checks.push({
        id: `val-continuity-${segments[i].id}`,
        category: 'contour-integrity',
        name: `${contourName} Vertex Continuity`,
        status: 'fail',
        measuredValue: `${gap.toFixed(2)} cm`,
        expectedValue: `<= ${CONTINUITY_TOLERANCE_CM} cm`,
        deviationCm: gap,
        toleranceCm: CONTINUITY_TOLERANCE_CM,
        message: msg
      });
    }
  }

  if (!hasDiscontinuity) {
    checks.push({
      id: `val-continuity-all-${contour.id}`,
      category: 'contour-integrity',
      name: `${contourName} Sequential Continuity`,
      status: 'pass',
      message: `All ${n} segments connect without coordinate gaps.`
    });
  }

  // 3. Degenerate Segment Check
  let degenerateCount = 0;
  for (const seg of segments) {
    const len = seg.lengthCm();
    if (len < MIN_SEGMENT_LENGTH_CM) {
      degenerateCount++;
      const msg = `Degenerate segment [${seg.id}] has near-zero length (${len.toFixed(3)} cm).`;
      errors.push(msg);
      checks.push({
        id: `val-degen-${seg.id}`,
        category: 'contour-integrity',
        name: `Segment Length: ${seg.id}`,
        status: 'fail',
        measuredValue: `${len.toFixed(3)} cm`,
        expectedValue: `>= ${MIN_SEGMENT_LENGTH_CM} cm`,
        message: msg
      });
    }
  }

  if (degenerateCount === 0) {
    checks.push({
      id: `val-no-degen-${contour.id}`,
      category: 'contour-integrity',
      name: `${contourName} Segment Viability`,
      status: 'pass',
      message: `All segments exceed minimum length threshold (${MIN_SEGMENT_LENGTH_CM} cm).`
    });
  }

  // 4. Non-adjacent Self-Intersection Check
  let selfIntersecting = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent segments and wraparound adjacent
      if (i === 0 && j === n - 1) continue;

      const seg1 = segments[i];
      const seg2 = segments[j];

      // Skip local corner cluster segments (subdivisions and miter/bevel connectors within 1.0 cm)
      if (
        distance(seg1.end, seg2.start) < 1.0 ||
        distance(seg1.start, seg2.end) < 1.0 ||
        distance(seg1.start, seg2.start) < 1.0 ||
        distance(seg1.end, seg2.end) < 1.0
      ) {
        continue;
      }

      // For approximation, test bounding segment chords
      if (doSegmentsIntersect(seg1.start, seg1.end, seg2.start, seg2.end)) {
        selfIntersecting = true;
        const msg = `${contourName} self-intersects between segment [${seg1.id}] and [${seg2.id}].`;
        errors.push(msg);
        checks.push({
          id: `val-self-intersect-${seg1.id}-${seg2.id}`,
          category: 'contour-integrity',
          name: `${contourName} Self-Intersection`,
          status: 'fail',
          message: msg
        });
      }
    }
  }

  if (!selfIntersecting) {
    checks.push({
      id: `val-no-self-intersect-${contour.id}`,
      category: 'contour-integrity',
      name: `${contourName} Planar Topology`,
      status: 'pass',
      message: `${contourName} is simple and non-self-intersecting.`
    });
  }

  return {
    isValid: errors.length === 0,
    checks,
    errors,
    warnings
  };
}
