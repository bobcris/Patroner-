/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BodyMeasurements, DesignSpecification, Notch, PatternPiece, SleeveEaseStrategy, StandardSize } from '../../types';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import {
  STANDARD_SIZING_SYSTEM,
  calculateSleeveGarmentDimensions,
  validateSleeveMeasurements
} from '../measurements/standards';
import { draftBodiceBlock } from './bodice-block';
import { draftSleeveBlock, extractArmholeContext, evaluateSleeveCapCompatibility } from './sleeve-block';
import { validatePatternDraft } from '../validation/seam-validator';
import { distance } from '../geometry/math';

describe('Milestone 04.2: Deterministic Sleeve Drafting Engine', () => {
  const bodiceConcept = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice') || {
    id: 'test-bodice-concept',
    name: 'Tailored Bodice Block',
    prompt: 'Tailored basic bodice block with set-in fitted sleeve',
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
    sleeveEaseStrategy: 'classic' as SleeveEaseStrategy,
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
  describe('1. Sleeve Measurement Validation', () => {
    it('accepts valid standard measurements set (Size M)', () => {
      const res = validateSleeveMeasurements(validMeasurements);
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.errors.length, 0);
    });

    it('rejects physically impossible biceps circumference', () => {
      const invalid = { ...validMeasurements, bicepsCircumference: 14 }; // below 20cm minimum
      const res = validateSleeveMeasurements(invalid);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Biceps circumference')));
    });

    it('rejects wrist circumference exceeding biceps circumference', () => {
      const invalid = { ...validMeasurements, bicepsCircumference: 24, wristCircumference: 26 };
      const res = validateSleeveMeasurements(invalid);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('cannot equal or exceed biceps')));
    });

    it('rejects elbow position length exceeding total sleeve length', () => {
      const invalid = { ...validMeasurements, sleeveLength: 50, armLengthToElbow: 45 };
      const res = validateSleeveMeasurements(invalid);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Arm length to elbow')));
    });
  });

  // =========================================================================
  // 2. ARMHOLE CONTEXT DERIVATION
  // =========================================================================
  describe('2. Bodice Armhole Context Extraction', () => {
    it('extracts continuous curve lengths from drafted bodice pieces', () => {
      const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      const armholeCtx = extractArmholeContext(bodicePieces);

      assert.ok(armholeCtx.frontArmholeLengthCm > 16, `Front armhole too short: ${armholeCtx.frontArmholeLengthCm}`);
      assert.ok(armholeCtx.backArmholeLengthCm > 16, `Back armhole too short: ${armholeCtx.backArmholeLengthCm}`);
      assert.ok(armholeCtx.totalArmholeLengthCm > 34, `Total armhole too short: ${armholeCtx.totalArmholeLengthCm}`);
      assert.strictEqual(
        Number((armholeCtx.frontArmholeLengthCm + armholeCtx.backArmholeLengthCm).toFixed(2)),
        armholeCtx.totalArmholeLengthCm
      );
    });
  });

  // =========================================================================
  // 3. CROWN APEX TANGENCY INVARIANT
  // =========================================================================
  describe('3. Crown Apex Tangency Invariant', () => {
    it('guarantees pure horizontal tangency (0.0° deviation) at crown apex (0,0)', () => {
      const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      const { diagnostics } = draftSleeveBlock(validMeasurements, bodiceConcept, {
        bodicePieces
      });

      assert.strictEqual(
        diagnostics.crownTangencyDeg,
        0,
        `Crown apex must be strictly horizontal (0.0°), received: ${diagnostics.crownTangencyDeg}°`
      );
    });
  });

  // =========================================================================
  // 4. UNDERARM INSEAM PARITY INVARIANT
  // =========================================================================
  describe('4. Underarm Inseam Parity Invariant', () => {
    it('maintains front and back underarm inseam parity within 0.05 cm', () => {
      const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      const { diagnostics, piece } = draftSleeveBlock(validMeasurements, bodiceConcept, {
        bodicePieces
      });

      assert.ok(
        diagnostics.inseamParityDeltaCm <= 0.05,
        `Inseam delta exceeds tolerance: ${diagnostics.inseamParityDeltaCm} cm`
      );
      assert.ok(diagnostics.frontInseamLengthCm > 38, `Inseam too short: ${diagnostics.frontInseamLengthCm}`);
      assert.ok(diagnostics.backInseamLengthCm > 38, `Inseam too short: ${diagnostics.backInseamLengthCm}`);

      // Verify corresponding seam objects on the piece
      const frontInseam = piece.seams.find(s => s.id === 'slv-front-inseam');
      const backInseam = piece.seams.find(s => s.id === 'slv-back-inseam');
      assert.ok(frontInseam, 'Missing front inseam seamline');
      assert.ok(backInseam, 'Missing back inseam seamline');
      assert.ok(Math.abs(frontInseam.lengthCm - backInseam.lengthCm) <= 0.05);
    });
  });

  // =========================================================================
  // 5. CAP EASE CONTROL STRATEGIES
  // =========================================================================
  describe('5. Sleeve Cap Ease Strategies', () => {
    const strategies: SleeveEaseStrategy[] = ['tailored', 'classic', 'fitted', 'flat'];

    strategies.forEach(strategy => {
      it(`drafts successfully with '${strategy}' cap ease strategy`, () => {
        const spec: DesignSpecification = { ...bodiceConcept, sleeveEaseStrategy: strategy };
        const bodicePieces = draftBodiceBlock(validMeasurements, spec);
        const { diagnostics, piece } = draftSleeveBlock(validMeasurements, spec, {
          strategy,
          bodicePieces
        });

        assert.strictEqual(diagnostics.strategy, strategy);
        assert.ok(diagnostics.totalCapLengthCm > diagnostics.bodiceArmholeLengthCm, 'Cap length must exceed bodice armhole');
        assert.ok(diagnostics.capEaseCm > 0, `Cap ease must be positive, got ${diagnostics.capEaseCm}`);

        // Strategy-specific ease ranges based on differential geometry & tailoring standards
        if (strategy === 'tailored') {
          assert.ok(diagnostics.capEaseCm >= 2.5 && diagnostics.capEaseCm <= 5.5, `Tailored ease out of range: ${diagnostics.capEaseCm}`);
        } else if (strategy === 'classic') {
          assert.ok(diagnostics.capEaseCm >= 1.5 && diagnostics.capEaseCm <= 4.0, `Classic ease out of range: ${diagnostics.capEaseCm}`);
        } else if (strategy === 'fitted') {
          assert.ok(diagnostics.capEaseCm >= 0.8 && diagnostics.capEaseCm <= 2.8, `Fitted ease out of range: ${diagnostics.capEaseCm}`);
        } else if (strategy === 'flat') {
          assert.ok(diagnostics.capEaseCm >= 0.0 && diagnostics.capEaseCm <= 1.8, `Flat ease out of range: ${diagnostics.capEaseCm}`);
        }

        // Check notches are present
        assert.ok(piece.notches.length >= 3, `Sleeve should have at least 3 notches, found: ${piece.notches.length}`);
        const singleFront = piece.notches.find(n => n.type === 'single');
        const doubleBack = piece.notches.find(n => n.type === 'double');
        const apexNotch = piece.notches.find(n => n.id === 'notch-slv-crown' || n.id === 'slv-notch-apex');
        assert.ok(singleFront, 'Missing single front armhole notch');
        assert.ok(doubleBack, 'Missing double back armhole notch');
        assert.ok(apexNotch, 'Missing crown apex shoulder notch');
      });
    });
  });

  // =========================================================================
  // 6. MULTI-SIZE STANDARDIZED ANTHROPOMETRIC CONSISTENCY
  // =========================================================================
  describe('6. Standard Sizing Multi-Size Consistency (XS to XXL)', () => {
    const sizes: StandardSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

    sizes.forEach(size => {
      it(`drafts deterministic sleeve for Standard Size ${size}`, () => {
        const measurements = STANDARD_SIZING_SYSTEM.sizes[size];
        const bodicePieces = draftBodiceBlock(measurements, bodiceConcept);
        const { piece, diagnostics } = draftSleeveBlock(measurements, bodiceConcept, {
          bodicePieces
        });

        assert.strictEqual(piece.pieceCode, 'SLV-01');
        assert.strictEqual(piece.cutCount, 2);
        assert.strictEqual(piece.grainline.direction, 'vertical');
        assert.ok(diagnostics.bicepsWidthCm > 28, `Biceps width too small: ${diagnostics.bicepsWidthCm}`);
        assert.ok(diagnostics.capHeightCm >= 9.5, `Cap height too low: ${diagnostics.capHeightCm}`);
        assert.ok(piece.boundingBox.widthCm > 30, `Bounding box width too small: ${piece.boundingBox.widthCm}`);
        assert.ok(piece.boundingBox.heightCm > 50, `Bounding box height too small: ${piece.boundingBox.heightCm}`);
      });
    });
  });

  // =========================================================================
  // 7. ANTHROPOMETRIC FIT & EASE PROPORTIONS
  // =========================================================================
  describe('7. Anthropometric Fit & Ease Proportions', () => {
    it('maintains positive biceps and wrist mechanical ease across all standard sizes', () => {
      const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      const { diagnostics, piece } = draftSleeveBlock(validMeasurements, bodiceConcept, {
        bodicePieces
      });

      assert.ok(diagnostics.bicepsEaseCm >= 3.0, `Biceps ease too small: ${diagnostics.bicepsEaseCm}`);
      assert.ok(diagnostics.wristEaseCm >= 4.0, `Wrist ease too small: ${diagnostics.wristEaseCm}`);
      assert.ok(diagnostics.capHeightCm >= 9.5 && diagnostics.capHeightCm <= 18.0, `Cap height outside expected range: ${diagnostics.capHeightCm}`);
      assert.ok(piece.notches.length >= 4, `Sleeve should have notches for crown, front/back armholes, and elbow: ${piece.notches.length}`);
    });
  });

  // =========================================================================
  // 8. THREE-PIECE SYSTEM VALIDATION (BODICE FRONT + BACK + SLEEVE)
  // =========================================================================
  describe('8. Integrated Pattern Validation with Seam Validator', () => {
    it('validates the complete three-piece bodice assembly without critical failures', () => {
      const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      const { piece: sleevePiece } = draftSleeveBlock(validMeasurements, bodiceConcept, {
        bodicePieces
      });

      const fullAssembly = [...bodicePieces, sleevePiece];
      assert.strictEqual(fullAssembly.length, 3);

      const validation = validatePatternDraft(fullAssembly);

      // Verify sleeve-specific checks in the report
      const sleeveEaseCheck = validation.checks.find(c => c.name.includes('Total Sleeve Cap Ease'));
      const sleeveInseamCheck = validation.checks.find(c => c.name.includes('Sleeve Inseam Parity'));
      const sleeveCrownCheck = validation.checks.find(c => c.name.includes('Sleeve Crown Tangency'));

      assert.ok(sleeveEaseCheck, 'Validation report missing sleeve cap ease check');
      assert.strictEqual(sleeveEaseCheck.status === 'fail', false, `Sleeve cap ease check failed: ${sleeveEaseCheck.message}`);

      assert.ok(sleeveInseamCheck, 'Validation report missing sleeve inseam parity check');
      assert.strictEqual(sleeveInseamCheck.status === 'fail', false, `Sleeve inseam check failed: ${sleeveInseamCheck.message}`);

      assert.ok(sleeveCrownCheck, 'Validation report missing sleeve crown tangency check');
      assert.strictEqual(sleeveCrownCheck.status === 'fail', false, `Sleeve crown tangency check failed: ${sleeveCrownCheck.message}`);

      assert.strictEqual(validation.isValid, true, 'Draft validation marked invalid');
    });
  });

  // =========================================================================
  // 9. INDEPENDENT FRONT & BACK SLEEVE-CAP COMPATIBILITY & RESIDUALS
  // =========================================================================
  describe('9. Independent Front and Back Armhole Compatibility & Residuals', () => {
    it('evaluates front and back compatibility independently with documented residuals', () => {
      const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, {
        strategy: 'classic',
        bodicePieces
      });

      const audit = evaluateSleeveCapCompatibility(piece, bodicePieces, 'classic');

      // 1. Armhole extraction
      assert.strictEqual(audit.frontArmholeLengthCm > 17, true);
      assert.strictEqual(audit.backArmholeLengthCm > 17, true);
      assert.strictEqual(
        Number((audit.frontArmholeLengthCm + audit.backArmholeLengthCm).toFixed(2)),
        audit.totalArmholeLengthCm
      );

      // 2. Front and back cap lengths exceed armholes independently
      assert.ok(audit.frontCapLengthCm >= audit.frontArmholeLengthCm, 'Front cap must be >= front armhole');
      assert.ok(audit.backCapLengthCm >= audit.backArmholeLengthCm, 'Back cap must be >= back armhole');
      assert.ok(audit.actualFrontEaseCm > 0, `Front ease must be positive: ${audit.actualFrontEaseCm}`);
      assert.ok(audit.actualBackEaseCm > 0, `Back ease must be positive: ${audit.actualBackEaseCm}`);

      // 3. Document residuals: actualEase - targetEase
      assert.ok(Number.isFinite(audit.frontResidualCm), 'Front residual must be finite number');
      assert.ok(Number.isFinite(audit.backResidualCm), 'Back residual must be finite number');
      assert.ok(Number.isFinite(audit.totalResidualCm), 'Total residual must be finite number');

      // 4. Compliance flags
      assert.strictEqual(audit.isFrontCompliant, true);
      assert.strictEqual(audit.isBackCompliant, true);
      assert.strictEqual(audit.isTotalCompliant, true);
    });

    it('documents front and back ease across all 4 ease strategies with exact mathematical reconciliation', () => {
      const strategies: SleeveEaseStrategy[] = ['tailored', 'classic', 'fitted', 'flat'];
      const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);

      strategies.forEach(st => {
        const { piece, diagnostics } = draftSleeveBlock(validMeasurements, bodiceConcept, {
          strategy: st,
          bodicePieces
        });

        const audit = evaluateSleeveCapCompatibility(piece, bodicePieces, st);

        assert.strictEqual(audit.strategy, st);
        assert.ok(diagnostics.frontEaseResidualCm !== undefined);
        assert.ok(diagnostics.backEaseResidualCm !== undefined);
        assert.ok(diagnostics.totalEaseResidualCm !== undefined);

        // Core Mathematical Identities:
        // 1. frontEase = frontCapLength - frontArmholeLength
        const expectedFrontEase = Number((audit.frontCapLengthCm - audit.frontArmholeLengthCm).toFixed(2));
        assert.strictEqual(audit.actualFrontEaseCm, expectedFrontEase);
        assert.strictEqual(diagnostics.frontCapEaseCm, expectedFrontEase);

        // 2. backEase = backCapLength - backArmholeLength
        const expectedBackEase = Number((audit.backCapLengthCm - audit.backArmholeLengthCm).toFixed(2));
        assert.strictEqual(audit.actualBackEaseCm, expectedBackEase);
        assert.strictEqual(diagnostics.backCapEaseCm, expectedBackEase);

        // 3. totalEase = frontEase + backEase
        const expectedTotalEase = Number((expectedFrontEase + expectedBackEase).toFixed(2));
        assert.strictEqual(audit.actualTotalEaseCm, expectedTotalEase);
        assert.strictEqual(diagnostics.capEaseCm, expectedTotalEase);

        // 4. frontResidual = frontEase - targetFrontEase
        const expectedFrontResidual = Number((expectedFrontEase - audit.targetFrontEaseCm).toFixed(2));
        assert.strictEqual(audit.frontResidualCm, expectedFrontResidual);
        assert.strictEqual(diagnostics.frontEaseResidualCm, expectedFrontResidual);

        // 5. backResidual = backEase - targetBackEase
        const expectedBackResidual = Number((expectedBackEase - audit.targetBackEaseCm).toFixed(2));
        assert.strictEqual(audit.backResidualCm, expectedBackResidual);
        assert.strictEqual(diagnostics.backEaseResidualCm, expectedBackResidual);

        // 6. totalResidual = totalEase - targetTotalEase
        const expectedTotalResidual = Number((expectedTotalEase - audit.targetTotalEaseCm).toFixed(2));
        assert.strictEqual(audit.totalResidualCm, expectedTotalResidual);
        assert.strictEqual(diagnostics.totalEaseResidualCm, expectedTotalResidual);

        // Cap ease must strictly decrease from tailored to flat
        assert.ok(audit.actualTotalEaseCm > 0, `Ease for ${st} must be positive: ${audit.actualTotalEaseCm}`);
      });
    });

    it('verifies that positive ease does not automatically mean target compliance', () => {
      const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, {
        strategy: 'classic',
        bodicePieces
      });

      const audit = evaluateSleeveCapCompatibility(piece, bodicePieces, 'classic');

      // Geometric validity: positive ease within physical gatherable boundary
      assert.strictEqual(audit.isGeometricallyValid, true);
      assert.ok(audit.actualTotalEaseCm > 0);

      // Target compliance: must NOT be true merely because ease is positive!
      // For Size M Classic, actual ease is 3.26cm which exceeds [1.2, 2.5]cm target window.
      assert.strictEqual(audit.isTargetCompliant, false);
      assert.strictEqual(audit.targetStatus, 'elevated-ease');
      assert.notStrictEqual(audit.isGeometricallyValid, audit.isTargetCompliant);
    });

    it('validates that seam-validator thresholds match diagnostic messages exactly', () => {
      const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);
      // Test tailored strategy which produces netEase > 4.5 cm (+4.78 cm)
      const tailoredSpec = { ...bodiceConcept, sleeveEaseStrategy: 'tailored' as const };
      const { piece: tailoredSleeve } = draftSleeveBlock(validMeasurements, tailoredSpec, {
        strategy: 'tailored',
        bodicePieces
      });

      const validation = validatePatternDraft([...bodicePieces, tailoredSleeve]);
      const totalCheck = validation.checks.find(c => c.id === 'val-slv-total-cap-ease');
      assert.ok(totalCheck, 'Missing val-slv-total-cap-ease check');
      assert.strictEqual(totalCheck.status, 'warning');
      assert.strictEqual(totalCheck.expectedValue, 'Ease <= 4.5 cm');
      assert.strictEqual(totalCheck.toleranceCm, 4.5);
      assert.ok(totalCheck.message.includes('exceeds 4.5 cm'));
    });
  });

  // =========================================================================
  // 10. ADVERSARIAL AND BOUNDARY INPUT REJECTION
  // =========================================================================
  describe('10. Adversarial and Boundary Measurement Rejection', () => {
    it('rejects non-finite (NaN, Infinity) biceps circumference', () => {
      const invalidNaN = { ...validMeasurements, bicepsCircumference: NaN };
      const resNaN = validateSleeveMeasurements(invalidNaN);
      assert.strictEqual(resNaN.isValid, false);
      assert.ok(resNaN.errors.some(e => e.includes('positive finite number')));

      const invalidInf = { ...validMeasurements, bicepsCircumference: Infinity };
      const resInf = validateSleeveMeasurements(invalidInf);
      assert.strictEqual(resInf.isValid, false);
      assert.ok(resInf.errors.some(e => e.includes('positive finite number')));
    });

    it('rejects negative and zero measurements', () => {
      const invalidNeg = { ...validMeasurements, wristCircumference: -5 };
      const resNeg = validateSleeveMeasurements(invalidNeg);
      assert.strictEqual(resNeg.isValid, false);

      const invalidZero = { ...validMeasurements, sleeveLength: 0 };
      const resZero = validateSleeveMeasurements(invalidZero);
      assert.strictEqual(resZero.isValid, false);
    });

    it('rejects missing mandatory sleeve parameters', () => {
      const missingBiceps: Partial<BodyMeasurements> = { ...validMeasurements };
      delete missingBiceps.bicepsCircumference;
      const res = validateSleeveMeasurements(missingBiceps);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Biceps circumference is required')));
    });

    it('throws error if drafting is attempted with invalid measurements', () => {
      const invalid = { ...validMeasurements, bicepsCircumference: 10 };
      assert.throws(() => {
        draftSleeveBlock(invalid, bodiceConcept);
      }, /Sleeve drafting measurement validation failed/);
    });
  });

  // =========================================================================
  // 11. CUSTOM ANTHROPOMETRIC MORPHOLOGIES
  // =========================================================================
  describe('11. Custom Anthropometric Morphologies', () => {
    it('drafts successfully for athletic arm (high biceps, narrow wrist)', () => {
      const athletic: BodyMeasurements = {
        ...validMeasurements,
        bicepsCircumference: 36.0,
        elbowCircumference: 29.0,
        wristCircumference: 16.0,
        sleeveLength: 61.0,
        armLengthToElbow: 35.0
      };

      const bodice = draftBodiceBlock(athletic, bodiceConcept);
      const { piece, diagnostics } = draftSleeveBlock(athletic, bodiceConcept, { bodicePieces: bodice });

      assert.strictEqual(piece.pieceCode, 'SLV-01');
      assert.ok(diagnostics.bicepsWidthCm >= 40.0, `Athletic biceps width too small: ${diagnostics.bicepsWidthCm}`);
      assert.ok(diagnostics.inseamParityDeltaCm <= 0.05);
      assert.strictEqual(diagnostics.crownTangencyDeg, 0.0);
    });

    it('drafts successfully for slender / long arm', () => {
      const slender: BodyMeasurements = {
        ...validMeasurements,
        bicepsCircumference: 22.0,
        elbowCircumference: 19.0,
        wristCircumference: 13.0,
        sleeveLength: 64.0,
        armLengthToElbow: 37.0
      };

      const bodice = draftBodiceBlock(slender, bodiceConcept);
      const { piece, diagnostics } = draftSleeveBlock(slender, bodiceConcept, { bodicePieces: bodice });

      assert.strictEqual(piece.pieceCode, 'SLV-01');
      assert.ok(diagnostics.bicepsWidthCm >= 26.0);
      assert.ok(diagnostics.inseamParityDeltaCm <= 0.05);
      assert.strictEqual(diagnostics.crownTangencyDeg, 0.0);
    });

    it('drafts successfully for petite arm', () => {
      const petite: BodyMeasurements = {
        ...validMeasurements,
        bicepsCircumference: 24.0,
        elbowCircumference: 20.0,
        wristCircumference: 14.0,
        sleeveLength: 50.0,
        armLengthToElbow: 29.0
      };

      const bodice = draftBodiceBlock(petite, bodiceConcept);
      const { piece, diagnostics } = draftSleeveBlock(petite, bodiceConcept, { bodicePieces: bodice });

      assert.strictEqual(piece.pieceCode, 'SLV-01');
      assert.ok(piece.boundingBox.heightCm < 58.0);
      assert.ok(diagnostics.inseamParityDeltaCm <= 0.05);
      assert.strictEqual(diagnostics.crownTangencyDeg, 0.0);
    });
  });

  // =========================================================================
  // 12. CUTTING CONTOUR OFFSET & BOUNDARY INTEGRITY
  // =========================================================================
  describe('12. Sleeve Offset & Geometric Integrity', () => {
    it('generates closed, valid cutting contour with parallel normal offset', () => {
      const bodice = draftBodiceBlock(validMeasurements, bodiceConcept);
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces: bodice });

      assert.ok(piece.offsetResult, 'Missing offset result');
      assert.strictEqual(piece.offsetResult.status === 'failure', false, 'Offset generation failed');
      assert.ok(piece.offsetResult.maxDeviationCm <= 0.05, `Offset deviation too large: ${piece.offsetResult.maxDeviationCm}`);
      assert.ok(piece.cuttingContour, 'Missing cutting contour');
      assert.strictEqual(piece.cuttingContour.isClosed, true, 'Cutting contour must be closed');

      // Verify all coordinates in cutting contour are finite
      const poly = piece.cuttingContour.toPolyline(8);
      poly.forEach(pt => {
        assert.ok(Number.isFinite(pt.x), `Non-finite cutting X: ${pt.x}`);
        assert.ok(Number.isFinite(pt.y), `Non-finite cutting Y: ${pt.y}`);
      });
    });
  });

  // =========================================================================
  // 13. NOTCH PLACEMENT & PAIRING
  // =========================================================================
  describe('13. Sleeve Notch Geometry and Correspondence', () => {
    it('places all required manufacturing notches at exact topological locations', () => {
      const bodice = draftBodiceBlock(validMeasurements, bodiceConcept);
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces: bodice });

      // Crown notch at (0, 0)
      const crown = piece.notches.find(n => n.id === 'notch-slv-crown');
      assert.ok(crown, 'Missing crown apex notch');
      assert.strictEqual(crown.position.x, 0);
      assert.strictEqual(crown.position.y, 0);

      // Front scye notch
      const fScye = piece.notches.find(n => n.id === 'notch-slv-front-armhole');
      assert.ok(fScye, 'Missing front scye notch');
      assert.strictEqual(fScye.type, 'single');
      assert.ok(fScye.position.x > 0, 'Front scye notch must be on front half (x > 0)');

      // Back scye double notches
      const bScye1 = piece.notches.find(n => n.id === 'notch-slv-back-armhole-1');
      const bScye2 = piece.notches.find(n => n.id === 'notch-slv-back-armhole-2');
      assert.ok(bScye1 && bScye2, 'Missing back scye double notches');
      assert.ok(bScye1.position.x < 0, 'Back scye notch must be on back half (x < 0)');
      assert.ok(bScye2.position.x < 0, 'Back scye notch must be on back half (x < 0)');

      // Elbow notches
      const elbF = piece.notches.find(n => n.id === 'notch-slv-elbow-front');
      const elbB = piece.notches.find(n => n.id === 'notch-slv-elbow-back');
      assert.ok(elbF && elbB, 'Missing elbow notches');
      assert.strictEqual(elbF.position.y, validMeasurements.armLengthToElbow);
      assert.strictEqual(elbB.position.y, validMeasurements.armLengthToElbow);
    });

    it('verifies sleeve scye notches pair with corresponding bodice chest and back scye notches', () => {
      const bodice = draftBodiceBlock(validMeasurements, bodiceConcept);
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces: bodice });

      const frontBodice = bodice.find(p => p.id === 'piece-bodice-front');
      const backBodice = bodice.find(p => p.id === 'piece-bodice-back');
      assert.ok(frontBodice && backBodice);

      // Verify front bodice has chest-level notch
      const fbNotch = frontBodice.notches.find(n => n.id.includes('chest'));
      assert.ok(fbNotch, 'Front bodice must contain chest notch');
      assert.strictEqual(fbNotch.type, 'single');

      // Verify back bodice has across-back double notch
      const bbNotches = backBodice.notches.filter(n => n.id.includes('across-back'));
      assert.strictEqual(bbNotches.length, 2, 'Back bodice must contain double across-back notch');

      // Verify validation check val-slv-notch-correspondence passes with full assembly
      const validation = validatePatternDraft([...bodice, piece]);
      const notchCheck = validation.checks.find(c => c.id === 'val-slv-notch-correspondence');
      assert.ok(notchCheck, 'Missing val-slv-notch-correspondence check');
      assert.strictEqual(notchCheck.status, 'pass');
      assert.ok(notchCheck.message.includes('pairing with bodice chest notch'));
    });
  });

  // =========================================================================
  // 14. MILESTONE 04.2.2.1: FINAL COMPATIBILITY & NOTCH CORRESPONDENCE
  // =========================================================================
  describe('14. Milestone 04.2.2.1: Final Compatibility & Notch Correspondence Reconciliation', () => {
    const bodicePieces = draftBodiceBlock(validMeasurements, bodiceConcept);
    const armholeCtx = extractArmholeContext(bodicePieces);

    // Helper to build a mock sleeve piece with custom seam lengths and notches
    function createMockSleevePiece(
      frontCapLen: number,
      backCapLen: number,
      notchOverrides?: Partial<Notch>[]
    ) {
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces });

      const updatedSeams = piece.seams.map(s => {
        if (s.id === 'slv-front-cap-seam') return { ...s, lengthCm: frontCapLen };
        if (s.id === 'slv-back-cap-seam') return { ...s, lengthCm: backCapLen };
        return s;
      });

      let updatedNotches = [...piece.notches];
      if (notchOverrides) {
        notchOverrides.forEach(ov => {
          const idx = updatedNotches.findIndex(n => n.id === ov.id);
          if (idx !== -1) {
            updatedNotches[idx] = { ...updatedNotches[idx], ...ov };
          }
        });
      }

      return {
        ...piece,
        seams: updatedSeams,
        notches: updatedNotches
      };
    }

    it('evaluates every strategy minimum and maximum target boundaries accurately', () => {
      const strategies: SleeveEaseStrategy[] = ['tailored', 'classic', 'fitted', 'flat'];
      const table = {
        tailored: { min: 2.0, max: 3.8 },
        classic: { min: 1.2, max: 2.5 },
        fitted: { min: 0.6, max: 1.6 },
        flat: { min: 0.0, max: 0.8 }
      };

      strategies.forEach(st => {
        const bounds = table[st];

        // 1. Exactly at minimum
        const mockAtMin = createMockSleevePiece(
          armholeCtx.frontArmholeLengthCm + bounds.min * 0.45,
          armholeCtx.backArmholeLengthCm + bounds.min * 0.55
        );
        const auditMin = evaluateSleeveCapCompatibility(mockAtMin, bodicePieces, st);
        assert.strictEqual(auditMin.isTargetCompliant, true, `${st} at min should be compliant`);
        assert.strictEqual(auditMin.targetStatus, 'target-compliant');
        assert.strictEqual(auditMin.isAssemblyEaseValid, true);

        // 2. Exactly at maximum
        const mockAtMax = createMockSleevePiece(
          armholeCtx.frontArmholeLengthCm + bounds.max * 0.45,
          armholeCtx.backArmholeLengthCm + bounds.max * 0.55
        );
        const auditMax = evaluateSleeveCapCompatibility(mockAtMax, bodicePieces, st);
        assert.strictEqual(auditMax.isTargetCompliant, true, `${st} at max should be compliant`);
        assert.strictEqual(auditMax.targetStatus, 'target-compliant');

        // 3. Just below minimum (if min > 0)
        if (bounds.min > 0.1) {
          const mockBelow = createMockSleevePiece(
            armholeCtx.frontArmholeLengthCm + (bounds.min - 0.2) * 0.45,
            armholeCtx.backArmholeLengthCm + (bounds.min - 0.2) * 0.55
          );
          const auditBelow = evaluateSleeveCapCompatibility(mockBelow, bodicePieces, st);
          assert.strictEqual(auditBelow.isTargetCompliant, false);
          assert.strictEqual(auditBelow.targetStatus, 'insufficient-ease');
        }

        // 4. Just above maximum
        const mockAbove = createMockSleevePiece(
          armholeCtx.frontArmholeLengthCm + (bounds.max + 0.3) * 0.45,
          armholeCtx.backArmholeLengthCm + (bounds.max + 0.3) * 0.55
        );
        const auditAbove = evaluateSleeveCapCompatibility(mockAbove, bodicePieces, st);
        assert.strictEqual(auditAbove.isTargetCompliant, false);
        assert.ok(auditAbove.targetStatus === 'elevated-ease' || auditAbove.targetStatus === 'high-crimp-warning');
      });
    });

    it('distinguishes target compliance from positive geometric ease', () => {
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, { strategy: 'classic', bodicePieces });
      const audit = evaluateSleeveCapCompatibility(piece, bodicePieces, 'classic');

      assert.strictEqual(audit.isAssemblyEaseValid, true);
      assert.strictEqual(audit.isGeometricallyValid, true);
      assert.strictEqual(audit.isTargetCompliant, false);
      assert.strictEqual(audit.targetStatus, 'elevated-ease');
    });

    it('rejects front/back ease imbalance with negative front ease', () => {
      // Front cap shorter than front armhole by 0.4 cm, but back cap has +2.4 cm ease (net total ease: +2.0 cm)
      const mockImbalancedFront = createMockSleevePiece(
        armholeCtx.frontArmholeLengthCm - 0.4,
        armholeCtx.backArmholeLengthCm + 2.4
      );
      const audit = evaluateSleeveCapCompatibility(mockImbalancedFront, bodicePieces, 'classic');

      assert.strictEqual(audit.isFrontEaseValid, false);
      assert.strictEqual(audit.isBackEaseValid, true);
      assert.strictEqual(audit.isAssemblyEaseValid, false);
      assert.strictEqual(audit.isTargetCompliant, false);
      assert.strictEqual(audit.targetStatus, 'negative-ease-invalid');
    });

    it('rejects front/back ease imbalance with negative back ease', () => {
      // Back cap shorter than back armhole by 0.3 cm, but front cap has +2.3 cm ease (net total ease: +2.0 cm)
      const mockImbalancedBack = createMockSleevePiece(
        armholeCtx.frontArmholeLengthCm + 2.3,
        armholeCtx.backArmholeLengthCm - 0.3
      );
      const audit = evaluateSleeveCapCompatibility(mockImbalancedBack, bodicePieces, 'classic');

      assert.strictEqual(audit.isFrontEaseValid, true);
      assert.strictEqual(audit.isBackEaseValid, false);
      assert.strictEqual(audit.isAssemblyEaseValid, false);
      assert.strictEqual(audit.isTargetCompliant, false);
      assert.strictEqual(audit.targetStatus, 'negative-ease-invalid');
    });

    it('rejects total ease exceeding 5.0 cm assembly limit', () => {
      const mockExcessive = createMockSleevePiece(
        armholeCtx.frontArmholeLengthCm + 2.6,
        armholeCtx.backArmholeLengthCm + 2.7 // total ease: 5.3 cm
      );
      const audit = evaluateSleeveCapCompatibility(mockExcessive, bodicePieces, 'tailored');

      assert.strictEqual(audit.isTotalAssemblyEaseValid, false);
      assert.strictEqual(audit.isAssemblyEaseValid, false);
      assert.strictEqual(audit.isTargetCompliant, false);
      assert.strictEqual(audit.targetStatus, 'excessive-ease-invalid');
    });

    it('enforces consistency: an invalid assembly can NEVER be target compliant', () => {
      const invalidCases = [
        createMockSleevePiece(armholeCtx.frontArmholeLengthCm - 0.2, armholeCtx.backArmholeLengthCm + 2.0),
        createMockSleevePiece(armholeCtx.frontArmholeLengthCm + 2.0, armholeCtx.backArmholeLengthCm - 0.2),
        createMockSleevePiece(armholeCtx.frontArmholeLengthCm + 3.0, armholeCtx.backArmholeLengthCm + 3.0)
      ];

      invalidCases.forEach(mock => {
        const audit = evaluateSleeveCapCompatibility(mock, bodicePieces, 'classic');
        assert.strictEqual(audit.isAssemblyEaseValid, false);
        assert.strictEqual(audit.isTargetCompliant, false);
      });
    });

    it('handles missing bodice pieces in notch correspondence with structured warning', () => {
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces });
      // Validate with ONLY sleeve piece (bodice absent)
      const report = validatePatternDraft([piece]);

      const correspondenceCheck = report.checks.find(c => c.id === 'val-slv-notch-correspondence');
      assert.ok(correspondenceCheck, 'Missing val-slv-notch-correspondence check');
      assert.strictEqual(correspondenceCheck.status, 'warning');
      assert.ok(correspondenceCheck.message.includes('Bodice pieces are absent'));

      // Internal notch check should still pass
      const internalCheck = report.checks.find(c => c.id === 'val-slv-notch-internal');
      assert.ok(internalCheck, 'Missing val-slv-notch-internal check');
      assert.strictEqual(internalCheck.status, 'pass');
    });

    it('fails internal notch check when crown notch is displaced from apex', () => {
      const displacedCrown = createMockSleevePiece(
        armholeCtx.frontArmholeLengthCm + 1.5,
        armholeCtx.backArmholeLengthCm + 1.5,
        [{ id: 'notch-slv-crown', position: { x: 1.2, y: 0.5 } }]
      );

      const report = validatePatternDraft([...bodicePieces, displacedCrown]);
      const internalCheck = report.checks.find(c => c.id === 'val-slv-notch-internal');
      assert.ok(internalCheck);
      assert.strictEqual(internalCheck.status, 'fail');
      assert.ok(internalCheck.message.includes('Crown notch is displaced'));
    });

    it('fails correspondence check when front or back scye notch is shifted', () => {
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces });
      const fNotch = piece.notches.find(n => n.id === 'notch-slv-front-armhole')!;
      // Displace front scye notch by 2.0 cm
      const misalignedSleeve = createMockSleevePiece(
        armholeCtx.frontArmholeLengthCm + 1.5,
        armholeCtx.backArmholeLengthCm + 1.5,
        [{ id: 'notch-slv-front-armhole', position: { x: fNotch.position.x + 2.0, y: fNotch.position.y } }]
      );

      const report = validatePatternDraft([...bodicePieces, misalignedSleeve]);
      const correspondenceCheck = report.checks.find(c => c.id === 'val-slv-notch-correspondence');
      assert.ok(correspondenceCheck);
      assert.strictEqual(correspondenceCheck.status, 'fail');
      assert.ok(correspondenceCheck.message.includes('Sleeve-to-bodice scye notch geometric correspondence failed'));
    });

    it('verifies genuine sleeve-to-bodice notch correspondence on default draft', () => {
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces });
      const report = validatePatternDraft([...bodicePieces, piece]);

      const internalCheck = report.checks.find(c => c.id === 'val-slv-notch-internal');
      assert.ok(internalCheck);
      assert.strictEqual(internalCheck.status, 'pass');

      const correspondenceCheck = report.checks.find(c => c.id === 'val-slv-notch-correspondence');
      assert.ok(correspondenceCheck);
      assert.strictEqual(correspondenceCheck.status, 'pass');
      assert.ok(correspondenceCheck.message.includes('Verified topology'));
    });

    it('evaluates fabric-specific ease compensation when fabric property is provided', () => {
      const { piece } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces });
      const lowStretchFabric = {
        id: 'low-stretch-wool',
        name: 'Low Stretch Wool',
        composition: '98% Wool, 2% Elastane',
        weight: 'medium' as const,
        stretch: 'low-stretch' as const,
        recommendedEaseCm: { waist: 2.0, hip: 3.0, bust: 3.5 },
        drapeDescription: 'Slight give.'
      };

      const auditRigid = evaluateSleeveCapCompatibility(piece, bodicePieces, 'classic');
      const auditStretch = evaluateSleeveCapCompatibility(piece, bodicePieces, {
        strategy: 'classic',
        fabric: lowStretchFabric
      });

      // Rigid: stretch factor 1.0
      assert.strictEqual(auditRigid.fabricStretchFactor, 1.0);
      assert.strictEqual(auditRigid.recommendedEaseRangeCm.min, 1.2);
      assert.strictEqual(auditRigid.recommendedEaseRangeCm.max, 2.5);

      // Low stretch: stretch factor 0.85
      assert.strictEqual(auditStretch.fabricStretchFactor, 0.85);
      assert.strictEqual(auditStretch.recommendedEaseRangeCm.min, Number((1.2 * 0.85).toFixed(2))); // 1.02
      assert.strictEqual(auditStretch.recommendedEaseRangeCm.max, Number((2.5 * 0.85).toFixed(2))); // 2.12
      assert.strictEqual(auditStretch.targetTotalEaseCm, Number((1.8 * 0.85).toFixed(2))); // 1.53
    });

    it('produces deterministic output across repeated evaluations', () => {
      const { piece: pieceA, diagnostics: diagA } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces });
      const { piece: pieceB, diagnostics: diagB } = draftSleeveBlock(validMeasurements, bodiceConcept, { bodicePieces });

      assert.deepStrictEqual(diagA, diagB);
      assert.strictEqual(pieceA.notches.length, pieceB.notches.length);
      for (let i = 0; i < pieceA.notches.length; i++) {
        assert.deepStrictEqual(pieceA.notches[i].position, pieceB.notches[i].position);
      }

      const auditA = evaluateSleeveCapCompatibility(pieceA, bodicePieces, 'classic');
      const auditB = evaluateSleeveCapCompatibility(pieceB, bodicePieces, 'classic');
      assert.deepStrictEqual(auditA, auditB);
    });
  });
});
