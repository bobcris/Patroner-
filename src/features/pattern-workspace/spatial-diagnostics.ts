/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CadCamera, CadCoordinateProjection, CadRectCm, worldCmToScreen } from './cad-math';
import type {
  DiagnosticContourScope,
  DiagnosticCoordinateSpace,
  DiagnosticParameterInterval,
  PatternArtifactBundle,
  PatternPieceRenderModel,
  RenderCurveSegment,
  RenderPoint2D,
  RenderSpatialDiagnostic
} from './contracts/pattern-render-artifact';
import { evaluateCubicBezierUnrounded } from './entity-hit-test';

/**
 * UX-2.3.3.3 — Pure Spatial Diagnostic Mapping & Screen-Space Clustering Engine
 *
 * Strictly zero DOM / React dependencies. Read-only presentation localization:
 * - Never mutates `PatternArtifactBundle` or computes authoritative geometry/certification.
 * - Keeps four axes strictly orthogonal:
 *     1. Spatial Mapping Outcome (`SpatialMappingOutcome`)
 *     2. Source Severity (`INFO` | `WARNING` | `ERROR` | `CRITICAL_BLOCKING`)
 *     3. C0 Draft Validity (`ValidationReport.isValid`, external to this module)
 *     4. ADR-009 Verification Outcome (`CERTIFIED_VALID` | `CERTIFIED_INVALID` | `INCONCLUSIVE`)
 * - Fail-closed on non-finite coordinates, out-of-range parameters (no clamping),
 *   inverted intervals, ambiguous sew/cut segment IDs, and unreferenced point pins.
 */

export type DiagnosticSeverity = RenderSpatialDiagnostic['severity'];

export type SpatialMappingOutcome =
  | 'mapped-point'
  | 'mapped-parameter'
  | 'mapped-interval'
  | 'mapped-segment'
  | 'mapped-piece'
  | 'unmapped'
  | 'stale-reference'
  | 'invalid-reference';

export const COLLAPSED_INTERVAL_EPSILON = 1e-9;
export const DEFAULT_DIAGNOSTIC_CLUSTER_RADIUS_PX = 18;
export const DEFAULT_VIEWPORT_CULL_MARGIN_PX = 80;

export const DIAGNOSTIC_SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  CRITICAL_BLOCKING: 4,
  ERROR: 3,
  WARNING: 2,
  INFO: 1
};

export interface DiagnosticSeverityFilter {
  readonly CRITICAL_BLOCKING: boolean;
  readonly ERROR: boolean;
  readonly WARNING: boolean;
  readonly INFO: boolean;
}

export const DEFAULT_DIAGNOSTIC_SEVERITY_FILTER: DiagnosticSeverityFilter = {
  CRITICAL_BLOCKING: true,
  ERROR: true,
  WARNING: true,
  INFO: true
};

export interface ResolvedDiagnosticSegment {
  readonly segmentId: string;
  readonly contour: DiagnosticContourScope;
  readonly isPrimary: boolean;
  readonly segment: RenderCurveSegment;
}

export type ExtractedDiagnosticInterval =
  | {
      readonly kind: 'collapsed-point';
      readonly tStart: number;
      readonly tEnd: number;
      readonly tMid: number;
      readonly pointCm: RenderPoint2D;
    }
  | {
      readonly kind: 'line-subsegment';
      readonly tStart: number;
      readonly tEnd: number;
      readonly p0: RenderPoint2D;
      readonly p3: RenderPoint2D;
      readonly midpointCm: RenderPoint2D;
    }
  | {
      readonly kind: 'cubic-subsegment';
      readonly tStart: number;
      readonly tEnd: number;
      readonly p0: RenderPoint2D;
      readonly p1: RenderPoint2D;
      readonly p2: RenderPoint2D;
      readonly p3: RenderPoint2D;
      readonly midpointCm: RenderPoint2D;
    };

export interface ResolvedSpatialDiagnostic {
  /** Deterministic disambiguated key (`${source.id}::#${occurrenceIndex}`). */
  readonly diagnosticKey: string;
  readonly occurrenceIndex: number;
  readonly source: RenderSpatialDiagnostic;
  readonly outcome: SpatialMappingOutcome;
  readonly isMapped: boolean;
  readonly isInconclusive: boolean;
  readonly pieceId?: string;
  readonly pieceCode?: string;
  readonly pieceName?: string;
  readonly contourScope?: DiagnosticContourScope;
  readonly anchorCoordinateSpace?: DiagnosticCoordinateSpace;
  readonly localAnchorCm?: RenderPoint2D;
  readonly boardAnchorOverrideCm?: RenderPoint2D;
  readonly localBoundsCm?: CadRectCm;
  readonly resolvedSegments: readonly ResolvedDiagnosticSegment[];
  readonly missingSecondarySegmentIds: readonly string[];
  readonly ambiguousSecondarySegmentIds: readonly string[];
  readonly parameterT?: number;
  readonly extractedIntervals: readonly ExtractedDiagnosticInterval[];
  readonly resolutionNote: string;
}

export interface PieceDiagnosticSummary {
  readonly pieceId: string;
  readonly total: number;
  readonly blockingCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly inconclusiveCount: number;
  readonly highestSeverity: DiagnosticSeverity;
  readonly firstDiagnosticKey: string;
}

export interface ResolvedDiagnosticsSummary {
  readonly total: number;
  readonly mappedCount: number;
  readonly unmappedCount: number;
  readonly staleCount: number;
  readonly invalidCount: number;
  readonly inconclusiveCount: number;
  readonly bySeverity: Readonly<Record<DiagnosticSeverity, number>>;
}

export interface ResolvedArtifactDiagnostics {
  readonly artifactIdentityKey: string;
  readonly items: readonly ResolvedSpatialDiagnostic[];
  readonly byKey: ReadonlyMap<string, ResolvedSpatialDiagnostic>;
  readonly mappedItems: readonly ResolvedSpatialDiagnostic[];
  readonly preSortedMappedItems?: readonly ResolvedSpatialDiagnostic[];
  readonly unmappedItems: readonly ResolvedSpatialDiagnostic[];
  readonly staleOrInvalidItems: readonly ResolvedSpatialDiagnostic[];
  readonly summary: ResolvedDiagnosticsSummary;
  readonly summaryByPieceId: Readonly<Record<string, PieceDiagnosticSummary>>;
}

export interface BoardPieceOffsetVisibility {
  readonly offsetXCm: number;
  readonly offsetYCm: number;
  readonly visible: boolean;
}

export interface DiagnosticLayerVisibilityInput {
  readonly showSewLines: boolean;
  readonly showSeamAllowance: boolean;
}

export interface ProjectedDiagnosticItem {
  readonly resolved: ResolvedSpatialDiagnostic;
  readonly boardOffsetCm: RenderPoint2D;
  readonly boardAnchorCm: RenderPoint2D;
  readonly screenAnchorPx: RenderPoint2D;
  readonly boardBoundsCm?: CadRectCm;
  readonly hiddenHostLayer: DiagnosticContourScope | null;
  readonly isSelected: boolean;
  readonly isHovered: boolean;
}

export interface DiagnosticMarkerCluster {
  readonly clusterId: string;
  readonly members: readonly ProjectedDiagnosticItem[];
  readonly primaryMember: ProjectedDiagnosticItem;
  readonly highestSeverity: DiagnosticSeverity;
  readonly hasInconclusive: boolean;
  readonly hasHiddenHostLayer: boolean;
  readonly containsSelected: boolean;
  readonly containsHovered: boolean;
  readonly boardAnchorCm: RenderPoint2D;
  readonly screenAnchorPx: RenderPoint2D;
}

export interface ProjectedCanvasDiagnostics {
  readonly visibleItems: readonly ProjectedDiagnosticItem[];
  readonly clusters: readonly DiagnosticMarkerCluster[];
  readonly hiddenByLayerCount: number;
  readonly hiddenByFilterCount: number;
  readonly culledOffscreenCount: number;
}

export interface DiagnosticSelectionReconciliationResult {
  readonly selectedDiagnosticKey: string | null;
  readonly wasClearedDueToStaleArtifact: boolean;
  readonly previousKey: string | null;
}

// ---------------------------------------------------------------------------
// 1. Finite Validation & Exact Parametric / De Casteljau Math
// ---------------------------------------------------------------------------

export function isFinitePoint2D(pt: RenderPoint2D | undefined | null): pt is RenderPoint2D {
  return (
    pt !== null &&
    pt !== undefined &&
    typeof pt.x === 'number' &&
    typeof pt.y === 'number' &&
    Number.isFinite(pt.x) &&
    Number.isFinite(pt.y)
  );
}

export function isFiniteSegment(seg: RenderCurveSegment): boolean {
  if (!isFinitePoint2D(seg.p0) || !isFinitePoint2D(seg.p3)) return false;
  if (seg.kind === 'cubic-bezier') {
    if (!isFinitePoint2D(seg.p1) || !isFinitePoint2D(seg.p2)) return false;
  }
  return true;
}

export function isFiniteBoundingBox(
  bb: PatternPieceRenderModel['boundingBoxCm'] | undefined | null
): boolean {
  return (
    bb !== null &&
    bb !== undefined &&
    Number.isFinite(bb.minX) &&
    Number.isFinite(bb.minY) &&
    Number.isFinite(bb.maxX) &&
    Number.isFinite(bb.maxY)
  );
}

export function isMappedDiagnosticOutcome(outcome: SpatialMappingOutcome): boolean {
  return (
    outcome === 'mapped-point' ||
    outcome === 'mapped-parameter' ||
    outcome === 'mapped-interval' ||
    outcome === 'mapped-segment' ||
    outcome === 'mapped-piece'
  );
}

export function isBlockingDiagnosticSeverity(severity: DiagnosticSeverity): boolean {
  return severity === 'ERROR' || severity === 'CRITICAL_BLOCKING';
}

export function isDiagnosticInconclusive(diag: RenderSpatialDiagnostic): boolean {
  return (
    diag.verificationOutcome === 'INCONCLUSIVE' ||
    diag.canonicalOffsetClassification === 'INCONCLUSIVE'
  );
}

function lerpPoint(a: RenderPoint2D, b: RenderPoint2D, t: number): RenderPoint2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

export function evaluateSegmentPointExact(
  seg: RenderCurveSegment,
  t: number
): RenderPoint2D | null {
  if (!Number.isFinite(t) || t < 0 || t > 1 || !isFiniteSegment(seg)) {
    return null;
  }
  const pt =
    seg.kind === 'cubic-bezier' && seg.p1 && seg.p2
      ? evaluateCubicBezierUnrounded(seg.p0, seg.p1, seg.p2, seg.p3, t)
      : lerpPoint(seg.p0, seg.p3, t);
  return isFinitePoint2D(pt) ? pt : null;
}

export interface CubicControlPoints {
  readonly p0: RenderPoint2D;
  readonly p1: RenderPoint2D;
  readonly p2: RenderPoint2D;
  readonly p3: RenderPoint2D;
}

/**
 * Exact 3-level De Casteljau split of a cubic Bézier curve at parameter `t ∈ [0, 1]`.
 */
export function splitCubicBezierDeCasteljau(
  p0: RenderPoint2D,
  p1: RenderPoint2D,
  p2: RenderPoint2D,
  p3: RenderPoint2D,
  t: number
): { readonly left: CubicControlPoints; readonly right: CubicControlPoints } | null {
  if (
    !Number.isFinite(t) ||
    t < 0 ||
    t > 1 ||
    !isFinitePoint2D(p0) ||
    !isFinitePoint2D(p1) ||
    !isFinitePoint2D(p2) ||
    !isFinitePoint2D(p3)
  ) {
    return null;
  }
  const q0 = lerpPoint(p0, p1, t);
  const q1 = lerpPoint(p1, p2, t);
  const q2 = lerpPoint(p2, p3, t);
  const r0 = lerpPoint(q0, q1, t);
  const r1 = lerpPoint(q1, q2, t);
  const s0 = lerpPoint(r0, r1, t);

  if (
    !isFinitePoint2D(q0) ||
    !isFinitePoint2D(q1) ||
    !isFinitePoint2D(q2) ||
    !isFinitePoint2D(r0) ||
    !isFinitePoint2D(r1) ||
    !isFinitePoint2D(s0)
  ) {
    return null;
  }

  return {
    left: { p0, p1: q0, p2: r0, p3: s0 },
    right: { p0: s0, p1: r1, p2: q2, p3 }
  };
}

/**
 * Extracts an exact parameter subsegment `[tStart, tEnd]` on a line or cubic Bézier segment.
 * Collapsed brackets (`tEnd - tStart <= COLLAPSED_INTERVAL_EPSILON`) are explicitly preserved
 * as `'collapsed-point'` markers rather than discarded.
 */
export function extractSegmentIntervalExact(
  seg: RenderCurveSegment,
  tStart: number,
  tEnd: number
): ExtractedDiagnosticInterval | null {
  if (
    !Number.isFinite(tStart) ||
    !Number.isFinite(tEnd) ||
    tStart < 0 ||
    tEnd > 1 ||
    tEnd < tStart ||
    !isFiniteSegment(seg)
  ) {
    return null;
  }

  const tMid = 0.5 * (tStart + tEnd);
  if (tEnd - tStart <= COLLAPSED_INTERVAL_EPSILON) {
    const pt = evaluateSegmentPointExact(seg, tMid);
    if (!pt) return null;
    return {
      kind: 'collapsed-point',
      tStart,
      tEnd,
      tMid,
      pointCm: pt
    };
  }

  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    const firstSplit = splitCubicBezierDeCasteljau(seg.p0, seg.p1, seg.p2, seg.p3, tEnd);
    if (!firstSplit) return null;
    const prefix = firstSplit.left; // represents [0, tEnd]
    let sub: CubicControlPoints;
    if (tStart === 0) {
      sub = prefix;
    } else {
      const u = tStart / tEnd;
      if (!Number.isFinite(u) || u < 0 || u > 1) return null;
      const secondSplit = splitCubicBezierDeCasteljau(
        prefix.p0,
        prefix.p1,
        prefix.p2,
        prefix.p3,
        u
      );
      if (!secondSplit) return null;
      sub = secondSplit.right;
    }
    const midPt = evaluateCubicBezierUnrounded(sub.p0, sub.p1, sub.p2, sub.p3, 0.5);
    if (!isFinitePoint2D(midPt)) return null;
    return {
      kind: 'cubic-subsegment',
      tStart,
      tEnd,
      p0: sub.p0,
      p1: sub.p1,
      p2: sub.p2,
      p3: sub.p3,
      midpointCm: midPt
    };
  }

  const p0 = lerpPoint(seg.p0, seg.p3, tStart);
  const p3 = lerpPoint(seg.p0, seg.p3, tEnd);
  const midpointCm = lerpPoint(seg.p0, seg.p3, tMid);
  if (!isFinitePoint2D(p0) || !isFinitePoint2D(p3) || !isFinitePoint2D(midpointCm)) {
    return null;
  }
  return {
    kind: 'line-subsegment',
    tStart,
    tEnd,
    p0,
    p3,
    midpointCm
  };
}

// ---------------------------------------------------------------------------
// 2. Artifact Identity & Stage-1 Pure Artifact-Level Resolution
// ---------------------------------------------------------------------------

export function computeArtifactIdentityKey(artifact: PatternArtifactBundle | null): string {
  if (!artifact) return 'empty';
  const pieceSig = artifact.pieces.map(p => p.pieceId).join(',');
  const diagSig = artifact.diagnostics
    .map(d => `${d.id}:${d.code}:${d.pieceId ?? ''}:${d.segmentId ?? ''}`)
    .join('|');
  return [
    artifact.authorityTier,
    artifact.provenance.specificationRevisionId,
    artifact.provenance.measurementRevisionId,
    artifact.provenance.artifactDigestSha256 ?? '',
    pieceSig,
    String(artifact.diagnostics.length),
    diagSig
  ].join('::');
}

interface IndexedPieceSegments {
  readonly piece: PatternPieceRenderModel;
  readonly sewById: ReadonlyMap<string, RenderCurveSegment>;
  readonly cutById: ReadonlyMap<string, RenderCurveSegment>;
}

type SegmentLookupResult =
  | { readonly ok: true; readonly segment: RenderCurveSegment; readonly contour: DiagnosticContourScope }
  | { readonly ok: false; readonly reason: 'stale' | 'ambiguous' };

function lookupPieceSegment(
  indexed: IndexedPieceSegments,
  segmentId: string,
  preferredContour?: DiagnosticContourScope
): SegmentLookupResult {
  const sew = indexed.sewById.get(segmentId);
  const cut = indexed.cutById.get(segmentId);

  if (preferredContour === 'sew') {
    return sew ? { ok: true, segment: sew, contour: 'sew' } : { ok: false, reason: 'stale' };
  }
  if (preferredContour === 'cut') {
    return cut ? { ok: true, segment: cut, contour: 'cut' } : { ok: false, reason: 'stale' };
  }

  if (sew && cut) {
    return { ok: false, reason: 'ambiguous' };
  }
  if (sew) {
    return { ok: true, segment: sew, contour: 'sew' };
  }
  if (cut) {
    return { ok: true, segment: cut, contour: 'cut' };
  }
  return { ok: false, reason: 'stale' };
}

function validateParameterIntervalsInput(
  intervals: readonly DiagnosticParameterInterval[] | undefined
): { readonly valid: true } | { readonly valid: false; readonly reason: string } {
  if (!intervals || intervals.length === 0) return { valid: true };
  for (let i = 0; i < intervals.length; i++) {
    const pair = intervals[i];
    if (!Array.isArray(pair) || pair.length !== 2) {
      return { valid: false, reason: `Parameter interval #${i} is malformed.` };
    }
    const [t0, t1] = pair;
    if (
      typeof t0 !== 'number' ||
      typeof t1 !== 'number' ||
      !Number.isFinite(t0) ||
      !Number.isFinite(t1)
    ) {
      return { valid: false, reason: `Parameter interval #${i} contains non-finite bounds.` };
    }
    if (t0 < 0 || t1 > 1 || t1 < t0) {
      return {
        valid: false,
        reason: `Parameter interval [${t0}, ${t1}] is inverted or outside [0, 1] (no clamping).`
      };
    }
  }
  return { valid: true };
}

function computePieceBadgeLocalAnchor(
  piece: PatternPieceRenderModel,
  yAxisDirection: PatternArtifactBundle['coordinateFrame']['yAxisDirection']
): RenderPoint2D {
  const bb = piece.boundingBoxCm;
  const w = Math.max(0, bb.maxX - bb.minX);
  const h = Math.max(0, bb.maxY - bb.minY);
  const insetX = Math.min(2.2, w * 0.14);
  const insetY = Math.min(2.2, h * 0.14);
  return {
    x: bb.maxX - insetX,
    y: yAxisDirection === 'cartesian-y-up' ? bb.maxY - insetY : bb.minY + insetY
  };
}

export const EMPTY_RESOLVED_DIAGNOSTICS: ResolvedArtifactDiagnostics = {
  artifactIdentityKey: 'empty',
  items: [],
  byKey: new Map<string, ResolvedSpatialDiagnostic>(),
  mappedItems: [],
  preSortedMappedItems: [],
  unmappedItems: [],
  staleOrInvalidItems: [],
  summary: {
    total: 0,
    mappedCount: 0,
    unmappedCount: 0,
    staleCount: 0,
    invalidCount: 0,
    inconclusiveCount: 0,
    bySeverity: {
      CRITICAL_BLOCKING: 0,
      ERROR: 0,
      WARNING: 0,
      INFO: 0
    }
  },
  summaryByPieceId: {}
};

function resolveSingleDiagnostic(
  diag: RenderSpatialDiagnostic,
  diagnosticKey: string,
  occurrenceIndex: number,
  piecesIndex: ReadonlyMap<string, IndexedPieceSegments>,
  yAxisDirection: PatternArtifactBundle['coordinateFrame']['yAxisDirection']
): ResolvedSpatialDiagnostic {
  const isInconclusive = isDiagnosticInconclusive(diag);

  const makeNonMapped = (
    outcome: 'unmapped' | 'stale-reference' | 'invalid-reference',
    resolutionNote: string,
    pieceMeta?: { pieceId: string; pieceCode: string; pieceName: string }
  ): ResolvedSpatialDiagnostic => ({
    diagnosticKey,
    occurrenceIndex,
    source: diag,
    outcome,
    isMapped: false,
    isInconclusive,
    pieceId: pieceMeta?.pieceId,
    pieceCode: pieceMeta?.pieceCode,
    pieceName: pieceMeta?.pieceName,
    contourScope: diag.contour,
    resolvedSegments: [],
    missingSecondarySegmentIds: [],
    ambiguousSecondarySegmentIds: [],
    extractedIntervals: [],
    resolutionNote
  });

  // Pre-validation: fail closed on invalid explicit point / parameter / interval values
  if (diag.anchorPointCm !== undefined) {
    if (!isFinitePoint2D(diag.anchorPointCm)) {
      const pieceMeta = diag.pieceId ? piecesIndex.get(diag.pieceId)?.piece : undefined;
      return makeNonMapped(
        'invalid-reference',
        'Non-finite anchorPointCm coordinates (fail-closed: refusing to render).',
        pieceMeta
          ? { pieceId: pieceMeta.pieceId, pieceCode: pieceMeta.pieceCode, pieceName: pieceMeta.name }
          : undefined
      );
    }
    if (diag.anchorCoordinateSpace !== 'board' && !diag.pieceId) {
      return makeNonMapped(
        'invalid-reference',
        'Piece-local anchorPointCm supplied without pieceId (fail-closed: refusing to place at board origin).'
      );
    }
  }

  if (diag.parameterT !== undefined) {
    if (
      typeof diag.parameterT !== 'number' ||
      !Number.isFinite(diag.parameterT) ||
      diag.parameterT < 0 ||
      diag.parameterT > 1
    ) {
      const pieceMeta = diag.pieceId ? piecesIndex.get(diag.pieceId)?.piece : undefined;
      return makeNonMapped(
        'invalid-reference',
        `Out-of-range or non-finite parameterT (${String(diag.parameterT)}; expected finite value in [0, 1], no clamping).`,
        pieceMeta
          ? { pieceId: pieceMeta.pieceId, pieceCode: pieceMeta.pieceCode, pieceName: pieceMeta.name }
          : undefined
      );
    }
  }

  const intervalValidation = validateParameterIntervalsInput(diag.parameterIntervals);
  if (!intervalValidation.valid) {
    const pieceMeta = diag.pieceId ? piecesIndex.get(diag.pieceId)?.piece : undefined;
    return makeNonMapped(
      'invalid-reference',
      intervalValidation.reason,
      pieceMeta
        ? { pieceId: pieceMeta.pieceId, pieceCode: pieceMeta.pieceCode, pieceName: pieceMeta.name }
        : undefined
    );
  }

  // Step 1: Resolve referenced piece
  if (!diag.pieceId) {
    if (diag.anchorPointCm !== undefined && diag.anchorCoordinateSpace === 'board') {
      return {
        diagnosticKey,
        occurrenceIndex,
        source: diag,
        outcome: 'mapped-point',
        isMapped: true,
        isInconclusive,
        anchorCoordinateSpace: 'board',
        boardAnchorOverrideCm: { x: diag.anchorPointCm.x, y: diag.anchorPointCm.y },
        resolvedSegments: [],
        missingSecondarySegmentIds: [],
        ambiguousSecondarySegmentIds: [],
        extractedIntervals: [],
        resolutionNote: 'Mapped to explicit board-space coordinate.'
      };
    }

    if (
      diag.segmentId !== undefined ||
      diag.parameterT !== undefined ||
      (diag.parameterIntervals && diag.parameterIntervals.length > 0)
    ) {
      return makeNonMapped(
        'invalid-reference',
        'Segment, parameter, or interval supplied without owning pieceId (fail-closed: never invent piece references).'
      );
    }

    // Step 8: Genuinely global diagnostic without spatial reference
    return makeNonMapped(
      'unmapped',
      'Global diagnostic without spatial piece or geometry reference (preserved without fabricated pin).'
    );
  }

  const indexedPiece = piecesIndex.get(diag.pieceId);
  if (!indexedPiece) {
    return makeNonMapped(
      'stale-reference',
      `Referenced piece "${diag.pieceId}" does not exist in the active artifact.`
    );
  }

  const piece = indexedPiece.piece;
  const pieceMeta = {
    pieceId: piece.pieceId,
    pieceCode: piece.pieceCode,
    pieceName: piece.name
  };

  // Helper to resolve secondary segments cleanly without inventing geometry
  const resolveSecondarySegments = (
    primaryId: string | undefined,
    preferredContour: DiagnosticContourScope | undefined
  ): {
    readonly resolved: ResolvedDiagnosticSegment[];
    readonly missing: string[];
    readonly ambiguous: string[];
  } => {
    const resolved: ResolvedDiagnosticSegment[] = [];
    const missing: string[] = [];
    const ambiguous: string[] = [];
    const seen = new Set<string>(primaryId ? [primaryId] : []);

    for (const secId of diag.secondarySegmentIds ?? []) {
      if (!secId || seen.has(secId)) continue;
      seen.add(secId);
      let res = lookupPieceSegment(indexedPiece, secId, preferredContour);
      if (!res.ok && res.reason === 'stale' && preferredContour !== undefined) {
        // Allow unambiguous cross-contour lookup if secondary segment lives on the other contour
        res = lookupPieceSegment(indexedPiece, secId, undefined);
      }
      if (res.ok && isFiniteSegment(res.segment)) {
        resolved.push({
          segmentId: secId,
          contour: res.contour,
          isPrimary: false,
          segment: res.segment
        });
      } else if (!res.ok && res.reason === 'ambiguous') {
        ambiguous.push(secId);
      } else {
        missing.push(secId);
      }
    }
    return { resolved, missing, ambiguous };
  };

  // Step 2: Explicit finite point coordinates (`anchorPointCm`)
  if (diag.anchorPointCm !== undefined) {
    const resolvedSegments: ResolvedDiagnosticSegment[] = [];
    const missingSecondary: string[] = [];
    const ambiguousSecondary: string[] = [];
    let resolvedContour: DiagnosticContourScope | undefined = diag.contour;

    if (diag.segmentId) {
      const primaryRes = lookupPieceSegment(indexedPiece, diag.segmentId, diag.contour);
      if (primaryRes.ok && isFiniteSegment(primaryRes.segment)) {
        resolvedSegments.push({
          segmentId: diag.segmentId,
          contour: primaryRes.contour,
          isPrimary: true,
          segment: primaryRes.segment
        });
        if (!resolvedContour) resolvedContour = primaryRes.contour;
      }
      const sec = resolveSecondarySegments(diag.segmentId, diag.contour);
      resolvedSegments.push(...sec.resolved);
      missingSecondary.push(...sec.missing);
      ambiguousSecondary.push(...sec.ambiguous);
    }

    const isBoardSpace = diag.anchorCoordinateSpace === 'board';
    return {
      diagnosticKey,
      occurrenceIndex,
      source: diag,
      outcome: 'mapped-point',
      isMapped: true,
      isInconclusive,
      ...pieceMeta,
      contourScope: resolvedContour,
      anchorCoordinateSpace: isBoardSpace ? 'board' : 'piece-local',
      localAnchorCm: isBoardSpace
        ? undefined
        : { x: diag.anchorPointCm.x, y: diag.anchorPointCm.y },
      boardAnchorOverrideCm: isBoardSpace
        ? { x: diag.anchorPointCm.x, y: diag.anchorPointCm.y }
        : undefined,
      resolvedSegments,
      missingSecondarySegmentIds: missingSecondary,
      ambiguousSecondarySegmentIds: ambiguousSecondary,
      parameterT: diag.parameterT,
      extractedIntervals: [],
      resolutionNote: isBoardSpace
        ? 'Mapped to explicit board-space point.'
        : 'Mapped to explicit piece-local point.'
    };
  }

  // Step 3: Resolve segment references
  if (diag.segmentId !== undefined) {
    const primaryLookup = lookupPieceSegment(indexedPiece, diag.segmentId, diag.contour);
    if (!primaryLookup.ok) {
      if (primaryLookup.reason === 'ambiguous') {
        return makeNonMapped(
          'invalid-reference',
          `Ambiguous segment "${diag.segmentId}" exists in both sew and cut contours on piece "${piece.pieceId}" without contour qualifier.`,
          pieceMeta
        );
      }
      return makeNonMapped(
        'stale-reference',
        `Referenced segment "${diag.segmentId}" not found on piece "${piece.pieceId}".`,
        pieceMeta
      );
    }

    if (!isFiniteSegment(primaryLookup.segment)) {
      return makeNonMapped(
        'invalid-reference',
        `Segment "${diag.segmentId}" on piece "${piece.pieceId}" contains non-finite coordinates.`,
        pieceMeta
      );
    }

    const sec = resolveSecondarySegments(diag.segmentId, diag.contour);
    const resolvedSegments: ResolvedDiagnosticSegment[] = [
      {
        segmentId: diag.segmentId,
        contour: primaryLookup.contour,
        isPrimary: true,
        segment: primaryLookup.segment
      },
      ...sec.resolved
    ];

    // Step 4: Finite scalar `parameterT`
    if (diag.parameterT !== undefined) {
      const evalPt = evaluateSegmentPointExact(primaryLookup.segment, diag.parameterT);
      if (!evalPt) {
        return makeNonMapped(
          'invalid-reference',
          `Failed to evaluate finite point at parameter t=${diag.parameterT} on segment "${diag.segmentId}".`,
          pieceMeta
        );
      }
      return {
        diagnosticKey,
        occurrenceIndex,
        source: diag,
        outcome: 'mapped-parameter',
        isMapped: true,
        isInconclusive,
        ...pieceMeta,
        contourScope: primaryLookup.contour,
        anchorCoordinateSpace: 'piece-local',
        localAnchorCm: evalPt,
        resolvedSegments,
        missingSecondarySegmentIds: sec.missing,
        ambiguousSecondarySegmentIds: sec.ambiguous,
        parameterT: diag.parameterT,
        extractedIntervals: [],
        resolutionNote: `Mapped to parameter t=${diag.parameterT} on ${primaryLookup.contour} segment "${diag.segmentId}".`
      };
    }

    // Step 5: Valid parameter intervals (exact De Casteljau / line subsegments + collapsed brackets)
    if (diag.parameterIntervals && diag.parameterIntervals.length > 0) {
      const extractedIntervals: ExtractedDiagnosticInterval[] = [];
      for (const [tStart, tEnd] of diag.parameterIntervals) {
        const extracted = extractSegmentIntervalExact(primaryLookup.segment, tStart, tEnd);
        if (!extracted) {
          return makeNonMapped(
            'invalid-reference',
            `Failed to extract finite subsegment for interval [${tStart}, ${tEnd}] on segment "${diag.segmentId}".`,
            pieceMeta
          );
        }
        extractedIntervals.push(extracted);
      }

      const first = extractedIntervals[0];
      const anchorPt =
        first.kind === 'collapsed-point' ? first.pointCm : first.midpointCm;
      const collapsedCount = extractedIntervals.filter(i => i.kind === 'collapsed-point').length;

      return {
        diagnosticKey,
        occurrenceIndex,
        source: diag,
        outcome: 'mapped-interval',
        isMapped: true,
        isInconclusive,
        ...pieceMeta,
        contourScope: primaryLookup.contour,
        anchorCoordinateSpace: 'piece-local',
        localAnchorCm: anchorPt,
        resolvedSegments,
        missingSecondarySegmentIds: sec.missing,
        ambiguousSecondarySegmentIds: sec.ambiguous,
        extractedIntervals,
        resolutionNote:
          collapsedCount === extractedIntervals.length
            ? `Mapped ${collapsedCount} collapsed root bracket(s) on ${primaryLookup.contour} segment "${diag.segmentId}".`
            : `Mapped ${extractedIntervals.length} parameter interval(s) on ${primaryLookup.contour} segment "${diag.segmentId}".`
      };
    }

    // Step 6: Segment-level localization (primary + any secondary segments)
    const midPt = evaluateSegmentPointExact(primaryLookup.segment, 0.5);
    if (!midPt) {
      return makeNonMapped(
        'invalid-reference',
        `Failed to evaluate midpoint on segment "${diag.segmentId}".`,
        pieceMeta
      );
    }

    return {
      diagnosticKey,
      occurrenceIndex,
      source: diag,
      outcome: 'mapped-segment',
      isMapped: true,
      isInconclusive,
      ...pieceMeta,
      contourScope: primaryLookup.contour,
      anchorCoordinateSpace: 'piece-local',
      localAnchorCm: midPt,
      resolvedSegments,
      missingSecondarySegmentIds: sec.missing,
      ambiguousSecondarySegmentIds: sec.ambiguous,
      extractedIntervals: [],
      resolutionNote:
        resolvedSegments.length > 1
          ? `Mapped to ${resolvedSegments.length} segments on piece "${piece.pieceCode}".`
          : `Mapped to ${primaryLookup.contour} segment "${diag.segmentId}".`
    };
  }

  // No segmentId: parameterT or parameterIntervals cannot be evaluated without a segment
  if (
    diag.parameterT !== undefined ||
    (diag.parameterIntervals && diag.parameterIntervals.length > 0)
  ) {
    return makeNonMapped(
      'invalid-reference',
      'Parameter or parameter interval supplied without segmentId (fail-closed).',
      pieceMeta
    );
  }

  // Step 7: Piece-level localization
  if (!isFiniteBoundingBox(piece.boundingBoxCm)) {
    return makeNonMapped(
      'invalid-reference',
      `Piece "${piece.pieceId}" boundingBoxCm contains non-finite coordinates.`,
      pieceMeta
    );
  }

  const localAnchorCm = computePieceBadgeLocalAnchor(piece, yAxisDirection);
  return {
    diagnosticKey,
    occurrenceIndex,
    source: diag,
    outcome: 'mapped-piece',
    isMapped: true,
    isInconclusive,
    ...pieceMeta,
    contourScope: diag.contour,
    anchorCoordinateSpace: 'piece-local',
    localAnchorCm,
    localBoundsCm: {
      minX: piece.boundingBoxCm.minX,
      minY: piece.boundingBoxCm.minY,
      maxX: piece.boundingBoxCm.maxX,
      maxY: piece.boundingBoxCm.maxY
    },
    resolvedSegments: [],
    missingSecondarySegmentIds: [],
    ambiguousSecondarySegmentIds: [],
    extractedIntervals: [],
    resolutionNote: `Mapped to piece "${piece.pieceCode}" (${piece.name}).`
  };
}

/**
 * Stage 1 (Artifact-Level): Resolves all diagnostics in a `PatternArtifactBundle` into
 * deterministic piece-local geometric targets, strictly independent of board arrangement
 * offsets and camera pan/zoom so board drags never recompute artifact resolution.
 */
export function resolveArtifactDiagnostics(
  artifact: PatternArtifactBundle | null
): ResolvedArtifactDiagnostics {
  if (!artifact) return EMPTY_RESOLVED_DIAGNOSTICS;

  const artifactIdentityKey = computeArtifactIdentityKey(artifact);
  if (artifact.diagnostics.length === 0) {
    return {
      ...EMPTY_RESOLVED_DIAGNOSTICS,
      artifactIdentityKey
    };
  }

  const piecesIndex = new Map<string, IndexedPieceSegments>();
  for (const piece of artifact.pieces) {
    const sewById = new Map<string, RenderCurveSegment>();
    for (const seg of piece.sewSegments) {
      if (!sewById.has(seg.id)) sewById.set(seg.id, seg);
    }
    const cutById = new Map<string, RenderCurveSegment>();
    for (const seg of piece.cutSegments) {
      if (!cutById.has(seg.id)) cutById.set(seg.id, seg);
    }
    piecesIndex.set(piece.pieceId, { piece, sewById, cutById });
  }

  const occurrenceCounts = new Map<string, number>();
  const items: ResolvedSpatialDiagnostic[] = [];
  const byKey = new Map<string, ResolvedSpatialDiagnostic>();
  const mappedItems: ResolvedSpatialDiagnostic[] = [];
  const unmappedItems: ResolvedSpatialDiagnostic[] = [];
  const staleOrInvalidItems: ResolvedSpatialDiagnostic[] = [];

  const bySeverity: Record<DiagnosticSeverity, number> = {
    CRITICAL_BLOCKING: 0,
    ERROR: 0,
    WARNING: 0,
    INFO: 0
  };
  let mappedCount = 0;
  let unmappedCount = 0;
  let staleCount = 0;
  let invalidCount = 0;
  let inconclusiveCount = 0;

  const pieceAcc = new Map<
    string,
    {
      total: number;
      blockingCount: number;
      warningCount: number;
      infoCount: number;
      inconclusiveCount: number;
      highestSeverity: DiagnosticSeverity;
      firstDiagnosticKey: string;
    }
  >();

  for (const diag of artifact.diagnostics) {
    const occ = occurrenceCounts.get(diag.id) ?? 0;
    occurrenceCounts.set(diag.id, occ + 1);
    const diagnosticKey = `${diag.id}::#${occ}`;

    const resolved = resolveSingleDiagnostic(
      diag,
      diagnosticKey,
      occ,
      piecesIndex,
      artifact.coordinateFrame.yAxisDirection
    );

    items.push(resolved);
    byKey.set(diagnosticKey, resolved);
    bySeverity[diag.severity] += 1;
    if (resolved.isInconclusive) inconclusiveCount += 1;

    if (resolved.isMapped) {
      mappedCount += 1;
      mappedItems.push(resolved);
    } else if (resolved.outcome === 'unmapped') {
      unmappedCount += 1;
      unmappedItems.push(resolved);
    } else if (resolved.outcome === 'stale-reference') {
      staleCount += 1;
      staleOrInvalidItems.push(resolved);
    } else {
      invalidCount += 1;
      staleOrInvalidItems.push(resolved);
    }

    if (resolved.pieceId) {
      const existing = pieceAcc.get(resolved.pieceId);
      const isBlocking = isBlockingDiagnosticSeverity(diag.severity);
      const isWarn = diag.severity === 'WARNING';
      const isInfo = diag.severity === 'INFO';
      if (!existing) {
        pieceAcc.set(resolved.pieceId, {
          total: 1,
          blockingCount: isBlocking ? 1 : 0,
          warningCount: isWarn ? 1 : 0,
          infoCount: isInfo ? 1 : 0,
          inconclusiveCount: resolved.isInconclusive ? 1 : 0,
          highestSeverity: diag.severity,
          firstDiagnosticKey: diagnosticKey
        });
      } else {
        existing.total += 1;
        if (isBlocking) existing.blockingCount += 1;
        if (isWarn) existing.warningCount += 1;
        if (isInfo) existing.infoCount += 1;
        if (resolved.isInconclusive) existing.inconclusiveCount += 1;
        if (
          DIAGNOSTIC_SEVERITY_RANK[diag.severity] >
          DIAGNOSTIC_SEVERITY_RANK[existing.highestSeverity]
        ) {
          existing.highestSeverity = diag.severity;
          existing.firstDiagnosticKey = diagnosticKey;
        }
      }
    }
  }

  const summaryByPieceId: Record<string, PieceDiagnosticSummary> = {};
  for (const [pieceId, acc] of pieceAcc.entries()) {
    summaryByPieceId[pieceId] = { pieceId, ...acc };
  }

  // Pre-compute deterministic Stage-2 clustering order once per artifact so pan/zoom
  // frames avoid O(N log N) localeCompare sorting on every camera update.
  const preSortedMappedItems =
    mappedItems.length > 1
      ? [...mappedItems].sort((a, b) => {
          const sevDiff =
            DIAGNOSTIC_SEVERITY_RANK[b.source.severity] -
            DIAGNOSTIC_SEVERITY_RANK[a.source.severity];
          if (sevDiff !== 0) return sevDiff;
          if (a.isInconclusive !== b.isInconclusive) {
            return a.isInconclusive ? -1 : 1;
          }
          return a.diagnosticKey.localeCompare(b.diagnosticKey);
        })
      : mappedItems;

  return {
    artifactIdentityKey,
    items,
    byKey,
    mappedItems,
    preSortedMappedItems,
    unmappedItems,
    staleOrInvalidItems,
    summary: {
      total: items.length,
      mappedCount,
      unmappedCount,
      staleCount,
      invalidCount,
      inconclusiveCount,
      bySeverity
    },
    summaryByPieceId
  };
}

// ---------------------------------------------------------------------------
// 3. Stage-2 Board Projection, D3/D5 Visibility Rules & Spatial Hash Clustering
// ---------------------------------------------------------------------------

function resolveHiddenHostLayer(
  resolved: ResolvedSpatialDiagnostic,
  layerVisibility: DiagnosticLayerVisibilityInput
): { readonly hiddenHostLayer: DiagnosticContourScope | null; readonly shouldHide: boolean } {
  // Determine contour dependency
  let hostContour: DiagnosticContourScope | null = null;
  if (resolved.resolvedSegments.length > 0) {
    const contours = new Set(resolved.resolvedSegments.map(s => s.contour));
    if (contours.size === 1) {
      hostContour = Array.from(contours)[0];
    } else if (resolved.contourScope) {
      hostContour = resolved.contourScope;
    }
  } else if (resolved.contourScope) {
    hostContour = resolved.contourScope;
  }

  if (!hostContour) {
    return { hiddenHostLayer: null, shouldHide: false };
  }

  const hostLayerVisible =
    hostContour === 'sew' ? layerVisibility.showSewLines : layerVisibility.showSeamAllowance;

  if (hostLayerVisible) {
    return { hiddenHostLayer: null, shouldHide: false };
  }

  // D5: ERROR and CRITICAL_BLOCKING remain visible when their host sew/cut layer is hidden,
  // with explicit disclosure. INFO and WARNING respect contour visibility.
  if (isBlockingDiagnosticSeverity(resolved.source.severity)) {
    return { hiddenHostLayer: hostContour, shouldHide: false };
  }
  return { hiddenHostLayer: hostContour, shouldHide: true };
}

export interface ProjectDiagnosticsOptions {
  readonly showOverlay: boolean;
  readonly severityFilter: DiagnosticSeverityFilter;
  readonly selectedDiagnosticKey: string | null;
  readonly hoveredDiagnosticKey: string | null;
  readonly clusterRadiusPx?: number;
  readonly viewportCullMarginPx?: number;
}

/**
 * Stage 2 (Board + Viewport Projection): Cheap O(N) offset application, D3/D5 visibility
 * filtering, screen-space viewport culling, and O(N) spatial-hash marker clustering.
 */
export function projectDiagnosticsForCanvas(
  resolved: ResolvedArtifactDiagnostics,
  boardOffsetsByPieceId: Readonly<Record<string, BoardPieceOffsetVisibility>>,
  layerVisibility: DiagnosticLayerVisibilityInput,
  camera: CadCamera,
  projection: CadCoordinateProjection,
  viewportSize: { readonly width: number; readonly height: number },
  options: ProjectDiagnosticsOptions
): ProjectedCanvasDiagnostics {
  if (!options.showOverlay || resolved.mappedItems.length === 0) {
    return {
      visibleItems: [],
      clusters: [],
      hiddenByLayerCount: 0,
      hiddenByFilterCount: 0,
      culledOffscreenCount: 0
    };
  }

  const clusterRadiusPx =
    options.clusterRadiusPx !== undefined &&
    Number.isFinite(options.clusterRadiusPx) &&
    options.clusterRadiusPx > 0
      ? options.clusterRadiusPx
      : DEFAULT_DIAGNOSTIC_CLUSTER_RADIUS_PX;

  const cullMargin =
    options.viewportCullMarginPx !== undefined && Number.isFinite(options.viewportCullMarginPx)
      ? options.viewportCullMarginPx
      : DEFAULT_VIEWPORT_CULL_MARGIN_PX;

  const enableViewportCull = viewportSize.width > 0 && viewportSize.height > 0;

  let hiddenByLayerCount = 0;
  let hiddenByFilterCount = 0;
  let culledOffscreenCount = 0;
  const visibleItems: ProjectedDiagnosticItem[] = [];

  const sourceMappedItems = resolved.preSortedMappedItems ?? resolved.mappedItems;
  for (const item of sourceMappedItems) {
    if (!options.severityFilter[item.source.severity]) {
      hiddenByFilterCount += 1;
      continue;
    }

    // Check piece-level board visibility
    const piecePlacement = item.pieceId ? boardOffsetsByPieceId[item.pieceId] : undefined;
    if (piecePlacement && !piecePlacement.visible) {
      hiddenByLayerCount += 1;
      continue;
    }

    // Apply D5 sew/cut contour visibility rules
    const layerCheck = resolveHiddenHostLayer(item, layerVisibility);
    if (layerCheck.shouldHide) {
      hiddenByLayerCount += 1;
      continue;
    }

    const offsetXCm = piecePlacement?.offsetXCm ?? 0;
    const offsetYCm = piecePlacement?.offsetYCm ?? 0;

    const boardAnchorCm: RenderPoint2D | null =
      item.boardAnchorOverrideCm ??
      (item.localAnchorCm
        ? {
            x: item.localAnchorCm.x + offsetXCm,
            y: item.localAnchorCm.y + offsetYCm
          }
        : null);

    if (!boardAnchorCm || !isFinitePoint2D(boardAnchorCm)) {
      continue;
    }

    const screenAnchorPx = worldCmToScreen(boardAnchorCm, camera, projection);
    if (!isFinitePoint2D(screenAnchorPx)) {
      continue;
    }

    const isSelected = item.diagnosticKey === options.selectedDiagnosticKey;
    const isHovered = item.diagnosticKey === options.hoveredDiagnosticKey;

    if (
      enableViewportCull &&
      !isSelected &&
      !isHovered &&
      (screenAnchorPx.x < -cullMargin ||
        screenAnchorPx.x > viewportSize.width + cullMargin ||
        screenAnchorPx.y < -cullMargin ||
        screenAnchorPx.y > viewportSize.height + cullMargin)
    ) {
      culledOffscreenCount += 1;
      continue;
    }

    const boardBoundsCm: CadRectCm | undefined = item.localBoundsCm
      ? {
          minX: item.localBoundsCm.minX + offsetXCm,
          minY: item.localBoundsCm.minY + offsetYCm,
          maxX: item.localBoundsCm.maxX + offsetXCm,
          maxY: item.localBoundsCm.maxY + offsetYCm
        }
      : undefined;

    visibleItems.push({
      resolved: item,
      boardOffsetCm: { x: offsetXCm, y: offsetYCm },
      boardAnchorCm,
      screenAnchorPx,
      boardBoundsCm,
      hiddenHostLayer: layerCheck.hiddenHostLayer,
      isSelected,
      isHovered
    });
  }

  // Deterministic ordering before clustering: severity desc, inconclusive desc, diagnosticKey asc
  // Skipped when Stage 1 already pre-sorted mappedItems in this exact order.
  if (!resolved.preSortedMappedItems && visibleItems.length > 1) {
    visibleItems.sort((a, b) => {
      const sevDiff =
        DIAGNOSTIC_SEVERITY_RANK[b.resolved.source.severity] -
        DIAGNOSTIC_SEVERITY_RANK[a.resolved.source.severity];
      if (sevDiff !== 0) return sevDiff;
      if (a.resolved.isInconclusive !== b.resolved.isInconclusive) {
        return a.resolved.isInconclusive ? -1 : 1;
      }
      return a.resolved.diagnosticKey.localeCompare(b.resolved.diagnosticKey);
    });
  }

  // O(N) spatial hash clustering in screen space
  const clusters = clusterProjectedDiagnostics(visibleItems, clusterRadiusPx);

  return {
    visibleItems,
    clusters,
    hiddenByLayerCount,
    hiddenByFilterCount,
    culledOffscreenCount
  };
}

/**
 * Deterministic spatial-hash grid clustering of screen-projected diagnostic markers.
 * Average complexity O(N) — checks only the 3×3 neighboring cells around each marker.
 */
export function clusterProjectedDiagnostics(
  sortedItems: readonly ProjectedDiagnosticItem[],
  clusterRadiusPx: number = DEFAULT_DIAGNOSTIC_CLUSTER_RADIUS_PX
): readonly DiagnosticMarkerCluster[] {
  if (sortedItems.length === 0) return [];

  const radius = Math.max(1, clusterRadiusPx);
  const radiusSq = radius * radius;

  interface MutableCluster {
    readonly index: number;
    readonly members: ProjectedDiagnosticItem[];
    readonly primaryMember: ProjectedDiagnosticItem;
    highestSeverity: DiagnosticSeverity;
    hasInconclusive: boolean;
    hasHiddenHostLayer: boolean;
    containsSelected: boolean;
    containsHovered: boolean;
    readonly anchorScreen: RenderPoint2D;
    readonly anchorBoard: RenderPoint2D;
  }

  const clusters: MutableCluster[] = [];
  const grid = new Map<number, number[]>();

  // Exact integer packing for grid indices in [-2_097_152, +2_097_151] avoids
  // per-cell string allocations inside the 3x3 neighborhood loop.
  const GRID_BIAS = 0x200000;
  const GRID_STRIDE = 0x400000;
  const cellKey = (cx: number, cy: number) => (cx + GRID_BIAS) * GRID_STRIDE + (cy + GRID_BIAS);

  for (const item of sortedItems) {
    const sx = item.screenAnchorPx.x;
    const sy = item.screenAnchorPx.y;
    const gx = Math.floor(sx / radius);
    const gy = Math.floor(sy / radius);

    let bestClusterIdx = -1;
    let bestDistSq = radiusSq + 1;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(cellKey(gx + dx, gy + dy));
        if (!bucket) continue;
        for (const cIdx of bucket) {
          const cluster = clusters[cIdx];
          const ddx = sx - cluster.anchorScreen.x;
          const ddy = sy - cluster.anchorScreen.y;
          const distSq = ddx * ddx + ddy * ddy;
          if (
            distSq <= radiusSq &&
            (distSq < bestDistSq || (distSq === bestDistSq && cIdx < bestClusterIdx))
          ) {
            bestDistSq = distSq;
            bestClusterIdx = cIdx;
          }
        }
      }
    }

    if (bestClusterIdx !== -1) {
      const target = clusters[bestClusterIdx];
      target.members.push(item);
      if (
        DIAGNOSTIC_SEVERITY_RANK[item.resolved.source.severity] >
        DIAGNOSTIC_SEVERITY_RANK[target.highestSeverity]
      ) {
        target.highestSeverity = item.resolved.source.severity;
      }
      if (item.resolved.isInconclusive) target.hasInconclusive = true;
      if (item.hiddenHostLayer !== null) target.hasHiddenHostLayer = true;
      if (item.isSelected) target.containsSelected = true;
      if (item.isHovered) target.containsHovered = true;
    } else {
      const newIdx = clusters.length;
      clusters.push({
        index: newIdx,
        members: [item],
        primaryMember: item,
        highestSeverity: item.resolved.source.severity,
        hasInconclusive: item.resolved.isInconclusive,
        hasHiddenHostLayer: item.hiddenHostLayer !== null,
        containsSelected: item.isSelected,
        containsHovered: item.isHovered,
        anchorScreen: item.screenAnchorPx,
        anchorBoard: item.boardAnchorCm
      });
      const key = cellKey(gx, gy);
      const bucket = grid.get(key);
      if (bucket) {
        bucket.push(newIdx);
      } else {
        grid.set(key, [newIdx]);
      }
    }
  }

  return clusters.map(c => ({
    clusterId:
      c.members.length === 1
        ? c.primaryMember.resolved.diagnosticKey
        : `cluster::${c.members.map(m => m.resolved.diagnosticKey).join('|')}`,
    members: c.members,
    primaryMember: c.primaryMember,
    highestSeverity: c.highestSeverity,
    hasInconclusive: c.hasInconclusive,
    hasHiddenHostLayer: c.hasHiddenHostLayer,
    containsSelected: c.containsSelected,
    containsHovered: c.containsHovered,
    boardAnchorCm: c.anchorBoard,
    screenAnchorPx: c.anchorScreen
  }));
}

// ---------------------------------------------------------------------------
// 4. Selection Reconciliation & Focus Bounds Helper
// ---------------------------------------------------------------------------

export function reconcileDiagnosticSelection(
  selectedDiagnosticKey: string | null,
  resolved: ResolvedArtifactDiagnostics
): DiagnosticSelectionReconciliationResult {
  if (!selectedDiagnosticKey) {
    return {
      selectedDiagnosticKey: null,
      wasClearedDueToStaleArtifact: false,
      previousKey: null
    };
  }

  if (resolved.byKey.has(selectedDiagnosticKey)) {
    return {
      selectedDiagnosticKey,
      wasClearedDueToStaleArtifact: false,
      previousKey: selectedDiagnosticKey
    };
  }

  return {
    selectedDiagnosticKey: null,
    wasClearedDueToStaleArtifact: true,
    previousKey: selectedDiagnosticKey
  };
}

/**
 * Computes a world-space centimeter focus rectangle for centering the CAD camera
 * on a mapped diagnostic (`"Locate on Canvas"`). Returns `null` for unmapped/stale/invalid.
 */
export function computeDiagnosticFocusBoundsCm(
  resolved: ResolvedSpatialDiagnostic | undefined,
  boardOffsetCm: RenderPoint2D
): CadRectCm | null {
  if (!resolved || !resolved.isMapped) return null;

  if (resolved.outcome === 'mapped-piece' && resolved.localBoundsCm) {
    return {
      minX: resolved.localBoundsCm.minX + boardOffsetCm.x,
      minY: resolved.localBoundsCm.minY + boardOffsetCm.y,
      maxX: resolved.localBoundsCm.maxX + boardOffsetCm.x,
      maxY: resolved.localBoundsCm.maxY + boardOffsetCm.y
    };
  }

  const pts: RenderPoint2D[] = [];
  if (resolved.boardAnchorOverrideCm) {
    pts.push(resolved.boardAnchorOverrideCm);
  } else if (resolved.localAnchorCm) {
    pts.push({
      x: resolved.localAnchorCm.x + boardOffsetCm.x,
      y: resolved.localAnchorCm.y + boardOffsetCm.y
    });
  }

  if (resolved.outcome === 'mapped-segment' || resolved.outcome === 'mapped-interval') {
    for (const segEntry of resolved.resolvedSegments) {
      const s = segEntry.segment;
      pts.push({ x: s.p0.x + boardOffsetCm.x, y: s.p0.y + boardOffsetCm.y });
      pts.push({ x: s.p3.x + boardOffsetCm.x, y: s.p3.y + boardOffsetCm.y });
      if (s.kind === 'cubic-bezier' && s.p1 && s.p2) {
        pts.push({ x: s.p1.x + boardOffsetCm.x, y: s.p1.y + boardOffsetCm.y });
        pts.push({ x: s.p2.x + boardOffsetCm.x, y: s.p2.y + boardOffsetCm.y });
      }
    }
  }

  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of pts) {
    if (!isFinitePoint2D(pt)) continue;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  if (!Number.isFinite(minX)) return null;

  const pad = 6;
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad
  };
}
