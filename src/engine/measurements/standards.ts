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
      shoulderLength: 12
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
      shoulderLength: 12.3
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
      shoulderLength: 12.7
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
      shoulderLength: 13.1
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
      shoulderLength: 13.5
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
      shoulderLength: 14.0
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
