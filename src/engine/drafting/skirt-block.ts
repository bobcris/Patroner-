/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, DesignSpecification, PatternPiece, Point, SeamLine } from '../../types';
import { approximateBezierLength, computeBoundingBox, distance, normalize, vector } from '../geometry/math';
import { generateCuttingContour } from '../geometry/offset';
import { CubicBezierCurve, GeometricContour, LineSegment } from '../geometry/primitives';
import { calculateGarmentDimensions } from '../measurements/standards';

export interface SkirtDraftOptions {
  seamAllowanceCm?: number;
  hemAllowanceCm?: number;
  waistAllowanceCm?: number;
}

/**
 * Deterministic drafting algorithm for a standard skirt block (Front & Back panels).
 * Follows industry-standard anthropometric pattern construction principles (Aldrich / Armstrong).
 * 
 * Mathematical Architecture (Milestone 02):
 * 1. Geometry-First: The stitching line defines the construction as a structured GeometricContour.
 * 2. True Offsets: The cutting contour is mathematically generated from the stitching contour
 *    using parallel normal offsets, miter/bevel corner intersections, and fold-edge handling.
 * 3. Seam-to-Geometry Linkage: All SeamLine measurements and tangents are derived directly
 *    from their underlying geometric segments, guaranteeing synchronization.
 * 4. Center-Line Tangency: Center Front and Center Back enforce strict 90.0° perpendicularity.
 * 5. Dart Parity: Left and right dart legs have identical mathematical length from apex.
 */
export function draftSkirtBlock(
  measurements: BodyMeasurements,
  design: DesignSpecification,
  options: SkirtDraftOptions = {}
): PatternPiece[] {
  const sideSeamAllowance = options.seamAllowanceCm ?? 1.5;
  const waistAllowance = options.waistAllowanceCm ?? 1.0;
  const hemAllowance = options.hemAllowanceCm ?? 3.0;

  // Calculate finished dimensions
  const dims = calculateGarmentDimensions(measurements, design.easeProfile, design.fabric);
  const totalLength = design.lengthCm || measurements.skirtLength || 64;
  const waistToHip = measurements.waistToHip || 20.5;

  // 1/4 of finished circumferences
  const quarterWaist = dims.garmentWaistCm / 4;
  const quarterHip = dims.garmentHipCm / 4;

  // Total waist-to-hip suppression needed per quarter
  const suppression = Math.max(0, quarterHip - quarterWaist);

  // Common side seam suppression:
  // Both front and back take the exact same side-seam curve so they pair with 0.0mm discrepancy
  const sideSuppression = Math.min(suppression * 0.5, 3.2);
  const sideWaistX = quarterHip - sideSuppression;
  const sideWaistY = -0.7; // 0.7cm rise at hip for natural waist contour

  // Darts absorb remaining suppression
  const remainingSuppression = Math.max(0, suppression - sideSuppression);
  
  // Front Dart geometry
  const frontDartWidth = Math.max(1.0, Math.min(2.0, remainingSuppression * 0.75));
  const frontDartLength = 9.5; // cm depth
  const frontDartPlacementX = 8.5; // cm from Center Front
  const frontDartApex: Point = { x: frontDartPlacementX, y: frontDartLength };
  // Symmetrical Y-depth at waist to ensure exact leg length parity
  const frontDartWaistY = -0.15;
  const frontDartLeft: Point = { x: frontDartPlacementX - frontDartWidth / 2, y: frontDartWaistY };
  const frontDartRight: Point = { x: frontDartPlacementX + frontDartWidth / 2, y: frontDartWaistY };

  // Back Dart geometry
  const backDartWidth = Math.max(1.2, Math.min(3.0, remainingSuppression));
  const backDartLength = 13.0; // cm depth
  const backDartPlacementX = quarterWaist * 0.45; // ~midway along back waist
  const backDartApex: Point = { x: backDartPlacementX, y: backDartLength };
  const backDartWaistY = -0.15;
  const backDartLeft: Point = { x: backDartPlacementX - backDartWidth / 2, y: backDartWaistY };
  const backDartRight: Point = { x: backDartPlacementX + backDartWidth / 2, y: backDartWaistY };

  // Flare adjustment based on silhouette
  let hemFlareCm = 0;
  if (design.silhouette === 'a-line') {
    hemFlareCm = 4.0;
  } else if (design.silhouette === 'flared') {
    hemFlareCm = 7.5;
  } else if (design.silhouette === 'pencil') {
    hemFlareCm = -1.8;
  }

  // Hip point on side seam
  const sideHip: Point = { x: quarterHip, y: waistToHip };

  // Side hem point:
  // When side seam is flared outward, the side hem is lifted slightly (by hemLift)
  // to preserve side-seam lower length and square the hem with the side seam
  const lowerNominalLength = totalLength - waistToHip;
  const sideSeamLowerHypot = Math.hypot(hemFlareCm, lowerNominalLength);
  const hemLift = hemFlareCm !== 0 ? Math.max(0, sideSeamLowerHypot - lowerNominalLength) : 0;
  const sideHem: Point = {
    x: quarterHip + hemFlareCm,
    y: Number((totalLength - hemLift).toFixed(2))
  };

  // Cubic Bezier control points for side hip curve (identical for front and back)
  const hipCp1: Point = {
    x: Number((sideWaistX + (sideHip.x - sideWaistX) * 0.4).toFixed(2)),
    y: Number((sideWaistY + (sideHip.y - sideWaistY) * 0.3).toFixed(2))
  };
  const hipCp2: Point = {
    x: Number((sideHip.x + 0.3).toFixed(2)),
    y: Number((sideHip.y - 4.0).toFixed(2))
  };

  // =========================================================================
  // 1. FRONT SKIRT PANEL: STRUCTURED GEOMETRIC CONTOUR
  // =========================================================================
  const cfWaist: Point = { x: 0, y: 0 };
  const cfSquareEnd: Point = { x: 3.5, y: 0 }; // Strict 90° squaring zone (3.5cm)
  const cfHem: Point = { x: 0, y: totalLength };
  const cfHemSquareEnd: Point = { x: 4.0, y: totalLength }; // Strict 90° squaring zone at hem (4.0cm)

  // Construct individual geometric segments for Front Stitching Line
  const fsFold = new LineSegment('fs-cf-fold', cfWaist, cfHem, 0, true, 'fs-center-front');
  const fsHemSquare = new LineSegment('fs-hem-square', cfHem, cfHemSquareEnd, hemAllowance, false, 'fs-hem');
  const fsHemCurve = new LineSegment('fs-hem-curve', cfHemSquareEnd, sideHem, hemAllowance, false, 'fs-hem');
  const fsSideLower = new LineSegment('fs-side-lower', sideHem, sideHip, sideSeamAllowance, false, 'fs-side-seam');
  const fsSideHip = new CubicBezierCurve(
    'fs-side-hip',
    sideHip,
    hipCp2,
    hipCp1,
    { x: sideWaistX, y: sideWaistY },
    sideSeamAllowance,
    false,
    'fs-side-seam'
  );
  const fsWaistSide = new LineSegment('fs-waist-side', { x: sideWaistX, y: sideWaistY }, frontDartRight, waistAllowance, false, 'fs-waist');
  const fsDartCap = new LineSegment('fs-dart-cap', frontDartRight, frontDartLeft, waistAllowance, false, 'fs-waist');
  const fsWaistDartToSquare = new LineSegment('fs-waist-mid', frontDartLeft, cfSquareEnd, waistAllowance, false, 'fs-waist');
  const fsWaistSquare = new LineSegment('fs-waist-square', cfSquareEnd, cfWaist, waistAllowance, false, 'fs-waist');

  const frontStitchingContour = new GeometricContour(
    'front-skirt-stitching',
    [
      fsFold,
      fsHemSquare,
      fsHemCurve,
      fsSideLower,
      fsSideHip,
      fsWaistSide,
      fsDartCap,
      fsWaistDartToSquare,
      fsWaistSquare
    ],
    true
  );

  // Derive seamline metrics directly from geometric segments
  const frontTotalSideSeamLength = Number((fsSideLower.lengthCm() + fsSideHip.lengthCm()).toFixed(2));
  const frontHemTotalLength = Number((fsHemSquare.lengthCm() + fsHemCurve.lengthCm()).toFixed(2));
  const frontWaistSewLength = Number((fsWaistSide.lengthCm() + fsWaistDartToSquare.lengthCm() + fsWaistSquare.lengthCm()).toFixed(2));

  const frontSeams: SeamLine[] = [
    {
      id: 'fs-center-front',
      name: 'Center Front (Fold)',
      startPoint: cfWaist,
      endPoint: cfHem,
      lengthCm: fsFold.lengthCm(),
      type: 'straight',
      startTangent: fsFold.tangentAt(0),
      endTangent: fsFold.tangentAt(1),
      segmentId: 'fs-cf-fold',
      segmentIds: ['fs-cf-fold']
    },
    {
      id: 'fs-hem',
      name: 'Front Hem',
      startPoint: cfHem,
      endPoint: sideHem,
      lengthCm: frontHemTotalLength,
      type: hemFlareCm === 0 ? 'straight' : 'curved',
      startTangent: fsHemSquare.tangentAt(0),
      endTangent: fsHemCurve.tangentAt(1),
      segmentId: 'fs-hem-curve',
      segmentIds: ['fs-hem-square', 'fs-hem-curve']
    },
    {
      id: 'fs-side-seam',
      name: 'Front Side Seam',
      startPoint: sideHem,
      endPoint: { x: sideWaistX, y: sideWaistY },
      lengthCm: frontTotalSideSeamLength,
      type: 'curved',
      startTangent: fsSideLower.tangentAt(0),
      endTangent: fsSideHip.tangentAt(1),
      pairedPieceId: 'piece-skirt-back',
      pairedSeamName: 'Back Side Seam',
      segmentId: 'fs-side-hip',
      segmentIds: ['fs-side-lower', 'fs-side-hip']
    },
    {
      id: 'fs-waist',
      name: 'Front Waistline',
      startPoint: { x: sideWaistX, y: sideWaistY },
      endPoint: cfWaist,
      lengthCm: frontWaistSewLength,
      type: 'curved',
      startTangent: fsWaistSide.tangentAt(0),
      endTangent: fsWaistSquare.tangentAt(1),
      segmentId: 'fs-waist-square',
      segmentIds: ['fs-waist-side', 'fs-waist-mid', 'fs-waist-square']
    }
  ];

  // Mathematically generate Cutting Contour using true normal offsets and corner joins
  const frontOffsetResult = generateCuttingContour(frontStitchingContour, {
    defaultAllowanceCm: sideSeamAllowance,
    bezierToleranceCm: 0.05
  });

  const frontPiece: PatternPiece = {
    id: 'piece-skirt-front',
    pieceCode: 'SK-01-F',
    name: 'Front Skirt Panel',
    garmentCategory: 'skirt',
    cutCount: 1,
    onFold: true,
    material: 'self',
    sewPathData: frontStitchingContour.toSvgPath(),
    cutPathData: frontOffsetResult.cuttingContour.toSvgPath(),
    seamAllowanceWidthCm: sideSeamAllowance,
    stitchingContour: frontStitchingContour,
    cuttingContour: frontOffsetResult.cuttingContour,
    offsetResult: frontOffsetResult,
    grainline: {
      start: { x: quarterHip * 0.45, y: waistToHip },
      end: { x: quarterHip * 0.45, y: totalLength - 8 },
      direction: 'vertical'
    },
    darts: [
      {
        id: 'dart-front-1',
        apex: frontDartApex,
        legLeft: frontDartLeft,
        legRight: frontDartRight,
        widthCm: frontDartWidth,
        lengthCm: frontDartLength
      }
    ],
    notches: [
      {
        id: 'notch-front-hip',
        position: sideHip,
        normalAngleDeg: 0,
        type: 'single',
        label: 'Hip Notch'
      },
      {
        id: 'notch-front-cf-fold',
        position: { x: 0, y: totalLength / 2 },
        normalAngleDeg: 180,
        type: 'fold',
        label: 'Center Front Fold'
      }
    ],
    seams: frontSeams,
    boundingBox: frontStitchingContour.boundingBox(),
    description: 'Front panel drafted on fold with true geometric offsets, strict 90° center tangency, and verified seam-geometry linkage.'
  };

  // =========================================================================
  // 2. BACK SKIRT PANEL: STRUCTURED GEOMETRIC CONTOUR
  // =========================================================================
  const cbWaist: Point = { x: 0, y: 0 };
  const cbSquareEnd: Point = { x: 3.5, y: 0 }; // Strict 90° squaring zone (3.5cm)
  const cbHem: Point = { x: 0, y: totalLength };
  const cbHemSquareEnd: Point = { x: 4.0, y: totalLength }; // Strict 90° squaring zone at hem (4.0cm)

  // Center Back has 1.5cm seam allowance for invisible zipper (not on fold)
  const cbAllowance = 1.5;

  const bsCbSeam = new LineSegment('bs-cb-seam', cbWaist, cbHem, cbAllowance, false, 'bs-center-back');
  const bsHemSquare = new LineSegment('bs-hem-square', cbHem, cbHemSquareEnd, hemAllowance, false, 'bs-hem');
  const bsHemCurve = new LineSegment('bs-hem-curve', cbHemSquareEnd, sideHem, hemAllowance, false, 'bs-hem');
  const bsSideLower = new LineSegment('bs-side-lower', sideHem, sideHip, sideSeamAllowance, false, 'bs-side-seam');
  const bsSideHip = new CubicBezierCurve(
    'bs-side-hip',
    sideHip,
    hipCp2,
    hipCp1,
    { x: sideWaistX, y: sideWaistY },
    sideSeamAllowance,
    false,
    'bs-side-seam'
  );
  const bsWaistSide = new LineSegment('bs-waist-side', { x: sideWaistX, y: sideWaistY }, backDartRight, waistAllowance, false, 'bs-waist');
  const bsDartCap = new LineSegment('bs-dart-cap', backDartRight, backDartLeft, waistAllowance, false, 'bs-waist');
  const bsWaistDartToSquare = new LineSegment('bs-waist-mid', backDartLeft, cbSquareEnd, waistAllowance, false, 'bs-waist');
  const bsWaistSquare = new LineSegment('bs-waist-square', cbSquareEnd, cbWaist, waistAllowance, false, 'bs-waist');

  const backStitchingContour = new GeometricContour(
    'back-skirt-stitching',
    [
      bsCbSeam,
      bsHemSquare,
      bsHemCurve,
      bsSideLower,
      bsSideHip,
      bsWaistSide,
      bsDartCap,
      bsWaistDartToSquare,
      bsWaistSquare
    ],
    true
  );

  const backTotalSideSeamLength = Number((bsSideLower.lengthCm() + bsSideHip.lengthCm()).toFixed(2));
  const backHemTotalLength = Number((bsHemSquare.lengthCm() + bsHemCurve.lengthCm()).toFixed(2));
  const backWaistSewLength = Number((bsWaistSide.lengthCm() + bsWaistDartToSquare.lengthCm() + bsWaistSquare.lengthCm()).toFixed(2));

  const backSeams: SeamLine[] = [
    {
      id: 'bs-center-back',
      name: 'Center Back Seam (Zipper)',
      startPoint: cbWaist,
      endPoint: cbHem,
      lengthCm: bsCbSeam.lengthCm(),
      type: 'straight',
      startTangent: bsCbSeam.tangentAt(0),
      endTangent: bsCbSeam.tangentAt(1),
      segmentId: 'bs-cb-seam',
      segmentIds: ['bs-cb-seam']
    },
    {
      id: 'bs-hem',
      name: 'Back Hem',
      startPoint: cbHem,
      endPoint: sideHem,
      lengthCm: backHemTotalLength,
      type: hemFlareCm === 0 ? 'straight' : 'curved',
      startTangent: bsHemSquare.tangentAt(0),
      endTangent: bsHemCurve.tangentAt(1),
      segmentId: 'bs-hem-curve',
      segmentIds: ['bs-hem-square', 'bs-hem-curve']
    },
    {
      id: 'bs-side-seam',
      name: 'Back Side Seam',
      startPoint: sideHem,
      endPoint: { x: sideWaistX, y: sideWaistY },
      lengthCm: backTotalSideSeamLength,
      type: 'curved',
      startTangent: bsSideLower.tangentAt(0),
      endTangent: bsSideHip.tangentAt(1),
      pairedPieceId: 'piece-skirt-front',
      pairedSeamName: 'Front Side Seam',
      segmentId: 'bs-side-hip',
      segmentIds: ['bs-side-lower', 'bs-side-hip']
    },
    {
      id: 'bs-waist',
      name: 'Back Waistline',
      startPoint: { x: sideWaistX, y: sideWaistY },
      endPoint: cbWaist,
      lengthCm: backWaistSewLength,
      type: 'curved',
      startTangent: bsWaistSide.tangentAt(0),
      endTangent: bsWaistSquare.tangentAt(1),
      segmentId: 'bs-waist-square',
      segmentIds: ['bs-waist-side', 'bs-waist-mid', 'bs-waist-square']
    }
  ];

  const backOffsetResult = generateCuttingContour(backStitchingContour, {
    defaultAllowanceCm: sideSeamAllowance,
    bezierToleranceCm: 0.05
  });

  const backPiece: PatternPiece = {
    id: 'piece-skirt-back',
    pieceCode: 'SK-02-B',
    name: 'Back Skirt Panel',
    garmentCategory: 'skirt',
    cutCount: 2, // Cut 1 pair (left & right)
    onFold: false,
    material: 'self',
    sewPathData: backStitchingContour.toSvgPath(),
    cutPathData: backOffsetResult.cuttingContour.toSvgPath(),
    seamAllowanceWidthCm: sideSeamAllowance,
    stitchingContour: backStitchingContour,
    cuttingContour: backOffsetResult.cuttingContour,
    offsetResult: backOffsetResult,
    grainline: {
      start: { x: quarterHip * 0.45, y: waistToHip },
      end: { x: quarterHip * 0.45, y: totalLength - 8 },
      direction: 'vertical'
    },
    darts: [
      {
        id: 'dart-back-1',
        apex: backDartApex,
        legLeft: backDartLeft,
        legRight: backDartRight,
        widthCm: backDartWidth,
        lengthCm: backDartLength
      }
    ],
    notches: [
      {
        id: 'notch-back-hip',
        position: sideHip,
        normalAngleDeg: 0,
        type: 'double',
        label: 'Back Hip Double Notch'
      },
      {
        id: 'notch-back-zip',
        position: { x: 0, y: 18.0 },
        normalAngleDeg: 180,
        type: 'single',
        label: 'Zipper Stop Notch (18cm)'
      }
    ],
    seams: backSeams,
    boundingBox: backStitchingContour.boundingBox(),
    description: 'Back panel (cut 1 pair) with true offset cutting contours, 1.5cm zipper allowance, and verified seam-geometry linkage.'
  };

  return [frontPiece, backPiece];
}
