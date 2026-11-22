/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Sparkles,
  Wrench,
  Layers,
  Compass,
  Scissors,
  ShieldCheck,
  Activity,
  X,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Clock
} from 'lucide-react';
import { useProjectWorkspace, WorkshopTab } from '../../state/ProjectWorkspaceContext';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

const WORKSHOP_NAV_ITEMS: ReadonlyArray<{
  id: WorkshopTab;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'specification', label: 'Tech Spec', shortLabel: 'Spec', icon: Layers },
  { id: 'measurements', label: 'Sizing & Ease', shortLabel: 'Sizing', icon: Compass },
  { id: 'pattern-cad', label: 'Pattern CAD', shortLabel: 'Pattern CAD', icon: Scissors },
  { id: 'production', label: 'Production', shortLabel: 'Production', icon: ShieldCheck }
];

export const PlatformTopBar: React.FC = () => {
  const {
    experienceMode,
    activeTab,
    switchExperienceMode,
    navigateToTab,
    currentSpec,
    activeSize,
    workspaceBundle,
    isPackageStale,
    isSynchronized,
    specificationRevisionId,
    measurementRevisionId,
    referenceImage
  } = useProjectWorkspace();

  const [inspectorOpen, setInspectorOpen] = useState(false);

  const { isCadSupported, approvalVerification, draftValidation, exportValidation, m05Package } =
    workspaceBundle;

  // Single concise project status summary (replaces competing stacked badges)
  const projectStatusLabel = !isCadSupported
    ? 'Specs Only'
    : approvalVerification.isValid
      ? 'Approved'
      : approvalVerification.state === 'revoked'
        ? 'Revoked'
        : approvalVerification.state === 'invalid'
          ? 'Spec Invalid'
          : 'Draft Spec';

  const projectStatusTone = !isCadSupported
    ? 'text-neutral-600'
    : approvalVerification.isValid
      ? 'text-emerald-700'
      : approvalVerification.state === 'revoked' || approvalVerification.state === 'invalid'
        ? 'text-rose-700'
        : 'text-amber-700';

  // Consolidated engineering health state
  const healthState: 'healthy' | 'attention' | 'stale' = isCadSupported && isPackageStale
    ? 'stale'
    : !isCadSupported || !approvalVerification.isValid || !draftValidation.isValid || !isSynchronized
      ? 'attention'
      : 'healthy';

  const healthLabel =
    healthState === 'stale'
      ? 'Package Stale'
      : healthState === 'healthy'
        ? 'Health: Synced'
        : 'Health: Review';

  const healthDotClass =
    healthState === 'stale'
      ? 'bg-rose-500'
      : healthState === 'healthy'
        ? 'bg-emerald-500'
        : 'bg-amber-500';

  return (
    <>
      <header
        className="border-b border-neutral-200 bg-white/95 backdrop-blur-md sticky top-0 z-40"
        data-testid="platform-top-bar"
      >
        {/* Primary Unified Bar */}
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-2.5 flex items-center justify-between gap-2 md:gap-3">
          {/* Left: Brand + Active Project Title */}
          <div className="flex items-center gap-2.5 lg:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => switchExperienceMode('creative-studio')}
              className="flex items-baseline gap-1.5 shrink-0 cursor-pointer text-left focus:outline-none"
            >
              <span className="text-lg lg:text-xl font-serif tracking-tight font-bold text-neutral-900">
                Patroner
              </span>
            </button>

            <span className="h-4 w-px bg-neutral-200 shrink-0 hidden sm:inline-block" aria-hidden="true" />

            <div className="hidden sm:flex flex-col min-w-0">
              <span
                className="text-xs lg:text-sm font-medium text-neutral-900 truncate max-w-[150px] md:max-w-[170px] lg:max-w-[260px]"
                title={currentSpec.name}
                data-testid="topbar-project-title"
              >
                {currentSpec.name}
              </span>
              <span className="text-[11px] text-neutral-500 flex items-center gap-1.5 whitespace-nowrap">
                <span className="capitalize">{currentSpec.garmentCategory}</span>
                <span>·</span>
                <span>Size {String(activeSize)}</span>
                <span>·</span>
                <span className={`font-medium ${projectStatusTone}`} data-testid="topbar-project-status">
                  {projectStatusLabel}
                </span>
              </span>
            </div>
          </div>

          {/* Center: Dual-Experience Primary Mode Switcher */}
          <div
            role="tablist"
            aria-label="Experience Mode"
            className="inline-flex items-center rounded-md border border-neutral-200 bg-neutral-100/80 p-0.5 shrink-0"
            data-testid="experience-mode-switcher"
          >
            <button
              type="button"
              role="tab"
              aria-selected={experienceMode === 'creative-studio'}
              data-testid="mode-switch-creative-studio"
              onClick={() => switchExperienceMode('creative-studio')}
              className={`px-2.5 lg:px-3 py-1.5 text-xs font-medium rounded-sm transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                experienceMode === 'creative-studio'
                  ? 'bg-neutral-900 text-white shadow-2xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>Creative Studio</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={experienceMode === 'professional-workshop'}
              data-testid="mode-switch-professional-workshop"
              onClick={() => switchExperienceMode('professional-workshop')}
              className={`px-2.5 lg:px-3 py-1.5 text-xs font-medium rounded-sm transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                experienceMode === 'professional-workshop'
                  ? 'bg-neutral-900 text-white shadow-2xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Wrench className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline">Professional Workshop</span>
              <span className="lg:hidden">Workshop</span>
            </button>
          </div>

          {/* Right: Single Consolidated Engineering Health Indicator (opens Governance Inspector) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setInspectorOpen(true)}
              data-testid="engineering-health-trigger"
              aria-expanded={inspectorOpen}
              aria-controls="governance-inspector-drawer"
              className="inline-flex items-center gap-1.5 lg:gap-2 px-2.5 lg:px-3 py-1.5 text-xs font-medium rounded-sm border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${healthDotClass}`} />
              <span className="hidden lg:inline">{healthLabel}</span>
              <span className="lg:hidden">
                {healthState === 'stale' ? 'Stale' : healthState === 'healthy' ? 'Synced' : 'Review'}
              </span>
              <Activity className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            </button>
          </div>
        </div>

        {/* Experience-Specific Contextual Sub-Navigation */}
        <div className="border-t border-neutral-100 bg-stone-50/70">
          <div className="max-w-7xl mx-auto px-4 lg:px-8 flex items-center justify-between gap-3 min-h-[40px]">
            {experienceMode === 'creative-studio' ? (
              <>
                <div className="flex items-center gap-2.5 text-xs text-neutral-600 py-2 min-w-0">
                  <span className="font-medium text-neutral-900 whitespace-nowrap">
                    Concept &amp; Silhouette Direction
                  </span>
                  {referenceImage && (
                    <span
                      className="hidden md:inline-flex items-center gap-1 text-[11px] text-neutral-500 truncate max-w-[240px]"
                      data-testid="topbar-reference-attached"
                    >
                      · Reference attached: {referenceImage.name}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => navigateToTab('specification')}
                  data-testid="studio-to-workshop-link"
                  className="text-xs font-medium text-neutral-800 hover:text-neutral-950 inline-flex items-center gap-1 py-2 cursor-pointer whitespace-nowrap"
                >
                  <span>Open in Professional Workshop</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <nav
                className="flex items-center gap-1 overflow-x-auto w-full"
                aria-label="Professional Workshop Navigation"
                data-testid="workshop-subnav"
              >
                {WORKSHOP_NAV_ITEMS.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  const showCheck =
                    (item.id === 'specification' && approvalVerification.isValid) ||
                    (item.id === 'pattern-cad' && isCadSupported && draftValidation.isValid);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateToTab(item.id)}
                      data-testid={`workshop-nav-${item.id}`}
                      aria-current={isActive ? 'page' : undefined}
                      className={`relative px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap inline-flex items-center gap-1.5 cursor-pointer ${
                        isActive
                          ? 'text-neutral-950'
                          : 'text-neutral-500 hover:text-neutral-900'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline">{item.label}</span>
                      <span className="sm:hidden">{item.shortLabel}</span>
                      {showCheck && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      )}
                      {isActive && (
                        <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-neutral-900 rounded-full" />
                      )}
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        </div>
      </header>

      {/* Governance & Revision Inspector Drawer (Consolidated Engineering Detail) */}
      {inspectorOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-neutral-950/30 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label="Engineering Health & Governance Inspector"
          id="governance-inspector-drawer"
          data-testid="governance-inspector-drawer"
          onClick={e => {
            if (e.target === e.currentTarget) setInspectorOpen(false);
          }}
        >
          <div className="w-full max-w-md bg-white h-full shadow-xl border-l border-neutral-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-serif font-bold text-neutral-900">
                  Engineering Health &amp; Governance
                </h2>
                <p className="text-xs text-neutral-500">
                  Authoritative project revision &amp; verification state
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectorOpen(false)}
                aria-label="Close inspector"
                data-testid="close-governance-inspector"
                className="p-1.5 text-neutral-500 hover:text-neutral-900 rounded hover:bg-neutral-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {/* Project Identity */}
              <div className="border border-neutral-200 rounded-sm p-4 bg-stone-50/70 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                    Active Project
                  </span>
                  <Badge variant={approvalVerification.isValid ? 'success' : 'warning'} size="sm">
                    {projectStatusLabel}
                  </Badge>
                </div>
                <p className="text-sm font-serif font-bold text-neutral-900">{currentSpec.name}</p>
                <dl className="grid grid-cols-2 gap-2 pt-2 border-t border-neutral-200 font-mono text-[11px]">
                  <div>
                    <dt className="text-neutral-400">Spec Revision</dt>
                    <dd className="text-neutral-800 truncate" title={specificationRevisionId}>
                      {specificationRevisionId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-400">Measurement Rev</dt>
                    <dd className="text-neutral-800">{measurementRevisionId}</dd>
                  </div>
                </dl>
              </div>

              {/* Pipeline & Gate Health */}
              <div className="space-y-2.5">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                  Verification Gates
                </h3>

                <div className="border border-neutral-200 rounded-sm divide-y divide-neutral-100">
                  <div className="p-3 flex items-center justify-between gap-2">
                    <span className="text-neutral-700">Specification Approval</span>
                    {!isCadSupported ? (
                      <Badge variant="neutral" size="sm">Specs Only</Badge>
                    ) : approvalVerification.isValid ? (
                      <Badge variant="success" size="sm">Verified</Badge>
                    ) : (
                      <Badge variant="warning" size="sm" data-testid="header-approval-pending-badge">
                        Approval Pending
                      </Badge>
                    )}
                  </div>

                  <div className="p-3 flex items-center justify-between gap-2">
                    <span className="text-neutral-700">CAD Drafting Geometry</span>
                    {isCadSupported && draftValidation.isValid ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                      </span>
                    ) : !isCadSupported ? (
                      <span className="text-neutral-500">Not supported ({currentSpec.garmentCategory})</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" /> Needs review
                      </span>
                    )}
                  </div>

                  <div className="p-3 flex items-center justify-between gap-2">
                    <span className="text-neutral-700">Package Synchronization</span>
                    {isCadSupported && isPackageStale ? (
                      <Badge variant="danger" size="sm" data-testid="header-package-stale-badge">
                        Package Stale
                      </Badge>
                    ) : isSynchronized ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Synchronized
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                        <Clock className="w-3.5 h-3.5" /> Pending Sync
                      </span>
                    )}
                  </div>

                  <div className="p-3 flex items-center justify-between gap-2">
                    <span className="text-neutral-700">Production Package Gates</span>
                    <span className="font-mono text-neutral-800">
                      {m05Package ? `${m05Package.validation.passedCount}/10 passed` : 'Specs Only (N/A)'}
                    </span>
                  </div>

                  <div className="p-3 flex items-center justify-between gap-2">
                    <span className="text-neutral-700">DXF Export Gate</span>
                    <span className="font-mono text-neutral-800">
                      {exportValidation.isExportPermitted
                        ? 'Eligible'
                        : exportValidation.rejectionCode ?? 'Blocked'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Explicit Governance Honesty Boundaries */}
              <div className="border border-neutral-200 rounded-sm p-4 bg-neutral-50 space-y-2">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                  Platform Release Boundaries
                </h3>
                <ul className="space-y-1 font-mono text-[11px] text-neutral-600">
                  <li>isProductionReady: false</li>
                  <li>externalCadInteroperabilityVerified: false</li>
                  <li>M00 Governance Status: NOT ACCEPTED</li>
                  <li>Trouser Block: BLOCKED_MISSING_TROUSER_BLOCK</li>
                </ul>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-neutral-200 bg-stone-50 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigateToTab('specification');
                  setInspectorOpen(false);
                }}
              >
                Inspect Tech Spec
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  navigateToTab('production');
                  setInspectorOpen(false);
                }}
                icon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Open Production
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
