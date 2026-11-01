/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineSegment, CubicBezierCurve, GeometricContour } from './primitives';
import {
  offsetLineSegment,
  offsetCubicBezier,
  joinOffsetSegmentsAtCorner,
  generateCuttingContour,
  BEZIER_OFFSET_TOLERANCE_CM
} from './offset';
import { distance } from './math';

describe('Geometry Offset Engine (Milestone 02)', () => {
  describe('LineSegment Offset', () => {
    it('offsets a horizontal line outwards to the left/right according to normal', () => {
      // Line from (0, 0) to (10, 0), dir=(1, 0), CCW outward normal = (0, 1)
      const line = new LineSegment('test-h', { x: 0, y: 0 }, { x: 10, y: 0 });
      const offsetD1 = offsetLineSegment(line, 1.0);

      assert.strictEqual(offsetD1.id, 'test-h-cut');
      assert.ok(Math.abs(offsetD1.start.x - 0) < 1e-4);
      assert.ok(Math.abs(offsetD1.start.y - 1) < 1e-4);
      assert.ok(Math.abs(offsetD1.end.x - 10) < 1e-4);
      assert.ok(Math.abs(offsetD1.end.y - 1) < 1e-4);
      assert.ok(Math.abs(offsetD1.lengthCm() - 10) < 1e-4);
    });

    it('offsets a vertical line correctly', () => {
      // Line from (10, 0) to (10, 20), dir=(0, 1), CCW outward normal = (-1, 0)
      const line = new LineSegment('test-v', { x: 10, y: 0 }, { x: 10, y: 20 });
      const offsetD2 = offsetLineSegment(line, 2.0);

      assert.ok(Math.abs(offsetD2.start.x - 8) < 1e-4);
      assert.ok(Math.abs(offsetD2.start.y - 0) < 1e-4);
      assert.ok(Math.abs(offsetD2.end.x - 8) < 1e-4);
      assert.ok(Math.abs(offsetD2.end.y - 20) < 1e-4);
    });

    it('produces zero offset when distance is 0', () => {
      const line = new LineSegment('test-0', { x: 5, y: 5 }, { x: 15, y: 25 });
      const offset0 = offsetLineSegment(line, 0);

      assert.ok(Math.abs(offset0.start.x - 5) < 1e-4);
      assert.ok(Math.abs(offset0.start.y - 5) < 1e-4);
      assert.ok(Math.abs(offset0.end.x - 15) < 1e-4);
      assert.ok(Math.abs(offset0.end.y - 25) < 1e-4);
    });
  });

  describe('CubicBezierCurve Offset & Adaptive Approximation', () => {
    it('approximates a cubic Bézier offset within specified manufacturing tolerance', () => {
      // Gentle curve representative of a hip curve
      const curve = new CubicBezierCurve(
        'hip-curve',
        { x: 23, y: 0 },
        { x: 24, y: 5 },
        { x: 25, y: 15 },
        { x: 25, y: 20 }
      );

      const res = offsetCubicBezier(curve, 1.0);
      assert.ok(res.segments.length >= 1, 'Should produce at least one offset curve segment');

      // Check distance from midpoints of original curve to offset curve
      // For a sampled parameter t = 0.5:
      const midOriginal = curve.pointAt(0.5);
      const normalOriginal = curve.normalAt(0.5);

      // The theoretical target offset point is midOriginal + normal * 1.0
      const targetPoint = {
        x: midOriginal.x + normalOriginal.x * 1.0,
        y: midOriginal.y + normalOriginal.y * 1.0
      };

      // Find closest point on offset segments
      let minDistance = Infinity;
      for (const seg of res.segments) {
        if (seg instanceof CubicBezierCurve) {
          for (let step = 0; step <= 20; step++) {
            const pt = seg.pointAt(step / 20);
            const d = distance(pt, targetPoint);
            if (d < minDistance) minDistance = d;
          }
        }
      }

      assert.ok(
        minDistance <= BEZIER_OFFSET_TOLERANCE_CM,
        `Offset deviation (${minDistance.toFixed(4)} cm) exceeds tolerance (${BEZIER_OFFSET_TOLERANCE_CM} cm)`
      );
    });
  });

  describe('Corner Join & Miter Limit Handling', () => {
    it('creates a clean miter intersection at a standard 90° corner', () => {
      // Corner from bottom-to-top segment, turning right
      // Seg 1: (0, 10) -> (10, 10)
      // Seg 2: (10, 10) -> (10, 0)
      const seg1 = new LineSegment('s1', { x: 0, y: 10 }, { x: 10, y: 10 });
      const seg2 = new LineSegment('s2', { x: 10, y: 10 }, { x: 10, y: 0 });

      // Outward offset by 1.0 cm
      const off1 = offsetLineSegment(seg1, 1.0); // y becomes 11
      const off2 = offsetLineSegment(seg2, 1.0); // x becomes 11

      const joined = joinOffsetSegmentsAtCorner(off1, off2, 2.5);
      // Miter join returns 2 segments meeting at the miter point (11, 11)
      assert.strictEqual(joined.length, 2);

      assert.ok(Math.abs(joined[0].end.x - 11) < 1e-3);
      assert.ok(Math.abs(joined[0].end.y - 11) < 1e-3);
      assert.ok(Math.abs(joined[1].start.x - 11) < 1e-3);
      assert.ok(Math.abs(joined[1].start.y - 11) < 1e-3);
    });

    it('falls back to a bevel join when corner is extremely acute (miter exceeds limit)', () => {
      // Very acute turn: seg1 heading right, seg2 turning sharply back left
      const seg1 = new LineSegment('acute-1', { x: 0, y: 0 }, { x: 10, y: 0 }, 2.0);
      const seg2 = new LineSegment('acute-2', { x: 10, y: 0 }, { x: 0.5, y: 0.5 }, 2.0);

      const off1 = offsetLineSegment(seg1, 2.0);
      const off2 = offsetLineSegment(seg2, 2.0);

      const joined = joinOffsetSegmentsAtCorner(off1, off2, 1.5); // Lower miter limit to trigger bevel
      assert.strictEqual(joined.length, 3, 'Bevel join must insert a connector bevel segment');
      assert.ok(joined[1] instanceof LineSegment);
    });
  });

  describe('generateCuttingContour', () => {
    it('generates a closed cutting contour with 0cm fold allowance and non-zero seam allowances', () => {
      // Simple rectangular piece on fold:
      // CF on fold: (0, 0) -> (0, 20) with 0cm allowance
      // Hem: (0, 20) -> (15, 20) with 3.0cm allowance
      // Side: (15, 20) -> (15, 0) with 1.5cm allowance
      // Waist: (15, 0) -> (0, 0) with 1.0cm allowance
      const stitching = new GeometricContour('test-rect', [
        new LineSegment('cf', { x: 0, y: 0 }, { x: 0, y: 20 }, 0, true),
        new LineSegment('hem', { x: 0, y: 20 }, { x: 15, y: 20 }, 3.0),
        new LineSegment('side', { x: 15, y: 20 }, { x: 15, y: 0 }, 1.5),
        new LineSegment('waist', { x: 15, y: 0 }, { x: 0, y: 0 }, 1.0)
      ], true);

      const res = generateCuttingContour(stitching, { miterLimit: 2.5 });
      const cutting = res.cuttingContour;

      assert.ok(cutting.isClosed, 'Cutting contour must be closed');
      assert.ok(cutting.segments.length >= 4, 'Cutting contour should have at least 4 segments');

      // Fold segment must remain on x = 0
      const cfCut = cutting.segments.find(s => s.id === 'cf-cut');
      assert.ok(cfCut, 'Must include cf-cut segment');
      assert.ok(Math.abs(cfCut.start.x - 0) < 1e-4, 'CF cut start must be on fold line x = 0');
      assert.ok(Math.abs(cfCut.end.x - 0) < 1e-4, 'CF cut end must be on fold line x = 0');
    });
  });
});
