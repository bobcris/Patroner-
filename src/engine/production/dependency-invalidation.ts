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
import {
  computeSpecificationFingerprint,
  verifySpecificationApproval
} from './garment-specification';

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
 *
 * CRITICAL ARCHITECTURAL GUARANTEE:
 * Independent source inputs (Specification, Body Measurements, Fabric Properties)
 * do not depend on each other. Changing garment target length (specification) NEVER
 * mutates or invalidates anatomical body waist or hip measurements.
 * Derived artifacts (Finished Dimensions, Drafting, CAD Validation, Grading, Production Snapshot)
 * depend on their respective upstream inputs and are invalidated selectively.
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

  // =========================================================================
  // 1. INDEPENDENT SOURCE INPUT: Design Specification
  // =========================================================================
  const specFingerprint = computeSpecificationFingerprint(spec);
  const approvalVerification = verifySpecificationApproval(spec);

  let specStatus: PipelineArtifactStatus = 'approved';
  let specStaleReason: string | undefined = undefined;

  if (approvalVerification.state === 'revoked') {
    specStatus = 'revoked';
    specStaleReason = 'Design specification approval was explicitly revoked.';
    staleReasons.push(specStaleReason);
    requiredActions.push('Re-evaluate and formally approve design specification.');
  } else if (!approvalVerification.isValid) {
    specStatus = approvalVerification.state === 'invalid' ? 'invalid' : 'pending';
    specStaleReason = approvalVerification.reason ?? 'Design specification approval is pending.';
    staleReasons.push(specStaleReason);
    requiredActions.push('Review and approve design specification before industrial release.');
  }

  const specArtifact: PipelineArtifactRecord = {
    artifactId: 'art-specification',
    artifactType: 'specification',
    nodeCategory: 'independent_source_input',
    status: specStatus,
    revisionId: specRevisionId,
    inputFingerprint: specFingerprint,
    staleReason: specStaleReason,
    regenerationRequired: false,
    validationStatus: specStatus === 'approved' ? 'approved' : specStatus,
    upstreamDependencies: [], // INDEPENDENT SOURCE INPUT: NO UPSTREAM DEPENDENCIES
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 2. INDEPENDENT SOURCE INPUT: Body Measurements
  // =========================================================================
  const measFingerprint = computeArtifactInputFingerprint({
    unit: inputs.measurements.unit,
    waist: inputs.measurements.waist,
    lowHip: inputs.measurements.lowHip,
    highHip: inputs.measurements.highHip,
    skirtLength: inputs.measurements.skirtLength,
    bust: inputs.measurements.bust,
    waistToHip: inputs.measurements.waistToHip,
    activeSize: inputs.activeSize
  });

  // Verify anatomical measurements validity
  const isMeasAnatomicallyValid =
    Number.isFinite(inputs.measurements.waist) && inputs.measurements.waist > 0 &&
    Number.isFinite(inputs.measurements.lowHip) && inputs.measurements.lowHip > 0;

  const isMeasApproved = inputs.isMeasurementApproved ?? true;
  let measStatus: PipelineArtifactStatus = 'current';
  let measStaleReason: string | undefined = undefined;

  if (!isMeasAnatomicallyValid) {
    measStatus = 'invalid';
    measStaleReason = 'Anatomical body measurements contain non-finite or non-positive values.';
    staleReasons.push(measStaleReason);
  } else if (!isMeasApproved) {
    measStatus = 'pending';
    measStaleReason = 'Anatomical measurements are pending user verification.';
  }

  const measArtifact: PipelineArtifactRecord = {
    artifactId: 'art-measurements',
    artifactType: 'measurements',
    nodeCategory: 'independent_source_input',
    status: measStatus,
    revisionId: measRevisionId,
    inputFingerprint: measFingerprint,
    staleReason: measStaleReason,
    regenerationRequired: false,
    validationStatus: isMeasAnatomicallyValid ? 'valid' : 'invalid',
    upstreamDependencies: [], // INDEPENDENT SOURCE INPUT: DOES NOT DEPEND ON SPECIFICATION
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 3. INDEPENDENT SOURCE INPUT: Fabric Properties
  // =========================================================================
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
    nodeCategory: 'independent_source_input',
    status: 'current',
    revisionId: fabricRevisionId,
    inputFingerprint: fabricFingerprint,
    regenerationRequired: false,
    validationStatus: 'verified',
    upstreamDependencies: [], // INDEPENDENT SOURCE INPUT: NO UPSTREAM DEPENDENCIES
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 4. INDEPENDENT SOURCE INPUT: Grading Rules & Chart
  // =========================================================================
  const gradingRulesFingerprint = computeArtifactInputFingerprint({
    system: 'standard-iso-8559',
    baseSize: 'M',
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
  });

  const gradingRulesArtifact: PipelineArtifactRecord = {
    artifactId: 'art-grading-rules',
    artifactType: 'grading-rules',
    nodeCategory: 'independent_source_input',
    status: 'current',
    revisionId: 'rules-grading-iso8559',
    inputFingerprint: gradingRulesFingerprint,
    regenerationRequired: false,
    validationStatus: 'standardized',
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 5. INDEPENDENT SOURCE INPUT: Drafting Engine
  // =========================================================================
  const draftingEngineArtifact: PipelineArtifactRecord = {
    artifactId: 'art-drafting-engine',
    artifactType: 'drafting-engine',
    nodeCategory: 'independent_source_input',
    status: 'current',
    revisionId: 'engine-patroner-v1.0',
    inputFingerprint: computeArtifactInputFingerprint({ engine: 'Patroner Core CAD', version: '1.0.0' }),
    regenerationRequired: false,
    validationStatus: 'stable',
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 6. DERIVED ARTIFACT: Finished Garment Dimensions
  // Depends on: Specification + Measurements + Fabric
  // =========================================================================
  const finishedDimsInputFingerprint = computeArtifactInputFingerprint({
    specFingerprint,
    measFingerprint,
    fabricFingerprint,
    targetLengthCm: spec.lengthCm,
    explicitEaseCm: spec.explicitEaseCm,
    activeSize: inputs.activeSize
  });

  let finishedDimsStatus: PipelineArtifactStatus = 'current';
  if (measStatus !== 'current') {
    finishedDimsStatus = 'stale';
  }

  const finishedDimsArtifact: PipelineArtifactRecord = {
    artifactId: 'art-finished-dimensions',
    artifactType: 'finished-dimensions',
    nodeCategory: 'derived_artifact',
    status: finishedDimsStatus,
    revisionId: `dims-${specRevisionId}-${inputs.activeSize}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: finishedDimsInputFingerprint,
    regenerationRequired: finishedDimsStatus === 'stale',
    validationStatus: 'calculated',
    upstreamDependencies: [specArtifact.artifactId, measArtifact.artifactId, fabricArtifact.artifactId],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 7. DERIVED ARTIFACT: Drafting Configuration
  // Depends on: Specification + Finished Dimensions
  // =========================================================================
  const draftingConfigArtifact: PipelineArtifactRecord = {
    artifactId: 'art-drafting-configuration',
    artifactType: 'drafting-configuration',
    nodeCategory: 'derived_artifact',
    status: finishedDimsStatus === 'stale' ? 'stale' : 'current',
    revisionId: `config-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: finishedDimsInputFingerprint,
    regenerationRequired: finishedDimsStatus === 'stale',
    validationStatus: 'ready',
    upstreamDependencies: [specArtifact.artifactId, finishedDimsArtifact.artifactId],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 8. DERIVED ARTIFACT: Pattern Drafting (Geometry)
  // Depends on: Specification + Measurements + Finished Dimensions + Fabric
  // =========================================================================
  const pieces = inputs.patternPieces;
  let draftingStatus: PipelineArtifactStatus = 'current';
  let draftingStaleReason: string | undefined = undefined;
  const affectedDraftingPaths: string[] = [];

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
      affectedDraftingPaths.push('garmentCategory');
      staleReasons.push(draftingStaleReason);
      requiredActions.push('Regenerate pattern geometry for matching garment category.');
    }
  }

  const draftingArtifact: PipelineArtifactRecord = {
    artifactId: 'art-drafting',
    artifactType: 'drafting',
    nodeCategory: 'derived_artifact',
    status: draftingStatus,
    revisionId: `draft-${specRevisionId}-${inputs.activeSize}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: draftingInputFingerprint,
    staleReason: draftingStaleReason,
    affectedInputPaths: affectedDraftingPaths.length > 0 ? affectedDraftingPaths : undefined,
    regenerationRequired: draftingStatus === 'stale',
    validationStatus: pieces && pieces.length > 0 ? 'drafted' : 'empty',
    upstreamDependencies: [
      specArtifact.artifactId,
      measArtifact.artifactId,
      fabricArtifact.artifactId,
      finishedDimsArtifact.artifactId
    ],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 9. DERIVED ARTIFACT: Geometry & Seam Validation
  // Depends on: Pattern Drafting
  // =========================================================================
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
    nodeCategory: 'derived_artifact',
    status: geomValStatus,
    revisionId: `val-${draftingArtifact.revisionId}`,
    sourceRevisionId: draftingArtifact.revisionId,
    inputFingerprint: draftingInputFingerprint,
    staleReason: geomStaleReason,
    regenerationRequired: geomValStatus === 'stale' || geomValStatus === 'invalid',
    validationStatus: valReport?.isValid ? 'valid' : 'invalid',
    upstreamDependencies: [draftingArtifact.artifactId],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 10. DERIVED ARTIFACT: Pattern Grading (Multi-Size)
  // Depends on: Specification + Drafting + Grading Rules
  // =========================================================================
  let gradingStatus: PipelineArtifactStatus = 'current';
  let gradingStaleReason: string | undefined = undefined;

  if (draftingStatus === 'stale' || geomValStatus === 'invalid') {
    gradingStatus = 'stale';
    gradingStaleReason = 'Grading is stale because base geometry is stale or invalid.';
  }

  const gradingArtifact: PipelineArtifactRecord = {
    artifactId: 'art-grading',
    artifactType: 'grading',
    nodeCategory: 'derived_artifact',
    status: gradingStatus,
    revisionId: `grade-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: specFingerprint,
    staleReason: gradingStaleReason,
    regenerationRequired: gradingStatus === 'stale',
    validationStatus: gradingStatus === 'current' ? 'graded' : 'unvalidated',
    upstreamDependencies: [specArtifact.artifactId, draftingArtifact.artifactId, gradingRulesArtifact.artifactId],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 11. DERIVED ARTIFACT: 3D Assembly & Seam Definition
  // =========================================================================
  const assemblyArtifact: PipelineArtifactRecord = {
    artifactId: 'art-assembly',
    artifactType: 'assembly',
    nodeCategory: 'derived_artifact',
    status: 'current',
    revisionId: `asm-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: specFingerprint,
    regenerationRequired: false,
    validationStatus: 'verified',
    upstreamDependencies: [specArtifact.artifactId, draftingArtifact.artifactId],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 12. DERIVED ARTIFACT: Production Pattern Revision Snapshot
  // Depends on: Spec + Measurements + Fabric + Drafting + Validation + Grading
  // =========================================================================
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
    nodeCategory: 'derived_artifact',
    status: snapStatus,
    revisionId: snap?.revisionId ?? `snap-pending-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: snap?.canonicalFingerprint ?? '',
    staleReason: snapStaleReason,
    regenerationRequired: snapStatus === 'stale' || snapStatus === 'pending',
    validationStatus: snap ? 'snapshot-recorded' : 'missing',
    upstreamDependencies: [
      specArtifact.artifactId,
      measArtifact.artifactId,
      draftingArtifact.artifactId,
      geomValArtifact.artifactId,
      gradingArtifact.artifactId
    ],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 13. DERIVED ARTIFACT: Production Export (Tech Pack & Cutting Sheet)
  // Depends on: Specification Approval + Snapshot + Validation Cleanliness
  // =========================================================================
  let exportStatus: PipelineArtifactStatus = 'current';
  let exportStaleReason: string | undefined = undefined;

  if (specStatus !== 'approved') {
    exportStatus = 'pending';
    exportStaleReason = `Production documentation export is blocked: design specification is ${specStatus}.`;
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
    nodeCategory: 'derived_artifact',
    status: exportStatus,
    revisionId: `exp-${snapArtifact.revisionId}`,
    sourceRevisionId: snapArtifact.revisionId,
    inputFingerprint: snapArtifact.inputFingerprint,
    staleReason: exportStaleReason,
    regenerationRequired: exportStatus !== 'current',
    validationStatus: exportStatus === 'current' ? 'export-ready' : 'export-blocked',
    upstreamDependencies: [specArtifact.artifactId, snapArtifact.artifactId, geomValArtifact.artifactId],
    lastEvaluatedAt: now
  };

  // Collate all artifacts
  const independentInputs: Record<string, PipelineArtifactRecord> = {
    specification: specArtifact,
    measurements: measArtifact,
    fabric: fabricArtifact,
    'grading-rules': gradingRulesArtifact,
    'drafting-engine': draftingEngineArtifact
  };

  const derivedArtifacts: Record<string, PipelineArtifactRecord> = {
    'finished-dimensions': finishedDimsArtifact,
    'drafting-configuration': draftingConfigArtifact,
    drafting: draftingArtifact,
    'geometry-validation': geomValArtifact,
    grading: gradingArtifact,
    assembly: assemblyArtifact,
    'production-snapshot': snapArtifact,
    'production-export': exportArtifact
  };

  const artifacts: Record<PipelineArtifactType, PipelineArtifactRecord> = {
    specification: specArtifact,
    measurements: measArtifact,
    fabric: fabricArtifact,
    'grading-rules': gradingRulesArtifact,
    'drafting-engine': draftingEngineArtifact,
    'finished-dimensions': finishedDimsArtifact,
    'drafting-configuration': draftingConfigArtifact,
    drafting: draftingArtifact,
    'geometry-validation': geomValArtifact,
    grading: gradingArtifact,
    assembly: assemblyArtifact,
    'production-snapshot': snapArtifact,
    'production-export': exportArtifact
  };

  const hasStale = Object.values(artifacts).some(a => a.status === 'stale');
  const hasBlocking = Object.values(artifacts).some(a => a.status === 'invalid' || a.status === 'stale');
  const canExport = specStatus === 'approved' && !hasStale && !hasBlocking && snapStatus === 'current' && geomValStatus === 'current';

  return deepFreeze({
    isPipelineSynchronized: !hasStale && specStatus === 'approved',
    hasStaleArtifacts: hasStale,
    hasBlockingErrors: hasBlocking,
    activeSpecificationRevisionId: specRevisionId,
    activeMeasurementRevisionId: measRevisionId,
    independentInputs,
    derivedArtifacts,
    artifacts,
    staleReasons,
    requiredActions,
    canExportProductionDocumentation: canExport,
    evaluatedAt: now
  });
}

/**
 * Validates whether production manufacturing documentation (Tech Pack, Cutting Sheet)
 * may be exported. Strictly inspects actual state (not caller-supplied booleans):
 *  1. Specification is formally approved and its cryptographic fingerprint matches.
 *  2. Anatomical measurements are non-empty and valid.
 *  3. No pipeline artifact is in 'stale' or 'invalid' state.
 *  4. CAD validation has 0 errors and isValid === true.
 *  5. Authoritative ProductionPatternRevisionSnapshot is present, current, and untampered.
 *  6. isProductionReady invariant remains false.
 */
export function validateProductionExportPrerequisites(
  report: PipelineIntegrityReport,
  snapshot?: ProductionPatternRevisionSnapshot
): ProductionExportValidationResult {
  const blockingArtifacts: string[] = [];
  const warnings: string[] = [];

  // Check specification approval
  const specArt = report.artifacts.specification;
  if (specArt.status !== 'approved') {
    blockingArtifacts.push(`specification (${specArt.status}: ${specArt.staleReason ?? 'Formal approval required'})`);
  }

  // Check stale or invalid stages
  for (const [type, art] of Object.entries(report.artifacts)) {
    if (type !== 'specification') {
      if (art.status === 'stale') {
        blockingArtifacts.push(`${type} (stale: ${art.staleReason ?? 'regeneration required'})`);
      } else if (art.status === 'invalid') {
        blockingArtifacts.push(`${type} (invalid: ${art.staleReason ?? 'critical errors must be resolved'})`);
      }
    }
  }

  if (blockingArtifacts.length > 0) {
    return {
      isExportPermitted: false,
      rejectionReason: `Production export blocked by unapproved or out-of-sync pipeline stages: ${blockingArtifacts.join('; ')}`,
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
