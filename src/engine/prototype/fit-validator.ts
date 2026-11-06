import {
  DEFAULT_PAIRED_SEAM_TOLERANCE_POLICY,
  FitValidationReport,
  GARMENT_REQUIRED_POINTS_REGISTRY,
  MeasurementPointRecord,
  MeasurementPointSourceType,
  OverallFitStatus,
  PairedSeamTolerancePolicy,
  PhysicalPrototypeRecord
} from './prototype-types';

/**
 * Validates physical prototype empirical evidence against CAD requirements.
 * Reconciles measured garment dimensions with nominal pattern coordinates,
 * identifies seam parity discrepancies, categorizes visual fit defects,
 * and formulates actionable parametric pattern corrections.
 *
 * CRITICAL AUDIT PRINCIPLES (Milestone 04.5.2):
 * - Garment-specific required-measurement registry: non-bodice categories cannot conform without schema.
 * - Missing or unsupported garment category returns 'incomplete' or 'unsupported-validation-scope'.
 * - Checks for duplicate point IDs, missing required points, invalid sources, invalid methods,
 *   missing draft revision, missing fabric revision, and invalid tolerance policies.
 * - Duplicate measurements are rejected and cannot satisfy multiple checkpoints.
 * - Only 'physically-measured' sources satisfy physical validation checkpoints.
 * - An empty measurement array strictly returns 'incomplete'.
 * - Strictly enforces isProductionReady = false invariant.
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

  // 1. Garment-specific required-measurement registry check
  const requiredPointsSchema = prototype.garmentCategory ? GARMENT_REQUIRED_POINTS_REGISTRY[prototype.garmentCategory] : undefined;
  const isUnsupportedScope =
    !prototype.garmentCategory ||
    !requiredPointsSchema ||
    !Array.isArray(requiredPointsSchema) ||
    requiredPointsSchema.length === 0;

  if (isUnsupportedScope) {
    actionableCadCorrections.push(
      `Garment category '${prototype.garmentCategory ?? 'unspecified'}' has no defined required physical validation schema. Validation scope unsupported.`
    );
  }

  // 2. Prototype header & metadata validation
  const hasDraftRevision = Boolean(prototype.patternDraftRevision && prototype.patternDraftRevision.trim() !== '');
  if (!hasDraftRevision) {
    actionableCadCorrections.push(
      'Missing pattern draft revision reference. Physical prototype must link to specific CAD revision.'
    );
  }

  const hasFabricRevision = Boolean(prototype.fabricRevision && prototype.fabricRevision.trim() !== '');
  if (!hasFabricRevision) {
    actionableCadCorrections.push(
      'Missing fabric revision reference. Physical prototype must link to specific fabric lot/revision.'
    );
  }

  const VALID_METHODS = ['caliper', 'measuring-tape', '3d-scan', 'optical-camera'];
  const hasValidMethod = Boolean(prototype.measurementMethod && VALID_METHODS.includes(prototype.measurementMethod));
  if (!hasValidMethod) {
    actionableCadCorrections.push(
      `Invalid or unspecified measurement method '${prototype.measurementMethod}'. Valid methods: caliper, measuring-tape, 3d-scan, optical-camera.`
    );
  }

  const hasValidPolicy = Boolean(
    policy &&
    Number.isFinite(policy.sideSeamToleranceCm) && policy.sideSeamToleranceCm > 0 &&
    Number.isFinite(policy.shoulderSeamToleranceCm) && policy.shoulderSeamToleranceCm > 0
  );
  if (!hasValidPolicy) {
    actionableCadCorrections.push(
      'Invalid paired seam tolerance policy: tolerances must be finite positive numbers.'
    );
  }

  // 3. Guard against empty measurement records
  if (!prototype.measurements || prototype.measurements.length === 0) {
    const requiredPoints = requiredPointsSchema ?? [];
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
      missingRequiredPoints: [...requiredPoints],
      maxAbsoluteDiscrepancyCm: 0,
      meanAbsoluteDiscrepancyCm: 0,
      criticalDefectCount: 0,
      overallFitStatus: isUnsupportedScope ? 'unsupported-validation-scope' : 'incomplete',
      measurements: [],
      observations: prototype.observations ?? [],
      actionableCadCorrections: [
        'Physical prototype contains 0 measurements. Record required caliper measurements.',
        ...actionableCadCorrections
      ],
      summaryMessage: `Physical prototype ${prototype.id} has no recorded physical measurements. Evidence is incomplete.`,
      isSyntheticEvidence: Boolean(prototype.isSyntheticTestFixture),
      isProductionReady: false
    };
  }

  // 4. Pre-count point IDs to identify all duplicate checkpoint records
  const pointIdCounts = new Map<string, number>();
  for (const pt of prototype.measurements) {
    pointIdCounts.set(pt.pointId, (pointIdCounts.get(pt.pointId) ?? 0) + 1);
  }

  const VALID_SOURCES: MeasurementPointSourceType[] = ['physically-measured', 'calculated', 'estimated'];

  const evaluatedPoints: MeasurementPointRecord[] = prototype.measurements.map(pt => {
    // Check duplicate point IDs (any point appearing > 1 time is invalid)
    const isDuplicate = (pointIdCounts.get(pt.pointId) ?? 0) > 1;
    if (isDuplicate) {
      actionableCadCorrections.push(
        `Duplicate measurement point ID detected: '${pt.pointId}'. Checkpoint IDs must be unique.`
      );
    }

    // Validation of numerical sanity
    const isNominalValid = Number.isFinite(pt.nominalCadCm) && pt.nominalCadCm > 0;
    const isMeasuredValid = Number.isFinite(pt.measuredPhysicalCm) && pt.measuredPhysicalCm > 0;
    const isTolValid = Number.isFinite(pt.toleranceCm) && pt.toleranceCm >= 0;

    // Validation of measurement source
    const isSourceValid = Boolean(pt.sourceType && VALID_SOURCES.includes(pt.sourceType));
    if (!isSourceValid) {
      actionableCadCorrections.push(
        `Point '${pt.label}' (${pt.pointId}) has invalid or missing source type '${pt.sourceType}'.`
      );
    }

    if (!isNominalValid || !isMeasuredValid || !isTolValid || !isSourceValid || isDuplicate) {
      invalidCount++;
      if (!isNominalValid || !isMeasuredValid || !isTolValid) {
        actionableCadCorrections.push(
          `Point '${pt.label}' (${pt.pointId}) has invalid non-finite, negative, or zero measurement data.`
        );
      }
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

  // 5. Check for missing required checkpoints according to garment schema
  const missingRequiredPoints: string[] = [];
  const requiredPoints = requiredPointsSchema ?? [];

  for (const reqPt of requiredPoints) {
    // Only unique, physically-measured valid points satisfy physical validation checkpoints
    const matchingPoints = evaluatedPoints.filter(p => p.pointId === reqPt);
    if (
      matchingPoints.length !== 1 ||
      matchingPoints[0].status === 'invalid' ||
      matchingPoints[0].sourceType !== 'physically-measured'
    ) {
      missingRequiredPoints.push(reqPt);
    }
  }

  // 6. Check physical paired seams using explicit configurable tolerance policy
  let pairedSeamFailCount = 0;
  let pairedSeamWarningCount = 0;

  const frontSide = evaluatedPoints.find(p => p.pointId.includes('front-side-seam'));
  const backSide = evaluatedPoints.find(p => p.pointId.includes('back-side-seam'));
  if (frontSide && backSide && frontSide.status !== 'invalid' && backSide.status !== 'invalid') {
    const seamDiff = Math.abs(frontSide.measuredPhysicalCm - backSide.measuredPhysicalCm);
    if (policy && seamDiff > policy.sideSeamToleranceCm) {
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
    if (policy && shoulderDiff > policy.shoulderSeamToleranceCm * 1.5) {
      pairedSeamFailCount++;
      actionableCadCorrections.push(
        `Physical shoulder seam discrepancy exceeds limit: Front shoulder (${frontShoulder.measuredPhysicalCm.toFixed(2)} cm) and Back shoulder (${backShoulder.measuredPhysicalCm.toFixed(2)} cm) differ by ${shoulderDiff.toFixed(2)} cm.`
      );
    } else if (policy && shoulderDiff > policy.shoulderSeamToleranceCm) {
      pairedSeamWarningCount++;
      actionableCadCorrections.push(
        `Physical shoulder seam advisory variance: Front shoulder (${frontShoulder.measuredPhysicalCm.toFixed(2)} cm) and Back shoulder (${backShoulder.measuredPhysicalCm.toFixed(2)} cm) differ by ${shoulderDiff.toFixed(2)} cm (policy limit: ${policy.shoulderSeamToleranceCm.toFixed(2)} cm).`
      );
    }
  }

  // 7. Process Qualitative Fit Observations
  let criticalDefectCount = 0;
  for (const obs of prototype.observations) {
    if (obs.severity === 'critical') {
      criticalDefectCount++;
    }

    if (obs.recommendedCadCorrection && !actionableCadCorrections.includes(obs.recommendedCadCorrection)) {
      actionableCadCorrections.push(`[${obs.location.toUpperCase()}] ${obs.recommendedCadCorrection}`);
    }
  }

  // 8. Strict Status Determination
  let overallFitStatus: OverallFitStatus = 'conforming';

  if (isUnsupportedScope) {
    overallFitStatus = 'unsupported-validation-scope';
  } else if (
    invalidCount > 0 ||
    missingRequiredPoints.length > 0 ||
    !hasDraftRevision ||
    !hasFabricRevision ||
    !hasValidMethod ||
    !hasValidPolicy
  ) {
    overallFitStatus = 'incomplete';
    if (missingRequiredPoints.length > 0) {
      actionableCadCorrections.push(
        `Evidence incomplete: ${missingRequiredPoints.length} required measurement point(s) missing, invalid, or unmeasured physically.`
      );
    }
  } else if (failCount > 0 || criticalDefectCount > 0 || pairedSeamFailCount > 0) {
    overallFitStatus = 'non-conforming';
  } else if (warningCount > 0 || prototype.observations.some(o => o.severity === 'moderate') || pairedSeamWarningCount > 0) {
    overallFitStatus = 'acceptable-with-adjustments';
  }

  const summaryMessage = overallFitStatus === 'unsupported-validation-scope'
    ? `Physical prototype ${prototype.id} has category '${prototype.garmentCategory}' with no required point schema in registry. Validation scope unsupported.`
    : overallFitStatus === 'incomplete'
    ? `Physical prototype ${prototype.id} has incomplete physical evidence (${missingRequiredPoints.length} missing required points, ${invalidCount} invalid values). Cannot certify fit.`
    : overallFitStatus === 'conforming'
    ? `Physical prototype ${prototype.id} conforms to CAD dimensions within ±${maxAbsDiscrepancy.toFixed(2)} cm tolerance. All required checkpoints verified physically.`
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
