/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { assembleBodiceSleeve } from '../assembly/bodice-sleeve-assembly';
import fs from 'node:fs';
import path from 'node:path';
import {
  AC09_MIN_REPEAT_READINGS,
  Ac09PhysicalToileRecord,
  AC09_POM_CONCORDANCE_TOLERANCE_CM,
  AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT,
  assertAc09RecordEditable,
  createNewAc09SampleRevision,
  createPendingAc09ToileRecord,
  DEFAULT_AC09_TOLERANCE_POLICY,
  evaluateAc09ToileRecord,
  isValidAc09IsoDateOrTimestamp,
  recordAc09RepeatMeasurements,
  recordAc09ReviewerDecision,
  registerAc09PhysicalSample,
  serializeAc09ValidationReport,
  transitionAc09WorkflowState,
  updateAc09PomMeasurement,
  validateAc09FabricStretchPct,
  validateAc09FabricWeightGsm,
  validateAc09HemLevelDeviation,
  validateAc09SeamAllowanceCm,
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
  assert.ok(regEval.missingEvidenceDiagnostics.some(d => d.includes('Missing physical POM repeat readings')));
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

  // Exact +0.500 cm POM boundary (with >= 2 repeat readings) passes READY_FOR_REVIEW; +0.501 cm fails immediately
  let skirt = buildWorkflowPassingFixture('skirt-block-v1');
  const targetPom = skirt.pomCheckpoints[0];
  const exactVal = Number((targetPom.nominalCadCm + 0.5).toFixed(3));
  skirt = recordAc09RepeatMeasurements(skirt, targetPom.pointId, [exactVal, exactVal]);
  const exactBoundaryEval = evaluateAc09ToileRecord(skirt);
  assert.equal(exactBoundaryEval.pomConcordancePassed, true);
  assert.equal(exactBoundaryEval.workflowState, 'READY_FOR_REVIEW');

  const overVal = Number((targetPom.nominalCadCm + 0.501).toFixed(3));
  const overBoundarySkirt = recordAc09RepeatMeasurements(skirt, targetPom.pointId, [overVal, overVal]);
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
  const ready = transitionAc09WorkflowState(buildWorkflowPassingFixture('bodice-sleeve-v1'), 'READY_FOR_REVIEW');

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
      recordAc09RepeatMeasurements(ready, ready.pomCheckpoints[0].pointId, [60, 60], {
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
  const ready = transitionAc09WorkflowState(buildWorkflowPassingFixture('bodice-sleeve-v1'), 'READY_FOR_REVIEW');
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
    () => recordAc09RepeatMeasurements(signed, signed.pomCheckpoints[0].pointId, [99.0, 99.0]),
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
  const readyA = transitionAc09WorkflowState(buildWorkflowPassingFixture('skirt-block-v1'), 'READY_FOR_REVIEW');
  const signedA = recordAc09ReviewerDecision(readyA, {
    reviewerName: 'Elena Rostova',
    reviewerRole: 'ATELIER_TECH_DIRECTOR',
    decision: 'APPROVED_PASS',
    rationale: 'Canonical deterministic verification run.',
    decidedAt: '2026-11-19'
  });

  const readyB = transitionAc09WorkflowState(buildWorkflowPassingFixture('skirt-block-v1'), 'READY_FOR_REVIEW');
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

test('AC09-11 (P1-2C): Legacy execution mode cannot bypass mandatory evidence, traceability, cuttingGrainlineVerified, attachment URIs, or authorized reviewer sign-off', () => {
  const readyWorkflow = buildWorkflowPassingFixture('bodice-sleeve-v1');

  // Even when ALL evidence, traceability, process log, and attachment URIs are populated,
  // setting executionMode: "legacy" WITHOUT authorized human reviewer sign-off must NEVER return PASSED.
  const legacyWithoutSignOff = {
    ...readyWorkflow,
    executionMode: 'legacy' as const,
    reviewerDecision: {
      decision: 'PENDING' as const,
      reviewerName: '',
      reviewerRole: '' as const,
      decidedAt: null,
      rationale: '',
      signatureDigest: null
    }
  };
  const evalNoSignOff = evaluateAc09ToileRecord(legacyWithoutSignOff);
  assert.notEqual(evalNoSignOff.status, 'PASSED');
  assert.equal(evalNoSignOff.status, 'INCOMPLETE');
  assert.equal(evalNoSignOff.workflowState, 'READY_FOR_REVIEW');
  assert.equal(evalNoSignOff.isProductionReady, false);

  // Legacy mode with missing attachment URIs must stay EVIDENCE_INCOMPLETE
  const legacyNoAttachments = {
    ...legacyWithoutSignOff,
    evidenceChecklist: legacyWithoutSignOff.evidenceChecklist.map(ev => ({
      ...ev,
      attachmentUri: ''
    }))
  };
  const evalNoAttachments = evaluateAc09ToileRecord(legacyNoAttachments);
  assert.equal(evalNoAttachments.status, 'INCOMPLETE');
  assert.equal(evalNoAttachments.workflowState, 'EVIDENCE_INCOMPLETE');
  assert.equal(evalNoAttachments.allEvidenceRecorded, false);

  // Legacy mode with missing sampleId/traceability must stay EVIDENCE_INCOMPLETE
  const legacyNoSampleId = {
    ...legacyWithoutSignOff,
    sampleId: ''
  };
  const evalNoSample = evaluateAc09ToileRecord(legacyNoSampleId);
  assert.equal(evalNoSample.status, 'INCOMPLETE');
  assert.equal(evalNoSample.workflowState, 'EVIDENCE_INCOMPLETE');
});

test('AC09-12 (P1-2D): cuttingGrainlineVerified is explicitly required, serialized canonically, and never auto-set by Stitch Type entry in UI', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const ready = buildWorkflowPassingFixture('skirt-block-v1');
  assert.equal(evaluateAc09ToileRecord(ready).workflowState, 'READY_FOR_REVIEW');

  // Turning off cuttingGrainlineVerified must block READY_FOR_REVIEW and PASSED
  const unverifiedGrainline = {
    ...ready,
    processRecord: {
      ...ready.processRecord!,
      cuttingGrainlineVerified: false
    }
  };
  const grainEval = evaluateAc09ToileRecord(unverifiedGrainline);
  assert.equal(grainEval.status, 'INCOMPLETE');
  assert.equal(grainEval.workflowState, 'EVIDENCE_INCOMPLETE');
  assert.ok(
    grainEval.missingEvidenceDiagnostics.some(d => d.includes('Cutting grainline verification'))
  );

  // Canonical serialization records explicit false/true state cleanly
  const serFalse = serializeAc09ValidationReport(unverifiedGrainline);
  const serTrue = serializeAc09ValidationReport(ready);
  assert.equal(serFalse.report.physicalEvidence.process.cuttingGrainlineVerified, false);
  assert.equal(serTrue.report.physicalEvidence.process.cuttingGrainlineVerified, true);
  assert.notEqual(serFalse.report.canonicalDigest, serTrue.report.canonicalDigest);

  // Verify Ac09PhysicalValidationPanel UI source separates Stitch Type, Pressing Method,
  // explicit Cutting Grainline Verified checkbox, and displays in-session persistence disclosure
  const panelPath = path.resolve('src/features/simulation/Ac09PhysicalValidationPanel.tsx');
  const panelSource = fs.readFileSync(panelPath, 'utf8');
  assert.ok(panelSource.includes('data-testid="m06-ac09-cutting-grainline-checkbox"'));
  assert.ok(panelSource.includes('data-testid="m06-ac09-stitch-type-input"'));
  assert.ok(panelSource.includes('data-testid="m06-ac09-pressing-method-input"'));
  assert.ok(panelSource.includes('data-testid="m06-ac09-persistence-notice"'));
  assert.ok(!panelSource.includes('cuttingGrainlineVerified: true'));
});

test('AC09-13 (P1-2E): Bounded optimization child revision remains unapproved draft and UI button wording never implies approval', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { runBoundedPatternOptimization } = await import('./bounded-optimizer');

  const approvedBodice = {
    ...INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!,
    isApproved: true,
    approvalState: 'approved' as const
  };
  const optResult = runBoundedPatternOptimization({
    currentSpec: approvedBodice,
    measurements: STANDARD_SIZING_SYSTEM.sizes.M,
    poseId: 'CANONICAL_A_POSE',
    bodiceDartStyle: 'waist',
    sleeveEaseStrategy: 'classic'
  });

  assert.ok(optResult.proposals.length > 0);
  assert.equal(optResult.requiresHumanApproval, true);
  for (const proposal of optResult.proposals) {
    assert.equal(proposal.proposedDesignSpec.isApproved, false);
    assert.equal(proposal.proposedDesignSpec.approvalState, 'draft');
    assert.ok(proposal.proposedDesignSpec.version > approvedBodice.version);
    assert.notEqual(
      proposal.proposedDesignSpec.specificationRevisionId,
      approvedBodice.specificationRevisionId
    );
    assert.equal(proposal.proposedDesignSpec.approvedBy, undefined);
    assert.equal(approvedBodice.isApproved, true);
  }

  const simPanelPath = path.resolve('src/features/simulation/SimulationFitPanel.tsx');
  const simPanelSource = fs.readFileSync(simPanelPath, 'utf8');
  assert.ok(simPanelSource.includes('Branch Unapproved Child Revision'));
  assert.ok(!simPanelSource.includes('Approve & Branch Child'));
});

// ---------------------------------------------------------------------------
// Checkpoint 8 Adversarial Security & Trust-Boundary Tests (P1-2 Remediation §2F)
// ---------------------------------------------------------------------------

function buildSignedPassingRecord(blockKey: 'skirt-block-v1' | 'bodice-sleeve-v1'): Ac09PhysicalToileRecord {
  const ready = transitionAc09WorkflowState(buildWorkflowPassingFixture(blockKey), 'READY_FOR_REVIEW');
  return recordAc09ReviewerDecision(ready, {
    reviewerName: 'Elena Rostova',
    reviewerRole: 'LEAD_PATTERNMAKER',
    decision: 'APPROVED_PASS',
    rationale: 'Verified physical toile concordance within ±0.50 cm across all POM checkpoints.',
    decidedAt: '2026-11-19'
  });
}

test('AC09-SEC-01: Fake or mismatched reviewer signatureDigest is rejected fail-closed', () => {
  const signed = buildSignedPassingRecord('bodice-sleeve-v1');
  const forgedSignature: Ac09PhysicalToileRecord = {
    ...signed,
    reviewerDecision: {
      ...signed.reviewerDecision!,
      signatureDigest: 'deadbeef'.repeat(8)
    }
  };
  const evalRes = evaluateAc09ToileRecord(forgedSignature);
  assert.equal(evalRes.status, 'FAILED');
  assert.equal(evalRes.signOffAuthorized, false);
  assert.ok(evalRes.blockingReasons.some(r => r.includes('AC09_SIGNATURE_TAMPER_DETECTED')));
});

test('AC09-SEC-02: Empty reviewer rationale is rejected in sign-off API and evaluator', () => {
  const ready = transitionAc09WorkflowState(buildWorkflowPassingFixture('skirt-block-v1'), 'READY_FOR_REVIEW');
  assert.throws(
    () =>
      recordAc09ReviewerDecision(ready, {
        reviewerName: 'Elena Rostova',
        reviewerRole: 'LEAD_PATTERNMAKER',
        decision: 'APPROVED_PASS',
        rationale: '   ',
        decidedAt: '2026-11-19'
      }),
    /AC09_INVALID_SIGN_OFF/
  );

  const signed = buildSignedPassingRecord('skirt-block-v1');
  const tamperedRationale: Ac09PhysicalToileRecord = {
    ...signed,
    reviewerDecision: {
      ...signed.reviewerDecision!,
      rationale: '   '
    }
  };
  const evalRes = evaluateAc09ToileRecord(tamperedRationale);
  assert.equal(evalRes.status, 'FAILED');
  assert.equal(evalRes.signOffAuthorized, false);
  assert.ok(evalRes.blockingReasons.some(r => r.includes('AC09_INVALID_SIGN_OFF')));
});

test('AC09-SEC-03: Unlocked signed record (isLocked=false) cannot return PASSED', () => {
  const signed = buildSignedPassingRecord('bodice-sleeve-v1');
  const unlocked: Ac09PhysicalToileRecord = {
    ...signed,
    isLocked: false
  };
  const evalRes = evaluateAc09ToileRecord(unlocked);
  assert.equal(evalRes.status, 'FAILED');
  assert.equal(evalRes.signOffAuthorized, false);
  assert.ok(evalRes.blockingReasons.some(r => r.includes('AC09_LOCK_REQUIRED')));
});

test('AC09-SEC-04: Tampering with physical POM measurements after signature invalidates signature & lock snapshot', () => {
  const signed = buildSignedPassingRecord('bodice-sleeve-v1');
  const tamperedPom: Ac09PhysicalToileRecord = {
    ...signed,
    pomCheckpoints: signed.pomCheckpoints.map((pt, idx) =>
      idx === 0
        ? {
            ...pt,
            repeatReadingsCm: [pt.nominalCadCm, pt.nominalCadCm],
            measuredToileCm: pt.nominalCadCm,
            deltaCm: 0
          }
        : pt
    )
  };
  const evalRes = evaluateAc09ToileRecord(tamperedPom);
  assert.equal(evalRes.status, 'FAILED');
  assert.equal(evalRes.signOffAuthorized, false);
  assert.ok(evalRes.blockingReasons.some(r => r.includes('AC09_SIGNATURE_TAMPER_DETECTED')));
  assert.ok(evalRes.blockingReasons.some(r => r.includes('AC09_LOCKED_SNAPSHOT_TAMPER_DETECTED')));
});

test('AC09-SEC-05: Missing recordedFabricId blocks READY_FOR_REVIEW and PASSED', () => {
  const base = buildWorkflowPassingFixture('skirt-block-v1');
  const missingFabricId: Ac09PhysicalToileRecord = {
    ...base,
    traceability: {
      ...base.traceability!,
      recordedFabricId: ''
    }
  };
  const evalRes = evaluateAc09ToileRecord(missingFabricId);
  assert.equal(evalRes.status, 'INCOMPLETE');
  assert.equal(evalRes.workflowState, 'EVIDENCE_INCOMPLETE');
  assert.ok(evalRes.missingEvidenceDiagnostics.some(d => d.includes('fabric ID')));
});

test('AC09-SEC-06: Missing recordedFabricStretchPct (null) blocks READY_FOR_REVIEW and PASSED', () => {
  const base = buildWorkflowPassingFixture('bodice-sleeve-v1');
  const missingStretch: Ac09PhysicalToileRecord = {
    ...base,
    traceability: {
      ...base.traceability!,
      recordedFabricStretchPct: null
    }
  };
  const evalRes = evaluateAc09ToileRecord(missingStretch);
  assert.equal(evalRes.status, 'INCOMPLETE');
  assert.equal(evalRes.workflowState, 'EVIDENCE_INCOMPLETE');
  assert.ok(evalRes.missingEvidenceDiagnostics.some(d => d.includes('fabric stretch percentage')));
});

test('AC09-SEC-07: Missing recordedFabricDirection blocks READY_FOR_REVIEW and PASSED', () => {
  const base = buildWorkflowPassingFixture('bodice-sleeve-v1');
  const missingDirection: Ac09PhysicalToileRecord = {
    ...base,
    traceability: {
      ...base.traceability!,
      recordedFabricDirection: '   '
    }
  };
  const evalRes = evaluateAc09ToileRecord(missingDirection);
  assert.equal(evalRes.status, 'INCOMPLETE');
  assert.equal(evalRes.workflowState, 'EVIDENCE_INCOMPLETE');
  assert.ok(evalRes.missingEvidenceDiagnostics.some(d => d.includes('fabric cut direction')));
});

test('AC09-SEC-08: Single-reading POM checkpoint cannot satisfy AC-09 (>= 2 repeat readings strictly required)', () => {
  assert.equal(AC09_MIN_REPEAT_READINGS, 2);
  let base = buildWorkflowPassingFixture('skirt-block-v1');
  const firstPt = base.pomCheckpoints[0];
  // Use updateAc09PomMeasurement (single reading) on one checkpoint
  base = updateAc09PomMeasurement(base, firstPt.pointId, Number((firstPt.nominalCadCm + 0.1).toFixed(2)));
  const evalRes = evaluateAc09ToileRecord(base);
  assert.notEqual(evalRes.status, 'PASSED');
  assert.equal(evalRes.status, 'INCOMPLETE');
  assert.equal(evalRes.workflowState, 'EVIDENCE_INCOMPLETE');
  assert.ok(evalRes.missingEvidenceDiagnostics.some(d => d.includes('at least 2 independent repeat readings')));
});

test('AC09-SEC-09: Forged combinedUncertaintyCm / repeatSpreadCm / measuredToileCm is caught by deterministic recomputation', () => {
  const base = buildWorkflowPassingFixture('bodice-sleeve-v1');
  const firstPt = base.pomCheckpoints[0];
  // Readings have 0.80 cm spread (true combined uncertainty > 0.40 cm > 0.25 cm cap),
  // but caller attempts to forge combinedUncertaintyCm = 0.05 and repeatSpreadCm = 0.0
  const forgedUnc: Ac09PhysicalToileRecord = {
    ...base,
    pomCheckpoints: base.pomCheckpoints.map((pt, idx) =>
      idx === 0
        ? {
            ...pt,
            repeatReadingsCm: [
              Number((firstPt.nominalCadCm - 0.4).toFixed(2)),
              Number((firstPt.nominalCadCm + 0.4).toFixed(2))
            ],
            measuredToileCm: firstPt.nominalCadCm,
            deltaCm: 0,
            repeatSpreadCm: 0,
            combinedUncertaintyCm: 0.05,
            withinTolerance: true
          }
        : pt
    )
  };
  const evalRes = evaluateAc09ToileRecord(forgedUnc);
  assert.equal(evalRes.status, 'FAILED');
  assert.ok((evalRes.maxMeasurementUncertaintyCm ?? 0) > DEFAULT_AC09_TOLERANCE_POLICY.maxAllowedUncertaintyCm);
  assert.ok(evalRes.blockingReasons.some(r => r.includes('AC09_FORGED_UNCERTAINTY')));
  assert.ok(evalRes.blockingReasons.some(r => r.includes('repeat measurement uncertainty')));
});

test('AC09-SEC-10: Empty evidenceChecklist cannot bypass photographic & evidence gate via 0 === 0', () => {
  const base = buildWorkflowPassingFixture('skirt-block-v1');
  const emptyChecklist: Ac09PhysicalToileRecord = {
    ...base,
    evidenceChecklist: []
  };
  const evalRes = evaluateAc09ToileRecord(emptyChecklist);
  assert.equal(evalRes.allEvidenceRecorded, false);
  assert.notEqual(evalRes.status, 'PASSED');
  assert.equal(evalRes.status, 'INCOMPLETE');
  assert.equal(evalRes.workflowState, 'EVIDENCE_INCOMPLETE');
  assert.ok(evalRes.missingEvidenceDiagnostics.some(d => d.includes('Evidence checklist is empty')));
});

test('AC09-SEC-11: Invalid attachment URI formats (non-URI garbage or dangerous scheme) are rejected fail-closed', () => {
  const base = buildWorkflowPassingFixture('bodice-sleeve-v1');
  for (const badUri of ['not-a-uri', 'javascript:alert(1)', 'photo://', '   ']) {
    const withBadUri: Ac09PhysicalToileRecord = {
      ...base,
      evidenceChecklist: base.evidenceChecklist.map((ev, idx) =>
        idx === 0 ? { ...ev, attachmentUri: badUri } : ev
      )
    };
    const evalRes = evaluateAc09ToileRecord(withBadUri);
    assert.equal(evalRes.allEvidenceRecorded, false, `Expected bad URI '${badUri}' to fail`);
    assert.notEqual(evalRes.status, 'PASSED');
    assert.ok(
      evalRes.missingEvidenceDiagnostics.some(d => d.includes('Invalid or placeholder attachment reference URI')) ||
        evalRes.missingEvidenceDiagnostics.some(d => d.includes('Missing photo/log attachment reference URI'))
    );
  }
});

test('AC09-SEC-12: Direct reviewer APPROVED_PASS decision from DRAFT throws fail-closed error', () => {
  const draft = {
    ...buildWorkflowPassingFixture('skirt-block-v1'),
    workflowState: 'DRAFT' as const
  };
  assert.throws(
    () =>
      recordAc09ReviewerDecision(draft, {
        reviewerName: 'Elena Rostova',
        reviewerRole: 'LEAD_PATTERNMAKER',
        decision: 'APPROVED_PASS',
        rationale: 'Attempting to skip workflow state machine from DRAFT.'
      }),
    /AC09_INVALID_WORKFLOW_STATE/
  );
});

test('AC09-SEC-13: Direct reviewer APPROVED_PASS decision from EVIDENCE_INCOMPLETE / SAMPLE_REGISTERED throws fail-closed error', () => {
  const base = buildWorkflowPassingFixture('bodice-sleeve-v1');
  for (const preState of ['SAMPLE_REGISTERED', 'EVIDENCE_INCOMPLETE'] as const) {
    const nonReady = { ...base, workflowState: preState };
    assert.throws(
      () =>
        recordAc09ReviewerDecision(nonReady, {
          reviewerName: 'Marcus Vance',
          reviewerRole: 'QA_LEAD',
          decision: 'APPROVED_PASS',
          rationale: `Attempting to approve directly from ${preState}.`
        }),
      /AC09_INVALID_WORKFLOW_STATE/
    );
  }
});

test('AC09-SEC-14: Unauthorized reviewer role is rejected even if forged directly into record object', () => {
  const signed = buildSignedPassingRecord('skirt-block-v1');
  const forgedRole: Ac09PhysicalToileRecord = {
    ...signed,
    reviewerDecision: {
      ...signed.reviewerDecision!,
      reviewerRole: 'AUTONOMOUS_AGENT' as unknown as Ac09PhysicalToileRecord['reviewerDecision'] extends infer T
        ? T extends { reviewerRole: infer R }
          ? R
          : never
        : never
    }
  };
  const evalRes = evaluateAc09ToileRecord(forgedRole);
  assert.equal(evalRes.status, 'FAILED');
  assert.equal(evalRes.signOffAuthorized, false);
  assert.ok(evalRes.blockingReasons.some(r => r.includes('AC09_INVALID_SIGN_OFF')));
});

test('AC09-SEC-15: Altered lockedSnapshotDigest on locked record fails closed', () => {
  const signed = buildSignedPassingRecord('bodice-sleeve-v1');
  const alteredLock: Ac09PhysicalToileRecord = {
    ...signed,
    lockedSnapshotDigest: '0000000000000000000000000000000000000000000000000000000000000000'
  };
  const evalRes = evaluateAc09ToileRecord(alteredLock);
  assert.equal(evalRes.status, 'FAILED');
  assert.equal(evalRes.signOffAuthorized, false);
  assert.ok(evalRes.blockingReasons.some(r => r.includes('AC09_LOCKED_SNAPSHOT_TAMPER_DETECTED')));
});

test('AC09-SEC-16 (Armscye POM Baseline): pom-scye-circ nominal CAD equals stitched bodice armhole perimeter (36.79 cm), never torso scye girth (86.40 cm), and binds approved pattern revision', () => {
  const bodiceSpec = INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice')!;
  const mSizes = STANDARD_SIZING_SYSTEM.sizes.M;
  const bodicePieces = draftBodiceBlock(mSizes, bodiceSpec, { dartStyle: 'waist' });
  const sleeveRes = draftSleeveBlock(mSizes, bodiceSpec, { strategy: 'classic', bodicePieces });
  const assembly = assembleBodiceSleeve({
    bodicePieces,
    sleevePiece: sleeveRes.piece,
    designSpec: bodiceSpec,
    measurements: mSizes,
    options: { strategy: 'classic' }
  });

  const record = createPendingAc09ToileRecord({
    toileBlockKey: 'bodice-sleeve-v1',
    designSpec: bodiceSpec,
    measurements: mSizes,
    assemblyResult: assembly,
    patternPieces: [...bodicePieces, sleeveRes.piece],
    approvedPatternRevisionId: 'rev-spec-bodice-block-v1-M'
  });

  const scyePom = record.pomCheckpoints.find(p => p.pointId === 'pom-scye-circ');
  assert.ok(scyePom, 'pom-scye-circ must exist on bodice-sleeve-v1');
  assert.equal(
    scyePom!.nominalCadCm,
    Number(assembly.ease.totalBodiceArmholeLengthCm.toFixed(2)),
    'Armscye seam circumference nominal must equal bodice armhole stitching perimeter L_bf + L_bb'
  );
  assert.ok(
    Math.abs(scyePom!.nominalCadCm - 36.79) < 0.05,
    `Expected Size M bodice scye perimeter ~36.79 cm, got ${scyePom!.nominalCadCm}`
  );
  assert.notEqual(
    scyePom!.nominalCadCm,
    86.4,
    'Must NEVER equal torso chest girth at scye plane (86.40 cm)'
  );
  assert.ok(
    scyePom!.nominalCadCm < assembly.ease.totalSleeveCapLengthCm,
    'Stitched armhole perimeter (36.79 cm) must be strictly less than un-eased sleeve cap length (40.05 cm)'
  );
  assert.equal(record.traceability?.approvedPatternRevisionId, 'rev-spec-bodice-block-v1-M');
  assert.ok(scyePom!.checkpointDefinition?.includes('L_bf + L_bb'));
});

// ============================================================================
// P1-2 CHECKPOINT 8 REVISION 3 REMEDIATION — ADVERSARIAL & SECURITY SUITE
// ============================================================================

test('AC09-REV3-N01: hemLevelPhysicalDeviationCm enforces unsigned [0, 0.80] cm tolerance across readiness, sign-off, workflow, and legacy modes', () => {
  // Unit validator boundary coverage
  assert.equal(validateAc09HemLevelDeviation(0).status, 'valid');
  assert.equal(validateAc09HemLevelDeviation(0.25).status, 'valid');
  assert.equal(validateAc09HemLevelDeviation(0.8).status, 'valid');
  assert.equal(validateAc09HemLevelDeviation(0.8001).status, 'exceeds_tolerance');
  assert.equal(validateAc09HemLevelDeviation(0.81).status, 'exceeds_tolerance');
  assert.equal(validateAc09HemLevelDeviation(1.5).status, 'exceeds_tolerance');
  assert.equal(validateAc09HemLevelDeviation(null).status, 'missing');
  assert.equal(validateAc09HemLevelDeviation(undefined).status, 'missing');
  for (const invalidVal of [-5.0, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '0.2' as unknown as number]) {
    assert.equal(
      validateAc09HemLevelDeviation(invalidVal).status,
      'invalid',
      `Expected hemLevelPhysicalDeviationCm=${String(invalidVal)} to be classified invalid`
    );
  }

  // 1. Missing (null / undefined) blocks READY_FOR_REVIEW and cannot pass in workflow or legacy
  const base = buildWorkflowPassingFixture('skirt-block-v1');
  for (const missingHem of [null, undefined]) {
    const rec: Ac09PhysicalToileRecord = {
      ...base,
      hemLevelPhysicalDeviationCm: missingHem as unknown as number | null
    };
    const evalWorkflow = evaluateAc09ToileRecord(rec);
    assert.equal(evalWorkflow.status, 'INCOMPLETE');
    assert.equal(evalWorkflow.workflowState, 'EVIDENCE_INCOMPLETE');
    assert.ok(evalWorkflow.missingEvidenceDiagnostics.some(d => d.includes('AC09_MISSING_HEM_DEVIATION')));

    assert.throws(
      () => transitionAc09WorkflowState(rec, 'READY_FOR_REVIEW'),
      /AC09_MISSING_HEM_DEVIATION/
    );

    // Even in legacy mode, missing hem deviation must not return PASSED
    const evalLegacy = evaluateAc09ToileRecord({ ...rec, executionMode: 'legacy' });
    assert.notEqual(evalLegacy.status, 'PASSED');
    assert.ok(evalLegacy.blockingReasons.some(r => r.includes('AC09_MISSING_HEM_DEVIATION')));
  }

  // 2. Negative, NaN, Infinity, -Infinity, malformed string -> explicit FAILED (never PENDING/PASSED)
  for (const malformedHem of [-5.0, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '0.2' as unknown as number]) {
    const rec: Ac09PhysicalToileRecord = {
      ...base,
      hemLevelPhysicalDeviationCm: malformedHem
    };
    const evalWorkflow = evaluateAc09ToileRecord(rec);
    assert.equal(evalWorkflow.status, 'FAILED', `Malformed hem ${String(malformedHem)} must return FAILED`);
    assert.notEqual(evalWorkflow.status, 'PENDING');
    assert.notEqual(evalWorkflow.status, 'PASSED');
    assert.ok(evalWorkflow.blockingReasons.some(r => r.includes('AC09_INVALID_HEM_DEVIATION')));

    assert.throws(
      () => transitionAc09WorkflowState(rec, 'READY_FOR_REVIEW'),
      /AC09_INVALID_HEM_DEVIATION/
    );

    const evalLegacy = evaluateAc09ToileRecord({ ...rec, executionMode: 'legacy' });
    assert.equal(evalLegacy.status, 'FAILED');
    assert.ok(evalLegacy.blockingReasons.some(r => r.includes('AC09_INVALID_HEM_DEVIATION')));
  }

  // 3. Exceeds tolerance (0.8001, 0.81, 1.5) -> explicit FAILED across workflow, sign-off, and legacy
  for (const overTol of [0.8001, 0.81, 1.5]) {
    const rec: Ac09PhysicalToileRecord = {
      ...base,
      hemLevelPhysicalDeviationCm: overTol
    };
    const evalWorkflow = evaluateAc09ToileRecord(rec);
    assert.equal(evalWorkflow.status, 'FAILED', `Hem deviation ${overTol} > 0.80 must FAIL`);
    assert.ok(evalWorkflow.blockingReasons.some(r => r.includes('AC09_HEM_DEVIATION_EXCEEDS_TOLERANCE')));

    assert.throws(
      () => transitionAc09WorkflowState(rec, 'READY_FOR_REVIEW'),
      /AC09_HEM_DEVIATION_EXCEEDS_TOLERANCE/
    );

    const evalLegacy = evaluateAc09ToileRecord({ ...rec, executionMode: 'legacy' });
    assert.equal(evalLegacy.status, 'FAILED');
  }

  // 4. Forged READY_FOR_REVIEW with exceeding/negative/null hem cannot receive APPROVED_PASS
  for (const badHem of [null, -5.0, 0.81, Number.NaN]) {
    const forgedReady: Ac09PhysicalToileRecord = {
      ...base,
      workflowState: 'READY_FOR_REVIEW',
      hemLevelPhysicalDeviationCm: badHem
    };
    assert.throws(
      () =>
        recordAc09ReviewerDecision(forgedReady, {
          reviewerName: 'Elena Rostova',
          reviewerRole: 'LEAD_PATTERNMAKER',
          decision: 'APPROVED_PASS',
          rationale: 'Attempting to approve record with invalid or missing hem level deviation.',
          decidedAt: '2026-11-19'
        }),
      /AC09_CANNOT_APPROVE_FAILING_OR_INCOMPLETE/
    );
  }

  // 5. Boundary exact tolerance (0.0 and 0.80 cm) and in-tolerance (0.25 cm) pass end-to-end
  for (const validHem of [0, 0.25, 0.8]) {
    const rec = { ...base, hemLevelPhysicalDeviationCm: validHem };
    const ready = transitionAc09WorkflowState(rec, 'READY_FOR_REVIEW');
    const approved = recordAc09ReviewerDecision(ready, {
      reviewerName: 'Elena Rostova',
      reviewerRole: 'LEAD_PATTERNMAKER',
      decision: 'APPROVED_PASS',
      rationale: `Hem level deviation ${validHem} cm verified within [0, 0.80] cm.`,
      decidedAt: '2026-11-19'
    });
    const evalRes = evaluateAc09ToileRecord(approved);
    assert.equal(evalRes.status, 'PASSED', `Valid hem ${validHem} cm should PASS`);
    assert.equal(evalRes.signOffAuthorized, true);
  }
});

test('AC09-REV3-N02: processRecord.seamAllowanceCm requires finite positive > 0 cm across registration, readiness, sign-off, and legacy modes', () => {
  // Unit validator coverage
  assert.equal(validateAc09SeamAllowanceCm(1.5).status, 'valid');
  assert.equal(validateAc09SeamAllowanceCm(0.5).status, 'valid');
  assert.equal(validateAc09SeamAllowanceCm(null).status, 'missing');
  assert.equal(validateAc09SeamAllowanceCm(undefined).status, 'missing');
  for (const badSa of [0, -0.1, -2.0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1.5' as unknown as number]) {
    assert.equal(
      validateAc09SeamAllowanceCm(badSa).status,
      'invalid',
      `Expected seamAllowanceCm=${String(badSa)} to be invalid`
    );
  }

  const base = buildWorkflowPassingFixture('bodice-sleeve-v1');

  // 1. Registration rejects invalid seamAllowanceCm (<= 0, NaN, Infinity, malformed)
  for (const badSa of [0, -0.1, -2.0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1.5' as unknown as number]) {
    assert.throws(
      () =>
        registerAc09PhysicalSample(base, {
          sampleId: base.sampleId!,
          processRecord: {
            seamAllowanceCm: badSa
          }
        }),
      /AC09_INVALID_SEAM_ALLOWANCE/
    );
  }

  // 2. Missing (null / undefined) blocks READY_FOR_REVIEW and sign-off, and cannot pass in legacy mode
  for (const missingSa of [null, undefined]) {
    const rec: Ac09PhysicalToileRecord = {
      ...base,
      processRecord: {
        ...base.processRecord!,
        seamAllowanceCm: missingSa as unknown as number | null
      }
    };
    const evalWorkflow = evaluateAc09ToileRecord(rec);
    assert.equal(evalWorkflow.status, 'INCOMPLETE');
    assert.ok(evalWorkflow.missingEvidenceDiagnostics.some(d => d.includes('AC09_MISSING_SEAM_ALLOWANCE')));
    assert.throws(
      () => transitionAc09WorkflowState(rec, 'READY_FOR_REVIEW'),
      /AC09_MISSING_SEAM_ALLOWANCE/
    );
    const evalLegacy = evaluateAc09ToileRecord({ ...rec, executionMode: 'legacy' });
    assert.notEqual(evalLegacy.status, 'PASSED');
    assert.ok(evalLegacy.blockingReasons.some(r => r.includes('AC09_MISSING_SEAM_ALLOWANCE')));
  }

  // 3. Direct malformed object mutation (0, negative, NaN, Infinity, string) fails closed with FAILED
  for (const badSa of [0, -2.0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1.5' as unknown as number]) {
    const rec: Ac09PhysicalToileRecord = {
      ...base,
      processRecord: {
        ...base.processRecord!,
        seamAllowanceCm: badSa
      }
    };
    const evalWorkflow = evaluateAc09ToileRecord(rec);
    assert.equal(evalWorkflow.status, 'FAILED', `Malformed seamAllowanceCm=${String(badSa)} must FAIL`);
    assert.ok(evalWorkflow.blockingReasons.some(r => r.includes('AC09_INVALID_SEAM_ALLOWANCE')));
    assert.throws(
      () => transitionAc09WorkflowState(rec, 'READY_FOR_REVIEW'),
      /AC09_INVALID_SEAM_ALLOWANCE/
    );

    const forgedReady: Ac09PhysicalToileRecord = { ...rec, workflowState: 'READY_FOR_REVIEW' };
    assert.throws(
      () =>
        recordAc09ReviewerDecision(forgedReady, {
          reviewerName: 'Marcus Vance',
          reviewerRole: 'QA_LEAD',
          decision: 'APPROVED_PASS',
          rationale: 'Attempting approval with invalid seam allowance.',
          decidedAt: '2026-11-19'
        }),
      /AC09_CANNOT_APPROVE_FAILING_OR_INCOMPLETE/
    );

    const evalLegacy = evaluateAc09ToileRecord({ ...rec, executionMode: 'legacy' });
    assert.equal(evalLegacy.status, 'FAILED');
  }

  // 4. Valid positive seam allowances (0.5, 1.5) pass end-to-end
  for (const validSa of [0.5, 1.5]) {
    const updated = registerAc09PhysicalSample(base, {
      sampleId: base.sampleId!,
      processRecord: { seamAllowanceCm: validSa }
    });
    const ready = transitionAc09WorkflowState(updated, 'READY_FOR_REVIEW');
    const approved = recordAc09ReviewerDecision(ready, {
      reviewerName: 'Marcus Vance',
      reviewerRole: 'QA_LEAD',
      decision: 'APPROVED_PASS',
      rationale: `Seam allowance ${validSa} cm verified.`,
      decidedAt: '2026-11-19'
    });
    assert.equal(evaluateAc09ToileRecord(approved).status, 'PASSED');
  }
});

test('AC09-REV3-N03: Client-side SHA-256 tamper-evident integrity seal catches post-lock mutation and UI discloses non-authentication semantics', () => {
  const signed = buildSignedPassingRecord('bodice-sleeve-v1');
  // Post-lock mutation of hemLevelPhysicalDeviationCm or seamAllowanceCm invalidates both integrity seal digests
  const mutatedHem: Ac09PhysicalToileRecord = {
    ...signed,
    hemLevelPhysicalDeviationCm: 0.45
  };
  const evalHem = evaluateAc09ToileRecord(mutatedHem);
  assert.equal(evalHem.status, 'FAILED');
  assert.ok(evalHem.blockingReasons.some(r => r.includes('AC09_SIGNATURE_TAMPER_DETECTED')));
  assert.ok(evalHem.blockingReasons.some(r => r.includes('AC09_LOCKED_SNAPSHOT_TAMPER_DETECTED')));

  const mutatedSa: Ac09PhysicalToileRecord = {
    ...signed,
    processRecord: {
      ...signed.processRecord!,
      seamAllowanceCm: 1.2
    }
  };
  const evalSa = evaluateAc09ToileRecord(mutatedSa);
  assert.equal(evalSa.status, 'FAILED');
  assert.ok(evalSa.blockingReasons.some(r => r.includes('AC09_SIGNATURE_TAMPER_DETECTED')));
  assert.ok(evalSa.blockingReasons.some(r => r.includes('AC09_LOCKED_SNAPSHOT_TAMPER_DETECTED')));

  // UI accurately classifies digest as unkeyed client-side tamper-evident integrity seal (NOT cryptographic reviewer identity auth)
  const panelSrc = fs.readFileSync(
    path.resolve('src/features/simulation/Ac09PhysicalValidationPanel.tsx'),
    'utf8'
  );
  assert.ok(panelSrc.includes('m06-ac09-integrity-seal-badge'));
  assert.ok(panelSrc.includes('m06-ac09-seal-disclosure'));
  assert.ok(panelSrc.includes('perform cryptographic reviewer identity authentication'));
  assert.ok(panelSrc.includes('unkeyed client-side SHA-256 hash'));
  assert.ok(!panelSrc.includes('Signature Verified'));
});

test('AC09-REV3-N06: Date validation (decidedAt, evaluatedAt, cutDate, sewnDate, lockedAt) and fabric numeric hygiene fail closed with FAILED', () => {
  // Date helper unit checks
  assert.equal(isValidAc09IsoDateOrTimestamp('2026-11-19'), true);
  assert.equal(isValidAc09IsoDateOrTimestamp('2026-11-19T09:15:00.000Z'), true);
  assert.equal(isValidAc09IsoDateOrTimestamp('2024-02-29'), true);
  for (const badDate of ['not-a-valid-date', '', '   ', '2026-02-30', '2026-13-01', '2025-02-29', new Date('invalid'), Number.NaN, null, undefined]) {
    assert.equal(
      isValidAc09IsoDateOrTimestamp(badDate),
      false,
      `Expected bad date '${String(badDate)}' to be rejected`
    );
  }

  // 1. recordAc09ReviewerDecision rejects invalid decidedAt values
  const ready = transitionAc09WorkflowState(buildWorkflowPassingFixture('skirt-block-v1'), 'READY_FOR_REVIEW');
  for (const badDecidedAt of ['not-a-valid-date', '', '   ', '2026-02-30', new Date('invalid') as unknown as string, Number.NaN as unknown as string]) {
    assert.throws(
      () =>
        recordAc09ReviewerDecision(ready, {
          reviewerName: 'Elena Rostova',
          reviewerRole: 'LEAD_PATTERNMAKER',
          decision: 'APPROVED_PASS',
          rationale: 'Testing malformed decidedAt rejection.',
          decidedAt: badDecidedAt
        }),
      /AC09_INVALID_DECISION_DATE/
    );
  }

  // 2. Tampered decidedAt / lockedAt / evaluatedAt / cutDate / sewnDate on record fails closed
  const signed = buildSignedPassingRecord('skirt-block-v1');
  const badSignedDate = evaluateAc09ToileRecord({
    ...signed,
    reviewerDecision: {
      ...signed.reviewerDecision!,
      decidedAt: 'not-a-valid-date'
    }
  });
  assert.equal(badSignedDate.status, 'FAILED');
  assert.ok(badSignedDate.blockingReasons.some(r => r.includes('AC09_INVALID_DECISION_DATE')));

  const badLockedAt = evaluateAc09ToileRecord({
    ...signed,
    lockedAt: '2026-02-30'
  });
  assert.equal(badLockedAt.status, 'FAILED');
  assert.ok(
    badLockedAt.blockingReasons.some(
      r => r.includes('AC09_INVALID_LOCK_DATE') || r.includes('AC09_LOCK_REQUIRED')
    )
  );

  const base = buildWorkflowPassingFixture('skirt-block-v1');
  assert.throws(
    () =>
      registerAc09PhysicalSample(base, {
        sampleId: base.sampleId!,
        evaluatedAt: 'not-a-valid-date'
      }),
    /AC09_INVALID_DATE/
  );
  assert.throws(
    () =>
      registerAc09PhysicalSample(base, {
        sampleId: base.sampleId!,
        processRecord: { cutDate: '2026-02-30' }
      }),
    /AC09_INVALID_DATE/
  );
  assert.throws(
    () =>
      registerAc09PhysicalSample(base, {
        sampleId: base.sampleId!,
        processRecord: { sewnDate: 'invalid-date' }
      }),
    /AC09_INVALID_DATE/
  );

  // 3. Fabric numeric input hygiene: NaN / Infinity / out-of-bounds classified as FAILED (distinct from null -> INCOMPLETE)
  assert.equal(validateAc09FabricWeightGsm(null).status, 'missing');
  assert.equal(validateAc09FabricStretchPct(null).status, 'missing');
  for (const badWeight of [0, -10, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '180' as unknown as number]) {
    assert.equal(validateAc09FabricWeightGsm(badWeight).status, 'invalid');
    const evalWeight = evaluateAc09ToileRecord({
      ...base,
      traceability: {
        ...base.traceability!,
        recordedFabricWeightGsm: badWeight
      }
    });
    assert.equal(evalWeight.status, 'FAILED', `Malformed fabric weight ${String(badWeight)} must FAIL`);
    assert.ok(evalWeight.blockingReasons.some(r => r.includes('AC09_INVALID_FABRIC_WEIGHT')));
  }
  for (const badStretch of [-1, 105, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '2' as unknown as number]) {
    assert.equal(validateAc09FabricStretchPct(badStretch).status, 'invalid');
    const evalStretch = evaluateAc09ToileRecord({
      ...base,
      traceability: {
        ...base.traceability!,
        recordedFabricStretchPct: badStretch
      }
    });
    assert.equal(evalStretch.status, 'FAILED', `Malformed fabric stretch ${String(badStretch)} must FAIL`);
    assert.ok(evalStretch.blockingReasons.some(r => r.includes('AC09_INVALID_FABRIC_STRETCH')));
  }

  // Contrast: missing (null) fabric weight remains INCOMPLETE (not misclassified as malformed)
  const missingWeight = evaluateAc09ToileRecord({
    ...base,
    traceability: {
      ...base.traceability!,
      recordedFabricWeightGsm: null
    }
  });
  assert.equal(missingWeight.status, 'INCOMPLETE');
});



