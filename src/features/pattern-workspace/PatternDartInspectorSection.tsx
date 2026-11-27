/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A3 Inspector Section — C0 Bodice Dart Preset Bridge, Proposal Dart Creation/Editing,
 * Slash-and-Spread Rotation/Split Transfer & Advisory Dart Conservation Report.
 */

import React, { useMemo, useState } from 'react';
import type { BodiceDartStyle } from '../../types';
import type { PatternPieceRenderModel } from './contracts/pattern-render-artifact';
import type {
  DartConservationReport,
  DartFoldDirection,
  ProposedDartModel
} from './contracts/wp-a-shared-contracts';
import { C0_BODICE_DART_PRESETS, DART_DEFAULT_BACKOFF_CM } from './dart-authoring';

export interface PatternDartInspectorSectionProps {
  readonly activePiece: PatternPieceRenderModel | null;
  readonly isBodiceGarment: boolean;
  readonly currentBodiceDartStyle?: BodiceDartStyle;
  readonly onChangeBodiceDartStyle?: (style: BodiceDartStyle) => void;
  readonly proposedDarts: readonly ProposedDartModel[];
  readonly selectedDartId: string | null;
  readonly onSelectDartId: (dartId: string | null) => void;
  readonly conservationReport: DartConservationReport | null;
  readonly onCreateDart: (args: {
    readonly pieceId: string;
    readonly dartId: string;
    readonly label: string;
    readonly hostSegmentId: string;
    readonly centerParameterT: number;
    readonly intakeWidthCm: number;
    readonly pivotApexCm: { x: number; y: number };
    readonly backoffCm: number;
    readonly foldDirection: DartFoldDirection;
  }) => void;
  readonly onEditDart: (args: {
    readonly pieceId: string;
    readonly dartId: string;
    readonly intakeWidthCm?: number;
    readonly backoffCm?: number;
    readonly foldDirection?: DartFoldDirection;
  }) => void;
  readonly onTransferDart: (args: {
    readonly pieceId: string;
    readonly sourceDartId: string;
    readonly newDartId: string;
    readonly targetHostSegmentId: string;
    readonly targetParameterT: number;
    readonly transferRatio: number;
    readonly backoffCm: number;
    readonly foldDirection: DartFoldDirection;
  }) => void;
  readonly onCloseOrOpenDart: (pieceId: string, dartId: string, closed: boolean) => void;
}

export const PatternDartInspectorSection: React.FC<PatternDartInspectorSectionProps> = ({
  activePiece,
  isBodiceGarment,
  currentBodiceDartStyle,
  onChangeBodiceDartStyle,
  proposedDarts,
  selectedDartId,
  onSelectDartId,
  conservationReport,
  onCreateDart,
  onEditDart,
  onTransferDart,
  onCloseOrOpenDart
}) => {
  const nonDartSegments = useMemo(
    () => (activePiece?.sewSegments ?? []).filter((s) => !s.id.includes('::leg-') && s.role !== 'fold' && !s.isFold),
    [activePiece]
  );

  const [hostSegId, setHostSegId] = useState(nonDartSegments[0]?.id ?? '');
  const [intakeCm, setIntakeCm] = useState('3.0');
  const [backoffCm, setBackoffCm] = useState(String(DART_DEFAULT_BACKOFF_CM));
  const [foldDir, setFoldDir] = useState<DartFoldDirection>('toward-center');

  const [transferTargetSegId, setTransferTargetSegId] = useState(nonDartSegments[1]?.id ?? nonDartSegments[0]?.id ?? '');
  const [transferRatio, setTransferRatio] = useState('1.0');

  const selectedDart = proposedDarts.find((d) => d.id === selectedDartId) ?? proposedDarts[0] ?? null;

  const pieceCenter = activePiece
    ? {
        x: (activePiece.boundingBoxCm.minX + activePiece.boundingBoxCm.maxX) * 0.5,
        y: (activePiece.boundingBoxCm.minY + activePiece.boundingBoxCm.maxY) * 0.5
      }
    : { x: 10, y: 10 };

  return (
    <div data-testid="wp-a3-dart-inspector" className="space-y-3 text-xs text-slate-700">
      <div className="rounded border border-rose-200 bg-rose-50/70 px-2.5 py-1.5 text-[11px] text-rose-950">
        <div className="font-semibold">Dart Authoring & Manipulation</div>
        <div className="text-[10px] text-rose-800">
          UNVERIFIED_VISUAL_PROPOSAL · Sew contour only; original cut contour unchanged.
        </div>
      </div>

      {/* Bridge to existing C0 Bodice Dart Engine (No Math Duplication) */}
      {isBodiceGarment && onChangeBodiceDartStyle && (
        <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            C0 Bodice Engine Presets (dart-manipulation.ts)
          </div>
          <div className="grid grid-cols-2 gap-1">
            {C0_BODICE_DART_PRESETS.map((preset) => (
              <button
                key={preset.style}
                type="button"
                data-testid={`wp-a3-c0-preset-${preset.style}`}
                onClick={() => onChangeBodiceDartStyle(preset.style)}
                className={`rounded border px-2 py-1 text-left text-[10px] font-medium ${
                  currentBodiceDartStyle === preset.style
                    ? 'border-rose-600 bg-rose-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
                title={preset.summary}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Proposal Dart Creation on Active Piece */}
      {activePiece && (
        <div className="space-y-2 rounded border border-slate-200 bg-white p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Create Proposal Dart ({activePiece.pieceCode})
          </div>
          <div>
            <label className="block text-[10px] text-slate-500">Host Sew Segment</label>
            <select
              value={hostSegId || nonDartSegments[0]?.id || ''}
              onChange={(e) => setHostSegId(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
            >
              {nonDartSegments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} ({s.role})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <label className="block text-[10px] text-slate-500">Intake (cm)</label>
              <input
                type="number"
                step="0.25"
                min="0.5"
                max="10"
                value={intakeCm}
                onChange={(e) => setIntakeCm(e.target.value)}
                className="w-full rounded border border-slate-300 px-1.5 py-1 font-mono text-[11px]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500">Backoff (cm)</label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="5"
                value={backoffCm}
                onChange={(e) => setBackoffCm(e.target.value)}
                className="w-full rounded border border-slate-300 px-1.5 py-1 font-mono text-[11px]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500">Fold</label>
              <select
                value={foldDir}
                onChange={(e) => setFoldDir(e.target.value as DartFoldDirection)}
                className="w-full rounded border border-slate-300 bg-white px-1 py-1 text-[10px]"
              >
                <option value="toward-center">Center</option>
                <option value="toward-side">Side</option>
                <option value="downward">Down</option>
                <option value="upward">Up</option>
              </select>
            </div>
          </div>
          <button
            type="button"
            data-testid="wp-a3-create-dart-btn"
            onClick={() => {
              const segId = hostSegId || nonDartSegments[0]?.id;
              if (!segId) return;
              const id = `dart::prop::${Date.now()}`;
              onCreateDart({
                pieceId: activePiece.pieceId,
                dartId: id,
                label: `Dart ${proposedDarts.length + 1}`,
                hostSegmentId: segId,
                centerParameterT: 0.5,
                intakeWidthCm: Number.parseFloat(intakeCm) || 3.0,
                pivotApexCm: pieceCenter,
                backoffCm: Number.parseFloat(backoffCm) || 2.0,
                foldDirection: foldDir
              });
              onSelectDartId(id);
            }}
            className="w-full rounded bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-700"
          >
            + Insert Parametric Dart
          </button>
        </div>
      )}

      {/* Active Proposal Darts & Rotation Transfer */}
      {proposedDarts.length > 0 && activePiece && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Proposal Darts ({proposedDarts.length})
          </div>
          <div className="space-y-1">
            {proposedDarts.map((d) => (
              <div
                key={d.id}
                className={`flex items-center justify-between rounded border px-2 py-1 text-[11px] ${
                  selectedDart?.id === d.id ? 'border-rose-500 bg-rose-50/70' : 'border-slate-200 bg-white'
                }`}
              >
                <button type="button" onClick={() => onSelectDartId(d.id)} className="text-left">
                  <div className="font-medium text-slate-800">{d.label}</div>
                  <div className="font-mono text-[10px] text-slate-500">
                    {((d.intakeAngleRad * 180) / Math.PI).toFixed(2)}° · {d.intakeWidthCm.toFixed(2)}cm · L=
                    {d.legLengthLeftCm.toFixed(2)}cm
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onCloseOrOpenDart(activePiece.pieceId, d.id, !d.isClosed)}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px]"
                >
                  {d.isClosed ? 'Open' : 'Close'}
                </button>
              </div>
            ))}
          </div>

          {selectedDart && !selectedDart.isClosed && (
            <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Edit / Rotate-Transfer: {selectedDart.label}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="wp-a3-widen-dart-btn"
                  onClick={() =>
                    onEditDart({
                      pieceId: activePiece.pieceId,
                      dartId: selectedDart.id,
                      intakeWidthCm: Number((selectedDart.intakeWidthCm + 0.5).toFixed(2))
                    })
                  }
                  className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-slate-100"
                >
                  +0.5 cm Intake
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onEditDart({
                      pieceId: activePiece.pieceId,
                      dartId: selectedDart.id,
                      backoffCm: selectedDart.backoffCm >= 2.5 ? 1.5 : 2.5
                    })
                  }
                  className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium hover:bg-slate-100"
                >
                  Toggle Backoff
                </button>
              </div>

              <div className="space-y-1 border-t border-slate-200 pt-1.5">
                <label className="block text-[10px] text-slate-500">Transfer / Split Target Edge</label>
                <select
                  value={transferTargetSegId || nonDartSegments[0]?.id || ''}
                  onChange={(e) => setTransferTargetSegId(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px]"
                >
                  {nonDartSegments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5">
                  <select
                    value={transferRatio}
                    onChange={(e) => setTransferRatio(e.target.value)}
                    className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[10px]"
                  >
                    <option value="1.0">100% Full Transfer</option>
                    <option value="0.5">50% Split Dart</option>
                    <option value="0.33">33% Split Dart</option>
                  </select>
                  <button
                    type="button"
                    data-testid="wp-a3-transfer-dart-btn"
                    onClick={() => {
                      const tgt = transferTargetSegId || nonDartSegments[0]?.id;
                      if (!tgt) return;
                      onTransferDart({
                        pieceId: activePiece.pieceId,
                        sourceDartId: selectedDart.id,
                        newDartId: `dart::xfer::${Date.now()}`,
                        targetHostSegmentId: tgt,
                        targetParameterT: 0.5,
                        transferRatio: Number.parseFloat(transferRatio) || 1.0,
                        backoffCm: selectedDart.backoffCm,
                        foldDirection: selectedDart.foldDirection
                      });
                    }}
                    className="flex-1 rounded bg-rose-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-rose-700"
                  >
                    Slash & Rotate
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Advisory Conservation Report */}
      {conservationReport && (
        <div
          data-testid="wp-a3-conservation-report"
          className="space-y-1 rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[10px]"
        >
          <div className="flex items-center justify-between font-sans text-[11px] font-semibold">
            <span>Advisory Conservation Report</span>
            <span
              className={
                conservationReport.withinAdvisoryTolerances ? 'text-emerald-700' : 'text-amber-700'
              }
            >
              {conservationReport.withinAdvisoryTolerances ? 'WITHIN TOL' : 'CHECK'}
            </span>
          </div>
          <div>
            Angle Δ: {((conservationReport.angularIntakeResidualRad * 180) / Math.PI).toFixed(4)}° · Apex Drift:{' '}
            {conservationReport.apexDriftCm.toFixed(4)} cm
          </div>
          <div>
            Leg Parity Max Δ: {conservationReport.maxLegLengthParityDeltaCm.toFixed(5)} cm · Closed:{' '}
            {conservationReport.contourClosed ? 'Yes' : 'NO'}
          </div>
          <div className="font-sans text-[9.5px] text-slate-500">
            {conservationReport.advisories[0]} (isCertified: false)
          </div>
        </div>
      )}
    </div>
  );
};
