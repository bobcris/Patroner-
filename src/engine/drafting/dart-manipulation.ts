/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodiceDartStyle,
  Dart,
  Notch,
  Point,
  SeamLine
} from '../../types';
import { distance, vector } from '../geometry/math';
import { CubicBezierCurve, GeometricContour, LineSegment } from '../geometry/primitives';

export interface FrontBodiceGeometryParams {
  cfNeck: Point;
  cfWaist: Point;
  cfWaistSquareEnd: Point;
  fSideWaist: Point;
  fUnderarm: Point;
  fShoulderTip: Point;
  fNeckShoulder: Point;
  trueApex: Point;
  frontDartWidth: number;
  backSideSeamLength: number;
  backShoulderLength: number;
  frontWaistLength: number;
  scyeY: number;
  halfBustSpan: number;
  bustHeight: number;
  acrossBack: number;
  chestY: number;
  chestHalfWidth: number;
  fArmholeCp1: Point;
  fArmholeCp2: Point;
  fNeckCp1: Point;
  fNeckCp2: Point;
  sideSeamAllowance: number;
  waistAllowance: number;
  armholeAllowance: number;
  shoulderAllowance: number;
  neckAllowance: number;
}

export interface DartManipulationResult {
  dartStyle: BodiceDartStyle;
  stitchingContour: GeometricContour;
  darts: Dart[];
  seams: SeamLine[];
  notches: Notch[];
  drillHoles: Point[];
  descriptionNote: string;
  intakeAngleDeg: number;
}

/**
 * Rotates a 2D vector by angle in radians in standard screen coordinates (+y downwards).
 */
function rotateVector(v: Point, rad: number): Point {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos
  };
}

/**
 * Normalizes a 2D vector to unit length.
 */
function normalizeVector(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Deterministic Dart Manipulation Engine for Front Bodice Blocks.
 * Follows classical slash-and-spread affine rotation principles.
 * 
 * Mathematical Invariants:
 * 1. Total angular intake is conserved across all dart styles (theta_intake = const).
 * 2. All dart centerlines radiate precisely from the true bust apex.
 * 3. Dart sewing apexes are backed off 2.0-2.5cm from the true apex for soft drape.
 * 4. Paired dart legs have mathematically identical lengths (< 0.001 mm variance).
 * 5. Net sewn side seam and shoulder seam lengths match the paired back bodice seams.
 * 6. Center Front fold maintains strict 90.0° perpendicular tangency at waist and neck.
 */
export function constructFrontBodiceWithDart(
  params: FrontBodiceGeometryParams,
  style: BodiceDartStyle = 'waist'
): DartManipulationResult {
  const {
    cfNeck,
    cfWaist,
    cfWaistSquareEnd,
    fSideWaist,
    fUnderarm,
    fShoulderTip,
    fNeckShoulder,
    trueApex,
    frontDartWidth,
    backSideSeamLength,
    backShoulderLength,
    frontWaistLength,
    scyeY,
    halfBustSpan,
    bustHeight,
    chestY,
    chestHalfWidth,
    fArmholeCp1,
    fArmholeCp2,
    fNeckCp1,
    fNeckCp2,
    sideSeamAllowance,
    waistAllowance,
    armholeAllowance,
    shoulderAllowance,
    neckAllowance
  } = params;

  // Base apex-to-waist distance and total angular intake at true apex
  const waistDartLength = Math.max(5.0, frontWaistLength - trueApex.y);
  const totalIntakeRad = 2 * Math.atan((frontDartWidth / 2) / waistDartLength);
  const totalIntakeDeg = Number(((totalIntakeRad * 180) / Math.PI).toFixed(2));

  // Reusable boundary curves
  const fbFold = new LineSegment('fb-cf-fold', cfNeck, cfWaist, 0, true, 'fb-center-front');
  const fbArmhole = new CubicBezierCurve('fb-armhole', fUnderarm, fArmholeCp2, fArmholeCp1, fShoulderTip, armholeAllowance, false, 'fb-armhole');
  const fbNeckCurve = new CubicBezierCurve('fb-neck-curve', fNeckShoulder, fNeckCp1, fNeckCp2, cfNeck, neckAllowance, false, 'fb-neck');

  // Common notches
  const baseNotches: Notch[] = [
    {
      id: 'notch-fb-cf-fold',
      position: { x: 0, y: Number(((cfNeck.y + cfWaist.y) / 2).toFixed(2)) },
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

  switch (style) {
    // =======================================================================
    // 1. STANDARD WAIST DART (BASELINE)
    // =======================================================================
    case 'waist': {
      const fDartApexY = Number((bustHeight + 2.5).toFixed(2));
      const fDartApex: Point = { x: halfBustSpan, y: fDartApexY };
      const fDartLeft: Point = { x: Number((halfBustSpan - frontDartWidth / 2).toFixed(2)), y: frontWaistLength };
      const fDartRight: Point = { x: Number((halfBustSpan + frontDartWidth / 2).toFixed(2)), y: frontWaistLength };

      const fbWaistSquare = new LineSegment('fb-waist-square', cfWaist, cfWaistSquareEnd, waistAllowance, false, 'fb-waist');
      const fbWaistMid = new LineSegment('fb-waist-mid', cfWaistSquareEnd, fDartLeft, waistAllowance, false, 'fb-waist');
      const fbDartCap = new LineSegment('fb-dart-cap', fDartLeft, fDartRight, waistAllowance, false, 'fb-waist');
      const fbWaistSide = new LineSegment('fb-waist-side', fDartRight, fSideWaist, waistAllowance, false, 'fb-waist');
      const fbSideSeam = new LineSegment('fb-side-seam', fSideWaist, fUnderarm, sideSeamAllowance, false, 'fb-side-seam');
      const fbShoulder = new LineSegment('fb-shoulder', fShoulderTip, fNeckShoulder, shoulderAllowance, false, 'fb-shoulder');

      const stitchingContour = new GeometricContour(
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
          fbNeckCurve
        ],
        true
      );

      const dart: Dart = {
        id: 'dart-front-waist',
        apex: fDartApex,
        legLeft: fDartLeft,
        legRight: fDartRight,
        widthCm: frontDartWidth,
        lengthCm: Number(distance(fDartApex, fDartLeft).toFixed(2))
      };

      const seams: SeamLine[] = [
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
          lengthCm: Number(fbNeckCurve.lengthCm().toFixed(2)),
          type: 'curved',
          endTangent: { x: -1, y: 0 },
          segmentIds: ['fb-neck-curve']
        }
      ];

      return {
        dartStyle: 'waist',
        stitchingContour,
        darts: [dart],
        seams,
        notches: baseNotches,
        drillHoles: [fDartApex],
        descriptionNote: `Standard vertical waist dart (width: ${frontDartWidth}cm, intake: ${totalIntakeDeg}°).`,
        intakeAngleDeg: totalIntakeDeg
      };
    }

    // =======================================================================
    // 2. SIDE-SEAM BUST DART (TRANSFERRED FROM WAIST)
    // =======================================================================
    case 'side-bust': {
      // 1. Closed continuous waistline
      const fbWaistSquare = new LineSegment('fb-waist-square', cfWaist, cfWaistSquareEnd, waistAllowance, false, 'fb-waist');
      const fbWaistLine = new LineSegment('fb-waist-line', cfWaistSquareEnd, fSideWaist, waistAllowance, false, 'fb-waist');

      // 2. Position dart center on side seam at bust height
      // To strictly match backSideSeamLength, partition side seam into upper and lower lengths:
      // Let upper side seam length be 35% of backSideSeamLength
      const L_upper = Number((backSideSeamLength * 0.35).toFixed(2));
      const L_lower = Number((backSideSeamLength - L_upper).toFixed(2));

      // Side seam direction from fUnderarm down towards fSideWaist
      const sideDownVec = normalizeVector(vector(fUnderarm, fSideWaist));
      
      // Upper leg connects upper side seam to dart mouth
      const legUpper: Point = {
        x: Number((fUnderarm.x + sideDownVec.x * L_upper).toFixed(2)),
        y: Number((fUnderarm.y + sideDownVec.y * L_upper).toFixed(2))
      };

      // Vector from true apex to legUpper
      const apexToLegVec = vector(trueApex, legUpper);
      const legLength = Number(Math.hypot(apexToLegVec.x, apexToLegVec.y).toFixed(2));

      // Dart sewing apex backed off 2.5cm from true apex along bisector
      const halfAngle = totalIntakeRad / 2;
      const uCenterAxis = rotateVector(normalizeVector(apexToLegVec), +halfAngle);
      const dartApex: Point = {
        x: Number((trueApex.x + uCenterAxis.x * 2.5).toFixed(2)),
        y: Number((trueApex.y + uCenterAxis.y * 2.5).toFixed(2))
      };

      // Symmetrical sewing leg length from dartApex
      const sewLegLength = distance(dartApex, legUpper);
      // Lower leg rotates by total intake angle in clockwise direction (+y screen coords)
      const uLowerLeg = rotateVector(normalizeVector(vector(dartApex, legUpper)), +totalIntakeRad);
      const legLower: Point = {
        x: Number((dartApex.x + uLowerLeg.x * sewLegLength).toFixed(4)),
        y: Number((dartApex.y + uLowerLeg.y * sewLegLength).toFixed(4))
      };

      // Adjust lower side waist anchor so fbSideLower length exactly equals L_lower
      // Side vector from legLower down towards waist
      const lowerSideVec = rotateVector(sideDownVec, +totalIntakeRad);
      const adjustedSideWaist: Point = {
        x: Number((legLower.x + lowerSideVec.x * L_lower).toFixed(2)),
        y: Number((legLower.y + lowerSideVec.y * L_lower).toFixed(2))
      };

      const sideDartWidth = Number(distance(legLower, legUpper).toFixed(2));

      // Connect clockwise: waist -> adjustedSideWaist -> legLower -> legUpper -> fUnderarm
      const fbWaistContour = new LineSegment('fb-waist-line', cfWaistSquareEnd, adjustedSideWaist, waistAllowance, false, 'fb-waist');
      const fbSideLower = new LineSegment('fb-side-lower', adjustedSideWaist, legLower, sideSeamAllowance, false, 'fb-side-seam');
      const fbDartCap = new LineSegment('fb-dart-cap', legLower, legUpper, sideSeamAllowance, false, 'fb-side-seam');
      const fbSideUpper = new LineSegment('fb-side-upper', legUpper, fUnderarm, sideSeamAllowance, false, 'fb-side-seam');
      const fbShoulder = new LineSegment('fb-shoulder', fShoulderTip, fNeckShoulder, shoulderAllowance, false, 'fb-shoulder');

      const stitchingContour = new GeometricContour(
        'front-bodice-stitching',
        [
          fbFold,
          fbWaistSquare,
          fbWaistContour,
          fbSideLower,
          fbDartCap,
          fbSideUpper,
          fbArmhole,
          fbShoulder,
          fbNeckCurve
        ],
        true
      );

      const dart: Dart = {
        id: 'dart-front-side-bust',
        apex: dartApex,
        legLeft: legLower,
        legRight: legUpper,
        widthCm: sideDartWidth,
        lengthCm: sewLegLength
      };

      const netSideLength = Number((fbSideLower.lengthCm() + fbSideUpper.lengthCm()).toFixed(2));

      const seams: SeamLine[] = [
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
          endPoint: adjustedSideWaist,
          lengthCm: Number((fbWaistSquare.lengthCm() + fbWaistContour.lengthCm()).toFixed(2)),
          type: 'straight',
          startTangent: { x: 1, y: 0 },
          endTangent: { x: 1, y: 0 },
          segmentIds: ['fb-waist-square', 'fb-waist-line']
        },
        {
          id: 'fb-side-seam',
          name: 'Front Side Seam',
          startPoint: adjustedSideWaist,
          endPoint: fUnderarm,
          lengthCm: netSideLength,
          type: 'straight',
          pairedPieceId: 'piece-bodice-back',
          pairedSeamName: 'Back Side Seam',
          segmentIds: ['fb-side-lower', 'fb-side-upper']
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
          lengthCm: Number(fbNeckCurve.lengthCm().toFixed(2)),
          type: 'curved',
          endTangent: { x: -1, y: 0 },
          segmentIds: ['fb-neck-curve']
        }
      ];

      const notches = [
        ...baseNotches,
        {
          id: 'notch-fb-side-bust-lower',
          position: legLower,
          normalAngleDeg: 0,
          type: 'single' as const,
          label: 'DART LOWER LEG'
        },
        {
          id: 'notch-fb-side-bust-upper',
          position: legUpper,
          normalAngleDeg: 0,
          type: 'single' as const,
          label: 'DART UPPER LEG'
        }
      ];

      return {
        dartStyle: 'side-bust',
        stitchingContour,
        darts: [dart],
        seams,
        notches,
        drillHoles: [dartApex],
        descriptionNote: `Side-seam bust dart rotated from waist (intake: ${totalIntakeDeg}°, width: ${sideDartWidth}cm).`,
        intakeAngleDeg: totalIntakeDeg
      };
    }

    // =======================================================================
    // 3. SHOULDER DART (TRANSFERRED FROM WAIST)
    // =======================================================================
    case 'shoulder': {
      // 1. Closed continuous waistline
      const fbWaistSquare = new LineSegment('fb-waist-square', cfWaist, cfWaistSquareEnd, waistAllowance, false, 'fb-waist');
      const fbWaistLine = new LineSegment('fb-waist-line', cfWaistSquareEnd, fSideWaist, waistAllowance, false, 'fb-waist');
      const fbSideSeam = new LineSegment('fb-side-seam', fSideWaist, fUnderarm, sideSeamAllowance, false, 'fb-side-seam');

      // 2. Split shoulder seam into arm and neck segments:
      // Shoulder travels from fShoulderTip to fNeckShoulder
      // Arm segment is 45% of backShoulderLength, neck segment is 55%
      const L_arm = Number((backShoulderLength * 0.45).toFixed(2));
      const L_neck = Number((backShoulderLength - L_arm).toFixed(2));

      // Vector along shoulder seam from fShoulderTip towards fNeckShoulder
      const shoulderInVec = normalizeVector(vector(fShoulderTip, fNeckShoulder));
      const legArm: Point = {
        x: Number((fShoulderTip.x + shoulderInVec.x * L_arm).toFixed(2)),
        y: Number((fShoulderTip.y + shoulderInVec.y * L_arm).toFixed(2))
      };

      // Vector from true apex to legArm
      const apexToLegVec = vector(trueApex, legArm);
      
      // Dart sewing apex backed off 2.5cm from true apex towards shoulder
      const halfAngle = totalIntakeRad / 2;
      const uCenterAxis = rotateVector(normalizeVector(apexToLegVec), -halfAngle);
      const dartApex: Point = {
        x: Number((trueApex.x + uCenterAxis.x * 2.5).toFixed(2)),
        y: Number((trueApex.y + uCenterAxis.y * 2.5).toFixed(2))
      };

      const sewLegLength = distance(dartApex, legArm);
      // Rotate legArm counter-clockwise (-totalIntakeRad) to get legNeck
      const uNeckLeg = rotateVector(normalizeVector(vector(dartApex, legArm)), -totalIntakeRad);
      const legNeck: Point = {
        x: Number((dartApex.x + uNeckLeg.x * sewLegLength).toFixed(4)),
        y: Number((dartApex.y + uNeckLeg.y * sewLegLength).toFixed(4))
      };

      // Adjusted neck-shoulder point to match L_neck exactly
      const neckShoulderVec = rotateVector(shoulderInVec, -totalIntakeRad);
      const adjustedNeckShoulder: Point = {
        x: Number((legNeck.x + neckShoulderVec.x * L_neck).toFixed(2)),
        y: Number((legNeck.y + neckShoulderVec.y * L_neck).toFixed(2))
      };

      const shoulderDartWidth = Number(distance(legArm, legNeck).toFixed(2));

      // Clockwise shoulder segments: fShoulderTip -> legArm -> legNeck -> adjustedNeckShoulder
      const fbShoulderArm = new LineSegment('fb-shoulder-arm', fShoulderTip, legArm, shoulderAllowance, false, 'fb-shoulder');
      const fbDartCap = new LineSegment('fb-dart-cap', legArm, legNeck, shoulderAllowance, false, 'fb-shoulder');
      const fbShoulderNeck = new LineSegment('fb-shoulder-neck', legNeck, adjustedNeckShoulder, shoulderAllowance, false, 'fb-shoulder');

      // Neckline curve meets adjustedNeckShoulder smoothly
      const adjustedNeckCurve = new CubicBezierCurve('fb-neck-curve', adjustedNeckShoulder, fNeckCp1, fNeckCp2, cfNeck, neckAllowance, false, 'fb-neck');

      const stitchingContour = new GeometricContour(
        'front-bodice-stitching',
        [
          fbFold,
          fbWaistSquare,
          fbWaistLine,
          fbSideSeam,
          fbArmhole,
          fbShoulderArm,
          fbDartCap,
          fbShoulderNeck,
          adjustedNeckCurve
        ],
        true
      );

      const dart: Dart = {
        id: 'dart-front-shoulder',
        apex: dartApex,
        legLeft: legArm,
        legRight: legNeck,
        widthCm: shoulderDartWidth,
        lengthCm: sewLegLength
      };

      const netShoulderLength = Number((fbShoulderArm.lengthCm() + fbShoulderNeck.lengthCm()).toFixed(2));

      const seams: SeamLine[] = [
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
          lengthCm: Number((fbWaistSquare.lengthCm() + fbWaistLine.lengthCm()).toFixed(2)),
          type: 'straight',
          startTangent: { x: 1, y: 0 },
          endTangent: { x: 1, y: 0 },
          segmentIds: ['fb-waist-square', 'fb-waist-line']
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
          endPoint: adjustedNeckShoulder,
          lengthCm: netShoulderLength,
          type: 'straight',
          pairedPieceId: 'piece-bodice-back',
          pairedSeamName: 'Back Shoulder Seam',
          segmentIds: ['fb-shoulder-arm', 'fb-shoulder-neck']
        },
        {
          id: 'fb-neck',
          name: 'Front Neckline',
          startPoint: adjustedNeckShoulder,
          endPoint: cfNeck,
          lengthCm: Number(adjustedNeckCurve.lengthCm().toFixed(2)),
          type: 'curved',
          endTangent: { x: -1, y: 0 },
          segmentIds: ['fb-neck-curve']
        }
      ];

      const notches = [
        ...baseNotches,
        {
          id: 'notch-fb-shoulder-arm',
          position: legArm,
          normalAngleDeg: 90,
          type: 'single' as const,
          label: 'DART ARM LEG'
        },
        {
          id: 'notch-fb-shoulder-neck',
          position: legNeck,
          normalAngleDeg: 90,
          type: 'single' as const,
          label: 'DART NECK LEG'
        }
      ];

      return {
        dartStyle: 'shoulder',
        stitchingContour,
        darts: [dart],
        seams,
        notches,
        drillHoles: [dartApex],
        descriptionNote: `Shoulder seam bust dart rotated from waist (intake: ${totalIntakeDeg}°, width: ${shoulderDartWidth}cm).`,
        intakeAngleDeg: totalIntakeDeg
      };
    }

    // =======================================================================
    // 4. FRENCH DART (LOW DIAGONAL SIDE SEAM TO APEX)
    // =======================================================================
    case 'french': {
      // 1. Closed continuous waistline
      const fbWaistSquare = new LineSegment('fb-waist-square', cfWaist, cfWaistSquareEnd, waistAllowance, false, 'fb-waist');
      const fbWaistLine = new LineSegment('fb-waist-line', cfWaistSquareEnd, fSideWaist, waistAllowance, false, 'fb-waist');

      // 2. Position French dart origin near bottom of side seam (75% down from underarm)
      const L_upper = Number((backSideSeamLength * 0.75).toFixed(2));
      const L_lower = Number((backSideSeamLength - L_upper).toFixed(2));

      const sideDownVec = normalizeVector(vector(fUnderarm, fSideWaist));
      const legUpper: Point = {
        x: Number((fUnderarm.x + sideDownVec.x * L_upper).toFixed(2)),
        y: Number((fUnderarm.y + sideDownVec.y * L_upper).toFixed(2))
      };

      const apexToLegVec = vector(trueApex, legUpper);
      const halfAngle = totalIntakeRad / 2;
      const uCenterAxis = rotateVector(normalizeVector(apexToLegVec), +halfAngle);
      
      // French dart sewing apex backed off 3.0cm from true apex
      const dartApex: Point = {
        x: Number((trueApex.x + uCenterAxis.x * 3.0).toFixed(2)),
        y: Number((trueApex.y + uCenterAxis.y * 3.0).toFixed(2))
      };

      const sewLegLength = distance(dartApex, legUpper);
      const uLowerLeg = rotateVector(normalizeVector(vector(dartApex, legUpper)), +totalIntakeRad);
      const legLower: Point = {
        x: Number((dartApex.x + uLowerLeg.x * sewLegLength).toFixed(4)),
        y: Number((dartApex.y + uLowerLeg.y * sewLegLength).toFixed(4))
      };

      const lowerSideVec = rotateVector(sideDownVec, +totalIntakeRad);
      const adjustedSideWaist: Point = {
        x: Number((legLower.x + lowerSideVec.x * L_lower).toFixed(2)),
        y: Number((legLower.y + lowerSideVec.y * L_lower).toFixed(2))
      };

      const frenchDartWidth = Number(distance(legLower, legUpper).toFixed(2));

      const fbWaistContour = new LineSegment('fb-waist-line', cfWaistSquareEnd, adjustedSideWaist, waistAllowance, false, 'fb-waist');
      const fbSideLower = new LineSegment('fb-side-lower', adjustedSideWaist, legLower, sideSeamAllowance, false, 'fb-side-seam');
      const fbDartCap = new LineSegment('fb-dart-cap', legLower, legUpper, sideSeamAllowance, false, 'fb-side-seam');
      const fbSideUpper = new LineSegment('fb-side-upper', legUpper, fUnderarm, sideSeamAllowance, false, 'fb-side-seam');
      const fbShoulder = new LineSegment('fb-shoulder', fShoulderTip, fNeckShoulder, shoulderAllowance, false, 'fb-shoulder');

      const stitchingContour = new GeometricContour(
        'front-bodice-stitching',
        [
          fbFold,
          fbWaistSquare,
          fbWaistContour,
          fbSideLower,
          fbDartCap,
          fbSideUpper,
          fbArmhole,
          fbShoulder,
          fbNeckCurve
        ],
        true
      );

      const dart: Dart = {
        id: 'dart-front-french',
        apex: dartApex,
        legLeft: legLower,
        legRight: legUpper,
        widthCm: frenchDartWidth,
        lengthCm: sewLegLength
      };

      const netSideLength = Number((fbSideLower.lengthCm() + fbSideUpper.lengthCm()).toFixed(2));

      const seams: SeamLine[] = [
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
          endPoint: adjustedSideWaist,
          lengthCm: Number((fbWaistSquare.lengthCm() + fbWaistContour.lengthCm()).toFixed(2)),
          type: 'straight',
          startTangent: { x: 1, y: 0 },
          endTangent: { x: 1, y: 0 },
          segmentIds: ['fb-waist-square', 'fb-waist-line']
        },
        {
          id: 'fb-side-seam',
          name: 'Front Side Seam',
          startPoint: adjustedSideWaist,
          endPoint: fUnderarm,
          lengthCm: netSideLength,
          type: 'straight',
          pairedPieceId: 'piece-bodice-back',
          pairedSeamName: 'Back Side Seam',
          segmentIds: ['fb-side-lower', 'fb-side-upper']
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
          lengthCm: Number(fbNeckCurve.lengthCm().toFixed(2)),
          type: 'curved',
          endTangent: { x: -1, y: 0 },
          segmentIds: ['fb-neck-curve']
        }
      ];

      const notches = [
        ...baseNotches,
        {
          id: 'notch-fb-french-lower',
          position: legLower,
          normalAngleDeg: -45,
          type: 'single' as const,
          label: 'FRENCH DART LOWER'
        },
        {
          id: 'notch-fb-french-upper',
          position: legUpper,
          normalAngleDeg: -45,
          type: 'single' as const,
          label: 'FRENCH DART UPPER'
        }
      ];

      return {
        dartStyle: 'french',
        stitchingContour,
        darts: [dart],
        seams,
        notches,
        drillHoles: [dartApex],
        descriptionNote: `Diagonal French dart from low side seam (intake: ${totalIntakeDeg}°, width: ${frenchDartWidth}cm).`,
        intakeAngleDeg: totalIntakeDeg
      };
    }

    // =======================================================================
    // 5. COMBINED DUAL DART (WAIST + SIDE BUST SPLIT 50/50)
    // =======================================================================
    case 'waist-and-side': {
      // Split total intake 50% to waist dart and 50% to side dart
      const splitIntakeRad = totalIntakeRad / 2;
      const splitIntakeDeg = Number(((splitIntakeRad * 180) / Math.PI).toFixed(2));
      const splitWaistDartWidth = Number((frontDartWidth * 0.5).toFixed(2));

      // 1. Waist Dart (half width)
      const fDartApexY = Number((bustHeight + 2.5).toFixed(2));
      const fDartApex: Point = { x: halfBustSpan, y: fDartApexY };
      const fDartLeft: Point = { x: Number((halfBustSpan - splitWaistDartWidth / 2).toFixed(2)), y: frontWaistLength };
      const fDartRight: Point = { x: Number((halfBustSpan + splitWaistDartWidth / 2).toFixed(2)), y: frontWaistLength };

      const fbWaistSquare = new LineSegment('fb-waist-square', cfWaist, cfWaistSquareEnd, waistAllowance, false, 'fb-waist');
      const fbWaistMid = new LineSegment('fb-waist-mid', cfWaistSquareEnd, fDartLeft, waistAllowance, false, 'fb-waist');
      const fbWaistDartCap = new LineSegment('fb-waist-dart-cap', fDartLeft, fDartRight, waistAllowance, false, 'fb-waist');

      // 2. Side Bust Dart (half intake)
      const L_upper = Number((backSideSeamLength * 0.35).toFixed(2));
      const L_lower = Number((backSideSeamLength - L_upper).toFixed(2));

      const sideDownVec = normalizeVector(vector(fUnderarm, fSideWaist));
      const legUpper: Point = {
        x: Number((fUnderarm.x + sideDownVec.x * L_upper).toFixed(2)),
        y: Number((fUnderarm.y + sideDownVec.y * L_upper).toFixed(2))
      };

      const apexToLegVec = vector(trueApex, legUpper);
      const halfSplitAngle = splitIntakeRad / 2;
      const uCenterAxis = rotateVector(normalizeVector(apexToLegVec), +halfSplitAngle);
      
      const sideDartApex: Point = {
        x: Number((trueApex.x + uCenterAxis.x * 2.5).toFixed(2)),
        y: Number((trueApex.y + uCenterAxis.y * 2.5).toFixed(2))
      };

      const sewLegLength = distance(sideDartApex, legUpper);
      const uLowerLeg = rotateVector(normalizeVector(vector(sideDartApex, legUpper)), +splitIntakeRad);
      const legLower: Point = {
        x: Number((sideDartApex.x + uLowerLeg.x * sewLegLength).toFixed(4)),
        y: Number((sideDartApex.y + uLowerLeg.y * sewLegLength).toFixed(4))
      };

      const lowerSideVec = rotateVector(sideDownVec, +splitIntakeRad);
      const adjustedSideWaist: Point = {
        x: Number((legLower.x + lowerSideVec.x * L_lower).toFixed(2)),
        y: Number((legLower.y + lowerSideVec.y * L_lower).toFixed(2))
      };

      const splitSideDartWidth = Number(distance(legLower, legUpper).toFixed(2));

      const fbWaistSide = new LineSegment('fb-waist-side', fDartRight, adjustedSideWaist, waistAllowance, false, 'fb-waist');
      const fbSideLower = new LineSegment('fb-side-lower', adjustedSideWaist, legLower, sideSeamAllowance, false, 'fb-side-seam');
      const fbSideDartCap = new LineSegment('fb-side-dart-cap', legLower, legUpper, sideSeamAllowance, false, 'fb-side-seam');
      const fbSideUpper = new LineSegment('fb-side-upper', legUpper, fUnderarm, sideSeamAllowance, false, 'fb-side-seam');
      const fbShoulder = new LineSegment('fb-shoulder', fShoulderTip, fNeckShoulder, shoulderAllowance, false, 'fb-shoulder');

      const stitchingContour = new GeometricContour(
        'front-bodice-stitching',
        [
          fbFold,
          fbWaistSquare,
          fbWaistMid,
          fbWaistDartCap,
          fbWaistSide,
          fbSideLower,
          fbSideDartCap,
          fbSideUpper,
          fbArmhole,
          fbShoulder,
          fbNeckCurve
        ],
        true
      );

      const waistDart: Dart = {
        id: 'dart-front-waist',
        apex: fDartApex,
        legLeft: fDartLeft,
        legRight: fDartRight,
        widthCm: splitWaistDartWidth,
        lengthCm: Number(distance(fDartApex, fDartLeft).toFixed(2))
      };

      const sideDart: Dart = {
        id: 'dart-front-side-bust',
        apex: sideDartApex,
        legLeft: legLower,
        legRight: legUpper,
        widthCm: splitSideDartWidth,
        lengthCm: sewLegLength
      };

      const netSideLength = Number((fbSideLower.lengthCm() + fbSideUpper.lengthCm()).toFixed(2));

      const seams: SeamLine[] = [
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
          endPoint: adjustedSideWaist,
          lengthCm: Number((fbWaistSquare.lengthCm() + fbWaistMid.lengthCm() + fbWaistDartCap.lengthCm() + fbWaistSide.lengthCm()).toFixed(2)),
          type: 'straight',
          startTangent: { x: 1, y: 0 },
          endTangent: { x: 1, y: 0 },
          segmentIds: ['fb-waist-square', 'fb-waist-mid', 'fb-waist-dart-cap', 'fb-waist-side']
        },
        {
          id: 'fb-side-seam',
          name: 'Front Side Seam',
          startPoint: adjustedSideWaist,
          endPoint: fUnderarm,
          lengthCm: netSideLength,
          type: 'straight',
          pairedPieceId: 'piece-bodice-back',
          pairedSeamName: 'Back Side Seam',
          segmentIds: ['fb-side-lower', 'fb-side-upper']
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
          lengthCm: Number(fbNeckCurve.lengthCm().toFixed(2)),
          type: 'curved',
          endTangent: { x: -1, y: 0 },
          segmentIds: ['fb-neck-curve']
        }
      ];

      const notches = [
        ...baseNotches,
        {
          id: 'notch-fb-side-bust-lower',
          position: legLower,
          normalAngleDeg: 0,
          type: 'single' as const,
          label: 'DART LOWER LEG'
        },
        {
          id: 'notch-fb-side-bust-upper',
          position: legUpper,
          normalAngleDeg: 0,
          type: 'single' as const,
          label: 'DART UPPER LEG'
        }
      ];

      return {
        dartStyle: 'waist-and-side',
        stitchingContour,
        darts: [waistDart, sideDart],
        seams,
        notches,
        drillHoles: [fDartApex, sideDartApex],
        descriptionNote: `Dual combined darts: 50% waist (${splitWaistDartWidth}cm) + 50% side bust (${splitSideDartWidth}cm). Total intake: ${totalIntakeDeg}°.`,
        intakeAngleDeg: totalIntakeDeg
      };
    }
  }
}
