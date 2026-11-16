/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Exports real drafted PatternPieces (Bodice Front/Back, Sleeve, Skirt Front/Back)
 * to DXF-AAMA (AC1009) and emits canonical segment control points for independent Python verification.
 */

import { INITIAL_CONCEPTS } from '../src/domain/design/curated-concepts';
import { draftBodiceBlock } from '../src/engine/drafting/bodice-block';
import { draftSkirtBlock } from '../src/engine/drafting/skirt-block';
import { draftSleeveBlock } from '../src/engine/drafting/sleeve-block';
import { STANDARD_SIZING_SYSTEM } from '../src/engine/measurements/standards';
import {
  auditProductionSeamParityFromPieces,
  exportPatternPiecesToDxfAama,
  verifyDxfAamaRoundTrip
} from '../src/engine/production/dxf-aama-exporter';
import { DesignSpecification, StandardSize } from '../src/types';

const bodiceDesign: DesignSpecification =
  INITIAL_CONCEPTS.find(c => c.garmentCategory === 'bodice') ?? {
    id: 'canon-bodice-block',
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
    id: 'canon-skirt-block',
    name: 'Classic Straight Skirt Block',
    garmentCategory: 'skirt',
    silhouette: 'straight',
    lengthCm: 64
  };

const SIZES: StandardSize[] = ['XS', 'M', 'XL'];

const sizeBundles = SIZES.map(size => {
  const m = STANDARD_SIZING_SYSTEM.sizes[size];
  const bodicePieces = draftBodiceBlock(m, bodiceDesign);
  const { piece: sleevePiece, diagnostics: sleeveDiagnostics } = draftSleeveBlock(m, bodiceDesign, {
    bodicePieces
  });
  const skirtPieces = draftSkirtBlock(m, skirtDesign);

  const allPieces = [...bodicePieces, sleevePiece, ...skirtPieces];
  const combinedDxf = exportPatternPiecesToDxfAama(allPieces, {
    exportId: `PATRONER-CANONICAL-${size}`
  });
  const combinedTsRoundTrip = verifyDxfAamaRoundTrip(combinedDxf, 0.001);

  const individualPieceDxfs = allPieces.map(piece => {
    const single = exportPatternPiecesToDxfAama([piece], {
      exportId: `PATRONER-${size}-${piece.pieceCode}`
    });
    return {
      pieceId: piece.id,
      pieceCode: piece.pieceCode,
      name: piece.name,
      garmentCategory: piece.garmentCategory,
      export: single,
      tsRoundTrip: verifyDxfAamaRoundTrip(single, 0.001)
    };
  });

  const seamAudit = auditProductionSeamParityFromPieces(bodicePieces, sleevePiece, skirtPieces, bodiceDesign, m);

  return {
    sizeLabel: size,
    bodyMeasurements: m,
    combinedDxf,
    combinedTsRoundTrip,
    individualPieceDxfs,
    sleeveDiagnostics,
    seamAudit
  };
});

const payload = {
  packageId: 'PKG-DXF-SEAM-WORKSTREAM-B',
  draftedModulesUsed: [
    'src/engine/drafting/bodice-block.ts',
    'src/engine/drafting/sleeve-block.ts',
    'src/engine/drafting/skirt-block.ts',
    'src/engine/assembly/bodice-sleeve-assembly.ts',
    'src/engine/production/dxf-aama-exporter.ts'
  ],
  missingDependencies: [
    {
      dependency: 'src/engine/drafting/trouser-block.ts',
      impact: 'Vertical Slice 1 requires Bodice, Skirt, Sleeve, and Trouser canonical blocks; Trouser drafting module is absent.',
      status: 'BLOCKED_MISSING_TROUSER_BLOCK'
    }
  ],
  sizesExported: SIZES,
  sizeBundles
};

process.stdout.write(JSON.stringify(payload));
