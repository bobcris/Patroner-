/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileJson,
  GitBranch,
  Lock,
  ShieldAlert
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DesignSpecification } from '../../types';
import {
  Ac09AuthorizedReviewerRole,
  Ac09MeasurementInstrument,
  Ac09PhysicalToileEvaluation,
  Ac09PhysicalToileRecord,
  Ac09ToileBlockKey,
  Ac09WorkflowState,
  AUTHORIZED_AC09_REVIEWER_ROLES,
  createNewAc09SampleRevision,
  INSTRUMENT_RESOLUTION_CM,
  recordAc09RepeatMeasurements,
  recordAc09ReviewerDecision,
  registerAc09PhysicalSample,
  serializeAc09ValidationReport
} from '../../engine/simulation';

interface Ac09PhysicalValidationPanelProps {
  activeBlock: Ac09ToileBlockKey;
  onSelectBlock: (block: Ac09ToileBlockKey) => void;
  record: Ac09PhysicalToileRecord;
  evaluation: Ac09PhysicalToileEvaluation;
  currentSpec: DesignSpecification;
  onUpdateRecord: (updater: (prev: Ac09PhysicalToileRecord) => Ac09PhysicalToileRecord) => void;
  onResetPending: () => void;
}

const WORKFLOW_STEPS: Ac09WorkflowState[] = [
  'DRAFT',
  'SAMPLE_REGISTERED',
  'EVIDENCE_INCOMPLETE',
  'READY_FOR_REVIEW',
  'PASSED'
];

export const Ac09PhysicalValidationPanel: React.FC<Ac09PhysicalValidationPanelProps> = ({
  activeBlock,
  onSelectBlock,
  record,
  evaluation,
  currentSpec,
  onUpdateRecord,
  onResetPending
}) => {
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerRole, setReviewerRole] = useState<Ac09AuthorizedReviewerRole>('LEAD_PATTERNMAKER');
  const [reviewerRationale, setReviewerRationale] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [showExportReport, setShowExportReport] = useState(false);

  const isLocked = Boolean(record.isLocked);
  const trace = record.traceability;
  const proc = record.processRecord;

  const { report: serializedReport, canonicalJson } = useMemo(
    () => serializeAc09ValidationReport(record),
    [record]
  );

  const handleSafeUpdate = (updater: (prev: Ac09PhysicalToileRecord) => Ac09PhysicalToileRecord) => {
    setActionError(null);
    try {
      onUpdateRecord(updater);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([canonicalJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${record.sampleId || record.recordId}-rev${record.sampleRevision ?? 1}.ac09.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div
      className="bg-white border border-neutral-200 rounded-sm p-4 shadow-2xs space-y-4"
      data-testid="m06-ac09-panel"
    >
      {/* Header & Protocol Tabs */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-neutral-100 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <ClipboardCheck className="w-4 h-4 text-neutral-800" />
            <h4 className="text-sm font-serif font-bold text-neutral-900">
              AC-09 Physical Validation Execution Package (M06 §18)
            </h4>
            <Badge
              variant={
                evaluation.status === 'PASSED'
                  ? 'success'
                  : evaluation.status === 'FAILED'
                  ? 'danger'
                  : 'warning'
              }
              size="sm"
              data-testid="m06-ac09-status-badge"
            >
              AC-09: {evaluation.status}
            </Badge>
            <Badge
              variant={
                evaluation.workflowState === 'PASSED'
                  ? 'success'
                  : evaluation.workflowState === 'FAILED'
                  ? 'danger'
                  : 'neutral'
              }
              size="sm"
              data-testid="m06-ac09-workflow-badge"
            >
              STATE: {evaluation.workflowState}
            </Badge>
            <span className="text-[11px] font-mono px-2 py-0.5 border border-neutral-200 bg-neutral-50 text-neutral-700 rounded-xs">
              REV #{record.sampleRevision ?? 1}
              {isLocked ? ' • LOCKED' : ' • EDITABLE'}
            </span>
          </div>
          <p className="text-xs text-neutral-600">
            Physical sewn-toile execution strictly separates simulation forecasts from physical measurements (≤ 0.50 cm POM &amp; ≥ 85% regional agreement + authorized sign-off). Synthetic inputs are blocked.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['skirt-block-v1', 'bodice-sleeve-v1'] as Ac09ToileBlockKey[]).map(key => (
            <button
              key={key}
              type="button"
              onClick={() => onSelectBlock(key)}
              data-testid={`m06-ac09-tab-${key}`}
              className={`px-2.5 py-1 text-[11px] font-mono rounded-xs border cursor-pointer ${
                activeBlock === key
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
              }`}
            >
              {key}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              onResetPending();
            }}
            data-testid="m06-ac09-reset-btn"
            className="px-2.5 py-1 text-[11px] font-mono rounded-xs border border-neutral-300 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 cursor-pointer"
          >
            Reset Pending
          </button>
          <button
            type="button"
            onClick={() => setShowExportReport(v => !v)}
            data-testid="m06-ac09-toggle-export-btn"
            className="px-2.5 py-1 text-[11px] font-mono rounded-xs border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 cursor-pointer inline-flex items-center gap-1"
          >
            <FileJson className="w-3 h-3" />
            {showExportReport ? 'Hide Report' : 'Export Report'}
          </button>
        </div>
      </div>

      {/* In-Session Persistence Disclosure Notice (P1-2D) */}
      <div
        className="border border-amber-300 bg-amber-50/70 rounded-xs px-3 py-2 text-[11px] font-mono text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
        data-testid="m06-ac09-persistence-notice"
      >
        <div className="flex items-start sm:items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-800 shrink-0 mt-0.5 sm:mt-0" />
          <span>
            <strong>IN-SESSION BROWSER STATE ONLY:</strong> AC-09 physical validation entries are held in temporary in-session browser memory and are not durably persisted across tabs, page reloads, or sessions. Use <strong>Export Report</strong> to archive canonical JSON evidence.
          </span>
        </div>
        <Badge variant="warning" size="sm" className="shrink-0">
          NON-DURABLE SESSION STORE
        </Badge>
      </div>

      {/* Explicit Validation State Machine Stepper */}
      <div
        className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[10px] font-mono"
        data-testid="m06-ac09-stepper"
      >
        {WORKFLOW_STEPS.map((step, idx) => {
          const isFailed = evaluation.workflowState === 'FAILED';
          const currentIdx = WORKFLOW_STEPS.indexOf(
            isFailed ? 'PASSED' : evaluation.workflowState
          );
          const isCurrent = isFailed ? step === 'PASSED' : evaluation.workflowState === step;
          const isDone =
            !isFailed &&
            (evaluation.workflowState === 'PASSED' ||
              (currentIdx > idx && evaluation.workflowState !== 'PENDING'));
          return (
            <div
              key={step}
              className={`px-2 py-1.5 border rounded-xs flex items-center justify-between ${
                isCurrent && isFailed
                  ? 'border-red-700 bg-red-700 text-white font-bold'
                  : isCurrent
                  ? 'border-neutral-900 bg-neutral-900 text-white font-bold'
                  : isDone
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-neutral-200 bg-neutral-50 text-neutral-500'
              }`}
            >
              <span>
                {idx + 1}. {isFailed && step === 'PASSED' ? 'FAILED' : step}
              </span>
            </div>
          );
        })}
      </div>

      {actionError && (
        <div
          className="border border-red-300 bg-red-50 text-red-900 rounded-xs p-2.5 text-xs font-mono flex items-start gap-2"
          data-testid="m06-ac09-action-error"
        >
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
          <span>{actionError}</span>
        </div>
      )}

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
        <div className="border border-neutral-200 bg-neutral-50 p-2.5 rounded-xs">
          <span className="text-[10px] text-neutral-500 block uppercase">POM Concordance (≤ 0.50 cm)</span>
          <strong>
            {evaluation.completedPomCount}/{evaluation.requiredPomCount} recorded
            {evaluation.maxPomConcordanceErrorCm !== null
              ? ` • max Δ ${evaluation.maxPomConcordanceErrorCm.toFixed(3)} cm`
              : ' • Awaiting Tape'}
          </strong>
        </div>
        <div className="border border-neutral-200 bg-neutral-50 p-2.5 rounded-xs">
          <span className="text-[10px] text-neutral-500 block uppercase">Repeat Uncertainty (≤ 0.25 cm)</span>
          <strong>
            {evaluation.maxMeasurementUncertaintyCm !== null
              ? `±${evaluation.maxMeasurementUncertaintyCm.toFixed(3)} cm`
              : `Instrument ±${((record.instrumentResolutionCm ?? 0.1) / 2).toFixed(3)} cm`}
          </strong>
        </div>
        <div className="border border-neutral-200 bg-neutral-50 p-2.5 rounded-xs">
          <span className="text-[10px] text-neutral-500 block uppercase">Regional Agreement (≥ 85%)</span>
          <strong>
            {evaluation.regionalAgreementPct !== null
              ? `${evaluation.regionalAgreementPct.toFixed(1)}% (${evaluation.agreedZonesCount}/${evaluation.evaluatedZonesCount})`
              : `0/${record.regionalAgreementChecks.length} zones`}
          </strong>
        </div>
        <div className="border border-neutral-200 bg-neutral-50 p-2.5 rounded-xs">
          <span className="text-[10px] text-neutral-500 block uppercase">Traceability &amp; Sign-Off</span>
          <strong>
            {evaluation.traceabilityVerified ? 'Specs Verified' : 'Trace Pending/Mismatch'} •{' '}
            {evaluation.signOffAuthorized ? 'Signed' : 'Unsigned'}
          </strong>
        </div>
      </div>

      {/* Physical Sample Registration, Material Traceability & Process Logs */}
      <div
        className="border border-neutral-200 rounded-xs p-3 bg-neutral-50/50 space-y-3"
        data-testid="m06-ac09-registration-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2">
          <div className="text-[11px] font-mono font-bold text-neutral-900 uppercase">
            1. Sample Registration, Fabric Spec Traceability &amp; Process Execution Log
          </div>
          {!isLocked && (
            <button
              type="button"
              onClick={() =>
                handleSafeUpdate(r =>
                  registerAc09PhysicalSample(r, {
                    sampleId: r.sampleId || `TOILE-${r.sizeCode}-001`,
                    recordedPatternRevisionId: r.traceability?.approvedPatternRevisionId ?? r.revisionId,
                    recordedFabricId: r.fabricId,
                    recordedFabricComposition: r.traceability?.expectedFabricComposition ?? currentSpec.fabric.name,
                    recordedFabricWeightGsm: r.traceability?.expectedFabricWeightGsm ?? 180,
                    recordedFabricStretchPct: r.traceability?.expectedFabricStretchPct ?? 0,
                    recordedFabricDirection: r.traceability?.expectedFabricDirection ?? 'WARP_GRAINLINE_PARALLEL',
                    recordedFabricLot: r.traceability?.recordedFabricLot || 'LOT-2026-A',
                    evaluatedAt: r.evaluatedAt ?? todayStr
                  })
                )
              }
              data-testid="m06-ac09-sync-trace-btn"
              className="px-2 py-0.5 text-[10px] font-mono border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100 rounded-xs cursor-pointer"
            >
              Populate Approved Baseline Refs
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
          <label className="block bg-white border border-neutral-200 p-2 rounded-xs">
            <span className="text-[10px] font-mono text-neutral-500 block uppercase">Sample ID</span>
            <input
              type="text"
              disabled={isLocked}
              data-testid="m06-ac09-sample-id-input"
              value={record.sampleId ?? ''}
              onChange={e =>
                handleSafeUpdate(r =>
                  registerAc09PhysicalSample(r, {
                    sampleId: e.target.value,
                    evaluatedAt: r.evaluatedAt ?? todayStr
                  })
                )
              }
              placeholder="e.g., TOILE-M-001"
              className="w-full mt-0.5 font-mono text-xs border-b border-neutral-200 focus:outline-none focus:border-neutral-900 disabled:text-neutral-500"
            />
          </label>

          <label className="block bg-white border border-neutral-200 p-2 rounded-xs">
            <span className="text-[10px] font-mono text-neutral-500 block uppercase">
              Cut Pattern Revision (Approved: {trace?.approvedPatternRevisionId ?? record.revisionId})
            </span>
            <input
              type="text"
              disabled={isLocked}
              data-testid="m06-ac09-pattern-rev-input"
              value={trace?.recordedPatternRevisionId ?? ''}
              onChange={e =>
                handleSafeUpdate(r => ({
                  ...r,
                  executionMode: 'workflow',
                  traceability: r.traceability
                    ? { ...r.traceability, recordedPatternRevisionId: e.target.value }
                    : undefined
                }))
              }
              placeholder={trace?.approvedPatternRevisionId ?? record.revisionId}
              className="w-full mt-0.5 font-mono text-xs border-b border-neutral-200 focus:outline-none focus:border-neutral-900 disabled:text-neutral-500"
            />
          </label>

          <label className="block bg-white border border-neutral-200 p-2 rounded-xs">
            <span className="text-[10px] font-mono text-neutral-500 block uppercase">Inspector / Patternmaker</span>
            <input
              type="text"
              disabled={isLocked}
              data-testid="m06-ac09-evaluator-input"
              value={record.evaluatorName}
              onChange={e =>
                handleSafeUpdate(r => ({
                  ...r,
                  evaluatorName: e.target.value,
                  evaluatedAt: r.evaluatedAt ?? todayStr
                }))
              }
              placeholder="Lead Patternmaker name"
              className="w-full mt-0.5 text-xs border-b border-neutral-200 focus:outline-none focus:border-neutral-900 disabled:text-neutral-500"
            />
          </label>

          <label className="block bg-white border border-neutral-200 p-2 rounded-xs">
            <span className="text-[10px] font-mono text-neutral-500 block uppercase">Dress Form / Body Ref</span>
            <input
              type="text"
              disabled={isLocked}
              data-testid="m06-ac09-dressform-input"
              value={record.bodyOrDressFormId}
              onChange={e =>
                handleSafeUpdate(r => ({
                  ...r,
                  bodyOrDressFormId: e.target.value,
                  evaluatedAt: r.evaluatedAt ?? todayStr
                }))
              }
              placeholder="e.g., Wolf-M-Form-01"
              className="w-full mt-0.5 font-mono text-xs border-b border-neutral-200 focus:outline-none focus:border-neutral-900 disabled:text-neutral-500"
            />
          </label>

          <label className="block bg-white border border-neutral-200 p-2 rounded-xs">
            <span className="text-[10px] font-mono text-neutral-500 block uppercase">
              Fabric Composition (Exp: {trace?.expectedFabricComposition})
            </span>
            <input
              type="text"
              disabled={isLocked}
              value={trace?.recordedFabricComposition ?? ''}
              onChange={e =>
                handleSafeUpdate(r => ({
                  ...r,
                  executionMode: 'workflow',
                  traceability: r.traceability
                    ? { ...r.traceability, recordedFabricComposition: e.target.value }
                    : undefined
                }))
              }
              placeholder="e.g., 100% Cotton Muslin"
              className="w-full mt-0.5 text-xs border-b border-neutral-200 focus:outline-none focus:border-neutral-900"
            />
          </label>

          <div className="bg-white border border-neutral-200 p-2 rounded-xs grid grid-cols-2 gap-1.5">
            <label>
              <span className="text-[10px] font-mono text-neutral-500 block uppercase">GSM</span>
              <input
                type="number"
                disabled={isLocked}
                value={trace?.recordedFabricWeightGsm ?? ''}
                onChange={e => {
                  const val = e.target.value.trim() === '' ? null : Number(e.target.value);
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    traceability: r.traceability ? { ...r.traceability, recordedFabricWeightGsm: val } : undefined
                  }));
                }}
                placeholder={String(trace?.expectedFabricWeightGsm ?? 180)}
                className="w-full mt-0.5 font-mono text-xs border-b border-neutral-200 focus:outline-none"
              />
            </label>
            <label>
              <span className="text-[10px] font-mono text-neutral-500 block uppercase">Stretch %</span>
              <input
                type="number"
                step="0.5"
                disabled={isLocked}
                value={trace?.recordedFabricStretchPct ?? ''}
                onChange={e => {
                  const val = e.target.value.trim() === '' ? null : Number(e.target.value);
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    traceability: r.traceability ? { ...r.traceability, recordedFabricStretchPct: val } : undefined
                  }));
                }}
                placeholder={String(trace?.expectedFabricStretchPct ?? 0)}
                className="w-full mt-0.5 font-mono text-xs border-b border-neutral-200 focus:outline-none"
              />
            </label>
          </div>

          <label className="block bg-white border border-neutral-200 p-2 rounded-xs">
            <span className="text-[10px] font-mono text-neutral-500 block uppercase">Cut Direction &amp; Lot</span>
            <div className="flex gap-1 mt-0.5">
              <select
                disabled={isLocked}
                value={trace?.recordedFabricDirection ?? ''}
                onChange={e =>
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    traceability: r.traceability
                      ? { ...r.traceability, recordedFabricDirection: e.target.value }
                      : undefined
                  }))
                }
                className="text-[11px] font-mono border-b border-neutral-200 bg-transparent flex-1"
              >
                <option value="">Select dir…</option>
                <option value="WARP_GRAINLINE_PARALLEL">WARP_PARALLEL</option>
                <option value="WEFT_CROSSGRAIN">WEFT_CROSS</option>
                <option value="TRUE_BIAS_45">TRUE_BIAS_45</option>
              </select>
              <input
                type="text"
                disabled={isLocked}
                value={trace?.recordedFabricLot ?? ''}
                onChange={e =>
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    traceability: r.traceability ? { ...r.traceability, recordedFabricLot: e.target.value } : undefined
                  }))
                }
                placeholder="Lot #"
                className="w-20 font-mono text-[11px] border-b border-neutral-200 focus:outline-none"
              />
            </div>
          </label>

          <label className="block bg-white border border-neutral-200 p-2 rounded-xs">
            <span className="text-[10px] font-mono text-neutral-500 block uppercase">Measurement Instrument</span>
            <select
              disabled={isLocked}
              data-testid="m06-ac09-instrument-select"
              value={record.measurementInstrument ?? 'calibrated-fiberglass-tape'}
              onChange={e => {
                const inst = e.target.value as Ac09MeasurementInstrument;
                handleSafeUpdate(r => ({
                  ...r,
                  measurementInstrument: inst,
                  instrumentResolutionCm: INSTRUMENT_RESOLUTION_CM[inst]
                }));
              }}
              className="w-full mt-0.5 font-mono text-[11px] bg-transparent border-b border-neutral-200"
            >
              <option value="calibrated-fiberglass-tape">Calibrated Tape (±0.10 cm)</option>
              <option value="flexible-steel-rule">Flexible Steel Rule (±0.05 cm)</option>
              <option value="digital-caliper">Digital Caliper (±0.01 cm)</option>
            </select>
          </label>

          {/* Cutting & Sewing Execution */}
          <label className="block bg-white border border-neutral-200 p-2 rounded-xs">
            <span className="text-[10px] font-mono text-neutral-500 block uppercase">Cutting Operator &amp; Date</span>
            <div className="flex gap-1 mt-0.5">
              <input
                type="text"
                disabled={isLocked}
                value={proc?.cuttingOperator ?? ''}
                onChange={e =>
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    processRecord: { ...(r.processRecord ?? proc!), cuttingOperator: e.target.value }
                  }))
                }
                placeholder="Cutter name"
                className="flex-1 text-xs border-b border-neutral-200 focus:outline-none"
              />
              <input
                type="date"
                disabled={isLocked}
                value={proc?.cutDate ?? ''}
                onChange={e =>
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    processRecord: { ...(r.processRecord ?? proc!), cutDate: e.target.value || null }
                  }))
                }
                className="text-[11px] font-mono border-b border-neutral-200"
              />
            </div>
          </label>

          <label className="block bg-white border border-neutral-200 p-2 rounded-xs">
            <span className="text-[10px] font-mono text-neutral-500 block uppercase">Sewing Operator &amp; Date</span>
            <div className="flex gap-1 mt-0.5">
              <input
                type="text"
                disabled={isLocked}
                value={proc?.sewingOperator ?? ''}
                onChange={e =>
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    processRecord: { ...(r.processRecord ?? proc!), sewingOperator: e.target.value }
                  }))
                }
                placeholder="Sample sewer"
                className="flex-1 text-xs border-b border-neutral-200 focus:outline-none"
              />
              <input
                type="date"
                disabled={isLocked}
                value={proc?.sewnDate ?? ''}
                onChange={e =>
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    processRecord: { ...(r.processRecord ?? proc!), sewnDate: e.target.value || null }
                  }))
                }
                className="text-[11px] font-mono border-b border-neutral-200"
              />
            </div>
          </label>

          <div className="bg-white border border-neutral-200 p-2 rounded-xs space-y-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-[96px_1fr] gap-2">
              <label>
                <span className="text-[10px] font-mono text-neutral-500 block uppercase">Seam Allow (cm)</span>
                <input
                  type="number"
                  step="0.1"
                  disabled={isLocked}
                  value={proc?.seamAllowanceCm ?? ''}
                  onChange={e => {
                    const val = e.target.value.trim() === '' ? null : Number(e.target.value);
                    handleSafeUpdate(r => ({
                      ...r,
                      executionMode: 'workflow',
                      processRecord: { ...(r.processRecord ?? proc!), seamAllowanceCm: val }
                    }));
                  }}
                  placeholder="1.5"
                  className="w-full mt-0.5 font-mono text-xs border-b border-neutral-200 focus:outline-none"
                />
              </label>
              <label>
                <span className="text-[10px] font-mono text-neutral-500 block uppercase">Stitch Type</span>
                <input
                  type="text"
                  disabled={isLocked}
                  data-testid="m06-ac09-stitch-type-input"
                  value={proc?.stitchType ?? ''}
                  onChange={e =>
                    handleSafeUpdate(r => ({
                      ...r,
                      executionMode: 'workflow',
                      processRecord: {
                        ...(r.processRecord ?? proc!),
                        stitchType: e.target.value
                      }
                    }))
                  }
                  placeholder="ISO-301 lockstitch"
                  className="w-full mt-0.5 text-[11px] border-b border-neutral-200 focus:outline-none"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[10px] font-mono text-neutral-500 block uppercase">Pressing Method</span>
              <input
                type="text"
                disabled={isLocked}
                data-testid="m06-ac09-pressing-method-input"
                value={proc?.pressingMethod ?? ''}
                onChange={e =>
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    processRecord: {
                      ...(r.processRecord ?? proc!),
                      pressingMethod: e.target.value
                    }
                  }))
                }
                placeholder="Steam pressed open"
                className="w-full mt-0.5 text-[11px] border-b border-neutral-200 focus:outline-none"
              />
            </label>
          </div>

          <div className="bg-white border border-neutral-200 p-2 rounded-xs flex flex-col justify-between gap-2">
            <label className="flex items-start gap-2 cursor-pointer text-[11px] font-mono text-neutral-800">
              <input
                type="checkbox"
                disabled={isLocked}
                checked={Boolean(proc?.cuttingGrainlineVerified)}
                data-testid="m06-ac09-cutting-grainline-checkbox"
                onChange={e =>
                  handleSafeUpdate(r => ({
                    ...r,
                    executionMode: 'workflow',
                    processRecord: {
                      ...(r.processRecord ?? proc!),
                      cuttingGrainlineVerified: e.target.checked
                    }
                  }))
                }
                className="mt-0.5 accent-neutral-900"
              />
              <span>
                <strong className="uppercase text-[10px] block text-neutral-900">
                  Cutting Grainline Verified
                </strong>
                <span className="text-[10px] text-neutral-500">
                  Explicit operator confirmation before cutting (never auto-set by stitch entry).
                </span>
              </span>
            </label>
            <div className="border-t border-neutral-100 pt-1 text-[10px] font-mono space-y-0.5 text-neutral-600">
              <div>M05 Doc: <strong className="text-neutral-900">{trace?.constructionDocRef}</strong></div>
              <div>M06 Sim: <strong className="text-neutral-900">{trace?.simulationCaseRef}</strong></div>
              <div>Body Set: <strong className="text-neutral-900">{trace?.bodyMeasurementSetRef}</strong></div>
            </div>
          </div>
        </div>

        {evaluation.traceabilityMismatches.length > 0 && (
          <div
            className="border border-red-300 bg-red-50 text-red-900 rounded-xs p-2.5 text-xs font-mono space-y-1"
            data-testid="m06-ac09-traceability-mismatch-alert"
          >
            <div className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-700" />
              Traceability Mismatches Detected (Blocks PASS):
            </div>
            {evaluation.traceabilityMismatches.map((msg, i) => (
              <div key={i}>• {msg}</div>
            ))}
          </div>
        )}
      </div>

      {/* Main Split: Repeat POM Table + Simulation-vs-Physical Comparison & Evidence */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: POM Measurements with Repeat Readings */}
        <div
          className="lg:col-span-7 border border-neutral-200 rounded-xs overflow-x-auto"
          data-testid="m06-ac09-pom-table"
        >
          <div className="bg-neutral-50 px-3 py-2 border-b border-neutral-200 text-[11px] font-mono font-bold text-neutral-900 uppercase flex items-center justify-between">
            <span>2. Physical POM Capture (cm) — Repeat Readings &amp; ±0.50 cm Gauge</span>
            <span className="text-neutral-500 font-normal">{record.sizeCode} • {record.fabricName}</span>
          </div>
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-neutral-200 text-[10px] text-neutral-500">
                <th className="p-2">Anatomical Checkpoint</th>
                <th className="p-2">CAD (cm)</th>
                <th className="p-2">Read #1</th>
                <th className="p-2">Read #2</th>
                <th className="p-2">Mean ± Unc</th>
                <th className="p-2">Delta / Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {record.pomCheckpoints.map(pt => {
                const r1 = pt.repeatReadingsCm?.[0] ?? pt.measuredToileCm ?? '';
                const r2 = pt.repeatReadingsCm?.[1] ?? '';
                const updateReadings = (nextR1: string, nextR2: string) => {
                  const vals: number[] = [];
                  if (nextR1.trim() !== '' && Number.isFinite(Number(nextR1)) && Number(nextR1) > 0) {
                    vals.push(Number(nextR1));
                  }
                  if (nextR2.trim() !== '' && Number.isFinite(Number(nextR2)) && Number(nextR2) > 0) {
                    vals.push(Number(nextR2));
                  }
                  handleSafeUpdate(r =>
                    recordAc09RepeatMeasurements(r, pt.pointId, vals, { promoteWorkflow: r.executionMode === 'workflow' })
                  );
                };
                return (
                  <tr key={pt.pointId}>
                    <td className="p-2 font-sans text-neutral-800">
                      <div className="font-medium">{pt.label}</div>
                      {pt.checkpointDefinition && (
                        <div className="text-[10px] text-neutral-500 leading-tight mt-0.5">
                          {pt.checkpointDefinition}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-neutral-700">{pt.nominalCadCm.toFixed(2)}</td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        disabled={isLocked}
                        aria-label={`Reading 1 physical cm for ${pt.label}`}
                        value={r1}
                        onChange={e => updateReadings(e.target.value, String(r2))}
                        placeholder="Pending"
                        className="w-20 px-1.5 py-0.5 border border-neutral-300 rounded-xs text-xs font-mono bg-white disabled:bg-neutral-50"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        disabled={isLocked}
                        aria-label={`Reading 2 physical cm for ${pt.label}`}
                        value={r2}
                        onChange={e => updateReadings(String(r1), e.target.value)}
                        placeholder="Opt #2"
                        className="w-20 px-1.5 py-0.5 border border-neutral-300 rounded-xs text-xs font-mono bg-white disabled:bg-neutral-50"
                      />
                    </td>
                    <td className="p-2 text-[11px]">
                      {pt.measuredToileCm !== null ? (
                        <div>
                          <strong>{pt.measuredToileCm.toFixed(2)} cm</strong>
                          <span className="block text-[10px] text-neutral-500">
                            ±{(pt.combinedUncertaintyCm ?? 0.05).toFixed(3)} cm
                          </span>
                        </div>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="p-2">
                      {pt.deltaCm === null ? (
                        <span className="text-neutral-400">PENDING</span>
                      ) : (
                        <span className={pt.withinTolerance ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>
                          {pt.deltaCm > 0 ? '+' : ''}
                          {pt.deltaCm.toFixed(3)} cm
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right: Simulation-vs-Physical Comparison & Regional Discrepancy Chart */}
        <div className="lg:col-span-5 space-y-3">
          <div
            className="border border-neutral-200 rounded-xs p-3 space-y-2.5"
            data-testid="m06-ac09-regional-section"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-neutral-900 uppercase">
                3. Simulation Forecast vs. Physical Observation
              </span>
              <span className="text-[11px] font-mono text-neutral-700">
                {evaluation.regionalAgreementPct !== null ? `${evaluation.regionalAgreementPct.toFixed(1)}%` : '—'} / 85% min
              </span>
            </div>
            {/* Regional Agreement Threshold Bar */}
            <div className="relative h-2 bg-neutral-100 border border-neutral-200 rounded-xs overflow-hidden">
              <div
                className={`h-full transition-all ${
                  (evaluation.regionalAgreementPct ?? 0) >= 85 ? 'bg-emerald-600' : 'bg-amber-600'
                }`}
                style={{ width: `${evaluation.regionalAgreementPct ?? 0}%` }}
              />
              <div
                title="Authoritative 85% minimum agreement threshold"
                className="absolute top-0 bottom-0 w-0.5 bg-neutral-900"
                style={{ left: '85%' }}
              />
            </div>

            <div className="space-y-2">
              {record.regionalAgreementChecks.map(rz => (
                <div
                  key={rz.zoneId}
                  className="border border-neutral-100 bg-neutral-50/50 rounded-xs p-2 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <strong className="text-neutral-900">{rz.zoneLabel}</strong>
                      <span className="text-[10px] font-mono text-neutral-500 block">
                        Digital Prediction: {rz.digitalPredictionStatus}
                        {rz.digitalEaseDeltaCm !== undefined ? ` • ease Δ ${rz.digitalEaseDeltaCm.toFixed(2)} cm` : ''}
                        {rz.digitalMaxStrainPct !== undefined ? ` • strain ${rz.digitalMaxStrainPct.toFixed(1)}%` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 font-mono text-[10px]">
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() =>
                          handleSafeUpdate(r => ({
                            ...r,
                            regionalAgreementChecks: r.regionalAgreementChecks.map(item =>
                              item.zoneId === rz.zoneId
                                ? {
                                    ...item,
                                    agreesWithDigitalPrediction: true,
                                    physicalObservationSummary:
                                      item.physicalObservationSummary || 'Matches physical toile fit behavior'
                                  }
                                : item
                            )
                          }))
                        }
                        className={`px-2 py-0.5 border rounded-xs cursor-pointer ${
                          rz.agreesWithDigitalPrediction === true
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white text-neutral-700 border-neutral-300'
                        }`}
                      >
                        Agree
                      </button>
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() =>
                          handleSafeUpdate(r => ({
                            ...r,
                            regionalAgreementChecks: r.regionalAgreementChecks.map(item =>
                              item.zoneId === rz.zoneId
                                ? {
                                    ...item,
                                    agreesWithDigitalPrediction: false,
                                    physicalObservationSummary:
                                      item.physicalObservationSummary || 'Diverges from digital diagnostic'
                                  }
                                : item
                            )
                          }))
                        }
                        className={`px-2 py-0.5 border rounded-xs cursor-pointer ${
                          rz.agreesWithDigitalPrediction === false
                            ? 'bg-red-700 text-white border-red-700'
                            : 'bg-white text-neutral-700 border-neutral-300'
                        }`}
                      >
                        Diverge
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    disabled={isLocked}
                    value={rz.physicalObservationSummary ?? ''}
                    onChange={e =>
                      handleSafeUpdate(r => ({
                        ...r,
                        regionalAgreementChecks: r.regionalAgreementChecks.map(item =>
                          item.zoneId === rz.zoneId ? { ...item, physicalObservationSummary: e.target.value } : item
                        )
                      }))
                    }
                    placeholder="Physical fit observation note (separate from simulation)..."
                    className="w-full px-1.5 py-0.5 text-[11px] bg-white border border-neutral-200 rounded-xs focus:outline-none focus:border-neutral-900"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Physical Evidence Attachments & Hem/Grainline/Seam Inspection */}
          <div className="border border-neutral-200 rounded-xs p-3 space-y-2 text-xs">
            <div className="text-[11px] font-mono font-bold text-neutral-900 uppercase">
              4. Physical Evidence Attachments &amp; Structural Checks ({evaluation.evidenceCompletedCount}/{evaluation.requiredEvidenceCount})
            </div>
            <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 pb-2 font-mono text-[11px]">
              <label className="flex items-center gap-1.5 text-neutral-800 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={record.grainlineVerified}
                  onChange={e => handleSafeUpdate(r => ({ ...r, grainlineVerified: e.target.checked }))}
                />
                Grainline Plumb Verified
              </label>
              <label className="flex items-center gap-1.5 text-neutral-800 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={record.seamAlignmentVerified === true}
                  onChange={e =>
                    handleSafeUpdate(r => ({ ...r, seamAlignmentVerified: e.target.checked ? true : null }))
                  }
                />
                Seams Aligned
              </label>
              <label className="flex items-center gap-1 text-neutral-700">
                <span>Hem Δ (cm):</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  disabled={isLocked}
                  value={record.hemLevelPhysicalDeviationCm ?? ''}
                  onChange={e => {
                    const val = e.target.value.trim() === '' ? null : Number(e.target.value);
                    handleSafeUpdate(r => ({ ...r, hemLevelPhysicalDeviationCm: val }));
                  }}
                  placeholder="≤0.8"
                  className="w-14 px-1 py-0.5 border border-neutral-300 rounded-xs bg-white"
                />
              </label>
            </div>
            <div className="space-y-2">
              {record.evidenceChecklist.map(ev => (
                <div key={ev.itemId} className="space-y-1">
                  <label className="flex items-start gap-2 text-[11px] text-neutral-700 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={isLocked}
                      checked={ev.recorded}
                      onChange={e =>
                        handleSafeUpdate(r => ({
                          ...r,
                          evidenceChecklist: r.evidenceChecklist.map(item =>
                            item.itemId === ev.itemId
                              ? {
                                  ...item,
                                  recorded: e.target.checked,
                                  capturedAt: e.target.checked ? item.capturedAt ?? todayStr : undefined
                                }
                              : item
                          )
                        }))
                      }
                      className="mt-0.5"
                    />
                    <span>{ev.label}</span>
                  </label>
                  <input
                    type="text"
                    disabled={isLocked}
                    value={ev.attachmentUri ?? ''}
                    onChange={e =>
                      handleSafeUpdate(r => ({
                        ...r,
                        evidenceChecklist: r.evidenceChecklist.map(item =>
                          item.itemId === ev.itemId ? { ...item, attachmentUri: e.target.value } : item
                        )
                      }))
                    }
                    placeholder={`Attachment URI for ${ev.itemId} (e.g., photo://atelier/${ev.itemId}.jpg)`}
                    className="w-full px-2 py-0.5 text-[10px] font-mono bg-neutral-50 border border-neutral-200 rounded-xs focus:outline-none focus:border-neutral-900"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Reviewer Decision & Sign-Off + Immutable Revision Forking */}
      <div
        className="border border-neutral-200 rounded-xs p-3 bg-neutral-50/70 space-y-3"
        data-testid="m06-ac09-signoff-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-mono font-bold text-neutral-900 uppercase flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            5. Authorized Human Reviewer Sign-Off &amp; Revision Lock
          </div>
          {record.reviewerDecision?.signatureDigest && (
            <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-xs">
              SIGNED: {record.reviewerDecision.signatureDigest.slice(0, 16)}…
            </span>
          )}
        </div>

        {!isLocked ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 text-xs">
            <input
              type="text"
              value={reviewerName}
              onChange={e => setReviewerName(e.target.value)}
              data-testid="m06-ac09-reviewer-name-input"
              placeholder="Authorized Reviewer Full Name"
              className="md:col-span-3 px-2 py-1.5 bg-white border border-neutral-300 rounded-xs text-xs"
            />
            <select
              value={reviewerRole}
              onChange={e => setReviewerRole(e.target.value as Ac09AuthorizedReviewerRole)}
              data-testid="m06-ac09-reviewer-role-select"
              className="md:col-span-3 px-2 py-1.5 bg-white border border-neutral-300 rounded-xs font-mono text-xs"
            >
              {AUTHORIZED_AC09_REVIEWER_ROLES.map(role => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={reviewerRationale}
              onChange={e => setReviewerRationale(e.target.value)}
              data-testid="m06-ac09-reviewer-rationale-input"
              placeholder="Audit sign-off rationale..."
              className="md:col-span-3 px-2 py-1.5 bg-white border border-neutral-300 rounded-xs text-xs"
            />
            <div className="md:col-span-3 flex gap-1.5">
              <Button
                variant="primary"
                size="sm"
                data-testid="m06-ac09-signoff-pass-btn"
                onClick={() =>
                  handleSafeUpdate(r =>
                    recordAc09ReviewerDecision(r, {
                      reviewerName,
                      reviewerRole,
                      decision: 'APPROVED_PASS',
                      rationale: reviewerRationale
                    })
                  )
                }
                icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              >
                Approve PASS
              </Button>
              <Button
                variant="outline"
                size="sm"
                data-testid="m06-ac09-signoff-fail-btn"
                onClick={() =>
                  handleSafeUpdate(r =>
                    recordAc09ReviewerDecision(r, {
                      reviewerName,
                      reviewerRole,
                      decision: 'REJECTED_FAIL',
                      rationale: reviewerRationale
                    })
                  )
                }
              >
                Reject FAIL
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-neutral-200 p-2.5 rounded-xs text-xs">
            <div className="font-mono">
              Decision: <strong>{record.reviewerDecision?.decision}</strong> by{' '}
              <strong>{record.reviewerDecision?.reviewerName}</strong> ({record.reviewerDecision?.reviewerRole}) on{' '}
              {record.reviewerDecision?.decidedAt}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={revisionReason}
                onChange={e => setRevisionReason(e.target.value)}
                placeholder="Reason for new sample rev..."
                className="px-2 py-1 border border-neutral-300 rounded-xs text-xs w-48"
              />
              <Button
                variant="outline"
                size="sm"
                data-testid="m06-ac09-new-revision-btn"
                icon={<GitBranch className="w-3.5 h-3.5" />}
                onClick={() =>
                  handleSafeUpdate(r => createNewAc09SampleRevision(r, revisionReason || 'Post-review sample re-cut'))
                }
              >
                + New Revision
              </Button>
            </div>
          </div>
        )}

        {/* Evaluation Summary & Missing Diagnostics */}
        <div className="bg-white border border-neutral-200 rounded-xs p-2.5 text-xs font-mono text-neutral-800 space-y-1">
          <div>{evaluation.summary}</div>
          {evaluation.missingEvidenceDiagnostics.length > 0 && evaluation.status !== 'PENDING' && (
            <div className="text-[11px] text-amber-800 pt-1 border-t border-neutral-100">
              Missing diagnostics ({evaluation.missingEvidenceDiagnostics.length}):{' '}
              {evaluation.missingEvidenceDiagnostics.slice(0, 3).join(' | ')}
              {evaluation.missingEvidenceDiagnostics.length > 3
                ? ` (+${evaluation.missingEvidenceDiagnostics.length - 3} more)`
                : ''}
            </div>
          )}
        </div>
      </div>

      {/* Deterministic Exportable Report Drawer */}
      {showExportReport && (
        <div
          className="border border-neutral-300 bg-neutral-50 rounded-xs p-3 space-y-2"
          data-testid="m06-ac09-export-drawer"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div>
              <span className="font-bold text-neutral-900">Canonical Report Digest (SHA-256): </span>
              <span className="text-neutral-700 break-all" data-testid="m06-ac09-canonical-digest">
                {serializedReport.canonicalDigest}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadJson}
              icon={<Download className="w-3.5 h-3.5" />}
            >
              Download .ac09.json
            </Button>
          </div>
          <pre
            className="max-h-64 overflow-auto bg-white border border-neutral-200 p-2.5 text-[11px] font-mono text-neutral-800 rounded-xs"
            data-testid="m06-ac09-export-json"
          >
            {canonicalJson}
          </pre>
        </div>
      )}
    </div>
  );
};
