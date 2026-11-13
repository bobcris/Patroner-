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
  computeCanonicalFingerprint,
  computeCanonicalRevisionFingerprint,
  computeDraftingConfigFingerprint,
  computeGradingArtifactContentFingerprint,
  computePieceGeometryFingerprint,
  CURRENT_ENGINE_VERSION,
  deepFreeze,
  invalidatePatternRevision,
  isMisleadingChartApproverIdentity,
  NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS,
  revokeAuthoritativeGradingArtifact,
  verifyGradingArtifactIntegrity,
  verifyMeasurementSetIntegrity,
  verifyPatternRevisionLifecycleIntegrity
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
  AuthoritativePatternRevision,
  AuthoritativeProductionPackage,
  DraftingConfigurationSnapshot,
  ExportGradingPolicy,
  GradingSummarySnapshot,
  MeasurementApprovalStatus,
  MeasurementOrigin,
  MeasurementSetSnapshot,
  PatternInvalidationCause,
  PatternInvalidationRecord,
  PRODUCTION_PACKAGE_SCHEMA_VERSION,
  ProductionPackageCreationResult,
  ProductionPackageLifecycleEvent,
  ProductionPackageLifecycleState,
  ProductionPackageManifest,
  ProductionPackagePieceEntry,
  ProductionPackageRejectionCode,
  ProductionPackageVerificationResult,
  ProductionPatternRevisionSnapshot,
  ProductionSnapshotValidationError
} from './production-types';
import { EnhancedFabricProperty } from '../fabric/fabric-types';
import {
  computeSpecificationFingerprint,
  verifySpecificationApproval
} from './garment-specification';
import {
  ApprovalVerificationContext,
  AuthoritativeGarmentSpecification,
  TrustedCryptographicVerifier,
  TrustedIdentityVerifier,
  VerifiableCryptographicSignature,
  VerifiableIdentityCredential
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

  const isSyntheticMeasurement =
    measProvenance === 'synthetic-fixture' ||
    measProvenance === 'synthetic-persona' ||
    (inputs.measurementSet &&
      'source' in inputs.measurementSet &&
      (inputs.measurementSet.source === 'synthetic-fixture' || inputs.measurementSet.source === 'synthetic-persona')) ||
    (inputs.measurementSet?.perMeasurementOrigin &&
      (Object.values(inputs.measurementSet.perMeasurementOrigin).includes('synthetic-fixture') ||
        Object.values(inputs.measurementSet.perMeasurementOrigin).includes('synthetic-persona')));

  const isStandardChartMeasurement =
    measProvenance === 'standard-chart' ||
    (inputs.measurementSet && 'source' in inputs.measurementSet && inputs.measurementSet.source === 'standard-chart');

  const hasMisleadingChartApprover =
    (inputs.measurementSet &&
      'approvedBy' in inputs.measurementSet &&
      isMisleadingChartApproverIdentity(inputs.measurementSet.approvedBy as string | undefined)) ||
    (inputs.measurementSet &&
      'approvingAuthority' in inputs.measurementSet &&
      isMisleadingChartApproverIdentity(inputs.measurementSet.approvingAuthority)) ||
    (inputs.measurementSet &&
      'approval' in inputs.measurementSet &&
      isMisleadingChartApproverIdentity(inputs.measurementSet.approval?.approvedBy)) ||
    isMisleadingChartApproverIdentity(inputs.productionSnapshot?.measurementSet?.approval?.approvedBy);

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
  } else if (isSyntheticMeasurement) {
    measStatus = 'invalid';
    measStaleReason = 'Synthetic fixture or persona measurements cannot be used as approved production measurements.';
    staleReasons.push(measStaleReason);
  } else if (hasMisleadingChartApprover) {
    measStatus = 'invalid';
    measStaleReason = 'Standard sizing chart reference cannot be recorded as an approving human authority.';
    staleReasons.push(measStaleReason);
  } else if (isMeasSuperseded) {
    measStatus = 'stale';
    measStaleReason = 'Measurement set revision has been superseded by a newer measurement revision.';
    staleReasons.push(measStaleReason);
  } else if (isStandardChartMeasurement && measApprovalState === 'approved') {
    measStatus = 'pending';
    measStaleReason = 'Standard sizing chart measurements are unverified reference presets and cannot be approved for production without operator measurement evidence.';
  } else if (explicitUnapprovedFlag) {
    measStatus = 'pending';
    measStaleReason = `Anatomical measurements are ${measApprovalState} and require explicit verification.`;
  }

  const isMeasExplicitlyApproved =
    isMeasAnatomicallyValid &&
    measApprovalState === 'approved' &&
    !isAiMeasurement &&
    !isSyntheticMeasurement &&
    !isStandardChartMeasurement &&
    !hasMisleadingChartApprover &&
    !isMeasSuperseded &&
    !NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS.has(measProvenance);

  const measValidationStatus = !isMeasAnatomicallyValid || measStatus === 'invalid'
    ? 'invalid'
    : isMeasExplicitlyApproved
      ? 'approved'
      : isStandardChartMeasurement && measApprovalState === 'approved'
        ? 'unverified'
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
      inputs.productionSnapshot &&
      ga.sourcePatternSnapshotFingerprint &&
      ga.sourcePatternSnapshotFingerprint !== inputs.productionSnapshot.canonicalFingerprint
    ) {
      gradingStatus = 'stale';
      gradingValidationStatus = 'stale-pattern-snapshot';
      gradingStaleReason = 'Grading artifact sourcePatternSnapshotFingerprint does not match active snapshot canonicalFingerprint.';
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
    } else if (inputs.productionSnapshot) {
      const basePieces = ga.perSizePatternGeometry?.[ga.baseSize];
      const snapPieces = inputs.productionSnapshot.patternPieces;
      if (!basePieces || basePieces.length !== snapPieces.length) {
        gradingStatus = 'stale';
        gradingValidationStatus = 'stale-base-geometry';
        gradingStaleReason = 'Grading artifact base-size piece count does not match snapshot pattern pieces.';
        staleReasons.push(gradingStaleReason);
      } else {
        const snapMap = new Map(snapPieces.map(p => [p.pieceCode, p]));
        for (const bp of basePieces) {
          const sp = snapMap.get(bp.pieceCode);
          if (
            !sp ||
            bp.cutPathData !== sp.cutPathData ||
            bp.sewPathData !== sp.sewPathData ||
            Math.abs(bp.boundingBox.widthCm - sp.boundingBox.widthCm) > 0.05 ||
            Math.abs(bp.boundingBox.heightCm - sp.boundingBox.heightCm) > 0.05 ||
            Math.abs(bp.seamAllowanceWidthCm - sp.seamAllowanceWidthCm) > 0.01 ||
            canonicalizeJson(bp.notches) !== canonicalizeJson(sp.notches) ||
            canonicalizeJson(bp.grainline) !== canonicalizeJson(sp.grainline)
          ) {
            gradingStatus = 'stale';
            gradingValidationStatus = 'stale-base-geometry';
            gradingStaleReason = `Grading artifact base-size piece '${bp.pieceCode}' geometry does not match snapshot pattern piece.`;
            staleReasons.push(gradingStaleReason);
            break;
          }
        }
      }
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

      if (snapStatus === 'current' && (draftingStatus === 'stale' || geomValStatus === 'stale')) {
        snapStatus = 'stale';
        snapStaleReason = 'Underlying pattern drafting or geometry validation is stale.';
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
      geomValArtifact.artifactId
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
    if (
      type !== 'specification' &&
      type !== 'production-snapshot' &&
      type !== 'production-export' &&
      !(type === 'grading' && activeInputs?.gradingArtifact)
    ) {
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
    blockingArtifacts.push(
      'production-snapshot (missing: Production export requires an authoritative ProductionPatternRevisionSnapshot)'
    );
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

  let unauthenticatedApprovalBlockingArtifact: string | undefined = undefined;

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
    } else {
      // Phase 5 (FINDING-15): Enforce Tier 3 (authenticated_designer) or Tier 4 (cryptographic_principal) authority for production export
      const hasVerifiedProductionAuthority =
        (activeSpecVerification.isApprovalAuthenticated && Boolean(activeInputs.verificationContext?.identityVerifier)) ||
        (activeSpecVerification.isApprovalCryptographicallySigned && Boolean(activeInputs.verificationContext?.cryptographicVerifier));
      if (!hasVerifiedProductionAuthority) {
        unauthenticatedApprovalBlockingArtifact =
          `active-specification (unauthenticated: Production export requires verified Tier 3 authenticated_designer or Tier 4 cryptographic_principal approval; authority '${activeSpecVerification.authorityClassification ?? 'unauthenticated_local_session'}' is not permitted for manufacturing export)`;
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
      } else if (
        ms.source === 'unknown' ||
        ms.provenance === 'unknown' ||
        ms.source === 'synthetic-fixture' ||
        ms.provenance === 'synthetic-fixture' ||
        ms.source === 'synthetic-persona' ||
        ms.provenance === 'synthetic-persona' ||
        ms.source === 'standard-chart' ||
        ms.provenance === 'standard-chart' ||
        (ms.perMeasurementOrigin &&
          (Object.values(ms.perMeasurementOrigin).includes('synthetic-fixture') ||
            Object.values(ms.perMeasurementOrigin).includes('synthetic-persona')))
      ) {
        blockingArtifacts.push(`measurements (invalid-provenance: Measurement set provenance '${ms.provenance}' is not valid for production export)`);
        if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = 'MISSING_MEASUREMENT_PROVENANCE';
        }
      } else if (
        isMisleadingChartApproverIdentity((ms as { readonly approvedBy?: string }).approvedBy) ||
        isMisleadingChartApproverIdentity(ms.approvingAuthority)
      ) {
        blockingArtifacts.push(`measurements (invalid-approver: Standard chart reference '${(ms as { readonly approvedBy?: string }).approvedBy ?? ms.approvingAuthority}' cannot act as an approving human authority)`);
        if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED') {
          rejectionCode = 'MEASUREMENT_UNAPPROVED';
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
    } else if (
      effectiveOrigin === 'unknown' ||
      effectiveOrigin === 'synthetic-fixture' ||
      effectiveOrigin === 'synthetic-persona' ||
      effectiveOrigin === 'standard-chart' ||
      (snapMs.perMeasurementOrigin &&
        (Object.values(snapMs.perMeasurementOrigin).includes('synthetic-fixture') ||
          Object.values(snapMs.perMeasurementOrigin).includes('synthetic-persona')))
    ) {
      blockingArtifacts.push(`measurements (invalid-provenance: Measurement origin '${effectiveOrigin}' is not permitted for production export)`);
      if (!rejectionCode || rejectionCode === 'MEASUREMENT_UNAPPROVED' || rejectionCode === 'STALE_SOURCE_FINGERPRINT') {
        rejectionCode = 'MISSING_MEASUREMENT_PROVENANCE';
      }
    }
    if (
      snapMs.approval?.state !== 'approved' ||
      !snapMs.approval.approvedBy ||
      !snapMs.approval.approvedAt ||
      isMisleadingChartApproverIdentity(snapMs.approval.approvedBy) ||
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

  // 9. Full Report Recomputation & 11-Field Artifact Comparison (Correction F / AUDIT-04.6.2.3.5-03)
  // Always recompute with gradingArtifact: activeInputs.gradingArtifact unconditionally.
  // Never infer whether gradingArtifact was used from caller-supplied report.artifacts.grading fingerprints.
  let reportOnlyMismatchedGradingStage = false;
  if (
    activeInputs?.specification &&
    activeInputs?.measurements &&
    (missingActiveInputNames.length === 0 || (activeInputs.patternPieces && activeInputs.validationReport))
  ) {
    try {
      const recomputedReport = evaluatePipelineDependencyIntegrity({
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
      });

      const reportMismatches: string[] = [];
      const mismatchedStages: string[] = [];

      if (Boolean(report.hasStaleArtifacts) !== Boolean(recomputedReport.hasStaleArtifacts)) {
        reportMismatches.push(`hasStaleArtifacts (${report.hasStaleArtifacts} !== ${recomputedReport.hasStaleArtifacts})`);
      }
      if (Boolean(report.hasBlockingErrors) !== Boolean(recomputedReport.hasBlockingErrors)) {
        reportMismatches.push(`hasBlockingErrors (${report.hasBlockingErrors} !== ${recomputedReport.hasBlockingErrors})`);
      }

      for (const stage of requiredStages) {
        const suppliedArt = report.artifacts[stage];
        const recomputedArt = recomputedReport.artifacts[stage];
        if (!suppliedArt) {
          reportMismatches.push(`missing artifact record for stage '${stage}'`);
          mismatchedStages.push(stage);
          continue;
        }
        const fieldDiffs = compareArtifactRecords(suppliedArt, recomputedArt);
        if (fieldDiffs.length > 0) {
          reportMismatches.push(`stage '${stage}' mismatch: ${fieldDiffs.join(', ')}`);
          mismatchedStages.push(stage);
        }
      }

      if (reportMismatches.length > 0) {
        reportOnlyMismatchedGradingStage =
          Boolean(activeInputs.gradingArtifact) &&
          mismatchedStages.length === 1 &&
          mismatchedStages[0] === 'grading';
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

  // 9b. Complete Grading Export Lineage Verification (Milestone 04.6.2.3.4 Phase 4 & Phase 7 / AUDIT-04.6.2.3.5-03)
  // Grading applicability must NEVER be inferred from the omission of exportGradingPolicy or gradingArtifact.
  if (missingActiveInputNames.length === 0) {
    const policy = activeInputs?.exportGradingPolicy;
    const rawPolicyMode = policy?.mode as string | undefined;
    const isGradedMode = rawPolicyMode === 'graded-multi-size' || rawPolicyMode === 'multi-size-graded';
    const isSingleSizeMode = rawPolicyMode === 'single-size-ungraded' || rawPolicyMode === 'base-size-only';

    const setGradingRejectionCode = (code: ProductionExportRejectionCode) => {
      if (
        !rejectionCode ||
        (rejectionCode === 'FORGED_REPORT_DETECTED' && reportOnlyMismatchedGradingStage)
      ) {
        rejectionCode = code;
      }
    };

    if (!policy || (!isGradedMode && !isSingleSizeMode)) {
      blockingArtifacts.push(
        `grading-policy (undeclared: Missing or invalid exportGradingPolicy.mode '${String(rawPolicyMode ?? 'undefined')}'; exportGradingPolicy must be explicitly declared)`
      );
      setGradingRejectionCode('GRADING_APPLICABILITY_UNDECLARED');
    } else if (isSingleSizeMode) {
      // Single-size ungraded export requires an explicit non-empty nonGradingReason
      const reason = typeof policy?.nonGradingReason === 'string' ? policy.nonGradingReason.trim() : '';
      if (!reason) {
        blockingArtifacts.push(
          'grading-policy (undeclared: Single-size ungraded export requires an explicit non-empty nonGradingReason)'
        );
        setGradingRejectionCode('GRADING_APPLICABILITY_UNDECLARED');
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
        setGradingRejectionCode('GRADING_SCOPE_MISMATCH');
      }
    } else {
      // Default and explicit 'graded-multi-size' / 'multi-size-graded' mode: AuthoritativeGradingArtifact is mandatory
      const ga = activeInputs?.gradingArtifact;
      if (!ga) {
        blockingArtifacts.push(
          'grading-artifact (missing: AuthoritativeGradingArtifact is mandatory for graded production export; grading applicability is never inferred from omission)'
        );
        setGradingRejectionCode('GRADING_ARTIFACT_MISSING');
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
          setGradingRejectionCode('GRADING_ARTIFACT_TAMPERED');
        } else if (ga.lifecycleState === 'revoked' || Boolean(ga.revocationReason)) {
          blockingArtifacts.push(
            `grading-artifact (revoked: ${gaIntegrity.reason ?? 'Grading artifact has been revoked'})`
          );
          setGradingRejectionCode('GRADING_ARTIFACT_REVOKED');
        } else if (ga.lifecycleState === 'superseded' || Boolean(ga.supersededByRevisionId)) {
          blockingArtifacts.push(
            `grading-artifact (superseded: ${gaIntegrity.reason ?? 'Grading artifact has been superseded'})`
          );
          setGradingRejectionCode('GRADING_ARTIFACT_SUPERSEDED');
        } else if (gaIntegrity.isSizeRangeIncomplete) {
          blockingArtifacts.push(
            `grading-artifact (size-range-incomplete: ${gaIntegrity.reason ?? 'Grading artifact size range is incomplete'})`
          );
          setGradingRejectionCode('GRADING_SIZE_RANGE_INCOMPLETE');
        } else if (gaIntegrity.isValidationFailed) {
          blockingArtifacts.push(
            `grading-artifact (validation-failed: ${gaIntegrity.reason ?? 'Grading artifact validation failed'})`
          );
          setGradingRejectionCode('GRADING_VALIDATION_FAILED');
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
            setGradingRejectionCode('GRADING_SIZE_RANGE_INCOMPLETE');
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
          setGradingRejectionCode('GRADING_SCOPE_MISMATCH');
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
            setGradingRejectionCode('STALE_GRADING_RESULT');
          }
        }

        // 6. Pattern revision lineage & base-size geometry verification (FINDING-17 & Milestone 05.1 Amendment 1)
        if (snapshot) {
          if (ga.sourcePatternRevisionId !== snapshot.revisionId) {
            blockingArtifacts.push(
              `grading-artifact (stale-pattern-revision: Grading artifact sourcePatternRevisionId '${ga.sourcePatternRevisionId}' does not match snapshot revisionId '${snapshot.revisionId}')`
            );
            setGradingRejectionCode('STALE_GRADING_RESULT');
          }
          const validSnapshotFps = new Set<string>(
            [
              snapshot.canonicalFingerprint,
              snapshot.basePatternFingerprint,
              snapshot.contentFingerprint
            ].filter((fp): fp is string => typeof fp === 'string' && fp.length > 0)
          );
          const gaSourceFp = ga.sourceBasePatternFingerprint ?? ga.sourcePatternSnapshotFingerprint;
          if (gaSourceFp && !validSnapshotFps.has(gaSourceFp)) {
            blockingArtifacts.push(
              'grading-artifact (stale-pattern-snapshot: Grading artifact sourceBasePatternFingerprint/sourcePatternSnapshotFingerprint does not match snapshot basePatternFingerprint or canonicalFingerprint)'
            );
            setGradingRejectionCode('STALE_GRADING_RESULT');
          }
          if (ga.baseSize !== snapshot.targetSize) {
            blockingArtifacts.push(
              `grading-artifact (base-size-mismatch: Grading artifact baseSize '${ga.baseSize}' does not match snapshot targetSize '${snapshot.targetSize}')`
            );
            setGradingRejectionCode('STALE_GRADING_RESULT');
          }
          const basePieces = ga.perSizePatternGeometry?.[ga.baseSize];
          if (!basePieces || basePieces.length !== snapshot.patternPieces.length) {
            blockingArtifacts.push(
              'grading-artifact (stale-geometry: Base-size graded pattern piece count does not match snapshot pattern pieces)'
            );
            setGradingRejectionCode('STALE_GRADING_RESULT');
          } else {
            const snapPieceMap = new Map(snapshot.patternPieces.map(p => [p.pieceCode, p]));
            for (const bp of basePieces) {
              const sp = snapPieceMap.get(bp.pieceCode);
              if (
                !sp ||
                bp.cutPathData !== sp.cutPathData ||
                bp.sewPathData !== sp.sewPathData ||
                Math.abs(bp.boundingBox.widthCm - sp.boundingBox.widthCm) > 0.05 ||
                Math.abs(bp.boundingBox.heightCm - sp.boundingBox.heightCm) > 0.05 ||
                Math.abs(bp.seamAllowanceWidthCm - sp.seamAllowanceWidthCm) > 0.01 ||
                canonicalizeJson(bp.notches) !== canonicalizeJson(sp.notches) ||
                canonicalizeJson(bp.grainline) !== canonicalizeJson(sp.grainline)
              ) {
                blockingArtifacts.push(
                  `grading-artifact (stale-geometry: Base-size graded pattern piece '${bp.pieceCode}' geometry does not match snapshot pattern piece)`
                );
                setGradingRejectionCode('STALE_GRADING_RESULT');
                break;
              }
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
            setGradingRejectionCode('STALE_GRADING_RESULT');
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
          setGradingRejectionCode('GRADING_RULES_MISMATCH');
        }
      }
    }
  }

  // 9c. Enforce Tier 3 / Tier 4 Production Approval Authority (FINDING-15)
  if (unauthenticatedApprovalBlockingArtifact) {
    blockingArtifacts.push(unauthenticatedApprovalBlockingArtifact);
    if (!rejectionCode || rejectionCode === 'STALE_SOURCE_FINGERPRINT') {
      rejectionCode = 'SPECIFICATION_APPROVAL_UNAUTHENTICATED';
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

  const rawEffectiveMode = activeInputs!.exportGradingPolicy!.mode as string;
  const effectiveMode: 'graded-multi-size' | 'single-size-ungraded' =
    rawEffectiveMode === 'single-size-ungraded' || rawEffectiveMode === 'base-size-only'
      ? 'single-size-ungraded'
      : 'graded-multi-size';

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

// ============================================================================
// MILESTONE 05.1: SCOPED PATTERN REVISION STALENESS & INVALIDATION PROPAGATION
// ============================================================================

export interface ActiveUpstreamPatternDependencies {
  readonly garmentId: string;
  readonly specification?: AuthoritativeGarmentSpecification;
  readonly measurementSet?: AuthoritativeMeasurementSetRecord;
  readonly draftingConfig?: Partial<DraftingConfigurationSnapshot>;
  readonly engineVersion?: string;
  readonly gradingRuleSetRevision?: string;
  readonly gradingRuleSetFingerprint?: string;
}

/**
 * Evaluates whether a specific `AuthoritativePatternRevision` is stale relative to active
 * upstream artifacts for its `garmentId`.
 *
 * Enforces:
 * - Scoped evaluation: if `activeUpstream.garmentId !== revisionGarmentId`, `affectsRevision` is `false`
 *   and `isStale` is `false` (changes to Garment A never invalidate Garment B).
 * - Amendment 4: A grading rule change (`gradingRuleSetRevision` / `gradingRuleSetFingerprint`)
 *   does NOT invalidate a base-size pattern revision whose specification, measurement, drafting
 *   configuration, and geometry remain unchanged.
 */
export function evaluatePatternRevisionStaleness(
  revision: AuthoritativePatternRevision,
  activeUpstream: ActiveUpstreamPatternDependencies
): {
  readonly affectsRevision: boolean;
  readonly isStale: boolean;
  readonly cause?: PatternInvalidationCause;
  readonly reason?: string;
  readonly upstreamArtifactId?: string;
  readonly recordedUpstreamFingerprint?: string;
  readonly activeUpstreamFingerprint?: string;
} {
  const revisionGarmentId = revision?.sourceSpecificationId ?? revision?.designSpecification?.id;
  if (!revision || !activeUpstream || revisionGarmentId !== activeUpstream.garmentId) {
    return {
      affectsRevision: false,
      isStale: false
    };
  }

  // 1. Check specification lineage
  if (activeUpstream.specification) {
    const activeSpecFp = computeSpecificationFingerprint(activeUpstream.specification);
    const activeSpecRevId = activeUpstream.specification.specificationRevisionId;
    if (
      revision.sourceSpecificationRevisionId !== activeSpecRevId ||
      revision.sourceSpecificationFingerprint !== activeSpecFp
    ) {
      return {
        affectsRevision: true,
        isStale: true,
        cause: 'specification_changed',
        reason: `Upstream garment specification changed from '${revision.sourceSpecificationRevisionId}' (${(revision.sourceSpecificationFingerprint ?? '').slice(0, 12)}) to '${activeSpecRevId}' (${activeSpecFp.slice(0, 12)}).`,
        upstreamArtifactId: activeSpecRevId,
        recordedUpstreamFingerprint: revision.sourceSpecificationFingerprint,
        activeUpstreamFingerprint: activeSpecFp
      };
    }
  }

  // 2. Check measurement set lineage
  if (activeUpstream.measurementSet) {
    const activeMeasFp = activeUpstream.measurementSet.canonicalFingerprint;
    const activeMeasId = activeUpstream.measurementSet.measurementSetId;
    if (
      revision.sourceMeasurementSetId !== activeMeasId ||
      revision.sourceMeasurementSetFingerprint !== activeMeasFp
    ) {
      return {
        affectsRevision: true,
        isStale: true,
        cause: 'measurement_changed',
        reason: `Upstream measurement set changed from '${revision.sourceMeasurementSetId}' (${(revision.sourceMeasurementSetFingerprint ?? '').slice(0, 12)}) to '${activeMeasId}' (${activeMeasFp.slice(0, 12)}).`,
        upstreamArtifactId: activeMeasId,
        recordedUpstreamFingerprint: revision.sourceMeasurementSetFingerprint,
        activeUpstreamFingerprint: activeMeasFp
      };
    }
  }

  // 3. Check drafting configuration lineage
  if (activeUpstream.draftingConfig) {
    const mergedDrafting: DraftingConfigurationSnapshot = {
      ...revision.draftingConfiguration,
      ...activeUpstream.draftingConfig
    };
    const activeDraftingFp = computeDraftingConfigFingerprint({
      draftingConfiguration: mergedDrafting,
      fabricSpecification: revision.fabricSpecification,
      engineProvenance: revision.engineProvenance
    });
    const recordedDraftingFp =
      revision.draftingConfigFingerprint ??
      computeDraftingConfigFingerprint({
        draftingConfiguration: revision.draftingConfiguration,
        fabricSpecification: revision.fabricSpecification,
        engineProvenance: revision.engineProvenance
      });
    if (activeDraftingFp !== recordedDraftingFp) {
      return {
        affectsRevision: true,
        isStale: true,
        cause: 'drafting_configuration_changed',
        reason: `Drafting configuration fingerprint changed from '${recordedDraftingFp.slice(0, 12)}' to '${activeDraftingFp.slice(0, 12)}'.`,
        upstreamArtifactId: `drafting-config-${revisionGarmentId}`,
        recordedUpstreamFingerprint: recordedDraftingFp,
        activeUpstreamFingerprint: activeDraftingFp
      };
    }
  }

  // 4. Check engine version lineage
  if (
    activeUpstream.engineVersion &&
    activeUpstream.engineVersion !== revision.engineProvenance.engineVersion
  ) {
    return {
      affectsRevision: true,
      isStale: true,
      cause: 'engine_version_changed',
      reason: `Pattern drafting engine version changed from '${revision.engineProvenance.engineVersion}' to '${activeUpstream.engineVersion}'.`,
      upstreamArtifactId: 'drafting-engine',
      recordedUpstreamFingerprint: revision.engineProvenance.engineVersion,
      activeUpstreamFingerprint: activeUpstream.engineVersion
    };
  }

  // Amendment 4: Grading rule changes do NOT invalidate base-size pattern revisions
  return {
    affectsRevision: true,
    isStale: false
  };
}

/**
 * Propagates an upstream change across a collection of pattern revisions, grading artifacts,
 * and production packages with strict garment-level and artifact-level scoping (Section 7 & Amendment 4).
 *
 * Guarantees:
 * - Only dependent artifacts belonging to `activeUpstream.garmentId` are evaluated.
 * - Unrelated garments' pattern revisions, grading artifacts, and packages remain strictly untouched.
 * - A grading-only change (`gradingRuleSetRevision` / `gradingRuleSetFingerprint`) invalidates
 *   affected grading artifacts and multi-size production packages, while preserving unaffected
 *   base-size pattern revisions and single-size base packages (Amendment 4).
 * - Content fingerprints (`contentFingerprint` / `basePatternFingerprint`) and package
 *   `manifestFingerprint`s are never rewritten when invalidated (Amendment 2).
 */
export function propagateUpstreamChangeToPatternRevisions(input: {
  readonly patternRevisions: readonly AuthoritativePatternRevision[];
  readonly gradingArtifacts?: readonly AuthoritativeGradingArtifact[];
  readonly productionPackages?: readonly AuthoritativeProductionPackage[];
  readonly activeUpstream: ActiveUpstreamPatternDependencies;
  readonly invalidatedAt?: string;
  readonly invalidatedBy?: string;
}): {
  readonly updatedPatternRevisions: readonly AuthoritativePatternRevision[];
  readonly invalidatedRevisionIds: readonly string[];
  readonly preservedRevisionIds: readonly string[];
  readonly updatedGradingArtifacts: readonly AuthoritativeGradingArtifact[];
  readonly invalidatedGradingArtifactIds: readonly string[];
  readonly preservedGradingArtifactIds: readonly string[];
  readonly updatedProductionPackages: readonly AuthoritativeProductionPackage[];
  readonly invalidatedPackageIds: readonly string[];
  readonly preservedPackageIds: readonly string[];
} {
  const invalidatedAt = input.invalidatedAt ?? new Date().toISOString();
  const invalidatedBy = input.invalidatedBy ?? 'dependency-invalidation-engine';
  const activeUpstream = input.activeUpstream;

  const updatedPatternRevisions: AuthoritativePatternRevision[] = [];
  const invalidatedRevisionIds: string[] = [];
  const preservedRevisionIds: string[] = [];
  const invalidatedRevisionCauseMap = new Map<string, { cause: PatternInvalidationCause; reason: string; upstreamId?: string; recordedFp?: string; activeFp?: string }>();

  // 1. Evaluate pattern revisions (base-size pattern revisions are NOT invalidated by grading-only changes)
  for (const rev of input.patternRevisions) {
    const currentState = rev.currentLifecycleState ?? 'draft';
    if (currentState === 'archived' || currentState === 'invalidated') {
      updatedPatternRevisions.push(rev);
      preservedRevisionIds.push(rev.revisionId);
      continue;
    }

    const evalRes = evaluatePatternRevisionStaleness(rev, activeUpstream);
    if (evalRes.affectsRevision && evalRes.isStale && evalRes.cause && evalRes.reason) {
      const invalidatedRev = invalidatePatternRevision(rev, {
        cause: evalRes.cause,
        reason: evalRes.reason,
        invalidatedAt,
        invalidatedBy,
        upstreamArtifactId: evalRes.upstreamArtifactId,
        recordedUpstreamFingerprint: evalRes.recordedUpstreamFingerprint,
        activeUpstreamFingerprint: evalRes.activeUpstreamFingerprint
      });
      updatedPatternRevisions.push(invalidatedRev);
      invalidatedRevisionIds.push(rev.revisionId);
      invalidatedRevisionCauseMap.set(rev.revisionId, {
        cause: evalRes.cause,
        reason: evalRes.reason,
        upstreamId: evalRes.upstreamArtifactId,
        recordedFp: evalRes.recordedUpstreamFingerprint,
        activeFp: evalRes.activeUpstreamFingerprint
      });
    } else {
      updatedPatternRevisions.push(rev);
      preservedRevisionIds.push(rev.revisionId);
    }
  }

  // 2. Evaluate grading artifacts (invalidated when upstream pattern revision is invalidated OR when grading rules change)
  const updatedGradingArtifacts: AuthoritativeGradingArtifact[] = [];
  const invalidatedGradingArtifactIds: string[] = [];
  const preservedGradingArtifactIds: string[] = [];
  const invalidatedGradingMap = new Map<string, { cause: PatternInvalidationCause; reason: string; recordedFp?: string; activeFp?: string }>();

  for (const ga of input.gradingArtifacts ?? []) {
    if (ga.lifecycleState !== 'active') {
      updatedGradingArtifacts.push(ga);
      preservedGradingArtifactIds.push(ga.gradingArtifactId);
      continue;
    }

    // Scope check: only evaluate grading artifacts belonging to activeUpstream.garmentId
    if (ga.sourceSpecificationId !== activeUpstream.garmentId) {
      updatedGradingArtifacts.push(ga);
      preservedGradingArtifactIds.push(ga.gradingArtifactId);
      continue;
    }

    const upstreamRevInvalidation = invalidatedRevisionCauseMap.get(ga.sourcePatternRevisionId);
    if (upstreamRevInvalidation) {
      const reason = `Grading artifact '${ga.gradingArtifactId}' invalidated because upstream pattern revision '${ga.sourcePatternRevisionId}' was invalidated (${upstreamRevInvalidation.reason}).`;
      const revokedGa = revokeAuthoritativeGradingArtifact(ga, reason, invalidatedAt);
      updatedGradingArtifacts.push(revokedGa);
      invalidatedGradingArtifactIds.push(ga.gradingArtifactId);
      invalidatedGradingMap.set(ga.gradingArtifactId, {
        cause: upstreamRevInvalidation.cause,
        reason,
        recordedFp: upstreamRevInvalidation.recordedFp,
        activeFp: upstreamRevInvalidation.activeFp
      });
      continue;
    }

    // Check grading rule changes (Amendment 4)
    const expectedRulesRev = activeUpstream.gradingRuleSetRevision;
    const expectedRulesFp =
      activeUpstream.gradingRuleSetFingerprint ??
      (expectedRulesRev
        ? computeArtifactInputFingerprint({
            system: 'standard-iso-8559',
            baseSize: 'M',
            version: expectedRulesRev,
            sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
          })
        : undefined);

    const rulesRevChanged =
      Boolean(expectedRulesRev) &&
      ga.gradingRuleSetRevision !== expectedRulesRev &&
      ga.gradingRuleSetRevision !== `rules-grading-${expectedRulesRev}`;
    const rulesFpChanged =
      Boolean(expectedRulesFp) && ga.gradingRuleSetFingerprint !== expectedRulesFp;

    if (rulesRevChanged || rulesFpChanged) {
      const reason = `Grading artifact '${ga.gradingArtifactId}' invalidated by grading rule change from '${ga.gradingRuleSetRevision}' (${ga.gradingRuleSetFingerprint.slice(0, 12)}) to '${expectedRulesRev ?? ga.gradingRuleSetRevision}' (${(expectedRulesFp ?? '').slice(0, 12)}).`;
      const revokedGa = revokeAuthoritativeGradingArtifact(ga, reason, invalidatedAt);
      updatedGradingArtifacts.push(revokedGa);
      invalidatedGradingArtifactIds.push(ga.gradingArtifactId);
      invalidatedGradingMap.set(ga.gradingArtifactId, {
        cause: 'grading_rule_changed',
        reason,
        recordedFp: ga.gradingRuleSetFingerprint,
        activeFp: expectedRulesFp
      });
    } else {
      updatedGradingArtifacts.push(ga);
      preservedGradingArtifactIds.push(ga.gradingArtifactId);
    }
  }

  // 3. Evaluate production packages
  // - Multi-size packages are invalidated if their base pattern revision OR their grading artifact was invalidated.
  // - Single-size base packages are invalidated ONLY if their base pattern revision was invalidated (preserved on grading-only changes!).
  const updatedProductionPackages: AuthoritativeProductionPackage[] = [];
  const invalidatedPackageIds: string[] = [];
  const preservedPackageIds: string[] = [];

  for (const pkg of input.productionPackages ?? []) {
    if (pkg.currentPackageState !== 'active') {
      updatedProductionPackages.push(pkg);
      preservedPackageIds.push(pkg.packageId);
      continue;
    }

    if (pkg.garmentId !== activeUpstream.garmentId) {
      updatedProductionPackages.push(pkg);
      preservedPackageIds.push(pkg.packageId);
      continue;
    }

    const revInv = invalidatedRevisionCauseMap.get(pkg.manifest.sourcePatternRevisionId);
    if (revInv) {
      const invalidatedPkg = invalidateProductionPackage(pkg, {
        cause: revInv.cause,
        reason: `Production package '${pkg.packageId}' invalidated because bound pattern revision '${pkg.manifest.sourcePatternRevisionId}' was invalidated: ${revInv.reason}`,
        invalidatedAt,
        invalidatedBy,
        upstreamArtifactId: pkg.manifest.sourcePatternRevisionId,
        recordedUpstreamFingerprint: pkg.manifest.basePatternFingerprint,
        activeUpstreamFingerprint: revInv.activeFp
      });
      updatedProductionPackages.push(invalidatedPkg);
      invalidatedPackageIds.push(pkg.packageId);
      continue;
    }

    if (
      pkg.manifest.gradingMode === 'graded-multi-size' &&
      pkg.manifest.sourceGradingArtifactId
    ) {
      const gaInv = invalidatedGradingMap.get(pkg.manifest.sourceGradingArtifactId);
      if (gaInv) {
        const invalidatedPkg = invalidateProductionPackage(pkg, {
          cause: gaInv.cause,
          reason: `Multi-size production package '${pkg.packageId}' invalidated because bound grading artifact '${pkg.manifest.sourceGradingArtifactId}' was invalidated: ${gaInv.reason}`,
          invalidatedAt,
          invalidatedBy,
          upstreamArtifactId: pkg.manifest.sourceGradingArtifactId,
          recordedUpstreamFingerprint: pkg.manifest.gradingArtifactFingerprint,
          activeUpstreamFingerprint: gaInv.activeFp
        });
        updatedProductionPackages.push(invalidatedPkg);
        invalidatedPackageIds.push(pkg.packageId);
        continue;
      }
    }

    updatedProductionPackages.push(pkg);
    preservedPackageIds.push(pkg.packageId);
  }

  return deepFreeze({
    updatedPatternRevisions,
    invalidatedRevisionIds,
    preservedRevisionIds,
    updatedGradingArtifacts,
    invalidatedGradingArtifactIds,
    preservedGradingArtifactIds,
    updatedProductionPackages,
    invalidatedPackageIds,
    preservedPackageIds
  });
}

// ============================================================================
// MILESTONE 05.1: AUTHORITATIVE PRODUCTION PACKAGE FOUNDATION
// ============================================================================

/**
 * Computes the deterministic SHA-256 `manifestFingerprint` of an immutable `ProductionPackageManifest`
 * (Amendment 1 & Amendment 2: binds `basePatternFingerprint` and `gradingArtifactFingerprint` together,
 * and excludes package lifecycle events so `manifestFingerprint` never mutates across package lifecycle transitions).
 */
export function computeProductionPackageManifestFingerprint(
  manifest: ProductionPackageManifest
): string {
  const payload = {
    schemaVersion: manifest.schemaVersion,
    packageId: manifest.packageId,
    packageRevisionId: manifest.packageRevisionId,
    projectId: manifest.projectId,
    tenantId: manifest.tenantId,
    garmentId: manifest.garmentId,
    createdAt: manifest.createdAt,
    createdBy: manifest.createdBy,
    sourceSpecificationId: manifest.sourceSpecificationId,
    sourceSpecificationRevisionId: manifest.sourceSpecificationRevisionId,
    sourceSpecificationFingerprint: manifest.sourceSpecificationFingerprint,
    sourceMeasurementSetId: manifest.sourceMeasurementSetId,
    sourceMeasurementRevisionId: manifest.sourceMeasurementRevisionId,
    sourceMeasurementSetFingerprint: manifest.sourceMeasurementSetFingerprint,
    sourcePatternRevisionId: manifest.sourcePatternRevisionId,
    sourcePatternRevisionNumber: manifest.sourcePatternRevisionNumber,
    basePatternFingerprint: manifest.basePatternFingerprint,
    geometryFingerprint: manifest.geometryFingerprint,
    draftingConfigFingerprint: manifest.draftingConfigFingerprint,
    gradingMode: manifest.gradingMode,
    nonGradingReason: manifest.nonGradingReason ?? null,
    sourceGradingArtifactId: manifest.sourceGradingArtifactId ?? null,
    sourceGradingRevisionId: manifest.sourceGradingRevisionId ?? null,
    gradingArtifactFingerprint: manifest.gradingArtifactFingerprint ?? null,
    includedSizes: [...manifest.includedSizes],
    baseSize: manifest.baseSize,
    pieceInventory: manifest.pieceInventory.map(p => ({
      pieceId: p.pieceId,
      pieceCode: p.pieceCode,
      pieceName: p.pieceName,
      sizeCode: p.sizeCode,
      pieceGeometryFingerprint: p.pieceGeometryFingerprint,
      widthCm: p.widthCm,
      heightCm: p.heightCm,
      seamAllowanceWidthCm: p.seamAllowanceWidthCm,
      notchCount: p.notchCount,
      dartCount: p.dartCount
    })),
    pieceCount: manifest.pieceCount,
    totalPieceInstancesAcrossSizes: manifest.totalPieceInstancesAcrossSizes,
    validationDigest: manifest.validationDigest,
    approvalDigest: manifest.approvalDigest,
    isProductionReady: false as const
  };
  return computeCanonicalFingerprint(payload);
}

/**
 * Computes the deterministic hash-chained `lifecycleEventFingerprint` of a `ProductionPackageLifecycleEvent`
 * (Amendment 2).
 */
export function computeProductionPackageLifecycleEventFingerprint(
  event: Omit<ProductionPackageLifecycleEvent, 'lifecycleEventFingerprint'> | ProductionPackageLifecycleEvent
): string {
  const payload = {
    schemaVersion: 'm05.1-package-lifecycle-event-v1',
    eventId: event.eventId,
    packageId: event.packageId,
    fromState: event.fromState ?? null,
    toState: event.toState,
    timestamp: event.timestamp,
    actorId: event.actorId,
    actorRole: event.actorRole,
    reason: event.reason,
    manifestFingerprint: event.manifestFingerprint,
    previousEventFingerprint: event.previousEventFingerprint ?? null,
    invalidationRecord: event.invalidationRecord ?? null,
    supersededByPackageId: event.supersededByPackageId ?? null
  };
  return computeCanonicalFingerprint(payload);
}

/**
 * Computes the deterministic `currentStateFingerprint` for an `AuthoritativeProductionPackage`
 * binding its immutable `manifestFingerprint` to the latest hash-chained lifecycle event (Amendment 2).
 */
export function computeProductionPackageCurrentStateFingerprint(params: {
  readonly packageId: string;
  readonly manifestFingerprint: string;
  readonly currentPackageState: ProductionPackageLifecycleState;
  readonly latestLifecycleEventFingerprint: string;
  readonly eventCount: number;
}): string {
  return computeCanonicalFingerprint({
    schemaVersion: 'm05.1-package-current-state-v1',
    packageId: params.packageId,
    manifestFingerprint: params.manifestFingerprint,
    currentPackageState: params.currentPackageState,
    latestLifecycleEventFingerprint: params.latestLifecycleEventFingerprint,
    eventCount: params.eventCount,
    isProductionReady: false as const
  });
}

export interface CreateAuthoritativeProductionPackageInput {
  readonly packageId?: string;
  readonly packageRevisionId?: string;
  readonly projectId?: string;
  readonly tenantId?: string;
  readonly createdAt?: string;
  readonly createdBy?: string;
  readonly patternRevision?: AuthoritativePatternRevision;
  readonly specification?: AuthoritativeGarmentSpecification;
  readonly measurementSet?: AuthoritativeMeasurementSetRecord;
  readonly gradingArtifact?: AuthoritativeGradingArtifact;
  readonly exportGradingPolicy?: ExportGradingPolicy;
  /** Verification context for upstream specification approval */
  readonly specificationVerificationContext?: ApprovalVerificationContext;
  /** Verification context for the pattern revision's Tier 3 / Tier 4 approval (Amendment 3) */
  readonly patternApprovalVerificationContext?: {
    readonly identityVerifier?: TrustedIdentityVerifier;
    readonly identityCredential?: VerifiableIdentityCredential;
    readonly cryptographicVerifier?: TrustedCryptographicVerifier;
    readonly cryptographicSignature?: VerifiableCryptographicSignature;
  };
}

/**
 * Creates a trace-complete, immutable `AuthoritativeProductionPackage` from an `'approved'`
 * `AuthoritativePatternRevision`, an approved `AuthoritativeGarmentSpecification`, an approved
 * non-AI `AuthoritativeMeasurementSetRecord`, an explicit `ExportGradingPolicy`, and (when multi-size)
 * a validated `AuthoritativeGradingArtifact`.
 *
 * Enforces Amendments 1, 2, 3, 4, 5, and 6:
 * - Binds `basePatternFingerprint` and `gradingArtifactFingerprint` in `manifestFingerprint` without circularity.
 * - Requires real Tier 3 / Tier 4 authorization availability and verifies exact target binding to `basePatternFingerprint`.
 * - Fails closed when any prerequisite, upstream lineage link, validation check, or trust service is missing or invalid.
 * - Preserves `isProductionReady === false` unconditionally.
 */
export function createAuthoritativeProductionPackage(
  input: CreateAuthoritativeProductionPackageInput
): ProductionPackageCreationResult {
  const reject = (
    code: ProductionPackageRejectionCode,
    reason: string,
    blockingReasons?: readonly string[]
  ): ProductionPackageCreationResult => ({
    isPackageCreated: false,
    rejectionCode: code,
    rejectionReason: reason,
    blockingReasons: blockingReasons ?? [reason]
  });

  if (!input || typeof input !== 'object') {
    return reject('PATTERN_REVISION_MISSING', 'Production package creation input is missing.');
  }

  const rev = input.patternRevision;
  if (!rev || typeof rev !== 'object') {
    return reject(
      'PATTERN_REVISION_MISSING',
      'AuthoritativeProductionPackage creation requires an AuthoritativePatternRevision.'
    );
  }

  // 1. Industrial safety invariant check
  if (
    (rev as unknown as { isProductionReady: boolean }).isProductionReady !== false ||
    (input.specification && (input.specification as unknown as { isProductionReady: boolean }).isProductionReady !== false) ||
    (input.measurementSet && (input.measurementSet as unknown as { isProductionReady?: boolean }).isProductionReady === true) ||
    (input.gradingArtifact && (input.gradingArtifact as unknown as { isProductionReady: boolean }).isProductionReady !== false)
  ) {
    return reject(
      'INDUSTRIAL_SAFETY_VIOLATION',
      'Industrial safety violation: isProductionReady must remain strictly false across all production artifacts.'
    );
  }

  // 2. Verify pattern revision content & lifecycle integrity (Amendment 1 & Amendment 2)
  const revIntegrity = verifyPatternRevisionLifecycleIntegrity(rev);
  if (!revIntegrity.isValid) {
    return reject(
      revIntegrity.isContentTampered ? 'PATTERN_REVISION_CONTENT_TAMPERED' : 'PATTERN_REVISION_LIFECYCLE_TAMPERED',
      `Pattern revision '${rev.revisionId}' failed integrity verification: ${revIntegrity.reason}`,
      revIntegrity.errors
    );
  }

  // 3. Verify pattern revision lifecycle state is strictly 'approved'
  const lifecycleState = rev.currentLifecycleState ?? 'draft';
  if (lifecycleState === 'superseded') {
    return reject(
      'PATTERN_REVISION_SUPERSEDED',
      `Pattern revision '${rev.revisionId}' has been superseded by '${rev.supersededByRevisionId ?? 'newer revision'}' and cannot be packaged.`
    );
  }
  if (lifecycleState === 'invalidated') {
    return reject(
      'PATTERN_REVISION_INVALIDATED',
      `Pattern revision '${rev.revisionId}' is invalidated and cannot be packaged.`
    );
  }
  if (lifecycleState === 'archived') {
    return reject(
      'PATTERN_REVISION_ARCHIVED',
      `Pattern revision '${rev.revisionId}' is archived and cannot be packaged.`
    );
  }
  if (lifecycleState !== 'approved') {
    return reject(
      'PATTERN_REVISION_NOT_APPROVED',
      `Pattern revision '${rev.revisionId}' is in state '${lifecycleState}'; only 'approved' pattern revisions can produce an AuthoritativeProductionPackage.`
    );
  }

  // 4. Verify pattern geometry & validation evidence
  if (
    !Array.isArray(rev.patternPieces) ||
    rev.patternPieces.length === 0 ||
    !rev.validation ||
    !rev.validation.isValid ||
    rev.validation.failureCount > 0 ||
    rev.validation.status === 'invalid'
  ) {
    return reject(
      'PATTERN_VALIDATION_FAILED',
      `Pattern revision '${rev.revisionId}' does not have passing geometry and seam validation.`
    );
  }

  const revGarmentId = rev.sourceSpecificationId ?? rev.designSpecification.id;

  // 5. Verify upstream specification approval and exact fingerprint match
  if (!input.specification) {
    return reject(
      'SPECIFICATION_UNAPPROVED',
      'AuthoritativeGarmentSpecification is required to verify upstream specification lineage.'
    );
  }
  const activeSpecFp = computeSpecificationFingerprint(input.specification);
  if (
    input.specification.garmentId !== revGarmentId ||
    input.specification.specificationRevisionId !== rev.sourceSpecificationRevisionId ||
    activeSpecFp !== rev.sourceSpecificationFingerprint
  ) {
    return reject(
      'SPECIFICATION_STALE_MISMATCH',
      `Pattern revision '${rev.revisionId}' specification lineage ('${rev.sourceSpecificationRevisionId}' / '${(rev.sourceSpecificationFingerprint ?? '').slice(0, 12)}') does not match active specification ('${input.specification.specificationRevisionId}' / '${activeSpecFp.slice(0, 12)}').`
    );
  }

  const specApprovalRes = verifySpecificationApproval(
    input.specification,
    input.specificationVerificationContext
  );
  if (!specApprovalRes.isValid || specApprovalRes.state !== 'approved') {
    return reject(
      'SPECIFICATION_UNAPPROVED',
      `Upstream garment specification '${input.specification.specificationRevisionId}' is not approved or failed approval verification (${specApprovalRes.reason ?? specApprovalRes.state}).`
    );
  }

  // 6. Verify upstream measurement set approval, provenance, and exact fingerprint match
  if (!input.measurementSet) {
    return reject(
      'MEASUREMENT_UNAPPROVED',
      'AuthoritativeMeasurementSetRecord is required to verify upstream measurement lineage.'
    );
  }
  if (
    input.measurementSet.provenance === 'ai-estimated' ||
    input.measurementSet.source === 'ai-estimated' ||
    rev.measurementSet.defaultOrigin === 'ai-estimated'
  ) {
    return reject(
      'MEASUREMENT_AI_PROHIBITED',
      'AI-estimated measurements are prohibited in an AuthoritativeProductionPackage.'
    );
  }
  const measIntegrity = verifyMeasurementSetIntegrity(input.measurementSet);
  if (!measIntegrity.isValid || !measIntegrity.isApproved) {
    return reject(
      'MEASUREMENT_UNAPPROVED',
      `Upstream measurement set '${input.measurementSet.measurementSetId}' is not approved for production (${measIntegrity.reason ?? 'unapproved'}).`
    );
  }
  if (
    input.measurementSet.measurementSetId !== rev.sourceMeasurementSetId ||
    input.measurementSet.canonicalFingerprint !== rev.sourceMeasurementSetFingerprint
  ) {
    return reject(
      'MEASUREMENT_STALE_MISMATCH',
      `Pattern revision '${rev.revisionId}' measurement lineage ('${rev.sourceMeasurementSetId}' / '${(rev.sourceMeasurementSetFingerprint ?? '').slice(0, 12)}') does not match active measurement set ('${input.measurementSet.measurementSetId}' / '${input.measurementSet.canonicalFingerprint.slice(0, 12)}').`
    );
  }

  // 7. Enforce real Tier 3 / Tier 4 pattern revision authorization availability & target binding (Amendment 3)
  const appRec = rev.patternApprovalRecord;
  const basePatternFingerprint = rev.contentFingerprint ?? rev.basePatternFingerprint!;
  if (
    !appRec ||
    (appRec.authorityTier !== 'authenticated_designer' && appRec.authorityTier !== 'cryptographic_principal') ||
    appRec.patternRevisionId !== rev.revisionId ||
    appRec.boundBasePatternFingerprint !== basePatternFingerprint
  ) {
    return reject(
      'PATTERN_REVISION_APPROVAL_INVALID',
      `Pattern revision '${rev.revisionId}' lacks a valid Tier 3 or Tier 4 PatternRevisionApprovalRecord bound to basePatternFingerprint '${basePatternFingerprint}'.`
    );
  }

  const patAuthCtx = input.patternApprovalVerificationContext;
  if (!patAuthCtx) {
    return reject(
      'AUTHORIZATION_PROVIDER_UNAVAILABLE',
      'Authorized production package creation failed (fail-closed): patternApprovalVerificationContext with an active TrustedIdentityVerifier or TrustedCryptographicVerifier is required.'
    );
  }

  if (appRec.authorityTier === 'authenticated_designer') {
    if (
      !patAuthCtx.identityVerifier ||
      typeof patAuthCtx.identityVerifier.verifyCredential !== 'function' ||
      !patAuthCtx.identityVerifier.replayStore
    ) {
      return reject(
        'AUTHORIZATION_PROVIDER_UNAVAILABLE',
        'Authorized production package creation failed (fail-closed): Tier 3 pattern approval requires an active TrustedIdentityVerifier and JtiReplayStore.'
      );
    }
    const credToVerify = patAuthCtx.identityCredential;
    if (!credToVerify || !appRec.verifiedIdentity) {
      return reject(
        'PATTERN_REVISION_APPROVAL_INVALID',
        'Authorized production package creation failed (fail-closed): Tier 3 pattern approval requires the signed OIDC/JWT VerifiableIdentityCredential for re-verification.'
      );
    }
    const idReverify = patAuthCtx.identityVerifier.verifyCredential(credToVerify, {
      expectedSpecificationId: revGarmentId,
      expectedRevisionId: rev.revisionId,
      expectedSpecificationFingerprint: basePatternFingerprint,
      expectedApprover: appRec.approverName,
      approvalTimestamp: appRec.approvedAt,
      expectedTenantId: rev.projectId,
      requireTargetBinding: true,
      reverifyRecordedApproval: {
        recordedTokenDigest: appRec.verifiedIdentity.tokenDigest,
        recordedJti: appRec.verifiedIdentity.jti,
        recordedSpecificationId: revGarmentId,
        recordedRevisionId: rev.revisionId,
        recordedSpecificationFingerprint: basePatternFingerprint
      }
    });
    if (!idReverify.verified || !idReverify.isValid) {
      return reject(
        'PATTERN_REVISION_APPROVAL_INVALID',
        `Pattern revision Tier 3 approval re-verification failed (fail-closed): ${idReverify.reason ?? 'invalid credential'}.`
      );
    }
  } else {
    if (
      !patAuthCtx.cryptographicVerifier ||
      typeof patAuthCtx.cryptographicVerifier.verifyApprovalSignature !== 'function'
    ) {
      return reject(
        'AUTHORIZATION_PROVIDER_UNAVAILABLE',
        'Authorized production package creation failed (fail-closed): Tier 4 pattern approval requires an active TrustedCryptographicVerifier.'
      );
    }
    const sigToVerify =
      patAuthCtx.cryptographicSignature ??
      (appRec.cryptographicSignature as unknown as VerifiableCryptographicSignature | undefined);
    if (!sigToVerify) {
      return reject(
        'PATTERN_REVISION_APPROVAL_INVALID',
        'Authorized production package creation failed (fail-closed): Tier 4 pattern approval requires a VerifiableCryptographicSignature.'
      );
    }
    const expectedBindingPayload = {
      schemaVersion: '04.6.2.3.4-canonical-spec-v1',
      projectId: rev.projectId,
      tenantId: rev.projectId,
      garmentId: revGarmentId,
      specificationRevisionId: rev.revisionId,
      specificationVersion: rev.revisionIndex,
      canonicalSpecificationFingerprint: basePatternFingerprint,
      approvalEventId: appRec.approvalEventId,
      approverPrincipal: appRec.approverName,
      authorityTier: 'cryptographic_principal' as const,
      approvalScope: 'specification:approve',
      approvalTimestamp: appRec.approvedAt,
      keyId: sigToVerify.keyId,
      algorithm: 'Ed25519'
    };
    const cryptoReverify = patAuthCtx.cryptographicVerifier.verifyApprovalSignature(
      sigToVerify,
      expectedBindingPayload
    );
    if (!cryptoReverify.verified || !cryptoReverify.isValid) {
      return reject(
        'PATTERN_REVISION_APPROVAL_INVALID',
        `Pattern revision Tier 4 cryptographic approval re-verification failed (fail-closed): ${cryptoReverify.reason ?? 'signature rejected'}.`
      );
    }
  }

  // 8. Verify grading policy and grading artifact binding (Amendment 1 & Amendment 4)
  const policy = input.exportGradingPolicy;
  const rawMode = policy?.mode as string | undefined;
  const isGradedMode = rawMode === 'graded-multi-size' || rawMode === 'multi-size-graded';
  const isSingleSizeMode = rawMode === 'single-size-ungraded' || rawMode === 'base-size-only';

  if (!policy || (!isGradedMode && !isSingleSizeMode)) {
    return reject(
      'GRADING_POLICY_UNDECLARED',
      'AuthoritativeProductionPackage requires an explicit exportGradingPolicy (graded-multi-size or single-size-ungraded).'
    );
  }

  let effectiveGradingMode: 'graded-multi-size' | 'single-size-ungraded';
  let includedSizes: readonly string[];
  let pieceInventory: ProductionPackagePieceEntry[] = [];
  let gradingArtifactFp: string | undefined = undefined;
  let sourceGradingArtifactId: string | undefined = undefined;
  let sourceGradingRevisionId: string | undefined = undefined;
  let nonGradingReason: string | undefined = undefined;

  if (isSingleSizeMode) {
    effectiveGradingMode = 'single-size-ungraded';
    nonGradingReason = (policy.nonGradingReason ?? '').trim();
    if (!nonGradingReason) {
      return reject(
        'GRADING_POLICY_UNDECLARED',
        'Single-size ungraded production package requires a non-empty nonGradingReason.'
      );
    }
    if (input.gradingArtifact || (policy.requiredSizes && policy.requiredSizes.length > 1)) {
      return reject(
        'GRADING_ARTIFACT_INVALID',
        'Contradictory grading scope: single-size-ungraded policy declared, but a multi-size gradingArtifact or multi-size requiredSizes list was supplied.'
      );
    }
    includedSizes = [String(rev.targetSize)];
    pieceInventory = rev.patternPieces.map(p => ({
      pieceId: p.id,
      pieceCode: p.pieceCode,
      pieceName: p.name,
      sizeCode: String(p.sizeCode),
      pieceGeometryFingerprint: computePieceGeometryFingerprint(p),
      widthCm: p.stitchingContour?.boundingBox.widthCm ?? p.boundingBox?.widthCm ?? 0,
      heightCm: p.stitchingContour?.boundingBox.heightCm ?? p.boundingBox?.heightCm ?? 0,
      seamAllowanceWidthCm: p.seamAllowanceWidthCm,
      notchCount: p.notches.length,
      dartCount: p.darts.length
    }));
  } else {
    effectiveGradingMode = 'graded-multi-size';
    const ga = input.gradingArtifact;
    if (!ga) {
      return reject(
        'GRADING_ARTIFACT_MISSING',
        'AuthoritativeGradingArtifact is mandatory when creating a graded-multi-size production package.'
      );
    }
    const gaIntegrity = verifyGradingArtifactIntegrity(ga);
    if (!gaIntegrity.isValid) {
      return reject(
        'GRADING_ARTIFACT_INVALID',
        `Grading artifact '${ga.gradingArtifactId}' failed integrity or validation checks: ${gaIntegrity.reason}`,
        gaIntegrity.errors
      );
    }

    // Verify acyclic upstream binding from gradingArtifact -> basePatternFingerprint (Amendment 1)
    const gaBoundBaseFp = ga.sourceBasePatternFingerprint ?? ga.sourcePatternSnapshotFingerprint;
    if (
      ga.sourcePatternRevisionId !== rev.revisionId ||
      !gaBoundBaseFp ||
      (gaBoundBaseFp !== basePatternFingerprint && gaBoundBaseFp !== rev.canonicalFingerprint) ||
      ga.sourceSpecificationId !== revGarmentId ||
      ga.sourceSpecificationRevisionId !== rev.sourceSpecificationRevisionId ||
      ga.sourceSpecificationFingerprint !== rev.sourceSpecificationFingerprint ||
      (ga.sourceMeasurementSetId && ga.sourceMeasurementSetId !== rev.sourceMeasurementSetId) ||
      ga.sourceMeasurementSetFingerprint !== rev.sourceMeasurementSetFingerprint
    ) {
      return reject(
        'GRADING_ARTIFACT_STALE_MISMATCH',
        `Grading artifact '${ga.gradingArtifactId}' upstream lineage does not match pattern revision '${rev.revisionId}' (expected basePatternFingerprint '${basePatternFingerprint.slice(0, 12)}', found '${(gaBoundBaseFp ?? 'missing').slice(0, 12)}').`
      );
    }

    includedSizes = [...ga.sizeRange];
    sourceGradingArtifactId = ga.gradingArtifactId;
    sourceGradingRevisionId = ga.gradingRevisionId;
    gradingArtifactFp = ga.contentFingerprint ?? computeGradingArtifactContentFingerprint(ga);

    for (const sz of includedSizes) {
      const szPieces = ga.perSizePatternGeometry[sz] ?? [];
      for (const p of szPieces) {
        pieceInventory.push({
          pieceId: p.id,
          pieceCode: p.pieceCode,
          pieceName: p.name,
          sizeCode: sz,
          pieceGeometryFingerprint: computePieceGeometryFingerprint(p),
          widthCm: p.stitchingContour?.boundingBox.widthCm ?? p.boundingBox?.widthCm ?? 0,
          heightCm: p.stitchingContour?.boundingBox.heightCm ?? p.boundingBox?.heightCm ?? 0,
          seamAllowanceWidthCm: p.seamAllowanceWidthCm,
          notchCount: p.notches.length,
          dartCount: p.darts.length
        });
      }
    }
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const createdBy = (input.createdBy ?? appRec.approverName).trim();
  const projectId = (input.projectId ?? rev.projectId).trim();
  const tenantId = (input.tenantId ?? projectId).trim();
  const packageId = (input.packageId ?? '').trim() || `pkg-${revGarmentId}-${rev.revisionId}`;
  const packageRevisionId = (input.packageRevisionId ?? '').trim() || `${packageId}-v1`;

  const validationDigest = computeCanonicalFingerprint({
    patternValidation: rev.validation,
    gradingValidation: input.gradingArtifact?.gradingValidationResult ?? null
  });

  const approvalDigest = computeCanonicalFingerprint({
    specificationApprovalFingerprint: specApprovalRes.canonicalFingerprint,
    measurementApprovalFingerprint: input.measurementSet.canonicalFingerprint,
    patternApprovalEventId: appRec.approvalEventId,
    patternApprover: appRec.approverName,
    patternApprovedAt: appRec.approvedAt,
    patternAuthorityTier: appRec.authorityTier,
    boundBasePatternFingerprint: basePatternFingerprint
  });

  const manifest: ProductionPackageManifest = {
    schemaVersion: PRODUCTION_PACKAGE_SCHEMA_VERSION,
    packageId,
    packageRevisionId,
    projectId,
    tenantId,
    garmentId: revGarmentId,
    createdAt,
    createdBy,
    sourceSpecificationId: rev.sourceSpecificationId ?? revGarmentId,
    sourceSpecificationRevisionId:
      rev.sourceSpecificationRevisionId ??
      rev.designSpecification.specificationRevisionId ??
      `spec-${revGarmentId}-v${rev.designSpecification.version}`,
    sourceSpecificationFingerprint: rev.sourceSpecificationFingerprint ?? activeSpecFp,
    sourceMeasurementSetId: rev.sourceMeasurementSetId ?? input.measurementSet.measurementSetId,
    sourceMeasurementRevisionId: rev.sourceMeasurementRevisionId ?? input.measurementSet.revisionId,
    sourceMeasurementSetFingerprint: rev.sourceMeasurementSetFingerprint ?? input.measurementSet.canonicalFingerprint,
    sourcePatternRevisionId: rev.revisionId,
    sourcePatternRevisionNumber: rev.revisionIndex,
    basePatternFingerprint,
    geometryFingerprint: rev.geometryFingerprint!,
    draftingConfigFingerprint: rev.draftingConfigFingerprint!,
    gradingMode: effectiveGradingMode,
    nonGradingReason,
    sourceGradingArtifactId,
    sourceGradingRevisionId,
    gradingArtifactFingerprint: gradingArtifactFp,
    includedSizes,
    baseSize: String(rev.targetSize),
    pieceInventory,
    pieceCount: rev.patternPieces.length,
    totalPieceInstancesAcrossSizes: pieceInventory.length,
    validationDigest,
    approvalDigest,
    isProductionReady: false
  };

  const manifestFingerprint = computeProductionPackageManifestFingerprint(manifest);

  const genesisEventPrelim: Omit<ProductionPackageLifecycleEvent, 'lifecycleEventFingerprint'> = {
    eventId: `pkg-evt-${packageId}-1-active`,
    packageId,
    fromState: null,
    toState: 'active',
    timestamp: createdAt,
    actorId: createdBy,
    actorRole: appRec.approverRole,
    reason: `AuthoritativeProductionPackage '${packageId}' created from approved pattern revision '${rev.revisionId}'.`,
    manifestFingerprint
  };

  const genesisEvent: ProductionPackageLifecycleEvent = {
    ...genesisEventPrelim,
    lifecycleEventFingerprint: computeProductionPackageLifecycleEventFingerprint(genesisEventPrelim)
  };

  const lifecycleHistory: readonly ProductionPackageLifecycleEvent[] = [genesisEvent];
  const currentStateFingerprint = computeProductionPackageCurrentStateFingerprint({
    packageId,
    manifestFingerprint,
    currentPackageState: 'active',
    latestLifecycleEventFingerprint: genesisEvent.lifecycleEventFingerprint,
    eventCount: 1
  });

  const pkg: AuthoritativeProductionPackage = deepFreeze({
    schemaVersion: PRODUCTION_PACKAGE_SCHEMA_VERSION,
    packageId,
    packageRevisionId,
    projectId,
    tenantId,
    garmentId: revGarmentId,
    manifest,
    manifestFingerprint,
    lifecycleHistory,
    currentPackageState: 'active',
    currentStateFingerprint,
    invalidationRecords: [],
    isProductionReady: false
  });

  return {
    isPackageCreated: true,
    package: pkg,
    blockingReasons: []
  };
}

/**
 * Independently verifies the manifest integrity and append-only lifecycle integrity
 * of an `AuthoritativeProductionPackage` (Amendment 1 & Amendment 2).
 */
export function verifyProductionPackageIntegrity(
  pkg: AuthoritativeProductionPackage | undefined
): ProductionPackageVerificationResult {
  if (!pkg || typeof pkg !== 'object' || !pkg.manifest) {
    return {
      isValid: false,
      isManifestTampered: false,
      isLifecycleTampered: false,
      reason: 'AuthoritativeProductionPackage or its manifest is missing.',
      errors: ['AuthoritativeProductionPackage or its manifest is missing.']
    };
  }

  if (
    (pkg as unknown as { isProductionReady: boolean }).isProductionReady !== false ||
    (pkg.manifest as unknown as { isProductionReady: boolean }).isProductionReady !== false
  ) {
    const reason = 'Industrial safety violation: production package asserts isProductionReady !== false.';
    return {
      isValid: false,
      isManifestTampered: true,
      isLifecycleTampered: false,
      reason,
      errors: [reason]
    };
  }

  const errors: string[] = [];
  let isManifestTampered = false;
  let isLifecycleTampered = false;

  const recomputedManifestFp = computeProductionPackageManifestFingerprint(pkg.manifest);
  if (pkg.manifestFingerprint !== recomputedManifestFp) {
    isManifestTampered = true;
    errors.push(
      `Production package manifestFingerprint mismatch: recorded '${pkg.manifestFingerprint}' vs recomputed '${recomputedManifestFp}'.`
    );
  }

  const history = pkg.lifecycleHistory;
  if (!Array.isArray(history) || history.length === 0) {
    isLifecycleTampered = true;
    errors.push('Production package lifecycleHistory is missing or empty.');
  } else {
    let expectedPrevEventFp: string | undefined = undefined;
    let expectedFromState: ProductionPackageLifecycleState | null = null;

    for (let i = 0; i < history.length; i++) {
      const ev = history[i];
      if (!ev || typeof ev !== 'object') {
        isLifecycleTampered = true;
        errors.push(`Package lifecycle event at index ${i} is malformed.`);
        continue;
      }
      if (ev.packageId !== pkg.packageId) {
        isLifecycleTampered = true;
        errors.push(`Package lifecycle event '${ev.eventId}' targets packageId '${ev.packageId}' !== '${pkg.packageId}'.`);
      }
      if (ev.manifestFingerprint !== recomputedManifestFp) {
        isLifecycleTampered = true;
        errors.push(
          `Package lifecycle event '${ev.eventId}' binds manifestFingerprint '${ev.manifestFingerprint}' !== immutable manifestFingerprint '${recomputedManifestFp}'.`
        );
      }
      if ((ev.previousEventFingerprint ?? undefined) !== expectedPrevEventFp) {
        isLifecycleTampered = true;
        errors.push(
          `Package lifecycle event '${ev.eventId}' at index ${i} has broken hash chain: previousEventFingerprint '${String(ev.previousEventFingerprint)}' !== expected '${String(expectedPrevEventFp)}'.`
        );
      }
      if (i === 0 && ev.fromState !== null) {
        isLifecycleTampered = true;
        errors.push(`Genesis package lifecycle event '${ev.eventId}' must have fromState === null.`);
      } else if (i > 0 && ev.fromState !== expectedFromState) {
        isLifecycleTampered = true;
        errors.push(
          `Package lifecycle event '${ev.eventId}' at index ${i} has discontinuous state transition: fromState '${String(ev.fromState)}' !== prior toState '${String(expectedFromState)}'.`
        );
      }

      const recomputedEvFp = computeProductionPackageLifecycleEventFingerprint(ev);
      if (ev.lifecycleEventFingerprint !== recomputedEvFp) {
        isLifecycleTampered = true;
        errors.push(
          `Package lifecycle event '${ev.eventId}' at index ${i} failed fingerprint check: recorded '${ev.lifecycleEventFingerprint}' !== recomputed '${recomputedEvFp}'.`
        );
      }

      expectedPrevEventFp = ev.lifecycleEventFingerprint;
      expectedFromState = ev.toState;
    }

    const latestEvent = history[history.length - 1];
    const derivedState = latestEvent.toState;
    if (pkg.currentPackageState !== derivedState) {
      isLifecycleTampered = true;
      errors.push(
        `Package currentPackageState '${pkg.currentPackageState}' disagrees with derived lifecycle state '${derivedState}'.`
      );
    }

    const recomputedCurrentStateFp = computeProductionPackageCurrentStateFingerprint({
      packageId: pkg.packageId,
      manifestFingerprint: recomputedManifestFp,
      currentPackageState: derivedState,
      latestLifecycleEventFingerprint: latestEvent.lifecycleEventFingerprint,
      eventCount: history.length
    });

    if (pkg.currentStateFingerprint !== recomputedCurrentStateFp) {
      isLifecycleTampered = true;
      errors.push(
        `Package currentStateFingerprint '${pkg.currentStateFingerprint}' disagrees with recomputed '${recomputedCurrentStateFp}'.`
      );
    }

    return {
      isValid: errors.length === 0,
      isManifestTampered,
      isLifecycleTampered,
      recomputedManifestFingerprint: recomputedManifestFp,
      recomputedCurrentStateFingerprint: recomputedCurrentStateFp,
      reason: errors[0],
      errors
    };
  }

  return {
    isValid: false,
    isManifestTampered,
    isLifecycleTampered,
    recomputedManifestFingerprint: recomputedManifestFp,
    reason: errors[0],
    errors
  };
}

function appendProductionPackageLifecycleEvent(
  pkg: AuthoritativeProductionPackage,
  params: {
    readonly toState: ProductionPackageLifecycleState;
    readonly timestamp?: string;
    readonly actorId: string;
    readonly actorRole: string;
    readonly reason: string;
    readonly invalidationRecord?: PatternInvalidationRecord;
    readonly supersededByPackageId?: string;
  }
): AuthoritativeProductionPackage {
  const integrity = verifyProductionPackageIntegrity(pkg);
  if (!integrity.isValid) {
    throw new ProductionSnapshotValidationError(
      `Cannot transition production package '${pkg?.packageId ?? 'unknown'}': package failed integrity verification (${integrity.reason}).`
    );
  }

  const timestamp = params.timestamp ?? new Date().toISOString();
  const latestEvent = pkg.lifecycleHistory[pkg.lifecycleHistory.length - 1];
  const eventIndex = pkg.lifecycleHistory.length + 1;
  const eventId = `pkg-evt-${pkg.packageId}-${eventIndex}-${params.toState}`;

  const eventPrelim: Omit<ProductionPackageLifecycleEvent, 'lifecycleEventFingerprint'> = {
    eventId,
    packageId: pkg.packageId,
    fromState: pkg.currentPackageState,
    toState: params.toState,
    timestamp,
    actorId: params.actorId.trim(),
    actorRole: params.actorRole.trim(),
    reason: params.reason.trim(),
    manifestFingerprint: pkg.manifestFingerprint,
    previousEventFingerprint: latestEvent.lifecycleEventFingerprint,
    invalidationRecord: params.invalidationRecord,
    supersededByPackageId: params.supersededByPackageId
  };

  const newEvent: ProductionPackageLifecycleEvent = {
    ...eventPrelim,
    lifecycleEventFingerprint: computeProductionPackageLifecycleEventFingerprint(eventPrelim)
  };

  const nextHistory: readonly ProductionPackageLifecycleEvent[] = [...pkg.lifecycleHistory, newEvent];
  const nextCurrentStateFp = computeProductionPackageCurrentStateFingerprint({
    packageId: pkg.packageId,
    manifestFingerprint: pkg.manifestFingerprint,
    currentPackageState: params.toState,
    latestLifecycleEventFingerprint: newEvent.lifecycleEventFingerprint,
    eventCount: nextHistory.length
  });

  const nextInvalidationRecords: readonly PatternInvalidationRecord[] = params.invalidationRecord
    ? [...pkg.invalidationRecords, params.invalidationRecord]
    : pkg.invalidationRecords;

  return deepFreeze({
    ...pkg,
    // Immutable manifest and manifestFingerprint are strictly preserved (Amendment 2)
    manifest: pkg.manifest,
    manifestFingerprint: pkg.manifestFingerprint,
    lifecycleHistory: nextHistory,
    currentPackageState: params.toState,
    currentStateFingerprint: nextCurrentStateFp,
    supersededByPackageId: params.supersededByPackageId ?? pkg.supersededByPackageId,
    invalidationRecords: nextInvalidationRecords,
    revocationReason: params.toState === 'revoked' ? params.reason.trim() : pkg.revocationReason,
    revokedAt: params.toState === 'revoked' ? timestamp : pkg.revokedAt,
    isProductionReady: false
  });
}

/**
 * Transitions an `'active'` production package to `'superseded'` without modifying
 * its `manifest` or `manifestFingerprint` (Amendment 2).
 */
export function supersedeProductionPackage(
  pkg: AuthoritativeProductionPackage,
  options: {
    readonly supersededByPackageId: string;
    readonly actorId?: string;
    readonly actorRole?: string;
    readonly timestamp?: string;
    readonly reason?: string;
  }
): AuthoritativeProductionPackage {
  if (pkg.currentPackageState !== 'active') {
    throw new ProductionSnapshotValidationError(
      `Invalid package transition: package '${pkg.packageId}' in state '${pkg.currentPackageState}' cannot be superseded.`
    );
  }
  const nextPkgId = (options.supersededByPackageId ?? '').trim();
  if (!nextPkgId || nextPkgId === pkg.packageId) {
    throw new ProductionSnapshotValidationError('supersedeProductionPackage requires a distinct non-empty supersededByPackageId.');
  }

  return appendProductionPackageLifecycleEvent(pkg, {
    toState: 'superseded',
    timestamp: options.timestamp,
    actorId: options.actorId ?? 'package-lifecycle-engine',
    actorRole: options.actorRole ?? 'lifecycle-engine',
    reason: options.reason ?? `Production package '${pkg.packageId}' superseded by '${nextPkgId}'.`,
    supersededByPackageId: nextPkgId
  });
}

/**
 * Transitions an `'active'` production package to `'invalidated'` without modifying
 * its `manifest` or `manifestFingerprint` (Amendment 2).
 */
export function invalidateProductionPackage(
  pkg: AuthoritativeProductionPackage,
  input: {
    readonly cause: PatternInvalidationCause;
    readonly reason: string;
    readonly invalidatedAt?: string;
    readonly invalidatedBy?: string;
    readonly upstreamArtifactId?: string;
    readonly recordedUpstreamFingerprint?: string;
    readonly activeUpstreamFingerprint?: string;
  }
): AuthoritativeProductionPackage {
  if (pkg.currentPackageState === 'archived') {
    throw new ProductionSnapshotValidationError(
      `Cannot invalidate production package '${pkg.packageId}': package is already archived.`
    );
  }
  const invalidatedAt = input.invalidatedAt ?? new Date().toISOString();
  const invalidatedBy = (input.invalidatedBy ?? 'dependency-invalidation-engine').trim();
  const invalidationRecord: PatternInvalidationRecord = {
    invalidationId: `pkg-inv-${pkg.packageId}-${pkg.invalidationRecords.length + 1}`,
    cause: input.cause,
    reason: input.reason.trim(),
    invalidatedAt,
    invalidatedBy,
    upstreamArtifactId: input.upstreamArtifactId,
    recordedUpstreamFingerprint: input.recordedUpstreamFingerprint,
    activeUpstreamFingerprint: input.activeUpstreamFingerprint
  };

  return appendProductionPackageLifecycleEvent(pkg, {
    toState: 'invalidated',
    timestamp: invalidatedAt,
    actorId: invalidatedBy,
    actorRole: 'dependency-invalidation-engine',
    reason: input.reason.trim(),
    invalidationRecord
  });
}

/**
 * Transitions an `'active'` production package to `'revoked'` without modifying
 * its `manifest` or `manifestFingerprint` (Amendment 2).
 */
export function revokeProductionPackage(
  pkg: AuthoritativeProductionPackage,
  options: {
    readonly reason: string;
    readonly actorId?: string;
    readonly actorRole?: string;
    readonly revokedAt?: string;
  }
): AuthoritativeProductionPackage {
  if (!options?.reason || options.reason.trim() === '') {
    throw new ProductionSnapshotValidationError('revokeProductionPackage requires a non-empty reason.');
  }
  if (pkg.currentPackageState === 'archived') {
    throw new ProductionSnapshotValidationError(
      `Cannot revoke production package '${pkg.packageId}': package is already archived.`
    );
  }

  return appendProductionPackageLifecycleEvent(pkg, {
    toState: 'revoked',
    timestamp: options.revokedAt,
    actorId: options.actorId ?? 'production-governance-authority',
    actorRole: options.actorRole ?? 'governance-authority',
    reason: options.reason.trim()
  });
}

/**
 * Transitions a `'superseded'`, `'invalidated'`, or `'revoked'` production package to terminal
 * `'archived'` state without modifying its `manifest` or `manifestFingerprint` (Amendment 2).
 */
export function archiveProductionPackage(
  pkg: AuthoritativeProductionPackage,
  options?: {
    readonly actorId?: string;
    readonly actorRole?: string;
    readonly archivedAt?: string;
    readonly reason?: string;
  }
): AuthoritativeProductionPackage {
  if (
    pkg.currentPackageState !== 'superseded' &&
    pkg.currentPackageState !== 'invalidated' &&
    pkg.currentPackageState !== 'revoked'
  ) {
    throw new ProductionSnapshotValidationError(
      `Invalid package transition: package '${pkg.packageId}' in state '${pkg.currentPackageState}' cannot transition directly to 'archived'.`
    );
  }

  return appendProductionPackageLifecycleEvent(pkg, {
    toState: 'archived',
    timestamp: options?.archivedAt,
    actorId: options?.actorId ?? 'package-lifecycle-engine',
    actorRole: options?.actorRole ?? 'lifecycle-engine',
    reason:
      options?.reason ??
      `Production package '${pkg.packageId}' archived from '${pkg.currentPackageState}' state.`
  });
}

