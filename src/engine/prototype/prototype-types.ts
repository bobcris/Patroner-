/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GarmentCategory } from '../../types';

export type MeasurementPointCategory =
  | 'circumference'
  | 'seam-length'
  | 'width'
  | 'vertical-length';

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

export type MeasurementPointStatus = 'pass' | 'warning' | 'fail';

export type OverallFitStatus =
  | 'conforming'                   // All measurement points within tolerance, zero critical defects
  | 'acceptable-with-adjustments' // Minor tolerances exceeded (< 1.5x) or minor visual feedback
  | 'non-conforming';              // Tolerance failure > 1.5x or critical physical fit defect

/**
 * An individual point-to-point measurement record comparing the digital CAD nominal value
 * with physical calipers / tape measurement taken on the sewn garment prototype.
 */
export interface MeasurementPointRecord {
  pointId: string;
  label: string;
  category: MeasurementPointCategory;
  nominalCadCm: number;       // Dimension from computational CAD geometry
  measuredPhysicalCm: number; // Dimension measured on physical sewn prototype
  toleranceCm: number;        // Manufacturing tolerance (e.g. 0.20cm for seams, 0.40cm for girth)
  deltaCm: number;            // measuredPhysicalCm - nominalCadCm
  status: MeasurementPointStatus;
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
  sampleGarmentName: string;
  garmentCategory: GarmentCategory;
  sizeCode: string;
  fabricId: string;
  fabricName: string;
  fabricLot: string;
  tailorName: string;
  dateSewn: string;
  measurements: MeasurementPointRecord[];
  observations: FitDefectObservation[];
  wearerFeedback?: string;
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
  maxAbsoluteDiscrepancyCm: number;
  meanAbsoluteDiscrepancyCm: number;
  criticalDefectCount: number;
  overallFitStatus: OverallFitStatus;
  measurements: MeasurementPointRecord[];
  observations: FitDefectObservation[];
  actionableCadCorrections: string[];
  summaryMessage: string;
  isProductionReady: false;
}
