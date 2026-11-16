/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { DesignSpecification, StandardSize } from '../../types';
import {
  auditProductionSeamParityFromPieces,
  exportPatternPiecesToDxfAama,
  parseDxfAama,
  REQUIRED_DXF_AAMA_LAYERS,
  verifyDxfAamaRoundTrip
} from './dxf-aama-exporter';

const bodiceDesign: DesignSpecification =
  INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice') ?? {
    id: 'test-bodice-dxf',
    name: 'Classic Bodice Block',
    prompt: 'Tailored bodice block',
    garmentCategory: 'bodice',
    silhouette: 'tailored',
    fabric: {
      id: 'wool-crepe',
      name: 'Wool Crepe',
      composition: '100% Wool',
      weight: 'medium',
      stretch: 'none',
      recommendedEaseCm: { waist: 3.5, hip: 4.5, bust: 5.0 },
      drapeDescription: 'Structured fluid drape.'
    },
    color: { name: 'Parchment', hex: '#F4F1EA' },
    easeProfile: 'classic',
    lengthCm: 42,
    sleeveEaseStrategy: 'classic',
    constructionFeatures: [],
    designNotes: [],
    isApproved: true,
    version: 1
  };

const skirtDesign: DesignSpecification =
  INITIAL_CONCEPTS.find(c => c.garmentCategory === 'skirt') ?? {
    ...bodiceDesign,
    id: 'test-skirt-dxf',
    name: 'Classic Straight Skirt Block',
    garmentCategory: 'skirt',
    silhouette: 'straight',
    lengthCm: 64
  };

describe('M00.7 & M00.8 Workstream B: Canonical Drafted Piece DXF-AAMA (AC1009) & Seam Parity', () => {
  it('exports drafted Bodice (Front, Back), Sleeve, and Skirt (Front, Back) across Layers 1,2,4,7,8,11 and passes round-trip <= 0.001 cm', () => {
    const sizes: StandardSize[] = ['XS', 'M', 'XL'];

    for (const size of sizes) {
      const m = STANDARD_SIZING_SYSTEM.sizes[size];
      const bodicePieces = draftBodiceBlock(m, bodiceDesign);
      const { piece: sleevePiece } = draftSleeveBlock(m, bodiceDesign, { bodicePieces });
      const skirtPieces = draftSkirtBlock(m, skirtDesign);
      const allPieces = [...bodicePieces, sleevePiece, ...skirtPieces];

      assert.strictEqual(allPieces.length, 5);

      const exported = exportPatternPiecesToDxfAama(allPieces, {
        exportId: `CANONICAL-BLOCK-${size}`
      });

      assert.strictEqual(exported.dxfVersion, 'AC1009');
      assert.strictEqual(exported.externalCadInteroperabilityVerified, false);
      assert.deepStrictEqual([...exported.emittedLayers].sort(), [...REQUIRED_DXF_AAMA_LAYERS].sort());

      const verification = verifyDxfAamaRoundTrip(exported, 0.001);
      assert.strictEqual(verification.allPassed, true);
      assert.strictEqual(verification.syntheticRoundTripVerified, true);
      assert.strictEqual(verification.externalCadInteroperabilityVerified, false);
      assert.strictEqual(verification.acadVersionHeader, 'AC1009');
      assert.strictEqual(verification.insUnitsHeader, '5');
      assert.deepStrictEqual(verification.missingTableLayers, []);
      assert.deepStrictEqual(verification.missingEntityLayers, []);
      assert.ok(verification.maxVertexRoundTripErrorCm <= 0.001);

      const parsed = parseDxfAama(exported.dxfText);
      assert.strictEqual(parsed.cutPolylines.length, 5);
      assert.strictEqual(parsed.sewPolylines.length, 5);
      assert.strictEqual(parsed.grainLines.length, 5);
      assert.ok(parsed.notchLines.length >= 10);
      assert.ok(parsed.drillPoints.length >= 5);
      assert.ok(parsed.internalPolylines.length >= 5);
    }
  });

  it('audits paired seam lengths & DEC-11 sleeve-armhole ease from actual drafted contours within <= 0.05 cm CAD tolerance', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodicePieces = draftBodiceBlock(m, bodiceDesign);
    const { piece: sleevePiece } = draftSleeveBlock(m, bodiceDesign, { bodicePieces });
    const skirtPieces = draftSkirtBlock(m, skirtDesign);

    const seamAudit = auditProductionSeamParityFromPieces(bodicePieces, sleevePiece, skirtPieces, bodiceDesign, m);
    assert.strictEqual(seamAudit.allPassed, true);
    assert.strictEqual(seamAudit.pairedSeamChecks.length, 4);

    for (const check of seamAudit.pairedSeamChecks) {
      assert.strictEqual(check.withinTier1CadTolerance0_05Cm, true, `${check.seamPair} exceeded 0.05 cm`);
      assert.ok(check.cadDeltaCm <= 0.05);
      assert.ok(check.edgeASegments.length >= 1);
      assert.ok(check.edgeBSegments.length >= 1);
    }

    assert.strictEqual(seamAudit.bodiceSleeveAssemblyEase.status, 'verified-valid');
    assert.strictEqual(seamAudit.bodiceSleeveAssemblyEase.isValid, true);
    assert.strictEqual(seamAudit.bodiceSleeveAssemblyEase.isTotalEasePermitted, true);
    assert.strictEqual(seamAudit.bodiceSleeveAssemblyEase.isDistributionBalanced, true);
    assert.strictEqual(seamAudit.bodiceSleeveAssemblyEase.isTargetCompliant, false);
    assert.ok(seamAudit.bodiceSleeveAssemblyEase.inseamParityDeltaCm <= 0.05);
  });
});
