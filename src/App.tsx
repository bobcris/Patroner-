/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ProjectWorkspaceProvider, useProjectWorkspace } from './state/ProjectWorkspaceContext';
import { PlatformTopBar } from './components/layout/PlatformTopBar';
import { WorkspaceErrorBoundary } from './components/layout/WorkspaceErrorBoundary';
import { FashionStudio } from './features/fashion-studio/FashionStudio';
import { DesignSpecificationView } from './features/design-specification/DesignSpecificationView';
import { MeasurementWorkspace } from './features/measurements/MeasurementWorkspace';
import { PatternWorkspace } from './features/pattern-workspace/PatternWorkspace';
import { ProductionOverview } from './features/production/ProductionOverview';

const WorkspaceShell: React.FC = () => {
  const {
    activeTab,
    navigateToTab,
    currentSpec,
    conceptHistory,
    updateSpec,
    referenceImage,
    setReferenceImage,
    activeSize,
    measurements,
    measurementProvenance,
    measurementApprovalState,
    measurementProvenanceEvidence,
    measurementRevisionId,
    updateMeasurements,
    updateMeasurementProvenance,
    updateMeasurementApproval,
    bomControls,
    setBomControls,
    bodiceDartStyle,
    setBodiceDartStyle,
    sleeveEaseStrategy,
    setSleeveEaseStrategy,
    strictUncertaintyGate,
    setStrictUncertaintyGate,
    requireApprovedGovernance,
    setRequireApprovedGovernance,
    workspaceBundle,
    commitProductionBaseline,
    syncWorkingDraftSnapshot,
    resetWorkspace
  } = useProjectWorkspace();

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-neutral-900 font-sans flex flex-col antialiased selection:bg-neutral-900 selection:text-white">
      {/* Unified Dual-Experience Top Bar */}
      <PlatformTopBar />

      {/* Main Workspace View Router */}
      <main className="flex-1">
        <WorkspaceErrorBoundary onResetWorkspace={resetWorkspace}>
          {activeTab === 'studio' && (
            <FashionStudio
              currentSpec={currentSpec}
              onUpdateSpec={updateSpec}
              onNavigateToSpec={() => navigateToTab('specification')}
              referenceImage={referenceImage}
              onChangeReferenceImage={setReferenceImage}
              conceptHistory={conceptHistory}
            />
          )}

          {activeTab === 'specification' && (
            <DesignSpecificationView
              spec={currentSpec}
              onUpdateSpec={updateSpec}
              onNavigateToMeasurements={() => navigateToTab('measurements')}
              onNavigateToCAD={() => navigateToTab('pattern-cad')}
            />
          )}

          {activeTab === 'measurements' && (
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
              onNavigateToCAD={() => navigateToTab('pattern-cad')}
            />
          )}

          {activeTab === 'pattern-cad' && (
            <PatternWorkspace
              currentSpec={currentSpec}
              measurements={measurements}
              activeSize={activeSize}
              measurementProvenance={measurementProvenance}
              measurementApprovalState={measurementApprovalState}
              measurementProvenanceEvidence={measurementProvenanceEvidence}
              workspaceBundle={workspaceBundle}
              bomControls={bomControls}
              onChangeBomControls={setBomControls}
              bodiceDartStyle={bodiceDartStyle}
              onChangeBodiceDartStyle={setBodiceDartStyle}
              sleeveEaseStrategy={sleeveEaseStrategy}
              onChangeSleeveEaseStrategy={setSleeveEaseStrategy}
              strictUncertaintyGate={strictUncertaintyGate}
              onToggleStrictUncertaintyGate={setStrictUncertaintyGate}
              requireApprovedGovernance={requireApprovedGovernance}
              onToggleRequireApprovedGovernance={setRequireApprovedGovernance}
              onCommitProductionBaseline={commitProductionBaseline}
              onSyncWorkingDraftSnapshot={syncWorkingDraftSnapshot}
              onNavigateToProduction={() => navigateToTab('production')}
              onNavigateToMeasurements={() => navigateToTab('measurements')}
              onUpdateSpec={updateSpec}
            />
          )}

          {activeTab === 'production' && (
            <ProductionOverview
              currentSpec={currentSpec}
              measurements={measurements}
              activeSize={activeSize}
              measurementProvenance={measurementProvenance}
              measurementApprovalState={measurementApprovalState}
              measurementProvenanceEvidence={measurementProvenanceEvidence}
              workspaceBundle={workspaceBundle}
              bomControls={bomControls}
              onChangeBomControls={setBomControls}
              onCommitProductionBaseline={commitProductionBaseline}
              onSyncWorkingDraftSnapshot={syncWorkingDraftSnapshot}
              onNavigateToCAD={() => navigateToTab('pattern-cad')}
            />
          )}
        </WorkspaceErrorBoundary>
      </main>

      {/* Atelier Footer */}
      <footer className="border-t border-neutral-200 bg-white py-5 px-4 lg:px-8 text-xs text-neutral-500 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="font-serif font-bold text-neutral-900">Patroner</span>
            <span className="text-neutral-300">·</span>
            <span>Fashion Design &amp; Pattern Engineering Platform</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-neutral-400 font-mono">
            <span>Centimetric Precision</span>
            <span>·</span>
            <span>ISO 13402 Anthropometrics</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <ProjectWorkspaceProvider>
      <WorkspaceShell />
    </ProjectWorkspaceProvider>
  );
}
