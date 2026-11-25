/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { PatternArtifactBundle } from './contracts/pattern-render-artifact';

function useDevArtifactOverrideActive(): PatternArtifactBundle | null {
  const [override, setOverride] = useState<PatternArtifactBundle | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOverride = (event: Event) => {
      const custom = event as CustomEvent<PatternArtifactBundle | null>;
      setOverride(custom.detail ?? null);
    };
    window.addEventListener('patroner:dev-artifact-override', onOverride);
    return () => window.removeEventListener('patroner:dev-artifact-override', onOverride);
  }, []);

  return override;
}

function useDevArtifactOverrideDisabled(): PatternArtifactBundle | null {
  return null;
}

declare const __PATRONER_DEV_ARTIFACT_OVERRIDE__: boolean | undefined;

const IS_DEV_ARTIFACT_OVERRIDE_ENABLED =
  typeof __PATRONER_DEV_ARTIFACT_OVERRIDE__ === 'boolean' &&
  __PATRONER_DEV_ARTIFACT_OVERRIDE__ &&
  import.meta.env.DEV;

/**
 * Development-only non-UI artifact override hook used exclusively for offline
 * Python contract & spatial diagnostic verification in headless Chromium.
 *
 * Because `__PATRONER_DEV_ARTIFACT_OVERRIDE__` is statically replaced with
 * `false` during every `vite build` (even if `NODE_ENV=development` is set in
 * the shell environment), Vite/Rolldown unconditionally dead-code-eliminates
 * `useDevArtifactOverrideActive` and the `patroner:dev-artifact-override`
 * listener from production bundles. Rules of Hooks are preserved because the
 * branch is a compile-time constant.
 */
export const useDevArtifactOverride: () => PatternArtifactBundle | null =
  IS_DEV_ARTIFACT_OVERRIDE_ENABLED
    ? useDevArtifactOverrideActive
    : useDevArtifactOverrideDisabled;
