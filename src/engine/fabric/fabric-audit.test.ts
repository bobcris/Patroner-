/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateFabricProperties } from './fabric-validator';
import {
  ENHANCED_PRESET_FABRICS,
  getEnhancedFabricById,
  resolveFabricWithExplicitConsent,
  DEFAULT_ILLUSTRATIVE_FABRIC
} from './fabric-presets';
import {
  calculateCompleteGarmentEase,
  calculateFabricAdaptedSleeveCapEase,
  calculateFabricAwareCircumferenceEase,
  isValidIso8601Date,
  normalizeIsoDateToUtcEpoch,
  registerCustomGarmentCategoryCompatibility,
  resetCustomGarmentCategoryRegistry,
  getAllSupportedGarmentCategories,
  validateNegativeEaseAuthorizationPolicy,
  evaluateAuditEvidenceTrust,
  validateProvisionalRecoveryPolicy,
  validateProvisionalBiasShrinkagePolicy,
  CATEGORY_FIT_INTENT_COMPATIBILITY,
  DEFAULT_CATEGORY_FIT_INTENT_COMPATIBILITY,
  RECOGNIZED_FIT_INTENTS,
  isRecognizedFitIntent
} from './ease-engine';
import {
  MultiCategoryAuditEvidence,
  NegativeEaseAuthorizationPolicy,
  ProvisionalRecoveryPolicy,
  ProvisionalBiasShrinkagePolicy,
  AuditEvidenceTrustClassification
} from './fabric-types';
import { validatePhysicalFit } from '../prototype/fit-validator';
import {
  SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
  SYNTHETIC_TEST_PROTOTYPE_DISCREPANT,
  SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE
} from '../prototype/prototype-fixtures';
import { PhysicalPrototypeRecord } from '../prototype/prototype-types';

describe('Milestone 04.5.1: Independent Textile Physics, Provenance & Evidence Integrity Audit', () => {
  describe('A. Fabric Provenance & Validation Safeguards', () => {
    it('audit-F1: verifies no preset fabric claims verified laboratory testing without evidence', () => {
      for (const preset of ENHANCED_PRESET_FABRICS) {
        assert.equal(preset.isVerified, false, `Preset ${preset.id} must be marked unverified`);
        assert.equal(preset.provenance, 'project-default', `Preset ${preset.id} must be project-default`);
        assert.equal(preset.isIllustrativeReference, true);
        assert.equal(preset.testStandard, undefined, 'Presets must not declare uncertified test standards');
        assert.ok(preset.propertyProvenance, 'Property provenance must be defined');
        assert.equal(preset.propertyProvenance?.gsm?.sourceType, 'project-default');
        assert.equal(preset.propertyProvenance?.gsm?.verificationStatus, 'unverified');
      }
    });

    it('audit-F2: rejects empty, missing, or unknown fabric IDs with explicit not-found status', () => {
      const emptyLookup = getEnhancedFabricById('');
      assert.equal(emptyLookup.status, 'not-found');
      assert.ok(emptyLookup.message.includes('not specified'));

      const unknownLookup = getEnhancedFabricById('non-existent-synthetic-chiffon');
      assert.equal(unknownLookup.status, 'not-found');
      assert.ok(unknownLookup.message.includes('was not found'));

      // Verify no silent substitution of wool crepe!
      assert.equal(unknownLookup.status, 'not-found');
      assert.ok(!('fabric' in unknownLookup));
    });

    it('audit-F3: requires explicit user choice before resolving to project default illustrative fabric', () => {
      // Without consent -> returns not-found
      const withoutConsent = resolveFabricWithExplicitConsent('unknown-id', false);
      assert.equal(withoutConsent.status, 'not-found');

      // With explicit consent -> returns found with project default
      const withConsent = resolveFabricWithExplicitConsent('unknown-id', true);
      assert.equal(withConsent.status, 'found');
      if (withConsent.status === 'found') {
        assert.equal(withConsent.fabric.id, DEFAULT_ILLUSTRATIVE_FABRIC.id);
        assert.equal(withConsent.fabric.isIllustrativeReference, true);
      }
    });

    it('audit-F4: rejects non-finite, NaN, and Infinity values across all physical properties', () => {
      const base = ENHANCED_PRESET_FABRICS[0];

      // NaN GSM
      assert.equal(validateFabricProperties({ ...base, gsm: NaN }).isValid, false);
      // Infinity GSM
      assert.equal(validateFabricProperties({ ...base, gsm: Infinity }).isValid, false);
      // Negative GSM
      assert.equal(validateFabricProperties({ ...base, gsm: -50 }).isValid, false);
      // Zero GSM
      assert.equal(validateFabricProperties({ ...base, gsm: 0 }).isValid, false);

      // Non-finite thickness
      assert.equal(validateFabricProperties({ ...base, thicknessMm: NaN }).isValid, false);
      assert.equal(validateFabricProperties({ ...base, thicknessMm: -0.5 }).isValid, false);

      // Non-finite molding factor
      assert.equal(validateFabricProperties({ ...base, moldingFactor: NaN }).isValid, false);
      assert.equal(validateFabricProperties({ ...base, moldingFactor: 0.1 }).isValid, false);
      assert.equal(validateFabricProperties({ ...base, moldingFactor: 2.5 }).isValid, false);
    });

    it('audit-F5: rejects missing directional warp, weft, or bias properties', () => {
      const base = ENHANCED_PRESET_FABRICS[0];

      const missingWarp: any = { ...base, directional: { weft: base.directional.weft, bias: base.directional.bias } };
      assert.equal(validateFabricProperties(missingWarp).isValid, false);

      const missingWeft: any = { ...base, directional: { warp: base.directional.warp, bias: base.directional.bias } };
      assert.equal(validateFabricProperties(missingWeft).isValid, false);

      const missingBias: any = { ...base, directional: { warp: base.directional.warp, weft: base.directional.weft } };
      assert.equal(validateFabricProperties(missingBias).isValid, false);
    });

    it('audit-F6: rejects fraudulent laboratory provenance without test standard or verified project defaults', () => {
      const base = ENHANCED_PRESET_FABRICS[0];

      const fraudLab: any = { ...base, provenance: 'laboratory-tested', testStandard: undefined };
      const val1 = validateFabricProperties(fraudLab);
      assert.equal(val1.isValid, false);
      assert.ok(val1.errors.some(e => e.includes('claims laboratory-tested provenance without supporting test evidence')));

      const fraudDefault: any = { ...base, provenance: 'project-default', isVerified: true };
      const val2 = validateFabricProperties(fraudDefault);
      assert.equal(val2.isValid, false);
      assert.ok(val2.errors.some(e => e.includes('project default reference cannot be marked as verified laboratory data')));
    });

    it('audit-F7: validates property-level provenance source types and verification statuses', () => {
      const base = ENHANCED_PRESET_FABRICS[0];

      const invalidPropertySource: any = {
        ...base,
        propertyProvenance: {
          gsm: {
            value: 300,
            unit: 'g/m²',
            sourceType: 'unsupported-bogus-source',
            verificationStatus: 'unverified'
          }
        }
      };
      const val = validateFabricProperties(invalidPropertySource);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('invalid source type')));
    });
  });

  describe('B. Deterministic Ease Engine & Dimension Traceability', () => {
    it('audit-E1: guarantees shrinkage compensation is NOT included in finished garment dimension', () => {
      const linenLookup = getEnhancedFabricById('linen-heavy');
      assert.equal(linenLookup.status, 'found');
      if (linenLookup.status !== 'found') return;

      const linen = linenLookup.fabric;
      const waistBody = 72.0;

      const result = calculateFabricAwareCircumferenceEase('waist', waistBody, 'classic', linen, {
        allowanceForShrinkage: true,
        measurementDirection: 'circumference-crossgrain'
      });

      // Finished garment dimension MUST EQUAL Body + Net Ease (excluding shrinkage)
      assert.ok(result.isCalculationAvailable);
      assert.equal(result.finishedGarmentDimensionCm, Number((waistBody + result.totalAppliedEaseCm!).toFixed(2)));

      // Pre-shrink cutting dimension MUST be larger than finished dimension when shrinkage > 0
      assert.ok(result.preShrinkCuttingDimensionCm! > result.finishedGarmentDimensionCm!);
      assert.equal(
        result.preShrinkCuttingDimensionCm,
        Number((result.finishedGarmentDimensionCm! + result.shrinkageCompensationCm!).toFixed(2))
      );
    });

    it('audit-E2: applies Pre-shrink = Finished / (1 - shrinkage ratio) strictly to cutting pattern', () => {
      const denimLookup = getEnhancedFabricById('selvedge-denim');
      assert.equal(denimLookup.status, 'found');
      if (denimLookup.status !== 'found') return;

      const denim = denimLookup.fabric; // weft shrinkage = 2.5%
      const bodyBust = 90.0;

      const result = calculateFabricAwareCircumferenceEase('bust', bodyBust, 'classic', denim, {
        allowanceForShrinkage: true,
        measurementDirection: 'circumference-crossgrain'
      });

      const r = 2.5 / 100;
      assert.ok(result.isCalculationAvailable);
      const expectedCut = Number((result.finishedGarmentDimensionCm! / (1 - r)).toFixed(2));
      assert.equal(result.preShrinkCuttingDimensionCm, expectedCut);
      assert.equal(result.cuttingAllowanceFactor, Number((1 / (1 - r)).toFixed(4)));
    });

    it('audit-E3: respects directional orientation (warp vs weft) for shrinkage and stretch', () => {
      const denimLookup = getEnhancedFabricById('selvedge-denim');
      assert.equal(denimLookup.status, 'found');
      if (denimLookup.status !== 'found') return;

      const denim = denimLookup.fabric; // warp = 5.0%, weft = 2.5%

      const weftCalc = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', denim, {
        allowanceForShrinkage: true,
        measurementDirection: 'circumference-crossgrain'
      });
      const warpCalc = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', denim, {
        allowanceForShrinkage: true,
        measurementDirection: 'length-grainline'
      });

      assert.equal(weftCalc.shrinkageRatio, 0.025);
      assert.equal(warpCalc.shrinkageRatio, 0.05);
      assert.ok(warpCalc.shrinkageCompensationCm > weftCalc.shrinkageCompensationCm);
    });

    it('audit-E4: does NOT silently fallback to wool crepe when material is missing without explicit consent', () => {
      const calcWithoutConsent = calculateFabricAwareCircumferenceEase('bust', 90.0, 'classic', undefined, {
        measurementDirection: 'circumference-crossgrain',
        userExplicitConsentToDefaultFabric: false
      });
      assert.equal(calcWithoutConsent.isCalculationAvailable, false);
      assert.ok(calcWithoutConsent.provenanceNotes.some(n => n.includes('Explicit fabric selection required')));
    });

    it('audit-E5: accounts for elastic recovery and negative ease policy in stretch deductions', () => {
      const ponteLookup = getEnhancedFabricById('ponte-roma'); // 25% weft stretch, 88% recovery
      assert.equal(ponteLookup.status, 'found');
      if (ponteLookup.status !== 'found') return;

      const ponte = ponteLookup.fabric;

      // When negative ease is disallowed (no policy)
      const disallowNeg = calculateFabricAwareCircumferenceEase('bust', 90.0, 'classic', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice'
      });
      assert.equal(disallowNeg.stretchDeductionCm, 0.0);

      // When negative ease is authorized via valid policy
      const allowNeg = calculateFabricAwareCircumferenceEase('bust', 90.0, 'classic', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: {
          isAuthorized: true,
          garmentCategory: 'bodice',
          fitIntent: 'stretch-contour',
          maxPermittedNegativeEasePercent: 5.0,
          minimumRequiredStretchPercent: 5.0,
          minimumRequiredRecoveryPercent: 70.0,
          authorizedBy: 'Lead Pattern Engineer',
          sourceAndProvenance: 'Spec Standard DOC-EASE-04',
          authorizationDate: '2026-01-15T00:00:00.000Z'
        }
      });
      assert.ok((allowNeg.stretchDeductionCm ?? 0) > 0.5);
    });

    it('audit-E6: exposes inputs, formulas, assumptions, units, provenance, and limitations in breakdown', () => {
      const woolLookup = getEnhancedFabricById('wool-crepe');
      assert.equal(woolLookup.status, 'found');
      if (woolLookup.status !== 'found') return;

      const result = calculateFabricAwareCircumferenceEase('bust', 90.0, 'classic', woolLookup.fabric, {
        measurementDirection: 'circumference-crossgrain'
      });
      assert.ok(result.provenanceNotes.length > 0);
      assert.ok(result.limitations.length > 0);
      assert.ok(result.limitations.some(l => l.includes('provisional project model')));
    });
  });

  describe('C. Physical Prototype Evidence & Status Integrity', () => {
    it('audit-P1: returns incomplete for empty measurement records (never conforming)', () => {
      const emptyReport = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE);
      assert.equal(emptyReport.overallFitStatus, 'incomplete');
      assert.equal(emptyReport.evaluatedPointsCount, 0);
      assert.equal(emptyReport.isSyntheticEvidence, true);
      assert.equal(emptyReport.isProductionReady, false);
    });

    it('audit-P2: returns incomplete when required anatomical measurement points are missing', () => {
      const partialProto: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-PARTIAL-REQ',
        measurements: SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements.filter(
          p => p.pointId !== 'bust-circumference'
        )
      };

      const report = validatePhysicalFit(partialProto);
      assert.equal(report.overallFitStatus, 'incomplete');
      assert.ok(report.missingRequiredPoints.includes('bust-circumference'));
    });

    it('audit-P3: detects and rejects non-finite, negative, or zero dimensions and negative tolerances', () => {
      const corruptedProto: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-CORRUPTED',
        measurements: [
          ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements.slice(0, 5),
          {
            pointId: 'bust-circumference',
            label: 'Negative Bust',
            category: 'circumference',
            nominalCadCm: 95.5,
            measuredPhysicalCm: -95.0,
            toleranceCm: 0.40,
            deltaCm: 0,
            status: 'pass',
            sourceType: 'physically-measured'
          }
        ]
      };

      const report = validatePhysicalFit(corruptedProto);
      assert.equal(report.overallFitStatus, 'incomplete');
      assert.ok(report.invalidCount >= 1);
    });

    it('audit-P4: detects paired seam imbalance using configurable policy', () => {
      const mismatchedProto: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-SEAM-MISMATCH',
        measurements: SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements.map(pt => {
          if (pt.pointId === 'front-side-seam') return { ...pt, measuredPhysicalCm: 19.90 };
          if (pt.pointId === 'back-side-seam') return { ...pt, measuredPhysicalCm: 19.45 };
          return pt;
        })
      };

      // 19.90 - 19.45 = 0.45 cm (> 0.30 cm policy limit)
      const report = validatePhysicalFit(mismatchedProto, {
        sideSeamToleranceCm: 0.30,
        shoulderSeamToleranceCm: 0.25,
        inseamToleranceCm: 0.30
      });

      assert.equal(report.overallFitStatus, 'non-conforming');
      assert.ok(report.actionableCadCorrections.some(c => c.includes('Physical side seam mismatch')));
    });

    it('audit-P5: enforces strict status transitions: conforming -> acceptable -> non-conforming -> incomplete', () => {
      // Conforming
      const repConforming = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_CONFORMING);
      assert.equal(repConforming.overallFitStatus, 'conforming');

      // Non-conforming
      const repDiscrepant = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_DISCREPANT);
      assert.equal(repDiscrepant.overallFitStatus, 'non-conforming');

      // Incomplete
      const repIncomplete = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE);
      assert.equal(repIncomplete.overallFitStatus, 'incomplete');
    });

    it('audit-P6: strictly enforces isProductionReady = false invariant across all outputs', () => {
      assert.equal(SYNTHETIC_TEST_PROTOTYPE_CONFORMING.isProductionReady, false);
      assert.equal(SYNTHETIC_TEST_PROTOTYPE_DISCREPANT.isProductionReady, false);
      assert.equal(SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE.isProductionReady, false);

      const report = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_CONFORMING);
      assert.equal(report.isProductionReady, false);
    });
  });

  describe('D. Milestone 04.5.2: Assumption Control, Negative Ease Opt-In & Physical Completeness', () => {
    const ponteLookup = getEnhancedFabricById('ponte-roma');
    const ponte = ponteLookup.status === 'found' ? ponteLookup.fabric : undefined;

    it('audit-M452-1: missing elastic recovery data cannot silently generate a stretch deduction (no 80% default)', () => {
      assert.ok(ponte);
      // Construct a stretch fabric with missing recovery
      const fabricNoRecovery = {
        ...ponte,
        directional: {
          ...ponte.directional,
          weft: {
            shrinkagePercent: 2.0,
            stretchPercent: 20.0,
            elasticRecoveryPercent: undefined // Explicitly missing
          }
        }
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', fabricNoRecovery, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice'
      });

      // Milestone 04.5.3: Missing recovery data must return an unavailable result without usable dimensions
      assert.equal(result.isCalculationAvailable, false);
      assert.equal(result.status, 'unavailable');
      assert.equal(result.finishedGarmentDimensionCm, undefined);
      assert.equal(result.preShrinkCuttingDimensionCm, undefined);
      assert.ok(
        result.provenanceNotes.some(n => n.includes('recovery data missing') || n.includes('Measured recovery or complete user-approved provisional policy required'))
      );
    });

    it('audit-M452-2: explicit user-approved provisional recovery policy generates provisional calculation state', () => {
      assert.ok(ponte);
      const fabricNoRecovery = {
        ...ponte,
        directional: {
          ...ponte.directional,
          weft: {
            shrinkagePercent: 2.0,
            stretchPercent: 20.0,
            elasticRecoveryPercent: undefined
          }
        }
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', fabricNoRecovery, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: {
          isAuthorized: true,
          garmentCategory: 'bodice',
          fitIntent: 'compression-fit',
          maxPermittedNegativeEasePercent: 5.0,
          minimumRequiredStretchPercent: 5.0,
          minimumRequiredRecoveryPercent: 70.0,
          authorizedBy: 'Lead Pattern Engineer',
          sourceAndProvenance: 'Spec Standard DOC-EASE-04',
          authorizationDate: '2026-01-15T00:00:00.000Z'
        },
        provisionalRecoveryPolicy: {
          allowProvisionalRecovery: true,
          provisionalRecoveryPercent: 75,
          userApproved: true,
          reason: 'Bench trial elongation estimate',
          approvedBy: 'Pattern Lead',
          approvalDate: '2026-01-15T00:00:00.000Z'
        }
      });

      assert.equal(result.isCalculationAvailable, true);
      assert.equal(result.status, 'available');
      assert.ok((result.stretchDeductionCm ?? 0) > 0);
      assert.equal(result.isProvisionalCalculation, true);
      assert.ok(result.provisionalReason?.includes('Bench trial elongation estimate'));
      assert.ok(result.inputProvenanceSummary?.explicitUserAssumptions.some(a => a.includes('Provisional recovery')));
    });

    it('audit-M452-3: negative ease is disabled by default even for high-stretch fabrics and fitted profile', () => {
      assert.ok(ponte);
      // High stretch fabric, fitted profile, but NO explicit negative ease policy provided
      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain'
      });

      // Stretch deduction cannot reduce totalAppliedEaseCm below 0 when negative ease is disabled
      assert.ok(result.isCalculationAvailable);
      assert.ok(result.totalAppliedEaseCm! >= 0);
      assert.equal(result.stretchDeductionCm, 0.0);
      assert.equal(result.negativeEasePolicyApplied, undefined);
    });

    it('audit-M452-4: explicitly authorized negative ease policy permits reduction with full provenance tracking', () => {
      assert.ok(ponte);
      const authorizedPolicy = {
        isAuthorized: true,
        garmentCategory: 'bodice',
        fitIntent: 'performance-knit',
        maxPermittedNegativeEasePercent: 8.0,
        maxPermittedNegativeEaseCm: 4.0,
        minimumRequiredStretchPercent: 15.0,
        minimumRequiredRecoveryPercent: 80.0,
        authorizedBy: 'Lead Patternmaker J. Doe',
        sourceAndProvenance: 'Spec Approval CAD-102',
        authorizationDate: '2026-11-06T00:00:00Z'
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: authorizedPolicy
      });

      assert.ok((result.stretchDeductionCm ?? 0) > 0.5);
      assert.equal(result.negativeEasePolicyApplied?.authorizedBy, 'Lead Patternmaker J. Doe');
      assert.ok(
        result.inputProvenanceSummary?.explicitUserAssumptions.some(a => a.includes('Negative ease authorized'))
      );
    });

    it('audit-M452-5: rejects negative-ease calculations that exceed maximum declared policy limit', () => {
      assert.ok(ponte);
      // Policy strictly limits negative ease to max -0.10 cm
      const restrictivePolicy = {
        isAuthorized: true,
        garmentCategory: 'bodice',
        fitIntent: 'stretch-contour',
        maxPermittedNegativeEasePercent: 1.0,
        maxPermittedNegativeEaseCm: 0.10, // Very tight limit (0.10 cm)
        minimumRequiredStretchPercent: 10.0,
        minimumRequiredRecoveryPercent: 70.0,
        authorizedBy: 'Lead Patternmaker J. Doe',
        sourceAndProvenance: 'Restricted Ease Policy',
        authorizationDate: '2026-11-06T00:00:00Z'
      };

      // Set base movement ease to 0.5 cm so stretch deduction drives net ease to ~ -1.5 cm
      const baseFabricWithHighStretch = {
        ...ponte,
        directional: {
          ...ponte.directional,
          weft: { shrinkagePercent: 2.0, stretchPercent: 35.0, elasticRecoveryPercent: 95 }
        }
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', baseFabricWithHighStretch, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: restrictivePolicy
      });

      // If negative ease exceeded limit, calculation must be rejected (isCalculationAvailable: false)
      assert.equal(result.isCalculationAvailable, false);
      assert.ok(result.unavailableReason?.includes('exceeds maximum authorized policy limit'));
    });

    it('audit-M452-6: rejects calculation with unavailable state when measurement direction is missing', () => {
      assert.ok(ponte);
      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'classic', ponte, {
        measurementDirection: undefined // Missing direction
      });

      assert.equal(result.isCalculationAvailable, false);
      assert.ok(result.unavailableReason?.includes('missing or ambiguous'));
      assert.ok(result.provenanceNotes.some(n => n.includes('Unconditional circumference-crossgrain fallback removed')));
    });

    it('audit-M452-7: rejects calculation with unavailable state when measurement direction is invalid', () => {
      assert.ok(ponte);
      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'classic', ponte, {
        measurementDirection: 'diagonal-unsupported' as unknown as import('./fabric-types').MeasurementDirection
      });

      assert.equal(result.isCalculationAvailable, false);
      assert.ok(result.unavailableReason?.includes('missing or ambiguous'));
    });

    it('audit-M452-8: selects correct directional shrinkage for crossgrain, grainline, and measured bias', () => {
      const denimLookup = getEnhancedFabricById('selvedge-denim');
      assert.equal(denimLookup.status, 'found');
      if (denimLookup.status !== 'found') return;
      const denim = denimLookup.fabric; // warp = 5.0%, weft = 2.5%

      const weft = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', denim, {
        allowanceForShrinkage: true,
        measurementDirection: 'circumference-crossgrain'
      });
      const warp = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', denim, {
        allowanceForShrinkage: true,
        measurementDirection: 'length-grainline'
      });

      assert.equal(weft.shrinkageRatio, 0.025);
      assert.equal(warp.shrinkageRatio, 0.05);

      // Fabric with measured bias shrinkage
      const denimWithBias = {
        ...denim,
        directional: {
          ...denim.directional,
          bias: {
            stretchPercent: 12.0,
            shrinkagePercent: 3.5,
            elasticRecoveryPercent: 75
          }
        }
      };

      const bias = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', denimWithBias, {
        allowanceForShrinkage: true,
        measurementDirection: 'bias'
      });

      assert.equal(bias.isCalculationAvailable, true);
      assert.equal(bias.shrinkageRatio, 0.035);
      assert.ok((warp.shrinkageCompensationCm ?? 0) > (bias.shrinkageCompensationCm ?? 0));
      assert.ok((bias.shrinkageCompensationCm ?? 0) > (weft.shrinkageCompensationCm ?? 0));
    });

    it('audit-M452-9: derives measurement direction from patternPieceOrientation', () => {
      assert.ok(ponte);
      const derivedCross = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', ponte, {
        patternPieceOrientation: 'crossgrain'
      });
      assert.equal(derivedCross.isCalculationAvailable, true);
      assert.equal(derivedCross.measurementDirection, 'circumference-crossgrain');

      const derivedGrain = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', ponte, {
        patternPieceOrientation: 'grainline'
      });
      assert.equal(derivedGrain.isCalculationAvailable, true);
      assert.equal(derivedGrain.measurementDirection, 'length-grainline');
    });

    it('audit-M452-10: returns unsupported-validation-scope for garment categories not in required registry', () => {
      const unsupportedProto: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-UNSUPPORTED-CAT',
        garmentCategory: 'trouser' as unknown as PhysicalPrototypeRecord['garmentCategory']
      };

      const report = validatePhysicalFit(unsupportedProto);
      assert.equal(report.overallFitStatus, 'unsupported-validation-scope');
      assert.ok(report.actionableCadCorrections.some(c => c.includes('Validation scope unsupported')));
    });

    it('audit-M452-11: detects and rejects duplicate measurement checkpoint IDs', () => {
      const duplicateProto: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-DUPLICATE-PTS',
        measurements: [
          ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements,
          // Duplicate entry for bust-circumference
          {
            pointId: 'bust-circumference',
            label: 'Duplicate Bust Circumference',
            category: 'circumference',
            nominalCadCm: 95.5,
            measuredPhysicalCm: 95.4,
            toleranceCm: 0.40,
            deltaCm: -0.10,
            status: 'pass',
            sourceType: 'physically-measured'
          }
        ]
      };

      const report = validatePhysicalFit(duplicateProto);
      assert.equal(report.overallFitStatus, 'incomplete');
      assert.ok(report.invalidCount >= 1);
      assert.ok(report.actionableCadCorrections.some(c => c.includes('Duplicate measurement point ID detected')));
    });

    it('audit-M452-12: returns incomplete when pattern draft revision or fabric revision is missing', () => {
      const missingDraftRev: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-MISSING-REV',
        patternDraftRevision: '' // Missing revision link
      };

      const reportDraft = validatePhysicalFit(missingDraftRev);
      assert.equal(reportDraft.overallFitStatus, 'incomplete');
      assert.ok(reportDraft.actionableCadCorrections.some(c => c.includes('Missing pattern draft revision reference')));

      const missingFabricRev: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-MISSING-FAB-REV',
        fabricRevision: '' // Missing fabric revision link
      };

      const reportFabric = validatePhysicalFit(missingFabricRev);
      assert.equal(reportFabric.overallFitStatus, 'incomplete');
      assert.ok(reportFabric.actionableCadCorrections.some(c => c.includes('Missing fabric revision reference')));
    });

    it('audit-M452-13: incomplete physical evidence cannot be declared conforming (e.g. estimated points for required checkpoints)', () => {
      const estimatedProto: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-ESTIMATED-CHECKPOINT',
        measurements: SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements.map(pt => {
          if (pt.pointId === 'waist-circumference') {
            return {
              ...pt,
              sourceType: 'estimated' // NOT physically-measured
            };
          }
          return pt;
        })
      };

      const report = validatePhysicalFit(estimatedProto);
      assert.equal(report.overallFitStatus, 'incomplete');
      assert.ok(report.missingRequiredPoints.includes('waist-circumference'));
    });

    it('audit-M452-14: distinguishes measured, supplier-declared, project-default, and estimated inputs in provenance summary', () => {
      assert.ok(ponte);
      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'classic', ponte, {
        measurementDirection: 'circumference-crossgrain'
      });

      assert.ok(result.inputProvenanceSummary);
      assert.ok(result.inputProvenanceSummary.projectDefaultInputs.length > 0);
      assert.ok(result.inputProvenanceSummary.calculatedOutputs.length > 0);
      assert.ok(result.inputProvenanceSummary.measuredInputs.some(i => i.includes('bodyMeasurementCm')));
    });
  });

  describe('Milestone 04.5.3: Published Fabric Engine Integrity Audit & Corrective Hardening', () => {
    const ponteLookup = getEnhancedFabricById('ponte-roma');
    const ponte = ponteLookup.status === 'found' ? ponteLookup.fabric : undefined;

    it('audit-M453-1: legacy boolean authorization bypass (negativeEasePolicyAllowed: true) is rejected and does not activate negative ease', () => {
      assert.ok(ponte);
      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicyAllowed: true // Legacy flag should be rejected
      });

      // Net ease must not be negative; stretch deduction must be 0
      assert.equal(result.stretchDeductionCm, 0.0);
      assert.equal(result.negativeEasePolicyApplied, undefined);
      assert.ok(result.provenanceNotes.some(n => n.includes("Legacy 'negativeEasePolicyAllowed' boolean is deprecated and rejected")));
    });

    it('audit-M453-2: missing target garment category rejects negative ease policy even if isAuthorized is true', () => {
      assert.ok(ponte);
      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        // garmentCategory omitted
        negativeEasePolicy: {
          isAuthorized: true,
          garmentCategory: 'bodice',
          fitIntent: 'compression-fit',
          maxPermittedNegativeEasePercent: 6.0,
          minimumRequiredStretchPercent: 10.0,
          minimumRequiredRecoveryPercent: 70.0,
          authorizedBy: 'Lead Engineer',
          sourceAndProvenance: 'Spec-101',
          authorizationDate: '2026-01-15T00:00:00.000Z'
        }
      });

      assert.equal(result.stretchDeductionCm, 0.0);
      assert.equal(result.negativeEasePolicyApplied, undefined);
      assert.ok(result.provenanceNotes.some(n => n.includes('Target garment category is missing. Missing category is a rejection, not a wildcard.')));
    });

    it('audit-M453-3: garment category mismatch between policy and options rejects negative ease', () => {
      assert.ok(ponte);
      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'skirt',
        negativeEasePolicy: {
          isAuthorized: true,
          garmentCategory: 'bodice', // Mismatch: bodice vs skirt
          fitIntent: 'compression-fit',
          maxPermittedNegativeEasePercent: 6.0,
          minimumRequiredStretchPercent: 10.0,
          minimumRequiredRecoveryPercent: 70.0,
          authorizedBy: 'Lead Engineer',
          sourceAndProvenance: 'Spec-101',
          authorizationDate: '2026-01-15T00:00:00.000Z'
        }
      });

      assert.equal(result.stretchDeductionCm, 0.0);
      assert.equal(result.negativeEasePolicyApplied, undefined);
      assert.ok(result.provenanceNotes.some(n => n.includes('does not match target garment category')));
    });

    it('audit-M453-4: invalid or incomplete authorization policies (missing author, source, or invalid ISO date) are rejected', () => {
      assert.ok(ponte);
      const invalidDatePolicy = {
        isAuthorized: true,
        garmentCategory: 'bodice',
        fitIntent: 'compression-fit',
        maxPermittedNegativeEasePercent: 6.0,
        minimumRequiredStretchPercent: 10.0,
        minimumRequiredRecoveryPercent: 70.0,
        authorizedBy: 'Lead Engineer',
        sourceAndProvenance: 'Spec-101',
        authorizationDate: 'invalid-not-a-date' // Malformed date
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: invalidDatePolicy as unknown as NegativeEaseAuthorizationPolicy
      });

      assert.equal(result.stretchDeductionCm, 0.0);
      assert.ok(result.provenanceNotes.some(n => n.includes('invalid authorizationDate')));

      // Missing authorizedBy
      const noAuthorPolicy = {
        ...invalidDatePolicy,
        authorizationDate: '2026-01-15T00:00:00.000Z',
        authorizedBy: '' // Empty author
      };
      const resultNoAuthor = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: noAuthorPolicy as unknown as NegativeEaseAuthorizationPolicy
      });
      assert.equal(resultNoAuthor.stretchDeductionCm, 0.0);
      assert.ok(resultNoAuthor.provenanceNotes.some(n => n.includes('missing non-empty authorizedBy identity')));
    });

    it('audit-M453-5: expired negative ease policy is rejected', () => {
      assert.ok(ponte);
      const expiredPolicy = {
        isAuthorized: true,
        garmentCategory: 'bodice',
        fitIntent: 'compression-fit',
        maxPermittedNegativeEasePercent: 6.0,
        minimumRequiredStretchPercent: 10.0,
        minimumRequiredRecoveryPercent: 70.0,
        authorizedBy: 'Lead Engineer',
        sourceAndProvenance: 'Spec-101',
        authorizationDate: '2020-01-15T00:00:00.000Z',
        expirationDate: '2021-01-15T00:00:00.000Z' // Clearly in the past
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: expiredPolicy
      });

      assert.equal(result.stretchDeductionCm, 0.0);
      assert.ok(result.provenanceNotes.some(n => n.includes('expired on')));
    });

    it('audit-M453-6: unrecognized fit intent or negative limits reject negative ease policy', () => {
      assert.ok(ponte);
      const badIntentPolicy = {
        isAuthorized: true,
        garmentCategory: 'bodice',
        fitIntent: 'casual-loose-baggy', // Not recognized
        maxPermittedNegativeEasePercent: 6.0,
        minimumRequiredStretchPercent: 10.0,
        minimumRequiredRecoveryPercent: 70.0,
        authorizedBy: 'Lead Engineer',
        sourceAndProvenance: 'Spec-101',
        authorizationDate: '2026-01-15T00:00:00.000Z'
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: badIntentPolicy as unknown as NegativeEaseAuthorizationPolicy
      });

      assert.equal(result.stretchDeductionCm, 0.0);
      assert.ok(result.provenanceNotes.some(n => n.includes('Unrecognized fitIntent')));
    });

    it('audit-M453-7: insufficient directional stretch or recovery evidence rejects negative ease policy', () => {
      assert.ok(ponte);
      const highReqPolicy = {
        isAuthorized: true,
        garmentCategory: 'bodice',
        fitIntent: 'compression-fit',
        maxPermittedNegativeEasePercent: 6.0,
        minimumRequiredStretchPercent: 80.0, // Ponte is only ~25% weft stretch
        minimumRequiredRecoveryPercent: 70.0,
        authorizedBy: 'Lead Engineer',
        sourceAndProvenance: 'Spec-101',
        authorizationDate: '2026-01-15T00:00:00.000Z'
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 72.0, 'fitted', ponte, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: highReqPolicy
      });

      assert.equal(result.stretchDeductionCm, 0.0);
      assert.ok(result.provenanceNotes.some(n => n.includes('does not satisfy policy minimum required stretch')));
    });

    it('audit-M453-8: conflicting measurementDirection and patternPieceOrientation returns unavailable result without crossgrain default', () => {
      assert.ok(ponte);
      const result = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', ponte, {
        measurementDirection: 'circumference-crossgrain',
        patternPieceOrientation: 'grainline' // Direct conflict: crossgrain vs grainline!
      });

      assert.equal(result.isCalculationAvailable, false);
      assert.equal(result.status, 'unavailable');
      assert.equal(result.measurementDirection, undefined); // Never substituted with crossgrain!
      assert.equal(result.finishedGarmentDimensionCm, undefined);
      assert.ok(result.unavailableReason?.includes('Conflicting directional inputs'));
    });

    it('audit-M453-9: bias shrinkage calculation without measured evidence or approved provisional policy returns unavailable result and never averages warp/weft', () => {
      const denimLookup = getEnhancedFabricById('selvedge-denim');
      assert.equal(denimLookup.status, 'found');
      if (denimLookup.status !== 'found') return;
      const denim = denimLookup.fabric;

      // Fabric has warp shrinkage (5%) and weft shrinkage (2.5%), and has bias recovery, but NO bias shrinkage evidence
      const denimWithBiasRecovery = {
        ...denim,
        directional: {
          ...denim.directional,
          bias: {
            ...denim.directional.bias,
            elasticRecoveryPercent: 70 // Has recovery, but NO bias shrinkage evidence
          }
        }
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', denimWithBiasRecovery, {
        measurementDirection: 'bias',
        allowanceForShrinkage: true
      });

      assert.equal(result.isCalculationAvailable, false);
      assert.equal(result.status, 'unavailable');
      assert.equal(result.finishedGarmentDimensionCm, undefined);
      assert.equal(result.preShrinkCuttingDimensionCm, undefined);
      assert.ok(result.unavailableReason?.includes('Warp and weft shrinkage averaging is prohibited'));
    });

    it('audit-M453-10: bias shrinkage calculation with approved provisional bias shrinkage policy succeeds with provisional flag', () => {
      const denimLookup = getEnhancedFabricById('selvedge-denim');
      assert.equal(denimLookup.status, 'found');
      if (denimLookup.status !== 'found') return;
      const denim = denimLookup.fabric;

      const denimWithBiasRecovery = {
        ...denim,
        directional: {
          ...denim.directional,
          bias: {
            ...denim.directional.bias,
            elasticRecoveryPercent: 70
          }
        }
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 70.0, 'classic', denimWithBiasRecovery, {
        measurementDirection: 'bias',
        allowanceForShrinkage: true,
        provisionalBiasShrinkagePolicy: {
          allowProvisional: true,
          userApproved: true,
          provisionalShrinkagePercent: 4.0,
          reason: 'Empirical bias swatch test estimate',
          approvedBy: 'Senior Textile Tech',
          approvalDate: '2026-01-15T00:00:00.000Z'
        }
      });

      assert.equal(result.isCalculationAvailable, true);
      assert.equal(result.status, 'available');
      assert.equal(result.shrinkageRatio, 0.04);
      assert.equal(result.isProvisionalCalculation, true);
      assert.ok(result.provisionalReason?.includes('Empirical bias swatch test estimate'));
    });

    it('audit-M453-11: unavailable result strictly exposes NO usable finished garment or cutting dimensions', () => {
      assert.ok(ponte);
      const unavailableResult = calculateFabricAwareCircumferenceEase('waist', 72.0, 'classic', ponte, {
        measurementDirection: undefined // Missing direction triggers unavailable
      });

      assert.equal(unavailableResult.isCalculationAvailable, false);
      assert.equal(unavailableResult.status, 'unavailable');
      assert.equal(unavailableResult.finishedGarmentDimensionCm, undefined);
      assert.equal(unavailableResult.preShrinkCuttingDimensionCm, undefined);
      assert.equal(unavailableResult.totalAppliedEaseCm, undefined);
      assert.equal(unavailableResult.shrinkageCompensationCm, undefined);
      assert.equal(unavailableResult.shrinkageRatio, undefined);
      assert.equal(unavailableResult.cuttingAllowanceFactor, undefined);
      assert.ok(typeof unavailableResult.unavailableReason === 'string');
    });

    it('audit-M453-12: duplicate measurement checkpoint IDs invalidates all occurrences and prevents checkpoint satisfaction', () => {
      const duplicateProto: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-DUPLICATE-ALL-INVALID',
        measurements: [
          ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements,
          // Duplicate entry for bust-circumference
          {
            pointId: 'bust-circumference',
            label: 'Duplicate Bust Circumference Second Entry',
            category: 'circumference',
            nominalCadCm: 95.5,
            measuredPhysicalCm: 95.5,
            toleranceCm: 0.40,
            deltaCm: 0.0,
            status: 'pass',
            sourceType: 'physically-measured'
          }
        ]
      };

      const report = validatePhysicalFit(duplicateProto);
      assert.equal(report.overallFitStatus, 'incomplete');
      assert.ok(report.missingRequiredPoints.includes('bust-circumference'));
      // Both instances of bust-circumference must be invalid
      const bustRecords = report.measurements.filter(m => m.pointId === 'bust-circumference');
      assert.equal(bustRecords.length, 2);
      assert.ok(bustRecords.every(r => r.status === 'invalid'));
    });

    it('audit-M453-13: empty or malformed garment registry schema cannot be bypassed and returns unsupported-validation-scope', () => {
      const malformedProto: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-MALFORMED-CAT',
        garmentCategory: '' as unknown as PhysicalPrototypeRecord['garmentCategory'] // Empty category
      };

      const report = validatePhysicalFit(malformedProto);
      assert.equal(report.overallFitStatus, 'unsupported-validation-scope');
      assert.ok(report.actionableCadCorrections.some(c => c.includes('Validation scope unsupported')));
    });

    it('audit-M453-14: calculated or estimated measurement records cannot satisfy physical validation checkpoints', () => {
      const calculatedProto: PhysicalPrototypeRecord = {
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
        id: 'SYNTH-CALCULATED-CHECKPOINT',
        measurements: SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements.map(pt => {
          if (pt.pointId === 'front-side-seam') {
            return {
              ...pt,
              sourceType: 'calculated' // Calculated dimension, NOT physically-measured
            };
          }
          return pt;
        })
      };

      const report = validatePhysicalFit(calculatedProto);
      assert.equal(report.overallFitStatus, 'incomplete');
      assert.ok(report.missingRequiredPoints.includes('front-side-seam'));
    });
  });

  describe('Milestone 04.5.3.1: Final Publication Reconciliation & Authorization Integrity Verification', () => {
    const validBodicePolicy: NegativeEaseAuthorizationPolicy = {
      isAuthorized: true,
      garmentCategory: 'bodice',
      fitIntent: 'bodycon',
      maxPermittedNegativeEasePercent: 5.0,
      maxPermittedNegativeEaseCm: 3.0,
      minimumRequiredStretchPercent: 15.0,
      minimumRequiredRecoveryPercent: 70.0,
      authorizedBy: 'Lead Pattern Engineer',
      sourceAndProvenance: 'Spec Standard PAT-0453-1',
      authorizationDate: '2026-11-01T09:00:00Z',
      expirationDate: '2027-11-01T09:00:00Z'
    };

    const ponteLookup = getEnhancedFabricById('ponte-roma');
    const ponteFabric = ponteLookup.status === 'found' ? ponteLookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;
    const highStretchFabric = {
      ...ponteFabric,
      directional: {
        ...ponteFabric.directional,
        weft: {
          shrinkagePercent: 1.0,
          stretchPercent: 35.0, // 35% stretch
          elasticRecoveryPercent: 90.0 // 90% recovery
        }
      }
    };

    it('audit-M4531-1: rejects negative ease policy when target garmentCategory is missing or empty', () => {
      const res1 = validateNegativeEaseAuthorizationPolicy(validBodicePolicy, undefined, 25, 80);
      assert.equal(res1.isValid, false);
      assert.ok(res1.rejectionReason?.includes('Target garment category is missing'));

      const res2 = validateNegativeEaseAuthorizationPolicy(validBodicePolicy, '', 25, 80);
      assert.equal(res2.isValid, false);
      assert.ok(res2.rejectionReason?.includes('Target garment category is missing'));

      const policyNoCat = { ...validBodicePolicy, garmentCategory: '' };
      const res3 = validateNegativeEaseAuthorizationPolicy(policyNoCat, 'bodice', 25, 80);
      assert.equal(res3.isValid, false);
      assert.ok(res3.rejectionReason?.includes('missing explicit garmentCategory'));
    });

    it('audit-M4531-2: rejects wildcard category "all" without a separately explicit, audited scope', () => {
      const bareWildcardPolicy: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        garmentCategory: 'all'
      };

      const res = validateNegativeEaseAuthorizationPolicy(bareWildcardPolicy, 'bodice', 25, 80);
      assert.equal(res.isValid, false);
      assert.ok(res.rejectionReason?.includes('Wildcard category "all" is prohibited without a separately explicit, audited scope'));
    });

    it('audit-M4531-3: accepts wildcard category "all" when explicit multiCategoryAuditScope and audit approval are provided', () => {
      const auditedWildcardPolicy: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        garmentCategory: 'all',
        multiCategoryAuditScope: 'Audited across multi-category stretch activewear collection (bodice, skirt, leggings)',
        isMultiCategoryAudited: true,
        multiCategoryAuditEvidence: {
          evidenceType: 'quality-management-audit',
          auditScope: 'Audited across multi-category stretch activewear collection (bodice, skirt, leggings)',
          auditedBy: 'QA Technical Board Lead',
          evidenceReference: 'QMA-2026-ACT-04',
          auditDate: '2026-11-01',
          authorizedCategories: ['bodice', 'skirt', 'leggings'],
          isIndependentlyVerified: true
        }
      };

      const res = validateNegativeEaseAuthorizationPolicy(auditedWildcardPolicy, 'bodice', 25, 80);
      assert.equal(res.isValid, true);
    });

    it('audit-M4531-4: rejects fit intent incompatible with garment category construction', () => {
      // Corsetry is not structurally compatible with standalone skirt or sleeve construction
      const corsetryOnSkirt: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        garmentCategory: 'skirt',
        fitIntent: 'corsetry'
      };

      const resSkirt = validateNegativeEaseAuthorizationPolicy(corsetryOnSkirt, 'skirt', 25, 80);
      assert.equal(resSkirt.isValid, false);
      assert.ok(resSkirt.rejectionReason?.includes('incompatible with garment category'));

      const corsetryOnSleeve: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        garmentCategory: 'sleeve',
        fitIntent: 'corsetry'
      };
      const resSleeve = validateNegativeEaseAuthorizationPolicy(corsetryOnSleeve, 'sleeve', 25, 80);
      assert.equal(resSleeve.isValid, false);
      assert.ok(resSleeve.rejectionReason?.includes('incompatible with garment category'));
    });

    it('audit-M4531-5: accepts recognized fit intents compatible with garment category construction', () => {
      const corsetryOnBodice: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        garmentCategory: 'bodice',
        fitIntent: 'corsetry'
      };
      const resBodice = validateNegativeEaseAuthorizationPolicy(corsetryOnBodice, 'bodice', 25, 80);
      assert.equal(resBodice.isValid, true);

      const stretchContourOnSkirt: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        garmentCategory: 'skirt',
        fitIntent: 'stretch-contour'
      };
      const resSkirt = validateNegativeEaseAuthorizationPolicy(stretchContourOnSkirt, 'skirt', 25, 80);
      assert.equal(resSkirt.isValid, true);
    });

    it('audit-M4531-6: strictly rejects non-ISO dates and non-existent calendar dates', () => {
      assert.equal(isValidIso8601Date(''), false);
      assert.equal(isValidIso8601Date('2026-02-31'), false, 'Feb 31 does not exist');
      assert.equal(isValidIso8601Date('2025-02-29'), false, '2025 is not a leap year');
      assert.equal(isValidIso8601Date('2026-04-31'), false, 'April has only 30 days');
      assert.equal(isValidIso8601Date('2026-13-01'), false, 'Month 13 does not exist');
      assert.equal(isValidIso8601Date('11/06/2026'), false, 'Slash format is not ISO 8601');
      assert.equal(isValidIso8601Date('Nov 6, 2026'), false, 'Word format is not ISO 8601');
      assert.equal(isValidIso8601Date('2026-11-06T25:00:00Z'), false, 'Hour 25 is invalid');

      // Test policy with invalid calendar authorizationDate
      const badDatePolicy: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        authorizationDate: '2026-02-31'
      };
      const res = validateNegativeEaseAuthorizationPolicy(badDatePolicy, 'bodice', 25, 80);
      assert.equal(res.isValid, false);
      assert.ok(res.rejectionReason?.includes('Must be a valid ISO 8601 calendar date'));
    });

    it('audit-M4531-7: accepts valid ISO 8601 calendar dates including leap years', () => {
      assert.equal(isValidIso8601Date('2024-02-29'), true, '2024 is a leap year');
      assert.equal(isValidIso8601Date('2026-11-06'), true);
      assert.equal(isValidIso8601Date('2026-11-06T12:00:00Z'), true);
      assert.equal(isValidIso8601Date('2026-11-06T12:00:00.000Z'), true);
      assert.equal(isValidIso8601Date('2026-11-06T12:00:00+02:00'), true);
    });

    it('audit-M4531-8: evaluates expiration deterministically using injectable evaluationDate immediately before, at, and after expiry', () => {
      const expiringPolicy: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        authorizationDate: '2026-10-01T00:00:00Z',
        expirationDate: '2026-11-06T12:00:00.000Z'
      };

      // 1. Immediately before expiry (1 second prior): VALID
      const beforeRes = validateNegativeEaseAuthorizationPolicy(
        expiringPolicy,
        'bodice',
        25,
        80,
        '2026-11-06T11:59:59.000Z'
      );
      assert.equal(beforeRes.isValid, true);

      // 2. Exactly at expiry: VALID (evalTime === expTime)
      const atRes = validateNegativeEaseAuthorizationPolicy(
        expiringPolicy,
        'bodice',
        25,
        80,
        '2026-11-06T12:00:00.000Z'
      );
      assert.equal(atRes.isValid, true);

      // 3. Immediately after expiry (1 second after): EXPIRED / REJECTED
      const afterRes = validateNegativeEaseAuthorizationPolicy(
        expiringPolicy,
        'bodice',
        25,
        80,
        '2026-11-06T12:00:01.000Z'
      );
      assert.equal(afterRes.isValid, false);
      assert.ok(afterRes.rejectionReason?.includes('expired on'));
    });

    it('audit-M4531-9: allows historical calculations to be reproduced deterministically with evaluation timestamp', () => {
      const historicalPolicy: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        authorizationDate: '2023-01-01T00:00:00Z',
        expirationDate: '2023-12-31T23:59:59Z'
      };

      // Today without timestamp: policy has expired
      const modernEval = validateNegativeEaseAuthorizationPolicy(historicalPolicy, 'bodice', 25, 80);
      assert.equal(modernEval.isValid, false);

      // Historical reproduction at time of drafting: VALID
      const historicalEval = validateNegativeEaseAuthorizationPolicy(
        historicalPolicy,
        'bodice',
        25,
        80,
        '2023-06-15T12:00:00Z'
      );
      assert.equal(historicalEval.isValid, true);
    });

    it('audit-M4531-10: produces valid negative-ease result when authorized where model and inputs support it', () => {
      // High stretch ponte: 35% weft stretch, 85% recovery
      // Body waist: 68cm, baseline ease: 2.0cm
      // Stretch ratio: (35 - 3) * 0.05 * 0.85 = 32 * 0.0425 = 1.36
      // Stretch deduction: 2.0 * 1.36 = 2.72 cm
      // Turn of cloth (0.9mm / 10 = 0.09cm): 2 * pi * 0.09 * 0.5 * 1 = 0.28 cm
      // Net ease: 2.0 + 0.0 + 0.28 - 2.72 = -0.44 cm (NEGATIVE EASE)
      // Finished dimension: 68.0 - 0.44 = 67.56 cm
      const result = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: {
          ...validBodicePolicy,
          maxPermittedNegativeEasePercent: 5.0,
          maxPermittedNegativeEaseCm: 2.0
        }
      });

      assert.equal(result.isCalculationAvailable, true);
      assert.equal(result.status, 'available');
      if (result.isCalculationAvailable) {
        assert.ok(result.totalAppliedEaseCm < 0, `Total applied ease must be negative (got ${result.totalAppliedEaseCm})`);
        assert.ok(result.finishedGarmentDimensionCm < result.bodyMeasurementCm, 'Finished garment must be smaller than body measurement');
        assert.equal(result.finishedGarmentDimensionCm, Number((68.0 + result.totalAppliedEaseCm).toFixed(2)));
        assert.ok(result.negativeEasePolicyApplied !== undefined);
      }
    });

    it('audit-M4531-11: independently enforces maxPermittedNegativeEaseCm limit', () => {
      // Calculated negative ease is ~0.64 cm.
      // If policy strictly restricts cm limit to 0.20 cm, it must be rejected!
      const restrictiveCmPolicy: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        maxPermittedNegativeEasePercent: 10.0, // generous percentage limit
        maxPermittedNegativeEaseCm: 0.20       // strict cm limit (exceeded by 0.64 cm)
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: restrictiveCmPolicy
      });

      assert.equal(result.isCalculationAvailable, false);
      assert.equal(result.status, 'unavailable');
      assert.ok(result.unavailableReason?.includes('exceeds maximum authorized policy limit'));
      assert.ok(result.unavailableReason?.includes('cm'));
    });

    it('audit-M4531-12: independently enforces maxPermittedNegativeEasePercent limit', () => {
      // Calculated negative ease is ~0.64 cm on 68cm waist = 0.94%.
      // If policy restricts percent to 0.30%, it must be rejected!
      const restrictivePctPolicy: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        maxPermittedNegativeEasePercent: 0.30, // strict percentage limit (exceeded by 0.94%)
        maxPermittedNegativeEaseCm: 5.0        // generous cm limit
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: restrictivePctPolicy
      });

      assert.equal(result.isCalculationAvailable, false);
      assert.equal(result.status, 'unavailable');
      assert.ok(result.unavailableReason?.includes('exceeds maximum authorized policy limit'));
      assert.ok(result.unavailableReason?.includes('%'));
    });

    it('audit-M4531-13: unauthorized or invalid policy never produces negative ease (clamped to zero)', () => {
      // Calculate without policy
      const resultNoPolicy = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice'
      });

      assert.equal(resultNoPolicy.isCalculationAvailable, true);
      if (resultNoPolicy.isCalculationAvailable) {
        assert.ok(resultNoPolicy.totalAppliedEaseCm >= 0, 'Without policy, net ease cannot be negative');
        assert.ok(resultNoPolicy.finishedGarmentDimensionCm >= resultNoPolicy.bodyMeasurementCm);
      }
    });

    it('audit-M4531-14: missing or inadequate recovery rejects negative ease policy activation', () => {
      const highThresholdPolicy: NegativeEaseAuthorizationPolicy = {
        ...validBodicePolicy,
        minimumRequiredRecoveryPercent: 95.0 // highStretchFabric has 90% recovery, below 95% threshold
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: highThresholdPolicy
      });

      // Policy is rejected -> negative ease cannot activate -> clamped to non-negative
      assert.equal(result.isCalculationAvailable, true);
      if (result.isCalculationAvailable) {
        assert.ok(result.totalAppliedEaseCm >= 0);
        assert.ok(result.provenanceNotes.some(n => n.includes('does not satisfy policy minimum required recovery')));
      }
    });

    it('audit-M4531-15: rejects non-finite, negative, or out-of-range stretch and recovery values', () => {
      const resNaN = validateNegativeEaseAuthorizationPolicy(validBodicePolicy, 'bodice', NaN, 80);
      assert.equal(resNaN.isValid, false);

      const resRecoveryOverflow = validateNegativeEaseAuthorizationPolicy(
        { ...validBodicePolicy, minimumRequiredRecoveryPercent: 120 },
        'bodice',
        25,
        80
      );
      assert.equal(resRecoveryOverflow.isValid, false);
      assert.ok(resRecoveryOverflow.rejectionReason?.includes('between 0 and 100'));
    });

    it('audit-M4531-16: verified that model limitations note is included in all calculation outputs', () => {
      const result = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', ponteFabric, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        negativeEasePolicy: validBodicePolicy
      });

      assert.ok(result.limitations.length >= 3);
      assert.ok(
        result.limitations.some(l =>
          l.includes('does not model dynamic pressure gradient, muscular support, hydrostatic compression, or performance-garment suitability')
        )
      );
    });

    it('audit-M4531-17: verifies provisional recovery and bias shrinkage approvals survive in calculation outputs', () => {
      const provRecPolicy: ProvisionalRecoveryPolicy = {
        allowProvisionalRecovery: true,
        provisionalRecoveryPercent: 80,
        userApproved: true,
        reason: 'Laboratory tension test pending for lot R42',
        approvedBy: 'Senior Textile Technologist',
        approvalDate: '2026-11-01'
      };

      const testFabricWithoutRecovery = {
        ...ponteFabric,
        directional: {
          ...ponteFabric.directional,
          weft: {
            ...ponteFabric.directional.weft,
            elasticRecoveryPercent: undefined
          }
        }
      };

      const result = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', testFabricWithoutRecovery, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        provisionalRecoveryPolicy: provRecPolicy
      });

      assert.equal(result.isCalculationAvailable, true);
      assert.equal(result.status, 'available');
      if (result.isCalculationAvailable) {
        assert.equal(result.isProvisionalCalculation, true);
        assert.equal(result.isProvisionalRecovery, true);
        assert.equal(result.provisionalRecoveryPolicyApplied?.approvedBy, 'Senior Textile Technologist');
        assert.ok(result.inputProvenanceSummary?.explicitUserAssumptions.some(a => a.includes('Provisional recovery')));
      }
    });

    it('audit-M4531-18: verifies original fabric evidence is never overwritten by provisional replacement values', () => {
      const provRecPolicy: ProvisionalRecoveryPolicy = {
        allowProvisionalRecovery: true,
        provisionalRecoveryPercent: 80,
        userApproved: true,
        reason: 'Temporary prototype check',
        approvedBy: 'Lead Patternmaker',
        approvalDate: '2026-11-01'
      };

      const originalFabric = {
        ...ponteFabric,
        directional: {
          ...ponteFabric.directional,
          weft: {
            ...ponteFabric.directional.weft,
            elasticRecoveryPercent: undefined // unmeasured
          }
        }
      };

      calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', originalFabric, {
        measurementDirection: 'circumference-crossgrain',
        garmentCategory: 'bodice',
        provisionalRecoveryPolicy: provRecPolicy
      });

      // Original fabric weft recovery MUST remain undefined (never mutated or overwritten)
      assert.equal(originalFabric.directional.weft.elasticRecoveryPercent, undefined);
    });

    it('audit-M4531-19: enforces isProductionReady = false invariant strictly across all prototype reports and summaries', () => {
      const reportConforming = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_CONFORMING);
      assert.equal(reportConforming.isProductionReady, false);

      const reportDiscrepant = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_DISCREPANT);
      assert.equal(reportDiscrepant.isProductionReady, false);

      const reportIncomplete = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE);
      assert.equal(reportIncomplete.isProductionReady, false);
    });
  });

  describe('Milestone 04.5.3.2: Authorization Boundary Hardening & Audit-Evidence Integrity', () => {
    const ponteLookup = getEnhancedFabricById('ponte-roma');
    const ponteFabric = ponteLookup.status === 'found' ? ponteLookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;

    const baseValidPolicy: NegativeEaseAuthorizationPolicy = {
      isAuthorized: true,
      garmentCategory: 'bodice',
      fitIntent: 'stretch-contour',
      maxPermittedNegativeEasePercent: 5.0,
      maxPermittedNegativeEaseCm: 2.0,
      minimumRequiredStretchPercent: 15.0,
      minimumRequiredRecoveryPercent: 75.0,
      authorizedBy: 'Lead Pattern Engineer',
      sourceAndProvenance: 'Spec-2026-M4532',
      authorizationDate: '2026-11-01T00:00:00.000Z'
    };

    const highStretchFabric = {
      ...ponteFabric,
      directional: {
        ...ponteFabric.directional,
        weft: {
          shrinkagePercent: 1.0,
          stretchPercent: 35.0,
          elasticRecoveryPercent: 90.0
        }
      }
    };

    describe('Objective A: Authorization-date integrity & normalized comparisons', () => {
      it('audit-M4532-1: accepts authorization dated before evaluation date (authorizationDate < evaluationDate)', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2026-10-15T00:00:00.000Z'
        };
        const res = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-01T00:00:00.000Z');
        assert.equal(res.isValid, true);
      });

      it('audit-M4532-2: accepts authorization dated exactly at evaluation date (authorizationDate === evaluationDate)', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2026-11-01T12:00:00.000Z'
        };
        const res = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-01T12:00:00.000Z');
        assert.equal(res.isValid, true);
      });

      it('audit-M4532-3: strictly rejects authorization dated after evaluation date (authorizationDate > evaluationDate)', () => {
        const futurePolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2026-11-10T00:00:00.000Z'
        };
        const res = validateNegativeEaseAuthorizationPolicy(futurePolicy, 'bodice', 25, 80, '2026-11-01T00:00:00.000Z');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes('is in the future relative to evaluation date'));
        assert.ok(res.rejectionReason?.includes('Authorizations cannot be applied retroactively'));
      });

      it('audit-M4532-4: rejects future authorization applied to historical evaluation', () => {
        const policy2026: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2026-06-01T00:00:00.000Z'
        };
        const resHistorical = validateNegativeEaseAuthorizationPolicy(
          policy2026,
          'bodice',
          25,
          80,
          '2024-03-15T10:00:00.000Z'
        );
        assert.equal(resHistorical.isValid, false);
        assert.ok(resHistorical.rejectionReason?.includes('is in the future relative to evaluation date'));
      });

      it('audit-M4532-5: normalizes date-only strings to UTC midnight and handles timezone offsets consistently', () => {
        const epochDateOnly = normalizeIsoDateToUtcEpoch('2026-11-01');
        assert.equal(epochDateOnly, Date.parse('2026-11-01T00:00:00.000Z'));

        const epochOffset = normalizeIsoDateToUtcEpoch('2026-11-01T02:00:00+02:00');
        assert.equal(epochOffset, epochDateOnly);

        const offsetPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2026-11-01T02:00:00+02:00'
        };
        const resValid = validateNegativeEaseAuthorizationPolicy(
          offsetPolicy,
          'bodice',
          25,
          80,
          '2026-11-01T01:00:00.000Z'
        );
        assert.equal(resValid.isValid, true);

        const resEarly = validateNegativeEaseAuthorizationPolicy(
          offsetPolicy,
          'bodice',
          25,
          80,
          '2026-10-31T23:59:59.000Z'
        );
        assert.equal(resEarly.isValid, false);
      });

      it('audit-M4532-6: rejects invalid calendar dates in authorization and expiration dates', () => {
        const badAuthPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2025-02-29'
        };
        const resAuth = validateNegativeEaseAuthorizationPolicy(badAuthPolicy, 'bodice', 25, 80);
        assert.equal(resAuth.isValid, false);
        assert.ok(resAuth.rejectionReason?.includes('Must be a valid ISO 8601 calendar date'));

        const badExpPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2026-11-01',
          expirationDate: '2026-04-31'
        };
        const resExp = validateNegativeEaseAuthorizationPolicy(badExpPolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(resExp.isValid, false);
        assert.ok(resExp.rejectionReason?.includes('Must be a valid ISO 8601 calendar date'));
      });

      it('audit-M4532-7: rejects contradictory policy where expirationDate predates authorizationDate', () => {
        const contradictoryPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2026-11-05T00:00:00.000Z',
          expirationDate: '2026-11-01T00:00:00.000Z'
        };
        const res = validateNegativeEaseAuthorizationPolicy(
          contradictoryPolicy,
          'bodice',
          25,
          80,
          '2026-11-06T00:00:00.000Z'
        );
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes('contradictory dates: expirationDate'));
        assert.ok(res.rejectionReason?.includes('predates authorizationDate'));
      });

      it('audit-M4532-8: preserves exact expiration boundary (evalTime <= expTime valid, evalTime > expTime invalid)', () => {
        const expiringPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2026-11-01T00:00:00.000Z',
          expirationDate: '2026-11-05T12:00:00.000Z'
        };

        const resBefore = validateNegativeEaseAuthorizationPolicy(
          expiringPolicy,
          'bodice',
          25,
          80,
          '2026-11-05T11:59:59.999Z'
        );
        assert.equal(resBefore.isValid, true);

        const resAt = validateNegativeEaseAuthorizationPolicy(
          expiringPolicy,
          'bodice',
          25,
          80,
          '2026-11-05T12:00:00.000Z'
        );
        assert.equal(resAt.isValid, true);

        const resAfter = validateNegativeEaseAuthorizationPolicy(
          expiringPolicy,
          'bodice',
          25,
          80,
          '2026-11-05T12:00:00.001Z'
        );
        assert.equal(resAfter.isValid, false);
        assert.ok(resAfter.rejectionReason?.includes('expired on'));
      });
    });

    describe('Objective B: Closed garment-category compatibility validation', () => {
      it('audit-M4532-9: verifies default registry contains standard garment categories and valid intents', () => {
        const expectedCategories = ['bodice', 'skirt', 'sleeve', 'trousers', 'pants', 'leggings', 'corset', 'dress'];
        for (const cat of expectedCategories) {
          assert.ok(CATEGORY_FIT_INTENT_COMPATIBILITY[cat], `Category '${cat}' must exist in registry`);
          const intents = CATEGORY_FIT_INTENT_COMPATIBILITY[cat];
          assert.ok(intents.length > 0);
          for (const intent of intents) {
            assert.ok(isRecognizedFitIntent(intent), `Intent '${intent}' must be recognized`);
          }
        }
      });

      it('audit-M4532-10: fail-closed validation strictly rejects unknown/unsupported garment categories', () => {
        const unsupportedCategories = ['space-suit', 'armchair', 'outerwear', 'footwear', 'tent'];
        for (const unsupp of unsupportedCategories) {
          const policy: NegativeEaseAuthorizationPolicy = {
            ...baseValidPolicy,
            garmentCategory: unsupp
          };
          const res = validateNegativeEaseAuthorizationPolicy(policy, unsupp, 25, 80, '2026-11-02');
          assert.equal(res.isValid, false, `Category '${unsupp}' must be rejected`);
          assert.ok(res.rejectionReason?.includes(`Unsupported garment category '${unsupp}'`));
          assert.ok(res.rejectionReason?.includes('Supported categories with verified compatibility'));
        }
      });

      it('audit-M4532-11: strictly rejects missing, empty, or whitespace target garment category', () => {
        const resMissing = validateNegativeEaseAuthorizationPolicy(baseValidPolicy, undefined, 25, 80);
        assert.equal(resMissing.isValid, false);
        assert.ok(resMissing.rejectionReason?.includes('Target garment category is missing'));

        const resEmpty = validateNegativeEaseAuthorizationPolicy(baseValidPolicy, '   ', 25, 80);
        assert.equal(resEmpty.isValid, false);
        assert.ok(resEmpty.rejectionReason?.includes('Target garment category is missing'));
      });

      it('audit-M4532-12: calculateFabricAwareCircumferenceEase fails gracefully when category is unsupported', () => {
        const result = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
          measurementDirection: 'circumference-crossgrain',
          garmentCategory: 'unsupported-suit',
          negativeEasePolicy: {
            ...baseValidPolicy,
            garmentCategory: 'unsupported-suit'
          },
          evaluationDate: '2026-11-02'
        });

        assert.equal(result.isCalculationAvailable, true);
        assert.equal(result.negativeEasePolicyApplied, undefined);
        assert.ok(result.totalAppliedEaseCm >= 0);
        assert.ok(result.provenanceNotes.some(n => n.includes("Unsupported garment category 'unsupported-suit'")));
      });

      it('audit-M4532-13: registerCustomGarmentCategoryCompatibility permits extending supported categories with recognized intents', () => {
        const regRes = registerCustomGarmentCategoryCompatibility('active-jumpsuit', [
          'compression-fit',
          'performance-knit',
          'stretch-contour'
        ]);
        assert.equal(regRes.success, true);
        assert.ok(CATEGORY_FIT_INTENT_COMPATIBILITY['active-jumpsuit']);
        assert.deepEqual(CATEGORY_FIT_INTENT_COMPATIBILITY['active-jumpsuit'], [
          'compression-fit',
          'performance-knit',
          'stretch-contour'
        ]);

        const customPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'active-jumpsuit',
          fitIntent: 'compression-fit'
        };
        const evalRes = validateNegativeEaseAuthorizationPolicy(customPolicy, 'active-jumpsuit', 25, 80, '2026-11-02');
        assert.equal(evalRes.isValid, true);
      });

      it('audit-M4532-14: registerCustomGarmentCategoryCompatibility rejects invalid registration inputs', () => {
        const resEmptyCat = registerCustomGarmentCategoryCompatibility('', ['compression-fit']);
        assert.equal(resEmptyCat.success, false);
        assert.ok(resEmptyCat.error?.includes('non-empty string'));

        const resEmptyIntents = registerCustomGarmentCategoryCompatibility('swimwear', []);
        assert.equal(resEmptyIntents.success, false);
        assert.ok(resEmptyIntents.error?.includes('non-empty array'));

        const resBadIntent = registerCustomGarmentCategoryCompatibility('swimwear', ['compression-fit', 'loose-fit' as unknown as string]);
        assert.equal(resBadIntent.success, false);
        assert.ok(resBadIntent.error?.includes("Unrecognized fit intent 'loose-fit'"));
      });

      it('audit-M4532-15: custom category strictly rejects incompatible fit intents', () => {
        const customPolicyIncompatible: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'active-jumpsuit',
          fitIntent: 'corsetry'
        };
        const evalRes = validateNegativeEaseAuthorizationPolicy(
          customPolicyIncompatible,
          'active-jumpsuit',
          25,
          80,
          '2026-11-02'
        );
        assert.equal(evalRes.isValid, false);
        assert.ok(evalRes.rejectionReason?.includes("Fit intent 'corsetry' is incompatible with garment category 'active-jumpsuit'"));
      });
    });

    describe('Objective C: Multi-category audit evidence provenance & independent verification', () => {
      const validIndependentEvidence: MultiCategoryAuditEvidence = {
        evidenceType: 'quality-management-audit',
        auditScope: 'Full stretch compression fit verification across bodice, skirt, and leggings blocks',
        auditedBy: 'Senior Quality Assurance Lead',
        evidenceReference: 'QMA-2026-M4532-001',
        auditDate: '2026-10-25',
        authorizedCategories: ['bodice', 'skirt', 'leggings'],
        isIndependentlyVerified: true,
        verificationNotes: ['Conducted according to ISO 13934 tensile standards under atelier conditions.']
      };

      it('audit-M4532-16: rejects wildcard category "all" when isMultiCategoryAudited: true is asserted without multiCategoryAuditEvidence', () => {
        const booleanOnlyPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Multi-category stretch range covering bodice, skirt, and leggings',
          isMultiCategoryAudited: true
        };
        const res = validateNegativeEaseAuthorizationPolicy(booleanOnlyPolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes('requires structured multiCategoryAuditEvidence'));
        assert.ok(res.rejectionReason?.includes('A self-asserted boolean (isMultiCategoryAudited: true) is not acceptable proof'));
      });

      it('audit-M4532-17: rejects wildcard category "all" when auditScope is missing or under 10 characters', () => {
        const shortScopePolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Scope <10',
          multiCategoryAuditEvidence: {
            ...validIndependentEvidence,
            auditScope: 'Scope <10'
          }
        };
        const res = validateNegativeEaseAuthorizationPolicy(shortScopePolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes('multiCategoryAuditScope >= 10 chars'));
      });

      it('audit-M4532-18: rejects wildcard category "all" when auditedBy or evidenceReference is missing', () => {
        const missingAuditorPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Multi-category stretch range covering bodice, skirt, and leggings',
          multiCategoryAuditEvidence: {
            ...validIndependentEvidence,
            auditedBy: ''
          }
        };
        const resAuditor = validateNegativeEaseAuthorizationPolicy(missingAuditorPolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(resAuditor.isValid, false);
        assert.ok(resAuditor.rejectionReason?.includes('missing non-empty auditedBy identity'));

        const missingRefPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Multi-category stretch range covering bodice, skirt, and leggings',
          multiCategoryAuditEvidence: {
            ...validIndependentEvidence,
            evidenceReference: '   '
          }
        };
        const resRef = validateNegativeEaseAuthorizationPolicy(missingRefPolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(resRef.isValid, false);
        assert.ok(resRef.rejectionReason?.includes('missing non-empty evidenceReference'));
      });

      it('audit-M4532-19: rejects wildcard category "all" when auditDate is invalid or non-ISO', () => {
        const badDatePolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Multi-category stretch range covering bodice, skirt, and leggings',
          multiCategoryAuditEvidence: {
            ...validIndependentEvidence,
            auditDate: '2026-02-31'
          }
        };
        const res = validateNegativeEaseAuthorizationPolicy(badDatePolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes("contains invalid auditDate '2026-02-31'"));
      });

      it('audit-M4532-20: rejects wildcard category "all" when target category is not in authorizedCategories', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Multi-category stretch range covering bodice, skirt, and leggings',
          multiCategoryAuditEvidence: {
            ...validIndependentEvidence,
            authorizedCategories: ['skirt', 'leggings']
          }
        };
        const res = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes("does not cover target garment category 'bodice'"));
        assert.ok(res.rejectionReason?.includes('Authorized categories: skirt, leggings'));
      });

      it('audit-M4532-21: rejects contradictory claim where internally-recorded-declaration claims isIndependentlyVerified: true', () => {
        const contradictoryInternalPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Multi-category stretch range covering bodice, skirt, and leggings',
          multiCategoryAuditEvidence: {
            ...validIndependentEvidence,
            evidenceType: 'internally-recorded-declaration',
            isIndependentlyVerified: true
          }
        };
        const res = validateNegativeEaseAuthorizationPolicy(contradictoryInternalPolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes("Contradictory audit evidence: 'internally-recorded-declaration' cannot claim isIndependentlyVerified: true"));
      });

      it('audit-M4532-22: rejects contradictory claim where independent evidence types claim isIndependentlyVerified: false', () => {
        const independentTypes: Array<MultiCategoryAuditEvidence['evidenceType']> = [
          'laboratory-certified-test',
          'quality-management-audit',
          'third-party-conformity-assessment'
        ];
        for (const evType of independentTypes) {
          const contradictoryPolicy: NegativeEaseAuthorizationPolicy = {
            ...baseValidPolicy,
            garmentCategory: 'all',
            multiCategoryAuditScope: 'Multi-category stretch range covering bodice, skirt, and leggings',
            multiCategoryAuditEvidence: {
              ...validIndependentEvidence,
              evidenceType: evType,
              isIndependentlyVerified: false
            }
          };
          const res = validateNegativeEaseAuthorizationPolicy(contradictoryPolicy, 'bodice', 25, 80, '2026-11-02');
          assert.equal(res.isValid, false);
          assert.ok(res.rejectionReason?.includes(`Contradictory audit evidence: '${evType}' must have isIndependentlyVerified: true`));
        }
      });

      it('audit-M4532-23: accepts valid independent multi-category audit evidence and records it accurately in provenance', () => {
        const validPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Multi-category stretch range covering bodice, skirt, and leggings',
          multiCategoryAuditEvidence: validIndependentEvidence
        };

        const res = validateNegativeEaseAuthorizationPolicy(validPolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(res.isValid, true);

        const calc = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
          measurementDirection: 'circumference-crossgrain',
          garmentCategory: 'bodice',
          negativeEasePolicy: validPolicy,
          evaluationDate: '2026-11-02'
        });

        assert.equal(calc.isCalculationAvailable, true);
        assert.equal(calc.status, 'available');
        if (calc.isCalculationAvailable) {
          assert.ok(calc.totalAppliedEaseCm < 0);
          assert.ok(calc.provenanceNotes.some(n => n.includes('Multi-category audit evidence applied: [quality-management-audit]')));
          assert.ok(calc.inputProvenanceSummary?.measuredInputs.some(i => i.includes('Multi-category audit [quality-management-audit]')));
        }
      });

      it('audit-M4532-24: accepts valid internal declaration multi-category evidence with isIndependentlyVerified: false and records it as assumption', () => {
        const internalDeclarationEvidence: MultiCategoryAuditEvidence = {
          evidenceType: 'internally-recorded-declaration',
          auditScope: 'Internal pattern engineering team cross-category stretch assessment',
          auditedBy: 'Atelier Head Patternmaker',
          evidenceReference: 'INT-DEC-2026-08',
          auditDate: '2026-10-30',
          authorizedCategories: ['bodice', 'skirt'],
          isIndependentlyVerified: false
        };

        const validInternalPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Internal pattern engineering team cross-category stretch assessment',
          multiCategoryAuditEvidence: internalDeclarationEvidence
        };

        const res = validateNegativeEaseAuthorizationPolicy(validInternalPolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(res.isValid, true);

        const calc = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
          measurementDirection: 'circumference-crossgrain',
          garmentCategory: 'bodice',
          negativeEasePolicy: validInternalPolicy,
          evaluationDate: '2026-11-02'
        });

        assert.equal(calc.isCalculationAvailable, true);
        if (calc.isCalculationAvailable) {
          assert.ok(calc.provenanceNotes.some(n => n.includes('Internal Declaration')));
          assert.ok(calc.inputProvenanceSummary?.explicitUserAssumptions.some(a => a.includes('Multi-category declaration [internally-recorded-declaration]')));
        }
      });

      it('audit-M4532-25: confirms single-category policy is unaffected and does not require multiCategoryAuditEvidence', () => {
        const singleCategoryPolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'bodice'
        };
        const res = validateNegativeEaseAuthorizationPolicy(singleCategoryPolicy, 'bodice', 25, 80, '2026-11-02');
        assert.equal(res.isValid, true);
      });
    });

    describe('Integration & Invariants', () => {
      it('audit-M4532-26: full calculation rejects negative ease when authorization date postdates evaluation date', () => {
        const futurePolicy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          authorizationDate: '2026-11-15T00:00:00.000Z'
        };
        const result = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
          measurementDirection: 'circumference-crossgrain',
          garmentCategory: 'bodice',
          negativeEasePolicy: futurePolicy,
          evaluationDate: '2026-11-01T00:00:00.000Z'
        });

        assert.equal(result.isCalculationAvailable, true);
        assert.equal(result.negativeEasePolicyApplied, undefined);
        assert.ok(result.totalAppliedEaseCm >= 0);
        assert.ok(result.provenanceNotes.some(n => n.includes('is in the future relative to evaluation date')));
      });

      it('audit-M4532-27: strictly enforces isProductionReady = false invariant across all prototype reports', () => {
        const reportConforming = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_CONFORMING);
        assert.equal(reportConforming.isProductionReady, false);

        const reportDiscrepant = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_DISCREPANT);
        assert.equal(reportDiscrepant.isProductionReady, false);

        const reportIncomplete = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE);
        assert.equal(reportIncomplete.isProductionReady, false);
      });
    });
  });

  describe('Milestone 04.5.3.3: Audit Evidence Trust Boundaries & Controlled Category Registration', () => {
    const ponteLookup = getEnhancedFabricById('ponte-roma');
    const ponteFabric = ponteLookup.status === 'found' ? ponteLookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;

    const baseValidPolicy: NegativeEaseAuthorizationPolicy = {
      isAuthorized: true,
      garmentCategory: 'bodice',
      fitIntent: 'compression-fit',
      maxPermittedNegativeEasePercent: 5.0,
      maxPermittedNegativeEaseCm: 4.0,
      minimumRequiredStretchPercent: 15.0,
      minimumRequiredRecoveryPercent: 75.0,
      authorizedBy: 'Principal Pattern Engineer',
      sourceAndProvenance: 'Audit-Standard-04.5.3.3',
      authorizationDate: '2026-11-01T00:00:00.000Z'
    };

    const highStretchFabric = {
      ...ponteFabric,
      id: 'active-stretch-knit',
      name: 'Active Compression Knit',
      gsm: 280,
      thicknessMm: 0.8,
      moldingFactor: 1.0,
      provenance: 'laboratory-tested' as const,
      isVerified: true,
      directional: {
        warp: { stretchPercent: 20.0, shrinkagePercent: 1.0, elasticRecoveryPercent: 90 },
        weft: { stretchPercent: 30.0, shrinkagePercent: 1.0, elasticRecoveryPercent: 90 },
        bias: { stretchPercent: 35.0, shrinkagePercent: 2.0, elasticRecoveryPercent: 85 }
      }
    };

    describe('Area 1: Evidence Trust Classification & Unauthenticated Assertions', () => {
      it('audit-M4533-1: self-asserted independent evidence without trusted verifier is strictly unverified-external-claim', () => {
        const evidence: MultiCategoryAuditEvidence = {
          evidenceType: 'laboratory-certified-test',
          auditScope: 'Full collection activewear range testing',
          auditedBy: 'External Testing House',
          evidenceReference: 'LAB-CERT-2026-99',
          auditDate: '2026-10-15',
          authorizedCategories: ['bodice', 'leggings'],
          isIndependentlyVerified: true // Self-asserted claim
        };

        const trustResult = evaluateAuditEvidenceTrust(evidence);
        assert.equal(trustResult.trustClassification, 'unverified-external-claim');
        assert.equal(trustResult.isAuthentic, false);
        assert.ok(trustResult.rationale.includes('no trusted independent verification authority authenticated'));

        // Evaluated in policy validation
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Full collection activewear range testing',
          multiCategoryAuditEvidence: evidence
        };

        const valResult = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-01');
        assert.equal(valResult.isValid, true);
        assert.equal(valResult.evidenceTrustClassification, 'unverified-external-claim');
      });

      it('audit-M4533-2: caller-provided trusted verifier can authenticate independent audit evidence', () => {
        const evidence: MultiCategoryAuditEvidence = {
          evidenceType: 'third-party-conformity-assessment',
          auditScope: 'Global compression fit standard evaluation',
          auditedBy: 'SGS Textile Labs',
          evidenceReference: 'SGS-TEXTILE-4412',
          auditDate: '2026-10-20',
          authorizedCategories: ['bodice', 'corset'],
          isIndependentlyVerified: true
        };

        const verifier = (ev: MultiCategoryAuditEvidence) => ev.evidenceReference.startsWith('SGS-');
        const trustResult = evaluateAuditEvidenceTrust(evidence, verifier);
        assert.equal(trustResult.trustClassification, 'authenticated-independent');
        assert.equal(trustResult.isAuthentic, true);

        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Global compression fit standard evaluation',
          multiCategoryAuditEvidence: evidence
        };

        const valResult = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-01', verifier);
        assert.equal(valResult.isValid, true);
        assert.equal(valResult.evidenceTrustClassification, 'authenticated-independent');
      });

      it('audit-M4533-3: internal declaration evidence is classified as declared-internal', () => {
        const evidence: MultiCategoryAuditEvidence = {
          evidenceType: 'internally-recorded-declaration',
          auditScope: 'Internal studio prototype evaluation',
          auditedBy: 'Studio Fitting Lead',
          evidenceReference: 'INT-DEC-2026-01',
          auditDate: '2026-10-25',
          authorizedCategories: ['bodice', 'skirt'],
          isIndependentlyVerified: false
        };

        const trustResult = evaluateAuditEvidenceTrust(evidence);
        assert.equal(trustResult.trustClassification, 'declared-internal');
        assert.equal(trustResult.isAuthentic, false);
      });

      it('audit-M4533-4: verifier returning false classifies evidence as unverified-external-claim', () => {
        const evidence: MultiCategoryAuditEvidence = {
          evidenceType: 'third-party-conformity-assessment',
          auditScope: 'Unrecognized lab evaluation',
          auditedBy: 'Unknown Auditor',
          evidenceReference: 'UNKNOWN-LAB-01',
          auditDate: '2026-10-20',
          authorizedCategories: ['bodice'],
          isIndependentlyVerified: true
        };

        const verifier = (_ev: MultiCategoryAuditEvidence) => false;
        const trustResult = evaluateAuditEvidenceTrust(evidence, verifier);
        assert.equal(trustResult.trustClassification, 'unverified-external-claim');
        assert.equal(trustResult.isAuthentic, false);
        assert.ok(trustResult.rationale.includes('no trusted independent verification authority authenticated'));
      });
    });

    describe('Area 2: Controlled Custom-Category Registration & Immutability', () => {
      it('audit-M4533-5: attempting to override standard categories throws or returns error', () => {
        const standardCats = ['bodice', 'skirt', 'sleeve', 'trousers', 'pants', 'leggings', 'corset', 'dress'];
        for (const cat of standardCats) {
          const res = registerCustomGarmentCategoryCompatibility(cat, ['compression-fit']);
          assert.equal(res.success, false);
          assert.ok(res.error?.includes('Standard categories are immutable'));
        }
      });

      it('audit-M4533-6: direct property assignment on CATEGORY_FIT_INTENT_COMPATIBILITY throws TypeError', () => {
        assert.throws(
          () => {
            // Direct mutation attempt on proxy
            (CATEGORY_FIT_INTENT_COMPATIBILITY as Record<string, unknown>)['bodice'] = ['loose-baggy'];
          },
          {
            name: 'TypeError',
            message: /immutable/
          }
        );
      });

      it('audit-M4533-7: direct property deletion on CATEGORY_FIT_INTENT_COMPATIBILITY throws TypeError', () => {
        assert.throws(
          () => {
            delete (CATEGORY_FIT_INTENT_COMPATIBILITY as Record<string, unknown>)['bodice'];
          },
          {
            name: 'TypeError',
            message: /immutable/
          }
        );
      });

      it('audit-M4533-8: DEFAULT_CATEGORY_FIT_INTENT_COMPATIBILITY is Object.isFrozen', () => {
        assert.ok(Object.isFrozen(DEFAULT_CATEGORY_FIT_INTENT_COMPATIBILITY));
        for (const key of Object.keys(DEFAULT_CATEGORY_FIT_INTENT_COMPATIBILITY)) {
          assert.ok(Object.isFrozen(DEFAULT_CATEGORY_FIT_INTENT_COMPATIBILITY[key]));
        }
      });

      it('audit-M4533-9: resetCustomGarmentCategoryRegistry clears custom registrations without affecting standard categories', () => {
        const regRes = registerCustomGarmentCategoryCompatibility('cycling-bib', ['compression-fit', 'performance-knit']);
        assert.equal(regRes.success, true);
        assert.ok(CATEGORY_FIT_INTENT_COMPATIBILITY['cycling-bib']);

        resetCustomGarmentCategoryRegistry();
        assert.equal(CATEGORY_FIT_INTENT_COMPATIBILITY['cycling-bib'], undefined);

        // Standard categories are untouched
        assert.ok(CATEGORY_FIT_INTENT_COMPATIBILITY['bodice']);
        assert.ok(CATEGORY_FIT_INTENT_COMPATIBILITY['leggings']);
      });

      it('audit-M4533-10: getAllSupportedGarmentCategories returns union of standard and custom categories', () => {
        resetCustomGarmentCategoryRegistry();
        const baseCount = getAllSupportedGarmentCategories().length;
        assert.ok(baseCount >= 8);

        registerCustomGarmentCategoryCompatibility('wetsuit', ['compression-fit']);
        const updated = getAllSupportedGarmentCategories();
        assert.equal(updated.length, baseCount + 1);
        assert.ok(updated.includes('wetsuit'));

        resetCustomGarmentCategoryRegistry();
      });
    });

    describe('Area 3: Audit-Date Validation Against Evaluation & Authorization Dates', () => {
      it('audit-M4533-11: rejects auditDate that postdates evaluationDate', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Full collection activewear range testing',
          authorizationDate: '2026-11-01',
          multiCategoryAuditEvidence: {
            evidenceType: 'laboratory-certified-test',
            auditScope: 'Full collection activewear range testing',
            auditedBy: 'Lab Verifier',
            evidenceReference: 'LAB-2026-01',
            auditDate: '2026-11-10', // Postdates evaluationDate (2026-11-05)
            authorizedCategories: ['bodice'],
            isIndependentlyVerified: true
          }
        };

        const res = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-05');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes('Audit evidence date'));
        assert.ok(res.rejectionReason?.includes('is in the future relative to calculation evaluation date'));
      });

      it('audit-M4533-12: rejects auditDate that postdates authorizationDate', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Full collection activewear range testing',
          authorizationDate: '2026-11-01', // Authorization granted on Nov 1
          multiCategoryAuditEvidence: {
            evidenceType: 'laboratory-certified-test',
            auditScope: 'Full collection activewear range testing',
            auditedBy: 'Lab Verifier',
            evidenceReference: 'LAB-2026-01',
            auditDate: '2026-11-03', // Audit occurred on Nov 3 (after authorization was supposedly granted)
            authorizedCategories: ['bodice'],
            isIndependentlyVerified: true
          }
        };

        const res = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-10');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes('Audit evidence date'));
        assert.ok(res.rejectionReason?.includes('postdates policy authorizationDate'));
      });

      it('audit-M4533-13: accepts coherent chronological progression (auditDate <= authorizationDate <= evaluationDate)', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Full collection activewear range testing',
          authorizationDate: '2026-10-30',
          multiCategoryAuditEvidence: {
            evidenceType: 'laboratory-certified-test',
            auditScope: 'Full collection activewear range testing',
            auditedBy: 'Lab Verifier',
            evidenceReference: 'LAB-2026-01',
            auditDate: '2026-10-25',
            authorizedCategories: ['bodice'],
            isIndependentlyVerified: true
          }
        };

        const res = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-01');
        assert.equal(res.isValid, true);
      });
    });

    describe('Area 4: Audit-Scope Consistency & Explicit Category Coverage', () => {
      it('audit-M4533-14: rejects audit evidence where authorizedCategories contains unsupported categories', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Full collection activewear range testing',
          multiCategoryAuditEvidence: {
            evidenceType: 'laboratory-certified-test',
            auditScope: 'Full collection activewear range testing',
            auditedBy: 'Lab Verifier',
            evidenceReference: 'LAB-2026-01',
            auditDate: '2026-10-25',
            authorizedCategories: ['bodice', 'unknown-garment-category'],
            isIndependentlyVerified: true
          }
        };

        const res = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-01');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes("contains unsupported category 'unknown-garment-category'"));
      });

      it('audit-M4533-15: rejects empty string or whitespace items in authorizedCategories', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Full collection activewear range testing',
          multiCategoryAuditEvidence: {
            evidenceType: 'laboratory-certified-test',
            auditScope: 'Full collection activewear range testing',
            auditedBy: 'Lab Verifier',
            evidenceReference: 'LAB-2026-01',
            auditDate: '2026-10-25',
            authorizedCategories: ['bodice', '   '],
            isIndependentlyVerified: true
          }
        };

        const res = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-01');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes('contains empty or whitespace category name'));
      });

      it('audit-M4533-16: rejects when target category is omitted from authorizedCategories', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Full collection activewear range testing',
          multiCategoryAuditEvidence: {
            evidenceType: 'laboratory-certified-test',
            auditScope: 'Full collection activewear range testing',
            auditedBy: 'Lab Verifier',
            evidenceReference: 'LAB-2026-01',
            auditDate: '2026-10-25',
            authorizedCategories: ['skirt', 'leggings'], // Missing 'bodice'
            isIndependentlyVerified: true
          }
        };

        const res = validateNegativeEaseAuthorizationPolicy(policy, 'bodice', 25, 80, '2026-11-01');
        assert.equal(res.isValid, false);
        assert.ok(res.rejectionReason?.includes("does not cover target garment category 'bodice'"));
      });
    });

    describe('Area 5: End-to-End Calculation & Invariants', () => {
      it('audit-M4533-17: circumference ease calculation records auditEvidenceTrustClassification in breakdown', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Full collection activewear range testing',
          multiCategoryAuditEvidence: {
            evidenceType: 'laboratory-certified-test',
            auditScope: 'Full collection activewear range testing',
            auditedBy: 'Lab Verifier',
            evidenceReference: 'LAB-2026-01',
            auditDate: '2026-10-25',
            authorizedCategories: ['bodice'],
            isIndependentlyVerified: true
          }
        };

        const calc = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
          measurementDirection: 'circumference-crossgrain',
          garmentCategory: 'bodice',
          negativeEasePolicy: policy,
          evaluationDate: '2026-11-01'
        });

        assert.equal(calc.isCalculationAvailable, true);
        assert.equal(calc.auditEvidenceTrustClassification, 'unverified-external-claim');
        assert.ok(calc.provenanceNotes.some(n => n.includes('Trust classification: unverified-external-claim')));
      });

      it('audit-M4533-18: circumference ease with trusted verifier records authenticated-independent', () => {
        const policy: NegativeEaseAuthorizationPolicy = {
          ...baseValidPolicy,
          garmentCategory: 'all',
          multiCategoryAuditScope: 'Full collection activewear range testing',
          multiCategoryAuditEvidence: {
            evidenceType: 'third-party-conformity-assessment',
            auditScope: 'Full collection activewear range testing',
            auditedBy: 'ISO Certified Lab',
            evidenceReference: 'ISO-CERT-9001',
            auditDate: '2026-10-25',
            authorizedCategories: ['bodice'],
            isIndependentlyVerified: true
          }
        };

        const verifier = (ev: MultiCategoryAuditEvidence) => ev.evidenceReference === 'ISO-CERT-9001';

        const calc = calculateFabricAwareCircumferenceEase('waist', 68.0, 'classic', highStretchFabric, {
          measurementDirection: 'circumference-crossgrain',
          garmentCategory: 'bodice',
          negativeEasePolicy: policy,
          evaluationDate: '2026-11-01',
          trustedVerifier: verifier
        });

        assert.equal(calc.isCalculationAvailable, true);
        assert.equal(calc.auditEvidenceTrustClassification, 'authenticated-independent');
        assert.ok(calc.provenanceNotes.some(n => n.includes('Trust classification: authenticated-independent')));
      });

      it('audit-M4533-19: strictly preserves isProductionReady = false across all prototype reports', () => {
        const reportConforming = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_CONFORMING);
        assert.equal(reportConforming.isProductionReady, false);

        const reportDiscrepant = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_DISCREPANT);
        assert.equal(reportDiscrepant.isProductionReady, false);

        const reportIncomplete = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE);
        assert.equal(reportIncomplete.isProductionReady, false);
      });
    });
  });
});


