/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A1 Inspector Section — Seam Correspondence Pairing, Interactive Walk Scrubber,
 * Interval Ease Breakdown, Notch Discrepancy Table & Advisory Endpoint Trueing.
 */

import React, { useMemo, useState } from 'react';
import type { PatternArtifactBundle } from './contracts/pattern-render-artifact';
import type {
  SeamCorrespondencePair,
  SeamWalkEvaluation
} from './contracts/wp-a-shared-contracts';

export interface PatternSeamInspectorSectionProps {
  readonly artifact: PatternArtifactBundle;
  readonly seamPairs: readonly SeamCorrespondencePair[];
  readonly activePairId: string | null;
  readonly onSelectPairId: (pairId: string) => void;
  readonly evaluation: SeamWalkEvaluation | null;
  readonly walkFraction: number;
  readonly onChangeWalkFraction: (fraction: number) => void;
  readonly showGhostPieceB: boolean;
  readonly onToggleGhostPieceB: (next: boolean) => void;
  readonly onUpsertSeamPair: (pair: SeamCorrespondencePair) => void;
  readonly onRemoveSeamPair: (pairId: string) => void;
  readonly onTrueSeamEndpoint: (args: {
    readonly pairId: string;
    readonly targetSide: 'A' | 'B';
    readonly endpoint: 'start' | 'end';
    readonly targetJoinAngleDeg: number;
    readonly maxHandleAdjustmentCm: number;
  }) => void;
}

export const PatternSeamInspectorSection: React.FC<PatternSeamInspectorSectionProps> = ({
  artifact,
  seamPairs,
  activePairId,
  onSelectPairId,
  evaluation,
  walkFraction,
  onChangeWalkFraction,
  showGhostPieceB,
  onToggleGhostPieceB,
  onUpsertSeamPair,
  onRemoveSeamPair,
  onTrueSeamEndpoint
}) => {
  const activePair = useMemo(
    () => seamPairs.find((p) => p.id === activePairId) ?? seamPairs[0] ?? null,
    [seamPairs, activePairId]
  );

  // Custom pair creation state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [pieceAId, setPieceAId] = useState(artifact.pieces[0]?.pieceId ?? '');
  const [pieceBId, setPieceBId] = useState(artifact.pieces[1]?.pieceId ?? artifact.pieces[0]?.pieceId ?? '');
  const [segAId, setSegAId] = useState(artifact.pieces[0]?.sewSegments[0]?.id ?? '');
  const [segBId, setSegBId] = useState(
    (artifact.pieces[1] ?? artifact.pieces[0])?.sewSegments[0]?.id ?? ''
  );
  const [targetEaseCm, setTargetEaseCm] = useState('0');
  const [customLabel, setCustomLabel] = useState('');

  const pieceAObj = artifact.pieces.find((p) => p.pieceId === pieceAId) ?? artifact.pieces[0];
  const pieceBObj = artifact.pieces.find((p) => p.pieceId === pieceBId) ?? artifact.pieces[0];

  const handleCreateCustomPair = () => {
    if (!pieceAObj || !pieceBObj) return;
    const resolvedSegA = pieceAObj.sewSegments.find((s) => s.id === segAId)?.id ?? pieceAObj.sewSegments[0]?.id;
    const resolvedSegB = pieceBObj.sewSegments.find((s) => s.id === segBId)?.id ?? pieceBObj.sewSegments[0]?.id;
    if (!resolvedSegA || !resolvedSegB) return;

    const easeVal = Number.parseFloat(targetEaseCm);
    const id = `seam-pair::custom::${Date.now()}`;
    const pair: SeamCorrespondencePair = {
      id,
      label: customLabel.trim() || `${pieceAObj.pieceCode} ↔ ${pieceBObj.pieceCode} Custom`,
      sideA: { pieceId: pieceAObj.pieceId, segmentIds: [resolvedSegA], direction: 1 },
      sideB: { pieceId: pieceBObj.pieceId, segmentIds: [resolvedSegB], direction: -1 },
      targetEaseCm: Number.isFinite(easeVal) ? easeVal : 0,
      origin: 'user-proposal',
      matchedNotchPairs: []
    };
    onUpsertSeamPair(pair);
    onSelectPairId(id);
    setShowCreateForm(false);
    setCustomLabel('');
  };

  return (
    <div data-testid="wp-a1-seam-inspector" className="space-y-3 text-xs text-slate-700">
      <div className="rounded border border-indigo-200 bg-indigo-50/70 px-2.5 py-1.5 text-[11px] text-indigo-950">
        <div className="font-semibold">Seam Walk & Trueing — Advisory Proposal</div>
        <div className="text-[10px] text-indigo-800">
          UNVERIFIED_VISUAL_PROPOSAL · Not DEC-11 Certified · Sew contours only.
        </div>
      </div>

      {/* Pair selector */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Seam Pairs ({seamPairs.length})
          </span>
          <button
            type="button"
            data-testid="wp-a1-toggle-create-pair"
            onClick={() => setShowCreateForm((v) => !v)}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            {showCreateForm ? 'Cancel' : '+ New Pair'}
          </button>
        </div>

        {showCreateForm && (
          <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
            <input
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Pair label (e.g. Side Seam)"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[10px] text-slate-500">Piece A</label>
                <select
                  value={pieceAObj?.pieceId ?? ''}
                  onChange={(e) => {
                    setPieceAId(e.target.value);
                    const p = artifact.pieces.find((x) => x.pieceId === e.target.value);
                    setSegAId(p?.sewSegments[0]?.id ?? '');
                  }}
                  className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                >
                  {artifact.pieces.map((p) => (
                    <option key={p.pieceId} value={p.pieceId}>
                      {p.pieceCode}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500">Segment A</label>
                <select
                  value={segAId}
                  onChange={(e) => setSegAId(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                >
                  {(pieceAObj?.sewSegments ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500">Piece B</label>
                <select
                  value={pieceBObj?.pieceId ?? ''}
                  onChange={(e) => {
                    setPieceBId(e.target.value);
                    const p = artifact.pieces.find((x) => x.pieceId === e.target.value);
                    setSegBId(p?.sewSegments[0]?.id ?? '');
                  }}
                  className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                >
                  {artifact.pieces.map((p) => (
                    <option key={p.pieceId} value={p.pieceId}>
                      {p.pieceCode}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500">Segment B</label>
                <select
                  value={segBId}
                  onChange={(e) => setSegBId(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                >
                  {(pieceBObj?.sewSegments ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-slate-500">Target Ease (cm)</label>
              <input
                type="number"
                step="0.1"
                value={targetEaseCm}
                onChange={(e) => setTargetEaseCm(e.target.value)}
                className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-mono"
              />
              <button
                type="button"
                data-testid="wp-a1-confirm-create-pair"
                onClick={handleCreateCustomPair}
                className="ml-auto rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
              >
                Add Pair
              </button>
            </div>
          </div>
        )}

        {seamPairs.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 p-2 text-[11px] text-slate-500">
            No seam pairs detected. Click &ldquo;+ New Pair&rdquo; to define a correspondence.
          </div>
        ) : (
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {seamPairs.map((pair) => {
              const selected = activePair?.id === pair.id;
              return (
                <div
                  key={pair.id}
                  className={`flex items-center justify-between rounded border px-2 py-1 ${
                    selected ? 'border-indigo-500 bg-indigo-50/70' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectPairId(pair.id)}
                    className="flex-1 truncate text-left text-[11px] font-medium text-slate-800"
                  >
                    {pair.label}
                  </button>
                  {pair.origin === 'user-proposal' && (
                    <button
                      type="button"
                      onClick={() => onRemoveSeamPair(pair.id)}
                      className="ml-1 text-[10px] text-rose-600 hover:underline"
                    >
                      Del
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Pair Controls & Evaluation */}
      {activePair && evaluation && (
        <div className="space-y-2.5 border-t border-slate-200 pt-2.5">
          {/* Scrub slider + Ghost toggle */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-slate-700">Walk Position</span>
              <span className="font-mono text-slate-600">
                {evaluation.walkCursorArcCm.toFixed(2)} cm ({Math.round(walkFraction * 100)}%)
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={walkFraction}
              data-testid="wp-a1-walk-scrubber"
              onChange={(e) => onChangeWalkFraction(Number.parseFloat(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <label className="flex items-center gap-1.5 text-slate-600">
                <input
                  type="checkbox"
                  checked={showGhostPieceB}
                  onChange={(e) => onToggleGhostPieceB(e.target.checked)}
                />
                Show Walked Ghost Piece B
              </label>
              <button
                type="button"
                onClick={() =>
                  onUpsertSeamPair({
                    ...activePair,
                    sideB: {
                      ...activePair.sideB,
                      direction: activePair.sideB.direction === 1 ? -1 : 1
                    }
                  })
                }
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium hover:bg-slate-50"
              >
                Flip B Dir ({activePair.sideB.direction === 1 ? '+1' : '-1'})
              </button>
            </div>
          </div>

          {/* Length & Ease Summary */}
          <div className="grid grid-cols-2 gap-1.5 rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px]">
            <div>
              <div className="text-[10px] font-sans text-slate-500">Side A Length</div>
              <div className="font-semibold text-indigo-700">{evaluation.totalLengthACm.toFixed(3)} cm</div>
            </div>
            <div>
              <div className="text-[10px] font-sans text-slate-500">Side B Length</div>
              <div className="font-semibold text-teal-700">{evaluation.totalLengthBCm.toFixed(3)} cm</div>
            </div>
            <div>
              <div className="text-[10px] font-sans text-slate-500">Raw Δ (A − B)</div>
              <div className={Math.abs(evaluation.rawDeltaCm) > 0.3 ? 'font-semibold text-amber-700' : 'text-slate-800'}>
                {evaluation.rawDeltaCm >= 0 ? '+' : ''}
                {evaluation.rawDeltaCm.toFixed(3)} cm
              </div>
            </div>
            <div>
              <div className="text-[10px] font-sans text-slate-500">Net vs Ease ({evaluation.targetEaseCm.toFixed(1)})</div>
              <div className={Math.abs(evaluation.netDeltaAfterEaseCm) > 0.3 ? 'font-semibold text-rose-700' : 'text-emerald-700'}>
                {evaluation.netDeltaAfterEaseCm >= 0 ? '+' : ''}
                {evaluation.netDeltaAfterEaseCm.toFixed(3)} cm
              </div>
            </div>
          </div>

          {/* Endpoint Join Angles & Trueing Proposals */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Endpoint Join Continuity
            </div>
            {(['start', 'end'] as const).map((epKey) => {
              const ep = evaluation.endpointAnalysis[epKey];
              if (!ep) return null;
              return (
                <div
                  key={epKey}
                  className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                >
                  <div>
                    <span className="font-medium capitalize">{epKey}:</span>{' '}
                    <span className="font-mono">
                      {ep.matedJoinAngleDeg !== null ? `${ep.matedJoinAngleDeg.toFixed(1)}°` : '—'}
                    </span>{' '}
                    <span className="text-[10px] text-slate-500">({ep.classification})</span>
                  </div>
                  <button
                    type="button"
                    data-testid={`wp-a1-true-${epKey}`}
                    onClick={() =>
                      onTrueSeamEndpoint({
                        pairId: activePair.id,
                        targetSide: 'A',
                        endpoint: epKey,
                        targetJoinAngleDeg: 180,
                        maxHandleAdjustmentCm: 3.0
                      })
                    }
                    className="rounded border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800 hover:bg-indigo-100"
                  >
                    True 180°
                  </button>
                </div>
              );
            })}
          </div>

          {/* Interval Ease Breakdown */}
          {evaluation.intervals.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Interval Ease Breakdown
              </div>
              <div className="overflow-hidden rounded border border-slate-200">
                <table className="w-full text-left font-mono text-[10px]">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="px-1.5 py-1 font-sans">Span</th>
                      <th className="px-1.5 py-1 text-right">A</th>
                      <th className="px-1.5 py-1 text-right">B</th>
                      <th className="px-1.5 py-1 text-right">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {evaluation.intervals.map((iv) => (
                      <tr key={iv.intervalIndex}>
                        <td className="px-1.5 py-1 font-sans text-slate-700">
                          {iv.startLabel}→{iv.endLabel}
                        </td>
                        <td className="px-1.5 py-1 text-right">{iv.lengthACm.toFixed(2)}</td>
                        <td className="px-1.5 py-1 text-right">{iv.lengthBCm.toFixed(2)}</td>
                        <td className="px-1.5 py-1 text-right">
                          {iv.deltaCm >= 0 ? '+' : ''}
                          {iv.deltaCm.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Notch Discrepancy Table */}
          {evaluation.notchDiscrepancies.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Notch Correspondence
              </div>
              {evaluation.notchDiscrepancies.map((nd) => (
                <div
                  key={`${nd.notchIdA}-${nd.notchIdB}`}
                  className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-[10px]"
                >
                  <span className="font-medium">{nd.label}</span>
                  <span className="font-mono">
                    {nd.deltaCm !== null ? `Δ ${nd.deltaCm >= 0 ? '+' : ''}${nd.deltaCm.toFixed(2)} cm` : 'Unresolved'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
