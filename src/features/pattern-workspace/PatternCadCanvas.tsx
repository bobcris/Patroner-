/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BASE_PX_PER_CM,
  CadCamera,
  CadCoordinateProjection,
  CadRectCm,
  clampCadZoom,
  computeAdaptiveGridSpacingCm,
  computeAutoTableLayoutCm,
  computeFitCameraCm,
  getPixelsPerCm,
  panCadByScreenDelta,
  screenToWorldCm,
  zoomCadAtScreenPoint
} from './cad-math';
import { CadRulers, RULER_THICKNESS_PX } from './CadRulers';
import type {
  PatternArtifactBundle,
  PatternPieceRenderModel,
  RenderCurveSegment,
  RenderPoint2D
} from './contracts/pattern-render-artifact';
import type { PatternCadLayerVisibility, PatternCadViewMode } from './PatternAtelierViewContext';
import type { BodiceSleeveAssemblyResult } from '../../engine/assembly';
import { formatSignedCm } from '../../engine/assembly';
import { DEFAULT_SIZE_RANGE } from '../../engine/grading';
import type { GradedPatternSet } from '../../engine/grading';
import type { FitValidationReport, PhysicalPrototypeRecord } from '../../engine/prototype/prototype-types';

const SIZE_PALETTE: Record<string, { stroke: string; label: string }> = {
  XS: { stroke: '#9333ea', label: 'XS (EU 34)' },
  S: { stroke: '#2563eb', label: 'S (EU 36)' },
  M: { stroke: '#16a34a', label: 'M (EU 38 - Base)' },
  L: { stroke: '#d97706', label: 'L (EU 40)' },
  XL: { stroke: '#dc2626', label: 'XL (EU 42)' },
  XXL: { stroke: '#7c3aed', label: 'XXL (EU 44)' }
};

function segmentsToSvgPath(segments: readonly RenderCurveSegment[], fallbackPath?: string): string {
  if (segments.length === 0) return fallbackPath ?? '';
  const parts: string[] = [];
  parts.push(`M ${segments[0].p0.x} ${segments[0].p0.y}`);
  for (const seg of segments) {
    if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
      parts.push(`C ${seg.p1.x} ${seg.p1.y}, ${seg.p2.x} ${seg.p2.y}, ${seg.p3.x} ${seg.p3.y}`);
    } else {
      parts.push(`L ${seg.p3.x} ${seg.p3.y}`);
    }
  }
  parts.push('Z');
  return parts.join(' ');
}

export interface PatternCadCanvasProps {
  readonly artifact: PatternArtifactBundle;
  readonly activeSize: string;
  readonly effectiveViewMode: Exclude<PatternCadViewMode, 'simulation'>;
  readonly selectedPieceId: string | null;
  readonly onSelectPieceId: (pieceId: string) => void;
  readonly activeTool: string;
  readonly showGrid: boolean;
  readonly layerVisibility: PatternCadLayerVisibility;
  readonly camera: CadCamera;
  readonly onChangeCamera: (next: CadCamera) => void;
  readonly fitRequestVersion: number;
  readonly cursorCm: RenderPoint2D | null;
  readonly onChangeCursorCm: (pt: RenderPoint2D | null) => void;
  readonly assemblyResult?: BodiceSleeveAssemblyResult;
  readonly gradedPatternSet?: GradedPatternSet;
  readonly enabledGradingSizes: Readonly<Record<string, boolean>>;
  readonly activePrototypeRecord: PhysicalPrototypeRecord;
  readonly activePrototypeReport: FitValidationReport;
  readonly layoutResetKey: string;
}

/**
 * UX-2.3.1 — Full-Bleed Interactive 2D CAD Canvas for Pattern Atelier.
 *
 * Pure presentation & viewport interaction layer:
 * - Synchronized horizontal/vertical centimeter rulers (`CadRulers`).
 * - Adaptive centimeter grid scaled and phase-aligned with the camera.
 * - Cursor-anchored wheel zoom (`0.15x..12.0x`) and smooth pan (`Pan` tool,
 *   `Space+Drag`, `Middle-Drag`, or dragging empty canvas background).
 * - Explicit support for both Y-down SVG and Y-up Cartesian coordinate frames.
 * - Strictly read-only geometry rendering; never performs authoritative pattern math.
 */
export const PatternCadCanvas: React.FC<PatternCadCanvasProps> = ({
  artifact,
  activeSize,
  effectiveViewMode,
  selectedPieceId,
  onSelectPieceId,
  activeTool,
  showGrid,
  layerVisibility,
  camera,
  onChangeCamera,
  fitRequestVersion,
  cursorCm,
  onChangeCursorCm,
  assemblyResult,
  gradedPatternSet,
  enabledGradingSizes,
  activePrototypeRecord,
  activePrototypeReport,
  layoutResetKey
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0
  });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const cameraRef = useRef<CadCamera>(camera);
  cameraRef.current = camera;

  const panSessionRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCamera: CadCamera;
  } | null>(null);

  const projection: CadCoordinateProjection = useMemo(
    () => ({
      yAxisDirection: artifact.coordinateFrame.yAxisDirection,
      basePxPerCm: BASE_PX_PER_CM
    }),
    [artifact.coordinateFrame.yAxisDirection]
  );

  // Deterministic cm-native cutting-table placement for pieces
  const tableLayout = useMemo(
    () => computeAutoTableLayoutCm(artifact.pieces, 8),
    [artifact.pieces]
  );

  const placementByPieceId = useMemo(() => {
    const map = new Map<string, { offsetXCm: number; offsetYCm: number }>();
    for (const p of tableLayout.placements) {
      map.set(p.pieceId, { offsetXCm: p.offsetXCm, offsetYCm: p.offsetYCm });
    }
    return map;
  }, [tableLayout.placements]);

  // Mode-aware world bounds (cm) for Fit All framing
  const activeBoundsCm: CadRectCm | null = useMemo(() => {
    if (effectiveViewMode === 'assembly' && assemblyResult?.inspectionLayout) {
      const backTx = assemblyResult.inspectionLayout.backAssembly.bodice.translation.x;
      return {
        minX: -12,
        minY: -10,
        maxX: Math.max(95, backTx + 55),
        maxY: 68
      };
    }
    if (effectiveViewMode === 'grading' && gradedPatternSet) {
      return {
        minX: -4,
        minY: -8,
        maxX: 138,
        maxY: 74
      };
    }
    return tableLayout.unionBoundsCm;
  }, [effectiveViewMode, assemblyResult, gradedPatternSet, tableLayout.unionBoundsCm]);

  // Observe full-bleed stage inner dimensions (excluding 24px rulers)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const innerW = Math.max(120, Math.round(rect.width - RULER_THICKNESS_PX));
      const innerH = Math.max(120, Math.round(rect.height - RULER_THICKNESS_PX));
      setViewportSize(prev =>
        prev.width === innerW && prev.height === innerH ? prev : { width: innerW, height: innerH }
      );
    };

    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateSize);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Spacebar temporary hand-pan shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !e.repeat &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)
      ) {
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    const onBlur = () => setSpacePressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Fit All when explicitly requested, garment changes, mode changes, or initial size measured
  const lastFitSigRef = useRef<string>('');
  useEffect(() => {
    if (!activeBoundsCm || viewportSize.width < 120 || viewportSize.height < 120) return;
    const sig = `${fitRequestVersion}::${layoutResetKey}::${effectiveViewMode}`;
    if (lastFitSigRef.current === sig) return;
    lastFitSigRef.current = sig;

    const fitCam = computeFitCameraCm(
      activeBoundsCm,
      viewportSize.width,
      viewportSize.height,
      projection,
      44
    );
    onChangeCamera(fitCam);
  }, [
    activeBoundsCm,
    fitRequestVersion,
    layoutResetKey,
    effectiveViewMode,
    viewportSize.width,
    viewportSize.height,
    projection,
    onChangeCamera
  ]);

  // Cursor-anchored wheel zoom & trackpad pan (non-passive listener so page never scrolls)
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const stageEl = stageRef.current;
    if (!stageEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stageEl.getBoundingClientRect();
      const anchor = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };

      // Shift+wheel pans horizontally/vertically; standard wheel or ctrl+pinch zooms at cursor
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        onChangeCamera(panCadByScreenDelta(cameraRef.current, -e.deltaX - e.deltaY, 0));
        return;
      }

      const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextZoom = clampCadZoom(cameraRef.current.zoom * zoomFactor);
      const nextCam = zoomCadAtScreenPoint(cameraRef.current, nextZoom, anchor, projection);
      onChangeCamera(nextCam);
    };

    stageEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => stageEl.removeEventListener('wheel', handleWheel);
  }, [projection, onChangeCamera]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | SVGElement | null;
      const clickedPiece = target?.closest?.('[data-cad-piece-id]');
      const shouldPan =
        e.button === 1 ||
        activeTool === 'pan' ||
        spacePressed ||
        (e.button === 0 && !clickedPiece);

      if (!shouldPan) return;

      e.preventDefault();
      panSessionRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCamera: cameraRef.current
      };
      setIsPanning(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer events in tests may not have native capture handles
      }
    },
    [activeTool, spacePressed]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const localPx = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };

      const session = panSessionRef.current;
      if (session && session.pointerId === e.pointerId) {
        const dx = e.clientX - session.startClientX;
        const dy = e.clientY - session.startClientY;
        const nextCam = panCadByScreenDelta(session.startCamera, dx, dy);
        onChangeCamera(nextCam);
        onChangeCursorCm(screenToWorldCm(localPx, nextCam, projection));
        return;
      }

      onChangeCursorCm(screenToWorldCm(localPx, cameraRef.current, projection));
    },
    [onChangeCamera, onChangeCursorCm, projection]
  );

  const handlePointerUpOrCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (panSessionRef.current && panSessionRef.current.pointerId === e.pointerId) {
      panSessionRef.current = null;
      setIsPanning(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Safe no-op
      }
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (!panSessionRef.current) {
      onChangeCursorCm(null);
    }
  }, [onChangeCursorCm]);

  const scalePxPerCm = getPixelsPerCm(camera.zoom, BASE_PX_PER_CM);
  const gridSpacing = useMemo(
    () => computeAdaptiveGridSpacingCm(camera.zoom, BASE_PX_PER_CM),
    [camera.zoom]
  );

  const isYUp = artifact.coordinateFrame.yAxisDirection === 'cartesian-y-up';
  const worldTransform = isYUp
    ? `translate(${camera.panX}, ${camera.panY}) scale(${scalePxPerCm}, ${-scalePxPerCm})`
    : `translate(${camera.panX}, ${camera.panY}) scale(${scalePxPerCm})`;

  // Constant visual stroke weight in cm units so lines remain crisp at all zoom levels
  const invScale = 1 / Math.max(0.5, scalePxPerCm);
  const cutStrokeCm = 1.5 * invScale;
  const sewStrokeCm = 1.0 * invScale;
  const thinStrokeCm = 0.9 * invScale;
  const labelFontCm = Math.max(1.2, 11 * invScale);
  const subLabelFontCm = Math.max(0.95, 9 * invScale);

  const panCursorClass = isPanning
    ? 'cursor-grabbing'
    : activeTool === 'pan' || spacePressed
      ? 'cursor-grab'
      : 'cursor-crosshair';

  const renderStandardPiece = (piece: PatternPieceRenderModel) => {
    const placement = placementByPieceId.get(piece.pieceId) ?? { offsetXCm: 0, offsetYCm: 0 };
    const isSelected = selectedPieceId === piece.pieceId;
    const cutD = segmentsToSvgPath(piece.cutSegments, piece.fallbackCutSvgPath);
    const sewD = segmentsToSvgPath(piece.sewSegments, piece.fallbackSewSvgPath);

    const centerX = piece.boundingBoxCm.minX + piece.boundingBoxCm.widthCm * 0.5;
    const labelY = piece.boundingBoxCm.minY + piece.boundingBoxCm.heightCm * 0.34;
    let visMinX = piece.boundingBoxCm.minX;
    let visMinY = piece.boundingBoxCm.minY;
    let visMaxX = piece.boundingBoxCm.maxX;
    let visMaxY = piece.boundingBoxCm.maxY;
    for (const seg of piece.cutSegments) {
      const pts = seg.p1 && seg.p2 ? [seg.p0, seg.p1, seg.p2, seg.p3] : [seg.p0, seg.p3];
      for (const pt of pts) {
        if (pt.x < visMinX) visMinX = pt.x;
        if (pt.y < visMinY) visMinY = pt.y;
        if (pt.x > visMaxX) visMaxX = pt.x;
        if (pt.y > visMaxY) visMaxY = pt.y;
      }
    }
    const labelBoxW = Math.max(12, subLabelFontCm * 15.5);
    const labelBoxH = layerVisibility.showDimensions ? labelFontCm * 4.2 : labelFontCm * 3.0;

    return (
      <g
        key={piece.pieceId}
        data-cad-piece-id={piece.pieceId}
        data-testid={`cad-piece-${piece.pieceId}`}
        transform={`translate(${placement.offsetXCm}, ${placement.offsetYCm})`}
        onClick={e => {
          if (activeTool === 'pan' || spacePressed) return;
          e.stopPropagation();
          onSelectPieceId(piece.pieceId);
        }}
        className="cursor-pointer"
        opacity={isSelected ? 1 : 0.88}
      >
        {/* Bounding box guide framed around full cut+sew geometry */}
        {layerVisibility.showDimensions && isSelected && (
          <rect
            x={visMinX - 0.8}
            y={visMinY - 0.8}
            width={visMaxX - visMinX + 1.6}
            height={visMaxY - visMinY + 1.6}
            fill="none"
            stroke="#64748b"
            strokeWidth={0.8 * invScale}
            strokeDasharray={`${3 * invScale} ${2.5 * invScale}`}
          />
        )}

        {/* Exterior Cut Line */}
        {layerVisibility.showSeamAllowance && cutD && (
          <path
            d={cutD}
            fill={
              isSelected
                ? piece.hasBlockingError
                  ? '#FEF2F2'
                  : '#FFFFFF'
                : piece.hasBlockingError
                  ? '#FFF5F5'
                  : '#FAF8F4'
            }
            stroke={piece.hasBlockingError ? '#dc2626' : isSelected ? '#0f172a' : '#52525b'}
            strokeWidth={piece.hasBlockingError ? 2.1 * invScale : isSelected ? 1.8 * invScale : cutStrokeCm}
            strokeDasharray={piece.hasBlockingError ? `${5 * invScale} ${2.5 * invScale}` : undefined}
            strokeLinejoin="round"
          />
        )}

        {/* Interior Stitch Line */}
        {layerVisibility.showSewLines && sewD && (
          <path
            d={sewD}
            fill="none"
            stroke={isSelected ? '#2563eb' : '#64748b'}
            strokeWidth={sewStrokeCm}
            strokeDasharray={`${4 * invScale} ${2.5 * invScale}`}
          />
        )}

        {/* Darts */}
        {layerVisibility.showDarts &&
          piece.darts.map(dart => (
            <g key={dart.id}>
              <line
                x1={dart.legLeft.x}
                y1={dart.legLeft.y}
                x2={dart.apex.x}
                y2={dart.apex.y}
                stroke="#dc2626"
                strokeWidth={sewStrokeCm}
              />
              <line
                x1={dart.legRight.x}
                y1={dart.legRight.y}
                x2={dart.apex.x}
                y2={dart.apex.y}
                stroke="#dc2626"
                strokeWidth={sewStrokeCm}
              />
              <circle cx={dart.apex.x} cy={dart.apex.y} r={2.5 * invScale} fill="#dc2626" />
            </g>
          ))}

        {/* Grainline */}
        {layerVisibility.showGrainline && piece.grainline && (
          <g>
            <line
              x1={piece.grainline.start.x}
              y1={piece.grainline.start.y}
              x2={piece.grainline.end.x}
              y2={piece.grainline.end.y}
              stroke="#18181b"
              strokeWidth={thinStrokeCm}
            />
            <polygon
              points={`${piece.grainline.start.x},${piece.grainline.start.y - 0.9} ${piece.grainline.start.x - 0.55},${piece.grainline.start.y + 0.7} ${piece.grainline.start.x + 0.55},${piece.grainline.start.y + 0.7}`}
              fill="#18181b"
            />
            <polygon
              points={`${piece.grainline.end.x},${piece.grainline.end.y + 0.9} ${piece.grainline.end.x - 0.55},${piece.grainline.end.y - 0.7} ${piece.grainline.end.x + 0.55},${piece.grainline.end.y - 0.7}`}
              fill="#18181b"
            />
          </g>
        )}

        {/* Notches */}
        {layerVisibility.showNotches &&
          piece.notches.map(n => (
            <g key={n.id}>
              <line
                x1={n.position.x - 0.75}
                y1={n.position.y}
                x2={n.position.x + 0.75}
                y2={n.position.y}
                stroke="#16a34a"
                strokeWidth={1.4 * invScale}
              />
              {n.notchType === 'double' && (
                <line
                  x1={n.position.x - 0.75}
                  y1={n.position.y + 0.75}
                  x2={n.position.x + 0.75}
                  y2={n.position.y + 0.75}
                  stroke="#16a34a"
                  strokeWidth={1.4 * invScale}
                />
              )}
            </g>
          ))}

        {/* Piece Identification Labels (upright in both Y-down and Y-up frames, paper-backed to clear grainline) */}
        <g
          transform={
            isYUp ? `translate(${centerX}, ${labelY}) scale(1, -1)` : `translate(${centerX}, ${labelY})`
          }
        >
          <rect
            x={-labelBoxW / 2}
            y={-labelFontCm * 1.05}
            width={labelBoxW}
            height={labelBoxH}
            rx={0.35}
            fill={isSelected ? '#FFFFFF' : '#FAF8F4'}
            fillOpacity="0.94"
          />
          <text
            x={0}
            y={0}
            textAnchor="middle"
            fontSize={labelFontCm}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontWeight="700"
            fill="#18181b"
          >
            {piece.pieceCode}
          </text>
          <text
            x={0}
            y={labelFontCm * 1.35}
            textAnchor="middle"
            fontSize={subLabelFontCm}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fill="#52525b"
          >
            {piece.onFold ? 'CUT 1 ON FOLD' : `CUT ${piece.cutCount}`} · SIZE {activeSize}
          </text>
          {layerVisibility.showDimensions && (
            <text
              x={0}
              y={labelFontCm * 2.55}
              textAnchor="middle"
              fontSize={subLabelFontCm * 0.92}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill="#71717a"
            >
              {piece.boundingBoxCm.widthCm.toFixed(1)} × {piece.boundingBoxCm.heightCm.toFixed(1)} cm
            </text>
          )}
          {piece.hasBlockingError && (
            <text
              x={0}
              y={-labelFontCm * 1.2}
              textAnchor="middle"
              fontSize={subLabelFontCm}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight="700"
              fill="#dc2626"
            >
              GEOMETRY ERROR
            </text>
          )}
        </g>
      </g>
    );
  };

  return (
    <div
      ref={containerRef}
      data-testid="pattern-cad-canvas-container"
      className="flex-1 min-h-0 relative overflow-hidden bg-[#F7F5F0] select-none"
    >
      {/* Synchronized Centimeter Rulers */}
      <CadRulers
        viewportWidthPx={viewportSize.width}
        viewportHeightPx={viewportSize.height}
        camera={camera}
        projection={projection}
        cursorCm={cursorCm}
      />

      {/* Interactive Drawing Surface (inset by 24px rulers) */}
      <div
        ref={stageRef}
        data-testid="pattern-cad-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onPointerLeave={handlePointerLeave}
        className={`absolute right-0 bottom-0 overflow-hidden touch-none ${panCursorClass}`}
        style={{ left: RULER_THICKNESS_PX, top: RULER_THICKNESS_PX }}
      >
        <svg
          data-testid="pattern-cad-svg"
          width={Math.max(1, viewportSize.width)}
          height={Math.max(1, viewportSize.height)}
          className="block w-full h-full"
        >
          {/* Adaptive Centimeter Grid synchronized with camera */}
          {showGrid && (
            <g data-testid="cad-adaptive-grid" aria-hidden="true">
              <defs>
                <pattern
                  id="cad-adaptive-grid-minor"
                  width={gridSpacing.minorPx}
                  height={gridSpacing.minorPx}
                  patternUnits="userSpaceOnUse"
                  patternTransform={`translate(${camera.panX}, ${camera.panY})`}
                >
                  <path
                    d={`M ${gridSpacing.minorPx} 0 L 0 0 0 ${gridSpacing.minorPx}`}
                    fill="none"
                    stroke="#d6d3cb"
                    strokeWidth="0.6"
                  />
                </pattern>
                <pattern
                  id="cad-adaptive-grid-major"
                  width={gridSpacing.majorPx}
                  height={gridSpacing.majorPx}
                  patternUnits="userSpaceOnUse"
                  patternTransform={`translate(${camera.panX}, ${camera.panY})`}
                >
                  <path
                    d={`M ${gridSpacing.majorPx} 0 L 0 0 0 ${gridSpacing.majorPx}`}
                    fill="none"
                    stroke="#bdb8ac"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#cad-adaptive-grid-minor)" />
              <rect width="100%" height="100%" fill="url(#cad-adaptive-grid-major)" />

              {/* World Origin Axes (0 cm, 0 cm) */}
              <line
                x1={camera.panX}
                y1={0}
                x2={camera.panX}
                y2={viewportSize.height}
                stroke="#94a3b8"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <line
                x1={0}
                y1={camera.panY}
                x2={viewportSize.width}
                y2={camera.panY}
                stroke="#94a3b8"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            </g>
          )}

          {/* World-Space Centimeter Geometry Stage */}
          <g data-testid="cad-world-stage" transform={worldTransform}>
            {effectiveViewMode === 'assembly' && assemblyResult?.inspectionLayout ? (
              <g data-testid="cad-mode-assembly">
                {/* Front Assembly */}
                <g>
                  <path
                    d={assemblyResult.inspectionLayout.frontAssembly.bodice.transformedCutSvgPath}
                    fill="#FFFFFF"
                    stroke="#09090b"
                    strokeWidth={cutStrokeCm}
                  />
                  <path
                    d={assemblyResult.inspectionLayout.frontAssembly.bodice.transformedSewSvgPath}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={sewStrokeCm}
                    strokeDasharray={`${3 * invScale} ${2 * invScale}`}
                  />
                  {assemblyResult.inspectionLayout.frontAssembly.bodice.transformedNotches.map(n => (
                    <line
                      key={n.id}
                      x1={n.position.x - 0.8}
                      y1={n.position.y}
                      x2={n.position.x + 0.8}
                      y2={n.position.y}
                      stroke="#16a34a"
                      strokeWidth={1.3 * invScale}
                    />
                  ))}
                  <path
                    d={assemblyResult.inspectionLayout.frontAssembly.sleeve.transformedCutSvgPath}
                    fill="#EFF6FF"
                    fillOpacity="0.45"
                    stroke="#1d4ed8"
                    strokeWidth={cutStrokeCm}
                  />
                  <path
                    d={assemblyResult.inspectionLayout.frontAssembly.sleeve.transformedSewSvgPath}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={sewStrokeCm}
                    strokeDasharray={`${3 * invScale} ${2 * invScale}`}
                  />
                  {assemblyResult.inspectionLayout.frontAssembly.sleeve.transformedNotches.map(n => (
                    <line
                      key={n.id}
                      x1={n.position.x - 0.8}
                      y1={n.position.y}
                      x2={n.position.x + 0.8}
                      y2={n.position.y}
                      stroke="#16a34a"
                      strokeWidth={1.3 * invScale}
                    />
                  ))}
                  <text
                    x={4}
                    y={-4.5}
                    fontSize={labelFontCm}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight="700"
                    fill="#1e3a8a"
                  >
                    FRONT SCYE ASSEMBLY · {formatSignedCm(assemblyResult.ease.frontEaseCm)}
                  </text>
                </g>

                {/* Back Assembly */}
                <g>
                  <path
                    d={assemblyResult.inspectionLayout.backAssembly.bodice.transformedCutSvgPath}
                    fill="#FFFFFF"
                    stroke="#09090b"
                    strokeWidth={cutStrokeCm}
                  />
                  <path
                    d={assemblyResult.inspectionLayout.backAssembly.bodice.transformedSewSvgPath}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={sewStrokeCm}
                    strokeDasharray={`${3 * invScale} ${2 * invScale}`}
                  />
                  {assemblyResult.inspectionLayout.backAssembly.bodice.transformedNotches.map(n => (
                    <line
                      key={n.id}
                      x1={n.position.x - 0.8}
                      y1={n.position.y}
                      x2={n.position.x + 0.8}
                      y2={n.position.y}
                      stroke="#16a34a"
                      strokeWidth={1.3 * invScale}
                    />
                  ))}
                  <path
                    d={assemblyResult.inspectionLayout.backAssembly.sleeve.transformedCutSvgPath}
                    fill="#EFF6FF"
                    fillOpacity="0.45"
                    stroke="#1d4ed8"
                    strokeWidth={cutStrokeCm}
                  />
                  <path
                    d={assemblyResult.inspectionLayout.backAssembly.sleeve.transformedSewSvgPath}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={sewStrokeCm}
                    strokeDasharray={`${3 * invScale} ${2 * invScale}`}
                  />
                  {assemblyResult.inspectionLayout.backAssembly.sleeve.transformedNotches.map(n => (
                    <line
                      key={n.id}
                      x1={n.position.x - 0.8}
                      y1={n.position.y}
                      x2={n.position.x + 0.8}
                      y2={n.position.y}
                      stroke="#16a34a"
                      strokeWidth={1.3 * invScale}
                    />
                  ))}
                  <text
                    x={Math.round(assemblyResult.inspectionLayout.backAssembly.bodice.translation.x + 4)}
                    y={-4.5}
                    fontSize={labelFontCm}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight="700"
                    fill="#1e3a8a"
                  >
                    BACK SCYE ASSEMBLY · {formatSignedCm(assemblyResult.ease.backEaseCm)}
                  </text>
                </g>
              </g>
            ) : effectiveViewMode === 'grading' && gradedPatternSet ? (
              <g data-testid="cad-mode-grading">
                {DEFAULT_SIZE_RANGE.filter(sz => enabledGradingSizes[sz]).map(sz => {
                  const szRes = gradedPatternSet.sizeResults[sz];
                  if (!szRes) return null;
                  const pal = SIZE_PALETTE[sz] ?? { stroke: '#09090b', label: sz };
                  const isBase = sz === gradedPatternSet.baseSize;
                  const fPiece = szRes.bodicePieces.find(
                    p => p.pieceCode.includes('BOD-F') || p.id.includes('front')
                  );
                  const bPiece = szRes.bodicePieces.find(
                    p => p.pieceCode.includes('BOD-B') || p.id.includes('back')
                  );
                  const sPiece = szRes.sleevePiece;

                  return (
                    <g key={sz} id={`nest-layer-${sz}`}>
                      {fPiece && (
                        <g transform="translate(0, 0)">
                          <path
                            d={fPiece.cutPathData}
                            fill={isBase ? '#FFFFFF' : 'none'}
                            fillOpacity={isBase ? 0.4 : 0}
                            stroke={pal.stroke}
                            strokeWidth={isBase ? 1.8 * invScale : 1.1 * invScale}
                            strokeDasharray={isBase ? undefined : `${4 * invScale} ${2 * invScale}`}
                          />
                          {layerVisibility.showSewLines && fPiece.sewPathData && (
                            <path
                              d={fPiece.sewPathData}
                              fill="none"
                              stroke={pal.stroke}
                              strokeWidth={0.7 * invScale}
                              strokeDasharray={`${2.5 * invScale} ${2 * invScale}`}
                              opacity="0.55"
                            />
                          )}
                        </g>
                      )}
                      {bPiece && (
                        <g transform="translate(44, 0)">
                          <path
                            d={bPiece.cutPathData}
                            fill={isBase ? '#FFFFFF' : 'none'}
                            fillOpacity={isBase ? 0.4 : 0}
                            stroke={pal.stroke}
                            strokeWidth={isBase ? 1.8 * invScale : 1.1 * invScale}
                            strokeDasharray={isBase ? undefined : `${4 * invScale} ${2 * invScale}`}
                          />
                          {layerVisibility.showSewLines && bPiece.sewPathData && (
                            <path
                              d={bPiece.sewPathData}
                              fill="none"
                              stroke={pal.stroke}
                              strokeWidth={0.7 * invScale}
                              strokeDasharray={`${2.5 * invScale} ${2 * invScale}`}
                              opacity="0.55"
                            />
                          )}
                        </g>
                      )}
                      {sPiece && (
                        <g transform="translate(96, 0)">
                          <path
                            d={sPiece.cutPathData}
                            fill={isBase ? '#FFFFFF' : 'none'}
                            fillOpacity={isBase ? 0.4 : 0}
                            stroke={pal.stroke}
                            strokeWidth={isBase ? 1.8 * invScale : 1.1 * invScale}
                            strokeDasharray={isBase ? undefined : `${4 * invScale} ${2 * invScale}`}
                          />
                          {layerVisibility.showSewLines && sPiece.sewPathData && (
                            <path
                              d={sPiece.sewPathData}
                              fill="none"
                              stroke={pal.stroke}
                              strokeWidth={0.7 * invScale}
                              strokeDasharray={`${2.5 * invScale} ${2 * invScale}`}
                              opacity="0.55"
                            />
                          )}
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            ) : effectiveViewMode === 'fit' ? (
              <g data-testid="cad-mode-fit">
                {artifact.pieces.map(piece => renderStandardPiece(piece))}
                {/* Physical Caliper Pin Overlay anchored in cm coordinates */}
                <g id="caliper-pins">
                  {activePrototypeReport.measurements.map((pt, idx) => {
                    const p0 = tableLayout.placements[0];
                    const p1 = tableLayout.placements[1] ?? p0;
                    const p2 = tableLayout.placements[2] ?? p1;
                    const baseX =
                      pt.pointId.includes('cb-') || pt.pointId.includes('back-')
                        ? (p1?.boundsCm.minX ?? 34) + 10
                        : pt.pointId.includes('sleeve')
                          ? (p2?.boundsCm.minX ?? 72) + 14
                          : (p0?.boundsCm.minX ?? 0) + 10;
                    const baseY = 8 + (idx % 5) * 9;
                    const pinColor =
                      pt.status === 'pass'
                        ? '#15803d'
                        : pt.status === 'warning'
                          ? '#b45309'
                          : '#b91c1c';

                    return (
                      <g key={pt.pointId} transform={`translate(${baseX}, ${baseY})`}>
                        <circle
                          cx={0}
                          cy={0}
                          r={4.5 * invScale}
                          fill="#ffffff"
                          fillOpacity="0.9"
                          stroke={pinColor}
                          strokeWidth={1.3 * invScale}
                        />
                        <circle cx={0} cy={0} r={1.8 * invScale} fill={pinColor} />
                        <text
                          x={6 * invScale}
                          y={3 * invScale}
                          fontSize={subLabelFontCm}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fontWeight="600"
                          fill={pinColor}
                        >
                          {pt.label} ({pt.deltaCm > 0 ? '+' : ''}
                          {pt.deltaCm.toFixed(2)} cm)
                        </text>
                      </g>
                    );
                  })}
                </g>
              </g>
            ) : (
              <g data-testid="cad-mode-pieces">
                {artifact.pieces.map(piece => renderStandardPiece(piece))}
              </g>
            )}
          </g>
        </svg>

        {/* Quiet Bottom-Left Line Legend */}
        <div
          aria-label="Pattern line legend"
          className="absolute bottom-2.5 left-2.5 bg-white/92 backdrop-blur-xs border border-neutral-300 rounded-xs px-2.5 py-1 text-[10px] font-mono text-neutral-700 flex flex-wrap items-center gap-3 pointer-events-none"
        >
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-neutral-900 inline-block" /> Cut
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0 border-t border-dashed border-blue-600 inline-block" /> Sew
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-red-600 inline-block" /> Dart
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-green-600 inline-block" /> Notch
          </span>
          {effectiveViewMode === 'fit' && (
            <span className="text-amber-900 font-semibold">
              Fixture: {activePrototypeRecord.id}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
