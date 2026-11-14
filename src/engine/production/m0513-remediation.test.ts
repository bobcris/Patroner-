/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner — Milestone 05.1.3 Targeted Remediation Adversarial Test Suite
 *
 * Covers:
 * - Remediation A: PIPE-BUG-01 & PIPE-BUG-02 (Pipeline & Export consistency)
 * - Remediation B: GRAD-EDGE-02 (Bézier controlPoints validation)
 * - Remediation C: PKG-EDGE (Authoritative binding of sourcePatternRevisionNumber, validationDigest, approvalDigest)
 * - Remediation D: DATE-EDGE-01 / 02 (Strict Gregorian calendar ISO-8601 timestamp validation)
 * - Remediation E: GRAD-EDGE-01 (Strict gradedPatternSet.sizeResults & sizeRange coverage)
 * - Remediation F: Pattern revision lifecycle limitationNotes propagation & safety invariants
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { draftSkirtBlock } from '../drafting/skirt-block';
import { validatePatternDraft } from '../validation/seam-validator';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { ENHANCED_PRESET_FABRICS, getEnhancedFabricById } from '../fabric/fabric-presets';
import { DEFAULT_SIZE_RANGE } from '../grading';
import {
  approveAuthoritativeGarmentSpecification,
  computeSpecificationFingerprint,
  convertToDesignSpecification,
  createAuthoritativeGarmentSpecification,
  createControlledPublicKeyRegistration,
  createControlledPublicKeyRegistry,
  createInMemoryJtiReplayStore,
  createOidcPublicJwk,
  createTrustedCryptographicVerifier,
  createTrustedIdentityVerifier,
  deriveEd25519SigningKeyPair,
  issueVerifiableIdentityCredential,
  registerPublicKeyInRegistry,
  signSpecificationApprovalPayload
} from './garment-specification';
import {
  approveAuthoritativeMeasurementSet,
  approvePatternRevision,
  computeCanonicalGradingArtifactFingerprint,
  computeCanonicalRevisionFingerprint,
  computeGradingArtifactContentFingerprint,
  computeProductionPackageCurrentStateFingerprint,
  computeProductionPackageLifecycleEventFingerprint,
  computeProductionPackageManifestFingerprint,
  createAuthoritativeGradingArtifact,
  createAuthoritativeMeasurementSet,
  createAuthoritativeProductionPackage,
  createDraftPatternRevision,
  evaluatePipelineDependencyIntegrity,
  isStrictValidIsoTimestamp,
  PATTERN_REVISION_LIFECYCLE_LIMITATION_NOTES,
  revokeAuthoritativeGradingArtifact,
  signPatternRevisionApprovalPayload,
  validatePatternRevision,
  validateProductionExportPrerequisites,
  validateProductionPatternRevision,
  verifyGradingArtifactIntegrity,
  verifyPatternRevisionLifecycleIntegrity,
  verifyProductionPackageIntegrity
} from './index';
import {
  AuthoritativeGradingArtifact,
  AuthoritativeProductionPackage,
  GeometricSegmentSnapshot,
  PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION,
  PatternPieceSnapshot,
  ProductionPackageLifecycleEvent,
  ProductionPackageManifest,
  ProductionSnapshotValidationError
} from './production-types';
import { SPECIFICATION_CANONICAL_SCHEMA_VERSION } from './garment-specification-types';
import { DesignSpecification } from '../../types';

const PROJECT_ID = 'project-patroner-m0513';
const GARMENT_ID = 'garment-skirt-m0513-01';
const ISSUER_URL = 'https://idp.patroner.atelier';
const AUDIENCE = 'patroner-production-engine';
const SIZE_M = STANDARD_SIZING_SYSTEM.sizes.M;

function buildLiveTimestamps(offsetMs = 0) {
  const nowMs = Date.now() + offsetMs;
  const createdMs = nowMs - 120_000;
  const validatedMs = nowMs - 60_000;
  const approvedMs = nowMs - 30_000;
  const expiresMs = nowMs + 3_600_000;
  return {
    nowIso: new Date(nowMs).toISOString(),
    createdIso: new Date(createdMs).toISOString(),
    validatedIso: new Date(validatedMs).toISOString(),
    approvedIso: new Date(approvedMs).toISOString(),
    expiresIso: new Date(expiresMs).toISOString()
  };
}

function toGradedSkirtSet(
  designSpec: DesignSpecification,
  sizes: readonly string[] = DEFAULT_SIZE_RANGE
) {
  const sizeResults: Record<string, any> = {};
  for (const sz of sizes) {
    const meas =
      STANDARD_SIZING_SYSTEM.sizes[sz as keyof typeof STANDARD_SIZING_SYSTEM.sizes] ?? SIZE_M;
    const skirtPieces = draftSkirtBlock(meas, designSpec);
    sizeResults[sz] = {
      sizeId: sz,
      sizeLabel: sz,
      measurements: meas,
      bodicePieces: [],
      sleevePiece: undefined,
      skirtPieces,
      validation: validatePatternDraft(skirtPieces),
      status: 'verified-valid',
      isValid: true,
      errors: [],
      warnings: []
    };
  }
  return {
    baseSize: 'M',
    sizeRange: [...sizes],
    supportedSizes: [...sizes],
    sizeResults,
    integrityReport: {
      timestamp: new Date().toISOString(),
      baseSize: 'M',
      evaluatedSizes: [...sizes],
      validSizeCount: sizes.length,
      failedSizeCount: 0,
      unassessedSizeCount: 0,
      isOverallGradingValid: true,
      checks: [],
      comparisonTable: [],
      summaryMessage: 'Cross-size skirt grading verified.',
      unassessedConditions: []
    }
  };
}

function buildM0513Fixture() {
  const ts = buildLiveTimestamps();
  const oidcKid = 'oidc-kid-m0513-live';
  const oidcSeed = 'm0513-oidc-issuer-ed25519-seed-material-01';
  const publicJwk = createOidcPublicJwk(oidcKid, oidcSeed, {
    issuer: ISSUER_URL,
    tenantId: PROJECT_ID
  });
  const replayStore = createInMemoryJtiReplayStore();
  const identityVerifier = createTrustedIdentityVerifier({
    trustedIssuers: [ISSUER_URL],
    expectedAudience: AUDIENCE,
    expectedTenantId: PROJECT_ID,
    publicJwks: [publicJwk],
    replayStore
  });

  const specKey = deriveEd25519SigningKeyPair('key-m0513-spec-01', 'seed-m0513-spec-01', {
    ownerPrincipal: 'Clara Moreau (Specification Authority)',
    tenantId: PROJECT_ID,
    allowedScopes: ['specification:approve'],
    activatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z'
  });
  const patternKey = deriveEd25519SigningKeyPair('key-m0513-pat-01', 'seed-m0513-pat-01', {
    ownerPrincipal: 'Clara Moreau (Pattern Authority)',
    tenantId: PROJECT_ID,
    allowedScopes: ['pattern:approve'],
    activatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z'
  });

  let registry = createControlledPublicKeyRegistry();
  registry = registerPublicKeyInRegistry(registry, specKey.publicKeyRegistration);
  registry = registerPublicKeyInRegistry(registry, patternKey.publicKeyRegistration);
  const cryptographicVerifier = createTrustedCryptographicVerifier({
    publicKeyRegistry: Object.values(registry.entries)
  });

  const enhancedLookup = getEnhancedFabricById(ENHANCED_PRESET_FABRICS[0].id);
  const fabric = enhancedLookup.status === 'found' ? enhancedLookup.fabric : ENHANCED_PRESET_FABRICS[0];

  const draftSpec = createAuthoritativeGarmentSpecification({
    projectId: PROJECT_ID,
    garmentId: GARMENT_ID,
    specificationRevisionId: `spec-${GARMENT_ID}-v1`,
    version: 1,
    name: 'M0513 Architectural Midi Skirt',
    garmentCategory: 'skirt',
    silhouette: 'pencil',
    fabric,
    color: { name: 'Obsidian', hex: '#18181B' },
    easeProfile: 'classic',
    lengthCm: 64,
    prompt: 'Architectural midi skirt for Milestone 05.1.3 verification',
    constructionFeatures: [],
    designNotes: [],
    createdAt: ts.createdIso,
    updatedAt: ts.createdIso,
    fabricProvenance: 'supplier-declared'
  });

  const specSig = signSpecificationApprovalPayload(
    {
      schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
      projectId: PROJECT_ID,
      garmentId: GARMENT_ID,
      specificationRevisionId: draftSpec.specificationRevisionId,
      specificationVersion: draftSpec.version,
      canonicalSpecificationFingerprint: computeSpecificationFingerprint(draftSpec),
      approvalEventId: 'spec-app-evt-m0513-1',
      approverPrincipal: 'Clara Moreau (Specification Authority)',
      authorityTier: 'cryptographic_principal',
      approvalScope: 'specification:approve',
      approvalTimestamp: ts.approvedIso
    },
    {
      keyId: specKey.keyId,
      privateKeyHex: specKey.privateKeyHex,
      tenantId: PROJECT_ID
    }
  );

  const approvedSpec = approveAuthoritativeGarmentSpecification(
    draftSpec,
    'Clara Moreau (Specification Authority)',
    {
      approvedAt: ts.approvedIso,
      approvalEventId: 'spec-app-evt-m0513-1',
      authorityTier: 'cryptographic_principal',
      cryptographicVerifier,
      cryptographicSignature: specSig
    }
  );

  const unapprovedMeas = createAuthoritativeMeasurementSet({
    measurementSetId: `meas-${GARMENT_ID}-m-v1`,
    revisionId: `meas-rev-${GARMENT_ID}-m-v1`,
    values: ({ ...SIZE_M } as unknown) as Record<string, number>,
    provenance: 'physically-measured',
    evidence: {
      operatorName: 'Luciano Conti (Master Tailor)',
      measurementSource: 'physical-tape-measure',
      recordedAt: ts.createdIso
    },
    recordedAt: ts.createdIso
  });
  const approvedMeas = approveAuthoritativeMeasurementSet(unapprovedMeas, {
    approvingAuthority: 'Luciano Conti (Master Tailor)',
    approvedAt: ts.createdIso,
    notes: ['Physical dress form verified.']
  });

  const designSpec = convertToDesignSpecification(approvedSpec);
  const pieces = draftSkirtBlock(SIZE_M, designSpec);
  const validationReport = validatePatternDraft(pieces);
  const gradedSet = toGradedSkirtSet(designSpec);

  const draftRev = createDraftPatternRevision({
    revisionId: 'pat-rev-m0513-1',
    revisionNumber: 1,
    projectId: PROJECT_ID,
    garmentId: GARMENT_ID,
    createdAt: ts.createdIso,
    designSpec,
    authoritativeSpec: approvedSpec,
    authoritativeMeasurementSet: approvedMeas,
    pieces,
    validationReport,
    enhancedFabric: fabric,
    fabricSource: 'verified-preset'
  });

  const validatedRev = validatePatternRevision(draftRev, {
    actorId: 'qa-validator-m0513',
    validatedAt: ts.validatedIso
  });

  const patSig = signPatternRevisionApprovalPayload(
    {
      schemaVersion: PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION,
      projectId: PROJECT_ID,
      tenantId: PROJECT_ID,
      garmentId: GARMENT_ID,
      patternRevisionId: validatedRev.revisionId,
      patternRevisionNumber: validatedRev.revisionIndex,
      basePatternFingerprint: validatedRev.basePatternFingerprint!,
      geometryFingerprint: validatedRev.geometryFingerprint!,
      sourceSpecificationFingerprint: validatedRev.sourceSpecificationFingerprint!,
      sourceMeasurementSetFingerprint: validatedRev.sourceMeasurementSetFingerprint!,
      approvalEventId: 'pat-app-evt-m0513-1',
      approverPrincipal: 'Clara Moreau (Pattern Authority)',
      authorityTier: 'cryptographic_principal',
      approvalScope: 'pattern:approve',
      approvalTimestamp: ts.approvedIso
    },
    {
      keyId: patternKey.keyId,
      privateKeyHex: patternKey.privateKeyHex,
      tenantId: PROJECT_ID
    }
  );

  const approvedRev = approvePatternRevision(validatedRev, {
    approverName: 'Clara Moreau (Pattern Authority)',
    approvedAt: ts.approvedIso,
    approvalEventId: 'pat-app-evt-m0513-1',
    authorityTier: 'cryptographic_principal',
    sourceSpecification: approvedSpec,
    sourceMeasurementSet: approvedMeas,
    cryptographicVerifier,
    cryptographicSignature: patSig
  });

  const gradingArtifact = createAuthoritativeGradingArtifact({
    projectId: PROJECT_ID,
    tenantId: PROJECT_ID,
    sourceSpecificationId: GARMENT_ID,
    sourceSpecificationRevisionId: approvedSpec.specificationRevisionId,
    sourceSpecificationFingerprint: approvedSpec.approvedContentFingerprint!,
    sourcePatternRevisionId: approvedRev.revisionId,
    sourceBasePatternFingerprint: approvedRev.basePatternFingerprint,
    sourceMeasurementSetId: approvedMeas.measurementSetId,
    sourceMeasurementSetFingerprint: approvedMeas.canonicalFingerprint,
    baseSize: 'M',
    sizeRange: [...DEFAULT_SIZE_RANGE],
    gradedPatternSet: gradedSet as any,
    basePatternPieces: pieces,
    createdAt: ts.approvedIso
  });

  return {
    ts,
    oidcKid,
    oidcSeed,
    publicJwk,
    replayStore,
    identityVerifier,
    specKey,
    patternKey,
    cryptographicVerifier,
    fabric,
    approvedSpec,
    approvedMeas,
    designSpec,
    pieces,
    validationReport,
    gradedSet,
    draftRev,
    validatedRev,
    approvedRev,
    gradingArtifact
  };
}

function rehashPackageManifest(
  pkg: AuthoritativeProductionPackage,
  manifestOverride: Partial<ProductionPackageManifest>
): AuthoritativeProductionPackage {
  const newManifest: ProductionPackageManifest = {
    ...pkg.manifest,
    ...manifestOverride
  };
  const newManifestFp = computeProductionPackageManifestFingerprint(newManifest);
  const newHistory: ProductionPackageLifecycleEvent[] = [];
  let prevFp: string | undefined = undefined;
  for (const ev of pkg.lifecycleHistory) {
    const baseEv: Omit<ProductionPackageLifecycleEvent, 'lifecycleEventFingerprint'> = {
      eventId: ev.eventId,
      eventIndex: ev.eventIndex,
      packageId: ev.packageId,
      fromState: ev.fromState,
      toState: ev.toState,
      timestamp: ev.timestamp,
      actorId: ev.actorId,
      actorRole: ev.actorRole,
      reason: ev.reason,
      manifestFingerprint: newManifestFp,
      ...(prevFp ? { previousEventFingerprint: prevFp } : {}),
      ...(ev.invalidationRecord ? { invalidationRecord: ev.invalidationRecord } : {}),
      ...(ev.supersededByPackageId ? { supersededByPackageId: ev.supersededByPackageId } : {})
    };
    const evFp = computeProductionPackageLifecycleEventFingerprint(baseEv);
    newHistory.push({ ...baseEv, lifecycleEventFingerprint: evFp });
    prevFp = evFp;
  }
  const latest = newHistory[newHistory.length - 1];
  const newStateFp = computeProductionPackageCurrentStateFingerprint({
    packageId: pkg.packageId,
    manifestFingerprint: newManifestFp,
    currentPackageState: pkg.currentPackageState,
    latestLifecycleEventFingerprint: latest.lifecycleEventFingerprint,
    eventCount: newHistory.length
  });
  return {
    ...pkg,
    manifest: newManifest,
    manifestFingerprint: newManifestFp,
    lifecycleHistory: newHistory,
    currentStateFingerprint: newStateFp
  };
}

describe('Milestone 05.1.3 — Pipeline Consistency, Bézier Geometry & Package Lineage Binding', () => {
  // --------------------------------------------------------------------------
  // Remediation A — PIPE-BUG-01 & PIPE-BUG-02
  // --------------------------------------------------------------------------
  describe('A. PIPE-BUG-01 & PIPE-BUG-02: Pipeline Authorization & Export Status Consistency', () => {
    it('blocks export & pipeline sync for revoked, invalid, stale, and missing grading states consistently with validateProductionExportPrerequisites', () => {
      const f = buildM0513Fixture();
      const baseInputs = {
        specification: f.approvedSpec,
        measurements: SIZE_M,
        activeSize: 'M',
        fabric: f.fabric,
        patternPieces: f.pieces,
        validationReport: f.validationReport,
        verificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        measurementSet: f.approvedMeas,
        productionSnapshot: f.approvedRev,
        gradingArtifact: f.gradingArtifact,
        exportGradingPolicy: { mode: 'graded-multi-size' as const }
      };

      // 1. Valid synchronized state
      const validPipe = evaluatePipelineDependencyIntegrity(baseInputs);
      assert.equal(validPipe.artifacts.grading.status, 'current');
      assert.equal(validPipe.artifacts['production-export'].status, 'current');
      assert.equal(validPipe.artifacts['production-export'].validationStatus, 'export-ready');
      assert.equal(validPipe.artifacts['production-export'].regenerationRequired, false);
      assert.equal(validPipe.hasBlockingErrors, false);
      assert.equal(validPipe.hasStaleArtifacts, false);
      assert.equal(validPipe.canExportProductionDocumentation, true);
      assert.equal(validPipe.isPipelineSynchronized, true);
      const validExport = validateProductionExportPrerequisites(validPipe, f.approvedRev, baseInputs);
      assert.equal(validExport.isExportPermitted, true);
      assert.equal(validExport.manufacturingDocumentation?.isProductionReady, false);

      // 2. PIPE-BUG-01: Revoked grading artifact must block export & sync everywhere
      const revokedGrading = revokeAuthoritativeGradingArtifact(
        f.gradingArtifact,
        'Defect discovered in graded side seam notch spacing',
        f.ts.nowIso
      );
      const revokedPipe = evaluatePipelineDependencyIntegrity({
        ...baseInputs,
        gradingArtifact: revokedGrading
      });
      assert.equal(revokedPipe.artifacts.grading.status, 'revoked');
      assert.equal(revokedPipe.artifacts['production-export'].status, 'invalid');
      assert.equal(revokedPipe.artifacts['production-export'].validationStatus, 'export-blocked');
      assert.equal(revokedPipe.artifacts['production-export'].regenerationRequired, true);
      assert.equal(revokedPipe.hasBlockingErrors, true);
      assert.equal(revokedPipe.canExportProductionDocumentation, false);
      assert.equal(revokedPipe.isPipelineSynchronized, false);
      assert.ok((revokedPipe.blockingReasons?.length ?? 0) > 0);
      const revokedExport = validateProductionExportPrerequisites(revokedPipe, f.approvedRev, {
        ...baseInputs,
        gradingArtifact: revokedGrading
      });
      assert.equal(revokedExport.isExportPermitted, false);
      assert.equal(revokedExport.rejectionCode, 'GRADING_ARTIFACT_REVOKED');

      // 3. PIPE-BUG-02: Invalid grading artifact (failed validation & tampered)
      const invalidValidationGrading = createAuthoritativeGradingArtifact({
        projectId: PROJECT_ID,
        tenantId: PROJECT_ID,
        sourceSpecificationId: GARMENT_ID,
        sourceSpecificationRevisionId: f.approvedSpec.specificationRevisionId,
        sourceSpecificationFingerprint: f.approvedSpec.approvedContentFingerprint!,
        sourcePatternRevisionId: f.approvedRev.revisionId,
        sourceBasePatternFingerprint: f.approvedRev.basePatternFingerprint,
        sourceMeasurementSetId: f.approvedMeas.measurementSetId,
        sourceMeasurementSetFingerprint: f.approvedMeas.canonicalFingerprint,
        baseSize: 'M',
        sizeRange: [...DEFAULT_SIZE_RANGE],
        perSizePatternGeometry: f.gradingArtifact.perSizePatternGeometry,
        geometryValidationResult: {
          ...f.gradingArtifact.geometryValidationResult,
          XL: {
            ...f.gradingArtifact.geometryValidationResult['XL'],
            isValid: false,
            status: 'invalid',
            errors: ['Armhole/side-seam mismatch on XL']
          }
        },
        createdAt: f.ts.approvedIso
      });
      const invalidPipe = evaluatePipelineDependencyIntegrity({
        ...baseInputs,
        gradingArtifact: invalidValidationGrading
      });
      assert.equal(invalidPipe.artifacts.grading.status, 'invalid');
      assert.equal(invalidPipe.artifacts['production-export'].status, 'invalid');
      assert.equal(invalidPipe.artifacts['production-export'].validationStatus, 'export-blocked');
      assert.equal(invalidPipe.hasBlockingErrors, true);
      assert.equal(invalidPipe.canExportProductionDocumentation, false);
      assert.equal(invalidPipe.isPipelineSynchronized, false);
      const invalidExport = validateProductionExportPrerequisites(invalidPipe, f.approvedRev, {
        ...baseInputs,
        gradingArtifact: invalidValidationGrading
      });
      assert.equal(invalidExport.isExportPermitted, false);
      assert.equal(invalidExport.rejectionCode, 'GRADING_VALIDATION_FAILED');

      // Tampered grading artifact even when base drafting happened to stay or become stale
      const tamperedGrading: AuthoritativeGradingArtifact = {
        ...f.gradingArtifact,
        canonicalFingerprint: 'd'.repeat(64)
      };
      const tamperedPipe = evaluatePipelineDependencyIntegrity({
        ...baseInputs,
        gradingArtifact: tamperedGrading
      });
      assert.equal(tamperedPipe.artifacts.grading.status, 'invalid');
      assert.equal(tamperedPipe.artifacts['production-export'].status, 'invalid');
      assert.equal(tamperedPipe.hasBlockingErrors, true);
      assert.equal(tamperedPipe.canExportProductionDocumentation, false);
      assert.equal(tamperedPipe.isPipelineSynchronized, false);

      // 4. Stale grading artifact (superseded / mismatched rules)
      const supersededGradingBase: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
        ...f.gradingArtifact,
        lifecycleState: 'superseded',
        supersededByRevisionId: 'grade-rev-m0513-2'
      };
      const supersededGrading: AuthoritativeGradingArtifact = {
        ...supersededGradingBase,
        canonicalFingerprint: computeCanonicalGradingArtifactFingerprint(supersededGradingBase)
      };
      const stalePipe = evaluatePipelineDependencyIntegrity({
        ...baseInputs,
        gradingArtifact: supersededGrading
      });
      assert.equal(stalePipe.artifacts.grading.status, 'stale');
      assert.equal(stalePipe.artifacts['production-export'].status, 'stale');
      assert.equal(stalePipe.hasStaleArtifacts, true);
      assert.equal(stalePipe.hasBlockingErrors, true);
      assert.equal(stalePipe.canExportProductionDocumentation, false);
      assert.equal(stalePipe.isPipelineSynchronized, false);
      const staleExport = validateProductionExportPrerequisites(stalePipe, f.approvedRev, {
        ...baseInputs,
        gradingArtifact: supersededGrading
      });
      assert.equal(staleExport.isExportPermitted, false);
      assert.equal(staleExport.rejectionCode, 'GRADING_ARTIFACT_SUPERSEDED');

      // 5. Missing required grading artifact when graded-multi-size policy declared
      const missingGradingInputs = {
        ...baseInputs,
        gradingArtifact: undefined
      };
      const missingPipe = evaluatePipelineDependencyIntegrity(missingGradingInputs);
      assert.equal(missingPipe.artifacts.grading.status, 'unverified');
      assert.equal(missingPipe.artifacts['production-export'].status, 'pending');
      assert.equal(missingPipe.hasBlockingErrors, true);
      assert.equal(missingPipe.canExportProductionDocumentation, false);
      assert.equal(missingPipe.isPipelineSynchronized, false);
      const missingExport = validateProductionExportPrerequisites(
        missingPipe,
        f.approvedRev,
        missingGradingInputs
      );
      assert.equal(missingExport.isExportPermitted, false);
      assert.equal(missingExport.rejectionCode, 'GRADING_ARTIFACT_MISSING');

      // 6. Forged top-level report flags rejected by validateProductionExportPrerequisites
      const forgedRevokedReport = {
        ...revokedPipe,
        canExportProductionDocumentation: true,
        isPipelineSynchronized: true,
        hasBlockingErrors: false
      };
      const forgedCheck = validateProductionExportPrerequisites(forgedRevokedReport, f.approvedRev, {
        ...baseInputs,
        gradingArtifact: revokedGrading
      });
      assert.equal(forgedCheck.isExportPermitted, false);
      assert.equal(forgedCheck.rejectionCode, 'FORGED_REPORT_DETECTED');
    });
  });

  // --------------------------------------------------------------------------
  // Remediation B — GRAD-EDGE-02: Bézier controlPoints validation
  // --------------------------------------------------------------------------
  describe('B. GRAD-EDGE-02: Bézier Control-Point Validation in Creation & Verification', () => {
    function buildPieceWithSegment(
      basePiece: PatternPieceSnapshot,
      seg: GeometricSegmentSnapshot
    ): PatternPieceSnapshot {
      return {
        ...basePiece,
        stitchingContour: {
          ...basePiece.stitchingContour!,
          segments: [seg, ...basePiece.stitchingContour!.segments.slice(1)]
        }
      };
    }

    it('accepts valid 2-point Bézier & line segments while rejecting missing, wrong-length, NaN, Infinity, or line controlPoints at creation and verification', () => {
      const f = buildM0513Fixture();
      const baseProps = {
        projectId: PROJECT_ID,
        tenantId: PROJECT_ID,
        sourceSpecificationId: GARMENT_ID,
        sourceSpecificationRevisionId: f.approvedSpec.specificationRevisionId,
        sourceSpecificationFingerprint: f.approvedSpec.approvedContentFingerprint!,
        sourcePatternRevisionId: f.approvedRev.revisionId,
        sourceBasePatternFingerprint: f.approvedRev.basePatternFingerprint,
        sourceMeasurementSetId: f.approvedMeas.measurementSetId,
        sourceMeasurementSetFingerprint: f.approvedMeas.canonicalFingerprint,
        baseSize: 'M',
        sizeRange: [...DEFAULT_SIZE_RANGE],
        createdAt: f.ts.approvedIso
      };

      const sPieces = f.gradingArtifact.perSizePatternGeometry['S'];
      const validBezierSeg: GeometricSegmentSnapshot = {
        id: 'bezier-valid-1',
        type: 'bezier',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 12 },
        controlPoints: [{ x: 3, y: 2 }, { x: 7, y: 10 }],
        seamAllowanceCm: 1.5,
        isFold: false,
        lengthCm: 16.2
      };
      const validLineSeg: GeometricSegmentSnapshot = {
        id: 'line-valid-1',
        type: 'line',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        seamAllowanceCm: 1.5,
        isFold: false,
        lengthCm: 10
      };

      // 1 & 2. Valid Bézier (2 finite controlPoints) & valid Line (controlPoints undefined)
      const validArtifact = createAuthoritativeGradingArtifact({
        ...baseProps,
        perSizePatternGeometry: {
          ...f.gradingArtifact.perSizePatternGeometry,
          S: [buildPieceWithSegment(sPieces[0], validBezierSeg), ...sPieces.slice(1)],
          L: [
            buildPieceWithSegment(f.gradingArtifact.perSizePatternGeometry['L'][0], validLineSeg),
            ...f.gradingArtifact.perSizePatternGeometry['L'].slice(1)
          ]
        },
        geometryValidationResult: f.gradingArtifact.geometryValidationResult
      });
      assert.equal(verifyGradingArtifactIntegrity(validArtifact).isValid, true);

      // Malformed segments to reject in creation AND verification (even when rehashed!)
      const invalidSegments: Array<{ label: string; seg: any; canComputeHash: boolean }> = [
        {
          label: 'bezier missing controlPoints',
          seg: { ...validBezierSeg, controlPoints: undefined },
          canComputeHash: true
        },
        {
          label: 'bezier with 1 control point',
          seg: { ...validBezierSeg, controlPoints: [{ x: 3, y: 2 }] },
          canComputeHash: true
        },
        {
          label: 'bezier with 3 control points',
          seg: { ...validBezierSeg, controlPoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] },
          canComputeHash: true
        },
        {
          label: 'bezier with cp1.x = NaN',
          seg: { ...validBezierSeg, controlPoints: [{ x: Number.NaN, y: 2 }, { x: 7, y: 10 }] },
          canComputeHash: false
        },
        {
          label: 'bezier with cp2.y = Infinity',
          seg: { ...validBezierSeg, controlPoints: [{ x: 3, y: 2 }, { x: 7, y: Number.POSITIVE_INFINITY }] },
          canComputeHash: false
        },
        {
          label: 'line segment with malformed 1-point controlPoints',
          seg: { ...validLineSeg, controlPoints: [{ x: 1, y: 1 }] },
          canComputeHash: true
        }
      ];

      for (const tc of invalidSegments) {
        const badPerSize = {
          ...f.gradingArtifact.perSizePatternGeometry,
          S: [buildPieceWithSegment(sPieces[0], tc.seg), ...sPieces.slice(1)]
        };

        // Creation rejects
        assert.throws(
          () =>
            createAuthoritativeGradingArtifact({
              ...baseProps,
              perSizePatternGeometry: badPerSize,
              geometryValidationResult: f.gradingArtifact.geometryValidationResult
            }),
          ProductionSnapshotValidationError,
          `Expected creation failure for: ${tc.label}`
        );

        // Verification rejects even if caller tampers an existing artifact (and even if fingerprints are recomputed)
        const baseWithoutContentFp: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
          ...f.gradingArtifact,
          perSizePatternGeometry: badPerSize
        };
        const craftedContentFp = tc.canComputeHash
          ? computeGradingArtifactContentFingerprint(baseWithoutContentFp)
          : f.gradingArtifact.contentFingerprint;
        const baseMutated: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
          ...baseWithoutContentFp,
          contentFingerprint: craftedContentFp
        };
        const crafted: AuthoritativeGradingArtifact = {
          ...baseMutated,
          canonicalFingerprint: tc.canComputeHash
            ? computeCanonicalGradingArtifactFingerprint(baseMutated)
            : f.gradingArtifact.canonicalFingerprint
        };
        const verifyRes = verifyGradingArtifactIntegrity(crafted);
        assert.equal(verifyRes.isValid, false, `Expected verification failure for: ${tc.label}`);
        if (tc.canComputeHash) {
          assert.equal(verifyRes.isValidationFailed, true, `Expected validation failure flag for: ${tc.label}`);
        } else {
          assert.equal(verifyRes.isTampered, true);
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Remediation C — PKG-EDGE: Authoritative Manifest Lineage Binding
  // --------------------------------------------------------------------------
  describe('C. PKG-EDGE: sourcePatternRevisionNumber, validationDigest & approvalDigest Binding', () => {
    it('rejects rehashed forged sourcePatternRevisionNumber, validationDigest, approvalDigest, and mismatched context', () => {
      const f = buildM0513Fixture();

      const gradedPkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-m0513-graded',
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        exportGradingPolicy: { mode: 'graded-multi-size' },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        createdAt: f.ts.approvedIso
      });
      assert.equal(gradedPkgRes.isPackageCreated, true, gradedPkgRes.rejectionReason);
      const gradedPkg = gradedPkgRes.package!;

      const singlePkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-m0513-single',
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'Client bespoke fitting muslin'
        },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        createdAt: f.ts.approvedIso
      });
      assert.equal(singlePkgRes.isPackageCreated, true, singlePkgRes.rejectionReason);
      const singlePkg = singlePkgRes.package!;

      const fullContext = {
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier }
      };

      // Valid package passes live authorization
      const okRes = verifyProductionPackageIntegrity(gradedPkg, fullContext);
      assert.equal(okRes.isStructurallyValid, true);
      assert.equal(okRes.isHistoricallyVerifiable, true);
      assert.equal(okRes.isUpstreamMismatch, false);
      assert.equal(okRes.isCurrentlyAuthorized, true);
      assert.equal(gradedPkg.isProductionReady, false);

      // 1. Forged sourcePatternRevisionNumber (with full package re-hashing)
      const forgedRevNumPkg = rehashPackageManifest(gradedPkg, {
        sourcePatternRevisionNumber: 42
      });
      const revNumCheck = verifyProductionPackageIntegrity(forgedRevNumPkg, fullContext);
      assert.equal(revNumCheck.isStructurallyValid, true);
      assert.equal(revNumCheck.isUpstreamMismatch, true);
      assert.equal(revNumCheck.isHistoricallyVerifiable, false);
      assert.equal(revNumCheck.isCurrentlyAuthorized, false);
      assert.ok(revNumCheck.authorizationErrors.some(e => e.includes('sourcePatternRevisionNumber')));

      // 2. Forged validationDigest on graded AND single-size packages (with full package re-hashing)
      const forgedGradedValPkg = rehashPackageManifest(gradedPkg, {
        validationDigest: 'e'.repeat(64)
      });
      const gradedValCheck = verifyProductionPackageIntegrity(forgedGradedValPkg, fullContext);
      assert.equal(gradedValCheck.isStructurallyValid, true);
      assert.equal(gradedValCheck.isUpstreamMismatch, true);
      assert.equal(gradedValCheck.isHistoricallyVerifiable, false);
      assert.equal(gradedValCheck.isCurrentlyAuthorized, false);
      assert.ok(gradedValCheck.authorizationErrors.some(e => e.includes('validationDigest')));

      const forgedSingleValPkg = rehashPackageManifest(singlePkg, {
        validationDigest: 'f'.repeat(64)
      });
      const singleValCheck = verifyProductionPackageIntegrity(forgedSingleValPkg, {
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier }
      });
      assert.equal(singleValCheck.isStructurallyValid, true);
      assert.equal(singleValCheck.isUpstreamMismatch, true);
      assert.equal(singleValCheck.isCurrentlyAuthorized, false);
      assert.ok(singleValCheck.authorizationErrors.some(e => e.includes('validationDigest')));

      // 3. Forged approvalDigest (with full package re-hashing)
      const forgedAppDigestPkg = rehashPackageManifest(gradedPkg, {
        approvalDigest: 'a'.repeat(64)
      });
      const appDigestCheck = verifyProductionPackageIntegrity(forgedAppDigestPkg, fullContext);
      assert.equal(appDigestCheck.isStructurallyValid, true);
      assert.equal(appDigestCheck.isUpstreamMismatch, true);
      assert.equal(appDigestCheck.isHistoricallyVerifiable, false);
      assert.equal(appDigestCheck.isCurrentlyAuthorized, false);
      assert.ok(appDigestCheck.authorizationErrors.some(e => e.includes('approvalDigest')));

      // 4. Valid approvalDigest + missing live verification context NEVER grants live authorization
      const partialRes = verifyProductionPackageIntegrity(gradedPkg, {
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact
      });
      assert.equal(partialRes.isHistoricallyVerifiable, true);
      assert.equal(partialRes.isCurrentlyAuthorized, false);
    });
  });

  // --------------------------------------------------------------------------
  // Remediation D — DATE-EDGE-01 & DATE-EDGE-02
  // --------------------------------------------------------------------------
  describe('D. DATE-EDGE-01/02: Strict Gregorian Calendar ISO-8601 Date Validation', () => {
    it('accepts valid UTC, offset, and leap-year Feb 29 dates while rejecting all rollover/invalid dates across every module', () => {
      const validDates = [
        '2026-11-12T10:00:00.000Z',
        '2026-11-12T10:00:00+02:00',
        '2024-02-29T12:30:45Z'
      ];
      for (const vd of validDates) {
        assert.equal(isStrictValidIsoTimestamp(vd), true, `Expected valid ISO timestamp: ${vd}`);
      }

      const invalidDates = [
        '2026-02-30T00:00:00.000Z',
        '2025-02-29T10:00:00.000Z',
        '2026-04-31T10:00:00.000Z',
        '2026-13-01T10:00:00.000Z',
        '2026-01-00T10:00:00.000Z',
        '2026-05-10T25:00:00.000Z',
        '2026-05-10T10:60:00.000Z',
        '2026-05-10T10:00:00+25:00'
      ];
      for (const invDate of invalidDates) {
        assert.equal(isStrictValidIsoTimestamp(invDate), false, `Expected rejected invalid date: ${invDate}`);
      }

      const f = buildM0513Fixture();

      // 1. Key / JWK / Credential issuance in garment-specification.ts
      const kp = deriveEd25519SigningKeyPair('key-date-test', 'seed-date-test');
      assert.throws(
        () =>
          createControlledPublicKeyRegistration({
            keyId: kp.keyId,
            publicKeyHex: kp.publicKeyHex,
            activatedAt: '2026-02-30T00:00:00.000Z',
            expiresAt: '2030-01-01T00:00:00.000Z'
          }),
        ProductionSnapshotValidationError
      );
      assert.throws(
        () =>
          createOidcPublicJwk('kid-date', 'seed-date', {
            issuer: ISSUER_URL,
            tenantId: PROJECT_ID,
            expiresAt: '2025-02-29T00:00:00.000Z'
          }),
        ProductionSnapshotValidationError
      );
      assert.throws(
        () =>
          issueVerifiableIdentityCredential(
            {
              issuer: ISSUER_URL,
              audience: AUDIENCE,
              subjectId: 'user-date-1',
              displayName: 'User Date',
              tenantId: PROJECT_ID,
              keyId: 'kid-date',
              issuedAt: '2026-04-31T00:00:00.000Z',
              expiresAt: '2026-05-01T00:00:00.000Z'
            },
            f.oidcSeed
          ),
        ProductionSnapshotValidationError
      );

      // 2. Pattern revision schema validator (`pattern-revision-validator.ts`)
      const badDateSnap = {
        ...f.draftRev,
        createdAt: '2026-02-30T10:00:00.000Z'
      };
      const schemaRes = validateProductionPatternRevision(badDateSnap);
      assert.equal(schemaRes.isValid, false);
      assert.ok(schemaRes.errors.some(e => e.includes('createdAt')));

      // 3. Grading artifact creation (`pattern-revision-snapshot.ts`)
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            projectId: PROJECT_ID,
            tenantId: PROJECT_ID,
            sourceSpecificationId: GARMENT_ID,
            sourceSpecificationRevisionId: f.approvedSpec.specificationRevisionId,
            sourceSpecificationFingerprint: f.approvedSpec.approvedContentFingerprint!,
            sourcePatternRevisionId: f.approvedRev.revisionId,
            sourceBasePatternFingerprint: f.approvedRev.basePatternFingerprint,
            sourceMeasurementSetId: f.approvedMeas.measurementSetId,
            sourceMeasurementSetFingerprint: f.approvedMeas.canonicalFingerprint,
            baseSize: 'M',
            sizeRange: [...DEFAULT_SIZE_RANGE],
            gradedPatternSet: f.gradedSet as any,
            basePatternPieces: f.pieces,
            createdAt: '2025-02-29T12:00:00.000Z'
          }),
        ProductionSnapshotValidationError
      );

      // 4. Pattern revision approval / lifecycle event timestamp (`pattern-revision-snapshot.ts`)
      assert.throws(
        () =>
          validatePatternRevision(f.draftRev, {
            validatedAt: '2026-13-01T00:00:00.000Z'
          }),
        ProductionSnapshotValidationError
      );

      // 5. Production package creation (`dependency-invalidation.ts`)
      const badPkgDateRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-bad-date',
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        exportGradingPolicy: { mode: 'graded-multi-size' },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        createdAt: '2026-02-30T10:00:00.000Z'
      });
      assert.equal(badPkgDateRes.isPackageCreated, false);

      // Valid leap-year timestamp succeeds cleanly!
      const leapPkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-leap-date',
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        exportGradingPolicy: { mode: 'graded-multi-size' },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        createdAt: '2024-02-29T12:00:00+02:00'
      });
      assert.equal(leapPkgRes.isPackageCreated, true, leapPkgRes.rejectionReason);
    });
  });

  // --------------------------------------------------------------------------
  // Remediation E — GRAD-EDGE-01: gradedPatternSet.sizeResults Strict Coverage
  // --------------------------------------------------------------------------
  describe('E. GRAD-EDGE-01: Rejects Undeclared, Duplicate, Empty & Invalid Sizes in gradedPatternSet', () => {
    it('rejects extra/undeclared size keys in gradedPatternSet.sizeResults and invalid/empty/duplicate sizes', () => {
      const f = buildM0513Fixture();
      const baseProps = {
        projectId: PROJECT_ID,
        tenantId: PROJECT_ID,
        sourceSpecificationId: GARMENT_ID,
        sourceSpecificationRevisionId: f.approvedSpec.specificationRevisionId,
        sourceSpecificationFingerprint: f.approvedSpec.approvedContentFingerprint!,
        sourcePatternRevisionId: f.approvedRev.revisionId,
        sourceBasePatternFingerprint: f.approvedRev.basePatternFingerprint,
        sourceMeasurementSetId: f.approvedMeas.measurementSetId,
        sourceMeasurementSetFingerprint: f.approvedMeas.canonicalFingerprint,
        baseSize: 'M',
        basePatternPieces: f.pieces,
        createdAt: f.ts.approvedIso
      };

      // 1. Extra undeclared size in gradedPatternSet.sizeResults (previously silently ignored!)
      const extraKeySet = {
        ...f.gradedSet,
        sizeResults: {
          ...f.gradedSet.sizeResults,
          XXXL: f.gradedSet.sizeResults['XL']
        }
      };
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: [...DEFAULT_SIZE_RANGE],
            gradedPatternSet: extraKeySet as any
          }),
        ProductionSnapshotValidationError
      );

      // 2. Unpruned sizeResults when sizeRange is narrower (must NOT silently ignore XS/XL/XXL)
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: ['S', 'M', 'L'],
            gradedPatternSet: f.gradedSet as any
          }),
        ProductionSnapshotValidationError
      );

      // 3. Empty/whitespace size in sizeRange
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: ['S', '', 'M'],
            gradedPatternSet: f.gradedSet as any
          }),
        ProductionSnapshotValidationError
      );
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: ['S', '   ', 'M'],
            gradedPatternSet: f.gradedSet as any
          }),
        ProductionSnapshotValidationError
      );

      // 4. Empty string baseSize
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            baseSize: '   ',
            sizeRange: [...DEFAULT_SIZE_RANGE],
            gradedPatternSet: f.gradedSet as any
          }),
        ProductionSnapshotValidationError
      );

      // 5. Mismatched gradedPatternSet.baseSize
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: [...DEFAULT_SIZE_RANGE],
            gradedPatternSet: {
              ...f.gradedSet,
              baseSize: 'L'
            } as any
          }),
        ProductionSnapshotValidationError
      );

      // 6. Verification rejects empty/duplicate sizeRange even if canonicalFingerprint recomputed
      const craftedEmptySizeBase: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
        ...f.gradingArtifact,
        sizeRange: ['XS', '', 'M', 'L', 'XL', 'XXL']
      };
      const craftedEmptySize: AuthoritativeGradingArtifact = {
        ...craftedEmptySizeBase,
        canonicalFingerprint: computeCanonicalGradingArtifactFingerprint(craftedEmptySizeBase)
      };
      const verifyEmptySize = verifyGradingArtifactIntegrity(craftedEmptySize);
      assert.equal(verifyEmptySize.isValid, false);
    });
  });

  // --------------------------------------------------------------------------
  // Remediation F — Lifecycle Verification Limitation-Note Propagation
  // --------------------------------------------------------------------------
  describe('F. Pattern Revision Lifecycle Limitation Notes & Safety Invariants', () => {
    it('propagates consistent limitationNotes on all verifyPatternRevisionLifecycleIntegrity paths', () => {
      const f = buildM0513Fixture();

      // 1. Valid revision
      const validLifecycle = verifyPatternRevisionLifecycleIntegrity(f.approvedRev);
      assert.equal(validLifecycle.isValid, true);
      assert.ok(Array.isArray(validLifecycle.limitationNotes));
      assert.ok(validLifecycle.limitationNotes.length > 0);
      assert.deepEqual(validLifecycle.limitationNotes, PATTERN_REVISION_LIFECYCLE_LIMITATION_NOTES);
      assert.ok(validLifecycle.limitationNotes[0].includes('Local hash-chain verification'));
      assert.ok(validLifecycle.limitationNotes[0].includes('history rewriting or truncation'));

      // 2. Missing revision
      const missingLifecycle = verifyPatternRevisionLifecycleIntegrity(undefined);
      assert.equal(missingLifecycle.isValid, false);
      assert.deepEqual(missingLifecycle.limitationNotes, PATTERN_REVISION_LIFECYCLE_LIMITATION_NOTES);

      // 3. Missing lifecycleHistory
      const emptyHistoryLifecycle = verifyPatternRevisionLifecycleIntegrity({
        ...f.approvedRev,
        lifecycleHistory: undefined
      });
      assert.equal(emptyHistoryLifecycle.isValid, false);
      assert.deepEqual(emptyHistoryLifecycle.limitationNotes, PATTERN_REVISION_LIFECYCLE_LIMITATION_NOTES);

      // 4. Industrial safety violation
      const unsafeLifecycle = verifyPatternRevisionLifecycleIntegrity({
        ...f.approvedRev,
        isProductionReady: true as unknown as false
      });
      assert.equal(unsafeLifecycle.isValid, false);
      assert.deepEqual(unsafeLifecycle.limitationNotes, PATTERN_REVISION_LIFECYCLE_LIMITATION_NOTES);
      assert.equal(f.approvedRev.isProductionReady, false);

      // 5. Matches package verifier limitation notes scope/accuracy
      const pkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-notes-parity',
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        exportGradingPolicy: { mode: 'graded-multi-size' },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier }
      });
      assert.equal(pkgRes.isPackageCreated, true);
      const pkgVerify = verifyProductionPackageIntegrity(pkgRes.package!);
      assert.ok(pkgVerify.limitationNotes.length > 0);
      assert.ok(pkgVerify.limitationNotes[0].includes('Local hash-chain verification'));
    });
  });
});
