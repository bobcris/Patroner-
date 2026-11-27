/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A2 — Construction Geometry, Technical Annotations, Anchored Marks & Lightweight Constraints Engine.
 *
 * Pure, framework-agnostic, unrounded IEEE-754 float64 module.
 *
 * GOVERNANCE & AUTHORITY BOUNDARIES:
 * - All construction entities carry `isCuttingGeometry: false`.
 * - Never mutates source `PatternArtifactBundle` or `cutSegments`.
 * - Reprojects anchored notches/drills across sew-contour splits/elevations via explicit lineage,
 *   or marks them `invalidated-missing-reference` when upstream geometry is removed.
 * - Evaluates lightweight geometric constraints with unrounded residuals in both coordinate frames.
 */

import type {
  PatternArtifactCoordinateFrame,
  PatternPieceRenderModel,
  RenderCurveSegment,
  RenderNotch,
  RenderPoint2D
} from './contracts/pattern-render-artifact';
import type {
  AnnotationLayerId,
  ConstructionEntity,
  EvaluatedConstraintResult,
  GeometricConstraint,
  InternalLineRole,
  ProposedDrillHoleRecord,
  ProposedNotchRecord,
  ReferenceAxisRole
} from './contracts/wp-a-shared-contracts';
import type { ProposalSegmentLineage } from './geometry-edit-proposal';
import {
  evaluateSegmentArcLengthCm,
  evaluateSegmentUnitTangent,
  invertSegmentArcLength
} from './seam-correspondence';
import { evaluateSegmentPointExact, isFinitePoint2D, isFiniteSegment } from './spatial-diagnostics';
import { closestPointOnCubicBezier, closestPointOnLineSegment } from './entity-hit-test';

export const MIN_CONSTRUCTION_LENGTH_CM = 1e-4;
export const MIN_CONSTRUCTION_RADIUS_CM = 1e-3;
export const DEFAULT_CONSTRAINT_TOLERANCE_CM = 0.05;
export const DEFAULT_CONSTRAINT_TOLERANCE_DEG = 0.5;

// ---------------------------------------------------------------------------
// 1. Validated Construction Geometry Builders (Fail-Closed)
// ---------------------------------------------------------------------------

export function createConstructionLine(input: {
  readonly id: string;
  readonly pieceId: string | null;
  readonly kind?: 'construction-line' | 'construction-ray' | 'parallel-guide' | 'perpendicular-guide';
  readonly label?: string;
  readonly start: RenderPoint2D;
  readonly end: RenderPoint2D;
  readonly sourceSegmentId?: string;
  readonly offsetDistanceCm?: number;
}): { readonly ok: true; readonly entity: ConstructionEntity } | { readonly ok: false; readonly error: string } {
  if (!isFinitePoint2D(input.start) || !isFinitePoint2D(input.end)) {
    return { ok: false, error: 'Construction line endpoints must be finite.' };
  }
  const len = Math.hypot(input.end.x - input.start.x, input.end.y - input.start.y);
  if (len < MIN_CONSTRUCTION_LENGTH_CM) {
    return { ok: false, error: `Construction line length must be >= ${MIN_CONSTRUCTION_LENGTH_CM} cm.` };
  }
  const kind = input.kind ?? 'construction-line';
  return {
    ok: true,
    entity: {
      id: input.id,
      pieceId: input.pieceId,
      kind,
      label: input.label?.trim() || (kind === 'construction-ray' ? 'Construction Ray' : 'Construction Line'),
      visible: true,
      locked: false,
      layerId: 'construction',
      isCuttingGeometry: false,
      start: { x: input.start.x, y: input.start.y },
      end: { x: input.end.x, y: input.end.y },
      sourceSegmentId: input.sourceSegmentId,
      offsetDistanceCm: input.offsetDistanceCm
    }
  };
}

export function createReferenceAxis(input: {
  readonly id: string;
  readonly pieceId: string | null;
  readonly axisRole: ReferenceAxisRole;
  readonly label?: string;
  readonly start: RenderPoint2D;
  readonly end: RenderPoint2D;
}): { readonly ok: true; readonly entity: ConstructionEntity } | { readonly ok: false; readonly error: string } {
  if (!isFinitePoint2D(input.start) || !isFinitePoint2D(input.end)) {
    return { ok: false, error: 'Reference axis endpoints must be finite.' };
  }
  if (Math.hypot(input.end.x - input.start.x, input.end.y - input.start.y) < MIN_CONSTRUCTION_LENGTH_CM) {
    return { ok: false, error: 'Reference axis length cannot be degenerate.' };
  }
  return {
    ok: true,
    entity: {
      id: input.id,
      pieceId: input.pieceId,
      kind: 'reference-axis',
      axisRole: input.axisRole,
      label: input.label?.trim() || `${input.axisRole.toUpperCase()} Axis`,
      visible: true,
      locked: false,
      layerId: 'construction',
      isCuttingGeometry: false,
      start: { x: input.start.x, y: input.start.y },
      end: { x: input.end.x, y: input.end.y }
    }
  };
}

export function createConstructionCircle(input: {
  readonly id: string;
  readonly pieceId: string | null;
  readonly label?: string;
  readonly center: RenderPoint2D;
  readonly radiusCm: number;
}): { readonly ok: true; readonly entity: ConstructionEntity } | { readonly ok: false; readonly error: string } {
  if (!isFinitePoint2D(input.center) || !Number.isFinite(input.radiusCm)) {
    return { ok: false, error: 'Circle center and radius must be finite.' };
  }
  if (input.radiusCm < MIN_CONSTRUCTION_RADIUS_CM) {
    return { ok: false, error: `Circle radius must be >= ${MIN_CONSTRUCTION_RADIUS_CM} cm.` };
  }
  return {
    ok: true,
    entity: {
      id: input.id,
      pieceId: input.pieceId,
      kind: 'construction-circle',
      label: input.label?.trim() || `Circle R${input.radiusCm.toFixed(1)} cm`,
      visible: true,
      locked: false,
      layerId: 'construction',
      isCuttingGeometry: false,
      center: { x: input.center.x, y: input.center.y },
      radiusCm: input.radiusCm
    }
  };
}

export function createConstructionArc(input: {
  readonly id: string;
  readonly pieceId: string | null;
  readonly label?: string;
  readonly center: RenderPoint2D;
  readonly radiusCm: number;
  readonly startAngleRad: number;
  readonly endAngleRad: number;
}): { readonly ok: true; readonly entity: ConstructionEntity } | { readonly ok: false; readonly error: string } {
  if (
    !isFinitePoint2D(input.center) ||
    !Number.isFinite(input.radiusCm) ||
    !Number.isFinite(input.startAngleRad) ||
    !Number.isFinite(input.endAngleRad)
  ) {
    return { ok: false, error: 'Arc center, radius, and angles must be finite.' };
  }
  if (input.radiusCm < MIN_CONSTRUCTION_RADIUS_CM) {
    return { ok: false, error: 'Arc radius too small.' };
  }
  if (Math.abs(input.endAngleRad - input.startAngleRad) < 1e-4) {
    return { ok: false, error: 'Arc angular sweep cannot be degenerate.' };
  }
  return {
    ok: true,
    entity: {
      id: input.id,
      pieceId: input.pieceId,
      kind: 'construction-arc',
      label: input.label?.trim() || `Arc R${input.radiusCm.toFixed(1)} cm`,
      visible: true,
      locked: false,
      layerId: 'construction',
      isCuttingGeometry: false,
      center: { x: input.center.x, y: input.center.y },
      radiusCm: input.radiusCm,
      startAngleRad: input.startAngleRad,
      endAngleRad: input.endAngleRad
    }
  };
}

export function createParallelOrPerpendicularGuide(input: {
  readonly id: string;
  readonly pieceId: string;
  readonly mode: 'parallel-guide' | 'perpendicular-guide';
  readonly sourceSegment: RenderCurveSegment;
  readonly offsetDistanceCm: number;
  readonly anchorT?: number;
  readonly guideLengthCm?: number;
  readonly label?: string;
}): { readonly ok: true; readonly entity: ConstructionEntity } | { readonly ok: false; readonly error: string } {
  if (!isFiniteSegment(input.sourceSegment) || !Number.isFinite(input.offsetDistanceCm)) {
    return { ok: false, error: 'Invalid source segment or offset distance.' };
  }
  const dx = input.sourceSegment.p3.x - input.sourceSegment.p0.x;
  const dy = input.sourceSegment.p3.y - input.sourceSegment.p0.y;
  const len = Math.hypot(dx, dy);
  if (len < MIN_CONSTRUCTION_LENGTH_CM) {
    return { ok: false, error: 'Source segment is degenerate.' };
  }
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  if (input.mode === 'parallel-guide') {
    const start: RenderPoint2D = {
      x: input.sourceSegment.p0.x + nx * input.offsetDistanceCm,
      y: input.sourceSegment.p0.y + ny * input.offsetDistanceCm
    };
    const end: RenderPoint2D = {
      x: input.sourceSegment.p3.x + nx * input.offsetDistanceCm,
      y: input.sourceSegment.p3.y + ny * input.offsetDistanceCm
    };
    return createConstructionLine({
      id: input.id,
      pieceId: input.pieceId,
      kind: 'parallel-guide',
      label: input.label ?? `Parallel (${input.offsetDistanceCm.toFixed(1)} cm)`,
      start,
      end,
      sourceSegmentId: input.sourceSegment.id,
      offsetDistanceCm: input.offsetDistanceCm
    });
  }

  const t = Math.max(0, Math.min(1, input.anchorT ?? 0.5));
  const anchor = evaluateSegmentPointExact(input.sourceSegment, t);
  if (!anchor) return { ok: false, error: 'Could not evaluate perpendicular anchor.' };
  const tan = evaluateSegmentUnitTangent(input.sourceSegment, t, 1) ?? { x: ux, y: uy };
  const pnx = -tan.y;
  const pny = tan.x;
  const halfLen = Math.max(1, (input.guideLengthCm ?? 12) * 0.5);
  return createConstructionLine({
    id: input.id,
    pieceId: input.pieceId,
    kind: 'perpendicular-guide',
    label: input.label ?? `Perpendicular @ t=${t.toFixed(2)}`,
    start: { x: anchor.x - pnx * halfLen, y: anchor.y - pny * halfLen },
    end: { x: anchor.x + pnx * halfLen, y: anchor.y + pny * halfLen },
    sourceSegmentId: input.sourceSegment.id,
    offsetDistanceCm: input.offsetDistanceCm
  });
}

export function createInternalLine(input: {
  readonly id: string;
  readonly pieceId: string;
  readonly role: InternalLineRole;
  readonly start: RenderPoint2D;
  readonly end: RenderPoint2D;
  readonly label?: string;
}): { readonly ok: true; readonly entity: ConstructionEntity } | { readonly ok: false; readonly error: string } {
  if (!isFinitePoint2D(input.start) || !isFinitePoint2D(input.end)) {
    return { ok: false, error: 'Internal line endpoints must be finite.' };
  }
  if (Math.hypot(input.end.x - input.start.x, input.end.y - input.start.y) < MIN_CONSTRUCTION_LENGTH_CM) {
    return { ok: false, error: 'Internal line length must be > 0.' };
  }
  const seg: RenderCurveSegment = {
    id: `${input.id}::seg-0`,
    kind: 'line',
    role: 'stitching',
    p0: { x: input.start.x, y: input.start.y },
    p3: { x: input.end.x, y: input.end.y }
  };
  return {
    ok: true,
    entity: {
      id: input.id,
      pieceId: input.pieceId,
      kind: 'internal-line',
      role: input.role,
      label: input.label?.trim() || `${input.role.replace('-', ' ')}`,
      visible: true,
      locked: false,
      layerId: 'internal-lines',
      isCuttingGeometry: false,
      segments: [seg]
    }
  };
}

export function createTechnicalCallout(input: {
  readonly id: string;
  readonly pieceId: string | null;
  readonly anchor: RenderPoint2D;
  readonly text: string;
  readonly leaderTarget?: RenderPoint2D;
  readonly label?: string;
  readonly layerId?: AnnotationLayerId;
}): { readonly ok: true; readonly entity: ConstructionEntity } | { readonly ok: false; readonly error: string } {
  if (!isFinitePoint2D(input.anchor) || (input.leaderTarget && !isFinitePoint2D(input.leaderTarget))) {
    return { ok: false, error: 'Callout coordinates must be finite.' };
  }
  const text = input.text.trim();
  if (!text) {
    return { ok: false, error: 'Technical callout text cannot be empty.' };
  }
  return {
    ok: true,
    entity: {
      id: input.id,
      pieceId: input.pieceId,
      kind: 'technical-callout',
      label: input.label?.trim() || text.slice(0, 24),
      visible: true,
      locked: false,
      layerId: input.layerId ?? 'annotations',
      isCuttingGeometry: false,
      anchor: { x: input.anchor.x, y: input.anchor.y },
      text,
      leaderTarget: input.leaderTarget ? { x: input.leaderTarget.x, y: input.leaderTarget.y } : undefined
    }
  };
}

// ---------------------------------------------------------------------------
// 2. Anchored Notch & Drill-Hole Authoring and Lineage Reprojection
// ---------------------------------------------------------------------------

/**
 * Computes an anchored `ProposedNotchRecord` positioned precisely at `targetArcLengthCm`
 * along `segment` with unit normal perpendicular to the sew edge.
 */
export function buildAnchoredNotchRecord(input: {
  readonly notchId: string;
  readonly pieceId: string;
  readonly segment: RenderCurveSegment;
  readonly baseSegmentIds: readonly string[];
  readonly targetArcLengthCm: number;
  readonly notchType: RenderNotch['notchType'];
  readonly label?: string;
  readonly coordinateFrame: PatternArtifactCoordinateFrame;
  readonly origin?: 'artifact' | 'proposal-authored';
}): { readonly ok: true; readonly notch: ProposedNotchRecord } | { readonly ok: false; readonly error: string } {
  const lenRes = evaluateSegmentArcLengthCm(input.segment, input.coordinateFrame, input.pieceId);
  if (!lenRes.ok || lenRes.lengthCm <= MIN_CONSTRUCTION_LENGTH_CM) {
    return { ok: false, error: lenRes.reason ?? 'Cannot anchor notch on degenerate segment.' };
  }
  if (!Number.isFinite(input.targetArcLengthCm)) {
    return { ok: false, error: 'Notch arc-length offset must be finite.' };
  }

  const clampedArc = Math.max(0, Math.min(lenRes.lengthCm, input.targetArcLengthCm));
  const inv = invertSegmentArcLength(
    input.segment,
    clampedArc,
    lenRes.lengthCm,
    input.coordinateFrame,
    input.pieceId
  );
  if (!inv.ok) {
    return { ok: false, error: inv.reason ?? 'Notch arc-length inversion failed.' };
  }

  const pt = evaluateSegmentPointExact(input.segment, inv.t);
  const tan = evaluateSegmentUnitTangent(input.segment, inv.t, 1);
  if (!pt || !tan) {
    return { ok: false, error: 'Could not evaluate notch position/tangent.' };
  }

  // Unit normal pointing consistently 90° from tangent
  const normal: RenderPoint2D = { x: -tan.y, y: tan.x };

  return {
    ok: true,
    notch: {
      id: input.notchId,
      pieceId: input.pieceId,
      segmentId: input.segment.id,
      baseSegmentIds: [...input.baseSegmentIds],
      targetArcLengthCm: clampedArc,
      parameterT: inv.t,
      position: pt,
      normalVector: normal,
      notchType: input.notchType,
      label: input.label,
      reconciliationStatus: 'resolved',
      origin: input.origin ?? 'proposal-authored'
    }
  };
}

/**
 * Reconciles and reprojects existing/proposed notches onto updated sew segments after
 * contour edits, splits, elevations, or dart cuts.
 *
 * If a host segment was split into multiple descendants, traverses the descendants in
 * contour order to reproject `targetArcLengthCm` accurately and sets
 * `reconciliationStatus: 'reprojected-via-lineage'`. If the host lineage disappeared,
 * explicitly marks `invalidated-missing-reference`.
 */
export function reconcileAndReprojectNotches(
  notches: readonly ProposedNotchRecord[],
  activeSewSegments: readonly RenderCurveSegment[],
  lineageBySegmentId: Readonly<Record<string, ProposalSegmentLineage>> | undefined,
  coordinateFrame: PatternArtifactCoordinateFrame
): ProposedNotchRecord[] {
  const segById = new Map(activeSewSegments.map((s) => [s.id, s]));

  return notches.map((notch) => {
    const directSeg = segById.get(notch.segmentId);
    if (directSeg) {
      const rebuilt = buildAnchoredNotchRecord({
        notchId: notch.id,
        pieceId: notch.pieceId,
        segment: directSeg,
        baseSegmentIds: lineageBySegmentId?.[directSeg.id]?.baseSegmentIds ?? notch.baseSegmentIds,
        targetArcLengthCm: notch.targetArcLengthCm,
        notchType: notch.notchType,
        label: notch.label,
        coordinateFrame,
        origin: notch.origin
      });
      if (rebuilt.ok) {
        return {
          ...rebuilt.notch,
          reconciliationStatus: 'resolved'
        };
      }
      return {
        ...notch,
        reconciliationStatus: 'invalidated-missing-reference',
        reconciliationReason: rebuilt.error
      };
    }

    // Attempt deterministic lineage reprojection across split/elevated descendants
    const lookupBases = new Set([notch.segmentId, ...notch.baseSegmentIds]);
    const descendants = activeSewSegments.filter((seg) => {
      const lin = lineageBySegmentId?.[seg.id];
      return Boolean(lin && lin.baseSegmentIds.some((b) => lookupBases.has(b)));
    });

    if (descendants.length > 0) {
      let remainingArc = Math.max(0, notch.targetArcLengthCm);
      let chosenSeg = descendants[descendants.length - 1];
      let chosenLocalArc = 0;

      for (const desc of descendants) {
        const lenRes = evaluateSegmentArcLengthCm(desc, coordinateFrame, notch.pieceId);
        if (!lenRes.ok) continue;
        if (remainingArc <= lenRes.lengthCm + 1e-6 || desc === descendants[descendants.length - 1]) {
          chosenSeg = desc;
          chosenLocalArc = Math.max(0, Math.min(lenRes.lengthCm, remainingArc));
          break;
        }
        remainingArc -= lenRes.lengthCm;
      }

      const rebuilt = buildAnchoredNotchRecord({
        notchId: notch.id,
        pieceId: notch.pieceId,
        segment: chosenSeg,
        baseSegmentIds: lineageBySegmentId?.[chosenSeg.id]?.baseSegmentIds ?? notch.baseSegmentIds,
        targetArcLengthCm: chosenLocalArc,
        notchType: notch.notchType,
        label: notch.label,
        coordinateFrame,
        origin: notch.origin
      });
      if (rebuilt.ok) {
        return {
          ...rebuilt.notch,
          reconciliationStatus: 'reprojected-via-lineage',
          reconciliationReason: `Reprojected from "${notch.segmentId}" onto "${chosenSeg.id}" via lineage.`
        };
      }
    }

    return {
      ...notch,
      reconciliationStatus: 'invalidated-missing-reference',
      reconciliationReason: `Host sew segment "${notch.segmentId}" no longer exists in active contour.`
    };
  });
}

export function buildProposedDrillHole(input: {
  readonly drillId: string;
  readonly pieceId: string;
  readonly positionCm: RenderPoint2D;
  readonly radiusCm: number;
  readonly label?: string;
  readonly anchorRef?: ProposedDrillHoleRecord['anchorRef'];
  readonly origin?: 'artifact' | 'proposal-authored';
}): { readonly ok: true; readonly drill: ProposedDrillHoleRecord } | { readonly ok: false; readonly error: string } {
  if (!isFinitePoint2D(input.positionCm) || !Number.isFinite(input.radiusCm) || input.radiusCm <= 0 || input.radiusCm > 3) {
    return { ok: false, error: 'Drill hole position must be finite and radius must be in (0, 3] cm.' };
  }
  return {
    ok: true,
    drill: {
      id: input.drillId,
      pieceId: input.pieceId,
      position: { x: input.positionCm.x, y: input.positionCm.y },
      radiusCm: input.radiusCm,
      label: input.label,
      anchorRef: input.anchorRef ?? { kind: 'piece-local' },
      reconciliationStatus: 'resolved',
      origin: input.origin ?? 'proposal-authored'
    }
  };
}

// ---------------------------------------------------------------------------
// 3. Lightweight Geometric Constraint Evaluation (Advisory Float64)
// ---------------------------------------------------------------------------

interface ResolvedLinearRef {
  readonly kind: 'linear';
  readonly start: RenderPoint2D;
  readonly end: RenderPoint2D;
  readonly segment?: RenderCurveSegment;
}

interface ResolvedPointRef {
  readonly kind: 'point';
  readonly point: RenderPoint2D;
}

type ResolvedConstraintTarget = ResolvedLinearRef | ResolvedPointRef;

function resolveConstraintEntityRef(
  ref: string,
  piece: PatternPieceRenderModel | undefined,
  constructions: Readonly<Record<string, ConstructionEntity>>,
  notches: readonly ProposedNotchRecord[]
): ResolvedConstraintTarget | null {
  if (ref.startsWith('seg:')) {
    const segId = ref.slice(4);
    const seg = piece?.sewSegments.find((s) => s.id === segId);
    if (!seg || !isFiniteSegment(seg)) return null;
    return { kind: 'linear', start: seg.p0, end: seg.p3, segment: seg };
  }
  if (ref.startsWith('const:')) {
    const entityId = ref.slice(6);
    const entity = constructions[entityId];
    if (!entity) return null;
    if (
      entity.kind === 'construction-line' ||
      entity.kind === 'construction-ray' ||
      entity.kind === 'parallel-guide' ||
      entity.kind === 'perpendicular-guide' ||
      entity.kind === 'reference-axis'
    ) {
      return { kind: 'linear', start: entity.start, end: entity.end };
    }
    if (entity.kind === 'internal-line' && entity.segments.length > 0) {
      const first = entity.segments[0];
      const last = entity.segments[entity.segments.length - 1];
      return { kind: 'linear', start: first.p0, end: last.p3, segment: first };
    }
    if (entity.kind === 'construction-circle' || entity.kind === 'construction-arc') {
      return { kind: 'point', point: entity.center };
    }
    if (entity.kind === 'technical-callout') {
      return { kind: 'point', point: entity.anchor };
    }
    return null;
  }
  if (ref.startsWith('notch:')) {
    const notchId = ref.slice(6);
    const n = notches.find((item) => item.id === notchId) ?? piece?.notches.find((item) => item.id === notchId);
    if (!n || !isFinitePoint2D(n.position)) return null;
    return { kind: 'point', point: n.position };
  }
  if (ref.startsWith('vtx:')) {
    const vtxSpec = ref.slice(4);
    // Support format `<segmentId>:p0` or `<segmentId>:p3`
    const [segId, slot] = vtxSpec.split(':');
    const seg = piece?.sewSegments.find((s) => s.id === segId);
    if (!seg) return null;
    return { kind: 'point', point: slot === 'p3' ? seg.p3 : seg.p0 };
  }
  return null;
}

function linearUnitVector(t: ResolvedLinearRef): RenderPoint2D | null {
  const dx = t.end.x - t.start.x;
  const dy = t.end.y - t.start.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-12) return null;
  return { x: dx / len, y: dy / len };
}

export function evaluateGeometricConstraint(
  constraint: GeometricConstraint,
  piece: PatternPieceRenderModel | undefined,
  constructions: Readonly<Record<string, ConstructionEntity>>,
  notches: readonly ProposedNotchRecord[],
  coordinateFrame: PatternArtifactCoordinateFrame
): EvaluatedConstraintResult {
  const tol = Math.max(1e-9, constraint.toleranceCmOrDeg);
  const targets = constraint.entityRefs.map((ref) =>
    resolveConstraintEntityRef(ref, piece, constructions, notches)
  );

  if (targets.some((t) => t === null)) {
    return {
      constraintId: constraint.id,
      status: 'invalidated',
      residual: null,
      unit: constraint.kind === 'distance-cm' || constraint.kind === 'equal-length' || constraint.kind === 'point-on-segment' ? 'cm' : 'deg',
      message: 'One or more referenced entities no longer exist.'
    };
  }

  switch (constraint.kind) {
    case 'horizontal': {
      const t0 = targets[0];
      if (!t0 || t0.kind !== 'linear') {
        return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Horizontal constraint requires a linear entity.' };
      }
      const u = linearUnitVector(t0);
      if (!u) return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Degenerate linear entity.' };
      const angleDeg = (Math.asin(Math.min(1, Math.abs(u.y))) * 180) / Math.PI;
      return {
        constraintId: constraint.id,
        status: angleDeg <= tol ? 'satisfied' : 'violated',
        residual: angleDeg,
        unit: 'deg',
        message: `Deviation from horizontal: ${angleDeg.toFixed(3)}° (tol ${tol.toFixed(2)}°).`
      };
    }

    case 'vertical': {
      const t0 = targets[0];
      if (!t0 || t0.kind !== 'linear') {
        return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Vertical constraint requires a linear entity.' };
      }
      const u = linearUnitVector(t0);
      if (!u) return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Degenerate linear entity.' };
      const angleDeg = (Math.asin(Math.min(1, Math.abs(u.x))) * 180) / Math.PI;
      return {
        constraintId: constraint.id,
        status: angleDeg <= tol ? 'satisfied' : 'violated',
        residual: angleDeg,
        unit: 'deg',
        message: `Deviation from vertical: ${angleDeg.toFixed(3)}° (tol ${tol.toFixed(2)}°).`
      };
    }

    case 'parallel': {
      const [t0, t1] = targets;
      if (!t0 || !t1 || t0.kind !== 'linear' || t1.kind !== 'linear') {
        return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Parallel constraint requires two linear entities.' };
      }
      const u0 = linearUnitVector(t0);
      const u1 = linearUnitVector(t1);
      if (!u0 || !u1) return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Degenerate reference vector.' };
      const dot = Math.min(1, Math.abs(u0.x * u1.x + u0.y * u1.y));
      const angleDeg = (Math.acos(dot) * 180) / Math.PI;
      return {
        constraintId: constraint.id,
        status: angleDeg <= tol ? 'satisfied' : 'violated',
        residual: angleDeg,
        unit: 'deg',
        message: `Parallelism deviation: ${angleDeg.toFixed(3)}° (tol ${tol.toFixed(2)}°).`
      };
    }

    case 'perpendicular': {
      const [t0, t1] = targets;
      if (!t0 || !t1 || t0.kind !== 'linear' || t1.kind !== 'linear') {
        return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Perpendicular constraint requires two linear entities.' };
      }
      const u0 = linearUnitVector(t0);
      const u1 = linearUnitVector(t1);
      if (!u0 || !u1) return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Degenerate reference vector.' };
      const dot = Math.min(1, Math.abs(u0.x * u1.x + u0.y * u1.y));
      const angleFrom90Deg = (Math.asin(dot) * 180) / Math.PI;
      return {
        constraintId: constraint.id,
        status: angleFrom90Deg <= tol ? 'satisfied' : 'violated',
        residual: angleFrom90Deg,
        unit: 'deg',
        message: `Deviation from 90°: ${angleFrom90Deg.toFixed(3)}° (tol ${tol.toFixed(2)}°).`
      };
    }

    case 'equal-length': {
      const [t0, t1] = targets;
      if (!t0 || !t1 || t0.kind !== 'linear' || t1.kind !== 'linear') {
        return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'cm', message: 'Equal-length constraint requires two linear/curve segments.' };
      }
      const len0 = t0.segment
        ? evaluateSegmentArcLengthCm(t0.segment, coordinateFrame, constraint.pieceId).lengthCm
        : Math.hypot(t0.end.x - t0.start.x, t0.end.y - t0.start.y);
      const len1 = t1.segment
        ? evaluateSegmentArcLengthCm(t1.segment, coordinateFrame, constraint.pieceId).lengthCm
        : Math.hypot(t1.end.x - t1.start.x, t1.end.y - t1.start.y);
      const diff = Math.abs(len0 - len1);
      return {
        constraintId: constraint.id,
        status: diff <= tol ? 'satisfied' : 'violated',
        residual: diff,
        unit: 'cm',
        message: `Length delta: ${diff.toFixed(3)} cm (${len0.toFixed(2)} vs ${len1.toFixed(2)} cm).`
      };
    }

    case 'tangent-g1': {
      const [t0, t1] = targets;
      if (!t0 || !t1 || t0.kind !== 'linear' || t1.kind !== 'linear' || !t0.segment || !t1.segment) {
        return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Tangent-G1 constraint requires two connected sew segments.' };
      }
      const tan0 = evaluateSegmentUnitTangent(t0.segment, 1, 1);
      const tan1 = evaluateSegmentUnitTangent(t1.segment, 0, 1);
      if (!tan0 || !tan1) {
        return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'deg', message: 'Indeterminate segment endpoint tangent.' };
      }
      const dot = Math.max(-1, Math.min(1, tan0.x * tan1.x + tan0.y * tan1.y));
      const angleDeg = (Math.acos(dot) * 180) / Math.PI;
      return {
        constraintId: constraint.id,
        status: angleDeg <= tol ? 'satisfied' : 'violated',
        residual: angleDeg,
        unit: 'deg',
        message: `G1 tangent angle deviation: ${angleDeg.toFixed(3)}° (tol ${tol.toFixed(2)}°).`
      };
    }

    case 'point-on-segment': {
      const [ptRef, segRef] = targets;
      if (!ptRef || !segRef || ptRef.kind !== 'point' || segRef.kind !== 'linear') {
        return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'cm', message: 'Point-on-segment requires a point and a linear/curve segment.' };
      }
      let dist = Number.POSITIVE_INFINITY;
      if (segRef.segment && segRef.segment.kind === 'cubic-bezier' && segRef.segment.p1 && segRef.segment.p2) {
        const res = closestPointOnCubicBezier(
          ptRef.point,
          segRef.segment.p0,
          segRef.segment.p1,
          segRef.segment.p2,
          segRef.segment.p3
        );
        if (!res.ok) {
          return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'cm', message: 'Closest-point evaluation failed on curve.' };
        }
        dist = res.distanceCm;
      } else {
        const res = closestPointOnLineSegment(ptRef.point, segRef.start, segRef.end);
        if (!res.ok) {
          return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'cm', message: 'Closest-point evaluation failed on line.' };
        }
        dist = res.distanceCm;
      }
      return {
        constraintId: constraint.id,
        status: dist <= tol ? 'satisfied' : 'violated',
        residual: dist,
        unit: 'cm',
        message: `Distance to segment: ${dist.toFixed(4)} cm (tol ${tol.toFixed(3)} cm).`
      };
    }

    case 'distance-cm': {
      const [t0, t1] = targets;
      if (!t0 || !t1) {
        return { constraintId: constraint.id, status: 'invalidated', residual: null, unit: 'cm', message: 'Distance constraint requires two entities.' };
      }
      const pA = t0.kind === 'point' ? t0.point : t0.start;
      const pB = t1.kind === 'point' ? t1.point : t1.start;
      const actual = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      const targetVal = typeof constraint.targetValue === 'number' && Number.isFinite(constraint.targetValue)
        ? constraint.targetValue
        : actual;
      const residual = Math.abs(actual - targetVal);
      return {
        constraintId: constraint.id,
        status: residual <= tol ? 'satisfied' : 'violated',
        residual,
        unit: 'cm',
        message: `Measured ${actual.toFixed(3)} cm vs target ${targetVal.toFixed(3)} cm (Δ ${residual.toFixed(3)} cm).`
      };
    }
  }
}

export function evaluateAllGeometricConstraints(
  constraints: Readonly<Record<string, GeometricConstraint>>,
  piecesById: ReadonlyMap<string, PatternPieceRenderModel>,
  constructions: Readonly<Record<string, ConstructionEntity>>,
  notchesByPieceId: Readonly<Record<string, readonly ProposedNotchRecord[]>>,
  coordinateFrame: PatternArtifactCoordinateFrame
): Readonly<Record<string, EvaluatedConstraintResult>> {
  const out: Record<string, EvaluatedConstraintResult> = {};
  for (const [id, constraint] of Object.entries(constraints)) {
    out[id] = evaluateGeometricConstraint(
      constraint,
      piecesById.get(constraint.pieceId),
      constructions,
      notchesByPieceId[constraint.pieceId] ?? [],
      coordinateFrame
    );
  }
  return out;
}
