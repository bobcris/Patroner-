/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  validateOffsetClassificationReportCrossFieldInvariants,
  validateOffsetValidationRecordCrossFieldInvariants
} from '../../../../packages/contracts/src/cross-field-validators';
import type {
  PatternArtifactBundle,
  PatternPieceRenderModel,
  PythonBezierSegment,
  PythonPatternPieceContract,
  RenderBoundingBoxCm,
  RenderCurveSegment,
  RenderPoint2D,
  RenderSpatialDiagnostic
} from './pattern-render-artifact';

export interface AdaptPythonPatternArtifactInput {
  readonly pieces: readonly PythonPatternPieceContract[];
  readonly specificationRevisionId: string;
  readonly measurementRevisionId: string;
  readonly artifactDigestSha256?: string;
  readonly engineVersion?: string;
}

export interface PythonArtifactAdaptationResult {
  readonly valid: boolean;
  readonly validationErrors: readonly string[];
  readonly bundle: PatternArtifactBundle;
}

function isFinitePoint(pt: unknown): pt is RenderPoint2D {
  return (
    Boolean(pt) &&
    typeof pt === 'object' &&
    typeof (pt as RenderPoint2D).x === 'number' &&
    typeof (pt as RenderPoint2D).y === 'number' &&
    Number.isFinite((pt as RenderPoint2D).x) &&
    Number.isFinite((pt as RenderPoint2D).y)
  );
}

/**
 * Computes a viewport display envelope from supplied control points strictly for
 * canvas framing. Does NOT alter source coordinates or claim geometric bounds.
 */
function computeControlHullEnvelopeCm(
  segments: readonly PythonBezierSegment[]
): RenderBoundingBoxCm {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const seg of segments) {
    for (const pt of [seg.p0, seg.p1, seg.p2, seg.p3]) {
      if (!isFinitePoint(pt)) continue;
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthCm: 0, heightCm: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    widthCm: maxX - minX,
    heightCm: maxY - minY
  };
}

function projectPythonSegment(
  seg: PythonBezierSegment,
  role: 'stitching' | 'cutting'
): RenderCurveSegment {
  return {
    id: seg.id,
    kind: 'cubic-bezier',
    role,
    // Exact source coordinates preserved verbatim without rounding or mutation
    p0: { x: seg.p0.x, y: seg.p0.y },
    p1: { x: seg.p1.x, y: seg.p1.y },
    p2: { x: seg.p2.x, y: seg.p2.y },
    p3: { x: seg.p3.x, y: seg.p3.y }
  };
}

/**
 * Validates and projects an offline/supplied Python `contracts.py` PatternPiece array
 * into the read-only `PatternArtifactBundle` render contract.
 *
 * Rules enforced:
 * - Does NOT create or claim a live Python API or network service.
 * - Never mutates source coordinates, never recomputes authoritative offsets/arc lengths.
 * - Enforces M00.1 cross-field numeric invariants via `packages/contracts/src/cross-field-validators.ts`.
 * - Fail-closed certification: if any piece fails structural checks, cross-field checks,
 *   has blocking warnings, lacks certification records, or has any non-`CERTIFIED_VALID`
 *   verification outcome, the projected bundle is marked `authorityTier: 'UNVERIFIED_EXTERNAL_ARTIFACT'`,
 *   `isCertified: false`, and `isProductionReady: false`.
 * - Always preserves `externalCadInteroperabilityVerified: false`.
 */
export function adaptPythonPatternArtifact(
  input: AdaptPythonPatternArtifactInput
): PythonArtifactAdaptationResult {
  const validationErrors: string[] = [];
  const diagnostics: RenderSpatialDiagnostic[] = [];
  const projectedPieces: PatternPieceRenderModel[] = [];

  let allPiecesHaveCertifiedRecords = input.pieces.length > 0;
  let allRecordsCertifiedValid = input.pieces.length > 0;
  let allRecordsProductionReady = input.pieces.length > 0;

  if (input.pieces.length === 0) {
    validationErrors.push('Python artifact contains zero pattern pieces.');
  }

  for (const piece of input.pieces) {
    let pieceHasBlockingError = false;

    // 1. Validate coordinate frame contract parity with contracts.py CoordinateFrameSpec
    const cf = piece.coordinateFrame;
    if (
      !cf ||
      cf.geometryUnit !== 'cm' ||
      cf.handedness !== 'right-handed-cartesian' ||
      cf.exteriorWinding !== 'CCW'
    ) {
      pieceHasBlockingError = true;
      validationErrors.push(
        `Piece ${piece.pieceId}: invalid CoordinateFrameSpec (expected cm, right-handed-cartesian, CCW exterior).`
      );
      diagnostics.push({
        id: `py-frame-${piece.pieceId}`,
        code: 'CONTRACT_COORDINATE_FRAME_INVALID',
        severity: 'CRITICAL_BLOCKING',
        pieceId: piece.pieceId,
        message: 'Supplied coordinateFrame does not match canonical Python right-handed Cartesian cm/CCW specification.'
      });
    }

    // 2. Validate segment coordinates are finite (preserve exact values)
    const allSegs = [...(piece.sewBoundarySegments ?? []), ...(piece.cutBoundarySegments ?? [])];
    if (piece.sewBoundarySegments.length === 0 || piece.cutBoundarySegments.length === 0) {
      pieceHasBlockingError = true;
      validationErrors.push(
        `Piece ${piece.pieceId}: sewBoundarySegments and cutBoundarySegments must each contain >= 1 BezierSegment.`
      );
    }

    for (const seg of allSegs) {
      if (
        !isFinitePoint(seg.p0) ||
        !isFinitePoint(seg.p1) ||
        !isFinitePoint(seg.p2) ||
        !isFinitePoint(seg.p3)
      ) {
        pieceHasBlockingError = true;
        validationErrors.push(`Piece ${piece.pieceId} segment ${seg.id}: non-finite Bezier control point.`);
        diagnostics.push({
          id: `py-seg-${piece.pieceId}-${seg.id}`,
          code: 'CONTRACT_NON_FINITE_COORDINATE',
          severity: 'CRITICAL_BLOCKING',
          pieceId: piece.pieceId,
          segmentId: seg.id,
          message: `Segment ${seg.id} contains non-finite coordinates.`
        });
      }
    }

    // 3. Validate OffsetValidationRecord cross-field numeric invariants + ADR-009 certification flags
    const valRecords = piece.offsetValidationRecords ?? [];
    if (valRecords.length === 0) {
      allPiecesHaveCertifiedRecords = false;
      allRecordsCertifiedValid = false;
      allRecordsProductionReady = false;
    }

    for (const rec of valRecords) {
      const cfCheck = validateOffsetValidationRecordCrossFieldInvariants(rec);
      if (!cfCheck.valid) {
        pieceHasBlockingError = true;
        allRecordsCertifiedValid = false;
        allRecordsProductionReady = false;
        for (const v of cfCheck.violations) {
          validationErrors.push(`Piece ${piece.pieceId} (${rec.segment_id}): ${v.message}`);
          diagnostics.push({
            id: `py-cf-val-${piece.pieceId}-${rec.segment_id}-${v.invariantId}`,
            code: v.invariantId,
            severity: 'CRITICAL_BLOCKING',
            pieceId: piece.pieceId,
            segmentId: rec.segment_id,
            message: v.message,
            verificationOutcome: rec.verification_outcome,
            canonicalOffsetClassification: rec.canonical_offset_classification,
            workingPrecisionBits: rec.working_precision_bits
          });
        }
      }

      if (rec.verification_outcome !== 'CERTIFIED_VALID') {
        pieceHasBlockingError = true;
        allRecordsCertifiedValid = false;
        allRecordsProductionReady = false;
        diagnostics.push({
          id: `py-ovr-${piece.pieceId}-${rec.segment_id}`,
          code: rec.failure_category || 'ADR009_OFFSET_VERIFICATION_FAILED',
          severity: rec.verification_outcome === 'CERTIFIED_INVALID' ? 'CRITICAL_BLOCKING' : 'ERROR',
          pieceId: piece.pieceId,
          segmentId: rec.segment_id,
          message: `Offset verification ${rec.verification_outcome}: ${rec.canonical_offset_classification}`,
          verificationOutcome: rec.verification_outcome,
          canonicalOffsetClassification: rec.canonical_offset_classification,
          maxGeometricDeviationBoundCm: rec.max_geometric_deviation_bound_cm,
          workingPrecisionBits: rec.working_precision_bits
        });
      } else if (!rec.is_production_ready) {
        allRecordsProductionReady = false;
      }
    }

    // 4. Validate OffsetClassificationReport cross-field numeric invariants
    for (const rep of piece.offsetReports ?? []) {
      const repCheck = validateOffsetClassificationReportCrossFieldInvariants(rep);
      if (!repCheck.valid) {
        pieceHasBlockingError = true;
        allRecordsCertifiedValid = false;
        allRecordsProductionReady = false;
        for (const v of repCheck.violations) {
          validationErrors.push(`Piece ${piece.pieceId} (${rep.segmentId}): ${v.message}`);
          diagnostics.push({
            id: `py-cf-rep-${piece.pieceId}-${rep.segmentId}-${v.invariantId}`,
            code: v.invariantId,
            severity: 'CRITICAL_BLOCKING',
            pieceId: piece.pieceId,
            segmentId: rep.segmentId,
            message: v.message,
            verificationOutcome: rep.verificationOutcome,
            canonicalOffsetClassification: rep.canonicalOffsetClassification
          });
        }
      }

      if (rep.verificationOutcome !== 'CERTIFIED_VALID') {
        pieceHasBlockingError = true;
        allRecordsCertifiedValid = false;
        allRecordsProductionReady = false;
      } else if (!rep.isProductionReady) {
        allRecordsProductionReady = false;
      }
    }

    // 5. Project explicit GeometryWarning entries
    for (const warn of piece.warnings ?? []) {
      if (warn.severity === 'CRITICAL_BLOCKING' || warn.severity === 'ERROR') {
        pieceHasBlockingError = true;
        allRecordsCertifiedValid = false;
        allRecordsProductionReady = false;
      }
      diagnostics.push({
        id: warn.warningId,
        code: warn.code,
        severity: warn.severity,
        pieceId: warn.pieceId,
        segmentId: warn.segmentId,
        parameterT: warn.parameterT ?? undefined,
        message: warn.message,
        remediationAction: warn.remediationAction,
        canonicalOffsetClassification: warn.classification
      });
    }

    const envelope = computeControlHullEnvelopeCm(
      piece.cutBoundarySegments.length > 0
        ? piece.cutBoundarySegments
        : piece.sewBoundarySegments
    );

    const primaryAllowanceCm =
      piece.seamAllowances.length > 0 ? piece.seamAllowances[0].distanceCm : 0;

    projectedPieces.push({
      pieceId: piece.pieceId,
      pieceCode: piece.pieceCode,
      name: piece.name,
      material: 'self',
      cutCount: 1,
      onFold: false,
      seamAllowanceWidthCm: primaryAllowanceCm,
      boundingBoxCm: envelope,
      sewSegments: piece.sewBoundarySegments.map(s => projectPythonSegment(s, 'stitching')),
      cutSegments: piece.cutBoundarySegments.map(s => projectPythonSegment(s, 'cutting')),
      seams: [],
      seamAllowances: piece.seamAllowances.map(sa => ({
        segmentId: sa.segmentId,
        distanceCm: sa.distanceCm,
        directionSign: sa.directionSign,
        joinStyle: sa.joinStyle,
        miterLimit: sa.miterLimit
      })),
      darts: [],
      notches: piece.notches.map(n => ({
        id: n.id,
        segmentId: n.segmentId,
        position: { x: n.position.x, y: n.position.y },
        normalVector: { x: n.normalVector.x, y: n.normalVector.y },
        notchType: n.notchType,
        targetArcLengthCm: n.targetArcLengthCm,
        parameterT: n.parameterT,
        arcLengthResidualCm: n.arcLengthResidualCm
      })),
      hasBlockingError: pieceHasBlockingError
    });
  }

  const isContractValid = validationErrors.length === 0;
  const isCertified =
    isContractValid && allPiecesHaveCertifiedRecords && allRecordsCertifiedValid;

  const authorityTier = isCertified
    ? 'C1_PYTHON_CERTIFIED'
    : 'UNVERIFIED_EXTERNAL_ARTIFACT';

  return {
    valid: isContractValid,
    validationErrors,
    bundle: {
      schemaVersion: 'patroner.pattern-render-artifact.v1',
      authorityTier,
      isCertified,
      // Fail-closed: never upgrades uncertified/invalid artifacts to production ready
      isProductionReady: isCertified && allRecordsProductionReady,
      externalCadInteroperabilityVerified: false,
      coordinateFrame: {
        geometryUnit: 'cm',
        yAxisDirection: 'cartesian-y-up',
        handedness: 'right-handed-cartesian',
        exteriorWinding: 'CCW'
      },
      provenance: {
        specificationRevisionId: input.specificationRevisionId,
        measurementRevisionId: input.measurementRevisionId,
        artifactDigestSha256: input.artifactDigestSha256,
        engineVersion: input.engineVersion ?? 'patroner-geometry-contract-v1',
        disclosureLabel: isCertified
          ? 'Python contract artifact · Certified offset records validated (offline contract projection)'
          : 'Unverified external artifact · Certification missing or failed validation'
      },
      pieces: projectedPieces,
      diagnostics
    }
  };
}
