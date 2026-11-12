import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

/**
 * Explicitly allowlisted hostnames for Vite development server host-header validation (AUDIT-04.6.2.3.5-01).
 *
 * Security rationale:
 * - Never use unrestricted `allowedHosts: true`, which disables DNS-rebinding / host-header protection.
 * - Accepts exact preview hostnames supplied via `VITE_ALLOWED_HOSTS` (comma-separated), `APP_URL`, or `SHARED_APP_URL`.
 * - Preserves the active AI Studio Cloud Run preview hostnames (`ais-dev-...run.app` and `ais-pre-...run.app`).
 * - Scopes dynamic Cloud Run revision hostnames strictly to the `.run.app` domain suffix because Cloud Run
 *   container preview URLs rotate across dynamic service revisions, while rejecting arbitrary external domains.
 */
export function resolveAllowedPreviewHosts(
  env: Record<string, string | undefined> = process.env
): string[] {
  const hosts = new Set<string>([
    'localhost',
    '127.0.0.1',
    'ais-dev-2anxszslqxyctn6qzb56jm-631135174463.europe-west3.run.app',
    'ais-pre-2anxszslqxyctn6qzb56jm-631135174463.europe-west3.run.app',
    // Scoped strictly to Google Cloud Run preview domain suffix (.run.app) to support dynamic container revisions
    '.run.app'
  ]);

  const envHostList = env.VITE_ALLOWED_HOSTS;
  if (typeof envHostList === 'string' && envHostList.trim().length > 0) {
    for (const raw of envHostList.split(',')) {
      const trimmed = raw.trim().toLowerCase();
      if (!trimmed || trimmed === 'true' || trimmed === '*') {
        continue;
      }
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
          const parsed = new URL(trimmed);
          if (parsed.hostname) {
            hosts.add(parsed.hostname.toLowerCase());
          }
        } catch {
          // Ignore malformed URL entry
        }
      } else {
        hosts.add(trimmed);
      }
    }
  }

  for (const urlVar of [env.APP_URL, env.SHARED_APP_URL]) {
    if (typeof urlVar === 'string' && urlVar.trim().length > 0) {
      try {
        const parsed = new URL(urlVar.trim());
        if (parsed.hostname) {
          hosts.add(parsed.hostname.toLowerCase());
        }
      } catch {
        // Ignore malformed URL env var
      }
    }
  }

  return Array.from(hosts);
}

export const ALLOWED_PREVIEW_HOSTS: readonly string[] = Object.freeze(resolveAllowedPreviewHosts());

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: [...ALLOWED_PREVIEW_HOSTS],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

