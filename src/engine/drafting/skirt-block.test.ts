/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { draftSkirtBlock } from './skirt-block';
import {
  validatePatternDraft,
  SEAM_TOLERANCE_CM,
  DART_LEG_TOLERANCE_CM,
  TANGENCY_TOLERANCE_DEG
} from '../validation/seam-validator';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { checkPerpendicularity, distance, vector } from '../geometry/math';
import { DesignSpecification, PatternPiece } from '../../types';

const baseDesign: DesignSpecification = {
  id: 'des-01',
  name: 'Minimalist Straight Skirt',
  prompt: 'A tailored minimalist wool skirt with clean waistline',
  garmentCategory: 'skirt',
  silhouette: 'straight',
  fabric: {
    id: 'wool-crepe',
    name: 'Wool Crepe',
    composition: '100% Virgin Wool',
    weight: 'medium',
    stretch: 'none',
    recommendedEaseCm: { waist: 3, hip: 4 },
    drapeDescription: 'Structured fluid drape with crisp grain'
  },
  color: { name: 'Oatmeal', hex: '#E5DFD3' },
  easeProfile: 'classic',
  lengthCm: 64,
  constructionFeatures: [
    {
      id: 'cf-1',
      category: 'closure',
      name: 'Invisible Zipper',
      description: '18cm invisible zipper at Center Back',
      patternImpact: '1.5cm seam allowance on CB seam'
    }
  ],
  designNotes: ['Back vent optional', 'Waist facing or 3cm waistband'],
  isApproved: true,
  version: 1
};

test('draftSkirtBlock drafts valid Front and Back skirt panels', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, baseDesign);

  assert.equal(pieces.length, 2, 'Should generate exactly 2 pieces (Front and Back)');

  const [front, back] = pieces;
  assert.equal(front.pieceCode, 'SK-01-F');
  assert.equal(front.onFold, true);
  assert.equal(back.pieceCode, 'SK-02-B');
  assert.equal(back.cutCount, 2);

  // Both pieces must contain darts
  assert.equal(front.darts.length, 1);
  assert.equal(back.darts.length, 1);

  // Both pieces must have valid SVG paths
  assert.ok(front.cutPathData.startsWith('M'));
  assert.ok(back.cutPathData.startsWith('M'));
  assert.ok(front.sewPathData.includes('Z'));
  assert.ok(back.sewPathData.includes('Z'));

  // Both pieces must have explicit geometric contours (Milestone 02)
  assert.ok(front.stitchingContour, 'Front piece must have stitchingContour');
  assert.ok(front.cuttingContour, 'Front piece must have cuttingContour');
  assert.ok(back.stitchingContour, 'Back piece must have stitchingContour');
  assert.ok(back.cuttingContour, 'Back piece must have cuttingContour');

  // Verify all seams have segmentId(s) that map to contour segments with matching length
  for (const piece of pieces) {
    for (const seam of piece.seams) {
      assert.ok(seam.segmentId, `Seam "${seam.name}" on ${piece.name} must have a segmentId`);
      const targetIds = seam.segmentIds || (seam.segmentId ? [seam.segmentId] : []);
      let totalGeomLen = 0;
      for (const sId of targetIds) {
        const seg = piece.stitchingContour?.segments.find((s: { id: string }) => s.id === sId);
        assert.ok(seg, `Segment "${sId}" must exist in stitchingContour`);
        totalGeomLen += seg.lengthCm();
      }
      const diff = Math.abs(seam.lengthCm - totalGeomLen);
      assert.ok(diff < 0.05, `Seam length (${seam.lengthCm}) must match segments length (${totalGeomLen.toFixed(2)})`);
    }
  }
});

test('Center Front waist and hem meet fold at exact 90.0° perpendicular tangency', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, baseDesign);
  const front = pieces.find(p => p.onFold)!;

  const cfSeam = front.seams.find(s => s.id === 'fs-center-front')!;
  const waistSeam = front.seams.find(s => s.id === 'fs-waist')!;
  const hemSeam = front.seams.find(s => s.id === 'fs-hem')!;

  assert.ok(cfSeam, 'CF seamline must exist');
  assert.ok(waistSeam, 'Front waistline must exist');
  assert.ok(hemSeam, 'Front hemline must exist');

  const foldVec = vector(cfSeam.startPoint, cfSeam.endPoint); // (0, 1)

  // Waistline departure at CF
  const waistDeparture = { x: -waistSeam.endTangent!.x, y: -waistSeam.endTangent!.y };
  const waistPerp = checkPerpendicularity(foldVec, waistDeparture, TANGENCY_TOLERANCE_DEG);
  assert.equal(
    waistPerp.isPerpendicular,
    true,
    `Waistline angle (${waistPerp.measuredAngleDeg}°) must be 90° ± ${TANGENCY_TOLERANCE_DEG}°`
  );

  // Hemline departure at CF
  const hemDeparture = hemSeam.startTangent!;
  const hemPerp = checkPerpendicularity(foldVec, hemDeparture, TANGENCY_TOLERANCE_DEG);
  assert.equal(
    hemPerp.isPerpendicular,
    true,
    `Hemline angle (${hemPerp.measuredAngleDeg}°) must be 90° ± ${TANGENCY_TOLERANCE_DEG}°`
  );
});

test('Center Back waist and hem meet zipper seam at exact 90.0° perpendicular tangency', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, baseDesign);
  const back = pieces.find(p => !p.onFold)!;

  const cbSeam = back.seams.find(s => s.id === 'bs-center-back')!;
  const waistSeam = back.seams.find(s => s.id === 'bs-waist')!;
  const hemSeam = back.seams.find(s => s.id === 'bs-hem')!;

  const cbVec = vector(cbSeam.startPoint, cbSeam.endPoint);

  const waistDeparture = { x: -waistSeam.endTangent!.x, y: -waistSeam.endTangent!.y };
  const waistPerp = checkPerpendicularity(cbVec, waistDeparture, TANGENCY_TOLERANCE_DEG);
  assert.equal(
    waistPerp.isPerpendicular,
    true,
    `CB Waistline angle (${waistPerp.measuredAngleDeg}°) must be 90° ± ${TANGENCY_TOLERANCE_DEG}°`
  );

  const hemDeparture = hemSeam.startTangent!;
  const hemPerp = checkPerpendicularity(cbVec, hemDeparture, TANGENCY_TOLERANCE_DEG);
  assert.equal(
    hemPerp.isPerpendicular,
    true,
    `CB Hemline angle (${hemPerp.measuredAngleDeg}°) must be 90° ± ${TANGENCY_TOLERANCE_DEG}°`
  );
});

test('Dart leg lengths are mathematically equidistant from apex within DART_LEG_TOLERANCE_CM', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, baseDesign);

  for (const piece of pieces) {
    for (const dart of piece.darts) {
      const leftLen = distance(dart.apex, dart.legLeft);
      const rightLen = distance(dart.apex, dart.legRight);
      const delta = Math.abs(leftLen - rightLen);
      assert.ok(
        delta <= DART_LEG_TOLERANCE_CM,
        `Dart ${dart.id} on ${piece.name} has asymmetric legs: Left=${leftLen.toFixed(2)}, Right=${rightLen.toFixed(2)}, Delta=${delta.toFixed(2)}`
      );
    }
  }
});

test('Side seam lengths match between Front and Back within SEAM_TOLERANCE_CM', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.L;
  const pieces = draftSkirtBlock(measurements, baseDesign);

  const front = pieces.find(p => p.id === 'piece-skirt-front')!;
  const back = pieces.find(p => p.id === 'piece-skirt-back')!;

  const frontSideSeam = front.seams.find(s => s.name === 'Front Side Seam')!;
  const backSideSeam = back.seams.find(s => s.name === 'Back Side Seam')!;

  assert.ok(frontSideSeam);
  assert.ok(backSideSeam);

  const discrepancy = Math.abs(frontSideSeam.lengthCm - backSideSeam.lengthCm);
  assert.ok(
    discrepancy <= SEAM_TOLERANCE_CM,
    `Side seam discrepancy (${discrepancy} cm) exceeds ${SEAM_TOLERANCE_CM} cm`
  );
});

test('Cutting paths reflect correct fold vs seam allowance rules', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, baseDesign);

  const front = pieces.find(p => p.onFold)!;
  const back = pieces.find(p => !p.onFold)!;

  // Front cut path must have x=0 on fold
  assert.ok(
    front.cutPathData.includes('M 0') && front.cutPathData.includes('L 0'),
    'Front cut path must lie on x=0 along Center Front fold'
  );

  // Back cut path must have x=-1.5 for zipper allowance
  assert.ok(
    back.cutPathData.includes('M -1.5') && back.cutPathData.includes('L -1.5'),
    'Back cut path must have 1.5cm seam allowance along Center Back for zipper'
  );
});

test('Validation engine honestly declares unassessed industrial criteria and sets isProductionReady to false', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, baseDesign);
  const report = validatePatternDraft(pieces);

  assert.equal(report.status, 'validated');
  assert.equal(report.isValid, true);
  assert.equal(report.failureCount, 0);
  assert.equal(report.isProductionReady, false, 'Must not claim industrial production ready without grading & shrinkage tests');
  assert.ok(report.unassessedConditions.length >= 3, 'Must declare unassessed industrial conditions');
  assert.ok(report.declaration.includes('Sample Pattern Validated'));
});

test('Validation engine fails if Center Front waist tangency is distorted (negative test)', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, baseDesign);

  // Intentionally distort front waist tangent to simulate an angled "V" peak at fold
  const frontDistorted: PatternPiece = {
    ...pieces[0],
    seams: pieces[0].seams.map(s => {
      if (s.id === 'fs-waist') {
        return {
          ...s,
          endTangent: { x: -0.707, y: -0.707 } // 45° slope instead of horizontal
        };
      }
      return s;
    })
  };

  const report = validatePatternDraft([frontDistorted, pieces[1]]);
  assert.equal(report.isValid, false);
  assert.equal(report.status, 'invalid');
  assert.ok(report.failureCount >= 1);
  assert.ok(report.checks.some(c => c.id === 'val-tangency-cf-waist' && c.status === 'fail'));
});

test('Validation engine fails if dart legs are asymmetric by more than 1mm (negative test)', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const pieces = draftSkirtBlock(measurements, baseDesign);

  // Intentionally skew front dart left leg
  const frontSkewed: PatternPiece = {
    ...pieces[0],
    darts: [
      {
        ...pieces[0].darts[0],
        legLeft: { x: pieces[0].darts[0].legLeft.x - 0.5, y: pieces[0].darts[0].legLeft.y - 1.2 }
      }
    ]
  };

  const report = validatePatternDraft([frontSkewed, pieces[1]]);
  assert.equal(report.isValid, false);
  assert.equal(report.status, 'invalid');
  assert.ok(report.checks.some(c => c.category === 'dart-closure' && c.status === 'fail'));
});

test('Regression: all skirt silhouettes (straight, a-line, flared, pencil) draft valid geometry', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const silhouettes = ['straight', 'a-line', 'flared', 'pencil'] as const;

  for (const sil of silhouettes) {
    const design: DesignSpecification = {
      ...baseDesign,
      silhouette: sil
    };
    const pieces = draftSkirtBlock(measurements, design);
    const report = validatePatternDraft(pieces);

    assert.equal(
      report.isValid,
      true,
      `Silhouette "${sil}" must draft valid geometry without failures`
    );
    assert.equal(report.failureCount, 0, `Silhouette "${sil}" must have 0 failures`);
  }
});

test('Milestone 02.2 Acceptance: Real offset failure propagation blocks production readiness end-to-end', () => {
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;

  // 1. Execute actual drafting workflow with strict manufacturing tolerance (1 micron = 0.0001 cm)
  // that genuine high-curvature hip curve cannot achieve within MAX_SUBDIVISION_DEPTH
  const strictPieces = draftSkirtBlock(measurements, baseDesign, {
    bezierToleranceCm: 0.0001
  });

  const frontPiece = strictPieces[0];
  const backPiece = strictPieces[1];

  // 2. Verify actual offset engine reported failure on real geometry without mocks
  assert.ok(frontPiece.offsetResult, 'PatternPiece must have actual offsetResult attached');
  assert.equal(frontPiece.offsetResult.status, 'failure', 'Real offset engine must report failure');
  assert.equal(frontPiece.offsetResult.toleranceExceeded, true);
  assert.ok(frontPiece.offsetResult.diagnostics && frontPiece.offsetResult.diagnostics.length > 0);

  // 3. Confirm failure diagnostics identify the specific curved segment (fs-side-hip) and subdivision depth
  const failureDiag = frontPiece.offsetResult.diagnostics.find(d => d.status === 'failure');
  assert.ok(failureDiag, 'Must contain real segment failure diagnostic');
  assert.ok(failureDiag.sourceSegmentId.startsWith('fs-side-hip'), 'Diagnostic must identify real hip curve segment');
  assert.ok(failureDiag.maxDeviationCm > 0.0001, 'Reported deviation must exceed the requested 0.0001 cm tolerance');
  assert.ok(failureDiag.failureReason?.includes('maximum subdivision depth'), 'Reason must document subdivision depth limit');

  // 4. Confirm stitching contour remains strictly uncorrupted and unchanged
  assert.equal(frontPiece.stitchingContour?.segments.length, 9, 'Stitching contour segment count must remain intact');
  const originalStitchHip = frontPiece.stitchingContour?.segments.find(s => s.id === 'fs-side-hip');
  assert.ok(originalStitchHip, 'Stitching hip curve must exist');
  assert.equal(originalStitchHip.type, 'bezier');

  // 5. Confirm validation engine rejects the affected draft through standard validatePatternDraft()
  const report = validatePatternDraft(strictPieces);
  assert.equal(report.isValid, false, 'Validation report must declare draft invalid');
  assert.equal(report.isProductionReady, false, 'Production readiness must be strictly false');
  assert.equal(report.status, 'invalid');

  const offsetFailCheck = report.checks.find(c => c.errorCode === 'VAL-OFFSET-FAILED' && c.segmentIds?.some(id => id.startsWith('fs-side-hip')));
  assert.ok(offsetFailCheck, 'Must record genuine VAL-OFFSET-FAILED check identifying the affected segment IDs');
  assert.equal(offsetFailCheck.status, 'fail');
  assert.equal(offsetFailCheck.category, 'offset');
  assert.ok(offsetFailCheck.message.includes('fs-side-hip'));
});
