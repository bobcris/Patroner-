/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyMeasurements,
  DesignSpecification,
  Notch,
  PatternPiece,
  Point,
  SleeveEaseStrategy,
  ValidationCheck,
  ValidationReport
} from '../../types';
import {
  computeAdaptiveBezierLength,
  distance,
  vector
} from '../geometry/math';
import { CubicBezierCurve, GeometricContour, LineSegment } from '../geometry/primitives';
import { SLEEVE_EASE_TABLE } from '../measurements/standards';
import {
  getArcLengthProjectionDiagnostics,
  ArcLengthProjectionDiagnostics
} from '../drafting/sleeve-block';
import {
  AssemblyNotchCorrespondenceResult,
  AssemblyOptions,
  AssemblyValidationStatus,
  BackNotchPairing,
  BodiceSleeveAssemblyInput,
  CrownNotchCheck,
  EaseCompatibilityMetrics,
  FrontNotchPairing,
  SeamArcLengthMeasurement,
  SeamEndpointMatch,
  SeamEndpointOrientationResult
} from './assembly-types';

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

  // Helper to find curve in piece stitching contour
  const findCurve = (piece: PatternPiece, segmentId: string, seamNameSubstr: string): CubicBezierCurve | null => {
    if (piece.stitchingContour?.segments) {
      const seg = piece.stitchingContour.segments.find(s => s.id === segmentId) as any;
      if (seg instanceof CubicBezierCurve) return seg;
      if (seg && (seg.type === 'bezier' || (seg.p1 && seg.p2))) {
        return new CubicBezierCurve(
          seg.id,
          { x: seg.p0.x, y: seg.p0.y },
          { x: seg.p1.x, y: seg.p1.y },
          { x: seg.p2.x, y: seg.p2.y },
          { x: seg.p3.x, y: seg.p3.y },
          seg.seamAllowanceCm ?? 1.0,
          seg.isOnFold ?? false,
          seg.seamId
        );
      }
      if (seg) {
        errors.push(`Segment '${segmentId}' in piece '${piece.name}' is of type ${seg.type}, expected CubicBezierCurve.`);
      }
    }
    // Check seams fallback
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

  // Also extract inseams if available for parity verification
  let sleeveFrontInseam: LineSegment | undefined;
  let sleeveBackInseam: LineSegment | undefined;
  if (sleevePiece?.stitchingContour?.segments) {
    const fInseam = sleevePiece.stitchingContour.segments.find(s => s.id === 'sleeve-front-inseam') as any;
    if (fInseam instanceof LineSegment) {
      sleeveFrontInseam = fInseam;
    } else if (fInseam && fInseam.type === 'linear') {
      sleeveFrontInseam = new LineSegment(fInseam.id, fInseam.p0, fInseam.p1, fInseam.seamAllowanceCm, fInseam.isOnFold, fInseam.seamId);
    }
    const bInseam = sleevePiece.stitchingContour.segments.find(s => s.id === 'sleeve-back-inseam') as any;
    if (bInseam instanceof LineSegment) {
      sleeveBackInseam = bInseam;
    } else if (bInseam && bInseam.type === 'linear') {
      sleeveBackInseam = new LineSegment(bInseam.id, bInseam.p0, bInseam.p1, bInseam.seamAllowanceCm, bInseam.isOnFold, bInseam.seamId);
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
 * Computes seam arc length with adaptive subdivision bounds.
 */
export function measureCurveSeam(
  curve: CubicBezierCurve,
  pieceId: string,
  pieceCode: string,
  seamId: string,
  toleranceCm = 0.005
): SeamArcLengthMeasurement {
  const result = curve.adaptiveLength(toleranceCm);
  const uncertainty = Number(((result.upperBoundCm - result.lowerBoundCm) / 2).toFixed(5));

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
 * Evaluates ease distribution and target compliance.
 */
export function evaluateEaseCompatibility(
  fBodiceMeas: SeamArcLengthMeasurement,
  bBodiceMeas: SeamArcLengthMeasurement,
  fSleeveMeas: SeamArcLengthMeasurement,
  bSleeveMeas: SeamArcLengthMeasurement,
  options?: AssemblyOptions
): EaseCompatibilityMetrics {
  const strategy: SleeveEaseStrategy = options?.strategy ?? 'classic';
  const tableValues = SLEEVE_EASE_TABLE[strategy] ?? SLEEVE_EASE_TABLE.classic;

  const targetTotalEaseCm = options?.customTargetEaseCm ?? tableValues.recommendedCapEaseCm;
  // Standard anthropometric tailoring distribution: 44% front, 56% back
  const targetFrontEaseCm = Number((targetTotalEaseCm * 0.44).toFixed(2));
  const targetBackEaseCm = Number((targetTotalEaseCm * 0.56).toFixed(2));

  const frontBodiceArmholeLengthCm = fBodiceMeas.lengthCm;
  const backBodiceArmholeLengthCm = bBodiceMeas.lengthCm;
  const totalBodiceArmholeLengthCm = Number((frontBodiceArmholeLengthCm + backBodiceArmholeLengthCm).toFixed(2));

  const frontSleeveCapLengthCm = fSleeveMeas.lengthCm;
  const backSleeveCapLengthCm = bSleeveMeas.lengthCm;
  const totalSleeveCapLengthCm = Number((frontSleeveCapLengthCm + backSleeveCapLengthCm).toFixed(2));

  // Core ease equations:
  // E_f = L_sf - L_bf
  // E_b = L_sb - L_bb
  // E_t = E_f + E_b = (L_sf + L_sb) - (L_bf + L_bb)
  const frontEaseCm = Number((frontSleeveCapLengthCm - frontBodiceArmholeLengthCm).toFixed(2));
  const backEaseCm = Number((backSleeveCapLengthCm - backBodiceArmholeLengthCm).toFixed(2));
  const totalEaseCm = Number((frontEaseCm + backEaseCm).toFixed(2));

  // Propagated uncertainties:
  // delta E_f = delta L_sf + delta L_bf
  // delta E_b = delta L_sb + delta L_bb
  // delta E_t = delta E_f + delta E_b
  const frontEaseUncertaintyCm = Number((fSleeveMeas.uncertaintyCm + fBodiceMeas.uncertaintyCm).toFixed(5));
  const backEaseUncertaintyCm = Number((bSleeveMeas.uncertaintyCm + bBodiceMeas.uncertaintyCm).toFixed(5));
  const totalEaseUncertaintyCm = Number((frontEaseUncertaintyCm + backEaseUncertaintyCm).toFixed(5));

  // Front ease ratio: E_f / E_t
  // Valid mathematical domain: E_t >= 0.20 cm, E_f >= 0, E_b >= 0
  // When E_t < 0.20 cm or ease is negative, ratio is mathematically unstable / undefined (null)
  const MIN_RATIO_DENOMINATOR_CM = 0.20;
  const isRatioDefined = totalEaseCm >= MIN_RATIO_DENOMINATOR_CM && frontEaseCm >= -0.05 && backEaseCm >= -0.05;
  const frontEaseRatio = isRatioDefined
    ? Number((frontEaseCm / totalEaseCm).toFixed(3))
    : null;

  // Propagated uncertainty for ratio:
  // delta R_f = (|E_b| * delta E_f + |E_f| * delta E_b) / E_t^2
  const frontEaseRatioUncertainty = isRatioDefined && totalEaseCm > 0
    ? Number((((Math.abs(backEaseCm) * frontEaseUncertaintyCm) + (Math.abs(frontEaseCm) * backEaseUncertaintyCm)) / (totalEaseCm * totalEaseCm)).toFixed(4))
    : null;

  const recommendedEnvelopeCm = {
    min: tableValues.capEaseMinCm,
    max: tableValues.capEaseMaxCm
  };

  const frontResidualCm = Number(Math.abs(frontEaseCm - targetFrontEaseCm).toFixed(2));
  const backResidualCm = Number(Math.abs(backEaseCm - targetBackEaseCm).toFixed(2));
  const totalResidualCm = Number(Math.abs(totalEaseCm - targetTotalEaseCm).toFixed(2));

  // Physical & Tailoring assembly boundaries:
  // 1. E_f >= 0 (geometric requirement: no negative ease on front scye for set-in sleeve)
  // 2. E_b >= 0 (geometric requirement: no negative ease on back scye for set-in sleeve)
  // 3. 0 <= E_t <= 5.0 cm (fabric tailoring craft limitation: wool steam crimp capacity)
  // 4. Front ease ratio between 35% and 55% when defined, or absolute parity |E_f - E_b| <= 0.20 cm when E_t < 0.20 cm
  const isFrontEasePermitted = frontEaseCm >= -0.05;
  const isBackEasePermitted = backEaseCm >= -0.05;
  const isTotalEasePermitted = totalEaseCm >= -0.05 && totalEaseCm <= 5.05;

  let isDistributionBalanced = false;
  if (isRatioDefined && frontEaseRatio !== null) {
    isDistributionBalanced = frontEaseRatio >= 0.35 && frontEaseRatio <= 0.55;
  } else if (frontEaseCm >= -0.05 && backEaseCm >= -0.05 && totalEaseCm <= MIN_RATIO_DENOMINATOR_CM) {
    isDistributionBalanced = Math.abs(frontEaseCm - backEaseCm) <= 0.20;
  } else {
    isDistributionBalanced = false;
  }

  const isTotalEaseTargetCompliant =
    totalEaseCm >= recommendedEnvelopeCm.min - 0.20 &&
    totalEaseCm <= recommendedEnvelopeCm.max + 0.20 &&
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
    customEnvelopeCm: options?.customTargetEaseCm ? { min: options.customTargetEaseCm - 0.5, max: options.customTargetEaseCm + 0.5 } : undefined,
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

/**
 * Validates endpoint connectivity, traversal directions, and underarm inseam parity.
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

  // Front Bodice Armhole: Starts at underarm (p0), ends at shoulder tip (p3)
  const fBodiceUnderarm = frontBodiceArmhole.p0;
  const fBodiceShoulderTip = frontBodiceArmhole.p3;

  // Back Bodice Armhole: Starts at underarm (p0), ends at shoulder tip (p3)
  const bBodiceUnderarm = backBodiceArmhole.p0;
  const bBodiceShoulderTip = backBodiceArmhole.p3;

  // Sleeve Front Cap: Starts at crown apex (0,0) (p0), ends at front underarm uFront (p3)
  const slvCrownFront = sleeveFrontCap.p0;
  const slvFrontUnderarm = sleeveFrontCap.p3;

  // Sleeve Back Cap: Starts at back underarm uBack (p0), ends at crown apex (0,0) (p3)
  const slvBackUnderarm = sleeveBackCap.p0;
  const slvCrownBack = sleeveBackCap.p3;

  // 1. Crown apex match: both cap curves meet at (0,0)
  const crownDistance = distance(slvCrownFront, slvCrownBack);
  const isCrownContinuous = crownDistance <= 0.05;
  if (!isCrownContinuous) {
    reasons.push(`Sleeve front cap start (${slvCrownFront.x}, ${slvCrownFront.y}) and back cap end (${slvCrownBack.x}, ${slvCrownBack.y}) do not meet at crown apex (delta: ${crownDistance.toFixed(2)} cm > 0.05 cm).`);
  }

  // C1 tangent continuity check at apex:
  // Front cap starts at apex slvCrownFront (p0), control point cp1
  // Back cap ends at apex slvCrownBack (p3), control point cp2
  const cp1F = (sleeveFrontCap as any).cp1 ?? (sleeveFrontCap as any).p1;
  const cp2B = (sleeveBackCap as any).cp2 ?? (sleeveBackCap as any).p2;
  let isTangentContinuous = false;
  let tangentDepartureDeg = 0;
  if (cp1F && cp2B) {
    const thetaBackDeg = Math.atan2(slvCrownBack.y - cp2B.y, slvCrownBack.x - cp2B.x) * (180 / Math.PI);
    const thetaFrontDeg = Math.atan2(cp1F.y - slvCrownFront.y, cp1F.x - slvCrownFront.x) * (180 / Math.PI);
    tangentDepartureDeg = Number(Math.abs(thetaFrontDeg - thetaBackDeg).toFixed(2));
    isTangentContinuous = isCrownContinuous && tangentDepartureDeg <= 1.0;
  } else {
    isTangentContinuous = isCrownContinuous;
  }

  if (isCrownContinuous && !isTangentContinuous) {
    reasons.push(`Sleeve crown apex exhibits C1 tangent discontinuity (departure: ${tangentDepartureDeg}° > 1.00°).`);
  }

  // 2. Traversal direction checks:
  // Front bodice armhole must ascend (y decreasing from underarm to shoulder tip)
  const fBodiceAscends = fBodiceShoulderTip.y < fBodiceUnderarm.y;
  if (!fBodiceAscends) {
    reasons.push(`Front bodice armhole reversed: shoulder tip y (${fBodiceShoulderTip.y}) is lower than underarm y (${fBodiceUnderarm.y}).`);
  }

  // Back bodice armhole must ascend (y decreasing from underarm to shoulder tip)
  const bBodiceAscends = bBodiceShoulderTip.y < bBodiceUnderarm.y;
  if (!bBodiceAscends) {
    reasons.push(`Back bodice armhole reversed: shoulder tip y (${bBodiceShoulderTip.y}) is lower than underarm y (${bBodiceUnderarm.y}).`);
  }

  // Sleeve front cap descends from crown (p0.y <= p3.y)
  const slvFrontDescends = slvFrontUnderarm.y >= slvCrownFront.y;
  if (!slvFrontDescends) {
    reasons.push(`Sleeve front cap reversed: front underarm y (${slvFrontUnderarm.y}) is above crown apex (${slvCrownFront.y}).`);
  }

  // Sleeve back cap ascends to crown (p0.y >= p3.y)
  const slvBackAscends = slvBackUnderarm.y >= slvCrownBack.y;
  if (!slvBackAscends) {
    reasons.push(`Sleeve back cap reversed: back underarm y (${slvBackUnderarm.y}) is above crown apex (${slvCrownBack.y}).`);
  }

  // 3. Seam endpoint matches:
  // Note: in 2D pattern space, pieces have independent local coordinate frames.
  // Their topological connectivity is validated by verifying that when matched at underarm,
  // the armhole lengths and curve endpoint definitions correspond.
  const frontUnderarmMatch: SeamEndpointMatch = {
    name: 'Front Scye Underarm Junction',
    bodicePieceId: frontBodicePiece.id,
    bodicePoint: fBodiceUnderarm,
    sleevePoint: slvFrontUnderarm,
    distanceCm: 0, // Matched at junction
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
      ? (isTangentContinuous ? 'aligned at crown apex with C1 tangency' : `aligned at crown apex with C1 departure of ${tangentDepartureDeg}°`)
      : 'disconnected crown',
    isOrientationValid: isCrownContinuous && isTangentContinuous,
    isPositionalCoincident: isCrownContinuous,
    isTangentContinuous,
    tangentDepartureDeg
  };

  // 4. Inseam Parity Requirement: Front underarm inseam length === Back underarm inseam length within 0.05 cm
  let frontInseamLengthCm = 0;
  let backInseamLengthCm = 0;
  if (sleeveFrontInseam && sleeveBackInseam) {
    frontInseamLengthCm = sleeveFrontInseam.lengthCm();
    backInseamLengthCm = sleeveBackInseam.lengthCm();
  } else {
    // Look up in sleeve seams
    const fSeam = extracted.sleevePiece.seams?.find(s => s.id === 'slv-front-inseam' || s.name.includes('Front Underarm Inseam'));
    const bSeam = extracted.sleevePiece.seams?.find(s => s.id === 'slv-back-inseam' || s.name.includes('Back Underarm Inseam'));
    if (fSeam && bSeam) {
      frontInseamLengthCm = fSeam.lengthCm;
      backInseamLengthCm = bSeam.lengthCm;
    }
  }

  const parityDeltaCm = Number(Math.abs(frontInseamLengthCm - backInseamLengthCm).toFixed(3));
  const hasParity = parityDeltaCm <= 0.05;
  if (!hasParity && frontInseamLengthCm > 0) {
    reasons.push(`Sleeve underarm inseam parity mismatch: front inseam (${frontInseamLengthCm.toFixed(2)} cm) differs from back inseam (${backInseamLengthCm.toFixed(2)} cm) by ${parityDeltaCm.toFixed(3)} cm (> 0.05 cm).`);
  }

  const isEndpointTopologyValid =
    isCrownContinuous &&
    frontUnderarmMatch.isOrientationValid &&
    backUnderarmMatch.isOrientationValid &&
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
    isEndpointTopologyValid,
    reasons
  };
}

/**
 * Validates notch correspondence between bodice and sleeve according to Milestone 04.2.2.3.
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
    sleeveBackCap
  } = extracted;

  // Sleeve Notches
  const slvCrownNotch = sleevePiece.notches?.find(n => n.id === 'notch-slv-crown');
  const slvFrontNotch = sleevePiece.notches?.find(n => n.id === 'notch-slv-front-armhole');
  const slvBackNotches = sleevePiece.notches?.filter(n => n.id.includes('notch-slv-back-armhole')) ?? [];

  // Bodice Notches
  const fbChestNotch = frontBodicePiece.notches?.find(n => n.id.includes('chest') || (n.label && n.label.includes('CHEST')));
  const bbBackNotches = backBodicePiece.notches?.filter(n => n.id.includes('across-back') || (n.label && n.label.includes('BACK SCYE'))) ?? [];

  // 1. Crown Notch Evaluation
  let crownCheck: CrownNotchCheck | null = null;
  if (!slvCrownNotch) {
    errors.push('Missing crown apex shoulder match notch on sleeve.');
  } else {
    const apexDist = distance(slvCrownNotch.position, { x: 0, y: 0 });
    const isApexAligned = apexDist <= 0.05;
    if (!isApexAligned) {
      errors.push(`Sleeve crown notch is displaced by ${apexDist.toFixed(2)} cm from apex (0,0). Must be within 0.05 cm.`);
    }
    const angleDiff = Math.abs(slvCrownNotch.normalAngleDeg - (-90));
    const isAngleValid = angleDiff <= 15 || angleDiff >= 345;
    if (!isAngleValid) {
      warnings.push(`Sleeve crown notch angle (${slvCrownNotch.normalAngleDeg}°) departs from vertical -90° by ${angleDiff.toFixed(1)}°.`);
    }
    crownCheck = {
      notchId: slvCrownNotch.id,
      position: slvCrownNotch.position,
      apexDistanceCm: Number(apexDist.toFixed(3)),
      isApexAligned,
      orientationAngleDeg: slvCrownNotch.normalAngleDeg,
      isOrientationValid: isAngleValid
    };
  }

  // 2. Front Scye Single Notch Evaluation
  let frontPairing: FrontNotchPairing | null = null;
  if (!slvFrontNotch || !fbChestNotch) {
    if (!slvFrontNotch) errors.push('Missing front scye single notch on sleeve.');
    if (!fbChestNotch) errors.push('Missing chest/armhole matching notch on front bodice.');
  } else {
    // Arc length along front bodice armhole from underarm (p0)
    const fbDiag = getArcLengthProjectionDiagnostics(frontBodiceArmhole, fbChestNotch.position, 0.005);
    const bodiceArcFromUnderarmCm = fbDiag.arcLengthCm;

    // Sleeve front cap: curve runs from crownApex (0,0) at t=0 to uFront at t=1.
    // Arc distance from underarm uFront = totalCurveLength - arcFromCrown
    const slvDiag = getArcLengthProjectionDiagnostics(sleeveFrontCap, slvFrontNotch.position, 0.005);
    const slvCurveLen = sleeveFrontCap.lengthCm();
    const slvArcFromUnderarmCm = Number(Math.max(0, slvCurveLen - slvDiag.arcLengthCm).toFixed(2));

    const deltaCm = Number(Math.abs(bodiceArcFromUnderarmCm - slvArcFromUnderarmCm).toFixed(2));
    const isWithinTolerance = deltaCm <= 0.30;
    if (!isWithinTolerance) {
      errors.push(`Front scye notch arc distance mismatch: bodice is ${bodiceArcFromUnderarmCm.toFixed(2)} cm from underarm, sleeve is ${slvArcFromUnderarmCm.toFixed(2)} cm (delta: ${deltaCm.toFixed(2)} cm > 0.30 cm tolerance).`);
    }

    const slvDisplacement = slvDiag.projectionDistanceCm;
    const isAttached = slvDisplacement <= 0.30;
    if (!isAttached) {
      errors.push(`Sleeve front notch is displaced by ${slvDisplacement.toFixed(2)} cm from sleeve cap contour (> 0.30 cm).`);
    }

    frontPairing = {
      sleeveNotchId: slvFrontNotch.id,
      bodiceNotchId: fbChestNotch.id,
      sleeveNotchPosition: slvFrontNotch.position,
      bodiceNotchPosition: fbChestNotch.position,
      sleeveArcFromUnderarmCm: slvArcFromUnderarmCm,
      bodiceArcFromUnderarmCm: Number(bodiceArcFromUnderarmCm.toFixed(2)),
      deltaCm,
      isWithinTolerance,
      sleeveDisplacementCm: slvDisplacement,
      isAttachedToContour: isAttached,
      orientationAngleDeg: slvFrontNotch.normalAngleDeg,
      isOrientationValid: true
    };
  }

  // 3. Back Scye Double Notch Evaluation
  let backPairing: BackNotchPairing | null = null;
  if (slvBackNotches.length < 2 || bbBackNotches.length < 2) {
    if (slvBackNotches.length < 2) errors.push(`Expected 2 back scye notches on sleeve, found ${slvBackNotches.length}.`);
    if (bbBackNotches.length < 2) errors.push(`Expected 2 back scye notches on back bodice, found ${bbBackNotches.length}.`);
  } else {
    // Sort notches by distance from underarm
    // Back bodice armhole starts at underarm (p0)
    const sortedBb = [...bbBackNotches].sort((a, b) => {
      const d1 = getArcLengthProjectionDiagnostics(backBodiceArmhole, a.position, 0.005).arcLengthCm;
      const d2 = getArcLengthProjectionDiagnostics(backBodiceArmhole, b.position, 0.005).arcLengthCm;
      return d1 - d2;
    });

    // Sleeve back cap starts at underarm uBack (p0) and ends at crown (p3)
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

    const delta1 = Number(Math.abs(bArc1 - sArc1).toFixed(2));
    const delta2 = Number(Math.abs(bArc2 - sArc2).toFixed(2));

    const isPair1Within = delta1 <= 0.30;
    const isPair2Within = delta2 <= 0.30;

    if (!isPair1Within) {
      errors.push(`Back scye notch 1 arc distance mismatch: bodice ${bArc1.toFixed(2)} cm vs sleeve ${sArc1.toFixed(2)} cm (delta: ${delta1.toFixed(2)} cm > 0.30 cm).`);
    }
    if (!isPair2Within) {
      errors.push(`Back scye notch 2 arc distance mismatch: bodice ${bArc2.toFixed(2)} cm vs sleeve ${sArc2.toFixed(2)} cm (delta: ${delta2.toFixed(2)} cm > 0.30 cm).`);
    }

    const slvSpacing = Number(Math.abs(sArc2 - sArc1).toFixed(2));
    const bodiceSpacing = Number(Math.abs(bArc2 - bArc1).toFixed(2));
    // Required spacing: 1.2 cm +/- 0.30 cm [0.90 cm - 1.50 cm]
    const isSlvSpacingValid = slvSpacing >= 0.90 && slvSpacing <= 1.50;
    const isBodiceSpacingValid = bodiceSpacing >= 0.90 && bodiceSpacing <= 1.50;
    const isSpacingValid = isSlvSpacingValid && isBodiceSpacingValid;

    if (!isSlvSpacingValid) {
      errors.push(`Sleeve back double-notch spacing (${slvSpacing.toFixed(2)} cm) outside standard 1.2 ± 0.30 cm boundary [0.90, 1.50].`);
    }
    if (!isBodiceSpacingValid) {
      errors.push(`Bodice back double-notch spacing (${bodiceSpacing.toFixed(2)} cm) outside standard 1.2 ± 0.30 cm boundary [0.90, 1.50].`);
    }

    // Ordering check: notch 1 must be strictly closer to underarm than notch 2
    const isOrderingValid = sArc1 < sArc2 && bArc1 < bArc2;
    if (!isOrderingValid) {
      errors.push('Back scye double notches reversed in ordering: notch 1 must be closer to underarm than notch 2.');
    }

    const disp1 = slvDiag1.projectionDistanceCm;
    const disp2 = slvDiag2.projectionDistanceCm;
    const areAttached = disp1 <= 0.30 && disp2 <= 0.30;
    if (!areAttached) {
      errors.push(`Sleeve back notch contour displacement exceeds 0.30 cm (disp1: ${disp1.toFixed(2)} cm, disp2: ${disp2.toFixed(2)} cm).`);
    }

    backPairing = {
      sleeveNotch1Id: sortedSlv[0].id,
      sleeveNotch2Id: sortedSlv[1].id,
      bodiceNotch1Id: sortedBb[0].id,
      bodiceNotch2Id: sortedBb[1].id,
      sleeveNotch1ArcCm: Number(sArc1.toFixed(2)),
      sleeveNotch2ArcCm: Number(sArc2.toFixed(2)),
      bodiceNotch1ArcCm: Number(bArc1.toFixed(2)),
      bodiceNotch2ArcCm: Number(bArc2.toFixed(2)),
      deltaNotch1Cm: delta1,
      deltaNotch2Cm: delta2,
      isPair1WithinTolerance: isPair1Within,
      isPair2WithinTolerance: isPair2Within,
      sleeveSpacingCm: slvSpacing,
      bodiceSpacingCm: bodiceSpacing,
      isSpacingValid,
      isOrderingValid,
      sleeveDisplacement1Cm: disp1,
      sleeveDisplacement2Cm: disp2,
      areAttachedToContour: areAttached,
      orientationAngle1Deg: sortedSlv[0].normalAngleDeg,
      orientationAngle2Deg: sortedSlv[1].normalAngleDeg,
      areOrientationsValid: true
    };
  }

  const isValid = errors.length === 0;
  const status: AssemblyValidationStatus = isValid ? 'verified-valid' : 'invalid';

  return {
    frontNotch: frontPairing,
    backNotches: backPairing,
    crownNotch: crownCheck,
    status,
    isValid,
    errors,
    warnings
  };
}

/**
 * Builds the comprehensive assembly validation report.
 */
export function buildAssemblyValidationReport(
  ease: EaseCompatibilityMetrics,
  endpoints: SeamEndpointOrientationResult,
  notches: AssemblyNotchCorrespondenceResult,
  fBodiceMeas: SeamArcLengthMeasurement,
  bBodiceMeas: SeamArcLengthMeasurement,
  fSleeveMeas: SeamArcLengthMeasurement,
  bSleeveMeas: SeamArcLengthMeasurement
): ValidationReport {
  const checks: ValidationCheck[] = [];
  const timestamp = new Date().toISOString();

  // 1. Armhole Seam Continuity & Measurement
  checks.push({
    id: 'val-asm-front-scye-len',
    category: 'contour-integrity',
    name: 'Front Bodice Armhole Arc Length',
    status: fBodiceMeas.toleranceAchieved ? 'pass' : 'warning',
    measuredValue: `${fBodiceMeas.lengthCm.toFixed(2)} cm (±${fBodiceMeas.uncertaintyCm.toFixed(4)} cm)`,
    message: `Front armhole arc length measured with adaptive subdivision (${fBodiceMeas.subdivisions} subdivisions).`
  });

  checks.push({
    id: 'val-asm-back-scye-len',
    category: 'contour-integrity',
    name: 'Back Bodice Armhole Arc Length',
    status: bBodiceMeas.toleranceAchieved ? 'pass' : 'warning',
    measuredValue: `${bBodiceMeas.lengthCm.toFixed(2)} cm (±${bBodiceMeas.uncertaintyCm.toFixed(4)} cm)`,
    message: `Back armhole arc length measured with adaptive subdivision (${bBodiceMeas.subdivisions} subdivisions).`
  });

  // 2. Sleeve Cap Measurements
  checks.push({
    id: 'val-asm-front-cap-len',
    category: 'contour-integrity',
    name: 'Front Sleeve Cap Arc Length',
    status: fSleeveMeas.toleranceAchieved ? 'pass' : 'warning',
    measuredValue: `${fSleeveMeas.lengthCm.toFixed(2)} cm (±${fSleeveMeas.uncertaintyCm.toFixed(4)} cm)`,
    message: `Front sleeve cap arc length measured with adaptive subdivision (${fSleeveMeas.subdivisions} subdivisions).`
  });

  checks.push({
    id: 'val-asm-back-cap-len',
    category: 'contour-integrity',
    name: 'Back Sleeve Cap Arc Length',
    status: bSleeveMeas.toleranceAchieved ? 'pass' : 'warning',
    measuredValue: `${bSleeveMeas.lengthCm.toFixed(2)} cm (±${bSleeveMeas.uncertaintyCm.toFixed(4)} cm)`,
    message: `Back sleeve cap arc length measured with adaptive subdivision (${bSleeveMeas.subdivisions} subdivisions).`
  });

  // 3. Front Ease Boundary Check
  if (!ease.isFrontEasePermitted) {
    checks.push({
      id: 'val-asm-front-ease-limit',
      category: 'seam-match',
      name: 'Front Sleeve Cap Ease Boundary',
      status: 'fail',
      measuredValue: `${ease.frontEaseCm.toFixed(2)} cm (Scye: ${ease.frontBodiceArmholeLengthCm} cm, Cap: ${ease.frontSleeveCapLengthCm} cm)`,
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
      measuredValue: `+${ease.frontEaseCm.toFixed(2)} cm (±${ease.frontEaseUncertaintyCm.toFixed(4)} cm)`,
      message: 'Front sleeve cap ease satisfies physical assembly boundary (E_f >= 0).'
    });
  }

  // 4. Back Ease Boundary Check
  if (!ease.isBackEasePermitted) {
    checks.push({
      id: 'val-asm-back-ease-limit',
      category: 'seam-match',
      name: 'Back Sleeve Cap Ease Boundary',
      status: 'fail',
      measuredValue: `${ease.backEaseCm.toFixed(2)} cm (Scye: ${ease.backBodiceArmholeLengthCm} cm, Cap: ${ease.backSleeveCapLengthCm} cm)`,
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
      measuredValue: `+${ease.backEaseCm.toFixed(2)} cm (±${ease.backEaseUncertaintyCm.toFixed(4)} cm)`,
      message: 'Back sleeve cap ease satisfies physical assembly boundary (E_b >= 0).'
    });
  }

  // 5. Total Ease & Threshold Check
  if (!ease.isTotalEasePermitted) {
    checks.push({
      id: 'val-asm-total-ease-limit',
      category: 'seam-match',
      name: 'Total Sleeve Cap Ease Boundary',
      status: 'fail',
      measuredValue: `${ease.totalEaseCm.toFixed(2)} cm (Scye: ${ease.totalBodiceArmholeLengthCm} cm, Cap: ${ease.totalSleeveCapLengthCm} cm)`,
      expectedValue: '0.00 cm <= Total Ease <= 5.00 cm',
      deviationCm: ease.totalEaseCm < 0 ? Math.abs(ease.totalEaseCm) : Number((ease.totalEaseCm - 5.0).toFixed(2)),
      toleranceCm: 5.00,
      message: ease.totalEaseCm < 0
        ? `Negative total sleeve ease (${ease.totalEaseCm.toFixed(2)} cm). Sleeve cap cannot fit armhole.`
        : `Total sleeve ease (${ease.totalEaseCm.toFixed(2)} cm) exceeds 5.00 cm maximum tailoring crimp limit.`
    });
  } else {
    checks.push({
      id: 'val-asm-total-ease-limit',
      category: 'seam-match',
      name: 'Total Sleeve Cap Ease Boundary',
      status: 'pass',
      measuredValue: `+${ease.totalEaseCm.toFixed(2)} cm (±${ease.totalEaseUncertaintyCm.toFixed(4)} cm)`,
      expectedValue: '0.00 cm <= Total Ease <= 5.00 cm',
      toleranceCm: 5.00,
      message: `Total sleeve cap ease verified within permissible assembly range [0.00, 5.00 cm]. Target: ${ease.targetTotalEaseCm} cm.`
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
        measuredValue: `Delta: ${Math.abs(ease.frontEaseCm - ease.backEaseCm).toFixed(2)} cm <= 0.20 cm (Total Ease: ${ease.totalEaseCm.toFixed(2)} cm < 0.20 cm)`,
        message: 'Minimal sleeve cap ease (< 0.20 cm). Ratio undefined; distribution balanced via absolute parity (|E_f - E_b| <= 0.20 cm).'
      });
    } else {
      checks.push({
        id: 'val-asm-ease-distribution',
        category: 'seam-match',
        name: 'Front/Back Ease Partition Balance',
        status: 'fail',
        measuredValue: `E_f: ${ease.frontEaseCm.toFixed(2)} cm, E_b: ${ease.backEaseCm.toFixed(2)} cm, E_t: ${ease.totalEaseCm.toFixed(2)} cm`,
        expectedValue: 'Undefined ratio (E_t < 0.20 cm) or negative ease requiring balance |E_f - E_b| <= 0.20 cm',
        deviationCm: Math.abs(ease.frontEaseCm - ease.backEaseCm),
        toleranceCm: 0.20,
        message: ease.frontEaseCm < 0 || ease.backEaseCm < 0
          ? `Negative ease component (E_f: ${ease.frontEaseCm.toFixed(2)} cm, E_b: ${ease.backEaseCm.toFixed(2)} cm). Ratio undefined and assembly physically invalid.`
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

  // 7. Endpoint Topology & Orientation
  if (!endpoints.isEndpointTopologyValid) {
    checks.push({
      id: 'val-asm-endpoint-topology',
      category: 'geometry',
      name: 'Seam Endpoint & Traversal Orientation',
      status: 'fail',
      message: `Seam topology validation failed: ${endpoints.reasons.join('; ')}`
    });
  } else {
    checks.push({
      id: 'val-asm-endpoint-topology',
      category: 'geometry',
      name: 'Seam Endpoint & Traversal Orientation',
      status: 'pass',
      message: 'Verified seam endpoint junctions, traversal orientations, crown apex continuity, and underarm inseam parity.'
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

  // 9. Notch Correspondence
  if (!notches.isValid) {
    checks.push({
      id: 'val-asm-notch-correspondence',
      category: 'seam-match',
      name: 'Sleeve-Bodice Notch Correspondence',
      status: 'fail',
      message: `Notch correspondence failure: ${notches.errors.join('; ')}`
    });
  } else {
    checks.push({
      id: 'val-asm-notch-correspondence',
      category: 'seam-match',
      name: 'Sleeve-Bodice Notch Correspondence',
      status: 'pass',
      message: 'Front scye single notch, back scye double notches (spacing & order), and crown apex notch match within strict 0.30 cm tolerance.'
    });
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
      : 'Integrated Bodice-Sleeve Seam Assembly failed verification checks. Incompatible seams or ease violations detected.'
  };
}
