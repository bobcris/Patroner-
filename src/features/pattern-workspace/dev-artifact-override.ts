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

/**
 * Development-only non-UI artifact override hook used exclusively for offline
 * Python contract & spatial diagnostic verification in headless Chromium.
 *
 * Because `import.meta.env.DEV` is statically replaced with `false` during
 * `vite build`, Vite/Rollup tree-shakes `useDevArtifactOverrideActive` and the
 * `patroner:dev-artifact-override` listener completely out of production bundles.
 * Rules of Hooks are preserved because the branch is a compile-time constant.
 */
export const useDevArtifactOverride: () => PatternArtifactBundle | null = import.meta.env.DEV
  ? useDevArtifactOverrideActive
  : useDevArtifactOverrideDisabled;
