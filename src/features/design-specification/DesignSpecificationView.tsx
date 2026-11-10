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

import {
  computeSpecificationFingerprint,
  SPECIFICATION_CANONICAL_SCHEMA_VERSION,
  verifySpecificationApproval
} from '../../engine/production';

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

  const canonicalFingerprint = computeSpecificationFingerprint(spec);
  const approvalVerification = verifySpecificationApproval(spec);
  const effectiveAuthorityTier = approvalVerification.isValid
    ? (approvalVerification.authorityTier ?? 'unauthenticated_local_session')
    : undefined;

  const toggleApproval = () => {
    const willBeApproved = !approvalVerification.isValid;
    const now = new Date().toISOString();
    const specRevId = willBeApproved
      ? (spec.specificationRevisionId ?? `spec-${spec.id}-v${spec.version}`)
      : `spec-${spec.id}-v${spec.version + 1}`;

    if (willBeApproved) {
      const updatedSpec: DesignSpecification = {
        ...spec,
        isApproved: true,
        approvalState: 'approved',
        approvalAuthorityTier: 'unauthenticated_local_session',
        approvedAt: now,
        approvedBy: 'Local Atelier Operator',
        approvalProvenance: 'unauthenticated-local-approval',
        specificationRevisionId: specRevId,
        supersededByRevisionId: undefined
      };
      const fp = computeSpecificationFingerprint(updatedSpec);
      const eventId = `evt-approve-${specRevId}`;
      const approvalRecord = {
        eventId,
        approverId: 'approver-local-session',
        approverName: 'Local Atelier Operator',
        authorityTier: 'unauthenticated_local_session' as const,
        approvedAt: now,
        targetRevisionId: specRevId,
        targetSpecificationFingerprint: fp,
        notes: 'Unauthenticated local session approval for CAD simulation',
        provenance: 'unauthenticated-local-approval' as const
      };
      const approvalEvent = {
        id: eventId,
        eventType: 'approval' as const,
        targetRevisionId: specRevId,
        targetSpecificationFingerprint: fp,
        approverId: 'approver-local-session',
        approverName: 'Local Atelier Operator',
        authorityTier: 'unauthenticated_local_session' as const,
        approvedAt: now,
        notes: 'Unauthenticated local session approval for CAD simulation',
        provenance: 'unauthenticated-local-approval' as const
      };
      updatedSpec.approvalRecord = approvalRecord;
      updatedSpec.approvalHistory = [...(spec.approvalHistory ?? []), approvalEvent];
      onUpdateSpec(updatedSpec);
    } else {
      const revocationEvent = {
        id: `evt-revoke-${specRevId}`,
        eventType: 'revocation' as const,
        originalApprovalEventId: spec.approvalRecord?.eventId,
        targetRevisionId: spec.specificationRevisionId ?? specRevId,
        targetSpecificationFingerprint: canonicalFingerprint,
        revokerId: 'operator-local-revoker',
        revokerName: 'Local Atelier Operator',
        authorityTier: 'unauthenticated_local_session' as const,
        revokedAt: now,
        reason: 'Revoked by user in Design Specification'
      };
      onUpdateSpec({
        ...spec,
        isApproved: false,
        approvalState: 'revoked',
        approvalAuthorityTier: undefined,
        approvedAt: undefined,
        approvedBy: undefined,
        approvalRecord: spec.approvalRecord ? {
          ...spec.approvalRecord,
          revocationReason: 'Revoked by user in Design Specification'
        } : undefined,
        revocationRecord: revocationEvent,
        approvalHistory: [...(spec.approvalHistory ?? []), revocationEvent],
        approvalProvenance: 'designer-edited',
        version: spec.version + 1,
        parentRevisionId: spec.specificationRevisionId,
        specificationRevisionId: specRevId
      });
    }
  };

  const handleLengthChange = (newLengthCm: number) => {
    if (newLengthCm <= 30 || newLengthCm >= 150) return;
    const nextVersion = spec.version + 1;
    const nextRevId = `spec-${spec.id}-v${nextVersion}`;
    onUpdateSpec({
      ...spec,
      lengthCm: newLengthCm,
      targetFinishedDimensions: {
        ...spec.targetFinishedDimensions,
        length: newLengthCm
      },
      version: nextVersion,
      parentRevisionId: spec.specificationRevisionId,
      specificationRevisionId: nextRevId,
      isApproved: false,
      approvalState: 'draft',
      approvalAuthorityTier: undefined,
      approvalRecord: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
      approvalProvenance: 'designer-edited'
    });
  };

  const handleEaseChange = (ease: EaseProfile) => {
    const nextVersion = spec.version + 1;
    onUpdateSpec({
      ...spec,
      easeProfile: ease,
      explicitEaseCm: undefined,
      version: nextVersion,
      parentRevisionId: spec.specificationRevisionId,
      specificationRevisionId: `spec-${spec.id}-v${nextVersion}`,
      isApproved: false,
      approvalState: 'draft',
      approvalAuthorityTier: undefined,
      approvalRecord: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
      approvalProvenance: 'designer-edited'
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

    const nextVersion = spec.version + 1;
    onUpdateSpec({
      ...spec,
      constructionFeatures: [...spec.constructionFeatures, newFeature],
      version: nextVersion,
      parentRevisionId: spec.specificationRevisionId,
      specificationRevisionId: `spec-${spec.id}-v${nextVersion}`,
      isApproved: false,
      approvalState: 'draft',
      approvalAuthorityTier: undefined,
      approvalRecord: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
      approvalProvenance: 'designer-edited'
    });

    setNewFeatureName('');
    setNewFeatureDesc('');
    setNewFeatureImpact('');
    setShowAddModal(false);
  };

  const handleRemoveFeature = (id: string) => {
    const nextVersion = spec.version + 1;
    onUpdateSpec({
      ...spec,
      constructionFeatures: spec.constructionFeatures.filter(f => f.id !== id),
      version: nextVersion,
      parentRevisionId: spec.specificationRevisionId,
      specificationRevisionId: `spec-${spec.id}-v${nextVersion}`,
      isApproved: false,
      approvalState: 'draft',
      approvalAuthorityTier: undefined,
      approvalRecord: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
      approvalProvenance: 'designer-edited'
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
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {approvalVerification.isValid ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-emerald-800 bg-emerald-50 border border-emerald-300 px-3 py-1.5 rounded flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>APPROVED FOR PATTERN DRAFTING</span>
                <span className="text-[10px] text-emerald-700 border-l border-emerald-300 pl-1.5">
                  {effectiveAuthorityTier === 'demonstration_fixture'
                    ? 'Tier 1: Demonstration Fixture (Non-Authoritative)'
                    : effectiveAuthorityTier === 'authenticated_designer' && spec.approvalRecord?.verifiedIdentity
                    ? `Tier 3: Authenticated Designer (${spec.approvalRecord.verifiedIdentity.subject})`
                    : effectiveAuthorityTier === 'cryptographic_principal' && spec.approvalRecord?.cryptographicSignature
                    ? `Tier 4: Cryptographic Principal (${spec.approvalRecord.cryptographicSignature.keyId})`
                    : 'Tier 2: Local Unauthenticated Session'}
                </span>
              </span>
              <Button variant="outline" size="sm" onClick={toggleApproval}>
                Revoke Approval
              </Button>
            </div>
          ) : approvalVerification.state === 'revoked' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-rose-800 bg-rose-50 border border-rose-300 px-3 py-1.5 rounded flex items-center gap-1.5">
                <span>APPROVAL REVOKED</span>
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={toggleApproval}
                icon={<ShieldCheck className="w-4 h-4" />}
                className="font-mono text-xs uppercase tracking-wider"
              >
                Re-Approve (Local Session)
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-amber-800 bg-amber-50 border border-amber-300 px-3 py-1.5 rounded flex items-center gap-1.5">
                <span>DRAFT SPECIFICATION ({approvalVerification.state.toUpperCase()})</span>
              </span>
              <Button
                variant="primary"
                size="md"
                onClick={toggleApproval}
                icon={<ShieldCheck className="w-4 h-4" />}
                className="font-mono text-xs uppercase tracking-wider"
              >
                Approve Specification (Local Session)
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Authority Tier & Canonical Fingerprint Provenance Banner */}
      <div className="bg-stone-50 border border-stone-200 rounded-sm p-4 text-xs font-mono space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-neutral-900">CANONICAL LINEAGE (SCHEMA {SPECIFICATION_CANONICAL_SCHEMA_VERSION}):</span>
            <span className="text-neutral-600">
              REV: {spec.specificationRevisionId ?? `spec-${spec.id}-v${spec.version}`}
            </span>
            {spec.parentRevisionId && (
              <span className="text-neutral-500">← PARENT: {spec.parentRevisionId}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral" size="sm">isProductionReady: false</Badge>
            <Badge variant={approvalVerification.isValid ? 'success' : 'warning'} size="sm">
              VERIFICATION: {approvalVerification.state.toUpperCase()}
            </Badge>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-neutral-600 pt-1 border-t border-stone-200">
          <span className="truncate">
            SHA-256 FINGERPRINT: <span className="text-neutral-900 font-semibold">{canonicalFingerprint}</span>
          </span>
          <span className="text-neutral-500 shrink-0">
            Note: SHA-256 is an integrity digest; local session approval does not constitute an external identity or PKI signature.
          </span>
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
              <div className="flex items-center justify-between">
                <span className="text-neutral-400 font-mono uppercase block text-[10px]">TARGET FINISHED LENGTH</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleLengthChange(64)}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded border cursor-pointer ${
                      spec.lengthCm === 64
                        ? 'bg-neutral-900 text-white border-neutral-900 font-bold'
                        : 'bg-neutral-100 hover:bg-neutral-200 border-neutral-300 text-neutral-700'
                    }`}
                  >
                    64 cm
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLengthChange(68)}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded border cursor-pointer ${
                      spec.lengthCm === 68
                        ? 'bg-neutral-900 text-white border-neutral-900 font-bold'
                        : 'bg-neutral-100 hover:bg-neutral-200 border-neutral-300 text-neutral-700'
                    }`}
                  >
                    68 cm
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLengthChange(72)}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded border cursor-pointer ${
                      spec.lengthCm === 72
                        ? 'bg-neutral-900 text-white border-neutral-900 font-bold'
                        : 'bg-neutral-100 hover:bg-neutral-200 border-neutral-300 text-neutral-700'
                    }`}
                  >
                    72 cm
                  </button>
                </div>
              </div>
              <span className="font-semibold text-neutral-900 font-mono text-base block mt-0.5">{spec.lengthCm} cm</span>
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
                        +{spec.easeProfile === ease && spec.explicitEaseCm?.waist !== undefined ? spec.explicitEaseCm.waist : EASE_TABLE[ease].waist}cm W / +{spec.easeProfile === ease && spec.explicitEaseCm?.hip !== undefined ? spec.explicitEaseCm.hip : EASE_TABLE[ease].hip}cm H
                        {spec.easeProfile === ease && spec.explicitEaseCm && ' (Authoritative)'}
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
