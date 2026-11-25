/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PatternPiece, ValidationReport } from '../../../types';
import type { AuthoritativeProductionWorkspaceBundle } from '../../../engine/production';
import type { GeometricSegment } from '../../../engine/geometry/primitives';
import type {
  DiagnosticContourScope,
  PatternArtifactBundle,
  PatternPieceRenderModel,
  RenderCurveSegment,
  RenderNotch,
  RenderSpatialDiagnostic
} from './pattern-render-artifact';

export interface AdaptC0LegacyInput {
  readonly workspaceBundle: AuthoritativeProductionWorkspaceBundle;
  readonly specificationRevisionId: string;
  readonly measurementRevisionId: string;
  readonly piecesOverride?: readonly PatternPiece[];
}

interface SegmentOwnershipEntry {
  readonly pieceId: string;
  readonly contour: DiagnosticContourScope;
}

interface C0OwnershipIndex {
  readonly segmentOwners: ReadonlyMap<string, readonly SegmentOwnershipEntry[]>;
  readonly dartOwnerById: ReadonlyMap<string, string>;
  readonly seamOwnerById: ReadonlyMap<string, string>;
  readonly pieceIds: ReadonlySet<string>;
}

function buildC0OwnershipIndex(pieces: readonly PatternPiece[]): C0OwnershipIndex {
  const segmentOwners = new Map<string, SegmentOwnershipEntry[]>();
  const dartOwnerCounts = new Map<string, Set<string>>();
  const seamOwnerCounts = new Map<string, Set<string>>();
  const pieceIds = new Set<string>();

  const registerSeg = (segId: string, pieceId: string, contour: DiagnosticContourScope) => {
    if (!segId) return;
    const list = segmentOwners.get(segId) ?? [];
    if (!list.some(entry => entry.pieceId === pieceId && entry.contour === contour)) {
      list.push({ pieceId, contour });
    }
    segmentOwners.set(segId, list);
  };

  for (const piece of pieces) {
    pieceIds.add(piece.id);
    for (const seg of piece.stitchingContour?.segments ?? []) {
      registerSeg(seg.id, piece.id, 'sew');
    }
    for (const seg of piece.cuttingContour?.segments ?? []) {
      registerSeg(seg.id, piece.id, 'cut');
    }
    for (const dart of piece.darts ?? []) {
      if (!dart.id) continue;
      const owners = dartOwnerCounts.get(dart.id) ?? new Set<string>();
      owners.add(piece.id);
      dartOwnerCounts.set(dart.id, owners);
    }
    for (const seam of piece.seams ?? []) {
      if (!seam.id) continue;
      const owners = seamOwnerCounts.get(seam.id) ?? new Set<string>();
      owners.add(piece.id);
      seamOwnerCounts.set(seam.id, owners);
    }
  }

  const dartOwnerById = new Map<string, string>();
  for (const [dartId, owners] of dartOwnerCounts.entries()) {
    if (owners.size === 1) {
      dartOwnerById.set(dartId, Array.from(owners)[0]);
    }
  }

  const seamOwnerById = new Map<string, string>();
  for (const [seamId, owners] of seamOwnerCounts.entries()) {
    if (owners.size === 1) {
      seamOwnerById.set(seamId, Array.from(owners)[0]);
    }
  }

  return { segmentOwners, dartOwnerById, seamOwnerById, pieceIds };
}

const STRUCTURED_PIECE_CHECK_PREFIXES: readonly string[] = [
  'val-code-',
  'val-gl-len-',
  'val-gl-',
  'val-sa-',
  'val-contour-stitch-missing-',
  'val-contour-cut-missing-',
  'val-offset-failed-',
  'val-offset-warn-'
];

function resolveUniquePieceContour(
  pieceId: string,
  segmentIds: readonly string[],
  index: C0OwnershipIndex
): DiagnosticContourScope | undefined {
  const contours = new Set<DiagnosticContourScope>();
  for (const segId of segmentIds) {
    const entries = index.segmentOwners.get(segId);
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.pieceId === pieceId) {
        contours.add(entry.contour);
      }
    }
  }
  if (contours.size === 1) {
    return Array.from(contours)[0];
  }
  return undefined;
}

function resolveStructuredCheckOwnership(
  checkId: string,
  segmentIds: readonly string[],
  index: C0OwnershipIndex
): { readonly pieceId?: string; readonly contour?: DiagnosticContourScope } {
  // 1. Authoritative segment ownership lookup (never name/ID substring matching)
  if (segmentIds.length > 0) {
    const owningPieces = new Set<string>();
    for (const segId of segmentIds) {
      const entries = index.segmentOwners.get(segId);
      if (!entries) continue;
      for (const entry of entries) {
        owningPieces.add(entry.pieceId);
      }
    }
    if (owningPieces.size === 1) {
      const pieceId = Array.from(owningPieces)[0];
      return {
        pieceId,
        contour: resolveUniquePieceContour(pieceId, segmentIds, index)
      };
    }
    // If segmentIds span multiple pieces or are unknown, do not invent a single pieceId
    // unless a structured check ID explicitly names one valid piece.
  }

  // 2. Exact structured piece-level check IDs emitted by C0 seam-validator.ts
  for (const prefix of STRUCTURED_PIECE_CHECK_PREFIXES) {
    if (checkId.startsWith(prefix)) {
      const candidatePieceId = checkId.slice(prefix.length);
      if (index.pieceIds.has(candidatePieceId)) {
        return {
          pieceId: candidatePieceId,
          contour:
            segmentIds.length > 0
              ? resolveUniquePieceContour(candidatePieceId, segmentIds, index)
              : undefined
        };
      }
    }
  }

  // 3. Exact structured dart check ID (`val-dart-${dart.id}`)
  if (checkId.startsWith('val-dart-')) {
    const dartId = checkId.slice('val-dart-'.length);
    const pieceId = index.dartOwnerById.get(dartId);
    if (pieceId) {
      return { pieceId };
    }
  }

  // 4. Exact structured single-piece seam check IDs (e.g. `val-seam-seg-len-${seam.id}`)
  const seamPrefixes = [
    'val-seam-seg-len-',
    'val-seam-missing-paired-',
    'val-seam-missing-'
  ];
  for (const prefix of seamPrefixes) {
    if (checkId.startsWith(prefix)) {
      const seamId = checkId.slice(prefix.length);
      const pieceId = index.seamOwnerById.get(seamId);
      if (pieceId) {
        return { pieceId };
      }
    }
  }
  if (checkId.startsWith('val-seam-seg-missing-')) {
    const rest = checkId.slice('val-seam-seg-missing-'.length);
    for (const [seamId, pieceId] of index.seamOwnerById.entries()) {
      if (rest.startsWith(`${seamId}-`)) {
        return { pieceId };
      }
    }
  }

  // 5. Genuinely global or cross-piece checks remain honestly unmapped (no invented pieceId)
  return {};
}

function mapSegmentRole(
  role: GeometricSegment['role'],
  defaultRole: 'stitching' | 'cutting'
): RenderCurveSegment['role'] {
  switch (role) {
    case 'stitching':
      return 'stitching';
    case 'miter':
      return 'miter';
    case 'bevel':
      return 'bevel';
    case 'fold-extension':
      return 'fold';
    case 'bridge':
      return 'bridge';
    case 'offset':
    default:
      return defaultRole;
  }
}

function projectContourSegments(
  segments: readonly GeometricSegment[] | undefined,
  defaultRole: 'stitching' | 'cutting'
): readonly RenderCurveSegment[] {
  if (!segments || segments.length === 0) return [];
  return segments.map(seg => {
    if (seg.type === 'bezier') {
      return {
        id: seg.id,
        kind: 'cubic-bezier' as const,
        seamId: seg.seamId,
        role: mapSegmentRole(seg.role, defaultRole),
        p0: { x: seg.p0.x, y: seg.p0.y },
        p1: { x: seg.cp1.x, y: seg.cp1.y },
        p2: { x: seg.cp2.x, y: seg.cp2.y },
        p3: { x: seg.p3.x, y: seg.p3.y },
        isFold: seg.isFold
      };
    }
    return {
      id: seg.id,
      kind: 'line' as const,
      seamId: seg.seamId,
      role: mapSegmentRole(seg.role, defaultRole),
      p0: { x: seg.start.x, y: seg.start.y },
      p3: { x: seg.end.x, y: seg.end.y },
      isFold: seg.isFold
    };
  });
}

function projectNotch(notch: PatternPiece['notches'][number]): RenderNotch {
  const rad = (notch.normalAngleDeg * Math.PI) / 180;
  return {
    id: notch.id,
    position: { x: notch.position.x, y: notch.position.y },
    normalVector: {
      x: Number(Math.cos(rad).toFixed(6)),
      y: Number(Math.sin(rad).toFixed(6))
    },
    notchType: notch.type,
    label: notch.label
  };
}

function normalizeUniqueSegmentIds(raw: readonly string[] | undefined): readonly string[] {
  if (!raw || raw.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of raw) {
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function mapValidationDiagnostics(
  validationReport: ValidationReport,
  pieces: readonly PatternPiece[],
  ownershipIndex: C0OwnershipIndex
): readonly RenderSpatialDiagnostic[] {
  const diagnostics: RenderSpatialDiagnostic[] = [];
  const validationOffsetSummaryKeys = new Set<string>();
  const validationMessagesByPiece = new Map<string, Set<string>>();

  for (const check of validationReport.checks) {
    if (check.status === 'pass') continue;
    const uniqueSegIds = normalizeUniqueSegmentIds(check.segmentIds);
    const resolved = resolveStructuredCheckOwnership(check.id, uniqueSegIds, ownershipIndex);

    if (resolved.pieceId) {
      const msgSet = validationMessagesByPiece.get(resolved.pieceId) ?? new Set<string>();
      msgSet.add(check.message.trim());
      validationMessagesByPiece.set(resolved.pieceId, msgSet);

      if (check.id === `val-offset-failed-${resolved.pieceId}`) {
        validationOffsetSummaryKeys.add(`${resolved.pieceId}::failure`);
      } else if (check.id === `val-offset-warn-${resolved.pieceId}`) {
        validationOffsetSummaryKeys.add(`${resolved.pieceId}::warning`);
      }
    }

    diagnostics.push({
      id: check.id,
      code: check.errorCode ?? `C0_${check.category.toUpperCase()}`,
      severity:
        check.status === 'fail'
          ? 'ERROR'
          : check.severity === 'info'
            ? 'INFO'
            : 'WARNING',
      pieceId: resolved.pieceId,
      segmentId: uniqueSegIds[0],
      secondarySegmentIds: uniqueSegIds.length > 1 ? uniqueSegIds.slice(1) : undefined,
      contour: resolved.contour,
      message: check.message,
      remediationAction: check.suggestedAction,
      failureCategory: check.errorCode ?? check.category,
      diagnosticOrigin: 'c0-validation'
    });
  }

  for (const piece of pieces) {
    const offset = piece.offsetResult;
    if (!offset || offset.status === 'success') continue;

    const emittedPieceMessages = new Set<string>(
      validationMessagesByPiece.get(piece.id) ?? []
    );
    let emittedOffsetDetailCount = 0;

    // 1. Preserve per-segment offset diagnostics without truncation
    const segDiagnostics = offset.diagnostics ?? [];
    for (let idx = 0; idx < segDiagnostics.length; idx++) {
      const segDiag = segDiagnostics[idx];
      if (segDiag.status === 'success') continue;

      const contour = resolveUniquePieceContour(piece.id, [segDiag.sourceSegmentId], ownershipIndex);
      const message =
        segDiag.failureReason ??
        `C0-Legacy segment offset ${segDiag.status} on ${segDiag.sourceSegmentId} (max deviation ${segDiag.maxDeviationCm} cm, tolerance ${segDiag.toleranceCm} cm).`;
      emittedPieceMessages.add(message.trim());
      emittedOffsetDetailCount += 1;

      diagnostics.push({
        id: `c0-offset-seg-${piece.id}-${segDiag.sourceSegmentId}-${idx}`,
        code:
          segDiag.status === 'failure'
            ? 'C0_OFFSET_SEGMENT_FAILURE'
            : 'C0_OFFSET_SEGMENT_WARNING',
        severity: segDiag.status === 'failure' ? 'CRITICAL_BLOCKING' : 'WARNING',
        pieceId: piece.id,
        segmentId: segDiag.sourceSegmentId,
        contour,
        message,
        failureCategory:
          segDiag.status === 'failure' ? 'C0_OFFSET_SEGMENT_FAILURE' : 'C0_OFFSET_SEGMENT_WARNING',
        diagnosticOrigin: 'c0-offset',
        maxGeometricDeviationBoundCm: segDiag.maxDeviationCm
      });
    }

    // 2. Preserve all distinct offset error messages not already covered
    for (let idx = 0; idx < (offset.errors?.length ?? 0); idx++) {
      const errMsg = offset.errors[idx]?.trim();
      if (!errMsg || emittedPieceMessages.has(errMsg)) continue;
      emittedPieceMessages.add(errMsg);
      emittedOffsetDetailCount += 1;
      diagnostics.push({
        id: `c0-offset-err-${piece.id}-${idx}`,
        code: 'C0_OFFSET_FAILURE',
        severity: 'CRITICAL_BLOCKING',
        pieceId: piece.id,
        message: errMsg,
        failureCategory: 'C0_OFFSET_FAILURE',
        diagnosticOrigin: 'c0-offset',
        maxGeometricDeviationBoundCm: offset.maxDeviationCm
      });
    }

    // 3. Preserve all distinct offset warning messages not already covered
    for (let idx = 0; idx < (offset.warnings?.length ?? 0); idx++) {
      const warnMsg = offset.warnings[idx]?.trim();
      if (!warnMsg || emittedPieceMessages.has(warnMsg)) continue;
      emittedPieceMessages.add(warnMsg);
      emittedOffsetDetailCount += 1;
      diagnostics.push({
        id: `c0-offset-warn-${piece.id}-${idx}`,
        code: 'C0_OFFSET_WARNING',
        severity: 'WARNING',
        pieceId: piece.id,
        message: warnMsg,
        failureCategory: 'C0_OFFSET_WARNING',
        diagnosticOrigin: 'c0-offset',
        maxGeometricDeviationBoundCm: offset.maxDeviationCm
      });
    }

    // 4. Emit summary diagnostic ONLY if neither validationReport nor detailed offset records covered it
    const hasEquivalentValidationSummary = validationOffsetSummaryKeys.has(
      `${piece.id}::${offset.status}`
    );
    if (emittedOffsetDetailCount === 0 && !hasEquivalentValidationSummary) {
      diagnostics.push({
        id: `c0-offset-${piece.id}`,
        code: offset.status === 'failure' ? 'C0_OFFSET_FAILURE' : 'C0_OFFSET_WARNING',
        severity: offset.status === 'failure' ? 'CRITICAL_BLOCKING' : 'WARNING',
        pieceId: piece.id,
        message: `C0-Legacy seam offset ${offset.status} (max deviation ${offset.maxDeviationCm} cm).`,
        failureCategory: offset.status === 'failure' ? 'C0_OFFSET_FAILURE' : 'C0_OFFSET_WARNING',
        diagnosticOrigin: 'c0-offset',
        maxGeometricDeviationBoundCm: offset.maxDeviationCm
      });
    }
  }

  return diagnostics;
}

/**
 * Pure presentation adapter projecting the existing C0-Legacy TS workspace bundle
 * into a read-only `PatternArtifactBundle`.
 *
 * Strictly non-authoritative:
 * - Never recomputes offsets, arc lengths, grading, or certification results.
 * - Always emits `authorityTier: 'C0_LEGACY_TS_PROTOTYPE'`, `isCertified: false`,
 *   `isProductionReady: false`, and `externalCadInteroperabilityVerified: false`.
 */
export function adaptC0LegacyBundleToRenderArtifact(
  input: AdaptC0LegacyInput
): PatternArtifactBundle {
  const { workspaceBundle, specificationRevisionId, measurementRevisionId } = input;
  const sourcePieces = input.piecesOverride ?? workspaceBundle.pieces;
  const validationReport = workspaceBundle.draftValidation;
  const ownershipIndex = buildC0OwnershipIndex(sourcePieces);
  const diagnostics = mapValidationDiagnostics(validationReport, sourcePieces, ownershipIndex);

  const blockingPieceIds = new Set<string>();
  for (const diag of diagnostics) {
    if (
      diag.pieceId &&
      (diag.severity === 'ERROR' || diag.severity === 'CRITICAL_BLOCKING')
    ) {
      blockingPieceIds.add(diag.pieceId);
    }
  }

  const pieces: PatternPieceRenderModel[] = sourcePieces.map(piece => {
    const isOffsetFailed = piece.offsetResult?.status === 'failure';
    const hasBlockingDiagnostic = blockingPieceIds.has(piece.id);

    return {
      pieceId: piece.id,
      pieceCode: piece.pieceCode,
      name: piece.name,
      description: piece.description,
      material: piece.material,
      cutCount: piece.cutCount,
      onFold: piece.onFold,
      seamAllowanceWidthCm: piece.seamAllowanceWidthCm,
      boundingBoxCm: {
        minX: piece.boundingBox.minX,
        minY: piece.boundingBox.minY,
        maxX: piece.boundingBox.maxX,
        maxY: piece.boundingBox.maxY,
        widthCm: piece.boundingBox.widthCm,
        heightCm: piece.boundingBox.heightCm
      },
      sewSegments: projectContourSegments(piece.stitchingContour?.segments, 'stitching'),
      cutSegments: projectContourSegments(piece.cuttingContour?.segments, 'cutting'),
      fallbackSewSvgPath: piece.sewPathData,
      fallbackCutSvgPath: piece.cutPathData,
      seams: piece.seams.map(seam => ({
        id: seam.id,
        name: seam.name,
        lengthCm: seam.lengthCm,
        segmentIds: seam.segmentIds
          ? [...seam.segmentIds]
          : seam.segmentId
            ? [seam.segmentId]
            : [],
        pairedPieceId: seam.pairedPieceId,
        pairedSeamName: seam.pairedSeamName
      })),
      seamAllowances: (piece.stitchingContour?.segments ?? []).map(seg => ({
        segmentId: seg.id,
        distanceCm: seg.seamAllowanceCm,
        directionSign: -1,
        joinStyle: seg.isFold ? 'fold' : 'miter',
        miterLimit: 2.5
      })),
      darts: piece.darts.map(d => ({
        id: d.id,
        apex: { x: d.apex.x, y: d.apex.y },
        legLeft: { x: d.legLeft.x, y: d.legLeft.y },
        legRight: { x: d.legRight.x, y: d.legRight.y },
        widthCm: d.widthCm,
        lengthCm: d.lengthCm
      })),
      notches: piece.notches.map(projectNotch),
      grainline: {
        start: { x: piece.grainline.start.x, y: piece.grainline.start.y },
        end: { x: piece.grainline.end.x, y: piece.grainline.end.y },
        direction: piece.grainline.direction
      },
      drillHoles: piece.drillHoles?.map(pt => ({ x: pt.x, y: pt.y })),
      hasBlockingError: isOffsetFailed || hasBlockingDiagnostic
    };
  });

  return {
    schemaVersion: 'patroner.pattern-render-artifact.v1',
    authorityTier: 'C0_LEGACY_TS_PROTOTYPE',
    isCertified: false,
    isProductionReady: false,
    externalCadInteroperabilityVerified: false,
    coordinateFrame: {
      geometryUnit: 'cm',
      yAxisDirection: 'svg-y-down',
      handedness: 'screen-y-down',
      exteriorWinding: 'CW'
    },
    provenance: {
      specificationRevisionId,
      measurementRevisionId,
      engineVersion: 'C0-Legacy-TS-Prototype',
      disclosureLabel: 'C0-Legacy prototype geometry · Non-authoritative drafting preview'
    },
    pieces,
    diagnostics
  };
}
