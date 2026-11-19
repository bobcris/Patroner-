/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { assembleBodiceSleeve } from '../assembly/bodice-sleeve-assembly';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { DesignSpecification } from '../../types';
import {
  generateManufacturingDocumentation,
  verifyManufacturingDocumentationCompleteness
} from './manufacturing-docs';

const bodiceSpec: DesignSpecification = {
  ...(INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice') ?? INITIAL_CONCEPTS[0]),
  garmentCategory: 'bodice',
  constructionFeatures: []
};

const skirtSpec: DesignSpecification = {
  ...(INITIAL_CONCEPTS.find(c => c.garmentCategory === 'skirt') ?? INITIAL_CONCEPTS[0]),
  garmentCategory: 'skirt',
  silhouette: 'straight',
  lengthCm: 64
};

describe('M05 Workstream B: Feature-Traced Manufacturing Documentation Engine', () => {
  it('traces Bodice + Sleeve cutting, sewing ISO 4915, ease, and notch alignment strictly to drafted geometry without phantom zippers', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(m, bodiceSpec);
    const sleeve = draftSleeveBlock(m, bodiceSpec, { bodicePieces: bodice });
    const pieces = [...bodice, sleeve.piece];

    const assembly = assembleBodiceSleeve({
      bodicePieces: bodice,
      sleevePiece: sleeve.piece,
      designSpec: bodiceSpec,
      measurements: m,
      options: { strategy: 'classic' }
    });

    const docs = generateManufacturingDocumentation({
      designSpec: bodiceSpec,
      pieces,
      assemblyResult: assembly
    });

    assert.equal(docs.isProductionReady, false);
    assert.equal(docs.completeness.isComplete, true);
    assert.equal(docs.completeness.untracedOperationCount, 0);
    assert.equal(docs.cuttingInstructions.length, 3);
    assert.ok(docs.sewingSequence.some(s => s.title.includes('Set-In Sleeve Cap Easing')));
    // Plain bodice with constructionFeatures: [] must not include phantom zipper step
    assert.equal(
      docs.sewingSequence.some(s => s.title.toLowerCase().includes('zipper')),
      false
    );

    const sleeveStep = docs.sewingSequence.find(s => s.title.includes('Set-In Sleeve Cap Easing'))!;
    assert.equal(sleeveStep.targetEaseCm, Number(assembly.ease.totalEaseCm.toFixed(2)));

    const totalNotches = pieces.reduce((acc, p) => acc + p.notches.length, 0);
    assert.equal(docs.notchAlignmentInstructions.length, totalNotches);
  });

  it('switches stitch class to ISO 401 on stretch fabrics and excludes bodice/sleeve operations from Skirt docs', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const stretchSkirtSpec: DesignSpecification = {
      ...skirtSpec,
      fabric: {
        ...skirtSpec.fabric,
        stretch: 'low-stretch'
      }
    };
    const skirtPieces = draftSkirtBlock(m, stretchSkirtSpec);
    const docs = generateManufacturingDocumentation({
      designSpec: stretchSkirtSpec,
      pieces: skirtPieces
    });

    assert.equal(docs.completeness.isComplete, true);
    assert.ok(docs.operatorSummary.seamSummaryLine.includes('401'));
    assert.equal(
      docs.sewingSequence.some(s => s.title.toLowerCase().includes('sleeve') || s.title.toLowerCase().includes('shoulder')),
      false
    );
    assert.ok(docs.sewingSequence.some(s => s.title.includes('Center Back Seam')));
  });

  it('detects untraced operations or missing documentation sections in completeness check', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const skirtPieces = draftSkirtBlock(m, skirtSpec);
    const docs = generateManufacturingDocumentation({
      designSpec: skirtSpec,
      pieces: skirtPieces
    });

    const tampered = {
      ...docs,
      sewingSequence: [
        ...docs.sewingSequence,
        {
          operationCode: 'OP-99',
          sequenceOrder: 99,
          title: 'Phantom Unbacked Hardware Step',
          instruction: 'Attach nonexistent piece',
          stitchClassIso4915: '301',
          seamAllowanceCm: 1.0,
          traceablePieceIds: ['nonexistent-piece-id'],
          traceableFeatureIds: ['phantom']
        }
      ],
      qualityCheckpoints: []
    };

    const result = verifyManufacturingDocumentationCompleteness(tampered, skirtPieces);
    assert.equal(result.isComplete, false);
    assert.equal(result.untracedOperationCount, 1);
    assert.ok(result.missingSections.includes('qualityCheckpoints'));
  });
});
