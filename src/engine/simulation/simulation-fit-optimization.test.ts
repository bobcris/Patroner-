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
  evaluateQuantitativeFit,
  generateParametricAvatar,
  RECIPE_BOUNDS,
  runAnalyticalCredibilityBenchmarks,
  runBoundedPatternOptimization,
  runGarmentDrapeSimulation,
  validateAvatarProvenance
} from './index';

test('M06.1 REQ-BODY-01: parametric avatar carries ESTIMATED_PARAMETRIC_M02C provenance and cannot spoof MEASURED_3D_SCAN', () => {
  const avatar = generateParametricAvatar(STANDARD_SIZING_SYSTEM.sizes.M, 'CANONICAL_A_POSE');
  assert.equal(avatar.sourceType, 'ESTIMATED_PARAMETRIC_M02C');
  assert.equal(validateAvatarProvenance(avatar).isValid, true);
  assert.ok(avatar.crossSectionContours.bust.circumferenceCm > 80);
  assert.ok(avatar.landmarks.BUST_APEX_LEFT.x < 0);
  assert.ok(avatar.landmarks.BUST_APEX_RIGHT.x > 0);

  const spoofed = { ...avatar, sourceType: 'MEASURED_3D_SCAN' as const };
  const check = validateAvatarProvenance(spoofed);
  assert.equal(check.isValid, false);
  assert.ok(check.errors.length >= 1);
});

test('M06.3 ADR-005: material constitutive tensor satisfies orthotropic symmetry, positive definiteness, and 3-tier gating', () => {
  const wool = ENHANCED_PRESET_FABRICS.find(f => f.id === 'wool-crepe')!;
  const mat = calibrateConstitutiveMaterial(wool);
  assert.equal(mat.evidenceTier, 'TIER_3_PRIOR');
  assert.equal(mat.thermodynamicallyAdmissible, true);
  assert.ok(mat.symmetryResidual <= 1e-9);
  assert.ok(mat.determinant2D > 0);
  assert.ok(mat.eWarpNCm > 0 && mat.eWeftNCm > 0 && mat.gShearNCm > 0);

  const labCertified = calibrateConstitutiveMaterial({
    ...wool,
    isVerified: true,
    provenance: 'laboratory-tested'
  });
  assert.equal(labCertified.evidenceTier, 'TIER_1_LAB');
});

test('M06.3 AC-08: closed-form analytical benchmarks B1-B4 pass inside strict tolerances', () => {
  const mat = calibrateConstitutiveMaterial(INITIAL_CONCEPTS[0].fabric);
  const report = runAnalyticalCredibilityBenchmarks(mat);
  assert.equal(report.benchmarks.length, 4);
  for (const b of report.benchmarks) {
    assert.equal(b.passed, true, `${b.benchmarkId} failed: ${b.notes} (err=${b.errorValue}, lim=${b.toleranceLimit})`);
  }
  assert.equal(report.allPassed, true);
});

test('M06.2/M06.3/M06.4: Skirt and Bodice+Sleeve 3D drape simulations converge across poses with 0 interpenetrating triangles and physical regional fit metrics', () => {
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
  assert.equal(skirtSim.interpenetratingTriangles, 0);
  assert.ok(skirtSim.minBodyClearanceCm >= 0.05);
  assert.ok(skirtSim.triangleCount > 20);
  assert.equal(skirtSim.isProductionReady, false);

  const skirtFit = evaluateQuantitativeFit(
    skirtSim,
    generateParametricAvatar(mSizes, 'CANONICAL_A_POSE'),
    skirtSpec,
    mSizes
  );
  assert.equal(skirtFit.prohibitsUniversalScalarScore, true);
  assert.equal(skirtFit.physicalValidationRequired, true);
  assert.equal(skirtFit.isProductionReady, false);
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
    assert.equal(bodiceSim.interpenetratingTriangles, 0, `${pose} had interpenetrating triangles`);
    assert.ok(bodiceSim.seamEdgeCount >= 16);

    const bodiceFit = evaluateQuantitativeFit(
      bodiceSim,
      generateParametricAvatar(mSizes, pose),
      bodiceSpec,
      mSizes
    );
    assert.ok(bodiceFit.evaluatedZoneOrder.includes('bust'));
    assert.ok(bodiceFit.evaluatedZoneOrder.includes('biceps_sleeve'));
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

test('M06.5 ADR-006: bounded Pareto optimizer enforces ±1.5 cm box limits, independent M02 re-validation, and human approval gate', () => {
  const clamped = clampBoundedRecipeParameters({
    bustEaseDeltaCm: 12.5,
    waistEaseDeltaCm: -9.0,
    hipEaseDeltaCm: 0.75
  });
  assert.equal(clamped.bustEaseDeltaCm, RECIPE_BOUNDS.bustEaseDeltaCm.max);
  assert.equal(clamped.waistEaseDeltaCm, RECIPE_BOUNDS.waistEaseDeltaCm.min);
  assert.equal(clamped.hipEaseDeltaCm, 0.75);

  const bodiceSpec = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!;
  const optResult = runBoundedPatternOptimization({
    currentSpec: bodiceSpec,
    measurements: STANDARD_SIZING_SYSTEM.sizes.M,
    poseId: 'CANONICAL_A_POSE'
  });

  assert.equal(optResult.requiresHumanApproval, true);
  assert.ok(optResult.evaluatedCandidatesCount >= 4);
  assert.ok(optResult.proposals.length >= 1);

  for (const prop of optResult.proposals) {
    assert.equal(prop.independentM02ValidationPassed, true);
    assert.equal(prop.requiresHumanApproval, true);
    assert.equal(prop.proposedDesignSpec.isApproved, false);
    assert.equal(prop.proposedDesignSpec.approvalState, 'draft');
    assert.ok(Math.abs(prop.parameterDeltas.bustEaseDeltaCm) <= 1.5);
    assert.ok(Math.abs(prop.parameterDeltas.waistEaseDeltaCm) <= 1.5);
  }
});
