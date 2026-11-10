/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Classification of pipeline nodes: independent source inputs vs derived artifacts.
 */
export type PipelineNodeCategory = 'independent_source_input' | 'derived_artifact';

/**
 * Primary authoritative source inputs that exist independently of each other.
 * For example: changing garment length never mutates or invalidates anatomical body measurements.
 */
export type IndependentSourceInputType =
  | 'specification'
  | 'measurements'
  | 'fabric'
  | 'grading-rules'
  | 'drafting-engine';

/**
 * Derived engineering artifacts computed deterministically from source inputs and upstream artifacts.
 */
export type DerivedArtifactType =
  | 'finished-dimensions'
  | 'drafting-configuration'
  | 'drafting'
  | 'geometry-validation'
  | 'grading'
  | 'assembly'
  | 'production-snapshot'
  | 'production-export';

export type PipelineArtifactType = IndependentSourceInputType | DerivedArtifactType;

export type PipelineArtifactStatus =
  | 'current'
  | 'stale'
  | 'pending'
  | 'invalid'
  | 'approved'
  | 'revoked';

/**
 * Detailed lineage and dependency record for each artifact in the garment engineering pipeline.
 */
export interface PipelineArtifactRecord {
  readonly artifactId: string;
  readonly artifactType: PipelineArtifactType;
  readonly nodeCategory: PipelineNodeCategory;
  readonly status: PipelineArtifactStatus;
  readonly revisionId: string;
  readonly sourceRevisionId?: string;
  readonly inputFingerprint: string;
  readonly staleReason?: string;
  readonly affectedInputPaths?: readonly string[];
  readonly regenerationRequired: boolean;
  readonly validationStatus?: string;
  readonly upstreamDependencies: readonly string[];
  readonly upstreamFingerprints?: Readonly<Record<string, string>>;
  readonly generatedContentFingerprint?: string;
  readonly engineVersion?: string;
  readonly lastEvaluatedAt: string;
}

/**
 * Full pipeline integrity evaluation result spanning all engineering stages.
 */
export interface PipelineIntegrityReport {
  readonly isPipelineSynchronized: boolean;
  readonly hasStaleArtifacts: boolean;
  readonly hasBlockingErrors: boolean;
  readonly activeSpecificationRevisionId: string;
  readonly activeMeasurementRevisionId: string;
  readonly independentInputs: Readonly<Record<string, PipelineArtifactRecord>>;
  readonly derivedArtifacts: Readonly<Record<string, PipelineArtifactRecord>>;
  readonly artifacts: Readonly<Record<PipelineArtifactType, PipelineArtifactRecord>>;
  readonly staleReasons: readonly string[];
  readonly requiredActions: readonly string[];
  readonly canExportProductionDocumentation: boolean;
  readonly evaluatedAt: string;
}

/**
 * Machine-readable rejection codes for production documentation export barriers.
 */
export type ProductionExportRejectionCode =
  | 'SPECIFICATION_UNAPPROVED'
  | 'SPECIFICATION_REVOKED'
  | 'SPECIFICATION_INVALID'
  | 'SPECIFICATION_FINGERPRINT_MISMATCH'
  | 'AUTHORITY_TIER_UNAVAILABLE'
  | 'SNAPSHOT_MISSING'
  | 'SNAPSHOT_TAMPERED'
  | 'SNAPSHOT_CORRUPT'
  | 'SNAPSHOT_SPECIFICATION_MISMATCH'
  | 'SNAPSHOT_SPECIFICATION_REVISION_MISMATCH'
  | 'SNAPSHOT_MEASUREMENTS_MISMATCH'
  | 'SNAPSHOT_FABRIC_MISMATCH'
  | 'SNAPSHOT_GEOMETRY_TAMPERED'
  | 'ENGINE_VERSION_MISMATCH'
  | 'GRADING_RULES_MISMATCH'
  | 'UPSTREAM_STAGE_STALE'
  | 'UPSTREAM_STAGE_INVALID'
  | 'FORGED_REPORT_DETECTED'
  | 'FORGED_INTEGRITY_REPORT'
  | 'STALE_SOURCE_FINGERPRINT'
  | 'MISSING_REQUIRED_LINEAGE'
  | 'INDUSTRIAL_SAFETY_VIOLATION';

/**
 * Summary of manufacturing documentation export metadata.
 * Physical manufacturing readiness remains strictly false.
 */
export interface ManufacturingDocumentationSummary {
  readonly isProductionReady: false;
  readonly specificationFingerprint: string;
  readonly patternRevisionFingerprint: string;
  readonly revisionId: string;
  readonly exportedAt: string;
}

/**
 * Validation result for production export requests.
 */
export interface ProductionExportValidationResult {
  readonly isExportPermitted: boolean;
  readonly rejectionCode?: ProductionExportRejectionCode;
  readonly rejectionReason?: string;
  readonly blockingArtifacts: readonly string[];
  readonly warnings: readonly string[];
  readonly validationDetails?: Readonly<Record<string, unknown>>;
  readonly manufacturingDocumentation?: ManufacturingDocumentationSummary;
}

