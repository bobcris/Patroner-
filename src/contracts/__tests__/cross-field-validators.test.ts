/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractCrossFieldValidationError,
  assertOffsetClassificationReportCrossFieldInvariants,
  assertOffsetValidationRecordCrossFieldInvariants,
  validateOffsetClassificationReportCrossFieldInvariants,
  validateOffsetValidationRecordCrossFieldInvariants,
} from '../../../packages/contracts/src/cross-field-validators.ts';

test('L-03 runtime validator accepts valid OffsetValidationRecord and exact epsilon boundary', () => {
  const exactBoundary = validateOffsetValidationRecordCrossFieldInvariants({
    verification_outcome: 'CERTIFIED_VALID',
    regularity_margin_epsilon: 0.25,
    min_base_speed_squared_interval: [4.2, 4.2],
    min_offset_speed_factor_interval: [0.25, 0.45],
  });
  assert.equal(exactBoundary.valid, true);
  assert.equal(exactBoundary.violations.length, 0);

  assert.doesNotThrow(() =>
    assertOffsetValidationRecordCrossFieldInvariants({
      verification_outcome: 'CERTIFIED_INVALID',
      regularity_margin_epsilon: 0.25,
      min_base_speed_squared_interval: [0.0, 1.0],
      min_offset_speed_factor_interval: [-0.2, 0.1],
    }),
  );
});

test('L-03 CF-01 rejects CERTIFIED_VALID when f_lo < dynamic regularity_margin_epsilon', () => {
  const res = validateOffsetValidationRecordCrossFieldInvariants({
    verification_outcome: 'CERTIFIED_VALID',
    regularity_margin_epsilon: 0.25,
    min_base_speed_squared_interval: [4.0, 5.0],
    min_offset_speed_factor_interval: [0.18, 0.3],
  });
  assert.equal(res.valid, false);
  assert.equal(res.violations[0]?.invariantId, 'CF-01-SPEED-FACTOR-LOWER-BELOW-DYNAMIC-EPSILON');
  assert.throws(
    () =>
      assertOffsetValidationRecordCrossFieldInvariants({
        verification_outcome: 'CERTIFIED_VALID',
        regularity_margin_epsilon: 0.25,
        min_base_speed_squared_interval: [4.0, 5.0],
        min_offset_speed_factor_interval: [0.18, 0.3],
      }),
    ContractCrossFieldValidationError,
  );
});

test('L-03 CF-02 rejects inverted min_base_speed_squared_interval (q_hi < q_lo)', () => {
  const res = validateOffsetValidationRecordCrossFieldInvariants({
    verification_outcome: 'CERTIFIED_VALID',
    regularity_margin_epsilon: 0.05,
    min_base_speed_squared_interval: [5.0, 2.0],
    min_offset_speed_factor_interval: [0.5, 0.8],
  });
  assert.equal(res.valid, false);
  assert.equal(res.violations[0]?.invariantId, 'CF-02-BASE-SPEED-SQUARED-INTERVAL-INVERTED');
});

test('L-03 CF-03 rejects inverted min_offset_speed_factor_interval (f_hi < f_lo)', () => {
  const res = validateOffsetValidationRecordCrossFieldInvariants({
    verification_outcome: 'CERTIFIED_VALID',
    regularity_margin_epsilon: 0.05,
    min_base_speed_squared_interval: [2.0, 5.0],
    min_offset_speed_factor_interval: [0.9, 0.5],
  });
  assert.equal(res.valid, false);
  assert.equal(res.violations[0]?.invariantId, 'CF-03-OFFSET-SPEED-FACTOR-INTERVAL-INVERTED');
});

test('L-03 CF-04 enforces gridErrorCm <= certifiedIntervalErrorCm on OffsetClassificationReport', () => {
  const ok = validateOffsetClassificationReportCrossFieldInvariants({
    gridErrorCm: 0.001,
    certifiedIntervalErrorCm: 0.001,
  });
  assert.equal(ok.valid, true);

  const bad = validateOffsetClassificationReportCrossFieldInvariants({
    gridErrorCm: 0.005,
    certifiedIntervalErrorCm: 0.001,
  });
  assert.equal(bad.valid, false);
  assert.equal(bad.violations[0]?.invariantId, 'CF-04-CLASSIFICATION-REPORT-GRID-EXCEEDS-CERTIFIED-ERROR');
  assert.throws(
    () =>
      assertOffsetClassificationReportCrossFieldInvariants({
        gridErrorCm: 0.005,
        certifiedIntervalErrorCm: 0.001,
      }),
    ContractCrossFieldValidationError,
  );
});

test('M-A3-02 handles null/non-object payloads, non-iterable intervals, and wrong-arity tuples without throwing TypeError', () => {
  for (const badPayload of [null, undefined, 42, 'bad', []]) {
    const recRes = validateOffsetValidationRecordCrossFieldInvariants(badPayload as any);
    assert.equal(recRes.valid, false);
    assert.ok(recRes.violations.length >= 1);

    const repRes = validateOffsetClassificationReportCrossFieldInvariants(badPayload as any);
    assert.equal(repRes.valid, false);
    assert.ok(repRes.violations.length >= 1);
  }

  for (const badInterval of [123, {}, null, undefined, [1.0], [1.0, 2.0, 3.0], [Number.NaN, 2.0], [1.0, Number.POSITIVE_INFINITY]]) {
    const resQ = validateOffsetValidationRecordCrossFieldInvariants({
      verification_outcome: 'CERTIFIED_VALID',
      regularity_margin_epsilon: 0.05,
      min_base_speed_squared_interval: badInterval as any,
      min_offset_speed_factor_interval: [0.5, 1.0],
    });
    assert.equal(resQ.valid, false);
    assert.ok(resQ.violations.some((v) => v.invariantId === 'CF-02-BASE-SPEED-SQUARED-INTERVAL-INVERTED'));

    const resF = validateOffsetValidationRecordCrossFieldInvariants({
      verification_outcome: 'CERTIFIED_VALID',
      regularity_margin_epsilon: 0.05,
      min_base_speed_squared_interval: [1.0, 2.0],
      min_offset_speed_factor_interval: badInterval as any,
    });
    assert.equal(resF.valid, false);
    assert.ok(resF.violations.some((v) => v.invariantId === 'CF-03-OFFSET-SPEED-FACTOR-INTERVAL-INVERTED'));
  }
});

test('M-A3-02 unconditionally rejects non-finite or negative regularity_margin_epsilon across all verification outcomes', () => {
  for (const outcome of ['CERTIFIED_VALID', 'CERTIFIED_INVALID', 'INCONCLUSIVE'] as const) {
    for (const badEps of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.01]) {
      const res = validateOffsetValidationRecordCrossFieldInvariants({
        verification_outcome: outcome,
        regularity_margin_epsilon: badEps,
        min_base_speed_squared_interval: [1.0, 2.0],
        min_offset_speed_factor_interval: [0.5, 1.0],
      });
      assert.equal(res.valid, false, `Expected invalid for outcome=${outcome}, eps=${badEps}`);
      assert.ok(res.violations.some((v) => v.invariantId === 'CF-01-SPEED-FACTOR-LOWER-BELOW-DYNAMIC-EPSILON'));
    }
  }

  // Parity with Python c1_cert_oracle AG-10b (CERTIFIED_INVALID [-Inf, 0]) and INCONCLUSIVE [-Inf, +Inf]
  assert.equal(
    validateOffsetValidationRecordCrossFieldInvariants({
      verification_outcome: 'CERTIFIED_INVALID',
      regularity_margin_epsilon: 0.05,
      min_base_speed_squared_interval: [0.0, 0.0],
      min_offset_speed_factor_interval: [Number.NEGATIVE_INFINITY, 0.0],
    }).valid,
    true,
  );
  assert.equal(
    validateOffsetValidationRecordCrossFieldInvariants({
      verification_outcome: 'INCONCLUSIVE',
      regularity_margin_epsilon: 0.05,
      min_base_speed_squared_interval: [0.0, 0.0],
      min_offset_speed_factor_interval: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
    }).valid,
    true,
  );
  for (const degenerate of [
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [Number.NaN, 0.0],
  ] as const) {
    assert.equal(
      validateOffsetValidationRecordCrossFieldInvariants({
        verification_outcome: 'CERTIFIED_INVALID',
        regularity_margin_epsilon: 0.05,
        min_base_speed_squared_interval: [0.0, 0.0],
        min_offset_speed_factor_interval: degenerate,
      }).valid,
      false,
    );
  }
});

