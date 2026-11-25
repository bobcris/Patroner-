/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CoordinateYAxisDirection,
  PatternArtifactBundle,
  RenderSpatialDiagnostic
} from '../contracts/pattern-render-artifact';
import {
  COLLAPSED_INTERVAL_EPSILON,
  DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
  clusterProjectedDiagnostics,
  computeDiagnosticFocusBoundsCm,
  evaluateSegmentPointExact,
  extractSegmentIntervalExact,
  projectDiagnosticsForCanvas,
  reconcileDiagnosticSelection,
  resolveArtifactDiagnostics,
  type BoardPieceOffsetVisibility
} from '../spatial-diagnostics';
import { evaluateCubicBezierUnrounded } from '../entity-hit-test';

function createTestArtifact(
  diagnostics: readonly RenderSpatialDiagnostic[],
  options?: {
    yAxisDirection?: CoordinateYAxisDirection;
    duplicateSegmentIdOnCut?: boolean;
    specificationRevisionId?: string;
  }
): PatternArtifactBundle {
  const yAxisDirection = options?.yAxisDirection ?? 'svg-y-down';
  const cutSegId = options?.duplicateSegmentIdOnCut ? 'seg-line-1' : 'cut-line-1';

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
      specificationRevisionId: options?.specificationRevisionId ?? 'spec-test-v1',
      measurementRevisionId: 'meas-M',
      engineVersion: 'test-fixture',
      disclosureLabel: 'Test fixture'
    },
    pieces: [
      {
        pieceId: 'piece-front',
        pieceCode: 'FR-01',
        name: 'Front Block',
        material: 'self',
        cutCount: 1,
        onFold: false,
        seamAllowanceWidthCm: 1.5,
        boundingBoxCm: {
          minX: 0,
          minY: 0,
          maxX: 20,
          maxY: 30,
          widthCm: 20,
          heightCm: 30
        },
        sewSegments: [
          {
            id: 'seg-line-1',
            kind: 'line',
            role: 'stitching',
            p0: { x: 0, y: 0 },
            p3: { x: 20, y: 0 }
          },
          {
            id: 'seg-cubic-1',
            kind: 'cubic-bezier',
            role: 'stitching',
            p0: { x: 20, y: 0 },
            p1: { x: 24, y: 10 },
            p2: { x: 18, y: 22 },
            p3: { x: 20, y: 30 }
          },
          {
            id: 'seg-line-2',
            kind: 'line',
            role: 'stitching',
            p0: { x: 20, y: 30 },
            p3: { x: 0, y: 30 }
          }
        ],
        cutSegments: [
          {
            id: cutSegId,
            kind: 'line',
            role: 'cutting',
            p0: { x: -1.5, y: -1.5 },
            p3: { x: 21.5, y: -1.5 }
          },
          {
            id: 'cut-cubic-1',
            kind: 'cubic-bezier',
            role: 'cutting',
            p0: { x: 21.5, y: -1.5 },
            p1: { x: 25.5, y: 10 },
            p2: { x: 19.5, y: 22 },
            p3: { x: 21.5, y: 31.5 }
          }
        ],
        seams: [],
        seamAllowances: [],
        darts: [],
        notches: [],
        hasBlockingError: false
      }
    ],
    diagnostics
  };
}

const DEFAULT_BOARD_OFFSETS: Readonly<Record<string, BoardPieceOffsetVisibility>> = {
  'piece-front': { offsetXCm: 10, offsetYCm: 5, visible: true }
};

test('1. Explicit point mapping (piece-local and board-space)', () => {
  const artifact = createTestArtifact([
    {
      id: 'diag-pt-local',
      code: 'ADR009_LOCAL_SELF_INTERSECTION',
      severity: 'CRITICAL_BLOCKING',
      pieceId: 'piece-front',
      segmentId: 'seg-cubic-1',
      anchorPointCm: { x: 12.25, y: 14.5 },
      anchorCoordinateSpace: 'piece-local',
      message: 'Explicit piece-local intersection point.'
    },
    {
      id: 'diag-pt-board',
      code: 'BOARD_EXPLICIT_PIN',
      severity: 'INFO',
      anchorPointCm: { x: 42, y: 18 },
      anchorCoordinateSpace: 'board',
      message: 'Explicit board-space point.'
    }
  ]);

  const resolved = resolveArtifactDiagnostics(artifact);
  assert.equal(resolved.summary.mappedCount, 2);

  const localItem = resolved.byKey.get('diag-pt-local::#0');
  assert.ok(localItem);
  assert.equal(localItem.outcome, 'mapped-point');
  assert.deepEqual(localItem.localAnchorCm, { x: 12.25, y: 14.5 });
  assert.equal(localItem.resolvedSegments.length, 1);

  const boardItem = resolved.byKey.get('diag-pt-board::#0');
  assert.ok(boardItem);
  assert.equal(boardItem.outcome, 'mapped-point');
  assert.deepEqual(boardItem.boardAnchorOverrideCm, { x: 42, y: 18 });

  const projected = projectDiagnosticsForCanvas(
    resolved,
    DEFAULT_BOARD_OFFSETS,
    { showSewLines: true, showSeamAllowance: true },
    { zoom: 1, panX: 0, panY: 0 },
    { yAxisDirection: 'svg-y-down' },
    { width: 1200, height: 800 },
    {
      showOverlay: true,
      severityFilter: DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
      selectedDiagnosticKey: null,
      hoveredDiagnosticKey: null
    }
  );
  const pLocal = projected.visibleItems.find(v => v.resolved.diagnosticKey === 'diag-pt-local::#0');
  assert.ok(pLocal);
  assert.deepEqual(pLocal.boardAnchorCm, { x: 22.25, y: 19.5 });
});

test('2. Parameter mapping on line segments', () => {
  const artifact = createTestArtifact([
    {
      id: 'diag-line-t',
      code: 'LINE_PARAM',
      severity: 'WARNING',
      pieceId: 'piece-front',
      segmentId: 'seg-line-1',
      parameterT: 0.25,
      message: 'Quarter point on line segment.'
    }
  ]);

  const resolved = resolveArtifactDiagnostics(artifact);
  const item = resolved.byKey.get('diag-line-t::#0');
  assert.ok(item);
  assert.equal(item.outcome, 'mapped-parameter');
  assert.equal(item.contourScope, 'sew');
  assert.deepEqual(item.localAnchorCm, { x: 5, y: 0 });
});

test('3. Parameter mapping on cubic Bézier segments matches exact unrounded Bernstein evaluation', () => {
  const t = 0.37;
  const artifact = createTestArtifact([
    {
      id: 'diag-cubic-t',
      code: 'ADR009_TANGENT_REVERSAL',
      severity: 'CRITICAL_BLOCKING',
      pieceId: 'piece-front',
      segmentId: 'seg-cubic-1',
      parameterT: t,
      message: 'Tangent reversal at t=0.37.'
    }
  ]);

  const resolved = resolveArtifactDiagnostics(artifact);
  const item = resolved.byKey.get('diag-cubic-t::#0');
  assert.ok(item);
  assert.equal(item.outcome, 'mapped-parameter');

  const seg = artifact.pieces[0].sewSegments[1];
  const expected = evaluateCubicBezierUnrounded(seg.p0, seg.p1!, seg.p2!, seg.p3, t);
  assert.ok(item.localAnchorCm);
  assert.ok(Math.abs(item.localAnchorCm.x - expected.x) < 1e-12);
  assert.ok(Math.abs(item.localAnchorCm.y - expected.y) < 1e-12);
});

test('4. Valid interval mapping uses exact De Casteljau cubic sub-curve extraction', () => {
  const artifact = createTestArtifact([
    {
      id: 'diag-interval',
      code: 'ADR009_UNRESOLVED_INTERVAL',
      severity: 'ERROR',
      pieceId: 'piece-front',
      segmentId: 'seg-cubic-1',
      parameterIntervals: [[0.2, 0.7]],
      verificationOutcome: 'INCONCLUSIVE',
      message: 'Unresolved verification interval [0.2, 0.7].'
    }
  ]);

  const resolved = resolveArtifactDiagnostics(artifact);
  const item = resolved.byKey.get('diag-interval::#0');
  assert.ok(item);
  assert.equal(item.outcome, 'mapped-interval');
  assert.equal(item.isInconclusive, true);
  assert.equal(item.extractedIntervals.length, 1);

  const sub = item.extractedIntervals[0];
  assert.equal(sub.kind, 'cubic-subsegment');
  if (sub.kind === 'cubic-subsegment') {
    const seg = artifact.pieces[0].sewSegments[1];
    // Verify De Casteljau sub-curve matches original cubic at u=0, u=0.5, u=1.0 to machine precision
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const origT = 0.2 + u * (0.7 - 0.2);
      const origPt = evaluateCubicBezierUnrounded(seg.p0, seg.p1!, seg.p2!, seg.p3, origT);
      const subPt = evaluateCubicBezierUnrounded(sub.p0, sub.p1, sub.p2, sub.p3, u);
      assert.ok(Math.abs(origPt.x - subPt.x) < 1e-11);
      assert.ok(Math.abs(origPt.y - subPt.y) < 1e-11);
    }
  }
});

test('5. Collapsed interval / root bracket is preserved as collapsed-point marker (never discarded)', () => {
  const artifact = createTestArtifact([
    {
      id: 'diag-collapsed',
      code: 'ADR009_ISOLATED_CUSP_ROOT',
      severity: 'CRITICAL_BLOCKING',
      pieceId: 'piece-front',
      segmentId: 'seg-cubic-1',
      parameterIntervals: [
        [0.5, 0.5],
        [0.75, 0.75 + COLLAPSED_INTERVAL_EPSILON * 0.5]
      ],
      message: 'Collapsed cusp root brackets.'
    }
  ]);

  const resolved = resolveArtifactDiagnostics(artifact);
  const item = resolved.byKey.get('diag-collapsed::#0');
  assert.ok(item);
  assert.equal(item.outcome, 'mapped-interval');
  assert.equal(item.extractedIntervals.length, 2);
  assert.equal(item.extractedIntervals[0].kind, 'collapsed-point');
  assert.equal(item.extractedIntervals[1].kind, 'collapsed-point');

  const seg = artifact.pieces[0].sewSegments[1];
  const expected0 = evaluateSegmentPointExact(seg, 0.5)!;
  assert.ok(item.localAnchorCm);
  assert.ok(Math.abs(item.localAnchorCm.x - expected0.x) < 1e-12);
  assert.ok(Math.abs(item.localAnchorCm.y - expected0.y) < 1e-12);
});

test('6. Multi-segment diagnostics resolve primary and all secondary segments', () => {
  const artifact = createTestArtifact([
    {
      id: 'diag-multi-seg',
      code: 'VAL-CONTINUITY-GAP',
      severity: 'ERROR',
      pieceId: 'piece-front',
      segmentId: 'seg-line-1',
      secondarySegmentIds: ['seg-cubic-1', 'seg-line-2'],
      message: 'Multi-segment continuity gap.'
    }
  ]);

  const resolved = resolveArtifactDiagnostics(artifact);
  const item = resolved.byKey.get('diag-multi-seg::#0');
  assert.ok(item);
  assert.equal(item.outcome, 'mapped-segment');
  assert.equal(item.resolvedSegments.length, 3);
  assert.deepEqual(
    item.resolvedSegments.map(s => s.segmentId),
    ['seg-line-1', 'seg-cubic-1', 'seg-line-2']
  );
  assert.equal(item.resolvedSegments[0].isPrimary, true);
  assert.equal(item.resolvedSegments[1].isPrimary, false);
});

test('7. Piece-level mapping respects SVG Y-down and Cartesian Y-up conventions', () => {
  const diag: RenderSpatialDiagnostic = {
    id: 'diag-piece',
    code: 'PIECE_CHECK',
    severity: 'WARNING',
    pieceId: 'piece-front',
    message: 'Piece-level warning.'
  };

  const resDown = resolveArtifactDiagnostics(createTestArtifact([diag], { yAxisDirection: 'svg-y-down' }));
  const itemDown = resDown.byKey.get('diag-piece::#0')!;
  assert.equal(itemDown.outcome, 'mapped-piece');
  assert.ok(itemDown.localAnchorCm && itemDown.localAnchorCm.y < 10, 'SVG Y-down badge near top (small Y)');

  const resUp = resolveArtifactDiagnostics(createTestArtifact([diag], { yAxisDirection: 'cartesian-y-up' }));
  const itemUp = resUp.byKey.get('diag-piece::#0')!;
  assert.equal(itemUp.outcome, 'mapped-piece');
  assert.ok(itemUp.localAnchorCm && itemUp.localAnchorCm.y > 20, 'Cartesian Y-up badge near top (large Y)');
});

test('8. Unmapped global diagnostics produce zero fabricated coordinates or pins', () => {
  const artifact = createTestArtifact([
    {
      id: 'diag-global',
      code: 'VAL-SLV-EASE',
      severity: 'WARNING',
      message: 'Global sleeve cap ease warning without piece/segment target.'
    }
  ]);

  const resolved = resolveArtifactDiagnostics(artifact);
  assert.equal(resolved.summary.unmappedCount, 1);
  assert.equal(resolved.summary.mappedCount, 0);
  const item = resolved.byKey.get('diag-global::#0')!;
  assert.equal(item.outcome, 'unmapped');
  assert.equal(item.isMapped, false);
  assert.equal(item.localAnchorCm, undefined);
  assert.equal(item.boardAnchorOverrideCm, undefined);
  assert.equal(computeDiagnosticFocusBoundsCm(item, { x: 0, y: 0 }), null);
});

test('9 & 10. Stale piece references and stale segment references fail closed explicitly', () => {
  const artifact = createTestArtifact([
    {
      id: 'diag-stale-piece',
      code: 'ERR_STALE_P',
      severity: 'ERROR',
      pieceId: 'piece-deleted-99',
      message: 'Points to nonexistent piece.'
    },
    {
      id: 'diag-stale-seg',
      code: 'ERR_STALE_S',
      severity: 'ERROR',
      pieceId: 'piece-front',
      segmentId: 'seg-nonexistent',
      message: 'Points to nonexistent segment.'
    }
  ]);

  const resolved = resolveArtifactDiagnostics(artifact);
  assert.equal(resolved.summary.staleCount, 2);
  assert.equal(resolved.summary.mappedCount, 0);
  assert.equal(resolved.byKey.get('diag-stale-piece::#0')?.outcome, 'stale-reference');
  assert.equal(resolved.byKey.get('diag-stale-seg::#0')?.outcome, 'stale-reference');
});

test('11, 12, 13. Non-finite coordinates, unreferenced point pin, out-of-range parameterT, and invalid intervals fail closed without clamping', () => {
  const artifact = createTestArtifact([
    {
      id: 'diag-nan-pt',
      code: 'ERR_NAN',
      severity: 'ERROR',
      pieceId: 'piece-front',
      anchorPointCm: { x: Number.NaN, y: 5 },
      message: 'NaN point.'
    },
    {
      id: 'diag-origin-pin',
      code: 'ERR_NO_PIECE_PT',
      severity: 'ERROR',
      anchorPointCm: { x: 5, y: 5 },
      message: 'Piece-local point without pieceId must not pin to origin.'
    },
    {
      id: 'diag-t-high',
      code: 'ERR_T_HIGH',
      severity: 'ERROR',
      pieceId: 'piece-front',
      segmentId: 'seg-line-1',
      parameterT: 1.05,
      message: 't > 1 must not clamp to 1.'
    },
    {
      id: 'diag-t-neg',
      code: 'ERR_T_NEG',
      severity: 'ERROR',
      pieceId: 'piece-front',
      segmentId: 'seg-line-1',
      parameterT: -0.01,
      message: 't < 0 must not clamp to 0.'
    },
    {
      id: 'diag-inv-interval',
      code: 'ERR_INV_INT',
      severity: 'ERROR',
      pieceId: 'piece-front',
      segmentId: 'seg-cubic-1',
      parameterIntervals: [[0.8, 0.3]],
      message: 'Inverted interval [0.8, 0.3].'
    },
    {
      id: 'diag-oob-interval',
      code: 'ERR_OOB_INT',
      severity: 'ERROR',
      pieceId: 'piece-front',
      segmentId: 'seg-cubic-1',
      parameterIntervals: [[0.2, 1.5]],
      message: 'Out-of-bounds interval [0.2, 1.5].'
    }
  ]);

  const resolved = resolveArtifactDiagnostics(artifact);
  assert.equal(resolved.summary.invalidCount, 6);
  assert.equal(resolved.summary.mappedCount, 0);
  for (const item of resolved.items) {
    assert.equal(item.outcome, 'invalid-reference');
    assert.equal(item.isMapped, false);
  }
  assert.equal(extractSegmentIntervalExact(artifact.pieces[0].sewSegments[0], 0.8, 0.2), null);
});

test('14. Ambiguous sew/cut segment IDs fail closed unless contour qualifier is supplied', () => {
  const artifact = createTestArtifact(
    [
      {
        id: 'diag-ambiguous',
        code: 'AMBIG_SEG',
        severity: 'ERROR',
        pieceId: 'piece-front',
        segmentId: 'seg-line-1',
        message: 'Exists in both sew and cut without contour.'
      },
      {
        id: 'diag-disambiguated',
        code: 'EXPLICIT_CUT_SEG',
        severity: 'ERROR',
        pieceId: 'piece-front',
        segmentId: 'seg-line-1',
        contour: 'cut',
        message: 'Explicitly qualified to cut contour.'
      }
    ],
    { duplicateSegmentIdOnCut: true }
  );

  const resolved = resolveArtifactDiagnostics(artifact);
  assert.equal(resolved.byKey.get('diag-ambiguous::#0')?.outcome, 'invalid-reference');
  assert.equal(resolved.byKey.get('diag-disambiguated::#0')?.outcome, 'mapped-segment');
  assert.equal(resolved.byKey.get('diag-disambiguated::#0')?.contourScope, 'cut');
});

test('19 & 20. Duplicate diagnostic IDs are disambiguated and selection reconciles cleanly after artifact replacement', () => {
  const artifact1 = createTestArtifact([
    {
      id: 'dup-id',
      code: 'WARN_A',
      severity: 'WARNING',
      pieceId: 'piece-front',
      segmentId: 'seg-line-1',
      message: 'First occurrence'
    },
    {
      id: 'dup-id',
      code: 'WARN_B',
      severity: 'ERROR',
      pieceId: 'piece-front',
      segmentId: 'seg-line-2',
      message: 'Second occurrence'
    }
  ]);

  const resolved1 = resolveArtifactDiagnostics(artifact1);
  assert.equal(resolved1.items.length, 2);
  assert.ok(resolved1.byKey.has('dup-id::#0'));
  assert.ok(resolved1.byKey.has('dup-id::#1'));

  // Valid selection survives identical/matching artifact
  const kept = reconcileDiagnosticSelection('dup-id::#1', resolved1);
  assert.equal(kept.selectedDiagnosticKey, 'dup-id::#1');
  assert.equal(kept.wasClearedDueToStaleArtifact, false);

  // Artifact replacement removes second occurrence -> stale selection clears gracefully
  const artifact2 = createTestArtifact(
    [
      {
        id: 'dup-id',
        code: 'WARN_A',
        severity: 'WARNING',
        pieceId: 'piece-front',
        segmentId: 'seg-line-1',
        message: 'Only first remains'
      }
    ],
    { specificationRevisionId: 'spec-test-v2' }
  );
  const resolved2 = resolveArtifactDiagnostics(artifact2);
  assert.notEqual(resolved1.artifactIdentityKey, resolved2.artifactIdentityKey);

  const cleared = reconcileDiagnosticSelection('dup-id::#1', resolved2);
  assert.equal(cleared.selectedDiagnosticKey, null);
  assert.equal(cleared.wasClearedDueToStaleArtifact, true);
  assert.equal(cleared.previousKey, 'dup-id::#1');
});

test('D3, D5, clustering, clean draft, and board-offset movement without artifact remapping', () => {
  // Clean draft -> zero mapped items and zero projected clusters
  const cleanResolved = resolveArtifactDiagnostics(createTestArtifact([]));
  const cleanProj = projectDiagnosticsForCanvas(
    cleanResolved,
    DEFAULT_BOARD_OFFSETS,
    { showSewLines: true, showSeamAllowance: true },
    { zoom: 1, panX: 0, panY: 0 },
    { yAxisDirection: 'svg-y-down' },
    { width: 1200, height: 800 },
    {
      showOverlay: true,
      severityFilter: DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
      selectedDiagnosticKey: null,
      hoveredDiagnosticKey: null
    }
  );
  assert.equal(cleanProj.visibleItems.length, 0);
  assert.equal(cleanProj.clusters.length, 0);

  // D5: Hidden Sew layer keeps ERROR/CRITICAL_BLOCKING visible with hiddenHostLayer='sew', hides WARNING/INFO
  const mixedArtifact = createTestArtifact([
    {
      id: 'd-sew-warn',
      code: 'SEW_WARN',
      severity: 'WARNING',
      pieceId: 'piece-front',
      segmentId: 'seg-line-1',
      contour: 'sew',
      parameterT: 0.5,
      message: 'Sew warning'
    },
    {
      id: 'd-sew-crit',
      code: 'SEW_CRIT',
      severity: 'CRITICAL_BLOCKING',
      pieceId: 'piece-front',
      segmentId: 'seg-line-1',
      contour: 'sew',
      parameterT: 0.505, // Very close in screen space -> clusters with d-sew-warn when sew visible
      message: 'Sew critical'
    },
    {
      id: 'd-cut-info',
      code: 'CUT_INFO',
      severity: 'INFO',
      pieceId: 'piece-front',
      segmentId: 'cut-cubic-1',
      contour: 'cut',
      message: 'Cut info'
    },
    {
      id: 'd-cut-err',
      code: 'CUT_ERR',
      severity: 'ERROR',
      pieceId: 'piece-front',
      segmentId: 'cut-cubic-1',
      contour: 'cut',
      parameterT: 0.9,
      message: 'Cut error'
    }
  ]);

  // Resolve ONCE at artifact level
  const resolved = resolveArtifactDiagnostics(mixedArtifact);

  // With Sew hidden: WARNING hides, CRITICAL_BLOCKING stays visible with hiddenHostLayer='sew'
  const projSewHidden = projectDiagnosticsForCanvas(
    resolved,
    DEFAULT_BOARD_OFFSETS,
    { showSewLines: false, showSeamAllowance: true },
    { zoom: 1, panX: 0, panY: 0 },
    { yAxisDirection: 'svg-y-down' },
    { width: 1200, height: 800 },
    {
      showOverlay: true,
      severityFilter: DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
      selectedDiagnosticKey: null,
      hoveredDiagnosticKey: null
    }
  );
  assert.equal(projSewHidden.hiddenByLayerCount, 1);
  assert.equal(projSewHidden.visibleItems.length, 3);
  const critProj = projSewHidden.visibleItems.find(v => v.resolved.source.id === 'd-sew-crit');
  assert.ok(critProj);
  assert.equal(critProj.hiddenHostLayer, 'sew');

  // With Cut hidden: INFO hides, ERROR stays visible with hiddenHostLayer='cut'
  const projCutHidden = projectDiagnosticsForCanvas(
    resolved,
    DEFAULT_BOARD_OFFSETS,
    { showSewLines: true, showSeamAllowance: false },
    { zoom: 1, panX: 0, panY: 0 },
    { yAxisDirection: 'svg-y-down' },
    { width: 1200, height: 800 },
    {
      showOverlay: true,
      severityFilter: DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
      selectedDiagnosticKey: null,
      hoveredDiagnosticKey: null
    }
  );
  assert.equal(projCutHidden.hiddenByLayerCount, 1);
  const cutErrProj = projCutHidden.visibleItems.find(v => v.resolved.source.id === 'd-cut-err');
  assert.ok(cutErrProj);
  assert.equal(cutErrProj.hiddenHostLayer, 'cut');

  // With Sew & Cut visible at zoom=2: d-sew-crit and d-sew-warn cluster deterministically with highest severity winning
  const projSewVisible = projectDiagnosticsForCanvas(
    resolved,
    DEFAULT_BOARD_OFFSETS,
    { showSewLines: true, showSeamAllowance: true },
    { zoom: 2, panX: 0, panY: 0 },
    { yAxisDirection: 'svg-y-down' },
    { width: 1200, height: 800 },
    {
      showOverlay: true,
      severityFilter: DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
      selectedDiagnosticKey: null,
      hoveredDiagnosticKey: null
    }
  );
  const clustered = projSewVisible.clusters.find(c => c.members.length === 2);
  assert.ok(clustered, 'Expected close sew markers to cluster in screen space');
  assert.equal(clustered.highestSeverity, 'CRITICAL_BLOCKING');
  assert.equal(clustered.primaryMember.resolved.source.id, 'd-sew-crit');

  // Board movement re-projects the EXACT SAME resolved object without artifact-level remapping
  const movedOffsets: Readonly<Record<string, BoardPieceOffsetVisibility>> = {
    'piece-front': { offsetXCm: 35, offsetYCm: 20, visible: true }
  };
  const projMoved = projectDiagnosticsForCanvas(
    resolved,
    movedOffsets,
    { showSewLines: true, showSeamAllowance: true },
    { zoom: 1, panX: 0, panY: 0 },
    { yAxisDirection: 'svg-y-down' },
    { width: 1200, height: 800 },
    {
      showOverlay: true,
      severityFilter: DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
      selectedDiagnosticKey: null,
      hoveredDiagnosticKey: null
    }
  );
  const movedCrit = projMoved.visibleItems.find(v => v.resolved.source.id === 'd-sew-crit')!;
  const origCrit = projSewVisible.visibleItems.find(v => v.resolved.source.id === 'd-sew-crit')!;
  assert.equal(movedCrit.boardAnchorCm.x - origCrit.boardAnchorCm.x, 25);
  assert.equal(movedCrit.boardAnchorCm.y - origCrit.boardAnchorCm.y, 15);
  assert.equal(clusterProjectedDiagnostics([], 18).length, 0);
});
