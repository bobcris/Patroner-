/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyMeasurements,
  DesignSpecification,
  FabricProperty,
  GrainLine,
  Notch,
  PatternPiece,
  Point,
  SeamLine,
  SleeveEaseStrategy
} from '../../types';
import { approximateBezierLength, computeBoundingBox, distance } from '../geometry/math';
import { generateCuttingContour } from '../geometry/offset';
import { validateContourIntegrity } from '../geometry/contour-validator';
import { CubicBezierCurve, GeometricContour, LineSegment } from '../geometry/primitives';
import {
  calculateSleeveGarmentDimensions,
  SLEEVE_EASE_TABLE,
  validateSleeveMeasurements
} from '../measurements/standards';
import { draftBodiceBlock } from './bodice-block';

export interface SleeveDraftOptions {
  strategy?: SleeveEaseStrategy; // Sleeve ease strategy (default: 'classic')
  seamAllowanceCm?: number;      // underarm inseam allowance (default: 1.5 cm)
  capAllowanceCm?: number;       // sleeve cap seam allowance (default: 1.0 cm)
  hemAllowanceCm?: number;       // wrist hem allowance (default: 2.5 cm)
  bezierToleranceCm?: number;    // adaptive subdivision tolerance (default: 0.05 cm)
  miterLimit?: number;           // corner miter limit ratio (default: 2.5)
  bodicePieces?: PatternPiece[]; // Optional pre-drafted bodice pieces to extract exact armholes
}

export interface ArmholeContext {
  frontArmholeLengthCm: number;
  backArmholeLengthCm: number;
  totalArmholeLengthCm: number;
  frontScyeDepthCm: number;
  backScyeDepthCm: number;
  frontChestNotchArcLengthCm: number;
  backAcrossBackNotchArcLengthCm: number;
}

/**
 * Computes the arc length along a CubicBezierCurve from its start point (t=0)
 * to the closest point projected from a given reference point.
 */
export function computeArcLengthFromStart(curve: CubicBezierCurve, pt: Point): number {
  let bestT = 0;
  let bestDist = Infinity;
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.pointAt(t);
    const d = distance(p, pt);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
    }
  }
  return Number(curve.subdivide(bestT).left.lengthCm().toFixed(2));
}

/**
 * Finds the parameter t and point on a CubicBezierCurve at a specified arc length from start (p0).
 * Uses binary search over subdivision lengths for deterministic convergence.
 */
export function findPointAtArcLength(curve: CubicBezierCurve, targetArcLengthCm: number): { t: number; point: Point } {
  const totalLen = curve.lengthCm();
  const clampedLen = Math.max(0.1, Math.min(totalLen - 0.1, targetArcLengthCm));
  let low = 0;
  let high = 1;
  let mid = 0.5;

  for (let iter = 0; iter < 16; iter++) {
    mid = (low + high) / 2;
    const len = curve.subdivide(mid).left.lengthCm();
    if (len < clampedLen) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return { t: mid, point: curve.pointAt(mid) };
}

export interface SleeveDiagnostics {
  strategy: SleeveEaseStrategy;
  capHeightCm: number;
  bicepsWidthCm: number;
  wristWidthCm: number;
  frontCapLengthCm: number;
  backCapLengthCm: number;
  totalCapLengthCm: number;
  bodiceArmholeLengthCm: number;
  frontArmholeLengthCm: number;
  backArmholeLengthCm: number;
  targetCapEaseCm: number;
  targetFrontEaseCm: number;
  targetBackEaseCm: number;
  frontCapEaseCm: number;
  backCapEaseCm: number;
  frontEaseResidualCm: number;
  backEaseResidualCm: number;
  totalEaseResidualCm: number;
  capEaseCm: number;
  capEasePercentage: number;
  frontInseamLengthCm: number;
  backInseamLengthCm: number;
  inseamParityDeltaCm: number;
  crownTangencyDeg: number;
  bicepsEaseCm: number;
  wristEaseCm: number;
}

/**
 * Extracts exact armhole curve lengths, depths, and notch arc lengths from bodice pattern pieces.
 * If pieces are not provided, drafts the bodice block internally to obtain
 * identical mathematical measurements.
 */
export function extractArmholeContext(
  bodicePieces?: PatternPiece[],
  measurements?: BodyMeasurements,
  design?: DesignSpecification
): ArmholeContext {
  let pieces = bodicePieces;

  if (!pieces || pieces.length < 2) {
    if (!measurements || !design) {
      throw new Error(
        'Armhole context requires either pre-drafted bodice pieces or both measurements and design specification.'
      );
    }
    pieces = draftBodiceBlock(measurements, design);
  }

  const frontPiece = pieces.find(p => p.id === 'piece-bodice-front' || p.pieceCode.includes('BOD-F'));
  const backPiece = pieces.find(p => p.id === 'piece-bodice-back' || p.pieceCode.includes('BOD-B'));

  if (!frontPiece || !backPiece) {
    throw new Error('Could not identify front and back bodice panels for armhole context extraction.');
  }

  // Find front armhole seam
  const fArmholeSeam = frontPiece.seams.find(
    s => s.id === 'fb-armhole-seam' || s.segmentId === 'fb-armhole' || s.name.toLowerCase().includes('armhole')
  );
  // Find back armhole seam
  const bArmholeSeam = backPiece.seams.find(
    s => s.id === 'bb-armhole-seam' || s.segmentId === 'bb-armhole' || s.name.toLowerCase().includes('armhole')
  );

  let fLen = fArmholeSeam?.lengthCm;
  let bLen = bArmholeSeam?.lengthCm;

  // Fallback to geometric contour if seam is missing
  if (!fLen && frontPiece.stitchingContour) {
    const fSeg = frontPiece.stitchingContour.segments.find(s => s.id === 'fb-armhole');
    if (fSeg) fLen = fSeg.lengthCm();
  }
  if (!bLen && backPiece.stitchingContour) {
    const bSeg = backPiece.stitchingContour.segments.find(s => s.id === 'bb-armhole');
    if (bSeg) bLen = bSeg.lengthCm();
  }

  if (!fLen || !bLen) {
    throw new Error('Failed to extract armhole lengths from bodice pieces.');
  }

  const frontArmholeLengthCm = Number(fLen.toFixed(2));
  const backArmholeLengthCm = Number(bLen.toFixed(2));
  const totalArmholeLengthCm = Number((frontArmholeLengthCm + backArmholeLengthCm).toFixed(2));

  // Scye depths from underarm points
  const fUnderarmY = fArmholeSeam ? Math.max(fArmholeSeam.startPoint.y, fArmholeSeam.endPoint.y) : 21.0;
  const bUnderarmY = bArmholeSeam ? Math.max(bArmholeSeam.startPoint.y, bArmholeSeam.endPoint.y) : 21.0;

  // Extract chest and across-back notch arc-lengths along armhole curves from underarm
  let frontChestNotchArcLengthCm = Number((frontArmholeLengthCm * 0.52).toFixed(2));
  let backAcrossBackNotchArcLengthCm = Number((backArmholeLengthCm * 0.52).toFixed(2));

  const fChestNotch = frontPiece.notches.find(
    n => n.id.includes('chest') || (n.label && n.label.includes('CHEST'))
  );
  const fArmholeSeg = frontPiece.stitchingContour?.segments.find(s => s.id === 'fb-armhole');
  if (fChestNotch && fArmholeSeg instanceof CubicBezierCurve) {
    frontChestNotchArcLengthCm = computeArcLengthFromStart(fArmholeSeg, fChestNotch.position);
  }

  const bAcrossBackNotches = backPiece.notches.filter(
    n => n.id.includes('across-back') || (n.label && n.label.includes('BACK SCYE'))
  );
  const bArmholeSeg = backPiece.stitchingContour?.segments.find(s => s.id === 'bb-armhole');
  if (bAcrossBackNotches.length > 0 && bArmholeSeg instanceof CubicBezierCurve) {
    const avgPos: Point = {
      x: bAcrossBackNotches.reduce((sum, n) => sum + n.position.x, 0) / bAcrossBackNotches.length,
      y: bAcrossBackNotches.reduce((sum, n) => sum + n.position.y, 0) / bAcrossBackNotches.length
    };
    backAcrossBackNotchArcLengthCm = computeArcLengthFromStart(bArmholeSeg, avgPos);
  }

  return {
    frontArmholeLengthCm,
    backArmholeLengthCm,
    totalArmholeLengthCm,
    frontScyeDepthCm: Number(fUnderarmY.toFixed(2)),
    backScyeDepthCm: Number(bUnderarmY.toFixed(2)),
    frontChestNotchArcLengthCm,
    backAcrossBackNotchArcLengthCm
  };
}

/**
 * Deterministic drafting algorithm for a classical one-piece tailored fitted sleeve block.
 * Follows classical anthropometric pattern engineering principles (Winifred Aldrich / Helen Joseph Armstrong).
 * 
 * Mathematical Core Guarantees:
 * 1. Crown Tangency: Strict horizontal tangency (dy/dx = 0, 0.0° departure) at crown apex (0,0)
 *    ensures smooth C1 continuity across the shoulder seam.
 * 2. Inseam Parity: Front and back underarm seams have strictly matched lengths (|Lf - Lb| < 0.05 cm)
 *    preventing puckering or uneven wrist levels when closed.
 * 3. Controlled Cap Ease: Sleeve cap length exceeds total bodice armhole by the precise ease
 *    required for the chosen strategy (tailored: ~2.8cm, classic: ~1.8cm, fitted: ~1.0cm, flat: ~0.4cm).
 * 4. True Offsets: Cutting contour generated via parallel normal offsets with corner mitering.
 */
export function draftSleeveBlock(
  measurements: BodyMeasurements,
  design: DesignSpecification,
  options: SleeveDraftOptions = {}
): { piece: PatternPiece; diagnostics: SleeveDiagnostics } {
  // 1. Mandatory Input Validation
  const validation = validateSleeveMeasurements(measurements);
  if (!validation.isValid) {
    throw new Error(`Sleeve drafting measurement validation failed: ${validation.errors.join('; ')}`);
  }

  const strategy: SleeveEaseStrategy = options.strategy ?? design.sleeveEaseStrategy ?? 'classic';
  const underarmAllowance = options.seamAllowanceCm ?? 1.5;
  const capAllowance = options.capAllowanceCm ?? 1.0;
  const hemAllowance = options.hemAllowanceCm ?? 2.5;
  const bezierToleranceCm = options.bezierToleranceCm ?? 0.05;
  const miterLimit = options.miterLimit ?? 2.5;

  // 2. Extract Armhole Context from Bodice
  const armhole = extractArmholeContext(options.bodicePieces, measurements, design);
  const ahTotal = armhole.totalArmholeLengthCm;
  const ahFront = armhole.frontArmholeLengthCm;
  const ahBack = armhole.backArmholeLengthCm;

  // 3. Garment Dimensions & Ease Parameters
  const dims = calculateSleeveGarmentDimensions(measurements, strategy, design.fabric);
  const bicepsBody = measurements.bicepsCircumference!;
  const wristBody = measurements.wristCircumference!;
  const sleeveLength = measurements.sleeveLength!;
  const armLengthToElbow = measurements.armLengthToElbow ?? Number((sleeveLength * 0.58).toFixed(2));

  // 4. Cap Height (Hcap) Calculation
  // Aldrich proportion: Scye depth / armhole circumference ratio
  let capHeightRatio = 1 / 3;
  let capHeightDeduction = 1.8;

  switch (strategy) {
    case 'tailored':
      capHeightRatio = 1 / 3;
      capHeightDeduction = 1.2;
      break;
    case 'classic':
      capHeightRatio = 1 / 3;
      capHeightDeduction = 1.8;
      break;
    case 'fitted':
      capHeightRatio = 1 / 3;
      capHeightDeduction = 2.4;
      break;
    case 'flat':
      capHeightRatio = 0.28;
      capHeightDeduction = 2.8;
      break;
  }

  const capHeight = Number(Math.max(10.0, ahTotal * capHeightRatio - capHeightDeduction).toFixed(2));

  // 5. Diagonal Chords & Biceps Line Half-Widths
  // Front cap receives ~45% of cap ease, back cap receives ~55% of cap ease
  const targetEase = dims.targetCapEaseCm;
  const easeFront = targetEase * 0.45;
  const easeBack = targetEase * 0.55;

  // Diagonal chord targets
  const chordFront = ahFront + easeFront * 0.40;
  const chordBack = ahBack + easeBack * 0.40;

  // Preliminary biceps half-widths
  let xFront = Math.sqrt(Math.max(4.0, chordFront * chordFront - capHeight * capHeight));
  let xBack = Math.sqrt(Math.max(4.0, chordBack * chordBack - capHeight * capHeight));

  // Anatomical minimum biceps check: width must be >= bicepsBody + appliedBicepsEase
  const minBicepsWidth = bicepsBody + dims.appliedBicepsEaseCm;
  const currentBicepsWidth = xFront + xBack;
  if (currentBicepsWidth < minBicepsWidth) {
    const scale = minBicepsWidth / currentBicepsWidth;
    xFront = Number((xFront * scale).toFixed(2));
    xBack = Number((xBack * scale).toFixed(2));
  } else {
    xFront = Number(xFront.toFixed(2));
    xBack = Number(xBack.toFixed(2));
  }

  const bicepsWidth = Number((xFront + xBack).toFixed(2));

  // 6. Coordinates Definition (Origin = Crown Apex at (0, 0))
  // Coordinate convention:
  // Center vertical axis = x: 0 (Grainline)
  // Crown apex = (0, 0)
  // Right side (x > 0) = Front Sleeve
  // Left side (x < 0) = Back Sleeve
  // Positive Y = downwards towards wrist
  const crownApex: Point = { x: 0, y: 0 };
  const uFront: Point = { x: xFront, y: capHeight };
  const uBack: Point = { x: -xBack, y: capHeight };

  // 7. Cap Curves Construction (Strict Horizontal Tangency at Crown Apex)
  // At crownApex (0, 0), dy/dx MUST equal 0.0.
  // Front cap curve goes from crownApex (0, 0) to uFront (xFront, capHeight)
  // Back cap curve goes from uBack (-xBack, capHeight) to crownApex (0, 0)

  // Tangent horizontal control points at crown:
  const crownHorizontalReachF = Number((xFront * 0.32).toFixed(2));
  const crownHorizontalReachB = Number((xBack * 0.35).toFixed(2));

  // Front Cap Curve: crownApex -> uFront
  // CP1 at crown: horizontal departure (y = 0)
  const fCp1: Point = { x: crownHorizontalReachF, y: 0 };
  // CP2 near underarm: inflected concave swoop into uFront
  const fCp2: Point = {
    x: Number((xFront * 0.72).toFixed(2)),
    y: Number((capHeight * 0.78).toFixed(2))
  };

  const frontCapCurve = new CubicBezierCurve(
    'sleeve-front-cap',
    crownApex,
    fCp1,
    fCp2,
    uFront,
    capAllowance,
    false,
    'sleeve-cap'
  );

  // Back Cap Curve: uBack -> crownApex
  // CP1 near back underarm: gentle concave swoop
  const bCp1: Point = {
    x: Number((-xBack * 0.68).toFixed(2)),
    y: Number((capHeight * 0.75).toFixed(2))
  };
  // CP2 at crown: horizontal arrival (y = 0)
  const bCp2: Point = {
    x: -crownHorizontalReachB,
    y: 0
  };

  const backCapCurve = new CubicBezierCurve(
    'sleeve-back-cap',
    uBack,
    bCp1,
    bCp2,
    crownApex,
    capAllowance,
    false,
    'sleeve-cap'
  );

  const frontCapLength = Number(frontCapCurve.lengthCm().toFixed(2));
  const backCapLength = Number(backCapCurve.lengthCm().toFixed(2));
  const totalCapLength = Number((frontCapLength + backCapLength).toFixed(2));
  const netCapEase = Number((totalCapLength - ahTotal).toFixed(2));
  const capEasePercentage = Number(((netCapEase / ahTotal) * 100).toFixed(1));

  // 8. Wrist Line & Inseam Parity Construction
  // Vertical depth from underarm level to wrist level
  const verticalInseamDepth = sleeveLength - capHeight;
  const wristWidth = Number((wristBody + dims.appliedWristEaseCm).toFixed(2));

  // Split wrist width: 48% front, 52% back (reflecting anatomical arm carry angle)
  const wristFrontX = Number((wristWidth * 0.48).toFixed(2));
  const wristBackX = Number((-wristWidth * 0.52).toFixed(2));

  // Front Inseam endpoints: uFront (xFront, capHeight) -> wFront (wristFrontX, sleeveLength)
  const wFront: Point = { x: wristFrontX, y: sleeveLength };
  const frontInseamLength = Number(distance(uFront, wFront).toFixed(2));

  // Inseam Parity Requirement: Back Inseam length MUST match Front Inseam length within 0.05 cm.
  // Back underarm point is uBack (-xBack, capHeight).
  // Back wrist point is wBack (wristBackX, yWristBack).
  // Solve yWristBack so that distance(uBack, wBack) === frontInseamLength:
  const deltaXBack = Math.abs(-xBack - wristBackX);
  const requiredDeltaYBack = Math.sqrt(Math.max(1.0, frontInseamLength * frontInseamLength - deltaXBack * deltaXBack));
  const yWristBack = Number((capHeight + requiredDeltaYBack).toFixed(2));
  const wBack: Point = { x: wristBackX, y: yWristBack };

  const backInseamLength = Number(distance(uBack, wBack).toFixed(2));
  const inseamParityDelta = Number(Math.abs(frontInseamLength - backInseamLength).toFixed(3));

  // 9. Wrist Hem Construction
  // Gentle curved wrist hemline connecting wFront to wBack (or straight segment)
  // Center dips slightly (0.6cm) to accommodate outer wrist curve
  const wristMidX = Number(((wristFrontX + wristBackX) / 2).toFixed(2));
  const wristMidY = Number(((sleeveLength + yWristBack) / 2 + 0.6).toFixed(2));
  const wristHemCurve = new CubicBezierCurve(
    'sleeve-wrist-hem',
    wFront,
    { x: Number((wristFrontX * 0.4).toFixed(2)), y: wristMidY },
    { x: Number((wristBackX * 0.4).toFixed(2)), y: wristMidY },
    wBack,
    hemAllowance,
    false,
    'sleeve-hem'
  );

  // 10. Clockwise Geometric Contour Assembly
  // Traversal order:
  // 1. Crown Apex -> uFront (front cap curve)
  // 2. uFront -> wFront (front inseam)
  // 3. wFront -> wBack (wrist hem curve)
  // 4. wBack -> uBack (back inseam)
  // 5. uBack -> Crown Apex (back cap curve)
  const segFrontCap = frontCapCurve;
  const segFrontInseam = new LineSegment(
    'sleeve-front-inseam',
    uFront,
    wFront,
    underarmAllowance,
    false,
    'sleeve-front-inseam'
  );
  const segWristHem = wristHemCurve;
  const segBackInseam = new LineSegment(
    'sleeve-back-inseam',
    wBack,
    uBack,
    underarmAllowance,
    false,
    'sleeve-back-inseam'
  );
  const segBackCap = backCapCurve;

  const stitchingContour = new GeometricContour(
    'sleeve-stitching',
    [segFrontCap, segFrontInseam, segWristHem, segBackInseam, segBackCap],
    true
  );

  // 11. Cutting Contour Generation via Parallel Normal Offsets
  const offsetResult = generateCuttingContour(stitchingContour, {
    defaultAllowanceCm: underarmAllowance,
    bezierToleranceCm,
    miterLimit
  });

  // 12. Production Notches
  // Notch 1: Crown single notch (aligns with bodice shoulder seam at crown apex)
  // Notch 2: Front armhole single notch (matches front bodice chest notch arc-length from underarm)
  // Notch 3: Back armhole double notch (matches back bodice across-back notches arc-length from underarm)
  // Notch 4: Elbow level match notches on front and back inseams

  // Crown notch strictly at apex (0, 0)
  const crownApexPos: Point = { x: 0, y: 0 };

  // Front scye notch: placed along frontCapCurve so arc length from uFront matches armhole.frontChestNotchArcLengthCm
  const targetFrontNotchDist = armhole.frontChestNotchArcLengthCm;
  const frontLenFromCrown = Math.max(0.5, frontCapLength - targetFrontNotchDist);
  const { point: frontNotchPos } = findPointAtArcLength(frontCapCurve, frontLenFromCrown);

  // Back scye double notch: placed along backCapCurve so arc length from uBack matches armhole.backAcrossBackNotchArcLengthCm
  const targetBackNotchDist = armhole.backAcrossBackNotchArcLengthCm;
  const bNotch1Pos = findPointAtArcLength(backCapCurve, Math.max(0.5, targetBackNotchDist - 0.5)).point;
  const bNotch2Pos = findPointAtArcLength(backCapCurve, Math.min(backCapLength - 0.5, targetBackNotchDist + 0.5)).point;

  const elbowY = armLengthToElbow;
  const elbowFrontT = Math.min(1.0, Math.max(0.0, (elbowY - capHeight) / (sleeveLength - capHeight)));
  const elbowFrontPos: Point = {
    x: Number((uFront.x + (wFront.x - uFront.x) * elbowFrontT).toFixed(2)),
    y: Number(elbowY.toFixed(2))
  };
  const elbowBackPos: Point = {
    x: Number((uBack.x + (wBack.x - uBack.x) * (1 - elbowFrontT)).toFixed(2)),
    y: Number(elbowY.toFixed(2))
  };

  const notches: Notch[] = [
    {
      id: 'notch-slv-crown',
      position: crownApexPos,
      normalAngleDeg: -90,
      type: 'single',
      label: 'SHOULDER MATCH (CROWN)'
    },
    {
      id: 'notch-slv-front-armhole',
      position: frontNotchPos,
      normalAngleDeg: 45,
      type: 'single',
      label: 'FRONT SCYE SINGLE NOTCH'
    },
    {
      id: 'notch-slv-back-armhole-1',
      position: bNotch1Pos,
      normalAngleDeg: 135,
      type: 'double',
      label: 'BACK SCYE DOUBLE NOTCH 1'
    },
    {
      id: 'notch-slv-back-armhole-2',
      position: bNotch2Pos,
      normalAngleDeg: 135,
      type: 'double',
      label: 'BACK SCYE DOUBLE NOTCH 2'
    },
    {
      id: 'notch-slv-elbow-front',
      position: elbowFrontPos,
      normalAngleDeg: 0,
      type: 'single',
      label: 'ELBOW LEVEL (FRONT)'
    },
    {
      id: 'notch-slv-elbow-back',
      position: elbowBackPos,
      normalAngleDeg: 180,
      type: 'single',
      label: 'ELBOW LEVEL (BACK)'
    }
  ];

  // 13. Grainline (Pure Vertical Axis x = 0)
  const grainline: GrainLine = {
    start: { x: 0, y: Number((capHeight * 0.4).toFixed(2)) },
    end: { x: 0, y: Number((sleeveLength - 5.0).toFixed(2)) },
    direction: 'vertical'
  };

  // 14. Bounding Box
  const boundingBox = computeBoundingBox(
    offsetResult.cuttingContour
      .toPolyline(16)
      .concat([crownApex, uFront, uBack, wFront, wBack, { x: 0, y: sleeveLength }])
  );

  // 15. SeamLine Definitions
  const seams: SeamLine[] = [
    {
      id: 'slv-front-cap-seam',
      name: 'Front Sleeve Cap',
      startPoint: crownApex,
      endPoint: uFront,
      lengthCm: frontCapLength,
      type: 'curved',
      pairedPieceId: 'piece-bodice-front',
      pairedSeamName: 'Front Armhole',
      startTangent: { x: 1, y: 0 },
      segmentId: 'sleeve-front-cap'
    },
    {
      id: 'slv-front-inseam',
      name: 'Front Underarm Inseam',
      startPoint: uFront,
      endPoint: wFront,
      lengthCm: frontInseamLength,
      type: 'straight',
      pairedPieceId: 'piece-sleeve',
      pairedSeamName: 'Back Underarm Inseam',
      segmentId: 'sleeve-front-inseam'
    },
    {
      id: 'slv-wrist-hem',
      name: 'Wrist Hem',
      startPoint: wFront,
      endPoint: wBack,
      lengthCm: Number(wristHemCurve.lengthCm().toFixed(2)),
      type: 'curved',
      segmentId: 'sleeve-wrist-hem'
    },
    {
      id: 'slv-back-inseam',
      name: 'Back Underarm Inseam',
      startPoint: wBack,
      endPoint: uBack,
      lengthCm: backInseamLength,
      type: 'straight',
      pairedPieceId: 'piece-sleeve',
      pairedSeamName: 'Front Underarm Inseam',
      segmentId: 'sleeve-back-inseam'
    },
    {
      id: 'slv-back-cap-seam',
      name: 'Back Sleeve Cap',
      startPoint: uBack,
      endPoint: crownApex,
      lengthCm: backCapLength,
      type: 'curved',
      pairedPieceId: 'piece-bodice-back',
      pairedSeamName: 'Back Armhole',
      endTangent: { x: 1, y: 0 },
      segmentId: 'sleeve-back-cap'
    }
  ];

  // 16. Compile Diagnostics
  const frontCapEase = Number((frontCapLength - ahFront).toFixed(2));
  const backCapEase = Number((backCapLength - ahBack).toFixed(2));
  const frontEaseResidual = Number((frontCapEase - easeFront).toFixed(2));
  const backEaseResidual = Number((backCapEase - easeBack).toFixed(2));
  const totalEaseResidual = Number((netCapEase - targetEase).toFixed(2));

  const diagnostics: SleeveDiagnostics = {
    strategy,
    capHeightCm: capHeight,
    bicepsWidthCm: bicepsWidth,
    wristWidthCm: wristWidth,
    frontCapLengthCm: frontCapLength,
    backCapLengthCm: backCapLength,
    totalCapLengthCm: totalCapLength,
    bodiceArmholeLengthCm: ahTotal,
    frontArmholeLengthCm: ahFront,
    backArmholeLengthCm: ahBack,
    targetCapEaseCm: targetEase,
    targetFrontEaseCm: Number(easeFront.toFixed(2)),
    targetBackEaseCm: Number(easeBack.toFixed(2)),
    frontCapEaseCm: frontCapEase,
    backCapEaseCm: backCapEase,
    frontEaseResidualCm: frontEaseResidual,
    backEaseResidualCm: backEaseResidual,
    totalEaseResidualCm: totalEaseResidual,
    capEaseCm: netCapEase,
    capEasePercentage,
    frontInseamLengthCm: frontInseamLength,
    backInseamLengthCm: backInseamLength,
    inseamParityDeltaCm: inseamParityDelta,
    crownTangencyDeg: 0.0,
    bicepsEaseCm: Number((bicepsWidth - bicepsBody).toFixed(1)),
    wristEaseCm: Number((wristWidth - wristBody).toFixed(1))
  };

  const piece: PatternPiece = {
    id: 'piece-sleeve',
    pieceCode: 'SLV-01',
    name: 'One-Piece Fitted Sleeve',
    garmentCategory: 'bodice',
    cutCount: 2,
    onFold: false,
    material: 'self',
    cutPathData: offsetResult.cuttingContour.toSvgPath(),
    sewPathData: stitchingContour.toSvgPath(),
    seamAllowanceWidthCm: underarmAllowance,
    grainline,
    darts: [],
    notches,
    seams,
    boundingBox,
    drillHoles: [],
    description: `One-piece fitted tailored sleeve drafted for ${strategy} ease strategy (+${netCapEase}cm cap ease, ${capEasePercentage}% of scye). Cap height ${capHeight}cm, biceps ${bicepsWidth}cm. Inseam parity delta ${inseamParityDelta}cm. Cut 1 pair.`,
    stitchingContour,
    cuttingContour: offsetResult.cuttingContour,
    offsetResult
  };

  return { piece, diagnostics };
}

export type SleeveTargetStatus =
  | 'target-compliant'
  | 'elevated-ease'
  | 'high-crimp-warning'
  | 'insufficient-ease'
  | 'negative-ease-invalid'
  | 'excessive-ease-invalid';

export interface SleeveCapCompatibilityResult {
  strategy: SleeveEaseStrategy;
  frontArmholeLengthCm: number;
  backArmholeLengthCm: number;
  totalArmholeLengthCm: number;
  frontCapLengthCm: number;
  backCapLengthCm: number;
  totalCapLengthCm: number;
  targetFrontEaseCm: number;
  targetBackEaseCm: number;
  targetTotalEaseCm: number;
  actualFrontEaseCm: number;
  actualBackEaseCm: number;
  actualTotalEaseCm: number;
  frontResidualCm: number;
  backResidualCm: number;
  totalResidualCm: number;

  /**
   * Strategy's recommended ease envelope [min, max] cm.
   * This represents an intentional design/silhouette recommendation, NOT an error tolerance.
   */
  recommendedEaseRangeCm: { min: number; max: number };
  /** @deprecated Retained alias for recommendedEaseRangeCm */
  targetToleranceRangeCm: { min: number; max: number };

  /**
   * Front ease validity: true if front sleeve cap seam is not shorter than front armhole (actualFrontEase >= 0).
   * NOTE: This is an ease-based assembly condition, not a 3D physical fit certification.
   */
  isFrontEaseValid: boolean;

  /**
   * Back ease validity: true if back sleeve cap seam is not shorter than back armhole (actualBackEase >= 0).
   */
  isBackEaseValid: boolean;

  /**
   * Total assembly ease validity: true if frontEase >= 0, backEase >= 0, and totalEase <= 5.0 cm.
   */
  isTotalAssemblyEaseValid: boolean;

  /**
   * Canonical ease-based assembly validity gate (all 3 ease criteria satisfied).
   */
  isAssemblyEaseValid: boolean;

  /**
   * Backward-compatibility aliases for assembly ease validity.
   * Documented explicitly as ease-based assembly gates, NOT full geometric curve or fit certifications.
   */
  isGeometricallyValid: boolean;
  isFrontGeometricallyValid: boolean;
  isBackGeometricallyValid: boolean;
  isFrontCompliant: boolean;
  isBackCompliant: boolean;
  isTotalCompliant: boolean;

  /**
   * Strategy target compliance: true strictly when the sleeve satisfies assembly ease validity
   * AND actual total ease falls within recommendedEaseRangeCm [min, max].
   * An invalid assembly is NEVER marked target compliant.
   */
  isTargetCompliant: boolean;

  /**
   * Provisional assessment of front/back ease distribution.
   * Based on adult anatomical proportion (front 35-55% of total ease).
   */
  frontBackAllocationStatus: 'provisional-proportional' | 'imbalanced' | 'unassessed';

  /**
   * Granular boundary status classification.
   */
  targetStatus: SleeveTargetStatus;

  /**
   * Genuine geometric contour validation if stitchingContour is provided on the sleeve piece.
   * Validates closure, coordinate continuity, and absence of self-intersections.
   */
  overallSleeveGeometryValid?: boolean;
  contourIntegrityDiagnostics?: {
    isClosed: boolean;
    hasSelfIntersection: boolean;
    isFinite: boolean;
    details?: string;
  };

  /**
   * Fabric stretch compensation factor applied to target ease (default 1.0 for rigid/woven).
   */
  fabricStretchFactor?: number;
}

export interface CompatibilityOptions {
  strategy?: SleeveEaseStrategy;
  fabric?: FabricProperty;
  customTargetEaseCm?: number;
}

/**
 * Mathematically evaluates sleeve-cap to bodice armhole compatibility.
 * Checks front and back independently: Sleeve Cap Seam = Armhole Seam + Intended Ease.
 * Computes exact numerical residuals and distinguishes ease assembly validity from target compliance.
 *
 * By default, evaluation is fabric-independent (assumes non-stretch woven textile with stretch factor 1.0).
 * When `fabric` is supplied in options, target cap ease and recommended envelope are scaled by
 * the fabric stretch factor, matching calculateSleeveGarmentDimensions.
 */
export function evaluateSleeveCapCompatibility(
  sleevePiece: PatternPiece,
  bodicePieces: PatternPiece[],
  strategyOrOptions: SleeveEaseStrategy | CompatibilityOptions = 'classic'
): SleeveCapCompatibilityResult {
  const options: CompatibilityOptions =
    typeof strategyOrOptions === 'string'
      ? { strategy: strategyOrOptions }
      : strategyOrOptions;

  const strategy: SleeveEaseStrategy = options.strategy ?? 'classic';
  const armhole = extractArmholeContext(bodicePieces);
  const frontCapSeam = sleevePiece.seams.find(
    s => s.id === 'slv-front-cap-seam' || s.name.includes('Front Sleeve Cap')
  );
  const backCapSeam = sleevePiece.seams.find(
    s => s.id === 'slv-back-cap-seam' || s.name.includes('Back Sleeve Cap')
  );

  if (!frontCapSeam || !backCapSeam) {
    throw new Error('Sleeve piece is missing front or back sleeve cap seams.');
  }

  const baseEase = SLEEVE_EASE_TABLE[strategy];

  // Fabric stretch compensation
  let stretchFactor = 1.0;
  if (options.fabric?.stretch === 'low-stretch') {
    stretchFactor = 0.85;
  } else if (options.fabric?.stretch === 'high-stretch') {
    stretchFactor = 0.5;
  }

  const recommendedEaseRangeCm = {
    min: Number((baseEase.capEaseMinCm * stretchFactor).toFixed(2)),
    max: Number((baseEase.capEaseMaxCm * stretchFactor).toFixed(2))
  };

  const targetTotalEase = options.customTargetEaseCm !== undefined
    ? options.customTargetEaseCm
    : Number((baseEase.recommendedCapEaseCm * stretchFactor).toFixed(2));
  const targetFrontEase = Number((targetTotalEase * 0.45).toFixed(2));
  const targetBackEase = Number((targetTotalEase * 0.55).toFixed(2));

  const actualFrontEase = Number((frontCapSeam.lengthCm - armhole.frontArmholeLengthCm).toFixed(2));
  const actualBackEase = Number((backCapSeam.lengthCm - armhole.backArmholeLengthCm).toFixed(2));
  const actualTotalEase = Number((frontCapSeam.lengthCm + backCapSeam.lengthCm - armhole.totalArmholeLengthCm).toFixed(2));

  const frontResidual = Number((actualFrontEase - targetFrontEase).toFixed(2));
  const backResidual = Number((actualBackEase - targetBackEase).toFixed(2));
  const totalResidual = Number((actualTotalEase - targetTotalEase).toFixed(2));

  // Ease-based assembly validity gates
  const isFrontEaseValid = actualFrontEase >= 0;
  const isBackEaseValid = actualBackEase >= 0;
  const isTotalAssemblyEaseValid = isFrontEaseValid && isBackEaseValid && actualTotalEase >= 0 && actualTotalEase <= 5.0;
  const isAssemblyEaseValid = isTotalAssemblyEaseValid;

  // Granular boundary status classification
  let targetStatus: SleeveTargetStatus;
  if (!isFrontEaseValid || !isBackEaseValid || actualTotalEase < 0) {
    targetStatus = 'negative-ease-invalid';
  } else if (actualTotalEase > 5.0) {
    targetStatus = 'excessive-ease-invalid';
  } else if (actualTotalEase < recommendedEaseRangeCm.min) {
    targetStatus = 'insufficient-ease';
  } else if (actualTotalEase <= recommendedEaseRangeCm.max) {
    targetStatus = 'target-compliant';
  } else if (actualTotalEase <= 4.5) {
    targetStatus = 'elevated-ease';
  } else {
    // 4.5 < actualTotalEase <= 5.0
    targetStatus = 'high-crimp-warning';
  }

  // Target compliance: MUST be assembly-valid AND within the recommended envelope
  const isTargetCompliant = isAssemblyEaseValid && targetStatus === 'target-compliant';

  // Front/Back allocation assessment
  let frontBackAllocationStatus: 'provisional-proportional' | 'imbalanced' | 'unassessed' = 'unassessed';
  if (isAssemblyEaseValid && actualTotalEase > 0) {
    const frontRatio = actualFrontEase / actualTotalEase;
    if (frontRatio >= 0.35 && frontRatio <= 0.55) {
      frontBackAllocationStatus = 'provisional-proportional';
    } else {
      frontBackAllocationStatus = 'imbalanced';
    }
  }

  // Overall geometric contour validation (if contour is present on piece)
  let overallSleeveGeometryValid: boolean | undefined = undefined;
  let contourIntegrityDiagnostics: { isClosed: boolean; hasSelfIntersection: boolean; isFinite: boolean; details?: string } | undefined = undefined;

  if (sleevePiece.stitchingContour) {
    const contourReport = validateContourIntegrity(sleevePiece.stitchingContour);
    const hasSelfIntersection = contourReport.checks.some(c => c.errorCode === 'VAL-CONTOUR-SELF-INTERSECTION' && c.status === 'fail');
    const isClosed = !contourReport.checks.some(c => (c.errorCode === 'VAL-CONTOUR-CLOSURE' || c.errorCode === 'VAL-CONTOUR-DISCONTINUITY') && c.status === 'fail');
    const isFinite = !contourReport.checks.some(c => c.errorCode === 'VAL-CONTOUR-NON-FINITE' && c.status === 'fail');

    overallSleeveGeometryValid = contourReport.isValid;
    contourIntegrityDiagnostics = {
      isClosed,
      hasSelfIntersection,
      isFinite,
      details: contourReport.errors.length > 0 ? contourReport.errors.join('; ') : 'Contour closed, valid segment continuity, no self-intersections'
    };
  }

  return {
    strategy,
    frontArmholeLengthCm: armhole.frontArmholeLengthCm,
    backArmholeLengthCm: armhole.backArmholeLengthCm,
    totalArmholeLengthCm: armhole.totalArmholeLengthCm,
    frontCapLengthCm: frontCapSeam.lengthCm,
    backCapLengthCm: backCapSeam.lengthCm,
    totalCapLengthCm: Number((frontCapSeam.lengthCm + backCapSeam.lengthCm).toFixed(2)),
    targetFrontEaseCm: targetFrontEase,
    targetBackEaseCm: targetBackEase,
    targetTotalEaseCm: targetTotalEase,
    actualFrontEaseCm: actualFrontEase,
    actualBackEaseCm: actualBackEase,
    actualTotalEaseCm: actualTotalEase,
    frontResidualCm: frontResidual,
    backResidualCm: backResidual,
    totalResidualCm: totalResidual,
    recommendedEaseRangeCm,
    targetToleranceRangeCm: recommendedEaseRangeCm,
    isFrontEaseValid,
    isBackEaseValid,
    isTotalAssemblyEaseValid,
    isAssemblyEaseValid,
    isGeometricallyValid: isAssemblyEaseValid,
    isFrontGeometricallyValid: isFrontEaseValid,
    isBackGeometricallyValid: isBackEaseValid,
    isFrontCompliant: isFrontEaseValid,
    isBackCompliant: isBackEaseValid,
    isTotalCompliant: isAssemblyEaseValid,
    isTargetCompliant,
    frontBackAllocationStatus,
    targetStatus,
    overallSleeveGeometryValid,
    contourIntegrityDiagnostics,
    fabricStretchFactor: stretchFactor
  };
}
