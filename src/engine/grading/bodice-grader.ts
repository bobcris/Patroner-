/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyMeasurements,
  DesignSpecification,
  PatternPiece
} from '../../types';
import { BodiceDraftOptions, draftBodiceBlock } from '../drafting/bodice-block';
import { resurrectSegment } from '../assembly/bodice-sleeve-assembly';
import { GeometricContour } from '../geometry/primitives';
import { GradedPieceMetrics } from './grading-types';

/**
 * Computes deterministic geometric metrics for a graded pattern piece.
 */
export function computePieceMetrics(piece: PatternPiece): GradedPieceMetrics {
  let areaCm2 = 0;
  let perimeterCm = 0;
  let vertexCount = 0;
  let isContourClosed = true;

  const contour: any = piece.stitchingContour || piece.cuttingContour;
  if (contour) {
    let geomContour: GeometricContour;
    if (contour instanceof GeometricContour) {
      geomContour = contour;
    } else if (contour.segments && Array.isArray(contour.segments)) {
      const resurrected = contour.segments.map((s: any) => resurrectSegment(s));
      geomContour = new GeometricContour(contour.id ?? 'contour', resurrected, contour.isClosed ?? true);
    } else {
      geomContour = new GeometricContour('temp', [], false);
    }

    if (geomContour.segments.length > 0) {
      const poly = geomContour.toPolyline(16);
      vertexCount = poly.length;
      areaCm2 = Number(Math.abs(geomContour.signedArea()).toFixed(2));
      let peri = 0;
      for (const seg of geomContour.segments) {
        peri += seg.lengthCm();
      }
      perimeterCm = Number(peri.toFixed(2));
      isContourClosed = geomContour.isClosed;
    }
  }

  const widthCm = piece.boundingBox ? piece.boundingBox.widthCm : 0;
  const heightCm = piece.boundingBox ? piece.boundingBox.heightCm : 0;

  return {
    pieceId: piece.id,
    pieceCode: piece.pieceCode,
    pieceName: piece.name,
    widthCm,
    heightCm,
    areaCm2,
    perimeterCm,
    vertexCount,
    isContourClosed
  };
}

export interface GradedBodiceResult {
  pieces: PatternPiece[];
  metrics: GradedPieceMetrics[];
  errors: string[];
  warnings: string[];
}

/**
 * Grades bodice block panels (Front & Back) for target measurements using deterministic regeneration.
 * Never applies affine coordinate scaling; directly invokes the approved drafting engine
 * to satisfy classical tailoring constraints and exact apex tracking.
 */
export function gradeBodice(
  measurements: BodyMeasurements,
  designSpec: DesignSpecification,
  options?: BodiceDraftOptions
): GradedBodiceResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let pieces: PatternPiece[] = [];
  let metrics: GradedPieceMetrics[] = [];

  try {
    pieces = draftBodiceBlock(measurements, designSpec, options);
    metrics = pieces.map(p => computePieceMetrics(p));
  } catch (err: any) {
    errors.push(`Bodice grading failure: ${err?.message || String(err)}`);
  }

  return {
    pieces,
    metrics,
    errors,
    warnings
  };
}
