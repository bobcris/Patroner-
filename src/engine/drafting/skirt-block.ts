/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, DesignSpecification, EaseProfile, PatternPiece, Point, SeamLine } from '../../types';
import { approximateBezierLength, computeBoundingBox, distance } from '../geometry/math';
import { calculateGarmentDimensions } from '../measurements/standards';

export interface SkirtDraftOptions {
  seamAllowanceCm?: number;
  hemAllowanceCm?: number;
}

/**
 * Deterministic drafting algorithm for a standard skirt block (Front & Back panels).
 * Follows industry-standard anthropometric pattern construction principles (Aldrich / Armstrong).
 * 
 * All internal coordinate calculations are in centimetres (cm).
 * Origin (0,0) is placed at the top-left (Waistline at Center Front/Back).
 */
export function draftSkirtBlock(
  measurements: BodyMeasurements,
  design: DesignSpecification,
  options: SkirtDraftOptions = {}
): PatternPiece[] {
  const seamAllowance = options.seamAllowanceCm ?? 1.5;
  const hemAllowance = options.hemAllowanceCm ?? 3.0;

  // Calculate finished dimensions
  const dims = calculateGarmentDimensions(measurements, design.easeProfile, design.fabric);
  const totalLength = design.lengthCm || measurements.skirtLength || 62;
  const waistToHip = measurements.waistToHip || 20;

  // 1/4 of finished circumferences
  const quarterWaist = dims.garmentWaistCm / 4;
  const quarterHip = dims.garmentHipCm / 4;

  // Total waist-to-hip suppression needed per quarter:
  const suppression = Math.max(0, quarterHip - quarterWaist);

  // Common side seam suppression:
  // Both front and back take the exact same side-seam curve so they pair with 0.0mm discrepancy
  const sideSuppression = Math.min(suppression * 0.5, 3.2);
  const sideWaistX = quarterHip - sideSuppression;
  const sideWaistY = -0.7; // 0.7cm rise at hip for natural waist contour

  // Darts absorb remaining suppression
  const remainingSuppression = Math.max(0, suppression - sideSuppression);
  const frontDartWidth = Math.max(1.0, Math.min(2.2, remainingSuppression * 0.8));
  const frontDartLength = 9.5; // cm depth
  const frontDartPlacementX = 8.5; // cm from center front

  const backDartWidth = Math.max(1.2, Math.min(3.0, remainingSuppression));
  const backDartLength = 13.0; // cm depth
  const backDartPlacementX = quarterWaist * 0.45; // ~midway along back waist

  // Flare adjustment based on silhouette
  let hemFlareCm = 0;
  if (design.silhouette === 'a-line') {
    hemFlareCm = 4.0;
  } else if (design.silhouette === 'flared') {
    hemFlareCm = 7.5;
  } else if (design.silhouette === 'pencil') {
    hemFlareCm = -1.8;
  }

  // ==========================================
  // 1. FRONT SKIRT PANEL DRAFTING
  // ==========================================
  // Points (origin at Center Front Waist: 0, 0)
  const cfWaist: Point = { x: 0, y: 0 };
  const cfHip: Point = { x: 0, y: waistToHip };
  const cfHem: Point = { x: 0, y: totalLength };

  const frontSideWaist: Point = { x: sideWaistX, y: sideWaistY };

  // Front Hip side point
  const frontSideHip: Point = { x: quarterHip, y: waistToHip };

  // Front Hem side point
  const frontSideHem: Point = { x: quarterHip + hemFlareCm, y: totalLength };

  // Front Dart Points
  const frontDartApex: Point = { x: frontDartPlacementX, y: frontDartLength };
  const frontDartLeft: Point = { x: frontDartPlacementX - frontDartWidth / 2, y: -0.2 };
  const frontDartRight: Point = { x: frontDartPlacementX + frontDartWidth / 2, y: -0.3 };

  // Bezier control points for front hip curve (from side waist to side hip)
  const frontHipCp1: Point = {
    x: frontSideWaist.x + (frontSideHip.x - frontSideWaist.x) * 0.4,
    y: frontSideWaist.y + (frontSideHip.y - frontSideWaist.y) * 0.3
  };
  const frontHipCp2: Point = {
    x: frontSideHip.x + 0.3,
    y: frontSideHip.y - 4.0
  };

  const frontHipCurveLength = approximateBezierLength(
    frontSideWaist,
    frontHipCp1,
    frontHipCp2,
    frontSideHip
  );
  const frontLowerSideSeamLength = distance(frontSideHip, frontSideHem);
  const frontTotalSideSeamLength = Number((frontHipCurveLength + frontLowerSideSeamLength).toFixed(2));

  // Front Seamlines
  const frontSeams: SeamLine[] = [
    {
      id: 'fs-center-front',
      name: 'Center Front (Fold)',
      startPoint: cfWaist,
      endPoint: cfHem,
      lengthCm: totalLength,
      type: 'straight'
    },
    {
      id: 'fs-hem',
      name: 'Front Hem',
      startPoint: cfHem,
      endPoint: frontSideHem,
      lengthCm: Number(distance(cfHem, frontSideHem).toFixed(2)),
      type: 'straight'
    },
    {
      id: 'fs-side-seam',
      name: 'Front Side Seam',
      startPoint: frontSideHem,
      endPoint: frontSideWaist,
      lengthCm: frontTotalSideSeamLength,
      type: 'curved',
      pairedPieceId: 'piece-skirt-back',
      pairedSeamName: 'Back Side Seam'
    },
    {
      id: 'fs-waist',
      name: 'Front Waistline',
      startPoint: frontSideWaist,
      endPoint: cfWaist,
      lengthCm: Number((quarterWaist).toFixed(2)),
      type: 'curved'
    }
  ];

  // Build Front Cut & Sew SVG Path data
  // Cut path incorporates seam allowances (0 on fold CF, 3cm hem, 1.5cm side seam, 1.0cm waist)
  const frontSewPath = `M ${cfWaist.x} ${cfWaist.y} ` +
    `L ${frontDartLeft.x} ${frontDartLeft.y} ` +
    `L ${frontDartApex.x} ${frontDartApex.y} ` +
    `L ${frontDartRight.x} ${frontDartRight.y} ` +
    `L ${frontSideWaist.x} ${frontSideWaist.y} ` +
    `C ${frontHipCp1.x} ${frontHipCp1.y}, ${frontHipCp2.x} ${frontHipCp2.y}, ${frontSideHip.x} ${frontSideHip.y} ` +
    `L ${frontSideHem.x} ${frontSideHem.y} ` +
    `L ${cfHem.x} ${cfHem.y} ` +
    `Z`;

  const frontCutPath = `M ${cfWaist.x} ${cfWaist.y - 1.0} ` +
    `L ${frontSideWaist.x + seamAllowance * 0.8} ${frontSideWaist.y - 1.0} ` +
    `C ${frontHipCp1.x + seamAllowance} ${frontHipCp1.y}, ${frontHipCp2.x + seamAllowance} ${frontHipCp2.y}, ${frontSideHip.x + seamAllowance} ${frontSideHip.y} ` +
    `L ${frontSideHem.x + seamAllowance} ${frontSideHem.y + hemAllowance} ` +
    `L ${cfHem.x} ${cfHem.y + hemAllowance} ` +
    `Z`;

  const frontBounding = computeBoundingBox([
    cfWaist,
    frontSideWaist,
    frontSideHip,
    frontSideHem,
    cfHem
  ]);

  const frontPiece: PatternPiece = {
    id: 'piece-skirt-front',
    pieceCode: 'SK-01-F',
    name: 'Front Skirt Panel',
    garmentCategory: 'skirt',
    cutCount: 1,
    onFold: true,
    material: 'self',
    sewPathData: frontSewPath,
    cutPathData: frontCutPath,
    seamAllowanceWidthCm: seamAllowance,
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
        position: frontSideHip,
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
    boundingBox: frontBounding,
    description: 'Front panel drafted on fold. Contains 1 waist dart and contoured hip curve.'
  };

  // ==========================================
  // 2. BACK SKIRT PANEL DRAFTING
  // ==========================================
  // Back panel features center back seam with zipper notch and 1 back dart
  const cbWaist: Point = { x: 0, y: 0 };
  const cbHip: Point = { x: 0, y: waistToHip };
  const cbHem: Point = { x: 0, y: totalLength };

  const backSideWaist: Point = { x: sideWaistX, y: sideWaistY };

  const backSideHip: Point = { x: quarterHip, y: waistToHip };
  const backSideHem: Point = { x: quarterHip + hemFlareCm, y: totalLength };

  // Back Dart Points
  const backDartApex: Point = { x: backDartPlacementX, y: backDartLength };
  const backDartLeft: Point = { x: backDartPlacementX - backDartWidth / 2, y: -0.2 };
  const backDartRight: Point = { x: backDartPlacementX + backDartWidth / 2, y: -0.3 };

  // Matching back hip curve
  const backHipCp1: Point = {
    x: backSideWaist.x + (backSideHip.x - backSideWaist.x) * 0.4,
    y: backSideWaist.y + (backSideHip.y - backSideWaist.y) * 0.3
  };
  const backHipCp2: Point = {
    x: backSideHip.x + 0.3,
    y: backSideHip.y - 4.0
  };

  const backHipCurveLength = approximateBezierLength(
    backSideWaist,
    backHipCp1,
    backHipCp2,
    backSideHip
  );
  const backLowerSideSeamLength = distance(backSideHip, backSideHem);
  const backTotalSideSeamLength = Number((backHipCurveLength + backLowerSideSeamLength).toFixed(2));

  // Back Seamlines
  const backSeams: SeamLine[] = [
    {
      id: 'bs-center-back',
      name: 'Center Back Seam (Zipper)',
      startPoint: cbWaist,
      endPoint: cbHem,
      lengthCm: totalLength,
      type: 'straight'
    },
    {
      id: 'bs-hem',
      name: 'Back Hem',
      startPoint: cbHem,
      endPoint: backSideHem,
      lengthCm: Number(distance(cbHem, backSideHem).toFixed(2)),
      type: 'straight'
    },
    {
      id: 'bs-side-seam',
      name: 'Back Side Seam',
      startPoint: backSideHem,
      endPoint: backSideWaist,
      lengthCm: backTotalSideSeamLength,
      type: 'curved',
      pairedPieceId: 'piece-skirt-front',
      pairedSeamName: 'Front Side Seam'
    },
    {
      id: 'bs-waist',
      name: 'Back Waistline',
      startPoint: backSideWaist,
      endPoint: cbWaist,
      lengthCm: Number((quarterWaist).toFixed(2)),
      type: 'curved'
    }
  ];

  const backSewPath = `M ${cbWaist.x} ${cbWaist.y} ` +
    `L ${backDartLeft.x} ${backDartLeft.y} ` +
    `L ${backDartApex.x} ${backDartApex.y} ` +
    `L ${backDartRight.x} ${backDartRight.y} ` +
    `L ${backSideWaist.x} ${backSideWaist.y} ` +
    `C ${backHipCp1.x} ${backHipCp1.y}, ${backHipCp2.x} ${backHipCp2.y}, ${backSideHip.x} ${backSideHip.y} ` +
    `L ${backSideHem.x} ${backSideHem.y} ` +
    `L ${cbHem.x} ${cbHem.y} ` +
    `Z`;

  const backCutPath = `M ${cbWaist.x - seamAllowance} ${cbWaist.y - 1.0} ` +
    `L ${backSideWaist.x + seamAllowance * 0.8} ${backSideWaist.y - 1.0} ` +
    `C ${backHipCp1.x + seamAllowance} ${backHipCp1.y}, ${backHipCp2.x + seamAllowance} ${backHipCp2.y}, ${backSideHip.x + seamAllowance} ${backSideHip.y} ` +
    `L ${backSideHem.x + seamAllowance} ${backSideHem.y + hemAllowance} ` +
    `L ${cbHem.x - seamAllowance} ${cbHem.y + hemAllowance} ` +
    `Z`;

  const backBounding = computeBoundingBox([
    cbWaist,
    backSideWaist,
    backSideHip,
    backSideHem,
    cbHem
  ]);

  const backPiece: PatternPiece = {
    id: 'piece-skirt-back',
    pieceCode: 'SK-02-B',
    name: 'Back Skirt Panel',
    garmentCategory: 'skirt',
    cutCount: 2, // Cut 1 pair (left & right)
    onFold: false,
    material: 'self',
    sewPathData: backSewPath,
    cutPathData: backCutPath,
    seamAllowanceWidthCm: seamAllowance,
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
        position: backSideHip,
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
    boundingBox: backBounding,
    description: 'Back panel (cut 1 pair). Contains 1 deep waist dart, zipper notch at CB, and double notch at side hip.'
  };

  return [frontPiece, backPiece];
}
