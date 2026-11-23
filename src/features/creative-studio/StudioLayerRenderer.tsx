/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, ImageOff, Lock, Upload } from 'lucide-react';
import {
  GarmentSilhouetteCardLayer,
  LayerTransform,
  ReferenceImageLayer,
  StudioLayer
} from './types';
import { recordLayerRendererExecution } from './perf-probe';

export interface StudioLayerRendererProps {
  layer: StudioLayer;
  worldTransform: LayerTransform;
  isSelected: boolean;
  isCropping: boolean;
  assetUrl?: string;
  onPointerDown: (e: React.PointerEvent, layer: StudioLayer) => void;
  onContextMenu: (e: React.MouseEvent, layer: StudioLayer) => void;
  onRequestReplaceAsset?: (layerId: string) => void;
}

function renderGarmentSilhouetteSvg(layer: GarmentSilhouetteCardLayer) {
  const fill = layer.colorHex || '#E8E3D9';
  const stroke = '#18181B';
  if (layer.garmentCategory === 'bodice') {
    return (
      <svg viewBox="0 0 180 200" className="w-full h-full" aria-hidden="true">
        <path
          d="M 55 24 Q 90 42 125 24 L 154 44 L 142 84 L 130 82 L 135 176 L 45 176 L 50 82 L 38 84 L 26 44 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="1.6"
        />
        <line x1="90" y1="36" x2="90" y2="176" stroke={stroke} strokeWidth="0.9" strokeDasharray="3 3" opacity="0.55" />
        <path d="M 68 176 L 73 116 L 78 176" fill="none" stroke={stroke} strokeWidth="1" opacity="0.7" />
        <path d="M 102 176 L 107 116 L 112 176" fill="none" stroke={stroke} strokeWidth="1" opacity="0.7" />
      </svg>
    );
  }
  if (layer.garmentCategory === 'trouser') {
    return (
      <svg viewBox="0 0 180 200" className="w-full h-full" aria-hidden="true">
        <path
          d="M 54 22 L 126 22 L 136 92 L 128 182 L 96 182 L 90 100 L 84 182 L 52 182 L 44 92 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="1.6"
        />
        <line x1="54" y1="36" x2="126" y2="36" stroke={stroke} strokeWidth="1" opacity="0.65" />
      </svg>
    );
  }
  if (layer.garmentCategory === 'dress') {
    return (
      <svg viewBox="0 0 180 200" className="w-full h-full" aria-hidden="true">
        <path
          d="M 62 20 Q 90 36 118 20 L 136 38 L 122 86 L 150 182 L 30 182 L 58 86 L 44 38 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="1.6"
        />
        <line x1="58" y1="86" x2="122" y2="86" stroke={stroke} strokeWidth="1" opacity="0.6" />
      </svg>
    );
  }
  // Default: skirt (a-line / flared / straight / pencil)
  const flare =
    layer.silhouette === 'flared'
      ? 34
      : layer.silhouette === 'a-line'
        ? 22
        : layer.silhouette === 'pencil'
          ? -8
          : 4;
  const bottomLeft = 48 - flare;
  const bottomRight = 132 + flare;
  return (
    <svg viewBox="0 0 180 200" className="w-full h-full" aria-hidden="true">
      <path
        d={`M 56 26 L 124 26 L ${bottomRight} 178 Q 90 186 ${bottomLeft} 178 Z`}
        fill={fill}
        stroke={stroke}
        strokeWidth="1.6"
      />
      <line x1="56" y1="38" x2="124" y2="38" stroke={stroke} strokeWidth="1" opacity="0.65" />
      <line x1="90" y1="38" x2="90" y2="180" stroke={stroke} strokeWidth="0.9" strokeDasharray="3 3" opacity="0.5" />
      <path d="M 70 38 L 73 74 L 76 38" fill="none" stroke={stroke} strokeWidth="1" opacity="0.7" />
      <path d="M 104 38 L 107 74 L 110 38" fill="none" stroke={stroke} strokeWidth="1" opacity="0.7" />
    </svg>
  );
}

function renderReferenceImageContent(
  layer: ReferenceImageLayer,
  assetUrl: string | undefined,
  onRequestReplaceAsset?: (layerId: string) => void
) {
  if (layer.missingAssetReason || !assetUrl) {
    const reasonText =
      layer.missingAssetReason === 'permanently-purged'
        ? 'Original binary image was permanently purged and cannot be restored by Undo.'
        : layer.missingAssetReason === 'session-only-expired'
          ? 'Session-only image expired after reload.'
          : 'Image asset unavailable in local browser storage.';
    return (
      <div
        data-testid={`missing-asset-${layer.id}`}
        className="w-full h-full bg-neutral-100 border border-dashed border-amber-400 flex flex-col items-center justify-center p-4 text-center gap-2 select-none"
      >
        <ImageOff className="w-6 h-6 text-amber-700" />
        <p className="text-xs font-semibold text-neutral-900 truncate max-w-full">
          {layer.assetName}
        </p>
        <p className="text-[11px] text-amber-900 leading-snug">{reasonText}</p>
        {onRequestReplaceAsset && (
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              onRequestReplaceAsset(layer.id);
            }}
            className="mt-1 px-2.5 py-1 text-[11px] font-medium bg-neutral-900 text-white rounded-xs hover:bg-neutral-800 inline-flex items-center gap-1 cursor-pointer"
          >
            <Upload className="w-3 h-3" />
            Relink Image
          </button>
        )}
      </div>
    );
  }

  const crop = layer.crop;
  const scaleX = crop.width > 0 ? 1 / crop.width : 1;
  const scaleY = crop.height > 0 ? 1 / crop.height : 1;
  const translateXPct = -(crop.x * 100);
  const translateYPct = -(crop.y * 100);

  return (
    <div className="w-full h-full bg-neutral-200 overflow-hidden relative select-none">
      <div
        className="w-full h-full origin-top-left"
        style={{
          transform: `scale(${scaleX}, ${scaleY}) translate(${translateXPct}%, ${translateYPct}%)`
        }}
      >
        <img
          src={assetUrl}
          alt={layer.caption || layer.assetName}
          referrerPolicy="no-referrer"
          draggable={false}
          className="w-full h-full object-cover pointer-events-none select-none"
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2.5 py-1.5 flex items-center justify-between gap-2 text-[10px] text-white/95">
        <span className="truncate font-medium">{layer.name}</span>
        <span className="font-mono tabular-nums text-white/75 shrink-0">
          {layer.naturalWidth}×{layer.naturalHeight}
        </span>
      </div>
    </div>
  );
}

export const StudioLayerRenderer: React.FC<StudioLayerRendererProps> = React.memo(
  ({
    layer,
    worldTransform,
    isSelected,
    isCropping,
    assetUrl,
    onPointerDown,
    onContextMenu,
    onRequestReplaceAsset
  }) => {
    recordLayerRendererExecution();
    if (layer.type === 'group') return null;

    const style: React.CSSProperties = {
      position: 'absolute',
      left: 0,
      top: 0,
      width: `${worldTransform.width}px`,
      height: `${worldTransform.height}px`,
      opacity: layer.opacity,
      transform: `translate3d(${worldTransform.x}px, ${worldTransform.y}px, 0) rotate(${worldTransform.rotationDeg}deg)`,
      transformOrigin: 'center center',
      contain: 'layout style'
    };

    return (
      <div
        data-testid={`studio-layer-${layer.id}`}
        data-layer-id={layer.id}
        data-layer-type={layer.type}
        data-selected={isSelected ? 'true' : 'false'}
        style={style}
        onPointerDown={e => onPointerDown(e, layer)}
        onContextMenu={e => onContextMenu(e, layer)}
        className={`group select-none ${
          layer.locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
        } ${isCropping ? 'ring-2 ring-amber-500' : ''}`}
      >
        {layer.type === 'reference-image' && (
          <div className="w-full h-full rounded-xs overflow-hidden border border-neutral-300 bg-white shadow-xs">
            {renderReferenceImageContent(layer, assetUrl, onRequestReplaceAsset)}
          </div>
        )}

        {layer.type === 'moodboard-card' && (
          <div className="w-full h-full rounded-xs border border-neutral-300 bg-white shadow-xs p-4 flex flex-col justify-between overflow-hidden">
            <div className="space-y-1.5 min-h-0 overflow-hidden">
              <div className="flex items-center justify-between gap-2 text-[10px] text-neutral-500">
                <span className="truncate">{layer.subtitle}</span>
                {layer.isDemonstrationContent && (
                  <span className="text-amber-800 font-medium shrink-0">Demo</span>
                )}
              </div>
              <h3 className="text-sm font-serif font-semibold text-neutral-900 leading-snug line-clamp-2">
                {layer.title}
              </h3>
              <p className="text-xs text-neutral-600 leading-relaxed line-clamp-5">
                {layer.notes}
              </p>
            </div>
            <div className="pt-2 border-t border-neutral-100 flex items-center justify-between gap-2 text-[10px] text-neutral-500">
              <span className="truncate">{layer.tags.join(' · ') || 'Moodboard direction'}</span>
              <span
                className="w-3 h-3 rounded-xs border border-neutral-300 shrink-0"
                style={{ backgroundColor: layer.accentHex }}
              />
            </div>
          </div>
        )}

        {layer.type === 'color-palette' && (
          <div className="w-full h-full rounded-xs border border-neutral-300 bg-white shadow-xs p-3 flex flex-col justify-between overflow-hidden">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-neutral-900 truncate">{layer.title}</span>
              <span className="text-[10px] text-neutral-500 shrink-0">
                {layer.swatches.length} colors
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 flex-1 my-2 min-h-0">
              {layer.swatches.slice(0, 8).map(swatch => (
                <div key={swatch.id} className="flex flex-col min-w-0">
                  <div
                    className="flex-1 rounded-xs border border-neutral-300/80 min-h-[38px]"
                    style={{ backgroundColor: swatch.hex }}
                  />
                  <span className="text-[10px] font-medium text-neutral-800 truncate mt-1">
                    {swatch.name}
                  </span>
                  <span className="text-[9px] font-mono tabular-nums text-neutral-500 uppercase">
                    {swatch.hex}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {layer.type === 'fabric-swatch' && (
          <div className="w-full h-full rounded-xs border border-neutral-300 bg-white shadow-xs overflow-hidden flex flex-col">
            <div
              className="h-16 w-full border-b border-neutral-200 relative shrink-0"
              style={{
                backgroundColor: layer.swatchHex,
                backgroundImage:
                  'repeating-linear-gradient(45deg, rgba(0,0,0,0.04) 0, rgba(0,0,0,0.04) 2px, transparent 2px, transparent 6px)'
              }}
            />
            <div className="p-3 flex-1 flex flex-col justify-between min-h-0">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-neutral-900 truncate">{layer.fabricName}</p>
                <p className="text-[10px] text-neutral-500 truncate">{layer.composition}</p>
              </div>
              <p className="text-[10px] text-neutral-600 line-clamp-2 leading-snug">
                {layer.drapeNote}
              </p>
              <span className="text-[10px] text-neutral-500 capitalize">{layer.weightLabel}</span>
            </div>
          </div>
        )}

        {layer.type === 'garment-silhouette-card' && (
          <div className="w-full h-full rounded-xs border border-neutral-300 bg-white shadow-xs p-3 flex flex-col justify-between overflow-hidden">
            <div className="flex items-center justify-between gap-2 text-[10px] text-neutral-500">
              <span className="capitalize truncate">
                {layer.garmentCategory} · {layer.silhouette}
              </span>
              {layer.isDemonstrationContent && (
                <span className="text-amber-800 font-medium shrink-0">Demo</span>
              )}
            </div>
            <div className="flex-1 min-h-0 my-1.5 flex items-center justify-center bg-neutral-50 rounded-xs border border-neutral-100 p-2">
              {renderGarmentSilhouetteSvg(layer)}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-serif font-semibold text-neutral-900 truncate">
                {layer.title}
              </p>
              <div className="flex items-center justify-between text-[10px] text-neutral-500">
                <span className="truncate">{layer.fabricName}</span>
                <span className="font-mono tabular-nums shrink-0">{layer.lengthCm} cm</span>
              </div>
              <p className="text-[9px] text-neutral-400">
                Concept Visual · Non-Authoritative Pattern
              </p>
            </div>
          </div>
        )}

        {layer.type === 'freehand-sketch' && (
          <div className="w-full h-full relative pointer-events-auto">
            <svg
              viewBox={`0 0 ${Math.max(1, layer.transform.width)} ${Math.max(1, layer.transform.height)}`}
              className="w-full h-full overflow-visible"
              aria-label={layer.name}
            >
              {layer.strokes.map(stroke => (
                <polyline
                  key={stroke.id}
                  fill="none"
                  stroke={stroke.strokeColor}
                  strokeWidth={stroke.strokeWidth}
                  strokeOpacity={stroke.opacity}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={stroke.points.map(p => `${p.x},${p.y}`).join(' ')}
                />
              ))}
            </svg>
            <span className="absolute -bottom-4 left-0 text-[9px] text-amber-800/90 whitespace-nowrap bg-amber-50/90 px-1 rounded-xs border border-amber-200/80">
              Unverified Visual Sketch (Non-CAD)
            </span>
          </div>
        )}

        {layer.type === 'annotation-note' && (
          <div
            className={`w-full h-full rounded-xs border p-3 shadow-xs flex flex-col justify-between overflow-hidden ${
              layer.tone === 'caution'
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : layer.tone === 'atelier'
                  ? 'bg-[#FCFBF7] border-neutral-300 text-neutral-900'
                  : 'bg-white border-neutral-300 text-neutral-800'
            }`}
          >
            <p className="text-xs leading-relaxed whitespace-pre-wrap overflow-hidden">
              {layer.text}
            </p>
            <div className="pt-1.5 border-t border-black/10 flex items-center justify-between text-[9px] text-neutral-500">
              <span>Unverified Visual Note</span>
              {layer.isDemonstrationContent && <span>Demo</span>}
            </div>
          </div>
        )}

        {layer.locked && (
          <span
            title="Layer locked"
            className="absolute top-1.5 right-1.5 p-1 bg-neutral-900/75 text-white rounded-xs pointer-events-none"
          >
            <Lock className="w-2.5 h-2.5" />
          </span>
        )}
        {layer.type === 'reference-image' && layer.missingAssetReason && (
          <span
            title="Missing binary image"
            className="absolute top-1.5 left-1.5 p-1 bg-amber-600 text-white rounded-xs pointer-events-none"
          >
            <AlertTriangle className="w-2.5 h-2.5" />
          </span>
        )}
      </div>
    );
  }
);

StudioLayerRenderer.displayName = 'StudioLayerRenderer';
