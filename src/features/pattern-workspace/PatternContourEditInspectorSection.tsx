/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  GitCommitHorizontal,
  HelpCircle,
  PenTool,
  Redo2,
  RotateCcw,
  Scissors,
  ShieldAlert,
  Spline,
  Trash2,
  Undo2,
  XCircle
} from 'lucide-react';
import { usePatternAtelierView } from './PatternAtelierViewContext';
import {
  getEditableSewVerticesForPiece,
  HandleContinuityMode,
  ProposalIntegrityCheckStatus,
  serializeProposalPayload,
  STALE_CUT_CONTOUR_DISCLOSURE,
  UNVERIFIED_PROPOSAL_DISCLOSURE
} from './geometry-edit-proposal';

export interface PatternContourEditInspectorSectionProps {
  readonly activeTool: string;
  readonly selectedPieceId: string | null;
}

function renderCheckStatusBadge(status: ProposalIntegrityCheckStatus) {
  switch (status) {
    case 'pass':
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-xs border border-emerald-300 bg-emerald-50 text-emerald-800 font-mono text-[9.5px] font-semibold uppercase">
          <CheckCircle2 className="w-2.5 h-2.5" />
          Pass
        </span>
      );
    case 'advisory-warning':
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-xs border border-amber-300 bg-amber-50 text-amber-900 font-mono text-[9.5px] font-semibold uppercase">
          <AlertTriangle className="w-2.5 h-2.5" />
          Warning
        </span>
      );
    case 'invalid-proposal':
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-xs border border-rose-300 bg-rose-50 text-rose-900 font-mono text-[9.5px] font-semibold uppercase">
          <XCircle className="w-2.5 h-2.5" />
          Invalid
        </span>
      );
    case 'unassessed':
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-xs border border-neutral-300 bg-neutral-100 text-neutral-700 font-mono text-[9.5px] font-semibold uppercase">
          <HelpCircle className="w-2.5 h-2.5" />
          Unassessed
        </span>
      );
  }
}

export const PatternContourEditInspectorSection: React.FC<PatternContourEditInspectorSectionProps> =
  React.memo(({ activeTool, selectedPieceId }) => {
    const {
      activeArtifact,
      proposalHistory,
      proposalState,
      proposalIntegrity,
      contourEditSelection,
      setContourEditSelection,
      translateAdjacentHandles,
      setTranslateAdjacentHandles,
      activeContinuityMode,
      setActiveContinuityMode,
      pendingApproximatePreview,
      proposalActionNotice,
      clearProposalActionNotice,
      commitMoveContourVertex,
      commitMoveBezierHandle,
      commitSetVertexContinuity,
      commitAlignVertex,
      commitSplitSewSegment,
      commitElevateLineToCubic,
      requestCubicToLinePreview,
      requestRemoveVertexPreview,
      confirmPendingApproximateOperation,
      cancelPendingApproximateOperation,
      setProposalApproximationTolerance,
      undoProposal,
      redoProposal,
      canUndoProposal,
      canRedoProposal,
      lastProposalActionLabel,
      discardPieceProposalEdits,
      discardAllProposalEdits
    } = usePatternAtelierView();

    const [coordXInput, setCoordXInput] = useState<string>('');
    const [coordYInput, setCoordYInput] = useState<string>('');
    const [splitTInput, setSplitTInput] = useState<string>('0.50');
    const [toleranceInput, setToleranceInput] = useState<string>('0.25');
    const [showPayloadJson, setShowPayloadJson] = useState<boolean>(false);
    const [copiedPayload, setCopiedPayload] = useState<boolean>(false);
    const [showAllIntegrityChecks, setShowAllIntegrityChecks] = useState<boolean>(true);

    const isEditMode = activeTool === 'edit-contour';
    const hasEdits = Boolean(proposalState?.hasEdits);
    const isStale = Boolean(proposalState && proposalState.reconciliationStatus !== 'aligned');

    // Focus piece: selected contour target piece > board selected piece > first piece in artifact
    const activePiece = useMemo(() => {
      if (!activeArtifact || activeArtifact.pieces.length === 0) return null;
      const targetPieceId = contourEditSelection?.pieceId ?? selectedPieceId;
      return (
        activeArtifact.pieces.find((p) => p.pieceId === targetPieceId) ?? activeArtifact.pieces[0]
      );
    }, [activeArtifact, contourEditSelection?.pieceId, selectedPieceId]);

    const activePieceProposal =
      activePiece && proposalState?.reconciliationStatus === 'aligned'
        ? proposalState.pieceProposals[activePiece.pieceId]
        : undefined;

    const activeSewSegments = activePieceProposal?.sewSegments ?? activePiece?.sewSegments ?? [];

    const activeVertices = useMemo(() => {
      if (!activePiece) return [];
      return getEditableSewVerticesForPiece(activePiece.pieceId, activeSewSegments);
    }, [activePiece, activeSewSegments]);

    const selectedVertex = useMemo(() => {
      if (
        !activePiece ||
        contourEditSelection?.pieceId !== activePiece.pieceId ||
        contourEditSelection.kind !== 'vertex'
      ) {
        return null;
      }
      return activeVertices.find((v) => v.entityRef === contourEditSelection.vertexRef) ?? null;
    }, [activePiece, activeVertices, contourEditSelection]);

    const selectedSegment = useMemo(() => {
      if (
        !activePiece ||
        contourEditSelection?.pieceId !== activePiece.pieceId ||
        (contourEditSelection.kind !== 'segment' && contourEditSelection.kind !== 'handle')
      ) {
        return null;
      }
      return activeSewSegments.find((s) => s.id === contourEditSelection.segmentId) ?? null;
    }, [activePiece, activeSewSegments, contourEditSelection]);

    const selectedHandlePoint = useMemo(() => {
      if (
        !selectedSegment ||
        selectedSegment.kind !== 'cubic-bezier' ||
        contourEditSelection?.kind !== 'handle'
      ) {
        return null;
      }
      return contourEditSelection.handleSlot === 'p1'
        ? selectedSegment.p1 ?? null
        : selectedSegment.p2 ?? null;
    }, [selectedSegment, contourEditSelection]);

    // Sync numeric X/Y inputs whenever selection or underlying coordinates change
    useEffect(() => {
      if (selectedVertex) {
        setCoordXInput(selectedVertex.localPointCm.x.toFixed(4));
        setCoordYInput(selectedVertex.localPointCm.y.toFixed(4));
      } else if (selectedHandlePoint) {
        setCoordXInput(selectedHandlePoint.x.toFixed(4));
        setCoordYInput(selectedHandlePoint.y.toFixed(4));
      } else {
        setCoordXInput('');
        setCoordYInput('');
      }
    }, [
      selectedVertex?.entityRef,
      selectedVertex?.localPointCm.x,
      selectedVertex?.localPointCm.y,
      selectedHandlePoint?.x,
      selectedHandlePoint?.y
    ]);

    useEffect(() => {
      if (proposalState) {
        setToleranceInput(String(proposalState.defaultApproximationToleranceCm));
      }
    }, [proposalState?.defaultApproximationToleranceCm]);

    const payloadSerialization = useMemo(() => {
      if (!showPayloadJson || !activeArtifact || !proposalState) return null;
      return serializeProposalPayload(proposalState, activeArtifact, proposalHistory ?? undefined);
    }, [showPayloadJson, activeArtifact, proposalState, proposalHistory]);

    if (!activeArtifact || !proposalState) return null;
    if (!isEditMode && !hasEdits && !isStale && !pendingApproximatePreview) return null;

    const editedPieceCount = Object.values(proposalState.pieceProposals).filter(
      (p) => p.modifiedFromOriginal
    ).length;

    const handleApplyCoords = (e: React.FormEvent) => {
      e.preventDefault();
      if (!activePiece) return;
      const nx = Number(coordXInput);
      const ny = Number(coordYInput);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
      if (selectedVertex) {
        commitMoveContourVertex(activePiece.pieceId, selectedVertex.entityRef, { x: nx, y: ny });
      } else if (
        contourEditSelection?.kind === 'handle' &&
        contourEditSelection.segmentId &&
        contourEditSelection.handleSlot
      ) {
        commitMoveBezierHandle(
          activePiece.pieceId,
          contourEditSelection.segmentId,
          contourEditSelection.handleSlot,
          { x: nx, y: ny }
        );
      }
    };

    const handleCopyPayload = async () => {
      if (!activeArtifact || !proposalState) return;
      const ser = serializeProposalPayload(
        proposalState,
        activeArtifact,
        proposalHistory ?? undefined
      );
      if (!ser.ok) return;
      try {
        await navigator.clipboard.writeText(ser.json);
        setCopiedPayload(true);
        window.setTimeout(() => setCopiedPayload(false), 1800);
      } catch {
        setShowPayloadJson(true);
      }
    };

    // Adjacent vertex reference for Align H / Align V actions
    const adjacentReferenceVertex = (() => {
      if (!selectedVertex || activeVertices.length < 2) return null;
      const idx = activeVertices.findIndex((v) => v.entityRef === selectedVertex.entityRef);
      if (idx < 0) return null;
      return activeVertices[(idx + 1) % activeVertices.length];
    })();

    const selectedVertexContinuity: HandleContinuityMode =
      (selectedVertex && activePieceProposal?.vertexContinuityModes[selectedVertex.entityRef]) ??
      activeContinuityMode;

    return (
      <section
        data-testid="inspector-contour-edit-section"
        className="border border-indigo-300/90 bg-white rounded-xs overflow-hidden shadow-2xs"
      >
        {/* Header & Non-Authoritative Authority Disclosure */}
        <div className="px-2.5 py-2 bg-indigo-50/90 border-b border-indigo-200 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <PenTool className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
              <h3 className="text-[11px] font-semibold text-indigo-950 truncate">
                Contour Proposal
              </h3>
            </div>
            <span
              data-testid="proposal-authority-badge"
              className="px-1.5 py-0.5 rounded-xs border border-indigo-300 bg-white text-indigo-900 font-mono text-[9px] font-bold shrink-0"
            >
              UNVERIFIED PROPOSAL
            </span>
          </div>
          <p className="text-[10px] text-indigo-900/90 leading-snug">
            {UNVERIFIED_PROPOSAL_DISCLOSURE}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] font-mono text-neutral-600 pt-0.5">
            <span>Rev: {proposalState.sourceIdentity.specificationRevisionId}</span>
            <span>·</span>
            <span data-testid="proposal-digest-status">
              {proposalState.sourceIdentity.hasVerifiedSourceDigest
                ? 'Source digest present'
                : 'No source digest (fingerprint tracked)'}
            </span>
            <span>·</span>
            <span>Edited pieces: {editedPieceCount}</span>
          </div>
        </div>

        <div className="p-2.5 space-y-2.5 text-[11px]">
          {/* Stale Proposal Quarantine Banner (R4) */}
          {isStale && (
            <div
              role="alert"
              data-testid="inspector-stale-proposal-banner"
              className="p-2 rounded-xs border border-amber-400 bg-amber-50 text-amber-950 space-y-1.5"
            >
              <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>
                  Stale Proposal Quarantined ({proposalState.reconciliationStatus})
                </span>
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-[10px] leading-snug">
                {proposalState.reconciliationReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
              <p className="text-[10px] text-amber-900">
                Editing is locked until this stale proposal is discarded so edits are never silently
                applied to a different artifact revision.
              </p>
              <button
                type="button"
                onClick={discardAllProposalEdits}
                data-testid="proposal-discard-stale-btn"
                className="px-2 py-1 rounded-xs bg-amber-800 hover:bg-amber-900 text-white text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Discard Stale Proposal &amp; Realign
              </button>
            </div>
          )}

          {/* D2 Stale Cut-Contour Disclosure */}
          {hasEdits && !isStale && (
            <div
              data-testid="inspector-stale-cut-disclosure"
              className="px-2 py-1.5 rounded-xs border border-amber-300 bg-amber-50/80 text-[10px] text-amber-950 flex items-start gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
              <span>{STALE_CUT_CONTOUR_DISCLOSURE}</span>
            </div>
          )}

          {/* Action Feedback Notice */}
          {proposalActionNotice && (
            <div
              data-testid="proposal-action-notice"
              className={`px-2 py-1.5 rounded-xs border text-[10px] flex items-start justify-between gap-2 ${
                proposalActionNotice.kind === 'error'
                  ? 'border-rose-300 bg-rose-50 text-rose-900'
                  : proposalActionNotice.kind === 'warning'
                    ? 'border-amber-300 bg-amber-50 text-amber-950'
                    : 'border-indigo-200 bg-indigo-50/60 text-indigo-950'
              }`}
            >
              <span className="leading-snug">{proposalActionNotice.message}</span>
              <button
                type="button"
                onClick={clearProposalActionNotice}
                aria-label="Dismiss notice"
                className="text-[10px] font-semibold underline shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* D4 Independent Geometry Proposal History Strip */}
          <div className="p-2 rounded-xs bg-neutral-50 border border-neutral-200 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-700">
                Proposal History (Independent of Board)
              </span>
              <span className="font-mono text-[10px] text-neutral-500">
                {proposalHistory?.past.length ?? 0} / {proposalHistory?.maxEntries ?? 50}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                disabled={!canUndoProposal}
                onClick={undoProposal}
                data-testid="inspector-proposal-undo-btn"
                className={`px-2 py-1 rounded-xs border text-[10px] font-medium inline-flex items-center gap-1 ${
                  canUndoProposal
                    ? 'bg-white border-neutral-300 text-neutral-900 hover:bg-neutral-100 cursor-pointer'
                    : 'bg-neutral-100 border-neutral-200 text-neutral-400 cursor-not-allowed'
                }`}
              >
                <Undo2 className="w-3 h-3" />
                Undo
              </button>
              <button
                type="button"
                disabled={!canRedoProposal}
                onClick={redoProposal}
                data-testid="inspector-proposal-redo-btn"
                className={`px-2 py-1 rounded-xs border text-[10px] font-medium inline-flex items-center gap-1 ${
                  canRedoProposal
                    ? 'bg-white border-neutral-300 text-neutral-900 hover:bg-neutral-100 cursor-pointer'
                    : 'bg-neutral-100 border-neutral-200 text-neutral-400 cursor-not-allowed'
                }`}
              >
                <Redo2 className="w-3 h-3" />
                Redo
              </button>
              {activePiece && activePieceProposal?.modifiedFromOriginal && (
                <button
                  type="button"
                  onClick={() => discardPieceProposalEdits(activePiece.pieceId)}
                  data-testid="proposal-discard-piece-btn"
                  className="px-2 py-1 rounded-xs border border-neutral-300 bg-white hover:bg-rose-50 hover:text-rose-900 hover:border-rose-300 text-neutral-700 text-[10px] font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset {activePiece.pieceCode}
                </button>
              )}
              {(hasEdits || isStale) && (
                <button
                  type="button"
                  onClick={discardAllProposalEdits}
                  data-testid="proposal-discard-all-btn"
                  className="px-2 py-1 rounded-xs border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900 text-[10px] font-medium inline-flex items-center gap-1 cursor-pointer ml-auto"
                >
                  <Trash2 className="w-3 h-3" />
                  Discard All
                </button>
              )}
            </div>
            {lastProposalActionLabel && (
              <div className="text-[10px] text-neutral-600 truncate">
                Last: <span className="font-medium text-neutral-800">{lastProposalActionLabel}</span>
              </div>
            )}
          </div>

          {/* Sew Entity Picker & Precision Controls (disabled while stale) */}
          {activePiece && !isStale && (
            <div className="p-2 rounded-xs bg-neutral-50/70 border border-neutral-200 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-700">
                  Target: {activePiece.pieceCode} ({activeSewSegments.length} sew segs)
                </span>
                <span className="font-mono text-[9.5px] text-neutral-500">Cut read-only</span>
              </div>

              {/* Accessible Quick Picker for Vertices & Segments */}
              <div className="grid grid-cols-2 gap-1.5">
                <label className="block space-y-0.5">
                  <span className="text-[9.5px] text-neutral-600 font-medium">Sew Vertex</span>
                  <select
                    aria-label="Select sew contour vertex"
                    data-testid="contour-vertex-select"
                    value={
                      contourEditSelection?.pieceId === activePiece.pieceId &&
                      contourEditSelection.kind === 'vertex'
                        ? contourEditSelection.vertexRef ?? ''
                        : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setContourEditSelection(null);
                      } else {
                        setContourEditSelection({
                          pieceId: activePiece.pieceId,
                          kind: 'vertex',
                          vertexRef: val
                        });
                      }
                    }}
                    className="w-full h-7 px-1.5 bg-white border border-neutral-300 rounded-xs text-[10px] font-mono text-neutral-900"
                  >
                    <option value="">-- Pick vertex --</option>
                    {activeVertices.map((v, idx) => (
                      <option key={v.entityRef} value={v.entityRef}>
                        V{idx + 1} ({v.localPointCm.x.toFixed(1)}, {v.localPointCm.y.toFixed(1)})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-0.5">
                  <span className="text-[9.5px] text-neutral-600 font-medium">Sew Segment</span>
                  <select
                    aria-label="Select sew contour segment"
                    data-testid="contour-segment-select"
                    value={
                      contourEditSelection?.pieceId === activePiece.pieceId &&
                      (contourEditSelection.kind === 'segment' ||
                        contourEditSelection.kind === 'handle')
                        ? contourEditSelection.segmentId ?? ''
                        : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setContourEditSelection(null);
                      } else {
                        setContourEditSelection({
                          pieceId: activePiece.pieceId,
                          kind: 'segment',
                          segmentId: val
                        });
                      }
                    }}
                    className="w-full h-7 px-1.5 bg-white border border-neutral-300 rounded-xs text-[10px] font-mono text-neutral-900"
                  >
                    <option value="">-- Pick segment --</option>
                    {activeSewSegments.map((seg, idx) => (
                      <option key={seg.id} value={seg.id}>
                        S{idx + 1}: {seg.kind === 'cubic-bezier' ? 'Cubic' : 'Line'} ({seg.id})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Vertex / Handle Precision Coordinate Editor */}
              {(selectedVertex || selectedHandlePoint) && (
                <form onSubmit={handleApplyCoords} className="space-y-2 pt-1 border-t border-neutral-200">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-semibold text-indigo-900">
                      {selectedVertex
                        ? selectedVertex.isShared
                          ? 'Shared Sew Anchor (Coupled)'
                          : 'Sew Endpoint Anchor'
                        : `Bézier Handle ${contourEditSelection?.handleSlot?.toUpperCase()}`}
                    </span>
                    <span className="font-mono text-[9.5px] text-neutral-500">Local cm</span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block space-y-0.5">
                      <span className="text-[9.5px] text-neutral-600">X (cm)</span>
                      <input
                        type="number"
                        step="0.05"
                        value={coordXInput}
                        onChange={(e) => setCoordXInput(e.target.value)}
                        data-testid={
                          selectedVertex ? 'contour-vertex-x-input' : 'contour-handle-x-input'
                        }
                        aria-label={selectedVertex ? 'Vertex X in cm' : 'Handle X in cm'}
                        className="w-full h-7 px-1.5 bg-white border border-neutral-300 rounded-xs font-mono text-[10.5px] text-neutral-900"
                      />
                    </label>
                    <label className="block space-y-0.5">
                      <span className="text-[9.5px] text-neutral-600">Y (cm)</span>
                      <input
                        type="number"
                        step="0.05"
                        value={coordYInput}
                        onChange={(e) => setCoordYInput(e.target.value)}
                        data-testid={
                          selectedVertex ? 'contour-vertex-y-input' : 'contour-handle-y-input'
                        }
                        aria-label={selectedVertex ? 'Vertex Y in cm' : 'Handle Y in cm'}
                        className="w-full h-7 px-1.5 bg-white border border-neutral-300 rounded-xs font-mono text-[10.5px] text-neutral-900"
                      />
                    </label>
                  </div>

                  <button
                    type="submit"
                    data-testid={
                      selectedVertex ? 'contour-vertex-apply-btn' : 'contour-handle-apply-btn'
                    }
                    className="w-full py-1 rounded-xs bg-indigo-700 hover:bg-indigo-800 text-white text-[10.5px] font-semibold cursor-pointer"
                  >
                    Apply Exact Coordinates
                  </button>

                  {selectedVertex && (
                    <>
                      <label className="flex items-center gap-1.5 text-[10px] text-neutral-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={translateAdjacentHandles}
                          onChange={(e) => setTranslateAdjacentHandles(e.target.checked)}
                          data-testid="contour-translate-handles-toggle"
                          className="rounded-xs border-neutral-400"
                        />
                        <span>Translate adjacent Bézier handles with vertex</span>
                      </label>

                      {adjacentReferenceVertex && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              commitAlignVertex(
                                activePiece.pieceId,
                                selectedVertex.entityRef,
                                'horizontal',
                                adjacentReferenceVertex.localPointCm
                              )
                            }
                            data-testid="contour-align-h-btn"
                            className="flex-1 py-1 rounded-xs border border-neutral-300 bg-white hover:bg-neutral-100 text-[10px] font-medium text-neutral-800 cursor-pointer"
                          >
                            Align H (Next Vtx)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              commitAlignVertex(
                                activePiece.pieceId,
                                selectedVertex.entityRef,
                                'vertical',
                                adjacentReferenceVertex.localPointCm
                              )
                            }
                            data-testid="contour-align-v-btn"
                            className="flex-1 py-1 rounded-xs border border-neutral-300 bg-white hover:bg-neutral-100 text-[10px] font-medium text-neutral-800 cursor-pointer"
                          >
                            Align V (Next Vtx)
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {/* Handle Continuity Mode Selector */}
                  <div className="space-y-1">
                    <span className="text-[9.5px] font-medium text-neutral-600 block">
                      Handle Continuity Mode
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          { id: 'c0-corner', label: 'C0 Corner' },
                          { id: 'g1-smooth', label: 'G1 Smooth' },
                          { id: 'symmetric', label: 'Symmetric' }
                        ] as const
                      ).map((mode) => {
                        const isActive =
                          (selectedVertex ? selectedVertexContinuity : activeContinuityMode) ===
                          mode.id;
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            aria-pressed={isActive}
                            data-testid={`contour-continuity-${mode.id}`}
                            onClick={() => {
                              if (selectedVertex) {
                                commitSetVertexContinuity(
                                  activePiece.pieceId,
                                  selectedVertex.entityRef,
                                  mode.id
                                );
                              } else {
                                setActiveContinuityMode(mode.id);
                              }
                            }}
                            className={`py-1 px-1 rounded-xs border text-[9.5px] font-medium cursor-pointer transition-colors ${
                              isActive
                                ? 'bg-indigo-700 text-white border-indigo-700'
                                : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100'
                            }`}
                          >
                            {mode.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* R2: Remove Vertex & Merge (Always Previews Deviation / Topology Gate First) */}
                  {selectedVertex && (
                    <button
                      type="button"
                      onClick={() =>
                        requestRemoveVertexPreview(
                          activePiece.pieceId,
                          selectedVertex.entityRef,
                          Number(toleranceInput)
                        )
                      }
                      data-testid="contour-remove-vertex-btn"
                      className="w-full py-1 rounded-xs border border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-950 text-[10px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <GitCommitHorizontal className="w-3 h-3" />
                      Preview Remove Vertex &amp; Merge (R2)
                    </button>
                  )}
                </form>
              )}

              {/* Segment Operations: Split at t, Exact Line->Cubic, R1 Approx Cubic->Line */}
              {selectedSegment && (
                <div className="space-y-2 pt-1.5 border-t border-neutral-200">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-semibold text-indigo-900 truncate">
                      Segment: {selectedSegment.id}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-xs bg-neutral-200/80 font-mono text-[9px] text-neutral-800 uppercase">
                      {selectedSegment.kind === 'cubic-bezier' ? 'Cubic Bézier' : 'Straight Line'}
                    </span>
                  </div>

                  {/* Handle quick-select buttons when cubic segment selected */}
                  {selectedSegment.kind === 'cubic-bezier' && selectedSegment.p1 && selectedSegment.p2 && (
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setContourEditSelection({
                            pieceId: activePiece.pieceId,
                            kind: 'handle',
                            segmentId: selectedSegment.id,
                            handleSlot: 'p1'
                          })
                        }
                        data-testid="contour-select-handle-p1-btn"
                        className={`py-1 px-1.5 rounded-xs border text-[9.5px] font-mono cursor-pointer ${
                          contourEditSelection?.kind === 'handle' &&
                          contourEditSelection.handleSlot === 'p1'
                            ? 'bg-violet-700 text-white border-violet-700'
                            : 'bg-white text-violet-900 border-violet-300 hover:bg-violet-50'
                        }`}
                      >
                        Edit P1 ({selectedSegment.p1.x.toFixed(1)}, {selectedSegment.p1.y.toFixed(1)})
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setContourEditSelection({
                            pieceId: activePiece.pieceId,
                            kind: 'handle',
                            segmentId: selectedSegment.id,
                            handleSlot: 'p2'
                          })
                        }
                        data-testid="contour-select-handle-p2-btn"
                        className={`py-1 px-1.5 rounded-xs border text-[9.5px] font-mono cursor-pointer ${
                          contourEditSelection?.kind === 'handle' &&
                          contourEditSelection.handleSlot === 'p2'
                            ? 'bg-violet-700 text-white border-violet-700'
                            : 'bg-white text-violet-900 border-violet-300 hover:bg-violet-50'
                        }`}
                      >
                        Edit P2 ({selectedSegment.p2.x.toFixed(1)}, {selectedSegment.p2.y.toFixed(1)})
                      </button>
                    </div>
                  )}

                  {/* Exact Subdivision */}
                  <div className="flex items-end gap-1.5">
                    <label className="w-20 space-y-0.5">
                      <span className="text-[9.5px] text-neutral-600">Split t</span>
                      <input
                        type="number"
                        min="0.05"
                        max="0.95"
                        step="0.05"
                        value={splitTInput}
                        onChange={(e) => setSplitTInput(e.target.value)}
                        data-testid="contour-split-t-input"
                        aria-label="Segment split parameter t"
                        className="w-full h-7 px-1.5 bg-white border border-neutral-300 rounded-xs font-mono text-[10px]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        commitSplitSewSegment(
                          activePiece.pieceId,
                          selectedSegment.id,
                          Number(splitTInput)
                        )
                      }
                      data-testid="contour-split-apply-btn"
                      className="flex-1 h-7 px-2 rounded-xs border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-950 text-[10px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Scissors className="w-3 h-3" />
                      Split Segment (Exact)
                    </button>
                  </div>

                  {/* Line -> Cubic (Exact) OR Cubic -> Line (R1 Approximate Preview) */}
                  {selectedSegment.kind === 'line' ? (
                    <button
                      type="button"
                      onClick={() =>
                        commitElevateLineToCubic(activePiece.pieceId, selectedSegment.id)
                      }
                      data-testid="contour-elevate-cubic-btn"
                      className="w-full py-1 rounded-xs border border-indigo-300 bg-white hover:bg-indigo-50 text-indigo-950 text-[10px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Spline className="w-3 h-3" />
                      Convert Line → Cubic (Exact Elevation)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        requestCubicToLinePreview(
                          activePiece.pieceId,
                          selectedSegment.id,
                          Number(toleranceInput)
                        )
                      }
                      data-testid="contour-cubic-to-line-preview-btn"
                      className="w-full py-1 rounded-xs border border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-950 text-[10px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Spline className="w-3 h-3" />
                      Preview Cubic → Line (Approximate, R1)
                    </button>
                  )}
                </div>
              )}

              {/* Configurable Approximation Tolerance (R1 / R2) */}
              <div className="pt-1.5 border-t border-neutral-200 flex items-center justify-between gap-2">
                <label
                  htmlFor="contour-approx-tolerance-input"
                  className="text-[10px] text-neutral-700 font-medium"
                >
                  Approximation Tolerance (cm)
                </label>
                <input
                  id="contour-approx-tolerance-input"
                  type="number"
                  min="0"
                  step="0.05"
                  value={toleranceInput}
                  onChange={(e) => {
                    setToleranceInput(e.target.value);
                    const parsed = Number(e.target.value);
                    if (Number.isFinite(parsed) && parsed >= 0) {
                      setProposalApproximationTolerance(parsed);
                    }
                  }}
                  data-testid="contour-approx-tolerance-input"
                  className="w-20 h-6 px-1.5 bg-white border border-neutral-300 rounded-xs font-mono text-[10px] text-right"
                />
              </div>
            </div>
          )}

          {/* R1 / R2 Pending Approximate Operation Preview & Confirmation Gate */}
          {pendingApproximatePreview && (
            <div
              data-testid="contour-approx-preview-card"
              className={`p-2 rounded-xs border space-y-1.5 ${
                !pendingApproximatePreview.canApply
                  ? 'border-rose-400 bg-rose-50 text-rose-950'
                  : pendingApproximatePreview.isExact
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-950'
                    : 'border-amber-400 bg-amber-50 text-amber-950'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-[10.5px]">
                  {pendingApproximatePreview.operationKind === 'cubic-to-line'
                    ? 'Cubic → Line Preview (R1)'
                    : 'Remove Vertex & Merge Preview (R2)'}
                </span>
                <span
                  data-testid="contour-approx-exactness-badge"
                  className={`px-1.5 py-0.5 rounded-xs font-mono text-[9px] font-bold uppercase ${
                    pendingApproximatePreview.isExact
                      ? 'bg-emerald-200 text-emerald-950'
                      : 'bg-amber-200 text-amber-950'
                  }`}
                >
                  {pendingApproximatePreview.isExact ? 'EXACT' : 'APPROXIMATE'}
                </span>
              </div>

              <div className="font-mono text-[10px] space-y-0.5">
                <div data-testid="contour-approx-deviation-value">
                  Max deviation:{' '}
                  {Number.isFinite(pendingApproximatePreview.maxDeviationCm)
                    ? `${pendingApproximatePreview.maxDeviationCm.toFixed(4)} cm`
                    : 'Blocked (topology)'}
                </div>
                <div>Tolerance: {pendingApproximatePreview.toleranceCm.toFixed(4)} cm</div>
                <div className="text-[9.5px] opacity-80">
                  Method: {pendingApproximatePreview.method}
                </div>
              </div>

              {pendingApproximatePreview.rejectionReason && (
                <p
                  data-testid="contour-approx-rejected-msg"
                  className="text-[10px] font-medium text-rose-900 leading-snug"
                >
                  {pendingApproximatePreview.rejectionReason}
                </p>
              )}

              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  disabled={!pendingApproximatePreview.canApply}
                  onClick={confirmPendingApproximateOperation}
                  data-testid="contour-approx-confirm-btn"
                  className={`flex-1 py-1 rounded-xs text-[10px] font-semibold ${
                    pendingApproximatePreview.canApply
                      ? 'bg-neutral-900 hover:bg-neutral-800 text-white cursor-pointer'
                      : 'bg-neutral-200 text-neutral-500 cursor-not-allowed'
                  }`}
                >
                  {pendingApproximatePreview.isExact
                    ? 'Apply Exact Merge'
                    : 'Confirm Approximate Edit'}
                </button>
                <button
                  type="button"
                  onClick={cancelPendingApproximateOperation}
                  data-testid="contour-approx-cancel-btn"
                  className="px-2 py-1 rounded-xs border border-neutral-400 bg-white hover:bg-neutral-100 text-neutral-800 text-[10px] font-medium cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* R3 Advisory Integrity Checks Panel */}
          {proposalIntegrity && (
            <div
              data-testid="proposal-advisory-integrity-panel"
              className="border border-neutral-200 rounded-xs overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setShowAllIntegrityChecks((prev) => !prev)}
                className="w-full px-2 py-1.5 bg-neutral-100/90 hover:bg-neutral-200/70 flex items-center justify-between gap-1 text-left cursor-pointer"
              >
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-neutral-800">
                  {showAllIntegrityChecks ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  Advisory Integrity (Non-Certified)
                </span>
                {renderCheckStatusBadge(proposalIntegrity.overallStatus)}
              </button>

              {showAllIntegrityChecks && (
                <div className="p-2 space-y-1.5 bg-white">
                  <div className="flex items-center gap-2 text-[9.5px] font-mono text-neutral-600">
                    <span>Pass: {proposalIntegrity.passCount}</span>
                    <span>Warn: {proposalIntegrity.warningCount}</span>
                    <span>Invalid: {proposalIntegrity.invalidCount}</span>
                    <span>Unassessed: {proposalIntegrity.unassessedCount}</span>
                  </div>
                  <div className="space-y-1">
                    {proposalIntegrity.checks.map((chk) => (
                      <div
                        key={chk.id}
                        data-testid={`proposal-check-${chk.id}`}
                        data-check-status={chk.status}
                        className="p-1.5 rounded-xs border border-neutral-200/80 bg-neutral-50/50 space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-medium text-neutral-800">
                            {chk.label}
                          </span>
                          {renderCheckStatusBadge(chk.status)}
                        </div>
                        <p className="text-[9.5px] text-neutral-600 leading-snug">{chk.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* D5 / R4 Read-Only Deterministic Proposal JSON Inspector */}
          <div className="border border-neutral-200 rounded-xs overflow-hidden">
            <div className="px-2 py-1.5 bg-neutral-100/90 flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={() => setShowPayloadJson((prev) => !prev)}
                data-testid="proposal-json-toggle-btn"
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-neutral-800 cursor-pointer"
              >
                {showPayloadJson ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Proposal Payload JSON (Read-Only)
              </button>
              <button
                type="button"
                onClick={handleCopyPayload}
                data-testid="proposal-json-copy-btn"
                className="px-1.5 py-0.5 rounded-xs border border-neutral-300 bg-white hover:bg-neutral-50 text-[9.5px] font-medium text-neutral-800 inline-flex items-center gap-1 cursor-pointer"
              >
                {copiedPayload ? (
                  <>
                    <Check className="w-2.5 h-2.5 text-emerald-700" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-2.5 h-2.5" />
                    Copy JSON
                  </>
                )}
              </button>
            </div>
            {showPayloadJson && (
              <div className="p-2 bg-neutral-950 text-neutral-100 space-y-1">
                <div className="text-[9.5px] font-mono text-amber-300">
                  READ_ONLY_LOCAL_PROPOSAL_NOT_SUBMITTED · No backend submission endpoint exists.
                </div>
                {payloadSerialization?.ok ? (
                  <pre
                    data-testid="proposal-json-preview"
                    className="max-h-56 overflow-auto font-mono text-[9.5px] leading-relaxed whitespace-pre-wrap break-all text-emerald-100"
                  >
                    {payloadSerialization.json}
                  </pre>
                ) : (
                  <div
                    data-testid="proposal-json-error"
                    className="text-[10px] font-mono text-rose-300"
                  >
                    {payloadSerialization?.error ?? 'Unable to serialize payload.'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  });

PatternContourEditInspectorSection.displayName = 'PatternContourEditInspectorSection';
