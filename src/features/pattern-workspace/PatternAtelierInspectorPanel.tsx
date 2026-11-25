/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Crosshair,
  Eye,
  EyeOff,
  FolderPlus,
  Layers,
  Scissors,
  Sliders,
  Ungroup,
  X
} from 'lucide-react';
import { useProjectWorkspace } from '../../state/ProjectWorkspaceContext';
import { useViewportInteraction } from '../../state/ViewportInteractionContext';
import { useOptionalPatternAtelierView } from './PatternAtelierViewContext';
import type { OverlapClassification } from './board-arrangement';
import type { CadInspectableEntity } from './entity-hit-test';
import { AssemblyInspectionPanel } from './AssemblyInspectionPanel';
import { draftSleeveBlock } from '../../engine/drafting/sleeve-block';
import { assembleBodiceSleeve, formatSignedCm } from '../../engine/assembly';
import { DEFAULT_SIZE_RANGE } from '../../engine/grading';
import { STANDARD_SIZING_SYSTEM } from '../../engine/measurements/standards';
import {
  SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
  SYNTHETIC_TEST_PROTOTYPE_DISCREPANT
} from '../../engine/prototype/prototype-fixtures';
import { validatePhysicalFit } from '../../engine/prototype/fit-validator';
import {
  DEFAULT_ILLUSTRATIVE_FABRIC,
  getEnhancedFabricById
} from '../../engine/fabric/fabric-presets';
import {
  calculateCompleteGarmentEase,
  calculateFabricAdaptedSleeveCapEase
} from '../../engine/fabric/ease-engine';

const SIZE_STROKE: Record<string, string> = {
  XS: '#9333ea',
  S: '#2563eb',
  M: '#16a34a',
  L: '#d97706',
  XL: '#dc2626',
  XXL: '#7c3aed'
};

const OVERLAP_META: Record<
  OverlapClassification,
  { label: string; badgeClass: string; borderClass: string }
> = {
  'unintentional-overlap': {
    label: 'Unintentional Overlap',
    badgeClass: 'text-rose-800 bg-rose-100',
    borderClass: 'border-rose-200 bg-rose-50/60'
  },
  containment: {
    label: 'Containment',
    badgeClass: 'text-rose-800 bg-rose-100',
    borderClass: 'border-rose-200 bg-rose-50/60'
  },
  'touching-boundaries': {
    label: 'Touching Boundaries',
    badgeClass: 'text-amber-800 bg-amber-100',
    borderClass: 'border-amber-200 bg-amber-50/50'
  },
  'intentional-overlap': {
    label: 'Intentional Overlap',
    badgeClass: 'text-sky-800 bg-sky-100',
    borderClass: 'border-sky-200 bg-sky-50/50'
  },
  unresolved: {
    label: 'Unresolved',
    badgeClass: 'text-neutral-700 bg-neutral-200',
    borderClass: 'border-neutral-300 bg-neutral-100/70'
  }
};

function formatUnroundedCm(value: number): string {
  if (!Number.isFinite(value)) return 'NaN';
  return Object.is(value, -0) ? '0' : String(value);
}

function getEntityKindDisplayLabel(entity: CadInspectableEntity): string {
  switch (entity.entityKind) {
    case 'vertex':
      return entity.isSharedJunction ? 'Shared Contour Vertex' : 'Contour Vertex';
    case 'bezier-handle':
      return `Bézier Control Handle (${entity.handleSlot.toUpperCase()})`;
    case 'edge':
      return 'Straight Edge Segment';
    case 'curve':
      return 'Cubic Bézier Curve';
    case 'notch':
      return 'Pattern Notch';
    case 'dart':
      return 'Dart Path';
    case 'dart-landmark':
      return `Dart Landmark (${entity.landmarkRole})`;
  }
}

/**
 * UX-2.3.1 / UX-2.3.2 / UX-2.3.3.1 — Consolidated Right Inspector Panel for Pattern Atelier.
 *
 * Mounted inside `ContextualInspector` when `activeEnvironment === 'pattern-atelier'`,
 * replacing the duplicated embedded `lg:col-span-4` column previously inside `PatternWorkspace.tsx`.
 */
export const PatternAtelierInspectorPanel: React.FC = () => {
  const {
    currentSpec,
    measurements,
    measurementProvenance,
    measurementApprovalState,
    workspaceBundle,
    sleeveEaseStrategy,
    strictUncertaintyGate,
    setStrictUncertaintyGate,
    requireApprovedGovernance,
    setRequireApprovedGovernance
  } = useProjectWorkspace();

  const { selectedEntity, selectEntity, openDockTab, activeTool } = useViewportInteraction();
  const atelier = useOptionalPatternAtelierView();

  const {
    isCadSupported,
    pieces,
    sleeveDiagnostics: sleeveDiag,
    assemblyResult: authoritativeAssemblyResult,
    draftValidation: validationReport,
    gradedPatternSet
  } = workspaceBundle;

  const cadViewMode = atelier?.cadViewMode ?? 'pieces';
  const assemblyScenario = atelier?.assemblyScenario ?? 'active-draft';
  const selectedPrototypeId = atelier?.selectedPrototypeId ?? 'PROTO-BOD-2026-M-01';
  const enabledGradingSizes = atelier?.enabledGradingSizes ?? {
    XS: true,
    S: true,
    M: true,
    L: true,
    XL: true,
    XXL: true
  };

  const effectiveViewMode =
    (currentSpec.garmentCategory !== 'bodice' ||
      (cadViewMode === 'grading' && !gradedPatternSet)) &&
    cadViewMode !== 'pieces' &&
    cadViewMode !== 'simulation'
      ? 'pieces'
      : cadViewMode;

  const boardSelectedIds = atelier?.boardState.selectedPieceIds ?? [];
  const isMultiBoardSelection = boardSelectedIds.length >= 2;
  const primaryBoardSelectedId = boardSelectedIds.length === 1 ? boardSelectedIds[0] : null;

  const selectedPieceId =
    selectedEntity?.kind === 'seam'
      ? selectedEntity.pieceId
      : primaryBoardSelectedId ??
        (selectedEntity?.kind === 'pattern-piece' ? selectedEntity.pieceId : pieces[0]?.id ?? null);

  const selectedPiece = pieces.find(p => p.id === selectedPieceId) ?? pieces[0];
  const activeArtifact = atelier?.activeArtifact ?? null;
  const inspectedEntity = atelier?.inspectedEntity ?? null;
  const selectedArtifactPiece =
    activeArtifact && selectedPiece
      ? activeArtifact.pieces.find(p => p.pieceId === selectedPiece.id) ?? null
      : null;
  const selectedPlacement =
    selectedPiece && atelier
      ? atelier.boardState.placementsByPieceId[selectedPiece.id] ?? null
      : null;

  const selectedGroup =
    selectedPlacement?.groupId && atelier
      ? atelier.boardState.groupsById[selectedPlacement.groupId] ?? null
      : null;

  const hasGroupedSelection = useMemo(() => {
    if (!atelier) return false;
    return boardSelectedIds.some(id => Boolean(atelier.boardState.placementsByPieceId[id]?.groupId));
  }, [atelier, boardSelectedIds]);

  const [draftBoardX, setDraftBoardX] = useState<string>('');
  const [draftBoardY, setDraftBoardY] = useState<string>('');

  useEffect(() => {
    if (selectedPlacement) {
      setDraftBoardX(selectedPlacement.offsetXCm.toFixed(2));
      setDraftBoardY(selectedPlacement.offsetYCm.toFixed(2));
    }
  }, [selectedPlacement?.pieceId, selectedPlacement?.offsetXCm, selectedPlacement?.offsetYCm]);

  const commitBoardCoordinate = (axis: 'x' | 'y', rawValue: string) => {
    if (!atelier || !selectedPlacement) return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setDraftBoardX(selectedPlacement.offsetXCm.toFixed(2));
      setDraftBoardY(selectedPlacement.offsetYCm.toFixed(2));
      return;
    }
    const nextX = axis === 'x' ? parsed : selectedPlacement.offsetXCm;
    const nextY = axis === 'y' ? parsed : selectedPlacement.offsetYCm;
    atelier.setPiecePositionCm(selectedPlacement.pieceId, nextX, nextY);
  };

  const { assemblyResult, assemblyError } = useMemo(() => {
    if (
      currentSpec.garmentCategory === 'bodice' &&
      pieces.length >= 2 &&
      assemblyScenario === 'incompatible-xs-flat'
    ) {
      try {
        const targetSleeve = draftSleeveBlock(STANDARD_SIZING_SYSTEM.sizes.XS, currentSpec, {
          strategy: 'flat'
        }).piece;
        return {
          assemblyResult: assembleBodiceSleeve({
            bodicePieces: pieces.slice(0, 2),
            sleevePiece: targetSleeve,
            designSpec: currentSpec,
            measurements,
            options: {
              strategy: sleeveEaseStrategy,
              strictUncertaintyGate,
              measurementProvenance,
              measurementApprovalState,
              requireApprovedGovernance
            }
          }),
          assemblyError: undefined
        };
      } catch (err) {
        return {
          assemblyResult: undefined,
          assemblyError: err instanceof Error ? err.message : String(err)
        };
      }
    }
    return { assemblyResult: authoritativeAssemblyResult, assemblyError: undefined };
  }, [
    currentSpec,
    pieces,
    assemblyScenario,
    measurements,
    sleeveEaseStrategy,
    strictUncertaintyGate,
    measurementProvenance,
    measurementApprovalState,
    requireApprovedGovernance,
    authoritativeAssemblyResult
  ]);

  const activePrototypeRecord = useMemo(
    () =>
      selectedPrototypeId === 'PROTO-BOD-2026-M-01' ||
      selectedPrototypeId === 'SYNTH-PROTO-BOD-M-CONFORMING'
        ? SYNTHETIC_TEST_PROTOTYPE_CONFORMING
        : SYNTHETIC_TEST_PROTOTYPE_DISCREPANT,
    [selectedPrototypeId]
  );

  const activePrototypeReport = useMemo(
    () => validatePhysicalFit(activePrototypeRecord),
    [activePrototypeRecord]
  );

  const workspaceFabric = useMemo(() => {
    const lookup = getEnhancedFabricById(currentSpec.fabric.id);
    return lookup.status === 'found' ? lookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;
  }, [currentSpec.fabric.id]);

  const workspaceFabricEase = useMemo(
    () =>
      calculateCompleteGarmentEase(measurements, currentSpec.easeProfile, workspaceFabric, {
        silhouette: currentSpec.silhouette,
        allowanceForShrinkage: true,
        userExplicitConsentToDefaultFabric: true,
        explicitEaseCm: currentSpec.explicitEaseCm
      }),
    [measurements, currentSpec.easeProfile, workspaceFabric, currentSpec.silhouette, currentSpec.explicitEaseCm]
  );

  const workspaceAdaptedSleeveEase = useMemo(
    () =>
      calculateFabricAdaptedSleeveCapEase(sleeveEaseStrategy, workspaceFabric, {
        userExplicitConsentToDefaultFabric: true
      }),
    [sleeveEaseStrategy, workspaceFabric]
  );

  if (!isCadSupported) {
    return (
      <section className="space-y-2.5" data-testid="inspector-atelier-unsupported">
        <h3 className="text-[11px] font-semibold text-neutral-500">Category Gate</h3>
        <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xs px-2.5 py-2 leading-relaxed">
          Deterministic CAD block unavailable for <strong>{currentSpec.garmentCategory}</strong>.
          Patroner fails closed without substituting another block.
        </p>
      </section>
    );
  }

  if (effectiveViewMode === 'assembly') {
    return (
      <div className="space-y-3" data-testid="inspector-atelier-assembly">
        <AssemblyInspectionPanel
          assemblyResult={assemblyResult}
          assemblyError={assemblyError}
          scenario={assemblyScenario}
          onChangeScenario={next => atelier?.setAssemblyScenario(next)}
          requireApprovedGovernance={requireApprovedGovernance}
          onToggleRequireApprovedGovernance={setRequireApprovedGovernance}
          strictUncertaintyGate={strictUncertaintyGate}
          onToggleStrictUncertaintyGate={setStrictUncertaintyGate}
          onNavigateToMeasurements={() => openDockTab('sizing-ease')}
        />
      </div>
    );
  }

  if (effectiveViewMode === 'grading' && gradedPatternSet) {
    return (
      <div className="space-y-4 text-xs" data-testid="inspector-atelier-grading">
        <section className="space-y-2.5">
          <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
            <div>
              <h3 className="text-xs font-semibold text-neutral-900">Cross-Size Grading Suite</h3>
              <p className="text-[11px] text-neutral-500">
                Base {gradedPatternSet.baseSize} · Direct regeneration · isProductionReady: false
              </p>
            </div>
            <span
              className={`font-mono text-[10px] font-semibold ${
                gradedPatternSet.isAllValid ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {gradedPatternSet.isAllValid ? '6/6 Valid' : 'Flagged'}
            </span>
          </div>

          <div className="space-y-1">
            {DEFAULT_SIZE_RANGE.map(sz => {
              const szRes = gradedPatternSet.sizeResults[sz];
              const isEnabled = enabledGradingSizes[sz];
              const totalEase = szRes?.assemblyResult?.ease.totalEaseCm;
              return (
                <button
                  key={sz}
                  type="button"
                  onClick={() => atelier?.toggleGradingSize(sz)}
                  className={`w-full px-2 py-1.5 rounded-xs border text-left flex items-center justify-between transition-colors cursor-pointer ${
                    isEnabled
                      ? 'bg-white border-neutral-300 text-neutral-900'
                      : 'bg-neutral-50 border-neutral-200 text-neutral-400'
                  }`}
                >
                  <span className="flex items-center gap-2 font-mono tabular-nums">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: SIZE_STROKE[sz] ?? '#18181b' }}
                    />
                    <span className="font-semibold">{sz}</span>
                    <span className="text-[10px] text-neutral-500">
                      Bust {szRes?.measurements.bust} cm
                      {totalEase !== undefined ? ` · ${formatSignedCm(totalEase)}` : ''}
                    </span>
                  </span>
                  <span
                    className={`font-mono text-[10px] font-semibold ${
                      szRes?.isValid ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {szRes?.isValid ? 'Valid' : 'Invalid'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="pt-3 border-t border-neutral-200 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold text-neutral-500">Continuity Checks</h4>
            <span
              className={`font-mono text-[10px] font-semibold ${
                gradedPatternSet.integrityReport.isOverallGradingValid
                  ? 'text-emerald-700'
                  : 'text-rose-700'
              }`}
            >
              {gradedPatternSet.integrityReport.isOverallGradingValid ? 'Passed' : 'Failed'}
            </span>
          </div>
          {gradedPatternSet.integrityReport.checks.slice(0, 6).map(chk => (
            <div
              key={chk.id}
              className="py-1.5 border-b border-neutral-100 last:border-b-0 space-y-0.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-neutral-800">{chk.name}</span>
                <span
                  className={`font-mono text-[10px] font-semibold ${
                    chk.status === 'pass' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {chk.status}
                </span>
              </div>
              <p className="text-[11px] text-neutral-600">{chk.message}</p>
            </div>
          ))}
        </section>
      </div>
    );
  }

  if (effectiveViewMode === 'fit') {
    return (
      <div className="space-y-4 text-xs" data-testid="inspector-atelier-fit">
        <section className="space-y-2">
          <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
            <div>
              <h3 className="text-xs font-semibold text-neutral-900">Physical Fit Evidence</h3>
              <p className="text-[11px] text-neutral-500">
                Synthetic benchmark · isProductionReady: false
              </p>
            </div>
            <span
              className={`font-mono text-[10px] font-semibold ${
                activePrototypeReport.overallFitStatus === 'conforming'
                  ? 'text-emerald-700'
                  : 'text-rose-700'
              }`}
            >
              {activePrototypeReport.passCount}/{activePrototypeReport.evaluatedPointsCount} Pass
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => atelier?.setSelectedPrototypeId('PROTO-BOD-2026-M-01')}
              className={`px-2 py-1.5 rounded-xs border text-[11px] font-medium cursor-pointer ${
                selectedPrototypeId === 'PROTO-BOD-2026-M-01'
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              Conforming Fixture
            </button>
            <button
              type="button"
              onClick={() => atelier?.setSelectedPrototypeId('PROTO-BOD-2026-M-DISCREPANT')}
              className={`px-2 py-1.5 rounded-xs border text-[11px] font-medium cursor-pointer ${
                selectedPrototypeId === 'PROTO-BOD-2026-M-DISCREPANT'
                  ? 'bg-rose-900 text-white border-rose-900'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              Discrepant Fixture
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-y-1.5 gap-x-2 pt-1 text-[11px] font-mono tabular-nums">
            <div>
              <dt className="text-neutral-500 font-sans">Max Delta</dt>
              <dd className="font-semibold text-neutral-900">
                {activePrototypeReport.maxAbsoluteDiscrepancyCm.toFixed(2)} cm
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 font-sans">Fabric Ease</dt>
              <dd className="font-semibold text-neutral-900">
                +{workspaceAdaptedSleeveEase.adaptedCapEaseCm.toFixed(2)} cm
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 font-sans">Material</dt>
              <dd className="font-sans text-neutral-900 truncate">{workspaceFabric.name}</dd>
            </div>
            <div>
              <dt className="text-neutral-500 font-sans">Waist Pre-Shrink</dt>
              <dd className="font-semibold text-neutral-900">
                {workspaceFabricEase.waist.isCalculationAvailable
                  ? `${workspaceFabricEase.waist.preShrinkCuttingDimensionCm.toFixed(1)} cm`
                  : 'N/A'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="pt-3 border-t border-neutral-200 space-y-1.5">
          <h4 className="text-[11px] font-semibold text-neutral-500">Measurement Checkpoints</h4>
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {activePrototypeReport.measurements.map(pt => (
              <div
                key={pt.pointId}
                className="flex items-center justify-between py-1 border-b border-neutral-100 last:border-b-0 text-[11px]"
              >
                <span className="text-neutral-800 truncate pr-2">{pt.label}</span>
                <span
                  className={`font-mono tabular-nums font-semibold shrink-0 ${
                    pt.status === 'pass'
                      ? 'text-emerald-700'
                      : pt.status === 'warning'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                  }`}
                >
                  {pt.deltaCm > 0 ? '+' : ''}
                  {pt.deltaCm.toFixed(2)} cm
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  // Default: Pieces Mode — Entity Inspection, Board Placement, Piece Summary, Overlap Advisories & Validation Engine
  return (
    <div className="space-y-4 text-xs" data-testid="inspector-atelier-pieces">
      {/* UX-2.3.3.1: Read-Only Geometric Entity Inspection Card */}
      {atelier && inspectedEntity && activeArtifact && (
        <section
          className="pb-3.5 border-b border-teal-200/90 space-y-2.5 bg-teal-50/35 -mx-3.5 px-3.5 pt-2.5 -mt-2.5"
          data-testid="inspector-cad-entity"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-teal-900 font-semibold">
                <Crosshair className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <span className="truncate" data-testid="inspector-entity-type">
                  {getEntityKindDisplayLabel(inspectedEntity)}
                </span>
              </div>
              <p className="text-[10px] text-teal-800/80 mt-0.5">
                Read-only entity inspection · Zero source mutation
              </p>
            </div>
            <button
              type="button"
              onClick={atelier.clearInspectedEntity}
              aria-label="Clear inspected entity"
              data-testid="inspector-clear-entity-btn"
              className="p-1 rounded-xs text-teal-800 hover:bg-teal-100 cursor-pointer shrink-0"
              title="Clear inspected entity (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Presentation Reference (Explicitly Non-Authoritative) */}
          <div className="space-y-1 bg-white border border-teal-200/80 rounded-xs p-2">
            <span className="text-[10px] font-medium text-neutral-500 block">
              Presentation Reference (Non-Authoritative)
            </span>
            <code
              data-testid="inspector-entity-ref"
              className="block font-mono text-[10px] text-neutral-900 break-all leading-snug"
            >
              {inspectedEntity.presentationRef}
            </code>
            <p className="text-[10px] text-amber-800 leading-snug">
              Presentation address only — NOT an authoritative engineering vertex ID.
            </p>
          </div>

          {/* Parent Piece & Topology Identity */}
          <dl className="space-y-1.5 text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-neutral-500 shrink-0">Parent Piece</dt>
              <dd
                data-testid="inspector-entity-piece"
                className="font-medium text-neutral-900 text-right truncate"
                title={`${inspectedEntity.pieceCode} · ${inspectedEntity.pieceName} (${inspectedEntity.pieceId})`}
              >
                {inspectedEntity.pieceCode} · {inspectedEntity.pieceName}
              </dd>
            </div>

            <div data-testid="inspector-entity-topology" className="space-y-1 pt-1 border-t border-teal-100">
              {'contour' in inspectedEntity && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-neutral-500">Contour / Segment</dt>
                  <dd className="font-mono text-[10px] text-neutral-900 text-right break-all">
                    {inspectedEntity.contour} · {inspectedEntity.segmentId}
                  </dd>
                </div>
              )}

              {inspectedEntity.entityKind === 'vertex' && (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Endpoint Slot</dt>
                    <dd className="font-mono text-[10px] text-neutral-900">
                      {inspectedEntity.endpointSlot}
                      {inspectedEntity.isSharedJunction ? ' (deduplicated junction)' : ''}
                    </dd>
                  </div>
                  <div className="pt-1 space-y-1">
                    <dt className="text-[10px] text-neutral-500">
                      Incident Segments ({inspectedEntity.incidentSegments.length})
                    </dt>
                    <dd className="space-y-1">
                      {inspectedEntity.incidentSegments.map((inc, idx) => (
                        <div
                          key={`${inc.direction}-${inc.segmentId}-${idx}`}
                          className="px-1.5 py-1 rounded-xs bg-white border border-neutral-200 font-mono text-[10px] text-neutral-800 flex items-center justify-between gap-1.5"
                        >
                          <span className="truncate">
                            {inc.direction === 'incoming' ? 'in' : 'out'}: {inc.segmentId}
                          </span>
                          <span className="text-neutral-500 shrink-0">
                            {inc.segmentKind === 'cubic-bezier' ? 'cubic' : 'line'} · {inc.endpointSlot}
                          </span>
                        </div>
                      ))}
                    </dd>
                  </div>
                </>
              )}

              {(inspectedEntity.entityKind === 'edge' || inspectedEntity.entityKind === 'curve') && (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Segment Kind / Role</dt>
                    <dd className="font-mono text-[10px] text-neutral-900">
                      {inspectedEntity.segmentKind} · {inspectedEntity.segmentRole}
                    </dd>
                  </div>
                  {inspectedEntity.seamId && (
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-neutral-500">Seam ID</dt>
                      <dd className="font-mono text-[10px] text-neutral-900 truncate">
                        {inspectedEntity.seamId}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Sample Parameter t</dt>
                    <dd className="font-mono tabular-nums text-[10px] text-neutral-900">
                      {inspectedEntity.parameterT.toFixed(4)}
                    </dd>
                  </div>
                </>
              )}

              {inspectedEntity.entityKind === 'bezier-handle' && (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Handle / Role</dt>
                    <dd className="font-mono text-[10px] text-neutral-900">
                      {inspectedEntity.handleSlot.toUpperCase()} · {inspectedEntity.segmentRole}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Anchor (Local cm)</dt>
                    <dd className="font-mono tabular-nums text-[10px] text-neutral-900">
                      ({formatUnroundedCm(inspectedEntity.anchorLocalCm.x)},{' '}
                      {formatUnroundedCm(inspectedEntity.anchorLocalCm.y)})
                    </dd>
                  </div>
                </>
              )}

              {inspectedEntity.entityKind === 'notch' && (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Notch ID / Type</dt>
                    <dd className="font-mono text-[10px] text-neutral-900">
                      {inspectedEntity.notchId} · {inspectedEntity.notchType}
                    </dd>
                  </div>
                  {inspectedEntity.linkedSegmentId && (
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-neutral-500">Linked Segment</dt>
                      <dd className="font-mono text-[10px] text-neutral-900">
                        {inspectedEntity.linkedSegmentId}
                      </dd>
                    </div>
                  )}
                </>
              )}

              {inspectedEntity.entityKind === 'dart' && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-neutral-500">Dart ID</dt>
                  <dd className="font-mono text-[10px] text-neutral-900">
                    {inspectedEntity.dartId} (source intake {inspectedEntity.widthCm} cm)
                  </dd>
                </div>
              )}

              {inspectedEntity.entityKind === 'dart-landmark' && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-neutral-500">Dart / Landmark</dt>
                  <dd className="font-mono text-[10px] text-neutral-900">
                    {inspectedEntity.dartId} · {inspectedEntity.landmarkRole}
                  </dd>
                </div>
              )}
            </div>
          </dl>

          {/* Optional Bézier Control Polygon Toggle */}
          {(inspectedEntity.entityKind === 'curve' ||
            inspectedEntity.entityKind === 'bezier-handle') && (
            <div className="space-y-1.5 pt-1 border-t border-teal-100">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-neutral-600">
                  Bézier Control Polygon
                </span>
                <button
                  type="button"
                  data-testid="inspector-toggle-control-polygon"
                  aria-pressed={atelier.showControlPolygon}
                  onClick={() => atelier.setShowControlPolygon(!atelier.showControlPolygon)}
                  className={`px-2 py-0.5 rounded-xs border text-[10px] font-mono cursor-pointer transition-colors ${
                    atelier.showControlPolygon
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  {atelier.showControlPolygon ? 'Visible' : 'Hidden'}
                </button>
              </div>
              {inspectedEntity.entityKind === 'curve' && (
                <div className="grid grid-cols-2 gap-1 font-mono text-[10px] text-neutral-700 bg-white border border-neutral-200 rounded-xs p-1.5">
                  <div>
                    P0: ({formatUnroundedCm(inspectedEntity.p0LocalCm.x)},{' '}
                    {formatUnroundedCm(inspectedEntity.p0LocalCm.y)})
                  </div>
                  <div>
                    P1: ({formatUnroundedCm(inspectedEntity.p1LocalCm.x)},{' '}
                    {formatUnroundedCm(inspectedEntity.p1LocalCm.y)})
                  </div>
                  <div>
                    P2: ({formatUnroundedCm(inspectedEntity.p2LocalCm.x)},{' '}
                    {formatUnroundedCm(inspectedEntity.p2LocalCm.y)})
                  </div>
                  <div>
                    P3: ({formatUnroundedCm(inspectedEntity.p3LocalCm.x)},{' '}
                    {formatUnroundedCm(inspectedEntity.p3LocalCm.y)})
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Unrounded Piece-Local Coordinates (cm) */}
          <div
            data-testid="inspector-entity-local-coords"
            className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1"
          >
            <span className="text-[10px] font-semibold text-neutral-600 block">
              Piece-Local Coordinates (cm · Unrounded Source)
            </span>
            <div className="space-y-0.5 font-mono tabular-nums text-[10.5px] text-neutral-900">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-400 shrink-0">X</span>
                <span className="text-right truncate">
                  {formatUnroundedCm(inspectedEntity.localPointCm.x)} cm
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-400 shrink-0">Y</span>
                <span className="text-right truncate">
                  {formatUnroundedCm(inspectedEntity.localPointCm.y)} cm
                </span>
              </div>
            </div>
          </div>

          {/* Separate CAD Board Table Coordinates (cm) */}
          <div
            data-testid="inspector-entity-board-coords"
            className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1"
          >
            <span className="text-[10px] font-semibold text-neutral-600 block">
              CAD Board Table Coordinates (cm · Ephemeral Offset)
            </span>
            <div className="space-y-0.5 font-mono tabular-nums text-[10.5px] text-neutral-900">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-400 shrink-0">X</span>
                <span className="text-right truncate">
                  {formatUnroundedCm(inspectedEntity.boardPointCm.x)} cm
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-400 shrink-0">Y</span>
                <span className="text-right truncate">
                  {formatUnroundedCm(inspectedEntity.boardPointCm.y)} cm
                </span>
              </div>
            </div>
          </div>

          {/* Coordinate Frame, Authority Tier & Certification Disclosure */}
          <dl className="space-y-1 pt-1 border-t border-teal-200/70 text-[10px]">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-neutral-500 shrink-0">Coordinate Frame</dt>
              <dd
                data-testid="inspector-entity-coord-frame"
                className="font-mono text-neutral-900 text-right whitespace-nowrap"
              >
                {activeArtifact.coordinateFrame.yAxisDirection === 'cartesian-y-up'
                  ? `Cartesian Y-Up (${activeArtifact.coordinateFrame.exteriorWinding} · ${activeArtifact.coordinateFrame.geometryUnit})`
                  : `SVG Y-Down (${activeArtifact.coordinateFrame.exteriorWinding} · ${activeArtifact.coordinateFrame.geometryUnit})`}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-neutral-500">Artifact Authority</dt>
              <dd
                data-testid="inspector-entity-authority-tier"
                className="font-mono font-semibold text-neutral-900 text-right"
              >
                {activeArtifact.authorityTier}
              </dd>
            </div>
            <div
              data-testid="inspector-entity-certification"
              className="mt-1 p-1.5 rounded-xs bg-amber-50 border border-amber-200 text-amber-900 space-y-0.5 leading-snug"
            >
              <div className="font-medium">{activeArtifact.provenance.disclosureLabel}</div>
              <div className="font-mono text-[9.5px] text-amber-800">
                isCertified: {String(activeArtifact.isCertified)} · isProductionReady:{' '}
                {String(activeArtifact.isProductionReady)} · externalCadInteroperabilityVerified:{' '}
                {String(activeArtifact.externalCadInteroperabilityVerified)}
              </div>
            </div>
          </dl>
        </section>
      )}

      {/* Prompt when in Inspect Geometry mode with no entity clicked yet */}
      {atelier && !inspectedEntity && activeTool === 'inspect-entity' && (
        <section
          data-testid="inspector-cad-entity-prompt"
          className="pb-3 border-b border-teal-200/80 space-y-1"
        >
          <div className="flex items-center gap-1.5 text-teal-900 font-semibold text-[11px]">
            <Crosshair className="w-3.5 h-3.5 text-teal-700" />
            <span>Inspect Geometry Mode (Read-Only)</span>
          </div>
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            Hover and click any vertex, straight edge, cubic curve, control handle, notch, or dart
            on the canvas to inspect its unrounded coordinates and topology without moving pieces.
          </p>
        </section>
      )}

      {/* Seam selection summary if a seam is active */}
      {selectedEntity?.kind === 'seam' && (
        <section className="pb-3 border-b border-neutral-200 space-y-2" data-testid="inspector-seam">
          <div className="flex items-center gap-1.5 text-neutral-900 font-semibold">
            <Sliders className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <span className="truncate">{selectedEntity.label}</span>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="text-neutral-500">Measured Length</dt>
              <dd className="font-mono tabular-nums font-semibold text-neutral-900">
                {selectedEntity.lengthCm !== undefined ? `${selectedEntity.lengthCm} cm` : 'N/A'}
              </dd>
            </div>
            {selectedEntity.pairedSeamName && (
              <div>
                <dt className="text-neutral-500">Paired Seam</dt>
                <dd className="font-medium text-neutral-900 truncate">
                  {selectedEntity.pairedSeamName}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* UX-2.3.2: Multi-Selection CAD Board Arrangement Controls */}
      {atelier && isMultiBoardSelection && (
        <section
          className="pb-3.5 border-b border-neutral-200 space-y-3"
          data-testid="inspector-board-multi"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-neutral-700 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-neutral-500" />
              {boardSelectedIds.length} Pieces Selected
            </span>
            <button
              type="button"
              onClick={() => atelier.clearPieceSelection()}
              data-testid="inspector-clear-board-selection"
              className="text-[11px] text-neutral-600 hover:text-neutral-900 hover:underline cursor-pointer"
            >
              Clear
            </button>
          </div>

          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Visual board arrangement only — repositions pieces in CAD table cm without modifying
            original pattern contours.
          </p>

          {/* Align Controls */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium text-neutral-500 block">
              Align Selected Pieces
            </span>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => atelier.alignSelectedPieces('left')}
                title="Align Left Edges"
                aria-label="Align Left"
                data-testid="board-align-left"
                className="h-7 flex items-center justify-center gap-1 border border-neutral-200 rounded-xs hover:bg-neutral-100 text-[10px] font-medium text-neutral-700 cursor-pointer"
              >
                <AlignStartVertical className="w-3.5 h-3.5" />
                <span>L</span>
              </button>
              <button
                type="button"
                onClick={() => atelier.alignSelectedPieces('right')}
                title="Align Right Edges"
                aria-label="Align Right"
                data-testid="board-align-right"
                className="h-7 flex items-center justify-center gap-1 border border-neutral-200 rounded-xs hover:bg-neutral-100 text-[10px] font-medium text-neutral-700 cursor-pointer"
              >
                <AlignEndVertical className="w-3.5 h-3.5" />
                <span>R</span>
              </button>
              <button
                type="button"
                onClick={() => atelier.alignSelectedPieces('top')}
                title="Align Top Edges"
                aria-label="Align Top"
                data-testid="board-align-top"
                className="h-7 flex items-center justify-center gap-1 border border-neutral-200 rounded-xs hover:bg-neutral-100 text-[10px] font-medium text-neutral-700 cursor-pointer"
              >
                <AlignStartHorizontal className="w-3.5 h-3.5" />
                <span>T</span>
              </button>
              <button
                type="button"
                onClick={() => atelier.alignSelectedPieces('bottom')}
                title="Align Bottom Edges"
                aria-label="Align Bottom"
                data-testid="board-align-bottom"
                className="h-7 flex items-center justify-center gap-1 border border-neutral-200 rounded-xs hover:bg-neutral-100 text-[10px] font-medium text-neutral-700 cursor-pointer"
              >
                <AlignEndHorizontal className="w-3.5 h-3.5" />
                <span>B</span>
              </button>
            </div>
          </div>

          {/* Distribute Controls */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={boardSelectedIds.length < 3}
              onClick={() => atelier.distributeSelectedPieces('horizontal')}
              data-testid="board-distribute-horizontal"
              className="h-7 px-2 flex items-center justify-center gap-1.5 border border-neutral-200 rounded-xs text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <AlignHorizontalSpaceAround className="w-3.5 h-3.5" />
              Distribute H
            </button>
            <button
              type="button"
              disabled={boardSelectedIds.length < 3}
              onClick={() => atelier.distributeSelectedPieces('vertical')}
              data-testid="board-distribute-vertical"
              className="h-7 px-2 flex items-center justify-center gap-1.5 border border-neutral-200 rounded-xs text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <AlignVerticalSpaceAround className="w-3.5 h-3.5" />
              Distribute V
            </button>
          </div>

          {/* Group / Ungroup */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => atelier.groupSelectedPieces()}
              data-testid="inspector-group-btn"
              className="h-7 px-2.5 flex items-center justify-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xs text-[11px] font-medium cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Group
            </button>
            <button
              type="button"
              disabled={!hasGroupedSelection}
              onClick={() => atelier.ungroupSelectedPieces()}
              data-testid="inspector-ungroup-btn"
              className="h-7 px-2.5 flex items-center justify-center gap-1.5 border border-neutral-300 hover:bg-neutral-100 text-neutral-800 rounded-xs text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Ungroup className="w-3.5 h-3.5" />
              Ungroup
            </button>
          </div>

          {/* Selected Piece Members */}
          <ul className="space-y-1 pt-1 border-t border-neutral-100">
            {boardSelectedIds.map(id => {
              const p = pieces.find(piece => piece.id === id);
              if (!p) return null;
              const pl = atelier.boardState.placementsByPieceId[id];
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      atelier.selectPiece(id, { expandGroup: false });
                      selectEntity({
                        kind: 'pattern-piece',
                        id: p.id,
                        pieceId: p.id,
                        pieceCode: p.pieceCode,
                        label: p.name
                      });
                    }}
                    className="w-full px-2 py-1 text-left text-[11px] text-neutral-800 hover:bg-neutral-100 rounded-xs border border-neutral-100 flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="truncate font-medium">
                      {p.pieceCode} · {p.name}
                    </span>
                    {pl && (
                      <span className="font-mono tabular-nums text-[10px] text-neutral-500 shrink-0">
                        ({pl.offsetXCm.toFixed(1)}, {pl.offsetYCm.toFixed(1)})
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* UX-2.3.2: Single-Piece CAD Board Placement (strictly separate from source geometry) */}
      {atelier && !isMultiBoardSelection && selectedPiece && selectedPlacement && (
        <section
          className="pb-3.5 border-b border-neutral-200 space-y-2.5"
          data-testid="inspector-board-placement"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold text-neutral-600">
              CAD Board Placement (cm)
            </h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => atelier.togglePieceVisible(selectedPiece.id)}
                title={selectedPlacement.visible ? 'Hide piece on board' : 'Show piece on board'}
                aria-label={selectedPlacement.visible ? 'Hide piece' : 'Show piece'}
                data-testid="inspector-piece-visibility-btn"
                className="p-1 border border-neutral-200 rounded-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
              >
                {selectedPlacement.visible ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3 text-neutral-400" />
                )}
              </button>
              <button
                type="button"
                onClick={() => atelier.reorderPiece(selectedPiece.id, 'forward')}
                title="Bring layer forward"
                aria-label="Bring layer forward"
                data-testid="inspector-piece-forward-btn"
                className="p-1 border border-neutral-200 rounded-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => atelier.reorderPiece(selectedPiece.id, 'backward')}
                title="Send layer backward"
                aria-label="Send layer backward"
                data-testid="inspector-piece-backward-btn"
                className="p-1 border border-neutral-200 rounded-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
              >
                <ArrowDown className="w-3 h-3" />
              </button>
            </div>
          </div>

          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Ephemeral board offset only — original piece geometry and seam dimensions remain
            unchanged.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-0.5">
              <span className="text-[10px] text-neutral-500 block">Board X (cm)</span>
              <input
                type="number"
                step="0.5"
                data-testid="inspector-board-x"
                aria-label="Board X in centimeters"
                value={draftBoardX}
                onChange={e => setDraftBoardX(e.target.value)}
                onBlur={e => commitBoardCoordinate('x', e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    commitBoardCoordinate('x', draftBoardX);
                  }
                }}
                className="w-full px-2 py-1 font-mono tabular-nums text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs focus:outline-none focus:border-neutral-900"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-neutral-500 block">Board Y (cm)</span>
              <input
                type="number"
                step="0.5"
                data-testid="inspector-board-y"
                aria-label="Board Y in centimeters"
                value={draftBoardY}
                onChange={e => setDraftBoardY(e.target.value)}
                onBlur={e => commitBoardCoordinate('y', e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    commitBoardCoordinate('y', draftBoardY);
                  }
                }}
                className="w-full px-2 py-1 font-mono tabular-nums text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs focus:outline-none focus:border-neutral-900"
              />
            </label>
          </div>

          {selectedGroup && (
            <div className="flex items-center justify-between px-2 py-1.5 rounded-xs bg-neutral-50 border border-neutral-200 text-[11px]">
              <span className="text-neutral-700 font-medium truncate">
                Group: {selectedGroup.name} ({selectedGroup.memberPieceIds.length})
              </span>
              <button
                type="button"
                onClick={() => atelier.ungroupById(selectedGroup.id)}
                data-testid="inspector-ungroup-single-btn"
                className="text-[10px] font-medium text-neutral-700 hover:text-neutral-950 hover:underline shrink-0 cursor-pointer"
              >
                Ungroup
              </button>
            </div>
          )}

          <label className="flex items-start gap-2 pt-0.5 cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="inspector-intentional-overlap-toggle"
              checked={selectedPlacement.allowIntentionalOverlap}
              onChange={() => atelier.togglePieceIntentionalOverlap(selectedPiece.id)}
              className="mt-0.5 accent-neutral-900 cursor-pointer"
            />
            <span className="text-[11px] text-neutral-700 leading-snug">
              Mark overlap as intentional (visual comparison overlay)
            </span>
          </label>
        </section>
      )}

      {/* Selected Pattern Piece Geometry Summary (sourced from read-only activeArtifact when available) */}
      {selectedPiece && (
        <section className="space-y-2.5" data-testid="inspector-pattern-piece">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Scissors className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="font-semibold text-neutral-900 truncate">
                {selectedArtifactPiece?.pieceCode ?? selectedPiece.pieceCode} ·{' '}
                {selectedArtifactPiece?.name ?? selectedPiece.name}
              </span>
            </div>
            <span className="font-mono text-[10px] text-neutral-600 shrink-0">
              {(selectedArtifactPiece?.onFold ?? selectedPiece.onFold)
                ? 'Fold'
                : `Cut ${selectedArtifactPiece?.cutCount ?? selectedPiece.cutCount}`}
            </span>
          </div>

          <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xs px-2.5 py-1.5">
            {activeArtifact
              ? `${activeArtifact.authorityTier} · ${activeArtifact.provenance.disclosureLabel} (isProductionReady: ${String(activeArtifact.isProductionReady)}).`
              : 'C0-Legacy prototype geometry · Non-authoritative preview (isProductionReady: false).'}
          </p>

          <dl className="grid grid-cols-2 gap-y-2 gap-x-3 pt-1 border-t border-neutral-100 text-[11px]">
            <div>
              <dt className="text-neutral-500">Bounding Box</dt>
              <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                {selectedArtifactPiece
                  ? `${selectedArtifactPiece.boundingBoxCm.widthCm} × ${selectedArtifactPiece.boundingBoxCm.heightCm} cm`
                  : `${selectedPiece.boundingBox.widthCm} × ${selectedPiece.boundingBox.heightCm} cm`}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Seam Allowance</dt>
              <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                {selectedArtifactPiece?.seamAllowanceWidthCm ?? selectedPiece.seamAllowanceWidthCm} cm
              </dd>
            </div>
            {selectedArtifactPiece && (
              <div className="col-span-2 flex items-center justify-between pt-1 border-t border-neutral-100 text-[10px] font-mono text-neutral-600">
                <span>
                  Sew {selectedArtifactPiece.sewSegments.length} · Cut{' '}
                  {selectedArtifactPiece.cutSegments.length}
                </span>
                <span>
                  Notches {selectedArtifactPiece.notches.length} · Darts{' '}
                  {selectedArtifactPiece.darts.length}
                </span>
              </div>
            )}
            {selectedPiece.offsetResult && (
              <div className="col-span-2 flex items-center justify-between pt-1 border-t border-neutral-100">
                <dt className="text-neutral-500">Offset Preview</dt>
                <dd
                  className={`font-mono tabular-nums font-semibold ${
                    selectedPiece.offsetResult.status === 'success'
                      ? 'text-emerald-700'
                      : selectedPiece.offsetResult.status === 'warning'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                  }`}
                >
                  {selectedPiece.offsetResult.status} ({selectedPiece.offsetResult.maxDeviationCm} cm)
                </dd>
              </div>
            )}
          </dl>

          {/* Calculated Seamlines */}
          {selectedPiece.seams.length > 0 && (
            <div className="pt-2 border-t border-neutral-100 space-y-1">
              <span className="text-[11px] font-semibold text-neutral-500 block">
                Seamlines ({selectedPiece.seams.length})
              </span>
              {selectedPiece.seams.map(seam => (
                <button
                  key={seam.id}
                  type="button"
                  onClick={() =>
                    selectEntity({
                      kind: 'seam',
                      id: `${selectedPiece.id}:${seam.id}`,
                      pieceId: selectedPiece.id,
                      seamId: seam.id,
                      label: `${selectedPiece.name} · ${seam.name}`,
                      lengthCm: seam.lengthCm,
                      pairedSeamName: seam.pairedSeamName
                    })
                  }
                  className="w-full px-2 py-1.5 rounded-xs border border-neutral-200 hover:border-neutral-400 bg-neutral-50/70 flex items-center justify-between text-left cursor-pointer transition-colors"
                >
                  <span className="min-w-0 pr-2">
                    <span className="text-neutral-800 block truncate">{seam.name}</span>
                    {seam.pairedSeamName && (
                      <span className="text-[10px] text-neutral-500 block truncate">
                        Pairs: {seam.pairedSeamName}
                      </span>
                    )}
                  </span>
                  <span className="font-mono tabular-nums text-neutral-900 font-semibold shrink-0">
                    {seam.lengthCm} cm
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Sleeve Diagnostics when sleeve is active */}
          {selectedPiece.id === 'piece-sleeve' && sleeveDiag && (
            <div className="pt-2 border-t border-neutral-100 space-y-1 text-[11px] font-mono tabular-nums">
              <span className="font-sans font-semibold text-neutral-500 block">
                Sleeve Fit Diagnostics ({sleeveDiag.strategy})
              </span>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-sans">Cap Height</span>
                <span className="text-neutral-900">{sleeveDiag.capHeightCm} cm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-sans">Scye / Cap</span>
                <span className="text-neutral-900">
                  {sleeveDiag.bodiceArmholeLengthCm} / {sleeveDiag.totalCapLengthCm} cm
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-sans">Net Cap Ease</span>
                <span className="font-semibold text-blue-800">
                  +{sleeveDiag.capEaseCm} cm ({sleeveDiag.capEasePercentage}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-sans">Inseam Parity</span>
                <span className="text-emerald-700">{sleeveDiag.inseamParityDeltaCm} cm</span>
              </div>
            </div>
          )}
        </section>
      )}

      {/* UX-2.3.2: Advisory Visual Overlap Feedback (never geometric certification) */}
      {atelier && (
        <section
          className="pt-3 border-t border-neutral-200 space-y-2"
          data-testid="inspector-overlap-advisories"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-neutral-500">
              Visual Overlap Advisories
            </h3>
            <span className="font-mono tabular-nums text-[10px] font-semibold text-neutral-700">
              {atelier.overlapAdvisories.length}
            </span>
          </div>

          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Advisory visual arrangement feedback only — does not validate seam construction or
            certify geometry.
          </p>

          {atelier.overlapAdvisories.length === 0 ? (
            <div
              className="px-2.5 py-2 rounded-xs border border-neutral-200 bg-neutral-50 text-[11px] text-neutral-600"
              data-testid="inspector-overlap-empty"
            >
              No overlapping piece regions detected on the CAD board.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {atelier.overlapAdvisories.map(adv => {
                const meta = OVERLAP_META[adv.classification];
                return (
                  <div
                    key={adv.id}
                    data-testid={`inspector-overlap-item-${adv.classification}`}
                    className={`p-2 rounded-xs border text-[11px] space-y-1 ${meta.borderClass}`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-mono font-semibold text-neutral-900">
                        {adv.pieceACode} ↔ {adv.pieceBCode}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded-xs text-[10px] font-semibold shrink-0 ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-neutral-700 leading-snug">{adv.message}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Deterministic Validation Engine Summary */}
      <section
        className="pt-3 border-t border-neutral-200 space-y-2"
        data-testid="inspector-validation-engine"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-neutral-500">Validation Checks</h3>
          <span
            className={`font-mono tabular-nums text-[11px] font-semibold ${
              validationReport.isValid ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {validationReport.passedCount}/{validationReport.checks.length} passed
          </span>
        </div>

        <p className="text-[11px] text-neutral-600 leading-relaxed">{validationReport.declaration}</p>

        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
          {validationReport.checks.map(chk => (
            <div
              key={chk.id}
              className={`p-2 rounded-xs border text-[11px] space-y-0.5 ${
                chk.status === 'pass'
                  ? 'bg-emerald-50/40 border-emerald-200/80'
                  : chk.status === 'warning'
                    ? 'bg-amber-50/50 border-amber-200'
                    : 'bg-rose-50/60 border-rose-200'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5 font-medium text-neutral-900">
                <span className="flex items-center gap-1.5 min-w-0">
                  {chk.status === 'pass' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle
                      className={`w-3.5 h-3.5 shrink-0 ${
                        chk.status === 'fail' ? 'text-rose-600' : 'text-amber-600'
                      }`}
                    />
                  )}
                  <span className="truncate">{chk.name}</span>
                </span>
                <span className="font-mono text-[10px] uppercase shrink-0">{chk.status}</span>
              </div>
              {chk.measuredValue && (
                <div className="font-mono tabular-nums text-[10px] text-neutral-700">
                  {chk.measuredValue}
                </div>
              )}
              <p className="text-[10px] text-neutral-600">{chk.message}</p>
            </div>
          ))}
        </div>

        {validationReport.unassessedConditions.length > 0 && (
          <details className="pt-1 text-[11px] text-neutral-600">
            <summary className="cursor-pointer font-medium text-neutral-700 hover:text-neutral-900">
              Unassessed industrial criteria ({validationReport.unassessedConditions.length})
            </summary>
            <ul className="mt-1.5 space-y-1 pl-3 list-disc text-[10px] text-neutral-600">
              {validationReport.unassessedConditions.map(u => (
                <li key={u.id}>
                  <strong className="text-neutral-800">{u.name}:</strong> {u.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
};
