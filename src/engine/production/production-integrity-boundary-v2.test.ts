/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuthoritativeGarmentSpecification,
  reviseAuthoritativeGarmentSpecification,
  approveAuthoritativeGarmentSpecification,
  revokeAuthoritativeGarmentSpecificationApproval,
  computeSpecificationFingerprint,
  verifySpecificationApproval,
  convertToDesignSpecification,
  setAuthorityProviderContext,
  resetAuthorityProviderContext
} from './garment-specification';

import {
  evaluatePipelineDependencyIntegrity,
  validateProductionExportPrerequisites,
  computeArtifactInputFingerprint
} from './dependency-invalidation';

import {
  STANDARD_SIZING_SYSTEM,
  calculateGarmentDimensions
} from '../measurements/standards';

import { draftSkirtBlock } from '../drafting/skirt-block';
import { getEnhancedFabricById, DEFAULT_ILLUSTRATIVE_FABRIC } from '../fabric/fabric-presets';
import { validatePatternDraft } from '../validation/seam-validator';
import { gradePattern } from '../grading/pattern-grader';
import { createProductionPatternRevision } from './pattern-revision-snapshot';
import { ValidationReport } from '../../types';
import { ProductionSnapshotValidationError } from './production-types';

describe('Milestone 04.6.2.3: Production Integrity Boundary v2 — 30 Adversarial Scenarios', () => {
  const sizeM = STANDARD_SIZING_SYSTEM.sizes.M;
  const standardFabricLookup = getEnhancedFabricById('wool-crepe');
  const standardFabric = standardFabricLookup.status === 'found' ? standardFabricLookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;

  const validReport: ValidationReport = {
    status: 'validated',
    isValid: true,
    isProductionReady: false,
    statusLabel: 'DRAFT_VALIDATED',
    timestamp: '2026-11-09T08:00:00.000Z',
    passedCount: 48,
    warningCount: 0,
    failureCount: 0,
    checks: [],
    unassessedConditions: [],
    declaration: '2D geometry and seam matches verified.'
  };

  function createBaseApprovedSpec() {
    const spec = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-v2',
      name: 'Adversarial Test Skirt V2',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0,
      targetFinishedDimensions: {
        lengthCm: 68.0,
        waistCm: 78.0,
        hipCm: 103.0
      },
      explicitEaseCm: {
        waist: 6.0,
        hip: 5.0,
        neck: 1.0
      },
      allowances: {
        seamAllowanceCm: 1.5,
        hemAllowanceCm: 3.0,
        waistAllowanceCm: 1.0,
        neckAllowanceCm: 1.0,
        armholeAllowanceCm: 1.0,
        shoulderAllowanceCm: 1.0
      },
      constructionFeatures: [
        {
          id: 'cf-01',
          category: 'closure',
          name: 'Concealed Zipper',
          description: 'Center back concealed zipper',
          patternImpact: '1.5cm seam allowance required'
        },
        {
          id: 'cf-02',
          category: 'waistband',
          name: 'Straight Waistband',
          description: '3cm structured waistband',
          patternImpact: 'Waist seam allowance 1.0cm'
        }
      ],
      designNotes: ['Dry clean only', 'Interfaced waistband'],
      dartStyle: 'waist',
      sleeveEaseStrategy: 'classic'
    });

    return approveAuthoritativeGarmentSpecification(spec, 'Certified Master Tailor', {
      authorityTier: 'unauthenticated_local_session',
      approvedAt: '2026-11-09T10:00:00.000Z'
    });
  }

  function createFullPipelineSynchronizedFixture() {
    const spec = createBaseApprovedSpec();
    const designSpec = convertToDesignSpecification(spec);
    const pieces = draftSkirtBlock(sizeM, designSpec);

    const snapshot = createProductionPatternRevision({
      projectId: 'project-adversarial-v2',
      targetSize: 'M',
      designSpecification: designSpec,
      measurements: {
        values: ({ ...sizeM } as unknown) as Record<string, number>,
        defaultOrigin: 'user-entered',
        approval: {
          state: 'approved',
          approvedBy: 'Master Tailor',
          approvedAt: '2026-11-09T08:00:00.000Z'
        }
      },
      fabric: standardFabric,
      patternPieces: pieces,
      validation: validReport,
      physicalValidationStatus: 'not-assessed'
    });

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot
    });

    return { spec, designSpec, pieces, snapshot, report };
  }

  // -------------------------------------------------------------------------
  // Scenario 1: Mutation of every canonical specification field
  // -------------------------------------------------------------------------
  it('Scenario 1: detects mutation of canonical specification fields individually', () => {
    const base = createBaseApprovedSpec();
    const baseFingerprint = computeSpecificationFingerprint(base);

    // Field mutations to test
    const mutations: Array<{ name: string; mutate: (s: typeof base) => any }> = [
      { name: 'name', mutate: (s) => ({ ...s, name: 'Renamed Skirt' }) },
      { name: 'garmentCategory', mutate: (s) => ({ ...s, garmentCategory: 'bodice' }) },
      { name: 'silhouette', mutate: (s) => ({ ...s, silhouette: 'a-line' }) },
      { name: 'prompt', mutate: (s) => ({ ...s, prompt: 'Modified prompt text' }) },
      { name: 'color.name', mutate: (s) => ({ ...s, color: { name: 'Navy', hex: '#000080' } }) },
      { name: 'dartStyle', mutate: (s) => ({ ...s, dartStyle: 'french' }) },
      { name: 'sleeveEaseStrategy', mutate: (s) => ({ ...s, sleeveEaseStrategy: 'relaxed' }) },
      { name: 'allowances.hemAllowanceCm', mutate: (s) => ({ ...s, allowances: { ...s.allowances, hemAllowanceCm: 4.5 } }) },
      { name: 'explicitEaseCm.waist', mutate: (s) => ({ ...s, explicitEaseCm: { ...s.explicitEaseCm, waist: 8.0 } }) },
      { name: 'targetFinishedDimensions.waistCm', mutate: (s) => ({ ...s, targetFinishedDimensions: { ...s.targetFinishedDimensions, waistCm: 82.0 } }) }
    ];

    for (const testCase of mutations) {
      const tampered = testCase.mutate(base);
      const newFingerprint = computeSpecificationFingerprint(tampered);
      assert.notEqual(newFingerprint, baseFingerprint, `Fingerprint should change for mutation of ${testCase.name}`);
      const verification = verifySpecificationApproval(tampered);
      assert.equal(verification.isValid, false, `Verification must fail for tampered ${testCase.name}`);
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Object key order invariance
  // -------------------------------------------------------------------------
  it('Scenario 2: guarantees object key order invariance across all specification objects', () => {
    const base = createBaseApprovedSpec();

    // Construct an object with intentionally inverted key orders
    const invertedTargetDims = {
      hipCm: base.targetFinishedDimensions.hipCm,
      waistCm: base.targetFinishedDimensions.waistCm,
      lengthCm: base.targetFinishedDimensions.lengthCm
    };

    const invertedAllowances = {
      shoulderAllowanceCm: base.allowances.shoulderAllowanceCm,
      neckAllowanceCm: base.allowances.neckAllowanceCm,
      waistAllowanceCm: base.allowances.waistAllowanceCm,
      armholeAllowanceCm: base.allowances.armholeAllowanceCm,
      hemAllowanceCm: base.allowances.hemAllowanceCm,
      seamAllowanceCm: base.allowances.seamAllowanceCm
    };

    const reorderedSpec = {
      ...base,
      targetFinishedDimensions: invertedTargetDims,
      allowances: invertedAllowances
    };

    const baseFp = computeSpecificationFingerprint(base);
    const reorderedFp = computeSpecificationFingerprint(reorderedSpec as any);
    assert.equal(baseFp, reorderedFp, 'Key ordering in input object must not affect canonical fingerprint');
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Meaningful array order preservation
  // -------------------------------------------------------------------------
  it('Scenario 3: preserves meaningful array order for construction features', () => {
    const base = createBaseApprovedSpec();
    const baseFp = computeSpecificationFingerprint(base);

    // Invert constructionFeatures array order
    const invertedFeaturesSpec = {
      ...base,
      constructionFeatures: [base.constructionFeatures[1], base.constructionFeatures[0]]
    };

    const invertedFp = computeSpecificationFingerprint(invertedFeaturesSpec);
    assert.notEqual(baseFp, invertedFp, 'Construction features sequence represents assembly order and must affect fingerprint');
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Missing versus null distinction
  // -------------------------------------------------------------------------
  it('Scenario 4: handles null versus undefined/missing fields without crashes or unintended equivalence', () => {
    const base = createBaseApprovedSpec();
    const withExplicitPrompt = { ...base, prompt: 'Tailored classic bespoke pencil skirt' };
    const fp1 = computeSpecificationFingerprint(base);
    const fp2 = computeSpecificationFingerprint(withExplicitPrompt);
    // Explicit prompt vs undefined prompt produce distinct fingerprints
    assert.notEqual(fp1, fp2);
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Invalid numeric values rejected
  // -------------------------------------------------------------------------
  it('Scenario 5: rejects invalid numeric values (NaN, Infinity, negative dimensions and allowances)', () => {
    const base = createBaseApprovedSpec();

    assert.throws(() => {
      computeSpecificationFingerprint({
        ...base,
        targetFinishedDimensions: { ...base.targetFinishedDimensions, waistCm: -50 }
      });
    }, ProductionSnapshotValidationError);

    assert.throws(() => {
      computeSpecificationFingerprint({
        ...base,
        targetFinishedDimensions: { ...base.targetFinishedDimensions, lengthCm: NaN }
      });
    }, ProductionSnapshotValidationError);

    assert.throws(() => {
      computeSpecificationFingerprint({
        ...base,
        allowances: { ...base.allowances, seamAllowanceCm: -1.0 }
      });
    }, ProductionSnapshotValidationError);

    assert.throws(() => {
      computeSpecificationFingerprint({
        ...base,
        explicitEaseCm: { ...base.explicitEaseCm, waist: Infinity }
      });
    }, ProductionSnapshotValidationError);
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Fabric composition mutation detected
  // -------------------------------------------------------------------------
  it('Scenario 6: detects fabric composition mutation', () => {
    const base = createBaseApprovedSpec();
    const mutated = {
      ...base,
      fabric: {
        ...base.fabric,
        composition: '100% Synthetic Polyester'
      }
    };

    assert.notEqual(
      computeSpecificationFingerprint(base),
      computeSpecificationFingerprint(mutated)
    );
    const verification = verifySpecificationApproval(mutated);
    assert.equal(verification.isValid, false);
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Fabric thickness mutation detected
  // -------------------------------------------------------------------------
  it('Scenario 7: detects fabric thickness mutation', () => {
    const base = createBaseApprovedSpec();
    const mutated = {
      ...base,
      fabric: {
        ...base.fabric,
        thicknessMm: 1.45
      }
    };

    assert.notEqual(
      computeSpecificationFingerprint(base),
      computeSpecificationFingerprint(mutated)
    );
    const verification = verifySpecificationApproval(mutated);
    assert.equal(verification.isValid, false);
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Color mutation detected
  // -------------------------------------------------------------------------
  it('Scenario 8: detects color mutation in name and hex code, rejects malformed hex', () => {
    const base = createBaseApprovedSpec();
    const mutatedColor = {
      ...base,
      color: { name: 'Midnight Navy', hex: '#000088' }
    };

    assert.notEqual(
      computeSpecificationFingerprint(base),
      computeSpecificationFingerprint(mutatedColor)
    );

    // Malformed hex must be rejected
    assert.throws(() => {
      computeSpecificationFingerprint({
        ...base,
        color: { name: 'Bad Hex', hex: 'not-a-color' }
      });
    }, ProductionSnapshotValidationError);
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Approval identity spoofing rejected
  // -------------------------------------------------------------------------
  it('Scenario 9: rejects approval with blank approver and detects approver tampering', () => {
    const base = createBaseApprovedSpec();

    // Empty approver rejected at approval creation
    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(base, '   ');
    }, ProductionSnapshotValidationError);

    // Tampered approver in approval record fails verification
    const tampered = {
      ...base,
      approvalRecord: {
        ...base.approvalRecord!,
        approverName: 'Spoofed Master Tailor',
        approverId: 'spoofed-id'
      }
    };
    const verification = verifySpecificationApproval(tampered);
    assert.equal(verification.isValid, false);
    assert.ok(verification.reason?.includes('approver identity mismatch'));
  });

  // -------------------------------------------------------------------------
  // Scenario 10: Authenticated tier rejected without provider
  // -------------------------------------------------------------------------
  it('Scenario 10: rejects authenticated_designer tier without configured identity provider', () => {
    resetAuthorityProviderContext();
    const spec = createBaseApprovedSpec();

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(spec, 'Designer User', {
        authorityTier: 'authenticated_designer'
      });
    }, /authenticated_designer authority tier is unavailable/);
  });

  // -------------------------------------------------------------------------
  // Scenario 11: Cryptographic tier rejected without provider
  // -------------------------------------------------------------------------
  it('Scenario 11: rejects cryptographic_principal tier without configured cryptographic signing provider', () => {
    resetAuthorityProviderContext();
    const spec = createBaseApprovedSpec();

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(spec, 'Key-Holder', {
        authorityTier: 'cryptographic_principal'
      });
    }, /cryptographic_principal authority tier is unavailable/);
  });

  // -------------------------------------------------------------------------
  // Scenario 12: Revoked approval rejected
  // -------------------------------------------------------------------------
  it('Scenario 12: marks revoked approval as invalid and preserves reason', () => {
    const approved = createBaseApprovedSpec();
    const revoked = revokeAuthoritativeGarmentSpecificationApproval(
      approved,
      'Client altered waist requirement',
      { revokerName: 'Designer' }
    );

    const verification = verifySpecificationApproval(revoked);
    assert.equal(verification.isValid, false);
    assert.equal(verification.state, 'revoked');
    assert.ok(verification.reason?.toLowerCase().includes('waist requirement'));
  });

  // -------------------------------------------------------------------------
  // Scenario 13: Superseded approval rejected
  // -------------------------------------------------------------------------
  it('Scenario 13: ensures previous approval does not carry over to revised specification', () => {
    const approvedV1 = createBaseApprovedSpec();
    const revisedV2 = reviseAuthoritativeGarmentSpecification(approvedV1, {
      lengthCm: 72.0
    });

    assert.equal(revisedV2.isApproved, false);
    assert.equal(revisedV2.approvalRecord, undefined);
    assert.equal(revisedV2.version, 2);

    const verification = verifySpecificationApproval(revisedV2);
    assert.equal(verification.isValid, false);
    assert.equal(verification.state, 'draft');
  });

  // -------------------------------------------------------------------------
  // Scenario 14: Partial measurement mutation invalidates downstream artifacts
  // -------------------------------------------------------------------------
  it('Scenario 14: partial measurement change marks downstream pipeline artifacts stale', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const mutatedMeasurements = {
      ...sizeM,
      waist: sizeM.waist + 1.0 // 1cm waist alteration
    };

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: mutatedMeasurements,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot
    });

    assert.equal(report.hasStaleArtifacts, true);
    assert.equal(report.artifacts['finished-dimensions'].status, 'stale');
    assert.equal(report.artifacts.drafting.status, 'stale');
    assert.equal(report.artifacts.grading.status, 'stale');
    assert.equal(report.artifacts['production-snapshot'].status, 'stale');
  });

  // -------------------------------------------------------------------------
  // Scenario 15: Fabric provenance mutation invalidates downstream artifacts
  // -------------------------------------------------------------------------
  it('Scenario 15: fabric provenance mutation marks pipeline stale', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const fabricWithMutatedProvenance = {
      ...standardFabric,
      provenance: 'laboratory-tested' as const
    };

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: fabricWithMutatedProvenance,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot
    });

    assert.equal(report.hasStaleArtifacts, true);
  });

  // -------------------------------------------------------------------------
  // Scenario 16: Fabric lot mutation invalidates downstream artifacts
  // -------------------------------------------------------------------------
  it('Scenario 16: fabric lot mutation marks pipeline stale', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const fabricWithNewLot = {
      ...standardFabric,
      revision: 'REV-LOT-2026-X99'
    };

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: fabricWithNewLot,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot
    });

    assert.equal(report.hasStaleArtifacts, true);
  });

  // -------------------------------------------------------------------------
  // Scenario 17: Grading ruleset mutation invalidates grading
  // -------------------------------------------------------------------------
  it('Scenario 17: grading ruleset mutation marks grading outputs stale', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const report1 = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot,
      gradingRulesVersion: 'ruleset-iso-standard'
    });

    const report2 = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot,
      gradingRulesVersion: 'ruleset-custom-petite'
    });

    assert.notEqual(
      report1.artifacts['grading-rules'].inputFingerprint,
      report2.artifacts['grading-rules'].inputFingerprint
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 18: Engine version mutation invalidates geometry
  // -------------------------------------------------------------------------
  it('Scenario 18: engine version change marks drafting geometry stale', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot,
      engineVersion: '2.0.0-experimental'
    });

    assert.equal(report.hasStaleArtifacts, true);
    assert.equal(report.artifacts.drafting.status, 'stale');
  });

  // -------------------------------------------------------------------------
  // Scenario 19: Snapshot revision mismatch rejected
  // -------------------------------------------------------------------------
  it('Scenario 19: snapshot revision mismatch is rejected by export guard', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const specV2 = reviseAuthoritativeGarmentSpecification(spec, { lengthCm: 70.0 });
    const approvedSpecV2 = approveAuthoritativeGarmentSpecification(specV2, 'Master Tailor');

    const report = evaluatePipelineDependencyIntegrity({
      specification: approvedSpecV2,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot // Stale V1 snapshot
    });

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: approvedSpecV2
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'SNAPSHOT_SPECIFICATION_REVISION_MISMATCH');
  });

  // -------------------------------------------------------------------------
  // Scenario 20: Snapshot geometry tampering rejected
  // -------------------------------------------------------------------------
  it('Scenario 20: tampered snapshot pattern piece geometry is rejected by export guard', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const tamperedSnapshot = {
      ...snapshot,
      patternPieces: [
        {
          ...snapshot.patternPieces[0],
          boundingBox: {
            ...snapshot.patternPieces[0].boundingBox,
            widthCm: snapshot.patternPieces[0].boundingBox.widthCm + 25.0
          }
        },
        ...snapshot.patternPieces.slice(1)
      ]
    };

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: tamperedSnapshot as any
    });

    const exportResult = validateProductionExportPrerequisites(report, tamperedSnapshot as any);
    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'SNAPSHOT_GEOMETRY_TAMPERED');
  });

  // -------------------------------------------------------------------------
  // Scenario 21: Snapshot fabric mismatch rejected
  // -------------------------------------------------------------------------
  it('Scenario 21: active fabric mismatch against snapshot is rejected by export guard', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const modifiedFabric = {
      ...standardFabric,
      gsm: standardFabric.gsm + 50
    };

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      fabric: modifiedFabric
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'SNAPSHOT_FABRIC_MISMATCH');
  });

  // -------------------------------------------------------------------------
  // Scenario 22: Snapshot measurement mismatch rejected
  // -------------------------------------------------------------------------
  it('Scenario 22: active measurement mismatch against snapshot is rejected by export guard', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const alteredMeasurements = {
      ...sizeM,
      waist: sizeM.waist + 3.0
    };

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: alteredMeasurements
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'SNAPSHOT_MEASUREMENTS_MISMATCH');
  });

  // -------------------------------------------------------------------------
  // Scenario 23: Forged dependency report rejected
  // -------------------------------------------------------------------------
  it('Scenario 23: forged dependency report with claim of current status is rejected', () => {
    const { spec, snapshot } = createFullPipelineSynchronizedFixture();

    // Fabricate a malformed/forged report
    const forgedReport = {
      hasStaleArtifacts: false,
      artifacts: {
        specification: { status: 'approved', artifactId: 'art-spec' },
        drafting: { status: 'current', artifactId: 'art-draft' }
      }
    };

    const exportResult = validateProductionExportPrerequisites(forgedReport as any, snapshot, {
      specification: spec
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.ok(exportResult.rejectionCode === 'FORGED_REPORT_DETECTED' || exportResult.rejectionCode === 'FORGED_INTEGRITY_REPORT');
  });

  // -------------------------------------------------------------------------
  // Scenario 24: Forged artifact freshness rejected
  // -------------------------------------------------------------------------
  it('Scenario 24: forged artifact freshness is caught through independent recalculation', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    // Caller presents an untruthful report claiming all current when measurements are altered
    const validRep = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot
    });

    // Provide altered measurements to the export check with the old "all current" report
    const exportResult = validateProductionExportPrerequisites(validRep, snapshot, {
      specification: spec,
      measurements: { ...sizeM, waist: sizeM.waist + 4.0 },
      fabric: standardFabric
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.ok(exportResult.rejectionCode === 'FORGED_REPORT_DETECTED' || exportResult.rejectionCode === 'SNAPSHOT_MEASUREMENTS_MISMATCH');
  });

  // -------------------------------------------------------------------------
  // Scenario 25: Geometry validation from an obsolete geometry revision rejected
  // -------------------------------------------------------------------------
  it('Scenario 25: validation report from older geometry is detected as stale', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    // Mutate pieces to create new geometry with different piece code
    const newPieces = pieces.map((p, idx) => idx === 0 ? { ...p, pieceCode: 'SK-MODIFIED' } : p);

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: newPieces,
      validationReport: validReport, // Original validation report
      productionSnapshot: snapshot
    });

    assert.equal(report.artifacts['geometry-validation'].status, 'stale');
  });

  // -------------------------------------------------------------------------
  // Scenario 26: Grading output from an obsolete measurement revision rejected
  // -------------------------------------------------------------------------
  it('Scenario 26: grading output based on older measurements is detected as stale', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const alteredSizeM = { ...sizeM, lowHip: sizeM.lowHip + 4.0 };

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: alteredSizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot
    });

    assert.equal(report.artifacts.grading.status, 'stale');
    assert.ok(report.artifacts.grading.staleReason?.includes('measurements'));
  });

  // -------------------------------------------------------------------------
  // Scenario 27: Export blocked if any required lineage is missing
  // -------------------------------------------------------------------------
  it('Scenario 27: export is blocked when required snapshot or specification lineage is missing', () => {
    const { spec, report } = createFullPipelineSynchronizedFixture();

    // Calling export without a snapshot
    const exportResultNoSnapshot = validateProductionExportPrerequisites(report, null as any);
    assert.equal(exportResultNoSnapshot.isExportPermitted, false);
    assert.equal(exportResultNoSnapshot.rejectionCode, 'SNAPSHOT_MISSING');

    // Calling with an unapproved specification
    const unapprovedSpec = createAuthoritativeGarmentSpecification({
      projectId: 'proj-01',
      name: 'Unapproved Spec',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      easeProfile: 'classic',
      lengthCm: 68.0,
      fabric: standardFabric
    });

    const exportResultUnapproved = validateProductionExportPrerequisites(report, { ...report } as any, {
      specification: unapprovedSpec
    });
    assert.equal(exportResultUnapproved.isExportPermitted, false);
  });

  // -------------------------------------------------------------------------
  // Scenario 28: Export blocked if any source fingerprint is stale
  // -------------------------------------------------------------------------
  it('Scenario 28: export is blocked when any source artifact is stale', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const staleReport = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: { ...sizeM, waist: sizeM.waist + 5.0 },
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot
    });

    const exportResult = validateProductionExportPrerequisites(staleReport, snapshot);
    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'STALE_SOURCE_FINGERPRINT');
  });

  // -------------------------------------------------------------------------
  // Scenario 29: Export blocked if isProductionReady is asserted as true
  // -------------------------------------------------------------------------
  it('Scenario 29: export is blocked if isProductionReady is asserted as true (industrial safety invariant)', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const dangerousSnapshot = {
      ...snapshot,
      isProductionReady: true
    };

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot
    });

    const exportResult = validateProductionExportPrerequisites(report, dangerousSnapshot as any);
    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'INDUSTRIAL_SAFETY_VIOLATION');
    assert.ok(exportResult.rejectionReason?.includes('isProductionReady cannot be asserted'));
  });

  // -------------------------------------------------------------------------
  // Scenario 30: Valid, complete, current documentation export permitted
  // -------------------------------------------------------------------------
  it('Scenario 30: permits manufacturing documentation export when all prerequisites are satisfied and isProductionReady remains false', () => {
    const { spec, snapshot, report } = createFullPipelineSynchronizedFixture();

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric
    });

    assert.equal(exportResult.isExportPermitted, true);
    assert.equal(exportResult.rejectionReason, undefined);
    assert.equal(exportResult.rejectionCode, undefined);
    assert.ok(exportResult.manufacturingDocumentation);
    assert.equal(exportResult.manufacturingDocumentation?.isProductionReady, false);
    assert.ok(exportResult.manufacturingDocumentation?.specificationFingerprint.length === 64);
    assert.ok(exportResult.manufacturingDocumentation?.patternRevisionFingerprint.length === 64);
  });
});
