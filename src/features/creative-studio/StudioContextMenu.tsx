/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  EyeOff,
  FolderPlus,
  Lock,
  Trash2,
  Ungroup,
  Unlock
} from 'lucide-react';
import { StudioLayer } from './types';

export interface StudioContextMenuProps {
  x: number;
  y: number;
  targetLayer: StudioLayer;
  selectedCount: number;
  onClose: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onToggleLock: () => void;
  onHide: () => void;
  onSoftDelete: () => void;
}

export const StudioContextMenu: React.FC<StudioContextMenuProps> = ({
  x,
  y,
  targetLayer,
  selectedCount,
  onClose,
  onDuplicate,
  onGroup,
  onUngroup,
  onBringForward,
  onSendBackward,
  onToggleLock,
  onHide,
  onSoftDelete
}) => {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClick = () => onClose();
    window.addEventListener('keydown', handleKey);
    window.addEventListener('pointerdown', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('pointerdown', handleClick);
    };
  }, [onClose]);

  const clampedX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 210) : x;
  const clampedY = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - 280) : y;

  return (
    <div
      role="menu"
      aria-label={`Actions for ${targetLayer.name}`}
      data-testid="studio-context-menu"
      style={{ left: `${Math.max(8, clampedX)}px`, top: `${Math.max(8, clampedY)}px` }}
      onPointerDown={e => e.stopPropagation()}
      className="fixed z-50 w-48 bg-white border border-neutral-300 rounded-sm shadow-lg py-1 text-xs text-neutral-800"
    >
      <div className="px-3 py-1.5 border-b border-neutral-100 text-[10px] font-medium text-neutral-500 truncate">
        {selectedCount > 1 ? `${selectedCount} selected layers` : targetLayer.name}
      </div>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onDuplicate();
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 flex items-center gap-2 cursor-pointer"
      >
        <Copy className="w-3.5 h-3.5 text-neutral-500" />
        Duplicate
      </button>

      {selectedCount >= 2 && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onGroup();
            onClose();
          }}
          className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 flex items-center gap-2 cursor-pointer"
        >
          <FolderPlus className="w-3.5 h-3.5 text-neutral-500" />
          Group Selected
        </button>
      )}

      {targetLayer.type === 'group' && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onUngroup();
            onClose();
          }}
          className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 flex items-center gap-2 cursor-pointer"
        >
          <Ungroup className="w-3.5 h-3.5 text-neutral-500" />
          Ungroup
        </button>
      )}

      <div className="my-1 border-t border-neutral-100" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onBringForward();
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 flex items-center gap-2 cursor-pointer"
      >
        <ArrowUp className="w-3.5 h-3.5 text-neutral-500" />
        Bring Forward
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onSendBackward();
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 flex items-center gap-2 cursor-pointer"
      >
        <ArrowDown className="w-3.5 h-3.5 text-neutral-500" />
        Send Backward
      </button>

      <div className="my-1 border-t border-neutral-100" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onToggleLock();
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 flex items-center gap-2 cursor-pointer"
      >
        {targetLayer.locked ? (
          <>
            <Unlock className="w-3.5 h-3.5 text-neutral-500" />
            Unlock Layer
          </>
        ) : (
          <>
            <Lock className="w-3.5 h-3.5 text-neutral-500" />
            Lock Layer
          </>
        )}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onHide();
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left hover:bg-neutral-100 flex items-center gap-2 cursor-pointer"
      >
        <EyeOff className="w-3.5 h-3.5 text-neutral-500" />
        Hide Layer
      </button>

      <div className="my-1 border-t border-neutral-100" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onSoftDelete();
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left hover:bg-rose-50 text-rose-700 flex items-center gap-2 cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Move to Trash
      </button>
    </div>
  );
};
