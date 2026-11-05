/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validatePhysicalFit } from './fit-validator';
import {
  MOCK_CONFORMING_PROTOTYPE_BODICE_M,
  MOCK_DISCREPANT_PROTOTYPE_BODICE_M
} from './prototype-fixtures';
import { PhysicalPrototypeRecord } from './prototype-types';

describe('Milestone 04.5: Physical Prototype Fit Validation & Evidence Engine', () => {
  it('1. verifies conforming physical prototype satisfies all tolerance gates', () => {
    const report = validatePhysicalFit(MOCK_CONFORMING_PROTOTYPE_BODICE_M);

    assert.equal(report.prototypeId, 'PROTO-BOD-2026-M-01');
    assert.equal(report.overallFitStatus, 'conforming');
    assert.equal(report.failCount, 0);
    assert.equal(report.warningCount, 0);
    assert.equal(report.criticalDefectCount, 0);
    assert.equal(report.passCount, 10);
    assert.ok(report.maxAbsoluteDiscrepancyCm <= 0.15);
    assert.equal(report.isProductionReady, false);
    assert.ok(report.summaryMessage.includes('conforms to CAD dimensions'));
  });

  it('2. detects out-of-tolerance discrepancies and critical defects in non-conforming prototype', () => {
    const report = validatePhysicalFit(MOCK_DISCREPANT_PROTOTYPE_BODICE_M);

    assert.equal(report.prototypeId, 'PROTO-TEST-DISCREPANT-01');
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
      ...MOCK_CONFORMING_PROTOTYPE_BODICE_M,
      id: 'PROTO-TEST-MINOR-01',
      measurements: [
        {
          pointId: 'wrist-girth',
          label: 'Sleeve Wrist Girth',
          category: 'circumference',
          nominalCadCm: 20.5,
          measuredPhysicalCm: 20.85, // delta = +0.35 cm, tolerance = 0.30 cm, 1.5x tol = 0.45 cm -> warning
          toleranceCm: 0.30,
          deltaCm: 0.35,
          status: 'warning'
        }
      ],
      observations: []
    };

    const report = validatePhysicalFit(minorDiscrepant);
    assert.equal(report.overallFitStatus, 'acceptable-with-adjustments');
    assert.equal(report.warningCount, 1);
    assert.equal(report.failCount, 0);
    assert.ok(report.actionableCadCorrections.some(c => c.includes('minor discrepancy')));
  });

  it('4. detects physical paired side seam mismatch between front and back panels', () => {
    const mismatchedSeams: PhysicalPrototypeRecord = {
      ...MOCK_CONFORMING_PROTOTYPE_BODICE_M,
      id: 'PROTO-TEST-SEAM-MISMATCH',
      measurements: [
        {
          pointId: 'front-side-seam',
          label: 'Front Bodice Side Seam',
          category: 'seam-length',
          nominalCadCm: 19.59,
          measuredPhysicalCm: 19.80,
          toleranceCm: 0.25,
          deltaCm: 0.21,
          status: 'pass'
        },
        {
          pointId: 'back-side-seam',
          label: 'Back Bodice Side Seam',
          category: 'seam-length',
          nominalCadCm: 19.59,
          measuredPhysicalCm: 19.40, // 19.80 - 19.40 = 0.40 cm diff (> 0.30 cm physical paired mismatch limit)
          toleranceCm: 0.25,
          deltaCm: -0.19,
          status: 'pass'
        }
      ],
      observations: []
    };

    const report = validatePhysicalFit(mismatchedSeams);
    assert.ok(report.actionableCadCorrections.some(c => c.includes('Physical side seam mismatch')));
    assert.equal(report.overallFitStatus, 'non-conforming');
  });

  it('5. strictly enforces isProductionReady = false invariant across all prototype reports', () => {
    const report1 = validatePhysicalFit(MOCK_CONFORMING_PROTOTYPE_BODICE_M);
    assert.equal(report1.isProductionReady, false);

    const report2 = validatePhysicalFit(MOCK_DISCREPANT_PROTOTYPE_BODICE_M);
    assert.equal(report2.isProductionReady, false);
  });
});
