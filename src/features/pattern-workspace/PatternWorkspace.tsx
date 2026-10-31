/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BodyMeasurements, DesignSpecification, PatternDraft, PatternPiece } from '../../types';
import { draftSkirtBlock } from '../../engine/drafting/skirt-block';
import { validatePatternDraft } from '../../engine/validation/seam-validator';
import { calculateGarmentDimensions } from '../../engine/measurements/standards';
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
  const [selectedPieceId, setSelectedPieceId] = useState<string>('piece-skirt-front');

  // Deterministic draft generation
  const pieces = draftSkirtBlock(measurements, currentSpec);
  const validationReport = validatePatternDraft(pieces);
  const garmentDims = calculateGarmentDimensions(measurements, currentSpec.easeProfile, currentSpec.fabric);

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

      {/* Main CAD Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive CAD Canvas */}
        <div className="lg:col-span-8 flex flex-col space-y-3">
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
            <svg
              viewBox="-30 -30 650 500"
              className="w-full h-[520px] transition-transform duration-75"
              style={{
                transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: 'center center'
              }}
            >
              {/* Scale multiplier: 1cm = 4.5 SVG units */}
              {pieces.map((piece, index) => {
                // Offset each piece side by side for visual clarity
                const xOffset = index === 0 ? 30 : 250;
                const yOffset = 40;
                const isSelected = selectedPiece.id === piece.id;

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
                        fill={isSelected ? '#FAF8F5' : '#FFFFFF'}
                        stroke={isSelected ? '#09090b' : '#52525b'}
                        strokeWidth="0.7"
                        strokeLinejoin="round"
                        className="transition-colors"
                      />
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
              })}
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
            {pieces.map(piece => (
              <button
                key={piece.id}
                data-testid={`piece-btn-${piece.id}`}
                aria-label={`Select ${piece.name}`}
                onClick={() => setSelectedPieceId(piece.id)}
                className={`px-3 py-1.5 text-xs font-mono rounded border cursor-pointer transition-colors ${
                  selectedPiece.id === piece.id
                    ? 'bg-neutral-900 text-white border-neutral-900 font-semibold'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                [{piece.pieceCode}] {piece.name} ({piece.onFold ? 'Fold' : `Cut ${piece.cutCount}`})
              </button>
            ))}
          </div>
        </div>

        {/* Right Column: Piece Geometry Inspector & Deterministic Validation HUD */}
        <div className="lg:col-span-4 space-y-6">
          {/* Selected Piece Geometric Inspector */}
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
              {validationReport.isProductionReady ? (
                <Badge variant="success" size="md">PRODUCTION READY</Badge>
              ) : validationReport.isValid ? (
                <Badge variant="warning" size="md">GEOMETRY VALID</Badge>
              ) : (
                <Badge variant="danger" size="md">VALIDATION FAILED</Badge>
              )}
            </div>

            {/* Score */}
            <div className="flex items-baseline justify-between font-mono bg-neutral-900 text-white p-3 rounded">
              <span className="text-xs uppercase text-neutral-400">ENGINE SCORE:</span>
              <span className="text-lg font-bold">{validationReport.overallScore}/100</span>
            </div>

            {/* Validation Checklist */}
            <div className="space-y-2 text-xs">
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

                  <p className="text-[11px] text-neutral-600 mt-0.5">
                    {chk.message}
                  </p>
                </div>
              ))}
            </div>

            {/* Production readiness declaration */}
            <div className="p-3 bg-neutral-50 rounded border border-neutral-200 text-[11px] text-neutral-600 space-y-1">
              <span className="font-mono font-semibold text-neutral-800 uppercase block">
                Deterministic Guarantee
              </span>
              <p>
                Patroner strictly checks paired seamline lengths and dart leg symmetries. No pattern piece is certified for cutting without passing all engineering thresholds.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
