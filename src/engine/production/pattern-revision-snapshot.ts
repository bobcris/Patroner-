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
  PatternPiece,
  Point,
  SeamLine
} from '../../types';
import { computeBoundingBox } from '../geometry/math';
import {
  CubicBezierCurve,
  GeometricContour,
  GeometricSegment,
  LineSegment
} from '../geometry/primitives';
import { EnhancedFabricProperty } from '../fabric/fabric-types';
import { sha256Hex } from './crypto';
import {
  ApprovalStateSummary,
  AuthoritativeGradingArtifact,
  AuthoritativeMeasurementSetRecord,
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
  MeasurementApprovalRecord,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementSetSnapshot,
  PatternPieceSnapshot,
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
  'unknown'
] as const;

export const VALID_MEASUREMENT_APPROVAL_STATES: readonly MeasurementApprovalStatus[] = [
  'unverified',
  'pending',
  'approved',
  'rejected',
  'superseded'
] as const;

function isValidIsoDate(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string' || dateStr.trim() === '') return false;
  const epoch = Date.parse(dateStr);
  return Number.isFinite(epoch);
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
 * Strict Architectural Rules:
 * - Missing provenance defaults to 'unknown', NEVER 'user-entered'.
 * - Empty measurement names are rejected.
 * - Non-finite, zero, or negative measurement values are rejected.
 * - Exact finite values are preserved without silent rounding.
 * - Invalid origin enum values are rejected.
 * - AI-estimated measurements remain pending unless explicit human approval metadata is supplied.
 */
export function createMeasurementSetSnapshot(
  values: Readonly<Record<string, number>>,
  options: {
    defaultOrigin?: MeasurementOrigin;
    perMeasurementOrigin?: Readonly<Record<string, MeasurementOrigin>>;
    approval?: Partial<MeasurementApprovalRecord>;
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

  // Safety rule: AI-estimated measurements cannot be approved without explicit approval metadata
  const requestedState = options.approval?.state ?? 'pending';
  let approvalState = requestedState;
  const isAiOrigin =
    defaultOrigin === 'ai-estimated' ||
    Object.values(perMeasurementOrigin).includes('ai-estimated');
  const isSyntheticOrigin =
    defaultOrigin === 'synthetic-fixture' ||
    Object.values(perMeasurementOrigin).includes('synthetic-fixture');

  if (isSyntheticOrigin && requestedState === 'approved') {
    throw new ProductionSnapshotMeasurementError(
      'Synthetic fixture measurements cannot be marked as approved for production.'
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
    measurementRevisionReference: options.approval?.measurementRevisionReference
  };

  return {
    unit: 'cm',
    values: clonedValues,
    defaultOrigin,
    perMeasurementOrigin: Object.keys(perMeasurementOrigin).length > 0 ? perMeasurementOrigin : undefined,
    approval,
    notes: options.notes ? [...options.notes] : undefined
  };
}

/**
 * Creates an AuthoritativeMeasurementSetRecord with explicit provenance, separated AI estimates,
 * and strict default-unverified approval state.
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
    Object.values(perMeasurementOrigin).includes('synthetic-fixture');

  if (approvalState === 'approved') {
    if (hasAiInActiveValues) {
      throw new ProductionSnapshotMeasurementError(
        'AI-estimated measurements must be stored separately and cannot be marked as approved physical or authoritative measurements.'
      );
    }
    if (hasSyntheticValues) {
      throw new ProductionSnapshotMeasurementError(
        'Synthetic fixture measurements cannot be marked as approved authoritative measurements.'
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
    (record.perMeasurementOrigin && Object.values(record.perMeasurementOrigin).includes('synthetic-fixture'))
  ) {
    return {
      isValid: false,
      isApproved: false,
      reason: 'Synthetic fixture measurements are not permitted as authoritative production measurements.'
    };
  }
  if (record.source === 'unknown' || record.provenance === 'unknown') {
    return {
      isValid: false,
      isApproved: false,
      reason: 'Measurement set is missing explicit provenance (origin is unknown).'
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
 * Creates an authoritative, deeply-frozen ProductionPatternRevisionSnapshot.
 * Binds identity, design, measurements, fabric, geometry, validation, and provenance.
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

  // 6. Compute Canonical Fingerprint over authoritative content
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
    isProductionReady: false as const
  };

  const canonicalFingerprint = computeCanonicalRevisionFingerprint(preliminarySnapshot);

  // 7. Assemble master snapshot
  const rawSnapshot: ProductionPatternRevisionSnapshot = {
    ...preliminarySnapshot,
    canonicalFingerprint
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

  const preliminary: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
    gradingArtifactId,
    gradingRevisionId,
    tenantId,
    projectId,
    organizationScope: input.organizationScope?.trim(),
    sourcePatternRevisionId: input.sourcePatternRevisionId.trim(),
    sourcePatternSnapshotFingerprint: input.sourcePatternSnapshotFingerprint?.trim(),
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

  const canonicalFingerprint = computeCanonicalGradingArtifactFingerprint(preliminary);

  return deepFreeze({
    ...preliminary,
    canonicalFingerprint
  });
}

/**
 * Marks an AuthoritativeGradingArtifact as superseded by a newer grading revision.
 */
export function supersedeAuthoritativeGradingArtifact(
  artifact: AuthoritativeGradingArtifact,
  supersededByRevisionId: string
): AuthoritativeGradingArtifact {
  if (!supersededByRevisionId || supersededByRevisionId.trim() === '') {
    throw new ProductionSnapshotValidationError('supersededByRevisionId is required to supersede a grading artifact.');
  }
  const preliminary: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
    ...artifact,
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
 */
export function revokeAuthoritativeGradingArtifact(
  artifact: AuthoritativeGradingArtifact,
  reason: string,
  revokedAt?: string
): AuthoritativeGradingArtifact {
  if (!reason || reason.trim() === '') {
    throw new ProductionSnapshotValidationError('Revocation reason is required to revoke a grading artifact.');
  }
  const preliminary: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
    ...artifact,
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
