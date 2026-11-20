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
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { ProductionOverview } from '../../features/production/ProductionOverview';
import {
  DEFAULT_SIZE_RANGE,
  gradePattern,
  isMultiSizeGradingSupportedCategory,
  UnsupportedGradingCategoryError
} from '../grading';
import {
  buildAuthoritativeProductionWorkspaceBundle,
  buildDiagnosticProductionPackageJson,
  buildM05ProductionPackage,
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
  evaluateBaselineCommitEligibility,
  evaluateProductionPackageExportGate,
  executeGuardedBaselineCommit,
  executeGuardedCanonicalReleaseJsonExport,
  executeGuardedDxfReleaseExport,
  executeGuardedTechPackPrint,
  extractRevisionBaselineFromBundle,
  getApplicableEaseGirthsForCategory,
  ProductionExportValidationResult,
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

test('P1-2-REM-01 (§3): Independent production bundles without createdAt across wall-clock time produce identical canonical SHA-256 digests while keeping generatedAt as metadata', async () => {
  const firstBodice = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });

  // Guarantee distinct wall-clock millisecond ISO timestamp
  await new Promise(resolve => setTimeout(resolve, 15));

  const secondBodice = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });

  assert.notEqual(
    firstBodice.m05Package!.generatedAt,
    secondBodice.m05Package!.generatedAt,
    'generatedAt metadata must still capture distinct generation timestamps'
  );
  assert.equal(
    firstBodice.m05Package!.canonicalContentDigest,
    secondBodice.m05Package!.canonicalContentDigest,
    'Canonical content digest MUST NOT depend on wall-clock generatedAt'
  );
  assert.equal(
    firstBodice.m05Package!.reportSha256Hex,
    secondBodice.m05Package!.reportSha256Hex
  );

  // Also verify Skirt without createdAt
  const firstSkirt = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });
  await new Promise(resolve => setTimeout(resolve, 15));
  const secondSkirt = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });
  assert.equal(
    firstSkirt.m05Package!.canonicalContentDigest,
    secondSkirt.m05Package!.canonicalContentDigest
  );
});

test('P1-2-REM-02 (§4): Authoritative gradingArtifact is constructed once inside buildM05ProductionPackage and never duplicated in workspace bundle or created for skirt', () => {
  const bodiceBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });

  assert.ok(bodiceBundle.m05Package!.gradingArtifact !== null);
  assert.equal(bodiceBundle.m05Package!.gradingArtifactError, null);
  assert.equal(bodiceBundle.gradingArtifactError, null);
  assert.strictEqual(
    bodiceBundle.liveGradingArtifact,
    bodiceBundle.m05Package!.gradingArtifact,
    'Workspace bundle MUST reuse exact gradingArtifact instance from m05Package'
  );
  assert.equal(
    bodiceBundle.liveGradingArtifact!.baseSize,
    bodiceBundle.gradedPatternSet!.baseSize
  );

  const skirtBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });
  assert.equal(skirtBundle.m05Package!.gradingArtifact, null);
  assert.equal(skirtBundle.m05Package!.gradingArtifactError, null);
  assert.equal(skirtBundle.liveGradingArtifact, undefined);
  assert.equal(skirtBundle.gradingArtifactError, null);

  // Verify no duplicate createAuthoritativeGradingArtifact remains in production-workspace-bundle.ts
  const bundleSrc = fs.readFileSync(
    path.resolve('src/engine/production/production-workspace-bundle.ts'),
    'utf8'
  );
  assert.ok(!bundleSrc.includes('createAuthoritativeGradingArtifact('));
});

test('P1-2-REM-03 (§5): Staleness propagation detects spec, measurement, BOM, grading-control, and pattern-revision changes and blocks stale export', () => {
  const baselineBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { orderQuantityPerSize: 1 },
    governance: { bodiceDartStyle: 'waist', sleeveEaseStrategy: 'classic' }
  });

  const baseline = {
    sourceSpecificationFingerprint:
      baselineBundle.upstreamStaleness.sourceSpecificationFingerprint ?? undefined,
    sourceMeasurementFingerprint:
      baselineBundle.upstreamStaleness.sourceMeasurementFingerprint ?? undefined,
    basePatternFingerprint:
      baselineBundle.upstreamStaleness.basePatternFingerprint ?? undefined,
    patternRevisionId: baselineBundle.upstreamStaleness.patternRevisionId,
    gradingControlsFingerprint:
      baselineBundle.upstreamStaleness.gradingControlsFingerprint ?? undefined,
    gradingReportSha256Hex: baselineBundle.upstreamStaleness.gradingReportSha256Hex,
    bomFingerprint: baselineBundle.upstreamStaleness.bomFingerprint ?? undefined
  };

  // Unchanged inputs against matching baseline remain fresh (NOT stale)
  const freshCheck = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { orderQuantityPerSize: 1 },
    governance: { bodiceDartStyle: 'waist', sleeveEaseStrategy: 'classic' },
    previousPackageRevision: baseline
  });
  assert.equal(freshCheck.upstreamStaleness.isStaleAgainstPrevious, false);
  assert.equal(freshCheck.upstreamStaleness.staleReasons.length, 0);

  // 1. BOM mutation triggers staleness and blocks export
  const bomStale = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { orderQuantityPerSize: 3 },
    governance: { bodiceDartStyle: 'waist', sleeveEaseStrategy: 'classic' },
    previousPackageRevision: baseline
  });
  assert.equal(bomStale.upstreamStaleness.isStaleAgainstPrevious, true);
  assert.ok(bomStale.upstreamStaleness.staleReasons.some(r => r.includes('BOM')));
  assert.equal(bomStale.exportValidation.isExportPermitted, false);
  assert.equal(bomStale.exportValidation.rejectionCode, 'UPSTREAM_STAGE_STALE');

  // 2. Sleeve ease / grading control change triggers staleness
  const strategyStale = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { orderQuantityPerSize: 1 },
    governance: { bodiceDartStyle: 'waist', sleeveEaseStrategy: 'tailored' },
    previousPackageRevision: baseline
  });
  assert.equal(strategyStale.upstreamStaleness.isStaleAgainstPrevious, true);
  assert.ok(strategyStale.upstreamStaleness.staleReasons.some(r => r.includes('grading or governance controls')));

  // 3. Measurement change triggers staleness
  const measStale = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: { ...M_SIZES, bust: (M_SIZES.bust ?? 90) + 2 },
    activeSize: 'M',
    bomControls: { orderQuantityPerSize: 1 },
    governance: { bodiceDartStyle: 'waist', sleeveEaseStrategy: 'classic' },
    previousPackageRevision: baseline
  });
  assert.equal(measStale.upstreamStaleness.isStaleAgainstPrevious, true);
  assert.ok(measStale.upstreamStaleness.staleReasons.some(r => r.includes('measurements')));

  // 4. Pattern revision ID mismatch triggers staleness
  const revStale = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { orderQuantityPerSize: 1 },
    governance: { bodiceDartStyle: 'waist', sleeveEaseStrategy: 'classic' },
    previousPackageRevision: {
      ...baseline,
      patternRevisionId: 'rev-old-superseded-v0'
    }
  });
  assert.equal(revStale.upstreamStaleness.isStaleAgainstPrevious, true);
  assert.ok(revStale.upstreamStaleness.staleReasons.some(r => r.includes('pattern revision ID')));
});

test('P1-2-REM-04 (§6): ProductionOverview consumes authoritative governance sleeveEaseStrategy, isolates skirt from bodice prototype fixture, and App wires previousPackageRevision + spec-switch reset', () => {
  const m05Src = fs.readFileSync(
    path.resolve('src/features/production/ProductionOverview.tsx'),
    'utf8'
  );
  const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');

  // ProductionOverview reads workspaceBundle.governance.sleeveEaseStrategy for adaptedSleeveEase
  assert.ok(m05Src.includes('workspaceBundle.governance.sleeveEaseStrategy'));
  assert.ok(m05Src.includes('data-testid="m05-adapted-sleeve-ease"'));
  assert.ok(m05Src.includes('data-testid="m05-skirt-prototype-isolation-card"'));
  assert.ok(m05Src.includes('if (!isBodiceCategory) return null;'));

  // App wires real previousPackageRevision and resets optional strategy fields when switching garments
  assert.ok(appSrc.includes('previousPackageRevision: committedPreviousRevision'));
  assert.ok(appSrc.includes('committedBaselinesByGarment'));
  assert.ok(appSrc.includes("setBodiceDartStyle(nextSpec.dartStyle ?? 'waist')"));
  assert.ok(appSrc.includes("setSleeveEaseStrategy(nextSpec.sleeveEaseStrategy ?? 'classic')"));
});

// ============================================================================
// P1-2 CHECKPOINT 8 REVISION 3 REMEDIATION — N-04, N-05, N-06.4 TESTS
// ============================================================================

const PERMITTED_EXPORT_VALIDATION: ProductionExportValidationResult = {
  isExportPermitted: true,
  blockingArtifacts: [],
  rejectionReason: 'All export prerequisites verified in controlled test fixture.'
};

test('P1-2-REV3-N04-01: Release export gates & direct handlers fail closed for stale, Gate 6 failing, unapproved, invalid grading, invalid BOM, and DXF revision mismatch', () => {
  // 1. Fresh valid package with default PATTERN_REVISION_NOT_APPROVED -> BOTH DXF & Canonical JSON blocked
  const unapprovedSkirt = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });
  assert.equal(unapprovedSkirt.exportValidation.isExportPermitted, false);
  assert.equal(unapprovedSkirt.exportValidation.rejectionCode, 'PATTERN_REVISION_NOT_APPROVED');
  assert.equal(unapprovedSkirt.exportGate.canExportDxfRelease, false);
  assert.equal(unapprovedSkirt.exportGate.canExportCanonicalReleaseJson, false);

  let emittedCount = 0;
  const dxfUnapproved = executeGuardedDxfReleaseExport({
    bundle: unapprovedSkirt.m05Package,
    exportValidation: unapprovedSkirt.exportValidation,
    onEmit: () => {
      emittedCount += 1;
    }
  });
  const jsonUnapproved = executeGuardedCanonicalReleaseJsonExport({
    bundle: unapprovedSkirt.m05Package,
    exportValidation: unapprovedSkirt.exportValidation,
    onEmit: () => {
      emittedCount += 1;
    }
  });
  assert.equal(dxfUnapproved.permitted, false);
  assert.equal(dxfUnapproved.rejectionCode, 'PATTERN_REVISION_NOT_APPROVED');
  assert.equal(jsonUnapproved.permitted, false);
  assert.equal(jsonUnapproved.rejectionCode, 'PATTERN_REVISION_NOT_APPROVED');
  assert.equal(emittedCount, 0, 'Blocked direct handler must NEVER emit payloads');

  // 2. Fresh invalid package: Bodice Flat Shirt (Gate 6 XXL failure) -> blocked even if exportValidation were permitted
  const flatShirtSpec = {
    ...BODICE_SPEC,
    id: 'spec-bodice-flat-shirt-test',
    sleeveEaseStrategy: 'flat' as const
  };
  const flatShirtBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: flatShirtSpec,
    measurements: M_SIZES,
    activeSize: 'M',
    governance: { sleeveEaseStrategy: 'flat' }
  });
  assert.equal(flatShirtBundle.m05Package!.validation.isValid, false);
  assert.ok(
    flatShirtBundle.m05Package!.validation.diagnostics.some(
      d => d.checkId === 'invalid-size-coverage' && d.status === 'fail'
    )
  );
  const flatDxf = executeGuardedDxfReleaseExport({
    bundle: flatShirtBundle.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onEmit: () => {
      emittedCount += 1;
    }
  });
  const flatJson = executeGuardedCanonicalReleaseJsonExport({
    bundle: flatShirtBundle.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onEmit: () => {
      emittedCount += 1;
    }
  });
  assert.equal(flatDxf.permitted, false);
  assert.equal(flatDxf.rejectionCode, 'M05_VALIDATION_FAILED');
  assert.equal(flatJson.permitted, false);
  assert.equal(flatJson.rejectionCode, 'M05_VALIDATION_FAILED');
  assert.equal(emittedCount, 0);

  // 3. Stale package -> blocked even if exportValidation were permitted
  const baseline = extractRevisionBaselineFromBundle(unapprovedSkirt)!;
  const staleSkirt = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { fabricRollWidthCm: 150 },
    previousPackageRevision: baseline
  });
  assert.equal(staleSkirt.upstreamStaleness.isStaleAgainstPrevious, true);
  const staleDxf = executeGuardedDxfReleaseExport({
    bundle: staleSkirt.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onEmit: () => {
      emittedCount += 1;
    }
  });
  const staleJson = executeGuardedCanonicalReleaseJsonExport({
    bundle: staleSkirt.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onEmit: () => {
      emittedCount += 1;
    }
  });
  assert.equal(staleDxf.permitted, false);
  assert.equal(staleDxf.rejectionCode, 'UPSTREAM_STAGE_STALE');
  assert.equal(staleJson.permitted, false);
  assert.equal(staleJson.rejectionCode, 'UPSTREAM_STAGE_STALE');
  assert.equal(emittedCount, 0);

  // 4. Invalid grading (gradingArtifactError !== null) -> blocked
  const invalidGradingPkg = {
    ...unapprovedSkirt.m05Package!,
    gradingArtifactError: 'Simulated authoritative grading failure'
  };
  assert.equal(
    executeGuardedDxfReleaseExport({
      bundle: invalidGradingPkg,
      exportValidation: PERMITTED_EXPORT_VALIDATION,
      onEmit: () => {
        emittedCount += 1;
      }
    }).permitted,
    false
  );
  assert.equal(
    executeGuardedCanonicalReleaseJsonExport({
      bundle: invalidGradingPkg,
      exportValidation: PERMITTED_EXPORT_VALIDATION,
      onEmit: () => {
        emittedCount += 1;
      }
    }).permitted,
    false
  );

  // 5. DXF revision mismatch -> DXF blocked fail-closed
  const mismatchedDxfPkg = {
    ...unapprovedSkirt.m05Package!,
    dxfExport: {
      ...unapprovedSkirt.m05Package!.dxfExport!,
      artifact: {
        ...unapprovedSkirt.m05Package!.dxfExport!.artifact,
        sourceRevisionId: 'rev-tampered-mismatch'
      }
    }
  };
  const dxfMismatch = executeGuardedDxfReleaseExport({
    bundle: mismatchedDxfPkg,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onEmit: () => {
      emittedCount += 1;
    }
  });
  assert.equal(dxfMismatch.permitted, false);
  assert.equal(dxfMismatch.rejectionCode, 'DXF_REVISION_MISMATCH');

  // 6. Missing exportValidation context -> fails closed
  assert.equal(
    evaluateProductionPackageExportGate({
      bundle: unapprovedSkirt.m05Package,
      exportValidation: undefined
    }).canExportDxfRelease,
    false
  );
  assert.equal(emittedCount, 0);

  // 7. Valid approved fresh package -> BOTH DXF & Canonical Release JSON succeed
  let dxfEmitted = '';
  let jsonEmitted = '';
  const approvedDxf = executeGuardedDxfReleaseExport({
    bundle: unapprovedSkirt.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onEmit: (text, filename) => {
      assert.ok(filename.endsWith('.dxf'));
      dxfEmitted = text;
    }
  });
  const approvedJson = executeGuardedCanonicalReleaseJsonExport({
    bundle: unapprovedSkirt.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onEmit: (text, filename) => {
      assert.ok(filename.endsWith('.canonical.json'));
      jsonEmitted = text;
    }
  });
  assert.equal(approvedDxf.permitted, true);
  assert.ok(dxfEmitted.includes('SECTION'));
  assert.equal(approvedJson.permitted, true);
  assert.ok(jsonEmitted.includes(unapprovedSkirt.m05Package!.packageId));

  // 8. Diagnostic JSON is explicitly tagged non-release and never pretends to be an approved release artifact
  const diag = buildDiagnosticProductionPackageJson(
    unapprovedSkirt.m05Package!,
    unapprovedSkirt.exportValidation
  );
  assert.equal(diag.artifactClass, 'DIAGNOSTIC_NON_RELEASE_SNAPSHOT');
  assert.equal(diag.isApprovedProductionArtifact, false);
  assert.equal(diag.releaseExportPermitted, false);
  assert.ok(diag.filename.endsWith('.diagnostic-non-release.json'));
  const parsedDiag = JSON.parse(diag.payloadText) as Record<string, unknown>;
  assert.equal(parsedDiag.artifactClass, 'DIAGNOSTIC_NON_RELEASE_SNAPSHOT');
  assert.equal(parsedDiag.isApprovedProductionArtifact, false);
  assert.equal(parsedDiag.isProductionReady, false);
  assert.equal(parsedDiag.releaseExportPermitted, false);
});

test('P1-2-REV3-N04-02: Guarded baseline commit rejects failing/unapproved packages, never turns blocked packages exportable, and handles stale->fresh & idempotent re-sync', () => {
  // 1. Fresh/stale valid package with PATTERN_REVISION_NOT_APPROVED:
  //    production-baseline commit MUST fail; working-draft sync succeeds ONLY for drift inspection and NEVER unlocks export
  const baseSkirt = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });
  const initialBaseline = extractRevisionBaselineFromBundle(baseSkirt)!;
  const staleUnapproved = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { fabricRollWidthCm: 152 },
    previousPackageRevision: initialBaseline
  });

  assert.equal(staleUnapproved.upstreamStaleness.isStaleAgainstPrevious, true);
  assert.equal(staleUnapproved.baselineEligibility.canCommitProductionBaseline, false);
  assert.equal(staleUnapproved.baselineEligibility.canSyncWorkingDraftSnapshot, true);

  let prodCommitCalled = 0;
  const rejectedProdCommit = executeGuardedBaselineCommit({
    workspaceBundle: staleUnapproved,
    mode: 'production-baseline',
    onCommit: () => {
      prodCommitCalled += 1;
    }
  });
  assert.equal(rejectedProdCommit.committed, false);
  assert.equal(rejectedProdCommit.rejectionCode, 'BASELINE_COMMIT_BLOCKED');
  assert.equal(prodCommitCalled, 0);

  let syncedBaseline: ReturnType<typeof extractRevisionBaselineFromBundle>;
  const workingDraftSync = executeGuardedBaselineCommit({
    workspaceBundle: staleUnapproved,
    mode: 'working-draft-diagnostic',
    onCommit: b => {
      syncedBaseline = b;
    }
  });
  assert.equal(workingDraftSync.committed, true);
  assert.ok(syncedBaseline);

  // Re-evaluate after syncing working draft snapshot -> staleness cleared, YET release exports remain STRICTLY BLOCKED!
  const afterDraftSync = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { fabricRollWidthCm: 152 },
    previousPackageRevision: syncedBaseline
  });
  assert.equal(afterDraftSync.upstreamStaleness.isStaleAgainstPrevious, false);
  assert.equal(afterDraftSync.exportValidation.isExportPermitted, false);
  assert.equal(afterDraftSync.exportValidation.rejectionCode, 'PATTERN_REVISION_NOT_APPROVED');
  assert.equal(afterDraftSync.exportGate.canExportDxfRelease, false);
  assert.equal(afterDraftSync.exportGate.canExportCanonicalReleaseJson, false);

  // 2. Failing Gate 6 XXL package (Bodice Flat Shirt) -> BOTH production-baseline AND working-draft-diagnostic MUST FAIL
  const flatShirtSpec = {
    ...BODICE_SPEC,
    id: 'spec-bodice-flat-shirt-test',
    sleeveEaseStrategy: 'flat' as const
  };
  const flatShirtInitial = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: flatShirtSpec,
    measurements: M_SIZES,
    activeSize: 'M',
    governance: { sleeveEaseStrategy: 'flat' }
  });
  const flatShirtStale = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: flatShirtSpec,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { fabricRollWidthCm: 156 },
    governance: { sleeveEaseStrategy: 'flat' },
    previousPackageRevision: extractRevisionBaselineFromBundle(flatShirtInitial)
  });

  assert.equal(flatShirtStale.baselineEligibility.hasNonStalenessValidationFailures, true);
  assert.equal(flatShirtStale.baselineEligibility.canCommitProductionBaseline, false);
  assert.equal(flatShirtStale.baselineEligibility.canSyncWorkingDraftSnapshot, false);

  let failingCommitCalls = 0;
  for (const mode of ['production-baseline', 'working-draft-diagnostic'] as const) {
    const res = executeGuardedBaselineCommit({
      workspaceBundle: flatShirtStale,
      mode,
      onCommit: () => {
        failingCommitCalls += 1;
      }
    });
    assert.equal(res.committed, false, `Gate 6 failing package must block ${mode}`);
  }
  assert.equal(failingCommitCalls, 0);

  // 3. Invalid grading & empty BOM fail BOTH baseline commit modes
  const invalidGradingEligibility = evaluateBaselineCommitEligibility({
    isCadSupported: true,
    draftValidation: baseSkirt.draftValidation,
    m05Package: {
      ...baseSkirt.m05Package!,
      gradingArtifactError: 'Grading failure'
    },
    rawExportValidation: PERMITTED_EXPORT_VALIDATION
  });
  assert.equal(invalidGradingEligibility.canCommitProductionBaseline, false);
  assert.equal(invalidGradingEligibility.canSyncWorkingDraftSnapshot, false);

  const emptyBomEligibility = evaluateBaselineCommitEligibility({
    isCadSupported: true,
    draftValidation: baseSkirt.draftValidation,
    m05Package: {
      ...baseSkirt.m05Package!,
      bom: { ...baseSkirt.m05Package!.bom, lineItems: [] }
    },
    rawExportValidation: PERMITTED_EXPORT_VALIDATION
  });
  assert.equal(emptyBomEligibility.canCommitProductionBaseline, false);
  assert.equal(emptyBomEligibility.canSyncWorkingDraftSnapshot, false);

  // 4. Valid approved stale package -> production-baseline commit SUCCEEDS, stale->fresh, and repeated sync is idempotent
  const approvedStaleBundle = {
    ...staleUnapproved,
    rawExportValidation: PERMITTED_EXPORT_VALIDATION
  };
  let committedApprovedBaseline: ReturnType<typeof extractRevisionBaselineFromBundle>;
  const firstCommit = executeGuardedBaselineCommit({
    workspaceBundle: approvedStaleBundle,
    mode: 'production-baseline',
    onCommit: b => {
      committedApprovedBaseline = b;
    }
  });
  assert.equal(firstCommit.committed, true);
  assert.ok(committedApprovedBaseline);

  const freshApprovedBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { fabricRollWidthCm: 152 },
    previousPackageRevision: committedApprovedBaseline
  });
  assert.equal(freshApprovedBundle.upstreamStaleness.isStaleAgainstPrevious, false);

  // Repeated re-sync idempotency
  const secondCommit = executeGuardedBaselineCommit({
    workspaceBundle: {
      ...freshApprovedBundle,
      rawExportValidation: PERMITTED_EXPORT_VALIDATION
    },
    mode: 'production-baseline'
  });
  assert.equal(secondCommit.committed, true);
  assert.deepEqual(secondCommit.baseline, firstCommit.baseline);
});

test('P1-2-REV3-N05: Module 05 Circumference Ease Allocation isolates Skirt (Waist & Low Hip only) from Bodice (Bust, Waist & Low Hip) across repeated category switches', () => {
  // Pure helper verification
  assert.deepEqual(getApplicableEaseGirthsForCategory('skirt'), ['waist', 'lowHip']);
  assert.deepEqual(getApplicableEaseGirthsForCategory('bodice'), ['bust', 'waist', 'lowHip']);

  const renderOverviewForSpec = (spec: typeof SKIRT_SPEC) => {
    const bundle = buildAuthoritativeProductionWorkspaceBundle({
      designSpec: spec,
      measurements: M_SIZES,
      activeSize: 'M'
    });
    return renderToStaticMarkup(
      React.createElement(ProductionOverview, {
        currentSpec: spec,
        measurements: M_SIZES,
        activeSize: 'M',
        workspaceBundle: bundle,
        bomControls: DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
        onNavigateToCAD: () => {}
      })
    );
  };

  // Cycle 1: Skirt -> must NOT contain Bust Circumference row
  const skirtHtml1 = renderOverviewForSpec(SKIRT_SPEC);
  assert.ok(skirtHtml1.includes('data-testid="m05-ease-table"'));
  assert.ok(skirtHtml1.includes('data-testid="m05-ease-row-waist"'));
  assert.ok(skirtHtml1.includes('data-testid="m05-ease-row-lowHip"'));
  assert.ok(!skirtHtml1.includes('data-testid="m05-ease-row-bust"'), 'Skirt ease table must NEVER render bust row');
  assert.ok(!skirtHtml1.includes('Bust Circumference'), 'Skirt ease table must NEVER display Bust Circumference');

  // Cycle 2: Bodice -> must contain Bust, Waist, and Low Hip rows
  const bodiceHtml = renderOverviewForSpec(BODICE_SPEC);
  assert.ok(bodiceHtml.includes('data-testid="m05-ease-row-bust"'));
  assert.ok(bodiceHtml.includes('Bust Circumference'));
  assert.ok(bodiceHtml.includes('data-testid="m05-ease-row-waist"'));
  assert.ok(bodiceHtml.includes('data-testid="m05-ease-row-lowHip"'));

  // Cycle 3: Switch back to Skirt -> remains strictly isolated
  const skirtHtml2 = renderOverviewForSpec(SKIRT_SPEC);
  assert.ok(!skirtHtml2.includes('data-testid="m05-ease-row-bust"'));
  assert.ok(!skirtHtml2.includes('Bust Circumference'));
  assert.ok(skirtHtml2.includes('data-testid="m05-ease-row-waist"'));
  assert.ok(skirtHtml2.includes('data-testid="m05-ease-row-lowHip"'));
});

test('P1-2-REV3-N06-04: Identical engineering inputs under fresh vs stale upstream history share identical engineeringContentDigest while preserving distinct provenance-inclusive canonicalContentDigest', () => {
  const fresh = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { fabricRollWidthCm: 140 },
    createdAt: FIXED_TIMESTAMP
  });

  // Same engineering inputs, but compared against a different prior BOM fingerprint -> stale history
  const staleSameInputs = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: BODICE_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { fabricRollWidthCm: 140 },
    createdAt: FIXED_TIMESTAMP,
    previousPackageRevision: {
      ...extractRevisionBaselineFromBundle(fresh)!,
      bomFingerprint: '0'.repeat(64)
    }
  });

  assert.equal(fresh.upstreamStaleness.isStaleAgainstPrevious, false);
  assert.equal(staleSameInputs.upstreamStaleness.isStaleAgainstPrevious, true);

  // Provenance- and validation-inclusive canonicalContentDigest MUST differ because staleness & Gate 10 status differ
  assert.notEqual(
    fresh.m05Package!.canonicalContentDigest,
    staleSameInputs.m05Package!.canonicalContentDigest,
    'Provenance-inclusive canonicalContentDigest must reflect staleness & validation history'
  );

  // Pure deterministic engineeringContentDigest MUST be bit-identical for identical engineering inputs
  assert.equal(
    fresh.m05Package!.engineeringContentDigest,
    staleSameInputs.m05Package!.engineeringContentDigest,
    'Pure engineeringContentDigest must be identical regardless of prior baseline comparison history'
  );
  assert.match(fresh.m05Package!.engineeringContentDigest, /^[a-f0-9]{64}$/);
});

// ============================================================================
// P1-2 CHECKPOINT 8 FINAL CLOSEOUT — PRINT / EXPORT TECH PACK PARITY TESTS
// ============================================================================

test('P1-2-CLOSEOUT-PRINT-01: executeGuardedTechPackPrint blocks direct execution across unapproved, stale, Gate 6 failing, invalid grading, and missing context, and permits execution only when all gates pass', () => {
  let printCalls = 0;

  // 1. Unapproved package -> blocked; onPrint NOT invoked
  const unapprovedSkirt = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });
  const unapprovedRes = executeGuardedTechPackPrint({
    bundle: unapprovedSkirt.m05Package,
    exportValidation: unapprovedSkirt.exportValidation,
    onPrint: () => {
      printCalls += 1;
    }
  });
  assert.equal(unapprovedRes.permitted, false);
  assert.equal(unapprovedRes.rejectionCode, 'PATTERN_REVISION_NOT_APPROVED');
  assert.ok(unapprovedRes.blockingReasons.length > 0);
  assert.equal(printCalls, 0);

  // 2. Stale package -> blocked even if exportValidation were permitted
  const baseline = extractRevisionBaselineFromBundle(unapprovedSkirt)!;
  const staleSkirt = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M',
    bomControls: { fabricRollWidthCm: 150 },
    previousPackageRevision: baseline
  });
  const staleRes = executeGuardedTechPackPrint({
    bundle: staleSkirt.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onPrint: () => {
      printCalls += 1;
    }
  });
  assert.equal(staleRes.permitted, false);
  assert.equal(staleRes.rejectionCode, 'UPSTREAM_STAGE_STALE');
  assert.equal(printCalls, 0);

  // 3. Failing Gate 6 XXL package (Bodice Flat) -> blocked even if exportValidation were permitted
  const flatShirtBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: { ...BODICE_SPEC, id: 'spec-bodice-flat-print-test', sleeveEaseStrategy: 'flat' as const },
    measurements: M_SIZES,
    activeSize: 'M',
    governance: { sleeveEaseStrategy: 'flat' }
  });
  const flatRes = executeGuardedTechPackPrint({
    bundle: flatShirtBundle.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onPrint: () => {
      printCalls += 1;
    }
  });
  assert.equal(flatRes.permitted, false);
  assert.equal(flatRes.rejectionCode, 'M05_VALIDATION_FAILED');
  assert.equal(printCalls, 0);

  // 4. Invalid grading or missing export validation -> blocked fail-closed
  const invalidGradingRes = executeGuardedTechPackPrint({
    bundle: { ...unapprovedSkirt.m05Package!, gradingArtifactError: 'Grading failed' },
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onPrint: () => {
      printCalls += 1;
    }
  });
  assert.equal(invalidGradingRes.permitted, false);
  assert.equal(invalidGradingRes.rejectionCode, 'GRADING_VALIDATION_FAILED');

  const missingValidationRes = executeGuardedTechPackPrint({
    bundle: unapprovedSkirt.m05Package,
    exportValidation: undefined,
    onPrint: () => {
      printCalls += 1;
    }
  });
  assert.equal(missingValidationRes.permitted, false);
  assert.equal(missingValidationRes.rejectionCode, 'EXPORT_VALIDATION_MISSING');
  assert.equal(printCalls, 0);

  // 5. All gates pass -> permitted and onPrint invoked exactly once
  const permittedRes = executeGuardedTechPackPrint({
    bundle: unapprovedSkirt.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    onPrint: () => {
      printCalls += 1;
    }
  });
  assert.equal(permittedRes.permitted, true);
  assert.equal(permittedRes.rejectionCode, null);
  assert.deepEqual(permittedRes.blockingReasons, []);
  assert.equal(printCalls, 1);
});

test('P1-2-CLOSEOUT-PRINT-02: ProductionOverview disables Print / Export Tech Pack with blocked-state explanation when gated and enables it when all release gates pass', () => {
  const blockedBundle = buildAuthoritativeProductionWorkspaceBundle({
    designSpec: SKIRT_SPEC,
    measurements: M_SIZES,
    activeSize: 'M'
  });
  assert.equal(blockedBundle.exportGate.canExportCanonicalReleaseJson, false);

  const blockedHtml = renderToStaticMarkup(
    React.createElement(ProductionOverview, {
      currentSpec: SKIRT_SPEC,
      measurements: M_SIZES,
      activeSize: 'M',
      workspaceBundle: blockedBundle,
      bomControls: DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
      onNavigateToCAD: () => {}
    })
  );

  const blockedBtnMatch = blockedHtml.match(/<button[^>]*data-testid="m05-print-tech-pack-btn"[^>]*>/);
  assert.ok(blockedBtnMatch, 'Print / Export Tech Pack button must render with data-testid="m05-print-tech-pack-btn"');
  assert.ok(
    /\sdisabled(?:="")?(?=[\s>])/.test(blockedBtnMatch[0]),
    'Print / Export Tech Pack button MUST be disabled when release export is blocked'
  );
  assert.ok(
    blockedBtnMatch[0].includes('PATTERN_REVISION_NOT_APPROVED'),
    'Blocked Print / Export Tech Pack button must expose blocking reason in title/aria-label'
  );
  assert.ok(
    blockedHtml.includes('data-testid="m05-print-blocked-hint"'),
    'Blocked Print / Export Tech Pack must display visible blocked-state explanation'
  );

  // When all release gates pass, Print / Export Tech Pack is enabled and blocked hint is absent
  const permittedExportGate = evaluateProductionPackageExportGate({
    bundle: blockedBundle.m05Package,
    exportValidation: PERMITTED_EXPORT_VALIDATION
  });
  assert.equal(permittedExportGate.canExportCanonicalReleaseJson, true);

  const permittedBundle = {
    ...blockedBundle,
    exportValidation: PERMITTED_EXPORT_VALIDATION,
    exportGate: permittedExportGate
  };

  const permittedHtml = renderToStaticMarkup(
    React.createElement(ProductionOverview, {
      currentSpec: SKIRT_SPEC,
      measurements: M_SIZES,
      activeSize: 'M',
      workspaceBundle: permittedBundle,
      bomControls: DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
      onNavigateToCAD: () => {}
    })
  );

  const permittedBtnMatch = permittedHtml.match(/<button[^>]*data-testid="m05-print-tech-pack-btn"[^>]*>/);
  assert.ok(permittedBtnMatch);
  assert.ok(
    !/\sdisabled(?:="")?(?=[\s>])/.test(permittedBtnMatch[0]),
    'Print / Export Tech Pack button MUST be enabled when all release gates pass'
  );
  assert.ok(
    !permittedHtml.includes('data-testid="m05-print-blocked-hint"'),
    'Blocked-state hint must not appear when Print / Export Tech Pack is permitted'
  );

  // Confirm ProductionOverview invokes executeGuardedTechPackPrint in handler
  const m05Src = fs.readFileSync(
    path.resolve('src/features/production/ProductionOverview.tsx'),
    'utf8'
  );
  assert.ok(m05Src.includes('executeGuardedTechPackPrint('));
});
