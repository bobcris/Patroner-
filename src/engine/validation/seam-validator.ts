/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PatternPiece, ValidationCheck, ValidationReport } from '../../types';
import { distance } from '../geometry/math';

export const SEAM_TOLERANCE_CM = 0.2; // Maximum allowable variance between paired seams (2mm)
export const DART_LEG_TOLERANCE_CM = 0.1; // Maximum leg length variance (1mm)

/**
 * Deterministically checks all geometric and construction parameters of drafted pattern pieces.
 * Never outputs a "Production Ready" stamp unless all critical checks pass.
 */
export function validatePatternDraft(pieces: PatternPiece[]): ValidationReport {
  const checks: ValidationCheck[] = [];
  const timestamp = new Date().toISOString();

  if (!pieces || pieces.length === 0) {
    return {
      isValid: false,
      isProductionReady: false,
      timestamp,
      overallScore: 0,
      checks: [
        {
          id: 'val-no-pieces',
          category: 'geometry',
          name: 'Piece Existence',
          status: 'fail',
          message: 'No pattern pieces generated in the current draft.'
        }
      ]
    };
  }

  // 1. Check piece codes and names
  pieces.forEach(piece => {
    if (!piece.pieceCode || !piece.name) {
      checks.push({
        id: `val-code-${piece.id}`,
        category: 'geometry',
        name: `Piece Identification: ${piece.name || piece.id}`,
        status: 'fail',
        message: 'Piece is missing a standardized identification code or name.'
      });
    } else {
      checks.push({
        id: `val-code-${piece.id}`,
        category: 'geometry',
        name: `Piece Identification: [${piece.pieceCode}] ${piece.name}`,
        status: 'pass',
        message: `Piece has valid identification code ${piece.pieceCode}.`
      });
    }
  });

  // 2. Check grainline integrity
  pieces.forEach(piece => {
    const gl = piece.grainline;
    if (!gl || !gl.start || !gl.end) {
      checks.push({
        id: `val-gl-${piece.id}`,
        category: 'grainline',
        name: `Grainline: ${piece.name}`,
        status: 'fail',
        message: 'Missing or corrupt grainline geometry.'
      });
    } else {
      const glLen = distance(gl.start, gl.end);
      if (glLen < 10) {
        checks.push({
          id: `val-gl-len-${piece.id}`,
          category: 'grainline',
          name: `Grainline Length: ${piece.name}`,
          status: 'warning',
          message: `Grainline is short (${glLen.toFixed(1)} cm). Minimum recommended is 15 cm for fabric alignment.`
        });
      } else {
        checks.push({
          id: `val-gl-${piece.id}`,
          category: 'grainline',
          name: `Grainline: ${piece.name}`,
          status: 'pass',
          message: `Grainline verified (${gl.direction}, ${glLen.toFixed(1)} cm length).`
        });
      }
    }
  });

  // 3. Check Dart Geometry & Leg Symmetry
  pieces.forEach(piece => {
    piece.darts.forEach(dart => {
      const leftLegLen = distance(dart.apex, dart.legLeft);
      const rightLegLen = distance(dart.apex, dart.legRight);
      const diff = Math.abs(leftLegLen - rightLegLen);

      if (diff > DART_LEG_TOLERANCE_CM) {
        checks.push({
          id: `val-dart-${dart.id}`,
          category: 'dart-closure',
          name: `Dart Leg Symmetry: ${piece.name} (${dart.id})`,
          status: 'fail',
          measuredValue: `Left: ${leftLegLen.toFixed(2)} cm, Right: ${rightLegLen.toFixed(2)} cm`,
          expectedValue: `Variance <= ${DART_LEG_TOLERANCE_CM} cm`,
          deviationCm: Number(diff.toFixed(2)),
          toleranceCm: DART_LEG_TOLERANCE_CM,
          message: `Dart legs are asymmetric by ${diff.toFixed(2)} cm. Seam will pucker upon sewing.`
        });
      } else {
        checks.push({
          id: `val-dart-${dart.id}`,
          category: 'dart-closure',
          name: `Dart Closure: ${piece.name} (${dart.id})`,
          status: 'pass',
          measuredValue: `Left: ${leftLegLen.toFixed(2)} cm, Right: ${rightLegLen.toFixed(2)} cm`,
          deviationCm: Number(diff.toFixed(2)),
          toleranceCm: DART_LEG_TOLERANCE_CM,
          message: `Dart legs match within tolerance (delta: ${diff.toFixed(2)} cm).`
        });
      }
    });
  });

  // 4. Paired Seam Length Comparisons (e.g. Front Side Seam vs Back Side Seam)
  const evaluatedPairs = new Set<string>();

  pieces.forEach(piece => {
    piece.seams.forEach(seam => {
      if (seam.pairedPieceId && seam.pairedSeamName) {
        const pairKey = [piece.id, seam.id, seam.pairedPieceId].sort().join('::');
        if (evaluatedPairs.has(pairKey)) return;
        evaluatedPairs.add(pairKey);

        const targetPiece = pieces.find(p => p.id === seam.pairedPieceId);
        if (!targetPiece) {
          checks.push({
            id: `val-seam-missing-${seam.id}`,
            category: 'seam-match',
            name: `Seam Compatibility: ${seam.name}`,
            status: 'fail',
            message: `Target paired piece "${seam.pairedPieceId}" could not be found in the current draft.`
          });
          return;
        }

        const pairedSeam = targetPiece.seams.find(s => s.name === seam.pairedSeamName);
        if (!pairedSeam) {
          checks.push({
            id: `val-seam-missing-paired-${seam.id}`,
            category: 'seam-match',
            name: `Seam Compatibility: ${seam.name} <-> ${seam.pairedSeamName}`,
            status: 'fail',
            message: `Paired seam "${seam.pairedSeamName}" does not exist on piece ${targetPiece.name}.`
          });
          return;
        }

        const delta = Math.abs(seam.lengthCm - pairedSeam.lengthCm);
        if (delta > SEAM_TOLERANCE_CM) {
          checks.push({
            id: `val-seam-diff-${seam.id}`,
            category: 'seam-match',
            name: `Seam Length Match: ${seam.name} vs ${pairedSeam.name}`,
            status: 'fail',
            measuredValue: `${seam.name}: ${seam.lengthCm.toFixed(2)} cm, ${pairedSeam.name}: ${pairedSeam.lengthCm.toFixed(2)} cm`,
            expectedValue: `Delta <= ${SEAM_TOLERANCE_CM} cm`,
            deviationCm: Number(delta.toFixed(2)),
            toleranceCm: SEAM_TOLERANCE_CM,
            message: `Seam length discrepancy of ${delta.toFixed(2)} cm exceeds manufacturing tolerance (${SEAM_TOLERANCE_CM} cm).`
          });
        } else {
          checks.push({
            id: `val-seam-match-${seam.id}`,
            category: 'seam-match',
            name: `Seam Length Match: ${seam.name} vs ${pairedSeam.name}`,
            status: 'pass',
            measuredValue: `${seam.name}: ${seam.lengthCm.toFixed(2)} cm, ${pairedSeam.name}: ${pairedSeam.lengthCm.toFixed(2)} cm`,
            deviationCm: Number(delta.toFixed(2)),
            toleranceCm: SEAM_TOLERANCE_CM,
            message: `Seams align perfectly (delta: ${delta.toFixed(2)} cm within ${SEAM_TOLERANCE_CM} cm tolerance).`
          });
        }
      }
    });
  });

  // 5. Seam Allowance Check
  pieces.forEach(piece => {
    if (piece.seamAllowanceWidthCm < 0.6) {
      checks.push({
        id: `val-sa-${piece.id}`,
        category: 'allowance',
        name: `Seam Allowance Width: ${piece.name}`,
        status: 'warning',
        message: `Seam allowance is very narrow (${piece.seamAllowanceWidthCm} cm). Standard industrial sewing requires >= 1.0 cm.`
      });
    } else {
      checks.push({
        id: `val-sa-${piece.id}`,
        category: 'allowance',
        name: `Seam Allowance: ${piece.name}`,
        status: 'pass',
        message: `Seam allowance verified at ${piece.seamAllowanceWidthCm} cm.`
      });
    }
  });

  const failureCount = checks.filter(c => c.status === 'fail').length;
  const warningCount = checks.filter(c => c.status === 'warning').length;
  const passCount = checks.filter(c => c.status === 'pass').length;

  const total = checks.length || 1;
  const overallScore = Math.max(0, Math.min(100, Math.round(((passCount + warningCount * 0.5) / total) * 100)));

  return {
    isValid: failureCount === 0,
    isProductionReady: failureCount === 0 && warningCount === 0,
    timestamp,
    overallScore,
    checks
  };
}
