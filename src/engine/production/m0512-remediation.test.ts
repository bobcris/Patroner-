/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner — Milestone 05.1.2 Authoritative Package Inventory Binding,
 * Live Credential Expiry & Grading Completeness Adversarial Test Suite
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
  createControlledPublicKeyRegistry,
  createInMemoryJtiReplayStore,
  createOidcPublicJwk,
  createTrustedCryptographicVerifier,
  createTrustedIdentityVerifier,
  deriveEd25519SigningKeyPair,
  issueVerifiableIdentityCredential,
  registerPublicKeyInRegistry,
  signSpecificationApprovalPayload,
  verifySpecificationApproval
} from './garment-specification';
import {
  approveAuthoritativeMeasurementSet,
  approvePatternRevision,
  buildCanonicalProductionPackageInventory,
  canonicalizeJson,
  computeCanonicalGradingArtifactFingerprint,
  computePatternCurrentStateFingerprint,
  computePatternLifecycleEventFingerprint,
  computeProductionPackageCurrentStateFingerprint,
  computeProductionPackageLifecycleEventFingerprint,
  computeProductionPackageManifestFingerprint,
  createAuthoritativeGradingArtifact,
  createAuthoritativeMeasurementSet,
  createAuthoritativeProductionPackage,
  createDraftPatternRevision,
  evaluatePipelineDependencyIntegrity,
  invalidatePatternRevision,
  invalidateProductionPackage,
  signPatternRevisionApprovalPayload,
  toCanonicalProductionPackagePieceEntry,
  validatePatternRevision,
  validateProductionExportPrerequisites,
  verifyGradingArtifactIntegrity,
  verifyPatternRevisionApprovalLive,
  verifyPatternRevisionLifecycleIntegrity,
  verifyProductionPackageIntegrity
} from './index';
import {
  AuthoritativeGradingArtifact,
  AuthoritativePatternRevision,
  AuthoritativeProductionPackage,
  PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION,
  PatternInvalidationRecord,
  PatternPieceSnapshot,
  PatternRevisionLifecycleEvent,
  ProductionPackageLifecycleEvent,
  ProductionSnapshotValidationError
} from './production-types';
import { SPECIFICATION_CANONICAL_SCHEMA_VERSION } from './garment-specification-types';
import { DesignSpecification } from '../../types';

const PROJECT_ID = 'project-patroner-m0512';
const GARMENT_ID = 'garment-skirt-m0512-01';
const ISSUER_URL = 'https://idp.patroner.atelier';
const AUDIENCE = 'patroner-production-engine';
const SIZE_M = STANDARD_SIZING_SYSTEM.sizes.M;

function buildLiveTimestamps(offsetMs = 0) {
  const nowMs = Date.now() + offsetMs;
  const createdMs = nowMs - 120_000; // 2 min ago
  const validatedMs = nowMs - 60_000; // 1 min ago
  const approvedMs = nowMs - 30_000; // 30 sec ago
  const expiresMs = nowMs + 3_600_000; // +1 hour
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

function buildLiveFixture(opts?: { referenceTimeIso?: string; keyExpiresAt?: string }) {
  const ts = buildLiveTimestamps();
  const oidcKid = 'oidc-kid-m0512-live';
  const oidcSeed = 'm0512-oidc-issuer-ed25519-seed-material-01';
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
    replayStore,
    ...(opts?.referenceTimeIso ? { referenceTimeIso: opts.referenceTimeIso } : {})
  });

  const specKey = deriveEd25519SigningKeyPair('key-m0512-spec-01', 'seed-m0512-spec-01', {
    ownerPrincipal: 'Elena Vance (Specification Authority)',
    tenantId: PROJECT_ID,
    allowedScopes: ['specification:approve'],
    activatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: opts?.keyExpiresAt ?? '2030-01-01T00:00:00.000Z'
  });
  const patternKey = deriveEd25519SigningKeyPair('key-m0512-pat-01', 'seed-m0512-pat-01', {
    ownerPrincipal: 'Elena Vance (Pattern Authority)',
    tenantId: PROJECT_ID,
    allowedScopes: ['pattern:approve'],
    activatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: opts?.keyExpiresAt ?? '2030-01-01T00:00:00.000Z'
  });

  let registry = createControlledPublicKeyRegistry();
  registry = registerPublicKeyInRegistry(registry, specKey.publicKeyRegistration);
  registry = registerPublicKeyInRegistry(registry, patternKey.publicKeyRegistration);

  const cryptographicVerifier = createTrustedCryptographicVerifier({
    publicKeyRegistry: Object.values(registry.entries),
    ...(opts?.referenceTimeIso ? { referenceTimeIso: opts.referenceTimeIso } : {})
  });

  const enhancedLookup = getEnhancedFabricById(ENHANCED_PRESET_FABRICS[0].id);
  const fabric = enhancedLookup.status === 'found' ? enhancedLookup.fabric : ENHANCED_PRESET_FABRICS[0];

  const draftSpec = createAuthoritativeGarmentSpecification({
    projectId: PROJECT_ID,
    garmentId: GARMENT_ID,
    specificationRevisionId: `spec-${GARMENT_ID}-v1`,
    version: 1,
    name: 'M0512 Tailored Pencil Skirt',
    garmentCategory: 'skirt',
    silhouette: 'pencil',
    fabric,
    color: { name: 'Slate', hex: '#334155' },
    easeProfile: 'classic',
    lengthCm: 64,
    prompt: 'Tailored pencil skirt for Milestone 05.1.2 verification',
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
      approvalEventId: 'spec-app-evt-m0512-1',
      approverPrincipal: 'Elena Vance (Specification Authority)',
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
    'Elena Vance (Specification Authority)',
    {
      approvedAt: ts.approvedIso,
      approvalEventId: 'spec-app-evt-m0512-1',
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
      operatorName: 'Marco Rossi (Master Tailor)',
      measurementSource: 'physical-tape-measure',
      recordedAt: ts.createdIso
    },
    recordedAt: ts.createdIso
  });
  const approvedMeas = approveAuthoritativeMeasurementSet(unapprovedMeas, {
    approvingAuthority: 'Marco Rossi (Master Tailor)',
    approvedAt: ts.createdIso,
    notes: ['Physical dress form verified.']
  });

  const designSpec = convertToDesignSpecification(approvedSpec);
  const pieces = draftSkirtBlock(SIZE_M, designSpec);
  const validationReport = validatePatternDraft(pieces);
  const gradedSet = toGradedSkirtSet(designSpec);

  const draftRev = createDraftPatternRevision({
    revisionId: 'pat-rev-m0512-1',
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
    actorId: 'qa-validator-01',
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
      approvalEventId: 'pat-app-evt-m0512-1',
      approverPrincipal: 'Elena Vance (Pattern Authority)',
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
    approverName: 'Elena Vance (Pattern Authority)',
    approvedAt: ts.approvedIso,
    approvalEventId: 'pat-app-evt-m0512-1',
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

function buildValidPackage(f: ReturnType<typeof buildLiveFixture>) {
  const pkgRes = createAuthoritativeProductionPackage({
    packageId: 'pkg-m0512-01',
    patternRevision: f.approvedRev,
    specification: f.approvedSpec,
    measurementSet: f.approvedMeas,
    gradingArtifact: f.gradingArtifact,
    exportGradingPolicy: { mode: 'graded-multi-size' },
    specificationVerificationContext: {
      cryptographicVerifier: f.cryptographicVerifier
    },
    patternApprovalVerificationContext: {
      cryptographicVerifier: f.cryptographicVerifier
    },
    createdAt: f.ts.nowIso
  });
  assert.equal(pkgRes.isPackageCreated, true, pkgRes.rejectionReason);
  assert.ok(pkgRes.package);
  return pkgRes.package;
}

describe('Milestone 05.1.2 — Production Package Binding, Live Credential Expiry & Grading Completeness', () => {
  // --------------------------------------------------------------------------
  // A. AUDIT-05.1-03 — Authoritative Production Package Inventory Binding
  // --------------------------------------------------------------------------
  describe('A. AUDIT-05.1-03: Authoritative Production Package Inventory Binding', () => {
    it('constructs complete canonical multi-size and single-size piece inventories and detects forged pieceInventory mutations', () => {
      const f = buildLiveFixture();
      const pkg = buildValidPackage(f);
      const rev = f.approvedRev;
      const ga = f.gradingArtifact;

      assert.equal(pkg.manifest.includedSizes.length, DEFAULT_SIZE_RANGE.length);
      assert.equal(
        pkg.manifest.pieceInventory.length,
        DEFAULT_SIZE_RANGE.length * rev.patternPieces.length
      );
      assert.equal(pkg.manifest.pieceCount, rev.patternPieces.length);

      const expectedTotalCutInstances = pkg.manifest.pieceInventory.reduce(
        (sum, e) => sum + e.cutCount,
        0
      );
      assert.equal(pkg.manifest.totalPieceInstancesAcrossSizes, expectedTotalCutInstances);

      // Clean live verification succeeds
      const cleanVerify = verifyProductionPackageIntegrity(pkg, {
        patternRevision: rev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: ga,
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier }
      });
      assert.equal(cleanVerify.isStructurallyValid, true);
      assert.equal(cleanVerify.isHistoricallyVerifiable, true);
      assert.equal(cleanVerify.isCurrentlyAuthorized, true);
      assert.equal(cleanVerify.isUpstreamMismatch, false);

      const tamperAndRehashManifest = (
        mutator: (m: AuthoritativeProductionPackage['manifest']) => AuthoritativeProductionPackage['manifest']
      ): AuthoritativeProductionPackage => {
        const nextManifest = mutator(pkg.manifest);
        const manifestFp = computeProductionPackageManifestFingerprint(nextManifest);
        const evt0 = { ...pkg.lifecycleHistory[0], manifestFingerprint: manifestFp };
        const evt0Fp = computeProductionPackageLifecycleEventFingerprint(evt0);
        const signedEvt0: ProductionPackageLifecycleEvent = {
          ...evt0,
          lifecycleEventFingerprint: evt0Fp
        };
        const currentStateFp = computeProductionPackageCurrentStateFingerprint({
          packageId: pkg.packageId,
          manifestFingerprint: manifestFp,
          currentPackageState: pkg.currentPackageState,
          eventCount: 1,
          latestLifecycleEventFingerprint: evt0Fp
        });
        return {
          ...pkg,
          manifest: nextManifest,
          manifestFingerprint: manifestFp,
          lifecycleHistory: [signedEvt0],
          currentStateFingerprint: currentStateFp
        };
      };

      const sourceCtx = {
        patternRevision: rev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: ga,
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier }
      };

      // 1. Missing piece from inventory (rehashed manifest & lifecycle)
      const pkgMissingPiece = tamperAndRehashManifest(m => ({
        ...m,
        pieceInventory: m.pieceInventory.slice(1),
        pieceCount: m.pieceInventory.length - 1
      }));
      const resMissing = verifyProductionPackageIntegrity(pkgMissingPiece, sourceCtx);
      assert.equal(resMissing.isUpstreamMismatch, true);
      assert.equal(resMissing.isHistoricallyVerifiable, false);
      assert.equal(resMissing.isCurrentlyAuthorized, false);

      // 2. Altered cutCount
      const pkgAlteredCut = tamperAndRehashManifest(m => {
        const cloned = m.pieceInventory.map((p, idx) =>
          idx === 0 ? { ...p, cutCount: p.cutCount + 4 } : p
        );
        return {
          ...m,
          pieceInventory: cloned,
          totalPieceInstancesAcrossSizes: cloned.reduce((s, p) => s + p.cutCount, 0)
        };
      });
      const resCut = verifyProductionPackageIntegrity(pkgAlteredCut, sourceCtx);
      assert.equal(resCut.isUpstreamMismatch, true);
      assert.equal(resCut.isHistoricallyVerifiable, false);
      assert.equal(resCut.isCurrentlyAuthorized, false);

      // 3. Forged pieceGeometryFingerprint / widthCm
      const pkgAlteredGeom = tamperAndRehashManifest(m => ({
        ...m,
        pieceInventory: m.pieceInventory.map((p, idx) =>
          idx === 0
            ? { ...p, pieceGeometryFingerprint: 'deadbeef'.repeat(8), widthCm: p.widthCm + 10 }
            : p
        )
      }));
      const resGeom = verifyProductionPackageIntegrity(pkgAlteredGeom, sourceCtx);
      assert.equal(resGeom.isUpstreamMismatch, true);
      assert.equal(resGeom.isHistoricallyVerifiable, false);
      assert.equal(resGeom.isCurrentlyAuthorized, false);

      // 4. Extra/duplicate size in includedSizes
      const pkgExtraSize = tamperAndRehashManifest(m => ({
        ...m,
        includedSizes: [...m.includedSizes, 'XXXL']
      }));
      const resSize = verifyProductionPackageIntegrity(pkgExtraSize, sourceCtx);
      assert.equal(resSize.isUpstreamMismatch, true);
      assert.equal(resSize.isHistoricallyVerifiable, false);
      assert.equal(resSize.isCurrentlyAuthorized, false);

      // 5. Partial sourceContext (patternRevision without gradingArtifact) STILL checks base-size ('M') vs patternRevision
      const baseMIdx = pkg.manifest.pieceInventory.findIndex(p => p.sizeCode === pkg.manifest.baseSize);
      assert.ok(baseMIdx >= 0);
      const pkgAlteredBaseGeom = tamperAndRehashManifest(m => ({
        ...m,
        pieceInventory: m.pieceInventory.map((p, idx) =>
          idx === baseMIdx
            ? { ...p, pieceGeometryFingerprint: 'deadbeef'.repeat(8), widthCm: p.widthCm + 10 }
            : p
        )
      }));
      const resPartial = verifyProductionPackageIntegrity(pkgAlteredBaseGeom, {
        patternRevision: rev
      });
      assert.equal(resPartial.isUpstreamMismatch, true);
      assert.equal(resPartial.isHistoricallyVerifiable, false);
      assert.equal(resPartial.isCurrentlyAuthorized, false);
      assert.equal(resPartial.sourceVerificationStatus, 'partial-unverified-upstream');
    });

    it('rejects missing/invalid base piece manufacturing attributes instead of silently coercing defaults', () => {
      const f = buildLiveFixture();
      const basePiece = f.approvedRev.patternPieces[0];
      const badCutPiece: PatternPieceSnapshot = { ...basePiece, cutCount: 0 };
      assert.throws(
        () => toCanonicalProductionPackagePieceEntry(badCutPiece, 'M'),
        ProductionSnapshotValidationError
      );
      const badMatPiece: PatternPieceSnapshot = {
        ...basePiece,
        material: '   ' as unknown as PatternPieceSnapshot['material']
      };
      assert.throws(
        () => toCanonicalProductionPackagePieceEntry(badMatPiece, 'M'),
        ProductionSnapshotValidationError
      );

      // Duplicate pieceCode in base pieces rejects canonical inventory construction
      const dupRev: AuthoritativePatternRevision = {
        ...f.approvedRev,
        patternPieces: [f.approvedRev.patternPieces[0], f.approvedRev.patternPieces[0]]
      };
      assert.throws(
        () =>
          buildCanonicalProductionPackageInventory({
            patternRevision: dupRev,
            gradingMode: 'single-size-ungraded'
          }),
        ProductionSnapshotValidationError
      );
    });
  });

  // --------------------------------------------------------------------------
  // B. AUDIT-05.1-05 / Safeguard 1 — Live Credential Expiry Evaluation
  // --------------------------------------------------------------------------
  describe('B. AUDIT-05.1-05 / Safeguard 1: Live vs Historical Credential Expiry Enforcement', () => {
    it('evaluates OIDC JWT and registry key expiry against real Date.now() in live mode (ignoring historical approvalTimestamp)', () => {
      const f = buildLiveFixture();
      const nowMs = Date.now();
      const issuedPast = new Date(nowMs - 7_200_000).toISOString(); // 2h ago
      const expiredPast = new Date(nowMs - 600_000).toISOString(); // 10m ago
      const validFuture = new Date(nowMs + 3_600_000).toISOString(); // +1h

      // Live verifier WITHOUT referenceTimeIso must evaluate against Date.now()
      assert.equal(f.identityVerifier.verificationMode, 'live');
      assert.equal(f.cryptographicVerifier.verificationMode, 'live');

      // 1. Expired JWT even though approvalTimestamp is inside the JWT window -> REJECTED in live mode!
      const expiredJwt = issueVerifiableIdentityCredential(
        {
          subjectId: 'auth0|elena-vance-m0512',
          displayName: 'Elena Vance',
          issuer: ISSUER_URL,
          audience: AUDIENCE,
          tenantId: PROJECT_ID,
          keyId: f.oidcKid,
          issuedAt: issuedPast,
          expiresAt: expiredPast,
          use: 'specification_approval',
          claims: ['specification:approve'],
          specificationId: GARMENT_ID,
          targetRevisionId: f.approvedSpec.specificationRevisionId,
          targetSpecificationFingerprint: f.approvedSpec.approvedContentFingerprint
        },
        f.oidcSeed
      );
      const idResExpired = f.identityVerifier.verifyCredential(expiredJwt, {
        expectedScope: 'specification:approve',
        expectedSpecificationId: GARMENT_ID,
        expectedRevisionId: f.approvedSpec.specificationRevisionId,
        expectedSpecificationFingerprint: f.approvedSpec.approvedContentFingerprint,
        expectedTenantId: PROJECT_ID,
        approvalTimestamp: new Date(nowMs - 3_600_000).toISOString(), // 1h ago (inside JWT [issuedPast, expiredPast]!)
        requireTargetBinding: true
      });
      assert.equal(idResExpired.isValid, false);
      assert.match(idResExpired.reason ?? '', /expired/i);

      // 2. Non-expired JWT succeeds without referenceTimeIso
      const freshJwt = issueVerifiableIdentityCredential(
        {
          subjectId: 'auth0|elena-vance-m0512',
          displayName: 'Elena Vance',
          issuer: ISSUER_URL,
          audience: AUDIENCE,
          tenantId: PROJECT_ID,
          keyId: f.oidcKid,
          issuedAt: issuedPast,
          expiresAt: validFuture,
          use: 'specification_approval',
          claims: ['specification:approve'],
          specificationId: GARMENT_ID,
          targetRevisionId: f.approvedSpec.specificationRevisionId,
          targetSpecificationFingerprint: f.approvedSpec.approvedContentFingerprint
        },
        f.oidcSeed
      );
      const idResFresh = f.identityVerifier.verifyCredential(freshJwt, {
        expectedScope: 'specification:approve',
        expectedSpecificationId: GARMENT_ID,
        expectedRevisionId: f.approvedSpec.specificationRevisionId,
        expectedSpecificationFingerprint: f.approvedSpec.approvedContentFingerprint,
        expectedTenantId: PROJECT_ID,
        requireTargetBinding: true
      });
      assert.equal(idResFresh.isValid, true);

      // 3. Expired Ed25519 key in live verifier -> REJECTED even though signature signedAt was before expiresAt
      const expiredKey = deriveEd25519SigningKeyPair('key-expired-live-01', 'seed-expired-live-01', {
        ownerPrincipal: 'Elena Vance (Expired Key)',
        tenantId: PROJECT_ID,
        allowedScopes: ['specification:approve', 'pattern:approve'],
        activatedAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2021-01-01T00:00:00.000Z'
      });
      let expReg = createControlledPublicKeyRegistry();
      expReg = registerPublicKeyInRegistry(expReg, expiredKey.publicKeyRegistration);
      const liveExpVerifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: Object.values(expReg.entries)
      });

      const oldApprovalTs = '2020-06-01T10:00:00.000Z';
      const oldDraft = createAuthoritativeGarmentSpecification({
        projectId: PROJECT_ID,
        garmentId: GARMENT_ID,
        specificationRevisionId: `spec-${GARMENT_ID}-exp`,
        version: 1,
        name: 'Expired Key Spec',
        garmentCategory: 'skirt',
        silhouette: 'pencil',
        fabric: f.fabric,
        color: { name: 'Black', hex: '#000000' },
        easeProfile: 'classic',
        lengthCm: 64,
        prompt: 'Expired key spec',
        constructionFeatures: [],
        designNotes: [],
        createdAt: oldApprovalTs,
        updatedAt: oldApprovalTs,
        fabricProvenance: 'supplier-declared'
      });
      const oldSig = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: PROJECT_ID,
          garmentId: GARMENT_ID,
          specificationRevisionId: oldDraft.specificationRevisionId,
          specificationVersion: oldDraft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(oldDraft),
          approvalEventId: 'evt-old-key-1',
          approverPrincipal: 'Elena Vance (Expired Key)',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: oldApprovalTs
        },
        {
          keyId: expiredKey.keyId,
          privateKeyHex: expiredKey.privateKeyHex,
          tenantId: PROJECT_ID
        }
      );

      assert.throws(
        () =>
          approveAuthoritativeGarmentSpecification(oldDraft, 'Elena Vance (Expired Key)', {
            approvedAt: oldApprovalTs,
            approvalEventId: 'evt-old-key-1',
            authorityTier: 'cryptographic_principal',
            cryptographicVerifier: liveExpVerifier,
            cryptographicSignature: oldSig
          }),
        /expired/i
      );

      // 4. Historical mode requires explicit valid ISO referenceTimeIso and is REJECTED at all live gates
      assert.throws(
        () =>
          createTrustedIdentityVerifier({
            trustedIssuers: [ISSUER_URL],
            expectedAudience: AUDIENCE,
            publicJwks: [f.publicJwk],
            replayStore: createInMemoryJtiReplayStore(),
            verificationMode: 'historical'
          }),
        /referenceTimeIso/i
      );
      assert.throws(
        () =>
          createTrustedCryptographicVerifier({
            publicKeyRegistry: Object.values(expReg.entries),
            verificationMode: 'historical',
            referenceTimeIso: 'not-a-timestamp'
          }),
        /referenceTimeIso/i
      );

      const histCryptoVerifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: Object.values(expReg.entries),
        verificationMode: 'historical',
        referenceTimeIso: oldApprovalTs
      });
      // Works ONLY for historical payload verification or explicit historical spec inspection
      assert.throws(
        () =>
          approveAuthoritativeGarmentSpecification(oldDraft, 'Elena Vance (Expired Key)', {
            approvedAt: oldApprovalTs,
            approvalEventId: 'evt-old-key-2',
            authorityTier: 'cryptographic_principal',
            cryptographicVerifier: histCryptoVerifier,
            cryptographicSignature: oldSig
          }),
        /historical/i
      );

      // Build an approved spec verified using historical-pinned live verifier then verify historical verifier is rejected at live gates
      const pinnedLiveVerifierForOld = createTrustedCryptographicVerifier({
        publicKeyRegistry: Object.values(expReg.entries),
        verificationMode: 'live',
        referenceTimeIso: oldApprovalTs
      });
      const oldApprovedSpec = approveAuthoritativeGarmentSpecification(
        oldDraft,
        'Elena Vance (Expired Key)',
        {
          approvedAt: oldApprovalTs,
          approvalEventId: 'evt-old-key-1',
          authorityTier: 'cryptographic_principal',
          cryptographicVerifier: pinnedLiveVerifierForOld,
          cryptographicSignature: oldSig
        }
      );

      // Direct verifySpecificationApproval with explicit historical mode succeeds
      const histVerify = verifySpecificationApproval(oldApprovedSpec, {
        verificationMode: 'historical',
        cryptographicVerifier: histCryptoVerifier
      });
      assert.equal(histVerify.isValid, true);

      // Live gates MUST reject BOTH historical verifier AND historical verificationMode context!
      const liveSpecReject = verifySpecificationApproval(oldApprovedSpec, {
        cryptographicVerifier: histCryptoVerifier
      });
      assert.equal(liveSpecReject.isValid, false);

      assert.throws(
        () =>
          approvePatternRevision(f.validatedRev, {
            approverName: 'Elena Vance (Pattern Authority)',
            approvedAt: f.ts.approvedIso,
            approvalEventId: 'pat-hist-reject-1',
            authorityTier: 'cryptographic_principal',
            sourceSpecification: f.approvedSpec,
            sourceMeasurementSet: f.approvedMeas,
            cryptographicVerifier: createTrustedCryptographicVerifier({
              publicKeyRegistry: [f.patternKey.publicKeyRegistration],
              verificationMode: 'historical',
              referenceTimeIso: f.ts.nowIso
            }),
            cryptographicSignature: f.approvedRev.patternApprovalRecord!.cryptographicSignature as any
          }),
        /historical/i
      );

      const histPatVerifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [f.patternKey.publicKeyRegistration],
        verificationMode: 'historical',
        referenceTimeIso: f.ts.nowIso
      });
      const livePatGateRes = verifyPatternRevisionApprovalLive({
        revision: f.approvedRev,
        verificationContext: { cryptographicVerifier: histPatVerifier }
      });
      assert.equal(livePatGateRes.isAuthorized, false);
      assert.match(livePatGateRes.reason ?? '', /historical/i);

      const livePatCtxModeRes = verifyPatternRevisionApprovalLive({
        revision: f.approvedRev,
        verificationContext: {
          verificationMode: 'historical',
          cryptographicVerifier: f.cryptographicVerifier
        }
      });
      assert.equal(livePatCtxModeRes.isAuthorized, false);

      const pkgHistSpecCtx = createAuthoritativeProductionPackage({
        packageId: 'pkg-hist-reject',
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        exportGradingPolicy: { mode: 'single-size-ungraded', nonGradingReason: 'test' },
        specificationVerificationContext: {
          verificationMode: 'historical',
          cryptographicVerifier: histPatVerifier
        },
        patternApprovalVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier
        }
      });
      assert.equal(pkgHistSpecCtx.isPackageCreated, false);

      const validPkg = buildValidPackage(f);
      const pkgVerifyHist = verifyProductionPackageIntegrity(validPkg, {
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        specificationVerificationContext: {
          verificationMode: 'historical',
          cryptographicVerifier: createTrustedCryptographicVerifier({
            publicKeyRegistry: [f.specKey.publicKeyRegistration],
            verificationMode: 'historical',
            referenceTimeIso: f.ts.nowIso
          })
        },
        patternApprovalVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier
        }
      });
      assert.equal(pkgVerifyHist.isCurrentlyAuthorized, false);
    });

    it('rejects malformed ISO-8601 timestamps on JWK registrations and verifier config (fail-closed)', () => {
      const key = deriveEd25519SigningKeyPair('key-bad-iso-01', 'seed-bad-iso-01', {
        ownerPrincipal: 'QA',
        tenantId: PROJECT_ID
      });
      const reg = createControlledPublicKeyRegistry();
      assert.throws(
        () =>
          registerPublicKeyInRegistry(reg, {
            ...key.publicKeyRegistration,
            expiresAt: '2026/13/45 not-iso'
          }),
        ProductionSnapshotValidationError
      );
      assert.throws(
        () =>
          createTrustedCryptographicVerifier({
            publicKeyRegistry: [
              {
                ...key.publicKeyRegistration,
                expiresAt: '2026/13/45 not-iso'
              }
            ]
          }),
        ProductionSnapshotValidationError
      );
      const jwk = createOidcPublicJwk('oidc-bad-iso', 'seed-bad-iso-01', {
        issuer: ISSUER_URL,
        tenantId: PROJECT_ID
      });
      assert.throws(
        () =>
          createTrustedIdentityVerifier({
            trustedIssuers: [ISSUER_URL],
            expectedAudience: AUDIENCE,
            publicJwks: [
              {
                ...jwk,
                expiresAt: '2026/13/45 not-iso'
              }
            ],
            replayStore: createInMemoryJtiReplayStore()
          }),
        ProductionSnapshotValidationError
      );
    });
  });

  // --------------------------------------------------------------------------
  // C. AUDIT-05.1-06 — Grading Completeness & Inventory Validation
  // --------------------------------------------------------------------------
  describe('C. AUDIT-05.1-06: Grading Completeness, Cross-Size Parity & Numeric/Geometry Bounds', () => {
    it('rejects incomplete sizeRange, missing/extra sizes, duplicate pieces, cross-size parity mismatches, and invalid bounds in creation & verification', () => {
      const f = buildLiveFixture();
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

      // 1. Fewer than 2 sizes
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: ['M'],
            gradedPatternSet: toGradedSkirtSet(f.designSpec, ['M']) as any
          }),
        ProductionSnapshotValidationError
      );

      // 2. Duplicate sizes in sizeRange
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: ['S', 'M', 'M'],
            gradedPatternSet: f.gradedSet as any
          }),
        ProductionSnapshotValidationError
      );

      // 3. Missing declared size in perSizePatternGeometry
      const missingLSet = {
        ...f.gradedSet,
        sizeResults: Object.fromEntries(
          Object.entries(f.gradedSet.sizeResults).filter(([sz]) => sz !== 'L')
        )
      };
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: [...DEFAULT_SIZE_RANGE],
            gradedPatternSet: missingLSet as any
          }),
        ProductionSnapshotValidationError
      );

      // 4. Extra undeclared size in explicit perSizePatternGeometry
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: [...DEFAULT_SIZE_RANGE],
            perSizePatternGeometry: {
              ...f.gradingArtifact.perSizePatternGeometry,
              XXXL: f.gradingArtifact.perSizePatternGeometry['XL']
            },
            geometryValidationResult: f.gradingArtifact.geometryValidationResult
          }),
        ProductionSnapshotValidationError
      );

      // 5. Cross-size cutCount mismatch between M and XS
      const alteredCutPerSize: Record<string, readonly PatternPieceSnapshot[]> = {
        ...f.gradingArtifact.perSizePatternGeometry,
        XS: f.gradingArtifact.perSizePatternGeometry['XS'].map((p, idx) =>
          idx === 0 ? { ...p, cutCount: p.cutCount + 2 } : p
        )
      };
      const forgedArtifactBase: AuthoritativeGradingArtifact = {
        ...f.gradingArtifact,
        perSizePatternGeometry: alteredCutPerSize
      };
      // Even if canonicalFingerprint were re-signed by a naive caller, verifyGradingArtifactIntegrity MUST reject parity mismatch
      const parityVerify = verifyGradingArtifactIntegrity(forgedArtifactBase);
      assert.equal(parityVerify.isValid, false);

      // Creation must reject duplicate pieceCode in a non-base size
      const dupPiecePerSize: Record<string, readonly PatternPieceSnapshot[]> = {
        ...f.gradingArtifact.perSizePatternGeometry,
        S: [
          ...f.gradingArtifact.perSizePatternGeometry['S'],
          f.gradingArtifact.perSizePatternGeometry['S'][0]
        ]
      };
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: [...DEFAULT_SIZE_RANGE],
            perSizePatternGeometry: dupPiecePerSize,
            geometryValidationResult: f.gradingArtifact.geometryValidationResult
          }),
        ProductionSnapshotValidationError
      );

      // 6. Invalid numeric bounds (negative seamAllowanceWidthCm, zero bbox, NaN coord, empty cutPathData)
      const invalidBoundsSet: Record<string, readonly PatternPieceSnapshot[]> = {
        ...f.gradingArtifact.perSizePatternGeometry,
        S: f.gradingArtifact.perSizePatternGeometry['S'].map((p, idx) =>
          idx === 0 ? { ...p, seamAllowanceWidthCm: -0.5 } : p
        )
      };
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: [...DEFAULT_SIZE_RANGE],
            perSizePatternGeometry: invalidBoundsSet,
            geometryValidationResult: f.gradingArtifact.geometryValidationResult
          }),
        ProductionSnapshotValidationError
      );

      const nanCoordSet: Record<string, readonly PatternPieceSnapshot[]> = {
        ...f.gradingArtifact.perSizePatternGeometry,
        S: f.gradingArtifact.perSizePatternGeometry['S'].map((p, idx) =>
          idx === 0
            ? {
                ...p,
                stitchingContour: {
                  ...p.stitchingContour!,
                  segments: [
                    {
                      id: 'seg-nan-1',
                      type: 'line',
                      start: { x: Number.NaN, y: 0 },
                      end: { x: 10, y: 10 },
                      seamAllowanceCm: 1.5,
                      isFold: false,
                      lengthCm: 14.14
                    }
                  ]
                }
              }
            : p
        )
      };
      assert.throws(
        () =>
          createAuthoritativeGradingArtifact({
            ...baseProps,
            sizeRange: [...DEFAULT_SIZE_RANGE],
            perSizePatternGeometry: nanCoordSet,
            geometryValidationResult: f.gradingArtifact.geometryValidationResult
          }),
        ProductionSnapshotValidationError
      );

      // 7. Recomputed validation counts reject forged isOverallGradingValid: true when a size fails
      const forgedReportArtifact = createAuthoritativeGradingArtifact({
        ...baseProps,
        sizeRange: [...DEFAULT_SIZE_RANGE],
        perSizePatternGeometry: f.gradingArtifact.perSizePatternGeometry,
        geometryValidationResult: {
          ...f.gradingArtifact.geometryValidationResult,
          L: {
            ...f.gradingArtifact.geometryValidationResult['L'],
            isValid: false,
            status: 'invalid',
            errors: ['Seam crossing detected in L']
          }
        },
        gradingValidationResult: {
          ...f.gradingArtifact.gradingValidationResult,
          validSizeCount: DEFAULT_SIZE_RANGE.length,
          failedSizeCount: 0,
          isOverallGradingValid: true // Caller attempts to lie!
        }
      });
      assert.equal(forgedReportArtifact.gradingValidationResult.isOverallGradingValid, false);
      assert.equal(forgedReportArtifact.gradingValidationResult.failedSizeCount, 1);
      assert.equal(
        forgedReportArtifact.gradingValidationResult.validSizeCount,
        DEFAULT_SIZE_RANGE.length - 1
      );
      const forgedVerify = verifyGradingArtifactIntegrity(forgedReportArtifact);
      assert.equal(forgedVerify.isValid, false);
      assert.equal(forgedVerify.isValidationFailed, true);
    });
  });

  // --------------------------------------------------------------------------
  // D. AUDIT-05.1-01 — Lifecycle Event Ordering & Invalidation-Record Consistency
  // --------------------------------------------------------------------------
  describe('D. AUDIT-05.1-01: Event Ordering, Equal Timestamps & Invalidation-Record Parity', () => {
    it('permits equal monotonic timestamps while rejecting decreasing timestamps, eventIndex gaps, and invalidationRecord mismatches', () => {
      const f = buildLiveFixture();

      // 1. Pattern revision: equal timestamp between validated and invalidated is PERMITTED
      const invRevSameTs = invalidatePatternRevision(f.validatedRev, {
        invalidatedBy: 'qa-lead',
        invalidatedAt: f.ts.validatedIso, // exact equality with validatedAt!
        cause: 'specification_changed',
        reason: 'Spec revision superseded mid-review'
      });
      const sameTsVerify = verifyPatternRevisionLifecycleIntegrity(invRevSameTs);
      assert.equal(sameTsVerify.isValid, true, sameTsVerify.errors.join('; '));

      // Decreasing timestamp in rehashed pattern revision history MUST be rejected
      const revHistory = [...(invRevSameTs.lifecycleHistory ?? [])];
      const badTsEvtPrelim: Omit<PatternRevisionLifecycleEvent, 'lifecycleEventFingerprint'> = {
        ...revHistory[2],
        timestamp: new Date(Date.parse(f.ts.validatedIso) - 5_000).toISOString(),
        previousEventFingerprint: revHistory[1].lifecycleEventFingerprint!
      };
      const badTsEvt: PatternRevisionLifecycleEvent = {
        ...badTsEvtPrelim,
        lifecycleEventFingerprint: computePatternLifecycleEventFingerprint(badTsEvtPrelim)
      };
      const decreasingHistory = [revHistory[0], revHistory[1], badTsEvt];
      const badTsRev: AuthoritativePatternRevision = {
        ...invRevSameTs,
        lifecycleHistory: decreasingHistory,
        currentStateFingerprint: computePatternCurrentStateFingerprint({
          revisionId: invRevSameTs.revisionId,
          contentFingerprint: invRevSameTs.contentFingerprint!,
          currentLifecycleState: invRevSameTs.currentLifecycleState!,
          lifecycleHistory: decreasingHistory
        })
      };
      const decVerify = verifyPatternRevisionLifecycleIntegrity(badTsRev);
      assert.equal(decVerify.isValid, false);
      assert.equal(decVerify.isLifecycleTampered, true);

      // Orphaned / altered top-level invalidationRecords even when rehashed MUST be rejected
      const orphanedInvRecs: PatternInvalidationRecord[] = [
        ...invRevSameTs.invalidationRecords!,
        {
          ...invRevSameTs.invalidationRecords![0],
          invalidationId: 'inv-orphan-01'
        }
      ];
      const orphanRev: AuthoritativePatternRevision = {
        ...invRevSameTs,
        invalidationRecords: orphanedInvRecs,
        currentStateFingerprint: computePatternCurrentStateFingerprint({
          revisionId: invRevSameTs.revisionId,
          contentFingerprint: invRevSameTs.contentFingerprint!,
          currentLifecycleState: invRevSameTs.currentLifecycleState!,
          lifecycleHistory: invRevSameTs.lifecycleHistory!
        })
      };
      const orphanVerify = verifyPatternRevisionLifecycleIntegrity(orphanRev);
      assert.equal(orphanVerify.isValid, false);
      assert.equal(orphanVerify.isLifecycleTampered, true);

      // 2. Production package: equal timestamp invalidated event succeeds; altered invalidationRecord / eventIndex gap fails
      const pkg = buildValidPackage(f);
      const invPkg = invalidateProductionPackage(pkg, {
        invalidatedBy: 'qa-release-lead',
        invalidatedAt: f.ts.nowIso, // equal timestamp to createdAt!
        cause: 'grading-artifact-invalidated',
        reason: 'Grading rule adjustment'
      });
      const invPkgCheck = verifyProductionPackageIntegrity(invPkg);
      assert.equal(invPkgCheck.isStructurallyValid, true, invPkgCheck.errors.join('; '));
      assert.ok(invPkgCheck.limitationNotes.length > 0);

      // Alter top-level invalidationRecords cause & rehash currentStateFingerprint
      const forgedPkgInvRecs: PatternInvalidationRecord[] = invPkg.invalidationRecords.map(r => ({
        ...r,
        cause: 'manual-engineering-invalidation'
      }));
      const lastPkgEvtFp =
        invPkg.lifecycleHistory[invPkg.lifecycleHistory.length - 1].lifecycleEventFingerprint!;
      const forgedInvPkg: AuthoritativeProductionPackage = {
        ...invPkg,
        invalidationRecords: forgedPkgInvRecs,
        currentStateFingerprint: computeProductionPackageCurrentStateFingerprint({
          packageId: invPkg.packageId,
          manifestFingerprint: invPkg.manifestFingerprint,
          currentPackageState: invPkg.currentPackageState,
          eventCount: invPkg.lifecycleHistory.length,
          latestLifecycleEventFingerprint: lastPkgEvtFp
        })
      };
      const forgedPkgCheck = verifyProductionPackageIntegrity(forgedInvPkg);
      assert.equal(forgedPkgCheck.isStructurallyValid, false);
      assert.equal(forgedPkgCheck.isLifecycleTampered, true);

      // Non-contiguous eventIndex on package event
      const evt1BadIdxPrelim: Omit<ProductionPackageLifecycleEvent, 'lifecycleEventFingerprint'> = {
        ...invPkg.lifecycleHistory[1],
        eventIndex: 5
      };
      const evt1BadIdx: ProductionPackageLifecycleEvent = {
        ...evt1BadIdxPrelim,
        lifecycleEventFingerprint: computeProductionPackageLifecycleEventFingerprint(evt1BadIdxPrelim)
      };
      const badIdxPkg: AuthoritativeProductionPackage = {
        ...invPkg,
        lifecycleHistory: [invPkg.lifecycleHistory[0], evt1BadIdx],
        currentStateFingerprint: computeProductionPackageCurrentStateFingerprint({
          packageId: invPkg.packageId,
          manifestFingerprint: invPkg.manifestFingerprint,
          currentPackageState: invPkg.currentPackageState,
          eventCount: 2,
          latestLifecycleEventFingerprint: evt1BadIdx.lifecycleEventFingerprint!
        })
      };
      const badIdxCheck = verifyProductionPackageIntegrity(badIdxPkg);
      assert.equal(badIdxCheck.isStructurallyValid, false);
      assert.equal(badIdxCheck.isLifecycleTampered, true);
    });
  });

  // --------------------------------------------------------------------------
  // E. Pipeline Grading Fingerprint Alignment
  // --------------------------------------------------------------------------
  describe('E. Pipeline, Export & Package Grading Source Fingerprint Consistency', () => {
    it('accepts consistent basePatternFingerprint bindings in pipeline and export and rejects conflicting or missing fingerprints everywhere', () => {
      const f = buildLiveFixture();
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

      const pipeOk = evaluatePipelineDependencyIntegrity(baseInputs);
      assert.equal(pipeOk.isPipelineSynchronized, true, pipeOk.staleReasons.join('; '));
      const exportOk = validateProductionExportPrerequisites(pipeOk, f.approvedRev, baseInputs);
      assert.equal(exportOk.isExportPermitted, true, exportOk.blockingArtifacts.join('; '));

      // Construct a grading artifact with conflicting sourceBasePatternFingerprint !== sourcePatternSnapshotFingerprint
      // Note: createAuthoritativeGradingArtifact synchronizes both fields from its single canonical source fp,
      // so we test an externally-crafted conflicting artifact whose canonicalFingerprint is properly computed.
      const conflictingBase: Omit<AuthoritativeGradingArtifact, 'canonicalFingerprint'> = {
        ...f.gradingArtifact,
        sourceBasePatternFingerprint: f.approvedRev.basePatternFingerprint,
        sourcePatternSnapshotFingerprint: 'f'.repeat(64)
      };
      const canonicalConflict: AuthoritativeGradingArtifact = {
        ...conflictingBase,
        canonicalFingerprint: computeCanonicalGradingArtifactFingerprint(conflictingBase)
      };

      const pipeConflict = evaluatePipelineDependencyIntegrity({
        ...baseInputs,
        gradingArtifact: canonicalConflict
      });
      assert.equal(pipeConflict.isPipelineSynchronized, false);
      assert.equal(pipeConflict.canExportProductionDocumentation, false);

      const exportConflict = validateProductionExportPrerequisites(pipeConflict, f.approvedRev, {
        ...baseInputs,
        gradingArtifact: canonicalConflict
      });
      assert.equal(exportConflict.isExportPermitted, false);

      const pkgConflict = createAuthoritativeProductionPackage({
        packageId: 'pkg-conflict-fp',
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: canonicalConflict,
        exportGradingPolicy: { mode: 'graded-multi-size' },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: { cryptographicVerifier: f.cryptographicVerifier }
      });
      assert.equal(pkgConflict.isPackageCreated, false);
      assert.equal(pkgConflict.rejectionCode, 'GRADING_ARTIFACT_STALE_MISMATCH');
    });
  });
});
