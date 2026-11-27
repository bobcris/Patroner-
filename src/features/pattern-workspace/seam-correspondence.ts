/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A1 — Seam Correspondence, Interactive Walking & Advisory Endpoint Trueing Engine.
 *
 * Pure, framework-agnostic, unrounded IEEE-754 float64 module.
 *
 * GOVERNANCE & AUTHORITY BOUNDARIES:
 * - All evaluations and trueing outputs are strictly `UNVERIFIED_VISUAL_PROPOSAL`.
 * - `isCertified: false`, `isProductionReady: false`, `externalCadInteroperabilityVerified: false`,
 *   `dec11Certified: false`.
 * - Never mutates source `PatternArtifactBundle` or `cutSegments`.
 * - Fails closed on missing segment references, degenerate curves, or non-convergent arc-length inversion.
 */

import type {
  PatternArtifactBundle,
  PatternArtifactCoordinateFrame,
  PatternPieceRenderModel,
  RenderCurveSegment,
  RenderNotch,
  RenderPoint2D
} from './contracts/pattern-render-artifact';
import type {
  ProposedNotchRecord,
  SeamChainSide,
  SeamCorrespondencePair,
  SeamEndpointTangentAnalysis,
  SeamNotchCorrespondence,
  SeamNotchDiscrepancy,
  SeamWalkEvaluation,
  SeamWalkIntervalSample,
  SeamWalkRigidTransform
} from './contracts/wp-a-shared-contracts';
import { WP_A_AUTHORITY_TIER } from './contracts/wp-a-shared-contracts';
import type { ProposalSegmentLineage } from './geometry-edit-proposal';
import {
  approximateCubicBezierArcLength,
  ZERO_LENGTH_EPSILON_CM
} from './precision-measurement';
import {
  evaluateSegmentPointExact,
  isFinitePoint2D,
  isFiniteSegment
} from './spatial-diagnostics';

export const SEAM_WALK_ARC_INVERSION_TOLERANCE_CM = 1e-6;
export const SEAM_WALK_MAX_INVERSION_ITERATIONS = 48;
export const SEAM_NOTCH_MATCH_TOLERANCE_CM = 0.15;
export const SEAM_SMOOTH_JOIN_TOLERANCE_DEG = 5.0;
export const SEAM_MILD_ANGLE_TOLERANCE_DEG = 20.0;

// ---------------------------------------------------------------------------
// 1. Low-Level Unrounded Segment Evaluation, Tangents & Arc-Length Inversion
// ---------------------------------------------------------------------------

export function evaluateSegmentArcLengthCm(
  seg: RenderCurveSegment,
  coordinateFrame: PatternArtifactCoordinateFrame,
  pieceId: string,
  domain: readonly [number, number] = [0, 1]
): {
  readonly ok: boolean;
  readonly lengthCm: number;
  readonly errorBoundCm: number;
  readonly reason?: string;
} {
  if (!isFiniteSegment(seg)) {
    return { ok: false, lengthCm: 0, errorBoundCm: 0, reason: 'Non-finite segment coordinates.' };
  }
  const [t0, t1] = domain;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 < 0 || t1 > 1 || t1 < t0) {
    return { ok: false, lengthCm: 0, errorBoundCm: 0, reason: 'Invalid parameter domain.' };
  }
  if (Math.abs(t1 - t0) <= 1e-15) {
    return { ok: true, lengthCm: 0, errorBoundCm: 0 };
  }
  if (seg.kind === 'line' || !seg.p1 || !seg.p2) {
    const fullLen = Math.hypot(seg.p3.x - seg.p0.x, seg.p3.y - seg.p0.y);
    return { ok: true, lengthCm: fullLen * (t1 - t0), errorBoundCm: 0 };
  }
  const res = approximateCubicBezierArcLength(
    seg,
    coordinateFrame,
    WP_A_AUTHORITY_TIER,
    pieceId,
    'sew',
    [t0, t1]
  );
  if (!res.converged || res.arcLengthCm === null || !Number.isFinite(res.arcLengthCm)) {
    return {
      ok: false,
      lengthCm: 0,
      errorBoundCm: res.quadratureErrorEstimateCm ?? 0,
      reason: res.warning ?? 'Adaptive quadrature did not converge.'
    };
  }
  return {
    ok: true,
    lengthCm: res.arcLengthCm,
    errorBoundCm: res.quadratureErrorEstimateCm ?? 0
  };
}

/**
 * Evaluates unrounded forward unit tangent of a segment at parameter t in [0, 1],
 * handling stationary cubic endpoints via L'Hôpital higher-order derivatives.
 */
export function evaluateSegmentUnitTangent(
  seg: RenderCurveSegment,
  t: number,
  direction: 1 | -1 = 1
): RenderPoint2D | null {
  if (!isFiniteSegment(seg) || !Number.isFinite(t) || t < 0 || t > 1) return null;

  let dx = 0;
  let dy = 0;

  if (seg.kind === 'line' || !seg.p1 || !seg.p2) {
    dx = seg.p3.x - seg.p0.x;
    dy = seg.p3.y - seg.p0.y;
  } else {
    const mt = 1 - t;
    // B'(t) = 3(1-t)^2(p1-p0) + 6(1-t)t(p2-p1) + 3t^2(p3-p2)
    dx =
      3 * mt * mt * (seg.p1.x - seg.p0.x) +
      6 * mt * t * (seg.p2.x - seg.p1.x) +
      3 * t * t * (seg.p3.x - seg.p2.x);
    dy =
      3 * mt * mt * (seg.p1.y - seg.p0.y) +
      6 * mt * t * (seg.p2.y - seg.p1.y) +
      3 * t * t * (seg.p3.y - seg.p2.y);

    if (Math.hypot(dx, dy) <= 1e-10) {
      // L'Hôpital fallback at stationary endpoints
      if (t <= 1e-9) {
        dx = seg.p2.x - seg.p0.x;
        dy = seg.p2.y - seg.p0.y;
        if (Math.hypot(dx, dy) <= 1e-10) {
          dx = seg.p3.x - seg.p0.x;
          dy = seg.p3.y - seg.p0.y;
        }
      } else if (t >= 1 - 1e-9) {
        dx = seg.p3.x - seg.p1.x;
        dy = seg.p3.y - seg.p1.y;
        if (Math.hypot(dx, dy) <= 1e-10) {
          dx = seg.p3.x - seg.p0.x;
          dy = seg.p3.y - seg.p0.y;
        }
      } else {
        // Interior cusp fallback via second derivative
        dx = 6 * mt * (seg.p2.x - 2 * seg.p1.x + seg.p0.x) + 6 * t * (seg.p3.x - 2 * seg.p2.x + seg.p1.x);
        dy = 6 * mt * (seg.p2.y - 2 * seg.p1.y + seg.p0.y) + 6 * t * (seg.p3.y - 2 * seg.p2.y + seg.p1.y);
      }
    }
  }

  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-12) return null;

  return {
    x: (dx / len) * direction,
    y: (dy / len) * direction
  };
}

/**
 * Bounded monotone Newton-bisection arc-length inversion on a single segment:
 * finds parameter t in [0, 1] such that arcLength([0, t]) == targetArcCm.
 */
export function invertSegmentArcLength(
  seg: RenderCurveSegment,
  targetArcCm: number,
  totalLengthCm: number,
  coordinateFrame: PatternArtifactCoordinateFrame,
  pieceId: string,
  toleranceCm: number = SEAM_WALK_ARC_INVERSION_TOLERANCE_CM,
  maxIterations: number = SEAM_WALK_MAX_INVERSION_ITERATIONS
): {
  readonly ok: boolean;
  readonly t: number;
  readonly residualCm: number;
  readonly iterations: number;
  readonly reason?: string;
} {
  if (!Number.isFinite(targetArcCm) || !Number.isFinite(totalLengthCm) || totalLengthCm <= ZERO_LENGTH_EPSILON_CM) {
    return { ok: false, t: 0, residualCm: Number.NaN, iterations: 0, reason: 'Degenerate zero-length segment.' };
  }

  const clamped = Math.max(0, Math.min(totalLengthCm, targetArcCm));
  if (clamped <= toleranceCm * 0.1) {
    return { ok: true, t: 0, residualCm: clamped, iterations: 0 };
  }
  if (totalLengthCm - clamped <= toleranceCm * 0.1) {
    return { ok: true, t: 1, residualCm: totalLengthCm - clamped, iterations: 0 };
  }

  if (seg.kind === 'line' || !seg.p1 || !seg.p2) {
    const t = clamped / totalLengthCm;
    return { ok: true, t, residualCm: 0, iterations: 1 };
  }

  let lo = 0;
  let hi = 1;
  let t = clamped / totalLengthCm;
  let residual = Number.POSITIVE_INFINITY;

  for (let iter = 1; iter <= maxIterations; iter++) {
    const lenRes = evaluateSegmentArcLengthCm(seg, coordinateFrame, pieceId, [0, t]);
    if (!lenRes.ok) {
      return { ok: false, t, residualCm: residual, iterations: iter, reason: lenRes.reason };
    }
    const diff = lenRes.lengthCm - clamped;
    residual = Math.abs(diff);
    if (residual <= toleranceCm || hi - lo <= 1e-13) {
      return { ok: true, t, residualCm: residual, iterations: iter };
    }
    if (diff < 0) {
      lo = t;
    } else {
      hi = t;
    }

    // Speed |B'(t)| for safeguarded Newton step
    const mt = 1 - t;
    const dx =
      3 * mt * mt * (seg.p1.x - seg.p0.x) +
      6 * mt * t * (seg.p2.x - seg.p1.x) +
      3 * t * t * (seg.p3.x - seg.p2.x);
    const dy =
      3 * mt * mt * (seg.p1.y - seg.p0.y) +
      6 * mt * t * (seg.p2.y - seg.p1.y) +
      3 * t * t * (seg.p3.y - seg.p2.y);
    const speed = Math.hypot(dx, dy);

    let nextT = 0.5 * (lo + hi);
    if (Number.isFinite(speed) && speed > 1e-9) {
      const newtonT = t - diff / speed;
      if (newtonT > lo + 1e-12 * (hi - lo) && newtonT < hi - 1e-12 * (hi - lo)) {
        nextT = newtonT;
      }
    }
    t = nextT;
  }

  return {
    ok: false,
    t,
    residualCm: residual,
    iterations: maxIterations,
    reason: `Arc-length inversion did not converge within ${maxIterations} iterations (residual ${residual.toExponential(2)} cm).`
  };
}

// ---------------------------------------------------------------------------
// 2. Lineage Resolution & Artifact-Derived Seam Correspondence Extraction
// ---------------------------------------------------------------------------

export function resolveChainSegmentIds(
  requestedSegmentIds: readonly string[],
  activeSegments: readonly RenderCurveSegment[],
  lineageBySegmentId?: Readonly<Record<string, ProposalSegmentLineage>>
): {
  readonly ok: boolean;
  readonly resolvedIds: readonly string[];
  readonly missingIds: readonly string[];
} {
  const byId = new Map(activeSegments.map((s) => [s.id, s]));
  const resolved: string[] = [];
  const missing: string[] = [];

  for (const reqId of requestedSegmentIds) {
    if (byId.has(reqId)) {
      resolved.push(reqId);
      continue;
    }
    // Check proposal lineage for split/elevated replacements whose baseSegmentIds contain reqId
    if (lineageBySegmentId) {
      const descendants = activeSegments.filter((seg) => {
        const lin = lineageBySegmentId[seg.id];
        return Boolean(lin && lin.baseSegmentIds.includes(reqId));
      });
      if (descendants.length > 0) {
        for (const d of descendants) {
          if (!resolved.includes(d.id)) resolved.push(d.id);
        }
        continue;
      }
    }
    missing.push(reqId);
  }

  return {
    ok: missing.length === 0 && resolved.length > 0,
    resolvedIds: resolved,
    missingIds: missing
  };
}

/**
 * Auto-derives deterministic initial seam correspondence pairs from `artifact.pieces[].seams`
 * matching `pairedPieceId` and `pairedSeamName` (or seam role).
 */
export function deriveArtifactSeamCorrespondences(
  artifact: PatternArtifactBundle | null
): SeamCorrespondencePair[] {
  if (!artifact) return [];

  const pairs: SeamCorrespondencePair[] = [];
  const seenKeys = new Set<string>();
  const pieceById = new Map(artifact.pieces.map((p) => [p.pieceId, p]));

  for (const pieceA of artifact.pieces) {
    for (const seamA of pieceA.seams) {
      if (!seamA.pairedPieceId) continue;
      const pieceB = pieceById.get(seamA.pairedPieceId);
      if (!pieceB) continue;

      const seamB = pieceB.seams.find(
        (s) =>
          (seamA.pairedSeamName && s.name === seamA.pairedSeamName) ||
          (s.pairedPieceId === pieceA.pieceId && (!s.pairedSeamName || s.pairedSeamName === seamA.name))
      );
      if (!seamB) continue;

      const segsA = pieceA.sewSegments.filter((seg) => seg.seamId === seamA.id || seg.id === seamA.id);
      const segsB = pieceB.sewSegments.filter((seg) => seg.seamId === seamB.id || seg.id === seamB.id);
      if (segsA.length === 0 || segsB.length === 0) continue;

      const keyParts = [
        `${pieceA.pieceId}::${seamA.id}`,
        `${pieceB.pieceId}::${seamB.id}`
      ].sort();
      const dedupeKey = keyParts.join('<->');
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      // Pair matching notches if present on these segments
      const segIdSetA = new Set(segsA.map((s) => s.id));
      const segIdSetB = new Set(segsB.map((s) => s.id));
      const notchesA = pieceA.notches.filter((n) => n.segmentId && segIdSetA.has(n.segmentId));
      const notchesB = pieceB.notches.filter((n) => n.segmentId && segIdSetB.has(n.segmentId));
      const matchedNotchPairs: SeamNotchCorrespondence[] = [];
      const minNotches = Math.min(notchesA.length, notchesB.length);
      for (let i = 0; i < minNotches; i++) {
        matchedNotchPairs.push({
          id: `notch-pair::${seamA.id}::${i}`,
          notchIdA: notchesA[i].id,
          notchIdB: notchesB[i].id,
          label: notchesA[i].label || notchesB[i].label || `Notch ${i + 1}`
        });
      }

      pairs.push({
        id: `seam-pair::${pieceA.pieceId}::${seamA.id}::${pieceB.pieceId}::${seamB.id}`,
        label: `${pieceA.pieceCode} ${seamA.name} ↔ ${pieceB.pieceCode} ${seamB.name}`,
        sideA: {
          pieceId: pieceA.pieceId,
          segmentIds: segsA.map((s) => s.id),
          direction: 1
        },
        sideB: {
          pieceId: pieceB.pieceId,
          segmentIds: segsB.map((s) => s.id),
          direction: -1
        },
        targetEaseCm: 0,
        origin: 'artifact-derived',
        matchedNotchPairs
      });
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// 3. Chain Arc-Length Table & Evaluation
// ---------------------------------------------------------------------------

interface ChainSegmentEntry {
  readonly segment: RenderCurveSegment;
  readonly direction: 1 | -1;
  readonly lengthCm: number;
  readonly errorBoundCm: number;
  readonly startArcCm: number;
  readonly endArcCm: number;
}

interface EvaluatedChain {
  readonly ok: boolean;
  readonly status: 'ok' | 'invalidated-missing-segment' | 'degenerate-curve';
  readonly reason?: string;
  readonly entries: readonly ChainSegmentEntry[];
  readonly totalLengthCm: number;
  readonly maxErrorBoundCm: number;
  readonly resolvedSegmentIds: readonly string[];
}

function buildEvaluatedChain(
  side: SeamChainSide,
  piece: PatternPieceRenderModel | undefined,
  coordinateFrame: PatternArtifactCoordinateFrame,
  lineageBySegmentId?: Readonly<Record<string, ProposalSegmentLineage>>
): EvaluatedChain {
  if (!piece) {
    return {
      ok: false,
      status: 'invalidated-missing-segment',
      reason: `Piece "${side.pieceId}" not found in active artifact.`,
      entries: [],
      totalLengthCm: 0,
      maxErrorBoundCm: 0,
      resolvedSegmentIds: []
    };
  }

  const resolution = resolveChainSegmentIds(side.segmentIds, piece.sewSegments, lineageBySegmentId);
  if (!resolution.ok) {
    return {
      ok: false,
      status: 'invalidated-missing-segment',
      reason: `Missing sew segment(s) on ${piece.pieceCode}: ${resolution.missingIds.join(', ')}.`,
      entries: [],
      totalLengthCm: 0,
      maxErrorBoundCm: 0,
      resolvedSegmentIds: resolution.resolvedIds
    };
  }

  const orderedIds =
    side.direction === 1 ? [...resolution.resolvedIds] : [...resolution.resolvedIds].reverse();
  const segById = new Map(piece.sewSegments.map((s) => [s.id, s]));

  const entries: ChainSegmentEntry[] = [];
  let cursor = 0;
  let maxErr = 0;

  for (const id of orderedIds) {
    const seg = segById.get(id);
    if (!seg) {
      return {
        ok: false,
        status: 'invalidated-missing-segment',
        reason: `Segment "${id}" vanished during evaluation.`,
        entries: [],
        totalLengthCm: 0,
        maxErrorBoundCm: 0,
        resolvedSegmentIds: orderedIds
      };
    }
    const lenRes = evaluateSegmentArcLengthCm(seg, coordinateFrame, piece.pieceId);
    if (!lenRes.ok || lenRes.lengthCm <= ZERO_LENGTH_EPSILON_CM) {
      return {
        ok: false,
        status: 'degenerate-curve',
        reason: lenRes.reason ?? `Segment "${id}" has degenerate zero length.`,
        entries: [],
        totalLengthCm: 0,
        maxErrorBoundCm: maxErr,
        resolvedSegmentIds: orderedIds
      };
    }
    entries.push({
      segment: seg,
      direction: side.direction,
      lengthCm: lenRes.lengthCm,
      errorBoundCm: lenRes.errorBoundCm,
      startArcCm: cursor,
      endArcCm: cursor + lenRes.lengthCm
    });
    cursor += lenRes.lengthCm;
    maxErr = Math.max(maxErr, lenRes.errorBoundCm);
  }

  return {
    ok: true,
    status: 'ok',
    entries,
    totalLengthCm: cursor,
    maxErrorBoundCm: maxErr,
    resolvedSegmentIds: orderedIds
  };
}

export interface ChainSampleAtArcResult {
  readonly ok: boolean;
  readonly pointCm: RenderPoint2D | null;
  readonly tangentCm: RenderPoint2D | null;
  readonly segmentId: string | null;
  readonly parameterT: number | null;
  readonly reason?: string;
}

export function sampleChainAtArcLength(
  chain: EvaluatedChain,
  arcLengthCm: number,
  coordinateFrame: PatternArtifactCoordinateFrame,
  pieceId: string
): ChainSampleAtArcResult {
  if (!chain.ok || chain.entries.length === 0) {
    return { ok: false, pointCm: null, tangentCm: null, segmentId: null, parameterT: null, reason: chain.reason };
  }

  const clamped = Math.max(0, Math.min(chain.totalLengthCm, arcLengthCm));
  let entry = chain.entries[chain.entries.length - 1];
  for (const candidate of chain.entries) {
    if (clamped <= candidate.endArcCm + 1e-9) {
      entry = candidate;
      break;
    }
  }

  const localArcFromTraversedStart = Math.max(0, Math.min(entry.lengthCm, clamped - entry.startArcCm));
  const targetArcFromSegP0 =
    entry.direction === 1 ? localArcFromTraversedStart : entry.lengthCm - localArcFromTraversedStart;

  const inv = invertSegmentArcLength(
    entry.segment,
    targetArcFromSegP0,
    entry.lengthCm,
    coordinateFrame,
    pieceId
  );
  if (!inv.ok) {
    return {
      ok: false,
      pointCm: null,
      tangentCm: null,
      segmentId: entry.segment.id,
      parameterT: null,
      reason: inv.reason
    };
  }

  const pt = evaluateSegmentPointExact(entry.segment, inv.t);
  const tan = evaluateSegmentUnitTangent(entry.segment, inv.t, entry.direction);
  if (!pt || !tan) {
    return {
      ok: false,
      pointCm: null,
      tangentCm: null,
      segmentId: entry.segment.id,
      parameterT: inv.t,
      reason: 'Indeterminate curve position or tangent at sampled arc length.'
    };
  }

  return {
    ok: true,
    pointCm: pt,
    tangentCm: tan,
    segmentId: entry.segment.id,
    parameterT: inv.t
  };
}

// ---------------------------------------------------------------------------
// 4. Endpoint Continuity & Mated Join Angle Analysis
// ---------------------------------------------------------------------------

function findAdjacentSeamSegment(
  piece: PatternPieceRenderModel,
  endpointPt: RenderPoint2D,
  excludeIds: ReadonlySet<string>
): { readonly segment: RenderCurveSegment; readonly atStart: boolean } | null {
  let best: { segment: RenderCurveSegment; atStart: boolean; dist: number } | null = null;
  for (const seg of piece.sewSegments) {
    if (excludeIds.has(seg.id)) continue;
    const d0 = Math.hypot(seg.p0.x - endpointPt.x, seg.p0.y - endpointPt.y);
    const d3 = Math.hypot(seg.p3.x - endpointPt.x, seg.p3.y - endpointPt.y);
    if (d0 < 1e-2 && (!best || d0 < best.dist)) {
      best = { segment: seg, atStart: true, dist: d0 };
    }
    if (d3 < 1e-2 && (!best || d3 < best.dist)) {
      best = { segment: seg, atStart: false, dist: d3 };
    }
  }
  return best ? { segment: best.segment, atStart: best.atStart } : null;
}

function rotatePoint2D(v: RenderPoint2D, angleRad: number): RenderPoint2D {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function computeEndpointTangentAnalysis(
  endpoint: 'start' | 'end',
  chainA: EvaluatedChain,
  chainB: EvaluatedChain,
  pieceA: PatternPieceRenderModel,
  pieceB: PatternPieceRenderModel,
  coordinateFrame: PatternArtifactCoordinateFrame
): SeamEndpointTangentAnalysis | null {
  const arcA = endpoint === 'start' ? 0 : chainA.totalLengthCm;
  const arcB = endpoint === 'start' ? 0 : chainB.totalLengthCm;

  const sampleA = sampleChainAtArcLength(chainA, arcA, coordinateFrame, pieceA.pieceId);
  const sampleB = sampleChainAtArcLength(chainB, arcB, coordinateFrame, pieceB.pieceId);
  if (!sampleA.ok || !sampleB.ok || !sampleA.pointCm || !sampleB.pointCm || !sampleA.tangentCm || !sampleB.tangentCm) {
    return null;
  }

  // Rotate piece B so its traversed seam tangent aligns with piece A's traversed seam tangent.
  const angleA = Math.atan2(sampleA.tangentCm.y, sampleA.tangentCm.x);
  const angleB = Math.atan2(sampleB.tangentCm.y, sampleB.tangentCm.x);
  const rotRad = angleA - angleB;

  const excludeA = new Set(chainA.resolvedSegmentIds);
  const excludeB = new Set(chainB.resolvedSegmentIds);
  const adjA = findAdjacentSeamSegment(pieceA, sampleA.pointCm, excludeA);
  const adjB = findAdjacentSeamSegment(pieceB, sampleB.pointCm, excludeB);

  let matedJoinAngleDeg: number | null = null;
  let smoothnessDeviationDeg: number | null = null;
  let classification: SeamEndpointTangentAnalysis['classification'] = 'indeterminate';

  if (adjA && adjB) {
    // Outward tangents along the cross-seam edges (e.g., hem or neckline across the joined seam)
    const outA = evaluateSegmentUnitTangent(adjA.segment, adjA.atStart ? 0 : 1, adjA.atStart ? 1 : -1);
    const outBRaw = evaluateSegmentUnitTangent(adjB.segment, adjB.atStart ? 0 : 1, adjB.atStart ? 1 : -1);
    if (outA && outBRaw) {
      const outB = rotatePoint2D(outBRaw, rotRad);
      const dot = Math.max(-1, Math.min(1, outA.x * outB.x + outA.y * outB.y));
      matedJoinAngleDeg = (Math.acos(dot) * 180) / Math.PI;
      // Ideally across a mated seam the two cross-edges extend smoothly opposite (180°).
      smoothnessDeviationDeg = Math.abs(180 - matedJoinAngleDeg);
      if (smoothnessDeviationDeg <= SEAM_SMOOTH_JOIN_TOLERANCE_DEG) {
        classification = 'smooth-join';
      } else if (smoothnessDeviationDeg <= SEAM_MILD_ANGLE_TOLERANCE_DEG) {
        classification = 'mild-angle';
      } else {
        classification = 'sharp-corner';
      }
    }
  } else {
    // Fallback: angle between traversed tangents directly
    const dot = Math.max(
      -1,
      Math.min(1, sampleA.tangentCm.x * sampleB.tangentCm.x + sampleA.tangentCm.y * sampleB.tangentCm.y)
    );
    matedJoinAngleDeg = (Math.acos(dot) * 180) / Math.PI;
    smoothnessDeviationDeg = Math.min(matedJoinAngleDeg, Math.abs(180 - matedJoinAngleDeg));
    classification =
      smoothnessDeviationDeg <= SEAM_SMOOTH_JOIN_TOLERANCE_DEG
        ? 'smooth-join'
        : smoothnessDeviationDeg <= SEAM_MILD_ANGLE_TOLERANCE_DEG
          ? 'mild-angle'
          : 'sharp-corner';
  }

  return {
    endpoint,
    pointACm: sampleA.pointCm,
    pointBCm: sampleB.pointCm,
    tangentACm: sampleA.tangentCm,
    tangentBCm: sampleB.tangentCm,
    matedJoinAngleDeg,
    smoothnessDeviationDeg,
    classification
  };
}

// ---------------------------------------------------------------------------
// 5. Notch Projection & Interval Ease Breakdown
// ---------------------------------------------------------------------------

function locateNotchArcOnChain(
  notch: RenderNotch | ProposedNotchRecord | undefined,
  chain: EvaluatedChain,
  coordinateFrame: PatternArtifactCoordinateFrame,
  pieceId: string
): number | null {
  if (!notch) return null;
  for (const entry of chain.entries) {
    if (notch.segmentId && notch.segmentId === entry.segment.id) {
      // If ProposedNotchRecord carries targetArcLengthCm or parameterT
      const maybeProposed = notch as Partial<ProposedNotchRecord>;
      let t = typeof maybeProposed.parameterT === 'number' && Number.isFinite(maybeProposed.parameterT)
        ? Math.max(0, Math.min(1, maybeProposed.parameterT))
        : null;
      if (t === null && isFinitePoint2D(notch.position)) {
        // Approximate t by dense sampling along the segment
        let bestT = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        const steps = 64;
        for (let i = 0; i <= steps; i++) {
          const candidateT = i / steps;
          const pt = evaluateSegmentPointExact(entry.segment, candidateT);
          if (!pt) continue;
          const d = Math.hypot(pt.x - notch.position.x, pt.y - notch.position.y);
          if (d < bestDist) {
            bestDist = d;
            bestT = candidateT;
          }
        }
        t = bestT;
      }
      if (t !== null) {
        const arcFromP0 = evaluateSegmentArcLengthCm(entry.segment, coordinateFrame, pieceId, [0, t]);
        if (!arcFromP0.ok) return null;
        const localArc = entry.direction === 1 ? arcFromP0.lengthCm : entry.lengthCm - arcFromP0.lengthCm;
        return entry.startArcCm + localArc;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. Primary Seam Walk Evaluator
// ---------------------------------------------------------------------------

export interface EvaluateSeamWalkOptions {
  readonly artifact: PatternArtifactBundle;
  readonly pair: SeamCorrespondencePair;
  /** Scrubbed walk cursor distance in cm along Side A (clamped to [0, totalLengthACm]) */
  readonly walkCursorArcCm?: number;
  /** Optional scrub fraction in [0, 1] if walkCursorArcCm is omitted */
  readonly walkCursorFraction?: number;
  readonly lineageByPieceId?: Readonly<Record<string, Readonly<Record<string, ProposalSegmentLineage>>>>;
  readonly proposedNotchesByPieceId?: Readonly<Record<string, readonly ProposedNotchRecord[]>>;
  readonly uniformIntervalCount?: number;
}

export function evaluateSeamWalk(options: EvaluateSeamWalkOptions): SeamWalkEvaluation {
  const {
    artifact,
    pair,
    lineageByPieceId,
    proposedNotchesByPieceId,
    uniformIntervalCount = 4
  } = options;
  const coordinateFrame = artifact.coordinateFrame;
  const pieceA = artifact.pieces.find((p) => p.pieceId === pair.sideA.pieceId);
  const pieceB = artifact.pieces.find((p) => p.pieceId === pair.sideB.pieceId);

  const failBase = (
    status: Exclude<SeamWalkEvaluation['status'], 'ok'>,
    statusMessage: string,
    resolvedA: readonly string[] = [],
    resolvedB: readonly string[] = []
  ): SeamWalkEvaluation => ({
    authorityTier: WP_A_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    dec11Certified: false,
    pairId: pair.id,
    coordinateFrame,
    status,
    statusMessage,
    resolvedSegmentIdsA: resolvedA,
    resolvedSegmentIdsB: resolvedB,
    totalLengthACm: 0,
    totalLengthBCm: 0,
    maxQuadratureErrorBoundCm: 0,
    rawDeltaCm: 0,
    netDeltaAfterEaseCm: -pair.targetEaseCm,
    targetEaseCm: pair.targetEaseCm,
    walkCursorArcCm: 0,
    walkCursorFraction: 0,
    pointOnACm: null,
    pointOnBCm: null,
    rigidTransformBToA: null,
    intervals: [],
    endpointAnalysis: { start: null, end: null },
    notchDiscrepancies: []
  });

  if (!pieceA || !pieceB) {
    return failBase(
      'invalidated-missing-segment',
      `Missing seam piece(s): ${!pieceA ? pair.sideA.pieceId : ''} ${!pieceB ? pair.sideB.pieceId : ''}`.trim()
    );
  }

  const chainA = buildEvaluatedChain(
    pair.sideA,
    pieceA,
    coordinateFrame,
    lineageByPieceId?.[pieceA.pieceId]
  );
  if (!chainA.ok) {
    const failStatus = chainA.status === 'ok' ? 'degenerate-curve' : chainA.status;
    return failBase(failStatus, chainA.reason ?? 'Side A chain invalid.', chainA.resolvedSegmentIds, []);
  }

  const chainB = buildEvaluatedChain(
    pair.sideB,
    pieceB,
    coordinateFrame,
    lineageByPieceId?.[pieceB.pieceId]
  );
  if (!chainB.ok) {
    const failStatus = chainB.status === 'ok' ? 'degenerate-curve' : chainB.status;
    return failBase(
      failStatus,
      chainB.reason ?? 'Side B chain invalid.',
      chainA.resolvedSegmentIds,
      chainB.resolvedSegmentIds
    );
  }

  const rawCursor =
    typeof options.walkCursorArcCm === 'number' && Number.isFinite(options.walkCursorArcCm)
      ? options.walkCursorArcCm
      : typeof options.walkCursorFraction === 'number' && Number.isFinite(options.walkCursorFraction)
        ? options.walkCursorFraction * chainA.totalLengthCm
        : 0;
  const walkCursorArcCm = Math.max(0, Math.min(chainA.totalLengthCm, rawCursor));
  const walkCursorFraction = chainA.totalLengthCm > 0 ? walkCursorArcCm / chainA.totalLengthCm : 0;

  // Walk piece B at matching arc length (clamped to chain B's total length)
  const walkArcB = Math.min(walkCursorArcCm, chainB.totalLengthCm);
  const sampleA = sampleChainAtArcLength(chainA, walkCursorArcCm, coordinateFrame, pieceA.pieceId);
  const sampleB = sampleChainAtArcLength(chainB, walkArcB, coordinateFrame, pieceB.pieceId);

  if (!sampleA.ok || !sampleB.ok || !sampleA.pointCm || !sampleB.pointCm || !sampleA.tangentCm || !sampleB.tangentCm) {
    return failBase(
      'non-convergent-inversion',
      sampleA.reason ?? sampleB.reason ?? 'Arc-length inversion did not converge.',
      chainA.resolvedSegmentIds,
      chainB.resolvedSegmentIds
    );
  }

  const angleA = Math.atan2(sampleA.tangentCm.y, sampleA.tangentCm.x);
  const angleB = Math.atan2(sampleB.tangentCm.y, sampleB.tangentCm.x);
  const rotationRad = angleA - angleB;

  const rigidTransformBToA: SeamWalkRigidTransform = {
    pivotBCm: sampleB.pointCm,
    targetACm: sampleA.pointCm,
    tangentACm: sampleA.tangentCm,
    tangentBCm: sampleB.tangentCm,
    rotationRad,
    mirrorSign: 1
  };

  // Notch discrepancies
  const allNotchesA: readonly (RenderNotch | ProposedNotchRecord)[] =
    proposedNotchesByPieceId?.[pieceA.pieceId] ?? pieceA.notches;
  const allNotchesB: readonly (RenderNotch | ProposedNotchRecord)[] =
    proposedNotchesByPieceId?.[pieceB.pieceId] ?? pieceB.notches;
  const notchByIdA = new Map(allNotchesA.map((n) => [n.id, n]));
  const notchByIdB = new Map(allNotchesB.map((n) => [n.id, n]));

  const notchDiscrepancies: SeamNotchDiscrepancy[] = [];
  const validNotchStops: Array<{ label: string; arcA: number; arcB: number }> = [];

  for (const np of pair.matchedNotchPairs) {
    const nA = notchByIdA.get(np.notchIdA);
    const nB = notchByIdB.get(np.notchIdB);
    const arcA = locateNotchArcOnChain(nA, chainA, coordinateFrame, pieceA.pieceId);
    const arcB = locateNotchArcOnChain(nB, chainB, coordinateFrame, pieceB.pieceId);
    const label = np.label || nA?.label || nB?.label || np.id;
    if (arcA === null || arcB === null) {
      notchDiscrepancies.push({
        pairId: pair.id,
        notchIdA: np.notchIdA,
        notchIdB: np.notchIdB,
        label,
        arcCmA: arcA,
        arcCmB: arcB,
        deltaCm: null,
        status: 'unresolved-notch'
      });
    } else {
      const deltaCm = arcA - arcB;
      notchDiscrepancies.push({
        pairId: pair.id,
        notchIdA: np.notchIdA,
        notchIdB: np.notchIdB,
        label,
        arcCmA: arcA,
        arcCmB: arcB,
        deltaCm,
        status: Math.abs(deltaCm) <= SEAM_NOTCH_MATCH_TOLERANCE_CM ? 'matched' : 'advisory-mismatch'
      });
      validNotchStops.push({ label, arcA, arcB });
    }
  }

  // Build interval ease breakdown (notch-delimited when matched notches exist, else uniform)
  const intervals: SeamWalkIntervalSample[] = [];
  validNotchStops.sort((a, b) => a.arcA - b.arcA);

  if (validNotchStops.length > 0) {
    const stops = [
      { label: 'Start', arcA: 0, arcB: 0 },
      ...validNotchStops,
      { label: 'End', arcA: chainA.totalLengthCm, arcB: chainB.totalLengthCm }
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const s0 = stops[i];
      const s1 = stops[i + 1];
      const lenA = Math.max(0, s1.arcA - s0.arcA);
      const lenB = Math.max(0, s1.arcB - s0.arcB);
      const delta = lenA - lenB;
      intervals.push({
        intervalIndex: i,
        startLabel: s0.label,
        endLabel: s1.label,
        startArcCmA: s0.arcA,
        endArcCmA: s1.arcA,
        startArcCmB: s0.arcB,
        endArcCmB: s1.arcB,
        lengthACm: lenA,
        lengthBCm: lenB,
        deltaCm: delta,
        easePercent: lenB > ZERO_LENGTH_EPSILON_CM ? (delta / lenB) * 100 : null
      });
    }
  } else {
    const count = Math.max(1, Math.min(8, Math.floor(uniformIntervalCount)));
    for (let i = 0; i < count; i++) {
      const f0 = i / count;
      const f1 = (i + 1) / count;
      const startA = f0 * chainA.totalLengthCm;
      const endA = f1 * chainA.totalLengthCm;
      const startB = f0 * chainB.totalLengthCm;
      const endB = f1 * chainB.totalLengthCm;
      const lenA = endA - startA;
      const lenB = endB - startB;
      const delta = lenA - lenB;
      intervals.push({
        intervalIndex: i,
        startLabel: `${Math.round(f0 * 100)}%`,
        endLabel: `${Math.round(f1 * 100)}%`,
        startArcCmA: startA,
        endArcCmA: endA,
        startArcCmB: startB,
        endArcCmB: endB,
        lengthACm: lenA,
        lengthBCm: lenB,
        deltaCm: delta,
        easePercent: lenB > ZERO_LENGTH_EPSILON_CM ? (delta / lenB) * 100 : null
      });
    }
  }

  const startEndpoint = computeEndpointTangentAnalysis('start', chainA, chainB, pieceA, pieceB, coordinateFrame);
  const endEndpoint = computeEndpointTangentAnalysis('end', chainA, chainB, pieceA, pieceB, coordinateFrame);

  const rawDeltaCm = chainA.totalLengthCm - chainB.totalLengthCm;
  const netDeltaAfterEaseCm = rawDeltaCm - pair.targetEaseCm;

  return {
    authorityTier: WP_A_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    dec11Certified: false,
    pairId: pair.id,
    coordinateFrame,
    status: 'ok',
    statusMessage: `Advisory walk evaluated (${chainA.totalLengthCm.toFixed(2)} cm vs ${chainB.totalLengthCm.toFixed(2)} cm; Δ ${rawDeltaCm >= 0 ? '+' : ''}${rawDeltaCm.toFixed(2)} cm).`,
    resolvedSegmentIdsA: chainA.resolvedSegmentIds,
    resolvedSegmentIdsB: chainB.resolvedSegmentIds,
    totalLengthACm: chainA.totalLengthCm,
    totalLengthBCm: chainB.totalLengthCm,
    maxQuadratureErrorBoundCm: Math.max(chainA.maxErrorBoundCm, chainB.maxErrorBoundCm),
    rawDeltaCm,
    netDeltaAfterEaseCm,
    targetEaseCm: pair.targetEaseCm,
    walkCursorArcCm,
    walkCursorFraction,
    pointOnACm: sampleA.pointCm,
    pointOnBCm: sampleB.pointCm,
    rigidTransformBToA,
    intervals,
    endpointAnalysis: {
      start: startEndpoint,
      end: endEndpoint
    },
    notchDiscrepancies
  };
}

// ---------------------------------------------------------------------------
// 7. Advisory Sew-Contour Endpoint Trueing Proposal Operator
// ---------------------------------------------------------------------------

export interface TrueSeamEndpointResult {
  readonly ok: boolean;
  readonly pieceId: string;
  readonly updatedSewSegments: readonly RenderCurveSegment[] | null;
  readonly modifiedSegmentId: string | null;
  readonly adjustmentDistanceCm: number;
  readonly achievedAngleDeviationDeg: number | null;
  readonly reason: string;
  readonly authorityTier: typeof WP_A_AUTHORITY_TIER;
  readonly isCertified: false;
  readonly dec11Certified: false;
}

/**
 * Computes an advisory sew-contour handle adjustment on the adjacent cross-seam edge (or target seam edge)
 * to true the mated join toward `targetJoinAngleDeg` (default 180° smooth join).
 *
 * Strictly modifies ONLY sew segments of the target piece (if a straight segment is targeted,
 * it is degree-elevated exactly to a cubic first so the handle can rotate smoothly without moving endpoints).
 * Bounded by `maxHandleAdjustmentCm` and fails closed if geometry is missing or degenerate.
 */
export function computeTrueSeamEndpointEdit(options: {
  readonly artifact: PatternArtifactBundle;
  readonly pair: SeamCorrespondencePair;
  readonly targetSide: 'A' | 'B';
  readonly endpoint: 'start' | 'end';
  readonly targetJoinAngleDeg?: number;
  readonly maxHandleAdjustmentCm?: number;
  readonly lineageByPieceId?: Readonly<Record<string, Readonly<Record<string, ProposalSegmentLineage>>>>;
}): TrueSeamEndpointResult {
  const {
    artifact,
    pair,
    targetSide,
    endpoint,
    targetJoinAngleDeg = 180,
    maxHandleAdjustmentCm = 3.0,
    lineageByPieceId
  } = options;

  const targetPieceId = targetSide === 'A' ? pair.sideA.pieceId : pair.sideB.pieceId;
  const fail = (reason: string): TrueSeamEndpointResult => ({
    ok: false,
    pieceId: targetPieceId,
    updatedSewSegments: null,
    modifiedSegmentId: null,
    adjustmentDistanceCm: 0,
    achievedAngleDeviationDeg: null,
    reason,
    authorityTier: WP_A_AUTHORITY_TIER,
    isCertified: false,
    dec11Certified: false
  });

  if (!Number.isFinite(targetJoinAngleDeg) || targetJoinAngleDeg <= 0 || targetJoinAngleDeg > 180) {
    return fail('Target join angle must be finite in (0°, 180°].');
  }
  if (!Number.isFinite(maxHandleAdjustmentCm) || maxHandleAdjustmentCm <= 0) {
    return fail('Max handle adjustment bound must be > 0 cm.');
  }

  const evalWalk = evaluateSeamWalk({
    artifact,
    pair,
    walkCursorFraction: endpoint === 'start' ? 0 : 1,
    lineageByPieceId
  });
  if (evalWalk.status !== 'ok') {
    return fail(`Cannot true endpoint: ${evalWalk.statusMessage}`);
  }

  const ep = endpoint === 'start' ? evalWalk.endpointAnalysis.start : evalWalk.endpointAnalysis.end;
  if (!ep) {
    return fail('Endpoint tangent analysis unavailable for trueing.');
  }

  const targetPiece = artifact.pieces.find((p) => p.pieceId === targetPieceId);
  const otherPieceId = targetSide === 'A' ? pair.sideB.pieceId : pair.sideA.pieceId;
  const otherPiece = artifact.pieces.find((p) => p.pieceId === otherPieceId);
  if (!targetPiece || !otherPiece) {
    return fail('Target or reference piece missing.');
  }

  const targetResolvedIds = targetSide === 'A' ? evalWalk.resolvedSegmentIdsA : evalWalk.resolvedSegmentIdsB;
  const otherResolvedIds = targetSide === 'A' ? evalWalk.resolvedSegmentIdsB : evalWalk.resolvedSegmentIdsA;
  const targetPt = targetSide === 'A' ? ep.pointACm : ep.pointBCm;
  const otherPt = targetSide === 'A' ? ep.pointBCm : ep.pointACm;
  const targetSeamTan = targetSide === 'A' ? ep.tangentACm : ep.tangentBCm;
  const otherSeamTan = targetSide === 'A' ? ep.tangentBCm : ep.tangentACm;

  const adjTarget = findAdjacentSeamSegment(targetPiece, targetPt, new Set(targetResolvedIds));
  const adjOther = findAdjacentSeamSegment(otherPiece, otherPt, new Set(otherResolvedIds));

  if (!adjTarget || !adjOther) {
    return fail('Adjacent cross-seam edge not found on one or both pieces for smooth join trueing.');
  }

  const otherOutTan = evaluateSegmentUnitTangent(adjOther.segment, adjOther.atStart ? 0 : 1, adjOther.atStart ? 1 : -1);
  const targetOutTan = evaluateSegmentUnitTangent(
    adjTarget.segment,
    adjTarget.atStart ? 0 : 1,
    adjTarget.atStart ? 1 : -1
  );
  if (!otherOutTan || !targetOutTan) {
    return fail('Indeterminate cross-seam edge tangent.');
  }

  // Transform otherOutTan into targetPiece local frame so mated seam tangents align
  const angleTargetSeam = Math.atan2(targetSeamTan.y, targetSeamTan.x);
  const angleOtherSeam = Math.atan2(otherSeamTan.y, otherSeamTan.x);
  const otherOutInTargetFrame = rotatePoint2D(otherOutTan, angleTargetSeam - angleOtherSeam);

  // Desired outward tangent on target cross-edge: opposite of otherOutInTargetFrame for 180° smooth join
  const desiredRadOffset = ((180 - targetJoinAngleDeg) * Math.PI) / 180;
  const oppositeDir: RenderPoint2D = { x: -otherOutInTargetFrame.x, y: -otherOutInTargetFrame.y };
  // Pick sign of desiredRadOffset closest to current targetOutTan
  const candPlus = rotatePoint2D(oppositeDir, desiredRadOffset);
  const candMinus = rotatePoint2D(oppositeDir, -desiredRadOffset);
  const dotPlus = candPlus.x * targetOutTan.x + candPlus.y * targetOutTan.y;
  const dotMinus = candMinus.x * targetOutTan.x + candMinus.y * targetOutTan.y;
  const desiredDir = dotPlus >= dotMinus ? candPlus : candMinus;

  // Prepare target segment (degree-elevate line exactly to cubic if needed)
  const seg = adjTarget.segment;
  const p0 = seg.p0;
  const p3 = seg.p3;
  const p1: RenderPoint2D =
    seg.kind === 'cubic-bezier' && seg.p1
      ? seg.p1
      : { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 };
  const p2: RenderPoint2D =
    seg.kind === 'cubic-bezier' && seg.p2
      ? seg.p2
      : { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 };

  const anchor = adjTarget.atStart ? p0 : p3;
  const oldHandle = adjTarget.atStart ? p1 : p2;
  const handleLen = Math.max(0.5, Math.hypot(oldHandle.x - anchor.x, oldHandle.y - anchor.y));

  let nextHandle: RenderPoint2D = {
    x: anchor.x + desiredDir.x * handleLen,
    y: anchor.y + desiredDir.y * handleLen
  };

  let moveDist = Math.hypot(nextHandle.x - oldHandle.x, nextHandle.y - oldHandle.y);
  if (moveDist > maxHandleAdjustmentCm) {
    const scale = maxHandleAdjustmentCm / moveDist;
    nextHandle = {
      x: oldHandle.x + (nextHandle.x - oldHandle.x) * scale,
      y: oldHandle.y + (nextHandle.y - oldHandle.y) * scale
    };
    moveDist = maxHandleAdjustmentCm;
  }

  const updatedSeg: RenderCurveSegment = {
    ...seg,
    kind: 'cubic-bezier',
    p0,
    p1: adjTarget.atStart ? nextHandle : p1,
    p2: adjTarget.atStart ? p2 : nextHandle,
    p3
  };

  const newOutTan = evaluateSegmentUnitTangent(updatedSeg, adjTarget.atStart ? 0 : 1, adjTarget.atStart ? 1 : -1);
  const achievedDeviationDeg = newOutTan
    ? Math.abs(
        targetJoinAngleDeg -
          (Math.acos(
            Math.max(
              -1,
              Math.min(1, newOutTan.x * otherOutInTargetFrame.x + newOutTan.y * otherOutInTargetFrame.y)
            )
          ) *
            180) /
            Math.PI
      )
    : null;

  const updatedSewSegments = targetPiece.sewSegments.map((s) => (s.id === seg.id ? updatedSeg : s));

  return {
    ok: true,
    pieceId: targetPieceId,
    updatedSewSegments,
    modifiedSegmentId: seg.id,
    adjustmentDistanceCm: moveDist,
    achievedAngleDeviationDeg: achievedDeviationDeg,
    reason: `Advisory handle trueing applied on ${seg.id} (moved ${moveDist.toFixed(3)} cm, Not DEC-11 Certified).`,
    authorityTier: WP_A_AUTHORITY_TIER,
    isCertified: false,
    dec11Certified: false
  };
}
