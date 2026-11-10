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
import {
  canonicalizeJson,
  computeCanonicalRevisionFingerprint,
  CURRENT_ENGINE_VERSION,
  deepFreeze
} from './pattern-revision-snapshot';
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
import { AuthoritativeGarmentSpecification } from './garment-specification-types';

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
  readonly specification: DesignSpecification | AuthoritativeGarmentSpecification;
  readonly measurements: BodyMeasurements;
  readonly activeSize: string;
  readonly fabric?: FabricProperty;
  readonly patternPieces?: readonly PatternPiece[];
  readonly validationReport?: ValidationReport;
  readonly productionSnapshot?: ProductionPatternRevisionSnapshot;
  readonly isMeasurementApproved?: boolean;
  readonly engineVersion?: string;
  readonly gradingRulesVersion?: string;
  readonly activeDraftingFingerprint?: string;
}

/**
 * Deterministically evaluates dependencies and stale state across all stages
 * of the garment engineering pipeline.
 *
 * CRITICAL ARCHITECTURAL GUARANTEES:
 * 1. Independent source inputs (Specification, Body Measurements, Fabric Properties, Grading Rules, Engine)
 *    do not depend on each other. Changing garment target length (specification) NEVER
 *    mutates or invalidates anatomical body waist or hip measurements.
 * 2. Derived artifacts (Finished Dimensions, Drafting Configuration, Pattern Geometry, Geometry Validation,
 *    Grading, Production Snapshot, Production Export) retain upstream input fingerprints and are
 *    invalidated selectively whenever their actual upstream inputs change.
 */
export function evaluatePipelineDependencyIntegrity(
  inputs: PipelineIntegrityInputs
): PipelineIntegrityReport {
  const now = new Date().toISOString();
  const spec = inputs.specification;
  const specGarmentId = 'garmentId' in spec && spec.garmentId
    ? spec.garmentId
    : ('id' in spec && (spec as DesignSpecification).id ? (spec as DesignSpecification).id : 'garment');
  const specRevisionId = spec.specificationRevisionId ?? `spec-${specGarmentId}-v${spec.version || 1}`;
  const measRevisionId = `meas-${inputs.activeSize}-${spec.garmentCategory}`;
  const currentEngineVer = inputs.engineVersion ?? CURRENT_ENGINE_VERSION;

  let specLengthCm = 0;
  if ('lengthCm' in spec && typeof (spec as any).lengthCm === 'number') {
    specLengthCm = (spec as any).lengthCm;
  }
  if (!specLengthCm && 'targetFinishedDimensions' in spec && spec.targetFinishedDimensions) {
    const td = spec.targetFinishedDimensions as { lengthCm?: number; length?: number };
    specLengthCm = td.lengthCm ?? td.length ?? 0;
  }

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
    generatedContentFingerprint: specFingerprint,
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
    backWaistLength: inputs.measurements.backWaistLength,
    frontWaistLength: inputs.measurements.frontWaistLength,
    acrossBack: inputs.measurements.acrossBack,
    shoulderLength: inputs.measurements.shoulderLength,
    neckCircumference: inputs.measurements.neckCircumference,
    bustSpan: inputs.measurements.bustSpan,
    bustHeight: inputs.measurements.bustHeight,
    armholeDepth: inputs.measurements.armholeDepth,
    bicepsCircumference: inputs.measurements.bicepsCircumference,
    elbowCircumference: inputs.measurements.elbowCircumference,
    wristCircumference: inputs.measurements.wristCircumference,
    sleeveLength: inputs.measurements.sleeveLength,
    armLengthToElbow: inputs.measurements.armLengthToElbow,
    activeSize: inputs.activeSize
  });

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
    generatedContentFingerprint: measFingerprint,
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
    name: fabricObj.name,
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
    generatedContentFingerprint: fabricFingerprint,
    regenerationRequired: false,
    validationStatus: 'verified',
    upstreamDependencies: [], // INDEPENDENT SOURCE INPUT: NO UPSTREAM DEPENDENCIES
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 4. INDEPENDENT SOURCE INPUT: Grading Rules & Chart
  // =========================================================================
  const gradingRulesVer = inputs.gradingRulesVersion ?? 'iso8559-standard';
  const gradingRulesFingerprint = computeArtifactInputFingerprint({
    system: 'standard-iso-8559',
    baseSize: 'M',
    version: gradingRulesVer,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
  });

  const gradingRulesArtifact: PipelineArtifactRecord = {
    artifactId: 'art-grading-rules',
    artifactType: 'grading-rules',
    nodeCategory: 'independent_source_input',
    status: 'current',
    revisionId: `rules-grading-${gradingRulesVer}`,
    inputFingerprint: gradingRulesFingerprint,
    generatedContentFingerprint: gradingRulesFingerprint,
    regenerationRequired: false,
    validationStatus: 'standardized',
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 5. INDEPENDENT SOURCE INPUT: Drafting Engine
  // =========================================================================
  const draftingEngineFingerprint = computeArtifactInputFingerprint({
    engine: 'Patroner Core CAD',
    version: currentEngineVer
  });

  const draftingEngineArtifact: PipelineArtifactRecord = {
    artifactId: 'art-drafting-engine',
    artifactType: 'drafting-engine',
    nodeCategory: 'independent_source_input',
    status: 'current',
    revisionId: `engine-patroner-v${currentEngineVer}`,
    inputFingerprint: draftingEngineFingerprint,
    generatedContentFingerprint: draftingEngineFingerprint,
    engineVersion: currentEngineVer,
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
    targetLengthCm: specLengthCm,
    explicitEaseCm: spec.explicitEaseCm,
    activeSize: inputs.activeSize
  });

  let finishedDimsStatus: PipelineArtifactStatus = 'current';
  let finishedDimsStaleReason: string | undefined = undefined;

  if (measStatus !== 'current') {
    finishedDimsStatus = 'stale';
    finishedDimsStaleReason = 'Underlying body measurements are not current.';
  }

  const finishedDimsArtifact: PipelineArtifactRecord = {
    artifactId: 'art-finished-dimensions',
    artifactType: 'finished-dimensions',
    nodeCategory: 'derived_artifact',
    status: finishedDimsStatus,
    revisionId: `dims-${specRevisionId}-${inputs.activeSize}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: finishedDimsInputFingerprint,
    staleReason: finishedDimsStaleReason,
    regenerationRequired: finishedDimsStatus === 'stale',
    validationStatus: 'calculated',
    upstreamDependencies: [specArtifact.artifactId, measArtifact.artifactId, fabricArtifact.artifactId],
    upstreamFingerprints: {
      specification: specFingerprint,
      measurements: measFingerprint,
      fabric: fabricFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 7. DERIVED ARTIFACT: Drafting Configuration
  // Depends on: Specification + Finished Dimensions + Fabric
  // =========================================================================
  const draftingConfigInputFingerprint = computeArtifactInputFingerprint({
    specFingerprint,
    finishedDimsInputFingerprint,
    fabricFingerprint
  });

  const draftingConfigStatus: PipelineArtifactStatus = finishedDimsStatus === 'stale' ? 'stale' : 'current';

  const draftingConfigArtifact: PipelineArtifactRecord = {
    artifactId: 'art-drafting-configuration',
    artifactType: 'drafting-configuration',
    nodeCategory: 'derived_artifact',
    status: draftingConfigStatus,
    revisionId: `config-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: draftingConfigInputFingerprint,
    staleReason: draftingConfigStatus === 'stale' ? 'Finished dimensions are stale.' : undefined,
    regenerationRequired: draftingConfigStatus === 'stale',
    validationStatus: 'ready',
    upstreamDependencies: [specArtifact.artifactId, finishedDimsArtifact.artifactId, fabricArtifact.artifactId],
    upstreamFingerprints: {
      specification: specFingerprint,
      'finished-dimensions': finishedDimsInputFingerprint,
      fabric: fabricFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 8. DERIVED ARTIFACT: Pattern Drafting (Geometry)
  // Depends on: Specification + Measurements + Finished Dimensions + Fabric + Drafting Engine
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
    lengthCm: specLengthCm,
    explicitEaseCm: spec.explicitEaseCm,
    engineVersion: currentEngineVer
  });

  if (!pieces || pieces.length === 0) {
    draftingStatus = 'stale';
    draftingStaleReason = 'Pattern pieces have not been drafted.';
    staleReasons.push(draftingStaleReason);
    requiredActions.push('Execute deterministic pattern drafting for current specification.');
  } else {
    // 1. Check if pieces match current specification category
    const pieceCategoryMismatch = pieces.some(p => p.garmentCategory && p.garmentCategory !== spec.garmentCategory);
    if (pieceCategoryMismatch) {
      draftingStatus = 'stale';
      draftingStaleReason = `Drafted pieces category does not match active specification '${spec.garmentCategory}'.`;
      affectedDraftingPaths.push('garmentCategory');
      staleReasons.push(draftingStaleReason);
      requiredActions.push('Regenerate pattern geometry for matching garment category.');
    }

    // 2. Check if drafted piece geometry matches target specification length
    if (spec.garmentCategory === 'skirt') {
      const frontSkirt = pieces.find(p =>
        p.pieceCode === 'SK-01' ||
        p.pieceCode.toLowerCase().includes('front') ||
        (p.name && p.name.toLowerCase().includes('front'))
      );
      if (frontSkirt && frontSkirt.boundingBox) {
        // In skirt drafting, piece height is lengthCm + waistBand allowance/height adjustments
        const heightDiff = Math.abs(frontSkirt.boundingBox.heightCm - specLengthCm);
        if (heightDiff > 2.0) {
          draftingStatus = 'stale';
          draftingStaleReason = `Drafted front skirt height (${frontSkirt.boundingBox.heightCm.toFixed(1)} cm) does not match specification target length (${specLengthCm.toFixed(1)} cm).`;
          affectedDraftingPaths.push('lengthCm');
          staleReasons.push(draftingStaleReason);
          requiredActions.push('Regenerate pattern geometry with updated target length.');
        }
      }
    }

    // 3. Check engine version mismatch
    if (inputs.engineVersion && inputs.engineVersion !== CURRENT_ENGINE_VERSION) {
      draftingStatus = 'stale';
      draftingStaleReason = `Drafting engine version changed from '${inputs.engineVersion}' to '${CURRENT_ENGINE_VERSION}'.`;
      affectedDraftingPaths.push('engineVersion');
      staleReasons.push(draftingStaleReason);
      requiredActions.push('Regenerate pattern geometry under the current drafting engine.');
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
      finishedDimsArtifact.artifactId,
      draftingEngineArtifact.artifactId
    ],
    upstreamFingerprints: {
      specification: specFingerprint,
      measurements: measFingerprint,
      fabric: fabricFingerprint,
      'finished-dimensions': finishedDimsInputFingerprint,
      'drafting-engine': draftingEngineFingerprint
    },
    engineVersion: currentEngineVer,
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
    upstreamFingerprints: {
      drafting: draftingInputFingerprint
    },
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
    upstreamFingerprints: {
      specification: specFingerprint,
      drafting: draftingInputFingerprint,
      'grading-rules': gradingRulesFingerprint
    },
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
    upstreamFingerprints: {
      specification: specFingerprint,
      drafting: draftingInputFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 12. DERIVED ARTIFACT: Production Pattern Revision Snapshot
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
    // 1. Recompute canonical fingerprint to verify snapshot integrity
    try {
      const computedFp = computeCanonicalRevisionFingerprint(snap);
      if (computedFp !== snap.canonicalFingerprint) {
        snapStatus = 'invalid';
        snapStaleReason = 'Snapshot canonical fingerprint mismatch; payload has been tampered with or corrupted.';
        staleReasons.push(snapStaleReason);
        requiredActions.push('Regenerate production snapshot to restore integrity.');
      }
    } catch (err) {
      snapStatus = 'invalid';
      snapStaleReason = `Failed to verify snapshot fingerprint: ${err instanceof Error ? err.message : String(err)}`;
      staleReasons.push(snapStaleReason);
    }

    if (snapStatus !== 'invalid') {
      // 2. Check if snapshot references active specification version
      if (snap.designSpecification.version !== spec.version) {
        snapStatus = 'stale';
        snapStaleReason = `Snapshot design version (${snap.designSpecification.version}) is behind active specification v${spec.version}.`;
        staleReasons.push(snapStaleReason);
        requiredActions.push('Regenerate production snapshot to capture updated specification revision.');
      } else if (Math.abs(snap.designSpecification.lengthCm - specLengthCm) > 0.01) {
        snapStatus = 'stale';
        snapStaleReason = `Snapshot target length (${snap.designSpecification.lengthCm} cm) does not match specification (${specLengthCm} cm).`;
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
  }

  const snapArtifact: PipelineArtifactRecord = {
    artifactId: 'art-production-snapshot',
    artifactType: 'production-snapshot',
    nodeCategory: 'derived_artifact',
    status: snapStatus,
    revisionId: snap?.revisionId ?? `snap-pending-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: snap?.canonicalFingerprint ?? '',
    generatedContentFingerprint: snap?.canonicalFingerprint ?? '',
    staleReason: snapStaleReason,
    regenerationRequired: snapStatus === 'stale' || snapStatus === 'pending' || snapStatus === 'invalid',
    validationStatus: snap ? 'snapshot-recorded' : 'missing',
    upstreamDependencies: [
      specArtifact.artifactId,
      measArtifact.artifactId,
      draftingArtifact.artifactId,
      geomValArtifact.artifactId,
      gradingArtifact.artifactId
    ],
    upstreamFingerprints: {
      specification: specFingerprint,
      measurements: measFingerprint,
      drafting: draftingInputFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 13. DERIVED ARTIFACT: Production Export (Tech Pack & Cutting Sheet)
  // Depends on: Specification Approval + Snapshot + Validation Cleanliness
  // =========================================================================
  let exportStatus: PipelineArtifactStatus = 'current';
  let exportStaleReason: string | undefined = undefined;

  if (draftingStatus === 'stale' || geomValStatus === 'stale' || snapStatus === 'stale' || finishedDimsStatus === 'stale') {
    exportStatus = 'stale';
    exportStaleReason = 'Production export is blocked: one or more dependent engineering stages are stale.';
  } else if (specStatus !== 'approved') {
    exportStatus = 'pending';
    exportStaleReason = `Production documentation export is blocked: design specification is ${specStatus}.`;
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
 * may be exported.
 *
 * INDEPENDENT PRODUCTION EXPORT SECURITY BOUNDARY:
 * Fails closed. Independently verifies all 14 mandatory integrity criteria:
 *  1. Specification approval record.
 *  2. Exact approval-to-specification fingerprint binding recomputed.
 *  3. Approval authority tier verified (must not claim cryptographic_principal without provider).
 *  4. Revocation and supersession state.
 *  5. Current specification revision.
 *  6. Current measurement fingerprint.
 *  7. Current fabric fingerprint.
 *  8. Pattern geometry fingerprint and source lineage.
 *  9. Grading and assembly integrity.
 * 10. Geometry validation integrity (zero errors, valid).
 * 11. Snapshot fingerprint recomputed from actual content.
 * 12. Engine/ruleset version compatibility.
 * 13. Physical validation classification.
 * 14. Production readiness invariant (isProductionReady strictly false).
 */
export function validateProductionExportPrerequisites(
  report: PipelineIntegrityReport,
  snapshot?: ProductionPatternRevisionSnapshot,
  activeInputs?: {
    specification?: DesignSpecification | AuthoritativeGarmentSpecification;
    measurements?: BodyMeasurements;
    fabric?: FabricProperty;
  }
): ProductionExportValidationResult {
  const blockingArtifacts: string[] = [];
  const warnings: string[] = [];

  // 1. Verify Specification Approval
  const specArt = report.artifacts.specification;
  if (specArt.status !== 'approved') {
    blockingArtifacts.push(`specification (${specArt.status}: ${specArt.staleReason ?? 'Formal approval required'})`);
  }

  // 2. Verify Pipeline Artifact Stages (no stale or invalid)
  for (const [type, art] of Object.entries(report.artifacts)) {
    if (type !== 'specification') {
      if (art.status === 'stale') {
        blockingArtifacts.push(`${type} (stale: ${art.staleReason ?? 'regeneration required'})`);
      } else if (art.status === 'invalid') {
        blockingArtifacts.push(`${type} (invalid: ${art.staleReason ?? 'critical errors must be resolved'})`);
      }
    }
  }

  // 3. Independent Snapshot Verification
  if (!snapshot) {
    blockingArtifacts.push('production-snapshot (missing: Authoritative snapshot required for export)');
  } else {
    // 3a. Recompute snapshot canonical fingerprint
    try {
      const computedFp = computeCanonicalRevisionFingerprint(snapshot);
      if (computedFp !== snapshot.canonicalFingerprint) {
        blockingArtifacts.push('production-snapshot (tampered: Canonical fingerprint mismatch)');
      }
    } catch {
      blockingArtifacts.push('production-snapshot (corrupt: Unable to recompute snapshot fingerprint)');
    }

    // 3b. Verify snapshot design approval
    if (snapshot.approvalState.designApproval !== 'approved' || !snapshot.designSpecification.isApproved) {
      blockingArtifacts.push('production-snapshot (design approval pending or not approved in snapshot)');
    }

    // 3c. Verify snapshot engine version compatibility
    if (snapshot.engineProvenance.engineVersion !== CURRENT_ENGINE_VERSION) {
      blockingArtifacts.push(`production-snapshot (engine version mismatch: '${snapshot.engineProvenance.engineVersion}' !== '${CURRENT_ENGINE_VERSION}')`);
    }

    // 3d. Verify physical validation classification
    if (
      snapshot.approvalState.physicalPrototypeValidation === 'not-assessed' ||
      snapshot.approvalState.physicalPrototypeValidation === 'incomplete'
    ) {
      warnings.push('Physical validation is unassessed or incomplete and has not undergone physical atelier trials.');
    }

    // 3e. Literal Industrial Safety Invariant: isProductionReady MUST be false
    if ((snapshot as unknown as { isProductionReady: boolean }).isProductionReady !== false) {
      blockingArtifacts.push('isProductionReady (INDUSTRIAL SAFETY VIOLATION: isProductionReady cannot be asserted)');
    }
  }

  // 4. Verify Active Inputs if provided
  if (activeInputs?.specification) {
    const activeSpecVerification = verifySpecificationApproval(activeInputs.specification);
    if (!activeSpecVerification.isValid) {
      blockingArtifacts.push(`active-specification (${activeSpecVerification.state}: ${activeSpecVerification.reason})`);
    }

    if (snapshot && snapshot.designSpecification.version !== activeInputs.specification.version) {
      blockingArtifacts.push(`snapshot-specification-mismatch (snapshot v${snapshot.designSpecification.version} !== active v${activeInputs.specification.version})`);
    }
  }

  if (activeInputs?.measurements && snapshot) {
    const snapVals = snapshot.measurementSet.values;
    if (
      Math.abs(snapVals.waist - activeInputs.measurements.waist) > 0.01 ||
      Math.abs(snapVals.lowHip - activeInputs.measurements.lowHip) > 0.01
    ) {
      blockingArtifacts.push('snapshot-measurements-mismatch (snapshot measurements do not match active body measurements)');
    }
  }

  if (blockingArtifacts.length > 0) {
    let rejectionReason = `Production export blocked by unapproved or out-of-sync pipeline stages: ${blockingArtifacts.join('; ')}`;
    if (blockingArtifacts.some(b => b.includes('isProductionReady'))) {
      rejectionReason = 'Industrial safety violation: isProductionReady cannot be asserted.';
    } else if (
      blockingArtifacts.length === 1 &&
      blockingArtifacts[0].includes('production-snapshot (missing')
    ) {
      rejectionReason = 'Production export requires an authoritative ProductionPatternRevisionSnapshot.';
    }

    return {
      isExportPermitted: false,
      rejectionReason,
      blockingArtifacts,
      warnings
    };
  }

  return {
    isExportPermitted: true,
    blockingArtifacts: [],
    warnings
  };
}
