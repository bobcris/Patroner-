/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  X,
  Scissors,
  Image as ImageIcon,
  Layers,
  Box,
  FileCheck2,
  StickyNote,
  Trash2,
  ArrowUpRight,
  Sliders,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Copy,
  FolderPlus,
  Ungroup,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  RotateCcw,
  Plus,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { useProjectWorkspace } from '../../state/ProjectWorkspaceContext';
import {
  useViewportInteraction,
  SelectedEntity
} from '../../state/ViewportInteractionContext';
import { useOptionalCreativeStudio } from '../../features/creative-studio/CreativeStudioContext';
import type {
  AlignmentAxis,
  PaletteSwatch,
  StudioLayer
} from '../../features/creative-studio/types';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function studioLayerTypeLabel(type: StudioLayer['type']): string {
  switch (type) {
    case 'reference-image':
      return 'Reference Image';
    case 'moodboard-card':
      return 'Moodboard Card';
    case 'color-palette':
      return 'Color Palette';
    case 'fabric-swatch':
      return 'Fabric Swatch';
    case 'garment-silhouette-card':
      return 'Concept Silhouette';
    case 'freehand-sketch':
      return 'Freehand Sketch';
    case 'annotation-note':
      return 'Visual Note';
    case 'group':
      return 'Layer Group';
  }
}

/**
 * Designer-facing contextual inspector.
 *
 * Intentionally excludes internal digest hashes, raw gate configuration, and low-level
 * engineering dumps; those remain accessible via the dedicated Engineering Health dock tab.
 */
export const ContextualInspector: React.FC = React.memo(() => {
  const {
    currentSpec,
    activeSize,
    referenceImage,
    setReferenceImage,
    workspaceBundle
  } = useProjectWorkspace();

  const {
    activeEnvironment,
    selectedEntity,
    selectEntity,
    selectedLayerIds,
    setSelectedLayerIds,
    clearLayerSelection,
    inspectorOpen,
    setInspectorOpen,
    setEnvironment,
    setSimProdSubView,
    openDockTab,
    camera,
    ephemeralOverlays,
    addEphemeralOverlay,
    removeEphemeralOverlay
  } = useViewportInteraction();

  const studio = useOptionalCreativeStudio();

  if (!inspectorOpen) return null;

  const isStudioEnv = activeEnvironment === 'creative-studio' && Boolean(studio);
  const selectedStudioLayers: StudioLayer[] =
    isStudioEnv && studio
      ? selectedLayerIds
          .map(id => studio.document.layersById[id])
          .filter((layer): layer is StudioLayer => Boolean(layer))
      : [];
  const primaryStudioLayer =
    selectedStudioLayers.length === 1 ? selectedStudioLayers[0] : null;
  const isMultiStudioSelection = selectedStudioLayers.length >= 2;

  const pieces = workspaceBundle.pieces;
  const activePiece =
    selectedEntity?.kind === 'pattern-piece' || selectedEntity?.kind === 'seam'
      ? pieces.find(p => p.id === selectedEntity.pieceId)
      : selectedEntity?.kind === 'simulation-entity' && selectedEntity.pieceId
        ? pieces.find(p => p.id === selectedEntity.pieceId)
        : selectedEntity?.kind === 'production-entity' && selectedEntity.pieceId
          ? pieces.find(p => p.id === selectedEntity.pieceId)
          : undefined;

  const envNotes = ephemeralOverlays.filter(note => note.environment === activeEnvironment);

  const entityKindLabel = (entity: SelectedEntity | null): string => {
    if (isStudioEnv && isMultiStudioSelection) {
      return `Multi-Selection (${selectedStudioLayers.length})`;
    }
    if (isStudioEnv && primaryStudioLayer) {
      return studioLayerTypeLabel(primaryStudioLayer.type);
    }
    if (!entity) return 'Project Overview';
    switch (entity.kind) {
      case 'reference-image':
        return 'Reference Image';
      case 'garment-element':
        return 'Garment Concept';
      case 'pattern-piece':
        return 'Pattern Piece';
      case 'seam':
        return 'Seamline';
      case 'simulation-entity':
        return 'Prototype Simulation';
      case 'production-entity':
        return 'Production Output';
    }
  };

  const commitNumericTransform = (
    layer: StudioLayer,
    field: 'x' | 'y' | 'width' | 'height' | 'rotationDeg',
    rawValue: string
  ) => {
    if (!studio || layer.locked) return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    studio.commitLayerTransforms(
      { [layer.id]: { [field]: parsed } },
      `Adjust ${layer.name} ${field}`
    );
  };

  const handleAlign = (axis: AlignmentAxis) => {
    if (!studio || selectedStudioLayers.length < 2) return;
    studio.alignLayers(
      selectedStudioLayers.map(l => l.id),
      axis
    );
  };

  const activeZoomPct =
    isStudioEnv && studio
      ? Math.round(studio.document.camera.zoom * 100)
      : Math.round(camera.zoom * 100);

  return (
    <>
      {/* Tablet backdrop when inspector renders as slide-over (< 1024px) */}
      <div
        className="fixed inset-0 bg-neutral-950/30 z-20 lg:hidden"
        onClick={() => setInspectorOpen(false)}
        aria-hidden="true"
      />

      <aside
        aria-label="Contextual Object Inspector"
        data-testid="contextual-inspector"
        className="fixed right-0 top-12 bottom-0 z-30 w-[280px] shadow-2xl lg:static lg:shadow-none lg:w-[272px] xl:w-[292px] shrink-0 bg-white border-l border-neutral-200 flex flex-col overflow-hidden"
      >
        {/* Inspector Header */}
        <div className="h-10 px-3.5 border-b border-neutral-200 flex items-center justify-between gap-2 shrink-0 bg-neutral-50">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-neutral-900 block truncate">
              {entityKindLabel(selectedEntity)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setInspectorOpen(false)}
            aria-label="Close inspector"
            data-testid="close-inspector-btn"
            className="p-1 text-neutral-500 hover:text-neutral-900 rounded-xs hover:bg-neutral-200/70 cursor-pointer transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable Inspector Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-5 text-xs">
          {/* 0A. Creative Studio Multi-Selection Inspector (UX-2.2) */}
          {isStudioEnv && studio && isMultiStudioSelection && (
            <section className="space-y-3.5" data-testid="inspector-studio-multi">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-neutral-500 tracking-wide">
                  {selectedStudioLayers.length} Layers Selected
                </span>
                <button
                  type="button"
                  onClick={clearLayerSelection}
                  className="text-[11px] text-neutral-600 hover:text-neutral-900 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>

              {/* Alignment & Distribution */}
              <div className="space-y-2 pt-1 border-t border-neutral-100">
                <span className="text-[11px] font-medium text-neutral-500 block">
                  Align &amp; Distribute
                </span>
                <div className="grid grid-cols-6 gap-1">
                  <button
                    type="button"
                    onClick={() => handleAlign('align-left')}
                    title="Align Left"
                    aria-label="Align Left"
                    data-testid="align-left-btn"
                    className="h-7 flex items-center justify-center border border-neutral-200 rounded-xs hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                  >
                    <AlignStartVertical className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAlign('align-center-x')}
                    title="Align Horizontal Center"
                    aria-label="Align Horizontal Center"
                    data-testid="align-center-x-btn"
                    className="h-7 flex items-center justify-center border border-neutral-200 rounded-xs hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                  >
                    <AlignCenterVertical className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAlign('align-right')}
                    title="Align Right"
                    aria-label="Align Right"
                    data-testid="align-right-btn"
                    className="h-7 flex items-center justify-center border border-neutral-200 rounded-xs hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                  >
                    <AlignEndVertical className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAlign('align-top')}
                    title="Align Top"
                    aria-label="Align Top"
                    data-testid="align-top-btn"
                    className="h-7 flex items-center justify-center border border-neutral-200 rounded-xs hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                  >
                    <AlignStartHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAlign('align-center-y')}
                    title="Align Vertical Center"
                    aria-label="Align Vertical Center"
                    data-testid="align-center-y-btn"
                    className="h-7 flex items-center justify-center border border-neutral-200 rounded-xs hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                  >
                    <AlignCenterHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAlign('align-bottom')}
                    title="Align Bottom"
                    aria-label="Align Bottom"
                    data-testid="align-bottom-btn"
                    className="h-7 flex items-center justify-center border border-neutral-200 rounded-xs hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                  >
                    <AlignEndHorizontal className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={selectedStudioLayers.length < 3}
                    onClick={() => handleAlign('distribute-horizontal')}
                    data-testid="distribute-horizontal-btn"
                    className="h-7 px-2 flex items-center justify-center gap-1.5 border border-neutral-200 rounded-xs text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <AlignHorizontalSpaceAround className="w-3.5 h-3.5" />
                    Distribute H
                  </button>
                  <button
                    type="button"
                    disabled={selectedStudioLayers.length < 3}
                    onClick={() => handleAlign('distribute-vertical')}
                    data-testid="distribute-vertical-btn"
                    className="h-7 px-2 flex items-center justify-center gap-1.5 border border-neutral-200 rounded-xs text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <AlignVerticalSpaceAround className="w-3.5 h-3.5" />
                    Distribute V
                  </button>
                </div>
              </div>

              {/* Group / Duplicate / Trash Actions */}
              <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => {
                    studio.groupLayers(selectedStudioLayers.map(l => l.id));
                    clearLayerSelection();
                  }}
                  data-testid="inspector-group-layers-btn"
                  className="px-2.5 py-1.5 text-[11px] font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  Group
                </button>
                <button
                  type="button"
                  onClick={() => studio.duplicateLayers(selectedStudioLayers.map(l => l.id))}
                  data-testid="inspector-duplicate-multi-btn"
                  className="px-2.5 py-1.5 text-[11px] font-medium border border-neutral-300 hover:bg-neutral-100 text-neutral-800 rounded-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Duplicate
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  studio.softDeleteLayers(selectedStudioLayers.map(l => l.id));
                  clearLayerSelection();
                }}
                data-testid="inspector-trash-multi-btn"
                className="w-full px-2.5 py-1.5 text-[11px] font-medium border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Move Selected to Trash
              </button>

              {/* Selected layers quick list */}
              <div className="pt-2 border-t border-neutral-100 space-y-1">
                <span className="text-[11px] font-medium text-neutral-500 block">
                  Selection Members
                </span>
                <ul className="space-y-1">
                  {selectedStudioLayers.map(layer => (
                    <li key={layer.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedLayerIds([layer.id])}
                        className="w-full px-2 py-1 text-left text-[11px] text-neutral-800 hover:bg-neutral-100 rounded-xs border border-neutral-100 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <span className="truncate">{layer.name}</span>
                        <span className="text-[10px] text-neutral-400 shrink-0">
                          {studioLayerTypeLabel(layer.type)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* 0B. Creative Studio Single-Layer Inspector (UX-2.2) */}
          {isStudioEnv && studio && primaryStudioLayer && (
            <section className="space-y-3.5" data-testid="inspector-studio-layer">
              {/* Layer Name + Visibility / Lock */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    aria-label="Layer name"
                    data-testid="inspector-layer-name-input"
                    value={primaryStudioLayer.name}
                    onChange={e => studio.renameLayer(primaryStudioLayer.id, e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1 text-xs font-medium text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs focus:outline-none focus:border-neutral-900"
                  />
                  <button
                    type="button"
                    onClick={() => studio.toggleLayerVisibility(primaryStudioLayer.id)}
                    aria-label={primaryStudioLayer.visible ? 'Hide layer' : 'Show layer'}
                    title={primaryStudioLayer.visible ? 'Hide layer' : 'Show layer'}
                    data-testid="inspector-layer-visibility-btn"
                    className="p-1.5 border border-neutral-200 rounded-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
                  >
                    {primaryStudioLayer.visible ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-neutral-400" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => studio.toggleLayerLock(primaryStudioLayer.id)}
                    aria-label={primaryStudioLayer.locked ? 'Unlock layer' : 'Lock layer'}
                    title={primaryStudioLayer.locked ? 'Unlock layer' : 'Lock layer'}
                    data-testid="inspector-layer-lock-btn"
                    className="p-1.5 border border-neutral-200 rounded-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
                  >
                    {primaryStudioLayer.locked ? (
                      <Lock className="w-3.5 h-3.5 text-amber-700" />
                    ) : (
                      <Unlock className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Opacity */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-neutral-500">
                    <label htmlFor="inspector-layer-opacity">Opacity</label>
                    <span className="font-mono tabular-nums text-neutral-900">
                      {Math.round(primaryStudioLayer.opacity * 100)}%
                    </span>
                  </div>
                  <input
                    id="inspector-layer-opacity"
                    type="range"
                    min={10}
                    max={100}
                    step={1}
                    disabled={primaryStudioLayer.locked}
                    value={Math.round(primaryStudioLayer.opacity * 100)}
                    onChange={e =>
                      studio.updateLayerProps(
                        primaryStudioLayer.id,
                        { opacity: Number(e.target.value) / 100 },
                        `Set ${primaryStudioLayer.name} opacity`
                      )
                    }
                    className="w-full accent-neutral-900 cursor-pointer"
                  />
                </div>
              </div>

              {/* Transform Inputs (X, Y, W, H, Rotation) */}
              <div className="pt-2.5 border-t border-neutral-100 space-y-2">
                <span className="text-[11px] font-semibold text-neutral-500 tracking-wide block">
                  Canvas Transform (px)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-neutral-500 block">X</span>
                    <input
                      type="number"
                      data-testid="inspector-transform-x"
                      disabled={primaryStudioLayer.locked}
                      value={Math.round(primaryStudioLayer.transform.x)}
                      onChange={e => commitNumericTransform(primaryStudioLayer, 'x', e.target.value)}
                      className="w-full px-2 py-1 font-mono tabular-nums text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs disabled:opacity-50"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-neutral-500 block">Y</span>
                    <input
                      type="number"
                      data-testid="inspector-transform-y"
                      disabled={primaryStudioLayer.locked}
                      value={Math.round(primaryStudioLayer.transform.y)}
                      onChange={e => commitNumericTransform(primaryStudioLayer, 'y', e.target.value)}
                      className="w-full px-2 py-1 font-mono tabular-nums text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs disabled:opacity-50"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-neutral-500 block">Width</span>
                    <input
                      type="number"
                      min={24}
                      max={8000}
                      data-testid="inspector-transform-w"
                      disabled={primaryStudioLayer.locked}
                      value={Math.round(primaryStudioLayer.transform.width)}
                      onChange={e => commitNumericTransform(primaryStudioLayer, 'width', e.target.value)}
                      className="w-full px-2 py-1 font-mono tabular-nums text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs disabled:opacity-50"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-neutral-500 block">Height</span>
                    <input
                      type="number"
                      min={24}
                      max={8000}
                      data-testid="inspector-transform-h"
                      disabled={primaryStudioLayer.locked}
                      value={Math.round(primaryStudioLayer.transform.height)}
                      onChange={e => commitNumericTransform(primaryStudioLayer, 'height', e.target.value)}
                      className="w-full px-2 py-1 font-mono tabular-nums text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs disabled:opacity-50"
                    />
                  </label>
                  <label className="col-span-2 space-y-0.5">
                    <span className="text-[10px] text-neutral-500 block">Rotation (°)</span>
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      data-testid="inspector-transform-rot"
                      disabled={primaryStudioLayer.locked}
                      value={Math.round(primaryStudioLayer.transform.rotationDeg)}
                      onChange={e =>
                        commitNumericTransform(primaryStudioLayer, 'rotationDeg', e.target.value)
                      }
                      className="w-full px-2 py-1 font-mono tabular-nums text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs disabled:opacity-50"
                    />
                  </label>
                </div>
              </div>

              {/* Type-Specific Properties */}
              {primaryStudioLayer.type === 'reference-image' && (
                <div className="pt-2.5 border-t border-neutral-100 space-y-2.5" data-testid="inspector-studio-reference-image">
                  <span className="text-[11px] font-semibold text-neutral-500 tracking-wide block">
                    Reference Image &amp; Non-Destructive Crop
                  </span>
                  {studio.assetUrlsById[primaryStudioLayer.assetId] ? (
                    <div className="rounded-xs overflow-hidden border border-neutral-200 bg-neutral-50">
                      <img
                        src={studio.assetUrlsById[primaryStudioLayer.assetId]}
                        alt={primaryStudioLayer.assetName}
                        className="w-full h-24 object-cover"
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xs px-2 py-1.5">
                      {primaryStudioLayer.missingAssetReason === 'permanently-purged'
                        ? 'Original image asset was permanently purged. Relink from the canvas frame.'
                        : 'Image binary not available in current storage session.'}
                    </p>
                  )}

                  <dl className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <dt className="text-neutral-500">Pixel Dimensions</dt>
                      <dd className="font-mono tabular-nums text-neutral-900">
                        {primaryStudioLayer.naturalWidth} × {primaryStudioLayer.naturalHeight} px
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">File Size</dt>
                      <dd className="font-mono tabular-nums text-neutral-900">
                        {formatFileSize(primaryStudioLayer.sizeBytes)}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-[10px] text-neutral-500 leading-relaxed">
                    Pixel dimensions are visual canvas metrics only and never represent garment measurements.
                  </p>

                  {/* Non-destructive crop sliders */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-neutral-600">Crop Region</span>
                      <button
                        type="button"
                        disabled={primaryStudioLayer.locked}
                        onClick={() =>
                          studio.setImageCrop(primaryStudioLayer.id, {
                            x: 0,
                            y: 0,
                            width: 1,
                            height: 1
                          })
                        }
                        data-testid="inspector-reset-crop-btn"
                        className="text-[11px] text-neutral-700 hover:text-neutral-900 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reset
                      </button>
                    </div>
                    {(
                      [
                        ['x', 'Left', primaryStudioLayer.crop.x],
                        ['y', 'Top', primaryStudioLayer.crop.y],
                        ['width', 'Width', primaryStudioLayer.crop.width],
                        ['height', 'Height', primaryStudioLayer.crop.height]
                      ] as const
                    ).map(([key, label, val]) => (
                      <div key={key} className="flex items-center gap-2 text-[11px]">
                        <span className="w-10 text-neutral-500 shrink-0">{label}</span>
                        <input
                          type="range"
                          min={key === 'width' || key === 'height' ? 10 : 0}
                          max={key === 'width' || key === 'height' ? 100 : 90}
                          step={1}
                          disabled={primaryStudioLayer.locked}
                          value={Math.round(val * 100)}
                          onChange={e =>
                            studio.setImageCrop(primaryStudioLayer.id, {
                              [key]: Number(e.target.value) / 100
                            })
                          }
                          aria-label={`Crop ${label}`}
                          className="flex-1 accent-neutral-900 cursor-pointer"
                        />
                        <span className="w-8 text-right font-mono tabular-nums text-neutral-700">
                          {Math.round(val * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-neutral-500">Caption</span>
                    <input
                      type="text"
                      disabled={primaryStudioLayer.locked}
                      value={primaryStudioLayer.caption ?? ''}
                      placeholder="Visual silhouette or trim cue..."
                      onChange={e =>
                        studio.updateLayerProps(
                          primaryStudioLayer.id,
                          { caption: e.target.value } as Partial<StudioLayer>,
                          'Update reference caption'
                        )
                      }
                      className="w-full px-2 py-1 text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs"
                    />
                  </label>
                </div>
              )}

              {primaryStudioLayer.type === 'color-palette' && (
                <div className="pt-2.5 border-t border-neutral-100 space-y-2.5" data-testid="inspector-studio-palette">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-neutral-500 tracking-wide">
                      Color Swatches
                    </span>
                    <button
                      type="button"
                      disabled={primaryStudioLayer.locked}
                      onClick={() => {
                        const next: PaletteSwatch[] = [
                          ...primaryStudioLayer.swatches,
                          {
                            id: `sw-${Date.now().toString(36)}`,
                            name: 'New Tone',
                            hex: '#7A746C',
                            role: 'accent'
                          }
                        ];
                        studio.updatePaletteSwatches(primaryStudioLayer.id, next);
                      }}
                      data-testid="inspector-add-swatch-btn"
                      className="text-[11px] font-medium text-neutral-800 hover:underline flex items-center gap-0.5 cursor-pointer disabled:opacity-40"
                    >
                      <Plus className="w-3 h-3" />
                      Add swatch
                    </button>
                  </div>

                  <div className="space-y-2">
                    {primaryStudioLayer.swatches.map((swatch, idx) => (
                      <div
                        key={swatch.id}
                        className="p-2 border border-neutral-200 rounded-xs bg-neutral-50/70 space-y-1.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            aria-label={`Color for ${swatch.name}`}
                            disabled={primaryStudioLayer.locked}
                            value={swatch.hex}
                            onChange={e => {
                              const next = primaryStudioLayer.swatches.map((s, i) =>
                                i === idx ? { ...s, hex: e.target.value } : s
                              );
                              studio.updatePaletteSwatches(primaryStudioLayer.id, next);
                            }}
                            className="w-6 h-6 p-0 border border-neutral-300 rounded-xs cursor-pointer shrink-0"
                          />
                          <input
                            type="text"
                            aria-label={`Name for swatch ${idx + 1}`}
                            disabled={primaryStudioLayer.locked}
                            value={swatch.name}
                            onChange={e => {
                              const next = primaryStudioLayer.swatches.map((s, i) =>
                                i === idx ? { ...s, name: e.target.value } : s
                              );
                              studio.updatePaletteSwatches(primaryStudioLayer.id, next);
                            }}
                            className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px] bg-white border border-neutral-200 rounded-xs"
                          />
                          {primaryStudioLayer.swatches.length > 1 && (
                            <button
                              type="button"
                              disabled={primaryStudioLayer.locked}
                              aria-label={`Remove swatch ${swatch.name}`}
                              onClick={() => {
                                const next = primaryStudioLayer.swatches.filter((_, i) => i !== idx);
                                studio.updatePaletteSwatches(primaryStudioLayer.id, next);
                              }}
                              className="p-1 text-neutral-400 hover:text-rose-700 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="font-mono text-neutral-500 uppercase">{swatch.hex}</span>
                          <select
                            aria-label={`Role for ${swatch.name}`}
                            disabled={primaryStudioLayer.locked}
                            value={swatch.role}
                            onChange={e => {
                              const next = primaryStudioLayer.swatches.map((s, i) =>
                                i === idx
                                  ? { ...s, role: e.target.value as PaletteSwatch['role'] }
                                  : s
                              );
                              studio.updatePaletteSwatches(primaryStudioLayer.id, next);
                            }}
                            className="px-1.5 py-0.5 bg-white border border-neutral-200 rounded-xs text-[10px] text-neutral-700"
                          >
                            <option value="primary">Primary</option>
                            <option value="secondary">Secondary</option>
                            <option value="accent">Accent</option>
                            <option value="lining">Lining</option>
                            <option value="trim">Trim</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>

                  {primaryStudioLayer.swatches[0] && (
                    <button
                      type="button"
                      onClick={() =>
                        studio.updateConcept({
                          colorName: primaryStudioLayer.swatches[0].name,
                          colorHex: primaryStudioLayer.swatches[0].hex
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-xs cursor-pointer"
                    >
                      Apply Primary Swatch to Brief
                    </button>
                  )}
                </div>
              )}

              {primaryStudioLayer.type === 'moodboard-card' && (
                <div className="pt-2.5 border-t border-neutral-100 space-y-2" data-testid="inspector-studio-moodboard">
                  <span className="text-[11px] font-semibold text-neutral-500 tracking-wide block">
                    Moodboard Card Content
                  </span>
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-neutral-500">Title</span>
                    <input
                      type="text"
                      disabled={primaryStudioLayer.locked}
                      value={primaryStudioLayer.title}
                      onChange={e =>
                        studio.updateLayerProps(
                          primaryStudioLayer.id,
                          { title: e.target.value } as Partial<StudioLayer>,
                          'Edit moodboard title'
                        )
                      }
                      className="w-full px-2 py-1 text-xs bg-neutral-50 border border-neutral-200 rounded-xs"
                    />
                  </label>
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-neutral-500">Subtitle</span>
                    <input
                      type="text"
                      disabled={primaryStudioLayer.locked}
                      value={primaryStudioLayer.subtitle}
                      onChange={e =>
                        studio.updateLayerProps(
                          primaryStudioLayer.id,
                          { subtitle: e.target.value } as Partial<StudioLayer>,
                          'Edit moodboard subtitle'
                        )
                      }
                      className="w-full px-2 py-1 text-xs bg-neutral-50 border border-neutral-200 rounded-xs"
                    />
                  </label>
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-neutral-500">Direction Notes</span>
                    <textarea
                      rows={3}
                      disabled={primaryStudioLayer.locked}
                      value={primaryStudioLayer.notes}
                      onChange={e =>
                        studio.updateLayerProps(
                          primaryStudioLayer.id,
                          { notes: e.target.value } as Partial<StudioLayer>,
                          'Edit moodboard notes'
                        )
                      }
                      className="w-full px-2 py-1 text-xs bg-neutral-50 border border-neutral-200 rounded-xs resize-y"
                    />
                  </label>
                </div>
              )}

              {primaryStudioLayer.type === 'annotation-note' && (
                <div className="pt-2.5 border-t border-neutral-100 space-y-2" data-testid="inspector-studio-note">
                  <span className="text-[11px] font-semibold text-neutral-500 tracking-wide block">
                    Visual Callout Note
                  </span>
                  <textarea
                    rows={3}
                    aria-label="Visual note text"
                    disabled={primaryStudioLayer.locked}
                    value={primaryStudioLayer.text}
                    onChange={e =>
                      studio.updateLayerProps(
                        primaryStudioLayer.id,
                        { text: e.target.value } as Partial<StudioLayer>,
                        'Edit visual note'
                      )
                    }
                    className="w-full px-2 py-1 text-xs bg-neutral-50 border border-neutral-200 rounded-xs resize-y"
                  />
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-neutral-500">Note Tone</span>
                    <select
                      disabled={primaryStudioLayer.locked}
                      value={primaryStudioLayer.tone}
                      onChange={e =>
                        studio.updateLayerProps(
                          primaryStudioLayer.id,
                          { tone: e.target.value as 'neutral' | 'atelier' | 'caution' } as Partial<StudioLayer>,
                          'Change note tone'
                        )
                      }
                      className="w-full px-2 py-1 text-xs bg-neutral-50 border border-neutral-200 rounded-xs"
                    >
                      <option value="atelier">Atelier Ivory</option>
                      <option value="neutral">Neutral Slate</option>
                      <option value="caution">Amber Caution</option>
                    </select>
                  </label>
                  <p className="text-[10px] text-neutral-500">
                    Unverified freeform overlay. Excluded from Pattern Atelier promotion.
                  </p>
                </div>
              )}

              {primaryStudioLayer.type === 'fabric-swatch' && (
                <div className="pt-2.5 border-t border-neutral-100 space-y-2">
                  <span className="text-[11px] font-semibold text-neutral-500 tracking-wide block">
                    Textile Swatch
                  </span>
                  <dl className="space-y-1 text-[11px]">
                    <div>
                      <dt className="text-neutral-500">Fabric</dt>
                      <dd className="text-neutral-900 font-medium">{primaryStudioLayer.fabricName}</dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Composition</dt>
                      <dd className="text-neutral-700">{primaryStudioLayer.composition}</dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Weight &amp; Stretch</dt>
                      <dd className="text-neutral-700 capitalize">{primaryStudioLayer.weightLabel}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {primaryStudioLayer.type === 'garment-silhouette-card' && (
                <div className="pt-2.5 border-t border-neutral-100 space-y-2">
                  <span className="text-[11px] font-semibold text-neutral-500 tracking-wide block">
                    Concept Silhouette Card
                  </span>
                  <dl className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <dt className="text-neutral-500">Category</dt>
                      <dd className="text-neutral-900 font-medium capitalize">
                        {primaryStudioLayer.garmentCategory}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Silhouette</dt>
                      <dd className="text-neutral-900 font-medium capitalize">
                        {primaryStudioLayer.silhouette}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Ease</dt>
                      <dd className="text-neutral-900 capitalize">{primaryStudioLayer.easeProfile}</dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Target Length</dt>
                      <dd className="font-mono tabular-nums text-neutral-900">
                        {primaryStudioLayer.lengthCm} cm
                      </dd>
                    </div>
                  </dl>
                  <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xs px-2 py-1.5">
                    Non-authoritative concept visual. Use Promote to Atelier for an unapproved draft spec.
                  </p>
                </div>
              )}

              {primaryStudioLayer.type === 'freehand-sketch' && (
                <div className="pt-2.5 border-t border-neutral-100 space-y-2">
                  <span className="text-[11px] font-semibold text-neutral-500 tracking-wide block">
                    Freehand Sketch Overlay
                  </span>
                  <p className="text-[11px] text-neutral-700 font-mono tabular-nums">
                    {primaryStudioLayer.strokes.length} stroke
                    {primaryStudioLayer.strokes.length === 1 ? '' : 's'}
                  </p>
                  <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xs px-2 py-1.5">
                    Unverified freeform overlay. Sketch paths are never transferred into Pattern Atelier CAD geometry.
                  </p>
                </div>
              )}

              {primaryStudioLayer.type === 'group' && (
                <div className="pt-2.5 border-t border-neutral-100 space-y-2">
                  <span className="text-[11px] font-semibold text-neutral-500 tracking-wide block">
                    Layer Group
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      studio.ungroupLayer(primaryStudioLayer.id);
                      clearLayerSelection();
                    }}
                    data-testid="inspector-ungroup-btn"
                    className="w-full px-2.5 py-1.5 text-[11px] font-medium border border-neutral-300 hover:bg-neutral-100 text-neutral-900 rounded-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Ungroup className="w-3.5 h-3.5" />
                    Ungroup Children
                  </button>
                </div>
              )}

              {/* Layer Order & Lifecycle Actions */}
              <div className="pt-2.5 border-t border-neutral-100 space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => studio.reorderLayer(primaryStudioLayer.id, 'up')}
                    className="px-2 py-1 text-[11px] border border-neutral-200 rounded-xs hover:bg-neutral-100 text-neutral-700 flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <ArrowUp className="w-3 h-3" />
                    Forward
                  </button>
                  <button
                    type="button"
                    onClick={() => studio.reorderLayer(primaryStudioLayer.id, 'down')}
                    className="px-2 py-1 text-[11px] border border-neutral-200 rounded-xs hover:bg-neutral-100 text-neutral-700 flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <ArrowDown className="w-3 h-3" />
                    Backward
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => studio.duplicateLayers([primaryStudioLayer.id])}
                    className="px-2 py-1.5 text-[11px] font-medium border border-neutral-200 rounded-xs hover:bg-neutral-100 text-neutral-800 flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      studio.softDeleteLayers([primaryStudioLayer.id]);
                      clearLayerSelection();
                    }}
                    data-testid="inspector-trash-layer-btn"
                    className="px-2 py-1.5 text-[11px] font-medium border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xs flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Trash
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 1. Selected Entity Details (Non-Studio OR No Studio Layer Selected) */}
          {!primaryStudioLayer && !isMultiStudioSelection && !selectedEntity && (
            <section className="space-y-2.5">
              <h3 className="text-[11px] font-semibold text-neutral-500 tracking-wide">
                Active Garment
              </h3>
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-neutral-900 leading-snug">
                  {currentSpec.name}
                </p>
                <p className="text-neutral-600 leading-relaxed">
                  {currentSpec.garmentCategory} · {currentSpec.silhouette} · Size{' '}
                  {String(activeSize).toUpperCase()}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-y-2 gap-x-3 pt-2 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Material</dt>
                  <dd className="text-neutral-900 font-medium truncate" title={currentSpec.fabric.name}>
                    {currentSpec.fabric.name}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Target Length</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                    {currentSpec.lengthCm} cm
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Ease Profile</dt>
                  <dd className="text-neutral-900 font-medium capitalize">
                    {currentSpec.easeProfile}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Colorway</dt>
                  <dd className="text-neutral-900 font-medium flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-xs border border-neutral-300 shrink-0"
                      style={{ backgroundColor: currentSpec.color.hex }}
                    />
                    <span className="truncate">{currentSpec.color.name}</span>
                  </dd>
                </div>
              </dl>
              {isStudioEnv && studio && (
                <div className="pt-2 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-600">
                  <span>Active Board Layers</span>
                  <span className="font-mono tabular-nums text-neutral-900 font-medium">
                    {studio.activeCollectionLayers.length}
                  </span>
                </div>
              )}
              <p className="text-[11px] text-neutral-500 pt-1">
                Select a board layer, pattern piece, seam, reference image, or simulation zone to inspect its details across environments.
              </p>
            </section>
          )}

          {!primaryStudioLayer && !isMultiStudioSelection && selectedEntity?.kind === 'reference-image' && (
            <section className="space-y-3" data-testid="inspector-reference-image">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <ImageIcon className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.name}</span>
              </div>
              {referenceImage ? (
                <>
                  <div className="rounded-sm overflow-hidden border border-neutral-200 bg-neutral-50">
                    <img
                      src={referenceImage.dataUrl}
                      alt={`Selected reference ${referenceImage.name}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-32 object-cover"
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <dt className="text-[11px] text-neutral-500">Format</dt>
                      <dd className="font-mono text-neutral-800">{referenceImage.mimeType.replace('image/', '').toUpperCase()}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-neutral-500">File Size</dt>
                      <dd className="font-mono tabular-nums text-neutral-800">
                        {formatFileSize(referenceImage.sizeBytes)}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-[11px] text-neutral-500 leading-relaxed">
                    Used as visual brief context only. Automated silhouette extraction is not active in Studio Demonstration Mode.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setReferenceImage(null);
                      selectEntity(null);
                    }}
                    className="text-xs text-rose-700 hover:text-rose-900 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove reference image
                  </button>
                </>
              ) : (
                <p className="text-[11px] text-neutral-500">
                  Reference image is no longer attached. Upload one in Creative Studio.
                </p>
              )}
            </section>
          )}

          {!primaryStudioLayer && !isMultiStudioSelection && selectedEntity?.kind === 'garment-element' && (
            <section className="space-y-3" data-testid="inspector-garment-element">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <Layers className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <dl className="grid grid-cols-2 gap-2.5 pt-2 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Category</dt>
                  <dd className="text-neutral-900 font-medium capitalize">{selectedEntity.category}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Silhouette</dt>
                  <dd className="text-neutral-900 font-medium capitalize">{selectedEntity.silhouette}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Fabric</dt>
                  <dd className="text-neutral-900 font-medium truncate">{currentSpec.fabric.name}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Length</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                    {currentSpec.lengthCm} cm
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => openDockTab('tech-spec')}
                  className="px-2.5 py-1.5 text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-sm cursor-pointer transition-colors"
                >
                  Open Tech Spec
                </button>
                <button
                  type="button"
                  onClick={() => openDockTab('sizing-ease')}
                  className="px-2.5 py-1.5 text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-sm cursor-pointer transition-colors"
                >
                  Sizing &amp; Ease
                </button>
              </div>
            </section>
          )}

          {!primaryStudioLayer && !isMultiStudioSelection && selectedEntity?.kind === 'pattern-piece' && (
            <section className="space-y-3" data-testid="inspector-pattern-piece">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <Scissors className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-2.5 py-1.5">
                C0-Legacy prototype geometry. Non-authoritative drafting preview.
              </p>
              {activePiece ? (
                <>
                  <dl className="grid grid-cols-2 gap-2.5 pt-1 border-t border-neutral-100">
                    <div>
                      <dt className="text-[11px] text-neutral-500">Piece Code</dt>
                      <dd className="font-mono text-neutral-900 font-medium">{activePiece.pieceCode}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-neutral-500">Cut Instruction</dt>
                      <dd className="text-neutral-900 font-medium">
                        {activePiece.onFold ? 'Cut 1 on fold' : `Cut ${activePiece.cutCount}`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-neutral-500">Dimensions</dt>
                      <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                        {activePiece.boundingBox.widthCm} × {activePiece.boundingBox.heightCm} cm
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-neutral-500">Seam Allowance</dt>
                      <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                        {activePiece.seamAllowanceWidthCm} cm
                      </dd>
                    </div>
                  </dl>

                  {activePiece.seams.length > 0 && (
                    <div className="pt-2 border-t border-neutral-100 space-y-1.5">
                      <span className="text-[11px] font-medium text-neutral-500 block">
                        Piece Seams ({activePiece.seams.length})
                      </span>
                      <div className="space-y-1">
                        {activePiece.seams.map(seam => (
                          <button
                            key={seam.id}
                            type="button"
                            onClick={() =>
                              selectEntity({
                                kind: 'seam',
                                id: `${activePiece.id}:${seam.id}`,
                                pieceId: activePiece.id,
                                seamId: seam.id,
                                label: `${activePiece.name} · ${seam.name}`,
                                lengthCm: seam.lengthCm,
                                pairedSeamName: seam.pairedSeamName
                              })
                            }
                            className="w-full px-2 py-1.5 rounded-sm border border-neutral-200 hover:border-neutral-400 bg-neutral-50/70 flex items-center justify-between text-left cursor-pointer transition-colors"
                          >
                            <span className="text-neutral-800 truncate pr-2">{seam.name}</span>
                            <span className="font-mono tabular-nums text-neutral-600 shrink-0">
                              {seam.lengthCm} cm
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeEnvironment !== 'pattern-atelier' && (
                    <button
                      type="button"
                      onClick={() => setEnvironment('pattern-atelier')}
                      className="text-xs font-medium text-neutral-900 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      View piece in Pattern Atelier
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-neutral-500">
                  This garment category does not currently generate CAD pattern pieces.
                </p>
              )}
            </section>
          )}

          {!primaryStudioLayer && !isMultiStudioSelection && selectedEntity?.kind === 'seam' && (
            <section className="space-y-3" data-testid="inspector-seam">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <Sliders className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <dl className="grid grid-cols-2 gap-2.5 pt-2 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Measured Length</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 font-semibold">
                    {selectedEntity.lengthCm !== undefined ? `${selectedEntity.lengthCm} cm` : 'N/A'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Parent Piece</dt>
                  <dd className="text-neutral-900 font-medium truncate">
                    {activePiece?.name ?? selectedEntity.pieceId}
                  </dd>
                </div>
                {selectedEntity.pairedSeamName && (
                  <div className="col-span-2">
                    <dt className="text-[11px] text-neutral-500">Paired Seam</dt>
                    <dd className="text-neutral-900 font-medium">{selectedEntity.pairedSeamName}</dd>
                  </div>
                )}
              </dl>
              {activePiece && (
                <button
                  type="button"
                  onClick={() =>
                    selectEntity({
                      kind: 'pattern-piece',
                      id: activePiece.id,
                      pieceId: activePiece.id,
                      pieceCode: activePiece.pieceCode,
                      label: activePiece.name
                    })
                  }
                  className="text-xs font-medium text-neutral-800 hover:underline cursor-pointer"
                >
                  Select parent piece ({activePiece.pieceCode})
                </button>
              )}
            </section>
          )}

          {!primaryStudioLayer && !isMultiStudioSelection && selectedEntity?.kind === 'simulation-entity' && (
            <section className="space-y-3" data-testid="inspector-simulation-entity">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <Box className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-2.5 py-1.5 leading-relaxed">
                Prototype drape simulation only. Physical garment fit validation (AC-09) remains pending.
              </p>
              <dl className="grid grid-cols-2 gap-2.5 pt-1 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Material</dt>
                  <dd className="text-neutral-900 font-medium truncate">{currentSpec.fabric.name}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Orbit View</dt>
                  <dd className="font-mono tabular-nums text-neutral-900">
                    {camera.orbitYawDeg}° / {camera.orbitPitchDeg}°
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => {
                  setEnvironment('simulation-production');
                  setSimProdSubView('prototype-drape-3d');
                }}
                className="px-2.5 py-1.5 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-sm cursor-pointer transition-colors"
              >
                Open Prototype Drape View
              </button>
            </section>
          )}

          {!primaryStudioLayer && !isMultiStudioSelection && selectedEntity?.kind === 'production-entity' && (
            <section className="space-y-3" data-testid="inspector-production-entity">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <FileCheck2 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <p className="text-[11px] text-neutral-600 leading-relaxed">
                Production exports remain restricted until specification approval, measurement verification, and release checks pass.
              </p>
              <dl className="space-y-2 pt-1 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Export Readiness</dt>
                  <dd className="text-neutral-900 font-medium">
                    {workspaceBundle.exportValidation.isExportPermitted
                      ? 'Ready for local draft export'
                      : 'Restricted — review required'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Physical Validation</dt>
                  <dd className="text-amber-800 font-medium">Pending physical toile sign-off</dd>
                </div>
              </dl>
              {activeEnvironment !== 'simulation-production' && (
                <button
                  type="button"
                  onClick={() => {
                    setEnvironment('simulation-production');
                    setSimProdSubView('production-overview');
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-sm cursor-pointer transition-colors"
                >
                  Open Production View
                </button>
              )}
            </section>
          )}

          {/* 2. Ephemeral Unverified Visual Notes (Undoable UI overlays, strictly non-canonical) */}
          <section className="pt-4 border-t border-neutral-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold text-neutral-500 tracking-wide">
                Visual Notes ({envNotes.length})
              </h3>
              <button
                type="button"
                onClick={() => addEphemeralOverlay()}
                data-testid="inspector-add-note-btn"
                className="text-[11px] font-medium text-neutral-800 hover:underline cursor-pointer"
              >
                + Add note
              </button>
            </div>
            {envNotes.length === 0 ? (
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                No unverified visual notes in this view. Notes are temporary and never alter pattern geometry.
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="inspector-notes-list">
                {envNotes.map(note => (
                  <li
                    key={note.id}
                    className="px-2.5 py-1.5 rounded-sm border border-neutral-200 bg-neutral-50 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-neutral-900 font-medium">
                        <StickyNote className="w-3 h-3 text-amber-600 shrink-0" />
                        <span className="truncate">{note.label}</span>
                      </div>
                      <span className="text-[10px] text-neutral-500 block">
                        Unverified overlay · non-canonical
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeEphemeralOverlay(note.id)}
                      aria-label={`Remove ${note.label}`}
                      className="p-1 text-neutral-400 hover:text-rose-700 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 3. Viewport Camera Summary (Ephemeral Only) */}
          <section className="pt-4 border-t border-neutral-200 space-y-1.5">
            <h3 className="text-[11px] font-semibold text-neutral-500 tracking-wide">
              Viewport View
            </h3>
            <div className="flex items-center justify-between text-[11px] text-neutral-600">
              <span>Zoom</span>
              <span className="font-mono tabular-nums text-neutral-900">
                {activeZoomPct}%
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-neutral-600">
              <span>Grid Overlay</span>
              <span className="text-neutral-900">{camera.showGrid ? 'Visible' : 'Hidden'}</span>
            </div>
          </section>
        </div>

        {/* Quiet Link to Engineering View */}
        <div className="px-3.5 py-2.5 border-t border-neutral-200 bg-neutral-50 shrink-0 flex items-center justify-between text-[11px]">
          <span className="text-neutral-500">Technical lineage</span>
          <button
            type="button"
            onClick={() => openDockTab('engineering')}
            className="font-medium text-neutral-800 hover:underline cursor-pointer"
          >
            Engineering View
          </button>
        </div>
      </aside>
    </>
  );
});

ContextualInspector.displayName = 'ContextualInspector';
