/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EnhancedFabricProperty, FabricLookupResult, FabricPropertyProvenanceRecord } from './fabric-types';

function createIllustrativeProvenance(
  gsm: number,
  thicknessMm: number,
  warpShrink: number,
  warpStretch: number,
  weftShrink: number,
  weftStretch: number,
  biasStretch: number,
  molding: number
): FabricPropertyProvenanceRecord {
  return {
    gsm: {
      value: gsm,
      unit: 'g/m²',
      sourceType: 'project-default',
      sourceReference: 'Patroner illustrative reference library',
      verificationStatus: 'unverified'
    },
    thicknessMm: {
      value: thicknessMm,
      unit: 'mm',
      sourceType: 'project-default',
      sourceReference: 'Patroner illustrative reference library',
      verificationStatus: 'unverified'
    },
    warpShrinkage: {
      value: warpShrink,
      unit: '%',
      sourceType: 'project-default',
      sourceReference: 'Patroner illustrative reference library',
      verificationStatus: 'unverified'
    },
    warpStretch: {
      value: warpStretch,
      unit: '%',
      sourceType: 'project-default',
      sourceReference: 'Patroner illustrative reference library',
      verificationStatus: 'unverified'
    },
    weftShrinkage: {
      value: weftShrink,
      unit: '%',
      sourceType: 'project-default',
      sourceReference: 'Patroner illustrative reference library',
      verificationStatus: 'unverified'
    },
    weftStretch: {
      value: weftStretch,
      unit: '%',
      sourceType: 'project-default',
      sourceReference: 'Patroner illustrative reference library',
      verificationStatus: 'unverified'
    },
    biasStretch: {
      value: biasStretch,
      unit: '%',
      sourceType: 'project-default',
      sourceReference: 'Patroner illustrative reference library',
      verificationStatus: 'unverified'
    },
    moldingFactor: {
      value: molding,
      unit: 'scalar',
      sourceType: 'estimated',
      sourceReference: 'Patroner empirical provisional model',
      verificationStatus: 'provisional'
    }
  };
}

/**
 * Illustrative reference fabric library for computational pattern prototyping.
 * NOTE (Milestone 04.5.1 Audit): All presets are project-defined illustrative references.
 * Values have NOT been certified by accredited laboratory testing and are marked unverified.
 */
export const ENHANCED_PRESET_FABRICS: EnhancedFabricProperty[] = [
  {
    id: 'wool-crepe',
    name: 'Virgin Wool Crepe (Illustrative Reference)',
    composition: '100% Wool (Nominal 320 g/m²)',
    weight: 'medium',
    stretch: 'none',
    recommendedEaseCm: { waist: 3.5, hip: 4.5, bust: 5.0 },
    drapeDescription: 'Structured fluid drape with rich matte texture and clean press lines.',
    gsm: 320,
    thicknessMm: 0.75,
    directional: {
      warp: { shrinkagePercent: 2.0, stretchPercent: 3.0, tensileModulusN: 480, elasticRecoveryPercent: 85 },
      weft: { shrinkagePercent: 1.5, stretchPercent: 4.5, tensileModulusN: 420, elasticRecoveryPercent: 85 },
      bias: { stretchPercent: 22.0, drapeCoefficient: 0.42 }
    },
    moldingFactor: 1.35,
    provenance: 'project-default',
    isVerified: false,
    isIllustrativeReference: true,
    propertyProvenance: createIllustrativeProvenance(320, 0.75, 2.0, 3.0, 1.5, 4.5, 22.0, 1.35),
    auditWarnings: [
      'Illustrative reference preset: values are representative project defaults, not certified laboratory measurements.',
      'Molding factor 1.35 is a provisional project model and has not been validated by Kawabata KES-FB mechanical testing.'
    ],
    handlingNotes: [
      'Responds exceptionally well to steam iron shaping and fullness shrinking.',
      'Recommended pressing temperature: 150°C with damp organza press cloth.',
      'Use 75/11 or 80/12 universal needle with 2.5mm stitch length.'
    ]
  },
  {
    id: 'cotton-twill',
    name: 'Japanese Compact Cotton Twill (Illustrative Reference)',
    composition: '100% Organic Combed Cotton (Nominal 280 g/m²)',
    weight: 'medium',
    stretch: 'none',
    recommendedEaseCm: { waist: 4.0, hip: 5.0, bust: 6.0 },
    drapeDescription: 'Crisp architectural hand, ideal for tailored pleats and clean darts.',
    gsm: 280,
    thicknessMm: 0.55,
    directional: {
      warp: { shrinkagePercent: 3.0, stretchPercent: 1.5, tensileModulusN: 620, elasticRecoveryPercent: 60 },
      weft: { shrinkagePercent: 2.0, stretchPercent: 2.5, tensileModulusN: 540, elasticRecoveryPercent: 65 },
      bias: { stretchPercent: 14.0, drapeCoefficient: 0.65 }
    },
    moldingFactor: 0.90,
    provenance: 'project-default',
    isVerified: false,
    isIllustrativeReference: true,
    propertyProvenance: createIllustrativeProvenance(280, 0.55, 3.0, 1.5, 2.0, 2.5, 14.0, 0.90),
    auditWarnings: [
      'Illustrative reference preset: values are representative project defaults, not certified laboratory measurements.'
    ],
    handlingNotes: [
      'Pre-wash or steam soak fabric before cutting to stabilize warp shrinkage.',
      'Crisp fold memory; press seams flat at 200°C with tailor clapper.'
    ]
  },
  {
    id: 'silk-charmeuse',
    name: 'Mulberry Silk Charmeuse (Illustrative Reference)',
    composition: '100% Silk (Nominal 19 momme, 82 g/m²)',
    weight: 'lightweight',
    stretch: 'mechanical',
    recommendedEaseCm: { waist: 2.0, hip: 3.0, bust: 4.0 },
    drapeDescription: 'Liquid high-luster drape, requires fine French seams and tissue stabilizing.',
    gsm: 82,
    thicknessMm: 0.22,
    directional: {
      warp: { shrinkagePercent: 1.0, stretchPercent: 2.0, tensileModulusN: 260, elasticRecoveryPercent: 50 },
      weft: { shrinkagePercent: 1.0, stretchPercent: 5.0, tensileModulusN: 220, elasticRecoveryPercent: 55 },
      bias: { stretchPercent: 35.0, drapeCoefficient: 0.28 }
    },
    moldingFactor: 0.70,
    provenance: 'project-default',
    isVerified: false,
    isIllustrativeReference: true,
    propertyProvenance: createIllustrativeProvenance(82, 0.22, 1.0, 2.0, 1.0, 5.0, 35.0, 0.70),
    auditWarnings: [
      'Illustrative reference preset: values are representative project defaults, not certified laboratory measurements.'
    ],
    handlingNotes: [
      'Use 65/9 microtex needle and fine silk thread.',
      'Do not apply direct steam without a dry press cloth to prevent water spotting.'
    ]
  },
  {
    id: 'linen-heavy',
    name: 'Artisanal Belgian Linen (Illustrative Reference)',
    composition: '100% Flax Linen (Nominal 340 g/m²)',
    weight: 'heavy',
    stretch: 'none',
    recommendedEaseCm: { waist: 4.5, hip: 6.0, bust: 6.5 },
    drapeDescription: 'Substantial textured grain with gentle soften-with-wear characteristics.',
    gsm: 340,
    thicknessMm: 0.85,
    directional: {
      warp: { shrinkagePercent: 4.0, stretchPercent: 1.0, tensileModulusN: 700, elasticRecoveryPercent: 40 },
      weft: { shrinkagePercent: 3.0, stretchPercent: 2.0, tensileModulusN: 610, elasticRecoveryPercent: 45 },
      bias: { stretchPercent: 18.0, drapeCoefficient: 0.58 }
    },
    moldingFactor: 0.85,
    provenance: 'project-default',
    isVerified: false,
    isIllustrativeReference: true,
    propertyProvenance: createIllustrativeProvenance(340, 0.85, 4.0, 1.0, 3.0, 2.0, 18.0, 0.85),
    auditWarnings: [
      'Illustrative reference preset: values are representative project defaults, not certified laboratory measurements.'
    ],
    handlingNotes: [
      'High warp shrinkage requires thorough cold pre-wash or industrial steam decatizing.',
      'Press with heavy damp heat to set darts and crisp seamlines.'
    ]
  },
  {
    id: 'selvedge-denim',
    name: 'Raw Selvedge Denim (Illustrative Reference)',
    composition: '100% Ring-Spun Cotton (Nominal 13.5 oz / 460 g/m²)',
    weight: 'heavy',
    stretch: 'none',
    recommendedEaseCm: { waist: 3.0, hip: 4.0, bust: 5.0 },
    drapeDescription: 'Rigid structural drape requiring flat-felled seam allowances and heavy topstitching.',
    gsm: 460,
    thicknessMm: 1.15,
    directional: {
      warp: { shrinkagePercent: 5.0, stretchPercent: 1.0, tensileModulusN: 920, elasticRecoveryPercent: 50 },
      weft: { shrinkagePercent: 2.5, stretchPercent: 2.0, tensileModulusN: 810, elasticRecoveryPercent: 55 },
      bias: { stretchPercent: 12.0, drapeCoefficient: 0.88 }
    },
    moldingFactor: 0.65,
    provenance: 'project-default',
    isVerified: false,
    isIllustrativeReference: true,
    propertyProvenance: createIllustrativeProvenance(460, 1.15, 5.0, 1.0, 2.5, 2.0, 12.0, 0.65),
    auditWarnings: [
      'Illustrative reference preset: values are representative project defaults, not certified laboratory measurements.'
    ],
    handlingNotes: [
      'Rigid unwashed denim will shrink 4-5% in length on first soak.',
      'Use 100/16 or 110/18 jeans needle and heavy-duty thread.'
    ]
  },
  {
    id: 'ponte-roma',
    name: 'Milano Ponte di Roma Double Knit (Illustrative Reference)',
    composition: '68% Rayon / 28% Nylon / 4% Spandex (Nominal 360 g/m²)',
    weight: 'medium',
    stretch: 'low-stretch',
    recommendedEaseCm: { waist: 1.5, hip: 2.5, bust: 3.0 },
    drapeDescription: 'Dense stable double-knit with 4-way resilience and clean body-contouring recovery.',
    gsm: 360,
    thicknessMm: 1.10,
    directional: {
      warp: { shrinkagePercent: 2.5, stretchPercent: 12.0, tensileModulusN: 340, elasticRecoveryPercent: 90 },
      weft: { shrinkagePercent: 2.0, stretchPercent: 25.0, tensileModulusN: 280, elasticRecoveryPercent: 88 },
      bias: { stretchPercent: 32.0, drapeCoefficient: 0.48 }
    },
    moldingFactor: 1.10,
    provenance: 'project-default',
    isVerified: false,
    isIllustrativeReference: true,
    propertyProvenance: createIllustrativeProvenance(360, 1.10, 2.5, 12.0, 2.0, 25.0, 32.0, 1.10),
    auditWarnings: [
      'Illustrative reference preset: values are representative project defaults, not certified laboratory measurements.'
    ],
    handlingNotes: [
      'Crosswise stretch requires negative ease compensation (-1.5 to -2.5cm circumference deduction).',
      'Stitch with ballpoint 80/12 needle and slight zig-zag or 4-thread overlock.'
    ]
  }
];

export const DEFAULT_ILLUSTRATIVE_FABRIC: EnhancedFabricProperty = ENHANCED_PRESET_FABRICS[0];

/**
 * Finds an enhanced fabric by its unique ID.
 * Milestone 04.5.1 Audit: Unknown or missing fabric IDs must NOT silently return wool crepe!
 * Returns an explicit FabricLookupResult with status: 'found' | 'not-found' | 'invalid-record'.
 */
export function getEnhancedFabricById(fabricId?: string): FabricLookupResult {
  if (!fabricId || fabricId.trim() === '') {
    return {
      status: 'not-found',
      fabricId,
      message: 'Fabric ID was not specified. An explicit fabric selection is required.'
    };
  }

  const found = ENHANCED_PRESET_FABRICS.find(f => f.id === fabricId);
  if (!found) {
    return {
      status: 'not-found',
      fabricId,
      message: `Fabric with ID '${fabricId}' was not found in the preset library. Explicit material selection required.`
    };
  }

  return {
    status: 'found',
    fabric: found
  };
}

/**
 * Explicit helper to resolve fabric with explicit user consent to use project default illustrative reference.
 */
export function resolveFabricWithExplicitConsent(
  fabricId?: string,
  userConsentToDefault: boolean = false
): FabricLookupResult {
  const result = getEnhancedFabricById(fabricId);
  if (result.status === 'found') {
    return result;
  }

  if (userConsentToDefault) {
    return {
      status: 'found',
      fabric: DEFAULT_ILLUSTRATIVE_FABRIC
    };
  }

  return result;
}

