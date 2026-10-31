/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FabricProperty } from '../../types';

export const PRESET_FABRICS: FabricProperty[] = [
  {
    id: 'wool-crepe',
    name: 'Virgin Wool Crepe',
    composition: '100% Wool (320 g/m²)',
    weight: 'medium',
    stretch: 'none',
    recommendedEaseCm: { waist: 3.5, hip: 4.5, bust: 5.0 },
    drapeDescription: 'Structured fluid drape with rich matte texture and clean press lines.'
  },
  {
    id: 'cotton-twill',
    name: 'Japanese Compact Cotton Twill',
    composition: '100% Organic Combed Cotton (280 g/m²)',
    weight: 'medium',
    stretch: 'none',
    recommendedEaseCm: { waist: 4.0, hip: 5.0, bust: 6.0 },
    drapeDescription: 'Crisp architectural hand, ideal for tailored pleats and clean darts.'
  },
  {
    id: 'silk-charmeuse',
    name: 'Mulberry Silk Charmeuse',
    composition: '100% Silk (19 momme, 82 g/m²)',
    weight: 'lightweight',
    stretch: 'mechanical',
    recommendedEaseCm: { waist: 2.0, hip: 3.0, bust: 4.0 },
    drapeDescription: 'Liquid high-luster drape, requires fine French seams and tissue stabilizing.'
  },
  {
    id: 'linen-heavy',
    name: 'Artisanal Belgian Linen',
    composition: '100% Flax Linen (340 g/m²)',
    weight: 'heavy',
    stretch: 'none',
    recommendedEaseCm: { waist: 4.5, hip: 6.0, bust: 6.5 },
    drapeDescription: 'Substantial textured grain with gentle soften-with-wear characteristics.'
  },
  {
    id: 'selvedge-denim',
    name: 'Raw Kuroki Selvedge Denim',
    composition: '100% Ring-Spun Cotton (13.5 oz)',
    weight: 'heavy',
    stretch: 'none',
    recommendedEaseCm: { waist: 3.0, hip: 4.0, bust: 5.0 },
    drapeDescription: 'Rigid structural drape requiring flat-felled seam allowances and heavy topstitching.'
  }
];
