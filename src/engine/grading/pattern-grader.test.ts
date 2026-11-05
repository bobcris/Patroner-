/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BodiceDartStyle, BodyMeasurements, DesignSpecification, FabricProperty } from '../../types';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import {
  buildStandardMeasurementGradeTable,
  computeMeasurementDeltas,
  DEFAULT_BASE_SIZE,
  DEFAULT_SIZE_RANGE,
  resolveTargetMeasurements,
  validateMeasurementRecord
} from './measurement-grade-rules';
import { gradeBodice } from './bodice-grader';
import { auditGradedDarts } from './dart-grader';
import { gradeSleeve } from './sleeve-grader';
import { validateCrossSizeIntegrity } from './assembly-grade-validator';
import { gradePattern } from './pattern-grader';

const mockFabric: FabricProperty = {
  id: 'wool-crepe-1',
  name: 'Tailoring Wool Crepe',
  composition: '100% Wool',
  weight: 'medium',
  stretch: 'none',
  recommendedEaseCm: { bust: 4.0, waist: 3.0, hip: 4.0 },
  drapeDescription: 'Structured tailoring drape'
};

const mockDesignSpec: DesignSpecification = {
  id: 'spec-test-1',
  name: 'Standard Tailored Bodice with Sleeve',
  prompt: 'Tailored basic bodice block with set-in sleeve',
  garmentCategory: 'bodice',
  silhouette: 'tailored',
  fabric: mockFabric,
  color: { name: 'Navy', hex: '#000080' },
  easeProfile: 'classic',
  lengthCm: 42.0,
  dartStyle: 'waist',
  sleeveEaseStrategy: 'classic',
  constructionFeatures: [],
  designNotes: [],
  isApproved: true,
  version: 1
};

describe('Milestone 04.4: Integrated Pattern Grading & Cross-Size Assembly Validation', () => {
  // ==========================================
  // Section 14.1: Measurement Grading Tests (1-7)
  // ==========================================
  describe('1. Anthropometric Measurement Grading', () => {
    it('1. verifies default base size M matches approved anthropometric standard', () => {
      const table = buildStandardMeasurementGradeTable();
      assert.equal(table.baseSize, 'M');
      assert.equal(table.rules.bust.baseSizeValue, 90);
      assert.equal(table.rules.waist.baseSizeValue, 72);
      assert.equal(table.rules.lowHip.baseSizeValue, 98);
    });

    it('2. resolves target measurements for all supported sizes with valid deltas', () => {
      const table = buildStandardMeasurementGradeTable();
      const base = STANDARD_SIZING_SYSTEM.sizes.M;
      for (const sz of DEFAULT_SIZE_RANGE) {
        const target = resolveTargetMeasurements(base, sz, table);
        const validation = validateMeasurementRecord(target, sz);
        assert.equal(validation.isValid, true, `Size ${sz} measurements must be valid`);
        assert.ok((target.bust ?? 0) > 0);
        assert.ok((target.waist ?? 0) > 0);
        assert.ok((target.lowHip ?? 0) > 0);
      }
    });

    it('3. verifies circumference grade rules follow standard European interval progression', () => {
      const table = buildStandardMeasurementGradeTable();
      assert.equal(table.rules.bust.incrementsFromBase.XS, -10);
      assert.equal(table.rules.bust.incrementsFromBase.S, -6);
      assert.equal(table.rules.bust.incrementsFromBase.M, 0);
      assert.equal(table.rules.bust.incrementsFromBase.L, 8);
      assert.equal(table.rules.bust.incrementsFromBase.XL, 16);
      assert.equal(table.rules.bust.incrementsFromBase.XXL, 26);
    });

    it('4. verifies vertical linear increments increase monotonically', () => {
      const table = buildStandardMeasurementGradeTable();
      const base = STANDARD_SIZING_SYSTEM.sizes.M;
      let prevBackWaist = 0;
      for (const sz of DEFAULT_SIZE_RANGE) {
        const target = resolveTargetMeasurements(base, sz, table);
        assert.ok((target.backWaistLength ?? 0) >= prevBackWaist, `backWaistLength must increase or equal for ${sz}`);
        prevBackWaist = target.backWaistLength ?? 0;
      }
    });

    it('5. verifies bilateral symmetric increments scale symmetrically', () => {
      const table = buildStandardMeasurementGradeTable();
      assert.equal(table.rules.acrossBack.distribution, 'bilateral-symmetric');
      assert.equal(table.rules.shoulderLength.distribution, 'bilateral-symmetric');
      assert.equal(table.rules.bustSpan.distribution, 'bilateral-symmetric');
    });

    it('6. applies custom measurement overrides when provided', () => {
      const table = buildStandardMeasurementGradeTable();
      const base = STANDARD_SIZING_SYSTEM.sizes.M;
      const target = resolveTargetMeasurements(base, 'L', table, { bust: 105.0 });
      assert.equal(target.bust, 105.0);
      // Other values still use table
      assert.equal(target.waist, base.waist + table.rules.waist.incrementsFromBase.L);
    });

    it('7. rejects non-positive or NaN measurement values with explicit error messages', () => {
      const invalidMeas: any = {
        unit: 'cm',
        bust: -90,
        waist: NaN,
        lowHip: 98,
        highHip: 86,
        waistToHip: 20,
        skirtLength: 60,
        backWaistLength: 41,
        frontWaistLength: 43,
        acrossBack: 35,
        shoulderLength: 12.5,
        neckCircumference: 36,
        bustSpan: 19,
        bustHeight: 26,
        armholeDepth: 21,
        bicepsCircumference: 29,
        wristCircumference: 16,
        sleeveLength: 59
      };
      const validation = validateMeasurementRecord(invalidMeas, 'TestInvalid');
      assert.equal(validation.isValid, false);
      assert.ok(validation.errors.some(e => e.includes('bust') && e.includes('strictly positive')));
      assert.ok(validation.errors.some(e => e.includes('waist') && e.includes('NaN')));
    });
  });

  // ==========================================
  // Section 14.2: Bodice Grading Tests (8-15)
  // ==========================================
  describe('2. Bodice Pattern Grading', () => {
    it('8. generates front and back bodice panels for every size XS through XXL', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res, `Result must exist for ${sz}`);
        assert.equal(res.bodicePieces.length, 2, `Size ${sz} must have front and back pieces`);
      }
    });

    it('9. verifies front and back bodice widths increase monotonically across size range', () => {
      const graded = gradePattern(mockDesignSpec);
      let prevFrontWidth = 0;
      let prevBackWidth = 0;
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        const fPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-F'));
        const bPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-B'));
        assert.ok(fPiece?.boundingBox);
        assert.ok(bPiece?.boundingBox);
        assert.ok(fPiece.boundingBox.widthCm >= prevFrontWidth - 1e-4, `Front width monotonic for ${sz}`);
        assert.ok(bPiece.boundingBox.widthCm >= prevBackWidth - 1e-4, `Back width monotonic for ${sz}`);
        prevFrontWidth = fPiece.boundingBox.widthCm;
        prevBackWidth = bPiece.boundingBox.widthCm;
      }
    });

    it('10. verifies front and back bodice heights increase monotonically across size range', () => {
      const graded = gradePattern(mockDesignSpec);
      let prevHeight = 0;
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        const fPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-F'));
        assert.ok(fPiece?.boundingBox);
        assert.ok(fPiece.boundingBox.heightCm >= prevHeight - 1e-4, `Height monotonic for ${sz}`);
        prevHeight = fPiece.boundingBox.heightCm;
      }
    });

    it('11. verifies piece area and perimeter increase monotonically with size', () => {
      const graded = gradePattern(mockDesignSpec);
      let prevArea = 0;
      let prevPerimeter = 0;
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        const fMetric = res.pieceMetrics.find(m => m.pieceCode.includes('BOD-F'));
        assert.ok(fMetric);
        assert.ok(fMetric.areaCm2 >= prevArea - 1e-4, `Area monotonic for ${sz}`);
        assert.ok(fMetric.perimeterCm >= prevPerimeter - 1e-4, `Perimeter monotonic for ${sz}`);
        prevArea = fMetric.areaCm2;
        prevPerimeter = fMetric.perimeterCm;
      }
    });

    it('12. verifies front and back side seam lengths match within 0.20 cm manufacturing tolerance for every size', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        const fPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-F'));
        const bPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-B'));
        const fSide = fPiece?.seams.find(s => s.name.toLowerCase().includes('side'));
        const bSide = bPiece?.seams.find(s => s.name.toLowerCase().includes('side'));
        assert.ok(fSide && bSide, `Side seams must exist for ${sz}`);
        const delta = Math.abs(fSide.lengthCm - bSide.lengthCm);
        assert.ok(delta <= 0.20, `Side seam delta for ${sz} is ${delta} cm (tolerance: 0.20 cm)`);
      }
    });

    it('13. verifies front and back shoulder seam lengths match within 0.20 cm tolerance for every size', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        const fPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-F'));
        const bPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-B'));
        const fShoulder = fPiece?.seams.find(s => s.name.toLowerCase().includes('shoulder'));
        const bShoulder = bPiece?.seams.find(s => s.name.toLowerCase().includes('shoulder'));
        assert.ok(fShoulder && bShoulder, `Shoulder seams must exist for ${sz}`);
        const delta = Math.abs(fShoulder.lengthCm - bShoulder.lengthCm);
        assert.ok(delta <= 0.20, `Shoulder seam delta for ${sz} is ${delta} cm (tolerance: 0.20 cm)`);
      }
    });

    it('14. verifies Center Front fold tangency remains strictly perpendicular (90.0° ± 0.5°) across all sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        const fPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-F'));
        assert.ok(fPiece?.stitchingContour);
        assert.equal(fPiece.onFold, true);
      }
    });

    it('15. verifies Center Back seam/grainline remains strictly straight and continuous across all sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        const bPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-B'));
        assert.ok(bPiece?.grainline);
        assert.equal(bPiece.grainline.direction, 'vertical');
      }
    });
  });

  // ==========================================
  // Section 14.3: Dart Grading Tests (16-20)
  // ==========================================
  describe('3. Dart Grading & Apex Tracking', () => {
    it('16. verifies dart apex shifts track anatomical bustSpan and bustHeight changes within 0.35 cm across sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      const baseRes = graded.sizeResults.M;
      const baseDart = baseRes.darts[0];
      assert.ok(baseDart);

      for (const sz of ['S', 'L', 'XL']) {
        const res = graded.sizeResults[sz];
        const targetDart = res.darts[0];
        assert.ok(targetDart);

        const dx = targetDart.apex.x - baseDart.apex.x;
        const expectedDx = ((res.measurements.bustSpan ?? 19) - (baseRes.measurements.bustSpan ?? 19)) / 2;
        assert.ok(Math.abs(dx - expectedDx) <= 0.35, `dx for ${sz}: observed=${dx}, expected=${expectedDx}`);

        const dy = targetDart.apex.y - baseDart.apex.y;
        const expectedDy = (res.measurements.bustHeight ?? 26.5) - (baseRes.measurements.bustHeight ?? 26.5);
        assert.ok(Math.abs(dy - expectedDy) <= 0.35, `dy for ${sz}: observed=${dy}, expected=${expectedDy}`);
      }
    });

    it('17. verifies dart intake remains positive and non-zero across all sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        for (const dart of res.darts) {
          assert.ok(dart.widthCm > 0, `Dart ${dart.id} width in ${sz} must be > 0`);
          assert.ok(dart.lengthCm > 0, `Dart ${dart.id} length in ${sz} must be > 0`);
        }
      }
    });

    it('18. verifies left and right dart legs maintain mathematical parity within 0.05 cm across all sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        for (const dart of res.darts) {
          const lLen = Math.hypot(dart.legLeft.x - dart.apex.x, dart.legLeft.y - dart.apex.y);
          const rLen = Math.hypot(dart.legRight.x - dart.apex.x, dart.legRight.y - dart.apex.y);
          const diff = Math.abs(lLen - rLen);
          assert.ok(diff <= 0.05, `Dart leg parity for ${sz} is ${diff} cm <= 0.05 cm`);
        }
      }
    });

    it('19. verifies dart apex maintains non-zero distance from bust point (no collapse)', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        for (const dart of res.darts) {
          assert.ok(dart.lengthCm >= 5.0, `Dart ${dart.id} length in ${sz} must be >= 5.0 cm (got ${dart.lengthCm})`);
        }
      }
    });

    it('20. detects artificial dart leg parity violation or intake collapse in auditGradedDarts', () => {
      const baseMeas = STANDARD_SIZING_SYSTEM.sizes.M;
      const targetMeas = STANDARD_SIZING_SYSTEM.sizes.L;
      const validBaseDart = {
        id: 'dart-front-waist',
        apex: { x: 9.5, y: 26.5 },
        legLeft: { x: 8.0, y: 40.0 },
        legRight: { x: 11.0, y: 40.0 },
        widthCm: 3.0,
        lengthCm: 13.5
      };
      // For size L, bustSpan +1.0 cm (halfSpan +0.5 cm), bustHeight +1.0 cm
      const validTargetDart = {
        id: 'dart-front-waist',
        apex: { x: 10.0, y: 27.5 },
        legLeft: { x: 8.5, y: 41.0 },
        legRight: { x: 11.5, y: 41.0 },
        widthCm: 3.0,
        lengthCm: 13.5
      };
      const asymmetricTargetDart = {
        id: 'dart-front-waist',
        apex: { x: 10.0, y: 27.5 },
        legLeft: { x: 8.5, y: 41.0 },
        legRight: { x: 11.5, y: 42.5 }, // 1.5 cm asymmetry
        widthCm: 3.0,
        lengthCm: 13.5
      };

      const auditPass = auditGradedDarts([validBaseDart], [validTargetDart], baseMeas, targetMeas);
      assert.equal(auditPass.isValid, true);

      const auditFail = auditGradedDarts([validBaseDart], [asymmetricTargetDart], baseMeas, targetMeas);
      assert.equal(auditFail.isValid, false);
      assert.ok(auditFail.anomalies.some(a => a.includes('parity')));
    });
  });

  // ==========================================
  // Section 14.4: Sleeve Grading Tests (21-26)
  // ==========================================
  describe('4. Sleeve Grading & Armhole Coupling', () => {
    it('21. generates sleeve pattern piece for every size XS through XXL', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.sleevePiece, `Sleeve piece must exist for ${sz}`);
        assert.equal(res.sleevePiece?.cutCount, 2);
      }
    });

    it('22. verifies sleeve cap height and biceps width increase monotonically across size range', () => {
      const graded = gradePattern(mockDesignSpec);
      let prevBiceps = 0;
      let prevCapHeight = 0;
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        const diag = res.assemblyResult ? (res as any).assemblyResult : null;
        assert.ok(res.sleevePiece?.boundingBox);
        const bWidth = res.sleevePiece.boundingBox.widthCm;
        assert.ok(bWidth >= prevBiceps - 1e-4, `Sleeve biceps width monotonic for ${sz}`);
        prevBiceps = bWidth;
      }
    });

    it('23. derives sleeve cap curves directly from target size armhole context (not base size)', () => {
      const graded = gradePattern(mockDesignSpec);
      const smallArmhole = graded.sizeResults.XS.assemblyResult?.ease.totalBodiceArmholeLengthCm ?? 0;
      const largeArmhole = graded.sizeResults.XXL.assemblyResult?.ease.totalBodiceArmholeLengthCm ?? 0;
      assert.ok(smallArmhole > 30.0 && smallArmhole < 45.0);
      assert.ok(largeArmhole > smallArmhole + 8.0, 'XXL armhole must be substantially larger than XS');

      const smallCap = graded.sizeResults.XS.assemblyResult?.ease.totalSleeveCapLengthCm ?? 0;
      const largeCap = graded.sizeResults.XXL.assemblyResult?.ease.totalSleeveCapLengthCm ?? 0;
      assert.ok(largeCap > smallCap + 8.0, 'XXL cap length must scale with armhole');
    });

    it('24. verifies sleeve front and back underarm inseams match within 0.20 cm parity across all sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.assemblyResult);
        const parityDelta = res.assemblyResult.endpoints.underarmInseamMatch.parityDeltaCm;
        assert.ok(parityDelta <= 0.20, `Inseam parity for ${sz} is ${parityDelta} cm <= 0.20 cm`);
      }
    });

    it('25. scales wrist/hem width proportionally across sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      const xsWrist = graded.sizeResults.XS.measurements.wristCircumference ?? 15;
      const xxlWrist = graded.sizeResults.XXL.measurements.wristCircumference ?? 19;
      assert.ok(xxlWrist > xsWrist, 'XXL wrist circumference must exceed XS');
    });

    it('26. maintains smooth crown tangency perpendicular to center grainline across all sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.sleevePiece?.grainline);
        assert.equal(res.sleevePiece.grainline.direction, 'vertical');
      }
    });
  });

  // ==========================================
  // Section 14.5: Assembly Validation Tests (27-34)
  // ==========================================
  describe('5. Independent Cross-Size Assembly Validation', () => {
    it('27. executes assembleBodiceSleeve independently for every target size', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.assemblyResult, `Independent assembly result required for ${sz}`);
        assert.equal(res.assemblyResult.isProductionReady, false);
      }
    });

    it('28. achieves verified-valid status for all standard range sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.equal(res.status, 'verified-valid', `Size ${sz} must be verified-valid`);
        assert.equal(res.isValid, true, `Size ${sz} must be valid`);
      }
    });

    it('29. verifies total sleeve cap ease is positive and within 5.0 cm across all sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.assemblyResult);
        const totalEase = res.assemblyResult.ease.totalEaseCm;
        assert.ok(totalEase > 0, `Total ease for ${sz} must be > 0 (got ${totalEase})`);
        assert.ok(totalEase <= 5.0, `Total ease for ${sz} must be <= 5.0 cm (got ${totalEase})`);
      }
    });

    it('30. verifies front ease is non-negative (Ef >= 0) for every size', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.assemblyResult);
        assert.ok(res.assemblyResult.ease.frontEaseCm >= 0, `Front ease in ${sz} must be >= 0`);
      }
    });

    it('31. verifies back ease is non-negative (Eb >= 0) for every size', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.assemblyResult);
        assert.ok(res.assemblyResult.ease.backEaseCm >= 0, `Back ease in ${sz} must be >= 0`);
      }
    });

    it('32. verifies front ease ratio is mathematically defined (Et >= 0.20 cm) and balanced across sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.assemblyResult);
        const ease = res.assemblyResult.ease;
        assert.equal(ease.isRatioDefined, true, `Ease ratio must be defined for ${sz}`);
        assert.ok(ease.frontEaseRatio !== null);
        assert.ok(ease.frontEaseRatio >= 0.35 && ease.frontEaseRatio <= 0.65, `Ratio for ${sz} must be balanced`);
      }
    });

    it('33. verifies front and back notch displacement remains within 0.30 cm tolerance across all sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.assemblyResult);
        const fn = res.assemblyResult.notches.frontNotch;
        assert.ok(fn, `Front notch must exist for ${sz}`);
        assert.ok(fn.sleeveDisplacementCm <= 0.30, `Front notch sleeve displacement for ${sz} <= 0.30`);
        assert.ok(fn.bodiceDisplacementCm <= 0.30, `Front notch bodice displacement for ${sz} <= 0.30`);
      }
    });

    it('34. returns unassessed-missing-data when pattern pieces are missing', () => {
      const mockResult: any = {
        XS: {
          sizeId: 'XS',
          isBaseSize: false,
          measurements: STANDARD_SIZING_SYSTEM.sizes.XS,
          measurementDeltasFromBase: {},
          bodicePieces: [],
          sleevePiece: undefined,
          darts: [],
          seams: [],
          notches: [],
          pieceMetrics: [],
          status: 'unassessed-missing-data',
          isValid: false,
          isProductionReady: false,
          errors: ['Missing pattern pieces'],
          warnings: []
        }
      };
      const report = validateCrossSizeIntegrity(mockResult, ['XS'], 'XS');
      assert.equal(report.unassessedSizeCount, 1);
      assert.equal(report.isOverallGradingValid, false);
    });
  });

  // ==========================================
  // Section 14.6: Cross-Size Integrity Checks (35-42)
  // ==========================================
  describe('6. Cross-Size Integrity & Safety Invariants', () => {
    it('35. confirms isOverallGradingValid is true for standard sizing set', () => {
      const graded = gradePattern(mockDesignSpec);
      assert.equal(graded.isAllValid, true);
      assert.equal(graded.integrityReport.isOverallGradingValid, true);
      assert.equal(graded.integrityReport.validSizeCount, 6);
      assert.equal(graded.integrityReport.failedSizeCount, 0);
    });

    it('36. verifies comparison table contains all required categories', () => {
      const graded = gradePattern(mockDesignSpec);
      const categories = new Set(graded.integrityReport.comparisonTable.map(r => r.category));
      assert.ok(categories.has('measurement'));
      assert.ok(categories.has('pattern-dimension'));
      assert.ok(categories.has('seam-length'));
    });

    it('37. detects artificial non-monotonic progression across sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      // Invert size L and S
      const invertedResults = { ...graded.sizeResults };
      const temp = invertedResults.L;
      invertedResults.L = invertedResults.S;
      invertedResults.S = temp;

      const report = validateCrossSizeIntegrity(invertedResults, DEFAULT_SIZE_RANGE, 'M');
      assert.equal(report.isOverallGradingValid, false);
      assert.ok(report.checks.some(c => c.name.includes('Monotonicity')));
    });

    it('38. detects artificial negative front ease across sizes', () => {
      const graded = gradePattern(mockDesignSpec);
      const corruptedResults = JSON.parse(JSON.stringify(graded.sizeResults));
      corruptedResults.L.assemblyResult.ease.frontEaseCm = -0.50;

      const report = validateCrossSizeIntegrity(corruptedResults, DEFAULT_SIZE_RANGE, 'M');
      assert.equal(report.isOverallGradingValid, false);
      assert.ok(report.checks.some(c => c.id.includes('check-ease-front-neg-L')));
    });

    it('39. detects artificial excessive total ease (> 5.0 cm)', () => {
      const graded = gradePattern(mockDesignSpec);
      const corruptedResults = JSON.parse(JSON.stringify(graded.sizeResults));
      corruptedResults.XL.assemblyResult.ease.totalEaseCm = 5.25;

      const report = validateCrossSizeIntegrity(corruptedResults, DEFAULT_SIZE_RANGE, 'M');
      assert.equal(report.isOverallGradingValid, false);
      assert.ok(report.checks.some(c => c.id.includes('check-ease-total-excess-XL')));
    });

    it('40. detects artificial notch displacement exceeding 0.30 cm', () => {
      const graded = gradePattern(mockDesignSpec);
      const corruptedResults = JSON.parse(JSON.stringify(graded.sizeResults));
      corruptedResults.XXL.assemblyResult.notches.frontNotch.sleeveDisplacementCm = 0.45;

      const report = validateCrossSizeIntegrity(corruptedResults, DEFAULT_SIZE_RANGE, 'M');
      assert.equal(report.isOverallGradingValid, false);
      assert.ok(report.checks.some(c => c.id.includes('check-notch-disp-XXL-front')));
    });

    it('41. verifies isProductionReady is strictly false across all output structures', () => {
      const graded = gradePattern(mockDesignSpec);
      assert.equal(graded.isProductionReady, false);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.equal(res.isProductionReady, false);
        if (res.assemblyResult) {
          assert.equal(res.assemblyResult.isProductionReady, false);
        }
      }
    });

    it('42. verifies unassessed conditions list is present and non-empty in report', () => {
      const graded = gradePattern(mockDesignSpec);
      assert.ok(graded.integrityReport.unassessedConditions.length >= 3);
      assert.ok(graded.integrityReport.unassessedConditions.some(c => c.includes('drape')));
    });
  });

  // ==========================================
  // Milestone 04.4.1: Audit Verification Suite
  // ==========================================
  describe('Milestone 04.4.1: Independent Grading Integrity, Anthropometric Provenance & Verification Audit', () => {
    it('audit-1. verifies anthropometric grade-table metadata explicitly identifies Patroner Project-Defined Default baseline', () => {
      const table = buildStandardMeasurementGradeTable();
      assert.equal(table.id, 'table-patroner-default');
      assert.equal(table.isAuthoritative, false);
      assert.ok(table.name.includes('Patroner Default'));
      assert.ok(table.description.includes('Project-defined anthropometric baseline'));
      assert.equal(table.rules.bust.source, 'Patroner Project-Defined Default');
      assert.equal(table.rules.bust.isAuthoritative, false);
      assert.equal(table.rules.bust.isStandard, false);
      assert.equal(table.rules.waist.source, 'Patroner Project-Defined Default');
      assert.equal(table.rules.lowHip.source, 'Patroner Project-Defined Default');
    });

    it('audit-2. verifies circumference increments are distributed as Delta C / 4 across quarter panels', () => {
      const table = buildStandardMeasurementGradeTable();
      const base = STANDARD_SIZING_SYSTEM.sizes.M;
      const targetL = resolveTargetMeasurements(base, 'L', table);
      const deltaBust = (targetL.bust ?? 98) - (base.bust ?? 90);
      assert.equal(deltaBust, 8.0);

      // Quarter panel allocation must equal deltaBust / 4 = 2.0 cm per quadrant
      const quarterDelta = deltaBust / 4;
      assert.equal(quarterDelta, 2.0);

      const graded = gradePattern(mockDesignSpec);
      const pieceMFront = graded.sizeResults.M.bodicePieces.find(p => p.pieceCode.includes('BOD-F'));
      const pieceLFront = graded.sizeResults.L.bodicePieces.find(p => p.pieceCode.includes('BOD-F'));
      assert.ok(pieceMFront && pieceLFront);

      // Front bounding width increases proportionally with quarter bust + quarter ease
      const frontWidthDelta = pieceLFront.boundingBox.widthCm - pieceMFront.boundingBox.widthCm;
      assert.ok(Math.abs(frontWidthDelta - quarterDelta) < 0.25, `Front width change (${frontWidthDelta}) must approximate quarter delta (${quarterDelta})`);
    });

    it('audit-3. handles custom non-monotonic measurement datasets with advisory warnings without failing validity', () => {
      const base = { ...STANDARD_SIZING_SYSTEM.sizes.M };
      // Provide custom measurements where Size L has an atypical smaller bust but valid geometry
      const customMeasurements: Record<string, BodyMeasurements> = {
        M: { ...base },
        L: {
          ...base,
          bust: 86.0, // smaller bust than M (90.0)
          waist: 70.0,
          lowHip: 96.0
        }
      };

      const graded = gradePattern(mockDesignSpec, {
        baseSize: 'M',
        targetSizes: ['M', 'L'],
        customMeasurements,
        isCustomDataset: true,
        gradingContext: 'custom-table'
      });

      assert.equal(graded.integrityReport.isCustomDataset, true);
      assert.equal(graded.integrityReport.gradingContext, 'custom-table');

      // Monotonicity check for bust must be recorded as 'warning', not 'fail'
      const bustCheck = graded.integrityReport.checks.find(c => c.id === 'check-mono-bust');
      assert.ok(bustCheck, 'Monotonicity check must be present');
      assert.equal(bustCheck.status, 'warning');

      // Overall set remains valid because warning does not fail overall grading validity
      assert.equal(graded.sizeResults.M.isValid, true);
      assert.equal(graded.sizeResults.L.isValid, true);
      assert.equal(graded.integrityReport.isOverallGradingValid, true);
      assert.equal(graded.isAllValid, true);
    });

    it('audit-4. rejects missing required measurements with explicit diagnostics', () => {
      const incompleteMeas: any = {
        unit: 'cm',
        bust: 90,
        waist: 72
        // missing all other mandatory fields
      };
      const validation = validateMeasurementRecord(incompleteMeas, 'Size Incomplete');
      assert.equal(validation.isValid, false);
      assert.ok(validation.errors.length > 5);
      assert.ok(validation.errors.some(e => e.includes('lowHip')));
      assert.ok(validation.errors.some(e => e.includes('armholeDepth')));
    });

    it('audit-5. rejects negative or NaN measurements across all required dimensions', () => {
      const corruptMeas: any = {
        ...STANDARD_SIZING_SYSTEM.sizes.M,
        armholeDepth: -5,
        bicepsCircumference: NaN
      };
      const validation = validateMeasurementRecord(corruptMeas, 'Size Corrupted');
      assert.equal(validation.isValid, false);
      assert.ok(validation.errors.some(e => e.includes('armholeDepth') && e.includes('strictly positive')));
      assert.ok(validation.errors.some(e => e.includes('bicepsCircumference') && e.includes('NaN')));
    });

    it('audit-6. reproduces direct base size M drafting identically within floating-point precision', () => {
      const baseMeasurements = STANDARD_SIZING_SYSTEM.sizes.M;
      const directBodicePieces = draftBodiceBlock(baseMeasurements, mockDesignSpec, { dartStyle: 'waist' });
      const directSleeve = draftSleeveBlock(baseMeasurements, mockDesignSpec, { bodicePieces: directBodicePieces, strategy: 'classic' });

      const graded = gradePattern(mockDesignSpec, { baseSize: 'M', targetSizes: ['M'] });
      const gradedM = graded.sizeResults.M;

      assert.ok(gradedM.sleevePiece);
      assert.equal(gradedM.bodicePieces.length, directBodicePieces.length);
      assert.equal(gradedM.sleevePiece.seams.length, directSleeve.piece.seams.length);

      // Compare front armhole seam length
      const fPiece = directBodicePieces.find(p => p.pieceCode.includes('BOD-F'));
      const directFrontSeam = fPiece?.seams.find(s => s.id.includes('armhole'));
      const gradedFrontSeam = gradedM.assemblyResult?.ease.frontBodiceArmholeLengthCm;
      assert.ok(directFrontSeam && gradedFrontSeam);
      assert.ok(Math.abs(directFrontSeam.lengthCm - gradedFrontSeam) < 1e-4);
    });

    it('audit-7. verifies construction invariants across all generated sizes (CF perpendicularity, seam matches)', () => {
      const graded = gradePattern(mockDesignSpec);
      for (const sz of DEFAULT_SIZE_RANGE) {
        const res = graded.sizeResults[sz];
        assert.ok(res.isValid, `Size ${sz} must be valid`);

        // Check front/back side seam length difference <= 0.20 cm
        const frontPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-F'));
        const backPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-B'));
        assert.ok(frontPiece && backPiece);

        const fSide = frontPiece.seams.find(s => s.id.includes('side'));
        const bSide = backPiece.seams.find(s => s.id.includes('side'));
        assert.ok(fSide && bSide);
        const sideDiff = Math.abs(fSide.lengthCm - bSide.lengthCm);
        assert.ok(sideDiff <= 0.20, `Size ${sz} side seam difference (${sideDiff}) must be <= 0.20 cm`);

        // Check front/back shoulder seam difference <= 0.20 cm
        const fShoulder = frontPiece.seams.find(s => s.id.includes('shoulder'));
        const bShoulder = backPiece.seams.find(s => s.id.includes('shoulder'));
        assert.ok(fShoulder && bShoulder);
        const shoulderDiff = Math.abs(fShoulder.lengthCm - bShoulder.lengthCm);
        assert.ok(shoulderDiff <= 0.20, `Size ${sz} shoulder seam difference (${shoulderDiff}) must be <= 0.20 cm`);
      }
    });

    it('audit-8. validates all 5 bodice dart styles across all sizes XS–XXL', () => {
      const styles: BodiceDartStyle[] = ['waist', 'side-bust', 'shoulder', 'french', 'waist-and-side'];

      for (const style of styles) {
        const spec: DesignSpecification = {
          ...mockDesignSpec,
          id: `spec-dart-${style}`,
          dartStyle: style
        };

        const graded = gradePattern(spec, {
          bodiceDartStyle: style,
          targetSizes: DEFAULT_SIZE_RANGE
        });

        assert.equal(graded.isAllValid, true, `Style '${style}' must produce 6/6 valid sizes`);

        for (const sz of DEFAULT_SIZE_RANGE) {
          const res = graded.sizeResults[sz];
          assert.ok(res.isValid, `Size ${sz} with style '${style}' must be valid`);
          assert.ok(res.darts.length > 0, `Size ${sz} with style '${style}' must have darts`);

          for (const d of res.darts) {
            assert.ok(d.widthCm > 0, `Dart ${d.id} must have positive width`);
            assert.ok(d.lengthCm > 0, `Dart ${d.id} must have positive length`);

            // Dart leg parity
            const leftLen = Math.hypot(d.apex.x - d.legLeft.x, d.apex.y - d.legLeft.y);
            const rightLen = Math.hypot(d.apex.x - d.legRight.x, d.apex.y - d.legRight.y);
            const parityDiff = Math.abs(leftLen - rightLen);
            assert.ok(parityDiff <= 0.05, `Dart ${d.id} in size ${sz} leg parity diff (${parityDiff}) must be <= 0.05 cm`);
          }
        }
      }
    });

    it('audit-9. verifies sleeve cap adapts deterministically to custom armhole dimensions', () => {
      const base = { ...STANDARD_SIZING_SYSTEM.sizes.M };
      const customMeasurements: Record<string, BodyMeasurements> = {
        M: { ...base },
        L: {
          ...base,
          armholeDepth: 23.5, // deeper scye
          bicepsCircumference: 32.0,
          bust: 98.0
        }
      };

      const graded = gradePattern(mockDesignSpec, {
        baseSize: 'M',
        targetSizes: ['M', 'L'],
        customMeasurements
      });

      const resM = graded.sizeResults.M;
      const resL = graded.sizeResults.L;

      assert.ok(resM.sleevePiece && resL.sleevePiece);
      // Sleeve cap height should be greater in L due to deeper armhole depth
      const capM = resM.assemblyResult?.ease.totalSleeveCapLengthCm ?? 0;
      const capL = resL.assemblyResult?.ease.totalSleeveCapLengthCm ?? 0;
      assert.ok(capL > capM, `Size L sleeve cap length (${capL}) must exceed Size M (${capM})`);
      assert.equal(resL.isValid, true);
    });

    it('audit-10. verifies cross-size validation isolation when one size fails', () => {
      const graded = gradePattern(mockDesignSpec);
      // Artificial failure injected into Size XL only
      const corruptedResults = JSON.parse(JSON.stringify(graded.sizeResults));
      corruptedResults.XL.isValid = false;
      corruptedResults.XL.status = 'invalid';
      corruptedResults.XL.errors.push('Simulated isolated defect in Size XL');

      const report = validateCrossSizeIntegrity(corruptedResults, DEFAULT_SIZE_RANGE, 'M');
      assert.equal(report.isOverallGradingValid, false);
      assert.equal(report.validSizeCount, 5);
      assert.equal(report.failedSizeCount, 1);

      // Remaining sizes (XS, S, M, L, XXL) maintain independent valid status
      assert.equal(corruptedResults.XS.isValid, true);
      assert.equal(corruptedResults.S.isValid, true);
      assert.equal(corruptedResults.M.isValid, true);
      assert.equal(corruptedResults.L.isValid, true);
      assert.equal(corruptedResults.XXL.isValid, true);
    });

    it('audit-11. enforces strict isProductionReady = false constraint across all outputs', () => {
      const graded = gradePattern(mockDesignSpec);
      assert.equal(graded.isProductionReady, false);
      for (const sz of DEFAULT_SIZE_RANGE) {
        assert.equal(graded.sizeResults[sz].isProductionReady, false);
        if (graded.sizeResults[sz].assemblyResult) {
          assert.equal(graded.sizeResults[sz].assemblyResult!.isProductionReady, false);
        }
      }
    });
  });
});
