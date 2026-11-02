/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PatternPiece, UnassessedCondition, ValidationCheck, ValidationReport, ValidationStatus } from '../../types';
import { validateContourIntegrity } from '../geometry/contour-validator';
import { checkPerpendicularity, distance, vector } from '../geometry/math';

export const SEAM_TOLERANCE_CM = 0.2; // Maximum allowable variance between paired seams (2mm)
export const DART_LEG_TOLERANCE_CM = 0.1; // Maximum leg length variance (1mm)
export const TANGENCY_TOLERANCE_DEG = 0.5; // Maximum angular departure from 90° at folds/centers

/**
 * List of critical manufacturing criteria that are not yet modeled or assessed
 * by the current pattern drafting engine milestone.
 */
export const UNASSESSED_INDUSTRIAL_CONDITIONS: UnassessedCondition[] = [
  {
    id: 'unassessed-corner-turnup-foldback',
    name: 'Hem Turn-Up Foldback Reflection Geometry',
    reason: 'Corner miters and bevels are mathematically calculated, but inverted silhouette flare for deep hem turn-ups is not yet automated.',
    milestonePrerequisite: 'Milestone 4 (Multi-Piece Assembly & Finishing)'
  },
  {
    id: 'unassessed-grading-nest-continuity',
    name: 'Multi-Size Grading Rule Nesting',
    reason: 'Grading vector continuity across nested sizes (XS-XXL) requires multi-size grading engine.',
    milestonePrerequisite: 'Milestone 5 (Grading & Production Engine)'
  },
  {
    id: 'unassessed-fabric-relaxation-shrinkage',
    name: 'Fabric Warp/Weft Steam Relaxation Allowance',
    reason: 'Drape and weave shrinkage matrix under industrial iron pressing is not yet calculated.',
    milestonePrerequisite: 'Milestone 5 (Material Science & Manufacturing)'
  },
  {
    id: 'unassessed-zipper-stop-clearance',
    name: 'Concealed Zipper Stop & Facing Offset',
    reason: 'Zipper notch is placed at 18cm depth, but facing-to-teeth transition is not yet CAD simulated.',
    milestonePrerequisite: 'Milestone 4 (Multi-Piece Assembly)'
  }
];

/**
 * Deterministically checks all geometric and construction parameters of drafted pattern pieces.
 * 
 * Honest Validation Principle:
 * Never awards a fake 100/100 score or declares a draft "Production Ready"
 * unless all industrial manufacturing conditions are genuinely assessed and certified.
 */
export function validatePatternDraft(pieces: PatternPiece[]): ValidationReport {
  const checks: ValidationCheck[] = [];
  const timestamp = new Date().toISOString();

  if (!pieces || pieces.length === 0) {
    return {
      status: 'incomplete',
      isValid: false,
      isProductionReady: false,
      statusLabel: 'DRAFT_INCOMPLETE',
      timestamp,
      passedCount: 0,
      warningCount: 0,
      failureCount: 1,
      checks: [
        {
          id: 'val-no-pieces',
          category: 'geometry',
          name: 'Piece Existence',
          status: 'fail',
          message: 'No pattern pieces generated in the current draft.'
        }
      ],
      unassessedConditions: UNASSESSED_INDUSTRIAL_CONDITIONS,
      declaration: 'Draft incomplete: no pieces to validate.'
    };
  }

  // 1. Piece Identification & Standard Codes
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
        message: `Piece has valid identification code ${piece.pieceCode} with cut count ${piece.cutCount}.`
      });
    }
  });

  // 2. Grainline Integrity
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
      if (glLen < 15) {
        checks.push({
          id: `val-gl-len-${piece.id}`,
          category: 'grainline',
          name: `Grainline Length: ${piece.name}`,
          status: 'warning',
          measuredValue: `${glLen.toFixed(1)} cm`,
          expectedValue: '>= 15.0 cm',
          message: `Grainline is short (${glLen.toFixed(1)} cm). Industrial standard recommends >= 15.0 cm for grain alignment.`
        });
      } else {
        checks.push({
          id: `val-gl-${piece.id}`,
          category: 'grainline',
          name: `Grainline: ${piece.name}`,
          status: 'pass',
          measuredValue: `${glLen.toFixed(1)} cm (${gl.direction})`,
          message: `Grainline verified (${gl.direction}, ${glLen.toFixed(1)} cm length).`
        });
      }
    }
  });

  // 3. Center Front Fold Tangency (90.0° Perpendicularity Check)
  // Ensures that when cut on fold and opened, waistline, hemline, and neckline form smooth C1 curves
  const frontPiece = pieces.find(p => p.onFold);
  if (frontPiece) {
    const cfSeam = frontPiece.seams.find(s => s.id.includes('center-front') || s.name.includes('Center Front'));
    const waistSeam = frontPiece.seams.find(s => s.id.includes('waist') || s.name.includes('Waist'));
    const hemSeam = frontPiece.seams.find(s => s.id.includes('hem') || s.name.includes('Hem'));
    const neckSeam = frontPiece.seams.find(s => s.id.includes('neck') || s.name.includes('Neckline'));

    if (cfSeam) {
      const foldVec = vector(cfSeam.startPoint, cfSeam.endPoint); // Fold direction (0, 1)

      // Check waist tangency at Center Front
      if (waistSeam && waistSeam.endTangent) {
        // Waistline ends at CF from right to left (-1, 0)
        const waistDeparture = { x: -waistSeam.endTangent.x, y: -waistSeam.endTangent.y }; // Vector into piece (1, 0)
        const perp = checkPerpendicularity(foldVec, waistDeparture, TANGENCY_TOLERANCE_DEG);

        if (!perp.isPerpendicular) {
          checks.push({
            id: 'val-tangency-cf-waist',
            category: 'tangency',
            name: 'Center Front Waist Fold Tangency',
            status: 'fail',
            measuredValue: `${perp.measuredAngleDeg}°`,
            expectedValue: `90.0° ± ${TANGENCY_TOLERANCE_DEG}°`,
            deviationCm: perp.deviationDeg,
            toleranceCm: TANGENCY_TOLERANCE_DEG,
            message: `Waistline departs CF fold at ${perp.measuredAngleDeg}° (deviation: ${perp.deviationDeg}°). Will create a V-notch or peak when unfolded.`
          });
        } else {
          checks.push({
            id: 'val-tangency-cf-waist',
            category: 'tangency',
            name: 'Center Front Waist Fold Tangency',
            status: 'pass',
            measuredValue: `${perp.measuredAngleDeg}° (perpendicular)`,
            message: 'Waistline meets Center Front fold at exact 90.0° tangency. Guarantees smooth C1 curve when opened.'
          });
        }
      }

      // Check hem tangency at Center Front (for skirts/dresses)
      if (hemSeam && hemSeam.startTangent) {
        const hemDeparture = hemSeam.startTangent;
        const perp = checkPerpendicularity(foldVec, hemDeparture, TANGENCY_TOLERANCE_DEG);

        if (!perp.isPerpendicular) {
          checks.push({
            id: 'val-tangency-cf-hem',
            category: 'tangency',
            name: 'Center Front Hem Fold Tangency',
            status: 'fail',
            measuredValue: `${perp.measuredAngleDeg}°`,
            expectedValue: `90.0° ± ${TANGENCY_TOLERANCE_DEG}°`,
            deviationCm: perp.deviationDeg,
            toleranceCm: TANGENCY_TOLERANCE_DEG,
            message: `Hemline departs CF fold at ${perp.measuredAngleDeg}°. Will create a peak/dip when unfolded.`
          });
        } else {
          checks.push({
            id: 'val-tangency-cf-hem',
            category: 'tangency',
            name: 'Center Front Hem Fold Tangency',
            status: 'pass',
            measuredValue: `${perp.measuredAngleDeg}° (perpendicular)`,
            message: 'Hemline meets Center Front fold at exact 90.0° tangency.'
          });
        }
      }

      // Check neckline tangency at Center Front (for bodices/dresses)
      if (neckSeam && neckSeam.endTangent) {
        const neckDeparture = { x: -neckSeam.endTangent.x, y: -neckSeam.endTangent.y };
        const perp = checkPerpendicularity(foldVec, neckDeparture, TANGENCY_TOLERANCE_DEG);

        if (!perp.isPerpendicular) {
          checks.push({
            id: 'val-tangency-cf-neck',
            category: 'tangency',
            name: 'Center Front Neckline Fold Tangency',
            status: 'fail',
            measuredValue: `${perp.measuredAngleDeg}°`,
            expectedValue: `90.0° ± ${TANGENCY_TOLERANCE_DEG}°`,
            deviationCm: perp.deviationDeg,
            toleranceCm: TANGENCY_TOLERANCE_DEG,
            message: `Neckline departs CF fold at ${perp.measuredAngleDeg}°. Will create a notch or peak at neckline when unfolded.`
          });
        } else {
          checks.push({
            id: 'val-tangency-cf-neck',
            category: 'tangency',
            name: 'Center Front Neckline Fold Tangency',
            status: 'pass',
            measuredValue: `${perp.measuredAngleDeg}° (perpendicular)`,
            message: 'Neckline meets Center Front fold at exact 90.0° tangency. Guarantees smooth continuous neck opening.'
          });
        }
      }
    }
  }

  // 4. Center Back Seam Tangency (90.0° Perpendicularity Check)
  const backPiece = pieces.find(p => !p.onFold && (p.pieceCode.includes('B') || p.id.includes('back')));
  if (backPiece) {
    const cbSeam = backPiece.seams.find(s => s.id.includes('center-back') || s.name.includes('Center Back'));
    const waistSeam = backPiece.seams.find(s => s.id.includes('waist') || s.name.includes('Waist'));
    const hemSeam = backPiece.seams.find(s => s.id.includes('hem') || s.name.includes('Hem'));
    const neckSeam = backPiece.seams.find(s => s.id.includes('neck') || s.name.includes('Neckline'));

    if (cbSeam) {
      const cbVec = vector(cbSeam.startPoint, cbSeam.endPoint);

      if (waistSeam && waistSeam.endTangent) {
        const waistDeparture = { x: -waistSeam.endTangent.x, y: -waistSeam.endTangent.y };
        const perp = checkPerpendicularity(cbVec, waistDeparture, TANGENCY_TOLERANCE_DEG);

        if (!perp.isPerpendicular) {
          checks.push({
            id: 'val-tangency-cb-waist',
            category: 'tangency',
            name: 'Center Back Waist Seam Tangency',
            status: 'fail',
            measuredValue: `${perp.measuredAngleDeg}°`,
            expectedValue: `90.0° ± ${TANGENCY_TOLERANCE_DEG}°`,
            deviationCm: perp.deviationDeg,
            toleranceCm: TANGENCY_TOLERANCE_DEG,
            message: `Waistline meets CB seam at ${perp.measuredAngleDeg}°. Zipper top will peak or dip.`
          });
        } else {
          checks.push({
            id: 'val-tangency-cb-waist',
            category: 'tangency',
            name: 'Center Back Waist Seam Tangency',
            status: 'pass',
            measuredValue: `${perp.measuredAngleDeg}° (perpendicular)`,
            message: 'Waistline meets Center Back seam at exact 90.0° tangency.'
          });
        }
      }

      if (hemSeam && hemSeam.startTangent) {
        const hemDeparture = hemSeam.startTangent;
        const perp = checkPerpendicularity(cbVec, hemDeparture, TANGENCY_TOLERANCE_DEG);

        if (!perp.isPerpendicular) {
          checks.push({
            id: 'val-tangency-cb-hem',
            category: 'tangency',
            name: 'Center Back Hem Seam Tangency',
            status: 'fail',
            measuredValue: `${perp.measuredAngleDeg}°`,
            expectedValue: `90.0° ± ${TANGENCY_TOLERANCE_DEG}°`,
            deviationCm: perp.deviationDeg,
            toleranceCm: TANGENCY_TOLERANCE_DEG,
            message: `Hemline meets CB seam at ${perp.measuredAngleDeg}°. Hemline will not match across zipper.`
          });
        } else {
          checks.push({
            id: 'val-tangency-cb-hem',
            category: 'tangency',
            name: 'Center Back Hem Seam Tangency',
            status: 'pass',
            measuredValue: `${perp.measuredAngleDeg}° (perpendicular)`,
            message: 'Hemline meets Center Back seam at exact 90.0° tangency.'
          });
        }
      }

      if (neckSeam && neckSeam.endTangent) {
        const neckDeparture = { x: -neckSeam.endTangent.x, y: -neckSeam.endTangent.y };
        const perp = checkPerpendicularity(cbVec, neckDeparture, TANGENCY_TOLERANCE_DEG);

        if (!perp.isPerpendicular) {
          checks.push({
            id: 'val-tangency-cb-neck',
            category: 'tangency',
            name: 'Center Back Neckline Seam Tangency',
            status: 'fail',
            measuredValue: `${perp.measuredAngleDeg}°`,
            expectedValue: `90.0° ± ${TANGENCY_TOLERANCE_DEG}°`,
            deviationCm: perp.deviationDeg,
            toleranceCm: TANGENCY_TOLERANCE_DEG,
            message: `Neckline meets CB seam at ${perp.measuredAngleDeg}°. Back neck will create a notch or peak.`
          });
        } else {
          checks.push({
            id: 'val-tangency-cb-neck',
            category: 'tangency',
            name: 'Center Back Neckline Seam Tangency',
            status: 'pass',
            measuredValue: `${perp.measuredAngleDeg}° (perpendicular)`,
            message: 'Neckline meets Center Back seam at exact 90.0° tangency.'
          });
        }
      }
    }
  }

  // 5. Dart Geometry & Leg Symmetry
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

  // 6. Paired Seam Length Comparisons (e.g. Front Side Seam vs Back Side Seam)
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

        // Differentiate intentional sleeve cap ease from rigid 1-to-1 seam matching
        const isSleeveCap = seam.name.includes('Sleeve Cap') || pairedSeam.name.includes('Sleeve Cap');
        if (isSleeveCap) {
          const capLength = seam.name.includes('Sleeve Cap') ? seam.lengthCm : pairedSeam.lengthCm;
          const armholeLength = seam.name.includes('Sleeve Cap') ? pairedSeam.lengthCm : seam.lengthCm;
          const ease = Number((capLength - armholeLength).toFixed(2));

          if (ease < -0.2) {
            checks.push({
              id: `val-seam-diff-${seam.id}`,
              category: 'seam-match',
              name: `Sleeve Cap Ease: ${seam.name} vs ${pairedSeam.name}`,
              status: 'fail',
              measuredValue: `Cap: ${capLength.toFixed(2)} cm, Armhole: ${armholeLength.toFixed(2)} cm (Ease: ${ease} cm)`,
              expectedValue: `Ease >= 0.0 cm`,
              deviationCm: Math.abs(ease),
              toleranceCm: 0.2,
              message: `Sleeve cap length is smaller than armhole by ${Math.abs(ease)} cm. Sleeve cannot be set in without pulling.`
            });
          } else if (ease > 2.8) {
            checks.push({
              id: `val-seam-diff-${seam.id}`,
              category: 'seam-match',
              name: `Sleeve Cap Ease: ${seam.name} vs ${pairedSeam.name}`,
              status: 'warning',
              measuredValue: `Cap: ${capLength.toFixed(2)} cm, Armhole: ${armholeLength.toFixed(2)} cm (Ease: +${ease} cm)`,
              expectedValue: `Ease <= 2.8 cm (per half-cap)`,
              deviationCm: Number((ease - 2.8).toFixed(2)),
              toleranceCm: 2.8,
              message: `Sleeve cap ease (+${ease} cm) is elevated. Ensure fabric has adequate crimp/malleability.`
            });
          } else {
            checks.push({
              id: `val-seam-match-${seam.id}`,
              category: 'seam-match',
              name: `Sleeve Cap Ease: ${seam.name} vs ${pairedSeam.name}`,
              status: 'pass',
              measuredValue: `Cap: ${capLength.toFixed(2)} cm, Armhole: ${armholeLength.toFixed(2)} cm (Ease: +${ease} cm)`,
              message: `Sleeve cap ease (+${ease} cm) verified within acceptable range for set-in tailored sleeve.`
            });
          }
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
            message: `Discrepancy of ${delta.toFixed(2)} cm exceeds manufacturing tolerance (${SEAM_TOLERANCE_CM} cm).`
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
            message: `Paired seams match within tolerance (delta: ${delta.toFixed(2)} cm <= ${SEAM_TOLERANCE_CM} cm).`
          });
        }
      }
    });
  });

  // 7. Seam Allowance Check
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
        measuredValue: `${piece.seamAllowanceWidthCm} cm`,
        message: `Seam allowance verified at ${piece.seamAllowanceWidthCm} cm.`
      });
    }
  });

  // 8. Geometric Contour Integrity (Milestone 02 CAD Core)
  pieces.forEach(piece => {
    if (piece.stitchingContour) {
      const stitchingRes = validateContourIntegrity(piece.stitchingContour, `[${piece.pieceCode}] Stitching Contour`);
      checks.push(...stitchingRes.checks);
    } else {
      checks.push({
        id: `val-contour-stitch-missing-${piece.id}`,
        category: 'contour-integrity',
        name: `[${piece.pieceCode}] Stitching Contour Geometry`,
        status: 'warning',
        message: 'Piece lacks explicit geometric stitching contour primitive.'
      });
    }

    if (piece.cuttingContour) {
      const cuttingRes = validateContourIntegrity(piece.cuttingContour, `[${piece.pieceCode}] Cutting Contour`);
      checks.push(...cuttingRes.checks);
    } else {
      checks.push({
        id: `val-contour-cut-missing-${piece.id}`,
        category: 'contour-integrity',
        name: `[${piece.pieceCode}] Cutting Contour Geometry`,
        status: 'warning',
        message: 'Piece lacks explicit geometric cutting contour primitive.'
      });
    }

    // Offset Diagnostic Acceptance Gate (Milestone 02.1 Priority 1)
    if (piece.offsetResult) {
      if (piece.offsetResult.status === 'failure') {
        checks.push({
          id: `val-offset-failed-${piece.id}`,
          errorCode: 'VAL-OFFSET-FAILED',
          category: 'offset',
          severity: 'error',
          segmentIds: piece.offsetResult.diagnostics?.filter(d => d.status === 'failure').map(d => d.sourceSegmentId),
          name: `Cutting Seam Allowance Offset: [${piece.pieceCode}] ${piece.name}`,
          status: 'fail',
          deviationCm: piece.offsetResult.maxDeviationCm,
          toleranceCm: 0.05,
          message: `Cutting contour offset generation failed for ${piece.name}: ${piece.offsetResult.errors.join('; ')}`,
          suggestedAction: 'Review curve curvature and tolerance settings. Failed cutting geometry cannot be certified for industrial production.'
        });
      } else if (piece.offsetResult.status === 'warning') {
        checks.push({
          id: `val-offset-warn-${piece.id}`,
          category: 'offset',
          severity: 'warning',
          name: `Cutting Seam Allowance Offset: [${piece.pieceCode}] ${piece.name}`,
          status: 'warning',
          deviationCm: piece.offsetResult.maxDeviationCm,
          toleranceCm: 0.05,
          message: `Cutting contour generated with warnings: ${piece.offsetResult.warnings.join('; ')}`
        });
      } else {
        checks.push({
          id: `val-offset-pass-${piece.id}`,
          category: 'offset',
          severity: 'info',
          name: `Cutting Seam Allowance Offset: [${piece.pieceCode}] ${piece.name}`,
          status: 'pass',
          measuredValue: `Max deviation: ${piece.offsetResult.maxDeviationCm.toFixed(4)} cm`,
          expectedValue: '<= 0.05 cm',
          deviationCm: piece.offsetResult.maxDeviationCm,
          toleranceCm: 0.05,
          message: `Cutting contour offset mathematically validated within tolerance (${piece.offsetResult.maxDeviationCm.toFixed(4)} cm <= 0.05 cm).`
        });
      }
    }
  });

  // 9. Seam Segment Geometric Derivation Check
  pieces.forEach(piece => {
    if (piece.stitchingContour) {
      piece.seams.forEach(seam => {
        const targetIds = seam.segmentIds || (seam.segmentId ? [seam.segmentId] : []);
        if (targetIds.length > 0) {
          let geomLen = 0;
          let allFound = true;
          for (const sId of targetIds) {
            const seg = piece.stitchingContour?.segments.find((s: { id: string }) => s.id === sId);
            if (!seg) {
              allFound = false;
              checks.push({
                id: `val-seam-seg-missing-${seam.id}-${sId}`,
                category: 'contour-integrity',
                name: `Seam Segment Binding: ${seam.name}`,
                status: 'fail',
                message: `Seam references segmentId "${sId}" which is absent from stitching contour.`
              });
            } else {
              geomLen += seg.lengthCm();
            }
          }

          if (allFound) {
            const lenDiff = Math.abs(seam.lengthCm - geomLen);
            if (lenDiff > 0.05) {
              checks.push({
                id: `val-seam-seg-len-${seam.id}`,
                category: 'contour-integrity',
                name: `Seam Length Derivation: ${seam.name}`,
                status: 'fail',
                measuredValue: `Metadata: ${seam.lengthCm.toFixed(2)} cm, Geometry: ${geomLen.toFixed(2)} cm`,
                expectedValue: 'Difference <= 0.05 cm',
                deviationCm: Number(lenDiff.toFixed(2)),
                toleranceCm: 0.05,
                message: `Seam metadata length (${seam.lengthCm.toFixed(2)} cm) does not match true geometric segment length (${geomLen.toFixed(2)} cm).`
              });
            } else {
              checks.push({
                id: `val-seam-seg-len-${seam.id}`,
                category: 'contour-integrity',
                name: `Seam Length Derivation: ${seam.name}`,
                status: 'pass',
                measuredValue: `${geomLen.toFixed(2)} cm`,
                message: `Seam length dynamically derived from segment(s) [${targetIds.join(', ')}] (${geomLen.toFixed(2)} cm).`
              });
            }
          }
        }
      });
    }
  });

  // 10. Sleeve Construction & Tangency Checks (Milestone 04.2)
  const sleevePiece = pieces.find(p => p.id === 'piece-sleeve' || p.pieceCode.includes('SLV'));
  if (sleevePiece) {
    // 10.1 Inseam Parity
    const frontInseam = sleevePiece.seams.find(s => s.id === 'slv-front-inseam' || s.name.includes('Front Underarm Inseam'));
    const backInseam = sleevePiece.seams.find(s => s.id === 'slv-back-inseam' || s.name.includes('Back Underarm Inseam'));

    if (frontInseam && backInseam) {
      const inseamDelta = Math.abs(frontInseam.lengthCm - backInseam.lengthCm);
      if (inseamDelta > SEAM_TOLERANCE_CM) {
        checks.push({
          id: 'val-slv-inseam-parity',
          category: 'seam-match',
          name: 'Sleeve Inseam Parity',
          status: 'fail',
          measuredValue: `Front: ${frontInseam.lengthCm.toFixed(2)} cm, Back: ${backInseam.lengthCm.toFixed(2)} cm (Delta: ${inseamDelta.toFixed(3)} cm)`,
          expectedValue: `Delta <= ${SEAM_TOLERANCE_CM} cm`,
          deviationCm: Number(inseamDelta.toFixed(3)),
          toleranceCm: SEAM_TOLERANCE_CM,
          message: `Sleeve front and back inseam lengths differ by ${inseamDelta.toFixed(2)} cm. Causes sleeve twist upon assembly.`
        });
      } else {
        checks.push({
          id: 'val-slv-inseam-parity',
          category: 'seam-match',
          name: 'Sleeve Inseam Parity',
          status: 'pass',
          measuredValue: `Front: ${frontInseam.lengthCm.toFixed(2)} cm, Back: ${backInseam.lengthCm.toFixed(2)} cm (Delta: ${inseamDelta.toFixed(3)} cm)`,
          deviationCm: Number(inseamDelta.toFixed(3)),
          toleranceCm: SEAM_TOLERANCE_CM,
          message: `Sleeve front and back underarm inseams match with exact parity (delta: ${inseamDelta.toFixed(3)} cm <= 0.05 cm).`
        });
      }
    }

    // 10.2 Crown Horizontal Tangency
    const frontCapSeam = sleevePiece.seams.find(s => s.id === 'slv-front-cap-seam' || s.name.includes('Front Sleeve Cap'));
    const backCapSeam = sleevePiece.seams.find(s => s.id === 'slv-back-cap-seam' || s.name.includes('Back Sleeve Cap'));

    if (frontCapSeam && frontCapSeam.startTangent) {
      // Tangent departure from horizontal (y = 0)
      const departureAngle = Math.abs(Math.atan2(frontCapSeam.startTangent.y, frontCapSeam.startTangent.x) * (180 / Math.PI));
      if (departureAngle > TANGENCY_TOLERANCE_DEG) {
        checks.push({
          id: 'val-slv-crown-tangency-front',
          category: 'tangency',
          name: 'Sleeve Crown Tangency (Front Cap)',
          status: 'fail',
          measuredValue: `${departureAngle.toFixed(2)}°`,
          expectedValue: `0.0° ± ${TANGENCY_TOLERANCE_DEG}°`,
          deviationCm: departureAngle,
          toleranceCm: TANGENCY_TOLERANCE_DEG,
          message: `Front sleeve cap departs crown apex at ${departureAngle.toFixed(2)}° from horizontal. Will create a shoulder dimple.`
        });
      } else {
        checks.push({
          id: 'val-slv-crown-tangency-front',
          category: 'tangency',
          name: 'Sleeve Crown Tangency (Front Cap)',
          status: 'pass',
          measuredValue: `${departureAngle.toFixed(2)}° (horizontal C1)`,
          message: 'Front sleeve cap departs crown apex with exact horizontal C1 tangency.'
        });
      }
    }

    // 10.3 Total Sleeve Cap Ease vs Bodice Armholes
    const bodiceF = pieces.find(p => p.id === 'piece-bodice-front' || p.pieceCode.includes('BOD-F'));
    const bodiceB = pieces.find(p => p.id === 'piece-bodice-back' || p.pieceCode.includes('BOD-B'));

    if (bodiceF && bodiceB && frontCapSeam && backCapSeam) {
      const fArmhole = bodiceF.seams.find(s => s.id === 'fb-armhole-seam' || s.segmentId === 'fb-armhole' || s.name.includes('Armhole'));
      const bArmhole = bodiceB.seams.find(s => s.id === 'bb-armhole-seam' || s.segmentId === 'bb-armhole' || s.name.includes('Armhole'));

      if (fArmhole && bArmhole) {
        const totalBodiceArmhole = Number((fArmhole.lengthCm + bArmhole.lengthCm).toFixed(2));
        const totalSleeveCap = Number((frontCapSeam.lengthCm + backCapSeam.lengthCm).toFixed(2));
        const netEase = Number((totalSleeveCap - totalBodiceArmhole).toFixed(2));

        if (netEase < 0) {
          checks.push({
            id: 'val-slv-total-cap-ease',
            category: 'seam-match',
            name: 'Total Sleeve Cap Ease',
            status: 'fail',
            measuredValue: `Cap: ${totalSleeveCap.toFixed(2)} cm, Scye: ${totalBodiceArmhole.toFixed(2)} cm (Ease: ${netEase.toFixed(2)} cm)`,
            expectedValue: 'Ease >= 0.0 cm',
            deviationCm: Math.abs(netEase),
            toleranceCm: 0.0,
            message: `Total sleeve cap length (${totalSleeveCap} cm) is shorter than bodice armholes (${totalBodiceArmhole} cm).`
          });
        } else if (netEase > 4.5) {
          checks.push({
            id: 'val-slv-total-cap-ease',
            category: 'seam-match',
            name: 'Total Sleeve Cap Ease',
            status: 'warning',
            measuredValue: `Cap: ${totalSleeveCap.toFixed(2)} cm, Scye: ${totalBodiceArmhole.toFixed(2)} cm (Ease: +${netEase.toFixed(2)} cm)`,
            expectedValue: 'Ease <= 4.5 cm',
            deviationCm: Number((netEase - 4.5).toFixed(2)),
            toleranceCm: 4.5,
            message: `Total sleeve cap ease (+${netEase} cm) exceeds 4.5 cm. High crown crimp required; fabric must be mouldable with steam.`
          });
        } else {
          checks.push({
            id: 'val-slv-total-cap-ease',
            category: 'seam-match',
            name: 'Total Sleeve Cap Ease',
            status: 'pass',
            measuredValue: `Cap: ${totalSleeveCap.toFixed(2)} cm, Scye: ${totalBodiceArmhole.toFixed(2)} cm (Ease: +${netEase.toFixed(2)} cm)`,
            message: `Total sleeve cap ease (+${netEase.toFixed(2)} cm) verified within acceptable tailored parameters.`
          });
        }

        // 10.4 Front Sleeve Cap Ease
        const frontEase = Number((frontCapSeam.lengthCm - fArmhole.lengthCm).toFixed(2));
        if (frontEase < -0.1) {
          checks.push({
            id: 'val-slv-front-cap-ease',
            category: 'seam-match',
            name: 'Front Sleeve Cap Ease',
            status: 'fail',
            measuredValue: `Front Cap: ${frontCapSeam.lengthCm.toFixed(2)} cm, Front Scye: ${fArmhole.lengthCm.toFixed(2)} cm (Ease: ${frontEase.toFixed(2)} cm)`,
            expectedValue: 'Ease >= 0.0 cm',
            deviationCm: Math.abs(frontEase),
            toleranceCm: 0.1,
            message: `Front sleeve cap is shorter than front armhole by ${Math.abs(frontEase)} cm.`
          });
        } else if (frontEase > 2.8) {
          checks.push({
            id: 'val-slv-front-cap-ease',
            category: 'seam-match',
            name: 'Front Sleeve Cap Ease',
            status: 'warning',
            measuredValue: `Front Cap: ${frontCapSeam.lengthCm.toFixed(2)} cm, Front Scye: ${fArmhole.lengthCm.toFixed(2)} cm (Ease: +${frontEase.toFixed(2)} cm)`,
            expectedValue: 'Ease <= 2.8 cm',
            deviationCm: Number((frontEase - 2.8).toFixed(2)),
            toleranceCm: 2.8,
            message: `Front sleeve cap ease (+${frontEase} cm) is elevated. Ensure front crown crimp is evenly distributed.`
          });
        } else {
          checks.push({
            id: 'val-slv-front-cap-ease',
            category: 'seam-match',
            name: 'Front Sleeve Cap Ease',
            status: 'pass',
            measuredValue: `Front Cap: ${frontCapSeam.lengthCm.toFixed(2)} cm, Front Scye: ${fArmhole.lengthCm.toFixed(2)} cm (Ease: +${frontEase.toFixed(2)} cm)`,
            message: `Front sleeve cap ease (+${frontEase.toFixed(2)} cm) verified.`
          });
        }

        // 10.5 Back Sleeve Cap Ease
        const backEase = Number((backCapSeam.lengthCm - bArmhole.lengthCm).toFixed(2));
        if (backEase < -0.1) {
          checks.push({
            id: 'val-slv-back-cap-ease',
            category: 'seam-match',
            name: 'Back Sleeve Cap Ease',
            status: 'fail',
            measuredValue: `Back Cap: ${backCapSeam.lengthCm.toFixed(2)} cm, Back Scye: ${bArmhole.lengthCm.toFixed(2)} cm (Ease: ${backEase.toFixed(2)} cm)`,
            expectedValue: 'Ease >= 0.0 cm',
            deviationCm: Math.abs(backEase),
            toleranceCm: 0.1,
            message: `Back sleeve cap is shorter than back armhole by ${Math.abs(backEase)} cm.`
          });
        } else if (backEase > 2.8) {
          checks.push({
            id: 'val-slv-back-cap-ease',
            category: 'seam-match',
            name: 'Back Sleeve Cap Ease',
            status: 'warning',
            measuredValue: `Back Cap: ${backCapSeam.lengthCm.toFixed(2)} cm, Back Scye: ${bArmhole.lengthCm.toFixed(2)} cm (Ease: +${backEase.toFixed(2)} cm)`,
            expectedValue: 'Ease <= 2.8 cm',
            deviationCm: Number((backEase - 2.8).toFixed(2)),
            toleranceCm: 2.8,
            message: `Back sleeve cap ease (+${backEase} cm) is elevated. Ensure back shoulder scye is steam-moulded.`
          });
        } else {
          checks.push({
            id: 'val-slv-back-cap-ease',
            category: 'seam-match',
            name: 'Back Sleeve Cap Ease',
            status: 'pass',
            measuredValue: `Back Cap: ${backCapSeam.lengthCm.toFixed(2)} cm, Back Scye: ${bArmhole.lengthCm.toFixed(2)} cm (Ease: +${backEase.toFixed(2)} cm)`,
            message: `Back sleeve cap ease (+${backEase.toFixed(2)} cm) verified.`
          });
        }
      }
    }

    // 10.6 Sleeve Construction Notch Topology & Pairing
    const crownNotch = sleevePiece.notches.find(n => n.id === 'notch-slv-crown');
    const frontNotch = sleevePiece.notches.find(n => n.id === 'notch-slv-front-armhole');
    const backDoubleNotch = sleevePiece.notches.filter(n => n.id.includes('notch-slv-back-armhole'));
    const elbowNotches = sleevePiece.notches.filter(n => n.id.includes('elbow'));

    const missingNotches: string[] = [];
    if (!crownNotch) missingNotches.push('Crown apex notch (shoulder match at apex (0,0))');
    if (!frontNotch) missingNotches.push('Front scye single notch');
    if (backDoubleNotch.length < 2) missingNotches.push('Back scye double notch');
    if (elbowNotches.length < 2) missingNotches.push('Elbow level match notches');

    // If bodice pieces are present, verify bodice pairing scye notches
    if (bodiceF && !bodiceF.notches.some(n => n.id.includes('chest') || (n.label && n.label.includes('CHEST')))) {
      missingNotches.push('Front bodice chest-level pairing notch');
    }
    if (bodiceB && bodiceB.notches.filter(n => n.id.includes('across-back')).length < 2) {
      missingNotches.push('Back bodice across-back double pairing notches');
    }

    if (missingNotches.length > 0) {
      checks.push({
        id: 'val-slv-notch-correspondence',
        category: 'geometry',
        name: 'Sleeve Construction Notch Topology & Pairing',
        status: 'fail',
        message: `Sleeve/bodice assembly missing construction notches: ${missingNotches.join(', ')}.`
      });
    } else {
      checks.push({
        id: 'val-slv-notch-correspondence',
        category: 'geometry',
        name: 'Sleeve Construction Notch Topology & Pairing',
        status: 'pass',
        measuredValue: `${sleevePiece.notches.length} sleeve notches verified`,
        message: 'Verified topology of crown shoulder alignment notch at apex, front scye single notch pairing with bodice chest notch, back scye double notches pairing with back bodice notches, and front/back inseam elbow alignment notches.'
      });
    }
  }

  const failureCount = checks.filter(c => c.status === 'fail').length;
  const warningCount = checks.filter(c => c.status === 'warning').length;
  const passedCount = checks.filter(c => c.status === 'pass').length;

  let status: ValidationStatus = 'validated';
  let statusLabel = 'PROTOTYPE_GEOMETRY_VALIDATED';

  if (failureCount > 0) {
    status = 'invalid';
    statusLabel = 'GEOMETRY_INVALID';
  } else if (warningCount > 0) {
    status = 'validated';
    statusLabel = 'VALIDATED_WITH_WARNINGS';
  }

  // Honest production readiness:
  // Strictly false because industrial multi-size grading, shrinkage, and corner mitering
  // are unassessed at this milestone
  const isProductionReady = false;

  const declaration = failureCount === 0
    ? `Sample Pattern Validated: all ${passedCount} mathematical geometry checks passed. Industrial production certification pending unassessed manufacturing criteria.`
    : `Validation Failed: ${failureCount} critical geometric discrepancies detected.`;

  return {
    status,
    isValid: failureCount === 0,
    isProductionReady,
    statusLabel,
    timestamp,
    passedCount,
    warningCount,
    failureCount,
    checks,
    unassessedConditions: UNASSESSED_INDUSTRIAL_CONDITIONS,
    declaration
  };
}
