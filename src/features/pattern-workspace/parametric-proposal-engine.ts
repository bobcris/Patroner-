/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A5 — Parametric Operation Graph, Dependency Management, Deterministic Replay
 * & Versioned Read-Only Payload v2 (`patroner.pattern-edit-proposal.v2`).
 *
 * Pure, framework-agnostic TypeScript module.
 *
 * SINGLE HISTORY OWNER INVARIANT:
 * - Lives inside `PatternGeometryProposalState.wpAState` and is committed atomically
 *   into the existing 50-entry `GeometryProposalHistoryState`.
 * - Zero competing second geometry history stack.
 *
 * GOVERNANCE & AUTHORITY INVARIANTS:
 * - Replays deterministically from immutable `sourceArtifact` without mutating it.
 * - Never regenerates or modifies `cutSegments` (`cutContourRegeneratedInClient: false`).
 * - Never invents missing `artifactDigestSha256` digests (`hasVerifiedSourceDigest` explicit).
 * - Payload v2 is strictly read-only (`submissionStatus: 'READ_ONLY_LOCAL_PROPOSAL_NOT_SUBMITTED'`),
 *   deterministic key-sorted float64 JSON, fail-closed on non-finite values.
 */

import type {
  PatternArtifactBundle,
  PatternPieceRenderModel,
  RenderCurveSegment
} from './contracts/pattern-render-artifact';
import type {
  ConstructionEntity,
  ExtendedPieceEngineeringOverlay,
  GeometricConstraint,
  ParametricDependencyEdge,
  ParametricGraphDiagnostic,
  ParametricOpReplayStatus,
  ParametricProposalOp,
  PieceProductionAnnotationProposal,
  ProposedDartModel,
  ProposedDrillHoleRecord,
  ProposedNotchRecord,
  SeamCorrespondencePair,
  WpAEngineeringState,
  WpAProposalPayloadPiece,
  WpAProposalPayloadSerializationResult,
  WpAProposalPayloadV2
} from './contracts/wp-a-shared-contracts';
import {
  WP_A_AUTHORITY_TIER,
  WP_A_PROPOSAL_DISCLOSURE,
  WP_A_PROPOSAL_PAYLOAD_SCHEMA_VERSION,
  WP_A_PROPOSAL_STATE_SCHEMA_VERSION,
  WP_A_SUBMISSION_STATUS
} from './contracts/wp-a-shared-contracts';
import {
  alignVertexToReference,
  applyCubicToLineApproximation,
  applyRemoveVertexAndMerge,
  buildProposedInspectionArtifact,
  commitProposalOperation,
  createProposalStateFromArtifact,
  DEFAULT_APPROXIMATION_TOLERANCE_CM,
  elevateLineToCubicExact,
  evaluateProposalIntegrity,
  moveBezierHandle,
  moveContourVertex,
  setVertexContinuityMode,
  splitSewSegmentAtT,
  type GeometryProposalHistoryState,
  type PatternGeometryProposalState,
  type PieceGeometryProposal,
  type ProposalIntegrityReport,
  type ProposalSegmentLineage
} from './geometry-edit-proposal';
import {
  computeTrueSeamEndpointEdit,
  deriveArtifactSeamCorrespondences
} from './seam-correspondence';
import {
  buildAnchoredNotchRecord,
  buildProposedDrillHole,
  evaluateAllGeometricConstraints,
  reconcileAndReprojectNotches
} from './construction-geometry';
import {
  closeOrOpenProposalDart,
  createProposalDartOnContour,
  editProposalDartParameters,
  evaluateDartConservationReport,
  rotateTransferProposalDart
} from './dart-authoring';
import {
  createDefaultPieceAnnotationProposal,
  evaluatePieceAllowanceRules
} from './seam-allowance-rules';

// ---------------------------------------------------------------------------
// 1. Initial WP-A Engineering State Builder
// ---------------------------------------------------------------------------

function buildInitialPieceNotches(
  piece: PatternPieceRenderModel,
  artifact: PatternArtifactBundle
): ProposedNotchRecord[] {
  const out: ProposedNotchRecord[] = [];
  for (const n of piece.notches) {
    const hostSeg = n.segmentId ? piece.sewSegments.find((s) => s.id === n.segmentId) : undefined;
    if (hostSeg) {
      out.push({
        ...n,
        pieceId: piece.pieceId,
        segmentId: hostSeg.id,
        baseSegmentIds: [hostSeg.id],
        targetArcLengthCm: Math.hypot(n.position.x - hostSeg.p0.x, n.position.y - hostSeg.p0.y),
        parameterT: 0.5,
        reconciliationStatus: 'resolved',
        origin: 'artifact'
      });
    } else {
      out.push({
        ...n,
        pieceId: piece.pieceId,
        segmentId: n.segmentId ?? `${piece.pieceId}::unanchored`,
        baseSegmentIds: n.segmentId ? [n.segmentId] : [],
        targetArcLengthCm: 0,
        parameterT: 0,
        reconciliationStatus: 'resolved',
        origin: 'artifact'
      });
    }
  }
  return out;
}

function buildInitialPieceDrills(piece: PatternPieceRenderModel): ProposedDrillHoleRecord[] {
  return (piece.drillHoles ?? []).map((pt, idx) => ({
    id: `${piece.pieceId}::drill-${idx}`,
    pieceId: piece.pieceId,
    position: pt,
    radiusCm: 0.25,
    label: `D${idx + 1}`,
    anchorRef: { kind: 'piece-local' },
    reconciliationStatus: 'resolved',
    origin: 'artifact'
  }));
}

export function createInitialWpAEngineeringState(
  sourceArtifact: PatternArtifactBundle
): WpAEngineeringState {
  const derivedSeamPairs = deriveArtifactSeamCorrespondences(sourceArtifact);
  const seamCorrespondences: Record<string, SeamCorrespondencePair> = {};
  for (const pair of derivedSeamPairs) {
    seamCorrespondences[pair.id] = pair;
  }

  const pieceEngineering: Record<string, ExtendedPieceEngineeringOverlay> = {};
  for (const piece of sourceArtifact.pieces) {
    const defaultAllow = createDefaultPieceAnnotationProposal(piece);
    const allowEval = evaluatePieceAllowanceRules({
      piece,
      activeSewSegments: piece.sewSegments,
      proposal: defaultAllow
    });
    pieceEngineering[piece.pieceId] = {
      pieceId: piece.pieceId,
      proposedNotches: buildInitialPieceNotches(piece, sourceArtifact),
      proposedDrillHoles: buildInitialPieceDrills(piece),
      proposedDarts: [],
      dartConservation: null,
      allowanceRules: defaultAllow,
      allowanceEvaluation: allowEval
    };
  }

  return {
    schemaVersion: WP_A_PROPOSAL_STATE_SCHEMA_VERSION,
    authorityTier: WP_A_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    coordinateFrame: sourceArtifact.coordinateFrame,
    operations: [],
    replayStatuses: {},
    graphDiagnostic: {
      hasCycle: false,
      cycleOpIds: [],
      invalidatedOpIds: [],
      failedOpIds: [],
      appliedOpCount: 0,
      totalOpCount: 0
    },
    seamCorrespondences,
    constructions: {},
    constraints: {},
    constraintEvaluations: {},
    pieceEngineering
  };
}

// ---------------------------------------------------------------------------
// 2. Dependency Graph, Cycle Detection & Deterministic Topological Ordering
// ---------------------------------------------------------------------------

export function buildDependencyEdges(
  operations: readonly ParametricProposalOp[]
): readonly ParametricDependencyEdge[] {
  const edges: ParametricDependencyEdge[] = [];
  for (const op of operations) {
    for (const dep of op.dependsOnIds) {
      edges.push({ fromId: dep, toOpId: op.opId });
    }
  }
  return edges;
}

export function detectDependencyCycles(
  operations: readonly ParametricProposalOp[]
): { readonly hasCycle: boolean; readonly cycleOpIds: readonly string[] } {
  const opIdSet = new Set(operations.map((o) => o.opId));
  const adj = new Map<string, string[]>();
  for (const op of operations) {
    const opDeps = op.dependsOnIds.filter((d) => opIdSet.has(d));
    adj.set(op.opId, opDeps);
  }

  const color = new Map<string, 0 | 1 | 2>(); // 0 unvisited, 1 visiting, 2 done
  const cycleSet = new Set<string>();

  const dfs = (id: string, stack: string[]): void => {
    color.set(id, 1);
    stack.push(id);
    const deps = adj.get(id) ?? [];
    for (const dep of deps) {
      const c = color.get(dep) ?? 0;
      if (c === 1) {
        const startIdx = stack.indexOf(dep);
        for (let i = Math.max(0, startIdx); i < stack.length; i++) {
          cycleSet.add(stack[i]);
        }
        cycleSet.add(dep);
      } else if (c === 0) {
        dfs(dep, stack);
      }
    }
    stack.pop();
    color.set(id, 2);
  };

  for (const op of operations) {
    if ((color.get(op.opId) ?? 0) === 0) {
      dfs(op.opId, []);
    }
  }

  const cycleOpIds = Array.from(cycleSet).sort();
  return { hasCycle: cycleOpIds.length > 0, cycleOpIds };
}

/**
 * Deterministic topological ordering respecting explicit op-to-op dependencies,
 * breaking ties strictly by ascending `sequence` number.
 */
export function topologicalSortOperations(
  operations: readonly ParametricProposalOp[]
): {
  readonly ordered: readonly ParametricProposalOp[];
  readonly hasCycle: boolean;
  readonly cycleOpIds: readonly string[];
} {
  const cycleCheck = detectDependencyCycles(operations);
  if (cycleCheck.hasCycle) {
    return {
      ordered: [...operations].sort((a, b) => a.sequence - b.sequence),
      hasCycle: true,
      cycleOpIds: cycleCheck.cycleOpIds
    };
  }

  const opById = new Map(operations.map((o) => [o.opId, o]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const op of operations) {
    inDegree.set(op.opId, 0);
    dependents.set(op.opId, []);
  }

  for (const op of operations) {
    for (const dep of op.dependsOnIds) {
      if (opById.has(dep)) {
        inDegree.set(op.opId, (inDegree.get(op.opId) ?? 0) + 1);
        dependents.get(dep)!.push(op.opId);
      }
    }
  }

  const ready: ParametricProposalOp[] = operations
    .filter((o) => (inDegree.get(o.opId) ?? 0) === 0)
    .sort((a, b) => a.sequence - b.sequence);

  const ordered: ParametricProposalOp[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    ordered.push(next);
    for (const childId of dependents.get(next.opId) ?? []) {
      const deg = (inDegree.get(childId) ?? 1) - 1;
      inDegree.set(childId, deg);
      if (deg === 0) {
        ready.push(opById.get(childId)!);
        ready.sort((a, b) => a.sequence - b.sequence);
      }
    }
  }

  return { ordered, hasCycle: false, cycleOpIds: [] };
}

// ---------------------------------------------------------------------------
// 3. Lineage Resolution Helper for Replay
// ---------------------------------------------------------------------------

function resolveSegmentForReplay(
  requestedSegmentId: string,
  sewSegments: readonly RenderCurveSegment[],
  lineage: Readonly<Record<string, ProposalSegmentLineage>> | undefined
): { readonly segment: RenderCurveSegment | null; readonly viaLineage: boolean } {
  const direct = sewSegments.find((s) => s.id === requestedSegmentId);
  if (direct) return { segment: direct, viaLineage: false };

  if (lineage) {
    const descendant = sewSegments.find((s) => {
      const lin = lineage[s.id];
      return Boolean(lin && lin.baseSegmentIds.includes(requestedSegmentId));
    });
    if (descendant) return { segment: descendant, viaLineage: true };
  }
  return { segment: null, viaLineage: false };
}

function upsertPieceProposalSegments(
  state: PatternGeometryProposalState,
  sourcePiece: PatternPieceRenderModel,
  nextSegments: readonly RenderCurveSegment[],
  nextLineage: Readonly<Record<string, ProposalSegmentLineage>>
): PatternGeometryProposalState {
  const existing = state.pieceProposals[sourcePiece.pieceId];
  const nextPieceProposal: PieceGeometryProposal = {
    pieceId: sourcePiece.pieceId,
    sewSegments: nextSegments,
    segmentLineage: nextLineage,
    vertexContinuityModes: existing?.vertexContinuityModes ?? {},
    modifiedFromOriginal: true,
    cutContourPotentiallyStale: true,
    operationsAppliedCount: (existing?.operationsAppliedCount ?? 0) + 1,
    approximationRecords: existing?.approximationRecords ?? []
  };
  return {
    ...state,
    pieceProposals: {
      ...state.pieceProposals,
      [sourcePiece.pieceId]: nextPieceProposal
    },
    hasEdits: true
  };
}

function getActiveSewSegmentsForPiece(
  sourceArtifact: PatternArtifactBundle,
  proposalState: PatternGeometryProposalState,
  pieceId: string
): readonly RenderCurveSegment[] {
  const prop = proposalState.pieceProposals[pieceId];
  if (prop) return prop.sewSegments;
  return sourceArtifact.pieces.find((p) => p.pieceId === pieceId)?.sewSegments ?? [];
}

function getActiveLineageForPiece(
  sourceArtifact: PatternArtifactBundle,
  proposalState: PatternGeometryProposalState,
  pieceId: string
): Readonly<Record<string, ProposalSegmentLineage>> {
  const prop = proposalState.pieceProposals[pieceId];
  if (prop) return prop.segmentLineage;
  const src = sourceArtifact.pieces.find((p) => p.pieceId === pieceId);
  const base: Record<string, ProposalSegmentLineage> = {};
  if (src) {
    for (const s of src.sewSegments) {
      base[s.id] = { segmentId: s.id, baseSegmentIds: [s.id], derivation: 'original', maxApproximationDeviationCm: 0 };
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// 4. Deterministic Parametric Operation Replay Engine
// ---------------------------------------------------------------------------

export function replayParametricOperations(
  sourceArtifact: PatternArtifactBundle,
  operations: readonly ParametricProposalOp[],
  defaultApproximationToleranceCm: number = DEFAULT_APPROXIMATION_TOLERANCE_CM
): PatternGeometryProposalState {
  let baseState = createProposalStateFromArtifact(sourceArtifact, defaultApproximationToleranceCm);
  const initialWpA = createInitialWpAEngineeringState(sourceArtifact);

  const seamCorrespondences: Record<string, SeamCorrespondencePair> = { ...initialWpA.seamCorrespondences };
  const constructions: Record<string, ConstructionEntity> = {};
  const constraints: Record<string, GeometricConstraint> = {};
  const pieceEngineering: Record<string, ExtendedPieceEngineeringOverlay> = {};
  for (const [pid, ov] of Object.entries(initialWpA.pieceEngineering)) {
    pieceEngineering[pid] = {
      ...ov,
      proposedNotches: [...ov.proposedNotches],
      proposedDrillHoles: [...ov.proposedDrillHoles],
      proposedDarts: [...ov.proposedDarts]
    };
  }

  // Track initial dart angular intake per piece for conservation report
  const initialDartAngleByPiece = new Map<string, number>();
  const initialDartPivotByPiece = new Map<string, { x: number; y: number }>();

  const { ordered, hasCycle, cycleOpIds } = topologicalSortOperations(operations);
  const cycleSet = new Set(cycleOpIds);
  const replayStatuses: Record<string, ParametricOpReplayStatus> = {};
  const failedOrInvalidOpIds = new Set<string>();
  const invalidatedOpIds: string[] = [];
  const failedOpIds: string[] = [];
  let appliedOpCount = 0;

  for (const op of ordered) {
    if (cycleSet.has(op.opId)) {
      replayStatuses[op.opId] = {
        opId: op.opId,
        sequence: op.sequence,
        status: 'cycle-rejected',
        reason: 'Operation participates in a dependency cycle and was rejected fail-closed.',
        resolvedTargetIds: [],
        affectedEntityIds: []
      };
      failedOrInvalidOpIds.add(op.opId);
      failedOpIds.push(op.opId);
      continue;
    }

    if (!op.enabled) {
      replayStatuses[op.opId] = {
        opId: op.opId,
        sequence: op.sequence,
        status: 'skipped-disabled',
        reason: 'Operation disabled by user.',
        resolvedTargetIds: [],
        affectedEntityIds: []
      };
      continue;
    }

    // Check explicit upstream op dependencies
    const brokenUpstream = op.dependsOnIds.find((dep) => failedOrInvalidOpIds.has(dep));
    if (brokenUpstream) {
      replayStatuses[op.opId] = {
        opId: op.opId,
        sequence: op.sequence,
        status: 'invalidated-upstream',
        reason: `Upstream dependency "${brokenUpstream}" failed or was invalidated.`,
        resolvedTargetIds: [],
        affectedEntityIds: []
      };
      failedOrInvalidOpIds.add(op.opId);
      invalidatedOpIds.push(op.opId);
      continue;
    }

    const srcPiece = sourceArtifact.pieces.find((p) => p.pieceId === op.pieceId);

    switch (op.kind) {
      // --- UX-2.3.3.4 Contour Ops ---
      case 'move-vertex': {
        const res = moveContourVertex(baseState, sourceArtifact, op.pieceId, op.params.vertexRef, op.params.nextLocalCm, {
          translateAdjacentHandles: op.params.translateAdjacentHandles
        });
        if (res.ok) {
          baseState = res.state;
          appliedOpCount++;
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'applied',
            resolvedTargetIds: [op.params.vertexRef],
            affectedEntityIds: [op.params.vertexRef]
          };
        } else {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: res.message,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
        }
        break;
      }

      case 'move-handle': {
        const res = moveBezierHandle(
          baseState,
          sourceArtifact,
          op.pieceId,
          op.params.segmentId,
          op.params.handleSlot,
          op.params.nextLocalCm,
          { continuityMode: op.params.continuityMode }
        );
        if (res.ok) {
          baseState = res.state;
          appliedOpCount++;
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'applied',
            resolvedTargetIds: [op.params.segmentId],
            affectedEntityIds: [op.params.segmentId]
          };
        } else {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: res.message,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
        }
        break;
      }

      case 'set-continuity': {
        const res = setVertexContinuityMode(baseState, sourceArtifact, op.pieceId, op.params.vertexRef, op.params.mode);
        if (res.ok) {
          baseState = res.state;
          appliedOpCount++;
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'applied',
            resolvedTargetIds: [op.params.vertexRef],
            affectedEntityIds: [op.params.vertexRef]
          };
        } else {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: res.message,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
        }
        break;
      }

      case 'align-vertex': {
        const res = alignVertexToReference(
          baseState,
          sourceArtifact,
          op.pieceId,
          op.params.vertexRef,
          op.params.axis,
          op.params.referenceLocalCm
        );
        if (res.ok) {
          baseState = res.state;
          appliedOpCount++;
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'applied',
            resolvedTargetIds: [op.params.vertexRef],
            affectedEntityIds: [op.params.vertexRef]
          };
        } else {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: res.message,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
        }
        break;
      }

      case 'split-segment': {
        const res = splitSewSegmentAtT(baseState, sourceArtifact, op.pieceId, op.params.segmentId, op.params.parameterT);
        if (res.ok) {
          baseState = res.state;
          appliedOpCount++;
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'applied',
            resolvedTargetIds: [op.params.segmentId],
            affectedEntityIds: [op.params.segmentId]
          };
        } else {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: res.message,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
        }
        break;
      }

      case 'elevate-line': {
        const res = elevateLineToCubicExact(baseState, sourceArtifact, op.pieceId, op.params.segmentId);
        if (res.ok) {
          baseState = res.state;
          appliedOpCount++;
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'applied',
            resolvedTargetIds: [op.params.segmentId],
            affectedEntityIds: [op.params.segmentId]
          };
        } else {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: res.message,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
        }
        break;
      }

      case 'cubic-to-line-approx': {
        const res = applyCubicToLineApproximation(
          baseState,
          sourceArtifact,
          op.pieceId,
          op.params.segmentId,
          { toleranceCm: op.params.toleranceCm, confirmApproximation: op.params.confirmed }
        );
        if (res.ok) {
          baseState = res.state;
          appliedOpCount++;
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'applied',
            resolvedTargetIds: [op.params.segmentId],
            affectedEntityIds: [op.params.segmentId]
          };
        } else {
          failedOrInvalidOpIds.add(op.opId);
          failedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'failed',
            reason: res.message,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
        }
        break;
      }

      case 'remove-vertex-merge': {
        const res = applyRemoveVertexAndMerge(
          baseState,
          sourceArtifact,
          op.pieceId,
          op.params.vertexRef,
          { toleranceCm: op.params.toleranceCm, confirmApproximation: op.params.confirmed }
        );
        if (res.ok) {
          baseState = res.state;
          appliedOpCount++;
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'applied',
            resolvedTargetIds: [op.params.vertexRef],
            affectedEntityIds: [op.params.vertexRef]
          };
        } else {
          failedOrInvalidOpIds.add(op.opId);
          failedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'failed',
            reason: res.message,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
        }
        break;
      }

      // --- WP-A1 Seam Correspondence & Trueing ---
      case 'upsert-seam-pair': {
        seamCorrespondences[op.params.pair.id] = op.params.pair;
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.pair.id],
          affectedEntityIds: [op.params.pair.id]
        };
        break;
      }

      case 'remove-seam-pair': {
        delete seamCorrespondences[op.params.pairId];
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.pairId],
          affectedEntityIds: [op.params.pairId]
        };
        break;
      }

      case 'true-seam-endpoint': {
        const pair = seamCorrespondences[op.params.pairId];
        if (!pair) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Seam pair "${op.params.pairId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const currentArtifact = buildProposedInspectionArtifact(sourceArtifact, baseState);
        const lineageByPiece: Record<string, Readonly<Record<string, ProposalSegmentLineage>>> = {};
        for (const p of sourceArtifact.pieces) {
          lineageByPiece[p.pieceId] = getActiveLineageForPiece(sourceArtifact, baseState, p.pieceId);
        }
        const trueRes = computeTrueSeamEndpointEdit({
          artifact: currentArtifact,
          pair,
          targetSide: op.params.targetSide,
          endpoint: op.params.endpoint,
          targetJoinAngleDeg: op.params.targetJoinAngleDeg,
          maxHandleAdjustmentCm: op.params.maxHandleAdjustmentCm,
          lineageByPieceId: lineageByPiece
        });
        const targetPiece = sourceArtifact.pieces.find((p) => p.pieceId === trueRes.pieceId);
        if (trueRes.ok && trueRes.updatedSewSegments && targetPiece) {
          const lineage = getActiveLineageForPiece(sourceArtifact, baseState, targetPiece.pieceId);
          baseState = upsertPieceProposalSegments(baseState, targetPiece, trueRes.updatedSewSegments, lineage);
          appliedOpCount++;
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'applied',
            resolvedTargetIds: trueRes.modifiedSegmentId ? [trueRes.modifiedSegmentId] : [],
            affectedEntityIds: trueRes.modifiedSegmentId ? [trueRes.modifiedSegmentId] : []
          };
        } else {
          failedOrInvalidOpIds.add(op.opId);
          failedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'failed',
            reason: trueRes.reason,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
        }
        break;
      }

      // --- WP-A2 Construction, Constraints & Anchored Marks ---
      case 'upsert-construction': {
        constructions[op.params.entity.id] = op.params.entity;
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.entity.id],
          affectedEntityIds: [op.params.entity.id]
        };
        break;
      }

      case 'remove-construction': {
        delete constructions[op.params.entityId];
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.entityId],
          affectedEntityIds: [op.params.entityId]
        };
        break;
      }

      case 'upsert-constraint': {
        constraints[op.params.constraint.id] = op.params.constraint;
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.constraint.id],
          affectedEntityIds: [op.params.constraint.id]
        };
        break;
      }

      case 'remove-constraint': {
        delete constraints[op.params.constraintId];
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.constraintId],
          affectedEntityIds: [op.params.constraintId]
        };
        break;
      }

      case 'upsert-notch': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov || !srcPiece) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const activeSegs = getActiveSewSegmentsForPiece(sourceArtifact, baseState, op.pieceId);
        const activeLineage = getActiveLineageForPiece(sourceArtifact, baseState, op.pieceId);
        const resolved = resolveSegmentForReplay(op.params.segmentId, activeSegs, activeLineage);
        if (!resolved.segment) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Target sew segment "${op.params.segmentId}" missing.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const baseIds = activeLineage[resolved.segment.id]?.baseSegmentIds ?? [resolved.segment.id];
        const notchRes = buildAnchoredNotchRecord({
          notchId: op.params.notchId,
          pieceId: op.pieceId,
          segment: resolved.segment,
          baseSegmentIds: baseIds,
          targetArcLengthCm: op.params.targetArcLengthCm,
          notchType: op.params.notchType,
          label: op.params.label,
          coordinateFrame: sourceArtifact.coordinateFrame,
          origin: 'proposal-authored'
        });
        if (!notchRes.ok) {
          failedOrInvalidOpIds.add(op.opId);
          failedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'failed',
            reason: notchRes.error,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const filtered = ov.proposedNotches.filter((n) => n.id !== op.params.notchId);
        pieceEngineering[op.pieceId] = {
          ...ov,
          proposedNotches: [
            ...filtered,
            {
              ...notchRes.notch,
              reconciliationStatus: resolved.viaLineage ? 'reprojected-via-lineage' : 'resolved'
            }
          ]
        };
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [resolved.segment.id],
          affectedEntityIds: [op.params.notchId]
        };
        break;
      }

      case 'remove-notch': {
        const ov = pieceEngineering[op.pieceId];
        if (ov) {
          pieceEngineering[op.pieceId] = {
            ...ov,
            proposedNotches: ov.proposedNotches.filter((n) => n.id !== op.params.notchId)
          };
        }
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.notchId],
          affectedEntityIds: [op.params.notchId]
        };
        break;
      }

      case 'upsert-drill': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const drillRes = buildProposedDrillHole({
          drillId: op.params.drillId,
          pieceId: op.pieceId,
          positionCm: op.params.positionCm,
          radiusCm: op.params.radiusCm,
          label: op.params.label,
          origin: 'proposal-authored'
        });
        if (!drillRes.ok) {
          failedOrInvalidOpIds.add(op.opId);
          failedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'failed',
            reason: drillRes.error,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        pieceEngineering[op.pieceId] = {
          ...ov,
          proposedDrillHoles: [
            ...ov.proposedDrillHoles.filter((d) => d.id !== op.params.drillId),
            drillRes.drill
          ]
        };
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.drillId],
          affectedEntityIds: [op.params.drillId]
        };
        break;
      }

      case 'remove-drill': {
        const ov = pieceEngineering[op.pieceId];
        if (ov) {
          pieceEngineering[op.pieceId] = {
            ...ov,
            proposedDrillHoles: ov.proposedDrillHoles.filter((d) => d.id !== op.params.drillId)
          };
        }
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.drillId],
          affectedEntityIds: [op.params.drillId]
        };
        break;
      }

      // --- WP-A3 Dart Authoring & Transfer ---
      case 'create-dart': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov || !srcPiece) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const activeSegs = getActiveSewSegmentsForPiece(sourceArtifact, baseState, op.pieceId);
        const activeLineage = getActiveLineageForPiece(sourceArtifact, baseState, op.pieceId);
        const resolved = resolveSegmentForReplay(op.params.hostSegmentId, activeSegs, activeLineage);
        if (!resolved.segment) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Dart host segment "${op.params.hostSegmentId}" missing.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const dartRes = createProposalDartOnContour({
          pieceId: op.pieceId,
          sewSegments: activeSegs,
          existingDarts: ov.proposedDarts,
          existingLineage: activeLineage,
          coordinateFrame: sourceArtifact.coordinateFrame,
          dartId: op.params.dartId,
          label: op.params.label,
          hostSegmentId: resolved.segment.id,
          centerParameterT: op.params.centerParameterT,
          intakeWidthCm: op.params.intakeWidthCm,
          pivotApexCm: op.params.pivotApexCm,
          backoffCm: op.params.backoffCm,
          foldDirection: op.params.foldDirection
        });
        if (!dartRes.ok || !dartRes.updatedSewSegments || !dartRes.updatedLineage) {
          failedOrInvalidOpIds.add(op.opId);
          failedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'failed',
            reason: dartRes.error ?? 'Dart creation failed.',
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        baseState = upsertPieceProposalSegments(baseState, srcPiece, dartRes.updatedSewSegments, dartRes.updatedLineage);
        const createdDart = dartRes.darts[dartRes.darts.length - 1];
        if (!initialDartAngleByPiece.has(op.pieceId) && createdDart) {
          initialDartAngleByPiece.set(op.pieceId, createdDart.intakeAngleRad);
          initialDartPivotByPiece.set(op.pieceId, createdDart.pivotApexCm);
        }
        const drillAppend = createdDart?.drillHoleCm
          ? [
              ...ov.proposedDrillHoles.filter((d) => d.id !== `${createdDart.id}::apex-drill`),
              {
                id: `${createdDart.id}::apex-drill`,
                pieceId: op.pieceId,
                position: createdDart.drillHoleCm,
                radiusCm: 0.25,
                label: `${createdDart.label} Apex`,
                anchorRef: { kind: 'dart-apex' as const, targetId: createdDart.id },
                reconciliationStatus: 'resolved' as const,
                origin: 'proposal-authored' as const
              }
            ]
          : ov.proposedDrillHoles;
        pieceEngineering[op.pieceId] = {
          ...ov,
          proposedDarts: dartRes.darts,
          proposedDrillHoles: drillAppend
        };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [resolved.segment.id],
          affectedEntityIds: [op.params.dartId]
        };
        break;
      }

      case 'edit-dart': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov || !srcPiece) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const activeSegs = getActiveSewSegmentsForPiece(sourceArtifact, baseState, op.pieceId);
        const activeLineage = getActiveLineageForPiece(sourceArtifact, baseState, op.pieceId);
        const editRes = editProposalDartParameters({
          sewSegments: activeSegs,
          existingDarts: ov.proposedDarts,
          existingLineage: activeLineage,
          dartId: op.params.dartId,
          intakeWidthCm: op.params.intakeWidthCm,
          pivotApexCm: op.params.pivotApexCm,
          backoffCm: op.params.backoffCm,
          foldDirection: op.params.foldDirection
        });
        if (!editRes.ok || !editRes.updatedSewSegments || !editRes.updatedLineage) {
          failedOrInvalidOpIds.add(op.opId);
          failedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'failed',
            reason: editRes.error ?? 'Dart edit failed.',
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        baseState = upsertPieceProposalSegments(baseState, srcPiece, editRes.updatedSewSegments, editRes.updatedLineage);
        pieceEngineering[op.pieceId] = {
          ...ov,
          proposedDarts: editRes.darts
        };
        // Update reference intake if user explicitly edited intake width
        if (typeof op.params.intakeWidthCm === 'number') {
          const totalAngle = editRes.darts.filter((d) => !d.isClosed).reduce((s, d) => s + d.intakeAngleRad, 0);
          initialDartAngleByPiece.set(op.pieceId, totalAngle);
        }
        if (op.params.pivotApexCm) {
          initialDartPivotByPiece.set(op.pieceId, op.params.pivotApexCm);
        }
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.dartId],
          affectedEntityIds: [op.params.dartId]
        };
        break;
      }

      case 'rotate-transfer-dart': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov || !srcPiece) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const activeSegs = getActiveSewSegmentsForPiece(sourceArtifact, baseState, op.pieceId);
        const activeLineage = getActiveLineageForPiece(sourceArtifact, baseState, op.pieceId);
        const resolvedTarget = resolveSegmentForReplay(op.params.targetHostSegmentId, activeSegs, activeLineage);
        if (!resolvedTarget.segment) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Transfer target segment "${op.params.targetHostSegmentId}" missing.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const xferRes = rotateTransferProposalDart({
          pieceId: op.pieceId,
          sewSegments: activeSegs,
          existingDarts: ov.proposedDarts,
          existingLineage: activeLineage,
          sourceDartId: op.params.sourceDartId,
          newDartId: op.params.newDartId,
          targetHostSegmentId: resolvedTarget.segment.id,
          targetParameterT: op.params.targetParameterT,
          transferRatio: op.params.transferRatio,
          backoffCm: op.params.backoffCm,
          foldDirection: op.params.foldDirection
        });
        if (!xferRes.ok || !xferRes.updatedSewSegments || !xferRes.updatedLineage) {
          failedOrInvalidOpIds.add(op.opId);
          failedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'failed',
            reason: xferRes.error ?? 'Dart transfer failed.',
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        baseState = upsertPieceProposalSegments(baseState, srcPiece, xferRes.updatedSewSegments, xferRes.updatedLineage);
        pieceEngineering[op.pieceId] = {
          ...ov,
          proposedDarts: xferRes.darts
        };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.sourceDartId, resolvedTarget.segment.id],
          affectedEntityIds: [op.params.sourceDartId, op.params.newDartId]
        };
        break;
      }

      case 'close-or-open-dart': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const activeSegs = getActiveSewSegmentsForPiece(sourceArtifact, baseState, op.pieceId);
        const activeLineage = getActiveLineageForPiece(sourceArtifact, baseState, op.pieceId);
        const toggleRes = closeOrOpenProposalDart({
          sewSegments: activeSegs,
          existingDarts: ov.proposedDarts,
          existingLineage: activeLineage,
          dartId: op.params.dartId,
          closed: op.params.closed
        });
        if (!toggleRes.ok) {
          failedOrInvalidOpIds.add(op.opId);
          failedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'failed',
            reason: toggleRes.error ?? 'Dart toggle failed.',
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        pieceEngineering[op.pieceId] = {
          ...ov,
          proposedDarts: toggleRes.darts
        };
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.dartId],
          affectedEntityIds: [op.params.dartId]
        };
        break;
      }

      // --- WP-A4 Declarative Seam Allowance Rules & Production Annotations ---
      case 'set-piece-default-allowance': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov || !srcPiece) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const prev = ov.allowanceRules ?? createDefaultPieceAnnotationProposal(srcPiece);
        pieceEngineering[op.pieceId] = {
          ...ov,
          allowanceRules: {
            ...prev,
            defaultAllowanceCm: op.params.defaultAllowanceCm
          }
        };
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.pieceId],
          affectedEntityIds: [op.pieceId]
        };
        break;
      }

      case 'set-segment-allowance-rule': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov || !srcPiece) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const prev = ov.allowanceRules ?? createDefaultPieceAnnotationProposal(srcPiece);
        pieceEngineering[op.pieceId] = {
          ...ov,
          allowanceRules: {
            ...prev,
            segmentRuleOverrides: {
              ...prev.segmentRuleOverrides,
              [op.params.rule.segmentId]: {
                ...op.params.rule,
                cutGeometryRegeneratedInClient: false
              }
            }
          }
        };
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.rule.segmentId],
          affectedEntityIds: [op.params.rule.segmentId]
        };
        break;
      }

      case 'set-vertex-corner-rule': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov || !srcPiece) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const prev = ov.allowanceRules ?? createDefaultPieceAnnotationProposal(srcPiece);
        pieceEngineering[op.pieceId] = {
          ...ov,
          allowanceRules: {
            ...prev,
            vertexCornerOverrides: {
              ...prev.vertexCornerOverrides,
              [op.params.override.vertexRef]: op.params.override
            }
          }
        };
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.params.override.vertexRef],
          affectedEntityIds: [op.params.override.vertexRef]
        };
        break;
      }

      case 'set-production-annotation': {
        const ov = pieceEngineering[op.pieceId];
        if (!ov || !srcPiece) {
          failedOrInvalidOpIds.add(op.opId);
          invalidatedOpIds.push(op.opId);
          replayStatuses[op.opId] = {
            opId: op.opId,
            sequence: op.sequence,
            status: 'invalidated-upstream',
            reason: `Piece "${op.pieceId}" not found.`,
            resolvedTargetIds: [],
            affectedEntityIds: []
          };
          break;
        }
        const prev = ov.allowanceRules ?? createDefaultPieceAnnotationProposal(srcPiece);
        const nextProposal: PieceProductionAnnotationProposal = {
          ...prev,
          grainlineOverride:
            op.params.grainlineOverride !== undefined ? op.params.grainlineOverride : prev.grainlineOverride,
          cutQuantityNote:
            op.params.cutQuantityNote !== undefined ? op.params.cutQuantityNote : prev.cutQuantityNote,
          onFoldDeclared:
            op.params.onFoldDeclared !== undefined ? op.params.onFoldDeclared : prev.onFoldDeclared,
          fabricNote: op.params.fabricNote !== undefined ? op.params.fabricNote : prev.fabricNote,
          interfacingNote:
            op.params.interfacingNote !== undefined ? op.params.interfacingNote : prev.interfacingNote,
          productionNotes:
            op.params.productionNotes !== undefined ? op.params.productionNotes : prev.productionNotes
        };
        pieceEngineering[op.pieceId] = {
          ...ov,
          allowanceRules: nextProposal
        };
        baseState = { ...baseState, hasEdits: true };
        appliedOpCount++;
        replayStatuses[op.opId] = {
          opId: op.opId,
          sequence: op.sequence,
          status: 'applied',
          resolvedTargetIds: [op.pieceId],
          affectedEntityIds: [op.pieceId]
        };
        break;
      }
    }
  }

  // Final post-replay reconciliation pass:
  // 1. Reproject notches via lineage on every piece
  // 2. Evaluate dart conservation reports
  // 3. Evaluate declarative allowance rules & conflicts
  const piecesByIdForConstraints = new Map<string, PatternPieceRenderModel>();
  const notchesByPieceId: Record<string, readonly ProposedNotchRecord[]> = {};

  for (const srcPiece of sourceArtifact.pieces) {
    const activeSegs = getActiveSewSegmentsForPiece(sourceArtifact, baseState, srcPiece.pieceId);
    const activeLineage = getActiveLineageForPiece(sourceArtifact, baseState, srcPiece.pieceId);
    const ov = pieceEngineering[srcPiece.pieceId];
    if (!ov) continue;

    const reprojectedNotches = reconcileAndReprojectNotches(
      ov.proposedNotches,
      activeSegs,
      activeLineage,
      sourceArtifact.coordinateFrame
    );

    const dartConservation =
      ov.proposedDarts.length > 0
        ? evaluateDartConservationReport({
            pieceId: srcPiece.pieceId,
            sourcePiece: srcPiece,
            currentSewSegments: activeSegs,
            currentDarts: ov.proposedDarts,
            referenceInitialAngleRad: initialDartAngleByPiece.get(srcPiece.pieceId),
            referencePivotApexCm: initialDartPivotByPiece.get(srcPiece.pieceId) ?? null,
            coordinateFrame: sourceArtifact.coordinateFrame
          })
        : null;

    const allowanceEvaluation = evaluatePieceAllowanceRules({
      piece: srcPiece,
      activeSewSegments: activeSegs,
      proposal: ov.allowanceRules,
      lineageBySegmentId: activeLineage
    });

    pieceEngineering[srcPiece.pieceId] = {
      ...ov,
      proposedNotches: reprojectedNotches,
      dartConservation,
      allowanceEvaluation
    };

    notchesByPieceId[srcPiece.pieceId] = reprojectedNotches;
    piecesByIdForConstraints.set(srcPiece.pieceId, {
      ...srcPiece,
      sewSegments: activeSegs,
      notches: reprojectedNotches
    });
  }

  // 4. Evaluate all lightweight geometric constraints
  const constraintEvaluations = evaluateAllGeometricConstraints(
    constraints,
    piecesByIdForConstraints,
    constructions,
    notchesByPieceId,
    sourceArtifact.coordinateFrame
  );

  const graphDiagnostic: ParametricGraphDiagnostic = {
    hasCycle,
    cycleOpIds,
    invalidatedOpIds,
    failedOpIds,
    appliedOpCount,
    totalOpCount: operations.length
  };

  const wpAState: WpAEngineeringState = {
    schemaVersion: WP_A_PROPOSAL_STATE_SCHEMA_VERSION,
    authorityTier: WP_A_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    coordinateFrame: sourceArtifact.coordinateFrame,
    operations: [...operations],
    replayStatuses,
    graphDiagnostic,
    seamCorrespondences,
    constructions,
    constraints,
    constraintEvaluations,
    pieceEngineering
  };

  return {
    ...baseState,
    hasEdits: baseState.hasEdits || operations.some((o) => o.enabled),
    wpAState
  };
}

// ---------------------------------------------------------------------------
// 5. Unified Single-History Mutators (Committed into GeometryProposalHistoryState)
// ---------------------------------------------------------------------------

export function appendParametricOpToHistory(
  sourceArtifact: PatternArtifactBundle,
  history: GeometryProposalHistoryState,
  op: ParametricProposalOp
): GeometryProposalHistoryState {
  const existingOps = history.present.wpAState?.operations ?? [];
  const nextOps = [...existingOps, op];
  const nextState = replayParametricOperations(
    sourceArtifact,
    nextOps,
    history.present.defaultApproximationToleranceCm
  );
  return commitProposalOperation(history, nextState, op.label, op.pieceId);
}

export function updateParametricOpInHistory(
  sourceArtifact: PatternArtifactBundle,
  history: GeometryProposalHistoryState,
  opId: string,
  updater: (op: ParametricProposalOp) => ParametricProposalOp,
  actionLabel?: string
): GeometryProposalHistoryState {
  const existingOps = history.present.wpAState?.operations ?? [];
  const target = existingOps.find((o) => o.opId === opId);
  if (!target) return history;
  const nextOps = existingOps.map((o) => (o.opId === opId ? updater(o) : o));
  const nextState = replayParametricOperations(
    sourceArtifact,
    nextOps,
    history.present.defaultApproximationToleranceCm
  );
  return commitProposalOperation(
    history,
    nextState,
    actionLabel ?? `Edit op: ${target.label}`,
    target.pieceId
  );
}

export function toggleParametricOpInHistory(
  sourceArtifact: PatternArtifactBundle,
  history: GeometryProposalHistoryState,
  opId: string
): GeometryProposalHistoryState {
  return updateParametricOpInHistory(
    sourceArtifact,
    history,
    opId,
    (op) => ({ ...op, enabled: !op.enabled }),
    'Toggle parametric operation'
  );
}

export function removeParametricOpFromHistory(
  sourceArtifact: PatternArtifactBundle,
  history: GeometryProposalHistoryState,
  opId: string
): GeometryProposalHistoryState {
  const existingOps = history.present.wpAState?.operations ?? [];
  const target = existingOps.find((o) => o.opId === opId);
  if (!target) return history;
  const nextOps = existingOps.filter((o) => o.opId !== opId);
  const nextState = replayParametricOperations(
    sourceArtifact,
    nextOps,
    history.present.defaultApproximationToleranceCm
  );
  return commitProposalOperation(history, nextState, `Remove op: ${target.label}`, target.pieceId);
}

export function rebindInvalidatedOpTargetInHistory(
  sourceArtifact: PatternArtifactBundle,
  history: GeometryProposalHistoryState,
  opId: string,
  newTargetSegmentId: string
): GeometryProposalHistoryState {
  return updateParametricOpInHistory(
    sourceArtifact,
    history,
    opId,
    (op) => {
      if (op.kind === 'upsert-notch') {
        return {
          ...op,
          dependsOnIds: op.dependsOnIds.filter((d) => !d.startsWith('seg:')).concat(`seg:${newTargetSegmentId}`),
          params: { ...op.params, segmentId: newTargetSegmentId }
        };
      }
      if (op.kind === 'create-dart') {
        return {
          ...op,
          dependsOnIds: op.dependsOnIds.filter((d) => !d.startsWith('seg:')).concat(`seg:${newTargetSegmentId}`),
          params: { ...op.params, hostSegmentId: newTargetSegmentId }
        };
      }
      if (op.kind === 'rotate-transfer-dart') {
        return {
          ...op,
          dependsOnIds: op.dependsOnIds.filter((d) => !d.startsWith('seg:')).concat(`seg:${newTargetSegmentId}`),
          params: { ...op.params, targetHostSegmentId: newTargetSegmentId }
        };
      }
      if (op.kind === 'set-segment-allowance-rule') {
        return {
          ...op,
          params: {
            ...op.params,
            rule: {
              ...op.params.rule,
              segmentId: newTargetSegmentId,
              baseSegmentIds: [newTargetSegmentId],
              cutGeometryRegeneratedInClient: false
            }
          }
        };
      }
      return op;
    },
    `Rebind target -> ${newTargetSegmentId}`
  );
}

// ---------------------------------------------------------------------------
// 6. Deterministic Versioned Read-Only Payload v2 Serialization (Fail-Closed)
// ---------------------------------------------------------------------------

function sortAndValidateCanonicalJson(value: unknown, path: string): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite numeric value at "${path}".`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) => sortAndValidateCanonicalJson(item, `${path}[${idx}]`));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      out[k] = sortAndValidateCanonicalJson(v, `${path}.${k}`);
    }
    return out;
  }
  throw new Error(`Unsupported value type "${typeof value}" at "${path}".`);
}

export function buildWpAProposalPayloadV2(
  sourceArtifact: PatternArtifactBundle,
  history: GeometryProposalHistoryState,
  integrityReport?: ProposalIntegrityReport
): WpAProposalPayloadV2 {
  const present = history.present;
  const wpA = present.wpAState ?? createInitialWpAEngineeringState(sourceArtifact);
  const report = integrityReport ?? evaluateProposalIntegrity(present, sourceArtifact);

  const pieces: WpAProposalPayloadPiece[] = sourceArtifact.pieces.map((piece) => {
    const pieceProp = present.pieceProposals[piece.pieceId];
    const eng = wpA.pieceEngineering[piece.pieceId];
    return {
      pieceId: piece.pieceId,
      pieceCode: piece.pieceCode,
      name: piece.name,
      cutContourPotentiallyStale: Boolean(pieceProp?.cutContourPotentiallyStale),
      cutContourRegeneratedInClient: false,
      operationsAppliedCount: pieceProp?.operationsAppliedCount ?? 0,
      sewSegments: pieceProp?.sewSegments ?? piece.sewSegments,
      segmentLineage: pieceProp?.segmentLineage ?? {},
      approximationRecords: pieceProp?.approximationRecords ?? [],
      proposedNotches: eng?.proposedNotches ?? [],
      proposedDrillHoles: eng?.proposedDrillHoles ?? [],
      proposedDarts: eng?.proposedDarts ?? [],
      dartConservation: eng?.dartConservation ?? null,
      declarativeAllowanceRules: eng?.allowanceRules ?? null,
      allowanceRuleConflicts: eng?.allowanceEvaluation?.conflicts ?? []
    };
  });

  const sortedSeamPairs = Object.values(wpA.seamCorrespondences).sort((a, b) => a.id.localeCompare(b.id));
  const sortedConstructions = Object.values(wpA.constructions).sort((a, b) => a.id.localeCompare(b.id));
  const sortedConstraints = Object.values(wpA.constraints).sort((a, b) => a.id.localeCompare(b.id));
  const sortedConstraintEvals = Object.values(wpA.constraintEvaluations).sort((a, b) =>
    a.constraintId.localeCompare(b.constraintId)
  );
  const sortedReplayStatuses = Object.values(wpA.replayStatuses).sort((a, b) => a.sequence - b.sequence);

  return {
    schemaVersion: WP_A_PROPOSAL_PAYLOAD_SCHEMA_VERSION,
    authorityTier: WP_A_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    submissionStatus: WP_A_SUBMISSION_STATUS,
    disclosure: WP_A_PROPOSAL_DISCLOSURE,
    coordinateFrame: sourceArtifact.coordinateFrame,
    sourceArtifact: {
      schemaVersion: present.sourceIdentity.schemaVersion,
      specificationRevisionId: present.sourceIdentity.specificationRevisionId,
      measurementRevisionId: present.sourceIdentity.measurementRevisionId,
      engineVersion: present.sourceIdentity.engineVersion,
      authorityTier: present.sourceIdentity.authorityTier,
      artifactDigestSha256: present.sourceIdentity.artifactDigestSha256,
      hasVerifiedSourceDigest: present.sourceIdentity.hasVerifiedSourceDigest,
      geometryFingerprint: present.sourceIdentity.geometryFingerprint
    },
    reconciliation: {
      status: present.reconciliationStatus,
      reasons: [...present.reconciliationReasons]
    },
    historySummary: {
      undoDepth: history.past.length,
      redoDepth: history.future.length,
      lastActionLabel: history.lastActionLabel
    },
    pieces,
    seamCorrespondences: sortedSeamPairs,
    constructions: sortedConstructions,
    constraints: sortedConstraints,
    constraintEvaluations: sortedConstraintEvals,
    operations: [...wpA.operations],
    replayStatuses: sortedReplayStatuses,
    graphDiagnostic: wpA.graphDiagnostic,
    advisoryIntegritySummary: {
      overallStatus: report.overallStatus,
      isCertified: false,
      isProductionReady: false,
      passCount: report.passCount,
      warningCount: report.warningCount,
      invalidCount: report.invalidCount,
      unassessedCount: report.unassessedCount,
      checks: report.checks
    }
  };
}

export function serializeWpAProposalPayloadV2(
  sourceArtifact: PatternArtifactBundle,
  history: GeometryProposalHistoryState,
  integrityReport?: ProposalIntegrityReport
): WpAProposalPayloadSerializationResult {
  try {
    const payload = buildWpAProposalPayloadV2(sourceArtifact, history, integrityReport);
    const canonical = sortAndValidateCanonicalJson(payload, 'payload');
    const json = JSON.stringify(canonical, null, 2);
    return { ok: true, payload, json };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to serialize WP-A proposal payload v2.'
    };
  }
}
