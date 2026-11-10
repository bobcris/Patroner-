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
  convertToDesignSpecification
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

describe('Milestone 04.6.2.2: Production Integrity Boundary Correction — Adversarial Test Suite', () => {
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
      projectId: 'project-adversarial-test',
      garmentId: 'adv-skirt-01',
      name: 'Adversarial Test Skirt',
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
          description: 'CB zipper',
          patternImpact: '1.5cm allowance'
        }
      ],
      designNotes: ['Note 1', 'Note 2'],
      dartStyle: 'waist',
      sleeveEaseStrategy: 'classic'
    });

    return approveAuthoritativeGarmentSpecification(spec, 'Certified Master Tailor', {
      authorityTier: 'unauthenticated_local_session',
      approvedAt: '2026-11-09T10:00:00.000Z'
    });
  }

  // =========================================================================
  // 1. CANONICAL SPECIFICATION FINGERPRINT MUTATION TESTS (Adversarial Coverage)
  // =========================================================================
  describe('Correction A: Canonical Specification Fingerprint Field-Level Tamper Detection', () => {
    it('1. detects mutation of targetFinishedDimensions.lengthCm', () => {
      const approved = createBaseApprovedSpec();
      const tampered = {
        ...approved,
        targetFinishedDimensions: { ...approved.targetFinishedDimensions, lengthCm: 72.0 }
      };

      const verification = verifySpecificationApproval(tampered);
      assert.equal(verification.isValid, false);
      assert.equal(verification.state, 'invalid');
      assert.ok(verification.reason?.includes('content fingerprint mismatch'));
    });

    it('2. detects mutation of targetFinishedDimensions.waistCm', () => {
      const approved = createBaseApprovedSpec();
      const tampered = {
        ...approved,
        targetFinishedDimensions: { ...approved.targetFinishedDimensions, waistCm: 82.0 }
      };

      const verification = verifySpecificationApproval(tampered);
      assert.equal(verification.isValid, false);
      assert.ok(verification.reason?.includes('content fingerprint mismatch'));
    });

    it('3. detects mutation of targetFinishedDimensions.hipCm', () => {
      const approved = createBaseApprovedSpec();
      const tampered = {
        ...approved,
        targetFinishedDimensions: { ...approved.targetFinishedDimensions, hipCm: 108.0 }
      };

      const verification = verifySpecificationApproval(tampered);
      assert.equal(verification.isValid, false);
      assert.ok(verification.reason?.includes('content fingerprint mismatch'));
    });

    it('4. detects mutation of explicitEaseCm (waist, hip, neck)', () => {
      const approved = createBaseApprovedSpec();
      const tamperedWaist = {
        ...approved,
        explicitEaseCm: { ...approved.explicitEaseCm, waist: 8.0 }
      };
      assert.equal(verifySpecificationApproval(tamperedWaist).isValid, false);

      const tamperedNeck = {
        ...approved,
        explicitEaseCm: { ...approved.explicitEaseCm, neck: 3.0 }
      };
      assert.equal(verifySpecificationApproval(tamperedNeck).isValid, false);
    });

    it('5. detects mutation of fabric mechanical properties (weight, stretch, gsm, directional)', () => {
      const approved = createBaseApprovedSpec();

      // Mutate weight
      const tamperedWeight = {
        ...approved,
        fabric: { ...approved.fabric, weight: 'heavy' as const }
      };
      assert.equal(verifySpecificationApproval(tamperedWeight).isValid, false);

      // Mutate stretch
      const tamperedStretch = {
        ...approved,
        fabric: { ...approved.fabric, stretch: 'high-stretch' as const }
      };
      assert.equal(verifySpecificationApproval(tamperedStretch).isValid, false);

      // Mutate directional warp stretch
      const tamperedDirectional = {
        ...approved,
        fabric: {
          ...approved.fabric,
          directional: {
            ...standardFabric.directional,
            warp: { ...standardFabric.directional.warp, stretchPercent: 25 }
          }
        }
      };
      assert.equal(verifySpecificationApproval(tamperedDirectional).isValid, false);
    });

    it('6. detects mutation of fabricRevision and fabricProvenance', () => {
      const approved = createBaseApprovedSpec();

      const tamperedRev = {
        ...approved,
        fabricRevision: 'rev-2026-experimental'
      };
      assert.equal(verifySpecificationApproval(tamperedRev).isValid, false);

      const tamperedProv = {
        ...approved,
        fabricProvenance: 'laboratory-tested' as const
      };
      assert.equal(verifySpecificationApproval(tamperedProv).isValid, false);
    });

    it('7. detects mutation of manufacturing allowances (seam, hem, waist, shoulder)', () => {
      const approved = createBaseApprovedSpec();

      const tamperedSeam = {
        ...approved,
        allowances: { ...approved.allowances, seamAllowanceCm: 2.0 }
      };
      assert.equal(verifySpecificationApproval(tamperedSeam).isValid, false);

      const tamperedHem = {
        ...approved,
        allowances: { ...approved.allowances, hemAllowanceCm: 5.0 }
      };
      assert.equal(verifySpecificationApproval(tamperedHem).isValid, false);

      const tamperedShoulder = {
        ...approved,
        allowances: { ...approved.allowances, shoulderAllowanceCm: 2.5 }
      };
      assert.equal(verifySpecificationApproval(tamperedShoulder).isValid, false);
    });

    it('8. detects mutation of constructionFeatures and designNotes', () => {
      const approved = createBaseApprovedSpec();

      const tamperedFeature = {
        ...approved,
        constructionFeatures: [
          ...approved.constructionFeatures,
          {
            id: 'cf-02',
            category: 'pocket' as const,
            name: 'Side Seam Pocket',
            description: 'Inseam pocket',
            patternImpact: '1.5cm lateral extension'
          }
        ]
      };
      assert.equal(verifySpecificationApproval(tamperedFeature).isValid, false);

      const tamperedNotes = {
        ...approved,
        designNotes: [...approved.designNotes, 'Extra instruction: stabilize hem']
      };
      assert.equal(verifySpecificationApproval(tamperedNotes).isValid, false);
    });

    it('9. detects mutation of dartStyle, sleeveEaseStrategy, garmentCategory, and revision identity', () => {
      const approved = createBaseApprovedSpec();

      const tamperedDart = {
        ...approved,
        dartStyle: 'french' as const
      };
      assert.equal(verifySpecificationApproval(tamperedDart).isValid, false);

      const tamperedCat = {
        ...approved,
        garmentCategory: 'bodice' as const
      };
      assert.equal(verifySpecificationApproval(tamperedCat).isValid, false);

      const tamperedGarmentId = {
        ...approved,
        garmentId: 'spoofed-garment-id'
      };
      assert.equal(verifySpecificationApproval(tamperedGarmentId).isValid, false);

      const tamperedVer = {
        ...approved,
        version: 2
      };
      assert.equal(verifySpecificationApproval(tamperedVer).isValid, false);
    });
  });

  // =========================================================================
  // 2. APPROVAL LIFECYCLE & AUTHORITY BOUNDARY TESTS
  // =========================================================================
  describe('Correction B: Immutable Approval and Revocation Lifecycle', () => {
    it('10. prevents promotion to cryptographic_principal without genuine provider', () => {
      const spec = createAuthoritativeGarmentSpecification({
        name: 'Spoof Test Skirt',
        garmentCategory: 'skirt',
        silhouette: 'straight',
        fabric: standardFabric,
        easeProfile: 'classic',
        lengthCm: 68.0
      });

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(spec, 'Spoof Identity', {
          authorityTier: 'cryptographic_principal'
        });
      }, /cryptographic_principal authority tier is unavailable without cryptographic provider configuration/);
    });

    it('11. reject approval if cryptographic_principal is forged on raw object', () => {
      const approved = createBaseApprovedSpec();
      const forged = {
        ...approved,
        approvalAuthorityTier: 'cryptographic_principal' as const,
        approvalRecord: {
          ...approved.approvalRecord!,
          authorityTier: 'cryptographic_principal' as const
        }
      };

      const verification = verifySpecificationApproval(forged);
      assert.equal(verification.isValid, false);
      assert.ok(verification.reason?.includes('cryptographic_principal authority tier is unavailable'));
    });

    it('12. requires mandatory non-empty reason when revoking approval', () => {
      const approved = createBaseApprovedSpec();

      assert.throws(() => {
        revokeAuthoritativeGarmentSpecificationApproval(approved, '');
      }, /Revocation reason is mandatory and cannot be empty/);

      assert.throws(() => {
        revokeAuthoritativeGarmentSpecificationApproval(approved, '   ');
      }, /Revocation reason is mandatory and cannot be empty/);
    });

    it('13. revocation preserves original approval event in append-only history', () => {
      const approved = createBaseApprovedSpec();
      assert.ok(approved.approvalRecord?.eventId, 'Approval record must have eventId');
      assert.equal(approved.approvalHistory?.length, 1);
      assert.equal(approved.approvalHistory[0].eventType, 'approval');

      const revoked = revokeAuthoritativeGarmentSpecificationApproval(
        approved,
        'Fabric lot test failed shrinkage standard tolerance.',
        { revokerName: 'Chief Quality Officer' }
      );

      assert.equal(revoked.isApproved, false);
      assert.equal(revoked.approvalState, 'revoked');
      assert.ok(revoked.revocationRecord);
      assert.equal(revoked.revocationRecord.eventType, 'revocation');
      assert.equal(revoked.revocationRecord.reason, 'Fabric lot test failed shrinkage standard tolerance.');
      assert.equal(revoked.revocationRecord.revokerName, 'Chief Quality Officer');

      // Crucial: approvalHistory contains BOTH events! Original approval is NOT erased!
      assert.equal(revoked.approvalHistory?.length, 2);
      assert.equal(revoked.approvalHistory[0].eventType, 'approval');
      assert.equal(revoked.approvalHistory[1].eventType, 'revocation');
    });

    it('14. revoked specification cannot be re-approved merely by setting isApproved: true', () => {
      const approved = createBaseApprovedSpec();
      const revoked = revokeAuthoritativeGarmentSpecificationApproval(approved, 'Design updated');

      // Attempt to spoof re-approval by flipping boolean
      const forgedReapproval = {
        ...revoked,
        isApproved: true,
        approvalState: 'approved' as const
      };

      const verification = verifySpecificationApproval(forgedReapproval);
      assert.equal(verification.isValid, false);
      assert.ok(
        verification.reason?.includes('content fingerprint mismatch') ||
        verification.reason?.includes('revoked')
      );
    });

    it('15. re-approval creates a new distinct lifecycle event in history', () => {
      const approved = createBaseApprovedSpec();
      const revoked = revokeAuthoritativeGarmentSpecificationApproval(approved, 'First pass review');

      const reapproved = approveAuthoritativeGarmentSpecification(revoked, 'Director of Atelier', {
        notes: 'Second pass approved after dart refinement'
      });

      assert.equal(reapproved.isApproved, true);
      assert.equal(reapproved.approvalState, 'approved');
      assert.equal(reapproved.approvalHistory?.length, 3);
      assert.equal(reapproved.approvalHistory[0].eventType, 'approval');
      assert.equal(reapproved.approvalHistory[1].eventType, 'revocation');
      assert.equal(reapproved.approvalHistory[2].eventType, 'approval');
      assert.equal((reapproved.approvalHistory[2] as any).approverName, 'Director of Atelier');
    });
  });

  // =========================================================================
  // 3. DEPENDENCY GRAPH AND ARTIFACT FRESHNESS TESTS
  // =========================================================================
  describe('Correction C: Dependency Graph and Upstream Lineage Verification', () => {
    it('16. changing target length keeps body measurements current, invalidates drafting and downstream', () => {
      const specV1 = createBaseApprovedSpec();
      const piecesV1 = draftSkirtBlock(sizeM, convertToDesignSpecification(specV1));

      // Create revised spec with new length (68 cm -> 75 cm)
      const specV2 = reviseAuthoritativeGarmentSpecification(specV1, {
        lengthCm: 75.0,
        targetFinishedDimensions: { ...specV1.targetFinishedDimensions, lengthCm: 75.0 }
      });

      // Pass piecesV1 (drafted for 68 cm) with specV2 (75 cm)
      const report = evaluatePipelineDependencyIntegrity({
        specification: specV2,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: piecesV1,
        validationReport: validReport
      });

      // INDEPENDENT SOURCE INPUT: Body measurements must remain current!
      assert.equal(report.independentInputs.measurements.status, 'current');
      assert.equal(report.artifacts.measurements.status, 'current');

      // DERIVED ARTIFACTS: Drafting must be detected as stale due to length mismatch!
      assert.equal(report.derivedArtifacts.drafting.status, 'stale');
      assert.ok(report.derivedArtifacts.drafting.staleReason?.includes('target length'));
      assert.equal(report.derivedArtifacts['geometry-validation'].status, 'stale');
      assert.equal(report.derivedArtifacts['production-export'].status, 'stale');
      assert.equal(report.canExportProductionDocumentation, false);
    });

    it('17. changing body measurements keeps specification current, invalidates finished-dimensions and downstream', () => {
      const spec = createBaseApprovedSpec();
      const invalidMeasurements = {
        ...sizeM,
        waist: -5.0 // Invalid negative anatomical measurement
      };

      const report = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: invalidMeasurements,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: draftSkirtBlock(sizeM, convertToDesignSpecification(spec)),
        validationReport: validReport
      });

      // Specification remains approved
      assert.equal(report.independentInputs.specification.status, 'approved');

      // Measurements are invalid
      assert.equal(report.independentInputs.measurements.status, 'invalid');

      // Derived finished-dimensions become stale
      assert.equal(report.derivedArtifacts['finished-dimensions'].status, 'stale');
      assert.equal(report.canExportProductionDocumentation, false);
    });

    it('18. changing engine version marks drafting geometry stale', () => {
      const spec = createBaseApprovedSpec();
      const pieces = draftSkirtBlock(sizeM, convertToDesignSpecification(spec));

      const report = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        engineVersion: '0.4.5-legacy' // Older engine version!
      });

      assert.equal(report.derivedArtifacts.drafting.status, 'stale');
      assert.ok(report.derivedArtifacts.drafting.staleReason?.includes('engine version changed'));
    });
  });

  // =========================================================================
  // 4. PRODUCTION SNAPSHOT & EXPORT SECURITY BOUNDARY TESTS
  // =========================================================================
  describe('Correction D & E: Independent Production Export Security Boundary', () => {
    it('19. detects tampered snapshot payload and blocks export', () => {
      const spec = createBaseApprovedSpec();
      const designSpec = convertToDesignSpecification(spec);
      const pieces = draftSkirtBlock(sizeM, designSpec);

      const snapshot = createProductionPatternRevision({
        projectId: 'project-adversarial-test',
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

      // Maliciously tamper with geometry in snapshot without recomputing canonicalFingerprint
      const tamperedSnapshot = {
        ...snapshot,
        patternPieces: [
          {
            ...snapshot.patternPieces[0],
            boundingBox: {
              ...snapshot.patternPieces[0].boundingBox,
              widthCm: snapshot.patternPieces[0].boundingBox.widthCm + 10.0
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

      // Dependency evaluation must flag snapshot as invalid
      assert.equal(report.derivedArtifacts['production-snapshot'].status, 'invalid');
      assert.ok(report.derivedArtifacts['production-snapshot'].staleReason?.includes('tampered'));

      // Export guard must independently reject export
      const exportResult = validateProductionExportPrerequisites(report, tamperedSnapshot as any);
      assert.equal(exportResult.isExportPermitted, false);
      assert.ok(exportResult.rejectionReason?.includes('tampered'));
    });

    it('20. export guard blocks export when active specification does not match snapshot revision', () => {
      const specV1 = createBaseApprovedSpec();
      const designSpecV1 = convertToDesignSpecification(specV1);
      const piecesV1 = draftSkirtBlock(sizeM, designSpecV1);

      const snapshotV1 = createProductionPatternRevision({
        projectId: 'project-adversarial-test',
        targetSize: 'M',
        designSpecification: designSpecV1,
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
        patternPieces: piecesV1,
        validation: validReport,
        physicalValidationStatus: 'not-assessed'
      });

      const specV2 = reviseAuthoritativeGarmentSpecification(specV1, {
        lengthCm: 72.0
      });
      const approvedSpecV2 = approveAuthoritativeGarmentSpecification(specV2, 'Master Tailor');

      const report = evaluatePipelineDependencyIntegrity({
        specification: approvedSpecV2,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: piecesV1,
        validationReport: validReport,
        productionSnapshot: snapshotV1 // Stale snapshot from V1!
      });

      const exportResult = validateProductionExportPrerequisites(report, snapshotV1, {
        specification: approvedSpecV2
      });

      assert.equal(exportResult.isExportPermitted, false);
      assert.ok(exportResult.rejectionReason?.includes('snapshot-specification-mismatch') ||
                exportResult.rejectionReason?.includes('behind active specification'));
    });

    it('21. export guard blocks export if isProductionReady is asserted as true', () => {
      const spec = createBaseApprovedSpec();
      const designSpec = convertToDesignSpecification(spec);
      const pieces = draftSkirtBlock(sizeM, designSpec);

      const snapshot = createProductionPatternRevision({
        projectId: 'project-adversarial-test',
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

      const forgedSnapshot = { ...snapshot, isProductionReady: true };
      const report = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot
      });

      const exportResult = validateProductionExportPrerequisites(report, forgedSnapshot as any);
      assert.equal(exportResult.isExportPermitted, false);
      assert.ok(exportResult.rejectionReason?.includes('Industrial safety violation: isProductionReady cannot be asserted'));
    });
  });
});
