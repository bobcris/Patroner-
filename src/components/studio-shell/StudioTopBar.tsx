/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Undo2,
  Redo2,
  PanelRight,
  PanelBottom,
  ShieldAlert,
  Sparkles,
  Scissors,
  Box
} from 'lucide-react';
import { useProjectWorkspace } from '../../state/ProjectWorkspaceContext';
import {
  StudioEnvironment,
  useViewportInteraction
} from '../../state/ViewportInteractionContext';
import { useOptionalCreativeStudio } from '../../features/creative-studio/CreativeStudioContext';

const ENVIRONMENT_ITEMS: ReadonlyArray<{
  id: StudioEnvironment;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'creative-studio', label: 'Creative Studio', shortLabel: 'Studio', icon: Sparkles },
  { id: 'pattern-atelier', label: 'Pattern Atelier', shortLabel: 'Atelier', icon: Scissors },
  { id: 'simulation-production', label: '3D & Production', shortLabel: '3D & Prod', icon: Box }
];

export const StudioTopBar: React.FC = () => {
  const { currentSpec, activeSize, workspaceBundle, isPackageStale, isSynchronized } =
    useProjectWorkspace();
  const {
    activeEnvironment,
    setEnvironment,
    canUndo: vpCanUndo,
    canRedo: vpCanRedo,
    undo: vpUndo,
    redo: vpRedo,
    historyPast,
    historyFuture,
    inspectorOpen,
    toggleInspector,
    dockOpen,
    toggleDock,
    openDockTab
  } = useViewportInteraction();
  const studio = useOptionalCreativeStudio();

  const isStudioEnv = activeEnvironment === 'creative-studio' && Boolean(studio);
  const canUndo = isStudioEnv ? Boolean(studio?.canUndo) : vpCanUndo;
  const canRedo = isStudioEnv ? Boolean(studio?.canRedo) : vpCanRedo;
  const handleUndo = isStudioEnv ? () => studio?.undoStudio() : vpUndo;
  const handleRedo = isStudioEnv ? () => studio?.redoStudio() : vpRedo;
  const undoTitle = isStudioEnv
    ? studio?.canUndo
      ? `Undo: ${studio.lastUndoLabel ?? 'Studio edit'}`
      : 'Nothing to undo in Creative Studio'
    : vpCanUndo
      ? `Undo: ${historyPast[historyPast.length - 1]?.actionLabel ?? 'Last viewport action'}`
      : 'Nothing to undo (ephemeral workspace history)';
  const redoTitle = isStudioEnv
    ? studio?.canRedo
      ? `Redo: ${studio.lastRedoLabel ?? 'Studio edit'}`
      : 'Nothing to redo'
    : vpCanRedo
      ? `Redo: ${historyFuture[0]?.actionLabel ?? 'Next viewport action'}`
      : 'Nothing to redo';

  const studioSaveLabel =
    !isStudioEnv || !studio
      ? null
      : studio.autosaveStatus === 'saving'
        ? 'Saving…'
        : studio.autosaveStatus === 'saved-indexeddb'
          ? 'Saved locally'
          : studio.autosaveStatus === 'session-only-memory'
            ? 'Session only'
            : studio.autosaveStatus === 'save-error'
              ? 'Save error'
              : null;

  const { isCadSupported, approvalVerification, draftValidation } = workspaceBundle;

  const statusText = !isCadSupported
    ? 'Specs Only'
    : approvalVerification.isValid
      ? 'Approved'
      : approvalVerification.state === 'revoked'
        ? 'Revoked'
        : approvalVerification.state === 'invalid'
          ? 'Spec Invalid'
          : 'Draft Spec';

  const statusTone = !isCadSupported
    ? 'text-neutral-400'
    : approvalVerification.isValid
      ? 'text-emerald-400'
      : approvalVerification.state === 'revoked' || approvalVerification.state === 'invalid'
        ? 'text-rose-400'
        : 'text-amber-300';

  const needsEngineeringReview =
    (isCadSupported && isPackageStale) ||
    !isCadSupported ||
    !approvalVerification.isValid ||
    !draftValidation.isValid ||
    !isSynchronized;

  return (
    <header
      data-testid="studio-top-bar"
      className="h-12 shrink-0 bg-[#151619] text-neutral-100 border-b border-neutral-800 px-3 lg:px-4 flex items-center justify-between gap-2 md:gap-4 z-40"
    >
      {/* Zone 1: Brand + Active Project Context (clean unboxed metadata) */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={() => setEnvironment('creative-studio')}
          className="text-base lg:text-lg font-serif font-semibold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded-xs"
        >
          Patroner
        </button>

        <span className="hidden md:inline text-neutral-700 shrink-0" aria-hidden="true">
          /
        </span>

        <div className="hidden md:flex items-center gap-2 min-w-0 text-xs">
          <span
            className="hidden xl:inline text-neutral-200 font-medium truncate max-w-[220px]"
            title={currentSpec.name}
          >
            {currentSpec.name}
          </span>
          <span className="hidden xl:inline text-neutral-600 shrink-0" aria-hidden="true">
            ·
          </span>
          <span className="hidden xl:inline text-neutral-400 capitalize whitespace-nowrap shrink-0">
            {currentSpec.garmentCategory}
          </span>
          <span className="hidden xl:inline text-neutral-600 shrink-0" aria-hidden="true">
            ·
          </span>
          <span className="hidden xl:inline font-mono tabular-nums text-neutral-400 whitespace-nowrap shrink-0">
            Size {String(activeSize).toUpperCase()}
          </span>
          <span className="hidden xl:inline text-neutral-600 shrink-0" aria-hidden="true">
            ·
          </span>
          <span className={`font-medium whitespace-nowrap shrink-0 ${statusTone}`}>
            {statusText}
          </span>
          {studioSaveLabel && (
            <>
              <span className="hidden xl:inline text-neutral-600 shrink-0" aria-hidden="true">
                ·
              </span>
              <span
                data-testid="studio-autosave-status"
                className={`hidden xl:inline text-[11px] whitespace-nowrap shrink-0 ${
                  studio?.autosaveStatus === 'session-only-memory' ||
                  studio?.autosaveStatus === 'save-error'
                    ? 'text-amber-300'
                    : 'text-neutral-400'
                }`}
              >
                {studioSaveLabel}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Zone 2: Three-Environment Navigation Switcher */}
      <nav
        role="tablist"
        aria-label="Workspace Environment"
        data-testid="environment-switcher"
        className="flex items-center bg-[#202227] border border-neutral-800 rounded-md p-0.5 shrink-0"
      >
        {ENVIRONMENT_ITEMS.map(item => {
          const Icon = item.icon;
          const isActive = activeEnvironment === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`env-tab-${item.id}`}
              onClick={() => setEnvironment(item.id)}
              className={`px-2.5 lg:px-3 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
                isActive
                  ? 'bg-neutral-100 text-neutral-950 shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline lg:hidden">{item.shortLabel}</span>
              <span className="hidden lg:inline">{item.label}</span>
              <span className="sm:hidden">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Zone 3: History, Panel Toggles & Engineering View */}
      <div className="flex items-center gap-1 shrink-0">
        <div
          className="flex items-center border-r border-neutral-800 pr-1.5 mr-0.5 gap-0.5"
          aria-label="Workspace History Controls"
        >
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            data-testid="viewport-undo-btn"
            title={undoTitle}
            aria-label={isStudioEnv ? 'Undo studio action' : 'Undo viewport action'}
            className="h-8 w-8 flex items-center justify-center rounded-sm text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            data-testid="viewport-redo-btn"
            title={redoTitle}
            aria-label={isStudioEnv ? 'Redo studio action' : 'Redo viewport action'}
            className="h-8 w-8 flex items-center justify-center rounded-sm text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={toggleDock}
          aria-pressed={dockOpen}
          data-testid="toggle-dock-btn"
          title={dockOpen ? 'Collapse bottom dock' : 'Expand bottom dock (Tech Spec, Sizing, History)'}
          className={`h-8 px-2.5 rounded-sm text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
            dockOpen
              ? 'bg-neutral-800 text-white'
              : 'text-neutral-300 hover:bg-neutral-800/70 hover:text-white'
          }`}
        >
          <PanelBottom className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden lg:inline">Dock</span>
        </button>

        <button
          type="button"
          onClick={toggleInspector}
          aria-pressed={inspectorOpen}
          data-testid="toggle-inspector-btn"
          title={inspectorOpen ? 'Hide contextual inspector' : 'Show contextual inspector'}
          className={`h-8 px-2.5 rounded-sm text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
            inspectorOpen
              ? 'bg-neutral-800 text-white'
              : 'text-neutral-300 hover:bg-neutral-800/70 hover:text-white'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden lg:inline">Inspector</span>
        </button>

        <button
          type="button"
          onClick={() => openDockTab('engineering')}
          data-testid="open-engineering-view-btn"
          title="Open Engineering Health & Governance View in bottom dock"
          className={`h-8 px-2.5 rounded-sm text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
            needsEngineeringReview
              ? 'border-amber-700/60 bg-amber-950/50 text-amber-200 hover:bg-amber-950/80'
              : 'border-neutral-700 bg-neutral-800/70 text-neutral-200 hover:bg-neutral-800'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">
            {isCadSupported && isPackageStale ? 'Stale' : 'Engineering'}
          </span>
        </button>
      </div>
    </header>
  );
};
