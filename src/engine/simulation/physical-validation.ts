/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, DesignSpecification } from '../../types';
import {
  Ac09EvidenceItem,
  Ac09PhysicalToileEvaluation,
  Ac09PhysicalToileRecord,
  Ac09PomCheckpoint,
  Ac09RegionalIssueCheck,
  Ac09ToileBlockKey,
  AvatarPoseId,
  FitEvaluationReport
} from './simulation-types';

export const AC09_POM_CONCORDANCE_TOLERANCE_CM = 0.5;
export const AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT = 85;

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
}): Ac09PhysicalToileRecord {
  const {
    toileBlockKey,
    designSpec,
    measurements,
    fitReport,
    sizeCode = measurements.waist <= 66 ? 'S' : measurements.waist <= 74 ? 'M' : 'L',
    poseId = fitReport?.poseId ?? 'CANONICAL_A_POSE'
  } = params;

  const revisionId = designSpec.specificationRevisionId ?? `spec-${designSpec.id}-v${designSpec.version}`;
  const isBodice = toileBlockKey === 'bodice-sleeve-v1';

  const pomCheckpoints: Ac09PomCheckpoint[] = isBodice
    ? [
        buildPomCheckpoint(
          'pom-bust-circ',
          'Full Bust Finished Circumference',
          'bust',
          fitReport?.regionalZones.bust?.drapedCircumferenceCm ??
            Number(((measurements.bust ?? measurements.waist + 20) + 6.5).toFixed(2))
        ),
        buildPomCheckpoint(
          'pom-waist-circ',
          'Bodice Waist Finished Circumference',
          'waist',
          fitReport?.regionalZones.waist?.drapedCircumferenceCm ?? Number((measurements.waist + 3.5).toFixed(2))
        ),
        buildPomCheckpoint(
          'pom-shoulder-width',
          'Shoulder Bridge Span (Neck to Acromion Seam)',
          'shoulder',
          Number((measurements.shoulderLength ?? 12.5).toFixed(2))
        ),
        buildPomCheckpoint(
          'pom-scye-circ',
          'Armscye Seam Circumference (Fitted Sleeve)',
          'scye_armhole',
          fitReport?.regionalZones.scye_armhole?.bodyCircumferenceCm ??
            Number((((measurements.armholeDepth ?? 21.5) * 2.05) + 3.0).toFixed(2))
        ),
        buildPomCheckpoint(
          'pom-biceps-circ',
          'Upper Arm Sleeve Finished Circumference',
          'biceps_sleeve',
          fitReport?.regionalZones.biceps_sleeve?.drapedCircumferenceCm ??
            Number(((measurements.bicepsCircumference ?? 29.5) + 4.5).toFixed(2))
        )
      ]
    : [
        buildPomCheckpoint(
          'pom-skirt-waist',
          'Skirt Waistband Finished Circumference',
          'waist',
          fitReport?.regionalZones.waist?.drapedCircumferenceCm ?? Number((measurements.waist + 3.5).toFixed(2))
        ),
        buildPomCheckpoint(
          'pom-skirt-high-hip',
          'Skirt High-Hip Finished Circumference (10 cm below waist)',
          'high_hip',
          fitReport?.regionalZones.high_hip?.drapedCircumferenceCm ??
            Number(((measurements.highHip ?? measurements.waist + 12) + 3.75).toFixed(2))
        ),
        buildPomCheckpoint(
          'pom-skirt-low-hip',
          'Skirt Low-Hip Finished Circumference',
          'low_hip',
          fitReport?.regionalZones.low_hip?.drapedCircumferenceCm ?? Number((measurements.lowHip + 5.0).toFixed(2))
        ),
        buildPomCheckpoint(
          'pom-skirt-hem',
          'Skirt Hem Sweep Circumference',
          'hem',
          fitReport?.regionalZones.hem?.drapedCircumferenceCm ?? Number((measurements.lowHip + 7.5).toFixed(2))
        ),
        buildPomCheckpoint(
          'pom-skirt-length',
          'Center Front Finished Length (Waist to Hem)',
          'hem',
          Number((measurements.skirtLength ?? 65.0).toFixed(2))
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

  return {
    recordId: `ac09-${toileBlockKey}-${revisionId}`,
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
  zoneId: Ac09PomCheckpoint['zoneId'],
  nominalCadCm: number
): Ac09PomCheckpoint {
  return {
    pointId,
    label,
    zoneId,
    nominalCadCm,
    measuredToileCm: null,
    toleranceCm: AC09_POM_CONCORDANCE_TOLERANCE_CM,
    deltaCm: null,
    withinTolerance: null
  };
}

/**
 * Evaluates a physical toile validation record strictly fail-closed per M06 §18 AC-09:
 * - Any unrecorded physical run returns 'PENDING'.
 * - Partial entries return 'INCOMPLETE'.
 * - Complete entries pass ONLY when max POM error <= 0.5 cm, regional fit-issue agreement >= 85%,
 *   grainline/seam alignment pass, evaluator provenance is present, and all checklist evidence is recorded.
 */
export function evaluateAc09ToileRecord(record: Ac09PhysicalToileRecord): Ac09PhysicalToileEvaluation {
  const blockingReasons: string[] = [];

  const requiredPomCount = record.pomCheckpoints.length;
  let completedPomCount = 0;
  let maxPomConcordanceErrorCm: number | null = null;
  let pomAllWithinTolerance = true;

  for (const pt of record.pomCheckpoints) {
    if (pt.measuredToileCm !== null && Number.isFinite(pt.measuredToileCm) && pt.measuredToileCm > 0) {
      completedPomCount++;
      const err = Math.abs(Number((pt.measuredToileCm - pt.nominalCadCm).toFixed(3)));
      maxPomConcordanceErrorCm = maxPomConcordanceErrorCm === null ? err : Math.max(maxPomConcordanceErrorCm, err);
      if (err > pt.toleranceCm) {
        pomAllWithinTolerance = false;
        blockingReasons.push(
          `POM '${pt.label}' delta ${err.toFixed(2)} cm exceeds AC-09 limit (±${pt.toleranceCm.toFixed(2)} cm).`
        );
      }
    }
  }

  let evaluatedZonesCount = 0;
  let agreedZonesCount = 0;
  for (const rz of record.regionalAgreementChecks) {
    if (rz.agreesWithDigitalPrediction !== null) {
      evaluatedZonesCount++;
      if (rz.agreesWithDigitalPrediction) agreedZonesCount++;
    }
  }
  const regionalAgreementPct =
    evaluatedZonesCount > 0 ? Number(((agreedZonesCount / evaluatedZonesCount) * 100).toFixed(1)) : null;

  const evidenceCompletedCount = record.evidenceChecklist.filter(item => item.recorded).length;
  const requiredEvidenceCount = record.evidenceChecklist.length;
  const allEvidenceRecorded = evidenceCompletedCount === requiredEvidenceCount;

  const hasAnyPhysicalData =
    completedPomCount > 0 ||
    evaluatedZonesCount > 0 ||
    evidenceCompletedCount > 0 ||
    record.hemLevelPhysicalDeviationCm !== null ||
    record.seamAlignmentVerified !== null ||
    record.grainlineVerified;

  if (!hasAnyPhysicalData) {
    return {
      toileBlockKey: record.toileBlockKey,
      status: 'PENDING',
      completedPomCount: 0,
      requiredPomCount,
      maxPomConcordanceErrorCm: null,
      pomToleranceLimitCm: AC09_POM_CONCORDANCE_TOLERANCE_CM,
      pomConcordancePassed: false,
      evaluatedZonesCount: 0,
      agreedZonesCount: 0,
      regionalAgreementPct: null,
      requiredAgreementPct: AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT,
      regionalAgreementPassed: false,
      evidenceCompletedCount: 0,
      requiredEvidenceCount,
      allEvidenceRecorded: false,
      blockingReasons: [
        `Physical toile trial not yet executed for '${record.toileBlockKey}'. Cut, sew, mount on calibrated dress form, and record tape/caliper POM & regional observations.`
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
      `${requiredEvidenceCount - evidenceCompletedCount} photographic/measurement checklist evidence item(s) incomplete.`
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
  if (record.hemLevelPhysicalDeviationCm !== null && record.hemLevelPhysicalDeviationCm > 0.8) {
    blockingReasons.push(
      `Physical hem level deviation ${record.hemLevelPhysicalDeviationCm.toFixed(2)} cm exceeds 0.80 cm threshold.`
    );
  }

  const pomConcordancePassed = allPomsComplete && pomAllWithinTolerance && maxPomConcordanceErrorCm !== null;
  const regionalAgreementPassed =
    allZonesEvaluated &&
    regionalAgreementPct !== null &&
    regionalAgreementPct >= AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT;

  if (allZonesEvaluated && regionalAgreementPct !== null && regionalAgreementPct < AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT) {
    blockingReasons.push(
      `Regional fit-issue agreement ${regionalAgreementPct.toFixed(1)}% is below AC-09 threshold (${AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT}%).`
    );
  }

  const hasFailureCondition =
    (completedPomCount > 0 && !pomAllWithinTolerance) ||
    (allZonesEvaluated && !regionalAgreementPassed) ||
    record.seamAlignmentVerified === false ||
    (record.hemLevelPhysicalDeviationCm !== null && record.hemLevelPhysicalDeviationCm > 0.8);

  const isComplete = allPomsComplete && allZonesEvaluated && hasMetadata && allEvidenceRecorded && record.grainlineVerified && record.seamAlignmentVerified !== null;

  const status = hasFailureCondition
    ? 'FAILED'
    : isComplete && pomConcordancePassed && regionalAgreementPassed
    ? 'PASSED'
    : 'INCOMPLETE';

  const summary =
    status === 'PASSED'
      ? `AC-09 PASSED (${record.toileBlockKey}): max POM delta ${maxPomConcordanceErrorCm?.toFixed(2)} cm <= 0.50 cm; regional agreement ${regionalAgreementPct?.toFixed(1)}% >= 85%.`
      : status === 'FAILED'
      ? `AC-09 FAILED (${record.toileBlockKey}): ${blockingReasons[0] ?? 'Physical concordance criteria violated.'}`
      : `AC-09 INCOMPLETE (${record.toileBlockKey}): ${completedPomCount}/${requiredPomCount} POMs, ${evaluatedZonesCount}/${record.regionalAgreementChecks.length} zones, ${evidenceCompletedCount}/${requiredEvidenceCount} evidence items.`;

  return {
    toileBlockKey: record.toileBlockKey,
    status,
    completedPomCount,
    requiredPomCount,
    maxPomConcordanceErrorCm,
    pomToleranceLimitCm: AC09_POM_CONCORDANCE_TOLERANCE_CM,
    pomConcordancePassed,
    evaluatedZonesCount,
    agreedZonesCount,
    regionalAgreementPct,
    requiredAgreementPct: AC09_REGIONAL_AGREEMENT_THRESHOLD_PCT,
    regionalAgreementPassed,
    evidenceCompletedCount,
    requiredEvidenceCount,
    allEvidenceRecorded,
    blockingReasons,
    summary,
    isProductionReady: false
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
  const pomCheckpoints = record.pomCheckpoints.map(pt => {
    if (pt.pointId !== pointId) return pt;
    if (measuredToileCm === null || !Number.isFinite(measuredToileCm) || measuredToileCm <= 0) {
      return { ...pt, measuredToileCm: null, deltaCm: null, withinTolerance: null };
    }
    const deltaCm = Number((measuredToileCm - pt.nominalCadCm).toFixed(3));
    return {
      ...pt,
      measuredToileCm: Number(measuredToileCm.toFixed(2)),
      deltaCm,
      withinTolerance: Math.abs(deltaCm) <= pt.toleranceCm
    };
  });
  return { ...record, pomCheckpoints };
}
