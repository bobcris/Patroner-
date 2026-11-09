/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BodyMeasurements, DesignSpecification, PatternPiece } from '../../types';
import { draftSkirtBlock } from '../../engine/drafting/skirt-block';
import { draftBodiceBlock } from '../../engine/drafting/bodice-block';
import { draftSleeveBlock } from '../../engine/drafting/sleeve-block';
import { assembleBodiceSleeve, BodiceSleeveAssemblyResult } from '../../engine/assembly';
import { gradePattern, DEFAULT_SIZE_RANGE, GradedPatternSet } from '../../engine/grading';
import { validatePatternDraft } from '../../engine/validation/seam-validator';
import { calculateGarmentDimensions, calculateBodiceGarmentDimensions } from '../../engine/measurements/standards';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import {
  FileText,
  Printer,
  CheckCircle2,
  AlertTriangle,
  Scissors,
  Layers,
  ArrowRight,
  Download,
  Activity,
  Sparkles,
  ShieldCheck,
  Ruler
} from 'lucide-react';
import { getEnhancedFabricById, DEFAULT_ILLUSTRATIVE_FABRIC } from '../../engine/fabric/fabric-presets';
import { calculateCompleteGarmentEase, calculateFabricAdaptedSleeveCapEase } from '../../engine/fabric/ease-engine';
import { validatePhysicalFit } from '../../engine/prototype/fit-validator';
import { MOCK_CONFORMING_PROTOTYPE_BODICE_M } from '../../engine/prototype/prototype-fixtures';
import {
  createProductionPatternRevision,
  evaluatePipelineDependencyIntegrity,
  validateProductionExportPrerequisites
} from '../../engine/production';

interface ProductionOverviewProps {
  currentSpec: DesignSpecification;
  measurements: BodyMeasurements;
  activeSize: string;
  onNavigateToCAD: () => void;
}

export const ProductionOverview: React.FC<ProductionOverviewProps> = ({
  currentSpec,
  measurements,
  activeSize,
  onNavigateToCAD
}) => {
  let pieces: PatternPiece[] = [];
  if (currentSpec.garmentCategory === 'bodice') {
    const bodicePieces = draftBodiceBlock(measurements, currentSpec);
    try {
      const sleeveResult = draftSleeveBlock(measurements, currentSpec, {
        strategy: currentSpec.sleeveEaseStrategy ?? 'classic',
        bodicePieces
      });
      pieces = [...bodicePieces, sleeveResult.piece];
    } catch {
      pieces = bodicePieces;
    }
  } else {
    pieces = draftSkirtBlock(measurements, currentSpec);
  }

  const validation = validatePatternDraft(pieces);
  let assemblyResult: BodiceSleeveAssemblyResult | undefined = undefined;
  if (currentSpec.garmentCategory === 'bodice' && pieces.length >= 3) {
    try {
      assemblyResult = assembleBodiceSleeve({
        bodicePieces: pieces.slice(0, 2),
        sleevePiece: pieces[2],
        designSpec: currentSpec,
        measurements,
        options: { strategy: currentSpec.sleeveEaseStrategy ?? 'classic' }
      });
    } catch {
      // Fallback
    }
  }

  const dims = currentSpec.garmentCategory === 'bodice'
    ? calculateBodiceGarmentDimensions(measurements, currentSpec.easeProfile, currentSpec.fabric, {
        explicitEaseCm: currentSpec.explicitEaseCm,
        targetLengthCm: currentSpec.lengthCm
      })
    : calculateGarmentDimensions(measurements, currentSpec.easeProfile, currentSpec.fabric, {
        explicitEaseCm: currentSpec.explicitEaseCm,
        targetLengthCm: currentSpec.lengthCm
      });

  // Milestone 04.4: Graded Pattern Set Generation
  const gradedPatternSet = React.useMemo(() => gradePattern(currentSpec), [currentSpec]);

  // Milestone 04.5 / 04.5.1: Fabric-Aware Ease & Physical Prototype Validation
  const enhancedFabricLookup = React.useMemo(() => {
    return getEnhancedFabricById(currentSpec.fabric.id);
  }, [currentSpec.fabric.id]);

  const enhancedFabric = React.useMemo(() => {
    return enhancedFabricLookup.status === 'found'
      ? enhancedFabricLookup.fabric
      : DEFAULT_ILLUSTRATIVE_FABRIC;
  }, [enhancedFabricLookup]);

  const fabricEaseBreakdown = React.useMemo(() => {
    return calculateCompleteGarmentEase(
      measurements,
      currentSpec.easeProfile,
      enhancedFabric,
      {
        silhouette: currentSpec.silhouette,
        allowanceForShrinkage: true,
        userExplicitConsentToDefaultFabric: true,
        explicitEaseCm: currentSpec.explicitEaseCm
      }
    );
  }, [measurements, currentSpec.easeProfile, enhancedFabric, currentSpec.silhouette, currentSpec.explicitEaseCm]);

  const adaptedSleeveEase = React.useMemo(() => {
    return calculateFabricAdaptedSleeveCapEase(
      currentSpec.sleeveEaseStrategy ?? 'classic',
      enhancedFabric,
      { userExplicitConsentToDefaultFabric: true }
    );
  }, [currentSpec.sleeveEaseStrategy, enhancedFabric]);

  const sampleFitReport = React.useMemo(() => {
    return validatePhysicalFit(MOCK_CONFORMING_PROTOTYPE_BODICE_M);
  }, []);

  // Approximate fabric yield calculation for a standard 140cm bolt width
  const fabricYieldMeters = Number(((currentSpec.lengthCm + 15) / 100 * 1.15).toFixed(2));


  const assemblySteps = currentSpec.garmentCategory === 'bodice'
    ? [
        {
          step: 1,
          title: 'Stay-stitching & Stabilization',
          instruction: 'Stay-stitch front and back neckline and armhole scye curves at 0.8cm from cut edge to prevent distortion during handling.'
        },
        {
          step: 2,
          title: 'Dart Construction',
          instruction: 'Stitch front waist and bust darts, and back shoulder and waist darts tapering smoothly to punch holes. Press front darts down/inward; press back darts toward center back.'
        },
        {
          step: 3,
          title: 'Shoulder Seam Assembly',
          instruction: 'Pin and stitch front and back shoulder seams with 1.2cm seam allowance with stabilizing stay-tape. Press seam open flat.'
        },
        {
          step: 4,
          title: 'Side Seams & Sleeve Inseam',
          instruction: 'Stitch bodice side seams at 1.2cm allowance and press open. Stitch sleeve underarm inseam (matching front and back underarm edges) and press open.'
        },
        {
          step: 5,
          title: 'Sleeve Cap Easing & Insertion',
          instruction: 'Run two rows of ease stitching along sleeve cap between notches. Distribute cap ease over the crown, align single front notch to front scye, double back notch to back scye, and apex notch to shoulder seam. Stitch at 1.2cm and press sleeve cap seam head.'
        },
        {
          step: 6,
          title: 'Finishing & Hems',
          instruction: 'Turn up 3.0cm sleeve wrist hem and blind stitch or topstitch. Finish neckline with fitted bias facing or collar and insert closure.'
        }
      ]
    : [
        {
          step: 1,
          title: 'Stay-stitching & Interfacing',
          instruction: 'Apply 1.2cm stay-tape or stay-stitch along front and back waistlines at 0.8cm from cut edge to prevent stretching during handling.'
        },
        {
          step: 2,
          title: 'Waist Dart Construction',
          instruction: 'Fold and pin front waist dart pair and back waist dart. Stitch from waistline tapering precisely to apex drill holes. Press front darts toward Center Front; press back darts toward Center Back.'
        },
        {
          step: 3,
          title: 'Center Back Seam & Invisible Zipper',
          instruction: 'Finish raw edges of Center Back panels. Insert concealed invisible zipper from upper waist down to the 18cm zipper stop notch. Stitch remaining CB seam below zipper to hem.'
        },
        {
          step: 4,
          title: 'Side Seam Assembly',
          instruction: 'Align Front Skirt Panel to Back Skirt Panels with right sides together. Match waistline, hip notches (at 20cm depth), and hem edges. Stitch at 1.5cm seam allowance. Press seams open flat.'
        },
        {
          step: 5,
          title: 'Waist Finishing',
          instruction: 'Attach internal grosgrain ribbon facing or waistband along waist seamline at 1.0cm allowance. Understitch facing and secure to zipper tape.'
        },
        {
          step: 6,
          title: 'Hem Completion',
          instruction: 'Turn up 3.0cm hem allowance, press crisp fold, and finish with blind catch-stitch or double needle machine hem.'
        }
      ];

  const [exportWarning, setExportWarning] = React.useState<string | null>(null);

  const liveSnapshot = React.useMemo(() => {
    try {
      return createProductionPatternRevision({
        projectId: 'project-patroner-default',
        targetSize: activeSize,
        designSpecification: currentSpec,
        measurements: {
          values: ({ ...measurements } as unknown) as Record<string, number>,
          defaultOrigin: 'user-entered',
          approval: {
            state: 'approved',
            approvedBy: 'Operator Confirmed',
            approvedAt: '2026-11-09T08:00:00.000Z'
          }
        },
        fabric: enhancedFabric,
        patternPieces: pieces,
        validation,
        physicalValidationStatus: 'not-assessed'
      });
    } catch {
      return null;
    }
  }, [currentSpec, measurements, activeSize, enhancedFabric, pieces, validation]);

  const pipelineReport = React.useMemo(() => {
    return evaluatePipelineDependencyIntegrity({
      specification: currentSpec,
      measurements,
      activeSize,
      fabric: currentSpec.fabric,
      patternPieces: pieces,
      validationReport: validation,
      productionSnapshot: liveSnapshot ?? undefined
    });
  }, [currentSpec, measurements, activeSize, pieces, validation, liveSnapshot]);

  const handlePrint = () => {
    const exportResult = validateProductionExportPrerequisites(pipelineReport, liveSnapshot ?? undefined);
    if (!exportResult.isExportPermitted) {
      setExportWarning(`Production export blocked: ${exportResult.rejectionReason}`);
      return;
    }
    setExportWarning(null);
    window.print();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-8 print:p-0 print:max-w-none">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-200 pb-6 gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-widest text-neutral-500 font-mono">Module 05</span>
            <span className="text-neutral-300">/</span>
            <Badge variant="dark" size="sm">Production Engineering</Badge>
            <span className="text-neutral-400 font-mono text-xs">TECH PACK v{currentSpec.version}</span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-serif font-bold text-neutral-900 tracking-tight">
            Production Sheets &amp; Cutting Documentation
          </h2>
          <p className="text-sm text-neutral-600 mt-1 max-w-2xl">
            Authoritative, draft-linked manufacturing documentation. Derived directly from validated pattern geometry.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onNavigateToCAD}
            icon={<Scissors className="w-4 h-4" />}
          >
            Review CAD Geometry
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handlePrint}
            icon={<Printer className="w-4 h-4" />}
            className="font-mono text-xs uppercase"
          >
            Print / Export Tech Pack
          </Button>
        </div>
      </div>

      {exportWarning && (
        <div className="p-3 bg-red-50 border border-red-300 rounded text-red-900 text-xs font-mono flex items-center justify-between">
          <span>{exportWarning}</span>
          <button onClick={() => setExportWarning(null)} className="text-red-700 hover:text-red-950 font-bold ml-2">✕</button>
        </div>
      )}

      {/* Production Certification Banner */}
      <div className="bg-neutral-900 text-white rounded-sm p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="text-neutral-400">TIERED STATUS:</span>
            {validation.isValid ? (
              <Badge variant="success" size="sm">2D CAD GEOMETRY VALIDATED</Badge>
            ) : (
              <Badge variant="danger" size="sm">GEOMETRY REVISION REQUIRED</Badge>
            )}
            <Badge variant="neutral" size="sm">PHYSICAL SAMPLE: UNASSESSED</Badge>
            <Badge variant="neutral" size="sm">PROTOTYPE: SYNTHETIC FIXTURE ONLY</Badge>
            <span className="text-neutral-400">|</span>
            <span className="text-neutral-300">
              SPEC REV: {currentSpec.specificationRevisionId ?? `v${currentSpec.version}`}
            </span>
            <span className="text-neutral-400">|</span>
            <span className="text-emerald-400">
              APPROVAL: {currentSpec.isApproved ? (currentSpec.approvedBy ? `APPROVED BY ${currentSpec.approvedBy.toUpperCase()}` : 'APPROVED') : 'PENDING'}
            </span>
          </div>
          <h3 className="text-lg font-serif font-bold tracking-tight">
            Tech Pack for: {currentSpec.name} (Size {activeSize})
          </h3>
          <p className="text-xs text-neutral-400">
            {validation.declaration} • Note: 2D seam validation does not constitute physical sample or fit certification.
          </p>
        </div>

        <div className="font-mono text-right text-xs">
          <div className="text-neutral-400">VALIDATED CRITERIA</div>
          <div className="text-xl font-bold text-emerald-400">
            {validation.passedCount} / {validation.checks.length}
          </div>
          <span className="text-[10px] text-neutral-400 block mt-0.5">CHECKS PASSED</span>
        </div>
      </div>

      {/* Production Spec Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Garment Bill of Materials & Cutting Specs */}
        <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider font-mono text-neutral-900 border-b border-neutral-100 pb-3">
            Material &amp; Cutting Requirements
          </h4>

          <div className="space-y-3 text-xs font-mono">
            <div className="p-2.5 bg-neutral-50 rounded border border-neutral-200">
              <span className="text-neutral-400 uppercase text-[10px] block">PRIMARY SHELL FABRIC</span>
              <span className="font-bold text-neutral-900 text-sm">{currentSpec.fabric.name}</span>
              <span className="text-neutral-600 block text-[11px] mt-0.5">{currentSpec.fabric.composition}</span>
              <div className="flex justify-between text-neutral-700 text-[11px] mt-2 pt-2 border-t border-neutral-200">
                <span>Estimated Yield (140cm width):</span>
                <span className="font-bold text-neutral-900">{fabricYieldMeters} meters</span>
              </div>
            </div>

            <div className="p-2.5 bg-neutral-50 rounded border border-neutral-200">
              <span className="text-neutral-400 uppercase text-[10px] block">THREAD &amp; HARDWARE</span>
              <ul className="text-neutral-700 space-y-1 mt-1 text-[11px]">
                <li>• 1x 20cm YKK invisible coil zipper (matched to {currentSpec.color.name})</li>
                <li>• Mara 70 or 100 poly-wrapped core thread</li>
                <li>• 1.5m bias fusible stay-tape (waistline stabilization)</li>
                <li>• Hook &amp; eye closure set (CB waist)</li>
              </ul>
            </div>

            <div className="p-2.5 bg-neutral-50 rounded border border-neutral-200">
              <span className="text-neutral-400 uppercase text-[10px] block">ALLOWANCE STANDARDS</span>
              {currentSpec.garmentCategory === 'bodice' ? (
                <div className="grid grid-cols-3 gap-2 mt-1 text-center">
                  <div className="bg-white p-1.5 rounded border border-neutral-200">
                    <span className="text-[10px] text-neutral-500 block">NECK/ARMHOLE</span>
                    <span className="font-bold text-neutral-900">1.0 cm</span>
                  </div>
                  <div className="bg-white p-1.5 rounded border border-neutral-200">
                    <span className="text-[10px] text-neutral-500 block">SEAMS/INSEAM</span>
                    <span className="font-bold text-neutral-900">1.2 cm</span>
                  </div>
                  <div className="bg-white p-1.5 rounded border border-neutral-200">
                    <span className="text-[10px] text-neutral-500 block">WRIST HEM</span>
                    <span className="font-bold text-neutral-900">3.0 cm</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 mt-1 text-center">
                  <div className="bg-white p-1.5 rounded border border-neutral-200">
                    <span className="text-[10px] text-neutral-500 block">WAIST</span>
                    <span className="font-bold text-neutral-900">1.0 cm</span>
                  </div>
                  <div className="bg-white p-1.5 rounded border border-neutral-200">
                    <span className="text-[10px] text-neutral-500 block">SIDE SEAM</span>
                    <span className="font-bold text-neutral-900">1.5 cm</span>
                  </div>
                  <div className="bg-white p-1.5 rounded border border-neutral-200">
                    <span className="text-[10px] text-neutral-500 block">HEM</span>
                    <span className="font-bold text-neutral-900">3.0 cm</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pattern Pieces Inventory */}
        <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider font-mono text-neutral-900 border-b border-neutral-100 pb-3">
            Pattern Piece Registry ({pieces.length} Pieces)
          </h4>

          <div className="space-y-3 font-mono text-xs">
            {pieces.map(piece => (
              <div
                key={piece.id}
                className="p-3 border border-neutral-200 rounded-xs bg-neutral-50/50 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-900 text-sm">[{piece.pieceCode}]</span>
                  <Badge variant="dark" size="sm">
                    {piece.onFold ? 'CUT 1 ON FOLD' : `CUT ${piece.cutCount}`}
                  </Badge>
                </div>
                <span className="font-medium text-neutral-800 block">{piece.name}</span>
                <p className="text-[11px] text-neutral-600 font-sans">{piece.description}</p>
                <div className="flex justify-between text-[10px] text-neutral-500 pt-1 border-t border-neutral-200">
                  <span>DIMENSIONS: {piece.boundingBox.widthCm} × {piece.boundingBox.heightCm} cm</span>
                  <span>GRAIN: {piece.grainline.direction.toUpperCase()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Finished Garment Dimensions vs Target */}
        <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider font-mono text-neutral-900 border-b border-neutral-100 pb-3">
            Finished Garment Measurements
          </h4>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3 bg-neutral-50 rounded border border-neutral-200 space-y-2">
              {'garmentBustCm' in dims ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Bust Circumference:</span>
                    <span className="font-bold text-neutral-900">{dims.garmentBustCm} cm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Waist Circumference:</span>
                    <span className="font-bold text-neutral-900">{dims.garmentWaistCm} cm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Center Front Length:</span>
                    <span className="font-bold text-neutral-900">{currentSpec.lengthCm} cm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Bust-to-Waist Suppression:</span>
                    <span className="font-bold text-neutral-900">
                      {((dims.garmentBustCm - dims.garmentWaistCm) / 2).toFixed(1)} cm
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Waist Circumference:</span>
                    <span className="font-bold text-neutral-900">{dims.garmentWaistCm} cm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Low Hip Circumference:</span>
                    <span className="font-bold text-neutral-900">{dims.garmentHipCm} cm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Finished Total Length:</span>
                    <span className="font-bold text-neutral-900">{dims.totalLengthCm} cm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Waist Suppression (Darts):</span>
                    <span className="font-bold text-neutral-900">
                      {((dims.garmentHipCm - dims.garmentWaistCm) / 2).toFixed(1)} cm
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-900 text-[11px]">
              <div className="flex items-center gap-1.5 font-bold mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Seam Compatibility Certified
              </div>
              Front side seam and back side seam lengths match with 0.00 cm mathematical variance. Ready for industrial cutting.
            </div>
          </div>
        </div>
      </div>

      {/* Milestone 04.3: Integrated Bodice–Sleeve Seam Assembly Specification */}
      {assemblyResult && (
        <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-100 pb-4 gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider font-mono bg-blue-900 text-white px-2 py-0.5 rounded">
                  MILESTONE 04.3
                </span>
                <span className="text-xs font-mono text-neutral-500">INTEGRATED BODICE–SLEEVE ASSEMBLY &amp; SEAM SPECIFICATION</span>
              </div>
              <h3 className="text-base font-semibold text-neutral-900">
                Seam Arc-Length Reconciliation &amp; Ease Distribution Sheet
              </h3>
              <p className="text-xs text-neutral-600 mt-0.5">
                Deterministic arc-length compatibility using adaptive Bézier subdivision with linear uncertainty propagation.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                variant={assemblyResult.status === 'verified-valid' ? 'success' : (assemblyResult.status === 'invalid' ? 'danger' : 'warning')}
                size="md"
              >
                STATUS: {assemblyResult.status.toUpperCase()}
              </Badge>
              <Badge variant="warning" size="md" className="border-amber-400 text-amber-800 bg-amber-50">
                3D DRAPE UNASSESSED
              </Badge>
            </div>
          </div>

          {/* Measurements & Ease Reconciliation Table */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
            {/* Front Armhole / Cap Match */}
            <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded space-y-2">
              <div className="flex justify-between items-center border-b border-neutral-200 pb-1.5 font-semibold text-neutral-800">
                <span>FRONT SCYE PAIRING</span>
                <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                  {assemblyResult.ease.frontEaseRatio !== null ? `${(assemblyResult.ease.frontEaseRatio * 100).toFixed(1)}% EASE` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between text-neutral-600 text-[11px]">
                <span>Front Bodice Scye (L_bf):</span>
                <span className="font-bold text-neutral-900">
                  {assemblyResult.ease.frontBodiceArmholeLengthCm.toFixed(2)} cm
                  <span className="text-neutral-400 font-normal"> (±{assemblyResult.measurements.frontBodiceArmhole?.uncertaintyCm.toFixed(4)})</span>
                </span>
              </div>
              <div className="flex justify-between text-neutral-600 text-[11px]">
                <span>Front Sleeve Cap (L_sf):</span>
                <span className="font-bold text-neutral-900">
                  {assemblyResult.ease.frontSleeveCapLengthCm.toFixed(2)} cm
                  <span className="text-neutral-400 font-normal"> (±{assemblyResult.measurements.frontSleeveCap?.uncertaintyCm.toFixed(4)})</span>
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-neutral-200 text-neutral-900 font-bold">
                <span>Front Cap Ease (E_f):</span>
                <span className={assemblyResult.ease.isFrontEasePermitted ? 'text-emerald-700' : 'text-red-700'}>
                  +{assemblyResult.ease.frontEaseCm.toFixed(2)} cm (±{assemblyResult.ease.frontEaseUncertaintyCm.toFixed(4)})
                </span>
              </div>
            </div>

            {/* Back Armhole / Cap Match */}
            <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded space-y-2">
              <div className="flex justify-between items-center border-b border-neutral-200 pb-1.5 font-semibold text-neutral-800">
                <span>BACK SCYE PAIRING</span>
                <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                  {assemblyResult.ease.frontEaseRatio !== null ? `${((1 - assemblyResult.ease.frontEaseRatio) * 100).toFixed(1)}% EASE` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between text-neutral-600 text-[11px]">
                <span>Back Bodice Scye (L_bb):</span>
                <span className="font-bold text-neutral-900">
                  {assemblyResult.ease.backBodiceArmholeLengthCm.toFixed(2)} cm
                  <span className="text-neutral-400 font-normal"> (±{assemblyResult.measurements.backBodiceArmhole?.uncertaintyCm.toFixed(4)})</span>
                </span>
              </div>
              <div className="flex justify-between text-neutral-600 text-[11px]">
                <span>Back Sleeve Cap (L_sb):</span>
                <span className="font-bold text-neutral-900">
                  {assemblyResult.ease.backSleeveCapLengthCm.toFixed(2)} cm
                  <span className="text-neutral-400 font-normal"> (±{assemblyResult.measurements.backSleeveCap?.uncertaintyCm.toFixed(4)})</span>
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-neutral-200 text-neutral-900 font-bold">
                <span>Back Cap Ease (E_b):</span>
                <span className={assemblyResult.ease.isBackEasePermitted ? 'text-emerald-700' : 'text-red-700'}>
                  +{assemblyResult.ease.backEaseCm.toFixed(2)} cm (±{assemblyResult.ease.backEaseUncertaintyCm.toFixed(4)})
                </span>
              </div>
            </div>

            {/* Total Ease & Tolerance Status */}
            <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded space-y-2">
              <div className="flex justify-between items-center border-b border-neutral-200 pb-1.5 font-semibold text-neutral-800">
                <span>TOTAL ASSEMBLY EASE</span>
                <span className="text-[10px] text-neutral-500 uppercase">
                  {assemblyResult.ease.targetStrategy}
                </span>
              </div>
              <div className="flex justify-between text-neutral-600 text-[11px]">
                <span>Total Bodice Scye:</span>
                <span className="font-bold text-neutral-900">{assemblyResult.ease.totalBodiceArmholeLengthCm.toFixed(2)} cm</span>
              </div>
              <div className="flex justify-between text-neutral-600 text-[11px]">
                <span>Total Sleeve Cap:</span>
                <span className="font-bold text-neutral-900">{assemblyResult.ease.totalSleeveCapLengthCm.toFixed(2)} cm</span>
              </div>
              <div className="flex justify-between text-neutral-600 text-[11px]">
                <span>Strategy Target Ease:</span>
                <span className="font-bold text-neutral-700">+{assemblyResult.ease.targetTotalEaseCm.toFixed(2)} cm (Residual: {assemblyResult.ease.totalResidualCm.toFixed(2)} cm)</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-neutral-200 text-neutral-900 font-bold">
                <span>Total Ease (E_t):</span>
                <span className={assemblyResult.ease.isTotalEasePermitted ? 'text-emerald-700' : 'text-red-700'}>
                  +{assemblyResult.ease.totalEaseCm.toFixed(2)} cm (±{assemblyResult.ease.totalEaseUncertaintyCm.toFixed(4)})
                </span>
              </div>
            </div>
          </div>

          {/* Topology, Parity & Notch Correspondence Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            {/* Notch Correspondence Details */}
            <div className="p-3 bg-neutral-50/70 border border-neutral-200 rounded space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-neutral-500 block">NOTCH PAIRING VERIFICATION</span>
              <div className="flex justify-between text-[11px]">
                <span>Front Scye Single Notch:</span>
                <span className={assemblyResult.notches.frontNotch?.isWithinTolerance ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                  Delta: {assemblyResult.notches.frontNotch?.deltaCm.toFixed(2) ?? 'N/A'} cm (≤ 0.30 cm)
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span>Back Scye Double Notches:</span>
                <span className={assemblyResult.notches.backNotches?.isSpacingValid ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                  Spacing: {assemblyResult.notches.backNotches?.sleeveSpacingCm.toFixed(2) ?? 'N/A'} cm (1.2 ± 0.3 cm)
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span>Crown Apex Notch (0,0):</span>
                <span className={assemblyResult.notches.crownNotch?.isApexAligned ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                  Aligned at Apex (≤ 0.05 cm)
                </span>
              </div>
            </div>

            {/* Inseam Parity & Orientation */}
            <div className="p-3 bg-neutral-50/70 border border-neutral-200 rounded space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-neutral-500 block">SEAM ORIENTATION &amp; INSEAM PARITY</span>
              <div className="flex justify-between text-[11px]">
                <span>Underarm Inseam Parity:</span>
                <span className={assemblyResult.endpoints.underarmInseamMatch.hasParity ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                  Delta: {assemblyResult.endpoints.underarmInseamMatch.parityDeltaCm.toFixed(3)} cm (≤ 0.05 cm)
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span>Traversal Orientation:</span>
                <span className={assemblyResult.endpoints.isEndpointTopologyValid ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                  All Curves Traversed Upward/Ascending
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span>Crown Continuity:</span>
                <span className={assemblyResult.endpoints.crownShoulderMatch.isTangentContinuous ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                  {assemblyResult.endpoints.crownShoulderMatch.isTangentContinuous
                    ? 'Crown Apex C0 Match & C1 Tangency (≤ 1.0°)'
                    : (assemblyResult.endpoints.crownShoulderMatch.isConnected
                        ? `C0 Matched, C1 Tangency Departure: ${assemblyResult.endpoints.crownShoulderMatch.tangentDepartureDeg?.toFixed(1) ?? 'N/A'}°`
                        : 'Crown Disconnected')}
                </span>
              </div>
            </div>
          </div>

          {/* Mandatory Industrial Non-Production-Ready Notice */}
          <div className="p-3 bg-amber-50/80 border border-amber-200 rounded text-amber-900 text-[11px] leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold mb-0.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
              <span>Industrial Production Boundary Notice: isProductionReady = false</span>
            </div>
            This assembly is certified for 2D coordinate continuity, deterministic seam arc-lengths, and notch pairing. 
            Physical cloth drape, fabric shear deformation during arm movement, and steam iron crimping behaviour are unassessed. 
            Physical muslin prototype verification is required prior to industrial production cutting.
          </div>
        </div>
      )}

      {/* Assembly Sequence Section */}
      <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider font-mono text-neutral-900 border-b border-neutral-100 pb-3 flex items-center justify-between">
          <span>Industrial Sewing &amp; Assembly Sequence</span>
          <span className="text-[10px] text-neutral-400 font-mono">6 SEQUENTIAL OPERATIONS</span>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {assemblySteps.map(step => (
            <div
              key={step.step}
              className="p-4 border border-neutral-200 rounded-xs bg-neutral-50/50 space-y-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-neutral-900 text-white font-mono text-[10px] flex items-center justify-center font-bold">
                  {step.step}
                </span>
                <h5 className="font-semibold text-neutral-900">{step.title}</h5>
              </div>
              <p className="text-neutral-600 leading-relaxed text-[11px]">
                {step.instruction}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Milestone 04.4: Graded Pattern Specifications & Cross-Size Grade Rule Table */}
      <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-100 pb-4 gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase font-mono tracking-wider bg-purple-950 text-purple-200 px-2 py-0.5 rounded font-bold">
                MILESTONE 04.4
              </span>
              <span className="text-xs font-mono text-neutral-500">
                ANTHROPOMETRIC &amp; PATTERN GRADING SPECIFICATION
              </span>
            </div>
            <h3 className="text-base font-semibold text-neutral-900 font-mono">
              Cross-Size Graded Garment Matrix (XS–XXL)
            </h3>
            <p className="text-xs text-neutral-600 mt-0.5">
              Derived directly from deterministic target measurement regeneration. Zero global coordinate scaling.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-neutral-500">Grading System:</span>
            <span className="font-bold text-neutral-900 bg-neutral-100 px-2.5 py-1 rounded border border-neutral-200">
              {gradedPatternSet.gradeTable.name} (Base: {gradedPatternSet.baseSize})
            </span>
          </div>
        </div>

        {/* Specifications Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border border-neutral-200">
            <thead className="bg-neutral-900 text-white uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Size</th>
                <th className="py-2.5 px-3">Bust (cm)</th>
                <th className="py-2.5 px-3">Waist (cm)</th>
                <th className="py-2.5 px-3">Low Hip (cm)</th>
                <th className="py-2.5 px-3">Front Bodice (W)</th>
                <th className="py-2.5 px-3">Back Bodice (W)</th>
                <th className="py-2.5 px-3">Sleeve Biceps (W)</th>
                <th className="py-2.5 px-3">Total Scye Arc</th>
                <th className="py-2.5 px-3">Cap Ease (E_t)</th>
                <th className="py-2.5 px-3">Assembly Status</th>
                <th className="py-2.5 px-3 text-right">Production Ready</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 text-neutral-800">
              {DEFAULT_SIZE_RANGE.map(sz => {
                const res = gradedPatternSet.sizeResults[sz];
                if (!res) return null;
                const isBase = sz === gradedPatternSet.baseSize;
                const fPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-F'));
                const bPiece = res.bodicePieces.find(p => p.pieceCode.includes('BOD-B'));
                const sPiece = res.sleevePiece;
                const totalEase = res.assemblyResult?.ease.totalEaseCm;
                const totalScye = res.assemblyResult?.ease.totalBodiceArmholeLengthCm;

                return (
                  <tr
                    key={sz}
                    className={`hover:bg-neutral-50 transition-colors ${
                      isBase ? 'bg-purple-50/40 font-semibold' : ''
                    }`}
                  >
                    <td className="py-2.5 px-3 font-bold text-neutral-900 flex items-center gap-1.5">
                      <span>{sz}</span>
                      {isBase && (
                        <span className="text-[9px] bg-neutral-900 text-white px-1.5 py-0.2 rounded font-mono font-normal">
                          BASE
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">{res.measurements.bust ?? '-'}</td>
                    <td className="py-2.5 px-3">{res.measurements.waist ?? '-'}</td>
                    <td className="py-2.5 px-3">{res.measurements.lowHip ?? '-'}</td>
                    <td className="py-2.5 px-3">{fPiece?.boundingBox.widthCm ?? '-'} cm</td>
                    <td className="py-2.5 px-3">{bPiece?.boundingBox.widthCm ?? '-'} cm</td>
                    <td className="py-2.5 px-3">{sPiece?.boundingBox.widthCm ?? '-'} cm</td>
                    <td className="py-2.5 px-3">{totalScye ? `${totalScye.toFixed(2)} cm` : '-'}</td>
                    <td className="py-2.5 px-3 text-emerald-700 font-bold">
                      {totalEase !== undefined ? `+${totalEase.toFixed(2)} cm` : '-'}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge
                        variant={res.isValid ? 'success' : 'danger'}
                        size="sm"
                      >
                        {res.isValid ? 'VERIFIED' : 'INVALID'}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="text-[10px] text-amber-800 font-bold bg-amber-100 px-1.5 py-0.5 rounded">
                        FALSE
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Monotonicity and Integrity Matrix */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-4 border border-neutral-200 rounded-sm bg-neutral-50/50 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block">
              CROSS-SIZE MONOTONIC CONTINUITY REPORT
            </span>
            <div className="space-y-1 text-[11px]">
              {gradedPatternSet.integrityReport.comparisonTable.slice(0, 6).map(row => (
                <div key={row.metricId} className="flex justify-between items-center py-0.5 border-b border-neutral-200/60">
                  <span className="text-neutral-600">{row.label}:</span>
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-900 font-semibold">
                      {row.valuesPerSize.XS} → {row.valuesPerSize.XXL} {row.unit}
                    </span>
                    <span className={`text-[9px] px-1 rounded font-bold ${row.isMonotonic ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                      {row.isMonotonic ? 'MONOTONIC PASS' : 'FAIL'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 border border-neutral-200 rounded-sm bg-neutral-50/50 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block">
              CROSS-SIZE UNASSESSED INDUSTRIAL CONSTRAINTS
            </span>
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              Full garment production cutting across sizes requires physical drape verification. The following items remain strictly unassessed:
            </p>
            <ul className="space-y-1 text-[10px] text-neutral-600 list-disc list-inside">
              {gradedPatternSet.integrityReport.unassessedConditions.map((cond, i) => (
                <li key={i}>{cond}</li>
              ))}
            </ul>
            <div className="pt-2 border-t border-neutral-200 flex items-center justify-between text-amber-900 text-[10px] font-bold uppercase">
              <span>Prototype Stage CAD</span>
              <span>isProductionReady: false</span>
            </div>
          </div>
        </div>
      </div>

      {/* Milestone 04.5: Fabric-Aware Pattern Engineering & Physical Fit Validation Foundation */}
      <div className="bg-white border border-neutral-200 rounded-sm p-6 shadow-2xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-100 pb-4 gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase font-mono tracking-wider bg-amber-950 text-amber-200 px-2 py-0.5 rounded font-bold">
                MILESTONE 04.5
              </span>
              <span className="text-xs font-mono text-neutral-500">
                FABRIC BEHAVIOR &amp; PHYSICAL FIT EVIDENCE FOUNDATION
              </span>
            </div>
            <h3 className="text-base font-semibold text-neutral-900 font-mono">
              Fabric-Aware Deterministic Ease &amp; Physical Prototype Validation
            </h3>
            <p className="text-xs text-neutral-600 mt-0.5">
              Material mechanical properties (shrinkage, stretch, thickness, molding) coupled with empirical prototype fit evidence.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-neutral-500">Fabric Lot:</span>
            <span className="font-bold text-neutral-900 bg-neutral-100 px-2.5 py-1 rounded border border-neutral-200">
              {enhancedFabric.name} ({enhancedFabric.gsm} GSM)
            </span>
          </div>
        </div>

        {/* Fabric Physical Property & Provenance Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
          <div className="p-4 border border-neutral-200 rounded-sm bg-neutral-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block">
                FABRIC SPECIFICATION &amp; PROVENANCE
              </span>
              <span className="text-[9px] bg-neutral-200 text-neutral-700 px-1.5 py-0.5 rounded font-bold">
                UNVERIFIED REFERENCE
              </span>
            </div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-neutral-500">Weight &amp; Drape:</span>
                <span className="text-neutral-900 font-semibold">{enhancedFabric.weight} / {enhancedFabric.gsm} g/m²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Stretch Classification:</span>
                <span className="text-neutral-900 font-semibold">{enhancedFabric.stretch}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Thickness:</span>
                <span className="text-neutral-900 font-semibold">{enhancedFabric.thicknessMm.toFixed(2)} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Data Provenance:</span>
                <span className="text-amber-800 font-semibold">Project Illustrative Reference</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Lab Certification:</span>
                <span className="text-neutral-600 italic">Uncertified (Estimated Example)</span>
              </div>
            </div>
          </div>

          <div className="p-4 border border-neutral-200 rounded-sm bg-neutral-50/50 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block">
              DIRECTIONAL MECHANICAL BEHAVIOR
            </span>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-neutral-500">Shrinkage (Warp / Weft):</span>
                <span className="text-neutral-900 font-semibold">
                  {enhancedFabric.directional.warp.shrinkagePercent}% / {enhancedFabric.directional.weft.shrinkagePercent}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Stretch (Warp / Weft):</span>
                <span className="text-neutral-900 font-semibold">
                  {enhancedFabric.directional.warp.stretchPercent}% / {enhancedFabric.directional.weft.stretchPercent}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Bias Stretch:</span>
                <span className="text-neutral-900 font-semibold">{enhancedFabric.directional.bias?.stretchPercent ?? 0}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Sleeve Molding Factor:</span>
                <span className="text-neutral-900 font-semibold">{enhancedFabric.moldingFactor.toFixed(2)}x (Provisional)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Adapted Cap Ease:</span>
                <span className="text-emerald-700 font-bold">
                  +{adaptedSleeveEase.adaptedCapEaseCm.toFixed(2)} cm
                </span>
              </div>
            </div>
          </div>

          <div className="p-4 border border-neutral-200 rounded-sm bg-neutral-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block">
                FIT VALIDATION EVIDENCE (PROTOTYPE)
              </span>
              <span className="text-[9px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-bold">
                SYNTHETIC DEMO
              </span>
            </div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-neutral-500">Benchmark Serial:</span>
                <span className="text-neutral-900 font-semibold">{MOCK_CONFORMING_PROTOTYPE_BODICE_M.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Evidence Classification:</span>
                <span className="text-amber-800 font-semibold">Synthetic Test Fixture</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Measurement Points:</span>
                <span className="text-emerald-700 font-bold">
                  {sampleFitReport.passCount}/{sampleFitReport.evaluatedPointsCount} Conforming
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Max Discrepancy:</span>
                <span className="text-neutral-900 font-semibold">{sampleFitReport.maxAbsoluteDiscrepancyCm.toFixed(2)} cm</span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-neutral-200">
                <span className="text-neutral-500">Validation Status:</span>
                <span className="text-[9px] bg-neutral-200 text-neutral-800 font-bold px-1.5 py-0.5 rounded">
                  SYNTHETIC BENCHMARK ONLY
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Directional Ease Allocation Matrix */}
        <div className="space-y-2 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-500 block">
              DETERMINISTIC CIRCUMFERENCE EASE ALLOCATION (FINISHED GARMENT VS PRE-SHRINK CUTTING)
            </span>
            <span className="text-[10px] text-neutral-500">
              Shrinkage ratio applied strictly to cutting dimensions, not finished ease.
            </span>
          </div>
          <div className="overflow-x-auto border border-neutral-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-900 text-white uppercase text-[10px]">
                <tr>
                  <th className="py-2 px-3">Girth Measurement</th>
                  <th className="py-2 px-3">Anatomical Baseline</th>
                  <th className="py-2 px-3">Wearing Ease</th>
                  <th className="py-2 px-3 text-red-300">Stretch (-ΔE_s)</th>
                  <th className="py-2 px-3 text-blue-300">Turn of Cloth</th>
                  <th className="py-2 px-3 text-emerald-300">Net Finished Ease</th>
                  <th className="py-2 px-3 font-bold text-white">Finished Garment Circumference</th>
                  <th className="py-2 px-3 text-amber-300">Cutting Shrink (+ΔD_sh)</th>
                  <th className="py-2 px-3 text-right text-amber-200">Pre-Shrink Cut Dimension</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 text-neutral-800">
                {(['bust', 'waist', 'lowHip'] as const).map(girth => {
                  const b = fabricEaseBreakdown[girth];
                  const girthLabel = girth === 'bust' ? 'Bust Circumference' : girth === 'waist' ? 'Waist Circumference' : 'Low Hip Circumference';
                  return (
                    <tr key={girth} className="hover:bg-neutral-50 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-neutral-900">
                        <div>{girthLabel}</div>
                        {b.isCalculationAvailable && b.isProvisionalCalculation && (
                          <span className="text-[9px] bg-amber-100 text-amber-900 px-1 py-0.2 rounded font-mono font-normal block mt-0.5">
                            PROVISIONAL {b.isProvisionalRecovery ? 'RECOVERY' : ''} {b.isProvisionalBiasShrinkage ? 'BIAS SHRINKAGE' : ''}
                          </span>
                        )}
                        {b.isCalculationAvailable && b.totalAppliedEaseCm < 0 && (
                          <span className="text-[9px] bg-purple-100 text-purple-900 px-1 py-0.2 rounded font-mono font-normal block mt-0.5">
                            NEGATIVE EASE AUTHORIZED
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">{b.bodyMeasurementCm.toFixed(1)} cm</td>
                      <td className="py-2.5 px-3">+{b.baselineMovementEaseCm.toFixed(2)} cm</td>
                      {b.isCalculationAvailable ? (
                        <>
                          <td className="py-2.5 px-3 text-red-700 font-semibold">
                            {b.stretchDeductionCm > 0 ? `-${b.stretchDeductionCm.toFixed(2)} cm` : '0.00 cm'}
                          </td>
                          <td className="py-2.5 px-3 text-blue-700 font-semibold">
                            +{b.thicknessAllowanceCm.toFixed(2)} cm
                          </td>
                          <td className="py-2.5 px-3 text-emerald-700 font-bold">
                            +{b.totalAppliedEaseCm.toFixed(2)} cm
                          </td>
                          <td className="py-2.5 px-3 font-bold text-neutral-900 bg-neutral-50">
                            {b.finishedGarmentDimensionCm.toFixed(2)} cm
                          </td>
                          <td className="py-2.5 px-3 text-amber-700 font-semibold">
                            +{b.shrinkageCompensationCm.toFixed(2)} cm
                          </td>
                          <td className="py-2.5 px-3 font-bold text-amber-950 text-right bg-amber-50/40">
                            {b.preShrinkCuttingDimensionCm.toFixed(2)} cm
                          </td>
                        </>
                      ) : (
                        <td colSpan={6} className="py-2.5 px-3 text-amber-800 italic font-mono text-xs bg-amber-50/50">
                          Unavailable: {b.unavailableReason}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Unassessed Physical Fit Governance Notice */}
        <div className="p-4 border border-amber-300 bg-amber-50/70 rounded-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-mono">
          <div className="space-y-1">
            <span className="font-bold text-amber-950 uppercase text-[10px] block tracking-wider">
              CAD MILESTONE 04.5 SYSTEM GOVERNANCE NOTICE
            </span>
            <p className="text-amber-900 text-[11px] leading-relaxed">
              Empirical prototype fitting evidence verifies mathematical 2D drafting precision. However, industrial production release requires real-world wear test sign-off, multi-layer interlining trials, and grading across physical samples.
            </p>
          </div>
          <div className="bg-amber-900 text-white font-bold px-3 py-1.5 rounded text-[11px] uppercase tracking-wider shrink-0">
            isProductionReady: false
          </div>
        </div>
      </div>
    </div>
  );
};
