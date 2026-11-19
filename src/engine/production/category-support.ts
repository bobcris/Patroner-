/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyMeasurements,
  DesignSpecification,
  GarmentCategory,
  PatternPiece,
  ValidationReport
} from '../../types';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { validatePatternDraft } from '../validation/seam-validator';
import {
  evaluatePipelineDependencyIntegrity,
  PipelineIntegrityInputs
} from './dependency-invalidation';
import {
  PipelineArtifactRecord,
  PipelineArtifactType,
  PipelineIntegrityReport
} from './dependency-types';
import {
  computeSpecificationFingerprint,
  verifySpecificationApproval
} from './garment-specification';
import {
  ApprovalVerificationContext,
  AuthoritativeGarmentSpecification,
  SpecificationApprovalVerificationResult
} from './garment-specification-types';
import { CURRENT_ENGINE_VERSION } from './pattern-revision-snapshot';

export const CAD_SUPPORTED_GARMENT_CATEGORIES = ['skirt', 'bodice'] as const;
export type CadSupportedGarmentCategory = (typeof CAD_SUPPORTED_GARMENT_CATEGORIES)[number];

export interface SafeSpecificationApprovalResult extends SpecificationApprovalVerificationResult {
  readonly isCadSupported: boolean;
}

export interface SafeDraftPiecesResult {
  readonly isCadSupported: boolean;
  readonly pieces: PatternPiece[];
  readonly unsupportedReason?: string;
}

export interface SafeWorkspacePipelineResult {
  readonly isCadSupported: boolean;
  readonly unsupportedReason?: string;
  readonly approvalVerification: SafeSpecificationApprovalResult;
  readonly pieces: PatternPiece[];
  readonly validation: ValidationReport;
  readonly pipelineReport: PipelineIntegrityReport;
}

export function isCadDraftingSupportedCategory(
  category: GarmentCategory | string | undefined | null
): category is CadSupportedGarmentCategory {
  return category === 'skirt' || category === 'bodice';
}

export function getUnsupportedCategoryMessage(category: string): string {
  return `Garment category "${category}" is in SPECS ONLY mode. Deterministic CAD pattern drafting and M05 production packages are currently implemented only for skirt and bodice garments.`;
}

export function safeComputeSpecificationFingerprint(
  spec: AuthoritativeGarmentSpecification | DesignSpecification
): { isSupported: boolean; fingerprint: string | null; reason?: string } {
  if (!isCadDraftingSupportedCategory(spec.garmentCategory)) {
    return {
      isSupported: false,
      fingerprint: null,
      reason: getUnsupportedCategoryMessage(String(spec.garmentCategory))
    };
  }
  return {
    isSupported: true,
    fingerprint: computeSpecificationFingerprint(spec)
  };
}

export function safeVerifySpecificationApproval(
  spec: AuthoritativeGarmentSpecification | DesignSpecification,
  verificationContext?: ApprovalVerificationContext
): SafeSpecificationApprovalResult {
  if (!isCadDraftingSupportedCategory(spec.garmentCategory)) {
    return {
      isValid: false,
      state: 'invalid',
      canonicalFingerprint: '',
      isCadSupported: false,
      reason: getUnsupportedCategoryMessage(String(spec.garmentCategory))
    };
  }
  const result = verifySpecificationApproval(spec, verificationContext);
  return {
    ...result,
    isCadSupported: true
  };
}

export function draftSupportedCategoryPieces(
  measurements: BodyMeasurements,
  spec: DesignSpecification
): SafeDraftPiecesResult {
  if (spec.garmentCategory === 'bodice') {
    return {
      isCadSupported: true,
      pieces: draftBodiceBlock(measurements, spec)
    };
  }
  if (spec.garmentCategory === 'skirt') {
    return {
      isCadSupported: true,
      pieces: draftSkirtBlock(measurements, spec)
    };
  }
  return {
    isCadSupported: false,
    pieces: [],
    unsupportedReason: getUnsupportedCategoryMessage(String(spec.garmentCategory))
  };
}

function createUnsupportedPipelineArtifact(
  artifactId: string,
  artifactType: PipelineArtifactType,
  nodeCategory: 'independent_source_input' | 'derived_artifact',
  revisionId: string,
  reason: string,
  evaluatedAt: string
): PipelineArtifactRecord {
  return {
    artifactId,
    artifactType,
    nodeCategory,
    revisionId,
    status: 'pending',
    inputFingerprint: 'unsupported-category',
    generatedContentFingerprint: 'unsupported-category',
    upstreamDependencies: [],
    staleReason: reason,
    regenerationRequired: false,
    validationStatus: 'specs-only',
    engineVersion: CURRENT_ENGINE_VERSION,
    lastEvaluatedAt: evaluatedAt
  };
}

export function evaluateSpecPipelineSafely(
  inputs: Omit<PipelineIntegrityInputs, 'patternPieces' | 'validationReport'> & {
    readonly measurements: BodyMeasurements;
  }
): SafeWorkspacePipelineResult {
  const { specification, measurements } = inputs;
  const specObj = specification as DesignSpecification;
  const isSupported = isCadDraftingSupportedCategory(specObj.garmentCategory);

  if (!isSupported) {
    const unsupportedReason = getUnsupportedCategoryMessage(String(specObj.garmentCategory));
    const evaluatedAt = new Date().toISOString();
    const specRevisionId =
      specObj.specificationRevisionId ?? `spec-${specObj.id || 'garment'}-v${specObj.version || 1}`;

    const validation: ValidationReport = {
      status: 'invalid',
      isValid: false,
      isProductionReady: false,
      statusLabel: 'SPECS_ONLY_CATEGORY',
      timestamp: evaluatedAt,
      passedCount: 0,
      warningCount: 0,
      failureCount: 0,
      checks: [],
      unassessedConditions: [
        {
          id: 'unassessed-cad-category',
          name: `Deterministic CAD block for category "${specObj.garmentCategory}"`,
          reason: unsupportedReason,
          milestonePrerequisite: 'M02 / CAD Block Extension (Planned)'
        }
      ],
      declaration: unsupportedReason
    };

    const specArtifact = createUnsupportedPipelineArtifact(
      'art-specification',
      'specification',
      'independent_source_input',
      specRevisionId,
      unsupportedReason,
      evaluatedAt
    );
    const measArtifact = createUnsupportedPipelineArtifact(
      'art-measurements',
      'measurements',
      'independent_source_input',
      `meas-${inputs.activeSize}`,
      unsupportedReason,
      evaluatedAt
    );
    const fabricArtifact = createUnsupportedPipelineArtifact(
      'art-fabric',
      'fabric',
      'independent_source_input',
      specObj.fabric.id,
      unsupportedReason,
      evaluatedAt
    );
    const rulesArtifact = createUnsupportedPipelineArtifact(
      'art-grading-rules',
      'grading-rules',
      'independent_source_input',
      inputs.gradingRulesVersion ?? 'rules-v1',
      unsupportedReason,
      evaluatedAt
    );
    const engineArtifact = createUnsupportedPipelineArtifact(
      'art-drafting-engine',
      'drafting-engine',
      'independent_source_input',
      CURRENT_ENGINE_VERSION,
      unsupportedReason,
      evaluatedAt
    );
    const finishedDimsArtifact = createUnsupportedPipelineArtifact(
      'art-finished-dimensions',
      'finished-dimensions',
      'derived_artifact',
      specRevisionId,
      unsupportedReason,
      evaluatedAt
    );
    const draftingConfigArtifact = createUnsupportedPipelineArtifact(
      'art-drafting-configuration',
      'drafting-configuration',
      'derived_artifact',
      specRevisionId,
      unsupportedReason,
      evaluatedAt
    );
    const draftingArtifact = createUnsupportedPipelineArtifact(
      'art-drafting',
      'drafting',
      'derived_artifact',
      specRevisionId,
      unsupportedReason,
      evaluatedAt
    );
    const validationArtifact = createUnsupportedPipelineArtifact(
      'art-geometry-validation',
      'geometry-validation',
      'derived_artifact',
      specRevisionId,
      unsupportedReason,
      evaluatedAt
    );
    const gradingArtifact = createUnsupportedPipelineArtifact(
      'art-grading',
      'grading',
      'derived_artifact',
      specRevisionId,
      unsupportedReason,
      evaluatedAt
    );
    const assemblyArtifact = createUnsupportedPipelineArtifact(
      'art-assembly',
      'assembly',
      'derived_artifact',
      specRevisionId,
      unsupportedReason,
      evaluatedAt
    );
    const snapshotArtifact = createUnsupportedPipelineArtifact(
      'art-production-snapshot',
      'production-snapshot',
      'derived_artifact',
      specRevisionId,
      unsupportedReason,
      evaluatedAt
    );
    const exportArtifact = createUnsupportedPipelineArtifact(
      'art-production-export',
      'production-export',
      'derived_artifact',
      specRevisionId,
      unsupportedReason,
      evaluatedAt
    );

    const pipelineReport: PipelineIntegrityReport = {
      isPipelineSynchronized: false,
      isPipelineCurrent: false,
      hasStaleArtifacts: false,
      hasBlockingErrors: true,
      activeSpecificationRevisionId: specRevisionId,
      activeMeasurementRevisionId: `meas-${inputs.activeSize}`,
      independentInputs: {
        specification: specArtifact,
        measurements: measArtifact,
        fabric: fabricArtifact,
        'grading-rules': rulesArtifact,
        'drafting-engine': engineArtifact
      },
      derivedArtifacts: {
        'finished-dimensions': finishedDimsArtifact,
        'drafting-configuration': draftingConfigArtifact,
        drafting: draftingArtifact,
        'geometry-validation': validationArtifact,
        grading: gradingArtifact,
        assembly: assemblyArtifact,
        'production-snapshot': snapshotArtifact,
        'production-export': exportArtifact
      },
      artifacts: {
        specification: specArtifact,
        measurements: measArtifact,
        fabric: fabricArtifact,
        'grading-rules': rulesArtifact,
        'drafting-engine': engineArtifact,
        'finished-dimensions': finishedDimsArtifact,
        'drafting-configuration': draftingConfigArtifact,
        drafting: draftingArtifact,
        'geometry-validation': validationArtifact,
        grading: gradingArtifact,
        assembly: assemblyArtifact,
        'production-snapshot': snapshotArtifact,
        'production-export': exportArtifact
      },
      staleReasons: [unsupportedReason],
      requiredActions: [
        'Select a skirt or bodice garment specification to run deterministic Pattern CAD and M05 production engineering.'
      ],
      blockingReasons: [unsupportedReason],
      canExportProductionDocumentation: false,
      evaluatedAt,
      isProductionReady: false
    };

    return {
      isCadSupported: false,
      unsupportedReason,
      approvalVerification: {
        isValid: false,
        state: 'invalid',
        canonicalFingerprint: '',
        isCadSupported: false,
        reason: unsupportedReason
      },
      pieces: [],
      validation,
      pipelineReport
    };
  }

  const approvalVerification = safeVerifySpecificationApproval(specification, inputs.verificationContext);
  const { pieces } = draftSupportedCategoryPieces(measurements, specObj);
  const validation = validatePatternDraft(pieces);
  const pipelineReport = evaluatePipelineDependencyIntegrity({
    ...inputs,
    patternPieces: pieces,
    validationReport: validation
  });

  return {
    isCadSupported: true,
    approvalVerification,
    pieces,
    validation,
    pipelineReport
  };
}
