/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateFabricProperties } from './fabric-validator';
import { ENHANCED_PRESET_FABRICS, getEnhancedFabricById } from './fabric-presets';
import {
  calculateCompleteGarmentEase,
  calculateFabricAdaptedSleeveCapEase,
  calculateFabricAwareCircumferenceEase
} from './ease-engine';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';

describe('Milestone 04.5: Fabric-Aware Pattern Engineering & Ease Engine', () => {
  describe('1. Fabric Property Validation & Preset Library', () => {
    it('1. verifies all enhanced atelier preset fabrics pass physical validation', () => {
      assert.ok(ENHANCED_PRESET_FABRICS.length >= 5);
      for (const fabric of ENHANCED_PRESET_FABRICS) {
        const val = validateFabricProperties(fabric);
        assert.equal(val.isValid, true, `Fabric '${fabric.name}' must be physically valid: ${val.errors.join('; ')}`);
        assert.ok(fabric.gsm > 0);
        assert.ok(fabric.thicknessMm > 0);
        assert.ok(fabric.directional.warp.shrinkagePercent >= 0);
        assert.ok(fabric.directional.weft.shrinkagePercent >= 0);
        assert.ok(fabric.moldingFactor >= 0.5 && fabric.moldingFactor <= 1.8);
        assert.equal(fabric.isVerified, true);
      }
    });

    it('2. rejects fabric with negative or non-numeric GSM', () => {
      const invalidGsm: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        id: 'test-invalid-gsm',
        gsm: -150
      };
      const val = validateFabricProperties(invalidGsm);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('GSM') && e.includes('strictly positive')));
    });

    it('3. rejects fabric with negative shrinkage or extreme shrinkage (> 15%)', () => {
      const negativeShrink: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        id: 'test-neg-shrink',
        directional: {
          ...ENHANCED_PRESET_FABRICS[0].directional,
          warp: { shrinkagePercent: -2.0, stretchPercent: 2.0 }
        }
      };
      const val1 = validateFabricProperties(negativeShrink);
      assert.equal(val1.isValid, false);
      assert.ok(val1.errors.some(e => e.includes('Warp shrinkage cannot be negative')));

      const extremeShrink: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        id: 'test-extreme-shrink',
        directional: {
          ...ENHANCED_PRESET_FABRICS[0].directional,
          warp: { shrinkagePercent: 18.5, stretchPercent: 2.0 }
        }
      };
      const val2 = validateFabricProperties(extremeShrink);
      assert.equal(val2.isValid, false);
      assert.ok(val2.errors.some(e => e.includes('exceeds physical limit')));
    });

    it('4. rejects fabric with non-positive thickness or invalid molding factor', () => {
      const invalidThickness: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        thicknessMm: 0.0
      };
      const val = validateFabricProperties(invalidThickness);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('thickness')));

      const invalidMolding: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        moldingFactor: 2.8
      };
      const valMolding = validateFabricProperties(invalidMolding);
      assert.equal(valMolding.isValid, false);
      assert.ok(valMolding.errors.some(e => e.includes('molding factor')));
    });

    it('5. retrieves enhanced fabric by ID with reliable fallback to default wool', () => {
      const wool = getEnhancedFabricById('wool-crepe');
      assert.equal(wool.id, 'wool-crepe');
      assert.equal(wool.gsm, 320);

      const fallback = getEnhancedFabricById('non-existent-fabric-id');
      assert.equal(fallback.id, 'wool-crepe');
    });
  });

  describe('2. Deterministic Fabric-Aware Ease Calculations', () => {
    it('6. calculates baseline movement ease corresponding to ease profile', () => {
      const wool = getEnhancedFabricById('wool-crepe');
      const bustEase = calculateFabricAwareCircumferenceEase('bust', 90.0, 'classic', wool);

      assert.equal(bustEase.bodyMeasurementCm, 90.0);
      assert.equal(bustEase.baselineMovementEaseCm, 5.5);
      // Wool crepe has low weft stretch (4.5%), small stretch deduction applies
      assert.ok(bustEase.totalAppliedEaseCm > 4.5);
      assert.equal(bustEase.finishedGarmentDimensionCm, Number((90.0 + bustEase.totalAppliedEaseCm).toFixed(2)));
    });

    it('7. applies stretch deduction for high-stretch fabrics (Ponte di Roma)', () => {
      const ponte = getEnhancedFabricById('ponte-roma'); // 25% weft stretch
      const waistBody = 72.0;

      const waistEase = calculateFabricAwareCircumferenceEase('waist', waistBody, 'fitted', ponte);
      // For fitted profile (baseline waist ease ~ 2.0cm), high stretch reduces ease
      assert.ok(waistEase.stretchDeductionCm > 0.5, 'Stretch deduction must be positive');
      assert.ok(waistEase.totalAppliedEaseCm < waistEase.baselineMovementEaseCm);
    });

    it('8. applies shrinkage compensation and cutting allowance factor when requested', () => {
      const linen = getEnhancedFabricById('linen-heavy'); // 3% weft shrinkage, 4% warp shrinkage
      const waistBody = 72.0;

      const withShrinkage = calculateFabricAwareCircumferenceEase('waist', waistBody, 'classic', linen, {
        allowanceForShrinkage: true
      });

      assert.ok(withShrinkage.shrinkageCompensationCm > 2.0);
      assert.ok(withShrinkage.cuttingAllowanceFactor > 1.02);
      assert.ok(withShrinkage.totalAppliedEaseCm > withShrinkage.baselineMovementEaseCm);
    });

    it('9. applies turn-of-cloth thickness allowance for heavy fabrics', () => {
      const denim = getEnhancedFabricById('selvedge-denim'); // 1.15 mm thickness
      const bustEase = calculateFabricAwareCircumferenceEase('bust', 90.0, 'classic', denim, {
        layerCount: 2,
        silhouette: 'tailored'
      });

      // Thickness delta = 2 * pi * (1.15/10) * 0.5 * 2 = ~0.72 cm
      assert.ok(bustEase.thicknessAllowanceCm >= 0.5);
    });

    it('10. adapts sleeve cap ease based on fabric molding factor', () => {
      const wool = getEnhancedFabricById('wool-crepe'); // molding 1.35
      const silk = getEnhancedFabricById('silk-charmeuse'); // molding 0.70

      const woolSleeve = calculateFabricAdaptedSleeveCapEase('tailored', wool);
      const silkSleeve = calculateFabricAdaptedSleeveCapEase('tailored', silk);

      assert.ok(woolSleeve.adaptedCapEaseCm > silkSleeve.adaptedCapEaseCm);
      assert.ok(woolSleeve.crimpCapacityDescription.includes('wool crimp'));
      assert.ok(silkSleeve.crimpCapacityDescription.includes('Low moldability'));
    });

    it('11. compiles complete garment ease across all circumferences for standard body', () => {
      const baseMeasurements = STANDARD_SIZING_SYSTEM.sizes.M;
      const wool = getEnhancedFabricById('wool-crepe');

      const completeEase = calculateCompleteGarmentEase(baseMeasurements, 'classic', wool);
      assert.ok(completeEase.bust.totalAppliedEaseCm > 0);
      assert.ok(completeEase.waist.totalAppliedEaseCm > 0);
      assert.ok(completeEase.lowHip.totalAppliedEaseCm > 0);
    });
  });
});
