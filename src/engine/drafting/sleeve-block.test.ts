/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BodyMeasurements, DesignSpecification, SleeveEaseStrategy, StandardSize } from '../../types';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import {
  STANDARD_SIZING_SYSTEM,
  calculateSleeveGarmentDimensions,
  validateSleeveMeasurements
} from '../measurements/standards';
import { draftBodiceBlock } from './bodice-block';
import { draftSleeveBlock, extractArmholeContext } from './sleeve-block';
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
});
