/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CadCamera,
  CadCoordinateProjection,
  CadRectCm,
  computeAutoTableLayoutCm,
  screenToWorldCm,
  worldCmToScreen
} from './cad-math';
import type {
  PatternArtifactBundle,
  PatternPieceRenderModel,
  RenderCurveSegment,
  RenderPoint2D
} from './contracts/pattern-render-artifact';

/**
 * UX-2.3.2 — Pattern Piece Management & Spatial Interaction (Pure Domain Engine)
 *
 * CRITICAL ARCHITECTURAL SEPARATION:
 * 1. Original Pattern Geometry (`PatternPieceRenderModel`): strictly immutable, read-only.
 *    Never mutated by any function in this module.
 * 2. CAD Board Placement (`PatternBoardSnapshot`): ephemeral visual arrangement offsets (cm),
 *    layer stacking order, visibility, grouping, and intentional-overlap markers keyed by
 *    stable `pieceId`.
 * 3. Screen Projection (`cad-math.ts`): maps `boardWorldCm = localCm + boardOffsetCm` to
 *    screen pixels via `CadCamera`. Camera movement never pollutes board-arrangement history.
 */

export const MAX_BOARD_HISTORY = 50;
export const DEFAULT_SNAP_INTERVAL_CM = 1.0;
export const DEFAULT_SNAP_TOLERANCE_CM = 1.2;
export const SNAP_INTERVAL_OPTIONS_CM: readonly number[] = [0.5, 1.0, 2.0, 5.0];

export interface BoardPiecePlacement {
  readonly pieceId: string;
  readonly offsetXCm: number;
  readonly offsetYCm: number;
  readonly visible: boolean;
  readonly groupId: string | null;
  readonly allowIntentionalOverlap: boolean;
}

export interface BoardPieceGroup {
  readonly id: string;
  readonly name: string;
  readonly memberPieceIds: readonly string[];
  readonly visible: boolean;
}

export interface PatternBoardSnapshot {
  /** Authoritative per-piece board presentation state keyed by stable pieceId */
  readonly placementsByPieceId: Readonly<Record<string, BoardPiecePlacement>>;
  /** Bottom-to-top render stacking order (last item renders on top) */
  readonly layerOrder: readonly string[];
  /** Explicit visual arrangement groups keyed by groupId */
  readonly groupsById: Readonly<Record<string, BoardPieceGroup>>;
  /** Ordered list of group IDs for deterministic UI rendering */
  readonly groupOrder: readonly string[];
  /** Currently selected piece IDs (authoritative multi-selection set) */
  readonly selectedPieceIds: readonly string[];
  /** Monotonic counter for deterministic group ID generation */
  readonly nextGroupSequence: number;
}

export interface PatternBoardHistoryEntry {
  readonly snapshot: PatternBoardSnapshot;
  readonly label: string;
}

export interface PatternBoardHistoryState {
  readonly past: readonly PatternBoardHistoryEntry[];
  readonly present: PatternBoardSnapshot;
  readonly future: readonly PatternBoardHistoryEntry[];
  readonly lastActionLabel: string | null;
}

export interface SnapConfig {
  readonly enabled: boolean;
  readonly gridEnabled: boolean;
  readonly gridIntervalCm: number;
  readonly featureEnabled: boolean;
  readonly toleranceCm: number;
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  gridEnabled: true,
  gridIntervalCm: DEFAULT_SNAP_INTERVAL_CM,
  featureEnabled: true,
  toleranceCm: DEFAULT_SNAP_TOLERANCE_CM
};

export interface SnapCandidateGuide {
  readonly axis: 'vertical' | 'horizontal';
  readonly kind: 'feature' | 'grid';
  readonly positionCm: number;
  readonly startCm: number;
  readonly endCm: number;
  readonly label: string;
}

export interface SnapEvaluationResult {
  readonly dxCm: number;
  readonly dyCm: number;
  readonly snappedX: boolean;
  readonly snappedY: boolean;
  readonly snapKindX: 'feature' | 'grid' | null;
  readonly snapKindY: 'feature' | 'grid' | null;
  readonly guides: readonly SnapCandidateGuide[];
}

export type BoardAlignAction = 'left' | 'right' | 'top' | 'bottom';
export type BoardDistributeAxis = 'horizontal' | 'vertical';

export type OverlapClassification =
  | 'intentional-overlap'
  | 'unintentional-overlap'
  | 'containment'
  | 'touching-boundaries'
  | 'unresolved';

export interface BoardOverlapAdvisory {
  readonly id: string;
  readonly pieceAId: string;
  readonly pieceBId: string;
  readonly pieceACode: string;
  readonly pieceBCode: string;
  readonly classification: OverlapClassification;
  readonly overlapBoundsCm: CadRectCm | null;
  readonly message: string;
  readonly isAdvisoryOnly: true;
}

function roundCm(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(4));
}

// ---------------------------------------------------------------------------
// 1. Coordinate-Frame Conversion (Original Piece Local <-> Board <-> Screen)
// ---------------------------------------------------------------------------

/**
 * Converts a point in immutable original piece-local cm coordinates to CAD board cm.
 * Never mutates the input point or placement.
 */
export function pieceLocalToBoardCm(
  localPtCm: RenderPoint2D,
  placement: Pick<BoardPiecePlacement, 'offsetXCm' | 'offsetYCm'>
): RenderPoint2D {
  return {
    x: roundCm(localPtCm.x + placement.offsetXCm),
    y: roundCm(localPtCm.y + placement.offsetYCm)
  };
}

/**
 * Converts a CAD board cm point back to immutable piece-local cm coordinates.
 */
export function boardCmToPieceLocal(
  boardPtCm: RenderPoint2D,
  placement: Pick<BoardPiecePlacement, 'offsetXCm' | 'offsetYCm'>
): RenderPoint2D {
  return {
    x: roundCm(boardPtCm.x - placement.offsetXCm),
    y: roundCm(boardPtCm.y - placement.offsetYCm)
  };
}

/**
 * Projects an immutable piece-local cm point through its CAD board placement to screen px.
 */
export function pieceLocalToScreenPx(
  localPtCm: RenderPoint2D,
  placement: Pick<BoardPiecePlacement, 'offsetXCm' | 'offsetYCm'>,
  camera: CadCamera,
  projection: CadCoordinateProjection
): RenderPoint2D {
  const boardPt = pieceLocalToBoardCm(localPtCm, placement);
  return worldCmToScreen(boardPt, camera, projection);
}

/**
 * Inverse-projects a screen px point back into piece-local cm via camera & board placement.
 */
export function screenPxToPieceLocalCm(
  screenPtPx: RenderPoint2D,
  placement: Pick<BoardPiecePlacement, 'offsetXCm' | 'offsetYCm'>,
  camera: CadCamera,
  projection: CadCoordinateProjection
): RenderPoint2D {
  const boardPt = screenToWorldCm(screenPtPx, camera, projection);
  return boardCmToPieceLocal(boardPt, placement);
}

/**
 * Computes full visual local bounds (union of boundingBoxCm + cutSegments + sewSegments)
 * without mutating the source piece.
 */
export function getPieceLocalVisualBoundsCm(piece: PatternPieceRenderModel): CadRectCm {
  let minX = piece.boundingBoxCm.minX;
  let minY = piece.boundingBoxCm.minY;
  let maxX = piece.boundingBoxCm.maxX;
  let maxY = piece.boundingBoxCm.maxY;

  const inspectSegments = (segments: readonly RenderCurveSegment[]) => {
    for (const seg of segments) {
      const pts = seg.p1 && seg.p2 ? [seg.p0, seg.p1, seg.p2, seg.p3] : [seg.p0, seg.p3];
      for (const pt of pts) {
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
  };

  inspectSegments(piece.cutSegments);
  inspectSegments(piece.sewSegments);

  return { minX, minY, maxX, maxY };
}

/**
 * Computes a piece's bounding rectangle in CAD board cm coordinates.
 */
export function getPieceBoardBoundsCm(
  piece: PatternPieceRenderModel,
  placement: Pick<BoardPiecePlacement, 'offsetXCm' | 'offsetYCm'>
): CadRectCm {
  const local = getPieceLocalVisualBoundsCm(piece);
  return {
    minX: roundCm(local.minX + placement.offsetXCm),
    minY: roundCm(local.minY + placement.offsetYCm),
    maxX: roundCm(local.maxX + placement.offsetXCm),
    maxY: roundCm(local.maxY + placement.offsetYCm)
  };
}

/**
 * Computes the union bounds of all visible pieces on the CAD board (used by Fit All).
 */
export function getBoardUnionBoundsCm(
  snapshot: PatternBoardSnapshot,
  artifact: PatternArtifactBundle
): CadRectCm | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (const piece of artifact.pieces) {
    const placement = snapshot.placementsByPieceId[piece.pieceId];
    if (!placement || !isPieceEffectivelyVisible(snapshot, piece.pieceId)) continue;
    const b = getPieceBoardBoundsCm(piece, placement);
    if (!Number.isFinite(b.minX) || !Number.isFinite(b.maxX)) continue;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
    count += 1;
  }

  return count > 0 ? { minX, minY, maxX, maxY } : null;
}

export function isPieceEffectivelyVisible(
  snapshot: PatternBoardSnapshot,
  pieceId: string
): boolean {
  const placement = snapshot.placementsByPieceId[pieceId];
  if (!placement || !placement.visible) return false;
  if (placement.groupId) {
    const grp = snapshot.groupsById[placement.groupId];
    if (grp && !grp.visible) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 2. Snapshot Initialization & Stable-Identity Reconciliation
// ---------------------------------------------------------------------------

export function createEmptyBoardSnapshot(): PatternBoardSnapshot {
  return {
    placementsByPieceId: {},
    layerOrder: [],
    groupsById: {},
    groupOrder: [],
    selectedPieceIds: [],
    nextGroupSequence: 1
  };
}

export function createInitialBoardSnapshot(
  artifact: PatternArtifactBundle,
  gapCm = 8
): PatternBoardSnapshot {
  const layout = computeAutoTableLayoutCm(artifact.pieces, gapCm);
  const placementsByPieceId: Record<string, BoardPiecePlacement> = {};
  const layerOrder: string[] = [];

  for (const piece of artifact.pieces) {
    const autoPlacement = layout.placements.find(p => p.pieceId === piece.pieceId);
    placementsByPieceId[piece.pieceId] = {
      pieceId: piece.pieceId,
      offsetXCm: roundCm(autoPlacement?.offsetXCm ?? 0),
      offsetYCm: roundCm(autoPlacement?.offsetYCm ?? 0),
      visible: true,
      groupId: null,
      allowIntentionalOverlap: false
    };
    layerOrder.push(piece.pieceId);
  }

  return {
    placementsByPieceId,
    layerOrder,
    groupsById: {},
    groupOrder: [],
    selectedPieceIds: artifact.pieces.length > 0 ? [artifact.pieces[0].pieceId] : [],
    nextGroupSequence: 1
  };
}

/**
 * Deterministically reconciles existing board presentation state against an updated
 * `PatternArtifactBundle`:
 * - Preserves board offset, visibility, stacking order, and group membership for surviving piece IDs.
 * - Assigns non-overlapping auto-layout positions to newly introduced piece IDs.
 * - Prunes removed piece IDs from placements, layerOrder, groups, and selection (zero stale refs).
 * - Dissolves groups that drop below 2 surviving members.
 */
export function reconcileBoardStateWithArtifact(
  prev: PatternBoardSnapshot,
  artifact: PatternArtifactBundle,
  gapCm = 8
): PatternBoardSnapshot {
  if (artifact.pieces.length === 0) {
    return createEmptyBoardSnapshot();
  }

  const artifactPieceIds = new Set(artifact.pieces.map(p => p.pieceId));
  const survivingIds = prev.layerOrder.filter(
    id => artifactPieceIds.has(id) && Boolean(prev.placementsByPieceId[id])
  );
  const survivingSet = new Set(survivingIds);
  const newPieces = artifact.pieces.filter(p => !survivingSet.has(p.pieceId));

  // If no existing pieces match at all (e.g., switching skirt <-> bodice), initialize fresh layout
  if (survivingIds.length === 0) {
    return createInitialBoardSnapshot(artifact, gapCm);
  }

  // Fast path: exact same piece set — return prev reference to avoid needless renders
  if (
    newPieces.length === 0 &&
    survivingIds.length === prev.layerOrder.length &&
    Object.keys(prev.placementsByPieceId).length === survivingIds.length
  ) {
    return prev;
  }

  const nextPlacements: Record<string, BoardPiecePlacement> = {};
  for (const id of survivingIds) {
    nextPlacements[id] = prev.placementsByPieceId[id];
  }

  // Compute starting X cursor to the right of all surviving pieces for newly added pieces
  let maxRightX = 0;
  let baselineY = 0;
  let hasSurvivingBounds = false;
  for (const piece of artifact.pieces) {
    const existing = nextPlacements[piece.pieceId];
    if (!existing) continue;
    const b = getPieceBoardBoundsCm(piece, existing);
    if (!hasSurvivingBounds || b.maxX > maxRightX) {
      maxRightX = b.maxX;
    }
    if (!hasSurvivingBounds || b.minY < baselineY) {
      baselineY = b.minY;
    }
    hasSurvivingBounds = true;
  }

  const nextLayerOrder = [...survivingIds];
  if (newPieces.length > 0) {
    const autoNew = computeAutoTableLayoutCm(newPieces, gapCm);
    const startShiftX = hasSurvivingBounds ? maxRightX + gapCm : 0;
    for (const np of newPieces) {
      const pLayout = autoNew.placements.find(p => p.pieceId === np.pieceId);
      nextPlacements[np.pieceId] = {
        pieceId: np.pieceId,
        offsetXCm: roundCm(startShiftX + (pLayout?.offsetXCm ?? 0)),
        offsetYCm: roundCm(baselineY + (pLayout?.offsetYCm ?? 0)),
        visible: true,
        groupId: null,
        allowIntentionalOverlap: false
      };
      nextLayerOrder.push(np.pieceId);
    }
  }

  // Prune removed piece IDs from groups and dissolve groups with < 2 members
  const nextGroupsById: Record<string, BoardPieceGroup> = {};
  const nextGroupOrder: string[] = [];
  for (const gid of prev.groupOrder) {
    const grp = prev.groupsById[gid];
    if (!grp) continue;
    const members = grp.memberPieceIds.filter(id => Boolean(nextPlacements[id]));
    if (members.length >= 2) {
      nextGroupsById[gid] = { ...grp, memberPieceIds: members };
      nextGroupOrder.push(gid);
    } else {
      for (const mId of members) {
        nextPlacements[mId] = { ...nextPlacements[mId], groupId: null };
      }
    }
  }

  // Ensure every placement.groupId points to an existing surviving group
  for (const pid of nextLayerOrder) {
    const pl = nextPlacements[pid];
    if (pl.groupId && !nextGroupsById[pl.groupId]) {
      nextPlacements[pid] = { ...pl, groupId: null };
    }
  }

  const nextSelected = prev.selectedPieceIds.filter(id => Boolean(nextPlacements[id]));

  return {
    placementsByPieceId: nextPlacements,
    layerOrder: nextLayerOrder,
    groupsById: nextGroupsById,
    groupOrder: nextGroupOrder,
    selectedPieceIds: nextSelected,
    nextGroupSequence: prev.nextGroupSequence
  };
}

// ---------------------------------------------------------------------------
// 3. Selection Helpers (Single, Multi, Group-Aware, Marquee, Clear)
// ---------------------------------------------------------------------------

export function expandSelectionWithGroups(
  snapshot: PatternBoardSnapshot,
  pieceIds: readonly string[]
): readonly string[] {
  const result = new Set<string>();
  for (const pid of pieceIds) {
    const pl = snapshot.placementsByPieceId[pid];
    if (!pl) continue;
    if (pl.groupId && snapshot.groupsById[pl.groupId]) {
      for (const memberId of snapshot.groupsById[pl.groupId].memberPieceIds) {
        if (snapshot.placementsByPieceId[memberId]) {
          result.add(memberId);
        }
      }
    } else {
      result.add(pid);
    }
  }
  return Array.from(result);
}

export function selectSinglePiece(
  snapshot: PatternBoardSnapshot,
  pieceId: string,
  options?: { expandGroup?: boolean }
): PatternBoardSnapshot {
  if (!snapshot.placementsByPieceId[pieceId]) return snapshot;
  const nextSelected =
    options?.expandGroup === false
      ? [pieceId]
      : expandSelectionWithGroups(snapshot, [pieceId]);
  return {
    ...snapshot,
    selectedPieceIds: nextSelected
  };
}

export function togglePieceInSelection(
  snapshot: PatternBoardSnapshot,
  pieceId: string,
  options?: { expandGroup?: boolean }
): PatternBoardSnapshot {
  if (!snapshot.placementsByPieceId[pieceId]) return snapshot;
  const targetIds =
    options?.expandGroup === false
      ? [pieceId]
      : expandSelectionWithGroups(snapshot, [pieceId]);
  const existing = new Set(snapshot.selectedPieceIds);
  const allPresent = targetIds.every(id => existing.has(id));

  if (allPresent) {
    for (const id of targetIds) existing.delete(id);
  } else {
    for (const id of targetIds) existing.add(id);
  }

  return {
    ...snapshot,
    selectedPieceIds: Array.from(existing)
  };
}

export function clearBoardSelection(snapshot: PatternBoardSnapshot): PatternBoardSnapshot {
  if (snapshot.selectedPieceIds.length === 0) return snapshot;
  return {
    ...snapshot,
    selectedPieceIds: []
  };
}

function rectsIntersect(a: CadRectCm, b: CadRectCm): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function selectPiecesInMarqueeRect(
  snapshot: PatternBoardSnapshot,
  artifact: PatternArtifactBundle,
  rawRectCm: CadRectCm,
  mode: 'replace' | 'add' = 'replace'
): PatternBoardSnapshot {
  const normRect: CadRectCm = {
    minX: Math.min(rawRectCm.minX, rawRectCm.maxX),
    maxX: Math.max(rawRectCm.minX, rawRectCm.maxX),
    minY: Math.min(rawRectCm.minY, rawRectCm.maxY),
    maxY: Math.max(rawRectCm.minY, rawRectCm.maxY)
  };

  const hitIds: string[] = [];
  for (const piece of artifact.pieces) {
    const pl = snapshot.placementsByPieceId[piece.pieceId];
    if (!pl || !isPieceEffectivelyVisible(snapshot, piece.pieceId)) continue;
    const bounds = getPieceBoardBoundsCm(piece, pl);
    if (rectsIntersect(bounds, normRect)) {
      hitIds.push(piece.pieceId);
    }
  }

  const expandedHits = expandSelectionWithGroups(snapshot, hitIds);
  if (mode === 'add') {
    const merged = new Set([...snapshot.selectedPieceIds, ...expandedHits]);
    return { ...snapshot, selectedPieceIds: Array.from(merged) };
  }
  return { ...snapshot, selectedPieceIds: expandedHits };
}

// ---------------------------------------------------------------------------
// 4. Repositioning, Alignment & Distribution (Board Placement Only)
// ---------------------------------------------------------------------------

export function movePiecesByDeltaCm(
  snapshot: PatternBoardSnapshot,
  pieceIds: readonly string[],
  dxCm: number,
  dyCm: number
): PatternBoardSnapshot {
  if (pieceIds.length === 0 || (!Number.isFinite(dxCm) && !Number.isFinite(dyCm))) {
    return snapshot;
  }
  const safeDx = Number.isFinite(dxCm) ? dxCm : 0;
  const safeDy = Number.isFinite(dyCm) ? dyCm : 0;
  if (Math.abs(safeDx) < 1e-9 && Math.abs(safeDy) < 1e-9) return snapshot;

  const targetSet = new Set(pieceIds);
  const nextPlacements: Record<string, BoardPiecePlacement> = { ...snapshot.placementsByPieceId };
  let changed = false;

  for (const pid of targetSet) {
    const pl = nextPlacements[pid];
    if (!pl) continue;
    nextPlacements[pid] = {
      ...pl,
      offsetXCm: roundCm(pl.offsetXCm + safeDx),
      offsetYCm: roundCm(pl.offsetYCm + safeDy)
    };
    changed = true;
  }

  return changed ? { ...snapshot, placementsByPieceId: nextPlacements } : snapshot;
}

export function setPieceBoardPositionCm(
  snapshot: PatternBoardSnapshot,
  pieceId: string,
  offsetXCm: number,
  offsetYCm: number
): PatternBoardSnapshot {
  const pl = snapshot.placementsByPieceId[pieceId];
  if (!pl || !Number.isFinite(offsetXCm) || !Number.isFinite(offsetYCm)) return snapshot;
  const nextX = roundCm(offsetXCm);
  const nextY = roundCm(offsetYCm);
  if (pl.offsetXCm === nextX && pl.offsetYCm === nextY) return snapshot;

  return {
    ...snapshot,
    placementsByPieceId: {
      ...snapshot.placementsByPieceId,
      [pieceId]: {
        ...pl,
        offsetXCm: nextX,
        offsetYCm: nextY
      }
    }
  };
}

export function alignBoardPieces(
  snapshot: PatternBoardSnapshot,
  artifact: PatternArtifactBundle,
  pieceIds: readonly string[],
  action: BoardAlignAction
): PatternBoardSnapshot {
  const piecesById = new Map(artifact.pieces.map(p => [p.pieceId, p]));
  const items = pieceIds
    .map(id => {
      const piece = piecesById.get(id);
      const placement = snapshot.placementsByPieceId[id];
      if (!piece || !placement) return null;
      return { id, piece, placement, bounds: getPieceBoardBoundsCm(piece, placement) };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  if (items.length < 2) return snapshot;

  const targetVal =
    action === 'left'
      ? Math.min(...items.map(i => i.bounds.minX))
      : action === 'right'
        ? Math.max(...items.map(i => i.bounds.maxX))
        : action === 'top'
          ? Math.min(...items.map(i => i.bounds.minY))
          : Math.max(...items.map(i => i.bounds.maxY));

  const nextPlacements: Record<string, BoardPiecePlacement> = { ...snapshot.placementsByPieceId };
  let changed = false;

  for (const item of items) {
    let dx = 0;
    let dy = 0;
    if (action === 'left') dx = targetVal - item.bounds.minX;
    if (action === 'right') dx = targetVal - item.bounds.maxX;
    if (action === 'top') dy = targetVal - item.bounds.minY;
    if (action === 'bottom') dy = targetVal - item.bounds.maxY;

    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
      nextPlacements[item.id] = {
        ...item.placement,
        offsetXCm: roundCm(item.placement.offsetXCm + dx),
        offsetYCm: roundCm(item.placement.offsetYCm + dy)
      };
      changed = true;
    }
  }

  return changed ? { ...snapshot, placementsByPieceId: nextPlacements } : snapshot;
}

export function distributeBoardPieces(
  snapshot: PatternBoardSnapshot,
  artifact: PatternArtifactBundle,
  pieceIds: readonly string[],
  axis: BoardDistributeAxis
): PatternBoardSnapshot {
  const piecesById = new Map(artifact.pieces.map(p => [p.pieceId, p]));
  const items = pieceIds
    .map(id => {
      const piece = piecesById.get(id);
      const placement = snapshot.placementsByPieceId[id];
      if (!piece || !placement) return null;
      const bounds = getPieceBoardBoundsCm(piece, placement);
      return {
        id,
        placement,
        bounds,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  if (items.length < 3) return snapshot;

  const sorted = [...items].sort((a, b) =>
    axis === 'horizontal' ? a.bounds.minX - b.bounds.minX : a.bounds.minY - b.bounds.minY
  );

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const nextPlacements: Record<string, BoardPiecePlacement> = { ...snapshot.placementsByPieceId };
  let changed = false;

  if (axis === 'horizontal') {
    const totalSpan = last.bounds.maxX - first.bounds.minX;
    const sumWidths = sorted.reduce((acc, it) => acc + it.width, 0);
    const gap = (totalSpan - sumWidths) / (sorted.length - 1);
    let cursorX = first.bounds.minX + first.width + gap;

    for (let i = 1; i < sorted.length - 1; i++) {
      const item = sorted[i];
      const dx = cursorX - item.bounds.minX;
      if (Math.abs(dx) > 1e-6) {
        nextPlacements[item.id] = {
          ...item.placement,
          offsetXCm: roundCm(item.placement.offsetXCm + dx)
        };
        changed = true;
      }
      cursorX += item.width + gap;
    }
  } else {
    const totalSpan = last.bounds.maxY - first.bounds.minY;
    const sumHeights = sorted.reduce((acc, it) => acc + it.height, 0);
    const gap = (totalSpan - sumHeights) / (sorted.length - 1);
    let cursorY = first.bounds.minY + first.height + gap;

    for (let i = 1; i < sorted.length - 1; i++) {
      const item = sorted[i];
      const dy = cursorY - item.bounds.minY;
      if (Math.abs(dy) > 1e-6) {
        nextPlacements[item.id] = {
          ...item.placement,
          offsetYCm: roundCm(item.placement.offsetYCm + dy)
        };
        changed = true;
      }
      cursorY += item.height + gap;
    }
  }

  return changed ? { ...snapshot, placementsByPieceId: nextPlacements } : snapshot;
}

export function resetBoardAutoLayout(
  snapshot: PatternBoardSnapshot,
  artifact: PatternArtifactBundle,
  gapCm = 8
): PatternBoardSnapshot {
  const layout = computeAutoTableLayoutCm(artifact.pieces, gapCm);
  const nextPlacements: Record<string, BoardPiecePlacement> = { ...snapshot.placementsByPieceId };
  for (const p of layout.placements) {
    const prev = nextPlacements[p.pieceId];
    if (!prev) continue;
    nextPlacements[p.pieceId] = {
      ...prev,
      offsetXCm: roundCm(p.offsetXCm),
      offsetYCm: roundCm(p.offsetYCm)
    };
  }
  return {
    ...snapshot,
    placementsByPieceId: nextPlacements
  };
}

// ---------------------------------------------------------------------------
// 5. Grouping, Ungrouping, Layer Visibility & Stacking Order
// ---------------------------------------------------------------------------

export function groupBoardPieces(
  snapshot: PatternBoardSnapshot,
  pieceIds: readonly string[],
  customName?: string
): PatternBoardSnapshot {
  const validIds = Array.from(
    new Set(pieceIds.filter(id => Boolean(snapshot.placementsByPieceId[id])))
  );
  if (validIds.length < 2) return snapshot;

  const groupId = `board-group-${snapshot.nextGroupSequence}`;
  const groupName = customName?.trim() || `Piece Group ${snapshot.nextGroupSequence}`;
  const validSet = new Set(validIds);

  const nextPlacements: Record<string, BoardPiecePlacement> = { ...snapshot.placementsByPieceId };
  const nextGroupsById: Record<string, BoardPieceGroup> = {};
  const nextGroupOrder: string[] = [];

  // Remove selected members from any prior groups; dissolve prior groups that fall below 2 members
  for (const existingGid of snapshot.groupOrder) {
    const grp = snapshot.groupsById[existingGid];
    if (!grp) continue;
    const remaining = grp.memberPieceIds.filter(id => !validSet.has(id));
    if (remaining.length >= 2) {
      nextGroupsById[existingGid] = { ...grp, memberPieceIds: remaining };
      nextGroupOrder.push(existingGid);
    } else {
      for (const remId of remaining) {
        if (nextPlacements[remId]) {
          nextPlacements[remId] = { ...nextPlacements[remId], groupId: null };
        }
      }
    }
  }

  for (const pid of validIds) {
    nextPlacements[pid] = {
      ...nextPlacements[pid],
      groupId
    };
  }

  nextGroupsById[groupId] = {
    id: groupId,
    name: groupName,
    memberPieceIds: validIds,
    visible: true
  };
  nextGroupOrder.push(groupId);

  return {
    ...snapshot,
    placementsByPieceId: nextPlacements,
    groupsById: nextGroupsById,
    groupOrder: nextGroupOrder,
    selectedPieceIds: validIds,
    nextGroupSequence: snapshot.nextGroupSequence + 1
  };
}

export function ungroupBoardSelection(
  snapshot: PatternBoardSnapshot,
  targetGroupIdsOrPieceIds: readonly string[]
): PatternBoardSnapshot {
  const groupIdsToDissolve = new Set<string>();
  for (const id of targetGroupIdsOrPieceIds) {
    if (snapshot.groupsById[id]) {
      groupIdsToDissolve.add(id);
    } else {
      const pl = snapshot.placementsByPieceId[id];
      if (pl?.groupId && snapshot.groupsById[pl.groupId]) {
        groupIdsToDissolve.add(pl.groupId);
      }
    }
  }

  if (groupIdsToDissolve.size === 0) return snapshot;

  const nextPlacements: Record<string, BoardPiecePlacement> = { ...snapshot.placementsByPieceId };
  const nextGroupsById: Record<string, BoardPieceGroup> = {};
  const nextGroupOrder: string[] = [];
  const releasedMemberIds: string[] = [];

  for (const gid of snapshot.groupOrder) {
    const grp = snapshot.groupsById[gid];
    if (!grp) continue;
    if (groupIdsToDissolve.has(gid)) {
      for (const pid of grp.memberPieceIds) {
        if (nextPlacements[pid]) {
          nextPlacements[pid] = { ...nextPlacements[pid], groupId: null };
          releasedMemberIds.push(pid);
        }
      }
    } else {
      nextGroupsById[gid] = grp;
      nextGroupOrder.push(gid);
    }
  }

  return {
    ...snapshot,
    placementsByPieceId: nextPlacements,
    groupsById: nextGroupsById,
    groupOrder: nextGroupOrder,
    selectedPieceIds:
      snapshot.selectedPieceIds.length > 0 ? snapshot.selectedPieceIds : releasedMemberIds
  };
}

export function togglePieceVisibility(
  snapshot: PatternBoardSnapshot,
  pieceId: string
): PatternBoardSnapshot {
  const pl = snapshot.placementsByPieceId[pieceId];
  if (!pl) return snapshot;
  const nextVisible = !pl.visible;

  return {
    ...snapshot,
    placementsByPieceId: {
      ...snapshot.placementsByPieceId,
      [pieceId]: { ...pl, visible: nextVisible }
    }
  };
}

export function toggleGroupVisibility(
  snapshot: PatternBoardSnapshot,
  groupId: string
): PatternBoardSnapshot {
  const grp = snapshot.groupsById[groupId];
  if (!grp) return snapshot;
  return {
    ...snapshot,
    groupsById: {
      ...snapshot.groupsById,
      [groupId]: { ...grp, visible: !grp.visible }
    }
  };
}

export function togglePieceIntentionalOverlap(
  snapshot: PatternBoardSnapshot,
  pieceId: string
): PatternBoardSnapshot {
  const pl = snapshot.placementsByPieceId[pieceId];
  if (!pl) return snapshot;
  return {
    ...snapshot,
    placementsByPieceId: {
      ...snapshot.placementsByPieceId,
      [pieceId]: { ...pl, allowIntentionalOverlap: !pl.allowIntentionalOverlap }
    }
  };
}

export function reorderPieceLayer(
  snapshot: PatternBoardSnapshot,
  pieceId: string,
  direction: 'forward' | 'backward' | 'front' | 'back'
): PatternBoardSnapshot {
  const idx = snapshot.layerOrder.indexOf(pieceId);
  if (idx === -1) return snapshot;

  let targetIdx = idx;
  if (direction === 'forward') targetIdx = Math.min(snapshot.layerOrder.length - 1, idx + 1);
  if (direction === 'backward') targetIdx = Math.max(0, idx - 1);
  if (direction === 'front') targetIdx = snapshot.layerOrder.length - 1;
  if (direction === 'back') targetIdx = 0;

  if (targetIdx === idx) return snapshot;
  return movePieceLayerToIndex(snapshot, pieceId, targetIdx);
}

export function movePieceLayerToIndex(
  snapshot: PatternBoardSnapshot,
  pieceId: string,
  targetIndex: number
): PatternBoardSnapshot {
  const idx = snapshot.layerOrder.indexOf(pieceId);
  if (idx === -1) return snapshot;
  const clamped = Math.max(0, Math.min(snapshot.layerOrder.length - 1, targetIndex));
  if (clamped === idx) return snapshot;

  const nextOrder = [...snapshot.layerOrder];
  const [moved] = nextOrder.splice(idx, 1);
  nextOrder.splice(clamped, 0, moved);

  return {
    ...snapshot,
    layerOrder: nextOrder
  };
}

// ---------------------------------------------------------------------------
// 6. Centimeter-Based Grid & Feature Snapping (CAD Board Coordinate System)
// ---------------------------------------------------------------------------

interface PieceSnapAnchorSet {
  readonly xValues: readonly { valueCm: number; label: string; ySpan: [number, number] }[];
  readonly yValues: readonly { valueCm: number; label: string; xSpan: [number, number] }[];
}

function collectPieceBoardAnchors(
  piece: PatternPieceRenderModel,
  placement: Pick<BoardPiecePlacement, 'offsetXCm' | 'offsetYCm'>
): PieceSnapAnchorSet {
  const b = getPieceBoardBoundsCm(piece, placement);
  const cx = roundCm((b.minX + b.maxX) * 0.5);
  const cy = roundCm((b.minY + b.maxY) * 0.5);

  const xValues: { valueCm: number; label: string; ySpan: [number, number] }[] = [
    { valueCm: b.minX, label: `${piece.pieceCode} Left`, ySpan: [b.minY, b.maxY] },
    { valueCm: cx, label: `${piece.pieceCode} Center X`, ySpan: [b.minY, b.maxY] },
    { valueCm: b.maxX, label: `${piece.pieceCode} Right`, ySpan: [b.minY, b.maxY] }
  ];

  const yValues: { valueCm: number; label: string; xSpan: [number, number] }[] = [
    { valueCm: b.minY, label: `${piece.pieceCode} Top`, xSpan: [b.minX, b.maxX] },
    { valueCm: cy, label: `${piece.pieceCode} Center Y`, xSpan: [b.minX, b.maxX] },
    { valueCm: b.maxY, label: `${piece.pieceCode} Bottom`, xSpan: [b.minX, b.maxX] }
  ];

  if (piece.grainline) {
    const gStart = pieceLocalToBoardCm(piece.grainline.start, placement);
    const gEnd = pieceLocalToBoardCm(piece.grainline.end, placement);
    xValues.push({
      valueCm: gStart.x,
      label: `${piece.pieceCode} Grainline`,
      ySpan: [Math.min(gStart.y, gEnd.y), Math.max(gStart.y, gEnd.y)]
    });
  }

  for (const notch of piece.notches) {
    const nPos = pieceLocalToBoardCm(notch.position, placement);
    xValues.push({
      valueCm: nPos.x,
      label: `${piece.pieceCode} Notch`,
      ySpan: [nPos.y - 2, nPos.y + 2]
    });
    yValues.push({
      valueCm: nPos.y,
      label: `${piece.pieceCode} Notch`,
      xSpan: [nPos.x - 2, nPos.x + 2]
    });
  }

  return { xValues, yValues };
}

/**
 * Evaluates centimeter-based feature snapping and grid snapping for a proposed board
 * translation `(proposedDxCm, proposedDyCm)` of `movingPieceIds`.
 *
 * Strictly operates in CAD board cm coordinates; visual snapping is an arrangement aid
 * and NEVER claims seam geometry or construction validation.
 */
export function evaluateBoardSnapCm(
  snapshot: PatternBoardSnapshot,
  artifact: PatternArtifactBundle,
  movingPieceIds: readonly string[],
  proposedDxCm: number,
  proposedDyCm: number,
  config: SnapConfig
): SnapEvaluationResult {
  if (!config.enabled || movingPieceIds.length === 0) {
    return {
      dxCm: roundCm(proposedDxCm),
      dyCm: roundCm(proposedDyCm),
      snappedX: false,
      snappedY: false,
      snapKindX: null,
      snapKindY: null,
      guides: []
    };
  }

  const movingSet = new Set(movingPieceIds);
  const tolerance = Math.max(0.05, config.toleranceCm);
  const interval = Math.max(0.1, config.gridIntervalCm);

  // Build proposed moving anchors & collective moving bounds
  const movingPieces = artifact.pieces.filter(
    p => movingSet.has(p.pieceId) && Boolean(snapshot.placementsByPieceId[p.pieceId])
  );
  if (movingPieces.length === 0) {
    return {
      dxCm: roundCm(proposedDxCm),
      dyCm: roundCm(proposedDyCm),
      snappedX: false,
      snappedY: false,
      snapKindX: null,
      snapKindY: null,
      guides: []
    };
  }

  let movMinX = Number.POSITIVE_INFINITY;
  let movMinY = Number.POSITIVE_INFINITY;
  let movMaxX = Number.NEGATIVE_INFINITY;
  let movMaxY = Number.NEGATIVE_INFINITY;
  const movingXAnchors: number[] = [];
  const movingYAnchors: number[] = [];

  for (const piece of movingPieces) {
    const basePl = snapshot.placementsByPieceId[piece.pieceId];
    const proposedPl = {
      offsetXCm: basePl.offsetXCm + proposedDxCm,
      offsetYCm: basePl.offsetYCm + proposedDyCm
    };
    const b = getPieceBoardBoundsCm(piece, proposedPl);
    if (b.minX < movMinX) movMinX = b.minX;
    if (b.minY < movMinY) movMinY = b.minY;
    if (b.maxX > movMaxX) movMaxX = b.maxX;
    if (b.maxY > movMaxY) movMaxY = b.maxY;

    const anchors = collectPieceBoardAnchors(piece, proposedPl);
    for (const ax of anchors.xValues) movingXAnchors.push(ax.valueCm);
    for (const ay of anchors.yValues) movingYAnchors.push(ay.valueCm);
  }

  let bestDeltaX: number | null = null;
  let bestDistX = tolerance + 1e-6;
  let bestGuideX: SnapCandidateGuide | null = null;
  let snapKindX: 'feature' | 'grid' | null = null;

  let bestDeltaY: number | null = null;
  let bestDistY = tolerance + 1e-6;
  let bestGuideY: SnapCandidateGuide | null = null;
  let snapKindY: 'feature' | 'grid' | null = null;

  // 1. Feature snapping against stationary visible pieces
  if (config.featureEnabled) {
    for (const other of artifact.pieces) {
      if (movingSet.has(other.pieceId)) continue;
      const otherPl = snapshot.placementsByPieceId[other.pieceId];
      if (!otherPl || !isPieceEffectivelyVisible(snapshot, other.pieceId)) continue;

      const targetAnchors = collectPieceBoardAnchors(other, otherPl);

      for (const mx of movingXAnchors) {
        for (const tx of targetAnchors.xValues) {
          const delta = tx.valueCm - mx;
          const dist = Math.abs(delta);
          if (dist <= tolerance && dist < bestDistX) {
            bestDistX = dist;
            bestDeltaX = delta;
            snapKindX = 'feature';
            bestGuideX = {
              axis: 'vertical',
              kind: 'feature',
              positionCm: roundCm(tx.valueCm),
              startCm: roundCm(Math.min(movMinY, tx.ySpan[0]) - 3),
              endCm: roundCm(Math.max(movMaxY, tx.ySpan[1]) + 3),
              label: `${tx.label} (${tx.valueCm.toFixed(1)} cm)`
            };
          }
        }
      }

      for (const my of movingYAnchors) {
        for (const ty of targetAnchors.yValues) {
          const delta = ty.valueCm - my;
          const dist = Math.abs(delta);
          if (dist <= tolerance && dist < bestDistY) {
            bestDistY = dist;
            bestDeltaY = delta;
            snapKindY = 'feature';
            bestGuideY = {
              axis: 'horizontal',
              kind: 'feature',
              positionCm: roundCm(ty.valueCm),
              startCm: roundCm(Math.min(movMinX, ty.xSpan[0]) - 3),
              endCm: roundCm(Math.max(movMaxX, ty.xSpan[1]) + 3),
              label: `${ty.label} (${ty.valueCm.toFixed(1)} cm)`
            };
          }
        }
      }
    }
  }

  // 2. Centimeter grid snapping fallback on axes that did not lock to a closer feature anchor
  if (config.gridEnabled) {
    if (bestDeltaX === null) {
      const snappedMinX = Math.round(movMinX / interval) * interval;
      const delta = snappedMinX - movMinX;
      if (Math.abs(delta) <= tolerance) {
        bestDeltaX = delta;
        snapKindX = 'grid';
        bestGuideX = {
          axis: 'vertical',
          kind: 'grid',
          positionCm: roundCm(snappedMinX),
          startCm: roundCm(movMinY - 4),
          endCm: roundCm(movMaxY + 4),
          label: `Grid X ${snappedMinX.toFixed(1)} cm`
        };
      }
    }

    if (bestDeltaY === null) {
      const snappedMinY = Math.round(movMinY / interval) * interval;
      const delta = snappedMinY - movMinY;
      if (Math.abs(delta) <= tolerance) {
        bestDeltaY = delta;
        snapKindY = 'grid';
        bestGuideY = {
          axis: 'horizontal',
          kind: 'grid',
          positionCm: roundCm(snappedMinY),
          startCm: roundCm(movMinX - 4),
          endCm: roundCm(movMaxX + 4),
          label: `Grid Y ${snappedMinY.toFixed(1)} cm`
        };
      }
    }
  }

  const guides: SnapCandidateGuide[] = [];
  if (bestGuideX) guides.push(bestGuideX);
  if (bestGuideY) guides.push(bestGuideY);

  return {
    dxCm: roundCm(proposedDxCm + (bestDeltaX ?? 0)),
    dyCm: roundCm(proposedDyCm + (bestDeltaY ?? 0)),
    snappedX: bestDeltaX !== null,
    snappedY: bestDeltaY !== null,
    snapKindX,
    snapKindY,
    guides
  };
}

// ---------------------------------------------------------------------------
// 7. Visual Overlap Classification (Advisory Only — Never Certification)
// ---------------------------------------------------------------------------

const TOUCH_TOLERANCE_CM = 0.15;

function sampleSegmentToPoints(seg: RenderCurveSegment, steps = 8): RenderPoint2D[] {
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    const pts: RenderPoint2D[] = [];
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x =
        mt * mt * mt * seg.p0.x +
        3 * mt * mt * t * seg.p1.x +
        3 * mt * t * t * seg.p2.x +
        t * t * t * seg.p3.x;
      const y =
        mt * mt * mt * seg.p0.y +
        3 * mt * mt * t * seg.p1.y +
        3 * mt * t * t * seg.p2.y +
        t * t * t * seg.p3.y;
      pts.push({ x, y });
    }
    return pts;
  }
  return [{ x: seg.p0.x, y: seg.p0.y }];
}

/**
 * Extracts a closed 2D board-space polygon ring from a piece's outer contour (cutSegments
 * or sewSegments fallback). Returns `null` when geometry is blocked, non-finite, or
 * degenerate so overlap classification fails closed to `'unresolved'`.
 */
export function extractPieceBoardPolygonCm(
  piece: PatternPieceRenderModel,
  placement: Pick<BoardPiecePlacement, 'offsetXCm' | 'offsetYCm'>
): readonly RenderPoint2D[] | null {
  if (piece.hasBlockingError) return null;
  const sourceSegments = piece.cutSegments.length > 0 ? piece.cutSegments : piece.sewSegments;
  if (sourceSegments.length < 3) return null;

  const ring: RenderPoint2D[] = [];
  for (const seg of sourceSegments) {
    const sampled = sampleSegmentToPoints(seg, 6);
    for (const pt of sampled) {
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
      const boardPt = pieceLocalToBoardCm(pt, placement);
      const prev = ring[ring.length - 1];
      if (!prev || Math.hypot(boardPt.x - prev.x, boardPt.y - prev.y) > 1e-4) {
        ring.push(boardPt);
      }
    }
  }

  if (ring.length < 3) return null;
  // Compute signed area to confirm non-degenerate contour
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area2) < 1e-3) return null;
  return ring;
}

function pointToSegmentDistCm(p: RenderPoint2D, a: RenderPoint2D, b: RenderPoint2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygonStrict(
  pt: RenderPoint2D,
  poly: readonly RenderPoint2D[],
  boundaryTol = 0.05
): 'inside' | 'boundary' | 'outside' {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (pointToSegmentDistCm(pt, a, b) <= boundaryTol) {
      return 'boundary';
    }
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

function cross2(a: RenderPoint2D, b: RenderPoint2D, c: RenderPoint2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsProperlyCross(
  a1: RenderPoint2D,
  a2: RenderPoint2D,
  b1: RenderPoint2D,
  b2: RenderPoint2D
): boolean {
  const d1 = cross2(a1, a2, b1);
  const d2 = cross2(a1, a2, b2);
  const d3 = cross2(b1, b2, a1);
  const d4 = cross2(b1, b2, a2);
  const eps = 1e-4;
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  );
}

function minPolygonDistanceCm(
  polyA: readonly RenderPoint2D[],
  polyB: readonly RenderPoint2D[]
): number {
  let minD = Number.POSITIVE_INFINITY;
  for (const p of polyA) {
    for (let j = 0; j < polyB.length; j++) {
      const d = pointToSegmentDistCm(p, polyB[j], polyB[(j + 1) % polyB.length]);
      if (d < minD) minD = d;
    }
  }
  for (const p of polyB) {
    for (let i = 0; i < polyA.length; i++) {
      const d = pointToSegmentDistCm(p, polyA[i], polyA[(i + 1) % polyA.length]);
      if (d < minD) minD = d;
    }
  }
  return minD;
}

function rectIntersection(a: CadRectCm, b: CadRectCm): CadRectCm | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  if (minX <= maxX + TOUCH_TOLERANCE_CM && minY <= maxY + TOUCH_TOLERANCE_CM) {
    return {
      minX: roundCm(minX),
      minY: roundCm(minY),
      maxX: roundCm(Math.max(minX, maxX)),
      maxY: roundCm(Math.max(minY, maxY))
    };
  }
  return null;
}

function sampleEdgeMidpoints(poly: readonly RenderPoint2D[]): RenderPoint2D[] {
  const pts: RenderPoint2D[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    pts.push(a);
    pts.push({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 });
  }
  return pts;
}

/**
 * Analyzes all visible pieces on the CAD board for visual overlap advisories.
 * Distinguishes:
 * - `intentional-overlap` (explicitly marked via `allowIntentionalOverlap`)
 * - `unintentional-overlap` (interior overlap without intentional opt-in)
 * - `containment` (one piece strictly inside another)
 * - `touching-boundaries` (no interior overlap, boundaries touch within 0.15 cm)
 * - `unresolved` (blocked, missing, or degenerate geometry — fails closed, never invents)
 */
export function analyzeBoardOverlaps(
  snapshot: PatternBoardSnapshot,
  artifact: PatternArtifactBundle
): readonly BoardOverlapAdvisory[] {
  const advisories: BoardOverlapAdvisory[] = [];
  const visiblePieces = artifact.pieces.filter(p =>
    isPieceEffectivelyVisible(snapshot, p.pieceId)
  );

  const prepared = visiblePieces.map(piece => {
    const placement = snapshot.placementsByPieceId[piece.pieceId];
    const bounds = getPieceBoardBoundsCm(piece, placement);
    const poly = extractPieceBoardPolygonCm(piece, placement);
    return { piece, placement, bounds, poly };
  });

  // Fail-closed unresolved advisory for pieces whose contours cannot be reliably evaluated
  for (const item of prepared) {
    if (!item.poly) {
      advisories.push({
        id: `unresolved:${item.piece.pieceId}`,
        pieceAId: item.piece.pieceId,
        pieceBId: item.piece.pieceId,
        pieceACode: item.piece.pieceCode,
        pieceBCode: item.piece.pieceCode,
        classification: 'unresolved',
        overlapBoundsCm: item.bounds,
        message: `${item.piece.pieceCode}: Contour geometry is blocked or unavailable; overlap cannot be reliably classified (advisory only).`,
        isAdvisoryOnly: true
      });
    }
  }

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];

      const expandedIntersection = rectIntersection(a.bounds, b.bounds);
      if (!expandedIntersection) continue;

      if (!a.poly || !b.poly) {
        advisories.push({
          id: `unresolved:${a.piece.pieceId}:${b.piece.pieceId}`,
          pieceAId: a.piece.pieceId,
          pieceBId: b.piece.pieceId,
          pieceACode: a.piece.pieceCode,
          pieceBCode: b.piece.pieceCode,
          classification: 'unresolved',
          overlapBoundsCm: expandedIntersection,
          message: `${a.piece.pieceCode} & ${b.piece.pieceCode}: Overlap classification unresolved due to incomplete or blocked contour geometry.`,
          isAdvisoryOnly: true
        });
        continue;
      }

      const samplesA = sampleEdgeMidpoints(a.poly);
      const samplesB = sampleEdgeMidpoints(b.poly);

      let aInsideB = 0;
      let aOutsideB = 0;
      for (const pt of samplesA) {
        const res = pointInPolygonStrict(pt, b.poly);
        if (res === 'inside') aInsideB += 1;
        else if (res === 'outside') aOutsideB += 1;
      }

      let bInsideA = 0;
      let bOutsideA = 0;
      for (const pt of samplesB) {
        const res = pointInPolygonStrict(pt, a.poly);
        if (res === 'inside') bInsideA += 1;
        else if (res === 'outside') bOutsideA += 1;
      }

      let edgesCross = false;
      for (let ei = 0; ei < a.poly.length && !edgesCross; ei++) {
        const a1 = a.poly[ei];
        const a2 = a.poly[(ei + 1) % a.poly.length];
        for (let ej = 0; ej < b.poly.length; ej++) {
          const b1 = b.poly[ej];
          const b2 = b.poly[(ej + 1) % b.poly.length];
          if (segmentsProperlyCross(a1, a2, b1, b2)) {
            edgesCross = true;
            break;
          }
        }
      }

      const hasInteriorOverlap = edgesCross || aInsideB > 0 || bInsideA > 0;
      const aContainedInB = aInsideB > 0 && aOutsideB === 0 && !edgesCross;
      const bContainedInA = bInsideA > 0 && bOutsideA === 0 && !edgesCross;

      if (aContainedInB || bContainedInA) {
        const inner = aContainedInB ? a.piece.pieceCode : b.piece.pieceCode;
        const outer = aContainedInB ? b.piece.pieceCode : a.piece.pieceCode;
        advisories.push({
          id: `containment:${a.piece.pieceId}:${b.piece.pieceId}`,
          pieceAId: a.piece.pieceId,
          pieceBId: b.piece.pieceId,
          pieceACode: a.piece.pieceCode,
          pieceBCode: b.piece.pieceCode,
          classification: 'containment',
          overlapBoundsCm: expandedIntersection,
          message: `${inner} is visually contained within ${outer} on the CAD board (advisory only).`,
          isAdvisoryOnly: true
        });
        continue;
      }

      if (hasInteriorOverlap) {
        const isIntentional =
          a.placement.allowIntentionalOverlap || b.placement.allowIntentionalOverlap;
        advisories.push({
          id: `${isIntentional ? 'intentional' : 'unintentional'}:${a.piece.pieceId}:${b.piece.pieceId}`,
          pieceAId: a.piece.pieceId,
          pieceBId: b.piece.pieceId,
          pieceACode: a.piece.pieceCode,
          pieceBCode: b.piece.pieceCode,
          classification: isIntentional ? 'intentional-overlap' : 'unintentional-overlap',
          overlapBoundsCm: expandedIntersection,
          message: isIntentional
            ? `${a.piece.pieceCode} & ${b.piece.pieceCode}: Marked intentional visual overlap (advisory only).`
            : `${a.piece.pieceCode} & ${b.piece.pieceCode}: Unintentional visual overlap on the CAD board (advisory only).`,
          isAdvisoryOnly: true
        });
        continue;
      }

      const minEdgeDist = minPolygonDistanceCm(a.poly, b.poly);
      if (minEdgeDist <= TOUCH_TOLERANCE_CM) {
        advisories.push({
          id: `touching:${a.piece.pieceId}:${b.piece.pieceId}`,
          pieceAId: a.piece.pieceId,
          pieceBId: b.piece.pieceId,
          pieceACode: a.piece.pieceCode,
          pieceBCode: b.piece.pieceCode,
          classification: 'touching-boundaries',
          overlapBoundsCm: expandedIntersection,
          message: `${a.piece.pieceCode} & ${b.piece.pieceCode}: Visual boundaries touching within ${TOUCH_TOLERANCE_CM} cm (advisory only; does not validate seam match).`,
          isAdvisoryOnly: true
        });
      }
    }
  }

  return advisories;
}

// ---------------------------------------------------------------------------
// 8. Dedicated Bounded Board-Arrangement Undo / Redo History
// ---------------------------------------------------------------------------

function snapshotsStructurallyEqual(a: PatternBoardSnapshot, b: PatternBoardSnapshot): boolean {
  if (a === b) return true;
  if (a.layerOrder.length !== b.layerOrder.length) return false;
  for (let i = 0; i < a.layerOrder.length; i++) {
    if (a.layerOrder[i] !== b.layerOrder[i]) return false;
  }
  if (a.groupOrder.length !== b.groupOrder.length) return false;
  for (let i = 0; i < a.groupOrder.length; i++) {
    const gid = a.groupOrder[i];
    if (gid !== b.groupOrder[i]) return false;
    const ga = a.groupsById[gid];
    const gb = b.groupsById[gid];
    if (!ga || !gb) return false;
    if (
      ga.name !== gb.name ||
      ga.visible !== gb.visible ||
      ga.memberPieceIds.length !== gb.memberPieceIds.length
    ) {
      return false;
    }
    for (let m = 0; m < ga.memberPieceIds.length; m++) {
      if (ga.memberPieceIds[m] !== gb.memberPieceIds[m]) return false;
    }
  }
  for (const pid of a.layerOrder) {
    const pa = a.placementsByPieceId[pid];
    const pb = b.placementsByPieceId[pid];
    if (!pa || !pb) return false;
    if (
      pa.offsetXCm !== pb.offsetXCm ||
      pa.offsetYCm !== pb.offsetYCm ||
      pa.visible !== pb.visible ||
      pa.groupId !== pb.groupId ||
      pa.allowIntentionalOverlap !== pb.allowIntentionalOverlap
    ) {
      return false;
    }
  }
  return true;
}

export function createBoardHistory(initialSnapshot: PatternBoardSnapshot): PatternBoardHistoryState {
  return {
    past: [],
    present: initialSnapshot,
    future: [],
    lastActionLabel: null
  };
}

/**
 * Commits a board-arrangement mutation (move, align, distribute, group, ungroup,
 * layer order, visibility, intentional-overlap) to bounded history.
 * Pure selection changes and camera pan/zoom must NEVER call this function.
 */
export function commitBoardSnapshot(
  history: PatternBoardHistoryState,
  nextSnapshot: PatternBoardSnapshot,
  label: string,
  maxEntries = MAX_BOARD_HISTORY
): PatternBoardHistoryState {
  if (snapshotsStructurallyEqual(history.present, nextSnapshot)) {
    return {
      ...history,
      present: nextSnapshot
    };
  }

  const nextPast = [...history.past, { snapshot: history.present, label }];
  const boundedPast =
    nextPast.length > maxEntries ? nextPast.slice(nextPast.length - maxEntries) : nextPast;

  return {
    past: boundedPast,
    present: nextSnapshot,
    future: [],
    lastActionLabel: label
  };
}

/**
 * Updates selection-only state on `present` without pushing to arrangement history.
 */
export function updateBoardSelectionWithoutHistory(
  history: PatternBoardHistoryState,
  nextSnapshot: PatternBoardSnapshot
): PatternBoardHistoryState {
  if (history.present === nextSnapshot) return history;
  return {
    ...history,
    present: nextSnapshot
  };
}

export function undoBoardHistory(history: PatternBoardHistoryState): PatternBoardHistoryState {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const nextPast = history.past.slice(0, -1);
  return {
    past: nextPast,
    present: previous.snapshot,
    future: [{ snapshot: history.present, label: previous.label }, ...history.future],
    lastActionLabel: `Undo: ${previous.label}`
  };
}

export function redoBoardHistory(history: PatternBoardHistoryState): PatternBoardHistoryState {
  if (history.future.length === 0) return history;
  const [nextEntry, ...restFuture] = history.future;
  return {
    past: [...history.past, { snapshot: history.present, label: nextEntry.label }],
    present: nextEntry.snapshot,
    future: restFuture,
    lastActionLabel: `Redo: ${nextEntry.label}`
  };
}

/**
 * Reconciles `present` (and resets history cleanly when the garment piece set swaps
 * completely, e.g., skirt -> bodice, preventing stale cross-garment undo states).
 */
export function reconcileBoardHistoryWithArtifact(
  history: PatternBoardHistoryState,
  artifact: PatternArtifactBundle
): PatternBoardHistoryState {
  const reconciledPresent = reconcileBoardStateWithArtifact(history.present, artifact);
  if (reconciledPresent === history.present) return history;

  const prevIds = new Set(history.present.layerOrder);
  const nextIds = new Set(reconciledPresent.layerOrder);
  const hasAnyOverlap = Array.from(nextIds).some(id => prevIds.has(id));

  if (!hasAnyOverlap) {
    // Switched to an entirely different garment piece set -> start clean arrangement history
    return createBoardHistory(reconciledPresent);
  }

  return {
    past: history.past.map(entry => ({
      ...entry,
      snapshot: reconcileBoardStateWithArtifact(entry.snapshot, artifact)
    })),
    present: reconciledPresent,
    future: history.future.map(entry => ({
      ...entry,
      snapshot: reconcileBoardStateWithArtifact(entry.snapshot, artifact)
    })),
    lastActionLabel: history.lastActionLabel
  };
}
