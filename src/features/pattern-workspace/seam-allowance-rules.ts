/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A4 — Declarative Seam Allowance Rules & Production Annotations Engine.
 *
 * Pure, framework-agnostic, unrounded IEEE-754 float64 module.
 *
 * NON-NEGOTIABLE GOVERNANCE INVARIANTS (ADR-001, D2):
 * - STRICTLY DECLARATIVE METADATA AND CONFLICT VALIDATION ONLY.
 * - ZERO TypeScript cutting-offset curve or polygon synthesis.
 * - NEVER modifies or replaces `piece.cutSegments`.
 * - Every rule and evaluation asserts `cutGeometryRegeneratedInClient: false` and
 *   `sourceCutSegmentsPreservedUnchanged: true`.
 */

import type {
  PatternPieceRenderModel,
  RenderCurveSegment
} from './contracts/pattern-render-artifact';
import type {
  AllowanceRuleConflict,
  CornerJoinStyle,
  DeclarativeAllowanceEdgeRole,
  DeclarativeSeamAllowanceRule,
  PieceAllowanceRuleEvaluation,
  PieceProductionAnnotationProposal,
  VertexCornerRuleOverride
} from './contracts/wp-a-shared-contracts';
import { WP_A_AUTHORITY_TIER } from './contracts/wp-a-shared-contracts';
import type { ProposalSegmentLineage } from './geometry-edit-proposal';

export const DEFAULT_PIECE_SEAM_ALLOWANCE_CM = 1.5;
export const MAX_DECLARATIVE_ALLOWANCE_CM = 12.0;
export const MIN_MITER_LIMIT = 1.0;
export const MAX_MITER_LIMIT = 10.0;

// ---------------------------------------------------------------------------
// 1. Default Rule Resolution from Immutable Artifact
// ---------------------------------------------------------------------------

export function mapSegmentRoleToAllowanceRole(seg: RenderCurveSegment): DeclarativeAllowanceEdgeRole {
  if (seg.role === 'fold' || seg.isFold) return 'fold-edge';
  if (seg.id.toLowerCase().includes('hem')) return 'hem-turn-up';
  if (seg.id.includes('::leg-')) return 'dart-cap';
  return 'seam-edge';
}

export function createDefaultPieceAnnotationProposal(
  piece: PatternPieceRenderModel
): PieceProductionAnnotationProposal {
  const firstRule = piece.seamAllowances[0];
  const defaultAllowanceCm =
    firstRule && Number.isFinite(firstRule.distanceCm) && firstRule.distanceCm >= 0
      ? firstRule.distanceCm
      : Number.isFinite(piece.seamAllowanceWidthCm) && piece.seamAllowanceWidthCm >= 0
        ? piece.seamAllowanceWidthCm
        : DEFAULT_PIECE_SEAM_ALLOWANCE_CM;

  const segmentRuleOverrides: Record<string, DeclarativeSeamAllowanceRule> = {};
  for (const r of piece.seamAllowances) {
    const seg = piece.sewSegments.find((s) => s.id === r.segmentId);
    const isFold = Boolean(seg && (seg.role === 'fold' || seg.isFold)) || r.joinStyle === 'fold' || r.distanceCm === 0;
    segmentRuleOverrides[r.segmentId] = {
      segmentId: r.segmentId,
      baseSegmentIds: [r.segmentId],
      edgeRole: seg ? mapSegmentRoleToAllowanceRole(seg) : 'seam-edge',
      distanceCm: isFold ? 0 : r.distanceCm,
      directionSign: r.directionSign,
      joinStyle: r.joinStyle,
      miterLimit: r.miterLimit,
      isFoldEdge: isFold,
      cutGeometryRegeneratedInClient: false
    };
  }

  return {
    pieceId: piece.pieceId,
    defaultAllowanceCm,
    segmentRuleOverrides,
    vertexCornerOverrides: {},
    cutQuantityNote: piece.onFold ? `Cut ${piece.cutCount} on Fold` : `Cut ${piece.cutCount}`,
    onFoldDeclared: piece.onFold
  };
}

// ---------------------------------------------------------------------------
// 2. Declarative Rule Builder (Enforcing Non-Negotiable Client-Offset Ban)
// ---------------------------------------------------------------------------

export function buildDeclarativeSegmentRule(input: {
  readonly segmentId: string;
  readonly baseSegmentIds?: readonly string[];
  readonly edgeRole: DeclarativeAllowanceEdgeRole;
  readonly distanceCm: number;
  readonly endDistanceCm?: number;
  readonly directionSign?: -1 | 1;
  readonly joinStyle?: CornerJoinStyle;
  readonly miterLimit?: number;
  readonly isFoldEdge?: boolean;
  readonly hemTurnUpCount?: 1 | 2;
  readonly hemFirstFoldCm?: number;
  readonly note?: string;
}): DeclarativeSeamAllowanceRule {
  const isFold = Boolean(input.isFoldEdge || input.edgeRole === 'fold-edge');
  return {
    segmentId: input.segmentId,
    baseSegmentIds: input.baseSegmentIds ? [...input.baseSegmentIds] : [input.segmentId],
    edgeRole: isFold ? 'fold-edge' : input.edgeRole,
    distanceCm: input.distanceCm,
    endDistanceCm: input.endDistanceCm,
    directionSign: input.directionSign ?? 1,
    joinStyle: isFold ? 'fold' : (input.joinStyle ?? 'miter'),
    miterLimit: input.miterLimit ?? 4.0,
    isFoldEdge: isFold,
    hemTurnUpCount: input.edgeRole === 'hem-turn-up' ? (input.hemTurnUpCount ?? 2) : undefined,
    hemFirstFoldCm: input.edgeRole === 'hem-turn-up' ? input.hemFirstFoldCm : undefined,
    note: input.note?.trim() || undefined,
    cutGeometryRegeneratedInClient: false
  };
}

// ---------------------------------------------------------------------------
// 3. Fail-Closed Rule Reconciliation & Conflict Detection
// ---------------------------------------------------------------------------

export function evaluatePieceAllowanceRules(input: {
  readonly piece: PatternPieceRenderModel;
  readonly activeSewSegments: readonly RenderCurveSegment[];
  readonly proposal: PieceProductionAnnotationProposal | null;
  readonly lineageBySegmentId?: Readonly<Record<string, ProposalSegmentLineage>>;
}): PieceAllowanceRuleEvaluation {
  const { piece, activeSewSegments, lineageBySegmentId } = input;
  const proposal = input.proposal ?? createDefaultPieceAnnotationProposal(piece);

  const activeSegmentIds = new Set(activeSewSegments.map((s) => s.id));
  const conflicts: AllowanceRuleConflict[] = [];
  const resolvedRulesBySegmentId: Record<string, DeclarativeSeamAllowanceRule> = {};
  let hasStaleReferences = false;

  // Validate piece default allowance
  if (!Number.isFinite(proposal.defaultAllowanceCm) || proposal.defaultAllowanceCm < 0 || proposal.defaultAllowanceCm > MAX_DECLARATIVE_ALLOWANCE_CM) {
    conflicts.push({
      id: `conflict::${piece.pieceId}::default-allowance`,
      pieceId: piece.pieceId,
      targetRef: `piece:${piece.pieceId}`,
      code: 'NEGATIVE_OR_EXCESSIVE_ALLOWANCE',
      severity: 'error',
      message: `Default allowance ${proposal.defaultAllowanceCm} cm must be within [0, ${MAX_DECLARATIVE_ALLOWANCE_CM}] cm.`
    });
  }

  // Index overrides by baseSegmentId for lineage inheritance onto split/elevated segments
  const overrideByBaseId = new Map<string, DeclarativeSeamAllowanceRule>();
  for (const [segId, rule] of Object.entries(proposal.segmentRuleOverrides)) {
    for (const baseId of rule.baseSegmentIds) {
      overrideByBaseId.set(baseId, rule);
    }
    overrideByBaseId.set(segId, rule);

    // Check if override targets a segment that no longer exists (and has no lineage descendants)
    if (!activeSegmentIds.has(segId)) {
      const hasDescendant = activeSewSegments.some((s) => {
        const lin = lineageBySegmentId?.[s.id];
        return Boolean(lin && lin.baseSegmentIds.includes(segId));
      });
      if (!hasDescendant) {
        hasStaleReferences = true;
        conflicts.push({
          id: `conflict::${piece.pieceId}::stale-seg::${segId}`,
          pieceId: piece.pieceId,
          targetRef: `seg:${segId}`,
          code: 'STALE_SEGMENT_REFERENCE',
          severity: 'warning',
          message: `Allowance override targets missing segment "${segId}".`
        });
      }
    }
  }

  // Resolve effective rule per active sew segment and validate conflicts
  for (const seg of activeSewSegments) {
    const directOverride = proposal.segmentRuleOverrides[seg.id];
    const lineageBases = lineageBySegmentId?.[seg.id]?.baseSegmentIds ?? [seg.id];
    let inheritedOverride: DeclarativeSeamAllowanceRule | undefined = directOverride;
    if (!inheritedOverride) {
      for (const b of lineageBases) {
        const cand = overrideByBaseId.get(b);
        if (cand) {
          inheritedOverride = cand;
          break;
        }
      }
    }

    const isFoldSeg = seg.role === 'fold' || Boolean(seg.isFold);
    const effectiveRule: DeclarativeSeamAllowanceRule = inheritedOverride
      ? {
          ...inheritedOverride,
          segmentId: seg.id,
          baseSegmentIds: lineageBases,
          cutGeometryRegeneratedInClient: false
        }
      : {
          segmentId: seg.id,
          baseSegmentIds: lineageBases,
          edgeRole: mapSegmentRoleToAllowanceRole(seg),
          distanceCm: isFoldSeg ? 0 : proposal.defaultAllowanceCm,
          directionSign: 1,
          joinStyle: isFoldSeg ? 'fold' : 'miter',
          miterLimit: 4.0,
          isFoldEdge: isFoldSeg,
          cutGeometryRegeneratedInClient: false
        };

    resolvedRulesBySegmentId[seg.id] = effectiveRule;

    // Validate fold-edge invariant: fold edge MUST have 0 cm allowance
    if (effectiveRule.isFoldEdge && Math.abs(effectiveRule.distanceCm) > 1e-9) {
      conflicts.push({
        id: `conflict::${piece.pieceId}::fold::${seg.id}`,
        pieceId: piece.pieceId,
        targetRef: `seg:${seg.id}`,
        code: 'FOLD_NONZERO_ALLOWANCE',
        severity: 'error',
        message: `Fold edge "${seg.id}" declares non-zero allowance (${effectiveRule.distanceCm.toFixed(2)} cm). Fold edges require 0.00 cm.`
      });
    }

    // Validate allowance bounds
    if (!Number.isFinite(effectiveRule.distanceCm) || effectiveRule.distanceCm < 0 || effectiveRule.distanceCm > MAX_DECLARATIVE_ALLOWANCE_CM) {
      conflicts.push({
        id: `conflict::${piece.pieceId}::bounds::${seg.id}`,
        pieceId: piece.pieceId,
        targetRef: `seg:${seg.id}`,
        code: 'NEGATIVE_OR_EXCESSIVE_ALLOWANCE',
        severity: 'error',
        message: `Segment "${seg.id}" allowance ${effectiveRule.distanceCm} cm is out of range [0, ${MAX_DECLARATIVE_ALLOWANCE_CM}] cm.`
      });
    }

    // Validate tapered end allowance
    if (typeof effectiveRule.endDistanceCm === 'number') {
      if (
        !Number.isFinite(effectiveRule.endDistanceCm) ||
        effectiveRule.endDistanceCm < 0 ||
        effectiveRule.endDistanceCm > MAX_DECLARATIVE_ALLOWANCE_CM ||
        (effectiveRule.isFoldEdge && Math.abs(effectiveRule.endDistanceCm) > 1e-9)
      ) {
        conflicts.push({
          id: `conflict::${piece.pieceId}::taper::${seg.id}`,
          pieceId: piece.pieceId,
          targetRef: `seg:${seg.id}`,
          code: 'TAPER_OUT_OF_RANGE',
          severity: 'error',
          message: `Tapered end allowance (${effectiveRule.endDistanceCm} cm) on "${seg.id}" is invalid.`
        });
      }
    }

    // Validate miter limit
    if (
      !Number.isFinite(effectiveRule.miterLimit) ||
      effectiveRule.miterLimit < MIN_MITER_LIMIT ||
      effectiveRule.miterLimit > MAX_MITER_LIMIT
    ) {
      conflicts.push({
        id: `conflict::${piece.pieceId}::miter::${seg.id}`,
        pieceId: piece.pieceId,
        targetRef: `seg:${seg.id}`,
        code: 'INVALID_MITER_LIMIT',
        severity: 'error',
        message: `Miter limit ${effectiveRule.miterLimit} on "${seg.id}" must be in [${MIN_MITER_LIMIT}, ${MAX_MITER_LIMIT}].`
      });
    }

    // Validate double-turn hem consistency
    if (
      effectiveRule.edgeRole === 'hem-turn-up' &&
      effectiveRule.hemTurnUpCount === 2 &&
      typeof effectiveRule.hemFirstFoldCm === 'number' &&
      (effectiveRule.hemFirstFoldCm <= 0 || effectiveRule.hemFirstFoldCm >= effectiveRule.distanceCm)
    ) {
      conflicts.push({
        id: `conflict::${piece.pieceId}::hem::${seg.id}`,
        pieceId: piece.pieceId,
        targetRef: `seg:${seg.id}`,
        code: 'HEM_FOLD_INCONSISTENCY',
        severity: 'warning',
        message: `Double-turn hem first fold (${effectiveRule.hemFirstFoldCm} cm) must be strictly between 0 and total hem allowance (${effectiveRule.distanceCm} cm).`
      });
    }
  }

  // Validate vertex corner overrides
  const validVertexRefs = new Set<string>();
  for (let i = 0; i < activeSewSegments.length; i++) {
    validVertexRefs.add(`${piece.pieceId}::sew::vtx-${i}`);
    validVertexRefs.add(`${activeSewSegments[i].id}:p0`);
    validVertexRefs.add(`${activeSewSegments[i].id}:p3`);
  }

  const cornerOverridesByVertexRef: Record<string, VertexCornerRuleOverride> = {};
  for (const [vRef, override] of Object.entries(proposal.vertexCornerOverrides)) {
    cornerOverridesByVertexRef[vRef] = override;
    if (!validVertexRefs.has(vRef)) {
      hasStaleReferences = true;
      conflicts.push({
        id: `conflict::${piece.pieceId}::stale-vtx::${vRef}`,
        pieceId: piece.pieceId,
        targetRef: `vtx:${vRef}`,
        code: 'STALE_VERTEX_REFERENCE',
        severity: 'warning',
        message: `Corner rule override references missing vertex "${vRef}".`
      });
    }
    if (!Number.isFinite(override.miterLimit) || override.miterLimit < MIN_MITER_LIMIT || override.miterLimit > MAX_MITER_LIMIT) {
      conflicts.push({
        id: `conflict::${piece.pieceId}::corner-miter::${vRef}`,
        pieceId: piece.pieceId,
        targetRef: `vtx:${vRef}`,
        code: 'INVALID_MITER_LIMIT',
        severity: 'error',
        message: `Corner override miter limit ${override.miterLimit} at "${vRef}" is out of range.`
      });
    }
  }

  return {
    authorityTier: WP_A_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    pieceId: piece.pieceId,
    defaultAllowanceCm: proposal.defaultAllowanceCm,
    resolvedRulesBySegmentId,
    cornerOverridesByVertexRef,
    conflicts,
    hasStaleReferences,
    cutGeometryRegeneratedInClient: false,
    sourceCutSegmentsPreservedUnchanged: true
  };
}

/**
 * Formats a concise declarative badge label for a sew segment rule (e.g. "1.5 cm", "1.5→3.0 cm", "FOLD 0").
 */
export function formatDeclarativeRuleBadge(rule: DeclarativeSeamAllowanceRule): string {
  if (rule.isFoldEdge) return 'FOLD 0';
  if (typeof rule.endDistanceCm === 'number' && Math.abs(rule.endDistanceCm - rule.distanceCm) > 1e-3) {
    return `${rule.distanceCm.toFixed(1)}→${rule.endDistanceCm.toFixed(1)}`;
  }
  if (rule.edgeRole === 'hem-turn-up') {
    return `HEM ${rule.distanceCm.toFixed(1)}`;
  }
  return `${rule.distanceCm.toFixed(1)} cm`;
}
