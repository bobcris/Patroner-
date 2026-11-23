/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutGrid,
  Sparkles,
  Upload
} from 'lucide-react';
import { useViewportInteraction } from '../../state/ViewportInteractionContext';
import { useCreativeStudio } from './CreativeStudioContext';
import {
  LayerTransform,
  ReferenceImageLayer,
  SketchPoint,
  StudioLayer
} from './types';
import {
  Point2D,
  Rect2D,
  SnapGuide,
  clampTransform,
  computeFitCamera,
  computeSmartSnap,
  getRotatedAabb,
  getUnionRect,
  normalizeAngleDeg,
  normalizeCropRect,
  rectsIntersect,
  resolveWorldTransform,
  roundCoord,
  screenToWorld,
  worldDeltaToParentLocalDelta,
  worldToScreen,
  zoomAtScreenPoint
} from './canvas-math';
import { isLayerEffectivelyLocked } from './studio-reducer';
import { StudioLayerRenderer } from './StudioLayerRenderer';
import { StudioContextMenu } from './StudioContextMenu';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type ActivePointerSession =
  | {
      kind: 'pan';
      startScreen: Point2D;
      startPan: Point2D;
    }
  | {
      kind: 'drag';
      startWorld: Point2D;
      layerIds: string[];
      initialTransforms: Record<string, LayerTransform>;
      initialWorldRects: Record<string, Rect2D>;
      unionStartRect: Rect2D;
    }
  | {
      kind: 'resize';
      layerId: string;
      handle: ResizeHandle;
      startWorld: Point2D;
      initialTransform: LayerTransform;
    }
  | {
      kind: 'rotate';
      layerId: string;
      centerWorld: Point2D;
      startAngleDeg: number;
      initialRotationDeg: number;
    }
  | {
      kind: 'marquee';
      startWorld: Point2D;
      currentWorld: Point2D;
      additive: boolean;
    }
  | {
      kind: 'sketch';
      pointsWorld: SketchPoint[];
    }
  | {
      kind: 'crop';
      layerId: string;
      handle: 'nw' | 'ne' | 'se' | 'sw';
      startWorld: Point2D;
      layerWorld: Rect2D;
      initialCrop: ReferenceImageLayer['crop'];
    };

export interface StudioVisualCanvasProps {
  onRequestUploadDialog: () => void;
  onRequestReplaceAsset: (layerId: string) => void;
  onUploadMessage?: (msg: string | null) => void;
}

export const StudioVisualCanvas: React.FC<StudioVisualCanvasProps> = ({
  onRequestUploadDialog,
  onRequestReplaceAsset,
  onUploadMessage
}) => {
  const {
    document: studioDoc,
    activeCollectionLayers,
    assetUrlsById,
    createEmptyMoodboard,
    loadAtelierStarterBoard,
    uploadReferenceFiles,
    addAnnotationNote,
    addFreehandSketchStroke,
    commitLayerTransforms,
    setImageCrop,
    setStudioCamera,
    toggleLayerLock,
    toggleLayerVisibility,
    reorderLayer,
    groupLayers,
    ungroupLayer,
    duplicateLayers,
    softDeleteLayers,
    undoStudio,
    redoStudio
  } = useCreativeStudio();

  const {
    activeTool,
    setActiveTool,
    selectedLayerIds,
    setSelectedLayerIds,
    toggleLayerSelection,
    clearLayerSelection,
    selectEntity,
    snapEnabled,
    gridMode
  } = useViewportInteraction();

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ActivePointerSession | null>(null);
  const spacePressedRef = useRef<boolean>(false);

  // Transient 60fps interaction overlays (never committed to reducer until pointerup)
  const [liveCamera, setLiveCamera] = useState(studioDoc.camera);
  const liveCameraRef = useRef(liveCamera);
  liveCameraRef.current = liveCamera;
  const [liveTransformOverrides, setLiveTransformOverrides] = useState<Record<string, LayerTransform>>({});
  const [liveCropOverride, setLiveCropOverride] = useState<{ layerId: string; crop: ReferenceImageLayer['crop'] } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [marqueeRect, setMarqueeRect] = useState<Rect2D | null>(null);
  const [liveSketchPoints, setLiveSketchPoints] = useState<SketchPoint[]>([]);
  const [isDragOverFiles, setIsDragOverFiles] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; layer: StudioLayer } | null>(null);

  // Sync camera when document camera updates externally (e.g., Fit / Reset / Starter board)
  useEffect(() => {
    liveCameraRef.current = studioDoc.camera;
    setLiveCamera(studioDoc.camera);
  }, [studioDoc.camera]);

  // Keep selectedLayerIds valid when layers are deleted or collection changes
  useEffect(() => {
    const validIds = new Set(activeCollectionLayers.map(l => l.id));
    const filtered = selectedLayerIds.filter(id => validIds.has(id));
    if (filtered.length !== selectedLayerIds.length) {
      setSelectedLayerIds(filtered);
    }
  }, [activeCollectionLayers, selectedLayerIds, setSelectedLayerIds]);

  const visibleLayers = useMemo(() => {
    // activeCollectionLayers is bottom-to-top; exclude hidden layers or layers inside hidden groups
    const hiddenGroupIds = new Set<string>();
    for (const l of activeCollectionLayers) {
      if (l.type === 'group' && !l.visible) hiddenGroupIds.add(l.id);
    }
    return activeCollectionLayers.filter(l => {
      if (!l.visible) return false;
      let parentId = l.parentId;
      while (parentId) {
        if (hiddenGroupIds.has(parentId)) return false;
        parentId = studioDoc.layersById[parentId]?.parentId ?? null;
      }
      return true;
    });
  }, [activeCollectionLayers, studioDoc.layersById]);

  // Effective layers map incorporating transient live transforms for crisp 60fps overlay sync
  const effectiveLayersById = useMemo(() => {
    const overrideIds = Object.keys(liveTransformOverrides);
    if (overrideIds.length === 0 && !liveCropOverride) return studioDoc.layersById;
    const next = { ...studioDoc.layersById };
    for (const id of overrideIds) {
      if (next[id]) {
        next[id] = { ...next[id], transform: liveTransformOverrides[id] };
      }
    }
    if (liveCropOverride && next[liveCropOverride.layerId]?.type === 'reference-image') {
      const refLayer = next[liveCropOverride.layerId] as ReferenceImageLayer;
      next[liveCropOverride.layerId] = { ...refLayer, crop: liveCropOverride.crop };
    }
    return next;
  }, [studioDoc.layersById, liveTransformOverrides, liveCropOverride]);

  const getLocalScreenPoint = useCallback((clientX: number, clientY: number): Point2D => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return {
      x: roundCoord(clientX - rect.left),
      y: roundCoord(clientY - rect.top)
    };
  }, []);

  const syncSelectionToSharedEntity = useCallback(
    (layer: StudioLayer | null) => {
      if (!layer) return;
      if (layer.type === 'reference-image') {
        selectEntity(
          {
            kind: 'reference-image',
            id: `ref:${layer.assetName}`,
            label: layer.name,
            name: layer.assetName,
            sizeBytes: layer.sizeBytes
          },
          false
        );
      } else if (layer.type === 'garment-silhouette-card') {
        selectEntity(
          {
            kind: 'garment-element',
            id: `garment:${layer.id}`,
            label: layer.title,
            category: layer.garmentCategory,
            silhouette: layer.silhouette
          },
          false
        );
      }
    },
    [selectEntity]
  );

  // Keyboard shortcuts scoped to Creative Studio
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isEditingText) return;

      if (e.code === 'Space') {
        spacePressedRef.current = true;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoStudio();
        else undoStudio();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd' && selectedLayerIds.length > 0) {
        e.preventDefault();
        duplicateLayers([...selectedLayerIds]);
        return;
      }
      if (mod && e.key.toLowerCase() === 'g' && selectedLayerIds.length >= 2) {
        e.preventDefault();
        groupLayers([...selectedLayerIds]);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayerIds.length > 0) {
        e.preventDefault();
        softDeleteLayers([...selectedLayerIds]);
        clearLayerSelection();
        return;
      }
      if (e.key === 'Escape') {
        clearLayerSelection();
        if (activeTool === 'crop-image' || activeTool === 'freehand-sketch' || activeTool === 'place-note') {
          setActiveTool('select');
        }
        return;
      }

      // Tool single-key shortcuts
      if (!mod && !e.altKey) {
        const lower = e.key.toLowerCase();
        if (lower === 'v') setActiveTool('select');
        else if (lower === 'h') setActiveTool('pan');
        else if (lower === 'c') setActiveTool('crop-image');
        else if (lower === 'b') setActiveTool('freehand-sketch');
        else if (lower === 'n') setActiveTool('place-note');
      }

      // Arrow key nudging
      if (
        selectedLayerIds.length > 0 &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const updates: Record<string, Partial<LayerTransform>> = {};
        for (const id of selectedLayerIds) {
          const layer = studioDoc.layersById[id];
          if (!layer || isLayerEffectivelyLocked(id, studioDoc.layersById)) continue;
          const localDelta = worldDeltaToParentLocalDelta({ x: dx, y: dy }, layer.parentId, studioDoc.layersById);
          updates[id] = {
            x: roundCoord(layer.transform.x + localDelta.x),
            y: roundCoord(layer.transform.y + localDelta.y)
          };
        }
        commitLayerTransforms(updates, 'Nudge selected layers');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressedRef.current = false;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    activeTool,
    clearLayerSelection,
    commitLayerTransforms,
    duplicateLayers,
    groupLayers,
    redoStudio,
    selectedLayerIds,
    setActiveTool,
    softDeleteLayers,
    studioDoc.layersById,
    undoStudio
  ]);

  // Pointer-anchored wheel zoom & two-finger trackpad pan via native non-passive listener
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const currentCam = liveCameraRef.current;
      const screenPt = getLocalScreenPoint(e.clientX, e.clientY);
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const factor = e.deltaY < 0 ? 1.09 : 0.92;
        const nextCam = zoomAtScreenPoint(currentCam, currentCam.zoom * factor, screenPt);
        liveCameraRef.current = nextCam;
        setLiveCamera(nextCam);
        setStudioCamera(nextCam);
      } else {
        const nextCam = {
          ...currentCam,
          panX: roundCoord(currentCam.panX - e.deltaX),
          panY: roundCoord(currentCam.panY - e.deltaY)
        };
        liveCameraRef.current = nextCam;
        setLiveCamera(nextCam);
        setStudioCamera(nextCam);
      }
    };

    el.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onNativeWheel);
    };
  }, [getLocalScreenPoint, setStudioCamera]);

  // Layer pointer down (select + begin drag)
  const handleLayerPointerDown = useCallback(
    (e: React.PointerEvent, layer: StudioLayer) => {
      if (e.button === 2) return; // Context menu handled separately
      if (activeTool === 'pan' || spacePressedRef.current || e.button === 1) {
        return; // Let viewport pan handler capture it
      }
      if (activeTool === 'freehand-sketch' || activeTool === 'place-note') {
        return; // Let viewport sketch/note handler capture it
      }

      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

      // Update selection
      let nextSelection: string[];
      if (e.shiftKey) {
        toggleLayerSelection(layer.id);
        nextSelection = selectedLayerIds.includes(layer.id)
          ? selectedLayerIds.filter(id => id !== layer.id)
          : [...selectedLayerIds, layer.id];
      } else if (selectedLayerIds.includes(layer.id)) {
        nextSelection = [...selectedLayerIds];
      } else {
        setSelectedLayerIds([layer.id]);
        nextSelection = [layer.id];
      }
      syncSelectionToSharedEntity(layer);

      if (activeTool === 'crop-image') {
        return; // Crop handles drive crop updates directly
      }

      // Begin drag session for all unlocked selected layers
      const movableIds = nextSelection.filter(
        id => studioDoc.layersById[id] && !isLayerEffectivelyLocked(id, studioDoc.layersById)
      );
      if (movableIds.length === 0) return;

      const screenPt = getLocalScreenPoint(e.clientX, e.clientY);
      const startWorld = screenToWorld(screenPt, liveCamera);
      const initialTransforms: Record<string, LayerTransform> = {};
      const initialWorldRects: Record<string, Rect2D> = {};
      const rects: Rect2D[] = [];
      for (const id of movableIds) {
        initialTransforms[id] = { ...studioDoc.layersById[id].transform };
        const w = resolveWorldTransform(id, studioDoc.layersById);
        if (w) {
          const aabb = getRotatedAabb(w);
          initialWorldRects[id] = aabb;
          rects.push(aabb);
        }
      }
      const unionStartRect = getUnionRect(rects);
      if (!unionStartRect) return;

      sessionRef.current = {
        kind: 'drag',
        startWorld,
        layerIds: movableIds,
        initialTransforms,
        initialWorldRects,
        unionStartRect
      };
    },
    [
      activeTool,
      getLocalScreenPoint,
      liveCamera,
      selectedLayerIds,
      setSelectedLayerIds,
      studioDoc.layersById,
      syncSelectionToSharedEntity,
      toggleLayerSelection
    ]
  );

  // Viewport background pointer down (pan / marquee / sketch / place-note)
  const handleViewportPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button === 2) return;
      setContextMenu(null);
      const screenPt = getLocalScreenPoint(e.clientX, e.clientY);
      const worldPt = screenToWorld(screenPt, liveCamera);

      if (activeTool === 'pan' || spacePressedRef.current || e.button === 1) {
        viewportRef.current?.setPointerCapture?.(e.pointerId);
        sessionRef.current = {
          kind: 'pan',
          startScreen: screenPt,
          startPan: { x: liveCamera.panX, y: liveCamera.panY }
        };
        return;
      }

      if (activeTool === 'place-note') {
        const noteId = addAnnotationNote({ x: Math.round(worldPt.x - 115), y: Math.round(worldPt.y - 60) });
        setSelectedLayerIds([noteId]);
        setActiveTool('select');
        return;
      }

      if (activeTool === 'freehand-sketch') {
        viewportRef.current?.setPointerCapture?.(e.pointerId);
        sessionRef.current = {
          kind: 'sketch',
          pointsWorld: [worldPt]
        };
        setLiveSketchPoints([worldPt]);
        return;
      }

      // Default select mode on empty canvas -> begin marquee selection
      if (!e.shiftKey) {
        clearLayerSelection();
      }
      viewportRef.current?.setPointerCapture?.(e.pointerId);
      sessionRef.current = {
        kind: 'marquee',
        startWorld: worldPt,
        currentWorld: worldPt,
        additive: e.shiftKey
      };
      setMarqueeRect({ x: worldPt.x, y: worldPt.y, width: 0, height: 0 });
    },
    [
      activeTool,
      addAnnotationNote,
      clearLayerSelection,
      getLocalScreenPoint,
      liveCamera,
      setActiveTool,
      setSelectedLayerIds
    ]
  );

  // Unified pointer move handler (all 60fps updates stay outside reducer!)
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const session = sessionRef.current;
      if (!session) return;

      const screenPt = getLocalScreenPoint(e.clientX, e.clientY);
      const worldPt = screenToWorld(screenPt, liveCamera);

      if (session.kind === 'pan') {
        const dx = screenPt.x - session.startScreen.x;
        const dy = screenPt.y - session.startScreen.y;
        setLiveCamera({
          ...liveCamera,
          panX: roundCoord(session.startPan.x + dx),
          panY: roundCoord(session.startPan.y + dy)
        });
        return;
      }

      if (session.kind === 'drag') {
        let rawDx = worldPt.x - session.startWorld.x;
        let rawDy = worldPt.y - session.startWorld.y;

        if (snapEnabled && !e.altKey) {
          const movingAabb: Rect2D = {
            x: session.unionStartRect.x + rawDx,
            y: session.unionStartRect.y + rawDy,
            width: session.unionStartRect.width,
            height: session.unionStartRect.height
          };
          const selectedSet = new Set(session.layerIds);
          const targets: Array<{ id: string; rect: Rect2D }> = [];
          for (const other of visibleLayers) {
            if (other.type === 'group' || selectedSet.has(other.id)) continue;
            const w = resolveWorldTransform(other.id, studioDoc.layersById);
            if (w) targets.push({ id: other.id, rect: getRotatedAabb(w) });
          }
          const snap = computeSmartSnap({
            movingAabb,
            targetAabbs: targets,
            zoom: liveCamera.zoom,
            gridSizeWorld: gridMode !== 'off' ? 20 : undefined
          });
          rawDx += snap.dx;
          rawDy += snap.dy;
          setSnapGuides(snap.guides);
        } else {
          setSnapGuides([]);
        }

        const overrides: Record<string, LayerTransform> = {};
        for (const id of session.layerIds) {
          const layer = studioDoc.layersById[id];
          const init = session.initialTransforms[id];
          if (!layer || !init) continue;
          const localDelta = worldDeltaToParentLocalDelta(
            { x: rawDx, y: rawDy },
            layer.parentId,
            studioDoc.layersById
          );
          overrides[id] = clampTransform({
            ...init,
            x: init.x + localDelta.x,
            y: init.y + localDelta.y
          });
        }
        setLiveTransformOverrides(overrides);
        return;
      }

      if (session.kind === 'resize') {
        const dx = worldPt.x - session.startWorld.x;
        const dy = worldPt.y - session.startWorld.y;
        const init = session.initialTransform;
        let { x, y, width, height } = init;

        if (session.handle.includes('e')) width = Math.max(24, init.width + dx);
        if (session.handle.includes('s')) height = Math.max(24, init.height + dy);
        if (session.handle.includes('w')) {
          const nextW = Math.max(24, init.width - dx);
          x = init.x + (init.width - nextW);
          width = nextW;
        }
        if (session.handle.includes('n')) {
          const nextH = Math.max(24, init.height - dy);
          y = init.y + (init.height - nextH);
          height = nextH;
        }

        // Hold Shift to preserve original aspect ratio on corner resize
        if (e.shiftKey && session.handle.length === 2 && init.height > 0) {
          const ratio = init.width / init.height;
          height = Math.max(24, width / ratio);
        }

        setLiveTransformOverrides({
          [session.layerId]: clampTransform({ ...init, x, y, width, height })
        });
        return;
      }

      if (session.kind === 'rotate') {
        const angleRad = Math.atan2(
          worldPt.y - session.centerWorld.y,
          worldPt.x - session.centerWorld.x
        );
        const angleDeg = (angleRad * 180) / Math.PI;
        let nextRot = normalizeAngleDeg(session.initialRotationDeg + (angleDeg - session.startAngleDeg));
        if (e.shiftKey) {
          nextRot = normalizeAngleDeg(Math.round(nextRot / 15) * 15);
        }
        const orig = studioDoc.layersById[session.layerId];
        if (orig) {
          setLiveTransformOverrides({
            [session.layerId]: { ...orig.transform, rotationDeg: nextRot }
          });
        }
        return;
      }

      if (session.kind === 'marquee') {
        session.currentWorld = worldPt;
        const x = Math.min(session.startWorld.x, worldPt.x);
        const y = Math.min(session.startWorld.y, worldPt.y);
        const width = Math.abs(worldPt.x - session.startWorld.x);
        const height = Math.abs(worldPt.y - session.startWorld.y);
        setMarqueeRect({ x, y, width, height });
        return;
      }

      if (session.kind === 'sketch') {
        const last = session.pointsWorld[session.pointsWorld.length - 1];
        const dist = Math.hypot(worldPt.x - last.x, worldPt.y - last.y);
        if (dist >= 2.5) {
          session.pointsWorld.push(worldPt);
          setLiveSketchPoints([...session.pointsWorld]);
        }
        return;
      }

      if (session.kind === 'crop') {
        const dxFrac = (worldPt.x - session.startWorld.x) / Math.max(1, session.layerWorld.width);
        const dyFrac = (worldPt.y - session.startWorld.y) / Math.max(1, session.layerWorld.height);
        const c = session.initialCrop;
        let x = c.x;
        let y = c.y;
        let width = c.width;
        let height = c.height;

        if (session.handle.includes('w')) {
          x = c.x + dxFrac;
          width = c.width - dxFrac;
        }
        if (session.handle.includes('e')) {
          width = c.width + dxFrac;
        }
        if (session.handle.includes('n')) {
          y = c.y + dyFrac;
          height = c.height - dyFrac;
        }
        if (session.handle.includes('s')) {
          height = c.height + dyFrac;
        }
        setLiveCropOverride({
          layerId: session.layerId,
          crop: normalizeCropRect({ x, y, width, height })
        });
      }
    },
    [getLocalScreenPoint, gridMode, liveCamera, snapEnabled, studioDoc.layersById, visibleLayers]
  );

  // Commit interaction cleanly on pointerup
  const handlePointerUp = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;

    if (session.kind === 'pan') {
      setStudioCamera(liveCamera);
      return;
    }

    if (session.kind === 'drag' || session.kind === 'resize' || session.kind === 'rotate') {
      const overrides = liveTransformOverrides;
      setLiveTransformOverrides({});
      setSnapGuides([]);
      if (Object.keys(overrides).length > 0) {
        const label =
          session.kind === 'drag'
            ? `Move ${session.layerIds.length} layer(s)`
            : session.kind === 'resize'
              ? 'Resize layer'
              : 'Rotate layer';
        commitLayerTransforms(overrides, label);
      }
      return;
    }

    if (session.kind === 'marquee') {
      const box = marqueeRect;
      setMarqueeRect(null);
      if (box && (box.width > 4 || box.height > 4)) {
        const hits: string[] = [];
        for (const layer of visibleLayers) {
          if (layer.type === 'group' || layer.locked) continue;
          const w = resolveWorldTransform(layer.id, studioDoc.layersById);
          if (!w) continue;
          if (rectsIntersect(box, getRotatedAabb(w))) {
            hits.push(layer.id);
          }
        }
        setSelectedLayerIds(session.additive ? [...selectedLayerIds, ...hits] : hits);
      }
      return;
    }

    if (session.kind === 'sketch') {
      const pts = session.pointsWorld;
      setLiveSketchPoints([]);
      if (pts.length >= 2) {
        const sketchId = addFreehandSketchStroke({
          id: `stroke-${Date.now().toString(36)}`,
          points: pts,
          strokeColor: '#18181B',
          strokeWidth: 2.2,
          opacity: 0.9
        });
        setSelectedLayerIds([sketchId]);
      }
      return;
    }

    if (session.kind === 'crop') {
      const override = liveCropOverride;
      setLiveCropOverride(null);
      if (override) {
        setImageCrop(override.layerId, override.crop);
      }
    }
  }, [
    addFreehandSketchStroke,
    commitLayerTransforms,
    liveCamera,
    liveCropOverride,
    liveTransformOverrides,
    marqueeRect,
    selectedLayerIds,
    setImageCrop,
    setSelectedLayerIds,
    setStudioCamera,
    studioDoc.layersById,
    visibleLayers
  ]);

  // Drag-and-drop multi-image upload onto canvas
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDragOverFiles) setIsDragOverFiles(true);
    }
  };

  const handleDragLeave = () => setIsDragOverFiles(false);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverFiles(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const screenPt = getLocalScreenPoint(e.clientX, e.clientY);
    const worldPt = screenToWorld(screenPt, liveCamera);
    const summary = await uploadReferenceFiles(files, {
      x: Math.max(24, Math.round(worldPt.x - 120)),
      y: Math.max(24, Math.round(worldPt.y - 120))
    });
    if (summary.addedLayerIds.length > 0) {
      setSelectedLayerIds(summary.addedLayerIds);
    }
    if (summary.errors.length > 0) {
      onUploadMessage?.(summary.errors[0]);
    } else if (summary.addedLayerIds.length > 0) {
      onUploadMessage?.(null);
    }
  };

  // Compute selection overlay bounds in screen coordinates
  const selectedWorldEntries = useMemo(() => {
    return selectedLayerIds
      .map(id => {
        const layer = effectiveLayersById[id];
        const world = layer ? resolveWorldTransform(id, effectiveLayersById) : null;
        return layer && world ? { layer, world } : null;
      })
      .filter((x): x is { layer: StudioLayer; world: NonNullable<ReturnType<typeof resolveWorldTransform>> } => Boolean(x));
  }, [selectedLayerIds, effectiveLayersById]);

  const singleSelected = selectedWorldEntries.length === 1 ? selectedWorldEntries[0] : null;
  const multiUnionWorld = useMemo(() => {
    if (selectedWorldEntries.length < 2) return null;
    return getUnionRect(selectedWorldEntries.map(e => getRotatedAabb(e.world)));
  }, [selectedWorldEntries]);

  const isCroppingLayer =
    activeTool === 'crop-image' && singleSelected?.layer.type === 'reference-image'
      ? (singleSelected.layer as ReferenceImageLayer)
      : null;

  const handleFitBoard = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rects = visibleLayers
      .filter(l => l.type !== 'group')
      .map(l => resolveWorldTransform(l.id, studioDoc.layersById))
      .filter((w): w is NonNullable<typeof w> => Boolean(w))
      .map(w => getRotatedAabb(w));
    const cam = computeFitCamera(rects, vp.clientWidth, vp.clientHeight, 64);
    setLiveCamera(cam);
    setStudioCamera(cam);
  };

  const startResize = (e: React.PointerEvent, layer: StudioLayer, handle: ResizeHandle) => {
    e.stopPropagation();
    if (isLayerEffectivelyLocked(layer.id, studioDoc.layersById)) return;
    viewportRef.current?.setPointerCapture?.(e.pointerId);
    const startWorld = screenToWorld(getLocalScreenPoint(e.clientX, e.clientY), liveCamera);
    sessionRef.current = {
      kind: 'resize',
      layerId: layer.id,
      handle,
      startWorld,
      initialTransform: { ...layer.transform }
    };
  };

  const startRotate = (e: React.PointerEvent, layer: StudioLayer, world: Rect2D) => {
    e.stopPropagation();
    if (isLayerEffectivelyLocked(layer.id, studioDoc.layersById)) return;
    viewportRef.current?.setPointerCapture?.(e.pointerId);
    const startWorld = screenToWorld(getLocalScreenPoint(e.clientX, e.clientY), liveCamera);
    const centerWorld = { x: world.x + world.width / 2, y: world.y + world.height / 2 };
    const startAngleDeg =
      (Math.atan2(startWorld.y - centerWorld.y, startWorld.x - centerWorld.x) * 180) / Math.PI;
    sessionRef.current = {
      kind: 'rotate',
      layerId: layer.id,
      centerWorld,
      startAngleDeg,
      initialRotationDeg: layer.transform.rotationDeg
    };
  };

  const startCropDrag = (
    e: React.PointerEvent,
    layer: ReferenceImageLayer,
    world: Rect2D,
    handle: 'nw' | 'ne' | 'se' | 'sw'
  ) => {
    e.stopPropagation();
    viewportRef.current?.setPointerCapture?.(e.pointerId);
    const startWorld = screenToWorld(getLocalScreenPoint(e.clientX, e.clientY), liveCamera);
    sessionRef.current = {
      kind: 'crop',
      layerId: layer.id,
      handle,
      startWorld,
      layerWorld: world,
      initialCrop: { ...layer.crop }
    };
  };

  const showCleanFirstLoad = !studioDoc.hasInitializedBoard && visibleLayers.length === 0;

  const gridStyle = useMemo<React.CSSProperties | undefined>(() => {
    const step = Math.max(12, Math.round(24 * liveCamera.zoom));
    if (gridMode === 'dots') {
      return {
        backgroundImage: 'radial-gradient(rgba(24, 24, 27, 0.14) 1px, transparent 1px)',
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${liveCamera.panX % step}px ${liveCamera.panY % step}px`
      };
    }
    if (gridMode === 'grid') {
      return {
        backgroundImage:
          'linear-gradient(to right, rgba(24, 24, 27, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(24, 24, 27, 0.06) 1px, transparent 1px)',
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${liveCamera.panX % step}px ${liveCamera.panY % step}px`
      };
    }
    return undefined;
  }, [gridMode, liveCamera.panX, liveCamera.panY, liveCamera.zoom]);

  const cursorClass =
    activeTool === 'pan'
      ? 'cursor-grab active:cursor-grabbing'
      : activeTool === 'freehand-sketch'
        ? 'cursor-crosshair'
        : activeTool === 'place-note'
          ? 'cursor-copy'
          : 'cursor-default';

  return (
    <div
      ref={viewportRef}
      data-testid="studio-visual-canvas"
      data-zoom={liveCamera.zoom}
      data-layer-count={visibleLayers.length}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={gridStyle}
      className={`relative flex-1 min-w-0 min-h-0 h-full overflow-hidden bg-[#EFECE5] select-none touch-none ${cursorClass}`}
    >
      {/* D1: Clean First-Load Empty Canvas with 3 Explicit Actions (Never Auto-Inserts Demo Content) */}
      {showCleanFirstLoad && (
        <div
          data-testid="studio-clean-first-load"
          onPointerDown={e => e.stopPropagation()}
          className="absolute inset-0 z-20 flex items-center justify-center p-6 pointer-events-none"
        >
          <div className="pointer-events-auto max-w-xl w-full bg-white/95 backdrop-blur-xs border border-neutral-300 rounded-sm p-6 lg:p-8 shadow-sm space-y-5">
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-neutral-500">
                Creative Studio · Visual Design Board
              </p>
              <h2 className="text-xl lg:text-2xl font-serif font-semibold text-neutral-900 tracking-tight">
                Start your garment direction visually
              </h2>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Arrange reference photographs, color palettes, textiles, and silhouette studies on an infinite board. Visual boards stay non-authoritative until you explicitly promote selected design intent to Pattern Atelier.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                data-testid="first-load-upload-btn"
                onClick={onRequestUploadDialog}
                className="p-3.5 rounded-sm bg-neutral-900 text-white hover:bg-neutral-800 text-left flex flex-col justify-between gap-3 cursor-pointer transition-colors"
              >
                <Upload className="w-4 h-4 text-neutral-200" />
                <div>
                  <span className="text-xs font-semibold block">Upload Reference Images</span>
                  <span className="text-[11px] text-neutral-300 block mt-0.5">
                    PNG, JPG, WEBP · Drag or browse
                  </span>
                </div>
              </button>

              <button
                type="button"
                data-testid="first-load-moodboard-btn"
                onClick={createEmptyMoodboard}
                className="p-3.5 rounded-sm bg-neutral-50 border border-neutral-300 text-neutral-900 hover:border-neutral-500 hover:bg-white text-left flex flex-col justify-between gap-3 cursor-pointer transition-colors"
              >
                <LayoutGrid className="w-4 h-4 text-neutral-700" />
                <div>
                  <span className="text-xs font-semibold block">Create Moodboard</span>
                  <span className="text-[11px] text-neutral-500 block mt-0.5">
                    Clean workspace with brief card
                  </span>
                </div>
              </button>

              <button
                type="button"
                data-testid="first-load-starter-btn"
                onClick={loadAtelierStarterBoard}
                className="p-3.5 rounded-sm bg-neutral-50 border border-neutral-300 text-neutral-900 hover:border-neutral-500 hover:bg-white text-left flex flex-col justify-between gap-3 cursor-pointer transition-colors"
              >
                <Sparkles className="w-4 h-4 text-amber-700" />
                <div>
                  <span className="text-xs font-semibold block">Load Atelier Starter Board</span>
                  <span className="text-[11px] text-amber-800 block mt-0.5">
                    Optional demonstration content
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GPU-Composited World Stage (DOM/CSS Layers) */}
      <div
        data-testid="studio-world-stage"
        style={{
          transform: `translate3d(${liveCamera.panX}px, ${liveCamera.panY}px, 0) scale(${liveCamera.zoom})`,
          transformOrigin: '0 0'
        }}
        className="absolute top-0 left-0 w-0 h-0 overflow-visible"
      >
        {visibleLayers.map(layer => {
          if (layer.type === 'group') return null;
          const world = resolveWorldTransform(layer.id, effectiveLayersById);
          if (!world) return null;
          return (
            <StudioLayerRenderer
              key={layer.id}
              layer={layer}
              worldTransform={{
                x: world.x,
                y: world.y,
                width: world.width,
                height: world.height,
                rotationDeg: world.rotationDeg,
                scaleX: world.scaleX,
                scaleY: world.scaleY
              }}
              isSelected={selectedLayerIds.includes(layer.id)}
              isCropping={isCroppingLayer?.id === layer.id}
              assetUrl={layer.type === 'reference-image' ? assetUrlsById[layer.assetId] : undefined}
              onPointerDown={handleLayerPointerDown}
              onContextMenu={(e, target) => {
                e.preventDefault();
                e.stopPropagation();
                if (!selectedLayerIds.includes(target.id)) {
                  setSelectedLayerIds([target.id]);
                }
                setContextMenu({ x: e.clientX, y: e.clientY, layer: target });
              }}
              onRequestReplaceAsset={onRequestReplaceAsset}
            />
          );
        })}
      </div>

      {/* Synchronized Zoom-Invariant SVG Overlay (Selection Boxes, Handles, Guides, Marquee, Live Sketch) */}
      <svg
        data-testid="studio-svg-overlay"
        className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
      >
        {/* Smart Snap Guides */}
        {snapGuides.map((g, idx) => {
          if (g.orientation === 'vertical') {
            const p1 = worldToScreen({ x: g.position, y: g.start }, liveCamera);
            const p2 = worldToScreen({ x: g.position, y: g.end }, liveCamera);
            return (
              <line
                key={`guide-v-${idx}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#D97706"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
            );
          }
          const p1 = worldToScreen({ x: g.start, y: g.position }, liveCamera);
          const p2 = worldToScreen({ x: g.end, y: g.position }, liveCamera);
          return (
            <line
              key={`guide-h-${idx}`}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="#D97706"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          );
        })}

        {/* Marquee Selection Box */}
        {marqueeRect && (() => {
          const tl = worldToScreen({ x: marqueeRect.x, y: marqueeRect.y }, liveCamera);
          const br = worldToScreen(
            { x: marqueeRect.x + marqueeRect.width, y: marqueeRect.y + marqueeRect.height },
            liveCamera
          );
          return (
            <rect
              x={tl.x}
              y={tl.y}
              width={Math.max(1, br.x - tl.x)}
              height={Math.max(1, br.y - tl.y)}
              fill="rgba(24, 24, 27, 0.08)"
              stroke="#18181B"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          );
        })()}

        {/* Live Freehand Sketch Stroke (Unverified) */}
        {liveSketchPoints.length >= 2 && (
          <polyline
            fill="none"
            stroke="#18181B"
            strokeWidth={2.2 * liveCamera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={liveSketchPoints
              .map(pt => {
                const s = worldToScreen(pt, liveCamera);
                return `${s.x},${s.y}`;
              })
              .join(' ')}
          />
        )}

        {/* Multi-Selection Union Frame */}
        {multiUnionWorld && (() => {
          const tl = worldToScreen({ x: multiUnionWorld.x, y: multiUnionWorld.y }, liveCamera);
          const br = worldToScreen(
            {
              x: multiUnionWorld.x + multiUnionWorld.width,
              y: multiUnionWorld.y + multiUnionWorld.height
            },
            liveCamera
          );
          return (
            <rect
              x={tl.x}
              y={tl.y}
              width={Math.max(1, br.x - tl.x)}
              height={Math.max(1, br.y - tl.y)}
              fill="none"
              stroke="#18181B"
              strokeWidth="1.25"
              strokeDasharray="5 3"
            />
          );
        })()}

        {/* Single-Selection Interactive Frame + Resize / Rotate / Crop Handles */}
        {singleSelected && !isCroppingLayer && (() => {
          const { layer, world } = singleSelected;
          const tl = worldToScreen({ x: world.x, y: world.y }, liveCamera);
          const sw = world.width * liveCamera.zoom;
          const sh = world.height * liveCamera.zoom;
          const cx = tl.x + sw / 2;
          const cy = tl.y + sh / 2;
          const locked = isLayerEffectivelyLocked(layer.id, studioDoc.layersById);

          const handles: Array<{ id: ResizeHandle; hx: number; hy: number; cursor: string }> = [
            { id: 'nw', hx: tl.x, hy: tl.y, cursor: 'nwse-resize' },
            { id: 'n', hx: tl.x + sw / 2, hy: tl.y, cursor: 'ns-resize' },
            { id: 'ne', hx: tl.x + sw, hy: tl.y, cursor: 'nesw-resize' },
            { id: 'e', hx: tl.x + sw, hy: tl.y + sh / 2, cursor: 'ew-resize' },
            { id: 'se', hx: tl.x + sw, hy: tl.y + sh, cursor: 'nwse-resize' },
            { id: 's', hx: tl.x + sw / 2, hy: tl.y + sh, cursor: 'ns-resize' },
            { id: 'sw', hx: tl.x, hy: tl.y + sh, cursor: 'nesw-resize' },
            { id: 'w', hx: tl.x, hy: tl.y + sh / 2, cursor: 'ew-resize' }
          ];

          return (
            <g transform={`rotate(${world.rotationDeg} ${cx} ${cy})`}>
              <rect
                x={tl.x}
                y={tl.y}
                width={Math.max(1, sw)}
                height={Math.max(1, sh)}
                fill="none"
                stroke={locked ? '#A1A1AA' : '#18181B'}
                strokeWidth="1.5"
              />
              {!locked && (
                <>
                  {/* Rotation Stem + Handle */}
                  <line
                    x1={tl.x + sw / 2}
                    y1={tl.y}
                    x2={tl.x + sw / 2}
                    y2={tl.y - 22}
                    stroke="#18181B"
                    strokeWidth="1"
                  />
                  <circle
                    cx={tl.x + sw / 2}
                    cy={tl.y - 24}
                    r="5"
                    fill="#FFFFFF"
                    stroke="#18181B"
                    strokeWidth="1.5"
                    className="pointer-events-auto cursor-grab"
                    onPointerDown={e => startRotate(e, layer, world)}
                  />
                  {/* 8 Resize Handles */}
                  {handles.map(h => (
                    <rect
                      key={h.id}
                      x={h.hx - 4}
                      y={h.hy - 4}
                      width="8"
                      height="8"
                      rx="1"
                      fill="#FFFFFF"
                      stroke="#18181B"
                      strokeWidth="1.5"
                      style={{ cursor: h.cursor }}
                      className="pointer-events-auto"
                      onPointerDown={e => startResize(e, layer, h.id)}
                    />
                  ))}
                </>
              )}
            </g>
          );
        })()}

        {/* Active Non-Destructive Crop Overlay Handles */}
        {isCroppingLayer && singleSelected && (() => {
          const { world } = singleSelected;
          const tl = worldToScreen({ x: world.x, y: world.y }, liveCamera);
          const sw = world.width * liveCamera.zoom;
          const sh = world.height * liveCamera.zoom;
          const corners: Array<{ id: 'nw' | 'ne' | 'se' | 'sw'; hx: number; hy: number }> = [
            { id: 'nw', hx: tl.x, hy: tl.y },
            { id: 'ne', hx: tl.x + sw, hy: tl.y },
            { id: 'se', hx: tl.x + sw, hy: tl.y + sh },
            { id: 'sw', hx: tl.x, hy: tl.y + sh }
          ];
          return (
            <g>
              <rect
                x={tl.x}
                y={tl.y}
                width={sw}
                height={sh}
                fill="none"
                stroke="#D97706"
                strokeWidth="2"
                strokeDasharray="6 3"
              />
              {corners.map(c => (
                <rect
                  key={c.id}
                  x={c.hx - 5}
                  y={c.hy - 5}
                  width="10"
                  height="10"
                  fill="#F59E0B"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                  className="pointer-events-auto cursor-nwse-resize"
                  onPointerDown={e => startCropDrag(e, isCroppingLayer, world, c.id)}
                />
              ))}
            </g>
          );
        })()}
      </svg>

      {/* Drag-and-Drop Multi-Image Upload Overlay */}
      {isDragOverFiles && (
        <div
          data-testid="studio-drop-overlay"
          className="absolute inset-3 z-30 rounded-sm border-2 border-dashed border-neutral-900 bg-white/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 pointer-events-none"
        >
          <Upload className="w-7 h-7 text-neutral-900" />
          <p className="text-sm font-semibold text-neutral-900">Drop reference images onto board</p>
          <p className="text-xs text-neutral-600">PNG, JPG, or WEBP · Up to 5.0 MB each</p>
        </div>
      )}

      {/* Floating Quiet Canvas Camera Bar (Bottom-Right) */}
      <div
        onPointerDown={e => e.stopPropagation()}
        className="absolute bottom-3 right-3 z-20 flex items-center gap-1 bg-white/95 border border-neutral-300 rounded-sm px-2 py-1 text-[11px] text-neutral-700 shadow-xs"
      >
        <button
          type="button"
          onClick={() => {
            const next = { ...liveCamera, zoom: Math.max(0.2, roundCoord(liveCamera.zoom - 0.15)) };
            setLiveCamera(next);
            setStudioCamera(next);
          }}
          aria-label="Zoom out studio canvas"
          className="px-1.5 py-0.5 hover:bg-neutral-100 rounded-xs font-mono cursor-pointer"
        >
          −
        </button>
        <span className="font-mono tabular-nums px-1 min-w-[42px] text-center">
          {Math.round(liveCamera.zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => {
            const next = { ...liveCamera, zoom: Math.min(4, roundCoord(liveCamera.zoom + 0.15)) };
            setLiveCamera(next);
            setStudioCamera(next);
          }}
          aria-label="Zoom in studio canvas"
          className="px-1.5 py-0.5 hover:bg-neutral-100 rounded-xs font-mono cursor-pointer"
        >
          +
        </button>
        <span className="text-neutral-300 mx-0.5">|</span>
        <button
          type="button"
          onClick={handleFitBoard}
          data-testid="studio-fit-board-btn"
          className="px-1.5 py-0.5 hover:bg-neutral-100 rounded-xs text-[11px] font-medium text-neutral-800 cursor-pointer whitespace-nowrap"
        >
          Fit
        </button>
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <StudioContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetLayer={contextMenu.layer}
          selectedCount={selectedLayerIds.length}
          onClose={() => setContextMenu(null)}
          onDuplicate={() => duplicateLayers([...selectedLayerIds])}
          onGroup={() => groupLayers([...selectedLayerIds])}
          onUngroup={() => ungroupLayer(contextMenu.layer.id)}
          onBringForward={() => reorderLayer(contextMenu.layer.id, 'up')}
          onSendBackward={() => reorderLayer(contextMenu.layer.id, 'down')}
          onToggleLock={() => toggleLayerLock(contextMenu.layer.id)}
          onHide={() => toggleLayerVisibility(contextMenu.layer.id)}
          onSoftDelete={() => {
            softDeleteLayers([...selectedLayerIds]);
            clearLayerSelection();
          }}
        />
      )}
    </div>
  );
};
