/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { StickyNote, X, Box, ShieldCheck } from 'lucide-react';
import { useProjectWorkspace } from '../../state/ProjectWorkspaceContext';
import {
  useViewportInteraction,
  StudioEnvironment
} from '../../state/ViewportInteractionContext';
import { StudioTopBar } from './StudioTopBar';
import { ContextualToolRail } from './ContextualToolRail';
import { ContextualInspector } from './ContextualInspector';
import { CollapsibleBottomDock } from './CollapsibleBottomDock';
import { WorkspaceErrorBoundary } from '../layout/WorkspaceErrorBoundary';
import { SimulationFitPanel } from '../../features/simulation/SimulationFitPanel';
import { StudioPerfBoundary } from '../../features/creative-studio/perf-probe';
import { useOptionalPatternAtelierCamera } from '../../features/pattern-workspace/PatternAtelierViewContext';

const StudioStripZoomReadout: React.FC<{
  readonly activeEnvironment: StudioEnvironment;
  readonly fallbackZoom: number;
}> = React.memo(({ activeEnvironment, fallbackZoom }) => {
  const atelierCamera = useOptionalPatternAtelierCamera();
  const zoomPct =
    activeEnvironment === 'pattern-atelier' && atelierCamera
      ? Math.round(atelierCamera.zoom * 100)
      : Math.round(fallbackZoom * 100);
  return (
    <span className="font-mono tabular-nums text-[10px] text-neutral-500 pl-1 whitespace-nowrap shrink-0">
      {zoomPct}%
    </span>
  );
});
StudioStripZoomReadout.displayName = 'StudioStripZoomReadout';

export interface VisualStudioShellProps {
  renderCreativeStudio: () => React.ReactNode;
  renderPatternAtelier: () => React.ReactNode;
  renderProductionOverview: () => React.ReactNode;
}

const ENV_CONTEXT_COPY: Record<
  StudioEnvironment,
  { title: string; disclosure: string }
> = {
  'creative-studio': {
    title: 'Creative Studio',
    disclosure: 'Studio Demonstration Mode · Concept proposals require approval before drafting'
  },
  'pattern-atelier': {
    title: 'Pattern Atelier',
    disclosure: 'C0-Legacy TypeScript Prototype Geometry · Non-authoritative drafting preview'
  },
  'simulation-production': {
    title: '3D Simulation & Production',
    disclosure: 'Prototype Simulation · Physical AC-09 Validation Pending · isProductionReady: false'
  }
};

export const VisualStudioShell: React.FC<VisualStudioShellProps> = ({
  renderCreativeStudio,
  renderPatternAtelier,
  renderProductionOverview
}) => {
  const {
    currentSpec,
    updateSpec,
    measurements,
    referenceImage,
    bodiceDartStyle,
    sleeveEaseStrategy,
    setSleeveEaseStrategy,
    workspaceBundle,
    resetWorkspace
  } = useProjectWorkspace();

  const {
    activeEnvironment,
    simProdSubView,
    setSimProdSubView,
    selectedEntity,
    selectedPieceId,
    selectEntity,
    setHoveredEntity,
    camera,
    ephemeralOverlays,
    removeEphemeralOverlay
  } = useViewportInteraction();

  const envMeta = ENV_CONTEXT_COPY[activeEnvironment];
  const pieces = workspaceBundle.pieces;
  const activeEnvNotes = ephemeralOverlays.filter(n => n.environment === activeEnvironment);
  const isFullBleedEnv =
    activeEnvironment === 'creative-studio' || activeEnvironment === 'pattern-atelier';

  return (
    <div
      data-testid="visual-studio-shell"
      className="studio-viewport-frame w-full flex flex-col bg-[#F5F4F0] text-neutral-900 font-sans antialiased selection:bg-neutral-900 selection:text-white"
    >
      {/* Persistent Top Studio Bar (48px) */}
      <StudioPerfBoundary id="StudioTopBar">
        <StudioTopBar />
      </StudioPerfBoundary>

      {/* Main Horizontal Workspace Frame: Tool Rail + Dominant Center Viewport + Right Inspector */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Contextual Left Tool Rail (48px) */}
        <ContextualToolRail />

        {/* Dominant Center Visual Viewport Column */}
        <div
          data-testid="primary-workspace-viewport"
          className="flex-1 min-w-0 h-full flex flex-col overflow-hidden"
        >
          {/* Slim Environment Context & Shared Entity Selection Strip */}
          <div
            data-testid="environment-context-strip"
            className="min-h-9 px-3 py-1.5 bg-[#ECEAE4] border-b border-neutral-300/90 flex flex-wrap items-center justify-between gap-2 shrink-0 text-[11px]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-neutral-900 whitespace-nowrap shrink-0">
                {envMeta.title}
              </span>
              <span className="text-neutral-400 shrink-0" aria-hidden="true">
                ·
              </span>
              <span className="text-neutral-600 truncate" title={envMeta.disclosure}>
                {envMeta.disclosure}
              </span>
            </div>

            {/* Synchronized Entity Selection Controls (Shared Across Environments) */}
            <div
              className="flex items-center gap-1.5 overflow-x-auto max-w-full"
              aria-label="Synchronized Project Entities"
              data-testid="shared-entity-bar"
            >
              <button
                type="button"
                data-testid="select-entity-garment"
                onClick={() =>
                  selectEntity({
                    kind: 'garment-element',
                    id: `garment:${currentSpec.id}`,
                    label: currentSpec.name,
                    category: currentSpec.garmentCategory,
                    silhouette: currentSpec.silhouette,
                    pieceId: pieces[0]?.id
                  })
                }
                onMouseEnter={() =>
                  setHoveredEntity({
                    kind: 'garment-element',
                    id: `garment:${currentSpec.id}`,
                    label: currentSpec.name
                  })
                }
                onMouseLeave={() => setHoveredEntity(null)}
                className={`px-2 py-0.5 rounded-xs border text-[11px] whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  selectedEntity?.kind === 'garment-element'
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:border-neutral-500'
                }`}
              >
                Garment
              </button>

              {referenceImage && (
                <button
                  type="button"
                  data-testid="select-entity-reference"
                  onClick={() =>
                    selectEntity({
                      kind: 'reference-image',
                      id: `ref:${referenceImage.name}`,
                      label: referenceImage.name,
                      name: referenceImage.name,
                      sizeBytes: referenceImage.sizeBytes
                    })
                  }
                  className={`px-2 py-0.5 rounded-xs border text-[11px] whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    selectedEntity?.kind === 'reference-image'
                      ? 'bg-neutral-900 text-white border-neutral-900'
                      : 'bg-white text-neutral-700 border-neutral-300 hover:border-neutral-500'
                  }`}
                >
                  Ref: {referenceImage.name.slice(0, 14)}
                </button>
              )}

              {pieces.slice(0, 3).map(piece => {
                const isPieceSelected = selectedPieceId === piece.id;
                return (
                  <button
                    key={piece.id}
                    type="button"
                    data-testid={`select-entity-piece-${piece.id}`}
                    onClick={() =>
                      selectEntity({
                        kind: 'pattern-piece',
                        id: piece.id,
                        pieceId: piece.id,
                        pieceCode: piece.pieceCode,
                        label: piece.name
                      })
                    }
                    className={`px-2 py-0.5 rounded-xs border text-[11px] font-mono whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      isPieceSelected
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-700 border-neutral-300 hover:border-neutral-500'
                    }`}
                  >
                    {piece.pieceCode}
                  </button>
                );
              })}

              {activeEnvironment === 'simulation-production' && (
                <>
                  <button
                    type="button"
                    data-testid="select-entity-simulation"
                    onClick={() =>
                      selectEntity({
                        kind: 'simulation-entity',
                        id: `sim-drape:${currentSpec.id}`,
                        pieceId: selectedPieceId ?? pieces[0]?.id,
                        label: `${currentSpec.name} Prototype Drape`,
                        prototypeMode: 'prototype-drape'
                      })
                    }
                    className={`px-2 py-0.5 rounded-xs border text-[11px] whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      selectedEntity?.kind === 'simulation-entity'
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-700 border-neutral-300 hover:border-neutral-500'
                    }`}
                  >
                    Drape Sim
                  </button>
                  <button
                    type="button"
                    data-testid="select-entity-production"
                    onClick={() =>
                      selectEntity({
                        kind: 'production-entity',
                        id: `prod-pkg:${currentSpec.id}`,
                        pieceId: selectedPieceId ?? pieces[0]?.id,
                        label: 'Production Package & Export Gate',
                        artifactType: 'validation-gate'
                      })
                    }
                    className={`px-2 py-0.5 rounded-xs border text-[11px] whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      selectedEntity?.kind === 'production-entity'
                        ? 'bg-neutral-900 text-white border-neutral-900'
                        : 'bg-white text-neutral-700 border-neutral-300 hover:border-neutral-500'
                    }`}
                  >
                    Prod Gate
                  </button>
                </>
              )}

              <StudioStripZoomReadout
                activeEnvironment={activeEnvironment}
                fallbackZoom={camera.zoom}
              />
            </div>
          </div>

          {/* Main Environment Work Surface (Internal Scroll Only — Zero Document Scroll) */}
          <main
            data-testid="workspace-stage-main"
            className={`flex-1 min-h-0 relative ${
              isFullBleedEnv
                ? 'overflow-hidden flex flex-col'
                : 'overflow-y-auto overflow-x-hidden'
            }`}
            style={
              !isFullBleedEnv && camera.showGrid
                ? {
                    backgroundImage:
                      'radial-gradient(rgba(24, 24, 27, 0.08) 1px, transparent 1px)',
                    backgroundSize: '20px 20px'
                  }
                : undefined
            }
          >
            {/* Ephemeral Unverified Visual Overlay Bar (strictly non-canonical) */}
            {camera.showOverlayNotes && activeEnvNotes.length > 0 && (
              <div
                data-testid="ephemeral-overlay-banner"
                className="sticky top-0 z-10 px-3 py-1.5 bg-amber-50/95 border-b border-amber-200 flex flex-wrap items-center gap-2 text-[11px]"
              >
                <span className="font-medium text-amber-900">
                  Unverified Visual Notes (Non-Canonical):
                </span>
                {activeEnvNotes.map(note => (
                  <span
                    key={note.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs bg-white border border-amber-300 text-amber-950"
                  >
                    <StickyNote className="w-3 h-3 text-amber-600" />
                    <span>{note.label}</span>
                    <button
                      type="button"
                      onClick={() => removeEphemeralOverlay(note.id)}
                      aria-label={`Dismiss ${note.label}`}
                      className="text-neutral-400 hover:text-rose-700 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <WorkspaceErrorBoundary onResetWorkspace={resetWorkspace}>
              {activeEnvironment === 'creative-studio' && (
                <div
                  data-testid="env-surface-creative-studio"
                  className="w-full h-full flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
                >
                  {renderCreativeStudio()}
                </div>
              )}

              {activeEnvironment === 'pattern-atelier' && (
                <div
                  data-testid="env-surface-pattern-atelier"
                  className="w-full h-full flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
                >
                  {renderPatternAtelier()}
                </div>
              )}

              {activeEnvironment === 'simulation-production' && (
                <div data-testid="env-surface-simulation-production" className="flex flex-col w-full min-w-0">
                  {/* Unified 3D Simulation & Production Sub-View Switcher */}
                  <div className="px-4 lg:px-8 pt-4 flex flex-wrap items-center justify-between gap-2">
                    <div
                      role="tablist"
                      aria-label="Simulation and Production Sub-View"
                      className="inline-flex items-center bg-white border border-neutral-200 rounded-md p-0.5"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={simProdSubView === 'production-overview'}
                        data-testid="simprod-tab-production"
                        onClick={() => setSimProdSubView('production-overview')}
                        className={`px-3 py-1.5 rounded-sm text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                          simProdSubView === 'production-overview'
                            ? 'bg-neutral-900 text-white'
                            : 'text-neutral-600 hover:text-neutral-900'
                        }`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Production &amp; Export Gates
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={simProdSubView === 'prototype-drape-3d'}
                        data-testid="simprod-tab-drape"
                        onClick={() => setSimProdSubView('prototype-drape-3d')}
                        className={`px-3 py-1.5 rounded-sm text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                          simProdSubView === 'prototype-drape-3d'
                            ? 'bg-neutral-900 text-white'
                            : 'text-neutral-600 hover:text-neutral-900'
                        }`}
                      >
                        <Box className="w-3.5 h-3.5" />
                        Prototype 3D Drape &amp; AC-09
                      </button>
                    </div>

                    <span className="text-[11px] text-neutral-500">
                      Prototype simulation only — physical toile fit validation remains pending.
                    </span>
                  </div>

                  {simProdSubView === 'production-overview' ? (
                    renderProductionOverview()
                  ) : (
                    <div className="max-w-7xl w-full mx-auto px-4 lg:px-8 py-6">
                      {workspaceBundle.isCadSupported && workspaceBundle.pieces.length > 0 ? (
                        <SimulationFitPanel
                          currentSpec={currentSpec}
                          measurements={measurements}
                          pieces={[...workspaceBundle.pieces]}
                          assemblyResult={workspaceBundle.assemblyResult ?? undefined}
                          approvedPatternRevisionId={workspaceBundle.liveSnapshot?.revisionId}
                          bodiceDartStyle={bodiceDartStyle}
                          sleeveEaseStrategy={sleeveEaseStrategy}
                          onApplyOptimizationProposal={proposal => {
                            if (proposal.proposedDesignSpec.sleeveEaseStrategy) {
                              setSleeveEaseStrategy(proposal.proposedDesignSpec.sleeveEaseStrategy);
                            }
                            updateSpec(proposal.proposedDesignSpec);
                          }}
                        />
                      ) : (
                        <div className="p-6 bg-white border border-neutral-200 rounded-sm text-xs text-neutral-600 space-y-2">
                          <h3 className="text-sm font-semibold text-neutral-900">
                            Prototype 3D Drape Unavailable for {currentSpec.garmentCategory}
                          </h3>
                          <p>
                            This category does not have an active CAD block (Specs Only). Switch to a skirt or bodice specification to inspect prototype drape simulation.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </WorkspaceErrorBoundary>
          </main>

          {/* Collapsible Bottom Dock (Tech Spec, Sizing & Ease, Viewport History, Engineering Health) */}
          <CollapsibleBottomDock />
        </div>

        {/* Contextual Right Inspector (Desktop Docked / Tablet Slide-Over) */}
        <StudioPerfBoundary id="ContextualInspector">
          <ContextualInspector />
        </StudioPerfBoundary>
      </div>
    </div>
  );
};
