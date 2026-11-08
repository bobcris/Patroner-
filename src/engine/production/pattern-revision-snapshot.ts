/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
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
import {
  ApprovalStateSummary,
  CreateProductionPatternRevisionInput,
  CurrentRevisionInputs,
  DesignSpecificationSnapshot,
  DraftingConfigurationSnapshot,
  EngineProvenanceRecord,
  FabricSpecificationSnapshot,
  GeometricContourSnapshot,
  GeometricSegmentSnapshot,
  MeasurementApprovalRecord,
  MeasurementSetSnapshot,
  PatternPieceSnapshot,
  ProductionPatternRevisionSnapshot,
  PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION,
  RevisionComparisonResult,
  RevisionInputMismatch
} from './production-types';

export const CURRENT_ENGINE_VERSION = '0.4.6.1';
export const CURRENT_SNAPSHOT_ENGINE = 'Patroner Production Revision Engine';

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
 * Eliminates method references while strictly preserving all topological and geometric properties.
 */
export function serializeGeometricSegmentSnapshot(seg: GeometricSegment): GeometricSegmentSnapshot {
  if (seg.type === 'line') {
    const line = seg as LineSegment;
    return {
      id: line.id,
      type: 'line',
      start: { x: Number(line.start.x.toFixed(3)), y: Number(line.start.y.toFixed(3)) },
      end: { x: Number(line.end.x.toFixed(3)), y: Number(line.end.y.toFixed(3)) },
      seamAllowanceCm: line.seamAllowanceCm,
      isFold: Boolean(line.isFold),
      seamId: line.seamId,
      sourceSegmentId: line.sourceSegmentId,
      role: line.role,
      lengthCm: line.lengthCm()
    };
  }

  const bezier = seg as CubicBezierCurve;
  return {
    id: bezier.id,
    type: 'bezier',
    start: { x: Number(bezier.p0.x.toFixed(3)), y: Number(bezier.p0.y.toFixed(3)) },
    end: { x: Number(bezier.p3.x.toFixed(3)), y: Number(bezier.p3.y.toFixed(3)) },
    controlPoints: [
      { x: Number(bezier.cp1.x.toFixed(3)), y: Number(bezier.cp1.y.toFixed(3)) },
      { x: Number(bezier.cp2.x.toFixed(3)), y: Number(bezier.cp2.y.toFixed(3)) }
    ],
    seamAllowanceCm: bezier.seamAllowanceCm,
    isFold: Boolean(bezier.isFold),
    seamId: bezier.seamId,
    sourceSegmentId: bezier.sourceSegmentId,
    role: bezier.role,
    lengthCm: bezier.lengthCm()
  };
}

/**
 * Serializes a GeometricContour instance into a pure plain-data snapshot.
 */
export function serializeGeometricContourSnapshot(contour: GeometricContour): GeometricContourSnapshot {
  const segments = contour.segments.map(serializeGeometricSegmentSnapshot);
  const totalLengthCm = Number(
    segments.reduce((acc, s) => acc + s.lengthCm, 0).toFixed(2)
  );

  return {
    id: contour.id,
    isClosed: contour.isClosed,
    winding: contour.getWinding(),
    segments,
    totalLengthCm,
    boundingBox: computeBoundingBox(
      contour.toPolyline ? contour.toPolyline(8) : contour.getVertices()
    )
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

  const darts: Dart[] = (piece.darts || []).map(d => ({
    id: d.id,
    apex: { x: Number(d.apex.x.toFixed(3)), y: Number(d.apex.y.toFixed(3)) },
    legLeft: { x: Number(d.legLeft.x.toFixed(3)), y: Number(d.legLeft.y.toFixed(3)) },
    legRight: { x: Number(d.legRight.x.toFixed(3)), y: Number(d.legRight.y.toFixed(3)) },
    widthCm: d.widthCm,
    lengthCm: d.lengthCm
  }));

  const notches: Notch[] = (piece.notches || []).map(n => ({
    id: n.id,
    position: { x: Number(n.position.x.toFixed(3)), y: Number(n.position.y.toFixed(3)) },
    normalAngleDeg: n.normalAngleDeg,
    type: n.type,
    label: n.label
  }));

  const seams: SeamLine[] = (piece.seams || []).map(s => ({
    id: s.id,
    name: s.name,
    startPoint: { x: Number(s.startPoint.x.toFixed(3)), y: Number(s.startPoint.y.toFixed(3)) },
    endPoint: { x: Number(s.endPoint.x.toFixed(3)), y: Number(s.endPoint.y.toFixed(3)) },
    lengthCm: s.lengthCm,
    type: s.type,
    pathData: s.pathData,
    startTangent: s.startTangent ? { ...s.startTangent } : undefined,
    endTangent: s.endTangent ? { ...s.endTangent } : undefined,
    pairedPieceId: s.pairedPieceId,
    pairedSeamName: s.pairedSeamName,
    segmentId: s.segmentId,
    segmentIds: s.segmentIds ? [...s.segmentIds] : undefined
  }));

  const drillHoles: Point[] = (piece.drillHoles || []).map(p => ({
    x: Number(p.x.toFixed(3)),
    y: Number(p.y.toFixed(3))
  }));

  const boundingBox: BoundingBox = {
    minX: piece.boundingBox.minX,
    minY: piece.boundingBox.minY,
    maxX: piece.boundingBox.maxX,
    maxY: piece.boundingBox.maxY,
    widthCm: piece.boundingBox.widthCm,
    heightCm: piece.boundingBox.heightCm
  };

  const grainline: GrainLine = {
    start: { x: Number(piece.grainline.start.x.toFixed(3)), y: Number(piece.grainline.start.y.toFixed(3)) },
    end: { x: Number(piece.grainline.end.x.toFixed(3)), y: Number(piece.grainline.end.y.toFixed(3)) },
    direction: piece.grainline.direction
  };

  const offsetDiagnostics = piece.offsetResult?.diagnostics
    ? piece.offsetResult.diagnostics.map(d => ({ ...d }))
    : undefined;

  const warnings = piece.offsetResult?.warnings ? [...piece.offsetResult.warnings] : [];
  const errors = piece.offsetResult?.errors ? [...piece.offsetResult.errors] : [];

  return {
    id: piece.id,
    pieceCode: piece.pieceCode,
    name: piece.name,
    garmentCategory: piece.garmentCategory,
    sizeCode,
    cutCount: piece.cutCount,
    onFold: Boolean(piece.onFold),
    material: piece.material || 'self',
    cutPathData: piece.cutPathData,
    sewPathData: piece.sewPathData,
    seamAllowanceWidthCm: piece.seamAllowanceWidthCm,
    grainline,
    darts,
    notches,
    seams,
    drillHoles,
    boundingBox,
    description: piece.description || '',
    stitchingContour,
    cuttingContour,
    offsetDiagnostics,
    warnings,
    errors
  };
}

/**
 * Creates an immutable snapshot of body measurements with explicit provenance and approval.
 */
export function createMeasurementSetSnapshot(
  values: Record<string, number>,
  options: {
    defaultOrigin?: MeasurementSetSnapshot['defaultOrigin'];
    perMeasurementOrigin?: Record<string, MeasurementSetSnapshot['defaultOrigin']>;
    approval?: Partial<MeasurementApprovalRecord>;
    notes?: string[];
  } = {}
): MeasurementSetSnapshot {
  const clonedValues: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      clonedValues[k] = Number(v.toFixed(2));
    }
  }

  const defaultOrigin = options.defaultOrigin ?? 'user-entered';
  const perMeasurementOrigin: Record<string, MeasurementSetSnapshot['defaultOrigin']> = {};
  if (options.perMeasurementOrigin) {
    for (const [k, orig] of Object.entries(options.perMeasurementOrigin)) {
      perMeasurementOrigin[k] = orig;
    }
  }

  // Safety rule: AI-estimated measurements cannot be approved without explicit approval metadata
  const requestedState = options.approval?.state ?? 'pending';
  let approvalState = requestedState;
  const isAiOrigin = defaultOrigin === 'ai-estimated' || Object.values(perMeasurementOrigin).includes('ai-estimated');

  if (isAiOrigin && requestedState === 'approved') {
    if (!options.approval?.approvedBy || !options.approval?.approvedAt) {
      // Revert to pending: cannot approve AI estimates without explicit human approver
      approvalState = 'pending';
    }
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
 */
export function createFabricSpecificationSnapshot(
  fabric: FabricProperty | EnhancedFabricProperty
): FabricSpecificationSnapshot {
  const enhanced = fabric as EnhancedFabricProperty;
  const extra = fabric as unknown as Record<string, unknown>;

  const directional = enhanced.directional
    ? {
        warp: { ...enhanced.directional.warp },
        weft: { ...enhanced.directional.weft },
        bias: { ...enhanced.directional.bias }
      }
    : undefined;

  const propertyVerificationDetails = (extra.propertyVerificationDetails as Record<string, boolean> | undefined)
    ? { ...(extra.propertyVerificationDetails as Record<string, boolean>) }
    : undefined;

  const fabricRevision = typeof enhanced.revision === 'string'
    ? enhanced.revision
    : typeof extra.revisionId === 'string'
      ? (extra.revisionId as string)
      : typeof extra.lotNumber === 'string'
        ? (extra.lotNumber as string)
        : undefined;

  const laboratoryReference = typeof extra.laboratoryReference === 'string'
    ? (extra.laboratoryReference as string)
    : undefined;

  const supplierReference = typeof extra.supplierReference === 'string'
    ? (extra.supplierReference as string)
    : undefined;

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
    provenance: enhanced.provenance ?? 'project-default',
    isVerified: Boolean(enhanced.isVerified),
    propertyVerificationDetails,
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
  const constructionFeatures = (design.constructionFeatures || []).map(f => ({ ...f }));
  const designNotes = design.designNotes ? [...design.designNotes] : [];

  let aiEstimates: DesignSpecificationSnapshot['aiEstimates'] = undefined;
  if (design.aiEstimates) {
    aiEstimates = {
      suggestedSilhouette: design.aiEstimates.suggestedSilhouette,
      styleConfidenceScore: design.aiEstimates.styleConfidenceScore,
      suggestedFabrics: [...design.aiEstimates.suggestedFabrics],
      technicalAdvice: design.aiEstimates.technicalAdvice,
      disclaimer: design.aiEstimates.disclaimer
    };
  }

  return {
    id: design.id,
    version: design.version ?? 1,
    name: design.name,
    garmentCategory: design.garmentCategory,
    silhouette: design.silhouette,
    easeProfile: design.easeProfile,
    lengthCm: design.lengthCm,
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
 * Numbers are rounded to 4 decimal places to prevent floating-point platform noise.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : 'null';
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(canonicalizeJson);
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
 * not a cryptographic digital signature or public-key certificate.
 */
export function computeCanonicalFingerprint(data: object): string {
  const canonical = canonicalizeJson(data);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Creates an authoritative, deeply-frozen ProductionPatternRevisionSnapshot.
 * Binds identity, design, measurements, fabric, geometry, validation, and provenance.
 */
export function createProductionPatternRevision(
  input: CreateProductionPatternRevisionInput
): ProductionPatternRevisionSnapshot {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const revisionId = input.revisionId ?? `rev-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
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
    waistAllowanceCm: input.draftingConfiguration?.waistAllowanceCm ?? 1.0,
    hemAllowanceCm: input.draftingConfiguration?.hemAllowanceCm ?? 2.5,
    neckAllowanceCm: input.draftingConfiguration?.neckAllowanceCm ?? 1.0,
    armholeAllowanceCm: input.draftingConfiguration?.armholeAllowanceCm ?? 1.0,
    shoulderAllowanceCm: input.draftingConfiguration?.shoulderAllowanceCm ?? 1.0,
    bezierToleranceCm: input.draftingConfiguration?.bezierToleranceCm ?? 0.05,
    miterLimit: input.draftingConfiguration?.miterLimit ?? 2.5,
    categoryRegistryId: input.draftingConfiguration?.categoryRegistryId,
    negativeEasePolicyApplied: input.draftingConfiguration?.negativeEasePolicyApplied ?? false,
    customOptions: input.draftingConfiguration?.customOptions ? { ...input.draftingConfiguration.customOptions } : undefined
  };

  // 4. Engine provenance
  const engineProvenance: EngineProvenanceRecord = {
    engineVersion: input.engineProvenance?.engineVersion ?? CURRENT_ENGINE_VERSION,
    appVersion: input.engineProvenance?.appVersion,
    gitCommit: input.engineProvenance?.gitCommit,
    buildTimestamp: input.engineProvenance?.buildTimestamp,
    snapshotEngine: CURRENT_SNAPSHOT_ENGINE
  };

  // 5. Approval state model
  const approvalState: ApprovalStateSummary = {
    designApproval: designSnapshot.isApproved ? 'approved' : 'pending',
    measurementApproval: measurementSnapshot.approval.state,
    patternGeometryValidation: input.validation.status,
    assemblyValidation: input.assemblySummary?.status ?? (
      input.designSpecification.garmentCategory === 'bodice' ? 'unassessed-missing-data' : 'not-applicable'
    ),
    gradingValidation: input.gradingSummary
      ? (input.gradingSummary.isOverallGradingValid ? 'valid' : 'invalid')
      : 'not-applicable',
    physicalPrototypeValidation: input.physicalValidationStatus ?? 'not-assessed'
  };

  // 6. Pre-fingerprint data envelope
  const payloadForFingerprint = {
    schemaVersion: PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION,
    projectId: input.projectId,
    revisionId,
    parentRevisionId: input.parentRevisionId,
    revisionIndex,
    createdAt: timestamp,
    garmentCategory: input.designSpecification.garmentCategory,
    targetSize: input.targetSize,
    designSpecification: designSnapshot,
    measurementSet: measurementSnapshot,
    fabricSpecification: fabricSnapshot,
    patternPieces: pieceSnapshots,
    draftingConfiguration: draftingConfig,
    validationStatus: input.validation.status,
    engineProvenance
  };

  const canonicalFingerprint = computeCanonicalFingerprint(payloadForFingerprint);

  // 7. Assemble master snapshot
  const rawSnapshot: ProductionPatternRevisionSnapshot = {
    schemaVersion: PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION,
    projectId: input.projectId,
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
    isProductionReady: false,
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
    if (ds.lengthCm !== undefined && Math.abs(ds.lengthCm - snapshot.designSpecification.lengthCm) > 0.1) {
      mismatches.push({
        path: 'designSpecification.lengthCm',
        field: 'lengthCm',
        baselineValue: snapshot.designSpecification.lengthCm,
        currentValue: ds.lengthCm,
        severity: 'breaking',
        description: `Length changed from ${snapshot.designSpecification.lengthCm} cm to ${ds.lengthCm} cm.`
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
          severity: 'breaking',
          description: `New measurement '${key}' added with value ${val} cm.`
        });
      } else if (Math.abs(val - baselineVal) > 0.05) {
        mismatches.push({
          path: `measurementSet.values.${key}`,
          field: key,
          baselineValue: baselineVal,
          currentValue: val,
          severity: 'breaking',
          description: `Measurement '${key}' changed from ${baselineVal} cm to ${val} cm (Δ = ${(val - baselineVal).toFixed(2)} cm).`
        });
      }
    }

    if (current.measurements.approval?.state && current.measurements.approval.state !== snapshot.measurementSet.approval.state) {
      mismatches.push({
        path: 'measurementSet.approval.state',
        field: 'approval.state',
        baselineValue: snapshot.measurementSet.approval.state,
        currentValue: current.measurements.approval.state,
        severity: 'advisory',
        description: `Measurement approval state changed from '${snapshot.measurementSet.approval.state}' to '${current.measurements.approval.state}'.`
      });
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
        description: `Fabric changed from '${snapshot.fabricSpecification.fabricId}' (${snapshot.fabricSpecification.name}) to '${current.fabric.id}'.`
      });
    }
    if (current.fabric.stretch && current.fabric.stretch !== snapshot.fabricSpecification.stretch) {
      mismatches.push({
        path: 'fabricSpecification.stretch',
        field: 'stretch',
        baselineValue: snapshot.fabricSpecification.stretch,
        currentValue: current.fabric.stretch,
        severity: 'breaking',
        description: `Fabric stretch category changed from '${snapshot.fabricSpecification.stretch}' to '${current.fabric.stretch}'.`
      });
    }
  }

  // 5. Drafting Configuration
  if (current.draftingConfiguration) {
    const dc = current.draftingConfiguration;
    if (dc.seamAllowanceCm !== undefined && dc.seamAllowanceCm !== snapshot.draftingConfiguration.seamAllowanceCm) {
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

  // 6. Pattern Pieces Geometry
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
      for (const curPiece of current.patternPieces) {
        const snapPiece = snapshot.patternPieces.find(p => p.id === curPiece.id || p.pieceCode === curPiece.pieceCode);
        if (!snapPiece) {
          mismatches.push({
            path: `patternPieces[${curPiece.pieceCode}]`,
            field: 'pieceCode',
            baselineValue: undefined,
            currentValue: curPiece.pieceCode,
            severity: 'breaking',
            description: `Pattern piece '${curPiece.pieceCode}' (${curPiece.name}) does not exist in baseline snapshot.`
          });
        } else {
          // Compare bounding box
          if (
            Math.abs(curPiece.boundingBox.widthCm - snapPiece.boundingBox.widthCm) > 0.1 ||
            Math.abs(curPiece.boundingBox.heightCm - snapPiece.boundingBox.heightCm) > 0.1
          ) {
            mismatches.push({
              path: `patternPieces[${curPiece.pieceCode}].boundingBox`,
              field: 'boundingBox',
              baselineValue: `${snapPiece.boundingBox.widthCm}x${snapPiece.boundingBox.heightCm} cm`,
              currentValue: `${curPiece.boundingBox.widthCm}x${curPiece.boundingBox.heightCm} cm`,
              severity: 'breaking',
              description: `Dimensions of piece '${curPiece.pieceCode}' changed from ${snapPiece.boundingBox.widthCm}x${snapPiece.boundingBox.heightCm} cm to ${curPiece.boundingBox.widthCm}x${curPiece.boundingBox.heightCm} cm.`
            });
          }
        }
      }
    }
  }

  // 7. Engine Provenance
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
 * Compares two revision snapshots for exact engineering equivalence.
 */
export function arePatternRevisionsEquivalent(
  a: ProductionPatternRevisionSnapshot,
  b: ProductionPatternRevisionSnapshot
): boolean {
  if (a.canonicalFingerprint && b.canonicalFingerprint) {
    return a.canonicalFingerprint === b.canonicalFingerprint;
  }
  return canonicalizeJson(a) === canonicalizeJson(b);
}
