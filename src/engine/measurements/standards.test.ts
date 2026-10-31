/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STANDARD_SIZING_SYSTEM,
  EASE_TABLE,
  validateBodyMeasurements,
  calculateGarmentDimensions
} from './standards';
import { BodyMeasurements } from '../../types';

test('STANDARD_SIZING_SYSTEM contains all standard sizes with valid measurements', () => {
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
  for (const size of sizes) {
    const data = STANDARD_SIZING_SYSTEM.sizes[size];
    assert.ok(data, `Size ${size} must exist`);
    assert.equal(data.unit, 'cm');
    assert.ok(data.waist > 50 && data.waist < 130, `Waist for ${size} should be reasonable`);
    assert.ok(data.lowHip > data.waist, `Low hip for ${size} should be larger than waist`);
  }
});

test('calculateGarmentDimensions applies correct ease according to profile', () => {
  const bodyM = STANDARD_SIZING_SYSTEM.sizes.M; // waist: 72, lowHip: 98
  
  // Classic ease adds 4.0cm to waist, 5.0cm to hip
  const classicResult = calculateGarmentDimensions(bodyM, 'classic');
  assert.equal(classicResult.appliedWaistEaseCm, 4.0);
  assert.equal(classicResult.appliedHipEaseCm, 5.0);
  assert.equal(classicResult.garmentWaistCm, 76.0);
  assert.equal(classicResult.garmentHipCm, 103.0);

  // Ultra-fitted ease
  const ultraFitted = calculateGarmentDimensions(bodyM, 'ultra-fitted');
  assert.equal(ultraFitted.garmentWaistCm, 73.0);
  assert.equal(ultraFitted.garmentHipCm, 99.5);
});

test('validateBodyMeasurements catches invalid or physically impossible inputs', () => {
  const invalidShort: Partial<BodyMeasurements> = {
    waist: 20, // Impossible waist
    lowHip: 90,
    waistToHip: 20,
    skirtLength: 60
  };
  const res1 = validateBodyMeasurements(invalidShort);
  assert.equal(res1.isValid, false);
  assert.ok(res1.errors.some(e => e.includes('Waist measurement must be between 45 cm and 160 cm')));

  const validMeasurement: BodyMeasurements = {
    unit: 'cm',
    waist: 70,
    highHip: 88,
    lowHip: 96,
    waistToHip: 20,
    skirtLength: 65
  };
  const res2 = validateBodyMeasurements(validMeasurement);
  assert.equal(res2.isValid, true);
  assert.equal(res2.errors.length, 0);
});
