/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BodyMeasurements, DesignSpecification, StandardSize } from './types';
import { INITIAL_CONCEPTS } from './domain/design/curated-concepts';
import { STANDARD_SIZING_SYSTEM } from './engine/measurements/standards';
import { draftSkirtBlock } from './engine/drafting/skirt-block';
import { draftBodiceBlock } from './engine/drafting/bodice-block';
import { validatePatternDraft } from './engine/validation/seam-validator';
import { Header, WorkspaceTab } from './components/layout/Header';
import { FashionStudio } from './features/fashion-studio/FashionStudio';
import { DesignSpecificationView } from './features/design-specification/DesignSpecificationView';
import { MeasurementWorkspace } from './features/measurements/MeasurementWorkspace';
import { PatternWorkspace } from './features/pattern-workspace/PatternWorkspace';
import { ProductionOverview } from './features/production/ProductionOverview';

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');
  const [currentSpec, setCurrentSpec] = useState<DesignSpecification>(INITIAL_CONCEPTS[0]);
  const [activeSize, setActiveSize] = useState<StandardSize | 'custom'>('M');
  const [measurements, setMeasurements] = useState<BodyMeasurements>(STANDARD_SIZING_SYSTEM.sizes.M);

  // Compute live validation status for current draft
  const pieces = currentSpec.garmentCategory === 'bodice'
    ? draftBodiceBlock(measurements, currentSpec)
    : draftSkirtBlock(measurements, currentSpec);
  const validation = validatePatternDraft(pieces);

  const handleUpdateMeasurements = (m: BodyMeasurements, sizeLabel: StandardSize | 'custom') => {
    setMeasurements(m);
    setActiveSize(sizeLabel);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-neutral-900 font-sans flex flex-col antialiased selection:bg-neutral-900 selection:text-white">
      {/* Global Header */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isApproved={currentSpec.isApproved}
        isDraftValid={validation.isValid}
        activeDesignName={currentSpec.name}
      />

      {/* Main Workspace View Router */}
      <main className="flex-1">
        {activeTab === 'studio' && (
          <FashionStudio
            currentSpec={currentSpec}
            onUpdateSpec={setCurrentSpec}
            onNavigateToSpec={() => setActiveTab('specification')}
          />
        )}

        {activeTab === 'specification' && (
          <DesignSpecificationView
            spec={currentSpec}
            onUpdateSpec={setCurrentSpec}
            onNavigateToMeasurements={() => setActiveTab('measurements')}
            onNavigateToCAD={() => setActiveTab('pattern-cad')}
          />
        )}

        {activeTab === 'measurements' && (
          <MeasurementWorkspace
            currentMeasurements={measurements}
            activeSize={activeSize}
            currentSpec={currentSpec}
            onUpdateMeasurements={handleUpdateMeasurements}
            onNavigateToCAD={() => setActiveTab('pattern-cad')}
          />
        )}

        {activeTab === 'pattern-cad' && (
          <PatternWorkspace
            currentSpec={currentSpec}
            measurements={measurements}
            activeSize={activeSize}
            onNavigateToProduction={() => setActiveTab('production')}
            onNavigateToMeasurements={() => setActiveTab('measurements')}
          />
        )}

        {activeTab === 'production' && (
          <ProductionOverview
            currentSpec={currentSpec}
            measurements={measurements}
            activeSize={activeSize}
            onNavigateToCAD={() => setActiveTab('pattern-cad')}
          />
        )}
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
