/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PhysicalPrototypeRecord } from './prototype-types';

/**
 * Conforming physical prototype record of the Atelier Tailored Bodice with Fitted Sleeve (Size M).
 * Constructed in 100% Virgin Wool Crepe by master tailoring atelier.
 * Empirical measurements match CAD nominal dimensions within strict ±0.15 cm tolerances.
 */
export const MOCK_CONFORMING_PROTOTYPE_BODICE_M: PhysicalPrototypeRecord = {
  id: 'PROTO-BOD-2026-M-01',
  patternDraftId: 'draft-bodice-m-wool-01',
  sampleGarmentName: 'Atelier Tailored Bodice with Sleeve Sloper',
  garmentCategory: 'bodice',
  sizeCode: 'M',
  fabricId: 'wool-crepe',
  fabricName: 'Virgin Wool Crepe (320 g/m²)',
  fabricLot: 'LOT-WOOL-2026-A12',
  tailorName: 'Atelier Sample Room — Lead Tailor M. Laurent',
  dateSewn: '2026-11-04T14:30:00.000Z',
  measurements: [
    {
      pointId: 'bust-circumference',
      label: 'Finished Garment Bust Circumference',
      category: 'circumference',
      nominalCadCm: 95.5,
      measuredPhysicalCm: 95.4,
      toleranceCm: 0.40,
      deltaCm: -0.10,
      status: 'pass',
      notes: 'Measured with garment buttoned on standard EU 38 dummy.'
    },
    {
      pointId: 'waist-circumference',
      label: 'Finished Garment Waist Circumference',
      category: 'circumference',
      nominalCadCm: 75.0,
      measuredPhysicalCm: 75.1,
      toleranceCm: 0.35,
      deltaCm: 0.10,
      status: 'pass',
      notes: 'Even waistline level; dart suppressions pressed flat toward CF/CB.'
    },
    {
      pointId: 'front-side-seam',
      label: 'Front Bodice Side Seam Length',
      category: 'seam-length',
      nominalCadCm: 19.59,
      measuredPhysicalCm: 19.55,
      toleranceCm: 0.20,
      deltaCm: -0.04,
      status: 'pass'
    },
    {
      pointId: 'back-side-seam',
      label: 'Back Bodice Side Seam Length',
      category: 'seam-length',
      nominalCadCm: 19.59,
      measuredPhysicalCm: 19.58,
      toleranceCm: 0.20,
      deltaCm: -0.01,
      status: 'pass'
    },
    {
      pointId: 'front-shoulder',
      label: 'Front Shoulder Seam Length',
      category: 'seam-length',
      nominalCadCm: 12.70,
      measuredPhysicalCm: 12.72,
      toleranceCm: 0.15,
      deltaCm: 0.02,
      status: 'pass'
    },
    {
      pointId: 'back-shoulder',
      label: 'Back Shoulder Seam Length',
      category: 'seam-length',
      nominalCadCm: 12.70,
      measuredPhysicalCm: 12.68,
      toleranceCm: 0.15,
      deltaCm: -0.02,
      status: 'pass'
    },
    {
      pointId: 'sleeve-inseam-front',
      label: 'Sleeve Front Underarm Inseam',
      category: 'seam-length',
      nominalCadCm: 49.55,
      measuredPhysicalCm: 49.50,
      toleranceCm: 0.25,
      deltaCm: -0.05,
      status: 'pass'
    },
    {
      pointId: 'sleeve-inseam-back',
      label: 'Sleeve Back Underarm Inseam',
      category: 'seam-length',
      nominalCadCm: 49.55,
      measuredPhysicalCm: 49.52,
      toleranceCm: 0.25,
      deltaCm: -0.03,
      status: 'pass'
    },
    {
      pointId: 'sleeve-biceps-girth',
      label: 'Sleeve Biceps Girth (Finished)',
      category: 'circumference',
      nominalCadCm: 33.5,
      measuredPhysicalCm: 33.4,
      toleranceCm: 0.40,
      deltaCm: -0.10,
      status: 'pass'
    },
    {
      pointId: 'sleeve-wrist-girth',
      label: 'Sleeve Wrist Opening Girth',
      category: 'circumference',
      nominalCadCm: 20.5,
      measuredPhysicalCm: 20.5,
      toleranceCm: 0.30,
      deltaCm: 0.00,
      status: 'pass'
    }
  ],
  observations: [
    {
      observationId: 'obs-01',
      location: 'sleeve-crown',
      defectType: 'puckering',
      severity: 'negligible',
      visualDescription: 'Cap ease (+3.26cm) shrank cleanly under wool iron pressing with damp cloth. No seam crimp.',
      causeAnalysis: 'Virgin wool crepe high molding factor (1.35) absorbed the full tailored cap ease.',
      recommendedCadCorrection: 'Preserve current tailored ease strategy (+2.8cm) for this wool fabric.'
    },
    {
      observationId: 'obs-02',
      location: 'bust-apex',
      defectType: 'apex-offset',
      severity: 'negligible',
      visualDescription: 'Vertical front waist dart apex aligns with apex drill hole 2.5cm below bust point.',
      causeAnalysis: 'Direct target regeneration preserved exact apex coordinates.',
      recommendedCadCorrection: 'Maintain 2.5cm backoff rule for waist dart apex.'
    }
  ],
  wearerFeedback: 'Comfortable shoulder movement and clean scye drape without binding at anterior armscye.',
  isProductionReady: false
};

/**
 * Non-conforming physical prototype record showing intentional tailoring variances
 * for test validation and diagnostics verification.
 */
export const MOCK_DISCREPANT_PROTOTYPE_BODICE_M: PhysicalPrototypeRecord = {
  id: 'PROTO-TEST-DISCREPANT-01',
  patternDraftId: 'draft-bodice-m-silk-test',
  sampleGarmentName: 'Test Bodice Prototype with Silk Puckering and Seam Discrepancy',
  garmentCategory: 'bodice',
  sizeCode: 'M',
  fabricId: 'silk-charmeuse',
  fabricName: 'Mulberry Silk Charmeuse (82 g/m²)',
  fabricLot: 'LOT-SILK-2026-X01',
  tailorName: 'Experimental Sample Room',
  dateSewn: '2026-11-03T10:00:00.000Z',
  measurements: [
    {
      pointId: 'front-side-seam',
      label: 'Front Bodice Side Seam Length',
      category: 'seam-length',
      nominalCadCm: 19.59,
      measuredPhysicalCm: 20.15, // Out of tolerance (+0.56cm)
      toleranceCm: 0.20,
      deltaCm: 0.56,
      status: 'fail'
    },
    {
      pointId: 'back-side-seam',
      label: 'Back Bodice Side Seam Length',
      category: 'seam-length',
      nominalCadCm: 19.59,
      measuredPhysicalCm: 19.55,
      toleranceCm: 0.20,
      deltaCm: -0.04,
      status: 'pass'
    },
    {
      pointId: 'waist-circumference',
      label: 'Finished Garment Waist Circumference',
      category: 'circumference',
      nominalCadCm: 75.0,
      measuredPhysicalCm: 73.8, // Under nominal (-1.20cm)
      toleranceCm: 0.35,
      deltaCm: -1.20,
      status: 'fail'
    }
  ],
  observations: [
    {
      observationId: 'obs-err-01',
      location: 'sleeve-crown',
      defectType: 'puckering',
      severity: 'critical',
      visualDescription: 'Severe seam puckering and ripples along sleeve crown line.',
      causeAnalysis: 'Silk charmeuse has low molding factor (0.70); cannot absorb +3.0cm cap ease without gathered tucks.',
      recommendedCadCorrection: 'Reduce sleeve cap ease strategy to fitted (+1.0cm) or flat (+0.4cm) for lightweight silk charmeuse.'
    }
  ],
  wearerFeedback: 'Waist feels excessively tight when seated; sleeve crown puckering creates visible ripples.',
  isProductionReady: false
};
