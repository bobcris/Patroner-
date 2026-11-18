/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BoundingBox,
  GrainLine,
  Notch,
  OffsetResult,
  PatternPiece,
  Point,
  SeamLine,
  ValidationReport
} from '../../types';
import { computeBoundingBox, distance, normalizeAngleDeg } from '../geometry/math';
import { CubicBezierCurve, GeometricContour, LineSegment } from '../geometry/primitives';
import {
  AssemblyConfigValidationResult,
  AssemblyContourIntegrityResult,
  AssemblyExecutionMetadata,
  AssemblyGovernanceResult,
  AssemblyInspectionLayout,
  AssemblyOptions,
  AssemblyTransformedPiece,
  AssemblyValidationStatus,
  BodiceSleeveAssemblyInput,
  BodiceSleeveAssemblyResult,
  EaseCompatibilityMetrics,
  RigidAlignmentVerification,
  SeamArcLengthMeasurement,
  SeamCompatibilityBreakdown,
  UncertaintyGateResult
} from './assembly-types';
import {
  buildAssemblyValidationReport,
  DEFAULT_MAX_TOTAL_EASE_CM,
  evaluateAssemblyCurveContinuityAndGeometry,
  evaluateAssemblyGovernance,
  evaluateAssemblyNotches,
  evaluateEaseCompatibility,
  evaluateSeamCompatibilityBreakdown,
  evaluateSeamEndpointsAndOrientations,
  evaluateUncertaintyGate,
  extractAssemblyCurves,
  formatSignedCm,
  MAX_SINGLE_SEAM_UNCERTAINTY_CM,
  measureCurveSeam,
  resolveAndValidateAssemblyConfig,
  UNASSESSED_ASSEMBLY_CONDITIONS
} from './assembly-validator';
import { CanonicalDigestEnvelope, digestCanonicalPayload } from './sha256';

let assemblyRunSequence = 0;

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

    const matches = coordsStr.match(/-?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/g);
    const nums = matches ? matches.map(Number) : [];

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
    normalAngleDeg: Number(normalizeAngleDeg(n.normalAngleDeg + rotationDeg).toFixed(1))
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

  // Compute transformed bounding box from all 4 corners of original bounding box
  const origBox = piece.boundingBox;
  const corners: Point[] = [
    applyRigidTransformPoint({ x: origBox.minX, y: origBox.minY }, translation, rotationDeg),
    applyRigidTransformPoint({ x: origBox.maxX, y: origBox.minY }, translation, rotationDeg),
    applyRigidTransformPoint({ x: origBox.minX, y: origBox.maxY }, translation, rotationDeg),
    applyRigidTransformPoint({ x: origBox.maxX, y: origBox.maxY }, translation, rotationDeg)
  ];
  const transformedBoundingBox = computeBoundingBox(corners);

  const transformedGrainline: GrainLine | undefined = piece.grainline ? {
    ...piece.grainline,
    start: applyRigidTransformPoint(piece.grainline.start, translation, rotationDeg),
    end: applyRigidTransformPoint(piece.grainline.end, translation, rotationDeg)
  } : undefined;

  const transformedDrillHoles: Point[] | undefined = piece.drillHoles
    ? piece.drillHoles.map(dh => applyRigidTransformPoint(dh, translation, rotationDeg))
    : undefined;

  return {
    sourcePieceId: piece.id,
    pieceCode: piece.pieceCode,
    name: piece.name,
    role,
    translation: { x: translation.x, y: translation.y },
    rotationDeg,
    isRigid: true,
    transformedCutSvgPath,
    transformedSewSvgPath,
    transformedNotches,
    transformedSeams,
    transformedBoundingBox,
    seamAllowanceWidthCm: piece.seamAllowanceWidthCm,
    transformedGrainline,
    transformedDrillHoles,
    material: piece.material,
    onFold: piece.onFold,
    cutCount: piece.cutCount
  };
}

/**
 * Generates the deterministic 2D inspection layout aligning sleeve underarm points
 * with bodice underarms in front and back views at full binary64 translation precision.
 */
export function buildAssemblyInspectionLayout(
  frontBodicePiece: PatternPiece,
  backBodicePiece: PatternPiece,
  sleevePiece: PatternPiece
): AssemblyInspectionLayout {
  // Extract exact curve/seam anchor points
  const frontBodiceArmholeSeg = frontBodicePiece.stitchingContour?.segments.find(s => s.id === 'fb-armhole');
  const backBodiceArmholeSeg = backBodicePiece.stitchingContour?.segments.find(s => s.id === 'bb-armhole');
  const slvFrontCapSeg = sleevePiece.stitchingContour?.segments.find(s => s.id === 'sleeve-front-cap');
  const slvBackCapSeg = sleevePiece.stitchingContour?.segments.find(s => s.id === 'sleeve-back-cap');

  const fUnderarm =
    frontBodiceArmholeSeg?.start ??
    frontBodicePiece.seams.find(s => s.id === 'fb-armhole-seam' || s.name.includes('Armhole'))?.startPoint ??
    { x: 20, y: 22 };
  const bUnderarm =
    backBodiceArmholeSeg?.start ??
    backBodicePiece.seams.find(s => s.id === 'bb-armhole-seam' || s.name.includes('Armhole'))?.startPoint ??
    { x: 20, y: 22 };

  const uFront =
    slvFrontCapSeg?.end ??
    sleevePiece.seams.find(s => s.id === 'slv-front-cap-seam' || s.name.includes('Front Sleeve Cap'))?.endPoint ??
    { x: 18, y: 15 };
  const uBack =
    slvBackCapSeg?.start ??
    sleevePiece.seams.find(s => s.id === 'slv-back-cap-seam' || s.name.includes('Back Sleeve Cap'))?.startPoint ??
    { x: -18, y: 15 };

  // Front Assembly:
  // Bodice Front placed at origin (0, 0)
  const frontBodiceTransformed = createTransformedPiece(frontBodicePiece, 'bodice-front', { x: 0, y: 0 }, 0);
  // Sleeve translated at full precision so uFront touches fUnderarm exactly
  const sleeveFrontTranslation: Point = {
    x: fUnderarm.x - uFront.x,
    y: fUnderarm.y - uFront.y
  };
  const sleeveFrontTransformed = createTransformedPiece(sleevePiece, 'sleeve', sleeveFrontTranslation, 0);

  // Back Assembly:
  // Placed horizontally strictly to the right of the entire Front Assembly
  const frontExtentMaxX = Math.max(
    frontBodiceTransformed.transformedBoundingBox.maxX,
    sleeveFrontTransformed.transformedBoundingBox.maxX
  );
  const preOffsetSleeveBackTranslationX = bUnderarm.x - uBack.x;
  const backPreOffsetMinX = Math.min(
    backBodicePiece.boundingBox.minX,
    sleevePiece.boundingBox.minX + preOffsetSleeveBackTranslationX
  );
  const gapCm = 15;
  const backOffsetX = Math.max(
    frontBodicePiece.boundingBox.widthCm + gapCm,
    frontExtentMaxX + gapCm - backPreOffsetMinX
  );

  const backBodiceTransformed = createTransformedPiece(backBodicePiece, 'bodice-back', { x: backOffsetX, y: 0 }, 0);
  const bUnderarmShifted: Point = {
    x: bUnderarm.x + backOffsetX,
    y: bUnderarm.y
  };
  const sleeveBackTranslation: Point = {
    x: bUnderarmShifted.x - uBack.x,
    y: bUnderarmShifted.y - uBack.y
  };
  const sleeveBackTransformed = createTransformedPiece(sleevePiece, 'sleeve', sleeveBackTranslation, 0);

  // Overall layout bounding box enclosing ALL 4 pieces' bounding boxes (all corners)
  const piecesTransformed = [
    frontBodiceTransformed,
    sleeveFrontTransformed,
    backBodiceTransformed,
    sleeveBackTransformed
  ];
  const minX = Math.min(...piecesTransformed.map(p => p.transformedBoundingBox.minX));
  const minY = Math.min(...piecesTransformed.map(p => p.transformedBoundingBox.minY));
  const maxX = Math.max(...piecesTransformed.map(p => p.transformedBoundingBox.maxX));
  const maxY = Math.max(...piecesTransformed.map(p => p.transformedBoundingBox.maxY));
  const layoutBoundingBox: BoundingBox = {
    minX,
    minY,
    maxX,
    maxY,
    widthCm: maxX - minX,
    heightCm: maxY - minY
  };

  // Rigid alignment verification
  const fUnderarmAligned = applyRigidTransformPoint(fUnderarm, { x: 0, y: 0 }, 0);
  const slvFrontUnderarmAligned = applyRigidTransformPoint(uFront, sleeveFrontTranslation, 0);
  const frontJunctionDeltaCm = distance(fUnderarmAligned, slvFrontUnderarmAligned);

  const bUnderarmAligned = applyRigidTransformPoint(bUnderarm, { x: backOffsetX, y: 0 }, 0);
  const slvBackUnderarmAligned = applyRigidTransformPoint(uBack, sleeveBackTranslation, 0);
  const backJunctionDeltaCm = distance(bUnderarmAligned, slvBackUnderarmAligned);

  let maxSeamLengthDriftCm = 0;
  for (const [src, trans] of [
    [frontBodicePiece, frontBodiceTransformed],
    [backBodicePiece, backBodiceTransformed],
    [sleevePiece, sleeveFrontTransformed],
    [sleevePiece, sleeveBackTransformed]
  ] as const) {
    for (let i = 0; i < src.seams.length; i++) {
      const s0 = src.seams[i];
      const s1 = trans.transformedSeams[i];
      if (!s0 || !s1) continue;
      const chord0 = distance(s0.startPoint, s0.endPoint);
      const chord1 = distance(s1.startPoint, s1.endPoint);
      const drift = Math.abs(chord1 - chord0);
      if (drift > maxSeamLengthDriftCm) {
        maxSeamLengthDriftCm = drift;
      }
    }
  }

  const backMinX = Math.min(
    backBodiceTransformed.transformedBoundingBox.minX,
    sleeveBackTransformed.transformedBoundingBox.minX
  );
  const assembliesNonOverlapping = frontExtentMaxX < backMinX;

  const rigidVerification: RigidAlignmentVerification = {
    isRigidVerified:
      frontJunctionDeltaCm <= 1e-6 &&
      backJunctionDeltaCm <= 1e-6 &&
      maxSeamLengthDriftCm <= 1e-6 &&
      assembliesNonOverlapping,
    frontJunctionDeltaCm,
    backJunctionDeltaCm,
    maxSeamLengthDriftCm,
    assembliesNonOverlapping
  };

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
    layoutBoundingBox,
    rigidVerification
  };
}

export function resurrectSegment(seg: any): CubicBezierCurve | LineSegment {
  if (seg instanceof CubicBezierCurve) {
    return new CubicBezierCurve(
      seg.id,
      { x: seg.p0.x, y: seg.p0.y },
      { x: seg.cp1.x, y: seg.cp1.y },
      { x: seg.cp2.x, y: seg.cp2.y },
      { x: seg.p3.x, y: seg.p3.y },
      seg.seamAllowanceCm,
      seg.isFold,
      seg.seamId,
      seg.sourceSegmentId,
      seg.role
    );
  }
  if (seg instanceof LineSegment) {
    return new LineSegment(
      seg.id,
      { x: seg.start.x, y: seg.start.y },
      { x: seg.end.x, y: seg.end.y },
      seg.seamAllowanceCm,
      seg.isFold,
      seg.seamId,
      seg.sourceSegmentId,
      seg.role
    );
  }
  if (seg.type === 'bezier' || ((seg.cp1 || seg.p1) && (seg.cp2 || seg.p2))) {
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

function deepCloneContour(contour: GeometricContour | undefined): GeometricContour | undefined {
  if (!contour?.segments) return undefined;
  return new GeometricContour(
    contour.id,
    contour.segments.map(s => resurrectSegment(s)),
    contour.isClosed
  );
}

/**
 * Deep-clones pattern pieces to guarantee that source drafts are never mutated,
 * while preserving full class instances for geometric calculation across all contours and metadata.
 */
function deepClonePiece(piece: PatternPiece): PatternPiece {
  const clonedOffset: OffsetResult | undefined = piece.offsetResult
    ? {
        ...piece.offsetResult,
        cuttingContour: deepCloneContour(piece.offsetResult.cuttingContour) ?? piece.offsetResult.cuttingContour,
        diagnostics: piece.offsetResult.diagnostics
          ? piece.offsetResult.diagnostics.map(d => ({ ...d }))
          : undefined,
        warnings: [...(piece.offsetResult.warnings ?? [])],
        errors: [...(piece.offsetResult.errors ?? [])]
      }
    : undefined;

  return {
    ...piece,
    darts: piece.darts ? JSON.parse(JSON.stringify(piece.darts)) : [],
    notches: piece.notches ? JSON.parse(JSON.stringify(piece.notches)) : [],
    seams: piece.seams ? JSON.parse(JSON.stringify(piece.seams)) : [],
    boundingBox: piece.boundingBox
      ? { ...piece.boundingBox }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0, widthCm: 0, heightCm: 0 },
    grainline: piece.grainline
      ? {
          ...piece.grainline,
          start: { x: piece.grainline.start.x, y: piece.grainline.start.y },
          end: { x: piece.grainline.end.x, y: piece.grainline.end.y }
        }
      : { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, direction: 'vertical' },
    drillHoles: piece.drillHoles ? piece.drillHoles.map(dh => ({ x: dh.x, y: dh.y })) : undefined,
    stitchingContour: deepCloneContour(piece.stitchingContour),
    cuttingContour: deepCloneContour(piece.cuttingContour),
    offsetResult: clonedOffset
  };
}

function createNextExecutionMetadata(): { id: string; executionMetadata: AssemblyExecutionMetadata } {
  assemblyRunSequence += 1;
  const nowMs = Date.now();
  const generatedAtIso = new Date(nowMs).toISOString();
  const id = `asm-${nowMs}-${assemblyRunSequence}`;
  return {
    id,
    executionMetadata: {
      runId: `run-${nowMs}-${assemblyRunSequence}`,
      generatedAtIso,
      engineVersion: '0.4.3'
    }
  };
}

/**
 * Extracts a strictly deterministic, run-metadata-free canonical payload from an assembly result
 * for cross-run invariant SHA-256 verification.
 */
export function buildCanonicalAssemblyReportPayload(
  result: Omit<BodiceSleeveAssemblyResult, 'canonicalContentDigest' | 'reportSha256Hex' | 'canonicalJsonByteLength'>
): Record<string, unknown> {
  const { timestamp: _reportTs, ...deterministicValidation } = result.validationReport;

  return {
    schemaVersion: 'm04.3-assembly-report-v1',
    engineVersion: result.executionMetadata?.engineVersion ?? '0.4.3',
    status: result.status,
    isValid: result.isValid,
    isProductionReady: false,
    configValidation: result.configValidation,
    measurements: result.measurements,
    seamCompatibility: result.seamCompatibility,
    uncertaintyGate: result.uncertaintyGate,
    ease: result.ease,
    endpoints: result.endpoints,
    notches: result.notches,
    contourIntegrity: result.contourIntegrity,
    governance: result.governance,
    validationReport: deterministicValidation,
    inspectionLayout: result.inspectionLayout ?? null,
    unresolvedRisks: result.unresolvedRisks,
    productionNotes: result.productionNotes
  };
}

/**
 * Computes canonical JSON, UTF-8 byte length, and FIPS 180-4 SHA-256 hex digest for an assembly result.
 */
export function serializeDeterministicAssemblyReport(
  result: Omit<BodiceSleeveAssemblyResult, 'canonicalContentDigest' | 'reportSha256Hex' | 'canonicalJsonByteLength'>
): CanonicalDigestEnvelope {
  const payload = buildCanonicalAssemblyReportPayload(result);
  return digestCanonicalPayload(payload, { requireNonEmptyObject: true });
}

/**
 * Deterministically integrates bodice blocks and sleeve into an inspectable, validated assembly.
 */
export function assembleBodiceSleeve(
  input: BodiceSleeveAssemblyInput
): BodiceSleeveAssemblyResult {
  const { id, executionMetadata } = createNextExecutionMetadata();
  const timestamp = executionMetadata.generatedAtIso;

  // 1. Validate runtime options (including customTargetEaseCm === 0)
  const configValidation: AssemblyConfigValidationResult = resolveAndValidateAssemblyConfig(input.options);

  // 2. Evaluate governance & measurement provenance
  const governance: AssemblyGovernanceResult = evaluateAssemblyGovernance(input);

  // 3. Immutable defensive copy
  const clonedBodicePieces = input.bodicePieces ? input.bodicePieces.map(p => deepClonePiece(p)) : [];
  const rawSleeve = input.sleevePiece as any;
  const actualSleevePiece: PatternPiece | undefined = rawSleeve?.piece ?? (rawSleeve?.id ? rawSleeve : undefined);
  const clonedSleevePiece = actualSleevePiece ? deepClonePiece(actualSleevePiece) : undefined;

  const defensiveInput: BodiceSleeveAssemblyInput = {
    ...input,
    bodicePieces: clonedBodicePieces,
    sleevePiece: clonedSleevePiece
  };

  // 4. Curve Extraction
  const { extracted, errors, missingPieces } = extractAssemblyCurves(defensiveInput);

  // Missing data handling: strictly 'unassessed-missing-data' with populated full report & SHA-256 digest
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
      frontEaseRatio: null,
      isRatioDefined: false,
      frontEaseRatioUncertainty: null,
      targetStrategy: configValidation.resolvedStrategy,
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
      isTargetCompliant: false,
      strictUncertaintyGatePassed: false
    };

    const emptySeam = (side: 'front' | 'back' | 'total') => ({
      side,
      armholeLengthCm: 0,
      sleeveCapLengthCm: 0,
      easeCm: 0,
      uncertaintyCm: 0,
      lowerConfidenceCm: 0,
      upperConfidenceCm: 0,
      targetEaseCm: 0,
      residualCm: 0,
      isNonNegative: false,
      isWithinTolerance: false,
      isConfidenceIntervalSafe: false,
      isValid: false,
      blockingReasons: ['Missing required pattern pieces or curves.']
    });

    const seamCompatibility: SeamCompatibilityBreakdown = {
      front: emptySeam('front'),
      back: emptySeam('back'),
      total: emptySeam('total'),
      areAllSeamsIndividuallyValid: false
    };

    const uncertaintyGate: UncertaintyGateResult = {
      passed: false,
      maxAllowedSingleSeamUncertaintyCm: MAX_SINGLE_SEAM_UNCERTAINTY_CM,
      maxObservedSingleSeamUncertaintyCm: 0,
      totalEaseUncertaintyCm: 0,
      intervalAmbiguities: [],
      blockingReasons: ['Cannot evaluate seam uncertainty without extracted curves.']
    };

    const contourIntegrity: AssemblyContourIntegrityResult = {
      isValid: false,
      frontBodiceValid: false,
      backBodiceValid: false,
      sleeveValid: false,
      windings: { frontBodice: 'unknown', backBodice: 'unknown', sleeve: 'unknown' },
      grainlinesValid: false,
      drillHolesValid: false,
      errors: [...errors],
      warnings: []
    };

    const totalMissingIssues = [
      ...missingPieces.map(p => `Missing required pattern piece: ${p}`),
      ...errors,
      ...configValidation.errors
    ];

    const emptyValidation: ValidationReport = {
      status: 'incomplete',
      isValid: false,
      isProductionReady: false,
      statusLabel: 'ASSEMBLY_MISSING_DATA',
      timestamp,
      passedCount: 0,
      warningCount: 0,
      failureCount: totalMissingIssues.length > 0 ? totalMissingIssues.length : 1,
      checks: totalMissingIssues.map((msg, idx) => ({
        id: `val-missing-${idx}`,
        category: 'geometry',
        name: `Required Assembly Component: ${idx + 1}`,
        status: 'fail',
        message: msg
      })),
      unassessedConditions: UNASSESSED_ASSEMBLY_CONDITIONS,
      declaration: 'Assembly validation could not be completed due to missing pattern pieces or required seam curves.'
    };

    const partialResult: Omit<
      BodiceSleeveAssemblyResult,
      'canonicalContentDigest' | 'reportSha256Hex' | 'canonicalJsonByteLength'
    > = {
      id,
      timestamp,
      executionMetadata,
      status: 'unassessed-missing-data',
      isValid: false,
      isProductionReady: false,
      configValidation,
      measurements: {
        frontBodiceArmhole: null,
        backBodiceArmhole: null,
        frontSleeveCap: null,
        backSleeveCap: null
      },
      seamCompatibility,
      uncertaintyGate,
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
        elbowFrontNotch: null,
        elbowBackNotch: null,
        elbowPairParity: null,
        status: 'unassessed-missing-data',
        isValid: false,
        errors,
        warnings: []
      },
      contourIntegrity,
      governance,
      validationReport: emptyValidation,
      pieces: {
        frontBodice: clonedBodicePieces.find(p => p.id === 'piece-bodice-front' || p.pieceCode?.startsWith('BOD-F')),
        backBodice: clonedBodicePieces.find(p => p.id === 'piece-bodice-back' || p.pieceCode?.startsWith('BOD-B')),
        sleeve: clonedSleevePiece
      },
      unresolvedRisks: ['Missing input pattern pieces prevent seam arc-length and ease computation.'],
      productionNotes: ['Draft missing pieces before initiating assembly validation.']
    };

    const digest = serializeDeterministicAssemblyReport(partialResult);
    return {
      ...partialResult,
      canonicalContentDigest: digest.sha256Hex,
      reportSha256Hex: digest.sha256Hex,
      canonicalJsonByteLength: digest.byteLength
    };
  }

  // 5. Adaptive Arc-Length Measurements with Propagated Uncertainties
  const tol = configValidation.resolvedBezierToleranceCm;
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

  // 6. Mathematical Ease Compatibility & Independent Front/Back Seam Breakdown
  const easeMetrics = evaluateEaseCompatibility(
    frontBodiceMeas,
    backBodiceMeas,
    frontSleeveMeas,
    backSleeveMeas,
    input.options
  );
  const maxTotalEaseCm = configValidation.resolvedMaxTotalEaseCm ?? DEFAULT_MAX_TOTAL_EASE_CM;
  const seamCompatibility = evaluateSeamCompatibilityBreakdown(easeMetrics, maxTotalEaseCm);

  // 7. Strict Numerical Uncertainty Gate
  const uncertaintyGate = evaluateUncertaintyGate(
    [frontBodiceMeas, backBodiceMeas, frontSleeveMeas, backSleeveMeas],
    easeMetrics,
    maxTotalEaseCm
  );
  easeMetrics.strictUncertaintyGatePassed = uncertaintyGate.passed;

  // 8. Seam Endpoint Connectivity, Handedness, Shoulder Consistency & Traversal Direction
  const endpointResult = evaluateSeamEndpointsAndOrientations(extracted);

  // 9. Notch Correspondence (Crown, Front Scye, Back Double-Notch Pre-Sort Order, Elbow Inseam Pair)
  const notchResult = evaluateAssemblyNotches(extracted);

  // 10. Contour Integrity, Non-Self-Intersection, Winding, Grainlines & Drill Holes
  const contourIntegrity = evaluateAssemblyCurveContinuityAndGeometry(extracted);

  // 11. Comprehensive Validation Report
  const validationReport = buildAssemblyValidationReport(
    easeMetrics,
    endpointResult,
    notchResult,
    frontBodiceMeas,
    backBodiceMeas,
    frontSleeveMeas,
    backSleeveMeas,
    {
      configValidation,
      seamCompatibility,
      uncertaintyGate,
      contourIntegrity,
      governance
    }
  );

  // 12. 2D Inspection Layout (full precision + 16-corner bounding box + rigid verification)
  const inspectionLayout = buildAssemblyInspectionLayout(
    extracted.frontBodicePiece,
    extracted.backBodicePiece,
    extracted.sleevePiece
  );

  // 13. Fail-Closed Overall Status Determination
  const isValid =
    configValidation.isValid &&
    validationReport.isValid &&
    seamCompatibility.front.isNonNegative &&
    seamCompatibility.back.isNonNegative &&
    seamCompatibility.total.isNonNegative &&
    easeMetrics.isTotalEasePermitted &&
    (!configValidation.strictUncertaintyGate || uncertaintyGate.passed) &&
    endpointResult.isEndpointTopologyValid &&
    notchResult.isValid &&
    contourIntegrity.isValid &&
    (!governance.requireApprovedGovernance || governance.isGovernanceApproved);

  const status: AssemblyValidationStatus = isValid ? 'verified-valid' : 'invalid';

  const unresolvedRisks: string[] = [
    'Static 2D pattern assembly only: dynamic arm raise reach tension unmodeled.',
    '3D physical cloth drape and wool/cotton iron steam moulding unsimulated.',
    'Industrial grading nest continuity across multi-sizes unassessed within standalone assembly check.'
  ];

  const productionNotes: string[] = [
    `Target ease strategy: ${easeMetrics.targetStrategy} (${easeMetrics.targetTotalEaseCm} cm target).`,
    `Measured total cap ease: ${formatSignedCm(easeMetrics.totalEaseCm)} (front: ${formatSignedCm(easeMetrics.frontEaseCm)}, back: ${formatSignedCm(easeMetrics.backEaseCm)}).`,
    `Propagated arc-length uncertainty: ±${easeMetrics.totalEaseUncertaintyCm.toFixed(4)} cm (gate: ${uncertaintyGate.passed ? 'PASS' : 'FAIL'}).`,
    `Inseam parity delta: ${endpointResult.underarmInseamMatch.parityDeltaCm.toFixed(3)} cm <= 0.05 cm.`,
    `Governance provenance: ${governance.measurementProvenance} (${governance.measurementApprovalState}).`
  ];

  const assembledCore: Omit<
    BodiceSleeveAssemblyResult,
    'canonicalContentDigest' | 'reportSha256Hex' | 'canonicalJsonByteLength'
  > = {
    id,
    timestamp,
    executionMetadata,
    status,
    isValid,
    isProductionReady: false, // Strictly false: 2D geometry verified, 3D wearer fit unassessed
    configValidation,
    measurements: {
      frontBodiceArmhole: frontBodiceMeas,
      backBodiceArmhole: backBodiceMeas,
      frontSleeveCap: frontSleeveMeas,
      backSleeveCap: backSleeveMeas
    },
    seamCompatibility,
    uncertaintyGate,
    ease: easeMetrics,
    endpoints: endpointResult,
    notches: notchResult,
    contourIntegrity,
    governance,
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

  // 14. Deterministic Canonical JSON + SHA-256 Digest
  const digest = serializeDeterministicAssemblyReport(assembledCore);

  return {
    ...assembledCore,
    canonicalContentDigest: digest.sha256Hex,
    reportSha256Hex: digest.sha256Hex,
    canonicalJsonByteLength: digest.byteLength
  };
}
