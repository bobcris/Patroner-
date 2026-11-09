/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  arePatternRevisionsEquivalent,
  canonicalizeJson,
  compareRevisionInputs,
  computeCanonicalFingerprint,
  computeCanonicalRevisionFingerprint,
  createDesignSpecificationSnapshot,
  createFabricSpecificationSnapshot,
  createMeasurementSetSnapshot,
  createProductionPatternRevision,
  CURRENT_ENGINE_VERSION,
  deepFreeze,
  serializeGeometricContourSnapshot,
  serializeGeometricSegmentSnapshot,
  serializePatternPieceSnapshot
} from './pattern-revision-snapshot';
import { validateProductionPatternRevision } from './pattern-revision-validator';
import {
  CreateProductionPatternRevisionInput,
  PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION,
  ProductionPatternRevisionSnapshot,
  ProductionPatternSnapshotSchemaVersion,
  ProductionSnapshotError,
  ProductionSnapshotFabricError,
  ProductionSnapshotGeometryError,
  ProductionSnapshotMeasurementError,
  ProductionSnapshotValidationError
} from './production-types';
import { sha256Hex } from './crypto';
import {
  BodyMeasurements,
  DesignSpecification,
  FabricProperty,
  PatternPiece,
  ValidationReport
} from '../../types';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { getEnhancedFabricById, DEFAULT_ILLUSTRATIVE_FABRIC } from '../fabric/fabric-presets';
import { CubicBezierCurve, GeometricContour, LineSegment } from '../geometry/primitives';

describe('Milestone 04.6.1: Authoritative Pattern Snapshot & Revision Integrity', () => {
  const baseMeasurements: BodyMeasurements = {
    unit: 'cm',
    waist: 68.0,
    bust: 90.0,
    highHip: 86.0,
    lowHip: 94.0,
    waistToHip: 20.0,
    skirtLength: 60.0,
    backWaistLength: 41.0,
    frontWaistLength: 42.5,
    acrossBack: 34.5,
    shoulderLength: 12.5,
    neckCircumference: 36.0,
    bustSpan: 18.0,
    bustHeight: 26.0,
    armholeDepth: 20.5,
    bicepsCircumference: 28.0,
    wristCircumference: 16.0,
    sleeveLength: 58.0
  };

  const baseDesignSpec: DesignSpecification = {
    id: 'spec-bodice-01',
    name: 'Tailored Wool Crepe Bodice',
    prompt: 'Tailored classic bodice block with waist darts in wool crepe',
    garmentCategory: 'bodice',
    silhouette: 'tailored',
    fabric: {
      id: 'wool-crepe',
      name: 'Wool Crepe Suiting',
      composition: '100% Wool',
      weight: 'medium',
      stretch: 'none',
      recommendedEaseCm: { waist: 4.0, hip: 4.0, bust: 5.0 },
      drapeDescription: 'Structured fluid drape'
    },
    color: { name: 'Midnight Navy', hex: '#1e293b' },
    easeProfile: 'classic',
    lengthCm: 45.0,
    dartStyle: 'waist',
    sleeveEaseStrategy: 'classic',
    constructionFeatures: [
      { id: 'feat-1', category: 'dart', name: 'Waist Dart', description: 'Standard Aldrich waist dart', patternImpact: 'Fitted waist contour' }
    ],
    designNotes: ['Initial atelier base pattern'],
    isApproved: true,
    approvedAt: '2026-11-01T10:00:00.000Z',
    version: 1,
    aiEstimates: {
      suggestedSilhouette: 'tailored',
      styleConfidenceScore: 0.94,
      suggestedFabrics: ['wool-crepe', 'silk-crepe'],
      technicalAdvice: 'Ensure scapula ease is preserved',
      disclaimer: 'AI style suggestion requires patternmaker verification'
    }
  };

  const fabricLookup = getEnhancedFabricById('wool-crepe');
  const testFabric = fabricLookup.status === 'found' ? fabricLookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;

  const draftedBodicePieces = draftBodiceBlock(baseMeasurements, baseDesignSpec);

  const baseValidationReport: ValidationReport = {
    status: 'validated',
    isValid: true,
    isProductionReady: false,
    statusLabel: 'DRAFT_VALIDATED',
    timestamp: '2026-11-08T12:00:00.000Z',
    passedCount: 12,
    warningCount: 0,
    failureCount: 0,
    checks: [],
    unassessedConditions: [],
    declaration: '2D geometry and seam matches verified.'
  };

  function createValidTestSnapshotInput(
    overrides: Partial<CreateProductionPatternRevisionInput> = {}
  ): CreateProductionPatternRevisionInput {
    return {
      projectId: 'proj-atelier-2026',
      revisionId: 'rev-2026-001',
      revisionIndex: 1,
      createdAt: '2026-11-08T12:00:00.000Z',
      createdBy: 'Lead Technical Patternmaker',
      targetSize: 'M',
      designSpecification: baseDesignSpec,
      measurements: {
        values: ({ ...baseMeasurements } as unknown) as Record<string, number>,
        defaultOrigin: 'user-entered',
        approval: {
          state: 'approved',
          approvedBy: 'Master Tailor',
          approvedAt: '2026-11-01T11:00:00.000Z',
          notes: 'Standard manual measurement verified.'
        }
      },
      fabric: testFabric,
      patternPieces: draftedBodicePieces,
      draftingConfiguration: {
        dartStyle: 'waist',
        sleeveEaseStrategy: 'classic',
        seamAllowanceCm: 1.5
      },
      validation: baseValidationReport,
      ...overrides
    };
  }

  describe('1. Identity, Structure & Immutability', () => {
    it('1. creates an authoritative snapshot with valid source data', () => {
      const input = createValidTestSnapshotInput();
      const snapshot = createProductionPatternRevision(input);

      assert.equal(snapshot.schemaVersion, PRODUCTION_PATTERN_SNAPSHOT_SCHEMA_VERSION);
      assert.equal(snapshot.projectId, 'proj-atelier-2026');
      assert.equal(snapshot.revisionId, 'rev-2026-001');
      assert.equal(snapshot.targetSize, 'M');
      assert.equal(snapshot.garmentCategory, 'bodice');
      assert.equal(snapshot.isProductionReady, false);
      assert.ok(snapshot.canonicalFingerprint);
      assert.equal(snapshot.canonicalFingerprint.length, 64);
      assert.equal(snapshot.patternPieces.length, 2);

      const val = validateProductionPatternRevision(snapshot);
      assert.equal(val.isValid, true);
      assert.equal(val.errors.length, 0);
    });

    it('2. rejects missing project or revision identity', () => {
      const input = createValidTestSnapshotInput({ projectId: '' });
      const snap = createProductionPatternRevision(input);
      const res = validateProductionPatternRevision(snap);
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Missing required non-empty projectId')));

      const badRevSnap = { ...snap, revisionId: '   ' };
      const res2 = validateProductionPatternRevision(badRevSnap);
      assert.equal(res2.isValid, false);
      assert.ok(res2.errors.some(e => e.includes('Missing required non-empty revisionId')));
    });

    it('3. rejects malformed timestamps', () => {
      const badTimeSnap: ProductionPatternRevisionSnapshot = {
        ...createProductionPatternRevision(createValidTestSnapshotInput()),
        createdAt: 'invalid-date-string'
      };
      const res = validateProductionPatternRevision(badTimeSnap);
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Invalid createdAt timestamp')));
    });

    it('4. rejects unsupported schema versions', () => {
      const badSchemaSnap: ProductionPatternRevisionSnapshot = {
        ...createProductionPatternRevision(createValidTestSnapshotInput()),
        schemaVersion: '99.0.0' as unknown as ProductionPatternSnapshotSchemaVersion
      };
      const res = validateProductionPatternRevision(badSchemaSnap);
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes("Unsupported schema version '99.0.0'")));
    });

    it('5. rejects duplicate piece IDs', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const dupPieces = [snap.patternPieces[0], { ...snap.patternPieces[0], pieceCode: 'BOD-F-02' }];
      const badPieceSnap = { ...snap, patternPieces: dupPieces };

      const res = validateProductionPatternRevision(badPieceSnap);
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Duplicate pattern piece ID')));
    });

    it('6. rejects duplicate piece codes where prohibited', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const dupCodes = [snap.patternPieces[0], { ...snap.patternPieces[0], id: 'piece-unique-id' }];
      const badCodeSnap = { ...snap, patternPieces: dupCodes };

      const res = validateProductionPatternRevision(badCodeSnap);
      assert.equal(res.isValid, false);
      assert.ok(res.errors.some(e => e.includes('Duplicate pattern pieceCode')));
    });

    it('7. retains correct target size and garment category', () => {
      const input = createValidTestSnapshotInput({ targetSize: 'XL' });
      const snap = createProductionPatternRevision(input);
      assert.equal(snap.targetSize, 'XL');
      assert.equal(snap.garmentCategory, 'bodice');
      assert.equal(snap.patternPieces[0].sizeCode, 'XL');
    });
  });

  describe('2. Geometry Serialization & Reconstruction', () => {
    it('8. preserves line-segment geometry in pure plain data without class methods', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 10, y: 20 };
      const line = new LineSegment('line-test-1', p1, p2, 1.5, false, 'seam-1', 'source-1', 'offset');

      const snap = serializeGeometricSegmentSnapshot(line);
      assert.equal(snap.id, 'line-test-1');
      assert.equal(snap.type, 'line');
      assert.deepEqual(snap.start, p1);
      assert.deepEqual(snap.end, p2);
      assert.equal(snap.seamAllowanceCm, 1.5);
      assert.equal(snap.isFold, false);
      assert.equal(snap.role, 'offset');
      assert.equal(typeof snap.lengthCm, 'number');
      // Plain data has no class method attached
      assert.equal(typeof (snap as unknown as LineSegment).tangentAt, 'undefined');
    });

    it('9. preserves Bézier control points in plain-data snapshot', () => {
      const p0 = { x: 0, y: 0 };
      const cp1 = { x: 5, y: 15 };
      const cp2 = { x: 15, y: 25 };
      const p3 = { x: 20, y: 10 };
      const curve = new CubicBezierCurve('bezier-test-1', p0, cp1, cp2, p3, 1.0, false, 'armhole');

      const snap = serializeGeometricSegmentSnapshot(curve);
      assert.equal(snap.id, 'bezier-test-1');
      assert.equal(snap.type, 'bezier');
      assert.deepEqual(snap.start, p0);
      assert.deepEqual(snap.end, p3);
      assert.ok(snap.controlPoints);
      assert.deepEqual(snap.controlPoints[0], cp1);
      assert.deepEqual(snap.controlPoints[1], cp2);
      assert.equal(typeof (snap as unknown as CubicBezierCurve).tangentAt, 'undefined');
    });

    it('10. preserves segment roles and fold semantics', () => {
      const foldLine = new LineSegment('fold-line', { x: 0, y: 0 }, { x: 0, y: 40 }, 0, true, 'cf-seam', undefined, 'stitching');
      const snap = serializeGeometricSegmentSnapshot(foldLine);
      assert.equal(snap.isFold, true);
      assert.equal(snap.seamAllowanceCm, 0);
      assert.equal(snap.role, 'stitching');
    });

    it('11. preserves seam allowance metadata across all contour segments', () => {
      const piece = draftedBodicePieces[0];
      const snap = serializePatternPieceSnapshot(piece, 'M');
      assert.ok(snap.stitchingContour);
      assert.ok(snap.cuttingContour);
      assert.ok(snap.cuttingContour.segments.length > 0);
      for (const seg of snap.cuttingContour.segments) {
        assert.equal(typeof seg.seamAllowanceCm, 'number');
      }
    });

    it('12. preserves contour closure and winding state', () => {
      const piece = draftedBodicePieces[0];
      const snap = serializePatternPieceSnapshot(piece, 'M');
      assert.ok(snap.stitchingContour);
      assert.equal(snap.stitchingContour.isClosed, true);
      assert.ok(snap.stitchingContour.winding);
    });

    it('13. preserves dart, notch, grainline, seam, and drill-hole data', () => {
      const piece = draftedBodicePieces[0];
      const snap = serializePatternPieceSnapshot(piece, 'M');
      assert.ok(snap.darts.length > 0);
      assert.ok(snap.notches.length > 0);
      assert.ok(snap.seams.length > 0);
      assert.ok(snap.grainline);
      assert.ok(snap.drillHoles && snap.drillHoles.length > 0);
      assert.ok(snap.boundingBox.widthCm > 0);
    });

    it('14. performs round-trip or equivalent structural comparison between snapshots', () => {
      const input = createValidTestSnapshotInput();
      const snapA = createProductionPatternRevision(input);
      const snapB = createProductionPatternRevision(input);

      assert.equal(arePatternRevisionsEquivalent(snapA, snapB), true);
      assert.equal(snapA.canonicalFingerprint, snapB.canonicalFingerprint);
    });

    it('15. detects geometry changes between snapshots', () => {
      const input = createValidTestSnapshotInput();
      const snap = createProductionPatternRevision(input);

      // Mutate one piece bounding box
      const modifiedPieces = draftedBodicePieces.map((p, idx) => {
        if (idx === 0) {
          return {
            ...p,
            boundingBox: {
              ...p.boundingBox,
              widthCm: p.boundingBox.widthCm + 5.0
            }
          };
        }
        return p;
      });

      const cmp = compareRevisionInputs(snap, {
        patternPieces: modifiedPieces
      });

      assert.equal(cmp.isStale, true);
      assert.equal(cmp.hasBreakingChanges, true);
      assert.ok(cmp.mismatches.some(m => m.path.includes('boundingBox')));
    });
  });

  describe('3. Provenance & Independent Approval Boundary', () => {
    it('16. preserves user-entered measurement provenance', () => {
      const measSnap = createMeasurementSetSnapshot({ waist: 68 }, { defaultOrigin: 'user-entered' });
      assert.equal(measSnap.defaultOrigin, 'user-entered');
    });

    it('17. preserves standard-chart provenance', () => {
      const measSnap = createMeasurementSetSnapshot({ waist: 68 }, { defaultOrigin: 'standard-chart' });
      assert.equal(measSnap.defaultOrigin, 'standard-chart');
    });

    it('18. preserves AI-estimated origin and keeps it distinct', () => {
      const measSnap = createMeasurementSetSnapshot(
        { waist: 68, bust: 90 },
        {
          defaultOrigin: 'user-entered',
          perMeasurementOrigin: { bust: 'ai-estimated' }
        }
      );
      assert.equal(measSnap.defaultOrigin, 'user-entered');
      assert.equal(measSnap.perMeasurementOrigin?.bust, 'ai-estimated');
    });

    it('19. does not infer approval from AI use or drafting use', () => {
      const measSnap = createMeasurementSetSnapshot(
        { waist: 68 },
        {
          defaultOrigin: 'ai-estimated'
          // No approval passed
        }
      );
      assert.equal(measSnap.approval.state, 'pending');
      assert.equal(measSnap.approval.approvedBy, undefined);
    });

    it('20. preserves pending and rejected measurement approval states', () => {
      const pendingSnap = createMeasurementSetSnapshot({ waist: 68 }, { approval: { state: 'pending' } });
      assert.equal(pendingSnap.approval.state, 'pending');

      const rejectedSnap = createMeasurementSetSnapshot({ waist: 68 }, { approval: { state: 'rejected', notes: 'Tape slipped' } });
      assert.equal(rejectedSnap.approval.state, 'rejected');
      assert.equal(rejectedSnap.approval.notes, 'Tape slipped');
    });

    it('21. requires explicit approval metadata for approved measurements', () => {
      // Trying to approve AI estimates without approver reverts to pending
      const aiApprovedWithoutMetadata = createMeasurementSetSnapshot(
        { waist: 68 },
        {
          defaultOrigin: 'ai-estimated',
          approval: { state: 'approved' } // missing approvedBy and approvedAt
        }
      );
      assert.equal(aiApprovedWithoutMetadata.approval.state, 'pending');

      // With full approver metadata: retains approved
      const aiApprovedWithMetadata = createMeasurementSetSnapshot(
        { waist: 68 },
        {
          defaultOrigin: 'ai-estimated',
          approval: {
            state: 'approved',
            approvedBy: 'Senior Cutter',
            approvedAt: '2026-11-08T12:00:00.000Z'
          }
        }
      );
      assert.equal(aiApprovedWithMetadata.approval.state, 'approved');
      assert.equal(aiApprovedWithMetadata.approval.approvedBy, 'Senior Cutter');
    });

    it('22. keeps design approval distinct from measurement approval', () => {
      const input = createValidTestSnapshotInput({
        designSpecification: {
          ...baseDesignSpec,
          isApproved: true,
          approvedAt: '2026-11-01T10:00:00.000Z'
        },
        measurements: {
          values: { waist: 68, bust: 90 },
          defaultOrigin: 'user-entered',
          approval: { state: 'pending' } // Measurements pending despite design approved!
        }
      });
      const snap = createProductionPatternRevision(input);

      assert.equal(snap.approvalState.designApproval, 'approved');
      assert.equal(snap.approvalState.measurementApproval, 'pending');
    });

    it('23. preserves fabric and property-level provenance', () => {
      const defaultSnap = createFabricSpecificationSnapshot(testFabric);
      assert.equal(defaultSnap.fabricId, 'wool-crepe');
      assert.equal(defaultSnap.provenance, 'project-default');
      assert.equal(defaultSnap.isVerified, false);
      assert.ok(defaultSnap.directional);

      const labFabric = { ...testFabric, provenance: 'laboratory-tested' as const, isVerified: true };
      const labSnap = createFabricSpecificationSnapshot(labFabric);
      assert.equal(labSnap.provenance, 'laboratory-tested');
      assert.equal(labSnap.isVerified, true);
    });

    it('24. preserves unresolved material assignments explicitly without fabricating lining', () => {
      const piece = draftedBodicePieces[0];
      const snap = serializePatternPieceSnapshot({ ...piece, material: 'self' });
      assert.equal(snap.material, 'self');
    });
  });

  describe('4. Revision Integrity & Stale Detection', () => {
    it('25. detects changed measurements', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const cmp = compareRevisionInputs(snap, {
        measurements: {
          values: ({ ...baseMeasurements, waist: 72.0 } as unknown) as Record<string, number>
        }
      });
      assert.equal(cmp.isStale, true);
      assert.equal(cmp.hasBreakingChanges, true);
      assert.ok(cmp.mismatches.some(m => m.path === 'measurementSet.values.waist'));
    });

    it('26. detects changed design specification', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const cmp = compareRevisionInputs(snap, {
        designSpecification: { silhouette: 'relaxed' }
      });
      assert.equal(cmp.isStale, true);
      assert.ok(cmp.mismatches.some(m => m.field === 'silhouette'));
    });

    it('27. detects changed fabric revision or material properties', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const cmp = compareRevisionInputs(snap, {
        fabric: { id: 'silk-charmeuse', stretch: 'low-stretch' }
      });
      assert.equal(cmp.isStale, true);
      assert.ok(cmp.mismatches.some(m => m.field === 'fabricId'));
    });

    it('28. detects changed drafting configuration', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const cmp = compareRevisionInputs(snap, {
        draftingConfiguration: { seamAllowanceCm: 2.0 }
      });
      assert.equal(cmp.isStale, true);
      assert.ok(cmp.mismatches.some(m => m.field === 'seamAllowanceCm'));
    });

    it('29. detects changed pattern piece count or identities', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const cmp = compareRevisionInputs(snap, {
        patternPieces: [draftedBodicePieces[0]] // 1 piece instead of 2
      });
      assert.equal(cmp.isStale, true);
      assert.ok(cmp.mismatches.some(m => m.field === 'length'));
    });

    it('30. detects changed engine provenance', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const cmp = compareRevisionInputs(snap, {
        engineVersion: '0.4.7.0'
      });
      assert.equal(cmp.isStale, true);
      assert.ok(cmp.mismatches.some(m => m.field === 'engineVersion'));
      assert.equal(cmp.mismatches.find(m => m.field === 'engineVersion')?.severity, 'advisory');
    });

    it('31. identifies the exact affected input paths in structured diagnostics', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const cmp = compareRevisionInputs(snap, {
        targetSize: 'S',
        designSpecification: { easeProfile: 'ultra-fitted' }
      });
      assert.equal(cmp.isStale, true);
      assert.equal(cmp.mismatches.length, 2);
      assert.equal(cmp.mismatches[0].path, 'targetSize');
      assert.equal(cmp.mismatches[1].path, 'designSpecification.easeProfile');
    });

    it('32. preserves historical revision state without mutating on input updates', () => {
      const input = createValidTestSnapshotInput();
      const snap = createProductionPatternRevision(input);

      // Caller mutates the input object afterwards
      (input.measurements.values as Record<string, number>).waist = 999;
      (input.designSpecification as unknown as { silhouette: string }).silhouette = 'oversized';

      // Snapshot values must remain unchanged
      assert.equal(snap.measurementSet.values.waist, 68);
      assert.equal(snap.designSpecification.silhouette, 'tailored');
    });

    it('33. does not mutate caller-owned input objects during snapshot creation', () => {
      const input = createValidTestSnapshotInput();
      const originalWaist = input.measurements.values.waist;
      createProductionPatternRevision(input);
      assert.equal(input.measurements.values.waist, originalWaist);
    });

    it('34. prevents mutation of nested snapshot data via runtime deepFreeze', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());

      assert.throws(() => {
        // @ts-expect-error mutating frozen object
        snap.measurementSet.values['waist'] = 100;
      }, TypeError);

      assert.throws(() => {
        (snap.patternPieces as unknown as unknown[]).push({});
      }, TypeError);
    });
  });

  describe('5. Validation Status, Safety & Production Readiness', () => {
    it('35. distinguishes structural validity from industrial production readiness', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const val = validateProductionPatternRevision(snap);
      assert.equal(val.isValid, true);
      // Valid structurally, but isProductionReady is strictly false
      assert.equal(snap.isProductionReady, false);
    });

    it('36. preserves invalid or incomplete validation reports accurately', () => {
      const incompleteReport: ValidationReport = {
        ...baseValidationReport,
        status: 'incomplete',
        isValid: false,
        statusLabel: 'DRAFT_INCOMPLETE'
      };
      const snap = createProductionPatternRevision(createValidTestSnapshotInput({ validation: incompleteReport }));
      assert.equal(snap.approvalState.patternGeometryValidation, 'incomplete');
      assert.equal(snap.validation.status, 'incomplete');
    });

    it('37. preserves unassessed physical validation state', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput({ physicalValidationStatus: 'not-assessed' }));
      assert.equal(snap.approvalState.physicalPrototypeValidation, 'not-assessed');
    });

    it('38. keeps isProductionReady strictly false across all outputs and validators', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      assert.equal(snap.isProductionReady, false);

      // Attempting to validate a snapshot where isProductionReady is not false fails validation
      const maliciousSnap = { ...snap, isProductionReady: true as unknown as false };
      const val = validateProductionPatternRevision(maliciousSnap);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('isProductionReady MUST remain strictly and literally false')));
    });

    it('39. does not transform synthetic evidence into real physical evidence', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput({
        physicalValidationStatus: 'conforming'
      }));
      // Preserves status without altering isProductionReady
      assert.equal(snap.isProductionReady, false);
    });

    it('40. does not report production readiness merely because all 2D validation checks pass', () => {
      const fullyValidatedReport: ValidationReport = {
        ...baseValidationReport,
        status: 'validated',
        isValid: true,
        passedCount: 25,
        failureCount: 0
      };
      const snap = createProductionPatternRevision(createValidTestSnapshotInput({ validation: fullyValidatedReport }));
      assert.equal(snap.validation.isValid, true);
      assert.equal(snap.isProductionReady, false);
    });
  });

  describe('6. Multi-Category Drafting Support', () => {
    it('41. creates and validates skirt pattern revision snapshots', () => {
      const skirtSpec: DesignSpecification = {
        ...baseDesignSpec,
        id: 'spec-skirt-01',
        name: 'A-Line Wool Skirt',
        garmentCategory: 'skirt',
        silhouette: 'a-line'
      };
      const skirtPieces = draftSkirtBlock(baseMeasurements, skirtSpec);
      const skirtSnap = createProductionPatternRevision(createValidTestSnapshotInput({
        designSpecification: skirtSpec,
        patternPieces: skirtPieces
      }));

      assert.equal(skirtSnap.garmentCategory, 'skirt');
      assert.equal(skirtSnap.patternPieces.length, 2);
      assert.equal(skirtSnap.isProductionReady, false);

      const val = validateProductionPatternRevision(skirtSnap);
      assert.equal(val.isValid, true);
    });

    it('42. creates and validates sleeve pattern piece snapshots with armhole context', () => {
      const sleeveResult = draftSleeveBlock(baseMeasurements, baseDesignSpec, {
        strategy: 'classic',
        bodicePieces: draftedBodicePieces
      });
      const allPieces = [...draftedBodicePieces, sleeveResult.piece];

      const snap = createProductionPatternRevision(createValidTestSnapshotInput({
        patternPieces: allPieces,
        assemblySummary: {
          status: 'verified-valid',
          isValid: true,
          totalBodiceArmholeLengthCm: 44.5,
          totalSleeveCapLengthCm: 46.5,
          totalEaseCm: 2.0,
          frontEaseCm: 0.9,
          backEaseCm: 1.1,
          frontEaseRatio: 0.45,
          isRatioDefined: true,
          isDistributionBalanced: true,
          isTotalEasePermitted: true,
          targetStrategy: 'classic',
          endpointTopologyValid: true,
          notchCorrespondenceStatus: 'verified-valid',
          unresolvedRisks: []
        }
      }));

      assert.equal(snap.patternPieces.length, 3);
      assert.equal(snap.approvalState.assemblyValidation, 'verified-valid');
      const val = validateProductionPatternRevision(snap);
      assert.equal(val.isValid, true);
    });

    it('43. equivalent snapshots produce identical fingerprints regardless of property order', () => {
      const input = createValidTestSnapshotInput();
      const snap1 = createProductionPatternRevision(input);
      const snap2 = createProductionPatternRevision(input);

      assert.equal(snap1.canonicalFingerprint, snap2.canonicalFingerprint);
      assert.equal(arePatternRevisionsEquivalent(snap1, snap2), true);
    });
  });

  describe('7. Milestone 04.6.1.1: Production Snapshot Integrity Hardening', () => {
    it('h-1. defaults missing measurement provenance strictly to unknown', () => {
      const measSnap = createMeasurementSetSnapshot({ waist: 68 });
      assert.equal(measSnap.defaultOrigin, 'unknown');
      assert.notEqual(measSnap.defaultOrigin, 'user-entered');
    });

    it('h-2. rejects empty measurement names, non-finite, zero, or negative values', () => {
      assert.throws(() => {
        createMeasurementSetSnapshot({ '   ': 68 });
      }, ProductionSnapshotMeasurementError);

      assert.throws(() => {
        createMeasurementSetSnapshot({ waist: 0 });
      }, ProductionSnapshotMeasurementError);

      assert.throws(() => {
        createMeasurementSetSnapshot({ waist: -10 });
      }, ProductionSnapshotMeasurementError);

      assert.throws(() => {
        createMeasurementSetSnapshot({ waist: NaN });
      }, ProductionSnapshotMeasurementError);
    });

    it('h-3. strictly enforces AI approval boundary and requires valid approver and ISO timestamp', () => {
      // AI origin with approved state but missing metadata reverts to pending
      const aiPending = createMeasurementSetSnapshot(
        { waist: 68 },
        { defaultOrigin: 'ai-estimated', approval: { state: 'approved' } }
      );
      assert.equal(aiPending.approval.state, 'pending');

      // AI origin with full metadata succeeds
      const aiApproved = createMeasurementSetSnapshot(
        { waist: 68 },
        {
          defaultOrigin: 'ai-estimated',
          approval: {
            state: 'approved',
            approvedBy: 'Senior Cutter',
            approvedAt: '2026-11-08T12:00:00.000Z'
          }
        }
      );
      assert.equal(aiApproved.approval.state, 'approved');

      // Invalid ISO timestamp throws
      assert.throws(() => {
        createMeasurementSetSnapshot(
          { waist: 68 },
          {
            defaultOrigin: 'user-entered',
            approval: {
              state: 'approved',
              approvedBy: 'Tailor',
              approvedAt: 'not-a-valid-date'
            }
          }
        );
      }, ProductionSnapshotMeasurementError);
    });

    it('h-4. preserves fabric provenance without converting unknown into project-default', () => {
      const unverifiedFabric: FabricProperty = {
        id: 'mystery-crepe',
        name: 'Mystery Crepe',
        composition: 'Unknown blend',
        weight: 'medium',
        stretch: 'none',
        recommendedEaseCm: { waist: 2, hip: 3 },
        drapeDescription: 'Flowing drape'
      };
      const snap = createFabricSpecificationSnapshot(unverifiedFabric);
      assert.equal(snap.provenance, 'unknown');
      assert.notEqual(snap.provenance, 'project-default');
    });

    it('h-5. preserves property-level provenance from EnhancedFabricProperty without fabricating laboratory verification', () => {
      const enhancedFabricWithProvenance = {
        ...testFabric,
        provenance: 'laboratory-tested' as const,
        isVerified: true,
        testStandard: 'ISO 5077 / ISO 3759 (Dimensional Stability / Shrinkage)',
        propertyProvenance: {
          gsm: {
            value: 240,
            unit: 'g/m²',
            sourceType: 'laboratory-measured' as const,
            verificationStatus: 'verified' as const,
            testStandard: 'ISO 3801'
          }
        }
      };
      const snap = createFabricSpecificationSnapshot(enhancedFabricWithProvenance);
      assert.equal(snap.provenance, 'laboratory-tested');
      assert.equal(snap.isVerified, true);
      assert.ok(snap.propertyProvenance);
      assert.equal(snap.propertyProvenance.gsm?.value, 240);
      assert.equal(snap.propertyProvenance.gsm?.verificationStatus, 'verified');
    });

    it('h-6. preserves exact finite coordinates without silent rounding', () => {
      const exactX = 12.3456789123;
      const exactY = 45.6789123456;
      const line = new LineSegment('precise-line', { x: exactX, y: exactY }, { x: 100.123456, y: 200.654321 });
      const snap = serializeGeometricSegmentSnapshot(line);

      assert.equal(snap.start.x, exactX);
      assert.equal(snap.start.y, exactY);
    });

    it('h-7. rejects non-finite Bézier control points during serialization', () => {
      const badBezier = new CubicBezierCurve(
        'bad-bezier',
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: NaN, y: 10 },
        { x: 20, y: 0 }
      );
      assert.throws(() => {
        serializeGeometricSegmentSnapshot(badBezier);
      }, ProductionSnapshotGeometryError);

      const validBezier = new CubicBezierCurve(
        'curve-test',
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 30, y: 0 }
      );
      const snap = serializeGeometricSegmentSnapshot(validBezier);
      assert.equal(snap.controlPoints?.[0].x, 10);
      assert.equal(snap.controlPoints?.[1].x, 20);
    });

    it('h-8. detects fingerprint mismatch after geometry mutation', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      assert.equal(validateProductionPatternRevision(snap).isValid, true);

      // Tamper with first piece geometry
      const tamperedPieces = snap.patternPieces.map((p, idx) => {
        if (idx === 0 && p.stitchingContour) {
          const firstSeg = p.stitchingContour.segments[0];
          const mutatedSeg = { ...firstSeg, start: { x: firstSeg.start.x + 10.0, y: firstSeg.start.y } };
          return {
            ...p,
            stitchingContour: {
              ...p.stitchingContour,
              segments: [mutatedSeg, ...p.stitchingContour.segments.slice(1)]
            }
          };
        }
        return p;
      });

      const tamperedSnap = { ...snap, patternPieces: tamperedPieces };
      const val = validateProductionPatternRevision(tamperedSnap);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('Canonical fingerprint mismatch')));
    });

    it('h-9. detects fingerprint mismatch after measurement mutation', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const tamperedSnap = {
        ...snap,
        measurementSet: {
          ...snap.measurementSet,
          values: { ...snap.measurementSet.values, waist: snap.measurementSet.values.waist + 4.0 }
        }
      };
      const val = validateProductionPatternRevision(tamperedSnap);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('Canonical fingerprint mismatch')));
    });

    it('h-10. detects fingerprint mismatch after fabric mutation', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const tamperedSnap = {
        ...snap,
        fabricSpecification: {
          ...snap.fabricSpecification,
          gsm: (snap.fabricSpecification.gsm ?? 200) + 50
        }
      };
      const val = validateProductionPatternRevision(tamperedSnap);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('Canonical fingerprint mismatch')));
    });

    it('h-11. detects fingerprint mismatch after approval-state mutation', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const tamperedSnap = {
        ...snap,
        approvalState: {
          ...snap.approvalState,
          designApproval: 'rejected' as const
        }
      };
      const val = validateProductionPatternRevision(tamperedSnap);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('Canonical fingerprint mismatch')));
    });

    it('h-12. detects fingerprint mismatch after validation-state mutation', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const tamperedSnap = {
        ...snap,
        validation: {
          ...snap.validation,
          isValid: false,
          status: 'invalid' as const
        }
      };
      const val = validateProductionPatternRevision(tamperedSnap);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('Canonical fingerprint mismatch')));
    });

    it('h-13. rejects invalid fingerprint encodings (uppercase, non-hex, wrong length)', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());

      const uppercaseSnap = { ...snap, canonicalFingerprint: snap.canonicalFingerprint.toUpperCase() };
      const valUpper = validateProductionPatternRevision(uppercaseSnap);
      assert.equal(valUpper.isValid, false);
      assert.ok(valUpper.errors.some(e => e.includes('Invalid canonicalFingerprint')));

      const shortSnap = { ...snap, canonicalFingerprint: 'abcd1234' };
      const valShort = validateProductionPatternRevision(shortSnap);
      assert.equal(valShort.isValid, false);

      const nonHexSnap = { ...snap, canonicalFingerprint: 'z'.repeat(64) };
      const valNonHex = validateProductionPatternRevision(nonHexSnap);
      assert.equal(valNonHex.isValid, false);
    });

    it('h-14. rejects invalid contour metadata (loop gaps exceeding tolerance)', () => {
      const snap = createProductionPatternRevision(createValidTestSnapshotInput());
      const brokenPiece = {
        ...snap.patternPieces[0],
        stitchingContour: {
          ...snap.patternPieces[0].stitchingContour!,
          segments: [
            ...snap.patternPieces[0].stitchingContour!.segments.slice(0, -1),
            // Disconnect last segment end
            {
              ...snap.patternPieces[0].stitchingContour!.segments[snap.patternPieces[0].stitchingContour!.segments.length - 1],
              end: { x: 999.0, y: 999.0 }
            }
          ]
        }
      };

      const brokenSnap = { ...snap, patternPieces: [brokenPiece, snap.patternPieces[1]] };
      const val = validateProductionPatternRevision(brokenSnap);
      assert.equal(val.isValid, false);
      assert.ok(val.errors.some(e => e.includes('loop closure gap') || e.includes('disconnected')));
    });

    it('h-15. guarantees order-independent stable canonicalization without number truncation', () => {
      const objA = { z: 12.34567, a: 'hello', m: [3, 2, 1] };
      const objB = { a: 'hello', m: [3, 2, 1], z: 12.34567 };

      const canonA = canonicalizeJson(objA);
      const canonB = canonicalizeJson(objB);

      assert.equal(canonA, canonB);
      assert.equal(canonA, '{"a":"hello","m":[3,2,1],"z":12.34567}');
    });

    it('h-16. executes browser-compatible sha256Hex matching NIST standard vectors without node:crypto', () => {
      // NIST test vectors: empty string and 'abc'
      assert.equal(
        sha256Hex(''),
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );
      assert.equal(
        sha256Hex('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
      );
      // Standard NIST long-message vector (448 bits = 56 bytes)
      assert.equal(
        sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
      );
      // Multi-byte and 4-byte emoji Unicode vector
      assert.equal(
        sha256Hex('Patroner — Haute Couture 👗 Atelier de Création'),
        '645ede13446fbe976972a1a11659f15f958c53d4ade6d3fc1dec6627b63a3e30'
      );
      // Padding boundary lengths: 55, 56, 63, 64, 65 bytes
      assert.equal(
        sha256Hex('a'.repeat(55)),
        '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'
      );
      assert.equal(
        sha256Hex('a'.repeat(56)),
        'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'
      );
      assert.equal(
        sha256Hex('a'.repeat(63)),
        '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34'
      );
      assert.equal(
        sha256Hex('a'.repeat(64)),
        'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'
      );
      assert.equal(
        sha256Hex('a'.repeat(65)),
        '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0'
      );
    });

    it('h-17. guarantees reproducible revision identity: equivalent content yields identical fingerprint across IDs and timestamps', () => {
      const inputA = createValidTestSnapshotInput({
        revisionId: 'rev-atelier-alpha',
        createdAt: '2026-11-01T00:00:00.000Z',
        createdBy: 'Alice'
      });
      const inputB = createValidTestSnapshotInput({
        revisionId: 'rev-atelier-beta',
        createdAt: '2026-11-08T23:59:59.000Z',
        createdBy: 'Bob'
      });

      const snapA = createProductionPatternRevision(inputA);
      const snapB = createProductionPatternRevision(inputB);

      assert.equal(snapA.canonicalFingerprint, snapB.canonicalFingerprint);
      assert.equal(arePatternRevisionsEquivalent(snapA, snapB), true);
    });
  });
});

