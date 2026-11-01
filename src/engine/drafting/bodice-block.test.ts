/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BodyMeasurements, DesignSpecification, StandardSize } from '../../types';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import {
  STANDARD_SIZING_SYSTEM,
  calculateBodiceGarmentDimensions,
  validateBodiceMeasurements
} from '../measurements/standards';
import { draftBodiceBlock } from './bodice-block';
import {
  DART_LEG_TOLERANCE_CM,
  SEAM_TOLERANCE_CM,
  TANGENCY_TOLERANCE_DEG,
  validatePatternDraft
} from '../validation/seam-validator';
import { checkPerpendicularity, distance, vector } from '../geometry/math';

describe('Milestone 03: Bodice Drafting Core & Geometry Validation', () => {
  const bodiceConcept = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice') || {
    id: 'test-bodice-concept',
    name: 'Test Bodice Specification',
    prompt: 'Tailored basic bodice block',
    garmentCategory: 'bodice' as const,
    silhouette: 'tailored' as const,
    fabric: {
      id: 'wool-crepe',
      name: 'Virgin Wool Crepe',
      composition: '100% Wool',
      weight: 'medium' as const,
      stretch: 'none' as const,
      recommendedEaseCm: { waist: 3.5, hip: 4.5, bust: 5.0 },
      drapeDescription: 'Structured fluid drape.'
    },
    color: { name: 'Parchment', hex: '#F4F1EA' },
    easeProfile: 'classic' as const,
    lengthCm: 42,
    constructionFeatures: [],
    designNotes: [],
    isApproved: true,
    version: 1
  };

  const validMeasurements: BodyMeasurements = STANDARD_SIZING_SYSTEM.sizes.M;

  // =========================================================================
  // 1. MEASUREMENT VALIDATION TESTS
  // =========================================================================
  describe('Measurement Validation', () => {
    it('accepts valid standard measurements set (Size M)', () => {
      const res = validateBodiceMeasurements(validMeasurements);
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.errors.length, 0);
    });

    it('rejects missing required measurement (bust)', () => {
      const invalid = { ...validMeasurements, bust: undefined };
      const res = validateBodiceMeasurements(invalid);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Bust circumference is required')));
    });

    it('rejects missing required measurement (frontWaistLength)', () => {
      const invalid = { ...validMeasurements, frontWaistLength: undefined };
      const res = validateBodiceMeasurements(invalid);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Front waist length is required')));
    });

    it('rejects non-finite or negative measurements (NaN, negative)', () => {
      const nanBust = { ...validMeasurements, bust: NaN };
      const res1 = validateBodiceMeasurements(nanBust);
      assert.strictEqual(res1.isValid, false);
      assert.ok(res1.errors.some(e => e.includes('positive finite number')));

      const negWaist = { ...validMeasurements, waist: -50 };
      const res2 = validateBodiceMeasurements(negWaist);
      assert.strictEqual(res2.isValid, false);
      assert.ok(res2.errors.some(e => e.includes('positive finite number')));
    });

    it('rejects physically impossible anatomical boundaries', () => {
      const tinyBust = { ...validMeasurements, bust: 40 };
      const res = validateBodiceMeasurements(tinyBust);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('falls outside anatomical boundary')));
    });

    it('rejects contradictory thoracic posture (front waist length shorter than back minus 3cm)', () => {
      const contradictory = {
        ...validMeasurements,
        backWaistLength: 42,
        frontWaistLength: 35 // 35 < 42 - 3 (physically impossible for human torso)
      };
      const res = validateBodiceMeasurements(contradictory);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('cannot be shorter than back waist length')));
    });

    it('rejects acrossBack exceeding 55% of full bust circumference', () => {
      const contradictory = {
        ...validMeasurements,
        bust: 80,
        acrossBack: 48 // 48 >= 80 * 0.55 = 44
      };
      const res = validateBodiceMeasurements(contradictory);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('cannot exceed 55% of full bust')));
    });

    it('throws descriptive Error if draftBodiceBlock is called with invalid measurements', () => {
      const invalid = { ...validMeasurements, waist: 0 };
      assert.throws(() => {
        draftBodiceBlock(invalid, bodiceConcept);
      }, /Bodice drafting measurement validation failed/);
    });
  });

  // =========================================================================
  // 2. DRAFTING AND PIECE METADATA TESTS
  // =========================================================================
  describe('Bodice Drafting Engine Construction', () => {
    it('drafts valid Front and Back bodice panels with required metadata', () => {
      const pieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      assert.strictEqual(pieces.length, 2);

      const [frontPiece, backPiece] = pieces;

      // Front Bodice checks
      assert.strictEqual(frontPiece.id, 'piece-bodice-front');
      assert.strictEqual(frontPiece.pieceCode, 'BOD-F-01');
      assert.strictEqual(frontPiece.cutCount, 1);
      assert.strictEqual(frontPiece.onFold, true);
      assert.strictEqual(frontPiece.garmentCategory, 'bodice');
      assert.ok(frontPiece.cutPathData.startsWith('M'));
      assert.ok(frontPiece.sewPathData.startsWith('M'));
      assert.strictEqual(frontPiece.grainline.direction, 'vertical');
      assert.ok(distance(frontPiece.grainline.start, frontPiece.grainline.end) >= 15.0);

      // Back Bodice checks
      assert.strictEqual(backPiece.id, 'piece-bodice-back');
      assert.strictEqual(backPiece.pieceCode, 'BOD-B-01');
      assert.strictEqual(backPiece.cutCount, 2);
      assert.strictEqual(backPiece.onFold, false);
      assert.strictEqual(backPiece.garmentCategory, 'bodice');
      assert.strictEqual(backPiece.grainline.direction, 'vertical');
      assert.ok(distance(backPiece.grainline.start, backPiece.grainline.end) >= 15.0);
    });

    it('produces 100% deterministic outputs for identical inputs', () => {
      const run1 = draftBodiceBlock(validMeasurements, bodiceConcept);
      const run2 = draftBodiceBlock(validMeasurements, bodiceConcept);

      assert.strictEqual(run1[0].cutPathData, run2[0].cutPathData);
      assert.strictEqual(run1[0].sewPathData, run2[0].sewPathData);
      assert.strictEqual(run1[1].cutPathData, run2[1].cutPathData);
      assert.strictEqual(run1[1].sewPathData, run2[1].sewPathData);
    });

    it('applies documented classic ease profile to finished garment dimensions', () => {
      const dims = calculateBodiceGarmentDimensions(validMeasurements, 'classic');
      // Classic ease: +5.5cm bust, +4.0cm waist
      assert.strictEqual(dims.appliedBustEaseCm, 5.5);
      assert.strictEqual(dims.appliedWaistEaseCm, 4.0);
      assert.strictEqual(dims.garmentBustCm, Number((validMeasurements.bust! + 5.5).toFixed(1)));
      assert.strictEqual(dims.garmentWaistCm, Number((validMeasurements.waist + 4.0).toFixed(1)));
    });
  });

  // =========================================================================
  // 3. DART GEOMETRY AND LEG LENGTH PARITY
  // =========================================================================
  describe('Dart Geometry and Parity', () => {
    it('front waist dart has mathematically equidistant legs from apex', () => {
      const [frontPiece] = draftBodiceBlock(validMeasurements, bodiceConcept);
      assert.strictEqual(frontPiece.darts.length, 1);

      const dart = frontPiece.darts[0];
      assert.strictEqual(dart.id, 'dart-front-waist');
      assert.ok(dart.widthCm >= 1.0);

      const leftLen = distance(dart.apex, dart.legLeft);
      const rightLen = distance(dart.apex, dart.legRight);
      const delta = Math.abs(leftLen - rightLen);

      assert.ok(
        delta <= DART_LEG_TOLERANCE_CM,
        `Front dart leg difference (${delta.toFixed(4)} cm) must not exceed tolerance (${DART_LEG_TOLERANCE_CM} cm)`
      );
      assert.ok(delta < 0.001, 'Front dart legs must be mathematically equidistant (< 0.01 mm)');
    });

    it('back waist dart has mathematically equidistant legs from apex', () => {
      const [, backPiece] = draftBodiceBlock(validMeasurements, bodiceConcept);
      assert.strictEqual(backPiece.darts.length, 1);

      const dart = backPiece.darts[0];
      assert.strictEqual(dart.id, 'dart-back-waist');
      assert.ok(dart.widthCm >= 1.0);

      const leftLen = distance(dart.apex, dart.legLeft);
      const rightLen = distance(dart.apex, dart.legRight);
      const delta = Math.abs(leftLen - rightLen);

      assert.ok(
        delta <= DART_LEG_TOLERANCE_CM,
        `Back dart leg difference (${delta.toFixed(4)} cm) must not exceed tolerance (${DART_LEG_TOLERANCE_CM} cm)`
      );
      assert.ok(delta < 0.001, 'Back dart legs must be mathematically equidistant (< 0.01 mm)');
    });
  });

  // =========================================================================
  // 4. PERPENDICULAR TANGENCIES & SEAM MATCHING
  // =========================================================================
  describe('Perpendicular Tangencies & Paired Seam Matching', () => {
    it('Center Front waist meets fold at exact 90.0° perpendicular tangency', () => {
      const [frontPiece] = draftBodiceBlock(validMeasurements, bodiceConcept);
      const cfSeam = frontPiece.seams.find(s => s.id === 'fb-center-front')!;
      const waistSeam = frontPiece.seams.find(s => s.id === 'fb-waist')!;

      const foldVec = vector(cfSeam.startPoint, cfSeam.endPoint);
      const waistDep = waistSeam.startTangent!;
      const perp = checkPerpendicularity(foldVec, waistDep, TANGENCY_TOLERANCE_DEG);

      assert.strictEqual(perp.isPerpendicular, true);
      assert.ok(perp.deviationDeg <= TANGENCY_TOLERANCE_DEG);
      assert.strictEqual(perp.measuredAngleDeg, 90.0);
    });

    it('Center Front neckline meets fold at exact 90.0° perpendicular tangency', () => {
      const [frontPiece] = draftBodiceBlock(validMeasurements, bodiceConcept);
      const cfSeam = frontPiece.seams.find(s => s.id === 'fb-center-front')!;
      const neckSeam = frontPiece.seams.find(s => s.id === 'fb-neck')!;

      const foldVec = vector(cfSeam.startPoint, cfSeam.endPoint);
      const neckDep = { x: -neckSeam.endTangent!.x, y: -neckSeam.endTangent!.y };
      const perp = checkPerpendicularity(foldVec, neckDep, TANGENCY_TOLERANCE_DEG);

      assert.strictEqual(perp.isPerpendicular, true);
      assert.ok(perp.deviationDeg <= TANGENCY_TOLERANCE_DEG);
      assert.strictEqual(perp.measuredAngleDeg, 90.0);
    });

    it('Center Back waist meets CB seam at exact 90.0° perpendicular tangency', () => {
      const [, backPiece] = draftBodiceBlock(validMeasurements, bodiceConcept);
      const cbSeam = backPiece.seams.find(s => s.id === 'bb-center-back')!;
      const waistSeam = backPiece.seams.find(s => s.id === 'bb-waist')!;

      const cbVec = vector(cbSeam.startPoint, cbSeam.endPoint);
      const waistDep = waistSeam.startTangent!;
      const perp = checkPerpendicularity(cbVec, waistDep, TANGENCY_TOLERANCE_DEG);

      assert.strictEqual(perp.isPerpendicular, true);
      assert.ok(perp.deviationDeg <= TANGENCY_TOLERANCE_DEG);
      assert.strictEqual(perp.measuredAngleDeg, 90.0);
    });

    it('Center Back neckline meets CB seam at exact 90.0° perpendicular tangency', () => {
      const [, backPiece] = draftBodiceBlock(validMeasurements, bodiceConcept);
      const cbSeam = backPiece.seams.find(s => s.id === 'bb-center-back')!;
      const neckSeam = backPiece.seams.find(s => s.id === 'bb-neck')!;

      const cbVec = vector(cbSeam.startPoint, cbSeam.endPoint);
      const neckDep = { x: -neckSeam.endTangent!.x, y: -neckSeam.endTangent!.y };
      const perp = checkPerpendicularity(cbVec, neckDep, TANGENCY_TOLERANCE_DEG);

      assert.strictEqual(perp.isPerpendicular, true);
      assert.ok(perp.deviationDeg <= TANGENCY_TOLERANCE_DEG);
      assert.strictEqual(perp.measuredAngleDeg, 90.0);
    });

    it('paired side seam lengths match between Front and Back within SEAM_TOLERANCE_CM', () => {
      const [frontPiece, backPiece] = draftBodiceBlock(validMeasurements, bodiceConcept);
      const frontSide = frontPiece.seams.find(s => s.id === 'fb-side-seam')!;
      const backSide = backPiece.seams.find(s => s.id === 'bb-side-seam')!;

      const delta = Math.abs(frontSide.lengthCm - backSide.lengthCm);
      assert.ok(
        delta <= SEAM_TOLERANCE_CM,
        `Side seam difference (${delta.toFixed(3)} cm) must not exceed tolerance (${SEAM_TOLERANCE_CM} cm)`
      );
      assert.ok(delta < 0.05, `Side seam length delta (${delta.toFixed(3)} cm) is under 0.5mm`);
    });

    it('paired shoulder seam lengths match between Front and Back within SEAM_TOLERANCE_CM', () => {
      const [frontPiece, backPiece] = draftBodiceBlock(validMeasurements, bodiceConcept);
      const frontShoulder = frontPiece.seams.find(s => s.id === 'fb-shoulder-seam')!;
      const backShoulder = backPiece.seams.find(s => s.id === 'bb-shoulder-seam')!;

      const delta = Math.abs(frontShoulder.lengthCm - backShoulder.lengthCm);
      assert.ok(
        delta <= SEAM_TOLERANCE_CM,
        `Shoulder seam difference (${delta.toFixed(3)} cm) must not exceed tolerance (${SEAM_TOLERANCE_CM} cm)`
      );
      assert.ok(delta < 0.05, `Shoulder seam delta (${delta.toFixed(3)} cm) is under 0.5mm`);
    });
  });

  // =========================================================================
  // 5. TRUE OFFSETS, CONTOUR INTEGRITY & VALIDATION INTEGRATION
  // =========================================================================
  describe('Geometric Contours, Offsets & Validation Gate', () => {
    it('front and back bodice contours are closed, continuous, and valid', () => {
      const pieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      const report = validatePatternDraft(pieces);

      assert.strictEqual(report.isValid, true);
      assert.strictEqual(report.status, 'validated');
      assert.strictEqual(report.failureCount, 0);

      // Verify Front CF fold carries 0 allowance and stitching role
      const frontPiece = pieces[0];
      const foldSeg = frontPiece.stitchingContour?.segments.find(s => s.isFold);
      assert.ok(foldSeg);
      assert.strictEqual(foldSeg.seamAllowanceCm, 0);
      assert.strictEqual(foldSeg.role, 'stitching');

      // Verify offset results
      assert.strictEqual(frontPiece.offsetResult?.status, 'success');
      assert.strictEqual(frontPiece.offsetResult?.toleranceExceeded, false);
      assert.ok((frontPiece.offsetResult?.maxDeviationCm ?? 1) <= 0.05);

      const backPiece = pieces[1];
      assert.strictEqual(backPiece.offsetResult?.status, 'success');
      assert.strictEqual(backPiece.offsetResult?.toleranceExceeded, false);
      assert.ok((backPiece.offsetResult?.maxDeviationCm ?? 1) <= 0.05);
    });

    it('Milestone 03 Acceptance: unmocked offset failure propagates to validation report', () => {
      // Draft with impossible 0.0001cm (1 micron) curve tolerance
      const strictPieces = draftBodiceBlock(validMeasurements, bodiceConcept, {
        bezierToleranceCm: 0.0001
      });

      const frontPiece = strictPieces[0];
      assert.strictEqual(frontPiece.offsetResult?.status, 'failure');
      assert.strictEqual(frontPiece.offsetResult?.toleranceExceeded, true);

      // Stitching contour must remain completely uncorrupted
      assert.strictEqual(frontPiece.stitchingContour?.segments.length, 10);

      // Validation engine must catch the failure and block production
      const report = validatePatternDraft(strictPieces);
      assert.strictEqual(report.isValid, false);
      assert.strictEqual(report.isProductionReady, false);
      assert.strictEqual(report.status, 'invalid');

      const offsetCheck = report.checks.find(c => c.errorCode === 'VAL-OFFSET-FAILED');
      assert.ok(offsetCheck, 'Must record genuine VAL-OFFSET-FAILED check');
      assert.strictEqual(offsetCheck.status, 'fail');
      assert.strictEqual(offsetCheck.category, 'offset');
    });

    it('rejects asymmetric dart legs by more than 1mm in negative test', () => {
      const pieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      // Intentionally distort dart leg length by 1.2cm
      const distortedDart = {
        ...pieces[0].darts[0],
        legLeft: {
          x: pieces[0].darts[0].legLeft.x - 0.5,
          y: pieces[0].darts[0].legLeft.y - 1.2
        }
      };
      const distortedPiece = { ...pieces[0], darts: [distortedDart] };
      const report = validatePatternDraft([distortedPiece, pieces[1]]);

      const dartCheck = report.checks.find(c => c.id === `val-dart-${distortedDart.id}`);
      assert.ok(dartCheck);
      assert.strictEqual(dartCheck.status, 'fail');
    });
  });

  // =========================================================================
  // 6. MULTI-SIZE ANTHROPOMETRIC REGRESSION
  // =========================================================================
  describe('Standard Sizing Regression (XS - XXL)', () => {
    const allSizes: StandardSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

    for (const size of allSizes) {
      it(`drafts valid, continuous, non-intersecting bodice geometry for Size ${size}`, () => {
        const measurements = STANDARD_SIZING_SYSTEM.sizes[size];
        const pieces = draftBodiceBlock(measurements, bodiceConcept);
        assert.strictEqual(pieces.length, 2);

        const report = validatePatternDraft(pieces);
        assert.strictEqual(
          report.isValid,
          true,
          `Size ${size} failed validation: ${report.checks.filter(c => c.status === 'fail').map(c => c.message).join('; ')}`
        );
        assert.strictEqual(report.failureCount, 0);

        // Verify side seam matching for every size
        const [frontPiece, backPiece] = pieces;
        const frontSide = frontPiece.seams.find(s => s.id === 'fb-side-seam')!;
        const backSide = backPiece.seams.find(s => s.id === 'bb-side-seam')!;
        const sideDelta = Math.abs(frontSide.lengthCm - backSide.lengthCm);
        assert.ok(sideDelta <= SEAM_TOLERANCE_CM, `Size ${size} side seams must match within ${SEAM_TOLERANCE_CM} cm`);

        // Verify shoulder seam matching for every size
        const frontShoulder = frontPiece.seams.find(s => s.id === 'fb-shoulder-seam')!;
        const backShoulder = backPiece.seams.find(s => s.id === 'bb-shoulder-seam')!;
        const shoulderDelta = Math.abs(frontShoulder.lengthCm - backShoulder.lengthCm);
        assert.ok(shoulderDelta <= SEAM_TOLERANCE_CM, `Size ${size} shoulder seams must match within ${SEAM_TOLERANCE_CM} cm`);
      });
    }
  });
});
