/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DesignSpecification } from '../../types';
import { PRESET_FABRICS } from '../../domain/design/preset-fabrics';
import {
  AiConceptCandidate,
  AlignmentAxis,
  CREATIVE_STUDIO_SCHEMA_VERSION,
  CreativeStudioDocument,
  CreativeStudioDocumentSnapshot,
  CreativeStudioState,
  DerivedLayerTreeNode,
  GroupLayer,
  HierarchyValidationResult,
  LayerTransform,
  MAX_STUDIO_HISTORY_ENTRIES,
  NormalizedCropRect,
  PaletteSwatch,
  PromotionFieldSelection,
  ReferenceImageLayer,
  SketchStroke,
  StructuredConceptAttributes,
  StudioAssetMetadata,
  StudioCanvasCamera,
  StudioCollection,
  StudioHistoryEntry,
  StudioLayer,
  StudioTrashItem
} from './types';
import {
  clampOpacity,
  clampStudioZoom,
  clampTransform,
  computeAlignmentDeltas,
  getRotatedAabb,
  getUnionRect,
  normalizeCropRect,
  resolveWorldTransform,
  roundCoord,
  worldDeltaToParentLocalDelta
} from './canvas-math';

/**
 * Pure deterministic reducer, hierarchy validator (C1), history manager (C4),
 * schema migration/recovery engine, and concept promotion builder (C8).
 */

export const DEFAULT_COLLECTION_ID = 'col-main-board';

export function createDefaultConceptFromSpec(spec: DesignSpecification): StructuredConceptAttributes {
  return {
    title: spec.name,
    creativeBrief: spec.prompt,
    garmentCategory: spec.garmentCategory,
    silhouette: spec.silhouette,
    fabricId: spec.fabric.id,
    colorName: spec.color.name,
    colorHex: spec.color.hex,
    easeProfile: spec.easeProfile,
    lengthCm: spec.lengthCm,
    moodKeywords: ['architectural', 'tailored', spec.fabric.weight],
    constructionNotes: [...spec.designNotes],
    constructionFeatures: spec.constructionFeatures.map(f => ({ ...f }))
  };
}

/**
 * Creates a clean first-load Creative Studio document (Owner Decision D1).
 * Never auto-inserts demonstration content on first load.
 */
export function createCleanStudioDocument(options: {
  projectId: string;
  spec: DesignSpecification;
  nowIso?: string;
}): CreativeStudioDocument {
  const now = options.nowIso ?? new Date().toISOString();
  return {
    schemaVersion: CREATIVE_STUDIO_SCHEMA_VERSION,
    projectId: options.projectId,
    updatedAt: now,
    hasInitializedBoard: false,
    isDemonstrationBoardLoaded: false,
    layersById: {},
    collections: [
      {
        id: DEFAULT_COLLECTION_ID,
        name: 'Main Moodboard',
        description: 'Primary visual direction and reference collection',
        createdAt: now
      }
    ],
    activeCollectionId: DEFAULT_COLLECTION_ID,
    assetsById: {},
    purgedAssetIds: [],
    trash: [],
    concept: createDefaultConceptFromSpec(options.spec),
    aiCandidates: [],
    selectedCandidateId: null,
    camera: {
      zoom: 1,
      panX: 48,
      panY: 48
    },
    nextSequence: 1
  };
}

export function createInitialStudioState(options: {
  projectId: string;
  spec: DesignSpecification;
  nowIso?: string;
}): CreativeStudioState {
  return {
    document: createCleanStudioDocument(options),
    historyPast: [],
    historyFuture: []
  };
}

/**
 * C1 — Validates single-parent hierarchy invariants across all layers.
 * Enforces: no self-parenting, no orphans, no non-group parents, no cycles, deterministic sibling ordering.
 */
export function validateHierarchyInvariants(
  layersById: Record<string, StudioLayer>
): HierarchyValidationResult {
  const errors: string[] = [];
  const entries = Object.entries(layersById);

  for (const [key, layer] of entries) {
    if (key !== layer.id) {
      errors.push(`Key mismatch: map key "${key}" != layer.id "${layer.id}".`);
    }
    if (layer.parentId === layer.id) {
      errors.push(`Self-parenting detected on layer "${layer.id}".`);
    }
    if (layer.parentId !== null) {
      const parent = layersById[layer.parentId];
      if (!parent) {
        errors.push(`Orphan layer "${layer.id}" references missing parent "${layer.parentId}".`);
      } else if (parent.type !== 'group') {
        errors.push(`Layer "${layer.id}" references non-group parent "${layer.parentId}" (${parent.type}).`);
      } else if (parent.collectionId !== layer.collectionId) {
        errors.push(`Layer "${layer.id}" collection "${layer.collectionId}" differs from parent "${parent.id}" collection "${parent.collectionId}".`);
      }
    }

    // Cycle check
    const visited = new Set<string>([layer.id]);
    let cursor = layer.parentId;
    while (cursor !== null) {
      if (visited.has(cursor)) {
        errors.push(`Cyclic group hierarchy detected involving "${layer.id}" -> "${cursor}".`);
        break;
      }
      visited.add(cursor);
      const nextParent = layersById[cursor];
      if (!nextParent) break;
      cursor = nextParent.parentId;
    }
  }

  // Deterministic sibling ordering check per (collectionId, parentId)
  const siblingBuckets = new Map<string, StudioLayer[]>();
  for (const layer of Object.values(layersById)) {
    const bucketKey = `${layer.collectionId}::${layer.parentId ?? 'ROOT'}`;
    const list = siblingBuckets.get(bucketKey) ?? [];
    list.push(layer);
    siblingBuckets.set(bucketKey, list);
  }
  for (const [bucketKey, siblings] of siblingBuckets.entries()) {
    const orders = siblings.map(s => s.order).sort((a, b) => a - b);
    for (let i = 0; i < orders.length; i++) {
      if (orders[i] !== i) {
        errors.push(`Non-contiguous sibling order in bucket "${bucketKey}": expected ${i}, got ${orders[i]}.`);
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Normalizes sibling order integers (0..n-1) per (collectionId, parentId) deterministically.
 */
export function normalizeSiblingOrders(
  layersById: Record<string, StudioLayer>
): Record<string, StudioLayer> {
  const buckets = new Map<string, StudioLayer[]>();
  for (const layer of Object.values(layersById)) {
    const key = `${layer.collectionId}::${layer.parentId ?? 'ROOT'}`;
    const list = buckets.get(key) ?? [];
    list.push(layer);
    buckets.set(key, list);
  }

  const next: Record<string, StudioLayer> = {};
  for (const siblings of buckets.values()) {
    siblings.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id.localeCompare(b.id)));
    siblings.forEach((layer, idx) => {
      next[layer.id] = layer.order === idx ? layer : { ...layer, order: idx };
    });
  }
  return next;
}

/**
 * Checks whether candidateAncestorId is the same as or an ancestor of nodeId.
 */
export function isAncestorOrSelf(
  candidateAncestorId: string,
  nodeId: string,
  layersById: Record<string, StudioLayer>
): boolean {
  let cursor: string | null = nodeId;
  const visited = new Set<string>();
  while (cursor !== null && !visited.has(cursor)) {
    if (cursor === candidateAncestorId) return true;
    visited.add(cursor);
    cursor = layersById[cursor]?.parentId ?? null;
  }
  return false;
}

/**
 * Collects a layer and all its recursive descendants in deterministic preorder.
 */
export function collectSubtreeIds(
  rootId: string,
  layersById: Record<string, StudioLayer>
): string[] {
  if (!layersById[rootId]) return [];
  const result: string[] = [rootId];
  const children = Object.values(layersById)
    .filter(l => l.parentId === rootId)
    .sort((a, b) => a.order - b.order);
  for (const child of children) {
    result.push(...collectSubtreeIds(child.id, layersById));
  }
  return result;
}

/**
 * C1 — Derives the hierarchical layer tree strictly from the single authoritative parentId link.
 * Returns children sorted top-to-bottom (highest order first) for UI layers panel display,
 * or bottom-to-top when reverseForUi=false.
 */
export function deriveLayerTree(
  layersById: Record<string, StudioLayer>,
  collectionId: string,
  options?: { topFirst?: boolean }
): DerivedLayerTreeNode[] {
  const topFirst = options?.topFirst ?? true;
  const collectionLayers = Object.values(layersById).filter(l => l.collectionId === collectionId);

  const byParent = new Map<string | null, StudioLayer[]>();
  for (const layer of collectionLayers) {
    const list = byParent.get(layer.parentId) ?? [];
    list.push(layer);
    byParent.set(layer.parentId, list);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => (topFirst ? b.order - a.order : a.order - b.order));
  }

  const build = (parentId: string | null, depth: number, visited: Set<string>): DerivedLayerTreeNode[] => {
    const siblings = byParent.get(parentId) ?? [];
    const nodes: DerivedLayerTreeNode[] = [];
    for (const layer of siblings) {
      if (visited.has(layer.id)) continue;
      visited.add(layer.id);
      nodes.push({
        layer,
        depth,
        children: layer.type === 'group' ? build(layer.id, depth + 1, visited) : []
      });
    }
    return nodes;
  };

  return build(null, 0, new Set<string>());
}

/**
 * Derives deterministic bottom-to-top paint order for a collection.
 * Respects ancestor visibility: if a group is hidden, its descendants are excluded when onlyVisible=true.
 */
export function deriveFlattenedRenderOrder(
  layersById: Record<string, StudioLayer>,
  collectionId: string,
  options?: { onlyVisible?: boolean }
): StudioLayer[] {
  const onlyVisible = options?.onlyVisible ?? false;
  const roots = deriveLayerTree(layersById, collectionId, { topFirst: false });
  const ordered: StudioLayer[] = [];

  const walk = (nodes: DerivedLayerTreeNode[], parentVisible: boolean) => {
    for (const node of nodes) {
      const effectiveVisible = parentVisible && node.layer.visible;
      if (onlyVisible && !effectiveVisible) continue;
      ordered.push(node.layer);
      if (node.children.length > 0) {
        walk(node.children, effectiveVisible);
      }
    }
  };
  walk(roots, true);
  return ordered;
}

/**
 * Checks if a layer or any of its ancestors is locked or hidden.
 */
export function isLayerEffectivelyLocked(
  layerId: string,
  layersById: Record<string, StudioLayer>
): boolean {
  let cursor: StudioLayer | undefined = layersById[layerId];
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    if (cursor.locked) return true;
    visited.add(cursor.id);
    cursor = cursor.parentId ? layersById[cursor.parentId] : undefined;
  }
  return false;
}

function captureDocumentSnapshot(doc: CreativeStudioDocument): CreativeStudioDocumentSnapshot {
  // Deep clone metadata only — zero binary Blobs or dataUrls exist in CreativeStudioDocumentSnapshot (C4)
  return {
    layersById: structuredClone(doc.layersById),
    collections: structuredClone(doc.collections),
    activeCollectionId: doc.activeCollectionId,
    concept: structuredClone(doc.concept),
    trash: structuredClone(doc.trash)
  };
}

function reconcilePurgedAssetReferences(
  layersById: Record<string, StudioLayer>,
  purgedAssetIds: readonly string[]
): Record<string, StudioLayer> {
  if (purgedAssetIds.length === 0) return layersById;
  const purgedSet = new Set(purgedAssetIds);
  let changed = false;
  const next: Record<string, StudioLayer> = {};

  for (const [id, layer] of Object.entries(layersById)) {
    if (layer.type === 'reference-image' && purgedSet.has(layer.assetId)) {
      if (layer.missingAssetReason !== 'permanently-purged') {
        changed = true;
        next[id] = {
          ...layer,
          missingAssetReason: 'permanently-purged'
        };
      } else {
        next[id] = layer;
      }
    } else {
      next[id] = layer;
    }
  }
  return changed ? next : layersById;
}

function pushStudioHistory(
  state: CreativeStudioState,
  actionLabel: string,
  nowIso: string
): StudioHistoryEntry[] {
  const entry: StudioHistoryEntry = {
    id: `studio-hist-${state.document.nextSequence}-${state.historyPast.length + 1}`,
    actionLabel,
    timestamp: nowIso,
    snapshot: captureDocumentSnapshot(state.document)
  };
  const next = [...state.historyPast, entry];
  return next.length > MAX_STUDIO_HISTORY_ENTRIES
    ? next.slice(next.length - MAX_STUDIO_HISTORY_ENTRIES)
    : next;
}

function getNextRootOrder(layersById: Record<string, StudioLayer>, collectionId: string, parentId: string | null): number {
  let maxOrder = -1;
  for (const layer of Object.values(layersById)) {
    if (layer.collectionId === collectionId && layer.parentId === parentId) {
      if (layer.order > maxOrder) maxOrder = layer.order;
    }
  }
  return maxOrder + 1;
}

/**
 * Builds the optional Atelier Starter Board (explicitly labeled as Demonstration Content per D1).
 */
export function buildAtelierStarterDemoLayers(options: {
  collectionId: string;
  spec: DesignSpecification;
  nowIso: string;
}): Record<string, StudioLayer> {
  const { collectionId, spec, nowIso } = options;
  const layers: StudioLayer[] = [
    {
      id: 'demo-layer-moodboard-1',
      type: 'moodboard-card',
      name: 'Atelier Direction (Demo)',
      parentId: null,
      order: 0,
      visible: true,
      locked: false,
      opacity: 1,
      transform: { x: 24, y: 24, width: 252, height: 210, rotationDeg: 0, scaleX: 1, scaleY: 1 },
      collectionId,
      authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
      isDemonstrationContent: true,
      title: 'Architectural Minimalist Capsule (Demonstration)',
      subtitle: 'Autumn Atelier Study · Non-Authoritative Concept Board',
      notes: 'Clean column proportion, restrained dart shaping, matte virgin wool drape, and concealed center-back closure. Demonstration starter card — edit or remove freely.',
      accentHex: '#1F242D',
      tags: ['demonstration', 'minimalist', 'tailored'],
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo-layer-silhouette-1',
      type: 'garment-silhouette-card',
      name: 'Concept Silhouette Study (Demo)',
      parentId: null,
      order: 1,
      visible: true,
      locked: false,
      opacity: 1,
      transform: { x: 294, y: 24, width: 242, height: 372, rotationDeg: 0, scaleX: 1, scaleY: 1 },
      collectionId,
      authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
      isDemonstrationContent: true,
      title: `${spec.name} (Demo Visual)`,
      garmentCategory: spec.garmentCategory,
      silhouette: spec.silhouette,
      easeProfile: spec.easeProfile,
      lengthCm: spec.lengthCm,
      colorHex: spec.color.hex,
      colorName: spec.color.name,
      fabricName: spec.fabric.name,
      isUnverifiedConceptVisual: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo-layer-palette-1',
      type: 'color-palette',
      name: 'Atelier Colorway (Demo)',
      parentId: null,
      order: 2,
      visible: true,
      locked: false,
      opacity: 1,
      transform: { x: 24, y: 252, width: 252, height: 144, rotationDeg: 0, scaleX: 1, scaleY: 1 },
      collectionId,
      authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
      isDemonstrationContent: true,
      title: 'Chalk & Obsidian Palette (Demo)',
      swatches: [
        { id: 'sw-1', name: 'Chalk Oatmeal', hex: '#E8E3D9', role: 'primary' },
        { id: 'sw-2', name: 'Midnight Ink', hex: '#1C212D', role: 'secondary' },
        { id: 'sw-3', name: 'Warm Stone', hex: '#B9B1A2', role: 'accent' },
        { id: 'sw-4', name: 'Cupro Sand', hex: '#D8CFC1', role: 'lining' }
      ],
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo-layer-fabric-1',
      type: 'fabric-swatch',
      name: 'Primary Wool Swatch (Demo)',
      parentId: null,
      order: 3,
      visible: true,
      locked: false,
      opacity: 1,
      transform: { x: 554, y: 24, width: 214, height: 196, rotationDeg: 0, scaleX: 1, scaleY: 1 },
      collectionId,
      authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
      isDemonstrationContent: true,
      fabricId: PRESET_FABRICS[0].id,
      fabricName: PRESET_FABRICS[0].name,
      composition: PRESET_FABRICS[0].composition,
      weightLabel: 'Medium · No stretch',
      drapeNote: PRESET_FABRICS[0].drapeDescription,
      swatchHex: '#E8E3D9',
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo-layer-note-1',
      type: 'annotation-note',
      name: 'Proportion Callout (Demo)',
      parentId: null,
      order: 4,
      visible: true,
      locked: false,
      opacity: 1,
      transform: { x: 554, y: 238, width: 214, height: 158, rotationDeg: 0, scaleX: 1, scaleY: 1 },
      collectionId,
      authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
      isDemonstrationContent: true,
      text: 'Hem target ~68 cm midi line. Promote approved creative intent to Pattern Atelier before drafting.',
      tone: 'atelier',
      verificationStatus: 'UNVERIFIED_FREEFORM_OVERLAY',
      createdAt: nowIso,
      updatedAt: nowIso
    }
  ];

  const map: Record<string, StudioLayer> = {};
  for (const layer of layers) {
    map[layer.id] = layer;
  }
  return normalizeSiblingOrders(map);
}

/**
 * Schema migration and malformed document recovery (Phase 1 requirement).
 * Safely repairs orphan references, cycles, missing fields, and invalid transforms.
 */
export function migrateAndRecoverStudioDocument(
  raw: unknown,
  fallback: { projectId: string; spec: DesignSpecification; nowIso?: string }
): { document: CreativeStudioDocument; recovered: boolean; recoveryNotes: string[] } {
  const now = fallback.nowIso ?? new Date().toISOString();
  const base = createCleanStudioDocument(fallback);
  const notes: string[] = [];

  if (!raw || typeof raw !== 'object') {
    notes.push('Stored studio document was missing or malformed; restored a clean studio workspace.');
    return { document: base, recovered: true, recoveryNotes: notes };
  }

  const candidate = raw as Partial<CreativeStudioDocument>;
  const version = candidate.schemaVersion;
  if (version !== CREATIVE_STUDIO_SCHEMA_VERSION) {
    notes.push(`Migrated studio document from schema version ${String(version ?? 'unknown')} to v${CREATIVE_STUDIO_SCHEMA_VERSION}.`);
  }

  const collections: StudioCollection[] =
    Array.isArray(candidate.collections) && candidate.collections.length > 0
      ? candidate.collections
          .filter((c): c is StudioCollection => Boolean(c && typeof c.id === 'string' && typeof c.name === 'string'))
          .map(c => ({
            id: c.id,
            name: c.name,
            description: typeof c.description === 'string' ? c.description : '',
            createdAt: typeof c.createdAt === 'string' ? c.createdAt : now
          }))
      : base.collections;

  const validCollectionIds = new Set(collections.map(c => c.id));
  const activeCollectionId =
    typeof candidate.activeCollectionId === 'string' && validCollectionIds.has(candidate.activeCollectionId)
      ? candidate.activeCollectionId
      : collections[0].id;

  const purgedAssetIds = Array.isArray(candidate.purgedAssetIds)
    ? candidate.purgedAssetIds.filter((id): id is string => typeof id === 'string')
    : [];

  // Recover layers safely
  const rawLayers =
    candidate.layersById && typeof candidate.layersById === 'object' ? candidate.layersById : {};
  const cleanedLayers: Record<string, StudioLayer> = {};

  for (const [key, item] of Object.entries(rawLayers)) {
    if (!item || typeof item !== 'object') continue;
    const layer = item as StudioLayer;
    if (typeof layer.id !== 'string' || typeof layer.type !== 'string') continue;
    const id = layer.id || key;
    const collectionId = validCollectionIds.has(layer.collectionId)
      ? layer.collectionId
      : activeCollectionId;
    const normalized: StudioLayer = {
      ...layer,
      id,
      collectionId,
      name: typeof layer.name === 'string' && layer.name.trim() ? layer.name : `Layer ${id}`,
      parentId: typeof layer.parentId === 'string' && layer.parentId !== id ? layer.parentId : null,
      order: Number.isFinite(layer.order) ? Math.max(0, Math.floor(layer.order)) : 0,
      visible: typeof layer.visible === 'boolean' ? layer.visible : true,
      locked: typeof layer.locked === 'boolean' ? layer.locked : false,
      opacity: clampOpacity(layer.opacity),
      transform: clampTransform(layer.transform ?? { x: 60, y: 60, width: 240, height: 180, rotationDeg: 0, scaleX: 1, scaleY: 1 }),
      authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
      createdAt: typeof layer.createdAt === 'string' ? layer.createdAt : now,
      updatedAt: typeof layer.updatedAt === 'string' ? layer.updatedAt : now
    };
    if (normalized.type === 'reference-image') {
      normalized.crop = normalizeCropRect(normalized.crop ?? { x: 0, y: 0, width: 1, height: 1 });
    }
    cleanedLayers[id] = normalized;
  }

  // Repair orphan / non-group parents / cross-collection parents
  for (const layer of Object.values(cleanedLayers)) {
    if (layer.parentId !== null) {
      const parent = cleanedLayers[layer.parentId];
      if (!parent || parent.type !== 'group' || parent.collectionId !== layer.collectionId) {
        notes.push(`Re-homed orphan layer "${layer.id}" to canvas root.`);
        cleanedLayers[layer.id] = { ...layer, parentId: null };
      }
    }
  }

  // Break any remaining cycles
  for (const layer of Object.values(cleanedLayers)) {
    const visited = new Set<string>([layer.id]);
    let cursor = cleanedLayers[layer.id].parentId;
    while (cursor !== null) {
      if (visited.has(cursor)) {
        notes.push(`Broke cyclic group link on layer "${layer.id}".`);
        cleanedLayers[layer.id] = { ...cleanedLayers[layer.id], parentId: null };
        break;
      }
      visited.add(cursor);
      cursor = cleanedLayers[cursor]?.parentId ?? null;
    }
  }

  const normalizedLayers = reconcilePurgedAssetReferences(
    normalizeSiblingOrders(cleanedLayers),
    purgedAssetIds
  );

  const recoveredDoc: CreativeStudioDocument = {
    schemaVersion: CREATIVE_STUDIO_SCHEMA_VERSION,
    projectId: typeof candidate.projectId === 'string' ? candidate.projectId : base.projectId,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
    hasInitializedBoard:
      typeof candidate.hasInitializedBoard === 'boolean'
        ? candidate.hasInitializedBoard
        : Object.keys(normalizedLayers).length > 0,
    isDemonstrationBoardLoaded: Boolean(candidate.isDemonstrationBoardLoaded),
    layersById: normalizedLayers,
    collections,
    activeCollectionId,
    assetsById:
      candidate.assetsById && typeof candidate.assetsById === 'object'
        ? (candidate.assetsById as Record<string, StudioAssetMetadata>)
        : {},
    purgedAssetIds,
    trash: Array.isArray(candidate.trash) ? (candidate.trash as StudioTrashItem[]) : [],
    concept:
      candidate.concept && typeof candidate.concept === 'object'
        ? { ...base.concept, ...candidate.concept }
        : base.concept,
    aiCandidates: Array.isArray(candidate.aiCandidates)
      ? (candidate.aiCandidates as AiConceptCandidate[])
      : [],
    selectedCandidateId:
      typeof candidate.selectedCandidateId === 'string' ? candidate.selectedCandidateId : null,
    camera: candidate.camera
      ? {
          zoom: clampStudioZoom(candidate.camera.zoom),
          panX: roundCoord(candidate.camera.panX),
          panY: roundCoord(candidate.camera.panY)
        }
      : base.camera,
    nextSequence:
      typeof candidate.nextSequence === 'number' && candidate.nextSequence >= 1
        ? Math.floor(candidate.nextSequence)
        : Object.keys(normalizedLayers).length + 1
  };

  return {
    document: recoveredDoc,
    recovered: notes.length > 0,
    recoveryNotes: notes
  };
}

/**
 * C8 — Explicit, user-confirmed concept promotion into an UNAPPROVED Pattern Atelier draft.
 * Excludes AI body measurements, pixel dimensions, freehand sketches, and unverified overlays.
 */
export function buildPromotedDesignSpecDraft(options: {
  currentSpec: DesignSpecification;
  concept: StructuredConceptAttributes;
  selection: PromotionFieldSelection;
  nowIso?: string;
}): DesignSpecification {
  const { currentSpec, concept, selection } = options;
  const now = options.nowIso ?? new Date().toISOString();

  const chosenFabric =
    selection.includeFabric
      ? PRESET_FABRICS.find(f => f.id === concept.fabricId) ?? currentSpec.fabric
      : currentSpec.fabric;

  const nextVersion = currentSpec.version + 1;
  const nextLengthCm = selection.includeTargetLength
    ? Math.max(25, Math.min(180, Math.round(concept.lengthCm)))
    : currentSpec.lengthCm;

  const sanitizedNotes = selection.includeDesignNotes
    ? concept.constructionNotes
        .map(n => n.trim())
        .filter(Boolean)
        .filter(n => !/UNVERIFIED_FREEFORM_OVERLAY/i.test(n))
    : [...currentSpec.designNotes];

  const promotedSpec: DesignSpecification = {
    ...currentSpec,
    name: selection.includeTitle && concept.title.trim() ? concept.title.trim() : currentSpec.name,
    prompt:
      selection.includePrompt && concept.creativeBrief.trim()
        ? concept.creativeBrief.trim()
        : currentSpec.prompt,
    garmentCategory: selection.includeCategoryAndSilhouette
      ? concept.garmentCategory
      : currentSpec.garmentCategory,
    silhouette: selection.includeCategoryAndSilhouette
      ? concept.silhouette
      : currentSpec.silhouette,
    fabric: chosenFabric,
    color: selection.includeColor
      ? { name: concept.colorName.trim() || currentSpec.color.name, hex: concept.colorHex }
      : { ...currentSpec.color },
    easeProfile: selection.includeEaseProfile ? concept.easeProfile : currentSpec.easeProfile,
    lengthCm: nextLengthCm,
    constructionFeatures: selection.includeConstructionFeatures
      ? concept.constructionFeatures.map(f => ({ ...f }))
      : currentSpec.constructionFeatures.map(f => ({ ...f })),
    designNotes: [
      ...sanitizedNotes,
      `Promoted from Creative Studio as unapproved draft on ${now.slice(0, 10)}. Explicit designer review required before pattern approval.`
    ],
    // C8 Mandatory Safety Invariant: EVERY promoted draft must remain strictly unapproved
    isApproved: false,
    approvalState: 'draft',
    approvedAt: undefined,
    approvedBy: undefined,
    approvalRecord: undefined,
    approvalProvenance: 'designer-edited',
    version: nextVersion,
    parentRevisionId: currentSpec.specificationRevisionId,
    specificationRevisionId: `spec-${currentSpec.id}-v${nextVersion}`,
    updatedAt: now
  };

  return promotedSpec;
}

export type CreativeStudioAction =
  | { type: 'HYDRATE_DOCUMENT'; document: CreativeStudioDocument }
  | { type: 'INITIALIZE_EMPTY_MOODBOARD'; nowIso?: string }
  | { type: 'LOAD_ATELIER_STARTER_BOARD'; spec: DesignSpecification; nowIso?: string }
  | { type: 'CLEAR_BOARD'; spec: DesignSpecification; nowIso?: string }
  | { type: 'REGISTER_ASSET_METADATA'; asset: StudioAssetMetadata }
  | { type: 'UPDATE_ASSET_STORAGE_STATE'; assetId: string; storageState: StudioAssetMetadata['storageState'] }
  | { type: 'ADD_LAYER'; layer: StudioLayer; label?: string; nowIso?: string }
  | { type: 'ADD_LAYERS_BATCH'; layers: StudioLayer[]; label?: string; nowIso?: string }
  | { type: 'UPDATE_LAYER_TRANSFORMS'; updates: Record<string, Partial<LayerTransform>>; label?: string; nowIso?: string }
  | { type: 'UPDATE_LAYER_PROPS'; layerId: string; patch: Partial<StudioLayer>; label?: string; nowIso?: string }
  | { type: 'SET_IMAGE_CROP'; layerId: string; crop: Partial<NormalizedCropRect>; nowIso?: string }
  | { type: 'REPLACE_IMAGE_ASSET'; layerId: string; asset: StudioAssetMetadata; nowIso?: string }
  | { type: 'APPEND_SKETCH_STROKE'; layerId: string; stroke: SketchStroke; nowIso?: string }
  | { type: 'UPDATE_PALETTE_SWATCHES'; layerId: string; swatches: PaletteSwatch[]; nowIso?: string }
  | { type: 'TOGGLE_LAYER_VISIBILITY'; layerId: string; nowIso?: string }
  | { type: 'TOGGLE_LAYER_LOCK'; layerId: string; nowIso?: string }
  | { type: 'RENAME_LAYER'; layerId: string; name: string; nowIso?: string }
  | { type: 'REORDER_LAYER'; layerId: string; direction: 'up' | 'down' | 'top' | 'bottom'; nowIso?: string }
  | { type: 'REPARENT_LAYER'; layerId: string; newParentId: string | null; targetOrder?: number; nowIso?: string }
  | { type: 'GROUP_LAYERS'; layerIds: string[]; groupName?: string; nowIso?: string }
  | { type: 'UNGROUP_LAYER'; groupId: string; nowIso?: string }
  | { type: 'DUPLICATE_LAYERS'; layerIds: string[]; nowIso?: string }
  | { type: 'ALIGN_LAYERS'; layerIds: string[]; axis: AlignmentAxis; nowIso?: string }
  | { type: 'SOFT_DELETE_LAYERS'; layerIds: string[]; nowIso?: string }
  | { type: 'RESTORE_TRASH_ITEM'; trashId: string; nowIso?: string }
  | { type: 'PURGE_TRASH_ITEM'; trashId: string; purgedAssetIds?: string[]; nowIso?: string }
  | { type: 'EMPTY_TRASH'; purgedAssetIds?: string[]; nowIso?: string }
  | { type: 'CREATE_COLLECTION'; name: string; description?: string; nowIso?: string }
  | { type: 'SET_ACTIVE_COLLECTION'; collectionId: string }
  | { type: 'RENAME_COLLECTION'; collectionId: string; name: string; nowIso?: string }
  | { type: 'UPDATE_CONCEPT'; patch: Partial<StructuredConceptAttributes>; recordHistory?: boolean; nowIso?: string }
  | { type: 'ADD_AI_CANDIDATES'; candidates: AiConceptCandidate[]; nowIso?: string }
  | { type: 'SELECT_AI_CANDIDATE'; candidateId: string | null }
  | { type: 'APPLY_AI_CANDIDATE_TO_BOARD'; candidateId: string; nowIso?: string }
  | { type: 'SET_CAMERA'; camera: Partial<StudioCanvasCamera> }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export function creativeStudioReducer(
  state: CreativeStudioState,
  action: CreativeStudioAction
): CreativeStudioState {
  const now = ('nowIso' in action && action.nowIso) ? action.nowIso : new Date().toISOString();
  const doc = state.document;

  switch (action.type) {
    case 'HYDRATE_DOCUMENT': {
      const reconciledLayers = reconcilePurgedAssetReferences(
        normalizeSiblingOrders(action.document.layersById),
        action.document.purgedAssetIds
      );
      return {
        document: {
          ...action.document,
          layersById: reconciledLayers
        },
        historyPast: [],
        historyFuture: []
      };
    }

    case 'INITIALIZE_EMPTY_MOODBOARD': {
      if (doc.hasInitializedBoard) return state;
      const cardId = `layer-mood-${doc.nextSequence}`;
      const newCard: StudioLayer = {
        id: cardId,
        type: 'moodboard-card',
        name: 'Moodboard Brief',
        parentId: null,
        order: getNextRootOrder(doc.layersById, doc.activeCollectionId, null),
        visible: true,
        locked: false,
        opacity: 1,
        transform: { x: 100, y: 80, width: 340, height: 220, rotationDeg: 0, scaleX: 1, scaleY: 1 },
        collectionId: doc.activeCollectionId,
        authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
        title: doc.concept.title || 'New Design Direction',
        subtitle: `${doc.concept.garmentCategory} · ${doc.concept.silhouette}`,
        notes: doc.concept.creativeBrief || 'Drag reference images onto the board or add color swatches to explore your silhouette direction.',
        accentHex: doc.concept.colorHex || '#1C212D',
        tags: [...doc.concept.moodKeywords],
        createdAt: now,
        updatedAt: now
      };
      const nextLayers = normalizeSiblingOrders({ ...doc.layersById, [cardId]: newCard });
      return {
        document: {
          ...doc,
          hasInitializedBoard: true,
          layersById: nextLayers,
          nextSequence: doc.nextSequence + 1,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, 'Create Moodboard', now),
        historyFuture: []
      };
    }

    case 'LOAD_ATELIER_STARTER_BOARD': {
      const demoLayers = buildAtelierStarterDemoLayers({
        collectionId: doc.activeCollectionId,
        spec: action.spec,
        nowIso: now
      });
      // Keep layers from other collections intact; populate current collection
      const merged: Record<string, StudioLayer> = {};
      for (const [id, layer] of Object.entries(doc.layersById)) {
        if (layer.collectionId !== doc.activeCollectionId) {
          merged[id] = layer;
        }
      }
      Object.assign(merged, demoLayers);
      return {
        document: {
          ...doc,
          hasInitializedBoard: true,
          isDemonstrationBoardLoaded: true,
          layersById: normalizeSiblingOrders(merged),
          camera: { zoom: 0.88, panX: 14, panY: 16 },
          nextSequence: doc.nextSequence + 6,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, 'Load Atelier Starter Board (Demo)', now),
        historyFuture: []
      };
    }

    case 'CLEAR_BOARD': {
      const clean = createCleanStudioDocument({
        projectId: doc.projectId,
        spec: action.spec,
        nowIso: now
      });
      return {
        document: {
          ...clean,
          purgedAssetIds: [...doc.purgedAssetIds]
        },
        historyPast: [],
        historyFuture: []
      };
    }

    case 'REGISTER_ASSET_METADATA': {
      return {
        ...state,
        document: {
          ...doc,
          assetsById: {
            ...doc.assetsById,
            [action.asset.assetId]: action.asset
          },
          updatedAt: now
        }
      };
    }

    case 'UPDATE_ASSET_STORAGE_STATE': {
      const existing = doc.assetsById[action.assetId];
      if (!existing) return state;
      return {
        ...state,
        document: {
          ...doc,
          assetsById: {
            ...doc.assetsById,
            [action.assetId]: { ...existing, storageState: action.storageState }
          },
          updatedAt: now
        }
      };
    }

    case 'ADD_LAYER': {
      const parentId =
        action.layer.parentId &&
        doc.layersById[action.layer.parentId]?.type === 'group' &&
        doc.layersById[action.layer.parentId]?.collectionId === action.layer.collectionId
          ? action.layer.parentId
          : null;
      const order = getNextRootOrder(doc.layersById, action.layer.collectionId, parentId);
      const safeLayer: StudioLayer = {
        ...action.layer,
        parentId,
        order,
        opacity: clampOpacity(action.layer.opacity),
        transform: clampTransform(action.layer.transform),
        authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
        updatedAt: now
      };
      if (safeLayer.type === 'reference-image') {
        safeLayer.crop = normalizeCropRect(safeLayer.crop);
      }
      const nextLayers = normalizeSiblingOrders({
        ...doc.layersById,
        [safeLayer.id]: safeLayer
      });
      return {
        document: {
          ...doc,
          hasInitializedBoard: true,
          layersById: nextLayers,
          nextSequence: doc.nextSequence + 1,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, action.label ?? `Add ${safeLayer.name}`, now),
        historyFuture: []
      };
    }

    case 'ADD_LAYERS_BATCH': {
      if (action.layers.length === 0) return state;
      const nextMap: Record<string, StudioLayer> = { ...doc.layersById };
      for (const incoming of action.layers) {
        const parentId =
          incoming.parentId &&
          nextMap[incoming.parentId]?.type === 'group' &&
          nextMap[incoming.parentId]?.collectionId === incoming.collectionId
            ? incoming.parentId
            : null;
        const order = getNextRootOrder(nextMap, incoming.collectionId, parentId);
        const safeLayer: StudioLayer = {
          ...incoming,
          parentId,
          order,
          opacity: clampOpacity(incoming.opacity),
          transform: clampTransform(incoming.transform),
          authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
          updatedAt: now
        };
        if (safeLayer.type === 'reference-image') {
          safeLayer.crop = normalizeCropRect(safeLayer.crop);
        }
        nextMap[safeLayer.id] = safeLayer;
      }
      return {
        document: {
          ...doc,
          hasInitializedBoard: true,
          layersById: normalizeSiblingOrders(nextMap),
          nextSequence: doc.nextSequence + action.layers.length,
          updatedAt: now
        },
        historyPast: pushStudioHistory(
          state,
          action.label ?? `Add ${action.layers.length} layers`,
          now
        ),
        historyFuture: []
      };
    }

    case 'UPDATE_LAYER_TRANSFORMS': {
      const ids = Object.keys(action.updates);
      if (ids.length === 0) return state;
      let changed = false;
      const nextMap: Record<string, StudioLayer> = { ...doc.layersById };
      for (const id of ids) {
        const layer = nextMap[id];
        if (!layer || isLayerEffectivelyLocked(id, doc.layersById)) continue;
        const clamped = clampTransform({
          ...layer.transform,
          ...action.updates[id]
        });
        if (
          clamped.x !== layer.transform.x ||
          clamped.y !== layer.transform.y ||
          clamped.width !== layer.transform.width ||
          clamped.height !== layer.transform.height ||
          clamped.rotationDeg !== layer.transform.rotationDeg ||
          clamped.scaleX !== layer.transform.scaleX ||
          clamped.scaleY !== layer.transform.scaleY
        ) {
          changed = true;
          nextMap[id] = { ...layer, transform: clamped, updatedAt: now };
        }
      }
      if (!changed) return state;
      return {
        document: {
          ...doc,
          layersById: nextMap,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, action.label ?? 'Transform layer', now),
        historyFuture: []
      };
    }

    case 'UPDATE_LAYER_PROPS': {
      const target = doc.layersById[action.layerId];
      if (!target) return state;
      // Disallow corrupting hierarchy fields through generic prop patch (must use REPARENT_LAYER / REORDER_LAYER)
      const { id: _id, parentId: _p, order: _o, type: _t, authorityTag: _a, ...safePatch } =
        action.patch as Partial<StudioLayer>;
      const updated = {
        ...target,
        ...safePatch,
        opacity:
          safePatch.opacity !== undefined ? clampOpacity(safePatch.opacity) : target.opacity,
        transform:
          safePatch.transform !== undefined
            ? clampTransform({ ...target.transform, ...safePatch.transform })
            : target.transform,
        authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER' as const,
        updatedAt: now
      } as StudioLayer;

      return {
        document: {
          ...doc,
          layersById: { ...doc.layersById, [target.id]: updated },
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, action.label ?? `Edit ${target.name}`, now),
        historyFuture: []
      };
    }

    case 'SET_IMAGE_CROP': {
      const target = doc.layersById[action.layerId];
      if (!target || target.type !== 'reference-image' || isLayerEffectivelyLocked(target.id, doc.layersById)) {
        return state;
      }
      const nextCrop = normalizeCropRect({ ...target.crop, ...action.crop });
      const updated: ReferenceImageLayer = {
        ...target,
        crop: nextCrop,
        updatedAt: now
      };
      return {
        document: {
          ...doc,
          layersById: { ...doc.layersById, [target.id]: updated },
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Crop ${target.name}`, now),
        historyFuture: []
      };
    }

    case 'REPLACE_IMAGE_ASSET': {
      const target = doc.layersById[action.layerId];
      if (!target || target.type !== 'reference-image') return state;
      const updated: ReferenceImageLayer = {
        ...target,
        assetId: action.asset.assetId,
        assetName: action.asset.name,
        mimeType: action.asset.mimeType,
        sizeBytes: action.asset.sizeBytes,
        naturalWidth: action.asset.naturalWidth,
        naturalHeight: action.asset.naturalHeight,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        missingAssetReason: undefined,
        updatedAt: now
      };
      return {
        document: {
          ...doc,
          assetsById: { ...doc.assetsById, [action.asset.assetId]: action.asset },
          layersById: { ...doc.layersById, [target.id]: updated },
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Replace asset on ${target.name}`, now),
        historyFuture: []
      };
    }

    case 'APPEND_SKETCH_STROKE': {
      const target = doc.layersById[action.layerId];
      if (!target || target.type !== 'freehand-sketch' || isLayerEffectivelyLocked(target.id, doc.layersById)) {
        return state;
      }
      const updated: StudioLayer = {
        ...target,
        strokes: [...target.strokes, action.stroke],
        updatedAt: now
      };
      return {
        document: {
          ...doc,
          layersById: { ...doc.layersById, [target.id]: updated },
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Sketch stroke on ${target.name}`, now),
        historyFuture: []
      };
    }

    case 'UPDATE_PALETTE_SWATCHES': {
      const target = doc.layersById[action.layerId];
      if (!target || target.type !== 'color-palette') return state;
      const updated: StudioLayer = {
        ...target,
        swatches: action.swatches,
        updatedAt: now
      };
      return {
        document: {
          ...doc,
          layersById: { ...doc.layersById, [target.id]: updated },
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Update palette ${target.name}`, now),
        historyFuture: []
      };
    }

    case 'TOGGLE_LAYER_VISIBILITY': {
      const target = doc.layersById[action.layerId];
      if (!target) return state;
      return {
        document: {
          ...doc,
          layersById: {
            ...doc.layersById,
            [target.id]: { ...target, visible: !target.visible, updatedAt: now }
          },
          updatedAt: now
        },
        historyPast: pushStudioHistory(
          state,
          `${target.visible ? 'Hide' : 'Show'} ${target.name}`,
          now
        ),
        historyFuture: []
      };
    }

    case 'TOGGLE_LAYER_LOCK': {
      const target = doc.layersById[action.layerId];
      if (!target) return state;
      return {
        document: {
          ...doc,
          layersById: {
            ...doc.layersById,
            [target.id]: { ...target, locked: !target.locked, updatedAt: now }
          },
          updatedAt: now
        },
        historyPast: pushStudioHistory(
          state,
          `${target.locked ? 'Unlock' : 'Lock'} ${target.name}`,
          now
        ),
        historyFuture: []
      };
    }

    case 'RENAME_LAYER': {
      const target = doc.layersById[action.layerId];
      const trimmed = action.name.trim();
      if (!target || !trimmed || trimmed === target.name) return state;
      return {
        document: {
          ...doc,
          layersById: {
            ...doc.layersById,
            [target.id]: { ...target, name: trimmed, updatedAt: now }
          },
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Rename ${target.name} to ${trimmed}`, now),
        historyFuture: []
      };
    }

    case 'REORDER_LAYER': {
      const target = doc.layersById[action.layerId];
      if (!target) return state;
      const siblings = Object.values(doc.layersById)
        .filter(l => l.collectionId === target.collectionId && l.parentId === target.parentId)
        .sort((a, b) => a.order - b.order);
      const currentIdx = siblings.findIndex(l => l.id === target.id);
      if (currentIdx === -1) return state;

      let nextIdx = currentIdx;
      if (action.direction === 'up') nextIdx = Math.min(siblings.length - 1, currentIdx + 1);
      if (action.direction === 'down') nextIdx = Math.max(0, currentIdx - 1);
      if (action.direction === 'top') nextIdx = siblings.length - 1;
      if (action.direction === 'bottom') nextIdx = 0;
      if (nextIdx === currentIdx) return state;

      const reordered = [...siblings];
      const [moved] = reordered.splice(currentIdx, 1);
      reordered.splice(nextIdx, 0, moved);

      const nextMap: Record<string, StudioLayer> = { ...doc.layersById };
      reordered.forEach((item, index) => {
        nextMap[item.id] = { ...item, order: index, updatedAt: now };
      });

      return {
        document: {
          ...doc,
          layersById: normalizeSiblingOrders(nextMap),
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Reorder ${target.name}`, now),
        historyFuture: []
      };
    }

    case 'REPARENT_LAYER': {
      const target = doc.layersById[action.layerId];
      if (!target) return state;
      const nextParentId = action.newParentId;
      if (nextParentId === target.parentId && action.targetOrder === undefined) return state;

      // C1 strict validation: prevent self-parenting, non-group parenting, cross-collection, or cycles
      if (nextParentId !== null) {
        const parent = doc.layersById[nextParentId];
        if (!parent || parent.type !== 'group') return state;
        if (parent.collectionId !== target.collectionId) return state;
        if (isAncestorOrSelf(target.id, nextParentId, doc.layersById)) {
          return state; // Reject cyclic reparent
        }
      }

      // Preserve world position when reparenting across groups
      const worldBefore = resolveWorldTransform(target.id, doc.layersById);
      const nextParentWorld = nextParentId ? resolveWorldTransform(nextParentId, doc.layersById) : null;
      let nextTransform = target.transform;
      if (worldBefore) {
        if (nextParentWorld) {
          const delta = worldDeltaToParentLocalDelta(
            { x: worldBefore.x - nextParentWorld.x, y: worldBefore.y - nextParentWorld.y },
            nextParentId,
            doc.layersById
          );
          nextTransform = clampTransform({
            ...target.transform,
            x: delta.x,
            y: delta.y,
            rotationDeg: worldBefore.rotationDeg - nextParentWorld.rotationDeg
          });
        } else {
          nextTransform = clampTransform({
            ...target.transform,
            x: worldBefore.x,
            y: worldBefore.y,
            rotationDeg: worldBefore.rotationDeg
          });
        }
      }

      const targetSiblings = Object.values(doc.layersById)
        .filter(
          l =>
            l.collectionId === target.collectionId &&
            l.parentId === nextParentId &&
            l.id !== target.id
        )
        .sort((a, b) => a.order - b.order);

      const insertAt =
        action.targetOrder !== undefined
          ? Math.max(0, Math.min(targetSiblings.length, action.targetOrder))
          : targetSiblings.length;

      const updatedTarget: StudioLayer = {
        ...target,
        parentId: nextParentId,
        transform: nextTransform,
        updatedAt: now
      };
      targetSiblings.splice(insertAt, 0, updatedTarget);

      const nextMap: Record<string, StudioLayer> = { ...doc.layersById };
      targetSiblings.forEach((s, idx) => {
        nextMap[s.id] = { ...s, order: idx };
      });
      const normalized = normalizeSiblingOrders(nextMap);
      if (!validateHierarchyInvariants(normalized).valid) {
        return state;
      }

      return {
        document: {
          ...doc,
          layersById: normalized,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Move ${target.name} in hierarchy`, now),
        historyFuture: []
      };
    }

    case 'GROUP_LAYERS': {
      // Deduplicate and filter out descendants of already-selected groups
      const uniqueIds = Array.from(new Set(action.layerIds)).filter(id => Boolean(doc.layersById[id]));
      const topSelected = uniqueIds.filter(
        id => !uniqueIds.some(other => other !== id && isAncestorOrSelf(other, id, doc.layersById))
      );
      if (topSelected.length < 2) return state;

      const selectedLayers = topSelected.map(id => doc.layersById[id]);
      const collectionId = selectedLayers[0].collectionId;
      if (selectedLayers.some(l => l.collectionId !== collectionId)) return state;

      // Common parent if all share the same parentId, otherwise root
      const sharedParentId = selectedLayers.every(l => l.parentId === selectedLayers[0].parentId)
        ? selectedLayers[0].parentId
        : null;

      // Compute world union bounding box of selected layers
      const aabbs = selectedLayers
        .map(l => resolveWorldTransform(l.id, doc.layersById))
        .filter((w): w is NonNullable<typeof w> => Boolean(w))
        .map(w => getRotatedAabb(w));
      const union = getUnionRect(aabbs);
      if (!union) return state;

      const groupId = `group-${doc.nextSequence}`;
      const parentWorld = sharedParentId ? resolveWorldTransform(sharedParentId, doc.layersById) : null;
      const groupLocalOrigin = parentWorld
        ? worldDeltaToParentLocalDelta(
            { x: union.x - parentWorld.x, y: union.y - parentWorld.y },
            sharedParentId,
            doc.layersById
          )
        : { x: union.x, y: union.y };

      const groupOrder = getNextRootOrder(doc.layersById, collectionId, sharedParentId);
      const groupLayer: GroupLayer = {
        id: groupId,
        type: 'group',
        name: action.groupName?.trim() || `Group ${doc.nextSequence}`,
        parentId: sharedParentId,
        order: groupOrder,
        visible: true,
        locked: false,
        opacity: 1,
        transform: clampTransform({
          x: groupLocalOrigin.x,
          y: groupLocalOrigin.y,
          width: Math.max(40, union.width),
          height: Math.max(40, union.height),
          rotationDeg: 0,
          scaleX: 1,
          scaleY: 1
        }),
        collectionId,
        authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
        collapsed: false,
        createdAt: now,
        updatedAt: now
      };

      const nextMap: Record<string, StudioLayer> = { ...doc.layersById, [groupId]: groupLayer };

      selectedLayers
        .sort((a, b) => a.order - b.order)
        .forEach((child, idx) => {
          const worldChild = resolveWorldTransform(child.id, doc.layersById);
          const localX = worldChild ? roundCoord(worldChild.x - union.x) : child.transform.x;
          const localY = worldChild ? roundCoord(worldChild.y - union.y) : child.transform.y;
          nextMap[child.id] = {
            ...child,
            parentId: groupId,
            order: idx,
            transform: clampTransform({
              ...child.transform,
              x: localX,
              y: localY,
              rotationDeg: worldChild ? worldChild.rotationDeg : child.transform.rotationDeg
            }),
            updatedAt: now
          };
        });

      const normalized = normalizeSiblingOrders(nextMap);
      if (!validateHierarchyInvariants(normalized).valid) {
        return state;
      }

      return {
        document: {
          ...doc,
          layersById: normalized,
          nextSequence: doc.nextSequence + 1,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Group ${selectedLayers.length} layers`, now),
        historyFuture: []
      };
    }

    case 'UNGROUP_LAYER': {
      const group = doc.layersById[action.groupId];
      if (!group || group.type !== 'group') return state;

      const children = Object.values(doc.layersById)
        .filter(l => l.parentId === group.id)
        .sort((a, b) => a.order - b.order);

      const nextMap: Record<string, StudioLayer> = { ...doc.layersById };
      delete nextMap[group.id];

      const targetParentWorld = group.parentId
        ? resolveWorldTransform(group.parentId, doc.layersById)
        : null;

      children.forEach((child, idx) => {
        const childWorld = resolveWorldTransform(child.id, doc.layersById);
        let nextTransform = child.transform;
        if (childWorld) {
          if (targetParentWorld) {
            const localPos = worldDeltaToParentLocalDelta(
              { x: childWorld.x - targetParentWorld.x, y: childWorld.y - targetParentWorld.y },
              group.parentId,
              doc.layersById
            );
            nextTransform = clampTransform({
              ...child.transform,
              x: localPos.x,
              y: localPos.y,
              rotationDeg: childWorld.rotationDeg - targetParentWorld.rotationDeg
            });
          } else {
            nextTransform = clampTransform({
              ...child.transform,
              x: childWorld.x,
              y: childWorld.y,
              rotationDeg: childWorld.rotationDeg
            });
          }
        }
        nextMap[child.id] = {
          ...child,
          parentId: group.parentId,
          order: group.order + idx * 0.001,
          transform: nextTransform,
          updatedAt: now
        };
      });

      const normalized = normalizeSiblingOrders(nextMap);
      if (!validateHierarchyInvariants(normalized).valid) {
        return state;
      }

      return {
        document: {
          ...doc,
          layersById: normalized,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Ungroup ${group.name}`, now),
        historyFuture: []
      };
    }

    case 'DUPLICATE_LAYERS': {
      const uniqueIds = Array.from(new Set(action.layerIds)).filter(id => Boolean(doc.layersById[id]));
      const roots = uniqueIds.filter(
        id => !uniqueIds.some(other => other !== id && isAncestorOrSelf(other, id, doc.layersById))
      );
      if (roots.length === 0) return state;

      const nextMap: Record<string, StudioLayer> = { ...doc.layersById };
      let seq = doc.nextSequence;

      for (const rootId of roots) {
        const subtreeIds = collectSubtreeIds(rootId, doc.layersById);
        const idRemap = new Map<string, string>();
        for (const oldId of subtreeIds) {
          idRemap.set(oldId, `layer-copy-${seq++}`);
        }
        for (const oldId of subtreeIds) {
          const orig = doc.layersById[oldId];
          const newId = idRemap.get(oldId)!;
          const isSubtreeRoot = oldId === rootId;
          const newParentId = isSubtreeRoot
            ? orig.parentId
            : (orig.parentId ? idRemap.get(orig.parentId) ?? null : null);
          const cloned = structuredClone(orig);
          cloned.id = newId;
          cloned.parentId = newParentId;
          cloned.name = isSubtreeRoot ? `${orig.name} Copy` : orig.name;
          cloned.order = isSubtreeRoot
            ? getNextRootOrder(nextMap, orig.collectionId, newParentId)
            : orig.order;
          if (isSubtreeRoot) {
            cloned.transform = clampTransform({
              ...orig.transform,
              x: orig.transform.x + 24,
              y: orig.transform.y + 24
            });
          }
          cloned.createdAt = now;
          cloned.updatedAt = now;
          nextMap[newId] = cloned;
        }
      }

      const normalized = normalizeSiblingOrders(nextMap);
      return {
        document: {
          ...doc,
          layersById: normalized,
          nextSequence: seq,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Duplicate ${roots.length} layer(s)`, now),
        historyFuture: []
      };
    }

    case 'ALIGN_LAYERS': {
      const uniqueIds = Array.from(new Set(action.layerIds)).filter(
        id => Boolean(doc.layersById[id]) && !isLayerEffectivelyLocked(id, doc.layersById)
      );
      const items = uniqueIds
        .map(id => {
          const world = resolveWorldTransform(id, doc.layersById);
          return world ? { id, rect: getRotatedAabb(world) } : null;
        })
        .filter((x): x is { id: string; rect: ReturnType<typeof getRotatedAabb> } => Boolean(x));

      const deltas = computeAlignmentDeltas(items, action.axis);
      if (Object.keys(deltas).length === 0) return state;

      const nextMap: Record<string, StudioLayer> = { ...doc.layersById };
      let changed = false;
      for (const [id, worldDelta] of Object.entries(deltas)) {
        if (worldDelta.x === 0 && worldDelta.y === 0) continue;
        const layer = nextMap[id];
        const localDelta = worldDeltaToParentLocalDelta(worldDelta, layer.parentId, doc.layersById);
        nextMap[id] = {
          ...layer,
          transform: clampTransform({
            ...layer.transform,
            x: layer.transform.x + localDelta.x,
            y: layer.transform.y + localDelta.y
          }),
          updatedAt: now
        };
        changed = true;
      }
      if (!changed) return state;

      return {
        document: {
          ...doc,
          layersById: nextMap,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Align layers (${action.axis})`, now),
        historyFuture: []
      };
    }

    case 'SOFT_DELETE_LAYERS': {
      const uniqueIds = Array.from(new Set(action.layerIds)).filter(id => Boolean(doc.layersById[id]));
      const roots = uniqueIds.filter(
        id => !uniqueIds.some(other => other !== id && isAncestorOrSelf(other, id, doc.layersById))
      );
      if (roots.length === 0) return state;

      const nextMap: Record<string, StudioLayer> = { ...doc.layersById };
      const newTrashItems: StudioTrashItem[] = [];
      let seq = doc.nextSequence;

      for (const rootId of roots) {
        const rootLayer = doc.layersById[rootId];
        const subtreeIds = collectSubtreeIds(rootId, doc.layersById);
        const captured: StudioLayer[] = subtreeIds.map(id => structuredClone(doc.layersById[id]));
        for (const id of subtreeIds) {
          delete nextMap[id];
        }
        newTrashItems.push({
          id: `trash-${seq++}`,
          deletedAt: now,
          layers: captured,
          originalParentId: rootLayer.parentId,
          originalOrder: rootLayer.order
        });
      }

      return {
        document: {
          ...doc,
          layersById: normalizeSiblingOrders(nextMap),
          trash: [...newTrashItems, ...doc.trash],
          nextSequence: seq,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Move ${roots.length} layer(s) to Trash`, now),
        historyFuture: []
      };
    }

    case 'RESTORE_TRASH_ITEM': {
      const item = doc.trash.find(t => t.id === action.trashId);
      if (!item || item.layers.length === 0) return state;

      const nextMap: Record<string, StudioLayer> = { ...doc.layersById };
      const rootLayer = item.layers[0];
      const validCollectionIds = new Set(doc.collections.map(c => c.id));
      const targetCollectionId = validCollectionIds.has(rootLayer.collectionId)
        ? rootLayer.collectionId
        : doc.activeCollectionId;

      const canRestoreToOriginalParent =
        item.originalParentId !== null &&
        nextMap[item.originalParentId]?.type === 'group' &&
        nextMap[item.originalParentId]?.collectionId === targetCollectionId;

      const restoredRootParentId = canRestoreToOriginalParent ? item.originalParentId : null;

      item.layers.forEach((layer, idx) => {
        const cloned = structuredClone(layer);
        cloned.collectionId = targetCollectionId;
        if (idx === 0) {
          cloned.parentId = restoredRootParentId;
          cloned.order = getNextRootOrder(nextMap, targetCollectionId, restoredRootParentId);
        }
        cloned.updatedAt = now;
        nextMap[cloned.id] = cloned;
      });

      const reconciled = reconcilePurgedAssetReferences(
        normalizeSiblingOrders(nextMap),
        doc.purgedAssetIds
      );

      return {
        document: {
          ...doc,
          layersById: reconciled,
          trash: doc.trash.filter(t => t.id !== action.trashId),
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Restore ${rootLayer.name} from Trash`, now),
        historyFuture: []
      };
    }

    case 'PURGE_TRASH_ITEM': {
      const item = doc.trash.find(t => t.id === action.trashId);
      if (!item) return state;
      const addedPurged = action.purgedAssetIds ?? [];
      const nextPurged = Array.from(new Set([...doc.purgedAssetIds, ...addedPurged]));
      const nextAssets = { ...doc.assetsById };
      for (const assetId of addedPurged) {
        if (nextAssets[assetId]) {
          nextAssets[assetId] = { ...nextAssets[assetId], storageState: 'purged' };
        }
      }
      return {
        ...state,
        document: {
          ...doc,
          trash: doc.trash.filter(t => t.id !== action.trashId),
          purgedAssetIds: nextPurged,
          assetsById: nextAssets,
          layersById: reconcilePurgedAssetReferences(doc.layersById, nextPurged),
          updatedAt: now
        }
      };
    }

    case 'EMPTY_TRASH': {
      if (doc.trash.length === 0) return state;
      const addedPurged = action.purgedAssetIds ?? [];
      const nextPurged = Array.from(new Set([...doc.purgedAssetIds, ...addedPurged]));
      const nextAssets = { ...doc.assetsById };
      for (const assetId of addedPurged) {
        if (nextAssets[assetId]) {
          nextAssets[assetId] = { ...nextAssets[assetId], storageState: 'purged' };
        }
      }
      return {
        ...state,
        document: {
          ...doc,
          trash: [],
          purgedAssetIds: nextPurged,
          assetsById: nextAssets,
          layersById: reconcilePurgedAssetReferences(doc.layersById, nextPurged),
          updatedAt: now
        }
      };
    }

    case 'CREATE_COLLECTION': {
      const trimmed = action.name.trim();
      if (!trimmed) return state;
      const colId = `col-${doc.nextSequence}`;
      const newCollection: StudioCollection = {
        id: colId,
        name: trimmed,
        description: action.description?.trim() ?? '',
        createdAt: now
      };
      return {
        document: {
          ...doc,
          collections: [...doc.collections, newCollection],
          activeCollectionId: colId,
          nextSequence: doc.nextSequence + 1,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Create collection ${trimmed}`, now),
        historyFuture: []
      };
    }

    case 'SET_ACTIVE_COLLECTION': {
      if (
        doc.activeCollectionId === action.collectionId ||
        !doc.collections.some(c => c.id === action.collectionId)
      ) {
        return state;
      }
      return {
        ...state,
        document: {
          ...doc,
          activeCollectionId: action.collectionId,
          updatedAt: now
        }
      };
    }

    case 'RENAME_COLLECTION': {
      const trimmed = action.name.trim();
      if (!trimmed) return state;
      const exists = doc.collections.some(c => c.id === action.collectionId);
      if (!exists) return state;
      return {
        document: {
          ...doc,
          collections: doc.collections.map(c =>
            c.id === action.collectionId ? { ...c, name: trimmed } : c
          ),
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Rename collection to ${trimmed}`, now),
        historyFuture: []
      };
    }

    case 'UPDATE_CONCEPT': {
      const nextConcept: StructuredConceptAttributes = {
        ...doc.concept,
        ...action.patch
      };
      const record = action.recordHistory === true;
      return {
        document: {
          ...doc,
          concept: nextConcept,
          updatedAt: now
        },
        historyPast: record ? pushStudioHistory(state, 'Update creative concept', now) : state.historyPast,
        historyFuture: record ? [] : state.historyFuture
      };
    }

    case 'ADD_AI_CANDIDATES': {
      if (action.candidates.length === 0) return state;
      return {
        ...state,
        document: {
          ...doc,
          aiCandidates: [...action.candidates, ...doc.aiCandidates].slice(0, 24),
          selectedCandidateId: action.candidates[0].id,
          updatedAt: now
        }
      };
    }

    case 'SELECT_AI_CANDIDATE': {
      return {
        ...state,
        document: {
          ...doc,
          selectedCandidateId: action.candidateId
        }
      };
    }

    case 'APPLY_AI_CANDIDATE_TO_BOARD': {
      const candidate = doc.aiCandidates.find(c => c.id === action.candidateId);
      if (!candidate || candidate.operationOutcome === 'failed-operation') return state;

      const cardId = `layer-ai-concept-${doc.nextSequence}`;
      const existingCount = Object.values(doc.layersById).filter(
        l => l.collectionId === doc.activeCollectionId
      ).length;
      const offset = (existingCount % 5) * 32;

      const conceptCard: StudioLayer = {
        id: cardId,
        type: 'garment-silhouette-card',
        name: candidate.title,
        parentId: null,
        order: getNextRootOrder(doc.layersById, doc.activeCollectionId, null),
        visible: true,
        locked: false,
        opacity: 1,
        transform: {
          x: 120 + offset,
          y: 90 + offset,
          width: 280,
          height: 340,
          rotationDeg: 0,
          scaleX: 1,
          scaleY: 1
        },
        collectionId: doc.activeCollectionId,
        authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
        isDemonstrationContent: candidate.operationOutcome === 'demonstration-result',
        title: candidate.title,
        garmentCategory: candidate.garmentCategory,
        silhouette: candidate.silhouette,
        easeProfile: candidate.easeProfile,
        lengthCm: candidate.lengthCm,
        colorHex: candidate.colorHex,
        colorName: candidate.colorName,
        fabricName: candidate.fabricName,
        isUnverifiedConceptVisual: true,
        createdAt: now,
        updatedAt: now
      };

      const nextConcept: StructuredConceptAttributes = {
        ...doc.concept,
        title: candidate.title,
        garmentCategory: candidate.garmentCategory,
        silhouette: candidate.silhouette,
        fabricId: candidate.fabricId,
        colorName: candidate.colorName,
        colorHex: candidate.colorHex,
        easeProfile: candidate.easeProfile,
        lengthCm: candidate.lengthCm,
        constructionFeatures: candidate.constructionFeatures.map(f => ({ ...f })),
        constructionNotes: [...candidate.designNotes]
      };

      return {
        document: {
          ...doc,
          hasInitializedBoard: true,
          layersById: normalizeSiblingOrders({ ...doc.layersById, [cardId]: conceptCard }),
          concept: nextConcept,
          aiCandidates: doc.aiCandidates.map(c =>
            c.id === candidate.id ? { ...c, appliedToBoardAt: now } : c
          ),
          nextSequence: doc.nextSequence + 1,
          updatedAt: now
        },
        historyPast: pushStudioHistory(state, `Apply concept "${candidate.title}" to board`, now),
        historyFuture: []
      };
    }

    case 'SET_CAMERA': {
      const nextCamera: StudioCanvasCamera = {
        zoom: action.camera.zoom !== undefined ? clampStudioZoom(action.camera.zoom) : doc.camera.zoom,
        panX: action.camera.panX !== undefined ? roundCoord(action.camera.panX) : doc.camera.panX,
        panY: action.camera.panY !== undefined ? roundCoord(action.camera.panY) : doc.camera.panY
      };
      if (
        nextCamera.zoom === doc.camera.zoom &&
        nextCamera.panX === doc.camera.panX &&
        nextCamera.panY === doc.camera.panY
      ) {
        return state;
      }
      return {
        ...state,
        document: {
          ...doc,
          camera: nextCamera
        }
      };
    }

    case 'UNDO': {
      if (state.historyPast.length === 0) return state;
      const previous = state.historyPast[state.historyPast.length - 1];
      const redoEntry: StudioHistoryEntry = {
        id: `redo-${previous.id}`,
        actionLabel: previous.actionLabel,
        timestamp: now,
        snapshot: captureDocumentSnapshot(doc)
      };

      // C4: Reconcile any layer referencing a permanently purged asset so Undo never pretends purged binary data still exists
      const reconciledLayers = reconcilePurgedAssetReferences(
        normalizeSiblingOrders(structuredClone(previous.snapshot.layersById)),
        doc.purgedAssetIds
      );

      return {
        document: {
          ...doc,
          layersById: reconciledLayers,
          collections: structuredClone(previous.snapshot.collections),
          activeCollectionId: previous.snapshot.activeCollectionId,
          concept: structuredClone(previous.snapshot.concept),
          trash: structuredClone(previous.snapshot.trash),
          updatedAt: now
        },
        historyPast: state.historyPast.slice(0, -1),
        historyFuture: [redoEntry, ...state.historyFuture].slice(0, MAX_STUDIO_HISTORY_ENTRIES)
      };
    }

    case 'REDO': {
      if (state.historyFuture.length === 0) return state;
      const next = state.historyFuture[0];
      const undoEntry: StudioHistoryEntry = {
        id: `undo-${next.id}`,
        actionLabel: next.actionLabel,
        timestamp: now,
        snapshot: captureDocumentSnapshot(doc)
      };

      const reconciledLayers = reconcilePurgedAssetReferences(
        normalizeSiblingOrders(structuredClone(next.snapshot.layersById)),
        doc.purgedAssetIds
      );

      return {
        document: {
          ...doc,
          layersById: reconciledLayers,
          collections: structuredClone(next.snapshot.collections),
          activeCollectionId: next.snapshot.activeCollectionId,
          concept: structuredClone(next.snapshot.concept),
          trash: structuredClone(next.snapshot.trash),
          updatedAt: now
        },
        historyPast: [...state.historyPast, undoEntry].slice(-MAX_STUDIO_HISTORY_ENTRIES),
        historyFuture: state.historyFuture.slice(1)
      };
    }
  }
}
