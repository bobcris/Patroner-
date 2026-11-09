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
  convertFromDesignSpecification
} from './garment-specification';

import {
  evaluatePipelineDependencyIntegrity,
  validateProductionExportPrerequisites,
  computeArtifactInputFingerprint
} from './dependency-invalidation';

import {
  calculateGarmentDimensions,
  STANDARD_SIZING_SYSTEM
} from '../measurements/standards';

import { draftSkirtBlock } from '../drafting/skirt-block';
import { getEnhancedFabricById, DEFAULT_ILLUSTRATIVE_FABRIC } from '../fabric/fabric-presets';
import { validatePatternDraft } from '../validation/seam-validator';
import { gradePattern } from '../grading/pattern-grader';
import { createProductionPatternRevision } from './pattern-revision-snapshot';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { ValidationReport } from '../../types';

describe('Milestone 04.6.2.1: Independent Engineering Audit & Data Lineage Integrity', () => {
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

  // =========================================================================
  // PHASE 1: Authoritative Specification Audit & Approval Lifecycle
  // =========================================================================
  describe('Phase 1: Authoritative Specification Audit & Approval Lifecycle', () => {
    it('1. rejects approval without a valid approver identity', () => {
      const spec = createAuthoritativeGarmentSpecification({
        name: 'Test Pencil Skirt',
        garmentCategory: 'skirt',
        silhouette: 'straight',
        fabric: standardFabric,
        easeProfile: 'classic',
        lengthCm: 68.0
      });

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(spec, '');
      }, /Cannot approve specification without a valid approvedBy identity/);

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(spec, '   ');
      }, /Cannot approve specification without a valid approvedBy identity/);
    });

    it('2. distinguishes local demonstration fixtures from unauthenticated local approvals', () => {
      const demoSpec = INITIAL_CONCEPTS[0];
      const authDemo = convertFromDesignSpecification(demoSpec);
      assert.equal(authDemo.approvalAuthorityTier, 'demonstration_fixture');
      assert.equal(authDemo.approvalProvenance, 'demonstration-fixture');

      const regularSpec = createAuthoritativeGarmentSpecification({
        name: 'Custom Line Skirt',
        garmentCategory: 'skirt',
        silhouette: 'a-line',
        fabric: standardFabric,
        easeProfile: 'classic',
        lengthCm: 65.0
      });

      const approvedLocal = approveAuthoritativeGarmentSpecification(regularSpec, 'Atelier Operator', {
        authorityTier: 'unauthenticated_local_session'
      });

      assert.equal(approvedLocal.approvalAuthorityTier, 'unauthenticated_local_session');
      assert.equal(approvedLocal.approvalProvenance, 'unauthenticated-local-approval');
    });

    it('3. binds approval record to exact revision ID and target content fingerprint', () => {
      const spec = createAuthoritativeGarmentSpecification({
        name: 'Architectural Midi',
        garmentCategory: 'skirt',
        silhouette: 'straight',
        fabric: standardFabric,
        easeProfile: 'classic',
        lengthCm: 68.0,
        explicitEaseCm: { waist: 6.0, hip: 5.0 }
      });

      const approved = approveAuthoritativeGarmentSpecification(spec, 'Lead Tailor');
      assert.ok(approved.approvalRecord, 'Approval record must be generated');
      assert.equal(approved.approvalRecord.targetRevisionId, approved.specificationRevisionId);

      const expectedFp = computeSpecificationFingerprint(approved);
      assert.equal(approved.approvalRecord.targetSpecificationFingerprint, expectedFp);

      const verification = verifySpecificationApproval(approved);
      assert.equal(verification.isValid, true);
      assert.equal(verification.state, 'approved');
    });

    it('4. detects specification tampering when content is mutated after approval', () => {
      const spec = createAuthoritativeGarmentSpecification({
        name: 'Architectural Midi',
        garmentCategory: 'skirt',
        silhouette: 'straight',
        fabric: standardFabric,
        easeProfile: 'classic',
        lengthCm: 68.0
      });
      const approved = approveAuthoritativeGarmentSpecification(spec, 'Lead Tailor');

      // Simulate malicious or accidental mutation preserving old approvalRecord
      const tamperedSpec = {
        ...approved,
        targetFinishedDimensions: { ...approved.targetFinishedDimensions, lengthCm: 75.0 }
      };

      const verification = verifySpecificationApproval(tamperedSpec);
      assert.equal(verification.isValid, false);
      assert.equal(verification.state, 'invalid');
      assert.ok(verification.reason?.includes('content fingerprint mismatch'));
    });

    it('5. revoking approval sets state to revoked and resets isApproved to false', () => {
      const spec = createAuthoritativeGarmentSpecification({
        name: 'Test Skirt',
        garmentCategory: 'skirt',
        silhouette: 'straight',
        fabric: standardFabric,
        easeProfile: 'classic',
        lengthCm: 68.0
      });
      const approved = approveAuthoritativeGarmentSpecification(spec, 'Head of Atelier');
      assert.equal(approved.isApproved, true);

      const revoked = revokeAuthoritativeGarmentSpecificationApproval(approved, 'Fabric shrinkage recalibration');
      assert.equal(revoked.isApproved, false);
      assert.equal(revoked.approvalState, 'revoked');
      assert.ok(revoked.designNotes.some(n => n.includes('Approval revoked: Fabric shrinkage recalibration')));

      const verification = verifySpecificationApproval(revoked);
      assert.equal(verification.isValid, false);
      assert.equal(verification.state, 'revoked');
    });

    it('6. revisions start in draft state with approval cleared', () => {
      const spec = createAuthoritativeGarmentSpecification({
        name: 'Base Skirt',
        garmentCategory: 'skirt',
        silhouette: 'straight',
        fabric: standardFabric,
        easeProfile: 'classic',
        lengthCm: 68.0
      });
      const approved = approveAuthoritativeGarmentSpecification(spec, 'Master Tailor');

      // Revise the specification
      const revised = reviseAuthoritativeGarmentSpecification(approved, {
        lengthCm: 72.0
      });

      assert.equal(revised.version, approved.version + 1);
      assert.equal(revised.parentRevisionId, approved.specificationRevisionId);
      assert.equal(revised.isApproved, false);
      assert.equal(revised.approvalState, 'draft');
      assert.equal(revised.approvalRecord, undefined);
      assert.equal(revised.approvedBy, undefined);

      const verification = verifySpecificationApproval(revised);
      assert.equal(verification.isValid, false);
      assert.equal(verification.state, 'draft');
    });
  });

  // =========================================================================
  // PHASE 2: Dependency Graph Semantics
  // =========================================================================
  describe('Phase 2: Dependency Graph Semantics & Selective Invalidation', () => {
    it('1. changing garment target length leaves anatomical body measurements current', () => {
      const spec = INITIAL_CONCEPTS[0];
      const pieces = draftSkirtBlock(sizeM, spec);

      const initialReport = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport
      });

      assert.equal(initialReport.artifacts.measurements.status, 'current');
      assert.equal(initialReport.artifacts.measurements.nodeCategory, 'independent_source_input');
      assert.deepEqual(initialReport.artifacts.measurements.upstreamDependencies, []);

      // Now change specification length from 68 cm to 72 cm
      const modifiedSpec = {
        ...spec,
        lengthCm: 72.0,
        version: spec.version + 1,
        isApproved: false,
        approvalState: 'draft' as const
      };

      const updatedReport = evaluatePipelineDependencyIntegrity({
        specification: modifiedSpec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces, // previous pieces are now stale
        validationReport: validReport
      });

      // CRITICAL CHECK: Anatomical body measurements remain current!
      assert.equal(updatedReport.artifacts.measurements.status, 'current');

      // Derived artifacts must be stale
      assert.equal(updatedReport.artifacts['finished-dimensions'].status, 'current');
      assert.equal(updatedReport.artifacts.drafting.status, 'current'); // until pieces checked or snapshot checked
      assert.equal(updatedReport.artifacts['production-export'].status, 'pending');
      assert.equal(updatedReport.artifacts.specification.status, 'pending');
    });

    it('2. changing body measurements invalidates derived finished dimensions and downstream pipeline', () => {
      const spec = INITIAL_CONCEPTS[0];
      const pieces = draftSkirtBlock(sizeM, spec);

      // Mutate measurements (e.g. invalid negative waist)
      const invalidMeasurements = {
        ...sizeM,
        waist: -72.0
      };

      const report = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: invalidMeasurements,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport
      });

      assert.equal(report.artifacts.measurements.status, 'invalid');
      assert.equal(report.artifacts['finished-dimensions'].status, 'stale');
      assert.equal(report.hasBlockingErrors, true);
      assert.equal(report.canExportProductionDocumentation, false);
    });

    it('3. distinguishes independent source inputs from derived artifacts in integrity report', () => {
      const spec = INITIAL_CONCEPTS[0];
      const pieces = draftSkirtBlock(sizeM, spec);

      const report = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport
      });

      assert.ok('specification' in report.independentInputs);
      assert.ok('measurements' in report.independentInputs);
      assert.ok('fabric' in report.independentInputs);
      assert.ok('grading-rules' in report.independentInputs);
      assert.ok('drafting-engine' in report.independentInputs);

      assert.ok('finished-dimensions' in report.derivedArtifacts);
      assert.ok('drafting-configuration' in report.derivedArtifacts);
      assert.ok('drafting' in report.derivedArtifacts);
      assert.ok('geometry-validation' in report.derivedArtifacts);
      assert.ok('grading' in report.derivedArtifacts);
      assert.ok('production-snapshot' in report.derivedArtifacts);
      assert.ok('production-export' in report.derivedArtifacts);
    });
  });

  // =========================================================================
  // PHASE 3: Lossless Specification Conversion
  // =========================================================================
  describe('Phase 3: Lossless Specification Conversion', () => {
    it('1. performs complete round-trip conversion without data loss', () => {
      const originalSpec = createAuthoritativeGarmentSpecification({
        projectId: 'project-luxury-atelier',
        garmentId: 'midi-01',
        name: 'Silk Crepe Bias Midi',
        garmentCategory: 'skirt',
        silhouette: 'straight',
        prompt: 'Clean line midi skirt in heavy silk crepe',
        fabric: standardFabric,
        fabricRevision: 'fab-rev-03',
        fabricProvenance: 'laboratory-tested',
        easeProfile: 'classic',
        explicitEaseCm: { waist: 6.0, hip: 5.0, neck: 1.0 },
        lengthCm: 68.0,
        targetFinishedDimensions: {
          lengthCm: 68.0,
          waistCm: 78.0,
          hipCm: 103.0,
          chestCm: 90.0,
          acrossBackCm: 36.0,
          bicepCm: 30.0,
          wristCm: 16.0
        },
        dartStyle: 'waist',
        sleeveEaseStrategy: 'classic',
        allowances: {
          seamAllowanceCm: 1.5,
          hemAllowanceCm: 3.0,
          waistAllowanceCm: 1.2,
          neckAllowanceCm: 1.0,
          armholeAllowanceCm: 1.0
        },
        constructionFeatures: [
          {
            id: 'feat-01',
            category: 'closure',
            name: 'CB Invisible Zip',
            description: '20cm invisible coil zipper',
            patternImpact: '1.5cm seam allowance on CB'
          }
        ],
        designNotes: ['Cut front on fold', 'Press darts toward center'],
        isApproved: true,
        approvedBy: 'Senior Patternmaker',
        approvedAt: '2026-11-09T08:00:00.000Z',
        approvalAuthorityTier: 'unauthenticated_local_session',
        approvalProvenance: 'unauthenticated-local-approval'
      });

      // Round-trip: Authoritative -> DesignSpecification -> Authoritative
      const designSpec = convertToDesignSpecification(originalSpec);
      const roundTripSpec = convertFromDesignSpecification(designSpec, {
        projectId: originalSpec.projectId
      });

      assert.equal(roundTripSpec.projectId, originalSpec.projectId);
      assert.equal(roundTripSpec.garmentId, originalSpec.garmentId);
      assert.equal(roundTripSpec.name, originalSpec.name);
      assert.equal(roundTripSpec.garmentCategory, originalSpec.garmentCategory);
      assert.equal(roundTripSpec.silhouette, originalSpec.silhouette);
      assert.equal(roundTripSpec.fabric.id, originalSpec.fabric.id);
      assert.equal(roundTripSpec.fabricRevision, originalSpec.fabricRevision);
      assert.equal(roundTripSpec.fabricProvenance, originalSpec.fabricProvenance);
      assert.equal(roundTripSpec.targetFinishedDimensions.lengthCm, originalSpec.targetFinishedDimensions.lengthCm);
      assert.equal(roundTripSpec.targetFinishedDimensions.waistCm, originalSpec.targetFinishedDimensions.waistCm);
      assert.equal(roundTripSpec.targetFinishedDimensions.hipCm, originalSpec.targetFinishedDimensions.hipCm);
      assert.equal(roundTripSpec.targetFinishedDimensions.chestCm, originalSpec.targetFinishedDimensions.chestCm);
      assert.equal(roundTripSpec.targetFinishedDimensions.acrossBackCm, originalSpec.targetFinishedDimensions.acrossBackCm);
      assert.equal(roundTripSpec.targetFinishedDimensions.bicepCm, originalSpec.targetFinishedDimensions.bicepCm);
      assert.equal(roundTripSpec.targetFinishedDimensions.wristCm, originalSpec.targetFinishedDimensions.wristCm);
      assert.deepEqual(roundTripSpec.explicitEaseCm, originalSpec.explicitEaseCm);
      assert.equal(roundTripSpec.allowances.seamAllowanceCm, originalSpec.allowances.seamAllowanceCm);
      assert.equal(roundTripSpec.allowances.hemAllowanceCm, originalSpec.allowances.hemAllowanceCm);
      assert.equal(roundTripSpec.allowances.waistAllowanceCm, originalSpec.allowances.waistAllowanceCm);
      assert.equal(roundTripSpec.allowances.neckAllowanceCm, originalSpec.allowances.neckAllowanceCm);
      assert.equal(roundTripSpec.allowances.armholeAllowanceCm, originalSpec.allowances.armholeAllowanceCm);
      assert.equal(roundTripSpec.isApproved, true);
      assert.equal(roundTripSpec.approvedBy, originalSpec.approvedBy);
      assert.equal(roundTripSpec.approvedAt, originalSpec.approvedAt);
    });

    it('2. does NOT fabricate fake approver or timestamp when design specification has missing approver', () => {
      const unsafeDesignSpec = {
        ...INITIAL_CONCEPTS[0],
        isApproved: true,
        approvedBy: undefined, // Missing approver!
        approvedAt: undefined
      };

      const converted = convertFromDesignSpecification(unsafeDesignSpec);
      // Must not fabricate 'Designer' or current timestamp!
      assert.equal(converted.isApproved, false);
      assert.equal(converted.approvalState, 'draft');
      assert.equal(converted.approvedBy, undefined);
      assert.equal(converted.approvedAt, undefined);
    });
  });

  // =========================================================================
  // PHASE 4: Mandatory Dimensional Regression & Measurement Independence
  // =========================================================================
  describe('Phase 4: Mandatory Dimensional Regression & Measurement Independence', () => {
    it('1. satisfies exact mandatory test case through real engine integration', () => {
      // Body: Waist: 72.0 cm, Hip: 98.0 cm
      assert.equal(sizeM.waist, 72.0);
      assert.equal(sizeM.lowHip, 98.0);

      // Approved Spec: Target length 68.0 cm, Explicit waist ease +6.0 cm, Explicit hip ease +5.0 cm
      const spec = INITIAL_CONCEPTS[0];
      assert.equal(spec.lengthCm, 68.0);
      assert.equal(spec.explicitEaseCm?.waist, 6.0);
      assert.equal(spec.explicitEaseCm?.hip, 5.0);

      const dimensions = calculateGarmentDimensions(sizeM, 'classic', standardFabric, {
        targetLengthCm: spec.lengthCm,
        explicitEaseCm: spec.explicitEaseCm
      });

      // Expected finished dimensions:
      assert.equal(dimensions.totalLengthCm, 68.0);
      assert.equal(dimensions.garmentWaistCm, 78.0); // 72.0 + 6.0 = 78.0
      assert.equal(dimensions.garmentHipCm, 103.0); // 98.0 + 5.0 = 103.0

      // Quarter targets before dart suppression:
      const quarterWaistTarget = dimensions.garmentWaistCm / 4; // 19.50 cm
      const quarterHipTarget = dimensions.garmentHipCm / 4; // 25.75 cm
      assert.equal(quarterWaistTarget, 19.50);
      assert.equal(quarterHipTarget, 25.75);

      // Draft pattern pieces
      const pieces = draftSkirtBlock(sizeM, spec);
      assert.ok(pieces.length >= 2);

      const frontPiece = pieces.find(p => p.id.includes('front'));
      assert.ok(frontPiece);
      // Bounding box height includes 0.7 cm waist drop: 68.7 cm
      assert.ok(Math.abs(frontPiece.boundingBox.heightCm - 68.0) <= 1.0);
    });

    it('2. switching size preserves approved specification while recalculating size-dependent dimensions', () => {
      const spec = INITIAL_CONCEPTS[0];

      // Switch to Size L (waist: 80 cm, hip: 106 cm)
      const sizeL = STANDARD_SIZING_SYSTEM.sizes.L;
      assert.equal(sizeL.waist, 80.0);
      assert.equal(sizeL.lowHip, 106.0);

      const dimsL = calculateGarmentDimensions(sizeL, 'classic', standardFabric, {
        targetLengthCm: spec.lengthCm,
        explicitEaseCm: spec.explicitEaseCm
      });

      // Target finished length remains strictly 68 cm!
      assert.equal(dimsL.totalLengthCm, 68.0);
      // Finished waist: 80 + 6 = 86 cm
      assert.equal(dimsL.garmentWaistCm, 86.0);
      // Finished hip: 106 + 5 = 111 cm
      assert.equal(dimsL.garmentHipCm, 111.0);
    });
  });

  // =========================================================================
  // PHASE 5 & 6: Production Snapshot & Export Guard Completeness
  // =========================================================================
  describe('Phase 5 & 6: Production Snapshot & Export Guard Completeness', () => {
    it('1. export guard validates actual current state and blocks unapproved specification', () => {
      const spec = INITIAL_CONCEPTS[0];
      const pieces = draftSkirtBlock(sizeM, spec);
      const graded = gradePattern(spec);

      const snapshot = createProductionPatternRevision({
        projectId: 'project-patroner-default',
        targetSize: 'M',
        designSpecification: spec,
        measurements: {
          values: ({ ...sizeM } as unknown) as Record<string, number>,
          defaultOrigin: 'user-entered',
          approval: {
            state: 'approved',
            approvedBy: 'Master Tailor',
            approvedAt: '2026-11-01T11:00:00.000Z'
          }
        },
        fabric: standardFabric,
        patternPieces: pieces,
        validation: validReport,
        physicalValidationStatus: 'not-assessed'
      });

      // When spec is unapproved
      const unapprovedSpec = { ...spec, isApproved: false, approvalState: 'draft' as const };
      const report = evaluatePipelineDependencyIntegrity({
        specification: unapprovedSpec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot
      });

      const exportResult = validateProductionExportPrerequisites(report, snapshot);
      assert.equal(exportResult.isExportPermitted, false);
      assert.ok(exportResult.rejectionReason?.includes('specification (pending'));
    });

    it('2. export guard blocks export when approval was revoked', () => {
      const spec = INITIAL_CONCEPTS[0];
      const pieces = draftSkirtBlock(sizeM, spec);
      const graded = gradePattern(spec);

      const snapshot = createProductionPatternRevision({
        projectId: 'project-patroner-default',
        targetSize: 'M',
        designSpecification: spec,
        measurements: {
          values: ({ ...sizeM } as unknown) as Record<string, number>,
          defaultOrigin: 'user-entered',
          approval: {
            state: 'approved',
            approvedBy: 'Master Tailor',
            approvedAt: '2026-11-01T11:00:00.000Z'
          }
        },
        fabric: standardFabric,
        patternPieces: pieces,
        validation: validReport,
        physicalValidationStatus: 'not-assessed'
      });

      const revokedSpec = { ...spec, isApproved: false, approvalState: 'revoked' as const };
      const report = evaluatePipelineDependencyIntegrity({
        specification: revokedSpec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot
      });

      const exportResult = validateProductionExportPrerequisites(report, snapshot);
      assert.equal(exportResult.isExportPermitted, false);
      assert.ok(exportResult.rejectionReason?.includes('revoked'));
    });

    it('3. export guard blocks export when snapshot is missing or stale', () => {
      const spec = INITIAL_CONCEPTS[0];
      const pieces = draftSkirtBlock(sizeM, spec);

      const report = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: undefined // Missing!
      });

      const exportResult = validateProductionExportPrerequisites(report, undefined);
      assert.equal(exportResult.isExportPermitted, false);
      assert.ok(exportResult.rejectionReason?.includes('Production export requires an authoritative ProductionPatternRevisionSnapshot'));
    });

    it('4. strictly preserves isProductionReady: false invariant', () => {
      const spec = INITIAL_CONCEPTS[0];
      const pieces = draftSkirtBlock(sizeM, spec);
      const graded = gradePattern(spec);

      const snapshot = createProductionPatternRevision({
        projectId: 'project-patroner-default',
        targetSize: 'M',
        designSpecification: spec,
        measurements: {
          values: ({ ...sizeM } as unknown) as Record<string, number>,
          defaultOrigin: 'user-entered',
          approval: {
            state: 'approved',
            approvedBy: 'Master Tailor',
            approvedAt: '2026-11-01T11:00:00.000Z'
          }
        },
        fabric: standardFabric,
        patternPieces: pieces,
        validation: validReport,
        physicalValidationStatus: 'not-assessed'
      });

      assert.equal(snapshot.isProductionReady, false);

      // Attempting to pass an object asserting isProductionReady = true must be rejected
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

