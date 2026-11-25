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
import type { SnapConfig } from './board-arrangement';
import {
  useOptionalPatternAtelierCamera,
  useOptionalPatternAtelierCursor
} from './PatternAtelierViewContext';

const FALLBACK_STATUS_CAMERA: CadCamera = { zoom: 1, panX: 0, panY: 0 };

export interface PatternAtelierStatusBarProps {
  readonly camera?: CadCamera;
  readonly cursorCm?: RenderPoint2D | null;
  readonly yAxisDirection: CoordinateYAxisDirection;
  readonly authorityTier: GeometryAuthorityTier;
  readonly isProductionReady: boolean;
  readonly selectedPieceLabel?: string | null;
  readonly selectedPieceCount?: number;
  readonly snapConfig?: SnapConfig;
  readonly activeSnapCount?: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFitAll: () => void;
  readonly onReset100: () => void;
}

const CadCursorReadout: React.FC<{ readonly fallbackCursorCm?: RenderPoint2D | null }> = React.memo(
  ({ fallbackCursorCm }) => {
    const contextCursorCm = useOptionalPatternAtelierCursor();
    const effective = contextCursorCm ?? fallbackCursorCm ?? null;
    return (
      <span data-testid="cad-cursor-readout" className="text-neutral-900 min-w-[140px]">
        {effective
          ? `X ${effective.x.toFixed(1)} cm · Y ${effective.y.toFixed(1)} cm`
          : 'X — · Y — cm'}
      </span>
    );
  }
);

CadCursorReadout.displayName = 'CadCursorReadout';

const CadScaleAndGridReadout: React.FC<{ readonly fallbackCamera?: CadCamera }> = React.memo(
  ({ fallbackCamera }) => {
    const contextCamera = useOptionalPatternAtelierCamera();
    const zoom = (contextCamera ?? fallbackCamera ?? FALLBACK_STATUS_CAMERA).zoom;
    const pxPerCm = getPixelsPerCm(zoom);
    const gridSpacing = computeAdaptiveGridSpacingCm(zoom);
    return (
      <>
        <span data-testid="cad-scale-readout" className="text-neutral-600">
          1 cm = {pxPerCm.toFixed(1)} px
        </span>
        <span className="hidden md:inline text-neutral-400" aria-hidden="true">·</span>
        <span className="hidden md:inline text-neutral-600">
          Grid {gridSpacing.minorCm}/{gridSpacing.majorCm} cm
        </span>
      </>
    );
  }
);

CadScaleAndGridReadout.displayName = 'CadScaleAndGridReadout';

const CadZoomPercentButton: React.FC<{
  readonly fallbackCamera?: CadCamera;
  readonly onReset100: () => void;
}> = React.memo(({ fallbackCamera, onReset100 }) => {
  const contextCamera = useOptionalPatternAtelierCamera();
  const zoom = (contextCamera ?? fallbackCamera ?? FALLBACK_STATUS_CAMERA).zoom;
  const zoomPct = Math.round(zoom * 100);
  return (
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
  );
});

CadZoomPercentButton.displayName = 'CadZoomPercentButton';

export const PatternAtelierStatusBar: React.FC<PatternAtelierStatusBarProps> = React.memo(
  ({
    camera,
    cursorCm,
    yAxisDirection,
    authorityTier,
    isProductionReady,
    selectedPieceLabel,
    selectedPieceCount = 0,
    snapConfig,
    activeSnapCount = 0,
    onZoomIn,
    onZoomOut,
    onFitAll,
    onReset100
  }) => {

    const authoritySummary =
      authorityTier === 'C1_PYTHON_CERTIFIED'
        ? 'Python Contract Artifact'
        : authorityTier === 'UNVERIFIED_EXTERNAL_ARTIFACT'
          ? 'Unverified External Artifact'
          : 'C0-Legacy Preview';

    const selectionSummary =
      selectedPieceCount >= 2 ? `${selectedPieceCount} pieces selected` : selectedPieceLabel;

    return (
      <div
        data-testid="pattern-atelier-status-bar"
        className="h-7 px-3 bg-[#ECEAE4] border-t border-neutral-300 flex items-center justify-between gap-3 text-[11px] text-neutral-700 shrink-0 select-none overflow-x-auto"
      >
        {/* Left: Live cursor coordinates, true cm scale, grid interval, snap readout */}
        <div className="flex items-center gap-2.5 font-mono tabular-nums whitespace-nowrap shrink-0">
          <CadCursorReadout fallbackCursorCm={cursorCm} />
          <span className="text-neutral-400" aria-hidden="true">|</span>
          <CadScaleAndGridReadout fallbackCamera={camera} />
          {snapConfig && (
            <>
              <span className="hidden lg:inline text-neutral-400" aria-hidden="true">·</span>
              <span
                data-testid="cad-snap-readout"
                className={`hidden lg:inline ${
                  activeSnapCount > 0
                    ? 'text-blue-700 font-semibold'
                    : snapConfig.enabled
                      ? 'text-neutral-700'
                      : 'text-neutral-400'
                }`}
              >
                {activeSnapCount > 0
                  ? `Snapped (${snapConfig.gridIntervalCm} cm)`
                  : snapConfig.enabled
                    ? `Snap ${snapConfig.gridIntervalCm} cm`
                    : 'Snap Off'}
              </span>
            </>
          )}
          <span className="hidden xl:inline text-neutral-400" aria-hidden="true">·</span>
          <span className="hidden xl:inline text-neutral-600">
            {yAxisDirection === 'cartesian-y-up' ? 'Cartesian Y-Up' : 'SVG Y-Down'}
          </span>
        </div>

        {/* Center: Active selection summary + honest authority disclosure */}
        <div className="hidden sm:flex items-center gap-2 min-w-0 truncate text-neutral-600">
          {selectionSummary && (
            <>
              <span className="hidden lg:inline truncate font-medium text-neutral-800">
                {selectionSummary}
              </span>
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
          <CadZoomPercentButton fallbackCamera={camera} onReset100={onReset100} />
          <button
            type="button"
            onClick={onZoomIn}
            aria-label="Zoom in pattern canvas"
            title="Zoom in"
            className="w-5 h-5 flex items-center justify-center rounded-xs text-neutral-700 hover:bg-neutral-200 hover:text-neutral-950 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
          </button>
          <span className="text-neutral-300 mx-0.5" aria-hidden="true">|</span>
          <button
            type="button"
            onClick={onFitAll}
            data-testid="cad-fit-all-btn"
            aria-label="Fit all pattern pieces in viewport"
            title="Fit All pieces to viewport"
            className="px-1.5 h-5 rounded-xs text-[11px] font-medium text-neutral-800 hover:bg-neutral-200 inline-flex items-center gap-1 cursor-pointer"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Fit</span>
          </button>
        </div>
      </div>
    );
  }
);
