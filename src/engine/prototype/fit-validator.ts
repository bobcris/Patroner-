import {
  DEFAULT_PAIRED_SEAM_TOLERANCE_POLICY,
  FitValidationReport,
  MeasurementPointRecord,
  OverallFitStatus,
  PairedSeamTolerancePolicy,
  PhysicalPrototypeRecord
} from './prototype-types';

const REQUIRED_BODICE_POINTS = [
  'bust-circumference',
  'waist-circumference',
  'front-side-seam',
  'back-side-seam',
  'front-shoulder',
  'back-shoulder'
];

/**
 * Validates physical prototype empirical evidence against CAD requirements.
 * Reconciles measured garment dimensions with nominal pattern coordinates,
 * identifies seam parity discrepancies, categorizes visual fit defects,
 * and formulates actionable parametric pattern corrections.
 *
 * CRITICAL AUDIT PRINCIPLES (Milestone 04.5.1):
 * - An empty measurement array must NEVER return 'conforming' -> returns 'incomplete'.
 * - Missing required measurements or non-finite/negative dimensions return 'incomplete'.
 * - Paired seam checks use configurable tolerance policies rather than hardcoded magic numbers.
 * - Enforces isProductionReady = false invariant strictly.
 */
export function validatePhysicalFit(
  prototype: PhysicalPrototypeRecord,
  policy: PairedSeamTolerancePolicy = DEFAULT_PAIRED_SEAM_TOLERANCE_POLICY
): FitValidationReport {
  const timestamp = new Date().toISOString();
  const actionableCadCorrections: string[] = [];

  let passCount = 0;
  let warningCount = 0;
  let failCount = 0;
  let invalidCount = 0;
  let sumAbsDiscrepancy = 0;
  let maxAbsDiscrepancy = 0;

  // 1. Guard against empty measurement records
  if (!prototype.measurements || prototype.measurements.length === 0) {
    return {
      prototypeId: prototype.id,
      timestamp,
      sizeCode: prototype.sizeCode,
      fabricName: prototype.fabricName,
      evaluatedPointsCount: 0,
      passCount: 0,
      warningCount: 0,
      failCount: 0,
      invalidCount: 0,
      missingRequiredPoints: prototype.garmentCategory === 'bodice' ? [...REQUIRED_BODICE_POINTS] : [],
      maxAbsoluteDiscrepancyCm: 0,
      meanAbsoluteDiscrepancyCm: 0,
      criticalDefectCount: 0,
      overallFitStatus: 'incomplete',
      measurements: [],
      observations: prototype.observations ?? [],
      actionableCadCorrections: ['Physical prototype contains 0 measurements. Record required caliper measurements.'],
      summaryMessage: `Physical prototype ${prototype.id} has no recorded physical measurements. Evidence is incomplete.`,
      isSyntheticEvidence: Boolean(prototype.isSyntheticTestFixture),
      isProductionReady: false
    };
  }

  // 2. Evaluate individual measurement points and validate finite positive numbers
  const evaluatedPoints: MeasurementPointRecord[] = prototype.measurements.map(pt => {
    // Validation of numerical sanity
    const isNominalValid = Number.isFinite(pt.nominalCadCm) && pt.nominalCadCm > 0;
    const isMeasuredValid = Number.isFinite(pt.measuredPhysicalCm) && pt.measuredPhysicalCm > 0;
    const isTolValid = Number.isFinite(pt.toleranceCm) && pt.toleranceCm >= 0;

    if (!isNominalValid || !isMeasuredValid || !isTolValid) {
      invalidCount++;
      actionableCadCorrections.push(
        `Point '${pt.label}' (${pt.pointId}) has invalid non-finite, negative, or zero measurement data.`
      );
      return {
        ...pt,
        deltaCm: 0,
        status: 'invalid'
      };
    }

    const delta = Number((pt.measuredPhysicalCm - pt.nominalCadCm).toFixed(2));
    const absDelta = Math.abs(delta);
    sumAbsDiscrepancy += absDelta;
    if (absDelta > maxAbsDiscrepancy) {
      maxAbsDiscrepancy = absDelta;
    }

    let status: MeasurementPointRecord['status'] = 'pass';
    const tol = pt.toleranceCm ?? 0.20;

    if (absDelta <= tol) {
      status = 'pass';
      passCount++;
    } else if (absDelta <= tol * 1.5) {
      status = 'warning';
      warningCount++;
      actionableCadCorrections.push(
        `Point '${pt.label}' (${pt.pointId}) has minor discrepancy of ${delta > 0 ? '+' : ''}${delta.toFixed(2)} cm (tolerance: ±${tol.toFixed(2)} cm). Fine-tune CAD seamline.`
      );
    } else {
      status = 'fail';
      failCount++;
      actionableCadCorrections.push(
        `Point '${pt.label}' (${pt.pointId}) exceeds manufacturing tolerance: delta=${delta > 0 ? '+' : ''}${delta.toFixed(2)} cm > ±${tol.toFixed(2)} cm tolerance. CAD pattern revision required.`
      );
    }

    return {
      ...pt,
      deltaCm: delta,
      status
    };
  });

  const evaluatedPointsCount = evaluatedPoints.length;
  const validEvaluatedCount = evaluatedPointsCount - invalidCount;
  const meanAbsDiscrepancy = validEvaluatedCount > 0
    ? Number((sumAbsDiscrepancy / validEvaluatedCount).toFixed(3))
    : 0;

  // 3. Check for missing required measurements (for bodice)
  const missingRequiredPoints: string[] = [];
  if (prototype.garmentCategory === 'bodice') {
    for (const reqPt of REQUIRED_BODICE_POINTS) {
      const exists = evaluatedPoints.some(p => p.pointId === reqPt && p.status !== 'invalid');
      if (!exists) {
        missingRequiredPoints.push(reqPt);
      }
    }
  }

  // 4. Check physical paired seams using explicit configurable tolerance policy
  let pairedSeamFailCount = 0;
  let pairedSeamWarningCount = 0;

  const frontSide = evaluatedPoints.find(p => p.pointId.includes('front-side-seam'));
  const backSide = evaluatedPoints.find(p => p.pointId.includes('back-side-seam'));
  if (frontSide && backSide && frontSide.status !== 'invalid' && backSide.status !== 'invalid') {
    const seamDiff = Math.abs(frontSide.measuredPhysicalCm - backSide.measuredPhysicalCm);
    if (seamDiff > policy.sideSeamToleranceCm) {
      pairedSeamFailCount++;
      actionableCadCorrections.push(
        `Physical side seam mismatch: Front side seam (${frontSide.measuredPhysicalCm.toFixed(2)} cm) and Back side seam (${backSide.measuredPhysicalCm.toFixed(2)} cm) differ by ${seamDiff.toFixed(2)} cm on sewn sample (policy limit: ${policy.sideSeamToleranceCm.toFixed(2)} cm).`
      );
    }
  }

  const frontShoulder = evaluatedPoints.find(p => p.pointId.includes('front-shoulder'));
  const backShoulder = evaluatedPoints.find(p => p.pointId.includes('back-shoulder'));
  if (frontShoulder && backShoulder && frontShoulder.status !== 'invalid' && backShoulder.status !== 'invalid') {
    const shoulderDiff = Math.abs(frontShoulder.measuredPhysicalCm - backShoulder.measuredPhysicalCm);
    if (shoulderDiff > policy.shoulderSeamToleranceCm * 1.5) {
      pairedSeamFailCount++;
      actionableCadCorrections.push(
        `Physical shoulder seam discrepancy exceeds limit: Front shoulder (${frontShoulder.measuredPhysicalCm.toFixed(2)} cm) and Back shoulder (${backShoulder.measuredPhysicalCm.toFixed(2)} cm) differ by ${shoulderDiff.toFixed(2)} cm.`
      );
    } else if (shoulderDiff > policy.shoulderSeamToleranceCm) {
      pairedSeamWarningCount++;
      actionableCadCorrections.push(
        `Physical shoulder seam advisory variance: Front shoulder (${frontShoulder.measuredPhysicalCm.toFixed(2)} cm) and Back shoulder (${backShoulder.measuredPhysicalCm.toFixed(2)} cm) differ by ${shoulderDiff.toFixed(2)} cm (policy limit: ${policy.shoulderSeamToleranceCm.toFixed(2)} cm).`
      );
    }
  }

  // 5. Process Qualitative Fit Observations
  let criticalDefectCount = 0;
  for (const obs of prototype.observations) {
    if (obs.severity === 'critical') {
      criticalDefectCount++;
    }

    if (obs.recommendedCadCorrection && !actionableCadCorrections.includes(obs.recommendedCadCorrection)) {
      actionableCadCorrections.push(`[${obs.location.toUpperCase()}] ${obs.recommendedCadCorrection}`);
    }
  }

  // 6. Strict Status Determination
  let overallFitStatus: OverallFitStatus = 'conforming';

  if (invalidCount > 0 || missingRequiredPoints.length > 0) {
    overallFitStatus = 'incomplete';
    actionableCadCorrections.push(
      `Evidence incomplete: ${missingRequiredPoints.length} required measurement point(s) missing or invalid.`
    );
  } else if (failCount > 0 || criticalDefectCount > 0 || pairedSeamFailCount > 0) {
    overallFitStatus = 'non-conforming';
  } else if (warningCount > 0 || prototype.observations.some(o => o.severity === 'moderate') || pairedSeamWarningCount > 0) {
    overallFitStatus = 'acceptable-with-adjustments';
  }

  const summaryMessage = overallFitStatus === 'incomplete'
    ? `Physical prototype ${prototype.id} has incomplete physical evidence (${missingRequiredPoints.length} missing required points, ${invalidCount} invalid values). Cannot certify fit.`
    : overallFitStatus === 'conforming'
    ? `Physical prototype ${prototype.id} conforms to CAD dimensions within ±${(maxAbsDiscrepancy).toFixed(2)} cm tolerance. No critical fit anomalies observed.`
    : overallFitStatus === 'acceptable-with-adjustments'
    ? `Physical prototype ${prototype.id} has ${warningCount + pairedSeamWarningCount} advisory dimensional variance(s). Recommend applying minor CAD corrections before grading scale-up.`
    : `Physical prototype ${prototype.id} failed physical fit criteria (${failCount + pairedSeamFailCount} out-of-tolerance issues, ${criticalDefectCount} critical defects). CAD pattern adjustment required.`;

  return {
    prototypeId: prototype.id,
    timestamp,
    sizeCode: prototype.sizeCode,
    fabricName: prototype.fabricName,
    evaluatedPointsCount,
    passCount,
    warningCount,
    failCount,
    invalidCount,
    missingRequiredPoints,
    maxAbsoluteDiscrepancyCm: maxAbsDiscrepancy,
    meanAbsoluteDiscrepancyCm: meanAbsDiscrepancy,
    criticalDefectCount,
    overallFitStatus,
    measurements: evaluatedPoints,
    observations: prototype.observations,
    actionableCadCorrections,
    summaryMessage,
    isSyntheticEvidence: Boolean(prototype.isSyntheticTestFixture),
    isProductionReady: false // Strict safety constraint
  };
}

