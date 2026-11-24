/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { CadCamera, computeAdaptiveGridSpacingCm, getPixelsPerCm } from './cad-math';
import type {
  CoordinateYAxisDirection,
  GeometryAuthorityTier,
  RenderPoint2D
} from './contracts/pattern-render-artifact';

export interface PatternAtelierStatusBarProps {
  readonly camera: CadCamera;
  readonly cursorCm: RenderPoint2D | null;
  readonly yAxisDirection: CoordinateYAxisDirection;
  readonly authorityTier: GeometryAuthorityTier;
  readonly isProductionReady: boolean;
  readonly selectedPieceLabel?: string | null;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFitAll: () => void;
  readonly onReset100: () => void;
}

export const PatternAtelierStatusBar: React.FC<PatternAtelierStatusBarProps> = React.memo(
  ({
    camera,
    cursorCm,
    yAxisDirection,
    authorityTier,
    isProductionReady,
    selectedPieceLabel,
    onZoomIn,
    onZoomOut,
    onFitAll,
    onReset100
  }) => {
    const pxPerCm = getPixelsPerCm(camera.zoom);
    const gridSpacing = computeAdaptiveGridSpacingCm(camera.zoom);
    const zoomPct = Math.round(camera.zoom * 100);

    const authoritySummary =
      authorityTier === 'C1_PYTHON_CERTIFIED'
        ? 'Python Contract Artifact'
        : authorityTier === 'UNVERIFIED_EXTERNAL_ARTIFACT'
          ? 'Unverified External Artifact'
          : 'C0-Legacy Preview';

    return (
      <div
        data-testid="pattern-atelier-status-bar"
        className="h-7 px-3 bg-[#ECEAE4] border-t border-neutral-300 flex items-center justify-between gap-3 text-[11px] text-neutral-700 shrink-0 select-none overflow-x-auto"
      >
        {/* Left: Live cursor coordinates, true cm scale, grid interval */}
        <div className="flex items-center gap-3 font-mono tabular-nums whitespace-nowrap shrink-0">
          <span data-testid="cad-cursor-readout" className="text-neutral-900 min-w-[144px]">
            {cursorCm
              ? `X ${cursorCm.x.toFixed(1)} cm · Y ${cursorCm.y.toFixed(1)} cm`
              : 'X — · Y — cm'}
          </span>
          <span className="text-neutral-400" aria-hidden="true">|</span>
          <span data-testid="cad-scale-readout" className="text-neutral-600">
            1 cm = {pxPerCm.toFixed(1)} px
          </span>
          <span className="hidden md:inline text-neutral-400" aria-hidden="true">·</span>
          <span className="hidden md:inline text-neutral-600">
            Grid {gridSpacing.minorCm}/{gridSpacing.majorCm} cm
          </span>
          <span className="hidden lg:inline text-neutral-400" aria-hidden="true">·</span>
          <span className="hidden lg:inline text-neutral-600">
            {yAxisDirection === 'cartesian-y-up' ? 'Cartesian Y-Up' : 'SVG Y-Down'}
          </span>
        </div>

        {/* Center: Active selection summary + honest authority disclosure */}
        <div className="hidden sm:flex items-center gap-2 min-w-0 truncate text-neutral-600">
          {selectedPieceLabel && (
            <>
              <span className="hidden lg:inline truncate font-medium text-neutral-800">{selectedPieceLabel}</span>
              <span className="hidden lg:inline text-neutral-400" aria-hidden="true">·</span>
            </>
          )}
          <span
            data-testid="cad-authority-status"
            className={`truncate font-medium ${
              authorityTier === 'C1_PYTHON_CERTIFIED' ? 'text-emerald-800' : 'text-amber-900'
            }`}
            title={`${authoritySummary} · isProductionReady: ${String(isProductionReady)}`}
          >
            {authoritySummary} · isProductionReady: {String(isProductionReady)}
          </span>
        </div>

        {/* Right: Zoom & Fit Controls */}
        <div className="flex items-center gap-1 font-mono tabular-nums whitespace-nowrap shrink-0">
          <button
            type="button"
            onClick={onZoomOut}
            aria-label="Zoom out pattern canvas"
            title="Zoom out"
            className="w-5 h-5 flex items-center justify-center rounded-xs text-neutral-700 hover:bg-neutral-200 hover:text-neutral-950 cursor-pointer"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onReset100}
            aria-label="Reset zoom to 100 percent"
            title="Reset zoom to 100%"
            data-testid="cad-zoom-readout"
            className="px-1.5 h-5 rounded-xs text-[11px] font-semibold text-neutral-900 hover:bg-neutral-200 cursor-pointer min-w-[46px] text-center"
          >
            {zoomPct}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            aria-label="Zoom in pattern canvas"
            title="Zoom in"
            className="w-5 h-5 flex items-center justify-center rounded-xs text-neutral-700 hover:bg-neutral-200 hover:text-neutral-950 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
          </button>
          <span className="text-neutral-400 mx-0.5" aria-hidden="true">|</span>
          <button
            type="button"
            onClick={onFitAll}
            data-testid="cad-fit-all-btn"
            aria-label="Fit all pattern pieces in viewport"
            title="Fit all pieces"
            className="px-1.5 h-5 rounded-xs text-[11px] text-neutral-700 hover:bg-neutral-200 hover:text-neutral-950 flex items-center gap-1 cursor-pointer"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Fit</span>
          </button>
        </div>
      </div>
    );
  }
);

PatternAtelierStatusBar.displayName = 'PatternAtelierStatusBar';
