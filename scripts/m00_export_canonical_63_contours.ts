/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PKG-M00-04 / I-04 (ADR-009 §7.2):
 * Deterministically exports a corpus of 63 canonical garment contours drafted from real Patroner
 * drafting blocks (Bodice Front, Bodice Back, Sleeve, Skirt Front, Skirt Back) across all 6
 * standard sizes (XS, S, M, L, XL, XXL) and real style/ease variants.
 *
 * Trouser block (`src/engine/drafting/trouser-block.ts`) is explicitly disclosed as absent
 * (`BLOCKED_MISSING_TROUSER_BLOCK`); zero synthetic/fabricated trouser geometry is emitted.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { INITIAL_CONCEPTS } from '../src/domain/design/curated-concepts';
import { draftBodiceBlock } from '../src/engine/drafting/bodice-block';
import { draftSkirtBlock } from '../src/engine/drafting/skirt-block';
import { draftSleeveBlock } from '../src/engine/drafting/sleeve-block';
import { CubicBezierCurve, LineSegment } from '../src/engine/geometry/primitives';
import { STANDARD_SIZING_SYSTEM } from '../src/engine/measurements/standards';
import {
  BodiceDartStyle,
  DesignSpecification,
  EaseProfile,
  PatternPiece,
  SleeveEaseStrategy,
  StandardSize
} from '../src/types';

interface SerializedSegment {
  id: string;
  type: 'line' | 'bezier';
  seamId: string | null;
  seamAllowanceCm: number;
  p0: [number, number];
  cp1?: [number, number];
  cp2?: [number, number];
  p3: [number, number];
}

interface CanonicalContourEntry {
  contourId: string;
  sourceModule: string;
  garmentCategory: string;
  pieceCode: string;
  pieceName: string;
  size: StandardSize;
  variant: string;
  segmentCount: number;
  cubicBezierCount: number;
  lineSegmentCount: number;
  segments: SerializedSegment[];
  contourInputSha256: string;
}

const baseBodiceDesign: DesignSpecification =
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

const baseSkirtDesign: DesignSpecification =
  INITIAL_CONCEPTS.find(c => c.garmentCategory === 'skirt') ?? {
    ...baseBodiceDesign,
    id: 'canon-skirt-block',
    name: 'Classic Straight Skirt Block',
    garmentCategory: 'skirt',
    silhouette: 'straight',
    lengthCm: 64
  };

function sha256Canonical(obj: unknown): string {
  const canonicalJson = JSON.stringify(obj);
  return crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

function serializePieceContour(
  contourId: string,
  sourceModule: string,
  size: StandardSize,
  variant: string,
  piece: PatternPiece
): CanonicalContourEntry {
  const rawSegments = piece.stitchingContour?.segments ?? [];
  const segments: SerializedSegment[] = rawSegments.map(seg => {
    if (seg instanceof CubicBezierCurve || (seg as { type?: string }).type === 'bezier') {
      const b = seg as CubicBezierCurve;
      return {
        id: b.id,
        type: 'bezier',
        seamId: b.seamId ?? null,
        seamAllowanceCm: b.seamAllowanceCm,
        p0: [b.p0.x, b.p0.y],
        cp1: [b.cp1.x, b.cp1.y],
        cp2: [b.cp2.x, b.cp2.y],
        p3: [b.p3.x, b.p3.y]
      };
    }
    const ln = seg as LineSegment;
    return {
      id: ln.id,
      type: 'line',
      seamId: ln.seamId ?? null,
      seamAllowanceCm: ln.seamAllowanceCm,
      p0: [ln.start.x, ln.start.y],
      p3: [ln.end.x, ln.end.y]
    };
  });

  const cubicBezierCount = segments.filter(s => s.type === 'bezier').length;
  const lineSegmentCount = segments.filter(s => s.type === 'line').length;
  const digestInput = {
    contourId,
    sourceModule,
    pieceCode: piece.pieceCode,
    size,
    variant,
    segments
  };

  return {
    contourId,
    sourceModule,
    garmentCategory: piece.garmentCategory,
    pieceCode: piece.pieceCode,
    pieceName: piece.name,
    size,
    variant,
    segmentCount: segments.length,
    cubicBezierCount,
    lineSegmentCount,
    segments,
    contourInputSha256: sha256Canonical(digestInput)
  };
}

const ALL_SIZES: StandardSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const contours: CanonicalContourEntry[] = [];

// 1. Bodice Front: 3 real dart styles ('waist', 'side-bust', 'french') x 6 sizes = 18 contours
const BODICE_FRONT_DARTS: BodiceDartStyle[] = ['waist', 'side-bust', 'french'];
for (const dartStyle of BODICE_FRONT_DARTS) {
  for (const size of ALL_SIZES) {
    const m = STANDARD_SIZING_SYSTEM.sizes[size];
    const design: DesignSpecification = { ...baseBodiceDesign, dartStyle };
    const pieces = draftBodiceBlock(m, design, { dartStyle });
    const frontPiece = pieces.find(p => p.pieceCode === 'BOD-F-01') ?? pieces[0];
    contours.push(
      serializePieceContour(
        `BOD-F-${dartStyle.toUpperCase()}-${size}`,
        'src/engine/drafting/bodice-block.ts',
        size,
        `dartStyle=${dartStyle},ease=classic`,
        frontPiece
      )
    );
  }
}

// 2. Bodice Back: 2 real ease profiles ('classic', 'fitted') x 6 sizes = 12 contours
const BODICE_BACK_EASES: EaseProfile[] = ['classic', 'fitted'];
for (const easeProfile of BODICE_BACK_EASES) {
  for (const size of ALL_SIZES) {
    const m = STANDARD_SIZING_SYSTEM.sizes[size];
    const design: DesignSpecification = { ...baseBodiceDesign, easeProfile };
    const pieces = draftBodiceBlock(m, design);
    const backPiece = pieces.find(p => p.pieceCode === 'BOD-B-01') ?? pieces[1];
    contours.push(
      serializePieceContour(
        `BOD-B-${easeProfile.toUpperCase()}-${size}`,
        'src/engine/drafting/bodice-block.ts',
        size,
        `ease=${easeProfile}`,
        backPiece
      )
    );
  }
}

// 3. Sleeve: 3 real sleeve ease strategies ('classic', 'tailored', 'fitted') x 6 sizes = 18 contours
const SLEEVE_STRATEGIES: SleeveEaseStrategy[] = ['classic', 'tailored', 'fitted'];
for (const strategy of SLEEVE_STRATEGIES) {
  for (const size of ALL_SIZES) {
    const m = STANDARD_SIZING_SYSTEM.sizes[size];
    const design: DesignSpecification = { ...baseBodiceDesign, sleeveEaseStrategy: strategy };
    const bodicePieces = draftBodiceBlock(m, design);
    const { piece: sleevePiece } = draftSleeveBlock(m, design, { bodicePieces });
    contours.push(
      serializePieceContour(
        `SLV-${strategy.toUpperCase()}-${size}`,
        'src/engine/drafting/sleeve-block.ts',
        size,
        `sleeveEaseStrategy=${strategy}`,
        sleevePiece
      )
    );
  }
}

// 4. Skirt Front: 'classic' x 6 sizes + 'fitted' x 3 sizes (XS, M, XL) = 9 contours
for (const size of ALL_SIZES) {
  const m = STANDARD_SIZING_SYSTEM.sizes[size];
  const design: DesignSpecification = { ...baseSkirtDesign, easeProfile: 'classic' };
  const pieces = draftSkirtBlock(m, design);
  const skirtFront = pieces.find(p => p.pieceCode === 'SK-01-F') ?? pieces[0];
  contours.push(
    serializePieceContour(
      `SK-F-CLASSIC-${size}`,
      'src/engine/drafting/skirt-block.ts',
      size,
      'ease=classic',
      skirtFront
    )
  );
}
for (const size of ['XS', 'M', 'XL'] as StandardSize[]) {
  const m = STANDARD_SIZING_SYSTEM.sizes[size];
  const design: DesignSpecification = { ...baseSkirtDesign, easeProfile: 'fitted' };
  const pieces = draftSkirtBlock(m, design);
  const skirtFront = pieces.find(p => p.pieceCode === 'SK-01-F') ?? pieces[0];
  contours.push(
    serializePieceContour(
      `SK-F-FITTED-${size}`,
      'src/engine/drafting/skirt-block.ts',
      size,
      'ease=fitted',
      skirtFront
    )
  );
}

// 5. Skirt Back: 'classic' x 6 sizes = 6 contours
for (const size of ALL_SIZES) {
  const m = STANDARD_SIZING_SYSTEM.sizes[size];
  const design: DesignSpecification = { ...baseSkirtDesign, easeProfile: 'classic' };
  const pieces = draftSkirtBlock(m, design);
  const skirtBack = pieces.find(p => p.pieceCode === 'SK-02-B') ?? pieces[1];
  contours.push(
    serializePieceContour(
      `SK-B-CLASSIC-${size}`,
      'src/engine/drafting/skirt-block.ts',
      size,
      'ease=classic',
      skirtBack
    )
  );
}

if (contours.length !== 63) {
  throw new Error(`Expected exactly 63 canonical garment contours, got ${contours.length}`);
}

const corpusBody = {
  artifactName: 'CanonicalGarmentContours63.json',
  governingADR: 'ADR-009 (R2.1.2-R1 §7.2)',
  packageId: 'PKG-M00-04',
  contourCount: contours.length,
  totalSegments: contours.reduce((acc, c) => acc + c.segmentCount, 0),
  totalCubicBeziers: contours.reduce((acc, c) => acc + c.cubicBezierCount, 0),
  totalLineSegments: contours.reduce((acc, c) => acc + c.lineSegmentCount, 0),
  compositionBreakdown: {
    bodiceFront: 18,
    bodiceBack: 12,
    sleeve: 18,
    skirtFront: 9,
    skirtBack: 6
  },
  draftedModulesUsed: [
    'src/engine/drafting/bodice-block.ts',
    'src/engine/drafting/sleeve-block.ts',
    'src/engine/drafting/skirt-block.ts'
  ],
  missingBlocksDisclosure: [
    {
      module: 'src/engine/drafting/trouser-block.ts',
      status: 'BLOCKED_MISSING_TROUSER_BLOCK',
      note: 'Trouser block module is not implemented in the current repository; zero synthetic trouser contours were fabricated.'
    }
  ],
  contours
};

const finalPayload = {
  ...corpusBody,
  corpusSha256: sha256Canonical(contours)
};

const outFlagIdx = process.argv.indexOf('--out');
if (outFlagIdx !== -1 && process.argv[outFlagIdx + 1]) {
  const outPath = path.resolve(process.argv[outFlagIdx + 1]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(finalPayload, null, 2) + '\n', 'utf8');
} else if (process.argv.includes('--stdout')) {
  process.stdout.write(JSON.stringify(finalPayload));
} else {
  const defaultOut = path.resolve(process.cwd(), 'artifacts/m00/CanonicalGarmentContours63.json');
  fs.mkdirSync(path.dirname(defaultOut), { recursive: true });
  fs.writeFileSync(defaultOut, JSON.stringify(finalPayload, null, 2) + '\n', 'utf8');
}
