/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AssemblyValidationStatus,
  BodiceSleeveAssemblyResult,
  EaseCompatibilityMetrics
} from '../assembly/assembly-types';
import { assembleBodiceSleeve } from '../assembly/bodice-sleeve-assembly';
import {
  CrossSizeCheck,
  CrossSizeComparisonRow,
  CrossSizeIntegrityReport,
  GradedPieceMetrics,
  GradedSizeResult,
  GradingOptions
} from './grading-types';

/**
 * Standard unassessed conditions for cross-size grading.
 */
export const UNASSESSED_GRADING_CONDITIONS: string[] = [
  'Three-dimensional cloth drape simulation under varying fabric shear moduli across size extremes',
  'Automated industrial nest nesting efficiency and marker optimization',
  'Interlining and fused support shrinkage compensation across non-linear size steps'
];

/**
 * Helper to check whether a sequence of numbers is monotonically non-decreasing.
 */
function isMonotonicallyIncreasing(values: (number | null)[]): boolean {
  const numeric = values.filter((v): v is number => v !== null && !isNaN(v));
  if (numeric.length <= 1) return true;
  for (let i = 1; i < numeric.length; i++) {
    if (numeric[i] < numeric[i - 1] - 1e-4) {
      return false;
    }
  }
  return true;
}

/**
 * Evaluates cross-size integrity across an ordered set of graded sizes.
 * Validates monotonicity of key anatomical and pattern measurements,
 * ensures seam length continuity, confirms cap ease stability,
 * and compiles the comprehensive CrossSizeIntegrityReport.
 */
export function validateCrossSizeIntegrity(
  sizeResults: Record<string, GradedSizeResult>,
  orderedSizes: string[],
  baseSize: string,
  options?: GradingOptions
): CrossSizeIntegrityReport {
  const checks: CrossSizeCheck[] = [];
  const comparisonTable: CrossSizeComparisonRow[] = [];

  const isCustom = Boolean(
    options?.isCustomDataset ??
    (options?.gradingContext === 'custom-table' || options?.gradingContext === 'individual-custom' || Boolean(options?.customMeasurements))
  );

  let validCount = 0;
  let failedCount = 0;
  let unassessedCount = 0;

  for (const sz of orderedSizes) {
    const res = sizeResults[sz];
    if (!res) {
      unassessedCount++;
      continue;
    }
    if (res.status === 'verified-valid' && res.isValid) {
      validCount++;
    } else if (res.status === 'unassessed-missing-data') {
      unassessedCount++;
    } else {
      failedCount++;
    }
  }

  // Helper to add a row to comparisonTable and record monotonicity check
  const addMetricRow = (
    metricId: string,
    label: string,
    unit: string,
    category: CrossSizeComparisonRow['category'],
    extractor: (r: GradedSizeResult) => number | null
  ) => {
    const valuesPerSize: Record<string, number | null> = {};
    const seq: (number | null)[] = [];

    for (const sz of orderedSizes) {
      const res = sizeResults[sz];
      const val = res ? extractor(res) : null;
      valuesPerSize[sz] = val;
      seq.push(val);
    }

    const isMono = isMonotonicallyIncreasing(seq);
    let varianceNote: string | undefined;

    if (!isMono) {
      varianceNote = isCustom
        ? 'Non-monotonic progression detected in custom dataset (advisory warning).'
        : 'Non-monotonic progression detected across standard size progression.';
      checks.push({
        id: `check-mono-${metricId}`,
        name: `Monotonicity: ${label}`,
        category: category === 'measurement' ? 'measurement' : 'geometry',
        status: isCustom ? 'warning' : 'fail',
        affectedSizes: orderedSizes,
        message: isCustom
          ? `Custom dataset has non-monotonic progression for ${label} across [${orderedSizes.join(' -> ')}]. Handled as advisory warning without failing geometric validity.`
          : `${label} does not increase monotonically across size range [${orderedSizes.join(' -> ')}].`,
        expectedBehavior: isCustom
          ? 'Custom datasets should provide advisory feedback when body dimensions decrease between sequential size codes.'
          : 'Each progressive size must have greater or equal dimension.',
        observedValues: valuesPerSize as Record<string, number>
      });
    }

    comparisonTable.push({
      metricId,
      label,
      unit,
      category,
      valuesPerSize,
      isMonotonic: isMono,
      varianceNote
    });
  };

  // 1. Measurement comparisons
  addMetricRow('bust', 'Bust Circumference', 'cm', 'measurement', r => r.measurements.bust ?? null);
  addMetricRow('waist', 'Waist Circumference', 'cm', 'measurement', r => r.measurements.waist ?? null);
  addMetricRow('lowHip', 'Low Hip Circumference', 'cm', 'measurement', r => r.measurements.lowHip ?? null);
  addMetricRow('bicepsCircumference', 'Biceps Circumference', 'cm', 'measurement', r => r.measurements.bicepsCircumference ?? null);
  addMetricRow('shoulderLength', 'Shoulder Seam Length', 'cm', 'measurement', r => r.measurements.shoulderLength ?? null);
  addMetricRow('sleeveLength', 'Sleeve Length', 'cm', 'measurement', r => r.measurements.sleeveLength ?? null);

  // 2. Pattern piece dimensions
  addMetricRow('frontBodiceWidth', 'Front Bodice Width', 'cm', 'pattern-dimension', r => {
    const f = r.bodicePieces.find(p => p.pieceCode.includes('BOD-F') || p.id.includes('front'));
    return f?.boundingBox ? f.boundingBox.widthCm : null;
  });
  addMetricRow('backBodiceWidth', 'Back Bodice Width', 'cm', 'pattern-dimension', r => {
    const b = r.bodicePieces.find(p => p.pieceCode.includes('BOD-B') || p.id.includes('back'));
    return b?.boundingBox ? b.boundingBox.widthCm : null;
  });
  addMetricRow('sleeveWidth', 'Sleeve Girth (Biceps)', 'cm', 'pattern-dimension', r => {
    return r.sleevePiece?.boundingBox ? r.sleevePiece.boundingBox.widthCm : null;
  });

  // 3. Seam length comparisons
  addMetricRow('frontArmholeLength', 'Front Armhole Seam', 'cm', 'seam-length', r => {
    return r.assemblyResult?.ease.frontBodiceArmholeLengthCm ?? null;
  });
  addMetricRow('backArmholeLength', 'Back Armhole Seam', 'cm', 'seam-length', r => {
    return r.assemblyResult?.ease.backBodiceArmholeLengthCm ?? null;
  });
  addMetricRow('totalArmholeLength', 'Total Armhole Seam', 'cm', 'seam-length', r => {
    return r.assemblyResult?.ease.totalBodiceArmholeLengthCm ?? null;
  });
  addMetricRow('frontCapLength', 'Front Sleeve Cap', 'cm', 'seam-length', r => {
    return r.assemblyResult?.ease.frontSleeveCapLengthCm ?? null;
  });
  addMetricRow('backCapLength', 'Back Sleeve Cap', 'cm', 'seam-length', r => {
    return r.assemblyResult?.ease.backSleeveCapLengthCm ?? null;
  });
  addMetricRow('totalCapLength', 'Total Sleeve Cap', 'cm', 'seam-length', r => {
    return r.assemblyResult?.ease.totalSleeveCapLengthCm ?? null;
  });

  // 4. Cap ease preservation
  for (const sz of orderedSizes) {
    const res = sizeResults[sz];
    if (!res || !res.assemblyResult) continue;

    const ease = res.assemblyResult.ease;
    if (ease.frontEaseCm < 0 || (res.assemblyResult.seamCompatibility && !res.assemblyResult.seamCompatibility.front.isNonNegative)) {
      checks.push({
        id: `check-ease-front-neg-${sz}`,
        name: `Front Cap Ease Negative (${sz})`,
        category: 'assembly',
        status: 'fail',
        affectedSizes: [sz],
        message: `Size ${sz} has negative front sleeve cap ease (${ease.frontEaseCm.toFixed(2)} cm).`,
        expectedBehavior: 'Front ease must be strictly >= 0.0 cm.'
      });
    }

    if (ease.backEaseCm < 0 || (res.assemblyResult.seamCompatibility && !res.assemblyResult.seamCompatibility.back.isNonNegative)) {
      checks.push({
        id: `check-ease-back-neg-${sz}`,
        name: `Back Cap Ease Negative (${sz})`,
        category: 'assembly',
        status: 'fail',
        affectedSizes: [sz],
        message: `Size ${sz} has negative back sleeve cap ease (${ease.backEaseCm.toFixed(2)} cm).`,
        expectedBehavior: 'Back ease must be strictly >= 0.0 cm.'
      });
    }

    if (ease.totalEaseCm > 5.0 || !ease.isTotalEasePermitted) {
      checks.push({
        id: `check-ease-total-excess-${sz}`,
        name: `Excessive Cap Ease (${sz})`,
        category: 'assembly',
        status: 'fail',
        affectedSizes: [sz],
        message: `Size ${sz} has excessive total sleeve cap ease (${ease.totalEaseCm.toFixed(2)} cm > 5.0 cm).`,
        expectedBehavior: 'Total cap ease must not exceed 5.0 cm.'
      });
    }

    // M04.3 Uncertainty Gate & Contour Integrity per-size checks
    const strictGate = options?.strictUncertaintyGate ?? true;
    if (strictGate && res.assemblyResult.uncertaintyGate && !res.assemblyResult.uncertaintyGate.passed) {
      checks.push({
        id: `check-uncertainty-gate-${sz}`,
        name: `Uncertainty Gate (${sz})`,
        category: 'assembly',
        status: 'fail',
        affectedSizes: [sz],
        message: `Size ${sz} failed strict numerical uncertainty gate: ${res.assemblyResult.uncertaintyGate.blockingReasons.join('; ')}`,
        expectedBehavior: 'All seam arc-length uncertainties must be <= 0.05 cm with unambiguous confidence intervals.'
      });
    }

    if (res.assemblyResult.contourIntegrity && !res.assemblyResult.contourIntegrity.isValid) {
      checks.push({
        id: `check-contour-integrity-${sz}`,
        name: `Contour Integrity (${sz})`,
        category: 'geometry',
        status: 'fail',
        affectedSizes: [sz],
        message: `Size ${sz} contour integrity violation: ${res.assemblyResult.contourIntegrity.errors.join('; ')}`,
        expectedBehavior: 'All contours must be closed, non-self-intersecting, non-collinear, with valid grainlines.'
      });
    }

    if (options?.requireApprovedGovernance && res.assemblyResult.governance && !res.assemblyResult.governance.isGovernanceApproved) {
      checks.push({
        id: `check-governance-${sz}`,
        name: `Governance & Provenance Approval (${sz})`,
        category: 'assembly',
        status: 'fail',
        affectedSizes: [sz],
        message: `Size ${sz} governance blocked: ${res.assemblyResult.governance.blockingReasons.join('; ')}`,
        expectedBehavior: 'Approved design specification and approvable physically-verified measurements required.'
      });
    }
  }

  // 5. Notch correspondence, pre-sort ordering, displacement, and elbow parity checks across sizes
  for (const sz of orderedSizes) {
    const res = sizeResults[sz];
    if (!res || !res.assemblyResult) continue;

    const notches = res.assemblyResult.notches;
    if (notches.frontNotch) {
      const fn = notches.frontNotch;
      if (fn.sleeveDisplacementCm > 0.30 || fn.bodiceDisplacementCm > 0.30) {
        checks.push({
          id: `check-notch-disp-${sz}-front`,
          name: `Front Notch Displacement Tolerance (${sz})`,
          category: 'notch',
          status: 'fail',
          affectedSizes: [sz],
          message: `Size ${sz} front notch displacement exceeds 0.30 cm manufacturing tolerance (sleeve: ${fn.sleeveDisplacementCm.toFixed(2)} cm, bodice: ${fn.bodiceDisplacementCm.toFixed(2)} cm).`,
          expectedBehavior: 'Displacement along seam must be <= 0.30 cm.'
        });
      }
    }
    if (notches.backNotches) {
      const bn = notches.backNotches;
      const maxDisp = Math.max(bn.sleeveDisplacement1Cm, bn.bodiceDisplacement1Cm, bn.sleeveDisplacement2Cm, bn.bodiceDisplacement2Cm);
      if (maxDisp > 0.30) {
        checks.push({
          id: `check-notch-disp-${sz}-back`,
          name: `Back Notches Displacement Tolerance (${sz})`,
          category: 'notch',
          status: 'fail',
          affectedSizes: [sz],
          message: `Size ${sz} back notch displacement (${maxDisp.toFixed(2)} cm) exceeds 0.30 cm manufacturing tolerance.`,
          expectedBehavior: 'Displacement along seam must be <= 0.30 cm.'
        });
      }
      if (bn.preSortSleeveOrderValid === false || bn.preSortBodiceOrderValid === false) {
        checks.push({
          id: `check-back-notch-order-${sz}`,
          name: `Back Double-Notch Pre-Sort Order (${sz})`,
          category: 'notch',
          status: 'fail',
          affectedSizes: [sz],
          message: `Size ${sz} back double-notch declared ordering (-1 before -2) is reversed prior to sorting.`,
          expectedBehavior: 'Notch -1 must sit closer to underarm than notch -2 before sorting.'
        });
      }
    }
    if (notches.elbowPairParity && !notches.elbowPairParity.isParityValid) {
      checks.push({
        id: `check-elbow-parity-${sz}`,
        name: `Elbow Inseam Pair Parity (${sz})`,
        category: 'notch',
        status: 'fail',
        affectedSizes: [sz],
        message: `Size ${sz} elbow notch arc parity (${notches.elbowPairParity.parityDeltaCm.toFixed(3)} cm) exceeds ${notches.elbowPairParity.toleranceCm} cm tolerance.`,
        expectedBehavior: 'Front and back elbow inseam notch positions must align within 0.15 cm.'
      });
    }
  }

  // 6. Dart parity checks
  for (const sz of orderedSizes) {
    const res = sizeResults[sz];
    if (!res) continue;

    for (const dart of res.darts) {
      const leftDist = Math.hypot(dart.legLeft.x - dart.apex.x, dart.legLeft.y - dart.apex.y);
      const rightDist = Math.hypot(dart.legRight.x - dart.apex.x, dart.legRight.y - dart.apex.y);
      if (Math.abs(leftDist - rightDist) > 0.05) {
        checks.push({
          id: `check-dart-parity-${sz}-${dart.id}`,
          name: `Dart Leg Parity (${sz})`,
          category: 'dart',
          status: 'fail',
          affectedSizes: [sz],
          message: `Size ${sz} dart '${dart.id}' violates leg length parity by ${(Math.abs(leftDist - rightDist)).toFixed(3)} cm.`,
          expectedBehavior: 'Left and right dart legs must be equal within 0.05 cm.'
        });
      }
    }
  }

  const hasFailingChecks = checks.some(c => c.status === 'fail');
  const isOverallGradingValid = !hasFailingChecks && failedCount === 0 && validCount > 0;

  const measurementProvenance = options?.measurementProvenance ?? 'unknown';
  const measurementApprovalState = options?.measurementApprovalState ?? 'unverified';
  const requireApprovedGovernance = Boolean(options?.requireApprovedGovernance);
  const isAllGovernanceApproved = orderedSizes.every(sz => {
    const res = sizeResults[sz];
    return Boolean(res?.assemblyResult?.governance?.isGovernanceApproved);
  });

  const summaryMessage = isOverallGradingValid
    ? `All ${validCount} generated sizes successfully graded with strict monotonic continuity, cap ease compatibility, and valid notch correspondence.`
    : `Cross-size grading integrity check flagged ${checks.filter(c => c.status === 'fail').length} issues across ${failedCount} failing sizes.`;

  return {
    timestamp: new Date().toISOString(),
    baseSize,
    evaluatedSizes: orderedSizes,
    validSizeCount: validCount,
    failedSizeCount: failedCount,
    unassessedSizeCount: unassessedCount,
    isOverallGradingValid,
    checks,
    comparisonTable,
    summaryMessage,
    unassessedConditions: UNASSESSED_GRADING_CONDITIONS,
    gradingContext: options?.gradingContext ?? (isCustom ? 'custom-table' : 'standard-chart'),
    isCustomDataset: isCustom,
    governanceStatus: {
      measurementProvenance,
      measurementApprovalState,
      requireApprovedGovernance,
      isAllGovernanceApproved
    }
  };
}
