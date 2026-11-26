/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
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
import {
  CadInspectableEntity,
  reconcileInspectedEntityWithArtifact
} from './entity-hit-test';
import {
  EMPTY_MEASUREMENT_SESSION,
  MeasureToolSubMode,
  MeasurementEvaluation,
  MeasurementSession,
  applyMeasurementEntityClick,
  evaluateMeasurementSession,
  lockPendingVertexAngleMeasurement,
  reconcileMeasurementSessionWithArtifact,
  swapMeasurementAnchors,
  transitionMeasurementSessionOnToolExit
} from './precision-measurement';
import {
  DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
  DiagnosticSeverity,
  DiagnosticSeverityFilter,
  ResolvedArtifactDiagnostics,
  reconcileDiagnosticSelection,
  resolveArtifactDiagnostics
} from './spatial-diagnostics';
import {
  alignVertexToReference,
  applyCubicToLineApproximation,
  applyRemoveVertexAndMerge,
  buildProposedInspectionArtifact,
  canRedoProposal,
  canUndoProposal,
  commitProposalOperation,
  ContourEditSelection,
  createEmptyProposalHistory,
  DEFAULT_APPROXIMATION_TOLERANCE_CM,
  discardAllProposal,
  discardPieceProposal,
  elevateLineToCubicExact,
  evaluateProposalIntegrity,
  GeometryProposalHistoryState,
  HandleContinuityMode,
  moveBezierHandle,
  moveContourVertex,
  PatternGeometryProposalState,
  PendingApproximateOperationPreview,
  previewCubicToLineApproximation,
  previewRemoveVertexAndMerge,
  ProposalIntegrityReport,
  reconcileProposalHistoryWithArtifact,
  redoProposalHistory,
  setVertexContinuityMode,
  splitSewSegmentAtT,
  undoProposalHistory,
  updateProposalTolerance
} from './geometry-edit-proposal';

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
  // Dedicated Pattern Atelier CAD camera actions (zoom 0.15..12.0, screen-px pan)
  // Camera state is isolated in PatternAtelierCameraContext (read via useOptionalPatternAtelierCamera)
  // so pan/zoom never re-renders shell, inspector, tool rail, or layers drawer.
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

  // Live cursor coordinate telemetry setter (ephemeral UI state; read via useOptionalPatternAtelierCursor)
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

  // UX-2.3.3.1: Ephemeral Read-Only Geometric Entity Inspection State
  // Strictly outside boardHistory and ProjectWorkspaceContext; never mutates PatternArtifactBundle.
  readonly hoveredEntity: CadInspectableEntity | null;
  readonly setHoveredEntity: (entity: CadInspectableEntity | null) => void;
  readonly inspectedEntity: CadInspectableEntity | null;
  readonly setInspectedEntity: (entity: CadInspectableEntity | null) => void;
  readonly clearInspectedEntity: () => void;
  readonly showControlPolygon: boolean;
  readonly setShowControlPolygon: (show: boolean) => void;

  // UX-2.3.3.2: Ephemeral Advisory Precision Measurement State
  // Strictly outside boardHistory and ProjectWorkspaceContext; never mutates PatternArtifactBundle.
  readonly measureSubMode: MeasureToolSubMode;
  readonly setMeasureSubMode: (mode: MeasureToolSubMode) => void;
  readonly measurementHoverEntity: CadInspectableEntity | null;
  readonly setMeasurementHoverEntity: (entity: CadInspectableEntity | null) => void;
  readonly measurementSession: MeasurementSession;
  readonly measurementEvaluation: MeasurementEvaluation;
  readonly recordMeasurementEntityClick: (entity: CadInspectableEntity) => void;
  readonly swapMeasurementAnchors: () => void;
  readonly lockPendingVertexAngle: () => void;
  readonly clearMeasurementSession: () => void;
  readonly handleMeasurementToolTransition: (nextTool: string) => void;

  // UX-2.3.3.3: Ephemeral Read-Only Spatial Diagnostic State (D3/D4/F)
  // Strictly outside boardHistory, ProjectWorkspaceContext, measurementSession, and inspectedEntity.
  readonly resolvedDiagnostics: ResolvedArtifactDiagnostics;
  readonly showDiagnosticsOverlay: boolean;
  readonly setShowDiagnosticsOverlay: (show: boolean) => void;
  readonly toggleDiagnosticsOverlay: () => void;
  readonly diagnosticSeverityFilter: DiagnosticSeverityFilter;
  readonly toggleDiagnosticSeverityFilter: (severity: DiagnosticSeverity) => void;
  readonly selectedDiagnosticKey: string | null;
  readonly hoveredDiagnosticKey: string | null;
  readonly selectDiagnostic: (diagnosticKey: string | null) => void;
  readonly setHoveredDiagnosticKey: (diagnosticKey: string | null) => void;
  readonly clearDiagnosticSelection: () => void;
  readonly diagnosticLocateRequest: {
    readonly diagnosticKey: string;
    readonly version: number;
  } | null;
  readonly locateDiagnosticOnCanvas: (diagnosticKey: string) => void;
  readonly diagnosticReconciliationNotice: string | null;
  readonly dismissDiagnosticReconciliationNotice: () => void;

  // UX-2.3.3.4: Proposal-Based Sew-Contour Editing State & Independent Bounded History (D1-D5, R1-R4)
  // Strictly isolated from boardHistory, immutable activeArtifact, and spatial diagnostics.
  readonly proposalHistory: GeometryProposalHistoryState | null;
  readonly proposalState: PatternGeometryProposalState | null;
  readonly proposedArtifact: PatternArtifactBundle | null;
  /** Artifact currently targeted by Inspect (I) and Measure (M) per D3 (proposed sew contour unless comparing original). */
  readonly inspectionTargetArtifact: PatternArtifactBundle | null;
  readonly isInspectingProposal: boolean;
  readonly compareOriginalGeometry: boolean;
  readonly setCompareOriginalGeometry: (compare: boolean) => void;
  readonly toggleCompareOriginalGeometry: () => void;
  readonly proposalIntegrity: ProposalIntegrityReport | null;
  readonly contourEditSelection: ContourEditSelection | null;
  readonly setContourEditSelection: (selection: ContourEditSelection | null) => void;
  readonly clearContourEditSelection: () => void;
  readonly translateAdjacentHandles: boolean;
  readonly setTranslateAdjacentHandles: (translate: boolean) => void;
  readonly activeContinuityMode: HandleContinuityMode;
  readonly setActiveContinuityMode: (mode: HandleContinuityMode) => void;
  readonly pendingApproximatePreview: PendingApproximateOperationPreview | null;
  readonly proposalActionNotice: {
    readonly kind: 'info' | 'warning' | 'error';
    readonly message: string;
  } | null;
  readonly clearProposalActionNotice: () => void;
  readonly commitMoveContourVertex: (
    pieceId: string,
    vertexRef: string,
    nextLocalCm: RenderPoint2D,
    options?: { readonly translateAdjacentHandles?: boolean }
  ) => boolean;
  readonly commitMoveBezierHandle: (
    pieceId: string,
    segmentId: string,
    handleSlot: 'p1' | 'p2',
    nextLocalCm: RenderPoint2D,
    options?: { readonly continuityMode?: HandleContinuityMode }
  ) => boolean;
  readonly commitSetVertexContinuity: (
    pieceId: string,
    vertexRef: string,
    mode: HandleContinuityMode
  ) => boolean;
  readonly commitAlignVertex: (
    pieceId: string,
    vertexRef: string,
    axis: 'horizontal' | 'vertical',
    referenceLocalCm: RenderPoint2D
  ) => boolean;
  readonly commitSplitSewSegment: (pieceId: string, segmentId: string, t: number) => boolean;
  readonly commitElevateLineToCubic: (pieceId: string, segmentId: string) => boolean;
  readonly requestCubicToLinePreview: (
    pieceId: string,
    segmentId: string,
    toleranceCm?: number
  ) => void;
  readonly requestRemoveVertexPreview: (
    pieceId: string,
    vertexRef: string,
    toleranceCm?: number
  ) => void;
  readonly confirmPendingApproximateOperation: () => boolean;
  readonly cancelPendingApproximateOperation: () => void;
  readonly setProposalApproximationTolerance: (toleranceCm: number) => void;
  readonly undoProposal: () => void;
  readonly redoProposal: () => void;
  readonly canUndoProposal: boolean;
  readonly canRedoProposal: boolean;
  readonly lastProposalActionLabel: string | null;
  readonly discardPieceProposalEdits: (pieceId: string) => void;
  readonly discardAllProposalEdits: () => void;
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

interface PatternAtelierCameraActions {
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
  readonly resetCameraTo100: () => void;
}

const PatternAtelierViewContext = createContext<PatternAtelierViewContextValue | null>(null);
const PatternAtelierCameraContext = createContext<CadCamera | null>(null);
const PatternAtelierCameraActionsContext = createContext<PatternAtelierCameraActions | null>(null);
const PatternAtelierCursorContext = createContext<RenderPoint2D | null>(null);
const PatternAtelierCursorSetterContext = createContext<((pt: RenderPoint2D | null) => void) | null>(
  null
);

const PatternAtelierCameraProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [camera, setCameraState] = useState<CadCamera>(DEFAULT_CAMERA);

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

  const resetCameraTo100 = useCallback(() => {
    setCameraState(DEFAULT_CAMERA);
  }, []);

  const actions = useMemo<PatternAtelierCameraActions>(
    () => ({
      setCamera,
      zoomByFactor,
      zoomToValue,
      panByScreenDelta,
      resetCameraTo100
    }),
    [setCamera, zoomByFactor, zoomToValue, panByScreenDelta, resetCameraTo100]
  );

  return (
    <PatternAtelierCameraActionsContext.Provider value={actions}>
      <PatternAtelierCameraContext.Provider value={camera}>
        {children}
      </PatternAtelierCameraContext.Provider>
    </PatternAtelierCameraActionsContext.Provider>
  );
};

const PatternAtelierCursorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cursorCm, setCursorCm] = useState<RenderPoint2D | null>(null);
  return (
    <PatternAtelierCursorSetterContext.Provider value={setCursorCm}>
      <PatternAtelierCursorContext.Provider value={cursorCm}>
        {children}
      </PatternAtelierCursorContext.Provider>
    </PatternAtelierCursorSetterContext.Provider>
  );
};

const PatternAtelierViewStateProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const setCursorCm = useContext(PatternAtelierCursorSetterContext)!;
  const { setCamera, zoomByFactor, zoomToValue, panByScreenDelta, resetCameraTo100 } = useContext(
    PatternAtelierCameraActionsContext
  )!;
  const [fitRequestVersion, setFitRequestVersion] = useState<number>(1);
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

  // UX-2.3.3.1 Ephemeral Entity Inspection State (strictly outside boardHistory)
  const [hoveredEntity, setHoveredEntity] = useState<CadInspectableEntity | null>(null);
  const [rawInspectedEntity, setRawInspectedEntity] = useState<CadInspectableEntity | null>(null);
  const [showControlPolygon, setShowControlPolygon] = useState<boolean>(true);
  const lastSyncedArtifactRef = useRef<PatternArtifactBundle | null>(null);

  // UX-2.3.3.2 Ephemeral Precision Measurement State (strictly outside boardHistory)
  const [measureSubMode, setMeasureSubMode] = useState<MeasureToolSubMode>('auto');
  const [measurementHoverEntity, setMeasurementHoverEntity] =
    useState<CadInspectableEntity | null>(null);
  const [rawMeasurementSession, setRawMeasurementSession] = useState<MeasurementSession>(
    EMPTY_MEASUREMENT_SESSION
  );

  // UX-2.3.3.3 Ephemeral Spatial Diagnostic State (D3: enabled by default; D4: independent of inspect/measure)
  const [showDiagnosticsOverlay, setShowDiagnosticsOverlay] = useState<boolean>(true);
  const [diagnosticSeverityFilter, setDiagnosticSeverityFilter] =
    useState<DiagnosticSeverityFilter>(DEFAULT_DIAGNOSTIC_SEVERITY_FILTER);
  const [rawSelectedDiagnosticKey, setRawSelectedDiagnosticKey] = useState<string | null>(null);
  const [hoveredDiagnosticKey, setHoveredDiagnosticKey] = useState<string | null>(null);
  const [diagnosticLocateRequest, setDiagnosticLocateRequest] = useState<{
    readonly diagnosticKey: string;
    readonly version: number;
  } | null>(null);
  const [dismissedReconcileArtifactKey, setDismissedReconcileArtifactKey] = useState<string | null>(
    null
  );

  // UX-2.3.3.4: Independent Geometry Proposal History & Ephemeral Contour Edit State (D4)
  const [proposalHistory, setProposalHistory] = useState<GeometryProposalHistoryState | null>(null);
  const [compareOriginalGeometry, setCompareOriginalGeometry] = useState<boolean>(false);
  const [contourEditSelection, setContourEditSelection] = useState<ContourEditSelection | null>(null);
  const [translateAdjacentHandles, setTranslateAdjacentHandles] = useState<boolean>(true);
  const [activeContinuityMode, setActiveContinuityMode] =
    useState<HandleContinuityMode>('c0-corner');
  const [pendingApproximatePreview, setPendingApproximatePreview] =
    useState<PendingApproximateOperationPreview | null>(null);
  const [proposalActionNotice, setProposalActionNotice] = useState<{
    readonly kind: 'info' | 'warning' | 'error';
    readonly message: string;
  } | null>(null);

  const requestFitAll = useCallback(() => {
    setFitRequestVersion(v => v + 1);
  }, []);

  const toggleGradingSize = useCallback((size: string) => {
    setEnabledGradingSizes(prev => ({ ...prev, [size]: !prev[size] }));
  }, []);

  const toggleLayerVisibility = useCallback((key: keyof PatternCadLayerVisibility) => {
    setLayerVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Reconcile board arrangement, entity inspection, & geometry proposal deterministically when artifact updates
  const syncArtifact = useCallback((artifact: PatternArtifactBundle) => {
    if (lastSyncedArtifactRef.current === artifact) return;
    lastSyncedArtifactRef.current = artifact;
    setActiveArtifact(artifact);
    setHoveredEntity(null);
    setMeasurementHoverEntity(null);
    setHoveredDiagnosticKey(null);
    setPendingApproximatePreview(null);
    setBoardHistory(prev => reconcileBoardHistoryWithArtifact(prev, artifact));
    setProposalHistory(prev =>
      prev ? reconcileProposalHistoryWithArtifact(prev, artifact) : createEmptyProposalHistory(artifact)
    );
  }, []);

  const setInspectedEntity = useCallback((entity: CadInspectableEntity | null) => {
    setRawInspectedEntity(entity);
  }, []);

  const clearInspectedEntity = useCallback(() => {
    setRawInspectedEntity(null);
    setHoveredEntity(null);
  }, []);

  const recordMeasurementEntityClick = useCallback(
    (entity: CadInspectableEntity) => {
      setRawMeasurementSession(prev => applyMeasurementEntityClick(prev, entity, measureSubMode));
    },
    [measureSubMode]
  );

  const handleSwapMeasurementAnchors = useCallback(() => {
    setRawMeasurementSession(prev => swapMeasurementAnchors(prev));
  }, []);

  const lockPendingVertexAngle = useCallback(() => {
    setRawMeasurementSession(prev => lockPendingVertexAngleMeasurement(prev));
  }, []);

  const clearMeasurementSession = useCallback(() => {
    setRawMeasurementSession(EMPTY_MEASUREMENT_SESSION);
    setMeasurementHoverEntity(null);
  }, []);

  const handleMeasurementToolTransition = useCallback((nextTool: string) => {
    if (nextTool !== 'measure-preview') {
      setMeasurementHoverEntity(null);
    }
    setRawMeasurementSession(prev => transitionMeasurementSessionOnToolExit(prev, nextTool));
  }, []);

  const toggleDiagnosticsOverlay = useCallback(() => {
    setShowDiagnosticsOverlay(prev => !prev);
  }, []);

  const toggleDiagnosticSeverityFilter = useCallback((severity: DiagnosticSeverity) => {
    setDiagnosticSeverityFilter(prev => ({
      ...prev,
      [severity]: !prev[severity]
    }));
  }, []);

  const selectDiagnostic = useCallback((diagnosticKey: string | null) => {
    setRawSelectedDiagnosticKey(diagnosticKey);
    setDismissedReconcileArtifactKey(null);
  }, []);

  const clearDiagnosticSelection = useCallback(() => {
    setRawSelectedDiagnosticKey(null);
    setHoveredDiagnosticKey(null);
    setDismissedReconcileArtifactKey(null);
  }, []);

  const locateDiagnosticOnCanvas = useCallback((diagnosticKey: string) => {
    setRawSelectedDiagnosticKey(diagnosticKey);
    setShowDiagnosticsOverlay(true);
    setDismissedReconcileArtifactKey(null);
    setDiagnosticLocateRequest(prev => ({
      diagnosticKey,
      version: (prev?.version ?? 0) + 1
    }));
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

  const proposalState = proposalHistory?.present ?? null;

  const proposedArtifact = useMemo<PatternArtifactBundle | null>(() => {
    if (!activeArtifact) return null;
    if (!proposalState) return activeArtifact;
    return buildProposedInspectionArtifact(activeArtifact, proposalState);
  }, [activeArtifact, proposalState]);

  const inspectionTargetArtifact = useMemo<PatternArtifactBundle | null>(() => {
    if (!activeArtifact) return null;
    if (
      compareOriginalGeometry ||
      !proposalState ||
      !proposalState.hasEdits ||
      proposalState.reconciliationStatus !== 'aligned'
    ) {
      return activeArtifact;
    }
    return proposedArtifact ?? activeArtifact;
  }, [activeArtifact, compareOriginalGeometry, proposalState, proposedArtifact]);

  const isInspectingProposal = Boolean(
    activeArtifact && inspectionTargetArtifact && inspectionTargetArtifact !== activeArtifact
  );

  const proposalIntegrity = useMemo<ProposalIntegrityReport | null>(() => {
    if (!activeArtifact || !proposalState) return null;
    return evaluateProposalIntegrity(proposalState, activeArtifact, contourEditSelection?.pieceId);
  }, [activeArtifact, proposalState, contourEditSelection?.pieceId]);

  const toggleCompareOriginalGeometry = useCallback(() => {
    setCompareOriginalGeometry(prev => !prev);
  }, []);

  const clearContourEditSelection = useCallback(() => {
    setContourEditSelection(null);
    setPendingApproximatePreview(null);
  }, []);

  const clearProposalActionNotice = useCallback(() => {
    setProposalActionNotice(null);
  }, []);

  const commitMoveContourVertex = useCallback(
    (
      pieceId: string,
      vertexRef: string,
      nextLocalCm: RenderPoint2D,
      options?: { readonly translateAdjacentHandles?: boolean }
    ): boolean => {
      if (!activeArtifact) return false;
      let applied = false;
      setPendingApproximatePreview(null);
      setProposalHistory(prev => {
        const current = prev ?? createEmptyProposalHistory(activeArtifact);
        const res = moveContourVertex(current.present, activeArtifact, pieceId, vertexRef, nextLocalCm, {
          translateAdjacentHandles: options?.translateAdjacentHandles ?? translateAdjacentHandles
        });
        if (!res.ok) {
          if (res.errorCode !== 'NO_OP') {
            setProposalActionNotice({ kind: 'error', message: res.message });
          }
          return current;
        }
        applied = true;
        setProposalActionNotice(null);
        return commitProposalOperation(current, res.state, res.actionLabel, res.pieceId);
      });
      return applied;
    },
    [activeArtifact, translateAdjacentHandles]
  );

  const commitMoveBezierHandle = useCallback(
    (
      pieceId: string,
      segmentId: string,
      handleSlot: 'p1' | 'p2',
      nextLocalCm: RenderPoint2D,
      options?: { readonly continuityMode?: HandleContinuityMode }
    ): boolean => {
      if (!activeArtifact) return false;
      let applied = false;
      setPendingApproximatePreview(null);
      setProposalHistory(prev => {
        const current = prev ?? createEmptyProposalHistory(activeArtifact);
        const res = moveBezierHandle(
          current.present,
          activeArtifact,
          pieceId,
          segmentId,
          handleSlot,
          nextLocalCm,
          { continuityMode: options?.continuityMode ?? activeContinuityMode }
        );
        if (!res.ok) {
          if (res.errorCode !== 'NO_OP') {
            setProposalActionNotice({ kind: 'error', message: res.message });
          }
          return current;
        }
        applied = true;
        setProposalActionNotice(null);
        return commitProposalOperation(current, res.state, res.actionLabel, res.pieceId);
      });
      return applied;
    },
    [activeArtifact, activeContinuityMode]
  );

  const commitSetVertexContinuity = useCallback(
    (pieceId: string, vertexRef: string, mode: HandleContinuityMode): boolean => {
      setActiveContinuityMode(mode);
      if (!activeArtifact) return false;
      let applied = false;
      setProposalHistory(prev => {
        const current = prev ?? createEmptyProposalHistory(activeArtifact);
        const res = setVertexContinuityMode(current.present, activeArtifact, pieceId, vertexRef, mode);
        if (!res.ok) {
          setProposalActionNotice({ kind: 'error', message: res.message });
          return current;
        }
        applied = true;
        setProposalActionNotice({ kind: 'info', message: res.actionLabel });
        return commitProposalOperation(current, res.state, res.actionLabel, res.pieceId);
      });
      return applied;
    },
    [activeArtifact]
  );

  const commitAlignVertex = useCallback(
    (
      pieceId: string,
      vertexRef: string,
      axis: 'horizontal' | 'vertical',
      referenceLocalCm: RenderPoint2D
    ): boolean => {
      if (!activeArtifact) return false;
      let applied = false;
      setPendingApproximatePreview(null);
      setProposalHistory(prev => {
        const current = prev ?? createEmptyProposalHistory(activeArtifact);
        const res = alignVertexToReference(
          current.present,
          activeArtifact,
          pieceId,
          vertexRef,
          axis,
          referenceLocalCm,
          translateAdjacentHandles
        );
        if (!res.ok) {
          if (res.errorCode !== 'NO_OP') {
            setProposalActionNotice({ kind: 'error', message: res.message });
          }
          return current;
        }
        applied = true;
        setProposalActionNotice({ kind: 'info', message: res.actionLabel });
        return commitProposalOperation(current, res.state, res.actionLabel, res.pieceId);
      });
      return applied;
    },
    [activeArtifact, translateAdjacentHandles]
  );

  const commitSplitSewSegment = useCallback(
    (pieceId: string, segmentId: string, t: number): boolean => {
      if (!activeArtifact) return false;
      let applied = false;
      let nextVertexRef: string | undefined;
      setPendingApproximatePreview(null);
      setProposalHistory(prev => {
        const current = prev ?? createEmptyProposalHistory(activeArtifact);
        const res = splitSewSegmentAtT(current.present, activeArtifact, pieceId, segmentId, t);
        if (!res.ok) {
          setProposalActionNotice({ kind: 'error', message: res.message });
          return current;
        }
        applied = true;
        nextVertexRef = res.nextSelectedVertexRef;
        setProposalActionNotice({ kind: 'info', message: res.actionLabel });
        return commitProposalOperation(current, res.state, res.actionLabel, res.pieceId);
      });
      if (nextVertexRef) {
        setContourEditSelection({ pieceId, kind: 'vertex', vertexRef: nextVertexRef });
      }
      return applied;
    },
    [activeArtifact]
  );

  const commitElevateLineToCubic = useCallback(
    (pieceId: string, segmentId: string): boolean => {
      if (!activeArtifact) return false;
      let applied = false;
      setPendingApproximatePreview(null);
      setProposalHistory(prev => {
        const current = prev ?? createEmptyProposalHistory(activeArtifact);
        const res = elevateLineToCubicExact(current.present, activeArtifact, pieceId, segmentId);
        if (!res.ok) {
          setProposalActionNotice({ kind: 'error', message: res.message });
          return current;
        }
        applied = true;
        setProposalActionNotice({ kind: 'info', message: res.actionLabel });
        return commitProposalOperation(current, res.state, res.actionLabel, res.pieceId);
      });
      return applied;
    },
    [activeArtifact]
  );

  const requestCubicToLinePreview = useCallback(
    (pieceId: string, segmentId: string, toleranceCm?: number) => {
      if (!activeArtifact || !proposalState) return;
      const preview = previewCubicToLineApproximation(
        proposalState,
        activeArtifact,
        pieceId,
        segmentId,
        toleranceCm ?? proposalState.defaultApproximationToleranceCm
      );
      if ('ok' in preview) {
        setPendingApproximatePreview(null);
        setProposalActionNotice({ kind: 'error', message: preview.message });
        return;
      }
      setPendingApproximatePreview(preview);
      setProposalActionNotice({
        kind: preview.exceedsTolerance ? 'error' : 'warning',
        message: preview.summaryLabel
      });
    },
    [activeArtifact, proposalState]
  );

  const requestRemoveVertexPreview = useCallback(
    (pieceId: string, vertexRef: string, toleranceCm?: number) => {
      if (!activeArtifact || !proposalState) return;
      const preview = previewRemoveVertexAndMerge(
        proposalState,
        activeArtifact,
        pieceId,
        vertexRef,
        toleranceCm ?? proposalState.defaultApproximationToleranceCm
      );
      if ('ok' in preview) {
        setPendingApproximatePreview(null);
        setProposalActionNotice({ kind: 'error', message: preview.message });
        return;
      }
      setPendingApproximatePreview(preview);
      setProposalActionNotice({
        kind: !preview.canApply ? 'error' : preview.isExact ? 'info' : 'warning',
        message: preview.summaryLabel
      });
    },
    [activeArtifact, proposalState]
  );

  const confirmPendingApproximateOperation = useCallback((): boolean => {
    if (!activeArtifact || !pendingApproximatePreview) return false;
    if (!pendingApproximatePreview.canApply) {
      setProposalActionNotice({
        kind: 'error',
        message:
          pendingApproximatePreview.rejectionReason ??
          'Operation cannot be applied because tolerance or topology constraints are violated.'
      });
      return false;
    }

    let applied = false;
    let nextSegId: string | undefined;
    const preview = pendingApproximatePreview;

    setProposalHistory(prev => {
      const current = prev ?? createEmptyProposalHistory(activeArtifact);
      const res =
        preview.operationKind === 'cubic-to-line' && preview.targetSegmentId
          ? applyCubicToLineApproximation(
              current.present,
              activeArtifact,
              preview.pieceId,
              preview.targetSegmentId,
              {
                toleranceCm: preview.toleranceCm,
                confirmApproximation: true
              }
            )
          : preview.targetVertexRef
            ? applyRemoveVertexAndMerge(
                current.present,
                activeArtifact,
                preview.pieceId,
                preview.targetVertexRef,
                {
                  toleranceCm: preview.toleranceCm,
                  confirmApproximation: true
                }
              )
            : null;

      if (!res || !res.ok) {
        setProposalActionNotice({
          kind: 'error',
          message: res ? res.message : 'Unable to apply pending approximate operation.'
        });
        return current;
      }
      applied = true;
      nextSegId = res.nextSelectedSegmentId;
      setProposalActionNotice({ kind: 'info', message: res.actionLabel });
      return commitProposalOperation(current, res.state, res.actionLabel, res.pieceId);
    });

    if (applied) {
      setPendingApproximatePreview(null);
      if (nextSegId) {
        setContourEditSelection({
          pieceId: preview.pieceId,
          kind: 'segment',
          segmentId: nextSegId
        });
      }
    }
    return applied;
  }, [activeArtifact, pendingApproximatePreview]);

  const cancelPendingApproximateOperation = useCallback(() => {
    setPendingApproximatePreview(null);
    setProposalActionNotice(null);
  }, []);

  const setProposalApproximationTolerance = useCallback(
    (toleranceCm: number) => {
      const safeVal =
        Number.isFinite(toleranceCm) && toleranceCm >= 0
          ? toleranceCm
          : DEFAULT_APPROXIMATION_TOLERANCE_CM;
      setProposalHistory(prev => (prev ? updateProposalTolerance(prev, safeVal) : prev));
      // Refresh any active approximate preview against the updated tolerance
      if (pendingApproximatePreview && activeArtifact && proposalState) {
        const refreshed =
          pendingApproximatePreview.operationKind === 'cubic-to-line' &&
          pendingApproximatePreview.targetSegmentId
            ? previewCubicToLineApproximation(
                proposalState,
                activeArtifact,
                pendingApproximatePreview.pieceId,
                pendingApproximatePreview.targetSegmentId,
                safeVal
              )
            : pendingApproximatePreview.targetVertexRef
              ? previewRemoveVertexAndMerge(
                  proposalState,
                  activeArtifact,
                  pendingApproximatePreview.pieceId,
                  pendingApproximatePreview.targetVertexRef,
                  safeVal
                )
              : null;
        if (refreshed && !('ok' in refreshed)) {
          setPendingApproximatePreview(refreshed);
        }
      }
    },
    [activeArtifact, pendingApproximatePreview, proposalState]
  );

  const undoProposal = useCallback(() => {
    setPendingApproximatePreview(null);
    setProposalHistory(prev => (prev ? undoProposalHistory(prev) : prev));
  }, []);

  const redoProposal = useCallback(() => {
    setPendingApproximatePreview(null);
    setProposalHistory(prev => (prev ? redoProposalHistory(prev) : prev));
  }, []);

  const discardPieceProposalEdits = useCallback((pieceId: string) => {
    setPendingApproximatePreview(null);
    setProposalHistory(prev => (prev ? discardPieceProposal(prev, pieceId) : prev));
    setProposalActionNotice({ kind: 'info', message: `Discarded proposal edits for piece ${pieceId}.` });
  }, []);

  const discardAllProposalEdits = useCallback(() => {
    if (!activeArtifact) return;
    setPendingApproximatePreview(null);
    setContourEditSelection(null);
    setCompareOriginalGeometry(false);
    setProposalHistory(prev =>
      discardAllProposal(
        activeArtifact,
        prev?.present.defaultApproximationToleranceCm ?? DEFAULT_APPROXIMATION_TOLERANCE_CM
      )
    );
    setProposalActionNotice({
      kind: 'info',
      message: 'Discarded all geometry proposal edits and realigned with source artifact.'
    });
  }, [activeArtifact]);

  const overlapAdvisories = useMemo<readonly BoardOverlapAdvisory[]>(() => {
    if (!activeArtifact || activeArtifact.pieces.length === 0) return [];
    return analyzeBoardOverlaps(boardHistory.present, activeArtifact);
  }, [boardHistory.present, activeArtifact]);

  // D3: Inspect and Measure operate on `inspectionTargetArtifact` (active proposed sew contour
  // when aligned edits exist, or original `activeArtifact` when comparing original).
  const inspectedEntity = useMemo<CadInspectableEntity | null>(() => {
    return reconcileInspectedEntityWithArtifact(
      rawInspectedEntity,
      inspectionTargetArtifact,
      boardHistory.present,
      layerVisibility
    );
  }, [rawInspectedEntity, inspectionTargetArtifact, boardHistory.present, layerVisibility]);

  const measurementSession = useMemo<MeasurementSession>(() => {
    return reconcileMeasurementSessionWithArtifact(
      rawMeasurementSession,
      inspectionTargetArtifact,
      boardHistory.present,
      layerVisibility
    );
  }, [rawMeasurementSession, inspectionTargetArtifact, boardHistory.present, layerVisibility]);

  const measurementEvaluation = useMemo<MeasurementEvaluation>(() => {
    return evaluateMeasurementSession(
      measurementSession,
      inspectionTargetArtifact,
      boardHistory.present
    );
  }, [measurementSession, inspectionTargetArtifact, boardHistory.present]);

  // Stage-1 Artifact-Level Diagnostic Resolution: strictly memoized on immutable `activeArtifact` ONLY (D3)
  // Spatial diagnostics NEVER silently migrate to proposal geometry.
  const resolvedDiagnostics = useMemo<ResolvedArtifactDiagnostics>(() => {
    return resolveArtifactDiagnostics(activeArtifact);
  }, [activeArtifact]);

  const diagnosticReconciliation = useMemo(
    () => reconcileDiagnosticSelection(rawSelectedDiagnosticKey, resolvedDiagnostics),
    [rawSelectedDiagnosticKey, resolvedDiagnostics]
  );

  const selectedDiagnosticKey = diagnosticReconciliation.selectedDiagnosticKey;
  const diagnosticReconciliationNotice =
    diagnosticReconciliation.wasClearedDueToStaleArtifact &&
    dismissedReconcileArtifactKey !== resolvedDiagnostics.artifactIdentityKey
      ? `Previous diagnostic selection (${diagnosticReconciliation.previousKey}) was cleared because the pattern artifact changed.`
      : null;

  const dismissDiagnosticReconciliationNotice = useCallback(() => {
    setDismissedReconcileArtifactKey(resolvedDiagnostics.artifactIdentityKey);
    setRawSelectedDiagnosticKey(null);
  }, [resolvedDiagnostics.artifactIdentityKey]);

  const value = useMemo<PatternAtelierViewContextValue>(
    () => ({
      setCamera,
      zoomByFactor,
      zoomToValue,
      panByScreenDelta,
      requestFitAll,
      fitRequestVersion,
      resetCameraTo100,
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
      setLayersDrawerOpen,
      hoveredEntity,
      setHoveredEntity,
      inspectedEntity,
      setInspectedEntity,
      clearInspectedEntity,
      showControlPolygon,
      setShowControlPolygon,
      measureSubMode,
      setMeasureSubMode,
      measurementHoverEntity,
      setMeasurementHoverEntity,
      measurementSession,
      measurementEvaluation,
      recordMeasurementEntityClick,
      swapMeasurementAnchors: handleSwapMeasurementAnchors,
      lockPendingVertexAngle,
      clearMeasurementSession,
      handleMeasurementToolTransition,
      resolvedDiagnostics,
      showDiagnosticsOverlay,
      setShowDiagnosticsOverlay,
      toggleDiagnosticsOverlay,
      diagnosticSeverityFilter,
      toggleDiagnosticSeverityFilter,
      selectedDiagnosticKey,
      hoveredDiagnosticKey,
      selectDiagnostic,
      setHoveredDiagnosticKey,
      clearDiagnosticSelection,
      diagnosticLocateRequest,
      locateDiagnosticOnCanvas,
      diagnosticReconciliationNotice,
      dismissDiagnosticReconciliationNotice,
      proposalHistory,
      proposalState,
      proposedArtifact,
      inspectionTargetArtifact,
      isInspectingProposal,
      compareOriginalGeometry,
      setCompareOriginalGeometry,
      toggleCompareOriginalGeometry,
      proposalIntegrity,
      contourEditSelection,
      setContourEditSelection,
      clearContourEditSelection,
      translateAdjacentHandles,
      setTranslateAdjacentHandles,
      activeContinuityMode,
      setActiveContinuityMode,
      pendingApproximatePreview,
      proposalActionNotice,
      clearProposalActionNotice,
      commitMoveContourVertex,
      commitMoveBezierHandle,
      commitSetVertexContinuity,
      commitAlignVertex,
      commitSplitSewSegment,
      commitElevateLineToCubic,
      requestCubicToLinePreview,
      requestRemoveVertexPreview,
      confirmPendingApproximateOperation,
      cancelPendingApproximateOperation,
      setProposalApproximationTolerance,
      undoProposal,
      redoProposal,
      canUndoProposal: proposalHistory ? canUndoProposal(proposalHistory) : false,
      canRedoProposal: proposalHistory ? canRedoProposal(proposalHistory) : false,
      lastProposalActionLabel: proposalHistory?.lastActionLabel ?? null,
      discardPieceProposalEdits,
      discardAllProposalEdits
    }),
    [
      setCamera,
      zoomByFactor,
      zoomToValue,
      panByScreenDelta,
      requestFitAll,
      fitRequestVersion,
      resetCameraTo100,
      setCursorCm,
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
      layersDrawerOpen,
      hoveredEntity,
      inspectedEntity,
      setInspectedEntity,
      clearInspectedEntity,
      showControlPolygon,
      measureSubMode,
      measurementHoverEntity,
      measurementSession,
      measurementEvaluation,
      recordMeasurementEntityClick,
      handleSwapMeasurementAnchors,
      lockPendingVertexAngle,
      clearMeasurementSession,
      handleMeasurementToolTransition,
      resolvedDiagnostics,
      showDiagnosticsOverlay,
      toggleDiagnosticsOverlay,
      diagnosticSeverityFilter,
      toggleDiagnosticSeverityFilter,
      selectedDiagnosticKey,
      hoveredDiagnosticKey,
      selectDiagnostic,
      clearDiagnosticSelection,
      diagnosticLocateRequest,
      locateDiagnosticOnCanvas,
      diagnosticReconciliationNotice,
      dismissDiagnosticReconciliationNotice,
      proposalHistory,
      proposalState,
      proposedArtifact,
      inspectionTargetArtifact,
      isInspectingProposal,
      compareOriginalGeometry,
      toggleCompareOriginalGeometry,
      proposalIntegrity,
      contourEditSelection,
      clearContourEditSelection,
      translateAdjacentHandles,
      activeContinuityMode,
      pendingApproximatePreview,
      proposalActionNotice,
      clearProposalActionNotice,
      commitMoveContourVertex,
      commitMoveBezierHandle,
      commitSetVertexContinuity,
      commitAlignVertex,
      commitSplitSewSegment,
      commitElevateLineToCubic,
      requestCubicToLinePreview,
      requestRemoveVertexPreview,
      confirmPendingApproximateOperation,
      cancelPendingApproximateOperation,
      setProposalApproximationTolerance,
      undoProposal,
      redoProposal,
      discardPieceProposalEdits,
      discardAllProposalEdits
    ]
  );

  return (
    <PatternAtelierViewContext.Provider value={value}>
      {children}
    </PatternAtelierViewContext.Provider>
  );
};

export const PatternAtelierViewProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => (
  <PatternAtelierCameraProvider>
    <PatternAtelierCursorProvider>
      <PatternAtelierViewStateProvider>{children}</PatternAtelierViewStateProvider>
    </PatternAtelierCursorProvider>
  </PatternAtelierCameraProvider>
);

export function useOptionalPatternAtelierCamera(): CadCamera | null {
  return useContext(PatternAtelierCameraContext);
}

export function useOptionalPatternAtelierCursor(): RenderPoint2D | null {
  return useContext(PatternAtelierCursorContext);
}

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
