/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BodiceDartStyle, BodyMeasurements, StandardSize } from '../../types';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { draftBodiceBlock } from './bodice-block';
import {
  DART_LEG_TOLERANCE_CM,
  SEAM_TOLERANCE_CM,
  TANGENCY_TOLERANCE_DEG,
  validatePatternDraft
} from '../validation/seam-validator';
import { checkPerpendicularity, distance, vector } from '../geometry/math';

describe('Milestone 04.1: Dart Manipulation Engine', () => {
  const bodiceConcept = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!;
  const validMeasurements: BodyMeasurements = STANDARD_SIZING_SYSTEM.sizes.M;

  const ALL_STYLES: BodiceDartStyle[] = [
    'waist',
    'side-bust',
    'shoulder',
    'french',
    'waist-and-side'
  ];

  // =========================================================================
  // 1. INDIVIDUAL DART STYLE GEOMETRY TESTS
  // =========================================================================
  describe('Individual Dart Style Transformations', () => {
    it('drafts valid Side-Seam Bust Dart with equidistant legs and closed waist', () => {
      const [frontPiece, backPiece] = draftBodiceBlock(validMeasurements, bodiceConcept, {
        dartStyle: 'side-bust'
      });

      assert.strictEqual(frontPiece.darts.length, 1);
      const dart = frontPiece.darts[0];
      assert.strictEqual(dart.id, 'dart-front-side-bust');

      // 1. Equidistant legs (< 0.01 mm)
      const leftLen = distance(dart.apex, dart.legLeft);
      const rightLen = distance(dart.apex, dart.legRight);
      const delta = Math.abs(leftLen - rightLen);
      assert.ok(delta <= DART_LEG_TOLERANCE_CM);
      assert.ok(delta < 0.001, `Dart legs must be mathematically equidistant (< 0.01mm, received ${delta}cm)`);

      // 2. Net side seam matches back side seam
      const frontSide = frontPiece.seams.find(s => s.id === 'fb-side-seam')!;
      const backSide = backPiece.seams.find(s => s.id === 'bb-side-seam')!;
      const sideDelta = Math.abs(frontSide.lengthCm - backSide.lengthCm);
      assert.ok(sideDelta <= SEAM_TOLERANCE_CM, `Side seam delta (${sideDelta}cm) must be <= ${SEAM_TOLERANCE_CM}cm`);

      // 3. Offset engine success
      assert.strictEqual(frontPiece.offsetResult?.status, 'success');
      assert.strictEqual(frontPiece.offsetResult?.toleranceExceeded, false);

      // 4. Full pattern validation pass
      const report = validatePatternDraft([frontPiece, backPiece]);
      assert.strictEqual(report.isValid, true);
    });

    it('drafts valid Shoulder Dart with equidistant legs and closed waist', () => {
      const [frontPiece, backPiece] = draftBodiceBlock(validMeasurements, bodiceConcept, {
        dartStyle: 'shoulder'
      });

      assert.strictEqual(frontPiece.darts.length, 1);
      const dart = frontPiece.darts[0];
      assert.strictEqual(dart.id, 'dart-front-shoulder');

      // 1. Equidistant legs (< 0.01 mm)
      const leftLen = distance(dart.apex, dart.legLeft);
      const rightLen = distance(dart.apex, dart.legRight);
      const delta = Math.abs(leftLen - rightLen);
      assert.ok(delta <= DART_LEG_TOLERANCE_CM);
      assert.ok(delta < 0.001, `Shoulder dart legs must be equidistant (< 0.01mm, received ${delta}cm)`);

      // 2. Net shoulder seam matches back shoulder seam
      const frontShoulder = frontPiece.seams.find(s => s.id === 'fb-shoulder-seam')!;
      const backShoulder = backPiece.seams.find(s => s.id === 'bb-shoulder-seam')!;
      const shoulderDelta = Math.abs(frontShoulder.lengthCm - backShoulder.lengthCm);
      assert.ok(shoulderDelta <= SEAM_TOLERANCE_CM, `Shoulder seam delta (${shoulderDelta}cm) must be <= ${SEAM_TOLERANCE_CM}cm`);

      // 3. Offset engine success
      assert.strictEqual(frontPiece.offsetResult?.status, 'success');
      assert.strictEqual(frontPiece.offsetResult?.toleranceExceeded, false);

      // 4. Full pattern validation pass
      const report = validatePatternDraft([frontPiece, backPiece]);
      assert.strictEqual(report.isValid, true);
    });

    it('drafts valid French Dart with diagonal orientation and closed waist', () => {
      const [frontPiece, backPiece] = draftBodiceBlock(validMeasurements, bodiceConcept, {
        dartStyle: 'french'
      });

      assert.strictEqual(frontPiece.darts.length, 1);
      const dart = frontPiece.darts[0];
      assert.strictEqual(dart.id, 'dart-front-french');

      // 1. Equidistant legs (< 0.01 mm)
      const leftLen = distance(dart.apex, dart.legLeft);
      const rightLen = distance(dart.apex, dart.legRight);
      const delta = Math.abs(leftLen - rightLen);
      assert.ok(delta <= DART_LEG_TOLERANCE_CM);
      assert.ok(delta < 0.001, `French dart legs must be equidistant (< 0.01mm, received ${delta}cm)`);

      // 2. French dart originates from lower side seam (y > frontPiece.boundingBox.yMax - 10)
      assert.ok(dart.legLeft.y > dart.apex.y, 'French dart legs must originate below apex');

      // 3. Net side seam matches back side seam
      const frontSide = frontPiece.seams.find(s => s.id === 'fb-side-seam')!;
      const backSide = backPiece.seams.find(s => s.id === 'bb-side-seam')!;
      const sideDelta = Math.abs(frontSide.lengthCm - backSide.lengthCm);
      assert.ok(sideDelta <= SEAM_TOLERANCE_CM);

      // 4. Full pattern validation pass
      const report = validatePatternDraft([frontPiece, backPiece]);
      assert.strictEqual(report.isValid, true);
    });

    it('drafts valid Combined Dual Dart (Waist + Side Bust)', () => {
      const [frontPiece, backPiece] = draftBodiceBlock(validMeasurements, bodiceConcept, {
        dartStyle: 'waist-and-side'
      });

      assert.strictEqual(frontPiece.darts.length, 2, 'Dual dart must create exactly 2 front darts');

      const waistDart = frontPiece.darts.find(d => d.id === 'dart-front-waist')!;
      const sideDart = frontPiece.darts.find(d => d.id === 'dart-front-side-bust')!;
      assert.ok(waistDart, 'Must contain front waist dart');
      assert.ok(sideDart, 'Must contain front side bust dart');

      // Both darts have equidistant legs
      const wDelta = Math.abs(distance(waistDart.apex, waistDart.legLeft) - distance(waistDart.apex, waistDart.legRight));
      assert.ok(wDelta < 0.001);

      const sDelta = Math.abs(distance(sideDart.apex, sideDart.legLeft) - distance(sideDart.apex, sideDart.legRight));
      assert.ok(sDelta < 0.001);

      // Full pattern validation pass
      const report = validatePatternDraft([frontPiece, backPiece]);
      assert.strictEqual(report.isValid, true);
    });
  });

  // =========================================================================
  // 2. DART INTAKE CONSERVATION & APEX PRESERVATION
  // =========================================================================
  describe('Dart Intake Conservation & Apex Preservation', () => {
    it('conserves total angular intake across all dart manipulations', () => {
      const [waistFront] = draftBodiceBlock(validMeasurements, bodiceConcept, { dartStyle: 'waist' });
      const [sideFront] = draftBodiceBlock(validMeasurements, bodiceConcept, { dartStyle: 'side-bust' });
      const [shoulderFront] = draftBodiceBlock(validMeasurements, bodiceConcept, { dartStyle: 'shoulder' });
      const [frenchFront] = draftBodiceBlock(validMeasurements, bodiceConcept, { dartStyle: 'french' });

      // In the description, each documents the angular intake
      const getIntake = (desc: string) => {
        const m = desc.match(/intake:\s*([\d.]+)°/);
        return m ? parseFloat(m[1]) : null;
      };

      const waistIntake = getIntake(waistFront.description);
      const sideIntake = getIntake(sideFront.description);
      const shoulderIntake = getIntake(shoulderFront.description);
      const frenchIntake = getIntake(frenchFront.description);

      assert.ok(waistIntake !== null);
      assert.strictEqual(sideIntake, waistIntake, 'Side bust dart intake must match waist dart intake');
      assert.strictEqual(shoulderIntake, waistIntake, 'Shoulder dart intake must match waist dart intake');
      assert.strictEqual(frenchIntake, waistIntake, 'French dart intake must match waist dart intake');
    });

    it('enforces 90.0° Center Front fold perpendicularity across all dart styles', () => {
      ALL_STYLES.forEach(style => {
        const [frontPiece] = draftBodiceBlock(validMeasurements, bodiceConcept, { dartStyle: style });
        const cfSeam = frontPiece.seams.find(s => s.id === 'fb-center-front')!;
        const waistSeam = frontPiece.seams.find(s => s.id === 'fb-waist')!;
        const neckSeam = frontPiece.seams.find(s => s.id === 'fb-neck')!;

        const foldVec = vector(cfSeam.startPoint, cfSeam.endPoint);
        const waistDep = waistSeam.startTangent!;
        const waistPerp = checkPerpendicularity(foldVec, waistDep, TANGENCY_TOLERANCE_DEG);
        assert.strictEqual(waistPerp.isPerpendicular, true, `${style}: Waist must meet CF fold at 90°`);
        assert.strictEqual(waistPerp.measuredAngleDeg, 90.0);

        const neckDep = { x: -neckSeam.endTangent!.x, y: -neckSeam.endTangent!.y };
        const neckPerp = checkPerpendicularity(foldVec, neckDep, TANGENCY_TOLERANCE_DEG);
        assert.strictEqual(neckPerp.isPerpendicular, true, `${style}: Neckline must meet CF fold at 90°`);
        assert.strictEqual(neckPerp.measuredAngleDeg, 90.0);
      });
    });
  });

  // =========================================================================
  // 3. FULL SIZING MATRIX ACROSS ALL DART STYLES (XS - XXL)
  // =========================================================================
  describe('Full Standard Sizing Matrix (XS - XXL x 5 Styles)', () => {
    const sizeKeys: StandardSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

    sizeKeys.forEach(size => {
      ALL_STYLES.forEach(style => {
        it(`drafts valid pattern for Size ${size} with ${style} dart`, () => {
          const meas = STANDARD_SIZING_SYSTEM.sizes[size];
          const pieces = draftBodiceBlock(meas, bodiceConcept, { dartStyle: style });
          assert.strictEqual(pieces.length, 2);

          const report = validatePatternDraft(pieces);
          assert.strictEqual(
            report.isValid,
            true,
            `Size ${size} with ${style} dart failed validation: ${report.checks.filter(c => c.status === 'fail').map(c => c.message).join('; ')}`
          );
        });
      });
    });
  });

  // =========================================================================
  // 4. NEGATIVE TESTS
  // =========================================================================
  describe('Negative & Boundary Validation', () => {
    it('rejects intentionally distorted side-bust dart leg', () => {
      const pieces = draftBodiceBlock(validMeasurements, bodiceConcept, { dartStyle: 'side-bust' });
      const frontPiece = pieces[0];
      const origDart = frontPiece.darts[0];

      // Distort leg by 1.2 cm
      const distortedDart = {
        ...origDart,
        legLeft: {
          x: origDart.legLeft.x - 0.5,
          y: origDart.legLeft.y - 1.2
        }
      };

      const distortedPieces = [
        {
          ...frontPiece,
          darts: [distortedDart]
        },
        pieces[1]
      ];

      const report = validatePatternDraft(distortedPieces);
      const dartCheck = report.checks.find(c => c.id.includes('dart-front-side-bust'));
      assert.ok(dartCheck);
      assert.strictEqual(dartCheck.status, 'fail');
      assert.strictEqual(report.isValid, false);
    });
  });
});
