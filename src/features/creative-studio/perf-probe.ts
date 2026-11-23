/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Profiler, ProfilerOnRenderCallback } from 'react';

export interface StudioPerfSample {
  id: string;
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
  baseDuration: number;
  commitTime: number;
}

declare global {
  // Optional array attached exclusively by automated Playwright performance benchmarks.
  // Remains undefined during normal interactive sessions (zero UI, zero console output).
  // eslint-disable-next-line no-var
  var __PATRONER_PERF_LOG__: StudioPerfSample[] | undefined;
  // eslint-disable-next-line no-var
  var __PATRONER_LAYER_RENDER_COUNT__: number | undefined;
}

export function recordLayerRendererExecution(): void {
  if (typeof globalThis.__PATRONER_LAYER_RENDER_COUNT__ === 'number') {
    globalThis.__PATRONER_LAYER_RENDER_COUNT__ += 1;
  }
}

const handleProfilerRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  _startTime,
  commitTime
) => {
  const log = globalThis.__PATRONER_PERF_LOG__;
  if (!Array.isArray(log)) return;
  log.push({
    id,
    phase,
    actualDuration,
    baseDuration,
    commitTime
  });
};

export const StudioPerfBoundary: React.FC<{ id: string; children: React.ReactNode }> = ({
  id,
  children
}) => {
  return React.createElement(Profiler, { id, onRender: handleProfilerRender }, children);
};
