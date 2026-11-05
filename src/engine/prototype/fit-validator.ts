/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FitValidationReport,
  MeasurementPointRecord,
  OverallFitStatus,
  PhysicalPrototypeRecord
} from './prototype-types';

/**
 * Validates physical prototype empirical evidence against CAD requirements.
 * Reconciles measured garment dimensions with nominal pattern coordinates,
 * identifies seam parity discrepancies, categorizes visual fit defects,
 * and formulates actionable parametric pattern corrections.
 */
export function validatePhysicalFit(prototype: PhysicalPrototypeRecord): FitValidationReport {
  const timestamp = new Date().toISOString();
  const actionableCadCorrections: string[] = [];

  let passCount = 0;
  let warningCount = 0;
  let failCount = 0;
  let sumAbsDiscrepancy = 0;
  let maxAbsDiscrepancy = 0;

  // 1. Evaluate measurement points
  const evaluatedPoints: MeasurementPointRecord[] = prototype.measurements.map(pt => {
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
  const meanAbsDiscrepancy = evaluatedPointsCount > 0
    ? Number((sumAbsDiscrepancy / evaluatedPointsCount).toFixed(3))
    : 0;

  // 2. Check physical paired seams (side seams, shoulder seams, inseams)
  const frontSide = evaluatedPoints.find(p => p.pointId.includes('front-side-seam'));
  const backSide = evaluatedPoints.find(p => p.pointId.includes('back-side-seam'));
  if (frontSide && backSide) {
    const seamDiff = Math.abs(frontSide.measuredPhysicalCm - backSide.measuredPhysicalCm);
    if (seamDiff > 0.30) {
      failCount++;
      actionableCadCorrections.push(
        `Physical side seam mismatch: Front side seam (${frontSide.measuredPhysicalCm.toFixed(2)} cm) and Back side seam (${backSide.measuredPhysicalCm.toFixed(2)} cm) differ by ${seamDiff.toFixed(2)} cm on sewn sample.`
      );
    }
  }

  const frontShoulder = evaluatedPoints.find(p => p.pointId.includes('front-shoulder'));
  const backShoulder = evaluatedPoints.find(p => p.pointId.includes('back-shoulder'));
  if (frontShoulder && backShoulder) {
    const shoulderDiff = Math.abs(frontShoulder.measuredPhysicalCm - backShoulder.measuredPhysicalCm);
    if (shoulderDiff > 0.25) {
      warningCount++;
      actionableCadCorrections.push(
        `Physical shoulder seam discrepancy: Front shoulder (${frontShoulder.measuredPhysicalCm.toFixed(2)} cm) and Back shoulder (${backShoulder.measuredPhysicalCm.toFixed(2)} cm) differ by ${shoulderDiff.toFixed(2)} cm.`
      );
    }
  }

  // 3. Process Qualitative Fit Observations
  let criticalDefectCount = 0;
  for (const obs of prototype.observations) {
    if (obs.severity === 'critical') {
      criticalDefectCount++;
    }

    if (obs.recommendedCadCorrection && !actionableCadCorrections.includes(obs.recommendedCadCorrection)) {
      actionableCadCorrections.push(`[${obs.location.toUpperCase()}] ${obs.recommendedCadCorrection}`);
    }
  }

  // 4. Overall Fit Status Decision
  let overallFitStatus: OverallFitStatus = 'conforming';
  if (failCount > 0 || criticalDefectCount > 0) {
    overallFitStatus = 'non-conforming';
  } else if (warningCount > 0 || prototype.observations.some(o => o.severity === 'moderate')) {
    overallFitStatus = 'acceptable-with-adjustments';
  }

  const summaryMessage = overallFitStatus === 'conforming'
    ? `Physical prototype ${prototype.id} conforms to CAD dimensions within ±${(maxAbsDiscrepancy).toFixed(2)} cm tolerance. No critical fit anomalies observed.`
    : overallFitStatus === 'acceptable-with-adjustments'
    ? `Physical prototype ${prototype.id} has ${warningCount} advisory dimensional variance(s). Recommend applying minor CAD corrections before grading scale-up.`
    : `Physical prototype ${prototype.id} failed physical fit criteria (${failCount} out-of-tolerance points, ${criticalDefectCount} critical defects). CAD pattern adjustment required.`;

  return {
    prototypeId: prototype.id,
    timestamp,
    sizeCode: prototype.sizeCode,
    fabricName: prototype.fabricName,
    evaluatedPointsCount,
    passCount,
    warningCount,
    failCount,
    maxAbsoluteDiscrepancyCm: maxAbsDiscrepancy,
    meanAbsoluteDiscrepancyCm: meanAbsDiscrepancy,
    criticalDefectCount,
    overallFitStatus,
    measurements: evaluatedPoints,
    observations: prototype.observations,
    actionableCadCorrections,
    summaryMessage,
    isProductionReady: false // Strict safety constraint
  };
}
