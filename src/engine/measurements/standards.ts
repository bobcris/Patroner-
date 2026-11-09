/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, EaseProfile, FabricProperty, SizingStandard, SleeveEaseStrategy, StandardSize } from '../../types';

/**
 * Default sizing table established for Patroner based on European ISO/EN 13402
 * interval conventions with Aldrich proportional secondary dimensions.
 * All values are strict anatomical body measurements in centimetres (cm).
 * Note on Provenance: This is a Patroner project-defined default baseline,
 * configurable to support external national and international standards.
 * Ease is not embedded in these body measurements; ease is calculated dynamically.
 */
export const STANDARD_SIZING_SYSTEM: SizingStandard = {
  standardName: 'Patroner Project-Defined Sizing Reference v1.0',
  system: 'Patroner Default Baseline (Proportional European conventions derived from Aldrich/ISO intervals)',
  description: 'Project-defined anthropometric default sizing table based on European interval conventions with Aldrich secondary proportional ratios. Configurable baseline for pattern grading engine. All values represent body dimensions before ease.',
  sizes: {
    XS: {
      unit: 'cm',
      bust: 80,
      waist: 62,
      highHip: 80,
      lowHip: 88,
      waistToHip: 19.5,
      skirtLength: 60,
      backWaistLength: 39.5,
      frontWaistLength: 41,
      acrossBack: 34,
      shoulderLength: 12,
      neckCircumference: 34.5,
      bustSpan: 17.0,
      bustHeight: 24.5,
      armholeDepth: 19.5,
      bicepsCircumference: 26.0,
      elbowCircumference: 23.0,
      wristCircumference: 15.0,
      sleeveLength: 57.0,
      armLengthToElbow: 32.0
    },
    S: {
      unit: 'cm',
      bust: 84,
      waist: 66,
      highHip: 84,
      lowHip: 92,
      waistToHip: 20.0,
      skirtLength: 62,
      backWaistLength: 40.0,
      frontWaistLength: 41.5,
      acrossBack: 35,
      shoulderLength: 12.3,
      neckCircumference: 35.5,
      bustSpan: 17.5,
      bustHeight: 25.0,
      armholeDepth: 20.0,
      bicepsCircumference: 27.5,
      elbowCircumference: 24.0,
      wristCircumference: 15.5,
      sleeveLength: 58.0,
      armLengthToElbow: 33.0
    },
    M: {
      unit: 'cm',
      bust: 90,
      waist: 72,
      highHip: 90,
      lowHip: 98,
      waistToHip: 20.5,
      skirtLength: 64,
      backWaistLength: 40.5,
      frontWaistLength: 42.0,
      acrossBack: 36.5,
      shoulderLength: 12.7,
      neckCircumference: 36.5,
      bustSpan: 18.5,
      bustHeight: 26.0,
      armholeDepth: 21.0,
      bicepsCircumference: 29.5,
      elbowCircumference: 25.5,
      wristCircumference: 16.5,
      sleeveLength: 59.5,
      armLengthToElbow: 34.0
    },
    L: {
      unit: 'cm',
      bust: 98,
      waist: 80,
      highHip: 98,
      lowHip: 106,
      waistToHip: 21.0,
      skirtLength: 65,
      backWaistLength: 41.2,
      frontWaistLength: 42.8,
      acrossBack: 38.0,
      shoulderLength: 13.1,
      neckCircumference: 38.0,
      bustSpan: 19.5,
      bustHeight: 27.0,
      armholeDepth: 22.0,
      bicepsCircumference: 32.0,
      elbowCircumference: 27.0,
      wristCircumference: 17.5,
      sleeveLength: 61.0,
      armLengthToElbow: 35.0
    },
    XL: {
      unit: 'cm',
      bust: 106,
      waist: 88,
      highHip: 106,
      lowHip: 114,
      waistToHip: 21.5,
      skirtLength: 66,
      backWaistLength: 42.0,
      frontWaistLength: 43.6,
      acrossBack: 39.5,
      shoulderLength: 13.5,
      neckCircumference: 39.5,
      bustSpan: 20.5,
      bustHeight: 28.0,
      armholeDepth: 23.0,
      bicepsCircumference: 35.0,
      elbowCircumference: 29.0,
      wristCircumference: 18.5,
      sleeveLength: 62.0,
      armLengthToElbow: 36.0
    },
    XXL: {
      unit: 'cm',
      bust: 116,
      waist: 98,
      highHip: 116,
      lowHip: 124,
      waistToHip: 22.0,
      skirtLength: 67,
      backWaistLength: 42.6,
      frontWaistLength: 44.4,
      acrossBack: 41.2,
      shoulderLength: 14.0,
      neckCircumference: 41.5,
      bustSpan: 22.0,
      bustHeight: 29.5,
      armholeDepth: 24.5,
      bicepsCircumference: 38.5,
      elbowCircumference: 31.5,
      wristCircumference: 20.0,
      sleeveLength: 63.0,
      armLengthToElbow: 37.0
    }
  }
};

/**
 * Ease matrix (in cm) added to body dimensions.
 * Distinguishes body measurement from garment measurement.
 */
export const EASE_TABLE: Record<EaseProfile, { waist: number; hip: number; bust: number; description: string }> = {
  'ultra-fitted': {
    waist: 1.0,
    hip: 1.5,
    bust: 1.5,
    description: 'Body-hugging silhouette with minimal breathing allowance (1-1.5cm total ease).'
  },
  'fitted': {
    waist: 2.5,
    hip: 3.5,
    bust: 3.5,
    description: 'Tailored fit that gently contours the natural body curves (2.5-3.5cm ease).'
  },
  'classic': {
    waist: 4.0,
    hip: 5.0,
    bust: 5.5,
    description: 'Standard comfortable wearing ease suitable for daywear and structured wovens (4-5cm ease).'
  },
  'relaxed': {
    waist: 6.5,
    hip: 8.0,
    bust: 8.5,
    description: 'Casual, comfortable drape with generous movement room (6.5-8.5cm ease).'
  },
  'oversized': {
    waist: 10.0,
    hip: 12.0,
    bust: 14.0,
    description: 'Voluminous, fashion-forward silhouette with exaggerated proportion (10-14cm ease).'
  }
};

export interface MeasurementValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates anatomical plausibility of custom measurements.
 */
export function validateBodyMeasurements(m: Partial<BodyMeasurements>): MeasurementValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!m.waist || m.waist < 45 || m.waist > 160) {
    errors.push('Waist measurement must be between 45 cm and 160 cm.');
  }
  if (!m.lowHip || m.lowHip < 60 || m.lowHip > 180) {
    errors.push('Low hip measurement must be between 60 cm and 180 cm.');
  }
  if (m.waist && m.lowHip && m.waist >= m.lowHip) {
    warnings.push('Waist is equal to or greater than low hip. Pattern may require specialized cylindrical drafting.');
  }
  if (!m.waistToHip || m.waistToHip < 14 || m.waistToHip > 30) {
    errors.push('Waist to hip depth must be between 14 cm and 30 cm (standard: 18-22 cm).');
  }
  if (!m.skirtLength || m.skirtLength < 25 || m.skirtLength > 130) {
    errors.push('Garment length must be between 25 cm (micro) and 130 cm (maxi).');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

export interface GarmentDimensionOptions {
  targetLengthCm?: number;
  explicitEaseCm?: {
    waist?: number;
    hip?: number;
    bust?: number;
  };
}

/**
 * Pure calculation to determine finished garment dimensions from body measurements,
 * applied ease, and fabric stretch compensation.
 * Consumes authoritative targetLengthCm and explicitEaseCm when provided,
 * eliminating silent overrides.
 */
export function calculateGarmentDimensions(
  body: BodyMeasurements,
  easeProfile: EaseProfile,
  fabric?: FabricProperty,
  options?: GarmentDimensionOptions
): {
  garmentWaistCm: number;
  garmentHipCm: number;
  totalLengthCm: number;
  appliedWaistEaseCm: number;
  appliedHipEaseCm: number;
} {
  const baseEase = EASE_TABLE[easeProfile] ?? EASE_TABLE.classic;
  
  // Fabric stretch reduction: if fabric has stretch, mechanical ease is adjusted downwards
  let stretchFactorWaist = 1.0;
  let stretchFactorHip = 1.0;
  
  if (fabric?.stretch === 'low-stretch') {
    stretchFactorWaist = 0.85;
    stretchFactorHip = 0.85;
  } else if (fabric?.stretch === 'high-stretch') {
    stretchFactorWaist = 0.5;
    stretchFactorHip = 0.5;
  }

  const rawWaistEase = options?.explicitEaseCm?.waist !== undefined ? options.explicitEaseCm.waist : baseEase.waist;
  const rawHipEase = options?.explicitEaseCm?.hip !== undefined ? options.explicitEaseCm.hip : baseEase.hip;

  const appliedWaistEase = Number((rawWaistEase * stretchFactorWaist).toFixed(1));
  const appliedHipEase = Number((rawHipEase * stretchFactorHip).toFixed(1));

  const totalLength = options?.targetLengthCm !== undefined && options.targetLengthCm > 0
    ? options.targetLengthCm
    : (body.skirtLength || 64);

  return {
    garmentWaistCm: Number((body.waist + appliedWaistEase).toFixed(1)),
    garmentHipCm: Number((body.lowHip + appliedHipEase).toFixed(1)),
    totalLengthCm: totalLength,
    appliedWaistEaseCm: appliedWaistEase,
    appliedHipEaseCm: appliedHipEase
  };
}

/**
 * Validates anatomical plausibility of bodice body measurements.
 * Rejects non-finite, missing, zero, negative, and physically contradictory inputs.
 */
export function validateBodiceMeasurements(m: Partial<BodyMeasurements>): MeasurementValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Primary Bust Circumference
  if (m.bust === undefined || m.bust === null) {
    errors.push('Bust circumference is required for bodice drafting.');
  } else if (!Number.isFinite(m.bust) || m.bust <= 0) {
    errors.push(`Bust measurement must be a positive finite number (received: ${m.bust}).`);
  } else if (m.bust < 65 || m.bust > 165) {
    errors.push(`Bust measurement (${m.bust} cm) falls outside anatomical boundary (65 cm to 165 cm).`);
  }

  // 2. Primary Waist Circumference
  if (m.waist === undefined || m.waist === null) {
    errors.push('Waist circumference is required for bodice drafting.');
  } else if (!Number.isFinite(m.waist) || m.waist <= 0) {
    errors.push(`Waist measurement must be a positive finite number (received: ${m.waist}).`);
  } else if (m.waist < 45 || m.waist > 150) {
    errors.push(`Waist measurement (${m.waist} cm) falls outside anatomical boundary (45 cm to 150 cm).`);
  }

  // 3. Contradictory Bust vs Waist check
  if (m.bust && m.waist && Number.isFinite(m.bust) && Number.isFinite(m.waist)) {
    if (m.waist >= m.bust) {
      warnings.push(`Waist (${m.waist} cm) is equal to or exceeds bust (${m.bust} cm). Standard basic bodice suppression requires specialized maternity or cylindrical drafting.`);
    }
  }

  // 4. Back Waist Length (Nape to Waist)
  if (m.backWaistLength === undefined || m.backWaistLength === null) {
    errors.push('Back waist length (nape to waist) is required for bodice drafting.');
  } else if (!Number.isFinite(m.backWaistLength) || m.backWaistLength <= 0) {
    errors.push(`Back waist length must be a positive finite number (received: ${m.backWaistLength}).`);
  } else if (m.backWaistLength < 30 || m.backWaistLength > 56) {
    errors.push(`Back waist length (${m.backWaistLength} cm) falls outside anatomical boundary (30 cm to 56 cm).`);
  }

  // 5. Front Waist Length (Neck-Shoulder point over bust to front waist)
  if (m.frontWaistLength === undefined || m.frontWaistLength === null) {
    errors.push('Front waist length is required for bodice drafting.');
  } else if (!Number.isFinite(m.frontWaistLength) || m.frontWaistLength <= 0) {
    errors.push(`Front waist length must be a positive finite number (received: ${m.frontWaistLength}).`);
  } else if (m.frontWaistLength < 32 || m.frontWaistLength > 62) {
    errors.push(`Front waist length (${m.frontWaistLength} cm) falls outside anatomical boundary (32 cm to 62 cm).`);
  }

  // 6. Posture / Thoracic relationship check
  if (m.frontWaistLength && m.backWaistLength && Number.isFinite(m.frontWaistLength) && Number.isFinite(m.backWaistLength)) {
    if (m.frontWaistLength < m.backWaistLength - 3.0) {
      errors.push(`Front waist length (${m.frontWaistLength} cm) cannot be shorter than back waist length (${m.backWaistLength} cm) minus 3 cm due to natural thoracic curve and bust rise.`);
    }
  }

  // 7. Across Back
  if (m.acrossBack === undefined || m.acrossBack === null) {
    errors.push('Across back measurement is required for armhole depth and shoulder placement.');
  } else if (!Number.isFinite(m.acrossBack) || m.acrossBack <= 0) {
    errors.push(`Across back must be a positive finite number (received: ${m.acrossBack}).`);
  } else if (m.acrossBack < 26 || m.acrossBack > 54) {
    errors.push(`Across back measurement (${m.acrossBack} cm) falls outside anatomical boundary (26 cm to 54 cm).`);
  } else if (m.bust && m.acrossBack >= m.bust * 0.55) {
    errors.push(`Across back (${m.acrossBack} cm) cannot exceed 55% of full bust circumference (${m.bust} cm).`);
  }

  // 8. Shoulder Length
  if (m.shoulderLength === undefined || m.shoulderLength === null) {
    errors.push('Shoulder length is required for bodice shoulder seam drafting.');
  } else if (!Number.isFinite(m.shoulderLength) || m.shoulderLength <= 0) {
    errors.push(`Shoulder length must be a positive finite number (received: ${m.shoulderLength}).`);
  } else if (m.shoulderLength < 8.5 || m.shoulderLength > 18.0) {
    errors.push(`Shoulder length (${m.shoulderLength} cm) falls outside anatomical boundary (8.5 cm to 18.0 cm).`);
  }

  // 9. Optional/Derived inputs validation
  if (m.neckCircumference !== undefined) {
    if (!Number.isFinite(m.neckCircumference) || m.neckCircumference <= 0) {
      errors.push(`Neck circumference must be a positive finite number (received: ${m.neckCircumference}).`);
    } else if (m.neckCircumference < 26 || m.neckCircumference > 55) {
      errors.push(`Neck circumference (${m.neckCircumference} cm) falls outside boundary (26 cm to 55 cm).`);
    }
  }

  if (m.bustHeight !== undefined) {
    if (!Number.isFinite(m.bustHeight) || m.bustHeight <= 0) {
      errors.push(`Bust height (side neck to apex) must be a positive finite number (received: ${m.bustHeight}).`);
    } else {
      if (m.bustHeight < 18 || m.bustHeight > 42) {
        errors.push(`Bust height (${m.bustHeight} cm) falls outside boundary (18 cm to 42 cm).`);
      }
      if (m.frontWaistLength && Number.isFinite(m.frontWaistLength) && m.bustHeight >= m.frontWaistLength - 4.0) {
        errors.push(`Bust height (${m.bustHeight} cm) must be at least 4 cm above front waist level (${m.frontWaistLength} cm) to permit vertical waist dart construction.`);
      }
    }
  }

  if (m.bustSpan !== undefined) {
    if (!Number.isFinite(m.bustSpan) || m.bustSpan <= 0) {
      errors.push(`Bust span (apex-to-apex distance) must be a positive finite number (received: ${m.bustSpan}).`);
    } else {
      if (m.bustSpan < 12 || m.bustSpan > 30) {
        errors.push(`Bust span (${m.bustSpan} cm) falls outside boundary (12 cm to 30 cm).`);
      }
      if (m.bust && Number.isFinite(m.bust) && m.bustSpan >= m.bust * 0.40) {
        errors.push(`Bust span (${m.bustSpan} cm) cannot exceed 40% of full bust circumference (${m.bust} cm).`);
      }
    }
  }

  if (m.armholeDepth !== undefined) {
    if (!Number.isFinite(m.armholeDepth) || m.armholeDepth <= 0) {
      errors.push(`Armhole depth must be a positive finite number (received: ${m.armholeDepth}).`);
    } else {
      if (m.armholeDepth < 14 || m.armholeDepth > 32) {
        errors.push(`Armhole depth (${m.armholeDepth} cm) falls outside boundary (14 cm to 32 cm).`);
      }
      if (m.backWaistLength && Number.isFinite(m.backWaistLength) && m.armholeDepth >= m.backWaistLength - 6.0) {
        errors.push(`Armhole depth (${m.armholeDepth} cm) must be at least 6 cm above back waist level (${m.backWaistLength} cm) to provide adequate side torso length.`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Pure calculation to determine finished bodice garment dimensions from body measurements,
 * applied ease profile, and fabric stretch compensation.
 */
export function calculateBodiceGarmentDimensions(
  body: BodyMeasurements,
  easeProfile: EaseProfile,
  fabric?: FabricProperty,
  options?: GarmentDimensionOptions
): {
  garmentBustCm: number;
  garmentWaistCm: number;
  appliedBustEaseCm: number;
  appliedWaistEaseCm: number;
} {
  const baseEase = EASE_TABLE[easeProfile] ?? EASE_TABLE.classic;

  let stretchFactorBust = 1.0;
  let stretchFactorWaist = 1.0;

  if (fabric?.stretch === 'low-stretch') {
    stretchFactorBust = 0.85;
    stretchFactorWaist = 0.85;
  } else if (fabric?.stretch === 'high-stretch') {
    stretchFactorBust = 0.5;
    stretchFactorWaist = 0.5;
  }

  const rawBustEase = options?.explicitEaseCm?.bust !== undefined ? options.explicitEaseCm.bust : baseEase.bust;
  const rawWaistEase = options?.explicitEaseCm?.waist !== undefined ? options.explicitEaseCm.waist : baseEase.waist;

  const appliedBustEase = Number((rawBustEase * stretchFactorBust).toFixed(1));
  const appliedWaistEase = Number((rawWaistEase * stretchFactorWaist).toFixed(1));
  const bustVal = body.bust ?? 90;

  return {
    garmentBustCm: Number((bustVal + appliedBustEase).toFixed(1)),
    garmentWaistCm: Number((body.waist + appliedWaistEase).toFixed(1)),
    appliedBustEaseCm: appliedBustEase,
    appliedWaistEaseCm: appliedWaistEase
  };
}

/**
 * Sleeve ease parameters by strategy.
 * Sleeve cap ease is the intentional difference between sleeve cap seam length and bodice armhole length.
 */
export const SLEEVE_EASE_TABLE: Record<
  SleeveEaseStrategy,
  {
    capEaseMinCm: number;
    capEaseMaxCm: number;
    recommendedCapEaseCm: number;
    bicepsEaseCm: number;
    wristEaseCm: number;
    description: string;
  }
> = {
  tailored: {
    capEaseMinCm: 2.0,
    capEaseMaxCm: 3.8,
    recommendedCapEaseCm: 2.8,
    bicepsEaseCm: 5.0,
    wristEaseCm: 4.5,
    description: 'Structured tailored sleeve with crown ease (+2.0 to +3.8cm) for wool/suiting fabrics.'
  },
  classic: {
    capEaseMinCm: 1.2,
    capEaseMaxCm: 2.5,
    recommendedCapEaseCm: 1.8,
    bicepsEaseCm: 4.0,
    wristEaseCm: 4.0,
    description: 'Standard woven sleeve with comfortable daywear ease (+1.2 to +2.5cm cap ease).'
  },
  fitted: {
    capEaseMinCm: 0.6,
    capEaseMaxCm: 1.6,
    recommendedCapEaseCm: 1.0,
    bicepsEaseCm: 2.8,
    wristEaseCm: 3.0,
    description: 'Close-fitting sleeve with reduced cap ease (+0.6 to +1.6cm) for slight stretch or sleek silhouettes.'
  },
  flat: {
    capEaseMinCm: 0.0,
    capEaseMaxCm: 0.8,
    recommendedCapEaseCm: 0.4,
    bicepsEaseCm: 2.0,
    wristEaseCm: 2.5,
    description: 'Flat / casual shirt sleeve with minimal or zero crown ease (+0.0 to +0.8cm).'
  }
};

/**
 * Validates anatomical plausibility of sleeve body measurements.
 * Rejects non-finite, missing, zero, negative, and physically contradictory inputs.
 */
export function validateSleeveMeasurements(m: Partial<BodyMeasurements>): MeasurementValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Biceps Circumference
  if (m.bicepsCircumference === undefined || m.bicepsCircumference === null) {
    errors.push('Biceps circumference is required for sleeve drafting.');
  } else if (!Number.isFinite(m.bicepsCircumference) || m.bicepsCircumference <= 0) {
    errors.push(`Biceps circumference must be a positive finite number (received: ${m.bicepsCircumference}).`);
  } else if (m.bicepsCircumference < 20 || m.bicepsCircumference > 60) {
    errors.push(`Biceps circumference (${m.bicepsCircumference} cm) falls outside anatomical boundary (20 cm to 60 cm).`);
  }

  // 2. Wrist Circumference
  if (m.wristCircumference === undefined || m.wristCircumference === null) {
    errors.push('Wrist circumference is required for sleeve drafting.');
  } else if (!Number.isFinite(m.wristCircumference) || m.wristCircumference <= 0) {
    errors.push(`Wrist circumference must be a positive finite number (received: ${m.wristCircumference}).`);
  } else if (m.wristCircumference < 11 || m.wristCircumference > 30) {
    errors.push(`Wrist circumference (${m.wristCircumference} cm) falls outside anatomical boundary (11 cm to 30 cm).`);
  } else if (m.bicepsCircumference && m.wristCircumference >= m.bicepsCircumference) {
    errors.push(`Wrist circumference (${m.wristCircumference} cm) cannot equal or exceed biceps circumference (${m.bicepsCircumference} cm).`);
  }

  // 3. Sleeve Length
  if (m.sleeveLength === undefined || m.sleeveLength === null) {
    errors.push('Sleeve length is required for sleeve drafting.');
  } else if (!Number.isFinite(m.sleeveLength) || m.sleeveLength <= 0) {
    errors.push(`Sleeve length must be a positive finite number (received: ${m.sleeveLength}).`);
  } else if (m.sleeveLength < 45 || m.sleeveLength > 85) {
    errors.push(`Sleeve length (${m.sleeveLength} cm) falls outside anatomical boundary (45 cm to 85 cm).`);
  }

  // 4. Optional Elbow Circumference
  if (m.elbowCircumference !== undefined && m.elbowCircumference !== null) {
    if (!Number.isFinite(m.elbowCircumference) || m.elbowCircumference <= 0) {
      errors.push(`Elbow circumference must be a positive finite number (received: ${m.elbowCircumference}).`);
    } else if (m.elbowCircumference < 16 || m.elbowCircumference > 45) {
      errors.push(`Elbow circumference (${m.elbowCircumference} cm) falls outside anatomical boundary (16 cm to 45 cm).`);
    }
  }

  // 5. Optional Arm Length to Elbow
  if (m.armLengthToElbow !== undefined && m.armLengthToElbow !== null) {
    if (!Number.isFinite(m.armLengthToElbow) || m.armLengthToElbow <= 0) {
      errors.push(`Arm length to elbow must be a positive finite number (received: ${m.armLengthToElbow}).`);
    } else if (m.armLengthToElbow < 24 || m.armLengthToElbow > 50) {
      errors.push(`Arm length to elbow (${m.armLengthToElbow} cm) falls outside anatomical boundary (24 cm to 50 cm).`);
    } else if (m.sleeveLength && m.armLengthToElbow >= m.sleeveLength - 10) {
      errors.push(`Arm length to elbow (${m.armLengthToElbow} cm) must be at least 10 cm shorter than total sleeve length (${m.sleeveLength} cm).`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Pure calculation to determine finished sleeve garment dimensions from body measurements,
 * sleeve ease strategy, and fabric stretch compensation.
 */
export function calculateSleeveGarmentDimensions(
  body: BodyMeasurements,
  strategy: SleeveEaseStrategy = 'classic',
  fabric?: FabricProperty
): {
  garmentBicepsCm: number;
  garmentWristCm: number;
  totalSleeveLengthCm: number;
  targetCapEaseCm: number;
  appliedBicepsEaseCm: number;
  appliedWristEaseCm: number;
  strategy: SleeveEaseStrategy;
} {
  const baseEase = SLEEVE_EASE_TABLE[strategy];

  let stretchFactor = 1.0;
  if (fabric?.stretch === 'low-stretch') {
    stretchFactor = 0.85;
  } else if (fabric?.stretch === 'high-stretch') {
    stretchFactor = 0.5;
  }

  const appliedBicepsEase = Number((baseEase.bicepsEaseCm * stretchFactor).toFixed(1));
  const appliedWristEase = Number((baseEase.wristEaseCm * stretchFactor).toFixed(1));
  const targetCapEase = Number((baseEase.recommendedCapEaseCm * stretchFactor).toFixed(2));

  const biceps = body.bicepsCircumference ?? 29.5;
  const wrist = body.wristCircumference ?? 16.5;
  const length = body.sleeveLength ?? 59.5;

  return {
    garmentBicepsCm: Number((biceps + appliedBicepsEase).toFixed(1)),
    garmentWristCm: Number((wrist + appliedWristEase).toFixed(1)),
    totalSleeveLengthCm: length,
    targetCapEaseCm: targetCapEase,
    appliedBicepsEaseCm: appliedBicepsEase,
    appliedWristEaseCm: appliedWristEase,
    strategy
  };
}


