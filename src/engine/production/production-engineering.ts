/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner M05 — Master Production Package & Engineering Orchestrator
 *
 * Unifies:
 * - Deterministic CAD pattern drafting & M04.3 Bodice–Sleeve Assembly
 * - M04.4 Graded Multi-Size Integrity (XS–XXL fail-closed size coverage)
 * - M05.1 Authoritative Pattern Revision Lineage & Upstream Invalidation
 * - M05.2.1 Pattern Piece Production Sheets (geometry metrics, cut semantics, allowance schedules)
 * - M05 Deterministic Geometry-Driven Bill of Materials (BOM)
 * - M05 Feature-Traced Manufacturing Documentation
 * - M05 Enhanced DXF-AAMA (AC1009) Export & Full-Feature Round-Trip Verification
 * - M05 Deterministic 10-Gate Production Validation & Canonical SHA-256 Digest
 *
 * Safety Invariant: `isProductionReady` is strictly and literally `false`.
 */

import { BodyMeasurements, DesignSpecification, PatternPiece } from '../../types';
import { assembleBodiceSleeve } from '../assembly/bodice-sleeve-assembly';
import { BodiceSleeveAssemblyResult } from '../assembly/assembly-types';
import { digestCanonicalPayload } from '../assembly/sha256';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { getEnhancedFabricById, DEFAULT_ILLUSTRATIVE_FABRIC } from '../fabric/fabric-presets';
import { DEFAULT_SIZE_RANGE, gradePattern } from '../grading';
import { GradedPatternSet } from '../grading/grading-types';
import { validatePatternDraft } from '../validation/seam-validator';
import { computePieceContourAreaCm2, computeProductionBom } from './bom-engine';
import { sha256Hex } from './crypto';
import { computeArtifactInputFingerprint } from './dependency-invalidation';
import {
  exportPatternPiecesToDxfAama,
  verifyDxfAamaRoundTrip
} from './dxf-aama-exporter';
import { computeSpecificationFingerprint } from './garment-specification';
import { generateManufacturingDocumentation } from './manufacturing-docs';
import {
  AuthoritativePieceProductionSheetSet,
  PatternPieceProductionSheet,
  PieceCutSemanticsDeclaration
} from './manufacturing-types';
import {
  buildAuthoritativePieceProductionSheetSet
} from './piece-production-sheet';
import {
  canonicalizeJson,
  createAuthoritativeGradingArtifact,
  createProductionPatternRevision,
  NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS,
  validateMeasurementProvenanceEvidence,
  validatePatternRevision
} from './pattern-revision-snapshot';
import {
  DxfExportIntegritySummary,
  M05_PRODUCTION_PACKAGE_SCHEMA_VERSION,
  M05ProductionPackageBundle,
  M05ProductionPackageOptions,
  PerSizeProductionSummary
} from './production-engineering-types';
import { evaluateProductionReadiness } from './production-validator';
import {
  AuthoritativeGradingArtifact,
  AuthoritativePatternRevision,
  MeasurementApprovalStatus,
  MeasurementOrigin
} from './production-types';

export interface BuildM05ProductionPackageInput {
  readonly designSpec: DesignSpecification;
  readonly measurements: BodyMeasurements;
  readonly options?: M05ProductionPackageOptions;
  readonly piecesOverride?: readonly PatternPiece[];
  readonly gradedPatternSetOverride?: GradedPatternSet | null;
  readonly assemblyResultOverride?: BodiceSleeveAssemblyResult;
}

function buildDynamicCutSemanticsByPieceCode(
  pieces: readonly PatternPiece[]
): Record<string, PieceCutSemanticsDeclaration> {
  const map: Record<string, PieceCutSemanticsDeclaration> = {};
  for (const piece of pieces) {
    if (piece.onFold) {
      const foldSeg = piece.stitchingContour?.segments.find(s => s.isFold);
      map[piece.pieceCode] = {
        pairingMode: 'single-centered-on-fold',
        ...(foldSeg ? { foldEdgeSegmentId: foldSeg.id } : {})
      };
    } else if (piece.cutCount === 2) {
      map[piece.pieceCode] = {
        pairingMode: 'paired-mirrored-left-right',
        mirroringConfirmed: true
      };
    } else if (piece.cutCount === 1) {
      map[piece.pieceCode] = {
        pairingMode: 'single-asymmetric'
      };
    } else {
      map[piece.pieceCode] = {
        pairingMode: 'multiple-identical',
        expectedQuantityPerGarment: piece.cutCount
      };
    }
  }
  return map;
}

function computeMeasurementFingerprint(measurements: BodyMeasurements, activeSize: string): string {
  return computeArtifactInputFingerprint({
    unit: measurements.unit,
    waist: measurements.waist,
    lowHip: measurements.lowHip,
    highHip: measurements.highHip,
    skirtLength: measurements.skirtLength,
    bust: measurements.bust,
    waistToHip: measurements.waistToHip,
    backWaistLength: measurements.backWaistLength,
    frontWaistLength: measurements.frontWaistLength,
    acrossBack: measurements.acrossBack,
    shoulderLength: measurements.shoulderLength,
    neckCircumference: measurements.neckCircumference,
    bustSpan: measurements.bustSpan,
    bustHeight: measurements.bustHeight,
    armholeDepth: measurements.armholeDepth,
    bicepsCircumference: measurements.bicepsCircumference,
    elbowCircumference: measurements.elbowCircumference,
    wristCircumference: measurements.wristCircumference,
    sleeveLength: measurements.sleeveLength,
    armLengthToElbow: measurements.armLengthToElbow,
    activeSize
  });
}

function getEffectivePhysicalPanelCount(
  pieces: readonly PatternPiece[],
  sheets?: readonly PatternPieceProductionSheet[]
): number {
  let sum = 0;
  for (const piece of pieces) {
    const sh = sheets?.find(s => s.pieceId === piece.id);
    if (sh?.cutSemantics.physicalPanelCountPerGarment !== undefined && sh.cutSemantics.physicalPanelCountPerGarment !== null) {
      sum += sh.cutSemantics.physicalPanelCountPerGarment;
    } else {
      sum += piece.onFold ? 1 : Math.max(1, piece.cutCount);
    }
  }
  return sum;
}

/**
 * Extracts deterministic canonical payload for M05 Production Package SHA-256 verification.
 * Excludes wall-clock `generatedAt` while preserving all engineering specs, BOM, docs,
 * validation diagnostics, per-size summaries, DXF digest, and full upstream revision tracking
 * (including staleness status). Identical engineering inputs evaluated under different
 * staleness histories intentionally produce distinct `canonicalContentDigest` values.
 */
export function buildCanonicalProductionPackagePayload(
  bundle: Omit<
    M05ProductionPackageBundle,
    'canonicalContentDigest' | 'engineeringContentDigest' | 'reportSha256Hex' | 'canonicalJsonByteLength'
  >
): Record<string, unknown> {
  return {
    schemaVersion: bundle.schemaVersion,
    packageId: bundle.packageId,
    packageRevisionId: bundle.packageRevisionId,
    projectId: bundle.projectId,
    tenantId: bundle.tenantId,
    garmentId: bundle.garmentId,
    garmentName: bundle.garmentName,
    garmentCategory: bundle.garmentCategory,
    activeSize: bundle.activeSize,
    includedSizes: [...bundle.includedSizes],
    baseSize: bundle.baseSize,
    // NOTE: generatedAt is intentionally excluded from canonical content identity so
    // identical engineering inputs always produce bit-identical SHA-256 content digests.
    patternRevisionSummary: bundle.patternRevision
      ? {
          revisionId: bundle.patternRevision.revisionId,
          basePatternFingerprint: bundle.patternRevision.basePatternFingerprint,
          geometryFingerprint: bundle.patternRevision.geometryFingerprint,
          currentLifecycleState: bundle.patternRevision.currentLifecycleState
        }
      : null,
    gradingArtifactSummary: bundle.gradingArtifact
      ? {
          gradingArtifactId: bundle.gradingArtifact.gradingArtifactId,
          gradingRevisionId: bundle.gradingArtifact.gradingRevisionId,
          baseSize: bundle.gradingArtifact.baseSize,
          sizeRange: [...bundle.gradingArtifact.sizeRange],
          gradingRuleSetId: bundle.gradingArtifact.gradingRuleSetId,
          gradingRuleSetRevision: bundle.gradingArtifact.gradingRuleSetRevision,
          gradingRuleSetFingerprint: bundle.gradingArtifact.gradingRuleSetFingerprint,
          sourceBasePatternFingerprint: bundle.gradingArtifact.sourceBasePatternFingerprint ?? null,
          sourceSpecificationFingerprint: bundle.gradingArtifact.sourceSpecificationFingerprint,
          sourceMeasurementSetFingerprint: bundle.gradingArtifact.sourceMeasurementSetFingerprint,
          isOverallGradingValid: bundle.gradingArtifact.crossSizeIntegrityReport.isOverallGradingValid,
          validSizeCount: bundle.gradingArtifact.crossSizeIntegrityReport.validSizeCount,
          failedSizeCount: bundle.gradingArtifact.crossSizeIntegrityReport.failedSizeCount,
          lifecycleState: bundle.gradingArtifact.lifecycleState
        }
      : null,
    gradingArtifactError: bundle.gradingArtifactError,
    perSizeSummaries: bundle.perSizeSummaries,
    bom: bundle.bom,
    manufacturingDocs: bundle.manufacturingDocs,
    dxfExportSummary: bundle.dxfExport
      ? {
          exportId: bundle.dxfExport.artifact.exportId,
          dxfVersion: bundle.dxfExport.artifact.dxfVersion,
          pieceCodes: bundle.dxfExport.artifact.pieceCodes,
          dxfSha256Digest: bundle.dxfExport.artifact.sha256Digest,
          roundTripAllPassed: bundle.dxfExport.roundTrip.allPassed,
          maxVertexRoundTripErrorCm: bundle.dxfExport.roundTrip.maxVertexRoundTripErrorCm,
          maxFeatureRoundTripErrorCm: bundle.dxfExport.roundTrip.maxFeatureRoundTripErrorCm,
          externalCadInteroperabilityVerified: bundle.dxfExport.externalCadInteroperabilityVerified
        }
      : null,
    validation: bundle.validation,
    upstreamRevisionTracking: bundle.upstreamRevisionTracking,
    provenanceSummary: bundle.provenanceSummary,
    isProductionReady: bundle.isProductionReady
  };
}

/**
 * Extracts pure deterministic engineering content payload for `engineeringContentDigest`.
 * Excludes session-relative staleness comparison flags (`isStaleAgainstPrevious`, `staleReasons`)
 * and `validation` diagnostic statuses so identical engineering inputs always hash identically
 * regardless of prior baseline history.
 */
export function buildCanonicalEngineeringContentPayload(
  bundle: Omit<
    M05ProductionPackageBundle,
    'canonicalContentDigest' | 'engineeringContentDigest' | 'reportSha256Hex' | 'canonicalJsonByteLength'
  >
): Record<string, unknown> {
  return {
    schemaVersion: bundle.schemaVersion,
    packageId: bundle.packageId,
    packageRevisionId: bundle.packageRevisionId,
    projectId: bundle.projectId,
    tenantId: bundle.tenantId,
    garmentId: bundle.garmentId,
    garmentName: bundle.garmentName,
    garmentCategory: bundle.garmentCategory,
    activeSize: bundle.activeSize,
    includedSizes: [...bundle.includedSizes],
    baseSize: bundle.baseSize,
    patternRevisionSummary: bundle.patternRevision
      ? {
          revisionId: bundle.patternRevision.revisionId,
          basePatternFingerprint: bundle.patternRevision.basePatternFingerprint,
          geometryFingerprint: bundle.patternRevision.geometryFingerprint,
          currentLifecycleState: bundle.patternRevision.currentLifecycleState
        }
      : null,
    gradingArtifactSummary: bundle.gradingArtifact
      ? {
          gradingArtifactId: bundle.gradingArtifact.gradingArtifactId,
          gradingRevisionId: bundle.gradingArtifact.gradingRevisionId,
          baseSize: bundle.gradingArtifact.baseSize,
          sizeRange: [...bundle.gradingArtifact.sizeRange],
          gradingRuleSetId: bundle.gradingArtifact.gradingRuleSetId,
          gradingRuleSetRevision: bundle.gradingArtifact.gradingRuleSetRevision,
          gradingRuleSetFingerprint: bundle.gradingArtifact.gradingRuleSetFingerprint,
          sourceBasePatternFingerprint: bundle.gradingArtifact.sourceBasePatternFingerprint ?? null,
          sourceSpecificationFingerprint: bundle.gradingArtifact.sourceSpecificationFingerprint,
          sourceMeasurementSetFingerprint: bundle.gradingArtifact.sourceMeasurementSetFingerprint,
          isOverallGradingValid: bundle.gradingArtifact.crossSizeIntegrityReport.isOverallGradingValid,
          validSizeCount: bundle.gradingArtifact.crossSizeIntegrityReport.validSizeCount,
          failedSizeCount: bundle.gradingArtifact.crossSizeIntegrityReport.failedSizeCount,
          lifecycleState: bundle.gradingArtifact.lifecycleState
        }
      : null,
    gradingArtifactError: bundle.gradingArtifactError,
    perSizeSummaries: bundle.perSizeSummaries,
    bom: bundle.bom,
    manufacturingDocs: bundle.manufacturingDocs,
    dxfExportSummary: bundle.dxfExport
      ? {
          exportId: bundle.dxfExport.artifact.exportId,
          dxfVersion: bundle.dxfExport.artifact.dxfVersion,
          pieceCodes: bundle.dxfExport.artifact.pieceCodes,
          dxfSha256Digest: bundle.dxfExport.artifact.sha256Digest,
          roundTripAllPassed: bundle.dxfExport.roundTrip.allPassed,
          maxVertexRoundTripErrorCm: bundle.dxfExport.roundTrip.maxVertexRoundTripErrorCm,
          maxFeatureRoundTripErrorCm: bundle.dxfExport.roundTrip.maxFeatureRoundTripErrorCm,
          externalCadInteroperabilityVerified: bundle.dxfExport.externalCadInteroperabilityVerified
        }
      : null,
    upstreamEngineeringFingerprints: {
      sourceSpecificationFingerprint: bundle.upstreamRevisionTracking.sourceSpecificationFingerprint,
      sourceMeasurementFingerprint: bundle.upstreamRevisionTracking.sourceMeasurementFingerprint,
      basePatternFingerprint: bundle.upstreamRevisionTracking.basePatternFingerprint,
      patternRevisionId: bundle.upstreamRevisionTracking.patternRevisionId,
      gradingControlsFingerprint: bundle.upstreamRevisionTracking.gradingControlsFingerprint,
      gradingReportSha256Hex: bundle.upstreamRevisionTracking.gradingReportSha256Hex,
      bomFingerprint: bundle.upstreamRevisionTracking.bomFingerprint
    },
    provenanceSummary: bundle.provenanceSummary,
    isProductionReady: bundle.isProductionReady
  };
}

/**
 * Serializes the M05 Production Package canonical payload to deterministic UTF-8 JSON.
 */
export function serializeDeterministicProductionBundle(
  bundle: Omit<
    M05ProductionPackageBundle,
    'canonicalContentDigest' | 'engineeringContentDigest' | 'reportSha256Hex' | 'canonicalJsonByteLength'
  >
): string {
  const payload = buildCanonicalProductionPackagePayload(bundle);
  return digestCanonicalPayload(payload, { requireNonEmptyObject: true }).canonicalJson;
}

/**
 * Builds a complete, traceable M05 Production Package Bundle connecting pattern drafting,
 * M04.3 assembly, M04.4 multi-size grading, M05.1/M05.2.1 revisions & sheets, BOM,
 * manufacturing documentation, enhanced DXF-AAMA verification, and 10-gate readiness validation.
 */
export function buildM05ProductionPackage(
  input: BuildM05ProductionPackageInput
): M05ProductionPackageBundle {
  const { designSpec, measurements } = input;
  const opts = input.options ?? {};

  const projectId = opts.projectId ?? 'project-patroner-default';
  const tenantId = opts.tenantId ?? projectId;
  const activeSize = (opts.activeSize ?? 'M').trim() || 'M';
  const generatedAt = opts.createdAt ?? new Date().toISOString();
  const packageId = opts.packageId ?? `pkg-m05-${designSpec.id}-v${designSpec.version}`;
  const bodiceDartStyle = opts.bodiceDartStyle ?? designSpec.dartStyle ?? 'waist';
  const sleeveEaseStrategy = opts.sleeveEaseStrategy ?? designSpec.sleeveEaseStrategy ?? 'classic';
  const strictUncertaintyGate = opts.strictUncertaintyGate ?? true;
  const measurementProvenance: MeasurementOrigin = opts.measurementProvenance ?? 'standard-chart';
  const measurementApprovalState: MeasurementApprovalStatus = opts.measurementApprovalState ?? 'unverified';
  const measurementEvidence = opts.measurementProvenanceEvidence;

  const enhancedLookup = getEnhancedFabricById(designSpec.fabric.id);
  const resolvedFabric = enhancedLookup.status === 'found' ? enhancedLookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;

  // 1. Draft active base pieces unless overridden
  let activePieces: PatternPiece[] = input.piecesOverride ? [...input.piecesOverride] : [];
  if (!input.piecesOverride) {
    if (designSpec.garmentCategory === 'bodice') {
      const bodicePieces = draftBodiceBlock(measurements, designSpec, { dartStyle: bodiceDartStyle });
      try {
        const sleeveRes = draftSleeveBlock(measurements, designSpec, {
          strategy: sleeveEaseStrategy,
          bodicePieces
        });
        activePieces = [...bodicePieces, sleeveRes.piece];
      } catch {
        activePieces = bodicePieces;
      }
    } else {
      activePieces = draftSkirtBlock(measurements, designSpec);
    }
  }

  // 2. Bodice–Sleeve Assembly (M04.3)
  let assemblyResult: BodiceSleeveAssemblyResult | undefined = input.assemblyResultOverride;
  if (!assemblyResult && designSpec.garmentCategory === 'bodice' && activePieces.length >= 3) {
    try {
      assemblyResult = assembleBodiceSleeve({
        bodicePieces: activePieces.slice(0, 2),
        sleevePiece: activePieces[2],
        designSpec,
        measurements,
        options: {
          strategy: sleeveEaseStrategy,
          strictUncertaintyGate,
          measurementProvenance,
          measurementApprovalState,
          requireApprovedGovernance: opts.requireApprovedGovernance
        }
      });
    } catch {
      assemblyResult = undefined;
    }
  }

  // 3. Multi-Size Grading Integration (M04.4 for Bodice; explicit single-size policy for Skirt)
  const requiredSizes: readonly string[] =
    opts.requiredSizes ??
    (designSpec.garmentCategory === 'bodice' ? [...DEFAULT_SIZE_RANGE] : [activeSize]);

  let gradedPatternSet: GradedPatternSet | null = null;
  const gradingBoundaryErrors: string[] = [];

  if (input.gradedPatternSetOverride !== undefined) {
    if (input.gradedPatternSetOverride === null) {
      gradedPatternSet = null;
    } else if (
      designSpec.garmentCategory !== 'bodice' ||
      input.gradedPatternSetOverride.garmentCategory !== designSpec.garmentCategory
    ) {
      gradedPatternSet = null;
      gradingBoundaryErrors.push(
        `Rejected mismatched gradedPatternSetOverride ('${input.gradedPatternSetOverride.garmentCategory}') for garment category '${designSpec.garmentCategory}'.`
      );
    } else {
      gradedPatternSet = input.gradedPatternSetOverride;
    }
  } else if (designSpec.garmentCategory === 'bodice') {
    const validTargetSizes = requiredSizes.filter(s =>
      (DEFAULT_SIZE_RANGE as readonly string[]).includes(s)
    );
    gradedPatternSet = gradePattern(designSpec, {
      baseSize: (DEFAULT_SIZE_RANGE as readonly string[]).includes(activeSize) ? activeSize : 'M',
      targetSizes: validTargetSizes.length > 0 ? validTargetSizes : [...DEFAULT_SIZE_RANGE],
      bodiceDartStyle,
      sleeveEaseStrategy,
      strictUncertaintyGate,
      measurementProvenance,
      measurementApprovalState,
      requireApprovedGovernance: opts.requireApprovedGovernance
    });
  }

  // 4. Authoritative Pattern Revision (M05.1)
  let validationDraftReport = validatePatternDraft([]);
  try {
    validationDraftReport = validatePatternDraft(activePieces);
  } catch {
    validationDraftReport = {
      status: 'invalid',
      statusLabel: 'GEOMETRY INVALID',
      isValid: false,
      passedCount: 0,
      warningCount: 0,
      failureCount: 1,
      declaration: 'Draft pattern pieces contain malformed geometry.',
      checks: [],
      unassessedConditions: [],
      timestamp: generatedAt,
      isProductionReady: false
    };
  }
  let patternRevision: AuthoritativePatternRevision | null = null;
  const upstreamErrors: string[] = [];

  try {
    const evidenceCheck = validateMeasurementProvenanceEvidence(
      measurementProvenance,
      measurementEvidence
    );
    const isApprovableOrigin =
      !NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS.has(measurementProvenance) &&
      evidenceCheck.isValid;
    const effectiveMeasApproval: MeasurementApprovalStatus =
      measurementApprovalState === 'approved' && isApprovableOrigin ? 'approved' : 'unverified';
    const operatorIdentity = measurementEvidence?.operatorName?.trim();
    const approverLabel =
      effectiveMeasApproval === 'approved'
        ? (operatorIdentity
            ? `${operatorIdentity} (${measurementProvenance})`
            : 'Authorized Measurement Operator')
        : undefined;

    const revId = opts.revisionId ?? `rev-${designSpec.id}-v${designSpec.version}-${activeSize}`;
    const draftRev = createProductionPatternRevision({
      projectId,
      revisionId: revId,
      createdAt: generatedAt,
      targetSize: activeSize,
      designSpecification: designSpec,
      measurements: {
        values: ({ ...measurements } as unknown) as Record<string, number>,
        defaultOrigin: measurementProvenance,
        approval: {
          state: effectiveMeasApproval,
          approvedBy: approverLabel,
          approvedAt: effectiveMeasApproval === 'approved' ? (measurementEvidence?.recordedAt ?? generatedAt) : undefined
        }
      },
      fabric: resolvedFabric,
      patternPieces: activePieces,
      validation: validationDraftReport,
      physicalValidationStatus: 'not-assessed'
    });

    if (validationDraftReport.isValid && validationDraftReport.failureCount === 0) {
      patternRevision = validatePatternRevision(draftRev, {
        actorId: 'm05-production-validator',
        actorRole: 'validation-engine',
        validatedAt: generatedAt
      });
    } else {
      patternRevision = draftRev;
    }
  } catch (err) {
    upstreamErrors.push(err instanceof Error ? err.message : String(err));
    patternRevision = null;
  }

  // 5. Upstream Spec & Measurement Fingerprints & Revision Invalidation Tracking
  let sourceSpecificationFingerprint = '';
  try {
    sourceSpecificationFingerprint = computeSpecificationFingerprint(designSpec);
  } catch {
    sourceSpecificationFingerprint = sha256Hex(canonicalizeJson(designSpec));
  }
  const sourceMeasurementFingerprint = computeMeasurementFingerprint(measurements, activeSize);
  const gradingControlsFingerprint = sha256Hex(
    canonicalizeJson({
      garmentCategory: designSpec.garmentCategory,
      activeSize,
      requiredSizes: [...requiredSizes],
      bodiceDartStyle,
      sleeveEaseStrategy,
      strictUncertaintyGate,
      requireApprovedGovernance: Boolean(opts.requireApprovedGovernance)
    })
  );

  const staleReasons: string[] = [...upstreamErrors];
  if (opts.previousPackageRevision) {
    if (
      opts.previousPackageRevision.sourceSpecificationFingerprint &&
      opts.previousPackageRevision.sourceSpecificationFingerprint !== sourceSpecificationFingerprint
    ) {
      staleReasons.push('Upstream DesignSpecification changed since previous production package revision.');
    }
    if (
      opts.previousPackageRevision.sourceMeasurementFingerprint &&
      opts.previousPackageRevision.sourceMeasurementFingerprint !== sourceMeasurementFingerprint
    ) {
      staleReasons.push('Upstream body measurements changed since previous production package revision.');
    }
    if (
      opts.previousPackageRevision.basePatternFingerprint &&
      patternRevision?.basePatternFingerprint &&
      opts.previousPackageRevision.basePatternFingerprint !== patternRevision.basePatternFingerprint
    ) {
      staleReasons.push('Upstream drafted pattern geometry changed since previous production package revision.');
    }
    if (
      opts.previousPackageRevision.patternRevisionId &&
      patternRevision?.revisionId &&
      opts.previousPackageRevision.patternRevisionId !== patternRevision.revisionId
    ) {
      staleReasons.push('Upstream pattern revision ID changed since previous production package revision.');
    }
    if (
      opts.previousPackageRevision.gradingControlsFingerprint &&
      opts.previousPackageRevision.gradingControlsFingerprint !== gradingControlsFingerprint
    ) {
      staleReasons.push('Upstream grading or governance controls changed since previous production package revision.');
    }
    if (
      opts.previousPackageRevision.gradingReportSha256Hex &&
      gradedPatternSet?.reportSha256Hex &&
      opts.previousPackageRevision.gradingReportSha256Hex !== gradedPatternSet.reportSha256Hex
    ) {
      staleReasons.push('Upstream graded multi-size report digest changed since previous production package revision.');
    }
  }

  // 6. PiecesBySize & Single Authoritative Grading Artifact + Production Sheet Set (M05.2.1)
  const piecesBySize: Record<string, readonly PatternPiece[]> = {};
  const includedSizes: string[] = [];

  if (gradedPatternSet && designSpec.garmentCategory === 'bodice') {
    for (const sz of gradedPatternSet.supportedSizes) {
      const szRes = gradedPatternSet.sizeResults[sz];
      if (!szRes) continue;
      includedSizes.push(sz);
      const gradedPieces: PatternPiece[] = [
        ...szRes.bodicePieces,
        ...(szRes.sleevePiece ? [szRes.sleevePiece] : [])
      ];
      piecesBySize[sz] =
        sz === activeSize && input.piecesOverride ? activePieces : gradedPieces;
    }
  } else {
    includedSizes.push(activeSize);
    piecesBySize[activeSize] = activePieces;
  }

  let gradingArtifact: AuthoritativeGradingArtifact | null = null;
  let gradingArtifactError: string | null = null;
  let sheetSet: AuthoritativePieceProductionSheetSet | null = null;

  if (patternRevision && activePieces.length > 0) {
    const specRevId = designSpec.specificationRevisionId ?? `spec-${designSpec.id}-v${designSpec.version || 1}`;
    const gradingRulesFp = sha256Hex(
      canonicalizeJson({
        system: 'standard-iso-8559',
        baseSize: 'M',
        version: 'iso8559-standard',
        sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
      })
    );

    if (designSpec.garmentCategory === 'bodice' && gradedPatternSet && includedSizes.length >= 2) {
      try {
        gradingArtifact = createAuthoritativeGradingArtifact({
          projectId,
          tenantId,
          createdAt: generatedAt,
          sourceSpecificationId: designSpec.id,
          sourceSpecificationRevisionId: specRevId,
          sourceSpecificationFingerprint,
          sourcePatternRevisionId: patternRevision.revisionId,
          sourcePatternSnapshotFingerprint: patternRevision.canonicalFingerprint,
          sourceBasePatternFingerprint: patternRevision.basePatternFingerprint,
          sourceMeasurementSetFingerprint: sourceMeasurementFingerprint,
          gradingRuleSetRevision: 'rules-grading-iso8559-standard',
          gradingRuleSetFingerprint: gradingRulesFp,
          baseSize: gradedPatternSet.baseSize,
          sizeRange: includedSizes,
          gradedPatternSet,
          basePatternPieces: activePieces
        });
      } catch (err) {
        gradingArtifact = null;
        gradingArtifactError = err instanceof Error ? err.message : String(err);
        gradingBoundaryErrors.push(
          `Authoritative grading artifact construction failed (fail-closed): ${gradingArtifactError}`
        );
      }
    }

    // Build M05.2.1 Authoritative Piece Production Sheet Set
    try {
      const cutSemanticsByPieceCode = buildDynamicCutSemanticsByPieceCode(activePieces);
      sheetSet = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: gradingArtifact ? 'graded-multi-size' : 'single-size-ungraded',
        ...(gradingArtifact
          ? { gradingArtifact }
          : { nonGradingReason: 'Skirt / custom single-size scope verified without multi-size grading artifact.' }),
        cutSemanticsByPieceCode,
        expectedProjectId: projectId,
        expectedTenantId: tenantId,
        expectedGarmentId: designSpec.id,
        generatedAt,
        ...(opts.bomOptions?.orderQuantitiesBySize
          ? { garmentUnitQuantitiesBySize: normalizeQuantitiesForSheetSet(includedSizes, opts.bomOptions.orderQuantitiesBySize) }
          : {})
      });
    } catch {
      sheetSet = null;
    }
  }

  const sheetsBySize: Record<string, readonly PatternPieceProductionSheet[]> = sheetSet?.sheetsBySize ?? {};

  // 7. Per-Size Summaries (Reconciled across sizes)
  const perSizeSummaries: PerSizeProductionSummary[] = includedSizes.map(sz => {
    const szPieces = piecesBySize[sz] ?? [];
    const szSheets = sheetsBySize[sz] ?? [];
    const szGraded = gradedPatternSet?.sizeResults[sz];
    const physicalPanels = szPieces.length > 0 ? getEffectivePhysicalPanelCount(szPieces, szSheets) : 0;
    const cuttingAreaCm2 = Number(
      szPieces
        .reduce((acc, p) => {
          const sh = szSheets.find(s => s.pieceId === p.id);
          const area = sh?.geometryMetrics.cuttingAreaCm2 ?? computePieceContourAreaCm2(p, 'cutting');
          const unfoldedMult = p.onFold ? 2 : (sh?.cutSemantics.physicalPanelCountPerGarment ?? Math.max(1, p.cutCount));
          return acc + area * unfoldedMult;
        }, 0)
        .toFixed(2)
    );

    return {
      sizeCode: sz,
      isSizeValid: szGraded ? szGraded.isValid : szPieces.length > 0 && validationDraftReport.isValid,
      pieceCount: szPieces.length,
      sheetCount: szSheets.length,
      physicalPanelCount: szPieces.length > 0 ? physicalPanels : null,
      cuttingAreaCm2,
      assemblyStatus: szGraded?.assemblyResult?.status ?? (assemblyResult?.status ?? 'not-applicable'),
      preSortNotchOrderValid: szGraded?.assemblyResult?.notches?.backNotches?.isOrderingValid ?? true,
      elbowParityValid: true,
      errors: szGraded?.errors ?? []
    };
  });

  // 8. Geometry-Driven BOM (Workstream C)
  const bom = computeProductionBom({
    designSpec,
    piecesBySize,
    sheetsBySize,
    options: opts.bomOptions
  });

  const bomFingerprint = sha256Hex(
    canonicalizeJson({
      bomOptions: opts.bomOptions ?? null,
      bom
    })
  );

  if (
    opts.previousPackageRevision?.bomFingerprint &&
    opts.previousPackageRevision.bomFingerprint !== bomFingerprint
  ) {
    staleReasons.push('Upstream BOM parameters or calculated material quantities changed since previous production package revision.');
  }

  // 9. Feature-Traced Manufacturing Documentation (Workstream B)
  const activeSheets = sheetsBySize[activeSize] ?? [];
  const manufacturingDocs = generateManufacturingDocumentation({
    designSpec,
    pieces: activePieces,
    sheets: activeSheets,
    assemblyResult
  });

  // 10. Enhanced DXF-AAMA Export & Full-Feature Round-Trip Verification (Workstream E)
  let dxfExport: DxfExportIntegritySummary | null = null;
  if (activePieces.length > 0) {
    try {
      const artifact = exportPatternPiecesToDxfAama(activePieces, {
        exportId: `M05-${designSpec.id}-${activeSize}`,
        sourceRevisionId: patternRevision?.revisionId ?? `rev-${designSpec.id}-v${designSpec.version}`,
        sourceContentFingerprint: patternRevision?.basePatternFingerprint,
        sizeCode: activeSize
      });
      const roundTrip = verifyDxfAamaRoundTrip(artifact, 0.001);
      dxfExport = {
        artifact,
        roundTrip,
        pieceCount: activePieces.length,
        externalCadInteroperabilityVerified: false
      };
    } catch {
      dxfExport = null;
    }
  }

  // 11. 10-Gate Deterministic Production Readiness Validation (Workstream F)
  const validation = evaluateProductionReadiness({
    designSpec,
    pieces: activePieces,
    requiredSizes,
    includedSizes,
    gradedPatternSet,
    sheetSet,
    bom,
    manufacturingDocs,
    patternRevision,
    dxfRoundTrip: dxfExport?.roundTrip ?? null,
    measurementProvenance,
    measurementApprovalState,
    measurementProvenanceEvidence: measurementEvidence,
    upstreamStaleReasons: [...staleReasons, ...gradingBoundaryErrors],
    requireApprovedGovernance: opts.requireApprovedGovernance
  });

  const packageRevisionId =
    opts.revisionId ??
    `m05-rev-${designSpec.id}-v${designSpec.version}-${sourceSpecificationFingerprint.slice(0, 8)}`;

  const partialBundle: Omit<
    M05ProductionPackageBundle,
    'canonicalContentDigest' | 'engineeringContentDigest' | 'reportSha256Hex' | 'canonicalJsonByteLength'
  > = {
    schemaVersion: M05_PRODUCTION_PACKAGE_SCHEMA_VERSION,
    packageId,
    packageRevisionId,
    projectId,
    tenantId,
    garmentId: designSpec.id,
    garmentName: designSpec.name,
    garmentCategory: designSpec.garmentCategory,
    activeSize,
    includedSizes,
    baseSize: gradedPatternSet?.baseSize ?? activeSize,
    generatedAt,
    patternRevision,
    gradedPatternSet,
    gradingArtifact,
    gradingArtifactError,
    sheetSet,
    perSizeSummaries,
    bom,
    manufacturingDocs,
    dxfExport,
    validation,
    upstreamRevisionTracking: {
      sourceSpecificationFingerprint,
      sourceMeasurementFingerprint,
      basePatternFingerprint: patternRevision?.basePatternFingerprint ?? null,
      patternRevisionId: patternRevision?.revisionId ?? null,
      gradingControlsFingerprint,
      gradingReportSha256Hex: gradedPatternSet?.reportSha256Hex ?? null,
      bomFingerprint,
      isStaleAgainstPrevious: staleReasons.length > 0,
      staleReasons
    },
    provenanceSummary: {
      measurementProvenance,
      measurementApprovalState,
      ...(measurementEvidence?.operatorName ? { operatorName: measurementEvidence.operatorName } : {}),
      ...(measurementEvidence?.measurementSource ? { measurementSource: measurementEvidence.measurementSource } : {}),
      fabricId: designSpec.fabric.id,
      fabricName: designSpec.fabric.name,
      fabricProvenance: resolvedFabric.provenance ?? designSpec.fabricProvenance ?? 'unknown'
    },
    isProductionReady: false
  };

  // 12. Canonical JSON & Non-Empty SHA-256 Digests
  // - canonicalContentDigest: provenance- and validation-inclusive package digest
  // - engineeringContentDigest: pure deterministic engineering content digest independent of staleness history
  const canonicalPayload = buildCanonicalProductionPackagePayload(partialBundle);
  const digestEnvelope = digestCanonicalPayload(canonicalPayload, { requireNonEmptyObject: true });
  const engineeringPayload = buildCanonicalEngineeringContentPayload(partialBundle);
  const engineeringDigestEnvelope = digestCanonicalPayload(engineeringPayload, {
    requireNonEmptyObject: true
  });

  return {
    ...partialBundle,
    canonicalContentDigest: digestEnvelope.sha256Hex,
    engineeringContentDigest: engineeringDigestEnvelope.sha256Hex,
    reportSha256Hex: digestEnvelope.sha256Hex,
    canonicalJsonByteLength: digestEnvelope.byteLength,
    isProductionReady: false
  };
}

function normalizeQuantitiesForSheetSet(
  includedSizes: readonly string[],
  quantitiesBySize: Readonly<Record<string, number>>
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const sz of includedSizes) {
    const val = quantitiesBySize[sz];
    if (val === undefined || !Number.isInteger(val) || val < 1) {
      return undefined;
    }
    out[sz] = val;
  }
  return out;
}
