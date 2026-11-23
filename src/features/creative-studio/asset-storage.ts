/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreativeStudioDocument,
  StudioAssetMetadata,
  StudioPersistenceMode
} from './types';

/**
 * C3 + C4 + C5 — Creative Studio Binary Asset & Document Storage Layer
 *
 * - IndexedDB (`patroner-studio-db`) is the primary persistent store for immutable image Blobs
 *   and CreativeStudioDocument JSON records.
 * - If IndexedDB is unavailable or fails to open, falls back cleanly to an in-memory Blob store
 *   explicitly flagged as `memory-session-only` (never claiming persistence).
 * - Local content hashes are prefixed `studio-asset-local:` and strictly isolated from
 *   authoritative engineering, specification, measurement approval, or certification hashes (C5).
 * - Provides explicit recovery JSON bundle export so session-only users never silently lose data.
 */

export const STUDIO_DB_NAME = 'patroner-studio-db';
export const STUDIO_DB_VERSION = 1;
export const STORE_ASSETS = 'assets';
export const STORE_DOCUMENTS = 'documents';

interface StoredAssetEntry {
  assetId: string;
  blob: Blob;
  metadata: StudioAssetMetadata;
}

export interface StudioRecoveryBundle {
  bundleType: 'PATRONER_CREATIVE_STUDIO_RECOVERY_V1';
  exportedAt: string;
  persistenceMode: StudioPersistenceMode;
  document: CreativeStudioDocument;
  embeddedAssets: Array<{
    metadata: StudioAssetMetadata;
    dataUrl: string;
  }>;
}

/**
 * Deterministic local content hash for deduplication & asset integrity ONLY (C5).
 * Explicitly tagged `studio-asset-local:` and never mixed with engineering fingerprints.
 */
export async function computeLocalStudioAssetHash(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    try {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
      const hex = Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      return `studio-asset-local:sha256:${hex}`;
    } catch {
      // Fall through to deterministic FNV-1a 64-bit pair fallback
    }
  }

  // Deterministic non-cryptographic fallback when WebCrypto subtle is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= bytes[i] ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `studio-asset-local:fnv:${part1}${part2}-${bytes.length}`;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Failed to serialize Blob to data URL'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
      reader.readAsDataURL(blob);
      return;
    }
    // Node/test environment fallback
    blob
      .arrayBuffer()
      .then(buf => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
        resolve(`data:${blob.type || 'application/octet-stream'};base64,${b64}`);
      })
      .catch(reject);
  });
}

export interface StudioAssetStore {
  readonly persistenceMode: StudioPersistenceMode;
  readonly storageWarning: string | null;

  putAsset(asset: {
    assetId: string;
    blob: Blob;
    metadata: StudioAssetMetadata;
  }): Promise<StudioAssetMetadata>;

  getAssetBlob(assetId: string): Promise<Blob | null>;
  hasAssetBlob(assetId: string): Promise<boolean>;
  deleteAssetBlob(assetId: string): Promise<void>;
  findAssetIdByLocalHash(localContentHash: string): Promise<string | null>;

  saveDocument(doc: CreativeStudioDocument): Promise<{ persistedToIndexedDb: boolean }>;
  loadDocument(projectId: string): Promise<CreativeStudioDocument | null>;
  deleteDocument(projectId: string): Promise<void>;

  exportRecoveryBundle(doc: CreativeStudioDocument): Promise<StudioRecoveryBundle>;
}

/**
 * Pure in-memory session-only Blob store (C3 fallback and unit-test store).
 * Explicitly labels all assets as `memory-session-only` and never claims persistence.
 */
export class MemoryStudioAssetStore implements StudioAssetStore {
  public readonly persistenceMode: StudioPersistenceMode = 'memory-session-only';
  public readonly storageWarning: string;

  private readonly assets = new Map<string, StoredAssetEntry>();
  private readonly documents = new Map<string, CreativeStudioDocument>();

  constructor(reason?: string) {
    this.storageWarning =
      reason ??
      'Browser IndexedDB storage is unavailable. Reference images and studio boards are stored in session memory only and will be lost on reload unless exported.';
  }

  async putAsset(asset: {
    assetId: string;
    blob: Blob;
    metadata: StudioAssetMetadata;
  }): Promise<StudioAssetMetadata> {
    const metadata: StudioAssetMetadata = {
      ...asset.metadata,
      storageState: 'memory-session-only'
    };
    this.assets.set(asset.assetId, {
      assetId: asset.assetId,
      blob: asset.blob,
      metadata
    });
    return metadata;
  }

  async getAssetBlob(assetId: string): Promise<Blob | null> {
    return this.assets.get(assetId)?.blob ?? null;
  }

  async hasAssetBlob(assetId: string): Promise<boolean> {
    return this.assets.has(assetId);
  }

  async deleteAssetBlob(assetId: string): Promise<void> {
    this.assets.delete(assetId);
  }

  async findAssetIdByLocalHash(localContentHash: string): Promise<string | null> {
    for (const entry of this.assets.values()) {
      if (entry.metadata.localContentHash === localContentHash) {
        return entry.assetId;
      }
    }
    return null;
  }

  async saveDocument(doc: CreativeStudioDocument): Promise<{ persistedToIndexedDb: boolean }> {
    this.documents.set(doc.projectId, structuredClone(doc));
    return { persistedToIndexedDb: false };
  }

  async loadDocument(projectId: string): Promise<CreativeStudioDocument | null> {
    const doc = this.documents.get(projectId);
    return doc ? structuredClone(doc) : null;
  }

  async deleteDocument(projectId: string): Promise<void> {
    this.documents.delete(projectId);
  }

  async exportRecoveryBundle(doc: CreativeStudioDocument): Promise<StudioRecoveryBundle> {
    const embeddedAssets: StudioRecoveryBundle['embeddedAssets'] = [];
    for (const entry of this.assets.values()) {
      const dataUrl = await blobToDataUrl(entry.blob);
      embeddedAssets.push({
        metadata: entry.metadata,
        dataUrl
      });
    }
    return {
      bundleType: 'PATRONER_CREATIVE_STUDIO_RECOVERY_V1',
      exportedAt: new Date().toISOString(),
      persistenceMode: this.persistenceMode,
      document: structuredClone(doc),
      embeddedAssets
    };
  }
}

class IndexedDbStudioAssetStore implements StudioAssetStore {
  public readonly persistenceMode: StudioPersistenceMode = 'indexeddb';
  public readonly storageWarning: string | null = null;
  private readonly hashCache = new Map<string, string>();

  constructor(private readonly db: IDBDatabase) {}

  private runTransaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    executor: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = executor(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  async putAsset(asset: {
    assetId: string;
    blob: Blob;
    metadata: StudioAssetMetadata;
  }): Promise<StudioAssetMetadata> {
    const metadata: StudioAssetMetadata = {
      ...asset.metadata,
      storageState: 'indexeddb-persisted'
    };
    const entry: StoredAssetEntry = {
      assetId: asset.assetId,
      blob: asset.blob,
      metadata
    };
    await this.runTransaction(STORE_ASSETS, 'readwrite', store => store.put(entry));
    this.hashCache.set(metadata.localContentHash, asset.assetId);
    return metadata;
  }

  async getAssetBlob(assetId: string): Promise<Blob | null> {
    const entry = await this.runTransaction<StoredAssetEntry | undefined>(
      STORE_ASSETS,
      'readonly',
      store => store.get(assetId)
    );
    return entry?.blob ?? null;
  }

  async hasAssetBlob(assetId: string): Promise<boolean> {
    const blob = await this.getAssetBlob(assetId);
    return blob !== null;
  }

  async deleteAssetBlob(assetId: string): Promise<void> {
    await this.runTransaction(STORE_ASSETS, 'readwrite', store => store.delete(assetId));
    for (const [hash, cachedId] of this.hashCache.entries()) {
      if (cachedId === assetId) {
        this.hashCache.delete(hash);
      }
    }
  }

  async findAssetIdByLocalHash(localContentHash: string): Promise<string | null> {
    const cached = this.hashCache.get(localContentHash);
    if (cached && (await this.hasAssetBlob(cached))) {
      return cached;
    }
    const all = await this.runTransaction<StoredAssetEntry[]>(
      STORE_ASSETS,
      'readonly',
      store => store.getAll()
    );
    for (const entry of all ?? []) {
      if (entry.metadata?.localContentHash) {
        this.hashCache.set(entry.metadata.localContentHash, entry.assetId);
      }
      if (entry.metadata?.localContentHash === localContentHash) {
        return entry.assetId;
      }
    }
    return null;
  }

  async saveDocument(doc: CreativeStudioDocument): Promise<{ persistedToIndexedDb: boolean }> {
    await this.runTransaction(STORE_DOCUMENTS, 'readwrite', store => store.put(doc));
    return { persistedToIndexedDb: true };
  }

  async loadDocument(projectId: string): Promise<CreativeStudioDocument | null> {
    const doc = await this.runTransaction<CreativeStudioDocument | undefined>(
      STORE_DOCUMENTS,
      'readonly',
      store => store.get(projectId)
    );
    return doc ?? null;
  }

  async deleteDocument(projectId: string): Promise<void> {
    await this.runTransaction(STORE_DOCUMENTS, 'readwrite', store => store.delete(projectId));
  }

  async exportRecoveryBundle(doc: CreativeStudioDocument): Promise<StudioRecoveryBundle> {
    const all = await this.runTransaction<StoredAssetEntry[]>(
      STORE_ASSETS,
      'readonly',
      store => store.getAll()
    );
    const embeddedAssets: StudioRecoveryBundle['embeddedAssets'] = [];
    for (const entry of all ?? []) {
      if (doc.assetsById[entry.assetId]) {
        const dataUrl = await blobToDataUrl(entry.blob);
        embeddedAssets.push({
          metadata: entry.metadata,
          dataUrl
        });
      }
    }
    return {
      bundleType: 'PATRONER_CREATIVE_STUDIO_RECOVERY_V1',
      exportedAt: new Date().toISOString(),
      persistenceMode: this.persistenceMode,
      document: structuredClone(doc),
      embeddedAssets
    };
  }
}

function openStudioIndexedDb(idbFactory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idbFactory.open(STUDIO_DB_NAME, STUDIO_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'assetId' });
      }
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'projectId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
}

/**
 * Opens IndexedDB if available; otherwise returns a clearly flagged session-only memory store (C3).
 */
export async function createStudioAssetStore(options?: {
  forceMemoryFallback?: boolean;
  indexedDbFactory?: IDBFactory | null;
}): Promise<StudioAssetStore> {
  if (options?.forceMemoryFallback) {
    return new MemoryStudioAssetStore(
      'Session-only memory mode active. Assets are not persisted across browser reloads unless exported.'
    );
  }

  const factory =
    options?.indexedDbFactory !== undefined
      ? options.indexedDbFactory
      : typeof globalThis !== 'undefined' && 'indexedDB' in globalThis
        ? globalThis.indexedDB
        : null;

  if (!factory) {
    return new MemoryStudioAssetStore(
      'IndexedDB is unavailable in this environment. Reference images and moodboards are kept in session memory only.'
    );
  }

  try {
    const db = await openStudioIndexedDb(factory);
    return new IndexedDbStudioAssetStore(db);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Storage access blocked';
    return new MemoryStudioAssetStore(
      `IndexedDB could not be initialized (${detail}). Creative Studio is running in session-only memory mode; export a recovery bundle before closing.`
    );
  }
}
