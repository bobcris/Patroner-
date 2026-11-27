/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A Shared Contracts — Advanced Pattern Engineering & Construction Foundation.
 *
 * Unifies WP-A1 through WP-A6 on top of existing Pattern Atelier immutable artifact
 * contracts (`pattern-render-artifact.ts`) and UX-2.3.3.4 geometry proposal contracts
 * (`geometry-edit-proposal.ts`) WITHOUT introducing a duplicate piece geometry store
 * or a second competing geometry history stack.
 *
 * NON-NEGOTIABLE AUTHORITY INVARIANTS (ADR-001, D2, D3, R3, R4):
 * - Every WP-A proposal state, evaluation, and payload MUST carry mandatory
 *   `authorityTier: 'UNVERIFIED_VISUAL_PROPOSAL'`, `isCertified: false`,
 *   `isProductionReady: false`, and `externalCadInteroperabilityVerified: false`.
 * - Cutting contours (`cutSegments`) are NEVER regenerated or synthesized in TypeScript.
 *   Declarative allowance rules carry `cutGeometryRegeneratedInClient: false`.
 * - Read-only serialization preserves `submissionStatus: 'READ_ONLY_LOCAL_PROPOSAL_NOT_SUBMITTED'`.
 */

import type {
  GeometryAuthorityTier,
  PatternArtifactCoordinateFrame,
  RenderCurveSegment,
  RenderNotch,
  RenderPoint2D,
  RenderSeamAllowanceRule
} from './pattern-render-artifact';
import type {
  HandleContinuityMode,
  PatternGeometryProposalState,
  PieceGeometryProposal,
  ProposalApproximationRecord,
  ProposalIntegrityCheckItem,
  ProposalIntegrityCheckStatus,
  ProposalReconciliationStatus,
  ProposalSegmentLineage,
  SourceArtifactIdentity
} from '../geometry-edit-proposal';
import type {
  ContourSegmentEdgeRole,
  PieceCutSemanticsDeclaration
} from '../../../engine/production/manufacturing-types';

// ---------------------------------------------------------------------------
// 0. Schema Versions & Mandatory Authority Envelope
// ---------------------------------------------------------------------------

export const WP_A_PROPOSAL_STATE_SCHEMA_VERSION = 'patroner.geometry-proposal-state.v2' as const;
export const WP_A_PROPOSAL_PAYLOAD_SCHEMA_VERSION = 'patroner.pattern-edit-proposal.v2' as const;
export const WP_A_SUBMISSION_STATUS = 'READ_ONLY_LOCAL_PROPOSAL_NOT_SUBMITTED' as const;
export const WP_A_AUTHORITY_TIER = 'UNVERIFIED_VISUAL_PROPOSAL' as const;

export const WP_A_PROPOSAL_DISCLOSURE =
  'Unverified client-side WP-A visual engineering proposal (isCertified: false, isProductionReady: false, externalCadInteroperabilityVerified: false). Advisory analysis and declarative rules only; authoritative geometry, cutting offsets, DEC-11 certification, and grading require the Python geometry engine.';

export const WP_A_ALLOWANCE_RULE_DISCLOSURE =
  'Declarative seam-allowance rule metadata only (cutGeometryRegeneratedInClient: false). Displayed sew-edge bands and corner markers are NOT synthesized or certified cutting contours.';

export interface UnverifiedProposalAuthority {
  readonly authorityTier: typeof WP_A_AUTHORITY_TIER;
  readonly isCertified: false;
  readonly isProductionReady: false;
  readonly externalCadInteroperabilityVerified: false;
}

export interface CurvePointAnchor {
  readonly pieceId: string;
  readonly segmentId: string;
  /** Original source segment ID(s) for lineage reconciliation across splits/merges */
  readonly baseSegmentIds: readonly string[];
  /** Normalized curve parameter t in [0, 1] on the active sew segment */
  readonly parameterT: number;
  /** Cumulative arc length in cm from segment start along active sew segment */
  readonly arcLengthCm: number;
}

export type EntityReconciliationStatus = 'resolved' | 'reprojected-via-lineage' | 'invalidated-missing-reference';

// ---------------------------------------------------------------------------
// 1. WP-A1 — Seam Correspondence, Walking & Trueing Contracts
// ---------------------------------------------------------------------------

export interface SeamChainSide {
  readonly pieceId: string;
  /** Ordered sew segment IDs traversed along this side of the seam */
  readonly segmentIds: readonly string[];
  /** Traversal direction relative to sew contour winding (+1 forward, -1 reversed) */
  readonly direction: 1 | -1;
}

export interface SeamNotchCorrespondence {
  readonly id: string;
  readonly notchIdA: string;
  readonly notchIdB: string;
  readonly label?: string;
}

export interface SeamCorrespondencePair {
  readonly id: string;
  readonly label: string;
  readonly sideA: SeamChainSide;
  readonly sideB: SeamChainSide;
  /** Target ease in cm (positive = sideA longer than sideB, e.g., sleeve cap ease) */
  readonly targetEaseCm: number;
  readonly easePolicyNote?: string;
  readonly origin: 'artifact-derived' | 'user-proposal';
  readonly matchedNotchPairs: readonly SeamNotchCorrespondence[];
}

export interface SeamWalkIntervalSample {
  readonly intervalIndex: number;
  readonly startLabel: string;
  readonly endLabel: string;
  readonly startArcCmA: number;
  readonly endArcCmA: number;
  readonly startArcCmB: number;
  readonly endArcCmB: number;
  readonly lengthACm: number;
  readonly lengthBCm: number;
  /** Raw signed difference: lengthACm - lengthBCm */
  readonly deltaCm: number;
  /** Relative ease percentage ((lengthA - lengthB) / lengthB * 100), or null when lengthB <= 0 */
  readonly easePercent: number | null;
}

export interface SeamEndpointTangentAnalysis {
  readonly endpoint: 'start' | 'end';
  readonly pointACm: RenderPoint2D;
  readonly pointBCm: RenderPoint2D;
  readonly tangentACm: RenderPoint2D;
  readonly tangentBCm: RenderPoint2D;
  /** Exterior corner angle formed across the mated seam join in degrees (180° = smooth continuous seam) */
  readonly matedJoinAngleDeg: number | null;
  /** Deviation from 180° smooth join (or 90° fold when fold-adjacent) */
  readonly smoothnessDeviationDeg: number | null;
  readonly classification: 'smooth-join' | 'mild-angle' | 'sharp-corner' | 'indeterminate';
}

export interface SeamNotchDiscrepancy {
  readonly pairId: string;
  readonly notchIdA: string;
  readonly notchIdB: string;
  readonly label: string;
  readonly arcCmA: number | null;
  readonly arcCmB: number | null;
  readonly deltaCm: number | null;
  readonly status: 'matched' | 'advisory-mismatch' | 'unresolved-notch';
}

export interface SeamWalkRigidTransform {
  readonly pivotBCm: RenderPoint2D;
  readonly targetACm: RenderPoint2D;
  readonly tangentACm: RenderPoint2D;
  readonly tangentBCm: RenderPoint2D;
  /** Rotation in radians aligning piece B's traversed tangent onto piece A's traversed tangent */
  readonly rotationRad: number;
  /** Reflection sign (+1 pure rigid rotation in plane; -1 mirrored visual walk if requested) */
  readonly mirrorSign: 1 | -1;
}

export interface SeamWalkEvaluation extends UnverifiedProposalAuthority {
  readonly pairId: string;
  readonly coordinateFrame: PatternArtifactCoordinateFrame;
  readonly status: 'ok' | 'invalidated-missing-segment' | 'degenerate-curve' | 'non-convergent-inversion';
  readonly statusMessage: string;
  readonly resolvedSegmentIdsA: readonly string[];
  readonly resolvedSegmentIdsB: readonly string[];
  readonly totalLengthACm: number;
  readonly totalLengthBCm: number;
  readonly maxQuadratureErrorBoundCm: number;
  /** lengthA - lengthB */
  readonly rawDeltaCm: number;
  /** (lengthA - lengthB) - targetEaseCm */
  readonly netDeltaAfterEaseCm: number;
  readonly targetEaseCm: number;
  readonly walkCursorArcCm: number;
  readonly walkCursorFraction: number;
  readonly pointOnACm: RenderPoint2D | null;
  readonly pointOnBCm: RenderPoint2D | null;
  readonly rigidTransformBToA: SeamWalkRigidTransform | null;
  readonly intervals: readonly SeamWalkIntervalSample[];
  readonly endpointAnalysis: {
    readonly start: SeamEndpointTangentAnalysis | null;
    readonly end: SeamEndpointTangentAnalysis | null;
  };
  readonly notchDiscrepancies: readonly SeamNotchDiscrepancy[];
  /** Explicitly states this is advisory only and NOT DEC-11 certified */
  readonly dec11Certified: false;
}

// ---------------------------------------------------------------------------
// 2. WP-A2 — Construction Geometry, Anchored Marks & Lightweight Constraints
// ---------------------------------------------------------------------------

export type ConstructionEntityKind =
  | 'construction-line'
  | 'construction-ray'
  | 'reference-axis'
  | 'construction-circle'
  | 'construction-arc'
  | 'parallel-guide'
  | 'perpendicular-guide'
  | 'internal-line'
  | 'technical-callout';

export type ReferenceAxisRole = 'center-front' | 'center-back' | 'bust' | 'waist' | 'hip' | 'grain-axis' | 'custom';

export type InternalLineRole =
  | 'stitch-guide'
  | 'fold-line'
  | 'pleat-guide'
  | 'tuck-guide'
  | 'pocket-placement'
  | 'buttonhole-reference'
  | 'grain-reference';

export type AnnotationLayerId = 'construction' | 'internal-lines' | 'annotations';

export interface ConstructionEntityBase {
  readonly id: string;
  /** Bound to a piece's local coordinate space, or null for board-level reference */
  readonly pieceId: string | null;
  readonly kind: ConstructionEntityKind;
  readonly label: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly layerId: AnnotationLayerId;
  /** Explicit non-cutting, non-authoritative marker */
  readonly isCuttingGeometry: false;
}

export type ConstructionEntity =
  | (ConstructionEntityBase & {
      readonly kind: 'construction-line' | 'construction-ray' | 'parallel-guide' | 'perpendicular-guide';
      readonly start: RenderPoint2D;
      readonly end: RenderPoint2D;
      readonly sourceSegmentId?: string;
      readonly offsetDistanceCm?: number;
    })
  | (ConstructionEntityBase & {
      readonly kind: 'reference-axis';
      readonly axisRole: ReferenceAxisRole;
      readonly start: RenderPoint2D;
      readonly end: RenderPoint2D;
    })
  | (ConstructionEntityBase & {
      readonly kind: 'construction-circle';
      readonly center: RenderPoint2D;
      readonly radiusCm: number;
    })
  | (ConstructionEntityBase & {
      readonly kind: 'construction-arc';
      readonly center: RenderPoint2D;
      readonly radiusCm: number;
      readonly startAngleRad: number;
      readonly endAngleRad: number;
    })
  | (ConstructionEntityBase & {
      readonly kind: 'internal-line';
      readonly role: InternalLineRole;
      readonly segments: readonly RenderCurveSegment[];
    })
  | (ConstructionEntityBase & {
      readonly kind: 'technical-callout';
      readonly anchor: RenderPoint2D;
      readonly text: string;
      readonly leaderTarget?: RenderPoint2D;
    });

export interface ProposedNotchRecord extends RenderNotch {
  readonly pieceId: string;
  readonly segmentId: string;
  readonly baseSegmentIds: readonly string[];
  readonly targetArcLengthCm: number;
  readonly parameterT: number;
  readonly reconciliationStatus: EntityReconciliationStatus;
  readonly reconciliationReason?: string;
  readonly origin: 'artifact' | 'proposal-authored';
}

export interface ProposedDrillHoleRecord {
  readonly id: string;
  readonly pieceId: string;
  readonly position: RenderPoint2D;
  readonly radiusCm: number;
  readonly label?: string;
  /** Optional anchor to a dart or segment for lineage tracking */
  readonly anchorRef?: {
    readonly kind: 'piece-local' | 'dart-apex' | 'segment-offset';
    readonly targetId?: string;
    readonly offsetDistanceCm?: number;
  };
  readonly reconciliationStatus: EntityReconciliationStatus;
  readonly origin: 'artifact' | 'proposal-authored';
}

export type GeometricConstraintKind =
  | 'horizontal'
  | 'vertical'
  | 'perpendicular'
  | 'parallel'
  | 'equal-length'
  | 'tangent-g1'
  | 'point-on-segment'
  | 'distance-cm';

export interface GeometricConstraint {
  readonly id: string;
  readonly pieceId: string;
  readonly kind: GeometricConstraintKind;
  readonly label: string;
  /** References formatted as `seg:<segmentId>`, `const:<entityId>`, `vtx:<vertexRef>`, `notch:<notchId>` */
  readonly entityRefs: readonly string[];
  readonly targetValue?: number;
  readonly toleranceCmOrDeg: number;
}

export interface EvaluatedConstraintResult {
  readonly constraintId: string;
  readonly status: 'satisfied' | 'violated' | 'invalidated';
  readonly residual: number | null;
  readonly unit: 'cm' | 'deg';
  readonly message: string;
}

// ---------------------------------------------------------------------------
// 3. WP-A3 — Dart Authoring & Manipulation Proposal Contracts
// ---------------------------------------------------------------------------

export type DartFoldDirection = 'toward-center' | 'toward-side' | 'upward' | 'downward' | 'split';

export interface ProposedDartModel {
  readonly id: string;
  readonly pieceId: string;
  readonly label: string;
  /** True anatomical pivot point (e.g., bust apex) */
  readonly pivotApexCm: RenderPoint2D;
  /** Actual sewing apex backed off from pivotApexCm along dart bisector */
  readonly sewingApexCm: RenderPoint2D;
  readonly backoffCm: number;
  readonly legLeftOpeningCm: RenderPoint2D;
  readonly legRightOpeningCm: RenderPoint2D;
  readonly intakeAngleRad: number;
  readonly intakeWidthCm: number;
  readonly legLengthLeftCm: number;
  readonly legLengthRightCm: number;
  readonly foldDirection: DartFoldDirection;
  /** Host sew segment where the dart opens (for lineage & closure tracking) */
  readonly hostSegmentId: string;
  readonly baseHostSegmentIds: readonly string[];
  /** Sew-contour segment IDs created for the two dart legs when cut into contour */
  readonly legSegmentIds: readonly [string, string] | null;
  readonly drillHoleCm: RenderPoint2D | null;
  readonly isClosed: boolean;
  readonly origin: 'c0-engine-bridge' | 'proposal-authored';
  readonly reconciliationStatus: EntityReconciliationStatus;
}

export interface DartConservationReport extends UnverifiedProposalAuthority {
  readonly pieceId: string;
  readonly dartCount: number;
  readonly totalAngularIntakeBeforeRad: number;
  readonly totalAngularIntakeAfterRad: number;
  readonly angularIntakeResidualRad: number;
  readonly apexDriftCm: number;
  readonly maxLegLengthParityDeltaCm: number;
  readonly netSeamLengthBeforeCm: number | null;
  readonly netSeamLengthAfterCm: number | null;
  readonly netSeamLengthDeltaCm: number | null;
  readonly foldTangencyDeviationDeg: number | null;
  readonly contourClosed: boolean;
  readonly contourClosureGapCm: number;
  readonly selfIntersectionDetected: boolean;
  readonly degeneracyDetected: boolean;
  readonly withinAdvisoryTolerances: boolean;
  readonly advisories: readonly string[];
}

// ---------------------------------------------------------------------------
// 4. WP-A4 — Declarative Seam Allowance Rules & Production Annotations
//    STRICT INVARIANT: Declarative metadata ONLY — ZERO TS cut-offset synthesis
// ---------------------------------------------------------------------------

export type DeclarativeAllowanceEdgeRole =
  | ContourSegmentEdgeRole
  | 'seam-edge'
  | 'hem-turn-up'
  | 'facing-edge'
  | 'raw-bound-edge'
  | 'dart-cap';

export type CornerJoinStyle = RenderSeamAllowanceRule['joinStyle'] | 'stepped-corner';

export interface DeclarativeSeamAllowanceRule {
  readonly segmentId: string;
  readonly baseSegmentIds: readonly string[];
  readonly edgeRole: DeclarativeAllowanceEdgeRole;
  /** Primary allowance distance in cm (0 cm mandatory when isFoldEdge === true) */
  readonly distanceCm: number;
  /** Optional tapered end distance in cm for variable allowance declarations */
  readonly endDistanceCm?: number;
  readonly directionSign: -1 | 1;
  readonly joinStyle: CornerJoinStyle;
  readonly miterLimit: number;
  readonly isFoldEdge: boolean;
  readonly hemTurnUpCount?: 1 | 2;
  readonly hemFirstFoldCm?: number;
  readonly note?: string;
  /** Mandatory non-negotiable invariant (ADR-001 / D2) */
  readonly cutGeometryRegeneratedInClient: false;
}

export interface VertexCornerRuleOverride {
  readonly vertexRef: string;
  readonly pieceId: string;
  readonly joinStyle: CornerJoinStyle;
  readonly miterLimit: number;
  readonly cornerNotchType?: RenderNotch['notchType'] | 'none';
  readonly note?: string;
}

export interface PieceProductionAnnotationProposal {
  readonly pieceId: string;
  readonly defaultAllowanceCm: number;
  readonly segmentRuleOverrides: Readonly<Record<string, DeclarativeSeamAllowanceRule>>;
  readonly vertexCornerOverrides: Readonly<Record<string, VertexCornerRuleOverride>>;
  readonly grainlineOverride?: {
    readonly start: RenderPoint2D;
    readonly end: RenderPoint2D;
    readonly direction: 'vertical' | 'horizontal' | 'bias';
    readonly angleDeg: number;
  };
  readonly cutSemanticsOverride?: Partial<PieceCutSemanticsDeclaration>;
  readonly cutQuantityNote?: string;
  readonly onFoldDeclared?: boolean;
  readonly fabricNote?: string;
  readonly interfacingNote?: string;
  readonly productionNotes?: string;
}

export type AllowanceRuleConflictSeverity = 'warning' | 'error';

export interface AllowanceRuleConflict {
  readonly id: string;
  readonly pieceId: string;
  readonly targetRef: string;
  readonly code:
    | 'FOLD_NONZERO_ALLOWANCE'
    | 'NEGATIVE_OR_EXCESSIVE_ALLOWANCE'
    | 'INVALID_MITER_LIMIT'
    | 'STALE_SEGMENT_REFERENCE'
    | 'STALE_VERTEX_REFERENCE'
    | 'HEM_FOLD_INCONSISTENCY'
    | 'TAPER_OUT_OF_RANGE';
  readonly severity: AllowanceRuleConflictSeverity;
  readonly message: string;
}

export interface PieceAllowanceRuleEvaluation extends UnverifiedProposalAuthority {
  readonly pieceId: string;
  readonly defaultAllowanceCm: number;
  readonly resolvedRulesBySegmentId: Readonly<Record<string, DeclarativeSeamAllowanceRule>>;
  readonly cornerOverridesByVertexRef: Readonly<Record<string, VertexCornerRuleOverride>>;
  readonly conflicts: readonly AllowanceRuleConflict[];
  readonly hasStaleReferences: boolean;
  readonly cutGeometryRegeneratedInClient: false;
  readonly sourceCutSegmentsPreservedUnchanged: true;
}

// ---------------------------------------------------------------------------
// 5. WP-A5 — Discriminated, Statically Typed Parametric Operations & Replay
// ---------------------------------------------------------------------------

export type ParametricOpDomain =
  | 'contour'
  | 'seam-correspondence'
  | 'seam-trueing'
  | 'construction'
  | 'constraint'
  | 'notch-drill'
  | 'dart'
  | 'allowance-rule'
  | 'production-annotation';

export interface ParametricOpProvenance {
  readonly createdSequence: number;
  readonly sourceTool: PatternAtelierToolId;
  readonly authorityTier: typeof WP_A_AUTHORITY_TIER;
}

export interface ParametricOpBase {
  readonly opId: string;
  readonly sequence: number;
  readonly domain: ParametricOpDomain;
  readonly label: string;
  readonly pieceId: string;
  /** Referenced segment/entity IDs (or upstream op IDs) tracked for dependency invalidation */
  readonly dependsOnIds: readonly string[];
  readonly enabled: boolean;
  readonly provenance: ParametricOpProvenance;
}

// --- Discriminated Operation Variants (Zero broad Record<string, unknown>) ---

export interface MoveContourVertexOp extends ParametricOpBase {
  readonly domain: 'contour';
  readonly kind: 'move-vertex';
  readonly params: {
    readonly vertexRef: string;
    readonly nextLocalCm: RenderPoint2D;
    readonly translateAdjacentHandles: boolean;
  };
}

export interface MoveBezierHandleOp extends ParametricOpBase {
  readonly domain: 'contour';
  readonly kind: 'move-handle';
  readonly params: {
    readonly segmentId: string;
    readonly handleSlot: 'p1' | 'p2';
    readonly nextLocalCm: RenderPoint2D;
    readonly continuityMode: HandleContinuityMode;
  };
}

export interface SetVertexContinuityOp extends ParametricOpBase {
  readonly domain: 'contour';
  readonly kind: 'set-continuity';
  readonly params: {
    readonly vertexRef: string;
    readonly mode: HandleContinuityMode;
  };
}

export interface AlignVertexOp extends ParametricOpBase {
  readonly domain: 'contour';
  readonly kind: 'align-vertex';
  readonly params: {
    readonly vertexRef: string;
    readonly axis: 'horizontal' | 'vertical';
    readonly referenceLocalCm: RenderPoint2D;
  };
}

export interface SplitSewSegmentOp extends ParametricOpBase {
  readonly domain: 'contour';
  readonly kind: 'split-segment';
  readonly params: {
    readonly segmentId: string;
    readonly parameterT: number;
  };
}

export interface ElevateLineToCubicOp extends ParametricOpBase {
  readonly domain: 'contour';
  readonly kind: 'elevate-line';
  readonly params: {
    readonly segmentId: string;
  };
}

export interface CubicToLineApproxOp extends ParametricOpBase {
  readonly domain: 'contour';
  readonly kind: 'cubic-to-line-approx';
  readonly params: {
    readonly segmentId: string;
    readonly toleranceCm: number;
    readonly confirmed: boolean;
  };
}

export interface RemoveVertexMergeOp extends ParametricOpBase {
  readonly domain: 'contour';
  readonly kind: 'remove-vertex-merge';
  readonly params: {
    readonly vertexRef: string;
    readonly toleranceCm: number;
    readonly confirmed: boolean;
  };
}

export interface UpsertSeamPairOp extends ParametricOpBase {
  readonly domain: 'seam-correspondence';
  readonly kind: 'upsert-seam-pair';
  readonly params: {
    readonly pair: SeamCorrespondencePair;
  };
}

export interface RemoveSeamPairOp extends ParametricOpBase {
  readonly domain: 'seam-correspondence';
  readonly kind: 'remove-seam-pair';
  readonly params: {
    readonly pairId: string;
  };
}

export interface TrueSeamEndpointOp extends ParametricOpBase {
  readonly domain: 'seam-trueing';
  readonly kind: 'true-seam-endpoint';
  readonly params: {
    readonly pairId: string;
    readonly targetSide: 'A' | 'B';
    readonly endpoint: 'start' | 'end';
    readonly targetJoinAngleDeg: number;
    readonly maxHandleAdjustmentCm: number;
  };
}

export interface UpsertConstructionEntityOp extends ParametricOpBase {
  readonly domain: 'construction';
  readonly kind: 'upsert-construction';
  readonly params: {
    readonly entity: ConstructionEntity;
  };
}

export interface RemoveConstructionEntityOp extends ParametricOpBase {
  readonly domain: 'construction';
  readonly kind: 'remove-construction';
  readonly params: {
    readonly entityId: string;
  };
}

export interface UpsertConstraintOp extends ParametricOpBase {
  readonly domain: 'constraint';
  readonly kind: 'upsert-constraint';
  readonly params: {
    readonly constraint: GeometricConstraint;
  };
}

export interface RemoveConstraintOp extends ParametricOpBase {
  readonly domain: 'constraint';
  readonly kind: 'remove-constraint';
  readonly params: {
    readonly constraintId: string;
  };
}

export interface AddOrUpdateNotchOp extends ParametricOpBase {
  readonly domain: 'notch-drill';
  readonly kind: 'upsert-notch';
  readonly params: {
    readonly notchId: string;
    readonly segmentId: string;
    readonly targetArcLengthCm: number;
    readonly notchType: RenderNotch['notchType'];
    readonly label?: string;
  };
}

export interface RemoveNotchOp extends ParametricOpBase {
  readonly domain: 'notch-drill';
  readonly kind: 'remove-notch';
  readonly params: {
    readonly notchId: string;
  };
}

export interface AddOrUpdateDrillHoleOp extends ParametricOpBase {
  readonly domain: 'notch-drill';
  readonly kind: 'upsert-drill';
  readonly params: {
    readonly drillId: string;
    readonly positionCm: RenderPoint2D;
    readonly radiusCm: number;
    readonly label?: string;
  };
}

export interface RemoveDrillHoleOp extends ParametricOpBase {
  readonly domain: 'notch-drill';
  readonly kind: 'remove-drill';
  readonly params: {
    readonly drillId: string;
  };
}

export interface CreateDartOp extends ParametricOpBase {
  readonly domain: 'dart';
  readonly kind: 'create-dart';
  readonly params: {
    readonly dartId: string;
    readonly label: string;
    readonly hostSegmentId: string;
    readonly centerParameterT: number;
    readonly intakeWidthCm: number;
    readonly pivotApexCm: RenderPoint2D;
    readonly backoffCm: number;
    readonly foldDirection: DartFoldDirection;
  };
}

export interface EditDartParametersOp extends ParametricOpBase {
  readonly domain: 'dart';
  readonly kind: 'edit-dart';
  readonly params: {
    readonly dartId: string;
    readonly intakeWidthCm?: number;
    readonly pivotApexCm?: RenderPoint2D;
    readonly backoffCm?: number;
    readonly foldDirection?: DartFoldDirection;
  };
}

export interface RotateTransferDartOp extends ParametricOpBase {
  readonly domain: 'dart';
  readonly kind: 'rotate-transfer-dart';
  readonly params: {
    readonly sourceDartId: string;
    readonly newDartId: string;
    readonly targetHostSegmentId: string;
    readonly targetParameterT: number;
    /** Fraction of source angular intake to transfer in (0, 1] (1 = full transfer, <1 = split transfer) */
    readonly transferRatio: number;
    readonly backoffCm: number;
    readonly foldDirection: DartFoldDirection;
  };
}

export interface CloseOrOpenDartOp extends ParametricOpBase {
  readonly domain: 'dart';
  readonly kind: 'close-or-open-dart';
  readonly params: {
    readonly dartId: string;
    readonly closed: boolean;
  };
}

export interface SetPieceDefaultAllowanceOp extends ParametricOpBase {
  readonly domain: 'allowance-rule';
  readonly kind: 'set-piece-default-allowance';
  readonly params: {
    readonly defaultAllowanceCm: number;
  };
}

export interface SetSegmentAllowanceRuleOp extends ParametricOpBase {
  readonly domain: 'allowance-rule';
  readonly kind: 'set-segment-allowance-rule';
  readonly params: {
    readonly rule: DeclarativeSeamAllowanceRule;
  };
}

export interface SetVertexCornerRuleOp extends ParametricOpBase {
  readonly domain: 'allowance-rule';
  readonly kind: 'set-vertex-corner-rule';
  readonly params: {
    readonly override: VertexCornerRuleOverride;
  };
}

export interface SetProductionAnnotationOp extends ParametricOpBase {
  readonly domain: 'production-annotation';
  readonly kind: 'set-production-annotation';
  readonly params: {
    readonly grainlineOverride?: PieceProductionAnnotationProposal['grainlineOverride'];
    readonly cutQuantityNote?: string;
    readonly onFoldDeclared?: boolean;
    readonly fabricNote?: string;
    readonly interfacingNote?: string;
    readonly productionNotes?: string;
  };
}

export type ParametricProposalOp =
  | MoveContourVertexOp
  | MoveBezierHandleOp
  | SetVertexContinuityOp
  | AlignVertexOp
  | SplitSewSegmentOp
  | ElevateLineToCubicOp
  | CubicToLineApproxOp
  | RemoveVertexMergeOp
  | UpsertSeamPairOp
  | RemoveSeamPairOp
  | TrueSeamEndpointOp
  | UpsertConstructionEntityOp
  | RemoveConstructionEntityOp
  | UpsertConstraintOp
  | RemoveConstraintOp
  | AddOrUpdateNotchOp
  | RemoveNotchOp
  | AddOrUpdateDrillHoleOp
  | RemoveDrillHoleOp
  | CreateDartOp
  | EditDartParametersOp
  | RotateTransferDartOp
  | CloseOrOpenDartOp
  | SetPieceDefaultAllowanceOp
  | SetSegmentAllowanceRuleOp
  | SetVertexCornerRuleOp
  | SetProductionAnnotationOp;

export interface ParametricOpReplayStatus {
  readonly opId: string;
  readonly sequence: number;
  readonly status: 'applied' | 'skipped-disabled' | 'invalidated-upstream' | 'failed' | 'cycle-rejected';
  readonly reason?: string;
  readonly resolvedTargetIds: readonly string[];
  readonly affectedEntityIds: readonly string[];
}

export interface ParametricDependencyEdge {
  readonly fromId: string;
  readonly toOpId: string;
}

export interface ParametricGraphDiagnostic {
  readonly hasCycle: boolean;
  readonly cycleOpIds: readonly string[];
  readonly invalidatedOpIds: readonly string[];
  readonly failedOpIds: readonly string[];
  readonly appliedOpCount: number;
  readonly totalOpCount: number;
}

// ---------------------------------------------------------------------------
// 6. Extended Proposal State & Versioned Read-Only Payload v2
// ---------------------------------------------------------------------------

export interface ExtendedPieceEngineeringOverlay {
  readonly pieceId: string;
  readonly proposedNotches: readonly ProposedNotchRecord[];
  readonly proposedDrillHoles: readonly ProposedDrillHoleRecord[];
  readonly proposedDarts: readonly ProposedDartModel[];
  readonly dartConservation: DartConservationReport | null;
  readonly allowanceRules: PieceProductionAnnotationProposal | null;
  readonly allowanceEvaluation: PieceAllowanceRuleEvaluation | null;
}

export interface WpAEngineeringState extends UnverifiedProposalAuthority {
  readonly schemaVersion: typeof WP_A_PROPOSAL_STATE_SCHEMA_VERSION;
  readonly coordinateFrame: PatternArtifactCoordinateFrame;
  /** Unified parametric operation log synchronized atomically inside GeometryProposalHistoryState */
  readonly operations: readonly ParametricProposalOp[];
  readonly replayStatuses: Readonly<Record<string, ParametricOpReplayStatus>>;
  readonly graphDiagnostic: ParametricGraphDiagnostic;
  readonly seamCorrespondences: Readonly<Record<string, SeamCorrespondencePair>>;
  readonly constructions: Readonly<Record<string, ConstructionEntity>>;
  readonly constraints: Readonly<Record<string, GeometricConstraint>>;
  readonly constraintEvaluations: Readonly<Record<string, EvaluatedConstraintResult>>;
  readonly pieceEngineering: Readonly<Record<string, ExtendedPieceEngineeringOverlay>>;
}

export interface WpAProposalPayloadPiece {
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly name: string;
  readonly cutContourPotentiallyStale: boolean;
  readonly cutContourRegeneratedInClient: false;
  readonly operationsAppliedCount: number;
  readonly sewSegments: readonly RenderCurveSegment[];
  readonly segmentLineage: Readonly<Record<string, ProposalSegmentLineage>>;
  readonly approximationRecords: readonly ProposalApproximationRecord[];
  readonly proposedNotches: readonly ProposedNotchRecord[];
  readonly proposedDrillHoles: readonly ProposedDrillHoleRecord[];
  readonly proposedDarts: readonly ProposedDartModel[];
  readonly dartConservation: DartConservationReport | null;
  readonly declarativeAllowanceRules: PieceProductionAnnotationProposal | null;
  readonly allowanceRuleConflicts: readonly AllowanceRuleConflict[];
}

export interface WpAProposalPayloadV2 extends UnverifiedProposalAuthority {
  readonly schemaVersion: typeof WP_A_PROPOSAL_PAYLOAD_SCHEMA_VERSION;
  readonly submissionStatus: typeof WP_A_SUBMISSION_STATUS;
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
  readonly pieces: readonly WpAProposalPayloadPiece[];
  readonly seamCorrespondences: readonly SeamCorrespondencePair[];
  readonly constructions: readonly ConstructionEntity[];
  readonly constraints: readonly GeometricConstraint[];
  readonly constraintEvaluations: readonly EvaluatedConstraintResult[];
  readonly operations: readonly ParametricProposalOp[];
  readonly replayStatuses: readonly ParametricOpReplayStatus[];
  readonly graphDiagnostic: ParametricGraphDiagnostic;
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

export type WpAProposalPayloadSerializationResult =
  | {
      readonly ok: true;
      readonly payload: WpAProposalPayloadV2;
      readonly json: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

// ---------------------------------------------------------------------------
// 7. WP-A6 — Unified CAD Tools, Snapping & Layer Visibility Contracts
// ---------------------------------------------------------------------------

export type PatternAtelierToolId =
  | 'select'
  | 'pan'
  | 'inspect-entity'
  | 'measure-preview'
  | 'edit-contour'
  | 'seam-walk'
  | 'construction-draw'
  | 'notch-drill'
  | 'dart-author'
  | 'allowance-rule';

export type UnifiedSnapTargetKind =
  | 'none'
  | 'vertex'
  | 'intersection'
  | 'midpoint'
  | 'perpendicular'
  | 'tangent'
  | 'curve-closest'
  | 'construction-line'
  | 'grid';

export interface UnifiedSnapConfig {
  readonly enabled: boolean;
  readonly snapTolerancePx: number;
  readonly gridSnapEnabled: boolean;
  readonly gridStepCm: number;
  readonly vertexSnapEnabled: boolean;
  readonly midpointSnapEnabled: boolean;
  readonly curveSnapEnabled: boolean;
  readonly constructionSnapEnabled: boolean;
  readonly intersectionSnapEnabled: boolean;
  readonly perpendicularSnapEnabled: boolean;
  readonly tangentSnapEnabled: boolean;
  readonly angleConstraintStepDeg: number;
}

export const DEFAULT_UNIFIED_SNAP_CONFIG: UnifiedSnapConfig = {
  enabled: true,
  snapTolerancePx: 10,
  gridSnapEnabled: true,
  gridStepCm: 0.5,
  vertexSnapEnabled: true,
  midpointSnapEnabled: true,
  curveSnapEnabled: true,
  constructionSnapEnabled: true,
  intersectionSnapEnabled: true,
  perpendicularSnapEnabled: true,
  tangentSnapEnabled: true,
  angleConstraintStepDeg: 45
};

export interface UnifiedSnapGuide {
  readonly kind: 'axis' | 'perpendicular' | 'tangent' | 'construction';
  readonly startCm: RenderPoint2D;
  readonly endCm: RenderPoint2D;
  readonly label?: string;
}

export interface UnifiedSnapResult {
  readonly pointCm: RenderPoint2D;
  readonly kind: UnifiedSnapTargetKind;
  readonly targetRef: string | null;
  readonly distanceCm: number;
  readonly constrainedAxisAngleDeg: number | null;
  readonly guide: UnifiedSnapGuide | null;
}

export interface ExtendedCadLayerVisibility {
  readonly showSeamAllowance: boolean;
  readonly showSewLines: boolean;
  readonly showGrainline: boolean;
  readonly showNotches: boolean;
  readonly showDarts: boolean;
  readonly showDimensions: boolean;
  readonly showConstructions: boolean;
  readonly showInternalLines: boolean;
  readonly showSeamWalkOverlay: boolean;
  readonly showAllowanceRuleBadges: boolean;
  readonly showProductionAnnotations: boolean;
}

export type BaseProposalStateLink = PatternGeometryProposalState;
export type BasePieceProposalLink = PieceGeometryProposal;
