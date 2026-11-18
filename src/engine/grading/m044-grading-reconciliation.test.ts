/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Milestone 04.4 — Cross-Size Grading & M04.3 Assembly Reconciliation Tests
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DesignSpecification } from '../../types';
import { EMPTY_JSON_OBJECT_SHA256 } from '../assembly/sha256';
import {
  DEFAULT_SIZE_RANGE,
  gradePattern,
  serializeDeterministicGradingReport,
  validateCrossSizeIntegrity
} from './index';

function createGradingSpec(overrides: Partial<DesignSpecification> = {}): DesignSpecification {
  return {
    id: 'spec-m044-reconcile',
    name: 'Tailored Grading Reconciliation Bodice',
    prompt: 'Tailored fitted bodice with set-in sleeve across XS-XXL',
    garmentCategory: 'bodice',
    silhouette: 'tailored',
    easeProfile: 'fitted',
    lengthCm: 55,
    color: { name: 'Navy', hex: '#1e3a8a' },
    fabric: {
      id: 'wool-suiting',
      name: 'Tailoring Wool Suiting',
      composition: '100% Virgin Wool',
      weight: 'medium',
      stretch: 'none',
      recommendedEaseCm: { waist: 2.5, hip: 3.5, bust: 3.5 },
      drapeDescription: 'Structured tailoring wool'
    },
    constructionFeatures: [],
    designNotes: [],
    isApproved: true,
    approvalState: 'approved',
    version: 1,
    ...overrides
  };
}

describe('Milestone 04.4 — M04.3 Assembly Reconciliation & Canonical Grading Digest', () => {
  test('Produces non-empty cross-run deterministic SHA-256 grading report matching Node crypto', () => {
    const spec = createGradingSpec();
    const g1 = gradePattern(spec, { bodiceDartStyle: 'waist', sleeveEaseStrategy: 'classic' });
    const g2 = gradePattern(spec, { bodiceDartStyle: 'waist', sleeveEaseStrategy: 'classic' });

    assert.equal(g1.isAllValid, true);
    assert.equal(g1.isProductionReady, false);
    assert.ok(g1.canonicalContentDigest);
    assert.notEqual(g1.canonicalContentDigest, EMPTY_JSON_OBJECT_SHA256);
    assert.equal(g1.canonicalContentDigest, g1.reportSha256Hex);
    assert.equal(g1.canonicalContentDigest, g2.canonicalContentDigest);
    assert.ok((g1.canonicalJsonByteLength ?? 0) > 2000);

    const serialized = serializeDeterministicGradingReport(g1);
    const nodeSha = createHash('sha256').update(serialized.canonicalJson, 'utf8').digest('hex');
    assert.equal(serialized.sha256Hex, nodeSha);
    assert.equal(serialized.sha256Hex, g1.canonicalContentDigest);
  });

  test('Propagates measurementProvenance, measurementApprovalState, and requireApprovedGovernance across all 6 sizes', () => {
    const spec = createGradingSpec();

    const blockedChart = gradePattern(spec, {
      measurementProvenance: 'standard-chart',
      measurementApprovalState: 'approved',
      requireApprovedGovernance: true
    });
    assert.equal(blockedChart.isAllValid, false);
    assert.equal(blockedChart.integrityReport.isOverallGradingValid, false);
    assert.equal(blockedChart.integrityReport.governanceStatus?.isAllGovernanceApproved, false);
    assert.ok(blockedChart.integrityReport.checks.some(c => c.id.startsWith('check-governance-') && c.status === 'fail'));

    const approvedMeasured = gradePattern(spec, {
      measurementProvenance: 'physically-measured',
      measurementApprovalState: 'approved',
      requireApprovedGovernance: true
    });
    assert.equal(approvedMeasured.isAllValid, true);
    assert.equal(approvedMeasured.isProductionReady, false);
    assert.equal(approvedMeasured.integrityReport.isOverallGradingValid, true);
    assert.equal(approvedMeasured.integrityReport.governanceStatus?.isAllGovernanceApproved, true);
  });

  test('Propagates bezierToleranceCm & strictUncertaintyGate failure across sizes cleanly', () => {
    const spec = createGradingSpec();
    const loose = gradePattern(spec, {
      bezierToleranceCm: 0.45,
      strictUncertaintyGate: true
    });
    assert.equal(loose.isAllValid, false);
    assert.ok(loose.integrityReport.checks.some(c => c.id.startsWith('check-uncertainty-gate-') && c.status === 'fail'));
  });

  test('validateCrossSizeIntegrity detects reversed pre-sort back double notches and elbow parity failures', () => {
    const spec = createGradingSpec();
    const baseline = gradePattern(spec);
    const mutated = JSON.parse(JSON.stringify(baseline.sizeResults));
    mutated.M.assemblyResult.notches.backNotches.preSortSleeveOrderValid = false;
    mutated.L.assemblyResult.notches.elbowPairParity.isParityValid = false;
    mutated.L.assemblyResult.notches.elbowPairParity.parityDeltaCm = 0.42;

    const report = validateCrossSizeIntegrity(mutated, DEFAULT_SIZE_RANGE, 'M');
    assert.equal(report.isOverallGradingValid, false);
    assert.ok(report.checks.some(c => c.id === 'check-back-notch-order-M' && c.status === 'fail'));
    assert.ok(report.checks.some(c => c.id === 'check-elbow-parity-L' && c.status === 'fail'));
  });
});
