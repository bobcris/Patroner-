/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { RenderPoint2D } from './contracts/pattern-render-artifact';
import type {
  DiagnosticMarkerCluster,
  DiagnosticSeverity,
  ProjectedCanvasDiagnostics,
  ProjectedDiagnosticItem
} from './spatial-diagnostics';

export interface PatternDiagnosticsOverlayProps {
  readonly projectedDiagnostics: ProjectedCanvasDiagnostics;
  readonly invScale: number;
  readonly isYUp: boolean;
  readonly canInteractWithDiagnostics: boolean;
  readonly selectedDiagnosticKey: string | null;
  readonly onSelectDiagnostic?: (diagnosticKey: string | null) => void;
  readonly onHoverDiagnostic?: (diagnosticKey: string | null) => void;
}

interface DiagnosticPalette {
  readonly stroke: string;
  readonly fill: string;
  readonly badgeBg: string;
  readonly glyph: '!' | 'i' | '?';
}

const PALETTE_INCONCLUSIVE: DiagnosticPalette = {
  stroke: '#7c3aed',
  fill: '#f5f3ff',
  badgeBg: '#6d28d9',
  glyph: '?'
};

const PALETTE_BY_SEVERITY: Readonly<Record<DiagnosticSeverity, DiagnosticPalette>> = {
  CRITICAL_BLOCKING: {
    stroke: '#991b1b',
    fill: '#fef2f2',
    badgeBg: '#b91c1c',
    glyph: '!'
  },
  ERROR: {
    stroke: '#dc2626',
    fill: '#fef2f2',
    badgeBg: '#dc2626',
    glyph: '!'
  },
  WARNING: {
    stroke: '#d97706',
    fill: '#fffbeb',
    badgeBg: '#b45309',
    glyph: '!'
  },
  INFO: {
    stroke: '#4f46e5',
    fill: '#eef2ff',
    badgeBg: '#4338ca',
    glyph: 'i'
  }
};

function getDiagnosticPalette(
  severity: DiagnosticSeverity,
  isInconclusive: boolean
): DiagnosticPalette {
  return isInconclusive ? PALETTE_INCONCLUSIVE : PALETTE_BY_SEVERITY[severity];
}

// Constant upright local screen-pixel SVG geometry paths (centered at 0,0).
// Scaling once on each marker <g> eliminates per-zoom attribute string churn
// and Skia HarfBuzz font-shaping passes for single-character severity glyphs.
const MAPPED_POINT_RETICLE_DIAMOND_D =
  'M -11 0 H -7 M 7 0 H 11 M 0 -11 V -7 M 0 7 V 11 M 0 -7 L 7 0 L 0 7 L -7 0 Z';
const MAPPED_POINT_RETICLE_DIAMOND_EMPH_D =
  'M -11 0 H -8.2 M 8.2 0 H 11 M 0 -11 V -8.2 M 0 8.2 V 11 M 0 -8.2 L 8.2 0 L 0 8.2 L -8.2 0 Z';
const DIAMOND_D = 'M 0 -7 L 7 0 L 0 7 L -7 0 Z';
const DIAMOND_EMPH_D = 'M 0 -8.2 L 8.2 0 L 0 8.2 L -8.2 0 Z';

const GLYPH_PATH: Readonly<Record<'!' | 'i' | '?', string>> = {
  '!': 'M 0 -3.3 V 0.7 M 0 2.7 V 3.3',
  i: 'M 0 -3.2 V -2.6 M 0 -0.5 V 3.2',
  '?': 'M -1.7 -2.0 C -1.7 -3.4 1.7 -3.4 1.7 -1.7 C 1.7 -0.4 0 -0.3 0 1.0 M 0 2.7 V 3.3'
};

// Combined single-path forms for standard non-inconclusive unselected mapped-point markers
// (reduces 7 SVG nodes per marker to 2: <g> + <path>, with zero fill interference since
// open straight strokes have zero enclosed area).
const MAPPED_POINT_COMBINED_PATH: Readonly<Record<'!' | 'i', string>> = {
  '!': `${MAPPED_POINT_RETICLE_DIAMOND_D} ${GLYPH_PATH['!']}`,
  i: `${MAPPED_POINT_RETICLE_DIAMOND_D} ${GLYPH_PATH.i}`
};

const MAPPED_POINT_COMBINED_EMPH_PATH: Readonly<Record<'!' | 'i', string>> = {
  '!': `${MAPPED_POINT_RETICLE_DIAMOND_EMPH_D} ${GLYPH_PATH['!']}`,
  i: `${MAPPED_POINT_RETICLE_DIAMOND_EMPH_D} ${GLYPH_PATH.i}`
};

function segmentToBoardSvgPath(
  seg: ProjectedDiagnosticItem['resolved']['resolvedSegments'][number]['segment'],
  off: RenderPoint2D
): string {
  if (seg.kind === 'cubic-bezier' && seg.p1 && seg.p2) {
    return `M ${seg.p0.x + off.x} ${seg.p0.y + off.y} C ${seg.p1.x + off.x} ${seg.p1.y + off.y}, ${seg.p2.x + off.x} ${seg.p2.y + off.y}, ${seg.p3.x + off.x} ${seg.p3.y + off.y}`;
  }
  return `M ${seg.p0.x + off.x} ${seg.p0.y + off.y} L ${seg.p3.x + off.x} ${seg.p3.y + off.y}`;
}

function itemHasLayer1Geometry(item: ProjectedDiagnosticItem): boolean {
  const { resolved, boardBoundsCm, isSelected, isHovered } = item;
  const isEmphasized = isSelected || isHovered;
  if (resolved.outcome === 'mapped-piece' && Boolean(boardBoundsCm)) return true;
  if (resolved.outcome === 'mapped-interval' && resolved.extractedIntervals.length > 0) return true;
  if (
    resolved.resolvedSegments.length > 0 &&
    (resolved.outcome === 'mapped-segment' ||
      resolved.outcome === 'mapped-parameter' ||
      resolved.outcome === 'mapped-interval' ||
      (resolved.outcome === 'mapped-point' && isEmphasized))
  ) {
    return true;
  }
  return false;
}

function areClustersVisuallyIdentical(
  prev: readonly DiagnosticMarkerCluster[],
  next: readonly DiagnosticMarkerCluster[]
): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (
      a.clusterId !== b.clusterId ||
      a.members.length !== b.members.length ||
      a.highestSeverity !== b.highestSeverity ||
      a.hasInconclusive !== b.hasInconclusive ||
      a.hasHiddenHostLayer !== b.hasHiddenHostLayer ||
      a.containsSelected !== b.containsSelected ||
      a.containsHovered !== b.containsHovered ||
      a.boardAnchorCm.x !== b.boardAnchorCm.x ||
      a.boardAnchorCm.y !== b.boardAnchorCm.y ||
      a.primaryMember.hiddenHostLayer !== b.primaryMember.hiddenHostLayer
    ) {
      return false;
    }
    if ((a.containsSelected || a.containsHovered) && a.members.length > 1) {
      for (let j = 0; j < a.members.length; j++) {
        if (
          a.members[j].isSelected !== b.members[j].isSelected ||
          a.members[j].isHovered !== b.members[j].isHovered
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

interface DiagnosticMarkerLayerProps {
  readonly clusters: readonly DiagnosticMarkerCluster[];
  readonly markerInteractionClass: string;
  readonly initialInvScaleRef: React.MutableRefObject<number>;
  readonly initialScaleYRef: React.MutableRefObject<number>;
  readonly layerRef: React.RefObject<SVGGElement | null>;
}

/**
 * Memoized Layer-2 marker DOM subtree.
 *
 * Strictly decoupled from `invScale` / `scaleY` props so smooth pan and zoom
 * frames where cluster membership is unchanged perform zero React JSX
 * allocations/reconciliations; constant screen-pixel scale is applied
 * synchronously in `useLayoutEffect` before paint.
 */
const DiagnosticMarkerLayer: React.FC<DiagnosticMarkerLayerProps> = React.memo(
  ({ clusters, markerInteractionClass, initialInvScaleRef, initialScaleYRef, layerRef }) => {
    const initInv = initialInvScaleRef.current;
    const initScaleY = initialScaleYRef.current;

    return (
      <g ref={layerRef} data-testid="cad-diagnostics-markers-layer">
        {clusters.map(cluster => {
          const isCluster = cluster.members.length > 1;
          const primary = cluster.primaryMember;
          const isAllInconclusive =
            cluster.hasInconclusive && cluster.members.every(m => m.resolved.isInconclusive);
          const pal = getDiagnosticPalette(cluster.highestSeverity, isAllInconclusive);
          const bx = cluster.boardAnchorCm.x;
          const by = cluster.boardAnchorCm.y;
          const isEmphasized = cluster.containsSelected || cluster.containsHovered;
          const markerR = isCluster ? 9.2 : isEmphasized ? 8.2 : 7.0;
          const isMappedPoint = !isCluster && primary.resolved.outcome === 'mapped-point';
          const isDiamond =
            !isCluster &&
            (primary.resolved.isInconclusive || primary.resolved.outcome === 'mapped-point');

          const canUseCombinedSinglePath =
            isMappedPoint &&
            !primary.resolved.isInconclusive &&
            !cluster.containsSelected &&
            (pal.glyph === '!' || pal.glyph === 'i');

          const activeItem = isEmphasized
            ? cluster.members.find(m => m.isSelected) ??
              cluster.members.find(m => m.isHovered) ??
              primary
            : primary;

          return (
            <g
              key={cluster.clusterId}
              data-cluster-id={cluster.clusterId}
              data-bx={bx}
              data-by={by}
              data-cad-diagnostic-marker="true"
              data-testid={
                isCluster
                  ? 'cad-diag-cluster'
                  : `cad-diag-marker-${primary.resolved.outcome}`
              }
              data-diagnostic-key={primary.resolved.diagnosticKey}
              data-severity={cluster.highestSeverity}
              data-inconclusive={cluster.hasInconclusive ? 'true' : 'false'}
              data-hidden-host-layer={primary.hiddenHostLayer ?? ''}
              data-selected={cluster.containsSelected ? 'true' : 'false'}
              transform={`translate(${bx}, ${by}) scale(${initInv}, ${initScaleY})`}
              className={markerInteractionClass}
            >
              {/* Selection / Hover outer halo */}
              {isEmphasized && (
                <circle
                  cx={0}
                  cy={0}
                  r={markerR + 4.0}
                  fill="none"
                  stroke={pal.stroke}
                  strokeWidth={1.8}
                  strokeDasharray={cluster.hasInconclusive ? '3 2' : undefined}
                />
              )}

              {/* D5 Hidden host layer dashed ring cue */}
              {cluster.hasHiddenHostLayer && (
                <circle
                  cx={0}
                  cy={0}
                  r={markerR + 2.4}
                  fill="none"
                  stroke="#0f172a"
                  strokeWidth={1.2}
                  strokeDasharray="2.5 2"
                />
              )}

              {/* Marker body + glyph (constant screen-pixel coordinates) */}
              {canUseCombinedSinglePath ? (
                <path
                  d={
                    isEmphasized
                      ? MAPPED_POINT_COMBINED_EMPH_PATH[pal.glyph as '!' | 'i']
                      : MAPPED_POINT_COMBINED_PATH[pal.glyph as '!' | 'i']
                  }
                  fill={pal.fill}
                  stroke={pal.stroke}
                  strokeWidth={1.65}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <>
                  {isDiamond ? (
                    <path
                      d={
                        isMappedPoint
                          ? isEmphasized
                            ? MAPPED_POINT_RETICLE_DIAMOND_EMPH_D
                            : MAPPED_POINT_RETICLE_DIAMOND_D
                          : isEmphasized
                            ? DIAMOND_EMPH_D
                            : DIAMOND_D
                      }
                      fill={cluster.containsSelected ? pal.badgeBg : pal.fill}
                      stroke={pal.stroke}
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={primary.resolved.isInconclusive ? '2.5 1.5' : undefined}
                    />
                  ) : (
                    <circle
                      cx={0}
                      cy={0}
                      r={markerR}
                      fill={cluster.containsSelected || isCluster ? pal.badgeBg : pal.fill}
                      stroke={pal.stroke}
                      strokeWidth={1.8}
                      strokeDasharray={cluster.hasInconclusive ? '3 1.5' : undefined}
                    />
                  )}

                  {isCluster ? (
                    <text
                      x={0}
                      y={3.2}
                      textAnchor="middle"
                      fontSize={8.8}
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      fontWeight="800"
                      fill="#ffffff"
                    >
                      {cluster.members.length}
                    </text>
                  ) : (
                    <path
                      d={GLYPH_PATH[pal.glyph]}
                      fill="none"
                      stroke={cluster.containsSelected ? '#ffffff' : pal.stroke}
                      strokeWidth={1.65}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </>
              )}

              {/* Progressive callout label on hover/selection only (always upright in local space) */}
              {isEmphasized && (
                <g
                  data-testid="cad-diag-callout"
                  transform={`translate(${markerR + 6}, -3)`}
                >
                  <text
                    x={0}
                    y={0}
                    textAnchor="start"
                    fontSize={10}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight="700"
                    fill={pal.stroke}
                    stroke="#ffffff"
                    strokeWidth={3.2}
                    paintOrder="stroke"
                  >
                    {isCluster
                      ? `${cluster.members.length} diagnostics · ${activeItem.resolved.source.code}`
                      : activeItem.resolved.source.code}
                    {activeItem.resolved.isInconclusive ? ' [INCONCLUSIVE]' : ''}
                    {activeItem.hiddenHostLayer
                      ? ` (${activeItem.hiddenHostLayer.toUpperCase()} HIDDEN)`
                      : ''}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>
    );
  }
);

DiagnosticMarkerLayer.displayName = 'DiagnosticMarkerLayer';

/**
 * UX-2.3.3.3 — Optimized Memoized Spatial Diagnostic Overlay.
 *
 * Preserves 100% of diagnostic precision, exact De Casteljau cubic intervals,
 * collapsed root brackets, INCONCLUSIVE violet dashed styling, D5 hidden-layer
 * dashed rings, constant screen-size markers, upright callouts, and data-testid
 * contracts while eliminating empty Layer-1 groups, per-marker <text> font-shaping
 * churn on zoom, per-marker event closure allocations, and React JSX reconciliation
 * of unchanged marker clusters during pan/zoom.
 */
export const PatternDiagnosticsOverlay: React.FC<PatternDiagnosticsOverlayProps> = React.memo(
  ({
    projectedDiagnostics,
    invScale,
    isYUp,
    canInteractWithDiagnostics,
    selectedDiagnosticKey,
    onSelectDiagnostic,
    onHoverDiagnostic
  }) => {
    const hoveredClusterKeyRef = useRef<string | null>(null);
    const markersLayerRef = useRef<SVGGElement | null>(null);
    const scaleY = isYUp ? -invScale : invScale;
    const invScaleRef = useRef<number>(invScale);
    const scaleYRef = useRef<number>(scaleY);
    invScaleRef.current = invScale;
    scaleYRef.current = scaleY;

    // Structurally stabilize clusters across camera frames when marker membership,
    // coordinates, and emphasis state are unchanged so DiagnosticMarkerLayer skips
    // React reconciliation completely on pan and steady zoom frames.
    const stableClustersRef = useRef<readonly DiagnosticMarkerCluster[]>(
      projectedDiagnostics.clusters
    );
    if (!areClustersVisuallyIdentical(stableClustersRef.current, projectedDiagnostics.clusters)) {
      stableClustersRef.current = projectedDiagnostics.clusters;
    }
    const stableClusters = stableClustersRef.current;

    // Synchronize constant-screen-pixel scale on marker <g> elements before paint
    // without forcing React to rebuild/diff hundreds of JSX marker trees on zoom.
    const lastAppliedScaleRef = useRef<{ inv: number; sy: number; clusters: readonly DiagnosticMarkerCluster[] | null }>({
      inv: NaN,
      sy: NaN,
      clusters: null
    });
    useLayoutEffect(() => {
      const layerEl = markersLayerRef.current;
      if (!layerEl) return;
      const last = lastAppliedScaleRef.current;
      if (last.inv === invScale && last.sy === scaleY && last.clusters === stableClusters) {
        return;
      }
      lastAppliedScaleRef.current = { inv: invScale, sy: scaleY, clusters: stableClusters };
      const children = layerEl.children;
      const scalePart = `) scale(${invScale}, ${scaleY})`;
      for (let i = 0; i < children.length; i++) {
        const node = children[i];
        const bx = node.getAttribute('data-bx');
        const by = node.getAttribute('data-by');
        if (bx !== null && by !== null) {
          node.setAttribute('transform', `translate(${bx}, ${by}${scalePart}`);
        }
      }
    }, [invScale, scaleY, stableClusters]);

    const clusterById = useMemo(() => {
      const map = new Map<string, DiagnosticMarkerCluster>();
      for (const c of stableClusters) {
        map.set(c.clusterId, c);
      }
      return map;
    }, [stableClusters]);

    const layer1Items = useMemo(() => {
      const result: ProjectedDiagnosticItem[] = [];
      for (const item of projectedDiagnostics.visibleItems) {
        if (itemHasLayer1Geometry(item)) {
          result.push(item);
        }
      }
      return result;
    }, [projectedDiagnostics.visibleItems]);

    const handleOverlayClick = useCallback(
      (e: React.MouseEvent<SVGGElement>) => {
        if (!canInteractWithDiagnostics) return;
        const markerEl = (e.target as Element | null)?.closest?.('[data-cluster-id]');
        const clusterId = markerEl?.getAttribute('data-cluster-id');
        if (!clusterId) return;
        const cluster = clusterById.get(clusterId);
        if (!cluster) return;

        e.stopPropagation();
        if (cluster.members.length === 1) {
          const key = cluster.primaryMember.resolved.diagnosticKey;
          onSelectDiagnostic?.(selectedDiagnosticKey === key ? null : key);
          return;
        }
        const currentIdx = cluster.members.findIndex(
          m => m.resolved.diagnosticKey === selectedDiagnosticKey
        );
        const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % cluster.members.length;
        onSelectDiagnostic?.(cluster.members[nextIdx].resolved.diagnosticKey);
      },
      [canInteractWithDiagnostics, clusterById, onSelectDiagnostic, selectedDiagnosticKey]
    );

    const handleOverlayPointerOver = useCallback(
      (e: React.PointerEvent<SVGGElement>) => {
        if (!canInteractWithDiagnostics) return;
        const markerEl = (e.target as Element | null)?.closest?.('[data-cluster-id]');
        const clusterId = markerEl?.getAttribute('data-cluster-id');
        if (!clusterId) return;
        const cluster = clusterById.get(clusterId);
        if (!cluster) return;
        const nextKey = cluster.primaryMember.resolved.diagnosticKey;
        if (hoveredClusterKeyRef.current !== nextKey) {
          hoveredClusterKeyRef.current = nextKey;
          onHoverDiagnostic?.(nextKey);
        }
      },
      [canInteractWithDiagnostics, clusterById, onHoverDiagnostic]
    );

    const handleOverlayPointerOut = useCallback(
      (e: React.PointerEvent<SVGGElement>) => {
        if (!canInteractWithDiagnostics) return;
        const relatedMarker = (e.relatedTarget as Element | null)?.closest?.('[data-cluster-id]');
        if (!relatedMarker) {
          if (hoveredClusterKeyRef.current !== null) {
            hoveredClusterKeyRef.current = null;
            onHoverDiagnostic?.(null);
          }
        }
      },
      [canInteractWithDiagnostics, onHoverDiagnostic]
    );

    // Clean-draft guard: emit literally zero diagnostic SVG elements when nothing to draw
    if (stableClusters.length === 0) {
      return null;
    }

    const markerInteractionClass = canInteractWithDiagnostics
      ? 'pointer-events-auto cursor-pointer'
      : 'pointer-events-none';

    return (
      <g
        data-testid="cad-diagnostics-overlay"
        data-marker-count={stableClusters.length}
        data-visible-item-count={projectedDiagnostics.visibleItems.length}
        className="pointer-events-none"
        onClick={handleOverlayClick}
        onPointerOver={handleOverlayPointerOver}
        onPointerOut={handleOverlayPointerOut}
      >
        {/* Layer 1: Underlying spatial geometry highlights (piece frames, segments, exact De Casteljau intervals) */}
        {layer1Items.length > 0 &&
          layer1Items.map(item => {
            const { resolved, boardOffsetCm, boardBoundsCm, isSelected, isHovered } = item;
            const isEmphasized = isSelected || isHovered;
            const hasPieceFrame = resolved.outcome === 'mapped-piece' && Boolean(boardBoundsCm);
            const hasSegments =
              (resolved.outcome === 'mapped-segment' ||
                resolved.outcome === 'mapped-parameter' ||
                resolved.outcome === 'mapped-interval' ||
                (resolved.outcome === 'mapped-point' && isEmphasized)) &&
              resolved.resolvedSegments.length > 0;
            const hasIntervals =
              resolved.outcome === 'mapped-interval' && resolved.extractedIntervals.length > 0;

            const pal = getDiagnosticPalette(resolved.source.severity, resolved.isInconclusive);
            const baseOpacity = isEmphasized ? 1 : 0.82;

            return (
              <g
                key={`diag-geom-${resolved.diagnosticKey}`}
                data-testid={`cad-diag-geom-${resolved.outcome}`}
                data-diagnostic-key={resolved.diagnosticKey}
                opacity={baseOpacity}
              >
                {/* Piece-level dashed frame highlight */}
                {hasPieceFrame && boardBoundsCm && (
                  <rect
                    x={boardBoundsCm.minX - 0.5}
                    y={boardBoundsCm.minY - 0.5}
                    width={Math.max(1, boardBoundsCm.maxX - boardBoundsCm.minX + 1.0)}
                    height={Math.max(1, boardBoundsCm.maxY - boardBoundsCm.minY + 1.0)}
                    fill={isEmphasized ? pal.fill : 'none'}
                    fillOpacity={isEmphasized ? 0.25 : 0}
                    stroke={pal.stroke}
                    strokeWidth={(isEmphasized ? 2.4 : 1.6) * invScale}
                    strokeDasharray={`${5 * invScale} ${3 * invScale}`}
                  />
                )}

                {/* Segment & Multi-Segment Highlights */}
                {hasSegments &&
                  resolved.resolvedSegments.map(segEntry => {
                    const d = segmentToBoardSvgPath(segEntry.segment, boardOffsetCm);
                    const isContextOnly =
                      resolved.outcome === 'mapped-parameter' ||
                      resolved.outcome === 'mapped-interval' ||
                      resolved.outcome === 'mapped-point';
                    return (
                      <path
                        key={`seg-${resolved.diagnosticKey}-${segEntry.contour}-${segEntry.segmentId}`}
                        data-testid={
                          segEntry.isPrimary
                            ? 'cad-diag-primary-segment'
                            : 'cad-diag-secondary-segment'
                        }
                        d={d}
                        fill="none"
                        stroke={pal.stroke}
                        strokeWidth={
                          (isContextOnly
                            ? isEmphasized
                              ? 2.2
                              : 1.3
                            : segEntry.isPrimary
                              ? isEmphasized
                                ? 4.0
                                : 3.0
                              : isEmphasized
                                ? 3.2
                                : 2.4) * invScale
                        }
                        strokeDasharray={
                          resolved.isInconclusive
                            ? `${4 * invScale} ${2.5 * invScale}`
                            : !segEntry.isPrimary || isContextOnly
                              ? `${5 * invScale} ${3 * invScale}`
                              : undefined
                        }
                        strokeOpacity={isContextOnly && !isEmphasized ? 0.55 : 0.95}
                        strokeLinecap="round"
                      />
                    );
                  })}

                {/* Exact De Casteljau / Line Parameter Intervals & Collapsed Root Brackets */}
                {hasIntervals &&
                  resolved.extractedIntervals.map((interval, idx) => {
                    if (interval.kind === 'collapsed-point') {
                      const cx = interval.pointCm.x + boardOffsetCm.x;
                      const cy = interval.pointCm.y + boardOffsetCm.y;
                      return (
                        <g
                          key={`int-col-${idx}`}
                          data-testid="cad-diag-collapsed-bracket"
                          transform={`translate(${cx}, ${cy}) scale(${invScale}, ${scaleY})`}
                        >
                          <path
                            d="M 0 -6.5 L 6.5 0 L 0 6.5 L -6.5 0 Z"
                            fill={pal.fill}
                            stroke={pal.stroke}
                            strokeWidth={isEmphasized ? 2.4 : 1.8}
                            strokeDasharray={resolved.isInconclusive ? '2.5 1.5' : undefined}
                          />
                        </g>
                      );
                    }

                    const p0x = interval.p0.x + boardOffsetCm.x;
                    const p0y = interval.p0.y + boardOffsetCm.y;
                    const p3x = interval.p3.x + boardOffsetCm.x;
                    const p3y = interval.p3.y + boardOffsetCm.y;
                    const d =
                      interval.kind === 'cubic-subsegment'
                        ? `M ${p0x} ${p0y} C ${interval.p1.x + boardOffsetCm.x} ${interval.p1.y + boardOffsetCm.y}, ${interval.p2.x + boardOffsetCm.x} ${interval.p2.y + boardOffsetCm.y}, ${p3x} ${p3y}`
                        : `M ${p0x} ${p0y} L ${p3x} ${p3y}`;

                    return (
                      <g key={`int-sub-${idx}`} data-testid="cad-diag-interval-subsegment">
                        <path
                          d={d}
                          fill="none"
                          stroke={pal.stroke}
                          strokeWidth={(isEmphasized ? 5.0 : 3.8) * invScale}
                          strokeDasharray={
                            resolved.isInconclusive
                              ? `${5 * invScale} ${2.5 * invScale}`
                              : undefined
                          }
                          strokeLinecap="round"
                        />
                        {/* End-bracket ticks at tStart and tEnd */}
                        <circle
                          cx={p0x}
                          cy={p0y}
                          r={3.2 * invScale}
                          fill="#ffffff"
                          stroke={pal.stroke}
                          strokeWidth={1.6 * invScale}
                        />
                        <circle
                          cx={p3x}
                          cy={p3y}
                          r={3.2 * invScale}
                          fill="#ffffff"
                          stroke={pal.stroke}
                          strokeWidth={1.6 * invScale}
                        />
                      </g>
                    );
                  })}
              </g>
            );
          })}

        {/* Layer 2: Constant-screen-size interactive markers & screen-space clusters */}
        <DiagnosticMarkerLayer
          clusters={stableClusters}
          markerInteractionClass={markerInteractionClass}
          initialInvScaleRef={invScaleRef}
          initialScaleYRef={scaleYRef}
          layerRef={markersLayerRef}
        />
      </g>
    );
  }
);

PatternDiagnosticsOverlay.displayName = 'PatternDiagnosticsOverlay';
