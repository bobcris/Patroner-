/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { WorkspaceTab } from '../components/layout/Header';

/**
 * UX-2.1 Ephemeral Viewport & Interaction State Foundation
 *
 * MANDATORY ARCHITECTURAL BOUNDARY (Section 3D):
 * All state managed in this module is strictly ephemeral UI/viewport state.
 * None of these fields may enter canonical garment hashes, measurement approval hashes,
 * geometry certification records, provenance manifests, or production evidence.
 */

export type StudioEnvironment = 'creative-studio' | 'pattern-atelier' | 'simulation-production';

export type SimulationProductionSubView = 'production-overview' | 'prototype-drape-3d';

export type DockTabId = 'tech-spec' | 'sizing-ease' | 'history' | 'engineering';

export type SelectedEntityKind =
  | 'reference-image'
  | 'garment-element'
  | 'pattern-piece'
  | 'seam'
  | 'simulation-entity'
  | 'production-entity';

export type SelectedEntity =
  | {
      kind: 'reference-image';
      id: string;
      label: string;
      name: string;
      sizeBytes: number;
    }
  | {
      kind: 'garment-element';
      id: string;
      label: string;
      category: string;
      silhouette: string;
      pieceId?: string;
    }
  | {
      kind: 'pattern-piece';
      id: string;
      pieceId: string;
      pieceCode: string;
      label: string;
    }
  | {
      kind: 'seam';
      id: string;
      pieceId: string;
      seamId: string;
      label: string;
      lengthCm?: number;
      pairedSeamName?: string;
    }
  | {
      kind: 'simulation-entity';
      id: string;
      pieceId?: string;
      label: string;
      zone?: string;
      prototypeMode: 'prototype-drape' | 'avatar-parametric' | 'fit-zone';
    }
  | {
      kind: 'production-entity';
      id: string;
      pieceId?: string;
      label: string;
      artifactType: 'tech-pack' | 'dxf-export' | 'bom' | 'piece-sheet' | 'validation-gate';
    };

export interface HoveredEntityRef {
  kind: SelectedEntityKind;
  id: string;
  label: string;
}

export type WorkspaceToolId =
  | 'select'
  | 'inspect-entity'
  | 'pan'
  | 'zoom-in'
  | 'zoom-out'
  | 'visual-note'
  | 'moodboard-focus'
  | 'crop-image'
  | 'freehand-sketch'
  | 'place-note'
  | 'add-mood-card'
  | 'add-palette'
  | 'measure-preview'
  | 'edit-contour'
  | 'seam-walk'
  | 'construction-draw'
  | 'notch-drill'
  | 'dart-author'
  | 'allowance-rule'
  | 'orbit-camera'
  | 'inspect-fit';

export interface ToolDefinition {
  id: WorkspaceToolId | 'bezier-pen-upcoming' | 'dart-tool-upcoming' | 'cloth-pin-upcoming';
  label: string;
  shortKey?: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
  actionType: 'mode' | 'instant';
}

export const ENVIRONMENT_TOOLS: Record<StudioEnvironment, readonly ToolDefinition[]> = {
  'creative-studio': [
    {
      id: 'select',
      label: 'Select & Transform',
      shortKey: 'V',
      description: 'Select, drag, resize, rotate, or marquee-select board layers',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'pan',
      label: 'Pan Canvas',
      shortKey: 'H',
      description: 'Pan the Creative Studio board (or hold Space + drag)',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'crop-image',
      label: 'Non-Destructive Crop',
      shortKey: 'C',
      description: 'Crop selected reference image without altering the original asset',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'freehand-sketch',
      label: 'Freehand Visual Sketch',
      shortKey: 'B',
      description: 'Draw an explicitly unverified visual overlay stroke (non-CAD)',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'place-note',
      label: 'Place Visual Note',
      shortKey: 'N',
      description: 'Place an unverified styling callout note on the board',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'add-mood-card',
      label: 'Add Direction Card',
      shortKey: 'M',
      description: 'Insert a moodboard editorial direction card',
      available: true,
      actionType: 'instant'
    },
    {
      id: 'add-palette',
      label: 'Add Color Palette',
      shortKey: 'P',
      description: 'Insert an editable colorway swatch card',
      available: true,
      actionType: 'instant'
    },
    {
      id: 'zoom-in',
      label: 'Zoom In',
      shortKey: '+',
      description: 'Zoom into studio canvas (+15%)',
      available: true,
      actionType: 'instant'
    },
    {
      id: 'zoom-out',
      label: 'Zoom Out',
      shortKey: '-',
      description: 'Zoom out of studio canvas (-15%)',
      available: true,
      actionType: 'instant'
    }
  ],
  'pattern-atelier': [
    {
      id: 'select',
      label: 'Select & Arrange Piece',
      shortKey: 'V',
      description: 'Select, drag, group, or marquee-select pattern pieces on the CAD board',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'inspect-entity',
      label: 'Inspect Geometry',
      shortKey: 'I',
      description: 'Read-only inspection of vertices, edges, cubic curves, control handles, notches & darts',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'measure-preview',
      label: 'Measure Geometry',
      shortKey: 'M',
      description: 'Advisory drafting measurements: pair distances, straight edges, vertex angles & cubic arc lengths (non-certified)',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'pan',
      label: 'Pan Viewport',
      shortKey: 'H',
      description: 'Pan pattern drafting viewport',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'zoom-in',
      label: 'Zoom In',
      shortKey: '+',
      description: 'Zoom into 2D pattern canvas (+15%)',
      available: true,
      actionType: 'instant'
    },
    {
      id: 'zoom-out',
      label: 'Zoom Out',
      shortKey: '-',
      description: 'Zoom out of 2D pattern canvas (-15%)',
      available: true,
      actionType: 'instant'
    },
    {
      id: 'visual-note',
      label: 'Drafting Guide Note',
      shortKey: 'G',
      description: 'Add an unverified drafting callout note (undoable, non-canonical)',
      available: true,
      actionType: 'instant'
    },
    {
      id: 'edit-contour',
      label: 'Edit Contour',
      shortKey: 'A',
      description: 'Proposal-based sew-contour vertex, Bézier handle, subdivision & controlled approximation editing (unverified visual proposal)',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'seam-walk',
      label: 'Seam Walk & True',
      shortKey: 'W',
      description: 'Seam correspondence pairing, interactive walking, ease comparison & advisory sew-contour endpoint trueing',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'construction-draw',
      label: 'Construction & Lines',
      shortKey: 'L',
      description: 'Author non-cutting construction lines, reference axes, circles, internal lines & geometric constraints',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'notch-drill',
      label: 'Notch & Drill',
      shortKey: 'N',
      description: 'Place anchored sew-edge notches and interior drill holes with lineage reprojection',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'dart-author',
      label: 'Dart Authoring',
      shortKey: 'D',
      description: 'Author proposal darts, slash-and-spread transfer, C0 bodice dart bridge & conservation checks',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'allowance-rule',
      label: 'Seam Allowance Rules',
      shortKey: 'S',
      description: 'Declarative per-piece/per-segment allowance rules, corner join styles & production annotations (no TS cut offsets)',
      available: true,
      actionType: 'mode'
    }
  ],
  'simulation-production': [
    {
      id: 'select',
      label: 'Select Entity',
      shortKey: 'V',
      description: 'Inspect garment pieces, prototype simulation zones, or production artifacts',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'orbit-camera',
      label: 'Orbit Camera',
      shortKey: 'O',
      description: 'Adjust ephemeral camera orientation metadata for prototype drape view',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'inspect-fit',
      label: 'Inspect Prototype Fit',
      shortKey: 'F',
      description: 'Switch to prototype 3D drape & AC-09 physical validation view',
      available: true,
      actionType: 'mode'
    },
    {
      id: 'visual-note',
      label: 'Fit Review Pin',
      shortKey: 'N',
      description: 'Add an unverified review note (undoable, non-canonical)',
      available: true,
      actionType: 'instant'
    },
    {
      id: 'cloth-pin-upcoming',
      label: '3D Cloth Pinning',
      description: 'Interactive Three.js garment pinning planned for UX-2.4',
      available: false,
      unavailableReason: 'Planned for UX-2.4 3D Simulation',
      actionType: 'mode'
    }
  ]
};

export interface ViewportCameraState {
  zoom: number;
  panX: number;
  panY: number;
  orbitYawDeg: number;
  orbitPitchDeg: number;
  showGrid: boolean;
  showOverlayNotes: boolean;
}

export interface EphemeralOverlayNote {
  id: string;
  environment: StudioEnvironment;
  label: string;
  targetEntityId?: string;
  xPercent: number;
  yPercent: number;
  verificationStatus: 'UNVERIFIED_FREEFORM_OVERLAY';
  createdOrder: number;
}

export interface EphemeralUndoableSnapshot {
  selectedEntity: SelectedEntity | null;
  activeToolByEnv: Record<StudioEnvironment, WorkspaceToolId>;
  camera: ViewportCameraState;
  ephemeralOverlays: readonly EphemeralOverlayNote[];
}

export interface ViewportHistoryEntry {
  id: string;
  actionLabel: string;
  environment: StudioEnvironment;
  snapshot: EphemeralUndoableSnapshot;
}

export interface ViewportInteractionState {
  activeEnvironment: StudioEnvironment;
  simProdSubView: SimulationProductionSubView;
  selectedEntity: SelectedEntity | null;
  hoveredEntity: HoveredEntityRef | null;
  selectedLayerIds: readonly string[];
  activeToolByEnv: Record<StudioEnvironment, WorkspaceToolId>;
  camera: ViewportCameraState;
  inspectorOpen: boolean;
  layersPanelOpen: boolean;
  briefDrawerOpen: boolean;
  snapEnabled: boolean;
  gridMode: 'dots' | 'grid' | 'off';
  dockOpen: boolean;
  activeDockTab: DockTabId;
  ephemeralOverlays: readonly EphemeralOverlayNote[];
  nextOverlaySequence: number;
  historyPast: readonly ViewportHistoryEntry[];
  historyFuture: readonly ViewportHistoryEntry[];
}

export const MAX_VIEWPORT_HISTORY_ENTRIES = 40;
export const MIN_VIEWPORT_ZOOM = 0.4;
export const MAX_VIEWPORT_ZOOM = 2.5;

export function clampViewportZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1.0;
  return Math.round(Math.min(MAX_VIEWPORT_ZOOM, Math.max(MIN_VIEWPORT_ZOOM, zoom)) * 100) / 100;
}

export function resolveEnvironmentForWorkspaceTab(tab: WorkspaceTab): {
  environment: StudioEnvironment;
  dockOpen?: boolean;
  dockTab?: DockTabId;
} {
  switch (tab) {
    case 'studio':
      return { environment: 'creative-studio' };
    case 'pattern-cad':
      return { environment: 'pattern-atelier' };
    case 'production':
      return { environment: 'simulation-production' };
    case 'specification':
      return { environment: 'pattern-atelier', dockOpen: true, dockTab: 'tech-spec' };
    case 'measurements':
      return { environment: 'pattern-atelier', dockOpen: true, dockTab: 'sizing-ease' };
  }
}

export function resolveWorkspaceTabForEnvironment(env: StudioEnvironment): WorkspaceTab {
  switch (env) {
    case 'creative-studio':
      return 'studio';
    case 'pattern-atelier':
      return 'pattern-cad';
    case 'simulation-production':
      return 'production';
  }
}

export function extractSelectedPieceId(entity: SelectedEntity | null): string | null {
  if (!entity) return null;
  if (entity.kind === 'pattern-piece') return entity.pieceId;
  if (entity.kind === 'seam') return entity.pieceId;
  if (entity.kind === 'garment-element' && entity.pieceId) return entity.pieceId;
  if (entity.kind === 'simulation-entity' && entity.pieceId) return entity.pieceId;
  if (entity.kind === 'production-entity' && entity.pieceId) return entity.pieceId;
  return null;
}

export function createInitialViewportState(options?: {
  initialEnvironment?: StudioEnvironment;
  initialInspectorOpen?: boolean;
  initialLayersPanelOpen?: boolean;
}): ViewportInteractionState {
  return {
    activeEnvironment: options?.initialEnvironment ?? 'creative-studio',
    simProdSubView: 'production-overview',
    selectedEntity: null,
    hoveredEntity: null,
    selectedLayerIds: [],
    activeToolByEnv: {
      'creative-studio': 'select',
      'pattern-atelier': 'select',
      'simulation-production': 'select'
    },
    camera: {
      zoom: 1.0,
      panX: 0,
      panY: 0,
      orbitYawDeg: 28,
      orbitPitchDeg: 12,
      showGrid: true,
      showOverlayNotes: true
    },
    inspectorOpen: options?.initialInspectorOpen ?? true,
    layersPanelOpen: options?.initialLayersPanelOpen ?? true,
    briefDrawerOpen: false,
    snapEnabled: true,
    gridMode: 'dots',
    dockOpen: false,
    activeDockTab: 'tech-spec',
    ephemeralOverlays: [],
    nextOverlaySequence: 1,
    historyPast: [],
    historyFuture: []
  };
}

function captureSnapshot(state: ViewportInteractionState): EphemeralUndoableSnapshot {
  return {
    selectedEntity: state.selectedEntity,
    activeToolByEnv: { ...state.activeToolByEnv },
    camera: { ...state.camera },
    ephemeralOverlays: [...state.ephemeralOverlays]
  };
}

function pushUndoHistory(
  state: ViewportInteractionState,
  actionLabel: string
): readonly ViewportHistoryEntry[] {
  const entry: ViewportHistoryEntry = {
    id: `hist-${state.historyPast.length + 1}-${state.nextOverlaySequence}`,
    actionLabel,
    environment: state.activeEnvironment,
    snapshot: captureSnapshot(state)
  };
  const next = [...state.historyPast, entry];
  return next.length > MAX_VIEWPORT_HISTORY_ENTRIES
    ? next.slice(next.length - MAX_VIEWPORT_HISTORY_ENTRIES)
    : next;
}

export type ViewportInteractionAction =
  | { type: 'SET_ENVIRONMENT'; environment: StudioEnvironment }
  | { type: 'SET_SIM_PROD_SUBVIEW'; subView: SimulationProductionSubView }
  | { type: 'SELECT_ENTITY'; entity: SelectedEntity | null; recordHistory?: boolean }
  | { type: 'SET_HOVERED_ENTITY'; entity: HoveredEntityRef | null }
  | { type: 'SET_SELECTED_LAYER_IDS'; layerIds: readonly string[] }
  | { type: 'TOGGLE_LAYER_SELECTION'; layerId: string }
  | { type: 'SET_ACTIVE_TOOL'; tool: WorkspaceToolId; environment?: StudioEnvironment }
  | { type: 'UPDATE_CAMERA'; patch: Partial<ViewportCameraState>; label?: string }
  | { type: 'RESET_CAMERA' }
  | { type: 'SET_INSPECTOR_OPEN'; open: boolean }
  | { type: 'TOGGLE_INSPECTOR' }
  | { type: 'SET_LAYERS_PANEL_OPEN'; open: boolean }
  | { type: 'TOGGLE_LAYERS_PANEL' }
  | { type: 'SET_BRIEF_DRAWER_OPEN'; open: boolean }
  | { type: 'TOGGLE_BRIEF_DRAWER' }
  | { type: 'SET_SNAP_ENABLED'; enabled: boolean }
  | { type: 'TOGGLE_SNAP' }
  | { type: 'SET_GRID_MODE'; mode: 'dots' | 'grid' | 'off' }
  | { type: 'SET_DOCK_OPEN'; open: boolean }
  | { type: 'TOGGLE_DOCK' }
  | { type: 'OPEN_DOCK_TAB'; tab: DockTabId }
  | {
      type: 'ADD_EPHEMERAL_OVERLAY';
      label?: string;
      xPercent?: number;
      yPercent?: number;
      targetEntityId?: string;
    }
  | { type: 'REMOVE_EPHEMERAL_OVERLAY'; id: string }
  | { type: 'CLEAR_EPHEMERAL_OVERLAYS' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET_EPHEMERAL_STATE' };

/**
 * Pure deterministic reducer for all ephemeral viewport interactions and undo/redo history.
 * Guaranteed free of side effects and safe under React StrictMode double invocation.
 */
export function viewportInteractionReducer(
  state: ViewportInteractionState,
  action: ViewportInteractionAction
): ViewportInteractionState {
  switch (action.type) {
    case 'SET_ENVIRONMENT': {
      if (state.activeEnvironment === action.environment) return state;
      return {
        ...state,
        activeEnvironment: action.environment,
        hoveredEntity: null
      };
    }

    case 'SET_SIM_PROD_SUBVIEW': {
      if (state.simProdSubView === action.subView) return state;
      return {
        ...state,
        simProdSubView: action.subView
      };
    }

    case 'SELECT_ENTITY': {
      const sameSelection =
        state.selectedEntity?.kind === action.entity?.kind &&
        state.selectedEntity?.id === action.entity?.id;
      if (sameSelection) return state;
      const shouldRecord = action.recordHistory !== false;
      const label = action.entity
        ? `Select ${action.entity.label}`
        : 'Clear selection';
      return {
        ...state,
        selectedEntity: action.entity,
        historyPast: shouldRecord ? pushUndoHistory(state, label) : state.historyPast,
        historyFuture: shouldRecord ? [] : state.historyFuture
      };
    }

    case 'SET_HOVERED_ENTITY': {
      if (
        state.hoveredEntity?.kind === action.entity?.kind &&
        state.hoveredEntity?.id === action.entity?.id
      ) {
        return state;
      }
      return {
        ...state,
        hoveredEntity: action.entity
      };
    }

    case 'SET_SELECTED_LAYER_IDS': {
      const next = Array.from(new Set(action.layerIds));
      if (
        next.length === state.selectedLayerIds.length &&
        next.every((id, i) => id === state.selectedLayerIds[i])
      ) {
        return state;
      }
      return { ...state, selectedLayerIds: next };
    }

    case 'TOGGLE_LAYER_SELECTION': {
      const exists = state.selectedLayerIds.includes(action.layerId);
      const next = exists
        ? state.selectedLayerIds.filter(id => id !== action.layerId)
        : [...state.selectedLayerIds, action.layerId];
      return { ...state, selectedLayerIds: next };
    }

    case 'SET_ACTIVE_TOOL': {
      const targetEnv = action.environment ?? state.activeEnvironment;
      if (state.activeToolByEnv[targetEnv] === action.tool) return state;
      const nextTools = {
        ...state.activeToolByEnv,
        [targetEnv]: action.tool
      };
      return {
        ...state,
        activeToolByEnv: nextTools,
        simProdSubView:
          targetEnv === 'simulation-production' && action.tool === 'inspect-fit'
            ? 'prototype-drape-3d'
            : state.simProdSubView,
        historyPast: pushUndoHistory(state, `Tool: ${action.tool}`),
        historyFuture: []
      };
    }

    case 'UPDATE_CAMERA': {
      const nextCamera: ViewportCameraState = {
        ...state.camera,
        ...action.patch,
        zoom:
          action.patch.zoom !== undefined
            ? clampViewportZoom(action.patch.zoom)
            : state.camera.zoom
      };
      const unchanged =
        nextCamera.zoom === state.camera.zoom &&
        nextCamera.panX === state.camera.panX &&
        nextCamera.panY === state.camera.panY &&
        nextCamera.orbitYawDeg === state.camera.orbitYawDeg &&
        nextCamera.orbitPitchDeg === state.camera.orbitPitchDeg &&
        nextCamera.showGrid === state.camera.showGrid &&
        nextCamera.showOverlayNotes === state.camera.showOverlayNotes;
      if (unchanged) return state;
      return {
        ...state,
        camera: nextCamera,
        historyPast: pushUndoHistory(state, action.label ?? 'Adjust viewport view'),
        historyFuture: []
      };
    }

    case 'RESET_CAMERA': {
      const defaults = createInitialViewportState().camera;
      return {
        ...state,
        camera: defaults,
        historyPast: pushUndoHistory(state, 'Reset viewport camera'),
        historyFuture: []
      };
    }

    case 'SET_INSPECTOR_OPEN':
      return state.inspectorOpen === action.open
        ? state
        : { ...state, inspectorOpen: action.open };

    case 'TOGGLE_INSPECTOR':
      return { ...state, inspectorOpen: !state.inspectorOpen };

    case 'SET_LAYERS_PANEL_OPEN':
      return state.layersPanelOpen === action.open
        ? state
        : { ...state, layersPanelOpen: action.open };

    case 'TOGGLE_LAYERS_PANEL':
      return { ...state, layersPanelOpen: !state.layersPanelOpen };

    case 'SET_BRIEF_DRAWER_OPEN':
      return state.briefDrawerOpen === action.open
        ? state
        : { ...state, briefDrawerOpen: action.open };

    case 'TOGGLE_BRIEF_DRAWER':
      return { ...state, briefDrawerOpen: !state.briefDrawerOpen };

    case 'SET_SNAP_ENABLED':
      return state.snapEnabled === action.enabled
        ? state
        : { ...state, snapEnabled: action.enabled };

    case 'TOGGLE_SNAP':
      return { ...state, snapEnabled: !state.snapEnabled };

    case 'SET_GRID_MODE':
      return {
        ...state,
        gridMode: action.mode,
        camera: { ...state.camera, showGrid: action.mode !== 'off' }
      };

    case 'SET_DOCK_OPEN':
      return state.dockOpen === action.open ? state : { ...state, dockOpen: action.open };

    case 'TOGGLE_DOCK':
      return { ...state, dockOpen: !state.dockOpen };

    case 'OPEN_DOCK_TAB':
      return {
        ...state,
        dockOpen: true,
        activeDockTab: action.tab
      };

    case 'ADD_EPHEMERAL_OVERLAY': {
      const seq = state.nextOverlaySequence;
      const defaultPos = ((seq - 1) % 5) * 12;
      const envPrefix =
        state.activeEnvironment === 'creative-studio'
          ? 'Brief Pin'
          : state.activeEnvironment === 'pattern-atelier'
            ? 'Draft Note'
            : 'Fit Note';
      const note: EphemeralOverlayNote = {
        id: `overlay-note-${seq}`,
        environment: state.activeEnvironment,
        label: action.label?.trim() || `${envPrefix} #${seq}`,
        targetEntityId: action.targetEntityId ?? state.selectedEntity?.id,
        xPercent: action.xPercent ?? 24 + defaultPos,
        yPercent: action.yPercent ?? 26 + ((seq - 1) % 4) * 10,
        verificationStatus: 'UNVERIFIED_FREEFORM_OVERLAY',
        createdOrder: seq
      };
      return {
        ...state,
        ephemeralOverlays: [...state.ephemeralOverlays, note],
        nextOverlaySequence: seq + 1,
        camera: { ...state.camera, showOverlayNotes: true },
        historyPast: pushUndoHistory(state, `Add ${note.label}`),
        historyFuture: []
      };
    }

    case 'REMOVE_EPHEMERAL_OVERLAY': {
      const target = state.ephemeralOverlays.find(o => o.id === action.id);
      if (!target) return state;
      return {
        ...state,
        ephemeralOverlays: state.ephemeralOverlays.filter(o => o.id !== action.id),
        historyPast: pushUndoHistory(state, `Remove ${target.label}`),
        historyFuture: []
      };
    }

    case 'CLEAR_EPHEMERAL_OVERLAYS': {
      if (state.ephemeralOverlays.length === 0) return state;
      return {
        ...state,
        ephemeralOverlays: [],
        historyPast: pushUndoHistory(state, 'Clear unverified notes'),
        historyFuture: []
      };
    }

    case 'UNDO': {
      if (state.historyPast.length === 0) return state;
      const previous = state.historyPast[state.historyPast.length - 1];
      const nextPast = state.historyPast.slice(0, -1);
      const redoEntry: ViewportHistoryEntry = {
        id: `redo-${previous.id}`,
        actionLabel: previous.actionLabel,
        environment: state.activeEnvironment,
        snapshot: captureSnapshot(state)
      };
      return {
        ...state,
        selectedEntity: previous.snapshot.selectedEntity,
        activeToolByEnv: { ...previous.snapshot.activeToolByEnv },
        camera: { ...previous.snapshot.camera },
        ephemeralOverlays: [...previous.snapshot.ephemeralOverlays],
        historyPast: nextPast,
        historyFuture: [redoEntry, ...state.historyFuture].slice(0, MAX_VIEWPORT_HISTORY_ENTRIES)
      };
    }

    case 'REDO': {
      if (state.historyFuture.length === 0) return state;
      const next = state.historyFuture[0];
      const remainingFuture = state.historyFuture.slice(1);
      const pastEntry: ViewportHistoryEntry = {
        id: `undo-${next.id}`,
        actionLabel: next.actionLabel,
        environment: state.activeEnvironment,
        snapshot: captureSnapshot(state)
      };
      return {
        ...state,
        selectedEntity: next.snapshot.selectedEntity,
        activeToolByEnv: { ...next.snapshot.activeToolByEnv },
        camera: { ...next.snapshot.camera },
        ephemeralOverlays: [...next.snapshot.ephemeralOverlays],
        historyPast: [...state.historyPast, pastEntry].slice(-MAX_VIEWPORT_HISTORY_ENTRIES),
        historyFuture: remainingFuture
      };
    }

    case 'RESET_EPHEMERAL_STATE':
      return createInitialViewportState({
        initialEnvironment: state.activeEnvironment,
        initialInspectorOpen: state.inspectorOpen
      });
  }
}

export interface ViewportInteractionContextValue {
  state: ViewportInteractionState;
  activeEnvironment: StudioEnvironment;
  simProdSubView: SimulationProductionSubView;
  selectedEntity: SelectedEntity | null;
  selectedPieceId: string | null;
  hoveredEntity: HoveredEntityRef | null;
  selectedLayerIds: readonly string[];
  activeTool: WorkspaceToolId;
  camera: ViewportCameraState;
  inspectorOpen: boolean;
  layersPanelOpen: boolean;
  briefDrawerOpen: boolean;
  snapEnabled: boolean;
  gridMode: 'dots' | 'grid' | 'off';
  dockOpen: boolean;
  activeDockTab: DockTabId;
  ephemeralOverlays: readonly EphemeralOverlayNote[];
  canUndo: boolean;
  canRedo: boolean;
  historyPast: readonly ViewportHistoryEntry[];
  historyFuture: readonly ViewportHistoryEntry[];

  setEnvironment: (env: StudioEnvironment) => void;
  setSimProdSubView: (subView: SimulationProductionSubView) => void;
  selectEntity: (entity: SelectedEntity | null, recordHistory?: boolean) => void;
  setHoveredEntity: (entity: HoveredEntityRef | null) => void;
  setSelectedLayerIds: (layerIds: readonly string[]) => void;
  toggleLayerSelection: (layerId: string) => void;
  clearLayerSelection: () => void;
  setActiveTool: (tool: WorkspaceToolId, env?: StudioEnvironment) => void;
  updateCamera: (patch: Partial<ViewportCameraState>, label?: string) => void;
  resetCamera: () => void;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  setLayersPanelOpen: (open: boolean) => void;
  toggleLayersPanel: () => void;
  setBriefDrawerOpen: (open: boolean) => void;
  toggleBriefDrawer: () => void;
  setSnapEnabled: (enabled: boolean) => void;
  toggleSnap: () => void;
  setGridMode: (mode: 'dots' | 'grid' | 'off') => void;
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  openDockTab: (tab: DockTabId) => void;
  addEphemeralOverlay: (label?: string, targetEntityId?: string) => void;
  removeEphemeralOverlay: (id: string) => void;
  clearEphemeralOverlays: () => void;
  undo: () => void;
  redo: () => void;
  resetEphemeralState: () => void;
}

const ViewportInteractionContext = createContext<ViewportInteractionContextValue | null>(null);

function detectDesktopInitialInspector(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= 1024;
}

function detectDesktopInitialLayersPanel(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= 1280;
}

export interface ViewportInteractionProviderProps {
  children: React.ReactNode;
  initialEnvironment?: StudioEnvironment;
}

export const ViewportInteractionProvider: React.FC<ViewportInteractionProviderProps> = ({
  children,
  initialEnvironment = 'creative-studio'
}) => {
  const [state, dispatch] = useReducer(
    viewportInteractionReducer,
    {
      initialEnvironment,
      initialInspectorOpen: detectDesktopInitialInspector(),
      initialLayersPanelOpen: detectDesktopInitialLayersPanel()
    },
    createInitialViewportState
  );

  const prevWidthRef = useRef<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1440
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      const nextWidth = window.innerWidth;
      const prevWidth = prevWidthRef.current;
      prevWidthRef.current = nextWidth;
      if (prevWidth >= 1280 && nextWidth < 1280) {
        dispatch({ type: 'SET_LAYERS_PANEL_OPEN', open: false });
      }
      if (prevWidth >= 1024 && nextWidth < 1024) {
        dispatch({ type: 'SET_INSPECTOR_OPEN', open: false });
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const setEnvironment = useCallback((environment: StudioEnvironment) => {
    dispatch({ type: 'SET_ENVIRONMENT', environment });
  }, []);

  const setSimProdSubView = useCallback((subView: SimulationProductionSubView) => {
    dispatch({ type: 'SET_SIM_PROD_SUBVIEW', subView });
  }, []);

  const selectEntity = useCallback((entity: SelectedEntity | null, recordHistory?: boolean) => {
    dispatch({ type: 'SELECT_ENTITY', entity, recordHistory });
  }, []);

  const setHoveredEntity = useCallback((entity: HoveredEntityRef | null) => {
    dispatch({ type: 'SET_HOVERED_ENTITY', entity });
  }, []);

  const setSelectedLayerIds = useCallback((layerIds: readonly string[]) => {
    dispatch({ type: 'SET_SELECTED_LAYER_IDS', layerIds });
  }, []);

  const toggleLayerSelection = useCallback((layerId: string) => {
    dispatch({ type: 'TOGGLE_LAYER_SELECTION', layerId });
  }, []);

  const clearLayerSelection = useCallback(() => {
    dispatch({ type: 'SET_SELECTED_LAYER_IDS', layerIds: [] });
  }, []);

  const setActiveTool = useCallback((tool: WorkspaceToolId, environment?: StudioEnvironment) => {
    dispatch({ type: 'SET_ACTIVE_TOOL', tool, environment });
  }, []);

  const updateCamera = useCallback((patch: Partial<ViewportCameraState>, label?: string) => {
    dispatch({ type: 'UPDATE_CAMERA', patch, label });
  }, []);

  const resetCamera = useCallback(() => {
    dispatch({ type: 'RESET_CAMERA' });
  }, []);

  const setInspectorOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_INSPECTOR_OPEN', open });
  }, []);

  const toggleInspector = useCallback(() => {
    dispatch({ type: 'TOGGLE_INSPECTOR' });
  }, []);

  const setLayersPanelOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_LAYERS_PANEL_OPEN', open });
  }, []);

  const toggleLayersPanel = useCallback(() => {
    dispatch({ type: 'TOGGLE_LAYERS_PANEL' });
  }, []);

  const setBriefDrawerOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_BRIEF_DRAWER_OPEN', open });
  }, []);

  const toggleBriefDrawer = useCallback(() => {
    dispatch({ type: 'TOGGLE_BRIEF_DRAWER' });
  }, []);

  const setSnapEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_SNAP_ENABLED', enabled });
  }, []);

  const toggleSnap = useCallback(() => {
    dispatch({ type: 'TOGGLE_SNAP' });
  }, []);

  const setGridMode = useCallback((mode: 'dots' | 'grid' | 'off') => {
    dispatch({ type: 'SET_GRID_MODE', mode });
  }, []);

  const setDockOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_DOCK_OPEN', open });
  }, []);

  const toggleDock = useCallback(() => {
    dispatch({ type: 'TOGGLE_DOCK' });
  }, []);

  const openDockTab = useCallback((tab: DockTabId) => {
    dispatch({ type: 'OPEN_DOCK_TAB', tab });
  }, []);

  const addEphemeralOverlay = useCallback((label?: string, targetEntityId?: string) => {
    dispatch({ type: 'ADD_EPHEMERAL_OVERLAY', label, targetEntityId });
  }, []);

  const removeEphemeralOverlay = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_EPHEMERAL_OVERLAY', id });
  }, []);

  const clearEphemeralOverlays = useCallback(() => {
    dispatch({ type: 'CLEAR_EPHEMERAL_OVERLAYS' });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  const resetEphemeralState = useCallback(() => {
    dispatch({ type: 'RESET_EPHEMERAL_STATE' });
  }, []);

  const value = useMemo<ViewportInteractionContextValue>(
    () => ({
      state,
      activeEnvironment: state.activeEnvironment,
      simProdSubView: state.simProdSubView,
      selectedEntity: state.selectedEntity,
      selectedPieceId: extractSelectedPieceId(state.selectedEntity),
      hoveredEntity: state.hoveredEntity,
      selectedLayerIds: state.selectedLayerIds,
      activeTool: state.activeToolByEnv[state.activeEnvironment],
      camera: state.camera,
      inspectorOpen: state.inspectorOpen,
      layersPanelOpen: state.layersPanelOpen,
      briefDrawerOpen: state.briefDrawerOpen,
      snapEnabled: state.snapEnabled,
      gridMode: state.gridMode,
      dockOpen: state.dockOpen,
      activeDockTab: state.activeDockTab,
      ephemeralOverlays: state.ephemeralOverlays,
      canUndo: state.historyPast.length > 0,
      canRedo: state.historyFuture.length > 0,
      historyPast: state.historyPast,
      historyFuture: state.historyFuture,
      setEnvironment,
      setSimProdSubView,
      selectEntity,
      setHoveredEntity,
      setSelectedLayerIds,
      toggleLayerSelection,
      clearLayerSelection,
      setActiveTool,
      updateCamera,
      resetCamera,
      setInspectorOpen,
      toggleInspector,
      setLayersPanelOpen,
      toggleLayersPanel,
      setBriefDrawerOpen,
      toggleBriefDrawer,
      setSnapEnabled,
      toggleSnap,
      setGridMode,
      setDockOpen,
      toggleDock,
      openDockTab,
      addEphemeralOverlay,
      removeEphemeralOverlay,
      clearEphemeralOverlays,
      undo,
      redo,
      resetEphemeralState
    }),
    [
      state,
      setEnvironment,
      setSimProdSubView,
      selectEntity,
      setHoveredEntity,
      setSelectedLayerIds,
      toggleLayerSelection,
      clearLayerSelection,
      setActiveTool,
      updateCamera,
      resetCamera,
      setInspectorOpen,
      toggleInspector,
      setLayersPanelOpen,
      toggleLayersPanel,
      setBriefDrawerOpen,
      toggleBriefDrawer,
      setSnapEnabled,
      toggleSnap,
      setGridMode,
      setDockOpen,
      toggleDock,
      openDockTab,
      addEphemeralOverlay,
      removeEphemeralOverlay,
      clearEphemeralOverlays,
      undo,
      redo,
      resetEphemeralState
    ]
  );

  return (
    <ViewportInteractionContext.Provider value={value}>
      {children}
    </ViewportInteractionContext.Provider>
  );
};

export function useOptionalViewportInteraction(): ViewportInteractionContextValue | null {
  return useContext(ViewportInteractionContext);
}

export function useViewportInteraction(): ViewportInteractionContextValue {
  const ctx = useContext(ViewportInteractionContext);
  if (!ctx) {
    throw new Error('useViewportInteraction must be used within ViewportInteractionProvider');
  }
  return ctx;
}
