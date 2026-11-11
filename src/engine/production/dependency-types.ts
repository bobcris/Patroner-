/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner Pipeline Dependency Graph & Export Verification Types (Milestone 04.6.2.3.4)
 */

import { ApprovalAuthorityTier } from './garment-specification-types';
import {
  FabricSnapshotProvenance,
  MeasurementApprovalStatus,
  MeasurementOrigin
} from './production-types';

export type ExportGradingPolicyMode = 'graded-multi-size' | 'single-size-ungraded';
export type ExportGradingMode = ExportGradingPolicyMode;

export interface ExportGradingPolicy {
  readonly mode: ExportGradingPolicyMode;
  readonly requiredSizes?: readonly string[];
  readonly nonGradingReason?: string;
}

export interface GradingSummarySnapshot {
  readonly isOverallGradingValid: boolean;
  readonly baseSize?: string;
  readonly gradeTableName?: string;
  readonly evaluatedSizes?: readonly string[];
  readonly validSizeCount?: number;
  readonly failedSizeCount?: number;
  readonly unassessedSizeCount?: number;
  readonly summaryMessage?: string;
  readonly [key: string]: unknown;
}

export type PipelineArtifactType =
  | 'specification'
  | 'measurements'
  | 'fabric'
  | 'grading-rules'
  | 'drafting-engine'
  | 'finished-dimensions'
  | 'drafting-configuration'
  | 'drafting'
  | 'geometry-validation'
  | 'grading'
  | 'assembly'
  | 'production-snapshot'
  | 'production-export';

export type PipelineArtifactStage = PipelineArtifactType;

export type PipelineArtifactStatus =
  | 'current'
  | 'approved'
  | 'stale'
  | 'invalid'
  | 'pending'
  | 'unverified'
  | 'revoked'
  | 'superseded';

export type ArtifactFreshnessStatus = PipelineArtifactStatus;

export interface PipelineArtifactRecord {
  readonly artifactId: string;
  readonly artifactType: PipelineArtifactType;
  readonly nodeCategory?: 'independent_source_input' | 'derived_artifact';
  readonly revisionId: string;
  readonly sourceRevisionId?: string;
  readonly status: PipelineArtifactStatus;
  readonly inputFingerprint: string;
  readonly generatedContentFingerprint?: string;
  readonly upstreamDependencies: readonly string[];
  readonly upstreamFingerprints?: Readonly<Record<string, string>>;
  readonly staleReason?: string;
  readonly staleReasons?: readonly string[];
  readonly affectedInputPaths?: readonly string[];
  readonly regenerationRequired?: boolean;
  readonly engineVersion: string;
  readonly validationStatus?: string;
  readonly lastEvaluatedAt?: string;
}

export type ArtifactDependencyNode = PipelineArtifactRecord;

export interface PipelineIntegrityReport {
  readonly isPipelineSynchronized: boolean;
  readonly isPipelineCurrent?: boolean;
  readonly hasStaleArtifacts: boolean;
  readonly hasBlockingErrors: boolean;
  readonly activeSpecificationRevisionId: string;
  readonly activeMeasurementRevisionId?: string;
  readonly independentInputs: Readonly<Record<string, PipelineArtifactRecord>>;
  readonly derivedArtifacts: Readonly<Record<string, PipelineArtifactRecord>>;
  readonly artifacts: Readonly<Record<PipelineArtifactType, PipelineArtifactRecord>>;
  readonly staleReasons: readonly string[];
  readonly requiredActions: readonly string[];
  readonly blockingReasons?: readonly string[];
  readonly canExportProductionDocumentation: boolean;
  readonly evaluatedAt: string;
  readonly isProductionReady?: false;
}

/**
 * Explicit machine-readable rejection codes for `validateProductionExportPrerequisites`.
 * Includes specification authority enforcement (`SPECIFICATION_APPROVAL_UNAUTHENTICATED`,
 * `INVALID_APPROVAL_AUTHORITY`) and complete grading lineage codes (`FINDING-14`, `FINDING-15`).
 */
export type ProductionExportRejectionCode =
  | 'INDUSTRIAL_SAFETY_VIOLATION'
  | 'SNAPSHOT_MISSING'
  | 'SNAPSHOT_CORRUPT'
  | 'MISSING_ACTIVE_INPUTS'
  | 'FORGED_REPORT_DETECTED'
  | 'FORGED_INTEGRITY_REPORT'
  | 'SNAPSHOT_GEOMETRY_TAMPERED'
  | 'SNAPSHOT_SPECIFICATION_REVISION_MISMATCH'
  | 'SNAPSHOT_FABRIC_MISMATCH'
  | 'SNAPSHOT_MEASUREMENTS_MISMATCH'
  | 'SPECIFICATION_UNAPPROVED'
  | 'SPECIFICATION_INVALID'
  | 'SPECIFICATION_REVOKED'
  | 'SPECIFICATION_SUPERSEDED'
  | 'SPECIFICATION_FINGERPRINT_MISMATCH'
  | 'SPECIFICATION_APPROVAL_UNAUTHENTICATED'
  | 'INVALID_APPROVAL_AUTHORITY'
  | 'MEASUREMENT_UNAPPROVED'
  | 'MISSING_MEASUREMENT_PROVENANCE'
  | 'AI_MEASUREMENT_NOT_PERMITTED'
  | 'SYNTHETIC_MEASUREMENT_NOT_PERMITTED'
  | 'MISSING_FABRIC_PROVENANCE'
  | 'ENGINE_VERSION_MISMATCH'
  | 'UPSTREAM_STAGE_INVALID'
  | 'UPSTREAM_STAGE_STALE'
  | 'STALE_SOURCE_FINGERPRINT'
  | 'STALE_PATTERN_GEOMETRY'
  | 'STALE_VALIDATION_REPORT'
  | 'STALE_GRADING_RESULT'
  | 'GRADING_APPLICABILITY_UNDECLARED'
  | 'GRADING_ARTIFACT_MISSING'
  | 'GRADING_ARTIFACT_TAMPERED'
  | 'GRADING_ARTIFACT_REVOKED'
  | 'GRADING_ARTIFACT_SUPERSEDED'
  | 'GRADING_RULES_MISMATCH'
  | 'GRADING_SIZE_RANGE_INCOMPLETE'
  | 'GRADING_VALIDATION_FAILED'
  | 'GRADING_SCOPE_MISMATCH';

export interface ManufacturingDocumentationBundle {
  readonly bundleId?: string;
  readonly exportedAt: string;
  readonly revisionId?: string;
  readonly snapshotRevisionId?: string;
  readonly patternRevisionFingerprint: string;
  readonly snapshotCanonicalFingerprint?: string;
  readonly specificationId?: string;
  readonly specificationRevisionId?: string;
  readonly specificationVersion?: number;
  readonly specificationFingerprint: string;
  readonly approvalAuthorityTier?: ApprovalAuthorityTier;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly measurementRevisionId?: string;
  readonly measurementSetFingerprint?: string;
  readonly measurementProvenance?: MeasurementOrigin;
  readonly measurementApprovalState?: MeasurementApprovalStatus;
  readonly fabricId?: string;
  readonly fabricRevision?: string;
  readonly fabricProvenance?: FabricSnapshotProvenance;
  readonly fabricFingerprint?: string;
  readonly patternPieceFingerprints?: readonly string[];
  readonly validationStatus?: 'validated' | 'warnings' | 'invalid' | string;
  readonly gradingMode?: ExportGradingMode;
  readonly gradingArtifactId?: string;
  readonly gradingRevisionId?: string;
  readonly gradingArtifactFingerprint?: string;
  readonly gradingRuleSetId?: string;
  readonly gradingRuleSetRevision?: string;
  readonly gradingRuleSetFingerprint?: string;
  readonly gradedSizeRange?: readonly string[];
  readonly nonGradingReason?: string;
  readonly physicalValidationStatus?: string;
  readonly engineVersion?: string;
  readonly isProductionReady: false;
  readonly disclaimer?: string;
}

export interface ProductionExportValidationResult {
  readonly isExportPermitted: boolean;
  readonly blockingArtifacts: readonly string[];
  readonly warnings?: readonly string[];
  readonly rejectionReason?: string;
  readonly rejectionCode?: ProductionExportRejectionCode;
  readonly validationDetails?: Readonly<Record<string, unknown>>;
  readonly manufacturingDocumentation?: ManufacturingDocumentationBundle;
}

export type ProductionExportVerificationResult = ProductionExportValidationResult;
