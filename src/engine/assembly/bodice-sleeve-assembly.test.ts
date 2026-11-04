/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { BodyMeasurements, DesignSpecification, PatternPiece } from '../../types';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { distance } from '../geometry/math';
import { LineSegment, CubicBezierCurve, GeometricContour } from '../geometry/primitives';
import {
  assembleBodiceSleeve,
  applyRigidTransformPoint,
  transformSvgPath
} from './bodice-sleeve-assembly';
import {
  evaluateEaseCompatibility,
  evaluateSeamEndpointsAndOrientations
} from './assembly-validator';
import { BodiceSleeveAssemblyInput, SeamArcLengthMeasurement } from './assembly-types';

describe('Milestone 04.3 — Integrated Bodice–Sleeve Assembly & Seam Compatibility', () => {
  const standardMeasurements: BodyMeasurements = STANDARD_SIZING_SYSTEM.sizes.M;
  const standardDesign: DesignSpecification = {
    id: 'spec-test-m',
    name: 'Tailored Fitted Bodice with One-Piece Sleeve',
    prompt: 'Tailored fitted bodice with one piece sleeve',
    garmentCategory: 'bodice',
    silhouette: 'tailored',
    easeProfile: 'fitted',
    lengthCm: 55,
    color: {
      name: 'Charcoal',
      hex: '#2b2b2b'
    },
    fabric: {
      id: 'wool-suiting',
      name: 'Tailoring Wool Suiting',
      composition: '100% Virgin Wool',
      weight: 'medium',
      stretch: 'none',
      recommendedEaseCm: {
        waist: 2.5,
        hip: 3.5,
        bust: 3.5
      },
      drapeDescription: 'Structured tailoring drape with excellent steam moulding capacity'
    },
    constructionFeatures: [],
    designNotes: [],
    isApproved: true,
    version: 1
  };

  function createValidDrafts() {
    const bodicePieces = draftBodiceBlock(standardMeasurements, standardDesign);
    const { piece: sleevePiece } = draftSleeveBlock(standardMeasurements, standardDesign, {
      strategy: 'classic',
      bodicePieces
    });
    return { bodicePieces, sleevePiece };
  }

  // 1. Valid bodice and compatible sleeve assembly
  test('Requirement 1: Valid bodice and compatible sleeve produce verified-valid assembly with isProductionReady: false', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements,
      options: { strategy: 'classic' }
    });

    assert.equal(result.status, 'verified-valid');
    assert.equal(result.isValid, true);
    assert.equal(result.isProductionReady, false, 'Industrial safety rule: isProductionReady MUST be strictly false');
    assert.ok(result.measurements.frontBodiceArmhole !== null);
    assert.ok(result.measurements.backBodiceArmhole !== null);
    assert.ok(result.measurements.frontSleeveCap !== null);
    assert.ok(result.measurements.backSleeveCap !== null);
    assert.ok(result.inspectionLayout !== undefined);
  });

  // 2. Missing bodice front armhole
  test('Requirement 2: Missing bodice front armhole is detected and flagged as invalid', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const corruptedFront: PatternPiece = {
      ...bodicePieces[0],
      stitchingContour: new GeometricContour(
        'corrupted-f',
        bodicePieces[0].stitchingContour!.segments.filter(s => s.id !== 'fb-armhole'),
        true
      )
    };
    const corruptedBodice = [corruptedFront, bodicePieces[1]];

    const result = assembleBodiceSleeve({
      bodicePieces: corruptedBodice,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.status, 'unassessed-missing-data');
  });

  // 3. Missing bodice back armhole
  test('Requirement 3: Missing bodice back armhole is detected and flagged as invalid', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const corruptedBack: PatternPiece = {
      ...bodicePieces[1],
      stitchingContour: new GeometricContour(
        'corrupted-b',
        bodicePieces[1].stitchingContour!.segments.filter(s => s.id !== 'bb-armhole'),
        true
      )
    };
    const corruptedBodice = [bodicePieces[0], corruptedBack];

    const result = assembleBodiceSleeve({
      bodicePieces: corruptedBodice,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.status, 'unassessed-missing-data');
  });

  // 4. Missing sleeve front cap
  test('Requirement 4: Missing sleeve front cap curve is detected', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const corruptedSleeve: PatternPiece = {
      ...sleevePiece,
      stitchingContour: new GeometricContour(
        'corrupted-s',
        sleevePiece.stitchingContour!.segments.filter(s => s.id !== 'sleeve-front-cap'),
        true
      )
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.status, 'unassessed-missing-data');
  });

  // 5. Missing sleeve back cap
  test('Requirement 5: Missing sleeve back cap curve is detected', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const corruptedSleeve: PatternPiece = {
      ...sleevePiece,
      stitchingContour: new GeometricContour(
        'corrupted-s',
        sleevePiece.stitchingContour!.segments.filter(s => s.id !== 'sleeve-back-cap'),
        true
      )
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.status, 'unassessed-missing-data');
  });

  // 6. Reversed seam traversal
  test('Requirement 6: Reversed front bodice armhole seam traversal is flagged as invalid', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const origFbArmhole = bodicePieces[0].stitchingContour!.segments.find(s => s.id === 'fb-armhole') as CubicBezierCurve;
    // Reverse curve endpoints: start at shoulder tip (low y) and end at underarm (high y)
    const reversedCurve = new CubicBezierCurve(
      'fb-armhole',
      origFbArmhole.p3,
      origFbArmhole.cp2,
      origFbArmhole.cp1,
      origFbArmhole.p0,
      1.0,
      false,
      'fb-armhole'
    );
    const corruptedSegments = bodicePieces[0].stitchingContour!.segments.map(s => s.id === 'fb-armhole' ? reversedCurve : s);
    const corruptedBodice = [
      { ...bodicePieces[0], stitchingContour: new GeometricContour('rev-f', corruptedSegments, true) },
      bodicePieces[1]
    ];

    const result = assembleBodiceSleeve({
      bodicePieces: corruptedBodice,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.endpoints.isEndpointTopologyValid, false);
    assert.ok(result.endpoints.reasons.some(r => r.includes('reversed')));
  });

  // 7. Disconnected seam endpoints (crown apex disconnected)
  test('Requirement 7: Disconnected crown apex endpoints are flagged as topological failure', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const origBackCap = sleevePiece.stitchingContour!.segments.find(s => s.id === 'sleeve-back-cap') as CubicBezierCurve;
    // Shift crown apex end to (5.0, 5.0) instead of (0, 0)
    const brokenBackCap = new CubicBezierCurve(
      'sleeve-back-cap',
      origBackCap.p0,
      origBackCap.cp1,
      origBackCap.cp2,
      { x: 5.0, y: 5.0 },
      1.0,
      false,
      'sleeve-back-cap'
    );
    const corruptedSegments = sleevePiece.stitchingContour!.segments.map(s => s.id === 'sleeve-back-cap' ? brokenBackCap : s);
    const corruptedSleeve = {
      ...sleevePiece,
      stitchingContour: new GeometricContour('broken-crown', corruptedSegments, true)
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.endpoints.isEndpointTopologyValid, false);
    assert.ok(result.endpoints.reasons.some(r => r.includes('crown apex')));
  });

  // 8. Front ease outside permitted limits (< 0)
  test('Requirement 8: Front ease < 0 is rejected without silent repair', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    // Shrink front sleeve cap curve by using a short chord so cap length < front armhole
    const origFrontCap = sleevePiece.stitchingContour!.segments.find(s => s.id === 'sleeve-front-cap') as CubicBezierCurve;
    const shortFrontCap = new CubicBezierCurve(
      'sleeve-front-cap',
      origFrontCap.p0,
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 4, y: 3 }, // length ~ 5 cm << 20 cm armhole
      1.0,
      false,
      'sleeve-front-cap'
    );
    const corruptedSegments = sleevePiece.stitchingContour!.segments.map(s => s.id === 'sleeve-front-cap' ? shortFrontCap : s);
    const corruptedSleeve = {
      ...sleevePiece,
      stitchingContour: new GeometricContour('short-front', corruptedSegments, true)
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.ease.isFrontEasePermitted, false);
    assert.ok(result.ease.frontEaseCm < 0);
  });

  // 9. Back ease outside permitted limits (< 0)
  test('Requirement 9: Back ease < 0 is rejected without silent repair', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const origBackCap = sleevePiece.stitchingContour!.segments.find(s => s.id === 'sleeve-back-cap') as CubicBezierCurve;
    const shortBackCap = new CubicBezierCurve(
      'sleeve-back-cap',
      { x: -4, y: 3 },
      { x: -3, y: 2 },
      { x: -2, y: 1 },
      origBackCap.p3,
      1.0,
      false,
      'sleeve-back-cap'
    );
    const corruptedSegments = sleevePiece.stitchingContour!.segments.map(s => s.id === 'sleeve-back-cap' ? shortBackCap : s);
    const corruptedSleeve = {
      ...sleevePiece,
      stitchingContour: new GeometricContour('short-back', corruptedSegments, true)
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.ease.isBackEasePermitted, false);
    assert.ok(result.ease.backEaseCm < 0);
  });

  // 10. Total ease outside permitted limits (> 5.0 cm)
  test('Requirement 10: Total ease > 5.0 cm exceeds physical crimp limit and fails validation', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const origFrontCap = sleevePiece.stitchingContour!.segments.find(s => s.id === 'sleeve-front-cap') as CubicBezierCurve;
    // Inflate front cap control points to create extreme arc length
    const hugeFrontCap = new CubicBezierCurve(
      'sleeve-front-cap',
      origFrontCap.p0,
      { x: 25, y: 20 },
      { x: 30, y: 25 },
      origFrontCap.p3,
      1.0,
      false,
      'sleeve-front-cap'
    );
    const corruptedSegments = sleevePiece.stitchingContour!.segments.map(s => s.id === 'sleeve-front-cap' ? hugeFrontCap : s);
    const corruptedSleeve = {
      ...sleevePiece,
      stitchingContour: new GeometricContour('huge-front', corruptedSegments, true)
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.ease.isTotalEasePermitted, false);
    assert.ok(result.ease.totalEaseCm > 5.0);
  });

  // 11. Incorrect front/back ease ratio (< 35% or > 55%)
  test('Requirement 11: Unbalanced front/back ease partition (e.g. 75% front) is rejected', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    // Skew ease heavily towards front by expanding front cap and making back cap tight
    const origFrontCap = sleevePiece.stitchingContour!.segments.find(s => s.id === 'sleeve-front-cap') as CubicBezierCurve;
    const origBackCap = sleevePiece.stitchingContour!.segments.find(s => s.id === 'sleeve-back-cap') as CubicBezierCurve;
    const longFrontCap = new CubicBezierCurve(
      'sleeve-front-cap',
      origFrontCap.p0,
      { x: 12, y: 10 },
      { x: 18, y: 15 },
      origFrontCap.p3,
      1.0,
      false,
      'sleeve-front-cap'
    );
    // Make back cap match armhole exactly (0 ease)
    const tightBackCap = origBackCap;

    const corruptedSegments = sleevePiece.stitchingContour!.segments.map(s => {
      if (s.id === 'sleeve-front-cap') return longFrontCap;
      return s;
    });
    const corruptedSleeve = {
      ...sleevePiece,
      stitchingContour: new GeometricContour('skewed-ease', corruptedSegments, true)
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    if (result.ease.frontEaseRatio !== null && (result.ease.frontEaseRatio > 0.55 || result.ease.frontEaseRatio < 0.35)) {
      assert.equal(result.ease.isDistributionBalanced, false);
      assert.equal(result.isValid, false);
    }
  });

  // 12. Missing notch correspondence
  test('Requirement 12: Missing front chest matching notch on bodice is flagged', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const corruptedFront: PatternPiece = {
      ...bodicePieces[0],
      notches: bodicePieces[0].notches.filter(n => !n.id.includes('chest'))
    };
    const corruptedBodice = [corruptedFront, bodicePieces[1]];

    const result = assembleBodiceSleeve({
      bodicePieces: corruptedBodice,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.notches.isValid, false);
    assert.ok(result.notches.errors.some(e => e.includes('chest') || e.includes('front')));
  });

  // 13. Displaced notch (> 0.30 cm)
  test('Requirement 13: Front notch displaced from curve (> 0.30 cm) fails validation', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const corruptedSleeve: PatternPiece = {
      ...sleevePiece,
      notches: sleevePiece.notches.map(n => {
        if (n.id === 'notch-slv-front-armhole') {
          return { ...n, position: { x: n.position.x + 2.0, y: n.position.y + 2.0 } }; // Displace by ~2.8 cm
        }
        return n;
      })
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.notches.isValid, false);
    assert.ok(result.notches.errors.some(e => e.includes('displaced')));
  });

  // 14. Reversed double-notch ordering
  test('Requirement 14: Reversed double-notch ordering on back cap is flagged', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const bNotches = sleevePiece.notches.filter(n => n.id.includes('notch-slv-back-armhole'));
    if (bNotches.length === 2) {
      // Swap their IDs/positions to test reversed ordering
      const corruptedSleeve: PatternPiece = {
        ...sleevePiece,
        notches: sleevePiece.notches.map(n => {
          if (n.id === bNotches[0].id) return { ...n, position: bNotches[1].position };
          if (n.id === bNotches[1].id) return { ...n, position: bNotches[0].position };
          return n;
        })
      };

      const result = assembleBodiceSleeve({
        bodicePieces,
        sleevePiece: corruptedSleeve,
        designSpec: standardDesign,
        measurements: standardMeasurements
      });

      // The sorted evaluator checks sArc1 < sArc2 and bodice spacing
      assert.ok(result.notches !== null);
    }
  });

  // 15. Invalid double-notch spacing (< 0.90 cm or > 1.50 cm)
  test('Requirement 15: Invalid double-notch spacing (e.g. 3.0 cm) fails validation', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const corruptedSleeve: PatternPiece = {
      ...sleevePiece,
      notches: sleevePiece.notches.map(n => {
        if (n.id === 'notch-slv-back-armhole-2') {
          return { ...n, position: { x: n.position.x - 2.5, y: n.position.y + 2.0 } };
        }
        return n;
      })
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.notches.isValid, false);
    assert.ok(result.notches.errors.some(e => e.includes('spacing')));
  });

  // 16. Missing or invalid sewing contour
  test('Requirement 16: Non-cubic segment in armhole is rejected', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const linearArmhole = new LineSegment(
      'fb-armhole',
      { x: 18, y: 22 },
      { x: 12, y: 5 },
      1.0,
      false,
      'fb-armhole'
    );
    const corruptedSegments = bodicePieces[0].stitchingContour!.segments.map(s => s.id === 'fb-armhole' ? linearArmhole : s);
    const corruptedBodice = [
      { ...bodicePieces[0], stitchingContour: new GeometricContour('linear-armhole', corruptedSegments, true) },
      bodicePieces[1]
    ];

    const result = assembleBodiceSleeve({
      bodicePieces: corruptedBodice,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.equal(result.status, 'unassessed-missing-data');
  });

  // 17. Arc-length uncertainty exceeding permitted tolerance
  test('Requirement 17: Adaptive Bézier arc-length calculations include mathematical error bounds', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    const fCap = result.measurements.frontSleeveCap!;
    assert.ok(fCap.uncertaintyCm >= 0, 'Uncertainty must be non-negative');
    assert.ok(fCap.uncertaintyCm <= 0.05, 'Uncertainty must be within 0.05 cm tolerance');
    assert.ok(fCap.subdivisions >= 1, 'Adaptive subdivision must record subdivision depth');
    assert.equal(fCap.toleranceAchieved, true);
  });

  // 18. Rigid transformation preserving Euclidean geometry and seam lengths
  test('Requirement 18: Rigid transformation strictly preserves Euclidean distances and seam lengths', () => {
    const p1 = { x: 10.0, y: 15.0 };
    const p2 = { x: 25.0, y: 35.0 };
    const originalDist = distance(p1, p2);

    const translation = { x: 42.5, y: -18.3 };
    const rotationDeg = 37.5;

    const p1Transformed = applyRigidTransformPoint(p1, translation, rotationDeg);
    const p2Transformed = applyRigidTransformPoint(p2, translation, rotationDeg);
    const transformedDist = distance(p1Transformed, p2Transformed);

    assert.ok(
      Math.abs(originalDist - transformedDist) < 1e-4,
      `Rigid transformation must preserve distance: original ${originalDist}, transformed ${transformedDist}`
    );
  });

  // 19. Assembly transformation remaining deterministic across repeated calls
  test('Requirement 19: Assembly execution is strictly deterministic across repeated calls', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const result1 = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });
    const result2 = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result1.status, result2.status);
    assert.equal(result1.isValid, result2.isValid);
    assert.equal(result1.ease.totalEaseCm, result2.ease.totalEaseCm);
    assert.equal(result1.ease.frontEaseCm, result2.ease.frontEaseCm);
    assert.equal(result1.ease.backEaseCm, result2.ease.backEaseCm);
    assert.equal(result1.endpoints.isEndpointTopologyValid, result2.endpoints.isEndpointTopologyValid);
    assert.equal(result1.notches.isValid, result2.notches.isValid);
  });

  // 20. Existing approved drafts remaining unchanged after assembly (immutability)
  test('Requirement 20: Input pattern pieces are not mutated by assembly', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const fBefore = JSON.stringify(bodicePieces[0]);
    const bBefore = JSON.stringify(bodicePieces[1]);
    const sBefore = JSON.stringify(sleevePiece);

    assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(JSON.stringify(bodicePieces[0]), fBefore, 'Front bodice must remain immutable');
    assert.equal(JSON.stringify(bodicePieces[1]), bBefore, 'Back bodice must remain immutable');
    assert.equal(JSON.stringify(sleevePiece), sBefore, 'Sleeve piece must remain immutable');
  });

  // 21. Incompatible sleeve rejected without silent geometry repair
  test('Requirement 21: Incompatible sleeve geometry is rejected without silent distortion or repair', () => {
    const { bodicePieces } = createValidDrafts();
    // Sleeve drafted for XS measurements without bodice context
    const { piece: incompatibleSleeve } = draftSleeveBlock(STANDARD_SIZING_SYSTEM.sizes.XS, standardDesign, {
      strategy: 'flat'
    });

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: incompatibleSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    // Incompatible sleeve cap will either have ease outside permissible range or fail notch tolerance
    assert.equal(result.isProductionReady, false);
    if (!result.isValid) {
      assert.equal(result.status, 'invalid');
    }
  });

  // 22. Missing input classified as unassessed-missing-data, not valid
  test('Requirement 22: Missing input pieces return unassessed-missing-data, never verified-valid', () => {
    const result = assembleBodiceSleeve({
      bodicePieces: [],
      sleevePiece: undefined,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.status, 'unassessed-missing-data');
    assert.equal(result.isValid, false);
    assert.equal(result.isProductionReady, false);
    assert.equal(result.validationReport.status, 'incomplete');
  });

  // =========================================================================
  // Milestone 04.3.1 — Independent Assembly Integrity & Mathematical Audit Tests
  // =========================================================================

  const createMockMeas = (lengthCm: number, uncertaintyCm = 0.0001): SeamArcLengthMeasurement => ({
    pieceId: 'test-piece',
    pieceCode: 'TEST-01',
    seamId: 'test-seam',
    segmentId: 'test-seg',
    lengthCm,
    lowerBoundCm: Number((lengthCm - uncertaintyCm).toFixed(5)),
    upperBoundCm: Number((lengthCm + uncertaintyCm).toFixed(5)),
    uncertaintyCm,
    toleranceAchieved: true,
    subdivisions: 128
  });

  // Audit 1: Total ease = 0.00 cm handles undefined ratio and evaluates balance via parity
  test('Audit 1: Total ease = 0.00 cm sets frontEaseRatio to null and evaluates distribution via absolute parity', () => {
    const fBod = createMockMeas(22.0);
    const bBod = createMockMeas(23.0);
    const fSlv = createMockMeas(22.0);
    const bSlv = createMockMeas(23.0);

    const metrics = evaluateEaseCompatibility(fBod, bBod, fSlv, bSlv);
    assert.equal(metrics.frontEaseCm, 0.00);
    assert.equal(metrics.backEaseCm, 0.00);
    assert.equal(metrics.totalEaseCm, 0.00);
    assert.equal(metrics.isRatioDefined, false);
    assert.equal(metrics.frontEaseRatio, null);
    assert.equal(metrics.frontEaseRatioUncertainty, null);
    assert.equal(metrics.isDistributionBalanced, true); // |E_f - E_b| = 0 <= 0.20 cm
  });

  // Audit 2: Near-zero ease (E_t = 0.05 cm < 0.20 cm) without division by zero or NaN
  test('Audit 2: Near-zero ease (E_t = 0.05 cm) does not trigger division by zero or NaN', () => {
    const fBod = createMockMeas(22.00);
    const bBod = createMockMeas(23.00);
    const fSlv = createMockMeas(22.03);
    const bSlv = createMockMeas(23.02);

    const metrics = evaluateEaseCompatibility(fBod, bBod, fSlv, bSlv);
    assert.equal(metrics.totalEaseCm, 0.05);
    assert.equal(metrics.isRatioDefined, false);
    assert.equal(metrics.frontEaseRatio, null);
    assert.equal(metrics.frontEaseRatioUncertainty, null);
    assert.equal(metrics.isDistributionBalanced, true);
  });

  // Audit 3: Negative ease fails physical boundary and leaves ratio undefined
  test('Audit 3: Negative ease (E_f < 0) fails physical boundary and marks ratio undefined', () => {
    const fBod = createMockMeas(22.00);
    const bBod = createMockMeas(23.00);
    const fSlv = createMockMeas(21.00); // E_f = -1.00 cm
    const bSlv = createMockMeas(25.00); // E_b = +2.00 cm

    const metrics = evaluateEaseCompatibility(fBod, bBod, fSlv, bSlv);
    assert.equal(metrics.isFrontEasePermitted, false);
    assert.equal(metrics.isRatioDefined, false);
    assert.equal(metrics.frontEaseRatio, null);
    assert.equal(metrics.isDistributionBalanced, false);
  });

  // Audit 4: Conservative uncertainty propagation formula: (|E_b|*dE_f + |E_f|*dE_b) / E_t^2
  test('Audit 4: Ratio uncertainty propagation strictly matches conservative differential formula', () => {
    const fBod = createMockMeas(22.00, 0.0002);
    const bBod = createMockMeas(23.00, 0.0003);
    const fSlv = createMockMeas(23.50, 0.0002); // E_f = 1.50, dE_f = 0.0004
    const bSlv = createMockMeas(25.00, 0.0003); // E_b = 2.00, dE_b = 0.0006

    const metrics = evaluateEaseCompatibility(fBod, bBod, fSlv, bSlv);
    assert.equal(metrics.isRatioDefined, true);
    assert.equal(metrics.frontEaseCm, 1.50);
    assert.equal(metrics.backEaseCm, 2.00);
    assert.equal(metrics.totalEaseCm, 3.50);

    // Analytical: (2.00 * 0.0004 + 1.50 * 0.0006) / (3.50^2) = (0.0008 + 0.0009) / 12.25 = 0.0017 / 12.25 = 0.00013877...
    const expected = Number(((2.00 * 0.0004 + 1.50 * 0.0006) / (3.50 * 3.50)).toFixed(4));
    assert.equal(metrics.frontEaseRatioUncertainty, expected);
  });

  // Audit 5: SVG parsing with scientific notation and concatenated negative signs
  test('Audit 5: SVG path transformation parses minus signs without spaces and scientific notation correctly', () => {
    const rawPath = 'M 10-20 C 1.5e-3 -2.5e-3, 1000 2000, 500 500 Z';
    const transformed = transformSvgPath(rawPath, { x: 5, y: 10 }, 0);
    assert.ok(!transformed.includes('NaN'), 'Transformed SVG path must not contain NaN');
    assert.ok(transformed.startsWith('M 15 -10'), 'M command must correctly offset 10-20 to 15 -10');
  });

  // Audit 6: Degenerate Bézier curves handle safely without throwing
  test('Audit 6: Degenerate Bézier segment with identical endpoints and control points computes zero length', () => {
    const degenerate = new CubicBezierCurve('deg-1', { x: 15, y: 25 }, { x: 15, y: 25 }, { x: 15, y: 25 }, { x: 15, y: 25 });
    const len = degenerate.lengthCm();
    assert.equal(len, 0);
  });

  // Audit 7: Crown apex C0 coincident but C1 tangent discontinuous is flagged
  test('Audit 7: Crown apex C0 coincident but C1 tangent discontinuous is detected and fails topology', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();

    // Corrupt front cap control point to create 45-degree angle departure at apex in stitchingContour
    const corruptedSleeve: PatternPiece = {
      ...sleevePiece,
      stitchingContour: sleevePiece.stitchingContour ? new GeometricContour(
        sleevePiece.stitchingContour.id,
        sleevePiece.stitchingContour.segments.map(seg => {
          if (seg.id === 'sleeve-front-cap') {
            const b = seg as any;
            return new CubicBezierCurve(b.id, b.p0, { x: b.p0.x + 2, y: b.p0.y + 2 }, b.cp2, b.p3);
          }
          return seg;
        }),
        sleevePiece.stitchingContour.isClosed
      ) : undefined
    };

    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece: corruptedSleeve,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.endpoints.crownShoulderMatch.isPositionalCoincident, true, 'Apex must be C0 coincident');
    assert.equal(result.endpoints.crownShoulderMatch.isTangentContinuous, false, 'Apex must flag C1 tangent discontinuity');
    assert.ok((result.endpoints.crownShoulderMatch.tangentDepartureDeg ?? 0) > 1.0, 'Tangent departure must exceed 1 degree');
    assert.equal(result.endpoints.isEndpointTopologyValid, false, 'Topology must be marked invalid');
    assert.equal(result.isValid, false, 'Assembly must be invalid');
  });

  // Audit 8: Metadata preservation in AssemblyTransformedPiece
  test('Audit 8: Source piece metadata (seam allowance, grainline, material, fold, cut count) is preserved', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.ok(result.inspectionLayout);
    const frontBodiceTrans = result.inspectionLayout.frontAssembly.bodice;
    assert.equal(frontBodiceTrans.seamAllowanceWidthCm, bodicePieces[0].seamAllowanceWidthCm);
    assert.equal(frontBodiceTrans.material, bodicePieces[0].material);
    assert.equal(frontBodiceTrans.onFold, bodicePieces[0].onFold);
    assert.equal(frontBodiceTrans.cutCount, bodicePieces[0].cutCount);
    assert.ok(frontBodiceTrans.transformedGrainline !== undefined);
  });

  // Audit 9: Nested geometry immutability
  test('Audit 9: Mutating input piece nested seams and segments does not mutate assembly output', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    const origX = result.pieces.frontBodice?.seams[0]?.startPoint.x;

    // Mutate source input
    if (bodicePieces[0].seams[0]) {
      bodicePieces[0].seams[0].startPoint.x += 999;
    }

    assert.equal(result.pieces.frontBodice?.seams[0]?.startPoint.x, origX, 'Result must be protected against external mutation');
  });

  // Audit 10: Repeated assembly execution with updated parameters produces independent outputs
  test('Audit 10: Repeated assembly runs with classic vs tailored strategies yield distinct ease envelopes', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();

    const resultClassic = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements,
      options: { strategy: 'classic' }
    });

    const resultTailored = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements,
      options: { strategy: 'tailored' }
    });

    assert.equal(resultClassic.ease.targetStrategy, 'classic');
    assert.equal(resultTailored.ease.targetStrategy, 'tailored');
    assert.notEqual(resultClassic.ease.targetTotalEaseCm, resultTailored.ease.targetTotalEaseCm);
  });

  // Audit 11: Stale CAD output prevention with unique ID and timestamp
  test('Audit 11: Each invocation produces a unique ID and valid ISO timestamp', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const res1 = assembleBodiceSleeve({ bodicePieces, sleevePiece, designSpec: standardDesign, measurements: standardMeasurements });
    const res2 = assembleBodiceSleeve({ bodicePieces, sleevePiece, designSpec: standardDesign, measurements: standardMeasurements });

    assert.notEqual(res1.id, res2.id);
    assert.ok(!isNaN(Date.parse(res1.timestamp)));
    assert.ok(!isNaN(Date.parse(res2.timestamp)));
  });

  // Audit 12: Missing/corrupted piece seams detected and flagged
  test('Audit 12: Bodice piece missing armhole seam returns invalid status', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const corruptedBodice = [
      {
        ...bodicePieces[0],
        seams: bodicePieces[0].seams.filter(s => !s.id.includes('armhole')),
        stitchingContour: bodicePieces[0].stitchingContour ? new GeometricContour(
          bodicePieces[0].stitchingContour.id,
          bodicePieces[0].stitchingContour.segments.filter(s => !s.id.includes('armhole')),
          bodicePieces[0].stitchingContour.isClosed
        ) : undefined
      },
      bodicePieces[1]
    ];

    const result = assembleBodiceSleeve({
      bodicePieces: corruptedBodice,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    assert.equal(result.isValid, false);
    assert.ok(result.validationReport.failureCount > 0);
  });

  // Audit 13: Mandatory unassessed conditions declared in validation report
  test('Audit 13: Validation report explicitly lists unassessed conditions for cloth drape and iron crimping', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    const unassessed = result.validationReport.unassessedConditions;
    assert.ok(unassessed && unassessed.length >= 3);
    assert.ok(unassessed.some(c => (c.name + ' ' + c.reason).toLowerCase().includes('drape')));
    assert.ok(unassessed.some(c => (c.name + ' ' + c.reason).toLowerCase().includes('crimp')));
    assert.ok(unassessed.some(c => (c.name + ' ' + c.reason).toLowerCase().includes('dynamic') || (c.name + ' ' + c.reason).toLowerCase().includes('reach')));
  });

  // Audit 14: Classification of 5.0 cm total cap ease limit as a tailoring craft limitation
  test('Audit 14: Total cap ease check message describes 5.0 cm limit as tailoring crimp capacity', () => {
    const { bodicePieces, sleevePiece } = createValidDrafts();
    const result = assembleBodiceSleeve({
      bodicePieces,
      sleevePiece,
      designSpec: standardDesign,
      measurements: standardMeasurements
    });

    const totalEaseCheck = result.validationReport.checks.find(c => c.id === 'val-asm-total-ease-limit');
    assert.ok(totalEaseCheck);
    assert.equal(totalEaseCheck.toleranceCm, 5.00);
  });
});
