/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Scissors, Sliders } from 'lucide-react';
import { useProjectWorkspace } from '../../state/ProjectWorkspaceContext';
import { useViewportInteraction } from '../../state/ViewportInteractionContext';
import { useOptionalPatternAtelierView } from './PatternAtelierViewContext';
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

/**
 * UX-2.3.1 — Consolidated Right Inspector Panel for Pattern Atelier.
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

  const { selectedEntity, selectEntity, openDockTab } = useViewportInteraction();
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

  const selectedPieceId =
    selectedEntity?.kind === 'pattern-piece' || selectedEntity?.kind === 'seam'
      ? selectedEntity.pieceId
      : pieces[0]?.id ?? null;

  const selectedPiece = pieces.find(p => p.id === selectedPieceId) ?? pieces[0];

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

  // Default: Pieces Mode — Consolidated Piece Inspector, Seamlines, Sleeve Diagnostics, Validation Engine
  return (
    <div className="space-y-4 text-xs" data-testid="inspector-atelier-pieces">
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

      {/* Selected Pattern Piece Geometry Summary */}
      {selectedPiece && (
        <section className="space-y-2.5" data-testid="inspector-pattern-piece">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Scissors className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="font-semibold text-neutral-900 truncate">
                {selectedPiece.pieceCode} · {selectedPiece.name}
              </span>
            </div>
            <span className="font-mono text-[10px] text-neutral-600 shrink-0">
              {selectedPiece.onFold ? 'Fold' : `Cut ${selectedPiece.cutCount}`}
            </span>
          </div>

          <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xs px-2.5 py-1.5">
            C0-Legacy prototype geometry · Non-authoritative preview (isProductionReady: false).
          </p>

          <dl className="grid grid-cols-2 gap-y-2 gap-x-3 pt-1 border-t border-neutral-100 text-[11px]">
            <div>
              <dt className="text-neutral-500">Bounding Box</dt>
              <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                {selectedPiece.boundingBox.widthCm} × {selectedPiece.boundingBox.heightCm} cm
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Seam Allowance</dt>
              <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                {selectedPiece.seamAllowanceWidthCm} cm
              </dd>
            </div>
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
