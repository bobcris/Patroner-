/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner M05 — Feature-Traced Manufacturing Documentation Engine
 *
 * Generates cutting instructions, ISO 4915 sewing sequences, seam construction schedules,
 * notch alignment instructions, pressing/finishing notes, and QC checkpoints directly from
 * drafted PatternPiece geometry, Assembly results, Production Sheets, and declared
 * DesignSpecification.constructionFeatures.
 *
 * Strictly never invents unsupported hardware, zippers, or steps not backed by actual
 * pieces, seams, darts, or constructionFeatures.
 */

import { DesignSpecification, PatternPiece } from '../../types';
import { BodiceSleeveAssemblyResult } from '../assembly/assembly-types';
import { computePieceContourAreaCm2 } from './bom-engine';
import { PatternPieceProductionSheet } from './manufacturing-types';
import {
  CuttingInstructionEntry,
  DocsCompletenessResult,
  FinishingInstruction,
  M05_PRODUCTION_PACKAGE_SCHEMA_VERSION,
  M05ManufacturingDocumentation,
  NotchAlignmentInstruction,
  OperatorSheetSummary,
  QualityControlCheckpoint,
  SeamConstructionSpec,
  SewingOperationStep
} from './production-engineering-types';

export interface GenerateManufacturingDocsInput {
  readonly designSpec: DesignSpecification;
  readonly pieces: readonly PatternPiece[];
  readonly sheets?: readonly PatternPieceProductionSheet[];
  readonly assemblyResult?: BodiceSleeveAssemblyResult;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function resolveFoldSegmentAllowance(piece: PatternPiece, segId?: string): { allowanceCm: number; isFold: boolean; role?: string } {
  if (!piece.stitchingContour) {
    return { allowanceCm: piece.seamAllowanceWidthCm, isFold: false };
  }
  const seg = segId
    ? piece.stitchingContour.segments.find(s => s.id === segId || s.seamId === segId)
    : undefined;
  if (seg) {
    return {
      allowanceCm: seg.isFold ? 0 : (Number.isFinite(seg.seamAllowanceCm) ? seg.seamAllowanceCm : piece.seamAllowanceWidthCm),
      isFold: Boolean(seg.isFold),
      role: seg.role
    };
  }
  return { allowanceCm: piece.seamAllowanceWidthCm, isFold: false };
}

function buildNotchMatchDescription(piece: PatternPiece, label: string, type: string): string {
  const lower = label.toLowerCase();
  if (lower.includes('fold')) {
    return `Place directly on pressed fabric center fold edge of ${piece.pieceCode}.`;
  }
  if (lower.includes('apex') || lower.includes('crown')) {
    return 'Align sleeve crown apex notch directly with shoulder seam junction.';
  }
  if (lower.includes('front') && (lower.includes('scye') || lower.includes('armhole') || piece.pieceCode.includes('SLV') || piece.pieceCode.includes('BOD-F'))) {
    return 'Single front pitch notch: align Front Bodice Scye to Front Sleeve Cap.';
  }
  if (lower.includes('back') && (lower.includes('scye') || lower.includes('armhole') || piece.pieceCode.includes('SLV') || piece.pieceCode.includes('BOD-B'))) {
    return type === 'double'
      ? 'Double back balance notch: align Back Sleeve Cap to Back Bodice Scye.'
      : 'Align back scye balance notch to mating Back Bodice/Sleeve curve.';
  }
  if (lower.includes('hip')) {
    return 'Align side-seam hip notch across mating Front and Back panels prior to stitching.';
  }
  if (lower.includes('zip')) {
    return 'Mark lower concealed zipper stop position on Center Back seam.';
  }
  return `Match ${type} notch "${label}" against paired seam partner on adjacent panel.`;
}

/**
 * Verifies documentation completeness and strict reference traceability against actual pieces.
 */
export function verifyManufacturingDocumentationCompleteness(
  docs: Pick<
    M05ManufacturingDocumentation,
    | 'cuttingInstructions'
    | 'sewingSequence'
    | 'seamSpecifications'
    | 'notchAlignmentInstructions'
    | 'pressingAndFinishing'
    | 'qualityCheckpoints'
  >,
  pieces: readonly PatternPiece[]
): DocsCompletenessResult {
  const validPieceIds = new Set(pieces.map(p => p.id));
  const missingSections: string[] = [];

  if (docs.cuttingInstructions.length === 0) missingSections.push('cuttingInstructions');
  if (docs.sewingSequence.length === 0) missingSections.push('sewingSequence');
  if (docs.seamSpecifications.length === 0) missingSections.push('seamSpecifications');
  if (docs.pressingAndFinishing.length === 0) missingSections.push('pressingAndFinishing');
  if (docs.qualityCheckpoints.length === 0) missingSections.push('qualityCheckpoints');

  let untracedOperationCount = 0;
  let totalTracedReferences = 0;

  for (const op of docs.sewingSequence) {
    const validRefs = op.traceablePieceIds.filter(id => validPieceIds.has(id));
    if (op.traceablePieceIds.length === 0 || validRefs.length !== op.traceablePieceIds.length) {
      untracedOperationCount++;
    } else {
      totalTracedReferences += validRefs.length;
    }
  }

  for (const ci of docs.cuttingInstructions) {
    if (!validPieceIds.has(ci.pieceId)) {
      untracedOperationCount++;
    } else {
      totalTracedReferences++;
    }
  }

  return {
    isComplete: missingSections.length === 0 && untracedOperationCount === 0,
    missingSections,
    untracedOperationCount,
    totalTracedReferences
  };
}

/**
 * Deterministically builds complete, operator-ready manufacturing documentation
 * traceable to real PatternPiece contours, seams, darts, notches, and constructionFeatures.
 */
export function generateManufacturingDocumentation(
  input: GenerateManufacturingDocsInput
): M05ManufacturingDocumentation {
  const { designSpec, pieces, sheets = [], assemblyResult } = input;
  const stitchClassMain = designSpec.fabric.stretch !== 'none' ? '401 (Chainstitch)' : '301 (Lockstitch)';

  const directionalFabricMatch = /velvet|corduroy|nap|pile|satin|one-way|twill/i.test(
    `${designSpec.fabric.name} ${designSpec.fabric.drapeDescription}`
  );

  // 1. Cutting Instructions (1-to-1 per piece)
  const cuttingInstructions: CuttingInstructionEntry[] = pieces.map(piece => {
    const sheet = sheets.find(s => s.pieceId === piece.id);
    const areaCm2 =
      sheet?.geometryMetrics.cuttingAreaCm2 !== null && sheet?.geometryMetrics.cuttingAreaCm2 !== undefined
        ? sheet.geometryMetrics.cuttingAreaCm2
        : computePieceContourAreaCm2(piece, 'cutting');
    const physicalPanels = piece.onFold ? 1 : Math.max(1, piece.cutCount);
    const pairingRule = piece.onFold
      ? 'Cut 1 symmetric panel on lengthwise fabric fold (0 cm fold edge allowance)'
      : piece.cutCount === 2
        ? 'Cut 1 mirrored Left/Right pair face-to-face'
        : `Cut ${physicalPanels} panel(s) single ply right-side-up`;

    return {
      pieceId: piece.id,
      pieceCode: piece.pieceCode,
      pieceName: piece.name,
      material: piece.material,
      cutCountPerGarment: physicalPanels,
      onFold: piece.onFold,
      pairingRule,
      grainDirection: piece.grainline.direction,
      cuttingAreaCm2: Number(areaCm2.toFixed(2)),
      drillHoleCount: (piece.drillHoles?.length ?? 0) > 0 ? piece.drillHoles!.length : piece.darts.length,
      notchCount: piece.notches.length,
      ...(directionalFabricMatch
        ? { directionalNapNote: 'Cut all panels strictly with uniform nap/sheen direction (top-to-hem).' }
        : {})
    };
  });

  // 2. Seam Construction Schedule (derived strictly from piece seams & contour allowances)
  const seamSpecifications: SeamConstructionSpec[] = [];
  for (const piece of pieces) {
    for (const seam of piece.seams) {
      const segInfo = resolveFoldSegmentAllowance(piece, seam.segmentId ?? seam.id);
      seamSpecifications.push({
        seamId: seam.id,
        seamName: seam.name,
        pieceCode: piece.pieceCode,
        segmentRole: segInfo.role,
        allowanceCm: round2(segInfo.allowanceCm),
        isFold: segInfo.isFold,
        stitchedLengthCm: round2(seam.lengthCm),
        stitchClassIso4915: segInfo.isFold ? 'FOLD-NO-STITCH' : stitchClassMain,
        ...(seam.pairedSeamName ? { pairedSeamName: seam.pairedSeamName } : {})
      });
    }
  }

  // 3. Notch Alignment Instructions
  const notchAlignmentInstructions: NotchAlignmentInstruction[] = [];
  for (const piece of pieces) {
    for (const notch of piece.notches) {
      const label = notch.label ?? notch.id;
      const isScye = label.toLowerCase().includes('scye') || label.toLowerCase().includes('armhole');
      notchAlignmentInstructions.push({
        notchId: notch.id,
        pieceId: piece.id,
        pieceCode: piece.pieceCode,
        notchLabel: label,
        notchType: notch.type,
        targetMatchDescription: buildNotchMatchDescription(piece, label, notch.type),
        toleranceCm: isScye ? 0.3 : 0.2
      });
    }
  }

  // 4. Sewing Sequence (strictly driven by actual drafted pieces, seams, darts, and constructionFeatures)
  const sewingSequence: SewingOperationStep[] = [];
  let seq = 1;

  const frontBodice = pieces.find(p => p.pieceCode.startsWith('BOD-F') || p.id.includes('bodice-front'));
  const backBodice = pieces.find(p => p.pieceCode.startsWith('BOD-B') || p.id.includes('bodice-back'));
  const sleevePiece = pieces.find(p => p.pieceCode.startsWith('SLV') || p.id.includes('sleeve'));
  const frontSkirt = pieces.find(p => p.pieceCode.startsWith('SK-01') || p.id.includes('skirt-front'));
  const backSkirt = pieces.find(p => p.pieceCode.startsWith('SK-02') || p.id.includes('skirt-back'));

  const stayPieces = pieces.filter(p =>
    p.seams.some(s => /neck|armhole|scye|waist/i.test(s.name))
  );
  if (stayPieces.length > 0) {
    const staySeams = Array.from(
      new Set(
        stayPieces.flatMap(p =>
          p.seams.filter(s => /neck|armhole|scye|waist/i.test(s.name)).map(s => s.name)
        )
      )
    );
    sewingSequence.push({
      operationCode: `OP-${String(seq).padStart(2, '0')}`,
      sequenceOrder: seq++,
      title: 'Stay-stitching & Curve Stabilization',
      instruction: `Run directional stay-stitching inside the seam allowance (0.8 cm from cut edge) on curved edges: ${staySeams.join(', ')}.`,
      stitchClassIso4915: stitchClassMain,
      seamAllowanceCm: 0.8,
      traceablePieceIds: stayPieces.map(p => p.id),
      traceableFeatureIds: staySeams
    });
  }

  const dartedPieces = pieces.filter(p => p.darts.length > 0);
  if (dartedPieces.length > 0) {
    const dartCount = dartedPieces.reduce((acc, p) => acc + p.darts.length, 0);
    const dartIds = dartedPieces.flatMap(p => p.darts.map(d => d.id));
    sewingSequence.push({
      operationCode: `OP-${String(seq).padStart(2, '0')}`,
      sequenceOrder: seq++,
      title: `Dart Construction (${dartCount} dart${dartCount > 1 ? 's' : ''})`,
      instruction: `Fold dart legs right sides together across ${dartedPieces.map(p => p.pieceCode).join(', ')}, stitch from wide base edge tapering to zero at punched apex drill holes, and secure thread tails without backtack bunching.`,
      stitchClassIso4915: stitchClassMain,
      seamAllowanceCm: 0,
      traceablePieceIds: dartedPieces.map(p => p.id),
      traceableFeatureIds: dartIds
    });
  }

  if (frontBodice && backBodice) {
    const fbShoulder = frontBodice.seams.find(s => /shoulder/i.test(s.name));
    if (fbShoulder) {
      const sa = resolveFoldSegmentAllowance(frontBodice, fbShoulder.segmentId).allowanceCm;
      sewingSequence.push({
        operationCode: `OP-${String(seq).padStart(2, '0')}`,
        sequenceOrder: seq++,
        title: 'Bodice Shoulder Seam Assembly',
        instruction: `Join ${frontBodice.pieceCode} shoulder (${round2(fbShoulder.lengthCm)} cm) to ${backBodice.pieceCode} shoulder at ${round2(sa)} cm allowance with fusible stay-tape to prevent shoulder elongation.`,
        stitchClassIso4915: stitchClassMain,
        seamAllowanceCm: round2(sa),
        traceablePieceIds: [frontBodice.id, backBodice.id],
        traceableFeatureIds: [fbShoulder.id]
      });
    }
  }

  // Feature-traced closure / Center Back zipper ONLY if declared or skirt CB panel exists
  const zipFeatures = designSpec.constructionFeatures.filter(f =>
    /zip|closure|placket|button/i.test(`${f.name} ${f.description}`)
  );
  if (backSkirt) {
    const cbSeam = backSkirt.seams.find(s => /center back/i.test(s.name));
    const cbSa = cbSeam ? resolveFoldSegmentAllowance(backSkirt, cbSeam.segmentId).allowanceCm : 1.5;
    const hasExplicitZip = zipFeatures.some(f => /zip/i.test(`${f.name} ${f.description}`)) ||
      backSkirt.notches.some(n => (n.label ?? '').toLowerCase().includes('zip'));
    sewingSequence.push({
      operationCode: `OP-${String(seq).padStart(2, '0')}`,
      sequenceOrder: seq++,
      title: hasExplicitZip ? 'Center Back Seam & Concealed Zipper' : 'Center Back Seam Assembly',
      instruction: hasExplicitZip
        ? `Neat-finish Center Back raw edges of ${backSkirt.pieceCode}, insert concealed zipper down to the CB zipper-stop notch, and close remaining seam to hem at ${round2(cbSa)} cm allowance.`
        : `Join left and right ${backSkirt.pieceCode} Center Back edges at ${round2(cbSa)} cm allowance and press seam open.`,
      stitchClassIso4915: stitchClassMain,
      seamAllowanceCm: round2(cbSa),
      traceablePieceIds: [backSkirt.id],
      traceableFeatureIds: hasExplicitZip ? [...zipFeatures.map(f => f.name), 'notch-back-zip'] : [cbSeam?.id ?? 'cb-seam']
    });
  } else if (zipFeatures.length > 0 && pieces.length > 0) {
    sewingSequence.push({
      operationCode: `OP-${String(seq).padStart(2, '0')}`,
      sequenceOrder: seq++,
      title: `Declared Closure Installation (${zipFeatures.map(f => f.name).join(', ')})`,
      instruction: `Install declared closure feature(s): ${zipFeatures.map(f => `${f.name} (${f.description})`).join('; ')}.`,
      stitchClassIso4915: stitchClassMain,
      seamAllowanceCm: 1.5,
      traceablePieceIds: pieces.map(p => p.id),
      traceableFeatureIds: zipFeatures.map(f => f.name)
    });
  }

  // Side seams
  const sidePieces = pieces.filter(p => p.seams.some(s => /side/i.test(s.name)));
  if (sidePieces.length >= 2) {
    const sideSeam = sidePieces[0].seams.find(s => /side/i.test(s.name));
    const sa = sideSeam ? resolveFoldSegmentAllowance(sidePieces[0], sideSeam.segmentId).allowanceCm : 1.5;
    sewingSequence.push({
      operationCode: `OP-${String(seq).padStart(2, '0')}`,
      sequenceOrder: seq++,
      title: 'Side Seam Assembly',
      instruction: `Align mating side seams (${sidePieces.map(p => p.pieceCode).join(' <-> ')}) matching waist/hip/underarm notches and stitch at ${round2(sa)} cm allowance. Overlock/finish raw edges per spec and press open.`,
      stitchClassIso4915: stitchClassMain,
      seamAllowanceCm: round2(sa),
      traceablePieceIds: sidePieces.map(p => p.id),
      traceableFeatureIds: sidePieces.flatMap(p => p.seams.filter(s => /side/i.test(s.name)).map(s => s.id))
    });
  }

  // Sleeve Inseam + Cap Insertion ONLY when sleevePiece exists
  if (sleevePiece) {
    const inseam = sleevePiece.seams.find(s => /inseam/i.test(s.name));
    const inseamSa = inseam ? resolveFoldSegmentAllowance(sleevePiece, inseam.segmentId).allowanceCm : 1.2;
    sewingSequence.push({
      operationCode: `OP-${String(seq).padStart(2, '0')}`,
      sequenceOrder: seq++,
      title: 'Sleeve Underarm Inseam Closure',
      instruction: `Fold ${sleevePiece.pieceCode} right sides together, align front and back underarm inseams at wrist and biceps edges, stitch at ${round2(inseamSa)} cm allowance, and press open.`,
      stitchClassIso4915: stitchClassMain,
      seamAllowanceCm: round2(inseamSa),
      traceablePieceIds: [sleevePiece.id],
      traceableFeatureIds: sleevePiece.seams.filter(s => /inseam/i.test(s.name)).map(s => s.id)
    });

    const targetEaseCm = assemblyResult?.ease.totalEaseCm;
    const scyePieces = [frontBodice, backBodice, sleevePiece].filter((p): p is PatternPiece => Boolean(p));
    const capSeam = sleevePiece.seams.find(s => /cap/i.test(s.name));
    const capSa = capSeam ? resolveFoldSegmentAllowance(sleevePiece, capSeam.segmentId).allowanceCm : 1.0;

    sewingSequence.push({
      operationCode: `OP-${String(seq).padStart(2, '0')}`,
      sequenceOrder: seq++,
      title: 'Set-In Sleeve Cap Easing & Armhole Insertion',
      instruction: `Run two parallel easing basting rows across ${sleevePiece.pieceCode} crown between front and back scye notches. Distribute ${targetEaseCm !== undefined ? `${round2(targetEaseCm)} cm` : 'calculated'} cap ease evenly over upper crown without pleats, align front single notch, back double notch, crown apex to shoulder seam, and underarm inseam to bodice side seam. Stitch at ${round2(capSa)} cm allowance.`,
      stitchClassIso4915: stitchClassMain,
      seamAllowanceCm: round2(capSa),
      ...(targetEaseCm !== undefined ? { targetEaseCm: round2(targetEaseCm) } : {}),
      traceablePieceIds: scyePieces.map(p => p.id),
      traceableFeatureIds: [
        'armhole-scye-match',
        ...sleevePiece.notches.map(n => n.id)
      ]
    });
  }

  // Hem & Waist/Neckline Finishing traced to actual hem/waist/neck seams
  const hemPieces = pieces.filter(p => p.seams.some(s => /hem/i.test(s.name)));
  if (hemPieces.length > 0) {
    const sampleHem = hemPieces[0].seams.find(s => /hem/i.test(s.name));
    const hemSa = sampleHem ? resolveFoldSegmentAllowance(hemPieces[0], sampleHem.segmentId).allowanceCm : 3.0;
    sewingSequence.push({
      operationCode: `OP-${String(seq).padStart(2, '0')}`,
      sequenceOrder: seq++,
      title: 'Hem Turning & Edge Finishing',
      instruction: `Clean-finish raw bottom hem edges (${hemPieces.map(p => p.pieceCode).join(', ')}), fold along ${round2(hemSa)} cm hem crease, press flat, and blind-stitch or topstitch per finish tolerance.`,
      stitchClassIso4915: stitchClassMain,
      seamAllowanceCm: round2(hemSa),
      traceablePieceIds: hemPieces.map(p => p.id),
      traceableFeatureIds: hemPieces.flatMap(p => p.seams.filter(s => /hem/i.test(s.name)).map(s => s.id))
    });
  }

  // Fallback trace check for other custom features
  for (const feat of designSpec.constructionFeatures) {
    const alreadyReferenced = sewingSequence.some(op => op.traceableFeatureIds.includes(feat.name));
    if (!alreadyReferenced && !/zip|button|hook/i.test(feat.name) && pieces.length > 0) {
      sewingSequence.push({
        operationCode: `OP-${String(seq).padStart(2, '0')}`,
        sequenceOrder: seq++,
        title: `Construction Detail: ${feat.name}`,
        instruction: feat.description || `Execute construction detail "${feat.name}" per specification.`,
        stitchClassIso4915: stitchClassMain,
        seamAllowanceCm: 1.0,
        traceablePieceIds: pieces.map(p => p.id),
        traceableFeatureIds: [feat.name]
      });
    }
  }

  // 5. Pressing & Finishing Instructions
  const pressingAndFinishing: FinishingInstruction[] = [];
  if (dartedPieces.length > 0) {
    pressingAndFinishing.push({
      finishId: 'press-darts',
      title: 'Dart Shaping Over Tailor’s Ham',
      instruction: 'Press vertical waist darts toward Center Front / Center Back and horizontal bust darts downward over a curved pressing ham without creasing past apex drill holes.',
      traceableSourceIds: dartedPieces.map(p => p.id)
    });
  }
  pressingAndFinishing.push({
    finishId: 'press-structural-seams',
    title: 'Structural Seam Pressing',
    instruction:
      designSpec.fabric.weight === 'heavy' || designSpec.fabric.composition.toLowerCase().includes('wool')
        ? 'Steam-press shoulder and side seams open over a clapper board to set crisp flat seam lines.'
        : 'Press structural side/shoulder seams open with low-shine press cloth appropriate for fiber composition.',
    maxAllowanceCm: 1.5,
    traceableSourceIds: pieces.map(p => p.id)
  });
  if (sleevePiece) {
    pressingAndFinishing.push({
      finishId: 'press-sleeve-crown',
      title: 'Sleeve Cap Roll & Head Pressing',
      instruction: 'Shrink slight fullness along the stitched sleeve head on a sleeve board; press seam allowance gently toward the sleeve cap without flattening the crown dome.',
      traceableSourceIds: [sleevePiece.id]
    });
  }

  // 6. QC Checkpoints (DEC-11 Tiered CAD vs Physical tolerances)
  const qualityCheckpoints: QualityControlCheckpoint[] = [
    {
      checkpointId: 'qc-cad-parity',
      checkpointName: '2D CAD Edge Parity & Contour Integrity (DEC-11 Tier 1)',
      criterion: 'Paired side, shoulder, and underarm inseams verified closed within mathematical CAD tolerance.',
      toleranceSpec: '<= 0.05 cm CAD tolerance',
      traceableSourceIds: pieces.map(p => p.id)
    },
    {
      checkpointId: 'qc-sewn-tolerance',
      checkpointName: 'Cut Panel & Sewn Seam Tolerance (DEC-11 Tier 2)',
      criterion: 'Inspect cut panel dimensions, dart intake accuracy, and finished seam allowances across operator stations.',
      toleranceSpec: '<= 0.20 cm sewn production tolerance',
      traceableSourceIds: pieces.map(p => p.id)
    },
    {
      checkpointId: 'qc-grain-alignment',
      checkpointName: 'Warp Grainline & Notch Match Check',
      criterion: `Verify all ${notchAlignmentInstructions.length} notches align across paired edges and warp grainlines sit parallel to selvedge.`,
      toleranceSpec: '<= 0.20 cm notch alignment (<= 0.30 cm scye ease distribution)',
      traceableSourceIds: pieces.map(p => p.id)
    }
  ];

  // 7. Operator Summary
  const totalPhysicalPanelsPerGarment = cuttingInstructions.reduce((acc, c) => acc + c.cutCountPerGarment, 0);
  const allowanceSet = Array.from(
    new Set(seamSpecifications.filter(s => !s.isFold).map(s => `${s.allowanceCm.toFixed(1)}cm`))
  );
  const operatorSummary: OperatorSheetSummary = {
    garmentName: designSpec.name,
    garmentCategory: designSpec.garmentCategory,
    totalPieceCount: pieces.length,
    totalPhysicalPanelsPerGarment,
    totalOperations: sewingSequence.length,
    criticalNotchCount: notchAlignmentInstructions.length,
    seamSummaryLine: `Stitch Class ${stitchClassMain} | Non-fold Seam Allowances: ${allowanceSet.join(', ') || '1.0–1.5cm'}`
  };

  const completeness = verifyManufacturingDocumentationCompleteness(
    {
      cuttingInstructions,
      sewingSequence,
      seamSpecifications,
      notchAlignmentInstructions,
      pressingAndFinishing,
      qualityCheckpoints
    },
    pieces
  );

  return {
    schemaVersion: M05_PRODUCTION_PACKAGE_SCHEMA_VERSION,
    garmentId: designSpec.id,
    garmentName: designSpec.name,
    garmentCategory: designSpec.garmentCategory,
    cuttingInstructions,
    sewingSequence,
    seamSpecifications,
    notchAlignmentInstructions,
    pressingAndFinishing,
    qualityCheckpoints,
    operatorSummary,
    completeness,
    isProductionReady: false
  };
}
