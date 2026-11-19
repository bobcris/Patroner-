/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  BodiceDartStyle,
  BodyMeasurements,
  DesignSpecification,
  SleeveEaseStrategy,
  StandardSize
} from './types';
import { INITIAL_CONCEPTS } from './domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from './engine/measurements/standards';
import { Header, WorkspaceTab } from './components/layout/Header';
import { WorkspaceErrorBoundary } from './components/layout/WorkspaceErrorBoundary';
import { FashionStudio } from './features/fashion-studio/FashionStudio';
import { DesignSpecificationView } from './features/design-specification/DesignSpecificationView';
import { MeasurementWorkspace } from './features/measurements/MeasurementWorkspace';
import { PatternWorkspace } from './features/pattern-workspace/PatternWorkspace';
import { ProductionOverview } from './features/production/ProductionOverview';

import {
  buildAuthoritativeProductionWorkspaceBundle,
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementProvenanceEvidence,
  NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS,
  ProductionWorkspaceBomControls,
  transitionMeasurementProvenance
} from './engine/production';

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');
  const [currentSpec, setCurrentSpec] = useState<DesignSpecification>(INITIAL_CONCEPTS[0]);
  const [activeSize, setActiveSize] = useState<StandardSize | 'custom'>('M');
  const [measurements, setMeasurements] = useState<BodyMeasurements>({
    ...STANDARD_SIZING_SYSTEM.sizes.M,
    skirtLength: INITIAL_CONCEPTS[0].lengthCm
  });
  const [measurementProvenance, setMeasurementProvenance] = useState<MeasurementOrigin>('standard-chart');
  const [measurementApprovalState, setMeasurementApprovalState] = useState<MeasurementApprovalStatus>('unverified');
  const [measurementProvenanceEvidence, setMeasurementProvenanceEvidence] = useState<MeasurementProvenanceEvidence | undefined>(undefined);
  const [measurementRevisionCount, setMeasurementRevisionCount] = useState<number>(1);

  // Single authoritative state owner for shared BOM controls & governance options (P1-2A)
  const [bomControls, setBomControls] = useState<ProductionWorkspaceBomControls>(
    DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS
  );
  const [bodiceDartStyle, setBodiceDartStyle] = useState<BodiceDartStyle>(
    INITIAL_CONCEPTS[0].dartStyle ?? 'waist'
  );
  const [sleeveEaseStrategy, setSleeveEaseStrategy] = useState<SleeveEaseStrategy>(
    INITIAL_CONCEPTS[0].sleeveEaseStrategy ?? 'classic'
  );
  const [strictUncertaintyGate, setStrictUncertaintyGate] = useState<boolean>(true);
  const [requireApprovedGovernance, setRequireApprovedGovernance] = useState<boolean>(false);

  const handleUpdateSpec = (nextSpec: DesignSpecification) => {
    setCurrentSpec(nextSpec);
    if (nextSpec.dartStyle) {
      setBodiceDartStyle(nextSpec.dartStyle);
    }
    if (nextSpec.sleeveEaseStrategy) {
      setSleeveEaseStrategy(nextSpec.sleeveEaseStrategy);
    }
  };

  // Single authoritative production workspace bundle consumed by Header, Module 04, and Module 05
  const workspaceBundle = useMemo(
    () =>
      buildAuthoritativeProductionWorkspaceBundle({
        projectId: 'project-patroner-default',
        tenantId: 'tenant-studio-local',
        designSpec: currentSpec,
        measurements,
        activeSize: String(activeSize),
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
      }),
    [
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
    ]
  );

  const { isCadSupported, approvalVerification, draftValidation, pipelineReport } = workspaceBundle;

  const handleUpdateMeasurements = (
    m: BodyMeasurements,
    sizeLabel: StandardSize | 'custom',
    provenance?: MeasurementOrigin
  ) => {
    setMeasurements(m);
    setActiveSize(sizeLabel);
    const nextProvenance = provenance ?? (sizeLabel === 'custom' ? 'user-entered' : 'standard-chart');
    setMeasurementProvenance(nextProvenance);
    if (nextProvenance === 'standard-chart') {
      setMeasurementProvenanceEvidence(undefined);
    }
    // Changing any measurement invalidates prior measurement approval and requires explicit re-approval
    setMeasurementApprovalState('unverified');
    setMeasurementRevisionCount(prev => prev + 1);
  };

  const handleUpdateMeasurementProvenance = (
    nextOrigin: MeasurementOrigin,
    evidence?: MeasurementProvenanceEvidence
  ) => {
    const transition = transitionMeasurementProvenance(measurementProvenance, nextOrigin, evidence);
    if (!transition.isValid) {
      return;
    }
    setMeasurementProvenance(transition.nextOrigin);
    setMeasurementProvenanceEvidence(transition.evidence);
    if (NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS.has(transition.nextOrigin)) {
      setMeasurementApprovalState('unverified');
    }
    setMeasurementRevisionCount(prev => prev + 1);
  };

  const handleUpdateMeasurementApproval = (nextState: MeasurementApprovalStatus) => {
    if (nextState === 'approved' && NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS.has(measurementProvenance)) {
      return;
    }
    setMeasurementApprovalState(nextState);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-neutral-900 font-sans flex flex-col antialiased selection:bg-neutral-900 selection:text-white">
      {/* Global Header */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isApproved={approvalVerification.isValid}
        approvalState={approvalVerification.state}
        isCadSupported={isCadSupported}
        isDraftValid={isCadSupported && draftValidation.isValid}
        activeDesignName={currentSpec.name}
        specificationRevisionId={currentSpec.specificationRevisionId ?? `spec-${currentSpec.id}-v${currentSpec.version}`}
        isSynchronized={pipelineReport.isPipelineSynchronized}
      />

      {/* Main Workspace View Router */}
      <main className="flex-1">
        <WorkspaceErrorBoundary
          onResetWorkspace={() => {
            handleUpdateSpec(INITIAL_CONCEPTS[0]);
            setActiveTab('studio');
          }}
        >
          {activeTab === 'studio' && (
            <FashionStudio
              currentSpec={currentSpec}
              onUpdateSpec={handleUpdateSpec}
              onNavigateToSpec={() => setActiveTab('specification')}
            />
          )}

          {activeTab === 'specification' && (
            <DesignSpecificationView
              spec={currentSpec}
              onUpdateSpec={handleUpdateSpec}
              onNavigateToMeasurements={() => setActiveTab('measurements')}
              onNavigateToCAD={() => setActiveTab('pattern-cad')}
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
              measurementRevisionId={`meas-rev-${measurementRevisionCount}`}
              onUpdateMeasurements={handleUpdateMeasurements}
              onUpdateMeasurementApproval={handleUpdateMeasurementApproval}
              onUpdateMeasurementProvenance={handleUpdateMeasurementProvenance}
              onNavigateToCAD={() => setActiveTab('pattern-cad')}
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
              onNavigateToProduction={() => setActiveTab('production')}
              onNavigateToMeasurements={() => setActiveTab('measurements')}
              onUpdateSpec={handleUpdateSpec}
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
              onNavigateToCAD={() => setActiveTab('pattern-cad')}
            />
          )}
        </WorkspaceErrorBoundary>
      </main>

      {/* Atelier Footer */}
      <footer className="border-t border-neutral-200 bg-white py-6 px-4 lg:px-8 text-xs text-neutral-500 font-mono mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-bold text-neutral-900">PATRONER</span>
            <span>//</span>
            <span>Deterministic Fashion Design &amp; Pattern Engineering Platform</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-neutral-400">
            <span>Centimetric Precision</span>
            <span>•</span>
            <span>ISO 13402 Anthropometrics</span>
            <span>•</span>
            <span>Zero-Tolerance Seam Reconciliation</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
