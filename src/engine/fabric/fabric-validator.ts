import { EnhancedFabricProperty, FabricValidationResult, PropertySourceType, PropertyVerificationStatus } from './fabric-types';

const VALID_RECORD_PROVENANCES = ['supplier-declared', 'laboratory-tested', 'user-entered', 'project-default'];
const VALID_PROPERTY_SOURCES: PropertySourceType[] = [
  'laboratory-measured',
  'supplier-declared',
  'user-measured',
  'user-entered',
  'project-default',
  'estimated',
  'unknown'
];
const VALID_VERIFICATION_STATUSES: PropertyVerificationStatus[] = ['verified', 'unverified', 'provisional'];

/**
 * Validates physical and directional fabric properties for computational pattern engineering.
 * Enforces realistic physical constraints, non-negative shrinkage and elongation,
 * valid finite numerical values (no NaN or Infinity), and rigorous provenance metadata.
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
  if (fabric.gsm === undefined || fabric.gsm === null || typeof fabric.gsm !== 'number' || !Number.isFinite(fabric.gsm) || isNaN(fabric.gsm)) {
    errors.push('Fabric GSM (g/m²) is required and must be a finite number.');
  } else if (fabric.gsm <= 0) {
    errors.push(`Fabric GSM must be strictly positive (got ${fabric.gsm} g/m²).`);
  } else if (fabric.gsm < 25) {
    warnings.push(`Fabric GSM (${fabric.gsm} g/m²) is exceptionally light (under 25 g/m²); check structural viability for tailored garments.`);
  } else if (fabric.gsm > 800) {
    warnings.push(`Fabric GSM (${fabric.gsm} g/m²) is extremely heavy (over 800 g/m²); check needle penetration and machine clearance.`);
  }

  // 3. Caliper Thickness
  if (fabric.thicknessMm === undefined || fabric.thicknessMm === null || typeof fabric.thicknessMm !== 'number' || !Number.isFinite(fabric.thicknessMm) || isNaN(fabric.thicknessMm)) {
    errors.push('Fabric thickness in millimetres is required and must be a finite number.');
  } else if (fabric.thicknessMm <= 0) {
    errors.push(`Fabric thickness must be strictly positive (got ${fabric.thicknessMm} mm).`);
  } else if (fabric.thicknessMm > 5.0) {
    warnings.push(`Fabric thickness (${fabric.thicknessMm} mm) exceeds 5.0 mm; turn-of-cloth seam allowances and bulk grading required.`);
  }

  // 4. Provenance & Audit Integrity
  if (!fabric.provenance || !VALID_RECORD_PROVENANCES.includes(fabric.provenance)) {
    errors.push(`Invalid fabric provenance: '${fabric.provenance}'. Must be one of: ${VALID_RECORD_PROVENANCES.join(', ')}.`);
  }

  if (fabric.provenance === 'laboratory-tested') {
    if (!fabric.testStandard || fabric.testStandard.trim() === '') {
      errors.push('Fabric claims laboratory-tested provenance without supporting test evidence or accredited standard.');
    }
  }

  if (fabric.provenance === 'project-default') {
    if (fabric.isVerified === true) {
      errors.push('A project default reference cannot be marked as verified laboratory data.');
    }
    warnings.push('Fabric preset is an illustrative reference with unverified laboratory data.');
  }

  // 5. Directional Warp Properties
  const warp = fabric.directional?.warp;
  if (!warp) {
    errors.push('Directional warp properties are required.');
  } else {
    if (warp.shrinkagePercent === undefined || typeof warp.shrinkagePercent !== 'number' || !Number.isFinite(warp.shrinkagePercent)) {
      errors.push('Warp shrinkage must be a finite number.');
    } else if (warp.shrinkagePercent < 0) {
      errors.push(`Warp shrinkage cannot be negative (got ${warp.shrinkagePercent}%).`);
    } else if (warp.shrinkagePercent > 25.0) {
      errors.push(`Warp shrinkage (${warp.shrinkagePercent}%) exceeds physical limit of 25.0%; fabric is dimensionally unstable.`);
    } else if (warp.shrinkagePercent > 5.0) {
      warnings.push(`High warp shrinkage (${warp.shrinkagePercent}%); pre-shrinking or cutting allowance required.`);
    }

    if (warp.stretchPercent === undefined || typeof warp.stretchPercent !== 'number' || !Number.isFinite(warp.stretchPercent)) {
      errors.push('Warp stretch must be a finite number.');
    } else if (warp.stretchPercent < 0) {
      errors.push(`Warp stretch cannot be negative (got ${warp.stretchPercent}%).`);
    } else if (warp.stretchPercent > 50.0) {
      errors.push(`Warp stretch (${warp.stretchPercent}%) exceeds 50.0% for lengthwise woven/knit structure.`);
    }

    if (warp.elasticRecoveryPercent !== undefined) {
      if (!Number.isFinite(warp.elasticRecoveryPercent) || warp.elasticRecoveryPercent < 0 || warp.elasticRecoveryPercent > 100) {
        errors.push(`Warp elastic recovery must be within [0, 100]% (got ${warp.elasticRecoveryPercent}%).`);
      }
    }
  }

  // 6. Directional Weft Properties
  const weft = fabric.directional?.weft;
  if (!weft) {
    errors.push('Directional weft properties are required.');
  } else {
    if (weft.shrinkagePercent === undefined || typeof weft.shrinkagePercent !== 'number' || !Number.isFinite(weft.shrinkagePercent)) {
      errors.push('Weft shrinkage must be a finite number.');
    } else if (weft.shrinkagePercent < 0) {
      errors.push(`Weft shrinkage cannot be negative (got ${weft.shrinkagePercent}%).`);
    } else if (weft.shrinkagePercent > 25.0) {
      errors.push(`Weft shrinkage (${weft.shrinkagePercent}%) exceeds physical limit of 25.0%.`);
    } else if (weft.shrinkagePercent > 5.0) {
      warnings.push(`High weft shrinkage (${weft.shrinkagePercent}%); circumferences will shrink during steam pressing.`);
    }

    if (weft.stretchPercent === undefined || typeof weft.stretchPercent !== 'number' || !Number.isFinite(weft.stretchPercent)) {
      errors.push('Weft stretch must be a finite number.');
    } else if (weft.stretchPercent < 0) {
      errors.push(`Weft stretch cannot be negative (got ${weft.stretchPercent}%).`);
    } else if (weft.stretchPercent > 100.0) {
      errors.push(`Weft stretch (${weft.stretchPercent}%) exceeds 100.0% standard tensile limit.`);
    }

    if (weft.elasticRecoveryPercent !== undefined) {
      if (!Number.isFinite(weft.elasticRecoveryPercent) || weft.elasticRecoveryPercent < 0 || weft.elasticRecoveryPercent > 100) {
        errors.push(`Weft elastic recovery must be within [0, 100]% (got ${weft.elasticRecoveryPercent}%).`);
      }
    }
  }

  // 7. Directional Bias Properties
  const bias = fabric.directional?.bias;
  if (!bias) {
    errors.push('Directional bias properties are required.');
  } else {
    if (bias.stretchPercent === undefined || typeof bias.stretchPercent !== 'number' || !Number.isFinite(bias.stretchPercent)) {
      errors.push('Bias stretch must be a finite number.');
    } else if (bias.stretchPercent < 0) {
      errors.push(`Bias stretch cannot be negative (got ${bias.stretchPercent}%).`);
    } else if (bias.stretchPercent > 120.0) {
      errors.push(`Bias stretch (${bias.stretchPercent}%) exceeds 120.0% physical threshold.`);
    }

    if (bias.drapeCoefficient !== undefined) {
      if (!Number.isFinite(bias.drapeCoefficient) || bias.drapeCoefficient < 0.05 || bias.drapeCoefficient > 1.0) {
        errors.push(`Cusick drape coefficient must be a finite number within [0.05, 1.0] (got ${bias.drapeCoefficient}).`);
      }
    }
  }

  // 8. Molding Factor
  if (fabric.moldingFactor === undefined || typeof fabric.moldingFactor !== 'number' || !Number.isFinite(fabric.moldingFactor) || isNaN(fabric.moldingFactor)) {
    errors.push('Ease molding factor must be a finite number.');
  } else if (fabric.moldingFactor < 0.3 || fabric.moldingFactor > 2.0) {
    errors.push(`Ease molding factor must be between 0.3 and 2.0 (got ${fabric.moldingFactor}).`);
  }

  // 9. Property-Level Provenance Checks
  if (fabric.propertyProvenance) {
    for (const [propKey, prov] of Object.entries(fabric.propertyProvenance)) {
      if (prov) {
        if (!VALID_PROPERTY_SOURCES.includes(prov.sourceType)) {
          errors.push(`Property '${propKey}' has invalid source type: '${prov.sourceType}'.`);
        }
        if (!VALID_VERIFICATION_STATUSES.includes(prov.verificationStatus)) {
          errors.push(`Property '${propKey}' has invalid verification status: '${prov.verificationStatus}'.`);
        }
        if (prov.sourceType === 'laboratory-measured' && prov.verificationStatus === 'verified' && !prov.testStandard) {
          errors.push(`Property '${propKey}' claims verified laboratory measurement without test standard reference.`);
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    fabric
  };
}

