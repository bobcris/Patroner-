import { BodyMeasurements, EaseProfile, FabricProperty, Silhouette, SleeveEaseStrategy } from '../../types';
import { EASE_TABLE, SLEEVE_EASE_TABLE } from '../measurements/standards';
import {
  EnhancedFabricProperty,
  FabricEaseBreakdown,
  InputProvenanceSummary,
  MeasurementDirection,
  NegativeEaseAuthorizationPolicy,
  ProvisionalRecoveryPolicy
} from './fabric-types';
import { DEFAULT_ILLUSTRATIVE_FABRIC, getEnhancedFabricById } from './fabric-presets';

export interface EaseCalculationOptions {
  silhouette?: Silhouette;
  allowanceForShrinkage?: boolean;
  layerCount?: number; // For turn-of-cloth calculation (default: 1 layer)
  measurementDirection?: MeasurementDirection; // Required or derived; no unconditional fallback
  patternPieceOrientation?: 'crossgrain' | 'weft' | 'grainline' | 'warp' | 'bias';
  negativeEasePolicy?: NegativeEaseAuthorizationPolicy; // Explicit negative ease authorization policy
  negativeEasePolicyAllowed?: boolean; // Legacy flag; defaults to false
  provisionalRecoveryPolicy?: ProvisionalRecoveryPolicy; // Explicit user-approved provisional recovery policy
  userExplicitConsentToDefaultFabric?: boolean; // Explicit opt-in for illustrative fallback
  garmentCategory?: string; // e.g. 'bodice', 'skirt'
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
  const provenanceNotes: string[] = [];
  const limitations: string[] = [
    'Stretch deduction uses provisional project model; not certified by tensile load-elongation curve testing.',
    'Turn-of-cloth model assumes uniform circular cylinder neutral axis shift (t/2).'
  ];

  const baseEaseProfile = EASE_TABLE[easeProfile] ?? EASE_TABLE.classic;
  const baseEaseVal = (baseEaseProfile as any)[circumferenceId] ?? (circumferenceId === 'bust' ? 5.5 : 3.0);
  const baselineMovementEaseCm = Number(baseEaseVal.toFixed(2));

  // 1. Resolve measurement direction (Section 4: Remove unconditional circumference-crossgrain fallback)
  let measurementDirection: MeasurementDirection | undefined = options.measurementDirection;

  if (!measurementDirection && options.patternPieceOrientation) {
    if (options.patternPieceOrientation === 'crossgrain' || options.patternPieceOrientation === 'weft') {
      measurementDirection = 'circumference-crossgrain';
    } else if (options.patternPieceOrientation === 'grainline' || options.patternPieceOrientation === 'warp') {
      measurementDirection = 'length-grainline';
    } else if (options.patternPieceOrientation === 'bias') {
      measurementDirection = 'bias';
    }
  }

  const VALID_DIRECTIONS: MeasurementDirection[] = [
    'circumference-crossgrain',
    'length-grainline',
    'bias'
  ];

  const isOrientationValid = Boolean(measurementDirection && VALID_DIRECTIONS.includes(measurementDirection));
  if (!isOrientationValid) {
    provenanceNotes.push(
      `Measurement direction '${measurementDirection ?? 'undefined'}' is missing or ambiguous. Explicit direction ('circumference-crossgrain', 'length-grainline', or 'bias') or patternPieceOrientation is required. Unconditional circumference-crossgrain fallback removed.`
    );
  }

  // 2. Resolve fabric with explicit consent
  const resolution = resolveEnhancedFabric(fabricInput, options.userExplicitConsentToDefaultFabric);
  if (resolution.warning) {
    provenanceNotes.push(resolution.warning);
  }

  const fabric = resolution.fabric;

  if (!isOrientationValid || !fabric) {
    return {
      circumferenceId,
      measurementDirection: (measurementDirection as any) ?? 'circumference-crossgrain',
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
      unavailableReason: !isOrientationValid
        ? `Measurement direction '${measurementDirection ?? 'undefined'}' is missing or ambiguous.`
        : (resolution.warning ?? 'Fabric specification is missing or unverified.'),
      provenanceNotes,
      limitations
    };
  }

  if (fabric.auditWarnings && fabric.auditWarnings.length > 0) {
    provenanceNotes.push(...fabric.auditWarnings);
  }

  const validatedDirection = measurementDirection as MeasurementDirection;

  // 3. Directional Stretch & Elastic Recovery Resolution (Section 2: No silent 80% recovery default)
  let directionalStretchPercent = 0;
  let directionalRecoveryPercent: number | undefined = undefined;
  let isProvisionalRecovery = false;
  let provisionalRecoveryReason = '';

  if (measurementDirection === 'circumference-crossgrain') {
    directionalStretchPercent = fabric.directional?.weft?.stretchPercent ?? 0;
    directionalRecoveryPercent = fabric.directional?.weft?.elasticRecoveryPercent;
  } else if (measurementDirection === 'length-grainline') {
    directionalStretchPercent = fabric.directional?.warp?.stretchPercent ?? 0;
    directionalRecoveryPercent = fabric.directional?.warp?.elasticRecoveryPercent;
  } else {
    directionalStretchPercent = fabric.directional?.bias?.stretchPercent ?? 0;
  }

  if (directionalRecoveryPercent === undefined || !Number.isFinite(directionalRecoveryPercent)) {
    if (options.provisionalRecoveryPolicy?.allowProvisionalRecovery && options.provisionalRecoveryPolicy?.userApproved) {
      directionalRecoveryPercent = options.provisionalRecoveryPolicy.provisionalRecoveryPercent;
      isProvisionalRecovery = true;
      provisionalRecoveryReason = options.provisionalRecoveryPolicy.reason || 'Provisional recovery policy approved by user';
      provenanceNotes.push(
        `Elastic recovery missing from fabric data; applied user-approved provisional recovery of ${directionalRecoveryPercent}% (${provisionalRecoveryReason}).`
      );
    } else {
      if (directionalStretchPercent > 3.0) {
        provenanceNotes.push(
          `Directional elastic recovery data missing for ${measurementDirection}. Stretch deduction cannot be measured without recovery evidence or an explicit user-approved provisional policy.`
        );
      }
      directionalRecoveryPercent = undefined;
    }
  }

  // 4. Negative Ease Policy Authorization (Section 3: Defaults to disabled; strict opt-in)
  let allowNegativeEase = false;
  let negativeEasePolicyApplied: NegativeEaseAuthorizationPolicy | undefined = undefined;

  const policy = options.negativeEasePolicy;
  if (policy && policy.isAuthorized) {
    const isCategoryMatch = policy.garmentCategory === 'all' || !options.garmentCategory || policy.garmentCategory === options.garmentCategory;
    const isAuthorValid = Boolean(policy.authorizedBy && policy.authorizedBy.trim() !== '');
    const isStretchSufficient = directionalStretchPercent >= policy.minimumRequiredStretchPercent;
    const currentRecovery = directionalRecoveryPercent ?? 0;
    const isRecoverySufficient = currentRecovery >= policy.minimumRequiredRecoveryPercent;

    if (isCategoryMatch && isAuthorValid && isStretchSufficient && isRecoverySufficient) {
      allowNegativeEase = true;
      negativeEasePolicyApplied = policy;
      provenanceNotes.push(
        `Negative ease explicitly authorized for category '${policy.garmentCategory}' by ${policy.authorizedBy} (Intent: ${policy.fitIntent}).`
      );
    } else {
      provenanceNotes.push(
        `Negative ease policy rejected: categoryMatch=${isCategoryMatch}, authorValid=${isAuthorValid}, stretchSufficient=${isStretchSufficient} (${directionalStretchPercent}% vs min ${policy.minimumRequiredStretchPercent}%), recoverySufficient=${isRecoverySufficient} (${currentRecovery}% vs min ${policy.minimumRequiredRecoveryPercent}%).`
      );
    }
  } else if (options.negativeEasePolicyAllowed === true) {
    // Explicit legacy boolean opt-in
    allowNegativeEase = true;
    provenanceNotes.push('Negative ease permitted via explicit negativeEasePolicyAllowed flag.');
  }

  // 5. Calculate Stretch Deduction (Only when authorized by negative ease policy)
  let stretchDeductionCm = 0;
  if (allowNegativeEase && directionalStretchPercent > 3.0 && directionalRecoveryPercent !== undefined) {
    // Proportional stretch deduction: accounts for recovery factor and maximum 60% wearing ease absorption
    const recoveryRatio = directionalRecoveryPercent / 100;
    const stretchRatio = Math.min(0.60, (directionalStretchPercent - 3.0) * 0.025 * recoveryRatio);
    stretchDeductionCm = Number((baselineMovementEaseCm * stretchRatio).toFixed(2));
  }

  // 6. Turn-of-Cloth Thickness Allowance
  const thicknessCm = (fabric.thicknessMm ?? 0.6) / 10;
  const layers = options.layerCount ?? 1;
  let thicknessAllowanceCm = 0;
  if (thicknessCm > 0.06) {
    thicknessAllowanceCm = Number((2 * Math.PI * thicknessCm * 0.5 * layers).toFixed(2));
  }

  // 7. Design Ease (Silhouette Adjustment)
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

  // 8. Net Finished Garment Ease & Negative Ease Boundary Checking
  let totalAppliedEaseCm = Number(
    (baselineMovementEaseCm + designEaseCm + thicknessAllowanceCm - stretchDeductionCm).toFixed(2)
  );

  // If total applied ease would be negative without authorization:
  if (totalAppliedEaseCm < 0 && !allowNegativeEase) {
    stretchDeductionCm = Number((baselineMovementEaseCm + designEaseCm + thicknessAllowanceCm).toFixed(2));
    totalAppliedEaseCm = 0;
    provenanceNotes.push('Negative ease is disabled by default; stretch deduction was clamped to preserve zero non-negative ease.');
  }

  // If negative ease is authorized, verify it does not exceed policy limits
  if (totalAppliedEaseCm < 0 && allowNegativeEase && policy) {
    const negativeEaseCm = Math.abs(totalAppliedEaseCm);
    const negativeEasePercent = Number(((negativeEaseCm / bodyValueCm) * 100).toFixed(2));

    if (policy.maxPermittedNegativeEaseCm !== undefined && negativeEaseCm > policy.maxPermittedNegativeEaseCm) {
      return {
        circumferenceId,
        measurementDirection: validatedDirection,
        bodyMeasurementCm: bodyValueCm,
        baselineMovementEaseCm,
        designEaseCm,
        stretchDeductionCm,
        thicknessAllowanceCm,
        silhouetteAdjustmentCm: designEaseCm,
        totalAppliedEaseCm,
        finishedGarmentDimensionCm: Number((bodyValueCm + totalAppliedEaseCm).toFixed(2)),
        shrinkageRatio: 0,
        shrinkageCompensationCm: 0,
        preShrinkCuttingDimensionCm: Number((bodyValueCm + totalAppliedEaseCm).toFixed(2)),
        cuttingAllowanceFactor: 1.0,
        isCalculationAvailable: false,
        unavailableReason: `Calculated negative ease (-${negativeEaseCm.toFixed(2)} cm) exceeds maximum authorized policy limit (-${policy.maxPermittedNegativeEaseCm.toFixed(2)} cm).`,
        provenanceNotes,
        limitations
      };
    }

    if (policy.maxPermittedNegativeEasePercent !== undefined && negativeEasePercent > policy.maxPermittedNegativeEasePercent) {
      return {
        circumferenceId,
        measurementDirection: validatedDirection,
        bodyMeasurementCm: bodyValueCm,
        baselineMovementEaseCm,
        designEaseCm,
        stretchDeductionCm,
        thicknessAllowanceCm,
        silhouetteAdjustmentCm: designEaseCm,
        totalAppliedEaseCm,
        finishedGarmentDimensionCm: Number((bodyValueCm + totalAppliedEaseCm).toFixed(2)),
        shrinkageRatio: 0,
        shrinkageCompensationCm: 0,
        preShrinkCuttingDimensionCm: Number((bodyValueCm + totalAppliedEaseCm).toFixed(2)),
        cuttingAllowanceFactor: 1.0,
        isCalculationAvailable: false,
        unavailableReason: `Calculated negative ease (-${negativeEasePercent.toFixed(1)}%) exceeds maximum authorized policy limit (-${policy.maxPermittedNegativeEasePercent.toFixed(1)}%).`,
        provenanceNotes,
        limitations
      };
    }
  }

  // 9. Finished Garment Dimension (Body + Net Finished Ease)
  const finishedGarmentDimensionCm = Number((bodyValueCm + totalAppliedEaseCm).toFixed(2));

  // 10. Directional Shrinkage & Pre-Shrink Cutting Dimension
  let directionalShrinkagePercent = 0;
  if (measurementDirection === 'circumference-crossgrain') {
    directionalShrinkagePercent = fabric.directional?.weft?.shrinkagePercent ?? 0;
  } else if (measurementDirection === 'length-grainline') {
    directionalShrinkagePercent = fabric.directional?.warp?.shrinkagePercent ?? 0;
  } else {
    directionalShrinkagePercent = Number(
      (((fabric.directional?.warp?.shrinkagePercent ?? 0) + (fabric.directional?.weft?.shrinkagePercent ?? 0)) / 2).toFixed(2)
    );
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

  // 11. Compile Input Provenance Summary (Section 6)
  const inputProvenanceSummary: InputProvenanceSummary = {
    measuredInputs: [`bodyMeasurementCm: ${bodyValueCm.toFixed(2)} cm`],
    supplierDeclaredInputs: [],
    projectDefaultInputs: [`baselineMovementEaseCm: ${baselineMovementEaseCm.toFixed(2)} cm (ISO/Aldrich table)`],
    estimatedInputs: [],
    explicitUserAssumptions: [],
    calculatedOutputs: [
      `totalAppliedEaseCm: ${totalAppliedEaseCm.toFixed(2)} cm`,
      `finishedGarmentDimensionCm: ${finishedGarmentDimensionCm.toFixed(2)} cm`,
      `preShrinkCuttingDimensionCm: ${preShrinkCuttingDimensionCm.toFixed(2)} cm`,
      `shrinkageCompensationCm: ${shrinkageCompensationCm.toFixed(2)} cm`
    ]
  };

  if (fabric.provenance === 'project-default') {
    inputProvenanceSummary.projectDefaultInputs.push(`fabric: ${fabric.name} (${fabric.id}) [project-default]`);
  } else if (fabric.provenance === 'laboratory-tested') {
    inputProvenanceSummary.measuredInputs.push(`fabric: ${fabric.name} (${fabric.id}) [laboratory-tested]`);
  } else if (fabric.provenance === 'supplier-declared') {
    inputProvenanceSummary.supplierDeclaredInputs.push(`fabric: ${fabric.name} (${fabric.id}) [supplier-declared]`);
  } else {
    inputProvenanceSummary.estimatedInputs.push(`fabric: ${fabric.name} (${fabric.id})`);
  }

  if (isProvisionalRecovery) {
    inputProvenanceSummary.explicitUserAssumptions.push(
      `Provisional recovery: ${directionalRecoveryPercent}% (${provisionalRecoveryReason})`
    );
  } else if (directionalRecoveryPercent !== undefined) {
    inputProvenanceSummary.measuredInputs.push(`directionalRecoveryPercent: ${directionalRecoveryPercent}%`);
  }

  if (negativeEasePolicyApplied) {
    inputProvenanceSummary.explicitUserAssumptions.push(
      `Negative ease authorized by ${negativeEasePolicyApplied.authorizedBy} (max: ${negativeEasePolicyApplied.maxPermittedNegativeEasePercent}%)`
    );
  }

  return {
    circumferenceId,
    measurementDirection: validatedDirection,
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
    isProvisionalCalculation: isProvisionalRecovery,
    provisionalReason: isProvisionalRecovery ? provisionalRecoveryReason : undefined,
    negativeEasePolicyApplied,
    inputProvenanceSummary,
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
  const circumferenceOptions: EaseCalculationOptions = {
    ...options,
    measurementDirection: options.measurementDirection ?? 'circumference-crossgrain'
  };

  return {
    bust: calculateFabricAwareCircumferenceEase('bust', bustVal, easeProfile, fabricInput, circumferenceOptions),
    waist: calculateFabricAwareCircumferenceEase('waist', waistVal, easeProfile, fabricInput, circumferenceOptions),
    lowHip: calculateFabricAwareCircumferenceEase('lowHip', hipVal, easeProfile, fabricInput, circumferenceOptions)
  };
}

