/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GeometricContourSnapshot,
  GeometricSegmentSnapshot,
  PatternPieceSnapshot,
  ProductionPatternRevisionSnapshot,
  PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION,
  RevisionValidationResult
} from './production-types';
import {
  computeCanonicalRevisionFingerprint,
  VALID_MEASUREMENT_ORIGINS
} from './pattern-revision-snapshot';

const VALID_GARMENT_CATEGORIES = ['skirt', 'bodice', 'trouser', 'dress', 'sleeve'] as const;
const VALID_MEASUREMENT_APPROVAL_STATES = ['unverified', 'pending', 'approved', 'rejected', 'superseded'] as const;
const VALID_FABRIC_PROVENANCES = [
  'supplier-declared',
  'laboratory-tested',
  'user-entered',
  'project-default',
  'unknown',
  'unverified'
] as const;

/**
 * Validates whether an ISO date string is syntactically well-formed and parseable.
 */
function isValidIsoDate(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string' || dateStr.trim() === '') return false;
  const epoch = Date.parse(dateStr);
  return Number.isFinite(epoch);
}

/**
 * Calculates Euclidean distance between two points.
 */
function pointDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Validates a single contour's structural integrity, connectivity, and segment semantics.
 */
function validateContour(
  contour: GeometricContourSnapshot,
  contourName: string,
  pieceCode: string,
  errors: string[]
): void {
  if (!contour || typeof contour !== 'object') {
    errors.push(`Piece '${pieceCode}' ${contourName} contour is missing or invalid object.`);
    return;
  }

  if (!Array.isArray(contour.segments) || contour.segments.length === 0) {
    errors.push(`Piece '${pieceCode}' ${contourName} contour contains no segments.`);
    return;
  }

  const seenSegmentIds = new Set<string>();

  for (let i = 0; i < contour.segments.length; i++) {
    const seg = contour.segments[i];
    if (!seg || typeof seg !== 'object') {
      errors.push(`Piece '${pieceCode}' ${contourName} segment[${i}] is not a valid object.`);
      continue;
    }

    // Segment identity uniqueness within contour
    if (!seg.id || typeof seg.id !== 'string') {
      errors.push(`Piece '${pieceCode}' ${contourName} segment[${i}] missing string id.`);
    } else if (seenSegmentIds.has(seg.id)) {
      errors.push(`Piece '${pieceCode}' ${contourName} contains duplicate segment id '${seg.id}'.`);
    } else {
      seenSegmentIds.add(seg.id);
    }

    // Segment type validity
    if (seg.type !== 'line' && seg.type !== 'bezier') {
      errors.push(`Piece '${pieceCode}' ${contourName} segment '${seg.id}' has unsupported type '${seg.type}'.`);
    }

    // Coordinate finiteness
    if (!Number.isFinite(seg.start?.x) || !Number.isFinite(seg.start?.y)) {
      errors.push(`Piece '${pieceCode}' ${contourName} segment '${seg.id}' start coordinates are non-finite.`);
    }
    if (!Number.isFinite(seg.end?.x) || !Number.isFinite(seg.end?.y)) {
      errors.push(`Piece '${pieceCode}' ${contourName} segment '${seg.id}' end coordinates are non-finite.`);
    }

    // Length validity
    if (!Number.isFinite(seg.lengthCm) || seg.lengthCm < 0) {
      errors.push(`Piece '${pieceCode}' ${contourName} segment '${seg.id}' lengthCm must be non-negative finite.`);
    }

    // Seam allowance metadata validity
    if (!Number.isFinite(seg.seamAllowanceCm) || seg.seamAllowanceCm < 0) {
      errors.push(`Piece '${pieceCode}' ${contourName} segment '${seg.id}' seamAllowanceCm must be non-negative finite.`);
    }

    // Bézier control points validation
    if (seg.type === 'bezier') {
      if (!Array.isArray(seg.controlPoints) || seg.controlPoints.length !== 2) {
        errors.push(`Piece '${pieceCode}' ${contourName} Bézier segment '${seg.id}' must have exactly 2 control points.`);
      } else {
        const [cp1, cp2] = seg.controlPoints;
        if (!Number.isFinite(cp1?.x) || !Number.isFinite(cp1?.y)) {
          errors.push(`Piece '${pieceCode}' ${contourName} Bézier segment '${seg.id}' cp1 coordinates are non-finite.`);
        }
        if (!Number.isFinite(cp2?.x) || !Number.isFinite(cp2?.y)) {
          errors.push(`Piece '${pieceCode}' ${contourName} Bézier segment '${seg.id}' cp2 coordinates are non-finite.`);
        }
      }
    }
  }

  // Contour closure and connectivity consistency
  if (contour.isClosed && contour.segments.length >= 2) {
    const CONNECTION_TOLERANCE_CM = 0.05;

    // Consecutive connectivity
    for (let i = 0; i < contour.segments.length - 1; i++) {
      const curr = contour.segments[i];
      const next = contour.segments[i + 1];
      if (curr.end && next.start) {
        const dist = pointDistance(curr.end, next.start);
        if (dist > CONNECTION_TOLERANCE_CM) {
          errors.push(
            `Piece '${pieceCode}' ${contourName} disconnected between segment '${curr.id}' end and '${next.id}' start (gap: ${dist.toFixed(4)} cm).`
          );
        }
      }
    }

    // Loop closure: end of last segment must match start of first segment
    const first = contour.segments[0];
    const last = contour.segments[contour.segments.length - 1];
    if (first.start && last.end) {
      const loopGap = pointDistance(last.end, first.start);
      if (loopGap > CONNECTION_TOLERANCE_CM) {
        errors.push(
          `Piece '${pieceCode}' ${contourName} is marked closed but has loop closure gap of ${loopGap.toFixed(4)} cm between last segment end and first segment start.`
        );
      }
    }
  }
}

/**
 * Validates the structural, semantic, cryptographic, and provenance integrity of a ProductionPatternRevisionSnapshot.
 *
 * Strict Architectural Standards:
 * - Recomputes and verifies the canonical SHA-256 fingerprint against all engineering content.
 * - Rejects malformed hexadecimal digests.
 * - Rejects non-finite coordinates, control points, lengths, or negative seam allowances.
 * - Enforces measurement approval constraints (AI estimates require explicit approver identity).
 * - Enforces literal invariant: isProductionReady MUST be strictly false.
 */
export function validateProductionPatternRevision(
  snapshot: unknown
): RevisionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validatedAt = new Date().toISOString();

  if (!snapshot || typeof snapshot !== 'object') {
    return {
      isValid: false,
      errors: ['Snapshot is missing or not a valid object.'],
      warnings: [],
      validatedAt
    };
  }

  const s = snapshot as Partial<ProductionPatternRevisionSnapshot>;

  // 1. Mandatory Industrial Safety Invariant
  if (s.isProductionReady !== false) {
    errors.push('Industrial safety violation: isProductionReady MUST remain strictly and literally false.');
  }

  // 2. Schema Version
  if (s.schemaVersion !== PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION) {
    errors.push(
      `Unsupported schema version '${s.schemaVersion}'. Supported version is '${PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION}'.`
    );
  }

  // 3. Identity & Timestamps
  if (!s.projectId || typeof s.projectId !== 'string' || s.projectId.trim() === '') {
    errors.push('Missing required non-empty projectId.');
  }

  if (!s.revisionId || typeof s.revisionId !== 'string' || s.revisionId.trim() === '') {
    errors.push('Missing required non-empty revisionId.');
  }

  if (!isValidIsoDate(s.createdAt)) {
    errors.push(`Invalid createdAt timestamp '${s.createdAt}'. Must be a valid ISO 8601 date string.`);
  }

  // 4. Garment Category & Target Size
  if (!s.garmentCategory || !VALID_GARMENT_CATEGORIES.includes(s.garmentCategory as unknown as 'skirt')) {
    errors.push(
      `Invalid garmentCategory '${s.garmentCategory}'. Must be one of: ${VALID_GARMENT_CATEGORIES.join(', ')}.`
    );
  }

  if (!s.targetSize || typeof s.targetSize !== 'string' || s.targetSize.trim() === '') {
    errors.push('Missing required targetSize.');
  }

  // 5. Design Specification Integrity
  if (!s.designSpecification || typeof s.designSpecification !== 'object') {
    errors.push('Missing designSpecification snapshot.');
  } else {
    const ds = s.designSpecification;
    if (!ds.id || typeof ds.id !== 'string') {
      errors.push('Design specification missing non-empty ID.');
    }
    if (ds.version === undefined || !Number.isInteger(ds.version) || ds.version < 1) {
      errors.push(`Invalid design specification version '${ds.version}'. Must be an integer >= 1.`);
    }
    if (ds.garmentCategory && ds.garmentCategory !== s.garmentCategory) {
      errors.push(
        `Category mismatch: designSpecification.garmentCategory '${ds.garmentCategory}' does not match revision '${s.garmentCategory}'.`
      );
    }
    if (ds.isApproved && !isValidIsoDate(ds.approvedAt)) {
      warnings.push(`Design is marked approved but approvedAt timestamp '${ds.approvedAt}' is invalid or missing.`);
    }
  }

  // 6. Measurement Set Integrity
  if (!s.measurementSet || typeof s.measurementSet !== 'object') {
    errors.push('Missing measurementSet snapshot.');
  } else {
    const ms = s.measurementSet;
    if (ms.unit !== 'cm') {
      errors.push(`Measurement unit must be 'cm' (received '${ms.unit}').`);
    }

    if (!VALID_MEASUREMENT_ORIGINS.includes(ms.defaultOrigin)) {
      errors.push(`Invalid measurement defaultOrigin '${ms.defaultOrigin}'.`);
    }

    if (!ms.values || typeof ms.values !== 'object' || Object.keys(ms.values).length === 0) {
      errors.push('Measurement values must be a non-empty key-value record.');
    } else {
      for (const [k, v] of Object.entries(ms.values)) {
        if (typeof k !== 'string' || k.trim() === '') {
          errors.push('Measurement set contains an empty measurement key.');
        }
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          errors.push(`Measurement '${k}' has invalid value '${v}'. Must be a finite positive number.`);
        }
      }
    }

    if (ms.perMeasurementOrigin) {
      for (const [k, orig] of Object.entries(ms.perMeasurementOrigin)) {
        if (!VALID_MEASUREMENT_ORIGINS.includes(orig)) {
          errors.push(`Invalid per-measurement origin '${orig}' for measurement '${k}'.`);
        }
      }
    }

    if (!ms.approval || typeof ms.approval !== 'object') {
      errors.push('MeasurementSet missing approval record.');
    } else {
      if (!VALID_MEASUREMENT_APPROVAL_STATES.includes(ms.approval.state)) {
        errors.push(
          `Invalid measurement approval state '${ms.approval.state}'. Must be one of: ${VALID_MEASUREMENT_APPROVAL_STATES.join(', ')}.`
        );
      }

      // If approved, verify approver and timestamp
      if (ms.approval.state === 'approved') {
        if (!ms.approval.approvedBy || ms.approval.approvedBy.trim() === '') {
          errors.push('Measurement approval is marked approved but missing approvedBy identity.');
        }
        if (!isValidIsoDate(ms.approval.approvedAt)) {
          errors.push(`Measurement approval is marked approved but approvedAt '${ms.approval.approvedAt}' is invalid.`);
        }
      }

      // Explicit rule: AI-estimated measurements cannot be approved without explicit approval metadata
      const isAiEstimated =
        ms.defaultOrigin === 'ai-estimated' ||
        (ms.perMeasurementOrigin && Object.values(ms.perMeasurementOrigin).includes('ai-estimated'));

      if (isAiEstimated && ms.approval.state === 'approved' && (!ms.approval.approvedBy || !ms.approval.approvedAt)) {
        errors.push('AI-estimated measurements cannot be approved without explicit approver identity and timestamp.');
      }
    }
  }

  // 7. Fabric Specification Integrity
  if (!s.fabricSpecification || typeof s.fabricSpecification !== 'object') {
    errors.push('Missing fabricSpecification snapshot.');
  } else {
    const fs = s.fabricSpecification;
    if (!fs.fabricId || typeof fs.fabricId !== 'string') {
      errors.push('Fabric specification missing fabricId.');
    }
    if (!fs.name || typeof fs.name !== 'string') {
      errors.push('Fabric specification missing name.');
    }
    if (!VALID_FABRIC_PROVENANCES.includes(fs.provenance as unknown as 'unknown')) {
      errors.push(`Invalid fabric provenance '${fs.provenance}'.`);
    }

    if (fs.gsm !== undefined && (!Number.isFinite(fs.gsm) || fs.gsm <= 0)) {
      errors.push(`Fabric GSM must be a positive finite number (received ${fs.gsm}).`);
    }
    if (fs.thicknessMm !== undefined && (!Number.isFinite(fs.thicknessMm) || fs.thicknessMm <= 0)) {
      errors.push(`Fabric thicknessMm must be a positive finite number (received ${fs.thicknessMm}).`);
    }
    if (fs.moldingFactor !== undefined && (!Number.isFinite(fs.moldingFactor) || fs.moldingFactor <= 0)) {
      errors.push(`Fabric moldingFactor must be a positive finite number (received ${fs.moldingFactor}).`);
    }

    if (fs.directional) {
      if (fs.directional.warp) {
        const w = fs.directional.warp;
        if (!Number.isFinite(w.shrinkagePercent) || w.shrinkagePercent < 0 || w.shrinkagePercent > 100) {
          errors.push(`Fabric warp shrinkagePercent '${w.shrinkagePercent}' is out of physical range [0, 100].`);
        }
        if (!Number.isFinite(w.stretchPercent) || w.stretchPercent < 0 || w.stretchPercent > 200) {
          errors.push(`Fabric warp stretchPercent '${w.stretchPercent}' is out of physical range [0, 200].`);
        }
      }
      if (fs.directional.weft) {
        const w = fs.directional.weft;
        if (!Number.isFinite(w.shrinkagePercent) || w.shrinkagePercent < 0 || w.shrinkagePercent > 100) {
          errors.push(`Fabric weft shrinkagePercent '${w.shrinkagePercent}' is out of physical range [0, 100].`);
        }
        if (!Number.isFinite(w.stretchPercent) || w.stretchPercent < 0 || w.stretchPercent > 200) {
          errors.push(`Fabric weft stretchPercent '${w.stretchPercent}' is out of physical range [0, 200].`);
        }
      }
      if (fs.directional.bias) {
        const b = fs.directional.bias;
        if (!Number.isFinite(b.stretchPercent) || b.stretchPercent < 0 || b.stretchPercent > 200) {
          errors.push(`Fabric bias stretchPercent '${b.stretchPercent}' is out of physical range [0, 200].`);
        }
      }
    }
  }

  // 8. Pattern Pieces Integrity & Geometry
  if (!s.patternPieces || !Array.isArray(s.patternPieces)) {
    errors.push('patternPieces must be a valid array.');
  } else if (s.patternPieces.length === 0) {
    warnings.push('patternPieces array is empty. Revision snapshot contains no drafted pieces.');
  } else {
    const seenPieceIds = new Set<string>();
    const seenPieceCodes = new Set<string>();

    for (let i = 0; i < s.patternPieces.length; i++) {
      const piece = s.patternPieces[i] as PatternPieceSnapshot;
      if (!piece || typeof piece !== 'object') {
        errors.push(`patternPieces[${i}] is not a valid object.`);
        continue;
      }

      // Duplicate Piece ID check
      if (!piece.id || typeof piece.id !== 'string') {
        errors.push(`patternPieces[${i}] missing valid string id.`);
      } else if (seenPieceIds.has(piece.id)) {
        errors.push(`Duplicate pattern piece ID '${piece.id}' in revision.`);
      } else {
        seenPieceIds.add(piece.id);
      }

      // Duplicate Piece Code check
      if (!piece.pieceCode || typeof piece.pieceCode !== 'string') {
        errors.push(`patternPieces[${i}] missing valid pieceCode.`);
      } else if (seenPieceCodes.has(piece.pieceCode)) {
        errors.push(`Duplicate pattern pieceCode '${piece.pieceCode}' in revision.`);
      } else {
        seenPieceCodes.add(piece.pieceCode);
      }

      // Piece target size match
      if (piece.sizeCode && s.targetSize && piece.sizeCode !== s.targetSize) {
        errors.push(
          `Piece '${piece.pieceCode}' sizeCode '${piece.sizeCode}' does not match revision targetSize '${s.targetSize}'.`
        );
      }

      // Category match
      if (piece.garmentCategory && piece.garmentCategory !== s.garmentCategory) {
        errors.push(
          `Piece '${piece.pieceCode}' garmentCategory '${piece.garmentCategory}' does not match revision category '${s.garmentCategory}'.`
        );
      }

      // Bounding box check
      if (!piece.boundingBox || typeof piece.boundingBox !== 'object') {
        errors.push(`Piece '${piece.pieceCode}' missing boundingBox.`);
      } else {
        const bb = piece.boundingBox;
        if (
          !Number.isFinite(bb.widthCm) ||
          bb.widthCm <= 0 ||
          !Number.isFinite(bb.heightCm) ||
          bb.heightCm <= 0
        ) {
          errors.push(
            `Piece '${piece.pieceCode}' contains invalid non-positive bounding box dimensions (${bb.widthCm}x${bb.heightCm} cm).`
          );
        }
        if (bb.minX > bb.maxX || bb.minY > bb.maxY) {
          errors.push(`Piece '${piece.pieceCode}' bounding box has min > max.`);
        }
      }

      // Validate stitching contour
      if (piece.stitchingContour) {
        validateContour(piece.stitchingContour, 'stitching', piece.pieceCode, errors);
      }

      // Validate cutting contour
      if (piece.cuttingContour) {
        validateContour(piece.cuttingContour, 'cutting', piece.pieceCode, errors);
      }

      // Stitching vs cutting relationship
      if (piece.stitchingContour && piece.cuttingContour) {
        const sewBb = piece.stitchingContour.boundingBox;
        const cutBb = piece.cuttingContour.boundingBox;
        if (sewBb && cutBb) {
          // Cutting contour bounding box must be at least as large as stitching contour
          // (allowing 0.02 cm numerical tolerance)
          if (cutBb.widthCm < sewBb.widthCm - 0.02 || cutBb.heightCm < sewBb.heightCm - 0.02) {
            errors.push(
              `Piece '${piece.pieceCode}' cutting contour (${cutBb.widthCm}x${cutBb.heightCm} cm) does not enclose stitching contour (${sewBb.widthCm}x${sewBb.heightCm} cm).`
            );
          }
        }
      }
    }
  }

  // 9. Engine Provenance
  if (!s.engineProvenance || typeof s.engineProvenance !== 'object') {
    errors.push('Missing engineProvenance record.');
  } else {
    if (!s.engineProvenance.engineVersion || typeof s.engineProvenance.engineVersion !== 'string') {
      errors.push('engineProvenance missing engineVersion.');
    }
  }

  // 10. Canonical Fingerprint Integrity
  if (!s.canonicalFingerprint || typeof s.canonicalFingerprint !== 'string') {
    errors.push('Missing required canonicalFingerprint.');
  } else if (!/^[0-9a-f]{64}$/.test(s.canonicalFingerprint)) {
    errors.push(
      `Invalid canonicalFingerprint '${s.canonicalFingerprint}'. Must be a 64-character lowercase hexadecimal SHA-256 string.`
    );
  } else {
    try {
      const computedFingerprint = computeCanonicalRevisionFingerprint(s as ProductionPatternRevisionSnapshot);
      if (s.canonicalFingerprint !== computedFingerprint) {
        errors.push(
          `Canonical fingerprint mismatch: declared '${s.canonicalFingerprint}' does not match computed digest '${computedFingerprint}'. Snapshot content has been altered or tampered with.`
        );
      }
    } catch (err) {
      errors.push(
        `Failed to recompute canonical fingerprint: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    validatedAt
  };
}
