/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner Milestone 05.2.1 — Canonical Pattern Piece Production Sheet Types
 *
 * Pure engineering contracts for authoritative pattern-piece production sheets,
 * explicit cut quantity semantics, traceable segment-level allowance mapping,
 * numerically documented 2D geometry metrics, and grading/provenance binding.
 *
 * Safety Invariant: `isProductionReady` is strictly and literally `false`.
 */

import {
  Dart,
  GarmentCategory,
  GrainLine,
  Notch,
  Point,
  SeamLine
} from '../../types';
import { SegmentRole } from '../geometry/primitives';
import {
  ContourBoundingBoxSnapshot,
  EngineProvenanceRecord,
  GeometricContourSnapshot,
  PatternPieceSnapshot,
  SizeCode
} from './production-types';

export const MANUFACTURING_PIECE_SHEET_SCHEMA_VERSION = '1.1.0-m05.2.1-r1' as const;

export type PiecePairingMode =
  | 'single-centered-on-fold'
  | 'paired-mirrored-left-right'
  | 'single-asymmetric'
  | 'multiple-identical';

export type MirroringRule =
  | 'none'
  | 'cut-on-fold-mirror-across-fold-axis'
  | 'cut-paired-face-to-face-left-right'
  | 'explicit-multi-identical-non-mirrored'
  | 'explicit-multi-paired-left-right';

export type FoldUnfoldingOperation =
  | 'none'
  | 'unfold-across-fold-axis'
  | 'unresolved';

export type OrderQuantityBasis =
  | 'declared-order-quantity'
  | 'default-single-garment-per-size-run';

export interface PieceCutSemanticsDeclaration {
  readonly pairingMode: PiecePairingMode;
  readonly foldEdgeSegmentId?: string;
  readonly mirroringConfirmed?: boolean;
  readonly explicitMultiMirroredPairs?: boolean;
  readonly expectedQuantityPerGarment?: number;
}

export type SemanticResolutionStatus = 'resolved' | 'unresolved' | 'invalid';

export interface PatternPieceCutSemantics {
  readonly pairingMode?: PiecePairingMode;
  readonly semanticResolutionStatus: SemanticResolutionStatus;
  readonly patternPieceCount: number;
  readonly physicalPanelCountPerGarment: number | null;
  readonly cuttingOperationsSinglePlyPerGarment: number | null;
  readonly cuttingOperationsPairedPlyPerGarment: number | null;
  readonly garmentUnitQuantity: number;
  readonly orderQuantityBasis: OrderQuantityBasis;
  readonly totalPhysicalPanelsForOrder: number | null;
  readonly requiresMirroring: boolean | null;
  readonly mirroringRule: MirroringRule | 'unresolved';
  readonly requiresFabricFold: boolean | null;
  readonly requiresFoldUnfolding: boolean | null;
  readonly foldUnfoldingOperation: FoldUnfoldingOperation;
  readonly foldEdgeSegmentId?: string;
  readonly foldEdgeAxis?: 'vertical-center-line' | 'horizontal-center-line' | 'custom-axis';
  readonly declaredCutCountFromSource: number;
  readonly declaredOnFoldFromSource: boolean;
  readonly contradictionReasons: readonly string[];
}

export type ContourSegmentEdgeRole =
  | 'fold-edge'
  | 'structural-seam'
  | 'hem'
  | 'waistline'
  | 'neckline'
  | 'armhole-scye'
  | 'shoulder'
  | 'center-seam'
  | 'corner-transition'
  | 'unspecified';

export type AllowanceValidationStatus =
  | 'verified'
  | 'fold-zero-verified'
  | 'fold-nonzero-contradiction'
  | 'cutting-allowance-mismatch'
  | 'missing-seam-metadata'
  | 'negative-or-non-finite'
  | 'unmodeled-contour';

export interface SourceGeometrySegmentRef {
  readonly contourType: 'stitching' | 'cutting';
  readonly contourId: string;
  readonly segmentIndex: number;
  readonly segmentId: string;
  readonly seamId?: string;
  readonly sourceSegmentId?: string;
}

export interface SegmentAllowanceEntry {
  readonly segmentId: string;
  readonly seamId?: string;
  readonly seamName?: string;
  readonly sourceSegmentId?: string;
  readonly segmentRole?: SegmentRole;
  readonly edgeRole: ContourSegmentEdgeRole;
  readonly allowanceCm: number;
  readonly isFold: boolean;
  readonly matchingCuttingSegmentIds: readonly string[];
  readonly sourceGeometryRef: SourceGeometrySegmentRef;
  readonly validationStatus: AllowanceValidationStatus;
  readonly validationNotes?: string;
}

export interface PieceAllowanceSchedule {
  readonly sourcePieceScalarAllowanceWidthCm: number;
  readonly entries: readonly SegmentAllowanceEntry[];
  readonly mappedSegmentCount: number;
  readonly unmappedSegmentCount: number;
  readonly unmappedCuttingSegmentIds: readonly string[];
  readonly conflictingSeamSegmentIds: readonly string[];
  readonly isComplete: boolean;
  readonly hasContradictions: boolean;
  readonly issues: readonly string[];
  readonly knownDraftingVsUiDriftNotes: readonly string[];
}

export interface BezierNumericalPrecisionMetadata {
  readonly hasBezierSegments: boolean;
  readonly perimeterMethod: 'exact-euclidean' | 'adaptive-de-casteljau-subdivision';
  readonly perimeterToleranceCm: number;
  readonly perimeterMaxSubdivisionDepth: number;
  readonly perimeterActualMaxDepth: number;
  readonly perimeterMaxDepthReached: boolean;
  /** Worst individual segment adaptive error bound across stitching & cutting contours (per-segment bound, cm). */
  readonly perimeterWorstErrorBoundCm: number;
  /** Aggregated whole-contour perimeter upper error bound for stitchingContour (sum of segment + FP bounds, cm). */
  readonly stitchingPerimeterUpperBoundCm: number;
  /** Aggregated whole-contour perimeter upper error bound for cuttingContour (sum of segment + FP bounds, cm). */
  readonly cuttingPerimeterUpperBoundCm: number;
  /** Combined whole-contour perimeter upper error bound across stitching + cutting contours (cm). */
  readonly perimeterTotalErrorBoundCm: number;
  readonly perimeterAllTolerancesAchieved: boolean;
  readonly areaMethod:
    | 'exact-shoelace-polygon'
    | 'exact-greens-theorem-cubic-bezier'
    | 'adaptive-bezier-flattening-shoelace';
  readonly areaFlatnessToleranceCm: number;
  readonly areaMaxSubdivisionDepth: number;
  readonly areaActualMaxDepth: number;
  readonly areaMaxDepthReached: boolean;
  readonly areaWorstResidualFlatnessCm: number;
  readonly areaFlatteningToleranceAchieved: boolean;
  readonly stitchingAreaUpperBoundCm2: number;
  readonly cuttingAreaUpperBoundCm2: number;
  readonly areaApproximationUpperBoundCm2: number;
  readonly isExact: boolean;
  readonly documentationNote: string;
}

export interface PatternPieceGeometryMetrics {
  readonly unit: 'cm';
  readonly areaUnit: 'cm2';
  readonly isValid: boolean;
  readonly stitchingPerimeterCm: number | null;
  readonly cuttingPerimeterCm: number | null;
  readonly cuttingAreaCm2: number | null;
  readonly stitchingAreaCm2: number | null;
  readonly boundingWidthCm: number | null;
  readonly boundingHeightCm: number | null;
  readonly halfPatternBoundingWidthCm?: number | null;
  readonly unfoldedWidthCm?: number | null;
  readonly unfoldedStitchingWidthCm?: number | null;
  readonly numericalPrecision: BezierNumericalPrecisionMetadata;
  readonly errors: readonly string[];
}

export interface ContourReferenceSummary {
  readonly contourId: string;
  readonly isClosed: boolean;
  readonly segmentCount: number;
  readonly recordedTotalLengthCm: number;
  readonly boundingBox: ContourBoundingBoxSnapshot;
}

export type PieceProductionSheetRejectionCode =
  | 'INDUSTRIAL_SAFETY_VIOLATION'
  | 'PATTERN_REVISION_INVALID'
  | 'PATTERN_REVISION_TAMPERED'
  | 'FOREIGN_PIECE_NOT_IN_REVISION'
  | 'GRADING_POLICY_INVALID'
  | 'GRADING_ARTIFACT_MISSING'
  | 'GRADING_ARTIFACT_INVALID'
  | 'GRADING_SIZE_INCOMPLETE'
  | 'GRADING_EXTRA_UNDECLARED_SIZE'
  | 'GRADING_PIECE_IDENTITY_MISMATCH'
  | 'GRADING_BASE_CLONING_PROHIBITED'
  | 'SKIRT_GRADING_UNSUPPORTED_WITHOUT_ARTIFACT'
  | 'CUT_SEMANTICS_UNRESOLVED'
  | 'CUT_SEMANTICS_CONTRADICTION'
  | 'GEOMETRY_INVALID'
  | 'ALLOWANCE_SCHEDULE_INVALID'
  | 'SHEET_FINGERPRINT_MISMATCH'
  | 'PIECE_GEOMETRY_FINGERPRINT_MISMATCH'
  | 'TIMESTAMP_INVALID'
  | 'QUANTITY_BASIS_INVALID'
  | 'CROSS_REVISION_SOURCE_MISMATCH'
  | 'CROSS_PROJECT_MISMATCH'
  | 'CROSS_TENANT_MISMATCH'
  | 'CROSS_GARMENT_MISMATCH';

export interface PieceProductionSheetValidationResult {
  readonly isValid: boolean;
  readonly rejectionCodes: readonly PieceProductionSheetRejectionCode[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface PatternPieceProductionSheet {
  readonly schemaVersion: typeof MANUFACTURING_PIECE_SHEET_SCHEMA_VERSION;
  readonly sheetId: string;
  readonly sourceProjectId: string;
  readonly sourceTenantId?: string;
  readonly sourceGarmentId: string;
  readonly sourcePatternRevisionId: string;
  readonly sourcePatternRevisionNumber: number;
  readonly sourcePatternContentFingerprint: string;
  readonly sourceGeometryFingerprint: string;
  readonly gradingMode: 'graded-multi-size' | 'single-size-ungraded';
  readonly sourceGradingArtifactId?: string;
  readonly sourceGradingRevisionId?: string;
  readonly sourceGradingArtifactFingerprint?: string;
  readonly pieceId: string;
  readonly pieceCode: string;
  readonly pieceName: string;
  readonly sizeCode: SizeCode | string;
  readonly garmentCategory: GarmentCategory | 'sleeve';
  readonly material: PatternPieceSnapshot['material'];
  readonly pieceGeometryFingerprint: string;
  readonly sourceEngineProvenance: Readonly<EngineProvenanceRecord>;
  readonly stitchingContour: GeometricContourSnapshot | null;
  readonly stitchingContourSummary: ContourReferenceSummary | null;
  readonly cuttingContour: GeometricContourSnapshot | null;
  readonly cuttingContourSummary: ContourReferenceSummary | null;
  readonly grainline: Readonly<GrainLine>;
  readonly notches: readonly Readonly<Notch>[];
  readonly darts: readonly Readonly<Dart>[];
  readonly drillHoles: readonly Readonly<Point>[];
  readonly seamReferences: readonly Readonly<SeamLine>[];
  readonly cutSemantics: PatternPieceCutSemantics;
  readonly orderQuantityBasis: OrderQuantityBasis;
  readonly allowanceSchedule: PieceAllowanceSchedule;
  readonly geometryMetrics: PatternPieceGeometryMetrics;
  readonly sheetContentFingerprint: string;
  readonly validation: PieceProductionSheetValidationResult;
  readonly generatedAt: string;
  readonly isProductionReady: false;
}

export interface AuthoritativePieceProductionSheetSet {
  readonly schemaVersion: typeof MANUFACTURING_PIECE_SHEET_SCHEMA_VERSION;
  readonly sheetSetId: string;
  readonly sourceProjectId: string;
  readonly sourceTenantId?: string;
  readonly sourceGarmentId: string;
  readonly sourcePatternRevisionId: string;
  readonly sourcePatternRevisionNumber: number;
  readonly sourcePatternContentFingerprint: string;
  readonly sourceGeometryFingerprint: string;
  readonly gradingMode: 'graded-multi-size' | 'single-size-ungraded';
  readonly nonGradingReason?: string;
  readonly sourceGradingArtifactId?: string;
  readonly sourceGradingRevisionId?: string;
  readonly sourceGradingArtifactFingerprint?: string;
  readonly baseSize: string;
  readonly includedSizes: readonly string[];
  readonly expectedPieceCodes: readonly string[];
  readonly sheetsBySize: Readonly<Record<string, readonly PatternPieceProductionSheet[]>>;
  readonly totalSheetsCount: number;
  readonly totalPhysicalPanelsAcrossSizesForOrder: number | null;
  readonly orderQuantityBasis: OrderQuantityBasis;
  readonly sheetSetContentFingerprint: string;
  readonly validation: PieceProductionSheetValidationResult;
  readonly generatedAt: string;
  readonly isProductionReady: false;
}
