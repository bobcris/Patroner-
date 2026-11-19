/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, DesignSpecification } from '../../types';
import { computeCanonicalSha256 } from '../production/crypto';
import { calibrateConstitutiveMaterial } from './material-constitutive';
import {
  Ac09AuthorizedReviewerRole,
  Ac09EvidenceItem,
  Ac09ExportableValidationReport,
  Ac09MeasurementInstrument,
  Ac09PhysicalToileEvaluation,
  Ac09PhysicalToileRecord,
  Ac09PomCheckpoint,
  Ac09ProcessRecord,
  Ac09RegionalIssueCheck,
  Ac09RevisionSnapshot,
  Ac09SampleTraceability,
  Ac09ToileBlockKey,
  Ac09TolerancePolicy,
  Ac09ValidationStatus,
  Ac09WorkflowState,
  AvatarPoseId,
  FitEvaluationReport,
  FitZoneID
} from './simulation-types';

export const AC09_POM_CONCORDANCE_TOLERANCE_CM = 0.5;
export const AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT = 85;
export const AC09_HEM_LEVEL_TOLERANCE_CM = 0.8;
export const AC09_MAX_ALLOWED_UNCERTAINTY_CM = 0.25;

export const DEFAULT_AC09_TOLERANCE_POLICY: Ac09TolerancePolicy = {
  pomToleranceCm: AC09_POM_CONCORDANCE_TOLERANCE_CM,
  regionalAgreementMinPct: AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT,
  hemLevelToleranceCm: AC09_HEM_LEVEL_TOLERANCE_CM,
  maxAllowedUncertaintyCm: AC09_MAX_ALLOWED_UNCERTAINTY_CM
};

export const INSTRUMENT_RESOLUTION_CM: Record<Ac09MeasurementInstrument, number> = {
  'calibrated-fiberglass-tape': 0.1,
  'flexible-steel-rule': 0.05,
  'digital-caliper': 0.01
};

export const AUTHORIZED_AC09_REVIEWER_ROLES: readonly Ac09AuthorizedReviewerRole[] = [
  'LEAD_PATTERNMAKER',
  'QA_LEAD',
  'ATELIER_TECH_DIRECTOR'
] as const;

const ALLOWED_WORKFLOW_TRANSITIONS: Record<Ac09WorkflowState, readonly Ac09WorkflowState[]> = {
  PENDING: ['DRAFT', 'SAMPLE_REGISTERED'],
  DRAFT: ['SAMPLE_REGISTERED', 'EVIDENCE_INCOMPLETE'],
  SAMPLE_REGISTERED: ['EVIDENCE_INCOMPLETE', 'READY_FOR_REVIEW', 'FAILED'],
  EVIDENCE_INCOMPLETE: ['READY_FOR_REVIEW', 'FAILED'],
  READY_FOR_REVIEW: ['EVIDENCE_INCOMPLETE', 'PASSED', 'FAILED'],
  PASSED: [],
  FAILED: []
};

/**
 * Enforces M06 §18 authoritative thresholds fail-closed so no configuration can silently weaken
 * the <= 0.50 cm POM limit or >= 85% regional agreement requirement.
 */
export function validateAc09TolerancePolicy(policy: Ac09TolerancePolicy): Ac09TolerancePolicy {
  if (!Number.isFinite(policy.pomToleranceCm) || policy.pomToleranceCm <= 0 || policy.pomToleranceCm > AC09_POM_CONCORDANCE_TOLERANCE_CM) {
    throw new Error(
      `AC09_INVALID_TOLERANCE_POLICY: pomToleranceCm (${policy.pomToleranceCm}) must be in (0, ${AC09_POM_CONCORDANCE_TOLERANCE_CM}] cm.`
    );
  }
  if (
    !Number.isFinite(policy.regionalAgreementMinPct) ||
    policy.regionalAgreementMinPct < AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT ||
    policy.regionalAgreementMinPct > 100
  ) {
    throw new Error(
      `AC09_INVALID_TOLERANCE_POLICY: regionalAgreementMinPct (${policy.regionalAgreementMinPct}%) cannot be below authoritative minimum ${AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT}%.`
    );
  }
  if (!Number.isFinite(policy.hemLevelToleranceCm) || policy.hemLevelToleranceCm <= 0 || policy.hemLevelToleranceCm > AC09_HEM_LEVEL_TOLERANCE_CM) {
    throw new Error(
      `AC09_INVALID_TOLERANCE_POLICY: hemLevelToleranceCm (${policy.hemLevelToleranceCm}) must be in (0, ${AC09_HEM_LEVEL_TOLERANCE_CM}] cm.`
    );
  }
  if (
    !Number.isFinite(policy.maxAllowedUncertaintyCm) ||
    policy.maxAllowedUncertaintyCm <= 0 ||
    policy.maxAllowedUncertaintyCm > 0.35
  ) {
    throw new Error(
      `AC09_INVALID_TOLERANCE_POLICY: maxAllowedUncertaintyCm (${policy.maxAllowedUncertaintyCm}) must be in (0, 0.35] cm.`
    );
  }
  return { ...policy };
}

/**
 * Prevents mutation of finalized PASSED / FAILED locked revisions.
 */
export function assertAc09RecordEditable(record: Ac09PhysicalToileRecord): void {
  if (record.isLocked) {
    throw new Error(
      `AC09_IMMUTABLE_REVISION_LOCKED: Sample '${record.sampleId || record.recordId}' rev ${record.sampleRevision ?? 1} is locked (${record.workflowState}). Create a new sample revision before modifying evidence.`
    );
  }
}

/**
 * Generates an unassessed, strictly PENDING AC-09 physical toile validation protocol record (M06 §18).
 * Never populates fabricated physical sample measurements or simulated fit passes.
 */
export function createPendingAc09ToileRecord(params: {
  toileBlockKey: Ac09ToileBlockKey;
  designSpec: DesignSpecification;
  measurements: BodyMeasurements;
  fitReport?: FitEvaluationReport;
  sizeCode?: string;
  poseId?: AvatarPoseId;
  constructionDocRef?: string;
  simulationCaseRef?: string;
  executionMode?: 'legacy' | 'workflow';
  tolerancePolicy?: Ac09TolerancePolicy;
}): Ac09PhysicalToileRecord {
  const {
    toileBlockKey,
    designSpec,
    measurements,
    fitReport,
    sizeCode = measurements.waist <= 66 ? 'S' : measurements.waist <= 74 ? 'M' : 'L',
    poseId = fitReport?.poseId ?? 'CANONICAL_A_POSE',
    constructionDocRef = `m05-pkg-${designSpec.id}-${sizeCode}`,
    simulationCaseRef = fitReport?.simulationId ?? `sim-${toileBlockKey}-awaiting`,
    executionMode = 'legacy',
    tolerancePolicy = DEFAULT_AC09_TOLERANCE_POLICY
  } = params;

  const validatedPolicy = validateAc09TolerancePolicy(tolerancePolicy);
  const revisionId = designSpec.specificationRevisionId ?? `spec-${designSpec.id}-v${designSpec.version}`;
  const isBodice = toileBlockKey === 'bodice-sleeve-v1';

  const pomCheckpoints: Ac09PomCheckpoint[] = isBodice
    ? [
        buildPomCheckpoint(
          'pom-bust-circ',
          'Full Bust Finished Circumference',
          'Full-circumference horizontal measurement at bust apex level under arms on mounted toile.',
          'bust',
          fitReport?.regionalZones.bust?.drapedCircumferenceCm ??
            Number(((measurements.bust ?? measurements.waist + 20) + 6.5).toFixed(2)),
          validatedPolicy.pomToleranceCm
        ),
        buildPomCheckpoint(
          'pom-waist-circ',
          'Bodice Waist Finished Circumference',
          'Horizontal waist seam/tape circumference along natural waistline marking on dress form.',
          'waist',
          fitReport?.regionalZones.waist?.drapedCircumferenceCm ?? Number((measurements.waist + 3.5).toFixed(2)),
          validatedPolicy.pomToleranceCm
        ),
        buildPomCheckpoint(
          'pom-shoulder-width',
          'Shoulder Bridge Span (Neck to Acromion Seam)',
          'Linear shoulder seam length from HPS neck junction to sleeve crown head seam.',
          'shoulder',
          Number((measurements.shoulderLength ?? 12.5).toFixed(2)),
          validatedPolicy.pomToleranceCm
        ),
        buildPomCheckpoint(
          'pom-scye-circ',
          'Armscye Seam Circumference (Fitted Sleeve)',
          'Closed perimeter measured along the armhole stitching line around sleeve head.',
          'scye_armhole',
          fitReport?.regionalZones.scye_armhole?.bodyCircumferenceCm ??
            Number((((measurements.armholeDepth ?? 21.5) * 2.05) + 3.0).toFixed(2)),
          validatedPolicy.pomToleranceCm
        ),
        buildPomCheckpoint(
          'pom-biceps-circ',
          'Upper Arm Sleeve Finished Circumference',
          'Sleeve circumference 2.5 cm below underarm scye junction perpendicular to grainline.',
          'biceps_sleeve',
          fitReport?.regionalZones.biceps_sleeve?.drapedCircumferenceCm ??
            Number(((measurements.bicepsCircumference ?? 29.5) + 4.5).toFixed(2)),
          validatedPolicy.pomToleranceCm
        )
      ]
    : [
        buildPomCheckpoint(
          'pom-skirt-waist',
          'Skirt Waistband Finished Circumference',
          'Interior finished waistband/waist-facing circumference resting on natural waist.',
          'waist',
          fitReport?.regionalZones.waist?.drapedCircumferenceCm ?? Number((measurements.waist + 3.5).toFixed(2)),
          validatedPolicy.pomToleranceCm
        ),
        buildPomCheckpoint(
          'pom-skirt-high-hip',
          'Skirt High-Hip Finished Circumference (10 cm below waist)',
          'Horizontal garment circumference 10.0 cm below CF/CB waist seam.',
          'high_hip',
          fitReport?.regionalZones.high_hip?.drapedCircumferenceCm ??
            Number(((measurements.highHip ?? measurements.waist + 12) + 3.75).toFixed(2)),
          validatedPolicy.pomToleranceCm
        ),
        buildPomCheckpoint(
          'pom-skirt-low-hip',
          'Skirt Low-Hip Finished Circumference',
          'Horizontal garment circumference at fullest hip level (approx. 20 cm below waist).',
          'low_hip',
          fitReport?.regionalZones.low_hip?.drapedCircumferenceCm ?? Number((measurements.lowHip + 5.0).toFixed(2)),
          validatedPolicy.pomToleranceCm
        ),
        buildPomCheckpoint(
          'pom-skirt-hem',
          'Skirt Hem Sweep Circumference',
          'Edge-to-edge bottom hem circumference measured flat along hem crease.',
          'hem',
          fitReport?.regionalZones.hem?.drapedCircumferenceCm ?? Number((measurements.lowHip + 7.5).toFixed(2)),
          validatedPolicy.pomToleranceCm
        ),
        buildPomCheckpoint(
          'pom-skirt-length',
          'Center Front Finished Length (Waist to Hem)',
          'Vertical plumb length along Center Front seam from waist seam to hem fold.',
          'hem',
          Number((measurements.skirtLength ?? 65.0).toFixed(2)),
          validatedPolicy.pomToleranceCm
        )
      ];

  const regionalAgreementChecks: Ac09RegionalIssueCheck[] = isBodice
    ? (['shoulder', 'bust', 'scye_armhole', 'biceps_sleeve', 'waist'] as const).map(zoneId => ({
        zoneId,
        zoneLabel: fitReport?.regionalZones[zoneId]?.zoneLabel ?? zoneId,
        digitalPredictionStatus: fitReport?.regionalZones[zoneId]?.status ?? 'MARGINAL_ADJUSTABLE',
        digitalPredictedIssue:
          fitReport?.regionalZones[zoneId]?.diagnosis ??
          'Awaiting digital diagnostic run on bodice-sleeve block.',
        digitalEaseDeltaCm: fitReport?.regionalZones[zoneId]?.easeDeltaCm,
        digitalMaxStrainPct: fitReport?.regionalZones[zoneId]?.maxStrainPct,
        physicalObservationSummary: null,
        agreesWithDigitalPrediction: null
      }))
    : (['waist', 'high_hip', 'low_hip', 'hem'] as const).map(zoneId => ({
        zoneId,
        zoneLabel: fitReport?.regionalZones[zoneId]?.zoneLabel ?? zoneId,
        digitalPredictionStatus: fitReport?.regionalZones[zoneId]?.status ?? 'PASS',
        digitalPredictedIssue:
          fitReport?.regionalZones[zoneId]?.diagnosis ??
          'Awaiting digital diagnostic run on skirt block.',
        digitalEaseDeltaCm: fitReport?.regionalZones[zoneId]?.easeDeltaCm,
        digitalMaxStrainPct: fitReport?.regionalZones[zoneId]?.maxStrainPct,
        physicalObservationSummary: null,
        agreesWithDigitalPrediction: null
      }));

  const evidenceChecklist: Ac09EvidenceItem[] = [
    {
      itemId: 'ev-front-photo',
      label: 'Front elevation photograph on dress form (plumb & grainline grid visible)',
      category: 'photograph',
      recorded: false
    },
    {
      itemId: 'ev-side-photo',
      label: 'Lateral side-seam photograph (90° balance & armscye/hip hang)',
      category: 'photograph',
      recorded: false
    },
    {
      itemId: 'ev-back-photo',
      label: 'Rear elevation photograph (CB balance & dart/ease distribution)',
      category: 'photograph',
      recorded: false
    },
    {
      itemId: 'ev-pom-caliper-sheet',
      label: 'Signed physical POM tape/caliper log comparing sewn toile vs CAD nominal',
      category: 'pom-tape',
      recorded: false
    },
    {
      itemId: 'ev-grain-hem-check',
      label: 'Grainline plumb tilt & floor-to-hem level differential measurement',
      category: 'grainline-hem',
      recorded: false
    },
    {
      itemId: 'ev-seam-parity-check',
      label: isBodice
        ? 'Side seam, shoulder seam, and scye notch registration inspection'
        : 'Side seam alignment & waist dart symmetry inspection',
      category: 'seam-assembly',
      recorded: false
    }
  ];

  const constitutiveMat = calibrateConstitutiveMaterial(designSpec.fabric);
  const expectedStretchMap: Record<DesignSpecification['fabric']['stretch'], number> = {
    none: 0,
    mechanical: 1.5,
    'low-stretch': 4,
    'high-stretch': 18
  };

  const traceability: Ac09SampleTraceability = {
    approvedPatternRevisionId: revisionId,
    recordedPatternRevisionId: '',
    expectedGarmentCategory: isBodice ? 'bodice' : 'skirt',
    bodyMeasurementSetRef: `body-${sizeCode}-${Math.round(measurements.waist)}-${Math.round(measurements.lowHip)}`,
    expectedMaterialSpecId: `mat-${designSpec.fabric.id}`,
    expectedFabricComposition: designSpec.fabric.composition || designSpec.fabric.name,
    expectedFabricWeightGsm: Math.round(constitutiveMat.densityKgM2 * 1000),
    expectedFabricStretchPct: expectedStretchMap[designSpec.fabric.stretch] ?? 0,
    expectedFabricDirection: 'WARP_GRAINLINE_PARALLEL',
    recordedFabricId: '',
    recordedFabricComposition: '',
    recordedFabricWeightGsm: null,
    recordedFabricStretchPct: null,
    recordedFabricDirection: '',
    recordedFabricLot: '',
    constructionDocRef,
    simulationCaseRef
  };

  const processRecord: Ac09ProcessRecord = {
    cuttingOperator: '',
    cutDate: null,
    cuttingGrainlineVerified: false,
    sewingOperator: '',
    sewnDate: null,
    seamAllowanceCm: null,
    stitchType: '',
    pressingMethod: ''
  };

  return {
    recordId: `ac09-${toileBlockKey}-${revisionId}`,
    sampleId: '',
    sampleRevision: 1,
    executionMode,
    workflowState: executionMode === 'workflow' ? 'DRAFT' : 'PENDING',
    isLocked: false,
    lockedAt: null,
    lockedSnapshotDigest: null,
    revisionHistory: [],
    toileBlockKey,
    garmentLabel: isBodice ? 'Bodice + Sleeve Vertical Slice (bodice-sleeve-v1)' : 'Skirt Block Vertical Slice (skirt-block-v1)',
    revisionId,
    sizeCode,
    fabricId: designSpec.fabric.id,
    fabricName: designSpec.fabric.name,
    grainlineVerified: false,
    bodyOrDressFormId: '',
    poseId,
    evaluatorName: '',
    evaluatedAt: null,
    measurementInstrument: 'calibrated-fiberglass-tape',
    instrumentResolutionCm: INSTRUMENT_RESOLUTION_CM['calibrated-fiberglass-tape'],
    tolerancePolicy: validatedPolicy,
    traceability,
    processRecord,
    reviewerDecision: {
      decision: 'PENDING',
      reviewerName: '',
      reviewerRole: '',
      decidedAt: null,
      rationale: '',
      signatureDigest: null
    },
    pomCheckpoints,
    regionalAgreementChecks,
    hemLevelPhysicalDeviationCm: null,
    seamAlignmentVerified: null,
    evidenceChecklist,
    notes: '',
    isProductionReady: false
  };
}

function buildPomCheckpoint(
  pointId: string,
  label: string,
  checkpointDefinition: string,
  zoneId: FitZoneID,
  nominalCadCm: number,
  toleranceCm: number
): Ac09PomCheckpoint {
  return {
    pointId,
    label,
    unit: 'cm',
    checkpointDefinition,
    zoneId,
    nominalCadCm,
    measuredToileCm: null,
    repeatReadingsCm: [],
    repeatSpreadCm: null,
    combinedUncertaintyCm: null,
    toleranceCm,
    deltaCm: null,
    withinTolerance: null,
    sourceFlag: 'PHYSICAL_OPERATOR_CAPTURE'
  };
}

export interface Ac09SampleRegistrationInput {
  sampleId: string;
  recordedPatternRevisionId?: string;
  bodyMeasurementSetRef?: string;
  recordedFabricId?: string;
  recordedFabricComposition?: string;
  recordedFabricWeightGsm?: number | null;
  recordedFabricStretchPct?: number | null;
  recordedFabricDirection?: string;
  recordedFabricLot?: string;
  constructionDocRef?: string;
  simulationCaseRef?: string;
  bodyOrDressFormId?: string;
  evaluatorName?: string;
  evaluatedAt?: string | null;
  measurementInstrument?: Ac09MeasurementInstrument;
  instrumentResolutionCm?: number;
  processRecord?: Partial<Ac09ProcessRecord>;
}

/**
 * Registers a cut-and-sewn physical toile sample against the approved CAD revision,
 * material specification, M05 construction documentation, and M06 simulation baseline.
 */
export function registerAc09PhysicalSample(
  record: Ac09PhysicalToileRecord,
  input: Ac09SampleRegistrationInput
): Ac09PhysicalToileRecord {
  assertAc09RecordEditable(record);
  if (!input.sampleId || input.sampleId.trim().length < 3) {
    throw new Error('AC09_REGISTRATION_INVALID: sampleId must be at least 3 characters.');
  }

  const instrument = input.measurementInstrument ?? record.measurementInstrument ?? 'calibrated-fiberglass-tape';
  const resolutionCm = input.instrumentResolutionCm ?? INSTRUMENT_RESOLUTION_CM[instrument];
  if (!Number.isFinite(resolutionCm) || resolutionCm <= 0 || resolutionCm > 0.5) {
    throw new Error(`AC09_INVALID_INSTRUMENT_RESOLUTION: ${resolutionCm} cm must be in (0, 0.5] cm.`);
  }

  const prevTrace = record.traceability;
  const nextTraceability: Ac09SampleTraceability | undefined = prevTrace
    ? {
        ...prevTrace,
        recordedPatternRevisionId:
          input.recordedPatternRevisionId ?? prevTrace.recordedPatternRevisionId,
        bodyMeasurementSetRef: input.bodyMeasurementSetRef ?? prevTrace.bodyMeasurementSetRef,
        recordedFabricId: input.recordedFabricId ?? prevTrace.recordedFabricId,
        recordedFabricComposition:
          input.recordedFabricComposition ?? prevTrace.recordedFabricComposition,
        recordedFabricWeightGsm:
          input.recordedFabricWeightGsm !== undefined
            ? input.recordedFabricWeightGsm
            : prevTrace.recordedFabricWeightGsm,
        recordedFabricStretchPct:
          input.recordedFabricStretchPct !== undefined
            ? input.recordedFabricStretchPct
            : prevTrace.recordedFabricStretchPct,
        recordedFabricDirection:
          input.recordedFabricDirection ?? prevTrace.recordedFabricDirection,
        recordedFabricLot: input.recordedFabricLot ?? prevTrace.recordedFabricLot,
        constructionDocRef: input.constructionDocRef ?? prevTrace.constructionDocRef,
        simulationCaseRef: input.simulationCaseRef ?? prevTrace.simulationCaseRef
      }
    : undefined;

  const prevProc = record.processRecord ?? {
    cuttingOperator: '',
    cutDate: null,
    cuttingGrainlineVerified: false,
    sewingOperator: '',
    sewnDate: null,
    seamAllowanceCm: null,
    stitchType: '',
    pressingMethod: ''
  };

  const nextProcess: Ac09ProcessRecord = {
    ...prevProc,
    ...input.processRecord
  };

  const nextWorkflowState: Ac09WorkflowState =
    record.workflowState === 'PENDING' || record.workflowState === 'DRAFT' || !record.workflowState
      ? 'SAMPLE_REGISTERED'
      : record.workflowState;

  return {
    ...record,
    sampleId: input.sampleId.trim(),
    executionMode: 'workflow',
    workflowState: nextWorkflowState,
    measurementInstrument: instrument,
    instrumentResolutionCm: resolutionCm,
    bodyOrDressFormId: input.bodyOrDressFormId ?? record.bodyOrDressFormId,
    evaluatorName: input.evaluatorName ?? record.evaluatorName,
    evaluatedAt: input.evaluatedAt !== undefined ? input.evaluatedAt : record.evaluatedAt,
    traceability: nextTraceability,
    processRecord: nextProcess
  };
}

/**
 * Records repeated physical tape/caliper readings for a POM checkpoint, computing
 * arithmetic mean, spread, and combined instrument+repeat uncertainty.
 */
export function recordAc09RepeatMeasurements(
  record: Ac09PhysicalToileRecord,
  pointId: string,
  readingsCm: number[],
  options?: {
    sourceFlag?: Ac09PomCheckpoint['sourceFlag'] | 'SIMULATED_SYNTHETIC';
    promoteWorkflow?: boolean;
  }
): Ac09PhysicalToileRecord {
  assertAc09RecordEditable(record);
  if (options?.sourceFlag && options.sourceFlag !== 'PHYSICAL_OPERATOR_CAPTURE') {
    throw new Error(
      `AC09_SYNTHETIC_DATA_PROHIBITED: Rejected non-physical source flag '${options.sourceFlag}'.`
    );
  }

  const instrument = record.measurementInstrument ?? 'calibrated-fiberglass-tape';
  const resolutionCm = record.instrumentResolutionCm ?? INSTRUMENT_RESOLUTION_CM[instrument];

  const pomCheckpoints = record.pomCheckpoints.map(pt => {
    if (pt.pointId !== pointId) return pt;
    if (readingsCm.length === 0) {
      return {
        ...pt,
        measuredToileCm: null,
        repeatReadingsCm: [],
        repeatSpreadCm: null,
        combinedUncertaintyCm: null,
        deltaCm: null,
        withinTolerance: null
      };
    }

    for (const r of readingsCm) {
      if (!Number.isFinite(r) || r <= 0) {
        throw new Error(`AC09_INVALID_POM_READING: Reading '${r}' for '${pt.label}' must be finite and > 0 cm.`);
      }
    }

    const cleanedReadings = readingsCm.map(v => Number(v.toFixed(3)));
    const mean = cleanedReadings.reduce((acc, v) => acc + v, 0) / cleanedReadings.length;
    const measuredToileCm = Number(mean.toFixed(3));
    const spread =
      cleanedReadings.length > 1
        ? Number((Math.max(...cleanedReadings) - Math.min(...cleanedReadings)).toFixed(4))
        : 0;
    // Type-B instrument half-resolution combined in quadrature with repeat half-range
    const combinedUncertaintyCm = Number(
      Math.sqrt(Math.pow(resolutionCm / 2, 2) + Math.pow(spread / 2, 2)).toFixed(4)
    );
    const deltaCm = Number((measuredToileCm - pt.nominalCadCm).toFixed(4));

    return {
      ...pt,
      unit: 'cm' as const,
      measuredToileCm,
      repeatReadingsCm: cleanedReadings,
      repeatSpreadCm: spread,
      combinedUncertaintyCm,
      deltaCm,
      withinTolerance: Math.abs(deltaCm) <= pt.toleranceCm,
      sourceFlag: 'PHYSICAL_OPERATOR_CAPTURE' as const
    };
  });

  const shouldWorkflow = options?.promoteWorkflow ?? record.executionMode === 'workflow';
  const nextWorkflowState: Ac09WorkflowState | undefined = shouldWorkflow
    ? record.workflowState === 'PENDING' ||
      record.workflowState === 'DRAFT' ||
      record.workflowState === 'SAMPLE_REGISTERED'
      ? 'EVIDENCE_INCOMPLETE'
      : record.workflowState
    : record.workflowState;

  return {
    ...record,
    executionMode: shouldWorkflow ? 'workflow' : record.executionMode,
    workflowState: nextWorkflowState,
    pomCheckpoints
  };
}

/**
 * Pure immutable update helper computing deltaCm & withinTolerance for a single POM entry.
 */
export function updateAc09PomMeasurement(
  record: Ac09PhysicalToileRecord,
  pointId: string,
  measuredToileCm: number | null
): Ac09PhysicalToileRecord {
  assertAc09RecordEditable(record);
  if (measuredToileCm === null || !Number.isFinite(measuredToileCm) || measuredToileCm <= 0) {
    return recordAc09RepeatMeasurements(record, pointId, [], {
      promoteWorkflow: record.executionMode === 'workflow'
    });
  }
  return recordAc09RepeatMeasurements(record, pointId, [measuredToileCm], {
    promoteWorkflow: record.executionMode === 'workflow'
  });
}

/**
 * Explicitly validates and transitions workflow state without allowing illegal skips
 * (e.g., PENDING/DRAFT/EVIDENCE_INCOMPLETE cannot jump straight to PASSED).
 */
export function transitionAc09WorkflowState(
  record: Ac09PhysicalToileRecord,
  targetState: Ac09WorkflowState
): Ac09PhysicalToileRecord {
  assertAc09RecordEditable(record);
  const currentState: Ac09WorkflowState = record.workflowState ?? 'PENDING';
  if (currentState === targetState) {
    return { ...record, executionMode: 'workflow', workflowState: targetState };
  }

  const allowed = ALLOWED_WORKFLOW_TRANSITIONS[currentState] ?? [];
  if (!allowed.includes(targetState)) {
    throw new Error(
      `AC09_INVALID_STATE_TRANSITION: Cannot transition workflow state from '${currentState}' directly to '${targetState}'.`
    );
  }

  const workflowCandidate: Ac09PhysicalToileRecord = {
    ...record,
    executionMode: 'workflow'
  };
  const evalResult = evaluateAc09ToileRecord(workflowCandidate);

  if (targetState === 'SAMPLE_REGISTERED') {
    if (!record.sampleId || record.sampleId.trim().length < 3) {
      throw new Error('AC09_INVALID_STATE_TRANSITION: Sample registration requires a valid sampleId (>= 3 chars).');
    }
  }

  if (targetState === 'READY_FOR_REVIEW') {
    if (evalResult.syntheticEvidenceDetected) {
      throw new Error('AC09_INVALID_STATE_TRANSITION: Synthetic data detected; cannot enter READY_FOR_REVIEW.');
    }
    if (evalResult.traceabilityMismatches.length > 0) {
      throw new Error(
        `AC09_INVALID_STATE_TRANSITION: Traceability mismatches present (${evalResult.traceabilityMismatches[0]}).`
      );
    }
    if (evalResult.missingEvidenceDiagnostics.length > 0) {
      throw new Error(
        `AC09_INVALID_STATE_TRANSITION: Evidence incomplete (${evalResult.missingEvidenceDiagnostics[0]}).`
      );
    }
    if (!evalResult.pomConcordancePassed || !evalResult.regionalAgreementPassed) {
      throw new Error(
        'AC09_INVALID_STATE_TRANSITION: POM concordance or regional agreement criteria do not pass; transition to FAILED or resolve defects.'
      );
    }
  }

  if (targetState === 'PASSED') {
    if (!evalResult.signOffRecorded || !evalResult.signOffAuthorized || record.reviewerDecision?.decision !== 'APPROVED_PASS') {
      throw new Error(
        'AC09_INVALID_STATE_TRANSITION: Transition to PASSED requires READY_FOR_REVIEW and an authorized human reviewer APPROVED_PASS sign-off.'
      );
    }
  }

  return {
    ...workflowCandidate,
    workflowState: targetState
  };
}

export interface Ac09ReviewerSignOffInput {
  reviewerName: string;
  reviewerRole: string;
  decision: 'APPROVED_PASS' | 'REJECTED_FAIL';
  rationale: string;
  decidedAt?: string;
}

/**
 * Records an authorized human QA / Patternmaker sign-off decision and locks the revision.
 * Rejects unauthorized roles and rejects APPROVED_PASS when any acceptance criterion is unmet.
 */
export function recordAc09ReviewerDecision(
  record: Ac09PhysicalToileRecord,
  input: Ac09ReviewerSignOffInput
): Ac09PhysicalToileRecord {
  assertAc09RecordEditable(record);

  if (!AUTHORIZED_AC09_REVIEWER_ROLES.includes(input.reviewerRole as Ac09AuthorizedReviewerRole)) {
    throw new Error(
      `AC09_UNAUTHORIZED_REVIEWER_ROLE: Role '${input.reviewerRole}' is not authorized to sign off AC-09 (${AUTHORIZED_AC09_REVIEWER_ROLES.join(', ')}).`
    );
  }
  if (!input.reviewerName || input.reviewerName.trim().length < 3) {
    throw new Error('AC09_INVALID_SIGN_OFF: Authorized reviewer full name (>= 3 chars) is required.');
  }
  if (!input.rationale || input.rationale.trim().length < 5) {
    throw new Error('AC09_INVALID_SIGN_OFF: Reviewer decision rationale (>= 5 chars) is required.');
  }

  const workflowRecord: Ac09PhysicalToileRecord = {
    ...record,
    executionMode: 'workflow'
  };
  const preEval = evaluateAc09ToileRecord(workflowRecord);

  if (input.decision === 'APPROVED_PASS') {
    const canApprove =
      !preEval.syntheticEvidenceDetected &&
      preEval.traceabilityVerified &&
      preEval.missingEvidenceDiagnostics.length === 0 &&
      preEval.pomConcordancePassed &&
      preEval.regionalAgreementPassed &&
      record.grainlineVerified &&
      record.seamAlignmentVerified === true &&
      (record.hemLevelPhysicalDeviationCm === null ||
        record.hemLevelPhysicalDeviationCm <= (record.tolerancePolicy?.hemLevelToleranceCm ?? AC09_HEM_LEVEL_TOLERANCE_CM));

    if (!canApprove) {
      throw new Error(
        `AC09_CANNOT_APPROVE_FAILING_OR_INCOMPLETE: Sample cannot be approved as PASSED while blockers remain (${preEval.blockingReasons[0] ?? 'unmet acceptance gate'}).`
      );
    }
  }

  const decidedAt = input.decidedAt ?? new Date().toISOString().slice(0, 10);
  const signatureDigest = computeCanonicalSha256({
    recordId: record.recordId,
    sampleId: record.sampleId,
    sampleRevision: record.sampleRevision ?? 1,
    reviewerName: input.reviewerName.trim(),
    reviewerRole: input.reviewerRole,
    decision: input.decision,
    rationale: input.rationale.trim(),
    decidedAt,
    pomCheckpoints: record.pomCheckpoints.map(p => ({
      pointId: p.pointId,
      measuredToileCm: p.measuredToileCm,
      deltaCm: p.deltaCm
    }))
  });

  const finalState: Ac09WorkflowState = input.decision === 'APPROVED_PASS' ? 'PASSED' : 'FAILED';
  const nextRecord: Ac09PhysicalToileRecord = {
    ...workflowRecord,
    workflowState: finalState,
    reviewerDecision: {
      decision: input.decision,
      reviewerName: input.reviewerName.trim(),
      reviewerRole: input.reviewerRole,
      decidedAt,
      rationale: input.rationale.trim(),
      signatureDigest
    },
    isLocked: true,
    lockedAt: decidedAt
  };

  const snapshotDigest = computeCanonicalSha256({
    sampleId: nextRecord.sampleId,
    sampleRevision: nextRecord.sampleRevision ?? 1,
    workflowState: finalState,
    traceability: nextRecord.traceability,
    pomCheckpoints: nextRecord.pomCheckpoints,
    regionalAgreementChecks: nextRecord.regionalAgreementChecks,
    reviewerDecision: nextRecord.reviewerDecision
  });

  return {
    ...nextRecord,
    lockedSnapshotDigest: snapshotDigest
  };
}

/**
 * Forks an immutable locked sample record into a new editable revision while preserving
 * cryptographic audit history of prior revisions.
 */
export function createNewAc09SampleRevision(
  record: Ac09PhysicalToileRecord,
  reason: string,
  archivedAt?: string
): Ac09PhysicalToileRecord {
  if (!reason || reason.trim().length < 5) {
    throw new Error('AC09_REVISION_REASON_REQUIRED: Provide a reason (>= 5 chars) when creating a new sample revision.');
  }

  const priorRev = record.sampleRevision ?? 1;
  const priorState: Ac09WorkflowState = record.workflowState ?? 'DRAFT';
  const digest =
    record.lockedSnapshotDigest ??
    computeCanonicalSha256({
      recordId: record.recordId,
      sampleId: record.sampleId,
      sampleRevision: priorRev,
      workflowState: priorState,
      pomCheckpoints: record.pomCheckpoints,
      regionalAgreementChecks: record.regionalAgreementChecks
    });

  const snapshot: Ac09RevisionSnapshot = {
    revision: priorRev,
    workflowState: priorState,
    archivedAt: archivedAt ?? new Date().toISOString().slice(0, 10),
    reason: reason.trim(),
    snapshotDigest: digest
  };

  return {
    ...record,
    sampleRevision: priorRev + 1,
    executionMode: 'workflow',
    workflowState: 'DRAFT',
    isLocked: false,
    lockedAt: null,
    lockedSnapshotDigest: null,
    revisionHistory: [...(record.revisionHistory ?? []), snapshot],
    reviewerDecision: {
      decision: 'PENDING',
      reviewerName: '',
      reviewerRole: '',
      decidedAt: null,
      rationale: '',
      signatureDigest: null
    }
  };
}

/**
 * Evaluates a physical toile validation record strictly fail-closed per M06 §18 AC-09:
 * - Unassessed default records return 'PENDING'.
 * - Partial / awaiting-review entries return 'INCOMPLETE'.
 * - Synthetic data, spec/revision mismatches, tolerance violations, or failed inspections return 'FAILED'.
 * - Complete entries in workflow mode return 'PASSED' ONLY when all criteria pass AND authorized reviewer sign-off is recorded.
 */
export function evaluateAc09ToileRecord(record: Ac09PhysicalToileRecord): Ac09PhysicalToileEvaluation {
  const blockingReasons: string[] = [];
  const traceabilityMismatches: string[] = [];
  const missingEvidenceDiagnostics: string[] = [];

  const policy = validateAc09TolerancePolicy(record.tolerancePolicy ?? DEFAULT_AC09_TOLERANCE_POLICY);
  const isWorkflow = record.executionMode === 'workflow';

  // Synthetic source guard (prohibits simulated/generated evidence in physical store)
  const syntheticChecklistItems = record.evidenceChecklist.filter(
    ev =>
      ev.isSyntheticSource === true ||
      Boolean(ev.attachmentUri && /^(synthetic|simulated):/i.test(ev.attachmentUri.trim()))
  );
  const syntheticPoms = record.pomCheckpoints.filter(
    pt => pt.measuredToileCm !== null && pt.sourceFlag !== undefined && pt.sourceFlag !== 'PHYSICAL_OPERATOR_CAPTURE'
  );
  const syntheticEvidenceDetected = syntheticChecklistItems.length > 0 || syntheticPoms.length > 0;
  if (syntheticEvidenceDetected) {
    blockingReasons.push(
      'SYNTHETIC_DATA_PROHIBITED: Synthetic or simulation-generated data was detected in physical AC-09 evidence.'
    );
  }

  // Traceability verification (pattern revision + material specification + construction/sim refs)
  const tr = record.traceability;
  if (tr) {
    if (tr.recordedPatternRevisionId.trim().length > 0 && tr.recordedPatternRevisionId.trim() !== tr.approvedPatternRevisionId.trim()) {
      traceabilityMismatches.push(
        `Pattern revision mismatch: toile recorded as '${tr.recordedPatternRevisionId}', expected approved revision '${tr.approvedPatternRevisionId}'.`
      );
    }
    if (tr.recordedFabricId.trim().length > 0 && tr.recordedFabricId.trim() !== record.fabricId.trim()) {
      traceabilityMismatches.push(
        `Fabric ID mismatch: sample cut in '${tr.recordedFabricId}', specification requires '${record.fabricId}'.`
      );
    }
    if (
      tr.recordedFabricComposition.trim().length > 0 &&
      tr.recordedFabricComposition.trim().toLowerCase() !== tr.expectedFabricComposition.trim().toLowerCase()
    ) {
      traceabilityMismatches.push(
        `Fabric composition mismatch: '${tr.recordedFabricComposition}' differs from expected '${tr.expectedFabricComposition}'.`
      );
    }
    if (tr.recordedFabricWeightGsm !== null) {
      const allowedWeightDelta = Math.max(15, tr.expectedFabricWeightGsm * 0.08);
      if (Math.abs(tr.recordedFabricWeightGsm - tr.expectedFabricWeightGsm) > allowedWeightDelta) {
        traceabilityMismatches.push(
          `Fabric weight mismatch: ${tr.recordedFabricWeightGsm} gsm differs from expected ${tr.expectedFabricWeightGsm} gsm (±${allowedWeightDelta.toFixed(0)} gsm tolerance).`
        );
      }
    }
    if (tr.recordedFabricStretchPct !== null) {
      if (Math.abs(tr.recordedFabricStretchPct - tr.expectedFabricStretchPct) > 2.5) {
        traceabilityMismatches.push(
          `Fabric stretch mismatch: ${tr.recordedFabricStretchPct}% differs from expected ${tr.expectedFabricStretchPct}% (±2.5% tolerance).`
        );
      }
    }
    if (
      tr.recordedFabricDirection.trim().length > 0 &&
      tr.recordedFabricDirection.trim() !== tr.expectedFabricDirection.trim()
    ) {
      traceabilityMismatches.push(
        `Fabric cut direction mismatch: '${tr.recordedFabricDirection}', expected '${tr.expectedFabricDirection}'.`
      );
    }
  }
  blockingReasons.push(...traceabilityMismatches);

  // POM Measurements & Uncertainty
  const requiredPomCount = record.pomCheckpoints.length;
  let completedPomCount = 0;
  let maxPomConcordanceErrorCm: number | null = null;
  let maxMeasurementUncertaintyCm: number | null = null;
  let pomAllWithinTolerance = true;
  let uncertaintyAllWithinLimit = true;

  for (const pt of record.pomCheckpoints) {
    const effectiveLimit = Math.min(pt.toleranceCm, policy.pomToleranceCm);
    if (pt.measuredToileCm !== null && Number.isFinite(pt.measuredToileCm) && pt.measuredToileCm > 0) {
      completedPomCount++;
      const err = Math.abs(Number((pt.measuredToileCm - pt.nominalCadCm).toFixed(4)));
      maxPomConcordanceErrorCm = maxPomConcordanceErrorCm === null ? err : Math.max(maxPomConcordanceErrorCm, err);
      if (err > effectiveLimit) {
        pomAllWithinTolerance = false;
        blockingReasons.push(
          `POM '${pt.label}' delta ${err.toFixed(3)} cm exceeds AC-09 limit (±${effectiveLimit.toFixed(2)} cm).`
        );
      }

      if (pt.combinedUncertaintyCm !== null && pt.combinedUncertaintyCm !== undefined) {
        maxMeasurementUncertaintyCm =
          maxMeasurementUncertaintyCm === null
            ? pt.combinedUncertaintyCm
            : Math.max(maxMeasurementUncertaintyCm, pt.combinedUncertaintyCm);
        if (pt.combinedUncertaintyCm > policy.maxAllowedUncertaintyCm) {
          uncertaintyAllWithinLimit = false;
          blockingReasons.push(
            `POM '${pt.label}' repeat measurement uncertainty ±${pt.combinedUncertaintyCm.toFixed(3)} cm exceeds max allowed ±${policy.maxAllowedUncertaintyCm.toFixed(2)} cm (re-measure carefully).`
          );
        }
      }
    } else {
      missingEvidenceDiagnostics.push(`Missing physical POM reading for '${pt.label}'.`);
    }
  }

  // Regional Fit Agreement
  let evaluatedZonesCount = 0;
  let agreedZonesCount = 0;
  for (const rz of record.regionalAgreementChecks) {
    if (rz.agreesWithDigitalPrediction !== null) {
      evaluatedZonesCount++;
      if (rz.agreesWithDigitalPrediction) agreedZonesCount++;
    } else {
      missingEvidenceDiagnostics.push(`Missing physical regional fit observation for '${rz.zoneLabel}'.`);
    }
  }
  const regionalAgreementPct =
    evaluatedZonesCount > 0 ? Number(((agreedZonesCount / evaluatedZonesCount) * 100).toFixed(1)) : null;

  // Evidence Checklist (attachmentUri required in workflow mode)
  let evidenceCompletedCount = 0;
  const requiredEvidenceCount = record.evidenceChecklist.length;
  for (const ev of record.evidenceChecklist) {
    const hasUri = !isWorkflow || (ev.attachmentUri !== undefined && ev.attachmentUri.trim().length >= 5);
    if (ev.recorded && hasUri) {
      evidenceCompletedCount++;
    } else if (!ev.recorded) {
      missingEvidenceDiagnostics.push(`Unrecorded evidence checklist item: '${ev.label}'.`);
    } else if (!hasUri) {
      missingEvidenceDiagnostics.push(`Missing photo/log attachment reference URI for '${ev.label}'.`);
    }
  }
  const allEvidenceRecorded = evidenceCompletedCount === requiredEvidenceCount;

  const hasAnyPhysicalData =
    completedPomCount > 0 ||
    evaluatedZonesCount > 0 ||
    record.evidenceChecklist.some(item => item.recorded) ||
    record.hemLevelPhysicalDeviationCm !== null ||
    record.seamAlignmentVerified !== null ||
    record.grainlineVerified ||
    Boolean(record.sampleId && record.sampleId.trim().length > 0);

  if (!hasAnyPhysicalData && !isWorkflow && !syntheticEvidenceDetected && traceabilityMismatches.length === 0) {
    return {
      toileBlockKey: record.toileBlockKey,
      status: 'PENDING',
      workflowState: record.workflowState ?? 'PENDING',
      completedPomCount: 0,
      requiredPomCount,
      maxPomConcordanceErrorCm: null,
      maxMeasurementUncertaintyCm: null,
      pomToleranceLimitCm: policy.pomToleranceCm,
      pomConcordancePassed: false,
      evaluatedZonesCount: 0,
      agreedZonesCount: 0,
      regionalAgreementPct: null,
      requiredAgreementPct: policy.regionalAgreementMinPct,
      regionalAgreementPassed: false,
      evidenceCompletedCount: 0,
      requiredEvidenceCount,
      allEvidenceRecorded: false,
      traceabilityVerified: false,
      traceabilityMismatches: [],
      missingEvidenceDiagnostics,
      syntheticEvidenceDetected: false,
      signOffRecorded: false,
      signOffAuthorized: false,
      blockingReasons: [
        `Physical toile trial not yet executed for '${record.toileBlockKey}'. Register sample ID, cut, sew, mount on calibrated dress form, and record tape/caliper POM & regional observations.`
      ],
      summary: `AC-09 PENDING: Awaiting sewn toile execution for ${record.toileBlockKey} (≤ 0.50 cm POM & ≥ 85% regional agreement required).`,
      isProductionReady: false
    };
  }

  const allPomsComplete = completedPomCount === requiredPomCount && requiredPomCount > 0;
  const allZonesEvaluated =
    evaluatedZonesCount === record.regionalAgreementChecks.length && evaluatedZonesCount > 0;
  const hasMetadata =
    record.evaluatorName.trim().length >= 2 &&
    record.bodyOrDressFormId.trim().length >= 2 &&
    Boolean(record.evaluatedAt);

  if (!hasMetadata) {
    missingEvidenceDiagnostics.push('Missing evaluator identity, dress form/body ID, or physical trial date.');
  }

  if (isWorkflow) {
    if (!record.sampleId || record.sampleId.trim().length < 3) {
      missingEvidenceDiagnostics.push('Missing registered physical sampleId.');
    }
    if (!tr || tr.recordedPatternRevisionId.trim().length === 0) {
      missingEvidenceDiagnostics.push('Missing confirmed cut pattern revision ID.');
    }
    if (!tr || tr.recordedFabricComposition.trim().length === 0 || tr.recordedFabricWeightGsm === null || tr.recordedFabricLot.trim().length === 0) {
      missingEvidenceDiagnostics.push('Missing fabric composition, gsm weight, or lot traceability record.');
    }
    if (!tr || tr.constructionDocRef.trim().length === 0 || tr.simulationCaseRef.trim().length === 0) {
      missingEvidenceDiagnostics.push('Missing M05 construction documentation or M06 simulation baseline reference.');
    }
    const pr = record.processRecord;
    if (
      !pr ||
      pr.cuttingOperator.trim().length < 2 ||
      !pr.cutDate ||
      !pr.cuttingGrainlineVerified ||
      pr.sewingOperator.trim().length < 2 ||
      !pr.sewnDate ||
      pr.seamAllowanceCm === null ||
      pr.stitchType.trim().length < 2 ||
      pr.pressingMethod.trim().length < 2
    ) {
      missingEvidenceDiagnostics.push('Missing cutting or sewing process execution log fields.');
    }
  }

  if (!record.grainlineVerified) {
    missingEvidenceDiagnostics.push('Physical grainline plumb check not verified.');
  }
  if (record.seamAlignmentVerified === null) {
    missingEvidenceDiagnostics.push('Physical seam alignment inspection unrecorded.');
  }

  // Merge missing-evidence diagnostics into blockingReasons cleanly
  if (!allPomsComplete) {
    blockingReasons.push(`${requiredPomCount - completedPomCount} physical POM measurement(s) missing.`);
  }
  if (!allZonesEvaluated) {
    blockingReasons.push(
      `${record.regionalAgreementChecks.length - evaluatedZonesCount} regional fit-issue zone comparison(s) unrecorded.`
    );
  }
  if (!hasMetadata) {
    blockingReasons.push('Missing evaluator identity, dress form/body ID, or physical trial date.');
  }
  if (!allEvidenceRecorded) {
    blockingReasons.push(
      `${requiredEvidenceCount - evidenceCompletedCount} photographic/measurement checklist evidence item(s) or attachment URIs incomplete.`
    );
  }
  if (!record.grainlineVerified) {
    blockingReasons.push('Physical grainline plumb check not verified.');
  }
  if (record.seamAlignmentVerified === null) {
    blockingReasons.push('Physical seam alignment inspection unrecorded.');
  } else if (record.seamAlignmentVerified === false) {
    blockingReasons.push('Physical seam alignment inspection failed.');
  }
  if (
    record.hemLevelPhysicalDeviationCm !== null &&
    record.hemLevelPhysicalDeviationCm > policy.hemLevelToleranceCm
  ) {
    blockingReasons.push(
      `Physical hem level deviation ${record.hemLevelPhysicalDeviationCm.toFixed(2)} cm exceeds ${policy.hemLevelToleranceCm.toFixed(2)} cm threshold.`
    );
  }

  const pomConcordancePassed =
    allPomsComplete && pomAllWithinTolerance && uncertaintyAllWithinLimit && maxPomConcordanceErrorCm !== null;
  const regionalAgreementPassed =
    allZonesEvaluated &&
    regionalAgreementPct !== null &&
    regionalAgreementPct >= policy.regionalAgreementMinPct;

  if (
    allZonesEvaluated &&
    regionalAgreementPct !== null &&
    regionalAgreementPct < policy.regionalAgreementMinPct
  ) {
    blockingReasons.push(
      `Regional fit-issue agreement ${regionalAgreementPct.toFixed(1)}% is below AC-09 threshold (${policy.regionalAgreementMinPct}%).`
    );
  }

  const traceabilityVerified =
    traceabilityMismatches.length === 0 &&
    (!isWorkflow ||
      (Boolean(tr) &&
        tr!.recordedPatternRevisionId.trim().length > 0 &&
        tr!.recordedFabricComposition.trim().length > 0 &&
        tr!.recordedFabricWeightGsm !== null &&
        tr!.recordedFabricLot.trim().length > 0 &&
        tr!.constructionDocRef.trim().length > 0 &&
        tr!.simulationCaseRef.trim().length > 0));

  const reviewerDecision = record.reviewerDecision;
  const signOffRecorded = Boolean(reviewerDecision && reviewerDecision.decision !== 'PENDING');
  const signOffAuthorized = Boolean(
    reviewerDecision &&
      AUTHORIZED_AC09_REVIEWER_ROLES.includes(reviewerDecision.reviewerRole as Ac09AuthorizedReviewerRole) &&
      reviewerDecision.reviewerName.trim().length >= 3 &&
      Boolean(reviewerDecision.decidedAt) &&
      Boolean(reviewerDecision.signatureDigest)
  );

  if (signOffRecorded && !signOffAuthorized) {
    blockingReasons.push(
      `Reviewer sign-off is unauthorized or incomplete (role='${reviewerDecision?.reviewerRole ?? 'NONE'}').`
    );
  }
  if (reviewerDecision?.decision === 'REJECTED_FAIL') {
    blockingReasons.push(`Reviewer rejected sample: ${reviewerDecision.rationale || 'Rejected FAIL'}.`);
  }

  const hasFailureCondition =
    syntheticEvidenceDetected ||
    traceabilityMismatches.length > 0 ||
    (completedPomCount > 0 && (!pomAllWithinTolerance || !uncertaintyAllWithinLimit)) ||
    (allZonesEvaluated && !regionalAgreementPassed) ||
    record.seamAlignmentVerified === false ||
    (record.hemLevelPhysicalDeviationCm !== null &&
      record.hemLevelPhysicalDeviationCm > policy.hemLevelToleranceCm) ||
    reviewerDecision?.decision === 'REJECTED_FAIL' ||
    (signOffRecorded && !signOffAuthorized);

  const missingWorkflowProcessOrRefs =
    isWorkflow &&
    missingEvidenceDiagnostics.some(
      d =>
        d.includes('registered physical sampleId') ||
        d.includes('cut pattern revision ID') ||
        d.includes('fabric composition') ||
        d.includes('construction documentation') ||
        d.includes('cutting or sewing')
    );

  const isComplete =
    allPomsComplete &&
    allZonesEvaluated &&
    hasMetadata &&
    allEvidenceRecorded &&
    record.grainlineVerified &&
    record.seamAlignmentVerified === true &&
    traceabilityVerified &&
    !missingWorkflowProcessOrRefs;

  let status: Ac09ValidationStatus;
  let workflowState: Ac09WorkflowState;

  if (hasFailureCondition) {
    status = 'FAILED';
    workflowState = 'FAILED';
  } else if (isWorkflow) {
    if (isComplete && pomConcordancePassed && regionalAgreementPassed) {
      if (reviewerDecision?.decision === 'APPROVED_PASS' && signOffAuthorized) {
        status = 'PASSED';
        workflowState = 'PASSED';
      } else {
        status = 'INCOMPLETE';
        workflowState = 'READY_FOR_REVIEW';
        blockingReasons.push('READY_FOR_REVIEW: Awaiting authorized human reviewer sign-off to finalize PASSED.');
      }
    } else if (!hasAnyPhysicalData && (!record.sampleId || record.sampleId.trim().length === 0)) {
      workflowState = record.workflowState === 'DRAFT' ? 'DRAFT' : 'PENDING';
      status = workflowState === 'PENDING' ? 'PENDING' : 'INCOMPLETE';
    } else if (
      completedPomCount === 0 &&
      evaluatedZonesCount === 0 &&
      !record.evidenceChecklist.some(item => item.recorded) &&
      record.sampleId &&
      record.sampleId.trim().length >= 3
    ) {
      workflowState = 'SAMPLE_REGISTERED';
      status = 'INCOMPLETE';
    } else {
      workflowState = 'EVIDENCE_INCOMPLETE';
      status = 'INCOMPLETE';
    }
  } else {
    // Legacy compatibility mode for direct record checks
    if (isComplete && pomConcordancePassed && regionalAgreementPassed) {
      status = 'PASSED';
      workflowState = 'PASSED';
    } else {
      status = 'INCOMPLETE';
      workflowState = 'EVIDENCE_INCOMPLETE';
    }
  }

  const summary =
    status === 'PASSED'
      ? `AC-09 PASSED (${record.toileBlockKey}): max POM delta ${maxPomConcordanceErrorCm?.toFixed(3)} cm <= ${policy.pomToleranceCm.toFixed(2)} cm; regional agreement ${regionalAgreementPct?.toFixed(1)}% >= ${policy.regionalAgreementMinPct}%.`
      : status === 'FAILED'
      ? `AC-09 FAILED (${record.toileBlockKey}): ${blockingReasons[0] ?? 'Physical concordance or traceability criteria violated.'}`
      : workflowState === 'READY_FOR_REVIEW'
      ? `AC-09 READY_FOR_REVIEW (${record.toileBlockKey}): All physical criteria met; awaiting authorized reviewer sign-off.`
      : `AC-09 ${workflowState} (${record.toileBlockKey}): ${completedPomCount}/${requiredPomCount} POMs, ${evaluatedZonesCount}/${record.regionalAgreementChecks.length} zones, ${evidenceCompletedCount}/${requiredEvidenceCount} evidence items.`;

  return {
    toileBlockKey: record.toileBlockKey,
    status,
    workflowState,
    completedPomCount,
    requiredPomCount,
    maxPomConcordanceErrorCm,
    maxMeasurementUncertaintyCm,
    pomToleranceLimitCm: policy.pomToleranceCm,
    pomConcordancePassed,
    evaluatedZonesCount,
    agreedZonesCount,
    regionalAgreementPct,
    requiredAgreementPct: policy.regionalAgreementMinPct,
    regionalAgreementPassed,
    evidenceCompletedCount,
    requiredEvidenceCount,
    allEvidenceRecorded,
    traceabilityVerified,
    traceabilityMismatches,
    missingEvidenceDiagnostics,
    syntheticEvidenceDetected,
    signOffRecorded,
    signOffAuthorized,
    blockingReasons,
    summary,
    isProductionReady: false
  };
}

/**
 * Produces a deterministic, canonical SHA-256 stamped validation report strictly separating
 * digital simulation predictions from physical sample observations and maintaining closed governance flags.
 */
export function serializeAc09ValidationReport(
  record: Ac09PhysicalToileRecord
): { report: Ac09ExportableValidationReport; canonicalJson: string } {
  const evaluationOutcome = evaluateAc09ToileRecord(record);
  const tr = record.traceability;
  const proc = record.processRecord ?? {
    cuttingOperator: '',
    cutDate: null,
    cuttingGrainlineVerified: false,
    sewingOperator: '',
    sewnDate: null,
    seamAllowanceCm: null,
    stitchType: '',
    pressingMethod: ''
  };

  const payloadWithoutDigest: Omit<Ac09ExportableValidationReport, 'canonicalDigest'> = {
    reportFormatVersion: 'patroner-ac09-v1',
    recordId: record.recordId,
    sampleId: record.sampleId || 'UNREGISTERED',
    sampleRevision: record.sampleRevision ?? 1,
    toileBlockKey: record.toileBlockKey,
    simulationBaseline: {
      simulationCaseRef: tr?.simulationCaseRef ?? `sim-${record.toileBlockKey}`,
      poseId: record.poseId,
      approvedPatternRevisionId: tr?.approvedPatternRevisionId ?? record.revisionId,
      expectedMaterialSpecId: tr?.expectedMaterialSpecId ?? `mat-${record.fabricId}`,
      regionalPredictions: record.regionalAgreementChecks.map(rz => ({
        zoneId: rz.zoneId,
        zoneLabel: rz.zoneLabel,
        status: rz.digitalPredictionStatus,
        easeDeltaCm: rz.digitalEaseDeltaCm ?? null,
        maxStrainPct: rz.digitalMaxStrainPct ?? null,
        predictedIssue: rz.digitalPredictedIssue
      }))
    },
    physicalEvidence: {
      sizeCode: record.sizeCode,
      bodyMeasurementSetRef: tr?.bodyMeasurementSetRef ?? `size-${record.sizeCode}`,
      recordedPatternRevisionId: tr?.recordedPatternRevisionId ?? '',
      fabric: {
        fabricId: tr?.recordedFabricId || record.fabricId,
        composition: tr?.recordedFabricComposition ?? '',
        weightGsm: tr?.recordedFabricWeightGsm ?? null,
        stretchPct: tr?.recordedFabricStretchPct ?? null,
        direction: tr?.recordedFabricDirection ?? '',
        lot: tr?.recordedFabricLot ?? ''
      },
      process: proc,
      instrument: {
        type: record.measurementInstrument ?? 'calibrated-fiberglass-tape',
        resolutionCm:
          record.instrumentResolutionCm ??
          INSTRUMENT_RESOLUTION_CM[record.measurementInstrument ?? 'calibrated-fiberglass-tape'],
        dressFormOrBodyId: record.bodyOrDressFormId,
        evaluatorName: record.evaluatorName,
        evaluatedAt: record.evaluatedAt
      },
      pomMeasurements: record.pomCheckpoints,
      regionalObservations: record.regionalAgreementChecks,
      evidenceAttachments: record.evidenceChecklist,
      hemLevelPhysicalDeviationCm: record.hemLevelPhysicalDeviationCm,
      seamAlignmentVerified: record.seamAlignmentVerified,
      grainlineVerified: record.grainlineVerified
    },
    evaluationOutcome,
    reviewerDecision: record.reviewerDecision ?? {
      decision: 'PENDING',
      reviewerName: '',
      reviewerRole: '',
      decidedAt: null,
      rationale: '',
      signatureDigest: null
    },
    governanceInvariants: {
      isProductionReady: false,
      physicalValidationRequired: true,
      m00Accepted: false,
      gateAuth3Status: 'CLOSED',
      externalCadInteroperabilityVerified: false,
      syntheticDataProhibited: true
    }
  };

  const canonicalDigest = computeCanonicalSha256(payloadWithoutDigest);
  const report: Ac09ExportableValidationReport = {
    ...payloadWithoutDigest,
    canonicalDigest
  };
  const canonicalJson = JSON.stringify(report, null, 2);
  return { report, canonicalJson };
}
