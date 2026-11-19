/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, DesignSpecification, PatternPiece } from '../../types';
import { BodiceSleeveAssemblyResult } from '../assembly/assembly-types';
import { draftBodiceBlock } from '../drafting/bodice-block';
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
  Ac09ReviewerDecision,
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
export const AC09_MIN_REPEAT_READINGS = 2;

export const AC09_MANDATORY_PHOTO_ITEM_IDS = [
  'ev-front-photo',
  'ev-side-photo',
  'ev-back-photo'
] as const;

export const AC09_MANDATORY_EVIDENCE_ITEM_IDS = [
  'ev-front-photo',
  'ev-side-photo',
  'ev-back-photo',
  'ev-pom-caliper-sheet',
  'ev-grain-hem-check',
  'ev-seam-parity-check'
] as const;

const ACCEPTED_ATTACHMENT_URI_PATTERN =
  /^(photo|file|https|s3|gs|atelier|sha256):\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]+)+$/i;

const SYNTHETIC_ATTACHMENT_URI_PATTERN = /^(synthetic|simulated|mock|generated|data):/i;

const PLACEHOLDER_ATTACHMENT_SEGMENTS = new Set([
  'tbd',
  'todo',
  'placeholder',
  'dummy',
  'fake',
  'n/a',
  'none',
  'null',
  'undefined',
  '12345',
  'test',
  'example'
]);

/**
 * Validates an AC-09 physical evidence attachment URI against accepted reference formats.
 * Rejects empty strings, bare placeholders, and synthetic/simulated URIs.
 */
export function isValidAc09AttachmentUri(uri: string | undefined | null): boolean {
  if (typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  if (trimmed.length < 12) return false;
  if (SYNTHETIC_ATTACHMENT_URI_PATTERN.test(trimmed)) return false;
  if (!ACCEPTED_ATTACHMENT_URI_PATTERN.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();
  const withoutScheme = lower.replace(/^[a-z0-9]+:\/\//, '');
  const tokens = withoutScheme.split(/[/?#]+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const leaf = tokens[tokens.length - 1];
  const leafStem = leaf.replace(/\.[a-z0-9]+$/i, '');
  if (
    PLACEHOLDER_ATTACHMENT_SEGMENTS.has(withoutScheme) ||
    PLACEHOLDER_ATTACHMENT_SEGMENTS.has(leaf) ||
    PLACEHOLDER_ATTACHMENT_SEGMENTS.has(leafStem)
  ) {
    return false;
  }
  return true;
}

/**
 * Recomputes arithmetic mean, spread, and combined Type-B + repeat uncertainty
 * strictly from raw independent physical readings.
 */
export function recomputeAc09PomMetrics(
  readingsCm: readonly number[],
  nominalCadCm: number,
  resolutionCm: number
): {
  readonly measuredToileCm: number;
  readonly repeatSpreadCm: number;
  readonly combinedUncertaintyCm: number;
  readonly deltaCm: number;
} {
  const cleanedReadings = readingsCm.map(v => Number(v.toFixed(3)));
  const mean = cleanedReadings.reduce((acc, v) => acc + v, 0) / cleanedReadings.length;
  const measuredToileCm = Number(mean.toFixed(3));
  const spread =
    cleanedReadings.length > 1
      ? Number((Math.max(...cleanedReadings) - Math.min(...cleanedReadings)).toFixed(4))
      : 0;
  const combinedUncertaintyCm = Number(
    Math.sqrt(Math.pow(resolutionCm / 2, 2) + Math.pow(spread / 2, 2)).toFixed(4)
  );
  const deltaCm = Number((measuredToileCm - nominalCadCm).toFixed(4));
  return {
    measuredToileCm,
    repeatSpreadCm: spread,
    combinedUncertaintyCm,
    deltaCm
  };
}

/**
 * Canonical security-relevant payload signed by an authorized human AC-09 reviewer.
 * Covers identity, traceability, cutting/sewing process records, POM checkpoints,
 * regional observations, photographic evidence checklist, structural checks, and decision metadata.
 */
export function computeAc09ReviewerSignatureDigest(
  record: Ac09PhysicalToileRecord,
  decisionInput: Pick<Ac09ReviewerDecision, 'reviewerName' | 'reviewerRole' | 'decision' | 'rationale' | 'decidedAt'>
): string {
  const instrument = record.measurementInstrument ?? 'calibrated-fiberglass-tape';
  const resolutionCm = record.instrumentResolutionCm ?? INSTRUMENT_RESOLUTION_CM[instrument];

  return computeCanonicalSha256({
    schema: 'patroner-ac09-signature-v2',
    recordId: record.recordId,
    sampleId: record.sampleId ?? '',
    sampleRevision: record.sampleRevision ?? 1,
    toileBlockKey: record.toileBlockKey,
    revisionId: record.revisionId,
    sizeCode: record.sizeCode,
    fabricId: record.fabricId,
    poseId: record.poseId,
    bodyOrDressFormId: record.bodyOrDressFormId,
    evaluatorName: record.evaluatorName,
    evaluatedAt: record.evaluatedAt,
    measurementInstrument: instrument,
    instrumentResolutionCm: resolutionCm,
    tolerancePolicy: record.tolerancePolicy ?? DEFAULT_AC09_TOLERANCE_POLICY,
    traceability: record.traceability ?? null,
    processRecord: record.processRecord ?? null,
    grainlineVerified: record.grainlineVerified,
    seamAlignmentVerified: record.seamAlignmentVerified,
    hemLevelPhysicalDeviationCm: record.hemLevelPhysicalDeviationCm,
    pomCheckpoints: record.pomCheckpoints.map(p => ({
      pointId: p.pointId,
      nominalCadCm: p.nominalCadCm,
      toleranceCm: p.toleranceCm,
      repeatReadingsCm: p.repeatReadingsCm ?? [],
      measuredToileCm: p.measuredToileCm,
      repeatSpreadCm: p.repeatSpreadCm ?? null,
      combinedUncertaintyCm: p.combinedUncertaintyCm ?? null,
      deltaCm: p.deltaCm,
      withinTolerance: p.withinTolerance,
      sourceFlag: p.sourceFlag ?? null
    })),
    regionalAgreementChecks: record.regionalAgreementChecks.map(rz => ({
      zoneId: rz.zoneId,
      digitalPredictionStatus: rz.digitalPredictionStatus,
      physicalObservationSummary: rz.physicalObservationSummary,
      agreesWithDigitalPrediction: rz.agreesWithDigitalPrediction
    })),
    evidenceChecklist: record.evidenceChecklist.map(ev => ({
      itemId: ev.itemId,
      category: ev.category,
      recorded: ev.recorded,
      attachmentUri: ev.attachmentUri ?? null,
      capturedAt: ev.capturedAt ?? null,
      isSyntheticSource: ev.isSyntheticSource ?? false
    })),
    reviewerDecisionMeta: {
      reviewerName: decisionInput.reviewerName.trim(),
      reviewerRole: decisionInput.reviewerRole,
      decision: decisionInput.decision,
      rationale: decisionInput.rationale.trim(),
      decidedAt: decisionInput.decidedAt ?? null
    }
  });
}

/**
 * Computes the deterministic locked snapshot digest binding the complete finalized AC-09 record
 * including workflow state, lock metadata, process record, evidence checklist, and reviewer signature.
 */
export function computeAc09LockedSnapshotDigest(record: Ac09PhysicalToileRecord): string {
  const instrument = record.measurementInstrument ?? 'calibrated-fiberglass-tape';
  const resolutionCm = record.instrumentResolutionCm ?? INSTRUMENT_RESOLUTION_CM[instrument];

  return computeCanonicalSha256({
    schema: 'patroner-ac09-locked-snapshot-v2',
    recordId: record.recordId,
    sampleId: record.sampleId ?? '',
    sampleRevision: record.sampleRevision ?? 1,
    workflowState: record.workflowState ?? null,
    isLocked: Boolean(record.isLocked),
    lockedAt: record.lockedAt ?? null,
    toileBlockKey: record.toileBlockKey,
    revisionId: record.revisionId,
    sizeCode: record.sizeCode,
    fabricId: record.fabricId,
    poseId: record.poseId,
    bodyOrDressFormId: record.bodyOrDressFormId,
    evaluatorName: record.evaluatorName,
    evaluatedAt: record.evaluatedAt,
    measurementInstrument: instrument,
    instrumentResolutionCm: resolutionCm,
    tolerancePolicy: record.tolerancePolicy ?? DEFAULT_AC09_TOLERANCE_POLICY,
    traceability: record.traceability ?? null,
    processRecord: record.processRecord ?? null,
    grainlineVerified: record.grainlineVerified,
    seamAlignmentVerified: record.seamAlignmentVerified,
    hemLevelPhysicalDeviationCm: record.hemLevelPhysicalDeviationCm,
    pomCheckpoints: record.pomCheckpoints,
    regionalAgreementChecks: record.regionalAgreementChecks,
    evidenceChecklist: record.evidenceChecklist,
    reviewerDecision: record.reviewerDecision ?? null
  });
}

/**
 * Computes the authoritative CAD nominal Armscye Seam Circumference (cm) for bodice-sleeve-v1.
 *
 * Sartorial & geometric definition:
 * When the sleeve cap (containing easing fullness) is set into the bodice armhole along the
 * stitching line, the finished armscye seam circumference equals the joined front + back
 * bodice armhole stitching perimeter (L_bf + L_bb, e.g., 36.79 cm for Size M), NOT the
 * un-eased sleeve cap perimeter (40.05 cm) and NEVER the horizontal torso circumference
 * at the scye-depth height plane (86.40 cm).
 */
export function resolveNominalBodiceArmscyeSeamCm(params: {
  designSpec: DesignSpecification;
  measurements: BodyMeasurements;
  assemblyResult?: BodiceSleeveAssemblyResult;
  patternPieces?: readonly PatternPiece[];
}): number {
  const { designSpec, measurements, assemblyResult, patternPieces } = params;

  // 1. Primary authoritative source: M04.3 assembled bodice armhole stitching perimeter (L_bf + L_bb)
  const assembledTotal = assemblyResult?.ease?.totalBodiceArmholeLengthCm;
  if (typeof assembledTotal === 'number' && Number.isFinite(assembledTotal) && assembledTotal > 15 && assembledTotal < 75) {
    return Number(assembledTotal.toFixed(2));
  }

  // 2. Secondary authoritative source: measure fb-armhole + bb-armhole directly from drafted bodice pieces
  const measureFromPieces = (pieces: readonly PatternPiece[]): number | null => {
    const front = pieces.find(p => p.id === 'piece-bodice-front' || p.pieceCode.startsWith('BOD-F'));
    const back = pieces.find(p => p.id === 'piece-bodice-back' || p.pieceCode.startsWith('BOD-B'));
    if (!front || !back) return null;

    const getArmholeLen = (piece: PatternPiece, segId: string, seamId: string): number | null => {
      const seg = piece.stitchingContour?.segments.find(s => s.id === segId);
      if (seg && typeof seg.lengthCm === 'function') {
        const len = seg.lengthCm();
        if (Number.isFinite(len) && len > 0) return len;
      }
      const seam = piece.seams.find(s => s.id === seamId || s.name.toLowerCase().includes('armhole'));
      if (seam && Number.isFinite(seam.lengthCm) && seam.lengthCm > 0) {
        return seam.lengthCm;
      }
      return null;
    };

    const frontLen = getArmholeLen(front, 'fb-armhole', 'fb-armhole-seam');
    const backLen = getArmholeLen(back, 'bb-armhole', 'bb-armhole-seam');
    if (frontLen !== null && backLen !== null) {
      return Number((frontLen + backLen).toFixed(2));
    }
    return null;
  };

  if (patternPieces && patternPieces.length > 0) {
    const fromSupplied = measureFromPieces(patternPieces);
    if (fromSupplied !== null) return fromSupplied;
  }

  // 3. Deterministic fallback: draft the bodice block from the exact spec & measurements
  //    so the nominal CAD armscye always reflects real stitched bodice geometry, never torso girth.
  const draftedBodicePieces = draftBodiceBlock(measurements, designSpec, {
    dartStyle: designSpec.dartStyle ?? 'waist'
  });
  const fromDrafted = measureFromPieces(draftedBodicePieces);
  if (fromDrafted !== null) return fromDrafted;

  throw new Error(
    'AC09_ARMSCYE_NOMINAL_UNAVAILABLE: Unable to derive stitched bodice armhole perimeter from assembly or drafted bodice pieces.'
  );
}

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
  assemblyResult?: BodiceSleeveAssemblyResult;
  patternPieces?: readonly PatternPiece[];
  approvedPatternRevisionId?: string;
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
    assemblyResult,
    patternPieces,
    approvedPatternRevisionId,
    sizeCode = measurements.waist <= 66 ? 'S' : measurements.waist <= 74 ? 'M' : 'L',
    poseId = fitReport?.poseId ?? 'CANONICAL_A_POSE',
    constructionDocRef = `m05-pkg-${designSpec.id}-${sizeCode}`,
    simulationCaseRef = fitReport?.simulationId ?? `sim-${toileBlockKey}-awaiting`,
    executionMode = 'legacy',
    tolerancePolicy = DEFAULT_AC09_TOLERANCE_POLICY
  } = params;

  const validatedPolicy = validateAc09TolerancePolicy(tolerancePolicy);
  const revisionId =
    approvedPatternRevisionId ??
    designSpec.specificationRevisionId ??
    `spec-${designSpec.id}-v${designSpec.version}`;
  const isBodice = toileBlockKey === 'bodice-sleeve-v1';

  const nominalArmscyeSeamCm = isBodice
    ? resolveNominalBodiceArmscyeSeamCm({
        designSpec,
        measurements,
        assemblyResult,
        patternPieces
      })
    : 0;

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
          'Closed perimeter measured along the joined bodice armhole stitching line (L_bf + L_bb bodice scye seam, distinct from un-eased sleeve cap length and horizontal torso chest girth).',
          'scye_armhole',
          nominalArmscyeSeamCm,
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

  const currentWorkflowState: Ac09WorkflowState = record.workflowState ?? 'PENDING';

  // Enforce strict workflow state machine progression:
  // APPROVED_PASS may ONLY be recorded after the sample explicitly reached READY_FOR_REVIEW.
  if (input.decision === 'APPROVED_PASS' && currentWorkflowState !== 'READY_FOR_REVIEW') {
    throw new Error(
      `AC09_INVALID_WORKFLOW_STATE: Cannot record APPROVED_PASS reviewer decision from workflow state '${currentWorkflowState}'. Record must transition through the approved workflow to 'READY_FOR_REVIEW' first.`
    );
  }

  // REJECTED_FAIL requires at least a registered sample (cannot reject uninitialized PENDING/DRAFT directly)
  if (
    input.decision === 'REJECTED_FAIL' &&
    currentWorkflowState !== 'SAMPLE_REGISTERED' &&
    currentWorkflowState !== 'EVIDENCE_INCOMPLETE' &&
    currentWorkflowState !== 'READY_FOR_REVIEW'
  ) {
    throw new Error(
      `AC09_INVALID_WORKFLOW_STATE: Cannot record REJECTED_FAIL from workflow state '${currentWorkflowState}'. Register sample before reviewer rejection.`
    );
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
      preEval.allEvidenceRecorded &&
      preEval.missingEvidenceDiagnostics.length === 0 &&
      preEval.pomConcordancePassed &&
      preEval.regionalAgreementPassed &&
      record.grainlineVerified &&
      Boolean(record.processRecord?.cuttingGrainlineVerified) &&
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
  const decisionMeta = {
    reviewerName: input.reviewerName.trim(),
    reviewerRole: input.reviewerRole,
    decision: input.decision,
    rationale: input.rationale.trim(),
    decidedAt
  };
  const signatureDigest = computeAc09ReviewerSignatureDigest(workflowRecord, decisionMeta);

  const finalState: Ac09WorkflowState = input.decision === 'APPROVED_PASS' ? 'PASSED' : 'FAILED';
  const nextRecord: Ac09PhysicalToileRecord = {
    ...workflowRecord,
    workflowState: finalState,
    reviewerDecision: {
      ...decisionMeta,
      signatureDigest
    },
    isLocked: true,
    lockedAt: decidedAt
  };

  const snapshotDigest = computeAc09LockedSnapshotDigest(nextRecord);

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
  const instrument = record.measurementInstrument ?? 'calibrated-fiberglass-tape';
  const resolutionCm = record.instrumentResolutionCm ?? INSTRUMENT_RESOLUTION_CM[instrument];

  // Synthetic source guard (prohibits simulated/generated evidence in physical store)
  const syntheticChecklistItems = record.evidenceChecklist.filter(
    ev =>
      ev.isSyntheticSource === true ||
      Boolean(ev.attachmentUri && SYNTHETIC_ATTACHMENT_URI_PATTERN.test(ev.attachmentUri.trim()))
  );
  const syntheticPoms = record.pomCheckpoints.filter(
    pt =>
      (pt.measuredToileCm !== null || (pt.repeatReadingsCm?.length ?? 0) > 0) &&
      pt.sourceFlag !== undefined &&
      pt.sourceFlag !== 'PHYSICAL_OPERATOR_CAPTURE'
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

  // POM Measurements & Independent Repeat-Reading Uncertainty Recomputation
  const requiredPomCount = record.pomCheckpoints.length;
  let completedPomCount = 0;
  let anyPomReadingRecorded = false;
  let maxPomConcordanceErrorCm: number | null = null;
  let maxMeasurementUncertaintyCm: number | null = null;
  let pomAllWithinTolerance = true;
  let uncertaintyAllWithinLimit = true;
  let derivedUncertaintyIntegrityFailed = false;

  for (const pt of record.pomCheckpoints) {
    const effectiveLimit = Math.min(pt.toleranceCm, policy.pomToleranceCm);
    const rawReadings = Array.isArray(pt.repeatReadingsCm) ? pt.repeatReadingsCm : [];
    const hasInvalidReading = rawReadings.some(v => !Number.isFinite(v) || v <= 0);
    const validReadings = rawReadings.filter(v => Number.isFinite(v) && v > 0);
    const hasMeasuredScalar =
      pt.measuredToileCm !== null && Number.isFinite(pt.measuredToileCm) && pt.measuredToileCm > 0;

    if (hasInvalidReading) {
      anyPomReadingRecorded = true;
      derivedUncertaintyIntegrityFailed = true;
      blockingReasons.push(
        `AC09_INVALID_POM_READING: POM '${pt.label}' contains non-finite or non-positive repeat reading(s).`
      );
      continue;
    }

    if (validReadings.length === 0 && !hasMeasuredScalar) {
      missingEvidenceDiagnostics.push(`Missing physical POM repeat readings for '${pt.label}'.`);
      continue;
    }

    anyPomReadingRecorded = true;

    // Require at least AC09_MIN_REPEAT_READINGS (2) independent physical readings.
    // A single reading must NEVER satisfy AC-09 acceptance.
    if (validReadings.length < AC09_MIN_REPEAT_READINGS) {
      missingEvidenceDiagnostics.push(
        `POM '${pt.label}' has ${validReadings.length} reading(s); at least ${AC09_MIN_REPEAT_READINGS} independent repeat readings are required.`
      );
      // Still check single-reading tolerance violation fail-closed so an out-of-tolerance single entry flags FAILED
      const scalarVal = validReadings.length === 1 ? validReadings[0] : pt.measuredToileCm!;
      const err = Math.abs(Number((scalarVal - pt.nominalCadCm).toFixed(4)));
      maxPomConcordanceErrorCm = maxPomConcordanceErrorCm === null ? err : Math.max(maxPomConcordanceErrorCm, err);
      if (err > effectiveLimit) {
        pomAllWithinTolerance = false;
        blockingReasons.push(
          `POM '${pt.label}' delta ${err.toFixed(3)} cm exceeds AC-09 limit (±${effectiveLimit.toFixed(2)} cm).`
        );
      }
      // Also catch forged combinedUncertaintyCm on single-reading records
      if (pt.combinedUncertaintyCm !== null && pt.combinedUncertaintyCm !== undefined) {
        const expectedSingleUnc = Number((resolutionCm / 2).toFixed(4));
        if (!Number.isFinite(pt.combinedUncertaintyCm) || Math.abs(pt.combinedUncertaintyCm - expectedSingleUnc) > 0.002) {
          derivedUncertaintyIntegrityFailed = true;
          blockingReasons.push(
            `AC09_FORGED_UNCERTAINTY: POM '${pt.label}' supplied combinedUncertaintyCm (${pt.combinedUncertaintyCm}) does not match recomputed instrument uncertainty (${expectedSingleUnc}).`
          );
        }
      }
      continue;
    }

    // Recompute mean, spread, and combined uncertainty strictly from actual repeat readings.
    // Never trust supplied measuredToileCm, repeatSpreadCm, or combinedUncertaintyCm without recomputation.
    const recomputed = recomputeAc09PomMetrics(validReadings, pt.nominalCadCm, resolutionCm);

    if (
      pt.measuredToileCm === null ||
      !Number.isFinite(pt.measuredToileCm) ||
      Math.abs(pt.measuredToileCm - recomputed.measuredToileCm) > 0.002
    ) {
      derivedUncertaintyIntegrityFailed = true;
      blockingReasons.push(
        `AC09_INCONSISTENT_POM_MEAN: POM '${pt.label}' stored mean (${pt.measuredToileCm}) diverges from recomputed repeat mean (${recomputed.measuredToileCm} cm).`
      );
    }

    if (
      pt.repeatSpreadCm === null ||
      pt.repeatSpreadCm === undefined ||
      !Number.isFinite(pt.repeatSpreadCm) ||
      Math.abs(pt.repeatSpreadCm - recomputed.repeatSpreadCm) > 0.002
    ) {
      derivedUncertaintyIntegrityFailed = true;
      blockingReasons.push(
        `AC09_FORGED_SPREAD: POM '${pt.label}' stored repeatSpreadCm (${pt.repeatSpreadCm}) diverges from recomputed spread (${recomputed.repeatSpreadCm} cm).`
      );
    }

    if (
      pt.combinedUncertaintyCm === null ||
      pt.combinedUncertaintyCm === undefined ||
      !Number.isFinite(pt.combinedUncertaintyCm) ||
      Math.abs(pt.combinedUncertaintyCm - recomputed.combinedUncertaintyCm) > 0.002
    ) {
      derivedUncertaintyIntegrityFailed = true;
      blockingReasons.push(
        `AC09_FORGED_UNCERTAINTY: POM '${pt.label}' supplied combinedUncertaintyCm (${pt.combinedUncertaintyCm}) diverges from recomputed uncertainty (${recomputed.combinedUncertaintyCm} cm).`
      );
    }

    completedPomCount++;
    const err = Math.abs(recomputed.deltaCm);
    maxPomConcordanceErrorCm = maxPomConcordanceErrorCm === null ? err : Math.max(maxPomConcordanceErrorCm, err);
    if (err > effectiveLimit) {
      pomAllWithinTolerance = false;
      blockingReasons.push(
        `POM '${pt.label}' delta ${err.toFixed(3)} cm exceeds AC-09 limit (±${effectiveLimit.toFixed(2)} cm).`
      );
    }

    maxMeasurementUncertaintyCm =
      maxMeasurementUncertaintyCm === null
        ? recomputed.combinedUncertaintyCm
        : Math.max(maxMeasurementUncertaintyCm, recomputed.combinedUncertaintyCm);
    if (recomputed.combinedUncertaintyCm > policy.maxAllowedUncertaintyCm) {
      uncertaintyAllWithinLimit = false;
      blockingReasons.push(
        `POM '${pt.label}' repeat measurement uncertainty ±${recomputed.combinedUncertaintyCm.toFixed(3)} cm exceeds max allowed ±${policy.maxAllowedUncertaintyCm.toFixed(2)} cm (re-measure carefully).`
      );
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

  // Mandatory Photographic & Physical Evidence Checklist
  // Prevent empty checklist zero-equals-zero bypass and enforce mandatory protocol items & URI format.
  let evidenceCompletedCount = 0;
  const checklistById = new Map(record.evidenceChecklist.map(ev => [ev.itemId, ev]));
  const missingMandatoryItemIds = AC09_MANDATORY_EVIDENCE_ITEM_IDS.filter(id => !checklistById.has(id));
  const requiredEvidenceCount = Math.max(record.evidenceChecklist.length, AC09_MANDATORY_EVIDENCE_ITEM_IDS.length);

  if (record.evidenceChecklist.length === 0) {
    missingEvidenceDiagnostics.push(
      'Evidence checklist is empty; mandatory front, side, back photographs and physical logs are required.'
    );
  } else if (missingMandatoryItemIds.length > 0) {
    missingEvidenceDiagnostics.push(
      `Missing mandatory protocol evidence checklist item(s): ${missingMandatoryItemIds.join(', ')}.`
    );
  }

  let invalidAttachmentUriDetected = false;
  for (const ev of record.evidenceChecklist) {
    const rawUri = ev.attachmentUri?.trim() ?? '';
    const isSyntheticUri = ev.isSyntheticSource === true || SYNTHETIC_ATTACHMENT_URI_PATTERN.test(rawUri);
    const hasValidUri = isValidAc09AttachmentUri(rawUri);
    if (ev.recorded && hasValidUri && !isSyntheticUri) {
      evidenceCompletedCount++;
    } else if (!ev.recorded) {
      missingEvidenceDiagnostics.push(`Unrecorded evidence checklist item: '${ev.label}'.`);
    } else if (!rawUri) {
      missingEvidenceDiagnostics.push(`Missing photo/log attachment reference URI for '${ev.label}'.`);
    } else if (!hasValidUri) {
      invalidAttachmentUriDetected = true;
      missingEvidenceDiagnostics.push(
        `Invalid or placeholder attachment reference URI '${rawUri}' for '${ev.label}' (expected photo://, file://, https://, s3://, gs://, atelier://, or sha256:// path).`
      );
    }
  }

  const allMandatoryPhotosValid = AC09_MANDATORY_PHOTO_ITEM_IDS.every(id => {
    const item = checklistById.get(id);
    return Boolean(item && item.recorded && !item.isSyntheticSource && isValidAc09AttachmentUri(item.attachmentUri));
  });

  const allEvidenceRecorded =
    record.evidenceChecklist.length > 0 &&
    missingMandatoryItemIds.length === 0 &&
    allMandatoryPhotosValid &&
    evidenceCompletedCount === record.evidenceChecklist.length;

  const hasAnyPhysicalData =
    anyPomReadingRecorded ||
    evaluatedZonesCount > 0 ||
    record.evidenceChecklist.some(item => item.recorded || Boolean(item.attachmentUri?.trim())) ||
    record.hemLevelPhysicalDeviationCm !== null ||
    record.seamAlignmentVerified !== null ||
    record.grainlineVerified ||
    Boolean(record.sampleId && record.sampleId.trim().length > 0) ||
    Boolean(record.processRecord?.cuttingGrainlineVerified) ||
    Boolean(record.processRecord?.cuttingOperator && record.processRecord.cuttingOperator.trim().length > 0) ||
    Boolean(record.processRecord?.sewingOperator && record.processRecord.sewingOperator.trim().length > 0) ||
    Boolean(record.processRecord?.stitchType && record.processRecord.stitchType.trim().length > 0) ||
    Boolean(record.processRecord?.pressingMethod && record.processRecord.pressingMethod.trim().length > 0) ||
    Boolean(record.reviewerDecision && record.reviewerDecision.decision !== 'PENDING') ||
    Boolean(record.isLocked);

  if (
    !hasAnyPhysicalData &&
    record.workflowState !== 'DRAFT' &&
    !syntheticEvidenceDetected &&
    traceabilityMismatches.length === 0 &&
    missingMandatoryItemIds.length === 0 &&
    record.evidenceChecklist.length > 0
  ) {
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
        `Physical toile trial not yet executed for '${record.toileBlockKey}'. Register sample ID, cut, sew, mount on calibrated dress form, and record repeat tape/caliper POM & regional observations.`
      ],
      summary: `AC-09 PENDING: Awaiting sewn toile execution for ${record.toileBlockKey} (≤ 0.50 cm POM & ≥ 85% regional agreement required).`,
      isProductionReady: false
    };
  }

  const allPomsComplete =
    completedPomCount === requiredPomCount && requiredPomCount > 0 && !derivedUncertaintyIntegrityFailed;
  const allZonesEvaluated =
    evaluatedZonesCount === record.regionalAgreementChecks.length && evaluatedZonesCount > 0;
  const hasMetadata =
    record.evaluatorName.trim().length >= 2 &&
    record.bodyOrDressFormId.trim().length >= 2 &&
    Boolean(record.evaluatedAt);

  if (!hasMetadata) {
    missingEvidenceDiagnostics.push('Missing evaluator identity, dress form/body ID, or physical trial date.');
  }

  // Mandatory sample registration, complete fabric traceability, and cutting/sewing process verification
  if (!record.sampleId || record.sampleId.trim().length < 3) {
    missingEvidenceDiagnostics.push('Missing registered physical sampleId.');
  }
  if (!tr || tr.recordedPatternRevisionId.trim().length === 0) {
    missingEvidenceDiagnostics.push('Missing confirmed cut pattern revision ID.');
  }
  if (!tr || tr.recordedFabricId.trim().length === 0) {
    missingEvidenceDiagnostics.push('Missing recorded fabric ID in sample traceability.');
  }
  if (!tr || tr.recordedFabricComposition.trim().length === 0 || tr.recordedFabricWeightGsm === null || !Number.isFinite(tr.recordedFabricWeightGsm) || tr.recordedFabricWeightGsm <= 0 || tr.recordedFabricLot.trim().length === 0) {
    missingEvidenceDiagnostics.push('Missing fabric composition, gsm weight, or lot traceability record.');
  }
  if (!tr || tr.recordedFabricStretchPct === null || !Number.isFinite(tr.recordedFabricStretchPct) || tr.recordedFabricStretchPct < 0) {
    missingEvidenceDiagnostics.push('Missing recorded fabric stretch percentage in sample traceability.');
  }
  if (!tr || tr.recordedFabricDirection.trim().length === 0) {
    missingEvidenceDiagnostics.push('Missing recorded fabric cut direction in sample traceability.');
  }
  if (!tr || tr.constructionDocRef.trim().length === 0 || tr.simulationCaseRef.trim().length === 0) {
    missingEvidenceDiagnostics.push('Missing M05 construction documentation or M06 simulation baseline reference.');
  }
  const pr = record.processRecord;
  if (!pr || !pr.cuttingGrainlineVerified) {
    missingEvidenceDiagnostics.push('Cutting grainline verification not explicitly confirmed in process record.');
  }
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

  if (!record.grainlineVerified) {
    missingEvidenceDiagnostics.push('Physical grainline plumb check not verified.');
  }
  if (record.seamAlignmentVerified === null) {
    missingEvidenceDiagnostics.push('Physical seam alignment inspection unrecorded.');
  }

  // Merge missing-evidence diagnostics into blockingReasons cleanly
  if (!allPomsComplete) {
    blockingReasons.push(
      `${requiredPomCount - completedPomCount} physical POM checkpoint(s) incomplete (at least ${AC09_MIN_REPEAT_READINGS} independent repeat readings required per checkpoint).`
    );
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
      record.evidenceChecklist.length === 0
        ? 'Evidence checklist is empty; mandatory front, side, back photographs and physical logs are required.'
        : missingMandatoryItemIds.length > 0
        ? `Missing mandatory evidence checklist item(s): ${missingMandatoryItemIds.join(', ')}.`
        : `${requiredEvidenceCount - evidenceCompletedCount} photographic/measurement checklist evidence item(s) or accepted attachment URIs incomplete.`
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
    allPomsComplete &&
    pomAllWithinTolerance &&
    uncertaintyAllWithinLimit &&
    !derivedUncertaintyIntegrityFailed &&
    maxPomConcordanceErrorCm !== null;
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
    Boolean(tr) &&
    tr!.recordedPatternRevisionId.trim().length > 0 &&
    tr!.recordedFabricId.trim().length > 0 &&
    tr!.recordedFabricComposition.trim().length > 0 &&
    tr!.recordedFabricWeightGsm !== null &&
    Number.isFinite(tr!.recordedFabricWeightGsm) &&
    tr!.recordedFabricWeightGsm > 0 &&
    tr!.recordedFabricStretchPct !== null &&
    Number.isFinite(tr!.recordedFabricStretchPct) &&
    tr!.recordedFabricStretchPct >= 0 &&
    tr!.recordedFabricDirection.trim().length > 0 &&
    tr!.recordedFabricLot.trim().length > 0 &&
    tr!.constructionDocRef.trim().length > 0 &&
    tr!.simulationCaseRef.trim().length > 0;

  // Cryptographic Reviewer Signature & Locked Snapshot Verification
  const reviewerDecision = record.reviewerDecision;
  const signOffRecorded = Boolean(reviewerDecision && reviewerDecision.decision !== 'PENDING');
  let signatureIntegrityFailed = false;
  let lockIntegrityFailed = false;

  const hasValidReviewerMetadata = Boolean(
    reviewerDecision &&
      AUTHORIZED_AC09_REVIEWER_ROLES.includes(reviewerDecision.reviewerRole as Ac09AuthorizedReviewerRole) &&
      reviewerDecision.reviewerName.trim().length >= 3 &&
      reviewerDecision.rationale.trim().length >= 5 &&
      Boolean(reviewerDecision.decidedAt) &&
      Boolean(reviewerDecision.signatureDigest)
  );

  let signatureDigestMatches = false;
  let lockSnapshotValid = false;

  if (signOffRecorded && reviewerDecision) {
    if (hasValidReviewerMetadata) {
      const expectedSig = computeAc09ReviewerSignatureDigest(record, reviewerDecision);
      signatureDigestMatches = reviewerDecision.signatureDigest === expectedSig;
      if (!signatureDigestMatches) {
        signatureIntegrityFailed = true;
        blockingReasons.push(
          'AC09_SIGNATURE_TAMPER_DETECTED: Reviewer signatureDigest does not match canonical signed payload (forged signature or post-signature modification detected).'
        );
      }
    } else {
      signatureIntegrityFailed = true;
      blockingReasons.push(
        `AC09_INVALID_SIGN_OFF: Reviewer sign-off is unauthorized or missing required name, role, rationale (>= 5 chars), date, or signature (role='${reviewerDecision.reviewerRole || 'NONE'}').`
      );
    }

    if (reviewerDecision.decision === 'APPROVED_PASS') {
      if (record.isLocked !== true || !record.lockedAt || !record.lockedSnapshotDigest) {
        lockIntegrityFailed = true;
        blockingReasons.push(
          'AC09_LOCK_REQUIRED: Approved AC-09 record must be immutably locked (isLocked === true with lockedAt and lockedSnapshotDigest).'
        );
      } else {
        const expectedLockedDigest = computeAc09LockedSnapshotDigest(record);
        lockSnapshotValid = record.lockedSnapshotDigest === expectedLockedDigest;
        if (!lockSnapshotValid) {
          lockIntegrityFailed = true;
          blockingReasons.push(
            'AC09_LOCKED_SNAPSHOT_TAMPER_DETECTED: lockedSnapshotDigest does not match the current record contents.'
          );
        }
      }
    } else if (reviewerDecision.decision === 'REJECTED_FAIL') {
      if (record.isLocked === true && record.lockedSnapshotDigest) {
        const expectedLockedDigest = computeAc09LockedSnapshotDigest(record);
        lockSnapshotValid = record.lockedSnapshotDigest === expectedLockedDigest;
        if (!lockSnapshotValid) {
          lockIntegrityFailed = true;
          blockingReasons.push(
            'AC09_LOCKED_SNAPSHOT_TAMPER_DETECTED: lockedSnapshotDigest does not match the rejected record contents.'
          );
        }
      }
    }
  }

  const signOffAuthorized = Boolean(
    hasValidReviewerMetadata &&
      signatureDigestMatches &&
      (reviewerDecision?.decision !== 'APPROVED_PASS' || (record.isLocked === true && lockSnapshotValid))
  );

  if (reviewerDecision?.decision === 'REJECTED_FAIL') {
    blockingReasons.push(`Reviewer rejected sample: ${reviewerDecision.rationale || 'Rejected FAIL'}.`);
  }

  const hasFailureCondition =
    syntheticEvidenceDetected ||
    traceabilityMismatches.length > 0 ||
    derivedUncertaintyIntegrityFailed ||
    invalidAttachmentUriDetected ||
    (anyPomReadingRecorded && (!pomAllWithinTolerance || !uncertaintyAllWithinLimit)) ||
    (allZonesEvaluated && !regionalAgreementPassed) ||
    record.seamAlignmentVerified === false ||
    (record.hemLevelPhysicalDeviationCm !== null &&
      record.hemLevelPhysicalDeviationCm > policy.hemLevelToleranceCm) ||
    reviewerDecision?.decision === 'REJECTED_FAIL' ||
    signatureIntegrityFailed ||
    lockIntegrityFailed ||
    (signOffRecorded && !signOffAuthorized);

  const missingProcessOrRefs = missingEvidenceDiagnostics.some(
    d =>
      d.includes('registered physical sampleId') ||
      d.includes('cut pattern revision ID') ||
      d.includes('recorded fabric ID') ||
      d.includes('fabric composition') ||
      d.includes('fabric stretch percentage') ||
      d.includes('fabric cut direction') ||
      d.includes('construction documentation') ||
      d.includes('Cutting grainline verification') ||
      d.includes('cutting or sewing')
  );

  if (missingProcessOrRefs) {
    const processRefIssues = missingEvidenceDiagnostics.filter(
      d =>
        d.includes('registered physical sampleId') ||
        d.includes('cut pattern revision ID') ||
        d.includes('recorded fabric ID') ||
        d.includes('fabric composition') ||
        d.includes('fabric stretch percentage') ||
        d.includes('fabric cut direction') ||
        d.includes('construction documentation') ||
        d.includes('Cutting grainline verification') ||
        d.includes('cutting or sewing')
    );
    blockingReasons.push(...processRefIssues);
  }

  const isComplete =
    allPomsComplete &&
    allZonesEvaluated &&
    hasMetadata &&
    allEvidenceRecorded &&
    record.grainlineVerified &&
    Boolean(record.processRecord?.cuttingGrainlineVerified) &&
    record.seamAlignmentVerified === true &&
    traceabilityVerified &&
    !missingProcessOrRefs;

  let status: Ac09ValidationStatus;
  let workflowState: Ac09WorkflowState;

  // Fail-closed across ALL execution modes: no execution mode (including legacy) may bypass
  // mandatory physical evidence, repeat readings, fabric traceability, mandatory photos,
  // verified reviewer signature, or immutable snapshot lock.
  if (hasFailureCondition) {
    status = 'FAILED';
    workflowState = 'FAILED';
  } else if (isComplete && pomConcordancePassed && regionalAgreementPassed) {
    if (
      reviewerDecision?.decision === 'APPROVED_PASS' &&
      signOffAuthorized &&
      record.isLocked === true &&
      lockSnapshotValid
    ) {
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
    !anyPomReadingRecorded &&
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

  const summary =
    status === 'PASSED'
      ? `AC-09 PASSED (${record.toileBlockKey}): max POM delta ${maxPomConcordanceErrorCm?.toFixed(3)} cm <= ${policy.pomToleranceCm.toFixed(2)} cm; regional agreement ${regionalAgreementPct?.toFixed(1)}% >= ${policy.regionalAgreementMinPct}%.`
      : status === 'FAILED'
      ? `AC-09 FAILED (${record.toileBlockKey}): ${blockingReasons[0] ?? 'Physical concordance, signature, or traceability criteria violated.'}`
      : workflowState === 'READY_FOR_REVIEW'
      ? `AC-09 READY_FOR_REVIEW (${record.toileBlockKey}): All physical criteria met; awaiting authorized reviewer sign-off.`
      : `AC-09 ${workflowState} (${record.toileBlockKey}): ${completedPomCount}/${requiredPomCount} POMs (≥${AC09_MIN_REPEAT_READINGS} reads/POM), ${evaluatedZonesCount}/${record.regionalAgreementChecks.length} zones, ${evidenceCompletedCount}/${requiredEvidenceCount} evidence items.`;

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
