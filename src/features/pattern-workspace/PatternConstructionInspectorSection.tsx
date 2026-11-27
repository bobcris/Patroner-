/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A2 Inspector Section — Construction Geometry Creation, Notch & Drill Placement,
 * Entity Visibility/Lock Management & Lightweight Geometric Constraints.
 */

import React, { useState } from 'react';
import type { PatternPieceRenderModel, RenderNotch } from './contracts/pattern-render-artifact';
import type {
  ConstructionEntity,
  EvaluatedConstraintResult,
  GeometricConstraint,
  GeometricConstraintKind,
  InternalLineRole,
  ProposedDrillHoleRecord,
  ProposedNotchRecord,
  ReferenceAxisRole
} from './contracts/wp-a-shared-contracts';
import {
  createConstructionCircle,
  createConstructionLine,
  createInternalLine,
  createReferenceAxis,
  createTechnicalCallout,
  DEFAULT_CONSTRAINT_TOLERANCE_CM,
  DEFAULT_CONSTRAINT_TOLERANCE_DEG
} from './construction-geometry';

export type ConstructionDrawSubMode =
  | 'construction-line'
  | 'construction-circle'
  | 'reference-axis'
  | 'internal-line';

export type NotchDrillSubMode = 'notch' | 'drill';

export interface PatternConstructionInspectorSectionProps {
  readonly mode: 'construction-draw' | 'notch-drill';
  readonly activePiece: PatternPieceRenderModel | null;
  readonly drawSubMode: ConstructionDrawSubMode;
  readonly onChangeDrawSubMode: (mode: ConstructionDrawSubMode) => void;
  readonly notchDrillSubMode: NotchDrillSubMode;
  readonly onChangeNotchDrillSubMode: (mode: NotchDrillSubMode) => void;
  readonly activeNotchType: RenderNotch['notchType'];
  readonly onChangeActiveNotchType: (t: RenderNotch['notchType']) => void;
  readonly constructions: readonly ConstructionEntity[];
  readonly constraints: readonly GeometricConstraint[];
  readonly constraintEvaluations: Readonly<Record<string, EvaluatedConstraintResult>>;
  readonly proposedNotches: readonly ProposedNotchRecord[];
  readonly proposedDrills: readonly ProposedDrillHoleRecord[];
  readonly onUpsertConstruction: (entity: ConstructionEntity) => void;
  readonly onRemoveConstruction: (entityId: string) => void;
  readonly onUpsertConstraint: (constraint: GeometricConstraint) => void;
  readonly onRemoveConstraint: (constraintId: string) => void;
  readonly onUpsertNotch: (args: {
    readonly pieceId: string;
    readonly notchId: string;
    readonly segmentId: string;
    readonly targetArcLengthCm: number;
    readonly notchType: RenderNotch['notchType'];
    readonly label?: string;
  }) => void;
  readonly onRemoveNotch: (pieceId: string, notchId: string) => void;
  readonly onUpsertDrill: (args: {
    readonly pieceId: string;
    readonly drillId: string;
    readonly positionCm: { x: number; y: number };
    readonly radiusCm: number;
    readonly label?: string;
  }) => void;
  readonly onRemoveDrill: (pieceId: string, drillId: string) => void;
}

export const PatternConstructionInspectorSection: React.FC<PatternConstructionInspectorSectionProps> = ({
  mode,
  activePiece,
  drawSubMode,
  onChangeDrawSubMode,
  notchDrillSubMode,
  onChangeNotchDrillSubMode,
  activeNotchType,
  onChangeActiveNotchType,
  constructions,
  constraints,
  constraintEvaluations,
  proposedNotches,
  proposedDrills,
  onUpsertConstruction,
  onRemoveConstruction,
  onUpsertConstraint,
  onRemoveConstraint,
  onUpsertNotch,
  onRemoveNotch,
  onUpsertDrill,
  onRemoveDrill
}) => {
  const [axisRole, setAxisRole] = useState<ReferenceAxisRole>('waist');
  const [internalRole, setInternalRole] = useState<InternalLineRole>('stitch-guide');
  const [calloutText, setCalloutText] = useState('Grain / Ease Check');
  const [constraintKind, setConstraintKind] = useState<GeometricConstraintKind>('horizontal');
  const [notchSegId, setNotchSegId] = useState(activePiece?.sewSegments[0]?.id ?? '');
  const [notchArcCm, setNotchArcCm] = useState('5.0');

  const pieceCenter = activePiece
    ? {
        x: (activePiece.boundingBoxCm.minX + activePiece.boundingBoxCm.maxX) * 0.5,
        y: (activePiece.boundingBoxCm.minY + activePiece.boundingBoxCm.maxY) * 0.5
      }
    : { x: 10, y: 10 };

  const handleQuickAddReferenceAxis = () => {
    if (!activePiece) return;
    const isVert = axisRole === 'center-front' || axisRole === 'center-back' || axisRole === 'grain-axis';
    const start = isVert
      ? { x: pieceCenter.x, y: activePiece.boundingBoxCm.minY }
      : { x: activePiece.boundingBoxCm.minX, y: pieceCenter.y };
    const end = isVert
      ? { x: pieceCenter.x, y: activePiece.boundingBoxCm.maxY }
      : { x: activePiece.boundingBoxCm.maxX, y: pieceCenter.y };
    const res = createReferenceAxis({
      id: `const::axis::${Date.now()}`,
      pieceId: activePiece.pieceId,
      axisRole,
      start,
      end
    });
    if (res.ok) onUpsertConstruction(res.entity);
  };

  const handleQuickAddCircle = () => {
    if (!activePiece) return;
    const res = createConstructionCircle({
      id: `const::circle::${Date.now()}`,
      pieceId: activePiece.pieceId,
      center: { x: pieceCenter.x, y: pieceCenter.y + 6 },
      radiusCm: 4.0
    });
    if (res.ok) onUpsertConstruction(res.entity);
  };

  const handleQuickAddInternalLine = () => {
    if (!activePiece) return;
    const res = createInternalLine({
      id: `const::internal::${Date.now()}`,
      pieceId: activePiece.pieceId,
      role: internalRole,
      start: { x: pieceCenter.x - 5, y: pieceCenter.y + 13 },
      end: { x: pieceCenter.x + 5, y: pieceCenter.y + 13 }
    });
    if (res.ok) onUpsertConstruction(res.entity);
  };

  const handleQuickAddCallout = () => {
    if (!activePiece || !calloutText.trim()) return;
    const res = createTechnicalCallout({
      id: `const::callout::${Date.now()}`,
      pieceId: activePiece.pieceId,
      anchor: { x: pieceCenter.x + 3, y: pieceCenter.y - 10 },
      leaderTarget: { x: pieceCenter.x, y: pieceCenter.y - 6 },
      text: calloutText.trim()
    });
    if (res.ok) onUpsertConstruction(res.entity);
  };

  const handleQuickAddLine = () => {
    if (!activePiece) return;
    const res = createConstructionLine({
      id: `const::line::${Date.now()}`,
      pieceId: activePiece.pieceId,
      start: { x: activePiece.boundingBoxCm.minX, y: pieceCenter.y - 6 },
      end: { x: activePiece.boundingBoxCm.maxX, y: pieceCenter.y - 6 },
      label: 'Construction Line'
    });
    if (res.ok) onUpsertConstruction(res.entity);
  };

  const handleQuickAddConstraint = () => {
    if (!activePiece) return;
    const firstConst = constructions.find((c) => c.pieceId === activePiece.pieceId);
    const firstSeg = activePiece.sewSegments[0];
    const secondSeg = activePiece.sewSegments[1] ?? firstSeg;
    const refA = firstConst ? `const:${firstConst.id}` : firstSeg ? `seg:${firstSeg.id}` : null;
    const refB = secondSeg ? `seg:${secondSeg.id}` : refA;
    if (!refA) return;
    const needsTwo =
      constraintKind === 'parallel' ||
      constraintKind === 'perpendicular' ||
      constraintKind === 'equal-length' ||
      constraintKind === 'tangent-g1' ||
      constraintKind === 'distance-cm';
    onUpsertConstraint({
      id: `constraint::${Date.now()}`,
      pieceId: activePiece.pieceId,
      kind: constraintKind,
      label: `${constraintKind} (${activePiece.pieceCode})`,
      entityRefs: needsTwo && refB ? [refA, refB] : [refA],
      targetValue: constraintKind === 'distance-cm' ? 5.0 : undefined,
      toleranceCmOrDeg:
        constraintKind === 'distance-cm' || constraintKind === 'equal-length' || constraintKind === 'point-on-segment'
          ? DEFAULT_CONSTRAINT_TOLERANCE_CM
          : DEFAULT_CONSTRAINT_TOLERANCE_DEG
    });
  };

  return (
    <div data-testid="wp-a2-construction-inspector" className="space-y-3 text-xs text-slate-700">
      <div className="rounded border border-sky-200 bg-sky-50/70 px-2.5 py-1.5 text-[11px] text-sky-950">
        <div className="font-semibold">
          {mode === 'notch-drill' ? 'Notch & Drill Authoring' : 'Construction Geometry & Constraints'}
        </div>
        <div className="text-[10px] text-sky-800">
          Non-cutting visual proposal metadata (isCuttingGeometry: false). Click canvas to place.
        </div>
      </div>

      {mode === 'construction-draw' ? (
        <>
          {/* Draw Mode Switcher */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Canvas Click-Draw Tool
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ['construction-line', 'Line (2-click)'],
                  ['reference-axis', 'Axis (2-click)'],
                  ['construction-circle', 'Circle (R)'],
                  ['internal-line', 'Internal Line']
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  data-testid={`wp-a2-draw-mode-${k}`}
                  onClick={() => onChangeDrawSubMode(k)}
                  className={`rounded border px-2 py-1 text-[11px] font-medium ${
                    drawSubMode === k
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Parametric Construction Builders */}
          {activePiece && (
            <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Quick Add on {activePiece.pieceCode}
              </div>
              <div className="flex items-center gap-1">
                <select
                  value={axisRole}
                  onChange={(e) => setAxisRole(e.target.value as ReferenceAxisRole)}
                  className="flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                >
                  <option value="center-front">Center Front</option>
                  <option value="center-back">Center Back</option>
                  <option value="bust">Bust Line</option>
                  <option value="waist">Waist Line</option>
                  <option value="hip">Hip Line</option>
                  <option value="grain-axis">Grain Axis</option>
                </select>
                <button
                  type="button"
                  data-testid="wp-a2-add-axis"
                  onClick={handleQuickAddReferenceAxis}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
                >
                  + Axis
                </button>
              </div>

              <div className="flex items-center gap-1">
                <select
                  value={internalRole}
                  onChange={(e) => setInternalRole(e.target.value as InternalLineRole)}
                  className="flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                >
                  <option value="stitch-guide">Stitch Guide</option>
                  <option value="fold-line">Fold Line</option>
                  <option value="pleat-guide">Pleat Guide</option>
                  <option value="pocket-placement">Pocket Placement</option>
                  <option value="buttonhole-reference">Buttonhole Ref</option>
                </select>
                <button
                  type="button"
                  data-testid="wp-a2-add-internal"
                  onClick={handleQuickAddInternalLine}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
                >
                  + Internal
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="wp-a2-add-line"
                  onClick={handleQuickAddLine}
                  className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
                >
                  + Line
                </button>
                <button
                  type="button"
                  data-testid="wp-a2-add-circle"
                  onClick={handleQuickAddCircle}
                  className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
                >
                  + Circle R4
                </button>
              </div>

              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={calloutText}
                  onChange={(e) => setCalloutText(e.target.value)}
                  className="flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                  placeholder="Callout text"
                />
                <button
                  type="button"
                  data-testid="wp-a2-add-callout"
                  onClick={handleQuickAddCallout}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
                >
                  + Note
                </button>
              </div>
            </div>
          )}

          {/* Construction Entities List */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Construction Entities ({constructions.length})
            </div>
            {constructions.length === 0 ? (
              <div className="text-[11px] text-slate-400">No construction entities authored yet.</div>
            ) : (
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {constructions.map((ent) => (
                  <div
                    key={ent.id}
                    className="flex items-center justify-between gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                  >
                    <span className="truncate font-medium">{ent.label}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onUpsertConstruction({ ...ent, visible: !ent.visible })}
                        className="rounded border border-slate-200 px-1 text-[10px] text-slate-600 hover:bg-slate-50"
                      >
                        {ent.visible ? 'Hide' : 'Show'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpsertConstruction({ ...ent, locked: !ent.locked })}
                        className="rounded border border-slate-200 px-1 text-[10px] text-slate-600 hover:bg-slate-50"
                      >
                        {ent.locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveConstruction(ent.id)}
                        className="text-[10px] text-rose-600 hover:underline"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Geometric Constraints */}
          <div className="space-y-1.5 border-t border-slate-200 pt-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Advisory Geometric Constraints ({constraints.length})
            </div>
            <div className="flex items-center gap-1">
              <select
                value={constraintKind}
                onChange={(e) => setConstraintKind(e.target.value as GeometricConstraintKind)}
                className="flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
                <option value="parallel">Parallel</option>
                <option value="perpendicular">Perpendicular</option>
                <option value="equal-length">Equal Length</option>
                <option value="tangent-g1">Tangent G1</option>
                <option value="distance-cm">Distance (cm)</option>
              </select>
              <button
                type="button"
                data-testid="wp-a2-add-constraint"
                onClick={handleQuickAddConstraint}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
              >
                + Check
              </button>
            </div>
            {constraints.map((c) => {
              const ev = constraintEvaluations[c.id];
              const badgeCls =
                ev?.status === 'satisfied'
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : ev?.status === 'violated'
                    ? 'text-amber-800 bg-amber-50 border-amber-200'
                    : 'text-rose-700 bg-rose-50 border-rose-200';
              return (
                <div key={c.id} className="rounded border border-slate-200 bg-white p-1.5 text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">{c.label}</span>
                    <div className="flex items-center gap-1">
                      <span className={`rounded border px-1 py-0.25 uppercase ${badgeCls}`}>
                        {ev?.status ?? 'pending'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveConstraint(c.id)}
                        className="text-rose-600 hover:underline"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                  {ev && <div className="mt-0.5 font-mono text-slate-600">{ev.message}</div>}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* Notch & Drill Authoring Mode */
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              data-testid="wp-a2-submode-notch"
              onClick={() => onChangeNotchDrillSubMode('notch')}
              className={`rounded border px-2 py-1 text-[11px] font-medium ${
                notchDrillSubMode === 'notch'
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              Place Notch (Edge)
            </button>
            <button
              type="button"
              data-testid="wp-a2-submode-drill"
              onClick={() => onChangeNotchDrillSubMode('drill')}
              className={`rounded border px-2 py-1 text-[11px] font-medium ${
                notchDrillSubMode === 'drill'
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              Place Drill Hole
            </button>
          </div>

          {activePiece && notchDrillSubMode === 'notch' && (
            <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[10px] text-slate-500">Notch Style</label>
                  <select
                    value={activeNotchType}
                    onChange={(e) => onChangeActiveNotchType(e.target.value as RenderNotch['notchType'])}
                    className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                  >
                    <option value="slit">Slit</option>
                    <option value="v-notch">V-Notch</option>
                    <option value="t-notch">T-Notch</option>
                    <option value="double">Double</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500">Arc Offset (cm)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={notchArcCm}
                    onChange={(e) => setNotchArcCm(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 font-mono text-[11px]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500">Host Sew Segment</label>
                <select
                  value={notchSegId || activePiece.sewSegments[0]?.id || ''}
                  onChange={(e) => setNotchSegId(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                >
                  {activePiece.sewSegments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} ({s.role})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                data-testid="wp-a2-add-notch-btn"
                onClick={() => {
                  const targetSeg = notchSegId || activePiece.sewSegments[0]?.id;
                  if (!targetSeg) return;
                  const arc = Number.parseFloat(notchArcCm);
                  onUpsertNotch({
                    pieceId: activePiece.pieceId,
                    notchId: `notch::prop::${Date.now()}`,
                    segmentId: targetSeg,
                    targetArcLengthCm: Number.isFinite(arc) ? arc : 4.0,
                    notchType: activeNotchType,
                    label: `N${proposedNotches.length + 1}`
                  });
                }}
                className="w-full rounded bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-700"
              >
                + Anchor Notch on Segment
              </button>
            </div>
          )}

          {activePiece && notchDrillSubMode === 'drill' && (
            <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
              <button
                type="button"
                data-testid="wp-a2-add-drill-btn"
                onClick={() =>
                  onUpsertDrill({
                    pieceId: activePiece.pieceId,
                    drillId: `drill::prop::${Date.now()}`,
                    positionCm: pieceCenter,
                    radiusCm: 0.25,
                    label: `D${proposedDrills.length + 1}`
                  })
                }
                className="w-full rounded bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-700"
              >
                + Place Center Drill Hole ({activePiece.pieceCode})
              </button>
            </div>
          )}

          {/* Anchored Notches List */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Piece Notches ({proposedNotches.length})
            </div>
            {proposedNotches.map((n) => (
              <div
                key={n.id}
                className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-[10px]"
              >
                <div>
                  <span className="font-semibold">{n.label || n.id}</span> · {n.notchType} ·{' '}
                  <span className="font-mono">{n.targetArcLengthCm.toFixed(1)}cm</span>
                  {n.reconciliationStatus !== 'resolved' && (
                    <span className="ml-1 text-amber-700">({n.reconciliationStatus})</span>
                  )}
                </div>
                {n.origin === 'proposal-authored' && activePiece && (
                  <button
                    type="button"
                    onClick={() => onRemoveNotch(activePiece.pieceId, n.id)}
                    className="text-rose-600 hover:underline"
                  >
                    Del
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Drill Holes List */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Drill Holes ({proposedDrills.length})
            </div>
            {proposedDrills.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-[10px]"
              >
                <span className="font-mono">
                  {d.label || d.id} ({d.position.x.toFixed(1)}, {d.position.y.toFixed(1)})
                </span>
                {d.origin === 'proposal-authored' && activePiece && (
                  <button
                    type="button"
                    onClick={() => onRemoveDrill(activePiece.pieceId, d.id)}
                    className="text-rose-600 hover:underline"
                  >
                    Del
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
