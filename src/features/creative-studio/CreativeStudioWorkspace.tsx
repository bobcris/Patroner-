/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  Layers,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { DesignSpecification } from '../../types';
import {
  ReferenceImageAsset,
  StudioDraftBrief
} from '../../state/ProjectWorkspaceContext';
import { useViewportInteraction } from '../../state/ViewportInteractionContext';
import { useCreativeStudio } from './CreativeStudioContext';
import { StudioLayersPanel } from './StudioLayersPanel';
import { StudioVisualCanvas } from './StudioVisualCanvas';
import { StudioBriefAndAiDrawer } from './StudioBriefAndAiDrawer';
import { PromoteToAtelierModal } from './PromoteToAtelierModal';
import { StudioPerfBoundary } from './perf-probe';

export interface CreativeStudioWorkspaceProps {
  currentSpec: DesignSpecification;
  onUpdateSpec: (spec: DesignSpecification) => void;
  referenceImage: ReferenceImageAsset | null;
  onChangeReferenceImage: (asset: ReferenceImageAsset | null) => void;
  draftBrief: StudioDraftBrief;
  onUpdateDraftBrief: (patch: Partial<StudioDraftBrief>) => void;
  conceptHistory: readonly DesignSpecification[];
}

export const CreativeStudioWorkspace: React.FC<CreativeStudioWorkspaceProps> = ({
  currentSpec
}) => {
  const {
    document: studioDoc,
    activeCollectionLayers,
    persistenceMode,
    storageWarning,
    recoveryBanner,
    dismissRecoveryBanner,
    uploadReferenceFiles,
    replaceImageLayerAsset,
    clearBoard,
    promoteConceptToAtelier,
    exportRecoveryBundleJson
  } = useCreativeStudio();

  const {
    layersPanelOpen,
    toggleLayersPanel,
    briefDrawerOpen,
    toggleBriefDrawer,
    setEnvironment,
    setSelectedLayerIds,
    clearLayerSelection
  } = useViewportInteraction();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replacingLayerId, setReplacingLayerId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState<boolean>(false);
  const [promoteModalOpen, setPromoteModalOpen] = useState<boolean>(false);

  const handleTriggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenPromoteModal = useCallback(() => {
    setPromoteModalOpen(true);
  }, []);

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const summary = await uploadReferenceFiles(files);
    if (summary.addedLayerIds.length > 0) {
      setSelectedLayerIds(summary.addedLayerIds);
    }
    if (summary.errors.length > 0) {
      setUploadError(summary.errors[0]);
    } else {
      setUploadError(null);
    }
    e.target.value = '';
  };

  const handleRequestReplaceAsset = useCallback((layerId: string) => {
    setReplacingLayerId(layerId);
    replaceInputRef.current?.click();
  }, []);

  const handleReplaceFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && replacingLayerId) {
      const res = await replaceImageLayerAsset(replacingLayerId, file);
      if (!res.ok && res.error) setUploadError(res.error);
      else setUploadError(null);
    }
    setReplacingLayerId(null);
    e.target.value = '';
  };

  const handleExportRecoveryBundle = async () => {
    const json = await exportRecoveryBundleJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `patroner-creative-studio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const activeLayerCount = activeCollectionLayers.length;

  return (
    <div
      data-testid="creative-studio-workspace"
      className="w-full h-full flex flex-col overflow-hidden bg-[#EFECE5]"
    >
      {/* C3 Persistent Warning when running in Session-Only Memory Fallback */}
      {persistenceMode === 'memory-session-only' && storageWarning && (
        <div
          role="alert"
          data-testid="studio-session-only-warning"
          className="px-3 py-1.5 bg-amber-50 border-b border-amber-300 text-amber-950 text-[11px] flex flex-wrap items-center justify-between gap-2 shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span className="truncate">{storageWarning}</span>
          </div>
          <button
            type="button"
            data-testid="export-session-recovery-btn"
            onClick={() => void handleExportRecoveryBundle()}
            className="px-2 py-0.5 text-[11px] font-medium bg-amber-900 text-white rounded-xs hover:bg-amber-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3 h-3" />
            Export Recovery Backup
          </button>
        </div>
      )}

      {/* Optional Schema/Document Recovery Banner */}
      {recoveryBanner && (
        <div
          data-testid="studio-recovery-banner"
          className="px-3 py-1.5 bg-neutral-100 border-b border-neutral-300 text-neutral-800 text-[11px] flex items-center justify-between gap-2 shrink-0"
        >
          <span className="truncate">{recoveryBanner}</span>
          <button
            type="button"
            onClick={dismissRecoveryBanner}
            aria-label="Dismiss recovery notice"
            className="p-0.5 text-neutral-500 hover:text-neutral-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Upload Validation Error Banner */}
      {uploadError && (
        <div
          role="alert"
          data-testid="studio-upload-error"
          className="px-3 py-1.5 bg-rose-50 border-b border-rose-200 text-rose-900 text-[11px] flex items-center justify-between gap-2 shrink-0"
        >
          <span className="truncate">{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            aria-label="Dismiss upload error"
            className="p-0.5 text-rose-600 hover:text-rose-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Slim Creative Studio Action Bar */}
      <div
        data-testid="studio-action-bar"
        className="h-10 px-3 bg-white border-b border-neutral-200 flex items-center justify-between gap-2 shrink-0 text-xs overflow-x-auto"
      >
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="toggle-layers-panel-btn"
            aria-pressed={layersPanelOpen}
            onClick={toggleLayersPanel}
            className={`h-7 px-2.5 rounded-xs text-[11px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              layersPanelOpen
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Layers</span>
            <span className="font-mono tabular-nums opacity-75">({activeLayerCount})</span>
          </button>

          <button
            type="button"
            data-testid="studio-upload-images-btn"
            onClick={handleTriggerUpload}
            className="h-7 px-2.5 rounded-xs text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Images</span>
          </button>

          <button
            type="button"
            data-testid="toggle-brief-drawer-btn"
            aria-pressed={briefDrawerOpen}
            onClick={toggleBriefDrawer}
            className={`h-7 px-2.5 rounded-xs text-[11px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              briefDrawerOpen
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Brief &amp; AI</span>
            {studioDoc.aiCandidates.length > 0 && (
              <span className="font-mono tabular-nums opacity-75">
                ({studioDoc.aiCandidates.length})
              </span>
            )}
          </button>

          {studioDoc.isDemonstrationBoardLoaded && (
            <span className="hidden xl:inline text-[11px] text-amber-800 pl-1 whitespace-nowrap shrink-0">
              Demonstration Starter Board
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* D3: Explicit Clear Board Action (separated from WorkspaceErrorBoundary reset) */}
          {studioDoc.hasInitializedBoard && (
            confirmClearOpen ? (
              <div className="flex items-center gap-1 bg-rose-50 border border-rose-200 rounded-xs px-2 py-0.5 text-[11px]">
                <span className="text-rose-900 whitespace-nowrap">Clear board?</span>
                <button
                  type="button"
                  data-testid="confirm-clear-board-btn"
                  onClick={async () => {
                    await clearBoard();
                    clearLayerSelection();
                    setConfirmClearOpen(false);
                  }}
                  className="px-1.5 py-0.5 bg-rose-700 text-white rounded-xs font-medium cursor-pointer"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(false)}
                  className="px-1.5 py-0.5 text-neutral-700 hover:text-neutral-900 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="clear-board-btn"
                onClick={() => setConfirmClearOpen(true)}
                className="h-7 px-2 rounded-xs text-[11px] font-medium text-neutral-600 hover:text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                title="Clear Creative Studio board explicitly"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Clear Board</span>
              </button>
            )
          )}

          <button
            type="button"
            data-testid="studio-export-backup-btn"
            onClick={() => void handleExportRecoveryBundle()}
            className="h-7 px-2 rounded-xs text-[11px] font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            title="Download Creative Studio recovery backup JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Backup</span>
          </button>

          <button
            type="button"
            data-testid="studio-promote-atelier-btn"
            onClick={() => setPromoteModalOpen(true)}
            className="h-7 px-3 rounded-xs text-[11px] font-medium bg-neutral-900 hover:bg-neutral-800 text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <span>Promote to Atelier</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Dominant Visual Workspace Frame */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        <StudioPerfBoundary id="StudioLayersPanel">
          <StudioLayersPanel onRequestUploadDialog={handleTriggerUpload} />
        </StudioPerfBoundary>

        <StudioPerfBoundary id="StudioVisualCanvas">
          <StudioVisualCanvas
            onRequestUploadDialog={handleTriggerUpload}
            onRequestReplaceAsset={handleRequestReplaceAsset}
            onUploadMessage={setUploadError}
          />
        </StudioPerfBoundary>

        <StudioBriefAndAiDrawer onOpenPromoteModal={handleOpenPromoteModal} />
      </div>

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        data-testid="studio-file-upload-input"
        onChange={e => void handleFilesSelected(e)}
        className="hidden"
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={e => void handleReplaceFileSelected(e)}
        className="hidden"
      />

      {/* Explicit C8 Promotion Modal */}
      <PromoteToAtelierModal
        open={promoteModalOpen}
        currentSpec={currentSpec}
        concept={studioDoc.concept}
        onClose={() => setPromoteModalOpen(false)}
        onConfirmPromote={selection => {
          promoteConceptToAtelier(selection);
          setPromoteModalOpen(false);
          setEnvironment('pattern-atelier');
        }}
      />
    </div>
  );
};
