/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_PX_PER_CM,
  MAX_CAD_ZOOM,
  MIN_CAD_ZOOM,
  CadCamera,
  clampCadZoom,
  computeAdaptiveGridSpacingCm,
  computeAutoTableLayoutCm,
  computeFitCameraCm,
  generateRulerTicks,
  getPixelsPerCm,
  panCadByScreenDelta,
  screenToWorldCm,
  worldCmToScreen,
  zoomCadAtScreenPoint
} from '../cad-math';

test('UX-2.3.1 cad-math: zoom clamping enforces consistent bounds [0.15, 12.0]', () => {
  assert.equal(clampCadZoom(Number.NaN), 1.0);
  assert.equal(clampCadZoom(Number.POSITIVE_INFINITY), 1.0);
  assert.equal(clampCadZoom(0.01), MIN_CAD_ZOOM);
  assert.equal(clampCadZoom(-5), MIN_CAD_ZOOM);
  assert.equal(clampCadZoom(42), MAX_CAD_ZOOM);
  assert.equal(clampCadZoom(1.5), 1.5);
  assert.equal(getPixelsPerCm(1.0), BASE_PX_PER_CM);
  assert.equal(getPixelsPerCm(2.5), 25);
});

test('UX-2.3.1 cad-math: worldCm <-> screenPx round-trip is exact for both Y-down SVG and Y-up Cartesian frames', () => {
  const frames = [
    { yAxisDirection: 'svg-y-down' as const },
    { yAxisDirection: 'cartesian-y-up' as const }
  ];
  const cameras: CadCamera[] = [
    { zoom: 0.15, panX: 120, panY: 310 },
    { zoom: 1.0, panX: 48, panY: 48 },
    { zoom: 3.75, panX: -240.5, panY: 615.25 },
    { zoom: 12.0, panX: 500, panY: -120 }
  ];
  const samplePoints = [
    { x: 0, y: 0 },
    { x: 24.5, y: 68.25 },
    { x: -12.4, y: 41.8 },
    { x: 105.125, y: -33.75 }
  ];

  for (const frame of frames) {
    for (const cam of cameras) {
      for (const pt of samplePoints) {
        const screen = worldCmToScreen(pt, cam, frame);
        const recovered = screenToWorldCm(screen, cam, frame);
        assert.ok(
          Math.abs(recovered.x - pt.x) < 1e-4,
          `X mismatch for ${frame.yAxisDirection} zoom=${cam.zoom}: got ${recovered.x} expected ${pt.x}`
        );
        assert.ok(
          Math.abs(recovered.y - pt.y) < 1e-4,
          `Y mismatch for ${frame.yAxisDirection} zoom=${cam.zoom}: got ${recovered.y} expected ${pt.y}`
        );
      }
    }
  }

  // Verify explicit Y-axis sign inversion between Y-down and Y-up
  const cam: CadCamera = { zoom: 1.0, panX: 100, panY: 200 };
  const sDown = worldCmToScreen({ x: 10, y: 15 }, cam, { yAxisDirection: 'svg-y-down' });
  const sUp = worldCmToScreen({ x: 10, y: 15 }, cam, { yAxisDirection: 'cartesian-y-up' });
  assert.equal(sDown.x, 200);
  assert.equal(sDown.y, 350);
  assert.equal(sUp.x, 200);
  assert.equal(sUp.y, 50);
});

test('UX-2.3.1 cad-math: cursor-anchored zoom preserves exact world cm point under cursor in both frames', () => {
  const anchor = { x: 412, y: 287 };
  const initialCam: CadCamera = { zoom: 1.25, panX: 84, panY: 360 };

  for (const yAxisDirection of ['svg-y-down', 'cartesian-y-up'] as const) {
    const frame = { yAxisDirection };
    const worldBefore = screenToWorldCm(anchor, initialCam, frame);
    const zoomedIn = zoomCadAtScreenPoint(initialCam, 3.4, anchor, frame);
    const worldAfterIn = screenToWorldCm(anchor, zoomedIn, frame);
    const zoomedOut = zoomCadAtScreenPoint(zoomedIn, 0.35, anchor, frame);
    const worldAfterOut = screenToWorldCm(anchor, zoomedOut, frame);

    assert.ok(Math.abs(worldAfterIn.x - worldBefore.x) < 1e-4);
    assert.ok(Math.abs(worldAfterIn.y - worldBefore.y) < 1e-4);
    assert.ok(Math.abs(worldAfterOut.x - worldBefore.x) < 1e-4);
    assert.ok(Math.abs(worldAfterOut.y - worldBefore.y) < 1e-4);
  }
});

test('UX-2.3.1 cad-math: pan delta translates screen projection cleanly', () => {
  const cam: CadCamera = { zoom: 2.0, panX: 50, panY: 80 };
  const panned = panCadByScreenDelta(cam, 35, -20);
  assert.equal(panned.zoom, 2.0);
  assert.equal(panned.panX, 85);
  assert.equal(panned.panY, 60);
});

test('UX-2.3.1 cad-math: computeFitCameraCm centers and fits bounds within padding for both Y-down and Y-up', () => {
  const bounds = { minX: 0, minY: 0, maxX: 80, maxY: 65 };
  const vw = 1000;
  const vh = 700;
  const pad = 50;

  for (const yAxisDirection of ['svg-y-down', 'cartesian-y-up'] as const) {
    const frame = { yAxisDirection };
    const cam = computeFitCameraCm(bounds, vw, vh, frame, pad);
    const corners = [
      worldCmToScreen({ x: bounds.minX, y: bounds.minY }, cam, frame),
      worldCmToScreen({ x: bounds.maxX, y: bounds.maxY }, cam, frame)
    ];
    const minSx = Math.min(corners[0].x, corners[1].x);
    const maxSx = Math.max(corners[0].x, corners[1].x);
    const minSy = Math.min(corners[0].y, corners[1].y);
    const maxSy = Math.max(corners[0].y, corners[1].y);

    assert.ok(minSx >= pad - 0.5, `minSx ${minSx} violated padding`);
    assert.ok(maxSx <= vw - pad + 0.5, `maxSx ${maxSx} violated padding`);
    assert.ok(minSy >= pad - 0.5, `minSy ${minSy} violated padding`);
    assert.ok(maxSy <= vh - pad + 0.5, `maxSy ${maxSy} violated padding`);

    // Center of bounds maps to center of viewport
    const center = worldCmToScreen({ x: 40, y: 32.5 }, cam, frame);
    assert.ok(Math.abs(center.x - vw / 2) < 0.5);
    assert.ok(Math.abs(center.y - vh / 2) < 0.5);
  }
});

test('UX-2.3.1 cad-math: computeAutoTableLayoutCm places arbitrary pieces side-by-side without overlap', () => {
  const layout = computeAutoTableLayoutCm(
    [
      { pieceId: 'p1', boundingBoxCm: { minX: -2, minY: 0, maxX: 24, maxY: 45, widthCm: 26, heightCm: 45 } },
      { pieceId: 'p2', boundingBoxCm: { minX: 0, minY: 0, maxX: 25, maxY: 44, widthCm: 25, heightCm: 44 } },
      { pieceId: 'p3', boundingBoxCm: { minX: -18, minY: 0, maxX: 18, maxY: 60, widthCm: 36, heightCm: 60 } },
      { pieceId: 'p4', boundingBoxCm: { minX: 0, minY: 0, maxX: 20, maxY: 30, widthCm: 20, heightCm: 30 } }
    ],
    6
  );

  assert.equal(layout.placements.length, 4);
  for (let i = 1; i < layout.placements.length; i++) {
    const prev = layout.placements[i - 1].boundsCm;
    const curr = layout.placements[i].boundsCm;
    assert.ok(
      curr.minX >= prev.maxX + 6 - 1e-4,
      `Piece ${i} overlaps previous piece: ${curr.minX} vs ${prev.maxX}`
    );
  }
  assert.ok(layout.unionBoundsCm !== null);
  assert.equal(layout.unionBoundsCm?.minX, 0);
  assert.equal(layout.unionBoundsCm?.maxY, 60);
});

test('UX-2.3.1 cad-math: adaptive grid spacing and synchronized ruler ticks align exactly with worldCmToScreen', () => {
  const lowZoomGrid = computeAdaptiveGridSpacingCm(0.2);
  const midZoomGrid = computeAdaptiveGridSpacingCm(1.0);
  const highZoomGrid = computeAdaptiveGridSpacingCm(8.0);

  assert.ok(lowZoomGrid.minorCm > midZoomGrid.minorCm);
  assert.ok(midZoomGrid.minorCm > highZoomGrid.minorCm);
  assert.ok(lowZoomGrid.minorPx >= 14);
  assert.ok(midZoomGrid.minorPx >= 14);
  assert.ok(highZoomGrid.minorPx >= 14);

  const cam: CadCamera = { zoom: 1.5, panX: 120, panY: 420 };
  for (const yAxisDirection of ['svg-y-down', 'cartesian-y-up'] as const) {
    const frame = { yAxisDirection };
    const xTicks = generateRulerTicks('x', 800, cam, frame);
    const yTicks = generateRulerTicks('y', 600, cam, frame);
    assert.ok(xTicks.length > 5);
    assert.ok(yTicks.length > 5);
    assert.ok(xTicks.some(t => t.isMajor && t.label === '0'));
    assert.ok(yTicks.some(t => t.isMajor && t.label === '0'));

    for (const tick of xTicks) {
      const expectedPx = worldCmToScreen({ x: tick.valueCm, y: 0 }, cam, frame).x;
      assert.ok(Math.abs(tick.screenPx - expectedPx) <= 0.05);
    }
    for (const tick of yTicks) {
      const expectedPx = worldCmToScreen({ x: 0, y: tick.valueCm }, cam, frame).y;
      assert.ok(Math.abs(tick.screenPx - expectedPx) <= 0.05);
    }
  }
});
