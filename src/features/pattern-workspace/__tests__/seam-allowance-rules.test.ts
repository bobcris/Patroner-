/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { PatternPieceRenderModel, RenderCurveSegment } from '../contracts/pattern-render-artifact';
import type { PieceProductionAnnotationProposal } from '../contracts/wp-a-shared-contracts';
import {
  buildDeclarativeSegmentRule,
  createDefaultPieceAnnotationProposal,
  evaluatePieceAllowanceRules,
  formatDeclarativeRuleBadge
} from '../seam-allowance-rules';

function makePiece(): PatternPieceRenderModel {
  return {
    pieceId: 'p-skirt',
    pieceCode: 'SKF',
    name: 'Skirt Front',
    material: 'self',
    cutCount: 1,
    onFold: true,
    seamAllowanceWidthCm: 1.5,
    boundingBoxCm: { minX: 0, minY: 0, maxX: 25, maxY: 60, widthCm: 25, heightCm: 60 },
    sewSegments: [
      { id: 'waist', kind: 'line', role: 'stitching', p0: { x: 0, y: 0 }, p3: { x: 20, y: 0 } },
      { id: 'side', kind: 'line', role: 'stitching', p0: { x: 20, y: 0 }, p3: { x: 25, y: 60 } },
      { id: 'hem', kind: 'line', role: 'stitching', p0: { x: 25, y: 60 }, p3: { x: 0, y: 60 } },
      { id: 'cf-fold', kind: 'line', role: 'fold', isFold: true, p0: { x: 0, y: 60 }, p3: { x: 0, y: 0 } }
    ],
    cutSegments: [
      { id: 'cut-waist', kind: 'line', role: 'cutting', p0: { x: 0, y: -1.5 }, p3: { x: 21.5, y: -1.5 } }
    ],
    seams: [],
    seamAllowances: [
      { segmentId: 'waist', distanceCm: 1.5, directionSign: 1, joinStyle: 'miter', miterLimit: 4 },
      { segmentId: 'cf-fold', distanceCm: 0, directionSign: 1, joinStyle: 'fold', miterLimit: 1 }
    ],
    darts: [],
    notches: [],
    hasBlockingError: false
  };
}

test('WP-A4: declarative rules strictly enforce cutGeometryRegeneratedInClient=false and preserve source cutSegments', () => {
  const piece = makePiece();
  const originalCut = JSON.stringify(piece.cutSegments);

  const defaultProposal = createDefaultPieceAnnotationProposal(piece);
  const evalDefault = evaluatePieceAllowanceRules({
    piece,
    activeSewSegments: piece.sewSegments,
    proposal: defaultProposal
  });

  assert.equal(evalDefault.authorityTier, 'UNVERIFIED_VISUAL_PROPOSAL');
  assert.equal(evalDefault.isCertified, false);
  assert.equal(evalDefault.isProductionReady, false);
  assert.equal(evalDefault.externalCadInteroperabilityVerified, false);
  assert.equal(evalDefault.cutGeometryRegeneratedInClient, false);
  assert.equal(evalDefault.sourceCutSegmentsPreservedUnchanged, true);
  assert.equal(evalDefault.conflicts.length, 0);
  assert.equal(evalDefault.resolvedRulesBySegmentId['cf-fold'].isFoldEdge, true);
  assert.equal(evalDefault.resolvedRulesBySegmentId['cf-fold'].distanceCm, 0);
  assert.equal(formatDeclarativeRuleBadge(evalDefault.resolvedRulesBySegmentId['cf-fold']), 'FOLD 0');
  assert.equal(JSON.stringify(piece.cutSegments), originalCut);
});

test('WP-A4: detects all 7 declarative rule conflicts cleanly', () => {
  const piece = makePiece();

  const badFoldRule = buildDeclarativeSegmentRule({
    segmentId: 'cf-fold',
    edgeRole: 'fold-edge',
    distanceCm: 1.5,
    isFoldEdge: true,
    miterLimit: 4
  });
  const badTaperAndMiter = buildDeclarativeSegmentRule({
    segmentId: 'side',
    edgeRole: 'seam-edge',
    distanceCm: 15,
    endDistanceCm: -1,
    miterLimit: 0.5
  });
  const badHem = buildDeclarativeSegmentRule({
    segmentId: 'hem',
    edgeRole: 'hem-turn-up',
    distanceCm: 3.0,
    hemTurnUpCount: 2,
    hemFirstFoldCm: 3.5
  });
  const staleSegRule = buildDeclarativeSegmentRule({
    segmentId: 'deleted-seg-id',
    edgeRole: 'seam-edge',
    distanceCm: 1.5
  });

  const proposal: PieceProductionAnnotationProposal = {
    pieceId: piece.pieceId,
    defaultAllowanceCm: 1.5,
    segmentRuleOverrides: {
      'cf-fold': badFoldRule,
      side: badTaperAndMiter,
      hem: badHem,
      'deleted-seg-id': staleSegRule
    },
    vertexCornerOverrides: {
      'missing-vtx-ref': {
        vertexRef: 'missing-vtx-ref',
        pieceId: piece.pieceId,
        joinStyle: 'miter',
        miterLimit: 20
      }
    }
  };

  const res = evaluatePieceAllowanceRules({
    piece,
    activeSewSegments: piece.sewSegments,
    proposal
  });

  const codes = new Set(res.conflicts.map((c) => c.code));
  assert.ok(codes.has('FOLD_NONZERO_ALLOWANCE'));
  assert.ok(codes.has('NEGATIVE_OR_EXCESSIVE_ALLOWANCE'));
  assert.ok(codes.has('TAPER_OUT_OF_RANGE'));
  assert.ok(codes.has('INVALID_MITER_LIMIT'));
  assert.ok(codes.has('HEM_FOLD_INCONSISTENCY'));
  assert.ok(codes.has('STALE_SEGMENT_REFERENCE'));
  assert.ok(codes.has('STALE_VERTEX_REFERENCE'));
  assert.equal(res.hasStaleReferences, true);
  assert.equal(res.cutGeometryRegeneratedInClient, false);
});

test('WP-A4: inherits declarative rules across contour segment split via lineage', () => {
  const piece = makePiece();
  const taperedSideRule = buildDeclarativeSegmentRule({
    segmentId: 'side',
    edgeRole: 'seam-edge',
    distanceCm: 1.5,
    endDistanceCm: 2.5,
    joinStyle: 'bevel'
  });
  const proposal: PieceProductionAnnotationProposal = {
    pieceId: piece.pieceId,
    defaultAllowanceCm: 1.5,
    segmentRuleOverrides: { side: taperedSideRule },
    vertexCornerOverrides: {}
  };

  const splitSegs: RenderCurveSegment[] = [
    piece.sewSegments[0],
    { id: 'side::top', kind: 'line', role: 'stitching', p0: { x: 20, y: 0 }, p3: { x: 22.5, y: 30 } },
    { id: 'side::bot', kind: 'line', role: 'stitching', p0: { x: 22.5, y: 30 }, p3: { x: 25, y: 60 } },
    piece.sewSegments[2],
    piece.sewSegments[3]
  ];
  const lineage = {
    'side::top': { segmentId: 'side::top', baseSegmentIds: ['side'], derivation: 'split-exact' as const, maxApproximationDeviationCm: 0 },
    'side::bot': { segmentId: 'side::bot', baseSegmentIds: ['side'], derivation: 'split-exact' as const, maxApproximationDeviationCm: 0 }
  };

  const res = evaluatePieceAllowanceRules({
    piece,
    activeSewSegments: splitSegs,
    proposal,
    lineageBySegmentId: lineage
  });

  assert.equal(res.hasStaleReferences, false);
  assert.equal(res.resolvedRulesBySegmentId['side::top'].distanceCm, 1.5);
  assert.equal(res.resolvedRulesBySegmentId['side::top'].endDistanceCm, 2.5);
  assert.equal(formatDeclarativeRuleBadge(res.resolvedRulesBySegmentId['side::top']), '1.5→2.5');
  assert.equal(res.resolvedRulesBySegmentId['side::bot'].joinStyle, 'bevel');
  assert.equal(res.cutGeometryRegeneratedInClient, false);
});
