/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PipelineArtifactType =
  | 'specification'
  | 'measurements'
  | 'fabric'
  | 'drafting'
  | 'geometry-validation'
  | 'grading'
  | 'assembly'
  | 'production-snapshot'
  | 'production-export';

export type PipelineArtifactStatus =
  | 'current'
  | 'stale'
  | 'pending'
  | 'invalid'
  | 'approved';

/**
 * Detailed lineage and dependency record for each artifact in the garment engineering pipeline.
 */
export interface PipelineArtifactRecord {
  readonly artifactId: string;
  readonly artifactType: PipelineArtifactType;
  readonly status: PipelineArtifactStatus;
  readonly revisionId: string;
  readonly sourceRevisionId?: string;
  readonly inputFingerprint: string;
  readonly staleReason?: string;
  readonly regenerationRequired: boolean;
  readonly validationStatus?: string;
  readonly upstreamDependencies: readonly string[];
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
  readonly artifacts: Readonly<Record<PipelineArtifactType, PipelineArtifactRecord>>;
  readonly staleReasons: readonly string[];
  readonly requiredActions: readonly string[];
  readonly canExportProductionDocumentation: boolean;
  readonly evaluatedAt: string;
}

/**
 * Validation result for production export requests.
 */
export interface ProductionExportValidationResult {
  readonly isExportPermitted: boolean;
  readonly rejectionReason?: string;
  readonly blockingArtifacts: readonly string[];
  readonly warnings: readonly string[];
}
