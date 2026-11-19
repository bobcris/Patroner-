/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
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
  AuthoritativeProductionWorkspaceBundle,
  buildAuthoritativeProductionWorkspaceBundle,
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementProvenanceEvidence,
  NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS,
  PreviousPackageRevisionInput,
  ProductionWorkspaceBomControls,
  transitionMeasurementProvenance
} from './engine/production';

function extractRevisionBaseline(
  bundle: AuthoritativeProductionWorkspaceBundle
): PreviousPackageRevisionInput | undefined {
  if (!bundle.isCadSupported || !bundle.m05Package) return undefined;
  const tracking = bundle.m05Package.upstreamRevisionTracking;
  return {
    sourceSpecificationFingerprint: tracking.sourceSpecificationFingerprint,
    sourceMeasurementFingerprint: tracking.sourceMeasurementFingerprint,
    basePatternFingerprint: tracking.basePatternFingerprint ?? undefined,
    patternRevisionId: tracking.patternRevisionId,
    gradingControlsFingerprint: tracking.gradingControlsFingerprint,
    gradingReportSha256Hex: tracking.gradingReportSha256Hex,
    bomFingerprint: tracking.bomFingerprint
  };
}

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

  // Committed package baselines per garment ID for genuine upstream staleness propagation (P1-2 remediation)
  const [committedBaselinesByGarment, setCommittedBaselinesByGarment] = useState<
    Record<string, PreviousPackageRevisionInput>
  >({});

  const handleUpdateSpec = (nextSpec: DesignSpecification) => {
    const isSwitchingGarment =
      nextSpec.id !== currentSpec.id || nextSpec.garmentCategory !== currentSpec.garmentCategory;
    setCurrentSpec(nextSpec);

    if (isSwitchingGarment) {
      // Reset optional bodice/sleeve strategy state cleanly so previous garment choices never leak
      setBodiceDartStyle(nextSpec.dartStyle ?? 'waist');
      setSleeveEaseStrategy(nextSpec.sleeveEaseStrategy ?? 'classic');
    } else {
      if (nextSpec.dartStyle !== currentSpec.dartStyle) {
        setBodiceDartStyle(nextSpec.dartStyle ?? 'waist');
      }
      if (nextSpec.sleeveEaseStrategy !== currentSpec.sleeveEaseStrategy) {
        setSleeveEaseStrategy(nextSpec.sleeveEaseStrategy ?? 'classic');
      }
    }
  };

  const committedPreviousRevision = committedBaselinesByGarment[currentSpec.id];

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
        },
        previousPackageRevision: committedPreviousRevision
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
      measurementProvenanceEvidence,
      committedPreviousRevision
    ]
  );

  // Capture initial committed baseline for a newly visited garment (never overwrites once committed until explicit re-sync)
  useEffect(() => {
    if (committedBaselinesByGarment[currentSpec.id]) return;
    const baseline = extractRevisionBaseline(workspaceBundle);
    if (!baseline) return;
    setCommittedBaselinesByGarment(prev => {
      if (prev[currentSpec.id]) return prev;
      return {
        ...prev,
        [currentSpec.id]: baseline
      };
    });
  }, [currentSpec.id, committedBaselinesByGarment, workspaceBundle]);

  const handleResyncPackageBaseline = () => {
    const baseline = extractRevisionBaseline(workspaceBundle);
    if (!baseline) return;
    setCommittedBaselinesByGarment(prev => ({
      ...prev,
      [currentSpec.id]: baseline
    }));
  };

  const { isCadSupported, approvalVerification, draftValidation, pipelineReport } = workspaceBundle;
  const isPackageStale = workspaceBundle.upstreamStaleness.isStaleAgainstPrevious;

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
        isSynchronized={pipelineReport.isPipelineSynchronized && !isPackageStale}
        isPackageStale={isPackageStale}
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
              onResyncPackageBaseline={handleResyncPackageBaseline}
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
              onResyncPackageBaseline={handleResyncPackageBaseline}
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
