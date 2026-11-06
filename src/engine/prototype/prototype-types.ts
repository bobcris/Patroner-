import { GarmentCategory } from '../../types';

export type MeasurementPointCategory =
  | 'circumference'
  | 'seam-length'
  | 'width'
  | 'vertical-length';

export type MeasurementPointSourceType =
  | 'physically-measured'
  | 'calculated'
  | 'estimated';

export type MeasurementMethod =
  | 'caliper'
  | 'measuring-tape'
  | '3d-scan'
  | 'optical-camera'
  | 'unspecified';

export type FitDefectLocation =
  | 'bust-apex'
  | 'waist'
  | 'side-seam'
  | 'armhole-scye'
  | 'sleeve-crown'
  | 'shoulder-slope'
  | 'neckline'
  | 'hem';

export type FitDefectType =
  | 'drag-lines'
  | 'tightness'
  | 'sagging'
  | 'puckering'
  | 'apex-offset'
  | 'gaping'
  | 'asymmetry'
  | 'hem-wave';

export type FitDefectSeverity =
  | 'negligible'
  | 'minor'
  | 'moderate'
  | 'critical';

export type MeasurementPointStatus = 'pass' | 'warning' | 'fail' | 'invalid';

/**
 * Strict status rules (Milestone 04.5.1 Audit):
 * - 'incomplete': required physical measurements are missing, empty, or invalid.
 * - 'conforming': all required evidence exists and applicable tolerance checks pass.
 * - 'acceptable-with-adjustments': valid evidence exists but advisory tolerances or non-critical observations need review.
 * - 'non-conforming': required checks fail or critical fit defects are observed.
 */
export type OverallFitStatus =
  | 'incomplete'
  | 'conforming'
  | 'acceptable-with-adjustments'
  | 'non-conforming';

export interface PairedSeamTolerancePolicy {
  sideSeamToleranceCm: number;     // Standard policy: 0.30 cm
  shoulderSeamToleranceCm: number; // Standard policy: 0.25 cm
  inseamToleranceCm: number;       // Standard policy: 0.30 cm
}

export const DEFAULT_PAIRED_SEAM_TOLERANCE_POLICY: PairedSeamTolerancePolicy = {
  sideSeamToleranceCm: 0.30,
  shoulderSeamToleranceCm: 0.25,
  inseamToleranceCm: 0.30
};

/**
 * An individual point-to-point measurement record comparing the digital CAD nominal value
 * with physical calipers / tape measurement taken on the sewn garment prototype.
 */
export interface MeasurementPointRecord {
  pointId: string;
  label: string;
  category: MeasurementPointCategory;
  nominalCadCm: number;       // Dimension from computational CAD geometry (> 0)
  measuredPhysicalCm: number; // Dimension measured on physical sewn prototype (> 0)
  toleranceCm: number;        // Manufacturing tolerance (>= 0)
  deltaCm: number;            // measuredPhysicalCm - nominalCadCm
  status: MeasurementPointStatus;
  sourceType: MeasurementPointSourceType;
  notes?: string;
}

/**
 * Qualitative visual and anatomical fit observation made during live mannequin or model fitting.
 */
export interface FitDefectObservation {
  observationId: string;
  location: FitDefectLocation;
  defectType: FitDefectType;
  severity: FitDefectSeverity;
  visualDescription: string;
  causeAnalysis: string;
  recommendedCadCorrection: string;
}

/**
 * Complete empirical record of a physical garment prototype.
 */
export interface PhysicalPrototypeRecord {
  id: string;
  patternDraftId: string;
  patternDraftRevision: string;   // Required revision link
  sampleGarmentName: string;
  garmentCategory: GarmentCategory;
  sizeCode: string;
  fabricId: string;
  fabricRevision?: string;        // Fabric revision link
  fabricName: string;
  fabricLot?: string;
  constructionDetails?: string;
  measurementDate: string;        // ISO 8601 date
  measurementMethod: MeasurementMethod;
  evaluatorIdentity?: string;     // Evaluator or sample room source
  measurements: MeasurementPointRecord[];
  observations: FitDefectObservation[];
  wearerFeedback?: string;
  isSyntheticTestFixture?: boolean; // Explicit flag for synthetic test fixtures
  /**
   * Safety invariant: prototype records never confer industrial production readiness.
   */
  isProductionReady: false;
}

/**
 * Comprehensive fit validation assessment comparing physical prototype evidence
 * with digital CAD requirements and providing actionable engineering corrections.
 */
export interface FitValidationReport {
  prototypeId: string;
  timestamp: string;
  sizeCode: string;
  fabricName: string;
  evaluatedPointsCount: number;
  passCount: number;
  warningCount: number;
  failCount: number;
  invalidCount: number;
  missingRequiredPoints: string[];
  maxAbsoluteDiscrepancyCm: number;
  meanAbsoluteDiscrepancyCm: number;
  criticalDefectCount: number;
  overallFitStatus: OverallFitStatus;
  measurements: MeasurementPointRecord[];
  observations: FitDefectObservation[];
  actionableCadCorrections: string[];
  summaryMessage: string;
  isSyntheticEvidence: boolean;
  isProductionReady: false;
}

