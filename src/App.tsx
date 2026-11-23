/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ProjectWorkspaceProvider, useProjectWorkspace } from './state/ProjectWorkspaceContext';
import {
  ViewportInteractionProvider,
  useViewportInteraction
} from './state/ViewportInteractionContext';
import { CreativeStudioProvider } from './features/creative-studio/CreativeStudioContext';
import { CreativeStudioWorkspace } from './features/creative-studio/CreativeStudioWorkspace';
import { VisualStudioShell } from './components/studio-shell/VisualStudioShell';
import { PatternWorkspace } from './features/pattern-workspace/PatternWorkspace';
import { ProductionOverview } from './features/production/ProductionOverview';

const ConnectedVisualWorkspace: React.FC = () => {
  const {
    currentSpec,
    conceptHistory,
    updateSpec,
    referenceImage,
    setReferenceImage,
    studioDraftBrief,
    updateStudioDraftBrief,
    activeSize,
    measurements,
    measurementProvenance,
    measurementApprovalState,
    measurementProvenanceEvidence,
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
    syncWorkingDraftSnapshot
  } = useProjectWorkspace();

  const {
    setEnvironment,
    setSimProdSubView,
    openDockTab,
    selectedPieceId,
    selectEntity,
    camera,
    updateCamera
  } = useViewportInteraction();

  return (
    <VisualStudioShell
      renderCreativeStudio={() => (
        <CreativeStudioWorkspace
          currentSpec={currentSpec}
          onUpdateSpec={updateSpec}
          referenceImage={referenceImage}
          onChangeReferenceImage={asset => {
            setReferenceImage(asset);
            if (asset) {
              selectEntity({
                kind: 'reference-image',
                id: `ref:${asset.name}`,
                label: asset.name,
                name: asset.name,
                sizeBytes: asset.sizeBytes
              });
            }
          }}
          draftBrief={studioDraftBrief}
          onUpdateDraftBrief={updateStudioDraftBrief}
          conceptHistory={conceptHistory}
        />
      )}
      renderPatternAtelier={() => (
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
          onNavigateToProduction={() => {
            setEnvironment('simulation-production');
            setSimProdSubView('production-overview');
          }}
          onNavigateToMeasurements={() => openDockTab('sizing-ease')}
          onUpdateSpec={updateSpec}
          selectedPieceId={selectedPieceId}
          onSelectPieceId={pieceId => {
            const found = workspaceBundle.pieces.find(p => p.id === pieceId);
            if (found) {
              selectEntity({
                kind: 'pattern-piece',
                id: found.id,
                pieceId: found.id,
                pieceCode: found.pieceCode,
                label: found.name
              });
            }
          }}
          onSelectSeam={(piece, seam) => {
            selectEntity({
              kind: 'seam',
              id: `${piece.id}:${seam.id}`,
              pieceId: piece.id,
              seamId: seam.id,
              label: `${piece.name} · ${seam.name}`,
              lengthCm: seam.lengthCm,
              pairedSeamName: seam.pairedSeamName
            });
          }}
          externalZoom={camera.zoom}
          onChangeZoom={nextZoom => updateCamera({ zoom: nextZoom }, `Set zoom ${Math.round(nextZoom * 100)}%`)}
        />
      )}
      renderProductionOverview={() => (
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
          onNavigateToCAD={() => setEnvironment('pattern-atelier')}
        />
      )}
    />
  );
};

export default function App() {
  return (
    <ProjectWorkspaceProvider>
      <CreativeStudioProvider>
        <ViewportInteractionProvider>
          <ConnectedVisualWorkspace />
        </ViewportInteractionProvider>
      </CreativeStudioProvider>
    </ProjectWorkspaceProvider>
  );
}
