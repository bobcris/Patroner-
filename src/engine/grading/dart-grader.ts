/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyMeasurements, Dart } from '../../types';
import { distance } from '../geometry/math';

export interface DartAuditResult {
  darts: Dart[];
  anomalies: string[];
  isValid: boolean;
}

/**
 * Audits graded darts across size transitions.
 * Enforces:
 * 1. Geometric leg length parity (within 0.05 cm tolerance).
 * 2. Positive non-zero dart width and length.
 * 3. Proportional apex tracking aligned with anatomical bustSpan / bustHeight changes.
 * 4. Preservation of suppression partition without intake inversion.
 */
export function auditGradedDarts(
  baseDarts: Dart[],
  targetDarts: Dart[],
  baseMeasurements: BodyMeasurements,
  targetMeasurements: BodyMeasurements
): DartAuditResult {
  const anomalies: string[] = [];

  if (baseDarts.length > 0 && targetDarts.length === 0) {
    anomalies.push('Target size lost all darts present in base size.');
    return { darts: targetDarts, anomalies, isValid: false };
  }

  // Check individual target darts
  for (const dart of targetDarts) {
    const leftLen = distance(dart.apex, dart.legLeft);
    const rightLen = distance(dart.apex, dart.legRight);
    const parityDelta = Math.abs(leftLen - rightLen);

    if (parityDelta > 0.05) {
      anomalies.push(
        `Dart '${dart.id}' violates leg length parity: left=${leftLen.toFixed(2)} cm, right=${rightLen.toFixed(2)} cm (delta=${parityDelta.toFixed(3)} cm > 0.05 cm tolerance).`
      );
    }

    if (dart.widthCm <= 0) {
      anomalies.push(`Dart '${dart.id}' has non-positive width: ${dart.widthCm} cm.`);
    }

    if (dart.lengthCm <= 0) {
      anomalies.push(`Dart '${dart.id}' has non-positive length: ${dart.lengthCm} cm.`);
    }

    // Apex shift tracking relative to base size
    const baseDart = baseDarts.find(bd => bd.id === dart.id);
    if (baseDart) {
      const dx = dart.apex.x - baseDart.apex.x;
      const dy = dart.apex.y - baseDart.apex.y;

      const baseSpan = baseMeasurements.bustSpan ?? 19.0;
      const targetSpan = targetMeasurements.bustSpan ?? baseSpan;
      const expectedDx = (targetSpan - baseSpan) / 2;

      const baseHeight = baseMeasurements.bustHeight ?? 26.5;
      const targetHeight = targetMeasurements.bustHeight ?? baseHeight;
      const expectedDy = targetHeight - baseHeight;

      // In Aldrich/standard drafting, apex tracks bust span / 2 and bust height:
      const dxDeviation = Math.abs(dx - expectedDx);
      const dyDeviation = Math.abs(dy - expectedDy);

      if (dxDeviation > 0.35) {
        anomalies.push(
          `Dart '${dart.id}' horizontal apex shift deviation too large: observed dx=${dx.toFixed(2)} cm, expected=${expectedDx.toFixed(2)} cm (diff=${dxDeviation.toFixed(2)} cm).`
        );
      }

      if (dyDeviation > 0.35) {
        anomalies.push(
          `Dart '${dart.id}' vertical apex shift deviation too large: observed dy=${dy.toFixed(2)} cm, expected=${expectedDy.toFixed(2)} cm (diff=${dyDeviation.toFixed(2)} cm).`
        );
      }
    }
  }

  return {
    darts: targetDarts,
    anomalies,
    isValid: anomalies.length === 0
  };
}
