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
  calculateFabricAwareCircumferenceEase
} from './ease-engine';
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
      assert.notEqual((unknownLookup as any).fabric?.id, 'wool-crepe');
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
        measurementDirection: 'diagonal-unsupported' as any
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
        garmentCategory: 'trouser' as any
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
        negativeEasePolicy: invalidDatePolicy as any
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
        negativeEasePolicy: noAuthorPolicy as any
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
        negativeEasePolicy: badIntentPolicy as any
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
        garmentCategory: '' as any // Empty category
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
});

