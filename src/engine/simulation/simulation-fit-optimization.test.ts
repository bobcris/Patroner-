/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { ENHANCED_PRESET_FABRICS } from '../fabric/fabric-presets';
import {
  calibrateConstitutiveMaterial,
  clampBoundedRecipeParameters,
  createPendingAc09ToileRecord,
  evaluateAc09ToileRecord,
  evaluateQuantitativeFit,
  generateParametricAvatar,
  RECIPE_BOUNDS,
  recordAc09RepeatMeasurements,
  recordAc09ReviewerDecision,
  registerAc09PhysicalSample,
  runAnalyticalCredibilityBenchmarks,
  runBoundedPatternOptimization,
  runGarmentDrapeSimulation,
  transitionAc09WorkflowState,
  updateAc09PomMeasurement,
  validateAvatarProvenance
} from './index';

test('M06.1 REQ-BODY-01: parametric avatar carries ESTIMATED_PARAMETRIC_M02C provenance and cannot spoof MEASURED_3D_SCAN', () => {
  for (const pose of ['CANONICAL_A_POSE', 'ARM_FORWARD_45', 'SEATED_90'] as const) {
    const avatar = generateParametricAvatar(STANDARD_SIZING_SYSTEM.sizes.M, pose);
    assert.equal(avatar.sourceType, 'ESTIMATED_PARAMETRIC_M02C');
    assert.equal(validateAvatarProvenance(avatar).isValid, true);
    assert.ok(avatar.crossSectionContours.bust.circumferenceCm > 80);
    assert.ok(avatar.landmarks.BUST_APEX_LEFT.x < 0);
    assert.ok(avatar.landmarks.BUST_APEX_RIGHT.x > 0);
    assert.ok(avatar.measurementUncertaintyCm.crossSectionEccentricity >= 1.0);

    const spoofed = { ...avatar, sourceType: 'MEASURED_3D_SCAN' as const };
    const check = validateAvatarProvenance(spoofed);
    assert.equal(check.isValid, false);
    assert.ok(check.errors.length >= 1);
  }
});

test('M06.3 ADR-005: material constitutive tensor satisfies orthotropic symmetry, positive definiteness, and 3-tier gating across presets', () => {
  assert.ok(ENHANCED_PRESET_FABRICS.length >= 4);
  for (const fabric of ENHANCED_PRESET_FABRICS) {
    const mat = calibrateConstitutiveMaterial(fabric);
    assert.equal(mat.evidenceTier, 'TIER_3_PRIOR');
    assert.equal(mat.thermodynamicallyAdmissible, true, `${fabric.id} failed admissibility`);
    assert.ok(mat.symmetryResidual <= 1e-9);
    assert.ok(mat.determinant2D > 0);
    assert.ok(mat.eWarpNCm > 0 && mat.eWeftNCm > 0 && mat.gShearNCm > 0);
  }

  const wool = ENHANCED_PRESET_FABRICS.find(f => f.id === 'wool-crepe')!;
  const benchtop = calibrateConstitutiveMaterial({
    ...wool,
    isVerified: true,
    provenance: 'supplier-declared'
  });
  assert.equal(benchtop.evidenceTier, 'TIER_2_BENCHTOP');

  const labCertified = calibrateConstitutiveMaterial({
    ...wool,
    isVerified: true,
    provenance: 'laboratory-tested'
  });
  assert.equal(labCertified.evidenceTier, 'TIER_1_LAB');
});

test('M06.3 AC-08: multi-resolution analytical benchmarks B1-B4 (including 8mm->4mm B4) pass across multiple fabrics and fail closed on invalid tensors', () => {
  const fabricsToTest = ENHANCED_PRESET_FABRICS.slice(0, 4);
  for (const fabric of fabricsToTest) {
    const mat = calibrateConstitutiveMaterial(fabric);
    const report = runAnalyticalCredibilityBenchmarks(mat);
    assert.equal(report.benchmarks.length, 4);
    assert.equal(report.allPassed, true, `${fabric.id}: ${report.failureReason ?? ''}`);
    for (const b of report.benchmarks) {
      assert.equal(b.passed, true, `${fabric.id} ${b.benchmarkId} failed: ${b.notes}`);
      assert.ok(b.resolutionChecks.length >= 2, `${b.benchmarkId} missing multi-resolution checks`);
      assert.ok(b.resolutionChecks.every(rc => rc.passed), `${b.benchmarkId} failed a resolution check`);
    }
    const b4 = report.benchmarks.find(b => b.benchmarkId === 'B4_MESH_CONVERGENCE')!;
    assert.ok(
      b4.resolutionChecks.some(rc => rc.meshEdgeLengthMm === 4),
      'B4 must explicitly verify M06 §10.2 8mm -> 4mm refinement'
    );
  }

  // Fail-closed test on thermodynamically inadmissible material constitutive tensor
  const brokenMat = {
    ...calibrateConstitutiveMaterial(INITIAL_CONCEPTS[0].fabric),
    eWarpNCm: -15,
    determinant2D: -5,
    thermodynamicallyAdmissible: false
  };
  const brokenBench = runAnalyticalCredibilityBenchmarks(brokenMat);
  assert.equal(brokenBench.allPassed, false);
  assert.equal(brokenBench.benchmarks.find(b => b.benchmarkId === 'B1_UNIAXIAL_MEMBRANE')?.passed, false);

  const skirtSpec = INITIAL_CONCEPTS[0];
  const mSizes = STANDARD_SIZING_SYSTEM.sizes.M;
  const skirtPieces = draftSkirtBlock(mSizes, skirtSpec);
  const simCheck = runGarmentDrapeSimulation({
    pieces: skirtPieces,
    designSpec: { ...skirtSpec, fabric: { ...skirtSpec.fabric, id: 'wool-crepe' } },
    measurements: mSizes
  });
  assert.equal(simCheck.epistemicLayers.analyticalQualification, 'AC-08_PASSED');
});

test('M06.2/M06.3/M06.4: Skirt and Bodice+Sleeve 3D drape simulations converge with 0 interpenetration, clean topology, L/R symmetry, and garment mesh consistency', () => {
  const skirtSpec = INITIAL_CONCEPTS[0];
  const mSizes = STANDARD_SIZING_SYSTEM.sizes.M;
  const skirtPieces = draftSkirtBlock(mSizes, skirtSpec);
  const skirtSim = runGarmentDrapeSimulation({
    pieces: skirtPieces,
    designSpec: skirtSpec,
    measurements: mSizes,
    poseId: 'CANONICAL_A_POSE'
  });

  assert.equal(skirtSim.convergenceVerified, true, skirtSim.failureReason);
  assert.equal(skirtSim.energyConverging, true);
  assert.equal(skirtSim.interpenetratingTriangles, 0);
  assert.equal(skirtSim.selfIntersectingTriangles, 0, 'Skirt had non-adjacent self-intersecting triangles');
  assert.equal(skirtSim.topologyDiagnostics.degenerateTriangleCount, 0);
  assert.equal(skirtSim.topologyDiagnostics.manifoldIntegrityVerified, true);
  assert.ok(skirtSim.topologyDiagnostics.minInteriorAngleDeg > 5);
  assert.ok(skirtSim.topologyDiagnostics.leftRightSymmetryErrorCm < 0.15);
  assert.ok(skirtSim.minBodyClearanceCm >= 0.05);
  assert.ok(skirtSim.triangleCount > 20);
  assert.equal(skirtSim.isProductionReady, false);
  assert.equal(skirtSim.epistemicLayers.physicalToileValidation, 'AC-09_PENDING');

  // Garment mesh refinement consistency check on Skirt (3.6 cm vs 2.6 cm)
  const skirtFine = runGarmentDrapeSimulation({
    pieces: skirtPieces,
    designSpec: skirtSpec,
    measurements: mSizes,
    poseId: 'CANONICAL_A_POSE',
    meshEdgeLengthCm: 2.6
  });
  assert.equal(skirtFine.convergenceVerified, true);
  assert.ok(skirtFine.triangleCount > skirtSim.triangleCount);

  const skirtFit = evaluateQuantitativeFit(
    skirtSim,
    generateParametricAvatar(mSizes, 'CANONICAL_A_POSE'),
    skirtSpec,
    mSizes
  );
  const skirtFitFine = evaluateQuantitativeFit(
    skirtFine,
    generateParametricAvatar(mSizes, 'CANONICAL_A_POSE'),
    skirtSpec,
    mSizes
  );
  assert.ok(
    Math.abs(skirtFit.regionalZones.low_hip.actualEaseCm - skirtFitFine.regionalZones.low_hip.actualEaseCm) < 1.2,
    'Skirt hip ease drifted unexpectedly across mesh refinement'
  );
  assert.equal(skirtFit.prohibitsUniversalScalarScore, true);
  assert.equal(skirtFit.physicalValidationRequired, true);
  assert.equal(skirtFit.isProductionReady, false);
  assert.ok(skirtFit.documentedAssumptions.length >= 3);
  assert.ok(skirtFit.hemLevelDeviationCm < 0.8, `Expected crisp level skirt hem, got ${skirtFit.hemLevelDeviationCm}`);
  assert.ok(skirtFit.grainlinePlumbDeviationDeg < 1.0);
  assert.ok(skirtFit.regionalZones.high_hip.maxStrainPct < 15);
  assert.ok(skirtFit.evaluatedZoneOrder.includes('waist'));
  assert.ok(skirtFit.evaluatedZoneOrder.includes('low_hip'));

  const bodiceSpec = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!;
  const bodiceBody = draftBodiceBlock(mSizes, bodiceSpec, { dartStyle: 'waist' });
  const sleeveRes = draftSleeveBlock(mSizes, bodiceSpec, { strategy: 'classic', bodicePieces: bodiceBody });
  const bodicePieces = [...bodiceBody, sleeveRes.piece];

  for (const pose of ['CANONICAL_A_POSE', 'ARM_FORWARD_45', 'SEATED_90'] as const) {
    const bodiceSim = runGarmentDrapeSimulation({
      pieces: bodicePieces,
      designSpec: bodiceSpec,
      measurements: mSizes,
      poseId: pose
    });
    assert.equal(bodiceSim.convergenceVerified, true, `${pose}: ${bodiceSim.failureReason}`);
    assert.equal(bodiceSim.energyConverging, true);
    assert.equal(bodiceSim.interpenetratingTriangles, 0, `${pose} had body interpenetrating triangles`);
    assert.equal(bodiceSim.selfIntersectingTriangles, 0, `${pose} had cloth self-intersecting triangles`);
    assert.equal(bodiceSim.topologyDiagnostics.degenerateTriangleCount, 0, `${pose} had degenerate triangles`);
    assert.ok(bodiceSim.topologyDiagnostics.leftRightSymmetryErrorCm < 0.15, `${pose} broke L/R symmetry`);
    assert.ok(bodiceSim.seamEdgeCount >= 16);

    const bodiceFit = evaluateQuantitativeFit(
      bodiceSim,
      generateParametricAvatar(mSizes, pose),
      bodiceSpec,
      mSizes
    );
    assert.ok(bodiceFit.evaluatedZoneOrder.includes('bust'));
    assert.ok(bodiceFit.evaluatedZoneOrder.includes('biceps_sleeve'));
    assert.ok(bodiceFit.documentedAssumptions.length >= 3);
    assert.ok(
      bodiceFit.regionalZones.waist.maxStrainPct < 15,
      `${pose} waist strain too high: ${bodiceFit.regionalZones.waist.maxStrainPct}`
    );
    assert.ok(
      bodiceFit.regionalZones.bust.maxStrainPct < 45,
      `${pose} bust strain exploded (possible panel inversion): ${bodiceFit.regionalZones.bust.maxStrainPct}`
    );
    assert.ok(bodiceFit.hemLevelDeviationCm < 3.0);
  }
});

test('M06.5 ADR-006: bounded Pareto optimizer is deterministic, enforces ±1.5 cm limits, rejects invalid M02 candidates, and never auto-approves', () => {
  const clamped = clampBoundedRecipeParameters({
    bustEaseDeltaCm: 12.5,
    waistEaseDeltaCm: -9.0,
    hipEaseDeltaCm: 0.75
  });
  assert.equal(clamped.bustEaseDeltaCm, RECIPE_BOUNDS.bustEaseDeltaCm.max);
  assert.equal(clamped.waistEaseDeltaCm, RECIPE_BOUNDS.waistEaseDeltaCm.min);
  assert.equal(clamped.hipEaseDeltaCm, 0.75);

  const bodiceSpec = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!;
  const run1 = runBoundedPatternOptimization({
    currentSpec: bodiceSpec,
    measurements: STANDARD_SIZING_SYSTEM.sizes.M,
    poseId: 'CANONICAL_A_POSE'
  });
  const run2 = runBoundedPatternOptimization({
    currentSpec: bodiceSpec,
    measurements: STANDARD_SIZING_SYSTEM.sizes.M,
    poseId: 'CANONICAL_A_POSE'
  });

  assert.equal(run1.requiresHumanApproval, true);
  assert.ok(run1.evaluatedCandidatesCount >= 4);
  assert.ok(run1.proposals.length >= 1);
  assert.deepEqual(
    run1.proposals.map(p => p.parameterDeltas),
    run2.proposals.map(p => p.parameterDeltas),
    'Optimizer ranking must be strictly deterministic across repeated runs'
  );

  for (const prop of run1.proposals) {
    assert.equal(prop.independentM02ValidationPassed, true);
    assert.equal(prop.requiresHumanApproval, true);
    assert.equal(prop.proposedDesignSpec.isApproved, false);
    assert.equal(prop.proposedDesignSpec.approvalState, 'draft');
    assert.ok(prop.regionalDeltaSummary.length >= 4);
    assert.ok(Math.abs(prop.parameterDeltas.bustEaseDeltaCm) <= 1.5);
    assert.ok(Math.abs(prop.parameterDeltas.waistEaseDeltaCm) <= 1.5);
  }

  // Test rejection path when an extreme invalid measurement breaks M02/M04.3 drafting re-validation
  const impossibleSleeveSpec = {
    ...bodiceSpec,
    explicitEaseCm: { bust: -12, waist: -12, hip: -12 }
  };
  const rejectedRun = runBoundedPatternOptimization({
    currentSpec: impossibleSleeveSpec,
    measurements: { ...STANDARD_SIZING_SYSTEM.sizes.M, armholeDepth: 2 },
    candidateOverrides: [
      { bustEaseDeltaCm: -1.5, waistEaseDeltaCm: -1.5, hipEaseDeltaCm: 0, sleeveEaseStrategy: 'fitted' }
    ]
  });
  assert.ok(rejectedRun.rejectedByM02Count >= 1);
  assert.ok(rejectedRun.rejectionReasons.length >= 1);
  assert.equal(rejectedRun.proposals.length, 0);
});

test('M06 §18 AC-09: Physical Toile Validation Protocol starts strictly PENDING with zero fabricated data and enforces <= 0.50 cm POM & >= 85% regional agreement', () => {
  const skirtSpec = INITIAL_CONCEPTS[0];
  const bodiceSpec = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!;
  const mSizes = STANDARD_SIZING_SYSTEM.sizes.M;

  // 1. Both skirt-block-v1 and bodice-sleeve-v1 start strictly PENDING with zero fabricated measurements
  let skirtToile = createPendingAc09ToileRecord({
    toileBlockKey: 'skirt-block-v1',
    designSpec: skirtSpec,
    measurements: mSizes
  });
  let bodiceToile = createPendingAc09ToileRecord({
    toileBlockKey: 'bodice-sleeve-v1',
    designSpec: bodiceSpec,
    measurements: mSizes
  });

  assert.equal(evaluateAc09ToileRecord(skirtToile).status, 'PENDING');
  assert.equal(evaluateAc09ToileRecord(bodiceToile).status, 'PENDING');
  assert.equal(evaluateAc09ToileRecord(bodiceToile).isProductionReady, false);

  // 2. Partial data returns INCOMPLETE (never PASSED)
  bodiceToile = updateAc09PomMeasurement(bodiceToile, bodiceToile.pomCheckpoints[0].pointId, bodiceToile.pomCheckpoints[0].nominalCadCm + 0.1);
  assert.equal(evaluateAc09ToileRecord(bodiceToile).status, 'INCOMPLETE');

  // 3. Out-of-tolerance POM (> 0.50 cm) returns FAILED
  bodiceToile = updateAc09PomMeasurement(bodiceToile, bodiceToile.pomCheckpoints[1].pointId, bodiceToile.pomCheckpoints[1].nominalCadCm + 0.85);
  assert.equal(evaluateAc09ToileRecord(bodiceToile).status, 'FAILED');

  // 4. Legacy executionMode MUST NOT bypass mandatory traceability, process log, attachment URIs, or reviewer sign-off (P1-2C)
  let legacyAttempt = createPendingAc09ToileRecord({
    toileBlockKey: 'skirt-block-v1',
    designSpec: skirtSpec,
    measurements: mSizes,
    executionMode: 'legacy'
  });
  for (const pt of legacyAttempt.pomCheckpoints) {
    legacyAttempt = updateAc09PomMeasurement(legacyAttempt, pt.pointId, Number((pt.nominalCadCm + 0.2).toFixed(2)));
  }
  legacyAttempt = {
    ...legacyAttempt,
    evaluatorName: 'Elena Rostova (Lead Patternmaker)',
    bodyOrDressFormId: 'Wolf-M-Form-01',
    evaluatedAt: '2026-11-19',
    grainlineVerified: true,
    seamAlignmentVerified: true,
    hemLevelPhysicalDeviationCm: 0.3,
    regionalAgreementChecks: legacyAttempt.regionalAgreementChecks.map(z => ({
      ...z,
      agreesWithDigitalPrediction: true,
      physicalObservationSummary: 'Physical drape aligns with digital zone eases.'
    })),
    evidenceChecklist: legacyAttempt.evidenceChecklist.map(ev => ({ ...ev, recorded: true }))
  };
  const legacyBlockedEval = evaluateAc09ToileRecord(legacyAttempt);
  assert.notEqual(legacyBlockedEval.status, 'PASSED');
  assert.equal(legacyBlockedEval.status, 'INCOMPLETE');
  assert.equal(legacyBlockedEval.isProductionReady, false);

  // 5. Complete physical evidence + traceability + cuttingGrainlineVerified + attachment URIs reaches READY_FOR_REVIEW,
  // and ONLY transitions to PASSED after authorized human reviewer sign-off (still isProductionReady=false)
  let registeredSkirt = createPendingAc09ToileRecord({
    toileBlockKey: 'skirt-block-v1',
    designSpec: skirtSpec,
    measurements: mSizes,
    executionMode: 'workflow'
  });
  registeredSkirt = registerAc09PhysicalSample(registeredSkirt, {
    sampleId: 'TOILE-SKT-M06-TEST-01',
    recordedPatternRevisionId: registeredSkirt.traceability!.approvedPatternRevisionId,
    recordedFabricId: registeredSkirt.fabricId,
    recordedFabricComposition: registeredSkirt.traceability!.expectedFabricComposition,
    recordedFabricWeightGsm: registeredSkirt.traceability!.expectedFabricWeightGsm,
    recordedFabricStretchPct: registeredSkirt.traceability!.expectedFabricStretchPct,
    recordedFabricDirection: registeredSkirt.traceability!.expectedFabricDirection,
    recordedFabricLot: 'LOT-TEST-01',
    bodyOrDressFormId: 'Wolf-M-Form-01',
    evaluatorName: 'Elena Rostova (Lead Patternmaker)',
    evaluatedAt: '2026-11-19',
    processRecord: {
      cuttingOperator: 'Elena Rostova',
      cutDate: '2026-11-18',
      cuttingGrainlineVerified: true,
      sewingOperator: 'Marco Bellini',
      sewnDate: '2026-11-18',
      seamAllowanceCm: 1.5,
      stitchType: 'ISO-301 lockstitch',
      pressingMethod: 'Steam pressed open'
    }
  });
  for (const pt of registeredSkirt.pomCheckpoints) {
    const readingA = Number((pt.nominalCadCm + 0.15).toFixed(2));
    const readingB = Number((pt.nominalCadCm + 0.25).toFixed(2));
    registeredSkirt = recordAc09RepeatMeasurements(registeredSkirt, pt.pointId, [readingA, readingB]);
  }
  registeredSkirt = {
    ...registeredSkirt,
    grainlineVerified: true,
    seamAlignmentVerified: true,
    hemLevelPhysicalDeviationCm: 0.3,
    regionalAgreementChecks: registeredSkirt.regionalAgreementChecks.map(z => ({
      ...z,
      agreesWithDigitalPrediction: true,
      physicalObservationSummary: 'Physical drape aligns with digital zone eases.'
    })),
    evidenceChecklist: registeredSkirt.evidenceChecklist.map(ev => ({
      ...ev,
      recorded: true,
      attachmentUri: `photo://atelier/skirt-block-v1/${ev.itemId}.jpg`
    }))
  };

  // Before authorized sign-off, status must stay INCOMPLETE / READY_FOR_REVIEW
  const readyEval = evaluateAc09ToileRecord(registeredSkirt);
  assert.equal(readyEval.status, 'INCOMPLETE');
  assert.equal(readyEval.workflowState, 'READY_FOR_REVIEW');

  const readyForReviewSkirt = transitionAc09WorkflowState(registeredSkirt, 'READY_FOR_REVIEW');
  const signedSkirt = recordAc09ReviewerDecision(readyForReviewSkirt, {
    reviewerName: 'Elena Rostova',
    reviewerRole: 'LEAD_PATTERNMAKER',
    decision: 'APPROVED_PASS',
    rationale: 'Test fixture verifying fail-closed authorized sign-off.',
    decidedAt: '2026-11-19'
  });
  const passEval = evaluateAc09ToileRecord(signedSkirt);
  assert.equal(passEval.status, 'PASSED');
  assert.ok((passEval.maxPomConcordanceErrorCm ?? 1) <= 0.5);
  assert.equal(passEval.regionalAgreementPct, 100);
  assert.equal(passEval.isProductionReady, false);

  // 6. Regional agreement < 85% fails AC-09 even when POMs pass
  const disagreeSkirt = {
    ...registeredSkirt,
    regionalAgreementChecks: registeredSkirt.regionalAgreementChecks.map((z, idx) => ({
      ...z,
      agreesWithDigitalPrediction: idx < 2
    }))
  };
  const failAgreementEval = evaluateAc09ToileRecord(disagreeSkirt);
  assert.equal(failAgreementEval.status, 'FAILED');
  assert.equal(failAgreementEval.regionalAgreementPct, 50);
});
