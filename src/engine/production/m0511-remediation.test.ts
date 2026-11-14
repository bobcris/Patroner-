/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner — Milestone 05.1.1 Critical Remediation & Safeguards Adversarial Test Suite
 * Verifies AUDIT-05.1-01 through AUDIT-05.1-07 and Mandatory Safeguards 1, 2, and 3.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { draftSkirtBlock } from '../drafting/skirt-block';
import { validatePatternDraft } from '../validation/seam-validator';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { ENHANCED_PRESET_FABRICS, getEnhancedFabricById } from '../fabric/fabric-presets';
import { gradePattern, DEFAULT_SIZE_RANGE } from '../grading';
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
  revokeAuthoritativeGarmentSpecificationApproval,
  signSpecificationApprovalPayload
} from './garment-specification';
import {
  approveAuthoritativeMeasurementSet,
  approvePatternRevision,
  archivePatternRevision,
  archiveProductionPackage,
  computeBasePatternContentFingerprint,
  computeDraftingConfigFingerprint,
  computePatternCurrentStateFingerprint,
  computePatternLifecycleEventFingerprint,
  computePieceGeometryFingerprint,
  computeProductionPackageCurrentStateFingerprint,
  computeProductionPackageLifecycleEventFingerprint,
  createAuthoritativeGradingArtifact,
  createAuthoritativeMeasurementSet,
  createAuthoritativeProductionPackage,
  createDraftPatternRevision,
  evaluatePipelineDependencyIntegrity,
  invalidatePatternRevision,
  invalidateProductionPackage,
  revokeAuthoritativeGradingArtifact,
  revokeProductionPackage,
  signPatternRevisionApprovalPayload,
  supersedePatternRevision,
  supersedeProductionPackage,
  validatePatternRevision,
  validateProductionExportPrerequisites,
  verifyPatternRevisionApprovalLive,
  verifyPatternRevisionLifecycleIntegrity,
  verifyProductionPackageIntegrity
} from './index';
import { DesignSpecification, PatternPiece } from '../../types';
import {
  AuthoritativePatternRevision,
  AuthoritativeProductionPackage,
  PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION,
  PatternRevisionLifecycleEvent,
  ProductionPackageLifecycleEvent,
  ProductionSnapshotValidationError
} from './production-types';
import { SPECIFICATION_CANONICAL_SCHEMA_VERSION } from './garment-specification-types';

const PROJECT_ID = 'project-patroner-m0511';
const GARMENT_ID = 'garment-skirt-m0511-01';
const TS = '2026-11-13T10:00:00.000Z';
const SIZE_M = STANDARD_SIZING_SYSTEM.sizes.M;
const ISSUER_URL = 'https://idp.patroner.atelier';
const AUDIENCE = 'patroner-production-engine';
const OIDC_KEY_ID = 'oidc-kid-m0511-01';
const OIDC_SEED = 'm0511-oidc-issuer-ed25519-seed-material-01';

function buildBaseFixture() {
  const publicJwk = createOidcPublicJwk(OIDC_KEY_ID, OIDC_SEED, {
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

  const specOnlyKey = deriveEd25519SigningKeyPair('key-spec-only-01', 'seed-spec-only-01', {
    ownerPrincipal: 'Elena Vance (Specification Authority)',
    tenantId: PROJECT_ID,
    allowedScopes: ['specification:approve']
  });
  const patternOnlyKey = deriveEd25519SigningKeyPair('key-pat-only-01', 'seed-pat-only-01', {
    ownerPrincipal: 'Elena Vance (Pattern Authority)',
    tenantId: PROJECT_ID,
    allowedScopes: ['pattern:approve']
  });
  const dualKey = deriveEd25519SigningKeyPair('key-dual-01', 'seed-dual-01', {
    ownerPrincipal: 'Elena Vance (Dual Principal)',
    tenantId: PROJECT_ID,
    allowedScopes: ['specification:approve', 'pattern:approve']
  });

  let registry = createControlledPublicKeyRegistry();
  registry = registerPublicKeyInRegistry(registry, specOnlyKey.publicKeyRegistration);
  registry = registerPublicKeyInRegistry(registry, patternOnlyKey.publicKeyRegistration);
  registry = registerPublicKeyInRegistry(registry, dualKey.publicKeyRegistration);

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
    name: 'M0511 Tailored Skirt',
    garmentCategory: 'skirt',
    silhouette: 'pencil',
    fabric,
    color: { name: 'Charcoal', hex: '#1E293B' },
    easeProfile: 'classic',
    lengthCm: 64,
    prompt: 'Tailored pencil skirt for Milestone 05.1.1 verification',
    constructionFeatures: [],
    designNotes: [],
    createdAt: TS,
    updatedAt: TS,
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
      approvalEventId: 'spec-app-evt-m0511-1',
      approverPrincipal: 'Elena Vance (Specification Authority)',
      authorityTier: 'cryptographic_principal',
      approvalScope: 'specification:approve',
      approvalTimestamp: TS
    },
    {
      keyId: specOnlyKey.keyId,
      privateKeyHex: specOnlyKey.privateKeyHex,
      tenantId: PROJECT_ID
    }
  );

  const approvedSpec = approveAuthoritativeGarmentSpecification(
    draftSpec,
    'Elena Vance (Specification Authority)',
    {
      approvedAt: TS,
      approvalEventId: 'spec-app-evt-m0511-1',
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
      recordedAt: TS
    },
    recordedAt: TS
  });
  const approvedMeas = approveAuthoritativeMeasurementSet(unapprovedMeas, {
    approvingAuthority: 'Marco Rossi (Master Tailor)',
    approvedAt: TS,
    notes: ['Physical dress form verified.']
  });

  const designSpec: DesignSpecification = convertToDesignSpecification(approvedSpec);
  const pieces = draftSkirtBlock(SIZE_M, designSpec);
  const validationReport = validatePatternDraft(pieces);
  const gradedSet = gradePattern(designSpec);

  const draftRev = createDraftPatternRevision({
    revisionId: 'pat-rev-m0511-1',
    revisionNumber: 1,
    projectId: PROJECT_ID,
    garmentId: GARMENT_ID,
    createdAt: TS,
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
    validatedAt: '2026-11-13T10:05:00.000Z'
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
      approvalEventId: 'pat-app-evt-m0511-1',
      approverPrincipal: 'Elena Vance (Pattern Authority)',
      authorityTier: 'cryptographic_principal',
      approvalScope: 'pattern:approve',
      approvalTimestamp: '2026-11-13T10:10:00.000Z'
    },
    {
      keyId: patternOnlyKey.keyId,
      privateKeyHex: patternOnlyKey.privateKeyHex,
      tenantId: PROJECT_ID
    }
  );

  const approvedRev = approvePatternRevision(validatedRev, {
    approverName: 'Elena Vance (Pattern Authority)',
    approvedAt: '2026-11-13T10:10:00.000Z',
    approvalEventId: 'pat-app-evt-m0511-1',
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
    gradedPatternSet: gradedSet,
    basePatternPieces: pieces,
    createdAt: TS
  });

  return {
    identityVerifier,
    replayStore,
    cryptographicVerifier,
    specOnlyKey,
    patternOnlyKey,
    dualKey,
    fabric,
    approvedSpec,
    approvedMeas,
    designSpec,
    pieces,
    validationReport,
    gradedSet,
    draftRev,
    validatedRev,
    patSig,
    approvedRev,
    gradingArtifact
  };
}

describe('Milestone 05.1.1 — Critical Remediation & Mandatory Safeguards', () => {
  // --------------------------------------------------------------------------
  // AUDIT-05.1-01 & SAFEGUARD 2: Lifecycle Transition State Machine & Limitations
  // --------------------------------------------------------------------------
  describe('AUDIT-05.1-01 & Safeguard 2: Lifecycle State Machine Enforcement & Hash-Chain Limitations', () => {
    it('rejects illegal pattern revision transitions even when lifecycleEventFingerprint and currentStateFingerprint are validly recomputed', () => {
      const f = buildBaseFixture();
      const contentFp = f.draftRev.contentFingerprint!;
      const genesis = f.draftRev.lifecycleHistory![0];

      // Illegal jump: draft -> approved (skipping validated) with validly recomputed fingerprints
      const forgedEventPrelim: Omit<PatternRevisionLifecycleEvent, 'lifecycleEventFingerprint'> = {
        eventId: `${f.draftRev.revisionId}-evt-2-forged`,
        eventIndex: 1,
        eventType: 'approved',
        fromState: 'draft',
        toState: 'approved',
        targetRevisionId: f.draftRev.revisionId,
        targetContentFingerprint: contentFp,
        timestamp: '2026-11-13T10:12:00.000Z',
        actor: 'Elena Vance (Pattern Authority)',
        approvalRecord: f.approvedRev.patternApprovalRecord,
        previousEventFingerprint: genesis.lifecycleEventFingerprint
      };
      const forgedEvent: PatternRevisionLifecycleEvent = {
        ...forgedEventPrelim,
        lifecycleEventFingerprint: computePatternLifecycleEventFingerprint(forgedEventPrelim)
      };
      const forgedHistory = [genesis, forgedEvent];
      const forgedRev: AuthoritativePatternRevision = {
        ...f.draftRev,
        lifecycleHistory: forgedHistory,
        currentLifecycleState: 'approved',
        patternApprovalRecord: f.approvedRev.patternApprovalRecord,
        currentStateFingerprint: computePatternCurrentStateFingerprint({
          revisionId: f.draftRev.revisionId,
          contentFingerprint: contentFp,
          currentLifecycleState: 'approved',
          lifecycleHistory: forgedHistory
        })
      };

      const check = verifyPatternRevisionLifecycleIntegrity(forgedRev);
      assert.equal(check.isValid, false);
      assert.equal(check.isLifecycleTampered, true);
      assert.ok(check.errors.some(e => /Illegal lifecycle transition/i.test(e)));

      // Illegal backward jump: archived -> draft with valid hashes
      const superseded = supersedePatternRevision(f.approvedRev, {
        supersededByRevisionId: 'pat-rev-next-2',
        timestamp: '2026-11-13T10:20:00.000Z'
      });
      const archived = archivePatternRevision(superseded, {
        archivedAt: '2026-11-13T10:25:00.000Z'
      });
      const lastArchEvt = archived.lifecycleHistory![archived.lifecycleHistory!.length - 1];
      const reopenPrelim: Omit<PatternRevisionLifecycleEvent, 'lifecycleEventFingerprint'> = {
        eventId: `${archived.revisionId}-evt-reopen`,
        eventIndex: archived.lifecycleHistory!.length,
        eventType: 'draft-created',
        fromState: 'archived',
        toState: 'draft',
        targetRevisionId: archived.revisionId,
        targetContentFingerprint: archived.contentFingerprint!,
        timestamp: '2026-11-13T10:30:00.000Z',
        actor: 'attacker',
        previousEventFingerprint: lastArchEvt.lifecycleEventFingerprint
      };
      const reopenEvent: PatternRevisionLifecycleEvent = {
        ...reopenPrelim,
        lifecycleEventFingerprint: computePatternLifecycleEventFingerprint(reopenPrelim)
      };
      const reopenedHistory = [...archived.lifecycleHistory!, reopenEvent];
      const reopenedRev: AuthoritativePatternRevision = {
        ...archived,
        lifecycleHistory: reopenedHistory,
        currentLifecycleState: 'draft',
        currentStateFingerprint: computePatternCurrentStateFingerprint({
          revisionId: archived.revisionId,
          contentFingerprint: archived.contentFingerprint!,
          currentLifecycleState: 'draft',
          lifecycleHistory: reopenedHistory
        })
      };

      const reopenCheck = verifyPatternRevisionLifecycleIntegrity(reopenedRev);
      assert.equal(reopenCheck.isValid, false);
      assert.equal(reopenCheck.isLifecycleTampered, true);
    });

    it('rejects illegal production package transitions (active->archived, revoked->invalidated, invalidated->revoked) even with valid hashes and emits honest limitationNotes', () => {
      const f = buildBaseFixture();
      const pkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-sm-01',
        projectId: PROJECT_ID,
        createdAt: TS,
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        exportGradingPolicy: {
          mode: 'graded-multi-size',
          requiredSizes: [...DEFAULT_SIZE_RANGE]
        },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier,
          cryptographicSignature: f.patSig
        }
      });
      assert.equal(pkgRes.isPackageCreated, true);
      const pkg = pkgRes.package!;

      // Direct active -> archived via forged hash-valid event
      const genesis = pkg.lifecycleHistory[0];
      const forgedActiveArchPrelim: Omit<ProductionPackageLifecycleEvent, 'lifecycleEventFingerprint'> = {
        eventId: 'pkg-evt-forged-arch',
        packageId: pkg.packageId,
        fromState: 'active',
        toState: 'archived',
        timestamp: '2026-11-13T11:00:00.000Z',
        actorId: 'attacker',
        actorRole: 'operator',
        reason: 'Skip revocation/supersession',
        manifestFingerprint: pkg.manifestFingerprint,
        previousEventFingerprint: genesis.lifecycleEventFingerprint
      };
      const forgedActiveArchEvt: ProductionPackageLifecycleEvent = {
        ...forgedActiveArchPrelim,
        lifecycleEventFingerprint: computeProductionPackageLifecycleEventFingerprint(forgedActiveArchPrelim)
      };
      const forgedPkg: AuthoritativeProductionPackage = {
        ...pkg,
        lifecycleHistory: [genesis, forgedActiveArchEvt],
        currentPackageState: 'archived',
        currentStateFingerprint: computeProductionPackageCurrentStateFingerprint({
          packageId: pkg.packageId,
          manifestFingerprint: pkg.manifestFingerprint,
          currentPackageState: 'archived',
          latestLifecycleEventFingerprint: forgedActiveArchEvt.lifecycleEventFingerprint,
          eventCount: 2
        })
      };

      const check = verifyProductionPackageIntegrity(forgedPkg);
      assert.equal(check.isStructurallyValid, false);
      assert.equal(check.isLifecycleTampered, true);
      assert.equal(check.isCurrentlyAuthorized, false);
      assert.ok(check.errors.some(e => /Illegal package lifecycle transition/i.test(e)));
      assert.ok(
        check.limitationNotes.some(n => /cannot prevent history rewriting or truncation/i.test(n))
      );

      // Runtime transition guards
      const revoked = revokeProductionPackage(pkg, {
        reason: 'Recalled for seam revision',
        revokedAt: '2026-11-13T11:00:00.000Z'
      });
      assert.throws(
        () =>
          invalidateProductionPackage(revoked, {
            cause: 'specification_changed',
            reason: 'Illegal post-revocation invalidation'
          }),
        /revoked packages cannot transition to 'invalidated'/i
      );

      const invalidated = invalidateProductionPackage(pkg, {
        cause: 'specification_changed',
        reason: 'Spec changed',
        invalidatedAt: '2026-11-13T11:00:00.000Z'
      });
      assert.throws(
        () =>
          revokeProductionPackage(invalidated, {
            reason: 'Illegal post-invalidation revocation'
          }),
        /in state 'invalidated' cannot transition to 'revoked'/i
      );
      assert.throws(
        () =>
          revokeProductionPackage(pkg, {
            reason: '   '
          }),
        /requires a non-empty reason/i
      );
    });
  });

  // --------------------------------------------------------------------------
  // AUDIT-05.1-02: Export & Pipeline Rejection of Non-Approved Pattern Revisions
  // --------------------------------------------------------------------------
  describe('AUDIT-05.1-02: Export & Pipeline Guard Rejects Draft/Validated/Superseded/Invalidated/Archived Pattern Revisions', () => {
    it('blocks both evaluatePipelineDependencyIntegrity and validateProductionExportPrerequisites for draft, validated, superseded, invalidated, and archived revisions', () => {
      const f = buildBaseFixture();
      const supersededRev = supersedePatternRevision(f.approvedRev, {
        supersededByRevisionId: 'pat-rev-m0511-2',
        timestamp: '2026-11-13T10:20:00.000Z'
      });
      const invalidatedRev = invalidatePatternRevision(f.approvedRev, {
        cause: 'measurement_changed',
        reason: 'Measurement updated',
        invalidatedAt: '2026-11-13T10:20:00.000Z'
      });
      const archivedRev = archivePatternRevision(supersededRev, {
        archivedAt: '2026-11-13T10:25:00.000Z'
      });

      const cases = [
        { rev: f.draftRev, expectedCode: 'PATTERN_REVISION_NOT_APPROVED' },
        { rev: f.validatedRev, expectedCode: 'PATTERN_REVISION_NOT_APPROVED' },
        { rev: supersededRev, expectedCode: 'PATTERN_REVISION_SUPERSEDED' },
        { rev: invalidatedRev, expectedCode: 'PATTERN_REVISION_INVALIDATED' },
        { rev: archivedRev, expectedCode: 'PATTERN_REVISION_ARCHIVED' }
      ] as const;

      for (const tc of cases) {
        const report = evaluatePipelineDependencyIntegrity({
          specification: f.approvedSpec,
          measurements: SIZE_M,
          measurementSet: f.approvedMeas,
          activeSize: 'M',
          fabric: f.fabric,
          patternPieces: f.pieces,
          validationReport: f.validationReport,
          productionSnapshot: tc.rev,
          verificationContext: { cryptographicVerifier: f.cryptographicVerifier },
          patternVerificationContext: {
            cryptographicVerifier: f.cryptographicVerifier,
            cryptographicSignature: f.patSig
          }
        });
        assert.notEqual(
          report.artifacts['production-snapshot'].status,
          'current',
          `Snapshot in state '${tc.rev.currentLifecycleState}' must not report current`
        );

        const exportRes = validateProductionExportPrerequisites(report, tc.rev, {
          specification: f.approvedSpec,
          measurements: SIZE_M,
          measurementSet: f.approvedMeas,
          fabric: f.fabric,
          patternPieces: f.pieces,
          validationReport: f.validationReport,
          exportGradingPolicy: {
            mode: 'single-size-ungraded',
            nonGradingReason: 'Test'
          },
          verificationContext: { cryptographicVerifier: f.cryptographicVerifier },
          patternVerificationContext: {
            cryptographicVerifier: f.cryptographicVerifier,
            cryptographicSignature: f.patSig
          }
        });
        assert.equal(exportRes.isExportPermitted, false);
        assert.equal(exportRes.rejectionCode, tc.expectedCode);
      }
    });
  });

  // --------------------------------------------------------------------------
  // AUDIT-05.1-03 & SAFEGUARD 3: Fail-Closed Package Verification & Piece Fidelity
  // --------------------------------------------------------------------------
  describe('AUDIT-05.1-03 & Safeguard 3: Fail-Closed Production Package Authorization & Piece Inventory Fidelity', () => {
    it('returns isCurrentlyAuthorized: false when sourceContext is omitted or partial, and true only with full live verification on active package', () => {
      const f = buildBaseFixture();
      const pkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-auth-verify-01',
        projectId: PROJECT_ID,
        createdAt: TS,
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        exportGradingPolicy: {
          mode: 'graded-multi-size',
          requiredSizes: [...DEFAULT_SIZE_RANGE]
        },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier,
          cryptographicSignature: f.patSig
        }
      });
      assert.equal(pkgRes.isPackageCreated, true);
      const pkg = pkgRes.package!;

      // 1. Omitted sourceContext -> structural/historical ok, current authorization FALSE (fail-closed)
      const noCtx = verifyProductionPackageIntegrity(pkg);
      assert.equal(noCtx.isStructurallyValid, true);
      assert.equal(noCtx.isHistoricallyVerifiable, true);
      assert.equal(noCtx.isCurrentlyAuthorized, false);
      assert.equal(noCtx.sourceVerificationStatus, 'partial-unverified-upstream');
      assert.ok(noCtx.missingSourceContextFields.length > 0);
      assert.ok(noCtx.authorizationErrors.length > 0);

      // 2. Partial sourceContext (missing patternApprovalVerificationContext and gradingArtifact)
      const partialCtx = verifyProductionPackageIntegrity(pkg, {
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier }
      });
      assert.equal(partialCtx.isStructurallyValid, true);
      assert.equal(partialCtx.isCurrentlyAuthorized, false);
      assert.ok(partialCtx.missingSourceContextFields.includes('gradingArtifact'));
      assert.ok(partialCtx.missingSourceContextFields.includes('patternApprovalVerificationContext'));

      // 3. Complete valid live sourceContext -> authorized TRUE
      const fullCtx = verifyProductionPackageIntegrity(pkg, {
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier,
          cryptographicSignature: f.patSig
        }
      });
      assert.equal(fullCtx.isStructurallyValid, true);
      assert.equal(fullCtx.isHistoricallyVerifiable, true);
      assert.equal(fullCtx.isCurrentlyAuthorized, true);
      assert.equal(fullCtx.sourceVerificationStatus, 'complete');
      assert.deepEqual(fullCtx.missingSourceContextFields, []);
      assert.deepEqual(fullCtx.authorizationErrors, []);

      // 4. Revoked upstream specification -> isCurrentlyAuthorized FALSE even with full context
      const revokedSpec = revokeAuthoritativeGarmentSpecificationApproval(
        f.approvedSpec,
        'Spec withdrawn'
      );
      const revokedUpstreamCtx = verifyProductionPackageIntegrity(pkg, {
        patternRevision: f.approvedRev,
        specification: revokedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier,
          cryptographicSignature: f.patSig
        }
      });
      assert.equal(revokedUpstreamCtx.isCurrentlyAuthorized, false);
      assert.ok(revokedUpstreamCtx.authorizationErrors.length > 0);

      // 5. Revoked package -> isCurrentlyAuthorized FALSE even with valid full sourceContext
      const revokedPkg = revokeProductionPackage(pkg, {
        reason: 'Package recall',
        revokedAt: '2026-11-13T11:00:00.000Z'
      });
      const revokedPkgCheck = verifyProductionPackageIntegrity(revokedPkg, {
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        gradingArtifact: f.gradingArtifact,
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier,
          cryptographicSignature: f.patSig
        }
      });
      assert.equal(revokedPkgCheck.isStructurallyValid, true);
      assert.equal(revokedPkgCheck.isCurrentlyAuthorized, false);
      assert.equal(revokedPkgCheck.currentPackageState, 'revoked');
    });

    it('captures piece cutCount, onFold, material, grainline, and drillHoleCount in manifest and rejects tampering', () => {
      const f = buildBaseFixture();
      const customPieces: PatternPiece[] = f.pieces.map((p, idx) =>
        idx === 0
          ? {
              ...p,
              cutCount: 2,
              onFold: false,
              material: 'lining',
              drillHoles: [{ x: 4, y: 8, radiusCm: 0.2, label: 'dart-apex' }]
            }
          : {
              ...p,
              cutCount: 1,
              onFold: true,
              material: 'self'
            }
      );

      const draftCustom = createDraftPatternRevision({
        revisionId: 'pat-rev-piece-mfg-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_ID,
        createdAt: TS,
        designSpec: f.designSpec,
        authoritativeSpec: f.approvedSpec,
        authoritativeMeasurementSet: f.approvedMeas,
        pieces: customPieces,
        validationReport: f.validationReport,
        enhancedFabric: f.fabric,
        fabricSource: 'verified-preset'
      });
      const valCustom = validatePatternRevision(draftCustom, {
        validatedAt: '2026-11-13T10:05:00.000Z'
      });
      const sigCustom = signPatternRevisionApprovalPayload(
        {
          schemaVersion: PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION,
          projectId: PROJECT_ID,
          tenantId: PROJECT_ID,
          garmentId: GARMENT_ID,
          patternRevisionId: valCustom.revisionId,
          patternRevisionNumber: valCustom.revisionIndex,
          basePatternFingerprint: valCustom.basePatternFingerprint!,
          geometryFingerprint: valCustom.geometryFingerprint!,
          sourceSpecificationFingerprint: valCustom.sourceSpecificationFingerprint!,
          sourceMeasurementSetFingerprint: valCustom.sourceMeasurementSetFingerprint!,
          approvalEventId: 'pat-app-custom-01',
          approverPrincipal: 'Elena Vance (Pattern Authority)',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'pattern:approve',
          approvalTimestamp: '2026-11-13T10:10:00.000Z'
        },
        {
          keyId: f.patternOnlyKey.keyId,
          privateKeyHex: f.patternOnlyKey.privateKeyHex,
          tenantId: PROJECT_ID
        }
      );
      const appCustom = approvePatternRevision(valCustom, {
        approverName: 'Elena Vance (Pattern Authority)',
        approvedAt: '2026-11-13T10:10:00.000Z',
        approvalEventId: 'pat-app-custom-01',
        authorityTier: 'cryptographic_principal',
        cryptographicVerifier: f.cryptographicVerifier,
        cryptographicSignature: sigCustom
      });

      const pkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-piece-mfg-01',
        projectId: PROJECT_ID,
        createdAt: TS,
        patternRevision: appCustom,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'Single-size manufacturing cut sheet'
        },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier,
          cryptographicSignature: sigCustom
        }
      });
      assert.equal(pkgRes.isPackageCreated, true);
      const pkg = pkgRes.package!;
      const expectedTotal = customPieces.reduce((sum, p) => sum + p.cutCount, 0);
      assert.equal(pkg.manifest.totalPieceInstancesAcrossSizes, expectedTotal);
      assert.equal(pkg.manifest.pieceInventory[0].cutCount, 2);
      assert.equal(pkg.manifest.pieceInventory[0].material, 'lining');
      assert.equal(pkg.manifest.pieceInventory[0].drillHoleCount, 1);

      // Tampering cutCount on manifest fails verification
      const tamperedPkg: AuthoritativeProductionPackage = {
        ...pkg,
        manifest: {
          ...pkg.manifest,
          pieceInventory: pkg.manifest.pieceInventory.map((entry, idx) =>
            idx === 0 ? { ...entry, cutCount: 1 } : entry
          )
        }
      };
      const tamperedCheck = verifyProductionPackageIntegrity(tamperedPkg);
      assert.equal(tamperedCheck.isStructurallyValid, false);
      assert.equal(tamperedCheck.isManifestTampered, true);
    });
  });

  // --------------------------------------------------------------------------
  // AUDIT-05.1-04: Idempotency of Double Invalidation & Double Revocation
  // --------------------------------------------------------------------------
  describe('AUDIT-05.1-04: Idempotent Invalidation & Revocation', () => {
    it('makes double invalidation and double revocation idempotent while preserving history length and fingerprints', () => {
      const f = buildBaseFixture();

      // Pattern revision double invalidation
      const invPat1 = invalidatePatternRevision(f.approvedRev, {
        cause: 'measurement_changed',
        reason: 'Waist altered',
        invalidatedAt: '2026-11-13T10:30:00.000Z'
      });
      const invPat2 = invalidatePatternRevision(invPat1, {
        cause: 'specification_changed',
        reason: 'Duplicate propagation call',
        invalidatedAt: '2026-11-13T10:31:00.000Z'
      });
      assert.equal(invPat2.lifecycleHistory?.length, invPat1.lifecycleHistory?.length);
      assert.equal(invPat2.invalidationRecords?.length, invPat1.invalidationRecords?.length);
      assert.equal(invPat2.currentStateFingerprint, invPat1.currentStateFingerprint);
      assert.equal(verifyPatternRevisionLifecycleIntegrity(invPat2).isValid, true);

      // Package double invalidation & double revocation
      const pkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-idemp-01',
        projectId: PROJECT_ID,
        createdAt: TS,
        patternRevision: f.approvedRev,
        specification: f.approvedSpec,
        measurementSet: f.approvedMeas,
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'Single-size fitting toile'
        },
        specificationVerificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternApprovalVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier,
          cryptographicSignature: f.patSig
        }
      });
      const pkg = pkgRes.package!;

      const invPkg1 = invalidateProductionPackage(pkg, {
        cause: 'specification_changed',
        reason: 'Upstream spec updated',
        invalidatedAt: '2026-11-13T11:00:00.000Z'
      });
      const invPkg2 = invalidateProductionPackage(invPkg1, {
        cause: 'measurement_changed',
        reason: 'Duplicate propagation pass',
        invalidatedAt: '2026-11-13T11:05:00.000Z'
      });
      assert.equal(invPkg2.lifecycleHistory.length, invPkg1.lifecycleHistory.length);
      assert.equal(invPkg2.invalidationRecords.length, invPkg1.invalidationRecords.length);
      assert.equal(invPkg2.currentStateFingerprint, invPkg1.currentStateFingerprint);
      assert.equal(verifyProductionPackageIntegrity(invPkg2).isStructurallyValid, true);

      const revPkg1 = revokeProductionPackage(pkg, {
        reason: 'QC defect',
        revokedAt: '2026-11-13T11:00:00.000Z'
      });
      const revPkg2 = revokeProductionPackage(revPkg1, {
        reason: 'Duplicate revocation call',
        revokedAt: '2026-11-13T11:05:00.000Z'
      });
      assert.equal(revPkg2.lifecycleHistory.length, revPkg1.lifecycleHistory.length);
      assert.equal(revPkg2.currentStateFingerprint, revPkg1.currentStateFingerprint);
      assert.equal(verifyProductionPackageIntegrity(revPkg2).isStructurallyValid, true);
    });
  });

  // --------------------------------------------------------------------------
  // AUDIT-05.1-05 & SAFEGUARD 1: Strict Domain Separation & Live Verification
  // --------------------------------------------------------------------------
  describe('AUDIT-05.1-05 & Safeguard 1: Cross-Domain Signature/JWT Rejection & Non-Metadata Verification', () => {
    it('blocks specification-scoped Ed25519 keys and OIDC JWTs from approving patterns and vice versa', () => {
      const f = buildBaseFixture();

      // 1. Spec-only key used to sign a pattern approval payload -> rejected
      const crossDomainPatSig = signPatternRevisionApprovalPayload(
        {
          schemaVersion: PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION,
          projectId: PROJECT_ID,
          tenantId: PROJECT_ID,
          garmentId: GARMENT_ID,
          patternRevisionId: f.validatedRev.revisionId,
          patternRevisionNumber: f.validatedRev.revisionIndex,
          basePatternFingerprint: f.validatedRev.basePatternFingerprint!,
          geometryFingerprint: f.validatedRev.geometryFingerprint!,
          sourceSpecificationFingerprint: f.validatedRev.sourceSpecificationFingerprint!,
          sourceMeasurementSetFingerprint: f.validatedRev.sourceMeasurementSetFingerprint!,
          approvalEventId: 'pat-app-cross-01',
          approverPrincipal: 'Elena Vance (Specification Authority)',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'pattern:approve',
          approvalTimestamp: '2026-11-13T10:10:00.000Z'
        },
        {
          keyId: f.specOnlyKey.keyId,
          privateKeyHex: f.specOnlyKey.privateKeyHex,
          tenantId: PROJECT_ID
        }
      );
      assert.throws(
        () =>
          approvePatternRevision(f.validatedRev, {
            approverName: 'Elena Vance (Specification Authority)',
            approvedAt: '2026-11-13T10:10:00.000Z',
            approvalEventId: 'pat-app-cross-01',
            authorityTier: 'cryptographic_principal',
            cryptographicVerifier: f.cryptographicVerifier,
            cryptographicSignature: crossDomainPatSig
          }),
        /not authorized for scope "pattern:approve"/i
      );

      // 2. Pattern-only key used to sign a specification approval payload -> rejected
      const draftSpec2 = createAuthoritativeGarmentSpecification({
        projectId: PROJECT_ID,
        garmentId: `${GARMENT_ID}-2`,
        specificationRevisionId: `spec-${GARMENT_ID}-2-v1`,
        version: 1,
        name: 'Spec Cross Domain Guard',
        garmentCategory: 'skirt',
        silhouette: 'pencil',
        fabric: f.fabric,
        easeProfile: 'classic',
        lengthCm: 64
      });
      const crossDomainSpecSig = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: PROJECT_ID,
          garmentId: draftSpec2.garmentId,
          specificationRevisionId: draftSpec2.specificationRevisionId,
          specificationVersion: 1,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draftSpec2),
          approvalEventId: 'spec-app-cross-01',
          approverPrincipal: 'Elena Vance (Pattern Authority)',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: TS
        },
        {
          keyId: f.patternOnlyKey.keyId,
          privateKeyHex: f.patternOnlyKey.privateKeyHex,
          tenantId: PROJECT_ID
        }
      );
      assert.throws(
        () =>
          approveAuthoritativeGarmentSpecification(draftSpec2, 'Elena Vance (Pattern Authority)', {
            approvedAt: TS,
            approvalEventId: 'spec-app-cross-01',
            authorityTier: 'cryptographic_principal',
            cryptographicVerifier: f.cryptographicVerifier,
            cryptographicSignature: crossDomainSpecSig
          }),
        /not authorized for scope "specification:approve"/i
      );

      // 3. Specification-scoped OIDC JWT rejected when approving a pattern revision
      const specScopedJwt = issueVerifiableIdentityCredential(
        {
          issuer: ISSUER_URL,
          subjectId: 'designer-claire-01',
          displayName: 'Claire Moreau',
          audience: AUDIENCE,
          tenantId: PROJECT_ID,
          keyId: OIDC_KEY_ID,
          jti: 'jti-cross-domain-01',
          issuedAt: '2026-11-13T09:55:00.000Z',
          notBefore: '2026-11-13T09:55:00.000Z',
          expiresAt: '2026-11-13T11:00:00.000Z',
          claims: ['specification:approve'],
          use: 'specification_approval',
          specificationId: GARMENT_ID,
          patternRevisionId: f.validatedRev.revisionId,
          basePatternFingerprint: f.validatedRev.basePatternFingerprint!,
          geometryFingerprint: f.validatedRev.geometryFingerprint!,
          sourceSpecificationFingerprint: f.validatedRev.sourceSpecificationFingerprint!,
          sourceMeasurementSetFingerprint: f.validatedRev.sourceMeasurementSetFingerprint!,
          targetRevisionId: f.validatedRev.revisionId,
          targetSpecificationFingerprint: f.validatedRev.basePatternFingerprint!
        },
        OIDC_SEED
      );
      assert.throws(
        () =>
          approvePatternRevision(f.validatedRev, {
            approverName: 'Claire Moreau',
            approvedAt: TS,
            authorityTier: 'authenticated_designer',
            identityVerifier: f.identityVerifier,
            identityCredential: specScopedJwt
          }),
        /pattern:approve/i
      );

      // 4. Verifier payload-domain cross-check: verifyPatternApprovalSignature rejects spec payload; verifyApprovalSignature rejects pattern payload
      const specPayloadCheck = f.cryptographicVerifier.verifyPatternApprovalSignature!(
        crossDomainSpecSig,
        f.patSig.signedPayload as any
      );
      assert.equal(specPayloadCheck.verified, false);
      const rawVerifyCheck = f.cryptographicVerifier.verifySignature(
        f.patSig as any,
        crossDomainSpecSig.signedPayload
      );
      assert.equal(rawVerifyCheck.verified, false);
    });

    it('never trusts approval metadata flags without live cryptographic verification and rejects forged/swapped signatures (Safeguard 1)', () => {
      const f = buildBaseFixture();
      const report = evaluatePipelineDependencyIntegrity({
        specification: f.approvedSpec,
        measurements: SIZE_M,
        measurementSet: f.approvedMeas,
        activeSize: 'M',
        fabric: f.fabric,
        patternPieces: f.pieces,
        validationReport: f.validationReport,
        productionSnapshot: f.approvedRev,
        verificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternVerificationContext: {
          cryptographicVerifier: f.cryptographicVerifier,
          cryptographicSignature: f.patSig
        }
      });

      // 1. Direct Safeguard 1 check: approvedRev metadata flags (isApprovalAuthenticated: true,
      // cryptographicSignature present) MUST NOT establish authorization without a live verifier.
      const directNoCtx = verifyPatternRevisionApprovalLive({ revision: f.approvedRev });
      assert.equal(directNoCtx.isAuthorized, false);
      assert.equal(directNoCtx.failureCode, 'AUTHORIZATION_PROVIDER_UNAVAILABLE');
      assert.equal(directNoCtx.isProviderUnavailable, true);

      // 2. Export gate with specification verified and patternVerificationContext missing its provider -> AUTHORIZATION_PROVIDER_UNAVAILABLE
      const unverifiedReport = evaluatePipelineDependencyIntegrity({
        specification: f.approvedSpec,
        measurements: SIZE_M,
        measurementSet: f.approvedMeas,
        activeSize: 'M',
        fabric: f.fabric,
        patternPieces: f.pieces,
        validationReport: f.validationReport,
        productionSnapshot: f.approvedRev,
        verificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternVerificationContext: {}
      });
      assert.equal(unverifiedReport.canExportProductionDocumentation, false);
      assert.equal(unverifiedReport.artifacts['production-snapshot'].status, 'pending');

      const noPatternProviderExport = validateProductionExportPrerequisites(unverifiedReport, f.approvedRev, {
        specification: f.approvedSpec,
        measurements: SIZE_M,
        measurementSet: f.approvedMeas,
        fabric: f.fabric,
        patternPieces: f.pieces,
        validationReport: f.validationReport,
        verificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternVerificationContext: {},
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'Metadata-only check'
        }
      });
      assert.equal(noPatternProviderExport.isExportPermitted, false);
      assert.equal(noPatternProviderExport.rejectionCode, 'AUTHORIZATION_PROVIDER_UNAVAILABLE');

      // Even supplying an earlier clean report when provider is missing fails closed
      const cleanReportWithoutProvider = validateProductionExportPrerequisites(report, f.approvedRev, {
        specification: f.approvedSpec,
        measurements: SIZE_M,
        measurementSet: f.approvedMeas,
        fabric: f.fabric,
        patternPieces: f.pieces,
        validationReport: f.validationReport,
        verificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternVerificationContext: {},
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'Clean report without provider check'
        }
      });
      assert.equal(cleanReportWithoutProvider.isExportPermitted, false);

      // 3. Export gate with ALL verifiers omitted MUST also fail closed (never trust recorded metadata)
      const noVerifierExport = validateProductionExportPrerequisites(report, f.approvedRev, {
        specification: f.approvedSpec,
        measurements: SIZE_M,
        measurementSet: f.approvedMeas,
        fabric: f.fabric,
        patternPieces: f.pieces,
        validationReport: f.validationReport,
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'No verifier check'
        }
      });
      assert.equal(noVerifierExport.isExportPermitted, false);

      // Untrusted/different public key verifier MUST reject signature even with valid metadata
      const rogueKey = deriveEd25519SigningKeyPair('key-rogue-01', 'seed-rogue-01', {
        ownerPrincipal: 'Elena Vance (Pattern Authority)',
        tenantId: PROJECT_ID,
        allowedScopes: ['pattern:approve']
      });
      const rogueVerifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [rogueKey.publicKeyRegistration]
      });
      const wrongKeyReport = evaluatePipelineDependencyIntegrity({
        specification: f.approvedSpec,
        measurements: SIZE_M,
        measurementSet: f.approvedMeas,
        activeSize: 'M',
        fabric: f.fabric,
        patternPieces: f.pieces,
        validationReport: f.validationReport,
        productionSnapshot: f.approvedRev,
        verificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternVerificationContext: {
          cryptographicVerifier: rogueVerifier,
          cryptographicSignature: f.patSig
        }
      });
      assert.equal(wrongKeyReport.artifacts['production-snapshot'].status, 'invalid');

      const wrongKeyExport = validateProductionExportPrerequisites(wrongKeyReport, f.approvedRev, {
        specification: f.approvedSpec,
        measurements: SIZE_M,
        measurementSet: f.approvedMeas,
        fabric: f.fabric,
        patternPieces: f.pieces,
        validationReport: f.validationReport,
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'Wrong key check'
        },
        verificationContext: { cryptographicVerifier: f.cryptographicVerifier },
        patternVerificationContext: {
          cryptographicVerifier: rogueVerifier,
          cryptographicSignature: f.patSig
        }
      });
      assert.equal(wrongKeyExport.isExportPermitted, false);
      assert.equal(wrongKeyExport.rejectionCode, 'PATTERN_REVISION_APPROVAL_INVALID');
    });
  });

  // --------------------------------------------------------------------------
  // AUDIT-05.1-06: Multi-Size Grading Completeness & Generalized Extraction
  // --------------------------------------------------------------------------
  describe('AUDIT-05.1-06: Fail-Closed Grading Artifact Size Completeness & Generalized Piece Extraction', () => {
    it('fails closed when gradedPatternSet omits a declared size or produces 0 pieces, and extracts skirtPieces/pieces cleanly', () => {
      const f = buildBaseFixture();

      // 1. Missing size in sizeResults -> throws fail-closed
      const incompleteSizeResults = { ...f.gradedSet.sizeResults };
      delete incompleteSizeResults['XXL'];
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
            gradedPatternSet: {
              ...f.gradedSet,
              sizeResults: incompleteSizeResults
            },
            basePatternPieces: f.pieces,
            createdAt: TS
          }),
        ProductionSnapshotValidationError
      );

      // 2. Size with 0 pieces -> throws fail-closed
      const emptyPieceResults = {
        ...f.gradedSet.sizeResults,
        XL: {
          ...f.gradedSet.sizeResults.XL,
          bodicePieces: [],
          sleevePiece: undefined
        }
      };
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
            gradedPatternSet: {
              ...f.gradedSet,
              sizeResults: emptyPieceResults
            },
            basePatternPieces: f.pieces,
            createdAt: TS
          }),
        ProductionSnapshotValidationError
      );

      // 3. Generalized extraction via skirtPieces / pieces arrays without bodicePieces
      const generalizedResults = Object.fromEntries(
        Object.entries(f.gradedSet.sizeResults).map(([sz, res]) => [
          sz,
          {
            ...res,
            bodicePieces: [],
            sleevePiece: undefined,
            skirtPieces: res.bodicePieces
          }
        ])
      );
      const genArtifact = createAuthoritativeGradingArtifact({
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
        gradedPatternSet: {
          ...f.gradedSet,
          sizeResults: generalizedResults as typeof f.gradedSet.sizeResults
        },
        basePatternPieces: f.pieces,
        createdAt: TS
      });
      assert.equal(genArtifact.perSizePatternGeometry.M.length, f.gradedSet.sizeResults.M.bodicePieces.length);
    });
  });

  // --------------------------------------------------------------------------
  // AUDIT-05.1-07: Complete Geometry & Engine Provenance Fingerprinting
  // --------------------------------------------------------------------------
  describe('AUDIT-05.1-07: offsetDiagnostics & Sub-Engine Version Fingerprinting', () => {
    it('includes offsetDiagnostics in computePieceGeometryFingerprint and sub-engine versions in draftingConfigFingerprint/basePatternFingerprint while keeping buildTimestamp non-breaking', () => {
      const f = buildBaseFixture();
      const basePieceSnap = f.draftRev.patternPieces[0];
      const basePieceGeomFp = computePieceGeometryFingerprint(basePieceSnap);

      const alteredOffsetPieceSnap = {
        ...basePieceSnap,
        offsetDiagnostics: [
          {
            sourceSegmentId: 'seg-1',
            status: 'warning' as const,
            maxDeviationCm: 0.04,
            toleranceCm: 0.05,
            failureReason: 'Acute corner miter truncated'
          }
        ]
      };
      const alteredPieceGeomFp = computePieceGeometryFingerprint(alteredOffsetPieceSnap);
      assert.notEqual(alteredPieceGeomFp, basePieceGeomFp);

      // Sub-engine versions affect draftingConfigFingerprint and basePatternFingerprint
      const baseConfigFp = computeDraftingConfigFingerprint({
        draftingConfiguration: f.draftRev.draftingConfiguration,
        fabricSpecification: f.draftRev.fabricSpecification,
        engineProvenance: f.draftRev.engineProvenance
      });
      const alteredGradingVerFp = computeDraftingConfigFingerprint({
        draftingConfiguration: f.draftRev.draftingConfiguration,
        fabricSpecification: f.draftRev.fabricSpecification,
        engineProvenance: {
          ...f.draftRev.engineProvenance,
          gradingEngineVersion: '2.9.9-modified'
        }
      });
      assert.notEqual(alteredGradingVerFp, baseConfigFp);

      const alteredBaseFp = computeBasePatternContentFingerprint({
        ...f.draftRev,
        engineProvenance: {
          ...f.draftRev.engineProvenance,
          validationEngineVersion: '9.1.0-modified'
        }
      });
      assert.notEqual(alteredBaseFp, f.draftRev.basePatternFingerprint);

      // Distinct buildTimestamp alone preserves deterministic draftingConfigFingerprint
      const differentTimestampConfigFp = computeDraftingConfigFingerprint({
        draftingConfiguration: f.draftRev.draftingConfiguration,
        fabricSpecification: f.draftRev.fabricSpecification,
        engineProvenance: {
          ...f.draftRev.engineProvenance,
          buildTimestamp: '2099-01-01T00:00:00.000Z'
        }
      });
      assert.equal(differentTimestampConfigFp, baseConfigFp);
    });
  });
});
