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
import {
  BoardOverlapAdvisory,
  createInitialBoardSnapshot,
  DEFAULT_SNAP_CONFIG,
  evaluateBoardSnapCm,
  expandSelectionWithGroups,
  getBoardUnionBoundsCm,
  getPieceBoardBoundsCm,
  getPieceLocalVisualBoundsCm,
  isPieceEffectivelyVisible,
  PatternBoardSnapshot,
  SnapCandidateGuide,
  SnapConfig
} from './board-arrangement';
import {
  CadInspectableEntity,
  DEFAULT_HIT_RADIUS_PX,
  extractActiveCurveReference,
  extractContourVertices,
  hitTestPatternEntities,
  TOUCH_HIT_RADIUS_PX
} from './entity-hit-test';

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
  // UX-2.3.2 board arrangement props (optional fallbacks preserve standalone compatibility)
  readonly boardState?: PatternBoardSnapshot;
  readonly overlapAdvisories?: readonly BoardOverlapAdvisory[];
  readonly snapConfig?: SnapConfig;
  readonly activeSnapGuides?: readonly SnapCandidateGuide[];
  readonly onSetActiveSnapGuides?: (guides: readonly SnapCandidateGuide[]) => void;
  readonly onSelectBoardPiece?: (pieceId: string, options?: { expandGroup?: boolean }) => void;
  readonly onToggleBoardPiece?: (pieceId: string, options?: { expandGroup?: boolean }) => void;
  readonly onSelectMarqueeRect?: (rectCm: CadRectCm, mode?: 'replace' | 'add') => void;
  readonly onClearBoardSelection?: () => void;
  readonly onCommitMovePieces?: (pieceIds: readonly string[], dxCm: number, dyCm: number) => void;
  readonly onUndoBoard?: () => void;
  readonly onRedoBoard?: () => void;
  readonly onGroupSelected?: () => void;
  readonly onUngroupSelected?: () => void;
  // UX-2.3.3.1 read-only geometric entity inspection props
  readonly hoveredEntity?: CadInspectableEntity | null;
  readonly inspectedEntity?: CadInspectableEntity | null;
  readonly showControlPolygon?: boolean;
  readonly onHoverEntity?: (entity: CadInspectableEntity | null) => void;
  readonly onInspectEntity?: (entity: CadInspectableEntity | null) => void;
}

/**
 * UX-2.3.1 + UX-2.3.2 — Full-Bleed Interactive 2D CAD Canvas for Pattern Atelier.
 *
 * Maintains strict three-layer coordinate separation:
 * 1. Original Pattern Geometry (`artifact.pieces`): strictly read-only, never mutated.
 * 2. CAD Board Placement (`boardState.placementsByPieceId`): ephemeral visual arrangement
 *    offsets, stacking order, visibility, and grouping keyed by stable `pieceId`.
 * 3. Screen Projection (`camera` + `cad-math.ts`): camera pan/zoom never pollutes arrangement undo.
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
  layoutResetKey,
  boardState: externalBoardState,
  overlapAdvisories = [],
  snapConfig = DEFAULT_SNAP_CONFIG,
  activeSnapGuides = [],
  onSetActiveSnapGuides,
  onSelectBoardPiece,
  onToggleBoardPiece,
  onSelectMarqueeRect,
  onClearBoardSelection,
  onCommitMovePieces,
  onUndoBoard,
  onRedoBoard,
  onGroupSelected,
  onUngroupSelected,
  hoveredEntity = null,
  inspectedEntity = null,
  showControlPolygon = true,
  onHoverEntity,
  onInspectEntity
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0
  });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragPreview, setDragPreview] = useState<{
    pieceIds: readonly string[];
    dxCm: number;
    dyCm: number;
  } | null>(null);
  const [marqueePreviewCm, setMarqueePreviewCm] = useState<{
    start: RenderPoint2D;
    current: RenderPoint2D;
  } | null>(null);

  const fallbackBoardState = useMemo(() => createInitialBoardSnapshot(artifact, 8), [artifact]);
  const boardState = externalBoardState ?? fallbackBoardState;

  const cameraRef = useRef<CadCamera>(camera);
  cameraRef.current = camera;
  const boardStateRef = useRef<PatternBoardSnapshot>(boardState);
  boardStateRef.current = boardState;
  const artifactRef = useRef<PatternArtifactBundle>(artifact);
  artifactRef.current = artifact;
  const layerVisibilityRef = useRef<PatternCadLayerVisibility>(layerVisibility);
  layerVisibilityRef.current = layerVisibility;
  const hoveredEntityRef = useRef<CadInspectableEntity | null>(hoveredEntity);
  hoveredEntityRef.current = hoveredEntity;
  const inspectedEntityRef = useRef<CadInspectableEntity | null>(inspectedEntity);
  inspectedEntityRef.current = inspectedEntity;

  const panSessionRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCamera: CadCamera;
  } | null>(null);

  const dragSessionRef = useRef<{
    pointerId: number;
    pieceIds: readonly string[];
    startClientX: number;
    startClientY: number;
    startWorldCm: RenderPoint2D;
    lastSnappedDxCm: number;
    lastSnappedDyCm: number;
    moved: boolean;
  } | null>(null);

  const marqueeSessionRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWorldCm: RenderPoint2D;
    currentWorldCm: RenderPoint2D;
    shiftKey: boolean;
    moved: boolean;
  } | null>(null);

  const projection: CadCoordinateProjection = useMemo(
    () => ({
      yAxisDirection: artifact.coordinateFrame.yAxisDirection,
      basePxPerCm: BASE_PX_PER_CM
    }),
    [artifact.coordinateFrame.yAxisDirection]
  );

  // Fallback auto layout used by Fit mode caliper pins
  const tableLayout = useMemo(
    () => computeAutoTableLayoutCm(artifact.pieces, 8),
    [artifact.pieces]
  );

  const piecesById = useMemo(() => {
    const map = new Map<string, PatternPieceRenderModel>();
    for (const p of artifact.pieces) {
      map.set(p.pieceId, p);
    }
    return map;
  }, [artifact.pieces]);

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
    if (effectiveViewMode === 'pieces') {
      return getBoardUnionBoundsCm(boardState, artifact) ?? tableLayout.unionBoundsCm;
    }
    return tableLayout.unionBoundsCm;
  }, [effectiveViewMode, assemblyResult, gradedPatternSet, boardState, artifact, tableLayout.unionBoundsCm]);

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

  // Keyboard shortcuts: Space hand-pan, Escape clear, Undo/Redo, Group/Ungroup, Arrow nudge
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space' && !e.repeat) {
        setSpacePressed(true);
        return;
      }

      if (effectiveViewMode !== 'pieces') return;

      // Strict UX-2.3.3.1 interaction isolation: inspection mode never mutates board layout
      if (activeTool === 'inspect-entity') {
        if (e.key === 'Escape') {
          onInspectEntity?.(null);
          onHoverEntity?.(null);
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') {
        onClearBoardSelection?.();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndoBoard?.();
        return;
      }
      if ((mod && e.key.toLowerCase() === 'z' && e.shiftKey) || (mod && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        onRedoBoard?.();
        return;
      }
      if (mod && e.key.toLowerCase() === 'g' && !e.shiftKey) {
        e.preventDefault();
        onGroupSelected?.();
        return;
      }
      if (mod && e.key.toLowerCase() === 'g' && e.shiftKey) {
        e.preventDefault();
        onUngroupSelected?.();
        return;
      }

      const sel = boardStateRef.current.selectedPieceIds;
      if (sel.length > 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 2.0 : 0.5;
        const yDir = artifact.coordinateFrame.yAxisDirection === 'cartesian-y-up' ? 1 : -1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? step * yDir : e.key === 'ArrowDown' ? -step * yDir : 0;
        onCommitMovePieces?.(sel, dx, dy);
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
  }, [
    effectiveViewMode,
    activeTool,
    artifact.coordinateFrame.yAxisDirection,
    onClearBoardSelection,
    onUndoBoard,
    onRedoBoard,
    onGroupSelected,
    onUngroupSelected,
    onCommitMovePieces,
    onInspectEntity,
    onHoverEntity
  ]);

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
      const rect = e.currentTarget.getBoundingClientRect();
      const localPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldPt = screenToWorldCm(localPx, cameraRef.current, projection);

      const target = e.target as HTMLElement | SVGElement | null;
      const pieceNode = target?.closest?.('[data-cad-piece-id]') as Element | null;
      const clickedPieceId = pieceNode?.getAttribute('data-cad-piece-id') ?? null;

      // 1. Camera pan (middle button, Pan tool, Space+Drag, or background drag in non-pieces modes)
      const shouldPan =
        e.button === 1 ||
        activeTool === 'pan' ||
        spacePressed ||
        (effectiveViewMode !== 'pieces' && e.button === 0 && !clickedPieceId);

      if (shouldPan) {
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
          // Synthetic pointer events in tests may not support pointer capture
        }
        return;
      }

      if (e.button !== 0 || effectiveViewMode !== 'pieces') return;

      // 1b. UX-2.3.3.1 Read-only geometric entity inspection mode (strictly isolated from drag/marquee)
      if (activeTool === 'inspect-entity') {
        e.preventDefault();
        const hitRadiusPx =
          e.pointerType === 'touch' ? TOUCH_HIT_RADIUS_PX : DEFAULT_HIT_RADIUS_PX;
        const hitRes = hitTestPatternEntities(
          localPx,
          cameraRef.current,
          projection,
          artifactRef.current,
          boardStateRef.current,
          layerVisibilityRef.current,
          {
            hitRadiusPx,
            activeCurve: extractActiveCurveReference(inspectedEntityRef.current)
          }
        );
        onInspectEntity?.(hitRes.hit?.entity ?? null);
        return;
      }

      // 2. Clicked a pattern piece -> selection & optional drag-to-reposition
      if (clickedPieceId) {
        e.preventDefault();
        const isToggleModifier = e.shiftKey || e.metaKey || e.ctrlKey;
        const expandGroup = !e.altKey;

        if (isToggleModifier) {
          onToggleBoardPiece?.(clickedPieceId, { expandGroup });
          onSelectPieceId(clickedPieceId);
          return;
        }

        const currentSelected = boardStateRef.current.selectedPieceIds;
        let movingIds: readonly string[];
        if (currentSelected.includes(clickedPieceId)) {
          movingIds = currentSelected;
        } else {
          movingIds = expandGroup
            ? expandSelectionWithGroups(boardStateRef.current, [clickedPieceId])
            : [clickedPieceId];
          onSelectBoardPiece?.(clickedPieceId, { expandGroup });
          onSelectPieceId(clickedPieceId);
        }

        dragSessionRef.current = {
          pointerId: e.pointerId,
          pieceIds: movingIds,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startWorldCm: worldPt,
          lastSnappedDxCm: 0,
          lastSnappedDyCm: 0,
          moved: false
        };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Safe no-op
        }
        return;
      }

      // 3. Clicked empty canvas background in Select mode -> marquee rectangle or clear selection
      e.preventDefault();
      marqueeSessionRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorldCm: worldPt,
        currentWorldCm: worldPt,
        shiftKey: e.shiftKey,
        moved: false
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Safe no-op
      }
    },
    [
      activeTool,
      spacePressed,
      effectiveViewMode,
      projection,
      onToggleBoardPiece,
      onSelectBoardPiece,
      onSelectPieceId,
      onInspectEntity
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const localPx = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };

      // Active pan
      const panSession = panSessionRef.current;
      if (panSession && panSession.pointerId === e.pointerId) {
        const dx = e.clientX - panSession.startClientX;
        const dy = e.clientY - panSession.startClientY;
        const nextCam = panCadByScreenDelta(panSession.startCamera, dx, dy);
        onChangeCamera(nextCam);
        onChangeCursorCm(screenToWorldCm(localPx, nextCam, projection));
        return;
      }

      const worldPt = screenToWorldCm(localPx, cameraRef.current, projection);
      onChangeCursorCm(worldPt);

      // UX-2.3.3.1: Hover entity hit-testing in inspection mode (strictly isolated from drag/marquee)
      if (effectiveViewMode === 'pieces' && activeTool === 'inspect-entity') {
        const hitRadiusPx =
          e.pointerType === 'touch' ? TOUCH_HIT_RADIUS_PX : DEFAULT_HIT_RADIUS_PX;
        const hitRes = hitTestPatternEntities(
          localPx,
          cameraRef.current,
          projection,
          artifactRef.current,
          boardStateRef.current,
          layerVisibilityRef.current,
          {
            hitRadiusPx,
            activeCurve: extractActiveCurveReference(inspectedEntityRef.current)
          }
        );
        const nextEntity = hitRes.hit?.entity ?? null;
        const prevEntity = hoveredEntityRef.current;
        const unchanged =
          prevEntity === null && nextEntity === null
            ? true
            : prevEntity !== null &&
                nextEntity !== null &&
                prevEntity.presentationRef === nextEntity.presentationRef &&
                Math.abs(prevEntity.localPointCm.x - nextEntity.localPointCm.x) < 1e-3 &&
                Math.abs(prevEntity.localPointCm.y - nextEntity.localPointCm.y) < 1e-3;
        if (!unchanged) {
          onHoverEntity?.(nextEntity);
        }
        return;
      }

      // Active piece drag with live centimeter grid & feature snapping
      const dragSession = dragSessionRef.current;
      if (dragSession && dragSession.pointerId === e.pointerId) {
        const screenDist = Math.hypot(
          e.clientX - dragSession.startClientX,
          e.clientY - dragSession.startClientY
        );
        if (!dragSession.moved && screenDist < 3) return;
        dragSession.moved = true;

        const rawDxCm = worldPt.x - dragSession.startWorldCm.x;
        const rawDyCm = worldPt.y - dragSession.startWorldCm.y;
        const effectiveSnap: SnapConfig = e.altKey
          ? { ...snapConfig, enabled: false }
          : snapConfig;

        const snapRes = evaluateBoardSnapCm(
          boardStateRef.current,
          artifact,
          dragSession.pieceIds,
          rawDxCm,
          rawDyCm,
          effectiveSnap
        );

        dragSession.lastSnappedDxCm = snapRes.dxCm;
        dragSession.lastSnappedDyCm = snapRes.dyCm;
        setDragPreview({
          pieceIds: dragSession.pieceIds,
          dxCm: snapRes.dxCm,
          dyCm: snapRes.dyCm
        });
        onSetActiveSnapGuides?.(snapRes.guides);
        return;
      }

      // Active marquee selection rectangle
      const marqueeSession = marqueeSessionRef.current;
      if (marqueeSession && marqueeSession.pointerId === e.pointerId) {
        const screenDist = Math.hypot(
          e.clientX - marqueeSession.startClientX,
          e.clientY - marqueeSession.startClientY
        );
        if (!marqueeSession.moved && screenDist < 4) return;
        marqueeSession.moved = true;
        marqueeSession.currentWorldCm = worldPt;
        setMarqueePreviewCm({
          start: marqueeSession.startWorldCm,
          current: worldPt
        });
      }
    },
    [
      onChangeCamera,
      onChangeCursorCm,
      projection,
      effectiveViewMode,
      activeTool,
      onHoverEntity,
      snapConfig,
      artifact,
      onSetActiveSnapGuides
    ]
  );

  const handlePointerUpOrCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (panSessionRef.current && panSessionRef.current.pointerId === e.pointerId) {
        panSessionRef.current = null;
        setIsPanning(false);
      }

      if (dragSessionRef.current && dragSessionRef.current.pointerId === e.pointerId) {
        const finished = dragSessionRef.current;
        dragSessionRef.current = null;
        setDragPreview(null);
        onSetActiveSnapGuides?.([]);
        if (
          finished.moved &&
          (Math.abs(finished.lastSnappedDxCm) > 0.005 || Math.abs(finished.lastSnappedDyCm) > 0.005)
        ) {
          onCommitMovePieces?.(
            finished.pieceIds,
            finished.lastSnappedDxCm,
            finished.lastSnappedDyCm
          );
        }
      }

      if (marqueeSessionRef.current && marqueeSessionRef.current.pointerId === e.pointerId) {
        const finished = marqueeSessionRef.current;
        marqueeSessionRef.current = null;
        setMarqueePreviewCm(null);
        if (finished.moved) {
          onSelectMarqueeRect?.(
            {
              minX: finished.startWorldCm.x,
              minY: finished.startWorldCm.y,
              maxX: finished.currentWorldCm.x,
              maxY: finished.currentWorldCm.y
            },
            finished.shiftKey ? 'add' : 'replace'
          );
        } else {
          onClearBoardSelection?.();
        }
      }

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Safe no-op
      }
    },
    [onCommitMovePieces, onSetActiveSnapGuides, onSelectMarqueeRect, onClearBoardSelection]
  );

  const handlePointerLeave = useCallback(() => {
    if (!panSessionRef.current && !dragSessionRef.current && !marqueeSessionRef.current) {
      onChangeCursorCm(null);
      onHoverEntity?.(null);
    }
  }, [onChangeCursorCm, onHoverEntity]);

  const scalePxPerCm = getPixelsPerCm(camera.zoom, BASE_PX_PER_CM);
  const gridSpacing = useMemo(
    () => computeAdaptiveGridSpacingCm(camera.zoom, BASE_PX_PER_CM),
    [camera.zoom]
  );

  const isYUp = artifact.coordinateFrame.yAxisDirection === 'cartesian-y-up';
  const worldTransform = isYUp
    ? `translate(${camera.panX}, ${camera.panY}) scale(${scalePxPerCm}, ${-scalePxPerCm})`
    : `translate(${camera.panX}, ${camera.panY}) scale(${scalePxPerCm})`;

  const invScale = 1 / Math.max(0.5, scalePxPerCm);
  const cutStrokeCm = 1.5 * invScale;
  const sewStrokeCm = 1.0 * invScale;
  const thinStrokeCm = 0.9 * invScale;
  const labelFontCm = Math.max(1.2, 11 * invScale);
  const subLabelFontCm = Math.max(0.95, 9 * invScale);

  const isInspectMode = effectiveViewMode === 'pieces' && activeTool === 'inspect-entity';

  const panCursorClass = isPanning
    ? 'cursor-grabbing'
    : dragPreview
      ? 'cursor-move'
      : activeTool === 'pan' || spacePressed
        ? 'cursor-grab'
        : isInspectMode
          ? 'cursor-crosshair'
          : 'cursor-default';

  const selectedSet = useMemo(() => {
    if (effectiveViewMode === 'pieces') {
      return new Set(boardState.selectedPieceIds);
    }
    return selectedPieceId ? new Set([selectedPieceId]) : new Set<string>();
  }, [effectiveViewMode, boardState.selectedPieceIds, selectedPieceId]);

  const dragPreviewSet = useMemo(
    () => new Set(dragPreview?.pieceIds ?? []),
    [dragPreview]
  );

  const getEffectiveOffset = (pieceId: string): { offsetXCm: number; offsetYCm: number } => {
    const pl = boardState.placementsByPieceId[pieceId];
    const baseX = pl?.offsetXCm ?? 0;
    const baseY = pl?.offsetYCm ?? 0;
    if (dragPreview && dragPreviewSet.has(pieceId)) {
      return {
        offsetXCm: baseX + dragPreview.dxCm,
        offsetYCm: baseY + dragPreview.dyCm
      };
    }
    return { offsetXCm: baseX, offsetYCm: baseY };
  };

  const renderStandardPiece = (piece: PatternPieceRenderModel) => {
    const placement =
      effectiveViewMode === 'pieces'
        ? getEffectiveOffset(piece.pieceId)
        : (() => {
            const auto = tableLayout.placements.find(p => p.pieceId === piece.pieceId);
            return { offsetXCm: auto?.offsetXCm ?? 0, offsetYCm: auto?.offsetYCm ?? 0 };
          })();
    const isSelected = selectedSet.has(piece.pieceId);
    const isGrouped = Boolean(boardState.placementsByPieceId[piece.pieceId]?.groupId);
    const cutD = segmentsToSvgPath(piece.cutSegments, piece.fallbackCutSvgPath);
    const sewD = segmentsToSvgPath(piece.sewSegments, piece.fallbackSewSvgPath);

    const centerX = piece.boundingBoxCm.minX + piece.boundingBoxCm.widthCm * 0.5;
    const labelY = piece.boundingBoxCm.minY + piece.boundingBoxCm.heightCm * 0.34;
    const vis = getPieceLocalVisualBoundsCm(piece);
    const labelBoxW = Math.max(12, subLabelFontCm * 15.5);
    const labelBoxH = layerVisibility.showDimensions ? labelFontCm * 4.2 : labelFontCm * 3.0;

    return (
      <g
        key={piece.pieceId}
        data-cad-piece-id={piece.pieceId}
        data-testid={`cad-piece-${piece.pieceId}`}
        data-selected={isSelected ? 'true' : 'false'}
        data-board-x={placement.offsetXCm.toFixed(2)}
        data-board-y={placement.offsetYCm.toFixed(2)}
        transform={`translate(${placement.offsetXCm}, ${placement.offsetYCm})`}
        onClick={e => {
          if (effectiveViewMode === 'pieces') return; // handled in pointerDown/Up for drag+marquee
          if (activeTool === 'pan' || spacePressed) return;
          e.stopPropagation();
          onSelectPieceId(piece.pieceId);
        }}
        className={
          isInspectMode && !spacePressed
            ? 'cursor-crosshair'
            : effectiveViewMode === 'pieces' && activeTool !== 'pan' && !spacePressed
              ? 'cursor-move'
              : 'cursor-pointer'
        }
        opacity={isSelected ? 1 : 0.9}
      >
        {/* Selection outline framed cleanly around full cut+sew bounds */}
        {isSelected && (
          <rect
            x={vis.minX - 0.8}
            y={vis.minY - 0.8}
            width={vis.maxX - vis.minX + 1.6}
            height={vis.maxY - vis.minY + 1.6}
            fill="none"
            stroke={isGrouped ? '#7c3aed' : '#2563eb'}
            strokeWidth={1.2 * invScale}
            strokeDasharray={`${4 * invScale} ${2.5 * invScale}`}
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

        {/* Piece Identification Labels (paper-backed to clear grainline) */}
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

  // Ordered visible pieces for `pieces` mode (bottom-to-top render order)
  const orderedVisiblePieces = useMemo(() => {
    const ordered: PatternPieceRenderModel[] = [];
    for (const pid of boardState.layerOrder) {
      if (!isPieceEffectivelyVisible(boardState, pid)) continue;
      const piece = piecesById.get(pid);
      if (piece) ordered.push(piece);
    }
    return ordered;
  }, [boardState, piecesById]);

  // Group boundary outlines in board cm
  const groupFrames = useMemo(() => {
    if (effectiveViewMode !== 'pieces') return [];
    const frames: { id: string; name: string; bounds: CadRectCm }[] = [];
    for (const gid of boardState.groupOrder) {
      const grp = boardState.groupsById[gid];
      if (!grp || !grp.visible) continue;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let count = 0;
      for (const pid of grp.memberPieceIds) {
        if (!isPieceEffectivelyVisible(boardState, pid)) continue;
        const piece = piecesById.get(pid);
        if (!piece) continue;
        const offset = getEffectiveOffset(pid);
        const b = getPieceBoardBoundsCm(piece, offset);
        if (b.minX < minX) minX = b.minX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.maxY > maxY) maxY = b.maxY;
        count += 1;
      }
      if (count >= 2) {
        frames.push({
          id: grp.id,
          name: grp.name,
          bounds: { minX: minX - 1.6, minY: minY - 1.6, maxX: maxX + 1.6, maxY: maxY + 1.6 }
        });
      }
    }
    return frames;
  }, [effectiveViewMode, boardState, piecesById, dragPreview]);

  // Subtle inspectable vertex hints rendered only while inspect-entity mode is active
  const inspectVertexHints = useMemo(() => {
    if (!isInspectMode) return [];
    const hints: { key: string; x: number; y: number }[] = [];
    for (const piece of orderedVisiblePieces) {
      const off = getEffectiveOffset(piece.pieceId);
      if (layerVisibility.showSewLines) {
        const { vertices } = extractContourVertices(piece.pieceId, 'sew', piece.sewSegments);
        for (const v of vertices) {
          hints.push({
            key: v.presentationRef,
            x: v.localPointCm.x + off.offsetXCm,
            y: v.localPointCm.y + off.offsetYCm
          });
        }
      }
      if (layerVisibility.showSeamAllowance) {
        const { vertices } = extractContourVertices(piece.pieceId, 'cut', piece.cutSegments);
        for (const v of vertices) {
          hints.push({
            key: v.presentationRef,
            x: v.localPointCm.x + off.offsetXCm,
            y: v.localPointCm.y + off.offsetYCm
          });
        }
      }
    }
    return hints;
  }, [isInspectMode, orderedVisiblePieces, layerVisibility.showSewLines, layerVisibility.showSeamAllowance, boardState, dragPreview]);

  // Resolve active Bézier segment for optional control-polygon overlay
  const activeControlPolygonSpec = useMemo(() => {
    if (!showControlPolygon || !inspectedEntity) return null;
    if (inspectedEntity.entityKind !== 'curve' && inspectedEntity.entityKind !== 'bezier-handle') {
      return null;
    }
    const piece = piecesById.get(inspectedEntity.pieceId);
    if (!piece) return null;
    const segs = inspectedEntity.contour === 'sew' ? piece.sewSegments : piece.cutSegments;
    const seg = segs.find(s => s.id === inspectedEntity.segmentId);
    if (!seg || seg.kind !== 'cubic-bezier' || !seg.p1 || !seg.p2) return null;
    const off = getEffectiveOffset(piece.pieceId);
    return {
      pieceId: piece.pieceId,
      contour: inspectedEntity.contour,
      segmentId: seg.id,
      p0: { x: seg.p0.x + off.offsetXCm, y: seg.p0.y + off.offsetYCm },
      p1: { x: seg.p1.x + off.offsetXCm, y: seg.p1.y + off.offsetYCm },
      p2: { x: seg.p2.x + off.offsetXCm, y: seg.p2.y + off.offsetYCm },
      p3: { x: seg.p3.x + off.offsetXCm, y: seg.p3.y + off.offsetYCm }
    };
  }, [showControlPolygon, inspectedEntity, piecesById, boardState, dragPreview]);

  const renderEntityHighlight = (entity: CadInspectableEntity, variant: 'hover' | 'selected') => {
    const off = getEffectiveOffset(entity.pieceId);
    const isSelectedVariant = variant === 'selected';
    const primaryStroke = isSelectedVariant ? '#0f766e' : '#0284c7';
    const strokeWidth = (isSelectedVariant ? 3.2 : 2.3) * invScale;
    const dash = isSelectedVariant ? undefined : `${4 * invScale} ${2.5 * invScale}`;
    const testId = isSelectedVariant ? 'cad-inspect-selected' : 'cad-inspect-hover';
    const bx = entity.localPointCm.x + off.offsetXCm;
    const by = entity.localPointCm.y + off.offsetYCm;

    const pointMarker = (
      <>
        <circle
          cx={bx}
          cy={by}
          r={(isSelectedVariant ? 6.5 : 5.5) * invScale}
          fill={isSelectedVariant ? '#ffffff' : 'rgba(2, 132, 199, 0.14)'}
          fillOpacity={isSelectedVariant ? 0.92 : 1}
          stroke={primaryStroke}
          strokeWidth={(isSelectedVariant ? 2.1 : 1.5) * invScale}
          strokeDasharray={isSelectedVariant ? undefined : `${3 * invScale} ${2 * invScale}`}
        />
        <circle
          cx={bx}
          cy={by}
          r={(isSelectedVariant ? 3.1 : 2.3) * invScale}
          fill={primaryStroke}
        />
      </>
    );

    const selectedTag = isSelectedVariant ? (
      <g
        transform={
          isYUp
            ? `translate(${bx + 8 * invScale}, ${by + 6 * invScale}) scale(1, -1)`
            : `translate(${bx + 8 * invScale}, ${by - 6 * invScale})`
        }
      >
        <text
          x={0}
          y={0}
          fontSize={Math.max(0.85, 9.5 * invScale)}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontWeight="700"
          fill="#0f766e"
          stroke="#ffffff"
          strokeWidth={2.4 * invScale}
          paintOrder="stroke"
        >
          {entity.entityKind === 'bezier-handle'
            ? entity.handleSlot.toUpperCase()
            : entity.entityKind === 'vertex'
              ? entity.isSharedJunction
                ? 'SHARED VTX'
                : 'VTX'
              : entity.entityKind.toUpperCase()}{' '}
          ({entity.localPointCm.x.toFixed(2)}, {entity.localPointCm.y.toFixed(2)})
        </text>
      </g>
    ) : null;

    switch (entity.entityKind) {
      case 'vertex':
      case 'bezier-handle':
      case 'notch':
      case 'dart-landmark':
        return (
          <g
            key={`${variant}-${entity.presentationRef}`}
            data-testid={testId}
            data-entity-kind={entity.entityKind}
            data-presentation-ref={entity.presentationRef}
          >
            {pointMarker}
            {selectedTag}
          </g>
        );

      case 'edge':
        return (
          <g
            key={`${variant}-${entity.presentationRef}`}
            data-testid={testId}
            data-entity-kind={entity.entityKind}
            data-presentation-ref={entity.presentationRef}
          >
            <line
              x1={entity.startLocalCm.x + off.offsetXCm}
              y1={entity.startLocalCm.y + off.offsetYCm}
              x2={entity.endLocalCm.x + off.offsetXCm}
              y2={entity.endLocalCm.y + off.offsetYCm}
              stroke={primaryStroke}
              strokeWidth={strokeWidth}
              strokeDasharray={dash}
              strokeLinecap="round"
            />
            <circle
              cx={bx}
              cy={by}
              r={(isSelectedVariant ? 4.2 : 3.2) * invScale}
              fill="#ffffff"
              stroke={primaryStroke}
              strokeWidth={1.7 * invScale}
            />
            {selectedTag}
          </g>
        );

      case 'curve': {
        const d = `M ${entity.p0LocalCm.x + off.offsetXCm} ${entity.p0LocalCm.y + off.offsetYCm} C ${entity.p1LocalCm.x + off.offsetXCm} ${entity.p1LocalCm.y + off.offsetYCm}, ${entity.p2LocalCm.x + off.offsetXCm} ${entity.p2LocalCm.y + off.offsetYCm}, ${entity.p3LocalCm.x + off.offsetXCm} ${entity.p3LocalCm.y + off.offsetYCm}`;
        return (
          <g
            key={`${variant}-${entity.presentationRef}`}
            data-testid={testId}
            data-entity-kind={entity.entityKind}
            data-presentation-ref={entity.presentationRef}
          >
            <path
              d={d}
              fill="none"
              stroke={primaryStroke}
              strokeWidth={strokeWidth}
              strokeDasharray={dash}
              strokeLinecap="round"
            />
            <circle
              cx={bx}
              cy={by}
              r={(isSelectedVariant ? 4.2 : 3.2) * invScale}
              fill="#ffffff"
              stroke={primaryStroke}
              strokeWidth={1.7 * invScale}
            />
            {selectedTag}
          </g>
        );
      }

      case 'dart':
        return (
          <g
            key={`${variant}-${entity.presentationRef}`}
            data-testid={testId}
            data-entity-kind={entity.entityKind}
            data-presentation-ref={entity.presentationRef}
          >
            <polyline
              points={`${entity.legLeftLocalCm.x + off.offsetXCm},${entity.legLeftLocalCm.y + off.offsetYCm} ${entity.apexLocalCm.x + off.offsetXCm},${entity.apexLocalCm.y + off.offsetYCm} ${entity.legRightLocalCm.x + off.offsetXCm},${entity.legRightLocalCm.y + off.offsetYCm}`}
              fill="none"
              stroke={primaryStroke}
              strokeWidth={strokeWidth}
              strokeDasharray={dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle
              cx={bx}
              cy={by}
              r={(isSelectedVariant ? 4.2 : 3.2) * invScale}
              fill="#ffffff"
              stroke={primaryStroke}
              strokeWidth={1.7 * invScale}
            />
            {selectedTag}
          </g>
        );
    }
  };

  return (
    <div
      ref={containerRef}
      data-testid="pattern-cad-canvas-container"
      className="flex-1 min-w-0 min-h-0 relative overflow-hidden bg-[#F7F5F0] select-none"
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
                {/* Group Boundary Frames */}
                {groupFrames.map(gf => (
                  <g
                    key={gf.id}
                    data-testid={`cad-group-frame-${gf.id}`}
                    className="pointer-events-none"
                  >
                    <rect
                      x={gf.bounds.minX}
                      y={gf.bounds.minY}
                      width={gf.bounds.maxX - gf.bounds.minX}
                      height={gf.bounds.maxY - gf.bounds.minY}
                      fill="rgba(124, 58, 237, 0.03)"
                      stroke="#7c3aed"
                      strokeWidth={1.0 * invScale}
                      strokeDasharray={`${6 * invScale} ${3 * invScale}`}
                    />
                    <text
                      x={gf.bounds.minX + 0.8}
                      y={gf.bounds.minY - 0.6}
                      fontSize={subLabelFontCm}
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      fontWeight="700"
                      fill="#6d28d9"
                    >
                      {gf.name}
                    </text>
                  </g>
                ))}

                {/* Pattern Pieces in Authoritative Layer Order */}
                {orderedVisiblePieces.map(piece => renderStandardPiece(piece))}

                {/* UX-2.3.3.1: Dedicated Read-Only Entity Inspection Overlay (pointer-events-none) */}
                {(isInspectMode || hoveredEntity || inspectedEntity) && (
                  <g data-testid="cad-inspection-overlay" className="pointer-events-none">
                    {/* Subtle inspectable contour vertex markers while inspect-entity tool is active */}
                    {isInspectMode && inspectVertexHints.length > 0 && (
                      <g data-testid="cad-inspect-vertex-hints" opacity="0.72">
                        {inspectVertexHints.map(v => (
                          <circle
                            key={v.key}
                            cx={v.x}
                            cy={v.y}
                            r={2.4 * invScale}
                            fill="#ffffff"
                            stroke="#475569"
                            strokeWidth={1.0 * invScale}
                          />
                        ))}
                      </g>
                    )}

                    {/* Optional Bézier Control Polygon (p0-p1, p3-p2 tangent arms & P1/P2 handles) */}
                    {activeControlPolygonSpec && (
                      <g data-testid="cad-inspect-control-polygon">
                        <line
                          x1={activeControlPolygonSpec.p0.x}
                          y1={activeControlPolygonSpec.p0.y}
                          x2={activeControlPolygonSpec.p1.x}
                          y2={activeControlPolygonSpec.p1.y}
                          stroke="#d97706"
                          strokeWidth={1.4 * invScale}
                          strokeDasharray={`${4 * invScale} ${2.5 * invScale}`}
                        />
                        <line
                          x1={activeControlPolygonSpec.p3.x}
                          y1={activeControlPolygonSpec.p3.y}
                          x2={activeControlPolygonSpec.p2.x}
                          y2={activeControlPolygonSpec.p2.y}
                          stroke="#d97706"
                          strokeWidth={1.4 * invScale}
                          strokeDasharray={`${4 * invScale} ${2.5 * invScale}`}
                        />
                        {/* Endpoint anchors P0 & P3 */}
                        <circle
                          cx={activeControlPolygonSpec.p0.x}
                          cy={activeControlPolygonSpec.p0.y}
                          r={3.2 * invScale}
                          fill="#ffffff"
                          stroke="#d97706"
                          strokeWidth={1.4 * invScale}
                        />
                        <circle
                          cx={activeControlPolygonSpec.p3.x}
                          cy={activeControlPolygonSpec.p3.y}
                          r={3.2 * invScale}
                          fill="#ffffff"
                          stroke="#d97706"
                          strokeWidth={1.4 * invScale}
                        />
                        {/* Control Handles P1 & P2 */}
                        {(
                          [
                            { slot: 'P1', pt: activeControlPolygonSpec.p1 },
                            { slot: 'P2', pt: activeControlPolygonSpec.p2 }
                          ] as const
                        ).map(h => {
                          const half = 3.6 * invScale;
                          const isHandleSelected =
                            inspectedEntity?.entityKind === 'bezier-handle' &&
                            inspectedEntity.handleSlot.toUpperCase() === h.slot;
                          return (
                            <g key={h.slot} data-testid={`cad-control-handle-${h.slot.toLowerCase()}`}>
                              <rect
                                x={h.pt.x - half}
                                y={h.pt.y - half}
                                width={half * 2}
                                height={half * 2}
                                fill={isHandleSelected ? '#0f766e' : '#fef3c7'}
                                stroke={isHandleSelected ? '#0f766e' : '#b45309'}
                                strokeWidth={1.6 * invScale}
                              />
                              {!isHandleSelected && (
                                <g
                                  transform={
                                    isYUp
                                      ? `translate(${h.pt.x + 6 * invScale}, ${h.pt.y + 4 * invScale}) scale(1, -1)`
                                      : `translate(${h.pt.x + 6 * invScale}, ${h.pt.y - 4 * invScale})`
                                  }
                                >
                                  <text
                                    x={0}
                                    y={0}
                                    fontSize={Math.max(0.8, 9 * invScale)}
                                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                                    fontWeight="700"
                                    fill="#b45309"
                                    stroke="#ffffff"
                                    strokeWidth={2 * invScale}
                                    paintOrder="stroke"
                                  >
                                    {h.slot}
                                  </text>
                                </g>
                              )}
                            </g>
                          );
                        })}
                      </g>
                    )}

                    {/* Hovered Entity Highlight (distinct sky dashed style) */}
                    {hoveredEntity &&
                      hoveredEntity.presentationRef !== inspectedEntity?.presentationRef &&
                      renderEntityHighlight(hoveredEntity, 'hover')}

                    {/* Selected / Inspected Entity Highlight (distinct solid teal style) */}
                    {inspectedEntity && renderEntityHighlight(inspectedEntity, 'selected')}
                  </g>
                )}

                {/* Visual Overlap Advisory Overlays (Advisory Only — Never Certification) */}
                {overlapAdvisories.length > 0 && (
                  <g data-testid="cad-overlap-overlays" className="pointer-events-none">
                    {overlapAdvisories.map(adv => {
                      if (!adv.overlapBoundsCm) return null;
                      const b = adv.overlapBoundsCm;
                      const style =
                        adv.classification === 'unintentional-overlap'
                          ? { fill: 'rgba(225, 29, 72, 0.14)', stroke: '#e11d48', tag: 'OVERLAP · ADVISORY' }
                          : adv.classification === 'intentional-overlap'
                            ? { fill: 'rgba(79, 70, 229, 0.08)', stroke: '#4f46e5', tag: 'INTENTIONAL' }
                            : adv.classification === 'containment'
                              ? { fill: 'rgba(217, 119, 6, 0.10)', stroke: '#d97706', tag: 'CONTAINED' }
                              : adv.classification === 'touching-boundaries'
                                ? { fill: 'none', stroke: '#059669', tag: 'TOUCHING' }
                                : { fill: 'rgba(245, 158, 11, 0.12)', stroke: '#b45309', tag: 'UNRESOLVED' };

                      const w = Math.max(0.6, b.maxX - b.minX);
                      const h = Math.max(0.6, b.maxY - b.minY);
                      return (
                        <g
                          key={adv.id}
                          data-testid={`cad-overlap-${adv.classification}`}
                        >
                          <rect
                            x={b.minX}
                            y={b.minY}
                            width={w}
                            height={h}
                            fill={style.fill}
                            stroke={style.stroke}
                            strokeWidth={1.4 * invScale}
                            strokeDasharray={`${3 * invScale} ${2 * invScale}`}
                          />
                          <text
                            x={b.minX + w * 0.5}
                            y={b.minY + Math.min(h * 0.5, labelFontCm * 1.1)}
                            textAnchor="middle"
                            fontSize={subLabelFontCm * 0.9}
                            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                            fontWeight="700"
                            fill={style.stroke}
                          >
                            {style.tag}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}

                {/* Live Centimeter Snap Alignment Guides */}
                {activeSnapGuides.length > 0 && (
                  <g data-testid="cad-snap-guides" className="pointer-events-none">
                    {activeSnapGuides.map((g, idx) => {
                      const stroke = g.kind === 'feature' ? '#0284c7' : '#0ea5e9';
                      if (g.axis === 'vertical') {
                        return (
                          <g key={`snap-v-${idx}`}>
                            <line
                              x1={g.positionCm}
                              y1={g.startCm}
                              x2={g.positionCm}
                              y2={g.endCm}
                              stroke={stroke}
                              strokeWidth={1.3 * invScale}
                              strokeDasharray={g.kind === 'grid' ? `${3 * invScale} ${3 * invScale}` : undefined}
                            />
                            <text
                              x={g.positionCm + 0.6}
                              y={g.startCm + labelFontCm}
                              fontSize={subLabelFontCm * 0.9}
                              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                              fontWeight="600"
                              fill={stroke}
                            >
                              {g.label}
                            </text>
                          </g>
                        );
                      }
                      return (
                        <g key={`snap-h-${idx}`}>
                          <line
                            x1={g.startCm}
                            y1={g.positionCm}
                            x2={g.endCm}
                            y2={g.positionCm}
                            stroke={stroke}
                            strokeWidth={1.3 * invScale}
                            strokeDasharray={g.kind === 'grid' ? `${3 * invScale} ${3 * invScale}` : undefined}
                          />
                          <text
                            x={g.startCm + 0.6}
                            y={g.positionCm - 0.5}
                            fontSize={subLabelFontCm * 0.9}
                            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                            fontWeight="600"
                            fill={stroke}
                          >
                            {g.label}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}

                {/* Marquee Selection Rectangle */}
                {marqueePreviewCm && (
                  <rect
                    data-testid="cad-selection-marquee"
                    x={Math.min(marqueePreviewCm.start.x, marqueePreviewCm.current.x)}
                    y={Math.min(marqueePreviewCm.start.y, marqueePreviewCm.current.y)}
                    width={Math.abs(marqueePreviewCm.current.x - marqueePreviewCm.start.x)}
                    height={Math.abs(marqueePreviewCm.current.y - marqueePreviewCm.start.y)}
                    fill="rgba(37, 99, 235, 0.08)"
                    stroke="#2563eb"
                    strokeWidth={1.2 * invScale}
                    strokeDasharray={`${4 * invScale} ${2.5 * invScale}`}
                    className="pointer-events-none"
                  />
                )}
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
