/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Notch,
  PatternPiece,
  Point,
  SeamLine,
  SleeveEaseStrategy,
  ValidationCheck,
  ValidationReport
} from '../../types';
import {
  distance,
  normalizeAngleDeg,
  smallestAngularDifferenceDeg
} from '../geometry/math';
import { validateContourIntegrity } from '../geometry/contour-validator';
import { CubicBezierCurve, LineSegment } from '../geometry/primitives';
import { SLEEVE_EASE_TABLE } from '../measurements/standards';
import {
  getArcLengthProjectionDiagnostics
} from '../drafting/sleeve-block';
import { NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS } from '../production/pattern-revision-snapshot';
import type { MeasurementApprovalStatus, MeasurementOrigin } from '../production/production-types';
import {
  AssemblyConfigValidationResult,
  AssemblyContourIntegrityResult,
  AssemblyGovernanceResult,
  AssemblyNotchCorrespondenceResult,
  AssemblyOptions,
  AssemblyValidationStatus,
  BackNotchPairing,
  BodiceSleeveAssemblyInput,
  CrownNotchCheck,
  EaseCompatibilityMetrics,
  ElbowNotchCheck,
  ElbowPairParityCheck,
  FrontNotchPairing,
  IndividualSeamCompatibility,
  SeamArcLengthMeasurement,
  SeamCompatibilityBreakdown,
  SeamEndpointMatch,
  SeamEndpointOrientationResult,
  ShoulderSeamConsistencyResult,
  SleeveHandednessResult,
  UncertaintyGateResult
} from './assembly-types';

const VALID_STRATEGIES: ReadonlySet<SleeveEaseStrategy> = new Set([
  'tailored',
  'classic',
  'fitted',
  'flat'
]);

export const DEFAULT_MAX_TOTAL_EASE_CM = 5.0;
export const MAX_SINGLE_SEAM_UNCERTAINTY_CM = 0.05;
export const ELBOW_CONTOUR_TOLERANCE_CM = 0.05;
export const ELBOW_PAIR_PARITY_TOLERANCE_CM = 0.15;

export function formatSignedCm(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return 'NaN cm';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)} cm`;
}

export const UNASSESSED_ASSEMBLY_CONDITIONS = [
  {
    id: 'unassessed-3d-cloth-drape-simulation',
    name: '3D Physical Fabric Drape & Armhole Collision',
    reason: 'Assembly calculations validate 2D boundary compatibility and ease distribution. Physical fabric shear, gravity drape, and shoulder collision dynamics are not evaluated.',
    milestonePrerequisite: 'Milestone 05 (3D Physics & Multi-Material Simulation)'
  },
  {
    id: 'unassessed-wearer-dynamic-reach-strain',
    name: 'Anatomical Range-of-Motion & Dynamic Reach Strain',
    reason: 'Underarm ease and sleeve cap crimp ease are computed for static posture. High arm raise / reach tension on the armhole is not yet modeled.',
    milestonePrerequisite: 'Milestone 05 (Dynamic Biomechanical Fit)'
  },
  {
    id: 'unassessed-steam-moulding-crimping',
    name: 'Industrial Crown Crimping & Steam Iron Shrinkage',
    reason: 'Wool/cotton ease insertion (>3.0 cm) requires steam crimping prior to assembly. Machine-feed differential crimping parameters are not yet generated.',
    milestonePrerequisite: 'Milestone 06 (Industrial Production Automation)'
  }
];

export interface ExtractedAssemblyCurves {
  frontBodicePiece: PatternPiece;
  backBodicePiece: PatternPiece;
  sleevePiece: PatternPiece;
  frontBodiceArmhole: CubicBezierCurve;
  backBodiceArmhole: CubicBezierCurve;
  sleeveFrontCap: CubicBezierCurve;
  sleeveBackCap: CubicBezierCurve;
  sleeveFrontInseam?: LineSegment;
  sleeveBackInseam?: LineSegment;
}

/**
 * Validates and resolves assembly runtime options without dropping numeric zero values.
 */
export function resolveAndValidateAssemblyConfig(
  options?: AssemblyOptions
): AssemblyConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawStrategy = options?.strategy ?? 'classic';
  const resolvedStrategy: SleeveEaseStrategy = VALID_STRATEGIES.has(rawStrategy) ? rawStrategy : 'classic';
  if (!VALID_STRATEGIES.has(rawStrategy)) {
    errors.push(`Unsupported sleeve ease strategy "${String(rawStrategy)}". Expected one of: tailored, classic, fitted, flat.`);
  }

  let resolvedCustomTargetEaseCm: number | undefined = undefined;
  if (options?.customTargetEaseCm !== undefined) {
    if (typeof options.customTargetEaseCm !== 'number' || !Number.isFinite(options.customTargetEaseCm)) {
      errors.push(`Invalid customTargetEaseCm (${String(options.customTargetEaseCm)}): must be a finite number.`);
    } else if (options.customTargetEaseCm < 0 || options.customTargetEaseCm > 5.0) {
      errors.push(`customTargetEaseCm (${options.customTargetEaseCm} cm) outside physically permitted range [0.00, 5.00] cm.`);
      resolvedCustomTargetEaseCm = options.customTargetEaseCm;
    } else {
      resolvedCustomTargetEaseCm = options.customTargetEaseCm;
    }
  }

  const rawTol = options?.bezierToleranceCm ?? 0.005;
  let resolvedBezierToleranceCm = 0.005;
  if (typeof rawTol !== 'number' || !Number.isFinite(rawTol) || rawTol <= 0 || rawTol > 0.5) {
    errors.push(`Invalid bezierToleranceCm (${String(rawTol)}): must be within (0, 0.50] cm.`);
  } else {
    resolvedBezierToleranceCm = rawTol;
  }

  let resolvedSeamAllowanceCm: number | undefined = undefined;
  if (options?.seamAllowanceCm !== undefined) {
    if (typeof options.seamAllowanceCm !== 'number' || !Number.isFinite(options.seamAllowanceCm) || options.seamAllowanceCm < 0 || options.seamAllowanceCm > 5.0) {
      errors.push(`Invalid seamAllowanceCm (${String(options.seamAllowanceCm)}): must be within [0, 5.0] cm.`);
    } else {
      resolvedSeamAllowanceCm = options.seamAllowanceCm;
    }
  }

  const rawMaxEase = options?.maxTotalEaseCm ?? DEFAULT_MAX_TOTAL_EASE_CM;
  let resolvedMaxTotalEaseCm = DEFAULT_MAX_TOTAL_EASE_CM;
  if (typeof rawMaxEase !== 'number' || !Number.isFinite(rawMaxEase) || rawMaxEase < 0 || rawMaxEase > DEFAULT_MAX_TOTAL_EASE_CM) {
    errors.push(`Invalid maxTotalEaseCm (${String(rawMaxEase)}): must be within [0, ${DEFAULT_MAX_TOTAL_EASE_CM}] cm.`);
  } else {
    resolvedMaxTotalEaseCm = rawMaxEase;
  }

  const strictUncertaintyGate = options?.strictUncertaintyGate ?? true;

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    resolvedStrategy,
    resolvedCustomTargetEaseCm,
    resolvedBezierToleranceCm,
    resolvedSeamAllowanceCm,
    resolvedMaxTotalEaseCm,
    strictUncertaintyGate
  };
}

function toLineSegment(seg: any): LineSegment {
  if (seg instanceof LineSegment) return seg;
  const start = seg.start ?? seg.p0 ?? { x: 0, y: 0 };
  const end = seg.end ?? seg.p1 ?? { x: 0, y: 0 };
  return new LineSegment(
    seg.id,
    { x: start.x, y: start.y },
    { x: end.x, y: end.y },
    seg.seamAllowanceCm ?? 1.0,
    seg.isFold ?? seg.isOnFold ?? false,
    seg.seamId,
    seg.sourceSegmentId,
    seg.role
  );
}

function toCubicBezierCurve(seg: any): CubicBezierCurve {
  if (seg instanceof CubicBezierCurve) return seg;
  const p0 = seg.p0 ?? seg.start ?? { x: 0, y: 0 };
  const cp1 = seg.cp1 ?? seg.p1;
  const cp2 = seg.cp2 ?? seg.p2;
  const p3 = seg.p3 ?? seg.end ?? { x: 0, y: 0 };
  return new CubicBezierCurve(
    seg.id,
    { x: p0.x, y: p0.y },
    { x: cp1.x, y: cp1.y },
    { x: cp2.x, y: cp2.y },
    { x: p3.x, y: p3.y },
    seg.seamAllowanceCm ?? 1.0,
    seg.isFold ?? seg.isOnFold ?? false,
    seg.seamId,
    seg.sourceSegmentId,
    seg.role
  );
}

export function extractAssemblyCurves(
  input: BodiceSleeveAssemblyInput
): { extracted?: ExtractedAssemblyCurves; errors: string[]; missingPieces: string[] } {
  const errors: string[] = [];
  const missingPieces: string[] = [];

  const frontBodicePiece = input.bodicePieces?.find(
    p => p.id === 'piece-bodice-front' || p.pieceCode?.startsWith('BOD-F')
  );
  const backBodicePiece = input.bodicePieces?.find(
    p => p.id === 'piece-bodice-back' || p.pieceCode?.startsWith('BOD-B')
  );
  const rawSleeve = input.sleevePiece as any;
  const sleevePiece: PatternPiece | undefined = rawSleeve?.piece ?? (rawSleeve?.id ? rawSleeve : undefined);

  if (!frontBodicePiece) missingPieces.push('Front Bodice Panel (piece-bodice-front)');
  if (!backBodicePiece) missingPieces.push('Back Bodice Panel (piece-bodice-back)');
  if (!sleevePiece) missingPieces.push('Sleeve Piece (piece-sleeve)');

  if (missingPieces.length > 0) {
    return { errors: [`Missing required assembly pieces: ${missingPieces.join(', ')}`], missingPieces };
  }

  const findCurve = (piece: PatternPiece, segmentId: string, seamNameSubstr: string): CubicBezierCurve | null => {
    if (piece.stitchingContour?.segments) {
      const seg = piece.stitchingContour.segments.find(s => s.id === segmentId) as any;
      if (seg instanceof CubicBezierCurve) return seg;
      if (seg && (seg.type === 'bezier' || ((seg.cp1 || seg.p1) && (seg.cp2 || seg.p2)))) {
        return toCubicBezierCurve(seg);
      }
      if (seg) {
        errors.push(`Segment '${segmentId}' in piece '${piece.name}' is of type ${seg.type}, expected CubicBezierCurve.`);
      }
    }
    const seam = piece.seams?.find(s => s.id === segmentId || s.name.includes(seamNameSubstr));
    if (!seam) {
      errors.push(`Missing seam/segment '${segmentId}' in piece '${piece.name}'.`);
    }
    return null;
  };

  const frontBodiceArmhole = findCurve(frontBodicePiece!, 'fb-armhole', 'Armhole');
  const backBodiceArmhole = findCurve(backBodicePiece!, 'bb-armhole', 'Armhole');
  const sleeveFrontCap = findCurve(sleevePiece!, 'sleeve-front-cap', 'Front Sleeve Cap');
  const sleeveBackCap = findCurve(sleevePiece!, 'sleeve-back-cap', 'Back Sleeve Cap');

  let sleeveFrontInseam: LineSegment | undefined;
  let sleeveBackInseam: LineSegment | undefined;
  if (sleevePiece?.stitchingContour?.segments) {
    const fInseam = sleevePiece.stitchingContour.segments.find(s => s.id === 'sleeve-front-inseam') as any;
    if (fInseam && (fInseam instanceof LineSegment || fInseam.type === 'line' || fInseam.type === 'linear')) {
      sleeveFrontInseam = toLineSegment(fInseam);
    }
    const bInseam = sleevePiece.stitchingContour.segments.find(s => s.id === 'sleeve-back-inseam') as any;
    if (bInseam && (bInseam instanceof LineSegment || bInseam.type === 'line' || bInseam.type === 'linear')) {
      sleeveBackInseam = toLineSegment(bInseam);
    }
  }

  if (!frontBodiceArmhole || !backBodiceArmhole || !sleeveFrontCap || !sleeveBackCap) {
    return { errors, missingPieces };
  }

  return {
    extracted: {
      frontBodicePiece: frontBodicePiece!,
      backBodicePiece: backBodicePiece!,
      sleevePiece: sleevePiece!,
      frontBodiceArmhole,
      backBodiceArmhole,
      sleeveFrontCap,
      sleeveBackCap,
      sleeveFrontInseam,
      sleeveBackInseam
    },
    errors,
    missingPieces
  };
}

/**
 * Computes seam arc length with adaptive subdivision bounds (preserving full precision).
 */
export function measureCurveSeam(
  curve: CubicBezierCurve,
  pieceId: string,
  pieceCode: string,
  seamId: string,
  toleranceCm = 0.005
): SeamArcLengthMeasurement {
  const result = curve.adaptiveLength(toleranceCm);
  const uncertainty = Number.isFinite(result.errorBoundCm)
    ? result.errorBoundCm
    : (result.upperBoundCm - result.lowerBoundCm) / 2;

  return {
    pieceId,
    pieceCode,
    seamId,
    segmentId: curve.id,
    lengthCm: result.lengthCm,
    lowerBoundCm: result.lowerBoundCm,
    upperBoundCm: result.upperBoundCm,
    uncertaintyCm: uncertainty,
    toleranceAchieved: result.toleranceAchieved,
    subdivisions: result.subdivisions
  };
}

/**
 * Evaluates independent front, back, and total seam compatibility metrics.
 */
export function evaluateSeamCompatibilityBreakdown(
  ease: EaseCompatibilityMetrics,
  maxTotalEaseCm = DEFAULT_MAX_TOTAL_EASE_CM
): SeamCompatibilityBreakdown {
  const fLower = ease.frontEaseCm - ease.frontEaseUncertaintyCm;
  const fUpper = ease.frontEaseCm + ease.frontEaseUncertaintyCm;
  const fNonNegative = ease.frontEaseCm >= 0;
  const fIntervalSafe = fLower >= 0;
  const fValid = fNonNegative && fIntervalSafe && ease.frontResidualCm <= 0.50;

  const frontReasons: string[] = [];
  if (!fNonNegative) {
    frontReasons.push(`Negative front seam ease (${formatSignedCm(ease.frontEaseCm)} < 0.00 cm).`);
  } else if (!fIntervalSafe) {
    frontReasons.push(`Front ease lower confidence bound (${fLower.toFixed(4)} cm) drops below 0.00 cm.`);
  }
  if (ease.frontResidualCm > 0.50) {
    frontReasons.push(`Front ease residual (${ease.frontResidualCm.toFixed(2)} cm) exceeds 0.50 cm target tolerance.`);
  }

  const front: IndividualSeamCompatibility = {
    side: 'front',
    armholeLengthCm: ease.frontBodiceArmholeLengthCm,
    sleeveCapLengthCm: ease.frontSleeveCapLengthCm,
    easeCm: ease.frontEaseCm,
    uncertaintyCm: ease.frontEaseUncertaintyCm,
    lowerConfidenceCm: fLower,
    upperConfidenceCm: fUpper,
    targetEaseCm: ease.targetFrontEaseCm,
    residualCm: ease.frontResidualCm,
    isNonNegative: fNonNegative,
    isWithinTolerance: ease.frontResidualCm <= 0.50,
    isConfidenceIntervalSafe: fIntervalSafe,
    isValid: fValid,
    blockingReasons: frontReasons
  };

  const bLower = ease.backEaseCm - ease.backEaseUncertaintyCm;
  const bUpper = ease.backEaseCm + ease.backEaseUncertaintyCm;
  const bNonNegative = ease.backEaseCm >= 0;
  const bIntervalSafe = bLower >= 0;
  const bValid = bNonNegative && bIntervalSafe && ease.backResidualCm <= 0.50;

  const backReasons: string[] = [];
  if (!bNonNegative) {
    backReasons.push(`Negative back seam ease (${formatSignedCm(ease.backEaseCm)} < 0.00 cm).`);
  } else if (!bIntervalSafe) {
    backReasons.push(`Back ease lower confidence bound (${bLower.toFixed(4)} cm) drops below 0.00 cm.`);
  }
  if (ease.backResidualCm > 0.50) {
    backReasons.push(`Back ease residual (${ease.backResidualCm.toFixed(2)} cm) exceeds 0.50 cm target tolerance.`);
  }

  const back: IndividualSeamCompatibility = {
    side: 'back',
    armholeLengthCm: ease.backBodiceArmholeLengthCm,
    sleeveCapLengthCm: ease.backSleeveCapLengthCm,
    easeCm: ease.backEaseCm,
    uncertaintyCm: ease.backEaseUncertaintyCm,
    lowerConfidenceCm: bLower,
    upperConfidenceCm: bUpper,
    targetEaseCm: ease.targetBackEaseCm,
    residualCm: ease.backResidualCm,
    isNonNegative: bNonNegative,
    isWithinTolerance: ease.backResidualCm <= 0.50,
    isConfidenceIntervalSafe: bIntervalSafe,
    isValid: bValid,
    blockingReasons: backReasons
  };

  const tLower = ease.totalEaseCm - ease.totalEaseUncertaintyCm;
  const tUpper = ease.totalEaseCm + ease.totalEaseUncertaintyCm;
  const tNonNegative = ease.totalEaseCm >= 0;
  const tWithinMax = ease.totalEaseCm <= maxTotalEaseCm;
  const tIntervalSafe = tLower >= 0 && tUpper <= maxTotalEaseCm;
  const tValid = tNonNegative && tWithinMax && tIntervalSafe && ease.totalResidualCm <= 0.60;

  const totalReasons: string[] = [];
  if (!tNonNegative) {
    totalReasons.push(`Negative total ease (${formatSignedCm(ease.totalEaseCm)} < 0.00 cm).`);
  }
  if (!tWithinMax) {
    totalReasons.push(`Total ease (${ease.totalEaseCm.toFixed(2)} cm) exceeds ${maxTotalEaseCm.toFixed(2)} cm crimp ceiling.`);
  }
  if (tNonNegative && tWithinMax && !tIntervalSafe) {
    totalReasons.push(`Total ease confidence interval [${tLower.toFixed(4)}, ${tUpper.toFixed(4)}] cm crosses [0.00, ${maxTotalEaseCm.toFixed(2)}] boundary.`);
  }
  if (ease.totalResidualCm > 0.60) {
    totalReasons.push(`Total ease residual (${ease.totalResidualCm.toFixed(2)} cm) exceeds 0.60 cm target tolerance.`);
  }

  const total: IndividualSeamCompatibility = {
    side: 'total',
    armholeLengthCm: ease.totalBodiceArmholeLengthCm,
    sleeveCapLengthCm: ease.totalSleeveCapLengthCm,
    easeCm: ease.totalEaseCm,
    uncertaintyCm: ease.totalEaseUncertaintyCm,
    lowerConfidenceCm: tLower,
    upperConfidenceCm: tUpper,
    targetEaseCm: ease.targetTotalEaseCm,
    residualCm: ease.totalResidualCm,
    isNonNegative: tNonNegative,
    isWithinTolerance: tWithinMax && ease.totalResidualCm <= 0.60,
    isConfidenceIntervalSafe: tIntervalSafe,
    isValid: tValid,
    blockingReasons: totalReasons
  };

  return {
    front,
    back,
    total,
    areAllSeamsIndividuallyValid: fValid && bValid && tValid
  };
}

/**
 * Evaluates strict numerical uncertainty propagation & boundary ambiguity gates.
 */
export function evaluateUncertaintyGate(
  measurements: SeamArcLengthMeasurement[],
  ease: EaseCompatibilityMetrics,
  maxTotalEaseCm = DEFAULT_MAX_TOTAL_EASE_CM
): UncertaintyGateResult {
  const blockingReasons: string[] = [];
  const intervalAmbiguities: string[] = [];

  let maxObservedSingle = 0;
  for (const m of measurements) {
    if (!Number.isFinite(m.lengthCm) || !Number.isFinite(m.uncertaintyCm)) {
      blockingReasons.push(`Seam [${m.segmentId}] contains non-finite arc length or uncertainty.`);
      continue;
    }
    if (m.uncertaintyCm > maxObservedSingle) {
      maxObservedSingle = m.uncertaintyCm;
    }
    if (!m.toleranceAchieved) {
      blockingReasons.push(`Seam [${m.segmentId}] adaptive subdivision did not achieve requested Bezier tolerance.`);
    }
    if (m.uncertaintyCm > MAX_SINGLE_SEAM_UNCERTAINTY_CM) {
      blockingReasons.push(`Seam [${m.segmentId}] uncertainty (±${m.uncertaintyCm.toFixed(4)} cm) exceeds ${MAX_SINGLE_SEAM_UNCERTAINTY_CM} cm bound.`);
    }
  }

  if (!Number.isFinite(ease.totalEaseUncertaintyCm) || ease.totalEaseUncertaintyCm > MAX_SINGLE_SEAM_UNCERTAINTY_CM) {
    blockingReasons.push(
      `Propagated total ease uncertainty (±${Number.isFinite(ease.totalEaseUncertaintyCm) ? ease.totalEaseUncertaintyCm.toFixed(4) : 'NaN'} cm) exceeds ${MAX_SINGLE_SEAM_UNCERTAINTY_CM} cm gate.`
    );
  }

  // Boundary interval checks: [val - u, val + u] must not straddle physical/tailoring gates when nominal value is inside them
  if (ease.frontEaseCm >= 0 && ease.frontEaseCm - ease.frontEaseUncertaintyCm < 0) {
    const msg = `Front ease (${ease.frontEaseCm.toFixed(4)} ± ${ease.frontEaseUncertaintyCm.toFixed(4)} cm) uncertainty interval straddles 0.00 cm minimum.`;
    intervalAmbiguities.push(msg);
    blockingReasons.push(msg);
  }
  if (ease.backEaseCm >= 0 && ease.backEaseCm - ease.backEaseUncertaintyCm < 0) {
    const msg = `Back ease (${ease.backEaseCm.toFixed(4)} ± ${ease.backEaseUncertaintyCm.toFixed(4)} cm) uncertainty interval straddles 0.00 cm minimum.`;
    intervalAmbiguities.push(msg);
    blockingReasons.push(msg);
  }
  if (ease.totalEaseCm >= 0 && ease.totalEaseCm <= maxTotalEaseCm) {
    if (ease.totalEaseCm - ease.totalEaseUncertaintyCm < 0 || ease.totalEaseCm + ease.totalEaseUncertaintyCm > maxTotalEaseCm) {
      const msg = `Total ease (${ease.totalEaseCm.toFixed(4)} ± ${ease.totalEaseUncertaintyCm.toFixed(4)} cm) uncertainty interval straddles [0.00, ${maxTotalEaseCm.toFixed(2)}] cm boundary.`;
      intervalAmbiguities.push(msg);
      blockingReasons.push(msg);
    }
  }
  if (ease.isRatioDefined && ease.frontEaseRatio !== null && ease.frontEaseRatioUncertainty !== null) {
    const r = ease.frontEaseRatio;
    const ru = ease.frontEaseRatioUncertainty;
    if (r >= 0.35 && r <= 0.55 && (r - ru < 0.35 || r + ru > 0.55)) {
      const msg = `Front ease ratio (${(r * 100).toFixed(2)}% ± ${(ru * 100).toFixed(2)}%) straddles [35%, 55%] partition gate.`;
      intervalAmbiguities.push(msg);
      blockingReasons.push(msg);
    }
  }

  return {
    passed: blockingReasons.length === 0,
    maxAllowedSingleSeamUncertaintyCm: MAX_SINGLE_SEAM_UNCERTAINTY_CM,
    maxObservedSingleSeamUncertaintyCm: maxObservedSingle,
    totalEaseUncertaintyCm: ease.totalEaseUncertaintyCm,
    intervalAmbiguities,
    blockingReasons
  };
}

/**
 * Evaluates ease distribution and target compliance at full floating-point precision.
 */
export function evaluateEaseCompatibility(
  fBodiceMeas: SeamArcLengthMeasurement,
  bBodiceMeas: SeamArcLengthMeasurement,
  fSleeveMeas: SeamArcLengthMeasurement,
  bSleeveMeas: SeamArcLengthMeasurement,
  options?: AssemblyOptions
): EaseCompatibilityMetrics {
  const cfg = resolveAndValidateAssemblyConfig(options);
  const strategy: SleeveEaseStrategy = cfg.resolvedStrategy;
  const tableValues = SLEEVE_EASE_TABLE[strategy] ?? SLEEVE_EASE_TABLE.classic;
  const maxTotalEaseCm = cfg.resolvedMaxTotalEaseCm;

  const hasCustomTarget = cfg.resolvedCustomTargetEaseCm !== undefined;
  const targetTotalEaseCm = hasCustomTarget
    ? cfg.resolvedCustomTargetEaseCm!
    : tableValues.recommendedCapEaseCm;
  // Standard anthropometric tailoring distribution: 44% front, 56% back
  const targetFrontEaseCm = targetTotalEaseCm * 0.44;
  const targetBackEaseCm = targetTotalEaseCm * 0.56;

  const frontBodiceArmholeLengthCm = fBodiceMeas.lengthCm;
  const backBodiceArmholeLengthCm = bBodiceMeas.lengthCm;
  const totalBodiceArmholeLengthCm = frontBodiceArmholeLengthCm + backBodiceArmholeLengthCm;

  const frontSleeveCapLengthCm = fSleeveMeas.lengthCm;
  const backSleeveCapLengthCm = bSleeveMeas.lengthCm;
  const totalSleeveCapLengthCm = frontSleeveCapLengthCm + backSleeveCapLengthCm;

  // Core ease equations (unrounded full binary64 precision)
  const frontEaseCm = frontSleeveCapLengthCm - frontBodiceArmholeLengthCm;
  const backEaseCm = backSleeveCapLengthCm - backBodiceArmholeLengthCm;
  const totalEaseCm = frontEaseCm + backEaseCm;

  // Propagated uncertainties
  const frontEaseUncertaintyCm = fSleeveMeas.uncertaintyCm + fBodiceMeas.uncertaintyCm;
  const backEaseUncertaintyCm = bSleeveMeas.uncertaintyCm + bBodiceMeas.uncertaintyCm;
  const totalEaseUncertaintyCm = frontEaseUncertaintyCm + backEaseUncertaintyCm;

  // Front ease ratio: E_f / E_t
  // Strictly defined mathematical domain: E_t >= 0.20 cm, E_f >= 0, E_b >= 0
  const MIN_RATIO_DENOMINATOR_CM = 0.20;
  const isRatioDefined = totalEaseCm >= MIN_RATIO_DENOMINATOR_CM && frontEaseCm >= 0 && backEaseCm >= 0;
  const frontEaseRatio = isRatioDefined ? frontEaseCm / totalEaseCm : null;

  // First-order conservative differential ratio uncertainty
  const frontEaseRatioUncertainty = isRatioDefined && totalEaseCm > 0
    ? ((Math.abs(backEaseCm) * frontEaseUncertaintyCm) + (Math.abs(frontEaseCm) * backEaseUncertaintyCm)) / (totalEaseCm * totalEaseCm)
    : null;

  const recommendedEnvelopeCm = {
    min: tableValues.capEaseMinCm,
    max: tableValues.capEaseMaxCm
  };

  // Handle customTargetEaseCm === 0 without skipping via truthy check
  const customEnvelopeCm = hasCustomTarget
    ? {
        min: Math.max(0, targetTotalEaseCm - 0.5),
        max: Math.min(maxTotalEaseCm, targetTotalEaseCm + 0.5)
      }
    : undefined;

  const frontResidualCm = Math.abs(frontEaseCm - targetFrontEaseCm);
  const backResidualCm = Math.abs(backEaseCm - targetBackEaseCm);
  const totalResidualCm = Math.abs(totalEaseCm - targetTotalEaseCm);

  // Physical tolerances (note: distribution parity still fails any negative component, and strictTotal <= 5.00 cm)
  const isFrontEasePermitted = frontEaseCm >= -0.05;
  const isBackEasePermitted = backEaseCm >= -0.05;
  const isTotalEasePermitted = totalEaseCm >= 0 && totalEaseCm <= maxTotalEaseCm;

  let isDistributionBalanced = false;
  if (isRatioDefined && frontEaseRatio !== null) {
    isDistributionBalanced = frontEaseRatio >= 0.35 && frontEaseRatio <= 0.55;
  } else if (frontEaseCm >= 0 && backEaseCm >= 0 && totalEaseCm < MIN_RATIO_DENOMINATOR_CM) {
    isDistributionBalanced = Math.abs(frontEaseCm - backEaseCm) <= 0.20;
  } else {
    isDistributionBalanced = false;
  }

  const activeEnvelope = customEnvelopeCm ?? recommendedEnvelopeCm;
  const isTotalEaseTargetCompliant =
    totalEaseCm >= activeEnvelope.min - 0.20 &&
    totalEaseCm <= activeEnvelope.max + 0.20 &&
    totalResidualCm <= 0.60;

  const isTargetCompliant = isTotalEaseTargetCompliant && frontResidualCm <= 0.50 && backResidualCm <= 0.50;

  return {
    frontBodiceArmholeLengthCm,
    backBodiceArmholeLengthCm,
    totalBodiceArmholeLengthCm,
    frontSleeveCapLengthCm,
    backSleeveCapLengthCm,
    totalSleeveCapLengthCm,
    frontEaseCm,
    backEaseCm,
    totalEaseCm,
    frontEaseUncertaintyCm,
    backEaseUncertaintyCm,
    totalEaseUncertaintyCm,
    frontEaseRatio,
    isRatioDefined,
    frontEaseRatioUncertainty,
    targetStrategy: strategy,
    targetTotalEaseCm,
    targetFrontEaseCm,
    targetBackEaseCm,
    recommendedEnvelopeCm,
    customEnvelopeCm,
    frontResidualCm,
    backResidualCm,
    totalResidualCm,
    isFrontEasePermitted,
    isBackEasePermitted,
    isTotalEasePermitted,
    isDistributionBalanced,
    isTotalEaseTargetCompliant,
    isTargetCompliant
  };
}

function getDynamicSeamLengthCm(piece: PatternPiece, seam: SeamLine): number {
  const segIds = seam.segmentIds ?? (seam.segmentId ? [seam.segmentId] : []);
  if (piece.stitchingContour?.segments && segIds.length > 0) {
    let total = 0;
    let foundAll = true;
    for (const sId of segIds) {
      const seg = piece.stitchingContour.segments.find(s => s.id === sId);
      if (!seg) {
        foundAll = false;
        break;
      }
      total += seg.lengthCm();
    }
    if (foundAll) return total;
  }
  return seam.lengthCm;
}

/**
 * Validates endpoint connectivity, traversal directions, sleeve handedness, shoulder consistency, and inseam parity.
 */
export function evaluateSeamEndpointsAndOrientations(
  extracted: ExtractedAssemblyCurves
): SeamEndpointOrientationResult {
  const reasons: string[] = [];
  const {
    frontBodiceArmhole,
    backBodiceArmhole,
    sleeveFrontCap,
    sleeveBackCap,
    sleeveFrontInseam,
    sleeveBackInseam,
    frontBodicePiece,
    backBodicePiece
  } = extracted;

  const fBodiceUnderarm = frontBodiceArmhole.p0;
  const fBodiceShoulderTip = frontBodiceArmhole.p3;

  const bBodiceUnderarm = backBodiceArmhole.p0;
  const bBodiceShoulderTip = backBodiceArmhole.p3;

  const slvCrownFront = sleeveFrontCap.p0;
  const slvFrontUnderarm = sleeveFrontCap.p3;

  const slvBackUnderarm = sleeveBackCap.p0;
  const slvCrownBack = sleeveBackCap.p3;

  // 1. Crown apex match: both cap curves meet at (0,0)
  const crownDistance = distance(slvCrownFront, slvCrownBack);
  const isCrownContinuous = crownDistance <= 0.05;
  if (!isCrownContinuous) {
    reasons.push(`Sleeve front cap start (${slvCrownFront.x}, ${slvCrownFront.y}) and back cap end (${slvCrownBack.x}, ${slvCrownBack.y}) do not meet at crown apex (delta: ${crownDistance.toFixed(2)} cm > 0.05 cm).`);
  }

  // C1 tangent continuity check at apex
  const cp1F = (sleeveFrontCap as any).cp1 ?? (sleeveFrontCap as any).p1;
  const cp2B = (sleeveBackCap as any).cp2 ?? (sleeveBackCap as any).p2;
  let isTangentContinuous = false;
  let tangentDepartureDeg: number | undefined = undefined;

  if (!cp1F || !cp2B) {
    reasons.push('Missing tangent control points on sleeve cap at crown apex (C1 continuity cannot be verified).');
  } else {
    const vBack = { x: slvCrownBack.x - cp2B.x, y: slvCrownBack.y - cp2B.y };
    const vFront = { x: cp1F.x - slvCrownFront.x, y: cp1F.y - slvCrownFront.y };
    const lenBack = Math.hypot(vBack.x, vBack.y);
    const lenFront = Math.hypot(vFront.x, vFront.y);

    if (lenBack < 1e-6 || lenFront < 1e-6) {
      reasons.push('Degenerate tangent vector on sleeve cap at crown apex (zero-length control vector).');
    } else {
      const thetaBackDeg = Math.atan2(vBack.y, vBack.x) * (180 / Math.PI);
      const thetaFrontDeg = Math.atan2(vFront.y, vFront.x) * (180 / Math.PI);
      tangentDepartureDeg = smallestAngularDifferenceDeg(thetaFrontDeg, thetaBackDeg);
      isTangentContinuous = isCrownContinuous && tangentDepartureDeg <= 1.0;
      if (isCrownContinuous && !isTangentContinuous) {
        reasons.push(`Sleeve crown apex exhibits C1 tangent discontinuity (departure: ${tangentDepartureDeg.toFixed(2)}° > 1.00°).`);
      }
    }
  }

  // 2. Sleeve handedness check (prevents mirrored/swapped front/back cap orientation)
  const isHandednessValid = slvFrontUnderarm.x > slvCrownFront.x && slvBackUnderarm.x < slvCrownBack.x;
  const sleeveHandedness: SleeveHandednessResult = {
    isValid: isHandednessValid,
    crownApexX: slvCrownFront.x,
    frontUnderarmX: slvFrontUnderarm.x,
    backUnderarmX: slvBackUnderarm.x,
    reason: isHandednessValid
      ? undefined
      : `Inverted or mirrored sleeve handedness: expected front underarm X (${slvFrontUnderarm.x}) > crown X (${slvCrownFront.x}) > back underarm X (${slvBackUnderarm.x}).`
  };
  if (!isHandednessValid) {
    reasons.push(sleeveHandedness.reason!);
  }

  // 3. Traversal direction checks
  const fBodiceAscends = fBodiceShoulderTip.y < fBodiceUnderarm.y;
  if (!fBodiceAscends) {
    reasons.push(`Front bodice armhole reversed: shoulder tip y (${fBodiceShoulderTip.y}) is lower than underarm y (${fBodiceUnderarm.y}).`);
  }

  const bBodiceAscends = bBodiceShoulderTip.y < bBodiceUnderarm.y;
  if (!bBodiceAscends) {
    reasons.push(`Back bodice armhole reversed: shoulder tip y (${bBodiceShoulderTip.y}) is lower than underarm y (${bBodiceUnderarm.y}).`);
  }

  const slvFrontDescends = slvFrontUnderarm.y >= slvCrownFront.y;
  if (!slvFrontDescends) {
    reasons.push(`Sleeve front cap reversed: front underarm y (${slvFrontUnderarm.y}) is above crown apex (${slvCrownFront.y}).`);
  }

  const slvBackAscends = slvBackUnderarm.y >= slvCrownBack.y;
  if (!slvBackAscends) {
    reasons.push(`Sleeve back cap reversed: back underarm y (${slvBackUnderarm.y}) is above crown apex (${slvCrownBack.y}).`);
  }

  const frontUnderarmMatch: SeamEndpointMatch = {
    name: 'Front Scye Underarm Junction',
    bodicePieceId: frontBodicePiece.id,
    bodicePoint: fBodiceUnderarm,
    sleevePoint: slvFrontUnderarm,
    distanceCm: 0,
    isConnected: true,
    expectedDirection: 'bodice ascends from scye to shoulder; sleeve cap descends from crown to scye',
    actualDirection: `${fBodiceAscends ? 'ascending' : 'descending'} / ${slvFrontDescends ? 'descending' : 'ascending'}`,
    isOrientationValid: fBodiceAscends && slvFrontDescends
  };

  const backUnderarmMatch: SeamEndpointMatch = {
    name: 'Back Scye Underarm Junction',
    bodicePieceId: backBodicePiece.id,
    bodicePoint: bBodiceUnderarm,
    sleevePoint: slvBackUnderarm,
    distanceCm: 0,
    isConnected: true,
    expectedDirection: 'bodice ascends from scye to shoulder; sleeve cap ascends from scye to crown',
    actualDirection: `${bBodiceAscends ? 'ascending' : 'descending'} / ${slvBackAscends ? 'ascending' : 'descending'}`,
    isOrientationValid: bBodiceAscends && slvBackAscends
  };

  const crownShoulderMatch: SeamEndpointMatch = {
    name: 'Crown Apex to Shoulder Tip Junction',
    bodicePieceId: frontBodicePiece.id,
    bodicePoint: fBodiceShoulderTip,
    sleevePoint: slvCrownFront,
    distanceCm: 0,
    isConnected: isCrownContinuous,
    expectedDirection: 'sleeve crown apex (0,0) aligns with bodice shoulder seam junction with smooth C1 horizontal tangency',
    actualDirection: isCrownContinuous
      ? (isTangentContinuous ? 'aligned at crown apex with C1 tangency' : `aligned at crown apex with C1 departure of ${tangentDepartureDeg !== undefined ? tangentDepartureDeg.toFixed(2) : 'N/A'}°`)
      : 'disconnected crown',
    isOrientationValid: isCrownContinuous && isTangentContinuous,
    isPositionalCoincident: isCrownContinuous,
    isTangentContinuous,
    tangentDepartureDeg
  };

  // 4. Shoulder seam consistency (supports split shoulder seams from shoulder dart transfer)
  const fShoulderSeam = frontBodicePiece.seams?.find(s => s.id.includes('shoulder') || s.name.toLowerCase().includes('shoulder'));
  const bShoulderSeam = backBodicePiece.seams?.find(s => s.id.includes('shoulder') || s.name.toLowerCase().includes('shoulder'));
  let shoulderSeamConsistency: ShoulderSeamConsistencyResult | undefined = undefined;
  if (fShoulderSeam && bShoulderSeam) {
    const fShLen = getDynamicSeamLengthCm(frontBodicePiece, fShoulderSeam);
    const bShLen = getDynamicSeamLengthCm(backBodicePiece, bShoulderSeam);
    const shDelta = Math.abs(fShLen - bShLen);
    const shValid = shDelta <= 0.20;
    shoulderSeamConsistency = {
      isValid: shValid,
      frontShoulderLengthCm: fShLen,
      backShoulderLengthCm: bShLen,
      deltaCm: shDelta,
      toleranceCm: 0.20,
      reason: shValid
        ? undefined
        : `Front/back bodice shoulder seam mismatch (${fShLen.toFixed(2)} cm vs ${bShLen.toFixed(2)} cm, delta: ${shDelta.toFixed(3)} cm > 0.20 cm) compromises crown shoulder registration.`
    };
    if (!shValid) {
      reasons.push(shoulderSeamConsistency.reason!);
    }
  }

  // 5. Inseam Parity Requirement: Front underarm inseam length === Back underarm inseam length within 0.05 cm
  let frontInseamLengthCm = 0;
  let backInseamLengthCm = 0;
  if (sleeveFrontInseam && sleeveBackInseam) {
    frontInseamLengthCm = distance(sleeveFrontInseam.start, sleeveFrontInseam.end);
    backInseamLengthCm = distance(sleeveBackInseam.start, sleeveBackInseam.end);
  } else {
    const fSeam = extracted.sleevePiece.seams?.find(s => s.id === 'slv-front-inseam' || s.name.includes('Front Underarm Inseam'));
    const bSeam = extracted.sleevePiece.seams?.find(s => s.id === 'slv-back-inseam' || s.name.includes('Back Underarm Inseam'));
    if (fSeam && bSeam) {
      frontInseamLengthCm = fSeam.lengthCm;
      backInseamLengthCm = bSeam.lengthCm;
    }
  }

  const parityDeltaCm = Math.abs(frontInseamLengthCm - backInseamLengthCm);
  const hasParity = parityDeltaCm <= 0.05;
  if (!hasParity && frontInseamLengthCm > 0) {
    reasons.push(`Sleeve underarm inseam parity mismatch: front inseam (${frontInseamLengthCm.toFixed(2)} cm) differs from back inseam (${backInseamLengthCm.toFixed(2)} cm) by ${parityDeltaCm.toFixed(3)} cm (> 0.05 cm).`);
  }

  const isEndpointTopologyValid =
    isCrownContinuous &&
    isTangentContinuous &&
    isHandednessValid &&
    frontUnderarmMatch.isOrientationValid &&
    backUnderarmMatch.isOrientationValid &&
    (shoulderSeamConsistency ? shoulderSeamConsistency.isValid : true) &&
    hasParity &&
    reasons.length === 0;

  return {
    frontUnderarmMatch,
    backUnderarmMatch,
    crownShoulderMatch,
    underarmInseamMatch: {
      frontInseamLengthCm,
      backInseamLengthCm,
      parityDeltaCm,
      hasParity
    },
    sleeveHandedness,
    shoulderSeamConsistency,
    isEndpointTopologyValid,
    reasons
  };
}

function projectPointToLineSegment(
  seg: LineSegment,
  p: Point
): { projectionDistanceCm: number; arcFromStartCm: number; arcFromEndCm: number } {
  const dx = seg.end.x - seg.start.x;
  const dy = seg.end.y - seg.start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    const d = distance(seg.start, p);
    return { projectionDistanceCm: d, arcFromStartCm: 0, arcFromEndCm: 0 };
  }
  const rawT = ((p.x - seg.start.x) * dx + (p.y - seg.start.y) * dy) / lenSq;
  const clampedT = Math.max(0, Math.min(1, rawT));
  const proj = {
    x: seg.start.x + clampedT * dx,
    y: seg.start.y + clampedT * dy
  };
  const segLen = Math.hypot(dx, dy);
  return {
    projectionDistanceCm: distance(p, proj),
    arcFromStartCm: segLen * clampedT,
    arcFromEndCm: segLen * (1 - clampedT)
  };
}

function resolveIndexedPair(notches: Notch[], suffixOne: string, suffixTwo: string): [Notch, Notch] {
  const n1 = notches.find(n => n.id.endsWith(suffixOne)) ?? notches[0];
  const n2 = notches.find(n => n.id.endsWith(suffixTwo) && n.id !== n1.id) ?? notches[1];
  return [n1, n2];
}

/**
 * Validates notch correspondence between bodice and sleeve, including pre-sort double-notch order,
 * ±180° normalized orientation deltas, and elbow-front/elbow-back contour placement & parity.
 */
export function evaluateAssemblyNotches(
  extracted: ExtractedAssemblyCurves
): AssemblyNotchCorrespondenceResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const {
    frontBodicePiece,
    backBodicePiece,
    sleevePiece,
    frontBodiceArmhole,
    backBodiceArmhole,
    sleeveFrontCap,
    sleeveBackCap,
    sleeveFrontInseam,
    sleeveBackInseam
  } = extracted;

  const slvCrownNotch = sleevePiece.notches?.find(n => n.id === 'notch-slv-crown');
  const slvFrontNotch = sleevePiece.notches?.find(n => n.id === 'notch-slv-front-armhole');
  const slvBackNotches = sleevePiece.notches?.filter(n => n.id.includes('notch-slv-back-armhole')) ?? [];
  const slvElbowFrontNotch = sleevePiece.notches?.find(n => n.id === 'notch-slv-elbow-front');
  const slvElbowBackNotch = sleevePiece.notches?.find(n => n.id === 'notch-slv-elbow-back');

  const fbChestNotch = frontBodicePiece.notches?.find(n => n.id.includes('chest') || (n.label && n.label.includes('CHEST')));
  const bbBackNotches = backBodicePiece.notches?.filter(n => n.id.includes('across-back') || (n.label && n.label.includes('BACK SCYE'))) ?? [];

  // 1. Crown Notch Evaluation (using wraparound-safe normalizeAngleDeg / smallestAngularDifferenceDeg)
  let crownCheck: CrownNotchCheck | null = null;
  if (!slvCrownNotch) {
    errors.push('Missing crown apex shoulder match notch on sleeve.');
  } else {
    const apexDist = distance(slvCrownNotch.position, { x: 0, y: 0 });
    const isApexAligned = apexDist <= 0.05;
    if (!isApexAligned) {
      errors.push(`Sleeve crown notch is displaced by ${apexDist.toFixed(2)} cm from apex (0,0). Must be within 0.05 cm.`);
    }
    const normAngle = normalizeAngleDeg(slvCrownNotch.normalAngleDeg);
    const angleDiff = smallestAngularDifferenceDeg(normAngle, -90);
    const isAngleValid = Number.isFinite(angleDiff) && angleDiff <= 15;
    if (!isAngleValid) {
      warnings.push(`Sleeve crown notch angle (${normAngle}°) departs from vertical -90° by ${angleDiff.toFixed(1)}°.`);
    }
    crownCheck = {
      notchId: slvCrownNotch.id,
      position: slvCrownNotch.position,
      apexDistanceCm: apexDist,
      isApexAligned,
      orientationAngleDeg: normAngle,
      isOrientationValid: isAngleValid
    };
  }

  // 2. Front Scye Single Notch Evaluation
  let frontPairing: FrontNotchPairing | null = null;
  if (!slvFrontNotch || !fbChestNotch) {
    if (!slvFrontNotch) errors.push('Missing front scye single notch on sleeve.');
    if (!fbChestNotch) errors.push('Missing chest/armhole matching notch on front bodice.');
  } else {
    const fbDiag = getArcLengthProjectionDiagnostics(frontBodiceArmhole, fbChestNotch.position, 0.005);
    const bodiceArcFromUnderarmCm = fbDiag.arcLengthCm;

    const slvDiag = getArcLengthProjectionDiagnostics(sleeveFrontCap, slvFrontNotch.position, 0.005);
    const slvCurveLen = sleeveFrontCap.adaptiveLength(0.005).lengthCm;
    const slvArcFromUnderarmCm = Math.max(0, slvCurveLen - slvDiag.arcLengthCm);

    const deltaCm = Math.abs(bodiceArcFromUnderarmCm - slvArcFromUnderarmCm);
    const isWithinTolerance = deltaCm <= 0.30;
    if (!isWithinTolerance) {
      errors.push(`Front scye notch arc distance mismatch: bodice is ${bodiceArcFromUnderarmCm.toFixed(2)} cm from underarm, sleeve is ${slvArcFromUnderarmCm.toFixed(2)} cm (delta: ${deltaCm.toFixed(2)} cm > 0.30 cm tolerance).`);
    }

    const slvDisplacement = slvDiag.projectionDistanceCm;
    const fbDisplacement = fbDiag.projectionDistanceCm;
    const isSlvAttached = slvDisplacement <= 0.30;
    const isFbAttached = fbDisplacement <= 0.30;
    const isAttached = isSlvAttached && isFbAttached;

    if (!isSlvAttached) {
      errors.push(`Sleeve front notch is displaced by ${slvDisplacement.toFixed(2)} cm from sleeve cap contour (> 0.30 cm).`);
    }
    if (!isFbAttached) {
      errors.push(`Bodice chest/armhole notch is displaced by ${fbDisplacement.toFixed(2)} cm from front armhole contour (> 0.30 cm).`);
    }

    const normSlvAngle = normalizeAngleDeg(slvFrontNotch.normalAngleDeg);
    const isOrientValid = Number.isFinite(normSlvAngle);

    frontPairing = {
      sleeveNotchId: slvFrontNotch.id,
      bodiceNotchId: fbChestNotch.id,
      sleeveNotchPosition: slvFrontNotch.position,
      bodiceNotchPosition: fbChestNotch.position,
      sleeveArcFromUnderarmCm: slvArcFromUnderarmCm,
      bodiceArcFromUnderarmCm,
      deltaCm,
      isWithinTolerance,
      sleeveDisplacementCm: slvDisplacement,
      bodiceDisplacementCm: fbDisplacement,
      isAttachedToContour: isAttached,
      orientationAngleDeg: normSlvAngle,
      isOrientationValid: isOrientValid
    };
  }

  // 3. Back Scye Double Notch Evaluation (with pre-sort order enforcement)
  let backPairing: BackNotchPairing | null = null;
  if (slvBackNotches.length < 2 || bbBackNotches.length < 2) {
    if (slvBackNotches.length < 2) errors.push(`Expected 2 back scye notches on sleeve, found ${slvBackNotches.length}.`);
    if (bbBackNotches.length < 2) errors.push(`Expected 2 back scye notches on back bodice, found ${bbBackNotches.length}.`);
  } else {
    // Check declared ordering (-1 before -2) BEFORE sorting so swapped indices cannot slip through
    const [rawSlv1, rawSlv2] = resolveIndexedPair(slvBackNotches, '-1', '-2');
    const [rawBb1, rawBb2] = resolveIndexedPair(bbBackNotches, '-1', '-2');

    const rawSlvDiag1 = getArcLengthProjectionDiagnostics(sleeveBackCap, rawSlv1.position, 0.005);
    const rawSlvDiag2 = getArcLengthProjectionDiagnostics(sleeveBackCap, rawSlv2.position, 0.005);
    const rawBbDiag1 = getArcLengthProjectionDiagnostics(backBodiceArmhole, rawBb1.position, 0.005);
    const rawBbDiag2 = getArcLengthProjectionDiagnostics(backBodiceArmhole, rawBb2.position, 0.005);

    const preSortSleeveOrderValid = rawSlvDiag1.arcLengthCm < rawSlvDiag2.arcLengthCm;
    const preSortBodiceOrderValid = rawBbDiag1.arcLengthCm < rawBbDiag2.arcLengthCm;

    if (!preSortSleeveOrderValid) {
      errors.push(
        `Sleeve back double-notch ordering reversed prior to sorting: '${rawSlv1.id}' (${rawSlvDiag1.arcLengthCm.toFixed(2)} cm) is not closer to underarm than '${rawSlv2.id}' (${rawSlvDiag2.arcLengthCm.toFixed(2)} cm).`
      );
    }
    if (!preSortBodiceOrderValid) {
      errors.push(
        `Bodice back double-notch ordering reversed prior to sorting: '${rawBb1.id}' (${rawBbDiag1.arcLengthCm.toFixed(2)} cm) is not closer to underarm than '${rawBb2.id}' (${rawBbDiag2.arcLengthCm.toFixed(2)} cm).`
      );
    }

    const sortedBb = [...bbBackNotches].sort((a, b) => {
      const d1 = getArcLengthProjectionDiagnostics(backBodiceArmhole, a.position, 0.005).arcLengthCm;
      const d2 = getArcLengthProjectionDiagnostics(backBodiceArmhole, b.position, 0.005).arcLengthCm;
      return d1 - d2;
    });

    const sortedSlv = [...slvBackNotches].sort((a, b) => {
      const d1 = getArcLengthProjectionDiagnostics(sleeveBackCap, a.position, 0.005).arcLengthCm;
      const d2 = getArcLengthProjectionDiagnostics(sleeveBackCap, b.position, 0.005).arcLengthCm;
      return d1 - d2;
    });

    const bbDiag1 = getArcLengthProjectionDiagnostics(backBodiceArmhole, sortedBb[0].position, 0.005);
    const bbDiag2 = getArcLengthProjectionDiagnostics(backBodiceArmhole, sortedBb[1].position, 0.005);
    const slvDiag1 = getArcLengthProjectionDiagnostics(sleeveBackCap, sortedSlv[0].position, 0.005);
    const slvDiag2 = getArcLengthProjectionDiagnostics(sleeveBackCap, sortedSlv[1].position, 0.005);

    const bArc1 = bbDiag1.arcLengthCm;
    const bArc2 = bbDiag2.arcLengthCm;
    const sArc1 = slvDiag1.arcLengthCm;
    const sArc2 = slvDiag2.arcLengthCm;

    const delta1 = Math.abs(bArc1 - sArc1);
    const delta2 = Math.abs(bArc2 - sArc2);

    const isPair1Within = delta1 <= 0.30;
    const isPair2Within = delta2 <= 0.30;

    if (!isPair1Within) {
      errors.push(`Back scye notch 1 arc distance mismatch: bodice ${bArc1.toFixed(2)} cm vs sleeve ${sArc1.toFixed(2)} cm (delta: ${delta1.toFixed(2)} cm > 0.30 cm).`);
    }
    if (!isPair2Within) {
      errors.push(`Back scye notch 2 arc distance mismatch: bodice ${bArc2.toFixed(2)} cm vs sleeve ${sArc2.toFixed(2)} cm (delta: ${delta2.toFixed(2)} cm > 0.30 cm).`);
    }

    const slvSpacing = Math.abs(sArc2 - sArc1);
    const bodiceSpacing = Math.abs(bArc2 - bArc1);
    const isSlvSpacingValid = slvSpacing >= 0.90 && slvSpacing <= 1.50;
    const isBodiceSpacingValid = bodiceSpacing >= 0.90 && bodiceSpacing <= 1.50;
    const isSpacingValid = isSlvSpacingValid && isBodiceSpacingValid;

    if (!isSlvSpacingValid) {
      errors.push(`Sleeve back double-notch spacing (${slvSpacing.toFixed(2)} cm) outside standard 1.2 ± 0.30 cm boundary [0.90, 1.50].`);
    }
    if (!isBodiceSpacingValid) {
      errors.push(`Bodice back double-notch spacing (${bodiceSpacing.toFixed(2)} cm) outside standard 1.2 ± 0.30 cm boundary [0.90, 1.50].`);
    }

    const isOrderingValid = preSortSleeveOrderValid && preSortBodiceOrderValid && sArc1 < sArc2 && bArc1 < bArc2;
    if (!isOrderingValid && preSortSleeveOrderValid && preSortBodiceOrderValid) {
      errors.push('Back scye double notches reversed in ordering: notch 1 must be closer to underarm than notch 2.');
    }

    const slvDisp1 = slvDiag1.projectionDistanceCm;
    const slvDisp2 = slvDiag2.projectionDistanceCm;
    const bbDisp1 = bbDiag1.projectionDistanceCm;
    const bbDisp2 = bbDiag2.projectionDistanceCm;

    const areSlvAttached = slvDisp1 <= 0.30 && slvDisp2 <= 0.30;
    const areBbAttached = bbDisp1 <= 0.30 && bbDisp2 <= 0.30;
    const areAttached = areSlvAttached && areBbAttached;

    if (!areSlvAttached) {
      errors.push(`Sleeve back notch contour displacement exceeds 0.30 cm (disp1: ${slvDisp1.toFixed(2)} cm, disp2: ${slvDisp2.toFixed(2)} cm).`);
    }
    if (!areBbAttached) {
      errors.push(`Bodice back scye notch contour displacement exceeds 0.30 cm (disp1: ${bbDisp1.toFixed(2)} cm, disp2: ${bbDisp2.toFixed(2)} cm).`);
    }

    const normAngle1 = normalizeAngleDeg(sortedSlv[0].normalAngleDeg);
    const normAngle2 = normalizeAngleDeg(sortedSlv[1].normalAngleDeg);
    const areOrientsValid = Number.isFinite(normAngle1) && Number.isFinite(normAngle2);

    backPairing = {
      sleeveNotch1Id: sortedSlv[0].id,
      sleeveNotch2Id: sortedSlv[1].id,
      bodiceNotch1Id: sortedBb[0].id,
      bodiceNotch2Id: sortedBb[1].id,
      sleeveNotch1ArcCm: sArc1,
      sleeveNotch2ArcCm: sArc2,
      bodiceNotch1ArcCm: bArc1,
      bodiceNotch2ArcCm: bArc2,
      deltaNotch1Cm: delta1,
      deltaNotch2Cm: delta2,
      isPair1WithinTolerance: isPair1Within,
      isPair2WithinTolerance: isPair2Within,
      sleeveSpacingCm: slvSpacing,
      bodiceSpacingCm: bodiceSpacing,
      isSpacingValid,
      isOrderingValid,
      preSortSleeveOrderValid,
      preSortBodiceOrderValid,
      sleeveDisplacement1Cm: slvDisp1,
      sleeveDisplacement2Cm: slvDisp2,
      bodiceDisplacement1Cm: bbDisp1,
      bodiceDisplacement2Cm: bbDisp2,
      areAttachedToContour: areAttached,
      orientationAngle1Deg: normAngle1,
      orientationAngle2Deg: normAngle2,
      areOrientationsValid: areOrientsValid
    };
  }

  // 4. Elbow-Front and Elbow-Back Inseam Contour Placement & Parity Evaluation
  let elbowFrontCheck: ElbowNotchCheck | null = null;
  let elbowBackCheck: ElbowNotchCheck | null = null;
  let elbowPairParity: ElbowPairParityCheck | null = null;

  if (slvElbowFrontNotch || slvElbowBackNotch) {
    if (!slvElbowFrontNotch) errors.push('Missing front elbow alignment notch (notch-slv-elbow-front).');
    if (!slvElbowBackNotch) errors.push('Missing back elbow alignment notch (notch-slv-elbow-back).');
    if (!sleeveFrontInseam) errors.push('Missing sleeve front inseam segment for elbow notch contour check.');
    if (!sleeveBackInseam) errors.push('Missing sleeve back inseam segment for elbow notch contour check.');

    if (slvElbowFrontNotch && sleeveFrontInseam) {
      const fProj = projectPointToLineSegment(sleeveFrontInseam, slvElbowFrontNotch.position);
      const isAttached = fProj.projectionDistanceCm <= ELBOW_CONTOUR_TOLERANCE_CM;
      const normAngle = normalizeAngleDeg(slvElbowFrontNotch.normalAngleDeg);
      const orientDiff = smallestAngularDifferenceDeg(normAngle, 0);
      const isOrientValid = Number.isFinite(orientDiff) && orientDiff <= 25;
      if (!isAttached) {
        errors.push(`Front elbow notch displaced from front inseam contour by ${fProj.projectionDistanceCm.toFixed(4)} cm (> ${ELBOW_CONTOUR_TOLERANCE_CM} cm).`);
      }
      if (!isOrientValid) {
        warnings.push(`Front elbow notch angle (${normAngle}°) departs from 0° by ${orientDiff.toFixed(1)}°.`);
      }
      elbowFrontCheck = {
        notchId: slvElbowFrontNotch.id,
        side: 'front',
        position: slvElbowFrontNotch.position,
        inseamArcFromUnderarmCm: fProj.arcFromStartCm,
        displacementFromContourCm: fProj.projectionDistanceCm,
        isAttachedToContour: isAttached,
        orientationAngleDeg: normAngle,
        isOrientationValid: isOrientValid
      };
    }

    if (slvElbowBackNotch && sleeveBackInseam) {
      // Back inseam traverses from wBack (start) -> uBack (end), so distance from underarm uBack is arcFromEndCm
      const bProj = projectPointToLineSegment(sleeveBackInseam, slvElbowBackNotch.position);
      const isAttached = bProj.projectionDistanceCm <= ELBOW_CONTOUR_TOLERANCE_CM;
      const normAngle = normalizeAngleDeg(slvElbowBackNotch.normalAngleDeg);
      const orientDiff = smallestAngularDifferenceDeg(normAngle, 180);
      const isOrientValid = Number.isFinite(orientDiff) && orientDiff <= 25;
      if (!isAttached) {
        errors.push(`Back elbow notch displaced from back inseam contour by ${bProj.projectionDistanceCm.toFixed(4)} cm (> ${ELBOW_CONTOUR_TOLERANCE_CM} cm).`);
      }
      if (!isOrientValid) {
        warnings.push(`Back elbow notch angle (${normAngle}°) departs from 180° by ${orientDiff.toFixed(1)}°.`);
      }
      elbowBackCheck = {
        notchId: slvElbowBackNotch.id,
        side: 'back',
        position: slvElbowBackNotch.position,
        inseamArcFromUnderarmCm: bProj.arcFromEndCm,
        displacementFromContourCm: bProj.projectionDistanceCm,
        isAttachedToContour: isAttached,
        orientationAngleDeg: normAngle,
        isOrientationValid: isOrientValid
      };
    }

    if (elbowFrontCheck && elbowBackCheck) {
      const parityDelta = Math.abs(elbowFrontCheck.inseamArcFromUnderarmCm - elbowBackCheck.inseamArcFromUnderarmCm);
      const isParityValid = parityDelta <= ELBOW_PAIR_PARITY_TOLERANCE_CM;
      if (!isParityValid) {
        errors.push(`Front/back elbow notch arc-from-underarm parity delta (${parityDelta.toFixed(4)} cm) exceeds ${ELBOW_PAIR_PARITY_TOLERANCE_CM} cm tolerance.`);
      }
      elbowPairParity = {
        frontArcFromUnderarmCm: elbowFrontCheck.inseamArcFromUnderarmCm,
        backArcFromUnderarmCm: elbowBackCheck.inseamArcFromUnderarmCm,
        parityDeltaCm: parityDelta,
        toleranceCm: ELBOW_PAIR_PARITY_TOLERANCE_CM,
        isParityValid
      };
    }
  }

  const isValid = errors.length === 0;
  const status: AssemblyValidationStatus = isValid ? 'verified-valid' : 'invalid';

  return {
    frontNotch: frontPairing,
    backNotches: backPairing,
    crownNotch: crownCheck,
    elbowFrontNotch: elbowFrontCheck,
    elbowBackNotch: elbowBackCheck,
    elbowPairParity,
    status,
    isValid,
    errors,
    warnings
  };
}

/**
 * Validates closed contour integrity, non-self-intersection, winding, grainlines, and drill holes across all 3 pieces.
 */
export function evaluateAssemblyCurveContinuityAndGeometry(
  extracted: ExtractedAssemblyCurves
): AssemblyContourIntegrityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const checkPieceContour = (piece: PatternPiece, label: string): { ok: boolean; winding: string } => {
    if (!piece.stitchingContour) {
      errors.push(`${label} (${piece.pieceCode}) is missing stitchingContour.`);
      return { ok: false, winding: 'unknown' };
    }
    const res = validateContourIntegrity(piece.stitchingContour, `${label} Stitching`);
    if (!res.isValid) {
      errors.push(...res.errors);
    }
    warnings.push(...res.warnings);

    if (piece.cuttingContour) {
      const cutRes = validateContourIntegrity(piece.cuttingContour, `${label} Cutting`);
      if (!cutRes.isValid) {
        errors.push(...cutRes.errors);
      }
      warnings.push(...cutRes.warnings);
    }

    const winding = piece.stitchingContour.getWinding();
    if (winding === 'collinear') {
      errors.push(`${label} (${piece.pieceCode}) contour collapsed to collinear area.`);
    }
    return { ok: res.isValid && winding !== 'collinear', winding };
  };

  const fCheck = checkPieceContour(extracted.frontBodicePiece, 'Front Bodice');
  const bCheck = checkPieceContour(extracted.backBodicePiece, 'Back Bodice');
  const sCheck = checkPieceContour(extracted.sleevePiece, 'Sleeve');

  let grainlinesValid = true;
  let drillHolesValid = true;
  for (const piece of [extracted.frontBodicePiece, extracted.backBodicePiece, extracted.sleevePiece]) {
    if (
      !piece.grainline ||
      !Number.isFinite(piece.grainline.start?.x) ||
      !Number.isFinite(piece.grainline.start?.y) ||
      !Number.isFinite(piece.grainline.end?.x) ||
      !Number.isFinite(piece.grainline.end?.y) ||
      distance(piece.grainline.start, piece.grainline.end) <= 0
    ) {
      grainlinesValid = false;
      errors.push(`Piece '${piece.name}' (${piece.pieceCode}) has missing or zero-length grainline.`);
    }

    if (piece.drillHoles) {
      for (const dh of piece.drillHoles) {
        if (!Number.isFinite(dh.x) || !Number.isFinite(dh.y)) {
          drillHolesValid = false;
          errors.push(`Piece '${piece.name}' (${piece.pieceCode}) contains non-finite drill-hole coordinate.`);
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    frontBodiceValid: fCheck.ok,
    backBodiceValid: bCheck.ok,
    sleeveValid: sCheck.ok,
    windings: {
      frontBodice: fCheck.winding,
      backBodice: bCheck.winding,
      sleeve: sCheck.winding
    },
    grainlinesValid,
    drillHolesValid,
    errors,
    warnings
  };
}

/**
 * Evaluates measurement provenance, approval state, and design specification approval governance.
 * Always enforces isProductionReady === false under current M00 governance.
 */
export function evaluateAssemblyGovernance(
  input: BodiceSleeveAssemblyInput
): AssemblyGovernanceResult {
  const measurementProvenance: MeasurementOrigin = input.options?.measurementProvenance ?? 'unknown';
  const measurementApprovalState: MeasurementApprovalStatus = input.options?.measurementApprovalState ?? 'unverified';
  const requireApprovedGovernance = input.options?.requireApprovedGovernance ?? false;

  const isMeasurementOriginApprovable = !NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS.has(measurementProvenance);
  const isMeasurementApproved = isMeasurementOriginApprovable && measurementApprovalState === 'approved';
  const designSpecApproved =
    Boolean(input.designSpec?.isApproved) &&
    input.designSpec?.approvalState !== 'revoked' &&
    input.designSpec?.approvalState !== 'invalid';

  const blockingReasons: string[] = [];
  if (!designSpecApproved) {
    blockingReasons.push('Design specification is unapproved or revoked.');
  }
  if (!isMeasurementOriginApprovable) {
    blockingReasons.push(`Measurement origin '${measurementProvenance}' is non-approvable for production sign-off.`);
  }
  if (measurementApprovalState !== 'approved') {
    blockingReasons.push(`Measurement approval state is '${measurementApprovalState}' (must be 'approved').`);
  }

  return {
    measurementProvenance,
    measurementApprovalState,
    isMeasurementOriginApprovable,
    isMeasurementApproved,
    designSpecApproved,
    requireApprovedGovernance,
    isGovernanceApproved: designSpecApproved && isMeasurementApproved,
    isProductionReady: false,
    blockingReasons
  };
}

/**
 * Builds the comprehensive assembly validation report combining config, geometry, ease, seams,
 * uncertainty gate, notches, contour integrity, and governance checks.
 */
export function buildAssemblyValidationReport(
  ease: EaseCompatibilityMetrics,
  endpoints: SeamEndpointOrientationResult,
  notches: AssemblyNotchCorrespondenceResult,
  fBodiceMeas: SeamArcLengthMeasurement,
  bBodiceMeas: SeamArcLengthMeasurement,
  fSleeveMeas: SeamArcLengthMeasurement,
  bSleeveMeas: SeamArcLengthMeasurement,
  extras?: {
    configValidation?: AssemblyConfigValidationResult;
    seamCompatibility?: SeamCompatibilityBreakdown;
    uncertaintyGate?: UncertaintyGateResult;
    contourIntegrity?: AssemblyContourIntegrityResult;
    governance?: AssemblyGovernanceResult;
  }
): ValidationReport {
  const checks: ValidationCheck[] = [];
  const timestamp = new Date().toISOString();

  // 0. Config Validation Check
  if (extras?.configValidation && !extras.configValidation.isValid) {
    checks.push({
      id: 'val-asm-config',
      category: 'geometry',
      name: 'Assembly Configuration Parameters',
      status: 'fail',
      message: `Invalid assembly configuration: ${extras.configValidation.errors.join('; ')}`
    });
  } else {
    checks.push({
      id: 'val-asm-config',
      category: 'geometry',
      name: 'Assembly Configuration Parameters',
      status: 'pass',
      measuredValue: `Strategy: ${ease.targetStrategy}, Target Ease: ${ease.targetTotalEaseCm.toFixed(2)} cm`,
      message: 'Assembly strategy and tolerance configuration validated.'
    });
  }

  // 1. Armhole Seam Continuity & Measurement
  checks.push({
    id: 'val-asm-front-scye-len',
    category: 'contour-integrity',
    name: 'Front Bodice Armhole Arc Length',
    status: fBodiceMeas.toleranceAchieved ? 'pass' : 'fail',
    measuredValue: `${fBodiceMeas.lengthCm.toFixed(2)} cm (±${fBodiceMeas.uncertaintyCm.toFixed(4)} cm)`,
    message: `Front armhole arc length measured with adaptive subdivision (${fBodiceMeas.subdivisions} subdivisions).`
  });

  checks.push({
    id: 'val-asm-back-scye-len',
    category: 'contour-integrity',
    name: 'Back Bodice Armhole Arc Length',
    status: bBodiceMeas.toleranceAchieved ? 'pass' : 'fail',
    measuredValue: `${bBodiceMeas.lengthCm.toFixed(2)} cm (±${bBodiceMeas.uncertaintyCm.toFixed(4)} cm)`,
    message: `Back armhole arc length measured with adaptive subdivision (${bBodiceMeas.subdivisions} subdivisions).`
  });

  // 2. Sleeve Cap Measurements
  checks.push({
    id: 'val-asm-front-cap-len',
    category: 'contour-integrity',
    name: 'Front Sleeve Cap Arc Length',
    status: fSleeveMeas.toleranceAchieved ? 'pass' : 'fail',
    measuredValue: `${fSleeveMeas.lengthCm.toFixed(2)} cm (±${fSleeveMeas.uncertaintyCm.toFixed(4)} cm)`,
    message: `Front sleeve cap arc length measured with adaptive subdivision (${fSleeveMeas.subdivisions} subdivisions).`
  });

  checks.push({
    id: 'val-asm-back-cap-len',
    category: 'contour-integrity',
    name: 'Back Sleeve Cap Arc Length',
    status: bSleeveMeas.toleranceAchieved ? 'pass' : 'fail',
    measuredValue: `${bSleeveMeas.lengthCm.toFixed(2)} cm (±${bSleeveMeas.uncertaintyCm.toFixed(4)} cm)`,
    message: `Back sleeve cap arc length measured with adaptive subdivision (${bSleeveMeas.subdivisions} subdivisions).`
  });

  // 2b. Uncertainty Gate Check
  if (extras?.uncertaintyGate) {
    const ug = extras.uncertaintyGate;
    checks.push({
      id: 'val-asm-uncertainty-gate',
      category: 'geometry',
      name: 'Numerical Uncertainty Propagation Gate',
      status: ug.passed ? 'pass' : 'fail',
      measuredValue: `Max seam: ±${ug.maxObservedSingleSeamUncertaintyCm.toFixed(4)} cm | Total ease: ±${ug.totalEaseUncertaintyCm.toFixed(4)} cm`,
      expectedValue: `<= ±${ug.maxAllowedSingleSeamUncertaintyCm.toFixed(2)} cm & zero boundary straddling`,
      message: ug.passed
        ? 'Adaptive Bezier arc-length and propagated ease uncertainty intervals strictly satisfy numerical assurance bounds.'
        : `Uncertainty gate failed: ${ug.blockingReasons.join('; ')}`
    });
  }

  // 3. Front Ease Boundary Check (exact >= 0.00 cm when seamCompatibility provided)
  const frontStrictOk = extras?.seamCompatibility ? extras.seamCompatibility.front.isNonNegative : ease.isFrontEasePermitted;
  if (!frontStrictOk || !ease.isFrontEasePermitted) {
    checks.push({
      id: 'val-asm-front-ease-limit',
      category: 'seam-match',
      name: 'Front Sleeve Cap Ease Boundary',
      status: 'fail',
      measuredValue: `${formatSignedCm(ease.frontEaseCm)} (Scye: ${ease.frontBodiceArmholeLengthCm.toFixed(2)} cm, Cap: ${ease.frontSleeveCapLengthCm.toFixed(2)} cm)`,
      expectedValue: 'Front Ease >= 0.00 cm',
      deviationCm: Math.abs(ease.frontEaseCm),
      toleranceCm: 0.00,
      message: `Front sleeve cap is shorter than front bodice armhole by ${Math.abs(ease.frontEaseCm).toFixed(2)} cm. Causes front draglines.`
    });
  } else {
    checks.push({
      id: 'val-asm-front-ease-limit',
      category: 'seam-match',
      name: 'Front Sleeve Cap Ease Boundary',
      status: 'pass',
      measuredValue: `${formatSignedCm(ease.frontEaseCm)} (±${ease.frontEaseUncertaintyCm.toFixed(4)} cm)`,
      message: 'Front sleeve cap ease satisfies physical assembly boundary (E_f >= 0.00 cm).'
    });
  }

  // 4. Back Ease Boundary Check
  const backStrictOk = extras?.seamCompatibility ? extras.seamCompatibility.back.isNonNegative : ease.isBackEasePermitted;
  if (!backStrictOk || !ease.isBackEasePermitted) {
    checks.push({
      id: 'val-asm-back-ease-limit',
      category: 'seam-match',
      name: 'Back Sleeve Cap Ease Boundary',
      status: 'fail',
      measuredValue: `${formatSignedCm(ease.backEaseCm)} (Scye: ${ease.backBodiceArmholeLengthCm.toFixed(2)} cm, Cap: ${ease.backSleeveCapLengthCm.toFixed(2)} cm)`,
      expectedValue: 'Back Ease >= 0.00 cm',
      deviationCm: Math.abs(ease.backEaseCm),
      toleranceCm: 0.00,
      message: `Back sleeve cap is shorter than back bodice armhole by ${Math.abs(ease.backEaseCm).toFixed(2)} cm. Restricts arm reach.`
    });
  } else {
    checks.push({
      id: 'val-asm-back-ease-limit',
      category: 'seam-match',
      name: 'Back Sleeve Cap Ease Boundary',
      status: 'pass',
      measuredValue: `${formatSignedCm(ease.backEaseCm)} (±${ease.backEaseUncertaintyCm.toFixed(4)} cm)`,
      message: 'Back sleeve cap ease satisfies physical assembly boundary (E_b >= 0.00 cm).'
    });
  }

  // 5. Total Ease & Threshold Check (strict 5.00 cm ceiling)
  const maxAllowed = extras?.configValidation?.resolvedMaxTotalEaseCm ?? DEFAULT_MAX_TOTAL_EASE_CM;
  if (!ease.isTotalEasePermitted) {
    checks.push({
      id: 'val-asm-total-ease-limit',
      category: 'seam-match',
      name: 'Total Sleeve Cap Ease Boundary',
      status: 'fail',
      measuredValue: `${formatSignedCm(ease.totalEaseCm)} (Scye: ${ease.totalBodiceArmholeLengthCm.toFixed(2)} cm, Cap: ${ease.totalSleeveCapLengthCm.toFixed(2)} cm)`,
      expectedValue: `0.00 cm <= Total Ease <= ${maxAllowed.toFixed(2)} cm`,
      deviationCm: ease.totalEaseCm < 0 ? Math.abs(ease.totalEaseCm) : Number((ease.totalEaseCm - maxAllowed).toFixed(2)),
      toleranceCm: maxAllowed,
      message: ease.totalEaseCm < 0
        ? `Negative total sleeve ease (${formatSignedCm(ease.totalEaseCm)}). Sleeve cap cannot fit armhole.`
        : `Total sleeve ease (${formatSignedCm(ease.totalEaseCm)}) exceeds ${maxAllowed.toFixed(2)} cm maximum tailoring crimp limit.`
    });
  } else {
    checks.push({
      id: 'val-asm-total-ease-limit',
      category: 'seam-match',
      name: 'Total Sleeve Cap Ease Boundary',
      status: 'pass',
      measuredValue: `${formatSignedCm(ease.totalEaseCm)} (±${ease.totalEaseUncertaintyCm.toFixed(4)} cm)`,
      expectedValue: `0.00 cm <= Total Ease <= ${maxAllowed.toFixed(2)} cm`,
      toleranceCm: maxAllowed,
      message: `Total sleeve cap ease verified within permissible assembly range [0.00, ${maxAllowed.toFixed(2)} cm]. Target: ${ease.targetTotalEaseCm} cm.`
    });
  }

  // 6. Ease Distribution Balance Check (35% - 55% front ratio, or parity for minimal ease)
  if (!ease.isRatioDefined || ease.frontEaseRatio === null) {
    if (ease.isDistributionBalanced) {
      checks.push({
        id: 'val-asm-ease-distribution',
        category: 'seam-match',
        name: 'Front/Back Ease Partition Balance',
        status: 'pass',
        measuredValue: `Delta: ${Math.abs(ease.frontEaseCm - ease.backEaseCm).toFixed(2)} cm <= 0.20 cm (Total Ease: ${formatSignedCm(ease.totalEaseCm)} < 0.20 cm)`,
        message: 'Minimal sleeve cap ease (< 0.20 cm). Ratio undefined; distribution balanced via absolute parity (|E_f - E_b| <= 0.20 cm).'
      });
    } else {
      checks.push({
        id: 'val-asm-ease-distribution',
        category: 'seam-match',
        name: 'Front/Back Ease Partition Balance',
        status: 'fail',
        measuredValue: `E_f: ${formatSignedCm(ease.frontEaseCm)}, E_b: ${formatSignedCm(ease.backEaseCm)}, E_t: ${formatSignedCm(ease.totalEaseCm)}`,
        expectedValue: 'Non-negative ease components with balanced front/back allocation',
        deviationCm: Math.abs(ease.frontEaseCm - ease.backEaseCm),
        toleranceCm: 0.20,
        message: ease.frontEaseCm < 0 || ease.backEaseCm < 0
          ? `Negative ease component (E_f: ${formatSignedCm(ease.frontEaseCm)}, E_b: ${formatSignedCm(ease.backEaseCm)}). Ratio undefined and assembly physically invalid.`
          : `Minimal ease distribution unbalanced: delta ${Math.abs(ease.frontEaseCm - ease.backEaseCm).toFixed(2)} cm exceeds 0.20 cm tolerance.`
      });
    }
  } else {
    if (!ease.isDistributionBalanced) {
      checks.push({
        id: 'val-asm-ease-distribution',
        category: 'seam-match',
        name: 'Front/Back Ease Partition Balance',
        status: 'fail',
        measuredValue: `Front: ${(ease.frontEaseRatio * 100).toFixed(1)}% (±${((ease.frontEaseRatioUncertainty ?? 0) * 100).toFixed(2)}%), Back: ${((1 - ease.frontEaseRatio) * 100).toFixed(1)}%`,
        expectedValue: '35.0% <= Front Ratio <= 55.0%',
        deviationCm: ease.frontEaseRatio < 0.35 ? Number((0.35 - ease.frontEaseRatio).toFixed(3)) : Number((ease.frontEaseRatio - 0.55).toFixed(3)),
        toleranceCm: 0.10,
        message: `Front/Back ease distribution is unbalanced (front ratio: ${(ease.frontEaseRatio * 100).toFixed(1)}%). Standard tailoring requires 35% to 55% front ease.`
      });
    } else {
      checks.push({
        id: 'val-asm-ease-distribution',
        category: 'seam-match',
        name: 'Front/Back Ease Partition Balance',
        status: 'pass',
        measuredValue: `Front: ${(ease.frontEaseRatio * 100).toFixed(1)}% (±${((ease.frontEaseRatioUncertainty ?? 0) * 100).toFixed(2)}%), Back: ${((1 - ease.frontEaseRatio) * 100).toFixed(1)}%`,
        message: `Ease partition conforms to anatomical shoulder balance (${(ease.frontEaseRatio * 100).toFixed(1)}% front / ${((1 - ease.frontEaseRatio) * 100).toFixed(1)}% back).`
      });
    }
  }

  // 6b. Crown Apex C1 Tangent Continuity Check
  const crownMatch = endpoints.crownShoulderMatch;
  if (crownMatch.isTangentContinuous !== undefined) {
    if (!crownMatch.isTangentContinuous) {
      checks.push({
        id: 'val-asm-crown-c1-tangency',
        category: 'geometry',
        name: 'Crown Apex C1 Tangent Continuity',
        status: 'fail',
        measuredValue: `${crownMatch.tangentDepartureDeg?.toFixed(2) ?? 'N/A'}°`,
        expectedValue: 'Departure <= 1.00°',
        deviationCm: crownMatch.tangentDepartureDeg ?? 0,
        toleranceCm: 1.00,
        message: `Crown apex satisfies C0 position match but departs from smooth C1 horizontal tangency by ${crownMatch.tangentDepartureDeg}° (tolerance: 1.00°).`
      });
    } else {
      checks.push({
        id: 'val-asm-crown-c1-tangency',
        category: 'geometry',
        name: 'Crown Apex C1 Tangent Continuity',
        status: 'pass',
        measuredValue: `${crownMatch.tangentDepartureDeg?.toFixed(2) ?? '0.00'}° <= 1.00°`,
        message: 'Crown apex exhibits smooth C1 horizontal tangent continuity across front and back cap curves.'
      });
    }
  }

  // 7. Endpoint Topology, Handedness & Orientation
  if (!endpoints.isEndpointTopologyValid) {
    checks.push({
      id: 'val-asm-endpoint-topology',
      category: 'geometry',
      name: 'Seam Endpoint, Handedness & Traversal Orientation',
      status: 'fail',
      message: `Seam topology validation failed: ${endpoints.reasons.join('; ')}`
    });
  } else {
    checks.push({
      id: 'val-asm-endpoint-topology',
      category: 'geometry',
      name: 'Seam Endpoint, Handedness & Traversal Orientation',
      status: 'pass',
      message: 'Verified seam endpoint junctions, sleeve handedness, shoulder consistency, traversal orientations, crown continuity, and underarm inseam parity.'
    });
  }

  // 8. Underarm Inseam Parity
  if (!endpoints.underarmInseamMatch.hasParity) {
    checks.push({
      id: 'val-asm-inseam-parity',
      category: 'seam-match',
      name: 'Sleeve Underarm Inseam Parity',
      status: 'fail',
      measuredValue: `Front: ${endpoints.underarmInseamMatch.frontInseamLengthCm.toFixed(2)} cm, Back: ${endpoints.underarmInseamMatch.backInseamLengthCm.toFixed(2)} cm (Delta: ${endpoints.underarmInseamMatch.parityDeltaCm.toFixed(3)} cm)`,
      expectedValue: 'Delta <= 0.05 cm',
      deviationCm: endpoints.underarmInseamMatch.parityDeltaCm,
      toleranceCm: 0.05,
      message: `Sleeve inseams differ by ${endpoints.underarmInseamMatch.parityDeltaCm.toFixed(3)} cm (> 0.05 cm). Will cause sleeve spiral twist.`
    });
  } else {
    checks.push({
      id: 'val-asm-inseam-parity',
      category: 'seam-match',
      name: 'Sleeve Underarm Inseam Parity',
      status: 'pass',
      measuredValue: `Delta: ${endpoints.underarmInseamMatch.parityDeltaCm.toFixed(3)} cm <= 0.05 cm`,
      message: 'Front and back underarm inseams match within 0.05 cm manufacturing parity.'
    });
  }

  // 9. Notch Correspondence (Crown, Front Scye, Back Double-Notches, Elbow Inseam Pair)
  if (!notches.isValid) {
    checks.push({
      id: 'val-asm-notch-correspondence',
      category: 'seam-match',
      name: 'Sleeve-Bodice & Elbow Notch Correspondence',
      status: 'fail',
      message: `Notch correspondence failure: ${notches.errors.join('; ')}`
    });
  } else {
    checks.push({
      id: 'val-asm-notch-correspondence',
      category: 'seam-match',
      name: 'Sleeve-Bodice & Elbow Notch Correspondence',
      status: 'pass',
      message: 'Front scye single notch, back scye double notches (pre-sort order & spacing), crown notch, and elbow inseam notches verified within strict tolerance.'
    });
  }

  // 10. Contour Integrity, Winding, Grainlines & Drill Holes
  if (extras?.contourIntegrity) {
    const ci = extras.contourIntegrity;
    checks.push({
      id: 'val-asm-contour-integrity',
      category: 'contour-integrity',
      name: 'Contour Closure, Winding, Grainlines & Drill Holes',
      status: ci.isValid ? 'pass' : 'fail',
      measuredValue: `F:${ci.windings.frontBodice} | B:${ci.windings.backBodice} | SLV:${ci.windings.sleeve}`,
      message: ci.isValid
        ? 'All three pattern piece contours are closed, non-self-intersecting, with valid grainlines and finite drill holes.'
        : `Contour or piece geometry integrity failed: ${ci.errors.join('; ')}`
    });
  }

  // 11. Governance & Measurement Provenance Check
  if (extras?.governance) {
    const gov = extras.governance;
    if (gov.isGovernanceApproved) {
      checks.push({
        id: 'val-asm-governance',
        category: 'geometry',
        name: 'Measurement Provenance & Sign-Off Governance',
        status: 'pass',
        measuredValue: `${gov.measurementProvenance} (${gov.measurementApprovalState})`,
        message: 'Approved design specification and approvable physically verified measurements recorded (isProductionReady remains false).'
      });
    } else {
      checks.push({
        id: 'val-asm-governance',
        category: 'geometry',
        name: 'Measurement Provenance & Sign-Off Governance',
        status: gov.requireApprovedGovernance ? 'fail' : 'warning',
        measuredValue: `${gov.measurementProvenance} (${gov.measurementApprovalState})`,
        message: `Production sign-off blocked: ${gov.blockingReasons.join('; ')}`
      });
    }
  }

  const passedCount = checks.filter(c => c.status === 'pass').length;
  const warningCount = checks.filter(c => c.status === 'warning').length;
  const failureCount = checks.filter(c => c.status === 'fail').length;
  const isValid = failureCount === 0;

  return {
    status: isValid ? 'validated' : 'invalid',
    isValid,
    isProductionReady: false, // Strictly false: unassessed 3D drape and wearer fit
    statusLabel: isValid ? 'ASSEMBLY_VERIFIED' : 'ASSEMBLY_INVALID',
    timestamp,
    passedCount,
    warningCount,
    failureCount,
    checks,
    unassessedConditions: UNASSESSED_ASSEMBLY_CONDITIONS,
    declaration: isValid
      ? 'Integrated Bodice-Sleeve Seam Assembly mathematically verified. Physical 3D cloth drape and wearer dynamic fit remain unassessed.'
      : 'Integrated Bodice-Sleeve Seam Assembly failed verification checks. Config, seam, uncertainty, notch, contour, or governance violations detected.'
  };
}
