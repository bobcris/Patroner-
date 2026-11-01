/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineSegment, CubicBezierCurve, GeometricContour } from './primitives';
import { validateContourIntegrity } from './contour-validator';
import { generateCuttingContour } from './offset';

describe('Contour Integrity Validator (Milestone 02 Corrective Pass)', () => {
  it('validates a continuous, closed rectangular contour successfully', () => {
    const contour = new GeometricContour('rect', [
      new LineSegment('bottom', { x: 0, y: 0 }, { x: 10, y: 0 }),
      new LineSegment('right', { x: 10, y: 0 }, { x: 10, y: 20 }),
      new LineSegment('top', { x: 10, y: 20 }, { x: 0, y: 20 }),
      new LineSegment('left', { x: 0, y: 20 }, { x: 0, y: 0 })
    ], true);

    const result = validateContourIntegrity(contour, 'Test Rectangle');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.errors.length, 0);
    assert.ok(result.checks.every(c => c.status === 'pass'));
  });

  it('detects closure failure when first and last vertex do not meet', () => {
    const openContour = new GeometricContour('open', [
      new LineSegment('s1', { x: 0, y: 0 }, { x: 10, y: 0 }),
      new LineSegment('s2', { x: 10, y: 0 }, { x: 10, y: 20 }),
      new LineSegment('s3', { x: 10, y: 20 }, { x: 0, y: 20 }),
      new LineSegment('s4', { x: 0, y: 20 }, { x: 0, y: 5 }) // Gap of 5cm back to (0,0)
    ], true);

    const result = validateContourIntegrity(openContour, 'Open Contour');
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.includes('gap of 5.00 cm')));
    const closureCheck = result.checks.find(c => c.id === 'val-contour-closed-open');
    assert.ok(closureCheck);
    assert.strictEqual(closureCheck.status, 'fail');
    assert.strictEqual(closureCheck.errorCode, 'VAL-CONTOUR-OPEN');
  });

  it('detects coordinate discontinuity between sequential segments', () => {
    const brokenContour = new GeometricContour('broken', [
      new LineSegment('s1', { x: 0, y: 0 }, { x: 10, y: 0 }),
      // s2 starts at (10.5, 0), creating a 0.5cm gap
      new LineSegment('s2', { x: 10.5, y: 0 }, { x: 10.5, y: 20 }),
      new LineSegment('s3', { x: 10.5, y: 20 }, { x: 0, y: 20 }),
      new LineSegment('s4', { x: 0, y: 20 }, { x: 0, y: 0 })
    ], true);

    const result = validateContourIntegrity(brokenContour, 'Broken Contour');
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.includes('Discontinuity')));
    const gapCheck = result.checks.find(c => c.errorCode === 'VAL-CONTINUITY-GAP');
    assert.ok(gapCheck);
    assert.strictEqual(gapCheck.status, 'fail');
  });

  it('detects degenerate segments with near-zero length', () => {
    const degenerateContour = new GeometricContour('degen', [
      new LineSegment('s1', { x: 0, y: 0 }, { x: 10, y: 0 }),
      new LineSegment('s-zero', { x: 10, y: 0 }, { x: 10.002, y: 0 }), // 0.002 cm < 0.01 cm threshold
      new LineSegment('s2', { x: 10.002, y: 0 }, { x: 10.002, y: 20 }),
      new LineSegment('s3', { x: 10.002, y: 20 }, { x: 0, y: 20 }),
      new LineSegment('s4', { x: 0, y: 20 }, { x: 0, y: 0 })
    ], true);

    const result = validateContourIntegrity(degenerateContour, 'Degen Contour');
    assert.strictEqual(result.isValid, false);
    const degenCheck = result.checks.find(c => c.id === 'val-degen-s-zero');
    assert.ok(degenCheck);
    assert.strictEqual(degenCheck.status, 'fail');
    assert.strictEqual(degenCheck.errorCode, 'VAL-ZERO-LENGTH');
  });

  it('detects invalid non-finite coordinates (NaN or Infinity)', () => {
    const nanContour = new GeometricContour('nan-contour', [
      new LineSegment('valid1', { x: 0, y: 0 }, { x: 10, y: NaN }),
      new LineSegment('valid2', { x: 10, y: 0 }, { x: 0, y: 0 })
    ], true);

    const result = validateContourIntegrity(nanContour, 'NaN Contour');
    assert.strictEqual(result.isValid, false);
    const coordCheck = result.checks.find(c => c.errorCode === 'VAL-COORD-INVALID');
    assert.ok(coordCheck);
    assert.strictEqual(coordCheck.status, 'fail');
  });

  it('detects self-intersecting straight loops (hourglass / figure-8 contour)', () => {
    // Hourglass crossing lines: (0,0) -> (10, 20) -> (0, 20) -> (10, 0) -> (0,0)
    const hourglass = new GeometricContour('hourglass', [
      new LineSegment('diag1', { x: 0, y: 0 }, { x: 10, y: 20 }),
      new LineSegment('top', { x: 10, y: 20 }, { x: 0, y: 20 }),
      new LineSegment('diag2', { x: 0, y: 20 }, { x: 10, y: 0 }),
      new LineSegment('bottom', { x: 10, y: 0 }, { x: 0, y: 0 })
    ], true);

    const result = validateContourIntegrity(hourglass, 'Hourglass');
    assert.strictEqual(result.isValid, false);
    const selfInterCheck = result.checks.find(c => c.errorCode === 'VAL-SELF-INTERSECT');
    assert.ok(selfInterCheck);
    assert.strictEqual(selfInterCheck.status, 'fail');
    assert.ok(result.errors.some(e => e.includes('self-intersects')));
  });

  it('detects self-intersection involving curved Bézier segments (curve-aware check)', () => {
    // A curve that bows deeply across an opposing boundary line
    // Top boundary at y = 10 from x=0 to x=20
    // Right at x=20 from y=10 to y=0
    // Bottom at y=0 from x=20 to x=0
    // Left edge from (0,0) to (0,10) is a curve bowing all the way across x=15 (intersecting the top line)
    const curvedLoop = new GeometricContour('curved-loop', [
      new CubicBezierCurve('deep-bow', { x: 0, y: 0 }, { x: 15, y: 15 }, { x: 15, y: 15 }, { x: 0, y: 10 }),
      new LineSegment('top', { x: 0, y: 10 }, { x: 20, y: 10 }),
      new LineSegment('right', { x: 20, y: 10 }, { x: 20, y: 0 }),
      new LineSegment('bottom', { x: 20, y: 0 }, { x: 0, y: 0 })
    ], true);

    const result = validateContourIntegrity(curvedLoop, 'Curved Loop');
    assert.strictEqual(result.isValid, false);
    const selfInterCheck = result.checks.find(c => c.errorCode === 'VAL-SELF-INTERSECT');
    assert.ok(selfInterCheck, 'Must detect curve self-intersection across top line');
    assert.strictEqual(selfInterCheck.status, 'fail');
  });

  it('detects collapsed or collinear contours enclosing near-zero area', () => {
    const flatContour = new GeometricContour('flat', [
      new LineSegment('f1', { x: 0, y: 0 }, { x: 20, y: 0 }),
      new LineSegment('f2', { x: 20, y: 0 }, { x: 0, y: 0 })
    ], true);

    const result = validateContourIntegrity(flatContour, 'Flat Contour');
    assert.strictEqual(result.isValid, false);
    const areaCheck = result.checks.find(c => c.errorCode === 'VAL-COLLAPSED-AREA');
    assert.ok(areaCheck);
    assert.strictEqual(areaCheck.status, 'fail');
  });

  it('detects invalid fold edge carrying non-zero seam allowance', () => {
    const badFoldContour = new GeometricContour('bad-fold', [
      new LineSegment('fold', { x: 0, y: 0 }, { x: 0, y: 20 }, 1.5, true), // Fold with 1.5cm is illegal
      new LineSegment('bottom', { x: 0, y: 20 }, { x: 10, y: 20 }, 2.0),
      new LineSegment('side', { x: 10, y: 20 }, { x: 10, y: 0 }, 1.5),
      new LineSegment('top', { x: 10, y: 0 }, { x: 0, y: 0 }, 1.0)
    ], true);

    const result = validateContourIntegrity(badFoldContour, 'Bad Fold');
    assert.strictEqual(result.isValid, false);
    const foldCheck = result.checks.find(c => c.errorCode === 'VAL-FOLD-ALLOWANCE');
    assert.ok(foldCheck);
    assert.strictEqual(foldCheck.status, 'fail');
  });

  describe('Integration: Stitching-to-Cutting Independence', () => {
    it('ensures applying seam allowance never modifies stitching-line measurements', () => {
      const stitching = new GeometricContour('stitch-test', [
        new LineSegment('cf', { x: 0, y: 0 }, { x: 0, y: 40 }, 0, true),
        new LineSegment('hem', { x: 0, y: 40 }, { x: 25, y: 40 }, 3.0),
        new LineSegment('side', { x: 25, y: 40 }, { x: 25, y: 0 }, 1.5),
        new LineSegment('waist', { x: 25, y: 0 }, { x: 0, y: 0 }, 1.0)
      ], true);

      const originalStitchLength = stitching.totalLengthCm();
      assert.strictEqual(originalStitchLength, 130);

      // Generate cutting contour with large allowances
      const res = generateCuttingContour(stitching, { defaultAllowanceCm: 2.5 });
      const cutting = res.cuttingContour;

      // Stitching contour must remain completely intact and unchanged
      assert.strictEqual(stitching.totalLengthCm(), 130);
      assert.strictEqual(stitching.segments[0].start.x, 0);
      assert.strictEqual(stitching.segments[0].start.y, 0);

      // Cutting contour must be strictly larger
      assert.ok(cutting.totalLengthCm() > originalStitchLength);
    });
  });

  describe('Milestone 02.1: Adaptive Curve Intersection & Fold Acceptance', () => {
    it('Priority 3: detects self-crossing loops within a single high-curvature Bezier segment', () => {
      // Loop curve (alpha-curve) where the curve loops over itself:
      // p0=(-10,0), cp1=(20, 20), cp2=(-20, 20), p3=(10,0) - loops over itself in the interior
      const loopContour = new GeometricContour('loop-curve-contour', [
        new CubicBezierCurve('alpha-loop', { x: -10, y: 0 }, { x: 20, y: 20 }, { x: -20, y: 20 }, { x: 10, y: 0 })
      ], false);

      const res = validateContourIntegrity(loopContour, 'Alpha Loop');
      assert.strictEqual(res.isValid, false);
      const selfCheck = res.checks.find(c => c.errorCode === 'VAL-SELF-INTERSECT');
      assert.ok(selfCheck, 'Adaptive discretization must detect self-crossing loop within single curve');
      assert.strictEqual(selfCheck.status, 'fail');
    });

    it('Priority 3: validates close curve-to-curve near-tangent geometry without false positives', () => {
      // Two curved segments that approach closely but do NOT cross
      const closeCurves = new GeometricContour('close-curves', [
        new CubicBezierCurve('top-curve', { x: 0, y: 0 }, { x: 10, y: 4 }, { x: 20, y: 4 }, { x: 30, y: 0 }),
        new LineSegment('right-edge', { x: 30, y: 0 }, { x: 30, y: 20 }),
        new CubicBezierCurve('bottom-curve', { x: 30, y: 20 }, { x: 20, y: 6 }, { x: 10, y: 6 }, { x: 0, y: 20 }),
        new LineSegment('left-edge', { x: 0, y: 20 }, { x: 0, y: 0 })
      ], true);

      const res = validateContourIntegrity(closeCurves, 'Close Curves');
      assert.strictEqual(res.isValid, true, 'Non-intersecting proximity must not produce false self-intersections');
      const selfCheck = res.checks.find(c => c.errorCode === 'VAL-SELF-INTERSECT');
      assert.strictEqual(selfCheck, undefined);
    });

    it('Priority 4: permits zero seam allowance on non-fold edges without error', () => {
      // Non-fold edge with 0 allowance (e.g. hem with separate binding tape)
      const validZeroAllowance = new GeometricContour('valid-zero', [
        new LineSegment('fold-cf', { x: 0, y: 0 }, { x: 0, y: 30 }, 0, true),
        new LineSegment('raw-hem', { x: 0, y: 30 }, { x: 20, y: 30 }, 0, false), // 0cm, isFold: false
        new LineSegment('side-seam', { x: 20, y: 30 }, { x: 20, y: 0 }, 1.5, false),
        new LineSegment('waist-seam', { x: 20, y: 0 }, { x: 0, y: 0 }, 1.0, false)
      ], true);

      const res = validateContourIntegrity(validZeroAllowance, 'Valid Zero Allowance');
      assert.strictEqual(res.isValid, true);
      const foldErrors = res.checks.filter(c => c.errorCode === 'VAL-FOLD-ALLOWANCE');
      assert.strictEqual(foldErrors.length, 0);
    });
  });
});
