/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, EaseProfile, FabricProperty, Silhouette, SleeveEaseStrategy } from '../../types';
import { EASE_TABLE, SLEEVE_EASE_TABLE } from '../measurements/standards';
import { EnhancedFabricProperty, FabricEaseBreakdown } from './fabric-types';
import { getEnhancedFabricById } from './fabric-presets';

export interface EaseCalculationOptions {
  silhouette?: Silhouette;
  allowanceForShrinkage?: boolean;
  layerCount?: number; // For turn-of-cloth calculation (default: 1 layer)
}

/**
 * Calculates deterministic fabric-aware ease breakdown for a given body circumference.
 * Equation:
 *   Total Applied Ease = Baseline Movement Ease
 *                      - Stretch Deduction (from crosswise weft stretch)
 *                      + Shrinkage Compensation (from steam/wash shrinkage)
 *                      + Thickness Allowance (turn of cloth = 2 * pi * t * layers)
 *                      + Silhouette Adjustment
 */
export function calculateFabricAwareCircumferenceEase(
  circumferenceId: FabricEaseBreakdown['circumferenceId'],
  bodyValueCm: number,
  easeProfile: EaseProfile,
  fabricInput?: FabricProperty | EnhancedFabricProperty,
  options: EaseCalculationOptions = {}
): FabricEaseBreakdown {
  const fabric: EnhancedFabricProperty =
    (fabricInput && 'gsm' in fabricInput && 'directional' in fabricInput)
      ? (fabricInput as EnhancedFabricProperty)
      : getEnhancedFabricById(fabricInput?.id);

  const baseEaseProfile = EASE_TABLE[easeProfile] ?? EASE_TABLE.classic;
  const baseEaseVal = (baseEaseProfile as any)[circumferenceId] ?? (circumferenceId === 'bust' ? 5.5 : 3.0);

  // 1. Baseline physiological movement ease
  const baselineMovementEaseCm = Number(baseEaseVal.toFixed(2));

  // 2. Stretch Deduction:
  // If fabric has significant weft stretch (e.g. knit or stretch woven), reduce ease.
  // Elastic recovery means garment does not require as much positive ease to move.
  const weftStretch = fabric.directional?.weft?.stretchPercent ?? 0;
  let stretchDeductionCm = 0;
  if (weftStretch > 3.0) {
    // Proportional stretch deduction: max 60% of baseline ease or 0.08cm per % stretch
    const stretchRatio = Math.min(0.60, (weftStretch - 3.0) * 0.025);
    stretchDeductionCm = Number((baselineMovementEaseCm * stretchRatio).toFixed(2));
  }

  // 3. Shrinkage Compensation:
  // If fabric shrinks under steam pressing, positive allowance must be added to cutting pattern.
  const weftShrinkage = fabric.directional?.weft?.shrinkagePercent ?? 0;
  let shrinkageCompensationCm = 0;
  let cuttingAllowanceFactor = 1.0;
  if (options.allowanceForShrinkage && weftShrinkage > 0) {
    const shrinkageRatio = weftShrinkage / 100;
    cuttingAllowanceFactor = Number((1 / (1 - shrinkageRatio)).toFixed(4));
    shrinkageCompensationCm = Number((bodyValueCm * (shrinkageRatio / (1 - shrinkageRatio))).toFixed(2));
  }

  // 4. Turn-of-Cloth Thickness Allowance:
  // Outer layer wraps around thickness t. Circumference delta = 2 * pi * thickness (in cm)
  const thicknessCm = (fabric.thicknessMm ?? 0.6) / 10;
  const layers = options.layerCount ?? 1;
  let thicknessAllowanceCm = 0;
  if (thicknessCm > 0.06) {
    // Apply for fabrics thicker than 0.6 mm
    thicknessAllowanceCm = Number((2 * Math.PI * thicknessCm * 0.5 * layers).toFixed(2));
  }

  // 5. Silhouette Adjustment:
  let silhouetteAdjustmentCm = 0;
  if (options.silhouette === 'tailored') {
    silhouetteAdjustmentCm = 0.5;
  } else if (options.silhouette === 'relaxed') {
    silhouetteAdjustmentCm = 2.0;
  } else if (options.silhouette === 'pencil' || options.silhouette === 'straight') {
    silhouetteAdjustmentCm = 0.0;
  } else if (options.silhouette === 'a-line' || options.silhouette === 'flared') {
    silhouetteAdjustmentCm = circumferenceId === 'lowHip' ? 4.0 : 0.0;
  }

  // Net total applied ease
  const totalAppliedEaseCm = Number(
    (baselineMovementEaseCm - stretchDeductionCm + shrinkageCompensationCm + thicknessAllowanceCm + silhouetteAdjustmentCm).toFixed(2)
  );

  const finishedGarmentDimensionCm = Number((bodyValueCm + totalAppliedEaseCm).toFixed(2));

  return {
    circumferenceId,
    bodyMeasurementCm: bodyValueCm,
    baselineMovementEaseCm,
    stretchDeductionCm,
    shrinkageCompensationCm,
    thicknessAllowanceCm,
    silhouetteAdjustmentCm,
    totalAppliedEaseCm,
    finishedGarmentDimensionCm,
    cuttingAllowanceFactor
  };
}

/**
 * Calculates recommended sleeve cap ease adapted to fabric molding capacity.
 * Structured wools with high molding factors can absorb up to +3.5cm cap ease cleanly.
 * Low-molding silks or stiff denims require lower cap ease to avoid crimp puckering.
 */
export function calculateFabricAdaptedSleeveCapEase(
  strategy: SleeveEaseStrategy,
  fabricInput?: FabricProperty | EnhancedFabricProperty
): {
  baseStrategyEaseCm: number;
  adaptedCapEaseCm: number;
  minCapEaseCm: number;
  maxCapEaseCm: number;
  moldingFactor: number;
  crimpCapacityDescription: string;
} {
  const fabric = (fabricInput && 'moldingFactor' in fabricInput)
    ? (fabricInput as EnhancedFabricProperty)
    : getEnhancedFabricById(fabricInput?.id);

  const strategyParams = SLEEVE_EASE_TABLE[strategy] ?? SLEEVE_EASE_TABLE.classic;
  const baseEase = strategyParams.recommendedCapEaseCm;
  const molding = fabric.moldingFactor ?? 1.0;

  // Scale ease by fabric moldability clamped to strategy bounds [min, max]
  const rawAdapted = baseEase * molding;
  const adaptedCapEaseCm = Number(
    Math.max(strategyParams.capEaseMinCm, Math.min(strategyParams.capEaseMaxCm, rawAdapted)).toFixed(2)
  );

  let crimpCapacityDescription = 'Balanced daywear cap ease distribution';
  if (molding >= 1.2) {
    crimpCapacityDescription = 'High wool crimp capacity: ease will shrink smoothly with steam iron shaping.';
  } else if (molding < 0.8) {
    crimpCapacityDescription = 'Low moldability: cap ease must be restricted to prevent puckering along the seam.';
  }

  return {
    baseStrategyEaseCm: baseEase,
    adaptedCapEaseCm,
    minCapEaseCm: strategyParams.capEaseMinCm,
    maxCapEaseCm: strategyParams.capEaseMaxCm,
    moldingFactor: molding,
    crimpCapacityDescription
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
