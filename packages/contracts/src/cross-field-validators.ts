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

function isTwoElementNumericTuple(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  );
}

function isValidSpeedFactorTuple(
  value: unknown,
  allowsExtendedReal: boolean,
): value is readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  const lo: unknown = value[0];
  const hi: unknown = value[1];
  if (typeof lo !== 'number' || typeof hi !== 'number' || Number.isNaN(lo) || Number.isNaN(hi)) {
    return false;
  }
  return allowsExtendedReal
    ? lo !== Number.POSITIVE_INFINITY && hi !== Number.NEGATIVE_INFINITY
    : Number.isFinite(lo) && Number.isFinite(hi);
}

/**
 * Validates the 3 cross-field numeric inequalities on `OffsetValidationRecord` that
 * exceed JSON Schema Draft 2020-12 native expressiveness:
 *   1. `min_base_speed_squared_interval` is a finite 2-tuple with `0 <= q_lo <= q_hi`
 *   2. `min_offset_speed_factor_interval` is a finite 2-tuple with `f_lo <= f_hi`
 *   3. `regularity_margin_epsilon` is a finite non-negative number, and when
 *      `verification_outcome === 'CERTIFIED_VALID'`,
 *      `min_offset_speed_factor_interval[0] >= regularity_margin_epsilon - 1e-15`
 */
export function validateOffsetValidationRecordCrossFieldInvariants(
  record: OffsetValidationRecordNumericFields,
): CrossFieldValidationResult {
  const violations: CrossFieldViolation[] = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    violations.push({
      invariantId: 'CF-02-BASE-SPEED-SQUARED-INTERVAL-INVERTED',
      entity: 'OffsetValidationRecord',
      message: 'OffsetValidationRecord payload must be a non-null object',
    });
    return { valid: false, violations };
  }

  const rawQ: unknown = (record as { min_base_speed_squared_interval?: unknown }).min_base_speed_squared_interval;
  const rawF: unknown = (record as { min_offset_speed_factor_interval?: unknown }).min_offset_speed_factor_interval;
  const eps: unknown = (record as { regularity_margin_epsilon?: unknown }).regularity_margin_epsilon;

  if (!isTwoElementNumericTuple(rawQ)) {
    violations.push({
      invariantId: 'CF-02-BASE-SPEED-SQUARED-INTERVAL-INVERTED',
      entity: 'OffsetValidationRecord',
      message: 'min_base_speed_squared_interval must be a 2-element tuple of finite numbers [q_lo, q_hi]',
    });
  } else {
    const [qLo, qHi] = rawQ;
    if (qLo < 0 || qHi < qLo) {
      violations.push({
        invariantId: 'CF-02-BASE-SPEED-SQUARED-INTERVAL-INVERTED',
        entity: 'OffsetValidationRecord',
        message: `min_base_speed_squared_interval [${qLo}, ${qHi}] must satisfy 0 <= q_lo <= q_hi`,
      });
    }
  }

  let fLo: number | null = null;
  const allowsExtendedRealSpeedFactor =
    record.verification_outcome === 'CERTIFIED_INVALID' || record.verification_outcome === 'INCONCLUSIVE';

  if (!isValidSpeedFactorTuple(rawF, allowsExtendedRealSpeedFactor)) {
    violations.push({
      invariantId: 'CF-03-OFFSET-SPEED-FACTOR-INTERVAL-INVERTED',
      entity: 'OffsetValidationRecord',
      message: allowsExtendedRealSpeedFactor
        ? 'min_offset_speed_factor_interval must be a 2-element numeric tuple [f_lo, f_hi] without NaN, +Infinity lower, or -Infinity upper'
        : 'min_offset_speed_factor_interval must be a 2-element tuple of finite numbers [f_lo, f_hi]',
    });
  } else {
    const [lo, hi] = rawF;
    fLo = lo;
    if (hi < lo) {
      violations.push({
        invariantId: 'CF-03-OFFSET-SPEED-FACTOR-INTERVAL-INVERTED',
        entity: 'OffsetValidationRecord',
        message: `min_offset_speed_factor_interval [${lo}, ${hi}] must satisfy f_lo <= f_hi`,
      });
    }
  }

  if (!isFiniteNumber(eps) || eps < 0) {
    violations.push({
      invariantId: 'CF-01-SPEED-FACTOR-LOWER-BELOW-DYNAMIC-EPSILON',
      entity: 'OffsetValidationRecord',
      message: `regularity_margin_epsilon (${String(eps)}) must be a finite non-negative number`,
    });
  } else if (record.verification_outcome === 'CERTIFIED_VALID') {
    if (fLo === null || fLo < eps - NUMERIC_INVARIANT_TOLERANCE) {
      violations.push({
        invariantId: 'CF-01-SPEED-FACTOR-LOWER-BELOW-DYNAMIC-EPSILON',
        entity: 'OffsetValidationRecord',
        message: `CERTIFIED_VALID record requires min_offset_speed_factor_interval[0] (${String(fLo)}) >= regularity_margin_epsilon (${eps})`,
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

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    violations.push({
      invariantId: 'CF-04-CLASSIFICATION-REPORT-GRID-EXCEEDS-CERTIFIED-ERROR',
      entity: 'OffsetClassificationReport',
      message: 'OffsetClassificationReport payload must be a non-null object',
    });
    return { valid: false, violations };
  }

  const gridErrorCm: unknown = (report as { gridErrorCm?: unknown }).gridErrorCm;
  const certifiedIntervalErrorCm: unknown = (report as { certifiedIntervalErrorCm?: unknown }).certifiedIntervalErrorCm;

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
      message: `gridErrorCm (${String(gridErrorCm)}) cannot exceed certifiedIntervalErrorCm (${String(certifiedIntervalErrorCm)})`,
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
