/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Folder,
  Layers,
  RotateCcw,
  Ungroup,
  X
} from 'lucide-react';
import { usePatternAtelierView } from './PatternAtelierViewContext';
import type { PatternPieceRenderModel } from './contracts/pattern-render-artifact';
import type { BoardOverlapAdvisory } from './board-arrangement';

export interface PatternLayersDrawerProps {
  readonly isCadSupported: boolean;
  readonly garmentCategory: string;
  readonly onSyncPrimaryPiece?: (pieceId: string) => void;
}

function getOverlapSeverityColor(advisories: readonly BoardOverlapAdvisory[]): string | null {
  if (advisories.length === 0) return null;
  if (advisories.some(a => a.classification === 'unintentional-overlap')) return 'bg-rose-500';
  if (advisories.some(a => a.classification === 'unresolved' || a.classification === 'containment'))
    return 'bg-amber-500';
  if (advisories.some(a => a.classification === 'intentional-overlap')) return 'bg-indigo-500';
  return 'bg-emerald-500';
}

/**
 * UX-2.3.2 — Pattern-Piece Layers Drawer.
 *
 * Derived strictly from the single authoritative `PatternAtelierViewContext` board
 * state and active read-only `PatternArtifactBundle` (zero duplicate piece registries).
 * Controls visual board visibility, layer stacking order, group hierarchy, and
 * synchronized selection without mutating original drafting geometry.
 */
export const PatternLayersDrawer: React.FC<PatternLayersDrawerProps> = React.memo(
  ({ isCadSupported, garmentCategory, onSyncPrimaryPiece }) => {
    const {
      activeArtifact,
      boardState,
      overlapAdvisories,
      resolvedDiagnostics,
      locateDiagnosticOnCanvas,
      layersDrawerOpen,
      setLayersDrawerOpen,
      selectPiece,
      toggleSelectPiece,
      groupSelectedPieces,
      ungroupById,
      togglePieceVisible,
      toggleGroupVisible,
      reorderPiece,
      resetBoardLayout,
      proposalState,
      layerVisibility,
      toggleLayerVisibility
    } = usePatternAtelierView();

    if (!layersDrawerOpen) return null;

    const piecesById = new Map<string, PatternPieceRenderModel>();
    if (activeArtifact) {
      for (const p of activeArtifact.pieces) {
        piecesById.set(p.pieceId, p);
      }
    }

    const selectedSet = new Set(boardState.selectedPieceIds);
    // Display top-most layer first (reverse of bottom-to-top render order)
    const displayOrderIds = [...boardState.layerOrder].reverse();
    const ungroupedDisplayIds = displayOrderIds.filter(
      id => !boardState.placementsByPieceId[id]?.groupId
    );

    const handleRowSelect = (pieceId: string, e: React.MouseEvent) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleSelectPiece(pieceId, { expandGroup: false });
      } else {
        selectPiece(pieceId, { expandGroup: false });
        onSyncPrimaryPiece?.(pieceId);
      }
    };

    const renderPieceRow = (pieceId: string, nestedInGroup: boolean) => {
      const piece = piecesById.get(pieceId);
      const placement = boardState.placementsByPieceId[pieceId];
      if (!piece || !placement) return null;

      const isSelected = selectedSet.has(pieceId);
      const stackIdx = boardState.layerOrder.indexOf(pieceId);
      const isTop = stackIdx === boardState.layerOrder.length - 1;
      const isBottom = stackIdx <= 0;

      const pieceAdvisories = overlapAdvisories.filter(
        a => a.pieceAId === pieceId || a.pieceBId === pieceId
      );
      const overlapDot = getOverlapSeverityColor(pieceAdvisories);
      const pieceDiag = resolvedDiagnostics.summaryByPieceId[pieceId];
      const diagBadgeStyle = pieceDiag
        ? pieceDiag.inconclusiveCount > 0 && pieceDiag.blockingCount === 0
          ? 'bg-violet-100 text-violet-900 border-violet-300'
          : pieceDiag.highestSeverity === 'CRITICAL_BLOCKING' ||
              pieceDiag.highestSeverity === 'ERROR'
            ? 'bg-rose-100 text-rose-900 border-rose-300'
            : pieceDiag.highestSeverity === 'WARNING'
              ? 'bg-amber-100 text-amber-900 border-amber-300'
              : 'bg-indigo-100 text-indigo-900 border-indigo-300'
        : null;

      return (
        <div
          key={pieceId}
          data-testid={`layer-row-${pieceId}`}
          data-selected={isSelected ? 'true' : 'false'}
          className={`group flex items-center justify-between gap-1 px-2 py-1.5 rounded-xs border text-[11px] transition-colors ${
            nestedInGroup ? 'ml-2.5' : ''
          } ${
            isSelected
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-white text-neutral-800 border-neutral-200 hover:border-neutral-400'
          }`}
        >
          <button
            type="button"
            onClick={e => handleRowSelect(pieceId, e)}
            className="flex-1 min-w-0 text-left flex items-center gap-1.5 cursor-pointer"
            title={`${piece.pieceCode} · ${piece.name} (Board: ${placement.offsetXCm.toFixed(1)}, ${placement.offsetYCm.toFixed(1)} cm)`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                overlapDot ?? (isSelected ? 'bg-blue-400' : 'bg-neutral-300')
              }`}
              title={
                pieceAdvisories.length > 0
                  ? pieceAdvisories.map(a => a.message).join(' | ')
                  : 'No board overlap advisory'
              }
            />
            <span className="min-w-0">
              <span className="font-mono font-semibold block truncate leading-tight">
                {piece.pieceCode}
              </span>
              <span
                className={`text-[10px] block truncate leading-tight ${
                  isSelected ? 'text-neutral-300' : 'text-neutral-500'
                }`}
              >
                {piece.name}
              </span>
            </span>
          </button>

          {proposalState?.pieceProposals[pieceId]?.modifiedFromOriginal && (
            <span
              data-testid={`layer-proposal-badge-${pieceId}`}
              title={
                proposalState.reconciliationStatus !== 'aligned'
                  ? 'Stale sew-contour proposal (source artifact changed — discard or reset)'
                  : 'Active unverified sew-contour proposal (original cut contour unchanged)'
              }
              className={`px-1 py-0.5 rounded-xs border font-mono text-[9px] font-bold leading-none shrink-0 ${
                proposalState.reconciliationStatus !== 'aligned'
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-indigo-100 text-indigo-900 border-indigo-300'
              }`}
            >
              {proposalState.reconciliationStatus !== 'aligned' ? 'STALE' : 'EDITED'}
            </span>
          )}

          {pieceDiag && pieceDiag.total > 0 && diagBadgeStyle && (
            <button
              type="button"
              data-testid={`layer-diag-badge-${pieceId}`}
              data-diag-count={pieceDiag.total}
              data-diag-severity={pieceDiag.highestSeverity}
              onClick={e => {
                e.stopPropagation();
                locateDiagnosticOnCanvas(pieceDiag.firstDiagnosticKey);
              }}
              aria-label={`${pieceDiag.total} diagnostic(s) on ${piece.pieceCode}`}
              title={`Diagnostics on ${piece.pieceCode}: ${pieceDiag.total} total (${pieceDiag.blockingCount} blocking, ${pieceDiag.warningCount} warning, ${pieceDiag.inconclusiveCount} inconclusive) — click to locate`}
              className={`px-1 py-0.5 rounded-xs border font-mono text-[9.5px] font-bold leading-none shrink-0 cursor-pointer ${diagBadgeStyle}`}
            >
              {pieceDiag.inconclusiveCount > 0 && pieceDiag.blockingCount === 0
                ? `?${pieceDiag.total}`
                : `!${pieceDiag.total}`}
            </button>
          )}

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              disabled={isTop}
              onClick={() => reorderPiece(pieceId, 'forward')}
              data-testid={`layer-up-${pieceId}`}
              aria-label={`Move ${piece.pieceCode} forward`}
              title="Bring forward"
              className={`p-0.5 rounded-xs transition-colors ${
                isTop
                  ? 'opacity-30 cursor-not-allowed'
                  : isSelected
                    ? 'hover:bg-neutral-700 text-neutral-200 cursor-pointer'
                    : 'hover:bg-neutral-100 text-neutral-600 cursor-pointer'
              }`}
            >
              <ArrowUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              disabled={isBottom}
              onClick={() => reorderPiece(pieceId, 'backward')}
              data-testid={`layer-down-${pieceId}`}
              aria-label={`Move ${piece.pieceCode} backward`}
              title="Send backward"
              className={`p-0.5 rounded-xs transition-colors ${
                isBottom
                  ? 'opacity-30 cursor-not-allowed'
                  : isSelected
                    ? 'hover:bg-neutral-700 text-neutral-200 cursor-pointer'
                    : 'hover:bg-neutral-100 text-neutral-600 cursor-pointer'
              }`}
            >
              <ArrowDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => togglePieceVisible(pieceId)}
              data-testid={`layer-vis-${pieceId}`}
              aria-label={placement.visible ? `Hide ${piece.pieceCode}` : `Show ${piece.pieceCode}`}
              aria-pressed={placement.visible}
              title={placement.visible ? 'Hide piece on board' : 'Show piece on board'}
              className={`p-0.5 rounded-xs cursor-pointer transition-colors ${
                isSelected
                  ? 'hover:bg-neutral-700 text-neutral-200'
                  : placement.visible
                    ? 'hover:bg-neutral-100 text-neutral-600'
                    : 'bg-neutral-100 text-neutral-400'
              }`}
            >
              {placement.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            </button>
          </div>
        </div>
      );
    };

    return (
      <>
        {/* Tablet backdrop when drawer overlays canvas (< 1024px) */}
        <div
          className="absolute inset-0 bg-neutral-950/25 z-20 lg:hidden"
          onClick={() => setLayersDrawerOpen(false)}
          aria-hidden="true"
        />

        <aside
          aria-label="Pattern Piece Layers Drawer"
          data-testid="pattern-layers-drawer"
          className="absolute inset-y-0 left-0 z-30 w-[236px] shadow-xl lg:static lg:shadow-none lg:w-[228px] shrink-0 bg-[#F7F6F2] border-r border-neutral-300/90 flex flex-col overflow-hidden select-none"
        >
          {/* Drawer Header */}
          <div className="h-9 px-2.5 border-b border-neutral-300/80 flex items-center justify-between gap-1.5 shrink-0 bg-[#EFECE5]">
            <div className="flex items-center gap-1.5 min-w-0">
              <Layers className="w-3.5 h-3.5 text-neutral-700 shrink-0" />
              <span className="text-[11px] font-semibold text-neutral-900 truncate">
                Piece Layers ({boardState.layerOrder.length})
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {boardState.layerOrder.length > 0 && (
                <button
                  type="button"
                  onClick={resetBoardLayout}
                  data-testid="layers-reset-layout-btn"
                  title="Reset CAD board arrangement to automatic table layout"
                  aria-label="Reset board layout"
                  className="p-1 rounded-xs text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setLayersDrawerOpen(false)}
                data-testid="layers-close-btn"
                aria-label="Close piece layers drawer"
                className="p-1 rounded-xs text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Ephemeral Board Scope Notice */}
          <div className="px-2.5 py-1.5 border-b border-neutral-200 bg-neutral-50 text-[10px] text-neutral-600 leading-snug shrink-0">
            Visual board order &amp; grouping only · original pattern contours remain read-only.
          </div>

          {/* Layer Hierarchy List */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
            {!isCadSupported ? (
              <div
                data-testid="layers-drawer-unsupported"
                className="p-3 bg-amber-50 border border-amber-200 rounded-xs text-[11px] text-amber-900 space-y-1.5"
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Unsupported Category</span>
                </div>
                <p className="text-[10px] leading-relaxed">
                  No deterministic CAD pieces exist for <strong className="uppercase">{garmentCategory}</strong>.
                </p>
              </div>
            ) : boardState.layerOrder.length === 0 ? (
              <div
                data-testid="layers-drawer-empty"
                className="p-3 bg-white border border-neutral-200 rounded-xs text-[11px] text-neutral-500 text-center"
              >
                No pattern pieces available on this CAD board.
              </div>
            ) : (
              <>
                {/* Explicit Groups */}
                {boardState.groupOrder.map(groupId => {
                  const group = boardState.groupsById[groupId];
                  if (!group) return null;
                  const allMembersSelected =
                    group.memberPieceIds.length > 0 &&
                    group.memberPieceIds.every(id => selectedSet.has(id));
                  const orderedMembers = displayOrderIds.filter(id =>
                    group.memberPieceIds.includes(id)
                  );

                  return (
                    <div
                      key={group.id}
                      data-testid={`layer-group-${group.id}`}
                      className="space-y-1 p-1.5 rounded-xs bg-[#EFECE5]/70 border border-neutral-300/80"
                    >
                      <div className="flex items-center justify-between gap-1 px-1 py-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            if (group.memberPieceIds[0]) {
                              selectPiece(group.memberPieceIds[0], { expandGroup: true });
                              onSyncPrimaryPiece?.(group.memberPieceIds[0]);
                            }
                          }}
                          className={`flex-1 min-w-0 text-left flex items-center gap-1.5 font-semibold cursor-pointer ${
                            allMembersSelected ? 'text-blue-800' : 'text-neutral-800'
                          }`}
                        >
                          <Folder className="w-3 h-3 shrink-0" />
                          <span className="truncate">{group.name}</span>
                          <span className="font-mono text-[10px] text-neutral-500 shrink-0">
                            ({group.memberPieceIds.length})
                          </span>
                        </button>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleGroupVisible(group.id)}
                            data-testid={`layer-group-vis-${group.id}`}
                            aria-label={group.visible ? `Hide ${group.name}` : `Show ${group.name}`}
                            title={group.visible ? 'Hide group' : 'Show group'}
                            className="p-0.5 rounded-xs text-neutral-600 hover:bg-neutral-200 cursor-pointer"
                          >
                            {group.visible ? (
                              <Eye className="w-3 h-3" />
                            ) : (
                              <EyeOff className="w-3 h-3 text-neutral-400" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => ungroupById(group.id)}
                            data-testid={`layer-group-ungroup-${group.id}`}
                            aria-label={`Ungroup ${group.name}`}
                            title="Ungroup pieces"
                            className="p-0.5 rounded-xs text-neutral-600 hover:bg-neutral-200 hover:text-rose-700 cursor-pointer"
                          >
                            <Ungroup className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {orderedMembers.map(pid => renderPieceRow(pid, true))}
                      </div>
                    </div>
                  );
                })}

                {/* Ungrouped Pieces */}
                <div className="space-y-1">
                  {ungroupedDisplayIds.map(pid => renderPieceRow(pid, false))}
                </div>
              </>
            )}
          </div>

          {/* WP-A Engineering & Annotation Layer Toggles */}
          {isCadSupported && (
            <div
              data-testid="layers-wp-a-engineering-toggles"
              className="px-2.5 py-2 border-t border-neutral-300/80 bg-[#F4F1EA] space-y-1.5 shrink-0"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                Engineering & Annotation Layers
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                {(
                  [
                    ['showConstructions', 'Constructions'],
                    ['showInternalLines', 'Internal Lines'],
                    ['showSeamWalkOverlay', 'Seam Walk'],
                    ['showAllowanceRuleBadges', 'SA Badges'],
                    ['showProductionAnnotations', 'Prod Notes'],
                    ['showNotches', 'Notches'],
                    ['showDarts', 'Darts']
                  ] as const
                ).map(([key, label]) => {
                  const active = layerVisibility[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      data-testid={`layer-toggle-${key}`}
                      onClick={() => toggleLayerVisibility(key)}
                      className={`flex items-center justify-between px-1.5 py-1 rounded-xs border text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-neutral-900 text-white border-neutral-900'
                          : 'bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50'
                      }`}
                    >
                      <span className="truncate">{label}</span>
                      {active ? <Eye className="w-2.5 h-2.5 shrink-0" /> : <EyeOff className="w-2.5 h-2.5 shrink-0 opacity-60" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Drawer Footer Quick Group Action */}
          {isCadSupported && boardState.layerOrder.length > 0 && (
            <div className="px-2.5 py-2 border-t border-neutral-300/80 bg-[#EFECE5] flex items-center justify-between gap-2 text-[10px] shrink-0">
              <span className="font-mono text-neutral-600">
                {boardState.selectedPieceIds.length} selected
              </span>
              <button
                type="button"
                disabled={boardState.selectedPieceIds.length < 2}
                onClick={() => groupSelectedPieces()}
                data-testid="layers-group-selected-btn"
                className={`px-2 py-0.5 rounded-xs border font-medium transition-colors ${
                  boardState.selectedPieceIds.length >= 2
                    ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800 cursor-pointer'
                    : 'bg-neutral-100 text-neutral-400 border-neutral-200 cursor-not-allowed'
                }`}
              >
                Group Selected
              </button>
            </div>
          )}
        </aside>
      </>
    );
  }
);
