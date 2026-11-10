/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuthoritativeGarmentSpecification,
  reviseAuthoritativeGarmentSpecification,
  supersedeAuthoritativeGarmentSpecification,
  approveAuthoritativeGarmentSpecification,
  revokeAuthoritativeGarmentSpecificationApproval,
  computeSpecificationFingerprint,
  canonicalizeSpecificationPayload,
  verifySpecificationApproval,
  convertToDesignSpecification,
  setAuthorityProviderContext,
  getAuthorityProviderContext,
  resetAuthorityProviderContext,
  issueVerifiableIdentityCredential,
  createTrustedIdentityVerifier,
  signSpecificationApprovalPayload,
  createTrustedCryptographicVerifier
} from './garment-specification';
import { SPECIFICATION_CANONICAL_SCHEMA_VERSION } from './garment-specification-types';

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
import {
  createProductionPatternRevision,
  createAuthoritativeMeasurementSet,
  approveAuthoritativeMeasurementSet,
  supersedeAuthoritativeMeasurementSet,
  verifyMeasurementSetIntegrity
} from './pattern-revision-snapshot';
import { ValidationReport } from '../../types';
import {
  ProductionSnapshotMeasurementError,
  ProductionSnapshotValidationError
} from './production-types';

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
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, true);
    assert.equal(exportResult.rejectionReason, undefined);
    assert.equal(exportResult.rejectionCode, undefined);
    assert.ok(exportResult.manufacturingDocumentation);
    assert.equal(exportResult.manufacturingDocumentation?.isProductionReady, false);
    assert.ok(exportResult.manufacturingDocumentation?.specificationFingerprint.length === 64);
    assert.ok(exportResult.manufacturingDocumentation?.patternRevisionFingerprint.length === 64);
  });

  // =========================================================================
  // MILESTONE 04.6.2.3.1 — CORRECTION H: 36 TARGETED ADVERSARIAL & CONTROL TESTS
  // =========================================================================

  // -------------------------------------------------------------------------
  // Scenario 31: Privilege elevation via global boolean flag is blocked
  // -------------------------------------------------------------------------
  it('Scenario 31: rejects privilege elevation attempt via setAuthorityProviderContext global boolean flags', () => {
    setAuthorityProviderContext({
      identityProviderConfigured: true,
      cryptographicProviderConfigured: true
    });

    const ctx = getAuthorityProviderContext();
    assert.equal(ctx.identityProviderConfigured, false);
    assert.equal(ctx.cryptographicProviderConfigured, false);

    const spec = createBaseApprovedSpec();
    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(spec, 'Attacker', {
        authorityTier: 'authenticated_designer'
      });
    }, /TrustedIdentityVerifier/);

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(spec, 'Attacker', {
        authorityTier: 'cryptographic_principal'
      });
    }, /TrustedCryptographicVerifier/);
  });

  // -------------------------------------------------------------------------
  // Scenario 32: Fake authenticated approval without credential rejected
  // -------------------------------------------------------------------------
  it('Scenario 32: rejects authenticated_designer approval when verifier is supplied without credential', () => {
    const spec = createBaseApprovedSpec();
    const verifier = createTrustedIdentityVerifier({
      trustedIssuer: 'https://auth.patroner.internal',
      expectedAudience: 'patroner-spec-approval',
      sharedSecret: 'secret-key-01'
    });

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(spec, 'Master Designer', {
        authorityTier: 'authenticated_designer',
        identityVerifier: verifier
        // identityCredential intentionally omitted
      });
    }, /VerifiableIdentityCredential/);
  });

  // -------------------------------------------------------------------------
  // Scenario 33: Fake cryptographic approval without signature rejected
  // -------------------------------------------------------------------------
  it('Scenario 33: rejects cryptographic_principal approval when verifier is supplied without signature', () => {
    const spec = createBaseApprovedSpec();
    const verifier = createTrustedCryptographicVerifier({
      trustedKeys: { 'key-prod-01': 'signing-secret-01' }
    });

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(spec, 'principal-tailor-01', {
        authorityTier: 'cryptographic_principal',
        cryptographicVerifier: verifier
        // cryptographicSignature intentionally omitted
      });
    }, /VerifiableCryptographicSignature/);
  });

  // -------------------------------------------------------------------------
  // Scenario 34: Invalid cryptographic signature rejected
  // -------------------------------------------------------------------------
  it('Scenario 34: rejects cryptographic_principal approval when signature digest is forged or invalid', () => {
    const draftSpec = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-v2',
      name: 'Crypto Signed Skirt',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0
    });

    const verifier = createTrustedCryptographicVerifier({
      trustedKeys: { 'key-prod-01': 'signing-secret-01' }
    });

    const forgedSig = signSpecificationApprovalPayload(
      {
        projectId: draftSpec.projectId,
        garmentId: draftSpec.garmentId,
        specificationRevisionId: draftSpec.specificationRevisionId,
        specificationVersion: draftSpec.version,
        canonicalSpecificationFingerprint: computeSpecificationFingerprint(draftSpec),
        approvalEventId: 'evt-crypto-1',
        approverPrincipal: 'principal-tailor-01',
        authorityTier: 'cryptographic_principal',
        approvalTimestamp: '2026-11-10T10:00:00.000Z',
        schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION
      },
      { keyId: 'key-prod-01', signingKeyMaterial: 'WRONG-SECRET-KEY' }
    );

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(draftSpec, 'principal-tailor-01', {
        authorityTier: 'cryptographic_principal',
        approvalEventId: 'evt-crypto-1',
        approvedAt: '2026-11-10T10:00:00.000Z',
        cryptographicSignature: forgedSig,
        cryptographicVerifier: verifier
      });
    }, /Cryptographic signature verification failed/);
  });

  // -------------------------------------------------------------------------
  // Scenario 35: Valid signature over wrong specification fingerprint rejected
  // -------------------------------------------------------------------------
  it('Scenario 35: rejects valid cryptographic signature bound to a different specification fingerprint', () => {
    const draftSpec1 = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-v2',
      name: 'Skirt Spec A',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0
    });
    const draftSpec2 = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-v2',
      name: 'Skirt Spec B',
      garmentCategory: 'skirt',
      silhouette: 'a-line',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 72.0
    });

    const verifier = createTrustedCryptographicVerifier({
      trustedKeys: { 'key-prod-01': 'signing-secret-01' }
    });

    // Sign draftSpec1's fingerprint, but attempt to attach to draftSpec2
    const sigOverSpec1 = signSpecificationApprovalPayload(
      {
        projectId: draftSpec2.projectId,
        garmentId: draftSpec2.garmentId,
        specificationRevisionId: draftSpec2.specificationRevisionId,
        specificationVersion: draftSpec2.version,
        canonicalSpecificationFingerprint: computeSpecificationFingerprint(draftSpec1),
        approvalEventId: 'evt-crypto-replay',
        approverPrincipal: 'principal-tailor-01',
        authorityTier: 'cryptographic_principal',
        approvalTimestamp: '2026-11-10T10:00:00.000Z',
        schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION
      },
      { keyId: 'key-prod-01', signingKeyMaterial: 'signing-secret-01' }
    );

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(draftSpec2, 'principal-tailor-01', {
        authorityTier: 'cryptographic_principal',
        approvalEventId: 'evt-crypto-replay',
        approvedAt: '2026-11-10T10:00:00.000Z',
        cryptographicSignature: sigOverSpec1,
        cryptographicVerifier: verifier
      });
    }, /Cryptographic signature verification failed/);
  });

  // -------------------------------------------------------------------------
  // Scenario 36: Valid signature over wrong revision ID rejected
  // -------------------------------------------------------------------------
  it('Scenario 36: rejects valid cryptographic signature bound to a different specificationRevisionId', () => {
    const draftSpec = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-v2',
      specificationRevisionId: 'rev-correct-01',
      name: 'Skirt Spec',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0
    });

    const verifier = createTrustedCryptographicVerifier({
      trustedKeys: { 'key-prod-01': 'signing-secret-01' }
    });

    const sigWrongRev = signSpecificationApprovalPayload(
      {
        projectId: draftSpec.projectId,
        garmentId: draftSpec.garmentId,
        specificationRevisionId: 'rev-wrong-99',
        specificationVersion: draftSpec.version,
        canonicalSpecificationFingerprint: computeSpecificationFingerprint(draftSpec),
        approvalEventId: 'evt-crypto-rev',
        approverPrincipal: 'principal-tailor-01',
        authorityTier: 'cryptographic_principal',
        approvalTimestamp: '2026-11-10T10:00:00.000Z',
        schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION
      },
      { keyId: 'key-prod-01', signingKeyMaterial: 'signing-secret-01' }
    );

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(draftSpec, 'principal-tailor-01', {
        authorityTier: 'cryptographic_principal',
        approvalEventId: 'evt-crypto-rev',
        approvedAt: '2026-11-10T10:00:00.000Z',
        cryptographicSignature: sigWrongRev,
        cryptographicVerifier: verifier
      });
    }, /Cryptographic signature verification failed/);
  });

  // -------------------------------------------------------------------------
  // Scenario 37: Expired identity token rejected
  // -------------------------------------------------------------------------
  it('Scenario 37: rejects authenticated_designer approval when identity token is expired', () => {
    const draftSpec = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-v2',
      name: 'Auth Skirt',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0
    });

    const verifier = createTrustedIdentityVerifier({
      trustedIssuer: 'https://auth.patroner.internal',
      expectedAudience: 'patroner-spec-approval',
      sharedSecret: 'idp-secret-01',
      referenceTimeIso: '2026-11-10T12:00:00.000Z'
    });

    const expiredCred = issueVerifiableIdentityCredential(
      {
        subjectId: 'usr-designer-42',
        displayName: 'Elena Rostova',
        issuer: 'https://auth.patroner.internal',
        audience: 'patroner-spec-approval',
        issuedAt: '2026-11-10T08:00:00.000Z',
        expiresAt: '2026-11-10T09:00:00.000Z', // Expired 3 hours before referenceTimeIso
        claims: ['specification:approve']
      },
      'idp-secret-01'
    );

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(draftSpec, 'Elena Rostova', {
        authorityTier: 'authenticated_designer',
        approverId: 'usr-designer-42',
        approvedAt: '2026-11-10T12:00:00.000Z',
        identityCredential: expiredCred,
        identityVerifier: verifier
      });
    }, /expired/);
  });

  // -------------------------------------------------------------------------
  // Scenario 38: Wrong identity subject rejected
  // -------------------------------------------------------------------------
  it('Scenario 38: rejects authenticated_designer approval when credential subject does not match approver', () => {
    const draftSpec = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-v2',
      name: 'Auth Skirt',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0
    });

    const verifier = createTrustedIdentityVerifier({
      trustedIssuer: 'https://auth.patroner.internal',
      expectedAudience: 'patroner-spec-approval',
      sharedSecret: 'idp-secret-01',
      referenceTimeIso: '2026-11-10T10:00:00.000Z'
    });

    const aliceCred = issueVerifiableIdentityCredential(
      {
        subjectId: 'usr-alice-01',
        displayName: 'Alice Designer',
        issuer: 'https://auth.patroner.internal',
        audience: 'patroner-spec-approval',
        issuedAt: '2026-11-10T09:00:00.000Z',
        expiresAt: '2026-11-10T14:00:00.000Z',
        claims: ['specification:approve']
      },
      'idp-secret-01'
    );

    // Attempt to approve as Bob using Alice's credential
    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(draftSpec, 'Bob Impersonator', {
        authorityTier: 'authenticated_designer',
        approverId: 'usr-bob-99',
        approvedAt: '2026-11-10T10:00:00.000Z',
        identityCredential: aliceCred,
        identityVerifier: verifier
      });
    }, /does not match requested approver/);
  });

  // -------------------------------------------------------------------------
  // Scenario 39: Revoked approval with forced isApproved: true rejected
  // -------------------------------------------------------------------------
  it('Scenario 39: rejects revoked specification even if caller forces isApproved: true and approvalState: approved', () => {
    const approved = createBaseApprovedSpec();
    const revoked = revokeAuthoritativeGarmentSpecificationApproval(approved, 'Pattern defect discovered');

    // Attacker forces boolean flags back to approved without clearing append-only lifecycleHistory
    const manipulated = {
      ...revoked,
      isApproved: true,
      approvalState: 'approved' as const,
      approvalRecord: {
        ...approved.approvalRecord!,
        revocationReason: undefined
      }
    };

    const verification = verifySpecificationApproval(manipulated);
    assert.equal(verification.isValid, false);
    assert.equal(verification.state, 'revoked');
  });

  // -------------------------------------------------------------------------
  // Scenario 40: Superseded revision with forced isApproved: true rejected
  // -------------------------------------------------------------------------
  it('Scenario 40: rejects superseded specification revision even if isApproved: true is preserved or forced', () => {
    const approvedV1 = createBaseApprovedSpec();
    const { supersededSpec, nextRevision } = supersedeAuthoritativeGarmentSpecification(approvedV1, {
      lengthCm: 74.0
    });

    assert.equal(supersededSpec.approvalState, 'superseded');
    assert.equal(supersededSpec.supersededByRevisionId, nextRevision.specificationRevisionId);

    // Attacker forces isApproved: true and approvalState: 'approved' on supersededSpec
    const manipulatedV1 = {
      ...supersededSpec,
      isApproved: true,
      approvalState: 'approved' as const
    };

    const verification = verifySpecificationApproval(manipulatedV1);
    assert.equal(verification.isValid, false);
    assert.equal(verification.state, 'superseded');
  });

  // -------------------------------------------------------------------------
  // Scenario 41: Omitted activeInputs in export verification rejected
  // -------------------------------------------------------------------------
  it('Scenario 41: rejects export when activeInputs is omitted even if report and snapshot appear valid', () => {
    const { snapshot, report } = createFullPipelineSynchronizedFixture();

    const exportResult = validateProductionExportPrerequisites(report, snapshot);
    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'MISSING_ACTIVE_INPUTS');
  });

  // -------------------------------------------------------------------------
  // Scenario 42: Partial activeInputs in export verification rejected
  // -------------------------------------------------------------------------
  it('Scenario 42: rejects export when activeInputs omits patternPieces or validationReport', () => {
    const { spec, snapshot, report } = createFullPipelineSynchronizedFixture();

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric
      // patternPieces and validationReport omitted
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'MISSING_ACTIVE_INPUTS');
  });

  // -------------------------------------------------------------------------
  // Scenario 43: Forged PipelineIntegrityReport revisionId rejected
  // -------------------------------------------------------------------------
  it('Scenario 43: rejects export when PipelineIntegrityReport contains a forged artifact revisionId', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const forgedReport = {
      ...report,
      artifacts: {
        ...report.artifacts,
        drafting: {
          ...report.artifacts.drafting,
          revisionId: 'draft-forged-rev-999'
        }
      }
    };

    const exportResult = validateProductionExportPrerequisites(forgedReport, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'FORGED_REPORT_DETECTED');
  });

  // -------------------------------------------------------------------------
  // Scenario 44: Forged generatedContentFingerprint rejected
  // -------------------------------------------------------------------------
  it('Scenario 44: rejects export when PipelineIntegrityReport contains a forged generatedContentFingerprint', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const forgedReport = {
      ...report,
      artifacts: {
        ...report.artifacts,
        'geometry-validation': {
          ...report.artifacts['geometry-validation'],
          generatedContentFingerprint: '0'.repeat(64)
        }
      }
    };

    const exportResult = validateProductionExportPrerequisites(forgedReport, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'FORGED_REPORT_DETECTED');
  });

  // -------------------------------------------------------------------------
  // Scenario 45: Forged upstreamDependencies rejected
  // -------------------------------------------------------------------------
  it('Scenario 45: rejects export when PipelineIntegrityReport contains forged upstreamDependencies', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const forgedReport = {
      ...report,
      artifacts: {
        ...report.artifacts,
        grading: {
          ...report.artifacts.grading,
          upstreamDependencies: [] // Forged empty dependencies
        }
      }
    };

    const exportResult = validateProductionExportPrerequisites(forgedReport, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'FORGED_REPORT_DETECTED');
  });

  // -------------------------------------------------------------------------
  // Scenario 46: Forged engineVersion in PipelineIntegrityReport rejected
  // -------------------------------------------------------------------------
  it('Scenario 46: rejects export when PipelineIntegrityReport contains a forged engineVersion on an artifact', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const forgedReport = {
      ...report,
      artifacts: {
        ...report.artifacts,
        drafting: {
          ...report.artifacts.drafting,
          engineVersion: '9.9.9-spoofed'
        }
      }
    };

    const exportResult = validateProductionExportPrerequisites(forgedReport, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'FORGED_REPORT_DETECTED');
  });

  // -------------------------------------------------------------------------
  // Scenario 47: Missing isMeasurementApproved never defaults to approved
  // -------------------------------------------------------------------------
  it('Scenario 47: missing measurement approval defaults to unverified and blocks export', () => {
    const spec = createBaseApprovedSpec();
    const pieces = draftSkirtBlock(sizeM, convertToDesignSpecification(spec));

    // Evaluate without productionSnapshot, measurementSet, or isMeasurementApproved
    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(report.artifacts.measurements.validationStatus, 'unverified');
    assert.equal(report.canExportProductionDocumentation, false);
  });

  // -------------------------------------------------------------------------
  // Scenario 48: Unapproved measurement set blocks export
  // -------------------------------------------------------------------------
  it('Scenario 48: rejects export when authoritative measurement set is unverified or pending', () => {
    const { spec, pieces, snapshot } = createFullPipelineSynchronizedFixture();

    const unapprovedMeasSet = createAuthoritativeMeasurementSet({
      measurementSetId: 'ms-01',
      revisionId: 'ms-01-rev-1',
      values: ({ ...sizeM } as unknown) as Record<string, number>,
      source: 'user-entered',
      provenance: 'user-entered',
      approvalState: 'unverified'
    });

    const report = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: sizeM,
      measurementSet: unapprovedMeasSet,
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      productionSnapshot: snapshot
    });

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      measurementSet: unapprovedMeasSet,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'MEASUREMENT_UNAPPROVED');
  });

  // -------------------------------------------------------------------------
  // Scenario 49: AI-estimated measurement marked approved rejected
  // -------------------------------------------------------------------------
  it('Scenario 49: rejects marking AI-estimated measurements as approved physical or authoritative measurements', () => {
    assert.throws(() => {
      createAuthoritativeMeasurementSet({
        measurementSetId: 'ms-ai-01',
        revisionId: 'ms-ai-rev-1',
        values: ({ ...sizeM } as unknown) as Record<string, number>,
        source: 'ai-estimated',
        provenance: 'ai-estimated',
        approvalState: 'approved',
        approvingAuthority: 'Operator',
        approvedAt: '2026-11-10T10:00:00.000Z'
      });
    }, ProductionSnapshotMeasurementError);

    // Even if passed via measurementProvenance in export check, it is rejected
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();
    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      measurementProvenance: 'ai-estimated',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'AI_MEASUREMENT_NOT_PERMITTED');
  });

  // -------------------------------------------------------------------------
  // Scenario 50: Missing measurement provenance rejected
  // -------------------------------------------------------------------------
  it('Scenario 50: rejects measurement approval and production export when measurement provenance is unknown', () => {
    const measUnknown = createAuthoritativeMeasurementSet({
      measurementSetId: 'ms-unk-01',
      revisionId: 'ms-unk-rev-1',
      values: ({ ...sizeM } as unknown) as Record<string, number>
      // provenance omitted -> defaults to 'unknown'
    });

    assert.equal(measUnknown.provenance, 'unknown');
    assert.equal(measUnknown.approvalState, 'unverified');

    assert.throws(() => {
      approveAuthoritativeMeasurementSet(measUnknown, {
        approvingAuthority: 'Master Tailor',
        approvedAt: '2026-11-10T10:00:00.000Z'
      });
    }, ProductionSnapshotMeasurementError);

    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();
    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      measurementSet: measUnknown,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'MISSING_MEASUREMENT_PROVENANCE');
  });

  // -------------------------------------------------------------------------
  // Scenario 51: Missing fabric provenance rejected
  // -------------------------------------------------------------------------
  it('Scenario 51: rejects production export when fabric provenance is unknown or unverified', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const unknownProvFabric = {
      ...standardFabric,
      provenance: 'unknown' as const
    };

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: unknownProvFabric as any,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.ok(
      exportResult.rejectionCode === 'MISSING_FABRIC_PROVENANCE' ||
      exportResult.rejectionCode === 'SNAPSHOT_FABRIC_MISMATCH'
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 52: Silent default substitution attempt rejected in canonicalization
  // -------------------------------------------------------------------------
  it('Scenario 52: rejects specification canonicalization when mandatory engineering fields are missing instead of substituting defaults', () => {
    const base = createBaseApprovedSpec();

    assert.throws(() => {
      canonicalizeSpecificationPayload({
        ...base,
        name: '' // Empty name must not default to 'Untitled Specification'
      });
    }, ProductionSnapshotValidationError);

    assert.throws(() => {
      canonicalizeSpecificationPayload({
        ...base,
        garmentCategory: undefined as any // Missing category must not default to 'skirt'
      });
    }, ProductionSnapshotValidationError);

    assert.throws(() => {
      canonicalizeSpecificationPayload({
        ...base,
        fabric: undefined as any // Missing fabric must not default to 'unknown-fabric'
      });
    }, ProductionSnapshotValidationError);
  });

  // -------------------------------------------------------------------------
  // Scenario 53: Missing vs null vs explicit value distinction in canonicalization
  // -------------------------------------------------------------------------
  it('Scenario 53: distinguishes missing (undefined), explicit null, and explicit value in canonical specification fingerprint', () => {
    const base = createBaseApprovedSpec();

    const specMissingPrompt = { ...base };
    delete (specMissingPrompt as any).prompt;

    const specNullPrompt = { ...base, prompt: null as any };
    const specValuePrompt = { ...base, prompt: 'Structured Couture Skirt' };

    const fpMissing = computeSpecificationFingerprint(specMissingPrompt);
    const fpNull = computeSpecificationFingerprint(specNullPrompt);
    const fpValue = computeSpecificationFingerprint(specValuePrompt);

    assert.notEqual(fpMissing, fpNull, 'Missing field (__MISSING__) must not hash identically to explicit null');
    assert.notEqual(fpNull, fpValue, 'Explicit null must not hash identically to explicit string value');
    assert.notEqual(fpMissing, fpValue, 'Missing field must not hash identically to explicit string value');
  });

  // -------------------------------------------------------------------------
  // Scenario 54: Unknown specification field preservation in canonicalization
  // -------------------------------------------------------------------------
  it('Scenario 54: includes unknown additional engineering fields in canonical specification fingerprint without silently discarding them', () => {
    const base = createBaseApprovedSpec();
    const withCustomFieldA = {
      ...base,
      interliningSpecification: 'horsehair-canvas-180gsm'
    } as any;
    const withCustomFieldB = {
      ...base,
      interliningSpecification: 'fusible-tricotine-90gsm'
    } as any;

    const fpBase = computeSpecificationFingerprint(base);
    const fpA = computeSpecificationFingerprint(withCustomFieldA);
    const fpB = computeSpecificationFingerprint(withCustomFieldB);

    assert.notEqual(fpBase, fpA, 'Additional engineering field must not be silently discarded');
    assert.notEqual(fpA, fpB, 'Mutation of additional engineering field must change canonical fingerprint');
  });

  // -------------------------------------------------------------------------
  // Scenario 55: Stale geometry with current specification rejected
  // -------------------------------------------------------------------------
  it('Scenario 55: rejects export when active patternPieces geometry is stale relative to snapshot and specification', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const stalePieces = pieces.map(p => ({
      ...p,
      cutPathData: `${p.cutPathData} L 999 999`
    }));

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric,
      patternPieces: stalePieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.ok(
      exportResult.rejectionCode === 'STALE_PATTERN_GEOMETRY' ||
      exportResult.rejectionCode === 'FORGED_REPORT_DETECTED'
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 56: Stale grading with current geometry rejected
  // -------------------------------------------------------------------------
  it('Scenario 56: rejects export when active gradingResult is invalid or stale', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport,
      gradingResult: {
        baseSize: 'M',
        isOverallGradingValid: false,
        failedSizeCount: 2
      }
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'STALE_GRADING_RESULT');
  });

  // -------------------------------------------------------------------------
  // Scenario 57: Stale validation report with current geometry rejected
  // -------------------------------------------------------------------------
  it('Scenario 57: rejects export when active validationReport fails or disagrees with snapshot validation', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    const failingValidation: ValidationReport = {
      ...validReport,
      status: 'invalid',
      isValid: false,
      failureCount: 2
    };

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: spec,
      measurements: sizeM,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: failingValidation
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'STALE_VALIDATION_REPORT');
  });

  // -------------------------------------------------------------------------
  // Scenario 58: Snapshot with isApproved: true and unapproved specification record rejected
  // -------------------------------------------------------------------------
  it('Scenario 58: never trusts snapshot isApproved boolean when active specification approval record is missing or unapproved', () => {
    const { spec, pieces, snapshot, report } = createFullPipelineSynchronizedFixture();

    // Snapshot has designSpecification.isApproved === true, but active specification is unapproved
    const unapprovedActiveSpec = {
      ...spec,
      isApproved: false,
      approvalState: 'draft' as const,
      approvalRecord: undefined
    };

    const exportResult = validateProductionExportPrerequisites(report, snapshot, {
      specification: unapprovedActiveSpec,
      measurements: sizeM,
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(exportResult.isExportPermitted, false);
    assert.equal(exportResult.rejectionCode, 'SPECIFICATION_UNAPPROVED');
  });

  // -------------------------------------------------------------------------
  // Scenario 59: Parameter-level fieldProvenance mutation changes canonical fingerprint
  // -------------------------------------------------------------------------
  it('Scenario 59: detects mutation of parameter-level fieldProvenance in canonical specification fingerprint', () => {
    const base = createBaseApprovedSpec();
    const withAiProvenance = {
      ...base,
      fieldProvenance: {
        ...base.fieldProvenance,
        lengthCm: 'ai-proposed' as const
      }
    };

    const fpBase = computeSpecificationFingerprint(base);
    const fpAi = computeSpecificationFingerprint(withAiProvenance);
    assert.notEqual(fpBase, fpAi, 'Changing parameter provenance from explicit-value to ai-proposed must alter canonical fingerprint');
  });

  // -------------------------------------------------------------------------
  // Scenario 60: Changing waist or hip measurement without snapshot still invalidates drafting & grading
  // -------------------------------------------------------------------------
  it('Scenario 60: changing waist or lowHip measurement invalidates finished-dimensions, drafting, validation, and grading even without snapshot', () => {
    const spec = createBaseApprovedSpec();
    const pieces = draftSkirtBlock(sizeM, convertToDesignSpecification(spec));

    const alteredWaistReport = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: { ...sizeM, waist: sizeM.waist + 4.0 },
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(alteredWaistReport.artifacts['finished-dimensions'].status, 'stale');
    assert.equal(alteredWaistReport.artifacts.drafting.status, 'stale');
    assert.equal(alteredWaistReport.artifacts['geometry-validation'].status, 'stale');
    assert.equal(alteredWaistReport.artifacts.grading.status, 'stale');

    const alteredHipReport = evaluatePipelineDependencyIntegrity({
      specification: spec,
      measurements: { ...sizeM, lowHip: sizeM.lowHip + 4.0 },
      activeSize: 'M',
      fabric: standardFabric,
      patternPieces: pieces,
      validationReport: validReport
    });

    assert.equal(alteredHipReport.artifacts['finished-dimensions'].status, 'stale');
    assert.equal(alteredHipReport.artifacts.drafting.status, 'stale');
    assert.equal(alteredHipReport.artifacts['geometry-validation'].status, 'stale');
    assert.equal(alteredHipReport.artifacts.grading.status, 'stale');
  });

  // -------------------------------------------------------------------------
  // Scenario 61: Superseded measurement set revision is rejected
  // -------------------------------------------------------------------------
  it('Scenario 61: superseding a measurement set marks previous revision superseded and blocks its approval or export', () => {
    const rev1 = approveAuthoritativeMeasurementSet(
      createAuthoritativeMeasurementSet({
        measurementSetId: 'ms-bespoke-01',
        revisionId: 'ms-bespoke-01-rev-1',
        values: ({ ...sizeM } as unknown) as Record<string, number>,
        source: 'physically-measured',
        provenance: 'physically-measured'
      }),
      {
        approvingAuthority: 'Lead Patternmaker',
        approvedAt: '2026-11-10T09:00:00.000Z'
      }
    );

    const { supersededRecord, nextRecord } = supersedeAuthoritativeMeasurementSet(rev1, {
      revisionId: 'ms-bespoke-01-rev-2',
      values: ({ ...sizeM, waist: sizeM.waist + 2.0 } as unknown) as Record<string, number>
    });

    assert.equal(supersededRecord.approvalState, 'superseded');
    assert.equal(supersededRecord.supersededByRevisionId, 'ms-bespoke-01-rev-2');
    assert.equal(verifyMeasurementSetIntegrity(supersededRecord).isApproved, false);
    assert.equal(nextRecord.approvalState, 'unverified');
    assert.equal(verifyMeasurementSetIntegrity(nextRecord).isApproved, false);
  });

  // -------------------------------------------------------------------------
  // Scenario 62: Valid control case — Tier 1 (demonstration_fixture)
  // -------------------------------------------------------------------------
  it('Scenario 62: valid control case for Tier 1 (demonstration_fixture) approval path', () => {
    const draft = createAuthoritativeGarmentSpecification({
      projectId: 'proj-demo',
      garmentId: 'demo-skirt',
      name: 'Demo Fixture Skirt',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0
    });

    const approvedDemo = approveAuthoritativeGarmentSpecification(draft, 'Curated Demo Fixture', {
      authorityTier: 'demonstration_fixture',
      approvedAt: '2026-11-10T08:00:00.000Z'
    });

    const verification = verifySpecificationApproval(approvedDemo);
    assert.equal(verification.isValid, true);
    assert.equal(verification.authorityTier, 'demonstration_fixture');
  });

  // -------------------------------------------------------------------------
  // Scenario 63: Valid control case — Tier 2 (unauthenticated_local_session)
  // -------------------------------------------------------------------------
  it('Scenario 63: valid control case for Tier 2 (unauthenticated_local_session) approval path', () => {
    const approvedLocal = createBaseApprovedSpec();
    const verification = verifySpecificationApproval(approvedLocal);
    assert.equal(verification.isValid, true);
    assert.equal(verification.authorityTier, 'unauthenticated_local_session');
  });

  // -------------------------------------------------------------------------
  // Scenario 64: Valid control case — Tier 3 (authenticated_designer) with real verifier
  // -------------------------------------------------------------------------
  it('Scenario 64: valid control case for Tier 3 (authenticated_designer) with verified identity credential and verifier', () => {
    const draft = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-tier3',
      name: 'Authenticated Designer Skirt',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0
    });

    const verifier = createTrustedIdentityVerifier({
      trustedIssuer: 'https://auth.patroner.internal',
      expectedAudience: 'patroner-spec-approval',
      sharedSecret: 'idp-secret-tier3',
      referenceTimeIso: '2026-11-10T10:00:00.000Z'
    });

    const credential = issueVerifiableIdentityCredential(
      {
        subjectId: 'usr-designer-elena',
        displayName: 'Elena Rostova',
        issuer: 'https://auth.patroner.internal',
        audience: 'patroner-spec-approval',
        issuedAt: '2026-11-10T09:30:00.000Z',
        expiresAt: '2026-11-10T18:00:00.000Z',
        claims: ['specification:approve']
      },
      'idp-secret-tier3'
    );

    const approvedTier3 = approveAuthoritativeGarmentSpecification(draft, 'Elena Rostova', {
      authorityTier: 'authenticated_designer',
      approverId: 'usr-designer-elena',
      approvedAt: '2026-11-10T10:00:00.000Z',
      identityCredential: credential,
      identityVerifier: verifier
    });

    assert.equal(approvedTier3.isApproved, true);
    assert.equal(approvedTier3.approvalAuthorityTier, 'authenticated_designer');
    assert.equal(approvedTier3.verifiedIdentity?.subjectId, 'usr-designer-elena');

    // Verify with verifier context succeeds
    const verifiedWithCtx = verifySpecificationApproval(approvedTier3, {
      identityVerifier: verifier,
      identityCredential: credential
    });
    assert.equal(verifiedWithCtx.isValid, true);
    assert.equal(verifiedWithCtx.authorityTier, 'authenticated_designer');

    // Verify without verifier context fails closed!
    const verifiedWithoutCtx = verifySpecificationApproval(approvedTier3);
    assert.equal(verifiedWithoutCtx.isValid, false);
  });

  // -------------------------------------------------------------------------
  // Scenario 65: Valid control case — Tier 4 (cryptographic_principal) with real signature verifier
  // -------------------------------------------------------------------------
  it('Scenario 65: valid control case for Tier 4 (cryptographic_principal) with verified signature over 10-field canonical payload', () => {
    const draft = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-tier4',
      specificationRevisionId: 'spec-adv-skirt-tier4-v1',
      name: 'Cryptographically Signed Skirt',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0
    });

    const verifier = createTrustedCryptographicVerifier({
      trustedKeys: { 'key-hsm-prod-01': 'hsm-private-key-material-01' }
    });

    const approvalTimestamp = '2026-11-10T10:30:00.000Z';
    const approvalEventId = 'evt-approve-tier4-001';
    const approverPrincipal = 'principal:lead-pattern-engineer-01';

    const signature = signSpecificationApprovalPayload(
      {
        projectId: draft.projectId,
        garmentId: draft.garmentId,
        specificationRevisionId: draft.specificationRevisionId,
        specificationVersion: draft.version,
        canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
        approvalEventId,
        approverPrincipal,
        authorityTier: 'cryptographic_principal',
        approvalTimestamp,
        schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION
      },
      { keyId: 'key-hsm-prod-01', signingKeyMaterial: 'hsm-private-key-material-01' }
    );

    const approvedTier4 = approveAuthoritativeGarmentSpecification(draft, approverPrincipal, {
      authorityTier: 'cryptographic_principal',
      approverId: approverPrincipal,
      approvalEventId,
      approvedAt: approvalTimestamp,
      cryptographicSignature: signature,
      cryptographicVerifier: verifier
    });

    assert.equal(approvedTier4.isApproved, true);
    assert.equal(approvedTier4.approvalAuthorityTier, 'cryptographic_principal');
    assert.equal(approvedTier4.cryptographicSignature?.keyId, 'key-hsm-prod-01');

    // Verify with cryptographic verifier context succeeds
    const verifiedWithCtx = verifySpecificationApproval(approvedTier4, {
      cryptographicVerifier: verifier
    });
    assert.equal(verifiedWithCtx.isValid, true);
    assert.equal(verifiedWithCtx.authorityTier, 'cryptographic_principal');

    // Verify without cryptographic verifier context fails closed!
    const verifiedWithoutCtx = verifySpecificationApproval(approvedTier4);
    assert.equal(verifiedWithoutCtx.isValid, false);
  });

  // -------------------------------------------------------------------------
  // Scenario 66: Throwing identity or cryptographic verifier fails closed
  // -------------------------------------------------------------------------
  it('Scenario 66: fails closed when injected identityVerifier or cryptographicVerifier throws an exception', () => {
    const draft = createAuthoritativeGarmentSpecification({
      projectId: 'project-adversarial-v2',
      garmentId: 'adv-skirt-throw',
      name: 'Throwing Verifier Skirt',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: 68.0
    });

    const throwingIdentityVerifier = {
      verifyCredential(): any {
        throw new Error('Identity provider connection timeout');
      }
    };

    const dummyCred = issueVerifiableIdentityCredential(
      {
        subjectId: 'usr-1',
        displayName: 'User 1',
        issuer: 'issuer',
        audience: 'aud',
        issuedAt: '2026-11-10T09:00:00.000Z',
        expiresAt: '2026-11-10T19:00:00.000Z',
        claims: ['specification:approve']
      },
      'secret'
    );

    assert.throws(() => {
      approveAuthoritativeGarmentSpecification(draft, 'User 1', {
        authorityTier: 'authenticated_designer',
        approverId: 'usr-1',
        identityCredential: dummyCred,
        identityVerifier: throwingIdentityVerifier
      });
    }, /exception/);
  });
});

