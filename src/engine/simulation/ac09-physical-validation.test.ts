/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import {
  Ac09PhysicalToileRecord,
  AC09_POM_CONCORDANCE_TOLERANCE_CM,
  AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT,
  assertAc09RecordEditable,
  createNewAc09SampleRevision,
  createPendingAc09ToileRecord,
  DEFAULT_AC09_TOLERANCE_POLICY,
  evaluateAc09ToileRecord,
  recordAc09RepeatMeasurements,
  recordAc09ReviewerDecision,
  registerAc09PhysicalSample,
  serializeAc09ValidationReport,
  transitionAc09WorkflowState,
  updateAc09PomMeasurement,
  validateAc09TolerancePolicy
} from './index';

function buildWorkflowPassingFixture(blockKey: 'skirt-block-v1' | 'bodice-sleeve-v1'): Ac09PhysicalToileRecord {
  const spec =
    blockKey === 'bodice-sleeve-v1'
      ? INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!
      : INITIAL_CONCEPTS[0];
  const mSizes = STANDARD_SIZING_SYSTEM.sizes.M;

  let record = createPendingAc09ToileRecord({
    toileBlockKey: blockKey,
    designSpec: spec,
    measurements: mSizes,
    constructionDocRef: `m05-pkg-${spec.id}-M`,
    simulationCaseRef: `sim-${blockKey}-canonical-a`,
    executionMode: 'workflow'
  });

  const expectedRev = record.traceability!.approvedPatternRevisionId;
  record = registerAc09PhysicalSample(record, {
    sampleId: `TOILE-${blockKey.toUpperCase()}-M-001`,
    recordedPatternRevisionId: expectedRev,
    recordedFabricId: spec.fabric.id,
    recordedFabricComposition: record.traceability!.expectedFabricComposition,
    recordedFabricWeightGsm: record.traceability!.expectedFabricWeightGsm,
    recordedFabricStretchPct: record.traceability!.expectedFabricStretchPct,
    recordedFabricDirection: 'WARP_GRAINLINE_PARALLEL',
    recordedFabricLot: 'LOT-MILL-2026-11A',
    constructionDocRef: `m05-pkg-${spec.id}-M`,
    simulationCaseRef: `sim-${blockKey}-canonical-a`,
    bodyOrDressFormId: 'Wolf-M-Atelier-01',
    evaluatorName: 'Elena Rostova',
    evaluatedAt: '2026-11-19',
    measurementInstrument: 'calibrated-fiberglass-tape',
    processRecord: {
      cuttingOperator: 'Clara Moreau',
      cutDate: '2026-11-18',
      cuttingGrainlineVerified: true,
      sewingOperator: 'Kenji Takahashi',
      sewnDate: '2026-11-18',
      seamAllowanceCm: 1.5,
      stitchType: 'ISO-301 lockstitch 12 SPI',
      pressingMethod: 'Steam pressed open on ham'
    }
  });

  for (const pt of record.pomCheckpoints) {
    record = recordAc09RepeatMeasurements(record, pt.pointId, [
      Number((pt.nominalCadCm + 0.15).toFixed(2)),
      Number((pt.nominalCadCm + 0.25).toFixed(2))
    ]);
  }

  record = {
    ...record,
    grainlineVerified: true,
    seamAlignmentVerified: true,
    hemLevelPhysicalDeviationCm: 0.25,
    regionalAgreementChecks: record.regionalAgreementChecks.map(z => ({
      ...z,
      agreesWithDigitalPrediction: true,
      physicalObservationSummary: `Dress form verification matches ${z.digitalPredictionStatus} prediction.`
    })),
    evidenceChecklist: record.evidenceChecklist.map(ev => ({
      ...ev,
      recorded: true,
      attachmentUri: `photo://atelier/${blockKey}/${ev.itemId}.jpg`,
      capturedAt: '2026-11-19'
    }))
  };

  return record;
}

test('AC09-01: Default records start strictly PENDING with zero fabricated data and emit missing-evidence diagnostics in workflow mode', () => {
  const skirtSpec = INITIAL_CONCEPTS[0];
  const bodiceSpec = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!;
  const mSizes = STANDARD_SIZING_SYSTEM.sizes.M;

  const skirtPending = createPendingAc09ToileRecord({
    toileBlockKey: 'skirt-block-v1',
    designSpec: skirtSpec,
    measurements: mSizes
  });
  const bodicePending = createPendingAc09ToileRecord({
    toileBlockKey: 'bodice-sleeve-v1',
    designSpec: bodiceSpec,
    measurements: mSizes
  });

  const skirtEval = evaluateAc09ToileRecord(skirtPending);
  const bodiceEval = evaluateAc09ToileRecord(bodicePending);

  assert.equal(skirtEval.status, 'PENDING');
  assert.equal(bodiceEval.status, 'PENDING');
  assert.equal(skirtEval.completedPomCount, 0);
  assert.equal(bodiceEval.completedPomCount, 0);
  assert.equal(skirtEval.isProductionReady, false);

  // Workflow DRAFT with only registration transitions to SAMPLE_REGISTERED and lists exact missing diagnostics
  let registered = registerAc09PhysicalSample(bodicePending, {
    sampleId: 'TOILE-BOD-001',
    recordedPatternRevisionId: bodicePending.traceability!.approvedPatternRevisionId
  });
  let regEval = evaluateAc09ToileRecord(registered);
  assert.equal(regEval.workflowState, 'SAMPLE_REGISTERED');
  assert.equal(regEval.status, 'INCOMPLETE');
  assert.ok(regEval.missingEvidenceDiagnostics.some(d => d.includes('Missing physical POM reading')));
  assert.ok(regEval.missingEvidenceDiagnostics.some(d => d.includes('cutting or sewing process execution log')));

  // Adding partial POMs advances to EVIDENCE_INCOMPLETE with attachment & regional diagnostics
  registered = recordAc09RepeatMeasurements(registered, registered.pomCheckpoints[0].pointId, [
    registered.pomCheckpoints[0].nominalCadCm + 0.1
  ]);
  regEval = evaluateAc09ToileRecord(registered);
  assert.equal(regEval.workflowState, 'EVIDENCE_INCOMPLETE');
  assert.equal(regEval.status, 'INCOMPLETE');
});

test('AC09-02: Repeat measurement capture computes mean, spread, and combined instrument uncertainty and rejects excessive spread', () => {
  let rec = buildWorkflowPassingFixture('bodice-sleeve-v1');
  const firstPom = rec.pomCheckpoints[0];
  assert.equal(firstPom.unit, 'cm');
  assert.ok(firstPom.checkpointDefinition && firstPom.checkpointDefinition.length > 10);
  assert.equal(firstPom.repeatReadingsCm?.length, 2);
  assert.equal(firstPom.repeatSpreadCm, 0.1);
  // sqrt(0.05^2 + 0.05^2) = 0.0707 cm
  assert.ok(Math.abs((firstPom.combinedUncertaintyCm ?? 0) - 0.0707) < 0.002);

  // Readings with 0.60 cm operator spread yield combined uncertainty > 0.25 cm -> fails uncertainty check
  rec = recordAc09RepeatMeasurements(rec, firstPom.pointId, [
    Number((firstPom.nominalCadCm - 0.3).toFixed(2)),
    Number((firstPom.nominalCadCm + 0.3).toFixed(2))
  ]);
  const unstableEval = evaluateAc09ToileRecord(rec);
  assert.equal(unstableEval.status, 'FAILED');
  assert.ok((unstableEval.maxMeasurementUncertaintyCm ?? 0) > DEFAULT_AC09_TOLERANCE_POLICY.maxAllowedUncertaintyCm);
  assert.ok(unstableEval.blockingReasons.some(r => r.includes('repeat measurement uncertainty')));

  // Non-positive or NaN readings throw fail-closed error
  assert.throws(
    () => recordAc09RepeatMeasurements(rec, firstPom.pointId, [0]),
    /AC09_INVALID_POM_READING/
  );
  assert.throws(
    () => recordAc09RepeatMeasurements(rec, firstPom.pointId, [Number.NaN]),
    /AC09_INVALID_POM_READING/
  );
});

test('AC09-03: Authoritative boundary tolerances (0.50 cm POM & 85% regional agreement) are enforced exactly and cannot be silently relaxed', () => {
  assert.equal(AC09_POM_CONCORDANCE_TOLERANCE_CM, 0.5);
  assert.equal(AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT, 85);

  // Refuses silent relaxation of limits
  assert.throws(
    () =>
      validateAc09TolerancePolicy({
        ...DEFAULT_AC09_TOLERANCE_POLICY,
        pomToleranceCm: 0.65
      }),
    /AC09_INVALID_TOLERANCE_POLICY/
  );
  assert.throws(
    () =>
      validateAc09TolerancePolicy({
        ...DEFAULT_AC09_TOLERANCE_POLICY,
        regionalAgreementMinPct: 80
      }),
    /AC09_INVALID_TOLERANCE_POLICY/
  );

  // Exact +0.500 cm POM boundary passes READY_FOR_REVIEW; +0.501 cm fails immediately
  let skirt = buildWorkflowPassingFixture('skirt-block-v1');
  const targetPom = skirt.pomCheckpoints[0];
  skirt = updateAc09PomMeasurement(skirt, targetPom.pointId, Number((targetPom.nominalCadCm + 0.5).toFixed(3)));
  const exactBoundaryEval = evaluateAc09ToileRecord(skirt);
  assert.equal(exactBoundaryEval.pomConcordancePassed, true);
  assert.equal(exactBoundaryEval.workflowState, 'READY_FOR_REVIEW');

  const overBoundarySkirt = updateAc09PomMeasurement(
    skirt,
    targetPom.pointId,
    Number((targetPom.nominalCadCm + 0.501).toFixed(3))
  );
  const overBoundaryEval = evaluateAc09ToileRecord(overBoundarySkirt);
  assert.equal(overBoundaryEval.pomConcordancePassed, false);
  assert.equal(overBoundaryEval.status, 'FAILED');
});

test('AC09-04: Regional agreement percentages (100% pass vs 80% / 4-of-5 fail on bodice-sleeve-v1) and separated digital vs physical records', () => {
  const bodice = buildWorkflowPassingFixture('bodice-sleeve-v1');
  // 5 zones in bodice-sleeve-v1 -> 4 agree = 80.0% < 85% -> FAILED
  const fourOfFive: Ac09PhysicalToileRecord = {
    ...bodice,
    regionalAgreementChecks: bodice.regionalAgreementChecks.map((z, idx) => ({
      ...z,
      agreesWithDigitalPrediction: idx < 4,
      physicalObservationSummary: idx === 4 ? 'Waist physical ease felt 1.5 cm tighter than simulated.' : z.physicalObservationSummary
    }))
  };
  const fourOfFiveEval = evaluateAc09ToileRecord(fourOfFive);
  assert.equal(fourOfFiveEval.regionalAgreementPct, 80);
  assert.equal(fourOfFiveEval.regionalAgreementPassed, false);
  assert.equal(fourOfFiveEval.status, 'FAILED');

  // Verify 7-zone custom regional check: 6/7 = 85.7% >= 85% passes, 5/7 = 71.4% fails
  const sevenZonesBase = [
    ...bodice.regionalAgreementChecks,
    {
      zoneId: 'high_hip' as const,
      zoneLabel: 'High Hip',
      digitalPredictionStatus: 'PASS' as const,
      digitalPredictedIssue: 'Pass',
      physicalObservationSummary: 'Matches physical fit',
      agreesWithDigitalPrediction: true
    },
    {
      zoneId: 'hem' as const,
      zoneLabel: 'Hem',
      digitalPredictionStatus: 'PASS' as const,
      digitalPredictedIssue: 'Pass',
      physicalObservationSummary: 'Matches physical fit',
      agreesWithDigitalPrediction: true
    }
  ];
  const sixOfSevenEval = evaluateAc09ToileRecord({
    ...bodice,
    regionalAgreementChecks: sevenZonesBase.map((z, idx) => ({
      ...z,
      agreesWithDigitalPrediction: idx < 6
    }))
  });
  assert.equal(sixOfSevenEval.regionalAgreementPct, 85.7);
  assert.equal(sixOfSevenEval.regionalAgreementPassed, true);
});

test('AC09-05: Incorrect pattern revision is flagged as traceability mismatch and fails closed', () => {
  const fixture = buildWorkflowPassingFixture('bodice-sleeve-v1');
  const wrongRevision = registerAc09PhysicalSample(fixture, {
    sampleId: fixture.sampleId!,
    recordedPatternRevisionId: 'spec-old-obsolete-v0'
  });

  const evalWrong = evaluateAc09ToileRecord(wrongRevision);
  assert.equal(evalWrong.traceabilityVerified, false);
  assert.equal(evalWrong.status, 'FAILED');
  assert.equal(evalWrong.workflowState, 'FAILED');
  assert.ok(evalWrong.traceabilityMismatches.some(m => m.includes('Pattern revision mismatch')));
});

test('AC09-06: Fabric specification mismatches (ID, composition, weight gsm, stretch %, direction) fail closed', () => {
  const base = buildWorkflowPassingFixture('skirt-block-v1');

  const wrongComposition = registerAc09PhysicalSample(base, {
    sampleId: base.sampleId!,
    recordedFabricComposition: '100% Stretch Jersey Knit',
    recordedFabricWeightGsm: base.traceability!.expectedFabricWeightGsm + 90,
    recordedFabricStretchPct: base.traceability!.expectedFabricStretchPct + 25,
    recordedFabricDirection: 'TRUE_BIAS_45'
  });

  const evalMismatch = evaluateAc09ToileRecord(wrongComposition);
  assert.equal(evalMismatch.traceabilityVerified, false);
  assert.equal(evalMismatch.status, 'FAILED');
  assert.ok(evalMismatch.traceabilityMismatches.length >= 4);
  assert.ok(evalMismatch.traceabilityMismatches.some(m => m.includes('Fabric composition mismatch')));
  assert.ok(evalMismatch.traceabilityMismatches.some(m => m.includes('Fabric weight mismatch')));
  assert.ok(evalMismatch.traceabilityMismatches.some(m => m.includes('Fabric stretch mismatch')));
  assert.ok(evalMismatch.traceabilityMismatches.some(m => m.includes('Fabric cut direction mismatch')));
});

test('AC09-07: Invalid workflow state transitions are rejected while valid progression READY_FOR_REVIEW -> PASSED succeeds with sign-off', () => {
  const skirtSpec = INITIAL_CONCEPTS[0];
  const pending = createPendingAc09ToileRecord({
    toileBlockKey: 'skirt-block-v1',
    designSpec: skirtSpec,
    measurements: STANDARD_SIZING_SYSTEM.sizes.M,
    executionMode: 'workflow'
  });

  assert.throws(
    () => transitionAc09WorkflowState(pending, 'PASSED'),
    /AC09_INVALID_STATE_TRANSITION/
  );
  assert.throws(
    () => transitionAc09WorkflowState(pending, 'READY_FOR_REVIEW'),
    /AC09_INVALID_STATE_TRANSITION/
  );

  let ready = buildWorkflowPassingFixture('skirt-block-v1');
  ready = transitionAc09WorkflowState(ready, 'READY_FOR_REVIEW');
  assert.equal(ready.workflowState, 'READY_FOR_REVIEW');
  assert.throws(
    () => transitionAc09WorkflowState(ready, 'PASSED'),
    /AC09_INVALID_STATE_TRANSITION/
  );

  const signed = recordAc09ReviewerDecision(ready, {
    reviewerName: 'Elena Rostova',
    reviewerRole: 'LEAD_PATTERNMAKER',
    decision: 'APPROVED_PASS',
    rationale: 'All 5 POMs <= 0.25 cm and 100% regional concordance verified on Wolf M form.',
    decidedAt: '2026-11-19'
  });
  const evalPassed = evaluateAc09ToileRecord(signed);
  assert.equal(evalPassed.workflowState, 'PASSED');
  assert.equal(evalPassed.status, 'PASSED');
  assert.equal(evalPassed.signOffAuthorized, true);
  assert.equal(evalPassed.isProductionReady, false);
});

test('AC09-08: Unauthorized sign-off roles, incomplete sign-offs, approving failing records, and synthetic data sources are rejected', () => {
  const ready = buildWorkflowPassingFixture('bodice-sleeve-v1');

  assert.throws(
    () =>
      recordAc09ReviewerDecision(ready, {
        reviewerName: 'Autonomous Agent',
        reviewerRole: 'AI_COPILOT',
        decision: 'APPROVED_PASS',
        rationale: 'Attempting unauthorized automated sign-off.'
      }),
    /AC09_UNAUTHORIZED_REVIEWER_ROLE/
  );

  assert.throws(
    () =>
      recordAc09RepeatMeasurements(ready, ready.pomCheckpoints[0].pointId, [60], {
        sourceFlag: 'SIMULATED_SYNTHETIC'
      }),
    /AC09_SYNTHETIC_DATA_PROHIBITED/
  );

  // Synthetic evidence attachment flag or URI in checklist triggers immediate failure
  const syntheticAttachment: Ac09PhysicalToileRecord = {
    ...ready,
    evidenceChecklist: ready.evidenceChecklist.map((ev, idx) =>
      idx === 0 ? { ...ev, isSyntheticSource: true, attachmentUri: 'synthetic://rendered-drape.png' } : ev
    )
  };
  const evalSynth = evaluateAc09ToileRecord(syntheticAttachment);
  assert.equal(evalSynth.syntheticEvidenceDetected, true);
  assert.equal(evalSynth.status, 'FAILED');
  assert.throws(
    () =>
      recordAc09ReviewerDecision(syntheticAttachment, {
        reviewerName: 'Marcus Vance',
        reviewerRole: 'QA_LEAD',
        decision: 'APPROVED_PASS',
        rationale: 'Should fail on synthetic attachment.'
      }),
    /AC09_CANNOT_APPROVE_FAILING_OR_INCOMPLETE/
  );
});

test('AC09-09: Signed PASSED/FAILED records are immutable and require creating a new sample revision preserving snapshot history', () => {
  const ready = buildWorkflowPassingFixture('bodice-sleeve-v1');
  const signed = recordAc09ReviewerDecision(ready, {
    reviewerName: 'Marcus Vance',
    reviewerRole: 'QA_LEAD',
    decision: 'APPROVED_PASS',
    rationale: 'Bodice and fitted sleeve passed M06 AC-09 physical audit.',
    decidedAt: '2026-11-19'
  });

  assert.equal(signed.isLocked, true);
  assert.ok(signed.lockedSnapshotDigest && signed.lockedSnapshotDigest.length === 64);

  assert.throws(() => assertAc09RecordEditable(signed), /AC09_IMMUTABLE_REVISION_LOCKED/);
  assert.throws(
    () => updateAc09PomMeasurement(signed, signed.pomCheckpoints[0].pointId, 99.0),
    /AC09_IMMUTABLE_REVISION_LOCKED/
  );

  const rev2 = createNewAc09SampleRevision(signed, 'Re-cut in production mill batch #2', '2026-11-20');
  assert.equal(rev2.sampleRevision, 2);
  assert.equal(rev2.isLocked, false);
  assert.equal(rev2.workflowState, 'DRAFT');
  assert.equal(rev2.reviewerDecision?.decision, 'PENDING');
  assert.equal(rev2.revisionHistory?.length, 1);
  assert.equal(rev2.revisionHistory?.[0].revision, 1);
  assert.equal(rev2.revisionHistory?.[0].snapshotDigest, signed.lockedSnapshotDigest);
});

test('AC09-10: Deterministic report serialization produces stable SHA-256 canonical digests, separates sim vs physical, and preserves closed governance flags', () => {
  const readyA = buildWorkflowPassingFixture('skirt-block-v1');
  const signedA = recordAc09ReviewerDecision(readyA, {
    reviewerName: 'Elena Rostova',
    reviewerRole: 'ATELIER_TECH_DIRECTOR',
    decision: 'APPROVED_PASS',
    rationale: 'Canonical deterministic verification run.',
    decidedAt: '2026-11-19'
  });

  const readyB = buildWorkflowPassingFixture('skirt-block-v1');
  const signedB = recordAc09ReviewerDecision(readyB, {
    reviewerName: 'Elena Rostova',
    reviewerRole: 'ATELIER_TECH_DIRECTOR',
    decision: 'APPROVED_PASS',
    rationale: 'Canonical deterministic verification run.',
    decidedAt: '2026-11-19'
  });

  const serA = serializeAc09ValidationReport(signedA);
  const serB = serializeAc09ValidationReport(signedB);

  assert.equal(serA.report.canonicalDigest, serB.report.canonicalDigest);
  assert.equal(serA.canonicalJson, serB.canonicalJson);
  assert.equal(serA.report.reportFormatVersion, 'patroner-ac09-v1');
  assert.equal(serA.report.governanceInvariants.isProductionReady, false);
  assert.equal(serA.report.governanceInvariants.m00Accepted, false);
  assert.equal(serA.report.governanceInvariants.gateAuth3Status, 'CLOSED');
  assert.equal(serA.report.governanceInvariants.syntheticDataProhibited, true);
  assert.ok(serA.report.simulationBaseline.regionalPredictions.length > 0);
  assert.ok(serA.report.physicalEvidence.pomMeasurements.length > 0);
});
