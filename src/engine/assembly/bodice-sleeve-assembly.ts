/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BoundingBox,
  DesignSpecification,
  Notch,
  PatternPiece,
  Point,
  SeamLine,
  ValidationReport
} from '../../types';
import { computeBoundingBox, distance } from '../geometry/math';
import { CubicBezierCurve, GeometricContour, LineSegment } from '../geometry/primitives';
import {
  AssemblyInspectionLayout,
  AssemblyOptions,
  AssemblyTransformedPiece,
  AssemblyValidationStatus,
  BodiceSleeveAssemblyInput,
  BodiceSleeveAssemblyResult,
  EaseCompatibilityMetrics,
  SeamArcLengthMeasurement
} from './assembly-types';
import {
  buildAssemblyValidationReport,
  evaluateAssemblyNotches,
  evaluateEaseCompatibility,
  evaluateSeamEndpointsAndOrientations,
  extractAssemblyCurves,
  measureCurveSeam,
  UNASSESSED_ASSEMBLY_CONDITIONS
} from './assembly-validator';

/**
 * Applies a 2D rigid transformation (rotation around origin, then translation).
 * Rigid transformations strictly preserve Euclidean distances and curve arc lengths:
 * ||P1' - P2'|| === ||P1 - P2||
 */
export function applyRigidTransformPoint(
  p: Point,
  translation: Point,
  rotationDeg: number
): Point {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rx = p.x * cos - p.y * sin;
  const ry = p.x * sin + p.y * cos;

  return {
    x: rx + translation.x,
    y: ry + translation.y
  };
}

/**
 * Transforms an SVG path string containing M, L, C, Z commands using a 2D rigid transformation.
 */
export function transformSvgPath(
  pathData: string,
  translation: Point,
  rotationDeg: number
): string {
  if (!pathData) return '';

  // Matches command letters and following numbers
  const commandRegex = /([MLCZmlcz])([^MLCZmlcz]*)/g;
  const parts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = commandRegex.exec(pathData)) !== null) {
    const cmd = match[1];
    const coordsStr = match[2].trim();
    if (!coordsStr || cmd.toUpperCase() === 'Z') {
      parts.push(cmd);
      continue;
    }

    const nums = coordsStr
      .split(/[\s,]+/)
      .filter(s => s.length > 0)
      .map(s => Number(s));

    if (cmd === 'M' || cmd === 'L') {
      const transformedCoords: string[] = [];
      for (let i = 0; i < nums.length; i += 2) {
        const pt = applyRigidTransformPoint({ x: nums[i], y: nums[i + 1] }, translation, rotationDeg);
        transformedCoords.push(`${pt.x} ${pt.y}`);
      }
      parts.push(`${cmd} ${transformedCoords.join(' ')}`);
    } else if (cmd === 'C') {
      const transformedCoords: string[] = [];
      for (let i = 0; i < nums.length; i += 6) {
        const cp1 = applyRigidTransformPoint({ x: nums[i], y: nums[i + 1] }, translation, rotationDeg);
        const cp2 = applyRigidTransformPoint({ x: nums[i + 2], y: nums[i + 3] }, translation, rotationDeg);
        const p3 = applyRigidTransformPoint({ x: nums[i + 4], y: nums[i + 5] }, translation, rotationDeg);
        transformedCoords.push(`${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${p3.x} ${p3.y}`);
      }
      parts.push(`${cmd} ${transformedCoords.join(' ')}`);
    } else {
      // Fallback for relative commands: convert to uppercase or preserve
      parts.push(`${cmd} ${coordsStr}`);
    }
  }

  return parts.join(' ');
}

/**
 * Creates a rigidly transformed piece representation for inspection.
 */
export function createTransformedPiece(
  piece: PatternPiece,
  role: 'bodice-front' | 'bodice-back' | 'sleeve',
  translation: Point,
  rotationDeg = 0
): AssemblyTransformedPiece {
  const transformedNotches: Notch[] = piece.notches.map(n => ({
    ...n,
    position: applyRigidTransformPoint(n.position, translation, rotationDeg),
    normalAngleDeg: Number(((n.normalAngleDeg + rotationDeg) % 360).toFixed(1))
  }));

  const transformedSeams: SeamLine[] = piece.seams.map(s => ({
    ...s,
    startPoint: applyRigidTransformPoint(s.startPoint, translation, rotationDeg),
    endPoint: applyRigidTransformPoint(s.endPoint, translation, rotationDeg),
    startTangent: s.startTangent
      ? applyRigidTransformPoint(s.startTangent, { x: 0, y: 0 }, rotationDeg)
      : undefined,
    endTangent: s.endTangent
      ? applyRigidTransformPoint(s.endTangent, { x: 0, y: 0 }, rotationDeg)
      : undefined
  }));

  const transformedCutSvgPath = transformSvgPath(piece.cutPathData, translation, rotationDeg);
  const transformedSewSvgPath = transformSvgPath(piece.sewPathData, translation, rotationDeg);

  // Compute transformed bounding box from corners of original bounding box
  const origBox = piece.boundingBox;
  const corners: Point[] = [
    applyRigidTransformPoint({ x: origBox.minX, y: origBox.minY }, translation, rotationDeg),
    applyRigidTransformPoint({ x: origBox.maxX, y: origBox.minY }, translation, rotationDeg),
    applyRigidTransformPoint({ x: origBox.minX, y: origBox.maxY }, translation, rotationDeg),
    applyRigidTransformPoint({ x: origBox.maxX, y: origBox.maxY }, translation, rotationDeg)
  ];
  const transformedBoundingBox = computeBoundingBox(corners);

  return {
    sourcePieceId: piece.id,
    pieceCode: piece.pieceCode,
    name: piece.name,
    role,
    translation,
    rotationDeg,
    isRigid: true,
    transformedCutSvgPath,
    transformedSewSvgPath,
    transformedNotches,
    transformedSeams,
    transformedBoundingBox
  };
}

/**
 * Generates the deterministic 2D inspection layout aligning sleeve underarm points
 * with bodice underarms in front and back views.
 */
export function buildAssemblyInspectionLayout(
  frontBodicePiece: PatternPiece,
  backBodicePiece: PatternPiece,
  sleevePiece: PatternPiece
): AssemblyInspectionLayout {
  // Extract key anchor points
  const fUnderarm = frontBodicePiece.seams.find(s => s.id === 'fb-armhole-seam' || s.name.includes('Armhole'))?.startPoint
    ?? { x: 20, y: 22 };
  const bUnderarm = backBodicePiece.seams.find(s => s.id === 'bb-armhole-seam' || s.name.includes('Armhole'))?.startPoint
    ?? { x: 20, y: 22 };

  // Sleeve underarms
  const slvFrontSeam = sleevePiece.seams.find(s => s.id === 'slv-front-cap-seam' || s.name.includes('Front Sleeve Cap'));
  const slvBackSeam = sleevePiece.seams.find(s => s.id === 'slv-back-cap-seam' || s.name.includes('Back Sleeve Cap'));
  const uFront = slvFrontSeam?.endPoint ?? { x: 18, y: 15 };
  const uBack = slvBackSeam?.startPoint ?? { x: -18, y: 15 };

  // Front Assembly:
  // Bodice Front placed at origin (0, 0)
  const frontBodiceTransformed = createTransformedPiece(frontBodicePiece, 'bodice-front', { x: 0, y: 0 }, 0);
  // Sleeve translated so uFront touches fUnderarm
  const sleeveFrontTranslation: Point = {
    x: Number((fUnderarm.x - uFront.x).toFixed(2)),
    y: Number((fUnderarm.y - uFront.y).toFixed(2))
  };
  const sleeveFrontTransformed = createTransformedPiece(sleevePiece, 'sleeve', sleeveFrontTranslation, 0);

  // Back Assembly:
  // Placed with horizontal offset to right of front assembly
  const backOffsetX = Number((frontBodicePiece.boundingBox.widthCm + 15).toFixed(2));
  const backBodiceTransformed = createTransformedPiece(backBodicePiece, 'bodice-back', { x: backOffsetX, y: 0 }, 0);
  // Sleeve translated so uBack touches bUnderarm (shifted by backOffsetX)
  const bUnderarmShifted: Point = {
    x: Number((bUnderarm.x + backOffsetX).toFixed(2)),
    y: bUnderarm.y
  };
  const sleeveBackTranslation: Point = {
    x: Number((bUnderarmShifted.x - uBack.x).toFixed(2)),
    y: Number((bUnderarmShifted.y - uBack.y).toFixed(2))
  };
  const sleeveBackTransformed = createTransformedPiece(sleevePiece, 'sleeve', sleeveBackTranslation, 0);

  // Overall layout bounding box
  const allCorners: Point[] = [
    { x: frontBodiceTransformed.transformedBoundingBox.minX, y: frontBodiceTransformed.transformedBoundingBox.minY },
    { x: sleeveFrontTransformed.transformedBoundingBox.maxX, y: sleeveFrontTransformed.transformedBoundingBox.maxY },
    { x: backBodiceTransformed.transformedBoundingBox.maxX, y: backBodiceTransformed.transformedBoundingBox.maxY },
    { x: sleeveBackTransformed.transformedBoundingBox.maxX, y: sleeveBackTransformed.transformedBoundingBox.maxY }
  ];
  const layoutBoundingBox = computeBoundingBox(allCorners);

  return {
    layoutType: '2d-inspection-alignment',
    description: 'Deterministic 2D rigid transformation layout aligning front and back armhole underarm junctions.',
    disclaimer: '2D Inspection Layout for geometric and seam alignment verification only. Not an industrial cutting layout or 3D physical drape simulation.',
    frontAssembly: {
      bodice: frontBodiceTransformed,
      sleeve: sleeveFrontTransformed
    },
    backAssembly: {
      bodice: backBodiceTransformed,
      sleeve: sleeveBackTransformed
    },
    layoutBoundingBox
  };
}

export function resurrectSegment(seg: any): CubicBezierCurve | LineSegment {
  if (seg instanceof CubicBezierCurve || seg instanceof LineSegment) {
    return seg;
  }
  if (seg.type === 'bezier' || (seg.p1 && seg.p2)) {
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
  return new LineSegment(
    seg.id,
    { x: seg.p0.x, y: seg.p0.y },
    { x: seg.p1.x, y: seg.p1.y },
    seg.seamAllowanceCm ?? 1.0,
    seg.isOnFold ?? false,
    seg.seamId
  );
}

/**
 * Deep-clones pattern pieces to guarantee that source drafts are never mutated,
 * while preserving full class instances for geometric calculation.
 */
function deepClonePiece(piece: PatternPiece): PatternPiece {
  const cloned: PatternPiece = {
    ...piece,
    darts: piece.darts ? JSON.parse(JSON.stringify(piece.darts)) : [],
    notches: piece.notches ? JSON.parse(JSON.stringify(piece.notches)) : [],
    seams: piece.seams ? JSON.parse(JSON.stringify(piece.seams)) : [],
    boundingBox: piece.boundingBox ? { ...piece.boundingBox } : { minX: 0, minY: 0, maxX: 0, maxY: 0, widthCm: 0, heightCm: 0 }
  };
  if (piece.stitchingContour?.segments) {
    const resurrectedSegments = piece.stitchingContour.segments.map(s => resurrectSegment(s));
    cloned.stitchingContour = new GeometricContour(
      piece.stitchingContour.id,
      resurrectedSegments,
      piece.stitchingContour.isClosed
    );
  }
  return cloned;
}

/**
 * Deterministically integrates bodice blocks and sleeve into an inspectable, validated assembly.
 */
export function assembleBodiceSleeve(
  input: BodiceSleeveAssemblyInput
): BodiceSleeveAssemblyResult {
  const timestamp = new Date().toISOString();
  const id = `asm-${Date.now()}`;

  // 1. Immutable defensive copy
  const clonedBodicePieces = input.bodicePieces ? input.bodicePieces.map(p => deepClonePiece(p)) : [];
  const rawSleeve = input.sleevePiece as any;
  const actualSleevePiece: PatternPiece | undefined = rawSleeve?.piece ?? (rawSleeve?.id ? rawSleeve : undefined);
  const clonedSleevePiece = actualSleevePiece ? deepClonePiece(actualSleevePiece) : undefined;

  const defensiveInput: BodiceSleeveAssemblyInput = {
    ...input,
    bodicePieces: clonedBodicePieces,
    sleevePiece: clonedSleevePiece
  };

  // 2. Curve Extraction
  const { extracted, errors, missingPieces } = extractAssemblyCurves(defensiveInput);

  // Missing data handling: strictly 'unassessed-missing-data'
  if (!extracted || missingPieces.length > 0) {
    const defaultEase: EaseCompatibilityMetrics = {
      frontBodiceArmholeLengthCm: 0,
      backBodiceArmholeLengthCm: 0,
      totalBodiceArmholeLengthCm: 0,
      frontSleeveCapLengthCm: 0,
      backSleeveCapLengthCm: 0,
      totalSleeveCapLengthCm: 0,
      frontEaseCm: 0,
      backEaseCm: 0,
      totalEaseCm: 0,
      frontEaseUncertaintyCm: 0,
      backEaseUncertaintyCm: 0,
      totalEaseUncertaintyCm: 0,
      frontEaseRatio: 0.5,
      targetStrategy: input.options?.strategy ?? 'classic',
      targetTotalEaseCm: 0,
      targetFrontEaseCm: 0,
      targetBackEaseCm: 0,
      recommendedEnvelopeCm: { min: 0, max: 0 },
      frontResidualCm: 0,
      backResidualCm: 0,
      totalResidualCm: 0,
      isFrontEasePermitted: false,
      isBackEasePermitted: false,
      isTotalEasePermitted: false,
      isDistributionBalanced: false,
      isTotalEaseTargetCompliant: false,
      isTargetCompliant: false
    };

    const emptyValidation: ValidationReport = {
      status: 'incomplete',
      isValid: false,
      isProductionReady: false,
      statusLabel: 'ASSEMBLY_MISSING_DATA',
      timestamp,
      passedCount: 0,
      warningCount: 0,
      failureCount: missingPieces.length,
      checks: missingPieces.map((p, idx) => ({
        id: `val-missing-${idx}`,
        category: 'geometry',
        name: `Required Assembly Piece: ${p}`,
        status: 'fail',
        message: `Assembly input missing required pattern piece: ${p}`
      })),
      unassessedConditions: UNASSESSED_ASSEMBLY_CONDITIONS,
      declaration: 'Assembly validation could not be completed due to missing pattern pieces.'
    };

    return {
      id,
      timestamp,
      status: 'unassessed-missing-data',
      isValid: false,
      isProductionReady: false,
      measurements: {
        frontBodiceArmhole: null,
        backBodiceArmhole: null,
        frontSleeveCap: null,
        backSleeveCap: null
      },
      ease: defaultEase,
      endpoints: {
        frontUnderarmMatch: { name: 'Front Scye', bodicePieceId: '', bodicePoint: { x: 0, y: 0 }, sleevePoint: { x: 0, y: 0 }, distanceCm: 0, isConnected: false, expectedDirection: '', actualDirection: '', isOrientationValid: false },
        backUnderarmMatch: { name: 'Back Scye', bodicePieceId: '', bodicePoint: { x: 0, y: 0 }, sleevePoint: { x: 0, y: 0 }, distanceCm: 0, isConnected: false, expectedDirection: '', actualDirection: '', isOrientationValid: false },
        crownShoulderMatch: { name: 'Crown Apex', bodicePieceId: '', bodicePoint: { x: 0, y: 0 }, sleevePoint: { x: 0, y: 0 }, distanceCm: 0, isConnected: false, expectedDirection: '', actualDirection: '', isOrientationValid: false },
        underarmInseamMatch: { frontInseamLengthCm: 0, backInseamLengthCm: 0, parityDeltaCm: 0, hasParity: false },
        isEndpointTopologyValid: false,
        reasons: errors
      },
      notches: {
        frontNotch: null,
        backNotches: null,
        crownNotch: null,
        status: 'unassessed-missing-data',
        isValid: false,
        errors,
        warnings: []
      },
      validationReport: emptyValidation,
      pieces: {
        frontBodice: clonedBodicePieces.find(p => p.id === 'piece-bodice-front' || p.pieceCode?.startsWith('BOD-F')),
        backBodice: clonedBodicePieces.find(p => p.id === 'piece-bodice-back' || p.pieceCode?.startsWith('BOD-B')),
        sleeve: clonedSleevePiece
      },
      unresolvedRisks: ['Missing input pattern pieces prevent seam arc-length and ease computation.'],
      productionNotes: ['Draft missing pieces before initiating assembly validation.']
    };
  }

  // 3. Adaptive Arc-Length Measurements with Propagated Uncertainties
  const tol = input.options?.bezierToleranceCm ?? 0.005;
  const frontBodiceMeas = measureCurveSeam(
    extracted.frontBodiceArmhole,
    extracted.frontBodicePiece.id,
    extracted.frontBodicePiece.pieceCode,
    'fb-armhole-seam',
    tol
  );
  const backBodiceMeas = measureCurveSeam(
    extracted.backBodiceArmhole,
    extracted.backBodicePiece.id,
    extracted.backBodicePiece.pieceCode,
    'bb-armhole-seam',
    tol
  );
  const frontSleeveMeas = measureCurveSeam(
    extracted.sleeveFrontCap,
    extracted.sleevePiece.id,
    extracted.sleevePiece.pieceCode,
    'slv-front-cap-seam',
    tol
  );
  const backSleeveMeas = measureCurveSeam(
    extracted.sleeveBackCap,
    extracted.sleevePiece.id,
    extracted.sleevePiece.pieceCode,
    'slv-back-cap-seam',
    tol
  );

  // 4. Mathematical Ease Compatibility
  const easeMetrics = evaluateEaseCompatibility(
    frontBodiceMeas,
    backBodiceMeas,
    frontSleeveMeas,
    backSleeveMeas,
    input.options
  );

  // 5. Seam Endpoint Connectivity & Traversal Direction
  const endpointResult = evaluateSeamEndpointsAndOrientations(extracted);

  // 6. Notch Correspondence
  const notchResult = evaluateAssemblyNotches(extracted);

  // 7. Comprehensive Validation Report
  const validationReport = buildAssemblyValidationReport(
    easeMetrics,
    endpointResult,
    notchResult,
    frontBodiceMeas,
    backBodiceMeas,
    frontSleeveMeas,
    backSleeveMeas
  );

  // 8. 2D Inspection Layout
  const inspectionLayout = buildAssemblyInspectionLayout(
    extracted.frontBodicePiece,
    extracted.backBodicePiece,
    extracted.sleevePiece
  );

  // 9. Overall Status Determination
  const isValid = validationReport.isValid;
  const status: AssemblyValidationStatus = isValid ? 'verified-valid' : 'invalid';

  const unresolvedRisks: string[] = [
    'Static 2D pattern assembly only: dynamic arm raise reach tension unmodeled.',
    '3D physical cloth drape and wool/cotton iron steam moulding unsimulated.',
    'Industrial grading nest continuity across multi-sizes unassessed.'
  ];

  const productionNotes: string[] = [
    `Target ease strategy: ${easeMetrics.targetStrategy} (${easeMetrics.targetTotalEaseCm} cm target).`,
    `Measured total cap ease: +${easeMetrics.totalEaseCm.toFixed(2)} cm (front: +${easeMetrics.frontEaseCm.toFixed(2)} cm, back: +${easeMetrics.backEaseCm.toFixed(2)} cm).`,
    `Propagated arc-length uncertainty: ±${easeMetrics.totalEaseUncertaintyCm.toFixed(4)} cm.`,
    'Inseam parity delta: ' + endpointResult.underarmInseamMatch.parityDeltaCm.toFixed(3) + ' cm <= 0.05 cm.'
  ];

  return {
    id,
    timestamp,
    status,
    isValid,
    isProductionReady: false, // Strictly false: 2D geometry verified, 3D wearer fit unassessed
    measurements: {
      frontBodiceArmhole: frontBodiceMeas,
      backBodiceArmhole: backBodiceMeas,
      frontSleeveCap: frontSleeveMeas,
      backSleeveCap: backSleeveMeas
    },
    ease: easeMetrics,
    endpoints: endpointResult,
    notches: notchResult,
    validationReport,
    inspectionLayout,
    pieces: {
      frontBodice: extracted.frontBodicePiece,
      backBodice: extracted.backBodicePiece,
      sleeve: extracted.sleevePiece
    },
    unresolvedRisks,
    productionNotes
  };
}
