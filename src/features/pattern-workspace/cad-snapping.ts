/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A Phase 0 — Unified CAD Precision Geometry Snapping Engine.
 *
 * Pure, framework-agnostic, unrounded IEEE-754 float64 snapping module for Pattern Atelier
 * geometry tools (Edit Contour, Seam Walk, Construction, Notch/Drill, Dart, Allowance).
 *
 * Keeps board-arrangement layout snapping (`board-arrangement.ts`) strictly separate.
 */

import type {
  PatternArtifactCoordinateFrame,
  RenderCurveSegment,
  RenderPoint2D
} from './contracts/pattern-render-artifact';
import type {
  ConstructionEntity,
  UnifiedSnapConfig,
  UnifiedSnapGuide,
  UnifiedSnapResult,
  UnifiedSnapTargetKind
} from './contracts/wp-a-shared-contracts';
import { DEFAULT_UNIFIED_SNAP_CONFIG } from './contracts/wp-a-shared-contracts';
import {
  closestPointOnCubicBezier,
  closestPointOnLineSegment,
  evaluateCubicBezierUnrounded
} from './entity-hit-test';

export interface SnapCandidateContext {
  readonly sewSegments: readonly RenderCurveSegment[];
  readonly constructions: readonly ConstructionEntity[];
  readonly coordinateFrame: PatternArtifactCoordinateFrame;
  /** Current viewport scale in screen pixels per cm */
  readonly pixelsPerCm: number;
  /** Optional anchor point (e.g., drag start or first line click) for perpendicular/tangent/axis constraints */
  readonly referenceAnchorCm?: RenderPoint2D | null;
  /** When true, constrain direction from referenceAnchorCm to angleConstraintStepDeg */
  readonly constrainAxis?: boolean;
  /** Optional segment IDs to exclude */
  readonly excludeSegmentIds?: ReadonlySet<string>;
  readonly config?: Partial<UnifiedSnapConfig>;
}

interface InternalSnapCandidate {
  readonly kind: Exclude<UnifiedSnapTargetKind, 'none'>;
  readonly priority: number; // Lower is higher priority
  readonly pointCm: RenderPoint2D;
  readonly targetRef: string;
  readonly distanceCm: number;
  readonly guide: UnifiedSnapGuide | null;
}

const SNAP_PRIORITY: Readonly<Record<Exclude<UnifiedSnapTargetKind, 'none'>, number>> = {
  vertex: 1,
  intersection: 2,
  midpoint: 3,
  perpendicular: 4,
  tangent: 5,
  'construction-line': 6,
  'curve-closest': 7,
  grid: 8
};

function isFinitePoint(pt: RenderPoint2D | null | undefined): pt is RenderPoint2D {
  return Boolean(pt && Number.isFinite(pt.x) && Number.isFinite(pt.y));
}

function normalizeZero(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

function distCm(a: RenderPoint2D, b: RenderPoint2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Computes visual compass angle in degrees respecting coordinateFrame (`svg-y-down` vs `cartesian-y-up`),
 * where 0° = +X right and +90° = visually upward.
 */
export function computeVisualAngleDeg(
  from: RenderPoint2D,
  to: RenderPoint2D,
  coordinateFrame: PatternArtifactCoordinateFrame
): number {
  const dx = to.x - from.x;
  const dy = coordinateFrame.yAxisDirection === 'cartesian-y-up' ? to.y - from.y : -(to.y - from.y);
  const rad = Math.atan2(dy, dx);
  const deg = (rad * 180) / Math.PI;
  return normalizeZero(deg < 0 ? deg + 360 : deg);
}

/**
 * Constrains `rawPointCm` onto the nearest angular ray from `anchorCm` in multiples of `stepDeg`,
 * respecting `coordinateFrame`.
 */
export function constrainPointToAngleStep(
  rawPointCm: RenderPoint2D,
  anchorCm: RenderPoint2D,
  stepDeg: number,
  coordinateFrame: PatternArtifactCoordinateFrame
): { readonly pointCm: RenderPoint2D; readonly angleDeg: number } {
  const safeStep = Number.isFinite(stepDeg) && stepDeg > 0 && stepDeg <= 90 ? stepDeg : 45;
  const dx = rawPointCm.x - anchorCm.x;
  const dyVisual =
    coordinateFrame.yAxisDirection === 'cartesian-y-up'
      ? rawPointCm.y - anchorCm.y
      : -(rawPointCm.y - anchorCm.y);
  const r = Math.hypot(dx, dyVisual);
  if (r <= 1e-12) {
    return { pointCm: { x: anchorCm.x, y: anchorCm.y }, angleDeg: 0 };
  }
  const rawDeg = (Math.atan2(dyVisual, dx) * 180) / Math.PI;
  const snappedDeg = Math.round(rawDeg / safeStep) * safeStep;
  const normalizedDeg = ((snappedDeg % 360) + 360) % 360;
  const rad = (normalizedDeg * Math.PI) / 180;
  const projLen = dx * Math.cos(rad) + dyVisual * Math.sin(rad);
  const nextX = anchorCm.x + projLen * Math.cos(rad);
  const nextYVisualDelta = projLen * Math.sin(rad);
  const nextY =
    coordinateFrame.yAxisDirection === 'cartesian-y-up'
      ? anchorCm.y + nextYVisualDelta
      : anchorCm.y - nextYVisualDelta;

  return {
    pointCm: { x: normalizeZero(nextX), y: normalizeZero(nextY) },
    angleDeg: normalizeZero(normalizedDeg)
  };
}

/**
 * Exact infinite or bounded line-line intersection in float64.
 */
export function intersectLines2D(
  a1: RenderPoint2D,
  a2: RenderPoint2D,
  b1: RenderPoint2D,
  b2: RenderPoint2D,
  options: { readonly aInfinite?: boolean; readonly bInfinite?: boolean } = {}
): RenderPoint2D | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-12) return null;

  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const t = (dx * dby - dy * dbx) / denom;
  const u = (dx * day - dy * dax) / denom;

  if (!options.aInfinite && (t < -1e-9 || t > 1 + 1e-9)) return null;
  if (!options.bInfinite && (u < -1e-9 || u > 1 + 1e-9)) return null;

  return {
    x: normalizeZero(a1.x + t * dax),
    y: normalizeZero(a1.y + t * day)
  };
}

/**
 * Exact line-circle intersection(s) in float64.
 */
export function intersectLineWithCircle2D(
  p1: RenderPoint2D,
  p2: RenderPoint2D,
  center: RenderPoint2D,
  radiusCm: number,
  infinite = false
): RenderPoint2D[] {
  if (!Number.isFinite(radiusCm) || radiusCm <= 1e-9) return [];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const a = dx * dx + dy * dy;
  if (a <= 1e-15) return [];

  const fx = p1.x - center.x;
  const fy = p1.y - center.y;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radiusCm * radiusCm;
  const disc = b * b - 4 * a * c;
  if (disc < -1e-12) return [];

  const sqrtDisc = Math.sqrt(Math.max(0, disc));
  const ts =
    sqrtDisc <= 1e-12 ? [-b / (2 * a)] : [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)];

  const out: RenderPoint2D[] = [];
  for (const t of ts) {
    if (!infinite && (t < -1e-9 || t > 1 + 1e-9)) continue;
    out.push({
      x: normalizeZero(p1.x + t * dx),
      y: normalizeZero(p1.y + t * dy)
    });
  }
  return out;
}

/**
 * Exact tangent touch points from external point `anchor` onto circle `(center, radiusCm)`.
 */
export function computeCircleTangentPoints(
  anchor: RenderPoint2D,
  center: RenderPoint2D,
  radiusCm: number
): RenderPoint2D[] {
  if (!Number.isFinite(radiusCm) || radiusCm <= 1e-9) return [];
  const dx = anchor.x - center.x;
  const dy = anchor.y - center.y;
  const d2 = dx * dx + dy * dy;
  const r2 = radiusCm * radiusCm;
  if (d2 <= r2 + 1e-9) return [];

  const d = Math.sqrt(d2);
  const l = r2 / d;
  const h = (radiusCm * Math.sqrt(d2 - r2)) / d;
  const ux = dx / d;
  const uy = dy / d;
  const px = -uy;
  const py = ux;

  return [
    {
      x: normalizeZero(center.x + l * ux + h * px),
      y: normalizeZero(center.y + l * uy + h * py)
    },
    {
      x: normalizeZero(center.x + l * ux - h * px),
      y: normalizeZero(center.y + l * uy - h * py)
    }
  ];
}

function projectPointOntoLine(
  pt: RenderPoint2D,
  a: RenderPoint2D,
  b: RenderPoint2D,
  bounded: boolean
): { readonly pointCm: RenderPoint2D; readonly t: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-15) return null;
  let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
  if (bounded) {
    t = Math.max(0, Math.min(1, t));
  }
  return {
    pointCm: { x: normalizeZero(a.x + t * dx), y: normalizeZero(a.y + t * dy) },
    t
  };
}

/**
 * Evaluates unified CAD geometry snapping with zoom-normalized tolerance and deterministic
 * priority + tie-breaking.
 */
export function evaluateUnifiedCadSnap(
  rawPointCm: RenderPoint2D,
  ctx: SnapCandidateContext
): UnifiedSnapResult {
  const cfg: UnifiedSnapConfig = {
    ...DEFAULT_UNIFIED_SNAP_CONFIG,
    ...(ctx.config ?? {})
  };

  if (!isFinitePoint(rawPointCm)) {
    return {
      pointCm: { x: 0, y: 0 },
      kind: 'none',
      targetRef: null,
      distanceCm: 0,
      constrainedAxisAngleDeg: null,
      guide: null
    };
  }

  let workingPoint = { x: normalizeZero(rawPointCm.x), y: normalizeZero(rawPointCm.y) };
  let constrainedAxisAngleDeg: number | null = null;
  let axisGuide: UnifiedSnapGuide | null = null;

  if (ctx.constrainAxis && isFinitePoint(ctx.referenceAnchorCm)) {
    const constrained = constrainPointToAngleStep(
      workingPoint,
      ctx.referenceAnchorCm,
      cfg.angleConstraintStepDeg,
      ctx.coordinateFrame
    );
    workingPoint = constrained.pointCm;
    constrainedAxisAngleDeg = constrained.angleDeg;
    axisGuide = {
      kind: 'axis',
      startCm: ctx.referenceAnchorCm,
      endCm: workingPoint,
      label: `${constrained.angleDeg.toFixed(0)}°`
    };
  }

  if (!cfg.enabled) {
    return {
      pointCm: workingPoint,
      kind: 'none',
      targetRef: null,
      distanceCm: 0,
      constrainedAxisAngleDeg,
      guide: axisGuide
    };
  }

  const safePxPerCm = Number.isFinite(ctx.pixelsPerCm) && ctx.pixelsPerCm > 1e-6 ? ctx.pixelsPerCm : 12;
  const snapRadiusCm = Math.max(0.05, cfg.snapTolerancePx / safePxPerCm);
  const candidates: InternalSnapCandidate[] = [];

  const pushCandidate = (
    kind: Exclude<UnifiedSnapTargetKind, 'none'>,
    pointCm: RenderPoint2D,
    targetRef: string,
    guide: UnifiedSnapGuide | null = null
  ) => {
    if (!isFinitePoint(pointCm)) return;
    const d = distCm(workingPoint, pointCm);
    if (d <= snapRadiusCm) {
      candidates.push({
        kind,
        priority: SNAP_PRIORITY[kind],
        pointCm: { x: normalizeZero(pointCm.x), y: normalizeZero(pointCm.y) },
        targetRef,
        distanceCm: d,
        guide
      });
    }
  };

  const activeSegments = ctx.sewSegments.filter(
    (s) => !ctx.excludeSegmentIds || !ctx.excludeSegmentIds.has(s.id)
  );
  const visibleConstructions = ctx.constructions.filter((c) => c.visible);

  const linearPrimitives: Array<{
    readonly ref: string;
    readonly a: RenderPoint2D;
    readonly b: RenderPoint2D;
    readonly infinite: boolean;
    readonly isConstruction: boolean;
  }> = [];

  for (const seg of activeSegments) {
    if (cfg.vertexSnapEnabled) {
      pushCandidate('vertex', seg.p0, `seg:${seg.id}:p0`);
      pushCandidate('vertex', seg.p3, `seg:${seg.id}:p3`);
    }
    if (cfg.midpointSnapEnabled) {
      const mid =
        seg.kind === 'cubic-bezier' && seg.p1 && seg.p2
          ? evaluateCubicBezierUnrounded(seg.p0, seg.p1, seg.p2, seg.p3, 0.5)
          : { x: 0.5 * (seg.p0.x + seg.p3.x), y: 0.5 * (seg.p0.y + seg.p3.y) };
      pushCandidate('midpoint', mid, `seg:${seg.id}:mid`);
    }
    if (cfg.curveSnapEnabled) {
      const closest =
        seg.kind === 'cubic-bezier' && seg.p1 && seg.p2
          ? closestPointOnCubicBezier(workingPoint, seg.p0, seg.p1, seg.p2, seg.p3)
          : closestPointOnLineSegment(workingPoint, seg.p0, seg.p3);
      if (closest.ok) {
        pushCandidate('curve-closest', closest.pointCm, `seg:${seg.id}:t=${closest.parameterT.toFixed(4)}`);
      }
    }
    if (seg.kind === 'line') {
      linearPrimitives.push({
        ref: `seg:${seg.id}`,
        a: seg.p0,
        b: seg.p3,
        infinite: false,
        isConstruction: false
      });
    }
  }

  for (const entity of visibleConstructions) {
    if (
      entity.kind === 'construction-line' ||
      entity.kind === 'construction-ray' ||
      entity.kind === 'reference-axis' ||
      entity.kind === 'parallel-guide' ||
      entity.kind === 'perpendicular-guide'
    ) {
      const isInfinite = entity.kind === 'reference-axis' || entity.kind === 'construction-ray';
      linearPrimitives.push({
        ref: `const:${entity.id}`,
        a: entity.start,
        b: entity.end,
        infinite: isInfinite,
        isConstruction: true
      });
      if (cfg.vertexSnapEnabled) {
        pushCandidate('vertex', entity.start, `const:${entity.id}:start`);
        pushCandidate('vertex', entity.end, `const:${entity.id}:end`);
      }
      if (cfg.midpointSnapEnabled) {
        pushCandidate(
          'midpoint',
          { x: 0.5 * (entity.start.x + entity.end.x), y: 0.5 * (entity.start.y + entity.end.y) },
          `const:${entity.id}:mid`
        );
      }
      if (cfg.constructionSnapEnabled) {
        const proj = projectPointOntoLine(workingPoint, entity.start, entity.end, !isInfinite);
        if (proj) {
          pushCandidate('construction-line', proj.pointCm, `const:${entity.id}:line`, {
            kind: 'construction',
            startCm: entity.start,
            endCm: entity.end,
            label: entity.label
          });
        }
      }
    } else if (entity.kind === 'construction-circle' || entity.kind === 'construction-arc') {
      if (cfg.vertexSnapEnabled) {
        pushCandidate('vertex', entity.center, `const:${entity.id}:center`);
      }
      if (cfg.constructionSnapEnabled && entity.radiusCm > 1e-9) {
        const dx = workingPoint.x - entity.center.x;
        const dy = workingPoint.y - entity.center.y;
        const r = Math.hypot(dx, dy);
        if (r > 1e-9) {
          const onCircle = {
            x: entity.center.x + (dx / r) * entity.radiusCm,
            y: entity.center.y + (dy / r) * entity.radiusCm
          };
          pushCandidate('construction-line', onCircle, `const:${entity.id}:perimeter`);
        }
      }
      if (cfg.tangentSnapEnabled && isFinitePoint(ctx.referenceAnchorCm)) {
        const tangents = computeCircleTangentPoints(ctx.referenceAnchorCm, entity.center, entity.radiusCm);
        tangents.forEach((tp, idx) => {
          pushCandidate('tangent', tp, `const:${entity.id}:tan:${idx}`, {
            kind: 'tangent',
            startCm: ctx.referenceAnchorCm!,
            endCm: tp,
            label: 'Tan'
          });
        });
      }
    } else if (entity.kind === 'internal-line') {
      for (const seg of entity.segments) {
        if (cfg.vertexSnapEnabled) {
          pushCandidate('vertex', seg.p0, `const:${entity.id}:${seg.id}:p0`);
          pushCandidate('vertex', seg.p3, `const:${entity.id}:${seg.id}:p3`);
        }
        if (cfg.constructionSnapEnabled) {
          const closest =
            seg.kind === 'cubic-bezier' && seg.p1 && seg.p2
              ? closestPointOnCubicBezier(workingPoint, seg.p0, seg.p1, seg.p2, seg.p3)
              : closestPointOnLineSegment(workingPoint, seg.p0, seg.p3);
          if (closest.ok) {
            pushCandidate('construction-line', closest.pointCm, `const:${entity.id}:${seg.id}`);
          }
        }
      }
    }
  }

  // Perpendicular foot from referenceAnchorCm onto any linear primitive
  if (cfg.perpendicularSnapEnabled && isFinitePoint(ctx.referenceAnchorCm)) {
    for (const lp of linearPrimitives) {
      const foot = projectPointOntoLine(ctx.referenceAnchorCm, lp.a, lp.b, !lp.infinite);
      if (foot && distCm(ctx.referenceAnchorCm, foot.pointCm) > 1e-6) {
        pushCandidate('perpendicular', foot.pointCm, `perp:${lp.ref}`, {
          kind: 'perpendicular',
          startCm: ctx.referenceAnchorCm,
          endCm: foot.pointCm,
          label: '90°'
        });
      }
    }
  }

  // Pairwise intersections (bounded count for O(N^2) safety)
  if (cfg.intersectionSnapEnabled && linearPrimitives.length <= 80) {
    for (let i = 0; i < linearPrimitives.length; i += 1) {
      const a = linearPrimitives[i];
      for (let j = i + 1; j < linearPrimitives.length; j += 1) {
        const b = linearPrimitives[j];
        const hit = intersectLines2D(a.a, a.b, b.a, b.b, {
          aInfinite: a.infinite,
          bInfinite: b.infinite
        });
        if (hit) {
          pushCandidate('intersection', hit, `ix:${a.ref}x${b.ref}`);
        }
      }
      for (const c of visibleConstructions) {
        if (c.kind === 'construction-circle' || c.kind === 'construction-arc') {
          const hits = intersectLineWithCircle2D(a.a, a.b, c.center, c.radiusCm, a.infinite);
          hits.forEach((pt, idx) => {
            pushCandidate('intersection', pt, `ix:${a.ref}xconst:${c.id}:${idx}`);
          });
        }
      }
    }
  }

  // Grid snap (lowest priority fallback)
  if (cfg.gridSnapEnabled && Number.isFinite(cfg.gridStepCm) && cfg.gridStepCm > 0) {
    const gx = Math.round(workingPoint.x / cfg.gridStepCm) * cfg.gridStepCm;
    const gy = Math.round(workingPoint.y / cfg.gridStepCm) * cfg.gridStepCm;
    pushCandidate('grid', { x: gx, y: gy }, `grid:${gx.toFixed(3)},${gy.toFixed(3)}`);
  }

  if (candidates.length === 0) {
    return {
      pointCm: workingPoint,
      kind: 'none',
      targetRef: null,
      distanceCm: 0,
      constrainedAxisAngleDeg,
      guide: axisGuide
    };
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (Math.abs(a.distanceCm - b.distanceCm) > 1e-12) return a.distanceCm - b.distanceCm;
    return a.targetRef.localeCompare(b.targetRef);
  });

  const best = candidates[0];
  return {
    pointCm: best.pointCm,
    kind: best.kind,
    targetRef: best.targetRef,
    distanceCm: best.distanceCm,
    constrainedAxisAngleDeg,
    guide: best.guide ?? axisGuide
  };
}
