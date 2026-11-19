/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical DXF-AAMA (R12 / AC1009 / ASTM D6673) Pattern Exporter, Parser,
 * and Production Seam Parity Auditor for Drafted PatternPiece Contours.
 */

import { BodyMeasurements, DesignSpecification, PatternPiece, Point } from '../../types';
import { assembleBodiceSleeve } from '../assembly/bodice-sleeve-assembly';
import { GeometricContour, CubicBezierCurve } from '../geometry/primitives';
import { sha256Hex } from './crypto';

export const REQUIRED_DXF_AAMA_LAYERS = ['1', '2', '4', '7', '8', '11'] as const;
export const DEC11_TIER1_CAD_TOLERANCE_CM = 0.05;
export const DEC11_TIER2_PHYSICAL_TOLERANCE_CM = 0.2;
export const DXF_ROUND_TRIP_MAX_ERROR_CM = 0.001;

export interface DxfExportPieceGeometry {
  pieceId: string;
  pieceCode: string;
  name: string;
  garmentCategory: string;
  offsetXCm: number;
  cutCount: number;
  onFold: boolean;
  expectedCutVerticesCm: Point[];
  expectedSewVerticesCm: Point[];
  expectedGrainline: { start: Point; end: Point };
  expectedNotchSegments: Array<{ start: Point; end: Point; type: string; label?: string }>;
  expectedDrillPoints: Point[];
  expectedInternalPolylines: Point[][];
}

export interface DxfAamaExportArtifact {
  exportId: string;
  standard: 'DXF-AAMA / ASTM D6673';
  dxfVersion: 'AC1009';
  geometryUnit: 'cm';
  insUnitsCode: 5;
  sourceRevisionId?: string;
  sourceContentFingerprint?: string;
  sizeCode?: string;
  requiredLayers: string[];
  emittedLayers: string[];
  pieceCodes: string[];
  pieces: DxfExportPieceGeometry[];
  totalCutVertices: number;
  totalSewVertices: number;
  sha256Digest: string;
  dxfText: string;
  externalCadInteroperabilityVerified: false;
  interoperabilityNote: string;
}

export interface ParsedDxfAamaResult {
  sectionsRecovered: string[];
  acadVersionHeader: string;
  insUnitsHeader: string;
  tableLayersDefined: string[];
  entityLayersFound: string[];
  cutPolylines: Point[][];
  cutPolylineClosedFlags: boolean[];
  sewPolylines: Point[][];
  sewPolylineClosedFlags: boolean[];
  internalPolylines: Point[][];
  grainLines: Array<{ start: Point; end: Point }>;
  notchLines: Array<{ start: Point; end: Point }>;
  drillPoints: Point[];
  texts: Array<{ position: Point; value: string }>;
  sha256Digest: string;
}

export interface DxfRoundTripVerificationResult {
  exportId: string;
  pieceCodes: string[];
  sectionsRecovered: string[];
  acadVersionHeader: string;
  insUnitsHeader: string;
  missingTableLayers: string[];
  missingEntityLayers: string[];
  cutVertexCountExpected: number;
  cutVertexCountRecovered: number;
  sewVertexCountExpected: number;
  sewVertexCountRecovered: number;
  grainLinesExpected: number;
  grainLinesRecovered: number;
  notchLinesExpected: number;
  notchLinesRecovered: number;
  drillPointsExpected: number;
  drillPointsRecovered: number;
  internalPolylinesExpected: number;
  internalPolylinesRecovered: number;
  pieceLabelsExpected: number;
  pieceLabelsRecovered: number;
  allCutSewPolylinesClosed: boolean;
  maxVertexRoundTripErrorCm: number;
  maxFeatureRoundTripErrorCm: number;
  toleranceMaxCm: number;
  sha256DigestMatches: boolean;
  syntheticRoundTripVerified: boolean;
  externalCadInteroperabilityVerified: false;
  allPassed: boolean;
  failures: string[];
}

export interface SerializedCurveSegmentSpec {
  id: string;
  type: 'line' | 'bezier';
  p0: Point;
  cp1?: Point;
  cp2?: Point;
  p3: Point;
  lengthCm: number;
}

export interface DraftedPairedSeamCheck {
  seamPair: string;
  pieceAId: string;
  pieceBId: string;
  seamAId: string;
  seamBId: string;
  edgeALengthCm: number;
  edgeBLengthCm: number;
  edgeASegments: SerializedCurveSegmentSpec[];
  edgeBSegments: SerializedCurveSegmentSpec[];
  targetEaseCm: number;
  cadDeltaCm: number;
  withinTier1CadTolerance0_05Cm: boolean;
}

function roundCoord(v: number): number {
  return Number(v.toFixed(6));
}

function translatePoint(p: Point, dx: number, dy: number): Point {
  return { x: roundCoord(p.x + dx), y: roundCoord(p.y + dy) };
}

/**
 * Flattens a GeometricContour into closed boundary polyline vertices in cm.
 * Line segments emit start points; CubicBezierCurves are adaptively subdivided
 * within flatnessToleranceCm (default 0.005 cm) with duplicate suppression.
 */
export function contourToPolylineCm(
  contour: GeometricContour | undefined,
  flatnessToleranceCm = 0.005,
  offsetX = 0,
  offsetY = 0
): Point[] {
  if (!contour || contour.segments.length === 0) {
    return [];
  }
  const rawPts: Point[] = [];
  for (const seg of contour.segments) {
    if (seg.type === 'line') {
      rawPts.push(translatePoint(seg.start, offsetX, offsetY));
    } else {
      const flattened = (seg as CubicBezierCurve).flatten(flatnessToleranceCm, 8);
      for (let i = 0; i < flattened.length - 1; i++) {
        rawPts.push(translatePoint(flattened[i], offsetX, offsetY));
      }
    }
  }

  const deduped: Point[] = [];
  for (const pt of rawPts) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 1e-6) {
      deduped.push(pt);
    }
  }
  if (
    deduped.length > 1 &&
    Math.hypot(deduped[0].x - deduped[deduped.length - 1].x, deduped[0].y - deduped[deduped.length - 1].y) <= 1e-6
  ) {
    deduped.pop();
  }
  return deduped;
}

/**
 * Exports one or more drafted PatternPiece objects to real DXF R12 (AC1009) / AAMA / ASTM D6673.
 * Places multiple pieces horizontally along +X with non-overlapping spacing.
 */
export function exportPatternPiecesToDxfAama(
  pieces: PatternPiece[],
  options: {
    exportId?: string;
    flatnessToleranceCm?: number;
    pieceGapCm?: number;
    sourceRevisionId?: string;
    sourceContentFingerprint?: string;
    sizeCode?: string;
  } = {}
): DxfAamaExportArtifact {
  if (pieces.length === 0) {
    throw new Error('Cannot export DXF-AAMA with zero pattern pieces.');
  }

  const flatnessToleranceCm = options.flatnessToleranceCm ?? 0.005;
  const pieceGapCm = options.pieceGapCm ?? 8.0;
  const exportId = options.exportId ?? `DXF-AAMA-${pieces.map(p => p.pieceCode).join('-')}`;

  const pieceGeoms: DxfExportPieceGeometry[] = [];
  let cursorX = 0;

  for (const piece of pieces) {
    if (!piece.cuttingContour || !piece.stitchingContour) {
      throw new Error(`PatternPiece "${piece.pieceCode}" is missing required cuttingContour or stitchingContour.`);
    }

    const bbox = piece.boundingBox;
    const offsetX = pieces.length === 1 ? 0 : roundCoord(cursorX - bbox.minX);
    const offsetY = 0;

    const cutPts = contourToPolylineCm(piece.cuttingContour, flatnessToleranceCm, offsetX, offsetY);
    const sewPts = contourToPolylineCm(piece.stitchingContour, flatnessToleranceCm, offsetX, offsetY);

    const grainline = {
      start: translatePoint(piece.grainline.start, offsetX, offsetY),
      end: translatePoint(piece.grainline.end, offsetX, offsetY)
    };

    const notchSegments: Array<{ start: Point; end: Point; type: string; label?: string }> = [];
    for (const notch of piece.notches) {
      const rad = (notch.normalAngleDeg * Math.PI) / 180;
      const dx = Math.cos(rad) * 0.5;
      const dy = Math.sin(rad) * 0.5;
      const pStart = translatePoint(notch.position, offsetX, offsetY);
      const pEnd = { x: roundCoord(pStart.x + dx), y: roundCoord(pStart.y + dy) };
      notchSegments.push({ start: pStart, end: pEnd, type: notch.type, label: notch.label });
    }

    // Layer 2 Drill Holes: piece.drillHoles + dart apexes + fallback crown/center reference mark
    const drillPoints: Point[] = [];
    if (piece.drillHoles && piece.drillHoles.length > 0) {
      for (const dh of piece.drillHoles) {
        drillPoints.push(translatePoint(dh, offsetX, offsetY));
      }
    } else if (piece.darts.length > 0) {
      for (const dart of piece.darts) {
        drillPoints.push(translatePoint(dart.apex, offsetX, offsetY));
      }
    } else {
      // Sleeve / dartless block reference drill point at grainline midpoint
      drillPoints.push({
        x: roundCoord(0.5 * (grainline.start.x + grainline.end.x)),
        y: roundCoord(0.5 * (grainline.start.y + grainline.end.y))
      });
    }

    // Layer 11 Internal Cutouts / Darts: dart legs triangle or internal biceps balance line for dartless pieces
    const internalPolylines: Point[][] = [];
    if (piece.darts.length > 0) {
      for (const dart of piece.darts) {
        internalPolylines.push([
          translatePoint(dart.legLeft, offsetX, offsetY),
          translatePoint(dart.apex, offsetX, offsetY),
          translatePoint(dart.legRight, offsetX, offsetY)
        ]);
      }
    } else {
      const midY = roundCoord(0.5 * (grainline.start.y + grainline.end.y));
      internalPolylines.push([
        { x: roundCoord(grainline.start.x - 1.5), y: midY },
        { x: roundCoord(grainline.start.x + 1.5), y: midY }
      ]);
    }

    pieceGeoms.push({
      pieceId: piece.id,
      pieceCode: piece.pieceCode,
      name: piece.name,
      garmentCategory: piece.garmentCategory,
      offsetXCm: offsetX,
      cutCount: piece.cutCount,
      onFold: piece.onFold,
      expectedCutVerticesCm: cutPts,
      expectedSewVerticesCm: sewPts,
      expectedGrainline: grainline,
      expectedNotchSegments: notchSegments,
      expectedDrillPoints: drillPoints,
      expectedInternalPolylines: internalPolylines
    });

    cursorX += Math.max(bbox.widthCm, 5.0) + pieceGapCm;
  }

  // Compute global DXF extents
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pg of pieceGeoms) {
    for (const pt of [...pg.expectedCutVerticesCm, ...pg.expectedSewVerticesCm]) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  const lines: string[] = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER',
    '1', 'AC1009',
    '9', '$INSUNITS',
    '70', '5',
    '9', '$EXTMIN',
    '10', minX.toFixed(6),
    '20', minY.toFixed(6),
    '9', '$EXTMAX',
    '10', maxX.toFixed(6),
    '20', maxY.toFixed(6),
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'TABLES',
    '0', 'TABLE',
    '2', 'LTYPE',
    '70', '1',
    '0', 'LTYPE',
    '2', 'CONTINUOUS',
    '70', '0',
    '3', 'Solid line',
    '72', '65',
    '73', '0',
    '40', '0.0',
    '0', 'ENDTAB',
    '0', 'TABLE',
    '2', 'LAYER',
    '70', '6'
  ];

  const layerColors: Array<[string, string]> = [
    ['1', '7'],
    ['2', '1'],
    ['4', '3'],
    ['7', '5'],
    ['8', '2'],
    ['11', '6']
  ];
  for (const [layerId, colorCode] of layerColors) {
    lines.push('0', 'LAYER', '2', layerId, '70', '0', '62', colorCode, '6', 'CONTINUOUS');
  }
  lines.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');

  const addPolyline = (layer: string, pts: Point[], closed: boolean): void => {
    lines.push('0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? '1' : '0');
    for (const pt of pts) {
      lines.push('0', 'VERTEX', '8', layer, '10', pt.x.toFixed(6), '20', pt.y.toFixed(6));
    }
    lines.push('0', 'SEQEND');
  };

  const emittedLayers = new Set<string>();
  let totalCutVertices = 0;
  let totalSewVertices = 0;

  for (const pg of pieceGeoms) {
    // Layer 1: Cut boundary
    addPolyline('1', pg.expectedCutVerticesCm, true);
    emittedLayers.add('1');
    totalCutVertices += pg.expectedCutVerticesCm.length;

    // Layer 8: Sew / stitching boundary
    addPolyline('8', pg.expectedSewVerticesCm, true);
    emittedLayers.add('8');
    totalSewVertices += pg.expectedSewVerticesCm.length;

    // Layer 7: Grainline
    lines.push(
      '0', 'LINE', '8', '7',
      '10', pg.expectedGrainline.start.x.toFixed(6),
      '20', pg.expectedGrainline.start.y.toFixed(6),
      '11', pg.expectedGrainline.end.x.toFixed(6),
      '21', pg.expectedGrainline.end.y.toFixed(6)
    );
    emittedLayers.add('7');

    // Layer 4: Notches
    for (const ns of pg.expectedNotchSegments) {
      lines.push(
        '0', 'LINE', '8', '4',
        '10', ns.start.x.toFixed(6),
        '20', ns.start.y.toFixed(6),
        '11', ns.end.x.toFixed(6),
        '21', ns.end.y.toFixed(6)
      );
      emittedLayers.add('4');
    }

    // Layer 2: Drill holes & dart apexes
    for (const dp of pg.expectedDrillPoints) {
      lines.push('0', 'POINT', '8', '2', '10', dp.x.toFixed(6), '20', dp.y.toFixed(6));
      emittedLayers.add('2');
    }

    // Layer 11: Internal dart lines / internal cutouts
    for (const ip of pg.expectedInternalPolylines) {
      addPolyline('11', ip, false);
      emittedLayers.add('11');
    }

    // Piece label TEXT on Layer 1
    lines.push(
      '0', 'TEXT', '8', '1',
      '10', pg.expectedGrainline.start.x.toFixed(6),
      '20', Math.max(0, pg.expectedGrainline.start.y - 1.5).toFixed(6),
      '40', '1.000000',
      '1', `${pg.pieceCode} CUT ${pg.cutCount}${pg.onFold ? ' ON FOLD' : ''}`
    );
  }

  if (options.sourceRevisionId || options.sizeCode) {
    const revMeta = [
      options.sourceRevisionId ? `REV ${options.sourceRevisionId}` : null,
      options.sizeCode ? `SIZE ${options.sizeCode}` : null,
      options.sourceContentFingerprint ? `FP ${options.sourceContentFingerprint.slice(0, 12)}` : null
    ]
      .filter(Boolean)
      .join(' | ');
    lines.push(
      '0', 'TEXT', '8', '1',
      '10', '0.000000',
      '20', '-5.000000',
      '40', '0.800000',
      '1', revMeta
    );
  }

  lines.push('0', 'ENDSEC', '0', 'EOF');
  const dxfText = lines.join('\n') + '\n';
  const sha256Digest = sha256Hex(dxfText);

  return {
    exportId,
    standard: 'DXF-AAMA / ASTM D6673',
    dxfVersion: 'AC1009',
    geometryUnit: 'cm',
    insUnitsCode: 5,
    ...(options.sourceRevisionId ? { sourceRevisionId: options.sourceRevisionId } : {}),
    ...(options.sourceContentFingerprint ? { sourceContentFingerprint: options.sourceContentFingerprint } : {}),
    ...(options.sizeCode ? { sizeCode: options.sizeCode } : {}),
    requiredLayers: [...REQUIRED_DXF_AAMA_LAYERS],
    emittedLayers: [...emittedLayers].sort(),
    pieceCodes: pieceGeoms.map(pg => pg.pieceCode),
    pieces: pieceGeoms,
    totalCutVertices,
    totalSewVertices,
    sha256Digest,
    dxfText,
    externalCadInteroperabilityVerified: false,
    interoperabilityNote:
      'Synthetic DXF-AAMA (AC1009) round-trip verification against canonical drafted PatternPiece contours; external third-party CAD software (Gerber/Lectra/Optitex/CLO3D) import/export validation remains unverified outside Patroner.'
  };
}

/**
 * Independent DXF R12 (AC1009) ASCII parser extracting HEADER, TABLES, and ENTITIES layers & geometry.
 */
export function parseDxfAama(dxfText: string): ParsedDxfAamaResult {
  const rawLines = dxfText.trim().split(/\r?\n/).map(ln => ln.trim());
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < rawLines.length; i += 2) {
    pairs.push([rawLines[i], rawLines[i + 1]]);
  }

  const sectionsRecovered: string[] = [];
  let acadVersionHeader = '';
  let insUnitsHeader = '';
  const tableLayersDefined = new Set<string>();
  const entityLayersFound = new Set<string>();

  const cutPolylines: Point[][] = [];
  const cutPolylineClosedFlags: boolean[] = [];
  const sewPolylines: Point[][] = [];
  const sewPolylineClosedFlags: boolean[] = [];
  const internalPolylines: Point[][] = [];
  const grainLines: Array<{ start: Point; end: Point }> = [];
  const notchLines: Array<{ start: Point; end: Point }> = [];
  const drillPoints: Point[] = [];
  const texts: Array<{ position: Point; value: string }> = [];

  let currentSection: string | null = null;
  let currentPolyLayer: string | null = null;
  let currentPolyClosed = false;
  let currentPolyPts: Point[] = [];

  let i = 0;
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code === '0' && val === 'SECTION' && i + 1 < pairs.length && pairs[i + 1][0] === '2') {
      currentSection = pairs[i + 1][1];
      sectionsRecovered.push(currentSection);
      i += 2;
      continue;
    }
    if (code === '0' && val === 'ENDSEC') {
      currentSection = null;
      i += 1;
      continue;
    }

    if (currentSection === 'HEADER') {
      if (code === '9' && val === '$ACADVER' && i + 1 < pairs.length) {
        acadVersionHeader = pairs[i + 1][1];
      } else if (code === '9' && val === '$INSUNITS' && i + 1 < pairs.length) {
        insUnitsHeader = pairs[i + 1][1];
      }
      i += 1;
      continue;
    }

    if (currentSection === 'TABLES') {
      if (code === '0' && val === 'LAYER') {
        i += 1;
        while (i < pairs.length && pairs[i][0] !== '0') {
          if (pairs[i][0] === '2') {
            tableLayersDefined.add(pairs[i][1]);
          }
          i += 1;
        }
        continue;
      }
      i += 1;
      continue;
    }

    if (currentSection === 'ENTITIES') {
      if (code === '0' && val === 'POLYLINE') {
        let layer = '0';
        let flags = 0;
        i += 1;
        while (i < pairs.length && pairs[i][0] !== '0') {
          if (pairs[i][0] === '8') layer = pairs[i][1];
          else if (pairs[i][0] === '70') flags = Number(pairs[i][1]);
          i += 1;
        }
        entityLayersFound.add(layer);
        currentPolyLayer = layer;
        currentPolyClosed = (flags & 1) === 1;
        currentPolyPts = [];
        continue;
      }
      if (code === '0' && val === 'VERTEX' && currentPolyLayer !== null) {
        let vx = 0;
        let vy = 0;
        i += 1;
        while (i < pairs.length && pairs[i][0] !== '0') {
          if (pairs[i][0] === '10') vx = Number(pairs[i][1]);
          else if (pairs[i][0] === '20') vy = Number(pairs[i][1]);
          i += 1;
        }
        currentPolyPts.push({ x: vx, y: vy });
        continue;
      }
      if (code === '0' && val === 'SEQEND' && currentPolyLayer !== null) {
        if (currentPolyLayer === '1') {
          cutPolylines.push(currentPolyPts);
          cutPolylineClosedFlags.push(currentPolyClosed);
        } else if (currentPolyLayer === '8') {
          sewPolylines.push(currentPolyPts);
          sewPolylineClosedFlags.push(currentPolyClosed);
        } else if (currentPolyLayer === '11') {
          internalPolylines.push(currentPolyPts);
        }
        currentPolyLayer = null;
        currentPolyClosed = false;
        currentPolyPts = [];
        i += 1;
        continue;
      }
      if (code === '0' && val === 'LINE') {
        let layer = '0';
        let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        i += 1;
        while (i < pairs.length && pairs[i][0] !== '0') {
          const [c, v] = pairs[i];
          if (c === '8') layer = v;
          else if (c === '10') x1 = Number(v);
          else if (c === '20') y1 = Number(v);
          else if (c === '11') x2 = Number(v);
          else if (c === '21') y2 = Number(v);
          i += 1;
        }
        entityLayersFound.add(layer);
        if (layer === '7') grainLines.push({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
        else if (layer === '4') notchLines.push({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
        continue;
      }
      if (code === '0' && val === 'POINT') {
        let layer = '0';
        let px = 0, py = 0;
        i += 1;
        while (i < pairs.length && pairs[i][0] !== '0') {
          const [c, v] = pairs[i];
          if (c === '8') layer = v;
          else if (c === '10') px = Number(v);
          else if (c === '20') py = Number(v);
          i += 1;
        }
        entityLayersFound.add(layer);
        if (layer === '2') drillPoints.push({ x: px, y: py });
        continue;
      }
      if (code === '0' && val === 'TEXT') {
        let layer = '0';
        let tx = 0, ty = 0, tval = '';
        i += 1;
        while (i < pairs.length && pairs[i][0] !== '0') {
          const [c, v] = pairs[i];
          if (c === '8') layer = v;
          else if (c === '10') tx = Number(v);
          else if (c === '20') ty = Number(v);
          else if (c === '1') tval = v;
          i += 1;
        }
        entityLayersFound.add(layer);
        texts.push({ position: { x: tx, y: ty }, value: tval });
        continue;
      }
    }

    i += 1;
  }

  return {
    sectionsRecovered,
    acadVersionHeader,
    insUnitsHeader,
    tableLayersDefined: [...tableLayersDefined].sort(),
    entityLayersFound: [...entityLayersFound].sort(),
    cutPolylines,
    cutPolylineClosedFlags,
    sewPolylines,
    sewPolylineClosedFlags,
    internalPolylines,
    grainLines,
    notchLines,
    drillPoints,
    texts,
    sha256Digest: sha256Hex(dxfText)
  };
}

/**
 * Verifies lossless DXF-AAMA round-trip within <= 0.001 cm across all exported piece contours,
 * grainlines, notches, drill points, internal cutouts, piece labels, and loop closure flags.
 */
export function verifyDxfAamaRoundTrip(
  exported: DxfAamaExportArtifact,
  toleranceMaxCm = DXF_ROUND_TRIP_MAX_ERROR_CM
): DxfRoundTripVerificationResult {
  const parsed = parseDxfAama(exported.dxfText);
  const missingTableLayers = REQUIRED_DXF_AAMA_LAYERS.filter(l => !parsed.tableLayersDefined.includes(l));
  const missingEntityLayers = REQUIRED_DXF_AAMA_LAYERS.filter(l => !parsed.entityLayersFound.includes(l));
  const failures: string[] = [];

  let maxErrorCm = 0;
  let maxFeatureErrorCm = 0;
  let cutRecoveredCount = 0;
  let sewRecoveredCount = 0;

  if (parsed.cutPolylines.length !== exported.pieces.length || parsed.sewPolylines.length !== exported.pieces.length) {
    maxErrorCm = Infinity;
    failures.push(
      `Polyline count mismatch: expected ${exported.pieces.length} cut/sew contours, parsed ${parsed.cutPolylines.length}/${parsed.sewPolylines.length}.`
    );
  } else {
    for (let idx = 0; idx < exported.pieces.length; idx++) {
      const expectedCut = exported.pieces[idx].expectedCutVerticesCm;
      const gotCut = parsed.cutPolylines[idx];
      cutRecoveredCount += gotCut.length;
      if (expectedCut.length !== gotCut.length) {
        maxErrorCm = Infinity;
        failures.push(`Cut vertex count mismatch on ${exported.pieces[idx].pieceCode}: expected ${expectedCut.length}, got ${gotCut.length}.`);
      } else {
        for (let k = 0; k < expectedCut.length; k++) {
          maxErrorCm = Math.max(maxErrorCm, Math.hypot(expectedCut[k].x - gotCut[k].x, expectedCut[k].y - gotCut[k].y));
        }
      }

      const expectedSew = exported.pieces[idx].expectedSewVerticesCm;
      const gotSew = parsed.sewPolylines[idx];
      sewRecoveredCount += gotSew.length;
      if (expectedSew.length !== gotSew.length) {
        maxErrorCm = Infinity;
        failures.push(`Sew vertex count mismatch on ${exported.pieces[idx].pieceCode}: expected ${expectedSew.length}, got ${gotSew.length}.`);
      } else {
        for (let k = 0; k < expectedSew.length; k++) {
          maxErrorCm = Math.max(maxErrorCm, Math.hypot(expectedSew[k].x - gotSew[k].x, expectedSew[k].y - gotSew[k].y));
        }
      }
    }
  }

  const allCutSewPolylinesClosed =
    parsed.cutPolylineClosedFlags.length === exported.pieces.length &&
    parsed.sewPolylineClosedFlags.length === exported.pieces.length &&
    parsed.cutPolylineClosedFlags.every(Boolean) &&
    parsed.sewPolylineClosedFlags.every(Boolean);
  if (!allCutSewPolylinesClosed) {
    failures.push('One or more cut/sew boundary polylines are not flagged closed (DXF group 70 bit 1).');
  }

  // Verify Layer 7 Grainlines
  const grainLinesExpected = exported.pieces.length;
  const grainLinesRecovered = parsed.grainLines.length;
  if (grainLinesRecovered !== grainLinesExpected) {
    maxFeatureErrorCm = Infinity;
    failures.push(`Grainline count mismatch: expected ${grainLinesExpected}, recovered ${grainLinesRecovered}.`);
  } else {
    for (let idx = 0; idx < exported.pieces.length; idx++) {
      const expGl = exported.pieces[idx].expectedGrainline;
      const gotGl = parsed.grainLines[idx];
      maxFeatureErrorCm = Math.max(
        maxFeatureErrorCm,
        Math.hypot(expGl.start.x - gotGl.start.x, expGl.start.y - gotGl.start.y),
        Math.hypot(expGl.end.x - gotGl.end.x, expGl.end.y - gotGl.end.y)
      );
    }
  }

  // Verify Layer 4 Notches
  const expectedNotches = exported.pieces.flatMap(pg => pg.expectedNotchSegments);
  const notchLinesExpected = expectedNotches.length;
  const notchLinesRecovered = parsed.notchLines.length;
  if (notchLinesRecovered !== notchLinesExpected) {
    maxFeatureErrorCm = Infinity;
    failures.push(`Notch line count mismatch: expected ${notchLinesExpected}, recovered ${notchLinesRecovered}.`);
  } else {
    for (let idx = 0; idx < expectedNotches.length; idx++) {
      const expN = expectedNotches[idx];
      const gotN = parsed.notchLines[idx];
      maxFeatureErrorCm = Math.max(
        maxFeatureErrorCm,
        Math.hypot(expN.start.x - gotN.start.x, expN.start.y - gotN.start.y),
        Math.hypot(expN.end.x - gotN.end.x, expN.end.y - gotN.end.y)
      );
    }
  }

  // Verify Layer 2 Drill Points
  const expectedDrills = exported.pieces.flatMap(pg => pg.expectedDrillPoints);
  const drillPointsExpected = expectedDrills.length;
  const drillPointsRecovered = parsed.drillPoints.length;
  if (drillPointsRecovered !== drillPointsExpected) {
    maxFeatureErrorCm = Infinity;
    failures.push(`Drill point count mismatch: expected ${drillPointsExpected}, recovered ${drillPointsRecovered}.`);
  } else {
    for (let idx = 0; idx < expectedDrills.length; idx++) {
      const expD = expectedDrills[idx];
      const gotD = parsed.drillPoints[idx];
      maxFeatureErrorCm = Math.max(maxFeatureErrorCm, Math.hypot(expD.x - gotD.x, expD.y - gotD.y));
    }
  }

  // Verify Layer 11 Internal Polylines
  const expectedInternals = exported.pieces.flatMap(pg => pg.expectedInternalPolylines);
  const internalPolylinesExpected = expectedInternals.length;
  const internalPolylinesRecovered = parsed.internalPolylines.length;
  if (internalPolylinesRecovered !== internalPolylinesExpected) {
    maxFeatureErrorCm = Infinity;
    failures.push(`Internal polyline count mismatch: expected ${internalPolylinesExpected}, recovered ${internalPolylinesRecovered}.`);
  } else {
    for (let idx = 0; idx < expectedInternals.length; idx++) {
      const expPoly = expectedInternals[idx];
      const gotPoly = parsed.internalPolylines[idx];
      if (expPoly.length !== gotPoly.length) {
        maxFeatureErrorCm = Infinity;
        failures.push(`Internal polyline vertex count mismatch at index ${idx}.`);
      } else {
        for (let k = 0; k < expPoly.length; k++) {
          maxFeatureErrorCm = Math.max(
            maxFeatureErrorCm,
            Math.hypot(expPoly[k].x - gotPoly[k].x, expPoly[k].y - gotPoly[k].y)
          );
        }
      }
    }
  }

  // Verify Piece Code TEXT Labels
  const pieceLabelsExpected = exported.pieces.length;
  let pieceLabelsRecovered = 0;
  for (const pg of exported.pieces) {
    if (parsed.texts.some(t => t.value.includes(pg.pieceCode))) {
      pieceLabelsRecovered++;
    } else {
      failures.push(`Missing piece identity TEXT label containing "${pg.pieceCode}".`);
    }
  }

  const shaMatches = parsed.sha256Digest === exported.sha256Digest;
  if (!shaMatches) {
    failures.push('SHA-256 digest of DXF payload does not match exported digest.');
  }

  const sectionsOk =
    parsed.sectionsRecovered.length === 3 &&
    parsed.sectionsRecovered[0] === 'HEADER' &&
    parsed.sectionsRecovered[1] === 'TABLES' &&
    parsed.sectionsRecovered[2] === 'ENTITIES';
  if (!sectionsOk) {
    failures.push(`DXF sections incomplete: [${parsed.sectionsRecovered.join(', ')}].`);
  }
  if (parsed.acadVersionHeader !== 'AC1009') {
    failures.push(`Unexpected DXF version header "${parsed.acadVersionHeader}" (expected AC1009).`);
  }
  if (parsed.insUnitsHeader !== '5') {
    failures.push(`Unexpected DXF $INSUNITS "${parsed.insUnitsHeader}" (expected 5 = cm).`);
  }
  if (missingTableLayers.length > 0) {
    failures.push(`Missing table layers: ${missingTableLayers.join(', ')}.`);
  }
  if (missingEntityLayers.length > 0) {
    failures.push(`Missing entity layers: ${missingEntityLayers.join(', ')}.`);
  }

  const allPassed =
    failures.length === 0 &&
    sectionsOk &&
    parsed.acadVersionHeader === 'AC1009' &&
    parsed.insUnitsHeader === '5' &&
    missingTableLayers.length === 0 &&
    missingEntityLayers.length === 0 &&
    allCutSewPolylinesClosed &&
    cutRecoveredCount === exported.totalCutVertices &&
    sewRecoveredCount === exported.totalSewVertices &&
    grainLinesRecovered === grainLinesExpected &&
    notchLinesRecovered === notchLinesExpected &&
    drillPointsRecovered === drillPointsExpected &&
    internalPolylinesRecovered === internalPolylinesExpected &&
    pieceLabelsRecovered === pieceLabelsExpected &&
    Number.isFinite(maxErrorCm) &&
    maxErrorCm <= toleranceMaxCm &&
    Number.isFinite(maxFeatureErrorCm) &&
    maxFeatureErrorCm <= toleranceMaxCm &&
    shaMatches;

  return {
    exportId: exported.exportId,
    pieceCodes: exported.pieceCodes,
    sectionsRecovered: parsed.sectionsRecovered,
    acadVersionHeader: parsed.acadVersionHeader,
    insUnitsHeader: parsed.insUnitsHeader,
    missingTableLayers,
    missingEntityLayers,
    cutVertexCountExpected: exported.totalCutVertices,
    cutVertexCountRecovered: cutRecoveredCount,
    sewVertexCountExpected: exported.totalSewVertices,
    sewVertexCountRecovered: sewRecoveredCount,
    grainLinesExpected,
    grainLinesRecovered,
    notchLinesExpected,
    notchLinesRecovered,
    drillPointsExpected,
    drillPointsRecovered,
    internalPolylinesExpected,
    internalPolylinesRecovered,
    pieceLabelsExpected,
    pieceLabelsRecovered,
    allCutSewPolylinesClosed,
    maxVertexRoundTripErrorCm: Number.isFinite(maxErrorCm) ? Number(maxErrorCm.toFixed(9)) : -1,
    maxFeatureRoundTripErrorCm: Number.isFinite(maxFeatureErrorCm) ? Number(maxFeatureErrorCm.toFixed(9)) : -1,
    toleranceMaxCm,
    sha256DigestMatches: shaMatches,
    syntheticRoundTripVerified: allPassed,
    externalCadInteroperabilityVerified: false,
    allPassed,
    failures
  };
}

function serializeSegmentsBySeamId(piece: PatternPiece, segmentIds: string[]): SerializedCurveSegmentSpec[] {
  if (!piece.stitchingContour) return [];
  const specs: SerializedCurveSegmentSpec[] = [];
  for (const sId of segmentIds) {
    const seg = piece.stitchingContour.segments.find(s => s.id === sId);
    if (!seg) continue;
    if (seg.type === 'line') {
      specs.push({
        id: seg.id,
        type: 'line',
        p0: { x: seg.start.x, y: seg.start.y },
        p3: { x: seg.end.x, y: seg.end.y },
        lengthCm: seg.lengthCm()
      });
    } else {
      const bz = seg as CubicBezierCurve;
      specs.push({
        id: bz.id,
        type: 'bezier',
        p0: { x: bz.p0.x, y: bz.p0.y },
        cp1: { x: bz.cp1.x, y: bz.cp1.y },
        cp2: { x: bz.cp2.x, y: bz.cp2.y },
        p3: { x: bz.p3.x, y: bz.p3.y },
        lengthCm: bz.adaptiveLength(0.001).lengthCm
      });
    }
  }
  return specs;
}

function sumSegmentLengths(specs: SerializedCurveSegmentSpec[]): number {
  return Number(specs.reduce((acc, s) => acc + s.lengthCm, 0).toFixed(4));
}

/**
 * Computes paired seam parity and sleeve-to-armhole DEC-11 checks directly from canonical drafted PatternPiece contours.
 */
export function auditProductionSeamParityFromPieces(
  bodicePieces: PatternPiece[],
  sleevePiece: PatternPiece,
  skirtPieces: PatternPiece[],
  designSpec: DesignSpecification,
  measurements: BodyMeasurements
): {
  pairedSeamChecks: DraftedPairedSeamCheck[];
  bodiceSleeveAssemblyEase: {
    status: string;
    isValid: boolean;
    frontBodiceArmholeLengthCm: number;
    backBodiceArmholeLengthCm: number;
    frontSleeveCapLengthCm: number;
    backSleeveCapLengthCm: number;
    frontEaseCm: number;
    backEaseCm: number;
    totalEaseCm: number;
    targetTotalEaseCm: number;
    isTotalEasePermitted: boolean;
    isDistributionBalanced: boolean;
    isTargetCompliant: boolean;
    inseamParityDeltaCm: number;
    targetEaseDiagnosticNote: string;
  };
  allPassed: boolean;
} {
  const bodiceFront = bodicePieces.find(p => p.id === 'piece-bodice-front' || p.pieceCode.startsWith('BOD-F'))!;
  const bodiceBack = bodicePieces.find(p => p.id === 'piece-bodice-back' || p.pieceCode.startsWith('BOD-B'))!;
  const skirtFront = skirtPieces.find(p => p.id === 'piece-skirt-front' || p.pieceCode.startsWith('SK-01'))!;
  const skirtBack = skirtPieces.find(p => p.id === 'piece-skirt-back' || p.pieceCode.startsWith('SK-02'))!;

  const specs: Array<{
    label: string;
    pA: PatternPiece;
    sAId: string;
    segsA: string[];
    pB: PatternPiece;
    sBId: string;
    segsB: string[];
    easeCm: number;
  }> = [
    {
      label: 'Bodice Front Side Seam <-> Bodice Back Side Seam',
      pA: bodiceFront,
      sAId: 'fb-side-seam',
      segsA: ['fb-side-seam'],
      pB: bodiceBack,
      sBId: 'bb-side-seam',
      segsB: ['bb-side-seam'],
      easeCm: 0.0
    },
    {
      label: 'Bodice Front Shoulder <-> Bodice Back Shoulder',
      pA: bodiceFront,
      sAId: 'fb-shoulder-seam',
      segsA: ['fb-shoulder'],
      pB: bodiceBack,
      sBId: 'bb-shoulder-seam',
      segsB: ['bb-shoulder'],
      easeCm: 0.0
    },
    {
      label: 'Skirt Front Side Seam (Lower + Hip Bezier) <-> Skirt Back Side Seam',
      pA: skirtFront,
      sAId: 'fs-side-seam',
      segsA: ['fs-side-lower', 'fs-side-hip'],
      pB: skirtBack,
      sBId: 'bs-side-seam',
      segsB: ['bs-side-lower', 'bs-side-hip'],
      easeCm: 0.0
    },
    {
      label: 'Sleeve Front Inseam <-> Sleeve Back Underarm Inseam',
      pA: sleevePiece,
      sAId: 'slv-front-inseam',
      segsA: ['sleeve-front-inseam'],
      pB: sleevePiece,
      sBId: 'slv-back-inseam',
      segsB: ['sleeve-back-inseam'],
      easeCm: 0.0
    }
  ];

  const pairedSeamChecks: DraftedPairedSeamCheck[] = specs.map(spec => {
    const segsA = serializeSegmentsBySeamId(spec.pA, spec.segsA);
    const segsB = serializeSegmentsBySeamId(spec.pB, spec.segsB);
    const lenA = sumSegmentLengths(segsA);
    const lenB = sumSegmentLengths(segsB);
    const cadDeltaCm = Number(Math.abs(lenA - lenB - spec.easeCm).toFixed(4));
    return {
      seamPair: spec.label,
      pieceAId: spec.pA.id,
      pieceBId: spec.pB.id,
      seamAId: spec.sAId,
      seamBId: spec.sBId,
      edgeALengthCm: lenA,
      edgeBLengthCm: lenB,
      edgeASegments: segsA,
      edgeBSegments: segsB,
      targetEaseCm: spec.easeCm,
      cadDeltaCm,
      withinTier1CadTolerance0_05Cm: cadDeltaCm <= DEC11_TIER1_CAD_TOLERANCE_CM && segsA.length > 0 && segsB.length > 0
    };
  });

  const assembly = assembleBodiceSleeve({
    bodicePieces: [bodiceFront, bodiceBack],
    sleevePiece,
    designSpec,
    measurements,
    options: { strategy: 'classic' }
  });

  const bodiceSleeveAssemblyEase = {
    status: assembly.status,
    isValid: assembly.isValid,
    frontBodiceArmholeLengthCm: assembly.ease.frontBodiceArmholeLengthCm,
    backBodiceArmholeLengthCm: assembly.ease.backBodiceArmholeLengthCm,
    frontSleeveCapLengthCm: assembly.ease.frontSleeveCapLengthCm,
    backSleeveCapLengthCm: assembly.ease.backSleeveCapLengthCm,
    frontEaseCm: assembly.ease.frontEaseCm,
    backEaseCm: assembly.ease.backEaseCm,
    totalEaseCm: assembly.ease.totalEaseCm,
    targetTotalEaseCm: assembly.ease.targetTotalEaseCm,
    isTotalEasePermitted: assembly.ease.isTotalEasePermitted,
    isDistributionBalanced: assembly.ease.isDistributionBalanced,
    isTargetCompliant: assembly.ease.isTargetCompliant,
    inseamParityDeltaCm: assembly.endpoints.underarmInseamMatch.parityDeltaCm,
    targetEaseDiagnosticNote: assembly.ease.isTargetCompliant
      ? 'Sleeve cap ease matches configured classic target.'
      : 'C0-Legacy draftSleeveBlock scales biceps width without re-solving cap height (H_cap), yielding permitted/balanced tailoring ease (0 <= E_t <= 5.05 cm) above classic 1.80 cm target; tracked as Class B M02b solver upgrade.'
  };

  const allPassed =
    pairedSeamChecks.every(c => c.withinTier1CadTolerance0_05Cm) &&
    assembly.status === 'verified-valid' &&
    assembly.isValid &&
    assembly.ease.isTotalEasePermitted &&
    assembly.ease.isDistributionBalanced &&
    assembly.endpoints.underarmInseamMatch.parityDeltaCm <= DEC11_TIER1_CAD_TOLERANCE_CM;

  return {
    pairedSeamChecks,
    bodiceSleeveAssemblyEase,
    allPassed
  };
}
