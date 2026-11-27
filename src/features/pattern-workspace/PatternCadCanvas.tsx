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
import {
  PatternCadLayerVisibility,
  PatternCadViewMode,
  useOptionalPatternAtelierCamera,
  useOptionalPatternAtelierCursor,
  useOptionalPatternAtelierView
} from './PatternAtelierViewContext';
import { PatternDiagnosticsOverlay } from './PatternDiagnosticsOverlay';
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
import {
  EMPTY_MEASUREMENT_SESSION,
  MeasurementEvaluation,
  MeasurementSession,
  VertexAngleMeasurementResult
} from './precision-measurement';
import {
  BoardPieceOffsetVisibility,
  DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
  DiagnosticMarkerCluster,
  DiagnosticSeverityFilter,
  EMPTY_RESOLVED_DIAGNOSTICS,
  ProjectedDiagnosticItem,
  ResolvedArtifactDiagnostics,
  computeDiagnosticFocusBoundsCm,
  projectDiagnosticsForCanvas
} from './spatial-diagnostics';
import {
  ContourEditSelection,
  createProposalStateFromArtifact,
  DEFAULT_SNAP_CONSTRAINT_CONFIG,
  getEditableSewVerticesForPiece,
  HandleContinuityMode,
  moveBezierHandle,
  moveContourVertex,
  PatternGeometryProposalState,
  PendingApproximateOperationPreview,
  ProposalIntegrityReport,
  snapAndConstrainPoint
} from './geometry-edit-proposal';
import {
  ActiveContourDragPreview,
  ContourEditHoverTarget,
  hitTestContourEditTarget,
  PatternContourEditOverlay
} from './PatternContourEditOverlay';
import { PatternSeamWalkOverlay } from './PatternSeamWalkOverlay';
import {
  ActiveConstructionDrawPreview,
  PatternConstructionOverlay
} from './PatternConstructionOverlay';
import { PatternDartOverlay } from './PatternDartOverlay';
import { PatternAllowanceRuleOverlay } from './PatternAllowanceRuleOverlay';
import { evaluateUnifiedCadSnap } from './cad-snapping';
import { isProposalAuthoringTool, resolveUndoHistoryTargetForTool } from './tool-dispatch';
import {
  createConstructionCircle,
  createConstructionLine,
  createInternalLine,
  createReferenceAxis
} from './construction-geometry';
import { evaluateSegmentArcLengthCm } from './seam-correspondence';
import {
  WP_A_AUTHORITY_TIER,
  type UnifiedSnapResult
} from './contracts/wp-a-shared-contracts';

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
  readonly camera?: CadCamera;
  readonly onChangeCamera: (next: CadCamera) => void;
  readonly fitRequestVersion: number;
  readonly cursorCm?: RenderPoint2D | null;
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
  // UX-2.3.3.2 advisory precision drafting measurement props
  readonly measurementHoverEntity?: CadInspectableEntity | null;
  readonly measurementSession?: MeasurementSession;
  readonly measurementEvaluation?: MeasurementEvaluation;
  readonly onMeasurementHoverEntity?: (entity: CadInspectableEntity | null) => void;
  readonly onMeasureEntityClick?: (entity: CadInspectableEntity) => void;
  readonly onClearMeasurement?: () => void;
  // UX-2.3.3.3 spatial diagnostic mapping overlay props
  readonly resolvedDiagnostics?: ResolvedArtifactDiagnostics;
  readonly showDiagnosticsOverlay?: boolean;
  readonly diagnosticSeverityFilter?: DiagnosticSeverityFilter;
  readonly selectedDiagnosticKey?: string | null;
  readonly hoveredDiagnosticKey?: string | null;
  readonly diagnosticLocateRequest?: {
    readonly diagnosticKey: string;
    readonly version: number;
  } | null;
  readonly onSelectDiagnostic?: (diagnosticKey: string | null) => void;
  readonly onHoverDiagnostic?: (diagnosticKey: string | null) => void;
  // UX-2.3.3.4 proposal-based sew-contour editing props
  readonly inspectionTargetArtifact?: PatternArtifactBundle;
  readonly proposalState?: PatternGeometryProposalState | null;
  readonly proposalIntegrity?: ProposalIntegrityReport | null;
  readonly compareOriginalGeometry?: boolean;
  readonly contourEditSelection?: ContourEditSelection | null;
  readonly translateAdjacentHandles?: boolean;
  readonly activeContinuityMode?: HandleContinuityMode;
  readonly pendingApproximatePreview?: PendingApproximateOperationPreview | null;
  readonly onSelectContourEditTarget?: (selection: ContourEditSelection | null) => void;
  readonly onCommitMoveContourVertex?: (
    pieceId: string,
    vertexRef: string,
    nextLocalCm: RenderPoint2D
  ) => boolean;
  readonly onCommitMoveBezierHandle?: (
    pieceId: string,
    segmentId: string,
    handleSlot: 'p1' | 'p2',
    nextLocalCm: RenderPoint2D
  ) => boolean;
  readonly onCancelPendingApproximatePreview?: () => void;
  readonly onUndoProposal?: () => void;
  readonly onRedoProposal?: () => void;
}

const MeasurePendingPreviewLine: React.FC<{
  readonly ptA: RenderPoint2D;
  readonly hoverTarget: RenderPoint2D | null;
  readonly isMeasureMode: boolean;
  readonly fallbackCursorCm?: RenderPoint2D | null;
  readonly invScale: number;
  readonly isYUp: boolean;
  readonly strokeColor: string;
}> = React.memo(
  ({ ptA, hoverTarget, isMeasureMode, fallbackCursorCm, invScale, isYUp, strokeColor }) => {
    const contextCursorCm = useOptionalPatternAtelierCursor();
    const effectiveCursor = contextCursorCm ?? fallbackCursorCm ?? null;
    const previewTarget =
      isMeasureMode && hoverTarget
        ? hoverTarget
        : isMeasureMode && effectiveCursor
          ? effectiveCursor
          : null;
    if (!previewTarget) return null;
    const previewDist = Math.hypot(previewTarget.x - ptA.x, previewTarget.y - ptA.y);
    if (previewDist <= 1e-4) return null;
    const midX = (ptA.x + previewTarget.x) * 0.5;
    const midY = (ptA.y + previewTarget.y) * 0.5;
    const labelY = isYUp ? midY + 9 * invScale : midY - 9 * invScale;
    const upright = isYUp
      ? `translate(${midX}, ${labelY}) scale(1, -1)`
      : `translate(${midX}, ${labelY})`;

    return (
      <g data-testid="cad-measure-preview-line">
        <line
          x1={ptA.x}
          y1={ptA.y}
          x2={previewTarget.x}
          y2={previewTarget.y}
          stroke={strokeColor}
          strokeWidth={1.6 * invScale}
          strokeDasharray={`${5 * invScale} ${3 * invScale}`}
        />
        <g transform={upright}>
          <text
            x={0}
            y={0}
            textAnchor="middle"
            fontSize={Math.max(0.9, 10 * invScale)}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontWeight="700"
            fill={strokeColor}
            stroke="#ffffff"
            strokeWidth={3.0 * invScale}
            paintOrder="stroke"
          >
            {`${previewDist.toFixed(2)} cm`}
          </text>
        </g>
      </g>
    );
  }
);

MeasurePendingPreviewLine.displayName = 'MeasurePendingPreviewLine';

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
  camera: propCamera,
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
  onInspectEntity,
  measurementHoverEntity = null,
  measurementSession = EMPTY_MEASUREMENT_SESSION,
  measurementEvaluation = { kind: 'empty' },
  onMeasurementHoverEntity,
  onMeasureEntityClick,
  onClearMeasurement,
  resolvedDiagnostics = EMPTY_RESOLVED_DIAGNOSTICS,
  showDiagnosticsOverlay = true,
  diagnosticSeverityFilter = DEFAULT_DIAGNOSTIC_SEVERITY_FILTER,
  selectedDiagnosticKey = null,
  hoveredDiagnosticKey = null,
  diagnosticLocateRequest = null,
  onSelectDiagnostic,
  onHoverDiagnostic,
  inspectionTargetArtifact,
  proposalState = null,
  proposalIntegrity = null,
  compareOriginalGeometry = false,
  contourEditSelection = null,
  translateAdjacentHandles = true,
  activeContinuityMode = 'c0-corner',
  pendingApproximatePreview = null,
  onSelectContourEditTarget,
  onCommitMoveContourVertex,
  onCommitMoveBezierHandle,
  onCancelPendingApproximatePreview,
  onUndoProposal,
  onRedoProposal
}) => {
  const contextCamera = useOptionalPatternAtelierCamera();
  const atelierView = useOptionalPatternAtelierView();
  const camera: CadCamera = contextCamera ?? propCamera ?? { zoom: 1, panX: 48, panY: 48 };
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
  const [contourHoverTarget, setContourHoverTarget] = useState<ContourEditHoverTarget | null>(null);
  const [contourDragPreview, setContourDragPreview] = useState<ActiveContourDragPreview | null>(
    null
  );
  const [constructionDrawPreview, setConstructionDrawPreview] =
    useState<ActiveConstructionDrawPreview | null>(null);
  const [activeUnifiedSnap, setActiveUnifiedSnap] = useState<{
    readonly pieceId: string | null;
    readonly result: UnifiedSnapResult;
  } | null>(null);

  const effectiveInspectionArtifact = inspectionTargetArtifact ?? artifact;

  const fallbackBoardState = useMemo(() => createInitialBoardSnapshot(artifact, 8), [artifact]);
  const boardState = externalBoardState ?? fallbackBoardState;

  const cameraRef = useRef<CadCamera>(camera);
  cameraRef.current = camera;
  const boardStateRef = useRef<PatternBoardSnapshot>(boardState);
  boardStateRef.current = boardState;
  const artifactRef = useRef<PatternArtifactBundle>(artifact);
  artifactRef.current = artifact;
  const inspectionArtifactRef = useRef<PatternArtifactBundle>(effectiveInspectionArtifact);
  inspectionArtifactRef.current = effectiveInspectionArtifact;
  const proposalStateRef = useRef<PatternGeometryProposalState | null>(proposalState);
  proposalStateRef.current = proposalState;
  const contourSelectionRef = useRef<ContourEditSelection | null>(contourEditSelection);
  contourSelectionRef.current = contourEditSelection;
  const pendingApproxRef = useRef<PendingApproximateOperationPreview | null>(
    pendingApproximatePreview
  );
  pendingApproxRef.current = pendingApproximatePreview;
  const translateAdjacentHandlesRef = useRef<boolean>(translateAdjacentHandles);
  translateAdjacentHandlesRef.current = translateAdjacentHandles;
  const activeContinuityModeRef = useRef<HandleContinuityMode>(activeContinuityMode);
  activeContinuityModeRef.current = activeContinuityMode;
  const layerVisibilityRef = useRef<PatternCadLayerVisibility>(layerVisibility);
  layerVisibilityRef.current = layerVisibility;
  const hoveredEntityRef = useRef<CadInspectableEntity | null>(hoveredEntity);
  hoveredEntityRef.current = hoveredEntity;
  const inspectedEntityRef = useRef<CadInspectableEntity | null>(inspectedEntity);
  inspectedEntityRef.current = inspectedEntity;
  const measurementHoverRef = useRef<CadInspectableEntity | null>(measurementHoverEntity);
  measurementHoverRef.current = measurementHoverEntity;
  const measurementSessionRef = useRef<MeasurementSession>(measurementSession);
  measurementSessionRef.current = measurementSession;

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

  const contourDragSessionRef = useRef<{
    pointerId: number;
    pieceId: string;
    dragKind: 'vertex' | 'handle';
    vertexRef?: string;
    segmentId?: string;
    handleSlot?: 'p1' | 'p2';
    originLocalCm: RenderPoint2D;
    lastLocalCm: RenderPoint2D;
    startClientX: number;
    startClientY: number;
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

  const pieceSvgPathsById = useMemo(() => {
    const map = new Map<string, { readonly cutD: string; readonly sewD: string }>();
    for (const p of artifact.pieces) {
      map.set(p.pieceId, {
        cutD: segmentsToSvgPath(p.cutSegments, p.fallbackCutSvgPath),
        sewD: segmentsToSvgPath(p.sewSegments, p.fallbackSewSvgPath)
      });
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

      // Strict UX-2.3.3.2 interaction isolation: measure mode never mutates board layout
      if (activeTool === 'measure-preview') {
        if (e.key === 'Escape') {
          onClearMeasurement?.();
          onMeasurementHoverEntity?.(null);
        }
        return;
      }

      // UX-2.3.3.4 (D4) & WP-A6: All proposal authoring tools (A, W, L, N, D, S) route undo/redo
      // strictly to the unified geometry proposal history and never mutate board arrangement history.
      if (resolveUndoHistoryTargetForTool(activeTool) === 'proposal') {
        const modEdit = e.metaKey || e.ctrlKey;
        if (e.key === 'Escape') {
          e.preventDefault();
          if (constructionDrawPreview) {
            setConstructionDrawPreview(null);
            setActiveUnifiedSnap(null);
          } else if (contourDragSessionRef.current) {
            contourDragSessionRef.current = null;
            setContourDragPreview(null);
          } else if (pendingApproxRef.current) {
            onCancelPendingApproximatePreview?.();
          } else {
            onSelectContourEditTarget?.(null);
          }
          return;
        }
        if (modEdit && e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault();
          onUndoProposal?.();
          return;
        }
        if (
          (modEdit && e.key.toLowerCase() === 'z' && e.shiftKey) ||
          (modEdit && e.key.toLowerCase() === 'y')
        ) {
          e.preventDefault();
          onRedoProposal?.();
          return;
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') {
        if (measurementSessionRef.current.mode !== 'idle') {
          onClearMeasurement?.();
        }
        onSelectDiagnostic?.(null);
        onHoverDiagnostic?.(null);
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
    onHoverEntity,
    onClearMeasurement,
    onMeasurementHoverEntity,
    onSelectDiagnostic,
    onHoverDiagnostic,
    onCancelPendingApproximatePreview,
    onSelectContourEditTarget,
    onUndoProposal,
    onRedoProposal
  ]);

  // Fit All when explicitly requested, garment changes, mode changes, or initial size measured
  const lastFitSigRef = useRef<string>('');
  useEffect(() => {
    if (!activeBoundsCm || viewportSize.width < 120 || viewportSize.height < 120) return;
    const sig = `${fitRequestVersion}::${layoutResetKey}::${effectiveViewMode}::${projection.yAxisDirection}`;
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

  // UX-2.3.3.3: Locate diagnostic on canvas (camera-only focus; never touches boardHistory)
  const lastLocatedVersionRef = useRef<number>(0);
  useEffect(() => {
    if (
      !diagnosticLocateRequest ||
      diagnosticLocateRequest.version === lastLocatedVersionRef.current ||
      viewportSize.width < 120 ||
      viewportSize.height < 120
    ) {
      return;
    }
    const target = resolvedDiagnostics.byKey.get(diagnosticLocateRequest.diagnosticKey);
    if (!target || !target.isMapped) return;
    lastLocatedVersionRef.current = diagnosticLocateRequest.version;

    const pl = target.pieceId ? boardStateRef.current.placementsByPieceId[target.pieceId] : undefined;
    const offset = { offsetXCm: pl?.offsetXCm ?? 0, offsetYCm: pl?.offsetYCm ?? 0 };
    const focusBounds = computeDiagnosticFocusBoundsCm(target, {
      x: offset.offsetXCm,
      y: offset.offsetYCm
    });
    if (!focusBounds) return;

    const fitCam = computeFitCameraCm(
      focusBounds,
      viewportSize.width,
      viewportSize.height,
      projection,
      80
    );
    const boundedZoom = clampCadZoom(Math.min(3.2, Math.max(1.0, fitCam.zoom)));
    const centerWorldX = (focusBounds.minX + focusBounds.maxX) / 2;
    const centerWorldY = (focusBounds.minY + focusBounds.maxY) / 2;
    const scale = getPixelsPerCm(boundedZoom, BASE_PX_PER_CM);
    const ySign = projection.yAxisDirection === 'cartesian-y-up' ? -1 : 1;

    onChangeCamera({
      zoom: boundedZoom,
      panX: viewportSize.width / 2 - centerWorldX * scale,
      panY: viewportSize.height / 2 - centerWorldY * ySign * scale
    });
  }, [
    diagnosticLocateRequest,
    resolvedDiagnostics,
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

      // 1b. UX-2.3.3.1 Read-only geometric entity inspection mode (D3: targets proposed sew contour when aligned)
      if (activeTool === 'inspect-entity') {
        e.preventDefault();
        const hitRadiusPx =
          e.pointerType === 'touch' ? TOUCH_HIT_RADIUS_PX : DEFAULT_HIT_RADIUS_PX;
        const hitRes = hitTestPatternEntities(
          localPx,
          cameraRef.current,
          projection,
          inspectionArtifactRef.current,
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

      // 1c. UX-2.3.3.2 Advisory Precision Measurement mode (D3: targets proposed sew contour when aligned)
      if (activeTool === 'measure-preview') {
        e.preventDefault();
        const hitRadiusPx =
          e.pointerType === 'touch' ? TOUCH_HIT_RADIUS_PX : DEFAULT_HIT_RADIUS_PX;
        const hitRes = hitTestPatternEntities(
          localPx,
          cameraRef.current,
          projection,
          inspectionArtifactRef.current,
          boardStateRef.current,
          layerVisibilityRef.current,
          {
            hitRadiusPx,
            activeCurve: null
          }
        );
        if (hitRes.hit?.entity) {
          onMeasureEntityClick?.(hitRes.hit.entity);
        }
        return;
      }

      // 1d. UX-2.3.3.4 Proposal-Based Precision Sew-Contour Editing mode (strictly sew-only, isolated from board drag)
      if (activeTool === 'edit-contour') {
        e.preventDefault();
        const hitRadiusPx =
          e.pointerType === 'touch' ? TOUCH_HIT_RADIUS_PX + 2 : DEFAULT_HIT_RADIUS_PX + 2;
        const pxPerCm = getPixelsPerCm(cameraRef.current.zoom, BASE_PX_PER_CM);
        const hitRadiusCm = hitRadiusPx / Math.max(0.5, pxPerCm);

        const visibleNow: PatternPieceRenderModel[] = [];
        for (const pid of boardStateRef.current.layerOrder) {
          if (!isPieceEffectivelyVisible(boardStateRef.current, pid)) continue;
          const piece = artifactRef.current.pieces.find(p => p.pieceId === pid);
          if (piece) visibleNow.push(piece);
        }
        const getOffNow = (pid: string) => {
          const pl = boardStateRef.current.placementsByPieceId[pid];
          return { offsetXCm: pl?.offsetXCm ?? 0, offsetYCm: pl?.offsetYCm ?? 0 };
        };

        const hit = hitTestContourEditTarget(
          worldPt,
          visibleNow,
          proposalStateRef.current,
          getOffNow,
          contourSelectionRef.current,
          hitRadiusCm
        );

        if (!hit) {
          onSelectContourEditTarget?.(null);
          return;
        }

        onSelectPieceId(hit.pieceId);
        onSelectContourEditTarget?.({
          pieceId: hit.pieceId,
          kind: hit.kind,
          vertexRef: hit.vertexRef,
          segmentId: hit.segmentId,
          handleSlot: hit.handleSlot
        });

        const isAlignedNow =
          !proposalStateRef.current || proposalStateRef.current.reconciliationStatus === 'aligned';
        if (isAlignedNow && (hit.kind === 'vertex' || hit.kind === 'handle')) {
          contourDragSessionRef.current = {
            pointerId: e.pointerId,
            pieceId: hit.pieceId,
            dragKind: hit.kind,
            vertexRef: hit.vertexRef,
            segmentId: hit.segmentId,
            handleSlot: hit.handleSlot,
            originLocalCm: hit.localPointCm,
            lastLocalCm: hit.localPointCm,
            startClientX: e.clientX,
            startClientY: e.clientY,
            moved: false
          };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Safe no-op
          }
        }
        return;
      }

      // 1d-wpA. WP-A6 Unified Engineering Tool Pointer Dispatch (construction-draw, notch-drill, allowance-rule, seam-walk, dart-author)
      if (
        effectiveViewMode === 'pieces' &&
        activeTool !== 'edit-contour' &&
        isProposalAuthoringTool(activeTool) &&
        atelierView
      ) {
        e.preventDefault();
        const pxPerCm = getPixelsPerCm(cameraRef.current.zoom, BASE_PX_PER_CM);
        const targetArt = inspectionArtifactRef.current;
        const activePieceId = selectedPieceId ?? targetArt.pieces[0]?.pieceId ?? null;
        const activePiece = targetArt.pieces.find(p => p.pieceId === activePieceId) ?? targetArt.pieces[0] ?? null;
        const pl = activePiece ? boardStateRef.current.placementsByPieceId[activePiece.pieceId] : undefined;
        const offX = pl?.offsetXCm ?? 0;
        const offY = pl?.offsetYCm ?? 0;
        const rawLocalCm = { x: worldPt.x - offX, y: worldPt.y - offY };

        if (activeTool === 'construction-draw' && activePiece) {
          const snapRes = evaluateUnifiedCadSnap(rawLocalCm, {
            sewSegments: activePiece.sewSegments,
            constructions: Object.values(atelierView.wpAState?.constructions ?? {}),
            coordinateFrame: targetArt.coordinateFrame,
            pixelsPerCm: pxPerCm,
            referenceAnchorCm: constructionDrawPreview?.startLocalCm ?? null,
            constrainAxis: e.shiftKey,
            config: atelierView.unifiedSnapConfig
          });
          if (!constructionDrawPreview) {
            setConstructionDrawPreview({
              kind: atelierView.constructionDrawSubMode,
              pieceId: activePiece.pieceId,
              startLocalCm: snapRes.pointCm,
              currentLocalCm: snapRes.pointCm
            });
          } else {
            const start = constructionDrawPreview.startLocalCm;
            const end = snapRes.pointCm;
            const seq = atelierView.nextParametricOpSequence();
            const id = `const::canvas::${seq}`;
            const built =
              constructionDrawPreview.kind === 'construction-circle'
                ? createConstructionCircle({
                    id,
                    pieceId: activePiece.pieceId,
                    center: start,
                    radiusCm: Math.hypot(end.x - start.x, end.y - start.y)
                  })
                : constructionDrawPreview.kind === 'reference-axis'
                  ? createReferenceAxis({
                      id,
                      pieceId: activePiece.pieceId,
                      axisRole: 'custom',
                      start,
                      end
                    })
                  : constructionDrawPreview.kind === 'internal-line'
                    ? createInternalLine({
                        id,
                        pieceId: activePiece.pieceId,
                        role: 'stitch-guide',
                        start,
                        end
                      })
                    : createConstructionLine({
                        id,
                        pieceId: activePiece.pieceId,
                        start,
                        end
                      });
            if (built.ok) {
              atelierView.dispatchParametricOp({
                opId: `op::const::${seq}`,
                sequence: seq,
                domain: 'construction',
                kind: 'upsert-construction',
                label: `Add ${built.entity.label}`,
                pieceId: activePiece.pieceId,
                dependsOnIds: [],
                enabled: true,
                provenance: {
                  createdSequence: seq,
                  sourceTool: 'construction-draw',
                  authorityTier: WP_A_AUTHORITY_TIER
                },
                params: { entity: built.entity }
              });
            }
            setConstructionDrawPreview(null);
            setActiveUnifiedSnap(null);
          }
          return;
        }

        if (activeTool === 'notch-drill' && activePiece) {
          const seq = atelierView.nextParametricOpSequence();
          if (atelierView.notchDrillSubMode === 'drill') {
            atelierView.dispatchParametricOp({
              opId: `op::drill::${seq}`,
              sequence: seq,
              domain: 'notch-drill',
              kind: 'upsert-drill',
              label: `Place Drill (${activePiece.pieceCode})`,
              pieceId: activePiece.pieceId,
              dependsOnIds: [],
              enabled: true,
              provenance: {
                createdSequence: seq,
                sourceTool: 'notch-drill',
                authorityTier: WP_A_AUTHORITY_TIER
              },
              params: {
                drillId: `drill::canvas::${seq}`,
                positionCm: rawLocalCm,
                radiusCm: 0.25,
                label: `D${seq}`
              }
            });
            return;
          }
          // Notch mode: hit-test nearest sew edge via hitTestPatternEntities
          const hitRes = hitTestPatternEntities(
            localPx,
            cameraRef.current,
            projection,
            targetArt,
            boardStateRef.current,
            layerVisibilityRef.current,
            { hitRadiusPx: DEFAULT_HIT_RADIUS_PX + 6, activeCurve: null }
          );
          const ent = hitRes.hit?.entity;
          if (ent && (ent.entityKind === 'edge' || ent.entityKind === 'curve') && ent.contour === 'sew') {
            const hitPiece = targetArt.pieces.find(p => p.pieceId === ent.pieceId);
            const seg = hitPiece?.sewSegments.find(s => s.id === ent.segmentId);
            if (hitPiece && seg) {
              const tParam = ent.parameterT;
              const arcRes = evaluateSegmentArcLengthCm(seg, targetArt.coordinateFrame, hitPiece.pieceId, [0, tParam]);
              atelierView.dispatchParametricOp({
                opId: `op::notch::${seq}`,
                sequence: seq,
                domain: 'notch-drill',
                kind: 'upsert-notch',
                label: `Place Notch on ${seg.id}`,
                pieceId: hitPiece.pieceId,
                dependsOnIds: [`seg:${seg.id}`],
                enabled: true,
                provenance: {
                  createdSequence: seq,
                  sourceTool: 'notch-drill',
                  authorityTier: WP_A_AUTHORITY_TIER
                },
                params: {
                  notchId: `notch::canvas::${seq}`,
                  segmentId: seg.id,
                  targetArcLengthCm: arcRes.ok ? arcRes.lengthCm : 3.0,
                  notchType: atelierView.activeNotchType,
                  label: `N${seq}`
                }
              });
              onSelectPieceId(hitPiece.pieceId);
            }
          }
          return;
        }

        if (activeTool === 'allowance-rule' || activeTool === 'seam-walk' || activeTool === 'dart-author') {
          const hitRes = hitTestPatternEntities(
            localPx,
            cameraRef.current,
            projection,
            targetArt,
            boardStateRef.current,
            layerVisibilityRef.current,
            { hitRadiusPx: DEFAULT_HIT_RADIUS_PX + 6, activeCurve: null }
          );
          const ent = hitRes.hit?.entity;
          if (ent) {
            onSelectPieceId(ent.pieceId);
            if (activeTool === 'allowance-rule' && (ent.entityKind === 'edge' || ent.entityKind === 'curve')) {
              atelierView.setSelectedAllowanceSegmentId(ent.segmentId);
            }
          }
          return;
        }
      }

      // 1e. UX-2.3.3.3: Clicking a diagnostic marker/cluster in Select mode focuses it without dragging pieces
      if (activeTool === 'select' && target?.closest?.('[data-cad-diagnostic-marker]')) {
        e.preventDefault();
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
      onInspectEntity,
      onMeasureEntityClick,
      onSelectContourEditTarget
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

      // UX-2.3.3.1: Hover entity hit-testing in inspection mode (D3: targets proposed sew contour when aligned)
      if (effectiveViewMode === 'pieces' && activeTool === 'inspect-entity') {
        const hitRadiusPx =
          e.pointerType === 'touch' ? TOUCH_HIT_RADIUS_PX : DEFAULT_HIT_RADIUS_PX;
        const hitRes = hitTestPatternEntities(
          localPx,
          cameraRef.current,
          projection,
          inspectionArtifactRef.current,
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

      // UX-2.3.3.2: Hover entity hit-testing in measurement mode (D3: targets proposed sew contour when aligned)
      if (effectiveViewMode === 'pieces' && activeTool === 'measure-preview') {
        const hitRadiusPx =
          e.pointerType === 'touch' ? TOUCH_HIT_RADIUS_PX : DEFAULT_HIT_RADIUS_PX;
        const hitRes = hitTestPatternEntities(
          localPx,
          cameraRef.current,
          projection,
          inspectionArtifactRef.current,
          boardStateRef.current,
          layerVisibilityRef.current,
          {
            hitRadiusPx,
            activeCurve: null
          }
        );
        const nextEntity = hitRes.hit?.entity ?? null;
        const prevEntity = measurementHoverRef.current;
        const unchanged =
          prevEntity === null && nextEntity === null
            ? true
            : prevEntity !== null &&
                nextEntity !== null &&
                prevEntity.presentationRef === nextEntity.presentationRef &&
                Math.abs(prevEntity.localPointCm.x - nextEntity.localPointCm.x) < 1e-3 &&
                Math.abs(prevEntity.localPointCm.y - nextEntity.localPointCm.y) < 1e-3;
        if (!unchanged) {
          onMeasurementHoverEntity?.(nextEntity);
        }
        return;
      }

      // WP-A2: Live unified snap & 2-click construction draw preview
      if (effectiveViewMode === 'pieces' && activeTool === 'construction-draw' && atelierView) {
        const pxPerCm = getPixelsPerCm(cameraRef.current.zoom, BASE_PX_PER_CM);
        const targetArt = inspectionArtifactRef.current;
        const activePieceId = selectedPieceId ?? targetArt.pieces[0]?.pieceId ?? null;
        const activePiece = targetArt.pieces.find(p => p.pieceId === activePieceId) ?? targetArt.pieces[0] ?? null;
        if (activePiece) {
          const pl = boardStateRef.current.placementsByPieceId[activePiece.pieceId];
          const rawLocalCm = {
            x: worldPt.x - (pl?.offsetXCm ?? 0),
            y: worldPt.y - (pl?.offsetYCm ?? 0)
          };
          const snapRes = evaluateUnifiedCadSnap(rawLocalCm, {
            sewSegments: activePiece.sewSegments,
            constructions: Object.values(atelierView.wpAState?.constructions ?? {}),
            coordinateFrame: targetArt.coordinateFrame,
            pixelsPerCm: pxPerCm,
            referenceAnchorCm: constructionDrawPreview?.startLocalCm ?? null,
            constrainAxis: e.shiftKey,
            config: atelierView.unifiedSnapConfig
          });
          setActiveUnifiedSnap({ pieceId: activePiece.pieceId, result: snapRes });
          if (constructionDrawPreview) {
            setConstructionDrawPreview(prev =>
              prev ? { ...prev, currentLocalCm: snapRes.pointCm } : null
            );
          }
        }
        return;
      }

      // UX-2.3.3.4: Contour edit live drag preview & hover hit-testing (no history commits during drag)
      if (effectiveViewMode === 'pieces' && activeTool === 'edit-contour') {
        const contourDrag = contourDragSessionRef.current;
        if (contourDrag && contourDrag.pointerId === e.pointerId) {
          const screenDist = Math.hypot(
            e.clientX - contourDrag.startClientX,
            e.clientY - contourDrag.startClientY
          );
          if (!contourDrag.moved && screenDist < 2.5) return;
          contourDrag.moved = true;

          const pl = boardStateRef.current.placementsByPieceId[contourDrag.pieceId];
          const offX = pl?.offsetXCm ?? 0;
          const offY = pl?.offsetYCm ?? 0;
          const rawLocalCm = { x: worldPt.x - offX, y: worldPt.y - offY };

          const baseProposal =
            proposalStateRef.current ?? createProposalStateFromArtifact(artifactRef.current);
          const srcPiece = artifactRef.current.pieces.find(p => p.pieceId === contourDrag.pieceId);
          const currentSewSegs =
            baseProposal.pieceProposals[contourDrag.pieceId]?.sewSegments ??
            srcPiece?.sewSegments ??
            [];
          const candidateVerts = getEditableSewVerticesForPiece(contourDrag.pieceId, currentSewSegs)
            .filter(v => v.entityRef !== contourDrag.vertexRef)
            .map(v => v.localPointCm);

          const snapRes = snapAndConstrainPoint(
            rawLocalCm,
            contourDrag.originLocalCm,
            artifactRef.current.coordinateFrame,
            {
              ...DEFAULT_SNAP_CONSTRAINT_CONFIG,
              gridSnapEnabled: snapConfig.enabled,
              gridStepCm: snapConfig.gridIntervalCm,
              vertexSnapEnabled: snapConfig.enabled
            },
            { shiftKey: e.shiftKey, altKey: e.altKey },
            candidateVerts
          );

          contourDrag.lastLocalCm = snapRes.pointCm;
          const previewRes =
            contourDrag.dragKind === 'vertex' && contourDrag.vertexRef
              ? moveContourVertex(
                  baseProposal,
                  artifactRef.current,
                  contourDrag.pieceId,
                  contourDrag.vertexRef,
                  snapRes.pointCm,
                  { translateAdjacentHandles: translateAdjacentHandlesRef.current }
                )
              : contourDrag.segmentId && contourDrag.handleSlot
                ? moveBezierHandle(
                    baseProposal,
                    artifactRef.current,
                    contourDrag.pieceId,
                    contourDrag.segmentId,
                    contourDrag.handleSlot,
                    snapRes.pointCm,
                    { continuityMode: activeContinuityModeRef.current }
                  )
                : null;

          const previewSegs =
            previewRes && previewRes.ok
              ? previewRes.state.pieceProposals[contourDrag.pieceId]?.sewSegments ?? currentSewSegs
              : currentSewSegs;

          setContourDragPreview({
            pieceId: contourDrag.pieceId,
            dragKind: contourDrag.dragKind,
            vertexRef: contourDrag.vertexRef,
            segmentId: contourDrag.segmentId,
            handleSlot: contourDrag.handleSlot,
            originLocalCm: contourDrag.originLocalCm,
            currentLocalCm: snapRes.pointCm,
            snapResult: snapRes,
            previewSewSegments: previewSegs
          });
          return;
        }

        // Hover hit-test for edit-contour
        const hitRadiusPx =
          e.pointerType === 'touch' ? TOUCH_HIT_RADIUS_PX + 2 : DEFAULT_HIT_RADIUS_PX + 2;
        const pxPerCm = getPixelsPerCm(cameraRef.current.zoom, BASE_PX_PER_CM);
        const hitRadiusCm = hitRadiusPx / Math.max(0.5, pxPerCm);
        const visibleNow: PatternPieceRenderModel[] = [];
        for (const pid of boardStateRef.current.layerOrder) {
          if (!isPieceEffectivelyVisible(boardStateRef.current, pid)) continue;
          const piece = artifactRef.current.pieces.find(p => p.pieceId === pid);
          if (piece) visibleNow.push(piece);
        }
        const getOffNow = (pid: string) => {
          const pl = boardStateRef.current.placementsByPieceId[pid];
          return { offsetXCm: pl?.offsetXCm ?? 0, offsetYCm: pl?.offsetYCm ?? 0 };
        };
        const hit = hitTestContourEditTarget(
          worldPt,
          visibleNow,
          proposalStateRef.current,
          getOffNow,
          contourSelectionRef.current,
          hitRadiusCm
        );
        setContourHoverTarget(prev => {
          if (!prev && !hit) return prev;
          if (
            prev &&
            hit &&
            prev.pieceId === hit.pieceId &&
            prev.kind === hit.kind &&
            prev.vertexRef === hit.vertexRef &&
            prev.segmentId === hit.segmentId &&
            prev.handleSlot === hit.handleSlot
          ) {
            return prev;
          }
          return hit;
        });
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
      onMeasurementHoverEntity,
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

      if (
        contourDragSessionRef.current &&
        contourDragSessionRef.current.pointerId === e.pointerId
      ) {
        const finished = contourDragSessionRef.current;
        contourDragSessionRef.current = null;
        setContourDragPreview(null);
        if (finished.moved && e.type !== 'pointercancel') {
          if (finished.dragKind === 'vertex' && finished.vertexRef) {
            onCommitMoveContourVertex?.(
              finished.pieceId,
              finished.vertexRef,
              finished.lastLocalCm
            );
          } else if (
            finished.dragKind === 'handle' &&
            finished.segmentId &&
            finished.handleSlot
          ) {
            onCommitMoveBezierHandle?.(
              finished.pieceId,
              finished.segmentId,
              finished.handleSlot,
              finished.lastLocalCm
            );
          }
        }
      }

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Safe no-op
      }
    },
    [
      onCommitMovePieces,
      onSetActiveSnapGuides,
      onSelectMarqueeRect,
      onClearBoardSelection,
      onCommitMoveContourVertex,
      onCommitMoveBezierHandle
    ]
  );

  const handlePointerLeave = useCallback(() => {
    if (
      !panSessionRef.current &&
      !dragSessionRef.current &&
      !marqueeSessionRef.current &&
      !contourDragSessionRef.current
    ) {
      onChangeCursorCm(null);
      onHoverEntity?.(null);
      onMeasurementHoverEntity?.(null);
      setContourHoverTarget(null);
    }
  }, [onChangeCursorCm, onHoverEntity, onMeasurementHoverEntity]);

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
  const isMeasureMode = effectiveViewMode === 'pieces' && activeTool === 'measure-preview';
  const isEditContourMode = effectiveViewMode === 'pieces' && activeTool === 'edit-contour';

  const panCursorClass = isPanning
    ? 'cursor-grabbing'
    : dragPreview || contourDragPreview
      ? 'cursor-move'
      : activeTool === 'pan' || spacePressed
        ? 'cursor-grab'
        : isInspectMode || isMeasureMode || isEditContourMode
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
    const cachedPaths = pieceSvgPathsById.get(piece.pieceId);
    const cutD = cachedPaths?.cutD ?? segmentsToSvgPath(piece.cutSegments, piece.fallbackCutSvgPath);
    const sewD = cachedPaths?.sewD ?? segmentsToSvgPath(piece.sewSegments, piece.fallbackSewSvgPath);

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
          (isInspectMode || isMeasureMode) && !spacePressed
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

        {/* Exterior Cut Line (D2: strictly read-only original cut contour; styled distinctly when sew proposal makes it potentially stale) */}
        {layerVisibility.showSeamAllowance && cutD && (() => {
          const isCutStale = Boolean(
            proposalState?.reconciliationStatus === 'aligned' &&
              proposalState.pieceProposals[piece.pieceId]?.modifiedFromOriginal
          );
          return (
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
              stroke={
                piece.hasBlockingError
                  ? '#dc2626'
                  : isCutStale
                    ? '#b45309'
                    : isSelected
                      ? '#0f172a'
                      : '#52525b'
              }
              strokeOpacity={isCutStale ? 0.6 : 1}
              strokeWidth={
                piece.hasBlockingError ? 2.1 * invScale : isSelected ? 1.8 * invScale : cutStrokeCm
              }
              strokeDasharray={
                piece.hasBlockingError
                  ? `${5 * invScale} ${2.5 * invScale}`
                  : isCutStale
                    ? `${6 * invScale} ${3 * invScale}`
                    : undefined
              }
              strokeLinejoin="round"
            />
          );
        })()}

        {/* Interior Stitch Line (muted when replaced on-canvas by active proposed sew contour overlay) */}
        {layerVisibility.showSewLines && sewD && !(
          proposalState?.reconciliationStatus === 'aligned' &&
          proposalState.pieceProposals[piece.pieceId]?.modifiedFromOriginal
        ) && (
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

  // Subtle inspectable/measurable vertex hints rendered while inspect or measure mode is active (D3: uses effectiveInspectionArtifact)
  const inspectPiecesById = useMemo(
    () => new Map(effectiveInspectionArtifact.pieces.map(p => [p.pieceId, p])),
    [effectiveInspectionArtifact.pieces]
  );

  const inspectVertexHints = useMemo(() => {
    if (!isInspectMode && !isMeasureMode) return [];
    const hints: { key: string; x: number; y: number }[] = [];
    for (const origPiece of orderedVisiblePieces) {
      const piece = inspectPiecesById.get(origPiece.pieceId) ?? origPiece;
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
  }, [
    isInspectMode,
    isMeasureMode,
    orderedVisiblePieces,
    inspectPiecesById,
    layerVisibility.showSewLines,
    layerVisibility.showSeamAllowance,
    boardState,
    dragPreview
  ]);

  // Resolve active Bézier segment for optional control-polygon overlay (D3: uses inspectPiecesById)
  const activeControlPolygonSpec = useMemo(() => {
    if (!showControlPolygon || !inspectedEntity) return null;
    if (inspectedEntity.entityKind !== 'curve' && inspectedEntity.entityKind !== 'bezier-handle') {
      return null;
    }
    const piece = inspectPiecesById.get(inspectedEntity.pieceId);
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
  }, [showControlPolygon, inspectedEntity, inspectPiecesById, boardState, dragPreview]);

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

  // UX-2.3.3.2: Precision Drafting Measurement Overlays (amber/brass palette, reactive to live drags)
  const renderMeasurementOverlay = () => {
    const hasActiveMeasurement =
      measurementSession.mode !== 'idle' && measurementEvaluation.kind !== 'empty';
    if (!isMeasureMode && !hasActiveMeasurement && !measurementHoverEntity) {
      return null;
    }

    const MEASURE_PRIMARY = '#b45309'; // warm drafting brass/amber (distinct from teal Inspect & blue Select)
    const MEASURE_ACCENT = '#d97706';
    const MEASURE_PREVIEW = '#92400e';

    const resolveLivePoint = (entity: CadInspectableEntity): RenderPoint2D => {
      const off = getEffectiveOffset(entity.pieceId);
      return {
        x: entity.localPointCm.x + off.offsetXCm,
        y: entity.localPointCm.y + off.offsetYCm
      };
    };

    const uprightTransform = (x: number, y: number) =>
      isYUp ? `translate(${x}, ${y}) scale(1, -1)` : `translate(${x}, ${y})`;

    const renderAnchorBadge = (pt: RenderPoint2D, badge: 'A' | 'B', testId: string) => {
      const r = 6.5 * invScale;
      return (
        <g key={testId} data-testid={testId}>
          <circle
            cx={pt.x}
            cy={pt.y}
            r={r}
            fill="#ffffff"
            stroke={MEASURE_PRIMARY}
            strokeWidth={2.0 * invScale}
          />
          <circle cx={pt.x} cy={pt.y} r={2.3 * invScale} fill={MEASURE_PRIMARY} />
          <g
            transform={uprightTransform(
              pt.x + 8.5 * invScale,
              isYUp ? pt.y + 7 * invScale : pt.y - 7 * invScale
            )}
          >
            <rect
              x={-2.5 * invScale}
              y={-9.5 * invScale}
              width={12 * invScale}
              height={12 * invScale}
              rx={2 * invScale}
              fill={MEASURE_PRIMARY}
            />
            <text
              x={3.5 * invScale}
              y={-0.5 * invScale}
              textAnchor="middle"
              fontSize={Math.max(0.85, 8.8 * invScale)}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight="700"
              fill="#ffffff"
            >
              {badge}
            </text>
          </g>
        </g>
      );
    };

    const renderCalloutText = (
      x: number,
      y: number,
      text: string,
      color = MEASURE_PRIMARY,
      anchor: 'middle' | 'start' = 'middle'
    ) => (
      <g transform={uprightTransform(x, y)}>
        <text
          x={0}
          y={0}
          textAnchor={anchor}
          fontSize={Math.max(0.9, 10 * invScale)}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontWeight="700"
          fill={color}
          stroke="#ffffff"
          strokeWidth={3.0 * invScale}
          paintOrder="stroke"
        >
          {text}
        </text>
      </g>
    );

    const renderVertexAngleArc = (
      vertexPt: RenderPoint2D,
      angleRes: VertexAngleMeasurementResult,
      testId: string,
      isPreview = false
    ) => {
      if (!angleRes.incomingUnitTangent || !angleRes.outgoingUnitTangent) {
        return (
          <g data-testid={testId}>
            <circle
              cx={vertexPt.x}
              cy={vertexPt.y}
              r={6 * invScale}
              fill="#fef3c7"
              stroke={MEASURE_PRIMARY}
              strokeWidth={1.8 * invScale}
            />
          </g>
        );
      }

      const ux = -angleRes.incomingUnitTangent.x;
      const uy = -angleRes.incomingUnitTangent.y;
      const vx = angleRes.outgoingUnitTangent.x;
      const vy = angleRes.outgoingUnitTangent.y;

      const rayLen = 28 * invScale;
      const arcR = 16 * invScale;

      const inEnd = { x: vertexPt.x + ux * rayLen, y: vertexPt.y + uy * rayLen };
      const outEnd = { x: vertexPt.x + vx * rayLen, y: vertexPt.y + vy * rayLen };

      const arcStart = { x: vertexPt.x + vx * arcR, y: vertexPt.y + vy * arcR };
      const arcEnd = { x: vertexPt.x + ux * arcR, y: vertexPt.y + uy * arcR };

      const useInterior =
        angleRes.interiorExteriorStatus === 'determined' &&
        angleRes.interiorAngleDeg !== null &&
        angleRes.contourOrientation.orientationSign !== null;

      let sweepFlag: 0 | 1;
      let largeArcFlag: 0 | 1;
      let displayDeg: number;
      let bisectorAngleRad: number;

      const thetaV = Math.atan2(vy, vx);
      if (useInterior) {
        const sign = angleRes.contourOrientation.orientationSign!;
        displayDeg = angleRes.interiorAngleDeg!;
        sweepFlag = sign > 0 ? 1 : 0;
        largeArcFlag = displayDeg > 180 ? 1 : 0;
        bisectorAngleRad = thetaV + sign * ((displayDeg * Math.PI) / 360);
      } else {
        displayDeg = angleRes.includedAngleDeg ?? 0;
        const crossVU = vx * uy - vy * ux;
        const sign = crossVU >= 0 ? 1 : -1;
        sweepFlag = sign > 0 ? 1 : 0;
        largeArcFlag = 0;
        bisectorAngleRad = thetaV + sign * ((displayDeg * Math.PI) / 360);
      }

      const canDrawArc = displayDeg > 0.5 && displayDeg < 359.5;
      const arcPath = canDrawArc
        ? `M ${arcStart.x} ${arcStart.y} A ${arcR} ${arcR} 0 ${largeArcFlag} ${sweepFlag} ${arcEnd.x} ${arcEnd.y}`
        : null;

      const labelDist = 25 * invScale;
      const lx = vertexPt.x + Math.cos(bisectorAngleRad) * labelDist;
      const ly = vertexPt.y + Math.sin(bisectorAngleRad) * labelDist;
      const tag = useInterior ? 'INT' : 'INC';

      return (
        <g data-testid={testId} opacity={isPreview ? 0.72 : 1}>
          {/* Incoming & outgoing tangent guide rays */}
          <line
            x1={vertexPt.x}
            y1={vertexPt.y}
            x2={inEnd.x}
            y2={inEnd.y}
            stroke={MEASURE_ACCENT}
            strokeWidth={1.6 * invScale}
            strokeDasharray={`${4 * invScale} ${2.5 * invScale}`}
          />
          <line
            x1={vertexPt.x}
            y1={vertexPt.y}
            x2={outEnd.x}
            y2={outEnd.y}
            stroke={MEASURE_ACCENT}
            strokeWidth={1.6 * invScale}
            strokeDasharray={`${4 * invScale} ${2.5 * invScale}`}
          />
          {/* Angle arc */}
          {arcPath && (
            <path
              d={arcPath}
              fill="none"
              stroke={MEASURE_PRIMARY}
              strokeWidth={(isPreview ? 1.8 : 2.3) * invScale}
              strokeDasharray={isPreview ? `${3 * invScale} ${2 * invScale}` : undefined}
            />
          )}
          <circle
            cx={vertexPt.x}
            cy={vertexPt.y}
            r={4.2 * invScale}
            fill="#ffffff"
            stroke={MEASURE_PRIMARY}
            strokeWidth={1.8 * invScale}
          />
          {!isPreview && renderCalloutText(lx, ly, `${displayDeg.toFixed(1)}° ${tag}`)}
        </g>
      );
    };

    const renderHoverCandidate = () => {
      if (!isMeasureMode || !measurementHoverEntity) return null;
      const pt = resolveLivePoint(measurementHoverEntity);
      const off = getEffectiveOffset(measurementHoverEntity.pieceId);
      return (
        <g
          data-testid="cad-measure-hover"
          data-entity-kind={measurementHoverEntity.entityKind}
          data-presentation-ref={measurementHoverEntity.presentationRef}
        >
          {measurementHoverEntity.entityKind === 'edge' && (
            <line
              x1={measurementHoverEntity.startLocalCm.x + off.offsetXCm}
              y1={measurementHoverEntity.startLocalCm.y + off.offsetYCm}
              x2={measurementHoverEntity.endLocalCm.x + off.offsetXCm}
              y2={measurementHoverEntity.endLocalCm.y + off.offsetYCm}
              stroke={MEASURE_ACCENT}
              strokeWidth={2.4 * invScale}
              strokeDasharray={`${4 * invScale} ${2.5 * invScale}`}
              strokeLinecap="round"
            />
          )}
          {measurementHoverEntity.entityKind === 'curve' && (
            <path
              d={`M ${measurementHoverEntity.p0LocalCm.x + off.offsetXCm} ${measurementHoverEntity.p0LocalCm.y + off.offsetYCm} C ${measurementHoverEntity.p1LocalCm.x + off.offsetXCm} ${measurementHoverEntity.p1LocalCm.y + off.offsetYCm}, ${measurementHoverEntity.p2LocalCm.x + off.offsetXCm} ${measurementHoverEntity.p2LocalCm.y + off.offsetYCm}, ${measurementHoverEntity.p3LocalCm.x + off.offsetXCm} ${measurementHoverEntity.p3LocalCm.y + off.offsetYCm}`}
              fill="none"
              stroke={MEASURE_ACCENT}
              strokeWidth={2.4 * invScale}
              strokeDasharray={`${4 * invScale} ${2.5 * invScale}`}
              strokeLinecap="round"
            />
          )}
          <circle
            cx={pt.x}
            cy={pt.y}
            r={5.8 * invScale}
            fill="rgba(217, 119, 6, 0.14)"
            stroke={MEASURE_ACCENT}
            strokeWidth={1.6 * invScale}
            strokeDasharray={`${3 * invScale} ${2 * invScale}`}
          />
          <circle cx={pt.x} cy={pt.y} r={2.2 * invScale} fill={MEASURE_ACCENT} />
        </g>
      );
    };

    return (
      <g data-testid="cad-measurement-overlay" className="pointer-events-none">
        {renderHoverCandidate()}

        {/* 1. Awaiting second anchor: Anchor A + live dashed distance preview line + optional vertex angle preview */}
        {measurementEvaluation.kind === 'awaiting-second-anchor' && (() => {
          const ptA = resolveLivePoint(measurementEvaluation.anchorA);
          const hoverTarget =
            isMeasureMode && measurementHoverEntity
              ? resolveLivePoint(measurementHoverEntity)
              : null;

          return (
            <g data-testid="cad-measure-pending">
              {measurementEvaluation.previewVertexAngle &&
                renderVertexAngleArc(
                  ptA,
                  measurementEvaluation.previewVertexAngle,
                  'cad-measure-vertex-preview',
                  true
                )}
              <MeasurePendingPreviewLine
                ptA={ptA}
                hoverTarget={hoverTarget}
                isMeasureMode={isMeasureMode}
                fallbackCursorCm={cursorCm}
                invScale={invScale}
                isYUp={isYUp}
                strokeColor={MEASURE_PREVIEW}
              />
              {renderAnchorBadge(ptA, 'A', 'cad-measure-anchor-a')}
            </g>
          );
        })()}

        {/* 2. Completed Pair Distance (reactive to live board placement / dragPreview) */}
        {measurementEvaluation.kind === 'pair-distance' && (() => {
          const ptA = resolveLivePoint(measurementEvaluation.anchorA);
          const ptB = resolveLivePoint(measurementEvaluation.anchorB);
          const dx = ptB.x - ptA.x;
          const dy = ptB.y - ptA.y;
          const liveDist = Math.hypot(dx, dy);
          const midX = (ptA.x + ptB.x) * 0.5;
          const midY = (ptA.y + ptB.y) * 0.5;
          const isSamePiece = measurementEvaluation.result.isSamePiece;
          const label = `${liveDist.toFixed(2)} cm${isSamePiece ? '' : ' · BOARD'}`;

          // Perpendicular end ticks
          const tickHalf = 4.5 * invScale;
          const nx = liveDist > 1e-9 ? -dy / liveDist : 0;
          const ny = liveDist > 1e-9 ? dx / liveDist : 1;

          return (
            <g data-testid="cad-measure-pair-line">
              {/* Subtle Δx / Δy right-triangle helper legs */}
              {Math.abs(dx) > 1e-3 && Math.abs(dy) > 1e-3 && (
                <g opacity="0.55">
                  <line
                    x1={ptA.x}
                    y1={ptA.y}
                    x2={ptB.x}
                    y2={ptA.y}
                    stroke={MEASURE_ACCENT}
                    strokeWidth={1.0 * invScale}
                    strokeDasharray={`${3 * invScale} ${3 * invScale}`}
                  />
                  <line
                    x1={ptB.x}
                    y1={ptA.y}
                    x2={ptB.x}
                    y2={ptB.y}
                    stroke={MEASURE_ACCENT}
                    strokeWidth={1.0 * invScale}
                    strokeDasharray={`${3 * invScale} ${3 * invScale}`}
                  />
                </g>
              )}
              {/* Main dimension line */}
              <line
                x1={ptA.x}
                y1={ptA.y}
                x2={ptB.x}
                y2={ptB.y}
                stroke={MEASURE_PRIMARY}
                strokeWidth={2.2 * invScale}
                strokeLinecap="round"
              />
              {/* End ticks */}
              {liveDist > 1e-6 && (
                <>
                  <line
                    x1={ptA.x - nx * tickHalf}
                    y1={ptA.y - ny * tickHalf}
                    x2={ptA.x + nx * tickHalf}
                    y2={ptA.y + ny * tickHalf}
                    stroke={MEASURE_PRIMARY}
                    strokeWidth={1.6 * invScale}
                  />
                  <line
                    x1={ptB.x - nx * tickHalf}
                    y1={ptB.y - ny * tickHalf}
                    x2={ptB.x + nx * tickHalf}
                    y2={ptB.y + ny * tickHalf}
                    stroke={MEASURE_PRIMARY}
                    strokeWidth={1.6 * invScale}
                  />
                </>
              )}
              {renderAnchorBadge(ptA, 'A', 'cad-measure-anchor-a')}
              {renderAnchorBadge(ptB, 'B', 'cad-measure-anchor-b')}
              {renderCalloutText(
                midX,
                isYUp ? midY + 10 * invScale : midY - 10 * invScale,
                label
              )}
            </g>
          );
        })()}

        {/* 3. Completed Straight Edge Measurement */}
        {measurementEvaluation.kind === 'straight-edge' && (() => {
          const edge = measurementEvaluation.entity;
          const res = measurementEvaluation.result;
          const off = getEffectiveOffset(edge.pieceId);
          const p0 = {
            x: edge.startLocalCm.x + off.offsetXCm,
            y: edge.startLocalCm.y + off.offsetYCm
          };
          const p1 = {
            x: edge.endLocalCm.x + off.offsetXCm,
            y: edge.endLocalCm.y + off.offsetYCm
          };
          const midX = (p0.x + p1.x) * 0.5;
          const midY = (p0.y + p1.y) * 0.5;
          const label =
            res.lengthCm !== null
              ? res.angles
                ? `${res.lengthCm.toFixed(2)} cm · ${res.angles.undirectedOrientationDeg.toFixed(1)}°`
                : `${res.lengthCm.toFixed(2)} cm`
              : '0.00 cm (Degenerate)';

          return (
            <g data-testid="cad-measure-edge-line">
              <line
                x1={p0.x}
                y1={p0.y}
                x2={p1.x}
                y2={p1.y}
                stroke={MEASURE_PRIMARY}
                strokeWidth={3.2 * invScale}
                strokeLinecap="round"
              />
              <circle
                cx={p0.x}
                cy={p0.y}
                r={3.8 * invScale}
                fill="#ffffff"
                stroke={MEASURE_PRIMARY}
                strokeWidth={1.8 * invScale}
              />
              <circle
                cx={p1.x}
                cy={p1.y}
                r={3.8 * invScale}
                fill="#ffffff"
                stroke={MEASURE_PRIMARY}
                strokeWidth={1.8 * invScale}
              />
              {renderCalloutText(
                midX,
                isYUp ? midY + 10 * invScale : midY - 10 * invScale,
                label
              )}
            </g>
          );
        })()}

        {/* 4. Completed Vertex Angle Measurement */}
        {measurementEvaluation.kind === 'vertex-angle' &&
          renderVertexAngleArc(
            resolveLivePoint(measurementEvaluation.entity),
            measurementEvaluation.result,
            'cad-measure-vertex-angle',
            false
          )}

        {/* 5. Completed Cubic Bézier Differential & Arc-Length Measurement */}
        {measurementEvaluation.kind === 'cubic-bezier' && (() => {
          const curve = measurementEvaluation.entity;
          const { differential, fullArcLength, partialArcLength } = measurementEvaluation.result;
          const off = getEffectiveOffset(curve.pieceId);
          const p0 = { x: curve.p0LocalCm.x + off.offsetXCm, y: curve.p0LocalCm.y + off.offsetYCm };
          const p1 = { x: curve.p1LocalCm.x + off.offsetXCm, y: curve.p1LocalCm.y + off.offsetYCm };
          const p2 = { x: curve.p2LocalCm.x + off.offsetXCm, y: curve.p2LocalCm.y + off.offsetYCm };
          const p3 = { x: curve.p3LocalCm.x + off.offsetXCm, y: curve.p3LocalCm.y + off.offsetYCm };
          const evalPt = resolveLivePoint(curve);
          const curveD = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;

          const tangent = differential.unitTangent;
          const tangentLen = 24 * invScale;
          const arrowLen = 6 * invScale;
          const tEnd = tangent
            ? { x: evalPt.x + tangent.x * tangentLen, y: evalPt.y + tangent.y * tangentLen }
            : null;
          // Unit normal rotated +90° from tangent for arrowhead & subtle curvature indicator
          const perp = tangent ? { x: -tangent.y, y: tangent.x } : null;
          const kappaSign =
            differential.signedCurvatureInvCm !== null &&
            Math.abs(differential.signedCurvatureInvCm) > 1e-9
              ? Math.sign(differential.signedCurvatureInvCm)
              : 0;
          const normalLen = 12 * invScale;

          const fullLenText =
            fullArcLength.arcLengthCm !== null
              ? `L ≈ ${fullArcLength.arcLengthCm.toFixed(2)} cm`
              : 'L indeterminate';
          const partialText =
            partialArcLength.arcLengthCm !== null &&
            curve.parameterT > 1e-3 &&
            curve.parameterT < 1 - 1e-3
              ? ` (0→t ${partialArcLength.arcLengthCm.toFixed(2)})`
              : '';

          return (
            <g data-testid="cad-measure-cubic-curve">
              <path
                d={curveD}
                fill="none"
                stroke={MEASURE_PRIMARY}
                strokeWidth={3.2 * invScale}
                strokeLinecap="round"
              />
              {/* Endpoint markers */}
              <circle
                cx={p0.x}
                cy={p0.y}
                r={3.2 * invScale}
                fill="#ffffff"
                stroke={MEASURE_PRIMARY}
                strokeWidth={1.6 * invScale}
              />
              <circle
                cx={p3.x}
                cy={p3.y}
                r={3.2 * invScale}
                fill="#ffffff"
                stroke={MEASURE_PRIMARY}
                strokeWidth={1.6 * invScale}
              />
              {/* Unit tangent vector arrow at evaluated parameter t */}
              {tangent && tEnd && perp && !differential.isStationary && (
                <g data-testid="cad-measure-cubic-tangent">
                  <line
                    x1={evalPt.x}
                    y1={evalPt.y}
                    x2={tEnd.x}
                    y2={tEnd.y}
                    stroke="#0369a1"
                    strokeWidth={2.0 * invScale}
                    strokeLinecap="round"
                  />
                  <polyline
                    points={`${tEnd.x - tangent.x * arrowLen + perp.x * (arrowLen * 0.45)},${tEnd.y - tangent.y * arrowLen + perp.y * (arrowLen * 0.45)} ${tEnd.x},${tEnd.y} ${tEnd.x - tangent.x * arrowLen - perp.x * (arrowLen * 0.45)},${tEnd.y - tangent.y * arrowLen - perp.y * (arrowLen * 0.45)}`}
                    fill="none"
                    stroke="#0369a1"
                    strokeWidth={1.8 * invScale}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Subtle inward normal tick indicating curvature direction */}
                  {kappaSign !== 0 && (
                    <line
                      x1={evalPt.x}
                      y1={evalPt.y}
                      x2={evalPt.x + perp.x * kappaSign * normalLen}
                      y2={evalPt.y + perp.y * kappaSign * normalLen}
                      stroke={MEASURE_ACCENT}
                      strokeWidth={1.4 * invScale}
                      strokeDasharray={`${2.5 * invScale} ${2 * invScale}`}
                    />
                  )}
                </g>
              )}
              {/* Evaluated point at t */}
              <circle
                cx={evalPt.x}
                cy={evalPt.y}
                r={4.8 * invScale}
                fill="#ffffff"
                stroke={MEASURE_PRIMARY}
                strokeWidth={2.0 * invScale}
              />
              <circle cx={evalPt.x} cy={evalPt.y} r={2.0 * invScale} fill={MEASURE_PRIMARY} />
              {renderCalloutText(
                evalPt.x,
                isYUp ? evalPt.y + 12 * invScale : evalPt.y - 12 * invScale,
                `${fullLenText}${partialText}`
              )}
            </g>
          );
        })()}
      </g>
    );
  };

  // UX-2.3.3.3: Stage-2 Board Projection & Screen-Space Clustering (zero artifact remapping on drag)
  const projectedDiagnostics = useMemo(() => {
    if (effectiveViewMode !== 'pieces' || !showDiagnosticsOverlay || resolvedDiagnostics.mappedItems.length === 0) {
      return {
        visibleItems: [] as readonly ProjectedDiagnosticItem[],
        clusters: [] as readonly DiagnosticMarkerCluster[],
        hiddenByLayerCount: 0,
        hiddenByFilterCount: 0,
        culledOffscreenCount: 0
      };
    }

    const offsetsMap: Record<string, BoardPieceOffsetVisibility> = {};
    for (const piece of artifact.pieces) {
      const eff = getEffectiveOffset(piece.pieceId);
      offsetsMap[piece.pieceId] = {
        offsetXCm: eff.offsetXCm,
        offsetYCm: eff.offsetYCm,
        visible: isPieceEffectivelyVisible(boardState, piece.pieceId)
      };
    }

    return projectDiagnosticsForCanvas(
      resolvedDiagnostics,
      offsetsMap,
      layerVisibility,
      camera,
      projection,
      viewportSize,
      {
        showOverlay: showDiagnosticsOverlay,
        severityFilter: diagnosticSeverityFilter,
        selectedDiagnosticKey,
        hoveredDiagnosticKey
      }
    );
  }, [
    effectiveViewMode,
    showDiagnosticsOverlay,
    resolvedDiagnostics,
    artifact.pieces,
    boardState,
    dragPreview,
    layerVisibility,
    camera,
    projection,
    viewportSize,
    diagnosticSeverityFilter,
    selectedDiagnosticKey,
    hoveredDiagnosticKey
  ]);

  const canInteractWithDiagnostics =
    effectiveViewMode === 'pieces' &&
    activeTool === 'select' &&
    !spacePressed &&
    !dragPreview &&
    !marqueePreviewCm;

  const shouldRenderDiagnosticsOverlay =
    effectiveViewMode === 'pieces' &&
    showDiagnosticsOverlay &&
    projectedDiagnostics.clusters.length > 0;

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
        {/* Adaptive Centimeter Grid synchronized with camera (CSS background avoids full-viewport SVG pattern rasterization on zoom) */}
        {showGrid && (
          <div
            data-testid="cad-adaptive-grid"
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(189,184,172,0.85) 1px, transparent 1px), linear-gradient(to bottom, rgba(189,184,172,0.85) 1px, transparent 1px), linear-gradient(to right, rgba(214,211,203,0.65) 1px, transparent 1px), linear-gradient(to bottom, rgba(214,211,203,0.65) 1px, transparent 1px)',
              backgroundSize: `${gridSpacing.majorPx}px ${gridSpacing.majorPx}px, ${gridSpacing.majorPx}px ${gridSpacing.majorPx}px, ${gridSpacing.minorPx}px ${gridSpacing.minorPx}px, ${gridSpacing.minorPx}px ${gridSpacing.minorPx}px`,
              backgroundPosition: `${camera.panX}px ${camera.panY}px`
            }}
          />
        )}

        <svg
          data-testid="pattern-cad-svg"
          width={Math.max(1, viewportSize.width)}
          height={Math.max(1, viewportSize.height)}
          className="relative block w-full h-full"
        >
          {/* World Origin Axes (0 cm, 0 cm) */}
          {showGrid && (
            <g aria-hidden="true">
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

                {/* UX-2.3.3.4: Proposal-Based Sew-Contour Editing & Original Ghost Overlay */}
                <PatternContourEditOverlay
                  artifact={artifact}
                  visiblePieces={orderedVisiblePieces}
                  getEffectiveOffset={getEffectiveOffset}
                  proposalState={proposalState}
                  proposalIntegrity={proposalIntegrity}
                  isEditContourMode={isEditContourMode}
                  compareOriginalGeometry={compareOriginalGeometry}
                  selection={contourEditSelection}
                  hoverTarget={contourHoverTarget}
                  dragPreview={contourDragPreview}
                  pendingApproximatePreview={pendingApproximatePreview}
                  invScale={invScale}
                  isYUp={isYUp}
                />

                {/* WP-A1..A4 Integrated Engineering Overlays (Non-Cutting, Read-Only SVG Presentation) */}
                {atelierView?.wpAState && (
                  <>
                    <PatternSeamWalkOverlay
                      artifact={effectiveInspectionArtifact}
                      visiblePieces={orderedVisiblePieces}
                      getEffectiveOffset={getEffectiveOffset}
                      activePair={
                        (atelierView.activeSeamPairId
                          ? atelierView.wpAState.seamCorrespondences[atelierView.activeSeamPairId]
                          : null) ??
                        Object.values(atelierView.wpAState.seamCorrespondences)[0] ??
                        null
                      }
                      evaluation={atelierView.activeSeamWalkEvaluation}
                      showGhostPieceB={atelierView.showSeamWalkGhostB}
                      visible={
                        (layerVisibility.showSeamWalkOverlay ?? true) &&
                        (activeTool === 'seam-walk' || Boolean(atelierView.activeSeamPairId))
                      }
                      invScale={invScale}
                      isYUp={isYUp}
                    />
                    <PatternConstructionOverlay
                      constructions={atelierView.wpAState.constructions}
                      getEffectiveOffset={getEffectiveOffset}
                      showConstructions={layerVisibility.showConstructions ?? true}
                      showInternalLines={layerVisibility.showInternalLines ?? true}
                      showAnnotations={layerVisibility.showProductionAnnotations ?? true}
                      selectedConstructionId={atelierView.selectedConstructionId}
                      drawPreview={constructionDrawPreview}
                      activeSnapResult={activeUnifiedSnap?.result ?? null}
                      activeSnapPieceId={activeUnifiedSnap?.pieceId ?? null}
                      invScale={invScale}
                      isYUp={isYUp}
                    />
                    <PatternDartOverlay
                      visiblePieces={orderedVisiblePieces}
                      pieceEngineering={atelierView.wpAState.pieceEngineering}
                      getEffectiveOffset={getEffectiveOffset}
                      selectedDartId={atelierView.selectedDartId}
                      visible={layerVisibility.showDarts}
                      invScale={invScale}
                      isYUp={isYUp}
                    />
                    <PatternAllowanceRuleOverlay
                      visiblePieces={orderedVisiblePieces}
                      pieceEngineering={atelierView.wpAState.pieceEngineering}
                      getEffectiveOffset={getEffectiveOffset}
                      selectedSegmentId={atelierView.selectedAllowanceSegmentId}
                      showRuleBadges={layerVisibility.showAllowanceRuleBadges ?? true}
                      showProductionAnnotations={layerVisibility.showProductionAnnotations ?? true}
                      isAllowanceToolActive={activeTool === 'allowance-rule'}
                      invScale={invScale}
                      isYUp={isYUp}
                    />
                  </>
                )}

                {/* UX-2.3.3.1: Dedicated Read-Only Entity Inspection Overlay (pointer-events-none) */}
                {(isInspectMode || isMeasureMode || hoveredEntity || inspectedEntity) && (
                  <g data-testid="cad-inspection-overlay" className="pointer-events-none">
                    {/* Subtle inspectable/measurable contour vertex markers while inspect or measure tool is active */}
                    {(isInspectMode || isMeasureMode) && inspectVertexHints.length > 0 && (
                      <g data-testid="cad-inspect-vertex-hints" opacity="0.72">
                        {inspectVertexHints.map(v => (
                          <circle
                            key={v.key}
                            cx={v.x}
                            cy={v.y}
                            r={2.4 * invScale}
                            fill="#ffffff"
                            stroke={isMeasureMode ? '#b45309' : '#475569'}
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

                {/* UX-2.3.3.2: Dedicated Advisory Precision Measurement Overlay (pointer-events-none) */}
                {renderMeasurementOverlay()}

                {/* UX-2.3.3.3: Spatial Diagnostic Mapping Overlay (read-only presentation localization) */}
                {shouldRenderDiagnosticsOverlay && (
                  <PatternDiagnosticsOverlay
                    projectedDiagnostics={projectedDiagnostics}
                    invScale={invScale}
                    isYUp={isYUp}
                    canInteractWithDiagnostics={canInteractWithDiagnostics}
                    selectedDiagnosticKey={selectedDiagnosticKey}
                    onSelectDiagnostic={onSelectDiagnostic}
                    onHoverDiagnostic={onHoverDiagnostic}
                  />
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
