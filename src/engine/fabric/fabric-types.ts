/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FabricProperty, FabricStretch, FabricWeight } from '../../types';

export type FabricProvenance =
  | 'supplier-declared'
  | 'laboratory-tested'
  | 'user-entered'
  | 'project-default';

export type FabricTestStandard =
  | 'ISO 5077 / ISO 3759 (Dimensional Stability / Shrinkage)'
  | 'ISO 13934 (Tensile Properties)'
  | 'ASTM D1388 / ISO 9073 (Bending & Drape)'
  | 'ASTM D3887 (Knitted Fabric Stretch)'
  | 'Internal Atelier Standard';

/**
 * Directional mechanical properties along warp (grainline), weft (crossgrain), and bias.
 */
export interface DirectionalProperties {
  /**
   * Lengthwise grainline direction (parallel to warp / selvage).
   */
  warp: {
    shrinkagePercent: number; // Thermal/steam relaxation shrinkage (%) [0, 15]
    stretchPercent: number;   // Mechanical elongation under standard tension (%) [0, 50]
    tensileModulusN?: number; // Optional tensile resistance in Newtons
  };
  /**
   * Crosswise grain direction (perpendicular to warp, weft / fill).
   */
  weft: {
    shrinkagePercent: number; // Thermal/steam relaxation shrinkage (%) [0, 15]
    stretchPercent: number;   // Crosswise elongation under standard tension (%) [0, 100]
    tensileModulusN?: number;
  };
  /**
   * 45-degree true bias direction.
   */
  bias: {
    stretchPercent: number;    // Bias stretchability (%) [0, 120]
    drapeCoefficient?: number; // Cusick drape coefficient [0.10, 0.95] (0.1 = limp liquid, 0.95 = stiff paper)
  };
}

/**
 * Enhanced fabric specification extending baseline FabricProperty with
 * directional physical behavior, GSM, thickness, and audit provenance.
 */
export interface EnhancedFabricProperty extends FabricProperty {
  /**
   * Areal density in grams per square metre (g/m²).
   */
  gsm: number;
  /**
   * Caliper thickness in millimetres (mm) under 0.5 kPa standard presser foot.
   */
  thicknessMm: number;
  /**
   * Directional shrinkage and stretch parameters.
   */
  directional: DirectionalProperties;
  /**
   * Ease molding factor for sleeve caps and contoured darts.
   * High values (> 1.1) denote wools that shrink/ease easily with steam.
   * Low values (< 0.8) denote dense/slippery fabrics prone to puckering under ease.
   */
  moldingFactor: number;
  /**
   * Provenance of the physical properties data.
   */
  provenance: FabricProvenance;
  /**
   * Reference test standard used for physical testing.
   */
  testStandard?: FabricTestStandard;
  /**
   * Verification status of laboratory or supplier data.
   */
  isVerified: boolean;
  /**
   * Optional notes on fabric handling, pressing temperature, and needle selection.
   */
  handlingNotes?: string[];
}

export interface FabricValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fabric: EnhancedFabricProperty;
}

/**
 * Breakdown of deterministic ease components calculated for a pattern piece or circumference.
 */
export interface FabricEaseBreakdown {
  circumferenceId: 'bust' | 'waist' | 'lowHip' | 'biceps' | 'wrist';
  bodyMeasurementCm: number;
  baselineMovementEaseCm: number; // Physiological movement ease
  stretchDeductionCm: number;     // Negative deduction to compensate for weft stretch
  shrinkageCompensationCm: number;// Positive addition to compensate for steam/laundry shrinkage
  thicknessAllowanceCm: number;   // Turn-of-cloth circumference expansion
  silhouetteAdjustmentCm: number; // Silhouette-specific ease profile offset
  totalAppliedEaseCm: number;     // Net ease added to body measurement
  finishedGarmentDimensionCm: number; // Final target pattern circumference
  cuttingAllowanceFactor: number; // Scale multiplier applied to pattern cutting line for shrinkage
}
