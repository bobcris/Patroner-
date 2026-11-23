/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ArrowRight, ShieldAlert, X } from 'lucide-react';
import { PRESET_FABRICS } from '../../domain/design/preset-fabrics';
import { DesignSpecification } from '../../types';
import { PromotionFieldSelection, StructuredConceptAttributes } from './types';

export interface PromoteToAtelierModalProps {
  open: boolean;
  currentSpec: DesignSpecification;
  concept: StructuredConceptAttributes;
  onClose: () => void;
  onConfirmPromote: (selection: PromotionFieldSelection) => void;
}

const DEFAULT_SELECTION: PromotionFieldSelection = {
  includeTitle: true,
  includePrompt: true,
  includeCategoryAndSilhouette: true,
  includeFabric: true,
  includeColor: true,
  includeEaseProfile: true,
  includeTargetLength: true,
  includeConstructionFeatures: true,
  includeDesignNotes: true
};

export const PromoteToAtelierModal: React.FC<PromoteToAtelierModalProps> = ({
  open,
  currentSpec,
  concept,
  onClose,
  onConfirmPromote
}) => {
  const [selection, setSelection] = useState<PromotionFieldSelection>(DEFAULT_SELECTION);

  if (!open) return null;

  const selectedFabric = PRESET_FABRICS.find(f => f.id === concept.fabricId) ?? currentSpec.fabric;
  const anySelected = Object.values(selection).some(Boolean);

  const toggle = (key: keyof PromotionFieldSelection) => {
    setSelection(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const rows: Array<{
    key: keyof PromotionFieldSelection;
    label: string;
    currentValue: string;
    proposedValue: string;
  }> = [
    {
      key: 'includeTitle',
      label: 'Design Title',
      currentValue: currentSpec.name,
      proposedValue: concept.title
    },
    {
      key: 'includeCategoryAndSilhouette',
      label: 'Category & Silhouette',
      currentValue: `${currentSpec.garmentCategory} · ${currentSpec.silhouette}`,
      proposedValue: `${concept.garmentCategory} · ${concept.silhouette}`
    },
    {
      key: 'includeFabric',
      label: 'Target Material',
      currentValue: currentSpec.fabric.name,
      proposedValue: selectedFabric.name
    },
    {
      key: 'includeColor',
      label: 'Colorway',
      currentValue: `${currentSpec.color.name} (${currentSpec.color.hex})`,
      proposedValue: `${concept.colorName} (${concept.colorHex})`
    },
    {
      key: 'includeEaseProfile',
      label: 'Ease Profile',
      currentValue: currentSpec.easeProfile,
      proposedValue: concept.easeProfile
    },
    {
      key: 'includeTargetLength',
      label: 'Visual Target Length',
      currentValue: `${currentSpec.lengthCm} cm`,
      proposedValue: `${concept.lengthCm} cm`
    },
    {
      key: 'includePrompt',
      label: 'Creative Brief Summary',
      currentValue: currentSpec.prompt.slice(0, 64),
      proposedValue: concept.creativeBrief.slice(0, 64)
    },
    {
      key: 'includeConstructionFeatures',
      label: 'Construction Notes & Features',
      currentValue: `${currentSpec.constructionFeatures.length} features`,
      proposedValue: `${concept.constructionFeatures.length} features`
    },
    {
      key: 'includeDesignNotes',
      label: 'Atelier Design Notes',
      currentValue: `${currentSpec.designNotes.length} notes`,
      proposedValue: `${concept.constructionNotes.length} notes`
    }
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promote-atelier-title"
      data-testid="promote-to-atelier-modal"
      className="fixed inset-0 z-50 bg-neutral-950/50 flex items-center justify-center p-4"
      onPointerDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-neutral-300 rounded-sm shadow-2xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 id="promote-atelier-title" className="text-base font-serif font-semibold text-neutral-900">
              Promote Creative Intent to Pattern Atelier
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Select the exact fields to transfer into a new unapproved specification draft.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close promotion modal"
            className="p-1.5 text-neutral-500 hover:text-neutral-900 rounded-xs hover:bg-neutral-200/70 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 text-xs">
          {/* C8 Governance Notice */}
          <div className="p-3 rounded-xs bg-amber-50 border border-amber-200 text-amber-950 flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1 leading-relaxed">
              <p className="font-semibold">
                Promoted drafts always enter Pattern Atelier unapproved (isApproved: false)
              </p>
              <p className="text-[11px] text-amber-900">
                Explicitly excluded from transfer: AI-estimated body measurements, unconfirmed construction assumptions, image pixel dimensions, freehand sketch paths, and unverified visual overlays.
              </p>
            </div>
          </div>

          {/* Field Selection Table */}
          <div className="border border-neutral-200 rounded-xs overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-[11px] text-neutral-500">
                  <th className="py-2 px-3 w-10">Transfer</th>
                  <th className="py-2 px-3">Field</th>
                  <th className="py-2 px-3">Current Atelier Spec</th>
                  <th className="py-2 px-3">Creative Studio Proposal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map(row => (
                  <tr key={row.key} className="hover:bg-neutral-50/80">
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selection[row.key]}
                        onChange={() => toggle(row.key)}
                        aria-label={`Transfer ${row.label}`}
                        className="rounded-xs border-neutral-400 cursor-pointer"
                      />
                    </td>
                    <td className="py-2 px-3 font-medium text-neutral-900 whitespace-nowrap">
                      {row.label}
                    </td>
                    <td className="py-2 px-3 text-neutral-500 max-w-[180px] truncate" title={row.currentValue}>
                      {row.currentValue}
                    </td>
                    <td className="py-2 px-3 text-neutral-900 font-medium max-w-[200px] truncate" title={row.proposedValue}>
                      {row.proposedValue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-200/70 rounded-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-promote-atelier-btn"
            disabled={!anySelected}
            onClick={() => onConfirmPromote(selection)}
            className="px-4 py-1.5 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-xs inline-flex items-center gap-1.5 disabled:opacity-45 cursor-pointer transition-colors"
          >
            Confirm &amp; Promote Unapproved Draft
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
