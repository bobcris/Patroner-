/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner P1-2A / P1-2B — Authoritative Production Workspace Bundle
 *
 * Single deterministic orchestration layer consumed by both:
 *  - Module 04 (`PatternWorkspace.tsx`)
 *  - Module 05 (`ProductionOverview.tsx`)
 *
 * Enforces:
 *  1. One authoritative computation for drafting pieces, category grading policy,
 *     multi-size grading (bodice-only; strictly null/undefined for skirt & unsupported),
 *     M05 production package generation, dependency pipeline evaluation, and export
 *     prerequisite validation.
 *  2. Zero divergence between Module 04 and Module 05 for identical inputs, shared BOM
 *     controls, and governance options.
 *  3. Explicit category boundaries: Skirt uses `single-size-ungraded` export policy and
 *     never invokes `gradePattern` / `gradeBodice` (multi-size skirt grading deferred to P1-3).
 *  4. Fail-closed governance preserved unconditionally (`isProductionReady: false`,
 *     `externalCadInteroperabilityVerified: false`).
 */

import {
  BodiceDartStyle,
  BodyMeasurements,
  DesignSpecification,
  GarmentCategory,
  PatternPiece,
  SleeveEaseStrategy,
  ValidationReport
} from '../../types';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSleeveBlock, SleeveDiagnostics } from '../drafting/sleeve-block';
import { validatePatternDraft } from '../validation/seam-validator';
import { assembleBodiceSleeve, BodiceSleeveAssemblyResult } from '../assembly';
import { digestCanonicalPayload } from '../assembly/sha256';
import { getEnhancedFabricById, DEFAULT_ILLUSTRATIVE_FABRIC } from '../fabric/fabric-presets';
import {
  DEFAULT_SIZE_RANGE,
  GradedPatternSet,
  isMultiSizeGradingSupportedCategory
} from '../grading';
import {
  getUnsupportedCategoryMessage,
  isCadDraftingSupportedCategory,
  SafeSpecificationApprovalResult,
  SafeWorkspacePipelineResult,
  evaluateSpecPipelineSafely
} from './category-support';
import {
  ExportGradingPolicy,
  ProductionExportValidationResult,
  PipelineIntegrityReport
} from './dependency-types';
import {
  validateProductionExportPrerequisites
} from './dependency-invalidation';
import { buildM05ProductionPackage } from './production-engineering';
import { M05ProductionPackageBundle } from './production-engineering-types';
import {
  AuthoritativeGradingArtifact,
  AuthoritativePatternRevision,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementProvenanceEvidence
} from './production-types';

export interface ProductionWorkspaceBomControls {
  readonly fabricRollWidthCm: number;
  readonly markerWasteFactor: number;
  readonly orderQuantityPerSize: number;
  readonly includeLining: boolean;
  readonly includeLabelsAndPackaging: boolean;
}

export const DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS: ProductionWorkspaceBomControls = {
  fabricRollWidthCm: 140,
  markerWasteFactor: 0.18,
  orderQuantityPerSize: 1,
  includeLining: false,
  includeLabelsAndPackaging: false
};

export interface ProductionWorkspaceGovernanceOptions {
  readonly bodiceDartStyle: BodiceDartStyle;
  readonly sleeveEaseStrategy: SleeveEaseStrategy;
  readonly strictUncertaintyGate: boolean;
  readonly requireApprovedGovernance: boolean;
  readonly measurementProvenance: MeasurementOrigin;
  readonly measurementApprovalState: MeasurementApprovalStatus;
  readonly measurementProvenanceEvidence?: MeasurementProvenanceEvidence;
}

export const DEFAULT_PRODUCTION_WORKSPACE_GOVERNANCE: ProductionWorkspaceGovernanceOptions = {
  bodiceDartStyle: 'waist',
  sleeveEaseStrategy: 'classic',
  strictUncertaintyGate: true,
  requireApprovedGovernance: false,
  measurementProvenance: 'standard-chart',
  measurementApprovalState: 'unverified'
};

export type CategoryGradingPolicyMode =
  | 'graded-multi-size'
  | 'single-size-ungraded'
  | 'unsupported';

export interface CategoryGradingPolicy {
  readonly garmentCategory: GarmentCategory;
  readonly isCadSupported: boolean;
  readonly supportsMultiSizeGrading: boolean;
  readonly policyMode: CategoryGradingPolicyMode;
  readonly policyLabel: string;
  readonly nonGradingReason?: string;
  readonly requiredSizes: readonly string[];
  readonly exportGradingPolicy: ExportGradingPolicy | null;
  readonly deferredNote?: string;
}

export const SKIRT_SINGLE_SIZE_UNGRADED_REASON =
  'Skirt multi-size grading is not implemented yet (deferred to P1-3); authoritative single-size ungraded scope applies.';

/**
 * Resolves the authoritative category grading & export policy for a garment category and active size.
 * Ensures skirt specs strictly use `single-size-ungraded` and never claim bodice multi-size grading.
 */
export function resolveCategoryGradingPolicy(
  garmentCategory: GarmentCategory,
  activeSize: string
): CategoryGradingPolicy {
  const isCadSupported = isCadDraftingSupportedCategory(garmentCategory);
  if (!isCadSupported) {
    return {
      garmentCategory,
      isCadSupported: false,
      supportsMultiSizeGrading: false,
      policyMode: 'unsupported',
      policyLabel: `Unsupported Category (${garmentCategory}) — Fail-Closed`,
      nonGradingReason: getUnsupportedCategoryMessage(String(garmentCategory)),
      requiredSizes: [],
      exportGradingPolicy: null
    };
  }

  if (isMultiSizeGradingSupportedCategory(garmentCategory)) {
    return {
      garmentCategory,
      isCadSupported: true,
      supportsMultiSizeGrading: true,
      policyMode: 'graded-multi-size',
      policyLabel: 'Multi-Size Graded Scope (XS–XXL)',
      requiredSizes: [...DEFAULT_SIZE_RANGE],
      exportGradingPolicy: {
        mode: 'graded-multi-size',
        requiredSizes: [...DEFAULT_SIZE_RANGE]
      }
    };
  }

  return {
    garmentCategory,
    isCadSupported: true,
    supportsMultiSizeGrading: false,
    policyMode: 'single-size-ungraded',
    policyLabel: `Single-Size Ungraded Scope (${activeSize} — Multi-Size Grading Deferred to P1-3)`,
    nonGradingReason: SKIRT_SINGLE_SIZE_UNGRADED_REASON,
    requiredSizes: [activeSize],
    exportGradingPolicy: {
      mode: 'single-size-ungraded',
      requiredSizes: [activeSize],
      nonGradingReason: SKIRT_SINGLE_SIZE_UNGRADED_REASON
    },
    deferredNote:
      'Multi-size skirt grading is intentionally deferred to P1-3. Skirt projects never invoke bodice grading or synthesize bodice geometry.'
  };
}

export interface PreviousPackageRevisionInput {
  readonly sourceSpecificationFingerprint?: string;
  readonly sourceMeasurementFingerprint?: string;
  readonly basePatternFingerprint?: string;
  readonly patternRevisionId?: string | null;
  readonly gradingControlsFingerprint?: string;
  readonly gradingReportSha256Hex?: string | null;
  readonly bomFingerprint?: string;
}

export interface BuildAuthoritativeProductionWorkspaceInput {
  readonly projectId?: string;
  readonly tenantId?: string;
  readonly designSpec: DesignSpecification;
  readonly measurements: BodyMeasurements;
  readonly activeSize: string;
  readonly bomControls?: Partial<ProductionWorkspaceBomControls>;
  readonly governance?: Partial<ProductionWorkspaceGovernanceOptions>;
  readonly previousPackageRevision?: PreviousPackageRevisionInput;
  readonly createdAt?: string;
}

export interface WorkspaceUpstreamStalenessSummary {
  readonly isStaleAgainstPrevious: boolean;
  readonly staleReasons: readonly string[];
  readonly sourceSpecificationFingerprint: string | null;
  readonly sourceMeasurementFingerprint: string | null;
  readonly basePatternFingerprint: string | null;
  readonly patternRevisionId: string | null;
  readonly gradingControlsFingerprint: string | null;
  readonly gradingReportSha256Hex: string | null;
  readonly bomFingerprint: string | null;
}

export interface AuthoritativeProductionWorkspaceBundle {
  readonly inputSignature: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly activeSize: string;
  readonly categoryPolicy: CategoryGradingPolicy;
  readonly isCadSupported: boolean;
  readonly unsupportedReason?: string;
  readonly bomControls: ProductionWorkspaceBomControls;
  readonly governance: ProductionWorkspaceGovernanceOptions;
  readonly pieces: readonly PatternPiece[];
  readonly sleeveDiagnostics: SleeveDiagnostics | undefined;
  readonly sleeveError: string | null;
  readonly assemblyResult: BodiceSleeveAssemblyResult | undefined;
  readonly draftValidation: ValidationReport;
  readonly gradedPatternSet: GradedPatternSet | null;
  readonly m05Package: M05ProductionPackageBundle | null;
  readonly liveSnapshot: AuthoritativePatternRevision | null;
  readonly liveGradingArtifact: AuthoritativeGradingArtifact | undefined;
  readonly gradingArtifactError: string | null;
  readonly safePipeline: SafeWorkspacePipelineResult;
  readonly approvalVerification: SafeSpecificationApprovalResult;
  readonly pipelineReport: PipelineIntegrityReport;
  readonly exportValidation: ProductionExportValidationResult;
  readonly upstreamStaleness: WorkspaceUpstreamStalenessSummary;
  readonly isProductionReady: false;
  readonly externalCadInteroperabilityVerified: false;
}

function normalizeBomControls(
  overrides?: Partial<ProductionWorkspaceBomControls>
): ProductionWorkspaceBomControls {
  return {
    fabricRollWidthCm:
      overrides?.fabricRollWidthCm ?? DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS.fabricRollWidthCm,
    markerWasteFactor:
      overrides?.markerWasteFactor ?? DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS.markerWasteFactor,
    orderQuantityPerSize: Math.max(
      1,
      Math.round(
        overrides?.orderQuantityPerSize ??
          DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS.orderQuantityPerSize
      )
    ),
    includeLining:
      overrides?.includeLining ?? DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS.includeLining,
    includeLabelsAndPackaging:
      overrides?.includeLabelsAndPackaging ??
      DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS.includeLabelsAndPackaging
  };
}

function normalizeGovernanceOptions(
  designSpec: DesignSpecification,
  overrides?: Partial<ProductionWorkspaceGovernanceOptions>
): ProductionWorkspaceGovernanceOptions {
  return {
    bodiceDartStyle:
      overrides?.bodiceDartStyle ??
      designSpec.dartStyle ??
      DEFAULT_PRODUCTION_WORKSPACE_GOVERNANCE.bodiceDartStyle,
    sleeveEaseStrategy:
      overrides?.sleeveEaseStrategy ??
      designSpec.sleeveEaseStrategy ??
      DEFAULT_PRODUCTION_WORKSPACE_GOVERNANCE.sleeveEaseStrategy,
    strictUncertaintyGate:
      overrides?.strictUncertaintyGate ??
      DEFAULT_PRODUCTION_WORKSPACE_GOVERNANCE.strictUncertaintyGate,
    requireApprovedGovernance:
      overrides?.requireApprovedGovernance ??
      DEFAULT_PRODUCTION_WORKSPACE_GOVERNANCE.requireApprovedGovernance,
    measurementProvenance:
      overrides?.measurementProvenance ??
      DEFAULT_PRODUCTION_WORKSPACE_GOVERNANCE.measurementProvenance,
    measurementApprovalState:
      overrides?.measurementApprovalState ??
      DEFAULT_PRODUCTION_WORKSPACE_GOVERNANCE.measurementApprovalState,
    measurementProvenanceEvidence: overrides?.measurementProvenanceEvidence
  };
}

/**
 * Builds the single authoritative deterministic production workspace bundle shared across
 * Module 04 (Pattern Workspace) and Module 05 (Production Engineering).
 */
export function buildAuthoritativeProductionWorkspaceBundle(
  input: BuildAuthoritativeProductionWorkspaceInput
): AuthoritativeProductionWorkspaceBundle {
  const projectId = input.projectId ?? 'project-patroner-default';
  const tenantId = input.tenantId ?? 'tenant-studio-local';
  const { designSpec, measurements, activeSize } = input;
  const bomControls = normalizeBomControls(input.bomControls);
  const governance = normalizeGovernanceOptions(designSpec, input.governance);

  const categoryPolicy = resolveCategoryGradingPolicy(designSpec.garmentCategory, activeSize);

  const enhancedFabricLookup = getEnhancedFabricById(designSpec.fabric.id);
  const resolvedFabric =
    enhancedFabricLookup.status === 'found'
      ? enhancedFabricLookup.fabric
      : DEFAULT_ILLUSTRATIVE_FABRIC;

  const inputSignature = digestCanonicalPayload(
    {
      projectId,
      tenantId,
      activeSize,
      designSpec,
      measurements,
      bomControls,
      governance: {
        bodiceDartStyle: governance.bodiceDartStyle,
        sleeveEaseStrategy: governance.sleeveEaseStrategy,
        strictUncertaintyGate: governance.strictUncertaintyGate,
        requireApprovedGovernance: governance.requireApprovedGovernance,
        measurementProvenance: governance.measurementProvenance,
        measurementApprovalState: governance.measurementApprovalState,
        measurementProvenanceEvidence: governance.measurementProvenanceEvidence ?? null
      }
    },
    { requireNonEmptyObject: true }
  ).sha256Hex;

  // Fail closed immediately for unsupported categories (e.g., trouser, dress)
  if (!categoryPolicy.isCadSupported) {
    const unsupportedReason = getUnsupportedCategoryMessage(String(designSpec.garmentCategory));
    const safePipeline = evaluateSpecPipelineSafely({
      specification: designSpec,
      measurements,
      measurementApprovalState: governance.measurementApprovalState,
      measurementProvenance: governance.measurementProvenance,
      activeSize,
      fabric: resolvedFabric
    });

    const exportValidation: ProductionExportValidationResult = {
      isExportPermitted: false,
      blockingArtifacts: ['art-specification'],
      rejectionCode: 'SPECIFICATION_INVALID',
      rejectionReason: unsupportedReason
    };

    return {
      inputSignature,
      projectId,
      tenantId,
      activeSize,
      categoryPolicy,
      isCadSupported: false,
      unsupportedReason,
      bomControls,
      governance,
      pieces: [],
      sleeveDiagnostics: undefined,
      sleeveError: null,
      assemblyResult: undefined,
      draftValidation: safePipeline.validation,
      gradedPatternSet: null,
      m05Package: null,
      liveSnapshot: null,
      liveGradingArtifact: undefined,
      gradingArtifactError: null,
      safePipeline,
      approvalVerification: safePipeline.approvalVerification,
      pipelineReport: safePipeline.pipelineReport,
      exportValidation,
      upstreamStaleness: {
        isStaleAgainstPrevious: false,
        staleReasons: [],
        sourceSpecificationFingerprint: null,
        sourceMeasurementFingerprint: null,
        basePatternFingerprint: null,
        patternRevisionId: null,
        gradingControlsFingerprint: null,
        gradingReportSha256Hex: null,
        bomFingerprint: null
      },
      isProductionReady: false,
      externalCadInteroperabilityVerified: false
    };
  }

  // 1. Deterministic active-size piece drafting
  let pieces: PatternPiece[] = [];
  let sleeveDiagnostics: SleeveDiagnostics | undefined = undefined;
  let sleeveError: string | null = null;

  if (designSpec.garmentCategory === 'bodice') {
    const bodicePieces = draftBodiceBlock(measurements, designSpec, {
      dartStyle: governance.bodiceDartStyle
    });
    try {
      const sleeveResult = draftSleeveBlock(measurements, designSpec, {
        strategy: governance.sleeveEaseStrategy,
        bodicePieces
      });
      pieces = [...bodicePieces, sleeveResult.piece];
      sleeveDiagnostics = sleeveResult.diagnostics;
    } catch (err) {
      pieces = bodicePieces;
      sleeveError =
        err instanceof Error ? err.message : 'Unable to draft sleeve for current measurements.';
    }
  } else {
    // Skirt deterministic base block (single-size active draft)
    pieces = draftSkirtBlock(measurements, designSpec);
  }

  // 2. Bodice–Sleeve Assembly (M04.3 — bodice only)
  let assemblyResult: BodiceSleeveAssemblyResult | undefined = undefined;
  if (designSpec.garmentCategory === 'bodice' && pieces.length >= 3) {
    try {
      assemblyResult = assembleBodiceSleeve({
        bodicePieces: pieces.slice(0, 2),
        sleevePiece: pieces[2],
        designSpec,
        measurements,
        options: {
          strategy: governance.sleeveEaseStrategy,
          strictUncertaintyGate: governance.strictUncertaintyGate,
          measurementProvenance: governance.measurementProvenance,
          measurementApprovalState: governance.measurementApprovalState,
          requireApprovedGovernance: governance.requireApprovedGovernance
        }
      });
    } catch {
      assemblyResult = undefined;
    }
  }

  const draftValidation = validatePatternDraft(pieces);

  // 3. Authoritative M05 Production Package (single computation shared by M04 & M05)
  // Bodice runs multi-size grading (XS–XXL); skirt strictly passes gradedPatternSetOverride: null
  // so skirt NEVER invokes gradePattern / gradeBodice.
  const orderQuantitiesBySize: Record<string, number> = {};
  for (const sz of categoryPolicy.requiredSizes) {
    orderQuantitiesBySize[sz] = bomControls.orderQuantityPerSize;
  }

  const m05Package = buildM05ProductionPackage({
    designSpec,
    measurements,
    piecesOverride: pieces,
    assemblyResultOverride: assemblyResult,
    gradedPatternSetOverride: categoryPolicy.supportsMultiSizeGrading ? undefined : null,
    options: {
      projectId,
      tenantId,
      createdAt: input.createdAt,
      activeSize,
      requiredSizes: [...categoryPolicy.requiredSizes],
      bodiceDartStyle: governance.bodiceDartStyle,
      sleeveEaseStrategy: governance.sleeveEaseStrategy,
      strictUncertaintyGate: governance.strictUncertaintyGate,
      measurementProvenance: governance.measurementProvenance,
      measurementApprovalState: governance.measurementApprovalState,
      measurementProvenanceEvidence: governance.measurementProvenanceEvidence,
      requireApprovedGovernance: governance.requireApprovedGovernance,
      bomOptions: {
        fabricRollWidthCm: bomControls.fabricRollWidthCm,
        markerWasteFactor: bomControls.markerWasteFactor,
        includeLining: bomControls.includeLining,
        includeLabelsAndPackaging: bomControls.includeLabelsAndPackaging,
        orderQuantitiesBySize
      },
      previousPackageRevision: input.previousPackageRevision
    }
  });

  const gradedPatternSet: GradedPatternSet | null = categoryPolicy.supportsMultiSizeGrading
    ? m05Package.gradedPatternSet
    : null;

  const liveSnapshot: AuthoritativePatternRevision | null = m05Package.patternRevision;

  // 4. Single Authoritative Grading Artifact owned exclusively by buildM05ProductionPackage
  // Strictly undefined for skirt / single-size categories; fail-closed error preserved transparently.
  const liveGradingArtifact: AuthoritativeGradingArtifact | undefined =
    categoryPolicy.supportsMultiSizeGrading && m05Package.gradingArtifact
      ? m05Package.gradingArtifact
      : undefined;
  const gradingArtifactError: string | null = categoryPolicy.supportsMultiSizeGrading
    ? m05Package.gradingArtifactError
    : null;

  // 5. Dependency Pipeline Evaluation (aligned with authoritative exportGradingPolicy)
  const safePipeline = evaluateSpecPipelineSafely({
    specification: designSpec,
    measurements,
    measurementApprovalState: governance.measurementApprovalState,
    measurementProvenance: governance.measurementProvenance,
    activeSize,
    fabric: resolvedFabric,
    productionSnapshot: liveSnapshot ?? undefined,
    gradingArtifact: liveGradingArtifact,
    exportGradingPolicy: categoryPolicy.exportGradingPolicy ?? undefined
  });

  // 6. Export Prerequisite Validation (matches M05 package & category grading policy identically;
  // also blocks export whenever upstream changes have invalidated the committed package baseline)
  const rawExportValidation = validateProductionExportPrerequisites(
    safePipeline.pipelineReport,
    liveSnapshot ?? undefined,
    {
      specification: designSpec,
      measurements,
      measurementApprovalState: governance.measurementApprovalState,
      measurementProvenance: governance.measurementProvenance,
      fabric: resolvedFabric,
      patternPieces: pieces,
      validationReport: draftValidation,
      gradingArtifact: liveGradingArtifact,
      exportGradingPolicy: categoryPolicy.exportGradingPolicy ?? undefined
    }
  );

  const exportValidation: ProductionExportValidationResult =
    m05Package.upstreamRevisionTracking.isStaleAgainstPrevious
      ? {
          isExportPermitted: false,
          blockingArtifacts: Array.from(
            new Set([...rawExportValidation.blockingArtifacts, 'art-production-export'])
          ),
          rejectionCode: 'UPSTREAM_STAGE_STALE',
          rejectionReason:
            m05Package.upstreamRevisionTracking.staleReasons[0] ??
            'Production package is stale relative to committed upstream baseline and must be re-synchronized before export.'
        }
      : gradingArtifactError
      ? {
          isExportPermitted: false,
          blockingArtifacts: Array.from(
            new Set([...rawExportValidation.blockingArtifacts, 'art-grading'])
          ),
          rejectionCode: 'GRADING_VALIDATION_FAILED',
          rejectionReason: `Authoritative grading artifact creation failed: ${gradingArtifactError}`
        }
      : rawExportValidation;

  return {
    inputSignature,
    projectId,
    tenantId,
    activeSize,
    categoryPolicy,
    isCadSupported: true,
    bomControls,
    governance,
    pieces,
    sleeveDiagnostics,
    sleeveError,
    assemblyResult,
    draftValidation,
    gradedPatternSet,
    m05Package,
    liveSnapshot,
    liveGradingArtifact,
    gradingArtifactError,
    safePipeline,
    approvalVerification: safePipeline.approvalVerification,
    pipelineReport: safePipeline.pipelineReport,
    exportValidation,
    upstreamStaleness: {
      isStaleAgainstPrevious: m05Package.upstreamRevisionTracking.isStaleAgainstPrevious,
      staleReasons: m05Package.upstreamRevisionTracking.staleReasons,
      sourceSpecificationFingerprint:
        m05Package.upstreamRevisionTracking.sourceSpecificationFingerprint,
      sourceMeasurementFingerprint:
        m05Package.upstreamRevisionTracking.sourceMeasurementFingerprint,
      basePatternFingerprint: m05Package.upstreamRevisionTracking.basePatternFingerprint,
      patternRevisionId: m05Package.upstreamRevisionTracking.patternRevisionId,
      gradingControlsFingerprint:
        m05Package.upstreamRevisionTracking.gradingControlsFingerprint,
      gradingReportSha256Hex: m05Package.upstreamRevisionTracking.gradingReportSha256Hex,
      bomFingerprint: m05Package.upstreamRevisionTracking.bomFingerprint
    },
    isProductionReady: false,
    externalCadInteroperabilityVerified: false
  };
}
