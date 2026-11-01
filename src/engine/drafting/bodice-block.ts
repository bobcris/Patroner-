/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyMeasurements,
  Dart,
  DesignSpecification,
  GrainLine,
  Notch,
  PatternPiece,
  Point,
  SeamLine
} from '../../types';
import { approximateBezierLength, computeBoundingBox, distance } from '../geometry/math';
import { generateCuttingContour } from '../geometry/offset';
import { CubicBezierCurve, GeometricContour, LineSegment } from '../geometry/primitives';
import { calculateBodiceGarmentDimensions, validateBodiceMeasurements } from '../measurements/standards';

export interface BodiceDraftOptions {
  seamAllowanceCm?: number;      // side seam allowance (default: 1.5 cm)
  waistAllowanceCm?: number;     // waistline allowance (default: 1.0 cm)
  neckAllowanceCm?: number;      // neckline allowance (default: 1.0 cm)
  armholeAllowanceCm?: number;   // armhole allowance (default: 1.0 cm)
  shoulderAllowanceCm?: number;  // shoulder seam allowance (default: 1.0 cm)
  bezierToleranceCm?: number;    // adaptive subdivision tolerance (default: 0.05 cm)
  miterLimit?: number;           // corner miter limit ratio (default: 2.5)
}

/**
 * Deterministic drafting algorithm for a tailored basic bodice block (Front & Back panels).
 * Follows classical anthropometric pattern construction principles (Winifred Aldrich / Helen Joseph Armstrong).
 * 
 * Mathematical Architecture:
 * 1. Geometry-First: The stitching line defines construction as a structured GeometricContour.
 * 2. True Offsets: The cutting contour is mathematically generated from the stitching contour
 *    using parallel normal offsets, miter/bevel corner intersections, and fold-edge handling.
 * 3. Seam-to-Geometry Linkage: All SeamLine measurements and tangents are derived directly
 *    from their underlying geometric segments, guaranteeing exact synchronization.
 * 4. Center-Line Tangency: Center Front (fold) and Center Back enforce strict 90.0° perpendicularity
 *    at both waist and neckline junctions.
 * 5. Dart Parity: Left and right dart legs have mathematically identical lengths from apex to waist.
 * 6. Paired Seam Match: Front and Back side seam lengths, as well as shoulder seam lengths,
 *    match within the strict 0.20 cm manufacturing tolerance.
 */
export function draftBodiceBlock(
  measurements: BodyMeasurements,
  design: DesignSpecification,
  options: BodiceDraftOptions = {}
): PatternPiece[] {
  // 1. Mandatory Input Validation
  const validation = validateBodiceMeasurements(measurements);
  if (!validation.isValid) {
    throw new Error(`Bodice drafting measurement validation failed: ${validation.errors.join('; ')}`);
  }

  // Tolerances and allowances
  const sideSeamAllowance = options.seamAllowanceCm ?? 1.5;
  const waistAllowance = options.waistAllowanceCm ?? 1.0;
  const neckAllowance = options.neckAllowanceCm ?? 1.0;
  const armholeAllowance = options.armholeAllowanceCm ?? 1.0;
  const shoulderAllowance = options.shoulderAllowanceCm ?? 1.0;
  const bezierToleranceCm = options.bezierToleranceCm ?? 0.05;
  const miterLimit = options.miterLimit ?? 2.5;

  // 2. Finished Dimensions & Ease Calculation
  const dims = calculateBodiceGarmentDimensions(measurements, design.easeProfile, design.fabric);
  const garmentBust = dims.garmentBustCm;
  const garmentWaist = dims.garmentWaistCm;

  const bust = measurements.bust!;
  const waist = measurements.waist;
  const backWaistLength = measurements.backWaistLength!;
  const frontWaistLength = measurements.frontWaistLength!;
  const acrossBack = measurements.acrossBack!;
  const shoulderLength = measurements.shoulderLength!;

  // Derived / explicit secondary dimensions
  // Standard scye depth (Aldrich): 1/8 bust + 5.5cm + ease proportion
  const armholeDepth = measurements.armholeDepth ?? Number((bust / 8 + 5.5 + dims.appliedBustEaseCm * 0.25).toFixed(2));
  // Neck circumference base: bust / 3 + 6.5 cm
  const neckCircumference = measurements.neckCircumference ?? Number((bust / 3 + 6.5).toFixed(2));
  // Bust span (apex to apex): bust / 5 + 0.5 cm (half span = bustSpan / 2)
  const bustSpan = measurements.bustSpan ?? Number((bust / 5 + 0.5).toFixed(2));
  const halfBustSpan = Number((bustSpan / 2).toFixed(2));
  // Bust height (side neck down to apex): typically ~62% of front waist length
  const bustHeight = measurements.bustHeight ?? Number((frontWaistLength * 0.62).toFixed(2));

  // 3. Circumference Partitioning (Classical Women's Tailoring: Front bust +0.75cm, Back bust -0.75cm)
  const quarterBust = garmentBust / 4;
  const frontQuarterBust = Number((quarterBust + 0.75).toFixed(2));
  const backQuarterBust = Number((quarterBust - 0.75).toFixed(2));

  const quarterWaist = garmentWaist / 4;
  const frontQuarterWaist = Number((quarterWaist + 0.50).toFixed(2));
  const backQuarterWaist = Number((quarterWaist - 0.50).toFixed(2));

  // 4. Suppression Partitioning
  const frontSuppression = Math.max(0, frontQuarterBust - frontQuarterWaist);
  const backSuppression = Math.max(0, backQuarterBust - backQuarterWaist);

  // Side seam absorbs up to 2.0cm suppression, remainder absorbed by vertical waist darts
  const frontSideSuppression = Math.min(2.0, Number((frontSuppression * 0.4).toFixed(2)));
  const frontDartWidth = Math.max(1.0, Number((frontSuppression - frontSideSuppression).toFixed(2)));

  const backSideSuppression = Math.min(2.0, Number((backSuppression * 0.4).toFixed(2)));
  const backDartWidth = Math.max(1.0, Number((backSuppression - backSideSuppression).toFixed(2)));

  // 5. Neckline Dimensions
  // Neck width: 1/5 of neck circumference
  const neckWidth = Number((neckCircumference / 5).toFixed(2));
  // Front neck depth: neckWidth + 0.8 cm
  const frontNeckDepth = Number((neckWidth + 0.8).toFixed(2));
  // Back neck depth (nape curve): 1.5 cm
  const backNeckDepth = 1.5;

  // 6. Shoulder Slope & Tip Calculations
  // Standard anthropometric slope drops: Back ~3.8cm, Front ~4.6cm
  const backShoulderDrop = 3.8;
  const frontShoulderDrop = 4.6;

  const backDeltaX = Math.sqrt(Math.max(1.0, shoulderLength * shoulderLength - backShoulderDrop * backShoulderDrop));
  const frontDeltaX = Math.sqrt(Math.max(1.0, shoulderLength * shoulderLength - frontShoulderDrop * frontShoulderDrop));

  // Points for Back Shoulder
  const bNeckShoulder: Point = { x: neckWidth, y: 0 };
  const bShoulderTip: Point = {
    x: Number((neckWidth + backDeltaX).toFixed(2)),
    y: backShoulderDrop
  };

  // Points for Front Shoulder
  const fNeckShoulder: Point = { x: neckWidth, y: 0 };
  const fShoulderTip: Point = {
    x: Number((neckWidth + frontDeltaX).toFixed(2)),
    y: frontShoulderDrop
  };

  // 7. Scye Level & Underarm Points
  const scyeY = armholeDepth;
  const fUnderarm: Point = { x: frontQuarterBust, y: scyeY };
  const bUnderarm: Point = { x: backQuarterBust, y: scyeY };

  // 8. Front Side Seam & Waist Placement
  const fSideWaistX = Number((frontQuarterBust - frontSideSuppression).toFixed(2));
  const fSideWaistY = frontWaistLength;
  const fSideWaist: Point = { x: fSideWaistX, y: fSideWaistY };
  const frontSideSeamLength = Number(distance(fUnderarm, fSideWaist).toFixed(2));

  // 9. Back Side Seam Placement (Matched to Front Side Seam Length for 0.0mm Discrepancy)
  const bSideWaistX = Number((backQuarterBust - backSideSuppression).toFixed(2));
  const bDeltaX = bSideWaistX - bUnderarm.x;
  // Solve vertical drop so hypotenuse exactly equals frontSideSeamLength
  const bDeltaY = Math.sqrt(Math.max(1.0, frontSideSeamLength * frontSideSeamLength - bDeltaX * bDeltaX));
  const bSideWaistY = Number((scyeY + bDeltaY).toFixed(2));
  const bSideWaist: Point = { x: bSideWaistX, y: bSideWaistY };

  // =========================================================================
  // 10. FRONT BODICE CONSTRUCTION
  // =========================================================================

  // Center Front squaring zones for C1 continuity
  const cfWaist: Point = { x: 0, y: frontWaistLength };
  const cfWaistSquareEnd: Point = { x: 2.5, y: frontWaistLength }; // 2.5cm perpendicular zone
  const cfNeck: Point = { x: 0, y: frontNeckDepth };
  const cfNeckSquareEnd: Point = { x: 2.0, y: frontNeckDepth }; // 2.0cm perpendicular zone

  // Front Waist Dart (Apex placed 2.5cm below true bust point)
  const fDartApexY = Number((bustHeight + 2.5).toFixed(2));
  const fDartApex: Point = { x: halfBustSpan, y: fDartApexY };
  const fDartLeft: Point = { x: Number((halfBustSpan - frontDartWidth / 2).toFixed(2)), y: frontWaistLength };
  const fDartRight: Point = { x: Number((halfBustSpan + frontDartWidth / 2).toFixed(2)), y: frontWaistLength };

  // Front Armhole Curve (Cubic Bézier passing chest level)
  // Across chest point at 65% scye depth
  const chestY = Number((scyeY * 0.65).toFixed(2));
  const chestHalfWidth = Number(((acrossBack - 1.5) / 2 + 0.5).toFixed(2));
  const fArmholeCp1: Point = {
    x: Number((fShoulderTip.x + (chestHalfWidth - fShoulderTip.x) * 0.4).toFixed(2)),
    y: Number((fShoulderTip.y + (chestY - fShoulderTip.y) * 0.5).toFixed(2))
  };
  const fArmholeCp2: Point = {
    x: Number((chestHalfWidth).toFixed(2)),
    y: Number((chestY + (scyeY - chestY) * 0.6).toFixed(2))
  };

  // Front Neckline Curve (Cubic Bézier meeting CF at exact 90° tangency)
  const fNeckCp1: Point = {
    x: Number((fNeckShoulder.x).toFixed(2)),
    y: Number((fNeckShoulder.y + (frontNeckDepth - fNeckShoulder.y) * 0.55).toFixed(2))
  };
  const fNeckCp2: Point = {
    x: Number((cfNeckSquareEnd.x + (fNeckShoulder.x - cfNeckSquareEnd.x) * 0.25).toFixed(2)),
    y: frontNeckDepth
  };

  // Assemble Front Stitching Segments (Clockwise: CF Fold -> Waist -> Side -> Armhole -> Shoulder -> Neckline)
  const fbFold = new LineSegment('fb-cf-fold', cfNeck, cfWaist, 0, true, 'fb-center-front');
  const fbWaistSquare = new LineSegment('fb-waist-square', cfWaist, cfWaistSquareEnd, waistAllowance, false, 'fb-waist');
  const fbWaistMid = new LineSegment('fb-waist-mid', cfWaistSquareEnd, fDartLeft, waistAllowance, false, 'fb-waist');
  const fbDartCap = new LineSegment('fb-dart-cap', fDartLeft, fDartRight, waistAllowance, false, 'fb-waist');
  const fbWaistSide = new LineSegment('fb-waist-side', fDartRight, fSideWaist, waistAllowance, false, 'fb-waist');
  const fbSideSeam = new LineSegment('fb-side-seam', fSideWaist, fUnderarm, sideSeamAllowance, false, 'fb-side-seam');
  const fbArmhole = new CubicBezierCurve('fb-armhole', fUnderarm, fArmholeCp2, fArmholeCp1, fShoulderTip, armholeAllowance, false, 'fb-armhole');
  const fbShoulder = new LineSegment('fb-shoulder', fShoulderTip, fNeckShoulder, shoulderAllowance, false, 'fb-shoulder');
  const fbNeckCurve = new CubicBezierCurve('fb-neck-curve', fNeckShoulder, fNeckCp1, fNeckCp2, cfNeckSquareEnd, neckAllowance, false, 'fb-neck');
  const fbNeckSquare = new LineSegment('fb-neck-square', cfNeckSquareEnd, cfNeck, neckAllowance, false, 'fb-neck');

  const frontStitchingContour = new GeometricContour(
    'front-bodice-stitching',
    [
      fbFold,
      fbWaistSquare,
      fbWaistMid,
      fbDartCap,
      fbWaistSide,
      fbSideSeam,
      fbArmhole,
      fbShoulder,
      fbNeckCurve,
      fbNeckSquare
    ],
    true
  );

  const frontOffsetResult = generateCuttingContour(frontStitchingContour, {
    defaultAllowanceCm: sideSeamAllowance,
    bezierToleranceCm,
    miterLimit
  });

  const frontWaistDart: Dart = {
    id: 'dart-front-waist',
    apex: fDartApex,
    legLeft: fDartLeft,
    legRight: fDartRight,
    widthCm: frontDartWidth,
    lengthCm: Number(distance(fDartApex, fDartLeft).toFixed(2))
  };

  const frontNotches: Notch[] = [
    {
      id: 'notch-fb-cf-fold',
      position: { x: 0, y: Number(((frontNeckDepth + frontWaistLength) / 2).toFixed(2)) },
      normalAngleDeg: 180,
      type: 'fold',
      label: 'CF FOLD'
    },
    {
      id: 'notch-fb-chest',
      position: { x: chestHalfWidth, y: chestY },
      normalAngleDeg: 0,
      type: 'single',
      label: 'CHEST / ARMHOLE'
    },
    {
      id: 'notch-fb-side-waist',
      position: fSideWaist,
      normalAngleDeg: -90,
      type: 'single',
      label: 'WAIST MATCH'
    }
  ];

  const frontSeams: SeamLine[] = [
    {
      id: 'fb-center-front',
      name: 'Center Front (Fold)',
      startPoint: cfNeck,
      endPoint: cfWaist,
      lengthCm: fbFold.lengthCm(),
      type: 'straight',
      segmentId: 'fb-cf-fold'
    },
    {
      id: 'fb-waist',
      name: 'Front Waist',
      startPoint: cfWaist,
      endPoint: fSideWaist,
      lengthCm: Number((fbWaistSquare.lengthCm() + fbWaistMid.lengthCm() + fbDartCap.lengthCm() + fbWaistSide.lengthCm()).toFixed(2)),
      type: 'straight',
      startTangent: { x: 1, y: 0 },
      endTangent: { x: 1, y: 0 },
      segmentIds: ['fb-waist-square', 'fb-waist-mid', 'fb-dart-cap', 'fb-waist-side']
    },
    {
      id: 'fb-side-seam',
      name: 'Front Side Seam',
      startPoint: fSideWaist,
      endPoint: fUnderarm,
      lengthCm: fbSideSeam.lengthCm(),
      type: 'straight',
      pairedPieceId: 'piece-bodice-back',
      pairedSeamName: 'Back Side Seam',
      segmentId: 'fb-side-seam'
    },
    {
      id: 'fb-armhole-seam',
      name: 'Front Armhole',
      startPoint: fUnderarm,
      endPoint: fShoulderTip,
      lengthCm: fbArmhole.lengthCm(),
      type: 'curved',
      segmentId: 'fb-armhole'
    },
    {
      id: 'fb-shoulder-seam',
      name: 'Front Shoulder Seam',
      startPoint: fShoulderTip,
      endPoint: fNeckShoulder,
      lengthCm: fbShoulder.lengthCm(),
      type: 'straight',
      pairedPieceId: 'piece-bodice-back',
      pairedSeamName: 'Back Shoulder Seam',
      segmentId: 'fb-shoulder'
    },
    {
      id: 'fb-neck',
      name: 'Front Neckline',
      startPoint: fNeckShoulder,
      endPoint: cfNeck,
      lengthCm: Number((fbNeckCurve.lengthCm() + fbNeckSquare.lengthCm()).toFixed(2)),
      type: 'curved',
      endTangent: { x: -1, y: 0 },
      segmentIds: ['fb-neck-curve', 'fb-neck-square']
    }
  ];

  const frontGrainline: GrainLine = {
    start: { x: Number((halfBustSpan * 0.6).toFixed(2)), y: Number((scyeY * 0.8).toFixed(2)) },
    end: { x: Number((halfBustSpan * 0.6).toFixed(2)), y: Number((frontWaistLength - 4.0).toFixed(2)) },
    direction: 'vertical'
  };

  const frontBoundingBox = computeBoundingBox(
    frontOffsetResult.cuttingContour.toPolyline(16).concat([cfWaist, cfNeck, fSideWaist, fUnderarm, fShoulderTip])
  );

  const frontPiece: PatternPiece = {
    id: 'piece-bodice-front',
    pieceCode: 'BOD-F-01',
    name: 'Front Bodice Panel',
    garmentCategory: 'bodice',
    cutCount: 1,
    onFold: true,
    material: 'self',
    cutPathData: frontOffsetResult.cuttingContour.toSvgPath(),
    sewPathData: frontStitchingContour.toSvgPath(),
    seamAllowanceWidthCm: sideSeamAllowance,
    grainline: frontGrainline,
    darts: [frontWaistDart],
    notches: frontNotches,
    seams: frontSeams,
    boundingBox: frontBoundingBox,
    drillHoles: [fDartApex],
    description: `Front bodice panel cut on fold with contour waist dart and 90° perpendicular fold tangency. Drafted for ${design.silhouette} profile with ${dims.appliedBustEaseCm}cm bust ease.`,
    stitchingContour: frontStitchingContour,
    cuttingContour: frontOffsetResult.cuttingContour,
    offsetResult: frontOffsetResult
  };

  // =========================================================================
  // 11. BACK BODICE CONSTRUCTION
  // =========================================================================

  const cbNeck: Point = { x: 0, y: backNeckDepth };
  const cbNeckSquareEnd: Point = { x: 2.0, y: backNeckDepth }; // 2.0cm perpendicular zone
  const cbWaist: Point = { x: 0, y: backWaistLength };
  const cbWaistSquareEnd: Point = { x: 2.5, y: backWaistLength }; // 2.5cm perpendicular zone

  // Back Waist Dart: Centered at 45% of back waist width, terminates 3.5cm below scye depth
  const bDartCenterX = Number((backQuarterWaist * 0.45).toFixed(2));
  const bDartApexY = Number((scyeY + 3.5).toFixed(2));
  const bDartApex: Point = { x: bDartCenterX, y: bDartApexY };
  const bDartLeft: Point = { x: Number((bDartCenterX - backDartWidth / 2).toFixed(2)), y: backWaistLength };
  const bDartRight: Point = { x: Number((bDartCenterX + backDartWidth / 2).toFixed(2)), y: backWaistLength };

  // Back Armhole Curve (Cubic Bézier passing across back level)
  const backScyeLevelY = Number((scyeY * 0.60).toFixed(2));
  const acrossBackHalf = Number((acrossBack / 2 + 0.5).toFixed(2));
  const bArmholeCp1: Point = {
    x: Number((bShoulderTip.x + (acrossBackHalf - bShoulderTip.x) * 0.35).toFixed(2)),
    y: Number((bShoulderTip.y + (backScyeLevelY - bShoulderTip.y) * 0.5).toFixed(2))
  };
  const bArmholeCp2: Point = {
    x: Number((acrossBackHalf).toFixed(2)),
    y: Number((backScyeLevelY + (scyeY - backScyeLevelY) * 0.65).toFixed(2))
  };

  // Back Neckline Curve (Cubic Bézier meeting CB at exact 90° tangency)
  const bNeckCp1: Point = {
    x: Number((bNeckShoulder.x * 0.5).toFixed(2)),
    y: Number((bNeckShoulder.y + backNeckDepth * 0.4).toFixed(2))
  };
  const bNeckCp2: Point = {
    x: Number((cbNeckSquareEnd.x + (bNeckShoulder.x - cbNeckSquareEnd.x) * 0.2).toFixed(2)),
    y: backNeckDepth
  };

  // Assemble Back Stitching Segments (Clockwise: CB Seam -> Waist -> Side -> Armhole -> Shoulder -> Neckline)
  const bbCenterBack = new LineSegment('bb-center-back', cbNeck, cbWaist, sideSeamAllowance, false, 'bb-center-back');
  const bbWaistSquare = new LineSegment('bb-waist-square', cbWaist, cbWaistSquareEnd, waistAllowance, false, 'bb-waist');
  const bbWaistMid = new LineSegment('bb-waist-mid', cbWaistSquareEnd, bDartLeft, waistAllowance, false, 'bb-waist');
  const bbDartCap = new LineSegment('bb-dart-cap', bDartLeft, bDartRight, waistAllowance, false, 'bb-waist');
  const bbWaistSide = new LineSegment('bb-waist-side', bDartRight, bSideWaist, waistAllowance, false, 'bb-waist');
  const bbSideSeam = new LineSegment('bb-side-seam', bSideWaist, bUnderarm, sideSeamAllowance, false, 'bb-side-seam');
  const bbArmhole = new CubicBezierCurve('bb-armhole', bUnderarm, bArmholeCp2, bArmholeCp1, bShoulderTip, armholeAllowance, false, 'bb-armhole');
  const bbShoulder = new LineSegment('bb-shoulder', bShoulderTip, bNeckShoulder, shoulderAllowance, false, 'bb-shoulder');
  const bbNeckCurve = new CubicBezierCurve('bb-neck-curve', bNeckShoulder, bNeckCp1, bNeckCp2, cbNeckSquareEnd, neckAllowance, false, 'bb-neck');
  const bbNeckSquare = new LineSegment('bb-neck-square', cbNeckSquareEnd, cbNeck, neckAllowance, false, 'bb-neck');

  const backStitchingContour = new GeometricContour(
    'back-bodice-stitching',
    [
      bbCenterBack,
      bbWaistSquare,
      bbWaistMid,
      bbDartCap,
      bbWaistSide,
      bbSideSeam,
      bbArmhole,
      bbShoulder,
      bbNeckCurve,
      bbNeckSquare
    ],
    true
  );

  const backOffsetResult = generateCuttingContour(backStitchingContour, {
    defaultAllowanceCm: sideSeamAllowance,
    bezierToleranceCm,
    miterLimit
  });

  const backWaistDart: Dart = {
    id: 'dart-back-waist',
    apex: bDartApex,
    legLeft: bDartLeft,
    legRight: bDartRight,
    widthCm: backDartWidth,
    lengthCm: Number(distance(bDartApex, bDartLeft).toFixed(2))
  };

  const backNotches: Notch[] = [
    {
      id: 'notch-bb-across-back-1',
      position: { x: acrossBackHalf, y: backScyeLevelY - 0.7 },
      normalAngleDeg: 0,
      type: 'single',
      label: 'BACK SCYE DOUBLE NOTCH 1'
    },
    {
      id: 'notch-bb-across-back-2',
      position: { x: acrossBackHalf, y: backScyeLevelY + 0.7 },
      normalAngleDeg: 0,
      type: 'double',
      label: 'BACK SCYE DOUBLE NOTCH 2'
    },
    {
      id: 'notch-bb-side-waist',
      position: bSideWaist,
      normalAngleDeg: -90,
      type: 'single',
      label: 'WAIST MATCH'
    }
  ];

  const backSeams: SeamLine[] = [
    {
      id: 'bb-center-back',
      name: 'Center Back Seam',
      startPoint: cbNeck,
      endPoint: cbWaist,
      lengthCm: bbCenterBack.lengthCm(),
      type: 'straight',
      segmentId: 'bb-center-back'
    },
    {
      id: 'bb-waist',
      name: 'Back Waist',
      startPoint: cbWaist,
      endPoint: bSideWaist,
      lengthCm: Number((bbWaistSquare.lengthCm() + bbWaistMid.lengthCm() + bbDartCap.lengthCm() + bbWaistSide.lengthCm()).toFixed(2)),
      type: 'straight',
      startTangent: { x: 1, y: 0 },
      endTangent: { x: 1, y: 0 },
      segmentIds: ['bb-waist-square', 'bb-waist-mid', 'bb-dart-cap', 'bb-waist-side']
    },
    {
      id: 'bb-side-seam',
      name: 'Back Side Seam',
      startPoint: bSideWaist,
      endPoint: bUnderarm,
      lengthCm: bbSideSeam.lengthCm(),
      type: 'straight',
      pairedPieceId: 'piece-bodice-front',
      pairedSeamName: 'Front Side Seam',
      segmentId: 'bb-side-seam'
    },
    {
      id: 'bb-armhole-seam',
      name: 'Back Armhole',
      startPoint: bUnderarm,
      endPoint: bShoulderTip,
      lengthCm: bbArmhole.lengthCm(),
      type: 'curved',
      segmentId: 'bb-armhole'
    },
    {
      id: 'bb-shoulder-seam',
      name: 'Back Shoulder Seam',
      startPoint: bShoulderTip,
      endPoint: bNeckShoulder,
      lengthCm: bbShoulder.lengthCm(),
      type: 'straight',
      pairedPieceId: 'piece-bodice-front',
      pairedSeamName: 'Front Shoulder Seam',
      segmentId: 'bb-shoulder'
    },
    {
      id: 'bb-neck',
      name: 'Back Neckline',
      startPoint: bNeckShoulder,
      endPoint: cbNeck,
      lengthCm: Number((bbNeckCurve.lengthCm() + bbNeckSquare.lengthCm()).toFixed(2)),
      type: 'curved',
      endTangent: { x: -1, y: 0 },
      segmentIds: ['bb-neck-curve', 'bb-neck-square']
    }
  ];

  const backGrainline: GrainLine = {
    start: { x: Number((backQuarterWaist * 0.4).toFixed(2)), y: Number((scyeY * 0.8).toFixed(2)) },
    end: { x: Number((backQuarterWaist * 0.4).toFixed(2)), y: Number((backWaistLength - 4.0).toFixed(2)) },
    direction: 'vertical'
  };

  const backBoundingBox = computeBoundingBox(
    backOffsetResult.cuttingContour.toPolyline(16).concat([cbWaist, cbNeck, bSideWaist, bUnderarm, bShoulderTip])
  );

  const backPiece: PatternPiece = {
    id: 'piece-bodice-back',
    pieceCode: 'BOD-B-01',
    name: 'Back Bodice Panel',
    garmentCategory: 'bodice',
    cutCount: 2,
    onFold: false,
    material: 'self',
    cutPathData: backOffsetResult.cuttingContour.toSvgPath(),
    sewPathData: backStitchingContour.toSvgPath(),
    seamAllowanceWidthCm: sideSeamAllowance,
    grainline: backGrainline,
    darts: [backWaistDart],
    notches: backNotches,
    seams: backSeams,
    boundingBox: backBoundingBox,
    drillHoles: [bDartApex],
    description: `Back bodice panel cut in 2 pieces with scapula contour waist dart, double sleeve alignment notch, and matched side seam length (${frontSideSeamLength}cm).`,
    stitchingContour: backStitchingContour,
    cuttingContour: backOffsetResult.cuttingContour,
    offsetResult: backOffsetResult
  };

  return [frontPiece, backPiece];
}
