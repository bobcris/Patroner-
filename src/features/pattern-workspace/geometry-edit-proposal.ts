/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * UX-2.3.3.4 — Proposal-Based Precision Contour & Bézier Anchor Editing Engine.
 *
 * Pure, framework-agnostic TypeScript module for non-authoritative client-side
 * sew-contour geometry editing proposals.
 *
 * BINDING ARCHITECTURAL INVARIANTS (D1–D5, R1–R4):
 * - Source `PatternArtifactBundle` is strictly immutable and never mutated in place.
 * - Only `sewSegments` are editable; `cutSegments` remain read-only. Never generate
 *   replacement cutting offsets in TypeScript (D2).
 * - All edited geometry carries `authorityTier: 'UNVERIFIED_VISUAL_PROPOSAL'`,
 *   `isCertified: false`, `isProductionReady: false`, and
 *   `externalCadInteroperabilityVerified: false` (R3).
 * - Line-to-cubic degree elevation and De Casteljau subdivision are mathematically exact.
 *   Cubic-to-line conversion is explicitly approximate with deterministic max deviation,
 *   tolerance enforcement, preview, and explicit confirmation (R1).
 * - Vertex removal & segment merging preserves exact geometry only when mathematically
 *   justified (collinear line+line or exact cubic inverse within 1e-9 cm), otherwise uses
 *   a controlled approximation with measured deviation, preview, confirmation, and
 *   minimum-contour topology rejection (R2).
 * - Proposal history is strictly bounded (max 50 operations) and independent of board
 *   arrangement history and viewport state (D4).
 * - Artifact identity reconciliation does not assume `artifactDigestSha256` exists; it
 *   tracks available provenance plus a deterministic non-cryptographic geometry structural
 *   fingerprint, explicitly distinguishing missing vs verified digests (R4).
 * - JSON serialization is deterministic, full float64 precision, fail-closed on non-finite
 *   values, and read-only without any backend submission or endpoint claims (D5).
 */

import type {
  GeometryAuthorityTier,
  PatternArtifactBundle,
  PatternArtifactCoordinateFrame,
  PatternPieceRenderModel,
  RenderBoundingBoxCm,
  RenderCurveSegment,
  RenderPoint2D
} from './contracts/pattern-render-artifact';
import {
  COINCIDENT_VERTEX_EPSILON_CM,
  evaluateCubicBezierUnrounded,
  extractContourVertices,
  isFiniteRenderPoint,
  type ExtractedContourVertex
} from './entity-hit-test';
import {
  analyzeContourOrientation,
  CONTOUR_CLOSURE_EPSILON_CM,
  STATIONARY_DERIVATIVE_FLOOR,
  STATIONARY_RELATIVE_FACTOR,
  ZERO_LENGTH_EPSILON_CM
} from './precision-measurement';

export const PROPOSAL_AUTHORITY_TIER: 'UNVERIFIED_VISUAL_PROPOSAL' = 'UNVERIFIED_VISUAL_PROPOSAL';
export const PROPOSAL_STATE_SCHEMA_VERSION = 'patroner.geometry-proposal-state.v1' as const;
export const PROPOSAL_PAYLOAD_SCHEMA_VERSION = 'patroner.pattern-edit-proposal.v1' as const;
export const MAX_PROPOSAL_HISTORY_ENTRIES = 50;
export const DEFAULT_APPROXIMATION_TOLERANCE_CM = 0.25;
export const EXACT_MERGE_DEVIATION_EPSILON_CM = 1e-9;
export const MIN_CLOSED_CONTOUR_SEGMENTS = 3;
export const MIN_ADVISORY_SEGMENT_LENGTH_CM = 0.1;
export const MIN_VALID_SEGMENT_LENGTH_CM = 1e-6;
export const ADVISORY_PAIRED_SEAM_DELTA_WARNING_CM = 0.3;
export const ADVISORY_FOLDBACK_ANGLE_THRESHOLD_DEG = 2.0;

export const UNVERIFIED_PROPOSAL_DISCLOSURE =
  'Unverified client-side visual geometry proposal (isCertified: false, isProductionReady: false). Advisory checks only; authoritative geometry, cutting offsets, and certification require the Python geometry engine.';

export const STALE_CUT_CONTOUR_DISCLOSURE =
  'Cut contour reflects the original unedited sew boundary and is potentially stale. Client presentation layer does not regenerate cutting offsets.';

export type HandleContinuityMode = 'c0-corner' | 'g1-smooth' | 'symmetric';

export type ProposalReconciliationStatus =
  | 'aligned'
  | 'stale-artifact-changed'
  | 'stale-missing-references';

export type ProposalSegmentDerivation =
  | 'original'
  | 'modified'
  | 'split-exact'
  | 'elevated-exact'
  | 'cubic-to-line-approx'
  | 'merged-exact'
  | 'merged-approx';

export type ProposalIntegrityCheckStatus =
  | 'pass'
  | 'advisory-warning'
  | 'invalid-proposal'
  | 'unassessed';

export type ProposalIntegrityCheckId =
  | 'finite-coordinates'
  | 'contour-closure'
  | 'minimum-segment-length'
  | 'degenerate-collapsed-geometry'
  | 'contour-orientation-signed-area'
  | 'self-intersection'
  | 'stationary-cusp-foldback'
  | 'paired-seam-length-delta'
  | 'approximation-deviation'
  | 'source-reference-reconciliation';

export interface SourceArtifactIdentity {
  readonly schemaVersion: string;
  readonly specificationRevisionId: string;
  readonly measurementRevisionId: string;
  readonly engineVersion: string;
  readonly authorityTier: GeometryAuthorityTier;
  /** Strictly copied from source provenance when present; never fabricated. */
  readonly artifactDigestSha256: string | null;
  readonly hasVerifiedSourceDigest: boolean;
  /** Deterministic non-cryptographic presentation fingerprint of source contour geometry. */
  readonly geometryFingerprint: string;
  /** Original base sew segment IDs per piece for reconciliation. */
  readonly pieceBaseSewSegmentIds: Readonly<Record<string, readonly string[]>>;
}

export interface ProposalSegmentLineage {
  readonly segmentId: string;
  readonly baseSegmentIds: readonly string[];
  readonly derivation: ProposalSegmentDerivation;
  readonly maxApproximationDeviationCm: number;
  readonly approximationMethod?: string;
}

export interface ProposalApproximationRecord {
  readonly id: string;
  readonly operationKind: 'cubic-to-line' | 'remove-vertex-merge';
  readonly pieceId: string;
  readonly sourceSegmentIds: readonly string[];
  readonly resultSegmentId: string;
  readonly maxDeviationCm: number;
  readonly toleranceCm: number;
  readonly method: string;
}

export interface PieceGeometryProposal {
  readonly pieceId: string;
  readonly sewSegments: readonly RenderCurveSegment[];
  readonly segmentLineage: Readonly<Record<string, ProposalSegmentLineage>>;
  readonly vertexContinuityModes: Readonly<Record<string, HandleContinuityMode>>;
  readonly modifiedFromOriginal: boolean;
  readonly cutContourPotentiallyStale: boolean;
  readonly operationsAppliedCount: number;
  readonly approximationRecords: readonly ProposalApproximationRecord[];
}

export interface PatternGeometryProposalState {
  readonly schemaVersion: typeof PROPOSAL_STATE_SCHEMA_VERSION;
  readonly authorityTier: typeof PROPOSAL_AUTHORITY_TIER;
  readonly isCertified: false;
  readonly isProductionReady: false;
  readonly externalCadInteroperabilityVerified: false;
  readonly sourceIdentity: SourceArtifactIdentity;
  readonly reconciliationStatus: ProposalReconciliationStatus;
  readonly reconciliationReasons: readonly string[];
  readonly pieceProposals: Readonly<Record<string, PieceGeometryProposal>>;
  readonly defaultApproximationToleranceCm: number;
  readonly hasEdits: boolean;
}

export interface GeometryProposalHistoryEntry {
  readonly id: string;
  readonly actionLabel: string;
  readonly pieceId?: string;
  readonly state: PatternGeometryProposalState;
}

export interface GeometryProposalHistoryState {
  readonly past: readonly GeometryProposalHistoryEntry[];
  readonly present: PatternGeometryProposalState;
  readonly future: readonly GeometryProposalHistoryEntry[];
  readonly lastActionLabel: string;
  readonly sequenceCounter: number;
  readonly maxEntries: number;
}

export interface ContourEditSelection {
  readonly pieceId: string;
  readonly kind: 'vertex' | 'handle' | 'segment';
  /** Canonical vertex ref `${pieceId}::sew::${segmentId}::p0` or `::p3` when kind==='vertex' */
  readonly vertexRef?: string;
  readonly segmentId?: string;
  readonly handleSlot?: 'p1' | 'p2';
}

export interface SnapConstraintConfig {
  readonly gridSnapEnabled: boolean;
  readonly gridStepCm: number;
  readonly gridSnapThresholdCm: number;
  readonly vertexSnapEnabled: boolean;
  readonly vertexSnapThresholdCm: number;
}

export const DEFAULT_SNAP_CONSTRAINT_CONFIG: SnapConstraintConfig = {
  gridSnapEnabled: false,
  gridStepCm: 0.5,
  gridSnapThresholdCm: 0.2,
  vertexSnapEnabled: true,
  vertexSnapThresholdCm: 0.35
};

export interface SnapConstraintResult {
  readonly pointCm: RenderPoint2D;
  readonly snappedKind: 'none' | 'vertex' | 'grid';
  readonly snapTargetPointCm: RenderPoint2D | null;
  readonly constrainedAxisAngleDeg: number | null;
}

export interface CubicToLineDeviationResult {
  readonly maxDeviationCm: number;
  readonly worstParameterT: number;
  readonly worstCurvePointCm: RenderPoint2D;
  readonly closestLinePointCm: RenderPoint2D;
  readonly method: 'analytical-extrema-with-segment-overshoot-refinement';
}

export interface PendingApproximateOperationPreview {
  readonly operationKind: 'cubic-to-line' | 'remove-vertex-merge';
  readonly pieceId: string;
  readonly targetSegmentId?: string;
  readonly targetVertexRef?: string;
  readonly sourceSegmentIds: readonly string[];
  readonly isExact: boolean;
  readonly maxDeviationCm: number;
  readonly toleranceCm: number;
  readonly exceedsTolerance: boolean;
  readonly canApply: boolean;
  readonly requiresConfirmation: boolean;
  readonly method: string;
  readonly summaryLabel: string;
  readonly rejectionReason?: string;
  readonly previewSegment: RenderCurveSegment | null;
  readonly worstCurvePointCm?: RenderPoint2D;
  readonly closestPreviewPointCm?: RenderPoint2D;
}

export interface ProposalOperationSuccess {
  readonly ok: true;
  readonly state: PatternGeometryProposalState;
  readonly actionLabel: string;
  readonly pieceId: string;
  readonly isExact: boolean;
  readonly maxDeviationCm: number;
  readonly createdSegmentIds?: readonly string[];
  readonly removedSegmentIds?: readonly string[];
  readonly nextSelectedSegmentId?: string;
  readonly nextSelectedVertexRef?: string;
}

export interface ProposalOperationFailure {
  readonly ok: false;
  readonly errorCode:
    | 'STALE_PROPOSAL'
    | 'INVALID_INPUT'
    | 'PIECE_NOT_FOUND'
    | 'SEGMENT_NOT_FOUND'
    | 'VERTEX_NOT_FOUND'
    | 'WRONG_SEGMENT_KIND'
    | 'MINIMUM_TOPOLOGY_VIOLATION'
    | 'TOLERANCE_EXCEEDED'
    | 'CONFIRMATION_REQUIRED'
    | 'NO_OP';
  readonly message: string;
  readonly maxDeviationCm?: number;
  readonly toleranceCm?: number;
}

export type ProposalOperationResult = ProposalOperationSuccess | ProposalOperationFailure;

export interface ProposalIntegrityCheckItem {
  readonly id: ProposalIntegrityCheckId;
  readonly label: string;
  readonly status: ProposalIntegrityCheckStatus;
  readonly message: string;
  readonly pieceId?: string;
  readonly segmentId?: string;
  readonly metricValueCm?: number;
}

export interface ProposalIntegrityReport {
  readonly authorityTier: typeof PROPOSAL_AUTHORITY_TIER;
  readonly isCertified: false;
  readonly isProductionReady: false;
  readonly externalCadInteroperabilityVerified: false;
  readonly advisoryNotice: string;
  readonly overallStatus: ProposalIntegrityCheckStatus;
  readonly passCount: number;
  readonly warningCount: number;
  readonly invalidCount: number;
  readonly unassessedCount: number;
  readonly checks: readonly ProposalIntegrityCheckItem[];
}

export interface PatternEditProposalPayloadPiece {
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly name: string;
  readonly cutContourPotentiallyStale: boolean;
  readonly cutContourRegeneratedInClient: false;
  readonly operationsAppliedCount: number;
  readonly sewSegments: readonly RenderCurveSegment[];
  readonly segmentLineage: Readonly<Record<string, ProposalSegmentLineage>>;
  readonly approximationRecords: readonly ProposalApproximationRecord[];
}

export interface PatternEditProposalPayload {
  readonly schemaVersion: typeof PROPOSAL_PAYLOAD_SCHEMA_VERSION;
  readonly authorityTier: typeof PROPOSAL_AUTHORITY_TIER;
  readonly isCertified: false;
  readonly isProductionReady: false;
  readonly externalCadInteroperabilityVerified: false;
  readonly submissionStatus: 'READ_ONLY_LOCAL_PROPOSAL_NOT_SUBMITTED';
  readonly disclosure: string;
  readonly coordinateFrame: PatternArtifactCoordinateFrame;
  readonly sourceArtifact: {
    readonly schemaVersion: string;
    readonly specificationRevisionId: string;
    readonly measurementRevisionId: string;
    readonly engineVersion: string;
    readonly authorityTier: GeometryAuthorityTier;
    readonly artifactDigestSha256: string | null;
    readonly hasVerifiedSourceDigest: boolean;
    readonly geometryFingerprint: string;
  };
  readonly reconciliation: {
    readonly status: ProposalReconciliationStatus;
    readonly reasons: readonly string[];
  };
  readonly historySummary: {
    readonly undoDepth: number;
    readonly redoDepth: number;
    readonly lastActionLabel: string;
  };
  readonly editedPieces: readonly PatternEditProposalPayloadPiece[];
  readonly advisoryIntegritySummary: {
    readonly overallStatus: ProposalIntegrityCheckStatus;
    readonly isCertified: false;
    readonly isProductionReady: false;
    readonly passCount: number;
    readonly warningCount: number;
    readonly invalidCount: number;
    readonly unassessedCount: number;
    readonly checks: readonly ProposalIntegrityCheckItem[];
  };
}

export type ProposalPayloadSerializationResult =
  | {
      readonly ok: true;
      readonly payload: PatternEditProposalPayload;
      readonly json: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

// ---------------------------------------------------------------------------
// Internal Math & Numeric Helpers (Unrounded Float64)
// ---------------------------------------------------------------------------

function normalizeZero(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

function pointDistanceCm(a: RenderPoint2D, b: RenderPoint2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPoint(a: RenderPoint2D, b: RenderPoint2D, t: number): RenderPoint2D {
  return {
    x: normalizeZero(a.x + (b.x - a.x) * t),
    y: normalizeZero(a.y + (b.y - a.y) * t)
  };
}

function clonePoint(pt: RenderPoint2D): RenderPoint2D {
  return { x: normalizeZero(pt.x), y: normalizeZero(pt.y) };
}

function cloneSegment(seg: RenderCurveSegment): RenderCurveSegment {
  if (seg.kind === 'cubic-bezier') {
    const p1 = seg.p1 ? clonePoint(seg.p1) : lerpPoint(seg.p0, seg.p3, 1 / 3);
    const p2 = seg.p2 ? clonePoint(seg.p2) : lerpPoint(seg.p0, seg.p3, 2 / 3);
    return {
      ...seg,
      p0: clonePoint(seg.p0),
      p1,
      p2,
      p3: clonePoint(seg.p3)
    };
  }
  return {
    id: seg.id,
    kind: 'line',
    ...(seg.seamId !== undefined ? { seamId: seg.seamId } : {}),
    role: seg.role,
    p0: clonePoint(seg.p0),
    p3: clonePoint(seg.p3),
    ...(seg.isFold !== undefined ? { isFold: seg.isFold } : {})
  };
}

function isSegmentFinite(seg: RenderCurveSegment): boolean {
  if (!isFiniteRenderPoint(seg.p0) || !isFiniteRenderPoint(seg.p3)) {
    return false;
  }
  if (seg.kind === 'cubic-bezier') {
    if (!seg.p1 || !seg.p2) return false;
    return isFiniteRenderPoint(seg.p1) && isFiniteRenderPoint(seg.p2);
  }
  return true;
}

function getCubicControlPoints(seg: RenderCurveSegment): {
  p0: RenderPoint2D;
  p1: RenderPoint2D;
  p2: RenderPoint2D;
  p3: RenderPoint2D;
} {
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    return { p0: seg.p0, p1: seg.p1, p2: seg.p2, p3: seg.p3 };
  }
  return {
    p0: seg.p0,
    p1: lerpPoint(seg.p0, seg.p3, 1 / 3),
    p2: lerpPoint(seg.p0, seg.p3, 2 / 3),
    p3: seg.p3
  };
}

function evaluateSegmentAtT(seg: RenderCurveSegment, t: number): RenderPoint2D {
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    return evaluateCubicBezierUnrounded(seg.p0, seg.p1, seg.p2, seg.p3, t);
  }
  return lerpPoint(seg.p0, seg.p3, t);
}

function evaluateCubicDerivative(
  p0: RenderPoint2D,
  p1: RenderPoint2D,
  p2: RenderPoint2D,
  p3: RenderPoint2D,
  t: number
): RenderPoint2D {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
  };
}

function closestPointOnFiniteLine(
  pt: RenderPoint2D,
  a: RenderPoint2D,
  b: RenderPoint2D
): { point: RenderPoint2D; u: number; distanceCm: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= ZERO_LENGTH_EPSILON_CM * ZERO_LENGTH_EPSILON_CM) {
    return { point: clonePoint(a), u: 0, distanceCm: pointDistanceCm(pt, a) };
  }
  const rawU = ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / lenSq;
  const u = Math.max(0, Math.min(1, rawU));
  const closest = { x: normalizeZero(a.x + vx * u), y: normalizeZero(a.y + vy * u) };
  return { point: closest, u, distanceCm: pointDistanceCm(pt, closest) };
}

function solveQuadraticRealRootsInUnitInterval(a: number, b: number, c: number): number[] {
  const roots: number[] = [];
  if (Math.abs(a) <= 1e-14) {
    if (Math.abs(b) > 1e-14) {
      const r = -c / b;
      if (r > 0 && r < 1) roots.push(r);
    }
    return roots;
  }
  const disc = b * b - 4 * a * c;
  if (disc < -1e-14) return roots;
  const sqrtD = Math.sqrt(Math.max(0, disc));
  const r1 = (-b - sqrtD) / (2 * a);
  const r2 = (-b + sqrtD) / (2 * a);
  if (r1 > 0 && r1 < 1) roots.push(r1);
  if (r2 > 0 && r2 < 1 && Math.abs(r2 - r1) > 1e-12) roots.push(r2);
  return roots;
}

// Deterministic 5-point Gauss-Legendre quadrature nodes/weights on [-1, 1]
const GL5_NODES = [
  -0.906179845938664,
  -0.5384693101056831,
  0,
  0.5384693101056831,
  0.906179845938664
] as const;
const GL5_WEIGHTS = [
  0.2369268850561891,
  0.4786286704993665,
  0.5688888888888889,
  0.4786286704993665,
  0.2369268850561891
] as const;

function computeSegmentLengthCm(seg: RenderCurveSegment): number {
  if (!isSegmentFinite(seg)) return Number.NaN;
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    // 4-subinterval x 5-point Gauss-Legendre composite quadrature on [0, 1]
    const subintervals = 4;
    let total = 0;
    for (let s = 0; s < subintervals; s += 1) {
      const a = s / subintervals;
      const b = (s + 1) / subintervals;
      const half = 0.5 * (b - a);
      const mid = 0.5 * (a + b);
      let subSum = 0;
      for (let k = 0; k < GL5_NODES.length; k += 1) {
        const t = mid + half * GL5_NODES[k];
        const deriv = evaluateCubicDerivative(seg.p0, seg.p1, seg.p2, seg.p3, t);
        subSum += GL5_WEIGHTS[k] * Math.hypot(deriv.x, deriv.y);
      }
      total += half * subSum;
    }
    return Number.isFinite(total) ? total : pointDistanceCm(seg.p0, seg.p3);
  }
  return pointDistanceCm(seg.p0, seg.p3);
}

/**
 * Deterministic 64-bit FNV-1a hex fingerprint for presentation geometry identity.
 * Explicitly non-cryptographic; never represented as a SHA-256 artifact digest (R4).
 */
function fnv1a64Hex(input: string): string {
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  const mask = BigInt('0xffffffffffffffff');
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function formatFloatExact(n: number): string {
  if (!Number.isFinite(n)) return 'NON_FINITE';
  return String(normalizeZero(n));
}

function computeArtifactGeometryFingerprint(artifact: PatternArtifactBundle): string {
  const parts: string[] = [
    artifact.coordinateFrame.geometryUnit,
    artifact.coordinateFrame.yAxisDirection,
    artifact.coordinateFrame.handedness,
    artifact.coordinateFrame.exteriorWinding
  ];
  const sortedPieces = [...artifact.pieces].sort((a, b) => a.pieceId.localeCompare(b.pieceId));
  for (const piece of sortedPieces) {
    parts.push(`P:${piece.pieceId}:${piece.sewSegments.length}:${piece.cutSegments.length}`);
    for (const seg of piece.sewSegments) {
      parts.push(
        `S:${seg.id}:${seg.kind}:${formatFloatExact(seg.p0.x)},${formatFloatExact(seg.p0.y)}:` +
          (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2
            ? `${formatFloatExact(seg.p1.x)},${formatFloatExact(seg.p1.y)}:${formatFloatExact(seg.p2.x)},${formatFloatExact(seg.p2.y)}:`
            : '') +
          `${formatFloatExact(seg.p3.x)},${formatFloatExact(seg.p3.y)}`
      );
    }
    for (const cseg of piece.cutSegments) {
      parts.push(
        `C:${cseg.id}:${cseg.kind}:${formatFloatExact(cseg.p0.x)},${formatFloatExact(cseg.p0.y)}:${formatFloatExact(cseg.p3.x)},${formatFloatExact(cseg.p3.y)}`
      );
    }
  }
  return `geo-fnv1a64:${fnv1a64Hex(parts.join('|'))}`;
}

function allocateDeterministicSegmentId(baseId: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(baseId)) return baseId;
  let idx = 2;
  while (existingIds.has(`${baseId}_${idx}`)) {
    idx += 1;
  }
  return `${baseId}_${idx}`;
}

function buildOriginalLineageMap(
  sewSegments: readonly RenderCurveSegment[]
): Record<string, ProposalSegmentLineage> {
  const map: Record<string, ProposalSegmentLineage> = {};
  for (const seg of sewSegments) {
    map[seg.id] = {
      segmentId: seg.id,
      baseSegmentIds: [seg.id],
      derivation: 'original',
      maxApproximationDeviationCm: 0
    };
  }
  return map;
}

function getEffectivePieceSegments(
  state: PatternGeometryProposalState,
  sourcePiece: PatternPieceRenderModel
): readonly RenderCurveSegment[] {
  return state.pieceProposals[sourcePiece.pieceId]?.sewSegments ?? sourcePiece.sewSegments;
}

function ensureEditablePieceProposal(
  state: PatternGeometryProposalState,
  sourcePiece: PatternPieceRenderModel
): PieceGeometryProposal {
  const existing = state.pieceProposals[sourcePiece.pieceId];
  if (existing) return existing;
  return {
    pieceId: sourcePiece.pieceId,
    sewSegments: sourcePiece.sewSegments.map(cloneSegment),
    segmentLineage: buildOriginalLineageMap(sourcePiece.sewSegments),
    vertexContinuityModes: {},
    modifiedFromOriginal: false,
    cutContourPotentiallyStale: false,
    operationsAppliedCount: 0,
    approximationRecords: []
  };
}

function areSegmentsStructurallyEqual(
  a: readonly RenderCurveSegment[],
  b: readonly RenderCurveSegment[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const sa = a[i];
    const sb = b[i];
    if (sa.id !== sb.id || sa.kind !== sb.kind) return false;
    if (sa.p0.x !== sb.p0.x || sa.p0.y !== sb.p0.y) return false;
    if (sa.p3.x !== sb.p3.x || sa.p3.y !== sb.p3.y) return false;
    if (sa.kind === 'cubic-bezier') {
      if (!sa.p1 || !sb.p1 || !sa.p2 || !sb.p2) return false;
      if (sa.p1.x !== sb.p1.x || sa.p1.y !== sb.p1.y) return false;
      if (sa.p2.x !== sb.p2.x || sa.p2.y !== sb.p2.y) return false;
    }
  }
  return true;
}

function withUpdatedPieceProposal(
  state: PatternGeometryProposalState,
  sourcePiece: PatternPieceRenderModel,
  nextPieceProposal: PieceGeometryProposal
): PatternGeometryProposalState {
  const differsFromOriginal = !areSegmentsStructurallyEqual(
    nextPieceProposal.sewSegments,
    sourcePiece.sewSegments
  );
  const finalizedPiece: PieceGeometryProposal = {
    ...nextPieceProposal,
    modifiedFromOriginal: differsFromOriginal,
    cutContourPotentiallyStale: differsFromOriginal
  };

  const nextPieceProposals: Record<string, PieceGeometryProposal> = {
    ...state.pieceProposals
  };
  if (differsFromOriginal || Object.keys(finalizedPiece.vertexContinuityModes).length > 0) {
    nextPieceProposals[sourcePiece.pieceId] = finalizedPiece;
  } else {
    delete nextPieceProposals[sourcePiece.pieceId];
  }

  const hasEdits = Object.values(nextPieceProposals).some((p) => p.modifiedFromOriginal);

  return {
    ...state,
    pieceProposals: nextPieceProposals,
    hasEdits
  };
}

function computeBoundingBoxForSegments(
  sewSegments: readonly RenderCurveSegment[],
  cutSegments: readonly RenderCurveSegment[],
  fallbackBox: RenderBoundingBoxCm
): RenderBoundingBoxCm {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includePoint = (pt: RenderPoint2D) => {
    if (!isFiniteRenderPoint(pt)) return;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  };

  for (const list of [sewSegments, cutSegments]) {
    for (const seg of list) {
      includePoint(seg.p0);
      includePoint(seg.p3);
      if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
        includePoint(seg.p1);
        includePoint(seg.p2);
        for (let k = 1; k < 16; k += 1) {
          includePoint(evaluateCubicBezierUnrounded(seg.p0, seg.p1, seg.p2, seg.p3, k / 16));
        }
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return fallbackBox;
  }

  return {
    minX: normalizeZero(minX),
    minY: normalizeZero(minY),
    maxX: normalizeZero(maxX),
    maxY: normalizeZero(maxY),
    widthCm: normalizeZero(maxX - minX),
    heightCm: normalizeZero(maxY - minY)
  };
}

// ---------------------------------------------------------------------------
// 1. Source Artifact Identity & Proposal State Initialization (R4)
// ---------------------------------------------------------------------------

export function extractSourceArtifactIdentity(
  artifact: PatternArtifactBundle
): SourceArtifactIdentity {
  const rawDigest = artifact.provenance.artifactDigestSha256;
  const normalizedDigest =
    typeof rawDigest === 'string' && rawDigest.trim().length > 0 ? rawDigest.trim() : null;

  const pieceBaseSewSegmentIds: Record<string, readonly string[]> = {};
  for (const piece of artifact.pieces) {
    pieceBaseSewSegmentIds[piece.pieceId] = piece.sewSegments.map((s) => s.id);
  }

  return {
    schemaVersion: artifact.schemaVersion,
    specificationRevisionId: artifact.provenance.specificationRevisionId,
    measurementRevisionId: artifact.provenance.measurementRevisionId,
    engineVersion: artifact.provenance.engineVersion,
    authorityTier: artifact.authorityTier,
    artifactDigestSha256: normalizedDigest,
    hasVerifiedSourceDigest: normalizedDigest !== null,
    geometryFingerprint: computeArtifactGeometryFingerprint(artifact),
    pieceBaseSewSegmentIds
  };
}

export function createProposalStateFromArtifact(
  artifact: PatternArtifactBundle,
  defaultApproximationToleranceCm: number = DEFAULT_APPROXIMATION_TOLERANCE_CM
): PatternGeometryProposalState {
  const safeTolerance =
    Number.isFinite(defaultApproximationToleranceCm) && defaultApproximationToleranceCm > 0
      ? defaultApproximationToleranceCm
      : DEFAULT_APPROXIMATION_TOLERANCE_CM;
  return {
    schemaVersion: PROPOSAL_STATE_SCHEMA_VERSION,
    authorityTier: PROPOSAL_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    sourceIdentity: extractSourceArtifactIdentity(artifact),
    reconciliationStatus: 'aligned',
    reconciliationReasons: [],
    pieceProposals: {},
    defaultApproximationToleranceCm: safeTolerance,
    hasEdits: false
  };
}

export function createEmptyProposalHistory(
  artifact: PatternArtifactBundle,
  maxEntries: number = MAX_PROPOSAL_HISTORY_ENTRIES
): GeometryProposalHistoryState {
  const clampedMax = Math.max(1, Math.min(200, Math.floor(maxEntries)));
  return {
    past: [],
    present: createProposalStateFromArtifact(artifact),
    future: [],
    lastActionLabel: 'Initial source geometry',
    sequenceCounter: 0,
    maxEntries: clampedMax
  };
}

export interface EditableSewVertex {
  readonly entityRef: string;
  readonly pieceId: string;
  readonly segmentId: string;
  readonly endpointSlot: 'p0' | 'p3';
  readonly localPointCm: RenderPoint2D;
  readonly isShared: boolean;
  readonly incomingSegmentId: string | null;
  readonly outgoingSegmentId: string | null;
  readonly raw: ExtractedContourVertex;
}

export function getEditableSewVerticesForPiece(
  pieceId: string,
  sewSegments: readonly RenderCurveSegment[]
): readonly EditableSewVertex[] {
  const { vertices } = extractContourVertices(pieceId, 'sew', sewSegments);
  return vertices.map((v) => {
    const incoming = v.incidentSegments.find((s) => s.direction === 'incoming');
    const outgoing = v.incidentSegments.find((s) => s.direction === 'outgoing');
    return {
      entityRef: v.presentationRef,
      pieceId: v.pieceId,
      segmentId: v.segmentId,
      endpointSlot: v.endpointSlot,
      localPointCm: v.localPointCm,
      isShared: v.isSharedJunction,
      incomingSegmentId: incoming?.segmentId ?? null,
      outgoingSegmentId: outgoing?.segmentId ?? null,
      raw: v
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Snapping & Axis Constraint Helpers (Both Y-Up & Y-Down)
// ---------------------------------------------------------------------------

export function snapAndConstrainPoint(
  rawLocalCm: RenderPoint2D,
  anchorLocalCm: RenderPoint2D | null,
  _coordinateFrame: PatternArtifactCoordinateFrame,
  config: SnapConstraintConfig,
  modifiers: { readonly shiftKey?: boolean; readonly altKey?: boolean },
  candidateVertices: readonly RenderPoint2D[] = []
): SnapConstraintResult {
  if (!isFiniteRenderPoint(rawLocalCm)) {
    return {
      pointCm: anchorLocalCm && isFiniteRenderPoint(anchorLocalCm) ? clonePoint(anchorLocalCm) : { x: 0, y: 0 },
      snappedKind: 'none',
      snapTargetPointCm: null,
      constrainedAxisAngleDeg: null
    };
  }

  let pt = clonePoint(rawLocalCm);
  let constrainedAxisAngleDeg: number | null = null;

  // Shift axis constraint: 0 / 45 / 90 degree increments relative to anchor
  if (modifiers.shiftKey && anchorLocalCm && isFiniteRenderPoint(anchorLocalCm)) {
    const dx = pt.x - anchorLocalCm.x;
    const dy = pt.y - anchorLocalCm.y;
    const dist = Math.hypot(dx, dy);
    if (dist > ZERO_LENGTH_EPSILON_CM) {
      const angleRad = Math.atan2(dy, dx);
      const stepRad = Math.PI / 4; // 45 degrees
      const snappedStep = Math.round(angleRad / stepRad);
      const snappedAngleRad = snappedStep * stepRad;
      const ux = Math.cos(snappedAngleRad);
      const uy = Math.sin(snappedAngleRad);
      const proj = dx * ux + dy * uy;
      pt = {
        x: normalizeZero(anchorLocalCm.x + ux * proj),
        y: normalizeZero(anchorLocalCm.y + uy * proj)
      };
      const deg = ((snappedStep * 45) % 360 + 360) % 360;
      constrainedAxisAngleDeg = deg;
    }
  }

  // Alt bypasses snapping while preserving explicit axis constraint
  if (modifiers.altKey) {
    return {
      pointCm: pt,
      snappedKind: 'none',
      snapTargetPointCm: null,
      constrainedAxisAngleDeg
    };
  }

  // Priority 1: Vertex snapping
  if (config.vertexSnapEnabled && config.vertexSnapThresholdCm > 0 && candidateVertices.length > 0) {
    let bestPt: RenderPoint2D | null = null;
    let bestDist = config.vertexSnapThresholdCm;
    for (const candidate of candidateVertices) {
      if (!isFiniteRenderPoint(candidate)) continue;
      const d = pointDistanceCm(pt, candidate);
      if (d <= bestDist) {
        bestDist = d;
        bestPt = candidate;
      }
    }
    if (bestPt) {
      return {
        pointCm: clonePoint(bestPt),
        snappedKind: 'vertex',
        snapTargetPointCm: clonePoint(bestPt),
        constrainedAxisAngleDeg
      };
    }
  }

  // Priority 2: Grid snapping
  if (config.gridSnapEnabled && config.gridStepCm > 0 && config.gridSnapThresholdCm > 0) {
    const gx = Math.round(pt.x / config.gridStepCm) * config.gridStepCm;
    const gy = Math.round(pt.y / config.gridStepCm) * config.gridStepCm;
    const gridPt = { x: normalizeZero(gx), y: normalizeZero(gy) };
    if (pointDistanceCm(pt, gridPt) <= config.gridSnapThresholdCm) {
      return {
        pointCm: gridPt,
        snappedKind: 'grid',
        snapTargetPointCm: gridPt,
        constrainedAxisAngleDeg
      };
    }
  }

  return {
    pointCm: pt,
    snappedKind: 'none',
    snapTargetPointCm: null,
    constrainedAxisAngleDeg
  };
}

// ---------------------------------------------------------------------------
// 3. Vertex, Handle, Continuity & Alignment Editing Operations
// ---------------------------------------------------------------------------

export interface MoveVertexOptions {
  readonly translateAdjacentHandles?: boolean;
}

export function moveContourVertex(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  vertexRef: string,
  nextLocalCm: RenderPoint2D,
  options: MoveVertexOptions = {}
): ProposalOperationResult {
  if (state.reconciliationStatus !== 'aligned') {
    return {
      ok: false,
      errorCode: 'STALE_PROPOSAL',
      message: 'Proposal is stale after source artifact change. Discard or reset before editing.'
    };
  }
  if (!isFiniteRenderPoint(nextLocalCm)) {
    return {
      ok: false,
      errorCode: 'INVALID_INPUT',
      message: 'Target vertex coordinates must be finite numbers.'
    };
  }

  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId);
  if (!sourcePiece) {
    return { ok: false, errorCode: 'PIECE_NOT_FOUND', message: `Piece "${pieceId}" not found.` };
  }

  const pieceProp = ensureEditablePieceProposal(state, sourcePiece);
  const vertices = getEditableSewVerticesForPiece(pieceId, pieceProp.sewSegments);
  const vertex = vertices.find((v) => v.entityRef === vertexRef);
  if (!vertex) {
    return {
      ok: false,
      errorCode: 'VERTEX_NOT_FOUND',
      message: `Sew vertex "${vertexRef}" not found on piece "${pieceId}".`
    };
  }

  const dx = nextLocalCm.x - vertex.localPointCm.x;
  const dy = nextLocalCm.y - vertex.localPointCm.y;
  if (dx === 0 && dy === 0) {
    return { ok: false, errorCode: 'NO_OP', message: 'Vertex coordinates unchanged.' };
  }

  const translateHandles = options.translateAdjacentHandles ?? true;
  const targetPt = clonePoint(nextLocalCm);
  const nextLineage: Record<string, ProposalSegmentLineage> = { ...pieceProp.segmentLineage };

  const nextSegments = pieceProp.sewSegments.map((seg) => {
    const isOutgoing = vertex.outgoingSegmentId === seg.id;
    const isIncoming = vertex.incomingSegmentId === seg.id;
    if (!isOutgoing && !isIncoming) return seg;

    const updated = cloneSegment(seg);
    let p0 = updated.p0;
    let p1 = updated.p1;
    let p2 = updated.p2;
    let p3 = updated.p3;

    if (isOutgoing) {
      p0 = targetPt;
      if (translateHandles && updated.kind === 'cubic-bezier' && p1) {
        p1 = { x: normalizeZero(p1.x + dx), y: normalizeZero(p1.y + dy) };
      }
    }
    if (isIncoming) {
      p3 = targetPt;
      if (translateHandles && updated.kind === 'cubic-bezier' && p2) {
        p2 = { x: normalizeZero(p2.x + dx), y: normalizeZero(p2.y + dy) };
      }
    }

    const prevLin = nextLineage[seg.id];
    nextLineage[seg.id] = {
      segmentId: seg.id,
      baseSegmentIds: prevLin?.baseSegmentIds ?? [seg.id],
      derivation: prevLin && prevLin.derivation !== 'original' ? prevLin.derivation : 'modified',
      maxApproximationDeviationCm: prevLin?.maxApproximationDeviationCm ?? 0,
      ...(prevLin?.approximationMethod ? { approximationMethod: prevLin.approximationMethod } : {})
    };

    if (updated.kind === 'cubic-bezier') {
      return { ...updated, p0, p1, p2, p3 };
    }
    return { ...updated, p0, p3 };
  });

  const nextPieceProp: PieceGeometryProposal = {
    ...pieceProp,
    sewSegments: nextSegments,
    segmentLineage: nextLineage,
    operationsAppliedCount: pieceProp.operationsAppliedCount + 1
  };

  return {
    ok: true,
    state: withUpdatedPieceProposal(state, sourcePiece, nextPieceProp),
    actionLabel: `Move sew vertex on ${sourcePiece.pieceCode}`,
    pieceId,
    isExact: true,
    maxDeviationCm: 0,
    nextSelectedVertexRef: vertexRef
  };
}

export interface MoveHandleOptions {
  readonly continuityMode?: HandleContinuityMode;
}

export function moveBezierHandle(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  segmentId: string,
  handleSlot: 'p1' | 'p2',
  nextLocalCm: RenderPoint2D,
  options: MoveHandleOptions = {}
): ProposalOperationResult {
  if (state.reconciliationStatus !== 'aligned') {
    return {
      ok: false,
      errorCode: 'STALE_PROPOSAL',
      message: 'Proposal is stale after source artifact change. Discard or reset before editing.'
    };
  }
  if (!isFiniteRenderPoint(nextLocalCm)) {
    return {
      ok: false,
      errorCode: 'INVALID_INPUT',
      message: 'Handle coordinates must be finite numbers.'
    };
  }

  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId);
  if (!sourcePiece) {
    return { ok: false, errorCode: 'PIECE_NOT_FOUND', message: `Piece "${pieceId}" not found.` };
  }

  const pieceProp = ensureEditablePieceProposal(state, sourcePiece);
  const segIndex = pieceProp.sewSegments.findIndex((s) => s.id === segmentId);
  if (segIndex < 0) {
    return {
      ok: false,
      errorCode: 'SEGMENT_NOT_FOUND',
      message: `Sew segment "${segmentId}" not found on piece "${pieceId}".`
    };
  }

  const targetSeg = pieceProp.sewSegments[segIndex];
  if (targetSeg.kind !== 'cubic-bezier' || !targetSeg.p1 || !targetSeg.p2) {
    return {
      ok: false,
      errorCode: 'WRONG_SEGMENT_KIND',
      message: `Segment "${segmentId}" is not a cubic Bézier curve.`
    };
  }

  const currentHandle = handleSlot === 'p1' ? targetSeg.p1 : targetSeg.p2;
  if (currentHandle.x === nextLocalCm.x && currentHandle.y === nextLocalCm.y) {
    return { ok: false, errorCode: 'NO_OP', message: 'Handle coordinates unchanged.' };
  }

  const vertices = getEditableSewVerticesForPiece(pieceId, pieceProp.sewSegments);
  // Find the vertex anchored to this handle: p1 anchors to outgoingSegmentId===segmentId, p2 to incomingSegmentId===segmentId
  const anchorVertex = vertices.find((v) =>
    handleSlot === 'p1' ? v.outgoingSegmentId === segmentId : v.incomingSegmentId === segmentId
  );

  const continuityMode: HandleContinuityMode =
    options.continuityMode ??
    (anchorVertex ? pieceProp.vertexContinuityModes[anchorVertex.entityRef] : undefined) ??
    'c0-corner';

  const nextHandle = clonePoint(nextLocalCm);
  let coupledSegmentId: string | null = null;
  let coupledSlot: 'p1' | 'p2' | null = null;
  let coupledHandlePoint: RenderPoint2D | null = null;

  if (anchorVertex && anchorVertex.isShared && continuityMode !== 'c0-corner') {
    const oppSegId =
      handleSlot === 'p1' ? anchorVertex.incomingSegmentId : anchorVertex.outgoingSegmentId;
    const oppSlot: 'p1' | 'p2' = handleSlot === 'p1' ? 'p2' : 'p1';
    const oppSeg = oppSegId
      ? pieceProp.sewSegments.find((s) => s.id === oppSegId)
      : undefined;

    if (oppSeg && oppSeg.kind === 'cubic-bezier' && oppSeg.p1 && oppSeg.p2) {
      const anchor = anchorVertex.localPointCm;
      const vx = nextHandle.x - anchor.x;
      const vy = nextHandle.y - anchor.y;
      const activeLen = Math.hypot(vx, vy);
      if (activeLen > ZERO_LENGTH_EPSILON_CM) {
        if (continuityMode === 'symmetric') {
          coupledSegmentId = oppSeg.id;
          coupledSlot = oppSlot;
          coupledHandlePoint = {
            x: normalizeZero(anchor.x - vx),
            y: normalizeZero(anchor.y - vy)
          };
        } else if (continuityMode === 'g1-smooth') {
          const oppCurrent = oppSlot === 'p1' ? oppSeg.p1 : oppSeg.p2;
          const oppLen = pointDistanceCm(anchor, oppCurrent);
          if (oppLen > ZERO_LENGTH_EPSILON_CM) {
            const ux = vx / activeLen;
            const uy = vy / activeLen;
            coupledSegmentId = oppSeg.id;
            coupledSlot = oppSlot;
            coupledHandlePoint = {
              x: normalizeZero(anchor.x - ux * oppLen),
              y: normalizeZero(anchor.y - uy * oppLen)
            };
          }
        }
      }
    }
  }

  const nextLineage: Record<string, ProposalSegmentLineage> = { ...pieceProp.segmentLineage };
  const markModified = (id: string) => {
    const prevLin = nextLineage[id];
    nextLineage[id] = {
      segmentId: id,
      baseSegmentIds: prevLin?.baseSegmentIds ?? [id],
      derivation: prevLin && prevLin.derivation !== 'original' ? prevLin.derivation : 'modified',
      maxApproximationDeviationCm: prevLin?.maxApproximationDeviationCm ?? 0,
      ...(prevLin?.approximationMethod ? { approximationMethod: prevLin.approximationMethod } : {})
    };
  };

  const nextSegments = pieceProp.sewSegments.map((seg) => {
    if (seg.id === segmentId) {
      markModified(seg.id);
      const updated = cloneSegment(seg);
      return {
        ...updated,
        p1: handleSlot === 'p1' ? nextHandle : updated.p1,
        p2: handleSlot === 'p2' ? nextHandle : updated.p2
      };
    }
    if (coupledSegmentId && seg.id === coupledSegmentId && coupledSlot && coupledHandlePoint) {
      markModified(seg.id);
      const updated = cloneSegment(seg);
      return {
        ...updated,
        p1: coupledSlot === 'p1' ? coupledHandlePoint : updated.p1,
        p2: coupledSlot === 'p2' ? coupledHandlePoint : updated.p2
      };
    }
    return seg;
  });

  const nextContinuityModes = anchorVertex
    ? { ...pieceProp.vertexContinuityModes, [anchorVertex.entityRef]: continuityMode }
    : pieceProp.vertexContinuityModes;

  const nextPieceProp: PieceGeometryProposal = {
    ...pieceProp,
    sewSegments: nextSegments,
    segmentLineage: nextLineage,
    vertexContinuityModes: nextContinuityModes,
    operationsAppliedCount: pieceProp.operationsAppliedCount + 1
  };

  return {
    ok: true,
    state: withUpdatedPieceProposal(state, sourcePiece, nextPieceProp),
    actionLabel: `Edit Bézier handle (${continuityMode}) on ${sourcePiece.pieceCode}`,
    pieceId,
    isExact: true,
    maxDeviationCm: 0,
    nextSelectedSegmentId: segmentId
  };
}

export function setVertexContinuityMode(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  vertexRef: string,
  mode: HandleContinuityMode
): ProposalOperationResult {
  if (state.reconciliationStatus !== 'aligned') {
    return {
      ok: false,
      errorCode: 'STALE_PROPOSAL',
      message: 'Proposal is stale after source artifact change. Discard or reset before editing.'
    };
  }
  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId);
  if (!sourcePiece) {
    return { ok: false, errorCode: 'PIECE_NOT_FOUND', message: `Piece "${pieceId}" not found.` };
  }

  const pieceProp = ensureEditablePieceProposal(state, sourcePiece);
  const vertices = getEditableSewVerticesForPiece(pieceId, pieceProp.sewSegments);
  const vertex = vertices.find((v) => v.entityRef === vertexRef);
  if (!vertex) {
    return {
      ok: false,
      errorCode: 'VERTEX_NOT_FOUND',
      message: `Sew vertex "${vertexRef}" not found.`
    };
  }

  const nextModes = {
    ...pieceProp.vertexContinuityModes,
    [vertexRef]: mode
  };

  // If switching to G1 or Symmetric across two cubic segments, align handles deterministically
  let nextSegments = pieceProp.sewSegments;
  const nextLineage: Record<string, ProposalSegmentLineage> = { ...pieceProp.segmentLineage };

  if (mode !== 'c0-corner' && vertex.isShared && vertex.incomingSegmentId && vertex.outgoingSegmentId) {
    const inSeg = pieceProp.sewSegments.find((s) => s.id === vertex.incomingSegmentId);
    const outSeg = pieceProp.sewSegments.find((s) => s.id === vertex.outgoingSegmentId);
    if (
      inSeg &&
      outSeg &&
      inSeg.kind === 'cubic-bezier' &&
      outSeg.kind === 'cubic-bezier' &&
      inSeg.p2 &&
      outSeg.p1
    ) {
      const anchor = vertex.localPointCm;
      const vOutX = outSeg.p1.x - anchor.x;
      const vOutY = outSeg.p1.y - anchor.y;
      const outLen = Math.hypot(vOutX, vOutY);

      const vInX = inSeg.p2.x - anchor.x;
      const vInY = inSeg.p2.y - anchor.y;
      const inLen = Math.hypot(vInX, vInY);

      // Compute balanced tangent direction from (outVec - inVec)
      const dirX = vOutX - vInX;
      const dirY = vOutY - vInY;
      const dirLen = Math.hypot(dirX, dirY);
      if (dirLen > ZERO_LENGTH_EPSILON_CM) {
        const ux = dirX / dirLen;
        const uy = dirY / dirLen;
        const targetOutLen = mode === 'symmetric' ? (outLen + inLen) * 0.5 : outLen;
        const targetInLen = mode === 'symmetric' ? (outLen + inLen) * 0.5 : inLen;

        const nextOutP1 = {
          x: normalizeZero(anchor.x + ux * targetOutLen),
          y: normalizeZero(anchor.y + uy * targetOutLen)
        };
        const nextInP2 = {
          x: normalizeZero(anchor.x - ux * targetInLen),
          y: normalizeZero(anchor.y - uy * targetInLen)
        };

        nextSegments = pieceProp.sewSegments.map((seg) => {
          if (seg.id === outSeg.id) {
            const prevLin = nextLineage[seg.id];
            nextLineage[seg.id] = {
              segmentId: seg.id,
              baseSegmentIds: prevLin?.baseSegmentIds ?? [seg.id],
              derivation: prevLin && prevLin.derivation !== 'original' ? prevLin.derivation : 'modified',
              maxApproximationDeviationCm: prevLin?.maxApproximationDeviationCm ?? 0
            };
            return { ...cloneSegment(seg), p1: nextOutP1 };
          }
          if (seg.id === inSeg.id) {
            const prevLin = nextLineage[seg.id];
            nextLineage[seg.id] = {
              segmentId: seg.id,
              baseSegmentIds: prevLin?.baseSegmentIds ?? [seg.id],
              derivation: prevLin && prevLin.derivation !== 'original' ? prevLin.derivation : 'modified',
              maxApproximationDeviationCm: prevLin?.maxApproximationDeviationCm ?? 0
            };
            return { ...cloneSegment(seg), p2: nextInP2 };
          }
          return seg;
        });
      }
    }
  }

  const nextPieceProp: PieceGeometryProposal = {
    ...pieceProp,
    sewSegments: nextSegments,
    segmentLineage: nextLineage,
    vertexContinuityModes: nextModes,
    operationsAppliedCount: pieceProp.operationsAppliedCount + 1
  };

  return {
    ok: true,
    state: withUpdatedPieceProposal(state, sourcePiece, nextPieceProp),
    actionLabel: `Set vertex continuity (${mode}) on ${sourcePiece.pieceCode}`,
    pieceId,
    isExact: true,
    maxDeviationCm: 0,
    nextSelectedVertexRef: vertexRef
  };
}

export function alignVertexToReference(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  vertexRef: string,
  axis: 'horizontal' | 'vertical',
  referenceLocalCm: RenderPoint2D,
  translateAdjacentHandles: boolean = true
): ProposalOperationResult {
  if (!isFiniteRenderPoint(referenceLocalCm)) {
    return {
      ok: false,
      errorCode: 'INVALID_INPUT',
      message: 'Reference point for alignment must be finite.'
    };
  }
  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId);
  if (!sourcePiece) {
    return { ok: false, errorCode: 'PIECE_NOT_FOUND', message: `Piece "${pieceId}" not found.` };
  }
  const segments = getEffectivePieceSegments(state, sourcePiece);
  const vertices = getEditableSewVerticesForPiece(pieceId, segments);
  const vertex = vertices.find((v) => v.entityRef === vertexRef);
  if (!vertex) {
    return { ok: false, errorCode: 'VERTEX_NOT_FOUND', message: `Vertex "${vertexRef}" not found.` };
  }
  // Horizontal alignment matches Y coordinate; Vertical alignment matches X coordinate
  // (holds identically in both cartesian-y-up and svg-y-down frames)
  const nextLocalCm: RenderPoint2D =
    axis === 'horizontal'
      ? { x: vertex.localPointCm.x, y: referenceLocalCm.y }
      : { x: referenceLocalCm.x, y: vertex.localPointCm.y };

  const moved = moveContourVertex(state, sourceArtifact, pieceId, vertexRef, nextLocalCm, {
    translateAdjacentHandles
  });
  if (!moved.ok) return moved;
  return {
    ...moved,
    actionLabel: `Align sew vertex (${axis}) on ${sourcePiece.pieceCode}`
  };
}

// ---------------------------------------------------------------------------
// 4. Exact Segment Subdivision (De Casteljau) & Exact Degree Elevation
// ---------------------------------------------------------------------------

export function splitSewSegmentAtT(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  segmentId: string,
  t: number
): ProposalOperationResult {
  if (state.reconciliationStatus !== 'aligned') {
    return {
      ok: false,
      errorCode: 'STALE_PROPOSAL',
      message: 'Proposal is stale after source artifact change. Discard or reset before editing.'
    };
  }
  if (!Number.isFinite(t) || t <= 1e-4 || t >= 1 - 1e-4) {
    return {
      ok: false,
      errorCode: 'INVALID_INPUT',
      message: 'Split parameter t must be strictly between 0.0001 and 0.9999.'
    };
  }

  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId);
  if (!sourcePiece) {
    return { ok: false, errorCode: 'PIECE_NOT_FOUND', message: `Piece "${pieceId}" not found.` };
  }

  const pieceProp = ensureEditablePieceProposal(state, sourcePiece);
  const segIdx = pieceProp.sewSegments.findIndex((s) => s.id === segmentId);
  if (segIdx < 0) {
    return {
      ok: false,
      errorCode: 'SEGMENT_NOT_FOUND',
      message: `Sew segment "${segmentId}" not found on piece "${pieceId}".`
    };
  }

  const seg = pieceProp.sewSegments[segIdx];
  if (!isSegmentFinite(seg)) {
    return {
      ok: false,
      errorCode: 'INVALID_INPUT',
      message: `Sew segment "${segmentId}" contains non-finite coordinates.`
    };
  }

  const existingIds = new Set(pieceProp.sewSegments.map((s) => s.id));
  const idA = allocateDeterministicSegmentId(`${seg.id}__split_a`, existingIds);
  existingIds.add(idA);
  const idB = allocateDeterministicSegmentId(`${seg.id}__split_b`, existingIds);

  let segA: RenderCurveSegment;
  let segB: RenderCurveSegment;

  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    // Exact De Casteljau subdivision
    const q0 = lerpPoint(seg.p0, seg.p1, t);
    const q1 = lerpPoint(seg.p1, seg.p2, t);
    const q2 = lerpPoint(seg.p2, seg.p3, t);
    const r0 = lerpPoint(q0, q1, t);
    const r1 = lerpPoint(q1, q2, t);
    const s = lerpPoint(r0, r1, t);

    segA = {
      id: idA,
      kind: 'cubic-bezier',
      ...(seg.seamId !== undefined ? { seamId: seg.seamId } : {}),
      role: seg.role,
      p0: clonePoint(seg.p0),
      p1: q0,
      p2: r0,
      p3: s,
      ...(seg.isFold !== undefined ? { isFold: seg.isFold } : {})
    };
    segB = {
      id: idB,
      kind: 'cubic-bezier',
      ...(seg.seamId !== undefined ? { seamId: seg.seamId } : {}),
      role: seg.role,
      p0: s,
      p1: r1,
      p2: q2,
      p3: clonePoint(seg.p3),
      ...(seg.isFold !== undefined ? { isFold: seg.isFold } : {})
    };
  } else {
    const mid = lerpPoint(seg.p0, seg.p3, t);
    segA = {
      id: idA,
      kind: 'line',
      ...(seg.seamId !== undefined ? { seamId: seg.seamId } : {}),
      role: seg.role,
      p0: clonePoint(seg.p0),
      p3: mid,
      ...(seg.isFold !== undefined ? { isFold: seg.isFold } : {})
    };
    segB = {
      id: idB,
      kind: 'line',
      ...(seg.seamId !== undefined ? { seamId: seg.seamId } : {}),
      role: seg.role,
      p0: mid,
      p3: clonePoint(seg.p3),
      ...(seg.isFold !== undefined ? { isFold: seg.isFold } : {})
    };
  }

  const nextSegments = [
    ...pieceProp.sewSegments.slice(0, segIdx),
    segA,
    segB,
    ...pieceProp.sewSegments.slice(segIdx + 1)
  ];

  const prevLin = pieceProp.segmentLineage[seg.id];
  const baseIds = prevLin?.baseSegmentIds ?? [seg.id];
  const nextLineage: Record<string, ProposalSegmentLineage> = { ...pieceProp.segmentLineage };
  delete nextLineage[seg.id];
  nextLineage[idA] = {
    segmentId: idA,
    baseSegmentIds: baseIds,
    derivation: 'split-exact',
    maxApproximationDeviationCm: prevLin?.maxApproximationDeviationCm ?? 0
  };
  nextLineage[idB] = {
    segmentId: idB,
    baseSegmentIds: baseIds,
    derivation: 'split-exact',
    maxApproximationDeviationCm: prevLin?.maxApproximationDeviationCm ?? 0
  };

  const newVertexRef = `${pieceId}::sew::${idB}::p0`;
  const nextModes =
    seg.kind === 'cubic-bezier'
      ? { ...pieceProp.vertexContinuityModes, [newVertexRef]: 'g1-smooth' as HandleContinuityMode }
      : pieceProp.vertexContinuityModes;

  const nextPieceProp: PieceGeometryProposal = {
    ...pieceProp,
    sewSegments: nextSegments,
    segmentLineage: nextLineage,
    vertexContinuityModes: nextModes,
    operationsAppliedCount: pieceProp.operationsAppliedCount + 1
  };

  return {
    ok: true,
    state: withUpdatedPieceProposal(state, sourcePiece, nextPieceProp),
    actionLabel: `Split sew segment (exact, t=${t.toFixed(2)}) on ${sourcePiece.pieceCode}`,
    pieceId,
    isExact: true,
    maxDeviationCm: 0,
    createdSegmentIds: [idA, idB],
    removedSegmentIds: [seg.id],
    nextSelectedVertexRef: newVertexRef,
    nextSelectedSegmentId: idB
  };
}

export function elevateLineToCubicExact(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  segmentId: string
): ProposalOperationResult {
  if (state.reconciliationStatus !== 'aligned') {
    return {
      ok: false,
      errorCode: 'STALE_PROPOSAL',
      message: 'Proposal is stale after source artifact change. Discard or reset before editing.'
    };
  }
  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId);
  if (!sourcePiece) {
    return { ok: false, errorCode: 'PIECE_NOT_FOUND', message: `Piece "${pieceId}" not found.` };
  }

  const pieceProp = ensureEditablePieceProposal(state, sourcePiece);
  const segIdx = pieceProp.sewSegments.findIndex((s) => s.id === segmentId);
  if (segIdx < 0) {
    return {
      ok: false,
      errorCode: 'SEGMENT_NOT_FOUND',
      message: `Sew segment "${segmentId}" not found on piece "${pieceId}".`
    };
  }

  const seg = pieceProp.sewSegments[segIdx];
  if (seg.kind !== 'line') {
    return {
      ok: false,
      errorCode: 'WRONG_SEGMENT_KIND',
      message: `Segment "${segmentId}" is already a cubic Bézier curve.`
    };
  }

  const p1 = lerpPoint(seg.p0, seg.p3, 1 / 3);
  const p2 = lerpPoint(seg.p0, seg.p3, 2 / 3);
  const elevated: RenderCurveSegment = {
    id: seg.id,
    kind: 'cubic-bezier',
    ...(seg.seamId !== undefined ? { seamId: seg.seamId } : {}),
    role: seg.role,
    p0: clonePoint(seg.p0),
    p1,
    p2,
    p3: clonePoint(seg.p3),
    ...(seg.isFold !== undefined ? { isFold: seg.isFold } : {})
  };

  const nextSegments = pieceProp.sewSegments.map((s, i) => (i === segIdx ? elevated : s));
  const prevLin = pieceProp.segmentLineage[seg.id];
  const nextLineage: Record<string, ProposalSegmentLineage> = {
    ...pieceProp.segmentLineage,
    [seg.id]: {
      segmentId: seg.id,
      baseSegmentIds: prevLin?.baseSegmentIds ?? [seg.id],
      derivation: 'elevated-exact',
      maxApproximationDeviationCm: prevLin?.maxApproximationDeviationCm ?? 0
    }
  };

  const nextPieceProp: PieceGeometryProposal = {
    ...pieceProp,
    sewSegments: nextSegments,
    segmentLineage: nextLineage,
    operationsAppliedCount: pieceProp.operationsAppliedCount + 1
  };

  return {
    ok: true,
    state: withUpdatedPieceProposal(state, sourcePiece, nextPieceProp),
    actionLabel: `Convert line → cubic (exact degree elevation) on ${sourcePiece.pieceCode}`,
    pieceId,
    isExact: true,
    maxDeviationCm: 0,
    nextSelectedSegmentId: seg.id
  };
}

// ---------------------------------------------------------------------------
// 5. R1 — Cubic-to-Line Controlled Approximation (Deterministic Deviation)
// ---------------------------------------------------------------------------

/**
 * Deterministic maximum geometric deviation from a cubic Bézier segment B(t)
 * to its finite endpoint chord segment [p0, p3].
 *
 * Combines:
 * 1. Exact analytical interior extrema of perpendicular distance d_perp(t) = (B(t)-p0)·N
 *    via quadratic roots of d_perp'(t) = 0.
 * 2. Exact analytical interior extrema of tangential projection (B(t)-p0)·T
 *    via quadratic roots of B'(t)·T = 0 (captures chord-endpoint overshoot extrema).
 * 3. Deterministic 256-sample dense sweep + 32-step golden-section refinement around
 *    the maximum distance bracket.
 */
export function computeCubicToChordMaxDeviation(
  seg: RenderCurveSegment
): CubicToLineDeviationResult {
  const { p0, p1, p2, p3 } = getCubicControlPoints(seg);
  const vx = p3.x - p0.x;
  const vy = p3.y - p0.y;
  const chordLen = Math.hypot(vx, vy);

  const candidates = new Set<number>([0, 1]);

  if (chordLen > ZERO_LENGTH_EPSILON_CM) {
    const tx = vx / chordLen;
    const ty = vy / chordLen;
    const nx = -ty;
    const ny = tx;

    // d'(t) = 3*(1-t)^2*(p1-p0) + 6*(1-t)*t*(p2-p1) + 3*t^2*(p3-p2)
    // Expand B'(t) = A*t^2 + B*t + C
    const ax = 3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x);
    const ay = 3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y);
    const bx = 6 * (p0.x - 2 * p1.x + p2.x);
    const by = 6 * (p0.y - 2 * p1.y + p2.y);
    const cx = 3 * (p1.x - p0.x);
    const cy = 3 * (p1.y - p0.y);

    // Analytical perpendicular extrema: B'(t) · N = 0
    for (const r of solveQuadraticRealRootsInUnitInterval(
      ax * nx + ay * ny,
      bx * nx + by * ny,
      cx * nx + cy * ny
    )) {
      candidates.add(r);
    }

    // Analytical tangential overshoot extrema: B'(t) · T = 0
    for (const r of solveQuadraticRealRootsInUnitInterval(
      ax * tx + ay * ty,
      bx * tx + by * ty,
      cx * tx + cy * ty
    )) {
      candidates.add(r);
    }
  }

  // Dense deterministic grid (256 intervals)
  const samples = 256;
  for (let i = 1; i < samples; i += 1) {
    candidates.add(i / samples);
  }

  let bestT = 0;
  let bestDist = -1;
  let bestCurvePt = clonePoint(p0);
  let bestLinePt = clonePoint(p0);

  const evalAt = (t: number) => {
    const pt = evaluateCubicBezierUnrounded(p0, p1, p2, p3, t);
    const closest = closestPointOnFiniteLine(pt, p0, p3);
    if (closest.distanceCm > bestDist) {
      bestDist = closest.distanceCm;
      bestT = t;
      bestCurvePt = pt;
      bestLinePt = closest.point;
    }
    return closest.distanceCm;
  };

  for (const t of candidates) {
    evalAt(t);
  }

  // Golden-section maximization refinement around bestT
  const halfStep = 1 / samples;
  let lo = Math.max(0, bestT - halfStep);
  let hi = Math.min(1, bestT + halfStep);
  const invPhi = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - invPhi * (hi - lo);
  let x2 = lo + invPhi * (hi - lo);
  let f1 = evalAt(x1);
  let f2 = evalAt(x2);

  for (let iter = 0; iter < 32; iter += 1) {
    if (f1 < f2) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + invPhi * (hi - lo);
      f2 = evalAt(x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - invPhi * (hi - lo);
      f1 = evalAt(x1);
    }
  }

  return {
    maxDeviationCm: normalizeZero(Math.max(0, bestDist)),
    worstParameterT: bestT,
    worstCurvePointCm: bestCurvePt,
    closestLinePointCm: bestLinePt,
    method: 'analytical-extrema-with-segment-overshoot-refinement'
  };
}

export function previewCubicToLineApproximation(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  segmentId: string,
  toleranceCm: number = state.defaultApproximationToleranceCm
): PendingApproximateOperationPreview | ProposalOperationFailure {
  if (state.reconciliationStatus !== 'aligned') {
    return {
      ok: false,
      errorCode: 'STALE_PROPOSAL',
      message: 'Proposal is stale after source artifact change. Discard or reset before editing.'
    };
  }
  if (!Number.isFinite(toleranceCm) || toleranceCm < 0) {
    return {
      ok: false,
      errorCode: 'INVALID_INPUT',
      message: 'Approximation tolerance must be a finite non-negative number (cm).'
    };
  }
  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId);
  if (!sourcePiece) {
    return { ok: false, errorCode: 'PIECE_NOT_FOUND', message: `Piece "${pieceId}" not found.` };
  }
  const segments = getEffectivePieceSegments(state, sourcePiece);
  const seg = segments.find((s) => s.id === segmentId);
  if (!seg) {
    return {
      ok: false,
      errorCode: 'SEGMENT_NOT_FOUND',
      message: `Sew segment "${segmentId}" not found.`
    };
  }
  if (seg.kind !== 'cubic-bezier') {
    return {
      ok: false,
      errorCode: 'WRONG_SEGMENT_KIND',
      message: `Segment "${segmentId}" is already a straight line.`
    };
  }

  const dev = computeCubicToChordMaxDeviation(seg);
  const exceedsTolerance = dev.maxDeviationCm > toleranceCm;

  const previewSegment: RenderCurveSegment = {
    id: seg.id,
    kind: 'line',
    ...(seg.seamId !== undefined ? { seamId: seg.seamId } : {}),
    role: seg.role,
    p0: clonePoint(seg.p0),
    p3: clonePoint(seg.p3),
    ...(seg.isFold !== undefined ? { isFold: seg.isFold } : {})
  };

  return {
    operationKind: 'cubic-to-line',
    pieceId,
    targetSegmentId: segmentId,
    sourceSegmentIds: [segmentId],
    // R1: Cubic-to-line conversion MUST NEVER be labeled exact.
    isExact: false,
    maxDeviationCm: dev.maxDeviationCm,
    toleranceCm,
    exceedsTolerance,
    canApply: !exceedsTolerance,
    requiresConfirmation: true,
    method: dev.method,
    summaryLabel: exceedsTolerance
      ? `Rejected: Cubic → Line approximation deviation (${dev.maxDeviationCm.toFixed(4)} cm) exceeds tolerance (${toleranceCm.toFixed(4)} cm)`
      : `Approximate Cubic → Line conversion (max deviation ${dev.maxDeviationCm.toFixed(4)} cm ≤ ${toleranceCm.toFixed(4)} cm tolerance)`,
    ...(exceedsTolerance
      ? {
          rejectionReason: `Maximum geometric deviation (${dev.maxDeviationCm.toFixed(4)} cm) exceeds configured tolerance (${toleranceCm.toFixed(4)} cm). Increase tolerance or keep cubic representation.`
        }
      : {}),
    previewSegment,
    worstCurvePointCm: dev.worstCurvePointCm,
    closestPreviewPointCm: dev.closestLinePointCm
  };
}

export function applyCubicToLineApproximation(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  segmentId: string,
  options: {
    readonly toleranceCm?: number;
    readonly confirmApproximation: boolean;
  }
): ProposalOperationResult {
  const toleranceCm = options.toleranceCm ?? state.defaultApproximationToleranceCm;
  const preview = previewCubicToLineApproximation(
    state,
    sourceArtifact,
    pieceId,
    segmentId,
    toleranceCm
  );
  if ('ok' in preview) return preview;

  if (preview.exceedsTolerance || !preview.canApply || !preview.previewSegment) {
    return {
      ok: false,
      errorCode: 'TOLERANCE_EXCEEDED',
      message:
        preview.rejectionReason ??
        `Cubic-to-line deviation (${preview.maxDeviationCm.toFixed(4)} cm) exceeds tolerance (${toleranceCm.toFixed(4)} cm).`,
      maxDeviationCm: preview.maxDeviationCm,
      toleranceCm
    };
  }
  if (!options.confirmApproximation) {
    return {
      ok: false,
      errorCode: 'CONFIRMATION_REQUIRED',
      message:
        'Cubic-to-line conversion is approximate and requires explicit user confirmation after preview.',
      maxDeviationCm: preview.maxDeviationCm,
      toleranceCm
    };
  }

  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId)!;
  const pieceProp = ensureEditablePieceProposal(state, sourcePiece);
  const nextSegments = pieceProp.sewSegments.map((s) =>
    s.id === segmentId ? preview.previewSegment! : s
  );

  const prevLin = pieceProp.segmentLineage[segmentId];
  const nextLineage: Record<string, ProposalSegmentLineage> = {
    ...pieceProp.segmentLineage,
    [segmentId]: {
      segmentId,
      baseSegmentIds: prevLin?.baseSegmentIds ?? [segmentId],
      derivation: 'cubic-to-line-approx',
      maxApproximationDeviationCm: Math.max(
        prevLin?.maxApproximationDeviationCm ?? 0,
        preview.maxDeviationCm
      ),
      approximationMethod: preview.method
    }
  };

  const approxRec: ProposalApproximationRecord = {
    id: `approx-${pieceProp.operationsAppliedCount + 1}-${segmentId}`,
    operationKind: 'cubic-to-line',
    pieceId,
    sourceSegmentIds: [segmentId],
    resultSegmentId: segmentId,
    maxDeviationCm: preview.maxDeviationCm,
    toleranceCm,
    method: preview.method
  };

  const nextPieceProp: PieceGeometryProposal = {
    ...pieceProp,
    sewSegments: nextSegments,
    segmentLineage: nextLineage,
    operationsAppliedCount: pieceProp.operationsAppliedCount + 1,
    approximationRecords: [...pieceProp.approximationRecords, approxRec]
  };

  return {
    ok: true,
    state: withUpdatedPieceProposal(state, sourcePiece, nextPieceProp),
    actionLabel: `Convert cubic → line (approx, Δmax=${preview.maxDeviationCm.toFixed(3)} cm) on ${sourcePiece.pieceCode}`,
    pieceId,
    isExact: false,
    maxDeviationCm: preview.maxDeviationCm,
    nextSelectedSegmentId: segmentId
  };
}

// ---------------------------------------------------------------------------
// 6. R2 — Vertex Removal & Segment Merging (Exact When Justified, Else Controlled Approx)
// ---------------------------------------------------------------------------

/**
 * Deterministic bidirectional Hausdorff deviation between two source segments (A, B)
 * and a proposed merged segment M.
 */
function measureMergedSegmentDeviation(
  segA: RenderCurveSegment,
  segB: RenderCurveSegment,
  merged: RenderCurveSegment
): {
  maxDeviationCm: number;
  worstSourcePointCm: RenderPoint2D;
  closestMergedPointCm: RenderPoint2D;
} {
  const sampleCount = 64;
  const mergedPoints: RenderPoint2D[] = [];
  for (let i = 0; i <= sampleCount * 2; i += 1) {
    mergedPoints.push(evaluateSegmentAtT(merged, i / (sampleCount * 2)));
  }

  const sourcePoints: RenderPoint2D[] = [];
  for (let i = 0; i <= sampleCount; i += 1) {
    sourcePoints.push(evaluateSegmentAtT(segA, i / sampleCount));
  }
  for (let i = 1; i <= sampleCount; i += 1) {
    sourcePoints.push(evaluateSegmentAtT(segB, i / sampleCount));
  }

  const minDistanceToPolyline = (
    pt: RenderPoint2D,
    poly: readonly RenderPoint2D[]
  ): { dist: number; closest: RenderPoint2D } => {
    let bestD = Number.POSITIVE_INFINITY;
    let bestC = poly[0];
    for (let i = 0; i < poly.length - 1; i += 1) {
      const res = closestPointOnFiniteLine(pt, poly[i], poly[i + 1]);
      if (res.distanceCm < bestD) {
        bestD = res.distanceCm;
        bestC = res.point;
      }
    }
    return { dist: bestD, closest: bestC };
  };

  let maxDev = 0;
  let worstSrc = segA.p3;
  let closestM = merged.p0;

  // Forward: max_{p in A U B} dist(p, M)
  for (const sp of sourcePoints) {
    const res = minDistanceToPolyline(sp, mergedPoints);
    if (res.dist > maxDev) {
      maxDev = res.dist;
      worstSrc = sp;
      closestM = res.closest;
    }
  }

  // Backward: max_{q in M} dist(q, A U B)
  for (const mp of mergedPoints) {
    const res = minDistanceToPolyline(mp, sourcePoints);
    if (res.dist > maxDev) {
      maxDev = res.dist;
      worstSrc = res.closest;
      closestM = mp;
    }
  }

  return {
    maxDeviationCm: normalizeZero(maxDev),
    worstSourcePointCm: worstSrc,
    closestMergedPointCm: closestM
  };
}

/**
 * Closed-form least-squares cubic Bézier fit through sampled points of (segA, segB)
 * with fixed endpoints (segA.p0, segB.p3).
 */
function fitLeastSquaresMergedCubic(
  segA: RenderCurveSegment,
  segB: RenderCurveSegment,
  mergedId: string,
  splitWeight: number
): RenderCurveSegment {
  const p0 = clonePoint(segA.p0);
  const p3 = clonePoint(segB.p3);

  const samplesPerHalf = 24;
  const pts: RenderPoint2D[] = [];
  const ts: number[] = [];

  for (let i = 0; i <= samplesPerHalf; i += 1) {
    const u = i / samplesPerHalf;
    pts.push(evaluateSegmentAtT(segA, u));
    ts.push(u * splitWeight);
  }
  for (let i = 1; i <= samplesPerHalf; i += 1) {
    const u = i / samplesPerHalf;
    pts.push(evaluateSegmentAtT(segB, u));
    ts.push(splitWeight + u * (1 - splitWeight));
  }

  // Minimize sum || B1(t)*P1 + B2(t)*P2 - (Q_i - B0(t)*P0 - B3(t)*P3) ||^2
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let rhs1x = 0;
  let rhs1y = 0;
  let rhs2x = 0;
  let rhs2y = 0;

  for (let i = 0; i < pts.length; i += 1) {
    const t = ts[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;

    const rx = pts[i].x - b0 * p0.x - b3 * p3.x;
    const ry = pts[i].y - b0 * p0.y - b3 * p3.y;

    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    rhs1x += b1 * rx;
    rhs1y += b1 * ry;
    rhs2x += b2 * rx;
    rhs2y += b2 * ry;
  }

  const det = a11 * a22 - a12 * a12;
  let p1 = lerpPoint(p0, p3, 1 / 3);
  let p2 = lerpPoint(p0, p3, 2 / 3);

  if (Math.abs(det) > 1e-14) {
    p1 = {
      x: normalizeZero((a22 * rhs1x - a12 * rhs2x) / det),
      y: normalizeZero((a22 * rhs1y - a12 * rhs2y) / det)
    };
    p2 = {
      x: normalizeZero((-a12 * rhs1x + a11 * rhs2x) / det),
      y: normalizeZero((-a12 * rhs1y + a11 * rhs2y) / det)
    };
  }

  return {
    id: mergedId,
    kind: 'cubic-bezier',
    ...(segA.seamId !== undefined && segA.seamId === segB.seamId ? { seamId: segA.seamId } : {}),
    role: segA.role,
    p0,
    p1,
    p2,
    p3,
    ...(segA.isFold && segB.isFold ? { isFold: true } : {})
  };
}

export function previewRemoveVertexAndMerge(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  vertexRef: string,
  toleranceCm: number = state.defaultApproximationToleranceCm
): PendingApproximateOperationPreview | ProposalOperationFailure {
  if (state.reconciliationStatus !== 'aligned') {
    return {
      ok: false,
      errorCode: 'STALE_PROPOSAL',
      message: 'Proposal is stale after source artifact change. Discard or reset before editing.'
    };
  }
  if (!Number.isFinite(toleranceCm) || toleranceCm < 0) {
    return {
      ok: false,
      errorCode: 'INVALID_INPUT',
      message: 'Approximation tolerance must be a finite non-negative number (cm).'
    };
  }

  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId);
  if (!sourcePiece) {
    return { ok: false, errorCode: 'PIECE_NOT_FOUND', message: `Piece "${pieceId}" not found.` };
  }

  const segments = getEffectivePieceSegments(state, sourcePiece);
  const vertices = getEditableSewVerticesForPiece(pieceId, segments);
  const vertex = vertices.find((v) => v.entityRef === vertexRef);
  if (!vertex) {
    return {
      ok: false,
      errorCode: 'VERTEX_NOT_FOUND',
      message: `Sew vertex "${vertexRef}" not found.`
    };
  }

  // R2: Reject unsafe topology operations (minimum 3-segment closed contour + shared junction)
  if (segments.length <= MIN_CLOSED_CONTOUR_SEGMENTS) {
    return {
      operationKind: 'remove-vertex-merge',
      pieceId,
      targetVertexRef: vertexRef,
      sourceSegmentIds: [
        ...(vertex.incomingSegmentId ? [vertex.incomingSegmentId] : []),
        ...(vertex.outgoingSegmentId ? [vertex.outgoingSegmentId] : [])
      ],
      isExact: false,
      maxDeviationCm: Number.POSITIVE_INFINITY,
      toleranceCm,
      exceedsTolerance: true,
      canApply: false,
      requiresConfirmation: false,
      method: 'topology-guard-rejected',
      summaryLabel: `Rejected: Minimum closed contour requires at least ${MIN_CLOSED_CONTOUR_SEGMENTS} segments (currently ${segments.length}).`,
      rejectionReason: `Cannot remove vertex: contour currently has ${segments.length} segments, which is the minimum valid closed contour topology (${MIN_CLOSED_CONTOUR_SEGMENTS}).`,
      previewSegment: null
    };
  }

  if (
    !vertex.isShared ||
    !vertex.incomingSegmentId ||
    !vertex.outgoingSegmentId ||
    vertex.incomingSegmentId === vertex.outgoingSegmentId
  ) {
    return {
      operationKind: 'remove-vertex-merge',
      pieceId,
      targetVertexRef: vertexRef,
      sourceSegmentIds: [
        ...(vertex.incomingSegmentId ? [vertex.incomingSegmentId] : []),
        ...(vertex.outgoingSegmentId ? [vertex.outgoingSegmentId] : [])
      ],
      isExact: false,
      maxDeviationCm: Number.POSITIVE_INFINITY,
      toleranceCm,
      exceedsTolerance: true,
      canApply: false,
      requiresConfirmation: false,
      method: 'topology-guard-rejected',
      summaryLabel: 'Rejected: Vertex is not a shared junction between two distinct sew segments.',
      rejectionReason: 'Only shared interior junctions between two distinct sew segments can be merged.',
      previewSegment: null
    };
  }

  const segA = segments.find((s) => s.id === vertex.incomingSegmentId);
  const segB = segments.find((s) => s.id === vertex.outgoingSegmentId);
  if (!segA || !segB) {
    return {
      ok: false,
      errorCode: 'SEGMENT_NOT_FOUND',
      message: 'Incident sew segments for vertex could not be resolved.'
    };
  }

  const existingIds = new Set(segments.map((s) => s.id));
  const mergedId = allocateDeterministicSegmentId(`${segA.id}__merged`, existingIds);

  // Case 1: Line + Line
  if (segA.kind === 'line' && segB.kind === 'line') {
    const mergedLine: RenderCurveSegment = {
      id: mergedId,
      kind: 'line',
      ...(segA.seamId !== undefined && segA.seamId === segB.seamId ? { seamId: segA.seamId } : {}),
      role: segA.role,
      p0: clonePoint(segA.p0),
      p3: clonePoint(segB.p3),
      ...(segA.isFold && segB.isFold ? { isFold: true } : {})
    };
    const closest = closestPointOnFiniteLine(vertex.localPointCm, segA.p0, segB.p3);
    const maxDev = normalizeZero(closest.distanceCm);
    const isCollinearNoFoldback =
      maxDev <= EXACT_MERGE_DEVIATION_EPSILON_CM && closest.u >= 0 && closest.u <= 1;
    const isExact = isCollinearNoFoldback;
    const exceedsTolerance = !isExact && maxDev > toleranceCm;

    return {
      operationKind: 'remove-vertex-merge',
      pieceId,
      targetVertexRef: vertexRef,
      sourceSegmentIds: [segA.id, segB.id],
      isExact,
      maxDeviationCm: isExact ? 0 : maxDev,
      toleranceCm,
      exceedsTolerance,
      canApply: !exceedsTolerance,
      requiresConfirmation: !isExact,
      method: isExact ? 'collinear-line-merge-exact' : 'line-corner-merge-approx',
      summaryLabel: isExact
        ? 'Exact collinear line merge (0.0000 cm geometric deviation)'
        : exceedsTolerance
          ? `Rejected: Removing corner vertex causes ${maxDev.toFixed(4)} cm deviation (> ${toleranceCm.toFixed(4)} cm tolerance)`
          : `Approximate line merge (max deviation ${maxDev.toFixed(4)} cm ≤ ${toleranceCm.toFixed(4)} cm tolerance)`,
      ...(exceedsTolerance
        ? {
            rejectionReason: `Vertex removal deviation (${maxDev.toFixed(4)} cm) exceeds tolerance (${toleranceCm.toFixed(4)} cm).`
          }
        : {}),
      previewSegment: mergedLine,
      worstCurvePointCm: vertex.localPointCm,
      closestPreviewPointCm: closest.point
    };
  }

  // Case 2: At least one cubic Bézier segment
  const lenA = Math.max(ZERO_LENGTH_EPSILON_CM, computeSegmentLengthCm(segA));
  const lenB = Math.max(ZERO_LENGTH_EPSILON_CM, computeSegmentLengthCm(segB));
  const rawSplitWeight = lenA / (lenA + lenB);
  const splitWeight = Math.max(0.05, Math.min(0.95, rawSplitWeight));

  // Candidate A: Exact De Casteljau split inverse (recovers exact original cubic if split!)
  const cA = getCubicControlPoints(segA);
  const cB = getCubicControlPoints(segB);
  const invP1 = {
    x: normalizeZero(cA.p0.x + (cA.p1.x - cA.p0.x) / splitWeight),
    y: normalizeZero(cA.p0.y + (cA.p1.y - cA.p0.y) / splitWeight)
  };
  const invP2 = {
    x: normalizeZero(cB.p3.x + (cB.p2.x - cB.p3.x) / (1 - splitWeight)),
    y: normalizeZero(cB.p3.y + (cB.p2.y - cB.p3.y) / (1 - splitWeight))
  };
  const deCasteljauInverseCandidate: RenderCurveSegment = {
    id: mergedId,
    kind: 'cubic-bezier',
    ...(segA.seamId !== undefined && segA.seamId === segB.seamId ? { seamId: segA.seamId } : {}),
    role: segA.role,
    p0: clonePoint(cA.p0),
    p1: invP1,
    p2: invP2,
    p3: clonePoint(cB.p3),
    ...(segA.isFold && segB.isFold ? { isFold: true } : {})
  };

  // Candidate B: Closed-form least-squares cubic fit with fixed endpoints
  const lsCandidate = fitLeastSquaresMergedCubic(segA, segB, mergedId, splitWeight);

  const devInv = measureMergedSegmentDeviation(segA, segB, deCasteljauInverseCandidate);
  const devLs = measureMergedSegmentDeviation(segA, segB, lsCandidate);

  const useInverse = devInv.maxDeviationCm <= devLs.maxDeviationCm;
  const chosenSegment = useInverse ? deCasteljauInverseCandidate : lsCandidate;
  const chosenDev = useInverse ? devInv : devLs;
  const isExact = chosenDev.maxDeviationCm <= EXACT_MERGE_DEVIATION_EPSILON_CM;
  const exceedsTolerance = !isExact && chosenDev.maxDeviationCm > toleranceCm;
  const method = isExact
    ? 'de-casteljau-cubic-merge-exact'
    : useInverse
      ? 'de-casteljau-cubic-merge-approx'
      : 'least-squares-cubic-merge-approx';

  return {
    operationKind: 'remove-vertex-merge',
    pieceId,
    targetVertexRef: vertexRef,
    sourceSegmentIds: [segA.id, segB.id],
    isExact,
    maxDeviationCm: isExact ? 0 : chosenDev.maxDeviationCm,
    toleranceCm,
    exceedsTolerance,
    canApply: !exceedsTolerance,
    requiresConfirmation: !isExact,
    method,
    summaryLabel: isExact
      ? 'Exact cubic merge (mathematically exact inverse, 0.0000 cm deviation)'
      : exceedsTolerance
        ? `Rejected: Cubic merge deviation (${chosenDev.maxDeviationCm.toFixed(4)} cm) exceeds tolerance (${toleranceCm.toFixed(4)} cm)`
        : `Approximate cubic merge (max deviation ${chosenDev.maxDeviationCm.toFixed(4)} cm ≤ ${toleranceCm.toFixed(4)} cm tolerance)`,
    ...(exceedsTolerance
      ? {
          rejectionReason: `Vertex removal & merge deviation (${chosenDev.maxDeviationCm.toFixed(4)} cm) exceeds configured tolerance (${toleranceCm.toFixed(4)} cm).`
        }
      : {}),
    previewSegment: chosenSegment,
    worstCurvePointCm: chosenDev.worstSourcePointCm,
    closestPreviewPointCm: chosenDev.closestMergedPointCm
  };
}

export function applyRemoveVertexAndMerge(
  state: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  pieceId: string,
  vertexRef: string,
  options: {
    readonly toleranceCm?: number;
    readonly confirmApproximation: boolean;
  }
): ProposalOperationResult {
  const toleranceCm = options.toleranceCm ?? state.defaultApproximationToleranceCm;
  const preview = previewRemoveVertexAndMerge(
    state,
    sourceArtifact,
    pieceId,
    vertexRef,
    toleranceCm
  );
  if ('ok' in preview) return preview;

  if (preview.method === 'topology-guard-rejected') {
    return {
      ok: false,
      errorCode: 'MINIMUM_TOPOLOGY_VIOLATION',
      message: preview.rejectionReason ?? preview.summaryLabel
    };
  }
  if (preview.exceedsTolerance || !preview.canApply || !preview.previewSegment) {
    return {
      ok: false,
      errorCode: 'TOLERANCE_EXCEEDED',
      message:
        preview.rejectionReason ??
        `Vertex merge deviation (${preview.maxDeviationCm.toFixed(4)} cm) exceeds tolerance (${toleranceCm.toFixed(4)} cm).`,
      maxDeviationCm: preview.maxDeviationCm,
      toleranceCm
    };
  }
  if (!preview.isExact && !options.confirmApproximation) {
    return {
      ok: false,
      errorCode: 'CONFIRMATION_REQUIRED',
      message:
        'Non-exact vertex removal & segment merge requires explicit user confirmation after preview.',
      maxDeviationCm: preview.maxDeviationCm,
      toleranceCm
    };
  }

  const sourcePiece = sourceArtifact.pieces.find((p) => p.pieceId === pieceId)!;
  const pieceProp = ensureEditablePieceProposal(state, sourcePiece);
  const [segAId, segBId] = preview.sourceSegmentIds;
  const idxA = pieceProp.sewSegments.findIndex((s) => s.id === segAId);
  const idxB = pieceProp.sewSegments.findIndex((s) => s.id === segBId);
  if (idxA < 0 || idxB < 0) {
    return {
      ok: false,
      errorCode: 'SEGMENT_NOT_FOUND',
      message: 'Incident segments could not be found during merge commit.'
    };
  }

  const mergedSeg = preview.previewSegment;
  const nextSegments: RenderCurveSegment[] = [];
  if (idxA === pieceProp.sewSegments.length - 1 && idxB === 0) {
    // Wrap-around junction: remove seg[0] and replace last segment with merged
    for (let i = 1; i < pieceProp.sewSegments.length - 1; i += 1) {
      nextSegments.push(pieceProp.sewSegments[i]);
    }
    nextSegments.push(mergedSeg);
  } else {
    for (let i = 0; i < pieceProp.sewSegments.length; i += 1) {
      if (i === idxA) {
        nextSegments.push(mergedSeg);
      } else if (i === idxB) {
        continue;
      } else {
        nextSegments.push(pieceProp.sewSegments[i]);
      }
    }
  }

  const linA = pieceProp.segmentLineage[segAId];
  const linB = pieceProp.segmentLineage[segBId];
  const combinedBaseIds = Array.from(
    new Set([...(linA?.baseSegmentIds ?? [segAId]), ...(linB?.baseSegmentIds ?? [segBId])])
  );

  const nextLineage: Record<string, ProposalSegmentLineage> = { ...pieceProp.segmentLineage };
  delete nextLineage[segAId];
  delete nextLineage[segBId];
  nextLineage[mergedSeg.id] = {
    segmentId: mergedSeg.id,
    baseSegmentIds: combinedBaseIds,
    derivation: preview.isExact ? 'merged-exact' : 'merged-approx',
    maxApproximationDeviationCm: Math.max(
      linA?.maxApproximationDeviationCm ?? 0,
      linB?.maxApproximationDeviationCm ?? 0,
      preview.maxDeviationCm
    ),
    ...(preview.isExact ? {} : { approximationMethod: preview.method })
  };

  const nextModes = { ...pieceProp.vertexContinuityModes };
  delete nextModes[vertexRef];

  const nextApproxRecords = preview.isExact
    ? pieceProp.approximationRecords
    : [
        ...pieceProp.approximationRecords,
        {
          id: `approx-${pieceProp.operationsAppliedCount + 1}-${mergedSeg.id}`,
          operationKind: 'remove-vertex-merge' as const,
          pieceId,
          sourceSegmentIds: [segAId, segBId],
          resultSegmentId: mergedSeg.id,
          maxDeviationCm: preview.maxDeviationCm,
          toleranceCm,
          method: preview.method
        }
      ];

  const nextPieceProp: PieceGeometryProposal = {
    ...pieceProp,
    sewSegments: nextSegments,
    segmentLineage: nextLineage,
    vertexContinuityModes: nextModes,
    operationsAppliedCount: pieceProp.operationsAppliedCount + 1,
    approximationRecords: nextApproxRecords
  };

  return {
    ok: true,
    state: withUpdatedPieceProposal(state, sourcePiece, nextPieceProp),
    actionLabel: preview.isExact
      ? `Remove vertex & merge (exact) on ${sourcePiece.pieceCode}`
      : `Remove vertex & merge (approx, Δmax=${preview.maxDeviationCm.toFixed(3)} cm) on ${sourcePiece.pieceCode}`,
    pieceId,
    isExact: preview.isExact,
    maxDeviationCm: preview.maxDeviationCm,
    createdSegmentIds: [mergedSeg.id],
    removedSegmentIds: [segAId, segBId],
    nextSelectedSegmentId: mergedSeg.id
  };
}

// ---------------------------------------------------------------------------
// 7. Independent Bounded Proposal History & Reconciliation (D4, R4)
// ---------------------------------------------------------------------------

export function canUndoProposal(history: GeometryProposalHistoryState): boolean {
  return history.past.length > 0;
}

export function canRedoProposal(history: GeometryProposalHistoryState): boolean {
  return history.future.length > 0;
}

export function commitProposalOperation(
  history: GeometryProposalHistoryState,
  nextState: PatternGeometryProposalState,
  actionLabel: string,
  pieceId?: string
): GeometryProposalHistoryState {
  if (nextState === history.present) return history;
  const nextSeq = history.sequenceCounter + 1;
  const entry: GeometryProposalHistoryEntry = {
    id: `prop-op-${nextSeq}`,
    actionLabel: history.lastActionLabel,
    pieceId,
    state: history.present
  };
  const nextPast = [...history.past, entry].slice(-history.maxEntries);
  return {
    ...history,
    past: nextPast,
    present: nextState,
    future: [],
    lastActionLabel: actionLabel,
    sequenceCounter: nextSeq
  };
}

export function undoProposalHistory(
  history: GeometryProposalHistoryState
): GeometryProposalHistoryState {
  if (history.past.length === 0) return history;
  const previousEntry = history.past[history.past.length - 1];
  const nextPast = history.past.slice(0, -1);
  const redoEntry: GeometryProposalHistoryEntry = {
    id: `prop-redo-${history.sequenceCounter + 1}`,
    actionLabel: history.lastActionLabel,
    pieceId: previousEntry.pieceId,
    state: history.present
  };
  return {
    ...history,
    past: nextPast,
    present: previousEntry.state,
    future: [redoEntry, ...history.future].slice(0, history.maxEntries),
    lastActionLabel: previousEntry.actionLabel,
    sequenceCounter: history.sequenceCounter + 1
  };
}

export function redoProposalHistory(
  history: GeometryProposalHistoryState
): GeometryProposalHistoryState {
  if (history.future.length === 0) return history;
  const nextEntry = history.future[0];
  const nextFuture = history.future.slice(1);
  const undoEntry: GeometryProposalHistoryEntry = {
    id: `prop-undo-${history.sequenceCounter + 1}`,
    actionLabel: history.lastActionLabel,
    pieceId: nextEntry.pieceId,
    state: history.present
  };
  return {
    ...history,
    past: [...history.past, undoEntry].slice(-history.maxEntries),
    present: nextEntry.state,
    future: nextFuture,
    lastActionLabel: nextEntry.actionLabel,
    sequenceCounter: history.sequenceCounter + 1
  };
}

export function discardPieceProposal(
  history: GeometryProposalHistoryState,
  pieceId: string
): GeometryProposalHistoryState {
  if (!history.present.pieceProposals[pieceId]) return history;
  const nextPieces = { ...history.present.pieceProposals };
  delete nextPieces[pieceId];
  const hasEdits = Object.values(nextPieces).some((p) => p.modifiedFromOriginal);
  const nextState: PatternGeometryProposalState = {
    ...history.present,
    pieceProposals: nextPieces,
    hasEdits
  };
  return commitProposalOperation(history, nextState, `Discard proposal edits on ${pieceId}`, pieceId);
}

export function discardAllProposal(
  artifact: PatternArtifactBundle,
  defaultApproximationToleranceCm: number = DEFAULT_APPROXIMATION_TOLERANCE_CM
): GeometryProposalHistoryState {
  return {
    past: [],
    present: createProposalStateFromArtifact(artifact, defaultApproximationToleranceCm),
    future: [],
    lastActionLabel: 'Discarded all geometry proposal edits',
    sequenceCounter: 0,
    maxEntries: MAX_PROPOSAL_HISTORY_ENTRIES
  };
}

export function updateProposalTolerance(
  history: GeometryProposalHistoryState,
  toleranceCm: number
): GeometryProposalHistoryState {
  if (!Number.isFinite(toleranceCm) || toleranceCm < 0) return history;
  if (history.present.defaultApproximationToleranceCm === toleranceCm) return history;
  return {
    ...history,
    present: {
      ...history.present,
      defaultApproximationToleranceCm: toleranceCm
    }
  };
}

function identitiesMatch(a: SourceArtifactIdentity, b: SourceArtifactIdentity): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.specificationRevisionId === b.specificationRevisionId &&
    a.measurementRevisionId === b.measurementRevisionId &&
    a.engineVersion === b.engineVersion &&
    a.authorityTier === b.authorityTier &&
    a.artifactDigestSha256 === b.artifactDigestSha256 &&
    a.geometryFingerprint === b.geometryFingerprint
  );
}

/**
 * Reconciles active proposal history when the immutable source `PatternArtifactBundle` changes.
 * - Clean empty proposals adopt the new artifact identity automatically.
 * - Active edited proposals are NEVER silently applied onto a different source artifact;
 *   they are quarantined with explicit stale status and reasons until discarded (R4).
 */
export function reconcileProposalHistoryWithArtifact(
  history: GeometryProposalHistoryState,
  nextArtifact: PatternArtifactBundle
): GeometryProposalHistoryState {
  const nextIdentity = extractSourceArtifactIdentity(nextArtifact);
  const currentIdentity = history.present.sourceIdentity;

  if (identitiesMatch(currentIdentity, nextIdentity)) {
    if (history.present.reconciliationStatus === 'aligned') {
      return history;
    }
    return {
      ...history,
      present: {
        ...history.present,
        reconciliationStatus: 'aligned',
        reconciliationReasons: []
      }
    };
  }

  // No active edits and no history -> seamlessly adopt new source artifact
  if (!history.present.hasEdits && history.past.length === 0 && history.future.length === 0) {
    return {
      ...history,
      present: createProposalStateFromArtifact(
        nextArtifact,
        history.present.defaultApproximationToleranceCm
      )
    };
  }

  // Active edits exist -> check provenance drift and missing piece/segment references
  const reasons: string[] = [];
  if (currentIdentity.specificationRevisionId !== nextIdentity.specificationRevisionId) {
    reasons.push(
      `Specification revision changed (${currentIdentity.specificationRevisionId} → ${nextIdentity.specificationRevisionId}).`
    );
  }
  if (currentIdentity.measurementRevisionId !== nextIdentity.measurementRevisionId) {
    reasons.push(
      `Measurement revision changed (${currentIdentity.measurementRevisionId} → ${nextIdentity.measurementRevisionId}).`
    );
  }
  if (currentIdentity.authorityTier !== nextIdentity.authorityTier) {
    reasons.push(
      `Source authority tier changed (${currentIdentity.authorityTier} → ${nextIdentity.authorityTier}).`
    );
  }
  if (currentIdentity.artifactDigestSha256 !== nextIdentity.artifactDigestSha256) {
    reasons.push(
      `Source artifact digest changed (${currentIdentity.artifactDigestSha256 ?? 'missing'} → ${nextIdentity.artifactDigestSha256 ?? 'missing'}).`
    );
  }
  if (currentIdentity.geometryFingerprint !== nextIdentity.geometryFingerprint) {
    reasons.push(
      `Source geometry fingerprint changed (${currentIdentity.geometryFingerprint} → ${nextIdentity.geometryFingerprint}).`
    );
  }

  let hasMissingReferences = false;
  const nextPieceMap = new Map(nextArtifact.pieces.map((p) => [p.pieceId, p]));

  for (const [pieceId, pieceProp] of Object.entries(history.present.pieceProposals)) {
    if (!pieceProp.modifiedFromOriginal) continue;
    const nextPiece = nextPieceMap.get(pieceId);
    if (!nextPiece) {
      hasMissingReferences = true;
      reasons.push(`Edited piece "${pieceId}" no longer exists in the updated source artifact.`);
      continue;
    }
    const nextBaseIds = new Set(nextPiece.sewSegments.map((s) => s.id));
    for (const lin of Object.values(pieceProp.segmentLineage)) {
      for (const baseId of lin.baseSegmentIds) {
        if (!nextBaseIds.has(baseId)) {
          hasMissingReferences = true;
          reasons.push(
            `Base sew segment "${baseId}" on piece "${pieceId}" is missing in the updated source artifact.`
          );
        }
      }
    }
  }

  const status: ProposalReconciliationStatus = hasMissingReferences
    ? 'stale-missing-references'
    : 'stale-artifact-changed';

  return {
    ...history,
    present: {
      ...history.present,
      reconciliationStatus: status,
      reconciliationReasons: reasons
    }
  };
}

// ---------------------------------------------------------------------------
// 8. D3 — Proposed Inspection & Measurement Artifact Projection (Non-Mutating)
// ---------------------------------------------------------------------------

/**
 * Produces a read-only presentation `PatternArtifactBundle` incorporating active
 * non-stale proposed sew contours so Inspect (I) and Measure (M) can operate on
 * active proposal geometry (D3), while strictly preserving:
 * - Original read-only `cutSegments` (D2)
 * - `authorityTier: 'UNVERIFIED_VISUAL_PROPOSAL'`, `isCertified: false`, `isProductionReady: false`
 * - Original `sourceArtifact` completely unmutated
 * - When proposal is stale or has no edits, returns `sourceArtifact` directly.
 */
export function buildProposedInspectionArtifact(
  sourceArtifact: PatternArtifactBundle,
  proposalState: PatternGeometryProposalState
): PatternArtifactBundle {
  if (!proposalState.hasEdits || proposalState.reconciliationStatus !== 'aligned') {
    return sourceArtifact;
  }

  const projectedPieces: PatternPieceRenderModel[] = sourceArtifact.pieces.map((piece) => {
    const pieceProp = proposalState.pieceProposals[piece.pieceId];
    if (!pieceProp || !pieceProp.modifiedFromOriginal) {
      return piece;
    }
    return {
      ...piece,
      sewSegments: pieceProp.sewSegments,
      // D2: cutSegments remain strictly original and read-only
      cutSegments: piece.cutSegments,
      // Clear fallback SVG path for edited piece so renderers use sewSegments
      fallbackSewSvgPath: undefined,
      boundingBoxCm: computeBoundingBoxForSegments(
        pieceProp.sewSegments,
        piece.cutSegments,
        piece.boundingBoxCm
      )
    };
  });

  return {
    ...sourceArtifact,
    authorityTier: PROPOSAL_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    provenance: {
      ...sourceArtifact.provenance,
      disclosureLabel: `${UNVERIFIED_PROPOSAL_DISCLOSURE} (Derived from ${sourceArtifact.provenance.specificationRevisionId})`
    },
    pieces: projectedPieces,
    // D3: Diagnostics are NEVER migrated to proposal geometry; keep empty on proposal view
    // while Patroner renders spatial diagnostics strictly from immutable sourceArtifact.
    diagnostics: []
  };
}

// ---------------------------------------------------------------------------
// 9. R3 — Advisory Non-Certified Geometry Integrity Evaluation
// ---------------------------------------------------------------------------

function segmentsProperlyIntersect2D(
  a1: RenderPoint2D,
  a2: RenderPoint2D,
  b1: RenderPoint2D,
  b2: RenderPoint2D
): boolean {
  const cross = (o: RenderPoint2D, p: RenderPoint2D, q: RenderPoint2D) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);

  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);

  if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
      ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) {
    return true;
  }
  return false;
}

function detectContourSelfIntersection(segments: readonly RenderCurveSegment[]): boolean {
  const edges: Array<{ segIdx: number; subIdx: number; a: RenderPoint2D; b: RenderPoint2D }> = [];
  const subPerCubic = 12;

  for (let sIdx = 0; sIdx < segments.length; sIdx += 1) {
    const seg = segments[sIdx];
    if (!isSegmentFinite(seg)) continue;
    const steps = seg.kind === 'cubic-bezier' ? subPerCubic : 1;
    let prev = seg.p0;
    for (let k = 1; k <= steps; k += 1) {
      const next = k === steps ? seg.p3 : evaluateSegmentAtT(seg, k / steps);
      edges.push({ segIdx: sIdx, subIdx: k - 1, a: prev, b: next });
      prev = next;
    }
  }

  const n = edges.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      // Skip wrap-around adjacent edge pair (first and last)
      if (i === 0 && j === n - 1) continue;
      if (segmentsProperlyIntersect2D(edges[i].a, edges[i].b, edges[j].a, edges[j].b)) {
        return true;
      }
    }
  }
  return false;
}

function checkStationaryCuspAndFoldback(segments: readonly RenderCurveSegment[]): {
  status: ProposalIntegrityCheckStatus;
  message: string;
  segmentId?: string;
} {
  // 1. Check cubic segments for zero-speed stationary cusps or near-stationary handle collapse
  let nearStationarySegId: string | undefined;

  for (const seg of segments) {
    if (seg.kind !== 'cubic-bezier' || !seg.p1 || !seg.p2) continue;
    const chord = pointDistanceCm(seg.p0, seg.p3);
    const scale = Math.max(
      chord,
      pointDistanceCm(seg.p0, seg.p1),
      pointDistanceCm(seg.p2, seg.p3),
      1e-6
    );
    const samples = 48;
    for (let k = 0; k <= samples; k += 1) {
      const t = k / samples;
      const d = evaluateCubicDerivative(seg.p0, seg.p1, seg.p2, seg.p3, t);
      const speed = Math.hypot(d.x, d.y);
      if (speed <= STATIONARY_DERIVATIVE_FLOOR || speed <= scale * STATIONARY_RELATIVE_FACTOR) {
        return {
          status: 'invalid-proposal',
          message: `Stationary zero-speed cusp detected on cubic segment "${seg.id}" near t=${t.toFixed(2)}.`,
          segmentId: seg.id
        };
      }
      if (speed < scale * 0.02 && !nearStationarySegId) {
        nearStationarySegId = seg.id;
      }
    }
  }

  // 2. Check shared junctions for sharp ~180° foldback reversal
  const n = segments.length;
  for (let i = 0; i < n; i += 1) {
    const incoming = segments[i];
    const outgoing = segments[(i + 1) % n];
    if (pointDistanceCm(incoming.p3, outgoing.p0) > CONTOUR_CLOSURE_EPSILON_CM) continue;

    // Incoming tangent pointing backward from junction, outgoing tangent pointing forward
    const inVec =
      incoming.kind === 'cubic-bezier' && incoming.p2 && pointDistanceCm(incoming.p3, incoming.p2) > ZERO_LENGTH_EPSILON_CM
        ? { x: incoming.p2.x - incoming.p3.x, y: incoming.p2.y - incoming.p3.y }
        : { x: incoming.p0.x - incoming.p3.x, y: incoming.p0.y - incoming.p3.y };
    const outVec =
      outgoing.kind === 'cubic-bezier' && outgoing.p1 && pointDistanceCm(outgoing.p0, outgoing.p1) > ZERO_LENGTH_EPSILON_CM
        ? { x: outgoing.p1.x - outgoing.p0.x, y: outgoing.p1.y - outgoing.p0.y }
        : { x: outgoing.p3.x - outgoing.p0.x, y: outgoing.p3.y - outgoing.p0.y };

    const lenIn = Math.hypot(inVec.x, inVec.y);
    const lenOut = Math.hypot(outVec.x, outVec.y);
    if (lenIn > ZERO_LENGTH_EPSILON_CM && lenOut > ZERO_LENGTH_EPSILON_CM) {
      const cosTheta = Math.max(
        -1,
        Math.min(1, (inVec.x * outVec.x + inVec.y * outVec.y) / (lenIn * lenOut))
      );
      const interiorAngleDeg = (Math.acos(cosTheta) * 180) / Math.PI;
      if (interiorAngleDeg < ADVISORY_FOLDBACK_ANGLE_THRESHOLD_DEG) {
        return {
          status: 'invalid-proposal',
          message: `Sharp foldback corner (${interiorAngleDeg.toFixed(2)}°) detected between "${incoming.id}" and "${outgoing.id}".`,
          segmentId: outgoing.id
        };
      }
    }
  }

  if (nearStationarySegId) {
    return {
      status: 'advisory-warning',
      message: `Near-stationary derivative speed detected on cubic segment "${nearStationarySegId}" (tight handle curvature).`,
      segmentId: nearStationarySegId
    };
  }

  return {
    status: 'pass',
    message: 'No stationary zero-speed cusps or sharp foldbacks detected.'
  };
}

function computeSeamLengthForPiece(
  piece: PatternPieceRenderModel,
  seamSegmentIds: readonly string[],
  proposalState: PatternGeometryProposalState
): number | null {
  const pieceProp = proposalState.pieceProposals[piece.pieceId];
  const segments = pieceProp?.sewSegments ?? piece.sewSegments;
  const baseSet = new Set(seamSegmentIds);

  let matchedSegments: RenderCurveSegment[];
  if (pieceProp) {
    matchedSegments = segments.filter((seg) => {
      if (baseSet.has(seg.id)) return true;
      const lin = pieceProp.segmentLineage[seg.id];
      return lin ? lin.baseSegmentIds.some((id) => baseSet.has(id)) : false;
    });
  } else {
    matchedSegments = segments.filter((seg) => baseSet.has(seg.id));
  }

  if (matchedSegments.length === 0) return null;
  let total = 0;
  for (const seg of matchedSegments) {
    const len = computeSegmentLengthCm(seg);
    if (!Number.isFinite(len)) return null;
    total += len;
  }
  return total;
}

export function evaluateProposalIntegrity(
  proposalState: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  focusPieceId?: string
): ProposalIntegrityReport {
  const checks: ProposalIntegrityCheckItem[] = [];

  // 10. Source reference reconciliation (checked first for clarity)
  if (proposalState.reconciliationStatus !== 'aligned') {
    checks.push({
      id: 'source-reference-reconciliation',
      label: 'Source Reference Reconciliation',
      status: 'invalid-proposal',
      message:
        proposalState.reconciliationReasons[0] ??
        `Proposal is stale (${proposalState.reconciliationStatus}). Discard or reset against the current artifact.`
    });
  } else {
    checks.push({
      id: 'source-reference-reconciliation',
      label: 'Source Reference Reconciliation',
      status: 'pass',
      message: proposalState.sourceIdentity.hasVerifiedSourceDigest
        ? 'Aligned with current source artifact revision and verified digest.'
        : 'Aligned with current source artifact revision and structural geometry fingerprint (source SHA-256 digest not present on artifact).'
    });
  }

  const targetPieces = sourceArtifact.pieces.filter((p) => {
    if (focusPieceId) return p.pieceId === focusPieceId;
    const prop = proposalState.pieceProposals[p.pieceId];
    return Boolean(prop?.modifiedFromOriginal);
  });

  const piecesToCheck = targetPieces.length > 0 ? targetPieces : sourceArtifact.pieces.slice(0, 1);

  if (piecesToCheck.length === 0) {
    const unassessedIds: Array<[ProposalIntegrityCheckId, string]> = [
      ['finite-coordinates', 'Finite Coordinates'],
      ['contour-closure', 'Contour Closure'],
      ['minimum-segment-length', 'Minimum Segment Length'],
      ['degenerate-collapsed-geometry', 'Degenerate / Collapsed Contour'],
      ['contour-orientation-signed-area', 'Contour Orientation & Signed Area'],
      ['self-intersection', 'Self-Intersection Check'],
      ['stationary-cusp-foldback', 'Stationary Cusp / Foldback'],
      ['paired-seam-length-delta', 'Paired Seam Length Delta'],
      ['approximation-deviation', 'Approximation Deviation']
    ];
    for (const [id, label] of unassessedIds) {
      checks.push({
        id,
        label,
        status: 'unassessed',
        message: 'No pattern piece geometry available to assess.'
      });
    }
  } else {
    // 1. Finite coordinates
    let nonFinitePiece: string | undefined;
    let nonFiniteSeg: string | undefined;
    for (const piece of piecesToCheck) {
      const segs = getEffectivePieceSegments(proposalState, piece);
      for (const seg of segs) {
        if (!isSegmentFinite(seg)) {
          nonFinitePiece = piece.pieceId;
          nonFiniteSeg = seg.id;
          break;
        }
      }
      if (nonFinitePiece) break;
    }
    checks.push({
      id: 'finite-coordinates',
      label: 'Finite Coordinates',
      status: nonFinitePiece ? 'invalid-proposal' : 'pass',
      message: nonFinitePiece
        ? `Non-finite coordinate detected in segment "${nonFiniteSeg}" on piece "${nonFinitePiece}".`
        : 'All evaluated sew-contour coordinates are finite float64 numbers.',
      pieceId: nonFinitePiece,
      segmentId: nonFiniteSeg
    });

    // 2. Contour closure
    let maxGap = 0;
    let gapPiece: string | undefined;
    for (const piece of piecesToCheck) {
      const segs = getEffectivePieceSegments(proposalState, piece);
      for (let i = 0; i < segs.length; i += 1) {
        const curr = segs[i];
        const next = segs[(i + 1) % segs.length];
        if (!isSegmentFinite(curr) || !isSegmentFinite(next)) continue;
        const gap = pointDistanceCm(curr.p3, next.p0);
        if (gap > maxGap) {
          maxGap = gap;
          gapPiece = piece.pieceId;
        }
      }
    }
    checks.push({
      id: 'contour-closure',
      label: 'Contour Closure',
      status: maxGap > CONTOUR_CLOSURE_EPSILON_CM ? 'invalid-proposal' : 'pass',
      message:
        maxGap > CONTOUR_CLOSURE_EPSILON_CM
          ? `Open sew contour gap of ${maxGap.toFixed(4)} cm exceeds closure tolerance (${CONTOUR_CLOSURE_EPSILON_CM} cm).`
          : `Sew contour is sequentially closed (max gap ${maxGap.toExponential(2)} cm).`,
      pieceId: gapPiece,
      metricValueCm: maxGap
    });

    // 3. Minimum segment length
    let minLen = Number.POSITIVE_INFINITY;
    let minLenPiece: string | undefined;
    let minLenSeg: string | undefined;
    for (const piece of piecesToCheck) {
      const segs = getEffectivePieceSegments(proposalState, piece);
      for (const seg of segs) {
        const len = computeSegmentLengthCm(seg);
        if (Number.isFinite(len) && len < minLen) {
          minLen = len;
          minLenPiece = piece.pieceId;
          minLenSeg = seg.id;
        }
      }
    }
    const minLenStatus: ProposalIntegrityCheckStatus = !Number.isFinite(minLen)
      ? 'unassessed'
      : minLen <= MIN_VALID_SEGMENT_LENGTH_CM
        ? 'invalid-proposal'
        : minLen < MIN_ADVISORY_SEGMENT_LENGTH_CM
          ? 'advisory-warning'
          : 'pass';
    checks.push({
      id: 'minimum-segment-length',
      label: 'Minimum Segment Length',
      status: minLenStatus,
      message:
        minLenStatus === 'unassessed'
          ? 'Segment lengths could not be evaluated.'
          : minLenStatus === 'invalid-proposal'
            ? `Zero/collapsed segment "${minLenSeg}" (${minLen.toExponential(2)} cm).`
            : minLenStatus === 'advisory-warning'
              ? `Very short sew segment "${minLenSeg}" (${minLen.toFixed(4)} cm < ${MIN_ADVISORY_SEGMENT_LENGTH_CM} cm).`
              : `Shortest sew segment is ${minLen.toFixed(3)} cm.`,
      pieceId: minLenPiece,
      segmentId: minLenSeg,
      metricValueCm: Number.isFinite(minLen) ? minLen : undefined
    });

    // 4, 5, 6. Orientation, collapsed area, self-intersection
    let collapsedCheck: ProposalIntegrityCheckItem = {
      id: 'degenerate-collapsed-geometry',
      label: 'Degenerate / Collapsed Contour',
      status: 'pass',
      message: 'Evaluated sew contour encloses non-collapsed area.'
    };
    let orientationCheck: ProposalIntegrityCheckItem = {
      id: 'contour-orientation-signed-area',
      label: 'Contour Orientation & Signed Area',
      status: 'pass',
      message: `Winding matches ${sourceArtifact.coordinateFrame.exteriorWinding} exterior contract.`
    };
    let selfIntCheck: ProposalIntegrityCheckItem = {
      id: 'self-intersection',
      label: 'Self-Intersection Check',
      status: 'pass',
      message: 'No sew-contour self-intersections detected by advisory polyline screen.'
    };

    for (const piece of piecesToCheck) {
      const segs = getEffectivePieceSegments(proposalState, piece);
      const orientation = analyzeContourOrientation(segs, sourceArtifact.coordinateFrame);

      if (
        orientation.status === 'collapsed-area' ||
        orientation.status === 'insufficient-geometry' ||
        orientation.status === 'non-finite-geometry'
      ) {
        collapsedCheck = {
          id: 'degenerate-collapsed-geometry',
          label: 'Degenerate / Collapsed Contour',
          status: 'invalid-proposal',
          message: orientation.reason ?? 'Collapsed or insufficient contour geometry.',
          pieceId: piece.pieceId
        };
      }

      if (
        orientation.status === 'self-intersecting-or-uncertain' ||
        detectContourSelfIntersection(segs)
      ) {
        selfIntCheck = {
          id: 'self-intersection',
          label: 'Self-Intersection Check',
          status: 'invalid-proposal',
          message: `Advisory self-intersection detected on sew contour of "${piece.pieceCode}".`,
          pieceId: piece.pieceId
        };
      }

      if (orientation.status === 'determined') {
        if (orientation.matchesMetadataExteriorWinding === false) {
          orientationCheck = {
            id: 'contour-orientation-signed-area',
            label: 'Contour Orientation & Signed Area',
            status: 'invalid-proposal',
            message: `Inverted contour winding on "${piece.pieceCode}": got ${orientation.algebraicWinding} (visual ${orientation.visualWinding}), expected ${sourceArtifact.coordinateFrame.exteriorWinding}.`,
            pieceId: piece.pieceId
          };
        }
      } else if (orientationCheck.status === 'pass') {
        orientationCheck = {
          id: 'contour-orientation-signed-area',
          label: 'Contour Orientation & Signed Area',
          status: 'unassessed',
          message: `Orientation indeterminate (${orientation.status}): ${orientation.reason ?? 'contour not simple/closed'}`,
          pieceId: piece.pieceId
        };
      }
    }

    checks.push(collapsedCheck, orientationCheck, selfIntCheck);

    // 7. Stationary cusp / foldback
    let cuspCheck: ProposalIntegrityCheckItem = {
      id: 'stationary-cusp-foldback',
      label: 'Stationary Cusp / Foldback',
      status: 'pass',
      message: 'No stationary zero-speed cusps or sharp foldbacks detected.'
    };
    for (const piece of piecesToCheck) {
      const segs = getEffectivePieceSegments(proposalState, piece);
      const res = checkStationaryCuspAndFoldback(segs);
      if (res.status === 'invalid-proposal') {
        cuspCheck = {
          id: 'stationary-cusp-foldback',
          label: 'Stationary Cusp / Foldback',
          status: 'invalid-proposal',
          message: res.message,
          pieceId: piece.pieceId,
          segmentId: res.segmentId
        };
        break;
      }
      if (res.status === 'advisory-warning' && cuspCheck.status === 'pass') {
        cuspCheck = {
          id: 'stationary-cusp-foldback',
          label: 'Stationary Cusp / Foldback',
          status: 'advisory-warning',
          message: res.message,
          pieceId: piece.pieceId,
          segmentId: res.segmentId
        };
      }
    }
    checks.push(cuspCheck);

    // 8. Paired seam-length delta
    let assessedPairs = 0;
    let maxSeamDeltaCm = 0;
    let worstSeamDesc = '';
    let worstSeamPieceId: string | undefined;

    const pieceById = new Map(sourceArtifact.pieces.map((p) => [p.pieceId, p]));
    for (const piece of piecesToCheck) {
      for (const seam of piece.seams) {
        if (!seam.pairedPieceId || !seam.pairedSeamName) continue;
        const pairedPiece = pieceById.get(seam.pairedPieceId);
        if (!pairedPiece) continue;
        const pairedSeam = pairedPiece.seams.find((s) => s.name === seam.pairedSeamName);
        if (!pairedSeam) continue;

        const lenA = computeSeamLengthForPiece(piece, seam.segmentIds, proposalState);
        const lenB = computeSeamLengthForPiece(pairedPiece, pairedSeam.segmentIds, proposalState);
        if (lenA === null || lenB === null) continue;

        assessedPairs += 1;
        const delta = Math.abs(lenA - lenB);
        if (delta >= maxSeamDeltaCm) {
          maxSeamDeltaCm = delta;
          worstSeamPieceId = piece.pieceId;
          worstSeamDesc = `${piece.pieceCode} "${seam.name}" (${lenA.toFixed(2)} cm) vs ${pairedPiece.pieceCode} "${pairedSeam.name}" (${lenB.toFixed(2)} cm): Δ ${delta.toFixed(2)} cm`;
        }
      }
    }

    if (assessedPairs === 0) {
      checks.push({
        id: 'paired-seam-length-delta',
        label: 'Paired Seam Length Delta',
        status: 'unassessed',
        message: 'No paired seam correspondence metadata available on evaluated piece(s).'
      });
    } else if (maxSeamDeltaCm > ADVISORY_PAIRED_SEAM_DELTA_WARNING_CM) {
      checks.push({
        id: 'paired-seam-length-delta',
        label: 'Paired Seam Length Delta',
        status: 'advisory-warning',
        message: `Advisory seam mismatch: ${worstSeamDesc} (> ${ADVISORY_PAIRED_SEAM_DELTA_WARNING_CM} cm).`,
        pieceId: worstSeamPieceId,
        metricValueCm: maxSeamDeltaCm
      });
    } else {
      checks.push({
        id: 'paired-seam-length-delta',
        label: 'Paired Seam Length Delta',
        status: 'pass',
        message: `Evaluated ${assessedPairs} paired seam(s); max delta ${maxSeamDeltaCm.toFixed(3)} cm.`,
        pieceId: worstSeamPieceId,
        metricValueCm: maxSeamDeltaCm
      });
    }

    // 9. Approximation deviation summary
    const allApproxRecords = piecesToCheck.flatMap(
      (p) => proposalState.pieceProposals[p.pieceId]?.approximationRecords ?? []
    );
    if (allApproxRecords.length === 0) {
      checks.push({
        id: 'approximation-deviation',
        label: 'Approximation Deviation',
        status: 'pass',
        message: 'No lossy approximations applied; all operations are exact.'
      });
    } else {
      let maxRecordedDev = 0;
      let anyExceeded = false;
      let worstApproxPiece: string | undefined;
      for (const rec of allApproxRecords) {
        if (rec.maxDeviationCm > maxRecordedDev) {
          maxRecordedDev = rec.maxDeviationCm;
          worstApproxPiece = rec.pieceId;
        }
        if (rec.maxDeviationCm > rec.toleranceCm) {
          anyExceeded = true;
        }
      }
      checks.push({
        id: 'approximation-deviation',
        label: 'Approximation Deviation',
        status: anyExceeded ? 'invalid-proposal' : 'advisory-warning',
        message: anyExceeded
          ? `Recorded approximate operation exceeds tolerance (${maxRecordedDev.toFixed(4)} cm).`
          : `${allApproxRecords.length} controlled approximation(s) applied (max recorded deviation ${maxRecordedDev.toFixed(4)} cm, within tolerance).`,
        pieceId: worstApproxPiece,
        metricValueCm: maxRecordedDev
      });
    }
  }

  let passCount = 0;
  let warningCount = 0;
  let invalidCount = 0;
  let unassessedCount = 0;

  for (const c of checks) {
    if (c.status === 'pass') passCount += 1;
    else if (c.status === 'advisory-warning') warningCount += 1;
    else if (c.status === 'invalid-proposal') invalidCount += 1;
    else unassessedCount += 1;
  }

  const overallStatus: ProposalIntegrityCheckStatus =
    invalidCount > 0
      ? 'invalid-proposal'
      : warningCount > 0
        ? 'advisory-warning'
        : passCount > 0
          ? 'pass'
          : 'unassessed';

  return {
    authorityTier: PROPOSAL_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    advisoryNotice: UNVERIFIED_PROPOSAL_DISCLOSURE,
    overallStatus,
    passCount,
    warningCount,
    invalidCount,
    unassessedCount,
    checks
  };
}

// ---------------------------------------------------------------------------
// 10. D5 & R4 — Deterministic Read-Only JSON Proposal Payload Serialization
// ---------------------------------------------------------------------------

function findNonFinitePath(value: unknown, currentPath: string): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : currentPath;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const bad = findNonFinitePath(value[i], `${currentPath}[${i}]`);
      if (bad) return bad;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const bad = findNonFinitePath(v, `${currentPath}.${k}`);
      if (bad) return bad;
    }
  }
  return null;
}

function canonicalizeForDeterministicJson(value: unknown): unknown {
  if (typeof value === 'number') {
    return normalizeZero(value);
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeForDeterministicJson);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) {
        out[k] = canonicalizeForDeterministicJson(v);
      }
    }
    return out;
  }
  return value;
}

export function stringifyProposalPayloadDeterministic(
  payload: PatternEditProposalPayload
): string {
  return JSON.stringify(canonicalizeForDeterministicJson(payload), null, 2);
}

export function serializeProposalPayload(
  proposalState: PatternGeometryProposalState,
  sourceArtifact: PatternArtifactBundle,
  history?: Pick<GeometryProposalHistoryState, 'past' | 'future' | 'lastActionLabel'>
): ProposalPayloadSerializationResult {
  const integrity = evaluateProposalIntegrity(proposalState, sourceArtifact);
  const pieceMap = new Map(sourceArtifact.pieces.map((p) => [p.pieceId, p]));

  const editedPieces: PatternEditProposalPayloadPiece[] = Object.values(proposalState.pieceProposals)
    .filter((p) => p.modifiedFromOriginal)
    .sort((a, b) => a.pieceId.localeCompare(b.pieceId))
    .map((pieceProp) => {
      const src = pieceMap.get(pieceProp.pieceId);
      const sortedLineage: Record<string, ProposalSegmentLineage> = {};
      for (const k of Object.keys(pieceProp.segmentLineage).sort()) {
        sortedLineage[k] = pieceProp.segmentLineage[k];
      }
      return {
        pieceId: pieceProp.pieceId,
        pieceCode: src?.pieceCode ?? pieceProp.pieceId,
        name: src?.name ?? pieceProp.pieceId,
        cutContourPotentiallyStale: pieceProp.cutContourPotentiallyStale,
        cutContourRegeneratedInClient: false,
        operationsAppliedCount: pieceProp.operationsAppliedCount,
        sewSegments: pieceProp.sewSegments.map(cloneSegment),
        segmentLineage: sortedLineage,
        approximationRecords: pieceProp.approximationRecords
      };
    });

  const payload: PatternEditProposalPayload = {
    schemaVersion: PROPOSAL_PAYLOAD_SCHEMA_VERSION,
    authorityTier: PROPOSAL_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    submissionStatus: 'READ_ONLY_LOCAL_PROPOSAL_NOT_SUBMITTED',
    disclosure: UNVERIFIED_PROPOSAL_DISCLOSURE,
    coordinateFrame: sourceArtifact.coordinateFrame,
    sourceArtifact: {
      schemaVersion: proposalState.sourceIdentity.schemaVersion,
      specificationRevisionId: proposalState.sourceIdentity.specificationRevisionId,
      measurementRevisionId: proposalState.sourceIdentity.measurementRevisionId,
      engineVersion: proposalState.sourceIdentity.engineVersion,
      authorityTier: proposalState.sourceIdentity.authorityTier,
      artifactDigestSha256: proposalState.sourceIdentity.artifactDigestSha256,
      hasVerifiedSourceDigest: proposalState.sourceIdentity.hasVerifiedSourceDigest,
      geometryFingerprint: proposalState.sourceIdentity.geometryFingerprint
    },
    reconciliation: {
      status: proposalState.reconciliationStatus,
      reasons: [...proposalState.reconciliationReasons]
    },
    historySummary: {
      undoDepth: history?.past.length ?? 0,
      redoDepth: history?.future.length ?? 0,
      lastActionLabel: history?.lastActionLabel ?? 'Current proposal snapshot'
    },
    editedPieces,
    advisoryIntegritySummary: {
      overallStatus: integrity.overallStatus,
      isCertified: false,
      isProductionReady: false,
      passCount: integrity.passCount,
      warningCount: integrity.warningCount,
      invalidCount: integrity.invalidCount,
      unassessedCount: integrity.unassessedCount,
      checks: integrity.checks
    }
  };

  // Fail-closed: reject non-finite coordinates or metrics before serialization
  const badPath = findNonFinitePath(payload, 'payload');
  if (badPath) {
    return {
      ok: false,
      error: `Refused to serialize proposal payload: non-finite numeric value at ${badPath}.`
    };
  }

  return {
    ok: true,
    payload,
    json: stringifyProposalPayloadDeterministic(payload)
  };
}
