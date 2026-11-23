/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Layers,
  Lock,
  Palette,
  PenTool,
  Plus,
  RotateCcw,
  Shirt,
  StickyNote,
  SwatchBook,
  Trash2,
  Ungroup,
  Unlock,
  Upload,
  X
} from 'lucide-react';
import { useViewportInteraction } from '../../state/ViewportInteractionContext';
import { useCreativeStudio } from './CreativeStudioContext';
import { DerivedLayerTreeNode, StudioLayer } from './types';

type LeftPanelTab = 'layers' | 'library' | 'trash';

function layerTypeIcon(type: StudioLayer['type']) {
  switch (type) {
    case 'reference-image':
      return <ImageIcon className="w-3.5 h-3.5 text-neutral-500 shrink-0" />;
    case 'color-palette':
      return <Palette className="w-3.5 h-3.5 text-neutral-500 shrink-0" />;
    case 'fabric-swatch':
      return <SwatchBook className="w-3.5 h-3.5 text-neutral-500 shrink-0" />;
    case 'garment-silhouette-card':
      return <Shirt className="w-3.5 h-3.5 text-neutral-500 shrink-0" />;
    case 'freehand-sketch':
      return <PenTool className="w-3.5 h-3.5 text-amber-700 shrink-0" />;
    case 'annotation-note':
      return <StickyNote className="w-3.5 h-3.5 text-amber-700 shrink-0" />;
    case 'group':
      return <Folder className="w-3.5 h-3.5 text-neutral-600 shrink-0" />;
    default:
      return <Layers className="w-3.5 h-3.5 text-neutral-500 shrink-0" />;
  }
}

export interface StudioLayersPanelProps {
  onRequestUploadDialog: () => void;
}

export const StudioLayersPanel: React.FC<StudioLayersPanelProps> = ({
  onRequestUploadDialog
}) => {
  const {
    document: studioDoc,
    layerTree,
    assetUrlsById,
    addMoodboardCard,
    addColorPaletteLayer,
    addAnnotationNote,
    toggleLayerVisibility,
    toggleLayerLock,
    renameLayer,
    reorderLayer,
    reparentLayer,
    groupLayers,
    ungroupLayer,
    duplicateLayers,
    softDeleteLayers,
    restoreTrashItem,
    purgeTrashItem,
    emptyTrash,
    createCollection,
    setActiveCollection,
    updateLayerProps
  } = useCreativeStudio();

  const {
    layersPanelOpen,
    setLayersPanelOpen,
    selectedLayerIds,
    setSelectedLayerIds,
    toggleLayerSelection,
    clearLayerSelection
  } = useViewportInteraction();

  const [activeTab, setActiveTab] = useState<LeftPanelTab>('layers');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [newCollectionName, setNewCollectionName] = useState<string>('');
  const [creatingCollection, setCreatingCollection] = useState<boolean>(false);

  if (!layersPanelOpen) return null;

  const commitRename = (layerId: string) => {
    if (editingName.trim()) {
      renameLayer(layerId, editingName.trim());
    }
    setEditingLayerId(null);
  };

  const renderTreeNodes = (nodes: DerivedLayerTreeNode[]) => {
    return nodes.map(node => {
      const { layer, depth, children } = node;
      const isSelected = selectedLayerIds.includes(layer.id);
      const isGroup = layer.type === 'group';
      const isCollapsed = isGroup && layer.collapsed;

      return (
        <React.Fragment key={layer.id}>
          <div
            data-testid={`layer-tree-row-${layer.id}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            className={`group flex items-center justify-between gap-1 pr-1.5 py-1.5 rounded-xs text-xs transition-colors ${
              isSelected
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-800 hover:bg-neutral-100'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {isGroup ? (
                <button
                  type="button"
                  onClick={() => updateLayerProps(layer.id, { collapsed: !layer.collapsed }, 'Toggle group')}
                  aria-label={isCollapsed ? `Expand ${layer.name}` : `Collapse ${layer.name}`}
                  className="p-0.5 hover:bg-black/10 rounded-xs cursor-pointer"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              ) : (
                <span className="w-4 shrink-0" aria-hidden="true" />
              )}

              {layerTypeIcon(layer.type)}

              {editingLayerId === layer.id ? (
                <input
                  type="text"
                  value={editingName}
                  autoFocus
                  onChange={e => setEditingName(e.target.value)}
                  onBlur={() => commitRename(layer.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(layer.id);
                    if (e.key === 'Escape') setEditingLayerId(null);
                  }}
                  className="flex-1 min-w-0 px-1 py-0.5 text-xs bg-white text-neutral-900 border border-neutral-400 rounded-xs"
                />
              ) : (
                <button
                  type="button"
                  onClick={e => {
                    if (e.shiftKey) toggleLayerSelection(layer.id);
                    else setSelectedLayerIds([layer.id]);
                  }}
                  onDoubleClick={() => {
                    setEditingLayerId(layer.id);
                    setEditingName(layer.name);
                  }}
                  className="flex-1 min-w-0 text-left truncate cursor-pointer"
                  title={`${layer.name} (double-click to rename)`}
                >
                  {layer.name}
                </button>
              )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => reorderLayer(layer.id, 'up')}
                aria-label={`Move ${layer.name} forward`}
                title="Bring forward"
                className={`p-1 rounded-xs cursor-pointer ${
                  isSelected ? 'text-neutral-300 hover:text-white' : 'text-neutral-400 hover:text-neutral-800'
                }`}
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => reorderLayer(layer.id, 'down')}
                aria-label={`Move ${layer.name} backward`}
                title="Send backward"
                className={`p-1 rounded-xs cursor-pointer ${
                  isSelected ? 'text-neutral-300 hover:text-white' : 'text-neutral-400 hover:text-neutral-800'
                }`}
              >
                <ArrowDown className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => toggleLayerVisibility(layer.id)}
                aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                className={`p-1 rounded-xs cursor-pointer ${
                  isSelected ? 'text-neutral-300 hover:text-white' : 'text-neutral-400 hover:text-neutral-800'
                }`}
              >
                {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={() => toggleLayerLock(layer.id)}
                aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`}
                title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                className={`p-1 rounded-xs cursor-pointer ${
                  layer.locked
                    ? 'text-amber-500'
                    : isSelected
                      ? 'text-neutral-300 hover:text-white'
                      : 'text-neutral-400 hover:text-neutral-800'
                }`}
              >
                {layer.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>
            </div>
          </div>
          {!isCollapsed && children.length > 0 && renderTreeNodes(children)}
        </React.Fragment>
      );
    });
  };

  const singleSelectedLayer =
    selectedLayerIds.length === 1 ? studioDoc.layersById[selectedLayerIds[0]] : null;
  const assetList = Object.values(studioDoc.assetsById).filter(a => a.storageState !== 'purged');

  return (
    <>
      {/* Backdrop on compact viewports (< 1280px) */}
      <div
        className="absolute inset-0 bg-neutral-950/20 z-20 xl:hidden"
        onClick={() => setLayersPanelOpen(false)}
        aria-hidden="true"
      />
      <aside
        aria-label="Creative Studio Layers and Library"
        data-testid="studio-layers-panel"
        className="absolute inset-y-0 left-0 z-30 w-[244px] shadow-xl xl:static xl:shadow-none shrink-0 bg-white border-r border-neutral-200 flex flex-col overflow-hidden"
      >
        {/* Top Tab Switcher */}
        <div className="h-10 px-2 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between gap-1 shrink-0">
          <div role="tablist" aria-label="Studio Organizer Tabs" className="flex items-center gap-0.5">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'layers'}
              data-testid="layers-tab-layers"
              onClick={() => setActiveTab('layers')}
              className={`px-2 py-1 rounded-xs text-[11px] font-medium cursor-pointer transition-colors ${
                activeTab === 'layers'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Layers
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'library'}
              data-testid="layers-tab-library"
              onClick={() => setActiveTab('library')}
              className={`px-2 py-1 rounded-xs text-[11px] font-medium cursor-pointer transition-colors ${
                activeTab === 'library'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'trash'}
              data-testid="layers-tab-trash"
              onClick={() => setActiveTab('trash')}
              className={`px-2 py-1 rounded-xs text-[11px] font-medium cursor-pointer transition-colors ${
                activeTab === 'trash'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Trash ({studioDoc.trash.length})
            </button>
          </div>
          <button
            type="button"
            onClick={() => setLayersPanelOpen(false)}
            aria-label="Close layers panel"
            className="p-1 text-neutral-500 hover:text-neutral-900 rounded-xs hover:bg-neutral-200/70 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Active Collection Selector Bar */}
        <div className="px-2.5 py-2 border-b border-neutral-200 bg-white space-y-1.5 shrink-0">
          <div className="flex items-center justify-between gap-1">
            <label htmlFor="studio-collection-select" className="text-[10px] font-medium text-neutral-500">
              Collection
            </label>
            <button
              type="button"
              onClick={() => setCreatingCollection(prev => !prev)}
              data-testid="new-collection-toggle-btn"
              className="text-[10px] font-medium text-neutral-800 hover:underline inline-flex items-center gap-0.5 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          </div>
          <select
            id="studio-collection-select"
            value={studioDoc.activeCollectionId}
            onChange={e => {
              setActiveCollection(e.target.value);
              clearLayerSelection();
            }}
            className="w-full px-2 py-1 text-xs border border-neutral-300 rounded-xs bg-neutral-50 text-neutral-900"
          >
            {studioDoc.collections.map(col => (
              <option key={col.id} value={col.id}>
                {col.name}
              </option>
            ))}
          </select>

          {creatingCollection && (
            <div className="flex items-center gap-1 pt-1">
              <input
                type="text"
                value={newCollectionName}
                onChange={e => setNewCollectionName(e.target.value)}
                placeholder="Collection name"
                className="flex-1 min-w-0 px-2 py-1 text-xs border border-neutral-300 rounded-xs"
                onKeyDown={e => {
                  if (e.key === 'Enter' && newCollectionName.trim()) {
                    createCollection(newCollectionName.trim());
                    setNewCollectionName('');
                    setCreatingCollection(false);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (newCollectionName.trim()) {
                    createCollection(newCollectionName.trim());
                    setNewCollectionName('');
                    setCreatingCollection(false);
                  }
                }}
                className="px-2 py-1 text-[11px] font-medium bg-neutral-900 text-white rounded-xs cursor-pointer"
              >
                Add
              </button>
            </div>
          )}
        </div>

        {/* Panel Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
          {activeTab === 'layers' && (
            <>
              {/* Quick Add & Selection Actions */}
              <div className="grid grid-cols-2 gap-1.5 pb-2 border-b border-neutral-100">
                <button
                  type="button"
                  onClick={onRequestUploadDialog}
                  className="px-2 py-1.5 text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-xs inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  Image
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = addMoodboardCard();
                    setSelectedLayerIds([id]);
                  }}
                  className="px-2 py-1.5 text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-xs cursor-pointer"
                >
                  + Card
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = addColorPaletteLayer();
                    setSelectedLayerIds([id]);
                  }}
                  className="px-2 py-1.5 text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-xs cursor-pointer"
                >
                  + Palette
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = addAnnotationNote();
                    setSelectedLayerIds([id]);
                  }}
                  className="px-2 py-1.5 text-[11px] font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-900 rounded-xs cursor-pointer"
                >
                  + Note
                </button>
              </div>

              {/* Layer Tree */}
              {layerTree.length === 0 ? (
                <p className="text-[11px] text-neutral-500 px-1 py-4 text-center leading-relaxed">
                  No layers in this collection yet. Upload reference images or add a moodboard card.
                </p>
              ) : (
                <div className="space-y-0.5" data-testid="layer-tree-list">
                  {renderTreeNodes(layerTree)}
                </div>
              )}
            </>
          )}

          {activeTab === 'library' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-neutral-600">
                  Reference Assets ({assetList.length})
                </span>
                <button
                  type="button"
                  onClick={onRequestUploadDialog}
                  className="text-[11px] font-medium text-neutral-900 hover:underline cursor-pointer"
                >
                  + Upload
                </button>
              </div>
              {assetList.length === 0 ? (
                <p className="text-[11px] text-neutral-500 py-4 text-center leading-relaxed">
                  Uploaded reference photographs appear here for reuse across collections.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {assetList.map(asset => (
                    <div
                      key={asset.assetId}
                      className="border border-neutral-200 rounded-xs overflow-hidden bg-neutral-50 flex flex-col"
                    >
                      <div className="h-20 bg-neutral-200 overflow-hidden">
                        {assetUrlsById[asset.assetId] ? (
                          <img
                            src={assetUrlsById[asset.assetId]}
                            alt={asset.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-neutral-500">
                            No preview
                          </div>
                        )}
                      </div>
                      <div className="p-1.5 space-y-0.5">
                        <p className="text-[10px] font-medium text-neutral-900 truncate" title={asset.name}>
                          {asset.name}
                        </p>
                        <p className="text-[9px] font-mono tabular-nums text-neutral-500">
                          {asset.naturalWidth}×{asset.naturalHeight} ·{' '}
                          {asset.storageState === 'indexeddb-persisted' ? 'IndexedDB' : 'Session Only'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'trash' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-neutral-600">
                  Soft-Deleted Layers
                </span>
                {studioDoc.trash.length > 0 && (
                  <button
                    type="button"
                    data-testid="empty-trash-btn"
                    onClick={() => void emptyTrash()}
                    className="text-[11px] font-medium text-rose-700 hover:underline cursor-pointer"
                  >
                    Empty Trash
                  </button>
                )}
              </div>
              {studioDoc.trash.length === 0 ? (
                <p className="text-[11px] text-neutral-500 py-4 text-center">
                  Trash is empty. Deleted layers can be restored here until permanently purged.
                </p>
              ) : (
                <ul className="space-y-1.5" data-testid="studio-trash-list">
                  {studioDoc.trash.map(item => {
                    const primary = item.layers[0];
                    return (
                      <li
                        key={item.id}
                        className="p-2 border border-neutral-200 rounded-xs bg-neutral-50 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-neutral-900 truncate">
                            {primary?.name ?? 'Deleted Layer'}
                          </span>
                          <span className="text-[10px] text-neutral-500 shrink-0">
                            {item.layers.length} item{item.layers.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => restoreTrashItem(item.id)}
                            className="px-2 py-0.5 text-[11px] font-medium bg-neutral-900 text-white rounded-xs inline-flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => void purgeTrashItem(item.id)}
                            className="px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xs cursor-pointer"
                          >
                            Purge
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Bottom Selection Action Bar */}
        {activeTab === 'layers' && selectedLayerIds.length > 0 && (
          <div className="px-2 py-2 border-t border-neutral-200 bg-neutral-50 flex flex-wrap items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => duplicateLayers([...selectedLayerIds])}
              title="Duplicate selected"
              className="px-2 py-1 text-[11px] bg-white border border-neutral-300 rounded-xs hover:border-neutral-500 inline-flex items-center gap-1 cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              Copy
            </button>
            {selectedLayerIds.length >= 2 && (
              <button
                type="button"
                data-testid="layers-group-btn"
                onClick={() => groupLayers([...selectedLayerIds])}
                title="Group selected layers"
                className="px-2 py-1 text-[11px] bg-white border border-neutral-300 rounded-xs hover:border-neutral-500 inline-flex items-center gap-1 cursor-pointer"
              >
                <FolderPlus className="w-3 h-3" />
                Group
              </button>
            )}
            {singleSelectedLayer?.type === 'group' && (
              <button
                type="button"
                data-testid="layers-ungroup-btn"
                onClick={() => ungroupLayer(singleSelectedLayer.id)}
                title="Ungroup selected group"
                className="px-2 py-1 text-[11px] bg-white border border-neutral-300 rounded-xs hover:border-neutral-500 inline-flex items-center gap-1 cursor-pointer"
              >
                <Ungroup className="w-3 h-3" />
                Ungroup
              </button>
            )}
            {singleSelectedLayer?.parentId && (
              <button
                type="button"
                onClick={() => reparentLayer(singleSelectedLayer.id, null)}
                title="Move out of group to canvas root"
                className="px-2 py-1 text-[11px] bg-white border border-neutral-300 rounded-xs hover:border-neutral-500 cursor-pointer"
              >
                To Root
              </button>
            )}
            <button
              type="button"
              data-testid="layers-delete-btn"
              onClick={() => {
                softDeleteLayers([...selectedLayerIds]);
                clearLayerSelection();
              }}
              title="Move selected layers to Trash"
              className="ml-auto px-2 py-1 text-[11px] text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-xs inline-flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </aside>
    </>
  );
};
