/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyMeasurements,
  DesignSpecification,
  PatternPiece,
  SleeveEaseStrategy
} from '../../types';
import {
  draftSleeveBlock,
  SleeveDiagnostics,
  SleeveDraftOptions
} from '../drafting/sleeve-block';
import { computePieceMetrics } from './bodice-grader';
import { GradedPieceMetrics } from './grading-types';

export interface GradedSleeveResult {
  piece: PatternPiece;
  metrics: GradedPieceMetrics;
  diagnostics: SleeveDiagnostics;
  errors: string[];
  warnings: string[];
}

/**
 * Grades a tailored sleeve block for target measurements, tightly coupled to the
 * corresponding target size's bodice armhole geometry.
 * Ensures that sleeve cap ease, crown orientation, and biceps girth scale harmoniously
 * with the target bodice scye.
 */
export function gradeSleeve(
  measurements: BodyMeasurements,
  designSpec: DesignSpecification,
  bodicePieces: PatternPiece[],
  options?: SleeveDraftOptions
): GradedSleeveResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const draftOpts: SleeveDraftOptions = {
      ...options,
      bodicePieces
    };

    const { piece, diagnostics } = draftSleeveBlock(measurements, designSpec, draftOpts);
    const metrics = computePieceMetrics(piece);

    return {
      piece,
      metrics,
      diagnostics,
      errors,
      warnings
    };
  } catch (err: any) {
    errors.push(`Sleeve grading failure: ${err?.message || String(err)}`);
    // Return a dummy fallback piece if drafting threw an error
    const fallbackPiece: PatternPiece = {
      id: 'piece-sleeve-graded-failed',
      pieceCode: 'SLV-1',
      name: 'Graded Sleeve (Draft Failed)',
      garmentCategory: 'bodice',
      cutCount: 2,
      onFold: false,
      material: 'self',
      cutPathData: '',
      sewPathData: '',
      seamAllowanceWidthCm: 1.5,
      grainline: { start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, direction: 'vertical' },
      darts: [],
      notches: [],
      seams: [],
      boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0, widthCm: 0, heightCm: 0 },
      description: 'Sleeve draft failed'
    };

    const fallbackDiagnostics: SleeveDiagnostics = {
      strategy: options?.strategy ?? 'classic',
      capHeightCm: 0,
      bicepsWidthCm: 0,
      wristWidthCm: 0,
      frontCapLengthCm: 0,
      backCapLengthCm: 0,
      totalCapLengthCm: 0,
      bodiceArmholeLengthCm: 0,
      frontArmholeLengthCm: 0,
      backArmholeLengthCm: 0,
      targetCapEaseCm: 0,
      targetFrontEaseCm: 0,
      targetBackEaseCm: 0,
      frontCapEaseCm: 0,
      backCapEaseCm: 0,
      frontEaseResidualCm: 0,
      backEaseResidualCm: 0,
      totalEaseResidualCm: 0,
      capEaseCm: 0,
      capEasePercentage: 0,
      frontInseamLengthCm: 0,
      backInseamLengthCm: 0,
      inseamParityDeltaCm: 0,
      crownTangencyDeg: 0,
      bicepsEaseCm: 0,
      wristEaseCm: 0
    };

    return {
      piece: fallbackPiece,
      metrics: computePieceMetrics(fallbackPiece),
      diagnostics: fallbackDiagnostics,
      errors,
      warnings
    };
  }
}
