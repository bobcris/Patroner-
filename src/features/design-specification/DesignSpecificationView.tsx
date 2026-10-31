/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { DesignSpecification, EaseProfile, GarmentConstructionFeature } from '../../types';
import { EASE_TABLE } from '../../engine/measurements/standards';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { CheckCircle2, ShieldCheck, ArrowRight, Plus, Trash2, Edit3, Compass, Scissors } from 'lucide-react';

interface DesignSpecificationViewProps {
  spec: DesignSpecification;
  onUpdateSpec: (updated: DesignSpecification) => void;
  onNavigateToMeasurements: () => void;
  onNavigateToCAD: () => void;
}

export const DesignSpecificationView: React.FC<DesignSpecificationViewProps> = ({
  spec,
  onUpdateSpec,
  onNavigateToMeasurements,
  onNavigateToCAD
}) => {
  const [newFeatureName, setNewFeatureName] = useState('');
  const [newFeatureDesc, setNewFeatureDesc] = useState('');
  const [newFeatureImpact, setNewFeatureImpact] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const toggleApproval = () => {
    onUpdateSpec({
      ...spec,
      isApproved: !spec.isApproved,
      approvedAt: !spec.isApproved ? new Date().toISOString() : undefined,
      version: spec.version + 1
    });
  };

  const handleEaseChange = (ease: EaseProfile) => {
    onUpdateSpec({
      ...spec,
      easeProfile: ease,
      version: spec.version + 1
    });
  };

  const handleAddFeature = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeatureName.trim()) return;

    const newFeature: GarmentConstructionFeature = {
      id: `feat-${Date.now()}`,
      category: 'closure',
      name: newFeatureName.trim(),
      description: newFeatureDesc.trim() || 'Custom designer specification.',
      patternImpact: newFeatureImpact.trim() || 'Deterministic offset applied during drafting.'
    };

    onUpdateSpec({
      ...spec,
      constructionFeatures: [...spec.constructionFeatures, newFeature],
      version: spec.version + 1
    });

    setNewFeatureName('');
    setNewFeatureDesc('');
    setNewFeatureImpact('');
    setShowAddModal(false);
  };

  const handleRemoveFeature = (id: string) => {
    onUpdateSpec({
      ...spec,
      constructionFeatures: spec.constructionFeatures.filter(f => f.id !== id),
      version: spec.version + 1
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-8">
      {/* Header with Approval Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-200 pb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-widest text-neutral-500 font-mono">Module 02</span>
            <span className="text-neutral-300">/</span>
            <Badge variant="dark" size="sm">Design Specification</Badge>
            <span className="text-neutral-400 font-mono text-xs">v{spec.version}</span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-serif font-bold text-neutral-900 tracking-tight">
            Technical Design Specification
          </h2>
          <p className="text-sm text-neutral-600 mt-1 max-w-2xl">
            Authoritative garment parameters. Deterministic pattern drafting reads strictly from this approved specification.
          </p>
        </div>

        {/* Approval Toggle */}
        <div className="flex items-center gap-3">
          {spec.isApproved ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-800 bg-emerald-50 border border-emerald-300 px-3 py-1.5 rounded flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                APPROVED FOR PATTERN DRAFTING
              </span>
              <Button variant="outline" size="sm" onClick={toggleApproval}>
                Revoke Approval
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={toggleApproval}
              icon={<ShieldCheck className="w-4 h-4" />}
              className="font-mono text-xs uppercase tracking-wider"
            >
              Approve Specification &amp; Lock Geometry
            </Button>
          )}
        </div>
      </div>

      {/* Main Spec Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Core Attributes */}
        <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-900 font-mono border-b border-neutral-100 pb-3 flex items-center justify-between">
            <span>Garment Classification</span>
            <Edit3 className="w-4 h-4 text-neutral-400" />
          </h3>

          <div className="space-y-4 text-xs">
            <div>
              <span className="text-neutral-400 font-mono uppercase block text-[10px]">DESIGN TITLE</span>
              <span className="font-semibold text-neutral-900 text-sm">{spec.name}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 font-mono">
              <div>
                <span className="text-neutral-400 uppercase block text-[10px]">CATEGORY</span>
                <span className="font-semibold text-neutral-800 uppercase">{spec.garmentCategory}</span>
              </div>
              <div>
                <span className="text-neutral-400 uppercase block text-[10px]">SILHOUETTE</span>
                <span className="font-semibold text-neutral-800 uppercase">{spec.silhouette}</span>
              </div>
            </div>

            <div>
              <span className="text-neutral-400 font-mono uppercase block text-[10px]">TARGET FINISHED LENGTH</span>
              <span className="font-semibold text-neutral-900 font-mono text-sm">{spec.lengthCm} cm</span>
              <span className="text-[10px] text-neutral-500 block">Measured from natural waistline to hem fold</span>
            </div>

            <div>
              <span className="text-neutral-400 font-mono uppercase block text-[10px]">COLOR SPECIFICATION</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-4 h-4 rounded-full border border-neutral-300" style={{ backgroundColor: spec.color.hex }} />
                <span className="font-medium text-neutral-800">{spec.color.name}</span>
                <span className="font-mono text-neutral-400">({spec.color.hex})</span>
              </div>
            </div>

            <div>
              <span className="text-neutral-400 font-mono uppercase block text-[10px]">ORIGINAL INSPIRATION PROMPT</span>
              <p className="text-neutral-600 bg-neutral-50 p-2.5 rounded border border-neutral-200 italic mt-1">
                "{spec.prompt}"
              </p>
            </div>
          </div>
        </div>

        {/* Fabric Properties & Ease Engine Matrix */}
        <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-900 font-mono border-b border-neutral-100 pb-3">
            Fabric &amp; Mechanical Ease
          </h3>

          <div className="space-y-4 text-xs">
            <div>
              <span className="text-neutral-400 font-mono uppercase block text-[10px]">SELECTED FABRIC</span>
              <span className="font-semibold text-neutral-900 text-sm">{spec.fabric.name}</span>
              <span className="text-neutral-500 block font-mono text-[11px]">{spec.fabric.composition}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 font-mono">
              <div>
                <span className="text-neutral-400 uppercase block text-[10px]">WEIGHT</span>
                <span className="font-semibold text-neutral-800 uppercase">{spec.fabric.weight}</span>
              </div>
              <div>
                <span className="text-neutral-400 uppercase block text-[10px]">MECHANICAL STRETCH</span>
                <span className="font-semibold text-neutral-800 uppercase">{spec.fabric.stretch}</span>
              </div>
            </div>

            {/* Ease selection */}
            <div>
              <label className="text-neutral-400 font-mono uppercase block text-[10px] mb-1.5">
                ACTIVE EASE PROFILE
              </label>
              <div className="space-y-1.5">
                {(['fitted', 'classic', 'relaxed'] as EaseProfile[]).map(ease => (
                  <button
                    key={ease}
                    type="button"
                    onClick={() => handleEaseChange(ease)}
                    className={`w-full text-left p-2.5 rounded border text-xs cursor-pointer transition-colors ${
                      spec.easeProfile === ease
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-800 hover:bg-neutral-100'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono font-medium uppercase text-[11px]">
                      <span>{ease}</span>
                      <span>
                        +{EASE_TABLE[ease].waist}cm W / +{EASE_TABLE[ease].hip}cm H
                      </span>
                    </div>
                    <p className={`text-[10px] mt-0.5 ${spec.easeProfile === ease ? 'text-neutral-300' : 'text-neutral-500'}`}>
                      {EASE_TABLE[ease].description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Construction Features & Assembly Rules */}
        <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-5">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-900 font-mono">
              Construction Features
            </h3>
            <button
              onClick={() => setShowAddModal(true)}
              className="text-xs text-neutral-700 hover:text-black font-medium flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Spec
            </button>
          </div>

          <div className="space-y-3">
            {spec.constructionFeatures.map(feat => (
              <div
                key={feat.id}
                className="p-3 border border-neutral-200 rounded-sm bg-neutral-50/50 hover:bg-neutral-50 transition-colors space-y-1 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-900">{feat.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase bg-neutral-200 px-1.5 py-0.5 rounded-xs text-neutral-700">
                      {feat.category}
                    </span>
                    <button
                      onClick={() => handleRemoveFeature(feat.id)}
                      className="text-neutral-400 hover:text-rose-600 transition-colors cursor-pointer"
                      title="Remove feature"
                      aria-label={`Remove ${feat.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-neutral-600 text-[11px]">{feat.description}</p>
                <div className="text-[10px] font-mono text-neutral-500 pt-1 border-t border-neutral-200/60">
                  <span className="font-semibold text-neutral-700">CAD IMPACT:</span> {feat.patternImpact}
                </div>
              </div>
            ))}
          </div>

          {/* Add feature inline form */}
          {showAddModal && (
            <form onSubmit={handleAddFeature} className="p-3 border border-neutral-300 rounded bg-white space-y-2">
              <span className="text-xs font-semibold uppercase font-mono block">Add Construction Detail</span>
              <input
                type="text"
                placeholder="Feature Name (e.g. Side Slit Vent)"
                value={newFeatureName}
                onChange={e => setNewFeatureName(e.target.value)}
                className="w-full text-xs p-2 border border-neutral-300 rounded"
                required
              />
              <input
                type="text"
                placeholder="Description"
                value={newFeatureDesc}
                onChange={e => setNewFeatureDesc(e.target.value)}
                className="w-full text-xs p-2 border border-neutral-300 rounded"
              />
              <input
                type="text"
                placeholder="Pattern Impact (e.g. +5cm overlap extension)"
                value={newFeatureImpact}
                onChange={e => setNewFeatureImpact(e.target.value)}
                className="w-full text-xs p-2 border border-neutral-300 rounded"
              />
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" type="button" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit">
                  Save Spec
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Bottom Next Steps Bar */}
      <div className="p-6 bg-neutral-900 text-white rounded-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="font-serif font-bold text-lg">Next: Configure Anatomical Measurements</h4>
          <p className="text-xs text-neutral-400">
            Link body measurements to this approved specification. The deterministic drafting engine will calculate finished cut patterns.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <Button
            variant="outline"
            size="md"
            onClick={onNavigateToMeasurements}
            className="text-white border-neutral-700 hover:bg-neutral-800 w-full md:w-auto font-mono text-xs uppercase"
            icon={<Compass className="w-4 h-4" />}
          >
            3. Body Measurements
          </Button>

          <Button
            variant="primary"
            size="md"
            onClick={onNavigateToCAD}
            className="bg-white text-neutral-900 hover:bg-neutral-100 w-full md:w-auto font-mono text-xs uppercase"
            icon={<Scissors className="w-4 h-4" />}
          >
            4. Pattern CAD Canvas <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
};
