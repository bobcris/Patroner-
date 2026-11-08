/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BoundingBox,
  Dart,
  DesignSpecification,
  EaseProfile,
  FabricProperty,
  FabricStretch,
  FabricWeight,
  GarmentCategory,
  GarmentConstructionFeature,
  GrainLine,
  Notch,
  Point,
  SeamLine,
  SegmentOffsetDiagnostic,
  Silhouette,
  SleeveEaseStrategy,
  BodiceDartStyle,
  PatternPiece,
  ValidationReport
} from '../../types';
import { SegmentRole } from '../geometry/primitives';
import { AssemblyValidationStatus } from '../assembly/assembly-types';
import { DirectionalProperties, FabricProvenance } from '../fabric/fabric-types';

export const PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION = '1.0.0' as const;
export type ProductionPatternSnapshotSchemaVersion = typeof PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION;

/**
 * Declared provenance of a body measurement value.
 */
export type MeasurementOrigin =
  | 'user-entered'
  | 'standard-chart'
  | 'imported'
  | 'ai-estimated'
  | 'unknown';

/**
 * Separate approval lifecycle state for body measurements.
 * An engineer or client may approve/reject measurements independently of design approval.
 */
export type MeasurementApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * Auditable approval declaration for a measurement dataset.
 */
export interface MeasurementApprovalRecord {
  readonly state: MeasurementApprovalStatus;
  readonly approvedBy?: string;
  readonly approvedAt?: string; // ISO 8601 date string
  readonly notes?: string;
  readonly measurementRevisionReference?: string;
}

/**
 * Immutable snapshot of a measurement set binding values to origin provenance and approval.
 */
export interface MeasurementSetSnapshot {
  readonly unit: 'cm';
  readonly values: Readonly<Record<string, number>>;
  readonly defaultOrigin: MeasurementOrigin;
  readonly perMeasurementOrigin?: Readonly<Record<string, MeasurementOrigin>>;
  readonly approval: MeasurementApprovalRecord;
  readonly notes?: readonly string[];
}

/**
 * Immutable snapshot of material specification capturing property verification details.
 */
export interface FabricSpecificationSnapshot {
  readonly fabricId: string;
  readonly name: string;
  readonly composition?: string;
  readonly fabricRevision?: string;
  readonly weight?: FabricWeight;
  readonly stretch?: FabricStretch;
  readonly directional?: Readonly<DirectionalProperties>;
  readonly gsm?: number;
  readonly thicknessMm?: number;
  readonly moldingFactor?: number;
  readonly provenance: FabricProvenance;
  readonly isVerified: boolean;
  readonly propertyVerificationDetails?: Readonly<Record<string, boolean>>;
  readonly laboratoryReference?: string;
  readonly supplierReference?: string;
  readonly isIllustrative: boolean;
  readonly isProvisional: boolean;
}

/**
 * Immutable snapshot of design specification capturing creative and construction parameters.
 */
export interface DesignSpecificationSnapshot {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly garmentCategory: GarmentCategory;
  readonly silhouette: Silhouette;
  readonly easeProfile: EaseProfile;
  readonly lengthCm: number;
  readonly dartStyle?: BodiceDartStyle;
  readonly sleeveEaseStrategy?: SleeveEaseStrategy;
  readonly constructionFeatures: readonly GarmentConstructionFeature[];
  readonly designNotes: readonly string[];
  readonly isApproved: boolean;
  readonly approvedAt?: string;
  readonly aiEstimates?: {
    readonly suggestedSilhouette: string;
    readonly styleConfidenceScore: number;
    readonly suggestedFabrics: readonly string[];
    readonly technicalAdvice: string;
    readonly disclaimer: string;
  };
}

/**
 * Pure plain-data representation of a geometric contour segment.
 * Independent of class prototypes or methods.
 */
export interface GeometricSegmentSnapshot {
  readonly id: string;
  readonly type: 'line' | 'bezier';
  readonly start: Point;
  readonly end: Point;
  readonly controlPoints?: readonly [Point, Point]; // cp1, cp2 for cubic bezier
  readonly seamAllowanceCm: number;
  readonly isFold: boolean;
  readonly seamId?: string;
  readonly sourceSegmentId?: string;
  readonly role?: SegmentRole;
  readonly lengthCm: number;
}

/**
 * Pure plain-data representation of a closed or open geometric contour.
 */
export interface GeometricContourSnapshot {
  readonly id: string;
  readonly isClosed: boolean;
  readonly winding?: 'clockwise' | 'counter-clockwise' | 'degenerate' | 'collinear';
  readonly segments: readonly GeometricSegmentSnapshot[];
  readonly totalLengthCm: number;
  readonly boundingBox: BoundingBox;
}

/**
 * Pure plain-data representation of a pattern piece snapshot with preserved geometric contours.
 */
export interface PatternPieceSnapshot {
  readonly id: string;
  readonly pieceCode: string;
  readonly name: string;
  readonly garmentCategory: GarmentCategory;
  readonly sizeCode: string;
  readonly cutCount: number;
  readonly onFold: boolean;
  readonly material: 'self' | 'lining' | 'interfacing';
  readonly cutPathData: string;
  readonly sewPathData: string;
  readonly seamAllowanceWidthCm: number;
  readonly grainline: GrainLine;
  readonly darts: readonly Dart[];
  readonly notches: readonly Notch[];
  readonly seams: readonly SeamLine[];
  readonly drillHoles?: readonly Point[];
  readonly boundingBox: BoundingBox;
  readonly description: string;
  readonly stitchingContour?: GeometricContourSnapshot;
  readonly cuttingContour?: GeometricContourSnapshot;
  readonly offsetDiagnostics?: readonly SegmentOffsetDiagnostic[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Drafting parameters used to generate the pattern piece geometry.
 */
export interface DraftingConfigurationSnapshot {
  readonly dartStyle?: BodiceDartStyle;
  readonly sleeveEaseStrategy?: SleeveEaseStrategy;
  readonly seamAllowanceCm?: number;
  readonly waistAllowanceCm?: number;
  readonly hemAllowanceCm?: number;
  readonly neckAllowanceCm?: number;
  readonly armholeAllowanceCm?: number;
  readonly shoulderAllowanceCm?: number;
  readonly bezierToleranceCm?: number;
  readonly miterLimit?: number;
  readonly categoryRegistryId?: string;
  readonly negativeEasePolicyApplied?: boolean;
  readonly customOptions?: Readonly<Record<string, unknown>>;
}

/**
 * Comprehensive approval state model separating structural, aesthetic, anatomical,
 * geometric, assembly, and physical validation gates from industrial production readiness.
 */
export interface ApprovalStateSummary {
  readonly designApproval: 'approved' | 'pending' | 'rejected';
  readonly measurementApproval: 'approved' | 'pending' | 'rejected';
  readonly patternGeometryValidation: 'validated' | 'invalid' | 'incomplete' | 'not_assessed';
  readonly assemblyValidation: 'verified-valid' | 'invalid' | 'unassessed-missing-data' | 'not-applicable';
  readonly gradingValidation: 'valid' | 'invalid' | 'unassessed' | 'not-applicable';
  readonly physicalPrototypeValidation:
    | 'conforming'
    | 'acceptable-with-adjustments'
    | 'non-conforming'
    | 'incomplete'
    | 'unsupported-validation-scope'
    | 'not-assessed';
}

/**
 * Provenance of the algorithmic engines producing the pattern revision.
 */
export interface EngineProvenanceRecord {
  readonly engineVersion: string;
  readonly appVersion?: string;
  readonly gitCommit?: string;
  readonly buildTimestamp?: string;
  readonly snapshotEngine: string;
}

/**
 * Optional summary of bodice-sleeve or component assembly compatibility.
 */
export interface AssemblySummarySnapshot {
  readonly status: AssemblyValidationStatus;
  readonly isValid: boolean;
  readonly totalBodiceArmholeLengthCm: number;
  readonly totalSleeveCapLengthCm: number;
  readonly totalEaseCm: number;
  readonly frontEaseCm: number;
  readonly backEaseCm: number;
  readonly frontEaseRatio: number | null;
  readonly isRatioDefined: boolean;
  readonly isDistributionBalanced: boolean;
  readonly isTotalEasePermitted: boolean;
  readonly targetStrategy: SleeveEaseStrategy;
  readonly endpointTopologyValid: boolean;
  readonly notchCorrespondenceStatus: string;
  readonly unresolvedRisks: readonly string[];
}

/**
 * Optional summary of size-range grading metrics and cross-size integrity.
 */
export interface GradingSummarySnapshot {
  readonly baseSize: string;
  readonly supportedSizes: readonly string[];
  readonly isOverallGradingValid: boolean;
  readonly validSizeCount: number;
  readonly failedSizeCount: number;
  readonly gradeTableName: string;
  readonly summaryMessage: string;
  readonly unassessedConditions: readonly string[];
}

/**
 * Master authoritative production pattern revision snapshot.
 * Binds project identity, design, measurements, material, geometry, validation, and provenance
 * into an immutable historical record.
 */
export interface ProductionPatternRevisionSnapshot {
  readonly schemaVersion: ProductionPatternSnapshotSchemaVersion;
  readonly projectId: string;
  readonly revisionId: string;
  readonly parentRevisionId?: string;
  readonly revisionIndex: number;
  readonly createdAt: string; // ISO 8601 date string
  readonly createdBy?: string;
  readonly garmentCategory: GarmentCategory;
  readonly targetSize: string;
  readonly designSpecification: DesignSpecificationSnapshot;
  readonly measurementSet: MeasurementSetSnapshot;
  readonly fabricSpecification: FabricSpecificationSnapshot;
  readonly patternPieces: readonly PatternPieceSnapshot[];
  readonly draftingConfiguration: DraftingConfigurationSnapshot;
  readonly validation: Readonly<ValidationReport>;
  readonly assemblySummary?: AssemblySummarySnapshot;
  readonly gradingSummary?: GradingSummarySnapshot;
  readonly engineProvenance: EngineProvenanceRecord;
  readonly approvalState: ApprovalStateSummary;
  /**
   * Industrial safety rule: isProductionReady MUST remain strictly false.
   * A snapshot represents a validated computational pattern, not certified production tooling.
   */
  readonly isProductionReady: false;
  /**
   * Deterministic SHA-256 fingerprint of the canonical snapshot data.
   */
  readonly canonicalFingerprint: string;
}

export type MismatchSeverity = 'breaking' | 'advisory';

/**
 * Structured diagnostic recording a difference between a revision snapshot and current inputs.
 */
export interface RevisionInputMismatch {
  readonly path: string;
  readonly field: string;
  readonly baselineValue: unknown;
  readonly currentValue: unknown;
  readonly severity: MismatchSeverity;
  readonly description: string;
}

/**
 * Result of comparing a saved revision snapshot against current input state.
 */
export interface RevisionComparisonResult {
  readonly isStale: boolean;
  readonly hasBreakingChanges: boolean;
  readonly mismatches: readonly RevisionInputMismatch[];
  readonly comparedAt: string;
}

/**
 * Result of validating the structural and semantic integrity of a revision snapshot.
 */
export interface RevisionValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly validatedAt: string;
}

/**
 * Input arguments for creating a ProductionPatternRevisionSnapshot.
 */
export interface CreateProductionPatternRevisionInput {
  readonly projectId: string;
  readonly revisionId?: string;
  readonly parentRevisionId?: string;
  readonly revisionIndex?: number;
  readonly createdAt?: string;
  readonly createdBy?: string;
  readonly targetSize: string;
  readonly designSpecification: DesignSpecification;
  readonly measurements: {
    readonly values: Record<string, number>;
    readonly defaultOrigin?: MeasurementOrigin;
    readonly perMeasurementOrigin?: Record<string, MeasurementOrigin>;
    readonly approval?: Partial<MeasurementApprovalRecord>;
    readonly notes?: string[];
  };
  readonly fabric: FabricProperty;
  readonly patternPieces: readonly PatternPiece[];
  readonly draftingConfiguration?: Partial<DraftingConfigurationSnapshot>;
  readonly validation: ValidationReport;
  readonly assemblySummary?: Partial<AssemblySummarySnapshot>;
  readonly gradingSummary?: Partial<GradingSummarySnapshot>;
  readonly engineProvenance?: Partial<EngineProvenanceRecord>;
  readonly physicalValidationStatus?:
    | 'conforming'
    | 'acceptable-with-adjustments'
    | 'non-conforming'
    | 'incomplete'
    | 'unsupported-validation-scope'
    | 'not-assessed';
}

/**
 * Inputs for checking if a snapshot is stale against current workspace state.
 */
export interface CurrentRevisionInputs {
  readonly designSpecification?: Partial<DesignSpecification>;
  readonly measurements?: {
    readonly values?: Record<string, number>;
    readonly defaultOrigin?: MeasurementOrigin;
    readonly perMeasurementOrigin?: Record<string, MeasurementOrigin>;
    readonly approval?: Partial<MeasurementApprovalRecord>;
  };
  readonly targetSize?: string;
  readonly fabric?: Partial<FabricProperty>;
  readonly draftingConfiguration?: Partial<DraftingConfigurationSnapshot>;
  readonly patternPieces?: readonly PatternPiece[];
  readonly engineVersion?: string;
}
