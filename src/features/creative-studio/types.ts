/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  EaseProfile,
  GarmentCategory,
  GarmentConstructionFeature,
  Silhouette
} from '../../types';

/**
 * UX-2.2 Creative Studio Domain Types
 *
 * ARCHITECTURAL BOUNDARY:
 * Every layer, board, asset, and AI candidate defined in this module is strictly
 * NON_AUTHORITATIVE_VISUAL_LAYER creative exploration state.
 * None of these structures may mutate authoritative engineering fingerprints,
 * measurement approval hashes, certification records, or production readiness flags.
 */

export const CREATIVE_STUDIO_SCHEMA_VERSION = 1 as const;
export const MAX_STUDIO_HISTORY_ENTRIES = 50;
export const MIN_LAYER_DIMENSION = 24;
export const MAX_LAYER_DIMENSION = 8000;
export const MIN_CROP_FRACTION = 0.05;

export type CreativeLayerAuthorityTag = 'NON_AUTHORITATIVE_VISUAL_LAYER';

export type StudioLayerType =
  | 'reference-image'
  | 'moodboard-card'
  | 'color-palette'
  | 'fabric-swatch'
  | 'garment-silhouette-card'
  | 'freehand-sketch'
  | 'annotation-note'
  | 'group';

export interface LayerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees normalized to [-180, 180) */
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Normalized non-destructive crop rectangle relative to original image [0..1].
 * Original asset Blob is never mutated.
 */
export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaletteSwatch {
  id: string;
  name: string;
  hex: string;
  role: 'primary' | 'secondary' | 'accent' | 'lining' | 'trim';
}

export interface SketchPoint {
  x: number;
  y: number;
}

export interface SketchStroke {
  id: string;
  points: readonly SketchPoint[];
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

export interface BaseStudioLayer {
  id: string;
  type: StudioLayerType;
  name: string;
  /** Single authoritative hierarchy link (C1). null = root canvas layer. */
  parentId: string | null;
  /** Deterministic sibling ordering within the same parentId (0..n-1). */
  order: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: LayerTransform;
  collectionId: string;
  authorityTag: CreativeLayerAuthorityTag;
  isDemonstrationContent?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceImageLayer extends BaseStudioLayer {
  type: 'reference-image';
  assetId: string;
  assetName: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  sizeBytes: number;
  crop: NormalizedCropRect;
  caption?: string;
  tags: string[];
  missingAssetReason?: 'permanently-purged' | 'session-only-expired' | 'storage-unavailable';
}

export interface MoodboardCardLayer extends BaseStudioLayer {
  type: 'moodboard-card';
  title: string;
  subtitle: string;
  notes: string;
  accentHex: string;
  tags: string[];
}

export interface ColorPaletteLayer extends BaseStudioLayer {
  type: 'color-palette';
  title: string;
  swatches: PaletteSwatch[];
}

export interface FabricSwatchLayer extends BaseStudioLayer {
  type: 'fabric-swatch';
  fabricId: string;
  fabricName: string;
  composition: string;
  weightLabel: string;
  drapeNote: string;
  swatchHex: string;
}

export interface GarmentSilhouetteCardLayer extends BaseStudioLayer {
  type: 'garment-silhouette-card';
  title: string;
  garmentCategory: GarmentCategory;
  silhouette: Silhouette;
  easeProfile: EaseProfile;
  lengthCm: number;
  colorHex: string;
  colorName: string;
  fabricName: string;
  isUnverifiedConceptVisual: true;
}

export interface FreehandSketchLayer extends BaseStudioLayer {
  type: 'freehand-sketch';
  strokes: SketchStroke[];
  verificationStatus: 'UNVERIFIED_FREEFORM_OVERLAY';
}

export interface AnnotationNoteLayer extends BaseStudioLayer {
  type: 'annotation-note';
  text: string;
  tone: 'neutral' | 'atelier' | 'caution';
  verificationStatus: 'UNVERIFIED_FREEFORM_OVERLAY';
}

export interface GroupLayer extends BaseStudioLayer {
  type: 'group';
  collapsed: boolean;
}

export type StudioLayer =
  | ReferenceImageLayer
  | MoodboardCardLayer
  | ColorPaletteLayer
  | FabricSwatchLayer
  | GarmentSilhouetteCardLayer
  | FreehandSketchLayer
  | AnnotationNoteLayer
  | GroupLayer;

export interface StudioCollection {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface StudioTrashItem {
  id: string;
  deletedAt: string;
  /** Top-level deleted layer plus any descendants captured together */
  layers: StudioLayer[];
  originalParentId: string | null;
  originalOrder: number;
}

export interface StudioAssetMetadata {
  assetId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  naturalWidth: number;
  naturalHeight: number;
  /**
   * Local studio deduplication/integrity hash ONLY (C5).
   * Explicitly prefixed and isolated from engineering/specification/approval fingerprints.
   */
  localContentHash: string;
  storageState: 'indexeddb-persisted' | 'memory-session-only' | 'purged';
  createdAt: string;
}

export interface StructuredConceptAttributes {
  title: string;
  creativeBrief: string;
  garmentCategory: GarmentCategory;
  silhouette: Silhouette;
  fabricId: string;
  colorName: string;
  colorHex: string;
  easeProfile: EaseProfile;
  lengthCm: number;
  moodKeywords: string[];
  constructionNotes: string[];
  constructionFeatures: GarmentConstructionFeature[];
}

/**
 * C2 — Strictly separated AI Service Availability vs Operation Outcome contracts.
 */
export type AiServiceAvailability =
  | 'demonstration'
  | 'configured-ready'
  | 'configured-error';

export type AiOperationOutcome =
  | 'demonstration-result'
  | 'successful-ai-result'
  | 'failed-operation';

export type AiEpistemicTag =
  | 'DEMONSTRATION_SYNTHESIS'
  | 'OBSERVED_VISIBLE'
  | 'INFERRED_CATEGORY_PRIOR'
  | 'AMBIGUOUS_REQUIRES_CONFIRMATION';

export interface AiEpistemicClaim {
  field: string;
  value: string;
  tag: AiEpistemicTag;
  rationale: string;
}

export interface AiConceptCandidate {
  id: string;
  createdAt: string;
  serviceAvailability: AiServiceAvailability;
  operationOutcome: AiOperationOutcome;
  analyzedReferenceImages: boolean;
  referencedAssetIds: string[];
  title: string;
  summary: string;
  garmentCategory: GarmentCategory;
  silhouette: Silhouette;
  fabricId: string;
  fabricName: string;
  colorName: string;
  colorHex: string;
  easeProfile: EaseProfile;
  lengthCm: number;
  constructionFeatures: GarmentConstructionFeature[];
  designNotes: string[];
  epistemicClaims: AiEpistemicClaim[];
  disclaimer: string;
  failureReason?: string;
  appliedToBoardAt?: string;
}

export interface StudioCanvasCamera {
  zoom: number;
  panX: number;
  panY: number;
}

export type StudioGridMode = 'dots' | 'grid' | 'off';

/**
 * Snapshot stored inside undo/redo stacks (C4).
 * Contains metadata and immutable assetId references ONLY — never binary image Blobs or dataUrls.
 */
export interface CreativeStudioDocumentSnapshot {
  layersById: Record<string, StudioLayer>;
  collections: StudioCollection[];
  activeCollectionId: string;
  concept: StructuredConceptAttributes;
  trash: StudioTrashItem[];
}

export interface StudioHistoryEntry {
  id: string;
  actionLabel: string;
  timestamp: string;
  snapshot: CreativeStudioDocumentSnapshot;
}

export interface CreativeStudioDocument {
  schemaVersion: typeof CREATIVE_STUDIO_SCHEMA_VERSION;
  projectId: string;
  updatedAt: string;
  hasInitializedBoard: boolean;
  isDemonstrationBoardLoaded: boolean;
  layersById: Record<string, StudioLayer>;
  collections: StudioCollection[];
  activeCollectionId: string;
  assetsById: Record<string, StudioAssetMetadata>;
  /**
   * Asset IDs whose binary Blobs have been permanently purged (C4).
   * Persisted outside undoable snapshots so Undo never pretends purged binary data still exists.
   */
  purgedAssetIds: string[];
  trash: StudioTrashItem[];
  concept: StructuredConceptAttributes;
  aiCandidates: AiConceptCandidate[];
  selectedCandidateId: string | null;
  camera: StudioCanvasCamera;
  nextSequence: number;
}

export interface CreativeStudioState {
  document: CreativeStudioDocument;
  historyPast: StudioHistoryEntry[];
  historyFuture: StudioHistoryEntry[];
}

export interface HierarchyValidationResult {
  valid: boolean;
  errors: string[];
}

export interface DerivedLayerTreeNode {
  layer: StudioLayer;
  depth: number;
  children: DerivedLayerTreeNode[];
}

export type AlignmentAxis =
  | 'align-left'
  | 'align-center-x'
  | 'align-right'
  | 'align-top'
  | 'align-center-y'
  | 'align-bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical';

export interface PromotionFieldSelection {
  includeTitle: boolean;
  includePrompt: boolean;
  includeCategoryAndSilhouette: boolean;
  includeFabric: boolean;
  includeColor: boolean;
  includeEaseProfile: boolean;
  includeTargetLength: boolean;
  includeConstructionFeatures: boolean;
  includeDesignNotes: boolean;
}

export type StudioPersistenceMode = 'indexeddb' | 'memory-session-only';

export type StudioAutosaveStatus =
  | 'idle'
  | 'saving'
  | 'saved-indexeddb'
  | 'session-only-memory'
  | 'save-error';
