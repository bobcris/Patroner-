/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FabricProperty, FabricStretch, FabricWeight, EaseProfile } from '../../types';

export type FabricProvenance =
  | 'supplier-declared'
  | 'laboratory-tested'
  | 'user-entered'
  | 'project-default';

export type PropertySourceType =
  | 'laboratory-measured'
  | 'supplier-declared'
  | 'user-measured'
  | 'user-entered'
  | 'project-default'
  | 'estimated'
  | 'unknown';

export type PropertyVerificationStatus = 'verified' | 'unverified' | 'provisional';

export type FabricTestStandard =
  | 'ISO 5077 / ISO 3759 (Dimensional Stability / Shrinkage)'
  | 'ISO 13934 (Tensile Properties)'
  | 'ASTM D1388 / ISO 9073 (Bending & Drape)'
  | 'ASTM D3887 (Knitted Fabric Stretch)'
  | 'Internal Atelier Standard';

/**
 * Property-level audit provenance recording exact measurement origin and conditions.
 */
export interface PropertyProvenance<T = number> {
  value: T;
  unit: string;
  sourceType: PropertySourceType;
  sourceReference?: string;
  date?: string;
  testStandard?: string;
  testConditions?: string;
  verificationStatus: PropertyVerificationStatus;
}

export interface FabricPropertyProvenanceRecord {
  gsm?: PropertyProvenance<number>;
  thicknessMm?: PropertyProvenance<number>;
  warpShrinkage?: PropertyProvenance<number>;
  warpStretch?: PropertyProvenance<number>;
  weftShrinkage?: PropertyProvenance<number>;
  weftStretch?: PropertyProvenance<number>;
  biasStretch?: PropertyProvenance<number>;
  moldingFactor?: PropertyProvenance<number>;
}

/**
 * Directional mechanical properties along warp (grainline), weft (crossgrain), and bias.
 */
export interface DirectionalProperties {
  /**
   * Lengthwise grainline direction (parallel to warp / selvage).
   */
  warp: {
    shrinkagePercent: number; // Thermal/steam relaxation shrinkage (%) [0, 25]
    stretchPercent: number;   // Mechanical elongation under standard tension (%) [0, 50]
    tensileModulusN?: number; // Optional tensile resistance in Newtons
    elasticRecoveryPercent?: number; // Elastic recovery ratio (0-100%)
  };
  /**
   * Crosswise grain direction (perpendicular to warp, weft / fill).
   */
  weft: {
    shrinkagePercent: number; // Thermal/steam relaxation shrinkage (%) [0, 25]
    stretchPercent: number;   // Crosswise elongation under standard tension (%) [0, 100]
    tensileModulusN?: number;
    elasticRecoveryPercent?: number; // Elastic recovery ratio (0-100%)
  };
  /**
   * 45-degree true bias direction.
   */
  bias: {
    stretchPercent: number;    // Bias stretchability (%) [0, 120]
    drapeCoefficient?: number; // Cusick drape coefficient [0.05, 1.0]
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
   * Record-level provenance of the physical properties data.
   */
  provenance: FabricProvenance;
  /**
   * Reference test standard used for physical testing (only valid if laboratory-tested).
   */
  testStandard?: FabricTestStandard;
  /**
   * Verification status of laboratory or supplier data.
   */
  isVerified: boolean;
  /**
   * Explicit flag identifying illustrative project references.
   */
  isIllustrativeReference?: boolean;
  /**
   * Detailed property-level provenance map for full scientific traceability.
   */
  propertyProvenance?: FabricPropertyProvenanceRecord;
  /**
   * Associated revision or lot reference.
   */
  revision?: string;
  /**
   * Audit warnings or cautions for computational patternmaking.
   */
  auditWarnings?: string[];
  /**
   * Optional notes on fabric handling, pressing temperature, and needle selection.
   */
  handlingNotes?: string[];
}

export type FabricLookupResult =
  | { status: 'found'; fabric: EnhancedFabricProperty }
  | { status: 'not-found'; fabricId?: string; message: string }
  | { status: 'invalid-record'; fabric: EnhancedFabricProperty; errors: string[] };

export interface FabricValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fabric: EnhancedFabricProperty;
}

export type MeasurementDirection = 'circumference-crossgrain' | 'length-grainline' | 'bias';

/**
 * Explicit authorization policy for negative ease calculations.
 * Negative ease reduces finished garment dimensions below anatomical body measurements.
 * It must never be applied implicitly from fabric stretch or fitted profiles alone.
 */
export interface NegativeEaseAuthorizationPolicy {
  /**
   * Explicit authorization flag. Default is false.
   */
  isAuthorized: boolean;
  /**
   * Target garment category (e.g. 'bodice', 'activewear', 'swimwear', 'all').
   */
  garmentCategory: string;
  /**
   * Construction or fit intent (e.g. 'compression-fit', 'corsetry', 'performance-knit').
   */
  fitIntent: string;
  /**
   * Maximum permitted negative ease percentage (e.g. 5.0 for -5% body circumference).
   */
  maxPermittedNegativeEasePercent: number;
  /**
   * Optional maximum negative ease in absolute cm (e.g. 3.0 cm).
   */
  maxPermittedNegativeEaseCm?: number;
  /**
   * Minimum directional stretch percentage required by policy to activate negative ease.
   */
  minimumRequiredStretchPercent: number;
  /**
   * Minimum elastic recovery percentage required by policy to activate negative ease.
   */
  minimumRequiredRecoveryPercent: number;
  /**
   * Name or role of the user or authority approving negative ease.
   */
  authorizedBy: string;
  /**
   * Source and provenance documentation authorizing negative ease (e.g. ticket ID, spec standard).
   */
  sourceAndProvenance: string;
  /**
   * Date authorization was granted (ISO format).
   */
  authorizationDate?: string;
}

/**
 * Explicit provisional elastic recovery policy.
 * When laboratory recovery data is missing, recovery-based stretch deductions cannot occur
 * unless an authorized provisional policy is explicitly selected.
 */
export interface ProvisionalRecoveryPolicy {
  /**
   * Whether provisional recovery estimation is permitted.
   */
  allowProvisionalRecovery: boolean;
  /**
   * Provisional recovery percentage to apply (0-100%).
   */
  provisionalRecoveryPercent: number;
  /**
   * Explicit confirmation that the user approved this assumption.
   */
  userApproved: boolean;
  /**
   * Rationale for applying provisional estimation.
   */
  reason: string;
  /**
   * Name of user approving the provisional policy.
   */
  approvedBy?: string;
}

/**
 * Breakdown of input data sources for complete calculation auditability.
 */
export interface InputProvenanceSummary {
  measuredInputs: string[];
  supplierDeclaredInputs: string[];
  projectDefaultInputs: string[];
  estimatedInputs: string[];
  explicitUserAssumptions: string[];
  calculatedOutputs: string[];
}

/**
 * Breakdown of deterministic ease components calculated for a pattern piece or circumference.
 * Distinguishes Finished Garment Dimension from Pre-Shrink Cutting Dimension.
 */
export interface FabricEaseBreakdown {
  circumferenceId: 'bust' | 'waist' | 'lowHip' | 'biceps' | 'wrist';
  measurementDirection: MeasurementDirection;
  bodyMeasurementCm: number;
  baselineMovementEaseCm: number; // Physiological wearing movement ease
  designEaseCm: number;           // Silhouette-specific design ease offset
  stretchDeductionCm: number;     // Negative deduction to compensate for directional stretch
  thicknessAllowanceCm: number;   // Turn-of-cloth circumference expansion
  silhouetteAdjustmentCm: number; // Retained for compatibility (equal to designEaseCm)
  totalAppliedEaseCm: number;     // Net finished ease added to body measurement (excluding shrinkage)
  finishedGarmentDimensionCm: number; // Final target finished garment circumference: Body + Ease
  shrinkageRatio: number;         // Decimal shrinkage ratio [0, 1)
  shrinkageCompensationCm: number;// Pre-shrink dimensional increase added to cutting pattern
  preShrinkCuttingDimensionCm: number; // Dimension to cut on flat pattern before wash/press: Finished / (1 - shrinkage)
  cuttingAllowanceFactor: number; // Scale multiplier applied to pattern cutting line for shrinkage (1 / (1 - r))
  isCalculationAvailable: boolean;
  unavailableReason?: string;
  isProvisionalCalculation?: boolean;
  provisionalReason?: string;
  negativeEasePolicyApplied?: NegativeEaseAuthorizationPolicy;
  inputProvenanceSummary?: InputProvenanceSummary;
  provenanceNotes: string[];
  limitations: string[];
}

