/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, StandardSize } from '../../types';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { MeasurementGradeRule, MeasurementGradeTable } from './grading-types';

export const DEFAULT_BASE_SIZE: StandardSize = 'M';
export const DEFAULT_SIZE_RANGE: StandardSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/**
 * Builds standard anthropometric grade rules derived from the approved
 * Patroner European Anthropometric Reference (aligned with EN 13402 & Aldrich proportions).
 * Base reference size: M (EU 38).
 */
export function buildStandardMeasurementGradeTable(): MeasurementGradeTable {
  const baseMeasurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const sizes = DEFAULT_SIZE_RANGE;

  const createRule = (
    key: keyof Omit<BodyMeasurements, 'unit'>,
    label: string,
    distribution: MeasurementGradeRule['distribution'],
    description: string
  ): MeasurementGradeRule => {
    const baseVal = baseMeasurements[key] ?? 0;
    const increments: Record<string, number> = {};
    for (const sz of sizes) {
      const szVal = STANDARD_SIZING_SYSTEM.sizes[sz][key] ?? baseVal;
      increments[sz] = Number((szVal - baseVal).toFixed(2));
    }

    return {
      measurementId: key,
      label,
      unit: 'cm',
      baseSizeValue: baseVal,
      incrementsFromBase: increments,
      distribution,
      source: 'EN 13402 / Aldrich Proportions',
      isStandard: true,
      applicableCategory: 'all',
      description
    };
  };

  const rules: Record<string, MeasurementGradeRule> = {
    bust: createRule(
      'bust',
      'Bust Circumference',
      'circumference-symmetric',
      'Standard 4.0-6.0-10.0cm European interval: S=-6, XS=-10, L=+8, XL=+16, XXL=+26 relative to M=90'
    ),
    waist: createRule(
      'waist',
      'Waist Circumference',
      'circumference-symmetric',
      'Standard waist suppression grade rule: S=-6, XS=-10, L=+8, XL=+16, XXL=+26 relative to M=72'
    ),
    lowHip: createRule(
      'lowHip',
      'Low Hip Circumference',
      'circumference-symmetric',
      'Standard low hip interval matching full pelvic width expansion across size transitions'
    ),
    highHip: createRule(
      'highHip',
      'High Hip Circumference',
      'circumference-symmetric',
      'High hip level anatomical expansion between waist and full hip'
    ),
    acrossBack: createRule(
      'acrossBack',
      'Across Back Width',
      'bilateral-symmetric',
      'Dorsal span between posterior scye lines (+1.5cm per transition)'
    ),
    shoulderLength: createRule(
      'shoulderLength',
      'Shoulder Seam Length',
      'bilateral-symmetric',
      'Clavicle length grade (+0.3cm to +0.5cm per transition from neck point to acromion tip)'
    ),
    neckCircumference: createRule(
      'neckCircumference',
      'Neck Base Circumference',
      'circumference-symmetric',
      'Neckline circumference scaling (+1.0cm to +2.0cm per transition)'
    ),
    bustSpan: createRule(
      'bustSpan',
      'Bust Apex-to-Apex Span',
      'bilateral-symmetric',
      'Inter-nipple distance scaling with chest broadness (+1.0cm to +1.5cm per transition)'
    ),
    bustHeight: createRule(
      'bustHeight',
      'Bust Apex Height from Side Neck',
      'vertical-linear',
      'Vertical descent of apex point (+0.5cm to +1.5cm per size)'
    ),
    armholeDepth: createRule(
      'armholeDepth',
      'Armhole Scye Depth',
      'vertical-linear',
      'Distance from nape to level of scye (+0.5cm to +1.5cm per size)'
    ),
    backWaistLength: createRule(
      'backWaistLength',
      'Center Back Waist Length',
      'vertical-linear',
      'Torso vertical elongation (+0.5cm to +0.8cm per size)'
    ),
    frontWaistLength: createRule(
      'frontWaistLength',
      'Front Waist Length',
      'vertical-linear',
      'Front torso length accommodating bust projection (+0.5cm to +0.8cm per size)'
    ),
    bicepsCircumference: createRule(
      'bicepsCircumference',
      'Maximum Upper Arm Girth',
      'circumference-symmetric',
      'Biceps expansion matching armhole ease (+1.5cm to +3.5cm per size)'
    ),
    elbowCircumference: createRule(
      'elbowCircumference',
      'Elbow Joint Circumference',
      'circumference-symmetric',
      'Elbow girth grade (+1.0cm to +2.5cm per size)'
    ),
    wristCircumference: createRule(
      'wristCircumference',
      'Wrist Bone Circumference',
      'circumference-symmetric',
      'Distal wrist girth scaling (+0.5cm to +1.5cm per size)'
    ),
    sleeveLength: createRule(
      'sleeveLength',
      'Full Sleeve Length',
      'vertical-linear',
      'Acromion to wrist length (+1.0cm to +1.5cm per size)'
    ),
    armLengthToElbow: createRule(
      'armLengthToElbow',
      'Arm Length to Elbow',
      'vertical-linear',
      'Shoulder tip to elbow point distance (+1.0cm per size)'
    ),
    waistToHip: createRule(
      'waistToHip',
      'Waist to Hip Depth',
      'vertical-linear',
      'Vertical distance between waist and full hip (+0.5cm per size)'
    ),
    skirtLength: createRule(
      'skirtLength',
      'Garment Hem Length',
      'vertical-linear',
      'Finished hem line drop (+1.0cm to +2.0cm per size)'
    )
  };

  return {
    id: 'table-en13402-standard',
    name: 'EN 13402 / Aldrich Standard Anthropometric Grade Table',
    baseSize: DEFAULT_BASE_SIZE,
    supportedSizes: sizes,
    rules,
    description: 'Proportional measurement increments derived from documented European sizing tables.'
  };
}

/**
 * Validates a single body measurements object for complete numerical validity.
 */
export function validateMeasurementRecord(
  measurements: BodyMeasurements,
  sizeLabel = 'size'
): { isValid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (measurements.unit !== 'cm') {
    errors.push(`Measurement table for ${sizeLabel} specifies unit '${measurements.unit}', but must be 'cm'.`);
  }

  // Critical circumference boundaries
  const requiredFields: (keyof Omit<BodyMeasurements, 'unit' | 'height'>)[] = [
    'bust',
    'waist',
    'lowHip',
    'highHip',
    'waistToHip',
    'skirtLength',
    'backWaistLength',
    'frontWaistLength',
    'acrossBack',
    'shoulderLength',
    'neckCircumference',
    'bustSpan',
    'bustHeight',
    'armholeDepth',
    'bicepsCircumference',
    'wristCircumference',
    'sleeveLength'
  ];

  for (const field of requiredFields) {
    const val = measurements[field];
    if (val === undefined || val === null || isNaN(val)) {
      errors.push(`Missing or NaN required measurement '${field}' in ${sizeLabel}.`);
    } else if (val <= 0) {
      errors.push(`Measurement '${field}' in ${sizeLabel} must be strictly positive (got ${val} cm).`);
    }
  }

  // Specific anatomical checks
  if (measurements.bust && (measurements.bust < 60 || measurements.bust > 180)) {
    warnings.push(`Bust circumference (${measurements.bust} cm) in ${sizeLabel} is outside typical adult range [60, 180 cm].`);
  }
  if (measurements.waist && (measurements.waist < 40 || measurements.waist > 160)) {
    warnings.push(`Waist circumference (${measurements.waist} cm) in ${sizeLabel} is outside typical adult range [40, 160 cm].`);
  }
  if (measurements.shoulderLength && (measurements.shoulderLength < 8 || measurements.shoulderLength > 20)) {
    warnings.push(`Shoulder length (${measurements.shoulderLength} cm) in ${sizeLabel} is outside typical range [8, 20 cm].`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Derives the complete target BodyMeasurements for a target size by applying
 * grade rule increments to base-size measurements.
 */
export function resolveTargetMeasurements(
  baseMeasurements: BodyMeasurements,
  targetSize: string,
  gradeTable: MeasurementGradeTable,
  customOverrides?: Partial<BodyMeasurements>
): BodyMeasurements {
  const result: BodyMeasurements = {
    ...baseMeasurements,
    unit: 'cm'
  };

  for (const [key, rule] of Object.entries(gradeTable.rules)) {
    const measKey = rule.measurementId as keyof Omit<BodyMeasurements, 'unit'>;
    const baseVal = (baseMeasurements as any)[measKey] ?? rule.baseSizeValue;
    const delta = rule.incrementsFromBase[targetSize] ?? 0;
    (result as any)[measKey] = Number((baseVal + delta).toFixed(2));
  }

  // Apply explicit overrides if provided
  if (customOverrides) {
    for (const [k, v] of Object.entries(customOverrides)) {
      if (v !== undefined && typeof v === 'number') {
        (result as any)[k] = v;
      }
    }
  }

  return result;
}

/**
 * Calculates delta values (target - base) for all numeric measurements.
 */
export function computeMeasurementDeltas(
  base: BodyMeasurements,
  target: BodyMeasurements
): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const key of Object.keys(target) as (keyof BodyMeasurements)[]) {
    if (key === 'unit') continue;
    const bVal = (base as any)[key];
    const tVal = (target as any)[key];
    if (typeof bVal === 'number' && typeof tVal === 'number') {
      deltas[key] = Number((tVal - bVal).toFixed(2));
    }
  }
  return deltas;
}
