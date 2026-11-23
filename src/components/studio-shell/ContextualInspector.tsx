/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  X,
  Scissors,
  Image as ImageIcon,
  Layers,
  Box,
  FileCheck2,
  StickyNote,
  Trash2,
  ArrowUpRight,
  Sliders
} from 'lucide-react';
import { useProjectWorkspace } from '../../state/ProjectWorkspaceContext';
import {
  useViewportInteraction,
  SelectedEntity
} from '../../state/ViewportInteractionContext';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Designer-facing contextual inspector.
 *
 * Intentionally excludes internal SHA-256 hashes, raw gate configuration, and low-level
 * engineering dumps; those remain accessible via the dedicated Engineering Health dock tab.
 */
export const ContextualInspector: React.FC = () => {
  const {
    currentSpec,
    activeSize,
    referenceImage,
    setReferenceImage,
    workspaceBundle
  } = useProjectWorkspace();

  const {
    activeEnvironment,
    selectedEntity,
    selectEntity,
    inspectorOpen,
    setInspectorOpen,
    setEnvironment,
    setSimProdSubView,
    openDockTab,
    camera,
    ephemeralOverlays,
    addEphemeralOverlay,
    removeEphemeralOverlay
  } = useViewportInteraction();

  if (!inspectorOpen) return null;

  const pieces = workspaceBundle.pieces;
  const activePiece =
    selectedEntity?.kind === 'pattern-piece' || selectedEntity?.kind === 'seam'
      ? pieces.find(p => p.id === selectedEntity.pieceId)
      : selectedEntity?.kind === 'simulation-entity' && selectedEntity.pieceId
        ? pieces.find(p => p.id === selectedEntity.pieceId)
        : selectedEntity?.kind === 'production-entity' && selectedEntity.pieceId
          ? pieces.find(p => p.id === selectedEntity.pieceId)
          : undefined;

  const envNotes = ephemeralOverlays.filter(note => note.environment === activeEnvironment);

  const entityKindLabel = (entity: SelectedEntity | null): string => {
    if (!entity) return 'Project Overview';
    switch (entity.kind) {
      case 'reference-image':
        return 'Reference Image';
      case 'garment-element':
        return 'Garment Concept';
      case 'pattern-piece':
        return 'Pattern Piece';
      case 'seam':
        return 'Seamline';
      case 'simulation-entity':
        return 'Prototype Simulation';
      case 'production-entity':
        return 'Production Output';
    }
  };

  return (
    <>
      {/* Tablet backdrop when inspector renders as slide-over (< 1024px) */}
      <div
        className="fixed inset-0 bg-neutral-950/30 z-20 lg:hidden"
        onClick={() => setInspectorOpen(false)}
        aria-hidden="true"
      />

      <aside
        aria-label="Contextual Object Inspector"
        data-testid="contextual-inspector"
        className="fixed right-0 top-12 bottom-0 z-30 w-[280px] shadow-2xl lg:static lg:shadow-none lg:w-[272px] xl:w-[292px] shrink-0 bg-white border-l border-neutral-200 flex flex-col overflow-hidden"
      >
        {/* Inspector Header */}
        <div className="h-10 px-3.5 border-b border-neutral-200 flex items-center justify-between gap-2 shrink-0 bg-neutral-50">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-neutral-900 block truncate">
              {entityKindLabel(selectedEntity)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setInspectorOpen(false)}
            aria-label="Close inspector"
            data-testid="close-inspector-btn"
            className="p-1 text-neutral-500 hover:text-neutral-900 rounded-xs hover:bg-neutral-200/70 cursor-pointer transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable Inspector Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-5 text-xs">
          {/* 1. Selected Entity Details */}
          {!selectedEntity && (
            <section className="space-y-2.5">
              <h3 className="text-[11px] font-semibold text-neutral-500 tracking-wide">
                Active Garment
              </h3>
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-neutral-900 leading-snug">
                  {currentSpec.name}
                </p>
                <p className="text-neutral-600 leading-relaxed">
                  {currentSpec.garmentCategory} · {currentSpec.silhouette} · Size{' '}
                  {String(activeSize).toUpperCase()}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-y-2 gap-x-3 pt-2 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Material</dt>
                  <dd className="text-neutral-900 font-medium truncate" title={currentSpec.fabric.name}>
                    {currentSpec.fabric.name}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Target Length</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                    {currentSpec.lengthCm} cm
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Ease Profile</dt>
                  <dd className="text-neutral-900 font-medium capitalize">
                    {currentSpec.easeProfile}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Colorway</dt>
                  <dd className="text-neutral-900 font-medium flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-xs border border-neutral-300 shrink-0"
                      style={{ backgroundColor: currentSpec.color.hex }}
                    />
                    <span className="truncate">{currentSpec.color.name}</span>
                  </dd>
                </div>
              </dl>
              <p className="text-[11px] text-neutral-500 pt-1">
                Select a pattern piece, seam, reference image, or simulation zone to inspect its details across environments.
              </p>
            </section>
          )}

          {selectedEntity?.kind === 'reference-image' && (
            <section className="space-y-3" data-testid="inspector-reference-image">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <ImageIcon className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.name}</span>
              </div>
              {referenceImage ? (
                <>
                  <div className="rounded-sm overflow-hidden border border-neutral-200 bg-neutral-50">
                    <img
                      src={referenceImage.dataUrl}
                      alt={`Selected reference ${referenceImage.name}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-32 object-cover"
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <dt className="text-[11px] text-neutral-500">Format</dt>
                      <dd className="font-mono text-neutral-800">{referenceImage.mimeType.replace('image/', '').toUpperCase()}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-neutral-500">File Size</dt>
                      <dd className="font-mono tabular-nums text-neutral-800">
                        {formatFileSize(referenceImage.sizeBytes)}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-[11px] text-neutral-500 leading-relaxed">
                    Used as visual brief context only. Automated silhouette extraction is not active in Studio Demonstration Mode.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setReferenceImage(null);
                      selectEntity(null);
                    }}
                    className="text-xs text-rose-700 hover:text-rose-900 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove reference image
                  </button>
                </>
              ) : (
                <p className="text-[11px] text-neutral-500">
                  Reference image is no longer attached. Upload one in Creative Studio.
                </p>
              )}
            </section>
          )}

          {selectedEntity?.kind === 'garment-element' && (
            <section className="space-y-3" data-testid="inspector-garment-element">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <Layers className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <dl className="grid grid-cols-2 gap-2.5 pt-2 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Category</dt>
                  <dd className="text-neutral-900 font-medium capitalize">{selectedEntity.category}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Silhouette</dt>
                  <dd className="text-neutral-900 font-medium capitalize">{selectedEntity.silhouette}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Fabric</dt>
                  <dd className="text-neutral-900 font-medium truncate">{currentSpec.fabric.name}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Length</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                    {currentSpec.lengthCm} cm
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => openDockTab('tech-spec')}
                  className="px-2.5 py-1.5 text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-sm cursor-pointer transition-colors"
                >
                  Open Tech Spec
                </button>
                <button
                  type="button"
                  onClick={() => openDockTab('sizing-ease')}
                  className="px-2.5 py-1.5 text-xs font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-sm cursor-pointer transition-colors"
                >
                  Sizing &amp; Ease
                </button>
              </div>
            </section>
          )}

          {selectedEntity?.kind === 'pattern-piece' && (
            <section className="space-y-3" data-testid="inspector-pattern-piece">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <Scissors className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-2.5 py-1.5">
                C0-Legacy prototype geometry. Non-authoritative drafting preview.
              </p>
              {activePiece ? (
                <>
                  <dl className="grid grid-cols-2 gap-2.5 pt-1 border-t border-neutral-100">
                    <div>
                      <dt className="text-[11px] text-neutral-500">Piece Code</dt>
                      <dd className="font-mono text-neutral-900 font-medium">{activePiece.pieceCode}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-neutral-500">Cut Instruction</dt>
                      <dd className="text-neutral-900 font-medium">
                        {activePiece.onFold ? 'Cut 1 on fold' : `Cut ${activePiece.cutCount}`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-neutral-500">Dimensions</dt>
                      <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                        {activePiece.boundingBox.widthCm} × {activePiece.boundingBox.heightCm} cm
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-neutral-500">Seam Allowance</dt>
                      <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                        {activePiece.seamAllowanceWidthCm} cm
                      </dd>
                    </div>
                  </dl>

                  {activePiece.seams.length > 0 && (
                    <div className="pt-2 border-t border-neutral-100 space-y-1.5">
                      <span className="text-[11px] font-medium text-neutral-500 block">
                        Piece Seams ({activePiece.seams.length})
                      </span>
                      <div className="space-y-1">
                        {activePiece.seams.map(seam => (
                          <button
                            key={seam.id}
                            type="button"
                            onClick={() =>
                              selectEntity({
                                kind: 'seam',
                                id: `${activePiece.id}:${seam.id}`,
                                pieceId: activePiece.id,
                                seamId: seam.id,
                                label: `${activePiece.name} · ${seam.name}`,
                                lengthCm: seam.lengthCm,
                                pairedSeamName: seam.pairedSeamName
                              })
                            }
                            className="w-full px-2 py-1.5 rounded-sm border border-neutral-200 hover:border-neutral-400 bg-neutral-50/70 flex items-center justify-between text-left cursor-pointer transition-colors"
                          >
                            <span className="text-neutral-800 truncate pr-2">{seam.name}</span>
                            <span className="font-mono tabular-nums text-neutral-600 shrink-0">
                              {seam.lengthCm} cm
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeEnvironment !== 'pattern-atelier' && (
                    <button
                      type="button"
                      onClick={() => setEnvironment('pattern-atelier')}
                      className="text-xs font-medium text-neutral-900 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      View piece in Pattern Atelier
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-neutral-500">
                  This garment category does not currently generate CAD pattern pieces.
                </p>
              )}
            </section>
          )}

          {selectedEntity?.kind === 'seam' && (
            <section className="space-y-3" data-testid="inspector-seam">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <Sliders className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <dl className="grid grid-cols-2 gap-2.5 pt-2 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Measured Length</dt>
                  <dd className="font-mono tabular-nums text-neutral-900 font-semibold">
                    {selectedEntity.lengthCm !== undefined ? `${selectedEntity.lengthCm} cm` : 'N/A'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Parent Piece</dt>
                  <dd className="text-neutral-900 font-medium truncate">
                    {activePiece?.name ?? selectedEntity.pieceId}
                  </dd>
                </div>
                {selectedEntity.pairedSeamName && (
                  <div className="col-span-2">
                    <dt className="text-[11px] text-neutral-500">Paired Seam</dt>
                    <dd className="text-neutral-900 font-medium">{selectedEntity.pairedSeamName}</dd>
                  </div>
                )}
              </dl>
              {activePiece && (
                <button
                  type="button"
                  onClick={() =>
                    selectEntity({
                      kind: 'pattern-piece',
                      id: activePiece.id,
                      pieceId: activePiece.id,
                      pieceCode: activePiece.pieceCode,
                      label: activePiece.name
                    })
                  }
                  className="text-xs font-medium text-neutral-800 hover:underline cursor-pointer"
                >
                  Select parent piece ({activePiece.pieceCode})
                </button>
              )}
            </section>
          )}

          {selectedEntity?.kind === 'simulation-entity' && (
            <section className="space-y-3" data-testid="inspector-simulation-entity">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <Box className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-2.5 py-1.5 leading-relaxed">
                Prototype drape simulation only. Physical garment fit validation (AC-09) remains pending.
              </p>
              <dl className="grid grid-cols-2 gap-2.5 pt-1 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Material</dt>
                  <dd className="text-neutral-900 font-medium truncate">{currentSpec.fabric.name}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Orbit View</dt>
                  <dd className="font-mono tabular-nums text-neutral-900">
                    {camera.orbitYawDeg}° / {camera.orbitPitchDeg}°
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => {
                  setEnvironment('simulation-production');
                  setSimProdSubView('prototype-drape-3d');
                }}
                className="px-2.5 py-1.5 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-sm cursor-pointer transition-colors"
              >
                Open Prototype Drape View
              </button>
            </section>
          )}

          {selectedEntity?.kind === 'production-entity' && (
            <section className="space-y-3" data-testid="inspector-production-entity">
              <div className="flex items-center gap-2 text-neutral-900 font-medium">
                <FileCheck2 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span className="truncate">{selectedEntity.label}</span>
              </div>
              <p className="text-[11px] text-neutral-600 leading-relaxed">
                Production exports remain restricted until specification approval, measurement verification, and release checks pass.
              </p>
              <dl className="space-y-2 pt-1 border-t border-neutral-100">
                <div>
                  <dt className="text-[11px] text-neutral-500">Export Readiness</dt>
                  <dd className="text-neutral-900 font-medium">
                    {workspaceBundle.exportValidation.isExportPermitted
                      ? 'Ready for local draft export'
                      : 'Restricted — review required'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-neutral-500">Physical Validation</dt>
                  <dd className="text-amber-800 font-medium">Pending physical toile sign-off</dd>
                </div>
              </dl>
              {activeEnvironment !== 'simulation-production' && (
                <button
                  type="button"
                  onClick={() => {
                    setEnvironment('simulation-production');
                    setSimProdSubView('production-overview');
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-sm cursor-pointer transition-colors"
                >
                  Open Production View
                </button>
              )}
            </section>
          )}

          {/* 2. Ephemeral Unverified Visual Notes (Undoable UI overlays, strictly non-canonical) */}
          <section className="pt-4 border-t border-neutral-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold text-neutral-500 tracking-wide">
                Visual Notes ({envNotes.length})
              </h3>
              <button
                type="button"
                onClick={() => addEphemeralOverlay()}
                data-testid="inspector-add-note-btn"
                className="text-[11px] font-medium text-neutral-800 hover:underline cursor-pointer"
              >
                + Add note
              </button>
            </div>
            {envNotes.length === 0 ? (
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                No unverified visual notes in this view. Notes are temporary and never alter pattern geometry.
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="inspector-notes-list">
                {envNotes.map(note => (
                  <li
                    key={note.id}
                    className="px-2.5 py-1.5 rounded-sm border border-neutral-200 bg-neutral-50 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-neutral-900 font-medium">
                        <StickyNote className="w-3 h-3 text-amber-600 shrink-0" />
                        <span className="truncate">{note.label}</span>
                      </div>
                      <span className="text-[10px] text-neutral-500 block">
                        Unverified overlay · non-canonical
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeEphemeralOverlay(note.id)}
                      aria-label={`Remove ${note.label}`}
                      className="p-1 text-neutral-400 hover:text-rose-700 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 3. Viewport Camera Summary (Ephemeral Only) */}
          <section className="pt-4 border-t border-neutral-200 space-y-1.5">
            <h3 className="text-[11px] font-semibold text-neutral-500 tracking-wide">
              Viewport View
            </h3>
            <div className="flex items-center justify-between text-[11px] text-neutral-600">
              <span>Zoom</span>
              <span className="font-mono tabular-nums text-neutral-900">
                {Math.round(camera.zoom * 100)}%
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-neutral-600">
              <span>Grid Overlay</span>
              <span className="text-neutral-900">{camera.showGrid ? 'Visible' : 'Hidden'}</span>
            </div>
          </section>
        </div>

        {/* Quiet Link to Engineering View */}
        <div className="px-3.5 py-2.5 border-t border-neutral-200 bg-neutral-50 shrink-0 flex items-center justify-between text-[11px]">
          <span className="text-neutral-500">Technical lineage</span>
          <button
            type="button"
            onClick={() => openDockTab('engineering')}
            className="font-medium text-neutral-800 hover:underline cursor-pointer"
          >
            Engineering View
          </button>
        </div>
      </aside>
    </>
  );
};
