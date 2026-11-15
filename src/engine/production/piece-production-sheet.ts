/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner Milestone 05.2.1-R1 — Authoritative Pattern Piece Production Sheet Engine
 *
 * Derives deterministic, immutable pattern-piece production sheets strictly from
 * accepted Milestone 05.1 `AuthoritativePatternRevision` and `AuthoritativeGradingArtifact`
 * structures without reconstructing or mutating CAD geometry.
 *
 * Mathematical & Numerical Verification Policy:
 * - Line segment lengths: exact Euclidean distance in cm (`minLength = 0.01 cm`).
 * - Cubic Bézier arc lengths: recursive De Casteljau subdivision with chord lower bound,
 *   control-polygon upper bound, `perimeterToleranceCm = 0.002 cm`, `maxDepth = 14`.
 *   Non-convergence (`!toleranceAchieved || maxDepthReached || errorBoundCm > tol`) fails closed.
 * - Line-only contour areas: exact centered Shoelace formula in cm².
 * - Contours with cubic Bézier curves: exact analytic Green's-theorem integration
 *   over the degree-5 Bernstein cross-product polynomial
 *     A = 1/2 ∮ (x y' - y x') dt
 *   centered at the contour anchor to prevent shift cancellation, closing sub-tolerance
 *   endpoint gaps <= 0.05 cm linearly, with explicit per-contour IEEE-754 + gap-closure
 *   upper error bounds (never rounded down to zero when non-zero).
 * - Contour topology & offset soundness: adaptive flatness subdivision (`flatness = 0.01 cm`,
 *   `maxDepth = 12`, fail closed on non-convergence) for strict non-self-intersection,
 *   exact cubic extrema bounding-box verification, contour length verification, winding
 *   consistency, outward normal offset verification per segment, and stitching containment.
 *
 * Safety Invariant: `isProductionReady` is strictly and literally `false`.
 */

import { Point, SeamLine } from '../../types';
import { computeAdaptiveBezierLength } from '../geometry/math';
import { isStrictValidIsoTimestamp } from './crypto';
import {
  AllowanceValidationStatus,
  AuthoritativePieceProductionSheetSet,
  BezierNumericalPrecisionMetadata,
  ContourReferenceSummary,
  ContourSegmentEdgeRole,
  FoldUnfoldingOperation,
  MANUFACTURING_PIECE_SHEET_SCHEMA_VERSION,
  MirroringRule,
  OrderQuantityBasis,
  PatternPieceCutSemantics,
  PatternPieceGeometryMetrics,
  PatternPieceProductionSheet,
  PieceAllowanceSchedule,
  PieceCutSemanticsDeclaration,
  PieceProductionSheetRejectionCode,
  PieceProductionSheetValidationResult,
  SegmentAllowanceEntry
} from './manufacturing-types';
import {
  canonicalizeJson,
  computeCanonicalFingerprint,
  computePieceGeometryFingerprint,
  verifyGradingArtifactIntegrity,
  verifyPatternRevisionLifecycleIntegrity
} from './pattern-revision-snapshot';
import {
  AuthoritativeGradingArtifact,
  AuthoritativePatternRevision,
  ContourBoundingBoxSnapshot,
  GeometricContourSnapshot,
  GeometricSegmentSnapshot,
  PatternPieceSnapshot
} from './production-types';

export const BEZIER_PERIMETER_TOLERANCE_CM = 0.002;
export const BEZIER_PERIMETER_MAX_DEPTH = 14;
export const BEZIER_AREA_FLATNESS_TOLERANCE_CM = 0.01;
export const BEZIER_AREA_MAX_SUBDIVISION_DEPTH = 12;
export const MIN_SEGMENT_LENGTH_CM = 0.01;
export const MIN_FOLD_EDGE_LENGTH_CM = 1.0;
export const CONTOUR_CLOSURE_TOLERANCE_CM = 0.05;
export const LENGTH_CONSISTENCY_TOLERANCE_CM = 0.05;
export const BOUNDING_BOX_CONSISTENCY_TOLERANCE_CM = 0.08;
export const ALLOWANCE_MATCH_TOLERANCE_CM = 0.001;
export const OFFSET_NORMAL_TOLERANCE_CM = 0.15;
export const MAX_VALID_COORDINATE_MAGNITUDE_CM = 1e11;

const TRANSITION_SEGMENT_ROLES = new Set<string>(['miter', 'bevel', 'bridge', 'fold-extension']);
const SUBDIVIDED_LR_SUFFIX_RE = /^([LR](?:-[LR])*)$/;

export interface ResolveCutSemanticsOptions {
  readonly declaration?: PieceCutSemanticsDeclaration;
  readonly garmentUnitQuantity?: number;
}

export interface BuildAllowanceScheduleOptions {
  readonly uiReportedAllowanceCmByRole?: Readonly<Record<string, number>>;
}

export interface BuildSinglePieceProductionSheetParams {
  readonly patternRevision: AuthoritativePatternRevision;
  readonly piece: PatternPieceSnapshot;
  readonly gradingMode: 'graded-multi-size' | 'single-size-ungraded';
  readonly gradingArtifact?: AuthoritativeGradingArtifact;
  readonly cutSemanticsDeclaration?: PieceCutSemanticsDeclaration;
  readonly garmentUnitQuantity?: number;
  readonly uiReportedAllowanceCmByRole?: Readonly<Record<string, number>>;
  readonly expectedProjectId?: string;
  readonly expectedTenantId?: string;
  readonly expectedGarmentId?: string;
  readonly generatedAt?: string;
  readonly sheetId?: string;
}

export interface BuildPieceProductionSheetSetParams {
  readonly patternRevision: AuthoritativePatternRevision;
  readonly gradingMode: 'graded-multi-size' | 'single-size-ungraded';
  readonly gradingArtifact?: AuthoritativeGradingArtifact;
  readonly nonGradingReason?: string;
  readonly expectedSizes?: readonly string[];
  readonly cutSemanticsByPieceCode: Readonly<Record<string, PieceCutSemanticsDeclaration>>;
  readonly garmentUnitQuantity?: number;
  readonly garmentUnitQuantitiesBySize?: Readonly<Record<string, number>>;
  readonly uiReportedAllowanceCmByRole?: Readonly<Record<string, number>>;
  readonly expectedProjectId?: string;
  readonly expectedTenantId?: string;
  readonly expectedGarmentId?: string;
  readonly generatedAt?: string;
  readonly sheetSetId?: string;
}

export interface PieceProductionSheetVerificationSourceContext {
  readonly patternRevision?: AuthoritativePatternRevision;
  readonly gradingArtifact?: AuthoritativeGradingArtifact;
  readonly expectedProjectId?: string;
  readonly expectedTenantId?: string;
  readonly expectedGarmentId?: string;
  readonly expectedSizes?: readonly string[];
  readonly cutSemanticsDeclaration?: PieceCutSemanticsDeclaration;
  readonly cutSemanticsByPieceCode?: Readonly<Record<string, PieceCutSemanticsDeclaration>>;
  readonly expectedOrderQuantityBasis?: OrderQuantityBasis;
  readonly expectedGarmentUnitQuantity?: number;
  readonly expectedGarmentUnitQuantitiesBySize?: Readonly<Record<string, number>>;
}

export interface PieceProductionSheetVerificationResult {
  readonly isValid: boolean;
  readonly isFingerprintValid: boolean;
  readonly isSourceGeometryMatch: boolean;
  readonly rejectionCodes: readonly PieceProductionSheetRejectionCode[];
  readonly recomputedSheetContentFingerprint?: string;
  readonly recomputedPieceGeometryFingerprint?: string;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface PieceProductionSheetSetVerificationResult {
  readonly isValid: boolean;
  readonly isSetFingerprintValid: boolean;
  readonly isSizeCoverageComplete: boolean;
  readonly rejectionCodes: readonly PieceProductionSheetRejectionCode[];
  readonly recomputedSheetSetContentFingerprint?: string;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export const MAX_OFFSET_VERIFY_DEPTH = 11;

function round4(n: number): number {
  return Number(n.toFixed(4));
}

/**
 * Preserves positive error bounds without downward truncation or rounding down.
 * Scales positive values slightly upward by 8 binary64 ulps so downstream consumer
 * sums/checks remain strictly conservative.
 */
function preservePositiveErrorBound(val: number): number {
  if (!Number.isFinite(val) || val < 0) {
    return NaN;
  }
  if (val === 0) {
    return 0;
  }
  return val * (1 + 8 * Number.EPSILON);
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function isFinitePoint(pt: unknown): pt is Point {
  if (!pt || typeof pt !== 'object') return false;
  const p = pt as Point;
  return (
    typeof p.x === 'number' &&
    typeof p.y === 'number' &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Math.abs(p.x) <= MAX_VALID_COORDINATE_MAGNITUDE_CM &&
    Math.abs(p.y) <= MAX_VALID_COORDINATE_MAGNITUDE_CM
  );
}

function isValidGrainline(piece: PatternPieceSnapshot): boolean {
  if (!piece.grainline || !isFinitePoint(piece.grainline.start) || !isFinitePoint(piece.grainline.end)) {
    return false;
  }
  if (
    piece.grainline.direction !== 'vertical' &&
    piece.grainline.direction !== 'horizontal' &&
    piece.grainline.direction !== 'bias'
  ) {
    return false;
  }
  return pointDistance(piece.grainline.start, piece.grainline.end) > 0.01;
}

function classifyFoldAxisOrientation(
  start: Point,
  end: Point
): 'vertical-center-line' | 'horizontal-center-line' | 'custom-axis' {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  if (dx <= 0.01 && dy > 0.01) {
    return 'vertical-center-line';
  }
  if (dy <= 0.01 && dx > 0.01) {
    return 'horizontal-center-line';
  }
  return 'custom-axis';
}

function findFoldSegments(contour: GeometricContourSnapshot | undefined): readonly GeometricSegmentSnapshot[] {
  if (!contour || !Array.isArray(contour.segments)) return [];
  return contour.segments.filter(s => Boolean(s && s.isFold));
}

interface MatchingSeamsResult {
  readonly matchedSeam?: SeamLine;
  readonly conflictingSeamIds: readonly string[];
  readonly issue?: string;
}

function findMatchingSeamStrict(
  seg: GeometricSegmentSnapshot,
  seams: readonly SeamLine[],
  duplicateSeamIds: ReadonlySet<string>
): MatchingSeamsResult {
  const ownerMatches: SeamLine[] = [];
  for (const seam of seams) {
    if (!seam || typeof seam !== 'object') continue;
    const ownsSegId = seam.segmentId === seg.id || (Array.isArray(seam.segmentIds) && seam.segmentIds.includes(seg.id));
    if (ownsSegId) {
      ownerMatches.push(seam);
    }
  }

  let matches = ownerMatches;
  if (matches.length === 0 && seg.seamId) {
    const idMatches = seams.filter(s => s && typeof s === 'object' && s.id === seg.seamId);
    matches = idMatches;
  }

  if (matches.length === 0) {
    return { conflictingSeamIds: [] };
  }

  if (matches.length > 1) {
    return {
      matchedSeam: matches[0],
      conflictingSeamIds: matches.map(m => m.id),
      issue: `Segment '${seg.id}' matches ${matches.length} conflicting SeamLine records (${matches.map(m => m.id).join(', ')}).`
    };
  }

  const single = matches[0];
  if (duplicateSeamIds.has(single.id)) {
    return {
      matchedSeam: single,
      conflictingSeamIds: [single.id],
      issue: `SeamLine id '${single.id}' linked by segment '${seg.id}' is duplicated in piece.seams.`
    };
  }

  return {
    matchedSeam: single,
    conflictingSeamIds: []
  };
}

function inferEdgeRole(seg: GeometricSegmentSnapshot, matchedSeam?: SeamLine): ContourSegmentEdgeRole {
  if (seg.isFold) return 'fold-edge';
  if (seg.role === 'miter' || seg.role === 'bevel' || seg.role === 'bridge') {
    return 'corner-transition';
  }
  const text = `${seg.seamId ?? ''} ${seg.id} ${matchedSeam?.id ?? ''} ${matchedSeam?.name ?? ''}`.toLowerCase();
  if (text.includes('fold')) return 'fold-edge';
  if (text.includes('hem')) return 'hem';
  if (text.includes('waist')) return 'waistline';
  if (text.includes('neck')) return 'neckline';
  if (text.includes('armhole') || text.includes('scye') || text.includes('cap')) return 'armhole-scye';
  if (text.includes('shoulder')) return 'shoulder';
  if (text.includes('center-back') || text.includes('cb-seam') || text.includes('center-front')) return 'center-seam';
  if (matchedSeam || seg.seamId) return 'structural-seam';
  return 'unspecified';
}

function isTransitionRole(role: string | undefined): boolean {
  return role !== undefined && TRANSITION_SEGMENT_ROLES.has(role);
}

interface MatchedCuttingCoverage {
  readonly matchedSegments: readonly GeometricSegmentSnapshot[];
  readonly lrPaths: readonly string[];
  readonly isSubdividedBezierTree: boolean;
  readonly isTreeComplete: boolean;
  readonly completenessIssue?: string;
}

/**
 * Resolves cutting-contour lineage for a single stitching segment strictly by `sourceSegmentId`.
 * Rejects textual prefix collisions (e.g., `segment-1` vs `segment-1-alt-L` or `segment-10`)
 * and verifies dyadic tree completeness whenever a cubic Bézier is subdivided via `-L`/`-R`.
 */
function findMatchingCuttingSegmentsStrict(
  stitchSeg: GeometricSegmentSnapshot,
  cuttingContour: GeometricContourSnapshot | undefined,
  allStitchIds: ReadonlySet<string>
): MatchedCuttingCoverage {
  if (!cuttingContour || !Array.isArray(cuttingContour.segments)) {
    return {
      matchedSegments: [],
      lrPaths: [],
      isSubdividedBezierTree: false,
      isTreeComplete: false
    };
  }

  const matched: GeometricSegmentSnapshot[] = [];
  const lrPaths: string[] = [];

  for (const cutSeg of cuttingContour.segments) {
    if (!cutSeg || typeof cutSeg !== 'object') continue;
    if (isTransitionRole(cutSeg.role)) continue;
    const src = cutSeg.sourceSegmentId;
    if (!src || typeof src !== 'string') continue;

    if (src === stitchSeg.id) {
      matched.push(cutSeg);
      continue;
    }

    // Subdivided Bézier offset leaf convention from `CubicBezierCurve.subdivide(0.5)`:
    // `<stitchSeg.id>-<LR>` where `<LR>` matches `^([LR](?:-[LR])*)$`,
    // ONLY when `src` is not itself an exact stitching segment ID in the same contour.
    if (
      stitchSeg.type === 'bezier' &&
      !allStitchIds.has(src) &&
      src.startsWith(`${stitchSeg.id}-`)
    ) {
      const suffix = src.slice(stitchSeg.id.length + 1);
      if (SUBDIVIDED_LR_SUFFIX_RE.test(suffix)) {
        matched.push(cutSeg);
        lrPaths.push(suffix);
      }
    }
  }

  if (matched.length === 0) {
    return {
      matchedSegments: [],
      lrPaths: [],
      isSubdividedBezierTree: false,
      isTreeComplete: false
    };
  }

  const hasExactDirect = matched.some(c => c.sourceSegmentId === stitchSeg.id);
  if (lrPaths.length > 0 && hasExactDirect) {
    return {
      matchedSegments: matched,
      lrPaths,
      isSubdividedBezierTree: true,
      isTreeComplete: false,
      completenessIssue: `Stitching segment '${stitchSeg.id}' mixes direct and subdivided (-L/-R) cutting segment references.`
    };
  }

  if (lrPaths.length > 0) {
    // Normalize each path into compact 'LR...' strings and verify prefix-free exact partition of [0,1]
    const tokens = lrPaths.map(p => p.replace(/-/g, ''));
    const sorted = [...tokens].sort();
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1].startsWith(sorted[i])) {
        return {
          matchedSegments: matched,
          lrPaths,
          isSubdividedBezierTree: true,
          isTreeComplete: false,
          completenessIssue: `Subdivided Bézier cutting segments for '${stitchSeg.id}' contain duplicate or overlapping paths ('${sorted[i]}' vs '${sorted[i + 1]}').`
        };
      }
    }
    const maxLen = tokens.reduce((m, t) => Math.max(m, t.length), 0);
    if (maxLen > 20) {
      return {
        matchedSegments: matched,
        lrPaths,
        isSubdividedBezierTree: true,
        isTreeComplete: false,
        completenessIssue: `Subdivided Bézier lineage depth (${maxLen}) exceeds safe limit.`
      };
    }
    const targetSum = 1 << maxLen;
    let sum = 0;
    for (const tok of tokens) {
      sum += 1 << (maxLen - tok.length);
    }
    if (sum !== targetSum) {
      return {
        matchedSegments: matched,
        lrPaths,
        isSubdividedBezierTree: true,
        isTreeComplete: false,
        completenessIssue: `Incomplete Bézier offset subdivision for '${stitchSeg.id}': matched dyadic coverage ${(sum / targetSum).toFixed(6)} !== 1.0 (missing sibling subdivision leaves).`
      };
    }

    return {
      matchedSegments: matched,
      lrPaths,
      isSubdividedBezierTree: true,
      isTreeComplete: true
    };
  }

  if (matched.length > 1) {
    return {
      matchedSegments: matched,
      lrPaths: [],
      isSubdividedBezierTree: false,
      isTreeComplete: false,
      completenessIssue: `Non-subdivided stitching segment '${stitchSeg.id}' matched ${matched.length} duplicate cutting segments.`
    };
  }

  return {
    matchedSegments: matched,
    lrPaths: [],
    isSubdividedBezierTree: false,
    isTreeComplete: true
  };
}

interface AdaptiveBezierLengthWithDepthResult {
  readonly lengthCm: number;
  readonly errorBoundCm: number;
  readonly toleranceAchieved: boolean;
  readonly maxDepthReached: boolean;
  readonly actualMaxDepth: number;
}

function measureCubicBezierPerimeterWithDepth(
  p0: Point,
  cp1: Point,
  cp2: Point,
  p3: Point,
  toleranceCm: number,
  maxDepth: number
): AdaptiveBezierLengthWithDepthResult {
  const base = computeAdaptiveBezierLength(p0, cp1, cp2, p3, toleranceCm, maxDepth);

  let actualMaxDepth = 0;
  function traceDepth(
    q0: Point,
    q1: Point,
    q2: Point,
    q3: Point,
    depth: number,
    localTol: number
  ): void {
    if (depth > actualMaxDepth) actualMaxDepth = depth;
    const chord = pointDistance(q0, q3);
    const poly = pointDistance(q0, q1) + pointDistance(q1, q2) + pointDistance(q2, q3);
    if (poly - chord <= localTol || depth >= maxDepth) {
      return;
    }
    const q01 = { x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 };
    const q12 = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };
    const q23 = { x: (q2.x + q3.x) / 2, y: (q2.y + q3.y) / 2 };
    const q012 = { x: (q01.x + q12.x) / 2, y: (q01.y + q12.y) / 2 };
    const q123 = { x: (q12.x + q23.x) / 2, y: (q12.y + q23.y) / 2 };
    const mid = { x: (q012.x + q123.x) / 2, y: (q012.y + q123.y) / 2 };
    traceDepth(q0, q01, q012, mid, depth + 1, localTol / 2);
    traceDepth(mid, q123, q23, q3, depth + 1, localTol / 2);
  }
  traceDepth(p0, cp1, cp2, p3, 0, toleranceCm);

  return {
    lengthCm: base.lengthCm,
    errorBoundCm: base.errorBoundCm,
    toleranceAchieved:
      base.toleranceAchieved &&
      !base.maxDepthReached &&
      base.errorBoundCm <= toleranceCm,
    maxDepthReached: base.maxDepthReached,
    actualMaxDepth
  };
}

interface FlattenedBezierResult {
  readonly points: Point[];
  readonly maxDepthReached: boolean;
  readonly actualMaxDepth: number;
  readonly worstResidualDeviationCm: number;
  readonly toleranceAchieved: boolean;
}

function flattenCubicBezierWithDiagnostics(
  p0: Point,
  cp1: Point,
  cp2: Point,
  p3: Point,
  flatnessToleranceCm: number,
  maxDepth: number
): FlattenedBezierResult {
  const span = Math.max(
    pointDistance(p0, p3),
    pointDistance(p0, cp1),
    pointDistance(cp1, cp2),
    pointDistance(cp2, p3)
  );
  // Ensure micro-scale curves still subdivide proportionally to span for topology checks
  const effectiveTol = Math.min(flatnessToleranceCm, Math.max(1e-6, span * 0.005));

  let maxDepthReached = false;
  let actualMaxDepth = 0;
  let worstResidualDeviationCm = 0;

  function recurse(q0: Point, q1: Point, q2: Point, q3: Point, depth: number): Point[] {
    if (depth > actualMaxDepth) actualMaxDepth = depth;
    const dx = q3.x - q0.x;
    const dy = q3.y - q0.y;
    const lenSq = dx * dx + dy * dy;

    const distToChord = (p: Point): number => {
      if (lenSq < 1e-18) {
        return Math.hypot(p.x - q0.x, p.y - q0.y);
      }
      const t = Math.max(0, Math.min(1, ((p.x - q0.x) * dx + (p.y - q0.y) * dy) / lenSq));
      return Math.hypot(p.x - (q0.x + t * dx), p.y - (q0.y + t * dy));
    };

    const maxDev = Math.max(distToChord(q1), distToChord(q2));
    if (maxDev <= effectiveTol) {
      return [q0, q3];
    }
    if (depth >= maxDepth) {
      if (maxDev > flatnessToleranceCm) {
        maxDepthReached = true;
      }
      if (maxDev > worstResidualDeviationCm) {
        worstResidualDeviationCm = maxDev;
      }
      return [q0, q3];
    }

    const q01 = { x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 };
    const q12 = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };
    const q23 = { x: (q2.x + q3.x) / 2, y: (q2.y + q3.y) / 2 };
    const q012 = { x: (q01.x + q12.x) / 2, y: (q01.y + q12.y) / 2 };
    const q123 = { x: (q12.x + q23.x) / 2, y: (q12.y + q23.y) / 2 };
    const mid = { x: (q012.x + q123.x) / 2, y: (q012.y + q123.y) / 2 };

    const left = recurse(q0, q01, q012, mid, depth + 1);
    const right = recurse(mid, q123, q23, q3, depth + 1);
    return [...left, ...right.slice(1)];
  }

  const points = recurse(p0, cp1, cp2, p3, 0);
  const toleranceAchieved = worstResidualDeviationCm <= flatnessToleranceCm && !maxDepthReached;

  return {
    points,
    maxDepthReached,
    actualMaxDepth,
    worstResidualDeviationCm,
    toleranceAchieved
  };
}

function evalCubicBezierPointAndTangent(
  p0: Point,
  cp1: Point,
  cp2: Point,
  p3: Point,
  t: number
): { point: Point; tangent: Point } {
  const mt = 1 - t;
  const x =
    mt * mt * mt * p0.x +
    3 * mt * mt * t * cp1.x +
    3 * mt * t * t * cp2.x +
    t * t * t * p3.x;
  const y =
    mt * mt * mt * p0.y +
    3 * mt * mt * t * cp1.y +
    3 * mt * t * t * cp2.y +
    t * t * t * p3.y;
  const dx =
    3 * mt * mt * (cp1.x - p0.x) +
    6 * mt * t * (cp2.x - cp1.x) +
    3 * t * t * (p3.x - cp2.x);
  const dy =
    3 * mt * mt * (cp1.y - p0.y) +
    6 * mt * t * (cp2.y - cp1.y) +
    3 * t * t * (p3.y - cp2.y);
  const len = Math.hypot(dx, dy);
  return {
    point: { x, y },
    tangent: len > 1e-12 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 }
  };
}

function evalSegmentPointAndTangent(
  seg: GeometricSegmentSnapshot,
  t: number
): { point: Point; tangent: Point } {
  if (seg.type === 'line' || !seg.controlPoints) {
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    const len = Math.hypot(dx, dy);
    return {
      point: { x: seg.start.x + dx * t, y: seg.start.y + dy * t },
      tangent: len > 1e-12 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 }
    };
  }
  return evalCubicBezierPointAndTangent(seg.start, seg.controlPoints[0], seg.controlPoints[1], seg.end, t);
}

interface CubicBezierControlPoints {
  readonly p0: Point;
  readonly cp1: Point;
  readonly cp2: Point;
  readonly p3: Point;
}

function evalCubicBezierWithDeriv(
  p0: Point,
  cp1: Point,
  cp2: Point,
  p3: Point,
  t: number
): { point: Point; tangent: Point; derivLen: number } {
  const mt = 1 - t;
  const x =
    mt * mt * mt * p0.x +
    3 * mt * mt * t * cp1.x +
    3 * mt * t * t * cp2.x +
    t * t * t * p3.x;
  const y =
    mt * mt * mt * p0.y +
    3 * mt * mt * t * cp1.y +
    3 * mt * t * t * cp2.y +
    t * t * t * p3.y;
  const dx =
    3 * mt * mt * (cp1.x - p0.x) +
    6 * mt * t * (cp2.x - cp1.x) +
    3 * t * t * (p3.x - cp2.x);
  const dy =
    3 * mt * mt * (cp1.y - p0.y) +
    6 * mt * t * (cp2.y - cp1.y) +
    3 * t * t * (p3.y - cp2.y);
  const derivLen = Math.hypot(dx, dy);
  return {
    point: { x, y },
    tangent: derivLen > 1e-12 ? { x: dx / derivLen, y: dy / derivLen } : { x: 0, y: 0 },
    derivLen
  };
}

function splitCubicBezierHalf(
  c: CubicBezierControlPoints
): { readonly left: CubicBezierControlPoints; readonly right: CubicBezierControlPoints } {
  const p01 = { x: (c.p0.x + c.cp1.x) / 2, y: (c.p0.y + c.cp1.y) / 2 };
  const p12 = { x: (c.cp1.x + c.cp2.x) / 2, y: (c.cp1.y + c.cp2.y) / 2 };
  const p23 = { x: (c.cp2.x + c.p3.x) / 2, y: (c.cp2.y + c.p3.y) / 2 };
  const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
  const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 };
  const mid = { x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2 };
  return {
    left: { p0: c.p0, cp1: p01, cp2: p012, p3: mid },
    right: { p0: mid, cp1: p123, cp2: p23, p3: c.p3 }
  };
}

function subdivideStitchingBezierByPath(
  stSeg: GeometricSegmentSnapshot,
  lrPath: string
): CubicBezierControlPoints {
  const cp1 = stSeg.controlPoints![0];
  const cp2 = stSeg.controlPoints![1];
  let cur: CubicBezierControlPoints = {
    p0: stSeg.start,
    cp1,
    cp2,
    p3: stSeg.end
  };
  const steps = lrPath ? lrPath.split('-').filter(Boolean) : [];
  for (const dir of steps) {
    const { left, right } = splitCubicBezierHalf(cur);
    if (dir === 'L') {
      cur = left;
    } else if (dir === 'R') {
      cur = right;
    }
  }
  return cur;
}

function findClosestOnCubicBezierContinuous(
  queryPt: Point,
  c: CubicBezierControlPoints
): { u: number; point: Point; tangent: Point; derivLen: number; dist: number } {
  const coarseSamples = 24;
  const dist2At = (u: number): number => {
    const pt = evalCubicBezierWithDeriv(c.p0, c.cp1, c.cp2, c.p3, u).point;
    const dx = pt.x - queryPt.x;
    const dy = pt.y - queryPt.y;
    return dx * dx + dy * dy;
  };

  const gridVals: number[] = [];
  for (let i = 0; i <= coarseSamples; i++) {
    gridVals.push(dist2At(i / coarseSamples));
  }

  // Gather candidate local-minimum basins (up to best 3) to avoid getting trapped on S-curves
  const candidates: { idx: number; val: number }[] = [];
  for (let i = 0; i <= coarseSamples; i++) {
    const leftVal = i > 0 ? gridVals[i - 1] : Infinity;
    const rightVal = i < coarseSamples ? gridVals[i + 1] : Infinity;
    if (gridVals[i] <= leftVal && gridVals[i] <= rightVal) {
      candidates.push({ idx: i, val: gridVals[i] });
    }
  }
  if (candidates.length === 0) {
    let bestIdx = 0;
    for (let i = 1; i <= coarseSamples; i++) {
      if (gridVals[i] < gridVals[bestIdx]) bestIdx = i;
    }
    candidates.push({ idx: bestIdx, val: gridVals[bestIdx] });
  }
  candidates.sort((a, b) => a.val - b.val);
  const topCandidates = candidates.slice(0, 3);

  const phi = (Math.sqrt(5) - 1) / 2;
  let globalBestU = topCandidates[0].idx / coarseSamples;
  let globalBestD2 = topCandidates[0].val;

  for (const cand of topCandidates) {
    let lo = Math.max(0, (cand.idx - 1) / coarseSamples);
    let hi = Math.min(1, (cand.idx + 1) / coarseSamples);
    let x1 = hi - phi * (hi - lo);
    let x2 = lo + phi * (hi - lo);
    let f1 = dist2At(x1);
    let f2 = dist2At(x2);

    for (let iter = 0; iter < 20; iter++) {
      if (f1 < f2) {
        hi = x2;
        x2 = x1;
        f2 = f1;
        x1 = hi - phi * (hi - lo);
        f1 = dist2At(x1);
      } else {
        lo = x1;
        x1 = x2;
        f1 = f2;
        x2 = lo + phi * (hi - lo);
        f2 = dist2At(x2);
      }
    }
    const uMid = (lo + hi) / 2;
    const candidatesU = [lo, uMid, hi];
    for (const u of candidatesU) {
      const d2 = dist2At(u);
      if (d2 < globalBestD2) {
        globalBestD2 = d2;
        globalBestU = u;
      }
    }
  }

  const evalRes = evalCubicBezierWithDeriv(c.p0, c.cp1, c.cp2, c.p3, globalBestU);
  return {
    u: globalBestU,
    point: evalRes.point,
    tangent: evalRes.tangent,
    derivLen: evalRes.derivLen,
    dist: Math.sqrt(globalBestD2)
  };
}

function cubicBezierControlPolygonSpan(c: CubicBezierControlPoints): number {
  return (
    pointDistance(c.p0, c.cp1) +
    pointDistance(c.cp1, c.cp2) +
    pointDistance(c.cp2, c.p3)
  );
}

/**
 * Verifies that a mapped cutting segment maintains the expected outward normal offset
 * continuously over the entire parameter domain [0, 1], with no endpoint dips, interior
 * wrong-side crossings, reversals, or cusp singularities.
 */
function verifyContinuousOffsetForMappedSegment(
  stSeg: GeometricSegmentSnapshot,
  cutSeg: GeometricSegmentSnapshot,
  lrPath: string,
  outwardSign: 1 | -1,
  errors: string[]
): void {
  const allowance = stSeg.seamAllowanceCm ?? 0;
  if (!(allowance > ALLOWANCE_MATCH_TOLERANCE_CM)) return;

  const allowedErr = Math.max(OFFSET_NORMAL_TOLERANCE_CM, allowance * 0.25);
  const stIsBezier =
    stSeg.type === 'bezier' &&
    Array.isArray(stSeg.controlPoints) &&
    stSeg.controlPoints.length === 2;
  const cutIsBezier =
    cutSeg.type === 'bezier' &&
    Array.isArray(cutSeg.controlPoints) &&
    cutSeg.controlPoints.length === 2;

  // Fast exact closed-form verification for straight-line -> straight-line mappings.
  // Since affine functions achieve their extrema on [0, 1] at endpoints t=0 and t=1,
  // checking both endpoints proves continuity across the entire interval [0, 1].
  if (!stIsBezier && !cutIsBezier) {
    const stDx = stSeg.end.x - stSeg.start.x;
    const stDy = stSeg.end.y - stSeg.start.y;
    const stLen = Math.hypot(stDx, stDy);
    const cutDx = cutSeg.end.x - cutSeg.start.x;
    const cutDy = cutSeg.end.y - cutSeg.start.y;
    const cutLen = Math.hypot(cutDx, cutDy);

    if (stLen < MIN_SEGMENT_LENGTH_CM || cutLen < MIN_SEGMENT_LENGTH_CM) {
      errors.push(
        `Mapped segment pair ('${stSeg.id}' -> '${cutSeg.id}') has degenerate length below ${MIN_SEGMENT_LENGTH_CM} cm.`
      );
      return;
    }

    const tx = stDx / stLen;
    const ty = stDy / stLen;
    const ctx = cutDx / cutLen;
    const cty = cutDy / cutLen;
    const tanDot = tx * ctx + ty * cty;
    if (tanDot < 0.5) {
      errors.push(
        `Cutting segment '${cutSeg.id}' diverges/reverses direction relative to stitching segment '${stSeg.id}' (dot=${tanDot.toFixed(3)}).`
      );
      return;
    }

    const nx = -ty * outwardSign;
    const ny = tx * outwardSign;
    const d0 = (cutSeg.start.x - stSeg.start.x) * nx + (cutSeg.start.y - stSeg.start.y) * ny;
    const d1 = (cutSeg.end.x - stSeg.start.x) * nx + (cutSeg.end.y - stSeg.start.y) * ny;
    const s0 = (cutSeg.start.x - stSeg.start.x) * tx + (cutSeg.start.y - stSeg.start.y) * ty;
    const s1 = (cutSeg.end.x - stSeg.start.x) * tx + (cutSeg.end.y - stSeg.start.y) * ty;

    if (s1 <= s0 + MIN_SEGMENT_LENGTH_CM * 0.5) {
      errors.push(
        `Cutting segment '${cutSeg.id}' has non-positive tangential progression along '${stSeg.id}' (s0=${s0.toFixed(3)}, s1=${s1.toFixed(3)}).`
      );
      return;
    }

    const maxEndpointShift = Math.max(allowance * 6.0, 6.0);
    if (s0 > stLen * 0.5 || s1 < stLen * 0.5 || s0 < -maxEndpointShift || s1 > stLen + maxEndpointShift) {
      errors.push(
        `Cutting segment '${cutSeg.id}' tangential span [${s0.toFixed(3)}, ${s1.toFixed(3)}] cm does not cover stitching segment '${stSeg.id}' [0, ${stLen.toFixed(3)}] cm.`
      );
      return;
    }

    if (d0 <= 0 || d1 <= 0) {
      errors.push(
        `Cutting segment '${cutSeg.id}' crosses to inward/wrong side of stitching segment '${stSeg.id}' (d0=${d0.toFixed(3)} cm, d1=${d1.toFixed(3)} cm).`
      );
      return;
    }

    const err0 = Math.abs(d0 - allowance);
    const err1 = Math.abs(d1 - allowance);
    if (err0 > allowedErr || err1 > allowedErr) {
      errors.push(
        `Cutting segment '${cutSeg.id}' continuous normal offset vector diverges from allowance ${allowance.toFixed(3)} cm of '${stSeg.id}' (endpoints d0=${d0.toFixed(3)} cm, d1=${d1.toFixed(3)} cm, maxErr=${Math.max(err0, err1).toFixed(3)} cm > ${allowedErr.toFixed(3)} cm).`
      );
    }
    return;
  }

  // Adaptive continuous De Casteljau verification for any pair involving a Bézier segment
  const cutCtrl: CubicBezierControlPoints = cutIsBezier
    ? {
        p0: cutSeg.start,
        cp1: cutSeg.controlPoints![0],
        cp2: cutSeg.controlPoints![1],
        p3: cutSeg.end
      }
    : {
        p0: cutSeg.start,
        cp1: {
          x: cutSeg.start.x + (cutSeg.end.x - cutSeg.start.x) / 3,
          y: cutSeg.start.y + (cutSeg.end.y - cutSeg.start.y) / 3
        },
        cp2: {
          x: cutSeg.start.x + (2 * (cutSeg.end.x - cutSeg.start.x)) / 3,
          y: cutSeg.start.y + (2 * (cutSeg.end.y - cutSeg.start.y)) / 3
        },
        p3: cutSeg.end
      };

  const stSub: CubicBezierControlPoints = stIsBezier
    ? subdivideStitchingBezierByPath(stSeg, lrPath)
    : {
        p0: stSeg.start,
        cp1: {
          x: stSeg.start.x + (stSeg.end.x - stSeg.start.x) / 3,
          y: stSeg.start.y + (stSeg.end.y - stSeg.start.y) / 3
        },
        cp2: {
          x: stSeg.start.x + (2 * (stSeg.end.x - stSeg.start.x)) / 3,
          y: stSeg.start.y + (2 * (stSeg.end.y - stSeg.start.y)) / 3
        },
        p3: stSeg.end
      };

  if (cubicBezierControlPolygonSpan(cutCtrl) < MIN_SEGMENT_LENGTH_CM || cubicBezierControlPolygonSpan(stSub) < MIN_SEGMENT_LENGTH_CM) {
    errors.push(
      `Mapped segment pair ('${stSeg.id}' -> '${cutSeg.id}') has degenerate span below ${MIN_SEGMENT_LENGTH_CM} cm.`
    );
    return;
  }

  // Check stitching sub-curve derivative sanity at endpoints and midpoint
  for (const stT of [0, 0.5, 1]) {
    const stEv = evalCubicBezierWithDeriv(stSub.p0, stSub.cp1, stSub.cp2, stSub.p3, stT);
    if (stEv.derivLen < 1e-6) {
      errors.push(
        `Stitching segment '${stSeg.id}'${lrPath ? ` (${lrPath})` : ''} has degenerate derivative/cusp at t=${stT}.`
      );
      return;
    }
  }

  const MAX_CONTINUOUS_OFFSET_DEPTH = 12;
  const MAX_CONTINUOUS_OFFSET_NODES = 2048;
  let visitedNodes = 0;
  let failureMessage: string | null = null;

  const evalSample = (c: CubicBezierControlPoints, t: number) => {
    const cutEv = evalCubicBezierWithDeriv(c.p0, c.cp1, c.cp2, c.p3, t);
    if (cutEv.derivLen < 1e-6) {
      return { degenerate: true as const };
    }
    const closest = findClosestOnCubicBezierContinuous(cutEv.point, stSub);
    if (closest.derivLen < 1e-6) {
      return { degenerate: true as const };
    }
    const nx = -closest.tangent.y * outwardSign;
    const ny = closest.tangent.x * outwardSign;
    const sn = (cutEv.point.x - closest.point.x) * nx + (cutEv.point.y - closest.point.y) * ny;
    const tanDot = cutEv.tangent.x * closest.tangent.x + cutEv.tangent.y * closest.tangent.y;
    return {
      degenerate: false as const,
      point: cutEv.point,
      tangent: cutEv.tangent,
      u: closest.u,
      dist: closest.dist,
      sn,
      tanDot
    };
  };

  const verifyLeaf = (c: CubicBezierControlPoints, depth: number, uStartBound: number, uEndBound: number): boolean => {
    if (failureMessage) return false;
    visitedNodes++;
    if (visitedNodes > MAX_CONTINUOUS_OFFSET_NODES) {
      failureMessage = `Cutting segment '${cutSeg.id}' continuous offset verification exceeded node budget (${MAX_CONTINUOUS_OFFSET_NODES}) against '${stSeg.id}' (possible high-curvature/oscillating distortion).`;
      return false;
    }

    const s0 = evalSample(c, 0);
    const sMid = evalSample(c, 0.5);
    const s1 = evalSample(c, 1);

    if (s0.degenerate || sMid.degenerate || s1.degenerate) {
      failureMessage = `Mapped segment pair ('${stSeg.id}' -> '${cutSeg.id}') encountered degenerate derivative/cusp during continuous offset verification.`;
      return false;
    }

    if (depth === 0) {
      if (s0.u > 0.15 || s1.u < 0.85 || s1.u <= s0.u + 0.25) {
        failureMessage = `Cutting segment '${cutSeg.id}' covers insufficient parameter span [${s0.u.toFixed(3)}, ${s1.u.toFixed(3)}] of stitching segment '${stSeg.id}'${lrPath ? ` (${lrPath})` : ''}.`;
        return false;
      }
      if (sMid.u < s0.u - 0.05 || sMid.u > s1.u + 0.05) {
        failureMessage = `Cutting segment '${cutSeg.id}' reverses parameter progression along '${stSeg.id}' (u0=${s0.u.toFixed(3)}, uMid=${sMid.u.toFixed(3)}, u1=${s1.u.toFixed(3)}).`;
        return false;
      }
    } else if (s1.u < s0.u - 0.05 || sMid.u < uStartBound - 0.1 || sMid.u > uEndBound + 0.1) {
      failureMessage = `Cutting segment '${cutSeg.id}' reverses/folds parameter traversal along '${stSeg.id}' at depth ${depth}.`;
      return false;
    }

    for (const [label, smp] of [
      ['start', s0],
      ['mid', sMid],
      ['end', s1]
    ] as const) {
      if (smp.tanDot < 0.5) {
        failureMessage = `Cutting segment '${cutSeg.id}' tangent diverges/reverses from '${stSeg.id}' at ${label} (dot=${smp.tanDot.toFixed(3)}).`;
        return false;
      }
      if (smp.sn <= 0) {
        failureMessage = `Cutting segment '${cutSeg.id}' crosses to inward/wrong side of '${stSeg.id}' at ${label} (signedOffset=${smp.sn.toFixed(3)} cm).`;
        return false;
      }
      if (Math.abs(smp.dist - allowance) > allowedErr || Math.abs(smp.sn - allowance) > allowedErr || Math.abs(smp.dist - smp.sn) > 0.12) {
        failureMessage = `Cutting segment '${cutSeg.id}' offset at ${label} (${smp.sn.toFixed(3)} cm, dist=${smp.dist.toFixed(3)} cm) diverges from allowance ${allowance.toFixed(3)} cm of '${stSeg.id}' (allowedErr=${allowedErr.toFixed(3)} cm).`;
        return false;
      }
    }

    // 1-Lipschitz continuous convex-hull certificate around sMid.point:
    // Every point C(t) in the cubic sub-curve lies inside the convex hull of {p0, cp1, cp2, p3},
    // so ||C(t) - C(0.5)|| <= hullRadius. Since Euclidean distance to stSub is 1-Lipschitz,
    // |dist(C(t), stSub) - allowance| <= |dist(C(0.5), stSub) - allowance| + hullRadius.
    const hullRadius = Math.max(
      pointDistance(c.p0, sMid.point),
      pointDistance(c.cp1, sMid.point),
      pointDistance(c.cp2, sMid.point),
      pointDistance(c.p3, sMid.point)
    );
    const errMid = Math.abs(sMid.dist - allowance);
    const errSnMid = Math.abs(sMid.sn - allowance);

    // Hodograph cone check prevents interior cusps or tight loops from slipping inside a leaf
    const v0 = { x: 3 * (c.cp1.x - c.p0.x), y: 3 * (c.cp1.y - c.p0.y) };
    const v1 = { x: 3 * (c.cp2.x - c.cp1.x), y: 3 * (c.cp2.y - c.cp1.y) };
    const v2 = { x: 3 * (c.p3.x - c.cp2.x), y: 3 * (c.p3.y - c.cp2.y) };
    const l0 = Math.hypot(v0.x, v0.y);
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    const hodographSafe =
      l0 > 1e-6 &&
      l1 > 1e-6 &&
      l2 > 1e-6 &&
      (v0.x * v1.x + v0.y * v1.y) / (l0 * l1) >= 0.7 &&
      (v1.x * v2.x + v1.y * v2.y) / (l1 * l2) >= 0.7 &&
      (v0.x * v2.x + v0.y * v2.y) / (l0 * l2) >= 0.5;

    const tanSwing = Math.min(
      s0.tangent.x * sMid.tangent.x + s0.tangent.y * sMid.tangent.y,
      sMid.tangent.x * s1.tangent.x + sMid.tangent.y * s1.tangent.y,
      s0.tangent.x * s1.tangent.x + s0.tangent.y * s1.tangent.y
    );

    if (
      hodographSafe &&
      tanSwing >= 0.94 &&
      errMid + hullRadius <= allowedErr &&
      errSnMid + hullRadius <= allowedErr &&
      sMid.dist - hullRadius > 0 &&
      sMid.sn - hullRadius > 0
    ) {
      return true;
    }

    if (depth >= MAX_CONTINUOUS_OFFSET_DEPTH) {
      failureMessage = `Cutting segment '${cutSeg.id}' continuous offset verification failed to converge within depth ${MAX_CONTINUOUS_OFFSET_DEPTH} against '${stSeg.id}' (residual+hull=${(Math.max(errMid, errSnMid) + hullRadius).toFixed(4)} cm > ${allowedErr.toFixed(4)} cm, hodographSafe=${hodographSafe}).`;
      return false;
    }

    const { left, right } = splitCubicBezierHalf(c);
    return (
      verifyLeaf(left, depth + 1, s0.u, sMid.u) &&
      verifyLeaf(right, depth + 1, sMid.u, s1.u)
    );
  };

  verifyLeaf(cutCtrl, 0, 0, 1);
  if (failureMessage) {
    errors.push(failureMessage);
  }
}

/**
 * Computes exact bounding box extrema along 1D cubic Bézier coordinate B'(t) = 0 on (0,1).
 */
function cubicBezierAxisExtremaParams(v0: number, v1: number, v2: number, v3: number): number[] {
  const a = 3 * (-v0 + 3 * v1 - 3 * v2 + v3);
  const b = 6 * (v0 - 2 * v1 + v2);
  const c = 3 * (v1 - v0);
  const params: number[] = [];

  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t > 0 && t < 1) params.push(t);
    }
    return params;
  }

  const disc = b * b - 4 * a * c;
  if (disc < 0) return params;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  if (t1 > 0 && t1 < 1) params.push(t1);
  if (t2 > 0 && t2 < 1 && Math.abs(t2 - t1) > 1e-12) params.push(t2);
  return params;
}

function computeExactContourBoundingBox(
  segments: readonly GeometricSegmentSnapshot[]
): { minX: number; minY: number; maxX: number; maxY: number; widthCm: number; heightCm: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includePt = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };

  for (const seg of segments) {
    if (!seg || !isFinitePoint(seg.start) || !isFinitePoint(seg.end)) continue;
    includePt(seg.start);
    includePt(seg.end);
    if (seg.type === 'bezier' && Array.isArray(seg.controlPoints) && seg.controlPoints.length === 2) {
      const [cp1, cp2] = seg.controlPoints;
      if (!isFinitePoint(cp1) || !isFinitePoint(cp2)) continue;
      const ts = [
        ...cubicBezierAxisExtremaParams(seg.start.x, cp1.x, cp2.x, seg.end.x),
        ...cubicBezierAxisExtremaParams(seg.start.y, cp1.y, cp2.y, seg.end.y)
      ];
      for (const t of ts) {
        includePt(evalCubicBezierPointAndTangent(seg.start, cp1, cp2, seg.end, t).point);
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthCm: 0, heightCm: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    widthCm: maxX - minX,
    heightCm: maxY - minY
  };
}

/**
 * Exact Green's-theorem integration for closed contours containing line and cubic Bézier segments:
 *   SignedArea = 1/2 ∮ (x(t) y'(t) - y(t) x'(t)) dt
 * Centered at contour anchor to minimize IEEE-754 cancellation on translated geometry, closing
 * tiny consecutive gaps <= 0.05 cm linearly while adding gap-uncertainty + FP rounding upper bounds.
 */
function computeExactGreensContourArea(
  segments: readonly GeometricSegmentSnapshot[],
  perimeterCm: number
): {
  readonly signedAreaCm2: number;
  readonly areaCm2: number;
  readonly upperErrorBoundCm2: number;
  readonly isNumericallyValid: boolean;
  readonly errorReason?: string;
} {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  let maxCoordMag = 0;

  for (const seg of segments) {
    if (!seg || !isFinitePoint(seg.start) || !isFinitePoint(seg.end)) {
      return {
        signedAreaCm2: 0,
        areaCm2: 0,
        upperErrorBoundCm2: NaN,
        isNumericallyValid: false,
        errorReason: 'Non-finite endpoint during Green area integration.'
      };
    }
    sumX += seg.start.x + seg.end.x;
    sumY += seg.start.y + seg.end.y;
    count += 2;
    maxCoordMag = Math.max(maxCoordMag, Math.abs(seg.start.x), Math.abs(seg.start.y), Math.abs(seg.end.x), Math.abs(seg.end.y));
    if (seg.type === 'bezier' && Array.isArray(seg.controlPoints) && seg.controlPoints.length === 2) {
      const [cp1, cp2] = seg.controlPoints;
      if (!isFinitePoint(cp1) || !isFinitePoint(cp2)) {
        return {
          signedAreaCm2: 0,
          areaCm2: 0,
          upperErrorBoundCm2: NaN,
          isNumericallyValid: false,
          errorReason: 'Non-finite Bézier control point during Green area integration.'
        };
      }
      maxCoordMag = Math.max(maxCoordMag, Math.abs(cp1.x), Math.abs(cp1.y), Math.abs(cp2.x), Math.abs(cp2.y));
    }
  }

  if (count === 0 || !Number.isFinite(sumX) || !Number.isFinite(sumY)) {
    return {
      signedAreaCm2: 0,
      areaCm2: 0,
      upperErrorBoundCm2: NaN,
      isNumericallyValid: false,
      errorReason: 'Contour coordinates overflowed finite bounds.'
    };
  }

  const refX = sumX / count;
  const refY = sumY / count;
  const shift = (p: Point): Point => ({ x: p.x - refX, y: p.y - refY });
  const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
  const absCross = (a: Point, b: Point): number => Math.abs(a.x * b.y) + Math.abs(a.y * b.x);

  let signedDoubleArea = 0;
  let sumAbsDoubleTerms = 0;
  let totalGapCm = 0;
  let maxRadiusFromRef = 0;
  let controlPolySpanCm = 0;
  let allExactIntegerDyadicLines = true;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const p0 = shift(seg.start);
    const p3 = shift(seg.end);
    maxRadiusFromRef = Math.max(
      maxRadiusFromRef,
      Math.hypot(p0.x, p0.y),
      Math.hypot(p3.x, p3.y)
    );

    if (seg.type === 'line') {
      signedDoubleArea += cross(p0, p3);
      sumAbsDoubleTerms += absCross(p0, p3);
      controlPolySpanCm += pointDistance(p0, p3);
      if (
        !Number.isInteger(seg.start.x) ||
        !Number.isInteger(seg.start.y) ||
        !Number.isInteger(seg.end.x) ||
        !Number.isInteger(seg.end.y)
      ) {
        allExactIntegerDyadicLines = false;
      }
    } else if (seg.type === 'bezier' && seg.controlPoints) {
      allExactIntegerDyadicLines = false;
      const p1 = shift(seg.controlPoints[0]);
      const p2 = shift(seg.controlPoints[1]);
      maxRadiusFromRef = Math.max(
        maxRadiusFromRef,
        Math.hypot(p1.x, p1.y),
        Math.hypot(p2.x, p2.y)
      );
      controlPolySpanCm += pointDistance(p0, p1) + pointDistance(p1, p2) + pointDistance(p2, p3);
      const rawCross =
        6 * cross(p0, p1) +
        3 * cross(p0, p2) +
        cross(p0, p3) +
        3 * cross(p1, p2) +
        3 * cross(p1, p3) +
        6 * cross(p2, p3);
      const rawAbs =
        6 * absCross(p0, p1) +
        3 * absCross(p0, p2) +
        absCross(p0, p3) +
        3 * absCross(p1, p2) +
        3 * absCross(p1, p3) +
        6 * absCross(p2, p3);
      signedDoubleArea += rawCross / 10;
      sumAbsDoubleTerms += rawAbs / 10;
    }

    // Close tiny consecutive gap between seg[i].end and seg[(i+1)%n].start linearly
    const nextSeg = segments[(i + 1) % segments.length];
    if (nextSeg && isFinitePoint(nextSeg.start)) {
      const nStart = shift(nextSeg.start);
      const gap = pointDistance(seg.end, nextSeg.start);
      if (gap > 0) {
        signedDoubleArea += cross(p3, nStart);
        sumAbsDoubleTerms += absCross(p3, nStart);
        controlPolySpanCm += gap;
        totalGapCm += gap;
        allExactIntegerDyadicLines = false;
      }
    }
  }

  if (!Number.isFinite(signedDoubleArea) || !Number.isFinite(sumAbsDoubleTerms)) {
    return {
      signedAreaCm2: 0,
      areaCm2: 0,
      upperErrorBoundCm2: NaN,
      isNumericallyValid: false,
      errorReason: 'Green area integral produced non-finite result.'
    };
  }

  const signedAreaCm2 = signedDoubleArea / 2;
  const areaCm2 = Math.abs(signedAreaCm2);

  // Unit roundoff u = 2^-53
  const U = Number.EPSILON / 2;
  const hasBezier = segments.some(s => s.type === 'bezier');
  let rawUpperBoundCm2 = 0;

  if (
    !hasBezier &&
    allExactIntegerDyadicLines &&
    Number.isInteger(refX) &&
    Number.isInteger(refY) &&
    maxCoordMag < 1e6 &&
    sumAbsDoubleTerms < 1e14 &&
    totalGapCm === 0
  ) {
    // Exact integer Shoelace with integer centroid shift in IEEE-754 binary64 has zero rounding error
    rawUpperBoundCm2 = 0;
  } else {
    const fpAreaRoundoff = 32 * U * (sumAbsDoubleTerms / 2);
    const coordShiftError = 4 * U * maxCoordMag * Math.max(perimeterCm, controlPolySpanCm, 0);
    const gapUncertainty = 0.5 * totalGapCm * maxRadiusFromRef;
    rawUpperBoundCm2 = Math.max(
      fpAreaRoundoff + coordShiftError + gapUncertainty,
      areaCm2 > 0 ? 2 * U * areaCm2 : 0
    );
  }

  if (!Number.isFinite(rawUpperBoundCm2)) {
    return {
      signedAreaCm2: 0,
      areaCm2: 0,
      upperErrorBoundCm2: NaN,
      isNumericallyValid: false,
      errorReason: 'Area upper error bound became non-finite.'
    };
  }

  return {
    signedAreaCm2,
    areaCm2,
    upperErrorBoundCm2: preservePositiveErrorBound(rawUpperBoundCm2),
    isNumericallyValid: true
  };
}

function pointOnSegmentCheck(p: Point, a: Point, b: Point, eps = 1e-7): boolean {
  if (
    p.x < Math.min(a.x, b.x) - eps ||
    p.x > Math.max(a.x, b.x) + eps ||
    p.y < Math.min(a.y, b.y) - eps ||
    p.y > Math.max(a.y, b.y) + eps
  ) {
    return false;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return pointDistance(p, a) <= eps;
  const cross = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  return cross <= eps;
}

function edgesProperlyIntersectOrOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) - 1e-7 ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) - 1e-7 ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) - 1e-7 ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y) - 1e-7
  ) {
    return false;
  }

  const orient = (p: Point, q: Point, r: Point): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  const lenAB = Math.hypot(b.x - a.x, b.y - a.y);
  const lenCD = Math.hypot(d.x - c.x, d.y - c.y);
  const epsAB = Math.max(1e-9, lenAB * 1e-7);
  const epsCD = Math.max(1e-9, lenCD * 1e-7);

  if (((o1 > epsAB && o2 < -epsAB) || (o1 < -epsAB && o2 > epsAB)) &&
      ((o3 > epsCD && o4 < -epsCD) || (o3 < -epsCD && o4 > epsCD))) {
    return true;
  }

  // Interior T-touch or collinear overlap
  if (Math.abs(o1) <= epsAB && pointOnSegmentCheck(c, a, b, 1e-5) && pointDistance(c, a) > 1e-3 && pointDistance(c, b) > 1e-3) {
    return true;
  }
  if (Math.abs(o2) <= epsAB && pointOnSegmentCheck(d, a, b, 1e-5) && pointDistance(d, a) > 1e-3 && pointDistance(d, b) > 1e-3) {
    return true;
  }
  if (Math.abs(o3) <= epsCD && pointOnSegmentCheck(a, c, d, 1e-5) && pointDistance(a, c) > 1e-3 && pointDistance(a, d) > 1e-3) {
    return true;
  }
  if (Math.abs(o4) <= epsCD && pointOnSegmentCheck(b, c, d, 1e-5) && pointDistance(b, c) > 1e-3 && pointDistance(b, d) > 1e-3) {
    return true;
  }

  return false;
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-18) return pointDistance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function isPointInsideOrOnPolygonBoundary(
  pt: Point,
  poly: readonly Point[],
  boundaryTolCm: number
): boolean {
  const n = poly.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (pointToSegmentDistance(pt, a, b) <= boundaryTolCm) {
      return true;
    }
  }

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

interface AnalyzedContourGeometry {
  readonly isValid: boolean;
  readonly hasBezier: boolean;
  readonly perimeterCm: number;
  readonly areaCm2: number;
  readonly signedAreaCm2: number;
  readonly bezierArcLengthCm: number;
  readonly worstBezierErrorBoundCm: number;
  readonly perimeterTotalErrorBoundCm: number;
  readonly perimeterActualMaxDepth: number;
  readonly perimeterMaxDepthReached: boolean;
  readonly allLengthTolerancesAchieved: boolean;
  readonly areaActualMaxDepth: number;
  readonly areaMaxDepthReached: boolean;
  readonly areaWorstResidualFlatnessCm: number;
  readonly areaFlatteningToleranceAchieved: boolean;
  readonly areaUpperBoundCm2: number;
  readonly sampledBoundaryPoints: readonly Point[];
  readonly boundingBox: { minX: number; minY: number; maxX: number; maxY: number; widthCm: number; heightCm: number };
  readonly boundingWidthCm: number;
  readonly boundingHeightCm: number;
  readonly errors: readonly string[];
}

function analyzeContourGeometry(
  contour: GeometricContourSnapshot | undefined,
  contourLabel: string
): AnalyzedContourGeometry {
  const errors: string[] = [];
  const emptyBox = { minX: 0, minY: 0, maxX: 0, maxY: 0, widthCm: 0, heightCm: 0 };

  if (!contour || typeof contour !== 'object') {
    return {
      isValid: false,
      hasBezier: false,
      perimeterCm: 0,
      areaCm2: 0,
      signedAreaCm2: 0,
      bezierArcLengthCm: 0,
      worstBezierErrorBoundCm: 0,
      perimeterTotalErrorBoundCm: NaN,
      perimeterActualMaxDepth: 0,
      perimeterMaxDepthReached: false,
      allLengthTolerancesAchieved: false,
      areaActualMaxDepth: 0,
      areaMaxDepthReached: false,
      areaWorstResidualFlatnessCm: 0,
      areaFlatteningToleranceAchieved: false,
      areaUpperBoundCm2: NaN,
      sampledBoundaryPoints: [],
      boundingBox: emptyBox,
      boundingWidthCm: 0,
      boundingHeightCm: 0,
      errors: [`Missing ${contourLabel} contour.`]
    };
  }

  if (contour.isClosed !== true) {
    errors.push(`${contourLabel} contour '${contour.id}' must be closed (isClosed === true).`);
  }

  if (!Array.isArray(contour.segments) || contour.segments.length < 2) {
    errors.push(`${contourLabel} contour '${contour.id}' must have at least 2 segments.`);
    return {
      isValid: false,
      hasBezier: false,
      perimeterCm: 0,
      areaCm2: 0,
      signedAreaCm2: 0,
      bezierArcLengthCm: 0,
      worstBezierErrorBoundCm: 0,
      perimeterTotalErrorBoundCm: NaN,
      perimeterActualMaxDepth: 0,
      perimeterMaxDepthReached: false,
      allLengthTolerancesAchieved: false,
      areaActualMaxDepth: 0,
      areaMaxDepthReached: false,
      areaWorstResidualFlatnessCm: 0,
      areaFlatteningToleranceAchieved: false,
      areaUpperBoundCm2: NaN,
      sampledBoundaryPoints: [],
      boundingBox: emptyBox,
      boundingWidthCm: 0,
      boundingHeightCm: 0,
      errors
    };
  }

  let hasBezier = false;
  let totalPerimeterCm = 0;
  let bezierArcLengthCm = 0;
  let worstBezierErrorBoundCm = 0;
  let summedSegmentErrorBoundCm = 0;
  let allExactAxisIntLines = true;
  let perimeterActualMaxDepth = 0;
  let perimeterMaxDepthReached = false;
  let allLengthTolerancesAchieved = true;

  let areaActualMaxDepth = 0;
  let areaMaxDepthReached = false;
  let areaWorstResidualFlatnessCm = 0;
  let areaFlatteningToleranceAchieved = true;

  const polyPoints: Point[] = [];
  const seenSegIds = new Set<string>();

  for (let i = 0; i < contour.segments.length; i++) {
    const seg = contour.segments[i];
    if (!seg || typeof seg !== 'object') {
      errors.push(`${contourLabel} segment[${i}] is malformed.`);
      continue;
    }

    if (!seg.id || typeof seg.id !== 'string') {
      errors.push(`${contourLabel} segment[${i}] is missing string id.`);
    } else if (seenSegIds.has(seg.id)) {
      errors.push(`${contourLabel} contains duplicate segment id '${seg.id}'.`);
    } else {
      seenSegIds.add(seg.id);
    }

    if (!isFinitePoint(seg.start) || !isFinitePoint(seg.end)) {
      errors.push(`${contourLabel} segment '${seg.id}' has non-finite or out-of-range start or end coordinates.`);
      continue;
    }

    if (typeof seg.lengthCm !== 'number' || !Number.isFinite(seg.lengthCm) || seg.lengthCm < 0) {
      errors.push(`${contourLabel} segment '${seg.id}' has invalid lengthCm (${String(seg.lengthCm)}).`);
    }

    if (typeof seg.seamAllowanceCm !== 'number' || !Number.isFinite(seg.seamAllowanceCm) || seg.seamAllowanceCm < 0) {
      errors.push(
        `${contourLabel} segment '${seg.id}' has invalid seamAllowanceCm (${String(seg.seamAllowanceCm)}).`
      );
    }

    if (seg.type === 'line') {
      const len = pointDistance(seg.start, seg.end);
      if (!Number.isFinite(len) || len < MIN_SEGMENT_LENGTH_CM) {
        errors.push(
          `${contourLabel} line segment '${seg.id}' is zero-length or degenerate (${len.toFixed(6)} cm < minimum ${MIN_SEGMENT_LENGTH_CM} cm).`
        );
      } else {
        totalPerimeterCm += len;
        const isAxisIntLine =
          (seg.start.x === seg.end.x || seg.start.y === seg.end.y) &&
          Number.isInteger(seg.start.x) &&
          Number.isInteger(seg.start.y) &&
          Number.isInteger(seg.end.x) &&
          Number.isInteger(seg.end.y);
        if (!isAxisIntLine) {
          allExactAxisIntLines = false;
          summedSegmentErrorBoundCm += 4 * (Number.EPSILON / 2) * len;
        }
        if (
          typeof seg.lengthCm === 'number' &&
          Number.isFinite(seg.lengthCm) &&
          Math.abs(len - seg.lengthCm) > LENGTH_CONSISTENCY_TOLERANCE_CM
        ) {
          errors.push(
            `${contourLabel} segment '${seg.id}' recorded lengthCm (${seg.lengthCm}) diverges from coordinate distance (${len.toFixed(4)} cm).`
          );
        }
      }
      polyPoints.push(seg.start);
    } else if (seg.type === 'bezier') {
      hasBezier = true;
      allExactAxisIntLines = false;
      if (!Array.isArray(seg.controlPoints) || seg.controlPoints.length !== 2) {
        errors.push(`${contourLabel} Bézier segment '${seg.id}' is missing required controlPoints[2].`);
        continue;
      }
      const [cp1, cp2] = seg.controlPoints;
      if (!isFinitePoint(cp1) || !isFinitePoint(cp2)) {
        errors.push(`${contourLabel} Bézier segment '${seg.id}' has non-finite control point or out-of-range coordinates.`);
        continue;
      }

      const bezRes = measureCubicBezierPerimeterWithDepth(
        seg.start,
        cp1,
        cp2,
        seg.end,
        BEZIER_PERIMETER_TOLERANCE_CM,
        BEZIER_PERIMETER_MAX_DEPTH
      );
      if (bezRes.actualMaxDepth > perimeterActualMaxDepth) {
        perimeterActualMaxDepth = bezRes.actualMaxDepth;
      }
      if (bezRes.maxDepthReached) {
        perimeterMaxDepthReached = true;
      }
      if (bezRes.errorBoundCm > worstBezierErrorBoundCm) {
        worstBezierErrorBoundCm = bezRes.errorBoundCm;
      }
      if (Number.isFinite(bezRes.errorBoundCm)) {
        summedSegmentErrorBoundCm += bezRes.errorBoundCm;
      }
      if (!bezRes.toleranceAchieved) {
        allLengthTolerancesAchieved = false;
        errors.push(
          `${contourLabel} Bézier segment '${seg.id}' perimeter subdivision did not achieve tolerance ${BEZIER_PERIMETER_TOLERANCE_CM} cm (errorBoundCm=${bezRes.errorBoundCm}, maxDepthReached=${bezRes.maxDepthReached}, depth=${bezRes.actualMaxDepth}).`
        );
      }

      if (!Number.isFinite(bezRes.lengthCm) || bezRes.lengthCm < MIN_SEGMENT_LENGTH_CM) {
        errors.push(
          `${contourLabel} Bézier segment '${seg.id}' is zero-length or degenerate (${bezRes.lengthCm} cm < minimum ${MIN_SEGMENT_LENGTH_CM} cm).`
        );
      } else {
        totalPerimeterCm += bezRes.lengthCm;
        bezierArcLengthCm += bezRes.lengthCm;
        if (
          typeof seg.lengthCm === 'number' &&
          Number.isFinite(seg.lengthCm) &&
          Math.abs(bezRes.lengthCm - seg.lengthCm) > LENGTH_CONSISTENCY_TOLERANCE_CM
        ) {
          errors.push(
            `${contourLabel} Bézier segment '${seg.id}' recorded lengthCm (${seg.lengthCm}) diverges from adaptive curve length (${bezRes.lengthCm.toFixed(4)} cm).`
          );
        }
      }

      const flat = flattenCubicBezierWithDiagnostics(
        seg.start,
        cp1,
        cp2,
        seg.end,
        BEZIER_AREA_FLATNESS_TOLERANCE_CM,
        BEZIER_AREA_MAX_SUBDIVISION_DEPTH
      );
      if (flat.actualMaxDepth > areaActualMaxDepth) {
        areaActualMaxDepth = flat.actualMaxDepth;
      }
      if (flat.maxDepthReached) {
        areaMaxDepthReached = true;
      }
      if (flat.worstResidualDeviationCm > areaWorstResidualFlatnessCm) {
        areaWorstResidualFlatnessCm = flat.worstResidualDeviationCm;
      }
      if (!flat.toleranceAchieved) {
        areaFlatteningToleranceAchieved = false;
        errors.push(
          `${contourLabel} Bézier segment '${seg.id}' curve flattening hit max depth ${BEZIER_AREA_MAX_SUBDIVISION_DEPTH} with residual deviation ${flat.worstResidualDeviationCm.toFixed(6)} cm > ${BEZIER_AREA_FLATNESS_TOLERANCE_CM} cm; contour topology/containment cannot be guaranteed.`
        );
      }
      for (let j = 0; j < flat.points.length - 1; j++) {
        polyPoints.push(flat.points[j]);
      }
    } else {
      errors.push(`${contourLabel} segment '${seg.id}' has unsupported type '${String(seg.type)}'.`);
    }
  }

  // Consecutive connectivity & loop closure checks
  for (let i = 0; i < contour.segments.length - 1; i++) {
    const curr = contour.segments[i];
    const next = contour.segments[i + 1];
    if (isFinitePoint(curr?.end) && isFinitePoint(next?.start)) {
      const gap = pointDistance(curr.end, next.start);
      if (gap > CONTOUR_CLOSURE_TOLERANCE_CM) {
        errors.push(
          `${contourLabel} contour disconnected between '${curr.id}' and '${next.id}' (gap ${gap.toFixed(4)} cm).`
        );
      }
    }
  }
  const firstSeg = contour.segments[0];
  const lastSeg = contour.segments[contour.segments.length - 1];
  if (isFinitePoint(firstSeg?.start) && isFinitePoint(lastSeg?.end)) {
    const loopGap = pointDistance(lastSeg.end, firstSeg.start);
    if (loopGap > CONTOUR_CLOSURE_TOLERANCE_CM) {
      errors.push(
        `${contourLabel} contour closure gap (${loopGap.toFixed(4)} cm) exceeds tolerance (${CONTOUR_CLOSURE_TOLERANCE_CM} cm).`
      );
    }
  }

  // Verify contour.totalLengthCm against recomputed perimeter
  const maxAllowedLengthDrift = Math.max(
    LENGTH_CONSISTENCY_TOLERANCE_CM,
    contour.segments.length * 0.015
  );
  if (
    typeof contour.totalLengthCm !== 'number' ||
    !Number.isFinite(contour.totalLengthCm) ||
    Math.abs(contour.totalLengthCm - totalPerimeterCm) > maxAllowedLengthDrift
  ) {
    errors.push(
      `${contourLabel} recorded totalLengthCm (${String(contour.totalLengthCm)}) diverges from recomputed perimeter (${totalPerimeterCm.toFixed(4)} cm).`
    );
  }

  // Exact analytic bounding box (solving cubic B'(t)=0 extrema) & validation against contour.boundingBox
  const exactBox = computeExactContourBoundingBox(contour.segments);
  const boundingWidthCm = exactBox.widthCm;
  const boundingHeightCm = exactBox.heightCm;

  if (!Number.isFinite(boundingWidthCm) || boundingWidthCm <= 0) {
    errors.push(`${contourLabel} contour has zero or non-positive bounding width (${boundingWidthCm}).`);
  }
  if (!Number.isFinite(boundingHeightCm) || boundingHeightCm <= 0) {
    errors.push(`${contourLabel} contour has zero or non-positive bounding height (${boundingHeightCm}).`);
  }

  const cbb = contour.boundingBox;
  if (
    !cbb ||
    !Number.isFinite(cbb.minX) ||
    !Number.isFinite(cbb.minY) ||
    !Number.isFinite(cbb.maxX) ||
    !Number.isFinite(cbb.maxY) ||
    !Number.isFinite(cbb.widthCm) ||
    !Number.isFinite(cbb.heightCm) ||
    Math.abs(cbb.widthCm - (cbb.maxX - cbb.minX)) > 0.03 ||
    Math.abs(cbb.heightCm - (cbb.maxY - cbb.minY)) > 0.03 ||
    Math.abs(cbb.minX - exactBox.minX) > BOUNDING_BOX_CONSISTENCY_TOLERANCE_CM ||
    Math.abs(cbb.minY - exactBox.minY) > BOUNDING_BOX_CONSISTENCY_TOLERANCE_CM ||
    Math.abs(cbb.maxX - exactBox.maxX) > BOUNDING_BOX_CONSISTENCY_TOLERANCE_CM ||
    Math.abs(cbb.maxY - exactBox.maxY) > BOUNDING_BOX_CONSISTENCY_TOLERANCE_CM
  ) {
    errors.push(
      `${contourLabel} recorded boundingBox diverges from exact contour extrema (${exactBox.widthCm.toFixed(2)}x${exactBox.heightCm.toFixed(2)} cm).`
    );
  }

  // Strict non-self-intersection topology check on closed flattened polygon (only if flattening converged)
  if (polyPoints.length >= 3) {
    const N = polyPoints.length;
    for (let i = 0; i < N; i++) {
      const a = polyPoints[i];
      const b = polyPoints[(i + 1) % N];
      if (!isFinitePoint(a) || !isFinitePoint(b)) continue;

      // Check collinear foldback overlap on immediate next edge
      const c = polyPoints[(i + 2) % N];
      const uX = b.x - a.x;
      const uY = b.y - a.y;
      const vX = c.x - b.x;
      const vY = c.y - b.y;
      const lenU = Math.hypot(uX, uY);
      const lenV = Math.hypot(vX, vY);
      if (lenU > 1e-6 && lenV > 1e-6) {
        const dotUnit = (uX * vX + uY * vY) / (lenU * lenV);
        const crossUnit = Math.abs(uX * vY - uY * vX) / (lenU * lenV);
        if (dotUnit < -0.99999 && crossUnit < 1e-4 && Math.min(lenU, lenV) > 0.05) {
          errors.push(
            `${contourLabel} contour folds directly back over itself collinearly around (${b.x.toFixed(2)}, ${b.y.toFixed(2)}).`
          );
          break;
        }
      }

      let foundCrossing = false;
      for (let j = i + 2; j < N; j++) {
        if (i === 0 && j === N - 1) continue;
        const p3 = polyPoints[j];
        const p4 = polyPoints[(j + 1) % N];
        if (!isFinitePoint(p3) || !isFinitePoint(p4)) continue;
        if (edgesProperlyIntersectOrOverlap(a, b, p3, p4)) {
          errors.push(
            `${contourLabel} contour is self-intersecting between edge ${i} and edge ${j}.`
          );
          foundCrossing = true;
          break;
        }
      }
      if (foundCrossing) break;
    }
  }

  // Exact Green's-theorem area calculation (line + cubic Bézier exact polynomial integral)
  const greenArea = computeExactGreensContourArea(contour.segments, totalPerimeterCm);
  if (!greenArea.isNumericallyValid) {
    errors.push(greenArea.errorReason ?? `${contourLabel} Green area computation failed numerically.`);
  }
  if (!Number.isFinite(greenArea.areaCm2) || greenArea.areaCm2 <= 0) {
    errors.push(`${contourLabel} contour enclosed area is non-positive or degenerate (${greenArea.areaCm2} cm2).`);
  }
  if (!Number.isFinite(totalPerimeterCm) || totalPerimeterCm <= 0) {
    errors.push(`${contourLabel} contour perimeter is non-positive (${totalPerimeterCm} cm).`);
  }

  const summationFpBoundCm = allExactAxisIntLines && Number.isInteger(totalPerimeterCm)
    ? 0
    : contour.segments.length * (Number.EPSILON / 2) * Math.max(totalPerimeterCm, 0);
  const perimeterTotalErrorBoundCm = preservePositiveErrorBound(
    summedSegmentErrorBoundCm + summationFpBoundCm
  );

  return {
    isValid: errors.length === 0,
    hasBezier,
    perimeterCm: totalPerimeterCm,
    areaCm2: greenArea.areaCm2,
    signedAreaCm2: greenArea.signedAreaCm2,
    bezierArcLengthCm,
    worstBezierErrorBoundCm: preservePositiveErrorBound(worstBezierErrorBoundCm),
    perimeterTotalErrorBoundCm,
    perimeterActualMaxDepth,
    perimeterMaxDepthReached,
    allLengthTolerancesAchieved,
    areaActualMaxDepth,
    areaMaxDepthReached,
    areaWorstResidualFlatnessCm: preservePositiveErrorBound(areaWorstResidualFlatnessCm),
    areaFlatteningToleranceAchieved,
    areaUpperBoundCm2: greenArea.upperErrorBoundCm2,
    sampledBoundaryPoints: polyPoints,
    boundingBox: exactBox,
    boundingWidthCm: round4(boundingWidthCm),
    boundingHeightCm: round4(boundingHeightCm),
    errors
  };
}

/**
 * Resolves and validates explicit cut quantity semantics for a `PatternPieceSnapshot`.
 * Separates fabric-fold unfolding from paired left/right mirroring and never silently
 * infers pairing mode from `cutCount` and `onFold` alone.
 */
export function resolveCutQuantitySemantics(
  piece: PatternPieceSnapshot,
  options: ResolveCutSemanticsOptions = {}
): PatternPieceCutSemantics {
  const hasExplicitQuantity = options.garmentUnitQuantity !== undefined;
  const orderQuantityBasis: OrderQuantityBasis = hasExplicitQuantity
    ? 'declared-order-quantity'
    : 'default-single-garment-per-size-run';
  const garmentUnitQuantity = options.garmentUnitQuantity ?? 1;
  const contradictionReasons: string[] = [];

  if (!Number.isInteger(garmentUnitQuantity) || garmentUnitQuantity < 1) {
    contradictionReasons.push(
      `garmentUnitQuantity must be a positive integer >= 1 (received ${String(garmentUnitQuantity)}).`
    );
  }
  if (!Number.isInteger(piece.cutCount) || piece.cutCount < 1) {
    contradictionReasons.push(`Source piece '${piece.pieceCode}' has invalid cutCount (${String(piece.cutCount)}).`);
  }

  const decl = options.declaration;
  if (!decl || !decl.pairingMode) {
    contradictionReasons.push(
      `Cut pairing mode is unresolved for piece '${piece.pieceCode}': pairing mode cannot be silently inferred from cutCount (${piece.cutCount}) and onFold (${piece.onFold}) alone.`
    );
    return {
      pairingMode: undefined,
      semanticResolutionStatus: 'unresolved',
      patternPieceCount: 1,
      physicalPanelCountPerGarment: null,
      cuttingOperationsSinglePlyPerGarment: null,
      cuttingOperationsPairedPlyPerGarment: null,
      garmentUnitQuantity: Number.isInteger(garmentUnitQuantity) && garmentUnitQuantity >= 1 ? garmentUnitQuantity : 0,
      orderQuantityBasis,
      totalPhysicalPanelsForOrder: null,
      requiresMirroring: null,
      mirroringRule: 'unresolved',
      requiresFabricFold: null,
      requiresFoldUnfolding: null,
      foldUnfoldingOperation: 'unresolved',
      declaredCutCountFromSource: piece.cutCount,
      declaredOnFoldFromSource: Boolean(piece.onFold),
      contradictionReasons
    };
  }

  // Validate grainline consistently across every cut mode
  if (!isValidGrainline(piece)) {
    contradictionReasons.push(
      `Piece '${piece.pieceCode}' lacks a valid non-degenerate grainline required for cutting orientation.`
    );
  }

  // Validate expectedQuantityPerGarment type upfront if supplied
  if (
    decl.expectedQuantityPerGarment !== undefined &&
    (!Number.isInteger(decl.expectedQuantityPerGarment) || decl.expectedQuantityPerGarment < 1)
  ) {
    contradictionReasons.push(
      `Declared expectedQuantityPerGarment (${String(decl.expectedQuantityPerGarment)}) must be a positive integer.`
    );
  }

  const foldSegments = findFoldSegments(piece.stitchingContour);
  let foldEdgeSegmentId: string | undefined;
  let foldEdgeAxis: PatternPieceCutSemantics['foldEdgeAxis'];

  switch (decl.pairingMode) {
    case 'single-centered-on-fold': {
      if (piece.onFold !== true) {
        contradictionReasons.push(
          `Pairing mode 'single-centered-on-fold' contradicts source piece '${piece.pieceCode}' where onFold is false.`
        );
      }
      if (piece.cutCount !== 1) {
        contradictionReasons.push(
          `Pairing mode 'single-centered-on-fold' requires cutCount === 1 half-pattern cut (found ${piece.cutCount}).`
        );
      }
      if (decl.expectedQuantityPerGarment !== undefined && decl.expectedQuantityPerGarment !== 1) {
        contradictionReasons.push(
          `Declared expectedQuantityPerGarment (${decl.expectedQuantityPerGarment}) contradicts 'single-centered-on-fold' physical panel count (1 unfolded panel per garment).`
        );
      }
      if (decl.mirroringConfirmed === true) {
        contradictionReasons.push(
          `Pairing mode 'single-centered-on-fold' uses fabric-fold unfolding, not paired left/right mirroring (mirroringConfirmed must not be true).`
        );
      }
      if (!piece.stitchingContour) {
        contradictionReasons.push(
          `Piece '${piece.pieceCode}' missing stitchingContour required to verify fold edge.`
        );
      } else {
        let resolvedFoldSeg: GeometricSegmentSnapshot | undefined;
        if (decl.foldEdgeSegmentId) {
          const explicitFoldSeg = piece.stitchingContour.segments.find(s => s.id === decl.foldEdgeSegmentId);
          if (!explicitFoldSeg) {
            contradictionReasons.push(
              `Declared foldEdgeSegmentId '${decl.foldEdgeSegmentId}' does not exist in stitchingContour of '${piece.pieceCode}'.`
            );
          } else if (!explicitFoldSeg.isFold) {
            contradictionReasons.push(
              `Declared foldEdgeSegmentId '${decl.foldEdgeSegmentId}' is not marked isFold === true.`
            );
          } else {
            resolvedFoldSeg = explicitFoldSeg;
          }
        } else if (foldSegments.length === 1) {
          resolvedFoldSeg = foldSegments[0];
        } else if (foldSegments.length === 0) {
          contradictionReasons.push(
            `Piece '${piece.pieceCode}' has pairing mode 'single-centered-on-fold' but no fold-edge segment (isFold: true) exists in stitchingContour.`
          );
        } else {
          contradictionReasons.push(
            `Piece '${piece.pieceCode}' has ${foldSegments.length} fold segments without explicit foldEdgeSegmentId disambiguation.`
          );
        }

        if (resolvedFoldSeg) {
          foldEdgeSegmentId = resolvedFoldSeg.id;
          if (resolvedFoldSeg.seamAllowanceCm !== 0) {
            contradictionReasons.push(
              `Fold edge '${resolvedFoldSeg.id}' must have 0 cm seam allowance (found ${resolvedFoldSeg.seamAllowanceCm} cm).`
            );
          }
          if (resolvedFoldSeg.type !== 'line') {
            contradictionReasons.push(
              `Fold edge '${resolvedFoldSeg.id}' must be a straight line segment (found '${resolvedFoldSeg.type}').`
            );
          } else if (!isFinitePoint(resolvedFoldSeg.start) || !isFinitePoint(resolvedFoldSeg.end)) {
            contradictionReasons.push(`Fold edge '${resolvedFoldSeg.id}' has non-finite endpoints.`);
          } else {
            const foldLen = pointDistance(resolvedFoldSeg.start, resolvedFoldSeg.end);
            if (foldLen < MIN_FOLD_EDGE_LENGTH_CM) {
              contradictionReasons.push(
                `Fold edge '${resolvedFoldSeg.id}' length (${foldLen.toFixed(4)} cm) is below minimum valid fold-edge length (${MIN_FOLD_EDGE_LENGTH_CM} cm).`
              );
            } else {
              foldEdgeAxis = classifyFoldAxisOrientation(resolvedFoldSeg.start, resolvedFoldSeg.end);
            }
          }
        }

        // Cross-check cutting contour fold representation
        if (foldEdgeSegmentId) {
          if (!piece.cuttingContour || !Array.isArray(piece.cuttingContour.segments)) {
            contradictionReasons.push(
              `Piece '${piece.pieceCode}' missing cuttingContour required to verify fold edge.`
            );
          } else {
            const matchingCutFold = piece.cuttingContour.segments.filter(
              s => s.isFold && s.sourceSegmentId === foldEdgeSegmentId && !isTransitionRole(s.role)
            );
            if (matchingCutFold.length === 0) {
              contradictionReasons.push(
                `Cutting contour of '${piece.pieceCode}' is missing matching fold edge segment for '${foldEdgeSegmentId}'.`
              );
            }
            for (const cSeg of matchingCutFold) {
              if (cSeg.seamAllowanceCm !== 0) {
                contradictionReasons.push(
                  `Cutting contour fold segment '${cSeg.id}' must have 0 cm seam allowance (found ${cSeg.seamAllowanceCm} cm).`
                );
              }
              if (isFinitePoint(cSeg.start) && isFinitePoint(cSeg.end)) {
                const cFoldLen = pointDistance(cSeg.start, cSeg.end);
                if (cFoldLen < MIN_FOLD_EDGE_LENGTH_CM) {
                  contradictionReasons.push(
                    `Cutting contour fold segment '${cSeg.id}' length (${cFoldLen.toFixed(4)} cm) is below minimum (${MIN_FOLD_EDGE_LENGTH_CM} cm).`
                  );
                }
              }
            }
          }
        }
      }

      const valid = contradictionReasons.length === 0;
      return {
        pairingMode: decl.pairingMode,
        semanticResolutionStatus: valid ? 'resolved' : 'invalid',
        patternPieceCount: 1,
        physicalPanelCountPerGarment: valid ? 1 : null,
        cuttingOperationsSinglePlyPerGarment: valid ? 1 : null,
        cuttingOperationsPairedPlyPerGarment: valid ? 1 : null,
        garmentUnitQuantity: valid ? garmentUnitQuantity : 0,
        orderQuantityBasis,
        totalPhysicalPanelsForOrder: valid ? garmentUnitQuantity : null,
        // Paired left/right mirroring is strictly false; unfolding across fold axis is represented explicitly.
        requiresMirroring: false,
        mirroringRule: 'none',
        requiresFabricFold: true,
        requiresFoldUnfolding: true,
        foldUnfoldingOperation: 'unfold-across-fold-axis' as FoldUnfoldingOperation,
        foldEdgeSegmentId,
        foldEdgeAxis,
        declaredCutCountFromSource: piece.cutCount,
        declaredOnFoldFromSource: Boolean(piece.onFold),
        contradictionReasons
      };
    }

    case 'paired-mirrored-left-right': {
      if (piece.onFold === true || foldSegments.length > 0) {
        contradictionReasons.push(
          `Pairing mode 'paired-mirrored-left-right' contradicts fold flags on piece '${piece.pieceCode}'.`
        );
      }
      if (piece.cutCount !== 2) {
        contradictionReasons.push(
          `Pairing mode 'paired-mirrored-left-right' requires cutCount === 2 mirrored panels per garment (found ${piece.cutCount}).`
        );
      }
      if (decl.expectedQuantityPerGarment !== undefined && decl.expectedQuantityPerGarment !== 2) {
        contradictionReasons.push(
          `Declared expectedQuantityPerGarment (${decl.expectedQuantityPerGarment}) disagrees with 'paired-mirrored-left-right' physical panel count (2).`
        );
      }
      if (decl.mirroringConfirmed !== true) {
        contradictionReasons.push(
          `Pairing mode 'paired-mirrored-left-right' for '${piece.pieceCode}' requires explicit mirroringConfirmed === true; cutCount alone does not authorize mirrored cutting.`
        );
      }

      const valid = contradictionReasons.length === 0;
      return {
        pairingMode: decl.pairingMode,
        semanticResolutionStatus: valid ? 'resolved' : 'invalid',
        patternPieceCount: 1,
        physicalPanelCountPerGarment: valid ? 2 : null,
        cuttingOperationsSinglePlyPerGarment: valid ? 2 : null,
        cuttingOperationsPairedPlyPerGarment: valid ? 1 : null,
        garmentUnitQuantity: valid ? garmentUnitQuantity : 0,
        orderQuantityBasis,
        totalPhysicalPanelsForOrder: valid ? 2 * garmentUnitQuantity : null,
        requiresMirroring: true,
        mirroringRule: 'cut-paired-face-to-face-left-right',
        requiresFabricFold: false,
        requiresFoldUnfolding: false,
        foldUnfoldingOperation: 'none',
        declaredCutCountFromSource: piece.cutCount,
        declaredOnFoldFromSource: Boolean(piece.onFold),
        contradictionReasons
      };
    }

    case 'single-asymmetric': {
      if (piece.onFold === true || foldSegments.length > 0) {
        contradictionReasons.push(
          `Pairing mode 'single-asymmetric' contradicts fold flags on piece '${piece.pieceCode}'.`
        );
      }
      if (piece.cutCount !== 1) {
        contradictionReasons.push(
          `Pairing mode 'single-asymmetric' requires cutCount === 1 (found ${piece.cutCount}).`
        );
      }
      if (decl.expectedQuantityPerGarment !== undefined && decl.expectedQuantityPerGarment !== 1) {
        contradictionReasons.push(
          `Declared expectedQuantityPerGarment (${decl.expectedQuantityPerGarment}) disagrees with 'single-asymmetric' physical panel count (1).`
        );
      }
      if (decl.mirroringConfirmed === true) {
        contradictionReasons.push(
          `Pairing mode 'single-asymmetric' cannot enable mirroringConfirmed: true.`
        );
      }

      const valid = contradictionReasons.length === 0;
      return {
        pairingMode: decl.pairingMode,
        semanticResolutionStatus: valid ? 'resolved' : 'invalid',
        patternPieceCount: 1,
        physicalPanelCountPerGarment: valid ? 1 : null,
        cuttingOperationsSinglePlyPerGarment: valid ? 1 : null,
        cuttingOperationsPairedPlyPerGarment: valid ? 1 : null,
        garmentUnitQuantity: valid ? garmentUnitQuantity : 0,
        orderQuantityBasis,
        totalPhysicalPanelsForOrder: valid ? garmentUnitQuantity : null,
        requiresMirroring: false,
        mirroringRule: 'none',
        requiresFabricFold: false,
        requiresFoldUnfolding: false,
        foldUnfoldingOperation: 'none',
        declaredCutCountFromSource: piece.cutCount,
        declaredOnFoldFromSource: Boolean(piece.onFold),
        contradictionReasons
      };
    }

    case 'multiple-identical': {
      if (piece.onFold === true || foldSegments.length > 0) {
        contradictionReasons.push(
          `Pairing mode 'multiple-identical' contradicts fold flags on piece '${piece.pieceCode}'.`
        );
      }
      if (!Number.isInteger(piece.cutCount) || piece.cutCount < 2) {
        contradictionReasons.push(
          `Pairing mode 'multiple-identical' requires integer cutCount >= 2 (found ${String(piece.cutCount)}).`
        );
      }
      if (decl.expectedQuantityPerGarment !== undefined && decl.expectedQuantityPerGarment !== piece.cutCount) {
        contradictionReasons.push(
          `Declared expectedQuantityPerGarment (${decl.expectedQuantityPerGarment}) disagrees with piece cutCount (${piece.cutCount}).`
        );
      }
      if (decl.explicitMultiMirroredPairs === true && piece.cutCount % 2 !== 0) {
        contradictionReasons.push(
          `explicitMultiMirroredPairs requires an even cutCount (found ${piece.cutCount}).`
        );
      }

      const valid = contradictionReasons.length === 0;
      const explicitMirror = decl.explicitMultiMirroredPairs === true;
      const mirroringRule: MirroringRule = explicitMirror
        ? 'explicit-multi-paired-left-right'
        : 'explicit-multi-identical-non-mirrored';

      return {
        pairingMode: decl.pairingMode,
        semanticResolutionStatus: valid ? 'resolved' : 'invalid',
        patternPieceCount: 1,
        physicalPanelCountPerGarment: valid ? piece.cutCount : null,
        cuttingOperationsSinglePlyPerGarment: valid ? piece.cutCount : null,
        cuttingOperationsPairedPlyPerGarment: valid
          ? explicitMirror
            ? piece.cutCount / 2
            : piece.cutCount
          : null,
        garmentUnitQuantity: valid ? garmentUnitQuantity : 0,
        orderQuantityBasis,
        totalPhysicalPanelsForOrder: valid ? piece.cutCount * garmentUnitQuantity : null,
        requiresMirroring: explicitMirror,
        mirroringRule,
        requiresFabricFold: false,
        requiresFoldUnfolding: false,
        foldUnfoldingOperation: 'none',
        declaredCutCountFromSource: piece.cutCount,
        declaredOnFoldFromSource: Boolean(piece.onFold),
        contradictionReasons
      };
    }

    default: {
      contradictionReasons.push(`Unsupported pairingMode '${String((decl as { pairingMode?: unknown }).pairingMode)}'.`);
      return {
        pairingMode: undefined,
        semanticResolutionStatus: 'invalid',
        patternPieceCount: 1,
        physicalPanelCountPerGarment: null,
        cuttingOperationsSinglePlyPerGarment: null,
        cuttingOperationsPairedPlyPerGarment: null,
        garmentUnitQuantity: 0,
        orderQuantityBasis,
        totalPhysicalPanelsForOrder: null,
        requiresMirroring: null,
        mirroringRule: 'unresolved',
        requiresFabricFold: null,
        requiresFoldUnfolding: null,
        foldUnfoldingOperation: 'unresolved',
        declaredCutCountFromSource: piece.cutCount,
        declaredOnFoldFromSource: Boolean(piece.onFold),
        contradictionReasons
      };
    }
  }
}

/**
 * Builds a traceable per-segment allowance schedule from authoritative `stitchingContour` and
 * `cuttingContour` segments without replacing geometry allowances with UI defaults.
 */
export function buildPieceAllowanceSchedule(
  piece: PatternPieceSnapshot,
  cutSemantics?: PatternPieceCutSemantics,
  options: BuildAllowanceScheduleOptions = {}
): PieceAllowanceSchedule {
  const issues: string[] = [];
  const knownDraftingVsUiDriftNotes: string[] = [];
  const entries: SegmentAllowanceEntry[] = [];
  const unmappedCuttingSegmentIds: string[] = [];
  const conflictingSeamSegmentIds: string[] = [];

  if (!piece.stitchingContour || !Array.isArray(piece.stitchingContour.segments) || piece.stitchingContour.segments.length === 0) {
    issues.push(`Piece '${piece.pieceCode}' has no authoritative stitchingContour segments to build allowance schedule.`);
    return {
      sourcePieceScalarAllowanceWidthCm: piece.seamAllowanceWidthCm,
      entries: [],
      mappedSegmentCount: 0,
      unmappedSegmentCount: 0,
      unmappedCuttingSegmentIds: [],
      conflictingSeamSegmentIds: [],
      isComplete: false,
      hasContradictions: true,
      issues,
      knownDraftingVsUiDriftNotes
    };
  }

  const seams = Array.isArray(piece.seams) ? piece.seams : [];
  const seenSeamIds = new Set<string>();
  const duplicateSeamIds = new Set<string>();
  for (const seam of seams) {
    if (!seam || typeof seam.id !== 'string' || !seam.id) continue;
    if (seenSeamIds.has(seam.id)) {
      duplicateSeamIds.add(seam.id);
    } else {
      seenSeamIds.add(seam.id);
    }
  }
  if (duplicateSeamIds.size > 0) {
    issues.push(
      `Piece '${piece.pieceCode}' contains duplicate SeamLine IDs: ${Array.from(duplicateSeamIds).join(', ')}.`
    );
  }

  const stitchContour = piece.stitchingContour;
  const cutContour = piece.cuttingContour;
  const allStitchIds = new Set(stitchContour.segments.map(s => s.id));
  const accountedCuttingSegIds = new Set<string>();
  const primaryAllowanceByCutId = new Map<string, number>();

  let unmappedSegmentCount = 0;
  let hasContradictions = duplicateSeamIds.size > 0;

  if (!cutContour || !Array.isArray(cutContour.segments) || cutContour.segments.length === 0) {
    issues.push(`Piece '${piece.pieceCode}' is missing cuttingContour; cut-offset allowances cannot be cross-verified.`);
    hasContradictions = true;
  }

  for (let idx = 0; idx < stitchContour.segments.length; idx++) {
    const seg = stitchContour.segments[idx];
    const seamMatch = findMatchingSeamStrict(seg, seams, duplicateSeamIds);
    const matchedSeam = seamMatch.matchedSeam;
    const edgeRole = inferEdgeRole(seg, matchedSeam);
    const cutCoverage = findMatchingCuttingSegmentsStrict(seg, cutContour, allStitchIds);
    const matchingCutSegs = cutCoverage.matchedSegments;

    for (const c of matchingCutSegs) {
      accountedCuttingSegIds.add(c.id);
      if (typeof c.seamAllowanceCm === 'number' && Number.isFinite(c.seamAllowanceCm)) {
        primaryAllowanceByCutId.set(c.id, c.seamAllowanceCm);
      }
    }

    let validationStatus: AllowanceValidationStatus = seg.isFold ? 'fold-zero-verified' : 'verified';
    let validationNotes: string | undefined;

    if (seamMatch.issue) {
      hasContradictions = true;
      conflictingSeamSegmentIds.push(seg.id);
      validationStatus = 'missing-seam-metadata';
      validationNotes = seamMatch.issue;
      issues.push(seamMatch.issue);
    }

    if (typeof seg.seamAllowanceCm !== 'number' || !Number.isFinite(seg.seamAllowanceCm) || seg.seamAllowanceCm < 0) {
      validationStatus = 'negative-or-non-finite';
      validationNotes = `Authoritative segment '${seg.id}' has invalid seamAllowanceCm (${String(seg.seamAllowanceCm)}).`;
      issues.push(validationNotes);
      hasContradictions = true;
      unmappedSegmentCount++;
    } else if (seg.isFold) {
      if (piece.onFold !== true) {
        validationStatus = 'fold-nonzero-contradiction';
        validationNotes = `Segment '${seg.id}' is marked isFold === true while piece '${piece.pieceCode}' has onFold === false.`;
        issues.push(validationNotes);
        hasContradictions = true;
      } else if (seg.seamAllowanceCm !== 0) {
        validationStatus = 'fold-nonzero-contradiction';
        validationNotes = `Fold segment '${seg.id}' must have 0 cm allowance (found ${seg.seamAllowanceCm} cm).`;
        issues.push(validationNotes);
        hasContradictions = true;
      } else if (
        cutSemantics?.foldEdgeSegmentId &&
        cutSemantics.foldEdgeSegmentId !== seg.id &&
        cutSemantics.pairingMode === 'single-centered-on-fold'
      ) {
        validationStatus = 'fold-nonzero-contradiction';
        validationNotes = `Fold segment '${seg.id}' conflicts with declared foldEdgeSegmentId '${cutSemantics.foldEdgeSegmentId}'.`;
        issues.push(validationNotes);
        hasContradictions = true;
      } else if (cutContour && matchingCutSegs.length === 0) {
        validationStatus = 'fold-nonzero-contradiction';
        validationNotes = `Fold segment '${seg.id}' has no corresponding cutting contour fold segment in piece '${piece.pieceCode}'.`;
        issues.push(validationNotes);
        hasContradictions = true;
        unmappedSegmentCount++;
      } else if (!seamMatch.issue) {
        validationStatus = 'fold-zero-verified';
      }
    } else {
      if (piece.onFold === true && cutSemantics?.foldEdgeSegmentId === seg.id) {
        validationStatus = 'fold-nonzero-contradiction';
        validationNotes = `Segment '${seg.id}' matches foldEdgeSegmentId but seg.isFold is false.`;
        issues.push(validationNotes);
        hasContradictions = true;
      } else if (!matchedSeam && !seg.seamId) {
        validationStatus = 'missing-seam-metadata';
        validationNotes = `Non-fold segment '${seg.id}' has no linked SeamLine entry or seamId in piece '${piece.pieceCode}'.`;
        issues.push(validationNotes);
        unmappedSegmentCount++;
      }
    }

    if (cutCoverage.completenessIssue) {
      validationStatus = 'cutting-allowance-mismatch';
      validationNotes = cutCoverage.completenessIssue;
      issues.push(cutCoverage.completenessIssue);
      hasContradictions = true;
      unmappedSegmentCount++;
    }

    // Cross-check corresponding cutting contour segments in both directions
    if (cutContour && matchingCutSegs.length > 0 && validationStatus !== 'negative-or-non-finite') {
      for (const cutSeg of matchingCutSegs) {
        if (
          typeof cutSeg.seamAllowanceCm !== 'number' ||
          !Number.isFinite(cutSeg.seamAllowanceCm) ||
          cutSeg.seamAllowanceCm < 0
        ) {
          validationStatus = 'negative-or-non-finite';
          validationNotes = `Cutting segment '${cutSeg.id}' has invalid seamAllowanceCm (${String(cutSeg.seamAllowanceCm)}).`;
          issues.push(validationNotes);
          hasContradictions = true;
        } else if (seg.isFold && cutSeg.isFold !== true) {
          validationStatus = 'fold-nonzero-contradiction';
          validationNotes = `Cutting segment '${cutSeg.id}' linked to fold segment '${seg.id}' is not marked isFold === true.`;
          issues.push(validationNotes);
          hasContradictions = true;
        } else if (!seg.isFold && cutSeg.isFold === true) {
          validationStatus = 'fold-nonzero-contradiction';
          validationNotes = `Cutting segment '${cutSeg.id}' is marked isFold === true while stitching segment '${seg.id}' is not a fold.`;
          issues.push(validationNotes);
          hasContradictions = true;
        } else if (Math.abs(cutSeg.seamAllowanceCm - seg.seamAllowanceCm) > ALLOWANCE_MATCH_TOLERANCE_CM) {
          validationStatus = 'cutting-allowance-mismatch';
          validationNotes = `Cutting segment '${cutSeg.id}' allowance (${cutSeg.seamAllowanceCm} cm) contradicts stitching segment '${seg.id}' allowance (${seg.seamAllowanceCm} cm).`;
          issues.push(validationNotes);
          hasContradictions = true;
        } else if (seg.seamId && cutSeg.seamId && cutSeg.seamId !== seg.seamId) {
          validationStatus = 'cutting-allowance-mismatch';
          validationNotes = `Cutting segment '${cutSeg.id}' seamId '${cutSeg.seamId}' contradicts stitching segment '${seg.id}' seamId '${seg.seamId}'.`;
          issues.push(validationNotes);
          hasContradictions = true;
        }
      }
    } else if (
      cutContour &&
      matchingCutSegs.length === 0 &&
      (validationStatus === 'verified' || validationStatus === 'fold-zero-verified')
    ) {
      validationStatus = 'missing-seam-metadata';
      validationNotes = `Stitching segment '${seg.id}' has no traceable cutting contour segment in piece '${piece.pieceCode}'.`;
      issues.push(validationNotes);
      unmappedSegmentCount++;
      hasContradictions = true;
    }

    if (options.uiReportedAllowanceCmByRole && options.uiReportedAllowanceCmByRole[edgeRole] !== undefined) {
      const uiVal = options.uiReportedAllowanceCmByRole[edgeRole];
      if (Number.isFinite(uiVal) && Math.abs(uiVal - seg.seamAllowanceCm) > ALLOWANCE_MATCH_TOLERANCE_CM) {
        knownDraftingVsUiDriftNotes.push(
          `Segment '${seg.id}' (${edgeRole}) authoritative geometry allowance is ${seg.seamAllowanceCm} cm; UI/reported label states ${uiVal} cm (authoritative geometry preserved).`
        );
      }
    }

    entries.push({
      segmentId: seg.id,
      seamId: matchedSeam?.id ?? seg.seamId,
      seamName: matchedSeam?.name,
      sourceSegmentId: seg.sourceSegmentId,
      segmentRole: seg.role,
      edgeRole,
      allowanceCm: seg.seamAllowanceCm,
      isFold: Boolean(seg.isFold),
      matchingCuttingSegmentIds: matchingCutSegs.map(c => c.id),
      sourceGeometryRef: {
        contourType: 'stitching',
        contourId: stitchContour.id,
        segmentIndex: idx,
        segmentId: seg.id,
        seamId: seg.seamId,
        sourceSegmentId: seg.sourceSegmentId
      },
      validationStatus,
      validationNotes
    });
  }

  // Verify every cutting segment in `cuttingContour.segments` is accounted for (either mapped primary or valid corner transition)
  if (cutContour && Array.isArray(cutContour.segments)) {
    const cutSegById = new Map(cutContour.segments.map(c => [c.id, c]));
    const cutSegCount = cutContour.segments.length;

    for (let cIdx = 0; cIdx < cutSegCount; cIdx++) {
      const cutSeg = cutContour.segments[cIdx];
      if (!cutSeg || typeof cutSeg !== 'object') {
        hasContradictions = true;
        issues.push(`Cutting segment[${cIdx}] in piece '${piece.pieceCode}' is malformed.`);
        continue;
      }

      if (accountedCuttingSegIds.has(cutSeg.id)) {
        continue;
      }

      if (isTransitionRole(cutSeg.role)) {
        const src = cutSeg.sourceSegmentId;
        const srcValid = Boolean(src && (allStitchIds.has(src) || cutSegById.has(src)));
        if (!srcValid) {
          unmappedCuttingSegmentIds.push(cutSeg.id);
          hasContradictions = true;
          issues.push(
            `Cutting transition segment '${cutSeg.id}' (role=${String(cutSeg.role)}) has missing or unknown sourceSegmentId '${String(src)}'.`
          );
          continue;
        }

        if (
          typeof cutSeg.seamAllowanceCm !== 'number' ||
          !Number.isFinite(cutSeg.seamAllowanceCm) ||
          cutSeg.seamAllowanceCm < 0
        ) {
          unmappedCuttingSegmentIds.push(cutSeg.id);
          hasContradictions = true;
          issues.push(
            `Cutting transition segment '${cutSeg.id}' has invalid seamAllowanceCm (${String(cutSeg.seamAllowanceCm)}).`
          );
          continue;
        }

        const prevCut = cutContour.segments[(cIdx - 1 + cutSegCount) % cutSegCount];
        const nextCut = cutContour.segments[(cIdx + 1) % cutSegCount];
        const allowedAllowances = [prevCut?.seamAllowanceCm, nextCut?.seamAllowanceCm, src ? primaryAllowanceByCutId.get(src) : undefined].filter(
          (a): a is number => typeof a === 'number' && Number.isFinite(a)
        );
        const matchesNeighbor =
          cutSeg.isFold
            ? cutSeg.seamAllowanceCm === 0
            : allowedAllowances.some(a => Math.abs(cutSeg.seamAllowanceCm - a) <= ALLOWANCE_MATCH_TOLERANCE_CM);

        if (!matchesNeighbor) {
          unmappedCuttingSegmentIds.push(cutSeg.id);
          hasContradictions = true;
          issues.push(
            `Cutting transition segment '${cutSeg.id}' carries unexplained allowance (${cutSeg.seamAllowanceCm} cm) inconsistent with adjacent segments.`
          );
          continue;
        }

        accountedCuttingSegIds.add(cutSeg.id);
      } else {
        unmappedCuttingSegmentIds.push(cutSeg.id);
        hasContradictions = true;
        issues.push(
          `Cutting contour segment '${cutSeg.id}' (sourceSegmentId='${String(cutSeg.sourceSegmentId)}', allowance=${cutSeg.seamAllowanceCm} cm) has no valid lineage to any stitching segment in piece '${piece.pieceCode}'.`
        );
      }
    }
  }

  const nonFoldEntries = entries.filter(e => !e.isFold && Number.isFinite(e.allowanceCm));
  if (nonFoldEntries.some(e => Math.abs(e.allowanceCm - piece.seamAllowanceWidthCm) > ALLOWANCE_MATCH_TOLERANCE_CM)) {
    knownDraftingVsUiDriftNotes.push(
      `Piece '${piece.pieceCode}' carries mixed segment allowances while scalar piece.seamAllowanceWidthCm is ${piece.seamAllowanceWidthCm} cm; segment-level allowances govern cutting geometry.`
    );
  }

  const isComplete =
    !hasContradictions &&
    unmappedSegmentCount === 0 &&
    unmappedCuttingSegmentIds.length === 0 &&
    conflictingSeamSegmentIds.length === 0 &&
    entries.length === stitchContour.segments.length;

  return {
    sourcePieceScalarAllowanceWidthCm: piece.seamAllowanceWidthCm,
    entries,
    mappedSegmentCount: entries.length - unmappedSegmentCount,
    unmappedSegmentCount,
    unmappedCuttingSegmentIds,
    conflictingSeamSegmentIds,
    isComplete,
    hasContradictions,
    issues,
    knownDraftingVsUiDriftNotes
  };
}

/**
 * Computes deterministic, numerically documented geometry metrics from authoritative
 * stitching and cutting contours without reconstructing pattern geometry.
 */
export function computePieceGeometryMetrics(
  piece: PatternPieceSnapshot,
  cutSemantics?: PatternPieceCutSemantics
): PatternPieceGeometryMetrics {
  const errors: string[] = [];

  const stitchAnalysis = analyzeContourGeometry(piece.stitchingContour, 'stitchingContour');
  const cutAnalysis = analyzeContourGeometry(piece.cuttingContour, 'cuttingContour');

  errors.push(...stitchAnalysis.errors);
  errors.push(...cutAnalysis.errors);

  const pbb = piece.boundingBox;
  if (
    !pbb ||
    !Number.isFinite(pbb.minX) ||
    !Number.isFinite(pbb.minY) ||
    !Number.isFinite(pbb.maxX) ||
    !Number.isFinite(pbb.maxY) ||
    !Number.isFinite(pbb.widthCm) ||
    !Number.isFinite(pbb.heightCm) ||
    pbb.widthCm <= 0 ||
    pbb.heightCm <= 0 ||
    Math.abs(pbb.widthCm - (pbb.maxX - pbb.minX)) > 0.03 ||
    Math.abs(pbb.heightCm - (pbb.maxY - pbb.minY)) > 0.03
  ) {
    errors.push(
      `Piece '${piece.pieceCode}' has invalid or non-positive boundingBox (${pbb?.widthCm} x ${pbb?.heightCm}).`
    );
  } else {
    const refBox = cutAnalysis.isValid
      ? cutAnalysis.boundingBox
      : piece.cuttingContour
        ? computeExactContourBoundingBox(piece.cuttingContour.segments)
        : stitchAnalysis.boundingBox;
    if (
      refBox.widthCm > 0 &&
      (Math.abs(pbb.minX - refBox.minX) > BOUNDING_BOX_CONSISTENCY_TOLERANCE_CM ||
        Math.abs(pbb.minY - refBox.minY) > BOUNDING_BOX_CONSISTENCY_TOLERANCE_CM ||
        Math.abs(pbb.maxX - refBox.maxX) > BOUNDING_BOX_CONSISTENCY_TOLERANCE_CM ||
        Math.abs(pbb.maxY - refBox.maxY) > BOUNDING_BOX_CONSISTENCY_TOLERANCE_CM)
    ) {
      errors.push(
        `Piece '${piece.pieceCode}' boundingBox (${pbb.widthCm}x${pbb.heightCm} cm) diverges from authoritative cutting contour extrema (${refBox.widthCm.toFixed(2)}x${refBox.heightCm.toFixed(2)} cm).`
      );
    }
  }

  // Stitching vs cutting geometric consistency: winding parity, area expansion, containment, and normal offsets
  if (stitchAnalysis.areaCm2 > 0 && cutAnalysis.areaCm2 > 0 && piece.stitchingContour && piece.cuttingContour) {
    if (Math.sign(stitchAnalysis.signedAreaCm2) !== Math.sign(cutAnalysis.signedAreaCm2)) {
      errors.push(
        `Piece '${piece.pieceCode}' cuttingContour winding diverges from stitchingContour winding.`
      );
    }

    const hasPositiveAllowance = piece.stitchingContour.segments.some(
      s => !s.isFold && typeof s.seamAllowanceCm === 'number' && s.seamAllowanceCm > ALLOWANCE_MATCH_TOLERANCE_CM
    );
    if (hasPositiveAllowance && cutAnalysis.areaCm2 <= stitchAnalysis.areaCm2) {
      errors.push(
        `Piece '${piece.pieceCode}' cuttingContour area (${cutAnalysis.areaCm2} cm2) must strictly exceed stitchingContour area (${stitchAnalysis.areaCm2} cm2) for positive seam allowances; inward/shrunk cutting contour detected.`
      );
    } else if (!hasPositiveAllowance && cutAnalysis.areaCm2 < stitchAnalysis.areaCm2 - CONTOUR_CLOSURE_TOLERANCE_CM) {
      errors.push(
        `Piece '${piece.pieceCode}' cuttingContour area (${cutAnalysis.areaCm2} cm2) is smaller than stitchingContour area (${stitchAnalysis.areaCm2} cm2).`
      );
    }

    // Verify stitching boundary lies inside or on boundary of cutting contour
    if (
      stitchAnalysis.areaFlatteningToleranceAchieved &&
      cutAnalysis.areaFlatteningToleranceAchieved &&
      cutAnalysis.sampledBoundaryPoints.length >= 3
    ) {
      for (const sPt of stitchAnalysis.sampledBoundaryPoints) {
        if (!isPointInsideOrOnPolygonBoundary(sPt, cutAnalysis.sampledBoundaryPoints, CONTOUR_CLOSURE_TOLERANCE_CM)) {
          errors.push(
            `Piece '${piece.pieceCode}' stitchingContour extends outside cuttingContour around (${sPt.x.toFixed(2)}, ${sPt.y.toFixed(2)}).`
          );
          break;
        }
      }
    }

    // Continuous adaptive outward-normal offset verification over [0, 1] per mapped segment
    const outwardSign = stitchAnalysis.signedAreaCm2 < 0 ? 1 : -1;
    const allStitchIds = new Set(piece.stitchingContour.segments.map(s => s.id));
    for (const stSeg of piece.stitchingContour.segments) {
      if (stSeg.isFold || typeof stSeg.seamAllowanceCm !== 'number' || stSeg.seamAllowanceCm <= ALLOWANCE_MATCH_TOLERANCE_CM) {
        continue;
      }
      const coverage = findMatchingCuttingSegmentsStrict(stSeg, piece.cuttingContour, allStitchIds);
      if (coverage.completenessIssue) {
        errors.push(coverage.completenessIssue);
      }
      for (let mIdx = 0; mIdx < coverage.matchedSegments.length; mIdx++) {
        const cutSeg = coverage.matchedSegments[mIdx];
        if (!isFinitePoint(cutSeg.start) || !isFinitePoint(cutSeg.end)) continue;
        const lrPath = coverage.isSubdividedBezierTree ? (coverage.lrPaths[mIdx] ?? '') : '';
        verifyContinuousOffsetForMappedSegment(
          stSeg,
          cutSeg,
          lrPath,
          outwardSign,
          errors
        );
      }
    }
  }

  let halfPatternBoundingWidthCm: number | null | undefined;
  let unfoldedWidthCm: number | null | undefined;
  let unfoldedStitchingWidthCm: number | null | undefined;

  if (cutSemantics?.pairingMode === 'single-centered-on-fold') {
    const foldSeg = cutSemantics.foldEdgeSegmentId
      ? piece.stitchingContour?.segments.find(s => s.id === cutSemantics.foldEdgeSegmentId)
      : undefined;
    if (!foldSeg || !isFinitePoint(foldSeg.start) || !isFinitePoint(foldSeg.end)) {
      errors.push(
        `Piece '${piece.pieceCode}' is declared single-centered-on-fold without a valid stitching fold segment.`
      );
      halfPatternBoundingWidthCm = null;
      unfoldedWidthCm = null;
      unfoldedStitchingWidthCm = null;
    } else {
      const fLen = pointDistance(foldSeg.start, foldSeg.end);
      if (fLen < MIN_FOLD_EDGE_LENGTH_CM) {
        errors.push(
          `Piece '${piece.pieceCode}' fold edge '${foldSeg.id}' length (${fLen.toFixed(4)} cm) is below minimum (${MIN_FOLD_EDGE_LENGTH_CM} cm); fold-axis validation cannot be bypassed.`
        );
        halfPatternBoundingWidthCm = null;
        unfoldedWidthCm = null;
        unfoldedStitchingWidthCm = null;
      } else {
        const dx = (foldSeg.end.x - foldSeg.start.x) / fLen;
        const dy = (foldSeg.end.y - foldSeg.start.y) / fLen;
        const signedDistToFold = (pt: Point): number =>
          (pt.x - foldSeg.start.x) * -dy + (pt.y - foldSeg.start.y) * dx;

        let cutMinSigned = Infinity;
        let cutMaxSigned = -Infinity;
        let maxAbsCutDist = 0;
        for (const pt of cutAnalysis.sampledBoundaryPoints) {
          const signed = signedDistToFold(pt);
          if (signed < cutMinSigned) cutMinSigned = signed;
          if (signed > cutMaxSigned) cutMaxSigned = signed;
          const absD = Math.abs(signed);
          if (absD > maxAbsCutDist) maxAbsCutDist = absD;
        }
        if (cutMinSigned < -CONTOUR_CLOSURE_TOLERANCE_CM && cutMaxSigned > CONTOUR_CLOSURE_TOLERANCE_CM) {
          errors.push(
            `Piece '${piece.pieceCode}' half-pattern cutting geometry crosses fold axis '${foldSeg.id}' (signed span [${cutMinSigned.toFixed(3)}, ${cutMaxSigned.toFixed(3)}] cm).`
          );
        }

        let stitchMinSigned = Infinity;
        let stitchMaxSigned = -Infinity;
        let maxAbsStitchDist = 0;
        for (const pt of stitchAnalysis.sampledBoundaryPoints) {
          const signed = signedDistToFold(pt);
          if (signed < stitchMinSigned) stitchMinSigned = signed;
          if (signed > stitchMaxSigned) stitchMaxSigned = signed;
          const absD = Math.abs(signed);
          if (absD > maxAbsStitchDist) maxAbsStitchDist = absD;
        }
        if (stitchMinSigned < -CONTOUR_CLOSURE_TOLERANCE_CM && stitchMaxSigned > CONTOUR_CLOSURE_TOLERANCE_CM) {
          errors.push(
            `Piece '${piece.pieceCode}' half-pattern stitching geometry crosses fold axis '${foldSeg.id}' (signed span [${stitchMinSigned.toFixed(3)}, ${stitchMaxSigned.toFixed(3)}] cm).`
          );
        }

        // Verify fold cutting segment lies collinearly along the stitching fold axis
        const cutFoldSegs = (piece.cuttingContour?.segments ?? []).filter(
          c => c.isFold && c.sourceSegmentId === foldSeg.id && !isTransitionRole(c.role)
        );
        for (const cf of cutFoldSegs) {
          if (isFinitePoint(cf.start) && isFinitePoint(cf.end)) {
            const dStart = Math.abs(signedDistToFold(cf.start));
            const dEnd = Math.abs(signedDistToFold(cf.end));
            if (dStart > CONTOUR_CLOSURE_TOLERANCE_CM || dEnd > CONTOUR_CLOSURE_TOLERANCE_CM) {
              errors.push(
                `Cutting fold segment '${cf.id}' diverges from fold axis '${foldSeg.id}' by ${Math.max(dStart, dEnd).toFixed(4)} cm.`
              );
            }
          }
        }

        halfPatternBoundingWidthCm = cutAnalysis.sampledBoundaryPoints.length >= 2 ? round4(maxAbsCutDist) : null;
        unfoldedWidthCm = cutAnalysis.sampledBoundaryPoints.length >= 2 ? round4(2 * maxAbsCutDist) : null;
        unfoldedStitchingWidthCm =
          stitchAnalysis.sampledBoundaryPoints.length >= 2 ? round4(2 * maxAbsStitchDist) : null;
      }
    }
  }

  const hasBezier = stitchAnalysis.hasBezier || cutAnalysis.hasBezier;
  const perimeterActualMaxDepth = Math.max(
    stitchAnalysis.perimeterActualMaxDepth,
    cutAnalysis.perimeterActualMaxDepth
  );
  const perimeterMaxDepthReached =
    stitchAnalysis.perimeterMaxDepthReached || cutAnalysis.perimeterMaxDepthReached;
  const worstBezierErrorBoundCm = Math.max(
    stitchAnalysis.worstBezierErrorBoundCm,
    cutAnalysis.worstBezierErrorBoundCm
  );
  const allLengthTolerancesAchieved =
    stitchAnalysis.allLengthTolerancesAchieved && cutAnalysis.allLengthTolerancesAchieved;

  const areaActualMaxDepth = Math.max(stitchAnalysis.areaActualMaxDepth, cutAnalysis.areaActualMaxDepth);
  const areaMaxDepthReached = stitchAnalysis.areaMaxDepthReached || cutAnalysis.areaMaxDepthReached;
  const areaWorstResidualFlatnessCm = Math.max(
    stitchAnalysis.areaWorstResidualFlatnessCm,
    cutAnalysis.areaWorstResidualFlatnessCm
  );
  const areaFlatteningToleranceAchieved =
    stitchAnalysis.areaFlatteningToleranceAchieved && cutAnalysis.areaFlatteningToleranceAchieved;

  const stitchingAreaUpperBoundCm2 = stitchAnalysis.areaUpperBoundCm2;
  const cuttingAreaUpperBoundCm2 = cutAnalysis.areaUpperBoundCm2;
  const combinedBound =
    Number.isFinite(stitchingAreaUpperBoundCm2) && Number.isFinite(cuttingAreaUpperBoundCm2)
      ? preservePositiveErrorBound(stitchingAreaUpperBoundCm2 + cuttingAreaUpperBoundCm2)
      : NaN;

  const stitchingPerimeterUpperBoundCm = stitchAnalysis.perimeterTotalErrorBoundCm;
  const cuttingPerimeterUpperBoundCm = cutAnalysis.perimeterTotalErrorBoundCm;
  const combinedPerimeterBoundCm =
    Number.isFinite(stitchingPerimeterUpperBoundCm) && Number.isFinite(cuttingPerimeterUpperBoundCm)
      ? preservePositiveErrorBound(stitchingPerimeterUpperBoundCm + cuttingPerimeterUpperBoundCm)
      : NaN;

  const numericalPrecision: BezierNumericalPrecisionMetadata = {
    hasBezierSegments: hasBezier,
    perimeterMethod: hasBezier ? 'adaptive-de-casteljau-subdivision' : 'exact-euclidean',
    perimeterToleranceCm: BEZIER_PERIMETER_TOLERANCE_CM,
    perimeterMaxSubdivisionDepth: BEZIER_PERIMETER_MAX_DEPTH,
    perimeterActualMaxDepth,
    perimeterMaxDepthReached,
    perimeterWorstErrorBoundCm: worstBezierErrorBoundCm,
    stitchingPerimeterUpperBoundCm,
    cuttingPerimeterUpperBoundCm,
    perimeterTotalErrorBoundCm: combinedPerimeterBoundCm,
    perimeterAllTolerancesAchieved: allLengthTolerancesAchieved,
    areaMethod: hasBezier ? 'exact-greens-theorem-cubic-bezier' : 'exact-shoelace-polygon',
    areaFlatnessToleranceCm: BEZIER_AREA_FLATNESS_TOLERANCE_CM,
    areaMaxSubdivisionDepth: BEZIER_AREA_MAX_SUBDIVISION_DEPTH,
    areaActualMaxDepth,
    areaMaxDepthReached,
    areaWorstResidualFlatnessCm,
    areaFlatteningToleranceAchieved,
    stitchingAreaUpperBoundCm2,
    cuttingAreaUpperBoundCm2,
    areaApproximationUpperBoundCm2: combinedBound,
    // Overall metric bundle is only purely symbolic/closed-form exact when no Bézier perimeter approximation is present.
    isExact: !hasBezier,
    documentationNote: hasBezier
      ? `Cubic Bézier perimeters computed via full-precision De Casteljau adaptive subdivision (tol=${BEZIER_PERIMETER_TOLERANCE_CM} cm, maxDepth=${BEZIER_PERIMETER_MAX_DEPTH}; fail closed on non-convergence). perimeterWorstErrorBoundCm tracks the worst individual segment bound; stitchingPerimeterUpperBoundCm, cuttingPerimeterUpperBoundCm, and perimeterTotalErrorBoundCm report aggregated whole-contour bounds. Contour areas are returned at full IEEE-754 precision via centered Green's-theorem Bernstein cross-product integration (with strict non-truncated upper bounds); continuous offset integrity verified over [0, 1] via adaptive subdivision.`
      : `Line-only contour: full-precision Euclidean edge summation and centered Shoelace polygon area are reported without output quantization; non-integer coordinates and non-dyadic centroids carry conservative binary64 bounds.`
  };

  const isValid = errors.length === 0;
  return {
    unit: 'cm',
    areaUnit: 'cm2',
    isValid,
    stitchingPerimeterCm: stitchAnalysis.isValid ? stitchAnalysis.perimeterCm : null,
    cuttingPerimeterCm: cutAnalysis.isValid ? cutAnalysis.perimeterCm : null,
    cuttingAreaCm2: cutAnalysis.isValid ? cutAnalysis.areaCm2 : null,
    stitchingAreaCm2: stitchAnalysis.isValid ? stitchAnalysis.areaCm2 : null,
    boundingWidthCm: cutAnalysis.isValid && cutAnalysis.boundingWidthCm > 0 ? cutAnalysis.boundingWidthCm : null,
    boundingHeightCm: cutAnalysis.isValid && cutAnalysis.boundingHeightCm > 0 ? cutAnalysis.boundingHeightCm : null,
    ...(halfPatternBoundingWidthCm !== undefined ? { halfPatternBoundingWidthCm } : {}),
    ...(unfoldedWidthCm !== undefined ? { unfoldedWidthCm } : {}),
    ...(unfoldedStitchingWidthCm !== undefined ? { unfoldedStitchingWidthCm } : {}),
    numericalPrecision,
    errors
  };
}

function toContourSummary(contour: GeometricContourSnapshot | undefined): ContourReferenceSummary | null {
  if (!contour) return null;
  return {
    contourId: contour.id,
    isClosed: contour.isClosed,
    segmentCount: Array.isArray(contour.segments) ? contour.segments.length : 0,
    recordedTotalLengthCm: contour.totalLengthCm,
    boundingBox: contour.boundingBox
  };
}

/**
 * Computes the deterministic SHA-256 content fingerprint of a `PatternPieceProductionSheet`.
 * Separates immutable manufacturing content (including contour summaries and order quantity basis)
 * from volatile timestamps (`generatedAt`) and validation/approval envelopes.
 */
export function computePieceProductionSheetContentFingerprint(
  sheet: Omit<PatternPieceProductionSheet, 'sheetContentFingerprint' | 'validation' | 'generatedAt'>
): string {
  const payload = {
    schemaVersion: sheet.schemaVersion,
    sheetId: sheet.sheetId,
    sourceProjectId: sheet.sourceProjectId,
    sourceTenantId: sheet.sourceTenantId ?? null,
    sourceGarmentId: sheet.sourceGarmentId,
    sourcePatternRevisionId: sheet.sourcePatternRevisionId,
    sourcePatternRevisionNumber: sheet.sourcePatternRevisionNumber,
    sourcePatternContentFingerprint: sheet.sourcePatternContentFingerprint,
    sourceGeometryFingerprint: sheet.sourceGeometryFingerprint,
    gradingMode: sheet.gradingMode,
    sourceGradingArtifactId: sheet.sourceGradingArtifactId ?? null,
    sourceGradingRevisionId: sheet.sourceGradingRevisionId ?? null,
    sourceGradingArtifactFingerprint: sheet.sourceGradingArtifactFingerprint ?? null,
    pieceId: sheet.pieceId,
    pieceCode: sheet.pieceCode,
    pieceName: sheet.pieceName,
    sizeCode: sheet.sizeCode,
    garmentCategory: sheet.garmentCategory,
    material: sheet.material,
    pieceGeometryFingerprint: sheet.pieceGeometryFingerprint,
    sourceEngineProvenance: sheet.sourceEngineProvenance,
    stitchingContour: sheet.stitchingContour,
    stitchingContourSummary: sheet.stitchingContourSummary,
    cuttingContour: sheet.cuttingContour,
    cuttingContourSummary: sheet.cuttingContourSummary,
    grainline: sheet.grainline,
    notches: sheet.notches,
    darts: sheet.darts,
    drillHoles: sheet.drillHoles,
    seamReferences: sheet.seamReferences,
    cutSemantics: sheet.cutSemantics,
    orderQuantityBasis: sheet.orderQuantityBasis,
    allowanceSchedule: sheet.allowanceSchedule,
    geometryMetrics: sheet.geometryMetrics,
    isProductionReady: sheet.isProductionReady
  };
  return computeCanonicalFingerprint(payload);
}

/**
 * Computes the deterministic SHA-256 content fingerprint of an `AuthoritativePieceProductionSheetSet`.
 * Excludes volatile timestamps and validation wrappers.
 */
export function computePieceProductionSheetSetContentFingerprint(
  sheetSet: Omit<AuthoritativePieceProductionSheetSet, 'sheetSetContentFingerprint' | 'validation' | 'generatedAt'>
): string {
  const payload = {
    schemaVersion: sheetSet.schemaVersion,
    sheetSetId: sheetSet.sheetSetId,
    sourceProjectId: sheetSet.sourceProjectId,
    sourceTenantId: sheetSet.sourceTenantId ?? null,
    sourceGarmentId: sheetSet.sourceGarmentId,
    sourcePatternRevisionId: sheetSet.sourcePatternRevisionId,
    sourcePatternRevisionNumber: sheetSet.sourcePatternRevisionNumber,
    sourcePatternContentFingerprint: sheetSet.sourcePatternContentFingerprint,
    sourceGeometryFingerprint: sheetSet.sourceGeometryFingerprint,
    gradingMode: sheetSet.gradingMode,
    nonGradingReason: sheetSet.nonGradingReason ?? null,
    sourceGradingArtifactId: sheetSet.sourceGradingArtifactId ?? null,
    sourceGradingRevisionId: sheetSet.sourceGradingRevisionId ?? null,
    sourceGradingArtifactFingerprint: sheetSet.sourceGradingArtifactFingerprint ?? null,
    baseSize: sheetSet.baseSize,
    includedSizes: sheetSet.includedSizes,
    expectedPieceCodes: sheetSet.expectedPieceCodes,
    perSizeSheetDigests: Object.fromEntries(
      Object.entries(sheetSet.sheetsBySize)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sz, sheets]) => [
          sz,
          sheets.map(s => ({
            pieceId: s.pieceId,
            pieceCode: s.pieceCode,
            sizeCode: s.sizeCode,
            pieceGeometryFingerprint: s.pieceGeometryFingerprint,
            sheetContentFingerprint: s.sheetContentFingerprint
          }))
        ])
    ),
    totalSheetsCount: sheetSet.totalSheetsCount,
    totalPhysicalPanelsAcrossSizesForOrder: sheetSet.totalPhysicalPanelsAcrossSizesForOrder,
    orderQuantityBasis: sheetSet.orderQuantityBasis,
    isProductionReady: sheetSet.isProductionReady
  };
  return computeCanonicalFingerprint(payload);
}

function validateGradingArtifactBindingsToRevision(
  ga: AuthoritativeGradingArtifact,
  rev: AuthoritativePatternRevision,
  rejectionCodes: PieceProductionSheetRejectionCode[],
  errors: string[],
  expectedProjectId?: string,
  expectedTenantId?: string
): void {
  const gaCheck = verifyGradingArtifactIntegrity(ga);
  if (!gaCheck.isValid) {
    rejectionCodes.push(
      gaCheck.isSizeRangeIncomplete ? 'GRADING_SIZE_INCOMPLETE' : 'GRADING_ARTIFACT_INVALID'
    );
    errors.push(...gaCheck.errors);
  }

  if (expectedProjectId && ga.projectId !== expectedProjectId) {
    rejectionCodes.push('CROSS_PROJECT_MISMATCH');
    errors.push(`Grading artifact projectId '${ga.projectId}' !== '${expectedProjectId}'.`);
  }
  if (expectedTenantId && ga.tenantId !== expectedTenantId) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push(`Grading artifact tenantId '${ga.tenantId}' !== '${expectedTenantId}'.`);
  }
  if (ga.projectId !== rev.projectId) {
    rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
    errors.push(`Grading artifact projectId '${ga.projectId}' diverges from patternRevision '${rev.projectId}'.`);
  }

  const revBaseFp = rev.basePatternFingerprint ?? rev.contentFingerprint ?? rev.canonicalFingerprint;
  if (ga.sourcePatternRevisionId !== rev.revisionId) {
    rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
    errors.push(
      `Grading artifact sourcePatternRevisionId '${ga.sourcePatternRevisionId}' !== '${rev.revisionId}'.`
    );
  }
  if (ga.sourceBasePatternFingerprint && ga.sourceBasePatternFingerprint !== revBaseFp) {
    rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
    errors.push('Grading artifact sourceBasePatternFingerprint diverges from pattern revision basePatternFingerprint.');
  }
  if (rev.sourceSpecificationFingerprint && ga.sourceSpecificationFingerprint !== rev.sourceSpecificationFingerprint) {
    rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
    errors.push('Grading artifact sourceSpecificationFingerprint diverges from pattern revision.');
  }
  if (rev.sourceMeasurementSetFingerprint && ga.sourceMeasurementSetFingerprint !== rev.sourceMeasurementSetFingerprint) {
    rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
    errors.push('Grading artifact sourceMeasurementSetFingerprint diverges from pattern revision.');
  }
  if (ga.baseSize !== rev.targetSize || !ga.sizeRange.includes(rev.targetSize)) {
    rejectionCodes.push('GRADING_SIZE_INCOMPLETE');
    errors.push(`Grading artifact baseSize '${ga.baseSize}' disagrees with patternRevision targetSize '${rev.targetSize}'.`);
  }
}

/**
 * Builds a canonical `PatternPieceProductionSheet` directly from an authoritative pattern revision
 * and a verified member `PatternPieceSnapshot`.
 */
export function buildPatternPieceProductionSheet(
  params: BuildSinglePieceProductionSheetParams
): PatternPieceProductionSheet {
  const rev = params.patternRevision;
  const piece = params.piece;
  const rejectionCodes: PieceProductionSheetRejectionCode[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if ((rev as unknown as { isProductionReady: boolean })?.isProductionReady !== false) {
    rejectionCodes.push('INDUSTRIAL_SAFETY_VIOLATION');
    errors.push('Industrial safety violation: source patternRevision must preserve isProductionReady === false.');
  }

  const revCheck = verifyPatternRevisionLifecycleIntegrity(rev);
  if (!revCheck.isValid) {
    rejectionCodes.push(revCheck.isContentTampered ? 'PATTERN_REVISION_TAMPERED' : 'PATTERN_REVISION_INVALID');
    errors.push(...revCheck.errors);
  }

  const generatedAt = params.generatedAt ?? new Date().toISOString();
  if (!isStrictValidIsoTimestamp(generatedAt)) {
    rejectionCodes.push('TIMESTAMP_INVALID');
    errors.push(`Invalid generatedAt ISO-8601 timestamp '${String(params.generatedAt)}'.`);
  }

  const sourceGarmentId = rev?.sourceSpecificationId ?? rev?.designSpecification?.id ?? '';
  if (params.expectedProjectId && rev?.projectId !== params.expectedProjectId) {
    rejectionCodes.push('CROSS_PROJECT_MISMATCH');
    errors.push(`Project mismatch: pattern revision belongs to '${rev?.projectId}', expected '${params.expectedProjectId}'.`);
  }
  if (params.expectedGarmentId && sourceGarmentId !== params.expectedGarmentId) {
    rejectionCodes.push('CROSS_GARMENT_MISMATCH');
    errors.push(`Garment mismatch: pattern revision belongs to '${sourceGarmentId}', expected '${params.expectedGarmentId}'.`);
  }
  if (params.expectedTenantId !== undefined && params.expectedTenantId.trim().length === 0) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push('Authoritative expectedTenantId must be a non-empty string.');
  }
  if (
    params.expectedTenantId &&
    params.gradingArtifact?.tenantId &&
    params.gradingArtifact.tenantId !== params.expectedTenantId
  ) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push(
      `Tenant mismatch: grading artifact belongs to '${params.gradingArtifact.tenantId}', expected '${params.expectedTenantId}'.`
    );
  }

  // Enforce authoritative membership in `patternRevision.patternPieces` (and `gradingArtifact` when graded)
  const revPieces = Array.isArray(rev?.patternPieces) ? rev.patternPieces : [];
  const suppliedPieceFp = computePieceGeometryFingerprint(piece);
  const matchingBaseByCode = revPieces.filter(p => p.pieceCode === piece.pieceCode);

  if (params.gradingMode === 'single-size-ungraded') {
    if (params.gradingArtifact) {
      rejectionCodes.push('GRADING_POLICY_INVALID');
      errors.push('gradingArtifact must not be passed with gradingMode === "single-size-ungraded".');
    }
    const member = revPieces.find(
      p => p.id === piece.id && p.pieceCode === piece.pieceCode && p.sizeCode === piece.sizeCode
    );
    if (!member) {
      rejectionCodes.push('FOREIGN_PIECE_NOT_IN_REVISION');
      errors.push(
        `Foreign or unlinked piece '${piece.pieceCode}' (${piece.id}, size '${piece.sizeCode}') is not a member of patternRevision '${rev?.revisionId}'.`
      );
    } else if (computePieceGeometryFingerprint(member) !== suppliedPieceFp) {
      rejectionCodes.push('FOREIGN_PIECE_NOT_IN_REVISION');
      errors.push(
        `Supplied piece '${piece.pieceCode}' diverges from authoritative geometry inside patternRevision '${rev?.revisionId}'.`
      );
    }
  } else {
    // graded-multi-size
    if (!params.gradingArtifact) {
      rejectionCodes.push(
        rev?.garmentCategory === 'skirt'
          ? 'SKIRT_GRADING_UNSUPPORTED_WITHOUT_ARTIFACT'
          : 'GRADING_ARTIFACT_MISSING'
      );
      errors.push('AuthoritativeGradingArtifact is required to build a graded piece production sheet.');
    } else {
      validateGradingArtifactBindingsToRevision(
        params.gradingArtifact,
        rev,
        rejectionCodes,
        errors,
        params.expectedProjectId,
        params.expectedTenantId
      );
      if (matchingBaseByCode.length !== 1) {
        rejectionCodes.push('FOREIGN_PIECE_NOT_IN_REVISION');
        errors.push(
          `Graded piece '${piece.pieceCode}' has no unique matching base piece in patternRevision '${rev?.revisionId}'.`
        );
      }
      const gradedCandidates = (params.gradingArtifact.perSizePatternGeometry?.[piece.sizeCode] ?? []).filter(
        gp => gp.id === piece.id && gp.pieceCode === piece.pieceCode && gp.sizeCode === piece.sizeCode
      );
      if (gradedCandidates.length !== 1) {
        rejectionCodes.push('FOREIGN_PIECE_NOT_IN_REVISION');
        errors.push(
          `Graded piece '${piece.pieceCode}' (${piece.id}, size '${piece.sizeCode}') is not a unique member of gradingArtifact '${params.gradingArtifact.gradingArtifactId}'.`
        );
      } else if (computePieceGeometryFingerprint(gradedCandidates[0]) !== suppliedPieceFp) {
        rejectionCodes.push('FOREIGN_PIECE_NOT_IN_REVISION');
        errors.push(
          `Supplied piece '${piece.pieceCode}' (${piece.sizeCode}) diverges from authoritative gradingArtifact geometry.`
        );
      }
    }
  }

  const cutSemantics = resolveCutQuantitySemantics(piece, {
    declaration: params.cutSemanticsDeclaration,
    garmentUnitQuantity: params.garmentUnitQuantity
  });
  if (cutSemantics.semanticResolutionStatus === 'unresolved') {
    rejectionCodes.push('CUT_SEMANTICS_UNRESOLVED');
    errors.push(...cutSemantics.contradictionReasons);
  } else if (cutSemantics.semanticResolutionStatus === 'invalid') {
    rejectionCodes.push('CUT_SEMANTICS_CONTRADICTION');
    errors.push(...cutSemantics.contradictionReasons);
  }

  const allowanceSchedule = buildPieceAllowanceSchedule(piece, cutSemantics, {
    uiReportedAllowanceCmByRole: params.uiReportedAllowanceCmByRole
  });
  if (!allowanceSchedule.isComplete || allowanceSchedule.hasContradictions) {
    rejectionCodes.push('ALLOWANCE_SCHEDULE_INVALID');
    errors.push(...allowanceSchedule.issues);
  }
  if (allowanceSchedule.knownDraftingVsUiDriftNotes.length > 0) {
    warnings.push(...allowanceSchedule.knownDraftingVsUiDriftNotes);
  }

  const geometryMetrics = computePieceGeometryMetrics(piece, cutSemantics);
  if (!geometryMetrics.isValid) {
    rejectionCodes.push('GEOMETRY_INVALID');
    errors.push(...geometryMetrics.errors);
  }

  const sourcePatternContentFingerprint =
    rev?.basePatternFingerprint ?? rev?.contentFingerprint ?? rev?.canonicalFingerprint ?? '';
  const sourceGeometryFingerprint = rev?.geometryFingerprint ?? '';

  const sheetBase: Omit<PatternPieceProductionSheet, 'sheetContentFingerprint' | 'validation' | 'generatedAt'> = {
    schemaVersion: MANUFACTURING_PIECE_SHEET_SCHEMA_VERSION,
    sheetId:
      params.sheetId ??
      `mfg-sheet:${rev.revisionId}:${piece.sizeCode}:${piece.pieceCode}`,
    sourceProjectId: rev.projectId,
    ...(params.expectedTenantId || params.gradingArtifact?.tenantId
      ? { sourceTenantId: params.expectedTenantId ?? params.gradingArtifact?.tenantId }
      : {}),
    sourceGarmentId,
    sourcePatternRevisionId: rev.revisionId,
    sourcePatternRevisionNumber: rev.revisionIndex,
    sourcePatternContentFingerprint,
    sourceGeometryFingerprint,
    gradingMode: params.gradingMode,
    ...(params.gradingArtifact
      ? {
          sourceGradingArtifactId: params.gradingArtifact.gradingArtifactId,
          sourceGradingRevisionId: params.gradingArtifact.gradingRevisionId,
          sourceGradingArtifactFingerprint: params.gradingArtifact.canonicalFingerprint
        }
      : {}),
    pieceId: piece.id,
    pieceCode: piece.pieceCode,
    pieceName: piece.name,
    sizeCode: piece.sizeCode,
    garmentCategory: piece.garmentCategory,
    material: piece.material,
    pieceGeometryFingerprint: suppliedPieceFp,
    sourceEngineProvenance: rev.engineProvenance,
    stitchingContour: piece.stitchingContour ?? null,
    stitchingContourSummary: toContourSummary(piece.stitchingContour),
    cuttingContour: piece.cuttingContour ?? null,
    cuttingContourSummary: toContourSummary(piece.cuttingContour),
    grainline: piece.grainline,
    notches: piece.notches ?? [],
    darts: piece.darts ?? [],
    drillHoles: piece.drillHoles ?? [],
    seamReferences: piece.seams ?? [],
    cutSemantics,
    orderQuantityBasis: cutSemantics.orderQuantityBasis,
    allowanceSchedule,
    geometryMetrics,
    isProductionReady: false
  };

  const sheetContentFingerprint = computePieceProductionSheetContentFingerprint(sheetBase);
  const validation: PieceProductionSheetValidationResult = {
    isValid: rejectionCodes.length === 0 && errors.length === 0,
    rejectionCodes: Array.from(new Set(rejectionCodes)),
    errors,
    warnings
  };

  return {
    ...sheetBase,
    sheetContentFingerprint,
    validation,
    generatedAt
  };
}

function computeSizeAgnosticGeometryKey(piece: PatternPieceSnapshot): string {
  return computeCanonicalFingerprint({
    pieceCode: piece.pieceCode,
    material: piece.material,
    cutPathData: piece.cutPathData,
    sewPathData: piece.sewPathData,
    stitchingContour: piece.stitchingContour ?? null,
    cuttingContour: piece.cuttingContour ?? null,
    darts: piece.darts,
    notches: piece.notches
  });
}

function computeSheetSizeAgnosticGeometryKey(sheet: PatternPieceProductionSheet): string {
  return computeCanonicalFingerprint({
    pieceCode: sheet.pieceCode,
    material: sheet.material,
    stitchingContour: sheet.stitchingContour ?? null,
    cuttingContour: sheet.cuttingContour ?? null,
    darts: sheet.darts,
    notches: sheet.notches
  });
}

/**
 * Builds an authoritative set of `PatternPieceProductionSheet`s across either a verified
 * `'single-size-ungraded'` pattern revision or a complete `'graded-multi-size'` grading artifact.
 */
export function buildAuthoritativePieceProductionSheetSet(
  params: BuildPieceProductionSheetSetParams
): AuthoritativePieceProductionSheetSet {
  const rev = params.patternRevision;
  const rejectionCodes: PieceProductionSheetRejectionCode[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if ((rev as unknown as { isProductionReady: boolean })?.isProductionReady !== false) {
    rejectionCodes.push('INDUSTRIAL_SAFETY_VIOLATION');
    errors.push('Industrial safety violation: patternRevision must preserve isProductionReady === false.');
  }

  const revCheck = verifyPatternRevisionLifecycleIntegrity(rev);
  if (!revCheck.isValid) {
    rejectionCodes.push(revCheck.isContentTampered ? 'PATTERN_REVISION_TAMPERED' : 'PATTERN_REVISION_INVALID');
    errors.push(...revCheck.errors);
  }

  const generatedAt = params.generatedAt ?? new Date().toISOString();
  if (!isStrictValidIsoTimestamp(generatedAt)) {
    rejectionCodes.push('TIMESTAMP_INVALID');
    errors.push(`Invalid generatedAt ISO-8601 timestamp '${String(params.generatedAt)}'.`);
  }

  const sourceGarmentId = rev?.sourceSpecificationId ?? rev?.designSpecification?.id ?? '';
  if (params.expectedProjectId && rev?.projectId !== params.expectedProjectId) {
    rejectionCodes.push('CROSS_PROJECT_MISMATCH');
    errors.push(`Project mismatch: patternRevision.projectId '${rev?.projectId}' !== '${params.expectedProjectId}'.`);
  }
  if (params.expectedGarmentId && sourceGarmentId !== params.expectedGarmentId) {
    rejectionCodes.push('CROSS_GARMENT_MISMATCH');
    errors.push(`Garment mismatch: patternRevision garment '${sourceGarmentId}' !== '${params.expectedGarmentId}'.`);
  }
  if (params.expectedTenantId !== undefined && params.expectedTenantId.trim().length === 0) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push('Authoritative expectedTenantId must be a non-empty string.');
  }
  if (
    params.expectedTenantId &&
    params.gradingArtifact?.tenantId &&
    params.gradingArtifact.tenantId !== params.expectedTenantId
  ) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push(
      `Tenant mismatch: grading artifact belongs to '${params.gradingArtifact.tenantId}', expected '${params.expectedTenantId}'.`
    );
  }

  const baseSize = String(rev?.targetSize ?? '').trim();
  if (!baseSize) {
    rejectionCodes.push('PATTERN_REVISION_INVALID');
    errors.push('Pattern revision targetSize is missing.');
  }

  const basePieces = Array.isArray(rev?.patternPieces) ? rev.patternPieces : [];
  if (basePieces.length === 0) {
    rejectionCodes.push('PATTERN_REVISION_INVALID');
    errors.push('Pattern revision contains zero pattern pieces.');
  }

  const expectedPieceCodes = basePieces.map(p => p.pieceCode);
  const expectedPieceCodeSet = new Set(expectedPieceCodes);
  if (expectedPieceCodeSet.size !== expectedPieceCodes.length) {
    rejectionCodes.push('PATTERN_REVISION_INVALID');
    errors.push('Pattern revision contains duplicate pieceCode entries.');
  }
  const basePieceByCode = new Map(basePieces.map(p => [p.pieceCode, p]));
  const baseGeometryByCode = new Map(
    basePieces.map(p => [p.pieceCode, computePieceGeometryFingerprint(p)])
  );
  const baseSizeAgnosticByCode = new Map(
    basePieces.map(p => [p.pieceCode, computeSizeAgnosticGeometryKey(p)])
  );

  let includedSizes: string[] = [];
  const piecesBySize = new Map<string, readonly PatternPieceSnapshot[]>();

  if (params.gradingMode === 'single-size-ungraded') {
    if (params.gradingArtifact) {
      rejectionCodes.push('GRADING_POLICY_INVALID');
      errors.push('Contradiction: gradingArtifact must not be supplied with gradingMode === "single-size-ungraded".');
    }
    if (!params.nonGradingReason || params.nonGradingReason.trim().length === 0) {
      rejectionCodes.push('GRADING_POLICY_INVALID');
      errors.push('single-size-ungraded requires an explicit non-empty nonGradingReason.');
    }
    if (params.expectedSizes) {
      if (params.expectedSizes.length !== 1 || params.expectedSizes[0] !== baseSize) {
        rejectionCodes.push('GRADING_SIZE_INCOMPLETE');
        errors.push(
          `single-size-ungraded only supports base size '${baseSize}'; cannot satisfy expectedSizes [${params.expectedSizes.join(', ')}].`
        );
      }
    }
    if (baseSize) {
      includedSizes = [baseSize];
      piecesBySize.set(baseSize, basePieces);
    }
  } else {
    const ga = params.gradingArtifact;
    if (!ga) {
      if (rev?.garmentCategory === 'skirt') {
        rejectionCodes.push('SKIRT_GRADING_UNSUPPORTED_WITHOUT_ARTIFACT');
        errors.push(
          'Skirt grading cannot be fabricated without an authoritative AuthoritativeGradingArtifact; use single-size-ungraded policy.'
        );
      } else {
        rejectionCodes.push('GRADING_ARTIFACT_MISSING');
        errors.push('AuthoritativeGradingArtifact is required for gradingMode === "graded-multi-size".');
      }
    } else {
      validateGradingArtifactBindingsToRevision(
        ga,
        rev,
        rejectionCodes,
        errors,
        params.expectedProjectId,
        params.expectedTenantId
      );

      const declaredSet = new Set(ga.sizeRange);
      if (declaredSet.size !== ga.sizeRange.length) {
        rejectionCodes.push('GRADING_ARTIFACT_INVALID');
        errors.push('Grading artifact sizeRange contains duplicate size codes.');
      }
      const actualGeomKeys = Object.keys(ga.perSizePatternGeometry ?? {});
      for (const extraSz of actualGeomKeys) {
        if (!declaredSet.has(extraSz)) {
          rejectionCodes.push('GRADING_EXTRA_UNDECLARED_SIZE');
          errors.push(`Grading artifact contains undeclared size '${extraSz}' outside sizeRange.`);
        }
      }
      for (const sz of ga.sizeRange) {
        if (!Array.isArray(ga.perSizePatternGeometry?.[sz]) || ga.perSizePatternGeometry[sz].length === 0) {
          rejectionCodes.push('GRADING_SIZE_INCOMPLETE');
          errors.push(`Grading artifact is missing pattern geometry for declared size '${sz}'.`);
        }
      }
      if (params.expectedSizes) {
        const expectedSet = new Set(params.expectedSizes);
        for (const reqSz of params.expectedSizes) {
          if (!declaredSet.has(reqSz)) {
            rejectionCodes.push('GRADING_SIZE_INCOMPLETE');
            errors.push(`Grading artifact is missing required size '${reqSz}'.`);
          }
        }
        for (const declSz of ga.sizeRange) {
          if (!expectedSet.has(declSz)) {
            rejectionCodes.push('GRADING_EXTRA_UNDECLARED_SIZE');
            errors.push(`Grading artifact contains extra size '${declSz}' not in expectedSizes.`);
          }
        }
      }

      includedSizes = [...ga.sizeRange];

      for (const sz of includedSizes) {
        const szPieces = ga.perSizePatternGeometry?.[sz] ?? [];
        if (szPieces.length !== basePieces.length) {
          rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
          errors.push(
            `Size '${sz}' has ${szPieces.length} pieces, expected ${basePieces.length} matching base size '${baseSize}'.`
          );
        }

        const seenSzCodes = new Set<string>();
        const seenSzIds = new Set<string>();
        let clonedFromBaseCount = 0;

        for (const gp of szPieces) {
          if (gp.sizeCode !== sz) {
            rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
            errors.push(`Graded piece '${gp.pieceCode}' in size '${sz}' carries mismatched sizeCode '${gp.sizeCode}'.`);
          }
          if (!expectedPieceCodeSet.has(gp.pieceCode) || seenSzCodes.has(gp.pieceCode)) {
            rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
            errors.push(`Graded size '${sz}' contains unexpected or duplicate pieceCode '${gp.pieceCode}'.`);
            continue;
          }
          if (seenSzIds.has(gp.id)) {
            rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
            errors.push(`Graded size '${sz}' contains duplicate pieceId '${gp.id}'.`);
            continue;
          }
          seenSzCodes.add(gp.pieceCode);
          seenSzIds.add(gp.id);

          const baseMatch = basePieceByCode.get(gp.pieceCode);
          if (baseMatch) {
            if (gp.id !== baseMatch.id && !gp.id.startsWith(`${baseMatch.id}-`) && !gp.id.startsWith(baseMatch.id)) {
              rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
              errors.push(
                `Graded piece '${gp.pieceCode}' in size '${sz}' has untraced pieceId '${gp.id}' (base pieceId '${baseMatch.id}').`
              );
            }
            if (gp.material !== baseMatch.material || gp.onFold !== baseMatch.onFold || gp.cutCount !== baseMatch.cutCount) {
              rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
              errors.push(
                `Graded piece '${gp.pieceCode}' in size '${sz}' breaks material/onFold/cutCount parity with base size '${baseSize}'.`
              );
            }
            if (sz === baseSize) {
              const gpFp = computePieceGeometryFingerprint(gp);
              if (gpFp !== baseGeometryByCode.get(gp.pieceCode)) {
                rejectionCodes.push('PATTERN_REVISION_TAMPERED');
                errors.push(`Base-size '${baseSize}' graded piece '${gp.pieceCode}' diverges from authoritative patternRevision geometry.`);
              }
            } else {
              const szKey = computeSizeAgnosticGeometryKey(gp);
              if (szKey === baseSizeAgnosticByCode.get(gp.pieceCode)) {
                clonedFromBaseCount++;
              }
            }
          }
        }

        for (const reqCode of expectedPieceCodes) {
          if (!seenSzCodes.has(reqCode)) {
            rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
            errors.push(`Graded size '${sz}' is missing required piece '${reqCode}'.`);
          }
        }

        if (sz !== baseSize && szPieces.length > 0 && clonedFromBaseCount === szPieces.length) {
          rejectionCodes.push('GRADING_BASE_CLONING_PROHIBITED');
          errors.push(
            `Graded size '${sz}' duplicates base-size '${baseSize}' geometry verbatim without genuine size regeneration.`
          );
        }

        piecesBySize.set(sz, szPieces);
      }
    }
  }

  const hasDeclaredOrderQty =
    params.garmentUnitQuantity !== undefined || params.garmentUnitQuantitiesBySize !== undefined;
  const orderQuantityBasis: OrderQuantityBasis = hasDeclaredOrderQty
    ? 'declared-order-quantity'
    : 'default-single-garment-per-size-run';

  const sheetsBySizeRecord: Record<string, readonly PatternPieceProductionSheet[]> = {};
  let totalSheetsCount = 0;
  let totalPhysicalPanelsAccumulator = 0;
  let allPanelsKnown = true;

  for (const sz of includedSizes) {
    const szPieces = piecesBySize.get(sz) ?? [];
    let qtyForSize: number | undefined;
    if (hasDeclaredOrderQty) {
      const bySizeVal = params.garmentUnitQuantitiesBySize?.[sz];
      if (bySizeVal !== undefined) {
        qtyForSize = bySizeVal;
      } else if (params.garmentUnitQuantity !== undefined) {
        qtyForSize = params.garmentUnitQuantity;
      } else {
        rejectionCodes.push('QUANTITY_BASIS_INVALID');
        errors.push(
          `garmentUnitQuantitiesBySize was supplied without an entry for size '${sz}' and no garmentUnitQuantity fallback was provided.`
        );
        qtyForSize = 0;
      }
    }

    const szSheets: PatternPieceProductionSheet[] = [];

    for (const p of szPieces) {
      const sheet = buildPatternPieceProductionSheet({
        patternRevision: rev,
        piece: p,
        gradingMode: params.gradingMode,
        gradingArtifact: params.gradingArtifact,
        cutSemanticsDeclaration: params.cutSemanticsByPieceCode[p.pieceCode],
        ...(hasDeclaredOrderQty ? { garmentUnitQuantity: qtyForSize } : {}),
        uiReportedAllowanceCmByRole: params.uiReportedAllowanceCmByRole,
        expectedProjectId: params.expectedProjectId,
        expectedTenantId: params.expectedTenantId,
        expectedGarmentId: params.expectedGarmentId,
        generatedAt
      });

      szSheets.push(sheet);
      totalSheetsCount++;

      if (!sheet.validation.isValid) {
        rejectionCodes.push(...sheet.validation.rejectionCodes);
        errors.push(...sheet.validation.errors.map(e => `[${sz}/${p.pieceCode}] ${e}`));
      }
      if (sheet.validation.warnings.length > 0) {
        warnings.push(...sheet.validation.warnings.map(w => `[${sz}/${p.pieceCode}] ${w}`));
      }

      if (sheet.cutSemantics.totalPhysicalPanelsForOrder !== null) {
        totalPhysicalPanelsAccumulator += sheet.cutSemantics.totalPhysicalPanelsForOrder;
      } else {
        allPanelsKnown = false;
      }
    }

    sheetsBySizeRecord[sz] = szSheets;
  }

  const sourcePatternContentFingerprint =
    rev?.basePatternFingerprint ?? rev?.contentFingerprint ?? rev?.canonicalFingerprint ?? '';
  const sourceGeometryFingerprint = rev?.geometryFingerprint ?? '';

  const setBase: Omit<AuthoritativePieceProductionSheetSet, 'sheetSetContentFingerprint' | 'validation' | 'generatedAt'> = {
    schemaVersion: MANUFACTURING_PIECE_SHEET_SCHEMA_VERSION,
    sheetSetId:
      params.sheetSetId ??
      `mfg-sheet-set:${rev.revisionId}:${params.gradingMode}`,
    sourceProjectId: rev.projectId,
    ...(params.expectedTenantId || params.gradingArtifact?.tenantId
      ? { sourceTenantId: params.expectedTenantId ?? params.gradingArtifact?.tenantId }
      : {}),
    sourceGarmentId,
    sourcePatternRevisionId: rev.revisionId,
    sourcePatternRevisionNumber: rev.revisionIndex,
    sourcePatternContentFingerprint,
    sourceGeometryFingerprint,
    gradingMode: params.gradingMode,
    ...(params.nonGradingReason !== undefined ? { nonGradingReason: params.nonGradingReason } : {}),
    ...(params.gradingArtifact
      ? {
          sourceGradingArtifactId: params.gradingArtifact.gradingArtifactId,
          sourceGradingRevisionId: params.gradingArtifact.gradingRevisionId,
          sourceGradingArtifactFingerprint: params.gradingArtifact.canonicalFingerprint
        }
      : {}),
    baseSize,
    includedSizes,
    expectedPieceCodes,
    sheetsBySize: sheetsBySizeRecord,
    totalSheetsCount,
    totalPhysicalPanelsAcrossSizesForOrder:
      allPanelsKnown && includedSizes.length > 0 && totalSheetsCount > 0
        ? totalPhysicalPanelsAccumulator
        : null,
    orderQuantityBasis,
    isProductionReady: false
  };

  const sheetSetContentFingerprint = computePieceProductionSheetSetContentFingerprint(setBase);
  const validation: PieceProductionSheetValidationResult = {
    isValid: rejectionCodes.length === 0 && errors.length === 0 && totalSheetsCount > 0,
    rejectionCodes: Array.from(new Set(rejectionCodes)),
    errors,
    warnings
  };

  return {
    ...setBase,
    sheetSetContentFingerprint,
    validation,
    generatedAt
  };
}

/**
 * Independently verifies a single `PatternPieceProductionSheet` against its digest,
 * authoritative pattern revision & piece geometry, contour summaries, cut semantics declaration,
 * allowance schedule, geometry metrics, quantity basis, and timestamp validity.
 */
export function verifyPieceProductionSheetIntegrity(
  sheet: PatternPieceProductionSheet | undefined,
  sourceContext: PieceProductionSheetVerificationSourceContext = {}
): PieceProductionSheetVerificationResult {
  if (!sheet || typeof sheet !== 'object') {
    return {
      isValid: false,
      isFingerprintValid: false,
      isSourceGeometryMatch: false,
      rejectionCodes: ['PATTERN_REVISION_INVALID'],
      errors: ['PatternPieceProductionSheet is missing.'],
      warnings: []
    };
  }

  const rejectionCodes: PieceProductionSheetRejectionCode[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if ((sheet as unknown as { isProductionReady: boolean }).isProductionReady !== false) {
    rejectionCodes.push('INDUSTRIAL_SAFETY_VIOLATION');
    errors.push('Industrial safety violation: PatternPieceProductionSheet asserts isProductionReady !== false.');
  }

  if (sheet.schemaVersion !== MANUFACTURING_PIECE_SHEET_SCHEMA_VERSION) {
    rejectionCodes.push('PATTERN_REVISION_INVALID');
    errors.push(`Unsupported production sheet schemaVersion '${String(sheet.schemaVersion)}'.`);
  }

  if (!isStrictValidIsoTimestamp(sheet.generatedAt)) {
    rejectionCodes.push('TIMESTAMP_INVALID');
    errors.push(`Invalid generatedAt ISO-8601 timestamp '${String(sheet.generatedAt)}'.`);
  }

  let recomputedSheetFp = '';
  let isFingerprintValid = false;
  try {
    recomputedSheetFp = computePieceProductionSheetContentFingerprint(sheet);
    isFingerprintValid = recomputedSheetFp === sheet.sheetContentFingerprint;
    if (!isFingerprintValid) {
      rejectionCodes.push('SHEET_FINGERPRINT_MISMATCH');
      errors.push(
        `sheetContentFingerprint mismatch: recorded '${sheet.sheetContentFingerprint}' vs recomputed '${recomputedSheetFp}'.`
      );
    }
  } catch (err) {
    rejectionCodes.push('SHEET_FINGERPRINT_MISMATCH');
    errors.push(`Unable to canonicalize sheet fingerprint: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (sourceContext.expectedProjectId && sheet.sourceProjectId !== sourceContext.expectedProjectId) {
    rejectionCodes.push('CROSS_PROJECT_MISMATCH');
    errors.push(
      `Project mismatch: sheet sourceProjectId '${sheet.sourceProjectId}' !== '${sourceContext.expectedProjectId}'.`
    );
  }

  // Authoritative tenant resolution: expectedTenantId + gradingArtifact.tenantId
  const expTenant = sourceContext.expectedTenantId;
  const gaTenant = sourceContext.gradingArtifact?.tenantId;
  if (expTenant !== undefined && expTenant.trim().length === 0) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push('Authoritative expectedTenantId must be a non-empty string.');
  }
  if (sourceContext.gradingArtifact && (typeof gaTenant !== 'string' || gaTenant.trim().length === 0)) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push('Authoritative gradingArtifact is missing a valid non-empty tenantId.');
  }
  if (expTenant && gaTenant && gaTenant !== expTenant) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push(
      `Tenant conflict between expectedTenantId ('${expTenant}') and gradingArtifact.tenantId ('${gaTenant}').`
    );
  }
  const authoritativeTenant = expTenant ?? gaTenant;
  if (authoritativeTenant) {
    if (sheet.sourceTenantId !== authoritativeTenant) {
      rejectionCodes.push('CROSS_TENANT_MISMATCH');
      errors.push(
        `Tenant mismatch: sheet sourceTenantId '${String(sheet.sourceTenantId)}' !== authoritative tenant '${authoritativeTenant}'.`
      );
    }
  } else if (sheet.sourceTenantId !== undefined) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push(
      `Sheet asserts sourceTenantId '${String(sheet.sourceTenantId)}' with no authoritative tenant context (expectedTenantId or gradingArtifact) to verify it.`
    );
  }

  if (sourceContext.expectedGarmentId && sheet.sourceGarmentId !== sourceContext.expectedGarmentId) {
    rejectionCodes.push('CROSS_GARMENT_MISMATCH');
    errors.push(
      `Garment mismatch: sheet sourceGarmentId '${sheet.sourceGarmentId}' !== '${sourceContext.expectedGarmentId}'.`
    );
  }

  if (
    sheet.orderQuantityBasis !== 'declared-order-quantity' &&
    sheet.orderQuantityBasis !== 'default-single-garment-per-size-run'
  ) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(`Invalid sheet orderQuantityBasis '${String(sheet.orderQuantityBasis)}'.`);
  } else if (sheet.orderQuantityBasis !== sheet.cutSemantics?.orderQuantityBasis) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(
      `Sheet orderQuantityBasis ('${sheet.orderQuantityBasis}') contradicts cutSemantics.orderQuantityBasis ('${String(sheet.cutSemantics?.orderQuantityBasis)}').`
    );
  }
  if (
    sheet.orderQuantityBasis === 'default-single-garment-per-size-run' &&
    sheet.cutSemantics?.garmentUnitQuantity !== 1
  ) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(
      `Sheet with default-single-garment-per-size-run basis must carry garmentUnitQuantity === 1 (found ${String(sheet.cutSemantics?.garmentUnitQuantity)}).`
    );
  }
  if (
    sourceContext.expectedOrderQuantityBasis &&
    sheet.orderQuantityBasis !== sourceContext.expectedOrderQuantityBasis
  ) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(
      `Order quantity basis mismatch: sheet '${sheet.orderQuantityBasis}' !== expected '${sourceContext.expectedOrderQuantityBasis}'.`
    );
  }

  let isSourceGeometryMatch = false;
  let recomputedPieceGeometryFp: string | undefined;

  if (!sourceContext.patternRevision) {
    errors.push('Authoritative patternRevision must be supplied in sourceContext to verify piece geometry.');
    rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
  } else {
    const rev = sourceContext.patternRevision;
    const revCheck = verifyPatternRevisionLifecycleIntegrity(rev);
    if (!revCheck.isValid) {
      rejectionCodes.push(revCheck.isContentTampered ? 'PATTERN_REVISION_TAMPERED' : 'PATTERN_REVISION_INVALID');
      errors.push(...revCheck.errors);
    }

    const revContentFp = rev.basePatternFingerprint ?? rev.contentFingerprint ?? rev.canonicalFingerprint;
    const revGarmentId = rev.sourceSpecificationId ?? rev.designSpecification?.id;
    if (
      sheet.sourcePatternRevisionId !== rev.revisionId ||
      sheet.sourcePatternRevisionNumber !== rev.revisionIndex ||
      sheet.sourcePatternContentFingerprint !== revContentFp ||
      sheet.sourceGeometryFingerprint !== rev.geometryFingerprint ||
      sheet.sourceProjectId !== rev.projectId ||
      sheet.sourceGarmentId !== revGarmentId
    ) {
      rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
      errors.push(
        `Sheet revision binding ('${sheet.sourcePatternRevisionId}', rev#${sheet.sourcePatternRevisionNumber}) diverges from authoritative pattern revision '${rev.revisionId}' (rev#${rev.revisionIndex}).`
      );
    }
    if (canonicalizeJson(sheet.sourceEngineProvenance) !== canonicalizeJson(rev.engineProvenance)) {
      rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
      errors.push(`Sheet sourceEngineProvenance diverges from authoritative pattern revision '${rev.revisionId}'.`);
    }

    let sourcePiece: PatternPieceSnapshot | undefined;
    if (sheet.gradingMode === 'graded-multi-size') {
      const ga = sourceContext.gradingArtifact;
      if (!ga) {
        rejectionCodes.push(
          rev.garmentCategory === 'skirt'
            ? 'SKIRT_GRADING_UNSUPPORTED_WITHOUT_ARTIFACT'
            : 'GRADING_ARTIFACT_MISSING'
        );
        errors.push('AuthoritativeGradingArtifact required in sourceContext to verify graded production sheet.');
      } else {
        validateGradingArtifactBindingsToRevision(
          ga,
          rev,
          rejectionCodes,
          errors,
          sourceContext.expectedProjectId,
          sourceContext.expectedTenantId
        );
        if (
          sheet.sourceGradingArtifactId !== ga.gradingArtifactId ||
          sheet.sourceGradingRevisionId !== ga.gradingRevisionId ||
          sheet.sourceGradingArtifactFingerprint !== ga.canonicalFingerprint
        ) {
          rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
          errors.push('Sheet grading artifact reference diverges from authoritative grading artifact.');
        }
        const basePiece = rev.patternPieces.find(p => p.pieceCode === sheet.pieceCode);
        if (!basePiece) {
          rejectionCodes.push('FOREIGN_PIECE_NOT_IN_REVISION');
          errors.push(
            `Piece '${sheet.pieceCode}' has no matching base piece in patternRevision '${rev.revisionId}'.`
          );
        }
        const gaPieces = (ga.perSizePatternGeometry?.[sheet.sizeCode] ?? []).filter(
          p => p.pieceCode === sheet.pieceCode
        );
        if (gaPieces.length !== 1) {
          rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
          errors.push(
            `Authoritative graded piece '${sheet.pieceCode}' (${sheet.sizeCode}) is missing or duplicated in grading artifact.`
          );
        } else {
          sourcePiece = gaPieces[0];
        }
      }
    } else if (sheet.gradingMode === 'single-size-ungraded') {
      if (
        sourceContext.gradingArtifact ||
        sheet.sourceGradingArtifactId !== undefined ||
        sheet.sourceGradingRevisionId !== undefined ||
        sheet.sourceGradingArtifactFingerprint !== undefined
      ) {
        rejectionCodes.push('GRADING_POLICY_INVALID');
        errors.push('single-size-ungraded sheet must not carry grading artifact bindings.');
      }
      const matches = rev.patternPieces.filter(
        p => p.pieceCode === sheet.pieceCode && p.sizeCode === sheet.sizeCode
      );
      if (matches.length !== 1) {
        rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
        errors.push(
          `Authoritative piece '${sheet.pieceCode}' (${sheet.sizeCode}) is missing or duplicated in patternRevision.`
        );
      } else {
        sourcePiece = matches[0];
      }
    } else {
      rejectionCodes.push('GRADING_POLICY_INVALID');
      errors.push(`Invalid gradingMode '${String(sheet.gradingMode)}'.`);
    }

    if (sourcePiece) {
      recomputedPieceGeometryFp = computePieceGeometryFingerprint(sourcePiece);
      const expectedStitchSummary = toContourSummary(sourcePiece.stitchingContour);
      const expectedCutSummary = toContourSummary(sourcePiece.cuttingContour);

      const fieldsMatch =
        recomputedPieceGeometryFp === sheet.pieceGeometryFingerprint &&
        sheet.pieceId === sourcePiece.id &&
        sheet.pieceCode === sourcePiece.pieceCode &&
        sheet.pieceName === sourcePiece.name &&
        sheet.sizeCode === sourcePiece.sizeCode &&
        sheet.garmentCategory === sourcePiece.garmentCategory &&
        sheet.material === sourcePiece.material &&
        canonicalizeJson(sheet.grainline) === canonicalizeJson(sourcePiece.grainline) &&
        canonicalizeJson(sheet.notches ?? []) === canonicalizeJson(sourcePiece.notches ?? []) &&
        canonicalizeJson(sheet.darts ?? []) === canonicalizeJson(sourcePiece.darts ?? []) &&
        canonicalizeJson(sheet.drillHoles ?? []) === canonicalizeJson(sourcePiece.drillHoles ?? []) &&
        canonicalizeJson(sheet.seamReferences ?? []) === canonicalizeJson(sourcePiece.seams ?? []) &&
        canonicalizeJson(sheet.stitchingContour ?? null) === canonicalizeJson(sourcePiece.stitchingContour ?? null) &&
        canonicalizeJson(sheet.cuttingContour ?? null) === canonicalizeJson(sourcePiece.cuttingContour ?? null) &&
        canonicalizeJson(sheet.stitchingContourSummary ?? null) === canonicalizeJson(expectedStitchSummary) &&
        canonicalizeJson(sheet.cuttingContourSummary ?? null) === canonicalizeJson(expectedCutSummary);

      if (!fieldsMatch) {
        rejectionCodes.push('PIECE_GEOMETRY_FINGERPRINT_MISMATCH');
        errors.push(
          `Sheet geometry, contour summaries, or piece metadata/annotations for '${sheet.pieceCode}' diverge from authoritative source piece.`
        );
      } else {
        isSourceGeometryMatch = true;
      }

      // Never fall back to untrusted sheet.cutSemantics to reconstruct declaration.
      const decl =
        sourceContext.cutSemanticsDeclaration ??
        sourceContext.cutSemanticsByPieceCode?.[sheet.pieceCode];

      const bySizeQtyMap = sourceContext.expectedGarmentUnitQuantitiesBySize;
      if (bySizeQtyMap !== undefined) {
        for (const [k, v] of Object.entries(bySizeQtyMap)) {
          if (!Number.isInteger(v) || v < 1) {
            rejectionCodes.push('QUANTITY_BASIS_INVALID');
            errors.push(
              `Invalid expectedGarmentUnitQuantitiesBySize['${k}'] quantity (${String(v)}); expected positive integer >= 1.`
            );
          }
        }
      }
      if (
        sourceContext.expectedGarmentUnitQuantity !== undefined &&
        (!Number.isInteger(sourceContext.expectedGarmentUnitQuantity) ||
          sourceContext.expectedGarmentUnitQuantity < 1)
      ) {
        rejectionCodes.push('QUANTITY_BASIS_INVALID');
        errors.push(
          `Invalid expectedGarmentUnitQuantity (${String(sourceContext.expectedGarmentUnitQuantity)}); expected positive integer >= 1.`
        );
      }

      const expectedQty = bySizeQtyMap?.[sheet.sizeCode] ?? sourceContext.expectedGarmentUnitQuantity;
      let qtyForRecompute: number | undefined;

      if (sheet.orderQuantityBasis === 'declared-order-quantity') {
        if (expectedQty === undefined) {
          rejectionCodes.push('QUANTITY_BASIS_INVALID');
          errors.push(
            `Declared-order-quantity sheet for '${sheet.pieceCode}' (${sheet.sizeCode}) cannot be verified without authoritative expectedGarmentUnitQuantity or expectedGarmentUnitQuantitiesBySize['${sheet.sizeCode}'].`
          );
          // Do NOT fall back to sheet.cutSemantics.garmentUnitQuantity
          qtyForRecompute = 0;
        } else {
          qtyForRecompute = expectedQty;
        }
      } else {
        // default-single-garment-per-size-run
        if (expectedQty !== undefined && expectedQty !== 1) {
          rejectionCodes.push('QUANTITY_BASIS_INVALID');
          errors.push(
            `Default-quantity sheet for '${sheet.pieceCode}' (${sheet.sizeCode}) contradicts expected quantity (${expectedQty} !== 1).`
          );
        }
        qtyForRecompute = undefined;
      }

      const recomputedSemantics = resolveCutQuantitySemantics(sourcePiece, {
        declaration: decl,
        ...(qtyForRecompute !== undefined ? { garmentUnitQuantity: qtyForRecompute } : {})
      });
      if (recomputedSemantics.semanticResolutionStatus !== 'resolved') {
        rejectionCodes.push(
          recomputedSemantics.semanticResolutionStatus === 'unresolved'
            ? 'CUT_SEMANTICS_UNRESOLVED'
            : 'CUT_SEMANTICS_CONTRADICTION'
        );
        errors.push(...recomputedSemantics.contradictionReasons);
      } else if (canonicalizeJson(recomputedSemantics) !== canonicalizeJson(sheet.cutSemantics)) {
        rejectionCodes.push('CUT_SEMANTICS_CONTRADICTION');
        errors.push(`Recorded cutSemantics for '${sheet.pieceCode}' diverges from authoritative verification.`);
      }

      const recomputedSchedule = buildPieceAllowanceSchedule(sourcePiece, recomputedSemantics);
      if (!recomputedSchedule.isComplete || recomputedSchedule.hasContradictions) {
        rejectionCodes.push('ALLOWANCE_SCHEDULE_INVALID');
        errors.push(...recomputedSchedule.issues);
      } else if (
        canonicalizeJson(recomputedSchedule.entries) !== canonicalizeJson(sheet.allowanceSchedule.entries) ||
        recomputedSchedule.isComplete !== sheet.allowanceSchedule.isComplete ||
        recomputedSchedule.hasContradictions !== sheet.allowanceSchedule.hasContradictions ||
        recomputedSchedule.mappedSegmentCount !== sheet.allowanceSchedule.mappedSegmentCount ||
        recomputedSchedule.unmappedSegmentCount !== sheet.allowanceSchedule.unmappedSegmentCount ||
        recomputedSchedule.sourcePieceScalarAllowanceWidthCm !== sheet.allowanceSchedule.sourcePieceScalarAllowanceWidthCm ||
        canonicalizeJson(recomputedSchedule.unmappedCuttingSegmentIds) !== canonicalizeJson(sheet.allowanceSchedule.unmappedCuttingSegmentIds) ||
        canonicalizeJson(recomputedSchedule.conflictingSeamSegmentIds) !== canonicalizeJson(sheet.allowanceSchedule.conflictingSeamSegmentIds)
      ) {
        rejectionCodes.push('ALLOWANCE_SCHEDULE_INVALID');
        errors.push(`Recorded allowanceSchedule for '${sheet.pieceCode}' diverges from authoritative segment geometry.`);
      }

      const metricsSemantics =
        recomputedSemantics.semanticResolutionStatus === 'resolved' ? recomputedSemantics : undefined;
      const recomputedMetrics = computePieceGeometryMetrics(sourcePiece, metricsSemantics);
      if (!recomputedMetrics.isValid) {
        rejectionCodes.push('GEOMETRY_INVALID');
        errors.push(...recomputedMetrics.errors);
      } else if (metricsSemantics) {
        if (canonicalizeJson(recomputedMetrics) !== canonicalizeJson(sheet.geometryMetrics)) {
          rejectionCodes.push('GEOMETRY_INVALID');
          errors.push(`Recorded geometryMetrics for '${sheet.pieceCode}' diverges from recomputed contour metrics.`);
        }
      } else {
        const contourComparable = (m: PatternPieceGeometryMetrics) => ({
          unit: m.unit,
          areaUnit: m.areaUnit,
          isValid: m.isValid,
          stitchingPerimeterCm: m.stitchingPerimeterCm,
          cuttingPerimeterCm: m.cuttingPerimeterCm,
          cuttingAreaCm2: m.cuttingAreaCm2,
          stitchingAreaCm2: m.stitchingAreaCm2,
          boundingWidthCm: m.boundingWidthCm,
          boundingHeightCm: m.boundingHeightCm,
          numericalPrecision: m.numericalPrecision
        });
        if (
          canonicalizeJson(contourComparable(recomputedMetrics)) !==
          canonicalizeJson(contourComparable(sheet.geometryMetrics))
        ) {
          rejectionCodes.push('GEOMETRY_INVALID');
          errors.push(`Recorded geometryMetrics for '${sheet.pieceCode}' diverges from recomputed contour metrics.`);
        }
      }
    }
  }

  return {
    isValid: rejectionCodes.length === 0 && errors.length === 0,
    isFingerprintValid,
    isSourceGeometryMatch,
    rejectionCodes: Array.from(new Set(rejectionCodes)),
    recomputedSheetContentFingerprint: recomputedSheetFp || undefined,
    recomputedPieceGeometryFingerprint: recomputedPieceGeometryFp,
    errors,
    warnings
  };
}

/**
 * Independently verifies an `AuthoritativePieceProductionSheetSet` from authoritative
 * pattern revision, grading artifact, and cut semantics context — never accepting recomputed
 * digests over inconsistent, incomplete, or forged contents.
 */
export function verifyPieceProductionSheetSetIntegrity(
  sheetSet: AuthoritativePieceProductionSheetSet | undefined,
  sourceContext: PieceProductionSheetVerificationSourceContext = {}
): PieceProductionSheetSetVerificationResult {
  if (!sheetSet || typeof sheetSet !== 'object') {
    return {
      isValid: false,
      isSetFingerprintValid: false,
      isSizeCoverageComplete: false,
      rejectionCodes: ['PATTERN_REVISION_INVALID'],
      errors: ['AuthoritativePieceProductionSheetSet is missing.'],
      warnings: []
    };
  }

  const rejectionCodes: PieceProductionSheetRejectionCode[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if ((sheetSet as unknown as { isProductionReady: boolean }).isProductionReady !== false) {
    rejectionCodes.push('INDUSTRIAL_SAFETY_VIOLATION');
    errors.push('Industrial safety violation: AuthoritativePieceProductionSheetSet asserts isProductionReady !== false.');
  }

  if (sheetSet.schemaVersion !== MANUFACTURING_PIECE_SHEET_SCHEMA_VERSION) {
    rejectionCodes.push('PATTERN_REVISION_INVALID');
    errors.push(`Unsupported production sheet set schemaVersion '${String(sheetSet.schemaVersion)}'.`);
  }

  if (!isStrictValidIsoTimestamp(sheetSet.generatedAt)) {
    rejectionCodes.push('TIMESTAMP_INVALID');
    errors.push(`Invalid sheetSet.generatedAt ISO-8601 timestamp '${String(sheetSet.generatedAt)}'.`);
  }

  let recomputedSetFp = '';
  let isSetFingerprintValid = false;
  try {
    recomputedSetFp = computePieceProductionSheetSetContentFingerprint(sheetSet);
    isSetFingerprintValid = recomputedSetFp === sheetSet.sheetSetContentFingerprint;
    if (!isSetFingerprintValid) {
      rejectionCodes.push('SHEET_FINGERPRINT_MISMATCH');
      errors.push(
        `sheetSetContentFingerprint mismatch: recorded '${sheetSet.sheetSetContentFingerprint}' vs recomputed '${recomputedSetFp}'.`
      );
    }
  } catch (err) {
    rejectionCodes.push('SHEET_FINGERPRINT_MISMATCH');
    errors.push(`Unable to canonicalize sheetSet fingerprint: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (sourceContext.expectedProjectId && sheetSet.sourceProjectId !== sourceContext.expectedProjectId) {
    rejectionCodes.push('CROSS_PROJECT_MISMATCH');
    errors.push(`Project mismatch on sheet set: '${sheetSet.sourceProjectId}' !== '${sourceContext.expectedProjectId}'.`);
  }

  // Authoritative tenant resolution on sheetSet: expectedTenantId + gradingArtifact.tenantId
  const setExpTenant = sourceContext.expectedTenantId;
  const setGaTenant = sourceContext.gradingArtifact?.tenantId;
  if (setExpTenant !== undefined && setExpTenant.trim().length === 0) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push('Authoritative expectedTenantId must be a non-empty string.');
  }
  if (sourceContext.gradingArtifact && (typeof setGaTenant !== 'string' || setGaTenant.trim().length === 0)) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push('Authoritative gradingArtifact is missing a valid non-empty tenantId.');
  }
  if (setExpTenant && setGaTenant && setGaTenant !== setExpTenant) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push(
      `Tenant conflict on sheet set: expectedTenantId ('${setExpTenant}') !== gradingArtifact.tenantId ('${setGaTenant}').`
    );
  }
  const authoritativeSetTenant = setExpTenant ?? setGaTenant;
  if (authoritativeSetTenant) {
    if (sheetSet.sourceTenantId !== authoritativeSetTenant) {
      rejectionCodes.push('CROSS_TENANT_MISMATCH');
      errors.push(
        `Tenant mismatch on sheet set: '${String(sheetSet.sourceTenantId)}' !== authoritative tenant '${authoritativeSetTenant}'.`
      );
    }
  } else if (sheetSet.sourceTenantId !== undefined) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push(
      `Sheet set asserts sourceTenantId '${String(sheetSet.sourceTenantId)}' with no authoritative tenant context (expectedTenantId or gradingArtifact) to verify it.`
    );
  }

  if (sourceContext.expectedGarmentId && sheetSet.sourceGarmentId !== sourceContext.expectedGarmentId) {
    rejectionCodes.push('CROSS_GARMENT_MISMATCH');
    errors.push(`Garment mismatch on sheet set: '${sheetSet.sourceGarmentId}' !== '${sourceContext.expectedGarmentId}'.`);
  }

  if (
    sheetSet.orderQuantityBasis !== 'declared-order-quantity' &&
    sheetSet.orderQuantityBasis !== 'default-single-garment-per-size-run'
  ) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(`Invalid sheetSet.orderQuantityBasis '${String(sheetSet.orderQuantityBasis)}'.`);
  }
  if (
    sourceContext.expectedOrderQuantityBasis &&
    sheetSet.orderQuantityBasis !== sourceContext.expectedOrderQuantityBasis
  ) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(
      `Order quantity basis mismatch: sheetSet '${sheetSet.orderQuantityBasis}' !== expected '${sourceContext.expectedOrderQuantityBasis}'.`
    );
  }
  if (sourceContext.expectedGarmentUnitQuantitiesBySize !== undefined) {
    for (const [k, v] of Object.entries(sourceContext.expectedGarmentUnitQuantitiesBySize)) {
      if (!Number.isInteger(v) || v < 1) {
        rejectionCodes.push('QUANTITY_BASIS_INVALID');
        errors.push(`Invalid expectedGarmentUnitQuantitiesBySize['${k}'] value (${String(v)}); expected integer >= 1.`);
      }
    }
  }
  if (
    sourceContext.expectedGarmentUnitQuantity !== undefined &&
    (!Number.isInteger(sourceContext.expectedGarmentUnitQuantity) ||
      sourceContext.expectedGarmentUnitQuantity < 1)
  ) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(
      `Invalid expectedGarmentUnitQuantity (${String(sourceContext.expectedGarmentUnitQuantity)}); expected integer >= 1.`
    );
  }
  if (
    sheetSet.orderQuantityBasis === 'declared-order-quantity' &&
    sourceContext.expectedGarmentUnitQuantity === undefined &&
    sourceContext.expectedGarmentUnitQuantitiesBySize === undefined
  ) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(
      `Sheet set carries orderQuantityBasis='declared-order-quantity' without expectedGarmentUnitQuantity or expectedGarmentUnitQuantitiesBySize in sourceContext.`
    );
  }

  const rev = sourceContext.patternRevision;
  if (!rev) {
    rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
    errors.push('Authoritative patternRevision must be supplied in sourceContext to verify sheet set.');
    return {
      isValid: false,
      isSetFingerprintValid,
      isSizeCoverageComplete: false,
      rejectionCodes: Array.from(new Set(rejectionCodes)),
      recomputedSheetSetContentFingerprint: recomputedSetFp || undefined,
      errors,
      warnings
    };
  }

  const revCheck = verifyPatternRevisionLifecycleIntegrity(rev);
  if (!revCheck.isValid) {
    rejectionCodes.push(revCheck.isContentTampered ? 'PATTERN_REVISION_TAMPERED' : 'PATTERN_REVISION_INVALID');
    errors.push(...revCheck.errors);
  }

  const revContentFp = rev.basePatternFingerprint ?? rev.contentFingerprint ?? rev.canonicalFingerprint;
  const revGarmentId = rev.sourceSpecificationId ?? rev.designSpecification?.id;
  if (
    sheetSet.sourcePatternRevisionId !== rev.revisionId ||
    sheetSet.sourcePatternRevisionNumber !== rev.revisionIndex ||
    sheetSet.sourcePatternContentFingerprint !== revContentFp ||
    sheetSet.sourceGeometryFingerprint !== rev.geometryFingerprint ||
    sheetSet.sourceProjectId !== rev.projectId ||
    sheetSet.sourceGarmentId !== revGarmentId
  ) {
    rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
    errors.push(
      `Sheet set revision binding ('${sheetSet.sourcePatternRevisionId}', rev#${sheetSet.sourcePatternRevisionNumber}) diverges from authoritative patternRevision '${rev.revisionId}'.`
    );
  }

  if (sheetSet.baseSize !== rev.targetSize) {
    rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
    errors.push(`Sheet set baseSize '${sheetSet.baseSize}' !== authoritative revision targetSize '${rev.targetSize}'.`);
  }

  const authPieceCodes = Array.isArray(rev.patternPieces) ? rev.patternPieces.map(p => p.pieceCode) : [];
  const authPieceCodeSet = new Set(authPieceCodes);
  const recordedExpectedCodes = sheetSet.expectedPieceCodes ?? [];
  const recordedExpectedSet = new Set(recordedExpectedCodes);
  if (
    authPieceCodes.length === 0 ||
    recordedExpectedSet.size !== recordedExpectedCodes.length ||
    recordedExpectedSet.size !== authPieceCodeSet.size ||
    !authPieceCodes.every(c => recordedExpectedSet.has(c))
  ) {
    rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
    errors.push(
      `Sheet set expectedPieceCodes [${recordedExpectedCodes.join(', ')}] disagrees with authoritative patternPieces [${authPieceCodes.join(', ')}].`
    );
  }

  // Verify grading policy, size coverage & grading artifact bindings
  let isSizeCoverageComplete = true;
  const declaredSizes = sheetSet.includedSizes ?? [];
  const sheetSizeKeys = Object.keys(sheetSet.sheetsBySize ?? {});
  const declaredSet = new Set(declaredSizes);

  if (declaredSizes.length === 0 || declaredSet.size !== declaredSizes.length) {
    isSizeCoverageComplete = false;
    rejectionCodes.push('GRADING_SIZE_INCOMPLETE');
    errors.push('Sheet set includedSizes is empty or contains duplicate size entries.');
  }

  if (sheetSet.gradingMode === 'single-size-ungraded') {
    if (
      sourceContext.gradingArtifact ||
      sheetSet.sourceGradingArtifactId !== undefined ||
      sheetSet.sourceGradingRevisionId !== undefined ||
      sheetSet.sourceGradingArtifactFingerprint !== undefined
    ) {
      isSizeCoverageComplete = false;
      rejectionCodes.push('GRADING_POLICY_INVALID');
      errors.push('single-size-ungraded sheet set must not reference a grading artifact.');
    }
    if (!sheetSet.nonGradingReason || sheetSet.nonGradingReason.trim().length === 0) {
      isSizeCoverageComplete = false;
      rejectionCodes.push('GRADING_POLICY_INVALID');
      errors.push('single-size-ungraded sheet set is missing mandatory nonGradingReason.');
    }
    if (declaredSizes.length !== 1 || declaredSizes[0] !== rev.targetSize) {
      isSizeCoverageComplete = false;
      rejectionCodes.push('GRADING_POLICY_INVALID');
      errors.push(
        `single-size-ungraded sheet set includedSizes [${declaredSizes.join(', ')}] must strictly equal ['${rev.targetSize}'].`
      );
    }
  } else if (sheetSet.gradingMode === 'graded-multi-size') {
    const ga = sourceContext.gradingArtifact;
    if (!ga) {
      isSizeCoverageComplete = false;
      rejectionCodes.push(
        rev.garmentCategory === 'skirt'
          ? 'SKIRT_GRADING_UNSUPPORTED_WITHOUT_ARTIFACT'
          : 'GRADING_ARTIFACT_MISSING'
      );
      errors.push('AuthoritativeGradingArtifact required in sourceContext to verify graded sheet set.');
    } else {
      validateGradingArtifactBindingsToRevision(
        ga,
        rev,
        rejectionCodes,
        errors,
        sourceContext.expectedProjectId,
        sourceContext.expectedTenantId
      );
      if (
        sheetSet.sourceGradingArtifactId !== ga.gradingArtifactId ||
        sheetSet.sourceGradingRevisionId !== ga.gradingRevisionId ||
        sheetSet.sourceGradingArtifactFingerprint !== ga.canonicalFingerprint
      ) {
        rejectionCodes.push('CROSS_REVISION_SOURCE_MISMATCH');
        errors.push('Sheet set grading artifact metadata diverges from authoritative gradingArtifact.');
      }

      const gaDeclaredSet = new Set(ga.sizeRange);
      for (const extraGaSz of Object.keys(ga.perSizePatternGeometry ?? {})) {
        if (!gaDeclaredSet.has(extraGaSz)) {
          isSizeCoverageComplete = false;
          rejectionCodes.push('GRADING_EXTRA_UNDECLARED_SIZE');
          errors.push(`Grading artifact contains undeclared size '${extraGaSz}'.`);
        }
      }
      for (const reqGaSz of ga.sizeRange) {
        if (!declaredSet.has(reqGaSz)) {
          isSizeCoverageComplete = false;
          rejectionCodes.push('GRADING_SIZE_INCOMPLETE');
          errors.push(`Sheet set is missing size '${reqGaSz}' declared by gradingArtifact.`);
        }
      }
      for (const setSz of declaredSizes) {
        if (!gaDeclaredSet.has(setSz)) {
          isSizeCoverageComplete = false;
          rejectionCodes.push('GRADING_EXTRA_UNDECLARED_SIZE');
          errors.push(`Sheet set includes undeclared size '${setSz}' absent from gradingArtifact.`);
        }
      }
    }
  } else {
    isSizeCoverageComplete = false;
    rejectionCodes.push('GRADING_POLICY_INVALID');
    errors.push(`Unsupported sheetSet.gradingMode '${String(sheetSet.gradingMode)}'.`);
  }

  for (const keySz of sheetSizeKeys) {
    if (!declaredSet.has(keySz)) {
      isSizeCoverageComplete = false;
      rejectionCodes.push('GRADING_EXTRA_UNDECLARED_SIZE');
      errors.push(`Sheet set contains undeclared size key '${keySz}' in sheetsBySize.`);
    }
  }
  for (const sz of declaredSizes) {
    if (!Array.isArray(sheetSet.sheetsBySize?.[sz]) || sheetSet.sheetsBySize[sz].length === 0) {
      isSizeCoverageComplete = false;
      rejectionCodes.push('GRADING_SIZE_INCOMPLETE');
      errors.push(`Sheet set is missing sheets for declared size '${sz}'.`);
    }
  }

  if (sourceContext.expectedSizes) {
    const expSet = new Set(sourceContext.expectedSizes);
    for (const reqSz of sourceContext.expectedSizes) {
      if (!declaredSet.has(reqSz)) {
        isSizeCoverageComplete = false;
        rejectionCodes.push('GRADING_SIZE_INCOMPLETE');
        errors.push(`Sheet set is missing required size '${reqSz}'.`);
      }
    }
    for (const declSz of declaredSizes) {
      if (!expSet.has(declSz)) {
        isSizeCoverageComplete = false;
        rejectionCodes.push('GRADING_EXTRA_UNDECLARED_SIZE');
        errors.push(`Sheet set contains extra size '${declSz}' not in expectedSizes.`);
      }
    }
  }

  // Per-size completeness, anti-cross-bucket stuffing, cross-size semantic parity, tenant parity, intra-size quantity uniformity, anti-cloning, and aggregate recomputation
  let recomputedTotalSheets = 0;
  let recomputedTotalPhysicalPanels = 0;
  const semanticProfileByPieceCode = new Map<string, string>();
  const baseSizeSheetKeyByCode = new Map<string, string>();
  const observedSheetTenantIds = new Set<string | undefined>();

  const baseSizeSheets = sheetSet.sheetsBySize?.[rev.targetSize] ?? [];
  for (const bSheet of baseSizeSheets) {
    if (bSheet && typeof bSheet === 'object' && bSheet.pieceCode) {
      baseSizeSheetKeyByCode.set(bSheet.pieceCode, computeSheetSizeAgnosticGeometryKey(bSheet));
    }
  }

  for (const sz of declaredSizes) {
    const szSheets = sheetSet.sheetsBySize?.[sz] ?? [];
    const seenCodesInSize = new Set<string>();
    const seenIdsInSize = new Set<string>();
    let clonedFromBaseSheetCount = 0;
    let uniformQtyInSize: number | undefined;

    let expectedQtyForSize: number | undefined;
    if (sheetSet.orderQuantityBasis === 'declared-order-quantity') {
      const bySz = sourceContext.expectedGarmentUnitQuantitiesBySize?.[sz];
      if (bySz !== undefined) {
        expectedQtyForSize = bySz;
      } else if (sourceContext.expectedGarmentUnitQuantity !== undefined) {
        expectedQtyForSize = sourceContext.expectedGarmentUnitQuantity;
      } else if (sourceContext.expectedGarmentUnitQuantitiesBySize !== undefined) {
        rejectionCodes.push('QUANTITY_BASIS_INVALID');
        errors.push(
          `expectedGarmentUnitQuantitiesBySize omits declared set size '${sz}' with no expectedGarmentUnitQuantity fallback.`
        );
      }
    } else {
      expectedQtyForSize = 1;
      const bySz = sourceContext.expectedGarmentUnitQuantitiesBySize?.[sz] ?? sourceContext.expectedGarmentUnitQuantity;
      if (bySz !== undefined && bySz !== 1) {
        rejectionCodes.push('QUANTITY_BASIS_INVALID');
        errors.push(
          `Default-quantity sheet set for size '${sz}' contradicts expected quantity (${bySz} !== 1).`
        );
      }
    }

    for (const sheet of szSheets) {
      recomputedTotalSheets++;

      if (!sheet || typeof sheet !== 'object') {
        isSizeCoverageComplete = false;
        rejectionCodes.push('PATTERN_REVISION_INVALID');
        errors.push(`[${sz}] Malformed null/non-object sheet entry.`);
        continue;
      }

      observedSheetTenantIds.add(sheet.sourceTenantId);
      if (sheet.sourceTenantId !== sheetSet.sourceTenantId) {
        rejectionCodes.push('CROSS_TENANT_MISMATCH');
        errors.push(
          `[${sz}/${sheet.pieceCode}] Sheet sourceTenantId '${String(sheet.sourceTenantId)}' disagrees with sheetSet.sourceTenantId '${String(sheetSet.sourceTenantId)}'.`
        );
      }

      if (sheet.sizeCode !== sz) {
        isSizeCoverageComplete = false;
        rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
        errors.push(`[${sz}/${sheet.pieceCode}] Sheet sizeCode '${sheet.sizeCode}' disagrees with bucket size '${sz}'.`);
      }

      if (!authPieceCodeSet.has(sheet.pieceCode)) {
        isSizeCoverageComplete = false;
        rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
        errors.push(`[${sz}/${sheet.pieceCode}] Unexpected pieceCode absent from authoritative patternRevision.`);
      } else if (seenCodesInSize.has(sheet.pieceCode)) {
        isSizeCoverageComplete = false;
        rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
        errors.push(`[${sz}/${sheet.pieceCode}] Duplicate pieceCode inside size bucket '${sz}'.`);
      } else {
        seenCodesInSize.add(sheet.pieceCode);
      }

      if (seenIdsInSize.has(sheet.pieceId)) {
        isSizeCoverageComplete = false;
        rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
        errors.push(`[${sz}/${sheet.pieceCode}] Duplicate pieceId '${sheet.pieceId}' inside size bucket '${sz}'.`);
      } else {
        seenIdsInSize.add(sheet.pieceId);
      }

      if (sheet.orderQuantityBasis !== sheetSet.orderQuantityBasis) {
        rejectionCodes.push('QUANTITY_BASIS_INVALID');
        errors.push(
          `[${sz}/${sheet.pieceCode}] Sheet orderQuantityBasis '${sheet.orderQuantityBasis}' disagrees with set basis '${sheetSet.orderQuantityBasis}'.`
        );
      }

      const sheetUnitQty = sheet.cutSemantics?.garmentUnitQuantity;
      if (uniformQtyInSize === undefined) {
        uniformQtyInSize = sheetUnitQty;
      } else if (sheetUnitQty !== uniformQtyInSize) {
        rejectionCodes.push('QUANTITY_BASIS_INVALID');
        errors.push(
          `[${sz}/${sheet.pieceCode}] Intra-size garmentUnitQuantity mismatch (${String(sheetUnitQty)} !== ${String(uniformQtyInSize)}) inside size bucket '${sz}'.`
        );
      }
      if (expectedQtyForSize !== undefined && sheetUnitQty !== expectedQtyForSize) {
        rejectionCodes.push('QUANTITY_BASIS_INVALID');
        errors.push(
          `[${sz}/${sheet.pieceCode}] Sheet garmentUnitQuantity (${String(sheetUnitQty)}) disagrees with expected quantity (${expectedQtyForSize}) for size '${sz}'.`
        );
      }

      const declForPiece = sourceContext.cutSemanticsByPieceCode?.[sheet.pieceCode];
      const sheetCheck = verifyPieceProductionSheetIntegrity(sheet, {
        ...sourceContext,
        cutSemanticsDeclaration: declForPiece ?? sourceContext.cutSemanticsDeclaration
      });
      if (!sheetCheck.isValid) {
        rejectionCodes.push(...sheetCheck.rejectionCodes);
        errors.push(...sheetCheck.errors.map(e => `[${sz}/${sheet.pieceCode}] ${e}`));
      }
      if (sheetCheck.warnings.length > 0) {
        warnings.push(...sheetCheck.warnings);
      }

      // Cross-size cut-semantic invariant check
      const semKey = canonicalizeJson({
        pairingMode: sheet.cutSemantics?.pairingMode ?? null,
        physicalPanelCountPerGarment: sheet.cutSemantics?.physicalPanelCountPerGarment ?? null,
        requiresMirroring: sheet.cutSemantics?.requiresMirroring ?? null,
        requiresFabricFold: sheet.cutSemantics?.requiresFabricFold ?? null,
        requiresFoldUnfolding: sheet.cutSemantics?.requiresFoldUnfolding ?? null,
        foldUnfoldingOperation: sheet.cutSemantics?.foldUnfoldingOperation ?? null
      });
      const existingSemKey = semanticProfileByPieceCode.get(sheet.pieceCode);
      if (existingSemKey === undefined) {
        semanticProfileByPieceCode.set(sheet.pieceCode, semKey);
      } else if (existingSemKey !== semKey) {
        rejectionCodes.push('CUT_SEMANTICS_CONTRADICTION');
        errors.push(
          `Cross-size semantic contradiction on '${sheet.pieceCode}' in size '${sz}'.`
        );
      }

      const panelCountPerGarment = sheet.cutSemantics?.physicalPanelCountPerGarment;
      if (
        expectedQtyForSize !== undefined &&
        typeof panelCountPerGarment === 'number' &&
        Number.isInteger(panelCountPerGarment) &&
        panelCountPerGarment >= 1
      ) {
        const expectedPanels = expectedQtyForSize * panelCountPerGarment;
        if (sheet.cutSemantics?.totalPhysicalPanelsForOrder !== expectedPanels) {
          rejectionCodes.push('QUANTITY_BASIS_INVALID');
          errors.push(
            `[${sz}/${sheet.pieceCode}] Sheet totalPhysicalPanelsForOrder (${String(sheet.cutSemantics?.totalPhysicalPanelsForOrder)}) !== expected ${expectedPanels}.`
          );
        }
        recomputedTotalPhysicalPanels += expectedPanels;
      } else if (typeof sheet.cutSemantics?.totalPhysicalPanelsForOrder === 'number') {
        recomputedTotalPhysicalPanels += sheet.cutSemantics.totalPhysicalPanelsForOrder;
      } else {
        rejectionCodes.push('CUT_SEMANTICS_UNRESOLVED');
        errors.push(`[${sz}/${sheet.pieceCode}] Missing resolved totalPhysicalPanelsForOrder.`);
      }

      if (sheetSet.gradingMode === 'graded-multi-size' && sz !== rev.targetSize) {
        const baseKey = baseSizeSheetKeyByCode.get(sheet.pieceCode);
        if (baseKey && computeSheetSizeAgnosticGeometryKey(sheet) === baseKey) {
          clonedFromBaseSheetCount++;
        }
      }
    }

    for (const reqCode of authPieceCodes) {
      if (!seenCodesInSize.has(reqCode)) {
        isSizeCoverageComplete = false;
        rejectionCodes.push('GRADING_PIECE_IDENTITY_MISMATCH');
        errors.push(`Size bucket '${sz}' is missing required piece '${reqCode}'.`);
      }
    }

    if (
      sheetSet.gradingMode === 'graded-multi-size' &&
      sz !== rev.targetSize &&
      szSheets.length > 0 &&
      clonedFromBaseSheetCount === szSheets.length
    ) {
      rejectionCodes.push('GRADING_BASE_CLONING_PROHIBITED');
      errors.push(
        `Graded size '${sz}' sheet geometries duplicate base size '${rev.targetSize}' verbatim without genuine grading.`
      );
    }
  }

  if (observedSheetTenantIds.size > 1) {
    rejectionCodes.push('CROSS_TENANT_MISMATCH');
    errors.push('Sheets within sheetSet carry conflicting sourceTenantId values.');
  }

  if (sheetSet.totalSheetsCount !== recomputedTotalSheets || recomputedTotalSheets === 0) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(
      `totalSheetsCount mismatch: recorded ${String(sheetSet.totalSheetsCount)} !== recomputed ${recomputedTotalSheets}.`
    );
  }

  if (
    sheetSet.totalPhysicalPanelsAcrossSizesForOrder === null ||
    sheetSet.totalPhysicalPanelsAcrossSizesForOrder !== recomputedTotalPhysicalPanels
  ) {
    rejectionCodes.push('QUANTITY_BASIS_INVALID');
    errors.push(
      `totalPhysicalPanelsAcrossSizesForOrder mismatch: recorded ${String(sheetSet.totalPhysicalPanelsAcrossSizesForOrder)} !== recomputed ${recomputedTotalPhysicalPanels}.`
    );
  }

  return {
    isValid: rejectionCodes.length === 0 && errors.length === 0 && isSizeCoverageComplete,
    isSetFingerprintValid,
    isSizeCoverageComplete,
    rejectionCodes: Array.from(new Set(rejectionCodes)),
    recomputedSheetSetContentFingerprint: recomputedSetFp || undefined,
    errors,
    warnings
  };
}
