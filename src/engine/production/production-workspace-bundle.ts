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
import {
  buildCanonicalProductionPackagePayload,
  buildM05ProductionPackage,
  serializeDeterministicProductionBundle
} from './production-engineering';
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

/**
 * N-05: Category-isolated circumference ease girth rows for Module 05 Ease Allocation Matrix.
 * Bodice garments evaluate Bust, Waist, and Low Hip; Skirt garments strictly evaluate Waist
 * and Low Hip only (never leaking upper-body Bust Circumference rows into Skirt views).
 */
export type ApplicableEaseGirthKey = 'bust' | 'waist' | 'lowHip';

export function getApplicableEaseGirthsForCategory(
  garmentCategory: GarmentCategory
): readonly ApplicableEaseGirthKey[] {
  if (garmentCategory === 'bodice') {
    return ['bust', 'waist', 'lowHip'];
  }
  return ['waist', 'lowHip'];
}

export interface ProductionPackageExportGateResult {
  readonly canExportDxfRelease: boolean;
  readonly canExportCanonicalReleaseJson: boolean;
  readonly canExportDiagnosticSnapshot: boolean;
  readonly dxfBlockingReasons: readonly string[];
  readonly canonicalJsonBlockingReasons: readonly string[];
  readonly rejectionCode: string | null;
  readonly summaryReason: string | null;
}

export interface GuardedExportExecutionResult {
  readonly permitted: boolean;
  readonly filename?: string;
  readonly payloadText?: string;
  readonly rejectionCode: string | null;
  readonly blockingReasons: readonly string[];
}

export interface DiagnosticNonReleaseJsonArtifact {
  readonly filename: string;
  readonly payloadText: string;
  readonly artifactClass: 'DIAGNOSTIC_NON_RELEASE_SNAPSHOT';
  readonly isApprovedProductionArtifact: false;
  readonly releaseExportPermitted: boolean;
}

export interface BaselineCommitEligibilityResult {
  readonly canCommitProductionBaseline: boolean;
  readonly canSyncWorkingDraftSnapshot: boolean;
  readonly hasNonStalenessValidationFailures: boolean;
  readonly productionBaselineBlockingReasons: readonly string[];
  readonly workingDraftBlockingReasons: readonly string[];
}

export type BaselineCommitMode = 'production-baseline' | 'working-draft-diagnostic';

export interface GuardedBaselineCommitResult {
  readonly committed: boolean;
  readonly mode: BaselineCommitMode;
  readonly baseline?: PreviousPackageRevisionInput;
  readonly rejectionCode: string | null;
  readonly blockingReasons: readonly string[];
}

/**
 * N-04: Authoritative fail-closed production release export gate evaluator.
 * Enforces staleness, 10-gate M05 validation, grading artifact integrity,
 * pipeline/revision export validation, and DXF round-trip & revision binding.
 */
export function evaluateProductionPackageExportGate(params: {
  readonly bundle: M05ProductionPackageBundle | null;
  readonly exportValidation: ProductionExportValidationResult | null | undefined;
}): ProductionPackageExportGateResult {
  const { bundle, exportValidation } = params;
  if (!bundle) {
    const reason = 'Production package bundle is unavailable for this garment category.';
    return {
      canExportDxfRelease: false,
      canExportCanonicalReleaseJson: false,
      canExportDiagnosticSnapshot: false,
      dxfBlockingReasons: [reason],
      canonicalJsonBlockingReasons: [reason],
      rejectionCode: 'PACKAGE_UNAVAILABLE',
      summaryReason: reason
    };
  }

  const sharedBlockingReasons: string[] = [];
  let firstCode: string | null = null;
  const addShared = (code: string, reason: string) => {
    if (!firstCode) firstCode = code;
    sharedBlockingReasons.push(reason);
  };

  if (bundle.upstreamRevisionTracking.isStaleAgainstPrevious) {
    addShared(
      'UPSTREAM_STAGE_STALE',
      bundle.upstreamRevisionTracking.staleReasons[0] ??
        'Production package is stale relative to upstream baseline.'
    );
  }

  if (!bundle.validation.isValid || bundle.validation.failedCount > 0) {
    const failingSummary =
      bundle.validation.blockingErrors.length > 0
        ? bundle.validation.blockingErrors.join(' | ')
        : `${bundle.validation.failedCount} blocking validation gate(s) failed.`;
    addShared('M05_VALIDATION_FAILED', `M05 validation failed: ${failingSummary}`);
  }

  if (bundle.gradingArtifactError !== null) {
    addShared(
      'GRADING_VALIDATION_FAILED',
      `Authoritative grading artifact failed: ${bundle.gradingArtifactError}`
    );
  }

  if (!exportValidation) {
    addShared(
      'EXPORT_VALIDATION_MISSING',
      'Authoritative pipeline export validation context is missing (fail-closed).'
    );
  } else if (!exportValidation.isExportPermitted) {
    addShared(
      exportValidation.rejectionCode ?? 'EXPORT_NOT_PERMITTED',
      `[${exportValidation.rejectionCode ?? 'EXPORT_NOT_PERMITTED'}] ${exportValidation.rejectionReason}`
    );
  }

  const dxfBlockingReasons = [...sharedBlockingReasons];
  let dxfCode: string | null = firstCode;
  const addDxf = (code: string, reason: string) => {
    if (!dxfCode) dxfCode = code;
    dxfBlockingReasons.push(reason);
  };

  if (!bundle.dxfExport) {
    addDxf('DXF_ARTIFACT_MISSING', 'DXF-AAMA export artifact is unavailable.');
  } else {
    if (!bundle.dxfExport.roundTrip.allPassed) {
      addDxf(
        'DXF_ROUND_TRIP_FAILED',
        'DXF-AAMA synthetic round-trip verification failed.'
      );
    }
    if (!bundle.patternRevision) {
      addDxf(
        'DXF_REVISION_MISSING',
        'Authoritative pattern revision is missing for DXF lineage verification.'
      );
    } else {
      if (bundle.dxfExport.artifact.sourceRevisionId !== bundle.patternRevision.revisionId) {
        addDxf(
          'DXF_REVISION_MISMATCH',
          `DXF source revision '${bundle.dxfExport.artifact.sourceRevisionId}' does not match active pattern revision '${bundle.patternRevision.revisionId}'.`
        );
      }
      if (
        bundle.dxfExport.artifact.sourceContentFingerprint &&
        bundle.dxfExport.artifact.sourceContentFingerprint !==
          bundle.patternRevision.basePatternFingerprint
      ) {
        addDxf(
          'DXF_FINGERPRINT_MISMATCH',
          'DXF source content fingerprint does not match active base pattern geometry fingerprint.'
        );
      }
    }
  }

  const canExportCanonicalReleaseJson = sharedBlockingReasons.length === 0;
  const canExportDxfRelease = dxfBlockingReasons.length === 0;
  const rejectionCode = canExportDxfRelease ? null : (dxfCode ?? firstCode ?? 'EXPORT_BLOCKED');
  const summaryReason =
    dxfBlockingReasons[0] ?? sharedBlockingReasons[0] ?? null;

  return {
    canExportDxfRelease,
    canExportCanonicalReleaseJson,
    canExportDiagnosticSnapshot: true,
    dxfBlockingReasons,
    canonicalJsonBlockingReasons: sharedBlockingReasons,
    rejectionCode,
    summaryReason
  };
}

/**
 * N-04: Direct-handler enforced DXF-AAMA release export executor.
 * Never relies solely on UI disabled state; blocks emission directly whenever any gate fails.
 */
export function executeGuardedDxfReleaseExport(params: {
  readonly bundle: M05ProductionPackageBundle | null;
  readonly exportValidation: ProductionExportValidationResult | null | undefined;
  readonly onEmit?: (payloadText: string, filename: string) => void;
}): GuardedExportExecutionResult {
  const gate = evaluateProductionPackageExportGate({
    bundle: params.bundle,
    exportValidation: params.exportValidation
  });
  if (!gate.canExportDxfRelease || !params.bundle?.dxfExport) {
    return {
      permitted: false,
      rejectionCode: gate.rejectionCode ?? 'EXPORT_BLOCKED',
      blockingReasons: gate.dxfBlockingReasons
    };
  }
  const filename = `${params.bundle.dxfExport.artifact.exportId}.dxf`;
  const payloadText = params.bundle.dxfExport.artifact.dxfText;
  params.onEmit?.(payloadText, filename);
  return {
    permitted: true,
    filename,
    payloadText,
    rejectionCode: null,
    blockingReasons: []
  };
}

/**
 * N-04: Direct-handler enforced Canonical Production Release JSON export executor.
 * Refuses emission whenever staleness, validation, grading, or export prerequisites block release.
 */
export function executeGuardedCanonicalReleaseJsonExport(params: {
  readonly bundle: M05ProductionPackageBundle | null;
  readonly exportValidation: ProductionExportValidationResult | null | undefined;
  readonly onEmit?: (payloadText: string, filename: string) => void;
}): GuardedExportExecutionResult {
  const gate = evaluateProductionPackageExportGate({
    bundle: params.bundle,
    exportValidation: params.exportValidation
  });
  if (!gate.canExportCanonicalReleaseJson || !params.bundle) {
    return {
      permitted: false,
      rejectionCode: gate.rejectionCode ?? 'EXPORT_BLOCKED',
      blockingReasons: gate.canonicalJsonBlockingReasons
    };
  }
  const filename = `${params.bundle.packageId}-${params.bundle.activeSize}.canonical.json`;
  const payloadText = serializeDeterministicProductionBundle(params.bundle);
  params.onEmit?.(payloadText, filename);
  return {
    permitted: true,
    filename,
    payloadText,
    rejectionCode: null,
    blockingReasons: []
  };
}

/**
 * N-04: Builds a clearly labeled Non-Release Diagnostic Snapshot JSON for debugging/auditing
 * blocked or unapproved packages without misrepresenting them as production release artifacts.
 */
export function buildDiagnosticProductionPackageJson(
  bundle: M05ProductionPackageBundle,
  exportValidation: ProductionExportValidationResult | null | undefined
): DiagnosticNonReleaseJsonArtifact {
  const gate = evaluateProductionPackageExportGate({ bundle, exportValidation });
  const diagnosticEnvelope = {
    artifactClass: 'DIAGNOSTIC_NON_RELEASE_SNAPSHOT' as const,
    isApprovedProductionArtifact: false as const,
    isProductionReady: false as const,
    releaseExportPermitted: gate.canExportCanonicalReleaseJson,
    releaseRejectionCode: gate.rejectionCode,
    releaseBlockingReasons: gate.canonicalJsonBlockingReasons,
    canonicalContentDigest: bundle.canonicalContentDigest,
    engineeringContentDigest: bundle.engineeringContentDigest,
    packagePayload: buildCanonicalProductionPackagePayload(bundle)
  };
  return {
    filename: `${bundle.packageId}-${bundle.activeSize}.diagnostic-non-release.json`,
    payloadText: JSON.stringify(diagnosticEnvelope, null, 2),
    artifactClass: 'DIAGNOSTIC_NON_RELEASE_SNAPSHOT',
    isApprovedProductionArtifact: false,
    releaseExportPermitted: gate.canExportCanonicalReleaseJson
  };
}

/**
 * N-04: Evaluates whether a workspace bundle is eligible to commit as an approved production
 * baseline vs synchronized only as a non-approved local working-draft snapshot.
 *
 * Critical safety guarantees:
 * - A package with ANY non-staleness validation failure (e.g., Gate 6 XXL failure, invalid
 *   geometry, invalid grading, invalid BOM, missing/invalidated revision) can NEVER commit a
 *   production baseline AND can NEVER sync a working-draft snapshot.
 * - An unapproved package (`PATTERN_REVISION_NOT_APPROVED`, unapproved measurements, etc.)
 *   can NEVER commit a production baseline (`canCommitProductionBaseline: false`).
 * - Syncing a working-draft snapshot NEVER satisfies approval gates and can NEVER turn a
 *   blocked package into an exportable release artifact.
 */
export function evaluateBaselineCommitEligibility(params: {
  readonly isCadSupported: boolean;
  readonly draftValidation: ValidationReport;
  readonly m05Package: M05ProductionPackageBundle | null;
  readonly rawExportValidation: ProductionExportValidationResult;
}): BaselineCommitEligibilityResult {
  const { isCadSupported, draftValidation, m05Package, rawExportValidation } = params;
  const workingDraftBlockingReasons: string[] = [];

  if (!isCadSupported || !m05Package) {
    workingDraftBlockingReasons.push(
      'Garment category is unsupported or M05 production package is unavailable.'
    );
  } else {
    if (!draftValidation.isValid || draftValidation.failureCount > 0) {
      workingDraftBlockingReasons.push(
        `Draft pattern geometry validation failed (${draftValidation.failureCount} failure(s)).`
      );
    }

    if (m05Package.gradingArtifactError !== null) {
      workingDraftBlockingReasons.push(
        `Authoritative grading artifact failed: ${m05Package.gradingArtifactError}`
      );
    }

    if (!m05Package.bom || m05Package.bom.lineItems.length === 0) {
      workingDraftBlockingReasons.push('Bill of Materials (BOM) is empty or invalid.');
    }

    if (
      !m05Package.patternRevision ||
      !m05Package.patternRevision.revisionId.trim() ||
      m05Package.patternRevision.currentLifecycleState === 'invalidated' ||
      m05Package.patternRevision.currentLifecycleState === 'superseded'
    ) {
      workingDraftBlockingReasons.push(
        'Authoritative pattern revision is missing, invalidated, or superseded.'
      );
    }

    if (!m05Package.sheetSet || !m05Package.sheetSet.validation.isValid) {
      workingDraftBlockingReasons.push(
        'Authoritative piece production sheet set is missing or invalid.'
      );
    }

    for (const diag of m05Package.validation.diagnostics) {
      if (diag.status !== 'fail') continue;
      if (diag.checkId === 'invalid-or-stale-revision') {
        // Gate 10 failure NOT caused purely by staleness against previous baseline (e.g., gradingBoundaryErrors)
        if (!m05Package.upstreamRevisionTracking.isStaleAgainstPrevious) {
          workingDraftBlockingReasons.push(`[${diag.checkId}] ${diag.message}`);
        }
        continue;
      }
      workingDraftBlockingReasons.push(`[${diag.checkId}] ${diag.message}`);
    }
  }

  const hasNonStalenessValidationFailures = workingDraftBlockingReasons.length > 0;
  const productionBaselineBlockingReasons = [...workingDraftBlockingReasons];

  if (!rawExportValidation.isExportPermitted) {
    productionBaselineBlockingReasons.push(
      `[${rawExportValidation.rejectionCode ?? 'EXPORT_NOT_PERMITTED'}] ${rawExportValidation.rejectionReason}`
    );
  }

  return {
    canCommitProductionBaseline:
      productionBaselineBlockingReasons.length === 0 && rawExportValidation.isExportPermitted,
    canSyncWorkingDraftSnapshot: !hasNonStalenessValidationFailures,
    hasNonStalenessValidationFailures,
    productionBaselineBlockingReasons,
    workingDraftBlockingReasons
  };
}

/**
 * Extracts deterministic upstream revision fingerprints for baseline synchronization.
 */
export function extractRevisionBaselineFromBundle(
  bundle: AuthoritativeProductionWorkspaceBundle
): PreviousPackageRevisionInput | undefined {
  if (!bundle.isCadSupported || !bundle.m05Package) return undefined;
  const tracking = bundle.m05Package.upstreamRevisionTracking;
  return {
    sourceSpecificationFingerprint: tracking.sourceSpecificationFingerprint,
    sourceMeasurementFingerprint: tracking.sourceMeasurementFingerprint,
    basePatternFingerprint: tracking.basePatternFingerprint ?? undefined,
    patternRevisionId: tracking.patternRevisionId,
    gradingControlsFingerprint: tracking.gradingControlsFingerprint,
    gradingReportSha256Hex: tracking.gradingReportSha256Hex,
    bomFingerprint: tracking.bomFingerprint
  };
}

/**
 * N-04: Direct-handler enforced baseline commit / working-draft snapshot executor.
 * Re-evaluates eligibility fail-closed before committing state so direct handler invocation
 * cannot bypass UI disabled states or commit failing/unapproved packages as production baselines.
 */
export function executeGuardedBaselineCommit(params: {
  readonly workspaceBundle: AuthoritativeProductionWorkspaceBundle;
  readonly mode: BaselineCommitMode;
  readonly onCommit?: (baseline: PreviousPackageRevisionInput) => void;
}): GuardedBaselineCommitResult {
  const { workspaceBundle, mode, onCommit } = params;
  const eligibility = evaluateBaselineCommitEligibility({
    isCadSupported: workspaceBundle.isCadSupported,
    draftValidation: workspaceBundle.draftValidation,
    m05Package: workspaceBundle.m05Package,
    rawExportValidation: workspaceBundle.rawExportValidation
  });

  if (mode === 'production-baseline' && !eligibility.canCommitProductionBaseline) {
    return {
      committed: false,
      mode,
      rejectionCode: 'BASELINE_COMMIT_BLOCKED',
      blockingReasons: eligibility.productionBaselineBlockingReasons
    };
  }

  if (mode === 'working-draft-diagnostic' && !eligibility.canSyncWorkingDraftSnapshot) {
    return {
      committed: false,
      mode,
      rejectionCode: 'WORKING_DRAFT_SYNC_BLOCKED',
      blockingReasons: eligibility.workingDraftBlockingReasons
    };
  }

  const baseline = extractRevisionBaselineFromBundle(workspaceBundle);
  if (!baseline) {
    return {
      committed: false,
      mode,
      rejectionCode: 'BASELINE_UNAVAILABLE',
      blockingReasons: ['Authoritative package baseline cannot be extracted.']
    };
  }

  onCommit?.(baseline);
  return {
    committed: true,
    mode,
    baseline,
    rejectionCode: null,
    blockingReasons: []
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
  /** Export validation BEFORE staleness overlay — used to verify whether baseline commit is eligible. */
  readonly rawExportValidation: ProductionExportValidationResult;
  readonly exportValidation: ProductionExportValidationResult;
  readonly exportGate: ProductionPackageExportGateResult;
  readonly baselineEligibility: BaselineCommitEligibilityResult;
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

    const exportGate = evaluateProductionPackageExportGate({
      bundle: null,
      exportValidation
    });
    const baselineEligibility = evaluateBaselineCommitEligibility({
      isCadSupported: false,
      draftValidation: safePipeline.validation,
      m05Package: null,
      rawExportValidation: exportValidation
    });

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
      rawExportValidation: exportValidation,
      exportValidation,
      exportGate,
      baselineEligibility,
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

  const exportGate = evaluateProductionPackageExportGate({
    bundle: m05Package,
    exportValidation
  });

  const baselineEligibility = evaluateBaselineCommitEligibility({
    isCadSupported: true,
    draftValidation,
    m05Package,
    rawExportValidation
  });

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
    rawExportValidation,
    exportValidation,
    exportGate,
    baselineEligibility,
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
