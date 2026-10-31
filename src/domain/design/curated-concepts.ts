/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DesignSpecification } from '../../types';
import { PRESET_FABRICS } from './preset-fabrics';

export const INITIAL_CONCEPTS: DesignSpecification[] = [
  {
    id: 'concept-skirt-01',
    name: 'Atelier Minimalist Wool Midi Skirt',
    prompt: 'Tailored architectural midi skirt in virgin wool crepe with contoured waist, clean vertical dart suppressions, and concealed center-back zip.',
    garmentCategory: 'skirt',
    silhouette: 'straight',
    fabric: PRESET_FABRICS[0], // Virgin Wool Crepe
    color: {
      name: 'Chalk Oatmeal',
      hex: '#E8E3D9'
    },
    easeProfile: 'classic',
    lengthCm: 68,
    constructionFeatures: [
      {
        id: 'feat-01',
        category: 'closure',
        name: 'Concealed Center-Back Zip',
        description: '20cm YKK concealed coil zipper placed 1.5cm below waist seam for clean closure.',
        patternImpact: '1.5cm seam allowance on CB seam; notch placed at 20cm zip stop.'
      },
      {
        id: 'feat-02',
        category: 'dart',
        name: 'Single Contoured Front Dart Pair',
        description: '9.5cm length waist dart positioned at princess apex line for subtle abdomen contouring.',
        patternImpact: 'Absorbs 1.6cm suppression on front quarter.'
      },
      {
        id: 'feat-03',
        category: 'hem',
        name: 'Blind Catch-Stitch Hem',
        description: '3.0cm deep blind hem allowance with fused stay-tape.',
        patternImpact: '3.0cm bottom cut offset.'
      }
    ],
    designNotes: [
      'Waist finished with internal grosgrain stay-ribbon (3cm width) instead of external waistband.',
      'Front panel cut on fold; back panel cut in 2 pieces.'
    ],
    isApproved: true,
    approvedAt: '2026-10-31T12:00:00Z',
    version: 1,
    aiEstimates: {
      suggestedSilhouette: 'Tailored Column / Architectural Straight',
      styleConfidenceScore: 96,
      suggestedFabrics: ['Virgin Wool Crepe', 'Heavy Belgian Linen', 'Compact Cotton Gabardine'],
      technicalAdvice: 'Wool crepe will mold seamlessly over the hip curve with light steam pressing. Recommended 1.5cm side seam allowances for tailoring adjustments.',
      disclaimer: 'AI-generated design concept. Construction parameters and measurements must be verified and approved prior to physical cutting.'
    }
  },
  {
    id: 'concept-skirt-02',
    name: 'Structured Gabardine A-Line Skirt',
    prompt: 'Contemporary flared A-line silhouette in crisp Japanese cotton twill with subtle hem flare and tailored waist.',
    garmentCategory: 'skirt',
    silhouette: 'a-line',
    fabric: PRESET_FABRICS[1], // Japanese Cotton Twill
    color: {
      name: 'Midnight Ink',
      hex: '#1C212D'
    },
    easeProfile: 'relaxed',
    lengthCm: 62,
    constructionFeatures: [
      {
        id: 'feat-11',
        category: 'waistband',
        name: 'Structured Straight Waistband',
        description: '4cm wide reinforced waistband with hook-and-eye bar closure.',
        patternImpact: 'Separate waistband pattern piece required; 1.0cm waist seamline.'
      },
      {
        id: 'feat-12',
        category: 'hem',
        name: 'Topstitched Wide Hem',
        description: '4.0cm hem with double needle topstitching.',
        patternImpact: '4.0cm hem allowance drafted on front and back panels.'
      }
    ],
    designNotes: [
      'Hem flare drafted at +4.0cm lateral extension at side seam.',
      'Back zipper with self-fabric facing.'
    ],
    isApproved: false,
    version: 1,
    aiEstimates: {
      suggestedSilhouette: 'A-Line Swing',
      styleConfidenceScore: 92,
      suggestedFabrics: ['Japanese Compact Cotton Twill', 'Raw Selvedge Denim'],
      technicalAdvice: 'The flared side seam produces graceful movement. Ensure grainline is aligned strictly parallel to center front fold.',
      disclaimer: 'AI-generated design concept. Construction parameters and measurements must be verified and approved prior to physical cutting.'
    }
  }
];
