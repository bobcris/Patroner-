/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  CadCamera,
  clampCadZoom,
  panCadByScreenDelta,
  zoomCadAtScreenPoint
} from './cad-math';
import type { CoordinateYAxisDirection, RenderPoint2D } from './contracts/pattern-render-artifact';
import type { AssemblyScenarioMode } from './AssemblyInspectionPanel';

export type PatternCadViewMode = 'pieces' | 'assembly' | 'grading' | 'fit' | 'simulation';

export interface PatternCadLayerVisibility {
  readonly showSeamAllowance: boolean;
  readonly showSewLines: boolean;
  readonly showGrainline: boolean;
  readonly showNotches: boolean;
  readonly showDarts: boolean;
  readonly showDimensions: boolean;
}

export interface PatternAtelierViewContextValue {
  // Dedicated Pattern Atelier CAD camera (zoom 0.15..12.0, screen-px pan)
  readonly camera: CadCamera;
  readonly setCamera: (next: CadCamera) => void;
  readonly zoomByFactor: (factor: number, anchorScreenPx?: RenderPoint2D, yAxisDirection?: CoordinateYAxisDirection) => void;
  readonly zoomToValue: (targetZoom: number, anchorScreenPx?: RenderPoint2D, yAxisDirection?: CoordinateYAxisDirection) => void;
  readonly panByScreenDelta: (dxPx: number, dyPx: number) => void;
  readonly requestFitAll: () => void;
  readonly fitRequestVersion: number;
  readonly resetCameraTo100: () => void;

  // Live cursor coordinate telemetry in cm (ephemeral UI state only)
  readonly cursorCm: RenderPoint2D | null;
  readonly setCursorCm: (pt: RenderPoint2D | null) => void;

  // View mode & inspection coordination (single source shared with ContextualInspector)
  readonly cadViewMode: PatternCadViewMode;
  readonly setCadViewMode: (mode: PatternCadViewMode) => void;
  readonly assemblyScenario: AssemblyScenarioMode;
  readonly setAssemblyScenario: (scenario: AssemblyScenarioMode) => void;
  readonly selectedPrototypeId: string;
  readonly setSelectedPrototypeId: (id: string) => void;
  readonly enabledGradingSizes: Readonly<Record<string, boolean>>;
  readonly toggleGradingSize: (size: string) => void;

  // Display layer toggles (cut, sew, grain, notches, darts, dimensions)
  readonly layerVisibility: PatternCadLayerVisibility;
  readonly toggleLayerVisibility: (key: keyof PatternCadLayerVisibility) => void;
}

const DEFAULT_CAMERA: CadCamera = { zoom: 1.0, panX: 48, panY: 48 };

const DEFAULT_GRADING_SIZES: Record<string, boolean> = {
  XS: true,
  S: true,
  M: true,
  L: true,
  XL: true,
  XXL: true
};

const DEFAULT_LAYER_VISIBILITY: PatternCadLayerVisibility = {
  showSeamAllowance: true,
  showSewLines: true,
  showGrainline: true,
  showNotches: true,
  showDarts: true,
  showDimensions: true
};

const PatternAtelierViewContext = createContext<PatternAtelierViewContextValue | null>(null);

export const PatternAtelierViewProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [camera, setCameraState] = useState<CadCamera>(DEFAULT_CAMERA);
  const [fitRequestVersion, setFitRequestVersion] = useState<number>(1);
  const [cursorCm, setCursorCm] = useState<RenderPoint2D | null>(null);
  const [cadViewMode, setCadViewMode] = useState<PatternCadViewMode>('pieces');
  const [assemblyScenario, setAssemblyScenario] = useState<AssemblyScenarioMode>('active-draft');
  const [selectedPrototypeId, setSelectedPrototypeId] = useState<string>('PROTO-BOD-2026-M-01');
  const [enabledGradingSizes, setEnabledGradingSizes] =
    useState<Record<string, boolean>>(DEFAULT_GRADING_SIZES);
  const [layerVisibility, setLayerVisibility] =
    useState<PatternCadLayerVisibility>(DEFAULT_LAYER_VISIBILITY);

  const setCamera = useCallback((next: CadCamera) => {
    setCameraState({
      zoom: clampCadZoom(next.zoom),
      panX: Number.isFinite(next.panX) ? next.panX : 0,
      panY: Number.isFinite(next.panY) ? next.panY : 0
    });
  }, []);

  const zoomToValue = useCallback(
    (
      targetZoom: number,
      anchorScreenPx?: RenderPoint2D,
      yAxisDirection: CoordinateYAxisDirection = 'svg-y-down'
    ) => {
      setCameraState(prev => {
        if (anchorScreenPx) {
          return zoomCadAtScreenPoint(prev, targetZoom, anchorScreenPx, { yAxisDirection });
        }
        return { ...prev, zoom: clampCadZoom(targetZoom) };
      });
    },
    []
  );

  const zoomByFactor = useCallback(
    (
      factor: number,
      anchorScreenPx?: RenderPoint2D,
      yAxisDirection: CoordinateYAxisDirection = 'svg-y-down'
    ) => {
      setCameraState(prev => {
        const nextZoom = clampCadZoom(prev.zoom * factor);
        if (anchorScreenPx) {
          return zoomCadAtScreenPoint(prev, nextZoom, anchorScreenPx, { yAxisDirection });
        }
        return { ...prev, zoom: nextZoom };
      });
    },
    []
  );

  const panByScreenDelta = useCallback((dxPx: number, dyPx: number) => {
    setCameraState(prev => panCadByScreenDelta(prev, dxPx, dyPx));
  }, []);

  const requestFitAll = useCallback(() => {
    setFitRequestVersion(v => v + 1);
  }, []);

  const resetCameraTo100 = useCallback(() => {
    setCameraState(DEFAULT_CAMERA);
  }, []);

  const toggleGradingSize = useCallback((size: string) => {
    setEnabledGradingSizes(prev => ({ ...prev, [size]: !prev[size] }));
  }, []);

  const toggleLayerVisibility = useCallback((key: keyof PatternCadLayerVisibility) => {
    setLayerVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const value = useMemo<PatternAtelierViewContextValue>(
    () => ({
      camera,
      setCamera,
      zoomByFactor,
      zoomToValue,
      panByScreenDelta,
      requestFitAll,
      fitRequestVersion,
      resetCameraTo100,
      cursorCm,
      setCursorCm,
      cadViewMode,
      setCadViewMode,
      assemblyScenario,
      setAssemblyScenario,
      selectedPrototypeId,
      setSelectedPrototypeId,
      enabledGradingSizes,
      toggleGradingSize,
      layerVisibility,
      toggleLayerVisibility
    }),
    [
      camera,
      setCamera,
      zoomByFactor,
      zoomToValue,
      panByScreenDelta,
      requestFitAll,
      fitRequestVersion,
      resetCameraTo100,
      cursorCm,
      cadViewMode,
      assemblyScenario,
      selectedPrototypeId,
      enabledGradingSizes,
      toggleGradingSize,
      layerVisibility,
      toggleLayerVisibility
    ]
  );

  return (
    <PatternAtelierViewContext.Provider value={value}>
      {children}
    </PatternAtelierViewContext.Provider>
  );
};

export function useOptionalPatternAtelierView(): PatternAtelierViewContextValue | null {
  return useContext(PatternAtelierViewContext);
}

export function usePatternAtelierView(): PatternAtelierViewContextValue {
  const ctx = useContext(PatternAtelierViewContext);
  if (!ctx) {
    throw new Error('usePatternAtelierView must be used inside a PatternAtelierViewProvider.');
  }
  return ctx;
}
