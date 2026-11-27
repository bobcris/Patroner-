/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CheckCircle2,
  Crosshair,
  Eye,
  EyeOff,
  FolderPlus,
  Layers,
  Ruler,
  Scissors,
  Sliders,
  Ungroup,
  X
} from 'lucide-react';
import { useProjectWorkspace } from '../../state/ProjectWorkspaceContext';
import { useViewportInteraction } from '../../state/ViewportInteractionContext';
import {
  PatternCadLayerVisibility,
  useOptionalPatternAtelierView
} from './PatternAtelierViewContext';
import type { OverlapClassification } from './board-arrangement';
import type { CadInspectableEntity } from './entity-hit-test';
import {
  ADVISORY_MEASUREMENT_DISCLOSURE,
  CubicBezierArcLengthResult,
  MeasurementClassification,
  SpaceDistanceMetrics,
  VertexAngleMeasurementResult
} from './precision-measurement';
import type {
  DiagnosticSeverity,
  DiagnosticSeverityFilter,
  ResolvedArtifactDiagnostics,
  ResolvedSpatialDiagnostic,
  SpatialMappingOutcome
} from './spatial-diagnostics';
import { AssemblyInspectionPanel } from './AssemblyInspectionPanel';
import { PatternContourEditInspectorSection } from './PatternContourEditInspectorSection';
import { PatternSeamInspectorSection } from './PatternSeamInspectorSection';
import { PatternConstructionInspectorSection } from './PatternConstructionInspectorSection';
import { PatternDartInspectorSection } from './PatternDartInspectorSection';
import { PatternAllowanceInspectorSection } from './PatternAllowanceInspectorSection';
import { PatternOperationHistorySection } from './PatternOperationHistorySection';
import { isProposalAuthoringTool } from './tool-dispatch';
import { WP_A_AUTHORITY_TIER } from './contracts/wp-a-shared-contracts';
import { draftSleeveBlock } from '../../engine/drafting/sleeve-block';
import { assembleBodiceSleeve, formatSignedCm } from '../../engine/assembly';
import { DEFAULT_SIZE_RANGE } from '../../engine/grading';
import { STANDARD_SIZING_SYSTEM } from '../../engine/measurements/standards';
import {
  SYNTHETIC_TEST_PROTOTYPE_CONFORMING,
  SYNTHETIC_TEST_PROTOTYPE_DISCREPANT
} from '../../engine/prototype/prototype-fixtures';
import { validatePhysicalFit } from '../../engine/prototype/fit-validator';
import {
  DEFAULT_ILLUSTRATIVE_FABRIC,
  getEnhancedFabricById
} from '../../engine/fabric/fabric-presets';
import {
  calculateCompleteGarmentEase,
  calculateFabricAdaptedSleeveCapEase
} from '../../engine/fabric/ease-engine';

const SIZE_STROKE: Record<string, string> = {
  XS: '#9333ea',
  S: '#2563eb',
  M: '#16a34a',
  L: '#d97706',
  XL: '#dc2626',
  XXL: '#7c3aed'
};

const OVERLAP_META: Record<
  OverlapClassification,
  { label: string; badgeClass: string; borderClass: string }
> = {
  'unintentional-overlap': {
    label: 'Unintentional Overlap',
    badgeClass: 'text-rose-800 bg-rose-100',
    borderClass: 'border-rose-200 bg-rose-50/60'
  },
  containment: {
    label: 'Containment',
    badgeClass: 'text-rose-800 bg-rose-100',
    borderClass: 'border-rose-200 bg-rose-50/60'
  },
  'touching-boundaries': {
    label: 'Touching Boundaries',
    badgeClass: 'text-amber-800 bg-amber-100',
    borderClass: 'border-amber-200 bg-amber-50/50'
  },
  'intentional-overlap': {
    label: 'Intentional Overlap',
    badgeClass: 'text-sky-800 bg-sky-100',
    borderClass: 'border-sky-200 bg-sky-50/50'
  },
  unresolved: {
    label: 'Unresolved',
    badgeClass: 'text-neutral-700 bg-neutral-200',
    borderClass: 'border-neutral-300 bg-neutral-100/70'
  }
};

function formatUnroundedCm(value: number): string {
  if (!Number.isFinite(value)) return 'NaN';
  return Object.is(value, -0) ? '0' : String(value);
}

function formatMetricCm(value: number | null, digits = 4): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${normalized.toFixed(digits)} cm`;
}

function formatSignedMetricCm(value: number | null, digits = 4): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(digits)} cm`;
}

function formatDeg(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${normalized.toFixed(digits)}°`;
}

function formatSciCm(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 cm';
  if (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e4) {
    return `${value.toExponential(2)} cm`;
  }
  return `${value.toFixed(6)} cm`;
}

function formatClassificationBadge(classification: MeasurementClassification): string {
  switch (classification) {
    case 'algebraic-float64':
      return 'Algebraic Float64';
    case 'numerical-approximation':
      return 'Numerical Approx.';
    case 'indeterminate':
      return 'Indeterminate';
  }
}

const MetricRow: React.FC<{
  label: string;
  value: React.ReactNode;
  testId?: string;
}> = ({ label, value, testId }) => (
  <div className="flex items-baseline justify-between gap-2 text-[10.5px]">
    <dt className="text-neutral-500 shrink-0">{label}</dt>
    <dd
      data-testid={testId}
      className="font-mono tabular-nums text-neutral-900 text-right truncate"
    >
      {value}
    </dd>
  </div>
);

const SpaceDistanceBlock: React.FC<{
  title: string;
  subtitle: string;
  metrics: SpaceDistanceMetrics | null;
  unavailableReason?: string;
  testId: string;
}> = ({ title, subtitle, metrics, unavailableReason, testId }) => (
  <div
    data-testid={testId}
    className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1"
  >
    <div className="flex items-baseline justify-between gap-1.5">
      <span className="text-[10px] font-semibold text-neutral-700">{title}</span>
      <span className="text-[9.5px] font-mono text-neutral-400 shrink-0">{subtitle}</span>
    </div>
    {!metrics ? (
      <p className="text-[10px] text-neutral-500 leading-snug">
        {unavailableReason ?? 'Unavailable in this coordinate space.'}
      </p>
    ) : (
      <dl className="space-y-0.5 pt-0.5">
        <MetricRow
          label="Distance"
          value={
            <span className="font-semibold text-amber-900">
              {formatMetricCm(metrics.distanceCm, 4)}
            </span>
          }
          testId={`${testId}-distance`}
        />
        <MetricRow
          label="ΔX"
          value={formatSignedMetricCm(metrics.dxCm, 4)}
          testId={`${testId}-dx`}
        />
        <MetricRow
          label="ΔY"
          value={formatSignedMetricCm(metrics.dyCm, 4)}
          testId={`${testId}-dy`}
        />
        {metrics.isCoincident ? (
          <p className="text-[10px] text-amber-800 pt-0.5 leading-snug">
            {metrics.angleIndeterminateReason ?? 'Coincident points — direction angle indeterminate.'}
          </p>
        ) : (
          metrics.angles && (
            <>
              <MetricRow
                label="Visual Incl."
                value={formatDeg(metrics.angles.visualInclinationDeg, 2)}
              />
              <MetricRow
                label="Bearing (0° N)"
                value={formatDeg(metrics.angles.compassBearingDeg, 2)}
              />
              <MetricRow
                label="Line Orient."
                value={formatDeg(metrics.angles.undirectedOrientationDeg, 2)}
              />
            </>
          )
        )}
      </dl>
    )}
  </div>
);

const VertexAngleDetailsBlock: React.FC<{
  result: VertexAngleMeasurementResult;
  compact?: boolean;
}> = ({ result, compact = false }) => (
  <div className="space-y-2">
    <div className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1">
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[10px] font-semibold text-neutral-700">
          {compact ? 'Vertex Angle Preview' : 'Vertex Angle Breakdown'}
        </span>
        {result.usedHigherOrderEndpointTangent && (
          <span className="text-[9px] font-mono font-semibold text-amber-800 bg-amber-100 px-1 py-0.5 rounded-xs">
            L&apos;Hôpital
          </span>
        )}
      </div>
      <dl className="space-y-0.5">
        <MetricRow
          label="Included Angle"
          value={
            <span className="font-semibold text-neutral-900">
              {formatDeg(result.includedAngleDeg, 2)}
            </span>
          }
          testId="inspector-vertex-included-angle"
        />
        <MetricRow label="Turn Deflection" value={formatDeg(result.turnAngleDeg, 2)} />
        {result.interiorExteriorStatus === 'determined' ? (
          <>
            <MetricRow
              label="Interior Angle"
              value={
                <span className="font-semibold text-amber-900">
                  {formatDeg(result.interiorAngleDeg, 2)}
                  {result.isReflex ? ' (Reflex)' : ''}
                </span>
              }
              testId="inspector-vertex-interior-angle"
            />
            <MetricRow
              label="Exterior Angle"
              value={formatDeg(result.exteriorAngleDeg, 2)}
              testId="inspector-vertex-exterior-angle"
            />
          </>
        ) : (
          <div
            data-testid="inspector-vertex-indeterminate-notice"
            className="mt-1 p-1.5 rounded-xs bg-amber-50 border border-amber-200 text-[10px] text-amber-900 leading-snug"
          >
            <div className="font-semibold">Interior / Exterior: Indeterminate</div>
            <div>
              {result.indeterminateReason ??
                'Contour orientation could not be verified; unsigned included angle preserved.'}
            </div>
          </div>
        )}
      </dl>
    </div>

    {!compact && (
      <div className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1">
        <span className="text-[10px] font-semibold text-neutral-700 block">
          Contour Orientation (Green&apos;s Theorem)
        </span>
        <dl className="space-y-0.5">
          <MetricRow label="Status" value={result.contourOrientation.status} />
          <MetricRow
            label="Signed Area"
            value={
              result.contourOrientation.algebraicSignedAreaCm2 !== null
                ? `${result.contourOrientation.algebraicSignedAreaCm2.toFixed(3)} cm²`
                : '—'
            }
          />
          <MetricRow
            label="Visual Winding"
            value={result.contourOrientation.visualWinding ?? 'Indeterminate'}
          />
          <MetricRow
            label="Incoming Seg"
            value={result.incomingSegmentId ?? '—'}
          />
          <MetricRow
            label="Outgoing Seg"
            value={result.outgoingSegmentId ?? '—'}
          />
        </dl>
      </div>
    )}
  </div>
);

const ArcLengthSubBlock: React.FC<{
  title: string;
  result: CubicBezierArcLengthResult;
  testId: string;
}> = ({ title, result, testId }) => (
  <div
    data-testid={testId}
    className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1"
  >
    <div className="flex items-center justify-between gap-1.5">
      <span className="text-[10px] font-semibold text-neutral-700">{title}</span>
      <span
        data-testid={`${testId}-convergence`}
        className={`text-[9px] font-mono font-semibold px-1 py-0.5 rounded-xs shrink-0 ${
          result.converged
            ? 'text-emerald-800 bg-emerald-100'
            : 'text-rose-800 bg-rose-100'
        }`}
      >
        {result.converged ? 'Converged' : 'Non-Converged'}
      </span>
    </div>
    <dl className="space-y-0.5">
      <MetricRow
        label="Approx. Length"
        value={
          <span className="font-semibold text-amber-900">
            {formatMetricCm(result.arcLengthCm, 4)}
          </span>
        }
        testId={`${testId}-value`}
      />
      <MetricRow
        label="Quadrature Error Est."
        value={formatSciCm(result.quadratureErrorEstimateCm)}
        testId={`${testId}-quad-err`}
      />
      <MetricRow
        label="Geom. Enclosure Width"
        value={formatSciCm(result.geometricEnclosureWidthCm)}
        testId={`${testId}-enclosure`}
      />
      <MetricRow
        label="Tolerance (abs)"
        value={formatSciCm(result.options.absoluteToleranceCm)}
      />
      <MetricRow
        label="Subdivisions / Depth"
        value={`${result.subdivisionsEvaluated} / d=${result.maxDepthReached}`}
      />
    </dl>
    <p className="text-[9.5px] text-neutral-500 leading-snug pt-0.5">
      Quadrature error is a numerical estimator (not a certified error bound); enclosure width is
      control-polygon upper minus chord lower bound.
    </p>
    {result.warning && (
      <div className="p-1.5 rounded-xs bg-rose-50 border border-rose-200 text-[10px] text-rose-900 leading-snug">
        {result.warning}
      </div>
    )}
    {result.geometricEnclosureNote && (
      <div className="p-1.5 rounded-xs bg-amber-50 border border-amber-200 text-[10px] text-amber-900 leading-snug">
        {result.geometricEnclosureNote}
      </div>
    )}
  </div>
);

function getEntityKindDisplayLabel(entity: CadInspectableEntity): string {
  switch (entity.entityKind) {
    case 'vertex':
      return entity.isSharedJunction ? 'Shared Contour Vertex' : 'Contour Vertex';
    case 'bezier-handle':
      return `Bézier Control Handle (${entity.handleSlot.toUpperCase()})`;
    case 'edge':
      return 'Straight Edge Segment';
    case 'curve':
      return 'Cubic Bézier Curve';
    case 'notch':
      return 'Pattern Notch';
    case 'dart':
      return 'Dart Path';
    case 'dart-landmark':
      return `Dart Landmark (${entity.landmarkRole})`;
  }
}

function getDiagnosticOutcomeLabel(outcome: SpatialMappingOutcome): string {
  switch (outcome) {
    case 'mapped-point':
      return 'Point';
    case 'mapped-parameter':
      return 'Parameter';
    case 'mapped-interval':
      return 'Interval';
    case 'mapped-segment':
      return 'Segment';
    case 'mapped-piece':
      return 'Piece';
    case 'unmapped':
      return 'Unmapped';
    case 'stale-reference':
      return 'Stale Ref';
    case 'invalid-reference':
      return 'Invalid Ref';
  }
}

function getDiagnosticSeverityBadgeClass(
  sev: DiagnosticSeverity,
  isInconclusive: boolean
): string {
  if (isInconclusive) return 'bg-violet-100 text-violet-900 border-violet-300';
  switch (sev) {
    case 'CRITICAL_BLOCKING':
      return 'bg-rose-100 text-rose-900 border-rose-300';
    case 'ERROR':
      return 'bg-red-100 text-red-900 border-red-300';
    case 'WARNING':
      return 'bg-amber-100 text-amber-900 border-amber-300';
    case 'INFO':
      return 'bg-indigo-100 text-indigo-900 border-indigo-300';
  }
}

function getHiddenHostLayerLabel(
  item: ResolvedSpatialDiagnostic,
  layerVisibility: PatternCadLayerVisibility
): string | null {
  if (!item.contourScope) return null;
  if (item.contourScope === 'sew' && !layerVisibility.showSewLines) return 'Sew';
  if (item.contourScope === 'cut' && !layerVisibility.showSeamAllowance) return 'Cut';
  return null;
}

const DiagnosticRowCard: React.FC<{
  readonly item: ResolvedSpatialDiagnostic;
  readonly isSelected: boolean;
  readonly hiddenHost: string | null;
  readonly onSelect: (key: string | null) => void;
  readonly onLocate: (key: string) => void;
}> = React.memo(({ item, isSelected, hiddenHost, onSelect, onLocate }) => (
  <div
    data-testid={`inspector-diag-row-${item.outcome}`}
    data-diagnostic-key={item.diagnosticKey}
    data-selected={isSelected ? 'true' : 'false'}
    className={`p-2 rounded-xs border text-[10.5px] space-y-1 transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_68px] ${
      isSelected
        ? 'bg-neutral-900 text-white border-neutral-900'
        : item.isInconclusive
          ? 'bg-violet-50/60 border-violet-200 hover:border-violet-400'
          : item.source.severity === 'CRITICAL_BLOCKING' || item.source.severity === 'ERROR'
            ? 'bg-rose-50/50 border-rose-200 hover:border-rose-400'
            : item.source.severity === 'WARNING'
              ? 'bg-amber-50/50 border-amber-200 hover:border-amber-400'
              : 'bg-indigo-50/40 border-indigo-200 hover:border-indigo-400'
    }`}
  >
    <div className="flex items-start justify-between gap-1.5">
      <button
        type="button"
        onClick={() => onSelect(isSelected ? null : item.diagnosticKey)}
        className="flex-1 min-w-0 text-left cursor-pointer space-y-0.5"
      >
        <div className="flex items-center gap-1 flex-wrap">
          <span
            className={`px-1 py-0.25 rounded-xs border font-mono text-[9px] font-bold ${
              isSelected
                ? 'bg-white/15 text-white border-white/30'
                : getDiagnosticSeverityBadgeClass(item.source.severity, item.isInconclusive)
            }`}
          >
            {item.isInconclusive ? 'INCONCLUSIVE' : item.source.severity}
          </span>
          <span
            className={`px-1 py-0.25 rounded-xs font-mono text-[9px] ${
              isSelected ? 'bg-white/15 text-neutral-200' : 'bg-neutral-200/80 text-neutral-700'
            }`}
          >
            {getDiagnosticOutcomeLabel(item.outcome)}
          </span>
          {hiddenHost && (
            <span
              className={`px-1 py-0.25 rounded-xs font-mono text-[9px] ${
                isSelected ? 'bg-amber-400/20 text-amber-200' : 'bg-neutral-800 text-white'
              }`}
            >
              {hiddenHost} hidden
            </span>
          )}
        </div>
        <div className="font-mono font-semibold truncate text-[10.5px]">{item.source.code}</div>
        <p
          className={`text-[10px] leading-snug line-clamp-2 ${
            isSelected ? 'text-neutral-200' : 'text-neutral-700'
          }`}
        >
          {item.source.message}
        </p>
      </button>

      {item.isMapped && (
        <button
          type="button"
          data-testid={`inspector-diag-locate-${item.source.id}`}
          onClick={() => onLocate(item.diagnosticKey)}
          title="Center canvas camera on this diagnostic"
          aria-label={`Locate ${item.source.code} on canvas`}
          className={`px-1.5 py-0.5 rounded-xs border font-mono text-[9.5px] shrink-0 cursor-pointer transition-colors ${
            isSelected
              ? 'bg-white text-neutral-900 border-white hover:bg-neutral-200'
              : 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100'
          }`}
        >
          Locate
        </button>
      )}
    </div>
  </div>
));

DiagnosticRowCard.displayName = 'DiagnosticRowCard';

interface SpatialDiagnosticsInspectorSectionProps {
  readonly resolvedDiagnostics: ResolvedArtifactDiagnostics;
  readonly showDiagnosticsOverlay: boolean;
  readonly toggleDiagnosticsOverlay: () => void;
  readonly diagnosticSeverityFilter: DiagnosticSeverityFilter;
  readonly toggleDiagnosticSeverityFilter: (severity: DiagnosticSeverity) => void;
  readonly selectedDiagnosticKey: string | null;
  readonly selectDiagnostic: (key: string | null) => void;
  readonly clearDiagnosticSelection: () => void;
  readonly locateDiagnosticOnCanvas: (key: string) => void;
  readonly diagnosticReconciliationNotice: string | null;
  readonly dismissDiagnosticReconciliationNotice: () => void;
  readonly layerVisibility: PatternCadLayerVisibility;
  readonly hasActiveProposal?: boolean;
}

const SpatialDiagnosticsInspectorSection: React.FC<SpatialDiagnosticsInspectorSectionProps> =
  React.memo(
    ({
      resolvedDiagnostics,
      showDiagnosticsOverlay,
      toggleDiagnosticsOverlay,
      diagnosticSeverityFilter,
      toggleDiagnosticSeverityFilter,
      selectedDiagnosticKey,
      selectDiagnostic,
      clearDiagnosticSelection,
      locateDiagnosticOnCanvas,
      diagnosticReconciliationNotice,
      dismissDiagnosticReconciliationNotice,
      layerVisibility,
      hasActiveProposal = false
    }) => {
      const summary = resolvedDiagnostics.summary;
      const selectedDiag: ResolvedSpatialDiagnostic | undefined = selectedDiagnosticKey
        ? resolvedDiagnostics.byKey.get(selectedDiagnosticKey)
        : undefined;

      const filteredMapped = useMemo(
        () =>
          resolvedDiagnostics.mappedItems.filter(
            item => diagnosticSeverityFilter[item.source.severity]
          ),
        [resolvedDiagnostics.mappedItems, diagnosticSeverityFilter]
      );
      const filteredUnmapped = useMemo(
        () =>
          resolvedDiagnostics.unmappedItems.filter(
            item => diagnosticSeverityFilter[item.source.severity]
          ),
        [resolvedDiagnostics.unmappedItems, diagnosticSeverityFilter]
      );
      const filteredStaleInvalid = useMemo(
        () =>
          resolvedDiagnostics.staleOrInvalidItems.filter(
            item => diagnosticSeverityFilter[item.source.severity]
          ),
        [resolvedDiagnostics.staleOrInvalidItems, diagnosticSeverityFilter]
      );

      const selectedHiddenHost = selectedDiag
        ? getHiddenHostLayerLabel(selectedDiag, layerVisibility)
        : null;

      return (
        <div className="space-y-2" data-testid="inspector-spatial-diagnostics">
          {/* UX-2.3.3.4 (D3): Explicit notice that spatial diagnostics remain anchored to the original artifact */}
          {hasActiveProposal && (
            <div
              data-testid="inspector-diag-original-anchor-notice"
              className="px-2 py-1.5 rounded-xs border border-amber-300 bg-amber-50/90 text-[10px] text-amber-950 leading-snug"
            >
              <strong>Original Artifact Anchor (D3):</strong> Spatial diagnostics remain strictly
              anchored to the immutable original source artifact and are not silently migrated to
              unverified proposal geometry.
            </div>
          )}

          {/* Overlay toggle & summary strip */}
          <div className="flex items-center justify-between gap-1.5 flex-wrap bg-neutral-50 border border-neutral-200 rounded-xs px-2 py-1.5">
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-neutral-700 flex-wrap">
              <span data-testid="inspector-diag-mapped-count">
                Mapped: <strong>{summary.mappedCount}</strong>
              </span>
              <span className="text-neutral-300">·</span>
              <span data-testid="inspector-diag-unmapped-count">
                Unmapped: <strong>{summary.unmappedCount}</strong>
              </span>
              {(summary.staleCount > 0 || summary.invalidCount > 0) && (
                <>
                  <span className="text-neutral-300">·</span>
                  <span
                    data-testid="inspector-diag-stale-count"
                    className="text-rose-700 font-semibold"
                  >
                    Stale/Inv: {summary.staleCount + summary.invalidCount}
                  </span>
                </>
              )}
              {summary.inconclusiveCount > 0 && (
                <>
                  <span className="text-neutral-300">·</span>
                  <span
                    data-testid="inspector-diag-inconclusive-count"
                    className="text-violet-800 font-semibold"
                  >
                    Inconclusive: {summary.inconclusiveCount}
                  </span>
                </>
              )}
            </div>
            <button
              type="button"
              aria-pressed={showDiagnosticsOverlay}
              data-testid="inspector-diag-overlay-toggle"
              onClick={toggleDiagnosticsOverlay}
              className={`px-1.5 py-0.5 rounded-xs border text-[10px] font-mono inline-flex items-center gap-1 cursor-pointer ${
                showDiagnosticsOverlay
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-600 border-neutral-300'
              }`}
            >
              {showDiagnosticsOverlay ? (
                <Eye className="w-3 h-3" />
              ) : (
                <EyeOff className="w-3 h-3" />
              )}
              <span>{showDiagnosticsOverlay ? 'On Canvas' : 'Hidden'}</span>
            </button>
          </div>

          {/* Severity filter controls (shown when diagnostics exist) */}
          {summary.total > 0 && (
            <div
              className="flex items-center gap-1 flex-wrap"
              role="group"
              aria-label="Diagnostic severity filters"
            >
              {(
                [
                  { key: 'CRITICAL_BLOCKING', label: 'CRIT' },
                  { key: 'ERROR', label: 'ERR' },
                  { key: 'WARNING', label: 'WARN' },
                  { key: 'INFO', label: 'INFO' }
                ] as const
              ).map(f => {
                const active = diagnosticSeverityFilter[f.key];
                const count = summary.bySeverity[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={active}
                    data-testid={`inspector-diag-filter-${f.key}`}
                    onClick={() => toggleDiagnosticSeverityFilter(f.key)}
                    className={`px-1.5 py-0.5 rounded-xs border font-mono text-[9.5px] cursor-pointer transition-colors ${
                      active
                        ? 'bg-neutral-800 text-white border-neutral-800'
                        : 'bg-white text-neutral-400 border-neutral-200 hover:text-neutral-700'
                    }`}
                  >
                    {f.label} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Stale selection reconciliation notice */}
          {diagnosticReconciliationNotice && (
            <div
              data-testid="inspector-diag-reconcile-notice"
              className="px-2 py-1.5 rounded-xs border border-amber-300 bg-amber-50 text-[10px] text-amber-900 flex items-start justify-between gap-1.5"
            >
              <span>{diagnosticReconciliationNotice}</span>
              <button
                type="button"
                onClick={dismissDiagnosticReconciliationNotice}
                aria-label="Dismiss diagnostic reconciliation notice"
                className="p-0.5 text-amber-800 hover:text-amber-950 cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Selected Diagnostic Detailed Card */}
          {selectedDiag && (
            <div
              data-testid="inspector-diag-detail"
              data-diagnostic-key={selectedDiag.diagnosticKey}
              className="p-2.5 rounded-xs border border-neutral-300 bg-white space-y-1.5 text-[10.5px]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono font-bold text-neutral-900 break-all">
                    {selectedDiag.source.code}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap mt-0.5">
                    <span
                      className={`px-1 py-0.25 rounded-xs border font-mono text-[9px] font-bold ${getDiagnosticSeverityBadgeClass(selectedDiag.source.severity, selectedDiag.isInconclusive)}`}
                    >
                      {selectedDiag.source.severity}
                    </span>
                    <span className="px-1 py-0.25 rounded-xs bg-neutral-100 border border-neutral-200 font-mono text-[9px] text-neutral-700">
                      {selectedDiag.outcome}
                    </span>
                    {selectedDiag.source.verificationOutcome && (
                      <span
                        data-testid="inspector-diag-verification-outcome"
                        className={`px-1 py-0.25 rounded-xs border font-mono text-[9px] font-semibold ${
                          selectedDiag.source.verificationOutcome === 'INCONCLUSIVE'
                            ? 'bg-violet-100 text-violet-900 border-violet-300'
                            : selectedDiag.source.verificationOutcome === 'CERTIFIED_INVALID'
                              ? 'bg-rose-100 text-rose-900 border-rose-300'
                              : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                        }`}
                      >
                        {selectedDiag.source.verificationOutcome}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearDiagnosticSelection}
                  aria-label="Clear selected diagnostic"
                  className="p-0.5 text-neutral-500 hover:text-neutral-900 cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-[10.5px] text-neutral-800 leading-snug">
                {selectedDiag.source.message}
              </p>

              {selectedDiag.source.remediationAction && (
                <div className="px-2 py-1 rounded-xs bg-neutral-50 border border-neutral-200 text-[10px] text-neutral-700">
                  <strong className="text-neutral-900">Remediation:</strong>{' '}
                  {selectedDiag.source.remediationAction}
                </div>
              )}

              <dl className="space-y-0.5 pt-1 border-t border-neutral-100">
                <MetricRow label="Mapping" value={selectedDiag.resolutionNote} />
                {selectedDiag.pieceCode && (
                  <MetricRow
                    label="Piece"
                    value={`${selectedDiag.pieceCode} (${selectedDiag.pieceId})`}
                  />
                )}
                {selectedDiag.resolvedSegments.length > 0 && (
                  <MetricRow
                    label="Segment(s)"
                    value={selectedDiag.resolvedSegments
                      .map(s => `${s.segmentId} [${s.contour}]`)
                      .join(', ')}
                  />
                )}
                {selectedDiag.parameterT !== undefined && (
                  <MetricRow label="Parameter t" value={String(selectedDiag.parameterT)} />
                )}
                {selectedDiag.source.parameterIntervals &&
                  selectedDiag.source.parameterIntervals.length > 0 && (
                    <MetricRow
                      label="Interval(s)"
                      value={selectedDiag.source.parameterIntervals
                        .map(([a, b]) => `[${a}, ${b}]`)
                        .join(', ')}
                    />
                  )}
                {selectedDiag.localAnchorCm && (
                  <MetricRow
                    label="Local Coords"
                    value={`(${formatUnroundedCm(selectedDiag.localAnchorCm.x)}, ${formatUnroundedCm(selectedDiag.localAnchorCm.y)}) cm`}
                  />
                )}
                {selectedDiag.source.canonicalOffsetClassification && (
                  <MetricRow
                    label="Classification"
                    value={selectedDiag.source.canonicalOffsetClassification}
                  />
                )}
                {selectedDiag.source.maxGeometricDeviationBoundCm !== undefined && (
                  <MetricRow
                    label="Max Dev. Bound"
                    value={`${selectedDiag.source.maxGeometricDeviationBoundCm} cm`}
                  />
                )}
                {selectedDiag.source.residualDistanceCm !== undefined && (
                  <MetricRow
                    label="Residual"
                    value={`${selectedDiag.source.residualDistanceCm} cm`}
                  />
                )}
                {selectedDiag.source.workingPrecisionBits !== undefined && (
                  <MetricRow
                    label="Precision"
                    value={`${selectedDiag.source.workingPrecisionBits}-bit`}
                  />
                )}
                {selectedHiddenHost && (
                  <MetricRow
                    label="Layer State"
                    value={`Host ${selectedHiddenHost} contour hidden (D5 blocking override)`}
                  />
                )}
              </dl>

              {selectedDiag.isMapped && (
                <button
                  type="button"
                  data-testid="inspector-diag-locate-selected-btn"
                  onClick={() => locateDiagnosticOnCanvas(selectedDiag.diagnosticKey)}
                  className="w-full py-1 px-2 rounded-xs bg-neutral-900 hover:bg-neutral-800 text-white font-mono text-[10px] font-semibold cursor-pointer transition-colors"
                >
                  Locate on Canvas
                </button>
              )}
            </div>
          )}

          {/* Mapped / Unmapped / Stale-Invalid Lists */}
          {summary.total === 0 ? (
            <div
              data-testid="inspector-diag-clean"
              className="px-2.5 py-2 rounded-xs border border-emerald-200 bg-emerald-50/40 text-[10.5px] text-emerald-900"
            >
              Clean draft — zero spatial diagnostics reported on the active artifact.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMapped.length > 0 && (
                <div className="space-y-1" data-testid="inspector-diag-mapped-list">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    Mapped on Canvas ({filteredMapped.length})
                  </div>
                  <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5 [contain:layout_style_paint]">
                    {filteredMapped.map(item => (
                      <DiagnosticRowCard
                        key={item.diagnosticKey}
                        item={item}
                        isSelected={item.diagnosticKey === selectedDiagnosticKey}
                        hiddenHost={getHiddenHostLayerLabel(item, layerVisibility)}
                        onSelect={selectDiagnostic}
                        onLocate={locateDiagnosticOnCanvas}
                      />
                    ))}
                  </div>
                </div>
              )}

              {filteredUnmapped.length > 0 && (
                <div className="space-y-1" data-testid="inspector-diag-unmapped-list">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    Unmapped Global Diagnostics ({filteredUnmapped.length})
                  </div>
                  <p className="text-[9.5px] text-neutral-500">
                    Preserved without fabricated canvas pins.
                  </p>
                  <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5 [contain:layout_style_paint]">
                    {filteredUnmapped.map(item => (
                      <DiagnosticRowCard
                        key={item.diagnosticKey}
                        item={item}
                        isSelected={item.diagnosticKey === selectedDiagnosticKey}
                        hiddenHost={getHiddenHostLayerLabel(item, layerVisibility)}
                        onSelect={selectDiagnostic}
                        onLocate={locateDiagnosticOnCanvas}
                      />
                    ))}
                  </div>
                </div>
              )}

              {filteredStaleInvalid.length > 0 && (
                <div className="space-y-1" data-testid="inspector-diag-stale-list">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                    Stale / Invalid References ({filteredStaleInvalid.length})
                  </div>
                  <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5 [contain:layout_style_paint]">
                    {filteredStaleInvalid.map(item => (
                      <DiagnosticRowCard
                        key={item.diagnosticKey}
                        item={item}
                        isSelected={item.diagnosticKey === selectedDiagnosticKey}
                        hiddenHost={getHiddenHostLayerLabel(item, layerVisibility)}
                        onSelect={selectDiagnostic}
                        onLocate={locateDiagnosticOnCanvas}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }
  );

SpatialDiagnosticsInspectorSection.displayName = 'SpatialDiagnosticsInspectorSection';

/**
 * UX-2.3.1 / UX-2.3.2 / UX-2.3.3.1 — Consolidated Right Inspector Panel for Pattern Atelier.
 *
 * Mounted inside `ContextualInspector` when `activeEnvironment === 'pattern-atelier'`,
 * replacing the duplicated embedded `lg:col-span-4` column previously inside `PatternWorkspace.tsx`.
 */
export const PatternAtelierInspectorPanel: React.FC = () => {
  const {
    currentSpec,
    measurements,
    measurementProvenance,
    measurementApprovalState,
    workspaceBundle,
    bodiceDartStyle,
    setBodiceDartStyle,
    sleeveEaseStrategy,
    strictUncertaintyGate,
    setStrictUncertaintyGate,
    requireApprovedGovernance,
    setRequireApprovedGovernance
  } = useProjectWorkspace();

  const { selectedEntity, selectEntity, openDockTab, activeTool } = useViewportInteraction();
  const atelier = useOptionalPatternAtelierView();

  const {
    isCadSupported,
    pieces,
    sleeveDiagnostics: sleeveDiag,
    assemblyResult: authoritativeAssemblyResult,
    draftValidation: validationReport,
    gradedPatternSet
  } = workspaceBundle;

  const cadViewMode = atelier?.cadViewMode ?? 'pieces';
  const assemblyScenario = atelier?.assemblyScenario ?? 'active-draft';
  const selectedPrototypeId = atelier?.selectedPrototypeId ?? 'PROTO-BOD-2026-M-01';
  const enabledGradingSizes = atelier?.enabledGradingSizes ?? {
    XS: true,
    S: true,
    M: true,
    L: true,
    XL: true,
    XXL: true
  };

  const effectiveViewMode =
    (currentSpec.garmentCategory !== 'bodice' ||
      (cadViewMode === 'grading' && !gradedPatternSet)) &&
    cadViewMode !== 'pieces' &&
    cadViewMode !== 'simulation'
      ? 'pieces'
      : cadViewMode;

  const boardSelectedIds = atelier?.boardState.selectedPieceIds ?? [];
  const isMultiBoardSelection = boardSelectedIds.length >= 2;
  const primaryBoardSelectedId = boardSelectedIds.length === 1 ? boardSelectedIds[0] : null;

  const selectedPieceId =
    selectedEntity?.kind === 'seam'
      ? selectedEntity.pieceId
      : primaryBoardSelectedId ??
        (selectedEntity?.kind === 'pattern-piece' ? selectedEntity.pieceId : pieces[0]?.id ?? null);

  const selectedPiece = pieces.find(p => p.id === selectedPieceId) ?? pieces[0];
  const activeArtifact = atelier?.activeArtifact ?? null;
  const inspectionTargetArtifact = atelier?.inspectionTargetArtifact ?? activeArtifact;
  const proposalState = atelier?.proposalState ?? null;
  const isInspectingProposal = atelier?.isInspectingProposal ?? false;
  const compareOriginalGeometry = atelier?.compareOriginalGeometry ?? false;
  const hasAlignedActiveProposal = Boolean(
    proposalState?.hasEdits && proposalState.reconciliationStatus === 'aligned'
  );
  const inspectedEntity = atelier?.inspectedEntity ?? null;
  const measurementEvaluation = atelier?.measurementEvaluation ?? { kind: 'empty' as const };
  const selectedArtifactPiece =
    activeArtifact && selectedPiece
      ? activeArtifact.pieces.find(p => p.pieceId === selectedPiece.id) ?? null
      : null;
  const selectedPlacement =
    selectedPiece && atelier
      ? atelier.boardState.placementsByPieceId[selectedPiece.id] ?? null
      : null;

  const selectedGroup =
    selectedPlacement?.groupId && atelier
      ? atelier.boardState.groupsById[selectedPlacement.groupId] ?? null
      : null;

  const hasGroupedSelection = useMemo(() => {
    if (!atelier) return false;
    return boardSelectedIds.some(id => Boolean(atelier.boardState.placementsByPieceId[id]?.groupId));
  }, [atelier, boardSelectedIds]);

  const [draftBoardX, setDraftBoardX] = useState<string>('');
  const [draftBoardY, setDraftBoardY] = useState<string>('');

  useEffect(() => {
    if (selectedPlacement) {
      setDraftBoardX(selectedPlacement.offsetXCm.toFixed(2));
      setDraftBoardY(selectedPlacement.offsetYCm.toFixed(2));
    }
  }, [selectedPlacement?.pieceId, selectedPlacement?.offsetXCm, selectedPlacement?.offsetYCm]);

  const commitBoardCoordinate = (axis: 'x' | 'y', rawValue: string) => {
    if (!atelier || !selectedPlacement) return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setDraftBoardX(selectedPlacement.offsetXCm.toFixed(2));
      setDraftBoardY(selectedPlacement.offsetYCm.toFixed(2));
      return;
    }
    const nextX = axis === 'x' ? parsed : selectedPlacement.offsetXCm;
    const nextY = axis === 'y' ? parsed : selectedPlacement.offsetYCm;
    atelier.setPiecePositionCm(selectedPlacement.pieceId, nextX, nextY);
  };

  const { assemblyResult, assemblyError } = useMemo(() => {
    if (
      currentSpec.garmentCategory === 'bodice' &&
      pieces.length >= 2 &&
      assemblyScenario === 'incompatible-xs-flat'
    ) {
      try {
        const targetSleeve = draftSleeveBlock(STANDARD_SIZING_SYSTEM.sizes.XS, currentSpec, {
          strategy: 'flat'
        }).piece;
        return {
          assemblyResult: assembleBodiceSleeve({
            bodicePieces: pieces.slice(0, 2),
            sleevePiece: targetSleeve,
            designSpec: currentSpec,
            measurements,
            options: {
              strategy: sleeveEaseStrategy,
              strictUncertaintyGate,
              measurementProvenance,
              measurementApprovalState,
              requireApprovedGovernance
            }
          }),
          assemblyError: undefined
        };
      } catch (err) {
        return {
          assemblyResult: undefined,
          assemblyError: err instanceof Error ? err.message : String(err)
        };
      }
    }
    return { assemblyResult: authoritativeAssemblyResult, assemblyError: undefined };
  }, [
    currentSpec,
    pieces,
    assemblyScenario,
    measurements,
    sleeveEaseStrategy,
    strictUncertaintyGate,
    measurementProvenance,
    measurementApprovalState,
    requireApprovedGovernance,
    authoritativeAssemblyResult
  ]);

  const activePrototypeRecord = useMemo(
    () =>
      selectedPrototypeId === 'PROTO-BOD-2026-M-01' ||
      selectedPrototypeId === 'SYNTH-PROTO-BOD-M-CONFORMING'
        ? SYNTHETIC_TEST_PROTOTYPE_CONFORMING
        : SYNTHETIC_TEST_PROTOTYPE_DISCREPANT,
    [selectedPrototypeId]
  );

  const activePrototypeReport = useMemo(
    () => validatePhysicalFit(activePrototypeRecord),
    [activePrototypeRecord]
  );

  const workspaceFabric = useMemo(() => {
    const lookup = getEnhancedFabricById(currentSpec.fabric.id);
    return lookup.status === 'found' ? lookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;
  }, [currentSpec.fabric.id]);

  const workspaceFabricEase = useMemo(
    () =>
      calculateCompleteGarmentEase(measurements, currentSpec.easeProfile, workspaceFabric, {
        silhouette: currentSpec.silhouette,
        allowanceForShrinkage: true,
        userExplicitConsentToDefaultFabric: true,
        explicitEaseCm: currentSpec.explicitEaseCm
      }),
    [measurements, currentSpec.easeProfile, workspaceFabric, currentSpec.silhouette, currentSpec.explicitEaseCm]
  );

  const workspaceAdaptedSleeveEase = useMemo(
    () =>
      calculateFabricAdaptedSleeveCapEase(sleeveEaseStrategy, workspaceFabric, {
        userExplicitConsentToDefaultFabric: true
      }),
    [sleeveEaseStrategy, workspaceFabric]
  );

  if (!isCadSupported) {
    return (
      <section className="space-y-2.5" data-testid="inspector-atelier-unsupported">
        <h3 className="text-[11px] font-semibold text-neutral-500">Category Gate</h3>
        <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xs px-2.5 py-2 leading-relaxed">
          Deterministic CAD block unavailable for <strong>{currentSpec.garmentCategory}</strong>.
          Patroner fails closed without substituting another block.
        </p>
      </section>
    );
  }

  if (effectiveViewMode === 'assembly') {
    return (
      <div className="space-y-3" data-testid="inspector-atelier-assembly">
        <AssemblyInspectionPanel
          assemblyResult={assemblyResult}
          assemblyError={assemblyError}
          scenario={assemblyScenario}
          onChangeScenario={next => atelier?.setAssemblyScenario(next)}
          requireApprovedGovernance={requireApprovedGovernance}
          onToggleRequireApprovedGovernance={setRequireApprovedGovernance}
          strictUncertaintyGate={strictUncertaintyGate}
          onToggleStrictUncertaintyGate={setStrictUncertaintyGate}
          onNavigateToMeasurements={() => openDockTab('sizing-ease')}
        />
      </div>
    );
  }

  if (effectiveViewMode === 'grading' && gradedPatternSet) {
    return (
      <div className="space-y-4 text-xs" data-testid="inspector-atelier-grading">
        <section className="space-y-2.5">
          <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
            <div>
              <h3 className="text-xs font-semibold text-neutral-900">Cross-Size Grading Suite</h3>
              <p className="text-[11px] text-neutral-500">
                Base {gradedPatternSet.baseSize} · Direct regeneration · isProductionReady: false
              </p>
            </div>
            <span
              className={`font-mono text-[10px] font-semibold ${
                gradedPatternSet.isAllValid ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {gradedPatternSet.isAllValid ? '6/6 Valid' : 'Flagged'}
            </span>
          </div>

          <div className="space-y-1">
            {DEFAULT_SIZE_RANGE.map(sz => {
              const szRes = gradedPatternSet.sizeResults[sz];
              const isEnabled = enabledGradingSizes[sz];
              const totalEase = szRes?.assemblyResult?.ease.totalEaseCm;
              return (
                <button
                  key={sz}
                  type="button"
                  onClick={() => atelier?.toggleGradingSize(sz)}
                  className={`w-full px-2 py-1.5 rounded-xs border text-left flex items-center justify-between transition-colors cursor-pointer ${
                    isEnabled
                      ? 'bg-white border-neutral-300 text-neutral-900'
                      : 'bg-neutral-50 border-neutral-200 text-neutral-400'
                  }`}
                >
                  <span className="flex items-center gap-2 font-mono tabular-nums">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: SIZE_STROKE[sz] ?? '#18181b' }}
                    />
                    <span className="font-semibold">{sz}</span>
                    <span className="text-[10px] text-neutral-500">
                      Bust {szRes?.measurements.bust} cm
                      {totalEase !== undefined ? ` · ${formatSignedCm(totalEase)}` : ''}
                    </span>
                  </span>
                  <span
                    className={`font-mono text-[10px] font-semibold ${
                      szRes?.isValid ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {szRes?.isValid ? 'Valid' : 'Invalid'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="pt-3 border-t border-neutral-200 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold text-neutral-500">Continuity Checks</h4>
            <span
              className={`font-mono text-[10px] font-semibold ${
                gradedPatternSet.integrityReport.isOverallGradingValid
                  ? 'text-emerald-700'
                  : 'text-rose-700'
              }`}
            >
              {gradedPatternSet.integrityReport.isOverallGradingValid ? 'Passed' : 'Failed'}
            </span>
          </div>
          {gradedPatternSet.integrityReport.checks.slice(0, 6).map(chk => (
            <div
              key={chk.id}
              className="py-1.5 border-b border-neutral-100 last:border-b-0 space-y-0.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-neutral-800">{chk.name}</span>
                <span
                  className={`font-mono text-[10px] font-semibold ${
                    chk.status === 'pass' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {chk.status}
                </span>
              </div>
              <p className="text-[11px] text-neutral-600">{chk.message}</p>
            </div>
          ))}
        </section>
      </div>
    );
  }

  if (effectiveViewMode === 'fit') {
    return (
      <div className="space-y-4 text-xs" data-testid="inspector-atelier-fit">
        <section className="space-y-2">
          <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
            <div>
              <h3 className="text-xs font-semibold text-neutral-900">Physical Fit Evidence</h3>
              <p className="text-[11px] text-neutral-500">
                Synthetic benchmark · isProductionReady: false
              </p>
            </div>
            <span
              className={`font-mono text-[10px] font-semibold ${
                activePrototypeReport.overallFitStatus === 'conforming'
                  ? 'text-emerald-700'
                  : 'text-rose-700'
              }`}
            >
              {activePrototypeReport.passCount}/{activePrototypeReport.evaluatedPointsCount} Pass
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => atelier?.setSelectedPrototypeId('PROTO-BOD-2026-M-01')}
              className={`px-2 py-1.5 rounded-xs border text-[11px] font-medium cursor-pointer ${
                selectedPrototypeId === 'PROTO-BOD-2026-M-01'
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              Conforming Fixture
            </button>
            <button
              type="button"
              onClick={() => atelier?.setSelectedPrototypeId('PROTO-BOD-2026-M-DISCREPANT')}
              className={`px-2 py-1.5 rounded-xs border text-[11px] font-medium cursor-pointer ${
                selectedPrototypeId === 'PROTO-BOD-2026-M-DISCREPANT'
                  ? 'bg-rose-900 text-white border-rose-900'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              Discrepant Fixture
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-y-1.5 gap-x-2 pt-1 text-[11px] font-mono tabular-nums">
            <div>
              <dt className="text-neutral-500 font-sans">Max Delta</dt>
              <dd className="font-semibold text-neutral-900">
                {activePrototypeReport.maxAbsoluteDiscrepancyCm.toFixed(2)} cm
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 font-sans">Fabric Ease</dt>
              <dd className="font-semibold text-neutral-900">
                +{workspaceAdaptedSleeveEase.adaptedCapEaseCm.toFixed(2)} cm
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500 font-sans">Material</dt>
              <dd className="font-sans text-neutral-900 truncate">{workspaceFabric.name}</dd>
            </div>
            <div>
              <dt className="text-neutral-500 font-sans">Waist Pre-Shrink</dt>
              <dd className="font-semibold text-neutral-900">
                {workspaceFabricEase.waist.isCalculationAvailable
                  ? `${workspaceFabricEase.waist.preShrinkCuttingDimensionCm.toFixed(1)} cm`
                  : 'N/A'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="pt-3 border-t border-neutral-200 space-y-1.5">
          <h4 className="text-[11px] font-semibold text-neutral-500">Measurement Checkpoints</h4>
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {activePrototypeReport.measurements.map(pt => (
              <div
                key={pt.pointId}
                className="flex items-center justify-between py-1 border-b border-neutral-100 last:border-b-0 text-[11px]"
              >
                <span className="text-neutral-800 truncate pr-2">{pt.label}</span>
                <span
                  className={`font-mono tabular-nums font-semibold shrink-0 ${
                    pt.status === 'pass'
                      ? 'text-emerald-700'
                      : pt.status === 'warning'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                  }`}
                >
                  {pt.deltaCm > 0 ? '+' : ''}
                  {pt.deltaCm.toFixed(2)} cm
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  // Default: Pieces Mode — Contour Proposal Editing, Advisory Measurement, Entity Inspection, Board Placement, Piece Summary & Validation Engine
  return (
    <div className="space-y-4 text-xs" data-testid="inspector-atelier-pieces">
      {/* UX-2.3.3.4: Contour Proposal Inspector on top when Edit Contour (or non-WP-A tool) is active */}
      {atelier &&
        activeTool !== 'seam-walk' &&
        activeTool !== 'construction-draw' &&
        activeTool !== 'notch-drill' &&
        activeTool !== 'dart-author' &&
        activeTool !== 'allowance-rule' && (
          <PatternContourEditInspectorSection
            activeTool={activeTool}
            selectedPieceId={selectedPiece?.id ?? null}
          />
        )}

      {/* WP-A1..A5 Integrated Pattern Engineering Inspector Sections */}
      {atelier && activeArtifact && atelier.wpAState && (() => {
        const targetArt = inspectionTargetArtifact ?? activeArtifact;
        const activePieceModel =
          targetArt.pieces.find(p => p.pieceId === (selectedPiece?.id ?? '')) ??
          targetArt.pieces[0] ??
          null;
        const activePieceEng = activePieceModel
          ? atelier.wpAState.pieceEngineering[activePieceModel.pieceId]
          : undefined;

        return (
          <>
            {activeTool === 'seam-walk' && (
              <section className="pb-3.5 border-b border-indigo-200/80">
                <PatternSeamInspectorSection
                  artifact={targetArt}
                  seamPairs={Object.values(atelier.wpAState.seamCorrespondences)}
                  activePairId={atelier.activeSeamPairId}
                  onSelectPairId={(id) => atelier.setActiveSeamPairId(id)}
                  evaluation={atelier.activeSeamWalkEvaluation}
                  walkFraction={atelier.seamWalkFraction}
                  onChangeWalkFraction={atelier.setSeamWalkFraction}
                  showGhostPieceB={atelier.showSeamWalkGhostB}
                  onToggleGhostPieceB={atelier.setShowSeamWalkGhostB}
                  onUpsertSeamPair={(pair) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::seam-pair::${seq}`,
                      sequence: seq,
                      domain: 'seam-correspondence',
                      kind: 'upsert-seam-pair',
                      label: `Seam Pair: ${pair.label}`,
                      pieceId: pair.sideA.pieceId,
                      dependsOnIds: [
                        ...pair.sideA.segmentIds.map(s => `seg:${s}`),
                        ...pair.sideB.segmentIds.map(s => `seg:${s}`)
                      ],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'seam-walk',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { pair }
                    });
                  }}
                  onRemoveSeamPair={(pairId) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::rm-seam-pair::${seq}`,
                      sequence: seq,
                      domain: 'seam-correspondence',
                      kind: 'remove-seam-pair',
                      label: `Remove Seam Pair`,
                      pieceId: activePieceModel?.pieceId ?? '',
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'seam-walk',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { pairId }
                    });
                  }}
                  onTrueSeamEndpoint={(args) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::true-seam::${seq}`,
                      sequence: seq,
                      domain: 'seam-trueing',
                      kind: 'true-seam-endpoint',
                      label: `True Seam (${args.endpoint}, ${args.targetJoinAngleDeg}°)`,
                      pieceId: activePieceModel?.pieceId ?? '',
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'seam-walk',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: args
                    });
                  }}
                />
              </section>
            )}

            {(activeTool === 'construction-draw' || activeTool === 'notch-drill') && (
              <section className="pb-3.5 border-b border-sky-200/80">
                <PatternConstructionInspectorSection
                  mode={activeTool}
                  activePiece={activePieceModel}
                  drawSubMode={atelier.constructionDrawSubMode}
                  onChangeDrawSubMode={atelier.setConstructionDrawSubMode}
                  notchDrillSubMode={atelier.notchDrillSubMode}
                  onChangeNotchDrillSubMode={atelier.setNotchDrillSubMode}
                  activeNotchType={atelier.activeNotchType}
                  onChangeActiveNotchType={atelier.setActiveNotchType}
                  constructions={Object.values(atelier.wpAState.constructions)}
                  constraints={Object.values(atelier.wpAState.constraints)}
                  constraintEvaluations={atelier.wpAState.constraintEvaluations}
                  proposedNotches={activePieceEng?.proposedNotches ?? []}
                  proposedDrills={activePieceEng?.proposedDrillHoles ?? []}
                  onUpsertConstruction={(entity) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::const::${seq}`,
                      sequence: seq,
                      domain: 'construction',
                      kind: 'upsert-construction',
                      label: `Construction: ${entity.label}`,
                      pieceId: entity.pieceId ?? activePieceModel?.pieceId ?? '',
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'construction-draw',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { entity }
                    });
                  }}
                  onRemoveConstruction={(entityId) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::rm-const::${seq}`,
                      sequence: seq,
                      domain: 'construction',
                      kind: 'remove-construction',
                      label: `Remove Construction`,
                      pieceId: activePieceModel?.pieceId ?? '',
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'construction-draw',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { entityId }
                    });
                  }}
                  onUpsertConstraint={(constraint) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::constraint::${seq}`,
                      sequence: seq,
                      domain: 'constraint',
                      kind: 'upsert-constraint',
                      label: `Constraint: ${constraint.kind}`,
                      pieceId: constraint.pieceId,
                      dependsOnIds: [...constraint.entityRefs],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'construction-draw',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { constraint }
                    });
                  }}
                  onRemoveConstraint={(constraintId) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::rm-constraint::${seq}`,
                      sequence: seq,
                      domain: 'constraint',
                      kind: 'remove-constraint',
                      label: `Remove Constraint`,
                      pieceId: activePieceModel?.pieceId ?? '',
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'construction-draw',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { constraintId }
                    });
                  }}
                  onUpsertNotch={(args) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::notch::${seq}`,
                      sequence: seq,
                      domain: 'notch-drill',
                      kind: 'upsert-notch',
                      label: `Notch ${args.label ?? args.notchId}`,
                      pieceId: args.pieceId,
                      dependsOnIds: [`seg:${args.segmentId}`],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'notch-drill',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: {
                        notchId: args.notchId,
                        segmentId: args.segmentId,
                        targetArcLengthCm: args.targetArcLengthCm,
                        notchType: args.notchType,
                        label: args.label
                      }
                    });
                  }}
                  onRemoveNotch={(pieceId, notchId) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::rm-notch::${seq}`,
                      sequence: seq,
                      domain: 'notch-drill',
                      kind: 'remove-notch',
                      label: `Remove Notch`,
                      pieceId,
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'notch-drill',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { notchId }
                    });
                  }}
                  onUpsertDrill={(args) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::drill::${seq}`,
                      sequence: seq,
                      domain: 'notch-drill',
                      kind: 'upsert-drill',
                      label: `Drill ${args.label ?? args.drillId}`,
                      pieceId: args.pieceId,
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'notch-drill',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: {
                        drillId: args.drillId,
                        positionCm: args.positionCm,
                        radiusCm: args.radiusCm,
                        label: args.label
                      }
                    });
                  }}
                  onRemoveDrill={(pieceId, drillId) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::rm-drill::${seq}`,
                      sequence: seq,
                      domain: 'notch-drill',
                      kind: 'remove-drill',
                      label: `Remove Drill`,
                      pieceId,
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'notch-drill',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { drillId }
                    });
                  }}
                />
              </section>
            )}

            {activeTool === 'dart-author' && (
              <section className="pb-3.5 border-b border-rose-200/80">
                <PatternDartInspectorSection
                  activePiece={activePieceModel}
                  isBodiceGarment={currentSpec.garmentCategory === 'bodice'}
                  currentBodiceDartStyle={bodiceDartStyle}
                  onChangeBodiceDartStyle={setBodiceDartStyle}
                  proposedDarts={activePieceEng?.proposedDarts ?? []}
                  selectedDartId={atelier.selectedDartId}
                  onSelectDartId={atelier.setSelectedDartId}
                  conservationReport={activePieceEng?.dartConservation ?? null}
                  onCreateDart={(args) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::create-dart::${seq}`,
                      sequence: seq,
                      domain: 'dart',
                      kind: 'create-dart',
                      label: `Create ${args.label}`,
                      pieceId: args.pieceId,
                      dependsOnIds: [`seg:${args.hostSegmentId}`],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'dart-author',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: {
                        dartId: args.dartId,
                        label: args.label,
                        hostSegmentId: args.hostSegmentId,
                        centerParameterT: args.centerParameterT,
                        intakeWidthCm: args.intakeWidthCm,
                        pivotApexCm: args.pivotApexCm,
                        backoffCm: args.backoffCm,
                        foldDirection: args.foldDirection
                      }
                    });
                  }}
                  onEditDart={(args) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::edit-dart::${seq}`,
                      sequence: seq,
                      domain: 'dart',
                      kind: 'edit-dart',
                      label: `Edit Dart ${args.dartId}`,
                      pieceId: args.pieceId,
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'dart-author',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: {
                        dartId: args.dartId,
                        intakeWidthCm: args.intakeWidthCm,
                        backoffCm: args.backoffCm,
                        foldDirection: args.foldDirection
                      }
                    });
                  }}
                  onTransferDart={(args) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::xfer-dart::${seq}`,
                      sequence: seq,
                      domain: 'dart',
                      kind: 'rotate-transfer-dart',
                      label: `Transfer Dart (${Math.round(args.transferRatio * 100)}%)`,
                      pieceId: args.pieceId,
                      dependsOnIds: [`seg:${args.targetHostSegmentId}`],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'dart-author',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: {
                        sourceDartId: args.sourceDartId,
                        newDartId: args.newDartId,
                        targetHostSegmentId: args.targetHostSegmentId,
                        targetParameterT: args.targetParameterT,
                        transferRatio: args.transferRatio,
                        backoffCm: args.backoffCm,
                        foldDirection: args.foldDirection
                      }
                    });
                  }}
                  onCloseOrOpenDart={(pieceId, dartId, closed) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::toggle-dart::${seq}`,
                      sequence: seq,
                      domain: 'dart',
                      kind: 'close-or-open-dart',
                      label: closed ? `Close Dart` : `Open Dart`,
                      pieceId,
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'dart-author',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { dartId, closed }
                    });
                  }}
                />
              </section>
            )}

            {activeTool === 'allowance-rule' && (
              <section className="pb-3.5 border-b border-amber-200/80">
                <PatternAllowanceInspectorSection
                  activePiece={activePieceModel}
                  selectedSegmentId={atelier.selectedAllowanceSegmentId}
                  onSelectSegmentId={atelier.setSelectedAllowanceSegmentId}
                  proposal={activePieceEng?.allowanceRules ?? null}
                  evaluation={activePieceEng?.allowanceEvaluation ?? null}
                  onSetPieceDefaultAllowance={(pieceId, defaultAllowanceCm) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::default-sa::${seq}`,
                      sequence: seq,
                      domain: 'allowance-rule',
                      kind: 'set-piece-default-allowance',
                      label: `Default SA ${defaultAllowanceCm.toFixed(2)} cm`,
                      pieceId,
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'allowance-rule',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { defaultAllowanceCm }
                    });
                  }}
                  onSetSegmentAllowanceRule={(pieceId, rule) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::seg-sa::${seq}`,
                      sequence: seq,
                      domain: 'allowance-rule',
                      kind: 'set-segment-allowance-rule',
                      label: `Rule ${rule.segmentId} (${rule.distanceCm.toFixed(1)} cm)`,
                      pieceId,
                      dependsOnIds: [`seg:${rule.segmentId}`],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'allowance-rule',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { rule }
                    });
                  }}
                  onSetVertexCornerRule={(pieceId, override) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::corner-sa::${seq}`,
                      sequence: seq,
                      domain: 'allowance-rule',
                      kind: 'set-vertex-corner-rule',
                      label: `Corner ${override.joinStyle}`,
                      pieceId,
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'allowance-rule',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: { override }
                    });
                  }}
                  onSetProductionAnnotation={(pieceId, patch) => {
                    const seq = atelier.nextParametricOpSequence();
                    atelier.dispatchParametricOp({
                      opId: `op::prod-note::${seq}`,
                      sequence: seq,
                      domain: 'production-annotation',
                      kind: 'set-production-annotation',
                      label: `Update Production Notes`,
                      pieceId,
                      dependsOnIds: [],
                      enabled: true,
                      provenance: {
                        createdSequence: seq,
                        sourceTool: 'allowance-rule',
                        authorityTier: WP_A_AUTHORITY_TIER
                      },
                      params: patch
                    });
                  }}
                />
              </section>
            )}

            {(isProposalAuthoringTool(activeTool) || atelier.wpAState.operations.length > 0) &&
              atelier.proposalHistory && (
                <section className="pb-3.5 border-b border-neutral-200">
                  <PatternOperationHistorySection
                    sourceArtifact={activeArtifact}
                    proposalHistory={atelier.proposalHistory}
                    wpAState={atelier.wpAState}
                    onUpdateParametricOp={atelier.updateParametricOp}
                    onToggleParametricOp={atelier.toggleParametricOp}
                    onRemoveParametricOp={atelier.removeParametricOp}
                    onRebindInvalidatedOp={atelier.rebindInvalidatedOp}
                    onUndoProposal={atelier.undoProposal}
                    onRedoProposal={atelier.redoProposal}
                    canUndoProposal={atelier.canUndoProposal}
                    canRedoProposal={atelier.canRedoProposal}
                  />
                </section>
              )}
          </>
        );
      })()}

      {/* UX-2.3.3.4: Contour Proposal Summary below active WP-A tool controls */}
      {atelier &&
        (activeTool === 'seam-walk' ||
          activeTool === 'construction-draw' ||
          activeTool === 'notch-drill' ||
          activeTool === 'dart-author' ||
          activeTool === 'allowance-rule') && (
          <PatternContourEditInspectorSection
            activeTool={activeTool}
            selectedPieceId={selectedPiece?.id ?? null}
          />
        )}

      {/* UX-2.3.3.2: Advisory Precision Measurement Section */}
      {atelier && activeArtifact && measurementEvaluation.kind !== 'empty' && (() => {
        const targetArtifact = inspectionTargetArtifact ?? activeArtifact;
        const frameLabel =
          targetArtifact.coordinateFrame.yAxisDirection === 'cartesian-y-up'
            ? 'Cartesian Y-Up'
            : 'SVG Y-Down';

        const headerTitle =
          measurementEvaluation.kind === 'pair-distance'
            ? 'Point-to-Point Distance'
            : measurementEvaluation.kind === 'straight-edge'
              ? 'Straight Edge Measurement'
              : measurementEvaluation.kind === 'vertex-angle'
                ? 'Vertex Angle Measurement'
                : measurementEvaluation.kind === 'cubic-bezier'
                  ? 'Cubic Bézier Analysis'
                  : 'Select Second Anchor (B)';

        const activeClassification: MeasurementClassification =
          measurementEvaluation.kind === 'pair-distance'
            ? measurementEvaluation.result.classification
            : measurementEvaluation.kind === 'straight-edge'
              ? measurementEvaluation.result.classification
              : measurementEvaluation.kind === 'vertex-angle'
                ? measurementEvaluation.result.classification
                : measurementEvaluation.kind === 'cubic-bezier'
                  ? 'numerical-approximation'
                  : 'algebraic-float64';

        return (
          <section
            className="pb-3.5 border-b border-amber-200/90 space-y-2.5 bg-amber-50/40 -mx-3.5 px-3.5 pt-2.5 -mt-2.5"
            data-testid="inspector-cad-measurement"
            data-measurement-kind={measurementEvaluation.kind}
          >
            {/* Header & Actions */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-amber-950 font-semibold">
                  <Ruler className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span className="truncate" data-testid="inspector-measurement-title">
                    {headerTitle}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="text-[9.5px] font-mono font-semibold text-amber-900 bg-amber-100 border border-amber-200/80 px-1.5 py-0.5 rounded-xs">
                    {formatClassificationBadge(activeClassification)}
                  </span>
                  <span className="text-[9.5px] font-mono text-neutral-600">{frameLabel}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {measurementEvaluation.kind === 'pair-distance' && (
                  <button
                    type="button"
                    onClick={atelier.swapMeasurementAnchors}
                    aria-label="Swap Anchor A and Anchor B"
                    data-testid="inspector-swap-measurement-btn"
                    title="Swap Anchor A ↔ B"
                    className="p-1 rounded-xs text-amber-900 hover:bg-amber-100 border border-amber-200/80 bg-white cursor-pointer"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={atelier.clearMeasurementSession}
                  aria-label="Clear measurement"
                  data-testid="inspector-clear-measurement-btn"
                  title="Clear measurement (Esc)"
                  className="p-1 rounded-xs text-amber-900 hover:bg-amber-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* UX-2.3.3.4 (D3): Geometry Source Disclosure & Original Comparison Toggle */}
            {hasAlignedActiveProposal && (
              <div
                data-testid="inspector-d3-measurement-source-banner"
                className={`p-1.5 rounded-xs border flex flex-wrap items-center justify-between gap-1.5 text-[10px] leading-snug ${
                  isInspectingProposal
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-950'
                    : 'bg-neutral-100 border-neutral-300 text-neutral-800'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold">
                    {isInspectingProposal
                      ? 'Measuring Proposed Sew Contour'
                      : 'Measuring Original Source Artifact'}
                  </div>
                  <div className="font-mono text-[9px] opacity-90">
                    {isInspectingProposal
                      ? 'UNVERIFIED_VISUAL_PROPOSAL · cut contour read-only'
                      : 'Original comparison mode · proposal preserved'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={atelier.toggleCompareOriginalGeometry}
                  aria-pressed={compareOriginalGeometry}
                  data-testid="inspector-measure-compare-original-toggle"
                  className="px-1.5 py-0.5 rounded-xs border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-900 font-mono text-[9.5px] font-semibold shrink-0 cursor-pointer"
                >
                  {compareOriginalGeometry ? 'Use Proposal' : 'Compare Original'}
                </button>
              </div>
            )}

            {/* Mandatory Non-Certified Advisory Disclosure */}
            <div
              data-testid="inspector-measurement-disclosure"
              className="p-1.5 rounded-xs bg-amber-100/75 border border-amber-300/90 text-amber-950 space-y-0.5 leading-snug"
            >
              <div className="text-[10px] font-semibold">
                {ADVISORY_MEASUREMENT_DISCLOSURE}
              </div>
              <div className="font-mono text-[9.5px] text-amber-900">
                isCertified: false · {targetArtifact.authorityTier} · isProductionReady:{' '}
                {String(targetArtifact.isProductionReady)}
              </div>
            </div>

            {/* Card 1: Awaiting Second Anchor */}
            {measurementEvaluation.kind === 'awaiting-second-anchor' && (
              <div data-testid="inspector-measure-pending" className="space-y-2">
                <div className="bg-white border border-amber-200/80 rounded-xs p-2 space-y-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[10px] font-semibold text-amber-900">
                      Anchor A Locked
                    </span>
                    <span className="text-[9.5px] font-mono text-neutral-500 truncate">
                      {measurementEvaluation.anchorA.pieceCode}
                    </span>
                  </div>
                  <code className="block font-mono text-[9.5px] text-neutral-800 break-all leading-snug">
                    {measurementEvaluation.anchorA.presentationRef}
                  </code>
                  <dl className="space-y-0.5 pt-1 border-t border-neutral-100">
                    <MetricRow
                      label="Local (cm)"
                      value={`(${measurementEvaluation.anchorA.localPointCm.x.toFixed(3)}, ${measurementEvaluation.anchorA.localPointCm.y.toFixed(3)})`}
                    />
                    <MetricRow
                      label="Board (cm)"
                      value={`(${measurementEvaluation.anchorA.boardPointCm.x.toFixed(3)}, ${measurementEvaluation.anchorA.boardPointCm.y.toFixed(3)})`}
                    />
                  </dl>
                  <p className="text-[10px] text-neutral-600 pt-1 leading-snug">
                    Click a second entity on the canvas to complete pair-distance measurement
                    {measurementEvaluation.anchorA.entityKind === 'vertex'
                      ? ', or click the same vertex again to keep its vertex angle.'
                      : '.'}
                  </p>
                </div>

                {measurementEvaluation.previewVertexAngle && (
                  <>
                    <VertexAngleDetailsBlock
                      result={measurementEvaluation.previewVertexAngle}
                      compact
                    />
                    <button
                      type="button"
                      onClick={atelier.lockPendingVertexAngle}
                      data-testid="inspector-lock-vertex-angle-btn"
                      className="w-full h-7 px-2 rounded-xs border border-amber-700 bg-amber-700 hover:bg-amber-800 text-white text-[11px] font-medium cursor-pointer"
                    >
                      Keep Vertex Angle Measurement
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Card 2: Point-to-Point Pair Distance */}
            {measurementEvaluation.kind === 'pair-distance' && (
              <div data-testid="inspector-measure-pair" className="space-y-2">
                <div className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1.5">
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="font-semibold text-amber-900">Anchor A</span>
                      <span className="font-mono text-neutral-500">
                        {measurementEvaluation.result.pieceACode}
                      </span>
                    </div>
                    <code
                      data-testid="inspector-measure-anchor-a-ref"
                      className="block font-mono text-[9.5px] text-neutral-800 break-all leading-snug"
                    >
                      {measurementEvaluation.result.anchorARef}
                    </code>
                  </div>
                  <div className="space-y-0.5 pt-1 border-t border-neutral-100">
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="font-semibold text-amber-900">Anchor B</span>
                      <span className="font-mono text-neutral-500">
                        {measurementEvaluation.result.pieceBCode}
                      </span>
                    </div>
                    <code
                      data-testid="inspector-measure-anchor-b-ref"
                      className="block font-mono text-[9.5px] text-neutral-800 break-all leading-snug"
                    >
                      {measurementEvaluation.result.anchorBRef}
                    </code>
                  </div>
                </div>

                <SpaceDistanceBlock
                  title="Same-Piece Local Space"
                  subtitle="Source cm"
                  metrics={measurementEvaluation.result.local}
                  unavailableReason={measurementEvaluation.result.localUnavailableReason}
                  testId="inspector-measure-pair-local"
                />

                <SpaceDistanceBlock
                  title="CAD Board Table Space"
                  subtitle="Board cm"
                  metrics={measurementEvaluation.result.board}
                  testId="inspector-measure-pair-board"
                />
              </div>
            )}

            {/* Card 3: Straight Edge */}
            {measurementEvaluation.kind === 'straight-edge' && (
              <div data-testid="inspector-measure-edge" className="space-y-2">
                <div className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-[10px]">
                    <span className="font-semibold text-neutral-700">Segment</span>
                    <span className="font-mono text-neutral-900 truncate">
                      {measurementEvaluation.result.pieceCode} · {measurementEvaluation.result.contour}
                    </span>
                  </div>
                  <code className="block font-mono text-[9.5px] text-neutral-700 break-all leading-snug">
                    {measurementEvaluation.entity.presentationRef}
                  </code>
                  <dl className="space-y-0.5 pt-1 border-t border-neutral-100">
                    <MetricRow
                      label="Edge Length"
                      value={
                        <span className="font-semibold text-amber-900">
                          {formatMetricCm(measurementEvaluation.result.lengthCm, 4)}
                        </span>
                      }
                      testId="inspector-measure-edge-length"
                    />
                    <MetricRow
                      label="ΔX"
                      value={formatSignedMetricCm(measurementEvaluation.result.dxCm, 4)}
                    />
                    <MetricRow
                      label="ΔY"
                      value={formatSignedMetricCm(measurementEvaluation.result.dyCm, 4)}
                    />
                    <MetricRow label="Role" value={measurementEvaluation.result.segmentRole} />
                    {measurementEvaluation.result.angles ? (
                      <>
                        <MetricRow
                          label="Frame Angle"
                          value={formatDeg(measurementEvaluation.result.angles.frameAngleDeg, 2)}
                        />
                        <MetricRow
                          label="Visual Incl."
                          value={formatDeg(
                            measurementEvaluation.result.angles.visualInclinationDeg,
                            2
                          )}
                        />
                        <MetricRow
                          label="Bearing (0° N)"
                          value={formatDeg(
                            measurementEvaluation.result.angles.compassBearingDeg,
                            2
                          )}
                        />
                        <MetricRow
                          label="Line Orient."
                          value={formatDeg(
                            measurementEvaluation.result.angles.undirectedOrientationDeg,
                            2
                          )}
                        />
                      </>
                    ) : (
                      <p className="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xs p-1.5 mt-1 leading-snug">
                        {measurementEvaluation.result.indeterminateReason ??
                          'Zero-length edge — angle indeterminate.'}
                      </p>
                    )}
                  </dl>
                </div>
              </div>
            )}

            {/* Card 4: Vertex Angle */}
            {measurementEvaluation.kind === 'vertex-angle' && (
              <div data-testid="inspector-measure-vertex" className="space-y-2">
                <div className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-[10px]">
                    <span className="font-semibold text-neutral-700">Vertex</span>
                    <span className="font-mono text-neutral-900">
                      {measurementEvaluation.result.pieceCode} · {measurementEvaluation.result.contour}
                    </span>
                  </div>
                  <code className="block font-mono text-[9.5px] text-neutral-700 break-all leading-snug">
                    {measurementEvaluation.result.vertexRef}
                  </code>
                </div>
                <VertexAngleDetailsBlock result={measurementEvaluation.result} />
              </div>
            )}

            {/* Card 5: Cubic Bézier Differential & Numerical Arc-Length Approximation */}
            {measurementEvaluation.kind === 'cubic-bezier' && (() => {
              const { differential, fullArcLength, partialArcLength } = measurementEvaluation.result;
              const radiusText =
                differential.radiusState === 'finite'
                  ? formatMetricCm(differential.radiusOfCurvatureCm, 3)
                  : differential.radiusState === 'infinite'
                    ? 'Infinite (flat/inflect)'
                    : 'Undefined';

              return (
                <div data-testid="inspector-measure-cubic" className="space-y-2">
                  {/* Differential Properties at t */}
                  <div className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-[10px]">
                      <span className="font-semibold text-neutral-700">
                        Differential at t = {differential.parameterT.toFixed(4)}
                      </span>
                      <span className="font-mono text-neutral-500">
                        {differential.pieceCode} · {differential.contour}
                      </span>
                    </div>
                    <code className="block font-mono text-[9.5px] text-neutral-700 break-all leading-snug">
                      {measurementEvaluation.entity.presentationRef}
                    </code>
                    <dl className="space-y-0.5 pt-1 border-t border-neutral-100">
                      <MetricRow
                        label="Point (Local)"
                        value={
                          differential.pointLocalCm
                            ? `(${differential.pointLocalCm.x.toFixed(3)}, ${differential.pointLocalCm.y.toFixed(3)})`
                            : '—'
                        }
                      />
                      <MetricRow
                        label="Speed |B'(t)|"
                        value={
                          differential.speedCmPerUnitT !== null
                            ? `${differential.speedCmPerUnitT.toFixed(4)} cm/t`
                            : '—'
                        }
                      />
                      <MetricRow
                        label="Unit Tangent"
                        value={
                          differential.unitTangent
                            ? `(${differential.unitTangent.x.toFixed(3)}, ${differential.unitTangent.y.toFixed(3)})`
                            : 'Undefined'
                        }
                      />
                      {differential.tangentAngles && (
                        <MetricRow
                          label="Tangent Bearing"
                          value={formatDeg(differential.tangentAngles.compassBearingDeg, 2)}
                        />
                      )}
                      <MetricRow
                        label="Signed κ (Frame)"
                        value={
                          differential.signedCurvatureInvCm !== null
                            ? `${differential.signedCurvatureInvCm.toFixed(5)} cm⁻¹`
                            : 'Undefined'
                        }
                        testId="inspector-cubic-kappa-frame"
                      />
                      <MetricRow
                        label="Signed κ (Visual)"
                        value={
                          differential.visualSignedCurvatureInvCm !== null
                            ? `${differential.visualSignedCurvatureInvCm.toFixed(5)} cm⁻¹`
                            : 'Undefined'
                        }
                      />
                      <MetricRow
                        label="Radius R = 1/|κ|"
                        value={radiusText}
                        testId="inspector-cubic-radius"
                      />
                    </dl>
                    {differential.warning && (
                      <div className="mt-1 p-1.5 rounded-xs bg-amber-50 border border-amber-200 text-[10px] text-amber-900 leading-snug">
                        {differential.warning}
                      </div>
                    )}
                  </div>

                  {/* Arc-Length Approximation (Explicitly Numerical / Uncertified) */}
                  <div data-testid="inspector-measure-arc-length" className="space-y-1.5">
                    <div className="flex items-center justify-between px-0.5">
                      <span className="text-[10px] font-semibold text-amber-950">
                        Arc Length · Numerical Approx. (Uncertified)
                      </span>
                    </div>
                    <ArcLengthSubBlock
                      title="Full Segment [0, 1]"
                      result={fullArcLength}
                      testId="inspector-cubic-arc-full"
                    />
                    <ArcLengthSubBlock
                      title={`Partial [0, ${differential.parameterT.toFixed(4)}]`}
                      result={partialArcLength}
                      testId="inspector-cubic-arc-partial"
                    />
                  </div>
                </div>
              );
            })()}
          </section>
        );
      })()}

      {/* Prompt when in Measure Geometry mode with no active measurement yet */}
      {atelier &&
        activeArtifact &&
        measurementEvaluation.kind === 'empty' &&
        activeTool === 'measure-preview' && (
          <section
            data-testid="inspector-cad-measurement-prompt"
            className="pb-3 border-b border-amber-200/80 space-y-1.5"
          >
            <div className="flex items-center gap-1.5 text-amber-950 font-semibold text-[11px]">
              <Ruler className="w-3.5 h-3.5 text-amber-700" />
              <span>Measure Geometry (Advisory)</span>
            </div>
            <p className="text-[10px] font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-xs px-2 py-1">
              {ADVISORY_MEASUREMENT_DISCLOSURE}
            </p>
            {hasAlignedActiveProposal && (
              <div
                data-testid="inspector-d3-measurement-prompt-source"
                className="p-1.5 rounded-xs border border-indigo-200 bg-indigo-50/80 text-indigo-950 flex flex-wrap items-center justify-between gap-1.5 text-[10px]"
              >
                <span>
                  Target:{' '}
                  <strong>
                    {isInspectingProposal
                      ? 'Proposed Sew (UNVERIFIED_VISUAL_PROPOSAL)'
                      : 'Original Artifact'}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={atelier.toggleCompareOriginalGeometry}
                  aria-pressed={compareOriginalGeometry}
                  data-testid="inspector-measure-prompt-compare-toggle"
                  className="px-1.5 py-0.5 rounded-xs border border-indigo-300 bg-white text-indigo-900 font-mono text-[9.5px] font-semibold shrink-0 cursor-pointer"
                >
                  {compareOriginalGeometry ? 'Use Proposal' : 'Compare Original'}
                </button>
              </div>
            )}
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              Click any straight edge or cubic curve for instant length, tangent &amp; curvature,
              click two entities for local/board distance, or double-click a vertex (or switch to
              Feature mode) for included &amp; interior angles.
            </p>
          </section>
        )}

      {/* UX-2.3.3.1: Read-Only Geometric Entity Inspection Card */}
      {atelier && inspectedEntity && activeArtifact && (
        <section
          className="pb-3.5 border-b border-teal-200/90 space-y-2.5 bg-teal-50/35 -mx-3.5 px-3.5 pt-2.5 -mt-2.5"
          data-testid="inspector-cad-entity"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-teal-900 font-semibold">
                <Crosshair className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <span className="truncate" data-testid="inspector-entity-type">
                  {getEntityKindDisplayLabel(inspectedEntity)}
                </span>
              </div>
              <p className="text-[10px] text-teal-800/80 mt-0.5">
                Read-only entity inspection · Zero source mutation
              </p>
            </div>
            <button
              type="button"
              onClick={atelier.clearInspectedEntity}
              aria-label="Clear inspected entity"
              data-testid="inspector-clear-entity-btn"
              className="p-1 rounded-xs text-teal-800 hover:bg-teal-100 cursor-pointer shrink-0"
              title="Clear inspected entity (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* UX-2.3.3.4 (D3): Geometry Source Disclosure & Original Comparison Toggle */}
          {hasAlignedActiveProposal && (
            <div
              data-testid="inspector-d3-entity-source-banner"
              className={`p-1.5 rounded-xs border flex flex-wrap items-center justify-between gap-1.5 text-[10px] leading-snug ${
                isInspectingProposal
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-950'
                  : 'bg-neutral-100 border-neutral-300 text-neutral-800'
              }`}
            >
              <div className="min-w-0">
                <div className="font-semibold">
                  {isInspectingProposal
                    ? 'Inspecting Proposed Sew Contour'
                    : 'Inspecting Original Source Artifact'}
                </div>
                <div className="font-mono text-[9px] opacity-90">
                  {isInspectingProposal
                    ? 'UNVERIFIED_VISUAL_PROPOSAL · isCertified: false'
                    : 'Original comparison mode · proposal preserved'}
                </div>
              </div>
              <button
                type="button"
                onClick={atelier.toggleCompareOriginalGeometry}
                aria-pressed={compareOriginalGeometry}
                data-testid="inspector-entity-compare-original-toggle"
                className="px-1.5 py-0.5 rounded-xs border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-900 font-mono text-[9.5px] font-semibold shrink-0 cursor-pointer"
              >
                {compareOriginalGeometry ? 'Use Proposal' : 'Compare Original'}
              </button>
            </div>
          )}

          {/* Presentation Reference (Explicitly Non-Authoritative) */}
          <div className="space-y-1 bg-white border border-teal-200/80 rounded-xs p-2">
            <span className="text-[10px] font-medium text-neutral-500 block">
              Presentation Reference (Non-Authoritative)
            </span>
            <code
              data-testid="inspector-entity-ref"
              className="block font-mono text-[10px] text-neutral-900 break-all leading-snug"
            >
              {inspectedEntity.presentationRef}
            </code>
            <p className="text-[10px] text-amber-800 leading-snug">
              Presentation address only — NOT an authoritative engineering vertex ID.
            </p>
          </div>

          {/* Parent Piece & Topology Identity */}
          <dl className="space-y-1.5 text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-neutral-500 shrink-0">Parent Piece</dt>
              <dd
                data-testid="inspector-entity-piece"
                className="font-medium text-neutral-900 text-right truncate"
                title={`${inspectedEntity.pieceCode} · ${inspectedEntity.pieceName} (${inspectedEntity.pieceId})`}
              >
                {inspectedEntity.pieceCode} · {inspectedEntity.pieceName}
              </dd>
            </div>

            <div data-testid="inspector-entity-topology" className="space-y-1 pt-1 border-t border-teal-100">
              {'contour' in inspectedEntity && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-neutral-500">Contour / Segment</dt>
                  <dd className="font-mono text-[10px] text-neutral-900 text-right break-all">
                    {inspectedEntity.contour} · {inspectedEntity.segmentId}
                  </dd>
                </div>
              )}

              {inspectedEntity.entityKind === 'vertex' && (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Endpoint Slot</dt>
                    <dd className="font-mono text-[10px] text-neutral-900">
                      {inspectedEntity.endpointSlot}
                      {inspectedEntity.isSharedJunction ? ' (deduplicated junction)' : ''}
                    </dd>
                  </div>
                  <div className="pt-1 space-y-1">
                    <dt className="text-[10px] text-neutral-500">
                      Incident Segments ({inspectedEntity.incidentSegments.length})
                    </dt>
                    <dd className="space-y-1">
                      {inspectedEntity.incidentSegments.map((inc, idx) => (
                        <div
                          key={`${inc.direction}-${inc.segmentId}-${idx}`}
                          className="px-1.5 py-1 rounded-xs bg-white border border-neutral-200 font-mono text-[10px] text-neutral-800 flex items-center justify-between gap-1.5"
                        >
                          <span className="truncate">
                            {inc.direction === 'incoming' ? 'in' : 'out'}: {inc.segmentId}
                          </span>
                          <span className="text-neutral-500 shrink-0">
                            {inc.segmentKind === 'cubic-bezier' ? 'cubic' : 'line'} · {inc.endpointSlot}
                          </span>
                        </div>
                      ))}
                    </dd>
                  </div>
                </>
              )}

              {(inspectedEntity.entityKind === 'edge' || inspectedEntity.entityKind === 'curve') && (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Segment Kind / Role</dt>
                    <dd className="font-mono text-[10px] text-neutral-900">
                      {inspectedEntity.segmentKind} · {inspectedEntity.segmentRole}
                    </dd>
                  </div>
                  {inspectedEntity.seamId && (
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-neutral-500">Seam ID</dt>
                      <dd className="font-mono text-[10px] text-neutral-900 truncate">
                        {inspectedEntity.seamId}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Sample Parameter t</dt>
                    <dd className="font-mono tabular-nums text-[10px] text-neutral-900">
                      {inspectedEntity.parameterT.toFixed(4)}
                    </dd>
                  </div>
                </>
              )}

              {inspectedEntity.entityKind === 'bezier-handle' && (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Handle / Role</dt>
                    <dd className="font-mono text-[10px] text-neutral-900">
                      {inspectedEntity.handleSlot.toUpperCase()} · {inspectedEntity.segmentRole}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Anchor (Local cm)</dt>
                    <dd className="font-mono tabular-nums text-[10px] text-neutral-900">
                      ({formatUnroundedCm(inspectedEntity.anchorLocalCm.x)},{' '}
                      {formatUnroundedCm(inspectedEntity.anchorLocalCm.y)})
                    </dd>
                  </div>
                </>
              )}

              {inspectedEntity.entityKind === 'notch' && (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-neutral-500">Notch ID / Type</dt>
                    <dd className="font-mono text-[10px] text-neutral-900">
                      {inspectedEntity.notchId} · {inspectedEntity.notchType}
                    </dd>
                  </div>
                  {inspectedEntity.linkedSegmentId && (
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-neutral-500">Linked Segment</dt>
                      <dd className="font-mono text-[10px] text-neutral-900">
                        {inspectedEntity.linkedSegmentId}
                      </dd>
                    </div>
                  )}
                </>
              )}

              {inspectedEntity.entityKind === 'dart' && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-neutral-500">Dart ID</dt>
                  <dd className="font-mono text-[10px] text-neutral-900">
                    {inspectedEntity.dartId} (source intake {inspectedEntity.widthCm} cm)
                  </dd>
                </div>
              )}

              {inspectedEntity.entityKind === 'dart-landmark' && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-neutral-500">Dart / Landmark</dt>
                  <dd className="font-mono text-[10px] text-neutral-900">
                    {inspectedEntity.dartId} · {inspectedEntity.landmarkRole}
                  </dd>
                </div>
              )}
            </div>
          </dl>

          {/* Optional Bézier Control Polygon Toggle */}
          {(inspectedEntity.entityKind === 'curve' ||
            inspectedEntity.entityKind === 'bezier-handle') && (
            <div className="space-y-1.5 pt-1 border-t border-teal-100">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-neutral-600">
                  Bézier Control Polygon
                </span>
                <button
                  type="button"
                  data-testid="inspector-toggle-control-polygon"
                  aria-pressed={atelier.showControlPolygon}
                  onClick={() => atelier.setShowControlPolygon(!atelier.showControlPolygon)}
                  className={`px-2 py-0.5 rounded-xs border text-[10px] font-mono cursor-pointer transition-colors ${
                    atelier.showControlPolygon
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  {atelier.showControlPolygon ? 'Visible' : 'Hidden'}
                </button>
              </div>
              {inspectedEntity.entityKind === 'curve' && (
                <div className="grid grid-cols-2 gap-1 font-mono text-[10px] text-neutral-700 bg-white border border-neutral-200 rounded-xs p-1.5">
                  <div>
                    P0: ({formatUnroundedCm(inspectedEntity.p0LocalCm.x)},{' '}
                    {formatUnroundedCm(inspectedEntity.p0LocalCm.y)})
                  </div>
                  <div>
                    P1: ({formatUnroundedCm(inspectedEntity.p1LocalCm.x)},{' '}
                    {formatUnroundedCm(inspectedEntity.p1LocalCm.y)})
                  </div>
                  <div>
                    P2: ({formatUnroundedCm(inspectedEntity.p2LocalCm.x)},{' '}
                    {formatUnroundedCm(inspectedEntity.p2LocalCm.y)})
                  </div>
                  <div>
                    P3: ({formatUnroundedCm(inspectedEntity.p3LocalCm.x)},{' '}
                    {formatUnroundedCm(inspectedEntity.p3LocalCm.y)})
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Unrounded Piece-Local Coordinates (cm) */}
          <div
            data-testid="inspector-entity-local-coords"
            className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1"
          >
            <span className="text-[10px] font-semibold text-neutral-600 block">
              Piece-Local Coordinates (cm · Unrounded Source)
            </span>
            <div className="space-y-0.5 font-mono tabular-nums text-[10.5px] text-neutral-900">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-400 shrink-0">X</span>
                <span className="text-right truncate">
                  {formatUnroundedCm(inspectedEntity.localPointCm.x)} cm
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-400 shrink-0">Y</span>
                <span className="text-right truncate">
                  {formatUnroundedCm(inspectedEntity.localPointCm.y)} cm
                </span>
              </div>
            </div>
          </div>

          {/* Separate CAD Board Table Coordinates (cm) */}
          <div
            data-testid="inspector-entity-board-coords"
            className="bg-white border border-neutral-200 rounded-xs p-2 space-y-1"
          >
            <span className="text-[10px] font-semibold text-neutral-600 block">
              CAD Board Table Coordinates (cm · Ephemeral Offset)
            </span>
            <div className="space-y-0.5 font-mono tabular-nums text-[10.5px] text-neutral-900">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-400 shrink-0">X</span>
                <span className="text-right truncate">
                  {formatUnroundedCm(inspectedEntity.boardPointCm.x)} cm
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-400 shrink-0">Y</span>
                <span className="text-right truncate">
                  {formatUnroundedCm(inspectedEntity.boardPointCm.y)} cm
                </span>
              </div>
            </div>
          </div>

          {/* Coordinate Frame, Authority Tier & Certification Disclosure */}
          {(() => {
            const targetArtifact = inspectionTargetArtifact ?? activeArtifact;
            return (
              <dl className="space-y-1 pt-1 border-t border-teal-200/70 text-[10px]">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-neutral-500 shrink-0">Coordinate Frame</dt>
                  <dd
                    data-testid="inspector-entity-coord-frame"
                    className="font-mono text-neutral-900 text-right whitespace-nowrap"
                  >
                    {targetArtifact.coordinateFrame.yAxisDirection === 'cartesian-y-up'
                      ? `Cartesian Y-Up (${targetArtifact.coordinateFrame.exteriorWinding} · ${targetArtifact.coordinateFrame.geometryUnit})`
                      : `SVG Y-Down (${targetArtifact.coordinateFrame.exteriorWinding} · ${targetArtifact.coordinateFrame.geometryUnit})`}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-neutral-500">Artifact Authority</dt>
                  <dd
                    data-testid="inspector-entity-authority-tier"
                    className="font-mono font-semibold text-neutral-900 text-right"
                  >
                    {targetArtifact.authorityTier}
                  </dd>
                </div>
                <div
                  data-testid="inspector-entity-certification"
                  className="mt-1 p-1.5 rounded-xs bg-amber-50 border border-amber-200 text-amber-900 space-y-0.5 leading-snug"
                >
                  <div className="font-medium">{targetArtifact.provenance.disclosureLabel}</div>
                  <div className="font-mono text-[9.5px] text-amber-800">
                    isCertified: {String(targetArtifact.isCertified)} · isProductionReady:{' '}
                    {String(targetArtifact.isProductionReady)} · externalCadInteroperabilityVerified:{' '}
                    {String(targetArtifact.externalCadInteroperabilityVerified)}
                  </div>
                </div>
              </dl>
            );
          })()}
        </section>
      )}

      {/* Prompt when in Inspect Geometry mode with no entity clicked yet */}
      {atelier && !inspectedEntity && activeTool === 'inspect-entity' && (
        <section
          data-testid="inspector-cad-entity-prompt"
          className="pb-3 border-b border-teal-200/80 space-y-1.5"
        >
          <div className="flex items-center gap-1.5 text-teal-900 font-semibold text-[11px]">
            <Crosshair className="w-3.5 h-3.5 text-teal-700" />
            <span>Inspect Geometry Mode (Read-Only)</span>
          </div>
          {hasAlignedActiveProposal && (
            <div
              data-testid="inspector-d3-entity-prompt-source"
              className="p-1.5 rounded-xs border border-indigo-200 bg-indigo-50/80 text-indigo-950 flex flex-wrap items-center justify-between gap-1.5 text-[10px]"
            >
              <span>
                Target:{' '}
                <strong>
                  {isInspectingProposal
                    ? 'Proposed Sew (UNVERIFIED_VISUAL_PROPOSAL)'
                    : 'Original Artifact'}
                </strong>
              </span>
              <button
                type="button"
                onClick={atelier.toggleCompareOriginalGeometry}
                aria-pressed={compareOriginalGeometry}
                data-testid="inspector-entity-prompt-compare-toggle"
                className="px-1.5 py-0.5 rounded-xs border border-indigo-300 bg-white text-indigo-900 font-mono text-[9.5px] font-semibold shrink-0 cursor-pointer"
              >
                {compareOriginalGeometry ? 'Use Proposal' : 'Compare Original'}
              </button>
            </div>
          )}
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            Hover and click any vertex, straight edge, cubic curve, control handle, notch, or dart
            on the canvas to inspect its unrounded coordinates and topology without moving pieces.
          </p>
        </section>
      )}

      {/* Seam selection summary if a seam is active */}
      {selectedEntity?.kind === 'seam' && (
        <section className="pb-3 border-b border-neutral-200 space-y-2" data-testid="inspector-seam">
          <div className="flex items-center gap-1.5 text-neutral-900 font-semibold">
            <Sliders className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <span className="truncate">{selectedEntity.label}</span>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="text-neutral-500">Measured Length</dt>
              <dd className="font-mono tabular-nums font-semibold text-neutral-900">
                {selectedEntity.lengthCm !== undefined ? `${selectedEntity.lengthCm} cm` : 'N/A'}
              </dd>
            </div>
            {selectedEntity.pairedSeamName && (
              <div>
                <dt className="text-neutral-500">Paired Seam</dt>
                <dd className="font-medium text-neutral-900 truncate">
                  {selectedEntity.pairedSeamName}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* UX-2.3.2: Multi-Selection CAD Board Arrangement Controls */}
      {atelier && isMultiBoardSelection && (
        <section
          className="pb-3.5 border-b border-neutral-200 space-y-3"
          data-testid="inspector-board-multi"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-neutral-700 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-neutral-500" />
              {boardSelectedIds.length} Pieces Selected
            </span>
            <button
              type="button"
              onClick={() => atelier.clearPieceSelection()}
              data-testid="inspector-clear-board-selection"
              className="text-[11px] text-neutral-600 hover:text-neutral-900 hover:underline cursor-pointer"
            >
              Clear
            </button>
          </div>

          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Visual board arrangement only — repositions pieces in CAD table cm without modifying
            original pattern contours.
          </p>

          {/* Align Controls */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium text-neutral-500 block">
              Align Selected Pieces
            </span>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => atelier.alignSelectedPieces('left')}
                title="Align Left Edges"
                aria-label="Align Left"
                data-testid="board-align-left"
                className="h-7 flex items-center justify-center gap-1 border border-neutral-200 rounded-xs hover:bg-neutral-100 text-[10px] font-medium text-neutral-700 cursor-pointer"
              >
                <AlignStartVertical className="w-3.5 h-3.5" />
                <span>L</span>
              </button>
              <button
                type="button"
                onClick={() => atelier.alignSelectedPieces('right')}
                title="Align Right Edges"
                aria-label="Align Right"
                data-testid="board-align-right"
                className="h-7 flex items-center justify-center gap-1 border border-neutral-200 rounded-xs hover:bg-neutral-100 text-[10px] font-medium text-neutral-700 cursor-pointer"
              >
                <AlignEndVertical className="w-3.5 h-3.5" />
                <span>R</span>
              </button>
              <button
                type="button"
                onClick={() => atelier.alignSelectedPieces('top')}
                title="Align Top Edges"
                aria-label="Align Top"
                data-testid="board-align-top"
                className="h-7 flex items-center justify-center gap-1 border border-neutral-200 rounded-xs hover:bg-neutral-100 text-[10px] font-medium text-neutral-700 cursor-pointer"
              >
                <AlignStartHorizontal className="w-3.5 h-3.5" />
                <span>T</span>
              </button>
              <button
                type="button"
                onClick={() => atelier.alignSelectedPieces('bottom')}
                title="Align Bottom Edges"
                aria-label="Align Bottom"
                data-testid="board-align-bottom"
                className="h-7 flex items-center justify-center gap-1 border border-neutral-200 rounded-xs hover:bg-neutral-100 text-[10px] font-medium text-neutral-700 cursor-pointer"
              >
                <AlignEndHorizontal className="w-3.5 h-3.5" />
                <span>B</span>
              </button>
            </div>
          </div>

          {/* Distribute Controls */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={boardSelectedIds.length < 3}
              onClick={() => atelier.distributeSelectedPieces('horizontal')}
              data-testid="board-distribute-horizontal"
              className="h-7 px-2 flex items-center justify-center gap-1.5 border border-neutral-200 rounded-xs text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <AlignHorizontalSpaceAround className="w-3.5 h-3.5" />
              Distribute H
            </button>
            <button
              type="button"
              disabled={boardSelectedIds.length < 3}
              onClick={() => atelier.distributeSelectedPieces('vertical')}
              data-testid="board-distribute-vertical"
              className="h-7 px-2 flex items-center justify-center gap-1.5 border border-neutral-200 rounded-xs text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <AlignVerticalSpaceAround className="w-3.5 h-3.5" />
              Distribute V
            </button>
          </div>

          {/* Group / Ungroup */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => atelier.groupSelectedPieces()}
              data-testid="inspector-group-btn"
              className="h-7 px-2.5 flex items-center justify-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xs text-[11px] font-medium cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Group
            </button>
            <button
              type="button"
              disabled={!hasGroupedSelection}
              onClick={() => atelier.ungroupSelectedPieces()}
              data-testid="inspector-ungroup-btn"
              className="h-7 px-2.5 flex items-center justify-center gap-1.5 border border-neutral-300 hover:bg-neutral-100 text-neutral-800 rounded-xs text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Ungroup className="w-3.5 h-3.5" />
              Ungroup
            </button>
          </div>

          {/* Selected Piece Members */}
          <ul className="space-y-1 pt-1 border-t border-neutral-100">
            {boardSelectedIds.map(id => {
              const p = pieces.find(piece => piece.id === id);
              if (!p) return null;
              const pl = atelier.boardState.placementsByPieceId[id];
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      atelier.selectPiece(id, { expandGroup: false });
                      selectEntity({
                        kind: 'pattern-piece',
                        id: p.id,
                        pieceId: p.id,
                        pieceCode: p.pieceCode,
                        label: p.name
                      });
                    }}
                    className="w-full px-2 py-1 text-left text-[11px] text-neutral-800 hover:bg-neutral-100 rounded-xs border border-neutral-100 flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="truncate font-medium">
                      {p.pieceCode} · {p.name}
                    </span>
                    {pl && (
                      <span className="font-mono tabular-nums text-[10px] text-neutral-500 shrink-0">
                        ({pl.offsetXCm.toFixed(1)}, {pl.offsetYCm.toFixed(1)})
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* UX-2.3.2: Single-Piece CAD Board Placement (strictly separate from source geometry) */}
      {atelier && !isMultiBoardSelection && selectedPiece && selectedPlacement && (
        <section
          className="pb-3.5 border-b border-neutral-200 space-y-2.5"
          data-testid="inspector-board-placement"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold text-neutral-600">
              CAD Board Placement (cm)
            </h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => atelier.togglePieceVisible(selectedPiece.id)}
                title={selectedPlacement.visible ? 'Hide piece on board' : 'Show piece on board'}
                aria-label={selectedPlacement.visible ? 'Hide piece' : 'Show piece'}
                data-testid="inspector-piece-visibility-btn"
                className="p-1 border border-neutral-200 rounded-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
              >
                {selectedPlacement.visible ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3 text-neutral-400" />
                )}
              </button>
              <button
                type="button"
                onClick={() => atelier.reorderPiece(selectedPiece.id, 'forward')}
                title="Bring layer forward"
                aria-label="Bring layer forward"
                data-testid="inspector-piece-forward-btn"
                className="p-1 border border-neutral-200 rounded-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => atelier.reorderPiece(selectedPiece.id, 'backward')}
                title="Send layer backward"
                aria-label="Send layer backward"
                data-testid="inspector-piece-backward-btn"
                className="p-1 border border-neutral-200 rounded-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
              >
                <ArrowDown className="w-3 h-3" />
              </button>
            </div>
          </div>

          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Ephemeral board offset only — original piece geometry and seam dimensions remain
            unchanged.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-0.5">
              <span className="text-[10px] text-neutral-500 block">Board X (cm)</span>
              <input
                type="number"
                step="0.5"
                data-testid="inspector-board-x"
                aria-label="Board X in centimeters"
                value={draftBoardX}
                onChange={e => setDraftBoardX(e.target.value)}
                onBlur={e => commitBoardCoordinate('x', e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    commitBoardCoordinate('x', draftBoardX);
                  }
                }}
                className="w-full px-2 py-1 font-mono tabular-nums text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs focus:outline-none focus:border-neutral-900"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-neutral-500 block">Board Y (cm)</span>
              <input
                type="number"
                step="0.5"
                data-testid="inspector-board-y"
                aria-label="Board Y in centimeters"
                value={draftBoardY}
                onChange={e => setDraftBoardY(e.target.value)}
                onBlur={e => commitBoardCoordinate('y', e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    commitBoardCoordinate('y', draftBoardY);
                  }
                }}
                className="w-full px-2 py-1 font-mono tabular-nums text-xs text-neutral-900 bg-neutral-50 border border-neutral-200 rounded-xs focus:outline-none focus:border-neutral-900"
              />
            </label>
          </div>

          {selectedGroup && (
            <div className="flex items-center justify-between px-2 py-1.5 rounded-xs bg-neutral-50 border border-neutral-200 text-[11px]">
              <span className="text-neutral-700 font-medium truncate">
                Group: {selectedGroup.name} ({selectedGroup.memberPieceIds.length})
              </span>
              <button
                type="button"
                onClick={() => atelier.ungroupById(selectedGroup.id)}
                data-testid="inspector-ungroup-single-btn"
                className="text-[10px] font-medium text-neutral-700 hover:text-neutral-950 hover:underline shrink-0 cursor-pointer"
              >
                Ungroup
              </button>
            </div>
          )}

          <label className="flex items-start gap-2 pt-0.5 cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="inspector-intentional-overlap-toggle"
              checked={selectedPlacement.allowIntentionalOverlap}
              onChange={() => atelier.togglePieceIntentionalOverlap(selectedPiece.id)}
              className="mt-0.5 accent-neutral-900 cursor-pointer"
            />
            <span className="text-[11px] text-neutral-700 leading-snug">
              Mark overlap as intentional (visual comparison overlay)
            </span>
          </label>
        </section>
      )}

      {/* Selected Pattern Piece Geometry Summary (sourced from read-only activeArtifact when available) */}
      {selectedPiece && (
        <section className="space-y-2.5" data-testid="inspector-pattern-piece">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Scissors className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="font-semibold text-neutral-900 truncate">
                {selectedArtifactPiece?.pieceCode ?? selectedPiece.pieceCode} ·{' '}
                {selectedArtifactPiece?.name ?? selectedPiece.name}
              </span>
            </div>
            <span className="font-mono text-[10px] text-neutral-600 shrink-0">
              {(selectedArtifactPiece?.onFold ?? selectedPiece.onFold)
                ? 'Fold'
                : `Cut ${selectedArtifactPiece?.cutCount ?? selectedPiece.cutCount}`}
            </span>
          </div>

          <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xs px-2.5 py-1.5">
            {activeArtifact
              ? `${activeArtifact.authorityTier} · ${activeArtifact.provenance.disclosureLabel} (isProductionReady: ${String(activeArtifact.isProductionReady)}).`
              : 'C0-Legacy prototype geometry · Non-authoritative preview (isProductionReady: false).'}
          </p>

          <dl className="grid grid-cols-2 gap-y-2 gap-x-3 pt-1 border-t border-neutral-100 text-[11px]">
            <div>
              <dt className="text-neutral-500">Bounding Box</dt>
              <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                {selectedArtifactPiece
                  ? `${selectedArtifactPiece.boundingBoxCm.widthCm} × ${selectedArtifactPiece.boundingBoxCm.heightCm} cm`
                  : `${selectedPiece.boundingBox.widthCm} × ${selectedPiece.boundingBox.heightCm} cm`}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Seam Allowance</dt>
              <dd className="font-mono tabular-nums text-neutral-900 font-medium">
                {selectedArtifactPiece?.seamAllowanceWidthCm ?? selectedPiece.seamAllowanceWidthCm} cm
              </dd>
            </div>
            {selectedArtifactPiece && (
              <div className="col-span-2 flex items-center justify-between pt-1 border-t border-neutral-100 text-[10px] font-mono text-neutral-600">
                <span>
                  Sew {selectedArtifactPiece.sewSegments.length} · Cut{' '}
                  {selectedArtifactPiece.cutSegments.length}
                </span>
                <span>
                  Notches {selectedArtifactPiece.notches.length} · Darts{' '}
                  {selectedArtifactPiece.darts.length}
                </span>
              </div>
            )}
            {selectedPiece.offsetResult && (
              <div className="col-span-2 flex items-center justify-between pt-1 border-t border-neutral-100">
                <dt className="text-neutral-500">Offset Preview</dt>
                <dd
                  className={`font-mono tabular-nums font-semibold ${
                    selectedPiece.offsetResult.status === 'success'
                      ? 'text-emerald-700'
                      : selectedPiece.offsetResult.status === 'warning'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                  }`}
                >
                  {selectedPiece.offsetResult.status} ({selectedPiece.offsetResult.maxDeviationCm} cm)
                </dd>
              </div>
            )}
          </dl>

          {/* Calculated Seamlines */}
          {selectedPiece.seams.length > 0 && (
            <div className="pt-2 border-t border-neutral-100 space-y-1">
              <span className="text-[11px] font-semibold text-neutral-500 block">
                Seamlines ({selectedPiece.seams.length})
              </span>
              {selectedPiece.seams.map(seam => (
                <button
                  key={seam.id}
                  type="button"
                  onClick={() =>
                    selectEntity({
                      kind: 'seam',
                      id: `${selectedPiece.id}:${seam.id}`,
                      pieceId: selectedPiece.id,
                      seamId: seam.id,
                      label: `${selectedPiece.name} · ${seam.name}`,
                      lengthCm: seam.lengthCm,
                      pairedSeamName: seam.pairedSeamName
                    })
                  }
                  className="w-full px-2 py-1.5 rounded-xs border border-neutral-200 hover:border-neutral-400 bg-neutral-50/70 flex items-center justify-between text-left cursor-pointer transition-colors"
                >
                  <span className="min-w-0 pr-2">
                    <span className="text-neutral-800 block truncate">{seam.name}</span>
                    {seam.pairedSeamName && (
                      <span className="text-[10px] text-neutral-500 block truncate">
                        Pairs: {seam.pairedSeamName}
                      </span>
                    )}
                  </span>
                  <span className="font-mono tabular-nums text-neutral-900 font-semibold shrink-0">
                    {seam.lengthCm} cm
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Sleeve Diagnostics when sleeve is active */}
          {selectedPiece.id === 'piece-sleeve' && sleeveDiag && (
            <div className="pt-2 border-t border-neutral-100 space-y-1 text-[11px] font-mono tabular-nums">
              <span className="font-sans font-semibold text-neutral-500 block">
                Sleeve Fit Diagnostics ({sleeveDiag.strategy})
              </span>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-sans">Cap Height</span>
                <span className="text-neutral-900">{sleeveDiag.capHeightCm} cm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-sans">Scye / Cap</span>
                <span className="text-neutral-900">
                  {sleeveDiag.bodiceArmholeLengthCm} / {sleeveDiag.totalCapLengthCm} cm
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-sans">Net Cap Ease</span>
                <span className="font-semibold text-blue-800">
                  +{sleeveDiag.capEaseCm} cm ({sleeveDiag.capEasePercentage}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-sans">Inseam Parity</span>
                <span className="text-emerald-700">{sleeveDiag.inseamParityDeltaCm} cm</span>
              </div>
            </div>
          )}
        </section>
      )}

      {/* UX-2.3.2: Advisory Visual Overlap Feedback (never geometric certification) */}
      {atelier && (
        <section
          className="pt-3 border-t border-neutral-200 space-y-2"
          data-testid="inspector-overlap-advisories"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-neutral-500">
              Visual Overlap Advisories
            </h3>
            <span className="font-mono tabular-nums text-[10px] font-semibold text-neutral-700">
              {atelier.overlapAdvisories.length}
            </span>
          </div>

          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Advisory visual arrangement feedback only — does not validate seam construction or
            certify geometry.
          </p>

          {atelier.overlapAdvisories.length === 0 ? (
            <div
              className="px-2.5 py-2 rounded-xs border border-neutral-200 bg-neutral-50 text-[11px] text-neutral-600"
              data-testid="inspector-overlap-empty"
            >
              No overlapping piece regions detected on the CAD board.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {atelier.overlapAdvisories.map(adv => {
                const meta = OVERLAP_META[adv.classification];
                return (
                  <div
                    key={adv.id}
                    data-testid={`inspector-overlap-item-${adv.classification}`}
                    className={`p-2 rounded-xs border text-[11px] space-y-1 ${meta.borderClass}`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-mono font-semibold text-neutral-900">
                        {adv.pieceACode} ↔ {adv.pieceBCode}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded-xs text-[10px] font-semibold shrink-0 ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-neutral-700 leading-snug">{adv.message}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* UX-2.3.3.3 (D6): Unified Validation & Spatial Diagnostics Section */}
      <section
        className="pt-3 border-t border-neutral-200 space-y-2.5"
        data-testid="inspector-validation-engine"
      >
        {(() => {
          const isExternalArtifact =
            Boolean(atelier?.activeArtifact) &&
            atelier?.activeArtifact?.authorityTier !== 'C0_LEGACY_TS_PROTOTYPE';
          const diagSummary = atelier?.resolvedDiagnostics.summary;
          const blockingTotal =
            (diagSummary?.bySeverity.CRITICAL_BLOCKING ?? 0) +
            (diagSummary?.bySeverity.ERROR ?? 0);
          return (
            <>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold text-neutral-500">
                  Validation &amp; Spatial Diagnostics
                </h3>
                {isExternalArtifact && diagSummary ? (
                  <span
                    className={`font-mono tabular-nums text-[11px] font-semibold ${
                      blockingTotal > 0
                        ? 'text-rose-700'
                        : diagSummary.total > 0
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                    }`}
                  >
                    {blockingTotal > 0
                      ? `${blockingTotal} blocking · ${diagSummary.total} total`
                      : diagSummary.total > 0
                        ? `${diagSummary.total} advisory`
                        : '0 diagnostics'}
                  </span>
                ) : (
                  <span
                    className={`font-mono tabular-nums text-[11px] font-semibold ${
                      validationReport.isValid ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {validationReport.passedCount}/{validationReport.checks.length} passed
                  </span>
                )}
              </div>

              <p className="text-[10px] text-neutral-500 leading-relaxed">
                {isExternalArtifact && atelier?.activeArtifact
                  ? `${atelier.activeArtifact.provenance.disclosureLabel} `
                  : `${validationReport.declaration} `}
                Spatial mapping localizes reported issues on the canvas for inspection only — it
                does not perform geometric certification.
              </p>
            </>
          );
        })()}

        {/* Spatial Diagnostics Controls & Summary (memoized so camera pan/zoom skips all diagnostic cards) */}
        {atelier && (
          <SpatialDiagnosticsInspectorSection
            resolvedDiagnostics={atelier.resolvedDiagnostics}
            showDiagnosticsOverlay={atelier.showDiagnosticsOverlay}
            toggleDiagnosticsOverlay={atelier.toggleDiagnosticsOverlay}
            diagnosticSeverityFilter={atelier.diagnosticSeverityFilter}
            toggleDiagnosticSeverityFilter={atelier.toggleDiagnosticSeverityFilter}
            selectedDiagnosticKey={atelier.selectedDiagnosticKey}
            selectDiagnostic={atelier.selectDiagnostic}
            clearDiagnosticSelection={atelier.clearDiagnosticSelection}
            locateDiagnosticOnCanvas={atelier.locateDiagnosticOnCanvas}
            diagnosticReconciliationNotice={atelier.diagnosticReconciliationNotice}
            dismissDiagnosticReconciliationNotice={atelier.dismissDiagnosticReconciliationNotice}
            layerVisibility={atelier.layerVisibility}
            hasActiveProposal={hasAlignedActiveProposal}
          />
        )}

        {/* Preserved C0 Deterministic Validation Checks Ledger (pass + non-pass summary) */}
        <details
          open={!validationReport.isValid || (atelier?.resolvedDiagnostics.summary.total ?? 0) === 0}
          className="pt-1 text-[11px] text-neutral-600"
          data-testid="inspector-validation-checks-ledger"
        >
          <summary className="cursor-pointer font-medium text-neutral-700 hover:text-neutral-900">
            Validation Checks Ledger ({validationReport.passedCount}/{validationReport.checks.length} passed)
          </summary>
          <div className="mt-1.5 space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {validationReport.checks.map(chk => (
              <div
                key={chk.id}
                className={`p-2 rounded-xs border text-[11px] space-y-0.5 ${
                  chk.status === 'pass'
                    ? 'bg-emerald-50/40 border-emerald-200/80'
                    : chk.status === 'warning'
                      ? 'bg-amber-50/50 border-amber-200'
                      : 'bg-rose-50/60 border-rose-200'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 font-medium text-neutral-900">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {chk.status === 'pass' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle
                        className={`w-3.5 h-3.5 shrink-0 ${
                          chk.status === 'fail' ? 'text-rose-600' : 'text-amber-600'
                        }`}
                      />
                    )}
                    <span className="truncate">{chk.name}</span>
                  </span>
                  <span className="font-mono text-[10px] uppercase shrink-0">{chk.status}</span>
                </div>
                {chk.measuredValue && (
                  <div className="font-mono tabular-nums text-[10px] text-neutral-700">
                    {chk.measuredValue}
                  </div>
                )}
                <p className="text-[10px] text-neutral-600">{chk.message}</p>
              </div>
            ))}
          </div>
        </details>

        {validationReport.unassessedConditions.length > 0 && (
          <details className="pt-1 text-[11px] text-neutral-600">
            <summary className="cursor-pointer font-medium text-neutral-700 hover:text-neutral-900">
              Unassessed industrial criteria ({validationReport.unassessedConditions.length})
            </summary>
            <ul className="mt-1.5 space-y-1 pl-3 list-disc text-[10px] text-neutral-600">
              {validationReport.unassessedConditions.map(u => (
                <li key={u.id}>
                  <strong className="text-neutral-800">{u.name}:</strong> {u.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
};
