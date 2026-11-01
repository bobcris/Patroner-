/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeometricContour } from '../engine/geometry/primitives';

export type GarmentCategory = 'skirt' | 'bodice' | 'trouser' | 'dress';

export type OffsetStatus = 'success' | 'warning' | 'failure';

export interface SegmentOffsetDiagnostic {
  sourceSegmentId: string;
  status: OffsetStatus;
  maxDeviationCm: number;
  toleranceCm: number;
  failureReason?: string;
}

export interface OffsetResult {
  status: OffsetStatus;
  cuttingContour: GeometricContour;
  maxDeviationCm: number;
  toleranceExceeded: boolean;
  approximationMethod: string;
  diagnostics?: SegmentOffsetDiagnostic[];
  warnings: string[];
  errors: string[];
}

export type Silhouette = 
  | 'a-line' 
  | 'straight' 
  | 'pencil' 
  | 'flared' 
  | 'tailored' 
  | 'relaxed' 
  | 'wrap';

export type FabricWeight = 'lightweight' | 'medium' | 'heavy';
export type FabricStretch = 'none' | 'mechanical' | 'low-stretch' | 'high-stretch';

export interface FabricProperty {
  id: string;
  name: string;
  composition: string;
  weight: FabricWeight;
  stretch: FabricStretch;
  recommendedEaseCm: {
    waist: number;
    hip: number;
    bust?: number;
  };
  drapeDescription: string;
}

export type EaseProfile = 'ultra-fitted' | 'fitted' | 'classic' | 'relaxed' | 'oversized';

export interface GarmentConstructionFeature {
  id: string;
  category: 'closure' | 'waistband' | 'pocket' | 'hem' | 'dart' | 'vent' | 'neckline';
  name: string;
  description: string;
  patternImpact: string;
}

export interface DesignSpecification {
  id: string;
  name: string;
  prompt: string;
  garmentCategory: GarmentCategory;
  silhouette: Silhouette;
  fabric: FabricProperty;
  color: {
    name: string;
    hex: string;
  };
  easeProfile: EaseProfile;
  lengthCm: number;
  constructionFeatures: GarmentConstructionFeature[];
  designNotes: string[];
  isApproved: boolean;
  approvedAt?: string;
  version: number;
  /**
   * Clearly separated AI-inferred proposals before human validation
   */
  aiEstimates?: {
    suggestedSilhouette: string;
    styleConfidenceScore: number;
    suggestedFabrics: string[];
    technicalAdvice: string;
    disclaimer: string;
  };
}

export interface BodyMeasurements {
  unit: 'cm';
  height?: number;
  bust?: number;
  waist: number;
  highHip: number;
  lowHip: number;
  waistToHip: number;
  skirtLength: number;
  backWaistLength?: number;
  frontWaistLength?: number;
  acrossBack?: number;
  shoulderLength?: number;
}

export type StandardSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';

export interface SizingStandard {
  standardName: string;
  system: 'European ISO/EN 13402 Reference Table (cm)';
  sizes: Record<StandardSize, BodyMeasurements>;
  description: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Dart {
  id: string;
  apex: Point;
  legLeft: Point;
  legRight: Point;
  widthCm: number;
  lengthCm: number;
}

export interface Notch {
  id: string;
  position: Point;
  normalAngleDeg: number;
  type: 'single' | 'double' | 'fold';
  label?: string;
}

export interface GrainLine {
  start: Point;
  end: Point;
  direction: 'vertical' | 'horizontal' | 'bias';
}

export interface SeamLine {
  id: string;
  name: string;
  startPoint: Point;
  endPoint: Point;
  lengthCm: number;
  type: 'straight' | 'curved';
  pathData?: string;
  startTangent?: Point;
  endTangent?: Point;
  pairedPieceId?: string;
  pairedSeamName?: string;
  segmentId?: string;
  segmentIds?: string[];
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  widthCm: number;
  heightCm: number;
}

export interface PatternPiece {
  id: string;
  pieceCode: string;
  name: string;
  garmentCategory: GarmentCategory;
  cutCount: number;
  onFold: boolean;
  material: 'self' | 'lining' | 'interfacing';
  /**
   * Primary cut seam path (coordinates in cm, scaled for SVG display)
   */
  cutPathData: string;
  /**
   * Sewing line / interior stitch line (seam allowance subtracted)
   */
  sewPathData: string;
  seamAllowanceWidthCm: number;
  grainline: GrainLine;
  darts: Dart[];
  notches: Notch[];
  seams: SeamLine[];
  boundingBox: BoundingBox;
  drillHoles?: Point[];
  description: string;
  stitchingContour?: GeometricContour;
  cuttingContour?: GeometricContour;
  offsetResult?: OffsetResult;
}

export type ValidationStatus = 'validated' | 'invalid' | 'incomplete' | 'not_assessed';

export interface UnassessedCondition {
  id: string;
  name: string;
  reason: string;
  milestonePrerequisite: string;
}

export interface ValidationCheck {
  id: string;
  category: 'seam-match' | 'dart-closure' | 'grainline' | 'allowance' | 'geometry' | 'tangency' | 'contour-integrity' | 'offset';
  name: string;
  status: 'pass' | 'warning' | 'fail';
  errorCode?: string;
  severity?: 'error' | 'warning' | 'info';
  segmentIds?: string[];
  suggestedAction?: string;
  measuredValue?: string;
  expectedValue?: string;
  deviationCm?: number;
  toleranceCm?: number;
  message: string;
}

export interface ValidationReport {
  status: ValidationStatus;
  isValid: boolean;
  isProductionReady: boolean;
  statusLabel: string;
  timestamp: string;
  passedCount: number;
  warningCount: number;
  failureCount: number;
  checks: ValidationCheck[];
  unassessedConditions: UnassessedCondition[];
  declaration: string;
}

export interface PatternDraft {
  id: string;
  designSpecId: string;
  designName: string;
  garmentCategory: GarmentCategory;
  createdAt: string;
  version: number;
  sizeLabel: string;
  bodyMeasurements: BodyMeasurements;
  appliedEaseCm: {
    waist: number;
    hip: number;
  };
  finishedGarmentMeasurements: {
    waistCircumferenceCm: number;
    hipCircumferenceCm: number;
    totalLengthCm: number;
  };
  pieces: PatternPiece[];
  validation: ValidationReport;
}
