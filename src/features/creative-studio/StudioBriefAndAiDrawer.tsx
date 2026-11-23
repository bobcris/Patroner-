/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Info,
  Sparkles,
  SwatchBook,
  X
} from 'lucide-react';
import { PRESET_FABRICS } from '../../domain/design/preset-fabrics';
import { EaseProfile, GarmentCategory, Silhouette } from '../../types';
import { useViewportInteraction } from '../../state/ViewportInteractionContext';
import { useCreativeStudio } from './CreativeStudioContext';

const CATEGORIES: readonly GarmentCategory[] = ['skirt', 'bodice', 'trouser', 'dress'];
const SILHOUETTES: readonly Silhouette[] = [
  'straight',
  'a-line',
  'pencil',
  'flared',
  'tailored',
  'relaxed',
  'wrap'
];
const EASE_PROFILES: readonly EaseProfile[] = [
  'ultra-fitted',
  'fitted',
  'classic',
  'relaxed',
  'oversized'
];

export interface StudioBriefAndAiDrawerProps {
  onOpenPromoteModal: () => void;
}

export const StudioBriefAndAiDrawer: React.FC<StudioBriefAndAiDrawerProps> = ({
  onOpenPromoteModal
}) => {
  const {
    document: studioDoc,
    aiServiceStatus,
    isGeneratingVariations,
    lastAiBatchResult,
    updateConcept,
    addFabricSwatchLayer,
    generateVariations,
    selectAiCandidate,
    applyAiCandidateToBoard
  } = useCreativeStudio();

  const { briefDrawerOpen, setBriefDrawerOpen } = useViewportInteraction();
  const [drawerTab, setDrawerTab] = useState<'brief' | 'ai-gallery'>('brief');

  if (!briefDrawerOpen) return null;

  const concept = studioDoc.concept;

  return (
    <aside
      aria-label="Creative Brief and Concept Exploration"
      data-testid="studio-brief-ai-drawer"
      className="absolute right-0 top-0 bottom-0 z-30 w-full max-w-[360px] bg-white border-l border-neutral-300 shadow-xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="h-10 px-3 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between gap-2 shrink-0">
        <div role="tablist" aria-label="Brief and AI Tabs" className="flex items-center gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={drawerTab === 'brief'}
            data-testid="drawer-tab-brief"
            onClick={() => setDrawerTab('brief')}
            className={`px-2.5 py-1 rounded-xs text-xs font-medium cursor-pointer transition-colors ${
              drawerTab === 'brief'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Design Brief
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={drawerTab === 'ai-gallery'}
            data-testid="drawer-tab-ai-gallery"
            onClick={() => setDrawerTab('ai-gallery')}
            className={`px-2.5 py-1 rounded-xs text-xs font-medium cursor-pointer transition-colors ${
              drawerTab === 'ai-gallery'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Concept Gallery ({studioDoc.aiCandidates.length})
          </button>
        </div>
        <button
          type="button"
          onClick={() => setBriefDrawerOpen(false)}
          aria-label="Close brief and AI drawer"
          className="p-1 text-neutral-500 hover:text-neutral-900 rounded-xs hover:bg-neutral-200/70 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-4 text-xs">
        {drawerTab === 'brief' && (
          <>
            <div className="space-y-1">
              <label htmlFor="studio-concept-title" className="text-[11px] font-medium text-neutral-600 block">
                Concept Title
              </label>
              <input
                id="studio-concept-title"
                type="text"
                value={concept.title}
                onChange={e => updateConcept({ title: e.target.value })}
                className="w-full px-2.5 py-1.5 text-xs border border-neutral-300 rounded-xs bg-white text-neutral-900"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="studio-concept-brief" className="text-[11px] font-medium text-neutral-600 block">
                Creative Direction Brief
              </label>
              <textarea
                id="studio-concept-brief"
                rows={3}
                value={concept.creativeBrief}
                onChange={e => updateConcept({ creativeBrief: e.target.value })}
                className="w-full px-2.5 py-1.5 text-xs border border-neutral-300 rounded-xs bg-white text-neutral-900 resize-y"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="studio-concept-category" className="text-[11px] font-medium text-neutral-600 block">
                  Garment Category
                </label>
                <select
                  id="studio-concept-category"
                  value={concept.garmentCategory}
                  onChange={e =>
                    updateConcept({ garmentCategory: e.target.value as GarmentCategory }, true)
                  }
                  className="w-full px-2 py-1.5 text-xs border border-neutral-300 rounded-xs bg-white capitalize"
                >
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="studio-concept-silhouette" className="text-[11px] font-medium text-neutral-600 block">
                  Silhouette
                </label>
                <select
                  id="studio-concept-silhouette"
                  value={concept.silhouette}
                  onChange={e =>
                    updateConcept({ silhouette: e.target.value as Silhouette }, true)
                  }
                  className="w-full px-2 py-1.5 text-xs border border-neutral-300 rounded-xs bg-white capitalize"
                >
                  {SILHOUETTES.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="studio-concept-fabric" className="text-[11px] font-medium text-neutral-600">
                  Target Material
                </label>
                <button
                  type="button"
                  onClick={() => addFabricSwatchLayer(concept.fabricId)}
                  className="text-[11px] font-medium text-neutral-800 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <SwatchBook className="w-3 h-3" />
                  Pin Swatch
                </button>
              </div>
              <select
                id="studio-concept-fabric"
                value={concept.fabricId}
                onChange={e => updateConcept({ fabricId: e.target.value }, true)}
                className="w-full px-2 py-1.5 text-xs border border-neutral-300 rounded-xs bg-white"
              >
                {PRESET_FABRICS.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.weight})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="studio-concept-ease" className="text-[11px] font-medium text-neutral-600 block">
                  Ease Direction
                </label>
                <select
                  id="studio-concept-ease"
                  value={concept.easeProfile}
                  onChange={e =>
                    updateConcept({ easeProfile: e.target.value as EaseProfile }, true)
                  }
                  className="w-full px-2 py-1.5 text-xs border border-neutral-300 rounded-xs bg-white capitalize"
                >
                  {EASE_PROFILES.map(e => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="studio-concept-length" className="text-[11px] font-medium text-neutral-600 block">
                  Visual Target Length (cm)
                </label>
                <input
                  id="studio-concept-length"
                  type="number"
                  min={25}
                  max={160}
                  value={concept.lengthCm}
                  onChange={e =>
                    updateConcept({
                      lengthCm: Math.max(25, Math.min(160, Number(e.target.value) || 68))
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-neutral-300 rounded-xs bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="studio-concept-color-name" className="text-[11px] font-medium text-neutral-600 block">
                  Colorway Name
                </label>
                <input
                  id="studio-concept-color-name"
                  type="text"
                  value={concept.colorName}
                  onChange={e => updateConcept({ colorName: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs border border-neutral-300 rounded-xs bg-white"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="studio-concept-color-hex" className="text-[11px] font-medium text-neutral-600 block">
                  Color Swatch
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="studio-concept-color-hex"
                    type="color"
                    value={concept.colorHex}
                    onChange={e => updateConcept({ colorHex: e.target.value })}
                    className="h-8 w-10 p-0.5 border border-neutral-300 rounded-xs bg-white cursor-pointer"
                  />
                  <span className="font-mono tabular-nums text-[11px] text-neutral-700 uppercase">
                    {concept.colorHex}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-neutral-200 space-y-2">
              <button
                type="button"
                data-testid="brief-generate-demo-btn"
                onClick={async () => {
                  setDrawerTab('ai-gallery');
                  await generateVariations();
                }}
                disabled={isGeneratingVariations}
                className="w-full px-3 py-2 text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Explore Demonstration Variations
              </button>
            </div>
          </>
        )}

        {drawerTab === 'ai-gallery' && (
          <>
            {/* C2: Separated Service Availability Status */}
            <div
              data-testid="ai-service-availability-panel"
              className="p-2.5 rounded-xs border border-neutral-200 bg-neutral-50 space-y-1"
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-neutral-900">
                  Service: {aiServiceStatus.label}
                </span>
                <span className="font-mono text-[10px] text-amber-800">
                  {aiServiceStatus.availability}
                </span>
              </div>
              <p className="text-[11px] text-neutral-600 leading-relaxed">
                {aiServiceStatus.description}
              </p>
            </div>

            <button
              type="button"
              data-testid="generate-variations-btn"
              onClick={() => void generateVariations()}
              disabled={isGeneratingVariations}
              className="w-full px-3 py-2 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isGeneratingVariations
                ? 'Synthesizing variations...'
                : 'Generate 3 Demonstration Variations'}
            </button>

            {/* Explicit Operation Outcome Disclosure */}
            {lastAiBatchResult && (
              <div
                data-testid="ai-operation-outcome-banner"
                className={`p-2.5 rounded-xs border text-[11px] flex items-start gap-2 ${
                  lastAiBatchResult.operationOutcome === 'failed-operation'
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-amber-50/80 border-amber-200 text-amber-950'
                }`}
              >
                {lastAiBatchResult.operationOutcome === 'failed-operation' ? (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-700" />
                ) : (
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-700" />
                )}
                <div className="space-y-0.5">
                  <p className="font-medium">
                    Outcome: {lastAiBatchResult.operationOutcome} · Reference images analyzed:{' '}
                    {lastAiBatchResult.analyzedReferenceImages ? 'Yes' : 'No'}
                  </p>
                  <p className="leading-snug">
                    {lastAiBatchResult.errorMessage ?? lastAiBatchResult.statusNote}
                  </p>
                </div>
              </div>
            )}

            {/* Results Gallery */}
            {studioDoc.aiCandidates.length === 0 ? (
              <p className="text-[11px] text-neutral-500 text-center py-6 leading-relaxed">
                No concept variations generated yet. Generated candidates appear here for inspection and never overwrite your active specification automatically.
              </p>
            ) : (
              <div className="space-y-2.5" data-testid="ai-candidates-gallery">
                {studioDoc.aiCandidates.map(cand => {
                  const isSelected = studioDoc.selectedCandidateId === cand.id;
                  return (
                    <div
                      key={cand.id}
                      data-testid={`ai-candidate-card-${cand.id}`}
                      onClick={() => selectAiCandidate(cand.id)}
                      className={`p-3 rounded-xs border transition-colors cursor-pointer space-y-2 ${
                        isSelected
                          ? 'border-neutral-900 bg-neutral-50'
                          : 'border-neutral-200 bg-white hover:border-neutral-400'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="text-xs font-semibold text-neutral-900 leading-snug">
                            {cand.title}
                          </h4>
                          <p className="text-[10px] text-neutral-500 mt-0.5">
                            {cand.operationOutcome} · Images analyzed:{' '}
                            {cand.analyzedReferenceImages ? 'Yes' : 'No'}
                          </p>
                        </div>
                        <span
                          className="w-4 h-4 rounded-xs border border-neutral-300 shrink-0 mt-0.5"
                          style={{ backgroundColor: cand.colorHex }}
                          title={cand.colorName}
                        />
                      </div>

                      <p className="text-[11px] text-neutral-600 leading-relaxed">
                        {cand.summary}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-neutral-500 font-mono tabular-nums">
                        <span className="capitalize">{cand.silhouette}</span>
                        <span>·</span>
                        <span className="capitalize">{cand.easeProfile}</span>
                        <span>·</span>
                        <span>{cand.lengthCm} cm</span>
                      </div>

                      <div className="space-y-1 pt-1.5 border-t border-neutral-100">
                        {cand.epistemicClaims.map((claim, idx) => (
                          <div key={idx} className="text-[10px] text-neutral-600">
                            <span className="font-mono text-neutral-500">{claim.tag}</span>{' '}
                            <span className="text-neutral-800">{claim.field}: {claim.value}</span>
                          </div>
                        ))}
                      </div>

                      <div className="pt-1.5 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          data-testid={`apply-candidate-btn-${cand.id}`}
                          onClick={e => {
                            e.stopPropagation();
                            applyAiCandidateToBoard(cand.id);
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-xs inline-flex items-center gap-1 cursor-pointer"
                        >
                          {cand.appliedToBoardAt ? (
                            <>
                              <Check className="w-3 h-3" />
                              Applied to Board
                            </>
                          ) : (
                            'Apply to Board & Brief'
                          )}
                        </button>
                        <span className="text-[10px] text-neutral-400">Non-authoritative</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer: Explicit Atelier Promotion Trigger */}
      <div className="p-3 border-t border-neutral-200 bg-neutral-50 shrink-0 space-y-1.5">
        <button
          type="button"
          data-testid="drawer-promote-atelier-btn"
          onClick={onOpenPromoteModal}
          className="w-full px-3 py-2 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
        >
          Promote Selected Intent to Atelier
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <p className="text-[10px] text-neutral-500 text-center">
          Transfers confirmed fields only as an unapproved draft spec.
        </p>
      </div>
    </aside>
  );
};
