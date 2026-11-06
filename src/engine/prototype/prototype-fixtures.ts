import { PhysicalPrototypeRecord } from './prototype-types';

/**
 * Synthetic conforming prototype fixture designed for algorithmic validation testing.
 * NOTE (Milestone 04.5.1 Audit): This is a synthetic computational test fixture.
 * It is NOT empirical workshop evidence and must not be presented as a verified real garment.
 */
export const SYNTHETIC_TEST_PROTOTYPE_CONFORMING: PhysicalPrototypeRecord = {
  id: 'SYNTH-PROTO-BOD-M-CONFORMING',
  patternDraftId: 'draft-bodice-m-synthetic',
  patternDraftRevision: 'rev-2026.01-synth',
  sampleGarmentName: 'Synthetic Benchmark Bodice Sample (Conforming Fixture)',
  garmentCategory: 'bodice',
  sizeCode: 'M',
  fabricId: 'wool-crepe',
  fabricRevision: 'rev-illustrative.1',
  fabricName: 'Virgin Wool Crepe (Illustrative Reference)',
  fabricLot: 'SYNTH-LOT-TEST-01',
  constructionDetails: 'Synthetic standard 1.0cm seam allowance, simulated flat-pressed seams',
  measurementDate: '2026-11-06T00:00:00.000Z',
  measurementMethod: 'caliper',
  evaluatorIdentity: 'Automated Synthetic Benchmark Runner',
  isSyntheticTestFixture: true,
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
      sourceType: 'physically-measured',
      notes: 'Synthetic fixture test point (conforming within tolerance).'
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
      sourceType: 'physically-measured',
      notes: 'Synthetic fixture test point.'
    },
    {
      pointId: 'front-side-seam',
      label: 'Front Bodice Side Seam Length',
      category: 'seam-length',
      nominalCadCm: 19.59,
      measuredPhysicalCm: 19.55,
      toleranceCm: 0.20,
      deltaCm: -0.04,
      status: 'pass',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'back-side-seam',
      label: 'Back Bodice Side Seam Length',
      category: 'seam-length',
      nominalCadCm: 19.59,
      measuredPhysicalCm: 19.58,
      toleranceCm: 0.20,
      deltaCm: -0.01,
      status: 'pass',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'front-shoulder',
      label: 'Front Shoulder Seam Length',
      category: 'seam-length',
      nominalCadCm: 12.70,
      measuredPhysicalCm: 12.72,
      toleranceCm: 0.15,
      deltaCm: 0.02,
      status: 'pass',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'back-shoulder',
      label: 'Back Shoulder Seam Length',
      category: 'seam-length',
      nominalCadCm: 12.70,
      measuredPhysicalCm: 12.68,
      toleranceCm: 0.15,
      deltaCm: -0.02,
      status: 'pass',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'sleeve-inseam-front',
      label: 'Sleeve Front Underarm Inseam',
      category: 'seam-length',
      nominalCadCm: 49.55,
      measuredPhysicalCm: 49.50,
      toleranceCm: 0.25,
      deltaCm: -0.05,
      status: 'pass',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'sleeve-inseam-back',
      label: 'Sleeve Back Underarm Inseam',
      category: 'seam-length',
      nominalCadCm: 49.55,
      measuredPhysicalCm: 49.52,
      toleranceCm: 0.25,
      deltaCm: -0.03,
      status: 'pass',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'sleeve-biceps-girth',
      label: 'Sleeve Biceps Girth (Finished)',
      category: 'circumference',
      nominalCadCm: 33.5,
      measuredPhysicalCm: 33.4,
      toleranceCm: 0.40,
      deltaCm: -0.10,
      status: 'pass',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'sleeve-wrist-girth',
      label: 'Sleeve Wrist Opening Girth',
      category: 'circumference',
      nominalCadCm: 20.5,
      measuredPhysicalCm: 20.5,
      toleranceCm: 0.30,
      deltaCm: 0.00,
      status: 'pass',
      sourceType: 'physically-measured'
    }
  ],
  observations: [
    {
      observationId: 'synth-obs-01',
      location: 'sleeve-crown',
      defectType: 'puckering',
      severity: 'negligible',
      visualDescription: 'Synthetic benchmark: cap ease simulated without puckering.',
      causeAnalysis: 'Wool crepe benchmark modeling factor 1.35.',
      recommendedCadCorrection: 'Preserve tailored ease strategy for this reference.'
    },
    {
      observationId: 'synth-obs-02',
      location: 'bust-apex',
      defectType: 'apex-offset',
      severity: 'negligible',
      visualDescription: 'Synthetic benchmark: apex alignment verified.',
      causeAnalysis: 'Direct target regeneration preserved exact apex coordinates.',
      recommendedCadCorrection: 'Maintain 2.5cm backoff rule for waist dart apex.'
    }
  ],
  wearerFeedback: 'Synthetic test record: simulated wearer feedback for regression verification.',
  isProductionReady: false
};

/**
 * Synthetic discrepant prototype fixture designed for validation fault detection testing.
 * Contains intentional simulated discrepancies (waist contraction, side seam imbalance, critical puckering).
 */
export const SYNTHETIC_TEST_PROTOTYPE_DISCREPANT: PhysicalPrototypeRecord = {
  id: 'SYNTH-PROTO-BOD-M-DISCREPANT',
  patternDraftId: 'draft-bodice-m-synthetic-err',
  patternDraftRevision: 'rev-2026.01-synth',
  sampleGarmentName: 'Synthetic Benchmark Bodice Sample (Discrepant Fixture)',
  garmentCategory: 'bodice',
  sizeCode: 'M',
  fabricId: 'silk-charmeuse',
  fabricRevision: 'rev-illustrative.1',
  fabricName: 'Mulberry Silk Charmeuse (Illustrative Reference)',
  fabricLot: 'SYNTH-LOT-TEST-ERR',
  constructionDetails: 'Synthetic test sample with intentional assembly variance',
  measurementDate: '2026-11-06T00:00:00.000Z',
  measurementMethod: 'caliper',
  evaluatorIdentity: 'Automated Synthetic Benchmark Runner',
  isSyntheticTestFixture: true,
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
      sourceType: 'physically-measured'
    },
    {
      pointId: 'waist-circumference',
      label: 'Finished Garment Waist Circumference',
      category: 'circumference',
      nominalCadCm: 75.0,
      measuredPhysicalCm: 73.8, // Under nominal (-1.20cm) -> FAIL
      toleranceCm: 0.35,
      deltaCm: -1.20,
      status: 'fail',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'front-side-seam',
      label: 'Front Bodice Side Seam Length',
      category: 'seam-length',
      nominalCadCm: 19.59,
      measuredPhysicalCm: 20.15, // Intentional out-of-tolerance (+0.56cm) -> FAIL
      toleranceCm: 0.20,
      deltaCm: 0.56,
      status: 'fail',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'back-side-seam',
      label: 'Back Bodice Side Seam Length',
      category: 'seam-length',
      nominalCadCm: 19.59,
      measuredPhysicalCm: 19.55,
      toleranceCm: 0.20,
      deltaCm: -0.04,
      status: 'pass',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'front-shoulder',
      label: 'Front Shoulder Seam Length',
      category: 'seam-length',
      nominalCadCm: 12.70,
      measuredPhysicalCm: 12.72,
      toleranceCm: 0.15,
      deltaCm: 0.02,
      status: 'pass',
      sourceType: 'physically-measured'
    },
    {
      pointId: 'back-shoulder',
      label: 'Back Shoulder Seam Length',
      category: 'seam-length',
      nominalCadCm: 12.70,
      measuredPhysicalCm: 12.68,
      toleranceCm: 0.15,
      deltaCm: -0.02,
      status: 'pass',
      sourceType: 'physically-measured'
    }
  ],
  observations: [
    {
      observationId: 'synth-obs-err-01',
      location: 'sleeve-crown',
      defectType: 'puckering',
      severity: 'critical',
      visualDescription: 'Severe seam puckering along sleeve crown line.',
      causeAnalysis: 'Low moldability fabric unable to absorb cap ease.',
      recommendedCadCorrection: 'Reduce sleeve cap ease strategy to fitted or flat.'
    }
  ],
  wearerFeedback: 'Synthetic test record: simulated tightness and drag lines.',
  isProductionReady: false
};

/**
 * Synthetic incomplete prototype fixture with empty measurements to test status gating.
 */
export const SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE: PhysicalPrototypeRecord = {
  id: 'SYNTH-PROTO-BOD-M-INCOMPLETE',
  patternDraftId: 'draft-bodice-m-synthetic-inc',
  patternDraftRevision: 'rev-2026.01-synth',
  sampleGarmentName: 'Synthetic Incomplete Bodice Prototype (Empty Measurements)',
  garmentCategory: 'bodice',
  sizeCode: 'M',
  fabricId: 'wool-crepe',
  fabricName: 'Virgin Wool Crepe (Illustrative Reference)',
  measurementDate: '2026-11-06T00:00:00.000Z',
  measurementMethod: 'unspecified',
  evaluatorIdentity: 'Automated Synthetic Benchmark Runner',
  isSyntheticTestFixture: true,
  measurements: [],
  observations: [],
  isProductionReady: false
};

// Backward-compatible aliases for existing workspace and production references
export const MOCK_CONFORMING_PROTOTYPE_BODICE_M = SYNTHETIC_TEST_PROTOTYPE_CONFORMING;
export const MOCK_DISCREPANT_PROTOTYPE_BODICE_M = SYNTHETIC_TEST_PROTOTYPE_DISCREPANT;

