/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyMeasurements,
  Dart,
  DesignSpecification,
  Notch,
  SeamLine
} from '../../types';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { assembleBodiceSleeve } from '../assembly/bodice-sleeve-assembly';
import { AssemblyValidationStatus } from '../assembly/assembly-types';
import { gradeBodice } from './bodice-grader';
import { auditGradedDarts } from './dart-grader';
import { gradeSleeve } from './sleeve-grader';
import { validateCrossSizeIntegrity } from './assembly-grade-validator';
import {
  GradedPatternSet,
  GradedSizeResult,
  GradingOptions
} from './grading-types';
import {
  buildStandardMeasurementGradeTable,
  computeMeasurementDeltas,
  DEFAULT_BASE_SIZE,
  DEFAULT_SIZE_RANGE,
  resolveTargetMeasurements,
  validateMeasurementRecord
} from './measurement-grade-rules';

/**
 * Deterministic Pattern Grading Engine.
 * Generates an inspectable, validated range of garment sizes using target measurement
 * regeneration and independent cross-size assembly validation.
 * 
 * Never applies global coordinate scaling around an arbitrary origin.
 * Every size is drafted from explicit target measurements and validated individually.
 * 
 * Safety constraint: isProductionReady is strictly false across all generated structures.
 */
export function gradePattern(
  designSpec: DesignSpecification,
  options: GradingOptions = {}
): GradedPatternSet {
  const timestamp = new Date().toISOString();
  const id = `graded-set-${Date.now()}`;

  const baseSize = options.baseSize ?? DEFAULT_BASE_SIZE;
  const supportedSizes = options.targetSizes ?? DEFAULT_SIZE_RANGE;
  const gradeTable = options.customGradeTable ?? buildStandardMeasurementGradeTable();

  // 1. Resolve base measurements
  const baseMeasurements: BodyMeasurements =
    options.customMeasurements?.[baseSize] ??
    STANDARD_SIZING_SYSTEM.sizes[baseSize as keyof typeof STANDARD_SIZING_SYSTEM.sizes] ??
    STANDARD_SIZING_SYSTEM.sizes.M;

  // 2. Draft base size first to establish reference dart state
  const baseBodiceResult = gradeBodice(baseMeasurements, designSpec, {
    dartStyle: options.bodiceDartStyle ?? 'waist',
    bezierToleranceCm: options.bezierToleranceCm
  });
  const baseFrontPiece = baseBodiceResult.pieces.find(p => p.pieceCode.includes('BOD-F') || p.id.includes('front'));
  const baseDarts: Dart[] = baseFrontPiece?.darts ?? [];

  // 3. Process every target size independently
  const sizeResults: Record<string, GradedSizeResult> = {};

  for (const targetSize of supportedSizes) {
    const isBase = targetSize === baseSize;
    const errors: string[] = [];
    const warnings: string[] = [];

    // Target measurements
    const targetMeasurements = isBase && !options.customMeasurements?.[targetSize]
      ? { ...baseMeasurements }
      : resolveTargetMeasurements(
          baseMeasurements,
          targetSize,
          gradeTable,
          options.customMeasurements?.[targetSize]
        );

    // Validate measurements
    const measValidation = validateMeasurementRecord(targetMeasurements, `Size ${targetSize}`);
    if (!measValidation.isValid) {
      errors.push(...measValidation.errors);
    }
    warnings.push(...measValidation.warnings);

    const deltas = computeMeasurementDeltas(baseMeasurements, targetMeasurements);

    // Grade bodice
    const bodiceResult = gradeBodice(targetMeasurements, designSpec, {
      dartStyle: options.bodiceDartStyle ?? 'waist',
      bezierToleranceCm: options.bezierToleranceCm
    });
    errors.push(...bodiceResult.errors);
    warnings.push(...bodiceResult.warnings);

    // Grade sleeve (coupled to target bodice scye)
    const sleeveResult = gradeSleeve(targetMeasurements, designSpec, bodiceResult.pieces, {
      strategy: options.sleeveEaseStrategy ?? 'classic',
      bezierToleranceCm: options.bezierToleranceCm
    });
    errors.push(...sleeveResult.errors);
    warnings.push(...sleeveResult.warnings);

    // Extract pieces, darts, seams, notches
    const frontPiece = bodiceResult.pieces.find(p => p.pieceCode.includes('BOD-F') || p.id.includes('front'));
    const targetDarts = frontPiece?.darts ?? [];

    // Audit darts against base size reference
    const dartAudit = auditGradedDarts(baseDarts, targetDarts, baseMeasurements, targetMeasurements);
    if (!dartAudit.isValid) {
      errors.push(...dartAudit.anomalies);
    }

    const allPieces = [...bodiceResult.pieces];
    if (sleeveResult.piece) {
      allPieces.push(sleeveResult.piece);
    }

    const allMetrics = [
      ...bodiceResult.metrics,
      sleeveResult.metrics
    ];

    const allSeams: SeamLine[] = [];
    const allNotches: Notch[] = [];
    for (const p of allPieces) {
      if (p.seams) allSeams.push(...p.seams);
      if (p.notches) allNotches.push(...p.notches);
    }

    // Assemble bodice and sleeve for target size
    let assemblyResult = undefined;
    let status: AssemblyValidationStatus = 'unassessed-missing-data';

    if (bodiceResult.pieces.length >= 2 && sleeveResult.piece) {
      assemblyResult = assembleBodiceSleeve({
        bodicePieces: bodiceResult.pieces,
        sleevePiece: sleeveResult.piece,
        measurements: targetMeasurements,
        options: { strategy: options.sleeveEaseStrategy ?? 'classic' },
        designSpec
      });

      if (assemblyResult.status === 'verified-valid' && errors.length === 0) {
        status = 'verified-valid';
      } else {
        status = 'invalid';
      }
    } else {
      errors.push('Missing pattern pieces required for assembly validation.');
      status = 'unassessed-missing-data';
    }

    const isValid = status === 'verified-valid' && errors.length === 0;

    sizeResults[targetSize] = {
      sizeId: targetSize,
      isBaseSize: isBase,
      measurements: targetMeasurements,
      measurementDeltasFromBase: deltas,
      bodicePieces: bodiceResult.pieces,
      sleevePiece: sleeveResult.piece,
      darts: targetDarts,
      seams: allSeams,
      notches: allNotches,
      pieceMetrics: allMetrics,
      assemblyResult,
      easeMetrics: assemblyResult?.ease,
      status,
      isValid,
      isProductionReady: false, // Strict safety invariant
      errors,
      warnings
    };
  }

  // 4. Cross-size integrity report
  const isCustomDataset = Boolean(
    options.isCustomDataset ??
    (options.gradingContext === 'custom-table' || options.gradingContext === 'individual-custom' || Boolean(options.customMeasurements) || Boolean(options.customGradeTable))
  );
  const gradingContext = options.gradingContext ?? (isCustomDataset ? 'custom-table' : 'standard-chart');

  const integrityReport = validateCrossSizeIntegrity(sizeResults, supportedSizes, baseSize, {
    ...options,
    isCustomDataset,
    gradingContext
  });

  // 5. Overall validity
  const isAllValid =
    integrityReport.isOverallGradingValid &&
    supportedSizes.every(sz => sizeResults[sz]?.isValid);

  return {
    id,
    timestamp,
    garmentCategory: designSpec.garmentCategory,
    silhouette: designSpec.silhouette,
    baseSize,
    supportedSizes,
    designSpec,
    sizeResults,
    integrityReport,
    gradeTable,
    isAllValid,
    isProductionReady: false
  };
}
