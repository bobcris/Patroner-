/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONCEPTS } from '../../domain/design/curated-concepts';
import { draftBodiceBlock } from '../drafting/bodice-block';
import { draftSleeveBlock } from '../drafting/sleeve-block';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { DesignSpecification } from '../../types';
import {
  computePieceContourAreaCm2,
  computeProductionBom
} from './bom-engine';

const baseBodiceSpec: DesignSpecification =
  INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice') ?? {
    id: 'test-bodice-bom',
    name: 'Classic Bodice Block',
    prompt: 'Tailored bodice without zippers',
    garmentCategory: 'bodice',
    silhouette: 'tailored',
    fabric: {
      id: 'wool-crepe',
      name: 'Medium Weight Wool Crepe',
      composition: '100% Virgin Wool',
      weight: 'medium',
      stretch: 'none',
      recommendedEaseCm: { waist: 3.5, hip: 4.5, bust: 5.0 },
      drapeDescription: 'Structured fluid drape.'
    },
    color: { name: 'Raw Ecru', hex: '#EDE8DF' },
    easeProfile: 'classic',
    lengthCm: 42,
    sleeveEaseStrategy: 'classic',
    constructionFeatures: [],
    designNotes: [],
    isApproved: false,
    version: 1
  };

describe('M05 Workstream C: Deterministic Geometry-Driven BOM Engine', () => {
  it('computes main fabric, stay-tape, and thread directly from piece contours with onFold 2x unfolding and zero phantom fasteners', () => {
    const m = STANDARD_SIZING_SYSTEM.sizes.M;
    const bodice = draftBodiceBlock(m, { ...baseBodiceSpec, constructionFeatures: [] });
    const sleeve = draftSleeveBlock(m, baseBodiceSpec, { bodicePieces: bodice });
    const pieces = [...bodice, sleeve.piece];

    const frontArea = computePieceContourAreaCm2(bodice[0], 'cutting');
    assert.ok(frontArea > 200);
    assert.equal(bodice[0].onFold, true);

    const bom = computeProductionBom({
      designSpec: { ...baseBodiceSpec, constructionFeatures: [] },
      piecesBySize: { M: pieces },
      options: {
        fabricRollWidthCm: 140,
        selvedgeMarginCm: 1.5,
        markerWasteFactor: 0.18,
        threadWastageFactor: 0.15
      }
    });

    assert.equal(bom.isProductionReady, false);
    assert.equal(bom.usableFabricWidthCm, 137);
    assert.equal(bom.totalOrderGarments, 1);

    const mainFabric = bom.lineItems.find(i => i.category === 'main-fabric');
    const interfacing = bom.lineItems.find(i => i.category === 'interfacing');
    const thread = bom.lineItems.find(i => i.category === 'thread');
    const fasteners = bom.lineItems.filter(i => i.category === 'fasteners-hardware');

    assert.ok(mainFabric);
    assert.equal(mainFabric.basis, 'configured-allowance');
    assert.ok(mainFabric.totalQuantityPerGarment > mainFabric.calculatedBaseQuantityPerGarment);
    assert.ok(interfacing && interfacing.totalOrderQuantity > 0);
    assert.ok(thread && thread.totalOrderQuantity > 0);
    // Plain bodice with constructionFeatures: [] must NEVER invent phantom zippers or buttons
    assert.equal(fasteners.length, 0);
  });

  it('distinguishes calculated (0% buffer) vs configured-allowance, traces declared zippers/buttons, and scales multi-size orders', () => {
    const specWithClosure: DesignSpecification = {
      ...baseBodiceSpec,
      constructionFeatures: [
        {
          id: 'feat-cb-zip',
          category: 'closure',
          name: 'Concealed Center Back Zipper',
          description: '22 cm invisible coil zipper',
          patternImpact: 'Center back closure opening'
        },
        {
          id: 'feat-cuff-buttons',
          category: 'closure',
          name: 'Cuff Buttons',
          description: '4 concealed mother-of-pearl buttons',
          patternImpact: 'Wrist cuff buttonhole spacing'
        }
      ]
    };
    const mS = STANDARD_SIZING_SYSTEM.sizes.S;
    const mM = STANDARD_SIZING_SYSTEM.sizes.M;
    const piecesS = (() => {
      const b = draftBodiceBlock(mS, specWithClosure);
      const s = draftSleeveBlock(mS, specWithClosure, { bodicePieces: b });
      return [...b, s.piece];
    })();
    const piecesM = (() => {
      const b = draftBodiceBlock(mM, specWithClosure);
      const s = draftSleeveBlock(mM, specWithClosure, { bodicePieces: b });
      return [...b, s.piece];
    })();

    const zeroWasteBom = computeProductionBom({
      designSpec: specWithClosure,
      piecesBySize: { S: piecesS, M: piecesM },
      options: {
        fabricRollWidthCm: 140,
        markerWasteFactor: 0,
        includeLining: true,
        includeLabelsAndPackaging: true,
        orderQuantitiesBySize: { S: 10, M: 25 },
        supplierOverrides: {
          'bom-main-fabric': {
            supplierName: 'Lanificio Biella',
            skuCode: 'WC-140-ECRU',
            unitCostUsd: 28.5
          }
        }
      }
    });

    assert.equal(zeroWasteBom.orderQuantityBasis, 'declared-order-quantity');
    assert.equal(zeroWasteBom.totalOrderGarments, 35);

    const mainFabric = zeroWasteBom.lineItems.find(i => i.itemId === 'bom-main-fabric')!;
    assert.equal(mainFabric.basis, 'calculated');
    assert.equal(mainFabric.supplierData?.origin, 'user-entered');
    assert.equal(mainFabric.supplierData?.supplierName, 'Lanificio Biella');

    const lining = zeroWasteBom.lineItems.find(i => i.category === 'lining');
    assert.ok(lining && lining.basis === 'estimated');

    const zipItem = zeroWasteBom.lineItems.find(i => i.materialName.includes('22 cm'));
    assert.ok(zipItem && zipItem.totalOrderQuantity === 35);

    const btnItem = zeroWasteBom.lineItems.find(i => i.materialName.includes('Buttons'));
    assert.ok(btnItem && btnItem.totalOrderQuantity === 35 * 4);

    const pkgItem = zeroWasteBom.lineItems.find(i => i.category === 'labels-packaging');
    assert.ok(pkgItem && pkgItem.totalOrderQuantity === 35);

    // Narrower roll width must proportionally increase main fabric meters
    const narrowBoltBom = computeProductionBom({
      designSpec: specWithClosure,
      piecesBySize: { S: piecesS, M: piecesM },
      options: {
        fabricRollWidthCm: 112,
        markerWasteFactor: 0,
        orderQuantitiesBySize: { S: 10, M: 25 }
      }
    });
    assert.ok(narrowBoltBom.totalMainFabricMetersForOrder > zeroWasteBom.totalMainFabricMetersForOrder);
  });

  it('rejects invalid roll width, selvedge margins, or fractional order quantities fail-closed', () => {
    const skirt = draftSkirtBlock(STANDARD_SIZING_SYSTEM.sizes.M, {
      ...baseBodiceSpec,
      garmentCategory: 'skirt',
      silhouette: 'straight',
      lengthCm: 64
    });

    assert.throws(() =>
      computeProductionBom({
        designSpec: { ...baseBodiceSpec, garmentCategory: 'skirt' },
        piecesBySize: { M: skirt },
        options: { fabricRollWidthCm: -10 }
      })
    );

    assert.throws(() =>
      computeProductionBom({
        designSpec: { ...baseBodiceSpec, garmentCategory: 'skirt' },
        piecesBySize: { M: skirt },
        options: { fabricRollWidthCm: 100, selvedgeMarginCm: 50 }
      })
    );

    assert.throws(() =>
      computeProductionBom({
        designSpec: { ...baseBodiceSpec, garmentCategory: 'skirt' },
        piecesBySize: { M: skirt },
        options: { orderQuantitiesBySize: { M: 2.5 } }
      })
    );
  });
});
