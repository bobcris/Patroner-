/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { generateGarmentConcept } from '../../services/ai/fashion-service';
import { canonicalizeSpecificationPayload, verifySpecificationApproval } from './garment-specification';
import { ProductionSnapshotValidationError } from './production-types';
import {
  draftSupportedCategoryPieces,
  evaluateSpecPipelineSafely,
  isCadDraftingSupportedCategory,
  safeComputeSpecificationFingerprint,
  safeVerifySpecificationApproval
} from './category-support';

describe('Post-M06 Live Product Audit P0 Remediation: Category Support & Approval Consistency', () => {
  const sizeM = STANDARD_SIZING_SYSTEM.sizes.M;

  it('1. curated INITIAL_CONCEPTS pass canonical approval verification consistently without contradiction', () => {
    const skirtPreset = INITIAL_CONCEPTS[0];
    const draftSkirt = INITIAL_CONCEPTS[1];
    const bodicePreset = INITIAL_CONCEPTS[2];

    const vSkirt = safeVerifySpecificationApproval(skirtPreset);
    assert.equal(vSkirt.isCadSupported, true);
    assert.equal(vSkirt.isValid, true);
    assert.equal(vSkirt.state, 'approved');
    assert.equal(vSkirt.authorityTier, 'demonstration_fixture');

    const vDraft = safeVerifySpecificationApproval(draftSkirt);
    assert.equal(vDraft.isCadSupported, true);
    assert.equal(vDraft.isValid, false);
    assert.equal(vDraft.state, 'draft');

    const vBodice = safeVerifySpecificationApproval(bodicePreset);
    assert.equal(vBodice.isCadSupported, true);
    assert.equal(vBodice.isValid, true);
    assert.equal(vBodice.state, 'approved');
    assert.equal(vBodice.authorityTier, 'demonstration_fixture');
  });

  it('2. fails closed on forged isApproved=true when approval record is missing or parameters tampered', () => {
    const forgedDraft = {
      ...INITIAL_CONCEPTS[1],
      isApproved: true,
      approvalState: 'approved' as const
    };
    const verification = verifySpecificationApproval(forgedDraft);
    assert.equal(verification.isValid, false);

    const safeVerification = safeVerifySpecificationApproval(forgedDraft);
    assert.equal(safeVerification.isValid, false);

    const tamperedPreset = {
      ...INITIAL_CONCEPTS[0],
      seamAllowanceCm: 2.5
    };
    assert.equal(safeVerifySpecificationApproval(tamperedPreset).isValid, false);
  });

  it('3. handles trouser and dress SPECS ONLY categories without throwing or substituting skirt geometry', async () => {
    for (const cat of ['trouser', 'dress'] as const) {
      assert.equal(isCadDraftingSupportedCategory(cat), false);

      const generated = await generateGarmentConcept({
        prompt: `Architectural tailored ${cat}`,
        category: cat,
        silhouette: 'straight',
        fabricId: 'wool-crepe',
        colorName: 'Chalk Oatmeal',
        colorHex: '#E8E3D9',
        easeProfile: 'classic',
        lengthCm: 72
      });

      const draftResult = draftSupportedCategoryPieces(sizeM, generated.specification);
      assert.equal(draftResult.isCadSupported, false);
      assert.equal(draftResult.pieces.length, 0);
      assert.ok(draftResult.unsupportedReason);

      const fpResult = safeComputeSpecificationFingerprint(generated.specification);
      assert.equal(fpResult.isSupported, false);
      assert.equal(fpResult.fingerprint, null);

      const pipelineResult = evaluateSpecPipelineSafely({
        specification: generated.specification,
        measurements: sizeM,
        measurementApprovalState: 'unverified',
        measurementProvenance: 'standard-chart',
        activeSize: 'M',
        fabric: generated.specification.fabric
      });

      assert.equal(pipelineResult.isCadSupported, false);
      assert.equal(pipelineResult.pieces.length, 0);
      assert.equal(pipelineResult.approvalVerification.isValid, false);
      assert.equal(pipelineResult.pipelineReport.isPipelineSynchronized, false);
      assert.equal(pipelineResult.pipelineReport.canExportProductionDocumentation, false);
    }
  });

  it('4. preserves strict fail-closed rejection inside canonicalizeSpecificationPayload for unsupported or missing categories', () => {
    assert.throws(() => {
      canonicalizeSpecificationPayload({
        ...INITIAL_CONCEPTS[0],
        garmentCategory: 'trouser'
      });
    }, ProductionSnapshotValidationError);

    assert.throws(() => {
      canonicalizeSpecificationPayload({
        ...INITIAL_CONCEPTS[0],
        garmentCategory: 'dress'
      });
    }, ProductionSnapshotValidationError);
  });

  it('5. evaluates skirt and bodice categories cleanly through evaluateSpecPipelineSafely', () => {
    const skirtPipeline = evaluateSpecPipelineSafely({
      specification: INITIAL_CONCEPTS[0],
      measurements: sizeM,
      measurementApprovalState: 'unverified',
      measurementProvenance: 'standard-chart',
      activeSize: 'M',
      fabric: INITIAL_CONCEPTS[0].fabric
    });
    assert.equal(skirtPipeline.isCadSupported, true);
    assert.equal(skirtPipeline.pieces.length, 2);
    assert.equal(skirtPipeline.validation.isValid, true);
    assert.equal(skirtPipeline.approvalVerification.isValid, true);

    const bodicePipeline = evaluateSpecPipelineSafely({
      specification: INITIAL_CONCEPTS[2],
      measurements: sizeM,
      measurementApprovalState: 'unverified',
      measurementProvenance: 'standard-chart',
      activeSize: 'M',
      fabric: INITIAL_CONCEPTS[2].fabric
    });
    assert.equal(bodicePipeline.isCadSupported, true);
    assert.equal(bodicePipeline.pieces.length, 2);
    assert.equal(bodicePipeline.validation.isValid, true);
    assert.equal(bodicePipeline.approvalVerification.isValid, true);
  });
});
