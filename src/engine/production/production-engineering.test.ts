/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { EMPTY_JSON_OBJECT_SHA256 } from '../assembly/sha256';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { CubicBezierCurve, GeometricContour, LineSegment } from '../geometry/primitives';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { DesignSpecification, PatternPiece } from '../../types';
import {
  buildM05ProductionPackage,
  exportPatternPiecesToDxfAama,
  serializeDeterministicProductionBundle,
  verifyDxfAamaRoundTrip
} from './index';

const bodiceSpec: DesignSpecification = {
  ...(INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice') ?? INITIAL_CONCEPTS[0]),
  id: 'm05-bodice-test',
  garmentCategory: 'bodice',
  isApproved: true,
  version: 2,
  constructionFeatures: [
    {
      id: 'feat-side-zip',
      category: 'closure',
      name: 'Concealed Side Zipper',
      description: '20 cm invisible coil zipper',
      patternImpact: 'Left side seam zipper insertion'
    }
  ]
};

const skirtSpec: DesignSpecification = {
  ...(INITIAL_CONCEPTS.find(c => c.garmentCategory === 'skirt') ?? INITIAL_CONCEPTS[0]),
  id: 'm05-skirt-test',
  garmentCategory: 'skirt',
  silhouette: 'straight',
  lengthCm: 64,
  isApproved: true,
  version: 1
};

const FIXED_TIMESTAMP = '2026-11-18T12:00:00.000Z';

describe('M05 Production Engineering Package, 10-Gate Validation, DXF Features & SHA-256 Digest', () => {
  it('connects Bodice XS-XXL grading, M05.1/M05.2.1 sheets, BOM, docs, DXF, and deterministic SHA-256 while preserving isProductionReady=false', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const bundleA = buildM05ProductionPackage({
      designSpec: bodiceSpec,
      measurements: m,
      options: {
        createdAt: FIXED_TIMESTAMP,
        measurementProvenance: 'physically-measured',
        measurementApprovalState: 'approved',
        measurementProvenanceEvidence: {
          operatorName: 'Master Tailor Elena',
          measurementSource: 'caliper-tape-session-04',
          recordedAt: FIXED_TIMESTAMP
        },
        bomOptions: {
          fabricRollWidthCm: 140,
          markerWasteFactor: 0.18,
          orderQuantitiesBySize: { XS: 5, S: 10, M: 20, L: 15, XL: 8, XXL: 2 }
        }
      }
    });

    const bundleB = buildM05ProductionPackage({
      designSpec: bodiceSpec,
      measurements: m,
      options: {
        createdAt: FIXED_TIMESTAMP,
        measurementProvenance: 'physically-measured',
        measurementApprovalState: 'approved',
        measurementProvenanceEvidence: {
          operatorName: 'Master Tailor Elena',
          measurementSource: 'caliper-tape-session-04',
          recordedAt: FIXED_TIMESTAMP
        },
        bomOptions: {
          fabricRollWidthCm: 140,
          markerWasteFactor: 0.18,
          orderQuantitiesBySize: { XS: 5, S: 10, M: 20, L: 15, XL: 8, XXL: 2 }
        }
      }
    });

    // Strict industrial safety invariant
    assert.equal(bundleA.isProductionReady, false);
    assert.equal(bundleA.validation.isProductionReady, false);
    assert.equal(bundleA.bom.isProductionReady, false);
    assert.equal(bundleA.manufacturingDocs.isProductionReady, false);
    assert.equal(bundleA.dxfExport?.externalCadInteroperabilityVerified, false);

    // Multi-size coverage & M05.2.1 sheet reconciliation
    assert.deepEqual(bundleA.includedSizes, ['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    assert.equal(bundleA.perSizeSummaries.length, 6);
    assert.equal(bundleA.bom.totalOrderGarments, 60);
    assert.ok(bundleA.sheetSet && bundleA.sheetSet.totalSheetsCount === 18); // 3 pieces * 6 sizes

    // All 10 validation gates pass cleanly
    assert.equal(bundleA.validation.status, 'verified-for-2d-package');
    assert.equal(bundleA.validation.isValid, true);
    assert.equal(bundleA.validation.diagnostics.length, 10);
    assert.equal(bundleA.validation.passedCount, 10);

    // DXF round-trip full feature verification
    assert.ok(bundleA.dxfExport);
    assert.equal(bundleA.dxfExport.roundTrip.allPassed, true);
    assert.equal(bundleA.dxfExport.roundTrip.grainLinesRecovered, 3);
    assert.equal(bundleA.dxfExport.roundTrip.pieceLabelsRecovered, 3);
    assert.ok(bundleA.dxfExport.roundTrip.notchLinesRecovered >= 6);
    assert.ok(bundleA.dxfExport.roundTrip.drillPointsRecovered >= 2);
    assert.ok(bundleA.dxfExport.artifact.dxfText.includes(bundleA.patternRevision!.revisionId));

    // Canonical JSON & Node SHA-256 parity
    assert.equal(bundleA.canonicalContentDigest, bundleB.canonicalContentDigest);
    assert.notEqual(bundleA.canonicalContentDigest, EMPTY_JSON_OBJECT_SHA256);
    assert.equal(bundleA.canonicalContentDigest.length, 64);

    const canonicalJson = serializeDeterministicProductionBundle(bundleA);
    const nodeHash = createHash('sha256').update(Buffer.from(canonicalJson, 'utf-8')).digest('hex');
    assert.equal(bundleA.canonicalContentDigest, nodeHash);
  });

  it('operates honestly on Skirt without inventing multi-size grading unless requiredSizes demands it (fail-closed)', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const singleSkirt = buildM05ProductionPackage({
      designSpec: skirtSpec,
      measurements: m,
      options: { createdAt: FIXED_TIMESTAMP }
    });

    assert.deepEqual(singleSkirt.includedSizes, ['M']);
    assert.equal(singleSkirt.gradedPatternSet, null);
    assert.equal(singleSkirt.validation.isValid, true); // Only governance warning on unverified chart
    assert.ok(
      singleSkirt.validation.diagnostics.some(
        d => d.checkId === 'unresolved-measurement-approvals' && d.status === 'warning'
      )
    );

    // Forcing XS-XXL on Skirt without a skirt grader must fail-closed on Gate 6
    const blockedSkirt = buildM05ProductionPackage({
      designSpec: skirtSpec,
      measurements: m,
      options: {
        createdAt: FIXED_TIMESTAMP,
        requiredSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
      }
    });
    assert.equal(blockedSkirt.validation.isValid, false);
    assert.equal(blockedSkirt.validation.status, 'blocked');
    assert.ok(
      blockedSkirt.validation.diagnostics.some(
        d => d.checkId === 'invalid-size-coverage' && d.status === 'fail'
      )
    );
  });

  it('detects stale upstream changes across specification, measurements, geometry, and invalidates package', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const initial = buildM05ProductionPackage({
      designSpec: bodiceSpec,
      measurements: m,
      options: { createdAt: FIXED_TIMESTAMP }
    });

    const modifiedSpec: DesignSpecification = {
      ...bodiceSpec,
      lengthCm: bodiceSpec.lengthCm + 2.5
    };
    const stale = buildM05ProductionPackage({
      designSpec: modifiedSpec,
      measurements: m,
      options: {
        createdAt: FIXED_TIMESTAMP,
        previousPackageRevision: {
          sourceSpecificationFingerprint: initial.upstreamRevisionTracking.sourceSpecificationFingerprint,
          sourceMeasurementFingerprint: initial.upstreamRevisionTracking.sourceMeasurementFingerprint,
          basePatternFingerprint: initial.upstreamRevisionTracking.basePatternFingerprint ?? undefined,
          gradingReportSha256Hex: initial.upstreamRevisionTracking.gradingReportSha256Hex ?? undefined
        }
      }
    });

    assert.equal(stale.upstreamRevisionTracking.isStaleAgainstPrevious, true);
    assert.ok(stale.upstreamRevisionTracking.staleReasons.length >= 2);
    assert.equal(stale.validation.isValid, false);
    assert.ok(
      stale.validation.diagnostics.some(
        d => d.checkId === 'invalid-or-stale-revision' && d.status === 'fail'
      )
    );
  });

  it('blocks all critical geometry/metadata/allowance/grainline defects fail-closed across the 10 validation gates', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const baseBodice = draftBodiceBlock(m, bodiceSpec);
    const { piece: sleeve } = draftSleeveBlock(m, bodiceSpec, { bodicePieces: baseBodice });

    // 1. Missing grainline + empty seam allowance + duplicate pieceCode
    const defectivePieces: PatternPiece[] = [
      {
        ...baseBodice[0],
        grainline: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, direction: 'vertical' }
      },
      {
        ...baseBodice[1],
        pieceCode: baseBodice[0].pieceCode // duplicate code!
      },
      {
        ...sleeve,
        stitchingContour: sleeve.stitchingContour
          ? new GeometricContour(
              sleeve.stitchingContour.id,
              sleeve.stitchingContour.segments.map((seg, i) => {
                if (i !== 0) return seg;
                if (seg.type === 'line') {
                  return new LineSegment(seg.id, seg.start, seg.end, 0, false, seg.seamId, seg.sourceSegmentId, seg.role);
                }
                const bz = seg as CubicBezierCurve;
                return new CubicBezierCurve(bz.id, bz.p0, bz.cp1, bz.cp2, bz.p3, 0, false, bz.seamId, bz.sourceSegmentId, bz.role);
              }),
              true
            )
          : undefined
      }
    ];

    const brokenBundle = buildM05ProductionPackage({
      designSpec: bodiceSpec,
      measurements: m,
      piecesOverride: defectivePieces,
      options: { createdAt: FIXED_TIMESTAMP }
    });

    assert.equal(brokenBundle.validation.isValid, false);
    const gate = (id: string) => brokenBundle.validation.diagnostics.find(d => d.checkId === id)!;
    assert.equal(gate('missing-grainlines').status, 'fail');
    assert.equal(gate('inconsistent-piece-metadata').status, 'fail');
    assert.equal(gate('incomplete-seam-allowances').status, 'fail');

    // 2. Missing pattern pieces -> missing-pattern-pieces fails
    const emptyBundle = buildM05ProductionPackage({
      designSpec: bodiceSpec,
      measurements: m,
      piecesOverride: [],
      options: { createdAt: FIXED_TIMESTAMP }
    });
    assert.equal(emptyBundle.validation.isValid, false);
    assert.equal(
      emptyBundle.validation.diagnostics.find(d => d.checkId === 'missing-pattern-pieces')?.status,
      'fail'
    );
  });

  it('catches dropped grainline, dropped notch, or missing piece TEXT label in enhanced DXF-AAMA round-trip verification', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(m, bodiceSpec);
    const { piece: sleeve } = draftSleeveBlock(m, bodiceSpec, { bodicePieces: bodice });
    const exported = exportPatternPiecesToDxfAama([...bodice, sleeve], {
      exportId: 'TAMPER-TEST',
      sourceRevisionId: 'rev-1',
      sizeCode: 'M'
    });

    assert.equal(verifyDxfAamaRoundTrip(exported, 0.001).allPassed, true);

    // Strip a notch entity (Layer 4 LINE) from dxfText -> must fail!
    const strippedNotchText = exported.dxfText.replace(/\n0\nLINE\n8\n4\n10\n[^\n]+\n20\n[^\n]+\n11\n[^\n]+\n21\n[^\n]+/, '');
    const tamperedNotch = {
      ...exported,
      dxfText: strippedNotchText
    };
    const notchRes = verifyDxfAamaRoundTrip(tamperedNotch, 0.001);
    assert.equal(notchRes.allPassed, false);
    assert.ok(notchRes.notchLinesRecovered < notchRes.notchLinesExpected);

    // Strip piece code TEXT label -> must fail!
    const strippedText = exported.dxfText.replace(`${bodice[0].pieceCode} CUT`, 'ANON CUT');
    const tamperedLabel = {
      ...exported,
      dxfText: strippedText
    };
    const labelRes = verifyDxfAamaRoundTrip(tamperedLabel, 0.001);
    assert.equal(labelRes.allPassed, false);
    assert.ok(labelRes.pieceLabelsRecovered < labelRes.pieceLabelsExpected);
  });
});
