/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WP-A6 / Phase 0 — Unified Pattern Atelier Tool Registry & Keyboard Dispatch Table.
 *
 * Centralizes shortcut resolution, history routing classification, and cursor styling
 * for all 10 Pattern Atelier CAD tools (`V, H, I, M, A, W, L, N, D, S`) plus the
 * instant `visual-note` action (`G`, reassigned from `N` to eliminate collision with
 * `notch-drill`).
 */

import type { PatternAtelierToolId } from './contracts/wp-a-shared-contracts';

export type UndoHistoryTarget = 'proposal' | 'board' | 'viewport';

export interface PatternAtelierToolMetadata {
  readonly id: PatternAtelierToolId;
  readonly shortKey: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly cursorClass: string;
  readonly undoTarget: UndoHistoryTarget;
  readonly isProposalAuthoringTool: boolean;
  readonly supportsCanvasClickCreate: boolean;
}

export const PATTERN_ATELIER_TOOL_REGISTRY: Readonly<
  Record<PatternAtelierToolId, PatternAtelierToolMetadata>
> = {
  select: {
    id: 'select',
    shortKey: 'V',
    label: 'Select & Arrange Piece',
    shortLabel: 'Select',
    cursorClass: 'cursor-default',
    undoTarget: 'board',
    isProposalAuthoringTool: false,
    supportsCanvasClickCreate: false
  },
  pan: {
    id: 'pan',
    shortKey: 'H',
    label: 'Pan Viewport',
    shortLabel: 'Pan',
    cursorClass: 'cursor-grab',
    undoTarget: 'viewport',
    isProposalAuthoringTool: false,
    supportsCanvasClickCreate: false
  },
  'inspect-entity': {
    id: 'inspect-entity',
    shortKey: 'I',
    label: 'Inspect Geometry',
    shortLabel: 'Inspect',
    cursorClass: 'cursor-crosshair',
    undoTarget: 'board',
    isProposalAuthoringTool: false,
    supportsCanvasClickCreate: false
  },
  'measure-preview': {
    id: 'measure-preview',
    shortKey: 'M',
    label: 'Measure Geometry',
    shortLabel: 'Measure',
    cursorClass: 'cursor-crosshair',
    undoTarget: 'board',
    isProposalAuthoringTool: false,
    supportsCanvasClickCreate: false
  },
  'edit-contour': {
    id: 'edit-contour',
    shortKey: 'A',
    label: 'Edit Contour',
    shortLabel: 'Edit Contour',
    cursorClass: 'cursor-crosshair',
    undoTarget: 'proposal',
    isProposalAuthoringTool: true,
    supportsCanvasClickCreate: false
  },
  'seam-walk': {
    id: 'seam-walk',
    shortKey: 'W',
    label: 'Seam Walk & True',
    shortLabel: 'Seam Walk',
    cursorClass: 'cursor-crosshair',
    undoTarget: 'proposal',
    isProposalAuthoringTool: true,
    supportsCanvasClickCreate: true
  },
  'construction-draw': {
    id: 'construction-draw',
    shortKey: 'L',
    label: 'Construction & Lines',
    shortLabel: 'Construction',
    cursorClass: 'cursor-crosshair',
    undoTarget: 'proposal',
    isProposalAuthoringTool: true,
    supportsCanvasClickCreate: true
  },
  'notch-drill': {
    id: 'notch-drill',
    shortKey: 'N',
    label: 'Notch & Drill',
    shortLabel: 'Notch / Drill',
    cursorClass: 'cursor-crosshair',
    undoTarget: 'proposal',
    isProposalAuthoringTool: true,
    supportsCanvasClickCreate: true
  },
  'dart-author': {
    id: 'dart-author',
    shortKey: 'D',
    label: 'Dart Authoring',
    shortLabel: 'Dart Tool',
    cursorClass: 'cursor-crosshair',
    undoTarget: 'proposal',
    isProposalAuthoringTool: true,
    supportsCanvasClickCreate: true
  },
  'allowance-rule': {
    id: 'allowance-rule',
    shortKey: 'S',
    label: 'Seam Allowance Rules',
    shortLabel: 'Allowance',
    cursorClass: 'cursor-pointer',
    undoTarget: 'proposal',
    isProposalAuthoringTool: true,
    supportsCanvasClickCreate: false
  }
};

export const PATTERN_ATELIER_SHORTCUT_MAP: Readonly<Record<string, PatternAtelierToolId>> = {
  v: 'select',
  h: 'pan',
  i: 'inspect-entity',
  m: 'measure-preview',
  a: 'edit-contour',
  w: 'seam-walk',
  l: 'construction-draw',
  n: 'notch-drill',
  d: 'dart-author',
  s: 'allowance-rule'
};

export function resolvePatternAtelierShortcut(key: string): PatternAtelierToolId | null {
  const lower = key.toLowerCase();
  return PATTERN_ATELIER_SHORTCUT_MAP[lower] ?? null;
}

export function isProposalAuthoringTool(toolId: string): boolean {
  const meta = PATTERN_ATELIER_TOOL_REGISTRY[toolId as PatternAtelierToolId];
  return Boolean(meta?.isProposalAuthoringTool);
}

export function resolveUndoHistoryTargetForTool(toolId: string): UndoHistoryTarget {
  const meta = PATTERN_ATELIER_TOOL_REGISTRY[toolId as PatternAtelierToolId];
  return meta?.undoTarget ?? 'board';
}
