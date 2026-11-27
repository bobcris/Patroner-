/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A4 Inspector Section — Declarative Seam Allowance Rules, Corner Overrides & Production Annotations.
 *
 * STRICT GOVERNANCE DISCLOSURE:
 * - Declarative metadata ONLY (`cutGeometryRegeneratedInClient: false`).
 * - Original `cutSegments` remain untouched and read-only.
 */

import React, { useState } from 'react';
import type { PatternPieceRenderModel } from './contracts/pattern-render-artifact';
import type {
  CornerJoinStyle,
  DeclarativeAllowanceEdgeRole,
  DeclarativeSeamAllowanceRule,
  PieceAllowanceRuleEvaluation,
  PieceProductionAnnotationProposal,
  VertexCornerRuleOverride
} from './contracts/wp-a-shared-contracts';
import { WP_A_ALLOWANCE_RULE_DISCLOSURE } from './contracts/wp-a-shared-contracts';
import { buildDeclarativeSegmentRule } from './seam-allowance-rules';

export interface PatternAllowanceInspectorSectionProps {
  readonly activePiece: PatternPieceRenderModel | null;
  readonly selectedSegmentId: string | null;
  readonly onSelectSegmentId: (segmentId: string | null) => void;
  readonly proposal: PieceProductionAnnotationProposal | null;
  readonly evaluation: PieceAllowanceRuleEvaluation | null;
  readonly onSetPieceDefaultAllowance: (pieceId: string, defaultAllowanceCm: number) => void;
  readonly onSetSegmentAllowanceRule: (pieceId: string, rule: DeclarativeSeamAllowanceRule) => void;
  readonly onSetVertexCornerRule: (pieceId: string, override: VertexCornerRuleOverride) => void;
  readonly onSetProductionAnnotation: (
    pieceId: string,
    patch: {
      readonly cutQuantityNote?: string;
      readonly onFoldDeclared?: boolean;
      readonly fabricNote?: string;
      readonly interfacingNote?: string;
      readonly productionNotes?: string;
    }
  ) => void;
}

export const PatternAllowanceInspectorSection: React.FC<PatternAllowanceInspectorSectionProps> = ({
  activePiece,
  selectedSegmentId,
  onSelectSegmentId,
  proposal,
  evaluation,
  onSetPieceDefaultAllowance,
  onSetSegmentAllowanceRule,
  onSetVertexCornerRule,
  onSetProductionAnnotation
}) => {
  const effectiveSegId = selectedSegmentId ?? activePiece?.sewSegments[0]?.id ?? '';
  const currentRule = effectiveSegId ? evaluation?.resolvedRulesBySegmentId[effectiveSegId] : undefined;

  const [defaultCmInput, setDefaultCmInput] = useState(String(proposal?.defaultAllowanceCm ?? 1.5));
  const [segDistanceInput, setSegDistanceInput] = useState(String(currentRule?.distanceCm ?? 1.5));
  const [segEndDistanceInput, setSegEndDistanceInput] = useState(
    currentRule?.endDistanceCm !== undefined ? String(currentRule.endDistanceCm) : ''
  );
  const [segRole, setSegRole] = useState<DeclarativeAllowanceEdgeRole>(currentRule?.edgeRole ?? 'seam-edge');
  const [segJoinStyle, setSegJoinStyle] = useState<CornerJoinStyle>(currentRule?.joinStyle ?? 'miter');
  const [segMiterLimit, setSegMiterLimit] = useState(String(currentRule?.miterLimit ?? 4.0));
  const [isFoldEdge, setIsFoldEdge] = useState(Boolean(currentRule?.isFoldEdge));

  const [cutQtyNote, setCutQtyNote] = useState(proposal?.cutQuantityNote ?? 'Cut 2 Self');
  const [fabricNote, setFabricNote] = useState(proposal?.fabricNote ?? 'Main Shell');
  const [interfacingNote, setInterfacingNote] = useState(proposal?.interfacingNote ?? '');
  const [onFoldDeclared, setOnFoldDeclared] = useState(Boolean(proposal?.onFoldDeclared));

  if (!activePiece) {
    return (
      <div className="text-xs text-slate-500">Select a pattern piece to author declarative seam allowance rules.</div>
    );
  }

  return (
    <div data-testid="wp-a4-allowance-inspector" className="space-y-3 text-xs text-slate-700">
      <div className="rounded border border-amber-300 bg-amber-50/80 px-2.5 py-1.5 text-[10.5px] text-amber-950">
        <div className="font-semibold">Declarative Allowance Rules (No TS Cut Offsets)</div>
        <div className="mt-0.5 text-[10px] leading-snug text-amber-900">{WP_A_ALLOWANCE_RULE_DISCLOSURE}</div>
      </div>

      {/* Piece Default Allowance */}
      <div className="space-y-1 rounded border border-slate-200 bg-white p-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Piece Default ({activePiece.pieceCode})
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step="0.25"
            min="0"
            max="12"
            value={defaultCmInput}
            data-testid="wp-a4-default-allowance-input"
            onChange={(e) => setDefaultCmInput(e.target.value)}
            className="w-24 rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
          />
          <span className="text-[11px] text-slate-500">cm</span>
          <button
            type="button"
            data-testid="wp-a4-apply-default-btn"
            onClick={() => {
              const v = Number.parseFloat(defaultCmInput);
              if (Number.isFinite(v)) onSetPieceDefaultAllowance(activePiece.pieceId, v);
            }}
            className="ml-auto rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-900"
          >
            Apply Default
          </button>
        </div>
      </div>

      {/* Segment Override Editor */}
      <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Per-Segment Declarative Rule
        </div>
        <select
          value={effectiveSegId}
          onChange={(e) => {
            const nextId = e.target.value;
            onSelectSegmentId(nextId);
            const r = evaluation?.resolvedRulesBySegmentId[nextId];
            if (r) {
              setSegDistanceInput(String(r.distanceCm));
              setSegEndDistanceInput(r.endDistanceCm !== undefined ? String(r.endDistanceCm) : '');
              setSegRole(r.edgeRole);
              setSegJoinStyle(r.joinStyle);
              setSegMiterLimit(String(r.miterLimit));
              setIsFoldEdge(r.isFoldEdge);
            }
          }}
          className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
        >
          {activePiece.sewSegments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} ({s.role})
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="block text-[10px] text-slate-500">Edge Role</label>
            <select
              value={segRole}
              onChange={(e) => {
                const role = e.target.value as DeclarativeAllowanceEdgeRole;
                setSegRole(role);
                if (role === 'fold-edge') {
                  setIsFoldEdge(true);
                  setSegDistanceInput('0');
                }
              }}
              className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
            >
              <option value="seam-edge">Seam Edge</option>
              <option value="hem-turn-up">Hem Turn-Up</option>
              <option value="fold-edge">Fold Edge (0 cm)</option>
              <option value="facing-edge">Facing Edge</option>
              <option value="raw-bound-edge">Raw / Bound</option>
              <option value="dart-cap">Dart Cap</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500">Corner Join</label>
            <select
              value={segJoinStyle}
              onChange={(e) => setSegJoinStyle(e.target.value as CornerJoinStyle)}
              className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
            >
              <option value="miter">Miter</option>
              <option value="bevel">Bevel</option>
              <option value="round">Round</option>
              <option value="fold">Fold</option>
              <option value="stepped-corner">Stepped Corner</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-500">Start Allowance (cm)</label>
            <input
              type="number"
              step="0.25"
              value={segDistanceInput}
              data-testid="wp-a4-seg-distance-input"
              onChange={(e) => setSegDistanceInput(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 font-mono text-[11px]"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500">Taper End (opt cm)</label>
            <input
              type="number"
              step="0.25"
              value={segEndDistanceInput}
              onChange={(e) => setSegEndDistanceInput(e.target.value)}
              placeholder="Uniform"
              className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 font-mono text-[11px]"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1 text-[11px]">
            <input type="checkbox" checked={isFoldEdge} onChange={(e) => setIsFoldEdge(e.target.checked)} />
            Fold Edge (0 cm)
          </label>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">Miter</span>
            <input
              type="number"
              step="0.5"
              value={segMiterLimit}
              onChange={(e) => setSegMiterLimit(e.target.value)}
              className="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[11px]"
            />
          </div>
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            data-testid="wp-a4-apply-seg-rule-btn"
            onClick={() => {
              if (!effectiveSegId) return;
              const dist = Number.parseFloat(segDistanceInput);
              const endDist = segEndDistanceInput.trim() ? Number.parseFloat(segEndDistanceInput) : undefined;
              const miter = Number.parseFloat(segMiterLimit);
              const rule = buildDeclarativeSegmentRule({
                segmentId: effectiveSegId,
                edgeRole: segRole,
                distanceCm: Number.isFinite(dist) ? dist : 1.5,
                endDistanceCm: endDist !== undefined && Number.isFinite(endDist) ? endDist : undefined,
                joinStyle: segJoinStyle,
                miterLimit: Number.isFinite(miter) ? miter : 4.0,
                isFoldEdge
              });
              onSetSegmentAllowanceRule(activePiece.pieceId, rule);
            }}
            className="flex-1 rounded bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
          >
            Save Segment Rule
          </button>
          <button
            type="button"
            data-testid="wp-a4-apply-corner-btn"
            onClick={() => {
              if (!effectiveSegId) return;
              onSetVertexCornerRule(activePiece.pieceId, {
                vertexRef: `${effectiveSegId}:p0`,
                pieceId: activePiece.pieceId,
                joinStyle: segJoinStyle,
                miterLimit: Number.parseFloat(segMiterLimit) || 4.0
              });
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-slate-100"
          >
            Pin Corner
          </button>
        </div>
      </div>

      {/* Production Annotations */}
      <div className="space-y-1.5 rounded border border-slate-200 bg-white p-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Production Annotations
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="text"
            value={cutQtyNote}
            onChange={(e) => setCutQtyNote(e.target.value)}
            placeholder="Cut Qty (e.g. Cut 2 Self)"
            className="rounded border border-slate-300 px-1.5 py-1 text-[11px]"
          />
          <input
            type="text"
            value={fabricNote}
            onChange={(e) => setFabricNote(e.target.value)}
            placeholder="Fabric / Lining"
            className="rounded border border-slate-300 px-1.5 py-1 text-[11px]"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <input
            type="text"
            value={interfacingNote}
            onChange={(e) => setInterfacingNote(e.target.value)}
            placeholder="Interfacing note (optional)"
            className="flex-1 rounded border border-slate-300 px-1.5 py-1 text-[11px]"
          />
          <label className="flex items-center gap-1 text-[11px]">
            <input type="checkbox" checked={onFoldDeclared} onChange={(e) => setOnFoldDeclared(e.target.checked)} />
            On Fold
          </label>
        </div>
        <button
          type="button"
          data-testid="wp-a4-save-annotation-btn"
          onClick={() =>
            onSetProductionAnnotation(activePiece.pieceId, {
              cutQuantityNote: cutQtyNote.trim() || undefined,
              fabricNote: fabricNote.trim() || undefined,
              interfacingNote: interfacingNote.trim() || undefined,
              onFoldDeclared
            })
          }
          className="w-full rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
        >
          Save Production Notes
        </button>
      </div>

      {/* Conflicts List */}
      {evaluation && evaluation.conflicts.length > 0 && (
        <div data-testid="wp-a4-conflicts-list" className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
            Rule Conflicts ({evaluation.conflicts.length})
          </div>
          {evaluation.conflicts.map((c) => (
            <div
              key={c.id}
              className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-900"
            >
              <span className="font-mono font-semibold">{c.code}:</span> {c.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
