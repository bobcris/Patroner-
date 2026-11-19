/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  FileCode2,
  Package,
  Scissors,
  Layers,
  ShieldAlert,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  M05ProductionPackageBundle,
  serializeDeterministicProductionBundle
} from '../../engine/production';

export interface ProductionBomControlState {
  fabricRollWidthCm: number;
  markerWasteFactor: number;
  orderQuantityPerSize: number;
  includeLining: boolean;
  includeLabelsAndPackaging: boolean;
}

interface ProductionPackagePanelProps {
  bundle: M05ProductionPackageBundle;
  bomControls: ProductionBomControlState;
  onChangeBomControls: (next: ProductionBomControlState) => void;
  titleContext?: string;
}

type PackageSubTab = 'validation' | 'bom' | 'docs' | 'dxf-digest';

export const ProductionPackagePanel: React.FC<ProductionPackagePanelProps> = ({
  bundle,
  bomControls,
  onChangeBomControls,
  titleContext = 'Deterministic Production Engineering (M05)'
}) => {
  const [subTab, setSubTab] = useState<PackageSubTab>('validation');
  const [showCanonicalJson, setShowCanonicalJson] = useState(false);

  const canonicalJsonText = React.useMemo(() => {
    if (!showCanonicalJson) return '';
    return serializeDeterministicProductionBundle(bundle);
  }, [bundle, showCanonicalJson]);

  const handleDownloadDxf = () => {
    if (!bundle.dxfExport) return;
    const blob = new Blob([bundle.dxfExport.artifact.dxfText], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bundle.dxfExport.artifact.exportId}.dxf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPackageJson = () => {
    const json = serializeDeterministicProductionBundle(bundle);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bundle.packageId}-${bundle.activeSize}.canonical.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-sm shadow-2xs overflow-hidden" data-testid="m05-production-panel">
      {/* Header Strip */}
      <div className="bg-neutral-900 text-white p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <Badge variant="dark" size="sm" className="bg-neutral-800 border border-neutral-700 text-neutral-100">
              {titleContext}
            </Badge>
            <span className="text-neutral-400">PKG: {bundle.packageId}</span>
            <span className="text-neutral-600">•</span>
            <span className="text-neutral-300">REV: {bundle.packageRevisionId}</span>
          </div>
          <h3 className="text-base font-serif font-bold tracking-tight text-white">
            {bundle.garmentName} — Production Package ({bundle.includedSizes.join(', ')})
          </h3>
          <p className="text-xs text-neutral-400 font-mono">
            Schema {bundle.schemaVersion} | Pieces: {bundle.manufacturingDocs.cuttingInstructions.length} | Physical Panels/Garment:{' '}
            {bundle.manufacturingDocs.operatorSummary.totalPhysicalPanelsPerGarment} | Sheets:{' '}
            {bundle.sheetSet?.totalSheetsCount ?? 0}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <Badge
            variant={bundle.validation.isValid ? 'success' : 'danger'}
            size="md"
            data-testid="m05-validation-badge"
          >
            {bundle.validation.isValid
              ? `2D PACKAGE VERIFIED (${bundle.validation.passedCount}/10)`
              : `BLOCKED (${bundle.validation.failedCount} FAIL)`}
          </Badge>
          <Badge variant="warning" size="md">
            isProductionReady: false
          </Badge>
        </div>
      </div>

      {/* Upstream Lineage & Provenance Bar */}
      <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
        <div className="flex flex-wrap items-center gap-3 text-neutral-700">
          <span>
            MEASUREMENT ORIGIN: <strong className="text-neutral-900">{bundle.provenanceSummary.measurementProvenance}</strong>
          </span>
          <span className="text-neutral-300">|</span>
          <span>
            APPROVAL: <strong className={bundle.provenanceSummary.measurementApprovalState === 'approved' ? 'text-emerald-700' : 'text-amber-700'}>
              {bundle.provenanceSummary.measurementApprovalState.toUpperCase()}
            </strong>
          </span>
          <span className="text-neutral-300">|</span>
          <span>
            SPEC FP: <strong className={bundle.validation.diagnostics.find(d => d.checkId === 'unresolved-measurement-approvals')?.status === 'pass' ? 'text-emerald-700' : 'text-amber-700'}>
              {bundle.upstreamRevisionTracking.sourceSpecificationFingerprint.slice(0, 12)}…
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-neutral-500">DIGEST:</span>
          <code
            className="bg-neutral-200/70 text-neutral-900 px-1.5 py-0.5 rounded font-bold"
            data-testid="m05-canonical-digest"
          >
            {bundle.canonicalContentDigest}
          </code>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="px-4 pt-2.5 border-b border-neutral-200 bg-white flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="M05 Production Package Sections">
          {[
            { id: 'validation' as const, label: 'Validation (10)', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
            { id: 'bom' as const, label: `Bill of Materials (${bundle.bom.lineItems.length})`, icon: <Package className="w-3.5 h-3.5" /> },
            { id: 'docs' as const, label: `Mfg Docs & Pieces (${bundle.manufacturingDocs.cuttingInstructions.length})`, icon: <Scissors className="w-3.5 h-3.5" /> },
            { id: 'dxf-digest' as const, label: 'DXF-AAMA & SHA-256', icon: <FileCode2 className="w-3.5 h-3.5" /> }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={subTab === tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`px-2.5 py-2 text-[11px] font-mono font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                subTab === tab.id
                  ? 'border-neutral-900 text-neutral-900 font-bold bg-neutral-50/60'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-300'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="pb-2 flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadPackageJson}
            icon={<Download className="w-3.5 h-3.5" />}
          >
            Canonical JSON
          </Button>
          {bundle.dxfExport && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleDownloadDxf}
              icon={<Download className="w-3.5 h-3.5" />}
            >
              Export DXF-AAMA
            </Button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-4 space-y-5">
        {subTab === 'validation' && (
          <div className="space-y-5">
            {/* 10 Deterministic Validation Gates */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-800">
                  10-Gate Deterministic Readiness Diagnostics
                </h4>
                <span className="text-[11px] font-mono text-neutral-500">
                  Pass: {bundle.validation.passedCount} | Warning: {bundle.validation.warningCount} | Blocking Fail: {bundle.validation.failedCount}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {bundle.validation.diagnostics.map(diag => (
                  <div
                    key={diag.checkId}
                    data-testid={`m05-gate-${diag.checkId}`}
                    className={`p-3 rounded-xs border text-xs flex items-start gap-2.5 ${
                      diag.status === 'pass'
                        ? 'bg-emerald-50/40 border-emerald-200 text-emerald-950'
                        : diag.status === 'warning'
                          ? 'bg-amber-50/70 border-amber-300 text-amber-950'
                          : 'bg-red-50/70 border-red-300 text-red-950'
                    }`}
                  >
                    {diag.status === 'pass' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : diag.status === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 font-mono">
                        <span className="font-bold truncate">{diag.title}</span>
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/80 border border-current/20">
                          {diag.status} ({diag.severity})
                        </span>
                      </div>
                      <p className="text-[11px] opacity-90 mt-1">{diag.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Multi-Size Status Matrix */}
            <div>
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-800 mb-2">
                Size Run Coverage &amp; Reconciliation Matrix ({bundle.perSizeSummaries.length} Size{bundle.perSizeSummaries.length === 1 ? '' : 's'})
              </h4>
              <div className="overflow-x-auto border border-neutral-200 rounded-xs">
                <table className="w-full text-left border-collapse font-mono text-xs">
                  <thead>
                    <tr className="bg-neutral-100 border-b border-neutral-200 text-[10px] uppercase text-neutral-600">
                      <th className="py-2 px-3">Size</th>
                      <th className="py-2 px-3">Validity</th>
                      <th className="py-2 px-3 text-right">Pieces</th>
                      <th className="py-2 px-3 text-right">Prod Sheets</th>
                      <th className="py-2 px-3 text-right">Physical Panels</th>
                      <th className="py-2 px-3 text-right">Cutting Area</th>
                      <th className="py-2 px-3">Assembly</th>
                      <th className="py-2 px-3">Notch Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {bundle.perSizeSummaries.map(row => (
                      <tr key={row.sizeCode} className="hover:bg-neutral-50">
                        <td className="py-2 px-3 font-bold text-neutral-900">
                          {row.sizeCode} {row.sizeCode === bundle.baseSize && <span className="text-[10px] text-neutral-500 font-normal">(Base)</span>}
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={row.isSizeValid ? 'success' : 'danger'} size="sm">
                            {row.isSizeValid ? 'VALID' : 'INVALID'}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-right">{row.pieceCount}</td>
                        <td className="py-2 px-3 text-right">{row.sheetCount}</td>
                        <td className="py-2 px-3 text-right">{row.physicalPanelCount ?? 'N/A'}</td>
                        <td className="py-2 px-3 text-right">{row.cuttingAreaCm2.toFixed(1)} cm²</td>
                        <td className="py-2 px-3 text-[11px]">{row.assemblyStatus}</td>
                        <td className="py-2 px-3">
                          <span className={row.preSortNotchOrderValid ? 'text-emerald-700' : 'text-red-700'}>
                            {row.preSortNotchOrderValid ? 'VERIFIED' : 'INVALID'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {subTab === 'bom' && (
          <div className="space-y-4">
            {/* Interactive BOM Calculator Controls */}
            <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs font-mono items-end">
              <div>
                <label htmlFor="bom-roll-width" className="block text-[10px] text-neutral-500 uppercase font-bold mb-1">
                  Bolt Width (cm)
                </label>
                <input
                  id="bom-roll-width"
                  type="number"
                  min={60}
                  max={220}
                  step={2}
                  value={bomControls.fabricRollWidthCm}
                  onChange={e =>
                    onChangeBomControls({
                      ...bomControls,
                      fabricRollWidthCm: Math.max(60, Number(e.target.value) || 140)
                    })
                  }
                  className="w-full px-2.5 py-1.5 bg-white border border-neutral-300 rounded-xs text-neutral-900"
                />
              </div>

              <div>
                <label htmlFor="bom-waste-pct" className="block text-[10px] text-neutral-500 uppercase font-bold mb-1">
                  Marker Waste Buffer (%)
                </label>
                <input
                  id="bom-waste-pct"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={Math.round(bomControls.markerWasteFactor * 100)}
                  onChange={e =>
                    onChangeBomControls({
                      ...bomControls,
                      markerWasteFactor: Math.min(0.5, Math.max(0, (Number(e.target.value) || 0) / 100))
                    })
                  }
                  className="w-full px-2.5 py-1.5 bg-white border border-neutral-300 rounded-xs text-neutral-900"
                />
              </div>

              <div>
                <label htmlFor="bom-order-qty" className="block text-[10px] text-neutral-500 uppercase font-bold mb-1">
                  Units / Size
                </label>
                <input
                  id="bom-order-qty"
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={bomControls.orderQuantityPerSize}
                  onChange={e =>
                    onChangeBomControls({
                      ...bomControls,
                      orderQuantityPerSize: Math.max(1, Math.floor(Number(e.target.value) || 1))
                    })
                  }
                  className="w-full px-2.5 py-1.5 bg-white border border-neutral-300 rounded-xs text-neutral-900"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer py-1.5">
                <input
                  type="checkbox"
                  checked={bomControls.includeLining}
                  onChange={e => onChangeBomControls({ ...bomControls, includeLining: e.target.checked })}
                  className="accent-neutral-900"
                />
                <span className="text-[11px] text-neutral-800">Coordinated Lining</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer py-1.5">
                <input
                  type="checkbox"
                  checked={bomControls.includeLabelsAndPackaging}
                  onChange={e => onChangeBomControls({ ...bomControls, includeLabelsAndPackaging: e.target.checked })}
                  className="accent-neutral-900"
                />
                <span className="text-[11px] text-neutral-800">Labels &amp; Packaging</span>
              </label>
            </div>

            {/* BOM Totals Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
              <div className="p-3 border border-neutral-200 rounded-xs bg-white">
                <span className="text-[10px] text-neutral-500 uppercase block">Total Garments in Order</span>
                <span className="text-lg font-bold text-neutral-900" data-testid="m05-bom-total-garments">
                  {bundle.bom.totalOrderGarments}
                </span>
              </div>
              <div className="p-3 border border-neutral-200 rounded-xs bg-white">
                <span className="text-[10px] text-neutral-500 uppercase block">Total Main Fabric</span>
                <span className="text-lg font-bold text-neutral-900" data-testid="m05-bom-main-fabric-meters">
                  {bundle.bom.totalMainFabricMetersForOrder.toFixed(2)} m
                </span>
              </div>
              <div className="p-3 border border-neutral-200 rounded-xs bg-white">
                <span className="text-[10px] text-neutral-500 uppercase block">Total Interfacing / Stay-Tape</span>
                <span className="text-lg font-bold text-neutral-900">
                  {bundle.bom.totalInterfacingMetersForOrder.toFixed(2)} m
                </span>
              </div>
              <div className="p-3 border border-neutral-200 rounded-xs bg-white">
                <span className="text-[10px] text-neutral-500 uppercase block">Total Sewing Thread</span>
                <span className="text-lg font-bold text-neutral-900">
                  {bundle.bom.totalThreadMetersForOrder.toFixed(1)} m
                </span>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="overflow-x-auto border border-neutral-200 rounded-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-neutral-100 border-b border-neutral-200 font-mono text-[10px] uppercase text-neutral-600">
                    <th className="py-2 px-3">Material &amp; Spec</th>
                    <th className="py-2 px-3">Basis</th>
                    <th className="py-2 px-3 text-right">Per Garment</th>
                    <th className="py-2 px-3 text-right">Order Total</th>
                    <th className="py-2 px-3">Traceability / Formula</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {bundle.bom.lineItems.map(item => (
                    <tr key={item.itemId} className="hover:bg-neutral-50 align-top">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-neutral-900">{item.materialName}</div>
                        <div className="text-[11px] text-neutral-500 font-mono">{item.specification}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <Badge
                          variant={
                            item.basis === 'calculated'
                              ? 'success'
                              : item.basis === 'configured-allowance'
                                ? 'accent'
                                : 'warning'
                          }
                          size="sm"
                        >
                          {item.basis}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-neutral-900">
                        {item.totalQuantityPerGarment.toFixed(3)} {item.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-neutral-900">
                        {item.totalOrderQuantity.toFixed(2)} {item.unit}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-neutral-600 font-mono max-w-sm">
                        <div>{item.calculationFormula}</div>
                        {item.traceablePieceIds.length > 0 && (
                          <div className="text-[10px] text-neutral-400 mt-0.5">
                            Pieces: {item.traceablePieceIds.join(', ')}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {subTab === 'docs' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Cutting Instructions & Piece Registry */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-800">
                  Cutting Instructions &amp; Pattern Piece Registry
                </h4>
                <Badge variant={bundle.manufacturingDocs.completeness.isComplete ? 'success' : 'danger'} size="sm">
                  {bundle.manufacturingDocs.completeness.isComplete ? 'TRACED & COMPLETE' : 'INCOMPLETE'}
                </Badge>
              </div>
              <div className="space-y-2.5">
                {bundle.manufacturingDocs.cuttingInstructions.map(ci => (
                  <div key={ci.pieceId} className="p-3 border border-neutral-200 rounded-xs bg-neutral-50/70 text-xs space-y-1">
                    <div className="flex items-center justify-between font-mono">
                      <span className="font-bold text-neutral-900">[{ci.pieceCode}] {ci.pieceName}</span>
                      <Badge variant="dark" size="sm">
                        {ci.onFold ? 'CUT 1 ON FOLD' : `CUT ${ci.cutCountPerGarment}`}
                      </Badge>
                    </div>
                    <p className="text-neutral-700">{ci.pairingRule}</p>
                    <div className="flex flex-wrap gap-3 text-[11px] font-mono text-neutral-500 pt-1">
                      <span>Area: <strong className="text-neutral-800">{ci.cuttingAreaCm2 ?? 'N/A'} cm²</strong></span>
                      <span>Grain: <strong className="text-neutral-800">{ci.grainDirection.toUpperCase()}</strong></span>
                      <span>Notches: <strong className="text-neutral-800">{ci.notchCount}</strong></span>
                      <span>Drill Holes: <strong className="text-neutral-800">{ci.drillHoleCount}</strong></span>
                    </div>
                    {ci.directionalNapNote && (
                      <div className="text-[11px] text-amber-800 bg-amber-50 px-2 py-1 rounded border border-amber-200 mt-1">
                        {ci.directionalNapNote}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Sewing Sequence, Notch Alignment & QC */}
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-800 mb-2">
                  Feature-Traced ISO 4915 Sewing Sequence
                </h4>
                <div className="space-y-2">
                  {bundle.manufacturingDocs.sewingSequence.map(op => (
                    <div key={op.operationCode} className="p-2.5 border border-neutral-200 rounded-xs bg-white text-xs space-y-1">
                      <div className="flex items-center justify-between font-mono">
                        <span className="font-bold text-neutral-900">{op.operationCode}: {op.title}</span>
                        <span className="text-[10px] bg-neutral-100 text-neutral-700 px-1.5 py-0.5 rounded">
                          ISO {op.stitchClassIso4915} • SA {op.seamAllowanceCm}cm
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-700">{op.instruction}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-800 mb-2">
                  Notch Correspondence &amp; QC Tolerances
                </h4>
                <div className="space-y-1.5 text-[11px] font-mono">
                  {bundle.manufacturingDocs.notchAlignmentInstructions.map(n => (
                    <div key={n.notchId} className="p-2 bg-neutral-50 border border-neutral-200 rounded-xs flex justify-between gap-2">
                      <span><strong>[{n.pieceCode}]</strong> {n.notchLabel} ({n.notchType}) — {n.targetMatchDescription}</span>
                      <span className="text-neutral-500 shrink-0">≤ {n.toleranceCm.toFixed(2)}cm</span>
                    </div>
                  ))}
                  {bundle.manufacturingDocs.qualityCheckpoints.map(qc => (
                    <div key={qc.checkpointId} className="p-2 bg-emerald-50/50 border border-emerald-200 rounded-xs flex justify-between gap-2 text-emerald-950">
                      <span><strong>{qc.checkpointName}:</strong> {qc.criterion}</span>
                      <span className="font-bold shrink-0">{qc.toleranceSpec}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {subTab === 'dxf-digest' && (
          <div className="space-y-4">
            {bundle.dxfExport ? (
              <div className="border border-neutral-200 rounded-xs p-4 space-y-3 bg-neutral-50/60">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <Layers className="w-4 h-4 text-neutral-700" />
                    <span className="font-bold text-neutral-900">
                      DXF-AAMA / ASTM D6673 ({bundle.dxfExport.artifact.dxfVersion}, $INSUNITS={bundle.dxfExport.artifact.insUnitsCode} cm)
                    </span>
                    <Badge variant={bundle.dxfExport.roundTrip.allPassed ? 'success' : 'danger'} size="sm">
                      {bundle.dxfExport.roundTrip.allPassed ? 'SYNTHETIC ROUND-TRIP PASSED' : 'ROUND-TRIP FAILED'}
                    </Badge>
                  </div>
                  <Badge variant="warning" size="sm">
                    externalCadInteroperabilityVerified: false
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                  <div className="bg-white p-2.5 border border-neutral-200 rounded-xs">
                    <span className="text-[10px] text-neutral-500 block">Cut / Sew Vertices</span>
                    <strong className="text-neutral-900">
                      {bundle.dxfExport.roundTrip.cutVertexCountRecovered}/{bundle.dxfExport.roundTrip.cutVertexCountExpected} &amp;{' '}
                      {bundle.dxfExport.roundTrip.sewVertexCountRecovered}/{bundle.dxfExport.roundTrip.sewVertexCountExpected}
                    </strong>
                  </div>
                  <div className="bg-white p-2.5 border border-neutral-200 rounded-xs">
                    <span className="text-[10px] text-neutral-500 block">Grainlines / Labels</span>
                    <strong className="text-neutral-900">
                      {bundle.dxfExport.roundTrip.grainLinesRecovered}/{bundle.dxfExport.roundTrip.grainLinesExpected} GL •{' '}
                      {bundle.dxfExport.roundTrip.pieceLabelsRecovered}/{bundle.dxfExport.roundTrip.pieceLabelsExpected} TXT
                    </strong>
                  </div>
                  <div className="bg-white p-2.5 border border-neutral-200 rounded-xs">
                    <span className="text-[10px] text-neutral-500 block">Notches / Drill Pts</span>
                    <strong className="text-neutral-900">
                      {bundle.dxfExport.roundTrip.notchLinesRecovered}/{bundle.dxfExport.roundTrip.notchLinesExpected} Notch •{' '}
                      {bundle.dxfExport.roundTrip.drillPointsRecovered}/{bundle.dxfExport.roundTrip.drillPointsExpected} Drill
                    </strong>
                  </div>
                  <div className="bg-white p-2.5 border border-neutral-200 rounded-xs">
                    <span className="text-[10px] text-neutral-500 block">Max Round-Trip Δ</span>
                    <strong className="text-emerald-700">
                      {bundle.dxfExport.roundTrip.maxVertexRoundTripErrorCm.toFixed(6)} cm (≤ 0.001)
                    </strong>
                  </div>
                </div>

                <p className="text-[11px] font-mono text-neutral-600">
                  {bundle.dxfExport.artifact.interoperabilityNote}
                </p>
              </div>
            ) : (
              <div className="p-3 bg-red-50 border border-red-200 text-red-900 text-xs font-mono">
                DXF-AAMA artifact unavailable for empty or malformed pieces.
              </div>
            )}

            {/* Canonical JSON + SHA-256 Digest Card */}
            <div className="border border-neutral-200 rounded-xs p-4 space-y-2 bg-white font-mono text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase block">
                    CANONICAL UTF-8 PRODUCTION PACKAGE DIGEST (FIPS 180-4 SHA-256)
                  </span>
                  <code className="text-neutral-900 font-bold break-all">
                    {bundle.canonicalContentDigest}
                  </code>
                  <span className="text-[11px] text-neutral-500 block mt-0.5">
                    Canonical byte length: {bundle.canonicalJsonByteLength.toLocaleString()} bytes
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCanonicalJson(v => !v)}
                  className="px-2.5 py-1.5 border border-neutral-300 rounded-xs text-xs hover:bg-neutral-50 cursor-pointer flex items-center gap-1"
                >
                  {showCanonicalJson ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span>{showCanonicalJson ? 'Hide Canonical JSON' : 'Inspect Canonical JSON'}</span>
                </button>
              </div>

              {showCanonicalJson && (
                <pre
                  data-testid="m05-canonical-json"
                  className="p-3 bg-neutral-900 text-neutral-100 rounded-xs text-[11px] overflow-x-auto max-h-64"
                >
                  {canonicalJsonText}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
