/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isPieceEffectivelyVisible,
  PatternBoardSnapshot
} from './board-arrangement';
import type {
  CoordinateYAxisDirection,
  GeometryAuthorityTier,
  PatternArtifactBundle,
  PatternArtifactCoordinateFrame,
  PatternPieceRenderModel,
  RenderCurveSegment,
  RenderPoint2D
} from './contracts/pattern-render-artifact';
import {
  COINCIDENT_VERTEX_EPSILON_CM,
  CadContourKind,
  CadCurveEntity,
  CadEdgeEntity,
  CadInspectableEntity,
  CadVertexEntity,
  evaluateCubicBezierUnrounded,
  isFiniteRenderPoint,
  reconcileInspectedEntityWithArtifact
} from './entity-hit-test';
import type { PatternCadLayerVisibility } from './PatternAtelierViewContext';

/**
 * UX-2.3.3.2 — Pure Precision Measurement Engine (Advisory Drafting Measurements)
 *
 * Architectural & Governance Boundaries:
 * - Zero React, DOM, or browser API dependencies.
 * - Zero imports from legacy rounded math (`src/engine/geometry/math.ts`) or `roundCad`.
 * - All arithmetic uses unrounded IEEE-754 float64 values.
 * - NEVER mutates input `PatternArtifactBundle` or source coordinates.
 * - Every measurement result carries the mandatory non-certified disclosure:
 *   `"Advisory Drafting Measurement — Non-certified"` and `isCertified: false`.
 * - Never claims ADR-009 certification, AC-03 compliance, C1-Cert interval certification,
 *   or live Python geometry engine execution.
 */

export const ADVISORY_MEASUREMENT_DISCLOSURE =
  'Advisory Drafting Measurement — Non-certified' as const;

export const COINCIDENT_POINT_EPSILON_CM = 1e-12;
export const ZERO_LENGTH_EPSILON_CM = 1e-9;
export const CONTOUR_CLOSURE_EPSILON_CM = COINCIDENT_VERTEX_EPSILON_CM; // 1e-4 cm
export const MIN_CONTOUR_AREA_CM2 = 1e-4;
export const MIN_CONTOUR_COMPACTNESS_RATIO = 1e-9;
export const SELF_INTERSECTION_EPSILON_CM = 1e-6;
export const FOLDBACK_ANGLE_EPSILON_DEG = 1e-6;

export const STATIONARY_DERIVATIVE_FLOOR = 1e-9;
export const STATIONARY_RELATIVE_FACTOR = 1e-9;
export const NEAR_STATIONARY_RELATIVE_FACTOR = 1e-4;
export const FLAT_CURVATURE_EPSILON_INV_CM = 1e-9;

export const DEFAULT_ABSOLUTE_TOLERANCE_CM = 1e-5;
export const DEFAULT_RELATIVE_TOLERANCE = 1e-7;
export const DEFAULT_MAX_RECURSION_DEPTH = 14;
export const DEFAULT_MAX_SUBDIVISIONS = 4096;

export type MeasurementClassification =
  | 'algebraic-float64'
  | 'numerical-approximation'
  | 'indeterminate';

export interface MeasurementMetadataBase {
  readonly disclosure: typeof ADVISORY_MEASUREMENT_DISCLOSURE;
  readonly isCertified: false;
  readonly classification: MeasurementClassification;
  readonly authorityTier: GeometryAuthorityTier;
  readonly coordinateFrame: PatternArtifactCoordinateFrame;
  readonly sourceReferences: readonly string[];
}

export interface VectorAngleBreakdown {
  /** Frame-native atan2(dy, dx) in degrees, (-180, 180] */
  readonly frameAngleDeg: number;
  /** Visual on-screen inclination in degrees (+X = 0°, visual up = +90°), (-180, 180] */
  readonly visualInclinationDeg: number;
  /** Visual compass bearing in degrees (0° = visual North/Up, 90° = East/+X), [0, 360) */
  readonly compassBearingDeg: number;
  /** Undirected line orientation in degrees (invariant under endpoint reversal), [0, 180) */
  readonly undirectedOrientationDeg: number;
}

export interface SpaceDistanceMetrics {
  readonly pointACm: RenderPoint2D;
  readonly pointBCm: RenderPoint2D;
  readonly dxCm: number;
  readonly dyCm: number;
  readonly distanceCm: number;
  readonly isCoincident: boolean;
  readonly angles: VectorAngleBreakdown | null;
  readonly angleIndeterminateReason?: string;
}

export interface PointToPointMeasurementResult extends MeasurementMetadataBase {
  readonly measurementKind: 'point-to-point';
  readonly status: 'valid' | 'invalid-input';
  readonly anchorARef: string;
  readonly anchorBRef: string;
  readonly anchorALabel: string;
  readonly anchorBLabel: string;
  readonly pieceAId: string;
  readonly pieceACode: string;
  readonly pieceBId: string;
  readonly pieceBCode: string;
  readonly isSamePiece: boolean;
  /** Populated only when both anchors belong to the same piece */
  readonly local: SpaceDistanceMetrics | null;
  readonly localUnavailableReason?: string;
  /** Always populated when inputs are finite: CAD cutting-table board coordinates */
  readonly board: SpaceDistanceMetrics | null;
  readonly invalidReason?: string;
}

export interface StraightEdgeMeasurementResult extends MeasurementMetadataBase {
  readonly measurementKind: 'straight-edge';
  readonly status: 'valid' | 'degenerate-zero-length' | 'invalid-input';
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly contour: CadContourKind;
  readonly segmentId: string;
  readonly segmentRole: RenderCurveSegment['role'];
  readonly seamId?: string;
  readonly startLocalCm: RenderPoint2D;
  readonly endLocalCm: RenderPoint2D;
  readonly startBoardCm: RenderPoint2D | null;
  readonly endBoardCm: RenderPoint2D | null;
  readonly midpointLocalCm: RenderPoint2D | null;
  readonly midpointBoardCm: RenderPoint2D | null;
  readonly dxCm: number | null;
  readonly dyCm: number | null;
  readonly lengthCm: number | null;
  readonly isZeroLength: boolean;
  readonly unitDirection: RenderPoint2D | null;
  readonly angles: VectorAngleBreakdown | null;
  readonly indeterminateReason?: string;
}

export type ContourOrientationStatus =
  | 'determined'
  | 'non-finite-geometry'
  | 'insufficient-geometry'
  | 'open-contour'
  | 'self-intersecting-or-uncertain'
  | 'collapsed-area';

export interface ContourOrientationAnalysis {
  readonly status: ContourOrientationStatus;
  /** Exact Green's theorem algebraic signed area in (x, y) coordinates (cm²), or null if non-finite/open */
  readonly algebraicSignedAreaCm2: number | null;
  /** +1 for algebraically positive signed area, -1 for negative, null when indeterminate */
  readonly orientationSign: 1 | -1 | null;
  /** Visual on-screen winding derived from algebraic sign + yAxisDirection */
  readonly visualWinding: 'CCW' | 'CW' | null;
  /** Algebraic winding in raw (x, y) coordinates */
  readonly algebraicWinding: 'CCW' | 'CW' | null;
  /** Whether the derived algebraic winding matches coordinateFrame.exteriorWinding */
  readonly matchesMetadataExteriorWinding: boolean | null;
  readonly orientationDerivedFrom: 'greens-theorem-signed-area';
  /** Contract carries exterior contours only; cutout/hole classification is not asserted */
  readonly contourRoleAssumed: 'exterior-only-contract';
  readonly maxClosureGapCm: number | null;
  readonly perimeterApproxCm: number | null;
  readonly reason?: string;
}

export interface VertexAngleMeasurementResult extends MeasurementMetadataBase {
  readonly measurementKind: 'vertex-angle';
  readonly status: 'valid' | 'included-only' | 'indeterminate';
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly contour: CadContourKind;
  readonly vertexRef: string;
  readonly localPointCm: RenderPoint2D;
  readonly boardPointCm: RenderPoint2D;
  readonly incomingSegmentId: string | null;
  readonly outgoingSegmentId: string | null;
  readonly incomingUnitTangent: RenderPoint2D | null;
  readonly outgoingUnitTangent: RenderPoint2D | null;
  readonly usedHigherOrderEndpointTangent: boolean;
  /** Unsigned angle between the two incident contour rays in [0°, 180°] */
  readonly includedAngleDeg: number | null;
  /** Deflection / turn angle between incoming and outgoing travel tangents in [0°, 180°] */
  readonly turnAngleDeg: number | null;
  readonly interiorExteriorStatus: 'determined' | 'indeterminate';
  readonly interiorAngleDeg: number | null;
  readonly exteriorAngleDeg: number | null;
  readonly isReflex: boolean | null;
  readonly contourOrientation: ContourOrientationAnalysis;
  readonly indeterminateReason?: string;
}

export type CurvatureRadiusState = 'finite' | 'infinite' | 'undefined';

export interface CubicBezierDifferentialResult extends MeasurementMetadataBase {
  readonly measurementKind: 'cubic-bezier-differential';
  readonly status: 'valid' | 'stationary-degenerate' | 'invalid-input';
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly contour: CadContourKind;
  readonly segmentId: string;
  readonly segmentRole: RenderCurveSegment['role'];
  readonly seamId?: string;
  readonly parameterT: number;
  readonly pointLocalCm: RenderPoint2D | null;
  readonly pointBoardCm: RenderPoint2D | null;
  readonly firstDerivativeCm: RenderPoint2D | null;
  readonly secondDerivativeCm: RenderPoint2D | null;
  readonly speedCmPerUnitT: number | null;
  readonly controlPolygonLengthCm: number | null;
  readonly isStationary: boolean;
  readonly isNearStationary: boolean;
  readonly unitTangent: RenderPoint2D | null;
  readonly tangentAngles: VectorAngleBreakdown | null;
  /** Frame-native signed curvature (x'y'' - y'x'') / |B'|^3 in cm⁻¹ */
  readonly signedCurvatureInvCm: number | null;
  /** Visual on-screen signed curvature (+ = left turn on screen) in cm⁻¹ */
  readonly visualSignedCurvatureInvCm: number | null;
  readonly unsignedCurvatureInvCm: number | null;
  readonly radiusOfCurvatureCm: number | null;
  readonly radiusState: CurvatureRadiusState;
  readonly warning?: string;
}

export interface CubicArcLengthOptions {
  readonly absoluteToleranceCm?: number;
  readonly relativeTolerance?: number;
  readonly maxRecursionDepth?: number;
  readonly maxSubdivisions?: number;
}

export interface ResolvedCubicArcLengthOptions {
  readonly absoluteToleranceCm: number;
  readonly relativeTolerance: number;
  readonly maxRecursionDepth: number;
  readonly maxSubdivisions: number;
}

export type ArcLengthConvergenceStatus =
  | 'converged'
  | 'non-converged-depth-limit'
  | 'non-converged-subdivision-budget'
  | 'invalid-input';

export interface CubicBezierArcLengthResult extends MeasurementMetadataBase {
  readonly measurementKind: 'cubic-bezier-arc-length';
  readonly domain: readonly [number, number];
  readonly isPartial: boolean;
  readonly arcLengthCm: number | null;
  /**
   * Numerical error estimator obtained from adaptive 5-point Gauss–Legendre subdivision
   * comparisons. This is an estimator, NOT a certified mathematical error bound.
   */
  readonly quadratureErrorEstimateCm: number | null;
  /**
   * Accumulated geometric enclosure width: (control polygon upper bound - chord lower bound)
   * across all terminal sub-Bézier segments.
   */
  readonly geometricEnclosureWidthCm: number | null;
  readonly chordLowerBoundCm: number | null;
  readonly controlPolygonUpperBoundCm: number | null;
  readonly geometricEnclosureExceedsTolerance: boolean;
  readonly converged: boolean;
  readonly convergenceStatus: ArcLengthConvergenceStatus;
  readonly subdivisionsEvaluated: number;
  readonly maxDepthReached: number;
  readonly method: 'adaptive-gauss-legendre-5pt';
  readonly options: ResolvedCubicArcLengthOptions;
  readonly warning?: string;
  readonly geometricEnclosureNote?: string;
}

export interface CubicBezierCombinedMeasurement {
  readonly differential: CubicBezierDifferentialResult;
  readonly fullArcLength: CubicBezierArcLengthResult;
  readonly partialArcLength: CubicBezierArcLengthResult;
}

export type MeasureToolSubMode = 'auto' | 'pair-distance' | 'single-feature';

export type MeasurementSessionMode =
  | 'idle'
  | 'awaiting-second-anchor'
  | 'single-entity'
  | 'pair-complete';

export interface MeasurementSession {
  readonly mode: MeasurementSessionMode;
  readonly anchorA: CadInspectableEntity | null;
  readonly anchorB: CadInspectableEntity | null;
}

export const EMPTY_MEASUREMENT_SESSION: MeasurementSession = {
  mode: 'idle',
  anchorA: null,
  anchorB: null
};

export type MeasurementEvaluation =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'awaiting-second-anchor';
      readonly anchorA: CadInspectableEntity;
      readonly previewVertexAngle: VertexAngleMeasurementResult | null;
    }
  | {
      readonly kind: 'pair-distance';
      readonly anchorA: CadInspectableEntity;
      readonly anchorB: CadInspectableEntity;
      readonly result: PointToPointMeasurementResult;
    }
  | {
      readonly kind: 'straight-edge';
      readonly entity: CadEdgeEntity;
      readonly result: StraightEdgeMeasurementResult;
    }
  | {
      readonly kind: 'vertex-angle';
      readonly entity: CadVertexEntity;
      readonly result: VertexAngleMeasurementResult;
    }
  | {
      readonly kind: 'cubic-bezier';
      readonly entity: CadCurveEntity;
      readonly result: CubicBezierCombinedMeasurement;
    };

// ---------------------------------------------------------------------------
// 1. Internal Pure Math Helpers (Strict Unrounded Float64)
// ---------------------------------------------------------------------------

const RAD_TO_DEG = 180 / Math.PI;

function dist2D(a: RenderPoint2D, b: RenderPoint2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function modPositive(value: number, modulus: number): number {
  const m = ((value % modulus) + modulus) % modulus;
  return m >= modulus ? 0 : normalizeZero(m);
}

function computeVectorAngles(
  dx: number,
  dy: number,
  yAxisDirection: CoordinateYAxisDirection
): VectorAngleBreakdown {
  const frameAngleDeg = normalizeZero(Math.atan2(dy, dx) * RAD_TO_DEG);
  const visualDy = yAxisDirection === 'svg-y-down' ? -dy : dy;
  const visualInclinationDeg = normalizeZero(Math.atan2(visualDy, dx) * RAD_TO_DEG);
  // Bearing: 0° = visual North/Up (0, +1), 90° = East/Right (+1, 0)
  const compassBearingDeg = modPositive(Math.atan2(dx, visualDy) * RAD_TO_DEG, 360);
  const undirectedOrientationDeg = modPositive(visualInclinationDeg, 180);

  return {
    frameAngleDeg,
    visualInclinationDeg,
    compassBearingDeg,
    undirectedOrientationDeg
  };
}

function isSegmentFinite(seg: RenderCurveSegment): boolean {
  if (!isFiniteRenderPoint(seg.p0) || !isFiniteRenderPoint(seg.p3)) return false;
  if (seg.kind === 'cubic-bezier') {
    return isFiniteRenderPoint(seg.p1) && isFiniteRenderPoint(seg.p2);
  }
  return true;
}

interface CubicControlPoints {
  readonly p0: RenderPoint2D;
  readonly p1: RenderPoint2D;
  readonly p2: RenderPoint2D;
  readonly p3: RenderPoint2D;
}

function evaluateCubicFirstDerivative(c: CubicControlPoints, t: number): RenderPoint2D {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const b = 6 * mt * t;
  const d = 3 * t * t;
  return {
    x: a * (c.p1.x - c.p0.x) + b * (c.p2.x - c.p1.x) + d * (c.p3.x - c.p2.x),
    y: a * (c.p1.y - c.p0.y) + b * (c.p2.y - c.p1.y) + d * (c.p3.y - c.p2.y)
  };
}

function evaluateCubicSecondDerivative(c: CubicControlPoints, t: number): RenderPoint2D {
  const mt = 1 - t;
  const a = 6 * mt;
  const b = 6 * t;
  return {
    x: a * (c.p2.x - 2 * c.p1.x + c.p0.x) + b * (c.p3.x - 2 * c.p2.x + c.p1.x),
    y: a * (c.p2.y - 2 * c.p1.y + c.p0.y) + b * (c.p3.y - 2 * c.p2.y + c.p1.y)
  };
}

function lerpPoint(a: RenderPoint2D, b: RenderPoint2D, t: number): RenderPoint2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

function splitCubicAtT(
  c: CubicControlPoints,
  t: number
): { readonly left: CubicControlPoints; readonly right: CubicControlPoints } {
  const q0 = lerpPoint(c.p0, c.p1, t);
  const q1 = lerpPoint(c.p1, c.p2, t);
  const q2 = lerpPoint(c.p2, c.p3, t);
  const r0 = lerpPoint(q0, q1, t);
  const r1 = lerpPoint(q1, q2, t);
  const s = lerpPoint(r0, r1, t);
  return {
    left: { p0: c.p0, p1: q0, p2: r0, p3: s },
    right: { p0: s, p1: r1, p2: q2, p3: c.p3 }
  };
}

function extractCubicSubdomain(
  c: CubicControlPoints,
  tStart: number,
  tEnd: number
): CubicControlPoints {
  if (tStart === 0 && tEnd === 1) return c;
  if (tEnd <= tStart) {
    const pt = evaluateCubicBezierUnrounded(c.p0, c.p1, c.p2, c.p3, tStart);
    return { p0: pt, p1: pt, p2: pt, p3: pt };
  }
  const upToEnd = tEnd < 1 ? splitCubicAtT(c, tEnd).left : c;
  if (tStart <= 0) return upToEnd;
  const relStart = tStart / tEnd;
  return splitCubicAtT(upToEnd, relStart).right;
}

// ---------------------------------------------------------------------------
// 2. Point-to-Point Distance (Same-Piece Local & Cross-Piece Board)
// ---------------------------------------------------------------------------

function computeSpaceDistance(
  a: RenderPoint2D,
  b: RenderPoint2D,
  yAxisDirection: CoordinateYAxisDirection
): SpaceDistanceMetrics {
  const dxCm = normalizeZero(b.x - a.x);
  const dyCm = normalizeZero(b.y - a.y);
  const distanceCm = Math.hypot(dxCm, dyCm);
  const isCoincident = distanceCm <= COINCIDENT_POINT_EPSILON_CM;

  if (distanceCm <= ZERO_LENGTH_EPSILON_CM) {
    return {
      pointACm: { x: a.x, y: a.y },
      pointBCm: { x: b.x, y: b.y },
      dxCm,
      dyCm,
      distanceCm,
      isCoincident,
      angles: null,
      angleIndeterminateReason: isCoincident
        ? 'Anchors are coincident (distance <= 1e-12 cm); bearing and orientation are undefined.'
        : 'Separation is below 1e-9 cm numerical threshold; bearing and orientation are undefined.'
    };
  }

  return {
    pointACm: { x: a.x, y: a.y },
    pointBCm: { x: b.x, y: b.y },
    dxCm,
    dyCm,
    distanceCm,
    isCoincident: false,
    angles: computeVectorAngles(dxCm, dyCm, yAxisDirection)
  };
}

export function measurePointToPointDistance(
  anchorA: CadInspectableEntity,
  anchorB: CadInspectableEntity,
  coordinateFrame: PatternArtifactCoordinateFrame,
  authorityTier: GeometryAuthorityTier
): PointToPointMeasurementResult {
  const baseMeta = {
    disclosure: ADVISORY_MEASUREMENT_DISCLOSURE,
    isCertified: false as const,
    authorityTier,
    coordinateFrame,
    sourceReferences: [anchorA.presentationRef, anchorB.presentationRef],
    measurementKind: 'point-to-point' as const,
    anchorARef: anchorA.presentationRef,
    anchorBRef: anchorB.presentationRef,
    anchorALabel: anchorA.label,
    anchorBLabel: anchorB.label,
    pieceAId: anchorA.pieceId,
    pieceACode: anchorA.pieceCode,
    pieceBId: anchorB.pieceId,
    pieceBCode: anchorB.pieceCode,
    isSamePiece: anchorA.pieceId === anchorB.pieceId
  };

  if (
    !isFiniteRenderPoint(anchorA.localPointCm) ||
    !isFiniteRenderPoint(anchorB.localPointCm) ||
    !isFiniteRenderPoint(anchorA.boardPointCm) ||
    !isFiniteRenderPoint(anchorB.boardPointCm)
  ) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'invalid-input',
      local: null,
      board: null,
      invalidReason: 'One or both anchor points contain non-finite coordinates.'
    };
  }

  const board = computeSpaceDistance(
    anchorA.boardPointCm,
    anchorB.boardPointCm,
    coordinateFrame.yAxisDirection
  );

  if (!Number.isFinite(board.distanceCm)) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'invalid-input',
      local: null,
      board: null,
      invalidReason: 'Computed board distance overflowed IEEE-754 float64 range.'
    };
  }

  if (baseMeta.isSamePiece) {
    const local = computeSpaceDistance(
      anchorA.localPointCm,
      anchorB.localPointCm,
      coordinateFrame.yAxisDirection
    );
    if (!Number.isFinite(local.distanceCm)) {
      return {
        ...baseMeta,
        classification: 'indeterminate',
        status: 'invalid-input',
        local: null,
        board,
        invalidReason: 'Computed local distance overflowed IEEE-754 float64 range.'
      };
    }
    return {
      ...baseMeta,
      classification: 'algebraic-float64',
      status: 'valid',
      local,
      board
    };
  }

  return {
    ...baseMeta,
    classification: 'algebraic-float64',
    status: 'valid',
    local: null,
    localUnavailableReason:
      'Cross-piece measurement: piece-local coordinate origins are independent; board-space distance reflects current visual table arrangement.',
    board
  };
}

// ---------------------------------------------------------------------------
// 3. Straight-Edge Measurement
// ---------------------------------------------------------------------------

export function measureStraightEdge(
  segment: RenderCurveSegment,
  pieceId: string,
  pieceCode: string,
  contour: CadContourKind,
  coordinateFrame: PatternArtifactCoordinateFrame,
  authorityTier: GeometryAuthorityTier,
  boardOffsetCm?: RenderPoint2D | null
): StraightEdgeMeasurementResult {
  const presentationRef = `${pieceId}::${contour}::${segment.id}`;
  const validOffset = boardOffsetCm && isFiniteRenderPoint(boardOffsetCm) ? boardOffsetCm : null;

  const baseMeta = {
    disclosure: ADVISORY_MEASUREMENT_DISCLOSURE,
    isCertified: false as const,
    authorityTier,
    coordinateFrame,
    sourceReferences: [presentationRef],
    measurementKind: 'straight-edge' as const,
    pieceId,
    pieceCode,
    contour,
    segmentId: segment.id,
    segmentRole: segment.role,
    seamId: segment.seamId
  };

  if (
    segment.kind !== 'line' ||
    !isFiniteRenderPoint(segment.p0) ||
    !isFiniteRenderPoint(segment.p3)
  ) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'invalid-input',
      startLocalCm: segment.p0,
      endLocalCm: segment.p3,
      startBoardCm: null,
      endBoardCm: null,
      midpointLocalCm: null,
      midpointBoardCm: null,
      dxCm: null,
      dyCm: null,
      lengthCm: null,
      isZeroLength: false,
      unitDirection: null,
      angles: null,
      indeterminateReason:
        segment.kind !== 'line'
          ? 'Expected a straight line segment.'
          : 'Straight edge endpoints contain non-finite coordinates.'
    };
  }

  const startLocalCm: RenderPoint2D = { x: segment.p0.x, y: segment.p0.y };
  const endLocalCm: RenderPoint2D = { x: segment.p3.x, y: segment.p3.y };
  const startBoardCm: RenderPoint2D | null = validOffset
    ? { x: startLocalCm.x + validOffset.x, y: startLocalCm.y + validOffset.y }
    : null;
  const endBoardCm: RenderPoint2D | null = validOffset
    ? { x: endLocalCm.x + validOffset.x, y: endLocalCm.y + validOffset.y }
    : null;
  const midpointLocalCm: RenderPoint2D = {
    x: (startLocalCm.x + endLocalCm.x) * 0.5,
    y: (startLocalCm.y + endLocalCm.y) * 0.5
  };
  const midpointBoardCm: RenderPoint2D | null = validOffset
    ? { x: midpointLocalCm.x + validOffset.x, y: midpointLocalCm.y + validOffset.y }
    : null;

  const dxCm = normalizeZero(endLocalCm.x - startLocalCm.x);
  const dyCm = normalizeZero(endLocalCm.y - startLocalCm.y);
  const lengthCm = Math.hypot(dxCm, dyCm);

  if (!Number.isFinite(lengthCm)) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'invalid-input',
      startLocalCm,
      endLocalCm,
      startBoardCm,
      endBoardCm,
      midpointLocalCm,
      midpointBoardCm,
      dxCm: null,
      dyCm: null,
      lengthCm: null,
      isZeroLength: false,
      unitDirection: null,
      angles: null,
      indeterminateReason: 'Computed edge length overflowed float64 range.'
    };
  }

  if (lengthCm <= ZERO_LENGTH_EPSILON_CM) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'degenerate-zero-length',
      startLocalCm,
      endLocalCm,
      startBoardCm,
      endBoardCm,
      midpointLocalCm,
      midpointBoardCm,
      dxCm,
      dyCm,
      lengthCm,
      isZeroLength: true,
      unitDirection: null,
      angles: null,
      indeterminateReason:
        'Zero-length or degenerate edge (length <= 1e-9 cm); bearing and orientation are indeterminate.'
    };
  }

  return {
    ...baseMeta,
    classification: 'algebraic-float64',
    status: 'valid',
    startLocalCm,
    endLocalCm,
    startBoardCm,
    endBoardCm,
    midpointLocalCm,
    midpointBoardCm,
    dxCm,
    dyCm,
    lengthCm,
    isZeroLength: false,
    unitDirection: { x: dxCm / lengthCm, y: dyCm / lengthCm },
    angles: computeVectorAngles(dxCm, dyCm, coordinateFrame.yAxisDirection)
  };
}

// ---------------------------------------------------------------------------
// 4. Contour Orientation (Green's Theorem + Closure + Simplicity Check)
// ---------------------------------------------------------------------------

interface DiscretizedChord {
  readonly segIndex: number;
  readonly subIndex: number;
  readonly a: RenderPoint2D;
  readonly b: RenderPoint2D;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function orient2D(a: RenderPoint2D, b: RenderPoint2D, c: RenderPoint2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegmentInclusive(p: RenderPoint2D, a: RenderPoint2D, b: RenderPoint2D, eps: number): boolean {
  const minX = Math.min(a.x, b.x) - eps;
  const maxX = Math.max(a.x, b.x) + eps;
  const minY = Math.min(a.y, b.y) - eps;
  const maxY = Math.max(a.y, b.y) + eps;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

function segmentsIntersectOrTouch(
  c1: DiscretizedChord,
  c2: DiscretizedChord,
  eps: number
): boolean {
  if (
    c1.maxX + eps < c2.minX ||
    c2.maxX + eps < c1.minX ||
    c1.maxY + eps < c2.minY ||
    c2.maxY + eps < c1.minY
  ) {
    return false;
  }

  const a = c1.a;
  const b = c1.b;
  const c = c2.a;
  const d = c2.b;

  const len1 = Math.hypot(b.x - a.x, b.y - a.y);
  const len2 = Math.hypot(d.x - c.x, d.y - c.y);
  const areaEps1 = eps * Math.max(1, len1);
  const areaEps2 = eps * Math.max(1, len2);

  const o1 = orient2D(a, b, c);
  const o2 = orient2D(a, b, d);
  const o3 = orient2D(c, d, a);
  const o4 = orient2D(c, d, b);

  // Strict proper crossing
  if (((o1 > areaEps1 && o2 < -areaEps1) || (o1 < -areaEps1 && o2 > areaEps1)) &&
      ((o3 > areaEps2 && o4 < -areaEps2) || (o3 < -areaEps2 && o4 > areaEps2))) {
    return true;
  }

  // Collinear or touching within epsilon
  if (Math.abs(o1) <= areaEps1 && pointOnSegmentInclusive(c, a, b, eps)) return true;
  if (Math.abs(o2) <= areaEps1 && pointOnSegmentInclusive(d, a, b, eps)) return true;
  if (Math.abs(o3) <= areaEps2 && pointOnSegmentInclusive(a, c, d, eps)) return true;
  if (Math.abs(o4) <= areaEps2 && pointOnSegmentInclusive(b, c, d, eps)) return true;

  return false;
}

function buildContourChords(segments: readonly RenderCurveSegment[]): DiscretizedChord[] {
  const chords: DiscretizedChord[] = [];
  const CUBIC_SUBDIVISIONS = 16;

  for (let segIndex = 0; segIndex < segments.length; segIndex++) {
    const seg = segments[segIndex];
    if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
      let prev = seg.p0;
      for (let k = 1; k <= CUBIC_SUBDIVISIONS; k++) {
        const curr =
          k === CUBIC_SUBDIVISIONS
            ? seg.p3
            : evaluateCubicBezierUnrounded(seg.p0, seg.p1, seg.p2, seg.p3, k / CUBIC_SUBDIVISIONS);
        chords.push({
          segIndex,
          subIndex: k - 1,
          a: prev,
          b: curr,
          minX: Math.min(prev.x, curr.x),
          maxX: Math.max(prev.x, curr.x),
          minY: Math.min(prev.y, curr.y),
          maxY: Math.max(prev.y, curr.y)
        });
        prev = curr;
      }
    } else {
      chords.push({
        segIndex,
        subIndex: 0,
        a: seg.p0,
        b: seg.p3,
        minX: Math.min(seg.p0.x, seg.p3.x),
        maxX: Math.max(seg.p0.x, seg.p3.x),
        minY: Math.min(seg.p0.y, seg.p3.y),
        maxY: Math.max(seg.p0.y, seg.p3.y)
      });
    }
  }
  return chords;
}

function detectContourSelfIntersection(segments: readonly RenderCurveSegment[]): boolean {
  const chords = buildContourChords(segments);
  const m = chords.length;
  if (m < 2) return false;

  // Check for adjacent exact foldback (180° reversal retracing itself)
  for (let i = 0; i < m; i++) {
    const c1 = chords[i];
    const c2 = chords[(i + 1) % m];
    const v1x = c1.b.x - c1.a.x;
    const v1y = c1.b.y - c1.a.y;
    const v2x = c2.b.x - c2.a.x;
    const v2y = c2.b.y - c2.a.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 > ZERO_LENGTH_EPSILON_CM && l2 > ZERO_LENGTH_EPSILON_CM) {
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
      const cross = Math.abs(v1x * v2y - v1y * v2x) / (l1 * l2);
      // Antiparallel retracing foldback (dot ≈ -1, cross ≈ 0)
      if (dot < -1 + 1e-9 && cross < 1e-6) {
        return true;
      }
    }
  }

  // Check all non-adjacent chord pairs (wrapping circularly)
  for (let i = 0; i < m; i++) {
    for (let j = i + 2; j < m; j++) {
      // Skip wrap-around adjacent pair (0 and m-1)
      if (i === 0 && j === m - 1) continue;
      if (segmentsIntersectOrTouch(chords[i], chords[j], SELF_INTERSECTION_EPSILON_CM)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Computes exact Green's-theorem signed area contribution of one segment in (x, y).
 * For lines: 1/2 * (x0*y3 - x3*y0).
 * For cubics: exact degree-3 polynomial integral of 1/2 * (x*y' - y*x') dt over [0, 1].
 */
export function computeSegmentGreensSignedAreaCm2(seg: RenderCurveSegment): number {
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    const { p0, p1, p2, p3 } = seg;
    return (
      (6 * (p0.x * p1.y - p1.x * p0.y) +
        3 * (p0.x * p2.y - p2.x * p0.y) +
        (p0.x * p3.y - p3.x * p0.y) +
        3 * (p1.x * p2.y - p2.x * p1.y) +
        3 * (p1.x * p3.y - p3.x * p1.y) +
        6 * (p2.x * p3.y - p3.x * p2.y)) /
      20
    );
  }
  return 0.5 * (seg.p0.x * seg.p3.y - seg.p3.x * seg.p0.y);
}

/**
 * Binding Decision 1:
 * Determines contour orientation directly from exact Green's-theorem algebraic signed area
 * after verifying finite coordinates, sufficient contour geometry, sequential closure,
 * non-self-intersection, and non-collapsed area.
 */
export function analyzeContourOrientation(
  segments: readonly RenderCurveSegment[],
  coordinateFrame: PatternArtifactCoordinateFrame
): ContourOrientationAnalysis {
  const base = {
    orientationDerivedFrom: 'greens-theorem-signed-area' as const,
    contourRoleAssumed: 'exterior-only-contract' as const
  };

  if (segments.length < 2) {
    return {
      ...base,
      status: 'insufficient-geometry',
      algebraicSignedAreaCm2: null,
      orientationSign: null,
      visualWinding: null,
      algebraicWinding: null,
      matchesMetadataExteriorWinding: null,
      maxClosureGapCm: null,
      perimeterApproxCm: null,
      reason: 'Contour has fewer than 2 segments; interior/exterior orientation is indeterminate.'
    };
  }

  for (const seg of segments) {
    if (!isSegmentFinite(seg)) {
      return {
        ...base,
        status: 'non-finite-geometry',
        algebraicSignedAreaCm2: null,
        orientationSign: null,
        visualWinding: null,
        algebraicWinding: null,
        matchesMetadataExteriorWinding: null,
        maxClosureGapCm: null,
        perimeterApproxCm: null,
        reason: 'Contour contains non-finite segment coordinates.'
      };
    }
  }

  let maxClosureGapCm = 0;
  let signedAreaCm2 = 0;
  let perimeterApproxCm = 0;
  const n = segments.length;

  for (let i = 0; i < n; i++) {
    const curr = segments[i];
    const next = segments[(i + 1) % n];
    const gap = dist2D(curr.p3, next.p0);
    if (!Number.isFinite(gap)) {
      return {
        ...base,
        status: 'non-finite-geometry',
        algebraicSignedAreaCm2: null,
        orientationSign: null,
        visualWinding: null,
        algebraicWinding: null,
        matchesMetadataExteriorWinding: null,
        maxClosureGapCm: null,
        perimeterApproxCm: null,
        reason: 'Contour closure gap calculation was non-finite.'
      };
    }
    if (gap > maxClosureGapCm) maxClosureGapCm = gap;

    signedAreaCm2 += computeSegmentGreensSignedAreaCm2(curr);
    if (curr.kind === 'cubic-bezier' && curr.p1 && curr.p2) {
      perimeterApproxCm +=
        dist2D(curr.p0, curr.p1) + dist2D(curr.p1, curr.p2) + dist2D(curr.p2, curr.p3);
    } else {
      perimeterApproxCm += dist2D(curr.p0, curr.p3);
    }
  }

  if (!Number.isFinite(signedAreaCm2) || !Number.isFinite(perimeterApproxCm)) {
    return {
      ...base,
      status: 'non-finite-geometry',
      algebraicSignedAreaCm2: null,
      orientationSign: null,
      visualWinding: null,
      algebraicWinding: null,
      matchesMetadataExteriorWinding: null,
      maxClosureGapCm,
      perimeterApproxCm: null,
      reason: 'Green’s-theorem signed area overflowed float64 range.'
    };
  }

  if (maxClosureGapCm > CONTOUR_CLOSURE_EPSILON_CM) {
    return {
      ...base,
      status: 'open-contour',
      algebraicSignedAreaCm2: null,
      orientationSign: null,
      visualWinding: null,
      algebraicWinding: null,
      matchesMetadataExteriorWinding: null,
      maxClosureGapCm,
      perimeterApproxCm,
      reason: `Contour is not sequentially closed (max gap ${maxClosureGapCm.toExponential(3)} cm > ${CONTOUR_CLOSURE_EPSILON_CM} cm).`
    };
  }

  if (detectContourSelfIntersection(segments)) {
    return {
      ...base,
      status: 'self-intersecting-or-uncertain',
      algebraicSignedAreaCm2: signedAreaCm2,
      orientationSign: null,
      visualWinding: null,
      algebraicWinding: null,
      matchesMetadataExteriorWinding: null,
      maxClosureGapCm,
      perimeterApproxCm,
      reason:
        'Contour exhibits self-intersection, retracing foldback, or uncertain simplicity; interior/exterior classification rejected conservatively.'
    };
  }

  const absArea = Math.abs(signedAreaCm2);
  const compactness =
    perimeterApproxCm > ZERO_LENGTH_EPSILON_CM
      ? absArea / (perimeterApproxCm * perimeterApproxCm)
      : 0;

  if (absArea <= MIN_CONTOUR_AREA_CM2 || compactness < MIN_CONTOUR_COMPACTNESS_RATIO) {
    return {
      ...base,
      status: 'collapsed-area',
      algebraicSignedAreaCm2: signedAreaCm2,
      orientationSign: null,
      visualWinding: null,
      algebraicWinding: null,
      matchesMetadataExteriorWinding: null,
      maxClosureGapCm,
      perimeterApproxCm,
      reason:
        'Contour encloses collapsed or numerically indeterminate area (<= 1e-4 cm² or degenerate sliver).'
    };
  }

  const orientationSign: 1 | -1 = signedAreaCm2 > 0 ? 1 : -1;
  const algebraicWinding: 'CCW' | 'CW' = orientationSign > 0 ? 'CCW' : 'CW';
  // In svg-y-down, positive algebraic area appears clockwise visually on screen;
  // negative algebraic area appears counter-clockwise visually on screen.
  const visualWinding: 'CCW' | 'CW' =
    coordinateFrame.yAxisDirection === 'svg-y-down'
      ? orientationSign > 0
        ? 'CW'
        : 'CCW'
      : algebraicWinding;

  const matchesMetadataExteriorWinding = algebraicWinding === coordinateFrame.exteriorWinding;

  return {
    ...base,
    status: 'determined',
    algebraicSignedAreaCm2: signedAreaCm2,
    orientationSign,
    visualWinding,
    algebraicWinding,
    matchesMetadataExteriorWinding,
    maxClosureGapCm,
    perimeterApproxCm
  };
}

// ---------------------------------------------------------------------------
// 5. Vertex Angle Measurement (Included + Interior/Exterior)
// ---------------------------------------------------------------------------

interface EndpointTangentResult {
  readonly ok: true;
  readonly unitTangent: RenderPoint2D;
  readonly usedHigherOrder: boolean;
}

interface EndpointTangentFailure {
  readonly ok: false;
  readonly reason: string;
}

/**
 * Computes the unit travel tangent of `seg` at either its start (`endpoint = 'p0'`,
 * leaving the vertex as t -> 0+) or its end (`endpoint = 'p3'`, arriving at the vertex
 * as t -> 1-). Uses L'Hôpital 2nd/3rd-order limits for degenerate coincident cubic handles.
 */
function computeSegmentEndpointTravelTangent(
  seg: RenderCurveSegment,
  endpoint: 'p0' | 'p3'
): EndpointTangentResult | EndpointTangentFailure {
  if (!isSegmentFinite(seg)) {
    return { ok: false, reason: 'Incident segment contains non-finite coordinates.' };
  }

  if (seg.kind === 'line') {
    const dx = seg.p3.x - seg.p0.x;
    const dy = seg.p3.y - seg.p0.y;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len <= ZERO_LENGTH_EPSILON_CM) {
      return { ok: false, reason: 'Incident straight segment has zero or degenerate length.' };
    }
    return {
      ok: true,
      unitTangent: { x: dx / len, y: dy / len },
      usedHigherOrder: false
    };
  }

  if (!seg.p1 || !seg.p2) {
    return { ok: false, reason: 'Incident cubic Bézier is missing control handles.' };
  }

  const c: CubicControlPoints = { p0: seg.p0, p1: seg.p1, p2: seg.p2, p3: seg.p3 };
  const polyLen =
    dist2D(c.p0, c.p1) + dist2D(c.p1, c.p2) + dist2D(c.p2, c.p3);
  const tol = Math.max(STATIONARY_DERIVATIVE_FLOOR, STATIONARY_RELATIVE_FACTOR * polyLen);

  if (endpoint === 'p0') {
    // 1st order: B'(0) = 3(P1 - P0)
    const d1 = evaluateCubicFirstDerivative(c, 0);
    const n1 = Math.hypot(d1.x, d1.y);
    if (Number.isFinite(n1) && n1 > tol) {
      return { ok: true, unitTangent: { x: d1.x / n1, y: d1.y / n1 }, usedHigherOrder: false };
    }
    // 2nd order L'Hôpital (t -> 0+): +B''(0)
    const d2 = evaluateCubicSecondDerivative(c, 0);
    const n2 = Math.hypot(d2.x, d2.y);
    if (Number.isFinite(n2) && n2 > tol) {
      return { ok: true, unitTangent: { x: d2.x / n2, y: d2.y / n2 }, usedHigherOrder: true };
    }
    // 3rd order L'Hôpital (t -> 0+): +B'''(0) = 6(P3 - 3P2 + 3P1 - P0)
    const d3x = 6 * (c.p3.x - 3 * c.p2.x + 3 * c.p1.x - c.p0.x);
    const d3y = 6 * (c.p3.y - 3 * c.p2.y + 3 * c.p1.y - c.p0.y);
    const n3 = Math.hypot(d3x, d3y);
    if (Number.isFinite(n3) && n3 > tol) {
      return { ok: true, unitTangent: { x: d3x / n3, y: d3y / n3 }, usedHigherOrder: true };
    }
    return { ok: false, reason: 'Incident outgoing cubic Bézier is collapsed to a single point.' };
  }

  // endpoint === 'p3': travel direction arriving at p3 as t -> 1- (u = 1 - t -> 0+)
  // B'(1 - u) = B'(1) - u*B''(1) + (u^2/2)*B'''(1)
  const d1 = evaluateCubicFirstDerivative(c, 1);
  const n1 = Math.hypot(d1.x, d1.y);
  if (Number.isFinite(n1) && n1 > tol) {
    return { ok: true, unitTangent: { x: d1.x / n1, y: d1.y / n1 }, usedHigherOrder: false };
  }
  const d2 = evaluateCubicSecondDerivative(c, 1);
  const n2 = Math.hypot(d2.x, d2.y);
  if (Number.isFinite(n2) && n2 > tol) {
    // Leading term is -u * B''(1) with u > 0
    return { ok: true, unitTangent: { x: -d2.x / n2, y: -d2.y / n2 }, usedHigherOrder: true };
  }
  const d3x = 6 * (c.p3.x - 3 * c.p2.x + 3 * c.p1.x - c.p0.x);
  const d3y = 6 * (c.p3.y - 3 * c.p2.y + 3 * c.p1.y - c.p0.y);
  const n3 = Math.hypot(d3x, d3y);
  if (Number.isFinite(n3) && n3 > tol) {
    return { ok: true, unitTangent: { x: d3x / n3, y: d3y / n3 }, usedHigherOrder: true };
  }
  return { ok: false, reason: 'Incident incoming cubic Bézier is collapsed to a single point.' };
}

export function measureVertexAngle(
  vertex: CadVertexEntity,
  contourSegments: readonly RenderCurveSegment[],
  coordinateFrame: PatternArtifactCoordinateFrame,
  authorityTier: GeometryAuthorityTier
): VertexAngleMeasurementResult {
  const orientation = analyzeContourOrientation(contourSegments, coordinateFrame);
  const incomingRef = vertex.incidentSegments.find(s => s.direction === 'incoming') ?? null;
  const outgoingRef = vertex.incidentSegments.find(s => s.direction === 'outgoing') ?? null;

  const baseMeta = {
    disclosure: ADVISORY_MEASUREMENT_DISCLOSURE,
    isCertified: false as const,
    authorityTier,
    coordinateFrame,
    sourceReferences: [vertex.presentationRef],
    measurementKind: 'vertex-angle' as const,
    pieceId: vertex.pieceId,
    pieceCode: vertex.pieceCode,
    contour: vertex.contour,
    vertexRef: vertex.presentationRef,
    localPointCm: { x: vertex.localPointCm.x, y: vertex.localPointCm.y },
    boardPointCm: { x: vertex.boardPointCm.x, y: vertex.boardPointCm.y },
    incomingSegmentId: incomingRef?.segmentId ?? null,
    outgoingSegmentId: outgoingRef?.segmentId ?? null,
    contourOrientation: orientation
  };

  if (!isFiniteRenderPoint(vertex.localPointCm) || !isFiniteRenderPoint(vertex.boardPointCm)) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'indeterminate',
      incomingUnitTangent: null,
      outgoingUnitTangent: null,
      usedHigherOrderEndpointTangent: false,
      includedAngleDeg: null,
      turnAngleDeg: null,
      interiorExteriorStatus: 'indeterminate',
      interiorAngleDeg: null,
      exteriorAngleDeg: null,
      isReflex: null,
      indeterminateReason: 'Vertex coordinates are non-finite.'
    };
  }

  if (!incomingRef || !outgoingRef) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'indeterminate',
      incomingUnitTangent: null,
      outgoingUnitTangent: null,
      usedHigherOrderEndpointTangent: false,
      includedAngleDeg: null,
      turnAngleDeg: null,
      interiorExteriorStatus: 'indeterminate',
      interiorAngleDeg: null,
      exteriorAngleDeg: null,
      isReflex: null,
      indeterminateReason:
        'Open or terminal vertex lacks both incoming and outgoing incident segments.'
    };
  }

  const incomingSeg = contourSegments.find(s => s.id === incomingRef.segmentId);
  const outgoingSeg = contourSegments.find(s => s.id === outgoingRef.segmentId);
  if (!incomingSeg || !outgoingSeg) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'indeterminate',
      incomingUnitTangent: null,
      outgoingUnitTangent: null,
      usedHigherOrderEndpointTangent: false,
      includedAngleDeg: null,
      turnAngleDeg: null,
      interiorExteriorStatus: 'indeterminate',
      interiorAngleDeg: null,
      exteriorAngleDeg: null,
      isReflex: null,
      indeterminateReason: 'Incident segment could not be resolved in contour.'
    };
  }

  const tInRes = computeSegmentEndpointTravelTangent(incomingSeg, 'p3');
  const tOutRes = computeSegmentEndpointTravelTangent(outgoingSeg, 'p0');

  if (!tInRes.ok || !tOutRes.ok) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'indeterminate',
      incomingUnitTangent: tInRes.ok ? tInRes.unitTangent : null,
      outgoingUnitTangent: tOutRes.ok ? tOutRes.unitTangent : null,
      usedHigherOrderEndpointTangent:
        (tInRes.ok && tInRes.usedHigherOrder) || (tOutRes.ok && tOutRes.usedHigherOrder),
      includedAngleDeg: null,
      turnAngleDeg: null,
      interiorExteriorStatus: 'indeterminate',
      interiorAngleDeg: null,
      exteriorAngleDeg: null,
      isReflex: null,
      indeterminateReason: !tInRes.ok
        ? tInRes.reason
        : !tOutRes.ok
          ? tOutRes.reason
          : 'Incident tangent could not be determined.'
    };
  }

  const tIn = tInRes.unitTangent;
  const tOut = tOutRes.unitTangent;
  const usedHigherOrder = tInRes.usedHigherOrder || tOutRes.usedHigherOrder;

  // Outward rays from vertex along the two incident edges:
  // u = -tIn (back along incoming segment), v = tOut (forward along outgoing segment)
  const ux = -tIn.x;
  const uy = -tIn.y;
  const vx = tOut.x;
  const vy = tOut.y;

  const dotUV = Math.max(-1, Math.min(1, ux * vx + uy * vy));
  const crossUV = ux * vy - uy * vx;
  const includedAngleDeg = normalizeZero(Math.atan2(Math.abs(crossUV), dotUV) * RAD_TO_DEG);

  // Deflection / turn angle between travel directions tIn and tOut
  const dotTurn = Math.max(-1, Math.min(1, tIn.x * tOut.x + tIn.y * tOut.y));
  const crossTurn = tIn.x * tOut.y - tIn.y * tOut.x;
  const turnAngleDeg = normalizeZero(Math.atan2(Math.abs(crossTurn), dotTurn) * RAD_TO_DEG);

  // Preserve valid unsigned included angle even when interior/exterior is indeterminate
  if (
    orientation.status !== 'determined' ||
    orientation.orientationSign === null ||
    includedAngleDeg <= FOLDBACK_ANGLE_EPSILON_DEG
  ) {
    const reason =
      includedAngleDeg <= FOLDBACK_ANGLE_EPSILON_DEG
        ? 'Incident tangents form a 0° foldback cusp; interior/exterior orientation is indeterminate.'
        : orientation.reason ?? 'Contour orientation is indeterminate.';
    return {
      ...baseMeta,
      classification: 'algebraic-float64',
      status: 'included-only',
      incomingUnitTangent: tIn,
      outgoingUnitTangent: tOut,
      usedHigherOrderEndpointTangent: usedHigherOrder,
      includedAngleDeg,
      turnAngleDeg,
      interiorExteriorStatus: 'indeterminate',
      interiorAngleDeg: null,
      exteriorAngleDeg: null,
      isReflex: null,
      indeterminateReason: reason
    };
  }

  // Interior angle via exact algebraic Green's-theorem orientation sign s ∈ {-1, +1}:
  // θ_int = (atan2(s * (v × u), v · u) * 180/π + 360) mod 360
  const crossVU = vx * uy - vy * ux;
  const rawIntDeg = Math.atan2(orientation.orientationSign * crossVU, dotUV) * RAD_TO_DEG;
  const interiorAngleDeg = modPositive(rawIntDeg, 360);
  const exteriorAngleDeg = normalizeZero(360 - interiorAngleDeg);
  const isReflex = interiorAngleDeg > 180 + 1e-9;

  return {
    ...baseMeta,
    classification: 'algebraic-float64',
    status: 'valid',
    incomingUnitTangent: tIn,
    outgoingUnitTangent: tOut,
    usedHigherOrderEndpointTangent: usedHigherOrder,
    includedAngleDeg,
    turnAngleDeg,
    interiorExteriorStatus: 'determined',
    interiorAngleDeg,
    exteriorAngleDeg,
    isReflex
  };
}

// ---------------------------------------------------------------------------
// 6. Cubic Bézier Differential Analysis (B'(t), B''(t), Tangent, Curvature)
// ---------------------------------------------------------------------------

export function measureCubicBezierAtT(
  segment: RenderCurveSegment,
  parameterT: number,
  pieceId: string,
  pieceCode: string,
  contour: CadContourKind,
  coordinateFrame: PatternArtifactCoordinateFrame,
  authorityTier: GeometryAuthorityTier,
  boardOffsetCm?: RenderPoint2D | null
): CubicBezierDifferentialResult {
  const presentationRef = `${pieceId}::${contour}::${segment.id}`;
  const validOffset = boardOffsetCm && isFiniteRenderPoint(boardOffsetCm) ? boardOffsetCm : null;

  const baseMeta = {
    disclosure: ADVISORY_MEASUREMENT_DISCLOSURE,
    isCertified: false as const,
    authorityTier,
    coordinateFrame,
    sourceReferences: [presentationRef],
    measurementKind: 'cubic-bezier-differential' as const,
    pieceId,
    pieceCode,
    contour,
    segmentId: segment.id,
    segmentRole: segment.role,
    seamId: segment.seamId,
    parameterT
  };

  if (
    segment.kind !== 'cubic-bezier' ||
    !segment.p1 ||
    !segment.p2 ||
    !isSegmentFinite(segment) ||
    !Number.isFinite(parameterT) ||
    parameterT < 0 ||
    parameterT > 1
  ) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'invalid-input',
      pointLocalCm: null,
      pointBoardCm: null,
      firstDerivativeCm: null,
      secondDerivativeCm: null,
      speedCmPerUnitT: null,
      controlPolygonLengthCm: null,
      isStationary: false,
      isNearStationary: false,
      unitTangent: null,
      tangentAngles: null,
      signedCurvatureInvCm: null,
      visualSignedCurvatureInvCm: null,
      unsignedCurvatureInvCm: null,
      radiusOfCurvatureCm: null,
      radiusState: 'undefined',
      warning: 'Invalid cubic Bézier segment or parameter t outside [0, 1].'
    };
  }

  const c: CubicControlPoints = {
    p0: segment.p0,
    p1: segment.p1,
    p2: segment.p2,
    p3: segment.p3
  };
  const pointLocalCm = evaluateCubicBezierUnrounded(c.p0, c.p1, c.p2, c.p3, parameterT);
  const d1 = evaluateCubicFirstDerivative(c, parameterT);
  const d2 = evaluateCubicSecondDerivative(c, parameterT);
  const speed = Math.hypot(d1.x, d1.y);
  const controlPolygonLengthCm =
    dist2D(c.p0, c.p1) + dist2D(c.p1, c.p2) + dist2D(c.p2, c.p3);

  if (
    !isFiniteRenderPoint(pointLocalCm) ||
    !isFiniteRenderPoint(d1) ||
    !isFiniteRenderPoint(d2) ||
    !Number.isFinite(speed) ||
    !Number.isFinite(controlPolygonLengthCm)
  ) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'invalid-input',
      pointLocalCm: null,
      pointBoardCm: null,
      firstDerivativeCm: null,
      secondDerivativeCm: null,
      speedCmPerUnitT: null,
      controlPolygonLengthCm: null,
      isStationary: false,
      isNearStationary: false,
      unitTangent: null,
      tangentAngles: null,
      signedCurvatureInvCm: null,
      visualSignedCurvatureInvCm: null,
      unsignedCurvatureInvCm: null,
      radiusOfCurvatureCm: null,
      radiusState: 'undefined',
      warning: 'Non-finite derivative evaluation encountered.'
    };
  }

  const pointBoardCm: RenderPoint2D | null = validOffset
    ? { x: pointLocalCm.x + validOffset.x, y: pointLocalCm.y + validOffset.y }
    : null;

  const stationaryThreshold = Math.max(
    STATIONARY_DERIVATIVE_FLOOR,
    STATIONARY_RELATIVE_FACTOR * controlPolygonLengthCm
  );
  if (speed <= stationaryThreshold) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'stationary-degenerate',
      pointLocalCm,
      pointBoardCm,
      firstDerivativeCm: d1,
      secondDerivativeCm: d2,
      speedCmPerUnitT: speed,
      controlPolygonLengthCm,
      isStationary: true,
      isNearStationary: false,
      unitTangent: null,
      tangentAngles: null,
      signedCurvatureInvCm: null,
      visualSignedCurvatureInvCm: null,
      unsignedCurvatureInvCm: null,
      radiusOfCurvatureCm: null,
      radiusState: 'undefined',
      warning:
        'Stationary point or collapsed derivative (|B\'(t)| <= stationary threshold); tangent, curvature, and radius are undefined.'
    };
  }

  const isNearStationary =
    controlPolygonLengthCm > 0 &&
    speed <= NEAR_STATIONARY_RELATIVE_FACTOR * controlPolygonLengthCm;

  const unitTangent: RenderPoint2D = {
    x: d1.x / speed,
    y: d1.y / speed
  };
  const tangentAngles = computeVectorAngles(d1.x, d1.y, coordinateFrame.yAxisDirection);

  const cross = d1.x * d2.y - d1.y * d2.x;
  const speedCubed = speed * speed * speed;
  const signedCurvatureInvCm = normalizeZero(cross / speedCubed);

  if (!Number.isFinite(signedCurvatureInvCm)) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      status: 'stationary-degenerate',
      pointLocalCm,
      pointBoardCm,
      firstDerivativeCm: d1,
      secondDerivativeCm: d2,
      speedCmPerUnitT: speed,
      controlPolygonLengthCm,
      isStationary: true,
      isNearStationary: false,
      unitTangent,
      tangentAngles,
      signedCurvatureInvCm: null,
      visualSignedCurvatureInvCm: null,
      unsignedCurvatureInvCm: null,
      radiusOfCurvatureCm: null,
      radiusState: 'undefined',
      warning: 'Curvature computation overflowed near a stationary point.'
    };
  }

  const visualSignedCurvatureInvCm = normalizeZero(
    coordinateFrame.yAxisDirection === 'svg-y-down'
      ? -signedCurvatureInvCm
      : signedCurvatureInvCm
  );
  const unsignedCurvatureInvCm = Math.abs(signedCurvatureInvCm);

  let radiusOfCurvatureCm: number | null;
  let radiusState: CurvatureRadiusState;
  if (unsignedCurvatureInvCm <= FLAT_CURVATURE_EPSILON_INV_CM) {
    radiusOfCurvatureCm = null;
    radiusState = 'infinite';
  } else {
    radiusOfCurvatureCm = 1 / unsignedCurvatureInvCm;
    radiusState = Number.isFinite(radiusOfCurvatureCm) ? 'finite' : 'infinite';
    if (radiusState === 'infinite') {
      radiusOfCurvatureCm = null;
    }
  }

  return {
    ...baseMeta,
    classification: 'algebraic-float64',
    status: 'valid',
    pointLocalCm,
    pointBoardCm,
    firstDerivativeCm: d1,
    secondDerivativeCm: d2,
    speedCmPerUnitT: speed,
    controlPolygonLengthCm,
    isStationary: false,
    isNearStationary,
    unitTangent,
    tangentAngles,
    signedCurvatureInvCm,
    visualSignedCurvatureInvCm,
    unsignedCurvatureInvCm,
    radiusOfCurvatureCm,
    radiusState,
    warning: isNearStationary
      ? 'Near-stationary parameterization (|B\'(t)| <= 1e-4 * control polygon); curvature is numerically sensitive.'
      : undefined
  };
}

// ---------------------------------------------------------------------------
// 7. Adaptive 5-Point Gauss–Legendre Cubic Bézier Arc-Length Approximation
// ---------------------------------------------------------------------------

// Exact 5-point Gauss–Legendre nodes & weights on [-1, 1] mapped to [0, 1]
const SQRT_10_OVER_7 = Math.sqrt(10 / 7);
const GL5_X1 = Math.sqrt(5 - 2 * SQRT_10_OVER_7) / 3;
const GL5_X2 = Math.sqrt(5 + 2 * SQRT_10_OVER_7) / 3;
const SQRT_70 = Math.sqrt(70);
const GL5_W0 = 128 / 225;
const GL5_W1 = (322 + 13 * SQRT_70) / 900;
const GL5_W2 = (322 - 13 * SQRT_70) / 900;

const GL5_NODES_01: readonly number[] = [
  0.5 * (1 - GL5_X2),
  0.5 * (1 - GL5_X1),
  0.5,
  0.5 * (1 + GL5_X1),
  0.5 * (1 + GL5_X2)
];

const GL5_WEIGHTS_01: readonly number[] = [
  0.5 * GL5_W2,
  0.5 * GL5_W1,
  0.5 * GL5_W0,
  0.5 * GL5_W1,
  0.5 * GL5_W2
];

function gaussLegendre5CubicArcLength(c: CubicControlPoints): number {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    const d1 = evaluateCubicFirstDerivative(c, GL5_NODES_01[i]);
    sum += GL5_WEIGHTS_01[i] * Math.hypot(d1.x, d1.y);
  }
  return sum;
}

function resolveArcLengthOptions(
  options?: CubicArcLengthOptions
): ResolvedCubicArcLengthOptions | null {
  const absoluteToleranceCm = options?.absoluteToleranceCm ?? DEFAULT_ABSOLUTE_TOLERANCE_CM;
  const relativeTolerance = options?.relativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE;
  const maxRecursionDepth = options?.maxRecursionDepth ?? DEFAULT_MAX_RECURSION_DEPTH;
  const maxSubdivisions = options?.maxSubdivisions ?? DEFAULT_MAX_SUBDIVISIONS;

  if (
    !Number.isFinite(absoluteToleranceCm) ||
    absoluteToleranceCm <= 0 ||
    !Number.isFinite(relativeTolerance) ||
    relativeTolerance < 0 ||
    !Number.isInteger(maxRecursionDepth) ||
    maxRecursionDepth < 0 ||
    !Number.isInteger(maxSubdivisions) ||
    maxSubdivisions < 1
  ) {
    return null;
  }

  return {
    absoluteToleranceCm,
    relativeTolerance,
    maxRecursionDepth,
    maxSubdivisions
  };
}

/**
 * Computes an advisory numerical approximation of cubic Bézier arc length over `[tStart, tEnd]`
 * using adaptive 5-point Gauss–Legendre quadrature with de Casteljau bisection.
 *
 * Explicitly separates:
 * - `quadratureErrorEstimateCm`: adaptive quadrature difference estimator (NOT a certified bound).
 * - `geometricEnclosureWidthCm`: accumulated (control-polygon upper bound - chord lower bound).
 * - `converged`: whether the numerical stopping criteria were met within depth & subdivision budgets.
 */
export function approximateCubicBezierArcLength(
  segment: RenderCurveSegment,
  coordinateFrame: PatternArtifactCoordinateFrame,
  authorityTier: GeometryAuthorityTier,
  pieceId: string,
  contour: CadContourKind,
  domain: readonly [number, number] = [0, 1],
  options?: CubicArcLengthOptions
): CubicBezierArcLengthResult {
  const [tStart, tEnd] = domain;
  const presentationRef = `${pieceId}::${contour}::${segment.id}`;
  const isPartial = tStart > 0 || tEnd < 1;
  const resolved = resolveArcLengthOptions(options);

  const fallbackOptions: ResolvedCubicArcLengthOptions = resolved ?? {
    absoluteToleranceCm: DEFAULT_ABSOLUTE_TOLERANCE_CM,
    relativeTolerance: DEFAULT_RELATIVE_TOLERANCE,
    maxRecursionDepth: DEFAULT_MAX_RECURSION_DEPTH,
    maxSubdivisions: DEFAULT_MAX_SUBDIVISIONS
  };

  const baseMeta = {
    disclosure: ADVISORY_MEASUREMENT_DISCLOSURE,
    isCertified: false as const,
    authorityTier,
    coordinateFrame,
    sourceReferences: [presentationRef],
    measurementKind: 'cubic-bezier-arc-length' as const,
    domain: [tStart, tEnd] as const,
    isPartial,
    method: 'adaptive-gauss-legendre-5pt' as const,
    options: fallbackOptions
  };

  if (
    !resolved ||
    segment.kind !== 'cubic-bezier' ||
    !segment.p1 ||
    !segment.p2 ||
    !isSegmentFinite(segment) ||
    !Number.isFinite(tStart) ||
    !Number.isFinite(tEnd) ||
    tStart < 0 ||
    tEnd > 1 ||
    tStart > tEnd
  ) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      arcLengthCm: null,
      quadratureErrorEstimateCm: null,
      geometricEnclosureWidthCm: null,
      chordLowerBoundCm: null,
      controlPolygonUpperBoundCm: null,
      geometricEnclosureExceedsTolerance: false,
      converged: false,
      convergenceStatus: 'invalid-input',
      subdivisionsEvaluated: 0,
      maxDepthReached: 0,
      warning: 'Invalid cubic Bézier geometry, parameter domain, or quadrature configuration.'
    };
  }

  if (tEnd - tStart <= 0) {
    return {
      ...baseMeta,
      classification: 'numerical-approximation',
      arcLengthCm: 0,
      quadratureErrorEstimateCm: 0,
      geometricEnclosureWidthCm: 0,
      chordLowerBoundCm: 0,
      controlPolygonUpperBoundCm: 0,
      geometricEnclosureExceedsTolerance: false,
      converged: true,
      convergenceStatus: 'converged',
      subdivisionsEvaluated: 1,
      maxDepthReached: 0
    };
  }

  const rootCubic = extractCubicSubdomain(
    { p0: segment.p0, p1: segment.p1, p2: segment.p2, p3: segment.p3 },
    tStart,
    tEnd
  );

  let totalLength = 0;
  let totalQuadError = 0;
  let totalChordLower = 0;
  let totalPolyUpper = 0;
  let subdivisionsEvaluated = 0;
  let maxDepthReached = 0;
  let hitDepthLimit = false;
  let hitSubdivisionBudget = false;
  let nonFiniteEncountered = false;

  interface StackFrame {
    readonly cubic: CubicControlPoints;
    readonly wholeEst: number;
    readonly depth: number;
    readonly spanFraction: number;
  }

  const rootEst = gaussLegendre5CubicArcLength(rootCubic);
  if (!Number.isFinite(rootEst)) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      arcLengthCm: null,
      quadratureErrorEstimateCm: null,
      geometricEnclosureWidthCm: null,
      chordLowerBoundCm: null,
      controlPolygonUpperBoundCm: null,
      geometricEnclosureExceedsTolerance: false,
      converged: false,
      convergenceStatus: 'invalid-input',
      subdivisionsEvaluated: 0,
      maxDepthReached: 0,
      warning: 'Initial Gauss–Legendre evaluation produced a non-finite value.'
    };
  }

  const stack: StackFrame[] = [
    {
      cubic: rootCubic,
      wholeEst: rootEst,
      depth: 0,
      spanFraction: 1
    }
  ];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    subdivisionsEvaluated += 1;
    if (frame.depth > maxDepthReached) {
      maxDepthReached = frame.depth;
    }

    const chord = dist2D(frame.cubic.p0, frame.cubic.p3);
    const poly =
      dist2D(frame.cubic.p0, frame.cubic.p1) +
      dist2D(frame.cubic.p1, frame.cubic.p2) +
      dist2D(frame.cubic.p2, frame.cubic.p3);

    if (!Number.isFinite(chord) || !Number.isFinite(poly)) {
      nonFiniteEncountered = true;
      break;
    }

    const { left, right } = splitCubicAtT(frame.cubic, 0.5);
    const leftEst = gaussLegendre5CubicArcLength(left);
    const rightEst = gaussLegendre5CubicArcLength(right);
    const combinedEst = leftEst + rightEst;

    if (!Number.isFinite(leftEst) || !Number.isFinite(rightEst) || !Number.isFinite(combinedEst)) {
      nonFiniteEncountered = true;
      break;
    }

    const localErrorEst = Math.abs(combinedEst - frame.wholeEst);
    const localTol = Math.max(
      resolved.absoluteToleranceCm * frame.spanFraction,
      resolved.relativeTolerance * Math.max(combinedEst, 1e-12)
    );

    const geometricGap = Math.max(0, poly - chord);
    // Require at least 1 split when non-linear to avoid symmetric node cancellation at depth 0
    const mustSplitOnce = frame.depth === 0 && geometricGap > 1e-12 && resolved.maxRecursionDepth > 0;
    const isLocallyConverged = !mustSplitOnce && localErrorEst <= localTol;

    if (isLocallyConverged) {
      // Accumulate exact sub-half chord/polygon enclosure bounds
      const leftChord = dist2D(left.p0, left.p3);
      const rightChord = dist2D(right.p0, right.p3);
      const leftPoly =
        dist2D(left.p0, left.p1) + dist2D(left.p1, left.p2) + dist2D(left.p2, left.p3);
      const rightPoly =
        dist2D(right.p0, right.p1) + dist2D(right.p1, right.p2) + dist2D(right.p2, right.p3);

      totalLength += combinedEst;
      totalQuadError += localErrorEst;
      totalChordLower += leftChord + rightChord;
      totalPolyUpper += leftPoly + rightPoly;
      continue;
    }

    // Cannot recurse further: check depth and subdivision budget strictly (never silently relax)
    const canRecurseDepth = frame.depth < resolved.maxRecursionDepth;
    const projectedEvaluations = subdivisionsEvaluated + stack.length + 2;
    const canRecurseBudget = projectedEvaluations <= resolved.maxSubdivisions;

    if (!canRecurseDepth || !canRecurseBudget) {
      if (!canRecurseDepth) hitDepthLimit = true;
      if (!canRecurseBudget) hitSubdivisionBudget = true;

      const leftChord = dist2D(left.p0, left.p3);
      const rightChord = dist2D(right.p0, right.p3);
      const leftPoly =
        dist2D(left.p0, left.p1) + dist2D(left.p1, left.p2) + dist2D(left.p2, left.p3);
      const rightPoly =
        dist2D(right.p0, right.p1) + dist2D(right.p1, right.p2) + dist2D(right.p2, right.p3);

      totalLength += combinedEst;
      totalQuadError += localErrorEst;
      totalChordLower += leftChord + rightChord;
      totalPolyUpper += leftPoly + rightPoly;
      continue;
    }

    // Push right then left so left is popped first (deterministic DFS)
    stack.push({
      cubic: right,
      wholeEst: rightEst,
      depth: frame.depth + 1,
      spanFraction: frame.spanFraction * 0.5
    });
    stack.push({
      cubic: left,
      wholeEst: leftEst,
      depth: frame.depth + 1,
      spanFraction: frame.spanFraction * 0.5
    });
  }

  if (
    nonFiniteEncountered ||
    !Number.isFinite(totalLength) ||
    !Number.isFinite(totalQuadError) ||
    !Number.isFinite(totalChordLower) ||
    !Number.isFinite(totalPolyUpper)
  ) {
    return {
      ...baseMeta,
      classification: 'indeterminate',
      arcLengthCm: null,
      quadratureErrorEstimateCm: null,
      geometricEnclosureWidthCm: null,
      chordLowerBoundCm: null,
      controlPolygonUpperBoundCm: null,
      geometricEnclosureExceedsTolerance: false,
      converged: false,
      convergenceStatus: 'invalid-input',
      subdivisionsEvaluated,
      maxDepthReached,
      warning: 'Non-finite intermediate value encountered during adaptive quadrature.'
    };
  }

  const geometricEnclosureWidthCm = Math.max(0, totalPolyUpper - totalChordLower);
  const effectiveToleranceCm = Math.max(
    resolved.absoluteToleranceCm,
    resolved.relativeTolerance * Math.max(totalLength, 1e-12)
  );
  const geometricEnclosureExceedsTolerance = geometricEnclosureWidthCm > effectiveToleranceCm;

  const converged = !hitDepthLimit && !hitSubdivisionBudget;
  const convergenceStatus: ArcLengthConvergenceStatus = converged
    ? 'converged'
    : hitSubdivisionBudget
      ? 'non-converged-subdivision-budget'
      : 'non-converged-depth-limit';

  let warning: string | undefined;
  if (!converged) {
    warning =
      convergenceStatus === 'non-converged-subdivision-budget'
        ? `Adaptive quadrature reached maximum subdivision budget (${resolved.maxSubdivisions}) without meeting tolerance (${resolved.absoluteToleranceCm} cm). Returning best uncertified approximation.`
        : `Adaptive quadrature reached maximum recursion depth (${resolved.maxRecursionDepth}) without meeting tolerance (${resolved.absoluteToleranceCm} cm). Returning best uncertified approximation.`;
  }

  const geometricEnclosureNote = geometricEnclosureExceedsTolerance
    ? `Geometric control-polygon/chord enclosure width (${geometricEnclosureWidthCm.toExponential(3)} cm) exceeds requested quadrature tolerance (${resolved.absoluteToleranceCm} cm); quadrature error estimate is not a certified geometric error bound.`
    : undefined;

  return {
    ...baseMeta,
    classification: 'numerical-approximation',
    arcLengthCm: totalLength,
    quadratureErrorEstimateCm: totalQuadError,
    geometricEnclosureWidthCm,
    chordLowerBoundCm: totalChordLower,
    controlPolygonUpperBoundCm: totalPolyUpper,
    geometricEnclosureExceedsTolerance,
    converged,
    convergenceStatus,
    subdivisionsEvaluated,
    maxDepthReached,
    warning,
    geometricEnclosureNote
  };
}

// ---------------------------------------------------------------------------
// 8. Measurement Session State Transitions & Reactive Reconciliation
// ---------------------------------------------------------------------------

function isSingleEntityInspectableForAuto(entity: CadInspectableEntity): boolean {
  return entity.entityKind === 'edge' || entity.entityKind === 'curve';
}

export function applyMeasurementEntityClick(
  prev: MeasurementSession,
  entity: CadInspectableEntity,
  subMode: MeasureToolSubMode = 'auto'
): MeasurementSession {
  if (subMode === 'single-feature') {
    if (
      entity.entityKind === 'edge' ||
      entity.entityKind === 'curve' ||
      entity.entityKind === 'vertex'
    ) {
      return {
        mode: 'single-entity',
        anchorA: entity,
        anchorB: null
      };
    }
    // Non-single-feature point entities (notch, dart-landmark, handle) start a pair measurement
    return {
      mode: 'awaiting-second-anchor',
      anchorA: entity,
      anchorB: null
    };
  }

  if (subMode === 'pair-distance') {
    if (prev.mode === 'awaiting-second-anchor' && prev.anchorA) {
      return {
        mode: 'pair-complete',
        anchorA: prev.anchorA,
        anchorB: entity
      };
    }
    return {
      mode: 'awaiting-second-anchor',
      anchorA: entity,
      anchorB: null
    };
  }

  // Default 'auto' sub-mode:
  // If already awaiting second anchor:
  // - Clicking the exact same vertex again locks it as a completed single-entity vertex-angle measurement.
  // - Clicking any other entity completes a pair-distance measurement.
  if (prev.mode === 'awaiting-second-anchor' && prev.anchorA) {
    if (
      entity.entityKind === 'vertex' &&
      entity.presentationRef === prev.anchorA.presentationRef
    ) {
      return {
        mode: 'single-entity',
        anchorA: entity,
        anchorB: null
      };
    }
    return {
      mode: 'pair-complete',
      anchorA: prev.anchorA,
      anchorB: entity
    };
  }

  // Starting a fresh measurement:
  if (isSingleEntityInspectableForAuto(entity)) {
    return {
      mode: 'single-entity',
      anchorA: entity,
      anchorB: null
    };
  }

  return {
    mode: 'awaiting-second-anchor',
    anchorA: entity,
    anchorB: null
  };
}

export function swapMeasurementAnchors(session: MeasurementSession): MeasurementSession {
  if (session.mode !== 'pair-complete' || !session.anchorA || !session.anchorB) {
    return session;
  }
  return {
    mode: 'pair-complete',
    anchorA: session.anchorB,
    anchorB: session.anchorA
  };
}

export function lockPendingVertexAngleMeasurement(session: MeasurementSession): MeasurementSession {
  if (
    session.mode === 'awaiting-second-anchor' &&
    session.anchorA &&
    session.anchorA.entityKind === 'vertex'
  ) {
    return {
      mode: 'single-entity',
      anchorA: session.anchorA,
      anchorB: null
    };
  }
  return session;
}

/**
 * Binding Decision 2:
 * - Completed measurements (`single-entity`, `pair-complete`) remain visible when switching to Select or Pan.
 * - Incomplete first-point/second-point sessions (`awaiting-second-anchor`) are cleared when leaving Measure mode.
 */
export function transitionMeasurementSessionOnToolExit(
  session: MeasurementSession,
  nextTool: string
): MeasurementSession {
  if (nextTool === 'measure-preview') {
    return session;
  }
  if (nextTool === 'inspect-entity') {
    return EMPTY_MEASUREMENT_SESSION;
  }
  if (session.mode === 'awaiting-second-anchor') {
    return EMPTY_MEASUREMENT_SESSION;
  }
  // Completed measurements persist across Select (V) and Pan (H)
  if (nextTool === 'select' || nextTool === 'pan') {
    return session;
  }
  return EMPTY_MEASUREMENT_SESSION;
}

/**
 * Revalidates a MeasurementSession against the active artifact, board snapshot, and
 * layer visibility. Refreshes coordinates reactively when board placements move, and
 * invalidates cleanly when any referenced piece, entity, or layer disappears.
 */
export function reconcileMeasurementSessionWithArtifact(
  session: MeasurementSession,
  artifact: PatternArtifactBundle | null,
  boardState: PatternBoardSnapshot,
  layerVisibility?: PatternCadLayerVisibility
): MeasurementSession {
  if (session.mode === 'idle' || !session.anchorA || !artifact) {
    return EMPTY_MEASUREMENT_SESSION;
  }

  const nextA = reconcileInspectedEntityWithArtifact(
    session.anchorA,
    artifact,
    boardState,
    layerVisibility
  );
  if (!nextA) {
    return EMPTY_MEASUREMENT_SESSION;
  }

  if (session.mode === 'pair-complete') {
    if (!session.anchorB) return EMPTY_MEASUREMENT_SESSION;
    const nextB = reconcileInspectedEntityWithArtifact(
      session.anchorB,
      artifact,
      boardState,
      layerVisibility
    );
    if (!nextB) {
      return EMPTY_MEASUREMENT_SESSION;
    }
    return {
      mode: 'pair-complete',
      anchorA: nextA,
      anchorB: nextB
    };
  }

  return {
    mode: session.mode,
    anchorA: nextA,
    anchorB: null
  };
}

function getContourSegmentsForPiece(
  piece: PatternPieceRenderModel,
  contour: CadContourKind
): readonly RenderCurveSegment[] {
  return contour === 'sew' ? piece.sewSegments : piece.cutSegments;
}

export function evaluateMeasurementSession(
  session: MeasurementSession,
  artifact: PatternArtifactBundle | null,
  boardState: PatternBoardSnapshot,
  arcLengthOptions?: CubicArcLengthOptions
): MeasurementEvaluation {
  if (!artifact || session.mode === 'idle' || !session.anchorA) {
    return { kind: 'empty' };
  }

  if (session.mode === 'awaiting-second-anchor') {
    let previewVertexAngle: VertexAngleMeasurementResult | null = null;
    if (session.anchorA.entityKind === 'vertex') {
      const piece = artifact.pieces.find(p => p.pieceId === session.anchorA!.pieceId);
      if (piece && isPieceEffectivelyVisible(boardState, piece.pieceId)) {
        const segments = getContourSegmentsForPiece(piece, session.anchorA.contour);
        previewVertexAngle = measureVertexAngle(
          session.anchorA,
          segments,
          artifact.coordinateFrame,
          artifact.authorityTier
        );
      }
    }
    return {
      kind: 'awaiting-second-anchor',
      anchorA: session.anchorA,
      previewVertexAngle
    };
  }

  if (session.mode === 'pair-complete' && session.anchorB) {
    const result = measurePointToPointDistance(
      session.anchorA,
      session.anchorB,
      artifact.coordinateFrame,
      artifact.authorityTier
    );
    return {
      kind: 'pair-distance',
      anchorA: session.anchorA,
      anchorB: session.anchorB,
      result
    };
  }

  // Single-entity completed measurements
  const entity = session.anchorA;
  const piece = artifact.pieces.find(p => p.pieceId === entity.pieceId);
  const placement = boardState.placementsByPieceId[entity.pieceId];
  if (!piece || !placement || !isPieceEffectivelyVisible(boardState, piece.pieceId)) {
    return { kind: 'empty' };
  }
  const offset: RenderPoint2D = {
    x: placement.offsetXCm,
    y: placement.offsetYCm
  };

  if (entity.entityKind === 'edge') {
    const segments = getContourSegmentsForPiece(piece, entity.contour);
    const seg = segments.find(s => s.id === entity.segmentId);
    if (!seg) return { kind: 'empty' };
    return {
      kind: 'straight-edge',
      entity,
      result: measureStraightEdge(
        seg,
        piece.pieceId,
        piece.pieceCode,
        entity.contour,
        artifact.coordinateFrame,
        artifact.authorityTier,
        offset
      )
    };
  }

  if (entity.entityKind === 'vertex') {
    const segments = getContourSegmentsForPiece(piece, entity.contour);
    return {
      kind: 'vertex-angle',
      entity,
      result: measureVertexAngle(
        entity,
        segments,
        artifact.coordinateFrame,
        artifact.authorityTier
      )
    };
  }

  if (entity.entityKind === 'curve') {
    const segments = getContourSegmentsForPiece(piece, entity.contour);
    const seg = segments.find(s => s.id === entity.segmentId);
    if (!seg) return { kind: 'empty' };
    const differential = measureCubicBezierAtT(
      seg,
      entity.parameterT,
      piece.pieceId,
      piece.pieceCode,
      entity.contour,
      artifact.coordinateFrame,
      artifact.authorityTier,
      offset
    );
    const fullArcLength = approximateCubicBezierArcLength(
      seg,
      artifact.coordinateFrame,
      artifact.authorityTier,
      piece.pieceId,
      entity.contour,
      [0, 1],
      arcLengthOptions
    );
    const partialArcLength = approximateCubicBezierArcLength(
      seg,
      artifact.coordinateFrame,
      artifact.authorityTier,
      piece.pieceId,
      entity.contour,
      [0, entity.parameterT],
      arcLengthOptions
    );
    return {
      kind: 'cubic-bezier',
      entity,
      result: {
        differential,
        fullArcLength,
        partialArcLength
      }
    };
  }

  return { kind: 'empty' };
}
