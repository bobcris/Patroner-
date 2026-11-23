/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react';
import {
  useProjectWorkspace,
  validateReferenceImageFile
} from '../../state/ProjectWorkspaceContext';
import {
  AiServiceStatusInfo,
  ConceptVariationBatchResult,
  generateConceptVariations,
  resolveAiServiceAvailability
} from '../../services/ai/fashion-service';
import {
  AlignmentAxis,
  CreativeStudioDocument,
  CreativeStudioState,
  DerivedLayerTreeNode,
  LayerTransform,
  NormalizedCropRect,
  PaletteSwatch,
  PromotionFieldSelection,
  ReferenceImageLayer,
  SketchStroke,
  StructuredConceptAttributes,
  StudioAssetMetadata,
  StudioAutosaveStatus,
  StudioCanvasCamera,
  StudioLayer,
  StudioPersistenceMode
} from './types';
import {
  buildPromotedDesignSpecDraft,
  createInitialStudioState,
  creativeStudioReducer,
  deriveFlattenedRenderOrder,
  deriveLayerTree,
  migrateAndRecoverStudioDocument
} from './studio-reducer';
import {
  StudioAssetStore,
  blobToDataUrl,
  computeLocalStudioAssetHash,
  createStudioAssetStore
} from './asset-storage';

export const DEFAULT_STUDIO_PROJECT_ID = 'project-patroner-default';
const AUTOSAVE_DEBOUNCE_MS = 600;

async function decodeImageDimensions(blob: Blob): Promise<{ width: number; height: number; decodeMs: number }> {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const result = {
        width: bitmap.width || 600,
        height: bitmap.height || 800,
        decodeMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start
      };
      bitmap.close();
      return result;
    } catch {
      // Fallback to HTMLImageElement
    }
  }
  if (typeof Image !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const dims = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 600, height: img.naturalHeight || 800 });
        img.onerror = () => resolve({ width: 600, height: 800 });
        img.src = objectUrl;
      });
      return {
        ...dims,
        decodeMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  return { width: 600, height: 800, decodeMs: 0 };
}

export interface UploadResultSummary {
  addedLayerIds: string[];
  errors: string[];
  avgDecodeMs: number;
}

export interface CreativeStudioContextValue {
  state: CreativeStudioState;
  document: CreativeStudioDocument;
  activeCollectionLayers: StudioLayer[];
  layerTree: DerivedLayerTreeNode[];
  canUndo: boolean;
  canRedo: boolean;
  lastUndoLabel: string | null;
  lastRedoLabel: string | null;

  // Persistence & recovery state (C3 + D3)
  isHydrated: boolean;
  persistenceMode: StudioPersistenceMode;
  storageWarning: string | null;
  recoveryBanner: string | null;
  dismissRecoveryBanner: () => void;
  autosaveStatus: StudioAutosaveStatus;
  lastSavedAt: string | null;
  assetUrlsById: Record<string, string>;

  // AI service status (C2 + D4)
  aiServiceStatus: AiServiceStatusInfo;
  isGeneratingVariations: boolean;
  lastAiBatchResult: ConceptVariationBatchResult | null;

  // Board initialization & explicit clear (D1 + D3)
  createEmptyMoodboard: () => void;
  loadAtelierStarterBoard: () => void;
  clearBoard: () => Promise<void>;

  // Layer & asset mutations
  uploadReferenceFiles: (
    files: FileList | readonly File[],
    worldOrigin?: { x: number; y: number }
  ) => Promise<UploadResultSummary>;
  replaceImageLayerAsset: (layerId: string, file: File) => Promise<{ ok: boolean; error?: string }>;
  addMoodboardCard: (pos?: { x: number; y: number }) => string;
  addColorPaletteLayer: (pos?: { x: number; y: number }) => string;
  addFabricSwatchLayer: (fabricId: string, pos?: { x: number; y: number }) => string;
  addAnnotationNote: (pos?: { x: number; y: number }, text?: string) => string;
  addFreehandSketchStroke: (stroke: SketchStroke, existingSketchLayerId?: string | null) => string;
  commitLayerTransforms: (updates: Record<string, Partial<LayerTransform>>, label?: string) => void;
  updateLayerProps: (layerId: string, patch: Partial<StudioLayer>, label?: string) => void;
  setImageCrop: (layerId: string, crop: Partial<NormalizedCropRect>) => void;
  updatePaletteSwatches: (layerId: string, swatches: PaletteSwatch[]) => void;
  toggleLayerVisibility: (layerId: string) => void;
  toggleLayerLock: (layerId: string) => void;
  renameLayer: (layerId: string, name: string) => void;
  reorderLayer: (layerId: string, direction: 'up' | 'down' | 'top' | 'bottom') => void;
  reparentLayer: (layerId: string, newParentId: string | null, targetOrder?: number) => void;
  groupLayers: (layerIds: string[], groupName?: string) => void;
  ungroupLayer: (groupId: string) => void;
  duplicateLayers: (layerIds: string[]) => void;
  alignLayers: (layerIds: string[], axis: AlignmentAxis) => void;
  softDeleteLayers: (layerIds: string[]) => void;
  restoreTrashItem: (trashId: string) => void;
  purgeTrashItem: (trashId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;

  // Collections
  createCollection: (name: string, description?: string) => void;
  setActiveCollection: (collectionId: string) => void;
  renameCollection: (collectionId: string, name: string) => void;

  // Brief, AI Gallery & Explicit Atelier Handoff (C2 + C8)
  updateConcept: (patch: Partial<StructuredConceptAttributes>, recordHistory?: boolean) => void;
  generateVariations: () => Promise<ConceptVariationBatchResult>;
  selectAiCandidate: (candidateId: string | null) => void;
  applyAiCandidateToBoard: (candidateId: string) => void;
  promoteConceptToAtelier: (selection: PromotionFieldSelection) => void;

  // Camera & Document History
  setStudioCamera: (patch: Partial<StudioCanvasCamera>) => void;
  undoStudio: () => void;
  redoStudio: () => void;
  exportRecoveryBundleJson: () => Promise<string>;
  forceFlushAutosave: () => Promise<number>;
}

const CreativeStudioContext = createContext<CreativeStudioContextValue | null>(null);

export const CreativeStudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    currentSpec,
    updateSpec,
    setReferenceImage,
    updateStudioDraftBrief
  } = useProjectWorkspace();

  const [state, dispatch] = useReducer(
    creativeStudioReducer,
    { projectId: DEFAULT_STUDIO_PROJECT_ID, spec: currentSpec },
    createInitialStudioState
  );

  const storeRef = useRef<StudioAssetStore | null>(null);
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const [assetUrlsById, setAssetUrlsById] = useState<Record<string, string>>({});
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [persistenceMode, setPersistenceMode] = useState<StudioPersistenceMode>('indexeddb');
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [recoveryBanner, setRecoveryBanner] = useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<StudioAutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isGeneratingVariations, setIsGeneratingVariations] = useState<boolean>(false);
  const [lastAiBatchResult, setLastAiBatchResult] = useState<ConceptVariationBatchResult | null>(null);

  const aiServiceStatus = useMemo(() => resolveAiServiceAvailability(), []);

  const hydrateAssetObjectUrls = useCallback(async (doc: CreativeStudioDocument, store: StudioAssetStore) => {
    const referencedAssetIds = new Set<string>();
    for (const layer of Object.values(doc.layersById)) {
      if (layer.type === 'reference-image') {
        referencedAssetIds.add(layer.assetId);
      }
    }
    for (const assetId of Object.keys(doc.assetsById)) {
      referencedAssetIds.add(assetId);
    }

    const nextUrls: Record<string, string> = {};
    for (const assetId of referencedAssetIds) {
      if (doc.purgedAssetIds.includes(assetId)) continue;
      const existing = objectUrlsRef.current.get(assetId);
      if (existing) {
        nextUrls[assetId] = existing;
        continue;
      }
      const blob = await store.getAssetBlob(assetId);
      if (blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.set(assetId, url);
        nextUrls[assetId] = url;
      }
    }
    setAssetUrlsById(prev => ({ ...prev, ...nextUrls }));
  }, []);

  // Phase 2: Hydrate from IndexedDB (or Memory fallback per C3) once on mount.
  // Because this provider lives above VisualStudioShell, WorkspaceErrorBoundary resets NEVER wipe IndexedDB (D3).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await createStudioAssetStore();
      if (cancelled) return;
      storeRef.current = store;
      setPersistenceMode(store.persistenceMode);
      setStorageWarning(store.storageWarning);

      try {
        const loaded = await store.loadDocument(DEFAULT_STUDIO_PROJECT_ID);
        if (cancelled) return;
        if (loaded) {
          const { document: safeDoc, recovered, recoveryNotes } = migrateAndRecoverStudioDocument(
            loaded,
            { projectId: DEFAULT_STUDIO_PROJECT_ID, spec: currentSpec }
          );

          // Check whether any active reference-image layer's Blob is missing from store
          const checkedLayers: Record<string, StudioLayer> = { ...safeDoc.layersById };
          for (const [id, layer] of Object.entries(checkedLayers)) {
            if (layer.type === 'reference-image' && !layer.missingAssetReason) {
              const hasBlob = await store.hasAssetBlob(layer.assetId);
              if (!hasBlob) {
                checkedLayers[id] = {
                  ...layer,
                  missingAssetReason: safeDoc.purgedAssetIds.includes(layer.assetId)
                    ? 'permanently-purged'
                    : store.persistenceMode === 'memory-session-only'
                      ? 'session-only-expired'
                      : 'storage-unavailable'
                };
              }
            }
          }

          const finalDoc: CreativeStudioDocument = { ...safeDoc, layersById: checkedLayers };
          dispatch({ type: 'HYDRATE_DOCUMENT', document: finalDoc });
          await hydrateAssetObjectUrls(finalDoc, store);
          if (recovered && recoveryNotes.length > 0) {
            setRecoveryBanner(recoveryNotes[0]);
          }
          setAutosaveStatus(
            store.persistenceMode === 'indexeddb' ? 'saved-indexeddb' : 'session-only-memory'
          );
          setLastSavedAt(finalDoc.updatedAt);
        } else {
          setAutosaveStatus(
            store.persistenceMode === 'indexeddb' ? 'idle' : 'session-only-memory'
          );
        }
      } catch (err) {
        if (!cancelled) {
          setRecoveryBanner(
            `Recovered clean studio workspace after storage read error (${err instanceof Error ? err.message : 'unknown'}).`
          );
        }
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
      for (const url of objectUrlsRef.current.values()) {
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(url);
        }
      }
      objectUrlsRef.current.clear();
    };
    // Intentionally run once on mount; project spec updates do not re-hydrate or wipe the board
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave to IndexedDB / session memory
  const docRef = useRef(state.document);
  docRef.current = state.document;

  const persistDocumentNow = useCallback(async (docToSave: CreativeStudioDocument): Promise<number> => {
    const store = storeRef.current;
    if (!store) return 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setAutosaveStatus('saving');
    try {
      const result = await store.saveDocument(docToSave);
      setAutosaveStatus(result.persistedToIndexedDb ? 'saved-indexeddb' : 'session-only-memory');
      setLastSavedAt(new Date().toISOString());
      return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    } catch {
      setAutosaveStatus('save-error');
      return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || !storeRef.current) return;
    const timer = window.setTimeout(() => {
      void persistDocumentNow(docRef.current);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state.document, isHydrated, persistDocumentNow]);

  // Derived views (C1)
  const activeCollectionLayers = useMemo(
    () =>
      deriveFlattenedRenderOrder(state.document.layersById, state.document.activeCollectionId, {
        onlyVisible: false
      }),
    [state.document.layersById, state.document.activeCollectionId]
  );

  const layerTree = useMemo(
    () => deriveLayerTree(state.document.layersById, state.document.activeCollectionId, { topFirst: true }),
    [state.document.layersById, state.document.activeCollectionId]
  );

  // Actions
  const createEmptyMoodboard = useCallback(() => {
    dispatch({ type: 'INITIALIZE_EMPTY_MOODBOARD' });
  }, []);

  const loadAtelierStarterBoard = useCallback(() => {
    dispatch({ type: 'LOAD_ATELIER_STARTER_BOARD', spec: currentSpec });
  }, [currentSpec]);

  const clearBoard = useCallback(async () => {
    dispatch({ type: 'CLEAR_BOARD', spec: currentSpec });
    setReferenceImage(null);
    const store = storeRef.current;
    if (store) {
      await store.deleteDocument(DEFAULT_STUDIO_PROJECT_ID);
    }
  }, [currentSpec, setReferenceImage]);

  const uploadReferenceFiles = useCallback(
    async (
      files: FileList | readonly File[],
      worldOrigin?: { x: number; y: number }
    ): Promise<UploadResultSummary> => {
      const list = Array.from(files);
      const errors: string[] = [];
      const addedLayers: ReferenceImageLayer[] = [];
      const decodeTimes: number[] = [];

      let store = storeRef.current;
      if (!store) {
        store = await createStudioAssetStore();
        storeRef.current = store;
        setPersistenceMode(store.persistenceMode);
        setStorageWarning(store.storageWarning);
      }

      const baseX = worldOrigin?.x ?? 100;
      const baseY = worldOrigin?.y ?? 80;
      const nowIso = new Date().toISOString();
      let placedIndex = 0;

      for (const file of list) {
        const validation = validateReferenceImageFile(file);
        if (!validation.valid) {
          errors.push(validation.error ?? `Rejected "${file.name}".`);
          continue;
        }

        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const localContentHash = await computeLocalStudioAssetHash(bytes);
        const existingAssetId = await store.findAssetIdByLocalHash(localContentHash);
        const dims = await decodeImageDimensions(file);
        decodeTimes.push(dims.decodeMs);

        let assetMeta: StudioAssetMetadata;
        if (existingAssetId && docRef.current.assetsById[existingAssetId]) {
          assetMeta = docRef.current.assetsById[existingAssetId];
        } else {
          const assetId = `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
          const rawMeta: StudioAssetMetadata = {
            assetId,
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            naturalWidth: dims.width,
            naturalHeight: dims.height,
            localContentHash,
            storageState: store.persistenceMode === 'indexeddb' ? 'indexeddb-persisted' : 'memory-session-only',
            createdAt: nowIso
          };
          assetMeta = await store.putAsset({ assetId, blob: file, metadata: rawMeta });
          dispatch({ type: 'REGISTER_ASSET_METADATA', asset: assetMeta });
        }

        // Create object URL for fast DOM <img> rendering
        if (!objectUrlsRef.current.has(assetMeta.assetId)) {
          const url = URL.createObjectURL(file);
          objectUrlsRef.current.set(assetMeta.assetId, url);
          setAssetUrlsById(prev => ({ ...prev, [assetMeta.assetId]: url }));
        }

        const aspect = dims.width > 0 && dims.height > 0 ? dims.width / dims.height : 0.8;
        const targetW = aspect >= 1 ? 300 : Math.max(180, Math.round(320 * aspect));
        const targetH = Math.max(160, Math.round(targetW / aspect));
        const col = placedIndex % 3;
        const row = Math.floor(placedIndex / 3);
        const layerId = `layer-ref-${Date.now().toString(36)}-${placedIndex}-${Math.random().toString(36).slice(2, 5)}`;

        addedLayers.push({
          id: layerId,
          type: 'reference-image',
          name: file.name.replace(/\.[^/.]+$/, '') || file.name,
          parentId: null,
          order: 0,
          visible: true,
          locked: false,
          opacity: 1,
          transform: {
            x: Math.round(baseX + col * 330),
            y: Math.round(baseY + row * 350),
            width: targetW,
            height: targetH,
            rotationDeg: 0,
            scaleX: 1,
            scaleY: 1
          },
          collectionId: docRef.current.activeCollectionId,
          authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
          assetId: assetMeta.assetId,
          assetName: assetMeta.name,
          mimeType: assetMeta.mimeType,
          naturalWidth: assetMeta.naturalWidth,
          naturalHeight: assetMeta.naturalHeight,
          sizeBytes: assetMeta.sizeBytes,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          tags: ['reference'],
          createdAt: nowIso,
          updatedAt: nowIso
        });

        // Sync first uploaded image with ProjectWorkspaceContext.referenceImage for backward compatibility
        if (placedIndex === 0) {
          try {
            const dataUrl = await blobToDataUrl(file);
            setReferenceImage({
              name: file.name,
              dataUrl,
              mimeType: file.type,
              sizeBytes: file.size
            });
          } catch {
            // Non-fatal compatibility sync
          }
        }
        placedIndex += 1;
      }

      if (addedLayers.length > 0) {
        dispatch({
          type: 'ADD_LAYERS_BATCH',
          layers: addedLayers,
          label:
            addedLayers.length === 1
              ? `Add reference "${addedLayers[0].assetName}"`
              : `Upload ${addedLayers.length} reference images`,
          nowIso
        });
      }

      const avgDecodeMs =
        decodeTimes.length > 0
          ? decodeTimes.reduce((sum, v) => sum + v, 0) / decodeTimes.length
          : 0;

      return {
        addedLayerIds: addedLayers.map(l => l.id),
        errors,
        avgDecodeMs
      };
    },
    [setReferenceImage]
  );

  const replaceImageLayerAsset = useCallback(
    async (layerId: string, file: File): Promise<{ ok: boolean; error?: string }> => {
      const validation = validateReferenceImageFile(file);
      if (!validation.valid) {
        return { ok: false, error: validation.error };
      }
      const store = storeRef.current ?? (await createStudioAssetStore());
      storeRef.current = store;

      const bytes = new Uint8Array(await file.arrayBuffer());
      const localContentHash = await computeLocalStudioAssetHash(bytes);
      const dims = await decodeImageDimensions(file);
      const assetId = `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const savedMeta = await store.putAsset({
        assetId,
        blob: file,
        metadata: {
          assetId,
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          naturalWidth: dims.width,
          naturalHeight: dims.height,
          localContentHash,
          storageState: store.persistenceMode === 'indexeddb' ? 'indexeddb-persisted' : 'memory-session-only',
          createdAt: new Date().toISOString()
        }
      });
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.set(assetId, url);
      setAssetUrlsById(prev => ({ ...prev, [assetId]: url }));
      dispatch({ type: 'REPLACE_IMAGE_ASSET', layerId, asset: savedMeta });
      return { ok: true };
    },
    []
  );

  const addMoodboardCard = useCallback((pos?: { x: number; y: number }): string => {
    const id = `layer-mood-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const nowIso = new Date().toISOString();
    const count = Object.keys(docRef.current.layersById).length;
    const layer: StudioLayer = {
      id,
      type: 'moodboard-card',
      name: `Direction Card ${count + 1}`,
      parentId: null,
      order: 0,
      visible: true,
      locked: false,
      opacity: 1,
      transform: {
        x: pos?.x ?? 110 + (count % 5) * 32,
        y: pos?.y ?? 90 + (count % 4) * 28,
        width: 300,
        height: 200,
        rotationDeg: 0,
        scaleX: 1,
        scaleY: 1
      },
      collectionId: docRef.current.activeCollectionId,
      authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
      title: 'Atelier Mood Direction',
      subtitle: `${docRef.current.concept.garmentCategory} · ${docRef.current.concept.silhouette}`,
      notes: 'Capture silhouette cues, drape intent, and proportion references here.',
      accentHex: docRef.current.concept.colorHex || '#1C212D',
      tags: ['direction'],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    dispatch({ type: 'ADD_LAYER', layer, label: 'Add moodboard card', nowIso });
    return id;
  }, []);

  const addColorPaletteLayer = useCallback((pos?: { x: number; y: number }): string => {
    const id = `layer-palette-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const nowIso = new Date().toISOString();
    const count = Object.keys(docRef.current.layersById).length;
    const layer: StudioLayer = {
      id,
      type: 'color-palette',
      name: `Color Palette ${count + 1}`,
      parentId: null,
      order: 0,
      visible: true,
      locked: false,
      opacity: 1,
      transform: {
        x: pos?.x ?? 140 + (count % 5) * 28,
        y: pos?.y ?? 260 + (count % 4) * 24,
        width: 320,
        height: 148,
        rotationDeg: 0,
        scaleX: 1,
        scaleY: 1
      },
      collectionId: docRef.current.activeCollectionId,
      authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
      title: 'Seasonal Colorway',
      swatches: [
        { id: `sw-${id}-1`, name: docRef.current.concept.colorName || 'Chalk Oatmeal', hex: docRef.current.concept.colorHex || '#E8E3D9', role: 'primary' },
        { id: `sw-${id}-2`, name: 'Midnight Ink', hex: '#1C212D', role: 'secondary' },
        { id: `sw-${id}-3`, name: 'Warm Clay', hex: '#A58E78', role: 'accent' },
        { id: `sw-${id}-4`, name: 'Silk Mist', hex: '#EDEAE3', role: 'lining' }
      ],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    dispatch({ type: 'ADD_LAYER', layer, label: 'Add color palette', nowIso });
    return id;
  }, []);

  const addFabricSwatchLayer = useCallback(
    (fabricId: string, pos?: { x: number; y: number }): string => {
      const id = `layer-fabric-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      const nowIso = new Date().toISOString();
      const count = Object.keys(docRef.current.layersById).length;
      const fabric =
        currentSpec.fabric.id === fabricId
          ? currentSpec.fabric
          : {
              id: fabricId,
              name: fabricId,
              composition: 'Atelier Woven Textile',
              weight: 'medium' as const,
              stretch: 'none' as const,
              drapeDescription: 'Balanced woven structure.'
            };
      const layer: StudioLayer = {
        id,
        type: 'fabric-swatch',
        name: `Swatch · ${fabric.name}`,
        parentId: null,
        order: 0,
        visible: true,
        locked: false,
        opacity: 1,
        transform: {
          x: pos?.x ?? 220 + (count % 5) * 24,
          y: pos?.y ?? 140 + (count % 4) * 24,
          width: 240,
          height: 170,
          rotationDeg: 0,
          scaleX: 1,
          scaleY: 1
        },
        collectionId: docRef.current.activeCollectionId,
        authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
        fabricId: fabric.id,
        fabricName: fabric.name,
        composition: fabric.composition,
        weightLabel: `${fabric.weight} · ${fabric.stretch}`,
        drapeNote: fabric.drapeDescription,
        swatchHex: docRef.current.concept.colorHex || '#E8E3D9',
        createdAt: nowIso,
        updatedAt: nowIso
      };
      dispatch({ type: 'ADD_LAYER', layer, label: `Add fabric swatch ${fabric.name}`, nowIso });
      return id;
    },
    [currentSpec.fabric]
  );

  const addAnnotationNote = useCallback((pos?: { x: number; y: number }, text?: string): string => {
    const id = `layer-note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const nowIso = new Date().toISOString();
    const count = Object.keys(docRef.current.layersById).length;
    const layer: StudioLayer = {
      id,
      type: 'annotation-note',
      name: `Visual Note ${count + 1}`,
      parentId: null,
      order: 0,
      visible: true,
      locked: false,
      opacity: 1,
      transform: {
        x: pos?.x ?? 180 + (count % 5) * 30,
        y: pos?.y ?? 160 + (count % 4) * 30,
        width: 230,
        height: 132,
        rotationDeg: 0,
        scaleX: 1,
        scaleY: 1
      },
      collectionId: docRef.current.activeCollectionId,
      authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
      text: text?.trim() || 'Visual styling callout (unverified non-CAD note).',
      tone: 'atelier',
      verificationStatus: 'UNVERIFIED_FREEFORM_OVERLAY',
      createdAt: nowIso,
      updatedAt: nowIso
    };
    dispatch({ type: 'ADD_LAYER', layer, label: 'Add visual note', nowIso });
    return id;
  }, []);

  const addFreehandSketchStroke = useCallback(
    (stroke: SketchStroke, existingSketchLayerId?: string | null): string => {
      const nowIso = new Date().toISOString();
      if (existingSketchLayerId) {
        const existing = docRef.current.layersById[existingSketchLayerId];
        if (existing && existing.type === 'freehand-sketch' && !existing.locked) {
          dispatch({
            type: 'APPEND_SKETCH_STROKE',
            layerId: existingSketchLayerId,
            stroke,
            nowIso
          });
          return existingSketchLayerId;
        }
      }
      // Compute tight bounding box for new sketch layer
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of stroke.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = 16;
      const originX = Math.round(minX - pad);
      const originY = Math.round(minY - pad);
      const width = Math.max(64, Math.round(maxX - minX + pad * 2));
      const height = Math.max(64, Math.round(maxY - minY + pad * 2));
      const localStroke: SketchStroke = {
        ...stroke,
        points: stroke.points.map(p => ({ x: Math.round((p.x - originX) * 10) / 10, y: Math.round((p.y - originY) * 10) / 10 }))
      };
      const id = `layer-sketch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      const layer: StudioLayer = {
        id,
        type: 'freehand-sketch',
        name: 'Freehand Sketch (Unverified)',
        parentId: null,
        order: 0,
        visible: true,
        locked: false,
        opacity: 1,
        transform: { x: originX, y: originY, width, height, rotationDeg: 0, scaleX: 1, scaleY: 1 },
        collectionId: docRef.current.activeCollectionId,
        authorityTag: 'NON_AUTHORITATIVE_VISUAL_LAYER',
        strokes: [localStroke],
        verificationStatus: 'UNVERIFIED_FREEFORM_OVERLAY',
        createdAt: nowIso,
        updatedAt: nowIso
      };
      dispatch({ type: 'ADD_LAYER', layer, label: 'Add freehand sketch overlay', nowIso });
      return id;
    },
    []
  );

  const commitLayerTransforms = useCallback(
    (updates: Record<string, Partial<LayerTransform>>, label?: string) => {
      dispatch({ type: 'UPDATE_LAYER_TRANSFORMS', updates, label });
    },
    []
  );

  const updateLayerProps = useCallback(
    (layerId: string, patch: Partial<StudioLayer>, label?: string) => {
      dispatch({ type: 'UPDATE_LAYER_PROPS', layerId, patch, label });
    },
    []
  );

  const setImageCrop = useCallback((layerId: string, crop: Partial<NormalizedCropRect>) => {
    dispatch({ type: 'SET_IMAGE_CROP', layerId, crop });
  }, []);

  const updatePaletteSwatches = useCallback((layerId: string, swatches: PaletteSwatch[]) => {
    dispatch({ type: 'UPDATE_PALETTE_SWATCHES', layerId, swatches });
  }, []);

  const toggleLayerVisibility = useCallback((layerId: string) => {
    dispatch({ type: 'TOGGLE_LAYER_VISIBILITY', layerId });
  }, []);

  const toggleLayerLock = useCallback((layerId: string) => {
    dispatch({ type: 'TOGGLE_LAYER_LOCK', layerId });
  }, []);

  const renameLayer = useCallback((layerId: string, name: string) => {
    dispatch({ type: 'RENAME_LAYER', layerId, name });
  }, []);

  const reorderLayer = useCallback((layerId: string, direction: 'up' | 'down' | 'top' | 'bottom') => {
    dispatch({ type: 'REORDER_LAYER', layerId, direction });
  }, []);

  const reparentLayer = useCallback(
    (layerId: string, newParentId: string | null, targetOrder?: number) => {
      dispatch({ type: 'REPARENT_LAYER', layerId, newParentId, targetOrder });
    },
    []
  );

  const groupLayers = useCallback((layerIds: string[], groupName?: string) => {
    dispatch({ type: 'GROUP_LAYERS', layerIds, groupName });
  }, []);

  const ungroupLayer = useCallback((groupId: string) => {
    dispatch({ type: 'UNGROUP_LAYER', groupId });
  }, []);

  const duplicateLayers = useCallback((layerIds: string[]) => {
    dispatch({ type: 'DUPLICATE_LAYERS', layerIds });
  }, []);

  const alignLayers = useCallback((layerIds: string[], axis: AlignmentAxis) => {
    dispatch({ type: 'ALIGN_LAYERS', layerIds, axis });
  }, []);

  const softDeleteLayers = useCallback((layerIds: string[]) => {
    dispatch({ type: 'SOFT_DELETE_LAYERS', layerIds });
  }, []);

  const restoreTrashItem = useCallback((trashId: string) => {
    dispatch({ type: 'RESTORE_TRASH_ITEM', trashId });
  }, []);

  const collectSafePurgeableAssets = useCallback((targetTrashIds: Set<string>): string[] => {
    const doc = docRef.current;
    const candidateAssetIds = new Set<string>();
    for (const item of doc.trash) {
      if (!targetTrashIds.has(item.id)) continue;
      for (const layer of item.layers) {
        if (layer.type === 'reference-image') {
          candidateAssetIds.add(layer.assetId);
        }
      }
    }
    // Keep any asset still referenced by an active layer or non-purged trash item
    const stillUsed = new Set<string>();
    for (const layer of Object.values(doc.layersById)) {
      if (layer.type === 'reference-image') stillUsed.add(layer.assetId);
    }
    for (const item of doc.trash) {
      if (targetTrashIds.has(item.id)) continue;
      for (const layer of item.layers) {
        if (layer.type === 'reference-image') stillUsed.add(layer.assetId);
      }
    }
    return Array.from(candidateAssetIds).filter(id => !stillUsed.has(id));
  }, []);

  const purgeTrashItem = useCallback(
    async (trashId: string) => {
      const purgeable = collectSafePurgeableAssets(new Set([trashId]));
      const store = storeRef.current;
      for (const assetId of purgeable) {
        if (store) await store.deleteAssetBlob(assetId);
        const url = objectUrlsRef.current.get(assetId);
        if (url && typeof URL !== 'undefined') {
          URL.revokeObjectURL(url);
          objectUrlsRef.current.delete(assetId);
        }
      }
      if (purgeable.length > 0) {
        setAssetUrlsById(prev => {
          const copy = { ...prev };
          for (const assetId of purgeable) delete copy[assetId];
          return copy;
        });
      }
      dispatch({ type: 'PURGE_TRASH_ITEM', trashId, purgedAssetIds: purgeable });
    },
    [collectSafePurgeableAssets]
  );

  const emptyTrash = useCallback(async () => {
    const allTrashIds = new Set(docRef.current.trash.map(t => t.id));
    const purgeable = collectSafePurgeableAssets(allTrashIds);
    const store = storeRef.current;
    for (const assetId of purgeable) {
      if (store) await store.deleteAssetBlob(assetId);
      const url = objectUrlsRef.current.get(assetId);
      if (url && typeof URL !== 'undefined') {
        URL.revokeObjectURL(url);
        objectUrlsRef.current.delete(assetId);
      }
    }
    if (purgeable.length > 0) {
      setAssetUrlsById(prev => {
        const copy = { ...prev };
        for (const assetId of purgeable) delete copy[assetId];
        return copy;
      });
    }
    dispatch({ type: 'EMPTY_TRASH', purgedAssetIds: purgeable });
  }, [collectSafePurgeableAssets]);

  const createCollection = useCallback((name: string, description?: string) => {
    dispatch({ type: 'CREATE_COLLECTION', name, description });
  }, []);

  const setActiveCollection = useCallback((collectionId: string) => {
    dispatch({ type: 'SET_ACTIVE_COLLECTION', collectionId });
  }, []);

  const renameCollection = useCallback((collectionId: string, name: string) => {
    dispatch({ type: 'RENAME_COLLECTION', collectionId, name });
  }, []);

  const updateConcept = useCallback(
    (patch: Partial<StructuredConceptAttributes>, recordHistory?: boolean) => {
      dispatch({ type: 'UPDATE_CONCEPT', patch, recordHistory });
      // Maintain backward compatibility with ProjectWorkspaceContext.studioDraftBrief
      const briefPatch: Parameters<typeof updateStudioDraftBrief>[0] = {};
      if (patch.creativeBrief !== undefined) briefPatch.prompt = patch.creativeBrief;
      if (patch.garmentCategory !== undefined) briefPatch.category = patch.garmentCategory;
      if (patch.silhouette !== undefined) briefPatch.silhouette = patch.silhouette;
      if (patch.fabricId !== undefined) briefPatch.selectedFabricId = patch.fabricId;
      if (patch.colorName !== undefined || patch.colorHex !== undefined) {
        briefPatch.selectedColor = {
          name: patch.colorName ?? docRef.current.concept.colorName,
          hex: patch.colorHex ?? docRef.current.concept.colorHex
        };
      }
      if (patch.easeProfile !== undefined) briefPatch.easeProfile = patch.easeProfile;
      if (patch.lengthCm !== undefined) briefPatch.lengthCm = patch.lengthCm;
      if (Object.keys(briefPatch).length > 0) {
        updateStudioDraftBrief(briefPatch);
      }
    },
    [updateStudioDraftBrief]
  );

  const generateVariations = useCallback(async (): Promise<ConceptVariationBatchResult> => {
    setIsGeneratingVariations(true);
    try {
      const doc = docRef.current;
      const attachedRefs = Object.values(doc.layersById).filter(
        (l): l is ReferenceImageLayer => l.type === 'reference-image' && !l.missingAssetReason
      );
      const result = await generateConceptVariations({
        brief: doc.concept.creativeBrief,
        title: doc.concept.title,
        category: doc.concept.garmentCategory,
        silhouette: doc.concept.silhouette,
        fabricId: doc.concept.fabricId,
        colorName: doc.concept.colorName,
        colorHex: doc.concept.colorHex,
        easeProfile: doc.concept.easeProfile,
        lengthCm: doc.concept.lengthCm,
        attachedAssetIds: attachedRefs.map(r => r.assetId),
        attachedAssetNames: attachedRefs.map(r => r.assetName)
      });
      setLastAiBatchResult(result);
      if (result.candidates.length > 0) {
        dispatch({ type: 'ADD_AI_CANDIDATES', candidates: result.candidates });
      }
      return result;
    } finally {
      setIsGeneratingVariations(false);
    }
  }, []);

  const selectAiCandidate = useCallback((candidateId: string | null) => {
    dispatch({ type: 'SELECT_AI_CANDIDATE', candidateId });
  }, []);

  const applyAiCandidateToBoard = useCallback((candidateId: string) => {
    dispatch({ type: 'APPLY_AI_CANDIDATE_TO_BOARD', candidateId });
  }, []);

  const promoteConceptToAtelier = useCallback(
    (selection: PromotionFieldSelection) => {
      const draft = buildPromotedDesignSpecDraft({
        currentSpec,
        concept: docRef.current.concept,
        selection
      });
      updateSpec(draft);
    },
    [currentSpec, updateSpec]
  );

  const setStudioCamera = useCallback((camera: Partial<StudioCanvasCamera>) => {
    dispatch({ type: 'SET_CAMERA', camera });
  }, []);

  const undoStudio = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redoStudio = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  const exportRecoveryBundleJson = useCallback(async (): Promise<string> => {
    const store = storeRef.current ?? (await createStudioAssetStore());
    const bundle = await store.exportRecoveryBundle(docRef.current);
    return JSON.stringify(bundle, null, 2);
  }, []);

  const forceFlushAutosave = useCallback(async (): Promise<number> => {
    return persistDocumentNow(docRef.current);
  }, [persistDocumentNow]);

  const dismissRecoveryBanner = useCallback(() => setRecoveryBanner(null), []);

  const value = useMemo<CreativeStudioContextValue>(
    () => ({
      state,
      document: state.document,
      activeCollectionLayers,
      layerTree,
      canUndo: state.historyPast.length > 0,
      canRedo: state.historyFuture.length > 0,
      lastUndoLabel: state.historyPast[state.historyPast.length - 1]?.actionLabel ?? null,
      lastRedoLabel: state.historyFuture[0]?.actionLabel ?? null,
      isHydrated,
      persistenceMode,
      storageWarning,
      recoveryBanner,
      dismissRecoveryBanner,
      autosaveStatus,
      lastSavedAt,
      assetUrlsById,
      aiServiceStatus,
      isGeneratingVariations,
      lastAiBatchResult,
      createEmptyMoodboard,
      loadAtelierStarterBoard,
      clearBoard,
      uploadReferenceFiles,
      replaceImageLayerAsset,
      addMoodboardCard,
      addColorPaletteLayer,
      addFabricSwatchLayer,
      addAnnotationNote,
      addFreehandSketchStroke,
      commitLayerTransforms,
      updateLayerProps,
      setImageCrop,
      updatePaletteSwatches,
      toggleLayerVisibility,
      toggleLayerLock,
      renameLayer,
      reorderLayer,
      reparentLayer,
      groupLayers,
      ungroupLayer,
      duplicateLayers,
      alignLayers,
      softDeleteLayers,
      restoreTrashItem,
      purgeTrashItem,
      emptyTrash,
      createCollection,
      setActiveCollection,
      renameCollection,
      updateConcept,
      generateVariations,
      selectAiCandidate,
      applyAiCandidateToBoard,
      promoteConceptToAtelier,
      setStudioCamera,
      undoStudio,
      redoStudio,
      exportRecoveryBundleJson,
      forceFlushAutosave
    }),
    [
      state,
      activeCollectionLayers,
      layerTree,
      isHydrated,
      persistenceMode,
      storageWarning,
      recoveryBanner,
      dismissRecoveryBanner,
      autosaveStatus,
      lastSavedAt,
      assetUrlsById,
      aiServiceStatus,
      isGeneratingVariations,
      lastAiBatchResult,
      createEmptyMoodboard,
      loadAtelierStarterBoard,
      clearBoard,
      uploadReferenceFiles,
      replaceImageLayerAsset,
      addMoodboardCard,
      addColorPaletteLayer,
      addFabricSwatchLayer,
      addAnnotationNote,
      addFreehandSketchStroke,
      commitLayerTransforms,
      updateLayerProps,
      setImageCrop,
      updatePaletteSwatches,
      toggleLayerVisibility,
      toggleLayerLock,
      renameLayer,
      reorderLayer,
      reparentLayer,
      groupLayers,
      ungroupLayer,
      duplicateLayers,
      alignLayers,
      softDeleteLayers,
      restoreTrashItem,
      purgeTrashItem,
      emptyTrash,
      createCollection,
      setActiveCollection,
      renameCollection,
      updateConcept,
      generateVariations,
      selectAiCandidate,
      applyAiCandidateToBoard,
      promoteConceptToAtelier,
      setStudioCamera,
      undoStudio,
      redoStudio,
      exportRecoveryBundleJson,
      forceFlushAutosave
    ]
  );

  return (
    <CreativeStudioContext.Provider value={value}>
      {children}
    </CreativeStudioContext.Provider>
  );
};

export function useCreativeStudio(): CreativeStudioContextValue {
  const ctx = useContext(CreativeStudioContext);
  if (!ctx) {
    throw new Error('useCreativeStudio must be used inside CreativeStudioProvider');
  }
  return ctx;
}

export function useOptionalCreativeStudio(): CreativeStudioContextValue | null {
  return useContext(CreativeStudioContext);
}
