/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCode2,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import {
  BodiceSleeveAssemblyResult,
  formatSignedCm,
  serializeDeterministicAssemblyReport
} from '../../engine/assembly';

export type AssemblyScenarioMode = 'active-draft' | 'incompatible-xs-flat';

interface AssemblyInspectionPanelProps {
  assemblyResult?: BodiceSleeveAssemblyResult;
  assemblyError?: string;
  scenario: AssemblyScenarioMode;
  onChangeScenario: (scenario: AssemblyScenarioMode) => void;
  requireApprovedGovernance: boolean;
  onToggleRequireApprovedGovernance: (next: boolean) => void;
  strictUncertaintyGate: boolean;
  onToggleStrictUncertaintyGate: (next: boolean) => void;
  onNavigateToMeasurements?: () => void;
}

export const AssemblyInspectionPanel: React.FC<AssemblyInspectionPanelProps> = ({
  assemblyResult,
  assemblyError,
  scenario,
  onChangeScenario,
  requireApprovedGovernance,
  onToggleRequireApprovedGovernance,
  strictUncertaintyGate,
  onToggleStrictUncertaintyGate,
  onNavigateToMeasurements
}) => {
  const [showCanonicalJson, setShowCanonicalJson] = useState(false);

  const canonicalSerialized = useMemo(() => {
    if (!assemblyResult) return null;
    try {
      return serializeDeterministicAssemblyReport(assemblyResult);
    } catch (err) {
      return {
        canonicalJson: `Serialization Error: ${err instanceof Error ? err.message : String(err)}`,
        byteLength: 0,
        sha256Hex: 'ERROR'
      };
    }
  }, [assemblyResult]);

  if (assemblyError && !assemblyResult) {
    return (
      <div
        role="alert"
        data-testid="assembly-error-alert"
        className="bg-rose-50 border border-rose-300 rounded-sm p-5 font-mono text-xs text-rose-950 space-y-2"
      >
        <div className="flex items-center gap-2 font-bold uppercase text-rose-900">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Assembly Engine Execution Failure</span>
        </div>
        <p>{assemblyError}</p>
      </div>
    );
  }

  if (!assemblyResult) {
    return (
      <div className="bg-white border border-neutral-200 rounded-sm p-5 font-mono text-xs text-neutral-600">
        No bodice–sleeve assembly result available for the current garment category.
      </div>
    );
  }

  const {
    status,
    ease,
    seamCompatibility,
    uncertaintyGate,
    endpoints,
    notches,
    contourIntegrity,
    governance,
    validationReport,
    inspectionLayout,
    executionMetadata,
    canonicalContentDigest,
    canonicalJsonByteLength
  } = assemblyResult;

  const statusBadgeVariant =
    status === 'verified-valid' ? 'success' : status === 'unassessed-missing-data' ? 'warning' : 'danger';

  return (
    <div className="space-y-5 font-mono text-xs" data-testid="assembly-inspection-panel">
      {/* Header & Execution Controls Card */}
      <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-2xs space-y-4">
        <div className="flex items-start justify-between border-b border-neutral-100 pb-3 gap-2">
          <div>
            <span className="text-[10px] uppercase text-blue-800 font-bold block">
              MODULE 04.3 ASSEMBLY INSPECTOR
            </span>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-900">
              Bodice–Sleeve Compatibility
            </h3>
            <span className="text-[10px] text-neutral-400 block mt-0.5">
              Engine v{executionMetadata.engineVersion} // {executionMetadata.runId}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={statusBadgeVariant} size="sm" data-testid="assembly-status-badge">
              {status.toUpperCase()}
            </Badge>
            <span
              data-testid="assembly-production-ready-flag"
              className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300"
            >
              isProductionReady: false
            </span>
          </div>
        </div>

        {/* Scenario Switcher */}
        <div className="space-y-1.5">
          <span className="text-[10px] uppercase font-bold text-neutral-500 block">
            Inspection Test Scenario
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="scenario-active-draft"
              onClick={() => onChangeScenario('active-draft')}
              className={`px-2.5 py-2 text-left rounded border transition-colors cursor-pointer ${
                scenario === 'active-draft'
                  ? 'bg-neutral-900 text-white border-neutral-900 font-semibold'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              <span className="block text-[11px]">Active Draft</span>
              <span className={`block text-[9px] ${scenario === 'active-draft' ? 'text-neutral-300' : 'text-neutral-500'}`}>
                Matched bodice &amp; sleeve
              </span>
            </button>
            <button
              type="button"
              data-testid="scenario-incompatible-xs-flat"
              onClick={() => onChangeScenario('incompatible-xs-flat')}
              className={`px-2.5 py-2 text-left rounded border transition-colors cursor-pointer ${
                scenario === 'incompatible-xs-flat'
                  ? 'bg-rose-900 text-white border-rose-900 font-semibold'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              <span className="block text-[11px]">Incompatible XS-Flat</span>
              <span className={`block text-[9px] ${scenario === 'incompatible-xs-flat' ? 'text-rose-200' : 'text-neutral-500'}`}>
                Fail-closed negative ease probe
              </span>
            </button>
          </div>
        </div>

        {/* Fail-Closed Policy Toggles */}
        <div className="p-2.5 bg-neutral-50 border border-neutral-200 rounded space-y-2 text-[11px]">
          <span className="text-[10px] uppercase font-bold text-neutral-500 block">
            Fail-Closed Gate Policies
          </span>
          <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
            <span className="text-neutral-800">Enforce Production Governance Gate</span>
            <input
              type="checkbox"
              data-testid="toggle-require-governance"
              checked={requireApprovedGovernance}
              onChange={e => onToggleRequireApprovedGovernance(e.target.checked)}
              className="accent-neutral-900"
            />
          </label>
          <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
            <span className="text-neutral-800">Strict Uncertainty Gate (±0.05 cm)</span>
            <input
              type="checkbox"
              data-testid="toggle-strict-uncertainty"
              checked={strictUncertaintyGate}
              onChange={e => onToggleStrictUncertaintyGate(e.target.checked)}
              className="accent-neutral-900"
            />
          </label>
        </div>

        {assemblyError && (
          <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-900 text-[11px]">
            <strong>Runtime Notice:</strong> {assemblyError}
          </div>
        )}
      </div>

      {/* Independent Front / Back / Total Seam Compatibility Breakdown */}
      <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
          <div>
            <span className="text-[10px] uppercase text-neutral-400 block">INDEPENDENT SEAM BREAKDOWN</span>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
              Front, Back &amp; Total Ease
            </h4>
          </div>
          <Badge variant={seamCompatibility.front.isNonNegative && seamCompatibility.back.isNonNegative && ease.isTotalEasePermitted ? 'success' : 'danger'} size="sm">
            {seamCompatibility.front.isNonNegative && seamCompatibility.back.isNonNegative && ease.isTotalEasePermitted ? 'BOUNDARIES OK' : 'BOUNDARY FAIL'}
          </Badge>
        </div>

        <div className="space-y-2">
          {[seamCompatibility.front, seamCompatibility.back, seamCompatibility.total].map(item => {
            const label =
              item.side === 'front' ? 'Front Scye / Cap' : item.side === 'back' ? 'Back Scye / Cap' : 'Total Perimeter';
            const sidePass =
              item.side === 'total'
                ? item.isNonNegative && ease.isTotalEasePermitted && item.isConfidenceIntervalSafe
                : item.isNonNegative && item.isConfidenceIntervalSafe;
            return (
              <div
                key={item.side}
                data-testid={`seam-compat-${item.side}`}
                className={`p-2.5 rounded border ${
                  sidePass ? 'bg-neutral-50 border-neutral-200' : 'bg-rose-50/70 border-rose-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-900 uppercase text-[11px]">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${sidePass ? 'text-emerald-800' : 'text-rose-800'}`}>
                      {formatSignedCm(item.easeCm)}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1 py-0.2 rounded uppercase ${
                        sidePass ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-200 text-rose-900'
                      }`}
                    >
                      {sidePass ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                </div>
                <div className="text-[10px] text-neutral-600 mt-1 flex justify-between">
                  <span>Armhole: {item.armholeLengthCm.toFixed(2)} cm | Cap: {item.sleeveCapLengthCm.toFixed(2)} cm</span>
                  <span>±{item.uncertaintyCm.toFixed(4)} cm</span>
                </div>
                <div className="text-[10px] text-neutral-500 mt-0.5 flex justify-between">
                  <span>99% Bound: [{formatSignedCm(item.lowerConfidenceCm, 3)}, {formatSignedCm(item.upperConfidenceCm, 3)}]</span>
                  <span>Target: {formatSignedCm(item.targetEaseCm)}</span>
                </div>
                {item.blockingReasons.length > 0 && !sidePass && (
                  <p className="text-[10px] text-rose-800 font-semibold mt-1">
                    {item.blockingReasons.join(' ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Distribution & Uncertainty Gate Summary */}
        <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded space-y-1 text-[10px]">
          <div className="flex justify-between">
            <span className="text-neutral-600">Front Ease Ratio (35%–55%):</span>
            <span className={`font-bold ${ease.isDistributionBalanced ? 'text-emerald-800' : 'text-rose-800'}`}>
              {ease.isRatioDefined && ease.frontEaseRatio !== null
                ? `${(ease.frontEaseRatio * 100).toFixed(1)}% ±${((ease.frontEaseRatioUncertainty ?? 0) * 100).toFixed(2)}%`
                : 'N/A (ratio undefined)'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-600">Uncertainty Gate (≤ ±{uncertaintyGate.maxAllowedSingleSeamUncertaintyCm.toFixed(2)} cm):</span>
            <span className={`font-bold ${uncertaintyGate.passed ? 'text-emerald-800' : 'text-rose-800'}`}>
              {uncertaintyGate.passed ? 'PASS' : 'FAIL'} (Max ±{uncertaintyGate.maxObservedSingleSeamUncertaintyCm.toFixed(4)} cm)
            </span>
          </div>
        </div>
      </div>

      {/* Notch, Elbow & Contour Telemetry */}
      <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
          <div>
            <span className="text-[10px] uppercase text-neutral-400 block">NOTCH &amp; CONTOUR TOPOLOGY</span>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
              Registration &amp; Winding
            </h4>
          </div>
          <Badge variant={notches.isValid && endpoints.isEndpointTopologyValid && contourIntegrity.isValid ? 'success' : 'danger'} size="sm">
            {notches.isValid && endpoints.isEndpointTopologyValid && contourIntegrity.isValid ? 'SYNCED' : 'DEFECT'}
          </Badge>
        </div>

        <div className="space-y-1.5 text-[10px] text-neutral-700">
          <div className="flex justify-between p-1.5 bg-neutral-50 rounded border border-neutral-200">
            <span>Front Scye Notch Delta:</span>
            <span className="font-bold text-neutral-900">
              {notches.frontNotch ? `${notches.frontNotch.deltaCm.toFixed(3)} cm (disp ${notches.frontNotch.bodiceDisplacementCm.toFixed(2)}/${notches.frontNotch.sleeveDisplacementCm.toFixed(2)})` : 'MISSING'}
            </span>
          </div>
          <div className="flex justify-between p-1.5 bg-neutral-50 rounded border border-neutral-200">
            <span>Back Double-Notch Pre-Sort Order:</span>
            <span className={`font-bold ${notches.backNotches?.isOrderingValid ? 'text-emerald-800' : 'text-rose-800'}`}>
              {notches.backNotches
                ? `${notches.backNotches.isOrderingValid ? 'VALID' : 'REVERSED'} (Δ1=${notches.backNotches.deltaNotch1Cm.toFixed(2)}, Δ2=${notches.backNotches.deltaNotch2Cm.toFixed(2)})`
                : 'MISSING'}
            </span>
          </div>
          <div className="flex justify-between p-1.5 bg-neutral-50 rounded border border-neutral-200">
            <span>Elbow Pair Parity (≤ 0.15 cm):</span>
            <span className={`font-bold ${notches.elbowPairParity?.isParityValid !== false ? 'text-emerald-800' : 'text-rose-800'}`}>
              {notches.elbowPairParity
                ? `${notches.elbowPairParity.parityDeltaCm.toFixed(3)} cm (F:${notches.elbowFrontNotch?.displacementFromContourCm.toFixed(3)} / B:${notches.elbowBackNotch?.displacementFromContourCm.toFixed(3)})`
                : 'N/A'}
            </span>
          </div>
          <div className="flex justify-between p-1.5 bg-neutral-50 rounded border border-neutral-200">
            <span>Crown C1 Tangency / Handedness:</span>
            <span className="font-bold text-neutral-900">
              {endpoints.crownShoulderMatch.tangentDepartureDeg !== undefined
                ? `${endpoints.crownShoulderMatch.tangentDepartureDeg.toFixed(2)}°`
                : 'N/A'}{' '}
              // {endpoints.sleeveHandedness?.isValid ? 'RH OK' : 'INVERTED'}
            </span>
          </div>
          <div className="flex justify-between p-1.5 bg-neutral-50 rounded border border-neutral-200">
            <span>Contour Windings (F/B/SLV):</span>
            <span className={`font-bold ${contourIntegrity.isValid ? 'text-emerald-800' : 'text-rose-800'}`}>
              {contourIntegrity.windings.frontBodice} / {contourIntegrity.windings.backBodice} / {contourIntegrity.windings.sleeve}
            </span>
          </div>
          {inspectionLayout?.rigidVerification && (
            <div className="flex justify-between p-1.5 bg-neutral-50 rounded border border-neutral-200">
              <span>Rigid Scye Alignment Drift:</span>
              <span className="font-bold text-neutral-900">
                F:{inspectionLayout.rigidVerification.frontJunctionDeltaCm.toFixed(6)} / B:{inspectionLayout.rigidVerification.backJunctionDeltaCm.toFixed(6)} cm
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Governance & Measurement Provenance */}
      <div
        data-testid="assembly-governance-card"
        className={`border rounded-sm p-4 space-y-2.5 ${
          governance.isGovernanceApproved
            ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
            : 'bg-amber-50/80 border-amber-300 text-amber-950'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="font-bold uppercase text-[11px] flex items-center gap-1.5">
            {governance.isGovernanceApproved ? (
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-amber-700" />
            )}
            Governance &amp; Provenance
          </span>
          <Badge variant={governance.isGovernanceApproved ? 'success' : 'warning'} size="sm">
            {governance.isGovernanceApproved ? 'APPROVED INPUTS' : 'UNAPPROVED'}
          </Badge>
        </div>

        <div className="text-[10px] space-y-1">
          <div className="flex justify-between">
            <span>Measurement Origin:</span>
            <span className="font-bold">{governance.measurementProvenance}</span>
          </div>
          <div className="flex justify-between">
            <span>Measurement Approval:</span>
            <span className="font-bold">{governance.measurementApprovalState}</span>
          </div>
          <div className="flex justify-between">
            <span>Design Specification:</span>
            <span className="font-bold">{governance.designSpecApproved ? 'approved' : 'unapproved'}</span>
          </div>
        </div>

        {!governance.isGovernanceApproved && (
          <div className="text-[10px] space-y-1.5 pt-1 border-t border-amber-200">
            <ul className="list-disc list-inside space-y-0.5 text-amber-900">
              {governance.blockingReasons.map((r, idx) => (
                <li key={idx}>{r}</li>
              ))}
            </ul>
            {onNavigateToMeasurements && (
              <button
                type="button"
                onClick={onNavigateToMeasurements}
                className="underline font-bold text-amber-950 hover:text-neutral-900 cursor-pointer"
              >
                Open Module 03 to Record &amp; Approve Measurements
              </button>
            )}
          </div>
        )}
      </div>

      {/* Canonical JSON & SHA-256 Digest Box */}
      <div className="bg-neutral-900 text-neutral-100 rounded-sm p-4 space-y-2.5 border border-neutral-800">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase text-neutral-400 flex items-center gap-1.5">
            <FileCode2 className="w-3.5 h-3.5 text-emerald-400" />
            Canonical Report Digest (SHA-256)
          </span>
          <span className="text-[10px] text-neutral-400">
            {canonicalJsonByteLength} UTF-8 bytes
          </span>
        </div>

        <code
          data-testid="assembly-canonical-digest"
          className="block w-full break-all bg-neutral-950 border border-neutral-800 rounded p-2 text-[11px] text-emerald-400 select-all"
        >
          {canonicalContentDigest}
        </code>

        <button
          type="button"
          aria-expanded={showCanonicalJson}
          data-testid="toggle-canonical-json"
          onClick={() => setShowCanonicalJson(prev => !prev)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px] text-neutral-200 cursor-pointer transition-colors"
        >
          <span>{showCanonicalJson ? 'Hide Canonical JSON Payload' : 'View Canonical JSON Payload'}</span>
          {showCanonicalJson ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showCanonicalJson && canonicalSerialized && (
          <pre
            data-testid="assembly-canonical-json"
            className="max-h-56 overflow-auto bg-neutral-950 border border-neutral-800 rounded p-2 text-[10px] text-neutral-300 whitespace-pre-wrap break-all"
          >
            {canonicalSerialized.canonicalJson}
          </pre>
        )}
      </div>

      {/* Assembly Validation Checklist */}
      <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
          <div>
            <span className="text-[10px] uppercase text-neutral-400 block">VALIDATION CHECKLIST</span>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
              {validationReport.passedCount} / {validationReport.checks.length} Passed
            </h4>
          </div>
          <Badge variant={validationReport.isValid ? 'success' : 'danger'} size="sm">
            {validationReport.statusLabel}
          </Badge>
        </div>

        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {validationReport.checks.map(chk => (
            <div
              key={chk.id}
              className={`p-2 rounded border text-[11px] ${
                chk.status === 'pass'
                  ? 'bg-emerald-50/50 border-emerald-200 text-emerald-950'
                  : chk.status === 'warning'
                  ? 'bg-amber-50/60 border-amber-200 text-amber-950'
                  : 'bg-rose-50/70 border-rose-200 text-rose-950'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5">
                  {chk.status === 'pass' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${chk.status === 'fail' ? 'text-rose-600' : 'text-amber-600'}`} />
                  )}
                  {chk.name}
                </span>
                <span className="text-[9px] uppercase font-bold">{chk.status}</span>
              </div>
              {chk.measuredValue && (
                <div className="text-[10px] text-neutral-700 mt-0.5">{chk.measuredValue}</div>
              )}
              <p className="text-[10px] text-neutral-600 mt-0.5">{chk.message}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
