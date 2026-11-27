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
import {
  C0_BODICE_DART_PRESETS,
  closeOrOpenProposalDart,
  createProposalDartOnContour,
  DART_ANGULAR_CONSERVATION_TOLERANCE_RAD,
  DART_LEG_PARITY_TOLERANCE_CM,
  editProposalDartParameters,
  evaluateDartConservationReport,
  rotateTransferProposalDart
} from '../dart-authoring';

const FRAME_SVG: PatternArtifactCoordinateFrame = {
  geometryUnit: 'cm',
  yAxisDirection: 'svg-y-down',
  handedness: 'screen-y-down',
  exteriorWinding: 'CW'
};

function makeBodiceBlockPiece(): PatternPieceRenderModel {
  const segs: RenderCurveSegment[] = [
    { id: 'shoulder', kind: 'line', role: 'stitching', p0: { x: 0, y: 0 }, p3: { x: 20, y: 0 } },
    { id: 'side', kind: 'line', role: 'stitching', p0: { x: 20, y: 0 }, p3: { x: 20, y: 30 } },
    { id: 'waist', kind: 'line', role: 'stitching', p0: { x: 20, y: 30 }, p3: { x: 0, y: 30 } },
    { id: 'cf', kind: 'line', role: 'fold', isFold: true, p0: { x: 0, y: 30 }, p3: { x: 0, y: 0 } }
  ];
  return {
    pieceId: 'front-bodice',
    pieceCode: 'FB',
    name: 'Front Bodice',
    material: 'self',
    cutCount: 1,
    onFold: true,
    seamAllowanceWidthCm: 1.5,
    boundingBoxCm: { minX: 0, minY: 0, maxX: 20, maxY: 30, widthCm: 20, heightCm: 30 },
    sewSegments: segs,
    cutSegments: [
      { id: 'cut-0', kind: 'line', role: 'cutting', p0: { x: 0, y: -1.5 }, p3: { x: 21.5, y: -1.5 } }
    ],
    seams: [],
    seamAllowances: [],
    darts: [],
    notches: [],
    hasBlockingError: false
  };
}

test('WP-A3: exposes C0 bodice engine preset bridge metadata without duplicating math', () => {
  assert.equal(C0_BODICE_DART_PRESETS.length, 5);
  assert.ok(C0_BODICE_DART_PRESETS.every((p) => p.engineModuleRef.includes('dart-manipulation.ts')));
});

test('WP-A3: creates parametric dart with equalized legs, exact contour closure, and immutable cutSegments', () => {
  const piece = makeBodiceBlockPiece();
  const originalCutSnapshot = JSON.stringify(piece.cutSegments);

  const created = createProposalDartOnContour({
    pieceId: piece.pieceId,
    sewSegments: piece.sewSegments,
    existingDarts: [],
    existingLineage: {},
    coordinateFrame: FRAME_SVG,
    dartId: 'dart-waist-1',
    label: 'Waist Dart',
    hostSegmentId: 'waist',
    centerParameterT: 0.5,
    intakeWidthCm: 3.0,
    pivotApexCm: { x: 10, y: 15 },
    backoffCm: 2.0,
    foldDirection: 'toward-center'
  });

  assert.equal(created.ok, true);
  assert.ok(created.updatedSewSegments && created.updatedLineage);
  assert.equal(created.darts.length, 1);

  const dart = created.darts[0];
  assert.ok(Math.abs(dart.legLengthLeftCm - dart.legLengthRightCm) <= DART_LEG_PARITY_TOLERANCE_CM);
  assert.ok(dart.intakeAngleRad > 0.1);
  assert.equal(JSON.stringify(piece.cutSegments), originalCutSnapshot, 'cutSegments must never be mutated');

  const report = evaluateDartConservationReport({
    pieceId: piece.pieceId,
    sourcePiece: piece,
    currentSewSegments: created.updatedSewSegments,
    currentDarts: created.darts,
    referenceInitialAngleRad: dart.intakeAngleRad,
    referencePivotApexCm: dart.pivotApexCm,
    coordinateFrame: FRAME_SVG
  });

  assert.equal(report.authorityTier, 'UNVERIFIED_VISUAL_PROPOSAL');
  assert.equal(report.isCertified, false);
  assert.equal(report.isProductionReady, false);
  assert.equal(report.externalCadInteroperabilityVerified, false);
  assert.equal(report.contourClosed, true);
  assert.equal(report.selfIntersectionDetected, false);
  assert.equal(report.withinAdvisoryTolerances, true);
});

test('WP-A3: full transfer (1.0) and split transfer (0.5) conserve angular intake with zero apex drift', () => {
  const piece = makeBodiceBlockPiece();
  const created = createProposalDartOnContour({
    pieceId: piece.pieceId,
    sewSegments: piece.sewSegments,
    existingDarts: [],
    existingLineage: {},
    coordinateFrame: FRAME_SVG,
    dartId: 'dart-1',
    label: 'Waist Dart',
    hostSegmentId: 'waist',
    centerParameterT: 0.5,
    intakeWidthCm: 3.0,
    pivotApexCm: { x: 10, y: 15 },
    backoffCm: 2.0,
    foldDirection: 'toward-center'
  });
  assert.equal(created.ok, true);
  const initialAngle = created.darts[0].intakeAngleRad;
  const initialPivot = created.darts[0].pivotApexCm;

  // 1. Full transfer (100%) to side seam
  const fullXfer = rotateTransferProposalDart({
    pieceId: piece.pieceId,
    sewSegments: created.updatedSewSegments!,
    existingDarts: created.darts,
    existingLineage: created.updatedLineage!,
    sourceDartId: 'dart-1',
    newDartId: 'dart-side-full',
    targetHostSegmentId: 'side',
    targetParameterT: 0.5,
    transferRatio: 1.0,
    backoffCm: 2.0,
    foldDirection: 'downward'
  });
  assert.equal(fullXfer.ok, true);
  const fullReport = evaluateDartConservationReport({
    pieceId: piece.pieceId,
    sourcePiece: piece,
    currentSewSegments: fullXfer.updatedSewSegments!,
    currentDarts: fullXfer.darts,
    referenceInitialAngleRad: initialAngle,
    referencePivotApexCm: initialPivot,
    coordinateFrame: FRAME_SVG
  });
  assert.equal(fullReport.dartCount, 1);
  assert.ok(fullReport.angularIntakeResidualRad <= DART_ANGULAR_CONSERVATION_TOLERANCE_RAD);
  assert.ok(fullReport.apexDriftCm <= 1e-9);
  assert.equal(fullReport.contourClosed, true);
  assert.equal(fullReport.selfIntersectionDetected, false);
  assert.equal(fullReport.withinAdvisoryTolerances, true);

  // 2. Split transfer (50%) to side seam
  const splitXfer = rotateTransferProposalDart({
    pieceId: piece.pieceId,
    sewSegments: created.updatedSewSegments!,
    existingDarts: created.darts,
    existingLineage: created.updatedLineage!,
    sourceDartId: 'dart-1',
    newDartId: 'dart-side-split',
    targetHostSegmentId: 'side',
    targetParameterT: 0.5,
    transferRatio: 0.5,
    backoffCm: 2.0,
    foldDirection: 'split'
  });
  assert.equal(splitXfer.ok, true);
  const splitReport = evaluateDartConservationReport({
    pieceId: piece.pieceId,
    sourcePiece: piece,
    currentSewSegments: splitXfer.updatedSewSegments!,
    currentDarts: splitXfer.darts,
    referenceInitialAngleRad: initialAngle,
    referencePivotApexCm: initialPivot,
    coordinateFrame: FRAME_SVG
  });
  assert.equal(splitReport.dartCount, 2);
  assert.ok(splitReport.angularIntakeResidualRad <= DART_ANGULAR_CONSERVATION_TOLERANCE_RAD);
  assert.ok(splitReport.apexDriftCm <= 1e-9);
  assert.equal(splitReport.contourClosed, true);
  assert.equal(splitReport.withinAdvisoryTolerances, true);
});

test('WP-A3: supports dart parameter editing, close/open toggle, and fails closed on invalid parameters', () => {
  const piece = makeBodiceBlockPiece();
  const created = createProposalDartOnContour({
    pieceId: piece.pieceId,
    sewSegments: piece.sewSegments,
    existingDarts: [],
    existingLineage: {},
    coordinateFrame: FRAME_SVG,
    dartId: 'dart-1',
    label: 'Waist Dart',
    hostSegmentId: 'waist',
    centerParameterT: 0.5,
    intakeWidthCm: 2.5,
    pivotApexCm: { x: 10, y: 15 },
    backoffCm: 2.0,
    foldDirection: 'toward-center'
  });
  assert.equal(created.ok, true);

  const edited = editProposalDartParameters({
    sewSegments: created.updatedSewSegments!,
    existingDarts: created.darts,
    existingLineage: created.updatedLineage!,
    dartId: 'dart-1',
    intakeWidthCm: 4.0,
    backoffCm: 2.5
  });
  assert.equal(edited.ok, true);
  assert.ok(Math.abs(edited.darts[0].intakeWidthCm - 4.0) < 0.05);
  assert.ok(Math.abs(edited.darts[0].legLengthLeftCm - edited.darts[0].legLengthRightCm) <= DART_LEG_PARITY_TOLERANCE_CM);

  const closed = closeOrOpenProposalDart({
    sewSegments: edited.updatedSewSegments!,
    existingDarts: edited.darts,
    existingLineage: edited.updatedLineage!,
    dartId: 'dart-1',
    closed: true
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.darts[0].isClosed, true);

  // Fail-closed: excessive intake wider than host segment
  const badIntake = createProposalDartOnContour({
    pieceId: piece.pieceId,
    sewSegments: piece.sewSegments,
    existingDarts: [],
    existingLineage: {},
    coordinateFrame: FRAME_SVG,
    dartId: 'dart-bad',
    label: 'Too Wide',
    hostSegmentId: 'waist',
    centerParameterT: 0.5,
    intakeWidthCm: 25,
    pivotApexCm: { x: 10, y: 15 },
    backoffCm: 2,
    foldDirection: 'toward-center'
  });
  assert.equal(badIntake.ok, false);

  // Fail-closed: self-intersecting apex placed outside contour across opposite edge
  const selfX = createProposalDartOnContour({
    pieceId: piece.pieceId,
    sewSegments: piece.sewSegments,
    existingDarts: [],
    existingLineage: {},
    coordinateFrame: FRAME_SVG,
    dartId: 'dart-selfx',
    label: 'Outside Apex',
    hostSegmentId: 'waist',
    centerParameterT: 0.5,
    intakeWidthCm: 3,
    pivotApexCm: { x: 10, y: -10 },
    backoffCm: 0,
    foldDirection: 'toward-center'
  });
  assert.equal(selfX.ok, false);
});
