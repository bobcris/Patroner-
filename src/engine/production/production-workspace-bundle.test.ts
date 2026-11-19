/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner P1-2A & P1-2B Regression Suite
 *
 * Verifies:
 *  1. Single authoritative production workspace bundle shared identically across
 *     Module 04 (PatternWorkspace) and Module 05 (ProductionOverview).
 *  2. Deterministic canonical digests, shared BOM controls, governance option
 *     propagation, and upstream stale source invalidation.
 *  3. Skirt/Bodice grading category boundary: `gradePattern` fails explicitly
 *     with `UnsupportedGradingCategoryError` for skirt, trouser, and dress;
 *     skirt never invokes `gradeBodice`, never receives bodice geometry,
 *     keeps `gradedPatternSet === null` and `liveGradingArtifact === undefined`,
 *     and aligns export validation with `single-size-ungraded` policy matching M05.
 *  4. Unsupported categories fail closed safely (`isCadSupported: false`,
 *     `isProductionReady: false`).
 *  5. Bodice multi-size grading (XS–XXL) remains intact and strictly
 *     `isProductionReady: false`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import {
  DEFAULT_SIZE_RANGE,
  gradePattern,
  isMultiSizeGradingSupportedCategory,
  UnsupportedGradingCategoryError
} from '../grading';
import {
  buildAuthoritativeProductionWorkspaceBundle,
  buildM05ProductionPackage,
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
  resolveCategoryGradingPolicy
} from './index';

const SKIRT_SPEC = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'skirt')!;
const BODICE_SPEC = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!;
const M_SIZES = STANDARD_SIZING_SYSTEM.sizes.M;
const FIXED_TIMESTAMP = '2026-11-19T08:00:00.000Z';

test('P1-2B-01: gradePattern rejects skirt, trouser, and dress fail-closed with UnsupportedGradingCategoryError and never synthesizes bodice geometry', () => {
  assert.equal(isMultiSizeGradingSupportedCategory('bodice'), true);
  assert.equal(isMultiSizeGradingSupportedCategory('skirt'), false);
  assert.equal(isMultiSizeGradingSupportedCategory('trouser'), false);
  assert.equal(isMultiSizeGradingSupportedCategory('dress'), false);

  assert.throws(
    () => gradePattern(SKIRT_SPEC),
    (err: unknown) =>
      err instanceof UnsupportedGradingCategoryError &&
      err.code === 'UNSUPPORTED_GRADING_CATEGORY' &&
      err.garmentCategory === 'skirt' &&
      err.message.includes('P1-3')
  );

  for (const unsupportedCat of ['trouser', 'dress'] as const) {
    const unsupportedSpec = {
      ...SKIRT_SPEC,
      id: `spec-test-${unsupportedCat}`,
      garmentCategory: unsupportedCat
    };
    assert.throws(
      () => gradePattern(unsupportedSpec),
      (err: unknown) =>
        err instanceof UnsupportedGradingCategoryError &&
        err.code === 'UNSUPPORTED_GRADING_CATEGORY' &&
        err.garmentCategory === unsupportedCat
    );
  }
});

test('P1-2B-02: Skirt workspace bundle enforces single-size-ungraded policy, keeps gradedPatternSet=null & liveGradingArtifact=undefined, and never contains bodice geometry', () => {
  const policy = resolveCategoryGradingPolicy('skirt', 'M');
  assert.equal(policy.isCadSupported, true);
  assert.equal(policy.supportsMultiSizeGrading, false);
  assert.equal(policy.policyMode, 'single-size-ungraded');
  assert.deepEqual(policy.requiredSizes, ['M']);
  assert.equal(policy.exportGradingPolicy?.mode, 'single-size-ungraded');
  assert.ok(policy.exportGradingPolicy?.nonGradingReason?.includes('P1-3'));

  const bundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    createdAt: FIXED_TIMESTAMP
  });

  assert.equal(bundle.isCadSupported, true);
  assert.equal(bundle.gradedPatternSet, null);
  assert.equal(bundle.liveGradingArtifact, undefined);
  assert.equal(bundle.assemblyResult, undefined);
  assert.equal(bundle.isProductionReady, false);
  assert.equal(bundle.externalCadInteroperabilityVerified, false);

  // Pieces must strictly be skirt panels (never bodice/sleeve)
  assert.ok(bundle.pieces.length >= 2);
  for (const piece of bundle.pieces) {
    assert.ok(
      !piece.pieceCode.includes('BOD') && !piece.pieceCode.includes('SLV'),
      `Unexpected bodice/sleeve piece '${piece.pieceCode}' in skirt bundle`
    );
  }

  // M05 package & export validation align on single-size-ungraded scope
  assert.ok(bundle.m05Package !== null);
  assert.equal(bundle.m05Package!.gradedPatternSet, null);
  assert.deepEqual(bundle.m05Package!.includedSizes, ['M']);
  assert.equal(bundle.m05Package!.isProductionReady, false);
  assert.equal(bundle.exportValidation.validationDetails?.gradingArtifactId, undefined);
  assert.notEqual(bundle.exportValidation.rejectionCode, 'GRADING_ARTIFACT_MISSING');
  assert.notEqual(bundle.exportValidation.rejectionCode, 'GRADING_POLICY_MISMATCH');

  // With approved user-entered measurements matching skirt length, single-size-ungraded grading stage is current without any bodice grading artifact
  const approvedSkirtBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: { ...M_SIZES, skirtLength: SKIRT_SPEC.lengthCm },
    activeSize: 'M',
    governance: {
      measurementProvenance: 'user-entered',
      measurementApprovalState: 'approved',
      measurementProvenanceEvidence: {
        operatorName: 'Atelier QA Lead',
        measurementSource: 'physical-tape-measure',
        recordedAt: FIXED_TIMESTAMP
      }
    },
    createdAt: FIXED_TIMESTAMP
  });
  assert.equal(approvedSkirtBundle.gradedPatternSet, null);
  assert.equal(approvedSkirtBundle.liveGradingArtifact, undefined);
  assert.equal(approvedSkirtBundle.pipelineReport.derivedArtifacts.grading.status, 'current');
  assert.equal(approvedSkirtBundle.isProductionReady, false);
});

test('P1-2B-03: buildM05ProductionPackage fails closed if a bodice GradedPatternSet override is passed for a skirt spec', () => {
  const bodiceGraded = gradePattern(BODICE_SPEC);
  const pkg = buildM05ProductionPackage({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    gradedPatternSetOverride: bodiceGraded,
    options: {
      activeSize: 'M',
      createdAt: FIXED_TIMESTAMP
    }
  });

  assert.equal(pkg.gradedPatternSet, null);
  assert.equal(pkg.isProductionReady, false);
  const gate10 = pkg.validation.diagnostics.find(d => d.checkId === 'invalid-or-stale-revision');
  assert.ok(gate10 !== undefined);
  assert.equal(gate10!.status, 'fail');
  assert.ok(gate10!.message.includes('Rejected mismatched gradedPatternSetOverride'));
});

test('P1-2B-04: Bodice multi-size grading (XS–XXL) remains valid, synchronized, and fail-closed', () => {
  const bundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    createdAt: FIXED_TIMESTAMP
  });

  assert.equal(bundle.isCadSupported, true);
  assert.equal(bundle.categoryPolicy.policyMode, 'graded-multi-size');
  assert.equal(bundle.categoryPolicy.supportsMultiSizeGrading, true);
  assert.ok(bundle.gradedPatternSet !== null);
  assert.equal(bundle.gradedPatternSet!.isAllValid, true);
  assert.deepEqual(bundle.gradedPatternSet!.supportedSizes, [...DEFAULT_SIZE_RANGE]);
  assert.ok(bundle.liveGradingArtifact !== undefined);
  assert.ok(bundle.m05Package !== null);
  assert.deepEqual(bundle.m05Package!.includedSizes, [...DEFAULT_SIZE_RANGE]);
  assert.equal(bundle.isProductionReady, false);
  assert.equal(bundle.m05Package!.isProductionReady, false);
});

test('P1-2B-05: Unsupported categories (trouser, dress) fail closed cleanly without throwing', () => {
  for (const cat of ['trouser', 'dress'] as const) {
    const spec = { ...SKIRT_SPEC, id: `spec-${cat}`, garmentCategory: cat };
    const bundle = buildAuthoritativeProductionWorkspaceBundle({
      designSpec: spec,
      measurements: M_SIZES,
      activeSize: 'M',
      createdAt: FIXED_TIMESTAMP
    });

    assert.equal(bundle.isCadSupported, false);
    assert.equal(bundle.categoryPolicy.policyMode, 'unsupported');
    assert.equal(bundle.pieces.length, 0);
    assert.equal(bundle.gradedPatternSet, null);
    assert.equal(bundle.liveGradingArtifact, undefined);
    assert.equal(bundle.m05Package, null);
    assert.equal(bundle.exportValidation.isExportPermitted, false);
    assert.equal(bundle.isProductionReady, false);
  }
});

test('P1-2A-01: Identical inputs produce identical deterministic digests, BOM totals, and readiness reports across consumers', () => {
  const sharedInputs = {
    projectId: 'project-patroner-default',
    tenantId: 'tenant-studio-local',
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: {
      ...DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
      fabricRollWidthCm: 150,
      markerWasteFactor: 0.15,
      orderQuantityPerSize: 4,
      includeLining: true
    },
    governance: {
      bodiceDartStyle: 'waist' as const,
      sleeveEaseStrategy: 'classic' as const,
      strictUncertaintyGate: true,
      requireApprovedGovernance: false,
      measurementProvenance: 'standard-chart' as const,
      measurementApprovalState: 'unverified' as const
    },
    createdAt: FIXED_TIMESTAMP
  };

  const module04Bundle = buildAuthoritativeProductionWorkspaceBundle(sharedInputs);
  const module05Bundle = buildAuthoritativeProductionWorkspaceBundle(sharedInputs);

  assert.equal(module04Bundle.inputSignature, module05Bundle.inputSignature);
  assert.equal(
    module04Bundle.m05Package!.canonicalContentDigest,
    module05Bundle.m05Package!.canonicalContentDigest
  );
  assert.equal(
    module04Bundle.m05Package!.bom.totalMainFabricMetersForOrder,
    module05Bundle.m05Package!.bom.totalMainFabricMetersForOrder
  );
  assert.equal(
    module04Bundle.m05Package!.validation.passedCount,
    module05Bundle.m05Package!.validation.passedCount
  );
  assert.equal(
    module04Bundle.exportValidation.isExportPermitted,
    module05Bundle.exportValidation.isExportPermitted
  );
  assert.equal(module04Bundle.isProductionReady, false);
});

test('P1-2A-02: Shared BOM controls and requireApprovedGovernance toggle deterministically update bundle readiness and digest', () => {
  const baseBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { orderQuantityPerSize: 1, includeLining: false },
    governance: { requireApprovedGovernance: false },
    createdAt: FIXED_TIMESTAMP
  });

  const scaledBomBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { orderQuantityPerSize: 5, includeLining: true },
    governance: { requireApprovedGovernance: false },
    createdAt: FIXED_TIMESTAMP
  });

  assert.notEqual(
    baseBundle.m05Package!.canonicalContentDigest,
    scaledBomBundle.m05Package!.canonicalContentDigest
  );
  assert.ok(
    scaledBomBundle.m05Package!.bom.totalMainFabricMetersForOrder >
      baseBundle.m05Package!.bom.totalMainFabricMetersForOrder
  );

  // Toggling requireApprovedGovernance elevates Gate 7 from advisory warning to blocking fail
  const strictGovBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { orderQuantityPerSize: 1, includeLining: false },
    governance: { requireApprovedGovernance: true },
    createdAt: FIXED_TIMESTAMP
  });

  const baseGate7 = baseBundle.m05Package!.validation.diagnostics.find(
    d => d.checkId === 'unresolved-measurement-approvals'
  );
  const strictGate7 = strictGovBundle.m05Package!.validation.diagnostics.find(
    d => d.checkId === 'unresolved-measurement-approvals'
  );
  assert.equal(baseGate7?.status, 'warning');
  assert.equal(baseGate7?.severity, 'advisory');
  assert.equal(strictGate7?.status, 'fail');
  assert.equal(strictGate7?.severity, 'blocking');
  assert.equal(strictGovBundle.m05Package!.validation.isValid, false);
});

test('P1-2A-03: Stale upstream source invalidation flags mismatched specification/measurement revisions', () => {
  const initialBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    createdAt: FIXED_TIMESTAMP
  });

  const modifiedSpec = {
    ...SKIRT_SPEC,
    version: SKIRT_SPEC.version + 1,
    lengthCm: SKIRT_SPEC.lengthCm + 4
  };

  const staleCheckedBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: modifiedSpec,
    measurements: M_SIZES,
    activeSize: 'M',
    previousPackageRevision: {
      sourceSpecificationFingerprint:
        initialBundle.upstreamStaleness.sourceSpecificationFingerprint ?? undefined,
      sourceMeasurementFingerprint:
        initialBundle.upstreamStaleness.sourceMeasurementFingerprint ?? undefined
    },
    createdAt: FIXED_TIMESTAMP
  });

  assert.equal(staleCheckedBundle.upstreamStaleness.isStaleAgainstPrevious, true);
  assert.ok(staleCheckedBundle.upstreamStaleness.staleReasons.length > 0);
  const gate10 = staleCheckedBundle.m05Package!.validation.diagnostics.find(
    d => d.checkId === 'invalid-or-stale-revision'
  );
  assert.equal(gate10?.status, 'fail');
});

test('P1-2A-04: Module 04 and Module 05 components consume shared workspaceBundle and do not directly invoke gradePattern or buildM05ProductionPackage', () => {
  const m04Src = fs.readFileSync(
    path.resolve('src/features/pattern-workspace/PatternWorkspace.tsx'),
    'utf8'
  );
  const m05Src = fs.readFileSync(
    path.resolve('src/features/production/ProductionOverview.tsx'),
    'utf8'
  );

  assert.ok(!m04Src.includes('gradePattern('));
  assert.ok(!m04Src.includes('buildM05ProductionPackage('));
  assert.ok(!m05Src.includes('gradePattern('));
  assert.ok(!m05Src.includes('buildM05ProductionPackage('));
  assert.ok(m04Src.includes('workspaceBundle'));
  assert.ok(m05Src.includes('workspaceBundle'));
});
