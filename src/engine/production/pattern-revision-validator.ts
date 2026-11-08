/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ProductionPatternRevisionSnapshot,
  PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION,
  RevisionValidationResult
} from './production-types';

const VALID_GARMENT_CATEGORIES = ['skirt', 'bodice', 'trouser', 'dress'] as const;
const VALID_MEASUREMENT_APPROVAL_STATES = ['pending', 'approved', 'rejected'] as const;

/**
 * Validates whether an ISO date string is syntactically well-formed and parseable.
 */
function isValidIsoDate(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string' || dateStr.trim() === '') return false;
  const epoch = Date.parse(dateStr);
  return Number.isFinite(epoch);
}

/**
 * Validates the structural, semantic, and provenance integrity of a ProductionPatternRevisionSnapshot.
 *
 * Strict Architectural Standards:
 * - Rejects malformed identity, timestamps, or unsupported schema versions.
 * - Detects duplicate piece IDs or duplicate piece codes within the revision.
 * - Detects missing or non-finite geometry coordinates.
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

    if (!ms.values || typeof ms.values !== 'object' || Object.keys(ms.values).length === 0) {
      errors.push('Measurement values must be a non-empty key-value record.');
    } else {
      for (const [k, v] of Object.entries(ms.values)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          errors.push(`Measurement '${k}' has invalid value '${v}'. Must be a finite positive number.`);
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
  }

  // 8. Pattern Pieces Integrity & Uniqueness
  if (!s.patternPieces || !Array.isArray(s.patternPieces)) {
    errors.push('patternPieces must be a valid array.');
  } else if (s.patternPieces.length === 0) {
    warnings.push('patternPieces array is empty. Revision snapshot contains no drafted pieces.');
  } else {
    const seenPieceIds = new Set<string>();
    const seenPieceCodes = new Set<string>();

    for (let i = 0; i < s.patternPieces.length; i++) {
      const piece = s.patternPieces[i];
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
          errors.push(`Piece '${piece.pieceCode}' contains invalid non-positive bounding box dimensions (${bb.widthCm}x${bb.heightCm} cm).`);
        }
      }

      // Contour segments validation
      if (piece.stitchingContour) {
        for (const seg of piece.stitchingContour.segments) {
          if (!Number.isFinite(seg.start.x) || !Number.isFinite(seg.start.y) || !Number.isFinite(seg.end.x) || !Number.isFinite(seg.end.y)) {
            errors.push(`Piece '${piece.pieceCode}' stitching contour segment '${seg.id}' contains non-finite coordinates.`);
            break;
          }
        }
      }

      if (piece.cuttingContour) {
        for (const seg of piece.cuttingContour.segments) {
          if (!Number.isFinite(seg.start.x) || !Number.isFinite(seg.start.y) || !Number.isFinite(seg.end.x) || !Number.isFinite(seg.end.y)) {
            errors.push(`Piece '${piece.pieceCode}' cutting contour segment '${seg.id}' contains non-finite coordinates.`);
            break;
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

  // 10. Canonical Fingerprint Check
  if (!s.canonicalFingerprint || typeof s.canonicalFingerprint !== 'string' || s.canonicalFingerprint.length !== 64) {
    errors.push(`Invalid canonicalFingerprint '${s.canonicalFingerprint}'. Must be a 64-character SHA-256 hex string.`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    validatedAt
  };
}
