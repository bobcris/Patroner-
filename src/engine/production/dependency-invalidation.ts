/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyMeasurements,
  DesignSpecification,
  FabricProperty,
  PatternPiece,
  ValidationReport
} from '../../types';
import { sha256Hex } from './crypto';
import { canonicalizeJson, deepFreeze } from './pattern-revision-snapshot';
import {
  PipelineArtifactRecord,
  PipelineArtifactStatus,
  PipelineArtifactType,
  PipelineIntegrityReport,
  ProductionExportValidationResult
} from './dependency-types';
import { ProductionPatternRevisionSnapshot } from './production-types';

/**
 * Computes a deterministic SHA-256 fingerprint for arbitrary artifact input structures.
 */
export function computeArtifactInputFingerprint(input: unknown): string {
  const json = canonicalizeJson(input);
  return sha256Hex(json);
}

/**
 * Inputs required to evaluate full pipeline integrity.
 */
export interface PipelineIntegrityInputs {
  readonly specification: DesignSpecification;
  readonly measurements: BodyMeasurements;
  readonly activeSize: string;
  readonly fabric?: FabricProperty;
  readonly patternPieces?: readonly PatternPiece[];
  readonly validationReport?: ValidationReport;
  readonly productionSnapshot?: ProductionPatternRevisionSnapshot;
  readonly isMeasurementApproved?: boolean;
}

/**
 * Deterministically evaluates dependencies and stale state across all stages
 * of the garment engineering pipeline.
 */
export function evaluatePipelineDependencyIntegrity(
  inputs: PipelineIntegrityInputs
): PipelineIntegrityReport {
  const now = new Date().toISOString();
  const spec = inputs.specification;
  const specRevisionId = spec.specificationRevisionId ?? `spec-${spec.id}-v${spec.version || 1}`;
  const measRevisionId = `meas-${inputs.activeSize}-${spec.garmentCategory}`;

  const staleReasons: string[] = [];
  const requiredActions: string[] = [];

  // 1. Specification Artifact
  const specFingerprint = computeArtifactInputFingerprint({
    category: spec.garmentCategory,
    silhouette: spec.silhouette,
    lengthCm: spec.lengthCm,
    easeProfile: spec.easeProfile,
    explicitEaseCm: spec.explicitEaseCm,
    constructionFeatures: spec.constructionFeatures,
    fabricId: spec.fabric?.id,
    allowances: {
      seam: spec.seamAllowanceCm,
      hem: spec.hemAllowanceCm,
      waist: spec.waistAllowanceCm
    }
  });

  const specStatus: PipelineArtifactStatus = !spec.isApproved
    ? 'pending'
    : 'approved';

  if (!spec.isApproved) {
    staleReasons.push('Design specification approval is pending or has been revoked.');
    requiredActions.push('Review and approve design specification before industrial release.');
  }

  const specArtifact: PipelineArtifactRecord = {
    artifactId: 'art-specification',
    artifactType: 'specification',
    status: specStatus,
    revisionId: specRevisionId,
    inputFingerprint: specFingerprint,
    regenerationRequired: false,
    validationStatus: spec.isApproved ? 'approved' : 'unapproved',
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // 2. Measurements Artifact
  const measFingerprint = computeArtifactInputFingerprint({
    unit: inputs.measurements.unit,
    waist: inputs.measurements.waist,
    lowHip: inputs.measurements.lowHip,
    highHip: inputs.measurements.highHip,
    skirtLength: inputs.measurements.skirtLength,
    bust: inputs.measurements.bust,
    waistToHip: inputs.measurements.waistToHip
  });

  const isMeasApproved = inputs.isMeasurementApproved ?? true; // defaults to true if user-confirmed
  const measStatus: PipelineArtifactStatus = !isMeasApproved ? 'pending' : 'current';

  const measArtifact: PipelineArtifactRecord = {
    artifactId: 'art-measurements',
    artifactType: 'measurements',
    status: measStatus,
    revisionId: measRevisionId,
    sourceRevisionId: specRevisionId,
    inputFingerprint: measFingerprint,
    regenerationRequired: false,
    validationStatus: 'valid',
    upstreamDependencies: [specRevisionId],
    lastEvaluatedAt: now
  };

  // 3. Fabric Artifact
  const fabricObj = inputs.fabric ?? spec.fabric;
  const fabricRevisionId = `fab-${fabricObj.id}`;
  const fabricFingerprint = computeArtifactInputFingerprint({
    id: fabricObj.id,
    weight: fabricObj.weight,
    stretch: fabricObj.stretch,
    recommendedEaseCm: fabricObj.recommendedEaseCm
  });

  const fabricArtifact: PipelineArtifactRecord = {
    artifactId: 'art-fabric',
    artifactType: 'fabric',
    status: 'current',
    revisionId: fabricRevisionId,
    inputFingerprint: fabricFingerprint,
    regenerationRequired: false,
    validationStatus: 'verified',
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // 4. Pattern Drafting Artifact
  const pieces = inputs.patternPieces;
  let draftingStatus: PipelineArtifactStatus = 'current';
  let draftingStaleReason: string | undefined = undefined;

  const draftingInputFingerprint = computeArtifactInputFingerprint({
    specFingerprint,
    measFingerprint,
    fabricFingerprint,
    category: spec.garmentCategory,
    lengthCm: spec.lengthCm,
    explicitEaseCm: spec.explicitEaseCm
  });

  if (!pieces || pieces.length === 0) {
    draftingStatus = 'stale';
    draftingStaleReason = 'Pattern pieces have not been drafted.';
    staleReasons.push(draftingStaleReason);
    requiredActions.push('Execute deterministic pattern drafting for current specification.');
  } else {
    // Check if pieces match current specification category
    const pieceCategoryMismatch = pieces.some(p => p.garmentCategory && p.garmentCategory !== spec.garmentCategory);
    if (pieceCategoryMismatch) {
      draftingStatus = 'stale';
      draftingStaleReason = `Drafted pieces category does not match active specification '${spec.garmentCategory}'.`;
      staleReasons.push(draftingStaleReason);
      requiredActions.push('Regenerate pattern geometry for matching garment category.');
    }
  }

  const draftingArtifact: PipelineArtifactRecord = {
    artifactId: 'art-drafting',
    artifactType: 'drafting',
    status: draftingStatus,
    revisionId: `draft-${specRevisionId}-${inputs.activeSize}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: draftingInputFingerprint,
    staleReason: draftingStaleReason,
    regenerationRequired: draftingStatus === 'stale',
    validationStatus: pieces && pieces.length > 0 ? 'drafted' : 'empty',
    upstreamDependencies: [specRevisionId, measRevisionId, fabricRevisionId],
    lastEvaluatedAt: now
  };

  // 5. Geometry Validation Artifact
  const valReport = inputs.validationReport;
  let geomValStatus: PipelineArtifactStatus = 'current';
  let geomStaleReason: string | undefined = undefined;

  if (draftingStatus === 'stale') {
    geomValStatus = 'stale';
    geomStaleReason = 'Geometry validation is stale because drafted geometry is stale.';
  } else if (!valReport) {
    geomValStatus = 'pending';
    geomStaleReason = 'Geometry has not been validated against seam consistency checks.';
  } else if (!valReport.isValid) {
    geomValStatus = 'invalid';
    geomStaleReason = `Geometry validation failed with ${valReport.failureCount || 1} error(s).`;
    staleReasons.push(geomStaleReason);
    requiredActions.push('Resolve seam discrepancies in Pattern CAD.');
  }

  const geomValArtifact: PipelineArtifactRecord = {
    artifactId: 'art-geometry-validation',
    artifactType: 'geometry-validation',
    status: geomValStatus,
    revisionId: `val-${draftingArtifact.revisionId}`,
    sourceRevisionId: draftingArtifact.revisionId,
    inputFingerprint: draftingInputFingerprint,
    staleReason: geomStaleReason,
    regenerationRequired: geomValStatus === 'stale' || geomValStatus === 'invalid',
    validationStatus: valReport?.isValid ? 'valid' : 'invalid',
    upstreamDependencies: [draftingArtifact.revisionId],
    lastEvaluatedAt: now
  };

  // 6. Grading Artifact
  let gradingStatus: PipelineArtifactStatus = 'current';
  let gradingStaleReason: string | undefined = undefined;

  if (draftingStatus === 'stale' || geomValStatus === 'invalid') {
    gradingStatus = 'stale';
    gradingStaleReason = 'Grading is stale because base geometry is stale or invalid.';
  }

  const gradingArtifact: PipelineArtifactRecord = {
    artifactId: 'art-grading',
    artifactType: 'grading',
    status: gradingStatus,
    revisionId: `grade-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: specFingerprint,
    staleReason: gradingStaleReason,
    regenerationRequired: gradingStatus === 'stale',
    validationStatus: gradingStatus === 'current' ? 'graded' : 'unvalidated',
    upstreamDependencies: [specRevisionId, draftingArtifact.revisionId],
    lastEvaluatedAt: now
  };

  // 7. Assembly Artifact
  const assemblyStatus: PipelineArtifactStatus = spec.garmentCategory === 'bodice' ? 'current' : 'current';
  const assemblyArtifact: PipelineArtifactRecord = {
    artifactId: 'art-assembly',
    artifactType: 'assembly',
    status: assemblyStatus,
    revisionId: `asm-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: specFingerprint,
    regenerationRequired: false,
    validationStatus: 'verified',
    upstreamDependencies: [specRevisionId, draftingArtifact.revisionId],
    lastEvaluatedAt: now
  };

  // 8. Production Pattern Revision Snapshot Artifact
  const snap = inputs.productionSnapshot;
  let snapStatus: PipelineArtifactStatus = 'current';
  let snapStaleReason: string | undefined = undefined;

  if (!snap) {
    snapStatus = 'pending';
    snapStaleReason = 'Production pattern revision snapshot has not been generated.';
    staleReasons.push(snapStaleReason);
    requiredActions.push('Generate production pattern snapshot for approved specification.');
  } else {
    // Check if snapshot references the active specification revision
    if (snap.designSpecification.version !== spec.version) {
      snapStatus = 'stale';
      snapStaleReason = `Snapshot design version (${snap.designSpecification.version}) is behind active specification v${spec.version}.`;
      staleReasons.push(snapStaleReason);
      requiredActions.push('Regenerate production snapshot to capture updated specification revision.');
    } else if (Math.abs(snap.designSpecification.lengthCm - spec.lengthCm) > 0.01) {
      snapStatus = 'stale';
      snapStaleReason = `Snapshot target length (${snap.designSpecification.lengthCm} cm) does not match specification (${spec.lengthCm} cm).`;
      staleReasons.push(snapStaleReason);
      requiredActions.push('Regenerate production snapshot with matching length.');
    } else if (snap.garmentCategory !== spec.garmentCategory) {
      snapStatus = 'stale';
      snapStaleReason = `Snapshot category '${snap.garmentCategory}' does not match active specification '${spec.garmentCategory}'.`;
      staleReasons.push(snapStaleReason);
      requiredActions.push('Regenerate snapshot for active category.');
    } else if (draftingStatus === 'stale') {
      snapStatus = 'stale';
      snapStaleReason = 'Underlying pattern drafting is stale.';
      staleReasons.push(snapStaleReason);
    }
  }

  const snapArtifact: PipelineArtifactRecord = {
    artifactId: 'art-production-snapshot',
    artifactType: 'production-snapshot',
    status: snapStatus,
    revisionId: snap?.revisionId ?? `snap-pending-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: snap?.canonicalFingerprint ?? '',
    staleReason: snapStaleReason,
    regenerationRequired: snapStatus === 'stale' || snapStatus === 'pending',
    validationStatus: snap ? 'snapshot-recorded' : 'missing',
    upstreamDependencies: [specRevisionId, measRevisionId, draftingArtifact.revisionId, geomValArtifact.revisionId],
    lastEvaluatedAt: now
  };

  // 9. Production Export Artifact
  let exportStatus: PipelineArtifactStatus = 'current';
  let exportStaleReason: string | undefined = undefined;

  if (!spec.isApproved) {
    exportStatus = 'pending';
    exportStaleReason = 'Production documentation export is blocked: design specification is unapproved.';
  } else if (draftingStatus === 'stale' || geomValStatus === 'stale' || snapStatus === 'stale') {
    exportStatus = 'stale';
    exportStaleReason = 'Production export is blocked: one or more dependent engineering stages are stale.';
  } else if (geomValStatus !== 'current' || snapStatus !== 'current') {
    exportStatus = 'pending';
    exportStaleReason = 'Production export is pending completion of geometry validation or revision snapshot.';
  }

  const exportArtifact: PipelineArtifactRecord = {
    artifactId: 'art-production-export',
    artifactType: 'production-export',
    status: exportStatus,
    revisionId: `exp-${snapArtifact.revisionId}`,
    sourceRevisionId: snapArtifact.revisionId,
    inputFingerprint: snapArtifact.inputFingerprint,
    staleReason: exportStaleReason,
    regenerationRequired: exportStatus !== 'current',
    validationStatus: exportStatus === 'current' ? 'export-ready' : 'export-blocked',
    upstreamDependencies: [specRevisionId, snapArtifact.revisionId],
    lastEvaluatedAt: now
  };

  const artifacts: Record<PipelineArtifactType, PipelineArtifactRecord> = {
    specification: specArtifact,
    measurements: measArtifact,
    fabric: fabricArtifact,
    drafting: draftingArtifact,
    'geometry-validation': geomValArtifact,
    grading: gradingArtifact,
    assembly: assemblyArtifact,
    'production-snapshot': snapArtifact,
    'production-export': exportArtifact
  };

  const hasStale = Object.values(artifacts).some(a => a.status === 'stale');
  const hasBlocking = Object.values(artifacts).some(a => a.status === 'invalid' || a.status === 'stale');
  const canExport = spec.isApproved && !hasStale && !hasBlocking && snapStatus === 'current' && geomValStatus === 'current';

  return deepFreeze({
    isPipelineSynchronized: !hasStale && spec.isApproved,
    hasStaleArtifacts: hasStale,
    hasBlockingErrors: hasBlocking,
    activeSpecificationRevisionId: specRevisionId,
    activeMeasurementRevisionId: measRevisionId,
    artifacts,
    staleReasons,
    requiredActions,
    canExportProductionDocumentation: canExport,
    evaluatedAt: now
  });
}

/**
 * Validates whether production manufacturing documentation (Tech Pack, Cutting Sheet)
 * may be exported. Strictly blocks stale, unapproved, or contradictory states.
 */
export function validateProductionExportPrerequisites(
  report: PipelineIntegrityReport,
  snapshot?: ProductionPatternRevisionSnapshot
): ProductionExportValidationResult {
  const blockingArtifacts: string[] = [];
  const warnings: string[] = [];

  if (!report.canExportProductionDocumentation) {
    for (const [type, art] of Object.entries(report.artifacts)) {
      if (art.status === 'stale' || art.status === 'invalid' || (art.status === 'pending' && type === 'specification')) {
        blockingArtifacts.push(`${type} (${art.status}: ${art.staleReason ?? 'regeneration required'})`);
      }
    }
    return {
      isExportPermitted: false,
      rejectionReason: `Production export blocked by stale or unapproved pipeline stages: ${blockingArtifacts.join('; ')}`,
      blockingArtifacts,
      warnings
    };
  }

  if (!snapshot) {
    return {
      isExportPermitted: false,
      rejectionReason: 'Production export requires an authoritative ProductionPatternRevisionSnapshot.',
      blockingArtifacts: ['production-snapshot (missing)'],
      warnings
    };
  }

  // Enforce industrial safety invariant
  if ((snapshot as unknown as { isProductionReady: boolean }).isProductionReady === true) {
    return {
      isExportPermitted: false,
      rejectionReason: 'Industrial safety violation: isProductionReady cannot be asserted.',
      blockingArtifacts: ['isProductionReady (safety violation)'],
      warnings
    };
  }

  return {
    isExportPermitted: true,
    blockingArtifacts: [],
    warnings
  };
}
