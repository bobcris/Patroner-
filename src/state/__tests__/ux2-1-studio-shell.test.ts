/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ENVIRONMENT_TOOLS,
  MAX_VIEWPORT_HISTORY_ENTRIES,
  clampViewportZoom,
  createInitialViewportState,
  extractSelectedPieceId,
  resolveEnvironmentForWorkspaceTab,
  resolveWorkspaceTabForEnvironment,
  viewportInteractionReducer
} from '../ViewportInteractionContext.tsx';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts.ts';
import { STANDARD_SIZING_SYSTEM } from '../../engine/measurements/standards.ts';
import {
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
  buildAuthoritativeProductionWorkspaceBundle
} from '../../engine/production/index.ts';

test('UX-2.1 A/B: three-environment navigation maps cleanly and preserves project context', () => {
  let state = createInitialViewportState();
  assert.equal(state.activeEnvironment, 'creative-studio');
  assert.equal(state.dockOpen, false);

  state = viewportInteractionReducer(state, {
    type: 'SET_ENVIRONMENT',
    environment: 'pattern-atelier'
  });
  assert.equal(state.activeEnvironment, 'pattern-atelier');

  state = viewportInteractionReducer(state, {
    type: 'SET_ENVIRONMENT',
    environment: 'simulation-production'
  });
  assert.equal(state.activeEnvironment, 'simulation-production');

  assert.equal(resolveWorkspaceTabForEnvironment('creative-studio'), 'studio');
  assert.equal(resolveWorkspaceTabForEnvironment('pattern-atelier'), 'pattern-cad');
  assert.equal(resolveWorkspaceTabForEnvironment('simulation-production'), 'production');
  assert.deepEqual(resolveEnvironmentForWorkspaceTab('specification'), {
    environment: 'pattern-atelier',
    dockOpen: true,
    dockTab: 'tech-spec'
  });
  assert.deepEqual(resolveEnvironmentForWorkspaceTab('measurements'), {
    environment: 'pattern-atelier',
    dockOpen: true,
    dockTab: 'sizing-ease'
  });
});

test('UX-2.1 C: shared selection model represents all six entity kinds and stays synchronized across environments', () => {
  let state = createInitialViewportState({ initialEnvironment: 'pattern-atelier' });

  // 1. Pattern piece selected in Pattern Atelier
  state = viewportInteractionReducer(state, {
    type: 'SELECT_ENTITY',
    entity: {
      kind: 'pattern-piece',
      id: 'piece-skirt-front',
      pieceId: 'piece-skirt-front',
      pieceCode: 'SK-F',
      label: 'Front Skirt Panel'
    }
  });
  assert.equal(extractSelectedPieceId(state.selectedEntity), 'piece-skirt-front');

  // Switch to 3D Simulation & Production — selection remains synchronized
  state = viewportInteractionReducer(state, {
    type: 'SET_ENVIRONMENT',
    environment: 'simulation-production'
  });
  assert.equal(state.selectedEntity?.kind, 'pattern-piece');
  assert.equal(extractSelectedPieceId(state.selectedEntity), 'piece-skirt-front');

  // 2. Seam entity retains parent pieceId
  state = viewportInteractionReducer(state, {
    type: 'SELECT_ENTITY',
    entity: {
      kind: 'seam',
      id: 'piece-skirt-front:side-seam',
      pieceId: 'piece-skirt-front',
      seamId: 'side-seam',
      label: 'Front Skirt · Side Seam',
      lengthCm: 68
    }
  });
  assert.equal(extractSelectedPieceId(state.selectedEntity), 'piece-skirt-front');

  // 3. Reference image, 4. Garment element, 5. Simulation entity, 6. Production entity
  for (const entity of [
    {
      kind: 'reference-image' as const,
      id: 'ref:drape.png',
      label: 'drape.png',
      name: 'drape.png',
      sizeBytes: 120000
    },
    {
      kind: 'garment-element' as const,
      id: 'garment:skirt-1',
      label: 'Minimalist Wool Skirt',
      category: 'skirt',
      silhouette: 'straight',
      pieceId: 'piece-skirt-front'
    },
    {
      kind: 'simulation-entity' as const,
      id: 'sim:skirt-1',
      pieceId: 'piece-skirt-front',
      label: 'Prototype Drape',
      prototypeMode: 'prototype-drape' as const
    },
    {
      kind: 'production-entity' as const,
      id: 'prod:skirt-1',
      pieceId: 'piece-skirt-front',
      label: 'Production Gate',
      artifactType: 'validation-gate' as const
    }
  ]) {
    state = viewportInteractionReducer(state, { type: 'SELECT_ENTITY', entity });
    assert.equal(state.selectedEntity?.kind, entity.kind);
    assert.equal(state.selectedEntity?.id, entity.id);
  }
});

test('UX-2.1 D: ephemeral viewport state mutations never alter canonical engineering hashes or production readiness', () => {
  const spec = INITIAL_CONCEPTS[0];
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;

  const beforeBundle = buildAuthoritativeProductionWorkspaceBundle({
    projectId: 'project-patroner-default',
    tenantId: 'tenant-studio-local',
    designSpec: spec,
    measurements,
    activeSize: 'M',
    bomControls: { ...DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS },
    governance: {
      bodiceDartStyle: 'waist',
      sleeveEaseStrategy: 'classic',
      strictUncertaintyGate: true,
      requireApprovedGovernance: false,
      measurementProvenance: 'standard-chart',
      measurementApprovalState: 'unverified'
    }
  });

  // Exercise extensive ephemeral viewport actions: env switch, selection, zoom/pan/orbit, overlays, undo/redo
  let vp = createInitialViewportState();
  vp = viewportInteractionReducer(vp, { type: 'SET_ENVIRONMENT', environment: 'pattern-atelier' });
  vp = viewportInteractionReducer(vp, {
    type: 'UPDATE_CAMERA',
    patch: { zoom: 1.75, panX: 42, panY: -18, orbitYawDeg: 95, showGrid: false }
  });
  vp = viewportInteractionReducer(vp, { type: 'ADD_EPHEMERAL_OVERLAY', label: 'Check dart tip' });
  vp = viewportInteractionReducer(vp, { type: 'UNDO' });
  vp = viewportInteractionReducer(vp, { type: 'REDO' });
  assert.equal(vp.ephemeralOverlays.length, 1);
  assert.equal(vp.ephemeralOverlays[0].verificationStatus, 'UNVERIFIED_FREEFORM_OVERLAY');

  const afterBundle = buildAuthoritativeProductionWorkspaceBundle({
    projectId: 'project-patroner-default',
    tenantId: 'tenant-studio-local',
    designSpec: spec,
    measurements,
    activeSize: 'M',
    bomControls: { ...DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS },
    governance: {
      bodiceDartStyle: 'waist',
      sleeveEaseStrategy: 'classic',
      strictUncertaintyGate: true,
      requireApprovedGovernance: false,
      measurementProvenance: 'standard-chart',
      measurementApprovalState: 'unverified'
    }
  });

  assert.ok(beforeBundle.liveSnapshot?.geometryFingerprint, 'geometryFingerprint must be present');
  assert.ok(beforeBundle.liveSnapshot?.basePatternFingerprint, 'basePatternFingerprint must be present');
  assert.equal(
    afterBundle.liveSnapshot?.geometryFingerprint,
    beforeBundle.liveSnapshot?.geometryFingerprint
  );
  assert.equal(
    afterBundle.liveSnapshot?.basePatternFingerprint,
    beforeBundle.liveSnapshot?.basePatternFingerprint
  );
  assert.equal(
    afterBundle.liveSnapshot?.draftingConfigFingerprint,
    beforeBundle.liveSnapshot?.draftingConfigFingerprint
  );
  assert.equal(
    afterBundle.liveSnapshot?.revisionId,
    beforeBundle.liveSnapshot?.revisionId
  );
  assert.equal(
    afterBundle.m05Package?.upstreamRevisionTracking.sourceSpecificationFingerprint,
    beforeBundle.m05Package?.upstreamRevisionTracking.sourceSpecificationFingerprint
  );
  assert.equal(
    afterBundle.m05Package?.upstreamRevisionTracking.bomFingerprint,
    beforeBundle.m05Package?.upstreamRevisionTracking.bomFingerprint
  );
  assert.equal(afterBundle.m05Package?.isProductionReady, false);
  assert.equal(afterBundle.m05Package?.dxfExport?.externalCadInteroperabilityVerified, false);
});

test('UX-2.1 F: deterministic ephemeral undo/redo history respects bounds, clears redo on branch, and stays pure', () => {
  let state = createInitialViewportState();
  assert.equal(state.historyPast.length, 0);
  assert.equal(state.historyFuture.length, 0);

  state = viewportInteractionReducer(state, { type: 'ADD_EPHEMERAL_OVERLAY', label: 'Pin 1' });
  state = viewportInteractionReducer(state, { type: 'UPDATE_CAMERA', patch: { zoom: 1.3 } });
  state = viewportInteractionReducer(state, { type: 'ADD_EPHEMERAL_OVERLAY', label: 'Pin 2' });
  assert.equal(state.ephemeralOverlays.length, 2);
  assert.equal(state.camera.zoom, 1.3);
  assert.equal(state.historyPast.length, 3);

  // Undo Pin 2
  state = viewportInteractionReducer(state, { type: 'UNDO' });
  assert.equal(state.ephemeralOverlays.length, 1);
  assert.equal(state.historyFuture.length, 1);

  // Undo Zoom
  state = viewportInteractionReducer(state, { type: 'UNDO' });
  assert.equal(state.camera.zoom, 1.0);
  assert.equal(state.historyFuture.length, 2);

  // Redo Zoom
  state = viewportInteractionReducer(state, { type: 'REDO' });
  assert.equal(state.camera.zoom, 1.3);
  assert.equal(state.historyFuture.length, 1);

  // New action clears redo branch
  state = viewportInteractionReducer(state, { type: 'SET_ACTIVE_TOOL', tool: 'pan', environment: 'pattern-atelier' });
  assert.equal(state.historyFuture.length, 0);

  // Enforce bounded stack cap
  for (let i = 0; i < MAX_VIEWPORT_HISTORY_ENTRIES + 12; i++) {
    state = viewportInteractionReducer(state, {
      type: 'UPDATE_CAMERA',
      patch: { panX: i + 1 }
    });
  }
  assert.equal(state.historyPast.length, MAX_VIEWPORT_HISTORY_ENTRIES);
  assert.equal(clampViewportZoom(Number.NaN), 1.0);
  assert.equal(clampViewportZoom(99), 2.5);
  assert.equal(clampViewportZoom(-2), 0.4);
});

test('UX-2.1 A/E/G: shell uses 100dvh+100vh fallback, keeps single ProductionPackagePanel mount, and hides raw hashes from designer inspector', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf-8');
  assert.match(css, /height:\s*100vh;\s*\n\s*height:\s*100dvh;/);

  const shellSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/studio-shell/VisualStudioShell.tsx'),
    'utf-8'
  );
  const inspectorSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/studio-shell/ContextualInspector.tsx'),
    'utf-8'
  );
  const dockSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/studio-shell/CollapsibleBottomDock.tsx'),
    'utf-8'
  );

  // Single authoritative ProductionPackagePanel mount remains exclusively in ProductionOverview
  assert.equal(shellSrc.includes('<ProductionPackagePanel'), false);
  assert.equal(inspectorSrc.includes('<ProductionPackagePanel'), false);
  assert.equal(dockSrc.includes('<ProductionPackagePanel'), false);

  // Designer-facing inspector must not expose internal SHA-256 digests in rendered markup/code
  const inspectorCodeOnly = inspectorSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/canonicalContentDigest|sha256|SHA-256/.test(inspectorCodeOnly), false);

  // Honest engineering disclosures remain present
  assert.match(shellSrc, /C0-Legacy TypeScript Prototype Geometry/);
  assert.match(shellSrc, /Physical AC-09 Validation Pending/);
  assert.match(shellSrc, /isProductionReady: false/);

  // Every unavailable tool explicitly declares an unavailableReason
  for (const env of Object.keys(ENVIRONMENT_TOOLS) as Array<keyof typeof ENVIRONMENT_TOOLS>) {
    for (const tool of ENVIRONMENT_TOOLS[env]) {
      if (!tool.available) {
        assert.ok(tool.unavailableReason && tool.unavailableReason.length > 0);
      }
    }
  }
});
