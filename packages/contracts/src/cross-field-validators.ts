/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime cross-field numeric inequality validators for Patroner M00.1 contracts (Finding L-03).
 *
 * JSON Schema Draft 2020-12 (`packages/contracts/schemas/canonical_contracts.schema.json`)
 * natively enforces all structural, type, enum, range, and 16 discrete conditional
 * certification-state invariants. However, Draft 2020-12 cannot natively compare two dynamic
 * numeric properties in the same instance.
 *
 * Non-Python consumers MUST run these runtime validators alongside JSON Schema validation
 * before treating any `OffsetValidationRecord` or `OffsetClassificationReport` payload as
 * contract-certified.
 */

export const NUMERIC_INVARIANT_TOLERANCE = 1e-15;

export type CrossFieldInvariantId =
  | 'CF-01-SPEED-FACTOR-LOWER-BELOW-DYNAMIC-EPSILON'
  | 'CF-02-BASE-SPEED-SQUARED-INTERVAL-INVERTED'
  | 'CF-03-OFFSET-SPEED-FACTOR-INTERVAL-INVERTED'
  | 'CF-04-CLASSIFICATION-REPORT-GRID-EXCEEDS-CERTIFIED-ERROR';

export interface CrossFieldViolation {
  invariantId: CrossFieldInvariantId;
  entity: 'OffsetValidationRecord' | 'OffsetClassificationReport';
  message: string;
}

export interface CrossFieldValidationResult {
  valid: boolean;
  violations: CrossFieldViolation[];
}

export interface OffsetValidationRecordNumericFields {
  verification_outcome: 'CERTIFIED_VALID' | 'CERTIFIED_INVALID' | 'INCONCLUSIVE' | string;
  regularity_margin_epsilon: number;
  min_base_speed_squared_interval: readonly [number, number];
  min_offset_speed_factor_interval: readonly [number, number];
}

export interface OffsetClassificationReportNumericFields {
  gridErrorCm: number;
  certifiedIntervalErrorCm: number;
}

export class ContractCrossFieldValidationError extends Error {
  public readonly violations: CrossFieldViolation[];

  constructor(entity: string, violations: CrossFieldViolation[]) {
    const summary = violations.map((v) => `[${v.invariantId}] ${v.message}`).join('; ');
    super(`${entity} failed runtime cross-field numeric invariant validation: ${summary}`);
    this.name = 'ContractCrossFieldValidationError';
    this.violations = violations;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates the 3 cross-field numeric inequalities on `OffsetValidationRecord` that
 * exceed JSON Schema Draft 2020-12 native expressiveness:
 *   1. `min_base_speed_squared_interval[1] >= min_base_speed_squared_interval[0]` (and `>= 0`)
 *   2. `min_offset_speed_factor_interval[1] >= min_offset_speed_factor_interval[0]`
 *   3. `verification_outcome === 'CERTIFIED_VALID'` =>
 *      `min_offset_speed_factor_interval[0] >= regularity_margin_epsilon - 1e-15`
 */
export function validateOffsetValidationRecordCrossFieldInvariants(
  record: OffsetValidationRecordNumericFields,
): CrossFieldValidationResult {
  const violations: CrossFieldViolation[] = [];

  const [qLo, qHi] = record.min_base_speed_squared_interval ?? [Number.NaN, Number.NaN];
  const [fLo, fHi] = record.min_offset_speed_factor_interval ?? [Number.NaN, Number.NaN];
  const eps = record.regularity_margin_epsilon;

  if (!isFiniteNumber(qLo) || !isFiniteNumber(qHi) || qLo < 0 || qHi < qLo) {
    violations.push({
      invariantId: 'CF-02-BASE-SPEED-SQUARED-INTERVAL-INVERTED',
      entity: 'OffsetValidationRecord',
      message: `min_base_speed_squared_interval [${qLo}, ${qHi}] must satisfy 0 <= q_lo <= q_hi`,
    });
  }

  if (!isFiniteNumber(fLo) || !isFiniteNumber(fHi) || fHi < fLo) {
    violations.push({
      invariantId: 'CF-03-OFFSET-SPEED-FACTOR-INTERVAL-INVERTED',
      entity: 'OffsetValidationRecord',
      message: `min_offset_speed_factor_interval [${fLo}, ${fHi}] must satisfy f_lo <= f_hi`,
    });
  }

  if (record.verification_outcome === 'CERTIFIED_VALID') {
    if (!isFiniteNumber(eps) || !isFiniteNumber(fLo) || fLo < eps - NUMERIC_INVARIANT_TOLERANCE) {
      violations.push({
        invariantId: 'CF-01-SPEED-FACTOR-LOWER-BELOW-DYNAMIC-EPSILON',
        entity: 'OffsetValidationRecord',
        message: `CERTIFIED_VALID record requires min_offset_speed_factor_interval[0] (${fLo}) >= regularity_margin_epsilon (${eps})`,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Validates the cross-field numeric inequality on `OffsetClassificationReport` that
 * exceeds JSON Schema Draft 2020-12 native expressiveness:
 *   4. `gridErrorCm <= certifiedIntervalErrorCm + 1e-15`
 */
export function validateOffsetClassificationReportCrossFieldInvariants(
  report: OffsetClassificationReportNumericFields,
): CrossFieldValidationResult {
  const violations: CrossFieldViolation[] = [];
  const { gridErrorCm, certifiedIntervalErrorCm } = report;

  if (
    !isFiniteNumber(gridErrorCm) ||
    !isFiniteNumber(certifiedIntervalErrorCm) ||
    gridErrorCm < 0 ||
    certifiedIntervalErrorCm < 0 ||
    gridErrorCm > certifiedIntervalErrorCm + NUMERIC_INVARIANT_TOLERANCE
  ) {
    violations.push({
      invariantId: 'CF-04-CLASSIFICATION-REPORT-GRID-EXCEEDS-CERTIFIED-ERROR',
      entity: 'OffsetClassificationReport',
      message: `gridErrorCm (${gridErrorCm}) cannot exceed certifiedIntervalErrorCm (${certifiedIntervalErrorCm})`,
    });
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

export function assertOffsetValidationRecordCrossFieldInvariants(
  record: OffsetValidationRecordNumericFields,
): void {
  const result = validateOffsetValidationRecordCrossFieldInvariants(record);
  if (!result.valid) {
    throw new ContractCrossFieldValidationError('OffsetValidationRecord', result.violations);
  }
}

export function assertOffsetClassificationReportCrossFieldInvariants(
  report: OffsetClassificationReportNumericFields,
): void {
  const result = validateOffsetClassificationReportCrossFieldInvariants(report);
  if (!result.valid) {
    throw new ContractCrossFieldValidationError('OffsetClassificationReport', result.violations);
  }
}
