/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_PX_PER_CM,
  CadCamera,
  CadCoordinateProjection,
  worldCmToScreen
} from '../cad-math';
import {
  createInitialBoardSnapshot,
  groupBoardPieces,
  movePiecesByDeltaCm,
  reorderPieceLayer,
  toggleGroupVisibility,
  togglePieceVisibility
} from '../board-arrangement';
import type {
  CoordinateYAxisDirection,
  PatternArtifactBundle,
  PatternPieceRenderModel,
  RenderPoint2D
} from '../contracts/pattern-render-artifact';
import type { PatternCadLayerVisibility } from '../PatternAtelierViewContext';
import {
  buildDartLandmarkRef,
  buildDartRef,
  buildNotchRef,
  buildSegmentPointRef,
  buildSegmentRef,
  closestPointOnCubicBezier,
  closestPointOnLineSegment,
  COINCIDENT_VERTEX_EPSILON_CM,
  evaluateCubicBezierUnrounded,
  extractActiveCurveReference,
  extractContourVertices,
  hitTestPatternEntities,
  reconcileInspectedEntityWithArtifact
} from '../entity-hit-test';

const ALL_LAYERS_VISIBLE: PatternCadLayerVisibility = {
  showSeamAllowance: true,
  showSewLines: true,
  showGrainline: true,
  showNotches: true,
  showDarts: true,
  showDimensions: true
};

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
  }
  return obj;
}

function makeTestArtifact(
  yAxisDirection: CoordinateYAxisDirection = 'svg-y-down'
): PatternArtifactBundle {
  const pieceA: PatternPieceRenderModel = {
    pieceId: 'piece-a',
    pieceCode: 'TST-A',
    name: 'Test Bodice Panel',
    material: 'self',
    cutCount: 2,
    onFold: false,
    seamAllowanceWidthCm: 1.5,
    boundingBoxCm: { minX: 0, minY: 0, maxX: 20, maxY: 30, widthCm: 20, heightCm: 30 },
    sewSegments: [
      {
        id: 'seg-top',
        kind: 'line',
        role: 'stitching',
        seamId: 'seam-shoulder',
        p0: { x: 0.1234567, y: 0.2345678 },
        p3: { x: 12.3456789, y: 0.2345678 }
      },
      {
        id: 'seg-armhole',
        kind: 'cubic-bezier',
        role: 'stitching',
        seamId: 'seam-armhole',
        p0: { x: 12.3456789, y: 0.2345678 },
        p1: { x: 14.5, y: 7.25 },
        p2: { x: 19.75, y: 12.5 },
        p3: { x: 20.0, y: 18.0 }
      },
      {
        id: 'seg-side',
        kind: 'line',
        role: 'stitching',
        seamId: 'seam-side',
        p0: { x: 20.0, y: 18.0 },
        p3: { x: 20.0, y: 30.0 }
      },
      {
        id: 'seg-hem',
        kind: 'line',
        role: 'stitching',
        p0: { x: 20.0, y: 30.0 },
        p3: { x: 0.1234567, y: 30.0 }
      },
      {
        id: 'seg-cf',
        kind: 'line',
        role: 'fold',
        isFold: true,
        p0: { x: 0.1234567, y: 30.0 },
        p3: { x: 0.1234567, y: 0.2345678 }
      }
    ],
    cutSegments: [
      {
        id: 'cut-top',
        kind: 'line',
        role: 'cutting',
        p0: { x: -1.5, y: -1.5 },
        p3: { x: 21.5, y: -1.5 }
      },
      {
        id: 'cut-right',
        kind: 'line',
        role: 'cutting',
        p0: { x: 21.5, y: -1.5 },
        p3: { x: 21.5, y: 31.5 }
      },
      {
        id: 'cut-bottom',
        kind: 'line',
        role: 'cutting',
        p0: { x: 21.5, y: 31.5 },
        p3: { x: -1.5, y: 31.5 }
      },
      {
        id: 'cut-left',
        kind: 'line',
        role: 'fold',
        p0: { x: -1.5, y: 31.5 },
        p3: { x: -1.5, y: -1.5 }
      }
    ],
    seams: [],
    seamAllowances: [],
    notches: [
      {
        id: 'notch-scye-1',
        position: { x: 16.25, y: 10.75 },
        normalVector: { x: -1, y: 0 },
        notchType: 'single',
        label: 'Front Scye',
        segmentId: 'seg-armhole',
        parameterT: 0.52
      }
    ],
    darts: [
      {
        id: 'dart-waist-1',
        apex: { x: 10.0, y: 16.0 },
        legLeft: { x: 8.5, y: 30.0 },
        legRight: { x: 11.5, y: 30.0 },
        widthCm: 3.0,
        lengthCm: 14.0
      }
    ],
    hasBlockingError: false
  };

  const pieceB: PatternPieceRenderModel = {
    pieceId: 'piece-b',
    pieceCode: 'TST-B',
    name: 'Test Overlap Panel',
    material: 'self',
    cutCount: 1,
    onFold: true,
    seamAllowanceWidthCm: 1.5,
    boundingBoxCm: { minX: 0, minY: 0, maxX: 16, maxY: 20, widthCm: 16, heightCm: 20 },
    sewSegments: [
      {
        id: 'b-top',
        kind: 'line',
        role: 'stitching',
        p0: { x: 0, y: 0 },
        p3: { x: 16, y: 0 }
      },
      {
        id: 'b-right',
        kind: 'line',
        role: 'stitching',
        p0: { x: 16, y: 0 },
        p3: { x: 16, y: 20 }
      },
      {
        id: 'b-bottom',
        kind: 'line',
        role: 'stitching',
        p0: { x: 16, y: 20 },
        p3: { x: 0, y: 20 }
      },
      {
        id: 'b-left',
        kind: 'line',
        role: 'fold',
        p0: { x: 0, y: 20 },
        p3: { x: 0, y: 0 }
      }
    ],
    cutSegments: [],
    seams: [],
    seamAllowances: [],
    notches: [],
    darts: [],
    hasBlockingError: false
  };

  return {
    schemaVersion: 'patroner.pattern-render-artifact.v1',
    authorityTier:
      yAxisDirection === 'cartesian-y-up'
        ? 'UNVERIFIED_EXTERNAL_ARTIFACT'
        : 'C0_LEGACY_TS_PROTOTYPE',
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    coordinateFrame: {
      geometryUnit: 'cm',
      yAxisDirection,
      handedness: yAxisDirection === 'cartesian-y-up' ? 'right-handed-cartesian' : 'screen-y-down',
      exteriorWinding: yAxisDirection === 'cartesian-y-up' ? 'CCW' : 'CW'
    },
    provenance: {
      engineVersion: 'test-1.0',
      specificationRevisionId: 'spec-rev-1',
      measurementRevisionId: 'meas-rev-1',
      disclosureLabel: 'Non-certified test artifact'
    },
    pieces: [pieceA, pieceB],
    diagnostics: []
  };
}

function projectBoardPoint(
  localPt: RenderPoint2D,
  offsetX: number,
  offsetY: number,
  camera: CadCamera,
  projection: CadCoordinateProjection
): RenderPoint2D {
  return worldCmToScreen(
    { x: localPt.x + offsetX, y: localPt.y + offsetY },
    camera,
    projection
  );
}

test('UX-2.3.3.1: shared closed-contour vertex deduplication retains both incident segments without merging distinct nearby vertices', () => {
  const artifact = makeTestArtifact('svg-y-down');
  const pieceA = artifact.pieces[0];

  const { vertices, skippedInvalidCount } = extractContourVertices(
    pieceA.pieceId,
    'sew',
    pieceA.sewSegments
  );
  assert.equal(skippedInvalidCount, 0);
  // 5 closed-loop segments => exactly 5 deduplicated shared vertices (no duplicate p3s)
  assert.equal(vertices.length, 5);

  const shoulderArmholeJunction = vertices.find(
    v => v.presentationRef === buildSegmentPointRef('piece-a', 'sew', 'seg-armhole', 'p0')
  );
  assert.ok(shoulderArmholeJunction);
  assert.equal(shoulderArmholeJunction.isSharedJunction, true);
  assert.equal(shoulderArmholeJunction.incidentSegments.length, 2);
  assert.equal(shoulderArmholeJunction.incidentSegments[0].direction, 'incoming');
  assert.equal(shoulderArmholeJunction.incidentSegments[0].segmentId, 'seg-top');
  assert.equal(shoulderArmholeJunction.incidentSegments[0].endpointSlot, 'p3');
  assert.equal(shoulderArmholeJunction.incidentSegments[1].direction, 'outgoing');
  assert.equal(shoulderArmholeJunction.incidentSegments[1].segmentId, 'seg-armhole');
  assert.equal(shoulderArmholeJunction.incidentSegments[1].endpointSlot, 'p0');

  // Verify wrap-around junction (seg-cf::p3 -> seg-top::p0) is deduplicated too
  const wrapJunction = vertices.find(
    v => v.presentationRef === buildSegmentPointRef('piece-a', 'sew', 'seg-top', 'p0')
  );
  assert.ok(wrapJunction);
  assert.equal(wrapJunction.isSharedJunction, true);
  assert.equal(wrapJunction.incidentSegments[0].segmentId, 'seg-cf');
  assert.equal(wrapJunction.incidentSegments[1].segmentId, 'seg-top');

  // Distinct nearby vertices (> COINCIDENT_VERTEX_EPSILON_CM = 1e-4 cm, e.g. 0.05 cm apart) MUST NOT merge
  const gapSegments = [
    {
      id: 'g1',
      kind: 'line' as const,
      role: 'stitching' as const,
      p0: { x: 0, y: 0 },
      p3: { x: 10.0, y: 0 }
    },
    {
      id: 'g2',
      kind: 'line' as const,
      role: 'stitching' as const,
      p0: { x: 10.0 + COINCIDENT_VERTEX_EPSILON_CM * 50, y: 0 }, // 0.005 cm gap > 1e-4 cm
      p3: { x: 10.0, y: 10.0 }
    }
  ];
  const gapExtracted = extractContourVertices('piece-gap', 'sew', gapSegments);
  assert.equal(gapExtracted.vertices.length, 4);
  assert.ok(
    gapExtracted.vertices.some(
      v => v.presentationRef === buildSegmentPointRef('piece-gap', 'sew', 'g1', 'p3')
    )
  );
  assert.ok(
    gapExtracted.vertices.some(
      v => v.presentationRef === buildSegmentPointRef('piece-gap', 'sew', 'g2', 'p0')
    )
  );
  assert.equal(
    gapExtracted.vertices.every(v => !v.isSharedJunction),
    true
  );
});

test('UX-2.3.3.1: vertex hit-testing preserves unrounded IEEE-754 local coordinates and separate board coordinates without mutating frozen source', () => {
  const artifact = deepFreeze(makeTestArtifact('svg-y-down'));
  const board = movePiecesByDeltaCm(createInitialBoardSnapshot(artifact, 8), ['piece-a'], 5.25, 3.5);
  const plA = board.placementsByPieceId['piece-a'];
  const camera: CadCamera = { zoom: 1.5, panX: 60, panY: 40 };
  const projection: CadCoordinateProjection = {
    yAxisDirection: 'svg-y-down',
    basePxPerCm: BASE_PX_PER_CM
  };

  const targetLocal = { x: 12.3456789, y: 0.2345678 };
  const screenPt = projectBoardPoint(targetLocal, plA.offsetXCm, plA.offsetYCm, camera, projection);

  const res = hitTestPatternEntities(
    { x: screenPt.x + 2, y: screenPt.y - 2 },
    camera,
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );

  assert.equal(res.status, 'hit');
  assert.ok(res.hit);
  assert.equal(res.hit.entity.entityKind, 'vertex');
  assert.equal(res.hit.entity.isAuthoritativeVertexId, false);
  assert.equal(
    res.hit.entity.presentationRef,
    buildSegmentPointRef('piece-a', 'sew', 'seg-armhole', 'p0')
  );
  // Exact unrounded source coordinates preserved
  assert.equal(res.hit.entity.localPointCm.x, 12.3456789);
  assert.equal(res.hit.entity.localPointCm.y, 0.2345678);
  // Separate board coordinates include ephemeral placement offset
  assert.equal(res.hit.entity.boardPointCm.x, 12.3456789 + plA.offsetXCm);
  assert.equal(res.hit.entity.boardPointCm.y, 0.2345678 + plA.offsetYCm);
});

test('UX-2.3.3.1: straight edge hit-testing computes accurate projection and parameterT', () => {
  const lineRes = closestPointOnLineSegment(
    { x: 6, y: 2 },
    { x: 0, y: 0 },
    { x: 10, y: 0 }
  );
  assert.equal(lineRes.ok, true);
  if (lineRes.ok) {
    assert.ok(Math.abs(lineRes.parameterT - 0.6) < 1e-12);
    assert.ok(Math.abs(lineRes.pointCm.x - 6) < 1e-12);
    assert.ok(Math.abs(lineRes.pointCm.y - 0) < 1e-12);
    assert.ok(Math.abs(lineRes.distanceCm - 2) < 1e-12);
  }

  const artifact = makeTestArtifact('svg-y-down');
  const board = createInitialBoardSnapshot(artifact, 8);
  const plA = board.placementsByPieceId['piece-a'];
  const camera: CadCamera = { zoom: 1.0, panX: 40, panY: 40 };
  const projection: CadCoordinateProjection = {
    yAxisDirection: 'svg-y-down',
    basePxPerCm: BASE_PX_PER_CM
  };

  // Midpoint of seg-side: x=20, y=24 (far from vertices y=18 and y=30)
  const midScreen = projectBoardPoint(
    { x: 20, y: 24 },
    plA.offsetXCm,
    plA.offsetYCm,
    camera,
    projection
  );
  const res = hitTestPatternEntities(
    { x: midScreen.x + 3, y: midScreen.y },
    camera,
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );

  assert.equal(res.status, 'hit');
  assert.ok(res.hit);
  assert.equal(res.hit.entity.entityKind, 'edge');
  if (res.hit.entity.entityKind === 'edge') {
    assert.equal(res.hit.entity.presentationRef, buildSegmentRef('piece-a', 'sew', 'seg-side'));
    assert.equal(res.hit.entity.seamId, 'seam-side');
    assert.ok(Math.abs(res.hit.entity.parameterT - 0.5) < 1e-3);
    assert.ok(Math.abs(res.hit.entity.localPointCm.x - 20) < 1e-6);
  }
});

test('UX-2.3.3.1: cubic Bézier closest-point accuracy on S-curve & fail-closed behavior on non-finite input', () => {
  // Multi-lobe S-shaped cubic Bézier curve
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 10, y: 24 };
  const p2 = { x: 10, y: -24 };
  const p3 = { x: 20, y: 0 };

  const trueT = 0.73;
  const pointOnCurve = evaluateCubicBezierUnrounded(p0, p1, p2, p3, trueT);
  const res = closestPointOnCubicBezier(pointOnCurve, p0, p1, p2, p3);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(Math.abs(res.parameterT - trueT) < 1e-6, `expected t≈${trueT}, got ${res.parameterT}`);
    assert.ok(res.distanceCm < 1e-6, `expected distance < 1e-6, got ${res.distanceCm}`);
  }

  // Off-curve point compared against ultra-dense 10,000-sample reference
  const query = { x: 14.2, y: -4.8 };
  const offRes = closestPointOnCubicBezier(query, p0, p1, p2, p3);
  assert.equal(offRes.ok, true);
  let refMinDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= 10000; i++) {
    const pt = evaluateCubicBezierUnrounded(p0, p1, p2, p3, i / 10000);
    const d = Math.hypot(pt.x - query.x, pt.y - query.y);
    if (d < refMinDist) refMinDist = d;
  }
  if (offRes.ok) {
    assert.ok(
      offRes.distanceCm <= refMinDist + 1e-6,
      `closest distance ${offRes.distanceCm} exceeded reference ${refMinDist}`
    );
  }

  // Fail closed on NaN/Infinity without silently substituting an endpoint
  const nanRes = closestPointOnCubicBezier({ x: Number.NaN, y: 1 }, p0, p1, p2, p3);
  assert.equal(nanRes.ok, false);
  if (!nanRes.ok) {
    assert.equal(nanRes.reason, 'non-finite-input');
  }

  const infRes = closestPointOnCubicBezier(query, p0, { x: Number.POSITIVE_INFINITY, y: 0 }, p2, p3);
  assert.equal(infRes.ok, false);
});

test('UX-2.3.3.1: cubic curve and active Bézier control handle (p1/p2) hit-testing', () => {
  const artifact = makeTestArtifact('svg-y-down');
  const board = createInitialBoardSnapshot(artifact, 8);
  const plA = board.placementsByPieceId['piece-a'];
  const camera: CadCamera = { zoom: 1.2, panX: 50, panY: 50 };
  const projection: CadCoordinateProjection = {
    yAxisDirection: 'svg-y-down',
    basePxPerCm: BASE_PX_PER_CM
  };

  const seg = artifact.pieces[0].sewSegments[1]; // seg-armhole
  assert.equal(seg.kind, 'cubic-bezier');

  // 1. Hit the curve itself at t = 0.25 (away from endpoints & notch at t=0.52)
  const ptOnCurve = evaluateCubicBezierUnrounded(seg.p0, seg.p1!, seg.p2!, seg.p3, 0.25);
  const curveScreen = projectBoardPoint(ptOnCurve, plA.offsetXCm, plA.offsetYCm, camera, projection);
  const curveRes = hitTestPatternEntities(
    curveScreen,
    camera,
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );

  assert.equal(curveRes.status, 'hit');
  assert.ok(curveRes.hit);
  assert.equal(curveRes.hit.entity.entityKind, 'curve');
  assert.equal(curveRes.hit.entity.presentationRef, buildSegmentRef('piece-a', 'sew', 'seg-armhole'));

  // 2. Without activeCurve, clicking on p1 control handle does NOT hit a bezier-handle
  const p1Screen = projectBoardPoint(seg.p1!, plA.offsetXCm, plA.offsetYCm, camera, projection);
  const inactiveHandleRes = hitTestPatternEntities(
    p1Screen,
    camera,
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );
  assert.notEqual(inactiveHandleRes.hit?.entity.entityKind, 'bezier-handle');

  // 3. With activeCurve derived from inspected curve, p1 handle hits cleanly at Rank 0
  const activeCurve = extractActiveCurveReference(curveRes.hit.entity);
  const activeHandleRes = hitTestPatternEntities(
    p1Screen,
    camera,
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE,
    { activeCurve }
  );
  assert.equal(activeHandleRes.status, 'hit');
  assert.ok(activeHandleRes.hit);
  assert.equal(activeHandleRes.hit.entity.entityKind, 'bezier-handle');
  assert.equal(
    activeHandleRes.hit.entity.presentationRef,
    buildSegmentPointRef('piece-a', 'sew', 'seg-armhole', 'p1')
  );
  assert.equal(activeHandleRes.hit.entity.localPointCm.x, seg.p1!.x);
  assert.equal(activeHandleRes.hit.entity.localPointCm.y, seg.p1!.y);
});

test('UX-2.3.3.1: notch, dart landmark, and dart leg hit-testing', () => {
  const artifact = makeTestArtifact('svg-y-down');
  const board = createInitialBoardSnapshot(artifact, 8);
  const plA = board.placementsByPieceId['piece-a'];
  const camera: CadCamera = { zoom: 1.5, panX: 40, panY: 40 };
  const projection: CadCoordinateProjection = {
    yAxisDirection: 'svg-y-down',
    basePxPerCm: BASE_PX_PER_CM
  };

  // Notch hit
  const notchScreen = projectBoardPoint(
    { x: 16.25, y: 10.75 },
    plA.offsetXCm,
    plA.offsetYCm,
    camera,
    projection
  );
  const notchRes = hitTestPatternEntities(
    notchScreen,
    camera,
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(notchRes.status, 'hit');
  assert.equal(notchRes.hit?.entity.entityKind, 'notch');
  assert.equal(notchRes.hit?.entity.presentationRef, buildNotchRef('piece-a', 'notch-scye-1'));

  // Dart apex landmark hit (Rank 1 beats dart leg Rank 2)
  const apexScreen = projectBoardPoint(
    { x: 10.0, y: 16.0 },
    plA.offsetXCm,
    plA.offsetYCm,
    camera,
    projection
  );
  const apexRes = hitTestPatternEntities(
    apexScreen,
    camera,
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(apexRes.status, 'hit');
  assert.equal(apexRes.hit?.entity.entityKind, 'dart-landmark');
  assert.equal(
    apexRes.hit?.entity.presentationRef,
    buildDartLandmarkRef('piece-a', 'dart-waist-1', 'apex')
  );

  // Dart leg midpoint hit (between legLeft (8.5, 30) and apex (10, 16) => (9.25, 23))
  const legMidScreen = projectBoardPoint(
    { x: 9.25, y: 23.0 },
    plA.offsetXCm,
    plA.offsetYCm,
    camera,
    projection
  );
  const dartRes = hitTestPatternEntities(
    legMidScreen,
    camera,
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(dartRes.status, 'hit');
  assert.equal(dartRes.hit?.entity.entityKind, 'dart');
  assert.equal(dartRes.hit?.entity.presentationRef, buildDartRef('piece-a', 'dart-waist-1'));
});

test('UX-2.3.3.1: layer-order precedence when overlapping pieces share world coordinates', () => {
  const artifact = makeTestArtifact('svg-y-down');
  let board = createInitialBoardSnapshot(artifact, 8);
  // Move piece-b directly on top of piece-a's origin
  const plA = board.placementsByPieceId['piece-a'];
  const plB = board.placementsByPieceId['piece-b'];
  board = movePiecesByDeltaCm(
    board,
    ['piece-b'],
    plA.offsetXCm - plB.offsetXCm,
    plA.offsetYCm - plB.offsetYCm
  );

  const camera: CadCamera = { zoom: 1.0, panX: 40, panY: 40 };
  const projection: CadCoordinateProjection = {
    yAxisDirection: 'svg-y-down',
    basePxPerCm: BASE_PX_PER_CM
  };

  // Both piece-a (0.123, 0.234) and piece-b (0, 0) sit within hit tolerance of world (plA.offsetX, plA.offsetY)
  const overlapScreen = projectBoardPoint({ x: 0, y: 0 }, plA.offsetXCm, plA.offsetYCm, camera, projection);

  // Default layerOrder is ['piece-a', 'piece-b'] -> piece-b is on top
  const topBRes = hitTestPatternEntities(
    overlapScreen,
    camera,
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(topBRes.status, 'hit');
  assert.equal(topBRes.hit?.entity.pieceId, 'piece-b');

  // Reorder piece-a to front -> piece-a now wins
  const reorderedBoard = reorderPieceLayer(board, 'piece-a', 'front');
  const topARes = hitTestPatternEntities(
    overlapScreen,
    camera,
    projection,
    artifact,
    reorderedBoard,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(topARes.status, 'hit');
  assert.equal(topARes.hit?.entity.pieceId, 'piece-a');
});

test('UX-2.3.3.1: visibility filtering respects hidden pieces, hidden groups, and layer toggles', () => {
  const artifact = makeTestArtifact('svg-y-down');
  let board = createInitialBoardSnapshot(artifact, 8);
  const plA = board.placementsByPieceId['piece-a'];
  const camera: CadCamera = { zoom: 1.5, panX: 40, panY: 40 };
  const projection: CadCoordinateProjection = {
    yAxisDirection: 'svg-y-down',
    basePxPerCm: BASE_PX_PER_CM
  };

  const notchScreen = projectBoardPoint(
    { x: 16.25, y: 10.75 },
    plA.offsetXCm,
    plA.offsetYCm,
    camera,
    projection
  );

  // Hiding notches layer hides notch from hit-test
  const noNotchRes = hitTestPatternEntities(
    notchScreen,
    camera,
    projection,
    artifact,
    board,
    { ...ALL_LAYERS_VISIBLE, showNotches: false }
  );
  assert.notEqual(noNotchRes.hit?.entity.entityKind, 'notch');

  // Hiding piece-a prevents hitting any entity on piece-a
  const hiddenPieceBoard = togglePieceVisibility(board, 'piece-a');
  const vtxScreen = projectBoardPoint(
    { x: 12.3456789, y: 0.2345678 },
    plA.offsetXCm,
    plA.offsetYCm,
    camera,
    projection
  );
  const hiddenPieceRes = hitTestPatternEntities(
    vtxScreen,
    camera,
    projection,
    artifact,
    hiddenPieceBoard,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(hiddenPieceRes.status, 'miss');

  // Hiding group containing piece-a also blocks hits
  board = groupBoardPieces(board, ['piece-a', 'piece-b'], 'Pair');
  const gid = board.groupOrder[0];
  const hiddenGroupBoard = toggleGroupVisibility(board, gid);
  const hiddenGroupRes = hitTestPatternEntities(
    vtxScreen,
    camera,
    projection,
    artifact,
    hiddenGroupBoard,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(hiddenGroupRes.status, 'miss');
});

test('UX-2.3.3.1: zoom-normalized screen-pixel tolerance scales hitRadiusCm consistently across zooms', () => {
  const artifact = makeTestArtifact('svg-y-down');
  const board = createInitialBoardSnapshot(artifact, 8);
  const plA = board.placementsByPieceId['piece-a'];
  const projection: CadCoordinateProjection = {
    yAxisDirection: 'svg-y-down',
    basePxPerCm: BASE_PX_PER_CM
  };
  const vtx = { x: 20.0, y: 30.0 };

  for (const zoom of [0.25, 1.0, 4.0]) {
    const cam: CadCamera = { zoom, panX: 80, panY: 80 };
    const screenVtx = projectBoardPoint(vtx, plA.offsetXCm, plA.offsetYCm, cam, projection);

    // 8 px away should hit (default 10 px radius)
    const inside = hitTestPatternEntities(
      { x: screenVtx.x + 8, y: screenVtx.y },
      cam,
      projection,
      artifact,
      board,
      ALL_LAYERS_VISIBLE,
      { hitRadiusPx: 10 }
    );
    assert.equal(inside.status, 'hit', `expected hit at 8px offset for zoom=${zoom}`);
    assert.equal(inside.hit?.entity.entityKind, 'vertex');

    // 14 px diagonally outside (away from contour edges) should miss
    const outside = hitTestPatternEntities(
      { x: screenVtx.x + 14, y: screenVtx.y + 14 },
      cam,
      projection,
      artifact,
      board,
      { ...ALL_LAYERS_VISIBLE, showSeamAllowance: false },
      { hitRadiusPx: 10 }
    );
    assert.equal(outside.status, 'miss', `expected miss at (14,14)px offset for zoom=${zoom}`);
  }
});

test('UX-2.3.3.1: supports both svg-y-down and cartesian-y-up coordinate frames accurately', () => {
  for (const yAxisDirection of ['svg-y-down', 'cartesian-y-up'] as const) {
    const artifact = deepFreeze(makeTestArtifact(yAxisDirection));
    const board = createInitialBoardSnapshot(artifact, 8);
    const plA = board.placementsByPieceId['piece-a'];
    const camera: CadCamera = { zoom: 1.4, panX: 120, panY: 320 };
    const projection: CadCoordinateProjection = {
      yAxisDirection,
      basePxPerCm: BASE_PX_PER_CM
    };

    const vertexLocal = { x: 20.0, y: 18.0 };
    const screenPt = projectBoardPoint(vertexLocal, plA.offsetXCm, plA.offsetYCm, camera, projection);

    const res = hitTestPatternEntities(
      screenPt,
      camera,
      projection,
      artifact,
      board,
      ALL_LAYERS_VISIBLE
    );
    assert.equal(res.status, 'hit', `expected vertex hit in ${yAxisDirection}`);
    assert.equal(res.hit?.entity.entityKind, 'vertex');
    assert.equal(res.hit?.entity.localPointCm.x, 20.0);
    assert.equal(res.hit?.entity.localPointCm.y, 18.0);
  }
});

test('UX-2.3.3.1: invalid/NaN geometry and invalid camera fail closed without crashing', () => {
  const artifact = makeTestArtifact('svg-y-down');
  const board = createInitialBoardSnapshot(artifact, 8);
  const projection: CadCoordinateProjection = {
    yAxisDirection: 'svg-y-down',
    basePxPerCm: BASE_PX_PER_CM
  };

  // Non-finite screen input
  const badScreen = hitTestPatternEntities(
    { x: Number.NaN, y: 10 },
    { zoom: 1, panX: 0, panY: 0 },
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(badScreen.status, 'invalid-input');
  assert.equal(badScreen.hit, null);

  // Zero / negative zoom
  const badZoom = hitTestPatternEntities(
    { x: 10, y: 10 },
    { zoom: 0, panX: 0, panY: 0 },
    projection,
    artifact,
    board,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(badZoom.status, 'invalid-input');

  // Corrupt artifact with only NaN segments -> fails closed with invalid-geometry
  const corruptArtifact: PatternArtifactBundle = {
    ...artifact,
    pieces: [
      {
        ...artifact.pieces[0],
        sewSegments: [
          {
            id: 'bad-seg',
            kind: 'line',
            role: 'stitching',
            p0: { x: Number.NaN, y: 0 },
            p3: { x: 10, y: Number.POSITIVE_INFINITY }
          }
        ],
        cutSegments: [],
        notches: [],
        darts: []
      }
    ]
  };
  const corruptBoard = createInitialBoardSnapshot(corruptArtifact, 8);
  const corruptRes = hitTestPatternEntities(
    { x: 50, y: 50 },
    { zoom: 1, panX: 0, panY: 0 },
    projection,
    corruptArtifact,
    corruptBoard,
    ALL_LAYERS_VISIBLE
  );
  assert.equal(corruptRes.status, 'invalid-geometry');
  assert.equal(corruptRes.hit, null);
  assert.ok(corruptRes.skippedInvalidCount > 0);
});

test('UX-2.3.3.1: artifact reconciliation refreshes coordinates on board/artifact updates and clears stale or hidden entities', () => {
  const artifact1 = makeTestArtifact('svg-y-down');
  const board1 = createInitialBoardSnapshot(artifact1, 8);
  const plA1 = board1.placementsByPieceId['piece-a'];
  const camera: CadCamera = { zoom: 1.0, panX: 40, panY: 40 };
  const projection: CadCoordinateProjection = {
    yAxisDirection: 'svg-y-down',
    basePxPerCm: BASE_PX_PER_CM
  };

  const screenPt = projectBoardPoint(
    { x: 12.3456789, y: 0.2345678 },
    plA1.offsetXCm,
    plA1.offsetYCm,
    camera,
    projection
  );
  const hitRes = hitTestPatternEntities(
    screenPt,
    camera,
    projection,
    artifact1,
    board1,
    ALL_LAYERS_VISIBLE
  );
  assert.ok(hitRes.hit);
  const inspected = hitRes.hit.entity;

  // 1. Moving piece on board updates boardPointCm while keeping localPointCm unchanged
  const movedBoard = movePiecesByDeltaCm(board1, ['piece-a'], 7.5, -2.25);
  const afterMove = reconcileInspectedEntityWithArtifact(inspected, artifact1, movedBoard);
  assert.ok(afterMove);
  assert.equal(afterMove.localPointCm.x, inspected.localPointCm.x);
  assert.equal(afterMove.boardPointCm.x, inspected.boardPointCm.x + 7.5);
  assert.equal(afterMove.boardPointCm.y, inspected.boardPointCm.y - 2.25);

  // 2. Hiding the piece clears the inspected entity (no ghost overlay)
  const hiddenBoard = togglePieceVisibility(movedBoard, 'piece-a');
  const afterHide = reconcileInspectedEntityWithArtifact(afterMove, artifact1, hiddenBoard);
  assert.equal(afterHide, null);

  // 3. Updating artifact with piece removed clears inspected entity cleanly (zero stale refs)
  const artifactWithoutA: PatternArtifactBundle = {
    ...artifact1,
    pieces: [artifact1.pieces[1]]
  };
  const afterRemove = reconcileInspectedEntityWithArtifact(inspected, artifactWithoutA, board1);
  assert.equal(afterRemove, null);
});
