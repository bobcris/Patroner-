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

describe('Milestone 04.5.1: Fabric Physics, Provenance & Ease Integrity Audit', () => {
  describe('1. Fabric Property Validation & Unverified Illustrative Preset Library', () => {
    it('1. verifies all illustrative preset fabrics pass physical validation and are unverified project references', () => {
      assert.ok(ENHANCED_PRESET_FABRICS.length >= 5);
      for (const fabric of ENHANCED_PRESET_FABRICS) {
        const val = validateFabricProperties(fabric);
        assert.equal(val.isValid, true, `Fabric '${fabric.name}' must be physically valid: ${val.errors.join('; ')}`);
        assert.ok(fabric.gsm > 0);
        assert.ok(fabric.thicknessMm > 0);
        assert.ok(fabric.directional.warp.shrinkagePercent >= 0);
        assert.ok(fabric.directional.weft.shrinkagePercent >= 0);
        assert.ok(fabric.moldingFactor >= 0.5 && fabric.moldingFactor <= 1.8);

        // Milestone 04.5.1 Audit: no false laboratory verification claims
        assert.equal(fabric.isVerified, false, 'Presets must not claim verified laboratory status without evidence');
        assert.equal(fabric.provenance, 'project-default', 'Presets must be classified as project-default references');
        assert.equal(fabric.isIllustrativeReference, true);
        assert.ok(fabric.propertyProvenance, 'Property-level provenance must exist');
        assert.equal(fabric.propertyProvenance?.gsm?.sourceType, 'project-default');
        assert.equal(fabric.propertyProvenance?.gsm?.verificationStatus, 'unverified');
      }
    });

    it('2. rejects fabric with negative, zero, or non-numeric GSM and NaN/Infinity values', () => {
      const invalidGsm: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        id: 'test-invalid-gsm',
        gsm: -150
      };
      const val = validateFabricProperties(invalidGsm);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('GSM') && e.includes('strictly positive')));

      const nanGsm: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        id: 'test-nan-gsm',
        gsm: NaN
      };
      assert.equal(validateFabricProperties(nanGsm).isValid, false);

      const infThickness: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        id: 'test-inf-thickness',
        thicknessMm: Infinity
      };
      assert.equal(validateFabricProperties(infThickness).isValid, false);
    });

    it('3. rejects fabric with negative shrinkage or extreme shrinkage (> 25%)', () => {
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
          warp: { shrinkagePercent: 28.5, stretchPercent: 2.0 }
        }
      };
      const val2 = validateFabricProperties(extremeShrink);
      assert.equal(val2.isValid, false);
      assert.ok(val2.errors.some(e => e.includes('exceeds physical limit')));
    });

    it('4. rejects laboratory claims without test standard evidence or verified project defaults', () => {
      const falseLabClaim: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        id: 'test-false-lab',
        provenance: 'laboratory-tested',
        testStandard: undefined
      };
      const val1 = validateFabricProperties(falseLabClaim);
      assert.equal(val1.isValid, false);
      assert.ok(val1.errors.some(e => e.includes('claims laboratory-tested provenance without supporting test evidence')));

      const verifiedDefaultClaim: any = {
        ...ENHANCED_PRESET_FABRICS[0],
        id: 'test-verified-default',
        provenance: 'project-default',
        isVerified: true
      };
      const val2 = validateFabricProperties(verifiedDefaultClaim);
      assert.equal(val2.isValid, false);
      assert.ok(val2.errors.some(e => e.includes('project default reference cannot be marked as verified laboratory data')));
    });

    it('5. strictly returns not-found for unknown or missing fabric IDs without silent fallback', () => {
      const missing = getEnhancedFabricById();
      assert.equal(missing.status, 'not-found');
      assert.ok(missing.message.includes('not specified'));

      const unknown = getEnhancedFabricById('unknown-fantasy-textile');
      assert.equal(unknown.status, 'not-found');
      assert.ok(unknown.message.includes('was not found'));

      const found = getEnhancedFabricById('wool-crepe');
      assert.equal(found.status, 'found');
      if (found.status === 'found') {
        assert.equal(found.fabric.id, 'wool-crepe');
        assert.equal(found.fabric.gsm, 320);
      }
    });
  });

  describe('2. Deterministic Fabric-Aware Ease Calculations & Dimension Separation', () => {
    it('6. separates finished garment dimension from pre-shrink cutting dimension (shrinkage NOT added to finished ease)', () => {
      const linenLookup = getEnhancedFabricById('linen-heavy');
      assert.equal(linenLookup.status, 'found');
      if (linenLookup.status !== 'found') return;

      const linen = linenLookup.fabric;
      const waistBody = 72.0;

      const waistEase = calculateFabricAwareCircumferenceEase('waist', waistBody, 'classic', linen, {
        allowanceForShrinkage: true,
        measurementDirection: 'circumference-crossgrain'
      });

      // Baseline classic waist ease = 4.0 cm (from EASE_TABLE.classic.waist)
      assert.equal(waistEase.bodyMeasurementCm, 72.0);
      assert.equal(waistEase.baselineMovementEaseCm, 4.0);

      // Finished garment dimension = Body + Net Finished Ease (EXCLUDES SHRINKAGE)
      assert.equal(waistEase.finishedGarmentDimensionCm, Number((72.0 + waistEase.totalAppliedEaseCm).toFixed(2)));

      // Pre-shrink cutting dimension includes shrinkage compensation
      assert.ok(waistEase.shrinkageCompensationCm > 2.0);
      assert.equal(
        waistEase.preShrinkCuttingDimensionCm,
        Number((waistEase.finishedGarmentDimensionCm + waistEase.shrinkageCompensationCm).toFixed(2))
      );
      assert.ok(waistEase.preShrinkCuttingDimensionCm > waistEase.finishedGarmentDimensionCm);
    });

    it('7. applies directional shrinkage according to measurement direction (crossgrain vs grainline)', () => {
      const denimLookup = getEnhancedFabricById('selvedge-denim');
      assert.equal(denimLookup.status, 'found');
      if (denimLookup.status !== 'found') return;

      const denim = denimLookup.fabric; // warp shrinkage = 5%, weft shrinkage = 2.5%
      const lengthDim = 60.0;

      // Circumference (crossgrain) uses weft shrinkage (2.5%)
      const crossEase = calculateFabricAwareCircumferenceEase('waist', lengthDim, 'classic', denim, {
        allowanceForShrinkage: true,
        measurementDirection: 'circumference-crossgrain'
      });

      // Length (grainline) uses warp shrinkage (5.0%)
      const lengthEase = calculateFabricAwareCircumferenceEase('waist', lengthDim, 'classic', denim, {
        allowanceForShrinkage: true,
        measurementDirection: 'length-grainline'
      });

      assert.equal(crossEase.shrinkageRatio, 0.025);
      assert.equal(lengthEase.shrinkageRatio, 0.05);
      assert.ok(lengthEase.shrinkageCompensationCm > crossEase.shrinkageCompensationCm);
    });

    it('8. applies stretch deduction only when negative ease policy allows it', () => {
      const ponteLookup = getEnhancedFabricById('ponte-roma'); // 25% weft stretch
      assert.equal(ponteLookup.status, 'found');
      if (ponteLookup.status !== 'found') return;

      const ponte = ponteLookup.fabric;
      const waistBody = 72.0;

      // With negative ease allowed
      const withNegative = calculateFabricAwareCircumferenceEase('waist', waistBody, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        negativeEasePolicyAllowed: true
      });
      assert.ok(withNegative.stretchDeductionCm > 0.5);

      // With negative ease explicitly disallowed
      const withoutNegative = calculateFabricAwareCircumferenceEase('waist', waistBody, 'classic', ponte, {
        measurementDirection: 'circumference-crossgrain',
        negativeEasePolicyAllowed: false
      });
      assert.equal(withoutNegative.stretchDeductionCm, 0.0);
    });

    it('9. does not silently fabricate material defaults when fabric is missing without explicit consent', () => {
      const noConsent = calculateFabricAwareCircumferenceEase('bust', 90.0, 'classic', undefined, {
        measurementDirection: 'circumference-crossgrain',
        userExplicitConsentToDefaultFabric: false
      });
      assert.equal(noConsent.isCalculationAvailable, false);
      assert.ok(noConsent.provenanceNotes.some(n => n.includes('missing') || n.includes('Explicit fabric selection required')));

      // With explicit consent, calculation is available with clear warning
      const withConsent = calculateFabricAwareCircumferenceEase('bust', 90.0, 'classic', undefined, {
        measurementDirection: 'circumference-crossgrain',
        userExplicitConsentToDefaultFabric: true
      });
      assert.equal(withConsent.isCalculationAvailable, true);
      assert.ok(withConsent.provenanceNotes.some(n => n.includes('unverified illustrative project default')));
    });

    it('10. adapts sleeve cap ease based on fabric molding factor with provisional disclosure', () => {
      const woolLookup = getEnhancedFabricById('wool-crepe');
      const silkLookup = getEnhancedFabricById('silk-charmeuse');
      assert.equal(woolLookup.status, 'found');
      assert.equal(silkLookup.status, 'found');
      if (woolLookup.status !== 'found' || silkLookup.status !== 'found') return;

      const woolSleeve = calculateFabricAdaptedSleeveCapEase('tailored', woolLookup.fabric);
      const silkSleeve = calculateFabricAdaptedSleeveCapEase('tailored', silkLookup.fabric);

      assert.ok(woolSleeve.adaptedCapEaseCm > silkSleeve.adaptedCapEaseCm);
      assert.ok(woolSleeve.notes.some(n => n.includes('provisional project formula')));
    });

    it('11. compiles complete garment ease across all circumferences for standard body', () => {
      const baseMeasurements = STANDARD_SIZING_SYSTEM.sizes.M;
      const woolLookup = getEnhancedFabricById('wool-crepe');
      assert.equal(woolLookup.status, 'found');
      if (woolLookup.status !== 'found') return;

      const completeEase = calculateCompleteGarmentEase(baseMeasurements, 'classic', woolLookup.fabric, {
        allowanceForShrinkage: true
      });
      assert.ok(completeEase.bust.totalAppliedEaseCm > 0);
      assert.ok(completeEase.waist.totalAppliedEaseCm > 0);
      assert.ok(completeEase.lowHip.totalAppliedEaseCm > 0);
      assert.ok(completeEase.bust.preShrinkCuttingDimensionCm > completeEase.bust.finishedGarmentDimensionCm);
    });
  });
});

