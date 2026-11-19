/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FabricProperty } from '../../types';
import { DEFAULT_ILLUSTRATIVE_FABRIC, getEnhancedFabricById } from '../fabric/fabric-presets';
import { EnhancedFabricProperty } from '../fabric/fabric-types';
import {
  CalibratedMaterialConstitutiveSpec,
  MaterialConstitutiveEvidenceTier
} from './simulation-types';

/**
 * Converts a fabric specification into an orthotropic constitutive shell model (ADR-005 / DOS-04-R2).
 * Enforces:
 * - Strict 3-tier evidence gating (`TIER_1_LAB`, `TIER_2_BENCHTOP`, `TIER_3_PRIOR`)
 * - Orthotropic symmetry (`nu12 * E_weft === nu21 * E_warp`)
 * - Positive-definite 2D elasticity tensor (`E_warp > 0`, `E_weft > 0`, `G12 > 0`, `1 - nu12*nu21 > 0`)
 */
export function calibrateConstitutiveMaterial(
  fabric: FabricProperty | EnhancedFabricProperty
): CalibratedMaterialConstitutiveSpec {
  const enhanced: EnhancedFabricProperty = isEnhancedFabric(fabric)
    ? fabric
    : resolveEnhancedFallback(fabric);

  const evidenceTier: MaterialConstitutiveEvidenceTier =
    enhanced.isVerified && enhanced.provenance === 'laboratory-tested'
      ? 'TIER_1_LAB'
      : enhanced.isVerified && enhanced.provenance === 'supplier-declared'
      ? 'TIER_2_BENCHTOP'
      : 'TIER_3_PRIOR';

  const gsm = Math.max(40, enhanced.gsm);
  const thicknessMm = Math.max(0.12, enhanced.thicknessMm);
  const densityKgM2 = gsm / 1000;

  // Map tensile elongation resistance & directional stretch into membrane N/cm shell stiffness
  // Stiffer woven cotton twill ~160-240 N/cm low-strain tangent modulus; fluid silk ~65-110 N/cm;
  // stretch fabrics lower membrane modulus proportionally to stretchability.
  const warpStretch = Math.max(0.5, enhanced.directional.warp.stretchPercent);
  const weftStretch = Math.max(0.5, enhanced.directional.weft.stretchPercent);
  const biasStretch = Math.max(2.0, enhanced.directional.bias.stretchPercent);

  const baseWarpScale = enhanced.directional.warp.tensileModulusN
    ? enhanced.directional.warp.tensileModulusN * 0.35
    : 480 / Math.sqrt(warpStretch);
  const baseWeftScale = enhanced.directional.weft.tensileModulusN
    ? enhanced.directional.weft.tensileModulusN * 0.35
    : 440 / Math.sqrt(weftStretch);

  const weightFactor =
    enhanced.weight === 'heavy' ? 1.25 : enhanced.weight === 'lightweight' ? 0.72 : 1.0;

  const eWarpNCm = Math.max(18, Number((baseWarpScale * weightFactor * (1 + 2.0 / warpStretch) * 0.55).toFixed(4)));
  const eWeftNCm = Math.max(16, Number((baseWeftScale * weightFactor * (1 + 2.0 / weftStretch) * 0.55).toFixed(4)));

  // Orthotropic shear modulus inversely related to bias stretchability
  const gShearNCm = Math.max(
    4.5,
    Number((((eWarpNCm + eWeftNCm) * 0.5) * (8.0 / Math.max(8.0, biasStretch)) * 0.24).toFixed(4))
  );

  // Enforce exact orthotropic symmetry: nu12 * E_weft = nu21 * E_warp (round nu12 first, solve nu21 to 12 decimals)
  const rawNu12 = enhanced.stretch === 'high-stretch' ? 0.32 : enhanced.stretch === 'low-stretch' ? 0.26 : 0.22;
  // Clamp nu12 such that nu12 * nu21 < 0.85 always holds
  const maxSafeNu12 = Math.min(0.42, 0.85 * Math.sqrt(eWarpNCm / eWeftNCm));
  const nu12 = Number(Math.min(rawNu12, maxSafeNu12).toFixed(6));
  const nu21 = Number(((nu12 * eWeftNCm) / eWarpNCm).toFixed(12));

  // Discrete bending rigidity B ≈ E_eff * t^3 / 12 (scaled to N*cm units for cloth drape)
  const tCm = thicknessMm / 10;
  const drapeCoeff = enhanced.directional.bias.drapeCoefficient ?? 0.48;
  const drapeStiffnessScale = Math.max(0.35, Math.min(2.2, drapeCoeff * 2.1));
  const bWarpNCm = Math.max(
    0.008,
    Number(((eWarpNCm * Math.pow(tCm, 2) * 0.45 * drapeStiffnessScale)).toFixed(6))
  );
  const bWeftNCm = Math.max(
    0.006,
    Number(((eWeftNCm * Math.pow(tCm, 2) * 0.40 * drapeStiffnessScale)).toFixed(6))
  );

  const symmetryResidual = Math.abs(nu12 * eWeftNCm - nu21 * eWarpNCm);
  const denom = 1 - nu12 * nu21;
  const determinant2D = denom > 0 ? (eWarpNCm * eWeftNCm) / denom : -1;

  const thermodynamicallyAdmissible =
    eWarpNCm > 0 &&
    eWeftNCm > 0 &&
    gShearNCm > 0 &&
    denom > 0 &&
    determinant2D > 0 &&
    symmetryResidual <= 1e-9;

  const warnings: string[] = [];
  if (evidenceTier === 'TIER_3_PRIOR') {
    warnings.push(
      'Material constitutive tensor uses TIER_3_PRIOR (illustrative reference values). Promotion to Sample_Approved or Production_Ready requires TIER_1_LAB or TIER_2_BENCHTOP coupon data (ADR-005).'
    );
  }
  if (!thermodynamicallyAdmissible) {
    warnings.push('Calibrated constitutive tensor failed thermodynamic positive-definiteness or orthotropic symmetry.');
  }

  return {
    materialSpecId: `mat-const-${enhanced.id}-${evidenceTier.toLowerCase()}`,
    fabricId: enhanced.id,
    fabricName: enhanced.name,
    evidenceTier,
    eWarpNCm,
    eWeftNCm,
    gShearNCm,
    nu12,
    nu21,
    bWarpNCm,
    bWeftNCm,
    densityKgM2: Number(densityKgM2.toFixed(4)),
    thicknessMm,
    shrinkageWarpPct: enhanced.directional.warp.shrinkagePercent,
    shrinkageWeftPct: enhanced.directional.weft.shrinkagePercent,
    maxSafeEaseStretchPct: Math.min(25, Math.max(2.5, Math.min(warpStretch, weftStretch) * 0.85)),
    symmetryResidual,
    determinant2D,
    thermodynamicallyAdmissible,
    warnings
  };
}

function isEnhancedFabric(fabric: FabricProperty | EnhancedFabricProperty): fabric is EnhancedFabricProperty {
  return 'directional' in fabric && 'gsm' in fabric && 'thicknessMm' in fabric;
}

function resolveEnhancedFallback(fabric: FabricProperty): EnhancedFabricProperty {
  const lookup = getEnhancedFabricById(fabric.id);
  if (lookup.status === 'found') {
    return {
      ...lookup.fabric,
      name: fabric.name || lookup.fabric.name,
      weight: fabric.weight || lookup.fabric.weight,
      stretch: fabric.stretch || lookup.fabric.stretch
    };
  }
  return {
    ...DEFAULT_ILLUSTRATIVE_FABRIC,
    id: fabric.id || DEFAULT_ILLUSTRATIVE_FABRIC.id,
    name: fabric.name || DEFAULT_ILLUSTRATIVE_FABRIC.name,
    composition: fabric.composition || DEFAULT_ILLUSTRATIVE_FABRIC.composition,
    weight: fabric.weight || DEFAULT_ILLUSTRATIVE_FABRIC.weight,
    stretch: fabric.stretch || DEFAULT_ILLUSTRATIVE_FABRIC.stretch,
    recommendedEaseCm: fabric.recommendedEaseCm || DEFAULT_ILLUSTRATIVE_FABRIC.recommendedEaseCm,
    drapeDescription: fabric.drapeDescription || DEFAULT_ILLUSTRATIVE_FABRIC.drapeDescription,
    provenance: 'project-default',
    isVerified: false,
    isIllustrativeReference: true
  };
}
