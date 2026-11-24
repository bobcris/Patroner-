/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PatternPiece, ValidationReport } from '../../../types';
import type { AuthoritativeProductionWorkspaceBundle } from '../../../engine/production';
import type { GeometricSegment } from '../../../engine/geometry/primitives';
import type {
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

function mapValidationDiagnostics(
  validationReport: ValidationReport,
  pieces: readonly PatternPiece[]
): readonly RenderSpatialDiagnostic[] {
  const diagnostics: RenderSpatialDiagnostic[] = [];

  for (const check of validationReport.checks) {
    if (check.status === 'pass') continue;
    const matchedPiece = pieces.find(
      p => check.name.includes(p.pieceCode) || check.id.includes(p.id)
    );
    diagnostics.push({
      id: check.id,
      code: check.errorCode ?? `C0_${check.category.toUpperCase()}`,
      severity:
        check.status === 'fail'
          ? 'ERROR'
          : check.severity === 'info'
            ? 'INFO'
            : 'WARNING',
      pieceId: matchedPiece?.id,
      segmentId: check.segmentIds?.[0],
      message: check.message,
      remediationAction: check.suggestedAction
    });
  }

  for (const piece of pieces) {
    const offset = piece.offsetResult;
    if (!offset || offset.status === 'success') continue;
    diagnostics.push({
      id: `c0-offset-${piece.id}`,
      code: offset.status === 'failure' ? 'C0_OFFSET_FAILURE' : 'C0_OFFSET_WARNING',
      severity: offset.status === 'failure' ? 'CRITICAL_BLOCKING' : 'WARNING',
      pieceId: piece.id,
      message:
        offset.errors[0] ??
        offset.warnings[0] ??
        `C0-Legacy seam offset ${offset.status} (max deviation ${offset.maxDeviationCm} cm).`,
      maxGeometricDeviationBoundCm: offset.maxDeviationCm
    });
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

  const pieces: PatternPieceRenderModel[] = sourcePieces.map(piece => {
    const isOffsetFailed = piece.offsetResult?.status === 'failure';
    const hasValidationFailure = validationReport.checks.some(
      c =>
        c.status === 'fail' &&
        (c.name.includes(piece.pieceCode) || c.id.includes(piece.id))
    );

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
      hasBlockingError: isOffsetFailed || hasValidationFailure
    };
  });

  const diagnostics = mapValidationDiagnostics(validationReport, sourcePieces);

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
