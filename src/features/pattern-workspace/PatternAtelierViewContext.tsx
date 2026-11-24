/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  CadCamera,
  CadRectCm,
  clampCadZoom,
  panCadByScreenDelta,
  zoomCadAtScreenPoint
} from './cad-math';
import type {
  CoordinateYAxisDirection,
  PatternArtifactBundle,
  RenderPoint2D
} from './contracts/pattern-render-artifact';
import type { AssemblyScenarioMode } from './AssemblyInspectionPanel';
import {
  alignBoardPieces,
  analyzeBoardOverlaps,
  BoardAlignAction,
  BoardDistributeAxis,
  BoardOverlapAdvisory,
  clearBoardSelection,
  commitBoardSnapshot,
  createBoardHistory,
  createEmptyBoardSnapshot,
  DEFAULT_SNAP_CONFIG,
  distributeBoardPieces,
  groupBoardPieces,
  movePiecesByDeltaCm,
  PatternBoardHistoryState,
  PatternBoardSnapshot,
  reconcileBoardHistoryWithArtifact,
  redoBoardHistory,
  reorderPieceLayer,
  resetBoardAutoLayout,
  selectPiecesInMarqueeRect,
  selectSinglePiece,
  setPieceBoardPositionCm,
  SnapCandidateGuide,
  SnapConfig,
  toggleGroupVisibility,
  togglePieceInSelection,
  togglePieceIntentionalOverlap,
  togglePieceVisibility,
  undoBoardHistory,
  ungroupBoardSelection,
  updateBoardSelectionWithoutHistory
} from './board-arrangement';

export type PatternCadViewMode = 'pieces' | 'assembly' | 'grading' | 'fit' | 'simulation';

export interface PatternCadLayerVisibility {
  readonly showSeamAllowance: boolean;
  readonly showSewLines: boolean;
  readonly showGrainline: boolean;
  readonly showNotches: boolean;
  readonly showDarts: boolean;
  readonly showDimensions: boolean;
}

export interface PatternAtelierViewContextValue {
  // Dedicated Pattern Atelier CAD camera (zoom 0.15..12.0, screen-px pan)
  // Camera state is strictly isolated from board-arrangement history.
  readonly camera: CadCamera;
  readonly setCamera: (next: CadCamera) => void;
  readonly zoomByFactor: (
    factor: number,
    anchorScreenPx?: RenderPoint2D,
    yAxisDirection?: CoordinateYAxisDirection
  ) => void;
  readonly zoomToValue: (
    targetZoom: number,
    anchorScreenPx?: RenderPoint2D,
    yAxisDirection?: CoordinateYAxisDirection
  ) => void;
  readonly panByScreenDelta: (dxPx: number, dyPx: number) => void;
  readonly requestFitAll: () => void;
  readonly fitRequestVersion: number;
  readonly resetCameraTo100: () => void;

  // Live cursor coordinate telemetry in cm (ephemeral UI state only)
  readonly cursorCm: RenderPoint2D | null;
  readonly setCursorCm: (pt: RenderPoint2D | null) => void;

  // View mode & inspection coordination (single source shared with ContextualInspector)
  readonly cadViewMode: PatternCadViewMode;
  readonly setCadViewMode: (mode: PatternCadViewMode) => void;
  readonly assemblyScenario: AssemblyScenarioMode;
  readonly setAssemblyScenario: (scenario: AssemblyScenarioMode) => void;
  readonly selectedPrototypeId: string;
  readonly setSelectedPrototypeId: (id: string) => void;
  readonly enabledGradingSizes: Readonly<Record<string, boolean>>;
  readonly toggleGradingSize: (size: string) => void;

  // Display layer toggles (cut, sew, grain, notches, darts, dimensions)
  readonly layerVisibility: PatternCadLayerVisibility;
  readonly toggleLayerVisibility: (key: keyof PatternCadLayerVisibility) => void;

  // UX-2.3.2: Authoritative Pattern Atelier Board Presentation State (separate from source geometry)
  readonly activeArtifact: PatternArtifactBundle | null;
  readonly syncArtifact: (artifact: PatternArtifactBundle) => void;
  readonly boardState: PatternBoardSnapshot;
  readonly overlapAdvisories: readonly BoardOverlapAdvisory[];

  // Selection (never mutates board-arrangement undo history)
  readonly selectPiece: (pieceId: string, options?: { expandGroup?: boolean }) => void;
  readonly toggleSelectPiece: (pieceId: string, options?: { expandGroup?: boolean }) => void;
  readonly selectMarqueeRect: (rectCm: CadRectCm, mode?: 'replace' | 'add') => void;
  readonly clearPieceSelection: () => void;

  // Board Arrangement Operations (recorded in dedicated bounded board history)
  readonly commitMovePieces: (pieceIds: readonly string[], dxCm: number, dyCm: number) => void;
  readonly setPiecePositionCm: (pieceId: string, offsetXCm: number, offsetYCm: number) => void;
  readonly alignSelectedPieces: (action: BoardAlignAction) => void;
  readonly distributeSelectedPieces: (axis: BoardDistributeAxis) => void;
  readonly groupSelectedPieces: (customName?: string) => void;
  readonly ungroupSelectedPieces: () => void;
  readonly ungroupById: (groupId: string) => void;
  readonly togglePieceVisible: (pieceId: string) => void;
  readonly toggleGroupVisible: (groupId: string) => void;
  readonly reorderPiece: (pieceId: string, direction: 'forward' | 'backward' | 'front' | 'back') => void;
  readonly togglePieceIntentionalOverlap: (pieceId: string) => void;
  readonly resetBoardLayout: () => void;

  // Dedicated Bounded Board-Arrangement Undo / Redo (never parametric drafting undo)
  readonly undoBoard: () => void;
  readonly redoBoard: () => void;
  readonly canUndoBoard: boolean;
  readonly canRedoBoard: boolean;
  readonly lastBoardActionLabel: string | null;

  // Centimeter Snapping & Live Guides
  readonly snapConfig: SnapConfig;
  readonly updateSnapConfig: (patch: Partial<SnapConfig>) => void;
  readonly activeSnapGuides: readonly SnapCandidateGuide[];
  readonly setActiveSnapGuides: (guides: readonly SnapCandidateGuide[]) => void;

  // Dedicated Pattern-Piece Layers Drawer visibility
  readonly layersDrawerOpen: boolean;
  readonly setLayersDrawerOpen: (open: boolean) => void;
}

const DEFAULT_CAMERA: CadCamera = { zoom: 1.0, panX: 48, panY: 48 };

const DEFAULT_GRADING_SIZES: Record<string, boolean> = {
  XS: true,
  S: true,
  M: true,
  L: true,
  XL: true,
  XXL: true
};

const DEFAULT_LAYER_VISIBILITY: PatternCadLayerVisibility = {
  showSeamAllowance: true,
  showSewLines: true,
  showGrainline: true,
  showNotches: true,
  showDarts: true,
  showDimensions: true
};

const PatternAtelierViewContext = createContext<PatternAtelierViewContextValue | null>(null);

export const PatternAtelierViewProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [camera, setCameraState] = useState<CadCamera>(DEFAULT_CAMERA);
  const [fitRequestVersion, setFitRequestVersion] = useState<number>(1);
  const [cursorCm, setCursorCm] = useState<RenderPoint2D | null>(null);
  const [cadViewMode, setCadViewMode] = useState<PatternCadViewMode>('pieces');
  const [assemblyScenario, setAssemblyScenario] = useState<AssemblyScenarioMode>('active-draft');
  const [selectedPrototypeId, setSelectedPrototypeId] = useState<string>('PROTO-BOD-2026-M-01');
  const [enabledGradingSizes, setEnabledGradingSizes] =
    useState<Record<string, boolean>>(DEFAULT_GRADING_SIZES);
  const [layerVisibility, setLayerVisibility] =
    useState<PatternCadLayerVisibility>(DEFAULT_LAYER_VISIBILITY);

  // UX-2.3.2 Board Arrangement State (isolated from immutable PatternArtifactBundle & camera)
  const [activeArtifact, setActiveArtifact] = useState<PatternArtifactBundle | null>(null);
  const [boardHistory, setBoardHistory] = useState<PatternBoardHistoryState>(() =>
    createBoardHistory(createEmptyBoardSnapshot())
  );
  const [snapConfig, setSnapConfig] = useState<SnapConfig>(DEFAULT_SNAP_CONFIG);
  const [activeSnapGuides, setActiveSnapGuides] = useState<readonly SnapCandidateGuide[]>([]);
  const [layersDrawerOpen, setLayersDrawerOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return true;
  });

  // Camera actions (never touch boardHistory)
  const setCamera = useCallback((next: CadCamera) => {
    setCameraState({
      zoom: clampCadZoom(next.zoom),
      panX: Number.isFinite(next.panX) ? next.panX : 0,
      panY: Number.isFinite(next.panY) ? next.panY : 0
    });
  }, []);

  const zoomToValue = useCallback(
    (
      targetZoom: number,
      anchorScreenPx?: RenderPoint2D,
      yAxisDirection: CoordinateYAxisDirection = 'svg-y-down'
    ) => {
      setCameraState(prev => {
        if (anchorScreenPx) {
          return zoomCadAtScreenPoint(prev, targetZoom, anchorScreenPx, { yAxisDirection });
        }
        return { ...prev, zoom: clampCadZoom(targetZoom) };
      });
    },
    []
  );

  const zoomByFactor = useCallback(
    (
      factor: number,
      anchorScreenPx?: RenderPoint2D,
      yAxisDirection: CoordinateYAxisDirection = 'svg-y-down'
    ) => {
      setCameraState(prev => {
        const nextZoom = clampCadZoom(prev.zoom * factor);
        if (anchorScreenPx) {
          return zoomCadAtScreenPoint(prev, nextZoom, anchorScreenPx, { yAxisDirection });
        }
        return { ...prev, zoom: nextZoom };
      });
    },
    []
  );

  const panByScreenDelta = useCallback((dxPx: number, dyPx: number) => {
    setCameraState(prev => panCadByScreenDelta(prev, dxPx, dyPx));
  }, []);

  const requestFitAll = useCallback(() => {
    setFitRequestVersion(v => v + 1);
  }, []);

  const resetCameraTo100 = useCallback(() => {
    setCameraState(DEFAULT_CAMERA);
  }, []);

  const toggleGradingSize = useCallback((size: string) => {
    setEnabledGradingSizes(prev => ({ ...prev, [size]: !prev[size] }));
  }, []);

  const toggleLayerVisibility = useCallback((key: keyof PatternCadLayerVisibility) => {
    setLayerVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Reconcile board arrangement deterministically when artifact updates
  const syncArtifact = useCallback((artifact: PatternArtifactBundle) => {
    setActiveArtifact(prev => (prev === artifact ? prev : artifact));
    setBoardHistory(prev => reconcileBoardHistoryWithArtifact(prev, artifact));
  }, []);

  // Selection actions (ephemeral — do not push to arrangement undo stack)
  const selectPiece = useCallback(
    (pieceId: string, options?: { expandGroup?: boolean }) => {
      setBoardHistory(prev =>
        updateBoardSelectionWithoutHistory(prev, selectSinglePiece(prev.present, pieceId, options))
      );
    },
    []
  );

  const toggleSelectPiece = useCallback(
    (pieceId: string, options?: { expandGroup?: boolean }) => {
      setBoardHistory(prev =>
        updateBoardSelectionWithoutHistory(
          prev,
          togglePieceInSelection(prev.present, pieceId, options)
        )
      );
    },
    []
  );

  const selectMarqueeRect = useCallback(
    (rectCm: CadRectCm, mode: 'replace' | 'add' = 'replace') => {
      if (!activeArtifact) return;
      setBoardHistory(prev =>
        updateBoardSelectionWithoutHistory(
          prev,
          selectPiecesInMarqueeRect(prev.present, activeArtifact, rectCm, mode)
        )
      );
    },
    [activeArtifact]
  );

  const clearPieceSelection = useCallback(() => {
    setBoardHistory(prev =>
      updateBoardSelectionWithoutHistory(prev, clearBoardSelection(prev.present))
    );
  }, []);

  // Arrangement mutations (committed to dedicated bounded board history)
  const commitMovePieces = useCallback(
    (pieceIds: readonly string[], dxCm: number, dyCm: number) => {
      setBoardHistory(prev =>
        commitBoardSnapshot(
          prev,
          movePiecesByDeltaCm(prev.present, pieceIds, dxCm, dyCm),
          pieceIds.length > 1 ? `Reposition ${pieceIds.length} pieces` : 'Reposition piece'
        )
      );
    },
    []
  );

  const setPiecePositionCm = useCallback(
    (pieceId: string, offsetXCm: number, offsetYCm: number) => {
      setBoardHistory(prev =>
        commitBoardSnapshot(
          prev,
          setPieceBoardPositionCm(prev.present, pieceId, offsetXCm, offsetYCm),
          'Set piece board coordinates'
        )
      );
    },
    []
  );

  const alignSelectedPieces = useCallback(
    (action: BoardAlignAction) => {
      if (!activeArtifact) return;
      setBoardHistory(prev =>
        commitBoardSnapshot(
          prev,
          alignBoardPieces(prev.present, activeArtifact, prev.present.selectedPieceIds, action),
          `Align pieces ${action}`
        )
      );
    },
    [activeArtifact]
  );

  const distributeSelectedPieces = useCallback(
    (axis: BoardDistributeAxis) => {
      if (!activeArtifact) return;
      setBoardHistory(prev =>
        commitBoardSnapshot(
          prev,
          distributeBoardPieces(prev.present, activeArtifact, prev.present.selectedPieceIds, axis),
          `Distribute pieces ${axis}`
        )
      );
    },
    [activeArtifact]
  );

  const groupSelectedPieces = useCallback((customName?: string) => {
    setBoardHistory(prev =>
      commitBoardSnapshot(
        prev,
        groupBoardPieces(prev.present, prev.present.selectedPieceIds, customName),
        'Group pattern pieces'
      )
    );
  }, []);

  const ungroupSelectedPieces = useCallback(() => {
    setBoardHistory(prev =>
      commitBoardSnapshot(
        prev,
        ungroupBoardSelection(prev.present, prev.present.selectedPieceIds),
        'Ungroup pattern pieces'
      )
    );
  }, []);

  const ungroupById = useCallback((groupId: string) => {
    setBoardHistory(prev =>
      commitBoardSnapshot(prev, ungroupBoardSelection(prev.present, [groupId]), 'Ungroup pieces')
    );
  }, []);

  const togglePieceVisible = useCallback((pieceId: string) => {
    setBoardHistory(prev =>
      commitBoardSnapshot(
        prev,
        togglePieceVisibility(prev.present, pieceId),
        'Toggle piece visibility'
      )
    );
  }, []);

  const toggleGroupVisible = useCallback((groupId: string) => {
    setBoardHistory(prev =>
      commitBoardSnapshot(
        prev,
        toggleGroupVisibility(prev.present, groupId),
        'Toggle group visibility'
      )
    );
  }, []);

  const reorderPiece = useCallback(
    (pieceId: string, direction: 'forward' | 'backward' | 'front' | 'back') => {
      setBoardHistory(prev =>
        commitBoardSnapshot(
          prev,
          reorderPieceLayer(prev.present, pieceId, direction),
          `Reorder piece ${direction}`
        )
      );
    },
    []
  );

  const toggleIntentionalOverlap = useCallback((pieceId: string) => {
    setBoardHistory(prev =>
      commitBoardSnapshot(
        prev,
        togglePieceIntentionalOverlap(prev.present, pieceId),
        'Toggle intentional overlap marker'
      )
    );
  }, []);

  const resetBoardLayout = useCallback(() => {
    if (!activeArtifact) return;
    setBoardHistory(prev =>
      commitBoardSnapshot(
        prev,
        resetBoardAutoLayout(prev.present, activeArtifact),
        'Reset board auto-layout'
      )
    );
    setFitRequestVersion(v => v + 1);
  }, [activeArtifact]);

  const undoBoard = useCallback(() => {
    setBoardHistory(prev => undoBoardHistory(prev));
  }, []);

  const redoBoard = useCallback(() => {
    setBoardHistory(prev => redoBoardHistory(prev));
  }, []);

  const updateSnapConfig = useCallback((patch: Partial<SnapConfig>) => {
    setSnapConfig(prev => ({
      ...prev,
      ...patch,
      gridIntervalCm:
        patch.gridIntervalCm !== undefined && Number.isFinite(patch.gridIntervalCm)
          ? Math.max(0.1, patch.gridIntervalCm)
          : prev.gridIntervalCm,
      toleranceCm:
        patch.toleranceCm !== undefined && Number.isFinite(patch.toleranceCm)
          ? Math.max(0.1, patch.toleranceCm)
          : prev.toleranceCm
    }));
  }, []);

  const overlapAdvisories = useMemo<readonly BoardOverlapAdvisory[]>(() => {
    if (!activeArtifact || activeArtifact.pieces.length === 0) return [];
    return analyzeBoardOverlaps(boardHistory.present, activeArtifact);
  }, [boardHistory.present, activeArtifact]);

  const value = useMemo<PatternAtelierViewContextValue>(
    () => ({
      camera,
      setCamera,
      zoomByFactor,
      zoomToValue,
      panByScreenDelta,
      requestFitAll,
      fitRequestVersion,
      resetCameraTo100,
      cursorCm,
      setCursorCm,
      cadViewMode,
      setCadViewMode,
      assemblyScenario,
      setAssemblyScenario,
      selectedPrototypeId,
      setSelectedPrototypeId,
      enabledGradingSizes,
      toggleGradingSize,
      layerVisibility,
      toggleLayerVisibility,
      activeArtifact,
      syncArtifact,
      boardState: boardHistory.present,
      overlapAdvisories,
      selectPiece,
      toggleSelectPiece,
      selectMarqueeRect,
      clearPieceSelection,
      commitMovePieces,
      setPiecePositionCm,
      alignSelectedPieces,
      distributeSelectedPieces,
      groupSelectedPieces,
      ungroupSelectedPieces,
      ungroupById,
      togglePieceVisible,
      toggleGroupVisible,
      reorderPiece,
      togglePieceIntentionalOverlap: toggleIntentionalOverlap,
      resetBoardLayout,
      undoBoard,
      redoBoard,
      canUndoBoard: boardHistory.past.length > 0,
      canRedoBoard: boardHistory.future.length > 0,
      lastBoardActionLabel: boardHistory.lastActionLabel,
      snapConfig,
      updateSnapConfig,
      activeSnapGuides,
      setActiveSnapGuides,
      layersDrawerOpen,
      setLayersDrawerOpen
    }),
    [
      camera,
      setCamera,
      zoomByFactor,
      zoomToValue,
      panByScreenDelta,
      requestFitAll,
      fitRequestVersion,
      resetCameraTo100,
      cursorCm,
      cadViewMode,
      assemblyScenario,
      selectedPrototypeId,
      enabledGradingSizes,
      toggleGradingSize,
      layerVisibility,
      toggleLayerVisibility,
      activeArtifact,
      syncArtifact,
      boardHistory,
      overlapAdvisories,
      selectPiece,
      toggleSelectPiece,
      selectMarqueeRect,
      clearPieceSelection,
      commitMovePieces,
      setPiecePositionCm,
      alignSelectedPieces,
      distributeSelectedPieces,
      groupSelectedPieces,
      ungroupSelectedPieces,
      ungroupById,
      togglePieceVisible,
      toggleGroupVisible,
      reorderPiece,
      toggleIntentionalOverlap,
      resetBoardLayout,
      undoBoard,
      redoBoard,
      snapConfig,
      updateSnapConfig,
      activeSnapGuides,
      layersDrawerOpen
    ]
  );

  return (
    <PatternAtelierViewContext.Provider value={value}>
      {children}
    </PatternAtelierViewContext.Provider>
  );
};

export function useOptionalPatternAtelierView(): PatternAtelierViewContextValue | null {
  return useContext(PatternAtelierViewContext);
}

export function usePatternAtelierView(): PatternAtelierViewContextValue {
  const ctx = useContext(PatternAtelierViewContext);
  if (!ctx) {
    throw new Error('usePatternAtelierView must be used inside a PatternAtelierViewProvider.');
  }
  return ctx;
}
