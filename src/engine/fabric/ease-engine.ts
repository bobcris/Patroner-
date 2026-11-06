import { BodyMeasurements, EaseProfile, FabricProperty, Silhouette, SleeveEaseStrategy } from '../../types';
import { EASE_TABLE, SLEEVE_EASE_TABLE } from '../measurements/standards';
import {
  EnhancedFabricProperty,
  FabricEaseBreakdown,
  MeasurementDirection
} from './fabric-types';
import { DEFAULT_ILLUSTRATIVE_FABRIC, getEnhancedFabricById } from './fabric-presets';

export interface EaseCalculationOptions {
  silhouette?: Silhouette;
  allowanceForShrinkage?: boolean;
  layerCount?: number; // For turn-of-cloth calculation (default: 1 layer)
  measurementDirection?: MeasurementDirection; // Default: 'circumference-crossgrain'
  negativeEasePolicyAllowed?: boolean; // Negative ease policy flag
  userExplicitConsentToDefaultFabric?: boolean; // Explicit opt-in for illustrative fallback
}

/**
 * Resolves enhanced fabric from input, requiring explicit user consent if falling back.
 */
function resolveEnhancedFabric(
  fabricInput?: FabricProperty | EnhancedFabricProperty,
  userExplicitConsentToDefaultFabric: boolean = false
): { fabric?: EnhancedFabricProperty; warning?: string; isFallback: boolean } {
  if (!fabricInput) {
    if (userExplicitConsentToDefaultFabric) {
      return {
        fabric: DEFAULT_ILLUSTRATIVE_FABRIC,
        warning: 'No fabric specified; using unverified illustrative project default with explicit user consent.',
        isFallback: true
      };
    }
    return {
      fabric: undefined,
      warning: 'Fabric specification missing. Explicit fabric selection required for physical ease calculations.',
      isFallback: false
    };
  }

  // If already an EnhancedFabricProperty with directional data
  if ('gsm' in fabricInput && 'directional' in fabricInput && fabricInput.directional) {
    return {
      fabric: fabricInput as EnhancedFabricProperty,
      isFallback: false
    };
  }

  // Lookup by ID
  const lookup = getEnhancedFabricById(fabricInput.id);
  if (lookup.status === 'found') {
    return {
      fabric: lookup.fabric,
      isFallback: false
    };
  }

  // Not found in presets
  if (userExplicitConsentToDefaultFabric) {
    return {
      fabric: DEFAULT_ILLUSTRATIVE_FABRIC,
      warning: `Fabric '${fabricInput.id ?? 'unknown'}' not found; using unverified illustrative default with explicit user consent.`,
      isFallback: true
    };
  }

  return {
    fabric: undefined,
    warning: `Fabric with ID '${fabricInput.id ?? 'unknown'}' not found in material library. Explicit selection required.`,
    isFallback: false
  };
}

/**
 * Calculates deterministic fabric-aware ease breakdown for a given body dimension.
 *
 * CRITICAL TEXTILE INTEGRITY PRINCIPLE (Milestone 04.5.1 Audit):
 * 1. Finished Garment Dimension = Body Measurement + Baseline Wearing Ease + Design Ease
 *                               + Thickness Allowance (Turn of Cloth) - Stretch Deduction.
 *    (Finished garment dimension is the dimension of the sewn, pressed garment when worn).
 * 2. Pre-Shrink Cutting Dimension = Finished Garment Dimension / (1 - Shrinkage Ratio).
 *    (Cutting dimension is the flat pattern dimension cut on fabric to allow for shrinkage).
 *    Shrinkage compensation is NEVER added to finished garment ease!
 */
export function calculateFabricAwareCircumferenceEase(
  circumferenceId: FabricEaseBreakdown['circumferenceId'],
  bodyValueCm: number,
  easeProfile: EaseProfile,
  fabricInput?: FabricProperty | EnhancedFabricProperty,
  options: EaseCalculationOptions = {}
): FabricEaseBreakdown {
  const measurementDirection: MeasurementDirection = options.measurementDirection ?? 'circumference-crossgrain';
  const provenanceNotes: string[] = [];
  const limitations: string[] = [
    'Stretch deduction uses provisional project model; not certified by tensile load-elongation curve testing.',
    'Turn-of-cloth model assumes uniform circular cylinder neutral axis shift (t/2).'
  ];

  const resolution = resolveEnhancedFabric(fabricInput, options.userExplicitConsentToDefaultFabric);
  if (resolution.warning) {
    provenanceNotes.push(resolution.warning);
  }

  const fabric = resolution.fabric;
  const isCalculationAvailable = fabric !== undefined;

  const baseEaseProfile = EASE_TABLE[easeProfile] ?? EASE_TABLE.classic;
  const baseEaseVal = (baseEaseProfile as any)[circumferenceId] ?? (circumferenceId === 'bust' ? 5.5 : 3.0);
  const baselineMovementEaseCm = Number(baseEaseVal.toFixed(2));

  // If fabric is unavailable, return baseline values with unavailable calculation flag
  if (!fabric) {
    return {
      circumferenceId,
      measurementDirection,
      bodyMeasurementCm: bodyValueCm,
      baselineMovementEaseCm,
      designEaseCm: 0,
      stretchDeductionCm: 0,
      thicknessAllowanceCm: 0,
      silhouetteAdjustmentCm: 0,
      totalAppliedEaseCm: baselineMovementEaseCm,
      finishedGarmentDimensionCm: Number((bodyValueCm + baselineMovementEaseCm).toFixed(2)),
      shrinkageRatio: 0,
      shrinkageCompensationCm: 0,
      preShrinkCuttingDimensionCm: Number((bodyValueCm + baselineMovementEaseCm).toFixed(2)),
      cuttingAllowanceFactor: 1.0,
      isCalculationAvailable: false,
      provenanceNotes,
      limitations
    };
  }

  if (fabric.auditWarnings && fabric.auditWarnings.length > 0) {
    provenanceNotes.push(...fabric.auditWarnings);
  }

  // 1. Directional Stretch Deduction
  // Determine relevant stretch according to grain direction
  let directionalStretchPercent = 0;
  let directionalRecoveryPercent = 80; // default 80% if unrecorded

  if (measurementDirection === 'circumference-crossgrain') {
    directionalStretchPercent = fabric.directional?.weft?.stretchPercent ?? 0;
    if (fabric.directional?.weft?.elasticRecoveryPercent !== undefined) {
      directionalRecoveryPercent = fabric.directional.weft.elasticRecoveryPercent;
    } else {
      provenanceNotes.push('Weft elastic recovery percent not recorded; provisional 80% recovery assumed.');
    }
  } else if (measurementDirection === 'length-grainline') {
    directionalStretchPercent = fabric.directional?.warp?.stretchPercent ?? 0;
    if (fabric.directional?.warp?.elasticRecoveryPercent !== undefined) {
      directionalRecoveryPercent = fabric.directional.warp.elasticRecoveryPercent;
    }
  } else {
    directionalStretchPercent = fabric.directional?.bias?.stretchPercent ?? 0;
  }

  let stretchDeductionCm = 0;
  const allowNegativeEase = options.negativeEasePolicyAllowed ?? (easeProfile === 'fitted' || directionalStretchPercent > 15.0);

  if (directionalStretchPercent > 3.0 && allowNegativeEase) {
    // Proportional stretch deduction: accounts for recovery factor and maximum 60% wearing ease absorption
    const recoveryRatio = directionalRecoveryPercent / 100;
    const stretchRatio = Math.min(0.60, (directionalStretchPercent - 3.0) * 0.025 * recoveryRatio);
    stretchDeductionCm = Number((baselineMovementEaseCm * stretchRatio).toFixed(2));
  }

  // 2. Turn-of-Cloth Thickness Allowance:
  // Outer layer wraps around thickness t. Circumference expansion = 2 * pi * (t/10) * 0.5 * layers
  const thicknessCm = (fabric.thicknessMm ?? 0.6) / 10;
  const layers = options.layerCount ?? 1;
  let thicknessAllowanceCm = 0;
  if (thicknessCm > 0.06) {
    thicknessAllowanceCm = Number((2 * Math.PI * thicknessCm * 0.5 * layers).toFixed(2));
  }

  // 3. Design Ease (Silhouette Adjustment)
  let designEaseCm = 0;
  if (options.silhouette === 'tailored') {
    designEaseCm = 0.5;
  } else if (options.silhouette === 'relaxed') {
    designEaseCm = 2.0;
  } else if (options.silhouette === 'pencil' || options.silhouette === 'straight') {
    designEaseCm = 0.0;
  } else if (options.silhouette === 'a-line' || options.silhouette === 'flared') {
    designEaseCm = circumferenceId === 'lowHip' ? 4.0 : 0.0;
  }

  // 4. Net Finished Garment Ease (Wearing Ease + Design Ease + Thickness Allowance - Stretch Deduction)
  // Shrinkage is EXCLUDED from finished garment ease
  const totalAppliedEaseCm = Number(
    (baselineMovementEaseCm + designEaseCm + thicknessAllowanceCm - stretchDeductionCm).toFixed(2)
  );

  // 5. Finished Garment Dimension (Body + Net Finished Ease)
  const finishedGarmentDimensionCm = Number((bodyValueCm + totalAppliedEaseCm).toFixed(2));

  // 6. Directional Shrinkage & Pre-Shrink Cutting Dimension
  // Pre-shrink cutting dimension = Finished Garment Dimension / (1 - shrinkage ratio)
  let directionalShrinkagePercent = 0;
  if (measurementDirection === 'circumference-crossgrain') {
    directionalShrinkagePercent = fabric.directional?.weft?.shrinkagePercent ?? 0;
  } else if (measurementDirection === 'length-grainline') {
    directionalShrinkagePercent = fabric.directional?.warp?.shrinkagePercent ?? 0;
  }

  let shrinkageRatio = 0;
  let cuttingAllowanceFactor = 1.0;
  let preShrinkCuttingDimensionCm = finishedGarmentDimensionCm;
  let shrinkageCompensationCm = 0;

  if (options.allowanceForShrinkage && directionalShrinkagePercent > 0) {
    shrinkageRatio = directionalShrinkagePercent / 100;
    if (shrinkageRatio < 0.99) {
      cuttingAllowanceFactor = Number((1 / (1 - shrinkageRatio)).toFixed(4));
      preShrinkCuttingDimensionCm = Number((finishedGarmentDimensionCm / (1 - shrinkageRatio)).toFixed(2));
      shrinkageCompensationCm = Number((preShrinkCuttingDimensionCm - finishedGarmentDimensionCm).toFixed(2));
    }
  }

  return {
    circumferenceId,
    measurementDirection,
    bodyMeasurementCm: bodyValueCm,
    baselineMovementEaseCm,
    designEaseCm,
    stretchDeductionCm,
    thicknessAllowanceCm,
    silhouetteAdjustmentCm: designEaseCm,
    totalAppliedEaseCm,
    finishedGarmentDimensionCm,
    shrinkageRatio,
    shrinkageCompensationCm,
    preShrinkCuttingDimensionCm,
    cuttingAllowanceFactor,
    isCalculationAvailable: true,
    provenanceNotes,
    limitations
  };
}

/**
 * Calculates recommended sleeve cap ease adapted to fabric molding capacity.
 * Structured wools with high molding factors can absorb up to +3.5cm cap ease cleanly.
 * Low-molding silks or stiff denims require lower cap ease to avoid crimp puckering.
 */
export function calculateFabricAdaptedSleeveCapEase(
  strategy: SleeveEaseStrategy,
  fabricInput?: FabricProperty | EnhancedFabricProperty,
  options: { userExplicitConsentToDefaultFabric?: boolean } = {}
): {
  baseStrategyEaseCm: number;
  adaptedCapEaseCm: number;
  minCapEaseCm: number;
  maxCapEaseCm: number;
  moldingFactor: number;
  crimpCapacityDescription: string;
  isCalculationAvailable: boolean;
  notes: string[];
} {
  const resolution = resolveEnhancedFabric(fabricInput, options.userExplicitConsentToDefaultFabric);
  const strategyParams = SLEEVE_EASE_TABLE[strategy] ?? SLEEVE_EASE_TABLE.classic;
  const baseEase = strategyParams.recommendedCapEaseCm;
  const notes: string[] = [
    'Molding factor ease scaling is a provisional project formula based on atelier practice, not finite-element analysis.'
  ];

  if (resolution.warning) {
    notes.push(resolution.warning);
  }

  if (!resolution.fabric) {
    return {
      baseStrategyEaseCm: baseEase,
      adaptedCapEaseCm: baseEase,
      minCapEaseCm: strategyParams.capEaseMinCm,
      maxCapEaseCm: strategyParams.capEaseMaxCm,
      moldingFactor: 1.0,
      crimpCapacityDescription: 'Standard sleeve cap ease; fabric moldability unassessed.',
      isCalculationAvailable: false,
      notes
    };
  }

  const molding = resolution.fabric.moldingFactor ?? 1.0;
  const rawAdapted = baseEase * molding;
  const adaptedCapEaseCm = Number(
    Math.max(strategyParams.capEaseMinCm, Math.min(strategyParams.capEaseMaxCm, rawAdapted)).toFixed(2)
  );

  let crimpCapacityDescription = 'Balanced daywear cap ease distribution';
  if (molding >= 1.2) {
    crimpCapacityDescription = 'High steam-molding capacity: ease will shrink smoothly with iron shaping without crimping.';
  } else if (molding < 0.8) {
    crimpCapacityDescription = 'Low moldability: cap ease must be restricted to prevent puckering along the armhole seam.';
  }

  return {
    baseStrategyEaseCm: baseEase,
    adaptedCapEaseCm,
    minCapEaseCm: strategyParams.capEaseMinCm,
    maxCapEaseCm: strategyParams.capEaseMaxCm,
    moldingFactor: molding,
    crimpCapacityDescription,
    isCalculationAvailable: true,
    notes
  };
}

/**
 * Comprehensive fabric-aware garment ease summary across all primary circumferences.
 */
export function calculateCompleteGarmentEase(
  measurements: BodyMeasurements,
  easeProfile: EaseProfile,
  fabricInput?: FabricProperty | EnhancedFabricProperty,
  options: EaseCalculationOptions = {}
): Record<'bust' | 'waist' | 'lowHip', FabricEaseBreakdown> {
  const bustVal = measurements.bust ?? 90;
  const waistVal = measurements.waist;
  const hipVal = measurements.lowHip;

  return {
    bust: calculateFabricAwareCircumferenceEase('bust', bustVal, easeProfile, fabricInput, options),
    waist: calculateFabricAwareCircumferenceEase('waist', waistVal, easeProfile, fabricInput, options),
    lowHip: calculateFabricAwareCircumferenceEase('lowHip', hipVal, easeProfile, fabricInput, options)
  };
}

