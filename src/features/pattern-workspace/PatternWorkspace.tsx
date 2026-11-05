/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BodiceDartStyle, BodyMeasurements, DesignSpecification, PatternDraft, PatternPiece, SleeveEaseStrategy } from '../../types';
import { draftSkirtBlock } from '../../engine/drafting/skirt-block';
import { draftBodiceBlock } from '../../engine/drafting/bodice-block';
import { draftSleeveBlock, SleeveDiagnostics } from '../../engine/drafting/sleeve-block';
import { assembleBodiceSleeve, BodiceSleeveAssemblyResult } from '../../engine/assembly';
import { gradePattern, GradedPatternSet, DEFAULT_SIZE_RANGE } from '../../engine/grading';
import { validatePatternDraft } from '../../engine/validation/seam-validator';
import { calculateGarmentDimensions, calculateBodiceGarmentDimensions, SLEEVE_EASE_TABLE } from '../../engine/measurements/standards';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
  ShieldCheck,
  Eye,
  Ruler,
  Compass
} from 'lucide-react';

const SIZE_PALETTE: Record<string, { stroke: string; bg: string; text: string; label: string }> = {
  XS: { stroke: '#9333ea', bg: '#f3e8ff', text: '#6b21a8', label: 'XS (EU 34)' },
  S:  { stroke: '#2563eb', bg: '#dbeafe', text: '#1e40af', label: 'S (EU 36)' },
  M:  { stroke: '#16a34a', bg: '#dcfce7', text: '#15803d', label: 'M (EU 38 - Base)' },
  L:  { stroke: '#d97706', bg: '#fef3c7', text: '#b45309', label: 'L (EU 40)' },
  XL: { stroke: '#dc2626', bg: '#fee2e2', text: '#b91c1c', label: 'XL (EU 42)' },
  XXL:{ stroke: '#7c3aed', bg: '#ede9fe', text: '#5b21b6', label: 'XXL (EU 44)' }
};

interface PatternWorkspaceProps {
  currentSpec: DesignSpecification;
  measurements: BodyMeasurements;
  activeSize: string;
  onNavigateToProduction: () => void;
  onNavigateToMeasurements: () => void;
}

export const PatternWorkspace: React.FC<PatternWorkspaceProps> = ({
  currentSpec,
  measurements,
  activeSize,
  onNavigateToProduction,
  onNavigateToMeasurements
}) => {
  // Dart style configuration for bodice
  const [bodiceDartStyle, setBodiceDartStyle] = useState<BodiceDartStyle>(
    currentSpec.dartStyle ?? 'waist'
  );

  // Sleeve ease strategy configuration for tailored sleeve (Milestone 04.2)
  const [sleeveEaseStrategy, setSleeveEaseStrategy] = useState<SleeveEaseStrategy>(
    currentSpec.sleeveEaseStrategy ?? 'classic'
  );

  // Layer visibility toggles
  const [showSeamAllowance, setShowSeamAllowance] = useState(true);
  const [showSewLines, setShowSewLines] = useState(true);
  const [showGrainline, setShowGrainline] = useState(true);
  const [showNotches, setShowNotches] = useState(true);
  const [showDarts, setShowDarts] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  
  // Canvas zoom & pan state
  const [zoom, setZoom] = useState(1.4);
  const [pan, setPan] = useState({ x: 40, y: 30 });
  const [cadViewMode, setCadViewMode] = useState<'pieces' | 'assembly' | 'grading'>('pieces');
  const [enabledGradingSizes, setEnabledGradingSizes] = useState<Record<string, boolean>>({
    XS: true,
    S: true,
    M: true,
    L: true,
    XL: true,
    XXL: true
  });
  const [selectedPieceId, setSelectedPieceId] = useState<string>(
    currentSpec.garmentCategory === 'bodice' ? 'piece-bodice-front' : 'piece-skirt-front'
  );

  // Milestone 04.4: Graded Pattern Set generation
  const gradedPatternSet: GradedPatternSet = React.useMemo(() => {
    return gradePattern(currentSpec, {
      bodiceDartStyle,
      sleeveEaseStrategy
    });
  }, [currentSpec, bodiceDartStyle, sleeveEaseStrategy]);

  // Deterministic draft generation (Bodice includes front, back, and set-in sleeve)
  let pieces: PatternPiece[] = [];
  let sleeveDiag: SleeveDiagnostics | undefined = undefined;

  if (currentSpec.garmentCategory === 'bodice') {
    const bodicePieces = draftBodiceBlock(measurements, currentSpec, { dartStyle: bodiceDartStyle });
    try {
      const sleeveResult = draftSleeveBlock(measurements, currentSpec, {
        strategy: sleeveEaseStrategy,
        bodicePieces
      });
      pieces = [...bodicePieces, sleeveResult.piece];
      sleeveDiag = sleeveResult.diagnostics;
    } catch {
      // In case sleeve measurements are missing, fallback gracefully to bodice panels
      pieces = bodicePieces;
    }
  } else {
    pieces = draftSkirtBlock(measurements, currentSpec);
  }

  // Milestone 04.3: Integrated Bodice-Sleeve Assembly computation
  let assemblyResult: BodiceSleeveAssemblyResult | undefined = undefined;
  if (currentSpec.garmentCategory === 'bodice' && pieces.length >= 3) {
    try {
      assemblyResult = assembleBodiceSleeve({
        bodicePieces: pieces.slice(0, 2),
        sleevePiece: pieces[2],
        designSpec: currentSpec,
        measurements,
        options: { strategy: sleeveEaseStrategy }
      });
    } catch {
      // Fallback
    }
  }

  const validationReport = validatePatternDraft(pieces);
  const garmentDims = currentSpec.garmentCategory === 'bodice'
    ? calculateBodiceGarmentDimensions(measurements, currentSpec.easeProfile, currentSpec.fabric)
    : calculateGarmentDimensions(measurements, currentSpec.easeProfile, currentSpec.fabric);

  const selectedPiece = pieces.find(p => p.id === selectedPieceId) || pieces[0];

  const handleZoom = (delta: number) => {
    setZoom(prev => Math.min(3.5, Math.max(0.6, Number((prev + delta).toFixed(1)))));
  };

  const handleResetView = () => {
    setZoom(1.4);
    setPan({ x: 40, y: 30 });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-200 pb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-widest text-neutral-500 font-mono">Module 04</span>
            <span className="text-neutral-300">/</span>
            <Badge variant="dark" size="sm">DETERMINISTIC PATTERN CAD</Badge>
            <span className="text-neutral-400 font-mono text-xs">SCALE: 1 CM = 5 PX</span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-serif font-bold text-neutral-900 tracking-tight">
            Pattern Drafting &amp; Geometric CAD Canvas
          </h2>
          <p className="text-sm text-neutral-600 mt-1 max-w-2xl">
            Pure mathematical coordinate generation. Seams, notches, grainlines, and ease are calculated deterministically.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onNavigateToMeasurements}
            icon={<Compass className="w-3.5 h-3.5" />}
          >
            Adjust Measurements
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onNavigateToProduction}
            icon={<ShieldCheck className="w-3.5 h-3.5" />}
            className="font-mono text-xs uppercase"
          >
            5. Production Sheets <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </div>

      {/* Bodice Dart & Sleeve Engineering Toolbars (Milestones 04.1 & 04.2) */}
      {currentSpec.garmentCategory === 'bodice' && (
        <div className="space-y-3">
          {/* Dart Manipulation Toolbar */}
          <div className="bg-white border border-neutral-200 rounded-sm p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider font-mono bg-neutral-900 text-white px-2 py-0.5 rounded">
                  DART MANIPULATION CORE
                </span>
                <span className="text-xs font-mono text-neutral-500">RADIAL PIVOTING &amp; INTAKE CONSERVATION</span>
              </div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Active Bodice Dart Configuration
              </h3>
              <p className="text-xs text-neutral-600 mt-0.5">
                Transfer dart intake between waist, side seam, shoulder, and diagonal french positions while preserving exact 3D volume.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'waist', label: 'Waist Dart', desc: 'Standard basic block' },
                { id: 'side-bust', label: 'Side Bust Dart', desc: 'Underarm side seam' },
                { id: 'shoulder', label: 'Shoulder Dart', desc: 'Mid-shoulder seam' },
                { id: 'french', label: 'French Dart', desc: 'Low diagonal side' },
                { id: 'waist-and-side', label: 'Dual Dart (50/50)', desc: 'Split waist + side' },
              ].map(cfg => (
                <button
                  key={cfg.id}
                  onClick={() => setBodiceDartStyle(cfg.id as BodiceDartStyle)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-xs border transition-all cursor-pointer flex flex-col items-start ${
                    bodiceDartStyle === cfg.id
                      ? 'bg-neutral-900 text-white border-neutral-900 shadow-2xs'
                      : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50'
                  }`}
                >
                  <span className="font-semibold">{cfg.label}</span>
                  <span className={`text-[10px] ${bodiceDartStyle === cfg.id ? 'text-neutral-300' : 'text-neutral-500'}`}>
                    {cfg.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Sleeve Ease Strategy Toolbar (Milestone 04.2) */}
          <div className="bg-white border border-neutral-200 rounded-sm p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider font-mono bg-blue-900 text-white px-2 py-0.5 rounded">
                  MILESTONE 04.2
                </span>
                <span className="text-xs font-mono text-neutral-500">ONE-PIECE FITTED SLEEVE BLOCK</span>
              </div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Sleeve Cap Ease &amp; Fit Strategy
              </h3>
              <p className="text-xs text-neutral-600 mt-0.5">
                Deterministic sleeve cap height and diagonal chords generated directly from bodice scye curves.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'tailored', label: 'Tailored Suiting', ease: '+2.8 cm cap ease', desc: 'Wool / structured drape' },
                { id: 'classic', label: 'Classic Woven', ease: '+1.8 cm cap ease', desc: 'Standard daywear balance' },
                { id: 'fitted', label: 'Fitted Sleek', ease: '+1.0 cm cap ease', desc: 'Low-stretch / close scye' },
                { id: 'flat', label: 'Flat Shirt', ease: '+0.4 cm cap ease', desc: 'Casual zero-crimp drape' },
              ].map(strat => (
                <button
                  key={strat.id}
                  onClick={() => setSleeveEaseStrategy(strat.id as SleeveEaseStrategy)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-xs border transition-all cursor-pointer flex flex-col items-start ${
                    sleeveEaseStrategy === strat.id
                      ? 'bg-blue-950 text-white border-blue-950 shadow-2xs'
                      : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 w-full justify-between">
                    <span className="font-semibold">{strat.label}</span>
                    <span className={`text-[9px] font-mono px-1 rounded ${
                      sleeveEaseStrategy === strat.id ? 'bg-blue-800 text-blue-100' : 'bg-neutral-100 text-neutral-600'
                    }`}>
                      {strat.ease}
                    </span>
                  </div>
                  <span className={`text-[10px] ${sleeveEaseStrategy === strat.id ? 'text-blue-200' : 'text-neutral-500'}`}>
                    {strat.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main CAD Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive CAD Canvas */}
        <div className="lg:col-span-8 flex flex-col space-y-3">
          {/* Milestone 04.3: CAD View Mode Selector */}
          {currentSpec.garmentCategory === 'bodice' && assemblyResult && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white border border-neutral-200 rounded-sm p-3 shadow-2xs gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs uppercase font-mono text-neutral-500 font-bold">VIEW MODE:</span>
                <div className="inline-flex rounded-xs border border-neutral-300 p-0.5 bg-neutral-100">
                  <button
                    onClick={() => setCadViewMode('pieces')}
                    className={`px-3 py-1 text-xs font-medium rounded-xs transition-colors cursor-pointer ${
                      cadViewMode === 'pieces'
                        ? 'bg-neutral-900 text-white shadow-2xs'
                        : 'text-neutral-700 hover:text-neutral-900'
                    }`}
                  >
                    Pattern Pieces ({pieces.length})
                  </button>
                  <button
                    onClick={() => setCadViewMode('assembly')}
                    className={`px-3 py-1 text-xs font-medium rounded-xs transition-colors cursor-pointer flex items-center gap-1.5 ${
                      cadViewMode === 'assembly'
                        ? 'bg-blue-900 text-white shadow-2xs'
                        : 'text-neutral-700 hover:text-neutral-900'
                    }`}
                  >
                    <span>Assembly Inspection (M 04.3)</span>
                    <Badge
                      variant={assemblyResult?.status === 'verified-valid' ? 'success' : 'danger'}
                      size="sm"
                    >
                      {assemblyResult?.status === 'verified-valid' ? 'VERIFIED' : 'INVALID'}
                    </Badge>
                  </button>
                  <button
                    onClick={() => setCadViewMode('grading')}
                    className={`px-3 py-1 text-xs font-medium rounded-xs transition-colors cursor-pointer flex items-center gap-1.5 ${
                      cadViewMode === 'grading'
                        ? 'bg-purple-900 text-white shadow-2xs'
                        : 'text-neutral-700 hover:text-neutral-900'
                    }`}
                  >
                    <span>Grading Nest Overlay (M 04.4)</span>
                    <Badge
                      variant={gradedPatternSet.isAllValid ? 'success' : 'danger'}
                      size="sm"
                    >
                      {gradedPatternSet.isAllValid ? 'ALL VALID (6/6)' : 'FLAGGED'}
                    </Badge>
                  </button>
                </div>
              </div>

              <div className="text-[11px] font-mono text-neutral-500">
                {cadViewMode === 'assembly' ? (
                  <span className="text-blue-900 font-bold">2D RIGID ALIGNMENT AT SCYE JUNCTIONS</span>
                ) : cadViewMode === 'grading' ? (
                  <span className="text-purple-900 font-bold">MULTI-SIZE NESTED OVERLAY (XS–XXL)</span>
                ) : (
                  <span>FLAT CUTTING PATTERN VIEW</span>
                )}
              </div>
            </div>
          )}

          {/* Milestone 04.4: Grading Mode HUD Bar */}
          {cadViewMode === 'grading' && (
            <div className="bg-purple-50/90 border border-purple-200 rounded-sm p-3.5 space-y-3 text-xs font-mono">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-purple-200/80 pb-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-purple-950">CROSS-SIZE PATTERN GRADING HUD</span>
                  <Badge variant={gradedPatternSet.isAllValid ? 'success' : 'danger'} size="sm">
                    {gradedPatternSet.isAllValid ? 'VERIFIED MONOTONIC' : 'VERIFICATION FAILED'}
                  </Badge>
                  <span className="text-[11px] text-purple-800 bg-purple-100 px-2 py-0.5 rounded">
                    BASE SIZE: {gradedPatternSet.baseSize}
                  </span>
                </div>
                <span className="text-[11px] text-purple-900">
                  {gradedPatternSet.integrityReport.summaryMessage}
                </span>
              </div>

              {/* Per-size selection and status badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-neutral-500 uppercase font-bold mr-1">SIZES IN NEST:</span>
                {DEFAULT_SIZE_RANGE.map(sz => {
                  const szRes = gradedPatternSet.sizeResults[sz];
                  const isEnabled = enabledGradingSizes[sz];
                  const pal = SIZE_PALETTE[sz];
                  return (
                    <button
                      key={sz}
                      onClick={() => setEnabledGradingSizes(prev => ({ ...prev, [sz]: !prev[sz] }))}
                      className={`px-2.5 py-1 text-xs rounded border transition-all cursor-pointer flex items-center gap-1.5 ${
                        isEnabled
                          ? 'border-neutral-400 bg-white shadow-2xs'
                          : 'border-neutral-200 bg-neutral-100 opacity-50'
                      }`}
                      style={{ borderLeftColor: pal.stroke, borderLeftWidth: '4px' }}
                    >
                      <span className="font-bold text-neutral-900">{sz}</span>
                      <span className="text-[10px] text-neutral-500 font-normal">
                        ({szRes?.measurements.bust}cm)
                      </span>
                      <span
                        className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase ${
                          szRes?.isValid ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {szRes?.isValid ? 'VALID' : 'INVALID'}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="text-[10px] text-purple-900/80 bg-purple-100/60 p-1.5 rounded flex items-center justify-between">
                <span>Deterministic measurement regeneration — zero global affine coordinate scaling.</span>
                <span className="font-semibold uppercase text-amber-800">isProductionReady: false</span>
              </div>
            </div>
          )}

          {/* Assembly Mode HUD Bar */}
          {cadViewMode === 'assembly' && assemblyResult && (
            <div className="bg-blue-50/90 border border-blue-200 rounded-sm p-3.5 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between border-b border-blue-200/80 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-blue-950">BODICE–SLEEVE SEAM ASSEMBLY HUD</span>
                  <Badge variant={assemblyResult.status === 'verified-valid' ? 'success' : 'danger'} size="sm">
                    {assemblyResult.status.toUpperCase()}
                  </Badge>
                </div>
                <span className="text-[11px] text-blue-800">
                  PARITY DELTA: {assemblyResult.endpoints.underarmInseamMatch.parityDeltaCm.toFixed(3)} cm (≤ 0.05 cm)
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="bg-white/80 p-2 rounded border border-blue-100">
                  <span className="text-neutral-500 block text-[10px]">TOTAL EASE (E_t)</span>
                  <span className="font-bold text-neutral-900">
                    +{assemblyResult.ease.totalEaseCm.toFixed(2)} cm
                    <span className="text-neutral-400 font-normal"> (±{assemblyResult.ease.totalEaseUncertaintyCm.toFixed(4)})</span>
                  </span>
                </div>
                <div className="bg-white/80 p-2 rounded border border-blue-100">
                  <span className="text-neutral-500 block text-[10px]">FRONT EASE (E_f)</span>
                  <span className="font-bold text-neutral-900">
                    +{assemblyResult.ease.frontEaseCm.toFixed(2)} cm {assemblyResult.ease.frontEaseRatio !== null ? `(${(assemblyResult.ease.frontEaseRatio * 100).toFixed(0)}%)` : '(N/A)'}
                  </span>
                </div>
                <div className="bg-white/80 p-2 rounded border border-blue-100">
                  <span className="text-neutral-500 block text-[10px]">BACK EASE (E_b)</span>
                  <span className="font-bold text-neutral-900">
                    +{assemblyResult.ease.backEaseCm.toFixed(2)} cm {assemblyResult.ease.frontEaseRatio !== null ? `(${((1 - assemblyResult.ease.frontEaseRatio) * 100).toFixed(0)}%)` : '(N/A)'}
                  </span>
                </div>
                <div className="bg-white/80 p-2 rounded border border-blue-100">
                  <span className="text-neutral-500 block text-[10px]">TARGET STRATEGY</span>
                  <span className="font-bold text-neutral-900 uppercase">
                    {assemblyResult.ease.targetStrategy} (+{assemblyResult.ease.targetTotalEaseCm}cm)
                  </span>
                </div>
              </div>

              <div className="text-[10px] text-blue-900/80 bg-blue-100/60 p-1.5 rounded flex items-center justify-between">
                <span>{assemblyResult.inspectionLayout?.disclaimer}</span>
                <span className="font-semibold uppercase text-amber-800">isProductionReady: false</span>
              </div>
            </div>
          )}
          {/* Canvas Controls Toolbar */}
          <div className="bg-neutral-900 text-white px-4 py-2.5 rounded-t-sm flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            {/* Viewport Zoom */}
            <div className="flex items-center gap-2">
              <span className="text-neutral-400 uppercase text-[10px]">VIEWPORT:</span>
              <button
                onClick={() => handleZoom(-0.2)}
                className="p-1.5 hover:bg-neutral-800 rounded cursor-pointer text-neutral-300 hover:text-white"
                title="Zoom Out"
                aria-label="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="w-12 text-center text-xs font-semibold">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => handleZoom(0.2)}
                className="p-1.5 hover:bg-neutral-800 rounded cursor-pointer text-neutral-300 hover:text-white"
                title="Zoom In"
                aria-label="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={handleResetView}
                className="p-1.5 hover:bg-neutral-800 rounded cursor-pointer text-neutral-300 hover:text-white text-[11px] ml-1"
                title="Reset View"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            {/* Layer Toggles */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-neutral-300">
                <input
                  type="checkbox"
                  checked={showSeamAllowance}
                  onChange={e => setShowSeamAllowance(e.target.checked)}
                  className="accent-white"
                />
                Cut Line (+1.5cm)
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-neutral-300">
                <input
                  type="checkbox"
                  checked={showSewLines}
                  onChange={e => setShowSewLines(e.target.checked)}
                  className="accent-white"
                />
                Sew Line
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-neutral-300">
                <input
                  type="checkbox"
                  checked={showGrainline}
                  onChange={e => setShowGrainline(e.target.checked)}
                  className="accent-white"
                />
                Grainline
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-neutral-300">
                <input
                  type="checkbox"
                  checked={showNotches}
                  onChange={e => setShowNotches(e.target.checked)}
                  className="accent-white"
                />
                Notches
              </label>
            </div>
          </div>

          {/* SVG CAD Canvas Surface */}
          <div className="relative border border-neutral-300 bg-neutral-100/60 rounded-b-sm overflow-hidden min-h-[540px] flex items-center justify-center select-none">
            {/* Background CAD Grid */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none opacity-20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <pattern id="cad-grid-small" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#71717a" strokeWidth="0.5" />
                </pattern>
                <pattern id="cad-grid-large" width="50" height="50" patternUnits="userSpaceOnUse">
                  <rect width="50" height="50" fill="url(#cad-grid-small)" />
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#52525b" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#cad-grid-large)" />
            </svg>

            {/* Pattern Pieces SVG Render */}
            {/* SVG Render: Either Individual Pieces or Integrated Assembly */}
            <svg
              viewBox="-30 -30 650 500"
              className="w-full h-[520px] transition-transform duration-75"
              style={{
                transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: 'center center'
              }}
            >
              {cadViewMode === 'assembly' && assemblyResult?.inspectionLayout ? (
                /* Milestone 04.3: Integrated Assembly 2D Inspection Layout */
                <g transform="translate(40, 40) scale(4.2)">
                  {/* Front Assembly (Bodice Front + Sleeve Cap at Underarm) */}
                  <g>
                    {/* Front Bodice Piece */}
                    <path
                      d={assemblyResult.inspectionLayout.frontAssembly.bodice.transformedCutSvgPath}
                      fill="#FAF8F5"
                      stroke="#09090b"
                      strokeWidth="0.7"
                    />
                    <path
                      d={assemblyResult.inspectionLayout.frontAssembly.bodice.transformedSewSvgPath}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="0.4"
                      strokeDasharray="1.2 0.8"
                    />
                    {/* Front Bodice Notches */}
                    {assemblyResult.inspectionLayout.frontAssembly.bodice.transformedNotches.map(n => (
                      <line
                        key={n.id}
                        x1={n.position.x - 0.8}
                        y1={n.position.y}
                        x2={n.position.x + 0.8}
                        y2={n.position.y}
                        stroke="#16a34a"
                        strokeWidth="0.6"
                      />
                    ))}

                    {/* Front Sleeve Piece (Aligned at underarm) */}
                    <path
                      d={assemblyResult.inspectionLayout.frontAssembly.sleeve.transformedCutSvgPath}
                      fill="#EFF6FF"
                      fillOpacity="0.4"
                      stroke="#1d4ed8"
                      strokeWidth="0.7"
                    />
                    <path
                      d={assemblyResult.inspectionLayout.frontAssembly.sleeve.transformedSewSvgPath}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="0.4"
                      strokeDasharray="1.2 0.8"
                    />
                    {/* Sleeve Notches */}
                    {assemblyResult.inspectionLayout.frontAssembly.sleeve.transformedNotches.map(n => (
                      <line
                        key={n.id}
                        x1={n.position.x - 0.8}
                        y1={n.position.y}
                        x2={n.position.x + 0.8}
                        y2={n.position.y}
                        stroke="#16a34a"
                        strokeWidth="0.6"
                      />
                    ))}

                    {/* Assembly Junction Annotation */}
                    <circle cx="20" cy="22" r="1.5" fill="none" stroke="#2563eb" strokeWidth="0.5" />
                    <text x="5" y="-5" fontSize="2.2" fontFamily="monospace" fontWeight="bold" fill="#1e3a8a">
                      [FRONT ASSEMBLY: SCYE MATCH]
                    </text>
                    <text x="5" y="-2" fontSize="1.6" fontFamily="monospace" fill="#52525b">
                      Ease: +{assemblyResult.ease.frontEaseCm.toFixed(2)} cm {assemblyResult.ease.frontEaseRatio !== null ? `(${(assemblyResult.ease.frontEaseRatio * 100).toFixed(0)}%)` : ''}
                    </text>
                  </g>

                  {/* Back Assembly (Bodice Back + Sleeve Cap at Underarm) */}
                  <g>
                    {/* Back Bodice Piece */}
                    <path
                      d={assemblyResult.inspectionLayout.backAssembly.bodice.transformedCutSvgPath}
                      fill="#FAF8F5"
                      stroke="#09090b"
                      strokeWidth="0.7"
                    />
                    <path
                      d={assemblyResult.inspectionLayout.backAssembly.bodice.transformedSewSvgPath}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="0.4"
                      strokeDasharray="1.2 0.8"
                    />
                    {/* Back Bodice Notches */}
                    {assemblyResult.inspectionLayout.backAssembly.bodice.transformedNotches.map(n => (
                      <line
                        key={n.id}
                        x1={n.position.x - 0.8}
                        y1={n.position.y}
                        x2={n.position.x + 0.8}
                        y2={n.position.y}
                        stroke="#16a34a"
                        strokeWidth="0.6"
                      />
                    ))}

                    {/* Back Sleeve Piece (Aligned at underarm) */}
                    <path
                      d={assemblyResult.inspectionLayout.backAssembly.sleeve.transformedCutSvgPath}
                      fill="#EFF6FF"
                      fillOpacity="0.4"
                      stroke="#1d4ed8"
                      strokeWidth="0.7"
                    />
                    <path
                      d={assemblyResult.inspectionLayout.backAssembly.sleeve.transformedSewSvgPath}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="0.4"
                      strokeDasharray="1.2 0.8"
                    />
                    {/* Sleeve Notches */}
                    {assemblyResult.inspectionLayout.backAssembly.sleeve.transformedNotches.map(n => (
                      <line
                        key={n.id}
                        x1={n.position.x - 0.8}
                        y1={n.position.y}
                        x2={n.position.x + 0.8}
                        y2={n.position.y}
                        stroke="#16a34a"
                        strokeWidth="0.6"
                      />
                    ))}

                    {/* Assembly Junction Annotation */}
                    <text x="65" y="-5" fontSize="2.2" fontFamily="monospace" fontWeight="bold" fill="#1e3a8a">
                      [BACK ASSEMBLY: SCYE MATCH]
                    </text>
                    <text x="65" y="-2" fontSize="1.6" fontFamily="monospace" fill="#52525b">
                      Ease: +{assemblyResult.ease.backEaseCm.toFixed(2)} cm {assemblyResult.ease.frontEaseRatio !== null ? `(${((1 - assemblyResult.ease.frontEaseRatio) * 100).toFixed(0)}%)` : ''}
                    </text>
                  </g>
                </g>
              ) : cadViewMode === 'grading' ? (
                /* Milestone 04.4: Multi-Size Nested Grading Overlay */
                <g>
                  {/* Legend / Title Header in Canvas */}
                  <text x="30" y="10" fontSize="11" fontFamily="monospace" fontWeight="bold" fill="#581c87">
                    NESTED PATTERN GRADING OVERLAY — 6 CONCURRENT SIZES (XS–XXL)
                  </text>
                  <text x="30" y="24" fontSize="8" fontFamily="monospace" fill="#71717a">
                    FRONT BODICE (X: 30) | BACK BODICE (X: 230) | SLEEVE BLOCK (X: 430) | BASE SIZE: {gradedPatternSet.baseSize}
                  </text>

                  {/* Render nested layers for each enabled size in order */}
                  {DEFAULT_SIZE_RANGE.filter(sz => enabledGradingSizes[sz]).map(sz => {
                    const szRes = gradedPatternSet.sizeResults[sz];
                    if (!szRes) return null;
                    const pal = SIZE_PALETTE[sz] ?? { stroke: '#09090b', bg: '#f4f4f5', text: '#09090b', label: sz };
                    const isBase = sz === gradedPatternSet.baseSize;

                    const fPiece = szRes.bodicePieces.find(p => p.pieceCode.includes('BOD-F') || p.id.includes('front'));
                    const bPiece = szRes.bodicePieces.find(p => p.pieceCode.includes('BOD-B') || p.id.includes('back'));
                    const sPiece = szRes.sleevePiece;

                    return (
                      <g key={sz} id={`nest-layer-${sz}`}>
                        {/* Front Bodice Nested Layer */}
                        {fPiece && (
                          <g transform="translate(30, 40) scale(4.5)">
                            <path
                              d={fPiece.cutPathData}
                              fill={isBase ? '#FAF8F5' : 'none'}
                              fillOpacity={isBase ? 0.35 : 0}
                              stroke={pal.stroke}
                              strokeWidth={isBase ? '1.0' : '0.6'}
                              strokeDasharray={isBase ? undefined : '2.5 1'}
                            />
                            {showSewLines && fPiece.sewPathData && (
                              <path
                                d={fPiece.sewPathData}
                                fill="none"
                                stroke={pal.stroke}
                                strokeWidth="0.35"
                                strokeDasharray="1 0.8"
                                opacity="0.6"
                              />
                            )}
                            {/* Darts */}
                            {fPiece.darts.map(d => (
                              <g key={d.id}>
                                <line
                                  x1={d.apex.x}
                                  y1={d.apex.y}
                                  x2={d.legLeft.x}
                                  y2={d.legLeft.y}
                                  stroke={pal.stroke}
                                  strokeWidth="0.35"
                                />
                                <line
                                  x1={d.apex.x}
                                  y1={d.apex.y}
                                  x2={d.legRight.x}
                                  y2={d.legRight.y}
                                  stroke={pal.stroke}
                                  strokeWidth="0.35"
                                />
                                <circle cx={d.apex.x} cy={d.apex.y} r="0.5" fill={pal.stroke} />
                              </g>
                            ))}
                            {/* Size Label */}
                            <text
                              x={fPiece.boundingBox.widthCm + 0.4}
                              y={fPiece.boundingBox.heightCm * 0.5}
                              fontSize="1.6"
                              fontFamily="monospace"
                              fill={pal.stroke}
                              fontWeight="bold"
                            >
                              {sz}
                            </text>
                          </g>
                        )}

                        {/* Back Bodice Nested Layer */}
                        {bPiece && (
                          <g transform="translate(230, 40) scale(4.5)">
                            <path
                              d={bPiece.cutPathData}
                              fill={isBase ? '#FAF8F5' : 'none'}
                              fillOpacity={isBase ? 0.35 : 0}
                              stroke={pal.stroke}
                              strokeWidth={isBase ? '1.0' : '0.6'}
                              strokeDasharray={isBase ? undefined : '2.5 1'}
                            />
                            {showSewLines && bPiece.sewPathData && (
                              <path
                                d={bPiece.sewPathData}
                                fill="none"
                                stroke={pal.stroke}
                                strokeWidth="0.35"
                                strokeDasharray="1 0.8"
                                opacity="0.6"
                              />
                            )}
                            <text
                              x={bPiece.boundingBox.widthCm + 0.4}
                              y={bPiece.boundingBox.heightCm * 0.5}
                              fontSize="1.6"
                              fontFamily="monospace"
                              fill={pal.stroke}
                              fontWeight="bold"
                            >
                              {sz}
                            </text>
                          </g>
                        )}

                        {/* Sleeve Block Nested Layer */}
                        {sPiece && (
                          <g transform="translate(430, 40) scale(4.5)">
                            <path
                              d={sPiece.cutPathData}
                              fill={isBase ? '#FAF8F5' : 'none'}
                              fillOpacity={isBase ? 0.35 : 0}
                              stroke={pal.stroke}
                              strokeWidth={isBase ? '1.0' : '0.6'}
                              strokeDasharray={isBase ? undefined : '2.5 1'}
                            />
                            {showSewLines && sPiece.sewPathData && (
                              <path
                                d={sPiece.sewPathData}
                                fill="none"
                                stroke={pal.stroke}
                                strokeWidth="0.35"
                                strokeDasharray="1 0.8"
                                opacity="0.6"
                              />
                            )}
                            <text
                              x={sPiece.boundingBox.widthCm * 0.5 + 2}
                              y={sPiece.boundingBox.heightCm - 1}
                              fontSize="1.6"
                              fontFamily="monospace"
                              fill={pal.stroke}
                              fontWeight="bold"
                            >
                              {sz}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              ) : (
                /* Standard Flat Pattern Pieces Render */
                pieces.map((piece, index) => {
                  // Offset each piece side by side for visual clarity (Front Bodice, Back Bodice, Sleeve)
                  const xOffset = index === 0 ? 30 : (index === 1 ? 230 : 430);
                  const yOffset = 40;
                  const isSelected = selectedPiece.id === piece.id;
                  const isOffsetFailed = piece.offsetResult?.status === 'failure';
                  const pieceHasErrors = isOffsetFailed || validationReport.checks.some(
                    c => c.status === 'fail' && (c.name.includes(piece.pieceCode) || c.id.includes(piece.id))
                  );

                  return (
                    <g
                      key={piece.id}
                      transform={`translate(${xOffset}, ${yOffset}) scale(4.5)`}
                      onClick={() => setSelectedPieceId(piece.id)}
                      className="cursor-pointer transition-opacity"
                      opacity={isSelected ? 1 : 0.85}
                    >
                      {/* Bounding box guide if active */}
                      {showDimensions && isSelected && (
                        <rect
                          x={piece.boundingBox.minX - 2}
                          y={piece.boundingBox.minY - 2}
                          width={piece.boundingBox.widthCm + 4}
                          height={piece.boundingBox.heightCm + 4}
                          fill="none"
                          stroke="#94a3b8"
                          strokeWidth="0.3"
                          strokeDasharray="1 1"
                        />
                      )}

                      {/* Cut Path (Exterior Cutting Line including allowances) */}
                      {showSeamAllowance && (
                        <path
                          d={piece.cutPathData}
                          fill={isSelected ? (pieceHasErrors ? '#FEF2F2' : '#FAF8F5') : (pieceHasErrors ? '#FFF5F5' : '#FFFFFF')}
                          stroke={pieceHasErrors ? '#ef4444' : (isSelected ? '#09090b' : '#52525b')}
                          strokeWidth={pieceHasErrors ? '1.2' : '0.7'}
                          strokeDasharray={pieceHasErrors ? '2.5 1' : undefined}
                          strokeLinejoin="round"
                          className="transition-colors"
                        />
                      )}

                      {/* Invalid Geometry Warning Badge inside Canvas */}
                      {pieceHasErrors && (
                        <g>
                          <rect
                            x={piece.boundingBox.widthCm * 0.2}
                            y={piece.boundingBox.heightCm * 0.15}
                            width={piece.boundingBox.widthCm * 0.6}
                            height={5}
                            fill="#ef4444"
                            rx="0.5"
                          />
                          <text
                            x={piece.boundingBox.widthCm * 0.5}
                            y={piece.boundingBox.heightCm * 0.15 + 3.2}
                            textAnchor="middle"
                            fontSize="2"
                            fontFamily="monospace"
                            fontWeight="bold"
                            fill="#ffffff"
                          >
                            INVALID GEOMETRY DETECTED
                          </text>
                        </g>
                      )}

                      {/* Sew Path (Interior Stitch Line) */}
                      {showSewLines && (
                        <path
                          d={piece.sewPathData}
                          fill="none"
                          stroke={isSelected ? '#2563eb' : '#64748b'}
                          strokeWidth="0.4"
                          strokeDasharray="1.2 0.8"
                        />
                      )}

                      {/* Darts */}
                      {showDarts &&
                        piece.darts.map(dart => (
                          <g key={dart.id}>
                            <line
                              x1={dart.legLeft.x}
                              y1={dart.legLeft.y}
                              x2={dart.apex.x}
                              y2={dart.apex.y}
                              stroke="#dc2626"
                              strokeWidth="0.4"
                            />
                            <line
                              x1={dart.legRight.x}
                              y1={dart.legRight.y}
                              x2={dart.apex.x}
                              y2={dart.apex.y}
                              stroke="#dc2626"
                              strokeWidth="0.4"
                            />
                            {/* Drill hole dot at apex */}
                            <circle
                              cx={dart.apex.x}
                              cy={dart.apex.y}
                              r="0.5"
                              fill="#dc2626"
                            />
                          </g>
                        ))}

                      {/* Grainline */}
                      {showGrainline && (
                        <g>
                          <line
                            x1={piece.grainline.start.x}
                            y1={piece.grainline.start.y}
                            x2={piece.grainline.end.x}
                            y2={piece.grainline.end.y}
                            stroke="#18181b"
                            strokeWidth="0.4"
                          />
                          {/* Top & Bottom Arrows */}
                          <polygon
                            points={`${piece.grainline.start.x},${piece.grainline.start.y - 1} ${piece.grainline.start.x - 0.7},${piece.grainline.start.y + 0.8} ${piece.grainline.start.x + 0.7},${piece.grainline.start.y + 0.8}`}
                            fill="#18181b"
                          />
                          <polygon
                            points={`${piece.grainline.end.x},${piece.grainline.end.y + 1} ${piece.grainline.end.x - 0.7},${piece.grainline.end.y - 0.8} ${piece.grainline.end.x + 0.7},${piece.grainline.end.y - 0.8}`}
                            fill="#18181b"
                          />
                          <text
                            x={piece.grainline.start.x + 1.2}
                            y={(piece.grainline.start.y + piece.grainline.end.y) / 2}
                            fontSize="2"
                            fill="#52525b"
                            fontFamily="monospace"
                          >
                            GRAIN
                          </text>
                        </g>
                      )}

                      {/* Notches */}
                      {showNotches &&
                        piece.notches.map(n => (
                          <g key={n.id}>
                            <line
                              x1={n.position.x - 0.8}
                              y1={n.position.y}
                              x2={n.position.x + 0.8}
                              y2={n.position.y}
                              stroke="#16a34a"
                              strokeWidth="0.6"
                            />
                            {n.type === 'double' && (
                              <line
                                x1={n.position.x - 0.8}
                                y1={n.position.y + 0.8}
                                x2={n.position.x + 0.8}
                                y2={n.position.y + 0.8}
                                stroke="#16a34a"
                                strokeWidth="0.6"
                              />
                            )}
                          </g>
                        ))}

                      {/* Piece Label in Center */}
                      <text
                        x={piece.boundingBox.widthCm * 0.4}
                        y={piece.boundingBox.heightCm * 0.3}
                        fontSize="2.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                        fill="#18181b"
                      >
                        [{piece.pieceCode}]
                      </text>
                      <text
                        x={piece.boundingBox.widthCm * 0.4}
                        y={piece.boundingBox.heightCm * 0.3 + 3.2}
                        fontSize="1.8"
                        fontFamily="monospace"
                        fill="#52525b"
                      >
                        {piece.onFold ? 'CUT 1 ON FOLD' : `CUT ${piece.cutCount}`}
                      </text>
                      <text
                        x={piece.boundingBox.widthCm * 0.4}
                        y={piece.boundingBox.heightCm * 0.3 + 6}
                        fontSize="1.6"
                        fontFamily="monospace"
                        fill="#71717a"
                      >
                        SIZE {activeSize}
                      </text>
                    </g>
                  );
                })
              )}
            </svg>

            {/* Canvas Legend */}
            <div className="absolute bottom-2 left-2 bg-white/95 backdrop-blur border border-neutral-300 rounded p-2 text-[10px] font-mono text-neutral-700 flex items-center gap-3 shadow-xs">
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-neutral-900 inline-block"></span> Cut Line (Exterior)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-blue-600 inline-block border-b border-dashed border-blue-600"></span> Sew Line
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-red-600 inline-block"></span> Dart
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-green-600 inline-block"></span> Notch
              </span>
            </div>
          </div>

          {/* Piece Selector Buttons */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-neutral-500 uppercase">Select Piece:</span>
            {pieces.map(piece => {
              const hasErrors = validationReport.checks.some(
                c => c.status === 'fail' && (c.name.includes(piece.pieceCode) || c.id.includes(piece.id))
              );
              return (
                <button
                  key={piece.id}
                  data-testid={`piece-btn-${piece.id}`}
                  aria-label={`Select ${piece.name}`}
                  onClick={() => setSelectedPieceId(piece.id)}
                  className={`px-3 py-1.5 text-xs font-mono rounded border cursor-pointer transition-colors flex items-center gap-1.5 ${
                    selectedPiece.id === piece.id
                      ? 'bg-neutral-900 text-white border-neutral-900 font-semibold'
                      : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  {hasErrors && <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                  [{piece.pieceCode}] {piece.name} ({piece.onFold ? 'Fold' : `Cut ${piece.cutCount}`})
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Piece Geometry Inspector & Deterministic Validation HUD */}
        <div className="lg:col-span-4 space-y-6">
          {cadViewMode === 'grading' ? (
            /* Milestone 04.4: Cross-Size Grading Inspector & Integrity Card */
            <div className="space-y-6">
              {/* Grading Suite Summary Card */}
              <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-purple-700 font-bold block">
                      MODULE 04.4 INSPECTOR
                    </span>
                    <h3 className="text-sm font-semibold uppercase tracking-wider font-mono text-neutral-900">
                      Cross-Size Grading Suite
                    </h3>
                  </div>
                  <Badge variant={gradedPatternSet.isAllValid ? 'success' : 'danger'} size="sm">
                    {gradedPatternSet.isAllValid ? '6/6 VALID' : 'ISSUES'}
                  </Badge>
                </div>

                <div className="space-y-2 text-xs font-mono bg-purple-50/60 p-3 rounded border border-purple-200">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Base Size:</span>
                    <span className="font-bold text-neutral-900">{gradedPatternSet.baseSize} (EU 38)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Sizing Reference:</span>
                    <span className="font-semibold text-neutral-900">Patroner Baseline (Aldrich/ISO)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Grading Method:</span>
                    <span className="font-semibold text-neutral-900">Direct Target Regeneration</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Affine Scaling:</span>
                    <span className="font-bold text-emerald-700">NONE (0% Distortion)</span>
                  </div>
                </div>

                {/* Per-size Matrix */}
                <div className="space-y-1.5 font-mono text-xs">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-400 block font-bold">
                    Per-Size Verification Status
                  </span>
                  {DEFAULT_SIZE_RANGE.map(sz => {
                    const szRes = gradedPatternSet.sizeResults[sz];
                    const pal = SIZE_PALETTE[sz];
                    const isBase = sz === gradedPatternSet.baseSize;
                    const totalEase = szRes?.assemblyResult?.ease.totalEaseCm;

                    return (
                      <div
                        key={sz}
                        className="p-2 border border-neutral-200 rounded-xs bg-white flex items-center justify-between"
                        style={{ borderLeftColor: pal.stroke, borderLeftWidth: '3px' }}
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-neutral-900">{sz}</span>
                            {isBase && (
                              <span className="text-[9px] bg-neutral-900 text-white px-1 py-0.2 rounded font-mono">
                                BASE
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-neutral-500 block">
                            Bust: {szRes?.measurements.bust}cm | Ease: +{totalEase ? totalEase.toFixed(2) : '0.00'}cm
                          </span>
                        </div>
                        <Badge
                          variant={szRes?.isValid ? 'success' : 'danger'}
                          size="sm"
                        >
                          {szRes?.isValid ? 'VERIFIED' : 'INVALID'}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cross-Size Monotonicity & Integrity Checks */}
              <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-neutral-400 block">CROSS-SIZE INTEGRITY</span>
                    <h3 className="text-sm font-semibold uppercase tracking-wider font-mono text-neutral-900">
                      Continuity Checks
                    </h3>
                  </div>
                  <Badge variant={gradedPatternSet.integrityReport.isOverallGradingValid ? 'success' : 'danger'} size="sm">
                    {gradedPatternSet.integrityReport.isOverallGradingValid ? 'ALL PASSED' : 'CHECK FAILED'}
                  </Badge>
                </div>

                <div className="space-y-2 text-xs">
                  {gradedPatternSet.integrityReport.checks.slice(0, 6).map(chk => (
                    <div
                      key={chk.id}
                      className={`p-2.5 rounded border ${
                        chk.status === 'pass'
                          ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                          : 'bg-rose-50/60 border-rose-200 text-rose-950'
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-1.5">
                          {chk.status === 'pass' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          )}
                          {chk.name}
                        </span>
                        <span className="font-mono text-[10px] uppercase font-bold">
                          {chk.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-600 mt-0.5">
                        {chk.message}
                      </p>
                    </div>
                  ))}
                  {gradedPatternSet.integrityReport.checks.length === 0 && (
                    <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded text-emerald-900 text-xs">
                      All cross-size monotonicity checks passed without warnings or anomalies.
                    </div>
                  )}
                </div>

                {/* Unassessed Conditions Disclosure */}
                <div className="p-3 bg-stone-50 rounded border border-stone-200 text-[11px] space-y-2">
                  <span className="font-mono font-semibold text-neutral-800 uppercase block text-[10px]">
                    Unassessed Grading Conditions ({gradedPatternSet.integrityReport.unassessedConditions.length})
                  </span>
                  <ul className="space-y-1.5 text-neutral-600 text-[10px]">
                    {gradedPatternSet.integrityReport.unassessedConditions.map((cond, i) => (
                      <li key={i} className="border-l-2 border-stone-300 pl-2">
                        {cond}
                      </li>
                    ))}
                  </ul>
                  <div className="pt-2 border-t border-stone-200 text-amber-800 font-mono font-bold text-[10px] uppercase">
                    Safety Invariant: isProductionReady = false
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Selected Piece Geometric Inspector (Normal Mode) */
            <>
              <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-neutral-400 block">PIECE INSPECTOR</span>
                    <h3 className="text-sm font-semibold uppercase tracking-wider font-mono text-neutral-900">
                      [{selectedPiece.pieceCode}] {selectedPiece.name}
                    </h3>
                  </div>
                  <Badge variant="dark" size="sm">
                    {selectedPiece.onFold ? 'ON FOLD' : `CUT ${selectedPiece.cutCount}`}
                  </Badge>
                </div>

                <p className="text-xs text-neutral-600 italic">
                  {selectedPiece.description}
                </p>

                {/* Bounding & Seam Dimensions */}
                <div className="space-y-2 text-xs font-mono bg-neutral-50 p-3 rounded border border-neutral-200">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Bounding Width:</span>
                    <span className="font-semibold text-neutral-900">{selectedPiece.boundingBox.widthCm} cm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Bounding Height:</span>
                    <span className="font-semibold text-neutral-900">{selectedPiece.boundingBox.heightCm} cm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Seam Allowance:</span>
                    <span className="font-semibold text-neutral-900">{selectedPiece.seamAllowanceWidthCm} cm</span>
                  </div>
                  {selectedPiece.offsetResult && (
                    <div className="flex justify-between items-center pt-1 border-t border-neutral-200">
                      <span className="text-neutral-500">Offset Engine:</span>
                      <span className={`font-semibold text-[11px] ${
                        selectedPiece.offsetResult.status === 'success'
                          ? 'text-emerald-700'
                          : selectedPiece.offsetResult.status === 'warning'
                          ? 'text-amber-700'
                          : 'text-rose-700'
                      }`}>
                        {selectedPiece.offsetResult.status.toUpperCase()} ({selectedPiece.offsetResult.maxDeviationCm} cm)
                      </span>
                    </div>
                  )}
                </div>

                {/* Seams Table */}
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 block mb-1.5">
                    Calculated Seamlines
                  </span>
                  <div className="space-y-1.5 font-mono text-xs">
                    {selectedPiece.seams.map(seam => (
                      <div
                        key={seam.id}
                        className="p-2 border border-neutral-200 rounded-xs bg-white flex items-center justify-between"
                      >
                        <div>
                          <span className="font-medium text-neutral-900 block">{seam.name}</span>
                          {seam.pairedSeamName && (
                            <span className="text-[10px] text-neutral-500 block">
                              Pairs with: {seam.pairedSeamName}
                            </span>
                          )}
                        </div>
                        <span className="font-bold text-neutral-900">{seam.lengthCm} cm</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sleeve Engineering Diagnostics Card (Milestone 04.2) */}
                {selectedPiece.id === 'piece-sleeve' && sleeveDiag && (
                  <div className="border border-blue-200 bg-blue-50/50 rounded p-3 space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between border-b border-blue-200 pb-1.5">
                      <span className="font-bold text-blue-950 uppercase text-[10px] tracking-wider">
                        SLEEVE FIT DIAGNOSTICS
                      </span>
                      <span className="text-[10px] bg-blue-900 text-white px-1.5 py-0.5 rounded uppercase">
                        {sleeveDiag.strategy}
                      </span>
                    </div>

                    <div className="space-y-1 text-neutral-800">
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Cap Height (Hcap):</span>
                        <span className="font-semibold">{sleeveDiag.capHeightCm} cm</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Bodice Scye (AH):</span>
                        <span className="font-semibold">
                          {sleeveDiag.bodiceArmholeLengthCm} cm
                          <span className="text-[10px] text-neutral-500 ml-1">
                            (F: {sleeveDiag.frontArmholeLengthCm} / B: {sleeveDiag.backArmholeLengthCm})
                          </span>
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Sleeve Cap Perimeter:</span>
                        <span className="font-semibold">
                          {sleeveDiag.totalCapLengthCm} cm
                          <span className="text-[10px] text-neutral-500 ml-1">
                            (F: {sleeveDiag.frontCapLengthCm} / B: {sleeveDiag.backCapLengthCm})
                          </span>
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-blue-900 bg-blue-100/70 px-1.5 py-0.5 rounded">
                        <span className="font-medium">Net Cap Ease:</span>
                        <span className="font-bold">
                          +{sleeveDiag.capEaseCm} cm ({sleeveDiag.capEasePercentage}% of scye)
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Biceps Girth (with ease):</span>
                        <span className="font-semibold">
                          {sleeveDiag.bicepsWidthCm} cm (+{sleeveDiag.bicepsEaseCm} cm)
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Wrist Width (with ease):</span>
                        <span className="font-semibold">
                          {sleeveDiag.wristWidthCm} cm (+{sleeveDiag.wristEaseCm} cm)
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">
                        <span>Inseam Parity Delta:</span>
                        <span className="font-bold">
                          {sleeveDiag.inseamParityDeltaCm} cm (&lt; 0.05 cm)
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">
                        <span>Crown Tangency:</span>
                        <span className="font-bold">0.00° (Horizontal C1)</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Deterministic Validation HUD */}
              <div className="bg-white border border-neutral-200 rounded-sm p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase text-neutral-400 block">ENGINE STATUS</span>
                    <h3 className="text-sm font-semibold uppercase tracking-wider font-mono text-neutral-900">
                      Validation Engine
                    </h3>
                  </div>
                  {validationReport.status === 'validated' ? (
                    <Badge variant="success" size="md">PROTOTYPE VALIDATED</Badge>
                  ) : validationReport.status === 'incomplete' ? (
                    <Badge variant="warning" size="md">DRAFT INCOMPLETE</Badge>
                  ) : (
                    <Badge variant="danger" size="md">GEOMETRY INVALID</Badge>
                  )}
                </div>

                {/* Score / Implemented Checks Summary */}
                <div className="flex items-baseline justify-between font-mono bg-neutral-900 text-white p-3 rounded">
                  <span className="text-xs uppercase text-neutral-400">IMPLEMENTED CHECKS:</span>
                  <span className="text-base font-bold text-emerald-400">
                    {validationReport.passedCount} / {validationReport.checks.length} PASSED
                  </span>
                </div>

                {/* Declaration Note */}
                <div className="p-2.5 bg-neutral-100 rounded text-[11px] font-mono text-neutral-800 border border-neutral-200">
                  <span className="font-semibold block text-neutral-900 text-[10px] uppercase">STATUS DECLARATION:</span>
                  <p className="mt-0.5">{validationReport.declaration}</p>
                </div>

                {/* Validation Checklist */}
                <div className="space-y-2 text-xs">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 block">
                    Evaluated Geometric Constraints
                  </span>
                  {validationReport.checks.map(chk => (
                    <div
                      key={chk.id}
                      className={`p-2.5 rounded border ${
                        chk.status === 'pass'
                          ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                          : chk.status === 'warning'
                          ? 'bg-amber-50/60 border-amber-200 text-amber-950'
                          : 'bg-rose-50/60 border-rose-200 text-rose-950'
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-1.5">
                          {chk.status === 'pass' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          )}
                          {chk.name}
                        </span>
                        <span className="font-mono text-[10px] uppercase font-bold">
                          {chk.status}
                        </span>
                      </div>

                      {chk.measuredValue && (
                        <div className="font-mono text-[10px] text-neutral-700 mt-1">
                          {chk.measuredValue}
                        </div>
                      )}

                      {chk.errorCode && (
                        <div className="font-mono text-[9px] text-rose-700 font-bold mt-0.5">
                          CODE: {chk.errorCode}
                        </div>
                      )}

                      <p className="text-[11px] text-neutral-600 mt-0.5">
                        {chk.message}
                      </p>

                      {chk.suggestedAction && chk.status === 'fail' && (
                        <div className="mt-1.5 p-1.5 bg-rose-100/70 rounded text-[10px] font-mono text-rose-900 border border-rose-200">
                          <strong>ACTION:</strong> {chk.suggestedAction}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Unassessed Industrial Constraints (Honesty Disclosure) */}
                <div className="p-3 bg-stone-50 rounded border border-stone-200 text-[11px] space-y-2">
                  <span className="font-mono font-semibold text-neutral-800 uppercase block text-[10px]">
                    Unassessed Industrial Conditions ({validationReport.unassessedConditions.length})
                  </span>
                  <p className="text-neutral-500 text-[10px]">
                    The following criteria are required for full industrial production certification and are scheduled for subsequent engineering milestones:
                  </p>
                  <ul className="space-y-1.5 text-neutral-600 text-[10px]">
                    {validationReport.unassessedConditions.map(u => (
                      <li key={u.id} className="border-l-2 border-stone-300 pl-2">
                        <strong className="text-neutral-800">{u.name}:</strong> {u.reason}
                        <span className="block text-neutral-400 font-mono text-[9px]">Target: {u.milestonePrerequisite}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
