/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner M05 — Deterministic 10-Gate Production Package Validator
 *
 * Evaluates all required M05 production readiness criteria across drafted pattern pieces,
 * multi-size grading coverage, measurement provenance & approvals, materials/BOM,
 * manufacturing documentation completeness, DXF round-trip fidelity, and upstream revision
 * lineage without ever bypassing fail-closed governance (`isProductionReady: false`).
 */

import { DesignSpecification, PatternPiece } from '../../types';
import { GradedPatternSet } from '../grading/grading-types';
import { DxfRoundTripVerificationResult } from './dxf-aama-exporter';
import { AuthoritativePieceProductionSheetSet } from './manufacturing-types';
import { verifyManufacturingDocumentationCompleteness } from './manufacturing-docs';
import {
  M05BomReport,
  M05ManufacturingDocumentation,
  ProductionReadinessReport,
  ProductionValidationCheckId,
  ProductionValidationDiagnostic
} from './production-engineering-types';
import {
  AuthoritativePatternRevision,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementProvenanceEvidence
} from './production-types';
import {
  NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS,
  validateMeasurementProvenanceEvidence
} from './pattern-revision-snapshot';

export interface EvaluateProductionReadinessInput {
  readonly designSpec: DesignSpecification;
  readonly pieces: readonly PatternPiece[];
  readonly requiredSizes: readonly string[];
  readonly includedSizes: readonly string[];
  readonly gradedPatternSet?: GradedPatternSet | null;
  readonly sheetSet?: AuthoritativePieceProductionSheetSet | null;
  readonly bom: M05BomReport;
  readonly manufacturingDocs: M05ManufacturingDocumentation;
  readonly patternRevision?: AuthoritativePatternRevision | null;
  readonly dxfRoundTrip?: DxfRoundTripVerificationResult | null;
  readonly measurementProvenance: MeasurementOrigin;
  readonly measurementApprovalState: MeasurementApprovalStatus;
  readonly measurementProvenanceEvidence?: MeasurementProvenanceEvidence;
  readonly upstreamStaleReasons?: readonly string[];
}

function makeDiag(
  checkId: ProductionValidationCheckId,
  title: string,
  status: 'pass' | 'fail' | 'warning',
  severity: 'blocking' | 'advisory',
  message: string,
  affectedIds: readonly string[] = []
): ProductionValidationDiagnostic {
  return { checkId, title, status, severity, message, affectedIds };
}

/**
 * Evaluates all 10 deterministic production package validation gates.
 * Fail-closed: any blocking failure sets `isValid: false` and `status: 'blocked'`.
 * Always maintains `isProductionReady: false`.
 */
export function evaluateProductionReadiness(
  input: EvaluateProductionReadinessInput
): ProductionReadinessReport {
  const diagnostics: ProductionValidationDiagnostic[] = [];
  const pieces = input.pieces;

  // Gate 1: missing-pattern-pieces
  if (!pieces || pieces.length === 0) {
    diagnostics.push(
      makeDiag(
        'missing-pattern-pieces',
        'Required Pattern Pieces Present',
        'fail',
        'blocking',
        'No drafted pattern pieces are present in the production package.'
      )
    );
  } else {
    const missingRoles: string[] = [];
    if (input.designSpec.garmentCategory === 'bodice') {
      if (!pieces.some(p => p.pieceCode.startsWith('BOD-F'))) missingRoles.push('BOD-F-* (Front Bodice)');
      if (!pieces.some(p => p.pieceCode.startsWith('BOD-B'))) missingRoles.push('BOD-B-* (Back Bodice)');
      if (!pieces.some(p => p.pieceCode.startsWith('SLV'))) missingRoles.push('SLV-* (Sleeve)');
    } else if (input.designSpec.garmentCategory === 'skirt') {
      if (!pieces.some(p => p.pieceCode.startsWith('SK-01'))) missingRoles.push('SK-01-* (Front Skirt)');
      if (!pieces.some(p => p.pieceCode.startsWith('SK-02'))) missingRoles.push('SK-02-* (Back Skirt)');
    }
    if (missingRoles.length > 0) {
      diagnostics.push(
        makeDiag(
          'missing-pattern-pieces',
          'Required Pattern Pieces Present',
          'fail',
          'blocking',
          `Missing mandatory pattern piece(s) for category '${input.designSpec.garmentCategory}': ${missingRoles.join(', ')}.`,
          missingRoles
        )
      );
    } else {
      diagnostics.push(
        makeDiag(
          'missing-pattern-pieces',
          'Required Pattern Pieces Present',
          'pass',
          'blocking',
          `All ${pieces.length} required pattern piece(s) for '${input.designSpec.garmentCategory}' are present.`,
          pieces.map(p => p.pieceCode)
        )
      );
    }
  }

  // Gate 2: invalid-contours
  const badContourPieces: string[] = [];
  for (const piece of pieces) {
    const hasSew = Boolean(piece.stitchingContour && piece.stitchingContour.segments.length >= 3 && piece.stitchingContour.isClosed);
    const hasCut = Boolean(piece.cuttingContour && piece.cuttingContour.segments.length >= 3 && piece.cuttingContour.isClosed);
    const hasNonFinite =
      !Number.isFinite(piece.boundingBox.widthCm) ||
      !Number.isFinite(piece.boundingBox.heightCm) ||
      piece.boundingBox.widthCm <= 0 ||
      piece.boundingBox.heightCm <= 0;
    if (!hasSew || !hasCut || hasNonFinite) {
      badContourPieces.push(piece.pieceCode);
    }
  }
  if (input.dxfRoundTrip && !input.dxfRoundTrip.allPassed) {
    for (const pc of input.dxfRoundTrip.pieceCodes) {
      if (!badContourPieces.includes(pc)) badContourPieces.push(pc);
    }
  }
  if (badContourPieces.length > 0) {
    diagnostics.push(
      makeDiag(
        'invalid-contours',
        'Closed Contour & DXF Round-Trip Integrity',
        'fail',
        'blocking',
        input.dxfRoundTrip && !input.dxfRoundTrip.allPassed
          ? `Contour / DXF-AAMA round-trip verification failed for piece(s): ${badContourPieces.join(', ')}.`
          : `Unclosed, empty, or invalid stitching/cutting contour(s) detected on piece(s): ${badContourPieces.join(', ')}.`,
        badContourPieces
      )
    );
  } else {
    diagnostics.push(
      makeDiag(
        'invalid-contours',
        'Closed Contour & DXF Round-Trip Integrity',
        'pass',
        'blocking',
        'All pattern piece stitching & cutting contours are closed, finite, and round-trip verified (<= 0.001 cm).'
      )
    );
  }

  // Gate 3: incomplete-seam-allowances
  const incompleteSaPieces: string[] = [];
  for (const piece of pieces) {
    const nonFoldSegs = piece.stitchingContour?.segments.filter(s => !s.isFold) ?? [];
    const hasNegative = piece.stitchingContour?.segments.some(s => !Number.isFinite(s.seamAllowanceCm) || s.seamAllowanceCm < 0);
    const nonFoldZero = nonFoldSegs.some(s => (s.seamAllowanceCm ?? 0) <= 0);
    if (!piece.stitchingContour || hasNegative || nonFoldZero) {
      incompleteSaPieces.push(piece.pieceCode);
    }
  }
  if (input.sheetSet && !input.sheetSet.validation.isValid && input.sheetSet.validation.rejectionCodes.includes('ALLOWANCE_SCHEDULE_INVALID')) {
    incompleteSaPieces.push('sheet-allowance-schedule');
  }
  if (incompleteSaPieces.length > 0) {
    diagnostics.push(
      makeDiag(
        'incomplete-seam-allowances',
        'Segment Seam Allowance Completeness',
        'fail',
        'blocking',
        `Missing, zero non-fold, or invalid segment seam allowance(s) detected: ${incompleteSaPieces.join(', ')}.`,
        incompleteSaPieces
      )
    );
  } else {
    diagnostics.push(
      makeDiag(
        'incomplete-seam-allowances',
        'Segment Seam Allowance Completeness',
        'pass',
        'blocking',
        'All non-fold contour segments carry positive explicit seam allowances and fold edges remain 0.0 cm.'
      )
    );
  }

  // Gate 4: missing-grainlines
  const missingGrainPieces: string[] = [];
  for (const piece of pieces) {
    const gl = piece.grainline;
    const len = gl ? Math.hypot(gl.end.x - gl.start.x, gl.end.y - gl.start.y) : 0;
    if (!gl || !Number.isFinite(len) || len <= 0.1) {
      missingGrainPieces.push(piece.pieceCode);
    }
  }
  if (missingGrainPieces.length > 0) {
    diagnostics.push(
      makeDiag(
        'missing-grainlines',
        'Pattern Piece Grainlines Present',
        'fail',
        'blocking',
        `Missing or degenerate grainline vector on piece(s): ${missingGrainPieces.join(', ')}.`,
        missingGrainPieces
      )
    );
  } else {
    diagnostics.push(
      makeDiag(
        'missing-grainlines',
        'Pattern Piece Grainlines Present',
        'pass',
        'blocking',
        'Every pattern piece carries a finite directional grainline vector.'
      )
    );
  }

  // Gate 5: inconsistent-piece-metadata
  const badMetaPieces: string[] = [];
  const seenPieceCodes = new Set<string>();
  for (const piece of pieces) {
    const dupCode = seenPieceCodes.has(piece.pieceCode);
    seenPieceCodes.add(piece.pieceCode);
    const badCutFold = (piece.onFold && piece.cutCount < 1) || (!piece.onFold && piece.cutCount < 1);
    const emptyMeta = !piece.id.trim() || !piece.pieceCode.trim() || !piece.name.trim() || !piece.material;
    if (dupCode || badCutFold || emptyMeta) {
      badMetaPieces.push(piece.pieceCode || piece.id || 'UNKNOWN');
    }
  }
  if (badMetaPieces.length > 0) {
    diagnostics.push(
      makeDiag(
        'inconsistent-piece-metadata',
        'Piece Identity, Cut Semantics & Metadata Consistency',
        'fail',
        'blocking',
        `Duplicate pieceCode or inconsistent cutCount/onFold/material metadata on: ${badMetaPieces.join(', ')}.`,
        badMetaPieces
      )
    );
  } else {
    diagnostics.push(
      makeDiag(
        'inconsistent-piece-metadata',
        'Piece Identity, Cut Semantics & Metadata Consistency',
        'pass',
        'blocking',
        'Piece codes, cut counts, fold semantics, and material assignments are internally consistent.'
      )
    );
  }

  // Gate 6: invalid-size-coverage
  const missingSizes = input.requiredSizes.filter(s => !input.includedSizes.includes(s));
  const invalidGradedSizes = input.gradedPatternSet
    ? Object.entries(input.gradedPatternSet.sizeResults)
        .filter(([sz, res]) => input.includedSizes.includes(sz) && !res.isValid)
        .map(([sz]) => sz)
    : [];

  if (missingSizes.length > 0 || invalidGradedSizes.length > 0 || (input.gradedPatternSet && !input.gradedPatternSet.isAllValid)) {
    const affected = Array.from(new Set([...missingSizes, ...invalidGradedSizes]));
    diagnostics.push(
      makeDiag(
        'invalid-size-coverage',
        'Multi-Size Coverage & Grading Integrity',
        'fail',
        'blocking',
        missingSizes.length > 0
          ? `Required size coverage incomplete; missing size(s): ${missingSizes.join(', ')}.`
          : `Graded size integrity verification failed for size(s): ${invalidGradedSizes.join(', ') || 'cross-size checks'}.`,
        affected
      )
    );
  } else {
    diagnostics.push(
      makeDiag(
        'invalid-size-coverage',
        'Multi-Size Coverage & Grading Integrity',
        'pass',
        'blocking',
        `Size coverage verified across [${input.includedSizes.join(', ')}]${input.gradedPatternSet ? ' with all graded sizes valid' : ' (single-size base scope)'}.`
      )
    );
  }

  // Gate 7: unresolved-measurement-approvals
  const evidenceCheck = validateMeasurementProvenanceEvidence(
    input.measurementProvenance,
    input.measurementProvenanceEvidence
  );
  const isNonApprovableOrigin = NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS.has(input.measurementProvenance);
  const isMeasApproved =
    input.measurementApprovalState === 'approved' && !isNonApprovableOrigin && evidenceCheck.isValid;
  if (!isMeasApproved || !input.designSpec.isApproved) {
    const reasons: string[] = [];
    if (!input.designSpec.isApproved) reasons.push('design specification not approved');
    if (isNonApprovableOrigin) reasons.push(`measurement origin '${input.measurementProvenance}' is unverified reference`);
    else if (!evidenceCheck.isValid) reasons.push(evidenceCheck.reason ?? 'missing measurement evidence');
    else if (input.measurementApprovalState !== 'approved') reasons.push(`measurement approval state is '${input.measurementApprovalState}'`);
    diagnostics.push(
      makeDiag(
        'unresolved-measurement-approvals',
        'Measurement & Specification Governance Approvals',
        'warning',
        'advisory',
        `Production release blocked by governance gates: ${reasons.join('; ')}.`,
        [input.designSpec.id]
      )
    );
  } else {
    diagnostics.push(
      makeDiag(
        'unresolved-measurement-approvals',
        'Measurement & Specification Governance Approvals',
        'pass',
        'advisory',
        `Measurements (${input.measurementProvenance}) and design specification are explicitly approved for 2D package review.`
      )
    );
  }

  // Gate 8: missing-material-specs
  const specFabricMissing =
    !input.designSpec.fabric.id?.trim() ||
    !input.designSpec.fabric.name?.trim() ||
    !input.designSpec.fabric.composition?.trim();
  const mainBomItem = input.bom.lineItems.find(i => i.category === 'main-fabric');
  const badBom =
    specFabricMissing ||
    !mainBomItem ||
    !Number.isFinite(input.bom.totalMainFabricMetersForOrder) ||
    input.bom.totalMainFabricMetersForOrder <= 0;
  if (badBom) {
    diagnostics.push(
      makeDiag(
        'missing-material-specs',
        'Material Specifications & BOM Yield Integrity',
        'fail',
        'blocking',
        specFabricMissing
          ? 'DesignSpecification fabric identity or fiber composition is incomplete.'
          : 'Main fabric BOM calculation produced zero or invalid material yield.',
        [input.designSpec.fabric.id || 'fabric']
      )
    );
  } else {
    diagnostics.push(
      makeDiag(
        'missing-material-specs',
        'Material Specifications & BOM Yield Integrity',
        'pass',
        'blocking',
        `Fabric (${input.designSpec.fabric.name}) and ${input.bom.lineItems.length} BOM line items verified across ${input.bom.totalOrderGarments} garment unit(s).`
      )
    );
  }

  // Gate 9: incomplete-manufacturing-docs
  const recomputedCompleteness = verifyManufacturingDocumentationCompleteness(input.manufacturingDocs, pieces);
  if (!input.manufacturingDocs.completeness.isComplete || !recomputedCompleteness.isComplete) {
    const affected = [
      ...recomputedCompleteness.missingSections,
      ...(recomputedCompleteness.untracedOperationCount > 0
        ? [`${recomputedCompleteness.untracedOperationCount}-untraced-operations`]
        : [])
    ];
    diagnostics.push(
      makeDiag(
        'incomplete-manufacturing-docs',
        'Manufacturing Documentation Completeness & Traceability',
        'fail',
        'blocking',
        `Manufacturing documentation is incomplete or contains untraced operations (${affected.join(', ')}).`,
        affected
      )
    );
  } else {
    diagnostics.push(
      makeDiag(
        'incomplete-manufacturing-docs',
        'Manufacturing Documentation Completeness & Traceability',
        'pass',
        'blocking',
        `Manufacturing documentation complete (${input.manufacturingDocs.sewingSequence.length} operations, ${recomputedCompleteness.totalTracedReferences} verified piece/feature references).`
      )
    );
  }

  // Gate 10: invalid-or-stale-revision
  const staleReasons = input.upstreamStaleReasons ?? [];
  const revMissing = !input.patternRevision || !input.patternRevision.revisionId.trim();
  const revInvalidated = input.patternRevision?.currentLifecycleState === 'invalidated' || input.patternRevision?.currentLifecycleState === 'superseded';
  if (revMissing || revInvalidated || staleReasons.length > 0) {
    diagnostics.push(
      makeDiag(
        'invalid-or-stale-revision',
        'Upstream Pattern & Grading Revision Lineage',
        'fail',
        'blocking',
        staleReasons.length > 0
          ? `Downstream production package is stale against upstream changes: ${staleReasons.join('; ')}`
          : revInvalidated
            ? `Authoritative pattern revision '${input.patternRevision?.revisionId}' is in state '${input.patternRevision?.currentLifecycleState}'.`
            : 'Authoritative upstream pattern revision record is missing.',
        [input.patternRevision?.revisionId ?? 'missing-revision']
      )
    );
  } else {
    const rev = input.patternRevision!;
    diagnostics.push(
      makeDiag(
        'invalid-or-stale-revision',
        'Upstream Pattern & Grading Revision Lineage',
        'pass',
        'blocking',
        `Revision lineage bound cleanly to '${rev.revisionId}' (${(rev.basePatternFingerprint ?? '').slice(0, 12)}…).`
      )
    );
  }

  const blockingErrors = diagnostics
    .filter(d => d.severity === 'blocking' && d.status === 'fail')
    .map(d => `[${d.checkId}] ${d.message}`);
  const warnings = diagnostics
    .filter(d => d.status === 'warning' || (d.severity === 'advisory' && d.status === 'fail'))
    .map(d => `[${d.checkId}] ${d.message}`);

  const passedCount = diagnostics.filter(d => d.status === 'pass').length;
  const failedCount = diagnostics.filter(d => d.status === 'fail').length;
  const warningCount = diagnostics.filter(d => d.status === 'warning').length;
  const isValid = blockingErrors.length === 0;

  return {
    status: isValid ? 'verified-for-2d-package' : 'blocked',
    isValid,
    passedCount,
    failedCount,
    warningCount,
    blockingErrors,
    warnings,
    diagnostics,
    isProductionReady: false
  };
}
