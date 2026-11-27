/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A5 Inspector Section — Parametric Operation Timeline, Inline Parameter Editing & Replay,
 * Invalidation Recovery & Read-Only Versioned Payload v2 JSON Inspection/Copy.
 *
 * Strictly read-only JSON serialization (`READ_ONLY_LOCAL_PROPOSAL_NOT_SUBMITTED`).
 * Zero backend submission claims.
 */

import React, { useMemo, useState } from 'react';
import type { PatternArtifactBundle } from './contracts/pattern-render-artifact';
import type {
  ParametricOpReplayStatus,
  ParametricProposalOp,
  WpAEngineeringState
} from './contracts/wp-a-shared-contracts';
import type { GeometryProposalHistoryState } from './geometry-edit-proposal';
import { serializeWpAProposalPayloadV2 } from './parametric-proposal-engine';

export interface PatternOperationHistorySectionProps {
  readonly sourceArtifact: PatternArtifactBundle;
  readonly proposalHistory: GeometryProposalHistoryState;
  readonly wpAState: WpAEngineeringState;
  readonly onUpdateParametricOp: (
    opId: string,
    updater: (op: ParametricProposalOp) => ParametricProposalOp,
    actionLabel?: string
  ) => void;
  readonly onToggleParametricOp: (opId: string) => void;
  readonly onRemoveParametricOp: (opId: string) => void;
  readonly onRebindInvalidatedOp: (opId: string, newSegmentId: string) => void;
  readonly onUndoProposal: () => void;
  readonly onRedoProposal: () => void;
  readonly canUndoProposal: boolean;
  readonly canRedoProposal: boolean;
}

export const PatternOperationHistorySection: React.FC<PatternOperationHistorySectionProps> = ({
  sourceArtifact,
  proposalHistory,
  wpAState,
  onUpdateParametricOp,
  onToggleParametricOp,
  onRemoveParametricOp,
  onRebindInvalidatedOp,
  onUndoProposal,
  onRedoProposal,
  canUndoProposal,
  canRedoProposal
}) => {
  const [showPayloadJson, setShowPayloadJson] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const payloadResult = useMemo(() => {
    if (!showPayloadJson) return null;
    return serializeWpAProposalPayloadV2(sourceArtifact, proposalHistory);
  }, [showPayloadJson, sourceArtifact, proposalHistory]);

  const handleCopyJson = async () => {
    const res = payloadResult ?? serializeWpAProposalPayloadV2(sourceArtifact, proposalHistory);
    if (!res.ok) return;
    try {
      await navigator.clipboard.writeText(res.json);
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 1800);
    } catch {
      setCopiedPayload(false);
    }
  };

  const renderStatusBadge = (st: ParametricOpReplayStatus | undefined) => {
    const status = st?.status ?? 'applied';
    const cls =
      status === 'applied'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : status === 'skipped-disabled'
          ? 'bg-slate-100 text-slate-600 border-slate-200'
          : 'bg-rose-50 text-rose-700 border-rose-200';
    return <span className={`rounded border px-1 py-0.25 text-[9.5px] uppercase ${cls}`}>{status}</span>;
  };

  return (
    <div data-testid="wp-a5-operation-history" className="space-y-2.5 text-xs text-slate-700">
      {/* Header + Unified Proposal Undo/Redo */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Parametric Operation Graph ({wpAState.operations.length})
          </div>
          <div className="text-[10px] text-slate-500">
            Applied: {wpAState.graphDiagnostic.appliedOpCount} · Invalidated:{' '}
            {wpAState.graphDiagnostic.invalidatedOpIds.length} · History: {proposalHistory.past.length}/
            {proposalHistory.maxEntries}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="wp-a5-undo-btn"
            disabled={!canUndoProposal}
            onClick={onUndoProposal}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            data-testid="wp-a5-redo-btn"
            disabled={!canRedoProposal}
            onClick={onRedoProposal}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium disabled:opacity-40"
          >
            Redo
          </button>
        </div>
      </div>

      {/* Operations Timeline */}
      {wpAState.operations.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 p-2 text-[11px] text-slate-500">
          No WP-A parametric operations recorded yet. Use Seam Walk, Construction, Notch/Drill, Dart, or Allowance tools.
        </div>
      ) : (
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {wpAState.operations.map((op) => {
            const st = wpAState.replayStatuses[op.opId];
            const piece = sourceArtifact.pieces.find((p) => p.pieceId === op.pieceId);
            const isInvalid = st?.status === 'invalidated-upstream' || st?.status === 'failed';

            return (
              <div
                key={op.opId}
                data-testid={`wp-a5-op-${op.opId}`}
                className="space-y-1 rounded border border-slate-200 bg-white p-2 text-[11px]"
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="truncate font-medium text-slate-800">
                    <span className="mr-1 font-mono text-[10px] text-slate-400">#{op.sequence}</span>
                    {op.label}
                  </div>
                  {renderStatusBadge(st)}
                </div>

                {/* Inline Numeric Replay Editor for key parametric ops */}
                {op.kind === 'create-dart' && (
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-slate-500">Intake:</span>
                    <input
                      type="number"
                      step="0.25"
                      min="0.5"
                      max="10"
                      defaultValue={op.params.intakeWidthCm}
                      onBlur={(e) => {
                        const v = Number.parseFloat(e.target.value);
                        if (Number.isFinite(v) && v !== op.params.intakeWidthCm) {
                          onUpdateParametricOp(
                            op.opId,
                            (cur) =>
                              cur.kind === 'create-dart'
                                ? { ...cur, params: { ...cur.params, intakeWidthCm: v } }
                                : cur,
                            `Replay dart intake -> ${v} cm`
                          );
                        }
                      }}
                      className="w-16 rounded border border-slate-300 px-1 py-0.5 font-mono"
                    />
                    <span className="text-slate-400">cm</span>
                  </div>
                )}

                {op.kind === 'set-piece-default-allowance' && (
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-slate-500">Default SA:</span>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      max="12"
                      defaultValue={op.params.defaultAllowanceCm}
                      onBlur={(e) => {
                        const v = Number.parseFloat(e.target.value);
                        if (Number.isFinite(v) && v !== op.params.defaultAllowanceCm) {
                          onUpdateParametricOp(
                            op.opId,
                            (cur) =>
                              cur.kind === 'set-piece-default-allowance'
                                ? { ...cur, params: { ...cur.params, defaultAllowanceCm: v } }
                                : cur,
                            `Replay default SA -> ${v} cm`
                          );
                        }
                      }}
                      className="w-16 rounded border border-slate-300 px-1 py-0.5 font-mono"
                    />
                    <span className="text-slate-400">cm</span>
                  </div>
                )}

                {op.kind === 'upsert-notch' && (
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-slate-500">Arc Offset:</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      defaultValue={op.params.targetArcLengthCm}
                      onBlur={(e) => {
                        const v = Number.parseFloat(e.target.value);
                        if (Number.isFinite(v) && v !== op.params.targetArcLengthCm) {
                          onUpdateParametricOp(
                            op.opId,
                            (cur) =>
                              cur.kind === 'upsert-notch'
                                ? { ...cur, params: { ...cur.params, targetArcLengthCm: v } }
                                : cur,
                            `Replay notch arc -> ${v} cm`
                          );
                        }
                      }}
                      className="w-16 rounded border border-slate-300 px-1 py-0.5 font-mono"
                    />
                    <span className="text-slate-400">cm</span>
                  </div>
                )}

                {st?.reason && <div className="text-[10px] text-rose-700">{st.reason}</div>}

                {/* Controls + Rebind Recovery for invalidated ops */}
                <div className="flex items-center justify-between pt-0.5 text-[10px]">
                  <span className="font-mono text-slate-400">{op.domain}</span>
                  <div className="flex items-center gap-1.5">
                    {isInvalid && piece && piece.sewSegments[0] && (
                      <button
                        type="button"
                        data-testid={`wp-a5-rebind-${op.opId}`}
                        onClick={() => onRebindInvalidatedOp(op.opId, piece.sewSegments[0].id)}
                        className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800 hover:bg-amber-100"
                      >
                        Rebind
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onToggleParametricOp(op.opId)}
                      className="text-slate-600 hover:underline"
                    >
                      {op.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveParametricOp(op.opId)}
                      className="text-rose-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Read-Only Payload v2 Inspection & Copy */}
      <div className="space-y-1.5 border-t border-slate-200 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Payload v2 (Read-Only Local)
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="wp-a5-toggle-payload-v2"
              onClick={() => setShowPayloadJson((v) => !v)}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium hover:bg-slate-50"
            >
              {showPayloadJson ? 'Hide JSON' : 'Inspect JSON'}
            </button>
            <button
              type="button"
              data-testid="wp-a5-copy-payload-v2"
              onClick={handleCopyJson}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium hover:bg-slate-50"
            >
              {copiedPayload ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
        </div>
        {showPayloadJson && payloadResult && (
          <pre
            data-testid="wp-a5-payload-v2-json"
            className="max-h-48 overflow-auto rounded border border-slate-200 bg-slate-900 p-2 font-mono text-[9.5px] leading-relaxed text-slate-100"
          >
            {payloadResult.ok ? payloadResult.json : `Serialization Error: ${payloadResult.error}`}
          </pre>
        )}
      </div>
    </div>
  );
};
