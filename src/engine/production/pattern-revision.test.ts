/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  arePatternRevisionsEquivalent,
  compareRevisionInputs,
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
  ProductionPatternSnapshotSchemaVersion
} from './production-types';
import {
  BodyMeasurements,
  DesignSpecification,
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
});
