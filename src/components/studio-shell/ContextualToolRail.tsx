/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  MousePointer2,
  Hand,
  ZoomIn,
  ZoomOut,
  StickyNote,
  Image,
  PenTool,
  Scissors,
  Compass,
  Activity,
  Pin,
  Grid3x3,
  RotateCcw,
  Crop,
  LayoutGrid,
  Palette,
  Magnet,
  Crosshair,
  Ruler,
  GitCompareArrows,
  DraftingCompass,
  CircleDot,
  SlidersHorizontal
} from 'lucide-react';
import {
  ENVIRONMENT_TOOLS,
  ToolDefinition,
  useViewportInteraction,
  WorkspaceToolId
} from '../../state/ViewportInteractionContext';
import { useProjectWorkspace } from '../../state/ProjectWorkspaceContext';
import { useOptionalCreativeStudio } from '../../features/creative-studio/CreativeStudioContext';
import { useOptionalPatternAtelierView } from '../../features/pattern-workspace/PatternAtelierViewContext';

function renderToolIcon(toolId: ToolDefinition['id']) {
  switch (toolId) {
    case 'select':
      return <MousePointer2 className="w-4 h-4" />;
    case 'inspect-entity':
      return <Crosshair className="w-4 h-4" />;
    case 'measure-preview':
      return <Ruler className="w-4 h-4" />;
    case 'pan':
      return <Hand className="w-4 h-4" />;
    case 'crop-image':
      return <Crop className="w-4 h-4" />;
    case 'freehand-sketch':
      return <PenTool className="w-4 h-4" />;
    case 'place-note':
      return <StickyNote className="w-4 h-4" />;
    case 'add-mood-card':
      return <LayoutGrid className="w-4 h-4" />;
    case 'add-palette':
      return <Palette className="w-4 h-4" />;
    case 'zoom-in':
      return <ZoomIn className="w-4 h-4" />;
    case 'zoom-out':
      return <ZoomOut className="w-4 h-4" />;
    case 'visual-note':
      return <StickyNote className="w-4 h-4" />;
    case 'moodboard-focus':
      return <Image className="w-4 h-4" />;
    case 'orbit-camera':
      return <Compass className="w-4 h-4" />;
    case 'inspect-fit':
      return <Activity className="w-4 h-4" />;
    case 'edit-contour':
    case 'bezier-pen-upcoming':
      return <PenTool className="w-4 h-4" />;
    case 'seam-walk':
      return <GitCompareArrows className="w-4 h-4" />;
    case 'construction-draw':
      return <DraftingCompass className="w-4 h-4" />;
    case 'notch-drill':
      return <CircleDot className="w-4 h-4" />;
    case 'dart-author':
    case 'dart-tool-upcoming':
      return <Scissors className="w-4 h-4" />;
    case 'allowance-rule':
      return <SlidersHorizontal className="w-4 h-4" />;
    case 'cloth-pin-upcoming':
      return <Pin className="w-4 h-4" />;
    default:
      return <MousePointer2 className="w-4 h-4" />;
  }
}

export const ContextualToolRail: React.FC = () => {
  const { referenceImage, currentSpec } = useProjectWorkspace();
  const studio = useOptionalCreativeStudio();
  const patternAtelier = useOptionalPatternAtelierView();
  const {
    activeEnvironment,
    activeTool,
    setActiveTool,
    camera,
    updateCamera,
    resetCamera,
    addEphemeralOverlay,
    selectEntity,
    setSelectedLayerIds,
    setSimProdSubView,
    snapEnabled,
    toggleSnap,
    gridMode,
    setGridMode
  } = useViewportInteraction();

  const tools = ENVIRONMENT_TOOLS[activeEnvironment];

  const handleToolClick = (tool: ToolDefinition) => {
    if (!tool.available) return;

    const id = tool.id as WorkspaceToolId;
    if (activeEnvironment === 'creative-studio' && studio) {
      if (id === 'zoom-in') {
        studio.setStudioCamera({ zoom: studio.document.camera.zoom + 0.15 });
        return;
      }
      if (id === 'zoom-out') {
        studio.setStudioCamera({ zoom: studio.document.camera.zoom - 0.15 });
        return;
      }
      if (id === 'add-mood-card') {
        const newId = studio.addMoodboardCard();
        setSelectedLayerIds([newId]);
        return;
      }
      if (id === 'add-palette') {
        const newId = studio.addColorPaletteLayer();
        setSelectedLayerIds([newId]);
        return;
      }
      setActiveTool(id);
      return;
    }

    if (activeEnvironment === 'pattern-atelier' && patternAtelier) {
      if (id === 'zoom-in') {
        patternAtelier.zoomByFactor(1.2);
        return;
      }
      if (id === 'zoom-out') {
        patternAtelier.zoomByFactor(1 / 1.2);
        return;
      }
    }

    if (id === 'zoom-in') {
      updateCamera({ zoom: camera.zoom + 0.15 }, 'Zoom in viewport');
      return;
    }
    if (id === 'zoom-out') {
      updateCamera({ zoom: camera.zoom - 0.15 }, 'Zoom out viewport');
      return;
    }
    if (id === 'visual-note') {
      addEphemeralOverlay();
      return;
    }
    if (id === 'moodboard-focus') {
      setActiveTool('moodboard-focus');
      if (referenceImage) {
        selectEntity({
          kind: 'reference-image',
          id: `ref:${referenceImage.name}`,
          label: referenceImage.name,
          name: referenceImage.name,
          sizeBytes: referenceImage.sizeBytes
        });
      } else {
        selectEntity({
          kind: 'garment-element',
          id: `garment:${currentSpec.id}`,
          label: currentSpec.name,
          category: currentSpec.garmentCategory,
          silhouette: currentSpec.silhouette
        });
      }
      return;
    }
    if (id === 'inspect-fit') {
      setActiveTool('inspect-fit');
      setSimProdSubView('prototype-drape-3d');
      return;
    }
    if (id === 'orbit-camera') {
      setActiveTool('orbit-camera');
      setSimProdSubView('prototype-drape-3d');
      updateCamera(
        { orbitYawDeg: (camera.orbitYawDeg + 15) % 360 },
        'Orbit prototype camera (+15 deg)'
      );
      return;
    }
    setActiveTool(id);
  };

  const handleCycleGrid = () => {
    if (activeEnvironment === 'creative-studio') {
      const next = gridMode === 'dots' ? 'grid' : gridMode === 'grid' ? 'off' : 'dots';
      setGridMode(next);
      return;
    }
    updateCamera(
      { showGrid: !camera.showGrid },
      camera.showGrid ? 'Hide viewport grid' : 'Show viewport grid'
    );
  };

  const handleResetView = () => {
    if (activeEnvironment === 'creative-studio' && studio) {
      studio.setStudioCamera({ zoom: 1, panX: 48, panY: 48 });
      return;
    }
    if (activeEnvironment === 'pattern-atelier' && patternAtelier) {
      patternAtelier.requestFitAll();
      return;
    }
    resetCamera();
  };

  return (
    <aside
      aria-label="Contextual Workspace Tool Rail"
      data-testid="contextual-tool-rail"
      className="w-12 shrink-0 bg-[#1B1C20] border-r border-neutral-800 flex flex-col items-center justify-between py-2.5 z-20"
    >
      <div className="flex flex-col items-center gap-1.5 w-full px-1.5">
        {tools.map(tool => {
          const isSelected = tool.available && tool.actionType === 'mode' && activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              disabled={!tool.available}
              aria-disabled={!tool.available}
              aria-pressed={tool.actionType === 'mode' ? isSelected : undefined}
              data-testid={`tool-btn-${tool.id}`}
              onClick={() => handleToolClick(tool)}
              title={
                tool.available
                  ? `${tool.label}${tool.shortKey ? ` (${tool.shortKey})` : ''} — ${tool.description}`
                  : `${tool.label} — Unavailable (${tool.unavailableReason ?? 'Planned milestone'})`
              }
              aria-label={
                tool.available
                  ? tool.label
                  : `${tool.label} (Unavailable: ${tool.unavailableReason ?? 'Planned milestone'})`
              }
              className={`w-9 h-9 rounded-sm flex items-center justify-center relative transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
                !tool.available
                  ? 'text-neutral-600 opacity-45 cursor-not-allowed border border-dashed border-neutral-800'
                  : isSelected
                    ? 'bg-neutral-100 text-neutral-950 cursor-pointer'
                    : 'text-neutral-300 hover:bg-neutral-800 hover:text-white cursor-pointer'
              }`}
            >
              {renderToolIcon(tool.id)}
            </button>
          );
        })}
      </div>

      {/* Bottom Viewport Utility Actions (Snap, Grid & Camera Reset) */}
      <div className="flex flex-col items-center gap-1.5 w-full px-1.5 pt-2 border-t border-neutral-800">
        {activeEnvironment === 'creative-studio' && (
          <button
            type="button"
            onClick={toggleSnap}
            aria-pressed={snapEnabled}
            data-testid="tool-toggle-snap"
            title={snapEnabled ? 'Disable smart snapping (hold Alt while dragging)' : 'Enable smart snapping'}
            aria-label="Toggle smart snapping"
            className={`w-9 h-9 rounded-sm flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
              snapEnabled
                ? 'bg-neutral-800 text-neutral-100'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <Magnet className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={handleCycleGrid}
          aria-pressed={activeEnvironment === 'creative-studio' ? gridMode !== 'off' : camera.showGrid}
          data-testid="tool-toggle-grid"
          title={
            activeEnvironment === 'creative-studio'
              ? `Grid overlay: ${gridMode} (click to cycle)`
              : camera.showGrid
                ? 'Hide drafting grid'
                : 'Show drafting grid'
          }
          aria-label="Toggle drafting grid"
          className={`w-9 h-9 rounded-sm flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
            (activeEnvironment === 'creative-studio' ? gridMode !== 'off' : camera.showGrid)
              ? 'bg-neutral-800 text-neutral-100'
              : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
          }`}
        >
          <Grid3x3 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleResetView}
          data-testid="tool-reset-camera"
          title="Reset ephemeral zoom, pan & camera view"
          aria-label="Reset viewport camera"
          className="w-9 h-9 rounded-sm flex items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
