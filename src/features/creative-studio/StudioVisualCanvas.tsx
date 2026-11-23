/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  StudioCanvasCamera,
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

interface PendingMoveSnapshot {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
}

const CAMERA_COMMIT_DEBOUNCE_MS = 180;

function safeSetPointerCapture(el: Element | null, pointerId: number): void {
  if (!el || typeof (el as HTMLElement).setPointerCapture !== 'function') return;
  try {
    (el as HTMLElement).setPointerCapture(pointerId);
  } catch {
    // Synthetic PointerEvents without an active native pointer throw NotFoundError.
  }
}

function formatStageTransform(cam: StudioCanvasCamera): string {
  return `translate3d(${cam.panX}px, ${cam.panY}px, 0) scale(${cam.zoom})`;
}

function sameTransformFields(a: LayerTransform, b: LayerTransform): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.rotationDeg === b.rotationDeg &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY
  );
}

interface StudioLayersStageProps {
  stageRef: React.RefObject<HTMLDivElement | null>;
  initialCamera: StudioCanvasCamera;
  visibleLayers: readonly StudioLayer[];
  worldTransformsById: ReadonlyMap<string, LayerTransform>;
  selectedLayerIdSet: ReadonlySet<string>;
  croppingLayerId: string | null;
  assetUrlsById: Readonly<Record<string, string>>;
  onPointerDown: (e: React.PointerEvent, layer: StudioLayer) => void;
  onContextMenu: (e: React.MouseEvent, layer: StudioLayer) => void;
  onRequestReplaceAsset: (layerId: string) => void;
}

const StudioLayersStage: React.FC<StudioLayersStageProps> = React.memo(
  ({
    stageRef,
    initialCamera,
    visibleLayers,
    worldTransformsById,
    selectedLayerIdSet,
    croppingLayerId,
    assetUrlsById,
    onPointerDown,
    onContextMenu,
    onRequestReplaceAsset
  }) => {
    const initialTransformRef = useRef<string>(formatStageTransform(initialCamera));

    // Only write initial transform on mount; subsequent camera transforms are driven
    // directly via stageRef.current.style.transform without overwriting live zoomed state.
    useLayoutEffect(() => {
      if (stageRef.current && !stageRef.current.style.transform) {
        stageRef.current.style.transform = initialTransformRef.current;
      }
    }, [stageRef]);

    return (
      <div
        ref={stageRef}
        data-testid="studio-world-stage"
        style={{
          transformOrigin: '0 0',
          willChange: 'transform'
        }}
        className="absolute top-0 left-0 w-0 h-0 overflow-visible"
      >
        {visibleLayers.map(layer => {
          if (layer.type === 'group') return null;
          const world = worldTransformsById.get(layer.id);
          if (!world) return null;
          return (
            <StudioLayerRenderer
              key={layer.id}
              layer={layer}
              worldTransform={world}
              isSelected={selectedLayerIdSet.has(layer.id)}
              isCropping={croppingLayerId === layer.id}
              assetUrl={layer.type === 'reference-image' ? assetUrlsById[layer.assetId] : undefined}
              onPointerDown={onPointerDown}
              onContextMenu={onContextMenu}
              onRequestReplaceAsset={onRequestReplaceAsset}
            />
          );
        })}
      </div>
    );
  }
);

StudioLayersStage.displayName = 'StudioLayersStage';

interface StudioSvgOverlayProps {
  initialCamera: StudioCanvasCamera;
  syncCameraSetterRef: React.MutableRefObject<((cam: StudioCanvasCamera) => void) | null>;
  snapGuides: readonly SnapGuide[];
  marqueeRect: Rect2D | null;
  liveSketchPoints: readonly SketchPoint[];
  multiUnionWorld: Rect2D | null;
  singleSelected: { layer: StudioLayer; world: LayerTransform } | null;
  isCroppingLayer: ReferenceImageLayer | null;
  layersById: Readonly<Record<string, StudioLayer>>;
  onStartRotate: (e: React.PointerEvent, layer: StudioLayer, world: Rect2D) => void;
  onStartResize: (e: React.PointerEvent, layer: StudioLayer, handle: ResizeHandle) => void;
  onStartCropDrag: (
    e: React.PointerEvent,
    layer: ReferenceImageLayer,
    world: Rect2D,
    handle: 'nw' | 'ne' | 'se' | 'sw'
  ) => void;
}

const StudioSvgOverlay: React.FC<StudioSvgOverlayProps> = React.memo(
  ({
    initialCamera,
    syncCameraSetterRef,
    snapGuides,
    marqueeRect,
    liveSketchPoints,
    multiUnionWorld,
    singleSelected,
    isCroppingLayer,
    layersById,
    onStartRotate,
    onStartResize,
    onStartCropDrag
  }) => {
    const [overlayCamera, setOverlayCamera] = useState<StudioCanvasCamera>(initialCamera);
    const hasActiveGraphics =
      snapGuides.length > 0 ||
      marqueeRect !== null ||
      liveSketchPoints.length >= 2 ||
      multiUnionWorld !== null ||
      singleSelected !== null;

    const hasActiveRef = useRef(hasActiveGraphics);
    hasActiveRef.current = hasActiveGraphics;
    const latestCameraRef = useRef(overlayCamera);
    latestCameraRef.current = overlayCamera;

    useEffect(() => {
      syncCameraSetterRef.current = (cam: StudioCanvasCamera) => {
        latestCameraRef.current = cam;
        // Skip SVG overlay re-renders entirely when nothing is selected or actively drawn.
        if (hasActiveRef.current) {
          setOverlayCamera(cam);
        }
      };
      return () => {
        syncCameraSetterRef.current = null;
      };
    }, [syncCameraSetterRef]);

    // When a selection appears after camera moved while idle, snap overlay to latest camera immediately.
    useLayoutEffect(() => {
      if (hasActiveGraphics) {
        setOverlayCamera(latestCameraRef.current);
      }
    }, [hasActiveGraphics]);

    const cam = overlayCamera;

    return (
      <svg
        data-testid="studio-svg-overlay"
        className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
      >
        {/* Smart Snap Guides */}
        {snapGuides.map((g, idx) => {
          if (g.orientation === 'vertical') {
            const p1 = worldToScreen({ x: g.position, y: g.start }, cam);
            const p2 = worldToScreen({ x: g.position, y: g.end }, cam);
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
          const p1 = worldToScreen({ x: g.start, y: g.position }, cam);
          const p2 = worldToScreen({ x: g.end, y: g.position }, cam);
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
          const tl = worldToScreen({ x: marqueeRect.x, y: marqueeRect.y }, cam);
          const br = worldToScreen(
            { x: marqueeRect.x + marqueeRect.width, y: marqueeRect.y + marqueeRect.height },
            cam
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
            strokeWidth={2.2 * cam.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={liveSketchPoints
              .map(pt => {
                const s = worldToScreen(pt, cam);
                return `${s.x},${s.y}`;
              })
              .join(' ')}
          />
        )}

        {/* Multi-Selection Union Frame */}
        {multiUnionWorld && (() => {
          const tl = worldToScreen({ x: multiUnionWorld.x, y: multiUnionWorld.y }, cam);
          const br = worldToScreen(
            {
              x: multiUnionWorld.x + multiUnionWorld.width,
              y: multiUnionWorld.y + multiUnionWorld.height
            },
            cam
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
          const tl = worldToScreen({ x: world.x, y: world.y }, cam);
          const sw = world.width * cam.zoom;
          const sh = world.height * cam.zoom;
          const cx = tl.x + sw / 2;
          const cy = tl.y + sh / 2;
          const locked = isLayerEffectivelyLocked(layer.id, layersById);

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
                    onPointerDown={e => onStartRotate(e, layer, world)}
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
                      onPointerDown={e => onStartResize(e, layer, h.id)}
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
          const tl = worldToScreen({ x: world.x, y: world.y }, cam);
          const sw = world.width * cam.zoom;
          const sh = world.height * cam.zoom;
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
                  onPointerDown={e => onStartCropDrag(e, isCroppingLayer, world, c.id)}
                />
              ))}
            </g>
          );
        })()}
      </svg>
    );
  }
);

StudioSvgOverlay.displayName = 'StudioSvgOverlay';

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
  const stageRef = useRef<HTMLDivElement | null>(null);
  const gridLayerRef = useRef<HTMLDivElement | null>(null);
  const zoomLabelRef = useRef<HTMLSpanElement | null>(null);
  const syncOverlayCameraRef = useRef<((cam: StudioCanvasCamera) => void) | null>(null);

  const sessionRef = useRef<ActivePointerSession | null>(null);
  const spacePressedRef = useRef<boolean>(false);

  // Authoritative 60fps live camera kept in a ref so pan/zoom never trigger React renders
  // across 50+ layer cards or context consumers during active pointer/wheel gestures.
  const liveCameraRef = useRef<StudioCanvasCamera>(studioDoc.camera);
  const cameraRafRef = useRef<number | null>(null);
  const cameraCommitTimerRef = useRef<number | null>(null);
  const gridStepRef = useRef<number>(Math.max(12, Math.round(24 * studioDoc.camera.zoom)));

  const moveRafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<PendingMoveSnapshot | null>(null);

  const [liveTransformOverrides, setLiveTransformOverrides] = useState<Record<string, LayerTransform>>({});
  const [liveCropOverride, setLiveCropOverride] = useState<{ layerId: string; crop: ReferenceImageLayer['crop'] } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [marqueeRect, setMarqueeRect] = useState<Rect2D | null>(null);
  const [liveSketchPoints, setLiveSketchPoints] = useState<SketchPoint[]>([]);
  const [isDragOverFiles, setIsDragOverFiles] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; layer: StudioLayer } | null>(null);

  // Refs for stable event callbacks (prevents React.memo invalidation on StudioLayerRenderer)
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const selectedLayerIdsRef = useRef(selectedLayerIds);
  selectedLayerIdsRef.current = selectedLayerIds;
  const layersByIdRef = useRef(studioDoc.layersById);
  layersByIdRef.current = studioDoc.layersById;
  const snapEnabledRef = useRef(snapEnabled);
  snapEnabledRef.current = snapEnabled;
  const gridModeRef = useRef(gridMode);
  gridModeRef.current = gridMode;
  const liveTransformOverridesRef = useRef(liveTransformOverrides);
  liveTransformOverridesRef.current = liveTransformOverrides;
  const liveCropOverrideRef = useRef(liveCropOverride);
  liveCropOverrideRef.current = liveCropOverride;
  const marqueeRectRef = useRef(marqueeRect);
  marqueeRectRef.current = marqueeRect;

  const applyCameraToDom = useCallback((cam: StudioCanvasCamera, updateGridStep: boolean) => {
    if (stageRef.current) {
      stageRef.current.style.transform = formatStageTransform(cam);
    }
    if (viewportRef.current) {
      viewportRef.current.dataset.zoom = String(cam.zoom);
    }
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(cam.zoom * 100)}%`;
    }
    if (gridLayerRef.current) {
      if (updateGridStep) {
        const nextStep = Math.max(12, Math.round(24 * cam.zoom));
        gridStepRef.current = nextStep;
        gridLayerRef.current.style.backgroundSize = `${nextStep}px ${nextStep}px`;
      }
      const step = gridStepRef.current || 24;
      gridLayerRef.current.style.transform = `translate3d(${cam.panX % step}px, ${cam.panY % step}px, 0)`;
    }
    syncOverlayCameraRef.current?.(cam);
  }, []);

  const scheduleCameraFrame = useCallback(
    (cam: StudioCanvasCamera, commitToContext: boolean) => {
      liveCameraRef.current = cam;
      if (cameraRafRef.current === null) {
        cameraRafRef.current = window.requestAnimationFrame(() => {
          cameraRafRef.current = null;
          applyCameraToDom(liveCameraRef.current, false);
        });
      }
      if (commitToContext) {
        if (cameraCommitTimerRef.current !== null) {
          window.clearTimeout(cameraCommitTimerRef.current);
        }
        cameraCommitTimerRef.current = window.setTimeout(() => {
          cameraCommitTimerRef.current = null;
          applyCameraToDom(liveCameraRef.current, true);
          setStudioCamera(liveCameraRef.current);
        }, CAMERA_COMMIT_DEBOUNCE_MS);
      }
    },
    [applyCameraToDom, setStudioCamera]
  );

  // Sync camera when document camera updates externally (Fit / Reset / ToolRail +/- / Starter board)
  useEffect(() => {
    liveCameraRef.current = studioDoc.camera;
    applyCameraToDom(studioDoc.camera, true);
  }, [studioDoc.camera, applyCameraToDom]);

  // Clean up pending rAFs and debounce timers on unmount
  useEffect(() => {
    return () => {
      if (cameraRafRef.current !== null) window.cancelAnimationFrame(cameraRafRef.current);
      if (cameraCommitTimerRef.current !== null) window.clearTimeout(cameraCommitTimerRef.current);
      if (moveRafRef.current !== null) window.cancelAnimationFrame(moveRafRef.current);
    };
  }, []);

  // Keep selectedLayerIds valid when layers are deleted or collection changes
  useEffect(() => {
    const validIds = new Set(activeCollectionLayers.map(l => l.id));
    const filtered = selectedLayerIds.filter(id => validIds.has(id));
    if (filtered.length !== selectedLayerIds.length) {
      setSelectedLayerIds(filtered);
    }
  }, [activeCollectionLayers, selectedLayerIds, setSelectedLayerIds]);

  const visibleLayers = useMemo(() => {
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

  const visibleLayersRef = useRef(visibleLayers);
  visibleLayersRef.current = visibleLayers;

  const selectedLayerIdSet = useMemo(() => new Set(selectedLayerIds), [selectedLayerIds]);

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

  // Referentially stable world transforms per layer ID (preserves React.memo hit rate!)
  const worldTransformCacheRef = useRef<Map<string, LayerTransform>>(new Map());
  const worldTransformsById = useMemo(() => {
    const prevCache = worldTransformCacheRef.current;
    const nextMap = new Map<string, LayerTransform>();
    for (const layer of visibleLayers) {
      if (layer.type === 'group') continue;
      const world = resolveWorldTransform(layer.id, effectiveLayersById);
      if (!world) continue;
      const nextTransform: LayerTransform = {
        x: world.x,
        y: world.y,
        width: world.width,
        height: world.height,
        rotationDeg: world.rotationDeg,
        scaleX: world.scaleX,
        scaleY: world.scaleY
      };
      const prev = prevCache.get(layer.id);
      if (prev && sameTransformFields(prev, nextTransform)) {
        nextMap.set(layer.id, prev);
      } else {
        nextMap.set(layer.id, nextTransform);
      }
    }
    worldTransformCacheRef.current = nextMap;
    return nextMap;
  }, [visibleLayers, effectiveLayersById]);

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
      const curSelected = selectedLayerIdsRef.current;
      if (mod && e.key.toLowerCase() === 'd' && curSelected.length > 0) {
        e.preventDefault();
        duplicateLayers([...curSelected]);
        return;
      }
      if (mod && e.key.toLowerCase() === 'g' && curSelected.length >= 2) {
        e.preventDefault();
        groupLayers([...curSelected]);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && curSelected.length > 0) {
        e.preventDefault();
        softDeleteLayers([...curSelected]);
        clearLayerSelection();
        return;
      }
      if (e.key === 'Escape') {
        clearLayerSelection();
        const tool = activeToolRef.current;
        if (tool === 'crop-image' || tool === 'freehand-sketch' || tool === 'place-note') {
          setActiveTool('select');
        }
        return;
      }

      if (!mod && !e.altKey) {
        const lower = e.key.toLowerCase();
        if (lower === 'v') setActiveTool('select');
        else if (lower === 'h') setActiveTool('pan');
        else if (lower === 'c') setActiveTool('crop-image');
        else if (lower === 'b') setActiveTool('freehand-sketch');
        else if (lower === 'n') setActiveTool('place-note');
      }

      if (
        curSelected.length > 0 &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const layersMap = layersByIdRef.current;
        const updates: Record<string, Partial<LayerTransform>> = {};
        for (const id of curSelected) {
          const layer = layersMap[id];
          if (!layer || isLayerEffectivelyLocked(id, layersMap)) continue;
          const localDelta = worldDeltaToParentLocalDelta({ x: dx, y: dy }, layer.parentId, layersMap);
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
    clearLayerSelection,
    commitLayerTransforms,
    duplicateLayers,
    groupLayers,
    redoStudio,
    setActiveTool,
    softDeleteLayers,
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
        scheduleCameraFrame(nextCam, true);
      } else {
        const nextCam = {
          ...currentCam,
          panX: roundCoord(currentCam.panX - e.deltaX),
          panY: roundCoord(currentCam.panY - e.deltaY)
        };
        scheduleCameraFrame(nextCam, true);
      }
    };

    el.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onNativeWheel);
    };
  }, [getLocalScreenPoint, scheduleCameraFrame]);

  // Stable layer pointer down (select + begin drag) — never invalidated by camera or selection changes
  const handleLayerPointerDown = useCallback(
    (e: React.PointerEvent, layer: StudioLayer) => {
      if (e.button === 2) return;
      const tool = activeToolRef.current;
      if (tool === 'pan' || spacePressedRef.current || e.button === 1) {
        return;
      }
      if (tool === 'freehand-sketch' || tool === 'place-note') {
        return;
      }

      e.stopPropagation();
      safeSetPointerCapture(e.currentTarget, e.pointerId);

      const currentSelected = selectedLayerIdsRef.current;
      let nextSelection: string[];
      if (e.shiftKey) {
        toggleLayerSelection(layer.id);
        nextSelection = currentSelected.includes(layer.id)
          ? currentSelected.filter(id => id !== layer.id)
          : [...currentSelected, layer.id];
      } else if (currentSelected.includes(layer.id)) {
        nextSelection = [...currentSelected];
      } else {
        setSelectedLayerIds([layer.id]);
        nextSelection = [layer.id];
      }
      syncSelectionToSharedEntity(layer);

      if (tool === 'crop-image') {
        return;
      }

      const layersMap = layersByIdRef.current;
      const movableIds = nextSelection.filter(
        id => layersMap[id] && !isLayerEffectivelyLocked(id, layersMap)
      );
      if (movableIds.length === 0) return;

      const screenPt = getLocalScreenPoint(e.clientX, e.clientY);
      const startWorld = screenToWorld(screenPt, liveCameraRef.current);
      const initialTransforms: Record<string, LayerTransform> = {};
      const initialWorldRects: Record<string, Rect2D> = {};
      const rects: Rect2D[] = [];
      for (const id of movableIds) {
        initialTransforms[id] = { ...layersMap[id].transform };
        const w = resolveWorldTransform(id, layersMap);
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
    [getLocalScreenPoint, setSelectedLayerIds, syncSelectionToSharedEntity, toggleLayerSelection]
  );

  // Stable context-menu handler — eliminates per-layer inline arrow allocation
  const handleLayerContextMenu = useCallback(
    (e: React.MouseEvent, target: StudioLayer) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedLayerIdsRef.current.includes(target.id)) {
        setSelectedLayerIds([target.id]);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, layer: target });
    },
    [setSelectedLayerIds]
  );

  // Viewport background pointer down (pan / marquee / sketch / place-note)
  const handleViewportPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button === 2) return;
      setContextMenu(null);
      const screenPt = getLocalScreenPoint(e.clientX, e.clientY);
      const cam = liveCameraRef.current;
      const worldPt = screenToWorld(screenPt, cam);
      const tool = activeToolRef.current;

      if (tool === 'pan' || spacePressedRef.current || e.button === 1) {
        safeSetPointerCapture(viewportRef.current, e.pointerId);
        sessionRef.current = {
          kind: 'pan',
          startScreen: screenPt,
          startPan: { x: cam.panX, y: cam.panY }
        };
        return;
      }

      if (tool === 'place-note') {
        const noteId = addAnnotationNote({ x: Math.round(worldPt.x - 115), y: Math.round(worldPt.y - 60) });
        setSelectedLayerIds([noteId]);
        setActiveTool('select');
        return;
      }

      if (tool === 'freehand-sketch') {
        safeSetPointerCapture(viewportRef.current, e.pointerId);
        sessionRef.current = {
          kind: 'sketch',
          pointsWorld: [worldPt]
        };
        setLiveSketchPoints([worldPt]);
        return;
      }

      if (!e.shiftKey) {
        clearLayerSelection();
      }
      safeSetPointerCapture(viewportRef.current, e.pointerId);
      sessionRef.current = {
        kind: 'marquee',
        startWorld: worldPt,
        currentWorld: worldPt,
        additive: e.shiftKey
      };
      setMarqueeRect({ x: worldPt.x, y: worldPt.y, width: 0, height: 0 });
    },
    [addAnnotationNote, clearLayerSelection, getLocalScreenPoint, setActiveTool, setSelectedLayerIds]
  );

  const processPointerMove = useCallback(
    (snapMove: PendingMoveSnapshot) => {
      const session = sessionRef.current;
      if (!session) return;

      const screenPt = getLocalScreenPoint(snapMove.clientX, snapMove.clientY);
      const cam = liveCameraRef.current;
      const worldPt = screenToWorld(screenPt, cam);

      if (session.kind === 'pan') {
        const dx = screenPt.x - session.startScreen.x;
        const dy = screenPt.y - session.startScreen.y;
        const nextCam = {
          ...cam,
          panX: roundCoord(session.startPan.x + dx),
          panY: roundCoord(session.startPan.y + dy)
        };
        liveCameraRef.current = nextCam;
        applyCameraToDom(nextCam, false);
        return;
      }

      const layersMap = layersByIdRef.current;
      if (session.kind === 'drag') {
        let rawDx = worldPt.x - session.startWorld.x;
        let rawDy = worldPt.y - session.startWorld.y;

        if (snapEnabledRef.current && !snapMove.altKey) {
          const movingAabb: Rect2D = {
            x: session.unionStartRect.x + rawDx,
            y: session.unionStartRect.y + rawDy,
            width: session.unionStartRect.width,
            height: session.unionStartRect.height
          };
          const selectedSet = new Set(session.layerIds);
          const targets: Array<{ id: string; rect: Rect2D }> = [];
          for (const other of visibleLayersRef.current) {
            if (other.type === 'group' || selectedSet.has(other.id)) continue;
            const w = resolveWorldTransform(other.id, layersMap);
            if (w) targets.push({ id: other.id, rect: getRotatedAabb(w) });
          }
          const snap = computeSmartSnap({
            movingAabb,
            targetAabbs: targets,
            zoom: cam.zoom,
            gridSizeWorld: gridModeRef.current !== 'off' ? 20 : undefined
          });
          rawDx += snap.dx;
          rawDy += snap.dy;
          setSnapGuides(snap.guides);
        } else {
          setSnapGuides(prev => (prev.length === 0 ? prev : []));
        }

        const overrides: Record<string, LayerTransform> = {};
        for (const id of session.layerIds) {
          const layer = layersMap[id];
          const init = session.initialTransforms[id];
          if (!layer || !init) continue;
          const localDelta = worldDeltaToParentLocalDelta(
            { x: rawDx, y: rawDy },
            layer.parentId,
            layersMap
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

        if (snapMove.shiftKey && session.handle.length === 2 && init.height > 0) {
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
        if (snapMove.shiftKey) {
          nextRot = normalizeAngleDeg(Math.round(nextRot / 15) * 15);
        }
        const orig = layersMap[session.layerId];
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
    [applyCameraToDom, getLocalScreenPoint]
  );

  // Coalesced pointer move handler (at most 1 frame update per rAF)
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const session = sessionRef.current;
      if (!session) return;

      pendingMoveRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        altKey: e.altKey
      };

      if (session.kind === 'pan') {
        // Pan is zero-React-render DOM compositing: coalesce with cameraRafRef cleanly
        if (moveRafRef.current === null) {
          moveRafRef.current = window.requestAnimationFrame(() => {
            moveRafRef.current = null;
            const pending = pendingMoveRef.current;
            pendingMoveRef.current = null;
            if (pending) processPointerMove(pending);
          });
        }
        return;
      }

      if (moveRafRef.current === null) {
        moveRafRef.current = window.requestAnimationFrame(() => {
          moveRafRef.current = null;
          const pending = pendingMoveRef.current;
          pendingMoveRef.current = null;
          if (pending) processPointerMove(pending);
        });
      }
    },
    [processPointerMove]
  );

  // Commit interaction cleanly on pointerup (flushing any queued rAF move synchronously first)
  const handlePointerUp = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;

    if (moveRafRef.current !== null) {
      window.cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (pending) {
      processPointerMove(pending);
    }

    sessionRef.current = null;

    if (session.kind === 'pan') {
      applyCameraToDom(liveCameraRef.current, true);
      setStudioCamera(liveCameraRef.current);
      return;
    }

    if (session.kind === 'drag' || session.kind === 'resize' || session.kind === 'rotate') {
      const overrides = liveTransformOverridesRef.current;
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
      const box = marqueeRectRef.current;
      setMarqueeRect(null);
      if (box && (box.width > 4 || box.height > 4)) {
        const hits: string[] = [];
        const layersMap = layersByIdRef.current;
        for (const layer of visibleLayersRef.current) {
          if (layer.type === 'group' || layer.locked) continue;
          const w = resolveWorldTransform(layer.id, layersMap);
          if (!w) continue;
          if (rectsIntersect(box, getRotatedAabb(w))) {
            hits.push(layer.id);
          }
        }
        setSelectedLayerIds(session.additive ? [...selectedLayerIdsRef.current, ...hits] : hits);
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
      const override = liveCropOverrideRef.current;
      setLiveCropOverride(null);
      if (override) {
        setImageCrop(override.layerId, override.crop);
      }
    }
  }, [
    addFreehandSketchStroke,
    applyCameraToDom,
    commitLayerTransforms,
    processPointerMove,
    setImageCrop,
    setSelectedLayerIds,
    setStudioCamera
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
    const worldPt = screenToWorld(screenPt, liveCameraRef.current);
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

  // Compute selection overlay bounds in world coordinates
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

  const commitExplicitCamera = useCallback(
    (cam: StudioCanvasCamera) => {
      if (cameraCommitTimerRef.current !== null) {
        window.clearTimeout(cameraCommitTimerRef.current);
        cameraCommitTimerRef.current = null;
      }
      liveCameraRef.current = cam;
      applyCameraToDom(cam, true);
      setStudioCamera(cam);
    },
    [applyCameraToDom, setStudioCamera]
  );

  const handleFitBoard = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rects = visibleLayers
      .filter(l => l.type !== 'group')
      .map(l => resolveWorldTransform(l.id, studioDoc.layersById))
      .filter((w): w is NonNullable<typeof w> => Boolean(w))
      .map(w => getRotatedAabb(w));
    const cam = computeFitCamera(rects, vp.clientWidth, vp.clientHeight, 64);
    commitExplicitCamera(cam);
  };

  const startResize = useCallback(
    (e: React.PointerEvent, layer: StudioLayer, handle: ResizeHandle) => {
      e.stopPropagation();
      if (isLayerEffectivelyLocked(layer.id, layersByIdRef.current)) return;
      safeSetPointerCapture(viewportRef.current, e.pointerId);
      const startWorld = screenToWorld(getLocalScreenPoint(e.clientX, e.clientY), liveCameraRef.current);
      sessionRef.current = {
        kind: 'resize',
        layerId: layer.id,
        handle,
        startWorld,
        initialTransform: { ...layer.transform }
      };
    },
    [getLocalScreenPoint]
  );

  const startRotate = useCallback(
    (e: React.PointerEvent, layer: StudioLayer, world: Rect2D) => {
      e.stopPropagation();
      if (isLayerEffectivelyLocked(layer.id, layersByIdRef.current)) return;
      safeSetPointerCapture(viewportRef.current, e.pointerId);
      const startWorld = screenToWorld(getLocalScreenPoint(e.clientX, e.clientY), liveCameraRef.current);
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
    },
    [getLocalScreenPoint]
  );

  const startCropDrag = useCallback(
    (
      e: React.PointerEvent,
      layer: ReferenceImageLayer,
      world: Rect2D,
      handle: 'nw' | 'ne' | 'se' | 'sw'
    ) => {
      e.stopPropagation();
      safeSetPointerCapture(viewportRef.current, e.pointerId);
      const startWorld = screenToWorld(getLocalScreenPoint(e.clientX, e.clientY), liveCameraRef.current);
      sessionRef.current = {
        kind: 'crop',
        layerId: layer.id,
        handle,
        startWorld,
        layerWorld: world,
        initialCrop: { ...layer.crop }
      };
    },
    [getLocalScreenPoint]
  );

  const showCleanFirstLoad = !studioDoc.hasInitializedBoard && visibleLayers.length === 0;

  const gridLayerBaseStyle = useMemo<React.CSSProperties | undefined>(() => {
    const step = Math.max(12, Math.round(24 * studioDoc.camera.zoom));
    gridStepRef.current = step;
    if (gridMode === 'dots') {
      return {
        backgroundImage: 'radial-gradient(rgba(24, 24, 27, 0.14) 1px, transparent 1px)',
        backgroundSize: `${step}px ${step}px`,
        transform: `translate3d(${liveCameraRef.current.panX % step}px, ${liveCameraRef.current.panY % step}px, 0)`,
        willChange: 'transform'
      };
    }
    if (gridMode === 'grid') {
      return {
        backgroundImage:
          'linear-gradient(to right, rgba(24, 24, 27, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(24, 24, 27, 0.06) 1px, transparent 1px)',
        backgroundSize: `${step}px ${step}px`,
        transform: `translate3d(${liveCameraRef.current.panX % step}px, ${liveCameraRef.current.panY % step}px, 0)`,
        willChange: 'transform'
      };
    }
    return undefined;
  }, [gridMode, studioDoc.camera.zoom]);

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
      data-zoom={liveCameraRef.current.zoom}
      data-layer-count={visibleLayers.length}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex-1 min-w-0 min-h-0 h-full overflow-hidden bg-[#EFECE5] select-none touch-none ${cursorClass}`}
    >
      {/* Composited Backdrop Grid (translated via GPU transform rather than CSS background-position repaints) */}
      {gridMode !== 'off' && (
        <div
          ref={gridLayerRef}
          aria-hidden="true"
          style={gridLayerBaseStyle}
          className="pointer-events-none absolute -inset-16 z-0"
        />
      )}

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

      {/* GPU-Composited World Stage (DOM/CSS Layers — Isolated from high-frequency camera ticks) */}
      <StudioLayersStage
        stageRef={stageRef}
        initialCamera={studioDoc.camera}
        visibleLayers={visibleLayers}
        worldTransformsById={worldTransformsById}
        selectedLayerIdSet={selectedLayerIdSet}
        croppingLayerId={isCroppingLayer?.id ?? null}
        assetUrlsById={assetUrlsById}
        onPointerDown={handleLayerPointerDown}
        onContextMenu={handleLayerContextMenu}
        onRequestReplaceAsset={onRequestReplaceAsset}
      />

      {/* Synchronized Zoom-Invariant SVG Overlay (Selection Boxes, Handles, Guides, Marquee, Live Sketch) */}
      <StudioSvgOverlay
        initialCamera={studioDoc.camera}
        syncCameraSetterRef={syncOverlayCameraRef}
        snapGuides={snapGuides}
        marqueeRect={marqueeRect}
        liveSketchPoints={liveSketchPoints}
        multiUnionWorld={multiUnionWorld}
        singleSelected={singleSelected}
        isCroppingLayer={isCroppingLayer}
        layersById={studioDoc.layersById}
        onStartRotate={startRotate}
        onStartResize={startResize}
        onStartCropDrag={startCropDrag}
      />

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
            const cur = liveCameraRef.current;
            commitExplicitCamera({
              ...cur,
              zoom: Math.max(0.2, roundCoord(cur.zoom - 0.15))
            });
          }}
          aria-label="Zoom out studio canvas"
          className="px-1.5 py-0.5 hover:bg-neutral-100 rounded-xs font-mono cursor-pointer"
        >
          −
        </button>
        <span ref={zoomLabelRef} className="font-mono tabular-nums px-1 min-w-[42px] text-center">
          {Math.round(liveCameraRef.current.zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => {
            const cur = liveCameraRef.current;
            commitExplicitCamera({
              ...cur,
              zoom: Math.min(4, roundCoord(cur.zoom + 0.15))
            });
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
