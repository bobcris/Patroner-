/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, EaseProfile, FabricProperty, SizingStandard, StandardSize } from '../../types';

/**
 * Standard sizing table based on European ISO/EN 13402 anthropometric conventions.
 * All values are strict anatomical body measurements in centimetres (cm).
 * Ease is not embedded in these body measurements; ease is calculated dynamically.
 */
export const STANDARD_SIZING_SYSTEM: SizingStandard = {
  standardName: 'Patroner ISO Standard Sizing Chart v1.0',
  system: 'European ISO/EN 13402 Reference Table (cm)',
  description: 'Documented European anthropometric base chart. All values represent naked body dimensions in cm before ease.',
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
      armholeDepth: 19.5
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
      armholeDepth: 20.0
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
      armholeDepth: 21.0
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
      armholeDepth: 22.0
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
      armholeDepth: 23.0
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
      armholeDepth: 24.5
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

/**
 * Pure calculation to determine finished garment dimensions from body measurements,
 * applied ease, and fabric stretch compensation.
 */
export function calculateGarmentDimensions(
  body: BodyMeasurements,
  easeProfile: EaseProfile,
  fabric?: FabricProperty
): {
  garmentWaistCm: number;
  garmentHipCm: number;
  totalLengthCm: number;
  appliedWaistEaseCm: number;
  appliedHipEaseCm: number;
} {
  const baseEase = EASE_TABLE[easeProfile];
  
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

  const appliedWaistEase = Number((baseEase.waist * stretchFactorWaist).toFixed(1));
  const appliedHipEase = Number((baseEase.hip * stretchFactorHip).toFixed(1));

  return {
    garmentWaistCm: Number((body.waist + appliedWaistEase).toFixed(1)),
    garmentHipCm: Number((body.lowHip + appliedHipEase).toFixed(1)),
    totalLengthCm: body.skirtLength,
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

  if (m.bustSpan !== undefined) {
    if (!Number.isFinite(m.bustSpan) || m.bustSpan <= 0) {
      errors.push(`Bust span (apex-to-apex distance) must be a positive finite number (received: ${m.bustSpan}).`);
    } else if (m.bustSpan < 12 || m.bustSpan > 30) {
      errors.push(`Bust span (${m.bustSpan} cm) falls outside boundary (12 cm to 30 cm).`);
    }
  }

  if (m.bustHeight !== undefined) {
    if (!Number.isFinite(m.bustHeight) || m.bustHeight <= 0) {
      errors.push(`Bust height (side neck to apex) must be a positive finite number (received: ${m.bustHeight}).`);
    } else if (m.bustHeight < 18 || m.bustHeight > 42) {
      errors.push(`Bust height (${m.bustHeight} cm) falls outside boundary (18 cm to 42 cm).`);
    }
  }

  if (m.armholeDepth !== undefined) {
    if (!Number.isFinite(m.armholeDepth) || m.armholeDepth <= 0) {
      errors.push(`Armhole depth must be a positive finite number (received: ${m.armholeDepth}).`);
    } else if (m.armholeDepth < 14 || m.armholeDepth > 32) {
      errors.push(`Armhole depth (${m.armholeDepth} cm) falls outside boundary (14 cm to 32 cm).`);
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
  fabric?: FabricProperty
): {
  garmentBustCm: number;
  garmentWaistCm: number;
  appliedBustEaseCm: number;
  appliedWaistEaseCm: number;
} {
  const baseEase = EASE_TABLE[easeProfile];

  let stretchFactorBust = 1.0;
  let stretchFactorWaist = 1.0;

  if (fabric?.stretch === 'low-stretch') {
    stretchFactorBust = 0.85;
    stretchFactorWaist = 0.85;
  } else if (fabric?.stretch === 'high-stretch') {
    stretchFactorBust = 0.5;
    stretchFactorWaist = 0.5;
  }

  const appliedBustEase = Number((baseEase.bust * stretchFactorBust).toFixed(1));
  const appliedWaistEase = Number((baseEase.waist * stretchFactorWaist).toFixed(1));
  const bustVal = body.bust ?? 90;

  return {
    garmentBustCm: Number((bustVal + appliedBustEase).toFixed(1)),
    garmentWaistCm: Number((body.waist + appliedWaistEase).toFixed(1)),
    appliedBustEaseCm: appliedBustEase,
    appliedWaistEaseCm: appliedWaistEase
  };
}

