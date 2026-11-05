/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodiceDartStyle,
  BodyMeasurements,
  Dart,
  DesignSpecification,
  GarmentCategory,
  Notch,
  PatternPiece,
  SeamLine,
  SleeveEaseStrategy,
  StandardSize
} from '../../types';
import {
  BodiceSleeveAssemblyResult,
  EaseCompatibilityMetrics,
  AssemblyValidationStatus
} from '../assembly/assembly-types';

/**
 * Directional distribution of a measurement increment across anatomical axes.
 */
export type GradeIncrementDistribution =
  | 'circumference-symmetric' // Distributed 50% front / 50% back (or quartered)
  | 'vertical-linear'         // Applied along vertical longitudinal body axis
  | 'bilateral-symmetric'     // Distributed equally to left and right
  | 'proportional-radial';    // Distributed radially around apex/scye

/**
 * Definition of an individual anthropometric grade rule.
 */
export interface MeasurementGradeRule {
  measurementId: keyof Omit<BodyMeasurements, 'unit'>;
  label: string;
  unit: 'cm';
  /**
   * Reference baseline body measurement value for base size M in centimetres (strictly positive).
   */
  baseSizeValue: number;
  /**
   * Differential increments (deltas) in centimetres relative to base size M (baseSizeValue).
   * Keyed by size identifier (e.g. 'XS', 'S', 'M', 'L', 'XL', 'XXL').
   * - Negative values (e.g. XS: -10, S: -6) indicate reductions below base size M.
   * - Positive values (e.g. L: +8, XL: +16, XXL: +26) indicate expansions above base size M.
   * - Actual size circumference = baseSizeValue + incrementsFromBase[sizeId].
   * - CRITICAL: These values are strictly delta offsets (Δ), NEVER raw anatomical circumferences.
   */
  incrementsFromBase: Record<string, number>;
  distribution: GradeIncrementDistribution;
  source: 'Patroner Project-Defined Default' | 'User-Defined' | 'Provisional' | 'EN 13402 Reference Interval';
  isStandard: boolean;
  isAuthoritative: boolean; // True only if directly transcribed from a codified national/international standard
  applicableCategory: GarmentCategory | 'all';
  description: string;
}

/**
 * Grade table configuration associating a base size with a set of measurement grade rules.
 */
export interface MeasurementGradeTable {
  id: string;
  name: string;
  baseSize: string;
  supportedSizes: string[];
  rules: Record<string, MeasurementGradeRule>;
  description: string;
  isAuthoritative?: boolean;
}

/**
 * Input options to configure the grading engine.
 */
export interface GradingOptions {
  baseSize?: string;
  targetSizes?: string[];
  customMeasurements?: Record<string, BodyMeasurements>;
  customGradeTable?: MeasurementGradeTable;
  sleeveEaseStrategy?: SleeveEaseStrategy;
  bodiceDartStyle?: BodiceDartStyle;
  bezierToleranceCm?: number;
  isCustomDataset?: boolean;
  gradingContext?: 'standard-chart' | 'custom-table' | 'individual-custom';
}

/**
 * Summary metrics of a single pattern piece in a graded size.
 */
export interface GradedPieceMetrics {
  pieceId: string;
  pieceCode: string;
  pieceName: string;
  widthCm: number;
  heightCm: number;
  areaCm2: number;
  perimeterCm: number;
  vertexCount: number;
  isContourClosed: boolean;
}

/**
 * Detailed grading result for a single target size.
 */
export interface GradedSizeResult {
  sizeId: string;
  isBaseSize: boolean;
  measurements: BodyMeasurements;
  measurementDeltasFromBase: Record<string, number>;
  bodicePieces: PatternPiece[];
  sleevePiece?: PatternPiece;
  darts: Dart[];
  seams: SeamLine[];
  notches: Notch[];
  pieceMetrics: GradedPieceMetrics[];
  assemblyResult?: BodiceSleeveAssemblyResult;
  easeMetrics?: EaseCompatibilityMetrics;
  status: AssemblyValidationStatus;
  isValid: boolean;
  isProductionReady: false; // Mandatory industrial constraint
  errors: string[];
  warnings: string[];
}

/**
 * Single cross-size anomaly or integrity check record.
 */
export interface CrossSizeCheck {
  id: string;
  name: string;
  category: 'measurement' | 'geometry' | 'dart' | 'seam' | 'notch' | 'assembly';
  status: 'pass' | 'warning' | 'fail';
  affectedSizes: string[];
  message: string;
  expectedBehavior: string;
  observedValues?: Record<string, string | number>;
}

/**
 * Cross-size matrix row comparing a specific metric across all generated sizes.
 */
export interface CrossSizeComparisonRow {
  metricId: string;
  label: string;
  unit: string;
  category: 'measurement' | 'pattern-dimension' | 'seam-length' | 'ease';
  valuesPerSize: Record<string, number | null>;
  isMonotonic: boolean;
  varianceNote?: string;
}

/**
 * Comprehensive cross-size geometric and assembly integrity report.
 */
export interface CrossSizeIntegrityReport {
  timestamp: string;
  baseSize: string;
  evaluatedSizes: string[];
  validSizeCount: number;
  failedSizeCount: number;
  unassessedSizeCount: number;
  isOverallGradingValid: boolean;
  checks: CrossSizeCheck[];
  comparisonTable: CrossSizeComparisonRow[];
  summaryMessage: string;
  unassessedConditions: string[];
  gradingContext?: 'standard-chart' | 'custom-table' | 'individual-custom';
  isCustomDataset?: boolean;
}

/**
 * Complete output bundle produced by the Pattern Grading Engine.
 */
export interface GradedPatternSet {
  id: string;
  timestamp: string;
  garmentCategory: GarmentCategory;
  silhouette: string;
  baseSize: string;
  supportedSizes: string[];
  designSpec: DesignSpecification;
  sizeResults: Record<string, GradedSizeResult>;
  integrityReport: CrossSizeIntegrityReport;
  gradeTable: MeasurementGradeTable;
  isAllValid: boolean;
  isProductionReady: false;
}
