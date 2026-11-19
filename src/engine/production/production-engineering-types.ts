/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner M05 — Production Engineering, BOM, Manufacturing Docs, DXF Interop & Gatekeeper Types
 *
 * Safety Invariant: `isProductionReady` is strictly and literally `false`.
 */

import { BodiceDartStyle, SleeveEaseStrategy } from '../../types';
import { GradedPatternSet } from '../grading/grading-types';
import {
  DxfAamaExportArtifact,
  DxfRoundTripVerificationResult
} from './dxf-aama-exporter';
import {
  AuthoritativePieceProductionSheetSet,
  OrderQuantityBasis
} from './manufacturing-types';
import {
  AuthoritativeGradingArtifact,
  AuthoritativePatternRevision,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementProvenanceEvidence
} from './production-types';

export const M05_PRODUCTION_PACKAGE_SCHEMA_VERSION = '1.0.0-m05' as const;

export type BomQuantityBasis =
  | 'calculated'
  | 'configured-allowance'
  | 'estimated'
  | 'user-entered';

export type BomCategory =
  | 'main-fabric'
  | 'lining'
  | 'interfacing'
  | 'thread'
  | 'fasteners-hardware'
  | 'labels-packaging';

export interface BomUserSupplierEntry {
  readonly supplierName?: string;
  readonly skuCode?: string;
  readonly unitCostUsd?: number;
  readonly leadTimeDays?: number;
  readonly notes?: string;
}

export interface BomCalculationOptions {
  readonly fabricRollWidthCm?: number;
  readonly selvedgeMarginCm?: number;
  readonly markerWasteFactor?: number;
  readonly threadWastageFactor?: number;
  readonly interfacingWidthCm?: number;
  readonly includeLining?: boolean;
  readonly includeInterfacing?: boolean;
  readonly includeLabelsAndPackaging?: boolean;
  readonly orderQuantitiesBySize?: Readonly<Record<string, number>>;
  readonly supplierOverrides?: Readonly<Record<string, BomUserSupplierEntry>>;
}

export interface BomLineItem {
  readonly itemId: string;
  readonly category: BomCategory;
  readonly materialName: string;
  readonly specification: string;
  readonly unit: 'cm2' | 'meters' | 'units' | 'sets';
  readonly basis: BomQuantityBasis;
  readonly calculatedBaseQuantityPerGarment: number;
  readonly allowanceQuantityPerGarment: number;
  readonly totalQuantityPerGarment: number;
  readonly totalOrderQuantity: number;
  readonly wasteFactorApplied: number;
  readonly calculationFormula: string;
  readonly traceablePieceIds: readonly string[];
  readonly traceableFeatureIds: readonly string[];
  readonly supplierData?: Readonly<BomUserSupplierEntry & { readonly origin: 'user-entered' | 'none' }>;
}

export interface PerSizeBomSummary {
  readonly sizeCode: string;
  readonly orderQuantity: number;
  readonly selfPieceCuttingAreaCm2: number;
  readonly selfPieceStitchingAreaCm2: number;
  readonly liningCuttingAreaCm2: number;
  readonly mainFabricMetersPerGarment: number;
  readonly mainFabricMetersForSizeOrder: number;
  readonly totalStitchingPerimeterCm: number;
  readonly threadMetersPerGarment: number;
  readonly interfacingMetersPerGarment: number;
}

export interface M05BomReport {
  readonly schemaVersion: typeof M05_PRODUCTION_PACKAGE_SCHEMA_VERSION;
  readonly fabricName: string;
  readonly fabricComposition: string;
  readonly fabricRollWidthCm: number;
  readonly usableFabricWidthCm: number;
  readonly markerWasteFactor: number;
  readonly threadWastageFactor: number;
  readonly orderQuantityBasis: OrderQuantityBasis;
  readonly totalOrderGarments: number;
  readonly sizeBreakdowns: readonly PerSizeBomSummary[];
  readonly lineItems: readonly BomLineItem[];
  readonly totalMainFabricMetersForOrder: number;
  readonly totalLiningMetersForOrder: number;
  readonly totalInterfacingMetersForOrder: number;
  readonly totalThreadMetersForOrder: number;
  readonly warnings: readonly string[];
  readonly isProductionReady: false;
}

export interface CuttingInstructionEntry {
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly pieceName: string;
  readonly material: string;
  readonly cutCountPerGarment: number;
  readonly onFold: boolean;
  readonly pairingRule: string;
  readonly grainDirection: string;
  readonly cuttingAreaCm2: number | null;
  readonly drillHoleCount: number;
  readonly notchCount: number;
  readonly directionalNapNote?: string;
}

export interface SewingOperationStep {
  readonly operationCode: string;
  readonly sequenceOrder: number;
  readonly title: string;
  readonly instruction: string;
  readonly stitchClassIso4915: string;
  readonly seamAllowanceCm: number;
  readonly targetEaseCm?: number;
  readonly traceablePieceIds: readonly string[];
  readonly traceableFeatureIds: readonly string[];
}

export interface SeamConstructionSpec {
  readonly seamId: string;
  readonly seamName: string;
  readonly pieceCode: string;
  readonly segmentRole?: string;
  readonly allowanceCm: number;
  readonly isFold: boolean;
  readonly stitchedLengthCm: number;
  readonly stitchClassIso4915: string;
  readonly pairedSeamName?: string;
}

export interface NotchAlignmentInstruction {
  readonly notchId: string;
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly notchLabel: string;
  readonly notchType: string;
  readonly targetMatchDescription: string;
  readonly toleranceCm: number;
}

export interface FinishingInstruction {
  readonly finishId: string;
  readonly title: string;
  readonly instruction: string;
  readonly maxAllowanceCm?: number;
  readonly traceableSourceIds: readonly string[];
}

export interface QualityControlCheckpoint {
  readonly checkpointId: string;
  readonly checkpointName: string;
  readonly criterion: string;
  readonly toleranceSpec: string;
  readonly traceableSourceIds: readonly string[];
}

export interface OperatorSheetSummary {
  readonly garmentName: string;
  readonly garmentCategory: string;
  readonly totalPieceCount: number;
  readonly totalPhysicalPanelsPerGarment: number;
  readonly totalOperations: number;
  readonly criticalNotchCount: number;
  readonly seamSummaryLine: string;
}

export interface DocsCompletenessResult {
  readonly isComplete: boolean;
  readonly missingSections: readonly string[];
  readonly untracedOperationCount: number;
  readonly totalTracedReferences: number;
}

export interface M05ManufacturingDocumentation {
  readonly schemaVersion: typeof M05_PRODUCTION_PACKAGE_SCHEMA_VERSION;
  readonly garmentId: string;
  readonly garmentName: string;
  readonly garmentCategory: string;
  readonly cuttingInstructions: readonly CuttingInstructionEntry[];
  readonly sewingSequence: readonly SewingOperationStep[];
  readonly seamSpecifications: readonly SeamConstructionSpec[];
  readonly notchAlignmentInstructions: readonly NotchAlignmentInstruction[];
  readonly pressingAndFinishing: readonly FinishingInstruction[];
  readonly qualityCheckpoints: readonly QualityControlCheckpoint[];
  readonly operatorSummary: OperatorSheetSummary;
  readonly completeness: DocsCompletenessResult;
  readonly isProductionReady: false;
}

export type ProductionValidationCheckId =
  | 'missing-pattern-pieces'
  | 'invalid-contours'
  | 'incomplete-seam-allowances'
  | 'missing-grainlines'
  | 'inconsistent-piece-metadata'
  | 'invalid-size-coverage'
  | 'unresolved-measurement-approvals'
  | 'missing-material-specs'
  | 'incomplete-manufacturing-docs'
  | 'invalid-or-stale-revision';

export interface ProductionValidationDiagnostic {
  readonly checkId: ProductionValidationCheckId;
  readonly title: string;
  readonly status: 'pass' | 'fail' | 'warning';
  readonly severity: 'blocking' | 'advisory';
  readonly message: string;
  readonly affectedIds: readonly string[];
}

export interface ProductionReadinessReport {
  readonly status: 'verified-for-2d-package' | 'blocked';
  readonly isValid: boolean;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly warningCount: number;
  readonly blockingErrors: readonly string[];
  readonly warnings: readonly string[];
  readonly diagnostics: readonly ProductionValidationDiagnostic[];
  readonly isProductionReady: false;
}

export interface PerSizeProductionSummary {
  readonly sizeCode: string;
  readonly isSizeValid: boolean;
  readonly pieceCount: number;
  readonly sheetCount: number;
  readonly physicalPanelCount: number | null;
  readonly cuttingAreaCm2: number;
  readonly assemblyStatus: string;
  readonly preSortNotchOrderValid: boolean;
  readonly elbowParityValid: boolean;
  readonly errors: readonly string[];
}

export interface DxfExportIntegritySummary {
  readonly artifact: DxfAamaExportArtifact;
  readonly roundTrip: DxfRoundTripVerificationResult;
  readonly pieceCount: number;
  readonly externalCadInteroperabilityVerified: false;
}

export interface M05ProductionPackageOptions {
  readonly projectId?: string;
  readonly tenantId?: string;
  readonly packageId?: string;
  readonly revisionId?: string;
  readonly createdAt?: string;
  readonly activeSize?: string;
  readonly requiredSizes?: readonly string[];
  readonly bodiceDartStyle?: BodiceDartStyle;
  readonly sleeveEaseStrategy?: SleeveEaseStrategy;
  readonly strictUncertaintyGate?: boolean;
  readonly measurementProvenance?: MeasurementOrigin;
  readonly measurementApprovalState?: MeasurementApprovalStatus;
  readonly measurementProvenanceEvidence?: MeasurementProvenanceEvidence;
  readonly requireApprovedGovernance?: boolean;
  readonly bomOptions?: BomCalculationOptions;
  readonly previousPackageRevision?: {
    readonly sourceSpecificationFingerprint?: string;
    readonly sourceMeasurementFingerprint?: string;
    readonly basePatternFingerprint?: string;
    readonly patternRevisionId?: string | null;
    readonly gradingControlsFingerprint?: string;
    readonly gradingReportSha256Hex?: string | null;
    readonly bomFingerprint?: string;
  };
}

export interface M05ProductionPackageBundle {
  readonly schemaVersion: typeof M05_PRODUCTION_PACKAGE_SCHEMA_VERSION;
  readonly packageId: string;
  readonly packageRevisionId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly garmentId: string;
  readonly garmentName: string;
  readonly garmentCategory: string;
  readonly activeSize: string;
  readonly includedSizes: readonly string[];
  readonly baseSize: string;
  /** Wall-clock generation metadata — intentionally excluded from canonicalContentDigest. */
  readonly generatedAt: string;
  readonly patternRevision: AuthoritativePatternRevision | null;
  readonly gradedPatternSet: GradedPatternSet | null;
  /** Single authoritative grading artifact constructed once inside buildM05ProductionPackage (null for skirt / single-size). */
  readonly gradingArtifact: AuthoritativeGradingArtifact | null;
  /** Non-null if authoritative grading artifact creation failed for a multi-size-supported category (fail-closed diagnostic). */
  readonly gradingArtifactError: string | null;
  readonly sheetSet: AuthoritativePieceProductionSheetSet | null;
  readonly perSizeSummaries: readonly PerSizeProductionSummary[];
  readonly bom: M05BomReport;
  readonly manufacturingDocs: M05ManufacturingDocumentation;
  readonly dxfExport: DxfExportIntegritySummary | null;
  readonly validation: ProductionReadinessReport;
  readonly upstreamRevisionTracking: {
    readonly sourceSpecificationFingerprint: string;
    readonly sourceMeasurementFingerprint: string;
    readonly basePatternFingerprint: string | null;
    readonly patternRevisionId: string | null;
    readonly gradingControlsFingerprint: string;
    readonly gradingReportSha256Hex: string | null;
    readonly bomFingerprint: string;
    readonly isStaleAgainstPrevious: boolean;
    readonly staleReasons: readonly string[];
  };
  readonly provenanceSummary: {
    readonly measurementProvenance: MeasurementOrigin;
    readonly measurementApprovalState: MeasurementApprovalStatus;
    readonly operatorName?: string;
    readonly measurementSource?: string;
    readonly fabricId: string;
    readonly fabricName: string;
    readonly fabricProvenance: string;
  };
  /**
   * Provenance- and validation-inclusive FIPS 180-4 SHA-256 digest of the complete production package.
   * Intentionally includes `validation` diagnostics and `upstreamRevisionTracking` (including staleness state),
   * so identical engineering inputs evaluated under different upstream revision/staleness histories produce
   * distinct `canonicalContentDigest` values.
   */
  readonly canonicalContentDigest: string;
  /**
   * Pure deterministic engineering-content FIPS 180-4 SHA-256 digest excluding session-relative staleness
   * flags (`isStaleAgainstPrevious`, `staleReasons`) and validation-state wrappers. Identical engineering
   * inputs produce bit-identical `engineeringContentDigest` values regardless of upstream baseline history.
   */
  readonly engineeringContentDigest: string;
  readonly reportSha256Hex: string;
  readonly canonicalJsonByteLength: number;
  readonly isProductionReady: false;
}
