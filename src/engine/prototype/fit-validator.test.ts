import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validatePhysicalFit } from './fit-validator';
import {
  MOCK_CONFORMING_PROTOTYPE_BODICE_M,
  MOCK_DISCREPANT_PROTOTYPE_BODICE_M,
  SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
  SYNTHETIC_TEST_PROTOTYPE_DISCREPANT,
  SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE
} from './prototype-fixtures';
import { PhysicalPrototypeRecord } from './prototype-types';

describe('Milestone 04.5.1: Physical Prototype Fit Validation & Evidence Integrity', () => {
  it('1. verifies conforming synthetic prototype satisfies all tolerance gates and is clearly flagged as synthetic', () => {
    const report = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_CONFORMING);

    assert.equal(report.prototypeId, 'SYNTH-PROTO-BOD-M-CONFORMING');
    assert.equal(report.overallFitStatus, 'conforming');
    assert.equal(report.failCount, 0);
    assert.equal(report.warningCount, 0);
    assert.equal(report.invalidCount, 0);
    assert.equal(report.criticalDefectCount, 0);
    assert.equal(report.passCount, 10);
    assert.ok(report.maxAbsoluteDiscrepancyCm <= 0.15);
    assert.equal(report.isSyntheticEvidence, true, 'Must identify synthetic test benchmark');
    assert.equal(report.isProductionReady, false, 'isProductionReady must remain strictly false');
    assert.ok(report.summaryMessage.includes('conforms to CAD dimensions'));
  });

  it('2. detects out-of-tolerance discrepancies and critical defects in non-conforming prototype', () => {
    const report = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_DISCREPANT);

    assert.equal(report.prototypeId, 'SYNTH-PROTO-BOD-M-DISCREPANT');
    assert.equal(report.overallFitStatus, 'non-conforming');
    assert.ok(report.failCount >= 2);
    assert.ok(report.criticalDefectCount >= 1);
    assert.equal(report.isProductionReady, false);

    // Verify specific points flagged
    const sideSeamPoint = report.measurements.find(p => p.pointId === 'front-side-seam');
    assert.ok(sideSeamPoint);
    assert.equal(sideSeamPoint.status, 'fail');
    assert.equal(sideSeamPoint.deltaCm, 0.56);

    const waistPoint = report.measurements.find(p => p.pointId === 'waist-circumference');
    assert.ok(waistPoint);
    assert.equal(waistPoint.status, 'fail');
    assert.equal(waistPoint.deltaCm, -1.20);

    // Verify actionable CAD corrections generated
    assert.ok(report.actionableCadCorrections.length >= 2);
    assert.ok(report.actionableCadCorrections.some(c => c.includes('front-side-seam')));
    assert.ok(report.actionableCadCorrections.some(c => c.includes('Reduce sleeve cap ease')));
  });

  it('3. flags advisory warning for minor discrepancy within 1.5x tolerance', () => {
    const minorDiscrepant: PhysicalPrototypeRecord = {
      ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
      id: 'SYNTH-PROTO-TEST-MINOR-01',
      measurements: SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements.map(pt =>
        pt.pointId === 'sleeve-wrist-girth'
          ? {
              ...pt,
              nominalCadCm: 20.5,
              measuredPhysicalCm: 20.85, // delta = +0.35 cm, tolerance = 0.30 cm, 1.5x tol = 0.45 cm -> warning
              toleranceCm: 0.30,
              deltaCm: 0.35,
              status: 'warning'
            }
          : pt
      )
    };

    const report = validatePhysicalFit(minorDiscrepant);
    assert.equal(report.overallFitStatus, 'acceptable-with-adjustments');
    assert.equal(report.warningCount, 1);
    assert.equal(report.failCount, 0);
    assert.ok(report.actionableCadCorrections.some(c => c.includes('minor discrepancy')));
  });

  it('4. detects physical paired side seam mismatch using configurable tolerance policy', () => {
    const mismatchedSeams: PhysicalPrototypeRecord = {
      ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
      id: 'SYNTH-PROTO-TEST-SEAM-MISMATCH',
      measurements: SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements.map(pt => {
        if (pt.pointId === 'front-side-seam') {
          return { ...pt, measuredPhysicalCm: 19.80, deltaCm: 0.21, status: 'pass' };
        }
        if (pt.pointId === 'back-side-seam') {
          return { ...pt, measuredPhysicalCm: 19.40, deltaCm: -0.19, status: 'pass' };
        }
        return pt;
      })
    };

    // Default policy (0.30 cm limit): 19.80 - 19.40 = 0.40 cm diff -> fails paired check
    const report = validatePhysicalFit(mismatchedSeams, {
      sideSeamToleranceCm: 0.30,
      shoulderSeamToleranceCm: 0.25,
      inseamToleranceCm: 0.30
    });
    assert.ok(report.actionableCadCorrections.some(c => c.includes('Physical side seam mismatch')));
    assert.equal(report.overallFitStatus, 'non-conforming');
  });

  it('5. strictly returns incomplete status for empty measurement records', () => {
    const report = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE);
    assert.equal(report.overallFitStatus, 'incomplete');
    assert.equal(report.evaluatedPointsCount, 0);
    assert.ok(report.missingRequiredPoints.length > 0);
    assert.ok(report.summaryMessage.includes('no recorded physical measurements'));
    assert.equal(report.isProductionReady, false);
  });

  it('6. returns incomplete status when required bodice measurement checkpoints are missing', () => {
    // Missing bust and waist
    const partialRecord: PhysicalPrototypeRecord = {
      ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
      id: 'SYNTH-PROTO-PARTIAL',
      measurements: SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements.filter(
        pt => pt.pointId !== 'bust-circumference' && pt.pointId !== 'waist-circumference'
      )
    };

    const report = validatePhysicalFit(partialRecord);
    assert.equal(report.overallFitStatus, 'incomplete');
    assert.ok(report.missingRequiredPoints.includes('bust-circumference'));
    assert.ok(report.missingRequiredPoints.includes('waist-circumference'));
  });

  it('7. detects and rejects invalid negative, zero, or non-finite measurements and negative tolerances', () => {
    const invalidDataRecord: PhysicalPrototypeRecord = {
      ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
      id: 'SYNTH-PROTO-INVALID-DATA',
      measurements: [
        ...SYNTHETIC_TEST_PROTOTYPE_CONFORMING.measurements.slice(0, 4),
        {
          pointId: 'bust-circumference',
          label: 'Invalid Negative Bust',
          category: 'circumference',
          nominalCadCm: 95.5,
          measuredPhysicalCm: -95.0, // Invalid negative value
          toleranceCm: 0.40,
          deltaCm: 0,
          status: 'pass',
          sourceType: 'physically-measured'
        },
        {
          pointId: 'waist-circumference',
          label: 'Invalid NaN Waist',
          category: 'circumference',
          nominalCadCm: 75.0,
          measuredPhysicalCm: NaN, // Invalid NaN
          toleranceCm: 0.35,
          deltaCm: 0,
          status: 'pass',
          sourceType: 'physically-measured'
        },
        {
          pointId: 'front-side-seam',
          label: 'Negative Tolerance Seam',
          category: 'seam-length',
          nominalCadCm: 19.59,
          measuredPhysicalCm: 19.55,
          toleranceCm: -0.20, // Invalid negative tolerance
          deltaCm: 0,
          status: 'pass',
          sourceType: 'physically-measured'
        }
      ]
    };

    const report = validatePhysicalFit(invalidDataRecord);
    assert.equal(report.overallFitStatus, 'incomplete');
    assert.ok(report.invalidCount >= 2);
    assert.ok(report.measurements.some(m => m.status === 'invalid'));
  });

  it('8. strictly enforces isProductionReady = false invariant across all prototype reports', () => {
    const report1 = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_CONFORMING);
    assert.equal(report1.isProductionReady, false);

    const report2 = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_DISCREPANT);
    assert.equal(report2.isProductionReady, false);

    const report3 = validatePhysicalFit(SYNTHETIC_TEST_PROTOTYPE_INCOMPLETE);
    assert.equal(report3.isProductionReady, false);
  });
});

