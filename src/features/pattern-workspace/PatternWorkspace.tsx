/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BodiceDartStyle,
  BodyMeasurements,
  DesignSpecification,
  PatternPiece,
  SleeveEaseStrategy
} from '../../types';
import { draftSleeveBlock } from '../../engine/drafting/sleeve-block';
import { assembleBodiceSleeve, BodiceSleeveAssemblyResult } from '../../engine/assembly';
import { STANDARD_SIZING_SYSTEM } from '../../engine/measurements/standards';
import type {
  AuthoritativeProductionWorkspaceBundle,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementProvenanceEvidence,
  ProductionWorkspaceBomControls
} from '../../engine/production';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import {
  buildAuthoritativeProductionWorkspaceBundle,
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
  getUnsupportedCategoryMessage
} from '../../engine/production';
import type { ProductionBomControlState } from '../production/ProductionPackagePanel';
import { SimulationFitPanel } from '../simulation/SimulationFitPanel';
import type { AssemblyScenarioMode } from './AssemblyInspectionPanel';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Compass,
  FolderPlus,
  Layers,
  Magnet,
  Redo2,
  Undo2,
  Ungroup
} from 'lucide-react';
import {
  SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
  SYNTHETIC_TEST_PROTOTYPE_DISCREPANT
} from '../../engine/prototype/prototype-fixtures';
import { validatePhysicalFit } from '../../engine/prototype/fit-validator';
import { FitValidationReport, PhysicalPrototypeRecord } from '../../engine/prototype/prototype-types';
import { adaptC0LegacyBundleToRenderArtifact } from './contracts/c0-legacy-adapter';
import { CadCamera, clampCadZoom } from './cad-math';
import {
  PatternCadLayerVisibility,
  PatternCadViewMode,
  useOptionalPatternAtelierView
} from './PatternAtelierViewContext';
import { PatternCadCanvas } from './PatternCadCanvas';
import { PatternAtelierStatusBar } from './PatternAtelierStatusBar';
import { PatternLayersDrawer } from './PatternLayersDrawer';
import { SNAP_INTERVAL_OPTIONS_CM } from './board-arrangement';
import type { RenderPoint2D } from './contracts/pattern-render-artifact';

interface PatternWorkspaceProps {
  currentSpec: DesignSpecification;
  measurements: BodyMeasurements;
  activeSize: string;
  measurementProvenance?: MeasurementOrigin;
  measurementApprovalState?: MeasurementApprovalStatus;
  measurementProvenanceEvidence?: MeasurementProvenanceEvidence;
  workspaceBundle?: AuthoritativeProductionWorkspaceBundle;
  bomControls?: ProductionWorkspaceBomControls;
  onChangeBomControls?: (next: ProductionBomControlState) => void;
  bodiceDartStyle?: BodiceDartStyle;
  onChangeBodiceDartStyle?: (next: BodiceDartStyle) => void;
  sleeveEaseStrategy?: SleeveEaseStrategy;
  onChangeSleeveEaseStrategy?: (next: SleeveEaseStrategy) => void;
  strictUncertaintyGate?: boolean;
  onToggleStrictUncertaintyGate?: (next: boolean) => void;
  requireApprovedGovernance?: boolean;
  onToggleRequireApprovedGovernance?: (next: boolean) => void;
  onCommitProductionBaseline?: () => void;
  onSyncWorkingDraftSnapshot?: () => void;
  onNavigateToProduction: () => void;
  onNavigateToMeasurements: () => void;
  onUpdateSpec?: (nextSpec: DesignSpecification) => void;
  selectedPieceId?: string | null;
  onSelectPieceId?: (pieceId: string) => void;
  onSelectSeam?: (
    piece: PatternPiece,
    seam: { id: string; name: string; lengthCm: number; pairedSeamName?: string }
  ) => void;
  externalZoom?: number;
  onChangeZoom?: (nextZoom: number) => void;
  activeTool?: string;
  showGrid?: boolean;
}

const DEFAULT_LOCAL_CAMERA: CadCamera = { zoom: 1.0, panX: 48, panY: 48 };
const DEFAULT_LOCAL_LAYERS: PatternCadLayerVisibility = {
  showSeamAllowance: true,
  showSewLines: true,
  showGrainline: true,
  showNotches: true,
  showDarts: true,
  showDimensions: true
};

const LAYER_TOGGLE_ITEMS: ReadonlyArray<{
  key: keyof PatternCadLayerVisibility;
  label: string;
  title: string;
}> = [
  { key: 'showSeamAllowance', label: 'Cut', title: 'Toggle seam allowance cut line' },
  { key: 'showSewLines', label: 'Sew', title: 'Toggle stitch / sew line' },
  { key: 'showGrainline', label: 'Grain', title: 'Toggle grainline arrows' },
  { key: 'showNotches', label: 'Notch', title: 'Toggle seam notches' },
  { key: 'showDarts', label: 'Dart', title: 'Toggle dart intake paths' },
  { key: 'showDimensions', label: 'Dim', title: 'Toggle piece dimensions' }
];

export const PatternWorkspace: React.FC<PatternWorkspaceProps> = ({
  currentSpec,
  measurements,
  activeSize,
  measurementProvenance = 'standard-chart',
  measurementApprovalState = 'unverified',
  measurementProvenanceEvidence,
  workspaceBundle: externalBundle,
  bomControls: externalBomControls,
  bodiceDartStyle: externalBodiceDartStyle,
  onChangeBodiceDartStyle: externalOnChangeBodiceDartStyle,
  sleeveEaseStrategy: externalSleeveEaseStrategy,
  onChangeSleeveEaseStrategy: externalOnChangeSleeveEaseStrategy,
  strictUncertaintyGate: externalStrictUncertaintyGate,
  requireApprovedGovernance: externalRequireApprovedGovernance,
  onNavigateToProduction,
  onNavigateToMeasurements,
  onUpdateSpec,
  selectedPieceId: externalSelectedPieceId,
  onSelectPieceId: externalOnSelectPieceId,
  activeTool = 'select',
  showGrid = true
}) => {
  const atelierCtx = useOptionalPatternAtelierView();

  // Standalone fallbacks when rendered outside App.tsx / PatternAtelierViewProvider
  const [localBodiceDartStyle, setLocalBodiceDartStyle] = useState<BodiceDartStyle>(
    currentSpec.dartStyle ?? 'waist'
  );
  const [localSleeveEaseStrategy, setLocalSleeveEaseStrategy] = useState<SleeveEaseStrategy>(
    currentSpec.sleeveEaseStrategy ?? 'classic'
  );
  const [localBomControls] = useState<ProductionBomControlState>({
    ...DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS
  });
  const [localCamera, setLocalCamera] = useState<CadCamera>(DEFAULT_LOCAL_CAMERA);
  const [localFitVersion, setLocalFitVersion] = useState<number>(1);
  const [localCursorCm, setLocalCursorCm] = useState<RenderPoint2D | null>(null);
  const [localCadViewMode, setLocalCadViewMode] = useState<PatternCadViewMode>('pieces');
  const [localAssemblyScenario, setLocalAssemblyScenario] =
    useState<AssemblyScenarioMode>('active-draft');
  const [localSelectedPrototypeId, setLocalSelectedPrototypeId] =
    useState<string>('PROTO-BOD-2026-M-01');
  const [localLayerVisibility, setLocalLayerVisibility] =
    useState<PatternCadLayerVisibility>(DEFAULT_LOCAL_LAYERS);
  const [localEnabledGradingSizes] = useState<Record<string, boolean>>({
    XS: true,
    S: true,
    M: true,
    L: true,
    XL: true,
    XXL: true
  });
  const [localSelectedPieceId, setLocalSelectedPieceId] = useState<string>(
    currentSpec.garmentCategory === 'bodice' ? 'piece-bodice-front' : 'piece-skirt-front'
  );

  const bodiceDartStyle = externalBodiceDartStyle ?? localBodiceDartStyle;
  const setBodiceDartStyle = externalOnChangeBodiceDartStyle ?? setLocalBodiceDartStyle;
  const sleeveEaseStrategy = externalSleeveEaseStrategy ?? localSleeveEaseStrategy;
  const setSleeveEaseStrategy = externalOnChangeSleeveEaseStrategy ?? setLocalSleeveEaseStrategy;
  const bomControls: ProductionBomControlState = externalBomControls
    ? { ...externalBomControls }
    : localBomControls;
  const requireApprovedGovernance = externalRequireApprovedGovernance ?? false;
  const strictUncertaintyGate = externalStrictUncertaintyGate ?? true;

  const camera = atelierCtx?.camera ?? localCamera;
  const setCamera = atelierCtx?.setCamera ?? setLocalCamera;
  const fitRequestVersion = atelierCtx?.fitRequestVersion ?? localFitVersion;
  const requestFitAll =
    atelierCtx?.requestFitAll ?? (() => setLocalFitVersion(v => v + 1));
  const resetCameraTo100 =
    atelierCtx?.resetCameraTo100 ?? (() => setLocalCamera(DEFAULT_LOCAL_CAMERA));
  const cursorCm = atelierCtx?.cursorCm ?? localCursorCm;
  const setCursorCm = atelierCtx?.setCursorCm ?? setLocalCursorCm;
  const cadViewMode = atelierCtx?.cadViewMode ?? localCadViewMode;
  const setCadViewMode = atelierCtx?.setCadViewMode ?? setLocalCadViewMode;
  const assemblyScenario = atelierCtx?.assemblyScenario ?? localAssemblyScenario;
  const setAssemblyScenario = atelierCtx?.setAssemblyScenario ?? setLocalAssemblyScenario;
  const selectedPrototypeId = atelierCtx?.selectedPrototypeId ?? localSelectedPrototypeId;
  const setSelectedPrototypeId = atelierCtx?.setSelectedPrototypeId ?? setLocalSelectedPrototypeId;
  const layerVisibility = atelierCtx?.layerVisibility ?? localLayerVisibility;
  const toggleLayerVisibility =
    atelierCtx?.toggleLayerVisibility ??
    ((key: keyof PatternCadLayerVisibility) =>
      setLocalLayerVisibility(prev => ({ ...prev, [key]: !prev[key] })));
  const enabledGradingSizes = atelierCtx?.enabledGradingSizes ?? localEnabledGradingSizes;

  const selectedPieceId = externalSelectedPieceId ?? localSelectedPieceId;
  const setSelectedPieceId = (nextId: string) => {
    setLocalSelectedPieceId(nextId);
    externalOnSelectPieceId?.(nextId);
  };

  // Single authoritative production workspace bundle (shared with Module 05)
  const fallbackBundle = useMemo(() => {
    if (externalBundle) return null;
    return buildAuthoritativeProductionWorkspaceBundle({
      projectId: 'project-patroner-default',
      tenantId: 'tenant-studio-local',
      designSpec: currentSpec,
      measurements,
      activeSize,
      bomControls,
      governance: {
        bodiceDartStyle,
        sleeveEaseStrategy,
        strictUncertaintyGate,
        requireApprovedGovernance,
        measurementProvenance,
        measurementApprovalState,
        measurementProvenanceEvidence
      }
    });
  }, [
    externalBundle,
    currentSpec,
    measurements,
    activeSize,
    bomControls,
    bodiceDartStyle,
    sleeveEaseStrategy,
    strictUncertaintyGate,
    requireApprovedGovernance,
    measurementProvenance,
    measurementApprovalState,
    measurementProvenanceEvidence
  ]);

  const workspaceBundle = externalBundle ?? fallbackBundle!;
  const {
    isCadSupported,
    pieces: bundlePieces,
    assemblyResult: authoritativeAssemblyResult,
    draftValidation: validationReport,
    gradedPatternSet,
    m05Package,
    liveSnapshot
  } = workspaceBundle;

  const pieces: PatternPiece[] = useMemo(() => [...bundlePieces], [bundlePieces]);

  // Read-only UX-2.3.1 render artifact bundle adapted from C0-Legacy TS output
  const renderArtifact = useMemo(
    () =>
      adaptC0LegacyBundleToRenderArtifact({
        workspaceBundle,
        specificationRevisionId:
          liveSnapshot?.revisionId ?? `${currentSpec.id}-v${currentSpec.version}`,
        measurementRevisionId: `meas-${String(activeSize).toUpperCase()}`
      }),
    [workspaceBundle, liveSnapshot?.revisionId, currentSpec.id, currentSpec.version, activeSize]
  );

  // Reconcile UX-2.3.2 CAD board presentation state with the active immutable artifact
  useEffect(() => {
    atelierCtx?.syncArtifact(renderArtifact);
  }, [atelierCtx, renderArtifact]);

  // Synchronize external entity strip piece selection ONLY when externalSelectedPieceId changes,
  // so clearing board selection (Escape, empty canvas click, Clear) is never immediately overridden.
  const lastSyncedExternalPieceRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!atelierCtx) return;
    if (externalSelectedPieceId === lastSyncedExternalPieceRef.current) return;
    lastSyncedExternalPieceRef.current = externalSelectedPieceId;
    if (!externalSelectedPieceId) return;
    if (
      atelierCtx.boardState.placementsByPieceId[externalSelectedPieceId] &&
      !atelierCtx.boardState.selectedPieceIds.includes(externalSelectedPieceId)
    ) {
      atelierCtx.selectPiece(externalSelectedPieceId, { expandGroup: false });
    }
  }, [atelierCtx, externalSelectedPieceId]);

  // Interactive assembly diagnostic preview (diverges locally only for explicit incompatible-xs-flat toggle)
  const { assemblyResult, assemblyError } = useMemo(() => {
    let resolvedResult: BodiceSleeveAssemblyResult | undefined = authoritativeAssemblyResult;
    let resolvedError: string | undefined = undefined;
    if (
      currentSpec.garmentCategory === 'bodice' &&
      pieces.length >= 2 &&
      assemblyScenario === 'incompatible-xs-flat'
    ) {
      try {
        const targetSleeveForAssembly = draftSleeveBlock(
          STANDARD_SIZING_SYSTEM.sizes.XS,
          currentSpec,
          { strategy: 'flat' }
        ).piece;

        resolvedResult = assembleBodiceSleeve({
          bodicePieces: pieces.slice(0, 2),
          sleevePiece: targetSleeveForAssembly,
          designSpec: currentSpec,
          measurements,
          options: {
            strategy: sleeveEaseStrategy,
            strictUncertaintyGate,
            measurementProvenance,
            measurementApprovalState,
            requireApprovedGovernance
          }
        });
      } catch (err) {
        resolvedResult = undefined;
        resolvedError = err instanceof Error ? err.message : String(err);
      }
    }
    return { assemblyResult: resolvedResult, assemblyError: resolvedError };
  }, [
    authoritativeAssemblyResult,
    currentSpec,
    pieces,
    assemblyScenario,
    measurements,
    sleeveEaseStrategy,
    strictUncertaintyGate,
    measurementProvenance,
    measurementApprovalState,
    requireApprovedGovernance
  ]);

  const activePrototypeRecord: PhysicalPrototypeRecord = useMemo(() => {
    return selectedPrototypeId === 'PROTO-BOD-2026-M-01' ||
      selectedPrototypeId === 'SYNTH-PROTO-BOD-M-CONFORMING'
      ? SYNTHETIC_TEST_PROTOTYPE_CONFORMING
      : SYNTHETIC_TEST_PROTOTYPE_DISCREPANT;
  }, [selectedPrototypeId]);

  const activePrototypeReport: FitValidationReport = useMemo(() => {
    return validatePhysicalFit(activePrototypeRecord);
  }, [activePrototypeRecord]);

  const primaryBoardSelectedId = atelierCtx?.boardState.selectedPieceIds[0] ?? selectedPieceId;
  const selectedPiece = pieces.find(p => p.id === primaryBoardSelectedId) ?? pieces[0];

  const effectiveViewMode: PatternCadViewMode =
    (currentSpec.garmentCategory !== 'bodice' ||
      (cadViewMode === 'grading' && !gradedPatternSet)) &&
    cadViewMode !== 'pieces' &&
    cadViewMode !== 'simulation'
      ? 'pieces'
      : cadViewMode;

  const handleZoomStep = (factor: number) => {
    if (atelierCtx) {
      atelierCtx.zoomByFactor(factor);
      return;
    }
    setLocalCamera(prev => ({ ...prev, zoom: clampCadZoom(prev.zoom * factor) }));
  };

  // Fail-closed screen for unsupported garment categories (e.g., trouser, dress)
  if (!isCadSupported || !m05Package) {
    return (
      <div
        data-testid="pattern-atelier-unsupported"
        className="w-full h-full flex-1 min-h-0 flex overflow-hidden bg-[#F5F4F0]"
      >
        {atelierCtx && (
          <PatternLayersDrawer
            isCadSupported={false}
            garmentCategory={currentSpec.garmentCategory}
          />
        )}
        <div className="flex-1 min-w-0 overflow-y-auto px-4 lg:px-8 py-8">
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="border-b border-neutral-300 pb-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500 font-mono">
                  Pattern Atelier
                </span>
                <span className="text-neutral-300">/</span>
                <Badge variant="neutral" size="sm">SPECS ONLY CATEGORY</Badge>
              </div>
              <h2 className="text-xl font-serif font-bold text-neutral-900 tracking-tight">
                Deterministic CAD Block Pending
              </h2>
            </div>

            <div className="bg-white border border-amber-300 rounded-sm p-5 shadow-2xs space-y-4">
              <div className="flex items-center gap-2 text-amber-900 font-mono text-xs uppercase font-bold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  Deterministic CAD Block Pending for "{currentSpec.garmentCategory.toUpperCase()}"
                </span>
              </div>
              <p className="text-sm text-neutral-700 leading-relaxed">
                {getUnsupportedCategoryMessage(currentSpec.garmentCategory)} Patroner refuses to
                silently substitute a skirt block for a{' '}
                <strong className="uppercase">{currentSpec.garmentCategory}</strong> specification.
              </p>
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {onUpdateSpec && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onUpdateSpec(INITIAL_CONCEPTS[0])}
                      className="font-mono text-xs uppercase"
                    >
                      Load Midi Skirt Block (CAD Ready)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onUpdateSpec(INITIAL_CONCEPTS[2])}
                      className="font-mono text-xs uppercase"
                    >
                      Load Tailored Bodice + Sleeve (CAD Ready)
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onNavigateToMeasurements}
                  icon={<Compass className="w-3.5 h-3.5" />}
                >
                  Adjust Body Measurements
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const layoutResetKey = `${currentSpec.id}:${currentSpec.garmentCategory}:${bodiceDartStyle}:${sleeveEaseStrategy}:${activeSize}:${effectiveViewMode}`;
  const selectedIds = atelierCtx?.boardState.selectedPieceIds ?? [];
  const hasGroupedInSelection = Boolean(
    atelierCtx &&
      selectedIds.some(id => Boolean(atelierCtx.boardState.placementsByPieceId[id]?.groupId))
  );
  const overlapCount = atelierCtx?.overlapAdvisories.length ?? 0;

  return (
    <div
      data-testid="pattern-atelier-workspace"
      className="w-full h-full flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-[#F5F4F0]"
    >
      {/* Compact CAD Sub-Bar */}
      <div
        data-testid="pattern-atelier-subbar"
        className="min-h-9 px-3 py-1 bg-[#F7F6F2] border-b border-neutral-300/90 flex flex-wrap items-center justify-between gap-2 shrink-0 text-[11px]"
      >
        {/* Left: Layers Drawer Toggle, View Mode Switcher & Contextual Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {atelierCtx && effectiveViewMode === 'pieces' && (
            <button
              type="button"
              aria-pressed={atelierCtx.layersDrawerOpen}
              data-testid="atelier-toggle-layers-btn"
              onClick={() => atelierCtx.setLayersDrawerOpen(!atelierCtx.layersDrawerOpen)}
              className={`px-2 py-0.5 rounded-xs border text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors ${
                atelierCtx.layersDrawerOpen
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:text-neutral-900'
              }`}
              title="Toggle Pattern-Piece Layers Drawer"
            >
              <Layers className="w-3 h-3" />
              <span>Layers</span>
            </button>
          )}

          <div
            role="tablist"
            aria-label="Pattern Atelier View Mode"
            className="inline-flex items-center bg-white border border-neutral-300 rounded-xs p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={effectiveViewMode === 'pieces'}
              data-testid="cad-mode-pieces"
              onClick={() => setCadViewMode('pieces')}
              className={`px-2 py-0.5 rounded-xs text-[11px] font-medium cursor-pointer transition-colors ${
                effectiveViewMode === 'pieces'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Pieces ({pieces.length})
            </button>

            {currentSpec.garmentCategory === 'bodice' && (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveViewMode === 'assembly'}
                  data-testid="cad-mode-assembly"
                  onClick={() => setCadViewMode('assembly')}
                  className={`px-2 py-0.5 rounded-xs text-[11px] font-medium cursor-pointer transition-colors ${
                    effectiveViewMode === 'assembly'
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Assembly
                </button>
                {gradedPatternSet && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={effectiveViewMode === 'grading'}
                    data-testid="cad-mode-grading"
                    onClick={() => setCadViewMode('grading')}
                    className={`px-2 py-0.5 rounded-xs text-[11px] font-medium cursor-pointer transition-colors ${
                      effectiveViewMode === 'grading'
                        ? 'bg-neutral-900 text-white'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    Grading
                  </button>
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveViewMode === 'fit'}
                  data-testid="cad-mode-fit"
                  onClick={() => setCadViewMode('fit')}
                  className={`px-2 py-0.5 rounded-xs text-[11px] font-medium cursor-pointer transition-colors ${
                    effectiveViewMode === 'fit'
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Fit
                </button>
              </>
            )}

            <button
              type="button"
              role="tab"
              aria-selected={effectiveViewMode === 'simulation'}
              data-testid="cad-mode-simulation"
              onClick={() => setCadViewMode('simulation')}
              className={`px-2 py-0.5 rounded-xs text-[11px] font-medium cursor-pointer transition-colors ${
                effectiveViewMode === 'simulation'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              3D Drape
            </button>
          </div>

          {/* Dedicated Board Arrangement Undo/Redo & Centimeter Snapping Controls (Pieces Mode) */}
          {atelierCtx && effectiveViewMode === 'pieces' && (
            <div className="flex items-center gap-1 border-l border-neutral-300 pl-2">
              <button
                type="button"
                disabled={!atelierCtx.canUndoBoard}
                onClick={atelierCtx.undoBoard}
                data-testid="atelier-undo-btn"
                title="Undo CAD board arrangement (does not alter pattern geometry)"
                aria-label="Undo board arrangement"
                className={`p-1 rounded-xs border transition-colors ${
                  atelierCtx.canUndoBoard
                    ? 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100 cursor-pointer'
                    : 'bg-neutral-100 text-neutral-400 border-neutral-200 cursor-not-allowed'
                }`}
              >
                <Undo2 className="w-3 h-3" />
              </button>
              <button
                type="button"
                disabled={!atelierCtx.canRedoBoard}
                onClick={atelierCtx.redoBoard}
                data-testid="atelier-redo-btn"
                title="Redo CAD board arrangement"
                aria-label="Redo board arrangement"
                className={`p-1 rounded-xs border transition-colors ${
                  atelierCtx.canRedoBoard
                    ? 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100 cursor-pointer'
                    : 'bg-neutral-100 text-neutral-400 border-neutral-200 cursor-not-allowed'
                }`}
              >
                <Redo2 className="w-3 h-3" />
              </button>

              <span className="text-neutral-300 mx-0.5" aria-hidden="true">|</span>

              <button
                type="button"
                aria-pressed={atelierCtx.snapConfig.enabled}
                data-testid="atelier-snap-toggle"
                onClick={() =>
                  atelierCtx.updateSnapConfig({ enabled: !atelierCtx.snapConfig.enabled })
                }
                title="Toggle centimeter grid & feature snapping (hold Alt while dragging to bypass)"
                className={`px-1.5 py-0.5 rounded-xs border text-[10px] font-mono inline-flex items-center gap-1 cursor-pointer transition-colors ${
                  atelierCtx.snapConfig.enabled
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-500 border-neutral-300 hover:text-neutral-900'
                }`}
              >
                <Magnet className="w-3 h-3" />
                <span>Snap</span>
              </button>
              <select
                aria-label="Snap grid interval in centimeters"
                data-testid="atelier-snap-interval"
                value={atelierCtx.snapConfig.gridIntervalCm}
                disabled={!atelierCtx.snapConfig.enabled}
                onChange={e =>
                  atelierCtx.updateSnapConfig({ gridIntervalCm: Number(e.target.value) })
                }
                className="h-6 px-1 bg-white border border-neutral-300 rounded-xs text-[10px] font-mono text-neutral-800 cursor-pointer disabled:opacity-50"
              >
                {SNAP_INTERVAL_OPTIONS_CM.map(v => (
                  <option key={v} value={v}>
                    {v} cm
                  </option>
                ))}
              </select>

              {selectedIds.length >= 2 && (
                <button
                  type="button"
                  onClick={() => atelierCtx.groupSelectedPieces()}
                  data-testid="atelier-group-btn"
                  title="Group selected pieces (Ctrl/Cmd+G)"
                  className="px-1.5 py-0.5 rounded-xs border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 text-[10px] font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>Group</span>
                </button>
              )}
              {hasGroupedInSelection && (
                <button
                  type="button"
                  onClick={atelierCtx.ungroupSelectedPieces}
                  data-testid="atelier-ungroup-btn"
                  title="Ungroup selected pieces (Ctrl/Cmd+Shift+G)"
                  className="px-1.5 py-0.5 rounded-xs border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 text-[10px] font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <Ungroup className="w-3 h-3" />
                  <span>Ungroup</span>
                </button>
              )}
            </div>
          )}

          {/* Inline Bodice Drafting Controls */}
          {currentSpec.garmentCategory === 'bodice' && effectiveViewMode !== 'simulation' && (
            <div className="flex items-center gap-1.5 border-l border-neutral-300 pl-2">
              <label className="inline-flex items-center gap-1 text-neutral-600">
                <span className="hidden xl:inline">Dart</span>
                <select
                  aria-label="Bodice Dart Style"
                  data-testid="bodice-dart-select"
                  value={bodiceDartStyle}
                  onChange={e => setBodiceDartStyle(e.target.value as BodiceDartStyle)}
                  className="h-6 px-1.5 bg-white border border-neutral-300 rounded-xs text-[11px] text-neutral-900 font-medium cursor-pointer"
                >
                  <option value="waist">Waist Dart</option>
                  <option value="princess">Princess Seam</option>
                  <option value="french">French Dart</option>
                </select>
              </label>

              <label className="inline-flex items-center gap-1 text-neutral-600">
                <span className="hidden xl:inline">Sleeve</span>
                <select
                  aria-label="Sleeve Ease Strategy"
                  data-testid="sleeve-ease-select"
                  value={sleeveEaseStrategy}
                  onChange={e => setSleeveEaseStrategy(e.target.value as SleeveEaseStrategy)}
                  className="h-6 px-1.5 bg-white border border-neutral-300 rounded-xs text-[11px] text-neutral-900 font-medium cursor-pointer"
                >
                  <option value="classic">Classic Cap</option>
                  <option value="fitted">Fitted Cap</option>
                  <option value="flat">Flat / Low Cap</option>
                </select>
              </label>
            </div>
          )}

          {/* Contextual Display Layer Toggles in Pieces Mode */}
          {effectiveViewMode === 'pieces' && (
            <div
              className="flex items-center gap-1 border-l border-neutral-300 pl-2"
              aria-label="Drafting Layers"
            >
              {LAYER_TOGGLE_ITEMS.map(item => {
                const active = layerVisibility[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={active}
                    title={item.title}
                    data-testid={`layer-toggle-${item.key}`}
                    onClick={() => toggleLayerVisibility(item.key)}
                    className={`px-1.5 py-0.5 rounded-xs border text-[10px] font-mono cursor-pointer transition-colors ${
                      active
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-500 border-neutral-300 hover:text-neutral-900'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Assembly Diagnostic Scenario Toggle */}
          {effectiveViewMode === 'assembly' && (
            <div className="flex items-center gap-1 border-l border-neutral-300 pl-2">
              <button
                type="button"
                onClick={() => setAssemblyScenario('active-draft')}
                className={`px-2 py-0.5 rounded-xs border text-[10px] font-medium cursor-pointer ${
                  assemblyScenario === 'active-draft'
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-600 border-neutral-300'
                }`}
              >
                Active Draft
              </button>
              <button
                type="button"
                onClick={() => setAssemblyScenario('incompatible-xs-flat')}
                className={`px-2 py-0.5 rounded-xs border text-[10px] font-medium cursor-pointer ${
                  assemblyScenario === 'incompatible-xs-flat'
                    ? 'bg-rose-700 text-white border-rose-700'
                    : 'bg-white text-neutral-600 border-neutral-300 hover:border-rose-300'
                }`}
              >
                Mismatch Test (XS Flat)
              </button>
            </div>
          )}

          {/* Fit Mode Prototype Switcher */}
          {effectiveViewMode === 'fit' && (
            <div className="flex items-center gap-1 border-l border-neutral-300 pl-2">
              <button
                type="button"
                onClick={() => setSelectedPrototypeId('PROTO-BOD-2026-M-01')}
                className={`px-2 py-0.5 rounded-xs border text-[10px] font-medium cursor-pointer ${
                  selectedPrototypeId === 'PROTO-BOD-2026-M-01'
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-600 border-neutral-300'
                }`}
              >
                Conforming Fixture
              </button>
              <button
                type="button"
                onClick={() => setSelectedPrototypeId('PROTO-BOD-2026-M-02')}
                className={`px-2 py-0.5 rounded-xs border text-[10px] font-medium cursor-pointer ${
                  selectedPrototypeId !== 'PROTO-BOD-2026-M-01'
                    ? 'bg-amber-700 text-white border-amber-700'
                    : 'bg-white text-neutral-600 border-neutral-300'
                }`}
              >
                Discrepant Fixture
              </button>
            </div>
          )}
        </div>

        {/* Right: Overlap advisory badge, draft status, Measurements & Production shortcuts */}
        <div className="flex items-center gap-2 shrink-0">
          {effectiveViewMode === 'pieces' && overlapCount > 0 && (
            <span
              data-testid="subbar-overlap-advisory"
              className="inline-flex items-center gap-1 font-mono text-[10px] text-rose-800 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-xs"
              title="Advisory visual board overlap detected — see inspector for details"
            >
              <AlertTriangle className="w-3 h-3" />
              {overlapCount} Overlap Adv.
            </span>
          )}

          {validationReport && (() => {
            const noticeCount = validationReport.checks.filter(c => c.status !== 'pass').length;
            return (
              <span
                className={`hidden md:inline-flex items-center gap-1 font-mono text-[10px] ${
                  validationReport.isValid ? 'text-emerald-800' : 'text-amber-800'
                }`}
                title={`Draft validation: ${noticeCount} notice(s)`}
              >
                {validationReport.isValid ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <AlertTriangle className="w-3 h-3" />
                )}
                {validationReport.isValid ? 'Draft OK' : `${noticeCount} Issue(s)`}
              </span>
            );
          })()}

          <button
            type="button"
            onClick={onNavigateToMeasurements}
            className="px-2 py-0.5 bg-white hover:bg-neutral-100 border border-neutral-300 rounded-xs text-[11px] font-medium text-neutral-800 cursor-pointer transition-colors"
          >
            Measurements
          </button>

          <button
            type="button"
            onClick={onNavigateToProduction}
            className="px-2 py-0.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xs text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>Production</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Assembly Error Notice (fail-closed) */}
      {effectiveViewMode === 'assembly' && assemblyError && (
        <div
          role="alert"
          className="px-3 py-1.5 bg-rose-50 border-b border-rose-200 text-[11px] text-rose-900 flex items-center gap-2 shrink-0"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Assembly evaluation failed closed: {assemblyError}</span>
        </div>
      )}

      {/* Dominant Center Viewport Surface */}
      {effectiveViewMode === 'simulation' ? (
        <div
          data-testid="pattern-atelier-simulation-stage"
          className="flex-1 min-h-0 overflow-y-auto px-4 lg:px-6 py-4"
        >
          <div className="max-w-6xl mx-auto">
            <SimulationFitPanel
              currentSpec={currentSpec}
              measurements={measurements}
              pieces={pieces}
              assemblyResult={assemblyResult}
              approvedPatternRevisionId={liveSnapshot?.revisionId}
              bodiceDartStyle={bodiceDartStyle}
              sleeveEaseStrategy={sleeveEaseStrategy}
              onApplyOptimizationProposal={proposal => {
                if (proposal.proposedDesignSpec.sleeveEaseStrategy) {
                  setSleeveEaseStrategy(proposal.proposedDesignSpec.sleeveEaseStrategy);
                }
                onUpdateSpec?.(proposal.proposedDesignSpec);
              }}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex relative overflow-hidden">
            {atelierCtx && effectiveViewMode === 'pieces' && (
              <PatternLayersDrawer
                isCadSupported={isCadSupported}
                garmentCategory={currentSpec.garmentCategory}
                onSyncPrimaryPiece={setSelectedPieceId}
              />
            )}

            <PatternCadCanvas
              artifact={renderArtifact}
              activeSize={activeSize}
              effectiveViewMode={effectiveViewMode}
              selectedPieceId={selectedPiece?.id ?? null}
              onSelectPieceId={setSelectedPieceId}
              activeTool={activeTool}
              showGrid={showGrid}
              layerVisibility={layerVisibility}
              camera={camera}
              onChangeCamera={setCamera}
              fitRequestVersion={fitRequestVersion}
              cursorCm={cursorCm}
              onChangeCursorCm={setCursorCm}
              assemblyResult={assemblyResult}
              gradedPatternSet={gradedPatternSet ?? undefined}
              enabledGradingSizes={enabledGradingSizes}
              activePrototypeRecord={activePrototypeRecord}
              activePrototypeReport={activePrototypeReport}
              layoutResetKey={layoutResetKey}
              boardState={atelierCtx?.boardState}
              overlapAdvisories={atelierCtx?.overlapAdvisories}
              snapConfig={atelierCtx?.snapConfig}
              activeSnapGuides={atelierCtx?.activeSnapGuides}
              onSetActiveSnapGuides={atelierCtx?.setActiveSnapGuides}
              onSelectBoardPiece={atelierCtx?.selectPiece}
              onToggleBoardPiece={atelierCtx?.toggleSelectPiece}
              onSelectMarqueeRect={atelierCtx?.selectMarqueeRect}
              onClearBoardSelection={atelierCtx?.clearPieceSelection}
              onCommitMovePieces={atelierCtx?.commitMovePieces}
              onUndoBoard={atelierCtx?.undoBoard}
              onRedoBoard={atelierCtx?.redoBoard}
              onGroupSelected={atelierCtx?.groupSelectedPieces}
              onUngroupSelected={atelierCtx?.ungroupSelectedPieces}
            />
          </div>

          <PatternAtelierStatusBar
            camera={camera}
            cursorCm={cursorCm}
            yAxisDirection={renderArtifact.coordinateFrame.yAxisDirection}
            authorityTier={renderArtifact.authorityTier}
            isProductionReady={renderArtifact.isProductionReady}
            selectedPieceLabel={
              selectedPiece ? `${selectedPiece.pieceCode} · ${selectedPiece.name}` : null
            }
            selectedPieceCount={selectedIds.length}
            snapConfig={atelierCtx?.snapConfig}
            activeSnapCount={atelierCtx?.activeSnapGuides.length ?? 0}
            onZoomIn={() => handleZoomStep(1.2)}
            onZoomOut={() => handleZoomStep(1 / 1.2)}
            onFitAll={requestFitAll}
            onReset100={resetCameraTo100}
          />
        </>
      )}
    </div>
  );
};
