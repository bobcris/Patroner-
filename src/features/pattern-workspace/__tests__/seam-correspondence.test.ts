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
import type { SeamCorrespondencePair } from '../contracts/wp-a-shared-contracts';
import {
  computeTrueSeamEndpointEdit,
  deriveArtifactSeamCorrespondences,
  evaluateSeamWalk,
  evaluateSegmentArcLengthCm,
  invertSegmentArcLength,
  resolveChainSegmentIds
} from '../seam-correspondence';

const FRAME_SVG: PatternArtifactCoordinateFrame = {
  geometryUnit: 'cm',
  yAxisDirection: 'svg-y-down',
  handedness: 'screen-y-down',
  exteriorWinding: 'CW'
};

const FRAME_CARTESIAN: PatternArtifactCoordinateFrame = {
  geometryUnit: 'cm',
  yAxisDirection: 'cartesian-y-up',
  handedness: 'right-handed-cartesian',
  exteriorWinding: 'CCW'
};

function makeTwoPieceArtifact(
  frame: PatternArtifactCoordinateFrame = FRAME_SVG,
  options?: { sideBHeight?: number; angledCrossEdge?: boolean; curvedSeam?: boolean }
): PatternArtifactBundle {
  const hA = 20;
  const hB = options?.sideBHeight ?? 20;
  const crossEndY = options?.angledCrossEdge ? 5 : 0;

  const sideASeg: RenderCurveSegment = options?.curvedSeam
    ? {
        id: 'pA-side',
        kind: 'cubic-bezier',
        seamId: 'seam-side-A',
        role: 'stitching',
        p0: { x: 10, y: 0 },
        p1: { x: 12, y: 6.5 },
        p2: { x: 12, y: 13.5 },
        p3: { x: 10, y: hA }
      }
    : {
        id: 'pA-side',
        kind: 'line',
        seamId: 'seam-side-A',
        role: 'stitching',
        p0: { x: 10, y: 0 },
        p3: { x: 10, y: hA }
      };

  const sideBSeg: RenderCurveSegment = options?.curvedSeam
    ? {
        id: 'pB-side',
        kind: 'cubic-bezier',
        seamId: 'seam-side-B',
        role: 'stitching',
        p0: { x: 0, y: hB },
        p1: { x: -2, y: hB * 0.675 },
        p2: { x: -2, y: hB * 0.325 },
        p3: { x: 0, y: 0 }
      }
    : {
        id: 'pB-side',
        kind: 'line',
        seamId: 'seam-side-B',
        role: 'stitching',
        p0: { x: 0, y: hB },
        p3: { x: 0, y: 0 }
      };

  const pieceA: PatternPieceRenderModel = {
    pieceId: 'piece-A',
    pieceCode: 'FRONT',
    name: 'Front Panel',
    material: 'self',
    cutCount: 2,
    onFold: false,
    seamAllowanceWidthCm: 1.5,
    boundingBoxCm: { minX: 0, minY: 0, maxX: 12, maxY: hA, widthCm: 12, heightCm: hA },
    sewSegments: [
      { id: 'pA-top', kind: 'line', role: 'stitching', p0: { x: 0, y: 0 }, p3: { x: 10, y: 0 } },
      sideASeg,
      { id: 'pA-bot', kind: 'line', role: 'stitching', p0: { x: 10, y: hA }, p3: { x: 0, y: hA } },
      { id: 'pA-cf', kind: 'line', role: 'fold', isFold: true, p0: { x: 0, y: hA }, p3: { x: 0, y: 0 } }
    ],
    cutSegments: [
      { id: 'pA-cut-0', kind: 'line', role: 'cutting', p0: { x: 0, y: -1.5 }, p3: { x: 11.5, y: -1.5 } }
    ],
    seams: [
      {
        id: 'seam-side-A',
        name: 'Side Seam',
        lengthCm: hA,
        segmentIds: ['pA-side'],
        pairedPieceId: 'piece-B',
        pairedSeamName: 'Side Seam'
      }
    ],
    seamAllowances: [],
    darts: [],
    notches: [
      {
        id: 'nA-1',
        segmentId: 'pA-side',
        position: { x: 10, y: 10 },
        normalVector: { x: 1, y: 0 },
        notchType: 'single',
        label: 'Waist',
        parameterT: 0.5
      }
    ],
    hasBlockingError: false
  };

  const pieceB: PatternPieceRenderModel = {
    pieceId: 'piece-B',
    pieceCode: 'BACK',
    name: 'Back Panel',
    material: 'self',
    cutCount: 2,
    onFold: false,
    seamAllowanceWidthCm: 1.5,
    boundingBoxCm: { minX: -2, minY: 0, maxX: 10, maxY: hB, widthCm: 12, heightCm: hB },
    sewSegments: [
      { id: 'pB-top', kind: 'line', role: 'stitching', p0: { x: 0, y: 0 }, p3: { x: 10, y: crossEndY } },
      { id: 'pB-cb', kind: 'line', role: 'stitching', p0: { x: 10, y: crossEndY }, p3: { x: 10, y: hB } },
      { id: 'pB-bot', kind: 'line', role: 'stitching', p0: { x: 10, y: hB }, p3: { x: 0, y: hB } },
      sideBSeg
    ],
    cutSegments: [
      { id: 'pB-cut-0', kind: 'line', role: 'cutting', p0: { x: -1.5, y: -1.5 }, p3: { x: 11.5, y: -1.5 } }
    ],
    seams: [
      {
        id: 'seam-side-B',
        name: 'Side Seam',
        lengthCm: hB,
        segmentIds: ['pB-side'],
        pairedPieceId: 'piece-A',
        pairedSeamName: 'Side Seam'
      }
    ],
    seamAllowances: [],
    darts: [],
    notches: [
      {
        id: 'nB-1',
        segmentId: 'pB-side',
        position: { x: 0, y: hB - 10.6 },
        normalVector: { x: -1, y: 0 },
        notchType: 'single',
        label: 'Waist',
        parameterT: 1 - (hB - 10.6) / hB
      }
    ],
    hasBlockingError: false
  };

  return {
    schemaVersion: 'patroner.pattern-render-artifact.v1',
    authorityTier: 'C0_LEGACY_TS_PROTOTYPE',
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    coordinateFrame: frame,
    provenance: {
      specificationRevisionId: 'spec-test-1',
      measurementRevisionId: 'meas-test-1',
      engineVersion: 'test-1.0',
      disclosureLabel: 'Test fixture'
    },
    pieces: [pieceA, pieceB],
    diagnostics: []
  };
}

test('WP-A1: derives artifact seam pairs and walks straight & cubic curves accurately in both coordinate frames', () => {
  for (const frame of [FRAME_SVG, FRAME_CARTESIAN]) {
    const art = makeTwoPieceArtifact(frame, { curvedSeam: true });
    const derived = deriveArtifactSeamCorrespondences(art);
    assert.equal(derived.length, 1);
    assert.equal(derived[0].origin, 'artifact-derived');
    assert.equal(derived[0].matchedNotchPairs.length, 1);

    const walk = evaluateSeamWalk({
      artifact: art,
      pair: derived[0],
      walkCursorFraction: 0.5
    });

    assert.equal(walk.status, 'ok');
    assert.equal(walk.authorityTier, 'UNVERIFIED_VISUAL_PROPOSAL');
    assert.equal(walk.isCertified, false);
    assert.equal(walk.isProductionReady, false);
    assert.equal(walk.externalCadInteroperabilityVerified, false);
    assert.equal(walk.dec11Certified, false);
    assert.equal(walk.coordinateFrame.yAxisDirection, frame.yAxisDirection);
    assert.ok(walk.totalLengthACm > 20.1, 'curved seam must exceed straight chord length');
    assert.ok(Math.abs(walk.rawDeltaCm) < 1e-4, 'mirrored symmetric cubics must match arc length');
    assert.ok(walk.pointOnACm && walk.pointOnBCm && walk.rigidTransformBToA);
  }
});

test('WP-A1: computes ease discrepancy, notch mismatch, and multi-segment chain with lineage resolution', () => {
  const art = makeTwoPieceArtifact(FRAME_SVG, { sideBHeight: 18.5 });
  const pair: SeamCorrespondencePair = {
    id: 'pair-ease-1',
    label: 'Side Seam Ease Test',
    sideA: { pieceId: 'piece-A', segmentIds: ['pA-side'], direction: 1 },
    sideB: { pieceId: 'piece-B', segmentIds: ['pB-side'], direction: -1 },
    targetEaseCm: 1.0,
    origin: 'user-proposal',
    matchedNotchPairs: [{ id: 'np-1', notchIdA: 'nA-1', notchIdB: 'nB-1', label: 'Waist' }]
  };

  const walk = evaluateSeamWalk({ artifact: art, pair, walkCursorArcCm: 10 });
  assert.equal(walk.status, 'ok');
  assert.ok(Math.abs(walk.totalLengthACm - 20) < 1e-9);
  assert.ok(Math.abs(walk.totalLengthBCm - 18.5) < 1e-9);
  assert.ok(Math.abs(walk.rawDeltaCm - 1.5) < 1e-9);
  assert.ok(Math.abs(walk.netDeltaAfterEaseCm - 0.5) < 1e-9);
  assert.equal(walk.notchDiscrepancies.length, 1);
  assert.equal(walk.notchDiscrepancies[0].status, 'advisory-mismatch');
  assert.equal(walk.intervals.length, 2, 'notch stop should split seam into 2 intervals');

  // Lineage resolution after split
  const splitSegs: RenderCurveSegment[] = [
    { id: 'pA-side::L', kind: 'line', role: 'stitching', p0: { x: 10, y: 0 }, p3: { x: 10, y: 10 } },
    { id: 'pA-side::R', kind: 'line', role: 'stitching', p0: { x: 10, y: 10 }, p3: { x: 10, y: 20 } }
  ];
  const res = resolveChainSegmentIds(['pA-side'], splitSegs, {
    'pA-side::L': { segmentId: 'pA-side::L', baseSegmentIds: ['pA-side'], derivation: 'split-exact', maxApproximationDeviationCm: 0 },
    'pA-side::R': { segmentId: 'pA-side::R', baseSegmentIds: ['pA-side'], derivation: 'split-exact', maxApproximationDeviationCm: 0 }
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.resolvedIds, ['pA-side::L', 'pA-side::R']);
});

test('WP-A1: monotone cubic arc-length inversion achieves <= 1e-6 cm residual', () => {
  const seg: RenderCurveSegment = {
    id: 'cubic-inv',
    kind: 'cubic-bezier',
    role: 'stitching',
    p0: { x: 0, y: 0 },
    p1: { x: 4, y: 12 },
    p2: { x: 14, y: 12 },
    p3: { x: 18, y: 0 }
  };
  const total = evaluateSegmentArcLengthCm(seg, FRAME_CARTESIAN, 'p1');
  assert.equal(total.ok, true);
  for (const frac of [0.15, 0.5, 0.85]) {
    const target = total.lengthCm * frac;
    const inv = invertSegmentArcLength(seg, target, total.lengthCm, FRAME_CARTESIAN, 'p1');
    assert.equal(inv.ok, true);
    assert.ok(inv.residualCm <= 1e-6);
  }
});

test('WP-A1: advisory endpoint trueing smooths angled join toward 180°, modifies sew-only, and preserves cutSegments', () => {
  const art = makeTwoPieceArtifact(FRAME_SVG, { angledCrossEdge: true });
  const beforeCutJson = JSON.stringify(art.pieces[1].cutSegments);
  const derived = deriveArtifactSeamCorrespondences(art)[0];

  const walkBefore = evaluateSeamWalk({ artifact: art, pair: derived, walkCursorFraction: 0 });
  assert.equal(walkBefore.status, 'ok');
  assert.ok(walkBefore.endpointAnalysis.start);
  assert.equal(walkBefore.endpointAnalysis.start!.classification, 'sharp-corner');

  const trueRes = computeTrueSeamEndpointEdit({
    artifact: art,
    pair: derived,
    targetSide: 'B',
    endpoint: 'start',
    targetJoinAngleDeg: 180,
    maxHandleAdjustmentCm: 5.0
  });
  assert.equal(trueRes.ok, true);
  assert.equal(trueRes.authorityTier, 'UNVERIFIED_VISUAL_PROPOSAL');
  assert.equal(trueRes.isCertified, false);
  assert.equal(trueRes.dec11Certified, false);
  assert.ok(trueRes.updatedSewSegments);
  assert.ok((trueRes.achievedAngleDeviationDeg ?? 99) < 0.5);
  assert.equal(JSON.stringify(art.pieces[1].cutSegments), beforeCutJson, 'source cutSegments must remain untouched');
});

test('WP-A1: fails closed on missing segment or degenerate zero-length curve', () => {
  const art = makeTwoPieceArtifact(FRAME_SVG);
  const missingPair: SeamCorrespondencePair = {
    id: 'pair-missing',
    label: 'Broken Pair',
    sideA: { pieceId: 'piece-A', segmentIds: ['non-existent-seg'], direction: 1 },
    sideB: { pieceId: 'piece-B', segmentIds: ['pB-side'], direction: -1 },
    targetEaseCm: 0,
    origin: 'user-proposal',
    matchedNotchPairs: []
  };
  const walkMissing = evaluateSeamWalk({ artifact: art, pair: missingPair });
  assert.equal(walkMissing.status, 'invalidated-missing-segment');
  assert.equal(walkMissing.isCertified, false);

  const degSeg: RenderCurveSegment = {
    id: 'zero-seg',
    kind: 'line',
    role: 'stitching',
    p0: { x: 5, y: 5 },
    p3: { x: 5, y: 5 }
  };
  const invDeg = invertSegmentArcLength(degSeg, 0, 0, FRAME_SVG, 'piece-A');
  assert.equal(invDeg.ok, false);
});
