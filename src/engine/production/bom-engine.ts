/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner M05 — Deterministic Geometry-Driven Bill of Materials (BOM) Engine
 *
 * Calculates main fabric, lining, interfacing/stay-tape, thread, fasteners,
 * and packaging deterministically from actual PatternPiece contours, seam lengths,
 * physical panel counts, and declared constructionFeatures.
 *
 * Explicitly separates:
 * - `'calculated'`: deterministic geometric integral (piece area / seam arc length)
 * - `'configured-allowance'`: configurable waste, marker buffer, and stitch consumption ratios
 * - `'estimated'`: rule-based trim allowance when geometry alone does not fix yield
 * - `'user-entered'`: optional operator/supplier metadata overrides
 */

import { DesignSpecification, PatternPiece, Point } from '../../types';
import { CubicBezierCurve } from '../geometry/primitives';
import { PatternPieceProductionSheet } from './manufacturing-types';
import {
  BomCalculationOptions,
  BomLineItem,
  M05_PRODUCTION_PACKAGE_SCHEMA_VERSION,
  M05BomReport,
  PerSizeBomSummary
} from './production-engineering-types';

const DEFAULT_ROLL_WIDTH_CM = 140;
const DEFAULT_SELVEDGE_CM = 1.5;
const DEFAULT_MARKER_WASTE_FACTOR = 0.18; // Configurable industrial single/nested lay buffer
const DEFAULT_THREAD_WASTAGE_FACTOR = 0.15;
const DEFAULT_LOCKSTITCH_MULTIPLIER = 2.8; // ISO 301 top+bobbin + turnback ratio
const DEFAULT_INTERFACING_WIDTH_CM = 90;

function round4(v: number): number {
  return Number(v.toFixed(4));
}

function round3(v: number): number {
  return Number(v.toFixed(3));
}

function computeShoelaceAreaCm2(pts: readonly Point[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

/**
 * Computes closed contour polygon area in cm^2 directly from cutting or stitching contour.
 */
export function computePieceContourAreaCm2(
  piece: PatternPiece,
  contourKind: 'cutting' | 'stitching' = 'cutting'
): number {
  const contour = contourKind === 'cutting' ? piece.cuttingContour : piece.stitchingContour;
  if (contour && contour.segments.length > 0) {
    const pts: Point[] = [];
    for (const seg of contour.segments) {
      if (seg.type === 'line') {
        pts.push(seg.start);
      } else {
        const flat = (seg as CubicBezierCurve).flatten(0.01, 7);
        for (let i = 0; i < flat.length - 1; i++) {
          pts.push(flat[i]);
        }
      }
    }
    const area = computeShoelaceAreaCm2(pts);
    if (Number.isFinite(area) && area > 0) {
      return round4(area);
    }
  }
  // Fallback strictly from declared bounding box rectangle * 0.72 only flagged as fallback if contour absent
  return round4(Math.max(0, piece.boundingBox.widthCm * piece.boundingBox.heightCm * 0.72));
}

/**
 * Computes closed stitching contour perimeter in cm directly from piece seams / contour.
 */
export function computePieceStitchingPerimeterCm(piece: PatternPiece): number {
  if (piece.stitchingContour && piece.stitchingContour.segments.length > 0) {
    let total = 0;
    for (const seg of piece.stitchingContour.segments) {
      if (seg.type === 'line') {
        total += Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y);
      } else {
        total += (seg as CubicBezierCurve).adaptiveLength(0.005).lengthCm;
      }
    }
    return round4(total);
  }
  return round4(piece.seams.reduce((acc, s) => acc + Math.max(0, s.lengthCm), 0));
}

export function getEffectivePhysicalPanelMultiplier(
  piece: PatternPiece,
  sheet?: PatternPieceProductionSheet
): number {
  if (sheet?.cutSemantics.physicalPanelCountPerGarment !== undefined && sheet.cutSemantics.physicalPanelCountPerGarment !== null) {
    return sheet.cutSemantics.physicalPanelCountPerGarment;
  }
  return piece.onFold ? 1 : Math.max(1, piece.cutCount);
}

export interface ComputeProductionBomInput {
  readonly designSpec: DesignSpecification;
  readonly piecesBySize: Readonly<Record<string, readonly PatternPiece[]>>;
  readonly sheetsBySize?: Readonly<Record<string, readonly PatternPieceProductionSheet[]>>;
  readonly options?: BomCalculationOptions;
}

/**
 * Deterministically computes a complete per-size and order-total BOM from drafted piece geometry.
 */
export function computeProductionBom(input: ComputeProductionBomInput): M05BomReport {
  const opts = input.options ?? {};
  const rollWidthCm = opts.fabricRollWidthCm ?? DEFAULT_ROLL_WIDTH_CM;
  const selvedgeCm = opts.selvedgeMarginCm ?? DEFAULT_SELVEDGE_CM;
  const markerWasteFactor = opts.markerWasteFactor ?? DEFAULT_MARKER_WASTE_FACTOR;
  const threadWastageFactor = opts.threadWastageFactor ?? DEFAULT_THREAD_WASTAGE_FACTOR;
  const interfacingWidthCm = opts.interfacingWidthCm ?? DEFAULT_INTERFACING_WIDTH_CM;

  if (!Number.isFinite(rollWidthCm) || rollWidthCm <= 0) {
    throw new Error(`Invalid fabricRollWidthCm "${String(rollWidthCm)}": must be finite and > 0.`);
  }
  if (!Number.isFinite(selvedgeCm) || selvedgeCm < 0 || selvedgeCm * 2 >= rollWidthCm) {
    throw new Error(`Invalid selvedgeMarginCm "${String(selvedgeCm)}" for roll width ${rollWidthCm} cm.`);
  }
  if (!Number.isFinite(markerWasteFactor) || markerWasteFactor < 0 || markerWasteFactor > 1.5) {
    throw new Error(`Invalid markerWasteFactor "${String(markerWasteFactor)}": must be within [0, 1.5].`);
  }
  if (!Number.isFinite(threadWastageFactor) || threadWastageFactor < 0 || threadWastageFactor > 1.5) {
    throw new Error(`Invalid threadWastageFactor "${String(threadWastageFactor)}": must be within [0, 1.5].`);
  }

  const usableWidthCm = round4(rollWidthCm - 2 * selvedgeCm);
  const sizeKeys = Object.keys(input.piecesBySize);
  const hasExplicitOrderQty =
    opts.orderQuantitiesBySize !== undefined &&
    Object.keys(opts.orderQuantitiesBySize).length > 0;
  const orderQuantityBasis = hasExplicitOrderQty
    ? 'declared-order-quantity'
    : 'default-single-garment-per-size-run';

  const sizeBreakdowns: PerSizeBomSummary[] = [];
  const allSelfPieceIds = new Set<string>();
  const allLiningPieceIds = new Set<string>();
  const allThreadPieceIds = new Set<string>();
  const stabilizationPieceIds = new Set<string>();
  const warnings: string[] = [];

  let totalOrderGarments = 0;
  let sumBaseSelfAreaTotalOrderCm2 = 0;
  let sumSelfMetersBaseTotalOrder = 0;
  let sumSelfMetersWithWasteTotalOrder = 0;
  let sumLiningMetersTotalOrder = 0;
  let sumInterfacingMetersTotalOrder = 0;
  let sumThreadMetersBaseTotalOrder = 0;
  let sumThreadMetersTotalOrder = 0;

  let refSizeSelfMetersBase = 0;
  let refSizeSelfMetersAllowance = 0;
  let refSizeLiningMetersBase = 0;
  let refSizeInterfacingMetersBase = 0;
  let refSizeThreadMetersBase = 0;
  let refSizeThreadMetersAllowance = 0;

  for (let sIdx = 0; sIdx < sizeKeys.length; sIdx++) {
    const sizeCode = sizeKeys[sIdx];
    const pieces = input.piecesBySize[sizeCode] ?? [];
    const sheets = input.sheetsBySize?.[sizeCode] ?? [];
    const rawOrderQty = opts.orderQuantitiesBySize?.[sizeCode];
    const orderQty = rawOrderQty === undefined ? 1 : rawOrderQty;
    if (!Number.isFinite(orderQty) || orderQty < 0 || !Number.isInteger(orderQty)) {
      throw new Error(`Invalid order quantity "${String(orderQty)}" for size "${sizeCode}".`);
    }

    let selfCuttingAreaCm2 = 0;
    let selfStitchingAreaCm2 = 0;
    let liningCuttingAreaCm2 = 0;
    let totalStitchingPerimeterCm = 0;
    let stabilizationSeamLengthCm = 0;

    for (const piece of pieces) {
      const sheet = sheets.find(sh => sh.pieceId === piece.id);
      const panelMultiplier = getEffectivePhysicalPanelMultiplier(piece, sheet);
      const halfCutAreaCm2 =
        sheet?.geometryMetrics.cuttingAreaCm2 !== null && sheet?.geometryMetrics.cuttingAreaCm2 !== undefined
          ? sheet.geometryMetrics.cuttingAreaCm2
          : computePieceContourAreaCm2(piece, 'cutting');
      const halfSewAreaCm2 =
        sheet?.geometryMetrics.stitchingAreaCm2 !== null && sheet?.geometryMetrics.stitchingAreaCm2 !== undefined
          ? sheet.geometryMetrics.stitchingAreaCm2
          : computePieceContourAreaCm2(piece, 'stitching');
      const perimeterCm =
        sheet?.geometryMetrics.stitchingPerimeterCm !== null && sheet?.geometryMetrics.stitchingPerimeterCm !== undefined
          ? sheet.geometryMetrics.stitchingPerimeterCm
          : computePieceStitchingPerimeterCm(piece);

      // Single pattern half on-fold physically cuts symmetric double-area panel when unfolded on bolt
      const unfoldedMultiplier = piece.onFold ? 2 : panelMultiplier;

      if (piece.material === 'lining') {
        liningCuttingAreaCm2 += halfCutAreaCm2 * unfoldedMultiplier;
        allLiningPieceIds.add(piece.id);
      } else {
        selfCuttingAreaCm2 += halfCutAreaCm2 * unfoldedMultiplier;
        selfStitchingAreaCm2 += halfSewAreaCm2 * unfoldedMultiplier;
        allSelfPieceIds.add(piece.id);
      }

      totalStitchingPerimeterCm += perimeterCm * unfoldedMultiplier;
      allThreadPieceIds.add(piece.id);

      // Calculate stabilization length for neckline, armhole/scye, waistline, and zipper openings
      for (const seam of piece.seams) {
        const lowerName = seam.name.toLowerCase();
        if (
          lowerName.includes('neck') ||
          lowerName.includes('armhole') ||
          lowerName.includes('scye') ||
          lowerName.includes('waist') ||
          lowerName.includes('zip')
        ) {
          stabilizationSeamLengthCm += seam.lengthCm * unfoldedMultiplier;
          stabilizationPieceIds.add(piece.id);
        }
      }
    }

    if (opts.includeLining && liningCuttingAreaCm2 === 0 && selfCuttingAreaCm2 > 0) {
      liningCuttingAreaCm2 = round4(selfCuttingAreaCm2 * 0.85);
    }

    // Geometry baseline conversion: Area (cm^2) / (usableWidthCm * 100 cm/m)
    const baseSelfMetersPerGarment = round4(selfCuttingAreaCm2 / (usableWidthCm * 100));
    const wasteSelfMetersPerGarment = round4(baseSelfMetersPerGarment * markerWasteFactor);
    const totalSelfMetersPerGarment = round4(baseSelfMetersPerGarment + wasteSelfMetersPerGarment);

    const liningMetersPerGarment = round4(
      (liningCuttingAreaCm2 / (usableWidthCm * 100)) * (1 + markerWasteFactor)
    );
    const baseThreadMetersPerGarment = round4(
      (totalStitchingPerimeterCm / 100) * DEFAULT_LOCKSTITCH_MULTIPLIER
    );
    const wasteThreadMetersPerGarment = round4(baseThreadMetersPerGarment * threadWastageFactor);
    const threadMetersPerGarment = round4(baseThreadMetersPerGarment + wasteThreadMetersPerGarment);

    const interfacingMetersPerGarment =
      opts.includeInterfacing !== false && stabilizationSeamLengthCm > 0
        ? round4((stabilizationSeamLengthCm / 100) * 1.1)
        : 0;

    totalOrderGarments += orderQty;
    sumBaseSelfAreaTotalOrderCm2 += selfCuttingAreaCm2 * orderQty;
    sumSelfMetersBaseTotalOrder += baseSelfMetersPerGarment * orderQty;
    sumSelfMetersWithWasteTotalOrder += totalSelfMetersPerGarment * orderQty;
    sumLiningMetersTotalOrder += liningMetersPerGarment * orderQty;
    sumInterfacingMetersTotalOrder += interfacingMetersPerGarment * orderQty;
    sumThreadMetersBaseTotalOrder += baseThreadMetersPerGarment * orderQty;
    sumThreadMetersTotalOrder += threadMetersPerGarment * orderQty;

    if (sIdx === 0 || sizeCode === 'M') {
      refSizeSelfMetersBase = baseSelfMetersPerGarment;
      refSizeSelfMetersAllowance = wasteSelfMetersPerGarment;
      refSizeLiningMetersBase = liningMetersPerGarment;
      refSizeInterfacingMetersBase = interfacingMetersPerGarment;
      refSizeThreadMetersBase = baseThreadMetersPerGarment;
      refSizeThreadMetersAllowance = wasteThreadMetersPerGarment;
    }

    sizeBreakdowns.push({
      sizeCode,
      orderQuantity: orderQty,
      selfPieceCuttingAreaCm2: round4(selfCuttingAreaCm2),
      selfPieceStitchingAreaCm2: round4(selfStitchingAreaCm2),
      liningCuttingAreaCm2: round4(liningCuttingAreaCm2),
      mainFabricMetersPerGarment: totalSelfMetersPerGarment,
      mainFabricMetersForSizeOrder: round3(totalSelfMetersPerGarment * orderQty),
      totalStitchingPerimeterCm: round4(totalStitchingPerimeterCm),
      threadMetersPerGarment,
      interfacingMetersPerGarment
    });
  }

  const lineItems: BomLineItem[] = [];
  const resolveSupplier = (itemId: string): BomLineItem['supplierData'] => {
    const sup = opts.supplierOverrides?.[itemId];
    return sup ? { ...sup, origin: 'user-entered' } : { origin: 'none' };
  };

  // 1. Main Shell Fabric (Calculated Geometry + Configurable Marker Waste Buffer)
  lineItems.push({
    itemId: 'bom-main-fabric',
    category: 'main-fabric',
    materialName: input.designSpec.fabric.name,
    specification: `${input.designSpec.fabric.composition} | Width ${rollWidthCm} cm (Usable ${usableWidthCm} cm)`,
    unit: 'meters',
    basis: markerWasteFactor > 0 ? 'configured-allowance' : 'calculated',
    calculatedBaseQuantityPerGarment: round4(refSizeSelfMetersBase),
    allowanceQuantityPerGarment: round4(refSizeSelfMetersAllowance),
    totalQuantityPerGarment: round4(refSizeSelfMetersBase + refSizeSelfMetersAllowance),
    totalOrderQuantity: round3(sumSelfMetersWithWasteTotalOrder),
    wasteFactorApplied: markerWasteFactor,
    calculationFormula: `Sum(cuttingAreaCm2 * physicalUnfoldedPanels) / (${usableWidthCm} cm * 100) * (1 + ${markerWasteFactor}) [Total geometric area ${round4(sumBaseSelfAreaTotalOrderCm2)} cm^2 -> net ${round3(sumSelfMetersBaseTotalOrder)} m before ${Math.round(markerWasteFactor * 100)}% marker waste buffer]`,
    traceablePieceIds: [...allSelfPieceIds],
    traceableFeatureIds: [input.designSpec.fabric.id],
    supplierData: resolveSupplier('bom-main-fabric')
  });

  // 2. Lining (Only if lining pieces exist or explicitly enabled)
  if (sumLiningMetersTotalOrder > 0) {
    lineItems.push({
      itemId: 'bom-lining',
      category: 'lining',
      materialName: `${input.designSpec.fabric.name} Coordinated Lining`,
      specification: `Breathable bemberg/cupro lining | Usable width ${usableWidthCm} cm`,
      unit: 'meters',
      basis: allLiningPieceIds.size > 0 ? 'configured-allowance' : 'estimated',
      calculatedBaseQuantityPerGarment: round4(refSizeLiningMetersBase / (1 + markerWasteFactor)),
      allowanceQuantityPerGarment: round4(refSizeLiningMetersBase - refSizeLiningMetersBase / (1 + markerWasteFactor)),
      totalQuantityPerGarment: round4(refSizeLiningMetersBase),
      totalOrderQuantity: round3(sumLiningMetersTotalOrder),
      wasteFactorApplied: markerWasteFactor,
      calculationFormula:
        allLiningPieceIds.size > 0
          ? 'Calculated directly from lining pattern piece cutting contours.'
          : 'Estimated at 85% of shell pattern area (includeLining option enabled).',
      traceablePieceIds: allLiningPieceIds.size > 0 ? [...allLiningPieceIds] : [...allSelfPieceIds],
      traceableFeatureIds: [],
      supplierData: resolveSupplier('bom-lining')
    });
  }

  // 3. Interfacing / Bias Stay-Tape (Calculated from actual stabilization seam arc lengths)
  if (sumInterfacingMetersTotalOrder > 0) {
    lineItems.push({
      itemId: 'bom-interfacing-stay-tape',
      category: 'interfacing',
      materialName: 'Fusible Bias Stay-Tape / Stabilization Strip',
      specification: `1.2 cm pre-shrunk fusible tape (Bolt equiv ${interfacingWidthCm} cm)`,
      unit: 'meters',
      basis: 'calculated',
      calculatedBaseQuantityPerGarment: round4(refSizeInterfacingMetersBase / 1.1),
      allowanceQuantityPerGarment: round4(refSizeInterfacingMetersBase - refSizeInterfacingMetersBase / 1.1),
      totalQuantityPerGarment: round4(refSizeInterfacingMetersBase),
      totalOrderQuantity: round3(sumInterfacingMetersTotalOrder),
      wasteFactorApplied: 0.1,
      calculationFormula:
        'Sum(neck + scye/armhole + waist + zip seam lengths across panels) / 100 * 1.10 handling allowance',
      traceablePieceIds: [...stabilizationPieceIds],
      traceableFeatureIds: input.designSpec.constructionFeatures.map(f => f.name),
      supplierData: resolveSupplier('bom-interfacing-stay-tape')
    });
  }

  // 4. Sewing Thread (Calculated from total stitching perimeter across all pieces)
  lineItems.push({
    itemId: 'bom-sewing-thread',
    category: 'thread',
    materialName: `Poly-Wrapped Core Spun Thread (Matched: ${input.designSpec.color.name})`,
    specification: 'Tex 27 / Ticket 100 lockstitch + seam finishing thread',
    unit: 'meters',
    basis: 'calculated',
    calculatedBaseQuantityPerGarment: round4(refSizeThreadMetersBase),
    allowanceQuantityPerGarment: round4(refSizeThreadMetersAllowance),
    totalQuantityPerGarment: round4(refSizeThreadMetersBase + refSizeThreadMetersAllowance),
    totalOrderQuantity: round3(sumThreadMetersTotalOrder),
    wasteFactorApplied: threadWastageFactor,
    calculationFormula: `Sum(stitchingPerimeterCm * physicalPanels) / 100 * ${DEFAULT_LOCKSTITCH_MULTIPLIER} (ISO 301 ratio) * (1 + ${threadWastageFactor} start/backtack wastage) [Net before waste: ${round3(sumThreadMetersBaseTotalOrder)} m]`,
    traceablePieceIds: [...allThreadPieceIds],
    traceableFeatureIds: [],
    supplierData: resolveSupplier('bom-sewing-thread')
  });

  // 5. Fasteners, Zippers, Buttons — STRICTLY traced to constructionFeatures or explicit skirt center-back closure
  for (const feat of input.designSpec.constructionFeatures) {
    const desc = `${feat.name} ${feat.description}`.toLowerCase();
    if (desc.includes('zip')) {
      const lengthMatch = /(\d+(?:\.\d+)?)\s*cm/i.exec(`${feat.name} ${feat.description}`);
      const zipLen = lengthMatch ? `${lengthMatch[1]} cm` : 'specified';
      lineItems.push({
        itemId: `bom-fastener-zip-${feat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        category: 'fasteners-hardware',
        materialName: `Concealed Zipper (${zipLen})`,
        specification: `Color matched to ${input.designSpec.color.name} | Source: ${feat.name}`,
        unit: 'units',
        basis: 'calculated',
        calculatedBaseQuantityPerGarment: 1,
        allowanceQuantityPerGarment: 0,
        totalQuantityPerGarment: 1,
        totalOrderQuantity: totalOrderGarments,
        wasteFactorApplied: 0,
        calculationFormula: `1 unit per garment derived directly from declared feature "${feat.name}"`,
        traceablePieceIds: [...allSelfPieceIds],
        traceableFeatureIds: [feat.name],
        supplierData: resolveSupplier('bom-fastener-zip')
      });
    } else if (desc.includes('button')) {
      const countMatch =
        /(\d+)\s+(?:[\w-]+\s+){0,3}(?:button|hole)s?/i.exec(`${feat.name} ${feat.description}`) ??
        /(?:button|hole)s?\s*[:x-]?\s*(\d+)/i.exec(`${feat.name} ${feat.description}`);
      const btnCount = countMatch ? Math.max(1, Number(countMatch[1])) : 5;
      const basisType = countMatch ? 'calculated' : 'estimated';
      lineItems.push({
        itemId: `bom-fastener-buttons-${feat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        category: 'fasteners-hardware',
        materialName: 'Closure Buttons',
        specification: `${btnCount} buttons/garment | Source: ${feat.name}`,
        unit: 'units',
        basis: basisType,
        calculatedBaseQuantityPerGarment: btnCount,
        allowanceQuantityPerGarment: 0,
        totalQuantityPerGarment: btnCount,
        totalOrderQuantity: totalOrderGarments * btnCount,
        wasteFactorApplied: 0,
        calculationFormula: `${btnCount} units/garment derived from construction feature "${feat.name}"`,
        traceablePieceIds: [...allSelfPieceIds],
        traceableFeatureIds: [feat.name],
        supplierData: resolveSupplier('bom-fastener-buttons')
      });
    } else if (desc.includes('hook') || desc.includes('eye')) {
      lineItems.push({
        itemId: 'bom-fastener-hook-eye',
        category: 'fasteners-hardware',
        materialName: 'Hook & Eye Waist Closure Set',
        specification: `Sew-on stainless bar & hook | Source: ${feat.name}`,
        unit: 'sets',
        basis: 'calculated',
        calculatedBaseQuantityPerGarment: 1,
        allowanceQuantityPerGarment: 0,
        totalQuantityPerGarment: 1,
        totalOrderQuantity: totalOrderGarments,
        wasteFactorApplied: 0,
        calculationFormula: `1 set per garment from construction feature "${feat.name}"`,
        traceablePieceIds: [...allSelfPieceIds],
        traceableFeatureIds: [feat.name],
        supplierData: resolveSupplier('bom-fastener-hook-eye')
      });
    }
  }

  // 6. Labels & Packaging (Only when explicitly requested)
  if (opts.includeLabelsAndPackaging) {
    lineItems.push({
      itemId: 'bom-labels-packaging-set',
      category: 'labels-packaging',
      materialName: 'Woven Care, Size & Brand Label + Garment Sleeve Set',
      specification: '1 main brand label + 1 size tab + 1 ISO care/fiber composition label + recyclable kraft sleeve',
      unit: 'sets',
      basis: 'configured-allowance',
      calculatedBaseQuantityPerGarment: 1,
      allowanceQuantityPerGarment: 0,
      totalQuantityPerGarment: 1,
      totalOrderQuantity: totalOrderGarments,
      wasteFactorApplied: 0,
      calculationFormula: '1 packaging/labeling set per garment unit requested',
      traceablePieceIds: [],
      traceableFeatureIds: ['packaging-spec'],
      supplierData: resolveSupplier('bom-labels-packaging-set')
    });
  }

  if (sizeBreakdowns.length === 0) {
    warnings.push('No pattern piece size sets provided to compute BOM yields.');
  }

  return {
    schemaVersion: M05_PRODUCTION_PACKAGE_SCHEMA_VERSION,
    fabricName: input.designSpec.fabric.name,
    fabricComposition: input.designSpec.fabric.composition,
    fabricRollWidthCm: rollWidthCm,
    usableFabricWidthCm: usableWidthCm,
    markerWasteFactor,
    threadWastageFactor,
    orderQuantityBasis,
    totalOrderGarments,
    sizeBreakdowns,
    lineItems,
    totalMainFabricMetersForOrder: round3(sumSelfMetersWithWasteTotalOrder),
    totalLiningMetersForOrder: round3(sumLiningMetersTotalOrder),
    totalInterfacingMetersForOrder: round3(sumInterfacingMetersTotalOrder),
    totalThreadMetersForOrder: round3(sumThreadMetersTotalOrder),
    warnings,
    isProductionReady: false
  };
}
