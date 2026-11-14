/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BoundingBox,
  Dart,
  DesignSpecification,
  FabricProperty,
  FabricStretch,
  FabricWeight,
  GarmentCategory,
  GarmentConstructionFeature,
  GrainLine,
  Notch,
  PatternPiece,
  Point,
  SeamLine,
  SegmentOffsetDiagnostic,
  StandardSize,
  ValidationReport
} from '../../types';
import {
  DirectionalProperties,
  EnhancedFabricProperty,
  FabricPropertyProvenanceRecord,
  PropertyProvenance
} from '../fabric/fabric-types';
import {
  SegmentRole,
  SegmentType
} from '../geometry/primitives';
import { CrossSizeIntegrityReport, GradedPatternSet } from '../grading/grading-types';

export type ConstructionFeature = GarmentConstructionFeature;
export type SizeCode = StandardSize | string;
export type ValidationResult = ValidationReport;
export type DirectionalFabricBehavior = DirectionalProperties;
export type ContourWinding = 'clockwise' | 'counter-clockwise' | 'collinear';
export type OffsetDiagnostic = SegmentOffsetDiagnostic;

export const PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION = '1.0.0' as const;
export type ProductionPatternSnapshotSchemaVersion = typeof PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION;

/**
 * Pure plain-data representation of a single geometric segment (Line or Cubic Bézier).
 * Contains no class methods or prototype dependencies so that snapshots remain
 * deterministically serializable, JSON-safe, and deeply immutable.
 */
export interface GeometricSegmentSnapshot {
  readonly id: string;
  readonly type: SegmentType;
  readonly start: Readonly<Point>;
  readonly end: Readonly<Point>;
  /** For cubic Bézier curves: [cp1, cp2]. Undefined for line segments. */
  readonly controlPoints?: readonly [Readonly<Point>, Readonly<Point>];
  readonly seamAllowanceCm: number;
  readonly isFold: boolean;
  readonly seamId?: string;
  readonly sourceSegmentId?: string;
  readonly role?: SegmentRole;
  /** Exact computed arc length in centimeters. */
  readonly lengthCm: number;
}

/**
 * Bounding box representation with explicit approximation metadata.
 */
export interface ContourBoundingBoxSnapshot extends Readonly<BoundingBox> {
  /**
   * True when the contour contains Bézier curves whose bounding box was derived from
   * polyline sampling rather than analytic curve extrema.
   */
  readonly isApproximate: boolean;
  readonly basis: 'exact' | 'sampled-polyline-approximation';
}

/**
 * Pure plain-data representation of a closed or open 2D geometric contour.
 */
export interface GeometricContourSnapshot {
  readonly id: string;
  readonly isClosed: boolean;
  readonly winding?: ContourWinding;
  readonly segments: readonly GeometricSegmentSnapshot[];
  readonly totalLengthCm: number;
  readonly boundingBox: ContourBoundingBoxSnapshot;
}

/**
 * Pure plain-data representation of a drafted pattern piece at a specific revision.
 */
export interface PatternPieceSnapshot {
  readonly id: string;
  readonly pieceCode: string;
  readonly name: string;
  readonly garmentCategory: GarmentCategory;
  readonly sizeCode: SizeCode | string;
  readonly cutCount: number;
  readonly onFold: boolean;
  readonly material: 'self' | 'lining' | 'interfacing';
  readonly cutPathData: string;
  readonly sewPathData: string;
  readonly seamAllowanceWidthCm: number;
  readonly grainline: Readonly<GrainLine>;
  readonly darts: readonly Readonly<Dart>[];
  readonly notches: readonly Readonly<Notch>[];
  readonly seams: readonly Readonly<SeamLine>[];
  readonly drillHoles?: readonly Readonly<Point>[];
  readonly boundingBox: ContourBoundingBoxSnapshot;
  readonly description?: string;
  readonly stitchingContour?: GeometricContourSnapshot;
  readonly cuttingContour?: GeometricContourSnapshot;
  readonly offsetDiagnostics?: readonly Readonly<OffsetDiagnostic>[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Provenance classification for body measurements.
 * Missing provenance defaults to 'unknown', never 'user-entered'.
 */
export type MeasurementOrigin =
  | 'user-entered'
  | 'operator-confirmed'
  | 'standard-chart'
  | 'physically-measured'
  | 'imported'
  | 'ai-estimated'
  | 'synthetic-fixture'
  | 'synthetic-persona'
  | 'unknown';

export type MeasurementApprovalStatus =
  | 'unverified'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'superseded';

/**
 * Verifiable evidence metadata required when transitioning measurement provenance
 * from reference presets (`'standard-chart'`) to `'physically-measured'` or `'operator-confirmed'`
 * (`AUDIT-04.6.2.3.5-05`).
 */
export interface MeasurementProvenanceEvidence {
  readonly measurementSource:
    | 'physical-tape-measure'
    | 'atelier-fit-session'
    | '3d-body-scanner'
    | 'customer-supplied-verified'
    | 'operator-verified-bespoke'
    | string;
  readonly operatorName: string;
  readonly recordedAt: string;
  readonly sessionReference?: string;
  readonly notes?: string;
}

export interface MeasurementApprovalRecord {
  readonly state: MeasurementApprovalStatus;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly notes?: string;
  readonly measurementRevisionReference?: string;
  readonly evidence?: MeasurementProvenanceEvidence;
}

export type MeasurementApprovalState = MeasurementApprovalStatus;

/**
 * Immutable snapshot of body measurements with explicit provenance and approval state.
 */
export interface MeasurementSetSnapshot {
  readonly revisionId?: string;
  readonly unit: 'cm';
  readonly values: Readonly<Record<string, number>>;
  readonly defaultOrigin: MeasurementOrigin;
  readonly perMeasurementOrigin?: Readonly<Record<string, MeasurementOrigin>>;
  readonly approval: MeasurementApprovalRecord;
  readonly evidence?: MeasurementProvenanceEvidence;
  readonly notes?: readonly string[];
}

/**
 * Authoritative Measurement Set Record (Milestone 04.6.2.3.1 / 04.6.2.3.4 / 04.6.2.3.6)
 */
export interface AuthoritativeMeasurementSetRecord {
  readonly measurementSetId: string;
  readonly revisionId: string;
  readonly parentRevisionId?: string;
  readonly unit: 'cm';
  readonly values: Readonly<Record<string, number>>;
  readonly aiEstimatedValues?: Readonly<Record<string, number>>;
  readonly source: MeasurementOrigin;
  readonly provenance: MeasurementOrigin;
  readonly perMeasurementOrigin?: Readonly<Record<string, MeasurementOrigin>>;
  readonly recordedAt: string;
  readonly approvalState: MeasurementApprovalStatus;
  readonly approvingAuthority?: string;
  readonly approvedAt?: string;
  readonly evidence?: MeasurementProvenanceEvidence;
  readonly supersededByRevisionId?: string;
  readonly notes?: readonly string[];
  readonly canonicalFingerprint: string;
}

export interface CreateAuthoritativeMeasurementSetInput {
  readonly measurementSetId?: string;
  readonly revisionId?: string;
  readonly parentRevisionId?: string;
  readonly unit?: 'cm';
  readonly values: Record<string, number>;
  readonly aiEstimatedValues?: Record<string, number>;
  readonly source?: MeasurementOrigin;
  readonly provenance?: MeasurementOrigin;
  readonly perMeasurementOrigin?: Record<string, MeasurementOrigin>;
  readonly recordedAt?: string;
  readonly approvalState?: MeasurementApprovalStatus;
  readonly approvingAuthority?: string;
  readonly approvedAt?: string;
  readonly evidence?: MeasurementProvenanceEvidence;
  readonly notes?: string[];
}

export type FabricSnapshotProvenance =
  | 'supplier-declared'
  | 'laboratory-tested'
  | 'user-entered'
  | 'project-default'
  | 'preset-default'
  | 'unknown'
  | 'unverified';

/**
 * Immutable snapshot of fabric physical parameters and verification status.
 */
export interface FabricSpecificationSnapshot {
  readonly fabricId: string;
  readonly name: string;
  readonly composition: string;
  readonly fabricRevision?: string;
  readonly weight: FabricWeight | 'light' | 'medium' | 'heavy';
  readonly stretch: FabricStretch | 'none' | 'low' | 'medium' | 'high';
  readonly directional?: Readonly<DirectionalFabricBehavior>;
  readonly gsm?: number;
  readonly thicknessMm?: number;
  readonly moldingFactor?: number;
  readonly provenance: FabricSnapshotProvenance;
  readonly isVerified: boolean;
  readonly propertyVerificationDetails?: Readonly<Record<string, boolean>>;
  readonly propertyProvenance?: Readonly<FabricPropertyProvenanceRecord>;
  readonly testStandard?: string;
  readonly laboratoryReference?: string;
  readonly supplierReference?: string;
  readonly isIllustrative: boolean;
  readonly isProvisional: boolean;
}

/**
 * Immutable snapshot of the design specification used for drafting.
 */
export interface DesignSpecificationSnapshot {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly garmentCategory: GarmentCategory;
  readonly silhouette: string;
  readonly easeProfile: 'fitted' | 'standard' | 'relaxed' | 'oversized' | string;
  readonly lengthCm: number;
  readonly specificationRevisionId?: string;
  readonly parentRevisionId?: string;
  readonly approvedBy?: string;
  readonly approvalProvenance?: string;
  readonly explicitEaseCm?: Readonly<Record<string, number>>;
  readonly targetFinishedDimensions?: Readonly<Record<string, number>>;
  readonly allowances?: {
    readonly seamAllowanceCm?: number;
    readonly hemAllowanceCm?: number;
    readonly waistAllowanceCm?: number;
  };
  readonly dartStyle?: 'waist' | 'princess' | 'shoulder' | 'none' | string;
  readonly sleeveEaseStrategy?: 'classic' | 'minimal' | 'tailored' | string;
  readonly constructionFeatures: readonly Readonly<ConstructionFeature>[];
  readonly designNotes: readonly string[];
  readonly isApproved: boolean;
  readonly approvedAt?: string;
  readonly aiEstimates?: {
    readonly suggestedSilhouette?: string;
    readonly styleConfidenceScore?: number;
    readonly suggestedFabrics: readonly string[];
    readonly technicalAdvice?: string;
    readonly disclaimer?: string;
  };
}

/**
 * Immutable snapshot of drafting and seam allowance rules.
 */
export interface DraftingConfigurationSnapshot {
  readonly dartStyle: string;
  readonly sleeveEaseStrategy: string;
  readonly seamAllowanceCm: number;
  readonly hemAllowanceCm: number;
  readonly waistAllowanceCm?: number;
  readonly neckAllowanceCm?: number;
  readonly armholeAllowanceCm?: number;
  readonly shoulderAllowanceCm?: number;
  readonly bezierToleranceCm?: number;
  readonly miterLimit?: number;
  readonly categoryRegistryId?: string;
  readonly negativeEasePolicyApplied?: string;
  readonly customOptions?: Readonly<Record<string, unknown>>;
}

/**
 * Summary of engineering and validation approvals at the time of snapshot creation.
 */
export interface ApprovalStateSummary {
  readonly designApproval: 'pending' | 'approved' | 'rejected';
  readonly measurementApproval: MeasurementApprovalStatus;
  readonly patternGeometryValidation: string;
  readonly assemblyValidation: 'verified-valid' | 'invalid' | 'not-applicable' | string;
  readonly gradingValidation: 'valid' | 'invalid' | 'not-applicable' | string;
  readonly physicalPrototypeValidation: string;
}

/**
 * Engine provenance metadata recording the exact build and engine version.
 */
export interface EngineProvenanceRecord {
  readonly engineVersion: string;
  readonly appVersion?: string;
  readonly gitCommit?: string;
  readonly buildTimestamp?: string;
  readonly snapshotEngine?: string;
  readonly draftingEngineVersion?: string;
  readonly gradingEngineVersion?: string;
  readonly validationEngineVersion?: string;
  readonly fabricEngineVersion?: string;
}

export type GradingLifecycleState =
  | 'active'
  | 'stale'
  | 'invalid'
  | 'superseded'
  | 'revoked';

export interface PerSizeGeometryValidationRecord {
  readonly sizeId: string;
  readonly size: string;
  readonly status: string;
  readonly isValid: boolean;
  readonly pieceCount: number;
  readonly passedCount?: number;
  readonly warningCount?: number;
  readonly failureCount?: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Authoritative Grading Artifact (Milestone 04.6.2.3.2 / 04.6.2.3.4 / 05.1)
 */
export interface AuthoritativeGradingArtifact {
  readonly gradingArtifactId: string;
  readonly gradingRevisionId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly organizationScope?: string;
  readonly sourcePatternRevisionId: string;
  readonly sourcePatternSnapshotFingerprint?: string;
  /** Acyclic binding to the base pattern revision's immutable contentFingerprint / basePatternFingerprint (Milestone 05.1 Amendment 1) */
  readonly sourceBasePatternFingerprint?: string;
  readonly draftingFingerprint?: string;
  readonly cadGeometryFingerprint?: string;
  readonly sourceSpecificationId: string;
  readonly sourceSpecificationRevisionId: string;
  readonly sourceSpecificationFingerprint: string;
  readonly sourceMeasurementSetId: string;
  readonly sourceMeasurementSetFingerprint: string;
  readonly sizeRange: readonly string[];
  readonly baseSize: SizeCode | string;
  readonly gradingRuleSetId: string;
  readonly gradingRuleSetRevision: string;
  readonly gradingRuleSetFingerprint: string;
  readonly perSizePatternGeometry: Readonly<Record<string, readonly PatternPieceSnapshot[]>>;
  readonly geometryValidationResult: Readonly<Record<string, PerSizeGeometryValidationRecord>>;
  readonly perSizeGeometryValidation: Readonly<Record<string, PerSizeGeometryValidationRecord>>;
  readonly gradingValidationResult: Readonly<CrossSizeIntegrityReport>;
  readonly crossSizeIntegrityReport: Readonly<CrossSizeIntegrityReport>;
  readonly createdAt: string;
  readonly lifecycleState: GradingLifecycleState;
  readonly supersededByRevisionId?: string;
  readonly revocationReason?: string;
  readonly revokedAt?: string;
  /** Immutable SHA-256 digest over grading engineering content, unaffected by lifecycle transitions (Milestone 05.1 Amendment 1 & 2) */
  readonly contentFingerprint?: string;
  readonly canonicalFingerprint: string;
  readonly isProductionReady: false;
}

export interface CreateAuthoritativeGradingArtifactInput {
  readonly gradingArtifactId?: string;
  readonly gradingRevisionId?: string;
  readonly tenantId?: string;
  readonly projectId?: string;
  readonly organizationScope?: string;
  readonly sourcePatternRevisionId: string;
  readonly sourcePatternSnapshotFingerprint?: string;
  readonly sourceBasePatternFingerprint?: string;
  readonly draftingFingerprint?: string;
  readonly cadGeometryFingerprint?: string;
  readonly sourceSpecificationId: string;
  readonly sourceSpecificationRevisionId: string;
  readonly sourceSpecificationFingerprint: string;
  readonly sourceMeasurementSetId?: string;
  readonly sourceMeasurementSetFingerprint: string;
  readonly sizeRange?: readonly string[];
  readonly baseSize?: SizeCode | string;
  readonly gradingRuleSetId?: string;
  readonly gradingRuleSetRevision?: string;
  readonly gradingRuleSetFingerprint?: string;
  readonly gradedPatternSet?: GradedPatternSet;
  readonly basePatternPieces?: readonly (PatternPiece | PatternPieceSnapshot)[];
  readonly perSizePatternGeometry?: Readonly<Record<string, readonly (PatternPiece | PatternPieceSnapshot)[]>>;
  readonly geometryValidationResult?: Readonly<Record<string, Partial<PerSizeGeometryValidationRecord>>>;
  readonly perSizeGeometryValidation?: Readonly<Record<string, Partial<PerSizeGeometryValidationRecord>>>;
  readonly gradingValidationResult?: CrossSizeIntegrityReport;
  readonly crossSizeIntegrityReport?: CrossSizeIntegrityReport;
  readonly createdAt?: string;
  readonly lifecycleState?: GradingLifecycleState;
  readonly supersededByRevisionId?: string;
  readonly revocationReason?: string;
  readonly revokedAt?: string;
}

export type {
  ExportGradingPolicy,
  ExportGradingPolicyMode,
  GradingSummarySnapshot
} from './dependency-types';

// ============================================================================
// MILESTONE 05.1 — AUTHORITATIVE PATTERN REVISION LIFECYCLE & PACKAGE TYPES
// ============================================================================

/**
 * Canonical lifecycle states for an AuthoritativePatternRevision (Milestone 05.1).
 */
export type PatternRevisionLifecycleState =
  | 'draft'
  | 'validated'
  | 'approved'
  | 'superseded'
  | 'invalidated'
  | 'archived';

/**
 * Structured invalidation cause classification for pattern revisions and packages.
 */
export type PatternInvalidationCause =
  | 'specification_changed'
  | 'specification-modified'
  | 'specification-revoked'
  | 'specification-superseded'
  | 'measurement_changed'
  | 'measurement-set-modified'
  | 'measurement-approval-revoked'
  | 'drafting_configuration_changed'
  | 'drafting-configuration-modified'
  | 'fabric-specification-modified'
  | 'engine_version_changed'
  | 'engine-version-modified'
  | 'grading_rule_changed'
  | 'grading-rules-modified'
  | 'grading-artifact-invalidated'
  | 'manual-engineering-invalidation';

/**
 * Structured record capturing why an upstream change invalidated a pattern revision or package.
 */
export interface PatternInvalidationRecord {
  readonly invalidationId: string;
  readonly cause: PatternInvalidationCause;
  readonly reason: string;
  readonly invalidatedAt: string;
  readonly invalidatedBy: string;
  readonly upstreamArtifactId?: string;
  readonly recordedUpstreamFingerprint?: string;
  readonly activeUpstreamFingerprint?: string;
}

export const PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION = 'm05.1-pattern-approval-v1' as const;

/**
 * Canonical signing payload for Tier 4 (`cryptographic_principal`) pattern revision approval.
 * Binds exclusively to the immutable `contentFingerprint` (`basePatternFingerprint`), `geometryFingerprint`,
 * `sourceSpecificationFingerprint`, and `sourceMeasurementSetFingerprint` (`Milestone 05.1 / 05.1.1`).
 */
export interface CanonicalPatternApprovalSigningPayload {
  readonly schemaVersion: typeof PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION | string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly garmentId: string;
  readonly patternRevisionId: string;
  readonly patternRevisionNumber: number;
  readonly basePatternFingerprint: string;
  readonly geometryFingerprint: string;
  readonly sourceSpecificationFingerprint: string;
  readonly sourceMeasurementSetFingerprint: string;
  readonly approvalEventId: string;
  readonly approverPrincipal: string;
  readonly authorityTier: 'cryptographic_principal';
  readonly approvalScope: 'pattern:approve';
  readonly approvalTimestamp: string;
  readonly keyId?: string;
  readonly algorithm?: 'Ed25519';
}

/**
 * Verified approval record bound to an AuthoritativePatternRevision's immutable `contentFingerprint`.
 * Note (Safeguard 1): These fields are claims requiring live verification against a TrustedIdentityVerifier
 * or TrustedCryptographicVerifier before granting production authorization.
 */
export interface PatternRevisionApprovalRecord {
  readonly approvalEventId: string;
  readonly patternRevisionId: string;
  readonly approvalScope?: 'pattern:approve';
  readonly boundBasePatternFingerprint: string;
  readonly boundGeometryFingerprint?: string;
  readonly boundSpecificationFingerprint?: string;
  readonly boundMeasurementSetFingerprint?: string;
  readonly approverName: string;
  readonly approverRole: string;
  readonly approvedAt: string;
  readonly authorityTier: 'authenticated_designer' | 'cryptographic_principal';
  readonly isApprovalAuthenticated: boolean;
  readonly isApprovalCryptographicallySigned: boolean;
  readonly verifiedIdentity?: {
    readonly subjectId: string;
    readonly displayName?: string;
    readonly issuer: string;
    readonly audience: string;
    readonly jti: string;
    readonly tokenDigest: string;
    readonly keyId?: string;
    readonly tenantId?: string;
    readonly approvalScope?: string;
    readonly tokenUse?: string;
    readonly patternRevisionId?: string;
    readonly basePatternFingerprint?: string;
    readonly geometryFingerprint?: string;
    readonly sourceSpecificationFingerprint?: string;
    readonly sourceMeasurementSetFingerprint?: string;
    readonly [key: string]: unknown;
  };
  readonly cryptographicSignature?: {
    readonly keyId: string;
    readonly publicKeyHex: string;
    readonly publicKeyFingerprint: string;
    readonly algorithm: 'Ed25519';
    readonly signatureHex: string;
    readonly [key: string]: unknown;
  };
}

/**
 * Append-only lifecycle event on a pattern revision (`Milestone 05.1 Amendment 2`).
 * Chained via `previousEventFingerprint` and sealed by `lifecycleEventFingerprint`.
 */
export interface PatternRevisionLifecycleEvent {
  readonly eventId: string;
  readonly eventIndex: number;
  readonly eventType:
    | 'draft-created'
    | 'draft-updated'
    | 'validated'
    | 'approved'
    | 'superseded'
    | 'invalidated'
    | 'archived';
  readonly fromState: PatternRevisionLifecycleState | null;
  readonly toState: PatternRevisionLifecycleState;
  readonly targetRevisionId: string;
  readonly targetContentFingerprint: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly reason?: string;
  readonly supersededByRevisionId?: string;
  readonly invalidationRecord?: PatternInvalidationRecord;
  readonly approvalRecord?: PatternRevisionApprovalRecord;
  readonly previousEventFingerprint: string | null;
  readonly lifecycleEventFingerprint: string;
}

/**
 * Immutable Production Pattern Revision Snapshot & Authoritative Pattern Revision (Milestone 04.6.1.1 / 05.1).
 * Captures the complete engineering state of a garment pattern at a specific revision,
 * with strict separation between immutable engineering content (`contentFingerprint` / `basePatternFingerprint`)
 * and append-only lifecycle history (`lifecycleHistory` / `currentStateFingerprint`).
 */
export interface ProductionPatternRevisionSnapshot {
  readonly schemaVersion: typeof PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly revisionId: string;
  readonly parentRevisionId?: string;
  readonly revisionIndex: number;
  readonly createdAt: string;
  readonly createdBy?: string;
  readonly garmentCategory: GarmentCategory;
  readonly targetSize: SizeCode | string;
  readonly designSpecification: DesignSpecificationSnapshot;
  readonly measurementSet: MeasurementSetSnapshot;
  readonly fabricSpecification: FabricSpecificationSnapshot;
  readonly patternPieces: readonly PatternPieceSnapshot[];
  readonly draftingConfiguration: DraftingConfigurationSnapshot;
  readonly validation: ValidationResult;
  readonly assemblySummary?: {
    readonly isValid: boolean;
    readonly totalChecks?: number;
    readonly passedChecks?: number;
    readonly failedChecks?: number;
    readonly warningChecks?: number;
    readonly summaryMessage?: string;
    readonly [key: string]: unknown;
  };
  readonly gradingSummary?: {
    readonly isOverallGradingValid: boolean;
    readonly baseSize?: string;
    readonly evaluatedSizes?: readonly string[];
    readonly validSizeCount?: number;
    readonly failedSizeCount?: number;
    readonly unassessedSizeCount?: number;
    readonly summaryMessage?: string;
    readonly [key: string]: unknown;
  };
  readonly engineProvenance: EngineProvenanceRecord;
  readonly approvalState: ApprovalStateSummary;
  readonly canonicalFingerprint: string;
  /**
   * Acyclic Source & Engineering Content Fingerprints (Milestone 05.1 Amendment 1 & 2):
   * - `geometryFingerprint`: SHA-256 over serialized `patternPieces` alone.
   * - `draftingConfigFingerprint`: SHA-256 over `draftingConfiguration`, `fabricSpecification`, and `engineProvenance`.
   * - `basePatternFingerprint` / `contentFingerprint`: Immutable SHA-256 over source specification, measurements,
   *   drafting configuration, geometry, and validation evidence. Excludes downstream grading artifacts and lifecycle events.
   */
  readonly sourceSpecificationId?: string;
  readonly sourceSpecificationRevisionId?: string;
  readonly sourceSpecificationFingerprint?: string;
  readonly sourceMeasurementSetId?: string;
  readonly sourceMeasurementRevisionId?: string;
  readonly sourceMeasurementSetFingerprint?: string;
  readonly draftingConfigFingerprint?: string;
  readonly geometryFingerprint?: string;
  readonly basePatternFingerprint?: string;
  readonly contentFingerprint?: string;
  /**
   * Lifecycle Integrity Envelope (Milestone 05.1 Amendment 2):
   * Separated from `contentFingerprint` so supersession, invalidation, or archival never mutates content hashes.
   */
  readonly lifecycleHistory?: readonly PatternRevisionLifecycleEvent[];
  readonly currentLifecycleState?: PatternRevisionLifecycleState;
  readonly currentStateFingerprint?: string;
  readonly patternApprovalRecord?: PatternRevisionApprovalRecord;
  readonly supersededByRevisionId?: string;
  readonly invalidationRecords?: readonly PatternInvalidationRecord[];
  /**
   * Non-negotiable industrial safety invariant:
   * Must remain strictly and literally `false` until physical garment validation,
   * industrial marker generation, and factory cutting validation are complete.
   */
  readonly isProductionReady: false;
}

export type AuthoritativePatternRevision = ProductionPatternRevisionSnapshot;

export interface CreateProductionPatternRevisionInput {
  readonly projectId?: string;
  readonly revisionId?: string;
  readonly parentRevisionId?: string;
  readonly revisionIndex?: number;
  readonly createdAt?: string;
  readonly createdBy?: string;
  readonly targetSize: SizeCode | string;
  readonly designSpecification: DesignSpecification;
  readonly sourceSpecificationFingerprint?: string;
  readonly sourceMeasurementSetId?: string;
  readonly sourceMeasurementRevisionId?: string;
  readonly sourceMeasurementSetFingerprint?: string;
  readonly measurements: {
    readonly values: Readonly<Record<string, number>>;
    readonly defaultOrigin?: MeasurementOrigin;
    readonly perMeasurementOrigin?: Readonly<Record<string, MeasurementOrigin>>;
    readonly approval?: Partial<MeasurementApprovalRecord>;
    readonly evidence?: MeasurementProvenanceEvidence;
    readonly notes?: readonly string[];
  };
  readonly fabric: FabricProperty | EnhancedFabricProperty;
  readonly patternPieces: PatternPiece[];
  readonly draftingConfiguration?: Partial<DraftingConfigurationSnapshot>;
  readonly validation: ValidationResult;
  readonly assemblySummary?: Record<string, unknown> & { readonly isValid: boolean };
  readonly gradingSummary?: Record<string, unknown> & { readonly isOverallGradingValid: boolean };
  readonly physicalValidationStatus?: string;
  readonly engineProvenance?: Partial<EngineProvenanceRecord>;
  readonly initialLifecycleState?: 'draft' | 'validated';
}

export interface CurrentRevisionInputs {
  readonly targetSize?: SizeCode | string;
  readonly designSpecification?: Partial<DesignSpecification>;
  readonly measurements?: {
    readonly values?: Record<string, number>;
  };
  readonly fabric?: Partial<FabricProperty & EnhancedFabricProperty>;
  readonly draftingConfiguration?: Partial<DraftingConfigurationSnapshot>;
  readonly patternPieces?: PatternPiece[];
  readonly engineVersion?: string;
}

export interface RevisionInputMismatch {
  readonly path: string;
  readonly field: string;
  readonly baselineValue: unknown;
  readonly currentValue: unknown;
  readonly severity: 'breaking' | 'advisory';
  readonly description: string;
}

export interface RevisionComparisonResult {
  readonly isStale: boolean;
  readonly hasBreakingChanges: boolean;
  readonly mismatches: readonly RevisionInputMismatch[];
  readonly comparedAt: string;
}

export interface RevisionValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly validatedAt: string;
}

// ============================================================================
// MILESTONE 05.1 — LEGACY PATTERN DRAFT COMPATIBILITY ADAPTER TYPES (AMENDMENT 5)
// ============================================================================

export type LegacyPatternDraftStatusInput =
  | 'draft'
  | 'validated'
  | 'graded'
  | 'production-ready'
  | 'approved'
  | string;

export interface LegacyPatternDraftAdaptationResult {
  readonly patternRevision: AuthoritativePatternRevision;
  readonly legacyStatusReceived: string;
  readonly mappedLifecycleState: 'draft' | 'validated';
  readonly isAuthoritativeApprovalGranted: false;
  readonly isProductionAuthorized: false;
  readonly rejectedUnsafeElevationClaims: readonly string[];
  readonly adaptationWarnings: readonly string[];
}

// ============================================================================
// MILESTONE 05.1 — AUTHORITATIVE PRODUCTION PACKAGE MANIFEST & LIFECYCLE
// ============================================================================

export const PRODUCTION_PACKAGE_SCHEMA_VERSION = '1.0.0-m05.1' as const;

export type ProductionPackageLifecycleState =
  | 'active'
  | 'superseded'
  | 'invalidated'
  | 'revoked'
  | 'archived';

export interface ProductionPackagePieceEntry {
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly pieceName: string;
  readonly sizeCode: string;
  readonly cutCount: number;
  readonly onFold: boolean;
  readonly material: 'self' | 'lining' | 'interfacing' | string;
  readonly grainline: Readonly<GrainLine>;
  readonly drillHoleCount: number;
  readonly pieceGeometryFingerprint: string;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly seamAllowanceWidthCm: number;
  readonly notchCount: number;
  readonly dartCount: number;
}

/**
 * Immutable ProductionPackageManifest (`Milestone 05.1 Amendment 1 & 2`).
 * Binds `basePatternFingerprint` (`patternContentFingerprint`), `geometryFingerprint`,
 * `specificationFingerprint`, `measurementSetFingerprint`, and optional `gradingArtifactFingerprint`
 * into an acyclic, independently verifiable manifest digest (`manifestFingerprint`).
 */
export interface ProductionPackageManifest {
  readonly schemaVersion: typeof PRODUCTION_PACKAGE_SCHEMA_VERSION;
  readonly packageId: string;
  readonly packageRevisionId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly garmentId: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly sourceSpecificationId: string;
  readonly sourceSpecificationRevisionId: string;
  readonly sourceSpecificationFingerprint: string;
  readonly sourceMeasurementSetId: string;
  readonly sourceMeasurementRevisionId: string;
  readonly sourceMeasurementSetFingerprint: string;
  readonly sourcePatternRevisionId: string;
  readonly sourcePatternRevisionNumber: number;
  readonly basePatternFingerprint: string;
  readonly geometryFingerprint: string;
  readonly draftingConfigFingerprint: string;
  readonly gradingMode: 'graded-multi-size' | 'single-size-ungraded';
  readonly nonGradingReason?: string;
  readonly sourceGradingArtifactId?: string;
  readonly sourceGradingRevisionId?: string;
  readonly gradingArtifactFingerprint?: string;
  readonly includedSizes: readonly string[];
  readonly baseSize: string;
  readonly pieceInventory: readonly ProductionPackagePieceEntry[];
  readonly pieceCount: number;
  readonly totalPieceInstancesAcrossSizes: number;
  readonly validationDigest: string;
  readonly approvalDigest: string;
  readonly isProductionReady: false;
}

export interface ProductionPackageLifecycleEvent {
  readonly eventId: string;
  readonly packageId: string;
  readonly fromState: ProductionPackageLifecycleState | null;
  readonly toState: ProductionPackageLifecycleState;
  readonly timestamp: string;
  readonly actorId: string;
  readonly actorRole: string;
  readonly reason: string;
  readonly manifestFingerprint: string;
  readonly previousEventFingerprint?: string;
  readonly invalidationRecord?: PatternInvalidationRecord;
  readonly supersededByPackageId?: string;
  readonly lifecycleEventFingerprint: string;
}

/**
 * Authoritative Production Package (`Milestone 05.1 Amendment 1 & 2`).
 * Separates the immutable `manifest` + `manifestFingerprint` from the append-only `lifecycleHistory`
 * and derived `currentPackageState` + `currentStateFingerprint`.
 */
export interface AuthoritativeProductionPackage {
  readonly schemaVersion: typeof PRODUCTION_PACKAGE_SCHEMA_VERSION;
  readonly packageId: string;
  readonly packageRevisionId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly garmentId: string;
  readonly manifest: ProductionPackageManifest;
  readonly manifestFingerprint: string;
  readonly lifecycleHistory: readonly ProductionPackageLifecycleEvent[];
  readonly currentPackageState: ProductionPackageLifecycleState;
  readonly currentStateFingerprint: string;
  readonly supersededByPackageId?: string;
  readonly invalidationRecords: readonly PatternInvalidationRecord[];
  readonly revocationReason?: string;
  readonly revokedAt?: string;
  readonly isProductionReady: false;
}

export type ProductionPackageRejectionCode =
  | 'INDUSTRIAL_SAFETY_VIOLATION'
  | 'PATTERN_REVISION_MISSING'
  | 'PATTERN_REVISION_NOT_APPROVED'
  | 'PATTERN_REVISION_SUPERSEDED'
  | 'PATTERN_REVISION_INVALIDATED'
  | 'PATTERN_REVISION_ARCHIVED'
  | 'PATTERN_REVISION_CONTENT_TAMPERED'
  | 'PATTERN_REVISION_LIFECYCLE_TAMPERED'
  | 'PATTERN_REVISION_APPROVAL_INVALID'
  | 'PATTERN_VALIDATION_FAILED'
  | 'AUTHORIZATION_PROVIDER_UNAVAILABLE'
  | 'SPECIFICATION_UNAPPROVED'
  | 'SPECIFICATION_STALE_MISMATCH'
  | 'MEASUREMENT_UNAPPROVED'
  | 'MEASUREMENT_AI_PROHIBITED'
  | 'MEASUREMENT_STALE_MISMATCH'
  | 'GRADING_POLICY_UNDECLARED'
  | 'GRADING_ARTIFACT_MISSING'
  | 'GRADING_ARTIFACT_INVALID'
  | 'GRADING_ARTIFACT_STALE_MISMATCH';

export interface ProductionPackageCreationResult {
  readonly isPackageCreated: boolean;
  readonly package?: AuthoritativeProductionPackage;
  readonly rejectionCode?: ProductionPackageRejectionCode;
  readonly rejectionReason?: string;
  readonly blockingReasons: readonly string[];
}

export interface ProductionPackageVerificationResult {
  /**
   * @deprecated Structural and historical lifecycle chain validity ONLY
   * (`isStructurallyValid && isHistoricallyVerifiable`).
   * NEVER implies current production authorization — inspect `isCurrentlyAuthorized`.
   */
  readonly isValid: boolean;
  /** True only when manifest schema, manifestFingerprint, piece inventory cut counts, and safety invariants hold. */
  readonly isStructurallyValid: boolean;
  /**
   * True only when the package's hash chain follows strictly legal transitions with required transition metadata,
   * and matches any supplied upstream historical artifacts (within local hash-chain limits; see `limitationNotes`).
   */
  readonly isHistoricallyVerifiable: boolean;
  /**
   * Fail-closed production authorization status.
   * True ONLY when `isStructurallyValid && isHistoricallyVerifiable && currentPackageState === 'active'`,
   * complete upstream source context (`patternRevision`, `specification`, `measurementSet`, and `gradingArtifact` when graded)
   * and live Tier 3/4 verification contexts are provided, and all upstream dependencies and cryptographic/OIDC approvals pass live verification.
   */
  readonly isCurrentlyAuthorized: boolean;
  readonly sourceVerificationStatus: 'complete' | 'partial-unverified-upstream';
  readonly missingSourceContextFields: readonly string[];
  readonly currentPackageState?: ProductionPackageLifecycleState;
  readonly isManifestTampered: boolean;
  readonly isLifecycleTampered: boolean;
  readonly isUpstreamMismatch?: boolean;
  readonly isApprovalVerified?: boolean;
  readonly recomputedManifestFingerprint?: string;
  readonly recomputedCurrentStateFingerprint?: string;
  readonly reason?: string;
  readonly errors: readonly string[];
  readonly authorizationErrors: readonly string[];
  readonly limitationNotes: readonly string[];
}

export class ProductionSnapshotValidationError extends Error {
  readonly errors?: readonly string[];
  constructor(message: string, errors?: readonly string[]) {
    super(message);
    this.name = 'ProductionSnapshotValidationError';
    this.errors = errors;
  }
}

export { ProductionSnapshotValidationError as ProductionSnapshotError };

export class ProductionSnapshotGeometryError extends ProductionSnapshotValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionSnapshotGeometryError';
  }
}

export class ProductionSnapshotMeasurementError extends ProductionSnapshotValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionSnapshotMeasurementError';
  }
}

export class ProductionSnapshotFabricError extends ProductionSnapshotValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionSnapshotFabricError';
  }
}

