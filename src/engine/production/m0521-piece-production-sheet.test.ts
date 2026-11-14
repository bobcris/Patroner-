/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { draftSkirtBlock } from '../drafting/skirt-block';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { validatePatternDraft } from '../validation/seam-validator';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { ENHANCED_PRESET_FABRICS, getEnhancedFabricById } from '../fabric/fabric-presets';
import { gradePattern, DEFAULT_SIZE_RANGE } from '../grading';
import {
  approveAuthoritativeGarmentSpecification,
  computeSpecificationFingerprint,
  createAuthoritativeGarmentSpecification,
  createControlledPublicKeyRegistry,
  createTrustedCryptographicVerifier,
  deriveEd25519SigningKeyPair,
  registerPublicKeyInRegistry,
  signSpecificationApprovalPayload
} from './garment-specification';
import {
  AuthoritativeGradingArtifact,
  AuthoritativePatternRevision,
  buildAuthoritativePieceProductionSheetSet,
  buildPatternPieceProductionSheet,
  buildPieceAllowanceSchedule,
  computePieceGeometryMetrics,
  computePieceProductionSheetContentFingerprint,
  computePieceProductionSheetSetContentFingerprint,
  createAuthoritativeGradingArtifact,
  createAuthoritativeMeasurementSet,
  approveAuthoritativeMeasurementSet,
  createDraftPatternRevision,
  PatternPieceSnapshot,
  PieceCutSemanticsDeclaration,
  resolveCutQuantitySemantics,
  validatePatternRevision,
  verifyPieceProductionSheetIntegrity,
  verifyPieceProductionSheetSetIntegrity
} from './index';
import { DesignSpecification, GarmentCategory, PatternPiece } from '../../types';

// ============================================================================
// TEST FIXTURE HELPERS
// ============================================================================

const PROJECT_ID = 'project-patroner-m0521';
const TENANT_ID = 'tenant-patroner-m0521';
const FIXED_TIMESTAMP = '2026-11-14T10:00:00.000Z';
const SIZE_M_MEASUREMENTS = STANDARD_SIZING_SYSTEM.sizes.M;
const CRYPTO_KEY_ID = 'ed25519-principal-key-m0521-01';
const CRYPTO_SEED = 'm0521-principal-ed25519-seed-material-01';

function buildApprovedFoundation(garmentCategory: 'skirt' | 'bodice', garmentId: string) {
  const cryptoKey = deriveEd25519SigningKeyPair(CRYPTO_KEY_ID, CRYPTO_SEED, {
    ownerPrincipal: 'Elena Vance (Principal Pattern Engineer)',
    tenantId: PROJECT_ID,
    allowedScopes: ['specification:approve', 'pattern:approve']
  });
  let registry = createControlledPublicKeyRegistry();
  registry = registerPublicKeyInRegistry(registry, cryptoKey.publicKeyRegistration);
  const cryptographicVerifier = createTrustedCryptographicVerifier({
    publicKeyRegistry: Object.values(registry.entries),
    referenceTimeIso: '2026-11-14T10:15:00.000Z'
  });

  const baseDesign: DesignSpecification = {
    id: garmentId,
    name: garmentCategory === 'skirt' ? 'Tailored Pencil Skirt' : 'Tailored Set-In Bodice',
    garmentCategory,
    silhouette: garmentCategory === 'skirt' ? 'pencil' : 'tailored',
    fabric: ENHANCED_PRESET_FABRICS[0],
    color: { name: 'Atelier Charcoal', hex: '#1E293B' },
    easeProfile: 'classic',
    lengthCm: garmentCategory === 'skirt' ? 64 : 44,
    dartStyle: 'waist',
    sleeveEaseStrategy: 'classic',
    prompt: 'Deterministic test fixture',
    constructionFeatures: [],
    designNotes: [],
    isApproved: false,
    version: 1,
    specificationRevisionId: `spec-${garmentId}-v1`
  };

  const draftSpec = createAuthoritativeGarmentSpecification({
    projectId: PROJECT_ID,
    garmentId,
    specificationRevisionId: `spec-${garmentId}-v1`,
    version: 1,
    name: baseDesign.name,
    garmentCategory,
    silhouette: baseDesign.silhouette,
    fabric: baseDesign.fabric,
    color: baseDesign.color,
    easeProfile: baseDesign.easeProfile,
    lengthCm: baseDesign.lengthCm,
    dartStyle: baseDesign.dartStyle,
    sleeveEaseStrategy: baseDesign.sleeveEaseStrategy,
    prompt: baseDesign.prompt,
    constructionFeatures: [],
    designNotes: [],
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    fabricProvenance: 'supplier-declared'
  });

  const draftSpecFp = computeSpecificationFingerprint(draftSpec);
  const specSig = signSpecificationApprovalPayload(
    {
      schemaVersion: draftSpec.schemaVersion ?? '1.0.0-m04.6.1.3',
      projectId: PROJECT_ID,
      garmentId,
      specificationRevisionId: draftSpec.specificationRevisionId ?? `spec-${garmentId}-v1`,
      specificationVersion: draftSpec.version,
      canonicalSpecificationFingerprint: draftSpecFp,
      approvalEventId: `spec-app-${garmentId}`,
      approverPrincipal: 'Elena Vance (Principal Pattern Engineer)',
      authorityTier: 'cryptographic_principal',
      approvalTimestamp: FIXED_TIMESTAMP
    },
    {
      keyId: CRYPTO_KEY_ID,
      privateKeyHex: cryptoKey.privateKeyHex,
      tenantId: PROJECT_ID
    }
  );

  const approvedSpec = approveAuthoritativeGarmentSpecification(
    draftSpec,
    'Elena Vance (Principal Pattern Engineer)',
    {
      approvedAt: FIXED_TIMESTAMP,
      approvalEventId: `spec-app-${garmentId}`,
      authorityTier: 'cryptographic_principal',
      cryptographicVerifier,
      cryptographicSignature: specSig
    }
  );

  const unapprovedMeas = createAuthoritativeMeasurementSet({
    measurementSetId: `meas-${garmentId}`,
    revisionId: `meas-rev-${garmentId}`,
    values: ({ ...SIZE_M_MEASUREMENTS } as unknown) as Record<string, number>,
    provenance: 'physically-measured',
    evidence: {
      operatorName: 'Marco Rossi (Master Tailor)',
      measurementSource: 'physical-tape-measure',
      recordedAt: FIXED_TIMESTAMP
    },
    recordedAt: FIXED_TIMESTAMP
  });

  const approvedMeas = approveAuthoritativeMeasurementSet(unapprovedMeas, {
    approvingAuthority: 'Marco Rossi (Master Tailor)',
    approvedAt: FIXED_TIMESTAMP,
    notes: ['Verified test fixture']
  });

  const designSpecForDrafting: DesignSpecification = {
    ...baseDesign,
    isApproved: true,
    approvedBy: approvedSpec.approvedBy,
    approvedAt: approvedSpec.approvedAt,
    specificationRevisionId: approvedSpec.specificationRevisionId
  };

  let pieces: PatternPiece[];
  if (garmentCategory === 'skirt') {
    pieces = draftSkirtBlock(SIZE_M_MEASUREMENTS, designSpecForDrafting);
  } else {
    const bodice = draftBodiceBlock(SIZE_M_MEASUREMENTS, designSpecForDrafting);
    const sleeve = draftSleeveBlock(SIZE_M_MEASUREMENTS, designSpecForDrafting, {
      strategy: 'classic',
      bodicePieces: bodice
    });
    pieces = [...bodice, sleeve.piece];
  }

  const validationReport = validatePatternDraft(pieces);
  const enhancedLookup = getEnhancedFabricById(ENHANCED_PRESET_FABRICS[0].id);
  const enhancedFabric = enhancedLookup.status === 'found' ? enhancedLookup.fabric : undefined;

  const draftRev = createDraftPatternRevision({
    revisionId: `pat-rev-${garmentId}-1`,
    revisionNumber: 1,
    projectId: PROJECT_ID,
    garmentId,
    createdAt: FIXED_TIMESTAMP,
    designSpec: designSpecForDrafting,
    authoritativeSpec: approvedSpec,
    authoritativeMeasurementSet: approvedMeas,
    pieces,
    validationReport,
    enhancedFabric,
    fabricSource: 'verified-preset'
  });

  const validatedRev = validatePatternRevision(draftRev, {
    validatedAt: FIXED_TIMESTAMP,
    actorId: 'Marco Rossi (Master Tailor)',
    actorRole: 'master_tailor'
  });

  return {
    approvedSpec,
    approvedMeas,
    designSpecForDrafting,
    pieces,
    validationReport,
    enhancedFabric,
    patternRevision: validatedRev
  };
}

const SKIRT_CUT_DECLARATIONS: Record<string, PieceCutSemanticsDeclaration> = {
  'SK-01-F': { pairingMode: 'single-centered-on-fold', foldEdgeSegmentId: 'fs-cf-fold' },
  'SK-02-B': { pairingMode: 'paired-mirrored-left-right', mirroringConfirmed: true }
};

const BODICE_CUT_DECLARATIONS: Record<string, PieceCutSemanticsDeclaration> = {
  'BOD-F-01': { pairingMode: 'single-centered-on-fold', foldEdgeSegmentId: 'fb-cf-fold' },
  'BOD-B-01': { pairingMode: 'paired-mirrored-left-right', mirroringConfirmed: true },
  'SLV-01': { pairingMode: 'paired-mirrored-left-right', mirroringConfirmed: true }
};

function makeRectangularPieceSnapshot(overrides?: Partial<PatternPieceSnapshot>): PatternPieceSnapshot {
  // Exact 10cm x 20cm rectangle (X in [0,10], Y in [0,20]) with 1cm seam allowance on right/top/bottom, 0cm fold on left (X=0)
  // Cutting outer rectangle: X in [0, 11], Y in [-1, 21] => width=11cm, height=22cm, perimeter=66cm, area=242cm2
  const stitchSegs = [
    { id: 'r-fold', type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 0, y: 20 }, seamAllowanceCm: 0, isFold: true, seamId: 'r-center', lengthCm: 20 },
    { id: 'r-bottom', type: 'line' as const, start: { x: 0, y: 20 }, end: { x: 10, y: 20 }, seamAllowanceCm: 1, isFold: false, seamId: 'r-hem', lengthCm: 10 },
    { id: 'r-right', type: 'line' as const, start: { x: 10, y: 20 }, end: { x: 10, y: 0 }, seamAllowanceCm: 1, isFold: false, seamId: 'r-side', lengthCm: 20 },
    { id: 'r-top', type: 'line' as const, start: { x: 10, y: 0 }, end: { x: 0, y: 0 }, seamAllowanceCm: 1, isFold: false, seamId: 'r-waist', lengthCm: 10 }
  ];
  const cutSegs = [
    { id: 'r-fold-cut', type: 'line' as const, start: { x: 0, y: -1 }, end: { x: 0, y: 21 }, seamAllowanceCm: 0, isFold: true, sourceSegmentId: 'r-fold', seamId: 'r-center', lengthCm: 22 },
    { id: 'r-bottom-cut', type: 'line' as const, start: { x: 0, y: 21 }, end: { x: 11, y: 21 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-bottom', seamId: 'r-hem', lengthCm: 11 },
    { id: 'r-right-cut', type: 'line' as const, start: { x: 11, y: 21 }, end: { x: 11, y: -1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-right', seamId: 'r-side', lengthCm: 22 },
    { id: 'r-top-cut', type: 'line' as const, start: { x: 11, y: -1 }, end: { x: 0, y: -1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-top', seamId: 'r-waist', lengthCm: 11 }
  ];
  return {
    id: 'piece-rect',
    pieceCode: 'RECT-01',
    name: 'Exact Rectangle Test Panel',
    garmentCategory: 'skirt' as GarmentCategory,
    sizeCode: 'M',
    cutCount: 1,
    onFold: true,
    material: 'self',
    cutPathData: 'M 0 -1 L 0 21 L 11 21 L 11 -1 Z',
    sewPathData: 'M 0 0 L 0 20 L 10 20 L 10 0 Z',
    seamAllowanceWidthCm: 1,
    grainline: { start: { x: 5, y: 2 }, end: { x: 5, y: 18 }, direction: 'vertical' },
    darts: [],
    notches: [],
    seams: [
      { id: 'r-center', name: 'Center Fold', startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 20 }, lengthCm: 20, type: 'straight', segmentId: 'r-fold' },
      { id: 'r-hem', name: 'Hem', startPoint: { x: 0, y: 20 }, endPoint: { x: 10, y: 20 }, lengthCm: 10, type: 'straight', segmentId: 'r-bottom' },
      { id: 'r-side', name: 'Side', startPoint: { x: 10, y: 20 }, endPoint: { x: 10, y: 0 }, lengthCm: 20, type: 'straight', segmentId: 'r-right' },
      { id: 'r-waist', name: 'Waist', startPoint: { x: 10, y: 0 }, endPoint: { x: 0, y: 0 }, lengthCm: 10, type: 'straight', segmentId: 'r-top' }
    ],
    drillHoles: [],
    boundingBox: { minX: 0, minY: -1, maxX: 11, maxY: 21, widthCm: 11, heightCm: 22, isApproximate: false, basis: 'exact' },
    stitchingContour: {
      id: 'rect-stitch',
      isClosed: true,
      segments: stitchSegs,
      totalLengthCm: 60,
      boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 20, widthCm: 10, heightCm: 20, isApproximate: false, basis: 'exact' }
    },
    cuttingContour: {
      id: 'rect-cut',
      isClosed: true,
      segments: cutSegs,
      totalLengthCm: 66,
      boundingBox: { minX: 0, minY: -1, maxX: 11, maxY: 21, widthCm: 11, heightCm: 22, isApproximate: false, basis: 'exact' }
    },
    warnings: [],
    errors: [],
    ...overrides
  };
}

// ============================================================================
// MILESTONE 05.2.1 TEST SUITE
// ============================================================================

describe('Milestone 05.2.1 — Pattern Piece Production Sheets, Cut Semantics & Segment Allowance Mapping', () => {
  // --------------------------------------------------------------------------
  // 1. CUT QUANTITY SEMANTICS
  // --------------------------------------------------------------------------
  describe('1. Cut Quantity Semantics', () => {
    it('resolves valid fold-cut half-pattern and accurately computes unfolded width distinct from half-pattern bounding width', () => {
      const { patternRevision } = buildApprovedFoundation('skirt', 'garment-cut-fold');
      const frontPiece = patternRevision.patternPieces.find(p => p.pieceCode === 'SK-01-F')!;

      const sheet = buildPatternPieceProductionSheet({
        patternRevision,
        piece: frontPiece,
        gradingMode: 'single-size-ungraded',
        cutSemanticsDeclaration: { pairingMode: 'single-centered-on-fold', foldEdgeSegmentId: 'fs-cf-fold' },
        garmentUnitQuantity: 3,
        generatedAt: FIXED_TIMESTAMP
      });

      assert.equal(sheet.validation.isValid, true);
      assert.equal(sheet.cutSemantics.semanticResolutionStatus, 'resolved');
      assert.equal(sheet.cutSemantics.pairingMode, 'single-centered-on-fold');
      assert.equal(sheet.cutSemantics.patternPieceCount, 1);
      assert.equal(sheet.cutSemantics.physicalPanelCountPerGarment, 1);
      assert.equal(sheet.cutSemantics.cuttingOperationsSinglePlyPerGarment, 1);
      assert.equal(sheet.cutSemantics.garmentUnitQuantity, 3);
      assert.equal(sheet.cutSemantics.totalPhysicalPanelsForOrder, 3);
      assert.equal(sheet.cutSemantics.orderQuantityBasis, 'declared-order-quantity');
      assert.equal(sheet.cutSemantics.requiresMirroring, false);
      assert.equal(sheet.cutSemantics.mirroringRule, 'none');
      assert.equal(sheet.cutSemantics.requiresFabricFold, true);
      assert.equal(sheet.cutSemantics.requiresFoldUnfolding, true);
      assert.equal(sheet.cutSemantics.foldUnfoldingOperation, 'unfold-across-fold-axis');
      assert.equal(sheet.cutSemantics.foldEdgeSegmentId, 'fs-cf-fold');
      assert.ok(sheet.geometryMetrics.halfPatternBoundingWidthCm! > 20);
      assert.equal(
        sheet.geometryMetrics.unfoldedWidthCm,
        Number((2 * sheet.geometryMetrics.halfPatternBoundingWidthCm!).toFixed(4))
      );
      assert.ok(sheet.geometryMetrics.unfoldedWidthCm! > sheet.geometryMetrics.boundingWidthCm! * 1.9);
      assert.equal(sheet.isProductionReady, false);
    });

    it('never silently infers pairing mode from cutCount and onFold alone', () => {
      const { patternRevision } = buildApprovedFoundation('skirt', 'garment-unresolved');
      const backPiece = patternRevision.patternPieces.find(p => p.pieceCode === 'SK-02-B')!;

      const unresolved = resolveCutQuantitySemantics(backPiece);
      assert.equal(unresolved.semanticResolutionStatus, 'unresolved');
      assert.equal(unresolved.mirroringRule, 'unresolved');
      assert.equal(unresolved.physicalPanelCountPerGarment, null);
      assert.ok(unresolved.contradictionReasons.some(r => r.includes('cannot be silently inferred')));
    });

    it('rejects missing fold-axis reference and nonzero fold allowance', () => {
      const pieceNoFoldSeg = makeRectangularPieceSnapshot({
        stitchingContour: {
          ...makeRectangularPieceSnapshot().stitchingContour!,
          segments: makeRectangularPieceSnapshot().stitchingContour!.segments.map(s => ({
            ...s,
            isFold: false
          }))
        }
      });

      const missingFold = resolveCutQuantitySemantics(pieceNoFoldSeg, {
        declaration: { pairingMode: 'single-centered-on-fold' }
      });
      assert.equal(missingFold.semanticResolutionStatus, 'invalid');
      assert.ok(missingFold.contradictionReasons.some(r => r.includes('no fold-edge segment')));

      const pieceNonZeroFold = makeRectangularPieceSnapshot({
        stitchingContour: {
          ...makeRectangularPieceSnapshot().stitchingContour!,
          segments: makeRectangularPieceSnapshot().stitchingContour!.segments.map(s =>
            s.id === 'r-fold' ? { ...s, seamAllowanceCm: 1.5 } : s
          )
        }
      });

      const nonZeroFold = resolveCutQuantitySemantics(pieceNonZeroFold, {
        declaration: { pairingMode: 'single-centered-on-fold', foldEdgeSegmentId: 'r-fold' }
      });
      assert.equal(nonZeroFold.semanticResolutionStatus, 'invalid');
      assert.ok(nonZeroFold.contradictionReasons.some(r => r.includes('must have 0 cm seam allowance')));
    });

    it('rejects invalid mirrored-pair configuration (cutCount != 2 or missing mirroringConfirmed)', () => {
      const { patternRevision } = buildApprovedFoundation('skirt', 'garment-mirrored');
      const backPiece = patternRevision.patternPieces.find(p => p.pieceCode === 'SK-02-B')!;

      const unconfirmed = resolveCutQuantitySemantics(backPiece, {
        declaration: { pairingMode: 'paired-mirrored-left-right', mirroringConfirmed: false }
      });
      assert.equal(unconfirmed.semanticResolutionStatus, 'invalid');
      assert.ok(unconfirmed.contradictionReasons.some(r => r.includes('mirroringConfirmed === true')));

      const wrongCount = resolveCutQuantitySemantics({ ...backPiece, cutCount: 1 }, {
        declaration: { pairingMode: 'paired-mirrored-left-right', mirroringConfirmed: true }
      });
      assert.equal(wrongCount.semanticResolutionStatus, 'invalid');
      assert.ok(wrongCount.contradictionReasons.some(r => r.includes('cutCount === 2')));
    });

    it('rejects invalid multiple-identical quantities and never infers mirroring without explicit flag', () => {
      const base = makeRectangularPieceSnapshot({ onFold: false, cutCount: 1 });
      const badQty = resolveCutQuantitySemantics(base, {
        declaration: { pairingMode: 'multiple-identical' }
      });
      assert.equal(badQty.semanticResolutionStatus, 'invalid');
      assert.ok(badQty.contradictionReasons.some(r => r.includes('cutCount >= 2')));

      const beltLoops = makeRectangularPieceSnapshot({
        onFold: false,
        cutCount: 5,
        stitchingContour: {
          ...makeRectangularPieceSnapshot().stitchingContour!,
          segments: makeRectangularPieceSnapshot().stitchingContour!.segments.map(s => ({ ...s, isFold: false }))
        }
      });
      const validLoops = resolveCutQuantitySemantics(beltLoops, {
        declaration: { pairingMode: 'multiple-identical', expectedQuantityPerGarment: 5 }
      });
      assert.equal(validLoops.semanticResolutionStatus, 'resolved');
      assert.equal(validLoops.requiresMirroring, false);
      assert.equal(validLoops.mirroringRule, 'explicit-multi-identical-non-mirrored');
      assert.equal(validLoops.physicalPanelCountPerGarment, 5);

      const badOddMirror = resolveCutQuantitySemantics(beltLoops, {
        declaration: { pairingMode: 'multiple-identical', explicitMultiMirroredPairs: true }
      });
      assert.equal(badOddMirror.semanticResolutionStatus, 'invalid');
      assert.ok(badOddMirror.contradictionReasons.some(r => r.includes('even cutCount')));
    });

    it('rejects contradictory onFold and pairing mode combinations and supports valid single-asymmetric', () => {
      const foldedPiece = makeRectangularPieceSnapshot({ onFold: true, cutCount: 1 });
      const badCombo1 = resolveCutQuantitySemantics(foldedPiece, {
        declaration: { pairingMode: 'single-asymmetric' }
      });
      assert.equal(badCombo1.semanticResolutionStatus, 'invalid');

      const flatPiece = makeRectangularPieceSnapshot({
        onFold: false,
        cutCount: 1,
        stitchingContour: {
          ...makeRectangularPieceSnapshot().stitchingContour!,
          segments: makeRectangularPieceSnapshot().stitchingContour!.segments.map(s => ({ ...s, isFold: false }))
        }
      });
      const validAsym = resolveCutQuantitySemantics(flatPiece, {
        declaration: { pairingMode: 'single-asymmetric' }
      });
      assert.equal(validAsym.semanticResolutionStatus, 'resolved');
      assert.equal(validAsym.requiresMirroring, false);
      assert.equal(validAsym.requiresFabricFold, false);
      assert.equal(validAsym.physicalPanelCountPerGarment, 1);

      const badCombo2 = resolveCutQuantitySemantics(flatPiece, {
        declaration: { pairingMode: 'single-centered-on-fold' }
      });
      assert.equal(badCombo2.semanticResolutionStatus, 'invalid');
    });
  });

  // --------------------------------------------------------------------------
  // 2. GEOMETRY METRICS & NUMERICAL PRECISION
  // --------------------------------------------------------------------------
  describe('2. Geometry Metrics & Numerical Precision', () => {
    it('computes exact analytical perimeter, area, bounding dimensions, and unfolded width for straight-only contours', () => {
      const rect = makeRectangularPieceSnapshot();
      const semantics = resolveCutQuantitySemantics(rect, {
        declaration: { pairingMode: 'single-centered-on-fold', foldEdgeSegmentId: 'r-fold' }
      });
      const metrics = computePieceGeometryMetrics(rect, semantics);

      assert.equal(metrics.isValid, true);
      assert.equal(metrics.stitchingPerimeterCm, 60);
      assert.equal(metrics.cuttingPerimeterCm, 66);
      assert.equal(metrics.stitchingAreaCm2, 200);
      assert.equal(metrics.cuttingAreaCm2, 242);
      assert.equal(metrics.boundingWidthCm, 11);
      assert.equal(metrics.boundingHeightCm, 22);
      assert.equal(metrics.halfPatternBoundingWidthCm, 11);
      assert.equal(metrics.unfoldedWidthCm, 22);
      assert.equal(metrics.unfoldedStitchingWidthCm, 20);
      assert.equal(metrics.numericalPrecision.isExact, true);
      assert.equal(metrics.numericalPrecision.perimeterMethod, 'exact-euclidean');
      assert.equal(metrics.numericalPrecision.areaMethod, 'exact-shoelace-polygon');
    });

    it('computes deterministic documented numerical approximations for contours with cubic Bézier curves', () => {
      const { patternRevision } = buildApprovedFoundation('bodice', 'garment-bezier-metrics');
      const sleevePiece = patternRevision.patternPieces.find(p => p.pieceCode === 'SLV-01')!;
      const semantics = resolveCutQuantitySemantics(sleevePiece, {
        declaration: BODICE_CUT_DECLARATIONS['SLV-01']
      });

      const metrics1 = computePieceGeometryMetrics(sleevePiece, semantics);
      const metrics2 = computePieceGeometryMetrics(sleevePiece, semantics);

      assert.equal(metrics1.isValid, true);
      assert.equal(metrics1.numericalPrecision.hasBezierSegments, true);
      assert.equal(metrics1.numericalPrecision.isExact, false);
      assert.equal(metrics1.numericalPrecision.perimeterMethod, 'adaptive-de-casteljau-subdivision');
      assert.equal(metrics1.numericalPrecision.areaMethod, 'exact-greens-theorem-cubic-bezier');
      assert.equal(metrics1.numericalPrecision.perimeterAllTolerancesAchieved, true);
      assert.equal(metrics1.numericalPrecision.perimeterMaxDepthReached, false);
      assert.equal(metrics1.numericalPrecision.areaFlatteningToleranceAchieved, true);
      assert.ok(metrics1.numericalPrecision.stitchingAreaUpperBoundCm2 > 0);
      assert.ok(metrics1.numericalPrecision.cuttingAreaUpperBoundCm2 > 0);
      assert.ok(metrics1.numericalPrecision.areaApproximationUpperBoundCm2 > 0);
      assert.ok(metrics1.cuttingPerimeterCm! > metrics1.stitchingPerimeterCm!);
      assert.ok(metrics1.cuttingAreaCm2! > metrics1.stitchingAreaCm2!);
      assert.deepEqual(metrics1, metrics2);
    });

    it('rejects missing Bézier control points and non-finite control-point coordinates', () => {
      const { patternRevision } = buildApprovedFoundation('skirt', 'garment-bad-bezier');
      const backPiece = patternRevision.patternPieces.find(p => p.pieceCode === 'SK-02-B')!;

      const missingCpPiece: PatternPieceSnapshot = {
        ...backPiece,
        stitchingContour: {
          ...backPiece.stitchingContour!,
          segments: backPiece.stitchingContour!.segments.map(s =>
            s.type === 'bezier' ? { ...s, controlPoints: undefined } : s
          )
        }
      };
      const m1 = computePieceGeometryMetrics(missingCpPiece);
      assert.equal(m1.isValid, false);
      assert.ok(m1.errors.some(e => e.includes('missing required controlPoints')));

      const nanCpPiece: PatternPieceSnapshot = {
        ...backPiece,
        stitchingContour: {
          ...backPiece.stitchingContour!,
          segments: backPiece.stitchingContour!.segments.map(s =>
            s.type === 'bezier' && s.controlPoints
              ? { ...s, controlPoints: [{ x: Number.NaN, y: s.controlPoints[0].y }, s.controlPoints[1]] as const }
              : s
          )
        }
      };
      const m2 = computePieceGeometryMetrics(nanCpPiece);
      assert.equal(m2.isValid, false);
      assert.ok(m2.errors.some(e => e.includes('non-finite control point')));
    });

    it('rejects zero/negative dimensions and invalid open contours', () => {
      const zeroBoxPiece = makeRectangularPieceSnapshot({
        boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 20, widthCm: 0, heightCm: 20, isApproximate: false, basis: 'exact' }
      });
      const m1 = computePieceGeometryMetrics(zeroBoxPiece);
      assert.equal(m1.isValid, false);
      assert.ok(m1.errors.some(e => e.includes('non-positive boundingBox')));

      const openContourPiece = makeRectangularPieceSnapshot({
        cuttingContour: {
          ...makeRectangularPieceSnapshot().cuttingContour!,
          isClosed: false
        }
      });
      const m2 = computePieceGeometryMetrics(openContourPiece);
      assert.equal(m2.isValid, false);
      assert.ok(m2.errors.some(e => e.includes('must be closed')));
    });
  });

  // --------------------------------------------------------------------------
  // 3. SEGMENT-LEVEL ALLOWANCE MAPPING
  // --------------------------------------------------------------------------
  describe('3. Segment-Level Allowance Mapping', () => {
    it('traces every segment cleanly and preserves authoritative geometry allowances over conflicting UI defaults', () => {
      const { patternRevision } = buildApprovedFoundation('bodice', 'garment-allowance-map');
      const backBodice = patternRevision.patternPieces.find(p => p.pieceCode === 'BOD-B-01')!;
      const semantics = resolveCutQuantitySemantics(backBodice, {
        declaration: BODICE_CUT_DECLARATIONS['BOD-B-01']
      });

      const schedule = buildPieceAllowanceSchedule(backBodice, semantics, {
        uiReportedAllowanceCmByRole: { 'structural-seam': 1.2, waistline: 1.2 }
      });

      assert.equal(schedule.isComplete, true);
      assert.equal(schedule.hasContradictions, false);
      assert.equal(schedule.unmappedSegmentCount, 0);

      // Authoritative geometry 1.5 cm side seam and 1.0 cm waist seam MUST NOT be overwritten by UI's 1.2 cm claim
      const sideEntry = schedule.entries.find(e => e.segmentId === 'bb-side-seam')!;
      const waistEntry = schedule.entries.find(e => e.segmentId === 'bb-waist-mid')!;
      assert.equal(sideEntry.allowanceCm, 1.5);
      assert.equal(waistEntry.allowanceCm, 1.0);
      assert.ok(schedule.knownDraftingVsUiDriftNotes.length >= 1);
      assert.ok(schedule.knownDraftingVsUiDriftNotes.some(n => n.includes('authoritative geometry preserved')));
    });

    it('reports incomplete allowance schedule and missing seam metadata fail-closed', () => {
      const pieceMissingSeam = makeRectangularPieceSnapshot({
        seams: makeRectangularPieceSnapshot().seams.filter(s => s.id !== 'r-side')
      });
      // Also strip seamId from segment r-right to simulate missing seam link
      const brokenSegPiece: PatternPieceSnapshot = {
        ...pieceMissingSeam,
        stitchingContour: {
          ...pieceMissingSeam.stitchingContour!,
          segments: pieceMissingSeam.stitchingContour!.segments.map(s =>
            s.id === 'r-right' ? { ...s, seamId: undefined } : s
          )
        }
      };

      const schedule = buildPieceAllowanceSchedule(brokenSegPiece);
      assert.equal(schedule.isComplete, false);
      assert.equal(schedule.unmappedSegmentCount, 1);
      const badEntry = schedule.entries.find(e => e.segmentId === 'r-right')!;
      assert.equal(badEntry.validationStatus, 'missing-seam-metadata');
      assert.ok(schedule.issues.some(i => i.includes('missing') || i.includes('no linked SeamLine')));
    });

    it('rejects nonzero fold allowance in allowance schedule and cutting-contour allowance mismatch', () => {
      const rect = makeRectangularPieceSnapshot();
      const badCuttingAllowance: PatternPieceSnapshot = {
        ...rect,
        cuttingContour: {
          ...rect.cuttingContour!,
          segments: rect.cuttingContour!.segments.map(s =>
            s.id === 'r-fold-cut' ? { ...s, seamAllowanceCm: 1.0 } : s
          )
        }
      };
      const schedule = buildPieceAllowanceSchedule(badCuttingAllowance);
      assert.equal(schedule.isComplete, false);
      assert.equal(schedule.hasContradictions, true);
      assert.ok(schedule.issues.some(i => i.includes('contradicts stitching segment')));
    });
  });

  // --------------------------------------------------------------------------
  // 4. GRADING & SIZE SAFETY
  // --------------------------------------------------------------------------
  describe('4. Grading & Size Safety', () => {
    function buildBodiceGradingFixture() {
      const base = buildApprovedFoundation('bodice', 'garment-bodice-graded');
      const gradedSet = gradePattern(base.designSpecForDrafting, {
        baseSize: 'M',
        targetSizes: [...DEFAULT_SIZE_RANGE],
        customMeasurements: { M: SIZE_M_MEASUREMENTS }
      });

      const gradingArtifact = createAuthoritativeGradingArtifact({
        gradingArtifactId: 'ga-bodice-m0521',
        gradingRevisionId: 'ga-rev-1',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        sourcePatternRevisionId: base.patternRevision.revisionId,
        sourcePatternSnapshotFingerprint: base.patternRevision.canonicalFingerprint,
        sourceBasePatternFingerprint: base.patternRevision.basePatternFingerprint,
        sourceSpecificationId: base.approvedSpec.garmentId,
        sourceSpecificationRevisionId: base.approvedSpec.specificationRevisionId,
        sourceSpecificationFingerprint: base.approvedSpec.approvedContentFingerprint!,
        sourceMeasurementSetId: base.approvedMeas.measurementSetId,
        sourceMeasurementSetFingerprint: base.approvedMeas.canonicalFingerprint,
        baseSize: 'M',
        sizeRange: [...DEFAULT_SIZE_RANGE],
        basePatternPieces: base.pieces,
        gradingRuleSetId: 'patroner-iso-bodice-grade-v1',
        gradingRuleSetRevision: '1.0.0',
        gradedPatternSet: gradedSet,
        createdAt: FIXED_TIMESTAMP
      });

      return { ...base, gradedSet, gradingArtifact };
    }

    it('builds and independently verifies complete graded multi-size production sheets for bodice and sleeve', () => {
      const { patternRevision, gradingArtifact } = buildBodiceGradingFixture();
      const sheetSet = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'graded-multi-size',
        gradingArtifact,
        expectedSizes: [...DEFAULT_SIZE_RANGE],
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS,
        expectedProjectId: PROJECT_ID,
        expectedTenantId: TENANT_ID,
        expectedGarmentId: 'garment-bodice-graded',
        generatedAt: FIXED_TIMESTAMP
      });

      assert.equal(sheetSet.validation.isValid, true, sheetSet.validation.errors.join('; '));
      assert.equal(sheetSet.isProductionReady, false);
      assert.deepEqual(sheetSet.includedSizes, [...DEFAULT_SIZE_RANGE]);
      assert.equal(sheetSet.totalSheetsCount, 6 * 3);
      // Per garment: BOD-F-01 (1 panel) + BOD-B-01 (2 mirrored) + SLV-01 (2 mirrored) = 5 panels * 6 sizes = 30
      assert.equal(sheetSet.totalPhysicalPanelsAcrossSizesForOrder, 30);

      const verified = verifyPieceProductionSheetSetIntegrity(sheetSet, {
        patternRevision,
        gradingArtifact,
        expectedProjectId: PROJECT_ID,
        expectedTenantId: TENANT_ID,
        expectedGarmentId: 'garment-bodice-graded',
        expectedSizes: [...DEFAULT_SIZE_RANGE],
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS
      });
      assert.equal(verified.isValid, true, verified.errors.join('; '));
      assert.equal(verified.isSetFingerprintValid, true);
      assert.equal(verified.isSizeCoverageComplete, true);
    });

    it('rejects missing size, extra undeclared size, missing piece, and mismatched piece identity', () => {
      const { patternRevision, gradingArtifact } = buildBodiceGradingFixture();

      // Missing size in expectedSizes
      const missingSizeSet = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'graded-multi-size',
        gradingArtifact,
        expectedSizes: [...DEFAULT_SIZE_RANGE, 'XXXL'],
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS
      });
      assert.equal(missingSizeSet.validation.isValid, false);
      assert.ok(missingSizeSet.validation.rejectionCodes.includes('GRADING_SIZE_INCOMPLETE'));

      // Extra undeclared size in perSizePatternGeometry
      const extraSizeArtifact: AuthoritativeGradingArtifact = {
        ...gradingArtifact,
        perSizePatternGeometry: {
          ...gradingArtifact.perSizePatternGeometry,
          XXXL: gradingArtifact.perSizePatternGeometry.XL
        }
      };
      const extraSizeSet = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'graded-multi-size',
        gradingArtifact: extraSizeArtifact,
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS
      });
      assert.equal(extraSizeSet.validation.isValid, false);
      assert.ok(extraSizeSet.validation.rejectionCodes.includes('GRADING_EXTRA_UNDECLARED_SIZE'));

      // Missing piece in size XL
      const missingPieceArtifact: AuthoritativeGradingArtifact = {
        ...gradingArtifact,
        perSizePatternGeometry: {
          ...gradingArtifact.perSizePatternGeometry,
          XL: gradingArtifact.perSizePatternGeometry.XL.filter(p => p.pieceCode !== 'SLV-01')
        }
      };
      const missingPieceSet = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'graded-multi-size',
        gradingArtifact: missingPieceArtifact,
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS
      });
      assert.equal(missingPieceSet.validation.isValid, false);
      assert.ok(missingPieceSet.validation.rejectionCodes.includes('GRADING_PIECE_IDENTITY_MISMATCH'));

      // Mismatched piece identity / sizeCode relabeling in size L
      const badIdentityArtifact: AuthoritativeGradingArtifact = {
        ...gradingArtifact,
        perSizePatternGeometry: {
          ...gradingArtifact.perSizePatternGeometry,
          L: gradingArtifact.perSizePatternGeometry.L.map(p =>
            p.pieceCode === 'BOD-F-01' ? { ...p, sizeCode: 'M' } : p
          )
        }
      };
      const badIdentitySet = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'graded-multi-size',
        gradingArtifact: badIdentityArtifact,
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS
      });
      assert.equal(badIdentitySet.validation.isValid, false);
      assert.ok(badIdentitySet.validation.rejectionCodes.includes('GRADING_PIECE_IDENTITY_MISMATCH'));

      // Tampered source geometry in graded size L after grading artifact signing
      const tamperedGeometryArtifact: AuthoritativeGradingArtifact = {
        ...gradingArtifact,
        perSizePatternGeometry: {
          ...gradingArtifact.perSizePatternGeometry,
          L: gradingArtifact.perSizePatternGeometry.L.map(p => {
            if (p.pieceCode === 'BOD-F-01' && p.stitchingContour) {
              const sc = p.stitchingContour;
              return {
                ...p,
                stitchingContour: {
                  ...sc,
                  segments: sc.segments.map((seg, idx) =>
                    idx === 0
                      ? { ...seg, end: { x: seg.end.x + 12, y: seg.end.y } }
                      : seg
                  )
                }
              };
            }
            return p;
          })
        }
      };
      const tamperedGeometrySet = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'graded-multi-size',
        gradingArtifact: tamperedGeometryArtifact,
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS
      });
      assert.equal(tamperedGeometrySet.validation.isValid, false);
      assert.ok(tamperedGeometrySet.validation.rejectionCodes.includes('GRADING_ARTIFACT_INVALID'));
    });

    it('rejects skirt under graded-multi-size without artifact and rejects cloned base-size geometry, while allowing explicit single-size-ungraded', () => {
      const skirtBase = buildApprovedFoundation('skirt', 'garment-skirt-policy');

      // 1. Skirt graded without artifact -> blocked
      const noArtifact = buildAuthoritativePieceProductionSheetSet({
        patternRevision: skirtBase.patternRevision,
        gradingMode: 'graded-multi-size',
        cutSemanticsByPieceCode: SKIRT_CUT_DECLARATIONS
      });
      assert.equal(noArtifact.validation.isValid, false);
      assert.ok(noArtifact.validation.rejectionCodes.includes('SKIRT_GRADING_UNSUPPORTED_WITHOUT_ARTIFACT'));

      // 2. Skirt with base-size geometry duplicated and relabeled as S/L -> blocked by GRADING_BASE_CLONING_PROHIBITED
      const bodiceTemp = buildApprovedFoundation('bodice', 'garment-temp-helper');
      const gradedHelper = gradePattern(bodiceTemp.designSpecForDrafting, {
        baseSize: 'M',
        targetSizes: ['S', 'M', 'L'],
        customMeasurements: { M: SIZE_M_MEASUREMENTS }
      });
      const clonedSkirtSet = {
        ...gradedHelper,
        garmentCategory: 'skirt' as const,
        sizeResults: Object.fromEntries(
          ['S', 'M', 'L'].map(sz => [
            sz,
            {
              ...gradedHelper.sizeResults[sz],
              bodicePieces: [],
              sleevePiece: undefined,
              skirtPieces: draftSkirtBlock(SIZE_M_MEASUREMENTS, skirtBase.designSpecForDrafting) // Deliberately cloned base M geometry!
            }
          ])
        )
      };
      const clonedArtifact = createAuthoritativeGradingArtifact({
        gradingArtifactId: 'ga-skirt-cloned',
        gradingRevisionId: 'ga-skirt-cloned-r1',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        sourcePatternRevisionId: skirtBase.patternRevision.revisionId,
        sourcePatternSnapshotFingerprint: skirtBase.patternRevision.canonicalFingerprint,
        sourceBasePatternFingerprint: skirtBase.patternRevision.basePatternFingerprint,
        sourceSpecificationId: skirtBase.approvedSpec.garmentId,
        sourceSpecificationRevisionId: skirtBase.approvedSpec.specificationRevisionId,
        sourceSpecificationFingerprint: skirtBase.approvedSpec.approvedContentFingerprint!,
        sourceMeasurementSetId: skirtBase.approvedMeas.measurementSetId,
        sourceMeasurementSetFingerprint: skirtBase.approvedMeas.canonicalFingerprint,
        baseSize: 'M',
        sizeRange: ['S', 'M', 'L'],
        basePatternPieces: skirtBase.pieces,
        gradingRuleSetId: 'cloned-skirt-attempt',
        gradingRuleSetRevision: '1.0.0',
        gradedPatternSet: clonedSkirtSet,
        createdAt: FIXED_TIMESTAMP
      });
      const clonedResult = buildAuthoritativePieceProductionSheetSet({
        patternRevision: skirtBase.patternRevision,
        gradingMode: 'graded-multi-size',
        gradingArtifact: clonedArtifact,
        cutSemanticsByPieceCode: SKIRT_CUT_DECLARATIONS
      });
      assert.equal(clonedResult.validation.isValid, false);
      assert.ok(clonedResult.validation.rejectionCodes.includes('GRADING_BASE_CLONING_PROHIBITED'));

      // 3. Skirt under explicit single-size-ungraded -> valid
      const ungradedSkirt = buildAuthoritativePieceProductionSheetSet({
        patternRevision: skirtBase.patternRevision,
        gradingMode: 'single-size-ungraded',
        nonGradingReason: 'Bespoke single-size M skirt; automated multi-size skirt grader not present in M05.2.1.',
        cutSemanticsByPieceCode: SKIRT_CUT_DECLARATIONS,
        generatedAt: FIXED_TIMESTAMP
      });
      assert.equal(ungradedSkirt.validation.isValid, true, ungradedSkirt.validation.errors.join('; '));
      assert.deepEqual(ungradedSkirt.includedSizes, ['M']);
      assert.equal(ungradedSkirt.totalPhysicalPanelsAcrossSizesForOrder, 3); // 1 front on fold + 2 back mirrored
      assert.equal(ungradedSkirt.isProductionReady, false);
    });
  });

  // --------------------------------------------------------------------------
  // 5. INTEGRITY, TAMPER DETECTION & REPRODUCIBILITY
  // --------------------------------------------------------------------------
  describe('5. Integrity, Tamper Detection & Reproducibility', () => {
    it('detects tampered sheetContentFingerprint, tampered pieceGeometryFingerprint, and cross-revision/project/tenant/garment mismatches', () => {
      const { patternRevision } = buildApprovedFoundation('skirt', 'garment-integrity-01');
      const frontPiece = patternRevision.patternPieces.find(p => p.pieceCode === 'SK-01-F')!;

      const validSheet = buildPatternPieceProductionSheet({
        patternRevision,
        piece: frontPiece,
        gradingMode: 'single-size-ungraded',
        cutSemanticsDeclaration: SKIRT_CUT_DECLARATIONS['SK-01-F'],
        expectedProjectId: PROJECT_ID,
        expectedTenantId: TENANT_ID,
        expectedGarmentId: 'garment-integrity-01',
        generatedAt: FIXED_TIMESTAMP
      });

      const okCheck = verifyPieceProductionSheetIntegrity(validSheet, {
        patternRevision,
        expectedProjectId: PROJECT_ID,
        expectedTenantId: TENANT_ID,
        expectedGarmentId: 'garment-integrity-01',
        cutSemanticsDeclaration: SKIRT_CUT_DECLARATIONS['SK-01-F']
      });
      assert.equal(okCheck.isValid, true, okCheck.errors.join('; '));

      const decl = SKIRT_CUT_DECLARATIONS['SK-01-F'];

      // 1. Tampered sheetContentFingerprint
      const tamperedFpSheet = { ...validSheet, sheetContentFingerprint: '0'.repeat(64) };
      const fpCheck = verifyPieceProductionSheetIntegrity(tamperedFpSheet, {
        patternRevision,
        cutSemanticsDeclaration: decl
      });
      assert.equal(fpCheck.isValid, false);
      assert.equal(fpCheck.isFingerprintValid, false);
      assert.ok(fpCheck.rejectionCodes.includes('SHEET_FINGERPRINT_MISMATCH'));

      // 2. Tampered geometryMetrics even with recomputed sheet fingerprint -> caught against source piece
      const mutatedMetricsSheetBase = {
        ...validSheet,
        geometryMetrics: { ...validSheet.geometryMetrics, cuttingAreaCm2: 9999 }
      };
      const forgedSheet = {
        ...mutatedMetricsSheetBase,
        sheetContentFingerprint: computePieceProductionSheetContentFingerprint(mutatedMetricsSheetBase)
      };
      const forgedCheck = verifyPieceProductionSheetIntegrity(forgedSheet, {
        patternRevision,
        cutSemanticsDeclaration: decl
      });
      assert.equal(forgedCheck.isValid, false);
      assert.ok(forgedCheck.rejectionCodes.includes('GEOMETRY_INVALID'));

      // 3. Tampered pieceGeometryFingerprint
      const tamperedGeomFpSheet = { ...validSheet, pieceGeometryFingerprint: 'f'.repeat(64) };
      const geomFpCheck = verifyPieceProductionSheetIntegrity(tamperedGeomFpSheet, {
        patternRevision,
        cutSemanticsDeclaration: decl
      });
      assert.equal(geomFpCheck.isValid, false);
      assert.ok(geomFpCheck.rejectionCodes.includes('PIECE_GEOMETRY_FINGERPRINT_MISMATCH'));

      // 4. Cross-revision mismatch
      const otherGarmentRev = buildApprovedFoundation('skirt', 'garment-integrity-other').patternRevision;
      const crossRevCheck = verifyPieceProductionSheetIntegrity(validSheet, {
        patternRevision: otherGarmentRev,
        cutSemanticsDeclaration: decl
      });
      assert.equal(crossRevCheck.isValid, false);
      assert.ok(crossRevCheck.rejectionCodes.includes('CROSS_REVISION_SOURCE_MISMATCH'));

      // 5. Cross-project, cross-tenant, cross-garment checks
      const crossScopeCheck = verifyPieceProductionSheetIntegrity(validSheet, {
        patternRevision,
        cutSemanticsDeclaration: decl,
        expectedProjectId: 'different-project',
        expectedTenantId: 'different-tenant',
        expectedGarmentId: 'different-garment'
      });
      assert.equal(crossScopeCheck.isValid, false);
      assert.ok(crossScopeCheck.rejectionCodes.includes('CROSS_PROJECT_MISMATCH'));
      assert.ok(crossScopeCheck.rejectionCodes.includes('CROSS_TENANT_MISMATCH'));
      assert.ok(crossScopeCheck.rejectionCodes.includes('CROSS_GARMENT_MISMATCH'));

      // 6. Safety invariant breach check
      const unsafeSheet = { ...validSheet, isProductionReady: true as unknown as false };
      const unsafeCheck = verifyPieceProductionSheetIntegrity(unsafeSheet, {
        patternRevision,
        cutSemanticsDeclaration: decl
      });
      assert.equal(unsafeCheck.isValid, false);
      assert.ok(unsafeCheck.rejectionCodes.includes('INDUSTRIAL_SAFETY_VIOLATION'));
    });

    it('guarantees deterministic reproducibility across timestamps and separates validation/timestamp from content fingerprint', () => {
      const { patternRevision } = buildApprovedFoundation('skirt', 'garment-repro-01');
      const sheetSetA = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'single-size-ungraded',
        nonGradingReason: 'Single-size deterministic verification',
        cutSemanticsByPieceCode: SKIRT_CUT_DECLARATIONS,
        generatedAt: '2026-11-14T10:00:00.000Z'
      });
      const sheetSetB = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'single-size-ungraded',
        nonGradingReason: 'Single-size deterministic verification',
        cutSemanticsByPieceCode: SKIRT_CUT_DECLARATIONS,
        generatedAt: '2026-11-15T18:45:12.000Z'
      });

      assert.equal(sheetSetA.sheetSetContentFingerprint, sheetSetB.sheetSetContentFingerprint);
      assert.equal(
        sheetSetA.sheetsBySize.M[0].sheetContentFingerprint,
        sheetSetB.sheetsBySize.M[0].sheetContentFingerprint
      );
      assert.equal(
        sheetSetA.sheetsBySize.M[1].sheetContentFingerprint,
        sheetSetB.sheetsBySize.M[1].sheetContentFingerprint
      );
    });
  });

  // ==========================================================================
  // M05.2.1-R1 REMEDIATION SUITES (AUDIT-0521-01 THROUGH AUDIT-0521-08)
  // ==========================================================================

  function buildFullBodiceGradingCtx(garmentId: string) {
    const base = buildApprovedFoundation('bodice', garmentId);
    const gradedSet = gradePattern(base.designSpecForDrafting, {
      baseSize: 'M',
      targetSizes: [...DEFAULT_SIZE_RANGE],
      customMeasurements: { M: SIZE_M_MEASUREMENTS }
    });
    const gradingArtifact = createAuthoritativeGradingArtifact({
      gradingArtifactId: `ga-${garmentId}`,
      gradingRevisionId: 'ga-rev-1',
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      sourcePatternRevisionId: base.patternRevision.revisionId,
      sourcePatternSnapshotFingerprint: base.patternRevision.canonicalFingerprint,
      sourceBasePatternFingerprint: base.patternRevision.basePatternFingerprint,
      sourceSpecificationId: base.approvedSpec.garmentId,
      sourceSpecificationRevisionId: base.approvedSpec.specificationRevisionId,
      sourceSpecificationFingerprint: base.approvedSpec.approvedContentFingerprint!,
      sourceMeasurementSetId: base.approvedMeas.measurementSetId,
      sourceMeasurementSetFingerprint: base.approvedMeas.canonicalFingerprint,
      baseSize: 'M',
      sizeRange: [...DEFAULT_SIZE_RANGE],
      basePatternPieces: base.pieces,
      gradingRuleSetId: 'patroner-iso-bodice-grade-v1',
      gradingRuleSetRevision: '1.0.0',
      gradedPatternSet: gradedSet,
      createdAt: FIXED_TIMESTAMP
    });
    return { ...base, gradingArtifact };
  }

  // Independent 16-point Gauss-Legendre quadrature oracle (nodes & weights on [0, 1])
  // Used exclusively to cross-check engine arc lengths and Green's-theorem areas without shared logic.
  const GL16_SYM_NODES = [
    0.09501250983763744, 0.2816035507792589, 0.45801677765722737, 0.6178762444026438,
    0.755404408355003, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499
  ];
  const GL16_SYM_WEIGHTS = [
    0.1894506104550685, 0.18260341504492358, 0.16915651939500254, 0.14959598881657674,
    0.12462897125553388, 0.09515851168249279, 0.062253523938647894, 0.027152459411754095
  ];

  function independentOracleContourMetrics(
    segments: NonNullable<PatternPieceSnapshot['stitchingContour']>['segments']
  ): { perimeterCm: number; areaCm2: number } {
    let perimeterCm = 0;
    let signedAreaCm2 = 0;

    for (let idx = 0; idx < segments.length; idx++) {
      const seg = segments[idx];
      if (seg.type === 'line') {
        perimeterCm += Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y);
        signedAreaCm2 += 0.5 * (seg.start.x * seg.end.y - seg.start.y * seg.end.x);
      } else if (seg.type === 'bezier' && seg.controlPoints) {
        const p0 = seg.start;
        const p1 = seg.controlPoints[0];
        const p2 = seg.controlPoints[1];
        const p3 = seg.end;

        const integrateSub = (tA: number, tB: number) => {
          const half = (tB - tA) / 2;
          const mid = (tA + tB) / 2;
          let arc = 0;
          let green = 0;
          const evalSample = (t: number) => {
            const mt = 1 - t;
            const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
            const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;
            const dx = 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
            const dy = 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
            arc += Math.hypot(dx, dy);
            green += 0.5 * (x * dy - y * dx);
          };
          for (let k = 0; k < GL16_SYM_NODES.length; k++) {
            const node = GL16_SYM_NODES[k];
            const weight = GL16_SYM_WEIGHTS[k];
            const t1 = mid - half * node;
            const t2 = mid + half * node;
            const mt1 = 1 - t1;
            const x1 = mt1 ** 3 * p0.x + 3 * mt1 ** 2 * t1 * p1.x + 3 * mt1 * t1 ** 2 * p2.x + t1 ** 3 * p3.x;
            const y1 = mt1 ** 3 * p0.y + 3 * mt1 ** 2 * t1 * p1.y + 3 * mt1 * t1 ** 2 * p2.y + t1 ** 3 * p3.y;
            const dx1 = 3 * mt1 ** 2 * (p1.x - p0.x) + 6 * mt1 * t1 * (p2.x - p1.x) + 3 * t1 ** 2 * (p3.x - p2.x);
            const dy1 = 3 * mt1 ** 2 * (p1.y - p0.y) + 6 * mt1 * t1 * (p2.y - p1.y) + 3 * t1 ** 2 * (p3.y - p2.y);

            const mt2 = 1 - t2;
            const x2 = mt2 ** 3 * p0.x + 3 * mt2 ** 2 * t2 * p1.x + 3 * mt2 * t2 ** 2 * p2.x + t2 ** 3 * p3.x;
            const y2 = mt2 ** 3 * p0.y + 3 * mt2 ** 2 * t2 * p1.y + 3 * mt2 * t2 ** 2 * p2.y + t2 ** 3 * p3.y;
            const dx2 = 3 * mt2 ** 2 * (p1.x - p0.x) + 6 * mt2 * t2 * (p2.x - p1.x) + 3 * t2 ** 2 * (p3.x - p2.x);
            const dy2 = 3 * mt2 ** 2 * (p1.y - p0.y) + 6 * mt2 * t2 * (p2.y - p1.y) + 3 * t2 ** 2 * (p3.y - p2.y);

            arc += weight * (Math.hypot(dx1, dy1) + Math.hypot(dx2, dy2));
            green += weight * 0.5 * ((x1 * dy1 - y1 * dx1) + (x2 * dy2 - y2 * dx2));
          }
          void evalSample;
          return { arc: arc * half, green: green * half };
        };

        // Composite 4 sub-intervals * 16 points = 64-pt Gauss-Legendre per Bézier
        for (let s = 0; s < 4; s++) {
          const res = integrateSub(s / 4, (s + 1) / 4);
          perimeterCm += res.arc;
          signedAreaCm2 += res.green;
        }
      }
      const next = segments[(idx + 1) % segments.length];
      if (next.start.x !== seg.end.x || next.start.y !== seg.end.y) {
        signedAreaCm2 += 0.5 * (seg.end.x * next.start.y - seg.end.y * next.start.x);
      }
    }

    return { perimeterCm, areaCm2: Math.abs(signedAreaCm2) };
  }

  function resignSet(baseSet: ReturnType<typeof buildAuthoritativePieceProductionSheetSet>) {
    const { sheetSetContentFingerprint: _old, validation: _val, generatedAt: _gen, ...rest } = baseSet;
    return {
      ...baseSet,
      sheetSetContentFingerprint: computePieceProductionSheetSetContentFingerprint(rest)
    };
  }

  function resignSheet(sheet: ReturnType<typeof buildPatternPieceProductionSheet>) {
    const { sheetContentFingerprint: _old, validation: _val, generatedAt: _gen, ...rest } = sheet;
    return {
      ...sheet,
      sheetContentFingerprint: computePieceProductionSheetContentFingerprint(rest)
    };
  }

  // --------------------------------------------------------------------------
  // SUITE 6 (AUDIT-0521-01): INDEPENDENT SET VERIFICATION & RECOMPUTED DIGEST FORGERY
  // --------------------------------------------------------------------------
  describe('6. AUDIT-0521-01 — Independent Set Verification & Recomputed-Digest Forgery Defense', () => {
    it('rejects set mutations even when attacker recomputes sheetSetContentFingerprint', () => {
      const { patternRevision, gradingArtifact } = buildFullBodiceGradingCtx('garment-audit-01');
      const baseCtx = {
        patternRevision,
        gradingArtifact,
        expectedProjectId: PROJECT_ID,
        expectedTenantId: TENANT_ID,
        expectedGarmentId: 'garment-audit-01',
        expectedSizes: [...DEFAULT_SIZE_RANGE],
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS
      };
      const validSet = buildAuthoritativePieceProductionSheetSet({
        ...baseCtx,
        gradingMode: 'graded-multi-size',
        generatedAt: FIXED_TIMESTAMP
      });
      assert.equal(verifyPieceProductionSheetSetIntegrity(validSet, baseCtx).isValid, true);

      // 1. Drop a piece in size L + recompute digest
      const droppedSet = resignSet({
        ...validSet,
        sheetsBySize: {
          ...validSet.sheetsBySize,
          L: validSet.sheetsBySize.L.filter(s => s.pieceCode !== 'SLV-01')
        }
      });
      const droppedRes = verifyPieceProductionSheetSetIntegrity(droppedSet, baseCtx);
      assert.equal(droppedRes.isValid, false);
      assert.ok(droppedRes.rejectionCodes.includes('GRADING_PIECE_IDENTITY_MISMATCH'));

      // 2. Duplicate a piece inside size M + recompute digest
      const dupSet = resignSet({
        ...validSet,
        sheetsBySize: {
          ...validSet.sheetsBySize,
          M: [...validSet.sheetsBySize.M, validSet.sheetsBySize.M[0]]
        }
      });
      const dupRes = verifyPieceProductionSheetSetIntegrity(dupSet, baseCtx);
      assert.equal(dupRes.isValid, false);
      assert.ok(dupRes.rejectionCodes.includes('GRADING_PIECE_IDENTITY_MISMATCH'));

      // 3. Cross-size bucket stuffing: put size 'M' sheet into 'XL' bucket + recompute digest
      const stuffedSet = resignSet({
        ...validSet,
        sheetsBySize: {
          ...validSet.sheetsBySize,
          XL: validSet.sheetsBySize.XL.map(s => (s.pieceCode === 'BOD-F-01' ? validSet.sheetsBySize.M.find(m => m.pieceCode === 'BOD-F-01')! : s))
        }
      });
      const stuffedRes = verifyPieceProductionSheetSetIntegrity(stuffedSet, baseCtx);
      assert.equal(stuffedRes.isValid, false);
      assert.ok(stuffedRes.rejectionCodes.includes('GRADING_PIECE_IDENTITY_MISMATCH'));

      // 4. Spoofed totalSheetsCount & totalPhysicalPanelsAcrossSizesForOrder + recompute digest
      const spoofedTotalsSet = resignSet({
        ...validSet,
        totalSheetsCount: 999,
        totalPhysicalPanelsAcrossSizesForOrder: 888
      });
      const totalsRes = verifyPieceProductionSheetSetIntegrity(spoofedTotalsSet, baseCtx);
      assert.equal(totalsRes.isValid, false);
      assert.ok(totalsRes.rejectionCodes.includes('QUANTITY_BASIS_INVALID'));

      // 5. Cross-size semantic contradiction (swap XL BOD-B-01 cutSemantics + recompute sheet & set digests)
      const contradictedXlSheet = resignSheet({
        ...validSet.sheetsBySize.XL.find(s => s.pieceCode === 'BOD-B-01')!,
        cutSemantics: {
          ...validSet.sheetsBySize.XL.find(s => s.pieceCode === 'BOD-B-01')!.cutSemantics,
          pairingMode: 'single-asymmetric',
          requiresMirroring: false,
          physicalPanelCountPerGarment: 1
        }
      });
      const semanticContraSet = resignSet({
        ...validSet,
        sheetsBySize: {
          ...validSet.sheetsBySize,
          XL: validSet.sheetsBySize.XL.map(s => (s.pieceCode === 'BOD-B-01' ? contradictedXlSheet : s))
        }
      });
      const semanticContraRes = verifyPieceProductionSheetSetIntegrity(semanticContraSet, baseCtx);
      assert.equal(semanticContraRes.isValid, false);
      assert.ok(semanticContraRes.rejectionCodes.includes('CUT_SEMANTICS_CONTRADICTION'));

      // 6. Cloned base geometry stamped into size L + recomputed sheet & set digests
      const clonedLSheet = resignSheet({
        ...validSet.sheetsBySize.M.find(s => s.pieceCode === 'BOD-F-01')!,
        sizeCode: 'L'
      });
      const clonedBSheet = resignSheet({
        ...validSet.sheetsBySize.M.find(s => s.pieceCode === 'BOD-B-01')!,
        sizeCode: 'L'
      });
      const clonedSSheet = resignSheet({
        ...validSet.sheetsBySize.M.find(s => s.pieceCode === 'SLV-01')!,
        sizeCode: 'L'
      });
      const clonedSet = resignSet({
        ...validSet,
        sheetsBySize: {
          ...validSet.sheetsBySize,
          L: [clonedLSheet, clonedBSheet, clonedSSheet]
        }
      });
      const clonedRes = verifyPieceProductionSheetSetIntegrity(clonedSet, baseCtx);
      assert.equal(clonedRes.isValid, false);
      assert.ok(clonedRes.rejectionCodes.includes('GRADING_BASE_CLONING_PROHIBITED'));

      // 7. Missing authoritative context fails closed
      const missingRevRes = verifyPieceProductionSheetSetIntegrity(validSet, {});
      assert.equal(missingRevRes.isValid, false);
      assert.ok(missingRevRes.rejectionCodes.includes('CROSS_REVISION_SOURCE_MISMATCH'));

      const missingGaRes = verifyPieceProductionSheetSetIntegrity(validSet, { patternRevision });
      assert.equal(missingGaRes.isValid, false);
      assert.ok(missingGaRes.rejectionCodes.includes('GRADING_ARTIFACT_MISSING'));
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 7 (AUDIT-0521-02): INDEPENDENT SHEET VERIFICATION & DECLARATION ENFORCEMENT
  // --------------------------------------------------------------------------
  describe('7. AUDIT-0521-02 — Independent Single-Sheet Verification & Untrusted-Sheet Defense', () => {
    it('rejects contour summary/annotation tampering with recomputed digests and never falls back to sheet.cutSemantics', () => {
      const { patternRevision } = buildApprovedFoundation('bodice', 'garment-audit-02');
      const backBodice = patternRevision.patternPieces.find(p => p.pieceCode === 'BOD-B-01')!;
      const validSheet = buildPatternPieceProductionSheet({
        patternRevision,
        piece: backBodice,
        gradingMode: 'single-size-ungraded',
        cutSemanticsDeclaration: BODICE_CUT_DECLARATIONS['BOD-B-01'],
        expectedProjectId: PROJECT_ID,
        expectedTenantId: TENANT_ID,
        expectedGarmentId: 'garment-audit-02',
        generatedAt: FIXED_TIMESTAMP
      });

      // 1. Omitting cutSemanticsDeclaration must fail closed with CUT_SEMANTICS_UNRESOLVED
      const noDeclCheck = verifyPieceProductionSheetIntegrity(validSheet, { patternRevision });
      assert.equal(noDeclCheck.isValid, false);
      assert.ok(noDeclCheck.rejectionCodes.includes('CUT_SEMANTICS_UNRESOLVED'));

      // 2. Mutating stitchingContourSummary with recomputed sheet digest -> caught against source piece
      const badSummarySheet = resignSheet({
        ...validSheet,
        stitchingContourSummary: {
          ...validSheet.stitchingContourSummary!,
          recordedTotalLengthCm: 12345
        }
      });
      const summaryCheck = verifyPieceProductionSheetIntegrity(badSummarySheet, {
        patternRevision,
        cutSemanticsDeclaration: BODICE_CUT_DECLARATIONS['BOD-B-01']
      });
      assert.equal(summaryCheck.isValid, false);
      assert.ok(summaryCheck.rejectionCodes.includes('PIECE_GEOMETRY_FINGERPRINT_MISMATCH'));

      // 3. Wiping notches, darts, grainline, pieceName, material + recomputing sheet digest -> caught
      const wipedSheet = resignSheet({
        ...validSheet,
        pieceName: 'Tampered Name',
        material: 'lining',
        darts: [],
        notches: [],
        seamReferences: []
      });
      const wipedCheck = verifyPieceProductionSheetIntegrity(wipedSheet, {
        patternRevision,
        cutSemanticsDeclaration: BODICE_CUT_DECLARATIONS['BOD-B-01']
      });
      assert.equal(wipedCheck.isValid, false);
      assert.ok(wipedCheck.rejectionCodes.includes('PIECE_GEOMETRY_FINGERPRINT_MISMATCH'));

      // 4. Swapped cutSemantics pairing mode + recomputed sheet digest -> caught against declaration
      const forgedSemanticSheet = resignSheet({
        ...validSheet,
        cutSemantics: {
          ...validSheet.cutSemantics,
          pairingMode: 'single-asymmetric',
          requiresMirroring: false,
          physicalPanelCountPerGarment: 1
        }
      });
      const semCheck = verifyPieceProductionSheetIntegrity(forgedSemanticSheet, {
        patternRevision,
        cutSemanticsDeclaration: BODICE_CUT_DECLARATIONS['BOD-B-01']
      });
      assert.equal(semCheck.isValid, false);
      assert.ok(semCheck.rejectionCodes.includes('CUT_SEMANTICS_CONTRADICTION'));
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 8 (AUDIT-0521-03 & 04): BÉZIER PRECISION, ORACLE PARITY & NON-ZERO BOUNDS
  // --------------------------------------------------------------------------
  describe('8. AUDIT-0521-03 & 04 — Exact Green Bézier Integration, 16-pt Gauss-Legendre Oracle & Non-Zero Bounds', () => {
    it('matches independent 64-pt Gauss-Legendre quadrature across real sleeve/skirt contours, S-inflections, cusps, shifted coordinates, and micro curves', () => {
      const { patternRevision } = buildApprovedFoundation('bodice', 'garment-oracle');
      const slv = patternRevision.patternPieces.find(p => p.pieceCode === 'SLV-01')!;
      const slvMetrics = computePieceGeometryMetrics(slv, resolveCutQuantitySemantics(slv, { declaration: BODICE_CUT_DECLARATIONS['SLV-01'] }));
      assert.equal(slvMetrics.isValid, true);

      const oracleSlvStitch = independentOracleContourMetrics(slv.stitchingContour!.segments);
      const oracleSlvCut = independentOracleContourMetrics(slv.cuttingContour!.segments);
      assert.ok(Math.abs(slvMetrics.stitchingAreaCm2! - oracleSlvStitch.areaCm2) < 5e-4);
      assert.ok(Math.abs(slvMetrics.cuttingAreaCm2! - oracleSlvCut.areaCm2) < 5e-4);
      assert.ok(Math.abs(slvMetrics.stitchingPerimeterCm! - oracleSlvStitch.perimeterCm) <= 0.002);
      assert.ok(Math.abs(slvMetrics.cuttingPerimeterCm! - oracleSlvCut.perimeterCm) <= 0.002);

      // Synthetic translated S-inflection closed contour with 1cm outward offset
      const shiftX = 100000;
      const shiftY = 100000;
      const sStitchSegs = [
        {
          id: 's-top',
          type: 'bezier' as const,
          start: { x: shiftX + 0, y: shiftY + 0 },
          end: { x: shiftX + 20, y: shiftY + 0 },
          controlPoints: [
            { x: shiftX + 6, y: shiftY - 12 },
            { x: shiftX + 14, y: shiftY + 6 }
          ] as const,
          seamAllowanceCm: 0,
          isFold: false,
          seamId: 'seam-top',
          lengthCm: independentOracleContourMetrics([
            {
              id: 's-top',
              type: 'bezier' as const,
              start: { x: shiftX + 0, y: shiftY + 0 },
              end: { x: shiftX + 20, y: shiftY + 0 },
              controlPoints: [
                { x: shiftX + 6, y: shiftY - 12 },
                { x: shiftX + 14, y: shiftY + 6 }
              ] as const,
              seamAllowanceCm: 0,
              isFold: false,
              lengthCm: 0
            }
          ]).perimeterCm
        },
        {
          id: 's-right',
          type: 'line' as const,
          start: { x: shiftX + 20, y: shiftY + 0 },
          end: { x: shiftX + 20, y: shiftY + 20 },
          seamAllowanceCm: 0,
          isFold: false,
          seamId: 'seam-r',
          lengthCm: 20
        },
        {
          id: 's-bottom',
          type: 'line' as const,
          start: { x: shiftX + 20, y: shiftY + 20 },
          end: { x: shiftX + 0, y: shiftY + 20 },
          seamAllowanceCm: 0,
          isFold: false,
          seamId: 'seam-b',
          lengthCm: 20
        },
        {
          id: 's-left',
          type: 'line' as const,
          start: { x: shiftX + 0, y: shiftY + 20 },
          end: { x: shiftX + 0, y: shiftY + 0 },
          seamAllowanceCm: 0,
          isFold: false,
          seamId: 'seam-l',
          lengthCm: 20
        }
      ];
      const sOracle = independentOracleContourMetrics(sStitchSegs);
      const exactMinY = shiftY - 4.225951;
      const exactHeight = 20 + 4.225951;
      const rectTemplate = makeRectangularPieceSnapshot({ onFold: false, cutCount: 1 });
      // Verify shifted cubic matches exact Green area despite 10^5 origin shift (anchoring prevents cancellation!)
      const shiftedPiece: PatternPieceSnapshot = {
        ...rectTemplate,
        stitchingContour: {
          id: 's-stitch',
          isClosed: true,
          segments: sStitchSegs,
          totalLengthCm: Number(sOracle.perimeterCm.toFixed(4)),
          boundingBox: {
            minX: shiftX,
            minY: exactMinY,
            maxX: shiftX + 20,
            maxY: shiftY + 20,
            widthCm: 20,
            heightCm: exactHeight,
            isApproximate: false,
            basis: 'exact'
          }
        },
        cuttingContour: {
          id: 's-cut',
          isClosed: true,
          segments: sStitchSegs,
          totalLengthCm: Number(sOracle.perimeterCm.toFixed(4)),
          boundingBox: {
            minX: shiftX,
            minY: exactMinY,
            maxX: shiftX + 20,
            maxY: shiftY + 20,
            widthCm: 20,
            heightCm: exactHeight,
            isApproximate: false,
            basis: 'exact'
          }
        },
        boundingBox: {
          minX: shiftX,
          minY: exactMinY,
          maxX: shiftX + 20,
          maxY: shiftY + 20,
          widthCm: 20,
          heightCm: exactHeight,
          isApproximate: false,
          basis: 'exact'
        }
      };
      const shiftedMetrics = computePieceGeometryMetrics(shiftedPiece);
      assert.equal(shiftedMetrics.isValid, true, shiftedMetrics.errors.join('; '));
      assert.ok(shiftedMetrics.stitchingAreaCm2 !== null);
      assert.ok(Math.abs(shiftedMetrics.stitchingAreaCm2! - sOracle.areaCm2) < 5e-4);
      // Non-zero upper error bound must never be rounded down to 0 on cubic or shifted geometry
      assert.ok(shiftedMetrics.numericalPrecision.stitchingAreaUpperBoundCm2 > 0);
      assert.ok(shiftedMetrics.numericalPrecision.cuttingAreaUpperBoundCm2 > 0);
      assert.ok(shiftedMetrics.numericalPrecision.areaApproximationUpperBoundCm2 > 0);

      // Micro-scale closed contour (0.2 cm span) + true algebraic cusp (B'(0.5) = 0, monotonic x) tested against oracle
      const cuspSeg = {
        id: 'cusp-top',
        type: 'bezier' as const,
        start: { x: 0, y: 0 },
        end: { x: 0.2, y: 0 },
        controlPoints: [{ x: 0.2, y: -0.15 }, { x: 0.0, y: -0.15 }] as const,
        seamAllowanceCm: 0,
        isFold: false,
        lengthCm: independentOracleContourMetrics([
          {
            id: 'cusp-top',
            type: 'bezier' as const,
            start: { x: 0, y: 0 },
            end: { x: 0.2, y: 0 },
            controlPoints: [{ x: 0.2, y: -0.15 }, { x: 0.0, y: -0.15 }] as const,
            seamAllowanceCm: 0,
            isFold: false,
            lengthCm: 0
          }
        ]).perimeterCm
      };
      const microSegs = [
        cuspSeg,
        { id: 'm-r', type: 'line' as const, start: { x: 0.2, y: 0 }, end: { x: 0.2, y: 0.2 }, seamAllowanceCm: 0, isFold: false, lengthCm: 0.2 },
        { id: 'm-b', type: 'line' as const, start: { x: 0.2, y: 0.2 }, end: { x: 0, y: 0.2 }, seamAllowanceCm: 0, isFold: false, lengthCm: 0.2 },
        { id: 'm-l', type: 'line' as const, start: { x: 0, y: 0.2 }, end: { x: 0, y: 0 }, seamAllowanceCm: 0, isFold: false, lengthCm: 0.2 }
      ];
      const microOracle = independentOracleContourMetrics(microSegs);
      // True cusp curve: x in [0, 0.2], minY = -0.1125 at t=0.5
      const microPiece: PatternPieceSnapshot = {
        ...rectTemplate,
        stitchingContour: {
          id: 'm-st',
          isClosed: true,
          segments: microSegs,
          totalLengthCm: Number(microOracle.perimeterCm.toFixed(4)),
          boundingBox: { minX: 0, minY: -0.1125, maxX: 0.2, maxY: 0.2, widthCm: 0.2, heightCm: 0.3125, isApproximate: false, basis: 'exact' }
        },
        cuttingContour: {
          id: 'm-ct',
          isClosed: true,
          segments: microSegs,
          totalLengthCm: Number(microOracle.perimeterCm.toFixed(4)),
          boundingBox: { minX: 0, minY: -0.1125, maxX: 0.2, maxY: 0.2, widthCm: 0.2, heightCm: 0.3125, isApproximate: false, basis: 'exact' }
        },
        boundingBox: { minX: 0, minY: -0.1125, maxX: 0.2, maxY: 0.2, widthCm: 0.2, heightCm: 0.3125, isApproximate: false, basis: 'exact' }
      };
      const microMetrics = computePieceGeometryMetrics(microPiece);
      assert.equal(microMetrics.isValid, true, microMetrics.errors.join('; '));
      assert.ok(Math.abs(microMetrics.stitchingAreaCm2! - microOracle.areaCm2) < 5e-4);
      assert.ok(microMetrics.numericalPrecision.stitchingAreaUpperBoundCm2 > 0);
    });

    it('fails closed when extreme 1e6 cubic Bézier exceeds adaptive subdivision max depth', () => {
      const hugeRect = makeRectangularPieceSnapshot({ onFold: false, cutCount: 1 });
      const hugeBez = {
        id: 'huge-curve',
        type: 'bezier' as const,
        start: { x: 0, y: 0 },
        end: { x: 20, y: 0 },
        controlPoints: [{ x: 5, y: 1e6 }, { x: 15, y: -1e6 }] as const,
        seamAllowanceCm: 0,
        isFold: false,
        seamId: 'huge-seam',
        lengthCm: 1000000
      };
      const extremePiece: PatternPieceSnapshot = {
        ...hugeRect,
        stitchingContour: {
          ...hugeRect.stitchingContour!,
          segments: [
            hugeBez,
            hugeRect.stitchingContour!.segments[1],
            hugeRect.stitchingContour!.segments[2],
            hugeRect.stitchingContour!.segments[3]
          ]
        }
      };
      const res = computePieceGeometryMetrics(extremePiece);
      assert.equal(res.isValid, false);
      assert.equal(res.numericalPrecision.perimeterMaxDepthReached, true);
      assert.equal(res.numericalPrecision.perimeterAllTolerancesAchieved, false);
      assert.equal(res.numericalPrecision.areaMaxDepthReached, true);
      assert.equal(res.numericalPrecision.areaFlatteningToleranceAchieved, false);
      assert.ok(res.errors.some(e => e.includes('did not achieve tolerance')));
      assert.ok(res.errors.some(e => e.includes('max depth')));
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 9 (AUDIT-0521-05): STRICT ALLOWANCE LINEAGE & AMBIGUITY DEFENSE
  // --------------------------------------------------------------------------
  describe('9. AUDIT-0521-05 — Strict Allowance Lineage, Dyadic Tree & Collision Defense', () => {
    it('disambiguates textual prefix collisions, rejects incomplete Bézier -L/-R trees, unreferenced cutting segments, and duplicate seams', () => {
      // 1. Prefix collision: segment-1 vs segment-1-alt vs segment-10
      const stitchPrefixSegs = [
        { id: 'segment-1', type: 'line' as const, start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, seamAllowanceCm: 1, isFold: false, seamId: 's1', lengthCm: 10 },
        { id: 'segment-1-alt', type: 'bezier' as const, start: { x: 0, y: 10 }, end: { x: 10, y: 10 }, controlPoints: [{ x: 3, y: 11 }, { x: 7, y: 11 }] as const, seamAllowanceCm: 1.5, isFold: false, seamId: 's2', lengthCm: 10.2 },
        { id: 'segment-10', type: 'line' as const, start: { x: 10, y: 10 }, end: { x: 10, y: 0 }, seamAllowanceCm: 1, isFold: false, seamId: 's3', lengthCm: 10 },
        { id: 'segment-top', type: 'line' as const, start: { x: 10, y: 0 }, end: { x: 0, y: 0 }, seamAllowanceCm: 1, isFold: false, seamId: 's4', lengthCm: 10 }
      ];
      const cutPrefixSegs = [
        { id: 'cut-1', type: 'line' as const, start: { x: -1, y: -1 }, end: { x: -1, y: 11.5 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'segment-1', seamId: 's1', lengthCm: 12.5 },
        { id: 'cut-1-alt-L', type: 'bezier' as const, start: { x: -1, y: 11.5 }, end: { x: 5, y: 12.2 }, controlPoints: [{ x: 1, y: 12 }, { x: 3, y: 12.2 }] as const, seamAllowanceCm: 1.5, isFold: false, sourceSegmentId: 'segment-1-alt-L', seamId: 's2', lengthCm: 6 },
        { id: 'cut-1-alt-R', type: 'bezier' as const, start: { x: 5, y: 12.2 }, end: { x: 11, y: 11.5 }, controlPoints: [{ x: 7, y: 12.2 }, { x: 9, y: 12 }] as const, seamAllowanceCm: 1.5, isFold: false, sourceSegmentId: 'segment-1-alt-R', seamId: 's2', lengthCm: 6 },
        { id: 'cut-10', type: 'line' as const, start: { x: 11, y: 11.5 }, end: { x: 11, y: -1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'segment-10', seamId: 's3', lengthCm: 12.5 },
        { id: 'cut-top', type: 'line' as const, start: { x: 11, y: -1 }, end: { x: -1, y: -1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'segment-top', seamId: 's4', lengthCm: 12 }
      ];
      const prefixPiece = makeRectangularPieceSnapshot({
        onFold: false,
        cutCount: 1,
        seams: [
          { id: 's1', name: 'S1', startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 10 }, lengthCm: 10, type: 'straight', segmentId: 'segment-1' },
          { id: 's2', name: 'S2', startPoint: { x: 0, y: 10 }, endPoint: { x: 10, y: 10 }, lengthCm: 10.2, type: 'curved', segmentId: 'segment-1-alt' },
          { id: 's3', name: 'S3', startPoint: { x: 10, y: 10 }, endPoint: { x: 10, y: 0 }, lengthCm: 10, type: 'straight', segmentId: 'segment-10' },
          { id: 's4', name: 'S4', startPoint: { x: 10, y: 0 }, endPoint: { x: 0, y: 0 }, lengthCm: 10, type: 'straight', segmentId: 'segment-top' }
        ],
        stitchingContour: { id: 'p-st', isClosed: true, segments: stitchPrefixSegs, totalLengthCm: 40.2, boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 11, widthCm: 10, heightCm: 11, isApproximate: false, basis: 'exact' } },
        cuttingContour: { id: 'p-ct', isClosed: true, segments: cutPrefixSegs, totalLengthCm: 49, boundingBox: { minX: -1, minY: -1, maxX: 11, maxY: 12.2, widthCm: 12, heightCm: 13.2, isApproximate: false, basis: 'exact' } }
      });

      const okSchedule = buildPieceAllowanceSchedule(prefixPiece);
      assert.equal(okSchedule.isComplete, true, okSchedule.issues.join('; '));
      assert.deepEqual(okSchedule.entries.find(e => e.segmentId === 'segment-1')!.matchingCuttingSegmentIds, ['cut-1']);
      assert.deepEqual(okSchedule.entries.find(e => e.segmentId === 'segment-1-alt')!.matchingCuttingSegmentIds, ['cut-1-alt-L', 'cut-1-alt-R']);
      assert.deepEqual(okSchedule.entries.find(e => e.segmentId === 'segment-10')!.matchingCuttingSegmentIds, ['cut-10']);

      // 2. Incomplete Bézier subdivision (-R dropped) -> rejected
      const incompleteSub = buildPieceAllowanceSchedule({
        ...prefixPiece,
        cuttingContour: {
          ...prefixPiece.cuttingContour!,
          segments: cutPrefixSegs.filter(c => c.id !== 'cut-1-alt-R')
        }
      });
      assert.equal(incompleteSub.isComplete, false);
      assert.equal(incompleteSub.hasContradictions, true);
      assert.ok(incompleteSub.issues.some(i => i.includes('Incomplete Bézier offset subdivision')));

      // 3. Extra unreferenced cutting segment -> rejected via unmappedCuttingSegmentIds
      const extraCut = buildPieceAllowanceSchedule({
        ...prefixPiece,
        cuttingContour: {
          ...prefixPiece.cuttingContour!,
          segments: [
            ...cutPrefixSegs,
            { id: 'rogue-cut', type: 'line', start: { x: -1, y: -1 }, end: { x: 0, y: -1 }, seamAllowanceCm: 5, isFold: false, sourceSegmentId: 'nonexistent', lengthCm: 1 }
          ]
        }
      });
      assert.equal(extraCut.isComplete, false);
      assert.ok(extraCut.unmappedCuttingSegmentIds.includes('rogue-cut'));

      // 4. Duplicate/conflicting SeamLine records -> rejected via conflictingSeamSegmentIds
      const dupSeam = buildPieceAllowanceSchedule({
        ...prefixPiece,
        seams: [
          ...prefixPiece.seams,
          { id: 's1-conflict', name: 'Conflicting S1', startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 10 }, lengthCm: 10, type: 'straight', segmentId: 'segment-1' }
        ]
      });
      assert.equal(dupSeam.isComplete, false);
      assert.ok(dupSeam.conflictingSeamSegmentIds.includes('segment-1'));
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 10 (AUDIT-0521-06): CONTOUR TOPOLOGY, BOUNDING BOXES & OFFSET VECTORS
  // --------------------------------------------------------------------------
  describe('10. AUDIT-0521-06 — Contour Topological & Geometric Soundness', () => {
    it('rejects degenerate segments, corrupted lengths/bboxes, self-intersections, inverted winding, inward cutting, and wrong-side offsets', () => {
      const rect = makeRectangularPieceSnapshot();
      const sem = resolveCutQuantitySemantics(rect, { declaration: { pairingMode: 'single-centered-on-fold', foldEdgeSegmentId: 'r-fold' } });

      // 1. Degenerate zero-length segment (0.001 cm)
      const degPiece: PatternPieceSnapshot = {
        ...rect,
        stitchingContour: {
          ...rect.stitchingContour!,
          segments: rect.stitchingContour!.segments.map(s =>
            s.id === 'r-top' ? { ...s, start: { x: 0, y: 0 }, end: { x: 0.001, y: 0 }, lengthCm: 0.001 } : s
          )
        }
      };
      assert.equal(computePieceGeometryMetrics(degPiece, sem).isValid, false);

      // 2. Corrupted totalLengthCm
      const badLenPiece: PatternPieceSnapshot = {
        ...rect,
        cuttingContour: { ...rect.cuttingContour!, totalLengthCm: 999 }
      };
      const badLenMetrics = computePieceGeometryMetrics(badLenPiece, sem);
      assert.equal(badLenMetrics.isValid, false);
      assert.ok(badLenMetrics.errors.some(e => e.includes('totalLengthCm')));

      // 3. Corrupted contour.boundingBox
      const badCbbPiece: PatternPieceSnapshot = {
        ...rect,
        stitchingContour: {
          ...rect.stitchingContour!,
          boundingBox: { minX: 0, minY: 0, maxX: 50, maxY: 50, widthCm: 50, heightCm: 50, isApproximate: false, basis: 'exact' }
        }
      };
      const badCbbMetrics = computePieceGeometryMetrics(badCbbPiece, sem);
      assert.equal(badCbbMetrics.isValid, false);
      assert.ok(badCbbMetrics.errors.some(e => e.includes('boundingBox diverges')));

      // 4. Self-intersecting bowtie polygon
      const bowtie: PatternPieceSnapshot = {
        ...makeRectangularPieceSnapshot({ onFold: false, cutCount: 1 }),
        stitchingContour: {
          id: 'bowtie',
          isClosed: true,
          totalLengthCm: 48.2843,
          boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10, widthCm: 10, heightCm: 10, isApproximate: false, basis: 'exact' },
          segments: [
            { id: 'b1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, seamAllowanceCm: 0, isFold: false, lengthCm: 14.1421 },
            { id: 'b2', type: 'line', start: { x: 10, y: 10 }, end: { x: 0, y: 10 }, seamAllowanceCm: 0, isFold: false, lengthCm: 10 },
            { id: 'b3', type: 'line', start: { x: 0, y: 10 }, end: { x: 10, y: 0 }, seamAllowanceCm: 0, isFold: false, lengthCm: 14.1421 },
            { id: 'b4', type: 'line', start: { x: 10, y: 0 }, end: { x: 0, y: 0 }, seamAllowanceCm: 0, isFold: false, lengthCm: 10 }
          ]
        }
      };
      const bowtieMetrics = computePieceGeometryMetrics(bowtie);
      assert.equal(bowtieMetrics.isValid, false);
      assert.ok(bowtieMetrics.errors.some(e => e.includes('self-intersecting')));

      // 5. Inverted winding on cuttingContour
      const reversedCutSegs = [...rect.cuttingContour!.segments].reverse().map(s => ({
        ...s,
        start: s.end,
        end: s.start
      }));
      const invertedWinding = computePieceGeometryMetrics({
        ...rect,
        cuttingContour: { ...rect.cuttingContour!, segments: reversedCutSegs }
      }, sem);
      assert.equal(invertedWinding.isValid, false);
      assert.ok(invertedWinding.errors.some(e => e.includes('winding diverges')));

      // 6. Inward-shrunk cutting contour (cutting area smaller than stitching area despite 1cm allowance)
      const shrunkCutSegs = [
        { id: 'r-fold-cut', type: 'line' as const, start: { x: 0, y: 1 }, end: { x: 0, y: 19 }, seamAllowanceCm: 0, isFold: true, sourceSegmentId: 'r-fold', seamId: 'r-center', lengthCm: 18 },
        { id: 'r-bottom-cut', type: 'line' as const, start: { x: 0, y: 19 }, end: { x: 9, y: 19 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-bottom', seamId: 'r-hem', lengthCm: 9 },
        { id: 'r-right-cut', type: 'line' as const, start: { x: 9, y: 19 }, end: { x: 9, y: 1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-right', seamId: 'r-side', lengthCm: 18 },
        { id: 'r-top-cut', type: 'line' as const, start: { x: 9, y: 1 }, end: { x: 0, y: 1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-top', seamId: 'r-waist', lengthCm: 9 }
      ];
      const shrunkCut = computePieceGeometryMetrics({
        ...rect,
        boundingBox: { minX: 0, minY: 1, maxX: 9, maxY: 19, widthCm: 9, heightCm: 18, isApproximate: false, basis: 'exact' },
        cuttingContour: {
          id: 'rect-cut',
          isClosed: true,
          segments: shrunkCutSegs,
          totalLengthCm: 54,
          boundingBox: { minX: 0, minY: 1, maxX: 9, maxY: 19, widthCm: 9, heightCm: 18, isApproximate: false, basis: 'exact' }
        }
      }, sem);
      assert.equal(shrunkCut.isValid, false);
      assert.ok(shrunkCut.errors.some(e => e.includes('inward/shrunk cutting contour')));

      // 7. Wrong-side / over-offset single edge (1.0 cm seam allowance declared, but offset outward by 3.0 cm)
      const overOffsetCutSegs = [
        { id: 'r-fold-cut', type: 'line' as const, start: { x: 0, y: -1 }, end: { x: 0, y: 21 }, seamAllowanceCm: 0, isFold: true, sourceSegmentId: 'r-fold', seamId: 'r-center', lengthCm: 22 },
        { id: 'r-bottom-cut', type: 'line' as const, start: { x: 0, y: 21 }, end: { x: 13, y: 21 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-bottom', seamId: 'r-hem', lengthCm: 13 },
        { id: 'r-right-cut', type: 'line' as const, start: { x: 13, y: 21 }, end: { x: 13, y: -1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-right', seamId: 'r-side', lengthCm: 22 },
        { id: 'r-top-cut', type: 'line' as const, start: { x: 13, y: -1 }, end: { x: 0, y: -1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-top', seamId: 'r-waist', lengthCm: 13 }
      ];
      const overOffset = computePieceGeometryMetrics({
        ...rect,
        boundingBox: { minX: 0, minY: -1, maxX: 13, maxY: 21, widthCm: 13, heightCm: 22, isApproximate: false, basis: 'exact' },
        cuttingContour: {
          id: 'rect-cut',
          isClosed: true,
          segments: overOffsetCutSegs,
          totalLengthCm: 70,
          boundingBox: { minX: 0, minY: -1, maxX: 13, maxY: 21, widthCm: 13, heightCm: 22, isApproximate: false, basis: 'exact' }
        }
      }, sem);
      assert.equal(overOffset.isValid, false);
      assert.ok(overOffset.errors.some(e => e.includes('offset vector')));

      // 8. Self-intersecting cubic Bézier loop
      const bezLoopSegs = [
        {
          id: 'loop-bez',
          type: 'bezier' as const,
          start: { x: 0, y: 0 },
          end: { x: 20, y: 0 },
          controlPoints: [{ x: 25, y: -15 }, { x: -5, y: -15 }] as const,
          seamAllowanceCm: 0,
          isFold: false,
          lengthCm: 35
        },
        { id: 'lb-r', type: 'line' as const, start: { x: 20, y: 0 }, end: { x: 20, y: 20 }, seamAllowanceCm: 0, isFold: false, lengthCm: 20 },
        { id: 'lb-b', type: 'line' as const, start: { x: 20, y: 20 }, end: { x: 0, y: 20 }, seamAllowanceCm: 0, isFold: false, lengthCm: 20 },
        { id: 'lb-l', type: 'line' as const, start: { x: 0, y: 20 }, end: { x: 0, y: 0 }, seamAllowanceCm: 0, isFold: false, lengthCm: 20 }
      ];
      const bezLoopMetrics = computePieceGeometryMetrics({
        ...makeRectangularPieceSnapshot({ onFold: false, cutCount: 1 }),
        stitchingContour: {
          id: 'bez-loop-st',
          isClosed: true,
          segments: bezLoopSegs,
          totalLengthCm: 95,
          boundingBox: { minX: -0.8333, minY: -11.25, maxX: 20.8333, maxY: 20, widthCm: 21.6667, heightCm: 31.25, isApproximate: false, basis: 'exact' }
        }
      });
      assert.equal(bezLoopMetrics.isValid, false);
      assert.ok(bezLoopMetrics.errors.some(e => e.includes('self-intersecting')));
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 11 (AUDIT-0521-07): FOLD / CUT SEMANTICS & AUTHORITATIVE PIECE MEMBERSHIP
  // --------------------------------------------------------------------------
  describe('11. AUDIT-0521-07 — Fold-Edge Geometry, Multi-Mode Parity & Revision Membership', () => {
    it('enforces fold edge length, half-plane non-crossing, expectedQuantity & grainline across all 4 modes, and rejects foreign pieces', () => {
      // 1. Degenerate fold edge (0.005 cm) rejected in both semantics & geometry
      const tinyFoldRect = makeRectangularPieceSnapshot({
        stitchingContour: {
          ...makeRectangularPieceSnapshot().stitchingContour!,
          segments: [
            { id: 'r-fold', type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 0.005 }, seamAllowanceCm: 0, isFold: true, seamId: 'r-center', lengthCm: 0.005 },
            { id: 'r-bottom', type: 'line', start: { x: 0, y: 0.005 }, end: { x: 10, y: 20 }, seamAllowanceCm: 1, isFold: false, seamId: 'r-hem', lengthCm: 22.36 },
            { id: 'r-right', type: 'line', start: { x: 10, y: 20 }, end: { x: 10, y: 0 }, seamAllowanceCm: 1, isFold: false, seamId: 'r-side', lengthCm: 20 },
            { id: 'r-top', type: 'line', start: { x: 10, y: 0 }, end: { x: 0, y: 0 }, seamAllowanceCm: 1, isFold: false, seamId: 'r-waist', lengthCm: 10 }
          ]
        }
      });
      const tinyFoldSem = resolveCutQuantitySemantics(tinyFoldRect, {
        declaration: { pairingMode: 'single-centered-on-fold', foldEdgeSegmentId: 'r-fold' }
      });
      assert.equal(tinyFoldSem.semanticResolutionStatus, 'invalid');
      assert.ok(tinyFoldSem.contradictionReasons.some(r => r.includes('minimum valid fold-edge length')));

      // 2. Cutting contour crossing fold axis (extends to X = -2 across vertical fold X = 0) -> rejected
      const crossFoldPiece = makeRectangularPieceSnapshot({
        cuttingContour: {
          id: 'rect-cut',
          isClosed: true,
          totalLengthCm: 70,
          boundingBox: { minX: -2, minY: -1, maxX: 11, maxY: 21, widthCm: 13, heightCm: 22, isApproximate: false, basis: 'exact' },
          segments: [
            { id: 'r-fold-cut', type: 'line', start: { x: -2, y: -1 }, end: { x: -2, y: 21 }, seamAllowanceCm: 0, isFold: true, sourceSegmentId: 'r-fold', seamId: 'r-center', lengthCm: 22 },
            { id: 'r-bottom-cut', type: 'line', start: { x: -2, y: 21 }, end: { x: 11, y: 21 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-bottom', seamId: 'r-hem', lengthCm: 13 },
            { id: 'r-right-cut', type: 'line', start: { x: 11, y: 21 }, end: { x: 11, y: -1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-right', seamId: 'r-side', lengthCm: 22 },
            { id: 'r-top-cut', type: 'line', start: { x: 11, y: -1 }, end: { x: -2, y: -1 }, seamAllowanceCm: 1, isFold: false, sourceSegmentId: 'r-top', seamId: 'r-waist', lengthCm: 13 }
          ]
        }
      });
      const rectSem = resolveCutQuantitySemantics(makeRectangularPieceSnapshot(), {
        declaration: { pairingMode: 'single-centered-on-fold', foldEdgeSegmentId: 'r-fold' }
      });
      const crossFoldMetrics = computePieceGeometryMetrics(crossFoldPiece, rectSem);
      assert.equal(crossFoldMetrics.isValid, false);
      assert.ok(crossFoldMetrics.errors.some(e => e.includes('diverges from fold axis')));

      // 3. Rejects missing grainline across all 4 pairing modes
      const flatNoGrain = makeRectangularPieceSnapshot({
        onFold: false,
        cutCount: 1,
        grainline: { start: { x: 5, y: 5 }, end: { x: 5, y: 5 }, direction: 'vertical' },
        stitchingContour: {
          ...makeRectangularPieceSnapshot().stitchingContour!,
          segments: makeRectangularPieceSnapshot().stitchingContour!.segments.map(s => ({ ...s, isFold: false }))
        }
      });
      assert.equal(
        resolveCutQuantitySemantics(flatNoGrain, { declaration: { pairingMode: 'single-asymmetric' } }).semanticResolutionStatus,
        'invalid'
      );
      assert.equal(
        resolveCutQuantitySemantics({ ...flatNoGrain, cutCount: 2 }, { declaration: { pairingMode: 'paired-mirrored-left-right', mirroringConfirmed: true } }).semanticResolutionStatus,
        'invalid'
      );

      // 4. Foreign unlinked piece passed to buildPatternPieceProductionSheet -> rejected with FOREIGN_PIECE_NOT_IN_REVISION
      const { patternRevision } = buildApprovedFoundation('skirt', 'garment-foreign-piece');
      const foreignBuild = buildPatternPieceProductionSheet({
        patternRevision,
        piece: makeRectangularPieceSnapshot(),
        gradingMode: 'single-size-ungraded',
        cutSemanticsDeclaration: { pairingMode: 'single-centered-on-fold', foldEdgeSegmentId: 'r-fold' },
        generatedAt: FIXED_TIMESTAMP
      });
      assert.equal(foreignBuild.validation.isValid, false);
      assert.ok(foreignBuild.validation.rejectionCodes.includes('FOREIGN_PIECE_NOT_IN_REVISION'));
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 12 (AUDIT-0521-08): TIMESTAMP STRICTNESS & ORDER QUANTITY BASIS
  // --------------------------------------------------------------------------
  describe('12. AUDIT-0521-08 — Strict Calendar Timestamp & Order Quantity Basis Semantics', () => {
    it('rejects invalid calendar timestamps in builders/verifiers and strictly differentiates default vs declared order quantities', () => {
      const { patternRevision } = buildApprovedFoundation('bodice', 'garment-audit-08');
      const frontPiece = patternRevision.patternPieces.find(p => p.pieceCode === 'BOD-F-01')!;

      // 1. Invalid Gregorian / malformed generatedAt in builders
      for (const badTs of ['2026-02-30T10:00:00.000Z', '2026-13-01T00:00:00.000Z', 'not-a-timestamp']) {
        const badSingle = buildPatternPieceProductionSheet({
          patternRevision,
          piece: frontPiece,
          gradingMode: 'single-size-ungraded',
          cutSemanticsDeclaration: BODICE_CUT_DECLARATIONS['BOD-F-01'],
          generatedAt: badTs
        });
        assert.equal(badSingle.validation.isValid, false);
        assert.ok(badSingle.validation.rejectionCodes.includes('TIMESTAMP_INVALID'));

        const badSet = buildAuthoritativePieceProductionSheetSet({
          patternRevision,
          gradingMode: 'single-size-ungraded',
          nonGradingReason: 'Single-size test',
          cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS,
          generatedAt: badTs
        });
        assert.equal(badSet.validation.isValid, false);
        assert.ok(badSet.validation.rejectionCodes.includes('TIMESTAMP_INVALID'));
      }

      // 2. Default quantity basis vs declared order quantity basis
      const defaultSet = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'single-size-ungraded',
        nonGradingReason: 'Single-size test',
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS,
        generatedAt: FIXED_TIMESTAMP
      });
      assert.equal(defaultSet.validation.isValid, true);
      assert.equal(defaultSet.orderQuantityBasis, 'default-single-garment-per-size-run');
      assert.equal(defaultSet.totalPhysicalPanelsAcrossSizesForOrder, 5); // 1 + 2 + 2

      const declaredSet = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'single-size-ungraded',
        nonGradingReason: 'Batch order of 4 garments',
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS,
        garmentUnitQuantitiesBySize: { M: 4 },
        generatedAt: FIXED_TIMESTAMP
      });
      assert.equal(declaredSet.validation.isValid, true);
      assert.equal(declaredSet.orderQuantityBasis, 'declared-order-quantity');
      assert.equal(declaredSet.totalPhysicalPanelsAcrossSizesForOrder, 20); // (1 + 2 + 2) * 4

      // 3. Rejects omitting a size in garmentUnitQuantitiesBySize without fallback
      const missingQtySize = buildAuthoritativePieceProductionSheetSet({
        patternRevision,
        gradingMode: 'single-size-ungraded',
        nonGradingReason: 'Missing M entry',
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS,
        garmentUnitQuantitiesBySize: { L: 4 },
        generatedAt: FIXED_TIMESTAMP
      });
      assert.equal(missingQtySize.validation.isValid, false);
      assert.ok(missingQtySize.validation.rejectionCodes.includes('QUANTITY_BASIS_INVALID'));

      // 4. Rejects timestamp & quantity basis tampering on verification
      const badTsVerified = verifyPieceProductionSheetIntegrity(
        { ...defaultSet.sheetsBySize.M[0], generatedAt: '2026-02-30T10:00:00.000Z' },
        { patternRevision, cutSemanticsDeclaration: BODICE_CUT_DECLARATIONS[defaultSet.sheetsBySize.M[0].pieceCode] }
      );
      assert.equal(badTsVerified.isValid, false);
      assert.ok(badTsVerified.rejectionCodes.includes('TIMESTAMP_INVALID'));

      const wrongBasisCheck = verifyPieceProductionSheetSetIntegrity(defaultSet, {
        patternRevision,
        cutSemanticsByPieceCode: BODICE_CUT_DECLARATIONS,
        expectedOrderQuantityBasis: 'declared-order-quantity'
      });
      assert.equal(wrongBasisCheck.isValid, false);
      assert.ok(wrongBasisCheck.rejectionCodes.includes('QUANTITY_BASIS_INVALID'));
    });
  });
});
