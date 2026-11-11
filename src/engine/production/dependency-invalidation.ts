/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyMeasurements,
  DesignSpecification,
  FabricProperty,
  PatternPiece,
  ValidationReport
} from '../../types';
import { sha256Hex } from './crypto';
import {
  canonicalizeJson,
  computeCanonicalRevisionFingerprint,
  CURRENT_ENGINE_VERSION,
  deepFreeze,
  verifyGradingArtifactIntegrity,
  verifyMeasurementSetIntegrity
} from './pattern-revision-snapshot';
import {
  PipelineArtifactRecord,
  PipelineArtifactStatus,
  PipelineArtifactType,
  PipelineIntegrityReport,
  ProductionExportRejectionCode,
  ProductionExportValidationResult
} from './dependency-types';
import {
  AuthoritativeGradingArtifact,
  AuthoritativeMeasurementSetRecord,
  ExportGradingPolicy,
  GradingSummarySnapshot,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementSetSnapshot,
  ProductionPatternRevisionSnapshot
} from './production-types';
import { EnhancedFabricProperty } from '../fabric/fabric-types';
import {
  computeSpecificationFingerprint,
  verifySpecificationApproval
} from './garment-specification';
import {
  ApprovalVerificationContext,
  AuthoritativeGarmentSpecification
} from './garment-specification-types';
import { calculateGarmentDimensions } from '../measurements/standards';

/**
 * Computes a deterministic SHA-256 fingerprint for arbitrary artifact input structures.
 */
export function computeArtifactInputFingerprint(input: unknown): string {
  const json = canonicalizeJson(input);
  return sha256Hex(json);
}

/**
 * Inputs required to evaluate full pipeline integrity.
 */
export interface PipelineIntegrityInputs {
  readonly specification: DesignSpecification | AuthoritativeGarmentSpecification;
  readonly measurements: BodyMeasurements;
  readonly activeSize: string;
  readonly fabric?: FabricProperty;
  readonly patternPieces?: readonly PatternPiece[];
  readonly validationReport?: ValidationReport;
  readonly productionSnapshot?: ProductionPatternRevisionSnapshot;
  readonly measurementSet?: AuthoritativeMeasurementSetRecord | MeasurementSetSnapshot;
  readonly measurementApprovalState?: MeasurementApprovalStatus;
  readonly measurementProvenance?: MeasurementOrigin;
  readonly isMeasurementApproved?: boolean;
  readonly engineVersion?: string;
  readonly gradingRulesVersion?: string;
  readonly activeDraftingFingerprint?: string;
  readonly verificationContext?: ApprovalVerificationContext;
  readonly gradingSummary?: Partial<GradingSummarySnapshot>;
  readonly gradingArtifact?: AuthoritativeGradingArtifact;
  readonly exportGradingPolicy?: ExportGradingPolicy;
}

/**
 * Mandatory active inputs required for independent production export verification.
 */
export interface ProductionExportActiveInputs {
  readonly specification?: DesignSpecification | AuthoritativeGarmentSpecification;
  readonly measurements?: BodyMeasurements;
  readonly measurementSet?: AuthoritativeMeasurementSetRecord | MeasurementSetSnapshot;
  readonly measurementApprovalState?: MeasurementApprovalStatus;
  readonly measurementProvenance?: MeasurementOrigin;
  readonly isMeasurementApproved?: boolean;
  readonly fabric?: FabricProperty;
  readonly patternPieces?: readonly PatternPiece[];
  readonly validationReport?: ValidationReport;
  readonly gradingResult?: Partial<GradingSummarySnapshot>;
  readonly gradingArtifact?: AuthoritativeGradingArtifact;
  readonly exportGradingPolicy?: ExportGradingPolicy;
  readonly engineVersion?: string;
  readonly gradingRulesVersion?: string;
  readonly verificationContext?: ApprovalVerificationContext;
}

/**
 * Deterministically evaluates dependencies and stale state across all stages
 * of the garment engineering pipeline.
 *
 * CRITICAL ARCHITECTURAL GUARANTEES:
 * 1. Independent source inputs (Specification, Body Measurements, Fabric Properties, Grading Rules, Engine)
 *    do not depend on each other. Changing garment target length (specification) NEVER
 *    mutates or invalidates anatomical body waist or hip measurements.
 * 2. Missing measurement approval NEVER defaults to approved; it defaults to 'unverified'.
 * 3. Derived artifacts (Finished Dimensions, Drafting Configuration, Pattern Geometry, Geometry Validation,
 *    Grading, Production Snapshot, Production Export) retain upstream input fingerprints and are
 *    invalidated selectively whenever their actual upstream inputs change.
 */
export function evaluatePipelineDependencyIntegrity(
  inputs: PipelineIntegrityInputs
): PipelineIntegrityReport {
  const now = new Date().toISOString();
  const spec = inputs.specification;
  const specGarmentId = 'garmentId' in spec && spec.garmentId
    ? spec.garmentId
    : ('id' in spec && (spec as DesignSpecification).id ? (spec as DesignSpecification).id : 'garment');
  const specRevisionId = spec.specificationRevisionId ?? `spec-${specGarmentId}-v${spec.version || 1}`;
  const currentEngineVer = inputs.engineVersion ?? CURRENT_ENGINE_VERSION;

  let specLengthCm = 0;
  if ('lengthCm' in spec && typeof (spec as { lengthCm?: unknown }).lengthCm === 'number') {
    specLengthCm = (spec as { lengthCm: number }).lengthCm;
  }
  if (!specLengthCm && 'targetFinishedDimensions' in spec && spec.targetFinishedDimensions) {
    const td = spec.targetFinishedDimensions as { lengthCm?: number; length?: number };
    specLengthCm = td.lengthCm ?? td.length ?? 0;
  }

  const staleReasons: string[] = [];
  const requiredActions: string[] = [];

  // =========================================================================
  // 1. INDEPENDENT SOURCE INPUT: Design Specification
  // =========================================================================
  const specFingerprint = computeSpecificationFingerprint(spec);
  const approvalVerification = verifySpecificationApproval(spec, inputs.verificationContext);

  let specStatus: PipelineArtifactStatus = 'approved';
  let specValidationStatus = 'approved';
  let specStaleReason: string | undefined = undefined;

  if (approvalVerification.state === 'revoked') {
    specStatus = 'revoked';
    specValidationStatus = 'revoked';
    specStaleReason = 'Design specification approval was explicitly revoked.';
    staleReasons.push(specStaleReason);
    requiredActions.push('Re-evaluate and formally approve design specification.');
  } else if (approvalVerification.state === 'superseded') {
    specStatus = 'stale';
    specValidationStatus = 'superseded';
    specStaleReason = approvalVerification.reason ?? 'Design specification revision has been superseded.';
    staleReasons.push(specStaleReason);
    requiredActions.push('Switch to the active superseding specification revision.');
  } else if (!approvalVerification.isValid) {
    specStatus = approvalVerification.state === 'invalid' ? 'invalid' : 'pending';
    specValidationStatus = approvalVerification.state;
    specStaleReason = approvalVerification.reason ?? 'Design specification approval is pending.';
    staleReasons.push(specStaleReason);
    requiredActions.push('Review and approve design specification before industrial release.');
  }

  const specArtifact: PipelineArtifactRecord = {
    artifactId: 'art-specification',
    artifactType: 'specification',
    nodeCategory: 'independent_source_input',
    status: specStatus,
    revisionId: specRevisionId,
    inputFingerprint: specFingerprint,
    generatedContentFingerprint: specFingerprint,
    engineVersion: currentEngineVer,
    staleReason: specStaleReason,
    regenerationRequired: specStatus === 'stale',
    validationStatus: specValidationStatus,
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 2. INDEPENDENT SOURCE INPUT: Body Measurements
  // Correction D: Never default missing measurement approval to true.
  // =========================================================================
  const measFingerprint = computeArtifactInputFingerprint({
    unit: inputs.measurements.unit,
    waist: inputs.measurements.waist,
    lowHip: inputs.measurements.lowHip,
    highHip: inputs.measurements.highHip,
    skirtLength: inputs.measurements.skirtLength,
    bust: inputs.measurements.bust,
    waistToHip: inputs.measurements.waistToHip,
    backWaistLength: inputs.measurements.backWaistLength,
    frontWaistLength: inputs.measurements.frontWaistLength,
    acrossBack: inputs.measurements.acrossBack,
    shoulderLength: inputs.measurements.shoulderLength,
    neckCircumference: inputs.measurements.neckCircumference,
    bustSpan: inputs.measurements.bustSpan,
    bustHeight: inputs.measurements.bustHeight,
    armholeDepth: inputs.measurements.armholeDepth,
    bicepsCircumference: inputs.measurements.bicepsCircumference,
    elbowCircumference: inputs.measurements.elbowCircumference,
    wristCircumference: inputs.measurements.wristCircumference,
    sleeveLength: inputs.measurements.sleeveLength,
    armLengthToElbow: inputs.measurements.armLengthToElbow,
    activeSize: inputs.activeSize
  });

  const isMeasAnatomicallyValid =
    Number.isFinite(inputs.measurements.waist) && inputs.measurements.waist > 0 &&
    Number.isFinite(inputs.measurements.lowHip) && inputs.measurements.lowHip > 0;

  // Check if active measurements match productionSnapshot measurements (when snapshot is provided)
  let snapshotMeasurementsMatch = false;
  if (inputs.productionSnapshot?.measurementSet?.values) {
    snapshotMeasurementsMatch = true;
    const snapMeas = inputs.productionSnapshot.measurementSet.values;
    const activeMeas = (inputs.measurements as unknown) as Record<string, unknown>;
    for (const [k, v] of Object.entries(activeMeas)) {
      if (typeof v === 'number') {
        const snapV = snapMeas[k];
        if (typeof snapV !== 'number' || Math.abs(snapV - v) > 0.001) {
          snapshotMeasurementsMatch = false;
          break;
        }
      }
    }
  }

  // Check if active measurements match measurementSet values (when measurementSet is provided)
  let measurementSetValuesMatch = true;
  if (inputs.measurementSet?.values) {
    const msVals = inputs.measurementSet.values;
    const activeMeas = (inputs.measurements as unknown) as Record<string, unknown>;
    for (const [k, v] of Object.entries(activeMeas)) {
      if (typeof v === 'number' && msVals[k] !== undefined) {
        if (Math.abs(msVals[k] - v) > 0.001) {
          measurementSetValuesMatch = false;
          break;
        }
      }
    }
  }

  // Resolve explicit measurement approval state & provenance (never defaulting missing approval to 'approved')
  let measApprovalState: MeasurementApprovalStatus = 'unverified';
  let measProvenance: MeasurementOrigin = inputs.measurementProvenance ?? 'unknown';
  let measRevisionId = `meas-${inputs.activeSize}-${spec.garmentCategory}`;

  if (inputs.measurementSet) {
    if (inputs.measurementSet.revisionId) {
      measRevisionId = inputs.measurementSet.revisionId;
    }
    if ('approvalState' in inputs.measurementSet) {
      measApprovalState = measurementSetValuesMatch ? inputs.measurementSet.approvalState : 'unverified';
      measProvenance = inputs.measurementSet.provenance;
    } else if ('approval' in inputs.measurementSet) {
      measApprovalState = measurementSetValuesMatch ? inputs.measurementSet.approval.state : 'unverified';
      measProvenance = inputs.measurementSet.defaultOrigin;
    }
  } else if (inputs.measurementApprovalState !== undefined) {
    measApprovalState = inputs.measurementApprovalState;
    measProvenance = inputs.measurementProvenance ?? 'user-entered';
  } else if (inputs.isMeasurementApproved !== undefined) {
    measApprovalState = inputs.isMeasurementApproved ? 'approved' : 'unverified';
    measProvenance = inputs.measurementProvenance ?? 'user-entered';
  } else if (
    snapshotMeasurementsMatch &&
    inputs.productionSnapshot?.measurementSet?.approval?.state === 'approved' &&
    Boolean(inputs.productionSnapshot.measurementSet.approval.approvedBy)
  ) {
    measApprovalState = 'approved';
    measProvenance = inputs.measurementProvenance ?? inputs.productionSnapshot.measurementSet.defaultOrigin ?? 'unknown';
  }

  const isAiMeasurement =
    measProvenance === 'ai-estimated' ||
    (inputs.measurementSet && 'source' in inputs.measurementSet && inputs.measurementSet.source === 'ai-estimated') ||
    (inputs.measurementSet?.perMeasurementOrigin &&
      Object.values(inputs.measurementSet.perMeasurementOrigin).includes('ai-estimated'));

  const isMeasSuperseded =
    measApprovalState === 'superseded' ||
    Boolean(inputs.measurementSet && 'supersededByRevisionId' in inputs.measurementSet && inputs.measurementSet.supersededByRevisionId);

  const explicitUnapprovedFlag =
    inputs.isMeasurementApproved === false ||
    inputs.measurementApprovalState === 'unverified' ||
    inputs.measurementApprovalState === 'pending' ||
    Boolean(inputs.measurementSet && (measApprovalState === 'unverified' || measApprovalState === 'pending'));

  let measStatus: PipelineArtifactStatus = 'current';
  let measStaleReason: string | undefined = undefined;

  if (!isMeasAnatomicallyValid) {
    measStatus = 'invalid';
    measStaleReason = 'Anatomical body measurements contain non-finite or non-positive values.';
    staleReasons.push(measStaleReason);
  } else if (measApprovalState === 'rejected') {
    measStatus = 'invalid';
    measStaleReason = 'Anatomical body measurements were rejected.';
    staleReasons.push(measStaleReason);
  } else if (isAiMeasurement) {
    measStatus = 'invalid';
    measStaleReason = 'AI-estimated measurements cannot be used as approved physical measurements.';
    staleReasons.push(measStaleReason);
  } else if (isMeasSuperseded) {
    measStatus = 'stale';
    measStaleReason = 'Measurement set revision has been superseded by a newer measurement revision.';
    staleReasons.push(measStaleReason);
  } else if (explicitUnapprovedFlag) {
    measStatus = 'pending';
    measStaleReason = `Anatomical measurements are ${measApprovalState} and require explicit verification.`;
  }

  const isMeasExplicitlyApproved =
    isMeasAnatomicallyValid &&
    measApprovalState === 'approved' &&
    !isAiMeasurement &&
    !isMeasSuperseded &&
    measProvenance !== 'unknown';

  const measValidationStatus = !isMeasAnatomicallyValid || measStatus === 'invalid'
    ? 'invalid'
    : isMeasExplicitlyApproved
      ? 'approved'
      : measApprovalState;

  const measArtifact: PipelineArtifactRecord = {
    artifactId: 'art-measurements',
    artifactType: 'measurements',
    nodeCategory: 'independent_source_input',
    status: measStatus,
    revisionId: measRevisionId,
    inputFingerprint: measFingerprint,
    generatedContentFingerprint: measFingerprint,
    engineVersion: currentEngineVer,
    staleReason: measStaleReason,
    regenerationRequired: measStatus === 'stale',
    validationStatus: measValidationStatus,
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 3. INDEPENDENT SOURCE INPUT: Fabric Properties
  // =========================================================================
  const fabricObj = inputs.fabric ?? spec.fabric;
  const fabricRevisionId = `fab-${fabricObj.id}`;
  const enh = fabricObj as Partial<EnhancedFabricProperty> | undefined;
  const resolvedFabricProvenance =
    enh?.provenance ??
    ('fabricProvenance' in spec && spec.fabricProvenance ? spec.fabricProvenance : 'unknown');

  const fabricFingerprint = computeArtifactInputFingerprint({
    id: fabricObj.id,
    name: fabricObj.name,
    composition: fabricObj.composition ?? '',
    weight: fabricObj.weight,
    stretch: fabricObj.stretch,
    recommendedEaseCm: fabricObj.recommendedEaseCm,
    gsm: enh?.gsm ?? null,
    thicknessMm: enh?.thicknessMm ?? null,
    moldingFactor: enh?.moldingFactor ?? null,
    directional: enh?.directional ? {
      warp: enh.directional.warp ? {
        shrinkagePercent: enh.directional.warp.shrinkagePercent,
        stretchPercent: enh.directional.warp.stretchPercent
      } : null,
      weft: enh.directional.weft ? {
        shrinkagePercent: enh.directional.weft.shrinkagePercent,
        stretchPercent: enh.directional.weft.stretchPercent
      } : null,
      bias: enh.directional.bias ? {
        stretchPercent: enh.directional.bias.stretchPercent
      } : null
    } : null,
    fabricRevision: 'fabricRevision' in spec && spec.fabricRevision
      ? spec.fabricRevision
      : (enh?.revision ?? null),
    fabricProvenance: resolvedFabricProvenance
  });

  const fabricArtifact: PipelineArtifactRecord = {
    artifactId: 'art-fabric',
    artifactType: 'fabric',
    nodeCategory: 'independent_source_input',
    status: 'current',
    revisionId: fabricRevisionId,
    inputFingerprint: fabricFingerprint,
    generatedContentFingerprint: fabricFingerprint,
    engineVersion: currentEngineVer,
    regenerationRequired: false,
    validationStatus: resolvedFabricProvenance !== 'unknown' && resolvedFabricProvenance !== 'unverified'
      ? 'verified'
      : 'unverified-provenance',
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 4. INDEPENDENT SOURCE INPUT: Grading Rules & Chart
  // =========================================================================
  const gradingRulesVer = inputs.gradingRulesVersion ?? 'iso8559-standard';
  const gradingRulesFingerprint = computeArtifactInputFingerprint({
    system: 'standard-iso-8559',
    baseSize: 'M',
    version: gradingRulesVer,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
  });

  const gradingRulesArtifact: PipelineArtifactRecord = {
    artifactId: 'art-grading-rules',
    artifactType: 'grading-rules',
    nodeCategory: 'independent_source_input',
    status: 'current',
    revisionId: `rules-grading-${gradingRulesVer}`,
    inputFingerprint: gradingRulesFingerprint,
    generatedContentFingerprint: gradingRulesFingerprint,
    engineVersion: currentEngineVer,
    regenerationRequired: false,
    validationStatus: 'standardized',
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 5. INDEPENDENT SOURCE INPUT: Drafting Engine
  // =========================================================================
  const draftingEngineFingerprint = computeArtifactInputFingerprint({
    engine: 'Patroner Core CAD',
    version: currentEngineVer
  });

  const draftingEngineArtifact: PipelineArtifactRecord = {
    artifactId: 'art-drafting-engine',
    artifactType: 'drafting-engine',
    nodeCategory: 'independent_source_input',
    status: 'current',
    revisionId: `engine-patroner-v${currentEngineVer}`,
    inputFingerprint: draftingEngineFingerprint,
    generatedContentFingerprint: draftingEngineFingerprint,
    engineVersion: currentEngineVer,
    regenerationRequired: false,
    validationStatus: 'stable',
    upstreamDependencies: [],
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 6. DERIVED ARTIFACT: Finished Garment Dimensions
  // Depends on: Specification + Measurements + Fabric
  // =========================================================================
  const finishedDimsInputFingerprint = computeArtifactInputFingerprint({
    specFingerprint,
    measFingerprint,
    fabricFingerprint,
    targetLengthCm: specLengthCm,
    explicitEaseCm: spec.explicitEaseCm,
    activeSize: inputs.activeSize
  });

  const expectedDims = isMeasAnatomicallyValid
    ? calculateGarmentDimensions(inputs.measurements, spec.easeProfile, fabricObj, {
        targetLengthCm: specLengthCm,
        explicitEaseCm: spec.explicitEaseCm
      })
    : null;

  const finishedDimsContentFingerprint = computeArtifactInputFingerprint({
    finishedDimsInputFingerprint,
    expectedDims
  });

  let finishedDimsStatus: PipelineArtifactStatus = 'current';
  let finishedDimsStaleReason: string | undefined = undefined;

  // Check if measurements changed relative to drafted patternPieces even when no snapshot is passed
  let piecesMeasurementMismatchReason: string | undefined = undefined;
  const pieces = inputs.patternPieces;
  if (pieces && pieces.length > 0 && spec.garmentCategory === 'skirt' && expectedDims) {
    const backSkirt = pieces.find(p =>
      p.pieceCode === 'SK-02' ||
      p.pieceCode.toLowerCase().includes('back') ||
      (p.name && p.name.toLowerCase().includes('back'))
    );
    const expectedBackDartX = (expectedDims.garmentWaistCm / 4) * 0.45;
    if (backSkirt?.darts?.[0]?.apex && Math.abs(backSkirt.darts[0].apex.x - expectedBackDartX) > 0.02) {
      piecesMeasurementMismatchReason =
        `Drafted skirt waist geometry (back dart apex x=${backSkirt.darts[0].apex.x.toFixed(2)} cm) does not match active waist measurement (${inputs.measurements.waist} cm).`;
    }

    const frontSkirt = pieces.find(p =>
      p.pieceCode === 'SK-01' ||
      p.pieceCode.toLowerCase().includes('front') ||
      (p.name && p.name.toLowerCase().includes('front'))
    );
    const sideLowerSeg = frontSkirt?.stitchingContour?.segments?.find(s => s.id === 'fs-side-lower');
    const expectedQuarterHip = expectedDims.garmentHipCm / 4;
    const expectedWaistToHip = inputs.measurements.waistToHip || 20.5;
    if (
      sideLowerSeg?.end &&
      (Math.abs(sideLowerSeg.end.x - expectedQuarterHip) > 0.02 ||
        Math.abs(sideLowerSeg.end.y - expectedWaistToHip) > 0.02)
    ) {
      piecesMeasurementMismatchReason =
        `Drafted skirt hip geometry (sideHip=(${sideLowerSeg.end.x.toFixed(2)}, ${sideLowerSeg.end.y.toFixed(2)})) does not match active hip/waistToHip measurements (${inputs.measurements.lowHip} cm / ${expectedWaistToHip} cm).`;
    }
  }

  if (measStatus !== 'current') {
    finishedDimsStatus = 'stale';
    finishedDimsStaleReason = 'Underlying body measurements are not current.';
    staleReasons.push(finishedDimsStaleReason);
  } else if (!measurementSetValuesMatch) {
    finishedDimsStatus = 'stale';
    finishedDimsStaleReason = 'Finished dimensions are stale: active measurements diverge from measurementSet record.';
    staleReasons.push(finishedDimsStaleReason);
  } else if (inputs.productionSnapshot) {
    const snapMeas = inputs.productionSnapshot.measurementSet.values;
    const activeMeas = (inputs.measurements as unknown) as Record<string, unknown>;
    for (const [k, v] of Object.entries(activeMeas)) {
      if (typeof v === 'number') {
        const snapV = snapMeas[k];
        if (typeof snapV !== 'number' || Math.abs(snapV - v) > 0.001) {
          finishedDimsStatus = 'stale';
          finishedDimsStaleReason = `Finished dimensions are stale: measurement '${k}' changed from ${snapV} to ${v}.`;
          staleReasons.push(finishedDimsStaleReason);
          break;
        }
      }
    }
  } else if (piecesMeasurementMismatchReason) {
    finishedDimsStatus = 'stale';
    finishedDimsStaleReason = `Finished dimensions are stale: ${piecesMeasurementMismatchReason}`;
    staleReasons.push(finishedDimsStaleReason);
  }

  const finishedDimsArtifact: PipelineArtifactRecord = {
    artifactId: 'art-finished-dimensions',
    artifactType: 'finished-dimensions',
    nodeCategory: 'derived_artifact',
    status: finishedDimsStatus,
    revisionId: `dims-${specRevisionId}-${inputs.activeSize}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: finishedDimsInputFingerprint,
    generatedContentFingerprint: finishedDimsContentFingerprint,
    engineVersion: currentEngineVer,
    staleReason: finishedDimsStaleReason,
    regenerationRequired: finishedDimsStatus === 'stale',
    validationStatus: finishedDimsStatus === 'stale' ? 'stale' : 'calculated',
    upstreamDependencies: [specArtifact.artifactId, measArtifact.artifactId, fabricArtifact.artifactId],
    upstreamFingerprints: {
      specification: specFingerprint,
      measurements: measFingerprint,
      fabric: fabricFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 7. DERIVED ARTIFACT: Drafting Configuration
  // Depends on: Specification + Finished Dimensions + Fabric
  // =========================================================================
  const draftingConfigInputFingerprint = computeArtifactInputFingerprint({
    specFingerprint,
    finishedDimsInputFingerprint,
    fabricFingerprint
  });

  const draftingConfigStatus: PipelineArtifactStatus = finishedDimsStatus === 'stale' ? 'stale' : 'current';

  const draftingConfigArtifact: PipelineArtifactRecord = {
    artifactId: 'art-drafting-configuration',
    artifactType: 'drafting-configuration',
    nodeCategory: 'derived_artifact',
    status: draftingConfigStatus,
    revisionId: `config-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: draftingConfigInputFingerprint,
    generatedContentFingerprint: draftingConfigInputFingerprint,
    engineVersion: currentEngineVer,
    staleReason: draftingConfigStatus === 'stale' ? 'Finished dimensions are stale.' : undefined,
    regenerationRequired: draftingConfigStatus === 'stale',
    validationStatus: draftingConfigStatus === 'stale' ? 'stale' : 'ready',
    upstreamDependencies: [specArtifact.artifactId, finishedDimsArtifact.artifactId, fabricArtifact.artifactId],
    upstreamFingerprints: {
      specification: specFingerprint,
      'finished-dimensions': finishedDimsInputFingerprint,
      fabric: fabricFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 8. DERIVED ARTIFACT: Pattern Drafting (Geometry)
  // Depends on: Specification + Measurements + Finished Dimensions + Fabric + Drafting Engine
  // =========================================================================
  let draftingStatus: PipelineArtifactStatus = draftingConfigStatus === 'stale' ? 'stale' : 'current';
  let draftingStaleReason: string | undefined = draftingConfigStatus === 'stale'
    ? (piecesMeasurementMismatchReason ?? 'Finished dimensions or drafting configuration is stale.')
    : undefined;
  const affectedDraftingPaths: string[] = [];

  const draftingInputFingerprint = computeArtifactInputFingerprint({
    specFingerprint,
    measFingerprint,
    fabricFingerprint,
    category: spec.garmentCategory,
    lengthCm: specLengthCm,
    explicitEaseCm: spec.explicitEaseCm,
    engineVersion: currentEngineVer
  });

  const draftingContentFingerprint = computeArtifactInputFingerprint(
    pieces
      ? pieces.map(p => ({
          id: p.id,
          pieceCode: p.pieceCode,
          garmentCategory: p.garmentCategory,
          boundingBox: p.boundingBox,
          cutPathData: p.cutPathData,
          sewPathData: p.sewPathData,
          seamAllowanceWidthCm: p.seamAllowanceWidthCm,
          darts: p.darts
        }))
      : []
  );

  if (!pieces || pieces.length === 0) {
    draftingStatus = 'stale';
    draftingStaleReason = 'Pattern pieces have not been drafted.';
    staleReasons.push(draftingStaleReason);
    requiredActions.push('Execute deterministic pattern drafting for current specification.');
  } else {
    // 1. Check if pieces match current specification category
    const pieceCategoryMismatch = pieces.some(p => p.garmentCategory && p.garmentCategory !== spec.garmentCategory);
    if (pieceCategoryMismatch) {
      draftingStatus = 'stale';
      draftingStaleReason = `Drafted pieces category does not match active specification '${spec.garmentCategory}'.`;
      affectedDraftingPaths.push('garmentCategory');
      staleReasons.push(draftingStaleReason);
      requiredActions.push('Regenerate pattern geometry for matching garment category.');
    }

    // 2. Check if drafted piece geometry matches target specification length
    if (spec.garmentCategory === 'skirt') {
      const frontSkirt = pieces.find(p =>
        p.pieceCode === 'SK-01' ||
        p.pieceCode.toLowerCase().includes('front') ||
        (p.name && p.name.toLowerCase().includes('front'))
      );
      if (frontSkirt && frontSkirt.boundingBox) {
        const pieceHeight = frontSkirt.boundingBox.heightCm;
        const specAllowances = 'allowances' in spec ? spec.allowances : undefined;
        const allowancesHeight = (specAllowances?.hemAllowanceCm ?? 3.0) + (specAllowances?.waistAllowanceCm ?? 1.0) + 0.8;
        const isNetLengthMatching = Math.abs(pieceHeight - specLengthCm) <= 2.5;
        const isCutLengthMatching = Math.abs(pieceHeight - (specLengthCm + allowancesHeight)) <= 3.5;
        if (!isNetLengthMatching && !isCutLengthMatching) {
          draftingStatus = 'stale';
          draftingStaleReason = `Drafted front skirt height (${pieceHeight.toFixed(1)} cm) does not match specification target length (${specLengthCm.toFixed(1)} cm).`;
          affectedDraftingPaths.push('lengthCm');
          staleReasons.push(draftingStaleReason);
          requiredActions.push('Regenerate pattern geometry with updated target length.');
        }
      }
    }

    // 3. Check if drafted geometry mismatches active measurements
    if (piecesMeasurementMismatchReason && draftingStatus !== 'stale') {
      draftingStatus = 'stale';
      draftingStaleReason = piecesMeasurementMismatchReason;
      affectedDraftingPaths.push('measurements');
      staleReasons.push(draftingStaleReason);
      requiredActions.push('Regenerate pattern geometry with updated body measurements.');
    }

    // 4. Check engine version mismatch
    if (inputs.engineVersion && inputs.engineVersion !== CURRENT_ENGINE_VERSION) {
      draftingStatus = 'stale';
      draftingStaleReason = `Drafting engine version changed from '${inputs.engineVersion}' to '${CURRENT_ENGINE_VERSION}'.`;
      affectedDraftingPaths.push('engineVersion');
      staleReasons.push(draftingStaleReason);
      requiredActions.push('Regenerate pattern geometry under the current drafting engine.');
    }
  }

  const draftingArtifact: PipelineArtifactRecord = {
    artifactId: 'art-drafting',
    artifactType: 'drafting',
    nodeCategory: 'derived_artifact',
    status: draftingStatus,
    revisionId: `draft-${specRevisionId}-${inputs.activeSize}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: draftingInputFingerprint,
    generatedContentFingerprint: draftingContentFingerprint,
     staleReason: draftingStaleReason,
    affectedInputPaths: affectedDraftingPaths.length > 0 ? affectedDraftingPaths : undefined,
    regenerationRequired: draftingStatus === 'stale',
    validationStatus: pieces && pieces.length > 0 ? 'drafted' : 'empty',
    upstreamDependencies: [
      specArtifact.artifactId,
      measArtifact.artifactId,
      fabricArtifact.artifactId,
      finishedDimsArtifact.artifactId,
      draftingEngineArtifact.artifactId
    ],
    upstreamFingerprints: {
      specification: specFingerprint,
      measurements: measFingerprint,
      fabric: fabricFingerprint,
      'finished-dimensions': finishedDimsInputFingerprint,
      'drafting-engine': draftingEngineFingerprint
    },
    engineVersion: currentEngineVer,
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 9. DERIVED ARTIFACT: Geometry & Seam Validation
  // Depends on: Pattern Drafting
  // =========================================================================
  const valReport = inputs.validationReport;
  let geomValStatus: PipelineArtifactStatus = 'current';
  let geomStaleReason: string | undefined = undefined;

  if (draftingStatus === 'stale') {
    geomValStatus = 'stale';
    geomStaleReason = 'Geometry validation is stale because drafted geometry is stale.';
  } else if (inputs.productionSnapshot && pieces && pieces.length > 0) {
    const snapPieces = inputs.productionSnapshot.patternPieces;
    const snapPieceCodes = new Set(snapPieces.map(p => p.pieceCode));
    const pieceMismatch = pieces.length !== snapPieces.length || pieces.some(p => !snapPieceCodes.has(p.pieceCode));
    if (pieceMismatch) {
      geomValStatus = 'stale';
      geomStaleReason = 'Geometry validation is stale: pattern piece count or identities have changed.';
      staleReasons.push(geomStaleReason);
    }
  } else if (!valReport) {
    geomValStatus = 'pending';
    geomStaleReason = 'Geometry has not been validated against seam consistency checks.';
  } else if (!valReport.isValid) {
    geomValStatus = 'invalid';
    geomStaleReason = `Geometry validation failed with ${valReport.failureCount || 1} error(s).`;
    staleReasons.push(geomStaleReason);
    requiredActions.push('Resolve seam discrepancies in Pattern CAD.');
  }

  const geomValContentFingerprint = computeArtifactInputFingerprint({
    draftingContentFingerprint,
    isValid: valReport?.isValid ?? false,
    status: valReport?.status ?? 'not_assessed',
    passedCount: valReport?.passedCount ?? 0,
    failureCount: valReport?.failureCount ?? 0
  });

  const geomValArtifact: PipelineArtifactRecord = {
    artifactId: 'art-geometry-validation',
    artifactType: 'geometry-validation',
    nodeCategory: 'derived_artifact',
    status: geomValStatus,
    revisionId: `val-${draftingArtifact.revisionId}`,
    sourceRevisionId: draftingArtifact.revisionId,
    inputFingerprint: draftingInputFingerprint,
    generatedContentFingerprint: geomValContentFingerprint,
    engineVersion: currentEngineVer,
    staleReason: geomStaleReason,
    regenerationRequired: geomValStatus === 'stale' || geomValStatus === 'invalid',
    validationStatus: valReport?.isValid ? 'valid' : 'invalid',
    upstreamDependencies: [draftingArtifact.artifactId],
    upstreamFingerprints: {
      drafting: draftingInputFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 10. DERIVED ARTIFACT: Pattern Grading (Multi-Size)
  // Depends on: Specification + Drafting + Grading Rules
  // =========================================================================
  let gradingStatus: PipelineArtifactStatus = 'current';
  let gradingStaleReason: string | undefined = undefined;
  let gradingValidationStatus = 'graded';

  if (draftingStatus === 'stale' || geomValStatus === 'invalid' || geomValStatus === 'stale') {
    gradingStatus = 'stale';
    gradingValidationStatus = 'unvalidated';
    gradingStaleReason = 'Grading is stale because base geometry, dimensions, or measurements are stale or invalid.';
  } else if (inputs.productionSnapshot) {
    const snapMeas = inputs.productionSnapshot.measurementSet.values;
    const activeMeas = (inputs.measurements as unknown) as Record<string, unknown>;
    for (const [k, v] of Object.entries(activeMeas)) {
      if (typeof v === 'number') {
        const snapV = snapMeas[k];
        if (typeof snapV !== 'number' || Math.abs(snapV - v) > 0.001) {
          gradingStatus = 'stale';
          gradingValidationStatus = 'unvalidated';
          gradingStaleReason = `Grading is stale because base measurements (${k}) have changed.`;
          staleReasons.push(gradingStaleReason);
          break;
        }
      }
    }
  }

  if (inputs.gradingArtifact && gradingStatus === 'current') {
    const ga = inputs.gradingArtifact;
    const gaCheck = verifyGradingArtifactIntegrity(ga);
    const expectedScope = ('projectId' in spec ? spec.projectId : undefined) ?? inputs.productionSnapshot?.projectId ?? '';
    const expectedMeasFp =
      inputs.measurementSet && 'canonicalFingerprint' in inputs.measurementSet
        ? inputs.measurementSet.canonicalFingerprint
        : measFingerprint;

    if (gaCheck.isTampered) {
      gradingStatus = 'invalid';
      gradingValidationStatus = 'tampered';
      gradingStaleReason = gaCheck.reason ?? 'Grading artifact canonical fingerprint mismatch.';
      staleReasons.push(gradingStaleReason);
    } else if (ga.lifecycleState === 'revoked' || Boolean(ga.revocationReason)) {
      gradingStatus = 'revoked';
      gradingValidationStatus = 'revoked';
      gradingStaleReason = gaCheck.reason ?? 'Grading artifact has been revoked.';
      staleReasons.push(gradingStaleReason);
    } else if (ga.lifecycleState === 'superseded' || Boolean(ga.supersededByRevisionId)) {
      gradingStatus = 'stale';
      gradingValidationStatus = 'superseded';
      gradingStaleReason = gaCheck.reason ?? 'Grading artifact has been superseded.';
      staleReasons.push(gradingStaleReason);
    } else if (gaCheck.isSizeRangeIncomplete) {
      gradingStatus = 'invalid';
      gradingValidationStatus = 'size-range-incomplete';
      gradingStaleReason = gaCheck.reason ?? 'Grading artifact size range is incomplete.';
      staleReasons.push(gradingStaleReason);
    } else if (gaCheck.isValidationFailed) {
      gradingStatus = 'invalid';
      gradingValidationStatus = 'validation-failed';
      gradingStaleReason = gaCheck.reason ?? 'Grading artifact geometry or cross-size validation failed.';
      staleReasons.push(gradingStaleReason);
    } else if (expectedScope && (ga.projectId !== expectedScope || ga.tenantId !== expectedScope)) {
      gradingStatus = 'invalid';
      gradingValidationStatus = 'scope-mismatch';
      gradingStaleReason = `Grading artifact project/tenant ('${ga.projectId}'/'${ga.tenantId}') does not match active project ('${expectedScope}').`;
      staleReasons.push(gradingStaleReason);
    } else if (
      ga.sourceSpecificationId !== specGarmentId ||
      ga.sourceSpecificationRevisionId !== specRevisionId ||
      ga.sourceSpecificationFingerprint !== specFingerprint
    ) {
      gradingStatus = 'stale';
      gradingValidationStatus = 'stale-specification';
      gradingStaleReason = 'Grading artifact source specification lineage does not match active specification.';
      staleReasons.push(gradingStaleReason);
    } else if (inputs.productionSnapshot && ga.sourcePatternRevisionId !== inputs.productionSnapshot.revisionId) {
      gradingStatus = 'stale';
      gradingValidationStatus = 'stale-pattern-revision';
      gradingStaleReason = `Grading artifact sourcePatternRevisionId ('${ga.sourcePatternRevisionId}') does not match active snapshot ('${inputs.productionSnapshot.revisionId}').`;
      staleReasons.push(gradingStaleReason);
    } else if (
      ga.sourceMeasurementSetFingerprint !== measFingerprint &&
      ga.sourceMeasurementSetFingerprint !== expectedMeasFp
    ) {
      gradingStatus = 'stale';
      gradingValidationStatus = 'stale-measurements';
      gradingStaleReason = 'Grading artifact sourceMeasurementSetFingerprint does not match active measurement set fingerprint.';
      staleReasons.push(gradingStaleReason);
    } else if (
      ga.gradingRuleSetRevision !== `rules-grading-${gradingRulesVer}` &&
      ga.gradingRuleSetRevision !== gradingRulesVer
    ) {
      gradingStatus = 'stale';
      gradingValidationStatus = 'stale-grading-rules';
      gradingStaleReason = `Grading artifact gradingRuleSetRevision ('${ga.gradingRuleSetRevision}') does not match active grading rules ('${gradingRulesVer}').`;
      staleReasons.push(gradingStaleReason);
    } else if (ga.gradingRuleSetFingerprint !== gradingRulesFingerprint) {
      gradingStatus = 'stale';
      gradingValidationStatus = 'stale-grading-rules';
      gradingStaleReason = 'Grading artifact gradingRuleSetFingerprint does not match active grading rules fingerprint.';
      staleReasons.push(gradingStaleReason);
    } else if (ga.baseSize !== inputs.activeSize) {
      gradingStatus = 'stale';
      gradingValidationStatus = 'base-size-mismatch';
      gradingStaleReason = `Grading artifact baseSize ('${ga.baseSize}') does not match active size ('${inputs.activeSize}').`;
      staleReasons.push(gradingStaleReason);
    }
  }

  const gradingContentFingerprint = computeArtifactInputFingerprint(
    inputs.gradingArtifact
      ? {
          specFingerprint,
          draftingContentFingerprint,
          gradingRulesFingerprint,
          gradingSummary: inputs.gradingSummary ?? null,
          gradingArtifactFingerprint: inputs.gradingArtifact.canonicalFingerprint
        }
      : {
          specFingerprint,
          draftingContentFingerprint,
          gradingRulesFingerprint,
          gradingSummary: inputs.gradingSummary ?? null
        }
  );

  const gradingArtifact: PipelineArtifactRecord = {
    artifactId: 'art-grading',
    artifactType: 'grading',
    nodeCategory: 'derived_artifact',
    status: gradingStatus,
    revisionId: inputs.gradingArtifact ? inputs.gradingArtifact.gradingRevisionId : `grade-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: specFingerprint,
    generatedContentFingerprint: gradingContentFingerprint,
    engineVersion: currentEngineVer,
    staleReason: gradingStaleReason,
    regenerationRequired: gradingStatus === 'stale' || gradingStatus === 'invalid' || gradingStatus === 'revoked',
    validationStatus: gradingValidationStatus,
    upstreamDependencies: [specArtifact.artifactId, draftingArtifact.artifactId, gradingRulesArtifact.artifactId],
    upstreamFingerprints: {
      specification: specFingerprint,
      drafting: draftingInputFingerprint,
      'grading-rules': gradingRulesFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 11. DERIVED ARTIFACT: 3D Assembly & Seam Definition
  // =========================================================================
  const assemblyContentFingerprint = computeArtifactInputFingerprint({
    specFingerprint,
    draftingContentFingerprint
  });

  const assemblyArtifact: PipelineArtifactRecord = {
    artifactId: 'art-assembly',
    artifactType: 'assembly',
    nodeCategory: 'derived_artifact',
    status: draftingStatus === 'stale' ? 'stale' : 'current',
    revisionId: `asm-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: specFingerprint,
    generatedContentFingerprint: assemblyContentFingerprint,
    engineVersion: currentEngineVer,
    staleReason: draftingStatus === 'stale' ? 'Assembly is stale because pattern drafting is stale.' : undefined,
    regenerationRequired: draftingStatus === 'stale',
    validationStatus: draftingStatus === 'stale' ? 'stale' : 'verified',
    upstreamDependencies: [specArtifact.artifactId, draftingArtifact.artifactId],
    upstreamFingerprints: {
      specification: specFingerprint,
      drafting: draftingInputFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 12. DERIVED ARTIFACT: Production Pattern Revision Snapshot
  // =========================================================================
  const snap = inputs.productionSnapshot;
  let snapStatus: PipelineArtifactStatus = 'current';
  let snapStaleReason: string | undefined = undefined;

  if (!snap) {
    snapStatus = 'pending';
    snapStaleReason = 'Production pattern revision snapshot has not been generated.';
    staleReasons.push(snapStaleReason);
    requiredActions.push('Generate production pattern snapshot for approved specification.');
  } else {
    // 1. Recompute canonical fingerprint to verify snapshot integrity
    try {
      const computedFp = computeCanonicalRevisionFingerprint(snap);
      if (computedFp !== snap.canonicalFingerprint) {
        snapStatus = 'invalid';
        snapStaleReason = 'Snapshot canonical fingerprint mismatch; payload has been tampered with or corrupted.';
        staleReasons.push(snapStaleReason);
        requiredActions.push('Regenerate production snapshot to restore integrity.');
      }
    } catch (err) {
      snapStatus = 'invalid';
      snapStaleReason = `Failed to verify snapshot fingerprint: ${err instanceof Error ? err.message : String(err)}`;
      staleReasons.push(snapStaleReason);
    }

    if (snapStatus !== 'invalid') {
      // 2. Check if snapshot references active specification version
      if (snap.designSpecification.version !== spec.version) {
        snapStatus = 'stale';
        snapStaleReason = `Snapshot design version (${snap.designSpecification.version}) is behind active specification v${spec.version}.`;
        staleReasons.push(snapStaleReason);
        requiredActions.push('Regenerate production snapshot to capture updated specification revision.');
      } else if (Math.abs(snap.designSpecification.lengthCm - specLengthCm) > 0.01) {
        snapStatus = 'stale';
        snapStaleReason = `Snapshot target length (${snap.designSpecification.lengthCm} cm) does not match specification (${specLengthCm} cm).`;
        staleReasons.push(snapStaleReason);
        requiredActions.push('Regenerate production snapshot with matching length.');
      } else if (snap.garmentCategory !== spec.garmentCategory) {
        snapStatus = 'stale';
        snapStaleReason = `Snapshot category '${snap.garmentCategory}' does not match active specification '${spec.garmentCategory}'.`;
        staleReasons.push(snapStaleReason);
        requiredActions.push('Regenerate snapshot for active category.');
      }

      if (snapStatus === 'current' && inputs.fabric && snap.fabricSpecification) {
        const snapFab = snap.fabricSpecification;
        const activeFab = inputs.fabric;
        const activeEnh = activeFab as Partial<EnhancedFabricProperty> | undefined;
        const provDiff = activeEnh?.provenance && snapFab.provenance !== activeEnh.provenance;
        const activeProvLot = (activeEnh?.provenance as unknown as Record<string, unknown> | undefined)?.batchLot;
        const snapProvLot = (snapFab.provenance as unknown as Record<string, unknown> | undefined)?.batchLot;
        const lotDiff = Boolean(activeProvLot && snapProvLot !== activeProvLot);
        const revDiff = activeEnh?.revision && snapFab.fabricRevision !== activeEnh.revision;
        const gsmDiff = activeEnh?.gsm !== undefined && snapFab.gsm !== undefined && activeEnh.gsm !== snapFab.gsm;
        const thickDiff = activeEnh?.thicknessMm !== undefined && snapFab.thicknessMm !== undefined && Math.abs(activeEnh.thicknessMm - snapFab.thicknessMm) > 0.001;
        if (snapFab.fabricId !== activeFab.id || snapFab.weight !== activeFab.weight || snapFab.stretch !== activeFab.stretch || provDiff || lotDiff || revDiff || gsmDiff || thickDiff) {
          snapStatus = 'stale';
          snapStaleReason = 'Production snapshot fabric properties or provenance do not match active fabric.';
          staleReasons.push(snapStaleReason);
        }
      }

      if (snapStatus === 'current' && inputs.measurements && snap.measurementSet) {
        if (!snapshotMeasurementsMatch) {
          snapStatus = 'stale';
          snapStaleReason = 'Active body measurements have changed since production snapshot was captured.';
          staleReasons.push(snapStaleReason);
          requiredActions.push('Regenerate production snapshot with active measurements.');
        }
      }

      if (snapStatus === 'current' && (draftingStatus === 'stale' || geomValStatus === 'stale' || gradingStatus === 'stale')) {
        snapStatus = 'stale';
        snapStaleReason = 'Underlying pattern drafting, validation, or grading is stale.';
        staleReasons.push(snapStaleReason);
      }
    }
  }

  const snapArtifact: PipelineArtifactRecord = {
    artifactId: 'art-production-snapshot',
    artifactType: 'production-snapshot',
    nodeCategory: 'derived_artifact',
    status: snapStatus,
    revisionId: snap?.revisionId ?? `snap-pending-${specRevisionId}`,
    sourceRevisionId: specRevisionId,
    inputFingerprint: snap?.canonicalFingerprint ?? '',
    generatedContentFingerprint: snap?.canonicalFingerprint ?? '',
    engineVersion: snap?.engineProvenance?.engineVersion ?? currentEngineVer,
    staleReason: snapStaleReason,
    regenerationRequired: snapStatus === 'stale' || snapStatus === 'pending' || snapStatus === 'invalid',
    validationStatus: snap ? (snapStatus === 'current' ? 'snapshot-recorded' : snapStatus) : 'missing',
    upstreamDependencies: [
      specArtifact.artifactId,
      measArtifact.artifactId,
      draftingArtifact.artifactId,
      geomValArtifact.artifactId,
      gradingArtifact.artifactId
    ],
    upstreamFingerprints: {
      specification: specFingerprint,
      measurements: measFingerprint,
      drafting: draftingInputFingerprint
    },
    lastEvaluatedAt: now
  };

  // =========================================================================
  // 13. DERIVED ARTIFACT: Production Export (Tech Pack & Cutting Sheet)
  // Depends on: Specification Approval + Measurement Approval + Snapshot + Validation Cleanliness
  // =========================================================================
  let exportStatus: PipelineArtifactStatus = 'current';
  let exportStaleReason: string | undefined = undefined;

  if (draftingStatus === 'stale' || geomValStatus === 'stale' || snapStatus === 'stale' || finishedDimsStatus === 'stale' || gradingStatus === 'stale') {
    exportStatus = 'stale';
    exportStaleReason = 'Production export is blocked: one or more dependent engineering stages are stale.';
  } else if (specStatus !== 'approved') {
    exportStatus = 'pending';
    exportStaleReason = `Production documentation export is blocked: design specification is ${specStatus}.`;
  } else if (!isMeasExplicitlyApproved) {
    exportStatus = 'pending';
    exportStaleReason = `Production documentation export is blocked: body measurements are ${measApprovalState} (explicit approval and non-AI provenance required).`;
  } else if (geomValStatus !== 'current' || snapStatus !== 'current') {
    exportStatus = 'pending';
    exportStaleReason = 'Production export is pending completion of geometry validation or revision snapshot.';
  }

  const exportContentFingerprint = computeArtifactInputFingerprint({
    specFingerprint,
    snapFingerprint: snapArtifact.inputFingerprint,
    geomValContentFingerprint,
    exportStatus
  });

  const exportArtifact: PipelineArtifactRecord = {
    artifactId: 'art-production-export',
    artifactType: 'production-export',
    nodeCategory: 'derived_artifact',
    status: exportStatus,
    revisionId: `exp-${snapArtifact.revisionId}`,
    sourceRevisionId: snapArtifact.revisionId,
    inputFingerprint: snapArtifact.inputFingerprint,
    generatedContentFingerprint: exportContentFingerprint,
    engineVersion: currentEngineVer,
    staleReason: exportStaleReason,
    regenerationRequired: exportStatus !== 'current',
    validationStatus: exportStatus === 'current' ? 'export-ready' : 'export-blocked',
    upstreamDependencies: [specArtifact.artifactId, measArtifact.artifactId, snapArtifact.artifactId, geomValArtifact.artifactId],
    lastEvaluatedAt: now
  };

  // Collate all artifacts
  const independentInputs: Record<string, PipelineArtifactRecord> = {
    specification: specArtifact,
    measurements: measArtifact,
    fabric: fabricArtifact,
    'grading-rules': gradingRulesArtifact,
    'drafting-engine': draftingEngineArtifact
  };

  const derivedArtifacts: Record<string, PipelineArtifactRecord> = {
    'finished-dimensions': finishedDimsArtifact,
    'drafting-configuration': draftingConfigArtifact,
    drafting: draftingArtifact,
    'geometry-validation': geomValArtifact,
    grading: gradingArtifact,
    assembly: assemblyArtifact,
    'production-snapshot': snapArtifact,
    'production-export': exportArtifact
  };

  const artifacts: Record<PipelineArtifactType, PipelineArtifactRecord> = {
    specification: specArtifact,
    measurements: measArtifact,
    fabric: fabricArtifact,
    'grading-rules': gradingRulesArtifact,
    'drafting-engine': draftingEngineArtifact,
    'finished-dimensions': finishedDimsArtifact,
    'drafting-configuration': draftingConfigArtifact,
    drafting: draftingArtifact,
    'geometry-validation': geomValArtifact,
    grading: gradingArtifact,
    assembly: assemblyArtifact,
    'production-snapshot': snapArtifact,
    'production-export': exportArtifact
  };

  const hasStale = Object.values(artifacts).some(a => a.status === 'stale');
  const hasBlocking = Object.values(artifacts).some(a => a.status === 'invalid' || a.status === 'stale');
  const canExport =
    specStatus === 'approved' &&
    isMeasExplicitlyApproved &&
    !hasStale &&
    !hasBlocking &&
    snapStatus === 'current' &&
    geomValStatus === 'current';

  return deepFreeze({
    isPipelineSynchronized: !hasStale && specStatus === 'approved' && isMeasExplicitlyApproved,
    hasStaleArtifacts: hasStale,
    hasBlockingErrors: hasBlocking,
    activeSpecificationRevisionId: specRevisionId,
    activeMeasurementRevisionId: measRevisionId,
    independentInputs,
    derivedArtifacts,
    artifacts,
    staleReasons,
    requiredActions,
    canExportProductionDocumentation: canExport,
    evaluatedAt: now
  });
}

/**
 * Compares all 11 mandatory fields of two PipelineArtifactRecords for exact equality.
 */
function compareArtifactRecords(
  supplied: PipelineArtifactRecord,
  recomputed: PipelineArtifactRecord
): string[] {
  const diffs: string[] = [];
  if (supplied.artifactType !== recomputed.artifactType) {
    diffs.push(`artifactType ('${supplied.artifactType}' !== '${recomputed.artifactType}')`);
  }
  if (supplied.artifactId !== recomputed.artifactId) {
    diffs.push(`artifactId ('${supplied.artifactId}' !== '${recomputed.artifactId}')`);
  }
  if (supplied.revisionId !== recomputed.revisionId) {
    diffs.push(`revisionId ('${supplied.revisionId}' !== '${recomputed.revisionId}')`);
  }
  if (supplied.inputFingerprint !== recomputed.inputFingerprint) {
    diffs.push(`inputFingerprint ('${supplied.inputFingerprint}' !== '${recomputed.inputFingerprint}')`);
  }
  if ((supplied.generatedContentFingerprint ?? '') !== (recomputed.generatedContentFingerprint ?? '')) {
    diffs.push(
      `generatedContentFingerprint ('${supplied.generatedContentFingerprint ?? ''}' !== '${recomputed.generatedContentFingerprint ?? ''}')`
    );
  }
  if (supplied.status !== recomputed.status) {
    diffs.push(`status ('${supplied.status}' !== '${recomputed.status}')`);
  }
  if ((supplied.validationStatus ?? '') !== (recomputed.validationStatus ?? '')) {
    diffs.push(`validationStatus ('${supplied.validationStatus ?? ''}' !== '${recomputed.validationStatus ?? ''}')`);
  }
  const supDeps = Array.isArray(supplied.upstreamDependencies) ? supplied.upstreamDependencies.join(',') : '';
  const recDeps = Array.isArray(recomputed.upstreamDependencies) ? recomputed.upstreamDependencies.join(',') : '';
  if (supDeps !== recDeps) {
    diffs.push(`upstreamDependencies ([${supDeps}] !== [${recDeps}])`);
  }
  if ((supplied.engineVersion ?? '') !== (recomputed.engineVersion ?? '')) {
    diffs.push(`engineVersion ('${supplied.engineVersion ?? ''}' !== '${recomputed.engineVersion ?? ''}')`);
  }
  if ((supplied.staleReason ?? '') !== (recomputed.staleReason ?? '')) {
    diffs.push(`staleReason ('${supplied.staleReason ?? ''}' !== '${recomputed.staleReason ?? ''}')`);
  }
  if (Boolean(supplied.regenerationRequired) !== Boolean(recomputed.regenerationRequired)) {
    diffs.push(`regenerationRequired (${supplied.regenerationRequired} !== ${recomputed.regenerationRequired})`);
  }
  return diffs;
}

/**
 * Validates whether production manufacturing documentation (Tech Pack, Cutting Sheet)
 * may be exported.
 *
 * INDEPENDENT PRODUCTION EXPORT SECURITY BOUNDARY (Corrections E & F):
 * Fails closed. Requires all authoritative active inputs (specification, approved measurements,
 * fabric with provenance, current patternPieces, current validationReport, snapshot),
 * independently verifies specification approval and fingerprint (never trusting snapshot booleans),
 * and recomputes the full PipelineIntegrityReport to compare all 11 fields on every artifact record.
 */
export function validateProductionExportPrerequisites(
  report: PipelineIntegrityReport,
  snapshot?: ProductionPatternRevisionSnapshot,
  activeInputs?: ProductionExportActiveInputs
): ProductionExportValidationResult {
  // Fail-closed guard against missing or malformed report
  if (!report || !report.artifacts || typeof report.artifacts !== 'object') {
    return {
      isExportPermitted: false,
      rejectionCode: 'FORGED_REPORT_DETECTED',
      rejectionReason: 'Invalid, malformed or forged PipelineIntegrityReport provided.',
      blockingArtifacts: ['pipeline-integrity-report (malformed or missing artifacts record)'],
      warnings: []
    };
  }

  const requiredStages: PipelineArtifactType[] = [
    'specification',
    'measurements',
    'fabric',
    'grading-rules',
    'drafting-engine',
    'finished-dimensions',
    'drafting-configuration',
    'drafting',
    'geometry-validation',
    'grading',
    'assembly',
    'production-snapshot',
    'production-export'
  ];
  const coreStages: PipelineArtifactType[] = [
    'specification',
    'measurements',
    'fabric',
    'finished-dimensions',
    'drafting',
    'geometry-validation',
    'grading',
    'production-snapshot'
  ];
  const missingStages = coreStages.filter(s => !report.artifacts[s]);
  if (missingStages.length > 0) {
    return {
      isExportPermitted: false,
      rejectionCode: 'FORGED_REPORT_DETECTED',
      rejectionReason: `Pipeline integrity report is missing required stages: ${missingStages.join(', ')}`,
      blockingArtifacts: [`pipeline-integrity-report (missing stages: ${missingStages.join(', ')})`],
      warnings: []
    };
  }

  const blockingArtifacts: string[] = [];
  const warnings: string[] = [];
  let rejectionCode: ProductionExportRejectionCode | undefined = undefined;

  // 1. Verify Specification Approval from report
  const specArt = report.artifacts.specification;
  if (!specArt || specArt.status !== 'approved') {
    blockingArtifacts.push(`specification (${specArt?.status ?? 'missing'}: ${specArt?.staleReason ?? 'Formal approval required'})`);
    if (specArt?.status === 'revoked') {
      rejectionCode = 'SPECIFICATION_REVOKED';
    } else if (specArt?.validationStatus === 'superseded') {
      rejectionCode = 'SPECIFICATION_SUPERSEDED';
    } else if (specArt?.status === 'invalid') {
      rejectionCode = 'SPECIFICATION_INVALID';
    } else {
      rejectionCode = 'SPECIFICATION_UNAPPROVED';
    }
  }

  // 2. Verify Pipeline Artifact Stages from report (fail closed on stale/invalid/unapproved measurements)
  for (const [type, art] of Object.entries(report.artifacts)) {
    if (type !== 'specification' && type !== 'production-snapshot' && type !== 'production-export') {
      if (art.status === 'stale') {
        blockingArtifacts.push(`${type} (stale: ${art.staleReason ?? 'regeneration required'})`);
        if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = 'STALE_SOURCE_FINGERPRINT';
        }
      } else if (art.status === 'invalid') {
        blockingArtifacts.push(`${type} (invalid: ${art.staleReason ?? 'critical errors must be resolved'})`);
        if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = type === 'measurements' && art.staleReason?.includes('AI-estimated')
            ? 'AI_MEASUREMENT_NOT_PERMITTED'
            : 'UPSTREAM_STAGE_INVALID';
        }
      } else if (
        type === 'measurements' &&
        (art.status === 'pending' || art.validationStatus === 'unverified' || art.validationStatus === 'pending')
      ) {
        blockingArtifacts.push(`measurements (${art.validationStatus ?? art.status}: ${art.staleReason ?? 'Measurements require explicit approval'})`);
        if (!rejectionCode) rejectionCode = 'MEASUREMENT_UNAPPROVED';
      }
    }
  }

  // 3. Independent Snapshot Verification
  if (!snapshot) {
    blockingArtifacts.push('production-snapshot (missing: Authoritative snapshot required for export)');
    if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
      rejectionCode = 'SNAPSHOT_MISSING';
    }
  } else {
    // 3a. Literal Industrial Safety Invariant: isProductionReady MUST be false
    if ((snapshot as unknown as { isProductionReady: boolean }).isProductionReady !== false) {
      blockingArtifacts.push('isProductionReady (INDUSTRIAL SAFETY VIOLATION: isProductionReady cannot be asserted)');
      rejectionCode = 'INDUSTRIAL_SAFETY_VIOLATION';
    }

    // 3b. Recompute snapshot canonical fingerprint directly from payload
    try {
      const computedFp = computeCanonicalRevisionFingerprint(snapshot);
      if (computedFp !== snapshot.canonicalFingerprint) {
        blockingArtifacts.push('production-snapshot (tampered: Canonical fingerprint mismatch)');
        if (!rejectionCode || rejectionCode === 'UPSTREAM_STAGE_INVALID' || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = 'SNAPSHOT_GEOMETRY_TAMPERED';
        }
      }
    } catch {
      blockingArtifacts.push('production-snapshot (corrupt: Unable to recompute snapshot fingerprint)');
      if (!rejectionCode || rejectionCode === 'UPSTREAM_STAGE_INVALID') {
        rejectionCode = 'SNAPSHOT_CORRUPT';
      }
    }

    // 3c. Verify snapshot design approval flag
    if (!snapshot.approvalState || snapshot.approvalState.designApproval !== 'approved' || !snapshot.designSpecification?.isApproved) {
      blockingArtifacts.push('production-snapshot (design approval pending or not approved in snapshot)');
      if (!rejectionCode) rejectionCode = 'SPECIFICATION_UNAPPROVED';
    }

    // 3d. Verify snapshot engine version compatibility
    const expectedEngineVersion = activeInputs?.engineVersion ?? CURRENT_ENGINE_VERSION;
    if (!snapshot.engineProvenance || snapshot.engineProvenance.engineVersion !== expectedEngineVersion || snapshot.engineProvenance.engineVersion !== CURRENT_ENGINE_VERSION) {
      blockingArtifacts.push(`production-snapshot (engine version mismatch: '${snapshot.engineProvenance?.engineVersion}' !== '${CURRENT_ENGINE_VERSION}')`);
      if (!rejectionCode) rejectionCode = 'ENGINE_VERSION_MISMATCH';
    }

    // 3e. Verify physical validation classification
    if (
      snapshot.approvalState?.physicalPrototypeValidation === 'not-assessed' ||
      snapshot.approvalState?.physicalPrototypeValidation === 'incomplete'
    ) {
      warnings.push('Physical validation is unassessed or incomplete and has not undergone physical atelier trials.');
    }
  }

  // 4. Independent Active Specification Verification (Corrections A, B, C, E, G)
  if (activeInputs?.specification) {
    const activeSpecVerification = verifySpecificationApproval(
      activeInputs.specification,
      activeInputs.verificationContext
    );
    if (!activeSpecVerification.isValid) {
      blockingArtifacts.push(`active-specification (${activeSpecVerification.state}: ${activeSpecVerification.reason})`);
      if (activeSpecVerification.state === 'revoked') {
        rejectionCode = 'SPECIFICATION_REVOKED';
      } else if (activeSpecVerification.state === 'superseded') {
        rejectionCode = 'SPECIFICATION_SUPERSEDED';
      } else if (activeSpecVerification.state === 'invalid') {
        rejectionCode = activeSpecVerification.reason?.includes('authority') ||
          activeSpecVerification.reason?.includes('Verifier') ||
          activeSpecVerification.reason?.includes('credential') ||
          activeSpecVerification.reason?.includes('signature')
          ? 'INVALID_APPROVAL_AUTHORITY'
          : 'SPECIFICATION_INVALID';
      } else {
        rejectionCode = 'SPECIFICATION_UNAPPROVED';
      }
    }

    if (snapshot && snapshot.designSpecification) {
      const snapSpec = snapshot.designSpecification;
      const activeSpec = activeInputs.specification;
      const activeTd = activeSpec.targetFinishedDimensions as { lengthCm?: number; length?: number } | undefined;
      const activeLengthCm =
        'lengthCm' in activeSpec && typeof (activeSpec as { lengthCm?: number }).lengthCm === 'number'
          ? (activeSpec as { lengthCm: number }).lengthCm
          : (activeTd?.lengthCm ?? activeTd?.length ?? 0);

      if (snapSpec.version !== activeSpec.version) {
        blockingArtifacts.push(`snapshot-specification-mismatch (snapshot v${snapSpec.version} !== active v${activeSpec.version})`);
        if (!rejectionCode || rejectionCode === 'STALE_SOURCE_FINGERPRINT' || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = 'SNAPSHOT_SPECIFICATION_REVISION_MISMATCH';
        }
      }

      if (
        snapSpec.specificationRevisionId &&
        activeSpec.specificationRevisionId &&
        snapSpec.specificationRevisionId !== activeSpec.specificationRevisionId
      ) {
        blockingArtifacts.push(`snapshot-specification-mismatch (snapshot rev '${snapSpec.specificationRevisionId}' !== active rev '${activeSpec.specificationRevisionId}')`);
        if (!rejectionCode || rejectionCode === 'STALE_SOURCE_FINGERPRINT' || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = 'SNAPSHOT_SPECIFICATION_REVISION_MISMATCH';
        }
      }

      if (
        snapSpec.garmentCategory !== activeSpec.garmentCategory ||
        snapSpec.silhouette !== activeSpec.silhouette ||
        snapSpec.easeProfile !== activeSpec.easeProfile ||
        Math.abs(snapSpec.lengthCm - activeLengthCm) > 0.001 ||
        (activeSpec.dartStyle && snapSpec.dartStyle && snapSpec.dartStyle !== activeSpec.dartStyle) ||
        (activeSpec.sleeveEaseStrategy && snapSpec.sleeveEaseStrategy && snapSpec.sleeveEaseStrategy !== activeSpec.sleeveEaseStrategy)
      ) {
        blockingArtifacts.push('snapshot-specification-mismatch (snapshot specification parameters do not match active specification)');
        if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = 'SPECIFICATION_FINGERPRINT_MISMATCH';
        }
      }

      if ('fabric' in snapSpec && (snapSpec as Record<string, unknown>).fabric) {
        const activeFp = computeSpecificationFingerprint(activeSpec);
        const snapFp = computeSpecificationFingerprint(snapSpec as unknown as DesignSpecification);
        if (activeFp !== snapFp) {
          blockingArtifacts.push('snapshot-specification-mismatch (snapshot specification fingerprint does not match active specification fingerprint)');
          if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
            rejectionCode = 'SPECIFICATION_FINGERPRINT_MISMATCH';
          }
        }
      }
    }
  }

  // 5. Complete Measurements & Provenance Lineage Verification (Correction D & E)
  if (activeInputs?.measurements && snapshot && snapshot.measurementSet?.values) {
    const snapVals = snapshot.measurementSet.values;
    const activeVals = (activeInputs.measurements as unknown) as Record<string, unknown>;

    let measurementMismatch = false;
    for (const [k, v] of Object.entries(activeVals)) {
      if (typeof v === 'number') {
        const snapV = snapVals[k];
        if (typeof snapV !== 'number' || Math.abs(snapV - v) > 0.001) {
          measurementMismatch = true;
          break;
        }
      }
    }

    if (measurementMismatch) {
      blockingArtifacts.push('snapshot-measurements-mismatch (snapshot measurements do not match active body measurements)');
      if (!rejectionCode || rejectionCode === 'STALE_SOURCE_FINGERPRINT' || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
        rejectionCode = 'SNAPSHOT_MEASUREMENTS_MISMATCH';
      }
    }
  }

  if (activeInputs?.measurementSet) {
    if ('approvalState' in activeInputs.measurementSet) {
      const ms = activeInputs.measurementSet;
      if (
        ms.source === 'ai-estimated' ||
        ms.provenance === 'ai-estimated' ||
        (ms.perMeasurementOrigin && Object.values(ms.perMeasurementOrigin).includes('ai-estimated'))
      ) {
        blockingArtifacts.push('measurements (ai-estimated: AI-estimated measurements are not permitted as approved physical measurements)');
        if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = 'AI_MEASUREMENT_NOT_PERMITTED';
        }
      } else if (ms.source === 'unknown' || ms.provenance === 'unknown') {
        blockingArtifacts.push('measurements (missing-provenance: Measurement set provenance is unknown)');
        if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = 'MISSING_MEASUREMENT_PROVENANCE';
        }
      } else {
        const msIntegrity = verifyMeasurementSetIntegrity(ms);
        if (!msIntegrity.isApproved) {
          blockingArtifacts.push(`measurements (unapproved: ${msIntegrity.reason ?? 'Measurement set is not approved'})`);
          if (!rejectionCode || rejectionCode === 'STALE_SOURCE_FINGERPRINT') {
            rejectionCode = 'MEASUREMENT_UNAPPROVED';
          }
        }
      }
    }
  }

  if (snapshot?.measurementSet) {
    const snapMs = snapshot.measurementSet;
    const effectiveOrigin = activeInputs?.measurementProvenance ?? snapMs.defaultOrigin;
    if (
      effectiveOrigin === 'ai-estimated' ||
      (snapMs.perMeasurementOrigin && Object.values(snapMs.perMeasurementOrigin).includes('ai-estimated'))
    ) {
      blockingArtifacts.push('measurements (ai-estimated: AI-estimated measurements are not permitted for production export)');
      if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED' || rejectionCode === 'STALE_SOURCE_FINGERPRINT') {
        rejectionCode = 'AI_MEASUREMENT_NOT_PERMITTED';
      }
    } else if (effectiveOrigin === 'unknown') {
      blockingArtifacts.push('measurements (missing-provenance: Measurement origin is unknown)');
      if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED' || rejectionCode === 'STALE_SOURCE_FINGERPRINT') {
        rejectionCode = 'MISSING_MEASUREMENT_PROVENANCE';
      }
    }
    if (
      snapMs.approval?.state !== 'approved' ||
      !snapMs.approval.approvedBy ||
      !snapMs.approval.approvedAt ||
      activeInputs?.isMeasurementApproved === false ||
      (activeInputs?.measurementApprovalState && activeInputs.measurementApprovalState !== 'approved')
    ) {
      blockingArtifacts.push('measurements (unapproved: Snapshot or active measurement set is not approved)');
      if (!rejectionCode || rejectionCode === 'STALE_SOURCE_FINGERPRINT') {
        rejectionCode = 'MEASUREMENT_UNAPPROVED';
      }
    }
  }

  // 6. Complete Fabric & Provenance Lineage Verification (Correction E)
  if (activeInputs?.fabric && snapshot) {
    const snapFab = snapshot.fabricSpecification;
    const activeFab = activeInputs.fabric;
    const activeEnh = activeFab as Partial<EnhancedFabricProperty>;

    const gsmMismatch = activeEnh.gsm !== undefined && snapFab.gsm !== undefined && activeEnh.gsm !== snapFab.gsm;
    const thicknessMismatch = activeEnh.thicknessMm !== undefined && snapFab.thicknessMm !== undefined && Math.abs(activeEnh.thicknessMm - snapFab.thicknessMm) > 0.001;
    const compositionMismatch = activeFab.composition !== undefined && snapFab.composition !== undefined && activeFab.composition !== snapFab.composition;
    const provenanceMismatch = activeEnh.provenance !== undefined && snapFab.provenance !== activeEnh.provenance;
    const revisionMismatch = activeEnh.revision !== undefined && snapFab.fabricRevision !== undefined && activeEnh.revision !== snapFab.fabricRevision;

    if (
      activeFab.id !== snapFab.fabricId ||
      activeFab.weight !== snapFab.weight ||
      activeFab.stretch !== snapFab.stretch ||
      gsmMismatch ||
      thicknessMismatch ||
      compositionMismatch ||
      provenanceMismatch ||
      revisionMismatch
    ) {
      blockingArtifacts.push('snapshot-fabric-mismatch (snapshot fabric does not match active fabric properties)');
      if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
        rejectionCode = 'SNAPSHOT_FABRIC_MISMATCH';
      }
    }

    const effectiveFabProv =
      activeEnh.provenance ??
      (activeInputs.specification && 'fabricProvenance' in activeInputs.specification
        ? (activeInputs.specification as AuthoritativeGarmentSpecification).fabricProvenance
        : undefined) ??
      snapFab.provenance;

    if (!effectiveFabProv || effectiveFabProv === 'unknown' || effectiveFabProv === 'unverified') {
      blockingArtifacts.push(`fabric (missing-provenance: Fabric provenance is '${effectiveFabProv ?? 'missing'}')`);
      if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
        rejectionCode = 'MISSING_FABRIC_PROVENANCE';
      }
    }
  }

  // 7. Active Pattern Geometry, Validation Report & Grading Verification (Correction E)
  if (activeInputs?.patternPieces && snapshot) {
    const activePieces = activeInputs.patternPieces;
    const snapPieces = snapshot.patternPieces;
    if (activePieces.length === 0 || activePieces.length !== snapPieces.length) {
      blockingArtifacts.push('pattern-geometry (stale: Active pattern piece count does not match snapshot)');
      if (!rejectionCode) rejectionCode = 'STALE_PATTERN_GEOMETRY';
    } else {
      const snapMap = new Map(snapPieces.map(p => [p.pieceCode, p]));
      for (const ap of activePieces) {
        const sp = snapMap.get(ap.pieceCode);
        const rawApBb = ap.boundingBox as { widthCm?: number; heightCm?: number; width?: number; height?: number } | undefined;
        const apWidth = rawApBb?.widthCm ?? rawApBb?.width;
        const apHeight = rawApBb?.heightCm ?? rawApBb?.height;

        const widthMatches =
          apWidth === undefined ||
          !sp ||
          Math.abs(apWidth - sp.boundingBox.widthCm) <= 0.1 ||
          (sp.stitchingContour?.boundingBox !== undefined &&
            Math.abs(apWidth - sp.stitchingContour.boundingBox.widthCm) <= 0.1);
        const heightMatches =
          apHeight === undefined ||
          !sp ||
          Math.abs(apHeight - sp.boundingBox.heightCm) <= 0.1 ||
          (sp.stitchingContour?.boundingBox !== undefined &&
            Math.abs(apHeight - sp.stitchingContour.boundingBox.heightCm) <= 0.1);

        if (
          !sp ||
          ap.id !== sp.id ||
          ap.cutPathData !== sp.cutPathData ||
          ap.sewPathData !== sp.sewPathData ||
          !widthMatches ||
          !heightMatches
        ) {
          blockingArtifacts.push(`pattern-geometry (stale: Active pattern piece '${ap.pieceCode}' geometry does not match snapshot)`);
          if (!rejectionCode) rejectionCode = 'STALE_PATTERN_GEOMETRY';
          break;
        }
      }
    }
  }

  if (activeInputs?.validationReport) {
    if (!activeInputs.validationReport.isValid || (activeInputs.validationReport.failureCount ?? 0) > 0) {
      blockingArtifacts.push('geometry-validation (invalid: Active validation report is not valid)');
      if (!rejectionCode) rejectionCode = 'STALE_VALIDATION_REPORT';
    } else if (
      snapshot?.validation &&
      (activeInputs.validationReport.status !== snapshot.validation.status ||
        activeInputs.validationReport.passedCount !== snapshot.validation.passedCount ||
        activeInputs.validationReport.failureCount !== snapshot.validation.failureCount)
    ) {
      blockingArtifacts.push('geometry-validation (stale: Active validation report does not match snapshot validation)');
      if (!rejectionCode) rejectionCode = 'STALE_VALIDATION_REPORT';
    }
  }

  if (activeInputs?.gradingResult) {
    if (activeInputs.gradingResult.isOverallGradingValid === false || (activeInputs.gradingResult.failedSizeCount ?? 0) > 0) {
      blockingArtifacts.push('grading (invalid: Active grading result is invalid)');
      if (!rejectionCode) rejectionCode = 'STALE_GRADING_RESULT';
    } else if (
      snapshot?.gradingSummary &&
      (activeInputs.gradingResult.baseSize && activeInputs.gradingResult.baseSize !== snapshot.gradingSummary.baseSize ||
        activeInputs.gradingResult.gradeTableName && activeInputs.gradingResult.gradeTableName !== snapshot.gradingSummary.gradeTableName)
    ) {
      blockingArtifacts.push('grading (stale: Active grading result does not match snapshot grading summary)');
      if (!rejectionCode) rejectionCode = 'STALE_GRADING_RESULT';
    }
  }

  // 8. Mandatory Independent Active Inputs Check (Correction E)
  const missingActiveInputNames: string[] = [];
  if (!activeInputs?.specification) missingActiveInputNames.push('specification');
  if (!activeInputs?.measurements && !activeInputs?.measurementSet) missingActiveInputNames.push('measurements');
  if (!activeInputs?.fabric) missingActiveInputNames.push('fabric');
  if (!activeInputs?.patternPieces || activeInputs.patternPieces.length === 0) missingActiveInputNames.push('patternPieces');
  if (!activeInputs?.validationReport) missingActiveInputNames.push('validationReport');

  if (missingActiveInputNames.length > 0) {
    blockingArtifacts.push(
      `active-inputs (missing: Authoritative active inputs [${missingActiveInputNames.join(', ')}] are mandatory for independent export verification)`
    );
    if (!rejectionCode) {
      rejectionCode = 'MISSING_ACTIVE_INPUTS';
    }
  }

  // 9. Full Report Recomputation & 11-Field Artifact Comparison (Correction F)
  if (
    activeInputs?.specification &&
    activeInputs?.measurements &&
    (missingActiveInputNames.length === 0 || (activeInputs.patternPieces && activeInputs.validationReport))
  ) {
    try {
      const baselineRecomputedReport = evaluatePipelineDependencyIntegrity({
        specification: activeInputs.specification,
        measurements: activeInputs.measurements,
        measurementSet: activeInputs.measurementSet,
        measurementApprovalState: activeInputs.measurementApprovalState,
        measurementProvenance: activeInputs.measurementProvenance,
        isMeasurementApproved: activeInputs.isMeasurementApproved,
        activeSize: snapshot?.targetSize ?? 'M',
        fabric: activeInputs.fabric,
        patternPieces: activeInputs.patternPieces,
        validationReport: activeInputs.validationReport,
        productionSnapshot: snapshot,
        engineVersion: activeInputs.engineVersion,
        gradingRulesVersion: activeInputs.gradingRulesVersion,
        verificationContext: activeInputs.verificationContext,
        gradingSummary: activeInputs.gradingResult
      });

      const reportUsedGradingArtifact =
        Boolean(activeInputs.gradingArtifact) &&
        report.artifacts.grading?.generatedContentFingerprint !==
          baselineRecomputedReport.artifacts.grading?.generatedContentFingerprint;

      const recomputedReport = reportUsedGradingArtifact
        ? evaluatePipelineDependencyIntegrity({
            specification: activeInputs.specification,
            measurements: activeInputs.measurements,
            measurementSet: activeInputs.measurementSet,
            measurementApprovalState: activeInputs.measurementApprovalState,
            measurementProvenance: activeInputs.measurementProvenance,
            isMeasurementApproved: activeInputs.isMeasurementApproved,
            activeSize: snapshot?.targetSize ?? 'M',
            fabric: activeInputs.fabric,
            patternPieces: activeInputs.patternPieces,
            validationReport: activeInputs.validationReport,
            productionSnapshot: snapshot,
            engineVersion: activeInputs.engineVersion,
            gradingRulesVersion: activeInputs.gradingRulesVersion,
            verificationContext: activeInputs.verificationContext,
            gradingSummary: activeInputs.gradingResult,
            gradingArtifact: activeInputs.gradingArtifact
          })
        : baselineRecomputedReport;

      const reportMismatches: string[] = [];

      if (Boolean(report.hasStaleArtifacts) !== Boolean(recomputedReport.hasStaleArtifacts)) {
        reportMismatches.push(`hasStaleArtifacts (${report.hasStaleArtifacts} !== ${recomputedReport.hasStaleArtifacts})`);
      }
      if (Boolean(report.hasBlockingErrors) !== Boolean(recomputedReport.hasBlockingErrors)) {
        reportMismatches.push(`hasBlockingErrors (${report.hasBlockingErrors} !== ${recomputedReport.hasBlockingErrors})`);
      }

      for (const stage of requiredStages) {
        if (stage === 'grading' && reportUsedGradingArtifact && activeInputs.gradingArtifact) {
          // Grading artifact lineage/tampering is verified with specific error codes in Step 9b
          continue;
        }
        const suppliedArt = report.artifacts[stage];
        const recomputedArt = recomputedReport.artifacts[stage];
        if (!suppliedArt) {
          reportMismatches.push(`missing artifact record for stage '${stage}'`);
          continue;
        }
        const fieldDiffs = compareArtifactRecords(suppliedArt, recomputedArt);
        if (fieldDiffs.length > 0) {
          reportMismatches.push(`stage '${stage}' mismatch: ${fieldDiffs.join(', ')}`);
        }
      }

      if (reportMismatches.length > 0) {
        blockingArtifacts.push(
          `pipeline-integrity-report (forged: Report contradicts recomputed active dependency evaluation — ${reportMismatches.join('; ')})`
        );
        if (!rejectionCode || rejectionCode === 'MISSING_ACTIVE_INPUTS') {
          rejectionCode = 'FORGED_REPORT_DETECTED';
        }
      }
    } catch {
      blockingArtifacts.push('pipeline-integrity-report (evaluation-error: Failed to verify dependency report against active inputs)');
      if (!rejectionCode) rejectionCode = 'FORGED_REPORT_DETECTED';
    }
  }

  // 9b. Complete Grading Export Lineage Verification (Milestone 04.6.2.3.2 Phase 3 & Phase 4)
  // Grading applicability must NEVER be inferred from the omission of a grading input.
  if (missingActiveInputNames.length === 0) {
    const policy = activeInputs?.exportGradingPolicy;
    const policyMode = policy?.mode;

    if (policy !== undefined && policyMode !== 'graded-multi-size' && policyMode !== 'single-size-ungraded') {
      blockingArtifacts.push(
        `grading-policy (undeclared: Invalid or undeclared exportGradingPolicy.mode '${String(policyMode)}')`
      );
      if (!rejectionCode) {
        rejectionCode = 'GRADING_APPLICABILITY_UNDECLARED';
      }
    } else if (policyMode === 'single-size-ungraded') {
      // Single-size ungraded export requires an explicit non-empty nonGradingReason
      const reason = typeof policy?.nonGradingReason === 'string' ? policy.nonGradingReason.trim() : '';
      if (!reason) {
        blockingArtifacts.push(
          'grading-policy (undeclared: Single-size ungraded export requires an explicit non-empty nonGradingReason)'
        );
        if (!rejectionCode) {
          rejectionCode = 'GRADING_APPLICABILITY_UNDECLARED';
        }
      }

      // Single-size ungraded claim must not contradict attached graded pattern data or multi-size requirements
      const hasGradedArtifacts =
        Boolean(activeInputs?.gradingArtifact) ||
        Boolean(activeInputs?.gradingResult) ||
        Boolean(snapshot?.gradingSummary) ||
        Boolean(policy?.requiredSizes && policy.requiredSizes.length > 1);
      if (hasGradedArtifacts) {
        blockingArtifacts.push(
          'grading-scope-mismatch (contradictory: Single-size ungraded export policy declared, but graded pattern artifact or multi-size requirements are present)'
        );
        if (!rejectionCode) {
          rejectionCode = 'GRADING_SCOPE_MISMATCH';
        }
      }
    } else {
      // Default and explicit 'graded-multi-size' mode: AuthoritativeGradingArtifact is mandatory
      const ga = activeInputs?.gradingArtifact;
      if (!ga) {
        blockingArtifacts.push(
          'grading-artifact (missing: AuthoritativeGradingArtifact is mandatory for graded production export; grading applicability is never inferred from omission)'
        );
        if (!rejectionCode) {
          rejectionCode = 'GRADING_ARTIFACT_MISSING';
        }
      } else {
        // 1. Industrial safety invariant on grading artifact
        if ((ga as unknown as { isProductionReady?: boolean }).isProductionReady !== false) {
          blockingArtifacts.push(
            'isProductionReady (INDUSTRIAL SAFETY VIOLATION: gradingArtifact.isProductionReady cannot be asserted)'
          );
          rejectionCode = 'INDUSTRIAL_SAFETY_VIOLATION';
        }

        // 2. Cryptographic fingerprint, lifecycle state, per-size geometry, and cross-size validation integrity
        const gaIntegrity = verifyGradingArtifactIntegrity(ga);
        if (gaIntegrity.isTampered) {
          blockingArtifacts.push(
            `grading-artifact (tampered: ${gaIntegrity.reason ?? 'Grading artifact canonical fingerprint mismatch'})`
          );
          if (!rejectionCode) rejectionCode = 'GRADING_ARTIFACT_TAMPERED';
        } else if (ga.lifecycleState === 'revoked' || Boolean(ga.revocationReason)) {
          blockingArtifacts.push(
            `grading-artifact (revoked: ${gaIntegrity.reason ?? 'Grading artifact has been revoked'})`
          );
          if (!rejectionCode) rejectionCode = 'GRADING_ARTIFACT_REVOKED';
        } else if (ga.lifecycleState === 'superseded' || Boolean(ga.supersededByRevisionId)) {
          blockingArtifacts.push(
            `grading-artifact (superseded: ${gaIntegrity.reason ?? 'Grading artifact has been superseded'})`
          );
          if (!rejectionCode) rejectionCode = 'GRADING_ARTIFACT_SUPERSEDED';
        } else if (gaIntegrity.isSizeRangeIncomplete) {
          blockingArtifacts.push(
            `grading-artifact (size-range-incomplete: ${gaIntegrity.reason ?? 'Grading artifact size range is incomplete'})`
          );
          if (!rejectionCode) rejectionCode = 'GRADING_SIZE_RANGE_INCOMPLETE';
        } else if (gaIntegrity.isValidationFailed) {
          blockingArtifacts.push(
            `grading-artifact (validation-failed: ${gaIntegrity.reason ?? 'Grading artifact validation failed'})`
          );
          if (!rejectionCode) rejectionCode = 'GRADING_VALIDATION_FAILED';
        }

        // 3. Required sizes completeness check when exportGradingPolicy.requiredSizes is specified
        if (policy?.requiredSizes && policy.requiredSizes.length > 0) {
          const missingReqSizes = policy.requiredSizes.filter(
            sz =>
              !ga.sizeRange.includes(sz) ||
              !ga.perSizePatternGeometry?.[sz] ||
              ga.perSizePatternGeometry[sz].length === 0 ||
              !ga.perSizeGeometryValidation?.[sz]?.isValid
          );
          if (missingReqSizes.length > 0) {
            blockingArtifacts.push(
              `grading-artifact (size-range-incomplete: Grading artifact is missing required export sizes [${missingReqSizes.join(', ')}])`
            );
            if (!rejectionCode) rejectionCode = 'GRADING_SIZE_RANGE_INCOMPLETE';
          }
        }

        // 4. Project and Tenant scope binding
        const expectedScope =
          (activeInputs?.specification && 'projectId' in activeInputs.specification
            ? activeInputs.specification.projectId
            : undefined) ?? snapshot?.projectId;
        if (expectedScope && (ga.projectId !== expectedScope || ga.tenantId !== expectedScope)) {
          blockingArtifacts.push(
            `grading-artifact (scope-mismatch: Grading artifact projectId/tenantId '${ga.projectId}'/'${ga.tenantId}' does not match active scope '${expectedScope}')`
          );
          if (!rejectionCode) rejectionCode = 'GRADING_SCOPE_MISMATCH';
        }

        // 5. Specification lineage verification
        if (activeInputs?.specification) {
          const activeSpec = activeInputs.specification;
          const activeSpecGarmentId =
            'garmentId' in activeSpec && activeSpec.garmentId
              ? activeSpec.garmentId
              : 'id' in activeSpec && (activeSpec as DesignSpecification).id
                ? (activeSpec as DesignSpecification).id
                : 'garment';
          const activeSpecRevId =
            activeSpec.specificationRevisionId ?? `spec-${activeSpecGarmentId}-v${activeSpec.version || 1}`;
          const activeSpecFp = computeSpecificationFingerprint(activeSpec);

          if (
            ga.sourceSpecificationId !== activeSpecGarmentId ||
            ga.sourceSpecificationRevisionId !== activeSpecRevId ||
            ga.sourceSpecificationFingerprint !== activeSpecFp
          ) {
            blockingArtifacts.push(
              `grading-artifact (stale-specification: Grading artifact specification lineage '${ga.sourceSpecificationRevisionId}' / '${ga.sourceSpecificationFingerprint.slice(0, 12)}' does not match active specification '${activeSpecRevId}' / '${activeSpecFp.slice(0, 12)}')`
            );
            if (!rejectionCode) rejectionCode = 'STALE_GRADING_RESULT';
          }
        }

        // 6. Pattern revision lineage & base-size geometry verification
        if (snapshot) {
          if (ga.sourcePatternRevisionId !== snapshot.revisionId) {
            blockingArtifacts.push(
              `grading-artifact (stale-pattern-revision: Grading artifact sourcePatternRevisionId '${ga.sourcePatternRevisionId}' does not match snapshot revisionId '${snapshot.revisionId}')`
            );
            if (!rejectionCode) rejectionCode = 'STALE_GRADING_RESULT';
          }
          if (ga.baseSize !== snapshot.targetSize) {
            blockingArtifacts.push(
              `grading-artifact (base-size-mismatch: Grading artifact baseSize '${ga.baseSize}' does not match snapshot targetSize '${snapshot.targetSize}')`
            );
            if (!rejectionCode) rejectionCode = 'STALE_GRADING_RESULT';
          }
          const basePieces = ga.perSizePatternGeometry?.[ga.baseSize];
          if (!basePieces || basePieces.length !== snapshot.patternPieces.length) {
            blockingArtifacts.push(
              'grading-artifact (stale-geometry: Base-size graded pattern piece count does not match snapshot pattern pieces)'
            );
            if (!rejectionCode) rejectionCode = 'STALE_GRADING_RESULT';
          } else {
            const snapPieceCodes = new Set(snapshot.patternPieces.map(p => p.pieceCode));
            if (basePieces.some(bp => !snapPieceCodes.has(bp.pieceCode))) {
              blockingArtifacts.push(
                'grading-artifact (stale-geometry: Base-size graded pattern piece codes do not match snapshot pattern pieces)'
              );
              if (!rejectionCode) rejectionCode = 'STALE_GRADING_RESULT';
            }
          }
        }

        // 7. Measurement set fingerprint lineage verification
        if (activeInputs?.measurements) {
          const activeMeasFp = computeArtifactInputFingerprint({
            unit: activeInputs.measurements.unit,
            waist: activeInputs.measurements.waist,
            lowHip: activeInputs.measurements.lowHip,
            highHip: activeInputs.measurements.highHip,
            skirtLength: activeInputs.measurements.skirtLength,
            bust: activeInputs.measurements.bust,
            waistToHip: activeInputs.measurements.waistToHip,
            backWaistLength: activeInputs.measurements.backWaistLength,
            frontWaistLength: activeInputs.measurements.frontWaistLength,
            acrossBack: activeInputs.measurements.acrossBack,
            shoulderLength: activeInputs.measurements.shoulderLength,
            neckCircumference: activeInputs.measurements.neckCircumference,
            bustSpan: activeInputs.measurements.bustSpan,
            bustHeight: activeInputs.measurements.bustHeight,
            armholeDepth: activeInputs.measurements.armholeDepth,
            bicepsCircumference: activeInputs.measurements.bicepsCircumference,
            elbowCircumference: activeInputs.measurements.elbowCircumference,
            wristCircumference: activeInputs.measurements.wristCircumference,
            sleeveLength: activeInputs.measurements.sleeveLength,
            armLengthToElbow: activeInputs.measurements.armLengthToElbow,
            activeSize: snapshot?.targetSize ?? ga.baseSize ?? 'M'
          });
          const msCanonFp =
            activeInputs.measurementSet && 'canonicalFingerprint' in activeInputs.measurementSet
              ? activeInputs.measurementSet.canonicalFingerprint
              : undefined;

          if (
            ga.sourceMeasurementSetFingerprint !== activeMeasFp &&
            (!msCanonFp || ga.sourceMeasurementSetFingerprint !== msCanonFp)
          ) {
            blockingArtifacts.push(
              'grading-artifact (stale-measurements: Grading artifact sourceMeasurementSetFingerprint does not match active measurements)'
            );
            if (!rejectionCode) rejectionCode = 'STALE_GRADING_RESULT';
          }
        }

        // 8. Grading rule set lineage verification
        const expectedRulesVer = activeInputs?.gradingRulesVersion ?? 'iso8559-standard';
        const expectedRulesFp = computeArtifactInputFingerprint({
          system: 'standard-iso-8559',
          baseSize: 'M',
          version: expectedRulesVer,
          sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
        });

        if (
          (ga.gradingRuleSetRevision !== expectedRulesVer &&
            ga.gradingRuleSetRevision !== `rules-grading-${expectedRulesVer}`) ||
          ga.gradingRuleSetFingerprint !== expectedRulesFp
        ) {
          blockingArtifacts.push(
            `grading-artifact (rules-mismatch: Grading artifact rule set '${ga.gradingRuleSetRevision}' or fingerprint does not match active grading rules '${expectedRulesVer}')`
          );
          if (!rejectionCode) rejectionCode = 'GRADING_RULES_MISMATCH';
        }
      }
    }
  }

  // 10. Result Construction
  if (blockingArtifacts.length > 0) {
    let rejectionReason = `Production export blocked by unapproved or out-of-sync pipeline stages: ${blockingArtifacts.join('; ')}`;
    if (blockingArtifacts.some(b => b.includes('isProductionReady'))) {
      rejectionReason = 'Industrial safety violation: isProductionReady cannot be asserted.';
      rejectionCode = 'INDUSTRIAL_SAFETY_VIOLATION';
    } else if (
      rejectionCode === 'SNAPSHOT_MISSING' &&
      blockingArtifacts.some(b => b.includes('production-snapshot (missing'))
    ) {
      rejectionReason = 'Production export requires an authoritative ProductionPatternRevisionSnapshot.';
    } else if (blockingArtifacts.some(b => b.includes('production-snapshot (tampered'))) {
      rejectionReason = 'Production export blocked: ProductionPatternRevisionSnapshot payload is tampered.';
      if (!rejectionCode) rejectionCode = 'SNAPSHOT_GEOMETRY_TAMPERED';
    } else if (blockingArtifacts.some(b => b.includes('snapshot-specification-mismatch'))) {
      rejectionReason = 'Production export blocked: snapshot-specification-mismatch between active specification and snapshot revision.';
      if (!rejectionCode) rejectionCode = 'SNAPSHOT_SPECIFICATION_REVISION_MISMATCH';
    }

    return {
      isExportPermitted: false,
      rejectionCode: rejectionCode ?? 'UPSTREAM_STAGE_STALE',
      rejectionReason,
      blockingArtifacts,
      warnings,
      validationDetails: {
        snapshotRevisionId: snapshot?.revisionId,
        activeSpecificationRevisionId: activeInputs?.specification?.specificationRevisionId,
        gradingArtifactId: activeInputs?.gradingArtifact?.gradingArtifactId,
        blockingCount: blockingArtifacts.length
      }
    };
  }

  const effectiveMode = activeInputs?.exportGradingPolicy?.mode ?? 'graded-multi-size';

  return {
    isExportPermitted: true,
    blockingArtifacts: [],
    warnings,
    validationDetails: {
      snapshotRevisionId: snapshot?.revisionId,
      canonicalFingerprint: snapshot?.canonicalFingerprint,
      gradingMode: effectiveMode,
      gradingArtifactId: activeInputs?.gradingArtifact?.gradingArtifactId,
      gradingArtifactFingerprint: activeInputs?.gradingArtifact?.canonicalFingerprint
    },
    manufacturingDocumentation: snapshot ? {
      isProductionReady: false,
      specificationFingerprint: activeInputs?.specification
        ? computeSpecificationFingerprint(activeInputs.specification)
        : (snapshot.designSpecification && 'fabric' in snapshot.designSpecification
            ? computeSpecificationFingerprint(snapshot.designSpecification as unknown as DesignSpecification)
            : snapshot.canonicalFingerprint),
      patternRevisionFingerprint: snapshot.canonicalFingerprint,
      revisionId: snapshot.revisionId,
      exportedAt: new Date().toISOString(),
      gradingMode: effectiveMode,
      gradingArtifactId: activeInputs?.gradingArtifact?.gradingArtifactId,
      gradingRevisionId: activeInputs?.gradingArtifact?.gradingRevisionId,
      gradingArtifactFingerprint: activeInputs?.gradingArtifact?.canonicalFingerprint,
      nonGradingReason:
        effectiveMode === 'single-size-ungraded'
          ? activeInputs?.exportGradingPolicy?.nonGradingReason?.trim()
          : undefined
    } : undefined
  };
}
