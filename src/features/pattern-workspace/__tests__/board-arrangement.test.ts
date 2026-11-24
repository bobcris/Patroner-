/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignBoardPieces,
  analyzeBoardOverlaps,
  boardCmToPieceLocal,
  clearBoardSelection,
  commitBoardSnapshot,
  createBoardHistory,
  createInitialBoardSnapshot,
  DEFAULT_SNAP_CONFIG,
  distributeBoardPieces,
  evaluateBoardSnapCm,
  getPieceBoardBoundsCm,
  groupBoardPieces,
  MAX_BOARD_HISTORY,
  movePiecesByDeltaCm,
  pieceLocalToBoardCm,
  pieceLocalToScreenPx,
  reconcileBoardHistoryWithArtifact,
  reconcileBoardStateWithArtifact,
  redoBoardHistory,
  reorderPieceLayer,
  screenPxToPieceLocalCm,
  selectPiecesInMarqueeRect,
  selectSinglePiece,
  setPieceBoardPositionCm,
  toggleGroupVisibility,
  togglePieceInSelection,
  togglePieceIntentionalOverlap,
  togglePieceVisibility,
  undoBoardHistory,
  ungroupBoardSelection
} from '../board-arrangement';
import type {
  PatternArtifactBundle,
  PatternPieceRenderModel,
  RenderCurveSegment
} from '../contracts/pattern-render-artifact';

function makeRectSegments(
  idPrefix: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  role: 'stitching' | 'cutting' = 'cutting'
): readonly RenderCurveSegment[] {
  return [
    { id: `${idPrefix}-t`, kind: 'line', role, p0: { x: minX, y: minY }, p3: { x: maxX, y: minY } },
    { id: `${idPrefix}-r`, kind: 'line', role, p0: { x: maxX, y: minY }, p3: { x: maxX, y: maxY } },
    { id: `${idPrefix}-b`, kind: 'line', role, p0: { x: maxX, y: maxY }, p3: { x: minX, y: maxY } },
    { id: `${idPrefix}-l`, kind: 'line', role, p0: { x: minX, y: maxY }, p3: { x: minX, y: minY } }
  ];
}

function makePiece(
  pieceId: string,
  pieceCode: string,
  widthCm: number,
  heightCm: number,
  options?: { hasBlockingError?: boolean; omitContours?: boolean }
): PatternPieceRenderModel {
  const cutSegs = options?.omitContours ? [] : makeRectSegments(`${pieceId}-cut`, 0, 0, widthCm, heightCm, 'cutting');
  const sewSegs = options?.omitContours
    ? []
    : makeRectSegments(`${pieceId}-sew`, 1, 1, widthCm - 1, heightCm - 1, 'stitching');

  return {
    pieceId,
    pieceCode,
    name: `${pieceCode} Panel`,
    material: 'self',
    cutCount: 1,
    onFold: false,
    seamAllowanceWidthCm: 1.0,
    boundingBoxCm: {
      minX: 0,
      minY: 0,
      maxX: widthCm,
      maxY: heightCm,
      widthCm,
      heightCm
    },
    sewSegments: sewSegs,
    cutSegments: cutSegs,
    seamAllowances: [],
    darts: [],
    notches: [
      {
        id: `${pieceId}-n1`,
        position: { x: widthCm, y: heightCm * 0.5 },
        normalVector: { x: 1, y: 0 },
        notchType: 'single'
      }
    ],
    grainline: {
      start: { x: widthCm * 0.5, y: 4 },
      end: { x: widthCm * 0.5, y: heightCm - 4 },
      direction: 'vertical'
    },
    seams: [],
    hasBlockingError: options?.hasBlockingError ?? false
  };
}

function makeArtifact(
  pieces: readonly PatternPieceRenderModel[],
  yAxisDirection: 'svg-y-down' | 'cartesian-y-up' = 'svg-y-down'
): PatternArtifactBundle {
  return {
    schemaVersion: 'patroner.pattern-render-artifact.v1',
    authorityTier: 'C0_LEGACY_TS_PROTOTYPE',
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    coordinateFrame: {
      geometryUnit: 'cm',
      handedness: yAxisDirection === 'cartesian-y-up' ? 'right-handed-cartesian' : 'screen-y-down',
      yAxisDirection,
      exteriorWinding: yAxisDirection === 'cartesian-y-up' ? 'CCW' : 'CW'
    },
    provenance: {
      specificationRevisionId: 'spec-1',
      measurementRevisionId: 'meas-M',
      engineVersion: 'test-fixture-1.0',
      disclosureLabel: 'C0-Legacy test fixture (non-authoritative)'
    },
    pieces,
    diagnostics: []
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

test('UX-2.3.2 board-arrangement: single selection, multi-selection, marquee rectangle, and clear selection', () => {
  const artifact = makeArtifact([
    makePiece('p-front', 'BOD-F', 20, 40),
    makePiece('p-back', 'BOD-B', 20, 40),
    makePiece('p-sleeve', 'SLV-1', 18, 45)
  ]);

  let state = createInitialBoardSnapshot(artifact, 10);
  assert.deepEqual(state.selectedPieceIds, ['p-front']);

  // Multi-select toggle (Shift+click)
  state = togglePieceInSelection(state, 'p-back');
  assert.deepEqual(state.selectedPieceIds, ['p-front', 'p-back']);

  // Single select replaces selection
  state = selectSinglePiece(state, 'p-sleeve');
  assert.deepEqual(state.selectedPieceIds, ['p-sleeve']);

  // Clear selection
  state = clearBoardSelection(state);
  assert.deepEqual(state.selectedPieceIds, []);

  // Marquee selection across first two pieces (p-front: [0..20], p-back: [30..50], p-sleeve: [60..78])
  state = selectPiecesInMarqueeRect(state, artifact, { minX: 5, minY: 5, maxX: 35, maxY: 35 }, 'replace');
  assert.deepEqual(state.selectedPieceIds, ['p-front', 'p-back']);

  // Hidden piece is excluded from marquee selection
  const withHidden = togglePieceVisibility(state, 'p-back');
  const afterHiddenMarquee = selectPiecesInMarqueeRect(
    withHidden,
    artifact,
    { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    'replace'
  );
  assert.deepEqual(afterHiddenMarquee.selectedPieceIds, ['p-front', 'p-sleeve']);
});

test('UX-2.3.2 board-arrangement: coordinate-frame conversions across piece-local, CAD board, and screen px (Y-down & Y-up)', () => {
  const placement = { offsetXCm: 25.5, offsetYCm: 14.25 };
  const localPt = { x: 10.2, y: 18.75 };
  const boardPt = pieceLocalToBoardCm(localPt, placement);
  assert.deepEqual(boardPt, { x: 35.7, y: 33 });
  assert.deepEqual(boardCmToPieceLocal(boardPt, placement), localPt);

  const camera = { zoom: 1.5, panX: 120, panY: 200 };
  for (const yAxisDirection of ['svg-y-down', 'cartesian-y-up'] as const) {
    const proj = { yAxisDirection, basePxPerCm: 10 };
    const screenPt = pieceLocalToScreenPx(localPt, placement, camera, proj);
    const roundTrippedLocal = screenPxToPieceLocalCm(screenPt, placement, camera, proj);
    assert.ok(Math.abs(roundTrippedLocal.x - localPt.x) < 1e-3);
    assert.ok(Math.abs(roundTrippedLocal.y - localPt.y) < 1e-3);
  }
});

test('UX-2.3.2 board-arrangement: repositioning, alignment, distribution, and non-mutation of frozen source geometry', () => {
  const artifact = deepFreeze(
    makeArtifact([
      makePiece('p1', 'P-01', 20, 30),
      makePiece('p2', 'P-02', 20, 40),
      makePiece('p3', 'P-03', 20, 25)
    ])
  );
  const originalSnapshotJson = JSON.stringify(artifact);

  let state = createInitialBoardSnapshot(artifact, 8);
  state = setPieceBoardPositionCm(state, 'p1', 0, 5);
  state = setPieceBoardPositionCm(state, 'p2', 30, 20);
  state = setPieceBoardPositionCm(state, 'p3', 90, 12);

  // Move delta
  state = movePiecesByDeltaCm(state, ['p1'], 4, -2);
  assert.equal(state.placementsByPieceId['p1'].offsetXCm, 4);
  assert.equal(state.placementsByPieceId['p1'].offsetYCm, 3);

  // Align top
  const alignedTop = alignBoardPieces(state, artifact, ['p1', 'p2', 'p3'], 'top');
  assert.equal(getPieceBoardBoundsCm(artifact.pieces[0], alignedTop.placementsByPieceId['p1']).minY, 3);
  assert.equal(getPieceBoardBoundsCm(artifact.pieces[1], alignedTop.placementsByPieceId['p2']).minY, 3);
  assert.equal(getPieceBoardBoundsCm(artifact.pieces[2], alignedTop.placementsByPieceId['p3']).minY, 3);

  // Align right
  const alignedRight = alignBoardPieces(state, artifact, ['p1', 'p2', 'p3'], 'right');
  const maxRight = getPieceBoardBoundsCm(artifact.pieces[2], alignedRight.placementsByPieceId['p3']).maxX;
  assert.equal(maxRight, 110);
  assert.equal(getPieceBoardBoundsCm(artifact.pieces[0], alignedRight.placementsByPieceId['p1']).maxX, 110);

  // Distribute horizontally: p1 at [4..24], p3 at [90..110], total span = 106, widths = 60, gap = 23 -> p2 minX = 47
  const distributedH = distributeBoardPieces(state, artifact, ['p1', 'p2', 'p3'], 'horizontal');
  assert.equal(distributedH.placementsByPieceId['p2'].offsetXCm, 47);

  // Distribute vertically
  const vBase = setPieceBoardPositionCm(
    setPieceBoardPositionCm(setPieceBoardPositionCm(state, 'p1', 0, 0), 'p2', 0, 40),
    'p3',
    0,
    100
  );
  // p1 [0..30], p2 height 40, p3 [100..125] -> span=125, sumHeights=95, gap=15 -> p2 minY=45
  const distributedV = distributeBoardPieces(vBase, artifact, ['p1', 'p2', 'p3'], 'vertical');
  assert.equal(distributedV.placementsByPieceId['p2'].offsetYCm, 45);

  // Source geometry remained 100% immutable
  assert.equal(JSON.stringify(artifact), originalSnapshotJson);
});

test('UX-2.3.2 board-arrangement: grouping, ungrouping, layer visibility, and layer ordering with zero stale refs', () => {
  const artifact = makeArtifact([
    makePiece('p1', 'P-01', 20, 30),
    makePiece('p2', 'P-02', 20, 30),
    makePiece('p3', 'P-03', 20, 30)
  ]);

  let state = createInitialBoardSnapshot(artifact, 8);
  assert.deepEqual(state.layerOrder, ['p1', 'p2', 'p3']);

  // Group p1 and p2
  state = groupBoardPieces(state, ['p1', 'p2'], 'Bodice Pair');
  assert.equal(state.groupOrder.length, 1);
  const gid = state.groupOrder[0];
  assert.equal(state.groupsById[gid].name, 'Bodice Pair');
  assert.equal(state.placementsByPieceId['p1'].groupId, gid);
  assert.equal(state.placementsByPieceId['p2'].groupId, gid);

  // Selecting one member expands to full group by default
  const selExpanded = selectSinglePiece(clearBoardSelection(state), 'p1');
  assert.deepEqual(selExpanded.selectedPieceIds.slice().sort(), ['p1', 'p2']);

  // Group visibility toggle
  state = toggleGroupVisibility(state, gid);
  assert.equal(state.groupsById[gid].visible, false);

  // Ungroup cleanly removes group and clears groupId on all members
  state = ungroupBoardSelection(state, ['p1']);
  assert.equal(state.groupOrder.length, 0);
  assert.equal(Object.keys(state.groupsById).length, 0);
  assert.equal(state.placementsByPieceId['p1'].groupId, null);
  assert.equal(state.placementsByPieceId['p2'].groupId, null);

  // Layer ordering
  state = reorderPieceLayer(state, 'p1', 'front');
  assert.deepEqual(state.layerOrder, ['p2', 'p3', 'p1']);
  state = reorderPieceLayer(state, 'p1', 'backward');
  assert.deepEqual(state.layerOrder, ['p2', 'p1', 'p3']);
  state = reorderPieceLayer(state, 'p3', 'back');
  assert.deepEqual(state.layerOrder, ['p3', 'p2', 'p1']);
});

test('UX-2.3.2 board-arrangement: centimeter grid snapping and feature snapping with alignment guides', () => {
  const artifact = makeArtifact([
    makePiece('p1', 'SK-01', 20, 40),
    makePiece('p2', 'SK-02', 20, 40)
  ]);
  let state = createInitialBoardSnapshot(artifact, 10);
  state = setPieceBoardPositionCm(state, 'p1', 0, 0);
  state = setPieceBoardPositionCm(state, 'p2', 30, 10);

  // Grid snapping at 2.0 cm interval (disable feature snapping to isolate grid snap)
  const gridSnap = evaluateBoardSnapCm(state, artifact, ['p2'], 1.7, 2.3, {
    ...DEFAULT_SNAP_CONFIG,
    gridEnabled: true,
    gridIntervalCm: 2.0,
    featureEnabled: false,
    toleranceCm: 1.0
  });
  // p2 proposed minX = 31.7 -> snaps to 32.0 (dx = +2.0); proposed minY = 12.3 -> snaps to 12.0 (dy = +2.0)
  assert.equal(gridSnap.snappedX, true);
  assert.equal(gridSnap.snappedY, true);
  assert.equal(gridSnap.snapKindX, 'grid');
  assert.equal(gridSnap.snapKindY, 'grid');
  assert.equal(gridSnap.dxCm, 2.0);
  assert.equal(gridSnap.dyCm, 2.0);
  assert.equal(gridSnap.guides.length, 2);

  // Feature snapping: drag p2 near p1's top (Y=0) and right edge (X=20)
  // p2 starts at (30, 10). Moving by (-9.4, -9.5) puts p2.minX = 20.6 (within 1.2cm of p1.maxX=20), p2.minY = 0.5 (within 1.2cm of p1.minY=0)
  const featureSnap = evaluateBoardSnapCm(state, artifact, ['p2'], -9.4, -9.5, {
    ...DEFAULT_SNAP_CONFIG,
    gridEnabled: true,
    gridIntervalCm: 5.0,
    featureEnabled: true,
    toleranceCm: 1.2
  });
  assert.equal(featureSnap.snappedX, true);
  assert.equal(featureSnap.snappedY, true);
  assert.equal(featureSnap.snapKindX, 'feature');
  assert.equal(featureSnap.snapKindY, 'feature');
  assert.equal(featureSnap.dxCm, -10.0);
  assert.equal(featureSnap.dyCm, -10.0);
  assert.ok(featureSnap.guides.some(g => g.axis === 'vertical' && g.positionCm === 20));
  assert.ok(featureSnap.guides.some(g => g.axis === 'horizontal' && g.positionCm === 0));
});

test('UX-2.3.2 board-arrangement: overlap classification covers unintentional, intentional, containment, touching, and unresolved', () => {
  // 1. Unintentional vs Intentional overlap
  const overlapArtifact = makeArtifact([
    makePiece('pA', 'A-01', 20, 30),
    makePiece('pB', 'B-01', 20, 30)
  ]);
  let s = createInitialBoardSnapshot(overlapArtifact, 10);
  assert.equal(analyzeBoardOverlaps(s, overlapArtifact).length, 0);

  // Move pB to overlap pA's interior ([10..30] overlaps [0..20])
  s = setPieceBoardPositionCm(s, 'pB', 10, 0);
  let advisories = analyzeBoardOverlaps(s, overlapArtifact);
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].classification, 'unintentional-overlap');
  assert.equal(advisories[0].isAdvisoryOnly, true);

  // Mark pB intentional overlap
  s = togglePieceIntentionalOverlap(s, 'pB');
  advisories = analyzeBoardOverlaps(s, overlapArtifact);
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].classification, 'intentional-overlap');

  // 2. Touching boundaries (pB starts exactly at x=20.05 -> within 0.15 cm tolerance, zero interior overlap)
  const touchState = setPieceBoardPositionCm(
    createInitialBoardSnapshot(overlapArtifact, 10),
    'pB',
    20.05,
    0
  );
  const touchAdvisories = analyzeBoardOverlaps(touchState, overlapArtifact);
  assert.equal(touchAdvisories.length, 1);
  assert.equal(touchAdvisories[0].classification, 'touching-boundaries');

  // 3. Containment (small pocket strictly inside large panel)
  const containArtifact = makeArtifact([
    makePiece('pBig', 'BIG-01', 40, 50),
    makePiece('pSmall', 'PKT-01', 10, 10)
  ]);
  const containState = setPieceBoardPositionCm(
    createInitialBoardSnapshot(containArtifact, 10),
    'pSmall',
    12,
    15
  );
  const containAdvisories = analyzeBoardOverlaps(containState, containArtifact);
  assert.equal(containAdvisories.length, 1);
  assert.equal(containAdvisories[0].classification, 'containment');

  // 4. Unresolved advisory when contour geometry is blocked or missing
  const unresolvedArtifact = makeArtifact([
    makePiece('pOk', 'OK-01', 20, 30),
    makePiece('pBad', 'BAD-01', 20, 30, { omitContours: true })
  ]);
  const unresState = setPieceBoardPositionCm(
    createInitialBoardSnapshot(unresolvedArtifact, 10),
    'pBad',
    5,
    0
  );
  const unresAdvisories = analyzeBoardOverlaps(unresState, unresolvedArtifact);
  assert.ok(unresAdvisories.length >= 1);
  assert.ok(unresAdvisories.every(a => a.classification === 'unresolved'));
});

test('UX-2.3.2 board-arrangement: bounded undo/redo history and stable-identity reconciliation', () => {
  const artifactA = makeArtifact([
    makePiece('p1', 'BOD-F', 20, 40),
    makePiece('p2', 'BOD-B', 20, 40)
  ]);
  let history = createBoardHistory(createInitialBoardSnapshot(artifactA, 8));

  // Commit move, group, visibility, reorder
  const moved = movePiecesByDeltaCm(history.present, ['p1'], 12, 6);
  history = commitBoardSnapshot(history, moved, 'Move BOD-F');
  const grouped = groupBoardPieces(history.present, ['p1', 'p2']);
  history = commitBoardSnapshot(history, grouped, 'Group pieces');
  const reordered = reorderPieceLayer(history.present, 'p1', 'front');
  history = commitBoardSnapshot(history, reordered, 'Bring BOD-F forward');
  assert.equal(history.past.length, 3);

  // Undo step-by-step
  history = undoBoardHistory(history);
  assert.deepEqual(history.present.layerOrder, ['p1', 'p2']);
  history = undoBoardHistory(history);
  assert.equal(history.present.groupOrder.length, 0);
  history = undoBoardHistory(history);
  assert.equal(history.present.placementsByPieceId['p1'].offsetXCm, 0);
  assert.equal(history.future.length, 3);

  // Redo and branch clears future
  history = redoBoardHistory(history);
  assert.equal(history.present.placementsByPieceId['p1'].offsetXCm, 12);
  history = commitBoardSnapshot(
    history,
    togglePieceVisibility(history.present, 'p2'),
    'Hide BOD-B'
  );
  assert.equal(history.future.length, 0);

  // Bounded history cap check
  for (let i = 0; i < MAX_BOARD_HISTORY + 15; i++) {
    history = commitBoardSnapshot(
      history,
      movePiecesByDeltaCm(history.present, ['p1'], 1, 0),
      `Step ${i}`
    );
  }
  assert.equal(history.past.length, MAX_BOARD_HISTORY);

  // Reconciliation: add p3 while keeping p1 & p2 stable placements
  const p1XBefore = history.present.placementsByPieceId['p1'].offsetXCm;
  const artifactWithSleeve = makeArtifact([
    makePiece('p1', 'BOD-F', 20, 40),
    makePiece('p2', 'BOD-B', 20, 40),
    makePiece('p3', 'SLV-1', 18, 45)
  ]);
  const reconciled = reconcileBoardStateWithArtifact(history.present, artifactWithSleeve, 8);
  assert.equal(reconciled.placementsByPieceId['p1'].offsetXCm, p1XBefore);
  assert.ok(reconciled.placementsByPieceId['p3']);
  assert.equal(reconciled.layerOrder.length, 3);

  // Switching to an entirely unrelated garment (skirt) resets history cleanly with zero stale IDs
  const skirtArtifact = makeArtifact([makePiece('sk-f', 'SK-F', 25, 65)]);
  const switchedHistory = reconcileBoardHistoryWithArtifact(history, skirtArtifact);
  assert.equal(switchedHistory.past.length, 0);
  assert.deepEqual(switchedHistory.present.layerOrder, ['sk-f']);
  assert.equal(switchedHistory.present.placementsByPieceId['p1'], undefined);
});
