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
  connectSeamToFold,
  generateCuttingContour,
  BEZIER_OFFSET_TOLERANCE_CM,
  MAX_SUBDIVISION_DEPTH
} from './offset';
import { distance } from './math';

describe('Geometry Offset Engine (Milestone 02 Corrective Pass)', () => {
  describe('LineSegment Offset', () => {
    it('offsets a horizontal line outwards to the left/right according to normal', () => {
      // Line from (0, 0) to (10, 0), dir=(1, 0), CCW outward normal = (0, 1)
      const line = new LineSegment('test-h', { x: 0, y: 0 }, { x: 10, y: 0 });
      const offsetD1 = offsetLineSegment(line, 1.0);

      assert.strictEqual(offsetD1.id, 'test-h-cut');
      assert.strictEqual(offsetD1.sourceSegmentId, 'test-h');
      assert.strictEqual(offsetD1.role, 'offset');
      assert.ok(Math.abs(offsetD1.start.x - 0) < 1e-4);
      assert.ok(Math.abs(offsetD1.start.y - 1) < 1e-4);
      assert.ok(Math.abs(offsetD1.end.x - 10) < 1e-4);
      assert.ok(Math.abs(offsetD1.end.y - 1) < 1e-4);
      assert.ok(Math.abs(offsetD1.lengthCm() - 10) < 1e-4);
    });

    it('offsets a vertical line correctly', () => {
      // Line from (10, 0) to (10, 20), dir=(0, 1), normal = (-1, 0)
      const line = new LineSegment('test-v', { x: 10, y: 0 }, { x: 10, y: 20 });
      const offsetD2 = offsetLineSegment(line, 2.0);

      assert.ok(Math.abs(offsetD2.start.x - 8) < 1e-4);
      assert.ok(Math.abs(offsetD2.start.y - 0) < 1e-4);
      assert.ok(Math.abs(offsetD2.end.x - 8) < 1e-4);
      assert.ok(Math.abs(offsetD2.end.y - 20) < 1e-4);
    });

    it('produces zero offset when distance is 0 or isFold is true', () => {
      const line = new LineSegment('test-0', { x: 5, y: 5 }, { x: 15, y: 25 }, 0, true);
      const offset0 = offsetLineSegment(line, 0);

      assert.ok(Math.abs(offset0.start.x - 5) < 1e-4);
      assert.ok(Math.abs(offset0.start.y - 5) < 1e-4);
      assert.ok(Math.abs(offset0.end.x - 15) < 1e-4);
      assert.ok(Math.abs(offset0.end.y - 25) < 1e-4);
      assert.strictEqual(offset0.isFold, true);
    });
  });

  describe('CubicBezierCurve Offset & Adaptive Approximation', () => {
    it('approximates a cubic Bézier offset within specified manufacturing tolerance', () => {
      const curve = new CubicBezierCurve(
        'hip-curve',
        { x: 23, y: 0 },
        { x: 24, y: 5 },
        { x: 25, y: 15 },
        { x: 25, y: 20 }
      );

      const res = offsetCubicBezier(curve, 1.0);
      assert.ok(res.segments.length >= 1, 'Should produce offset curve segment(s)');
      assert.strictEqual(res.toleranceExceeded, false);

      // Check distance from midpoints of original curve to offset curve
      const midOriginal = curve.pointAt(0.5);
      const normalOriginal = curve.normalAt(0.5);
      const targetPoint = {
        x: midOriginal.x + normalOriginal.x * 1.0,
        y: midOriginal.y + normalOriginal.y * 1.0
      };

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

    it('subdivides high-curvature Bézier segments to achieve tolerance', () => {
      // High curvature hairpin-like Bézier
      const highCurv = new CubicBezierCurve(
        'high-curv',
        { x: 0, y: 0 },
        { x: 10, y: 15 },
        { x: 10, y: 15 },
        { x: 20, y: 0 }
      );

      const res = offsetCubicBezier(highCurv, 1.5, 0.05);
      // High curvature triggers subdivision into multiple segments
      assert.ok(res.segments.length > 1, 'High curvature curve should subdivide into multiple segments');
      assert.ok(res.maxDeviationCm <= 0.05, `Max deviation (${res.maxDeviationCm} cm) should meet tolerance`);
      // Verify continuity between sub-segments
      for (let i = 0; i < res.segments.length - 1; i++) {
        const gap = distance(res.segments[i].end, res.segments[i + 1].start);
        assert.ok(gap < 0.01, `Gap between subsegments (${gap}) must be near zero`);
      }
    });

    it('safely handles degenerate curves with zero-length tangents', () => {
      // Degenerate curve where start equals first control point
      const degen = new CubicBezierCurve(
        'degen',
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
        { x: 15, y: 15 }
      );

      const tan0 = degen.tangentAt(0);
      assert.ok(Number.isFinite(tan0.x) && Number.isFinite(tan0.y));
      assert.ok(Math.abs(Math.hypot(tan0.x, tan0.y) - 1.0) < 1e-4);

      const res = offsetCubicBezier(degen, 1.0);
      assert.ok(res.segments.length >= 1);
      assert.ok(Number.isFinite(res.segments[0].start.x));
      assert.ok(Number.isFinite(res.segments[0].start.y));
    });

    it('flags warning when maximum subdivision depth is exceeded with strict tolerance', () => {
      const complexCurve = new CubicBezierCurve(
        'extreme-curv',
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 }
      );

      // Impossibly strict tolerance of 0.00001 cm with large offset
      const res = offsetCubicBezier(complexCurve, 10.0, 0.00001);
      assert.strictEqual(res.toleranceExceeded, true);
      assert.ok(res.warnings.length > 0);
      assert.ok(res.warnings[0].includes('maximum subdivision depth'));
    });
  });

  describe('Corner Join & Miter Limit Handling', () => {
    it('creates a clean miter intersection at a standard 90° convex corner', () => {
      const seg1 = new LineSegment('s1', { x: 0, y: 10 }, { x: 10, y: 10 });
      const seg2 = new LineSegment('s2', { x: 10, y: 10 }, { x: 10, y: 0 });

      const off1 = offsetLineSegment(seg1, 1.0);
      const off2 = offsetLineSegment(seg2, 1.0);

      const joined = joinOffsetSegmentsAtCorner(off1, off2, 2.5);
      assert.strictEqual(joined.length, 2);

      assert.ok(Math.abs(joined[0].end.x - 11) < 1e-3);
      assert.ok(Math.abs(joined[0].end.y - 11) < 1e-3);
      assert.ok(Math.abs(joined[1].start.x - 11) < 1e-3);
      assert.ok(Math.abs(joined[1].start.y - 11) < 1e-3);
    });

    it('falls back to a bevel join when corner is extremely acute (miter exceeds limit)', () => {
      const seg1 = new LineSegment('acute-1', { x: 0, y: 0 }, { x: 10, y: 0 }, 2.0);
      const seg2 = new LineSegment('acute-2', { x: 10, y: 0 }, { x: 0.5, y: 0.5 }, 2.0);

      const off1 = offsetLineSegment(seg1, 2.0);
      const off2 = offsetLineSegment(seg2, 2.0);

      const joined = joinOffsetSegmentsAtCorner(off1, off2, 1.5);
      assert.strictEqual(joined.length, 3, 'Bevel join must insert a connector bevel segment');
      assert.strictEqual(joined[1].role, 'bevel');
    });

    it('handles curve-to-line corner join seamlessly', () => {
      const curve = new CubicBezierCurve('c1', { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 15 }, { x: 15, y: 15 });
      const line = new LineSegment('l1', { x: 15, y: 15 }, { x: 25, y: 15 });

      const offCurve = offsetCubicBezier(curve, 1.0).segments[0];
      const offLine = offsetLineSegment(line, 1.0);

      const joined = joinOffsetSegmentsAtCorner(offCurve, offLine, 2.5);
      assert.ok(joined.length >= 2);
      // Ensure continuous connection between curve end and line start
      const gap = distance(joined[0].end, joined[1].start);
      assert.ok(gap < 0.05, `Gap (${gap} cm) must be within continuity tolerance`);
    });

    it('handles curve-to-curve corner join with vertex continuity', () => {
      const curve1 = new CubicBezierCurve('c1', { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 5 }, { x: 15, y: 0 });
      const curve2 = new CubicBezierCurve('c2', { x: 15, y: 0 }, { x: 20, y: -5 }, { x: 25, y: -5 }, { x: 30, y: 0 });

      const off1 = offsetCubicBezier(curve1, 1.5).segments[0];
      const off2 = offsetCubicBezier(curve2, 1.5).segments[0];

      const joined = joinOffsetSegmentsAtCorner(off1, off2, 2.5);
      assert.ok(joined.length >= 2);
      const gap = distance(joined[0].end, joined[1].start);
      assert.ok(gap < 0.05, `Gap between joined curves (${gap} cm) must be continuous`);
    });
  });

  describe('Arbitrary Fold-Edge Handling', () => {
    it('correctly offsets contour with a vertical fold (x = const)', () => {
      const stitching = new GeometricContour('vert-fold', [
        new LineSegment('v-fold', { x: 0, y: 0 }, { x: 0, y: 30 }, 0, true),
        new LineSegment('v-hem', { x: 0, y: 30 }, { x: 20, y: 30 }, 3.0),
        new LineSegment('v-side', { x: 20, y: 30 }, { x: 20, y: 0 }, 1.5),
        new LineSegment('v-waist', { x: 20, y: 0 }, { x: 0, y: 0 }, 1.0)
      ], true);

      const res = generateCuttingContour(stitching);
      assert.ok(res.cuttingContour.isClosed);

      const foldSeg = res.cuttingContour.segments.find(s => s.isFold);
      assert.ok(foldSeg, 'Cutting contour must contain fold segment');
      assert.ok(Math.abs(foldSeg.start.x - 0) < 1e-3, 'Fold start must lie on x = 0');
      assert.ok(Math.abs(foldSeg.end.x - 0) < 1e-3, 'Fold end must lie on x = 0');
    });

    it('correctly offsets contour with a horizontal fold (y = const)', () => {
      // Horizontal fold along y = 0
      const stitching = new GeometricContour('horiz-fold', [
        new LineSegment('h-fold', { x: 0, y: 0 }, { x: 30, y: 0 }, 0, true),
        new LineSegment('h-right', { x: 30, y: 0 }, { x: 30, y: 20 }, 2.0),
        new LineSegment('h-bottom', { x: 30, y: 20 }, { x: 0, y: 20 }, 3.0),
        new LineSegment('h-left', { x: 0, y: 20 }, { x: 0, y: 0 }, 1.5)
      ], true);

      const res = generateCuttingContour(stitching);
      assert.ok(res.cuttingContour.isClosed);

      // Fold segment must remain on y = 0
      const foldSeg = res.cuttingContour.segments.find(s => s.id.includes('h-fold'));
      assert.ok(foldSeg);
      assert.ok(Math.abs(foldSeg.start.y - 0) < 1e-3, 'Horizontal fold start must lie on y = 0');
      assert.ok(Math.abs(foldSeg.end.y - 0) < 1e-3, 'Horizontal fold end must lie on y = 0');
    });

    it('correctly offsets contour with a diagonal fold on bias (arbitrary vector)', () => {
      // Diagonal fold from (0, 0) to (20, 20)
      const stitching = new GeometricContour('diag-fold', [
        new LineSegment('d-fold', { x: 0, y: 0 }, { x: 20, y: 20 }, 0, true),
        new LineSegment('d-edge1', { x: 20, y: 20 }, { x: 0, y: 20 }, 2.0),
        new LineSegment('d-edge2', { x: 0, y: 20 }, { x: 0, y: 0 }, 2.0)
      ], true);

      const res = generateCuttingContour(stitching);
      assert.ok(res.cuttingContour.isClosed);

      // Fold edge should remain collinear with y = x
      const foldSeg = res.cuttingContour.segments.find(s => s.isFold);
      assert.ok(foldSeg);
      assert.ok(Math.abs(foldSeg.start.x - foldSeg.start.y) < 0.05, 'Fold start must lie on diagonal line y = x');
      assert.ok(Math.abs(foldSeg.end.x - foldSeg.end.y) < 0.05, 'Fold end must lie on diagonal line y = x');
    });

    it('correctly handles a fold edge adjacent to a curved segment', () => {
      const stitching = new GeometricContour('curve-fold', [
        new LineSegment('fold', { x: 0, y: 0 }, { x: 0, y: 25 }, 0, true),
        new LineSegment('bottom', { x: 0, y: 25 }, { x: 15, y: 25 }, 2.0),
        new LineSegment('side', { x: 15, y: 25 }, { x: 15, y: 5 }, 1.5),
        // Curved waist meeting the fold
        new CubicBezierCurve('curved-waist', { x: 15, y: 5 }, { x: 10, y: 1 }, { x: 5, y: 0 }, { x: 0, y: 0 }, 1.0)
      ], true);

      const res = generateCuttingContour(stitching);
      assert.ok(res.cuttingContour.isClosed);
      assert.ok(res.cuttingContour.segments.length >= 4);

      // Verify that fold segment start lies on x = 0
      const foldSeg = res.cuttingContour.segments.find(s => s.id.includes('fold'));
      assert.ok(foldSeg);
      assert.ok(Math.abs(foldSeg.start.x) < 0.05);
    });
  });

  describe('Winding Normalization & Traceability', () => {
    it('offsets outward when contour is drafted in reversed (counter-clockwise) winding', () => {
      // CCW rectangle: (0,0) -> (10,0) -> (10,20) -> (0,20) -> (0,0)
      const ccwStitching = new GeometricContour('ccw-rect', [
        new LineSegment('top', { x: 0, y: 0 }, { x: 10, y: 0 }, 1.0),
        new LineSegment('right', { x: 10, y: 0 }, { x: 10, y: 20 }, 1.0),
        new LineSegment('bottom', { x: 10, y: 20 }, { x: 0, y: 20 }, 1.0),
        new LineSegment('left', { x: 0, y: 20 }, { x: 0, y: 0 }, 1.0)
      ], true);

      assert.strictEqual(ccwStitching.getWinding(), 'counter-clockwise');

      const res = generateCuttingContour(ccwStitching, { defaultAllowanceCm: 1.0 });
      const cutting = res.cuttingContour;
      const cutBox = cutting.boundingBox();
      const stitchBox = ccwStitching.boundingBox();

      // The cutting bounding box must be strictly larger than stitching bounding box in all directions
      assert.ok(cutBox.widthCm > stitchBox.widthCm, 'Cutting contour must expand outwards horizontally');
      assert.ok(cutBox.heightCm > stitchBox.heightCm, 'Cutting contour must expand outwards vertically');
      assert.ok(cutBox.minX <= stitchBox.minX - 0.9, 'Offset must expand left');
      assert.ok(cutBox.maxX >= stitchBox.maxX + 0.9, 'Offset must expand right');
    });

    it('maintains strict geometric traceability from cutting segments to stitching segments', () => {
      const stitching = new GeometricContour('trace-rect', [
        new LineSegment('s-fold', { x: 0, y: 0 }, { x: 0, y: 20 }, 0, true, 'seam-cf'),
        new LineSegment('s-hem', { x: 0, y: 20 }, { x: 15, y: 20 }, 3.0, false, 'seam-hem'),
        new LineSegment('s-side', { x: 15, y: 20 }, { x: 15, y: 0 }, 1.5, false, 'seam-side'),
        new LineSegment('s-waist', { x: 15, y: 0 }, { x: 0, y: 0 }, 1.0, false, 'seam-waist')
      ], true);

      const res = generateCuttingContour(stitching);
      const cutting = res.cuttingContour;

      // Every cutting segment must have a role and traceable provenance
      for (const cutSeg of cutting.segments) {
        assert.ok(cutSeg.role, `Segment [${cutSeg.id}] must define a role`);
        assert.ok(
          ['offset', 'miter', 'bevel', 'fold-extension', 'bridge', 'stitching'].includes(cutSeg.role),
          `Segment [${cutSeg.id}] role ${cutSeg.role} must be a recognized industrial role`
        );
      }

      // Check offset segment sourceSegmentId
      const hemCut = cutting.segments.find(s => s.id === 's-hem-cut');
      assert.ok(hemCut);
      assert.strictEqual(hemCut.sourceSegmentId, 's-hem');
      assert.strictEqual(hemCut.seamAllowanceCm, 3.0);
    });
  });
});
