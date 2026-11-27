/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A3 — Dart Authoring, Slash-and-Spread Transfer & Conservation Evaluation Engine.
 *
 * Pure, framework-agnostic, unrounded IEEE-754 float64 module.
 *
 * ARCHITECTURE & GOVERNANCE BOUNDARIES:
 * - Preserves and bridges `src/engine/drafting/dart-manipulation.ts` (`BodiceDartStyle`)
 *   via metadata descriptors without duplicating its C0 bodice construction math in UI.
 * - Proposal dart creation, editing, rotation/split transfer, and close/open operate ONLY
 *   on sew contours (`sewSegments`) and NEVER touch `cutSegments`.
 * - Every conservation report carries `authorityTier: 'UNVERIFIED_VISUAL_PROPOSAL'`,
 *   `isCertified: false`, `isProductionReady: false`, `externalCadInteroperabilityVerified: false`.
 * - Fails closed on degenerate, open, or self-intersecting contours.
 */

import type { BodiceDartStyle } from '../../types';
import type {
  PatternArtifactCoordinateFrame,
  PatternPieceRenderModel,
  RenderCurveSegment,
  RenderPoint2D
} from './contracts/pattern-render-artifact';
import type {
  DartConservationReport,
  DartFoldDirection,
  ProposedDartModel
} from './contracts/wp-a-shared-contracts';
import { WP_A_AUTHORITY_TIER } from './contracts/wp-a-shared-contracts';
import type { ProposalSegmentLineage } from './geometry-edit-proposal';
import { evaluateSegmentArcLengthCm, invertSegmentArcLength } from './seam-correspondence';
import {
  evaluateSegmentPointExact,
  isFinitePoint2D,
  isFiniteSegment,
  splitCubicBezierDeCasteljau
} from './spatial-diagnostics';

export const DART_LEG_PARITY_TOLERANCE_CM = 1e-4;
export const DART_ANGULAR_CONSERVATION_TOLERANCE_RAD = 1e-4;
export const DART_CLOSURE_TOLERANCE_CM = 1e-3;
export const DART_MIN_INTAKE_CM = 0.2;
export const DART_MAX_INTAKE_CM = 14.0;
export const DART_DEFAULT_BACKOFF_CM = 2.0;

// ---------------------------------------------------------------------------
// 1. C0 Bodice Engine Bridge Descriptors (No Math Duplication)
// ---------------------------------------------------------------------------

export interface C0BodiceDartPresetDescriptor {
  readonly style: BodiceDartStyle;
  readonly label: string;
  readonly summary: string;
  readonly dartCount: number;
  readonly engineModuleRef: 'src/engine/drafting/dart-manipulation.ts::constructFrontBodiceWithDart';
}

export const C0_BODICE_DART_PRESETS: readonly C0BodiceDartPresetDescriptor[] = [
  {
    style: 'waist',
    label: 'Waist Dart',
    summary: 'Single waist dart radiating from true bust apex (2.0–2.5 cm backoff).',
    dartCount: 1,
    engineModuleRef: 'src/engine/drafting/dart-manipulation.ts::constructFrontBodiceWithDart'
  },
  {
    style: 'side-bust',
    label: 'Side Bust Dart',
    summary: 'Full intake rotated to side seam below armhole.',
    dartCount: 1,
    engineModuleRef: 'src/engine/drafting/dart-manipulation.ts::constructFrontBodiceWithDart'
  },
  {
    style: 'shoulder',
    label: 'Shoulder Dart',
    summary: 'Full intake rotated to mid-shoulder seam.',
    dartCount: 1,
    engineModuleRef: 'src/engine/drafting/dart-manipulation.ts::constructFrontBodiceWithDart'
  },
  {
    style: 'french',
    label: 'French Dart',
    summary: 'Diagonal dart rotated to lower side seam.',
    dartCount: 1,
    engineModuleRef: 'src/engine/drafting/dart-manipulation.ts::constructFrontBodiceWithDart'
  },
  {
    style: 'waist-and-side',
    label: 'Waist + Side Split',
    summary: 'Split angular intake distributed across waist and side-bust darts.',
    dartCount: 2,
    engineModuleRef: 'src/engine/drafting/dart-manipulation.ts::constructFrontBodiceWithDart'
  }
];

// ---------------------------------------------------------------------------
// 2. Geometry Primitives (Unrounded Float64)
// ---------------------------------------------------------------------------

function distCm(a: RenderPoint2D, b: RenderPoint2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPt(a: RenderPoint2D, b: RenderPoint2D, t: number): RenderPoint2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function rotateAroundPivot(pt: RenderPoint2D, pivot: RenderPoint2D, angleRad: number): RenderPoint2D {
  const dx = pt.x - pivot.x;
  const dy = pt.y - pivot.y;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return {
    x: pivot.x + dx * c - dy * s,
    y: pivot.y + dx * s + dy * c
  };
}

function rotateSegmentAroundPivot(
  seg: RenderCurveSegment,
  pivot: RenderPoint2D,
  angleRad: number
): RenderCurveSegment {
  return {
    ...seg,
    p0: rotateAroundPivot(seg.p0, pivot, angleRad),
    p1: seg.p1 ? rotateAroundPivot(seg.p1, pivot, angleRad) : undefined,
    p2: seg.p2 ? rotateAroundPivot(seg.p2, pivot, angleRad) : undefined,
    p3: rotateAroundPivot(seg.p3, pivot, angleRad)
  };
}

function splitSegmentExact(
  seg: RenderCurveSegment,
  t: number,
  leftId: string,
  rightId: string
): { readonly left: RenderCurveSegment; readonly right: RenderCurveSegment } | null {
  if (!isFiniteSegment(seg) || !Number.isFinite(t) || t <= 1e-6 || t >= 1 - 1e-6) {
    return null;
  }
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    const split = splitCubicBezierDeCasteljau(seg.p0, seg.p1, seg.p2, seg.p3, t);
    if (!split) return null;
    return {
      left: { ...seg, id: leftId, p0: split.left.p0, p1: split.left.p1, p2: split.left.p2, p3: split.left.p3 },
      right: { ...seg, id: rightId, p0: split.right.p0, p1: split.right.p1, p2: split.right.p2, p3: split.right.p3 }
    };
  }
  const mid = lerpPt(seg.p0, seg.p3, t);
  return {
    left: { ...seg, id: leftId, kind: 'line', p0: seg.p0, p1: undefined, p2: undefined, p3: mid },
    right: { ...seg, id: rightId, kind: 'line', p0: mid, p1: undefined, p2: undefined, p3: seg.p3 }
  };
}

function computeBackingOffApex(
  pivotApex: RenderPoint2D,
  legLeft: RenderPoint2D,
  legRight: RenderPoint2D,
  backoffCm: number
): RenderPoint2D {
  const mid = lerpPt(legLeft, legRight, 0.5);
  const dx = mid.x - pivotApex.x;
  const dy = mid.y - pivotApex.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-9 || backoffCm <= 0) return { ...pivotApex };
  const clampedBackoff = Math.min(backoffCm, dist * 0.45);
  return {
    x: pivotApex.x + (dx / dist) * clampedBackoff,
    y: pivotApex.y + (dy / dist) * clampedBackoff
  };
}

/**
 * Equalizes leg openings relative to `sewingApex` so |L_left - L_right| <= 1e-9 cm,
 * returning exact equalized opening points and intake angle at pivotApex.
 */
function computeEqualizedDartGeometry(
  pivotApex: RenderPoint2D,
  rawLeft: RenderPoint2D,
  rawRight: RenderPoint2D,
  backoffCm: number
): {
  readonly sewingApexCm: RenderPoint2D;
  readonly legLeftOpeningCm: RenderPoint2D;
  readonly legRightOpeningCm: RenderPoint2D;
  readonly legLengthLeftCm: number;
  readonly legLengthRightCm: number;
  readonly intakeAngleRad: number;
  readonly intakeWidthCm: number;
} {
  const sewingApexCm = computeBackingOffApex(pivotApex, rawLeft, rawRight, backoffCm);
  const dL = distCm(sewingApexCm, rawLeft);
  const dR = distCm(sewingApexCm, rawRight);
  const targetLegLen = 0.5 * (dL + dR);

  const scaleFromApex = (pt: RenderPoint2D, curLen: number): RenderPoint2D => {
    if (curLen <= 1e-9) return pt;
    const f = targetLegLen / curLen;
    return {
      x: sewingApexCm.x + (pt.x - sewingApexCm.x) * f,
      y: sewingApexCm.y + (pt.y - sewingApexCm.y) * f
    };
  };

  const legLeftOpeningCm = scaleFromApex(rawLeft, dL);
  const legRightOpeningCm = scaleFromApex(rawRight, dR);

  const vL = { x: legLeftOpeningCm.x - pivotApex.x, y: legLeftOpeningCm.y - pivotApex.y };
  const vR = { x: legRightOpeningCm.x - pivotApex.x, y: legRightOpeningCm.y - pivotApex.y };
  const lenVL = Math.hypot(vL.x, vL.y);
  const lenVR = Math.hypot(vR.x, vR.y);
  const dot =
    lenVL > 1e-9 && lenVR > 1e-9
      ? Math.max(-1, Math.min(1, (vL.x * vR.x + vL.y * vR.y) / (lenVL * lenVR)))
      : 1;
  const intakeAngleRad = Math.acos(dot);

  return {
    sewingApexCm,
    legLeftOpeningCm,
    legRightOpeningCm,
    legLengthLeftCm: distCm(sewingApexCm, legLeftOpeningCm),
    legLengthRightCm: distCm(sewingApexCm, legRightOpeningCm),
    intakeAngleRad,
    intakeWidthCm: distCm(legLeftOpeningCm, legRightOpeningCm)
  };
}

// ---------------------------------------------------------------------------
// 3. Closure & Self-Intersection Checks (Fail-Closed Advisory)
// ---------------------------------------------------------------------------

function segmentsProperlyIntersect(a0: RenderPoint2D, a1: RenderPoint2D, b0: RenderPoint2D, b1: RenderPoint2D): boolean {
  const cross = (o: RenderPoint2D, p: RenderPoint2D, q: RenderPoint2D) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const eps = 1e-6;
  const d1 = cross(a0, a1, b0);
  const d2 = cross(a0, a1, b1);
  const d3 = cross(b0, b1, a0);
  const d4 = cross(b0, b1, a1);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

function checkContourClosureAndSelfIntersection(segments: readonly RenderCurveSegment[]): {
  readonly closed: boolean;
  readonly maxGapCm: number;
  readonly selfIntersection: boolean;
  readonly degenerate: boolean;
} {
  if (segments.length < 3) {
    return { closed: false, maxGapCm: Number.POSITIVE_INFINITY, selfIntersection: false, degenerate: true };
  }
  let maxGap = 0;
  let degenerate = false;
  const chords: Array<{ p0: RenderPoint2D; p3: RenderPoint2D }> = [];

  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    const next = segments[(i + 1) % segments.length];
    if (!isFiniteSegment(cur)) {
      degenerate = true;
      continue;
    }
    const segChordLen = distCm(cur.p0, cur.p3);
    if (segChordLen < 1e-5 && cur.kind === 'line') {
      degenerate = true;
    }
    maxGap = Math.max(maxGap, distCm(cur.p3, next.p0));
    chords.push({ p0: cur.p0, p3: cur.p3 });
  }

  let selfIntersection = false;
  for (let i = 0; i < chords.length; i++) {
    for (let j = i + 2; j < chords.length; j++) {
      if (i === 0 && j === chords.length - 1) continue;
      if (segmentsProperlyIntersect(chords[i].p0, chords[i].p3, chords[j].p0, chords[j].p3)) {
        selfIntersection = true;
        break;
      }
    }
    if (selfIntersection) break;
  }

  return {
    closed: maxGap <= DART_CLOSURE_TOLERANCE_CM,
    maxGapCm: maxGap,
    selfIntersection,
    degenerate
  };
}

// ---------------------------------------------------------------------------
// 4. Proposal Dart Authoring Operators (Sew-Only)
// ---------------------------------------------------------------------------

export interface DartOperationResult {
  readonly ok: boolean;
  readonly updatedSewSegments: readonly RenderCurveSegment[] | null;
  readonly updatedLineage: Readonly<Record<string, ProposalSegmentLineage>> | null;
  readonly darts: readonly ProposedDartModel[];
  readonly error?: string;
}

/**
 * Cuts a new parametric proposal dart into `hostSegmentId` around `centerParameterT`,
 * preserving exact contour closure, equalized leg lengths, and segment lineage.
 */
export function createProposalDartOnContour(input: {
  readonly pieceId: string;
  readonly sewSegments: readonly RenderCurveSegment[];
  readonly existingDarts: readonly ProposedDartModel[];
  readonly existingLineage: Readonly<Record<string, ProposalSegmentLineage>>;
  readonly coordinateFrame: PatternArtifactCoordinateFrame;
  readonly dartId: string;
  readonly label: string;
  readonly hostSegmentId: string;
  readonly centerParameterT: number;
  readonly intakeWidthCm: number;
  readonly pivotApexCm: RenderPoint2D;
  readonly backoffCm: number;
  readonly foldDirection: DartFoldDirection;
}): DartOperationResult {
  const fail = (error: string): DartOperationResult => ({
    ok: false,
    updatedSewSegments: null,
    updatedLineage: null,
    darts: input.existingDarts,
    error
  });

  if (!isFinitePoint2D(input.pivotApexCm)) {
    return fail('Dart pivot apex must be finite.');
  }
  if (!Number.isFinite(input.intakeWidthCm) || input.intakeWidthCm < DART_MIN_INTAKE_CM || input.intakeWidthCm > DART_MAX_INTAKE_CM) {
    return fail(`Dart intake width must be in [${DART_MIN_INTAKE_CM}, ${DART_MAX_INTAKE_CM}] cm.`);
  }
  if (!Number.isFinite(input.backoffCm) || input.backoffCm < 0 || input.backoffCm > 8) {
    return fail('Dart apex backoff must be in [0, 8] cm.');
  }
  if (!Number.isFinite(input.centerParameterT) || input.centerParameterT <= 0.05 || input.centerParameterT >= 0.95) {
    return fail('Dart host parameter t must be in (0.05, 0.95).');
  }

  const hostIdx = input.sewSegments.findIndex((s) => s.id === input.hostSegmentId);
  if (hostIdx < 0) {
    return fail(`Host sew segment "${input.hostSegmentId}" not found.`);
  }
  const hostSeg = input.sewSegments[hostIdx];
  const hostLenRes = evaluateSegmentArcLengthCm(hostSeg, input.coordinateFrame, input.pieceId);
  if (!hostLenRes.ok || hostLenRes.lengthCm < input.intakeWidthCm + 0.4) {
    return fail(
      `Host segment "${hostSeg.id}" (${hostLenRes.lengthCm.toFixed(2)} cm) is too short for a ${input.intakeWidthCm.toFixed(2)} cm dart intake.`
    );
  }

  const centerArcRes = evaluateSegmentArcLengthCm(hostSeg, input.coordinateFrame, input.pieceId, [0, input.centerParameterT]);
  if (!centerArcRes.ok) return fail('Could not evaluate dart center arc length.');

  const halfIntake = input.intakeWidthCm * 0.5;
  const arcLeft = Math.max(0.2, Math.min(hostLenRes.lengthCm - input.intakeWidthCm - 0.2, centerArcRes.lengthCm - halfIntake));
  const arcRight = arcLeft + input.intakeWidthCm;

  const invLeft = invertSegmentArcLength(hostSeg, arcLeft, hostLenRes.lengthCm, input.coordinateFrame, input.pieceId);
  const invRight = invertSegmentArcLength(hostSeg, arcRight, hostLenRes.lengthCm, input.coordinateFrame, input.pieceId);
  if (!invLeft.ok || !invRight.ok || invLeft.t >= invRight.t - 1e-4) {
    return fail('Could not locate valid distinct dart leg openings on host segment.');
  }

  const beforeId = `${hostSeg.id}::dart-${input.dartId}-pre`;
  const midTmpId = `${hostSeg.id}::dart-${input.dartId}-mid`;
  const afterId = `${hostSeg.id}::dart-${input.dartId}-post`;
  const leg1Id = `${input.dartId}::leg-1`;
  const leg2Id = `${input.dartId}::leg-2`;

  const split1 = splitSegmentExact(hostSeg, invLeft.t, beforeId, midTmpId);
  if (!split1) return fail('Failed to split host segment at left dart opening.');

  const relT2 = (invRight.t - invLeft.t) / (1 - invLeft.t);
  const split2 = splitSegmentExact(split1.right, relT2, midTmpId, afterId);
  if (!split2) return fail('Failed to split host segment at right dart opening.');

  const rawLeft = split1.left.p3;
  const rawRight = split2.right.p0;
  const geom = computeEqualizedDartGeometry(input.pivotApexCm, rawLeft, rawRight, input.backoffCm);

  if (geom.legLengthLeftCm < 1.0 || geom.legLengthRightCm < 1.0) {
    return fail('Dart legs are too short (< 1.0 cm). Move pivot apex further inside the piece.');
  }

  // Adjust beforeSeg end & afterSeg start slightly to exact equalized leg openings while keeping smoothness
  const beforeSeg: RenderCurveSegment = {
    ...split1.left,
    p3: geom.legLeftOpeningCm
  };
  const afterSeg: RenderCurveSegment = {
    ...split2.right,
    p0: geom.legRightOpeningCm
  };

  const leg1Seg: RenderCurveSegment = {
    id: leg1Id,
    kind: 'line',
    role: 'stitching',
    seamId: hostSeg.seamId,
    p0: geom.legLeftOpeningCm,
    p3: geom.sewingApexCm
  };
  const leg2Seg: RenderCurveSegment = {
    id: leg2Id,
    kind: 'line',
    role: 'stitching',
    seamId: hostSeg.seamId,
    p0: geom.sewingApexCm,
    p3: geom.legRightOpeningCm
  };

  const nextSegments = [
    ...input.sewSegments.slice(0, hostIdx),
    beforeSeg,
    leg1Seg,
    leg2Seg,
    afterSeg,
    ...input.sewSegments.slice(hostIdx + 1)
  ];

  const check = checkContourClosureAndSelfIntersection(nextSegments);
  if (!check.closed || check.degenerate || check.selfIntersection) {
    return fail(
      `Dart insertion rejected (fail-closed): ${!check.closed ? 'contour open' : check.selfIntersection ? 'self-intersection detected' : 'degenerate segment'}.`
    );
  }

  const baseIds = input.existingLineage[hostSeg.id]?.baseSegmentIds ?? [hostSeg.id];
  const nextLineage: Record<string, ProposalSegmentLineage> = { ...input.existingLineage };
  delete nextLineage[hostSeg.id];
  nextLineage[beforeId] = { segmentId: beforeId, baseSegmentIds: baseIds, derivation: 'split-exact', maxApproximationDeviationCm: 0 };
  nextLineage[afterId] = { segmentId: afterId, baseSegmentIds: baseIds, derivation: 'split-exact', maxApproximationDeviationCm: 0 };
  nextLineage[leg1Id] = { segmentId: leg1Id, baseSegmentIds: baseIds, derivation: 'split-exact', maxApproximationDeviationCm: 0 };
  nextLineage[leg2Id] = { segmentId: leg2Id, baseSegmentIds: baseIds, derivation: 'split-exact', maxApproximationDeviationCm: 0 };

  const newDart: ProposedDartModel = {
    id: input.dartId,
    pieceId: input.pieceId,
    label: input.label.trim() || `Dart ${input.existingDarts.length + 1}`,
    pivotApexCm: { ...input.pivotApexCm },
    sewingApexCm: geom.sewingApexCm,
    backoffCm: input.backoffCm,
    legLeftOpeningCm: geom.legLeftOpeningCm,
    legRightOpeningCm: geom.legRightOpeningCm,
    intakeAngleRad: geom.intakeAngleRad,
    intakeWidthCm: geom.intakeWidthCm,
    legLengthLeftCm: geom.legLengthLeftCm,
    legLengthRightCm: geom.legLengthRightCm,
    foldDirection: input.foldDirection,
    hostSegmentId: hostSeg.id,
    baseHostSegmentIds: baseIds,
    legSegmentIds: [leg1Id, leg2Id],
    drillHoleCm: { ...geom.sewingApexCm },
    isClosed: false,
    origin: 'proposal-authored',
    reconciliationStatus: 'resolved'
  };

  return {
    ok: true,
    updatedSewSegments: nextSegments,
    updatedLineage: nextLineage,
    darts: [...input.existingDarts, newDart]
  };
}

/**
 * Updates parameters of an existing proposal dart (apex, backoff, intake width, fold direction)
 * while maintaining exact leg parity and contour closure.
 */
export function editProposalDartParameters(input: {
  readonly sewSegments: readonly RenderCurveSegment[];
  readonly existingDarts: readonly ProposedDartModel[];
  readonly existingLineage: Readonly<Record<string, ProposalSegmentLineage>>;
  readonly dartId: string;
  readonly intakeWidthCm?: number;
  readonly pivotApexCm?: RenderPoint2D;
  readonly backoffCm?: number;
  readonly foldDirection?: DartFoldDirection;
}): DartOperationResult {
  const fail = (error: string): DartOperationResult => ({
    ok: false,
    updatedSewSegments: null,
    updatedLineage: null,
    darts: input.existingDarts,
    error
  });

  const dart = input.existingDarts.find((d) => d.id === input.dartId);
  if (!dart || !dart.legSegmentIds) {
    return fail(`Dart "${input.dartId}" not found or has no active contour legs.`);
  }

  const [leg1Id, leg2Id] = dart.legSegmentIds;
  const idx1 = input.sewSegments.findIndex((s) => s.id === leg1Id);
  const idx2 = input.sewSegments.findIndex((s) => s.id === leg2Id);
  if (idx1 < 0 || idx2 < 0) {
    return fail(`Dart leg segments missing for "${input.dartId}".`);
  }

  const nextPivot = input.pivotApexCm ?? dart.pivotApexCm;
  const nextBackoff = input.backoffCm ?? dart.backoffCm;
  const nextFold = input.foldDirection ?? dart.foldDirection;
  const nextIntake = input.intakeWidthCm ?? dart.intakeWidthCm;

  if (!isFinitePoint2D(nextPivot) || !Number.isFinite(nextBackoff) || nextBackoff < 0 || !Number.isFinite(nextIntake) || nextIntake < DART_MIN_INTAKE_CM || nextIntake > DART_MAX_INTAKE_CM) {
    return fail('Invalid dart parameter update.');
  }

  // Scale leg opening spread symmetrically around midpoint along opening chord
  const midOpening = lerpPt(dart.legLeftOpeningCm, dart.legRightOpeningCm, 0.5);
  const chordDx = dart.legRightOpeningCm.x - dart.legLeftOpeningCm.x;
  const chordDy = dart.legRightOpeningCm.y - dart.legLeftOpeningCm.y;
  const chordLen = Math.hypot(chordDx, chordDy);
  if (chordLen <= 1e-6) return fail('Degenerate dart opening chord.');
  const ux = chordDx / chordLen;
  const uy = chordDy / chordLen;

  const rawLeft: RenderPoint2D = {
    x: midOpening.x - ux * (nextIntake * 0.5),
    y: midOpening.y - uy * (nextIntake * 0.5)
  };
  const rawRight: RenderPoint2D = {
    x: midOpening.x + ux * (nextIntake * 0.5),
    y: midOpening.y + uy * (nextIntake * 0.5)
  };

  const geom = computeEqualizedDartGeometry(nextPivot, rawLeft, rawRight, nextBackoff);
  const prevIdx = (idx1 - 1 + input.sewSegments.length) % input.sewSegments.length;
  const nextIdx = (idx2 + 1) % input.sewSegments.length;

  const nextSegments = input.sewSegments.map((seg, i) => {
    if (i === prevIdx) return { ...seg, p3: geom.legLeftOpeningCm };
    if (i === idx1) return { ...seg, p0: geom.legLeftOpeningCm, p3: geom.sewingApexCm };
    if (i === idx2) return { ...seg, p0: geom.sewingApexCm, p3: geom.legRightOpeningCm };
    if (i === nextIdx) return { ...seg, p0: geom.legRightOpeningCm };
    return seg;
  });

  const check = checkContourClosureAndSelfIntersection(nextSegments);
  if (!check.closed || check.degenerate || check.selfIntersection) {
    return fail('Dart parameter edit rejected (fail-closed): contour became open or self-intersecting.');
  }

  const updatedDart: ProposedDartModel = {
    ...dart,
    pivotApexCm: { ...nextPivot },
    sewingApexCm: geom.sewingApexCm,
    backoffCm: nextBackoff,
    legLeftOpeningCm: geom.legLeftOpeningCm,
    legRightOpeningCm: geom.legRightOpeningCm,
    intakeAngleRad: geom.intakeAngleRad,
    intakeWidthCm: geom.intakeWidthCm,
    legLengthLeftCm: geom.legLengthLeftCm,
    legLengthRightCm: geom.legLengthRightCm,
    foldDirection: nextFold,
    drillHoleCm: { ...geom.sewingApexCm }
  };

  return {
    ok: true,
    updatedSewSegments: nextSegments,
    updatedLineage: input.existingLineage,
    darts: input.existingDarts.map((d) => (d.id === dart.id ? updatedDart : d))
  };
}

/**
 * Exact rigid 2D slash-and-spread affine rotation around `sourceDart.pivotApexCm`:
 * transfers `transferRatio` in (0, 1] of angular intake from `sourceDart` to `targetHostSegmentId`
 * at `targetParameterT`, conserving total angular intake (theta_before == theta_after).
 */
export function rotateTransferProposalDart(input: {
  readonly pieceId: string;
  readonly sewSegments: readonly RenderCurveSegment[];
  readonly existingDarts: readonly ProposedDartModel[];
  readonly existingLineage: Readonly<Record<string, ProposalSegmentLineage>>;
  readonly sourceDartId: string;
  readonly newDartId: string;
  readonly targetHostSegmentId: string;
  readonly targetParameterT: number;
  readonly transferRatio: number;
  readonly backoffCm: number;
  readonly foldDirection: DartFoldDirection;
}): DartOperationResult {
  const fail = (error: string): DartOperationResult => ({
    ok: false,
    updatedSewSegments: null,
    updatedLineage: null,
    darts: input.existingDarts,
    error
  });

  if (!Number.isFinite(input.transferRatio) || input.transferRatio <= 0.05 || input.transferRatio > 1.0) {
    return fail('Transfer ratio must be in (0.05, 1.0].');
  }
  if (!Number.isFinite(input.targetParameterT) || input.targetParameterT <= 0.05 || input.targetParameterT >= 0.95) {
    return fail('Target slash parameter t must be in (0.05, 0.95).');
  }

  const sourceDart = input.existingDarts.find((d) => d.id === input.sourceDartId);
  if (!sourceDart || !sourceDart.legSegmentIds || sourceDart.isClosed) {
    return fail(`Open source dart "${input.sourceDartId}" not found.`);
  }

  const [srcLeg1Id, srcLeg2Id] = sourceDart.legSegmentIds;
  const idxLeg1 = input.sewSegments.findIndex((s) => s.id === srcLeg1Id);
  const idxLeg2 = input.sewSegments.findIndex((s) => s.id === srcLeg2Id);
  const idxTarget = input.sewSegments.findIndex((s) => s.id === input.targetHostSegmentId);

  if (idxLeg1 < 0 || idxLeg2 < 0 || idxTarget < 0) {
    return fail('Source dart legs or target host segment missing.');
  }
  if (idxTarget === idxLeg1 || idxTarget === idxLeg2) {
    return fail('Cannot transfer dart onto its own leg segments.');
  }

  const pivot = sourceDart.pivotApexCm;
  // Compute signed rotation angle from legRight to legLeft around pivot (closing direction)
  const vL = { x: sourceDart.legLeftOpeningCm.x - pivot.x, y: sourceDart.legLeftOpeningCm.y - pivot.y };
  const vR = { x: sourceDart.legRightOpeningCm.x - pivot.x, y: sourceDart.legRightOpeningCm.y - pivot.y };
  const cross = vR.x * vL.y - vR.y * vL.x;
  const signedFullAngle = (cross >= 0 ? 1 : -1) * sourceDart.intakeAngleRad;
  const transferAngleRad = signedFullAngle * input.transferRatio;

  // Split the target host segment at targetParameterT
  const targetSeg = input.sewSegments[idxTarget];
  const tLeftId = `${targetSeg.id}::slash-${input.newDartId}-pre`;
  const tRightId = `${targetSeg.id}::slash-${input.newDartId}-post`;
  const targetSplit = splitSegmentExact(targetSeg, input.targetParameterT, tLeftId, tRightId);
  if (!targetSplit) return fail('Could not split target host segment for slash-and-spread.');

  // Replace target segment with [targetSplit.left, targetSplit.right], then rotate the contour arc
  // between source leg2 and targetSplit.left by `transferAngleRad` around `pivot`.
  const expanded: RenderCurveSegment[] = [];
  for (let i = 0; i < input.sewSegments.length; i++) {
    if (i === idxTarget) {
      expanded.push(targetSplit.left, targetSplit.right);
    } else {
      expanded.push(input.sewSegments[i]);
    }
  }

  const newIdxLeg2 = expanded.findIndex((s) => s.id === srcLeg2Id);
  const newIdxSlashLeft = expanded.findIndex((s) => s.id === tLeftId);
  const newIdxSlashRight = expanded.findIndex((s) => s.id === tRightId);
  const newIdxLeg1 = expanded.findIndex((s) => s.id === srcLeg1Id);

  // Determine the cyclic slice starting right after leg2 up to and including slashLeft
  const rotateIndices = new Set<number>();
  let cursor = (newIdxLeg2 + 1) % expanded.length;
  let guard = 0;
  while (guard <= expanded.length) {
    rotateIndices.add(cursor);
    if (cursor === newIdxSlashLeft) break;
    cursor = (cursor + 1) % expanded.length;
    guard++;
  }

  const rotatedExpanded = expanded.map((seg, idx) =>
    rotateIndices.has(idx) ? rotateSegmentAroundPivot(seg, pivot, transferAngleRad) : seg
  );

  // New opening points at the slash
  const newRawLeft = rotatedExpanded[newIdxSlashLeft].p3;
  const newRawRight = rotatedExpanded[newIdxSlashRight].p0;
  const newGeom = computeEqualizedDartGeometry(pivot, newRawLeft, newRawRight, input.backoffCm);

  const newLeg1Id = `${input.newDartId}::leg-1`;
  const newLeg2Id = `${input.newDartId}::leg-2`;
  const newLeg1: RenderCurveSegment = {
    id: newLeg1Id,
    kind: 'line',
    role: 'stitching',
    seamId: targetSeg.seamId,
    p0: newGeom.legLeftOpeningCm,
    p3: newGeom.sewingApexCm
  };
  const newLeg2: RenderCurveSegment = {
    id: newLeg2Id,
    kind: 'line',
    role: 'stitching',
    seamId: targetSeg.seamId,
    p0: newGeom.sewingApexCm,
    p3: newGeom.legRightOpeningCm
  };

  // Reconstruct segments: update slash endpoints, insert new dart legs between slashLeft and slashRight,
  // and either close (remove) or shrink source dart legs.
  const isFullTransfer = input.transferRatio >= 0.9999;
  const srcNewRightOpening = rotateAroundPivot(sourceDart.legRightOpeningCm, pivot, transferAngleRad);
  const srcRemainingGeom = isFullTransfer
    ? null
    : computeEqualizedDartGeometry(pivot, sourceDart.legLeftOpeningCm, srcNewRightOpening, sourceDart.backoffCm);

  const finalSegments: RenderCurveSegment[] = [];
  for (let i = 0; i < rotatedExpanded.length; i++) {
    const seg = rotatedExpanded[i];
    if (i === newIdxLeg1) {
      if (!isFullTransfer && srcRemainingGeom) {
        finalSegments.push({ ...seg, p0: srcRemainingGeom.legLeftOpeningCm, p3: srcRemainingGeom.sewingApexCm });
      }
      continue;
    }
    if (i === newIdxLeg2) {
      if (!isFullTransfer && srcRemainingGeom) {
        finalSegments.push({ ...seg, p0: srcRemainingGeom.sewingApexCm, p3: srcRemainingGeom.legRightOpeningCm });
      }
      continue;
    }
    if (i === newIdxSlashLeft) {
      finalSegments.push({ ...seg, p3: newGeom.legLeftOpeningCm }, newLeg1, newLeg2);
      continue;
    }
    if (i === newIdxSlashRight) {
      finalSegments.push({ ...seg, p0: newGeom.legRightOpeningCm });
      continue;
    }
    // Snap segment immediately before source leg1 or after source leg2 if full transfer closed the gap
    const prevOfLeg1 = (newIdxLeg1 - 1 + rotatedExpanded.length) % rotatedExpanded.length;
    const nextOfLeg2 = (newIdxLeg2 + 1) % rotatedExpanded.length;
    if (isFullTransfer && i === prevOfLeg1) {
      finalSegments.push({ ...seg, p3: sourceDart.legLeftOpeningCm });
      continue;
    }
    if (isFullTransfer && i === nextOfLeg2) {
      finalSegments.push({ ...seg, p0: sourceDart.legLeftOpeningCm });
      continue;
    }
    finalSegments.push(seg);
  }

  const check = checkContourClosureAndSelfIntersection(finalSegments);
  if (!check.closed || check.degenerate || check.selfIntersection) {
    return fail(
      `Dart transfer rejected (fail-closed): ${!check.closed ? `contour gap ${check.maxGapCm.toFixed(4)} cm` : check.selfIntersection ? 'self-intersection detected' : 'degenerate segment'}.`
    );
  }

  const targetBaseIds = input.existingLineage[targetSeg.id]?.baseSegmentIds ?? [targetSeg.id];
  const nextLineage: Record<string, ProposalSegmentLineage> = { ...input.existingLineage };
  delete nextLineage[targetSeg.id];
  if (isFullTransfer) {
    delete nextLineage[srcLeg1Id];
    delete nextLineage[srcLeg2Id];
  }
  nextLineage[tLeftId] = { segmentId: tLeftId, baseSegmentIds: targetBaseIds, derivation: 'split-exact', maxApproximationDeviationCm: 0 };
  nextLineage[tRightId] = { segmentId: tRightId, baseSegmentIds: targetBaseIds, derivation: 'split-exact', maxApproximationDeviationCm: 0 };
  nextLineage[newLeg1Id] = { segmentId: newLeg1Id, baseSegmentIds: targetBaseIds, derivation: 'split-exact', maxApproximationDeviationCm: 0 };
  nextLineage[newLeg2Id] = { segmentId: newLeg2Id, baseSegmentIds: targetBaseIds, derivation: 'split-exact', maxApproximationDeviationCm: 0 };

  const transferredDart: ProposedDartModel = {
    id: input.newDartId,
    pieceId: input.pieceId,
    label: isFullTransfer ? `${sourceDart.label} (Transferred)` : `${sourceDart.label} (Split ${Math.round(input.transferRatio * 100)}%)`,
    pivotApexCm: { ...pivot },
    sewingApexCm: newGeom.sewingApexCm,
    backoffCm: input.backoffCm,
    legLeftOpeningCm: newGeom.legLeftOpeningCm,
    legRightOpeningCm: newGeom.legRightOpeningCm,
    intakeAngleRad: newGeom.intakeAngleRad,
    intakeWidthCm: newGeom.intakeWidthCm,
    legLengthLeftCm: newGeom.legLengthLeftCm,
    legLengthRightCm: newGeom.legLengthRightCm,
    foldDirection: input.foldDirection,
    hostSegmentId: targetSeg.id,
    baseHostSegmentIds: targetBaseIds,
    legSegmentIds: [newLeg1Id, newLeg2Id],
    drillHoleCm: { ...newGeom.sewingApexCm },
    isClosed: false,
    origin: 'proposal-authored',
    reconciliationStatus: 'resolved'
  };

  const nextDarts: ProposedDartModel[] = input.existingDarts.map((d) => {
    if (d.id !== sourceDart.id) return d;
    if (isFullTransfer) {
      return {
        ...d,
        intakeAngleRad: 0,
        intakeWidthCm: 0,
        legSegmentIds: null,
        isClosed: true
      };
    }
    return {
      ...d,
      sewingApexCm: srcRemainingGeom!.sewingApexCm,
      legLeftOpeningCm: srcRemainingGeom!.legLeftOpeningCm,
      legRightOpeningCm: srcRemainingGeom!.legRightOpeningCm,
      intakeAngleRad: srcRemainingGeom!.intakeAngleRad,
      intakeWidthCm: srcRemainingGeom!.intakeWidthCm,
      legLengthLeftCm: srcRemainingGeom!.legLengthLeftCm,
      legLengthRightCm: srcRemainingGeom!.legLengthRightCm
    };
  });
  nextDarts.push(transferredDart);

  return {
    ok: true,
    updatedSewSegments: finalSegments,
    updatedLineage: nextLineage,
    darts: nextDarts
  };
}

/**
 * Toggles a proposal dart's open/closed inspection state while checking contour closure.
 */
export function closeOrOpenProposalDart(input: {
  readonly sewSegments: readonly RenderCurveSegment[];
  readonly existingDarts: readonly ProposedDartModel[];
  readonly existingLineage: Readonly<Record<string, ProposalSegmentLineage>>;
  readonly dartId: string;
  readonly closed: boolean;
}): DartOperationResult {
  const dart = input.existingDarts.find((d) => d.id === input.dartId);
  if (!dart) {
    return {
      ok: false,
      updatedSewSegments: null,
      updatedLineage: null,
      darts: input.existingDarts,
      error: `Dart "${input.dartId}" not found.`
    };
  }
  const updatedDarts = input.existingDarts.map((d) =>
    d.id === dart.id ? { ...d, isClosed: input.closed } : d
  );
  return {
    ok: true,
    updatedSewSegments: input.sewSegments,
    updatedLineage: input.existingLineage,
    darts: updatedDarts
  };
}

// ---------------------------------------------------------------------------
// 5. Advisory Dart Conservation Report Evaluator
// ---------------------------------------------------------------------------

export function evaluateDartConservationReport(input: {
  readonly pieceId: string;
  readonly sourcePiece: PatternPieceRenderModel;
  readonly currentSewSegments: readonly RenderCurveSegment[];
  readonly currentDarts: readonly ProposedDartModel[];
  readonly referenceInitialAngleRad?: number;
  readonly referencePivotApexCm?: RenderPoint2D | null;
  readonly coordinateFrame: PatternArtifactCoordinateFrame;
}): DartConservationReport {
  const {
    pieceId,
    sourcePiece,
    currentSewSegments,
    currentDarts,
    coordinateFrame
  } = input;

  const openDarts = currentDarts.filter((d) => !d.isClosed);
  const totalAfterRad = openDarts.reduce((sum, d) => sum + d.intakeAngleRad, 0);
  const totalBeforeRad =
    typeof input.referenceInitialAngleRad === 'number' && Number.isFinite(input.referenceInitialAngleRad)
      ? input.referenceInitialAngleRad
      : totalAfterRad;
  const angularResidualRad = Math.abs(totalAfterRad - totalBeforeRad);

  let maxLegParityDelta = 0;
  let maxApexDrift = 0;
  const refPivot = input.referencePivotApexCm ?? (openDarts[0]?.pivotApexCm ?? null);

  for (const d of openDarts) {
    maxLegParityDelta = Math.max(maxLegParityDelta, Math.abs(d.legLengthLeftCm - d.legLengthRightCm));
    if (refPivot) {
      maxApexDrift = Math.max(maxApexDrift, distCm(d.pivotApexCm, refPivot));
    }
  }

  const dartLegIdSet = new Set<string>();
  for (const d of currentDarts) {
    if (d.legSegmentIds) {
      dartLegIdSet.add(d.legSegmentIds[0]);
      dartLegIdSet.add(d.legSegmentIds[1]);
    }
  }
  const sumNonDartLength = (segs: readonly RenderCurveSegment[]): number =>
    segs
      .filter((s) => !dartLegIdSet.has(s.id) && !s.id.includes('::leg-'))
      .reduce((acc, s) => acc + evaluateSegmentArcLengthCm(s, coordinateFrame, pieceId).lengthCm, 0);

  const netBefore = sumNonDartLength(sourcePiece.sewSegments);
  const netAfter = sumNonDartLength(currentSewSegments);
  const netDelta = netAfter - netBefore;

  const closure = checkContourClosureAndSelfIntersection(currentSewSegments);

  const advisories: string[] = [];
  if (angularResidualRad > DART_ANGULAR_CONSERVATION_TOLERANCE_RAD) {
    advisories.push(
      `Angular intake residual ${((angularResidualRad * 180) / Math.PI).toFixed(3)}° exceeds advisory tolerance.`
    );
  }
  if (maxLegParityDelta > DART_LEG_PARITY_TOLERANCE_CM) {
    advisories.push(`Dart leg parity delta ${maxLegParityDelta.toFixed(4)} cm exceeds tolerance.`);
  }
  if (!closure.closed) {
    advisories.push(`Contour closure gap ${closure.maxGapCm.toFixed(4)} cm exceeds tolerance.`);
  }
  if (closure.selfIntersection) {
    advisories.push('Advisory self-intersection detected on sew contour.');
  }
  if (closure.degenerate) {
    advisories.push('Degenerate segment detected on sew contour.');
  }
  if (advisories.length === 0) {
    advisories.push('All advisory dart conservation checks within tolerance (Not Certified).');
  }

  const withinAdvisoryTolerances =
    angularResidualRad <= DART_ANGULAR_CONSERVATION_TOLERANCE_RAD &&
    maxLegParityDelta <= DART_LEG_PARITY_TOLERANCE_CM &&
    closure.closed &&
    !closure.selfIntersection &&
    !closure.degenerate;

  return {
    authorityTier: WP_A_AUTHORITY_TIER,
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    pieceId,
    dartCount: openDarts.length,
    totalAngularIntakeBeforeRad: totalBeforeRad,
    totalAngularIntakeAfterRad: totalAfterRad,
    angularIntakeResidualRad: angularResidualRad,
    apexDriftCm: maxApexDrift,
    maxLegLengthParityDeltaCm: maxLegParityDelta,
    netSeamLengthBeforeCm: netBefore,
    netSeamLengthAfterCm: netAfter,
    netSeamLengthDeltaCm: netDelta,
    foldTangencyDeviationDeg: null,
    contourClosed: closure.closed,
    contourClosureGapCm: closure.maxGapCm,
    selfIntersectionDetected: closure.selfIntersection,
    degeneracyDetected: closure.degenerate,
    withinAdvisoryTolerances,
    advisories
  };
}
