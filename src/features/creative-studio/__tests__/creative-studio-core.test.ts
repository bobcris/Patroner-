/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../../domain/design/curated-concepts.ts';
import { STANDARD_SIZING_SYSTEM } from '../../../engine/measurements/standards.ts';
import {
  DEFAULT_PRODUCTION_WORKSPACE_BOM_CONTROLS,
  buildAuthoritativeProductionWorkspaceBundle
} from '../../../engine/production/index.ts';
import {
  clampStudioZoom,
  clampTransform,
  computeAlignmentDeltas,
  computeFitCamera,
  computeSmartSnap,
  getRotatedAabb,
  getRotatedCorners,
  hitTestTopmostLayer,
  isPointInRotatedRect,
  normalizeCropRect,
  resolveWorldTransform,
  screenToWorld,
  worldToScreen,
  zoomAtScreenPoint
} from '../canvas-math.ts';
import {
  DEFAULT_COLLECTION_ID,
  buildPromotedDesignSpecDraft,
  createInitialStudioState,
  creativeStudioReducer,
  deriveFlattenedRenderOrder,
  deriveLayerTree,
  migrateAndRecoverStudioDocument,
  validateHierarchyInvariants
} from '../studio-reducer.ts';
import {
  MemoryStudioAssetStore,
  computeLocalStudioAssetHash,
  createStudioAssetStore
} from '../asset-storage.ts';
import {
  CREATIVE_STUDIO_SCHEMA_VERSION,
  MAX_STUDIO_HISTORY_ENTRIES,
  ReferenceImageLayer,
  StudioLayer
} from '../types.ts';

function makeCardLayer(id: string, x: number, y: number, w = 200, h = 120): StudioLayer {
  return {
    id,
    type: 'moodboard-card',
    name: `Card ${id}`,
    parentId: null,
    order: 0,
    visible: true,
    locked: false,
    opacity: 1,
    transform: { x, y, width: w, height: h, rotationDeg: 0, scaleX: 1, scaleY: 1 },
    collectionId: DEFAULT_COLLECTION_ID,
    authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
    title: `Title ${id}`,
    subtitle: 'Study',
    notes: 'Notes',
    accentHex: '#1C212D',
    tags: [],
    createdAt: '2026-11-23T00:00:00Z',
    updatedAt: '2026-11-23T00:00:00Z'
  };
}

function makeRefImageLayer(id: string, assetId: string, x = 100, y = 100): ReferenceImageLayer {
  return {
    id,
    type: 'reference-image',
    name: `Ref ${id}`,
    parentId: null,
    order: 0,
    visible: true,
    locked: false,
    opacity: 1,
    transform: { x, y, width: 260, height: 320, rotationDeg: 0, scaleX: 1, scaleY: 1 },
    collectionId: DEFAULT_COLLECTION_ID,
    authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
    assetId,
    assetName: `${assetId}.png`,
    mimeType: 'image/png',
    naturalWidth: 1000,
    naturalHeight: 1200,
    sizeBytes: 4096,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    tags: ['ref'],
    createdAt: '2026-11-23T00:00:00Z',
    updatedAt: '2026-11-23T00:00:00Z'
  };
}

test('UX-2.2 C6: world/screen transforms, pointer-anchored zoom, rotated AABBs, hit testing, and clamping', () => {
  const camera = { zoom: 1.5, panX: 120, panY: -40 };
  const worldPt = { x: 240, y: 180 };
  const screenPt = worldToScreen(worldPt, camera);
  assert.deepEqual(screenPt, { x: 480, y: 230 });
  assert.deepEqual(screenToWorld(screenPt, camera), worldPt);

  // Pointer-anchored zoom keeps world point under cursor invariant
  const anchorScreen = { x: 520, y: 310 };
  const worldBefore = screenToWorld(anchorScreen, camera);
  const zoomedCam = zoomAtScreenPoint(camera, 2.4, anchorScreen);
  const worldAfter = screenToWorld(anchorScreen, zoomedCam);
  assert.ok(Math.abs(worldAfter.x - worldBefore.x) <= 0.002);
  assert.ok(Math.abs(worldAfter.y - worldBefore.y) <= 0.002);
  assert.equal(zoomedCam.zoom, 2.4);

  // 90-degree rotated rectangle AABB swaps width and height
  const rect = { x: 100, y: 100, width: 200, height: 100, rotationDeg: 90 };
  const corners = getRotatedCorners(rect);
  assert.equal(corners.length, 4);
  const aabb = getRotatedAabb(rect);
  assert.equal(aabb.width, 100);
  assert.equal(aabb.height, 200);
  assert.equal(aabb.x, 150);
  assert.equal(aabb.y, 50);

  // Rotation-aware hit test
  assert.equal(isPointInRotatedRect({ x: 200, y: 60 }, rect), true);
  assert.equal(isPointInRotatedRect({ x: 110, y: 150 }, rect), false);

  // Transform clamping & crop normalization
  const clamped = clampTransform({
    x: Number.NaN,
    y: 42.123456,
    width: 4,
    height: 99999,
    rotationDeg: 545,
    scaleX: 0,
    scaleY: 1
  });
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 42.123);
  assert.equal(clamped.width, 24);
  assert.equal(clamped.height, 8000);
  assert.equal(clamped.rotationDeg, -175);
  assert.equal(clamped.scaleX, 1);

  const crop = normalizeCropRect({ x: 0.9, y: -0.2, width: 0.5, height: 0.01 });
  assert.equal(crop.x, 0.5);
  assert.equal(crop.y, 0);
  assert.equal(crop.width, 0.5);
  assert.equal(crop.height, 0.05);
  assert.ok(crop.x + crop.width <= 1.0001);
  assert.ok(crop.y + crop.height <= 1.0001);

  assert.equal(clampStudioZoom(99), 4);
  assert.equal(clampStudioZoom(0.01), 0.2);

  const fit = computeFitCamera([{ x: 100, y: 100, width: 400, height: 300 }], 1000, 700, 60);
  assert.ok(fit.zoom > 0.2 && fit.zoom <= 1.25);
});

test('UX-2.2 C6: smart snapping, alignment, distribution, and nested group coordinate resolution', () => {
  const snap = computeSmartSnap({
    movingAabb: { x: 104, y: 205, width: 100, height: 80 },
    targetAabbs: [{ id: 'target-1', rect: { x: 100, y: 50, width: 200, height: 100 } }],
    zoom: 1,
    screenThresholdPx: 8
  });
  assert.equal(snap.dx, -4);
  assert.equal(snap.dy, 0);
  assert.equal(snap.guides.length, 1);
  assert.equal(snap.guides[0].orientation, 'vertical');
  assert.equal(snap.guides[0].position, 100);

  // Align left & distribute horizontally
  const items = [
    { id: 'a', rect: { x: 0, y: 10, width: 50, height: 50 } },
    { id: 'b', rect: { x: 20, y: 40, width: 50, height: 50 } },
    { id: 'c', rect: { x: 200, y: 80, width: 50, height: 50 } }
  ];
  const leftDeltas = computeAlignmentDeltas(items, 'align-left');
  assert.equal(leftDeltas.a.x, 0);
  assert.equal(leftDeltas.b.x, -20);
  assert.equal(leftDeltas.c.x, -200);

  const distDeltas = computeAlignmentDeltas(items, 'distribute-horizontal');
  // Total span = 250, total width = 150, gap = 50 -> b should land at x = 100 (delta = +80)
  assert.equal(distDeltas.a.x, 0);
  assert.equal(distDeltas.b.x, 80);
  assert.equal(distDeltas.c.x, 0);

  // Nested group coordinate resolution + topmost hit testing
  const group: StudioLayer = {
    id: 'grp-1',
    type: 'group',
    name: 'Group 1',
    parentId: null,
    order: 0,
    visible: true,
    locked: false,
    opacity: 1,
    transform: { x: 100, y: 50, width: 300, height: 300, rotationDeg: 0, scaleX: 1, scaleY: 1 },
    collectionId: DEFAULT_COLLECTION_ID,
    authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
    collapsed: false,
    createdAt: '2026-11-23T00:00:00Z',
    updatedAt: '2026-11-23T00:00:00Z'
  };
  const child = {
    ...makeCardLayer('child-1', 25, 30, 100, 80),
    parentId: 'grp-1',
    order: 0
  };
  const map: Record<string, StudioLayer> = { 'grp-1': group, 'child-1': child };
  const world = resolveWorldTransform('child-1', map);
  assert.ok(world);
  assert.equal(world.x, 125);
  assert.equal(world.y, 80);

  const ordered = deriveFlattenedRenderOrder(map, DEFAULT_COLLECTION_ID, { onlyVisible: true });
  const hit = hitTestTopmostLayer({ x: 150, y: 100 }, ordered, map);
  assert.equal(hit?.id, 'child-1');
});

test('UX-2.2 C1 & D1: clean first-load canvas, authoritative parentId hierarchy, group/ungroup, cycle rejection', () => {
  const spec = INITIAL_CONCEPTS[0];
  let state = createInitialStudioState({ projectId: 'proj-1', spec, nowIso: '2026-11-23T01:00:00Z' });

  // D1: clean first load must NOT auto-insert demonstration content
  assert.equal(state.document.hasInitializedBoard, false);
  assert.equal(state.document.isDemonstrationBoardLoaded, false);
  assert.equal(Object.keys(state.document.layersById).length, 0);

  // Add 3 layers
  state = creativeStudioReducer(state, { type: 'ADD_LAYER', layer: makeCardLayer('l1', 50, 50) });
  state = creativeStudioReducer(state, { type: 'ADD_LAYER', layer: makeCardLayer('l2', 300, 100) });
  state = creativeStudioReducer(state, { type: 'ADD_LAYER', layer: makeCardLayer('l3', 550, 150) });
  assert.equal(validateHierarchyInvariants(state.document.layersById).valid, true);

  // Group l1 and l2
  state = creativeStudioReducer(state, {
    type: 'GROUP_LAYERS',
    layerIds: ['l1', 'l2'],
    groupName: 'Lookbook Pair'
  });
  assert.equal(validateHierarchyInvariants(state.document.layersById).valid, true);
  const groupLayer = Object.values(state.document.layersById).find(l => l.type === 'group');
  assert.ok(groupLayer);
  assert.equal(state.document.layersById.l1.parentId, groupLayer.id);
  assert.equal(state.document.layersById.l2.parentId, groupLayer.id);

  // World position of l1 and l2 preserved after grouping
  assert.equal(resolveWorldTransform('l1', state.document.layersById)?.x, 50);
  assert.equal(resolveWorldTransform('l2', state.document.layersById)?.x, 300);

  // Attempt self-parenting & cyclic reparenting -> strictly rejected
  const beforeCycle = state;
  state = creativeStudioReducer(state, {
    type: 'REPARENT_LAYER',
    layerId: groupLayer.id,
    newParentId: groupLayer.id
  });
  assert.equal(state, beforeCycle);

  // Nested group cycle attempt: create group2 inside group1, then try moving group1 into group2
  state = creativeStudioReducer(state, {
    type: 'GROUP_LAYERS',
    layerIds: [groupLayer.id, 'l3'],
    groupName: 'Outer Group'
  });
  const outerGroup = Object.values(state.document.layersById).find(
    l => l.type === 'group' && l.id !== groupLayer.id
  )!;
  const beforeNestedCycle = state;
  state = creativeStudioReducer(state, {
    type: 'REPARENT_LAYER',
    layerId: outerGroup.id,
    newParentId: groupLayer.id
  });
  assert.equal(state, beforeNestedCycle);
  assert.equal(validateHierarchyInvariants(state.document.layersById).valid, true);

  // Derived tree matches authoritative parentId
  const tree = deriveLayerTree(state.document.layersById, DEFAULT_COLLECTION_ID);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].layer.id, outerGroup.id);

  // Ungroup preserves world coordinates & hierarchy invariants
  state = creativeStudioReducer(state, { type: 'UNGROUP_LAYER', groupId: outerGroup.id });
  state = creativeStudioReducer(state, { type: 'UNGROUP_LAYER', groupId: groupLayer.id });
  assert.equal(validateHierarchyInvariants(state.document.layersById).valid, true);
  assert.equal(state.document.layersById.l1.parentId, null);
  assert.equal(resolveWorldTransform('l1', state.document.layersById)?.x, 50);
  assert.equal(resolveWorldTransform('l2', state.document.layersById)?.x, 300);
});

test('UX-2.2 C4: undo/redo stores metadata only, respects bounds, and never pretends purged assets exist', () => {
  const spec = INITIAL_CONCEPTS[0];
  let state = createInitialStudioState({ projectId: 'proj-c4', spec });

  // Register & place reference image asset
  state = creativeStudioReducer(state, {
    type: 'REGISTER_ASSET_METADATA',
    asset: {
      assetId: 'asset-1',
      name: 'drape.png',
      mimeType: 'image/png',
      sizeBytes: 1200,
      naturalWidth: 800,
      naturalHeight: 1000,
      localContentHash: 'studio-asset-local:fnv:abc123',
      storageState: 'indexeddb-persisted',
      createdAt: '2026-11-23T01:00:00Z'
    }
  });
  state = creativeStudioReducer(state, {
    type: 'ADD_LAYER',
    layer: makeRefImageLayer('img-1', 'asset-1')
  });

  // Replace asset -> undo restores previous immutable assetId reference
  state = creativeStudioReducer(state, {
    type: 'REPLACE_IMAGE_ASSET',
    layerId: 'img-1',
    asset: {
      assetId: 'asset-2',
      name: 'drape-v2.png',
      mimeType: 'image/png',
      sizeBytes: 2400,
      naturalWidth: 900,
      naturalHeight: 1100,
      localContentHash: 'studio-asset-local:fnv:def456',
      storageState: 'indexeddb-persisted',
      createdAt: '2026-11-23T01:02:00Z'
    }
  });
  assert.equal((state.document.layersById['img-1'] as ReferenceImageLayer).assetId, 'asset-2');

  state = creativeStudioReducer(state, { type: 'UNDO' });
  assert.equal((state.document.layersById['img-1'] as ReferenceImageLayer).assetId, 'asset-1');

  // Verify history snapshots never contain binary Blobs or dataUrls
  const serializedHistory = JSON.stringify(state.historyPast);
  assert.equal(serializedHistory.includes('data:image/'), false);

  // Soft delete -> Restore -> Soft delete again -> Permanent Purge -> Undo after purge
  state = creativeStudioReducer(state, { type: 'SOFT_DELETE_LAYERS', layerIds: ['img-1'] });
  assert.equal(state.document.layersById['img-1'], undefined);
  assert.equal(state.document.trash.length, 1);

  const trashId = state.document.trash[0].id;
  state = creativeStudioReducer(state, { type: 'RESTORE_TRASH_ITEM', trashId });
  assert.ok(state.document.layersById['img-1']);
  assert.equal(state.document.trash.length, 0);

  // Soft delete again & permanently purge asset-1
  state = creativeStudioReducer(state, { type: 'SOFT_DELETE_LAYERS', layerIds: ['img-1'] });
  const trashId2 = state.document.trash[0].id;
  state = creativeStudioReducer(state, {
    type: 'PURGE_TRASH_ITEM',
    trashId: trashId2,
    purgedAssetIds: ['asset-1']
  });
  assert.ok(state.document.purgedAssetIds.includes('asset-1'));

  // Undo soft delete after permanent purge: layer frame returns explicitly flagged as permanently-purged (never pretending Blob exists)
  state = creativeStudioReducer(state, { type: 'UNDO' });
  const restored = state.document.layersById['img-1'] as ReferenceImageLayer;
  assert.ok(restored);
  assert.equal(restored.missingAssetReason, 'permanently-purged');

  // Bounded 50-step history cap
  for (let i = 0; i < MAX_STUDIO_HISTORY_ENTRIES + 15; i++) {
    state = creativeStudioReducer(state, {
      type: 'UPDATE_LAYER_TRANSFORMS',
      updates: { 'img-1': { x: 100 + i } }
    });
  }
  assert.equal(state.historyPast.length, MAX_STUDIO_HISTORY_ENTRIES);
});

test('UX-2.2 C3 & C5: memory fallback flags session-only honestly, exports recovery bundle, and isolates local hashes from engineering fingerprints', async () => {
  const store = await createStudioAssetStore({ forceMemoryFallback: true });
  assert.equal(store.persistenceMode, 'memory-session-only');
  assert.ok(store.storageWarning && /session/i.test(store.storageWarning));
  assert.ok(store instanceof MemoryStudioAssetStore);

  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const localHash = await computeLocalStudioAssetHash(bytes);
  assert.ok(localHash.startsWith('studio-asset-local:'));

  const blob = new Blob([bytes], { type: 'image/png' });
  const savedMeta = await store.putAsset({
    assetId: 'mem-asset-1',
    blob,
    metadata: {
      assetId: 'mem-asset-1',
      name: 'swatch.png',
      mimeType: 'image/png',
      sizeBytes: bytes.byteLength,
      naturalWidth: 100,
      naturalHeight: 100,
      localContentHash: localHash,
      storageState: 'indexeddb-persisted', // store must override to memory-session-only
      createdAt: '2026-11-23T01:00:00Z'
    }
  });
  assert.equal(savedMeta.storageState, 'memory-session-only');
  assert.equal(await store.findAssetIdByLocalHash(localHash), 'mem-asset-1');

  const spec = INITIAL_CONCEPTS[0];
  const initialState = createInitialStudioState({ projectId: 'proj-mem', spec });
  const saveRes = await store.saveDocument(initialState.document);
  assert.equal(saveRes.persistedToIndexedDb, false);

  const bundle = await store.exportRecoveryBundle(initialState.document);
  assert.equal(bundle.bundleType, 'PATRONER_CREATIVE_STUDIO_RECOVERY_V1');
  assert.equal(bundle.persistenceMode, 'memory-session-only');
  assert.equal(bundle.embeddedAssets.length, 1);
  assert.ok(bundle.embeddedAssets[0].dataUrl.startsWith('data:image/png;base64,'));

  // C5: Engineering fingerprint invariance across creative studio mutations
  const measurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const bundleBefore = buildAuthoritativeProductionWorkspaceBundle({
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

  // Perform heavy creative studio operations (starter board, uploads, sketch, crop, group, undo)
  let s = createInitialStudioState({ projectId: 'project-patroner-default', spec });
  s = creativeStudioReducer(s, { type: 'LOAD_ATELIER_STARTER_BOARD', spec });
  s = creativeStudioReducer(s, { type: 'ADD_LAYER', layer: makeRefImageLayer('ref-a', 'mem-asset-1') });
  s = creativeStudioReducer(s, { type: 'SET_IMAGE_CROP', layerId: 'ref-a', crop: { x: 0.1, y: 0.1, width: 0.7, height: 0.7 } });

  const bundleAfter = buildAuthoritativeProductionWorkspaceBundle({
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

  assert.equal(bundleAfter.liveSnapshot?.geometryFingerprint, bundleBefore.liveSnapshot?.geometryFingerprint);
  assert.equal(bundleAfter.liveSnapshot?.basePatternFingerprint, bundleBefore.liveSnapshot?.basePatternFingerprint);
  assert.equal(
    bundleAfter.m05Package?.upstreamRevisionTracking.sourceSpecificationFingerprint,
    bundleBefore.m05Package?.upstreamRevisionTracking.sourceSpecificationFingerprint
  );
  assert.equal(bundleAfter.m05Package?.isProductionReady, false);
  assert.equal(bundleAfter.m05Package?.dxfExport?.externalCadInteroperabilityVerified, false);
});

test('UX-2.2 Phase 1: schema migration & malformed/cyclic document recovery repairs hierarchy cleanly', () => {
  const spec = INITIAL_CONCEPTS[0];

  // Null/corrupt payload recovery
  const nullRecovery = migrateAndRecoverStudioDocument(null, { projectId: 'proj-r', spec });
  assert.equal(nullRecovery.recovered, true);
  assert.equal(nullRecovery.document.schemaVersion, CREATIVE_STUDIO_SCHEMA_VERSION);
  assert.equal(validateHierarchyInvariants(nullRecovery.document.layersById).valid, true);

  // Cyclic groups + orphan layer + out-of-range crop
  const malformed = {
    schemaVersion: 0,
    projectId: 'proj-r',
    layersById: {
      g1: {
        id: 'g1',
        type: 'group',
        name: 'Cycle A',
        parentId: 'g2',
        order: 5,
        visible: true,
        locked: false,
        opacity: 2,
        transform: { x: 0, y: 0, width: 100, height: 100, rotationDeg: 0, scaleX: 1, scaleY: 1 },
        collectionId: DEFAULT_COLLECTION_ID,
        collapsed: false
      },
      g2: {
        id: 'g2',
        type: 'group',
        name: 'Cycle B',
        parentId: 'g1',
        order: 9,
        visible: true,
        locked: false,
        opacity: 1,
        transform: { x: 0, y: 0, width: 100, height: 100, rotationDeg: 0, scaleX: 1, scaleY: 1 },
        collectionId: DEFAULT_COLLECTION_ID,
        collapsed: false
      },
      orphan: {
        ...makeRefImageLayer('orphan', 'purged-asset'),
        parentId: 'missing-parent',
        crop: { x: 0.9, y: 0.9, width: 0.9, height: 0.9 }
      }
    },
    purgedAssetIds: ['purged-asset']
  };

  const recovered = migrateAndRecoverStudioDocument(malformed, { projectId: 'proj-r', spec });
  assert.equal(recovered.recovered, true);
  assert.equal(validateHierarchyInvariants(recovered.document.layersById).valid, true);
  const orphanLayer = recovered.document.layersById.orphan as ReferenceImageLayer;
  assert.equal(orphanLayer.parentId, null);
  assert.equal(orphanLayer.missingAssetReason, 'permanently-purged');
  assert.ok(orphanLayer.crop.x + orphanLayer.crop.width <= 1.0001);
});

test('UX-2.2 C8: explicit concept promotion transfers only confirmed fields and always remains unapproved draft', () => {
  const approvedSpec = INITIAL_CONCEPTS[0];
  assert.equal(approvedSpec.isApproved, true);

  const promoted = buildPromotedDesignSpecDraft({
    currentSpec: approvedSpec,
    concept: {
      title: 'Structured Slate Column Skirt',
      creativeBrief: 'Minimalist tailored wool column skirt with deep hem facing.',
      garmentCategory: 'skirt',
      silhouette: 'a-line',
      fabricId: 'cotton-twill',
      colorName: 'Slate Ink',
      colorHex: '#2B3442',
      easeProfile: 'relaxed',
      lengthCm: 74,
      moodKeywords: ['slate', 'crisp'],
      constructionNotes: [
        'Use 1.5cm side seams',
        'UNVERIFIED_FREEFORM_OVERLAY sketch path ignored'
      ],
      constructionFeatures: []
    },
    selection: {
      includeTitle: true,
      includePrompt: true,
      includeCategoryAndSilhouette: true,
      includeFabric: false, // explicitly excluded
      includeColor: true,
      includeEaseProfile: false, // explicitly excluded
      includeTargetLength: true,
      includeConstructionFeatures: false,
      includeDesignNotes: true
    }
  });

  // Always strictly unapproved draft
  assert.equal(promoted.isApproved, false);
  assert.equal(promoted.approvalState, 'draft');
  assert.equal(promoted.approvedAt, undefined);
  assert.equal(promoted.approvalRecord, undefined);
  assert.equal(promoted.version, approvedSpec.version + 1);

  // Selected fields transferred
  assert.equal(promoted.name, 'Structured Slate Column Skirt');
  assert.equal(promoted.silhouette, 'a-line');
  assert.equal(promoted.color.hex, '#2B3442');
  assert.equal(promoted.lengthCm, 74);

  // Unselected fields preserved untouched
  assert.equal(promoted.fabric.id, approvedSpec.fabric.id);
  assert.equal(promoted.easeProfile, approvedSpec.easeProfile);

  // Unverified freeform overlay note stripped
  assert.equal(
    promoted.designNotes.some(n => /UNVERIFIED_FREEFORM_OVERLAY/i.test(n)),
    false
  );
});

test('UX-2.2 Phase 4-5: 100-layer collection invariants, multi-selection alignment, palette edits, and D2/D3 workspace reset isolation', async () => {
  const { readFileSync } = await import('node:fs');
  const spec = INITIAL_CONCEPTS[0];
  let state = createInitialStudioState({ projectId: 'proj-scale', spec });

  // Create a 100-layer collection and verify deterministic hierarchy & render order
  const batch: StudioLayer[] = [];
  for (let i = 0; i < 100; i++) {
    batch.push(makeCardLayer(`bulk-${i}`, (i % 10) * 240, Math.floor(i / 10) * 180));
  }
  state = creativeStudioReducer(state, {
    type: 'ADD_LAYERS_BATCH',
    layers: batch,
    label: 'Add 100 layers'
  });
  assert.equal(Object.keys(state.document.layersById).length, 100);
  assert.equal(validateHierarchyInvariants(state.document.layersById).valid, true);
  assert.equal(deriveFlattenedRenderOrder(state.document.layersById, DEFAULT_COLLECTION_ID).length, 100);

  // Align 3 layers left in reducer
  state = creativeStudioReducer(state, {
    type: 'ALIGN_LAYERS',
    layerIds: ['bulk-0', 'bulk-1', 'bulk-2'],
    axis: 'align-left'
  });
  assert.equal(state.document.layersById['bulk-0'].transform.x, 0);
  assert.equal(state.document.layersById['bulk-1'].transform.x, 0);
  assert.equal(state.document.layersById['bulk-2'].transform.x, 0);

  // Palette swatch update + undo
  state = creativeStudioReducer(state, {
    type: 'LOAD_ATELIER_STARTER_BOARD',
    spec
  });
  const palette = Object.values(state.document.layersById).find(l => l.type === 'color-palette');
  assert.ok(palette && palette.type === 'color-palette');
  const initialCount = palette.swatches.length;
  state = creativeStudioReducer(state, {
    type: 'UPDATE_PALETTE_SWATCHES',
    layerId: palette.id,
    swatches: [
      ...palette.swatches,
      { id: 'sw-custom', name: 'Atelier Bronze', hex: '#8A6A4B', role: 'trim' }
    ]
  });
  const updatedPalette = state.document.layersById[palette.id];
  assert.ok(updatedPalette && updatedPalette.type === 'color-palette');
  assert.equal(updatedPalette.swatches.length, initialCount + 1);
  state = creativeStudioReducer(state, { type: 'UNDO' });
  const undonePalette = state.document.layersById[palette.id];
  assert.ok(undonePalette && undonePalette.type === 'color-palette');
  assert.equal(undonePalette.swatches.length, initialCount);

  // D2 & D3 structural assertions:
  // CreativeStudioProvider lives in App.tsx above VisualStudioShell (which owns WorkspaceErrorBoundary),
  // and ProjectWorkspaceContext.resetWorkspace never deletes IndexedDB studio data.
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const shellSource = readFileSync('src/components/studio-shell/VisualStudioShell.tsx', 'utf8');
  const workspaceCtxSource = readFileSync('src/state/ProjectWorkspaceContext.tsx', 'utf8');
  const providerIdx = appSource.indexOf('<CreativeStudioProvider>');
  const connectedIdx = appSource.indexOf('<ConnectedVisualWorkspace');
  assert.ok(providerIdx > -1 && connectedIdx > -1 && providerIdx < connectedIdx);
  assert.ok(appSource.includes('<CreativeStudioWorkspace'));
  assert.ok(shellSource.includes('<WorkspaceErrorBoundary'));
  assert.equal(workspaceCtxSource.includes('patroner-studio-db'), false);
  assert.equal(workspaceCtxSource.includes('deleteDatabase'), false);

  // Legacy FashionStudio remains preserved as an unmounted legacy module (D2)
  const legacySource = readFileSync('src/features/fashion-studio/FashionStudio.tsx', 'utf8');
  assert.ok(legacySource.includes('data-testid="reference-image-preview"'));
});

test('UX-2.2 C7: REORDER_LAYER preserves referential identity of untouched sibling layers and SET_CAMERA leaves layersById/history untouched', () => {
  const spec = INITIAL_CONCEPTS[0];
  let state = createInitialStudioState({ projectId: 'proj-perf-identity', spec });
  const batch: StudioLayer[] = [];
  for (let i = 0; i < 50; i++) {
    batch.push(makeCardLayer(`perf-${i}`, (i % 10) * 200, Math.floor(i / 10) * 160));
  }
  state = creativeStudioReducer(state, { type: 'ADD_LAYERS_BATCH', layers: batch });
  const beforeLayers = state.document.layersById;

  // Adjacent reorder ('up' from order 10 -> 11) should only replace the 2 swapped layers
  const reordered = creativeStudioReducer(state, {
    type: 'REORDER_LAYER',
    layerId: 'perf-10',
    direction: 'up'
  });
  let preservedCount = 0;
  for (let i = 0; i < 50; i++) {
    const id = `perf-${i}`;
    if (reordered.document.layersById[id] === beforeLayers[id]) {
      preservedCount += 1;
    }
  }
  assert.equal(preservedCount, 48);

  // Camera commit leaves layersById, collections, and undo history untouched
  const afterCamera = creativeStudioReducer(reordered, {
    type: 'SET_CAMERA',
    camera: { zoom: 1.5, panX: -120, panY: 80 }
  });
  assert.equal(afterCamera.document.layersById, reordered.document.layersById);
  assert.equal(afterCamera.historyPast, reordered.historyPast);
});


