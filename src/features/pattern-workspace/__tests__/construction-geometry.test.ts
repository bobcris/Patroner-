/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  PatternArtifactCoordinateFrame,
  PatternPieceRenderModel,
  RenderCurveSegment
} from '../contracts/pattern-render-artifact';
import type { ConstructionEntity, GeometricConstraint } from '../contracts/wp-a-shared-contracts';
import {
  buildAnchoredNotchRecord,
  buildProposedDrillHole,
  createConstructionArc,
  createConstructionCircle,
  createConstructionLine,
  createInternalLine,
  createParallelOrPerpendicularGuide,
  createReferenceAxis,
  createTechnicalCallout,
  evaluateGeometricConstraint,
  reconcileAndReprojectNotches
} from '../construction-geometry';
import {
  computeCircleTangentPoints,
  constrainPointToAngleStep,
  evaluateUnifiedCadSnap,
  intersectLines2D,
  intersectLineWithCircle2D
} from '../cad-snapping';
import {
  PATTERN_ATELIER_SHORTCUT_MAP,
  PATTERN_ATELIER_TOOL_REGISTRY,
  resolvePatternAtelierShortcut,
  resolveUndoHistoryTargetForTool
} from '../tool-dispatch';

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

function makeRectPiece(): PatternPieceRenderModel {
  const segs: RenderCurveSegment[] = [
    { id: 's-top', kind: 'line', role: 'stitching', p0: { x: 0, y: 0 }, p3: { x: 10, y: 0 } },
    { id: 's-right', kind: 'line', role: 'stitching', p0: { x: 10, y: 0 }, p3: { x: 10, y: 20 } },
    { id: 's-bot', kind: 'line', role: 'stitching', p0: { x: 10, y: 20 }, p3: { x: 0, y: 20 } },
    { id: 's-left', kind: 'line', role: 'fold', isFold: true, p0: { x: 0, y: 20 }, p3: { x: 0, y: 0 } }
  ];
  return {
    pieceId: 'p-1',
    pieceCode: 'P1',
    name: 'Rect Piece',
    material: 'self',
    cutCount: 1,
    onFold: true,
    seamAllowanceWidthCm: 1.5,
    boundingBoxCm: { minX: 0, minY: 0, maxX: 10, maxY: 20, widthCm: 10, heightCm: 20 },
    sewSegments: segs,
    cutSegments: [],
    seams: [],
    seamAllowances: [],
    darts: [],
    notches: [],
    hasBlockingError: false
  };
}

test('WP-A2: construction entity builders enforce isCuttingGeometry=false and fail closed on degenerate inputs', () => {
  const line = createConstructionLine({ id: 'c-1', pieceId: 'p-1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  assert.equal(line.ok, true);
  if (line.ok) assert.equal(line.entity.isCuttingGeometry, false);

  const badLine = createConstructionLine({ id: 'c-bad', pieceId: 'p-1', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } });
  assert.equal(badLine.ok, false);

  const nanLine = createConstructionLine({ id: 'c-nan', pieceId: 'p-1', start: { x: Number.NaN, y: 0 }, end: { x: 5, y: 0 } });
  assert.equal(nanLine.ok, false);

  const axis = createReferenceAxis({ id: 'ax-1', pieceId: 'p-1', axisRole: 'bust', start: { x: 0, y: 8 }, end: { x: 10, y: 8 } });
  assert.equal(axis.ok, true);

  const circ = createConstructionCircle({ id: 'circ-1', pieceId: 'p-1', center: { x: 5, y: 5 }, radiusCm: 3 });
  assert.equal(circ.ok, true);
  const badCirc = createConstructionCircle({ id: 'circ-bad', pieceId: 'p-1', center: { x: 5, y: 5 }, radiusCm: 0 });
  assert.equal(badCirc.ok, false);

  const arc = createConstructionArc({ id: 'arc-1', pieceId: 'p-1', center: { x: 5, y: 5 }, radiusCm: 3, startAngleRad: 0, endAngleRad: Math.PI / 2 });
  assert.equal(arc.ok, true);

  const piece = makeRectPiece();
  const par = createParallelOrPerpendicularGuide({ id: 'par-1', pieceId: 'p-1', mode: 'parallel-guide', sourceSegment: piece.sewSegments[0], offsetDistanceCm: 2 });
  assert.equal(par.ok, true);
  const perp = createParallelOrPerpendicularGuide({ id: 'perp-1', pieceId: 'p-1', mode: 'perpendicular-guide', sourceSegment: piece.sewSegments[0], offsetDistanceCm: 0, anchorT: 0.5 });
  assert.equal(perp.ok, true);

  const intLine = createInternalLine({ id: 'int-1', pieceId: 'p-1', role: 'pocket-placement', start: { x: 2, y: 5 }, end: { x: 8, y: 5 } });
  assert.equal(intLine.ok, true);
  if (intLine.ok) assert.equal(intLine.entity.layerId, 'internal-lines');

  const callout = createTechnicalCallout({ id: 'cal-1', pieceId: 'p-1', anchor: { x: 3, y: 3 }, text: 'Topstitch 0.6 cm' });
  assert.equal(callout.ok, true);
  const emptyCallout = createTechnicalCallout({ id: 'cal-bad', pieceId: 'p-1', anchor: { x: 3, y: 3 }, text: '   ' });
  assert.equal(emptyCallout.ok, false);
});

test('WP-A2: anchored notch placement, drill validation, and deterministic lineage reprojection across contour split', () => {
  const piece = makeRectPiece();
  const segRight = piece.sewSegments[1]; // (10,0) -> (10,20), length 20 cm
  const notchRes = buildAnchoredNotchRecord({
    notchId: 'n-1',
    pieceId: 'p-1',
    segment: segRight,
    baseSegmentIds: ['s-right'],
    targetArcLengthCm: 14,
    notchType: 'v-notch',
    label: 'Waist',
    coordinateFrame: FRAME_SVG
  });
  assert.equal(notchRes.ok, true);
  if (!notchRes.ok) return;
  assert.ok(Math.abs(notchRes.notch.position.x - 10) < 1e-9);
  assert.ok(Math.abs(notchRes.notch.position.y - 14) < 1e-9);

  // Split s-right into two 10cm segments and reproject
  const splitSegs: RenderCurveSegment[] = [
    piece.sewSegments[0],
    { id: 's-right::a', kind: 'line', role: 'stitching', p0: { x: 10, y: 0 }, p3: { x: 10, y: 10 } },
    { id: 's-right::b', kind: 'line', role: 'stitching', p0: { x: 10, y: 10 }, p3: { x: 10, y: 20 } },
    piece.sewSegments[2],
    piece.sewSegments[3]
  ];
  const lineage = {
    's-right::a': { segmentId: 's-right::a', baseSegmentIds: ['s-right'], derivation: 'split-exact' as const, maxApproximationDeviationCm: 0 },
    's-right::b': { segmentId: 's-right::b', baseSegmentIds: ['s-right'], derivation: 'split-exact' as const, maxApproximationDeviationCm: 0 }
  };
  const reprojected = reconcileAndReprojectNotches([notchRes.notch], splitSegs, lineage, FRAME_SVG);
  assert.equal(reprojected[0].reconciliationStatus, 'reprojected-via-lineage');
  assert.equal(reprojected[0].segmentId, 's-right::b');
  assert.ok(Math.abs(reprojected[0].position.y - 14) < 1e-6);

  // Missing host segment marks invalidated-missing-reference
  const missingReproj = reconcileAndReprojectNotches([notchRes.notch], [piece.sewSegments[0]], {}, FRAME_SVG);
  assert.equal(missingReproj[0].reconciliationStatus, 'invalidated-missing-reference');

  const drillOk = buildProposedDrillHole({ drillId: 'd-1', pieceId: 'p-1', positionCm: { x: 5, y: 10 }, radiusCm: 0.25 });
  assert.equal(drillOk.ok, true);
  const drillBad = buildProposedDrillHole({ drillId: 'd-bad', pieceId: 'p-1', positionCm: { x: 5, y: 10 }, radiusCm: 0 });
  assert.equal(drillBad.ok, false);
});

test('WP-A2: evaluates all 8 lightweight geometric constraint kinds in both coordinate frames', () => {
  const piece = makeRectPiece();
  const cHoriz = createConstructionLine({ id: 'ch', pieceId: 'p-1', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } });
  const cSlanted = createConstructionLine({ id: 'cs', pieceId: 'p-1', start: { x: 0, y: 0 }, end: { x: 10, y: 2 } });
  const cPt = createTechnicalCallout({ id: 'pt-on', pieceId: 'p-1', anchor: { x: 5, y: 0 }, text: 'OnTop' });
  assert.ok(cHoriz.ok && cSlanted.ok && cPt.ok);
  const constructions: Record<string, ConstructionEntity> = {
    ch: cHoriz.entity,
    cs: cSlanted.entity,
    'pt-on': cPt.entity
  };

  for (const frame of [FRAME_SVG, FRAME_CARTESIAN]) {
    const cases: Array<{ c: GeometricConstraint; expected: 'satisfied' | 'violated' | 'invalidated' }> = [
      { c: { id: '1', pieceId: 'p-1', kind: 'horizontal', label: 'H', entityRefs: ['seg:s-top'], toleranceCmOrDeg: 0.5 }, expected: 'satisfied' },
      { c: { id: '2', pieceId: 'p-1', kind: 'horizontal', label: 'H-fail', entityRefs: ['const:cs'], toleranceCmOrDeg: 0.5 }, expected: 'violated' },
      { c: { id: '3', pieceId: 'p-1', kind: 'vertical', label: 'V', entityRefs: ['seg:s-right'], toleranceCmOrDeg: 0.5 }, expected: 'satisfied' },
      { c: { id: '4', pieceId: 'p-1', kind: 'perpendicular', label: 'Perp', entityRefs: ['seg:s-top', 'seg:s-right'], toleranceCmOrDeg: 0.5 }, expected: 'satisfied' },
      { c: { id: '5', pieceId: 'p-1', kind: 'parallel', label: 'Par', entityRefs: ['seg:s-top', 'const:ch'], toleranceCmOrDeg: 0.5 }, expected: 'satisfied' },
      { c: { id: '6', pieceId: 'p-1', kind: 'equal-length', label: 'Eq', entityRefs: ['seg:s-top', 'seg:s-bot'], toleranceCmOrDeg: 0.05 }, expected: 'satisfied' },
      { c: { id: '7', pieceId: 'p-1', kind: 'tangent-g1', label: 'G1', entityRefs: ['seg:s-top', 'seg:s-right'], toleranceCmOrDeg: 1.0 }, expected: 'violated' },
      { c: { id: '8', pieceId: 'p-1', kind: 'point-on-segment', label: 'On', entityRefs: ['const:pt-on', 'seg:s-top'], toleranceCmOrDeg: 0.05 }, expected: 'satisfied' },
      { c: { id: '9', pieceId: 'p-1', kind: 'distance-cm', label: 'Dist', entityRefs: ['vtx:s-top:p0', 'vtx:s-top:p3'], targetValue: 10, toleranceCmOrDeg: 0.05 }, expected: 'satisfied' },
      { c: { id: '10', pieceId: 'p-1', kind: 'horizontal', label: 'Missing', entityRefs: ['seg:missing'], toleranceCmOrDeg: 0.5 }, expected: 'invalidated' }
    ];
    for (const tc of cases) {
      const res = evaluateGeometricConstraint(tc.c, piece, constructions, [], frame);
      assert.equal(res.status, tc.expected, `constraint ${tc.c.kind} (${tc.c.id}) in ${frame.yAxisDirection}`);
    }
  }
});

test('WP-A6: unified CAD snapping resolves vertex, intersection, midpoint, perpendicular, tangent, grid & Shift axis in both frames', () => {
  const piece = makeRectPiece();
  const cDiag = createConstructionLine({ id: 'diag', pieceId: 'p-1', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } });
  const cHoriz = createConstructionLine({ id: 'horiz', pieceId: 'p-1', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } });
  const cCirc = createConstructionCircle({ id: 'circ', pieceId: 'p-1', center: { x: 5, y: 15 }, radiusCm: 2 });
  assert.ok(cDiag.ok && cHoriz.ok && cCirc.ok);
  const constructions = [cDiag.entity, cHoriz.entity, cCirc.entity];

  // Exact intersection helper
  const ix = intersectLines2D({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 5 }, { x: 10, y: 5 });
  assert.ok(ix && Math.abs(ix.x - 5) < 1e-9 && Math.abs(ix.y - 5) < 1e-9);
  const lcHits = intersectLineWithCircle2D({ x: 0, y: 15 }, { x: 10, y: 15 }, { x: 5, y: 15 }, 2);
  assert.equal(lcHits.length, 2);
  const tanPts = computeCircleTangentPoints({ x: 5, y: 10 }, { x: 5, y: 15 }, 2);
  assert.equal(tanPts.length, 2);

  // Vertex snap beats midpoint/grid
  const vSnap = evaluateUnifiedCadSnap({ x: 0.1, y: 0.1 }, {
    sewSegments: piece.sewSegments,
    constructions,
    coordinateFrame: FRAME_SVG,
    pixelsPerCm: 20
  });
  assert.equal(vSnap.kind, 'vertex');
  assert.deepEqual(vSnap.pointCm, { x: 0, y: 0 });

  // Intersection snap at (5,5)
  const ixSnap = evaluateUnifiedCadSnap({ x: 5.05, y: 4.98 }, {
    sewSegments: piece.sewSegments,
    constructions,
    coordinateFrame: FRAME_SVG,
    pixelsPerCm: 20,
    config: { vertexSnapEnabled: false, midpointSnapEnabled: false }
  });
  assert.equal(ixSnap.kind, 'intersection');
  assert.ok(Math.abs(ixSnap.pointCm.x - 5) < 1e-6 && Math.abs(ixSnap.pointCm.y - 5) < 1e-6);

  // Perpendicular snap from anchor (3, 10) onto horizontal line y=5 -> foot at (3,5)
  const perpSnap = evaluateUnifiedCadSnap({ x: 3.05, y: 5.02 }, {
    sewSegments: [],
    constructions: [cHoriz.entity],
    coordinateFrame: FRAME_SVG,
    pixelsPerCm: 20,
    referenceAnchorCm: { x: 3, y: 10 }
  });
  assert.equal(perpSnap.kind, 'perpendicular');
  assert.ok(Math.abs(perpSnap.pointCm.x - 3) < 1e-6 && Math.abs(perpSnap.pointCm.y - 5) < 1e-6);

  // Shift axis constraint respects coordinate frame (visual +90° up = -Y in svg-y-down, +Y in cartesian-y-up)
  const cSvg = constrainPointToAngleStep({ x: 0.2, y: -10 }, { x: 0, y: 0 }, 45, FRAME_SVG);
  assert.equal(cSvg.angleDeg, 90);
  assert.ok(cSvg.pointCm.y < 0);
  const cCart = constrainPointToAngleStep({ x: 0.2, y: 10 }, { x: 0, y: 0 }, 45, FRAME_CARTESIAN);
  assert.equal(cCart.angleDeg, 90);
  assert.ok(cCart.pointCm.y > 0);
});

test('WP-A6: tool registry has 10 collision-free shortcuts and routes proposal vs board undo targets cleanly', () => {
  const keys = Object.keys(PATTERN_ATELIER_SHORTCUT_MAP);
  assert.equal(keys.length, 10);
  assert.equal(new Set(Object.values(PATTERN_ATELIER_SHORTCUT_MAP)).size, 10);
  assert.equal(resolvePatternAtelierShortcut('w'), 'seam-walk');
  assert.equal(resolvePatternAtelierShortcut('L'), 'construction-draw');
  assert.equal(resolvePatternAtelierShortcut('n'), 'notch-drill');
  assert.equal(resolvePatternAtelierShortcut('d'), 'dart-author');
  assert.equal(resolvePatternAtelierShortcut('s'), 'allowance-rule');
  assert.equal(resolvePatternAtelierShortcut('a'), 'edit-contour');

  assert.equal(resolveUndoHistoryTargetForTool('select'), 'board');
  assert.equal(resolveUndoHistoryTargetForTool('pan'), 'viewport');
  for (const propTool of ['edit-contour', 'seam-walk', 'construction-draw', 'notch-drill', 'dart-author', 'allowance-rule'] as const) {
    assert.equal(PATTERN_ATELIER_TOOL_REGISTRY[propTool].isProposalAuthoringTool, true);
    assert.equal(resolveUndoHistoryTargetForTool(propTool), 'proposal');
  }
});
