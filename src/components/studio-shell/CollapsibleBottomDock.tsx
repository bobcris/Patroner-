/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  ChevronUp,
  ChevronDown,
  Layers,
  Compass,
  History,
  ShieldAlert,
  Undo2,
  Redo2
} from 'lucide-react';
import { useProjectWorkspace } from '../../state/ProjectWorkspaceContext';
import {
  DockTabId,
  useViewportInteraction
} from '../../state/ViewportInteractionContext';
import { DesignSpecificationView } from '../../features/design-specification/DesignSpecificationView';
import { MeasurementWorkspace } from '../../features/measurements/MeasurementWorkspace';

const DOCK_TABS: ReadonlyArray<{
  id: DockTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'tech-spec', label: 'Tech Spec', icon: Layers },
  { id: 'sizing-ease', label: 'Sizing & Ease', icon: Compass },
  { id: 'history', label: 'Viewport History', icon: History },
  { id: 'engineering', label: 'Engineering Health', icon: ShieldAlert }
];

export const CollapsibleBottomDock: React.FC = () => {
  const {
    currentSpec,
    updateSpec,
    measurements,
    activeSize,
    measurementProvenance,
    measurementApprovalState,
    measurementProvenanceEvidence,
    measurementRevisionId,
    specificationRevisionId,
    updateMeasurements,
    updateMeasurementProvenance,
    updateMeasurementApproval,
    workspaceBundle,
    isPackageStale,
    isSynchronized
  } = useProjectWorkspace();

  const {
    dockOpen,
    toggleDock,
    activeDockTab,
    openDockTab,
    setEnvironment,
    setSimProdSubView,
    historyPast,
    historyFuture,
    canUndo,
    canRedo,
    undo,
    redo,
    ephemeralOverlays
  } = useViewportInteraction();

  const { isCadSupported, approvalVerification, draftValidation, exportValidation } =
    workspaceBundle;

  return (
    <section
      aria-label="Workspace Bottom Dock"
      data-testid="collapsible-bottom-dock"
      className="shrink-0 border-t border-neutral-300 bg-white flex flex-col z-10"
    >
      {/* Persistent Slim Dock Tab Bar (32px) */}
      <div className="h-8 px-2.5 bg-[#ECEAE4] border-b border-neutral-200/80 flex items-center justify-between gap-2 shrink-0">
        <div role="tablist" aria-label="Bottom Dock Panels" className="flex items-center gap-1 overflow-x-auto">
          {DOCK_TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = dockOpen && activeDockTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`dock-tab-${tab.id}`}
                onClick={() => {
                  if (dockOpen && activeDockTab === tab.id) {
                    toggleDock();
                  } else {
                    openDockTab(tab.id);
                  }
                }}
                className={`h-6 px-2.5 rounded-xs text-[11px] font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-white text-neutral-950 shadow-2xs border border-neutral-300'
                    : 'text-neutral-600 hover:text-neutral-950 hover:bg-white/60'
                }`}
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span>{tab.label}</span>
                {tab.id === 'history' && historyPast.length > 0 && (
                  <span className="font-mono tabular-nums text-[10px] text-neutral-500">
                    ({historyPast.length})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={toggleDock}
          data-testid="dock-expand-collapse-btn"
          aria-expanded={dockOpen}
          aria-label={dockOpen ? 'Collapse bottom dock' : 'Expand bottom dock'}
          className="h-6 px-2 rounded-xs text-[11px] text-neutral-600 hover:text-neutral-950 hover:bg-white/60 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>{dockOpen ? 'Collapse' : 'Expand'}</span>
          {dockOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expandable Dock Panel Body (Bounded height so 100dvh never overflows) */}
      {dockOpen && (
        <div
          data-testid="bottom-dock-body"
          className="h-[290px] max-h-[42dvh] overflow-y-auto overflow-x-hidden bg-[#FAF9F6]"
        >
          {activeDockTab === 'tech-spec' && (
            <DesignSpecificationView
              spec={currentSpec}
              onUpdateSpec={updateSpec}
              onNavigateToMeasurements={() => openDockTab('sizing-ease')}
              onNavigateToCAD={() => setEnvironment('pattern-atelier')}
            />
          )}

          {activeDockTab === 'sizing-ease' && (
            <MeasurementWorkspace
              currentMeasurements={measurements}
              activeSize={activeSize}
              currentSpec={currentSpec}
              measurementProvenance={measurementProvenance}
              measurementApprovalState={measurementApprovalState}
              measurementProvenanceEvidence={measurementProvenanceEvidence}
              measurementRevisionId={measurementRevisionId}
              onUpdateMeasurements={updateMeasurements}
              onUpdateMeasurementApproval={updateMeasurementApproval}
              onUpdateMeasurementProvenance={updateMeasurementProvenance}
              onNavigateToCAD={() => setEnvironment('pattern-atelier')}
            />
          )}

          {activeDockTab === 'history' && (
            <div className="p-4 max-w-4xl mx-auto space-y-3 text-xs" data-testid="dock-history-panel">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2.5">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">
                    Ephemeral Viewport History
                  </h3>
                  <p className="text-[11px] text-neutral-500">
                    Tracks selection, tool, camera, and unverified visual notes only. Never mutates certified geometry, measurement approvals, or production evidence.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={undo}
                    disabled={!canUndo}
                    className="px-2.5 py-1 rounded-sm border border-neutral-300 bg-white text-neutral-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    Undo ({historyPast.length})
                  </button>
                  <button
                    type="button"
                    onClick={redo}
                    disabled={!canRedo}
                    className="px-2.5 py-1 rounded-sm border border-neutral-300 bg-white text-neutral-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                    Redo ({historyFuture.length})
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-neutral-500 block">
                    Undo Stack ({historyPast.length})
                  </span>
                  {historyPast.length === 0 ? (
                    <p className="text-[11px] text-neutral-500">
                      No viewport actions recorded yet. Select an entity, adjust zoom, or add a visual note.
                    </p>
                  ) : (
                    <ol className="space-y-1">
                      {[...historyPast].reverse().map((entry, idx) => (
                        <li
                          key={entry.id}
                          className="px-2.5 py-1.5 rounded-sm bg-white border border-neutral-200 flex items-center justify-between gap-2"
                        >
                          <span className="text-neutral-800 truncate">
                            {historyPast.length - idx}. {entry.actionLabel}
                          </span>
                          <span className="font-mono text-[10px] text-neutral-500 shrink-0">
                            {entry.environment}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-neutral-500 block">
                    Redo Stack ({historyFuture.length}) · Active Unverified Notes ({ephemeralOverlays.length})
                  </span>
                  {historyFuture.length === 0 ? (
                    <p className="text-[11px] text-neutral-500">Redo stack is empty.</p>
                  ) : (
                    <ol className="space-y-1">
                      {historyFuture.map((entry, idx) => (
                        <li
                          key={entry.id}
                          className="px-2.5 py-1.5 rounded-sm bg-neutral-100 border border-neutral-200 flex items-center justify-between gap-2"
                        >
                          <span className="text-neutral-700 truncate">
                            +{idx + 1}. {entry.actionLabel}
                          </span>
                          <span className="font-mono text-[10px] text-neutral-500 shrink-0">
                            {entry.environment}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeDockTab === 'engineering' && (
            <div className="p-4 max-w-5xl mx-auto space-y-4 text-xs" data-testid="dock-engineering-panel">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2.5">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">
                    Engineering Health &amp; Governance Boundaries
                  </h3>
                  <p className="text-[11px] text-neutral-500">
                    Technical lineage, geometry classification, and fail-closed production release status.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEnvironment('simulation-production');
                    setSimProdSubView('production-overview');
                  }}
                  className="px-3 py-1.5 rounded-sm bg-neutral-900 text-white font-medium hover:bg-neutral-800 cursor-pointer"
                >
                  Open Production Export Pipeline
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 bg-white border border-neutral-200 rounded-sm space-y-1">
                  <span className="text-[11px] font-semibold text-neutral-500 block">
                    Geometry Engine Boundary
                  </span>
                  <p className="font-medium text-neutral-900">C0-Legacy TypeScript Prototype</p>
                  <p className="text-[11px] text-neutral-600">
                    Non-authoritative preview. M01/M02/M03 Python production solvers have not started.
                  </p>
                </div>

                <div className="p-3 bg-white border border-neutral-200 rounded-sm space-y-1">
                  <span className="text-[11px] font-semibold text-neutral-500 block">
                    Governance &amp; Release Flags
                  </span>
                  <p className="font-mono text-[11px] text-neutral-800">
                    isProductionReady: false
                  </p>
                  <p className="font-mono text-[11px] text-neutral-800">
                    AC-09 Physical Toile: PENDING
                  </p>
                  <p className="font-mono text-[11px] text-neutral-800">
                    M00 Formal Acceptance: NOT ACCEPTED
                  </p>
                  <p className="font-mono text-[11px] text-neutral-600">
                    Gate Auth-2/3/4: CLOSED · externalCadInteroperabilityVerified: false
                  </p>
                </div>

                <div className="p-3 bg-white border border-neutral-200 rounded-sm space-y-1">
                  <span className="text-[11px] font-semibold text-neutral-500 block">
                    Active Bundle Diagnostics
                  </span>
                  <p className="text-neutral-800">
                    Spec Approval: <strong className="capitalize">{approvalVerification.state}</strong>
                  </p>
                  <p className="text-neutral-800">
                    Draft Validation: <strong>{draftValidation.isValid ? 'Valid' : 'Needs Review'}</strong>
                  </p>
                  <p className="text-neutral-800">
                    Package Sync:{' '}
                    <strong>
                      {!isCadSupported
                        ? 'Specs Only'
                        : isPackageStale
                          ? 'Stale'
                          : isSynchronized
                            ? 'Synchronized'
                            : 'Pending Baseline'}
                    </strong>
                  </p>
                  <p className="text-neutral-800">
                    Export Gate:{' '}
                    <strong>{exportValidation.isExportPermitted ? 'Draft Permitted' : 'Blocked'}</strong>
                  </p>
                  <p className="font-mono text-[10px] text-neutral-500 truncate" title={specificationRevisionId}>
                    Spec Rev: {specificationRevisionId}
                  </p>
                  <p className="font-mono text-[10px] text-neutral-500 truncate" title={measurementRevisionId}>
                    Meas Rev: {measurementRevisionId}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
