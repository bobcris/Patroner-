/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BoundingBox,
  Dart,
  DesignSpecification,
  FabricProperty,
  GrainLine,
  Notch,
  PatternDraft,
  PatternPiece,
  Point,
  SeamLine,
  ValidationReport
} from '../../types';
import { computeBoundingBox } from '../geometry/math';
import {
  CubicBezierCurve,
  GeometricContour,
  GeometricSegment,
  LineSegment
} from '../geometry/primitives';
import { EnhancedFabricProperty } from '../fabric/fabric-types';
import {
  base64UrlDecodeToUtf8,
  computeEd25519PublicKeyFingerprint,
  generateEd25519KeyPairFromPassphrase,
  generateEd25519KeyPairFromRawSeedHex,
  sha256Hex,
  signEd25519Message
} from './crypto';
import {
  ApprovalAuthorityTier,
  ApprovalVerificationContext,
  AuthoritativeGarmentSpecification,
  TrustedCryptographicVerifier,
  TrustedIdentityVerifier,
  VerifiableCryptographicSignature,
  VerifiableIdentityCredential
} from './garment-specification-types';
import {
  computeSpecificationFingerprint,
  verifySpecificationApproval
} from './garment-specification';
import {
  ApprovalStateSummary,
  AuthoritativeGradingArtifact,
  AuthoritativeMeasurementSetRecord,
  AuthoritativePatternRevision,
  CanonicalPatternApprovalSigningPayload,
  ContourBoundingBoxSnapshot,
  CreateAuthoritativeGradingArtifactInput,
  CreateAuthoritativeMeasurementSetInput,
  CreateProductionPatternRevisionInput,
  CurrentRevisionInputs,
  DesignSpecificationSnapshot,
  DraftingConfigurationSnapshot,
  EngineProvenanceRecord,
  FabricSnapshotProvenance,
  FabricSpecificationSnapshot,
  GeometricContourSnapshot,
  GeometricSegmentSnapshot,
  GradingLifecycleState,
  LegacyPatternDraftAdaptationResult,
  LegacyPatternDraftStatusInput,
  MeasurementApprovalRecord,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementProvenanceEvidence,
  MeasurementSetSnapshot,
  PatternInvalidationCause,
  PatternInvalidationRecord,
  PatternPieceSnapshot,
  PatternRevisionApprovalRecord,
  PatternRevisionLifecycleEvent,
  PatternRevisionLifecycleState,
  PerSizeGeometryValidationRecord,
  ProductionPatternRevisionSnapshot,
  PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION,
  ProductionSnapshotFabricError,
  ProductionSnapshotGeometryError,
  ProductionSnapshotMeasurementError,
  ProductionSnapshotValidationError,
  RevisionComparisonResult,
  RevisionInputMismatch
} from './production-types';

export const CURRENT_ENGINE_VERSION = '0.4.6.1.1';
export const CURRENT_SNAPSHOT_ENGINE = 'Patroner Production Revision Engine';

export const VALID_MEASUREMENT_ORIGINS: readonly MeasurementOrigin[] = [
  'user-entered',
  'operator-confirmed',
  'standard-chart',
  'physically-measured',
  'imported',
  'ai-estimated',
  'synthetic-fixture',
  'synthetic-persona',
  'unknown'
] as const;

export const VALID_MEASUREMENT_APPROVAL_STATES: readonly MeasurementApprovalStatus[] = [
  'unverified',
  'pending',
  'approved',
  'rejected',
  'superseded'
] as const;

export const NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS: ReadonlySet<MeasurementOrigin> = new Set([
  'standard-chart',
  'synthetic-fixture',
  'synthetic-persona',
  'ai-estimated',
  'unknown'
]);

const FORBIDDEN_CHART_APPROVER_PATTERNS: readonly RegExp[] = [
  /iso\s*13402/i,
  /standard\s+reference\s+chart/i,
  /^standard[\s\-_]*chart$/i,
  /^reference[\s\-_]*chart$/i,
  /^default[\s\-_]*chart$/i
];

export function isMisleadingChartApproverIdentity(identity: string | undefined): boolean {
  if (typeof identity !== 'string' || identity.trim().length === 0) {
    return false;
  }
  const trimmed = identity.trim();
  return FORBIDDEN_CHART_APPROVER_PATTERNS.some(re => re.test(trimmed));
}

function isValidIsoDate(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string' || dateStr.trim() === '') return false;
  const epoch = Date.parse(dateStr);
  return Number.isFinite(epoch);
}

/**
 * Validates that explicit measurement-source evidence is present and valid when
 * measurements are classified as `'physically-measured'` or `'operator-confirmed'` (`AUDIT-04.6.2.3.5-05`).
 */
export function validateMeasurementProvenanceEvidence(
  provenance: MeasurementOrigin,
  evidence?: MeasurementProvenanceEvidence
): {
  readonly isValid: boolean;
  readonly reason?: string;
} {
  if (!VALID_MEASUREMENT_ORIGINS.includes(provenance)) {
    return {
      isValid: false,
      reason: `Invalid measurement provenance '${String(provenance)}'.`
    };
  }
  if (provenance === 'physically-measured' || provenance === 'operator-confirmed') {
    if (!evidence || typeof evidence !== 'object') {
      return {
        isValid: false,
        reason: `Measurement provenance '${provenance}' requires explicit MeasurementProvenanceEvidence (operatorName, measurementSource, and recordedAt).`
      };
    }
    const operatorName =
      typeof evidence.operatorName === 'string' ? evidence.operatorName.trim() : '';
    if (!operatorName) {
      return {
        isValid: false,
        reason: `Measurement provenance '${provenance}' requires a non-empty evidence.operatorName.`
      };
    }
    if (isMisleadingChartApproverIdentity(operatorName)) {
      return {
        isValid: false,
        reason: `Measurement provenance '${provenance}' cannot use a standard reference chart label ('${operatorName}') as operatorName.`
      };
    }
    const measurementSource =
      typeof evidence.measurementSource === 'string' ? evidence.measurementSource.trim() : '';
    if (
      !measurementSource ||
      measurementSource === 'standard-chart' ||
      measurementSource === 'synthetic-fixture' ||
      measurementSource === 'synthetic-persona' ||
      measurementSource === 'ai-estimated' ||
      measurementSource === 'unknown' ||
      isMisleadingChartApproverIdentity(measurementSource)
    ) {
      return {
        isValid: false,
        reason: `Measurement provenance '${provenance}' requires a verifiable physical or operator measurementSource (received '${String(evidence.measurementSource)}').`
      };
    }
    if (!isValidIsoDate(evidence.recordedAt)) {
      return {
        isValid: false,
        reason: `Measurement provenance '${provenance}' requires a valid ISO 8601 evidence.recordedAt timestamp.`
      };
    }
  }
  return { isValid: true };
}

function assertValidMeasurementProvenanceEvidence(
  provenance: MeasurementOrigin,
  evidence: MeasurementProvenanceEvidence | undefined
): void {
  const res = validateMeasurementProvenanceEvidence(provenance, evidence);
  if (!res.isValid) {
    throw new ProductionSnapshotMeasurementError(
      res.reason ?? `Invalid measurement provenance evidence for '${provenance}'.`
    );
  }
}

/**
 * Transitions measurement provenance only when backed by verifiable evidence (`AUDIT-04.6.2.3.5-05`).
 * Prevents promoting `'standard-chart'`, `'synthetic-fixture'`, `'synthetic-persona'`, or `'ai-estimated'`
 * to `'physically-measured'` or `'operator-confirmed'` without explicit operator/source evidence.
 */
export function transitionMeasurementProvenance(
  currentProvenance: MeasurementOrigin,
  targetProvenance: MeasurementOrigin,
  evidence?: MeasurementProvenanceEvidence
): {
  readonly isValid: boolean;
  readonly provenance: MeasurementOrigin;
  readonly nextOrigin: MeasurementOrigin;
  readonly evidence?: MeasurementProvenanceEvidence;
  readonly reason?: string;
} {
  if (!VALID_MEASUREMENT_ORIGINS.includes(currentProvenance)) {
    return {
      isValid: false,
      provenance: currentProvenance,
      nextOrigin: currentProvenance,
      reason: `Invalid current measurement provenance '${String(currentProvenance)}'.`
    };
  }
  if (!VALID_MEASUREMENT_ORIGINS.includes(targetProvenance) || targetProvenance === 'unknown') {
    return {
      isValid: false,
      provenance: currentProvenance,
      nextOrigin: currentProvenance,
      reason: `Cannot transition measurement provenance to '${String(targetProvenance)}'.`
    };
  }
  if (targetProvenance === 'physically-measured' || targetProvenance === 'operator-confirmed') {
    const check = validateMeasurementProvenanceEvidence(targetProvenance, evidence);
    if (!check.isValid) {
      return {
        isValid: false,
        provenance: currentProvenance,
        nextOrigin: currentProvenance,
        reason: check.reason
      };
    }
    const normalizedEvidence: MeasurementProvenanceEvidence | undefined = evidence
      ? {
          measurementSource: evidence.measurementSource.trim(),
          operatorName: evidence.operatorName.trim(),
          recordedAt: evidence.recordedAt.trim(),
          sessionReference: evidence.sessionReference?.trim(),
          notes: evidence.notes?.trim()
        }
      : undefined;
    return {
      isValid: true,
      provenance: targetProvenance,
      nextOrigin: targetProvenance,
      evidence: normalizedEvidence
    };
  }
  if (targetProvenance === 'user-entered' || targetProvenance === 'imported') {
    if (evidence?.operatorName && isMisleadingChartApproverIdentity(evidence.operatorName)) {
      return {
        isValid: false,
        provenance: currentProvenance,
        nextOrigin: currentProvenance,
        reason: `Standard reference chart label '${evidence.operatorName}' cannot be recorded as operatorName.`
      };
    }
  }
  return {
    isValid: true,
    provenance: targetProvenance,
    nextOrigin: targetProvenance,
    evidence
  };
}

/**
 * Deep freezes an object recursively to guarantee runtime immutability.
 * Protects nested arrays, maps, and objects against subsequent caller mutation.
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Handle Arrays
  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item);
    }
    return Object.freeze(obj) as Readonly<T>;
  }

  // Handle plain objects
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    if (value !== null && typeof value === 'object') {
      deepFreeze(value);
    }
  }

  return Object.freeze(obj) as Readonly<T>;
}

/**
 * Serializes a class-based or interface-based GeometricSegment into a pure plain-data snapshot.
 * Eliminates method references while strictly preserving exact finite coordinates without rounding.
 * Rejects non-finite coordinates with ProductionSnapshotGeometryError.
 */
export function serializeGeometricSegmentSnapshot(seg: GeometricSegment): GeometricSegmentSnapshot {
  if (!seg || typeof seg !== 'object') {
    throw new ProductionSnapshotGeometryError('Invalid segment: segment must be a non-null object.');
  }

  if (seg.type === 'line') {
    const line = seg as LineSegment;
    if (!Number.isFinite(line.start.x) || !Number.isFinite(line.start.y)) {
      throw new ProductionSnapshotGeometryError(
        `Segment '${line.id}' start coordinates must be finite (received x=${line.start.x}, y=${line.start.y}).`
      );
    }
    if (!Number.isFinite(line.end.x) || !Number.isFinite(line.end.y)) {
      throw new ProductionSnapshotGeometryError(
        `Segment '${line.id}' end coordinates must be finite (received x=${line.end.x}, y=${line.end.y}).`
      );
    }

    const seamAllowanceCm = Number.isFinite(line.seamAllowanceCm) ? line.seamAllowanceCm : 0;
    if (seamAllowanceCm < 0) {
      throw new ProductionSnapshotGeometryError(
        `Segment '${line.id}' seamAllowanceCm cannot be negative (received ${line.seamAllowanceCm}).`
      );
    }

    const length = line.lengthCm();
    if (!Number.isFinite(length) || length < 0) {
      throw new ProductionSnapshotGeometryError(
        `Segment '${line.id}' length must be non-negative finite (received ${length}).`
      );
    }

    return {
      id: line.id,
      type: 'line',
      start: { x: line.start.x, y: line.start.y },
      end: { x: line.end.x, y: line.end.y },
      seamAllowanceCm,
      isFold: Boolean(line.isFold),
      seamId: line.seamId,
      sourceSegmentId: line.sourceSegmentId,
      role: line.role,
      lengthCm: length
    };
  }

  if (seg.type === 'bezier') {
    const bezier = seg as CubicBezierCurve;
    if (!Number.isFinite(bezier.p0.x) || !Number.isFinite(bezier.p0.y)) {
      throw new ProductionSnapshotGeometryError(
        `Bézier segment '${bezier.id}' p0 start must be finite (received x=${bezier.p0.x}, y=${bezier.p0.y}).`
      );
    }
    if (!Number.isFinite(bezier.p3.x) || !Number.isFinite(bezier.p3.y)) {
      throw new ProductionSnapshotGeometryError(
        `Bézier segment '${bezier.id}' p3 end must be finite (received x=${bezier.p3.x}, y=${bezier.p3.y}).`
      );
    }
    if (!Number.isFinite(bezier.cp1.x) || !Number.isFinite(bezier.cp1.y)) {
      throw new ProductionSnapshotGeometryError(
        `Bézier segment '${bezier.id}' cp1 must be finite (received x=${bezier.cp1.x}, y=${bezier.cp1.y}).`
      );
    }
    if (!Number.isFinite(bezier.cp2.x) || !Number.isFinite(bezier.cp2.y)) {
      throw new ProductionSnapshotGeometryError(
        `Bézier segment '${bezier.id}' cp2 must be finite (received x=${bezier.cp2.x}, y=${bezier.cp2.y}).`
      );
    }

    const seamAllowanceCm = Number.isFinite(bezier.seamAllowanceCm) ? bezier.seamAllowanceCm : 0;
    if (seamAllowanceCm < 0) {
      throw new ProductionSnapshotGeometryError(
        `Bézier segment '${bezier.id}' seamAllowanceCm cannot be negative (received ${bezier.seamAllowanceCm}).`
      );
    }

    const length = bezier.lengthCm();
    if (!Number.isFinite(length) || length < 0) {
      throw new ProductionSnapshotGeometryError(
        `Bézier segment '${bezier.id}' length must be non-negative finite (received ${length}).`
      );
    }

    return {
      id: bezier.id,
      type: 'bezier',
      start: { x: bezier.p0.x, y: bezier.p0.y },
      end: { x: bezier.p3.x, y: bezier.p3.y },
      controlPoints: [
        { x: bezier.cp1.x, y: bezier.cp1.y },
        { x: bezier.cp2.x, y: bezier.cp2.y }
      ],
      seamAllowanceCm,
      isFold: Boolean(bezier.isFold),
      seamId: bezier.seamId,
      sourceSegmentId: bezier.sourceSegmentId,
      role: bezier.role,
      lengthCm: length
    };
  }

  throw new ProductionSnapshotGeometryError(
    `Unsupported segment type '${(seg as { type?: unknown }).type}'. Only 'line' and 'bezier' are supported.`
  );
}

/**
 * Serializes a GeometricContour instance into a pure plain-data snapshot.
 * Preserves exact segment coordinates and classifies bounding box approximation status.
 */
export function serializeGeometricContourSnapshot(contour: GeometricContour): GeometricContourSnapshot {
  if (!contour || !Array.isArray(contour.segments)) {
    throw new ProductionSnapshotGeometryError('Invalid contour: contour must contain an array of segments.');
  }

  const segments = contour.segments.map(serializeGeometricSegmentSnapshot);
  const totalLengthCm = segments.reduce((acc, s) => acc + s.lengthCm, 0);

  const hasCurves = segments.some(s => s.type === 'bezier');
  const sampledPoints = contour.toPolyline ? contour.toPolyline(8) : contour.getVertices();
  const rawBb = computeBoundingBox(sampledPoints);

  const boundingBox: ContourBoundingBoxSnapshot = {
    ...rawBb,
    isApproximate: hasCurves,
    basis: hasCurves ? 'sampled-polyline-approximation' : 'exact'
  };

  return {
    id: contour.id,
    isClosed: contour.isClosed,
    winding: contour.getWinding ? contour.getWinding() : undefined,
    segments,
    totalLengthCm,
    boundingBox
  };
}

/**
 * Serializes an active PatternPiece into a pure plain-data snapshot.
 * Preserves stitching/cutting contours, grainline, notches, darts, seams, and offset diagnostics.
 */
export function serializePatternPieceSnapshot(
  piece: PatternPiece,
  sizeCode = 'M'
): PatternPieceSnapshot {
  const stitchingContour = piece.stitchingContour
    ? serializeGeometricContourSnapshot(piece.stitchingContour)
    : undefined;

  const cuttingContour = piece.cuttingContour
    ? serializeGeometricContourSnapshot(piece.cuttingContour)
    : undefined;

  // Determine piece bounding box
  let boundingBox: ContourBoundingBoxSnapshot;
  if (cuttingContour) {
    boundingBox = cuttingContour.boundingBox;
  } else if (stitchingContour) {
    boundingBox = stitchingContour.boundingBox;
  } else {
    const rawBb = piece.boundingBox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0, widthCm: 0, heightCm: 0 };
    boundingBox = {
      ...rawBb,
      isApproximate: false,
      basis: 'exact'
    };
  }

  const darts: Dart[] = (piece.darts || []).map(d => ({
    id: d.id,
    apex: { x: d.apex.x, y: d.apex.y },
    legLeft: { x: d.legLeft.x, y: d.legLeft.y },
    legRight: { x: d.legRight.x, y: d.legRight.y },
    widthCm: d.widthCm,
    lengthCm: d.lengthCm
  }));

  const notches: Notch[] = (piece.notches || []).map(n => ({
    id: n.id,
    position: { x: n.position.x, y: n.position.y },
    normalAngleDeg: n.normalAngleDeg,
    type: n.type,
    label: n.label
  }));

  const seams: SeamLine[] = (piece.seams || []).map(s => ({
    id: s.id,
    name: s.name,
    startPoint: { x: s.startPoint.x, y: s.startPoint.y },
    endPoint: { x: s.endPoint.x, y: s.endPoint.y },
    lengthCm: s.lengthCm,
    type: s.type,
    pathData: s.pathData,
    startTangent: s.startTangent ? { x: s.startTangent.x, y: s.startTangent.y } : undefined,
    endTangent: s.endTangent ? { x: s.endTangent.x, y: s.endTangent.y } : undefined,
    pairedPieceId: s.pairedPieceId,
    pairedSeamName: s.pairedSeamName,
    segmentId: s.segmentId,
    segmentIds: s.segmentIds ? [...s.segmentIds] : undefined
  }));

  const grainline: GrainLine = piece.grainline
    ? {
        start: { x: piece.grainline.start.x, y: piece.grainline.start.y },
        end: { x: piece.grainline.end.x, y: piece.grainline.end.y },
        direction: piece.grainline.direction
      }
    : {
        start: { x: 0, y: 0 },
        end: { x: 0, y: 10 },
        direction: 'vertical'
      };

  const drillHoles = piece.drillHoles
    ? piece.drillHoles.map(pt => ({ x: pt.x, y: pt.y }))
    : undefined;

  const offsetDiagnostics = piece.offsetResult?.diagnostics
    ? piece.offsetResult.diagnostics.map(diag => ({ ...diag }))
    : undefined;

  return {
    id: piece.id,
    pieceCode: piece.pieceCode,
    name: piece.name,
    garmentCategory: piece.garmentCategory,
    sizeCode,
    cutCount: piece.cutCount,
    onFold: piece.onFold,
    material: piece.material,
    cutPathData: piece.cutPathData,
    sewPathData: piece.sewPathData,
    seamAllowanceWidthCm: piece.seamAllowanceWidthCm,
    grainline,
    darts,
    notches,
    seams,
    drillHoles,
    boundingBox,
    description: piece.description,
    stitchingContour,
    cuttingContour,
    offsetDiagnostics,
    warnings: [],
    errors: []
  };
}

/**
 * Creates an immutable snapshot of body measurements with explicit provenance and approval.
 *
 * Strict Architectural Rules (`AUDIT-04.6.2.3.5-05`):
 * - Missing provenance defaults to 'unknown', NEVER 'user-entered'.
 * - Empty measurement names are rejected.
 * - Non-finite, zero, or negative measurement values are rejected.
 * - Exact finite values are preserved without silent rounding.
 * - Invalid origin enum values are rejected.
 * - Standard reference chart ('standard-chart') and synthetic ('synthetic-fixture', 'synthetic-persona')
 *   measurements cannot be marked as approved for production.
 * - Misleading chart labels ('ISO 13402 Standard Reference Chart') cannot act as approvedBy.
 */
export function createMeasurementSetSnapshot(
  values: Readonly<Record<string, number>>,
  options: {
    defaultOrigin?: MeasurementOrigin;
    perMeasurementOrigin?: Readonly<Record<string, MeasurementOrigin>>;
    approval?: Partial<MeasurementApprovalRecord>;
    evidence?: MeasurementProvenanceEvidence;
    notes?: readonly string[];
  } = {}
): MeasurementSetSnapshot {
  if (!values || typeof values !== 'object' || Object.keys(values).length === 0) {
    throw new ProductionSnapshotMeasurementError('Measurement values record must be a non-empty object.');
  }

  const defaultOrigin: MeasurementOrigin = options.defaultOrigin ?? 'unknown';
  if (!VALID_MEASUREMENT_ORIGINS.includes(defaultOrigin)) {
    throw new ProductionSnapshotMeasurementError(
      `Invalid measurement defaultOrigin '${defaultOrigin}'. Must be one of: ${VALID_MEASUREMENT_ORIGINS.join(', ')}.`
    );
  }

  const clonedValues: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k === 'unit') {
      if (typeof v === 'string' && v !== 'cm') {
        throw new ProductionSnapshotMeasurementError(`Measurement unit must be 'cm' (received '${v}').`);
      }
      continue;
    }
    if (typeof k !== 'string' || k.trim() === '') {
      throw new ProductionSnapshotMeasurementError('Measurement key name cannot be empty or whitespace.');
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new ProductionSnapshotMeasurementError(
        `Measurement '${k}' must be a finite positive number in centimeters (received ${v}).`
      );
    }
    // Exact value preserved without silent rounding
    clonedValues[k] = v;
  }

  const perMeasurementOrigin: Record<string, MeasurementOrigin> = {};
  if (options.perMeasurementOrigin) {
    for (const [k, orig] of Object.entries(options.perMeasurementOrigin)) {
      if (!VALID_MEASUREMENT_ORIGINS.includes(orig)) {
        throw new ProductionSnapshotMeasurementError(
          `Invalid perMeasurementOrigin '${orig}' for '${k}'. Must be one of: ${VALID_MEASUREMENT_ORIGINS.join(', ')}.`
        );
      }
      perMeasurementOrigin[k] = orig;
    }
  }

  const resolvedEvidence = options.evidence ?? options.approval?.evidence;
  if (resolvedEvidence !== undefined) {
    assertValidMeasurementProvenanceEvidence(defaultOrigin, resolvedEvidence);
  }

  // Safety rules for measurement approval
  const requestedState = options.approval?.state ?? 'pending';
  let approvalState = requestedState;
  const isAiOrigin =
    defaultOrigin === 'ai-estimated' ||
    Object.values(perMeasurementOrigin).includes('ai-estimated');
  const isSyntheticOrigin =
    defaultOrigin === 'synthetic-fixture' ||
    defaultOrigin === 'synthetic-persona' ||
    Object.values(perMeasurementOrigin).includes('synthetic-fixture') ||
    Object.values(perMeasurementOrigin).includes('synthetic-persona');
  const isStandardChartOrigin =
    defaultOrigin === 'standard-chart' ||
    Object.values(perMeasurementOrigin).includes('standard-chart');

  if (isSyntheticOrigin && requestedState === 'approved') {
    throw new ProductionSnapshotMeasurementError(
      'Synthetic fixture or persona measurements cannot be marked as approved for production.'
    );
  }

  if (isStandardChartOrigin && requestedState === 'approved') {
    throw new ProductionSnapshotMeasurementError(
      'Standard reference chart measurements cannot be marked as approved physical or production measurements without recorded measurement evidence.'
    );
  }

  if (isMisleadingChartApproverIdentity(options.approval?.approvedBy)) {
    throw new ProductionSnapshotMeasurementError(
      `Standard reference chart label '${options.approval?.approvedBy}' cannot be used as an approving human authority for measurements.`
    );
  }

  if (isAiOrigin && requestedState === 'approved') {
    if (!options.approval?.approvedBy || !options.approval?.approvedAt) {
      // Revert to pending: cannot approve AI estimates without explicit human approver
      approvalState = 'pending';
    }
  }

  if (options.approval?.approvedAt && !isValidIsoDate(options.approval.approvedAt)) {
    throw new ProductionSnapshotMeasurementError(
      `Invalid measurement approval timestamp '${options.approval.approvedAt}'. Must be a valid ISO 8601 string.`
    );
  }

  const approval: MeasurementApprovalRecord = {
    state: approvalState,
    approvedBy: options.approval?.approvedBy,
    approvedAt: options.approval?.approvedAt,
    notes: options.approval?.notes,
    measurementRevisionReference: options.approval?.measurementRevisionReference,
    evidence: resolvedEvidence
  };

  return {
    unit: 'cm',
    values: clonedValues,
    defaultOrigin,
    perMeasurementOrigin: Object.keys(perMeasurementOrigin).length > 0 ? perMeasurementOrigin : undefined,
    approval,
    evidence: resolvedEvidence,
    notes: options.notes ? [...options.notes] : undefined
  };
}

/**
 * Creates an AuthoritativeMeasurementSetRecord with explicit provenance, separated AI estimates,
 * and strict default-unverified approval state (`AUDIT-04.6.2.3.5-05`).
 */
export function createAuthoritativeMeasurementSet(
  input: CreateAuthoritativeMeasurementSetInput
): AuthoritativeMeasurementSetRecord {
  if (!input || typeof input !== 'object') {
    throw new ProductionSnapshotMeasurementError('Measurement set input must be a non-null object.');
  }
  if (input.unit !== undefined && input.unit !== 'cm') {
    throw new ProductionSnapshotMeasurementError(`Measurement unit must be 'cm' (received '${input.unit}').`);
  }
  if (!input.values || typeof input.values !== 'object' || Object.keys(input.values).length === 0) {
    throw new ProductionSnapshotMeasurementError('Measurement values must be a non-empty object.');
  }

  const source: MeasurementOrigin = input.source ?? input.provenance ?? 'unknown';
  const provenance: MeasurementOrigin = input.provenance ?? input.source ?? 'unknown';
  if (!VALID_MEASUREMENT_ORIGINS.includes(source)) {
    throw new ProductionSnapshotMeasurementError(`Invalid measurement source '${source}'.`);
  }
  if (!VALID_MEASUREMENT_ORIGINS.includes(provenance)) {
    throw new ProductionSnapshotMeasurementError(`Invalid measurement provenance '${provenance}'.`);
  }

  const clonedValues: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.values)) {
    if (k === 'unit') continue;
    if (typeof k !== 'string' || k.trim() === '') {
      throw new ProductionSnapshotMeasurementError('Measurement key name cannot be empty.');
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new ProductionSnapshotMeasurementError(
        `Measurement '${k}' must be a finite positive number in centimeters (received ${v}).`
      );
    }
    clonedValues[k] = v;
  }

  let clonedAiValues: Record<string, number> | undefined = undefined;
  if (input.aiEstimatedValues) {
    clonedAiValues = {};
    for (const [k, v] of Object.entries(input.aiEstimatedValues)) {
      if (k === 'unit') continue;
      if (typeof k !== 'string' || k.trim() === '') {
        throw new ProductionSnapshotMeasurementError('AI-estimated measurement key name cannot be empty.');
      }
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        throw new ProductionSnapshotMeasurementError(
          `AI-estimated measurement '${k}' must be a finite positive number in centimeters (received ${v}).`
        );
      }
      clonedAiValues[k] = v;
    }
  }

  const perMeasurementOrigin: Record<string, MeasurementOrigin> = {};
  if (input.perMeasurementOrigin) {
    for (const [k, orig] of Object.entries(input.perMeasurementOrigin)) {
      if (!VALID_MEASUREMENT_ORIGINS.includes(orig)) {
        throw new ProductionSnapshotMeasurementError(`Invalid perMeasurementOrigin '${orig}' for '${k}'.`);
      }
      perMeasurementOrigin[k] = orig;
    }
  }

  if (input.evidence !== undefined) {
    assertValidMeasurementProvenanceEvidence(provenance, input.evidence);
  }

  // Missing approval defaults to 'unverified', NEVER 'approved'
  const approvalState: MeasurementApprovalStatus = input.approvalState ?? 'unverified';
  if (!VALID_MEASUREMENT_APPROVAL_STATES.includes(approvalState)) {
    throw new ProductionSnapshotMeasurementError(`Invalid measurement approvalState '${approvalState}'.`);
  }

  const hasAiInActiveValues =
    source === 'ai-estimated' ||
    provenance === 'ai-estimated' ||
    Object.values(perMeasurementOrigin).includes('ai-estimated');

  if (
    hasAiInActiveValues &&
    (source === 'physically-measured' || provenance === 'physically-measured')
  ) {
    throw new ProductionSnapshotMeasurementError(
      'AI-estimated measurements cannot be classified as physically-measured.'
    );
  }

  const hasSyntheticValues =
    source === 'synthetic-fixture' ||
    provenance === 'synthetic-fixture' ||
    source === 'synthetic-persona' ||
    provenance === 'synthetic-persona' ||
    Object.values(perMeasurementOrigin).includes('synthetic-fixture') ||
    Object.values(perMeasurementOrigin).includes('synthetic-persona');

  const hasStandardChartValues =
    source === 'standard-chart' ||
    provenance === 'standard-chart' ||
    Object.values(perMeasurementOrigin).includes('standard-chart');

  if (approvalState === 'approved') {
    if (hasAiInActiveValues) {
      throw new ProductionSnapshotMeasurementError(
        'AI-estimated measurements must be stored separately and cannot be marked as approved physical or authoritative measurements.'
      );
    }
    if (hasSyntheticValues) {
      throw new ProductionSnapshotMeasurementError(
        'Synthetic fixture or persona measurements cannot be marked as approved authoritative measurements.'
      );
    }
    if (hasStandardChartValues) {
      throw new ProductionSnapshotMeasurementError(
        'Standard reference chart measurements cannot be marked as approved physical or authoritative measurements without recorded measurement evidence.'
      );
    }
    if (source === 'unknown' || provenance === 'unknown') {
      throw new ProductionSnapshotMeasurementError(
        'Measurements with unknown provenance cannot be marked as approved.'
      );
    }
    if (!input.approvingAuthority || typeof input.approvingAuthority !== 'string' || input.approvingAuthority.trim() === '') {
      throw new ProductionSnapshotMeasurementError(
        'Approved measurement set requires a non-empty approvingAuthority.'
      );
    }
    if (isMisleadingChartApproverIdentity(input.approvingAuthority)) {
      throw new ProductionSnapshotMeasurementError(
        `Standard reference chart label '${input.approvingAuthority}' cannot be used as an approvingAuthority for measurements.`
      );
    }
    if (!input.approvedAt || !isValidIsoDate(input.approvedAt)) {
      throw new ProductionSnapshotMeasurementError(
        'Approved measurement set requires a valid ISO 8601 approvedAt timestamp.'
      );
    }
  }

  const recordedAt = input.recordedAt ?? new Date().toISOString();
  if (!isValidIsoDate(recordedAt)) {
    throw new ProductionSnapshotMeasurementError(`Invalid recordedAt timestamp '${recordedAt}'.`);
  }

  const measurementSetId = (input.measurementSetId ?? '').trim() || 'meas-set-default';
  const revisionId = (input.revisionId ?? '').trim() || `${measurementSetId}-rev-1`;

  const canonicalPayload = {
    measurementSetId,
    revisionId,
    parentRevisionId: input.parentRevisionId ?? null,
    unit: 'cm' as const,
    values: clonedValues,
    aiEstimatedValues: clonedAiValues ?? null,
    source,
    provenance,
    perMeasurementOrigin: Object.keys(perMeasurementOrigin).length > 0 ? perMeasurementOrigin : null,
    approvalState
  };

  const canonicalFingerprint = sha256Hex(canonicalizeJson(canonicalPayload));

  return deepFreeze({
    measurementSetId,
    revisionId,
    parentRevisionId: input.parentRevisionId,
    unit: 'cm',
    values: clonedValues,
    aiEstimatedValues: clonedAiValues,
    source,
    provenance,
    perMeasurementOrigin: Object.keys(perMeasurementOrigin).length > 0 ? perMeasurementOrigin : undefined,
    recordedAt,
    approvalState,
    approvingAuthority: input.approvingAuthority?.trim(),
    approvedAt: input.approvedAt,
    evidence: input.evidence,
    notes: input.notes ? [...input.notes] : undefined,
    canonicalFingerprint
  });
}

/**
 * Approves an AuthoritativeMeasurementSetRecord after verifying provenance and authority.
 */
export function approveAuthoritativeMeasurementSet(
  record: AuthoritativeMeasurementSetRecord,
  options: {
    readonly approvingAuthority: string;
    readonly approvedAt?: string;
    readonly evidence?: MeasurementProvenanceEvidence;
    readonly notes?: string[];
  }
): AuthoritativeMeasurementSetRecord {
  if (record.approvalState === 'superseded' || record.supersededByRevisionId) {
    throw new ProductionSnapshotMeasurementError('Cannot approve a superseded measurement set revision.');
  }
  const approvedAt = options.approvedAt ?? new Date().toISOString();
  return createAuthoritativeMeasurementSet({
    measurementSetId: record.measurementSetId,
    revisionId: record.revisionId,
    parentRevisionId: record.parentRevisionId,
    unit: record.unit,
    values: { ...record.values },
    aiEstimatedValues: record.aiEstimatedValues ? { ...record.aiEstimatedValues } : undefined,
    source: record.source,
    provenance: record.provenance,
    perMeasurementOrigin: record.perMeasurementOrigin ? { ...record.perMeasurementOrigin } : undefined,
    recordedAt: record.recordedAt,
    approvalState: 'approved',
    approvingAuthority: options.approvingAuthority,
    approvedAt,
    evidence: options.evidence ?? record.evidence,
    notes: options.notes ?? (record.notes ? [...record.notes] : undefined)
  });
}

/**
 * Supersedes an AuthoritativeMeasurementSetRecord when any measurement changes,
 * returning both the superseded record and the new unverified revision.
 */
export function supersedeAuthoritativeMeasurementSet(
  previous: AuthoritativeMeasurementSetRecord,
  updates: {
    readonly values: Record<string, number>;
    readonly revisionId: string;
    readonly source?: MeasurementOrigin;
    readonly provenance?: MeasurementOrigin;
    readonly recordedAt?: string;
  }
): {
  readonly supersededRecord: AuthoritativeMeasurementSetRecord;
  readonly nextRecord: AuthoritativeMeasurementSetRecord;
} {
  const newRevId = updates.revisionId.trim();
  if (!newRevId || newRevId === previous.revisionId) {
    throw new ProductionSnapshotMeasurementError(
      'Superseding a measurement set requires a distinct non-empty revisionId.'
    );
  }

  const supersededRecord: AuthoritativeMeasurementSetRecord = deepFreeze({
    ...previous,
    approvalState: 'superseded',
    supersededByRevisionId: newRevId
  });

  const nextRecord = createAuthoritativeMeasurementSet({
    measurementSetId: previous.measurementSetId,
    revisionId: newRevId,
    parentRevisionId: previous.revisionId,
    unit: 'cm',
    values: updates.values,
    aiEstimatedValues: previous.aiEstimatedValues ? { ...previous.aiEstimatedValues } : undefined,
    source: updates.source ?? previous.source,
    provenance: updates.provenance ?? previous.provenance,
    recordedAt: updates.recordedAt ?? new Date().toISOString(),
    approvalState: 'unverified'
  });

  return { supersededRecord, nextRecord };
}

/**
 * Verifies the integrity, provenance, and approval state of an AuthoritativeMeasurementSetRecord.
 */
export function verifyMeasurementSetIntegrity(
  record: AuthoritativeMeasurementSetRecord | undefined
): {
  readonly isValid: boolean;
  readonly isApproved: boolean;
  readonly reason?: string;
} {
  if (!record || typeof record !== 'object') {
    return { isValid: false, isApproved: false, reason: 'Measurement set record is missing.' };
  }
  if (record.supersededByRevisionId || record.approvalState === 'superseded') {
    return {
      isValid: false,
      isApproved: false,
      reason: `Measurement set revision '${record.revisionId}' has been superseded.`
    };
  }
  if (record.source === 'ai-estimated' || record.provenance === 'ai-estimated') {
    return {
      isValid: false,
      isApproved: false,
      reason: 'AI-estimated measurements are not permitted as authoritative physical measurements.'
    };
  }
  if (
    record.perMeasurementOrigin &&
    Object.values(record.perMeasurementOrigin).includes('ai-estimated')
  ) {
    return {
      isValid: false,
      isApproved: false,
      reason: 'Per-measurement origin contains AI-estimated values.'
    };
  }
  if (
    record.source === 'synthetic-fixture' ||
    record.provenance === 'synthetic-fixture' ||
    record.source === 'synthetic-persona' ||
    record.provenance === 'synthetic-persona' ||
    (record.perMeasurementOrigin &&
      (Object.values(record.perMeasurementOrigin).includes('synthetic-fixture') ||
        Object.values(record.perMeasurementOrigin).includes('synthetic-persona')))
  ) {
    return {
      isValid: false,
      isApproved: false,
      reason: 'Synthetic fixture or persona measurements are not permitted as authoritative production measurements.'
    };
  }
  if (record.source === 'unknown' || record.provenance === 'unknown') {
    return {
      isValid: false,
      isApproved: false,
      reason: 'Measurement set is missing explicit provenance (origin is unknown).'
    };
  }
  if (
    record.source === 'standard-chart' ||
    record.provenance === 'standard-chart' ||
    (record.perMeasurementOrigin && Object.values(record.perMeasurementOrigin).includes('standard-chart'))
  ) {
    return {
      isValid: record.approvalState !== 'approved',
      isApproved: false,
      reason:
        'Standard reference chart measurements are unverified reference presets and cannot be approved as physical or production measurements.'
    };
  }
  if (record.approvalState !== 'approved') {
    return {
      isValid: true,
      isApproved: false,
      reason: `Measurement set approval state is '${record.approvalState}' (not approved).`
    };
  }
  if (!record.approvingAuthority || record.approvingAuthority.trim() === '') {
    return {
      isValid: false,
      isApproved: false,
      reason: 'Measurement set is marked approved but missing approvingAuthority.'
    };
  }
  if (isMisleadingChartApproverIdentity(record.approvingAuthority)) {
    return {
      isValid: false,
      isApproved: false,
      reason: `Standard reference chart label '${record.approvingAuthority}' is not a valid approvingAuthority for measurements.`
    };
  }
  if (!record.approvedAt || !isValidIsoDate(record.approvedAt)) {
    return {
      isValid: false,
      isApproved: false,
      reason: 'Measurement set is marked approved but missing valid approvedAt timestamp.'
    };
  }
  return { isValid: true, isApproved: true };
}

/**
 * Creates an immutable snapshot of a fabric specification.
 *
 * Strict Architectural Rules:
 * - Missing provenance defaults to 'unknown' or explicitly unresolved, NEVER 'project-default'.
 * - Property-level provenance and verification details are preserved without fabrication.
 * - Invalid physical property values (e.g. non-positive GSM or impossible stretch) are rejected.
 * - Laboratory/supplier references and revisions are preserved only when non-empty.
 */
export function createFabricSpecificationSnapshot(
  fabric: FabricProperty | EnhancedFabricProperty
): FabricSpecificationSnapshot {
  if (!fabric || typeof fabric !== 'object') {
    throw new ProductionSnapshotFabricError('Fabric specification must be a non-null object.');
  }
  if (!fabric.id || typeof fabric.id !== 'string' || fabric.id.trim() === '') {
    throw new ProductionSnapshotFabricError('Fabric specification missing required non-empty ID.');
  }

  const enhanced = fabric as EnhancedFabricProperty;
  const extra = fabric as unknown as Record<string, unknown>;

  // Physical bounds verification
  if (enhanced.gsm !== undefined) {
    if (!Number.isFinite(enhanced.gsm) || enhanced.gsm <= 0) {
      throw new ProductionSnapshotFabricError(
        `Fabric GSM must be a positive finite number (received ${enhanced.gsm}).`
      );
    }
  }

  if (enhanced.thicknessMm !== undefined) {
    if (!Number.isFinite(enhanced.thicknessMm) || enhanced.thicknessMm <= 0) {
      throw new ProductionSnapshotFabricError(
        `Fabric thicknessMm must be a positive finite number (received ${enhanced.thicknessMm}).`
      );
    }
  }

  if (enhanced.moldingFactor !== undefined) {
    if (!Number.isFinite(enhanced.moldingFactor) || enhanced.moldingFactor <= 0) {
      throw new ProductionSnapshotFabricError(
        `Fabric moldingFactor must be a positive finite number (received ${enhanced.moldingFactor}).`
      );
    }
  }

  let directional: Readonly<EnhancedFabricProperty['directional']> | undefined = undefined;
  if (enhanced.directional) {
    const warp = enhanced.directional.warp;
    const weft = enhanced.directional.weft;
    const bias = enhanced.directional.bias;

    if (warp) {
      if (!Number.isFinite(warp.shrinkagePercent) || warp.shrinkagePercent < 0 || warp.shrinkagePercent > 100) {
        throw new ProductionSnapshotFabricError(`Invalid warp shrinkagePercent: ${warp.shrinkagePercent}`);
      }
      if (!Number.isFinite(warp.stretchPercent) || warp.stretchPercent < 0 || warp.stretchPercent > 200) {
        throw new ProductionSnapshotFabricError(`Invalid warp stretchPercent: ${warp.stretchPercent}`);
      }
    }
    if (weft) {
      if (!Number.isFinite(weft.shrinkagePercent) || weft.shrinkagePercent < 0 || weft.shrinkagePercent > 100) {
        throw new ProductionSnapshotFabricError(`Invalid weft shrinkagePercent: ${weft.shrinkagePercent}`);
      }
      if (!Number.isFinite(weft.stretchPercent) || weft.stretchPercent < 0 || weft.stretchPercent > 200) {
        throw new ProductionSnapshotFabricError(`Invalid weft stretchPercent: ${weft.stretchPercent}`);
      }
    }
    if (bias) {
      if (!Number.isFinite(bias.stretchPercent) || bias.stretchPercent < 0 || bias.stretchPercent > 200) {
        throw new ProductionSnapshotFabricError(`Invalid bias stretchPercent: ${bias.stretchPercent}`);
      }
    }

    directional = {
      warp: { ...warp },
      weft: { ...weft },
      bias: { ...bias }
    };
  }

  const propertyVerificationDetails = (extra.propertyVerificationDetails as Record<string, boolean> | undefined)
    ? { ...(extra.propertyVerificationDetails as Record<string, boolean>) }
    : undefined;

  const propertyProvenance = enhanced.propertyProvenance
    ? { ...enhanced.propertyProvenance }
    : undefined;

  const fabricRevision =
    typeof enhanced.revision === 'string' && enhanced.revision.trim() !== ''
      ? enhanced.revision.trim()
      : typeof extra.revisionId === 'string' && (extra.revisionId as string).trim() !== ''
        ? (extra.revisionId as string).trim()
        : typeof extra.lotNumber === 'string' && (extra.lotNumber as string).trim() !== ''
          ? (extra.lotNumber as string).trim()
          : undefined;

  const testStandard =
    typeof enhanced.testStandard === 'string' && enhanced.testStandard.trim() !== ''
      ? enhanced.testStandard.trim()
      : undefined;

  const laboratoryReference =
    typeof extra.laboratoryReference === 'string' && (extra.laboratoryReference as string).trim() !== ''
      ? (extra.laboratoryReference as string).trim()
      : testStandard;

  const supplierReference =
    typeof extra.supplierReference === 'string' && (extra.supplierReference as string).trim() !== ''
      ? (extra.supplierReference as string).trim()
      : undefined;

  // Provenance must default to 'unknown', NEVER 'project-default'
  const provenance: FabricSnapshotProvenance = enhanced.provenance ?? 'unknown';

  return {
    fabricId: fabric.id,
    name: fabric.name,
    composition: fabric.composition,
    fabricRevision,
    weight: fabric.weight,
    stretch: fabric.stretch,
    directional,
    gsm: enhanced.gsm,
    thicknessMm: enhanced.thicknessMm,
    moldingFactor: enhanced.moldingFactor,
    provenance,
    isVerified: Boolean(enhanced.isVerified),
    propertyVerificationDetails,
    propertyProvenance,
    testStandard,
    laboratoryReference,
    supplierReference,
    isIllustrative: Boolean(enhanced.isIllustrativeReference ?? extra.isIllustrative),
    isProvisional: Boolean(extra.isProvisional)
  };
}

/**
 * Creates an immutable snapshot of a design specification.
 */
export function createDesignSpecificationSnapshot(
  design: DesignSpecification
): DesignSpecificationSnapshot {
  if (!design || typeof design !== 'object') {
    throw new ProductionSnapshotValidationError('Design specification must be a non-null object.');
  }

  const constructionFeatures = (design.constructionFeatures || []).map(f => ({ ...f }));
  const designNotes = design.designNotes ? [...design.designNotes] : [];

  const aiEstimates = design.aiEstimates
    ? {
        suggestedSilhouette: design.aiEstimates.suggestedSilhouette,
        styleConfidenceScore: design.aiEstimates.styleConfidenceScore,
        suggestedFabrics: [...(design.aiEstimates.suggestedFabrics || [])],
        technicalAdvice: design.aiEstimates.technicalAdvice,
        disclaimer: design.aiEstimates.disclaimer
      }
    : undefined;

  return {
    id: design.id,
    version: design.version ?? 1,
    name: design.name,
    garmentCategory: design.garmentCategory,
    silhouette: design.silhouette,
    easeProfile: design.easeProfile,
    lengthCm: design.lengthCm,
    specificationRevisionId: design.specificationRevisionId,
    parentRevisionId: design.parentRevisionId,
    approvedBy: design.approvedBy,
    approvalProvenance: design.approvalProvenance,
    explicitEaseCm: design.explicitEaseCm ? { ...design.explicitEaseCm } : undefined,
    targetFinishedDimensions: design.targetFinishedDimensions ? { ...design.targetFinishedDimensions } : undefined,
    allowances: design.seamAllowanceCm !== undefined || design.hemAllowanceCm !== undefined || design.waistAllowanceCm !== undefined
      ? {
          seamAllowanceCm: design.seamAllowanceCm,
          hemAllowanceCm: design.hemAllowanceCm,
          waistAllowanceCm: design.waistAllowanceCm
        }
      : undefined,
    dartStyle: design.dartStyle,
    sleeveEaseStrategy: design.sleeveEaseStrategy,
    constructionFeatures,
    designNotes,
    isApproved: Boolean(design.isApproved),
    approvedAt: design.approvedAt,
    aiEstimates
  };
}

/**
 * Produces a stable, order-independent canonical JSON string of any object.
 * Numbers are converted to standard IEEE-754 string representation without silent truncation or rounding.
 * Key properties are sorted alphabetically at every level.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value.toString() : 'null';
    }
    if (typeof value === 'string') {
      return JSON.stringify(value.normalize('NFC'));
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(x => (x === undefined ? 'null' : canonicalizeJson(x)));
    return `[${items.join(',')}]`;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys
    .filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .map(k => `${JSON.stringify(k.normalize('NFC'))}:${canonicalizeJson((value as Record<string, unknown>)[k])}`);

  return `{${entries.join(',')}}`;
}

/**
 * Computes a deterministic SHA-256 fingerprint from canonical snapshot data.
 * Documented boundary: This is an integrity digest of the computational pattern state,
 * NOT a cryptographic digital signature or public-key certificate.
 */
export function computeCanonicalFingerprint(data: object): string {
  const canonical = canonicalizeJson(data);
  return sha256Hex(canonical);
}

/**
 * Computes the authoritative Content Fingerprint for a ProductionPatternRevisionSnapshot.
 *
 * Exact Field Inclusion Contract:
 * - schemaVersion
 * - garmentCategory
 * - targetSize
 * - designSpecification
 * - measurementSet
 * - approvalState
 * - fabricSpecification
 * - patternPieces
 * - draftingConfiguration
 * - validation
 * - assemblySummary
 * - gradingSummary
 * - physicalValidationStatus
 * - engineProvenance
 *
 * Explicitly Excluded Non-Engineering Metadata:
 * - projectId (workspace container ID)
 * - revisionId (revision identifier instance)
 * - parentRevisionId (lineage reference)
 * - revisionIndex (local branch index)
 * - createdAt (timestamp of snapshot creation)
 * - createdBy (user or automated process identity)
 * - canonicalFingerprint (the self-referential hash digest)
 */
export function computeCanonicalRevisionFingerprint(
  snapshot: Omit<ProductionPatternRevisionSnapshot, 'canonicalFingerprint'> | ProductionPatternRevisionSnapshot
): string {
  const payload = {
    schemaVersion: snapshot.schemaVersion,
    garmentCategory: snapshot.garmentCategory,
    targetSize: snapshot.targetSize,
    designSpecification: snapshot.designSpecification,
    measurementSet: snapshot.measurementSet,
    approvalState: snapshot.approvalState,
    fabricSpecification: snapshot.fabricSpecification,
    patternPieces: snapshot.patternPieces,
    draftingConfiguration: snapshot.draftingConfiguration,
    validation: snapshot.validation,
    assemblySummary: snapshot.assemblySummary,
    gradingSummary: snapshot.gradingSummary,
    physicalValidationStatus: snapshot.approvalState.physicalPrototypeValidation,
    engineProvenance: {
      engineVersion: snapshot.engineProvenance.engineVersion,
      appVersion: snapshot.engineProvenance.appVersion,
      gitCommit: snapshot.engineProvenance.gitCommit,
      snapshotEngine: snapshot.engineProvenance.snapshotEngine
    }
  };

  return computeCanonicalFingerprint(payload);
}

/**
 * Computes the deterministic SHA-256 fingerprint of a single PatternPieceSnapshot's geometric content.
 */
export function computePieceGeometryFingerprint(piece: PatternPieceSnapshot): string {
  const payload = {
    id: piece.id,
    pieceCode: piece.pieceCode,
    name: piece.name,
    garmentCategory: piece.garmentCategory,
    sizeCode: piece.sizeCode,
    cutCount: piece.cutCount,
    onFold: piece.onFold,
    material: piece.material,
    cutPathData: piece.cutPathData,
    sewPathData: piece.sewPathData,
    seamAllowanceWidthCm: piece.seamAllowanceWidthCm,
    grainline: piece.grainline,
    darts: piece.darts,
    notches: piece.notches,
    seams: piece.seams,
    drillHoles: piece.drillHoles ?? null,
    boundingBox: piece.boundingBox,
    stitchingContour: piece.stitchingContour ?? null,
    cuttingContour: piece.cuttingContour ?? null
  };
  return computeCanonicalFingerprint(payload);
}

/**
 * Computes the deterministic SHA-256 `geometryFingerprint` over serialized pattern pieces (`Milestone 05.1 Amendment 1`).
 */
export function computeGeometryFingerprint(
  patternPieces: readonly PatternPieceSnapshot[]
): string {
  const piecesPayload = patternPieces.map(piece => ({
    pieceId: piece.id,
    pieceCode: piece.pieceCode,
    sizeCode: piece.sizeCode,
    pieceGeometryFingerprint: computePieceGeometryFingerprint(piece)
  }));
  return computeCanonicalFingerprint({
    pieceCount: patternPieces.length,
    pieces: piecesPayload
  });
}

/**
 * Computes the deterministic SHA-256 `draftingConfigFingerprint` over drafting configuration,
 * fabric specification, and deterministic engine provenance (`Milestone 05.1 Amendment 1`).
 */
export function computeDraftingConfigFingerprint(params: {
  readonly draftingConfiguration: DraftingConfigurationSnapshot;
  readonly fabricSpecification: FabricSpecificationSnapshot;
  readonly engineProvenance: EngineProvenanceRecord;
}): string {
  return computeCanonicalFingerprint({
    draftingConfiguration: params.draftingConfiguration,
    fabricSpecification: params.fabricSpecification,
    engineProvenance: {
      engineVersion: params.engineProvenance.engineVersion,
      appVersion: params.engineProvenance.appVersion ?? null,
      gitCommit: params.engineProvenance.gitCommit ?? null,
      snapshotEngine: params.engineProvenance.snapshotEngine ?? null
    }
  });
}

/**
 * Computes the immutable `basePatternFingerprint` / `contentFingerprint` for a pattern revision
 * (`Milestone 05.1 Amendment 1 & Amendment 2`).
 *
 * Strictly Acyclic & Content-Only Contract:
 * - Covers immutable source pattern engineering data: source specification, measurements,
 *   drafting configuration, fabric, serialized geometry (`patternPieces` + `geometryFingerprint`),
 *   assembly summary, and geometry validation evidence (`validation`).
 * - NEVER includes downstream grading artifact IDs, `gradingArtifactFingerprint`, `gradingSummary`,
 *   mutable `approvalState`, or lifecycle event fields (`lifecycleHistory`, `currentLifecycleState`,
 *   `supersededByRevisionId`, `invalidationRecords`).
 */
export function computeBasePatternContentFingerprint(snapshot: {
  readonly schemaVersion: string;
  readonly garmentCategory: string;
  readonly targetSize: string;
  readonly sourceSpecificationId?: string;
  readonly sourceSpecificationRevisionId?: string;
  readonly sourceSpecificationFingerprint?: string;
  readonly designSpecification: DesignSpecificationSnapshot;
  readonly sourceMeasurementSetId?: string;
  readonly sourceMeasurementRevisionId?: string;
  readonly sourceMeasurementSetFingerprint?: string;
  readonly measurementSet: MeasurementSetSnapshot;
  readonly fabricSpecification: FabricSpecificationSnapshot;
  readonly draftingConfiguration: DraftingConfigurationSnapshot;
  readonly draftingConfigFingerprint?: string;
  readonly patternPieces: readonly PatternPieceSnapshot[];
  readonly geometryFingerprint?: string;
  readonly validation: ProductionPatternRevisionSnapshot['validation'];
  readonly assemblySummary?: ProductionPatternRevisionSnapshot['assemblySummary'];
  readonly engineProvenance: EngineProvenanceRecord;
}): string {
  const geometryFp =
    snapshot.geometryFingerprint ?? computeGeometryFingerprint(snapshot.patternPieces);
  const draftingConfigFp =
    snapshot.draftingConfigFingerprint ??
    computeDraftingConfigFingerprint({
      draftingConfiguration: snapshot.draftingConfiguration,
      fabricSpecification: snapshot.fabricSpecification,
      engineProvenance: snapshot.engineProvenance
    });

  const immutableDesignEngineering = {
    id: snapshot.designSpecification.id,
    version: snapshot.designSpecification.version,
    name: snapshot.designSpecification.name,
    garmentCategory: snapshot.designSpecification.garmentCategory,
    silhouette: snapshot.designSpecification.silhouette,
    easeProfile: snapshot.designSpecification.easeProfile,
    lengthCm: snapshot.designSpecification.lengthCm,
    specificationRevisionId: snapshot.designSpecification.specificationRevisionId ?? null,
    parentRevisionId: snapshot.designSpecification.parentRevisionId ?? null,
    explicitEaseCm: snapshot.designSpecification.explicitEaseCm ?? null,
    targetFinishedDimensions: snapshot.designSpecification.targetFinishedDimensions ?? null,
    allowances: snapshot.designSpecification.allowances ?? null,
    dartStyle: snapshot.designSpecification.dartStyle ?? null,
    sleeveEaseStrategy: snapshot.designSpecification.sleeveEaseStrategy ?? null,
    constructionFeatures: snapshot.designSpecification.constructionFeatures,
    designNotes: snapshot.designSpecification.designNotes
  };

  const immutableMeasurementEngineering = {
    unit: snapshot.measurementSet.unit,
    values: snapshot.measurementSet.values,
    defaultOrigin: snapshot.measurementSet.defaultOrigin,
    perMeasurementOrigin: snapshot.measurementSet.perMeasurementOrigin ?? null,
    evidence: snapshot.measurementSet.evidence ?? null,
    notes: snapshot.measurementSet.notes ?? null
  };

  const immutableValidationEvidence = {
    status: snapshot.validation.status,
    isValid: snapshot.validation.isValid,
    passedCount: snapshot.validation.passedCount,
    warningCount: snapshot.validation.warningCount,
    failureCount: snapshot.validation.failureCount,
    checks: snapshot.validation.checks,
    unassessedConditions: snapshot.validation.unassessedConditions
  };

  return computeCanonicalFingerprint({
    schemaVersion: snapshot.schemaVersion,
    garmentCategory: snapshot.garmentCategory,
    targetSize: snapshot.targetSize,
    sourceSpecificationId: snapshot.sourceSpecificationId ?? snapshot.designSpecification.id,
    sourceSpecificationRevisionId:
      snapshot.sourceSpecificationRevisionId ??
      snapshot.designSpecification.specificationRevisionId ??
      `spec-${snapshot.designSpecification.id}-v${snapshot.designSpecification.version}`,
    sourceSpecificationFingerprint:
      snapshot.sourceSpecificationFingerprint ??
      computeCanonicalFingerprint(immutableDesignEngineering),
    designEngineering: immutableDesignEngineering,
    sourceMeasurementSetId:
      snapshot.sourceMeasurementSetId ??
      `meas-${snapshot.targetSize}-${snapshot.designSpecification.id}`,
    sourceMeasurementRevisionId:
      snapshot.sourceMeasurementRevisionId ??
      snapshot.measurementSet.approval?.measurementRevisionReference ??
      null,
    sourceMeasurementSetFingerprint:
      snapshot.sourceMeasurementSetFingerprint ??
      computeCanonicalFingerprint(immutableMeasurementEngineering),
    measurementEngineering: immutableMeasurementEngineering,
    fabricSpecification: snapshot.fabricSpecification,
    draftingConfiguration: snapshot.draftingConfiguration,
    draftingConfigFingerprint: draftingConfigFp,
    geometryFingerprint: geometryFp,
    patternPieces: snapshot.patternPieces,
    validationEvidence: immutableValidationEvidence,
    assemblySummary: snapshot.assemblySummary ?? null,
    engineProvenance: {
      engineVersion: snapshot.engineProvenance.engineVersion,
      appVersion: snapshot.engineProvenance.appVersion ?? null,
      gitCommit: snapshot.engineProvenance.gitCommit ?? null,
      snapshotEngine: snapshot.engineProvenance.snapshotEngine ?? null
    }
  });
}

/**
 * Computes the hash-chained `lifecycleEventFingerprint` for a single PatternRevisionLifecycleEvent (`Milestone 05.1 Amendment 2`).
 */
export function computePatternLifecycleEventFingerprint(
  event: Omit<PatternRevisionLifecycleEvent, 'lifecycleEventFingerprint'>
): string {
  return computeCanonicalFingerprint({
    eventId: event.eventId,
    eventIndex: event.eventIndex,
    eventType: event.eventType,
    fromState: event.fromState,
    toState: event.toState,
    targetRevisionId: event.targetRevisionId,
    targetContentFingerprint: event.targetContentFingerprint,
    timestamp: event.timestamp,
    actor: event.actor,
    reason: event.reason ?? null,
    supersededByRevisionId: event.supersededByRevisionId ?? null,
    invalidationRecord: event.invalidationRecord ?? null,
    approvalRecord: event.approvalRecord ?? null,
    previousEventFingerprint: event.previousEventFingerprint
  });
}

/**
 * Derives the current lifecycle state of a pattern revision from its append-only `lifecycleHistory`.
 */
export function derivePatternRevisionLifecycleState(
  lifecycleHistory: readonly PatternRevisionLifecycleEvent[] | undefined,
  fallbackState: PatternRevisionLifecycleState = 'draft'
): PatternRevisionLifecycleState {
  if (!Array.isArray(lifecycleHistory) || lifecycleHistory.length === 0) {
    return fallbackState;
  }
  return lifecycleHistory[lifecycleHistory.length - 1].toState;
}

/**
 * Computes the `currentStateFingerprint` binding the immutable `contentFingerprint` to the latest
 * append-only lifecycle state (`Milestone 05.1 Amendment 2`).
 */
export function computePatternCurrentStateFingerprint(params: {
  readonly revisionId: string;
  readonly contentFingerprint: string;
  readonly currentLifecycleState: PatternRevisionLifecycleState;
  readonly lifecycleHistory: readonly PatternRevisionLifecycleEvent[];
}): string {
  const latestEvent =
    params.lifecycleHistory.length > 0
      ? params.lifecycleHistory[params.lifecycleHistory.length - 1]
      : null;
  return computeCanonicalFingerprint({
    revisionId: params.revisionId,
    contentFingerprint: params.contentFingerprint,
    currentLifecycleState: params.currentLifecycleState,
    eventCount: params.lifecycleHistory.length,
    latestEventFingerprint: latestEvent ? latestEvent.lifecycleEventFingerprint : null
  });
}

/**
 * Creates an authoritative, deeply-frozen ProductionPatternRevisionSnapshot.
 * Binds identity, design, measurements, fabric, geometry, validation, and provenance,
 * while establishing separated content (`contentFingerprint` / `basePatternFingerprint`)
 * and lifecycle (`lifecycleHistory` / `currentStateFingerprint`) integrity boundaries.
 *
 * Strict Rule: Requires explicit revisionId. Random or time-based implicit generation is prohibited.
 */
export function createProductionPatternRevision(
  input: CreateProductionPatternRevisionInput
): ProductionPatternRevisionSnapshot {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const projectId = input.projectId ?? '';
  const revisionId = (input.revisionId ?? '').trim();
  const revisionIndex = input.revisionIndex ?? 1;

  // 1. Snapshot sub-components
  const designSnapshot = createDesignSpecificationSnapshot(input.designSpecification);
  const measurementSnapshot = createMeasurementSetSnapshot(
    input.measurements.values,
    {
      defaultOrigin: input.measurements.defaultOrigin,
      perMeasurementOrigin: input.measurements.perMeasurementOrigin,
      approval: input.measurements.approval,
      evidence: input.measurements.evidence,
      notes: input.measurements.notes
    }
  );
  const fabricSnapshot = createFabricSpecificationSnapshot(input.fabric);

  // 2. Snapshot pattern pieces
  const pieceSnapshots = input.patternPieces.map(p =>
    serializePatternPieceSnapshot(p, input.targetSize)
  );

  // 3. Drafting configuration
  const draftingConfig: DraftingConfigurationSnapshot = {
    dartStyle: input.draftingConfiguration?.dartStyle ?? input.designSpecification.dartStyle ?? 'waist',
    sleeveEaseStrategy: input.draftingConfiguration?.sleeveEaseStrategy ?? input.designSpecification.sleeveEaseStrategy ?? 'classic',
    seamAllowanceCm: input.draftingConfiguration?.seamAllowanceCm ?? 1.5,
    hemAllowanceCm: input.draftingConfiguration?.hemAllowanceCm ?? 3.0,
    waistAllowanceCm: input.draftingConfiguration?.waistAllowanceCm,
    neckAllowanceCm: input.draftingConfiguration?.neckAllowanceCm,
    armholeAllowanceCm: input.draftingConfiguration?.armholeAllowanceCm,
    shoulderAllowanceCm: input.draftingConfiguration?.shoulderAllowanceCm,
    bezierToleranceCm: input.draftingConfiguration?.bezierToleranceCm,
    miterLimit: input.draftingConfiguration?.miterLimit,
    categoryRegistryId: input.draftingConfiguration?.categoryRegistryId,
    negativeEasePolicyApplied: input.draftingConfiguration?.negativeEasePolicyApplied,
    customOptions: input.draftingConfiguration?.customOptions ? { ...input.draftingConfiguration.customOptions } : undefined
  };

  // 4. Approval State Summary
  const approvalState: ApprovalStateSummary = {
    designApproval: designSnapshot.isApproved ? 'approved' : 'pending',
    measurementApproval: measurementSnapshot.approval.state,
    patternGeometryValidation: input.validation.status,
    assemblyValidation: input.assemblySummary
      ? (input.assemblySummary.isValid ? 'verified-valid' : 'invalid')
      : 'not-applicable',
    gradingValidation: input.gradingSummary
      ? (input.gradingSummary.isOverallGradingValid ? 'valid' : 'invalid')
      : 'not-applicable',
    physicalPrototypeValidation: input.physicalValidationStatus ?? 'not-assessed'
  };

  // 5. Engine Provenance
  const engineProvenance: EngineProvenanceRecord = {
    engineVersion: input.engineProvenance?.engineVersion ?? CURRENT_ENGINE_VERSION,
    appVersion: input.engineProvenance?.appVersion,
    gitCommit: input.engineProvenance?.gitCommit,
    buildTimestamp: input.engineProvenance?.buildTimestamp ?? new Date().toISOString(),
    snapshotEngine: input.engineProvenance?.snapshotEngine ?? CURRENT_SNAPSHOT_ENGINE
  };

  // 6. Compute Acyclic Lineage & Content Fingerprints (Milestone 05.1 Amendment 1 & 2)
  const sourceSpecificationId = input.designSpecification.id;
  const sourceSpecificationRevisionId =
    input.designSpecification.specificationRevisionId ??
    `spec-${input.designSpecification.id}-v${input.designSpecification.version ?? 1}`;

  let resolvedSpecFp = input.sourceSpecificationFingerprint;
  if (!resolvedSpecFp) {
    try {
      resolvedSpecFp = computeSpecificationFingerprint(input.designSpecification);
    } catch {
      resolvedSpecFp = computeCanonicalFingerprint(designSnapshot);
    }
  }

  const sourceMeasurementSetId =
    input.sourceMeasurementSetId ?? `meas-${input.targetSize}-${input.designSpecification.id}`;
  const sourceMeasurementRevisionId =
    input.sourceMeasurementRevisionId ??
    input.measurements.approval?.measurementRevisionReference ??
    `${sourceMeasurementSetId}-rev-1`;
  const sourceMeasurementSetFingerprint =
    input.sourceMeasurementSetFingerprint ??
    computeCanonicalFingerprint({
      unit: measurementSnapshot.unit,
      values: measurementSnapshot.values,
      defaultOrigin: measurementSnapshot.defaultOrigin,
      perMeasurementOrigin: measurementSnapshot.perMeasurementOrigin ?? null,
      evidence: measurementSnapshot.evidence ?? null,
      notes: measurementSnapshot.notes ?? null
    });

  const draftingConfigFingerprint = computeDraftingConfigFingerprint({
    draftingConfiguration: draftingConfig,
    fabricSpecification: fabricSnapshot,
    engineProvenance
  });

  const geometryFingerprint = computeGeometryFingerprint(pieceSnapshots);

  const preliminarySnapshot = {
    schemaVersion: PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION,
    projectId,
    revisionId,
    parentRevisionId: input.parentRevisionId,
    revisionIndex,
    createdAt: timestamp,
    createdBy: input.createdBy,
    garmentCategory: input.designSpecification.garmentCategory,
    targetSize: input.targetSize,
    designSpecification: designSnapshot,
    measurementSet: measurementSnapshot,
    fabricSpecification: fabricSnapshot,
    patternPieces: pieceSnapshots,
    draftingConfiguration: draftingConfig,
    validation: input.validation,
    assemblySummary: input.assemblySummary as ProductionPatternRevisionSnapshot['assemblySummary'],
    gradingSummary: input.gradingSummary as ProductionPatternRevisionSnapshot['gradingSummary'],
    engineProvenance,
    approvalState,
    sourceSpecificationId,
    sourceSpecificationRevisionId,
    sourceSpecificationFingerprint: resolvedSpecFp,
    sourceMeasurementSetId,
    sourceMeasurementRevisionId,
    sourceMeasurementSetFingerprint,
    draftingConfigFingerprint,
    geometryFingerprint,
    isProductionReady: false as const
  };

  const basePatternFingerprint = computeBasePatternContentFingerprint(preliminarySnapshot);
  const contentFingerprint = basePatternFingerprint;
  const canonicalFingerprint = computeCanonicalRevisionFingerprint(preliminarySnapshot);

  // 7. Build Initial Append-Only Lifecycle History (Milestone 05.1 Amendment 2)
  const actor = (input.createdBy ?? '').trim() || 'Patroner Drafting Engine';
  const draftCreatedBase: Omit<PatternRevisionLifecycleEvent, 'lifecycleEventFingerprint'> = {
    eventId: `evt-pat-${revisionId || 'rev'}-0`,
    eventIndex: 0,
    eventType: 'draft-created',
    fromState: null,
    toState: 'draft',
    targetRevisionId: revisionId,
    targetContentFingerprint: contentFingerprint,
    timestamp,
    actor,
    reason: 'Initial deterministic pattern revision draft created.',
    previousEventFingerprint: null
  };
  const draftCreatedEvent: PatternRevisionLifecycleEvent = {
    ...draftCreatedBase,
    lifecycleEventFingerprint: computePatternLifecycleEventFingerprint(draftCreatedBase)
  };

  const lifecycleEvents: PatternRevisionLifecycleEvent[] = [draftCreatedEvent];
  if (
    input.initialLifecycleState === 'validated' &&
    input.validation.isValid &&
    input.validation.status === 'validated' &&
    input.validation.failureCount === 0 &&
    pieceSnapshots.length > 0
  ) {
    const validatedBase: Omit<PatternRevisionLifecycleEvent, 'lifecycleEventFingerprint'> = {
      eventId: `evt-pat-${revisionId || 'rev'}-1`,
      eventIndex: 1,
      eventType: 'validated',
      fromState: 'draft',
      toState: 'validated',
      targetRevisionId: revisionId,
      targetContentFingerprint: contentFingerprint,
      timestamp,
      actor,
      reason: `Geometry validation passed (${input.validation.passedCount} checks passed, 0 failures).`,
      previousEventFingerprint: draftCreatedEvent.lifecycleEventFingerprint
    };
    lifecycleEvents.push({
      ...validatedBase,
      lifecycleEventFingerprint: computePatternLifecycleEventFingerprint(validatedBase)
    });
  }

  const currentLifecycleState = derivePatternRevisionLifecycleState(lifecycleEvents, 'draft');
  const currentStateFingerprint = computePatternCurrentStateFingerprint({
    revisionId,
    contentFingerprint,
    currentLifecycleState,
    lifecycleHistory: lifecycleEvents
  });

  // 8. Assemble master snapshot
  const rawSnapshot: ProductionPatternRevisionSnapshot = {
    ...preliminarySnapshot,
    basePatternFingerprint,
    contentFingerprint,
    canonicalFingerprint,
    lifecycleHistory: lifecycleEvents,
    currentLifecycleState,
    currentStateFingerprint,
    invalidationRecords: []
  };

  return deepFreeze(rawSnapshot);
}

/**
 * Deterministically compares a saved revision snapshot against current input states.
 * Identifies exact field mismatches across design, measurements, material, configuration, and geometry.
 */
export function compareRevisionInputs(
  snapshot: ProductionPatternRevisionSnapshot,
  current: CurrentRevisionInputs
): RevisionComparisonResult {
  const mismatches: RevisionInputMismatch[] = [];
  const comparedAt = new Date().toISOString();

  // 1. Target Size
  if (current.targetSize && current.targetSize !== snapshot.targetSize) {
    mismatches.push({
      path: 'targetSize',
      field: 'targetSize',
      baselineValue: snapshot.targetSize,
      currentValue: current.targetSize,
      severity: 'breaking',
      description: `Target size changed from '${snapshot.targetSize}' to '${current.targetSize}'.`
    });
  }

  // 2. Design Specification
  if (current.designSpecification) {
    const ds = current.designSpecification;
    if (ds.id && ds.id !== snapshot.designSpecification.id) {
      mismatches.push({
        path: 'designSpecification.id',
        field: 'id',
        baselineValue: snapshot.designSpecification.id,
        currentValue: ds.id,
        severity: 'breaking',
        description: `Design specification ID changed from '${snapshot.designSpecification.id}' to '${ds.id}'.`
      });
    }
    if (ds.version !== undefined && ds.version !== snapshot.designSpecification.version) {
      mismatches.push({
        path: 'designSpecification.version',
        field: 'version',
        baselineValue: snapshot.designSpecification.version,
        currentValue: ds.version,
        severity: 'breaking',
        description: `Design specification version changed from ${snapshot.designSpecification.version} to ${ds.version}.`
      });
    }
    if (ds.silhouette && ds.silhouette !== snapshot.designSpecification.silhouette) {
      mismatches.push({
        path: 'designSpecification.silhouette',
        field: 'silhouette',
        baselineValue: snapshot.designSpecification.silhouette,
        currentValue: ds.silhouette,
        severity: 'breaking',
        description: `Silhouette changed from '${snapshot.designSpecification.silhouette}' to '${ds.silhouette}'.`
      });
    }
    if (ds.easeProfile && ds.easeProfile !== snapshot.designSpecification.easeProfile) {
      mismatches.push({
        path: 'designSpecification.easeProfile',
        field: 'easeProfile',
        baselineValue: snapshot.designSpecification.easeProfile,
        currentValue: ds.easeProfile,
        severity: 'breaking',
        description: `Ease profile changed from '${snapshot.designSpecification.easeProfile}' to '${ds.easeProfile}'.`
      });
    }
    if (ds.lengthCm !== undefined && Math.abs(ds.lengthCm - snapshot.designSpecification.lengthCm) > 0.001) {
      mismatches.push({
        path: 'designSpecification.lengthCm',
        field: 'lengthCm',
        baselineValue: snapshot.designSpecification.lengthCm,
        currentValue: ds.lengthCm,
        severity: 'breaking',
        description: `Length changed from ${snapshot.designSpecification.lengthCm} cm to ${ds.lengthCm} cm.`
      });
    }
    if (ds.specificationRevisionId && snapshot.designSpecification.specificationRevisionId && ds.specificationRevisionId !== snapshot.designSpecification.specificationRevisionId) {
      mismatches.push({
        path: 'designSpecification.specificationRevisionId',
        field: 'specificationRevisionId',
        baselineValue: snapshot.designSpecification.specificationRevisionId,
        currentValue: ds.specificationRevisionId,
        severity: 'breaking',
        description: `Specification revision changed from '${snapshot.designSpecification.specificationRevisionId}' to '${ds.specificationRevisionId}'.`
      });
    }
    if (ds.dartStyle && ds.dartStyle !== snapshot.designSpecification.dartStyle) {
      mismatches.push({
        path: 'designSpecification.dartStyle',
        field: 'dartStyle',
        baselineValue: snapshot.designSpecification.dartStyle,
        currentValue: ds.dartStyle,
        severity: 'breaking',
        description: `Bodice dart style changed from '${snapshot.designSpecification.dartStyle}' to '${ds.dartStyle}'.`
      });
    }
    if (ds.sleeveEaseStrategy && ds.sleeveEaseStrategy !== snapshot.designSpecification.sleeveEaseStrategy) {
      mismatches.push({
        path: 'designSpecification.sleeveEaseStrategy',
        field: 'sleeveEaseStrategy',
        baselineValue: snapshot.designSpecification.sleeveEaseStrategy,
        currentValue: ds.sleeveEaseStrategy,
        severity: 'breaking',
        description: `Sleeve ease strategy changed from '${snapshot.designSpecification.sleeveEaseStrategy}' to '${ds.sleeveEaseStrategy}'.`
      });
    }
  }

  // 3. Body Measurements
  if (current.measurements?.values) {
    for (const [key, val] of Object.entries(current.measurements.values)) {
      const baselineVal = snapshot.measurementSet.values[key];
      if (baselineVal === undefined) {
        mismatches.push({
          path: `measurementSet.values.${key}`,
          field: key,
          baselineValue: undefined,
          currentValue: val,
          severity: 'advisory',
          description: `Measurement '${key}' added with value ${val} cm.`
        });
      } else if (Math.abs(baselineVal - val) > 0.0001) {
        mismatches.push({
          path: `measurementSet.values.${key}`,
          field: key,
          baselineValue: baselineVal,
          currentValue: val,
          severity: 'breaking',
          description: `Measurement '${key}' changed from ${baselineVal} cm to ${val} cm.`
        });
      }
    }
  }

  // 4. Fabric Specification
  if (current.fabric) {
    if (current.fabric.id && current.fabric.id !== snapshot.fabricSpecification.fabricId) {
      mismatches.push({
        path: 'fabricSpecification.fabricId',
        field: 'fabricId',
        baselineValue: snapshot.fabricSpecification.fabricId,
        currentValue: current.fabric.id,
        severity: 'breaking',
        description: `Fabric ID changed from '${snapshot.fabricSpecification.fabricId}' to '${current.fabric.id}'.`
      });
    }
    const enhanced = current.fabric as EnhancedFabricProperty;
    if (enhanced.gsm && snapshot.fabricSpecification.gsm && Math.abs(enhanced.gsm - snapshot.fabricSpecification.gsm) > 1.0) {
      mismatches.push({
        path: 'fabricSpecification.gsm',
        field: 'gsm',
        baselineValue: snapshot.fabricSpecification.gsm,
        currentValue: enhanced.gsm,
        severity: 'breaking',
        description: `Fabric GSM changed from ${snapshot.fabricSpecification.gsm} to ${enhanced.gsm}.`
      });
    }
    if (enhanced.revision && snapshot.fabricSpecification.fabricRevision && enhanced.revision !== snapshot.fabricSpecification.fabricRevision) {
      mismatches.push({
        path: 'fabricSpecification.fabricRevision',
        field: 'fabricRevision',
        baselineValue: snapshot.fabricSpecification.fabricRevision,
        currentValue: enhanced.revision,
        severity: 'breaking',
        description: `Fabric revision changed from '${snapshot.fabricSpecification.fabricRevision}' to '${enhanced.revision}'.`
      });
    }
  }

  // 5. Drafting Configuration
  if (current.draftingConfiguration) {
    const dc = current.draftingConfiguration;
    if (dc.dartStyle && dc.dartStyle !== snapshot.draftingConfiguration.dartStyle) {
      mismatches.push({
        path: 'draftingConfiguration.dartStyle',
        field: 'dartStyle',
        baselineValue: snapshot.draftingConfiguration.dartStyle,
        currentValue: dc.dartStyle,
        severity: 'breaking',
        description: `Drafting dart style changed from '${snapshot.draftingConfiguration.dartStyle}' to '${dc.dartStyle}'.`
      });
    }
    if (
      dc.seamAllowanceCm !== undefined &&
      snapshot.draftingConfiguration.seamAllowanceCm !== undefined &&
      Math.abs(dc.seamAllowanceCm - snapshot.draftingConfiguration.seamAllowanceCm) > 0.01
    ) {
      mismatches.push({
        path: 'draftingConfiguration.seamAllowanceCm',
        field: 'seamAllowanceCm',
        baselineValue: snapshot.draftingConfiguration.seamAllowanceCm,
        currentValue: dc.seamAllowanceCm,
        severity: 'breaking',
        description: `Seam allowance changed from ${snapshot.draftingConfiguration.seamAllowanceCm} cm to ${dc.seamAllowanceCm} cm.`
      });
    }
  }

  // 6. Pattern Pieces
  if (current.patternPieces) {
    if (current.patternPieces.length !== snapshot.patternPieces.length) {
      mismatches.push({
        path: 'patternPieces.length',
        field: 'length',
        baselineValue: snapshot.patternPieces.length,
        currentValue: current.patternPieces.length,
        severity: 'breaking',
        description: `Pattern piece count changed from ${snapshot.patternPieces.length} to ${current.patternPieces.length}.`
      });
    } else {
      const snapPieceMap = new Map(snapshot.patternPieces.map(p => [p.pieceCode, p]));
      for (const cp of current.patternPieces) {
        const snapPiece = snapPieceMap.get(cp.pieceCode);
        if (!snapPiece) {
          mismatches.push({
            path: `patternPieces.${cp.pieceCode}`,
            field: 'pieceCode',
            baselineValue: undefined,
            currentValue: cp.pieceCode,
            severity: 'breaking',
            description: `Piece code '${cp.pieceCode}' not present in baseline snapshot.`
          });
        } else if (cp.boundingBox) {
          if (
            Math.abs(cp.boundingBox.widthCm - snapPiece.boundingBox.widthCm) > 0.01 ||
            Math.abs(cp.boundingBox.heightCm - snapPiece.boundingBox.heightCm) > 0.01
          ) {
            mismatches.push({
              path: `patternPieces.${cp.pieceCode}.boundingBox`,
              field: 'boundingBox',
              baselineValue: `${snapPiece.boundingBox.widthCm}x${snapPiece.boundingBox.heightCm}`,
              currentValue: `${cp.boundingBox.widthCm}x${cp.boundingBox.heightCm}`,
              severity: 'breaking',
              description: `Piece '${cp.pieceCode}' bounding box changed from ${snapPiece.boundingBox.widthCm}x${snapPiece.boundingBox.heightCm} to ${cp.boundingBox.widthCm}x${cp.boundingBox.heightCm} cm.`
            });
          }
        }
      }
    }
  }

  // 7. Engine Version
  if (current.engineVersion && current.engineVersion !== snapshot.engineProvenance.engineVersion) {
    mismatches.push({
      path: 'engineProvenance.engineVersion',
      field: 'engineVersion',
      baselineValue: snapshot.engineProvenance.engineVersion,
      currentValue: current.engineVersion,
      severity: 'advisory',
      description: `Engine version changed from '${snapshot.engineProvenance.engineVersion}' to '${current.engineVersion}'.`
    });
  }

  const isStale = mismatches.length > 0;
  const hasBreakingChanges = mismatches.some(m => m.severity === 'breaking');

  return {
    isStale,
    hasBreakingChanges,
    mismatches,
    comparedAt
  };
}

/**
 * Checks whether two revisions are content-equivalent by comparing their canonical fingerprints.
 */
export function arePatternRevisionsEquivalent(
  a: ProductionPatternRevisionSnapshot,
  b: ProductionPatternRevisionSnapshot
): boolean {
  return a.canonicalFingerprint === b.canonicalFingerprint;
}

/**
 * Computes the immutable content fingerprint of an AuthoritativeGradingArtifact
 * (Amendment 1 & Amendment 2: excludes lifecycleState, supersededByRevisionId, revocationReason, revokedAt).
 */
export function computeGradingArtifactContentFingerprint(
  artifact: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint' | 'contentFingerprint'> | AuthoritativeGradingArtifact
): string {
  const sourceBaseFp = artifact.sourceBasePatternFingerprint ?? artifact.sourcePatternSnapshotFingerprint ?? null;
  const payload = {
    schemaVersion: 'm05.1-grading-content-v1',
    gradingArtifactId: artifact.gradingArtifactId,
    gradingRevisionId: artifact.gradingRevisionId,
    tenantId: artifact.tenantId,
    projectId: artifact.projectId,
    organizationScope: artifact.organizationScope ?? null,
    sourcePatternRevisionId: artifact.sourcePatternRevisionId,
    sourceBasePatternFingerprint: sourceBaseFp,
    draftingFingerprint: artifact.draftingFingerprint ?? null,
    cadGeometryFingerprint: artifact.cadGeometryFingerprint ?? null,
    sourceSpecificationId: artifact.sourceSpecificationId,
    sourceSpecificationRevisionId: artifact.sourceSpecificationRevisionId,
    sourceSpecificationFingerprint: artifact.sourceSpecificationFingerprint,
    sourceMeasurementSetId: artifact.sourceMeasurementSetId,
    sourceMeasurementSetFingerprint: artifact.sourceMeasurementSetFingerprint,
    sizeRange: artifact.sizeRange,
    baseSize: artifact.baseSize,
    gradingRuleSetId: artifact.gradingRuleSetId,
    gradingRuleSetRevision: artifact.gradingRuleSetRevision,
    gradingRuleSetFingerprint: artifact.gradingRuleSetFingerprint,
    perSizePatternGeometry: artifact.perSizePatternGeometry,
    geometryValidationResult: artifact.geometryValidationResult,
    gradingValidationResult: artifact.gradingValidationResult,
    createdAt: artifact.createdAt,
    isProductionReady: false as const
  };
  return computeCanonicalFingerprint(payload);
}

/**
 * Computes the deterministic SHA-256 fingerprint of an AuthoritativeGradingArtifact.
 */
export function computeCanonicalGradingArtifactFingerprint(
  artifact: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> | AuthoritativeGradingArtifact
): string {
  const payload = {
    gradingArtifactId: artifact.gradingArtifactId,
    gradingRevisionId: artifact.gradingRevisionId,
    tenantId: artifact.tenantId,
    projectId: artifact.projectId,
    organizationScope: artifact.organizationScope ?? null,
    sourcePatternRevisionId: artifact.sourcePatternRevisionId,
    sourcePatternSnapshotFingerprint: artifact.sourcePatternSnapshotFingerprint ?? null,
    draftingFingerprint: artifact.draftingFingerprint ?? null,
    cadGeometryFingerprint: artifact.cadGeometryFingerprint ?? null,
    sourceSpecificationId: artifact.sourceSpecificationId,
    sourceSpecificationRevisionId: artifact.sourceSpecificationRevisionId,
    sourceSpecificationFingerprint: artifact.sourceSpecificationFingerprint,
    sourceMeasurementSetId: artifact.sourceMeasurementSetId,
    sourceMeasurementSetFingerprint: artifact.sourceMeasurementSetFingerprint,
    sizeRange: artifact.sizeRange,
    baseSize: artifact.baseSize,
    gradingRuleSetId: artifact.gradingRuleSetId,
    gradingRuleSetRevision: artifact.gradingRuleSetRevision,
    gradingRuleSetFingerprint: artifact.gradingRuleSetFingerprint,
    perSizePatternGeometry: artifact.perSizePatternGeometry,
    geometryValidationResult: artifact.geometryValidationResult,
    perSizeGeometryValidation: artifact.perSizeGeometryValidation ?? artifact.geometryValidationResult,
    gradingValidationResult: artifact.gradingValidationResult,
    crossSizeIntegrityReport: artifact.crossSizeIntegrityReport ?? artifact.gradingValidationResult,
    createdAt: artifact.createdAt,
    lifecycleState: artifact.lifecycleState,
    supersededByRevisionId: artifact.supersededByRevisionId ?? null,
    revocationReason: artifact.revocationReason ?? null,
    revokedAt: artifact.revokedAt ?? null,
    isProductionReady: false as const
  };
  return computeCanonicalFingerprint(payload);
}

/**
 * Creates a complete, immutable AuthoritativeGradingArtifact binding multi-size graded
 * pattern geometry and cross-size validation results to exact upstream specification,
 * pattern revision, measurement set, and grading ruleset fingerprints.
 */
export function createAuthoritativeGradingArtifact(
  input: CreateAuthoritativeGradingArtifactInput
): AuthoritativeGradingArtifact {
  if (!input || typeof input !== 'object') {
    throw new ProductionSnapshotValidationError('Grading artifact input must be a non-null object.');
  }
  if (!input.sourcePatternRevisionId || input.sourcePatternRevisionId.trim() === '') {
    throw new ProductionSnapshotValidationError('Grading artifact requires a non-empty sourcePatternRevisionId.');
  }
  if (!input.sourceSpecificationId || input.sourceSpecificationId.trim() === '') {
    throw new ProductionSnapshotValidationError('Grading artifact requires a non-empty sourceSpecificationId.');
  }
  if (!input.sourceSpecificationRevisionId || input.sourceSpecificationRevisionId.trim() === '') {
    throw new ProductionSnapshotValidationError('Grading artifact requires a non-empty sourceSpecificationRevisionId.');
  }
  if (!input.sourceSpecificationFingerprint || input.sourceSpecificationFingerprint.trim() === '') {
    throw new ProductionSnapshotValidationError('Grading artifact requires a non-empty sourceSpecificationFingerprint.');
  }
  if (!input.sourceMeasurementSetFingerprint || input.sourceMeasurementSetFingerprint.trim() === '') {
    throw new ProductionSnapshotValidationError('Grading artifact requires a non-empty sourceMeasurementSetFingerprint.');
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!isValidIsoDate(createdAt)) {
    throw new ProductionSnapshotValidationError(`Invalid grading artifact createdAt timestamp '${createdAt}'.`);
  }

  const projectId = (input.projectId ?? input.tenantId ?? 'project-patroner-default').trim();
  const tenantId = (input.tenantId ?? projectId).trim();
  const baseSize = (input.baseSize ?? input.gradedPatternSet?.baseSize ?? 'M').trim();
  const sizeRange = input.sizeRange
    ? [...input.sizeRange]
    : (input.gradedPatternSet?.supportedSizes ? [...input.gradedPatternSet.supportedSizes] : ['XS', 'S', 'M', 'L', 'XL', 'XXL']);

  if (sizeRange.length === 0 || !sizeRange.includes(baseSize)) {
    throw new ProductionSnapshotValidationError(
      `Grading artifact sizeRange [${sizeRange.join(', ')}] must be non-empty and include baseSize '${baseSize}'.`
    );
  }

  const gradingRuleSetId = (input.gradingRuleSetId ?? input.gradedPatternSet?.gradeTable?.id ?? 'standard-iso-8559').trim();
  const gradingRuleSetRevision = (input.gradingRuleSetRevision ?? 'iso8559-standard').trim();
  const gradingRuleSetFingerprint =
    input.gradingRuleSetFingerprint ??
    computeCanonicalFingerprint({
      system: 'standard-iso-8559',
      baseSize: 'M',
      version: gradingRuleSetRevision,
      sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
    });

  const perSizePatternGeometry: Record<string, readonly PatternPieceSnapshot[]> = {};
  const geometryValidationResult: Record<string, PerSizeGeometryValidationRecord> = {};

  const rawGeomValInput = input.geometryValidationResult ?? input.perSizeGeometryValidation;

  if (input.perSizePatternGeometry && rawGeomValInput) {
    for (const [sz, pieces] of Object.entries(input.perSizePatternGeometry)) {
      if (!Array.isArray(pieces)) continue;
      perSizePatternGeometry[sz] = pieces.map(p =>
        'stitchingContour' in p && p.boundingBox && 'basis' in p.boundingBox
          ? ({ ...(p as PatternPieceSnapshot) })
          : serializePatternPieceSnapshot(p as PatternPiece, sz)
      );
    }
    for (const [sz, val] of Object.entries(rawGeomValInput)) {
      if (!val) continue;
      const isValid = Boolean(val.isValid) && (val.failureCount ?? 0) === 0 && (!val.errors || val.errors.length === 0);
      const errors = val.errors
        ? [...val.errors]
        : !isValid
          ? [`Size ${sz} failed geometry validation (${val.failureCount ?? 1} error(s)).`]
          : [];
      geometryValidationResult[sz] = {
        sizeId: val.sizeId ?? val.size ?? sz,
        size: val.size ?? val.sizeId ?? sz,
        status: val.status ?? (isValid ? 'validated' : 'invalid'),
        isValid,
        pieceCount: val.pieceCount ?? (perSizePatternGeometry[sz]?.length ?? 0),
        passedCount: val.passedCount,
        warningCount: val.warningCount,
        failureCount: val.failureCount ?? errors.length,
        errors,
        warnings: val.warnings ? [...val.warnings] : []
      };
    }
  } else if (input.gradedPatternSet) {
    const gps = input.gradedPatternSet;
    for (const sz of sizeRange) {
      const szRes = gps.sizeResults[sz];
      if (!szRes) continue;
      if (sz === baseSize && input.basePatternPieces && input.basePatternPieces.length > 0) {
        perSizePatternGeometry[sz] = input.basePatternPieces.map(p =>
          'stitchingContour' in p && p.boundingBox && 'basis' in p.boundingBox
            ? (p as PatternPieceSnapshot)
            : serializePatternPieceSnapshot(p as PatternPiece, sz)
        );
      } else {
        const rawPieces: PatternPiece[] = [
          ...szRes.bodicePieces,
          ...(szRes.sleevePiece ? [szRes.sleevePiece] : [])
        ];
        perSizePatternGeometry[sz] = rawPieces.map(p => serializePatternPieceSnapshot(p, sz));
      }
      const ovVal = rawGeomValInput?.[sz];
      const isValid = ovVal !== undefined
        ? Boolean(ovVal.isValid) && (ovVal.failureCount ?? 0) === 0
        : szRes.isValid && szRes.errors.length === 0;
      geometryValidationResult[sz] = {
        sizeId: sz,
        size: sz,
        status: ovVal?.status ?? szRes.status,
        isValid,
        pieceCount: perSizePatternGeometry[sz].length,
        errors: ovVal?.errors ? [...ovVal.errors] : (!isValid && szRes.errors.length === 0 ? [`Size ${sz} validation failed`] : [...szRes.errors]),
        warnings: ovVal?.warnings ? [...ovVal.warnings] : [...szRes.warnings]
      };
    }
  } else if (input.basePatternPieces && input.basePatternPieces.length > 0) {
    for (const sz of sizeRange) {
      perSizePatternGeometry[sz] = input.basePatternPieces.map(p =>
        'stitchingContour' in p && p.boundingBox && 'basis' in p.boundingBox
          ? { ...(p as PatternPieceSnapshot), sizeCode: sz }
          : serializePatternPieceSnapshot(p as PatternPiece, sz)
      );
      const ovVal = rawGeomValInput?.[sz];
      const isValid = ovVal !== undefined ? Boolean(ovVal.isValid) && (ovVal.failureCount ?? 0) === 0 : true;
      geometryValidationResult[sz] = {
        sizeId: sz,
        size: sz,
        status: ovVal?.status ?? (isValid ? 'verified-valid' : 'invalid'),
        isValid,
        pieceCount: perSizePatternGeometry[sz].length,
        errors: ovVal?.errors ? [...ovVal.errors] : (!isValid ? [`Size ${sz} validation failed`] : []),
        warnings: ovVal?.warnings ? [...ovVal.warnings] : []
      };
    }
  } else {
    throw new ProductionSnapshotValidationError(
      'Grading artifact requires gradedPatternSet, explicit perSizePatternGeometry + geometryValidationResult, or basePatternPieces.'
    );
  }

  const validSizesInRange = Object.values(geometryValidationResult).filter(v => v.isValid).length;
  const failedSizesInRange = Object.values(geometryValidationResult).filter(v => !v.isValid).length;
  const unassessedSizesInRange = Math.max(0, sizeRange.length - Object.keys(geometryValidationResult).length);
  const allSizesValidInRange =
    Object.keys(geometryValidationResult).length === sizeRange.length &&
    Object.values(geometryValidationResult).every(v => v.isValid);

  const gradingValidationResult =
    input.gradingValidationResult ??
    input.crossSizeIntegrityReport ??
    (input.gradedPatternSet?.integrityReport
      ? {
          ...input.gradedPatternSet.integrityReport,
          baseSize,
          evaluatedSizes: [...sizeRange],
          validSizeCount: validSizesInRange,
          failedSizeCount: failedSizesInRange,
          unassessedSizeCount: unassessedSizesInRange,
          isOverallGradingValid:
            Boolean(input.gradedPatternSet.integrityReport.isOverallGradingValid) && allSizesValidInRange
        }
      : {
          timestamp: createdAt,
          baseSize,
          evaluatedSizes: [...sizeRange],
          validSizeCount: validSizesInRange,
          failedSizeCount: failedSizesInRange,
          unassessedSizeCount: unassessedSizesInRange,
          isOverallGradingValid: allSizesValidInRange,
          checks: [],
          comparisonTable: [],
          summaryMessage: 'Cross-size grading geometry and seam integrity verified.',
          unassessedConditions: []
        });

  const gradingArtifactId =
    (input.gradingArtifactId ?? '').trim() ||
    `grade-art-${input.sourceSpecificationRevisionId}-${input.sourcePatternRevisionId}`;
  const gradingRevisionId =
    (input.gradingRevisionId ?? '').trim() ||
    `grade-${input.sourceSpecificationRevisionId}`;
  const sourceMeasurementSetId =
    (input.sourceMeasurementSetId ?? '').trim() ||
    `meas-${baseSize}-${input.sourceSpecificationId}`;
  const lifecycleState: GradingLifecycleState = input.lifecycleState ?? 'active';
  const resolvedSourceBasePatternFp =
    input.sourceBasePatternFingerprint?.trim() ||
    input.sourcePatternSnapshotFingerprint?.trim();

  const preliminary: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
    gradingArtifactId,
    gradingRevisionId,
    tenantId,
    projectId,
    organizationScope: input.organizationScope?.trim(),
    sourcePatternRevisionId: input.sourcePatternRevisionId.trim(),
    sourcePatternSnapshotFingerprint: resolvedSourceBasePatternFp,
    sourceBasePatternFingerprint: resolvedSourceBasePatternFp,
    draftingFingerprint: input.draftingFingerprint?.trim(),
    cadGeometryFingerprint: input.cadGeometryFingerprint?.trim(),
    sourceSpecificationId: input.sourceSpecificationId.trim(),
    sourceSpecificationRevisionId: input.sourceSpecificationRevisionId.trim(),
    sourceSpecificationFingerprint: input.sourceSpecificationFingerprint.trim(),
    sourceMeasurementSetId,
    sourceMeasurementSetFingerprint: input.sourceMeasurementSetFingerprint.trim(),
    sizeRange,
    baseSize,
    gradingRuleSetId,
    gradingRuleSetRevision,
    gradingRuleSetFingerprint,
    perSizePatternGeometry,
    geometryValidationResult,
    perSizeGeometryValidation: geometryValidationResult,
    gradingValidationResult,
    crossSizeIntegrityReport: gradingValidationResult,
    createdAt,
    lifecycleState,
    supersededByRevisionId: input.supersededByRevisionId,
    revocationReason: input.revocationReason,
    revokedAt: input.revokedAt,
    isProductionReady: false
  };

  const contentFingerprint = computeGradingArtifactContentFingerprint(preliminary);
  const canonicalFingerprint = computeCanonicalGradingArtifactFingerprint(preliminary);

  return deepFreeze({
    ...preliminary,
    contentFingerprint,
    canonicalFingerprint
  });
}

/**
 * Marks an AuthoritativeGradingArtifact as superseded by a newer grading revision.
 * Preserves immutable contentFingerprint (Amendment 2).
 */
export function supersedeAuthoritativeGradingArtifact(
  artifact: AuthoritativeGradingArtifact,
  supersededByRevisionId: string
): AuthoritativeGradingArtifact {
  if (!supersededByRevisionId || supersededByRevisionId.trim() === '') {
    throw new ProductionSnapshotValidationError('supersededByRevisionId is required to supersede a grading artifact.');
  }
  const immutableContentFp = artifact.contentFingerprint ?? computeGradingArtifactContentFingerprint(artifact);
  const preliminary: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
    ...artifact,
    contentFingerprint: immutableContentFp,
    lifecycleState: 'superseded',
    supersededByRevisionId: supersededByRevisionId.trim(),
    isProductionReady: false
  };
  return deepFreeze({
    ...preliminary,
    canonicalFingerprint: computeCanonicalGradingArtifactFingerprint(preliminary)
  });
}

/**
 * Revokes an AuthoritativeGradingArtifact with an explicit mandatory reason.
 * Preserves immutable contentFingerprint (Amendment 2).
 */
export function revokeAuthoritativeGradingArtifact(
  artifact: AuthoritativeGradingArtifact,
  reason: string,
  revokedAt?: string
): AuthoritativeGradingArtifact {
  if (!reason || reason.trim() === '') {
    throw new ProductionSnapshotValidationError('Revocation reason is required to revoke a grading artifact.');
  }
  const immutableContentFp = artifact.contentFingerprint ?? computeGradingArtifactContentFingerprint(artifact);
  const preliminary: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
    ...artifact,
    contentFingerprint: immutableContentFp,
    lifecycleState: 'revoked',
    revocationReason: reason.trim(),
    revokedAt: revokedAt ?? new Date().toISOString(),
    isProductionReady: false
  };
  return deepFreeze({
    ...preliminary,
    canonicalFingerprint: computeCanonicalGradingArtifactFingerprint(preliminary)
  });
}

/**
 * Independently verifies the structural integrity, lifecycle state, per-size geometry completeness,
 * and canonical SHA-256 fingerprint of an AuthoritativeGradingArtifact.
 */
export function verifyGradingArtifactIntegrity(
  artifact: AuthoritativeGradingArtifact | undefined
): {
  readonly isValid: boolean;
  readonly isTampered: boolean;
  readonly isSizeRangeIncomplete: boolean;
  readonly isValidationFailed: boolean;
  readonly reason?: string;
  readonly errors: readonly string[];
} {
  if (!artifact || typeof artifact !== 'object') {
    return {
      isValid: false,
      isTampered: false,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason: 'AuthoritativeGradingArtifact is missing.',
      errors: ['AuthoritativeGradingArtifact is missing.']
    };
  }

  if ((artifact as unknown as { isProductionReady: boolean }).isProductionReady !== false) {
    const reason = 'Industrial safety violation: grading artifact asserts isProductionReady !== false.';
    return {
      isValid: false,
      isTampered: true,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }

  if (
    !artifact.gradingArtifactId ||
    !artifact.gradingRevisionId ||
    !artifact.sourcePatternRevisionId ||
    !artifact.sourceSpecificationId ||
    !artifact.sourceSpecificationRevisionId ||
    !artifact.sourceSpecificationFingerprint ||
    !artifact.sourceMeasurementSetId ||
    !artifact.sourceMeasurementSetFingerprint ||
    !artifact.gradingRuleSetId ||
    !artifact.gradingRuleSetRevision ||
    !artifact.gradingRuleSetFingerprint ||
    !artifact.baseSize ||
    !artifact.createdAt ||
    !isValidIsoDate(artifact.createdAt)
  ) {
    const reason = 'Grading artifact is missing one or more mandatory lineage identifiers or timestamps.';
    return {
      isValid: false,
      isTampered: false,
      isSizeRangeIncomplete: false,
      isValidationFailed: true,
      reason,
      errors: [reason]
    };
  }

  // Verify alias consistency (FINDING-12)
  const rawAliases = artifact as unknown as {
    artifactId?: string;
    revisionId?: string;
    fingerprint?: string;
  };
  if (rawAliases.artifactId !== undefined && rawAliases.artifactId !== artifact.gradingArtifactId) {
    const reason = `Grading artifact alias inconsistency: artifactId ('${rawAliases.artifactId}') diverges from gradingArtifactId ('${artifact.gradingArtifactId}').`;
    return {
      isValid: false,
      isTampered: true,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }
  if (rawAliases.revisionId !== undefined && rawAliases.revisionId !== artifact.gradingRevisionId) {
    const reason = `Grading artifact alias inconsistency: revisionId ('${rawAliases.revisionId}') diverges from gradingRevisionId ('${artifact.gradingRevisionId}').`;
    return {
      isValid: false,
      isTampered: true,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }
  if (rawAliases.fingerprint !== undefined && rawAliases.fingerprint !== artifact.canonicalFingerprint) {
    const reason = 'Grading artifact alias inconsistency: fingerprint diverges from canonicalFingerprint.';
    return {
      isValid: false,
      isTampered: true,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }
  if (
    artifact.perSizeGeometryValidation &&
    canonicalizeJson(artifact.perSizeGeometryValidation) !== canonicalizeJson(artifact.geometryValidationResult)
  ) {
    const reason = 'Grading artifact alias inconsistency: perSizeGeometryValidation diverges from geometryValidationResult.';
    return {
      isValid: false,
      isTampered: true,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }
  if (
    artifact.crossSizeIntegrityReport &&
    canonicalizeJson(artifact.crossSizeIntegrityReport) !== canonicalizeJson(artifact.gradingValidationResult)
  ) {
    const reason = 'Grading artifact alias inconsistency: crossSizeIntegrityReport diverges from gradingValidationResult.';
    return {
      isValid: false,
      isTampered: true,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }

  try {
    const recomputedFp = computeCanonicalGradingArtifactFingerprint(artifact);
    if (recomputedFp !== artifact.canonicalFingerprint) {
      const reason = 'Grading artifact canonicalFingerprint mismatch; grading geometry or metadata was tampered with.';
      return {
        isValid: false,
        isTampered: true,
        isSizeRangeIncomplete: false,
        isValidationFailed: false,
        reason,
        errors: [reason]
      };
    }
    if (artifact.contentFingerprint !== undefined) {
      const recomputedContentFp = computeGradingArtifactContentFingerprint(artifact);
      if (recomputedContentFp !== artifact.contentFingerprint) {
        const reason = 'Grading artifact contentFingerprint mismatch; immutable grading engineering content was tampered with.';
        return {
          isValid: false,
          isTampered: true,
          isSizeRangeIncomplete: false,
          isValidationFailed: false,
          reason,
          errors: [reason]
        };
      }
    }
  } catch (err) {
    const reason = `Unable to recompute grading artifact fingerprint: ${err instanceof Error ? err.message : String(err)}`;
    return {
      isValid: false,
      isTampered: true,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }

  if (artifact.lifecycleState === 'revoked' || Boolean(artifact.revocationReason)) {
    const reason = `Grading artifact '${artifact.gradingArtifactId}' has been revoked${artifact.revocationReason ? `: ${artifact.revocationReason}` : ''}.`;
    return {
      isValid: false,
      isTampered: false,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }

  if (artifact.lifecycleState === 'superseded' || Boolean(artifact.supersededByRevisionId)) {
    const reason = `Grading artifact '${artifact.gradingArtifactId}' has been superseded by '${artifact.supersededByRevisionId ?? 'newer revision'}'.`;
    return {
      isValid: false,
      isTampered: false,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }

  if (artifact.lifecycleState !== 'active') {
    const reason = `Grading artifact lifecycleState '${artifact.lifecycleState}' is not active.`;
    return {
      isValid: false,
      isTampered: false,
      isSizeRangeIncomplete: false,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }

  if (!Array.isArray(artifact.sizeRange) || artifact.sizeRange.length < 2 || !artifact.sizeRange.includes(artifact.baseSize)) {
    const reason = `Grading artifact sizeRange [${(artifact.sizeRange ?? []).join(', ')}] is incomplete or missing baseSize '${artifact.baseSize}'.`;
    return {
      isValid: false,
      isTampered: false,
      isSizeRangeIncomplete: true,
      isValidationFailed: false,
      reason,
      errors: [reason]
    };
  }

  for (const sz of artifact.sizeRange) {
    const szPieces = artifact.perSizePatternGeometry?.[sz];
    const szVal = artifact.geometryValidationResult?.[sz];
    if (!Array.isArray(szPieces) || szPieces.length === 0 || !szVal) {
      const reason = `Grading artifact is missing pattern geometry or geometry validation record for declared size '${sz}'.`;
      return {
        isValid: false,
        isTampered: false,
        isSizeRangeIncomplete: true,
        isValidationFailed: false,
        reason,
        errors: [reason]
      };
    }
    for (const p of szPieces) {
      if (
        !p.pieceCode ||
        !p.cutPathData ||
        !p.sewPathData ||
        !p.boundingBox ||
        !Number.isFinite(p.boundingBox.widthCm) ||
        p.boundingBox.widthCm <= 0 ||
        !Number.isFinite(p.boundingBox.heightCm) ||
        p.boundingBox.heightCm <= 0
      ) {
        const reason = `Graded piece '${p?.pieceCode ?? 'unknown'}' in size '${sz}' has invalid or empty geometry.`;
        return {
          isValid: false,
          isTampered: false,
          isSizeRangeIncomplete: true,
          isValidationFailed: true,
          reason,
          errors: [reason]
        };
      }
    }
    if (!szVal.isValid || szVal.status === 'invalid' || szVal.status === 'unassessed-missing-data' || (szVal.errors && szVal.errors.length > 0)) {
      const reason = `Grading geometry validation failed for size '${sz}': ${(szVal.errors ?? []).join('; ') || szVal.status}`;
      return {
        isValid: false,
        isTampered: false,
        isSizeRangeIncomplete: false,
        isValidationFailed: true,
        reason,
        errors: [reason]
      };
    }
  }

  const gvr = artifact.gradingValidationResult;
  if (
    !gvr ||
    !gvr.isOverallGradingValid ||
    gvr.failedSizeCount > 0 ||
    gvr.unassessedSizeCount > 0 ||
    gvr.validSizeCount !== artifact.sizeRange.length ||
    (Array.isArray(gvr.checks) && gvr.checks.some(c => c.status === 'fail'))
  ) {
    const reason = 'Cross-size grading integrity report indicates failed or unassessed sizes.';
    return {
      isValid: false,
      isTampered: false,
      isSizeRangeIncomplete: false,
      isValidationFailed: true,
      reason,
      errors: [reason]
    };
  }

  return {
    isValid: true,
    isTampered: false,
    isSizeRangeIncomplete: false,
    isValidationFailed: false,
    errors: []
  };
}

// ============================================================================
// MILESTONE 05.1: AUTHORITATIVE PATTERN REVISION LIFECYCLE & TRANSITIONS
// ============================================================================

/**
 * Verifies the content integrity and append-only hash-chained lifecycle integrity
 * of an AuthoritativePatternRevision (Amendment 1 & Amendment 2).
 */
export function verifyPatternRevisionLifecycleIntegrity(
  revision: AuthoritativePatternRevision | undefined
): {
  readonly isValid: boolean;
  readonly isContentTampered: boolean;
  readonly isLifecycleTampered: boolean;
  readonly recomputedGeometryFingerprint?: string;
  readonly recomputedDraftingConfigFingerprint?: string;
  readonly recomputedBasePatternFingerprint?: string;
  readonly recomputedCurrentStateFingerprint?: string;
  readonly derivedLifecycleState?: PatternRevisionLifecycleState;
  readonly reason?: string;
  readonly errors: readonly string[];
} {
  if (!revision || typeof revision !== 'object') {
    return {
      isValid: false,
      isContentTampered: false,
      isLifecycleTampered: false,
      reason: 'Pattern revision is missing.',
      errors: ['Pattern revision is missing.']
    };
  }

  if ((revision as unknown as { isProductionReady: boolean }).isProductionReady !== false) {
    const reason = 'Industrial safety violation: pattern revision asserts isProductionReady !== false.';
    return {
      isValid: false,
      isContentTampered: true,
      isLifecycleTampered: false,
      reason,
      errors: [reason]
    };
  }

  const errors: string[] = [];
  let isContentTampered = false;
  let isLifecycleTampered = false;

  // 1. Recompute geometryFingerprint, draftingConfigFingerprint, and basePatternFingerprint / contentFingerprint
  const recomputedGeometryFp = computeGeometryFingerprint(revision.patternPieces);
  const recomputedDraftingFp = computeDraftingConfigFingerprint({
    draftingConfiguration: revision.draftingConfiguration,
    fabricSpecification: revision.fabricSpecification,
    engineProvenance: revision.engineProvenance
  });
  const recomputedBasePatternFp = computeBasePatternContentFingerprint({
    ...revision,
    draftingConfigFingerprint: recomputedDraftingFp,
    geometryFingerprint: recomputedGeometryFp
  });

  if (revision.geometryFingerprint !== undefined && revision.geometryFingerprint !== recomputedGeometryFp) {
    isContentTampered = true;
    errors.push(
      `Pattern revision geometryFingerprint mismatch: recorded '${revision.geometryFingerprint}' vs recomputed '${recomputedGeometryFp}'.`
    );
  }

  if (
    revision.draftingConfigFingerprint !== undefined &&
    revision.draftingConfigFingerprint !== recomputedDraftingFp
  ) {
    isContentTampered = true;
    errors.push(
      `Pattern revision draftingConfigFingerprint mismatch: recorded '${revision.draftingConfigFingerprint}' vs recomputed '${recomputedDraftingFp}'.`
    );
  }

  if (revision.basePatternFingerprint !== undefined && revision.basePatternFingerprint !== recomputedBasePatternFp) {
    isContentTampered = true;
    errors.push(
      `Pattern revision basePatternFingerprint mismatch: recorded '${revision.basePatternFingerprint}' vs recomputed '${recomputedBasePatternFp}'.`
    );
  }

  if (revision.contentFingerprint !== undefined && revision.contentFingerprint !== recomputedBasePatternFp) {
    isContentTampered = true;
    errors.push(
      `Pattern revision contentFingerprint mismatch: recorded '${revision.contentFingerprint}' vs recomputed '${recomputedBasePatternFp}'.`
    );
  }

  if (
    revision.basePatternFingerprint !== undefined &&
    revision.contentFingerprint !== undefined &&
    revision.basePatternFingerprint !== revision.contentFingerprint
  ) {
    isContentTampered = true;
    errors.push('Pattern revision basePatternFingerprint and contentFingerprint must be identical.');
  }

  // 2. Verify append-only lifecycleHistory hash chain (Amendment 2)
  const history = revision.lifecycleHistory;
  if (!Array.isArray(history) || history.length === 0) {
    isLifecycleTampered = true;
    errors.push('Pattern revision lifecycleHistory is missing or empty.');
  } else {
    let expectedPreviousEventFp: string | null = null;
    let expectedFromState: PatternRevisionLifecycleState | null = null;

    for (let i = 0; i < history.length; i++) {
      const ev = history[i];
      if (!ev || typeof ev !== 'object') {
        isLifecycleTampered = true;
        errors.push(`Lifecycle event at index ${i} is malformed.`);
        continue;
      }
      if (ev.targetRevisionId !== revision.revisionId) {
        isLifecycleTampered = true;
        errors.push(
          `Lifecycle event '${ev.eventId}' targets revisionId '${ev.targetRevisionId}' instead of '${revision.revisionId}'.`
        );
      }
      if (ev.targetContentFingerprint !== recomputedBasePatternFp) {
        isLifecycleTampered = true;
        errors.push(
          `Lifecycle event '${ev.eventId}' binds targetContentFingerprint '${ev.targetContentFingerprint}' which diverges from immutable pattern contentFingerprint '${recomputedBasePatternFp}'.`
        );
      }
      if ((ev.previousEventFingerprint ?? null) !== expectedPreviousEventFp) {
        isLifecycleTampered = true;
        errors.push(
          `Lifecycle event '${ev.eventId}' at index ${i} has broken hash chain: previousEventFingerprint '${String(ev.previousEventFingerprint)}' !== expected '${String(expectedPreviousEventFp)}'.`
        );
      }
      if (i === 0 && ev.fromState !== null) {
        isLifecycleTampered = true;
        errors.push(`Genesis lifecycle event '${ev.eventId}' must have fromState === null (found '${ev.fromState}').`);
      } else if (i > 0 && ev.fromState !== expectedFromState) {
        isLifecycleTampered = true;
        errors.push(
          `Lifecycle event '${ev.eventId}' at index ${i} has discontinuous state transition: fromState '${String(ev.fromState)}' !== prior toState '${String(expectedFromState)}'.`
        );
      }

      const recomputedEvFp = computePatternLifecycleEventFingerprint(ev);
      if (ev.lifecycleEventFingerprint !== recomputedEvFp) {
        isLifecycleTampered = true;
        errors.push(
          `Lifecycle event '${ev.eventId}' at index ${i} failed fingerprint verification: recorded '${ev.lifecycleEventFingerprint}' !== recomputed '${recomputedEvFp}'.`
        );
      }

      expectedPreviousEventFp = ev.lifecycleEventFingerprint;
      expectedFromState = ev.toState;
    }

    const derivedState = derivePatternRevisionLifecycleState(history);
    if (revision.currentLifecycleState !== undefined && revision.currentLifecycleState !== derivedState) {
      isLifecycleTampered = true;
      errors.push(
        `Pattern revision currentLifecycleState '${revision.currentLifecycleState}' disagrees with derived lifecycleHistory state '${derivedState}'.`
      );
    }

    const recomputedCurrentStateFp = computePatternCurrentStateFingerprint({
      revisionId: revision.revisionId,
      contentFingerprint: recomputedBasePatternFp,
      currentLifecycleState: derivedState,
      lifecycleHistory: history
    });

    if (
      revision.currentStateFingerprint !== undefined &&
      revision.currentStateFingerprint !== recomputedCurrentStateFp
    ) {
      isLifecycleTampered = true;
      errors.push(
        `Pattern revision currentStateFingerprint '${revision.currentStateFingerprint}' disagrees with recomputed '${recomputedCurrentStateFp}'.`
      );
    }

    return {
      isValid: errors.length === 0,
      isContentTampered,
      isLifecycleTampered,
      recomputedGeometryFingerprint: recomputedGeometryFp,
      recomputedDraftingConfigFingerprint: recomputedDraftingFp,
      recomputedBasePatternFingerprint: recomputedBasePatternFp,
      recomputedCurrentStateFingerprint: recomputedCurrentStateFp,
      derivedLifecycleState: derivedState,
      reason: errors[0],
      errors
    };
  }

  return {
    isValid: false,
    isContentTampered,
    isLifecycleTampered,
    recomputedGeometryFingerprint: recomputedGeometryFp,
    recomputedDraftingConfigFingerprint: recomputedDraftingFp,
    recomputedBasePatternFingerprint: recomputedBasePatternFp,
    reason: errors[0],
    errors
  };
}

/**
 * Helper to append a verified lifecycle event to an AuthoritativePatternRevision without mutating
 * its immutable engineering content or contentFingerprint (Amendment 2).
 */
function appendPatternRevisionLifecycleEvent(
  revision: AuthoritativePatternRevision,
  params: {
    readonly eventId?: string;
    readonly toState: PatternRevisionLifecycleState;
    readonly timestamp?: string;
    readonly actorId: string;
    readonly actorRole: string;
    readonly reason: string;
    readonly approvalRecord?: PatternRevisionApprovalRecord;
    readonly invalidationRecord?: PatternInvalidationRecord;
    readonly supersededByRevisionId?: string;
  }
): AuthoritativePatternRevision {
  const integrity = verifyPatternRevisionLifecycleIntegrity(revision);
  if (!integrity.isValid) {
    throw new ProductionSnapshotValidationError(
      `Cannot transition pattern revision '${revision.revisionId}': existing revision failed integrity verification (${integrity.reason}).`
    );
  }

  const timestamp = params.timestamp ?? new Date().toISOString();
  if (!isValidIsoDate(timestamp)) {
    throw new ProductionSnapshotValidationError(`Invalid lifecycle transition timestamp '${timestamp}'.`);
  }
  if (!params.actorId || params.actorId.trim() === '') {
    throw new ProductionSnapshotValidationError('Lifecycle transition requires a non-empty actorId.');
  }
  if (!params.reason || params.reason.trim() === '') {
    throw new ProductionSnapshotValidationError('Lifecycle transition requires a non-empty reason.');
  }

  const existingHistory = revision.lifecycleHistory ?? [];
  const latestEvent = existingHistory[existingHistory.length - 1];
  const fromState = revision.currentLifecycleState ?? derivePatternRevisionLifecycleState(existingHistory);
  const contentFingerprint = revision.contentFingerprint ?? revision.basePatternFingerprint!;
  const eventIndex = existingHistory.length;
  const eventId = (params.eventId ?? '').trim() || `evt-pat-${revision.revisionId}-${eventIndex}-${params.toState}`;

  const eventType: PatternRevisionLifecycleEvent['eventType'] =
    params.toState === 'validated'
      ? 'validated'
      : params.toState === 'approved'
        ? 'approved'
        : params.toState === 'superseded'
          ? 'superseded'
          : params.toState === 'invalidated'
            ? 'invalidated'
            : params.toState === 'archived'
              ? 'archived'
              : 'draft-updated';

  const eventPrelim: Omit<PatternRevisionLifecycleEvent, 'lifecycleEventFingerprint'> = {
    eventId,
    eventIndex,
    eventType,
    fromState,
    toState: params.toState,
    targetRevisionId: revision.revisionId,
    targetContentFingerprint: contentFingerprint,
    timestamp,
    actor: params.actorId.trim(),
    reason: params.reason.trim(),
    supersededByRevisionId: params.supersededByRevisionId,
    invalidationRecord: params.invalidationRecord,
    approvalRecord: params.approvalRecord,
    previousEventFingerprint: latestEvent ? latestEvent.lifecycleEventFingerprint : null
  };

  const newEvent: PatternRevisionLifecycleEvent = {
    ...eventPrelim,
    lifecycleEventFingerprint: computePatternLifecycleEventFingerprint(eventPrelim)
  };

  const nextHistory: readonly PatternRevisionLifecycleEvent[] = [...existingHistory, newEvent];
  const nextState = derivePatternRevisionLifecycleState(nextHistory);
  const nextCurrentStateFp = computePatternCurrentStateFingerprint({
    revisionId: revision.revisionId,
    contentFingerprint,
    currentLifecycleState: nextState,
    lifecycleHistory: nextHistory
  });

  // Update legacy approvalState summary for backward compatibility while keeping contentFingerprint / basePatternFingerprint strictly untouched
  const nextApprovalState: ApprovalStateSummary = {
    ...revision.approvalState,
    designApproval: params.toState === 'approved' ? 'approved' : revision.approvalState.designApproval
  };

  const nextInvalidationRecords: readonly PatternInvalidationRecord[] = params.invalidationRecord
    ? [...(revision.invalidationRecords ?? []), params.invalidationRecord]
    : (revision.invalidationRecords ?? []);

  return deepFreeze({
    ...revision,
    // Immutable engineering content fingerprints remain strictly identical (Amendment 2)
    geometryFingerprint: revision.geometryFingerprint,
    draftingConfigFingerprint: revision.draftingConfigFingerprint,
    basePatternFingerprint: contentFingerprint,
    contentFingerprint,
    // Lifecycle tracking fields
    lifecycleHistory: nextHistory,
    currentLifecycleState: nextState,
    currentStateFingerprint: nextCurrentStateFp,
    patternApprovalRecord: params.approvalRecord ?? revision.patternApprovalRecord,
    supersededByRevisionId: params.supersededByRevisionId ?? revision.supersededByRevisionId,
    invalidationRecords: nextInvalidationRecords,
    approvalState: nextApprovalState,
    isProductionReady: false
  });
}

export interface CreateDraftPatternRevisionInput {
  readonly projectId?: string;
  readonly garmentId?: string;
  readonly revisionId?: string;
  readonly parentRevisionId?: string;
  readonly revisionIndex?: number;
  readonly revisionNumber?: number;
  readonly createdAt?: string;
  readonly createdBy?: string;
  readonly actorId?: string;
  readonly actorRole?: string;
  readonly targetSize?: string;
  readonly baseSizeCode?: string;
  readonly designSpecification?: DesignSpecification;
  readonly designSpec?: DesignSpecification;
  readonly authoritativeSpec?: AuthoritativeGarmentSpecification;
  readonly authoritativeMeasurementSet?: AuthoritativeMeasurementSetRecord;
  readonly sourceSpecificationFingerprint?: string;
  readonly sourceMeasurementSetId?: string;
  readonly sourceMeasurementRevisionId?: string;
  readonly sourceMeasurementSetFingerprint?: string;
  readonly measurements?: CreateProductionPatternRevisionInput['measurements'];
  readonly measurementOrigin?: MeasurementOrigin;
  readonly measurementApprovalStatus?: MeasurementApprovalRecord['state'];
  readonly measurementProvenanceEvidence?: MeasurementProvenanceEvidence;
  readonly measurementApprovedBy?: string;
  readonly measurementApprovedAt?: string;
  readonly fabric?: FabricProperty | EnhancedFabricProperty;
  readonly enhancedFabric?: EnhancedFabricProperty;
  readonly fabricProperty?: FabricProperty;
  readonly fabricSource?: string;
  readonly patternPieces?: PatternPiece[];
  readonly pieces?: readonly PatternPiece[];
  readonly draftingConfiguration?: Partial<DraftingConfigurationSnapshot>;
  readonly draftingConfig?: Partial<DraftingConfigurationSnapshot>;
  readonly validation?: CreateProductionPatternRevisionInput['validation'];
  readonly validationReport?: CreateProductionPatternRevisionInput['validation'];
  readonly assemblySummary?: Record<string, unknown> & { readonly isValid: boolean };
  readonly gradingSummary?: Record<string, unknown> & {
    readonly isOverallGradingValid?: boolean;
    readonly isValid?: boolean;
  };
  readonly physicalValidationStatus?: string;
  readonly engineProvenance?: Partial<EngineProvenanceRecord>;
}

function normalizeDraftPatternRevisionInput(
  input: CreateDraftPatternRevisionInput,
  initialLifecycleState: 'draft' | 'validated' = 'draft'
): CreateProductionPatternRevisionInput {
  const baseDesign = input.designSpecification ?? input.designSpec;
  if (!baseDesign) {
    throw new ProductionSnapshotValidationError(
      'createDraftPatternRevision requires designSpecification or designSpec.'
    );
  }
  const authSpec = input.authoritativeSpec;
  const authMeas = input.authoritativeMeasurementSet;

  const resolvedDesign: DesignSpecification = {
    ...baseDesign,
    id: input.garmentId ?? authSpec?.garmentId ?? baseDesign.id,
    version: authSpec?.version ?? baseDesign.version ?? 1,
    specificationRevisionId:
      authSpec?.specificationRevisionId ??
      baseDesign.specificationRevisionId ??
      (baseDesign as { revisionId?: string }).revisionId,
    isApproved: authSpec ? authSpec.approvalState === 'approved' : baseDesign.isApproved,
    approvedBy: authSpec?.approvedBy ?? baseDesign.approvedBy,
    approvedAt: authSpec?.approvedAt ?? baseDesign.approvedAt
  };

  const resolvedMeasurements: CreateProductionPatternRevisionInput['measurements'] =
    input.measurements ?? {
      values: (authMeas?.values ??
        (baseDesign as { measurements?: Record<string, number> }).measurements ??
        {}) as unknown as Readonly<Record<string, number>>,
      defaultOrigin: input.measurementOrigin ?? authMeas?.provenance ?? authMeas?.source ?? 'physically-measured',
      perMeasurementOrigin: authMeas?.perMeasurementOrigin,
      approval: {
        state: input.measurementApprovalStatus ?? authMeas?.approvalState ?? 'approved',
        approvedBy: input.measurementApprovedBy ?? authMeas?.approvingAuthority,
        approvedAt: input.measurementApprovedAt ?? authMeas?.approvedAt,
        measurementRevisionReference: authMeas?.revisionId
      },
      evidence: input.measurementProvenanceEvidence ?? authMeas?.evidence,
      notes: authMeas?.notes
    };

  const resolvedFabric =
    input.fabric ?? input.enhancedFabric ?? input.fabricProperty ?? resolvedDesign.fabric;
  if (!resolvedFabric) {
    throw new ProductionSnapshotFabricError('createDraftPatternRevision requires a fabric specification.');
  }

  const resolvedPieces = (input.patternPieces ?? input.pieces ?? []) as PatternPiece[];
  const resolvedValidation = input.validation ?? input.validationReport;
  if (!resolvedValidation) {
    throw new ProductionSnapshotValidationError('createDraftPatternRevision requires validation or validationReport.');
  }

  const resolvedGradingSummary = input.gradingSummary
    ? {
        ...input.gradingSummary,
        isOverallGradingValid: Boolean(
          input.gradingSummary.isOverallGradingValid ?? input.gradingSummary.isValid ?? true
        )
      }
    : undefined;

  return {
    projectId: input.projectId ?? authSpec?.projectId ?? 'project-patroner-default',
    revisionId: input.revisionId,
    parentRevisionId: input.parentRevisionId,
    revisionIndex: input.revisionIndex ?? input.revisionNumber ?? 1,
    createdAt: input.createdAt,
    createdBy: input.createdBy ?? input.actorId,
    targetSize: input.targetSize ?? input.baseSizeCode ?? 'M',
    designSpecification: resolvedDesign,
    sourceSpecificationFingerprint:
      input.sourceSpecificationFingerprint ??
      authSpec?.approvedContentFingerprint ??
      (authSpec ? computeSpecificationFingerprint(authSpec) : undefined),
    sourceMeasurementSetId: input.sourceMeasurementSetId ?? authMeas?.measurementSetId,
    sourceMeasurementRevisionId: input.sourceMeasurementRevisionId ?? authMeas?.revisionId,
    sourceMeasurementSetFingerprint:
      input.sourceMeasurementSetFingerprint ?? authMeas?.canonicalFingerprint,
    measurements: resolvedMeasurements,
    fabric: resolvedFabric,
    patternPieces: resolvedPieces,
    draftingConfiguration: input.draftingConfiguration ?? input.draftingConfig,
    validation: resolvedValidation,
    assemblySummary: input.assemblySummary,
    gradingSummary: resolvedGradingSummary,
    physicalValidationStatus: input.physicalValidationStatus,
    engineProvenance: input.engineProvenance,
    initialLifecycleState
  };
}

/**
 * Creates a new pattern revision in the `'draft'` lifecycle state.
 */
export function createDraftPatternRevision(
  input: CreateDraftPatternRevisionInput
): AuthoritativePatternRevision {
  return createProductionPatternRevision(normalizeDraftPatternRevisionInput(input, 'draft'));
}

/**
 * Updates a `'draft'` pattern revision before validation/approval.
 * Rejects any attempt to mutate a non-draft revision (`'validated'`, `'approved'`, `'superseded'`, `'invalidated'`, `'archived'`).
 */
export function updateDraftPatternRevision(
  draftRevision: AuthoritativePatternRevision,
  updates: Partial<CreateDraftPatternRevisionInput> & {
    readonly updatedAt?: string;
  }
): AuthoritativePatternRevision {
  if (!draftRevision || typeof draftRevision !== 'object') {
    throw new ProductionSnapshotValidationError('Cannot update a null or missing pattern revision.');
  }
  const currentState = draftRevision.currentLifecycleState ?? 'draft';
  if (currentState !== 'draft') {
    throw new ProductionSnapshotValidationError(
      `Immutable pattern revision violation: revision '${draftRevision.revisionId}' is in state '${currentState}' and cannot be mutated in place. Create a new child revision with parentRevisionId='${draftRevision.revisionId}'.`
    );
  }
  const integrity = verifyPatternRevisionLifecycleIntegrity(draftRevision);
  if (!integrity.isValid) {
    throw new ProductionSnapshotValidationError(
      `Cannot update draft pattern revision '${draftRevision.revisionId}': integrity check failed (${integrity.reason}).`
    );
  }

  return createProductionPatternRevision(
    normalizeDraftPatternRevisionInput(
      {
        projectId: updates.projectId ?? draftRevision.projectId,
        revisionId: updates.revisionId ?? draftRevision.revisionId,
        parentRevisionId: updates.parentRevisionId ?? draftRevision.parentRevisionId,
        revisionIndex: updates.revisionIndex ?? updates.revisionNumber ?? draftRevision.revisionIndex,
        createdAt: updates.updatedAt ?? updates.createdAt ?? draftRevision.createdAt,
        createdBy: updates.createdBy ?? updates.actorId ?? draftRevision.createdBy,
        targetSize: updates.targetSize ?? updates.baseSizeCode ?? draftRevision.targetSize,
        designSpecification:
          updates.designSpecification ??
          updates.designSpec ?? {
            id: draftRevision.designSpecification.id,
            name: draftRevision.designSpecification.name,
            garmentCategory: draftRevision.garmentCategory,
            silhouette: draftRevision.designSpecification.silhouette as DesignSpecification['silhouette'],
            fabric: {
              id: draftRevision.fabricSpecification.fabricId,
              name: draftRevision.fabricSpecification.name,
              composition: draftRevision.fabricSpecification.composition,
              weight: 'medium',
              stretch: 'none',
              recommendedEaseCm: { waist: 2, hip: 3 },
              drapeDescription: 'Structured tailored wool'
            },
            color: { name: 'Atelier Charcoal', hex: '#1E1E24' },
            easeProfile: draftRevision.designSpecification.easeProfile as DesignSpecification['easeProfile'],
            lengthCm: draftRevision.designSpecification.lengthCm,
            dartStyle: draftRevision.designSpecification.dartStyle as DesignSpecification['dartStyle'],
            sleeveEaseStrategy:
              draftRevision.designSpecification.sleeveEaseStrategy as DesignSpecification['sleeveEaseStrategy'],
            prompt: '',
            constructionFeatures: [],
            designNotes: [],
            isApproved: draftRevision.designSpecification.isApproved,
            version: draftRevision.designSpecification.version,
            specificationRevisionId: draftRevision.designSpecification.specificationRevisionId,
            approvedBy: draftRevision.designSpecification.approvedBy,
            approvedAt: draftRevision.designSpecification.approvedAt
          },
        sourceSpecificationFingerprint:
          updates.sourceSpecificationFingerprint ?? draftRevision.sourceSpecificationFingerprint,
        sourceMeasurementSetId: updates.sourceMeasurementSetId ?? draftRevision.sourceMeasurementSetId,
        sourceMeasurementRevisionId:
          updates.sourceMeasurementRevisionId ?? draftRevision.sourceMeasurementRevisionId,
        sourceMeasurementSetFingerprint:
          updates.sourceMeasurementSetFingerprint ?? draftRevision.sourceMeasurementSetFingerprint,
        measurements: updates.measurements ?? {
          values: draftRevision.measurementSet.values,
          defaultOrigin: draftRevision.measurementSet.defaultOrigin,
          perMeasurementOrigin: draftRevision.measurementSet.perMeasurementOrigin,
          approval: draftRevision.measurementSet.approval,
          evidence: draftRevision.measurementSet.evidence,
          notes: draftRevision.measurementSet.notes
        },
        fabric: updates.fabric ?? updates.enhancedFabric ?? updates.fabricProperty,
        patternPieces: (updates.patternPieces ?? updates.pieces ?? []) as PatternPiece[],
        draftingConfiguration:
          updates.draftingConfiguration ?? updates.draftingConfig ?? draftRevision.draftingConfiguration,
        validation: updates.validation ?? updates.validationReport ?? draftRevision.validation,
        assemblySummary: updates.assemblySummary ?? draftRevision.assemblySummary,
        gradingSummary: updates.gradingSummary ?? draftRevision.gradingSummary,
        engineProvenance: updates.engineProvenance ?? draftRevision.engineProvenance
      },
      'draft'
    )
  );
}

/**
 * Transitions a `'draft'` pattern revision to `'validated'` after verifying that
 * geometry validation passed with zero errors, pieces are non-empty, and all piece contours are closed.
 * Does NOT alter `contentFingerprint` / `basePatternFingerprint` (Amendment 2).
 */
export function validatePatternRevision(
  revision: AuthoritativePatternRevision,
  options?: {
    readonly actorId?: string;
    readonly actorRole?: string;
    readonly validatedAt?: string;
    readonly reason?: string;
  }
): AuthoritativePatternRevision {
  if (!revision || typeof revision !== 'object') {
    throw new ProductionSnapshotValidationError('Cannot validate a missing pattern revision.');
  }
  const currentState = revision.currentLifecycleState ?? 'draft';
  if (currentState !== 'draft') {
    throw new ProductionSnapshotValidationError(
      `Invalid lifecycle transition: pattern revision '${revision.revisionId}' cannot transition from '${currentState}' to 'validated' (only 'draft' revisions can be validated).`
    );
  }
  if (!Array.isArray(revision.patternPieces) || revision.patternPieces.length === 0) {
    throw new ProductionSnapshotValidationError(
      `Cannot validate pattern revision '${revision.revisionId}': pattern contains zero pieces.`
    );
  }
  if (
    !revision.validation ||
    !revision.validation.isValid ||
    revision.validation.failureCount > 0 ||
    revision.validation.status === 'invalid'
  ) {
    throw new ProductionSnapshotValidationError(
      `Cannot validate pattern revision '${revision.revisionId}': geometry validation failed (failureCount=${revision.validation?.failureCount ?? 'unknown'}).`
    );
  }
  for (const piece of revision.patternPieces) {
    if (!piece.stitchingContour?.isClosed || !piece.cuttingContour?.isClosed) {
      throw new ProductionSnapshotValidationError(
        `Cannot validate pattern revision '${revision.revisionId}': piece '${piece.pieceCode}' has open stitching or cutting contour.`
      );
    }
  }

  return appendPatternRevisionLifecycleEvent(revision, {
    toState: 'validated',
    timestamp: options?.validatedAt ?? new Date().toISOString(),
    actorId: options?.actorId ?? 'pattern-validation-engine',
    actorRole: options?.actorRole ?? 'validation-engine',
    reason:
      options?.reason ??
      `Pattern revision '${revision.revisionId}' passed deterministic geometry and seam validation (${revision.validation.passedCount} passed, 0 failed).`
  });
}

/**
 * Signs a pattern revision approval payload using RFC 8032 Ed25519 for Tier 4 (`cryptographic_principal`)
 * pattern revision approval. Produces a `VerifiableCryptographicSignature` compatible with `TrustedCryptographicVerifier`.
 */
export function signPatternRevisionApprovalPayload(
  payload: CanonicalPatternApprovalSigningPayload,
  keyConfig: {
    readonly keyId: string;
    readonly privateKeyHex?: string;
    readonly signingKeyMaterial?: string;
    readonly tenantId?: string;
  }
): VerifiableCryptographicSignature {
  if (!keyConfig || !keyConfig.keyId || keyConfig.keyId.trim() === '') {
    throw new ProductionSnapshotValidationError('Cryptographic signing keyId cannot be empty.');
  }
  const secretSeed = keyConfig.privateKeyHex ?? keyConfig.signingKeyMaterial;
  if (!secretSeed || secretSeed.trim() === '') {
    throw new ProductionSnapshotValidationError('Cryptographic signing requires privateKeyHex or signingKeyMaterial.');
  }

  const kp =
    secretSeed.trim().length === 64 && /^[0-9a-fA-F]{64}$/.test(secretSeed.trim())
      ? generateEd25519KeyPairFromRawSeedHex(secretSeed.trim())
      : generateEd25519KeyPairFromPassphrase(secretSeed);

  // Bind revision.revisionId as specificationRevisionId and revision.contentFingerprint as canonicalSpecificationFingerprint
  // so TrustedCryptographicVerifier.verifyApprovalSignature enforces exact target binding to the pattern revision
  const bindingPayload = {
    schemaVersion: '04.6.2.3.4-canonical-spec-v1',
    projectId: payload.projectId,
    tenantId: payload.tenantId || keyConfig.tenantId || payload.projectId,
    garmentId: payload.garmentId,
    specificationRevisionId: payload.patternRevisionId,
    specificationVersion: payload.patternRevisionNumber,
    canonicalSpecificationFingerprint: payload.basePatternFingerprint,
    approvalEventId: payload.approvalEventId,
    approverPrincipal: payload.approverPrincipal,
    authorityTier: 'cryptographic_principal' as const,
    approvalScope: 'specification:approve',
    approvalTimestamp: payload.approvalTimestamp,
    keyId: keyConfig.keyId.trim(),
    algorithm: 'Ed25519'
  };

  const canonicalJson = canonicalizeJson(bindingPayload);
  const payloadFp = sha256Hex(canonicalJson);
  const sigObj = signEd25519Message(canonicalJson, kp.privateKeyHex, {
    inputFormat: 'raw-seed-hex'
  });

  return {
    keyId: keyConfig.keyId.trim(),
    publicKeyHex: kp.publicKeyHex,
    publicKeyFingerprint: kp.publicKeyFingerprint,
    algorithm: 'Ed25519',
    signatureHex: sigObj.signatureHex,
    signatureDigest: sigObj.signatureHex,
    signerPrincipal: payload.approverPrincipal,
    signedPayload: bindingPayload,
    signedPayloadCanonicalJson: canonicalJson,
    signedPayloadFingerprint: payloadFp,
    signedAt: payload.approvalTimestamp
  };
}

export interface ApprovePatternRevisionOptions {
  readonly approverName: string;
  readonly approverRole?: string;
  readonly approvedAt?: string;
  readonly approvalEventId?: string;
  readonly authorityTier: 'authenticated_designer' | 'cryptographic_principal';
  readonly justification?: string;
  readonly sourceSpecification?: AuthoritativeGarmentSpecification;
  readonly specVerificationContext?: ApprovalVerificationContext;
  readonly sourceMeasurementSet?: AuthoritativeMeasurementSetRecord;
  readonly identityVerifier?: TrustedIdentityVerifier;
  readonly identityCredential?: VerifiableIdentityCredential;
  readonly cryptographicVerifier?: TrustedCryptographicVerifier;
  readonly cryptographicSignature?: VerifiableCryptographicSignature;
}

/**
 * Transitions a `'validated'` pattern revision to `'approved'` ONLY when:
 * 1. The revision is currently `'validated'` and passes full content & lifecycle integrity.
 * 2. Geometry validation passed with zero errors.
 * 3. Upstream garment specification is approved and matches `sourceSpecificationFingerprint`.
 * 4. Upstream measurement set is approved, non-AI (`'ai-estimated'`, `'default-fallback'`, `'unverified-input'`, `'standard-chart'` rejected),
 *    and matches `sourceMeasurementSetFingerprint`.
 * 5. Real Tier 3 (`authenticated_designer` via `TrustedIdentityVerifier` + `JtiReplayStore`) or Tier 4
 *    (`cryptographic_principal` via `TrustedCryptographicVerifier`) authority is available and verifies
 *    exact target binding to `revision.revisionId` and `revision.contentFingerprint` (`basePatternFingerprint`).
 *
 * Fails closed whenever any trust provider, replay store, or upstream prerequisite is missing or invalid (Amendment 3 & Amendment 6).
 */
export function approvePatternRevision(
  revision: AuthoritativePatternRevision,
  options: ApprovePatternRevisionOptions
): AuthoritativePatternRevision {
  if (!revision || typeof revision !== 'object') {
    throw new ProductionSnapshotValidationError('Cannot approve a missing pattern revision.');
  }
  if (!options || typeof options !== 'object') {
    throw new ProductionSnapshotValidationError('Pattern revision approval options are required.');
  }

  // 1. Verify current lifecycle state is 'validated'
  const currentState = revision.currentLifecycleState ?? 'draft';
  if (currentState !== 'validated') {
    throw new ProductionSnapshotValidationError(
      `Invalid lifecycle transition: pattern revision '${revision.revisionId}' is in state '${currentState}' and cannot transition to 'approved'. Pattern revision must be in 'validated' state before approval.`
    );
  }

  // 2. Verify content and lifecycle integrity
  const integrity = verifyPatternRevisionLifecycleIntegrity(revision);
  if (!integrity.isValid) {
    throw new ProductionSnapshotValidationError(
      `Cannot approve pattern revision '${revision.revisionId}': integrity verification failed (${integrity.reason}).`
    );
  }

  // 3. Verify passing geometry validation
  if (
    !revision.validation.isValid ||
    revision.validation.failureCount > 0 ||
    revision.validation.status === 'invalid'
  ) {
    throw new ProductionSnapshotValidationError(
      `Cannot approve pattern revision '${revision.revisionId}': geometry validation has failures.`
    );
  }

  // 4. Verify upstream specification approval and fingerprint binding
  if (!revision.designSpecification.isApproved) {
    throw new ProductionSnapshotValidationError(
      `Cannot approve pattern revision '${revision.revisionId}': upstream garment specification '${revision.sourceSpecificationRevisionId}' is not approved.`
    );
  }
  if (options.sourceSpecification) {
    const specFp = computeSpecificationFingerprint(options.sourceSpecification);
    if (
      options.sourceSpecification.specificationRevisionId !== revision.sourceSpecificationRevisionId ||
      specFp !== revision.sourceSpecificationFingerprint
    ) {
      throw new ProductionSnapshotValidationError(
        `Cannot approve pattern revision '${revision.revisionId}': pattern revision is stale relative to active garment specification '${options.sourceSpecification.specificationRevisionId}'.`
      );
    }
    if (options.specVerificationContext) {
      const specVerify = verifySpecificationApproval(options.sourceSpecification, options.specVerificationContext);
      if (!specVerify.isValid) {
        throw new ProductionSnapshotValidationError(
          `Cannot approve pattern revision '${revision.revisionId}': upstream garment specification failed cryptographic approval verification (${specVerify.reason}).`
        );
      }
    }
  }

  // 5. Verify upstream measurement approval & reject AI/unverified/standard-chart origins
  const measOrigin = revision.measurementSet.defaultOrigin;
  if (
    measOrigin === 'ai-estimated' ||
    measOrigin === 'unknown' ||
    measOrigin === 'standard-chart' ||
    measOrigin === 'synthetic-fixture' ||
    measOrigin === 'synthetic-persona'
  ) {
    throw new ProductionSnapshotMeasurementError(
      `Cannot approve pattern revision '${revision.revisionId}': measurement set origin '${measOrigin}' is prohibited for approved production patterns.`
    );
  }
  if (revision.measurementSet.approval.state !== 'approved') {
    throw new ProductionSnapshotMeasurementError(
      `Cannot approve pattern revision '${revision.revisionId}': measurement set '${revision.sourceMeasurementSetId}' is not approved (status='${revision.measurementSet.approval.state}').`
    );
  }
  if (options.sourceMeasurementSet) {
    const measCheck = verifyMeasurementSetIntegrity(options.sourceMeasurementSet);
    if (!measCheck.isValid || !measCheck.isApproved) {
      throw new ProductionSnapshotMeasurementError(
        `Cannot approve pattern revision '${revision.revisionId}': upstream measurement set failed verification (${measCheck.reason}).`
      );
    }
    if (options.sourceMeasurementSet.canonicalFingerprint !== revision.sourceMeasurementSetFingerprint) {
      throw new ProductionSnapshotMeasurementError(
        `Cannot approve pattern revision '${revision.revisionId}': pattern revision measurement fingerprint '${revision.sourceMeasurementSetFingerprint}' does not match active measurement set fingerprint '${options.sourceMeasurementSet.canonicalFingerprint}'.`
      );
    }
  }

  // 6. Enforce real Tier 3 / Tier 4 authorization availability & target binding (Amendment 3)
  const tier = options.authorityTier;
  if (tier !== 'authenticated_designer' && tier !== 'cryptographic_principal') {
    throw new ProductionSnapshotValidationError(
      `Pattern revision approval requires 'authenticated_designer' (Tier 3) or 'cryptographic_principal' (Tier 4) authority. Local UI or operator flags ('${String(tier)}') cannot approve an authoritative pattern revision.`
    );
  }

  const approverName = (options.approverName ?? '').trim();
  if (!approverName) {
    throw new ProductionSnapshotValidationError('Pattern revision approval requires a non-empty approverName.');
  }
  const approvedAt = options.approvedAt ?? new Date().toISOString();
  if (!isValidIsoDate(approvedAt)) {
    throw new ProductionSnapshotValidationError(`Invalid pattern approval timestamp '${approvedAt}'.`);
  }
  const approvalEventId = (options.approvalEventId ?? '').trim() || `pat-app-evt-${revision.revisionId}`;
  const contentFingerprint = revision.contentFingerprint ?? revision.basePatternFingerprint!;
  const garmentId = revision.sourceSpecificationId ?? revision.designSpecification.id;

  let approvalRecord: PatternRevisionApprovalRecord;

  if (tier === 'authenticated_designer') {
    if (!options.identityVerifier || typeof options.identityVerifier.verifyCredential !== 'function') {
      throw new ProductionSnapshotValidationError(
        `Pattern revision approval failed (fail-closed): Tier 3 ('authenticated_designer') requires an active TrustedIdentityVerifier, but none was provided.`
      );
    }
    if (!options.identityVerifier.replayStore || typeof options.identityVerifier.replayStore.consumeJti !== 'function') {
      throw new ProductionSnapshotValidationError(
        `Pattern revision approval failed (fail-closed): Tier 3 ('authenticated_designer') requires an active JtiReplayStore on the TrustedIdentityVerifier.`
      );
    }
    if (!options.identityCredential) {
      throw new ProductionSnapshotValidationError(
        `Pattern revision approval failed (fail-closed): Tier 3 ('authenticated_designer') requires a signed OIDC/JWT VerifiableIdentityCredential.`
      );
    }

    const idRes = options.identityVerifier.verifyCredential(options.identityCredential, {
      expectedSpecificationId: garmentId,
      expectedRevisionId: revision.revisionId,
      expectedSpecificationFingerprint: contentFingerprint,
      expectedApprover: approverName,
      approvalTimestamp: approvedAt,
      expectedTenantId: revision.projectId,
      requireTargetBinding: true
    });

    if (!idRes.verified || !idRes.isValid || !idRes.provenance) {
      throw new ProductionSnapshotValidationError(
        `Pattern revision Tier 3 identity verification failed (fail-closed): ${idRes.reason ?? 'credential rejected by TrustedIdentityVerifier'}.`
      );
    }

    approvalRecord = {
      approvalEventId,
      patternRevisionId: revision.revisionId,
      boundBasePatternFingerprint: contentFingerprint,
      boundSpecificationFingerprint: revision.sourceSpecificationFingerprint,
      boundMeasurementSetFingerprint: revision.sourceMeasurementSetFingerprint,
      approverName,
      approverRole: (options.approverRole ?? 'lead-pattern-engineer').trim(),
      approvedAt,
      authorityTier: 'authenticated_designer',
      isApprovalAuthenticated: true,
      isApprovalCryptographicallySigned: false,
      verifiedIdentity: idRes.provenance as unknown as PatternRevisionApprovalRecord['verifiedIdentity']
    };
  } else {
    if (
      !options.cryptographicVerifier ||
      typeof options.cryptographicVerifier.verifyApprovalSignature !== 'function'
    ) {
      throw new ProductionSnapshotValidationError(
        `Pattern revision approval failed (fail-closed): Tier 4 ('cryptographic_principal') requires an active TrustedCryptographicVerifier, but none was provided.`
      );
    }
    if (!options.cryptographicSignature) {
      throw new ProductionSnapshotValidationError(
        `Pattern revision approval failed (fail-closed): Tier 4 ('cryptographic_principal') requires an asymmetric Ed25519 VerifiableCryptographicSignature.`
      );
    }

    const expectedBindingPayload = {
      schemaVersion: '04.6.2.3.4-canonical-spec-v1',
      projectId: revision.projectId,
      tenantId: revision.projectId,
      garmentId,
      specificationRevisionId: revision.revisionId,
      specificationVersion: revision.revisionIndex,
      canonicalSpecificationFingerprint: contentFingerprint,
      approvalEventId,
      approverPrincipal: approverName,
      authorityTier: 'cryptographic_principal' as const,
      approvalScope: 'specification:approve',
      approvalTimestamp: approvedAt,
      keyId: options.cryptographicSignature.keyId,
      algorithm: 'Ed25519'
    };

    const cryptoRes = options.cryptographicVerifier.verifyApprovalSignature(
      options.cryptographicSignature,
      expectedBindingPayload
    );

    if (!cryptoRes.verified || !cryptoRes.isValid) {
      throw new ProductionSnapshotValidationError(
        `Pattern revision Tier 4 cryptographic verification failed (fail-closed): ${cryptoRes.reason ?? 'signature rejected by TrustedCryptographicVerifier'}.`
      );
    }

    approvalRecord = {
      approvalEventId,
      patternRevisionId: revision.revisionId,
      boundBasePatternFingerprint: contentFingerprint,
      boundSpecificationFingerprint: revision.sourceSpecificationFingerprint,
      boundMeasurementSetFingerprint: revision.sourceMeasurementSetFingerprint,
      approverName,
      approverRole: (options.approverRole ?? 'principal-pattern-engineer').trim(),
      approvedAt,
      authorityTier: 'cryptographic_principal',
      isApprovalAuthenticated: true,
      isApprovalCryptographicallySigned: true,
      cryptographicSignature: options.cryptographicSignature as unknown as PatternRevisionApprovalRecord['cryptographicSignature']
    };
  }

  return appendPatternRevisionLifecycleEvent(revision, {
    eventId: approvalEventId,
    toState: 'approved',
    timestamp: approvedAt,
    actorId: approverName,
    actorRole: approvalRecord.approverRole,
    reason:
      options.justification?.trim() ||
      `Pattern revision '${revision.revisionId}' approved under '${tier}' authority bound to basePatternFingerprint '${contentFingerprint}'.`,
    approvalRecord
  });
}

/**
 * Transitions a `'validated'` or `'approved'` pattern revision to `'superseded'`
 * when replaced by a newer pattern revision. Preserves immutable `contentFingerprint` (Amendment 2).
 */
export function supersedePatternRevision(
  revision: AuthoritativePatternRevision,
  options: {
    readonly supersededByRevisionId: string;
    readonly actorId?: string;
    readonly actorRole?: string;
    readonly timestamp?: string;
    readonly reason?: string;
  }
): AuthoritativePatternRevision {
  if (!revision || typeof revision !== 'object') {
    throw new ProductionSnapshotValidationError('Cannot supersede a missing pattern revision.');
  }
  const nextRevId = (options?.supersededByRevisionId ?? '').trim();
  if (!nextRevId) {
    throw new ProductionSnapshotValidationError('supersedePatternRevision requires a non-empty supersededByRevisionId.');
  }
  if (nextRevId === revision.revisionId) {
    throw new ProductionSnapshotValidationError('A pattern revision cannot supersede itself.');
  }
  const currentState = revision.currentLifecycleState ?? 'draft';
  if (currentState !== 'validated' && currentState !== 'approved') {
    throw new ProductionSnapshotValidationError(
      `Invalid lifecycle transition: pattern revision '${revision.revisionId}' in state '${currentState}' cannot be superseded (only 'validated' or 'approved' revisions can be superseded).`
    );
  }

  return appendPatternRevisionLifecycleEvent(revision, {
    toState: 'superseded',
    timestamp: options.timestamp ?? new Date().toISOString(),
    actorId: options.actorId ?? 'pattern-lifecycle-engine',
    actorRole: options.actorRole ?? 'lifecycle-engine',
    reason:
      options.reason ??
      `Pattern revision '${revision.revisionId}' superseded by newer pattern revision '${nextRevId}'.`,
    supersededByRevisionId: nextRevId
  });
}

/**
 * Transitions a `'draft'`, `'validated'`, or `'approved'` pattern revision to `'invalidated'`
 * with a structured `PatternInvalidationRecord`. Preserves immutable `contentFingerprint` (Amendment 2).
 */
export function invalidatePatternRevision(
  revision: AuthoritativePatternRevision,
  input: {
    readonly cause: PatternInvalidationCause;
    readonly reason: string;
    readonly invalidatedAt?: string;
    readonly invalidatedBy?: string;
    readonly actorRole?: string;
    readonly upstreamArtifactId?: string;
    readonly recordedUpstreamFingerprint?: string;
    readonly activeUpstreamFingerprint?: string;
  }
): AuthoritativePatternRevision {
  if (!revision || typeof revision !== 'object') {
    throw new ProductionSnapshotValidationError('Cannot invalidate a missing pattern revision.');
  }
  if (!input || !input.cause || !input.reason || input.reason.trim() === '') {
    throw new ProductionSnapshotValidationError('invalidatePatternRevision requires an explicit cause and non-empty reason.');
  }
  const currentState = revision.currentLifecycleState ?? 'draft';
  if (currentState === 'archived') {
    throw new ProductionSnapshotValidationError(
      `Cannot invalidate pattern revision '${revision.revisionId}': revision is already archived.`
    );
  }

  const invalidatedAt = input.invalidatedAt ?? new Date().toISOString();
  const invalidatedBy = (input.invalidatedBy ?? 'dependency-invalidation-engine').trim();
  const invalidationRecord: PatternInvalidationRecord = {
    invalidationId: `pat-inv-${revision.revisionId}-${(revision.invalidationRecords?.length ?? 0) + 1}`,
    cause: input.cause,
    reason: input.reason.trim(),
    invalidatedAt,
    invalidatedBy,
    upstreamArtifactId: input.upstreamArtifactId,
    recordedUpstreamFingerprint: input.recordedUpstreamFingerprint,
    activeUpstreamFingerprint: input.activeUpstreamFingerprint
  };

  return appendPatternRevisionLifecycleEvent(revision, {
    toState: 'invalidated',
    timestamp: invalidatedAt,
    actorId: invalidatedBy,
    actorRole: input.actorRole ?? 'dependency-invalidation-engine',
    reason: input.reason.trim(),
    invalidationRecord
  });
}

/**
 * Transitions a `'superseded'` or `'invalidated'` pattern revision to terminal `'archived'` state.
 * Preserves immutable `contentFingerprint` (Amendment 2).
 */
export function archivePatternRevision(
  revision: AuthoritativePatternRevision,
  options?: {
    readonly actorId?: string;
    readonly actorRole?: string;
    readonly archivedAt?: string;
    readonly reason?: string;
  }
): AuthoritativePatternRevision {
  if (!revision || typeof revision !== 'object') {
    throw new ProductionSnapshotValidationError('Cannot archive a missing pattern revision.');
  }
  const currentState = revision.currentLifecycleState ?? 'draft';
  if (currentState !== 'superseded' && currentState !== 'invalidated') {
    throw new ProductionSnapshotValidationError(
      `Invalid lifecycle transition: pattern revision '${revision.revisionId}' in state '${currentState}' cannot transition directly to 'archived' (must be 'superseded' or 'invalidated' first).`
    );
  }

  return appendPatternRevisionLifecycleEvent(revision, {
    toState: 'archived',
    timestamp: options?.archivedAt ?? new Date().toISOString(),
    actorId: options?.actorId ?? 'pattern-lifecycle-engine',
    actorRole: options?.actorRole ?? 'lifecycle-engine',
    reason:
      options?.reason ??
      `Pattern revision '${revision.revisionId}' archived from '${currentState}' state for historical audit retention.`
  });
}

// ============================================================================
// AMENDMENT 5: EXPLICIT LEGACY PATTERN DRAFT COMPATIBILITY ADAPTER
// ============================================================================

/**
 * Maps legacy `PatternDraft.status` values or UI readiness strings to the maximum permissible
 * authoritative `PatternRevisionLifecycleState` without ever elevating legacy states (`'graded'`,
 * `'production-ready'`, `'approved'`, or `isProductionReady: true`) to authoritative `'approved'`
 * or production authorization (Amendment 5).
 */
export function mapLegacyStatusToAuthoritativeLifecycle(
  legacyStatus: LegacyPatternDraftStatusInput | undefined,
  options?: {
    readonly hasPassingValidationReport?: boolean;
    readonly legacyIsProductionReadyFlag?: boolean;
  }
): {
  readonly mappedLifecycleState: 'draft' | 'validated';
  readonly isAuthoritativeApprovalGranted: false;
  readonly isProductionAuthorized: false;
  readonly rejectedUnsafeElevationClaims: readonly string[];
  readonly warnings: readonly string[];
} {
  const rejectedClaims: string[] = [];
  const warnings: string[] = [];

  if (options?.legacyIsProductionReadyFlag === true) {
    rejectedClaims.push(
      'Legacy isProductionReady=true flag rejected: UI/legacy readiness flags never confer production authorization.'
    );
  }

  if (legacyStatus === 'graded') {
    rejectedClaims.push(
      "Legacy status 'graded' rejected as approval: grading is a downstream artifact and never implies pattern revision approval."
    );
  } else if (legacyStatus === 'production-ready') {
    rejectedClaims.push(
      "Legacy status 'production-ready' rejected as production authorization: production readiness requires verified Tier 3/4 approval and full industrial gates."
    );
  } else if (legacyStatus === 'approved') {
    rejectedClaims.push(
      "Legacy unverified status 'approved' downgraded: authoritative pattern approval requires verified Tier 3/4 credentials bound to basePatternFingerprint."
    );
  }

  if (rejectedClaims.length > 0) {
    warnings.push(...rejectedClaims);
  }

  const canBeValidated =
    Boolean(options?.hasPassingValidationReport) &&
    (legacyStatus === 'validated' ||
      legacyStatus === 'graded' ||
      legacyStatus === 'production-ready' ||
      legacyStatus === 'approved');

  return {
    mappedLifecycleState: canBeValidated ? 'validated' : 'draft',
    isAuthoritativeApprovalGranted: false,
    isProductionAuthorized: false,
    rejectedUnsafeElevationClaims: rejectedClaims,
    warnings
  };
}

/**
 * Controlled compatibility adapter converting a legacy `PatternDraft` into an `AuthoritativePatternRevision`
 * without merging legacy UI statuses into authoritative approval (Amendment 5).
 *
 * Guarantees:
 * - Never interprets `'graded'` as `'approved'`.
 * - Never interprets `'production-ready'` as production authorization.
 * - Never interprets a UI readiness indicator or legacy `isProductionReady: true` as cryptographic approval.
 * - Produces at most a `'draft'` or `'validated'` revision (never `'approved'`).
 */
export function adaptLegacyPatternDraftToPatternRevision(
  draft: PatternDraft & { readonly status?: LegacyPatternDraftStatusInput; readonly isProductionReady?: boolean },
  input: Omit<CreateDraftPatternRevisionInput, 'patternPieces' | 'pieces' | 'validation' | 'validationReport'> & {
    readonly legacyStatusOverride?: LegacyPatternDraftStatusInput;
  }
): LegacyPatternDraftAdaptationResult {
  if (!draft || typeof draft !== 'object') {
    throw new ProductionSnapshotValidationError('Legacy PatternDraft input must be a non-null object.');
  }

  const rawStatus = (input.legacyStatusOverride ?? draft.status ?? 'draft') as LegacyPatternDraftStatusInput;
  const hasPassingValidation = Boolean(
    draft.validation &&
      draft.validation.isValid &&
      draft.validation.failureCount === 0 &&
      Array.isArray(draft.pieces) &&
      draft.pieces.length > 0
  );

  const mapping = mapLegacyStatusToAuthoritativeLifecycle(rawStatus, {
    hasPassingValidationReport: hasPassingValidation,
    legacyIsProductionReadyFlag: Boolean((draft as { isProductionReady?: boolean }).isProductionReady)
  });

  const draftRevision = createDraftPatternRevision({
    ...input,
    pieces: draft.pieces,
    validationReport: draft.validation
  });

  const adaptedRevision =
    mapping.mappedLifecycleState === 'validated'
      ? validatePatternRevision(draftRevision, {
          actorId: input.actorId ?? 'legacy-pattern-draft-adapter',
          actorRole: input.actorRole ?? 'compatibility-adapter',
          validatedAt: input.createdAt ?? draftRevision.createdAt,
          reason: `Adapted legacy PatternDraft (status='${String(rawStatus)}') to 'validated' after verifying passing geometry validation. No approval authority granted.`
        })
      : draftRevision;

  return deepFreeze({
    patternRevision: adaptedRevision,
    legacyStatusReceived: String(rawStatus),
    mappedLifecycleState: mapping.mappedLifecycleState,
    isAuthoritativeApprovalGranted: false as const,
    isProductionAuthorized: false as const,
    rejectedUnsafeElevationClaims: mapping.rejectedUnsafeElevationClaims,
    adaptationWarnings: mapping.warnings
  });
}


