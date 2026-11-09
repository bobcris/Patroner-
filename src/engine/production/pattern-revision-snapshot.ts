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
  ContourBoundingBoxSnapshot,
  CreateProductionPatternRevisionInput,
  CurrentRevisionInputs,
  DesignSpecificationSnapshot,
  DraftingConfigurationSnapshot,
  EngineProvenanceRecord,
  FabricSnapshotProvenance,
  FabricSpecificationSnapshot,
  GeometricContourSnapshot,
  GeometricSegmentSnapshot,
  MeasurementApprovalRecord,
  MeasurementOrigin,
  MeasurementSetSnapshot,
  PatternPieceSnapshot,
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
  'standard-chart',
  'imported',
  'ai-estimated',
  'unknown'
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
  values: Record<string, number>,
  options: {
    defaultOrigin?: MeasurementOrigin;
    perMeasurementOrigin?: Record<string, MeasurementOrigin>;
    approval?: Partial<MeasurementApprovalRecord>;
    notes?: string[];
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
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(x => (x === undefined ? 'null' : canonicalizeJson(x)));
    return `[${items.join(',')}]`;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys
    .filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${canonicalizeJson((value as Record<string, unknown>)[k])}`);

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
