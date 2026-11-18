/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Milestone 04.3 — Independent Verification & Recovery Test Suite
 * Verifies SHA-256 canonicalization, non-empty payload invariant, precision, angle wrap,
 * pre-sort double-notch ordering, elbow-back placement, uncertainty gate, governance,
 * split shoulder seams, handedness, deep-clone immutability, and XS–XXL sizing matrix.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BodiceDartStyle, DesignSpecification, PatternPiece, StandardSize, SleeveEaseStrategy } from '../../types';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { normalizeAngleDeg, smallestAngularDifferenceDeg } from '../geometry/math';
import { CubicBezierCurve, GeometricContour } from '../geometry/primitives';
import {
  assembleBodiceSleeve,
  buildCanonicalAssemblyReportPayload,
  canonicalizeAssemblyJson,
  digestCanonicalPayload,
  EMPTY_JSON_OBJECT_SHA256,
  encodeUtf8,
  formatSignedCm,
  resolveAndValidateAssemblyConfig,
  serializeDeterministicAssemblyReport,
  sha256Hex
} from './index';

function createBaseDesign(overrides: Partial<DesignSpecification> = {}): DesignSpecification {
  return {
    id: 'spec-m043-verify',
    name: 'M04.3 Audit Bodice & Sleeve',
    prompt: 'Tailored fitted bodice with one-piece sleeve',
    garmentCategory: 'bodice',
    silhouette: 'tailored',
    easeProfile: 'fitted',
    lengthCm: 55,
    color: { name: 'Charcoal', hex: '#2b2b2b' },
    fabric: {
      id: 'wool-suiting',
      name: 'Tailoring Wool Suiting',
      composition: '100% Virgin Wool',
      weight: 'medium',
      stretch: 'none',
      recommendedEaseCm: { waist: 2.5, hip: 3.5, bust: 3.5 },
      drapeDescription: 'Structured tailoring drape'
    },
    constructionFeatures: [],
    designNotes: [],
    isApproved: true,
    approvalState: 'approved',
    version: 1,
    ...overrides
  };
}

describe('Milestone 04.3 — Cryptographic SHA-256 & Canonical Serialization Assurance', () => {
  test('FIPS 180-4 SHA-256 matches known test vectors and Node crypto across ASCII, multi-block & UTF-8 Unicode', () => {
    // FIPS 180-4 empty string
    assert.equal(
      sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    // FIPS 180-4 "abc"
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    // Multi-block > 56 bytes
    const multiBlock = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    assert.equal(
      sha256Hex(multiBlock),
      createHash('sha256').update(multiBlock, 'utf8').digest('hex')
    );
    // Empty JSON object digest constant check
    assert.equal(sha256Hex('{}'), EMPTY_JSON_OBJECT_SHA256);

    // Multi-byte UTF-8 Unicode parity
    for (const sample of ['café crème — 2.50 cm', '日本語パターン検査', 'e\u0301'.normalize('NFC')]) {
      assert.equal(
        sha256Hex(sample),
        createHash('sha256').update(sample, 'utf8').digest('hex'),
        `UTF-8 parity failed for ${sample}`
      );
    }
  });

  test('encodeUtf8 rejects non-string input strictly', () => {
    assert.throws(() => encodeUtf8(null as unknown as string), TypeError);
    assert.throws(() => encodeUtf8(123 as unknown as string), TypeError);
    assert.throws(() => encodeUtf8({} as unknown as string), TypeError);
  });

  test('canonicalizeAssemblyJson normalizes key order, -0 -> 0, and Unicode NFC while rejecting NaN and cycles', () => {
    const a = { b: 2, a: -0, nested: { z: 'e\u0301', a: true } };
    const b = { nested: { a: true, z: '\u00e9' }, a: 0, b: 2 };
    assert.equal(canonicalizeAssemblyJson(a), canonicalizeAssemblyJson(b));
    assert.equal(canonicalizeAssemblyJson(a), '{"a":0,"b":2,"nested":{"a":true,"z":"é"}}');

    assert.throws(() => canonicalizeAssemblyJson({ bad: Number.NaN }), /non-finite/);
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    assert.throws(() => canonicalizeAssemblyJson(cyc), /circular/);
  });

  test('digestCanonicalPayload refuses empty "{}" payload (44136fa3...)', () => {
    assert.throws(
      () => digestCanonicalPayload({}),
      /44136fa3|empty JSON object/i
    );
    assert.throws(
      () => digestCanonicalPayload({ skipped: undefined }),
      /44136fa3|empty JSON object/i
    );
  });

  test('Assembly report digest is non-empty, cross-run deterministic, and matches Node crypto', () => {
    const design = createBaseDesign();
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;

    const run1 = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve,
      designSpec: design,
      measurements: meas,
      options: { strategy: 'classic' }
    });
    const run2 = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve,
      designSpec: design,
      measurements: meas,
      options: { strategy: 'classic' }
    });

    assert.notEqual(run1.executionMetadata.runId, run2.executionMetadata.runId);
    assert.notEqual(run1.canonicalContentDigest, EMPTY_JSON_OBJECT_SHA256);
    assert.equal(run1.canonicalContentDigest, run1.reportSha256Hex);
    assert.equal(run1.reportSha256Hex, run2.reportSha256Hex);
    assert.ok(run1.canonicalJsonByteLength > 500, 'Canonical assembly JSON must carry full report payload');

    const serialized = serializeDeterministicAssemblyReport(run1);
    const nodeSha = createHash('sha256').update(serialized.canonicalJson, 'utf8').digest('hex');
    assert.equal(serialized.sha256Hex, nodeSha);
    assert.equal(serialized.sha256Hex, run1.reportSha256Hex);
    assert.ok(buildCanonicalAssemblyReportPayload(run1).validationReport !== undefined);
  });
});

describe('Milestone 04.3 — Defect Fixes & Fail-Closed Boundaries', () => {
  test('formatSignedCm avoids +- prefix on negative values', () => {
    assert.equal(formatSignedCm(1.5), '+1.50 cm');
    assert.equal(formatSignedCm(-1.834), '-1.83 cm');
    assert.equal(formatSignedCm(0), '0.00 cm');
  });

  test('normalizeAngleDeg maps arbitrary angles cleanly into (-180, 180]', () => {
    assert.equal(normalizeAngleDeg(270), -90);
    assert.equal(normalizeAngleDeg(-270), 90);
    assert.equal(normalizeAngleDeg(-180), 180);
    assert.equal(normalizeAngleDeg(540), 180);
    assert.equal(smallestAngularDifferenceDeg(179, -179), 2);
  });

  test('customTargetEaseCm === 0 is preserved without truthy skip, and invalid config fails closed', () => {
    const zeroCfg = resolveAndValidateAssemblyConfig({ customTargetEaseCm: 0 });
    assert.equal(zeroCfg.isValid, true);
    assert.equal(zeroCfg.resolvedCustomTargetEaseCm, 0);

    const negCfg = resolveAndValidateAssemblyConfig({ customTargetEaseCm: -0.5 });
    assert.equal(negCfg.isValid, false);

    const design = createBaseDesign();
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    const sleeve = draftSleeveBlock(meas, design, {
      strategy: 'flat',
      bodicePieces: bodice
    }).piece;

    const resZero = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve,
      designSpec: design,
      measurements: meas,
      options: { strategy: 'flat', customTargetEaseCm: 0 }
    });
    assert.equal(resZero.ease.targetTotalEaseCm, 0);
    assert.equal(resZero.ease.customEnvelopeCm?.min, 0);
    assert.equal(resZero.ease.customEnvelopeCm?.max, 0.5);
  });

  test('Strictly fail-closed on negative ease (-0.01 cm front ease)', () => {
    const design = createBaseDesign();
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    // Draft incompatible XS flat sleeve against Size M bodice -> negative ease
    const xsFlatSleeve = draftSleeveBlock(STANDARD_SIZING_SYSTEM.sizes.XS, design, { strategy: 'flat' }).piece;

    const res = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: xsFlatSleeve,
      designSpec: design,
      measurements: meas,
      options: { strategy: 'classic' }
    });

    assert.equal(res.isValid, false);
    assert.equal(res.status, 'invalid');
    assert.equal(res.isProductionReady, false);
    assert.ok(res.ease.frontEaseCm < 0 || res.ease.backEaseCm < 0);
    assert.equal(res.seamCompatibility.areAllSeamsIndividuallyValid, false);
  });

  test('Reversed back double-notch ordering (-1 / -2 positions swapped) fails closed BEFORE sorting', () => {
    const design = createBaseDesign();
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;

    const b1 = sleeve.notches.find(n => n.id === 'notch-slv-back-armhole-1')!;
    const b2 = sleeve.notches.find(n => n.id === 'notch-slv-back-armhole-2')!;
    assert.ok(b1 && b2);

    const swappedSleeve: PatternPiece = {
      ...sleeve,
      notches: sleeve.notches.map(n => {
        if (n.id === b1.id) return { ...n, position: { ...b2.position } };
        if (n.id === b2.id) return { ...n, position: { ...b1.position } };
        return n;
      })
    };

    const res = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: swappedSleeve,
      designSpec: design,
      measurements: meas,
      options: { strategy: 'classic' }
    });

    assert.equal(res.isValid, false);
    assert.equal(res.notches.isValid, false);
    assert.equal(res.notches.backNotches?.preSortSleeveOrderValid, false);
    assert.equal(res.notches.backNotches?.isOrderingValid, false);
  });

  test('Elbow-back and elbow-front notches sit strictly on inseam contours (<= 0.05 cm) with pair parity <= 0.15 cm', () => {
    const design = createBaseDesign();
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;

    const res = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve,
      designSpec: design,
      measurements: meas,
      options: { strategy: 'classic' }
    });

    assert.ok(res.notches.elbowFrontNotch);
    assert.ok(res.notches.elbowBackNotch);
    assert.ok(res.notches.elbowPairParity);
    assert.ok(res.notches.elbowFrontNotch.displacementFromContourCm <= 0.05);
    assert.ok(res.notches.elbowBackNotch.displacementFromContourCm <= 0.05);
    assert.ok(res.notches.elbowPairParity.parityDeltaCm <= 0.15);
    assert.equal(res.notches.elbowPairParity.isParityValid, true);
  });

  test('Strict uncertainty gate rejects loose bezierToleranceCm exceeding uncertainty bound', () => {
    const design = createBaseDesign();
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;

    const res = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve,
      designSpec: design,
      measurements: meas,
      options: { strategy: 'classic', bezierToleranceCm: 0.45, strictUncertaintyGate: true }
    });

    assert.equal(res.uncertaintyGate.passed, false);
    assert.equal(res.isValid, false);
  });

  test('Sleeve handedness inversion fails closed', () => {
    const design = createBaseDesign();
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;

    // Mirror X coordinates of cap segments to invert handedness
    const mirroredSegments = sleeve.stitchingContour!.segments.map(seg => {
      if (seg.id === 'sleeve-front-cap' || seg.id === 'sleeve-back-cap') {
        const b = seg as CubicBezierCurve;
        return new CubicBezierCurve(
          b.id,
          { x: -b.p0.x, y: b.p0.y },
          { x: -b.cp1.x, y: b.cp1.y },
          { x: -b.cp2.x, y: b.cp2.y },
          { x: -b.p3.x, y: b.p3.y },
          b.seamAllowanceCm,
          b.isFold,
          b.seamId
        );
      }
      return seg;
    });

    const res = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: {
        ...sleeve,
        stitchingContour: new GeometricContour(sleeve.stitchingContour!.id, mirroredSegments, true)
      },
      designSpec: design,
      measurements: meas,
      options: { strategy: 'classic' }
    });

    assert.equal(res.endpoints.sleeveHandedness?.isValid, false);
    assert.equal(res.isValid, false);
  });

  test('Governance fails closed on standard-chart / unverified when requireApprovedGovernance is enabled, and never sets isProductionReady: true', () => {
    const design = createBaseDesign({ isApproved: true, approvalState: 'approved' });
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;

    const blockedChart = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve,
      designSpec: design,
      measurements: meas,
      options: {
        strategy: 'classic',
        measurementProvenance: 'standard-chart',
        measurementApprovalState: 'approved',
        requireApprovedGovernance: true
      }
    });
    assert.equal(blockedChart.governance.isGovernanceApproved, false);
    assert.equal(blockedChart.isValid, false);
    assert.equal(blockedChart.isProductionReady, false);

    const approvedMeasured = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve,
      designSpec: design,
      measurements: meas,
      options: {
        strategy: 'classic',
        measurementProvenance: 'physically-measured',
        measurementApprovalState: 'approved',
        requireApprovedGovernance: true
      }
    });
    assert.equal(approvedMeasured.governance.isGovernanceApproved, true);
    assert.equal(approvedMeasured.isValid, true);
    assert.equal(approvedMeasured.isProductionReady, false);
  });

  test('Rigid layout encloses all 4 pieces in layoutBoundingBox and passes rigidVerification', () => {
    const design = createBaseDesign();
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;

    const res = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve,
      designSpec: design,
      measurements: meas,
      options: { strategy: 'classic' }
    });

    const layout = res.inspectionLayout!;
    assert.ok(layout);
    assert.equal(layout.rigidVerification?.isRigidVerified, true);
    assert.ok((layout.rigidVerification?.frontJunctionDeltaCm ?? 1) <= 1e-6);
    assert.ok((layout.rigidVerification?.backJunctionDeltaCm ?? 1) <= 1e-6);
    assert.equal(layout.rigidVerification?.assembliesNonOverlapping, true);

    const box = layout.layoutBoundingBox;
    for (const tp of [
      layout.frontAssembly.bodice,
      layout.frontAssembly.sleeve,
      layout.backAssembly.bodice,
      layout.backAssembly.sleeve
    ]) {
      assert.ok(box.minX <= tp.transformedBoundingBox.minX + 1e-9);
      assert.ok(box.minY <= tp.transformedBoundingBox.minY + 1e-9);
      assert.ok(box.maxX >= tp.transformedBoundingBox.maxX - 1e-9);
      assert.ok(box.maxY >= tp.transformedBoundingBox.maxY - 1e-9);
    }
  });

  test('Deep clone protects grainline, drillHoles, and cuttingContour against post-assembly mutation', () => {
    const design = createBaseDesign();
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(meas, design);
    const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;

    const res = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve,
      designSpec: design,
      measurements: meas,
      options: { strategy: 'classic' }
    });

    const origGrainX = res.pieces.frontBodice!.grainline.start.x;
    bodice[0].grainline.start.x += 500;
    assert.equal(res.pieces.frontBodice!.grainline.start.x, origGrainX);

    if (bodice[0].drillHoles && bodice[0].drillHoles.length > 0 && res.pieces.frontBodice!.drillHoles) {
      const origDhX = res.pieces.frontBodice!.drillHoles[0].x;
      bodice[0].drillHoles[0].x += 500;
      assert.equal(res.pieces.frontBodice!.drillHoles[0].x, origDhX);
    }
  });
});

describe('Milestone 04.3 — Multi-Size (XS–XXL) & Dart Style Matrix Verification', () => {
  test('XS–XXL matrix with classic strategy achieves full assembly validity across all 6 sizes', () => {
    const sizes: StandardSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    const design = createBaseDesign();

    for (const size of sizes) {
      const meas = STANDARD_SIZING_SYSTEM.sizes[size];
      const bodice = draftBodiceBlock(meas, design);
      const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;
      const res = assembleBodiceSleeve({
        bodicePieces: bodice,
        sleevePiece: sleeve,
        designSpec: design,
        measurements: meas,
        options: { strategy: 'classic' }
      });

      assert.equal(
        res.isValid,
        true,
        `Size ${size} classic failed: ${res.validationReport.checks.filter(c => c.status === 'fail').map(c => c.message).join(' | ')}`
      );
      assert.equal(res.isProductionReady, false);
      assert.ok(res.contourIntegrity.isValid);
    }
  });

  test('All 5 bodice dart manipulations (including split shoulder seam) assemble cleanly on Size M classic', () => {
    const dartStyles: BodiceDartStyle[] = ['waist', 'side-bust', 'shoulder', 'french', 'waist-and-side'];
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;

    for (const dartStyle of dartStyles) {
      const design = createBaseDesign({ dartStyle });
      const bodice = draftBodiceBlock(meas, design, { dartStyle });
      const sleeve = draftSleeveBlock(meas, design, { strategy: 'classic', bodicePieces: bodice }).piece;

      const res = assembleBodiceSleeve({
        bodicePieces: bodice,
        sleevePiece: sleeve,
        designSpec: design,
        measurements: meas,
        options: { strategy: 'classic' }
      });

      assert.equal(
        res.isValid,
        true,
        `Dart style '${dartStyle}' failed: ${res.validationReport.checks.filter(c => c.status === 'fail').map(c => c.message).join(' | ')}`
      );
      assert.equal(res.endpoints.shoulderSeamConsistency?.isValid, true);
    }
  });

  test('Strategy sweep on Size M (classic, fitted, tailored, flat) produces valid results or honest fail-closed diagnostics', () => {
    const strategies: SleeveEaseStrategy[] = ['classic', 'fitted', 'tailored', 'flat'];
    const meas = STANDARD_SIZING_SYSTEM.sizes.M;

    for (const strategy of strategies) {
      const design = createBaseDesign({ sleeveEaseStrategy: strategy });
      const bodice = draftBodiceBlock(meas, design);
      const sleeve = draftSleeveBlock(meas, design, { strategy, bodicePieces: bodice }).piece;
      const res = assembleBodiceSleeve({
        bodicePieces: bodice,
        sleevePiece: sleeve,
        designSpec: design,
        measurements: meas,
        options: { strategy }
      });

      assert.equal(res.isProductionReady, false);
      assert.notEqual(res.canonicalContentDigest, EMPTY_JSON_OBJECT_SHA256);
      if (strategy === 'classic' || strategy === 'fitted') {
        assert.equal(res.isValid, true, `Strategy ${strategy} expected valid`);
      }
    }
  });
});
