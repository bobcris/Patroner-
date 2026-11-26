/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  PatternArtifactBundle,
  PatternArtifactCoordinateFrame,
  PatternPieceRenderModel,
  RenderCurveSegment
} from '../contracts/pattern-render-artifact';
import {
  evaluateCubicBezierUnrounded
} from '../entity-hit-test';
import {
  applyCubicToLineApproximation,
  applyRemoveVertexAndMerge,
  buildProposedInspectionArtifact,
  canRedoProposal,
  canUndoProposal,
  commitProposalOperation,
  computeCubicToChordMaxDeviation,
  createEmptyProposalHistory,
  createProposalStateFromArtifact,
  DEFAULT_SNAP_CONSTRAINT_CONFIG,
  discardAllProposal,
  discardPieceProposal,
  elevateLineToCubicExact,
  evaluateProposalIntegrity,
  extractSourceArtifactIdentity,
  getEditableSewVerticesForPiece,
  MAX_PROPOSAL_HISTORY_ENTRIES,
  moveBezierHandle,
  moveContourVertex,
  previewCubicToLineApproximation,
  previewRemoveVertexAndMerge,
  PROPOSAL_AUTHORITY_TIER,
  reconcileProposalHistoryWithArtifact,
  redoProposalHistory,
  serializeProposalPayload,
  setVertexContinuityMode,
  snapAndConstrainPoint,
  splitSewSegmentAtT,
  alignVertexToReference,
  undoProposalHistory
} from '../geometry-edit-proposal';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeCartesianFrame(): PatternArtifactCoordinateFrame {
  return {
    geometryUnit: 'cm',
    yAxisDirection: 'cartesian-y-up',
    handedness: 'right-handed-cartesian',
    exteriorWinding: 'CCW'
  };
}

function makeSvgYDownFrame(): PatternArtifactCoordinateFrame {
  return {
    geometryUnit: 'cm',
    yAxisDirection: 'svg-y-down',
    handedness: 'screen-y-down',
    exteriorWinding: 'CW'
  };
}

/**
 * Builds a closed CCW 4-segment rectangular/curved test piece in Cartesian Y-up:
 *   seg-bottom: line (0,0) -> (20,0)
 *   seg-right:  cubic (20,0) -> (20,30) with outward belly to x=24
 *   seg-top:    cubic (20,30) -> (0,30) with gentle arch to y=32
 *   seg-left:   line (0,30) -> (0,0)
 * Plus an immutable cut contour offset by 1.5 cm.
 */
function makeTestPiece(overrides?: Partial<PatternPieceRenderModel>): PatternPieceRenderModel {
  const sewSegments: RenderCurveSegment[] = [
    {
      id: 'seg-bottom',
      kind: 'line',
      seamId: 'hem',
      role: 'stitching',
      p0: { x: 0, y: 0 },
      p3: { x: 20, y: 0 }
    },
    {
      id: 'seg-right',
      kind: 'cubic-bezier',
      seamId: 'side-seam',
      role: 'stitching',
      p0: { x: 20, y: 0 },
      p1: { x: 24, y: 10 },
      p2: { x: 24, y: 20 },
      p3: { x: 20, y: 30 }
    },
    {
      id: 'seg-top',
      kind: 'cubic-bezier',
      seamId: 'shoulder',
      role: 'stitching',
      p0: { x: 20, y: 30 },
      p1: { x: 14, y: 32 },
      p2: { x: 6, y: 32 },
      p3: { x: 0, y: 30 }
    },
    {
      id: 'seg-left',
      kind: 'line',
      seamId: 'center-front',
      role: 'stitching',
      p0: { x: 0, y: 30 },
      p3: { x: 0, y: 0 }
    }
  ];

  const cutSegments: RenderCurveSegment[] = [
    {
      id: 'cut-bottom',
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
      id: 'cut-top',
      kind: 'line',
      role: 'cutting',
      p0: { x: 21.5, y: 31.5 },
      p3: { x: -1.5, y: 31.5 }
    },
    {
      id: 'cut-left',
      kind: 'line',
      role: 'cutting',
      p0: { x: -1.5, y: 31.5 },
      p3: { x: -1.5, y: -1.5 }
    }
  ];

  return {
    pieceId: 'front-bodice',
    pieceCode: 'FB-01',
    name: 'Front Bodice',
    material: 'self',
    cutCount: 2,
    onFold: false,
    seamAllowanceWidthCm: 1.5,
    boundingBoxCm: { minX: -1.5, minY: -1.5, maxX: 24, maxY: 32, widthCm: 25.5, heightCm: 33.5 },
    sewSegments,
    cutSegments,
    seams: [
      {
        id: 'seam-side',
        name: 'Side Seam',
        lengthCm: 31.1,
        segmentIds: ['seg-right'],
        pairedPieceId: 'back-bodice',
        pairedSeamName: 'Side Seam'
      }
    ],
    seamAllowances: [],
    darts: [],
    notches: [],
    hasBlockingError: false,
    ...overrides
  };
}

function makePairedBackPiece(): PatternPieceRenderModel {
  return makeTestPiece({
    pieceId: 'back-bodice',
    pieceCode: 'BB-01',
    name: 'Back Bodice',
    seams: [
      {
        id: 'back-seam-side',
        name: 'Side Seam',
        lengthCm: 31.1,
        segmentIds: ['seg-right'],
        pairedPieceId: 'front-bodice',
        pairedSeamName: 'Side Seam'
      }
    ]
  });
}

function makeTestArtifact(options?: {
  frame?: PatternArtifactCoordinateFrame;
  digest?: string;
  specRev?: string;
  pieces?: PatternPieceRenderModel[];
}): PatternArtifactBundle {
  return {
    schemaVersion: 'patroner.pattern-render-artifact.v1',
    authorityTier: 'C0_LEGACY_TS_PROTOTYPE',
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    coordinateFrame: options?.frame ?? makeCartesianFrame(),
    provenance: {
      specificationRevisionId: options?.specRev ?? 'spec-rev-001',
      measurementRevisionId: 'meas-rev-001',
      ...(options?.digest !== undefined ? { artifactDigestSha256: options.digest } : {}),
      engineVersion: 'c0-ts-0.1',
      disclosureLabel: 'Test prototype artifact'
    },
    pieces: options?.pieces ?? [makeTestPiece(), makePairedBackPiece()],
    diagnostics: [
      {
        id: 'diag-orig-1',
        code: 'TEST_DIAG',
        severity: 'WARNING',
        pieceId: 'front-bodice',
        segmentId: 'seg-right',
        contour: 'sew',
        parameterT: 0.5,
        message: 'Original artifact diagnostic'
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// 1. Source Artifact Immutability & D2 Read-Only Cut Segments
// ---------------------------------------------------------------------------

test('UX-2.3.3.4: source artifact and cutSegments remain strictly immutable across edits (D2)', () => {
  const artifact = makeTestArtifact();
  const originalSnapshot = JSON.stringify(artifact);
  const state = createProposalStateFromArtifact(artifact);

  const vertices = getEditableSewVerticesForPiece('front-bodice', artifact.pieces[0].sewSegments);
  const topRight = vertices.find((v) => v.outgoingSegmentId === 'seg-top')!;
  const res = moveContourVertex(state, artifact, 'front-bodice', topRight.entityRef, {
    x: 21.25,
    y: 30.75
  });

  assert.equal(res.ok, true);
  assert.equal(JSON.stringify(artifact), originalSnapshot, 'Source artifact must never mutate');

  if (res.ok) {
    const pieceProp = res.state.pieceProposals['front-bodice'];
    assert.equal(pieceProp.modifiedFromOriginal, true);
    assert.equal(pieceProp.cutContourPotentiallyStale, true);
    assert.equal(res.state.authorityTier, PROPOSAL_AUTHORITY_TIER);
    assert.equal(res.state.isCertified, false);
    assert.equal(res.state.isProductionReady, false);

    // D3 projection preserves original cutSegments byte-for-byte
    const projected = buildProposedInspectionArtifact(artifact, res.state);
    assert.deepEqual(projected.pieces[0].cutSegments, artifact.pieces[0].cutSegments);
    assert.equal(projected.authorityTier, 'UNVERIFIED_VISUAL_PROPOSAL');
    assert.equal(projected.isCertified, false);
    assert.equal(projected.isProductionReady, false);
    // D3: diagnostics are never migrated onto proposal artifact
    assert.equal(projected.diagnostics.length, 0);
    assert.equal(artifact.diagnostics.length, 1);
  }
});

// ---------------------------------------------------------------------------
// 2. Shared-Vertex Atomic Coupling & Optional Adjacent Handle Translation
// ---------------------------------------------------------------------------

test('UX-2.3.3.4: moving a shared vertex updates incoming.p3 and outgoing.p0 atomically + optional handle translation', () => {
  const artifact = makeTestArtifact();
  const state = createProposalStateFromArtifact(artifact);
  const vertices = getEditableSewVerticesForPiece('front-bodice', artifact.pieces[0].sewSegments);
  const topRight = vertices.find((v) => v.outgoingSegmentId === 'seg-top')!;
  assert.equal(topRight.isShared, true);
  assert.equal(topRight.incomingSegmentId, 'seg-right');
  assert.equal(topRight.outgoingSegmentId, 'seg-top');

  // Translate adjacent handles = true
  const movedWithHandles = moveContourVertex(
    state,
    artifact,
    'front-bodice',
    topRight.entityRef,
    { x: 22.123456789, y: 31.987654321 },
    { translateAdjacentHandles: true }
  );
  assert.equal(movedWithHandles.ok, true);
  if (movedWithHandles.ok) {
    const segs = movedWithHandles.state.pieceProposals['front-bodice'].sewSegments;
    const segRight = segs.find((s) => s.id === 'seg-right')!;
    const segTop = segs.find((s) => s.id === 'seg-top')!;
    // Exact float64 precision preserved without rounding
    assert.equal(segRight.p3.x, 22.123456789);
    assert.equal(segRight.p3.y, 31.987654321);
    assert.equal(segTop.p0.x, 22.123456789);
    assert.equal(segTop.p0.y, 31.987654321);
    // Adjacent handles translated by exact delta (+2.123456789, +1.987654321)
    assert.ok(Math.abs(segRight.p2!.x - (24 + 2.123456789)) < 1e-12);
    assert.ok(Math.abs(segRight.p2!.y - (20 + 1.987654321)) < 1e-12);
    assert.ok(Math.abs(segTop.p1!.x - (14 + 2.123456789)) < 1e-12);
    assert.ok(Math.abs(segTop.p1!.y - (32 + 1.987654321)) < 1e-12);
  }

  // Translate adjacent handles = false
  const movedWithoutHandles = moveContourVertex(
    state,
    artifact,
    'front-bodice',
    topRight.entityRef,
    { x: 22, y: 31 },
    { translateAdjacentHandles: false }
  );
  assert.equal(movedWithoutHandles.ok, true);
  if (movedWithoutHandles.ok) {
    const segs = movedWithoutHandles.state.pieceProposals['front-bodice'].sewSegments;
    const segRight = segs.find((s) => s.id === 'seg-right')!;
    const segTop = segs.find((s) => s.id === 'seg-top')!;
    assert.deepEqual(segRight.p2, { x: 24, y: 20 });
    assert.deepEqual(segTop.p1, { x: 14, y: 32 });
  }
});

// ---------------------------------------------------------------------------
// 3. Bézier Handle Continuity Modes (C0 Corner, G1 Smooth, Symmetric)
// ---------------------------------------------------------------------------

test('UX-2.3.3.4: handle continuity enforces C0 independent, G1 collinear preserving length, and Symmetric mirrored', () => {
  const artifact = makeTestArtifact();
  const state = createProposalStateFromArtifact(artifact);

  // C0 corner: moving seg-top p1 leaves seg-right p2 untouched
  const c0 = moveBezierHandle(
    state,
    artifact,
    'front-bodice',
    'seg-top',
    'p1',
    { x: 15, y: 35 },
    { continuityMode: 'c0-corner' }
  );
  assert.equal(c0.ok, true);
  if (c0.ok) {
    const segRight = c0.state.pieceProposals['front-bodice'].sewSegments.find((s) => s.id === 'seg-right')!;
    assert.deepEqual(segRight.p2, { x: 24, y: 20 });
  }

  // G1 smooth: moving seg-top p1 to (15, 30) (purely -X direction from anchor (20,30))
  // rotates seg-right p2 to +X direction from (20,30) while preserving its original distance sqrt(4^2 + 10^2)
  const origOppLen = Math.hypot(24 - 20, 20 - 30);
  const g1 = moveBezierHandle(
    state,
    artifact,
    'front-bodice',
    'seg-top',
    'p1',
    { x: 15, y: 30 },
    { continuityMode: 'g1-smooth' }
  );
  assert.equal(g1.ok, true);
  if (g1.ok) {
    const segRight = g1.state.pieceProposals['front-bodice'].sewSegments.find((s) => s.id === 'seg-right')!;
    assert.ok(Math.abs(segRight.p2!.x - (20 + origOppLen)) < 1e-12);
    assert.ok(Math.abs(segRight.p2!.y - 30) < 1e-12);
  }

  // Symmetric: moving seg-top p1 to (16, 33) mirrors seg-right p2 to (24, 27)
  const sym = moveBezierHandle(
    state,
    artifact,
    'front-bodice',
    'seg-top',
    'p1',
    { x: 16, y: 33 },
    { continuityMode: 'symmetric' }
  );
  assert.equal(sym.ok, true);
  if (sym.ok) {
    const segRight = sym.state.pieceProposals['front-bodice'].sewSegments.find((s) => s.id === 'seg-right')!;
    assert.ok(Math.abs(segRight.p2!.x - 24) < 1e-12);
    assert.ok(Math.abs(segRight.p2!.y - 27) < 1e-12);
  }

  // Explicit setVertexContinuityMode aligns existing handles cleanly
  const vertices = getEditableSewVerticesForPiece('front-bodice', artifact.pieces[0].sewSegments);
  const topRight = vertices.find((v) => v.outgoingSegmentId === 'seg-top')!;
  const setSym = setVertexContinuityMode(state, artifact, 'front-bodice', topRight.entityRef, 'symmetric');
  assert.equal(setSym.ok, true);
  if (setSym.ok) {
    const segs = setSym.state.pieceProposals['front-bodice'].sewSegments;
    const sr = segs.find((s) => s.id === 'seg-right')!;
    const st = segs.find((s) => s.id === 'seg-top')!;
    const midX = (sr.p2!.x + st.p1!.x) / 2;
    const midY = (sr.p2!.y + st.p1!.y) / 2;
    assert.ok(Math.abs(midX - 20) < 1e-12);
    assert.ok(Math.abs(midY - 30) < 1e-12);
  }
});

// ---------------------------------------------------------------------------
// 4. Exact De Casteljau Cubic Subdivision & Line Subdivision (< 1e-12 cm)
// ---------------------------------------------------------------------------

test('UX-2.3.3.4: exact De Casteljau subdivision preserves cubic curve geometry within 1e-12 cm', () => {
  const artifact = makeTestArtifact();
  const state = createProposalStateFromArtifact(artifact);
  const origSeg = artifact.pieces[0].sewSegments.find((s) => s.id === 'seg-right')!;
  const splitT = 0.37;

  const res = splitSewSegmentAtT(state, artifact, 'front-bodice', 'seg-right', splitT);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.isExact, true);
    assert.equal(res.maxDeviationCm, 0);
    assert.equal(res.createdSegmentIds?.length, 2);

    const segs = res.state.pieceProposals['front-bodice'].sewSegments;
    assert.equal(segs.length, 5);
    const segA = segs.find((s) => s.id === res.createdSegmentIds![0])!;
    const segB = segs.find((s) => s.id === res.createdSegmentIds![1])!;

    // Verify exact curve equivalence across 100 points on both halves
    for (let i = 0; i <= 50; i += 1) {
      const u = i / 50;
      const pOrigA = evaluateCubicBezierUnrounded(origSeg.p0, origSeg.p1!, origSeg.p2!, origSeg.p3, splitT * u);
      const pSubA = evaluateCubicBezierUnrounded(segA.p0, segA.p1!, segA.p2!, segA.p3, u);
      assert.ok(Math.hypot(pOrigA.x - pSubA.x, pOrigA.y - pSubA.y) < 1e-12);

      const pOrigB = evaluateCubicBezierUnrounded(
        origSeg.p0,
        origSeg.p1!,
        origSeg.p2!,
        origSeg.p3,
        splitT + (1 - splitT) * u
      );
      const pSubB = evaluateCubicBezierUnrounded(segB.p0, segB.p1!, segB.p2!, segB.p3, u);
      assert.ok(Math.hypot(pOrigB.x - pSubB.x, pOrigB.y - pSubB.y) < 1e-12);
    }

    // Lineage traces both children back to base segment 'seg-right'
    const lin = res.state.pieceProposals['front-bodice'].segmentLineage;
    assert.deepEqual(lin[segA.id].baseSegmentIds, ['seg-right']);
    assert.deepEqual(lin[segB.id].baseSegmentIds, ['seg-right']);
    assert.equal(lin[segA.id].derivation, 'split-exact');
  }

  // Out-of-bounds t fails closed
  const badT = splitSewSegmentAtT(state, artifact, 'front-bodice', 'seg-right', 1.0);
  assert.equal(badT.ok, false);
});

// ---------------------------------------------------------------------------
// 5. Exact Line-to-Cubic Degree Elevation
// ---------------------------------------------------------------------------

test('UX-2.3.3.4: line-to-cubic degree elevation is mathematically exact with 0 deviation', () => {
  const artifact = makeTestArtifact();
  const state = createProposalStateFromArtifact(artifact);
  const res = elevateLineToCubicExact(state, artifact, 'front-bodice', 'seg-bottom');

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.isExact, true);
    assert.equal(res.maxDeviationCm, 0);
    const elevated = res.state.pieceProposals['front-bodice'].sewSegments.find((s) => s.id === 'seg-bottom')!;
    assert.equal(elevated.kind, 'cubic-bezier');
    assert.ok(Math.abs(elevated.p1!.x - 20 / 3) < 1e-12);
    assert.ok(Math.abs(elevated.p2!.x - 40 / 3) < 1e-12);
    assert.ok(computeCubicToChordMaxDeviation(elevated).maxDeviationCm < 1e-12);
  }
});

// ---------------------------------------------------------------------------
// 6. R1 — Approximate Cubic-to-Line Conversion (Deviation, Tolerance, Confirm)
// ---------------------------------------------------------------------------

test('UX-2.3.3.4 (R1): cubic-to-line computes deterministic max deviation, enforces tolerance, requires confirmation, never claims exact', () => {
  const artifact = makeTestArtifact();
  const state = createProposalStateFromArtifact(artifact);

  // seg-right: p0=(20,0), p1=(24,10), p2=(24,20), p3=(20,30)
  // Exact max deviation occurs at t=0.5: x(0.5) = 20*0.125 + 24*0.375 + 24*0.375 + 20*0.125 = 23.0 => deviation = 3.0 cm
  const segRight = artifact.pieces[0].sewSegments.find((s) => s.id === 'seg-right')!;
  const dev = computeCubicToChordMaxDeviation(segRight);
  assert.ok(Math.abs(dev.maxDeviationCm - 3.0) < 1e-9, `Expected 3.0 cm deviation, got ${dev.maxDeviationCm}`);
  assert.ok(Math.abs(dev.worstParameterT - 0.5) < 1e-6);

  // Preview with default tolerance 0.25 cm -> rejected (exceedsTolerance: true, isExact: false)
  const rejectedPreview = previewCubicToLineApproximation(state, artifact, 'front-bodice', 'seg-right', 0.25);
  assert.equal('ok' in rejectedPreview, false);
  if (!('ok' in rejectedPreview)) {
    assert.equal(rejectedPreview.isExact, false);
    assert.equal(rejectedPreview.exceedsTolerance, true);
    assert.equal(rejectedPreview.canApply, false);
    assert.ok(rejectedPreview.rejectionReason && rejectedPreview.rejectionReason.includes('exceeds'));
  }

  // Attempting to apply despite exceeding tolerance fails closed
  const rejectedApply = applyCubicToLineApproximation(state, artifact, 'front-bodice', 'seg-right', {
    toleranceCm: 0.25,
    confirmApproximation: true
  });
  assert.equal(rejectedApply.ok, false);
  if (!rejectedApply.ok) {
    assert.equal(rejectedApply.errorCode, 'TOLERANCE_EXCEEDED');
  }

  // Within tolerance (4.0 cm) but WITHOUT confirmation -> fails closed
  const unconfirmedApply = applyCubicToLineApproximation(state, artifact, 'front-bodice', 'seg-right', {
    toleranceCm: 4.0,
    confirmApproximation: false
  });
  assert.equal(unconfirmedApply.ok, false);
  if (!unconfirmedApply.ok) {
    assert.equal(unconfirmedApply.errorCode, 'CONFIRMATION_REQUIRED');
  }

  // Within tolerance AND explicitly confirmed -> succeeds, explicitly marked approximate (isExact: false)
  const confirmedApply = applyCubicToLineApproximation(state, artifact, 'front-bodice', 'seg-right', {
    toleranceCm: 4.0,
    confirmApproximation: true
  });
  assert.equal(confirmedApply.ok, true);
  if (confirmedApply.ok) {
    assert.equal(confirmedApply.isExact, false);
    assert.ok(Math.abs(confirmedApply.maxDeviationCm - 3.0) < 1e-9);
    const prop = confirmedApply.state.pieceProposals['front-bodice'];
    assert.equal(prop.sewSegments.find((s) => s.id === 'seg-right')?.kind, 'line');
    assert.equal(prop.approximationRecords.length, 1);
    assert.equal(prop.segmentLineage['seg-right'].derivation, 'cubic-to-line-approx');
  }
});

// ---------------------------------------------------------------------------
// 7. R2 — Vertex Removal & Merging (Exact Collinear, Exact Split Inverse, Approx, Topology Guard)
// ---------------------------------------------------------------------------

test('UX-2.3.3.4 (R2): vertex removal preserves exactness for collinear lines and exact cubic splits, approximates corners with tolerance gate, and rejects <= 3 segments', () => {
  const artifact = makeTestArtifact();
  const baseState = createProposalStateFromArtifact(artifact);

  // 7a. Split straight line seg-bottom at t=0.5, then remove the midpoint vertex -> exact collinear merge!
  const splitLine = splitSewSegmentAtT(baseState, artifact, 'front-bodice', 'seg-bottom', 0.5);
  assert.equal(splitLine.ok, true);
  if (splitLine.ok) {
    const midPreview = previewRemoveVertexAndMerge(
      splitLine.state,
      artifact,
      'front-bodice',
      splitLine.nextSelectedVertexRef!,
      0.01
    );
    assert.equal('ok' in midPreview, false);
    if (!('ok' in midPreview)) {
      assert.equal(midPreview.isExact, true);
      assert.equal(midPreview.maxDeviationCm, 0);
      assert.equal(midPreview.canApply, true);
      assert.equal(midPreview.requiresConfirmation, false);
    }

    const merged = applyRemoveVertexAndMerge(
      splitLine.state,
      artifact,
      'front-bodice',
      splitLine.nextSelectedVertexRef!,
      { toleranceCm: 0.01, confirmApproximation: false }
    );
    assert.equal(merged.ok, true);
    if (merged.ok) {
      assert.equal(merged.isExact, true);
      assert.equal(merged.state.pieceProposals['front-bodice'].sewSegments.length, 4);
    }
  }

  // 7b. Split cubic seg-right at t=0.5, then remove midpoint -> exact De Casteljau inverse merge!
  const splitCubic = splitSewSegmentAtT(baseState, artifact, 'front-bodice', 'seg-right', 0.5);
  assert.equal(splitCubic.ok, true);
  if (splitCubic.ok) {
    const cubicMergePreview = previewRemoveVertexAndMerge(
      splitCubic.state,
      artifact,
      'front-bodice',
      splitCubic.nextSelectedVertexRef!,
      0.01
    );
    assert.equal('ok' in cubicMergePreview, false);
    if (!('ok' in cubicMergePreview)) {
      assert.equal(cubicMergePreview.isExact, true);
      assert.equal(cubicMergePreview.maxDeviationCm, 0);
    }
  }

  // 7c. Removing a real corner on a 4-segment piece is approximate and rejected if deviation > tolerance
  const vertices4 = getEditableSewVerticesForPiece('front-bodice', artifact.pieces[0].sewSegments);
  const bottomLeft = vertices4.find((v) => v.outgoingSegmentId === 'seg-bottom')!;
  const cornerPreviewStrict = previewRemoveVertexAndMerge(
    baseState,
    artifact,
    'front-bodice',
    bottomLeft.entityRef,
    0.25
  );
  assert.equal('ok' in cornerPreviewStrict, false);
  if (!('ok' in cornerPreviewStrict)) {
    assert.equal(cornerPreviewStrict.isExact, false);
    assert.equal(cornerPreviewStrict.exceedsTolerance, true);
    assert.equal(cornerPreviewStrict.canApply, false);
  }

  // 7d. With high tolerance + explicit confirmation, 4 segments -> 3 segments succeeds;
  // then trying to remove another vertex from 3 segments is REJECTED by minimum topology guard!
  const cornerApply = applyRemoveVertexAndMerge(
    baseState,
    artifact,
    'front-bodice',
    bottomLeft.entityRef,
    { toleranceCm: 25, confirmApproximation: true }
  );
  assert.equal(cornerApply.ok, true);
  if (cornerApply.ok) {
    const segs3 = cornerApply.state.pieceProposals['front-bodice'].sewSegments;
    assert.equal(segs3.length, 3);
    const vertices3 = getEditableSewVerticesForPiece('front-bodice', segs3);
    const topologyReject = applyRemoveVertexAndMerge(
      cornerApply.state,
      artifact,
      'front-bodice',
      vertices3[0].entityRef,
      { toleranceCm: 100, confirmApproximation: true }
    );
    assert.equal(topologyReject.ok, false);
    if (!topologyReject.ok) {
      assert.equal(topologyReject.errorCode, 'MINIMUM_TOPOLOGY_VIOLATION');
    }
  }
});

// ---------------------------------------------------------------------------
// 8. Alignment & Snapping (Both Cartesian Y-Up and SVG Y-Down)
// ---------------------------------------------------------------------------

test('UX-2.3.3.4: alignment and snapping/axis constraints work deterministically in both Y-up and Y-down frames', () => {
  for (const frame of [makeCartesianFrame(), makeSvgYDownFrame()]) {
    const artifact = makeTestArtifact({ frame });
    const state = createProposalStateFromArtifact(artifact);
    const vertices = getEditableSewVerticesForPiece('front-bodice', artifact.pieces[0].sewSegments);
    const v = vertices.find((item) => item.outgoingSegmentId === 'seg-top')!;

    const alignedH = alignVertexToReference(
      state,
      artifact,
      'front-bodice',
      v.entityRef,
      'horizontal',
      { x: 5, y: 28.5 }
    );
    assert.equal(alignedH.ok, true);
    if (alignedH.ok) {
      const segTop = alignedH.state.pieceProposals['front-bodice'].sewSegments.find((s) => s.id === 'seg-top')!;
      assert.equal(segTop.p0.x, 20);
      assert.equal(segTop.p0.y, 28.5);
    }

    // Shift constrains to 45 deg increments; Alt bypasses vertex/grid snapping
    const constrained = snapAndConstrainPoint(
      { x: 10, y: 0.4 },
      { x: 0, y: 0 },
      frame,
      { ...DEFAULT_SNAP_CONSTRAINT_CONFIG, gridSnapEnabled: true },
      { shiftKey: true, altKey: false },
      []
    );
    assert.equal(constrained.constrainedAxisAngleDeg, 0);
    assert.ok(Math.abs(constrained.pointCm.y) < 1e-12);

    const vertexSnapped = snapAndConstrainPoint(
      { x: 5.1, y: 7.1 },
      { x: 0, y: 0 },
      frame,
      DEFAULT_SNAP_CONSTRAINT_CONFIG,
      { shiftKey: false, altKey: false },
      [{ x: 5, y: 7 }]
    );
    assert.equal(vertexSnapped.snappedKind, 'vertex');
    assert.deepEqual(vertexSnapped.pointCm, { x: 5, y: 7 });

    const bypassed = snapAndConstrainPoint(
      { x: 5.1, y: 7.1 },
      { x: 0, y: 0 },
      frame,
      DEFAULT_SNAP_CONSTRAINT_CONFIG,
      { shiftKey: false, altKey: true },
      [{ x: 5, y: 7 }]
    );
    assert.equal(bypassed.snappedKind, 'none');
    assert.deepEqual(bypassed.pointCm, { x: 5.1, y: 7.1 });
  }
});

// ---------------------------------------------------------------------------
// 9. D4 — Independent Bounded History (Max 50) & Discard
// ---------------------------------------------------------------------------

test('UX-2.3.3.4 (D4): bounded geometry proposal history caps at 50 entries and supports undo, redo, piece discard, and full discard', () => {
  const artifact = makeTestArtifact();
  let history = createEmptyProposalHistory(artifact);
  const vertices = getEditableSewVerticesForPiece('front-bodice', artifact.pieces[0].sewSegments);
  const v = vertices[0];

  for (let i = 1; i <= 60; i += 1) {
    const res = moveContourVertex(history.present, artifact, 'front-bodice', v.entityRef, {
      x: i * 0.1,
      y: 0
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      history = commitProposalOperation(history, res.state, `Step ${i}`, 'front-bodice');
    }
  }

  assert.equal(history.past.length, MAX_PROPOSAL_HISTORY_ENTRIES);
  assert.equal(canUndoProposal(history), true);
  assert.equal(canRedoProposal(history), false);

  const afterUndo = undoProposalHistory(history);
  assert.equal(afterUndo.past.length, MAX_PROPOSAL_HISTORY_ENTRIES - 1);
  assert.equal(afterUndo.future.length, 1);
  assert.equal(canRedoProposal(afterUndo), true);

  const afterRedo = redoProposalHistory(afterUndo);
  assert.equal(afterRedo.past.length, MAX_PROPOSAL_HISTORY_ENTRIES);
  assert.equal(afterRedo.future.length, 0);

  const afterPieceDiscard = discardPieceProposal(afterRedo, 'front-bodice');
  assert.equal(afterPieceDiscard.present.hasEdits, false);

  const afterFullDiscard = discardAllProposal(artifact);
  assert.equal(afterFullDiscard.past.length, 0);
  assert.equal(afterFullDiscard.future.length, 0);
  assert.equal(afterFullDiscard.present.hasEdits, false);
});

// ---------------------------------------------------------------------------
// 10. R3 — Advisory Integrity Checks (Pass, Warning, Invalid, Unassessed)
// ---------------------------------------------------------------------------

test('UX-2.3.3.4 (R3): advisory integrity checks distinguish pass, advisory-warning, invalid-proposal, and unassessed and never claim certification', () => {
  // Valid baseline piece
  const artifact = makeTestArtifact();
  const state = createProposalStateFromArtifact(artifact);
  const baseReport = evaluateProposalIntegrity(state, artifact, 'front-bodice');
  assert.equal(baseReport.authorityTier, 'UNVERIFIED_VISUAL_PROPOSAL');
  assert.equal(baseReport.isCertified, false);
  assert.equal(baseReport.isProductionReady, false);
  assert.equal(baseReport.externalCadInteroperabilityVerified, false);
  assert.equal(baseReport.overallStatus, 'pass');

  // Self-intersection created by crossing top-right vertex across bottom-left
  const vertices = getEditableSewVerticesForPiece('front-bodice', artifact.pieces[0].sewSegments);
  const topRight = vertices.find((v) => v.outgoingSegmentId === 'seg-top')!;
  const crossed = moveContourVertex(state, artifact, 'front-bodice', topRight.entityRef, {
    x: -10,
    y: -10
  });
  assert.equal(crossed.ok, true);
  if (crossed.ok) {
    const crossReport = evaluateProposalIntegrity(crossed.state, artifact, 'front-bodice');
    assert.equal(crossReport.overallStatus, 'invalid-proposal');
    const selfInt = crossReport.checks.find((c) => c.id === 'self-intersection');
    assert.equal(selfInt?.status, 'invalid-proposal');
  }

  // Paired seam mismatch produces advisory-warning
  const stretched = moveContourVertex(state, artifact, 'front-bodice', topRight.entityRef, {
    x: 20,
    y: 34
  });
  assert.equal(stretched.ok, true);
  if (stretched.ok) {
    const seamReport = evaluateProposalIntegrity(stretched.state, artifact, 'front-bodice');
    const seamCheck = seamReport.checks.find((c) => c.id === 'paired-seam-length-delta');
    assert.equal(seamCheck?.status, 'advisory-warning');
  }

  // Piece with no paired seam metadata reports 'unassessed' (never falsely 'pass')
  const unpairedPiece = makeTestPiece({ seams: [] });
  const unpairedArtifact = makeTestArtifact({ pieces: [unpairedPiece] });
  const unpairedReport = evaluateProposalIntegrity(
    createProposalStateFromArtifact(unpairedArtifact),
    unpairedArtifact,
    'front-bodice'
  );
  const unpairedSeamCheck = unpairedReport.checks.find((c) => c.id === 'paired-seam-length-delta');
  assert.equal(unpairedSeamCheck?.status, 'unassessed');
});

// ---------------------------------------------------------------------------
// 11. R4 — Artifact Identity (Missing vs Present Digest) & Stale Reconciliation
// ---------------------------------------------------------------------------

test('UX-2.3.3.4 (R4): distinguishes missing vs present artifactDigestSha256 and quarantines stale proposals on source artifact change', () => {
  const noDigestArtifact = makeTestArtifact();
  const idMissing = extractSourceArtifactIdentity(noDigestArtifact);
  assert.equal(idMissing.artifactDigestSha256, null);
  assert.equal(idMissing.hasVerifiedSourceDigest, false);
  assert.match(idMissing.geometryFingerprint, /^geo-fnv1a64:[0-9a-f]{16}$/);

  const withDigestArtifact = makeTestArtifact({ digest: 'abc123verifieddigest' });
  const idPresent = extractSourceArtifactIdentity(withDigestArtifact);
  assert.equal(idPresent.artifactDigestSha256, 'abc123verifieddigest');
  assert.equal(idPresent.hasVerifiedSourceDigest, true);

  // Create an active edit, then switch source artifact revision -> stale quarantine
  let history = createEmptyProposalHistory(noDigestArtifact);
  const vertices = getEditableSewVerticesForPiece('front-bodice', noDigestArtifact.pieces[0].sewSegments);
  const moved = moveContourVertex(history.present, noDigestArtifact, 'front-bodice', vertices[0].entityRef, {
    x: 1,
    y: 1
  });
  assert.equal(moved.ok, true);
  if (moved.ok) {
    history = commitProposalOperation(history, moved.state, 'Move vertex', 'front-bodice');
  }

  const updatedRevisionArtifact = makeTestArtifact({ specRev: 'spec-rev-002' });
  const reconciled = reconcileProposalHistoryWithArtifact(history, updatedRevisionArtifact);
  assert.equal(reconciled.present.reconciliationStatus, 'stale-artifact-changed');
  assert.ok(reconciled.present.reconciliationReasons.length >= 1);

  // Stale proposal refuses further edits until discarded and does not overwrite inspection artifact
  const blockedEdit = moveContourVertex(
    reconciled.present,
    updatedRevisionArtifact,
    'front-bodice',
    vertices[0].entityRef,
    { x: 2, y: 2 }
  );
  assert.equal(blockedEdit.ok, false);
  if (!blockedEdit.ok) {
    assert.equal(blockedEdit.errorCode, 'STALE_PROPOSAL');
  }
  const projectedWhileStale = buildProposedInspectionArtifact(
    updatedRevisionArtifact,
    reconciled.present
  );
  assert.strictEqual(projectedWhileStale, updatedRevisionArtifact);

  // Missing piece/segment reference triggers 'stale-missing-references'
  const removedPieceArtifact = makeTestArtifact({
    specRev: 'spec-rev-003',
    pieces: [makePairedBackPiece()]
  });
  const missingRefReconciled = reconcileProposalHistoryWithArtifact(history, removedPieceArtifact);
  assert.equal(missingRefReconciled.present.reconciliationStatus, 'stale-missing-references');
});

// ---------------------------------------------------------------------------
// 12. D5 — Deterministic JSON Payload Serialization & Fail-Closed on Non-Finite
// ---------------------------------------------------------------------------

test('UX-2.3.3.4 (D5): serializes deterministic full-precision read-only JSON payload and fails closed on non-finite coordinates', () => {
  const artifact = makeTestArtifact();
  let history = createEmptyProposalHistory(artifact);
  const vertices = getEditableSewVerticesForPiece('front-bodice', artifact.pieces[0].sewSegments);
  const moved = moveContourVertex(history.present, artifact, 'front-bodice', vertices[0].entityRef, {
    x: 1.1234567890123,
    y: 2.9876543210987
  });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  history = commitProposalOperation(history, moved.state, 'Move vertex precision', 'front-bodice');

  const ser1 = serializeProposalPayload(history.present, artifact, history);
  const ser2 = serializeProposalPayload(history.present, artifact, history);
  assert.equal(ser1.ok, true);
  assert.equal(ser2.ok, true);
  if (ser1.ok && ser2.ok) {
    assert.equal(ser1.json, ser2.json, 'JSON serialization must be byte-for-byte deterministic');
    assert.equal(ser1.payload.authorityTier, 'UNVERIFIED_VISUAL_PROPOSAL');
    assert.equal(ser1.payload.isCertified, false);
    assert.equal(ser1.payload.isProductionReady, false);
    assert.equal(ser1.payload.externalCadInteroperabilityVerified, false);
    assert.equal(ser1.payload.submissionStatus, 'READ_ONLY_LOCAL_PROPOSAL_NOT_SUBMITTED');
    assert.equal(ser1.payload.sourceArtifact.artifactDigestSha256, null);
    assert.equal(ser1.payload.sourceArtifact.hasVerifiedSourceDigest, false);
    assert.equal(ser1.payload.editedPieces[0].cutContourPotentiallyStale, true);
    assert.equal(ser1.payload.editedPieces[0].cutContourRegeneratedInClient, false);
    assert.ok(ser1.json.includes('1.1234567890123'), 'Must preserve full float64 precision');
  }

  // Non-finite state injection fails closed during serialization
  const poisonedState = {
    ...history.present,
    pieceProposals: {
      'front-bodice': {
        ...history.present.pieceProposals['front-bodice'],
        sewSegments: [
          {
            ...history.present.pieceProposals['front-bodice'].sewSegments[0],
            p0: { x: Number.NaN, y: 0 }
          },
          ...history.present.pieceProposals['front-bodice'].sewSegments.slice(1)
        ]
      }
    }
  };
  const badSer = serializeProposalPayload(poisonedState, artifact, history);
  assert.equal(badSer.ok, false);
});

// ---------------------------------------------------------------------------
// 13. R1 Edge Case — Cubic Overshoot Beyond Endpoints & Exact Line Split
// ---------------------------------------------------------------------------

test('UX-2.3.3.4 (R1): cubic-to-line measures tangential overshoot past finite chord endpoints and line subdivision is exact', () => {
  // Collinear cubic where P1/P2 overshoot past P0=(0,0) and P3=(10,0):
  // B_x(t) overshoots to x < 0 near t ≈ 0.21 and x > 10 near t ≈ 0.79 even though y(t) ≡ 0!
  const overshootSeg: RenderCurveSegment = {
    id: 'seg-overshoot',
    kind: 'cubic-bezier',
    role: 'stitching',
    p0: { x: 0, y: 0 },
    p1: { x: -10, y: 0 },
    p2: { x: 20, y: 0 },
    p3: { x: 10, y: 0 }
  };
  const dev = computeCubicToChordMaxDeviation(overshootSeg);
  assert.ok(
    dev.maxDeviationCm > 1.0,
    `Expected tangential overshoot deviation > 1.0 cm, got ${dev.maxDeviationCm}`
  );
  assert.equal(dev.method, 'analytical-extrema-with-segment-overshoot-refinement');

  // Exact straight-line split at arbitrary t=0.25
  const artifact = makeTestArtifact();
  const state = createProposalStateFromArtifact(artifact);
  const split = splitSewSegmentAtT(state, artifact, 'front-bodice', 'seg-bottom', 0.25);
  assert.equal(split.ok, true);
  if (split.ok) {
    assert.equal(split.isExact, true);
    assert.equal(split.maxDeviationCm, 0);
    const segs = split.state.pieceProposals['front-bodice'].sewSegments;
    const segA = segs.find((s) => s.id === split.createdSegmentIds![0])!;
    const segB = segs.find((s) => s.id === split.createdSegmentIds![1])!;
    assert.deepEqual(segA.p0, { x: 0, y: 0 });
    assert.deepEqual(segA.p3, { x: 5, y: 0 });
    assert.deepEqual(segB.p0, { x: 5, y: 0 });
    assert.deepEqual(segB.p3, { x: 20, y: 0 });
  }
});

// ---------------------------------------------------------------------------
// 14. R3 Edge Cases — Open Contour, Collapsed Edge, Inverted Winding, Cusp/Foldback
// ---------------------------------------------------------------------------

test('UX-2.3.3.4 (R3): advisory integrity flags open contour, collapsed segment, inverted winding, and stationary cusp/foldback', () => {
  const artifact = makeTestArtifact();
  const base = createProposalStateFromArtifact(artifact);
  const baseSegs = artifact.pieces[0].sewSegments;

  const makeDirectPieceState = (sewSegments: readonly RenderCurveSegment[]) => ({
    ...base,
    hasEdits: true,
    pieceProposals: {
      'front-bodice': {
        pieceId: 'front-bodice',
        sewSegments,
        segmentLineage: {},
        vertexContinuityModes: {},
        modifiedFromOriginal: true,
        cutContourPotentiallyStale: true,
        operationsAppliedCount: 1,
        approximationRecords: []
      }
    }
  });

  // 14a. Open contour gap (> 1e-4 cm)
  const openState = makeDirectPieceState([
    { ...baseSegs[0], p3: { x: 18, y: 0 } }, // gap to seg-right.p0=(20,0)
    ...baseSegs.slice(1)
  ]);
  const openReport = evaluateProposalIntegrity(openState, artifact);
  assert.equal(
    openReport.checks.find((c) => c.id === 'contour-closure')?.status,
    'invalid-proposal'
  );

  // 14b. Collapsed zero-length segment
  const collapsedState = makeDirectPieceState([
    { ...baseSegs[0], p0: { x: 0, y: 0 }, p3: { x: 0, y: 0 } },
    { ...baseSegs[1], p0: { x: 0, y: 0 } },
    baseSegs[2],
    baseSegs[3]
  ]);
  const collapsedReport = evaluateProposalIntegrity(collapsedState, artifact);
  assert.equal(
    collapsedReport.checks.find((c) => c.id === 'minimum-segment-length')?.status,
    'invalid-proposal'
  );

  // 14c. Inverted exterior winding (CW instead of CCW in cartesian-y-up)
  const reversedSegs: RenderCurveSegment[] = [
    { id: 'rev-1', kind: 'line', role: 'stitching', p0: { x: 0, y: 0 }, p3: { x: 0, y: 30 } },
    { id: 'rev-2', kind: 'line', role: 'stitching', p0: { x: 0, y: 30 }, p3: { x: 20, y: 30 } },
    { id: 'rev-3', kind: 'line', role: 'stitching', p0: { x: 20, y: 30 }, p3: { x: 20, y: 0 } },
    { id: 'rev-4', kind: 'line', role: 'stitching', p0: { x: 20, y: 0 }, p3: { x: 0, y: 0 } }
  ];
  const invertedReport = evaluateProposalIntegrity(makeDirectPieceState(reversedSegs), artifact);
  assert.equal(
    invertedReport.checks.find((c) => c.id === 'contour-orientation-signed-area')?.status,
    'invalid-proposal'
  );

  // 14d. Stationary cusp cubic where derivative crosses zero along segment
  const cuspState = makeDirectPieceState([
    baseSegs[0],
    {
      ...baseSegs[1],
      p0: { x: 20, y: 0 },
      p1: { x: 20, y: 40 },
      p2: { x: 20, y: -10 },
      p3: { x: 20, y: 30 }
    },
    baseSegs[2],
    baseSegs[3]
  ]);
  const cuspReport = evaluateProposalIntegrity(cuspState, artifact);
  assert.equal(
    cuspReport.checks.find((c) => c.id === 'stationary-cusp-foldback')?.status,
    'invalid-proposal'
  );
  assert.equal(cuspReport.isCertified, false);
  assert.equal(cuspReport.isProductionReady, false);
});

// ---------------------------------------------------------------------------
// 15. Clean Artifact Reconciliation & Alignment / Approximation Warning
// ---------------------------------------------------------------------------

test('UX-2.3.3.4: clean proposal adopts updated source artifact without quarantine, and vertex alignment & approximation warning work deterministically', () => {
  const artifactA = makeTestArtifact({ specRev: 'spec-rev-A' });
  const artifactB = makeTestArtifact({ specRev: 'spec-rev-B' });

  // Clean history adopts updated artifact directly
  const cleanHistory = createEmptyProposalHistory(artifactA);
  const adopted = reconcileProposalHistoryWithArtifact(cleanHistory, artifactB);
  assert.equal(adopted.present.reconciliationStatus, 'aligned');
  assert.equal(adopted.present.sourceIdentity.specificationRevisionId, 'spec-rev-B');

  // Vertical vertex alignment (matches reference X, preserves Y)
  const vertices = getEditableSewVerticesForPiece('front-bodice', artifactA.pieces[0].sewSegments);
  const v0 = vertices[0];
  const alignedX = alignVertexToReference(
    cleanHistory.present,
    artifactA,
    'front-bodice',
    v0.entityRef,
    'vertical',
    { x: 7.5, y: 12.5 }
  );
  assert.equal(alignedX.ok, true);
  if (alignedX.ok) {
    const updatedVerts = getEditableSewVerticesForPiece(
      'front-bodice',
      alignedX.state.pieceProposals['front-bodice'].sewSegments
    );
    assert.equal(updatedVerts[0].localPointCm.x, 7.5);
    assert.equal(updatedVerts[0].localPointCm.y, v0.localPointCm.y);
  }

  // Confirmed approximate edit triggers 'approximation-deviation' advisory-warning
  const approxApplied = applyCubicToLineApproximation(
    cleanHistory.present,
    artifactA,
    'front-bodice',
    'seg-right',
    { toleranceCm: 4.0, confirmApproximation: true }
  );
  assert.equal(approxApplied.ok, true);
  if (approxApplied.ok) {
    const rep = evaluateProposalIntegrity(approxApplied.state, artifactA);
    assert.equal(
      rep.checks.find((c) => c.id === 'approximation-deviation')?.status,
      'advisory-warning'
    );
  }
});

