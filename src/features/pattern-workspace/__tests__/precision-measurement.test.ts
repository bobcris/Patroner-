/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVISORY_MEASUREMENT_DISCLOSURE,
  DEFAULT_ABSOLUTE_TOLERANCE_CM,
  DEFAULT_MAX_RECURSION_DEPTH,
  DEFAULT_MAX_SUBDIVISIONS,
  EMPTY_MEASUREMENT_SESSION,
  analyzeContourOrientation,
  applyMeasurementEntityClick,
  approximateCubicBezierArcLength,
  computeSegmentGreensSignedAreaCm2,
  evaluateMeasurementSession,
  lockPendingVertexAngleMeasurement,
  measureCubicBezierAtT,
  measurePointToPointDistance,
  measureStraightEdge,
  measureVertexAngle,
  reconcileMeasurementSessionWithArtifact,
  swapMeasurementAnchors,
  transitionMeasurementSessionOnToolExit
} from '../precision-measurement';
import {
  CadCurveEntity,
  CadEdgeEntity,
  CadVertexEntity,
  extractContourVertices
} from '../entity-hit-test';
import { createInitialBoardSnapshot } from '../board-arrangement';
import type {
  PatternArtifactBundle,
  PatternArtifactCoordinateFrame,
  PatternPieceRenderModel,
  RenderCurveSegment
} from '../contracts/pattern-render-artifact';
import { STANDARD_SIZING_SYSTEM } from '../../../engine/measurements/standards';
import { INITIAL_CONCEPTS } from '../../../domain/design/curated-concepts';
import {
  buildAuthoritativeProductionWorkspaceBundle,
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS
} from '../../../engine/production';
import { adaptC0LegacyBundleToRenderArtifact } from '../contracts/c0-legacy-adapter';

const SVG_Y_DOWN_FRAME: PatternArtifactCoordinateFrame = {
  geometryUnit: 'cm',
  yAxisDirection: 'svg-y-down',
  handedness: 'screen-y-down',
  exteriorWinding: 'CW'
};

const CARTESIAN_Y_UP_FRAME: PatternArtifactCoordinateFrame = {
  geometryUnit: 'cm',
  yAxisDirection: 'cartesian-y-up',
  handedness: 'right-handed-cartesian',
  exteriorWinding: 'CCW'
};

function makeLineSeg(
  id: string,
  x0: number,
  y0: number,
  x3: number,
  y3: number
): RenderCurveSegment {
  return {
    id,
    kind: 'line',
    role: 'stitching',
    p0: { x: x0, y: y0 },
    p3: { x: x3, y: y3 }
  };
}

function makeCubicSeg(
  id: string,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): RenderCurveSegment {
  return {
    id,
    kind: 'cubic-bezier',
    role: 'stitching',
    p0,
    p1,
    p2,
    p3
  };
}

function makeVertexEntity(
  pieceId: string,
  pieceCode: string,
  x: number,
  y: number,
  offsetX = 0,
  offsetY = 0,
  segId = 'seg-0',
  contour: 'sew' | 'cut' = 'sew'
): CadVertexEntity {
  return {
    presentationRef: `${pieceId}::${contour}::${segId}::p0`,
    isAuthoritativeVertexId: false,
    entityKind: 'vertex',
    label: `Vertex (${pieceCode})`,
    pieceId,
    pieceCode,
    pieceName: `Piece ${pieceCode}`,
    contour,
    segmentId: segId,
    endpointSlot: 'p0',
    isSharedJunction: true,
    incidentSegments: [],
    localPointCm: { x, y },
    boardPointCm: { x: x + offsetX, y: y + offsetY }
  };
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
  }
  return obj;
}

test('U1: Point-to-point distance handles same-piece local+board, cross-piece board-only, coincident, and non-finite inputs', () => {
  const aSame = makeVertexEntity('p1', 'FRT', 1.23456789, 2.34567891, 10, 20, 's0');
  const bSame = makeVertexEntity('p1', 'FRT', 4.23456789, 6.34567891, 10, 20, 's1');

  const sameRes = measurePointToPointDistance(
    aSame,
    bSame,
    SVG_Y_DOWN_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.equal(sameRes.disclosure, ADVISORY_MEASUREMENT_DISCLOSURE);
  assert.equal(sameRes.isCertified, false);
  assert.equal(sameRes.classification, 'algebraic-float64');
  assert.equal(sameRes.isSamePiece, true);
  assert.ok(sameRes.local);
  assert.ok(sameRes.board);
  assert.ok(Math.abs(sameRes.local.distanceCm - 5.0) < 1e-12);
  assert.ok(Math.abs(sameRes.board.distanceCm - 5.0) < 1e-12);
  assert.ok(Math.abs(sameRes.local.dxCm - 3.0) < 1e-12);
  assert.ok(Math.abs(sameRes.local.dyCm - 4.0) < 1e-12);

  // Cross-piece: local is null, board distance reflects table arrangement
  const bOther = makeVertexEntity('p2', 'BCK', 0, 0, 40, 20, 's0');
  const crossRes = measurePointToPointDistance(
    aSame,
    bOther,
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED'
  );
  assert.equal(crossRes.isCertified, false);
  assert.equal(crossRes.disclosure, ADVISORY_MEASUREMENT_DISCLOSURE);
  assert.equal(crossRes.isSamePiece, false);
  assert.equal(crossRes.local, null);
  assert.ok(crossRes.localUnavailableReason);
  assert.ok(crossRes.board);
  const expectedCross = Math.hypot(40 - 11.23456789, 20 - 22.34567891);
  assert.ok(Math.abs(crossRes.board.distanceCm - expectedCross) < 1e-12);

  // Coincident points: distance = 0, angles null (indeterminate)
  const coinc = measurePointToPointDistance(
    aSame,
    aSame,
    SVG_Y_DOWN_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.equal(coinc.status, 'valid');
  assert.equal(coinc.local?.distanceCm, 0);
  assert.equal(coinc.local?.isCoincident, true);
  assert.equal(coinc.local?.angles, null);

  // Non-finite input fails closed
  const bad = makeVertexEntity('p1', 'FRT', Number.NaN, 0, 0, 0, 's-bad');
  const badRes = measurePointToPointDistance(
    aSame,
    bad,
    SVG_Y_DOWN_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.equal(badRes.status, 'invalid-input');
  assert.equal(badRes.classification, 'indeterminate');
  assert.equal(badRes.board, null);
  assert.equal(badRes.local, null);
});

test('U2: Straight-edge length, displacement, bearing, and orientation across svg-y-down and cartesian-y-up', () => {
  // Vector (+10, -10): in svg-y-down this goes East & UP (visual +45°, compass bearing 45°);
  // in cartesian-y-up this goes East & DOWN (visual -45°, compass bearing 135°).
  const seg = makeLineSeg('diag', 0, 0, 10, -10);

  const svgRes = measureStraightEdge(
    seg,
    'p1',
    'FRT',
    'sew',
    SVG_Y_DOWN_FRAME,
    'C0_LEGACY_TS_PROTOTYPE',
    { x: 5, y: 12 }
  );
  assert.equal(svgRes.disclosure, ADVISORY_MEASUREMENT_DISCLOSURE);
  assert.equal(svgRes.isCertified, false);
  assert.equal(svgRes.classification, 'algebraic-float64');
  assert.ok(Math.abs((svgRes.lengthCm ?? 0) - Math.SQRT2 * 10) < 1e-12);
  assert.ok(Math.abs((svgRes.angles?.frameAngleDeg ?? 999) - -45) < 1e-12);
  assert.ok(Math.abs((svgRes.angles?.visualInclinationDeg ?? 999) - 45) < 1e-12);
  assert.ok(Math.abs((svgRes.angles?.compassBearingDeg ?? 999) - 45) < 1e-12);
  assert.ok(Math.abs((svgRes.angles?.undirectedOrientationDeg ?? 999) - 45) < 1e-12);

  const cartRes = measureStraightEdge(
    seg,
    'p1',
    'FRT',
    'sew',
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED'
  );
  assert.ok(Math.abs((cartRes.angles?.frameAngleDeg ?? 999) - -45) < 1e-12);
  assert.ok(Math.abs((cartRes.angles?.visualInclinationDeg ?? 999) - -45) < 1e-12);
  assert.ok(Math.abs((cartRes.angles?.compassBearingDeg ?? 999) - 135) < 1e-12);
  assert.ok(Math.abs((cartRes.angles?.undirectedOrientationDeg ?? 999) - 135) < 1e-12);

  // Reversed edge keeps identical undirected orientation in [0, 180)
  const revSeg = makeLineSeg('diag-rev', 10, -10, 0, 0);
  const revSvg = measureStraightEdge(
    revSeg,
    'p1',
    'FRT',
    'sew',
    SVG_Y_DOWN_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.ok(
    Math.abs(
      (revSvg.angles?.undirectedOrientationDeg ?? -1) -
        (svgRes.angles?.undirectedOrientationDeg ?? -2)
    ) < 1e-12
  );

  // Zero-length degenerate edge fails closed to indeterminate
  const zeroSeg = makeLineSeg('zero', 5, 5, 5 + 1e-11, 5);
  const zeroRes = measureStraightEdge(
    zeroSeg,
    'p1',
    'FRT',
    'sew',
    SVG_Y_DOWN_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.equal(zeroRes.status, 'degenerate-zero-length');
  assert.equal(zeroRes.classification, 'indeterminate');
  assert.equal(zeroRes.isZeroLength, true);
  assert.equal(zeroRes.angles, null);
});

test('U3: Green’s-theorem contour orientation and vertex angles (convex & reflex) in both svg-y-down and cartesian-y-up', () => {
  // L-shaped closed contour in cartesian-y-up (CCW, positive algebraic area = +75 cm²)
  // Reflex vertex is at (5, 5): interior = 270°, exterior = 90°, included = 90°
  const lCart: RenderCurveSegment[] = [
    makeLineSeg('e0', 0, 0, 10, 0),
    makeLineSeg('e1', 10, 0, 10, 5),
    makeLineSeg('e2', 10, 5, 5, 5),
    makeLineSeg('e3', 5, 5, 5, 10),
    makeLineSeg('e4', 5, 10, 0, 10),
    makeLineSeg('e5', 0, 10, 0, 0)
  ];

  const cartOrientation = analyzeContourOrientation(lCart, CARTESIAN_Y_UP_FRAME);
  assert.equal(cartOrientation.status, 'determined');
  assert.equal(cartOrientation.orientationSign, 1);
  assert.ok(Math.abs((cartOrientation.algebraicSignedAreaCm2 ?? 0) - 75) < 1e-12);

  const cartVerts = extractContourVertices('p1', 'sew', lCart).vertices;
  const reflexCartRaw = cartVerts.find(v => v.segmentId === 'e3')!;
  const reflexCartEntity: CadVertexEntity = {
    presentationRef: reflexCartRaw.presentationRef,
    isAuthoritativeVertexId: false,
    entityKind: 'vertex',
    label: 'Reflex',
    pieceId: 'p1',
    pieceCode: 'L1',
    pieceName: 'L-Shape',
    contour: 'sew',
    segmentId: reflexCartRaw.segmentId,
    endpointSlot: reflexCartRaw.endpointSlot,
    isSharedJunction: reflexCartRaw.isSharedJunction,
    incidentSegments: reflexCartRaw.incidentSegments,
    localPointCm: reflexCartRaw.localPointCm,
    boardPointCm: reflexCartRaw.localPointCm
  };

  const reflexCartAngle = measureVertexAngle(
    reflexCartEntity,
    lCart,
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED'
  );
  assert.equal(reflexCartAngle.status, 'valid');
  assert.equal(reflexCartAngle.isCertified, false);
  assert.equal(reflexCartAngle.disclosure, ADVISORY_MEASUREMENT_DISCLOSURE);
  assert.ok(Math.abs((reflexCartAngle.includedAngleDeg ?? 0) - 90) < 1e-10);
  assert.ok(Math.abs((reflexCartAngle.interiorAngleDeg ?? 0) - 270) < 1e-10);
  assert.ok(Math.abs((reflexCartAngle.exteriorAngleDeg ?? 0) - 90) < 1e-10);
  assert.equal(reflexCartAngle.isReflex, true);

  // Same L-shape mirrored into svg-y-down with NEGATIVE algebraic area (-75 cm²), matching C0-Legacy skirt winding
  const lSvg: RenderCurveSegment[] = [
    makeLineSeg('s0', 0, 0, 0, 10),
    makeLineSeg('s1', 0, 10, 10, 10),
    makeLineSeg('s2', 10, 10, 10, 5),
    makeLineSeg('s3', 10, 5, 5, 5),
    makeLineSeg('s4', 5, 5, 5, 0),
    makeLineSeg('s5', 5, 0, 0, 0)
  ];
  const svgOrientation = analyzeContourOrientation(lSvg, SVG_Y_DOWN_FRAME);
  assert.equal(svgOrientation.status, 'determined');
  assert.equal(svgOrientation.orientationSign, -1);
  assert.ok(Math.abs((svgOrientation.algebraicSignedAreaCm2 ?? 0) - -75) < 1e-12);

  const svgVerts = extractContourVertices('p1', 'sew', lSvg).vertices;
  const convexSvgRaw = svgVerts.find(v => v.segmentId === 's1')!; // corner (0, 10) -> 90° interior
  const reflexSvgRaw = svgVerts.find(v => v.segmentId === 's4')!; // inner corner (5, 5) -> 270° interior

  const toVertEntity = (v: typeof convexSvgRaw): CadVertexEntity => ({
    presentationRef: v.presentationRef,
    isAuthoritativeVertexId: false,
    entityKind: 'vertex',
    label: 'V',
    pieceId: 'p1',
    pieceCode: 'L2',
    pieceName: 'L-Shape SVG',
    contour: 'sew',
    segmentId: v.segmentId,
    endpointSlot: v.endpointSlot,
    isSharedJunction: v.isSharedJunction,
    incidentSegments: v.incidentSegments,
    localPointCm: v.localPointCm,
    boardPointCm: v.localPointCm
  });

  const convexSvgAngle = measureVertexAngle(
    toVertEntity(convexSvgRaw),
    lSvg,
    SVG_Y_DOWN_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.equal(convexSvgAngle.status, 'valid');
  assert.ok(Math.abs((convexSvgAngle.interiorAngleDeg ?? 0) - 90) < 1e-10);
  assert.ok(Math.abs((convexSvgAngle.exteriorAngleDeg ?? 0) - 270) < 1e-10);
  assert.equal(convexSvgAngle.isReflex, false);

  const reflexSvgAngle = measureVertexAngle(
    toVertEntity(reflexSvgRaw),
    lSvg,
    SVG_Y_DOWN_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.equal(reflexSvgAngle.status, 'valid');
  assert.ok(Math.abs((reflexSvgAngle.interiorAngleDeg ?? 0) - 270) < 1e-10);
  assert.ok(Math.abs((reflexSvgAngle.exteriorAngleDeg ?? 0) - 90) < 1e-10);
  assert.equal(reflexSvgAngle.isReflex, true);
});

test('U4: Self-intersecting (bowtie), open, collapsed, and 1-segment contours conservatively reject interior/exterior while preserving valid unsigned included angle', () => {
  // Bowtie (figure-8) self-intersecting closed contour
  const bowtie: RenderCurveSegment[] = [
    makeLineSeg('b0', 0, 0, 10, 10),
    makeLineSeg('b1', 10, 10, 10, 0),
    makeLineSeg('b2', 10, 0, 0, 10),
    makeLineSeg('b3', 0, 10, 0, 0)
  ];
  const bowtieOrientation = analyzeContourOrientation(bowtie, CARTESIAN_Y_UP_FRAME);
  assert.equal(bowtieOrientation.status, 'self-intersecting-or-uncertain');
  assert.equal(bowtieOrientation.orientationSign, null);

  // Corner at (10, 10) between b0 (0,0)->(10,10) and b1 (10,10)->(10,0) has valid 45° unsigned included angle!
  const bowtieVerts = extractContourVertices('p1', 'sew', bowtie).vertices;
  const corner = bowtieVerts.find(v => v.segmentId === 'b1')!;
  const bowtieAngle = measureVertexAngle(
    {
      presentationRef: corner.presentationRef,
      isAuthoritativeVertexId: false,
      entityKind: 'vertex',
      label: 'Bowtie Corner',
      pieceId: 'p1',
      pieceCode: 'BT',
      pieceName: 'Bowtie',
      contour: 'sew',
      segmentId: corner.segmentId,
      endpointSlot: corner.endpointSlot,
      isSharedJunction: corner.isSharedJunction,
      incidentSegments: corner.incidentSegments,
      localPointCm: corner.localPointCm,
      boardPointCm: corner.localPointCm
    },
    bowtie,
    CARTESIAN_Y_UP_FRAME,
    'UNVERIFIED_EXTERNAL_ARTIFACT'
  );
  assert.equal(bowtieAngle.status, 'included-only');
  assert.equal(bowtieAngle.interiorExteriorStatus, 'indeterminate');
  assert.equal(bowtieAngle.interiorAngleDeg, null);
  assert.equal(bowtieAngle.exteriorAngleDeg, null);
  assert.ok(Math.abs((bowtieAngle.includedAngleDeg ?? 0) - 45) < 1e-10);

  // Open contour: 2 perpendicular segments forming an L without closing
  const openL: RenderCurveSegment[] = [
    makeLineSeg('o0', 0, 0, 10, 0),
    makeLineSeg('o1', 10, 0, 10, 10)
  ];
  const openOrient = analyzeContourOrientation(openL, CARTESIAN_Y_UP_FRAME);
  assert.equal(openOrient.status, 'open-contour');
  const openVerts = extractContourVertices('p1', 'sew', openL).vertices;
  const openCorner = openVerts.find(v => v.segmentId === 'o1')!;
  const openAngle = measureVertexAngle(
    {
      presentationRef: openCorner.presentationRef,
      isAuthoritativeVertexId: false,
      entityKind: 'vertex',
      label: 'Open Corner',
      pieceId: 'p1',
      pieceCode: 'OP',
      pieceName: 'Open',
      contour: 'sew',
      segmentId: openCorner.segmentId,
      endpointSlot: openCorner.endpointSlot,
      isSharedJunction: openCorner.isSharedJunction,
      incidentSegments: openCorner.incidentSegments,
      localPointCm: openCorner.localPointCm,
      boardPointCm: openCorner.localPointCm
    },
    openL,
    CARTESIAN_Y_UP_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.equal(openAngle.status, 'included-only');
  assert.ok(Math.abs((openAngle.includedAngleDeg ?? 0) - 90) < 1e-10);
  assert.equal(openAngle.interiorAngleDeg, null);

  // 1-segment contour -> insufficient-geometry
  const oneSeg = [makeLineSeg('only', 0, 0, 10, 0)];
  assert.equal(
    analyzeContourOrientation(oneSeg, CARTESIAN_Y_UP_FRAME).status,
    'insufficient-geometry'
  );

  // Collapsed collinear zero-area triangle -> collapsed-area or self-intersecting
  const collapsed: RenderCurveSegment[] = [
    makeLineSeg('c0', 0, 0, 10, 0),
    makeLineSeg('c1', 10, 0, 5, 0),
    makeLineSeg('c2', 5, 0, 0, 0)
  ];
  const collapsedOrient = analyzeContourOrientation(collapsed, CARTESIAN_Y_UP_FRAME);
  assert.equal(collapsedOrient.orientationSign, null);
  assert.ok(
    collapsedOrient.status === 'collapsed-area' ||
      collapsedOrient.status === 'self-intersecting-or-uncertain'
  );
});

test('U5: Higher-order L’Hôpital endpoint tangent fallback when cubic Bézier handle coincides with anchor', () => {
  // Incoming line from (0,0) -> (10,0), outgoing cubic starting at (10,0) with degenerate p1 = p0 = (10,0)
  // and p2 = (10, 5), p3 = (10, 10) -> true tangent at t -> 0+ points along +Y (90° corner!)
  const contour: RenderCurveSegment[] = [
    makeLineSeg('s0', 0, 0, 10, 0),
    makeCubicSeg('s1', { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }),
    makeLineSeg('s2', 10, 10, 0, 10),
    makeLineSeg('s3', 0, 10, 0, 0)
  ];
  const verts = extractContourVertices('p1', 'sew', contour).vertices;
  const corner = verts.find(v => v.segmentId === 's1')!;
  const res = measureVertexAngle(
    {
      presentationRef: corner.presentationRef,
      isAuthoritativeVertexId: false,
      entityKind: 'vertex',
      label: 'Cubic Corner',
      pieceId: 'p1',
      pieceCode: 'CC',
      pieceName: 'Cubic Corner',
      contour: 'sew',
      segmentId: corner.segmentId,
      endpointSlot: corner.endpointSlot,
      isSharedJunction: corner.isSharedJunction,
      incidentSegments: corner.incidentSegments,
      localPointCm: corner.localPointCm,
      boardPointCm: corner.localPointCm
    },
    contour,
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED'
  );
  assert.equal(res.status, 'valid');
  assert.equal(res.usedHigherOrderEndpointTangent, true);
  assert.ok(Math.abs((res.includedAngleDeg ?? 0) - 90) < 1e-10);
  assert.ok(Math.abs((res.interiorAngleDeg ?? 0) - 90) < 1e-10);
});

test('U6: Cubic Bézier differential analysis verifies exact curvature on quarter-circle approximation, flat inflection, and stationary cusp safeguards', () => {
  // Classic quarter-circle cubic Bézier of radius R = 10 cm in Cartesian Y-up:
  // k = (4/3)*(sqrt(2) - 1) ≈ 0.5522847498307936
  const R = 10;
  const k = (4 / 3) * (Math.SQRT2 - 1);
  const qCircle = makeCubicSeg(
    'q-circle',
    { x: R, y: 0 },
    { x: R, y: R * k },
    { x: R * k, y: R },
    { x: 0, y: R }
  );

  // At t = 0.5, unit tangent points at (-sqrt(2)/2, +sqrt(2)/2), curvature ≈ +1/R = +0.1 cm⁻¹
  const diffMid = measureCubicBezierAtT(
    qCircle,
    0.5,
    'p1',
    'CIR',
    'sew',
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED'
  );
  assert.equal(diffMid.status, 'valid');
  assert.equal(diffMid.disclosure, ADVISORY_MEASUREMENT_DISCLOSURE);
  assert.equal(diffMid.isCertified, false);
  assert.equal(diffMid.radiusState, 'finite');
  assert.ok(Math.abs((diffMid.unitTangent?.x ?? 0) - -Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs((diffMid.unitTangent?.y ?? 0) - Math.SQRT1_2) < 1e-12);
  // Exact analytical curvature of the classic quarter-circle cubic Bézier at t = 0.5:
  // kappa(0.5) = (16 * k) / (3 * sqrt(2) * (2 - k)^2 * R)
  const expectedQuarterCircleKappa = (16 * k) / (3 * Math.SQRT2 * (2 - k) * (2 - k) * R);
  assert.ok(Math.abs((diffMid.signedCurvatureInvCm ?? 0) - expectedQuarterCircleKappa) < 1e-12);
  assert.ok(
    Math.abs((diffMid.radiusOfCurvatureCm ?? 0) - 1 / expectedQuarterCircleKappa) < 1e-11
  );

  // Straight cubic (collinear control points) -> curvature = 0, radiusState = 'infinite'
  const flatCubic = makeCubicSeg(
    'flat',
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 7, y: 0 },
    { x: 10, y: 0 }
  );
  const diffFlat = measureCubicBezierAtT(
    flatCubic,
    0.5,
    'p1',
    'FLT',
    'sew',
    SVG_Y_DOWN_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.equal(diffFlat.status, 'valid');
  assert.equal(diffFlat.signedCurvatureInvCm, 0);
  assert.equal(diffFlat.radiusState, 'infinite');
  assert.equal(diffFlat.radiusOfCurvatureCm, null);

  // Exact stationary point at t = 0.5: P0=(0,0), P1=(3,0), P2=(1,0), P3=(4,0) -> Wait:
  // For cusp at t=0.5: B'(0.5) = 0.75*(P1-P0) + 1.5*(P2-P1) + 0.75*(P3-P2) = 0
  // Choose P0=(0,0), P1=(6,0), P2=(2,0), P3=(8,0)? Check: 0.75*6 + 1.5*(-4) + 0.75*6 = 4.5 - 6 + 4.5 = 3 != 0
  // Choose P0=(0,0), P1=(4,0), P2=(0,0), P3=(4,0): B'(0.5) = 0.75*4 + 1.5*(-4) + 0.75*4 = 3 - 6 + 3 = 0!
  const stationaryCubic = makeCubicSeg(
    'cusp',
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 0 },
    { x: 4, y: 0 }
  );
  const diffCusp = measureCubicBezierAtT(
    stationaryCubic,
    0.5,
    'p1',
    'CSP',
    'sew',
    CARTESIAN_Y_UP_FRAME,
    'C0_LEGACY_TS_PROTOTYPE'
  );
  assert.equal(diffCusp.status, 'stationary-degenerate');
  assert.equal(diffCusp.classification, 'indeterminate');
  assert.equal(diffCusp.isStationary, true);
  assert.equal(diffCusp.unitTangent, null);
  assert.equal(diffCusp.signedCurvatureInvCm, null);
  assert.equal(diffCusp.radiusState, 'undefined');
});

test('U7: Adaptive 5-point Gauss–Legendre arc length verifies full & partial domains, quadratureErrorEstimateCm vs geometricEnclosureWidthCm, and deterministic non-convergence', () => {
  // Quarter circle R = 10 cm -> true circle arc length = 5*pi ≈ 15.7079632679;
  // cubic Bezier approximation exact arc length ≈ 15.70853... cm
  const R = 10;
  const k = (4 / 3) * (Math.SQRT2 - 1);
  const qCircle = makeCubicSeg(
    'q-circle',
    { x: R, y: 0 },
    { x: R, y: R * k },
    { x: R * k, y: R },
    { x: 0, y: R }
  );

  const full = approximateCubicBezierArcLength(
    qCircle,
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED',
    'p1',
    'sew',
    [0, 1]
  );
  assert.equal(full.disclosure, ADVISORY_MEASUREMENT_DISCLOSURE);
  assert.equal(full.isCertified, false);
  assert.equal(full.classification, 'numerical-approximation');
  assert.equal(full.converged, true);
  assert.equal(full.convergenceStatus, 'converged');
  assert.equal(full.options.absoluteToleranceCm, DEFAULT_ABSOLUTE_TOLERANCE_CM);
  assert.equal(full.options.maxRecursionDepth, DEFAULT_MAX_RECURSION_DEPTH);
  assert.equal(full.options.maxSubdivisions, DEFAULT_MAX_SUBDIVISIONS);
  assert.ok(full.arcLengthCm !== null);
  assert.ok(full.quadratureErrorEstimateCm !== null);
  assert.ok(full.geometricEnclosureWidthCm !== null);
  assert.ok(full.chordLowerBoundCm !== null && full.controlPolygonUpperBoundCm !== null);
  assert.ok(full.arcLengthCm >= full.chordLowerBoundCm - 1e-12);
  assert.ok(full.arcLengthCm <= full.controlPolygonUpperBoundCm + 1e-12);
  // Quarter-circle cubic Bézier arc length is slightly above 5*pi (~15.70975 cm)
  assert.ok(Math.abs(full.arcLengthCm - 5 * Math.PI) < 2.5e-3);
  assert.ok(full.quadratureErrorEstimateCm <= DEFAULT_ABSOLUTE_TOLERANCE_CM);

  // Exact analytical Pythagorean-hodograph cubic:
  // P0=(0,0), P1=(1,0), P2=(3,1), P3=(6,5) -> exact speed = 3(1 + 2t + 2t^2)
  // Exact arc length L(T) = 3T + 3T^2 + 2T^3 => L(1) = 8 cm, L(0.5) = 2.5 cm
  const phCubic = makeCubicSeg(
    'ph-exact',
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 3, y: 1 },
    { x: 6, y: 5 }
  );
  const phFull = approximateCubicBezierArcLength(
    phCubic,
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED',
    'p1',
    'sew',
    [0, 1]
  );
  const phHalf = approximateCubicBezierArcLength(
    phCubic,
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED',
    'p1',
    'sew',
    [0, 0.5]
  );
  assert.equal(phFull.converged, true);
  assert.equal(phHalf.converged, true);
  assert.ok(Math.abs((phFull.arcLengthCm ?? 0) - 8.0) < 1e-12);
  assert.ok(Math.abs((phHalf.arcLengthCm ?? 0) - 2.5) < 1e-12);

  // Symmetry check: partial [0, 0.5] + partial [0.5, 1] === full [0, 1]
  const firstHalf = approximateCubicBezierArcLength(
    qCircle,
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED',
    'p1',
    'sew',
    [0, 0.5]
  );
  const secondHalf = approximateCubicBezierArcLength(
    qCircle,
    CARTESIAN_Y_UP_FRAME,
    'C1_PYTHON_CERTIFIED',
    'p1',
    'sew',
    [0.5, 1]
  );
  assert.equal(firstHalf.isPartial, true);
  assert.equal(firstHalf.converged, true);
  assert.ok(
    Math.abs((firstHalf.arcLengthCm ?? 0) - (secondHalf.arcLengthCm ?? 0)) < 1e-8
  );
  assert.ok(
    Math.abs(
      (firstHalf.arcLengthCm ?? 0) + (secondHalf.arcLengthCm ?? 0) - (full.arcLengthCm ?? 0)
    ) < 1e-7
  );

  // Sharp S-loop with artificially tight budget -> MUST return converged: false & warning (never silently relax)
  const sharpLoop = makeCubicSeg(
    'sharp-loop',
    { x: 0, y: 0 },
    { x: 250, y: 120 },
    { x: -240, y: 120 },
    { x: 10, y: 0 }
  );
  const nonConv = approximateCubicBezierArcLength(
    sharpLoop,
    CARTESIAN_Y_UP_FRAME,
    'C0_LEGACY_TS_PROTOTYPE',
    'p1',
    'sew',
    [0, 1],
    {
      absoluteToleranceCm: 1e-11,
      relativeTolerance: 0,
      maxRecursionDepth: 2,
      maxSubdivisions: 16
    }
  );
  assert.equal(nonConv.converged, false);
  assert.notEqual(nonConv.convergenceStatus, 'converged');
  assert.ok(nonConv.warning && nonConv.warning.length > 0);
  assert.ok(nonConv.arcLengthCm !== null && Number.isFinite(nonConv.arcLengthCm));
  assert.equal(nonConv.geometricEnclosureExceedsTolerance, true);
  assert.ok(nonConv.geometricEnclosureNote);
});

test('U8: Green’s theorem cubic signed area matches exact analytical parabola area', () => {
  // Parabola y(x) = 4*h*x*(1-x) over [0, 1] has exact area = (2/3)*h.
  // Degree-elevated cubic control points: (0,0), (1/3, 4h/3), (2/3, 4h/3), (1,0)
  const h = 6;
  const arch = makeCubicSeg(
    'parabola',
    { x: 0, y: 0 },
    { x: 1 / 3, y: (4 * h) / 3 },
    { x: 2 / 3, y: (4 * h) / 3 },
    { x: 1, y: 0 }
  );
  const baseLine = makeLineSeg('base', 1, 0, 0, 0);
  // Traversed CW -> algebraic area should be -(2/3)*h = -4
  const area =
    computeSegmentGreensSignedAreaCm2(arch) + computeSegmentGreensSignedAreaCm2(baseLine);
  assert.ok(Math.abs(area - -(2 / 3) * h) < 1e-12);
});

function buildRealSkirtArtifact(): PatternArtifactBundle {
  const workspaceBundle = buildAuthoritativeProductionWorkspaceBundle({
    projectId: 'test-project',
    tenantId: 'test-tenant',
    designSpec: INITIAL_CONCEPTS[0],
    measurements: STANDARD_SIZING_SYSTEM.sizes.M,
    activeSize: 'M',
    bomControls: { ...DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS },
    governance: {
      bodiceDartStyle: 'waist',
      sleeveEaseStrategy: 'classic',
      strictUncertaintyGate: true,
      requireApprovedGovernance: false,
      measurementProvenance: 'standard-chart',
      measurementApprovalState: 'unverified'
    }
  });
  return adaptC0LegacyBundleToRenderArtifact({
    workspaceBundle,
    specificationRevisionId: 'test-spec-v1',
    measurementRevisionId: 'meas-M'
  });
}

test('U9: C0-Legacy skirt block real artifact verification + deepFreeze immutability', () => {
  const artifact = deepFreeze(buildRealSkirtArtifact());
  const board = createInitialBoardSnapshot(artifact);

  const frontPiece = artifact.pieces.find(p => p.pieceId === 'piece-skirt-front') ?? artifact.pieces[0];
  assert.ok(frontPiece);
  assert.equal(artifact.isProductionReady, false);
  assert.equal(artifact.externalCadInteroperabilityVerified, false);

  // Verify Green's-theorem orientation succeeds on the real skirt sew contour
  const orient = analyzeContourOrientation(frontPiece.sewSegments, artifact.coordinateFrame);
  assert.equal(orient.status, 'determined');
  assert.ok(orient.orientationSign === 1 || orient.orientationSign === -1);
  assert.ok(orient.algebraicSignedAreaCm2 !== null && Math.abs(orient.algebraicSignedAreaCm2) > 500);

  // Measure every shared vertex on the front skirt contour
  const extracted = extractContourVertices(frontPiece.pieceId, 'sew', frontPiece.sewSegments);
  const placement = board.placementsByPieceId[frontPiece.pieceId];
  assert.ok(extracted.vertices.length >= 4);

  for (const v of extracted.vertices) {
    if (!v.isSharedJunction) continue;
    const entity: CadVertexEntity = {
      presentationRef: v.presentationRef,
      isAuthoritativeVertexId: false,
      entityKind: 'vertex',
      label: 'Skirt Vertex',
      pieceId: frontPiece.pieceId,
      pieceCode: frontPiece.pieceCode,
      pieceName: frontPiece.name,
      contour: 'sew',
      segmentId: v.segmentId,
      endpointSlot: v.endpointSlot,
      isSharedJunction: v.isSharedJunction,
      incidentSegments: v.incidentSegments,
      localPointCm: v.localPointCm,
      boardPointCm: {
        x: v.localPointCm.x + placement.offsetXCm,
        y: v.localPointCm.y + placement.offsetYCm
      }
    };
    const vRes = measureVertexAngle(
      entity,
      frontPiece.sewSegments,
      artifact.coordinateFrame,
      artifact.authorityTier
    );
    assert.equal(vRes.disclosure, ADVISORY_MEASUREMENT_DISCLOSURE);
    assert.equal(vRes.isCertified, false);
    assert.equal(vRes.status, 'valid');
    assert.ok(vRes.interiorAngleDeg !== null && vRes.interiorAngleDeg > 40 && vRes.interiorAngleDeg < 220);
  }

  // Measure the hip cubic curve on the real skirt block
  const cubicSeg = frontPiece.sewSegments.find(s => s.kind === 'cubic-bezier');
  assert.ok(cubicSeg, 'Skirt block should contain at least one cubic-bezier segment');
  const arc = approximateCubicBezierArcLength(
    cubicSeg,
    artifact.coordinateFrame,
    artifact.authorityTier,
    frontPiece.pieceId,
    'sew'
  );
  assert.equal(arc.converged, true);
  assert.equal(arc.isCertified, false);
  assert.ok(arc.arcLengthCm !== null && arc.arcLengthCm > 10 && arc.arcLengthCm < 60);
});

test('U10: Measurement session state machine, swap, tool-exit persistence rules, reactive board reconciliation, and layer-visibility invalidation', () => {
  const artifact: PatternArtifactBundle = buildRealSkirtArtifact();
  const board = createInitialBoardSnapshot(artifact);
  const p0 = artifact.pieces[0];
  const p1 = artifact.pieces[1];
  const pl0 = board.placementsByPieceId[p0.pieceId];
  const pl1 = board.placementsByPieceId[p1.pieceId];

  const v0Raw = extractContourVertices(p0.pieceId, 'sew', p0.sewSegments).vertices[0];
  const v1Raw = extractContourVertices(p1.pieceId, 'sew', p1.sewSegments).vertices[0];

  const anchorA: CadVertexEntity = {
    presentationRef: v0Raw.presentationRef,
    isAuthoritativeVertexId: false,
    entityKind: 'vertex',
    label: 'A',
    pieceId: p0.pieceId,
    pieceCode: p0.pieceCode,
    pieceName: p0.name,
    contour: 'sew',
    segmentId: v0Raw.segmentId,
    endpointSlot: v0Raw.endpointSlot,
    isSharedJunction: v0Raw.isSharedJunction,
    incidentSegments: v0Raw.incidentSegments,
    localPointCm: v0Raw.localPointCm,
    boardPointCm: {
      x: v0Raw.localPointCm.x + pl0.offsetXCm,
      y: v0Raw.localPointCm.y + pl0.offsetYCm
    }
  };
  const anchorB: CadVertexEntity = {
    presentationRef: v1Raw.presentationRef,
    isAuthoritativeVertexId: false,
    entityKind: 'vertex',
    label: 'B',
    pieceId: p1.pieceId,
    pieceCode: p1.pieceCode,
    pieceName: p1.name,
    contour: 'sew',
    segmentId: v1Raw.segmentId,
    endpointSlot: v1Raw.endpointSlot,
    isSharedJunction: v1Raw.isSharedJunction,
    incidentSegments: v1Raw.incidentSegments,
    localPointCm: v1Raw.localPointCm,
    boardPointCm: {
      x: v1Raw.localPointCm.x + pl1.offsetXCm,
      y: v1Raw.localPointCm.y + pl1.offsetYCm
    }
  };

  // Click A -> awaiting-second-anchor; exiting to Select clears incomplete session (Decision 2)
  const pending = applyMeasurementEntityClick(EMPTY_MEASUREMENT_SESSION, anchorA, 'auto');
  assert.equal(pending.mode, 'awaiting-second-anchor');
  assert.equal(transitionMeasurementSessionOnToolExit(pending, 'select').mode, 'idle');

  // Lock pending vertex angle -> single-entity persists on Select & Pan, clears on Inspect
  const lockedVertex = lockPendingVertexAngleMeasurement(pending);
  assert.equal(lockedVertex.mode, 'single-entity');
  assert.equal(transitionMeasurementSessionOnToolExit(lockedVertex, 'select').mode, 'single-entity');
  assert.equal(transitionMeasurementSessionOnToolExit(lockedVertex, 'pan').mode, 'single-entity');
  assert.equal(transitionMeasurementSessionOnToolExit(lockedVertex, 'inspect-entity').mode, 'idle');

  // Click B -> pair-complete; persists on Select & Pan; Swap reverses A and B
  const paired = applyMeasurementEntityClick(pending, anchorB, 'auto');
  assert.equal(paired.mode, 'pair-complete');
  assert.equal(transitionMeasurementSessionOnToolExit(paired, 'select').mode, 'pair-complete');
  assert.equal(transitionMeasurementSessionOnToolExit(paired, 'pan').mode, 'pair-complete');
  assert.equal(transitionMeasurementSessionOnToolExit(paired, 'inspect-entity').mode, 'idle');

  const swapped = swapMeasurementAnchors(paired);
  assert.equal(swapped.anchorA?.presentationRef, anchorB.presentationRef);
  assert.equal(swapped.anchorB?.presentationRef, anchorA.presentationRef);

  const evalBefore = evaluateMeasurementSession(paired, artifact, board);
  assert.equal(evalBefore.kind, 'pair-distance');
  const distBefore = evalBefore.result.board!.distanceCm;

  // Move piece 2 by +15 cm in X -> reactive reconciliation updates board distance
  const movedBoard = {
    ...board,
    placementsByPieceId: {
      ...board.placementsByPieceId,
      [p1.pieceId]: {
        ...pl1,
        offsetXCm: pl1.offsetXCm + 15
      }
    }
  };
  const reconciled = reconcileMeasurementSessionWithArtifact(paired, artifact, movedBoard, {
    showSewLines: true,
    showSeamAllowance: true,
    showNotches: true,
    showDarts: true,
    showGrainline: true,
    showDimensions: true
  });
  const evalAfter = evaluateMeasurementSession(reconciled, artifact, movedBoard);
  assert.equal(evalAfter.kind, 'pair-distance');
  assert.notEqual(evalAfter.result.board!.distanceCm, distBefore);

  // Hiding sew lines invalidates the sew-contour measurement cleanly
  const invalidated = reconcileMeasurementSessionWithArtifact(paired, artifact, movedBoard, {
    showSewLines: false,
    showSeamAllowance: true,
    showNotches: true,
    showDarts: true,
    showGrainline: true,
    showDimensions: true
  });
  assert.equal(invalidated.mode, 'idle');
  assert.equal(invalidated.anchorA, null);

  // Single-entity edge & curve evaluation smoke check
  const lineSeg = p0.sewSegments.find(s => s.kind === 'line')!;
  const edgeEntity: CadEdgeEntity = {
    presentationRef: `${p0.pieceId}::sew::${lineSeg.id}`,
    isAuthoritativeVertexId: false,
    entityKind: 'edge',
    label: `Edge · ${lineSeg.id}`,
    pieceId: p0.pieceId,
    pieceCode: p0.pieceCode,
    pieceName: p0.name,
    contour: 'sew',
    segmentId: lineSeg.id,
    segmentKind: 'line',
    segmentRole: lineSeg.role,
    startLocalCm: lineSeg.p0,
    endLocalCm: lineSeg.p3,
    parameterT: 0.5,
    localPointCm: { x: (lineSeg.p0.x + lineSeg.p3.x) * 0.5, y: (lineSeg.p0.y + lineSeg.p3.y) * 0.5 },
    boardPointCm: {
      x: (lineSeg.p0.x + lineSeg.p3.x) * 0.5 + pl0.offsetXCm,
      y: (lineSeg.p0.y + lineSeg.p3.y) * 0.5 + pl0.offsetYCm
    }
  };
  const edgeSession = applyMeasurementEntityClick(EMPTY_MEASUREMENT_SESSION, edgeEntity, 'auto');
  assert.equal(edgeSession.mode, 'single-entity');
  const edgeEval = evaluateMeasurementSession(edgeSession, artifact, board);
  assert.equal(edgeEval.kind, 'straight-edge');
  assert.equal(edgeEval.result.status, 'valid');

  const cubicSeg = p0.sewSegments.find(s => s.kind === 'cubic-bezier')!;
  const curveEntity: CadCurveEntity = {
    presentationRef: `${p0.pieceId}::sew::${cubicSeg.id}`,
    isAuthoritativeVertexId: false,
    entityKind: 'curve',
    label: `Cubic · ${cubicSeg.id}`,
    pieceId: p0.pieceId,
    pieceCode: p0.pieceCode,
    pieceName: p0.name,
    contour: 'sew',
    segmentId: cubicSeg.id,
    segmentKind: 'cubic-bezier',
    segmentRole: cubicSeg.role,
    p0LocalCm: cubicSeg.p0,
    p1LocalCm: cubicSeg.p1!,
    p2LocalCm: cubicSeg.p2!,
    p3LocalCm: cubicSeg.p3,
    parameterT: 0.4,
    localPointCm: cubicSeg.p0,
    boardPointCm: { x: cubicSeg.p0.x + pl0.offsetXCm, y: cubicSeg.p0.y + pl0.offsetYCm }
  };
  const curveSession = applyMeasurementEntityClick(EMPTY_MEASUREMENT_SESSION, curveEntity, 'auto');
  const curveEval = evaluateMeasurementSession(curveSession, artifact, board);
  assert.equal(curveEval.kind, 'cubic-bezier');
  assert.equal(curveEval.result.differential.status, 'valid');
  assert.equal(curveEval.result.fullArcLength.converged, true);
  assert.equal(curveEval.result.partialArcLength.converged, true);
  assert.ok(
    (curveEval.result.partialArcLength.arcLengthCm ?? 0) <
      (curveEval.result.fullArcLength.arcLengthCm ?? 0)
  );
});
