/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EnhancedFabricProperty, FabricValidationResult } from './fabric-types';

/**
 * Validates physical and directional fabric properties for computational pattern engineering.
 * Enforces realistic physical constraints, non-negative shrinkage and elongation,
 * and valid areal density / thickness boundaries.
 */
export function validateFabricProperties(fabric: EnhancedFabricProperty): FabricValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Identity & Composition
  if (!fabric.id || fabric.id.trim() === '') {
    errors.push('Fabric id cannot be empty.');
  }
  if (!fabric.name || fabric.name.trim() === '') {
    errors.push('Fabric name cannot be empty.');
  }
  if (!fabric.composition || fabric.composition.trim() === '') {
    errors.push('Fabric fiber composition cannot be empty.');
  }

  // 2. Areal Density (GSM)
  if (fabric.gsm === undefined || fabric.gsm === null || isNaN(fabric.gsm)) {
    errors.push('Fabric GSM (g/m²) is required and must be numeric.');
  } else if (fabric.gsm <= 0) {
    errors.push(`Fabric GSM must be strictly positive (got ${fabric.gsm} g/m²).`);
  } else if (fabric.gsm < 25) {
    warnings.push(`Fabric GSM (${fabric.gsm} g/m²) is exceptionally light (under 25 g/m²); check structural viability for tailored garments.`);
  } else if (fabric.gsm > 800) {
    warnings.push(`Fabric GSM (${fabric.gsm} g/m²) is extremely heavy (over 800 g/m²); check needle penetration and machine clearance.`);
  }

  // 3. Caliper Thickness
  if (fabric.thicknessMm === undefined || fabric.thicknessMm === null || isNaN(fabric.thicknessMm)) {
    errors.push('Fabric thickness in millimetres is required.');
  } else if (fabric.thicknessMm <= 0) {
    errors.push(`Fabric thickness must be strictly positive (got ${fabric.thicknessMm} mm).`);
  } else if (fabric.thicknessMm > 5.0) {
    warnings.push(`Fabric thickness (${fabric.thicknessMm} mm) exceeds 5.0 mm; turn-of-cloth seam allowances and bulk grading required.`);
  }

  // 4. Directional Warp Properties
  const warp = fabric.directional?.warp;
  if (!warp) {
    errors.push('Directional warp properties are required.');
  } else {
    if (warp.shrinkagePercent < 0) {
      errors.push(`Warp shrinkage cannot be negative (got ${warp.shrinkagePercent}%).`);
    } else if (warp.shrinkagePercent > 15.0) {
      errors.push(`Warp shrinkage (${warp.shrinkagePercent}%) exceeds physical limit of 15.0%; fabric is dimensionally unstable.`);
    } else if (warp.shrinkagePercent > 5.0) {
      warnings.push(`High warp shrinkage (${warp.shrinkagePercent}%); pre-shrinking or cutting allowance required.`);
    }

    if (warp.stretchPercent < 0) {
      errors.push(`Warp stretch cannot be negative (got ${warp.stretchPercent}%).`);
    } else if (warp.stretchPercent > 50.0) {
      errors.push(`Warp stretch (${warp.stretchPercent}%) exceeds 50.0% for lengthwise woven/knit structure.`);
    }
  }

  // 5. Directional Weft Properties
  const weft = fabric.directional?.weft;
  if (!weft) {
    errors.push('Directional weft properties are required.');
  } else {
    if (weft.shrinkagePercent < 0) {
      errors.push(`Weft shrinkage cannot be negative (got ${weft.shrinkagePercent}%).`);
    } else if (weft.shrinkagePercent > 15.0) {
      errors.push(`Weft shrinkage (${weft.shrinkagePercent}%) exceeds physical limit of 15.0%.`);
    } else if (weft.shrinkagePercent > 5.0) {
      warnings.push(`High weft shrinkage (${weft.shrinkagePercent}%); circumferences will shrink during steam pressing.`);
    }

    if (weft.stretchPercent < 0) {
      errors.push(`Weft stretch cannot be negative (got ${weft.stretchPercent}%).`);
    } else if (weft.stretchPercent > 100.0) {
      errors.push(`Weft stretch (${weft.stretchPercent}%) exceeds 100.0% standard tensile limit.`);
    }
  }

  // 6. Directional Bias Properties
  const bias = fabric.directional?.bias;
  if (!bias) {
    errors.push('Directional bias properties are required.');
  } else {
    if (bias.stretchPercent < 0) {
      errors.push(`Bias stretch cannot be negative (got ${bias.stretchPercent}%).`);
    } else if (bias.stretchPercent > 120.0) {
      errors.push(`Bias stretch (${bias.stretchPercent}%) exceeds 120.0% physical threshold.`);
    }

    if (bias.drapeCoefficient !== undefined) {
      if (bias.drapeCoefficient < 0.05 || bias.drapeCoefficient > 1.0) {
        errors.push(`Cusick drape coefficient must be within [0.05, 1.0] (got ${bias.drapeCoefficient}).`);
      }
    }
  }

  // 7. Molding Factor
  if (fabric.moldingFactor < 0.3 || fabric.moldingFactor > 2.0) {
    errors.push(`Ease molding factor must be between 0.3 and 2.0 (got ${fabric.moldingFactor}).`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    fabric
  };
}
