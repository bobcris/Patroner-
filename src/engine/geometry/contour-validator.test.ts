/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineSegment, GeometricContour } from './primitives';
import { validateContourIntegrity } from './contour-validator';

describe('Contour Integrity Validator (Milestone 02)', () => {
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
  });

  it('detects degenerate segments with near-zero length', () => {
    const degenerateContour = new GeometricContour('degen', [
      new LineSegment('s1', { x: 0, y: 0 }, { x: 10, y: 0 }),
      new LineSegment('s-zero', { x: 10, y: 0 }, { x: 10.002, y: 0 }), // 0.002 cm < 0.01 cm threshold
      new LineSegment('s2', { x: 10.002, y: 0 }, { x: 10.002, y: 20 }),
      new LineSegment('s3', { x: 10.002, y: 20 }, { x: 0, y: 20 }),
      new LineSegment('s4', { x: 0, y: 20 }, { x: 0, y: 0 })
    ], true);

    const result = validateContourIntegrity(degenerateContour, 'Degenerate Contour');
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.includes('Degenerate segment')));
  });

  it('detects self-intersecting loops (e.g. hourglass/figure-8 contour)', () => {
    // Hourglass crossing between (0,0)->(10,10) and (10,0)->(0,10)
    const figure8Contour = new GeometricContour('fig8', [
      new LineSegment('diag1', { x: 0, y: 0 }, { x: 10, y: 10 }),
      new LineSegment('top', { x: 10, y: 10 }, { x: 0, y: 10 }),
      new LineSegment('diag2', { x: 0, y: 10 }, { x: 10, y: 0 }),
      new LineSegment('bottom', { x: 10, y: 0 }, { x: 0, y: 0 })
    ], true);

    const result = validateContourIntegrity(figure8Contour, 'Self-Intersecting Contour');
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.includes('self-intersects')));
  });
});
