/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
  createAuthoritativeGarmentSpecification,
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
  adaptLegacyPatternDraftToPatternRevision,
  approveAuthoritativeMeasurementSet,
  approvePatternRevision,
  archivePatternRevision,
  archiveProductionPackage,
  computeBasePatternContentFingerprint,
  computeDraftingConfigFingerprint,
  computeGeometryFingerprint,
  computeGradingArtifactContentFingerprint,
  computeProductionPackageManifestFingerprint,
  createAuthoritativeGradingArtifact,
  createAuthoritativeMeasurementSet,
  createAuthoritativeProductionPackage,
  createDraftPatternRevision,
  createProductionPatternRevision,
  evaluatePipelineDependencyIntegrity,
  evaluatePatternRevisionStaleness,
  invalidatePatternRevision,
  invalidateProductionPackage,
  mapLegacyStatusToAuthoritativeLifecycle,
  propagateUpstreamChangeToPatternRevisions,
  revokeAuthoritativeGradingArtifact,
  revokeProductionPackage,
  signPatternRevisionApprovalPayload,
  supersedeAuthoritativeGradingArtifact,
  supersedePatternRevision,
  supersedeProductionPackage,
  updateDraftPatternRevision,
  validatePatternRevision,
  verifyGradingArtifactIntegrity,
  verifyPatternRevisionLifecycleIntegrity,
  verifyProductionPackageIntegrity
} from './index';
import { DesignSpecification, PatternDraft } from '../../types';

// ============================================================================
// TEST FIXTURE HELPERS
// ============================================================================

const PROJECT_ID = 'project-patroner-m051';
const GARMENT_A_ID = 'garment-skirt-m051-a';
const GARMENT_B_ID = 'garment-skirt-m051-b';
const FIXED_TIMESTAMP = '2026-11-12T10:00:00.000Z';
const SIZE_M_MEASUREMENTS = STANDARD_SIZING_SYSTEM.sizes.M;

const ISSUER_URL = 'https://idp.patroner.atelier';
const AUDIENCE = 'patroner-production-engine';
const OIDC_KEY_ID = 'oidc-kid-m051-01';
const OIDC_SEED = 'm051-oidc-issuer-ed25519-seed-material-01';

const CRYPTO_KEY_ID = 'ed25519-principal-key-m051-01';
const CRYPTO_SEED = 'm051-principal-ed25519-seed-material-01';

function buildAuthInfrastructure() {
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

  const cryptoKey = deriveEd25519SigningKeyPair(CRYPTO_KEY_ID, CRYPTO_SEED, {
    ownerPrincipal: 'Elena Vance (Principal Pattern Engineer)',
    tenantId: PROJECT_ID,
    allowedScopes: ['specification:approve']
  });
  let registry = createControlledPublicKeyRegistry();
  registry = registerPublicKeyInRegistry(registry, cryptoKey.publicKeyRegistration);
  const cryptographicVerifier = createTrustedCryptographicVerifier({
    publicKeyRegistry: Object.values(registry.entries)
  });

  return {
    publicJwk,
    replayStore,
    identityVerifier,
    cryptoKey,
    cryptographicVerifier
  };
}

function buildApprovedSpecAndMeasurements(garmentId: string = GARMENT_A_ID, lengthCm: number = 64) {
  const auth = buildAuthInfrastructure();
  const baseDesign: DesignSpecification = {
    id: garmentId,
    name: `Tailored Pencil Skirt (${garmentId})`,
    garmentCategory: 'skirt',
    silhouette: 'pencil',
    fabric: ENHANCED_PRESET_FABRICS[0],
    color: { name: 'Atelier Charcoal', hex: '#1E293B' },
    easeProfile: 'classic',
    lengthCm,
    prompt: 'Classic tailored pencil skirt',
    constructionFeatures: [],
    designNotes: [],
    isApproved: false,
    version: 1,
    specificationRevisionId: `spec-${garmentId}-v1`
  };

  const draftSpec = createAuthoritativeGarmentSpecification({
    projectId: PROJECT_ID,
    garmentId,
    specificationRevisionId: `spec-${garmentId}-v1`,
    version: 1,
    name: baseDesign.name,
    garmentCategory: baseDesign.garmentCategory,
    silhouette: baseDesign.silhouette,
    fabric: baseDesign.fabric,
    color: baseDesign.color,
    easeProfile: baseDesign.easeProfile,
    lengthCm: baseDesign.lengthCm,
    prompt: baseDesign.prompt,
    constructionFeatures: baseDesign.constructionFeatures,
    designNotes: baseDesign.designNotes,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    fabricProvenance: 'supplier-declared'
  });

  const draftSpecFp = computeSpecificationFingerprint(draftSpec);

  const specSig = signSpecificationApprovalPayload(
    {
      schemaVersion: draftSpec.schemaVersion ?? '1.0.0-m04.6.1.3',
      projectId: PROJECT_ID,
      garmentId,
      specificationRevisionId: draftSpec.specificationRevisionId ?? `spec-${garmentId}-v1`,
      specificationVersion: draftSpec.version,
      canonicalSpecificationFingerprint: draftSpecFp,
      approvalEventId: `spec-app-evt-${garmentId}-v1`,
      approverPrincipal: 'Elena Vance (Principal Pattern Engineer)',
      authorityTier: 'cryptographic_principal',
      approvalTimestamp: FIXED_TIMESTAMP
    },
    {
      keyId: CRYPTO_KEY_ID,
      privateKeyHex: auth.cryptoKey.privateKeyHex,
      tenantId: PROJECT_ID
    }
  );

  const approvedSpec = approveAuthoritativeGarmentSpecification(
    draftSpec,
    'Elena Vance (Principal Pattern Engineer)',
    {
      approvedAt: FIXED_TIMESTAMP,
      approvalEventId: `spec-app-evt-${garmentId}-v1`,
      authorityTier: 'cryptographic_principal',
      cryptographicVerifier: auth.cryptographicVerifier,
      cryptographicSignature: specSig
    }
  );

  const unapprovedMeas = createAuthoritativeMeasurementSet({
    measurementSetId: `meas-${garmentId}-m-v1`,
    revisionId: `meas-rev-${garmentId}-m-v1`,
    values: ({ ...SIZE_M_MEASUREMENTS } as unknown) as Record<string, number>,
    provenance: 'physically-measured',
    evidence: {
      operatorName: 'Marco Rossi (Master Tailor)',
      measurementSource: 'physical-tape-measure',
      recordedAt: FIXED_TIMESTAMP
    },
    recordedAt: FIXED_TIMESTAMP
  });

  const approvedMeas = approveAuthoritativeMeasurementSet(unapprovedMeas, {
    approvingAuthority: 'Marco Rossi (Master Tailor)',
    approvedAt: FIXED_TIMESTAMP,
    notes: ['Verified on physical dress form.']
  });

  const designSpecForDrafting: DesignSpecification = {
    ...baseDesign,
    isApproved: true,
    approvedBy: approvedSpec.approvedBy,
    approvedAt: approvedSpec.approvedAt,
    specificationRevisionId: approvedSpec.specificationRevisionId
  };

  const pieces = draftSkirtBlock(SIZE_M_MEASUREMENTS, designSpecForDrafting);
  const validationReport = validatePatternDraft(pieces);
  const enhancedLookup = getEnhancedFabricById(ENHANCED_PRESET_FABRICS[0].id);
  const enhancedFabric = enhancedLookup.status === 'found' ? enhancedLookup.fabric : undefined;

  return {
    auth,
    approvedSpec,
    approvedMeas,
    designSpecForDrafting,
    pieces,
    validationReport,
    enhancedFabric
  };
}

// ============================================================================
// MILESTONE 05.1 TEST SUITE
// ============================================================================

describe('Milestone 05.1 — Authoritative Pattern Lifecycle & Production Package Foundation', () => {
  // --------------------------------------------------------------------------
  // 1. AMENDMENT 1: ACYCLIC FINGERPRINT HIERARCHY
  // --------------------------------------------------------------------------
  describe('Amendment 1: Acyclic Fingerprint Separation & Independent Verification', () => {
    it('separates geometryFingerprint, draftingConfigFingerprint, basePatternFingerprint, gradingArtifactFingerprint, and manifestFingerprint without circularity', () => {
      const { approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      // Create revision WITHOUT gradingSummary
      const revWithoutGrading = createDraftPatternRevision({
        revisionId: 'pat-rev-acyclic-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });

      // Create identical revision WITH downstream gradingSummary attached
      const revWithGrading = createDraftPatternRevision({
        revisionId: 'pat-rev-acyclic-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset',
        gradingSummary: {
          gradingRuleId: 'custom-grading-v99',
          gradedSizes: ['XS', 'S', 'M', 'L', 'XL'],
          isValid: true
        }
      });

      // Base pattern content fingerprint MUST NOT depend on downstream grading data (Amendment 1)
      assert.equal(revWithoutGrading.geometryFingerprint, revWithGrading.geometryFingerprint);
      assert.equal(revWithoutGrading.draftingConfigFingerprint, revWithGrading.draftingConfigFingerprint);
      assert.equal(revWithoutGrading.basePatternFingerprint, revWithGrading.basePatternFingerprint);
      assert.equal(revWithoutGrading.contentFingerprint, revWithGrading.contentFingerprint);

      // Verify all fingerprints are distinct 64-hex SHA-256 digests
      assert.match(revWithoutGrading.geometryFingerprint!, /^[0-9a-f]{64}$/);
      assert.match(revWithoutGrading.draftingConfigFingerprint!, /^[0-9a-f]{64}$/);
      assert.match(revWithoutGrading.basePatternFingerprint!, /^[0-9a-f]{64}$/);
      assert.notEqual(revWithoutGrading.geometryFingerprint, revWithoutGrading.basePatternFingerprint);
      assert.notEqual(revWithoutGrading.draftingConfigFingerprint, revWithoutGrading.basePatternFingerprint);

      // Downstream grading artifact binds upstream to basePatternFingerprint
      const gradedSet = gradePattern(designSpecForDrafting);
      const gradingArtifact = createAuthoritativeGradingArtifact({
        projectId: PROJECT_ID,
        tenantId: PROJECT_ID,
        sourceSpecificationId: GARMENT_A_ID,
        sourceSpecificationRevisionId: approvedSpec.specificationRevisionId,
        sourceSpecificationFingerprint: approvedSpec.approvedContentFingerprint!,
        sourcePatternRevisionId: revWithoutGrading.revisionId,
        sourceBasePatternFingerprint: revWithoutGrading.basePatternFingerprint,
        sourceMeasurementSetId: approvedMeas.measurementSetId,
        sourceMeasurementSetFingerprint: approvedMeas.canonicalFingerprint,
        baseSize: 'M',
        sizeRange: [...DEFAULT_SIZE_RANGE],
        gradedPatternSet: gradedSet,
        basePatternPieces: pieces,
        createdAt: FIXED_TIMESTAMP
      });

      assert.equal(gradingArtifact.sourceBasePatternFingerprint, revWithoutGrading.basePatternFingerprint);
      assert.match(gradingArtifact.contentFingerprint!, /^[0-9a-f]{64}$/);
      assert.notEqual(gradingArtifact.contentFingerprint, revWithoutGrading.basePatternFingerprint);

      // Both verify independently
      const revCheck = verifyPatternRevisionLifecycleIntegrity(revWithoutGrading);
      assert.equal(revCheck.isValid, true);
      const gaCheck = verifyGradingArtifactIntegrity(gradingArtifact);
      assert.equal(gaCheck.isValid, true);
    });

    it('recomputes geometryFingerprint, draftingConfigFingerprint, and basePatternFingerprint deterministically across invocations', () => {
      const { approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      const rev1 = createDraftPatternRevision({
        revisionId: 'pat-rev-det-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });

      const rev2 = createDraftPatternRevision({
        revisionId: 'pat-rev-det-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });

      assert.equal(rev1.geometryFingerprint, rev2.geometryFingerprint);
      assert.equal(rev1.draftingConfigFingerprint, rev2.draftingConfigFingerprint);
      assert.equal(rev1.basePatternFingerprint, rev2.basePatternFingerprint);
      assert.equal(computeGeometryFingerprint(rev1.patternPieces), rev1.geometryFingerprint);
      assert.equal(
        computeDraftingConfigFingerprint({
          draftingConfiguration: rev1.draftingConfiguration,
          fabricSpecification: rev1.fabricSpecification,
          engineProvenance: rev1.engineProvenance
        }),
        rev1.draftingConfigFingerprint
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. AMENDMENT 2: SEPARATION OF CONTENT INTEGRITY FROM LIFECYCLE INTEGRITY
  // --------------------------------------------------------------------------
  describe('Amendment 2: Content Integrity vs. Append-Only Lifecycle Integrity', () => {
    it('preserves immutable contentFingerprint (basePatternFingerprint) across draft -> validated -> approved -> superseded -> archived transitions', () => {
      const { auth, approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      const draftRev = createDraftPatternRevision({
        revisionId: 'pat-rev-lifecycle-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });

      const originalContentFp = draftRev.contentFingerprint!;
      const originalBasePatternFp = draftRev.basePatternFingerprint!;
      const originalGeomFp = draftRev.geometryFingerprint!;
      assert.equal(originalContentFp, originalBasePatternFp);
      assert.equal(draftRev.currentLifecycleState, 'draft');
      assert.equal(draftRev.lifecycleHistory?.length, 1);

      // Transition 1: draft -> validated
      const validatedRev = validatePatternRevision(draftRev, {
        actorId: 'qa-validator-01',
        validatedAt: '2026-11-12T10:05:00.000Z'
      });
      assert.equal(validatedRev.currentLifecycleState, 'validated');
      assert.equal(validatedRev.contentFingerprint, originalContentFp);
      assert.equal(validatedRev.basePatternFingerprint, originalBasePatternFp);
      assert.equal(validatedRev.geometryFingerprint, originalGeomFp);
      assert.equal(validatedRev.lifecycleHistory?.length, 2);
      assert.notEqual(validatedRev.currentStateFingerprint, draftRev.currentStateFingerprint);

      // Transition 2: validated -> approved (Tier 4 Ed25519 signature)
      const approvalSig = signPatternRevisionApprovalPayload(
        {
          schemaVersion: 'm05.1-pattern-approval-v1',
          projectId: PROJECT_ID,
          tenantId: PROJECT_ID,
          garmentId: GARMENT_A_ID,
          patternRevisionId: validatedRev.revisionId,
          patternRevisionNumber: validatedRev.revisionIndex,
          basePatternFingerprint: originalBasePatternFp,
          geometryFingerprint: originalGeomFp,
          sourceSpecificationFingerprint: approvedSpec.approvedContentFingerprint!,
          sourceMeasurementSetFingerprint: approvedMeas.canonicalFingerprint,
          approvalEventId: 'pat-app-evt-01',
          approverPrincipal: 'Elena Vance (Principal Pattern Engineer)',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'pattern:approve',
          approvalTimestamp: '2026-11-12T10:10:00.000Z'
        },
        {
          keyId: CRYPTO_KEY_ID,
          privateKeyHex: auth.cryptoKey.privateKeyHex,
          tenantId: PROJECT_ID
        }
      );

      const approvedRev = approvePatternRevision(validatedRev, {
        approverName: 'Elena Vance (Principal Pattern Engineer)',
        approvedAt: '2026-11-12T10:10:00.000Z',
        approvalEventId: 'pat-app-evt-01',
        authorityTier: 'cryptographic_principal',
        sourceSpecification: approvedSpec,
        sourceMeasurementSet: approvedMeas,
        cryptographicVerifier: auth.cryptographicVerifier,
        cryptographicSignature: approvalSig
      });

      assert.equal(approvedRev.currentLifecycleState, 'approved');
      assert.equal(approvedRev.contentFingerprint, originalContentFp);
      assert.equal(approvedRev.basePatternFingerprint, originalBasePatternFp);
      assert.equal(approvedRev.lifecycleHistory?.length, 3);

      // Transition 3: approved -> superseded
      const supersededRev = supersedePatternRevision(approvedRev, {
        supersededByRevisionId: 'pat-rev-lifecycle-2',
        timestamp: '2026-11-12T10:15:00.000Z'
      });
      assert.equal(supersededRev.currentLifecycleState, 'superseded');
      assert.equal(supersededRev.contentFingerprint, originalContentFp);
      assert.equal(supersededRev.basePatternFingerprint, originalBasePatternFp);
      assert.equal(supersededRev.lifecycleHistory?.length, 4);

      // Transition 4: superseded -> archived
      const archivedRev = archivePatternRevision(supersededRev, {
        archivedAt: '2026-11-12T10:20:00.000Z'
      });
      assert.equal(archivedRev.currentLifecycleState, 'archived');
      assert.equal(archivedRev.contentFingerprint, originalContentFp);
      assert.equal(archivedRev.basePatternFingerprint, originalBasePatternFp);
      assert.equal(archivedRev.lifecycleHistory?.length, 5);
      assert.equal(archivedRev.isProductionReady, false);

      // Full hash-chained lifecycle history passes independent verification
      const integrity = verifyPatternRevisionLifecycleIntegrity(archivedRev);
      assert.equal(integrity.isValid, true);
      assert.equal(integrity.isContentTampered, false);
      assert.equal(integrity.isLifecycleTampered, false);
      assert.equal(integrity.derivedLifecycleState, 'archived');
    });

    it('detects tampering in append-only lifecycleHistory or contentFingerprint', () => {
      const { approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      const draftRev = createDraftPatternRevision({
        revisionId: 'pat-rev-tamper-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });

      const validatedRev = validatePatternRevision(draftRev, {
        validatedAt: '2026-11-12T10:05:00.000Z'
      });

      // Tamper 1: Spoof currentLifecycleState to 'approved' without a valid lifecycle event
      const spoofedStateRev = {
        ...validatedRev,
        currentLifecycleState: 'approved' as const
      };
      const check1 = verifyPatternRevisionLifecycleIntegrity(spoofedStateRev);
      assert.equal(check1.isValid, false);
      assert.equal(check1.isLifecycleTampered, true);

      // Tamper 2: Break hash chain in lifecycleHistory
      const brokenChainHistory = [
        validatedRev.lifecycleHistory![0],
        {
          ...validatedRev.lifecycleHistory![1],
          previousEventFingerprint: '0'.repeat(64)
        }
      ];
      const brokenChainRev = {
        ...validatedRev,
        lifecycleHistory: brokenChainHistory
      };
      const check2 = verifyPatternRevisionLifecycleIntegrity(brokenChainRev);
      assert.equal(check2.isValid, false);
      assert.equal(check2.isLifecycleTampered, true);

      // Tamper 3: Mutate piece geometry while keeping old basePatternFingerprint
      const mutatedPieces = validatedRev.patternPieces.map((p, idx) =>
        idx === 0 ? { ...p, seamAllowanceWidthCm: p.seamAllowanceWidthCm + 2.5 } : p
      );
      const tamperedContentRev = {
        ...validatedRev,
        patternPieces: mutatedPieces
      };
      const check3 = verifyPatternRevisionLifecycleIntegrity(tamperedContentRev);
      assert.equal(check3.isValid, false);
      assert.equal(check3.isContentTampered, true);
    });

    it('preserves gradingArtifact.contentFingerprint across supersession and revocation', () => {
      const { approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      const rev = createDraftPatternRevision({
        revisionId: 'pat-rev-ga-content-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });

      const gradedSet = gradePattern(designSpecForDrafting);
      const ga = createAuthoritativeGradingArtifact({
        projectId: PROJECT_ID,
        tenantId: PROJECT_ID,
        sourceSpecificationId: GARMENT_A_ID,
        sourceSpecificationRevisionId: approvedSpec.specificationRevisionId,
        sourceSpecificationFingerprint: approvedSpec.approvedContentFingerprint!,
        sourcePatternRevisionId: rev.revisionId,
        sourceBasePatternFingerprint: rev.basePatternFingerprint,
        sourceMeasurementSetId: approvedMeas.measurementSetId,
        sourceMeasurementSetFingerprint: approvedMeas.canonicalFingerprint,
        baseSize: 'M',
        sizeRange: [...DEFAULT_SIZE_RANGE],
        gradedPatternSet: gradedSet,
        basePatternPieces: pieces,
        createdAt: FIXED_TIMESTAMP
      });

      const originalGradingContentFp = ga.contentFingerprint!;
      const supersededGa = supersedeAuthoritativeGradingArtifact(ga, 'grade-rev-2');
      const revokedGa = revokeAuthoritativeGradingArtifact(ga, 'Rule table updated', FIXED_TIMESTAMP);

      assert.equal(supersededGa.contentFingerprint, originalGradingContentFp);
      assert.equal(revokedGa.contentFingerprint, originalGradingContentFp);
      assert.equal(computeGradingArtifactContentFingerprint(supersededGa), originalGradingContentFp);
      assert.equal(computeGradingArtifactContentFingerprint(revokedGa), originalGradingContentFp);
    });
  });

  // --------------------------------------------------------------------------
  // 3. AMENDMENT 3: REAL AUTHORIZATION AVAILABILITY & TARGET BINDING
  // --------------------------------------------------------------------------
  describe('Amendment 3: Real Tier 3 & Tier 4 Authorization Availability & Target Binding', () => {
    it('approves a validated pattern revision with a real Tier 3 OIDC/JWT credential bound to revisionId and basePatternFingerprint, and blocks replay', () => {
      const { auth, approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      const draftRev = createDraftPatternRevision({
        revisionId: 'pat-rev-tier3-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });
      const validatedRev = validatePatternRevision(draftRev, { validatedAt: FIXED_TIMESTAMP });

      const jwtCredential = issueVerifiableIdentityCredential(
        {
          issuer: ISSUER_URL,
          subjectId: 'designer-claire-01',
          displayName: 'Claire Moreau (Lead Pattern Designer)',
          audience: AUDIENCE,
          tenantId: PROJECT_ID,
          keyId: OIDC_KEY_ID,
          jti: 'jti-pattern-app-001',
          issuedAt: '2026-11-12T09:55:00.000Z',
          notBefore: '2026-11-12T09:55:00.000Z',
          expiresAt: '2026-11-12T11:00:00.000Z',
          claims: ['specification:approve', 'role:lead-designer'],
          specificationId: GARMENT_A_ID,
          targetRevisionId: validatedRev.revisionId,
          targetSpecificationFingerprint: validatedRev.contentFingerprint!
        },
        OIDC_SEED
      );

      const approvedRev = approvePatternRevision(validatedRev, {
        approverName: 'Claire Moreau (Lead Pattern Designer)',
        approvedAt: FIXED_TIMESTAMP,
        authorityTier: 'authenticated_designer',
        sourceSpecification: approvedSpec,
        sourceMeasurementSet: approvedMeas,
        identityVerifier: auth.identityVerifier,
        identityCredential: jwtCredential
      });

      assert.equal(approvedRev.currentLifecycleState, 'approved');
      assert.equal(approvedRev.patternApprovalRecord?.authorityTier, 'authenticated_designer');
      assert.equal(approvedRev.patternApprovalRecord?.isApprovalAuthenticated, true);
      assert.equal(approvedRev.patternApprovalRecord?.boundBasePatternFingerprint, validatedRev.contentFingerprint);

      // Replay attempt with the same JTI on another pattern revision MUST fail closed
      const draftRev2 = createDraftPatternRevision({
        revisionId: 'pat-rev-tier3-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });
      const validatedRev2 = validatePatternRevision(draftRev2, { validatedAt: FIXED_TIMESTAMP });

      assert.throws(
        () =>
          approvePatternRevision(validatedRev2, {
            approverName: 'Claire Moreau (Lead Pattern Designer)',
            approvedAt: FIXED_TIMESTAMP,
            authorityTier: 'authenticated_designer',
            sourceSpecification: approvedSpec,
            sourceMeasurementSet: approvedMeas,
            identityVerifier: auth.identityVerifier,
            identityCredential: jwtCredential
          }),
        /Replay detected/i
      );
    });

    it('fails closed when identityVerifier, replayStore, cryptographicVerifier, or target binding is missing or mismatched', () => {
      const { auth, approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      const draftRev = createDraftPatternRevision({
        revisionId: 'pat-rev-failclosed-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });
      const validatedRev = validatePatternRevision(draftRev, { validatedAt: FIXED_TIMESTAMP });

      // 1. Missing identityVerifier for Tier 3
      assert.throws(
        () =>
          approvePatternRevision(validatedRev, {
            approverName: 'Claire Moreau',
            approvedAt: FIXED_TIMESTAMP,
            authorityTier: 'authenticated_designer'
          }),
        /requires an active TrustedIdentityVerifier/i
      );

      // 2. Missing cryptographicVerifier for Tier 4
      assert.throws(
        () =>
          approvePatternRevision(validatedRev, {
            approverName: 'Elena Vance',
            approvedAt: FIXED_TIMESTAMP,
            authorityTier: 'cryptographic_principal'
          }),
        /requires an active TrustedCryptographicVerifier/i
      );

      // 3. Mismatched target fingerprint in Tier 3 JWT
      const wrongFpCredential = issueVerifiableIdentityCredential(
        {
          issuer: ISSUER_URL,
          subjectId: 'designer-claire-01',
          displayName: 'Claire Moreau',
          audience: AUDIENCE,
          tenantId: PROJECT_ID,
          keyId: OIDC_KEY_ID,
          jti: 'jti-wrong-fp-001',
          issuedAt: '2026-11-12T09:55:00.000Z',
          notBefore: '2026-11-12T09:55:00.000Z',
          expiresAt: '2026-11-12T11:00:00.000Z',
          claims: ['specification:approve'],
          specificationId: GARMENT_A_ID,
          targetRevisionId: validatedRev.revisionId,
          targetSpecificationFingerprint: 'f'.repeat(64) // Wrong fingerprint
        },
        OIDC_SEED
      );

      assert.throws(
        () =>
          approvePatternRevision(validatedRev, {
            approverName: 'Claire Moreau',
            approvedAt: FIXED_TIMESTAMP,
            authorityTier: 'authenticated_designer',
            identityVerifier: auth.identityVerifier,
            identityCredential: wrongFpCredential
          }),
        /targetSpecificationFingerprint mismatch/i
      );

      // 4. Attempting to approve a 'draft' revision (skipping 'validated')
      assert.throws(
        () =>
          approvePatternRevision(draftRev, {
            approverName: 'Elena Vance',
            approvedAt: FIXED_TIMESTAMP,
            authorityTier: 'cryptographic_principal',
            cryptographicVerifier: auth.cryptographicVerifier
          }),
        /must be in 'validated' state before approval/i
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. AMENDMENT 4: GRADING-ONLY INVALIDATION SEMANTICS & SCOPED INVALIDATION
  // --------------------------------------------------------------------------
  describe('Amendment 4: Grading-Only Invalidation Semantics & Scoped Garment Invalidation', () => {
    it('invalidates grading artifacts and multi-size packages on grading rule change while preserving base-size pattern revisions and single-size packages', () => {
      const { auth, approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements(GARMENT_A_ID);

      // Create & approve base-size pattern revision
      const draftRev = createDraftPatternRevision({
        revisionId: 'pat-rev-grade-scope-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });
      const validatedRev = validatePatternRevision(draftRev, { validatedAt: FIXED_TIMESTAMP });

      const sig = signPatternRevisionApprovalPayload(
        {
          schemaVersion: 'm05.1-pattern-approval-v1',
          projectId: PROJECT_ID,
          tenantId: PROJECT_ID,
          garmentId: GARMENT_A_ID,
          patternRevisionId: validatedRev.revisionId,
          patternRevisionNumber: validatedRev.revisionIndex,
          basePatternFingerprint: validatedRev.basePatternFingerprint!,
          geometryFingerprint: validatedRev.geometryFingerprint!,
          sourceSpecificationFingerprint: approvedSpec.approvedContentFingerprint!,
          sourceMeasurementSetFingerprint: approvedMeas.canonicalFingerprint,
          approvalEventId: 'pat-app-grade-scope-01',
          approverPrincipal: 'Elena Vance (Principal Pattern Engineer)',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'pattern:approve',
          approvalTimestamp: FIXED_TIMESTAMP
        },
        {
          keyId: CRYPTO_KEY_ID,
          privateKeyHex: auth.cryptoKey.privateKeyHex,
          tenantId: PROJECT_ID
        }
      );

      const approvedRev = approvePatternRevision(validatedRev, {
        approverName: 'Elena Vance (Principal Pattern Engineer)',
        approvedAt: FIXED_TIMESTAMP,
        approvalEventId: 'pat-app-grade-scope-01',
        authorityTier: 'cryptographic_principal',
        sourceSpecification: approvedSpec,
        sourceMeasurementSet: approvedMeas,
        cryptographicVerifier: auth.cryptographicVerifier,
        cryptographicSignature: sig
      });

      const gradedSet = gradePattern(designSpecForDrafting);
      const gradingArtifact = createAuthoritativeGradingArtifact({
        projectId: PROJECT_ID,
        tenantId: PROJECT_ID,
        sourceSpecificationId: GARMENT_A_ID,
        sourceSpecificationRevisionId: approvedSpec.specificationRevisionId,
        sourceSpecificationFingerprint: approvedSpec.approvedContentFingerprint!,
        sourcePatternRevisionId: approvedRev.revisionId,
        sourceBasePatternFingerprint: approvedRev.basePatternFingerprint,
        sourceMeasurementSetId: approvedMeas.measurementSetId,
        sourceMeasurementSetFingerprint: approvedMeas.canonicalFingerprint,
        gradingRuleSetRevision: 'iso8559-standard',
        baseSize: 'M',
        sizeRange: [...DEFAULT_SIZE_RANGE],
        gradedPatternSet: gradedSet,
        basePatternPieces: pieces,
        createdAt: FIXED_TIMESTAMP
      });

      // Create both a multi-size graded package and a single-size base package
      const multiSizePkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-multi-size-01',
        projectId: PROJECT_ID,
        createdAt: FIXED_TIMESTAMP,
        patternRevision: approvedRev,
        specification: approvedSpec,
        measurementSet: approvedMeas,
        gradingArtifact,
        exportGradingPolicy: {
          mode: 'graded-multi-size',
          requiredSizes: [...DEFAULT_SIZE_RANGE]
        },
        specificationVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier
        },
        patternApprovalVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier,
          cryptographicSignature: sig
        }
      });
      assert.equal(multiSizePkgRes.isPackageCreated, true);

      const singleSizePkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-single-size-01',
        projectId: PROJECT_ID,
        createdAt: FIXED_TIMESTAMP,
        patternRevision: approvedRev,
        specification: approvedSpec,
        measurementSet: approvedMeas,
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'Bespoke base-size M atelier toile cut only.'
        },
        specificationVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier
        },
        patternApprovalVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier,
          cryptographicSignature: sig
        }
      });
      assert.equal(singleSizePkgRes.isPackageCreated, true);

      // Propagate a grading-only rule change
      const propagation = propagateUpstreamChangeToPatternRevisions({
        patternRevisions: [approvedRev],
        gradingArtifacts: [gradingArtifact],
        productionPackages: [multiSizePkgRes.package!, singleSizePkgRes.package!],
        activeUpstream: {
          garmentId: GARMENT_A_ID,
          specification: approvedSpec,
          measurementSet: approvedMeas,
          gradingRuleSetRevision: 'iso8559-petite-v2'
        },
        invalidatedAt: '2026-11-12T11:00:00.000Z'
      });

      // Base-size pattern revision MUST NOT be invalidated by grading rule change (Amendment 4)
      assert.deepEqual(propagation.invalidatedRevisionIds, []);
      assert.deepEqual(propagation.preservedRevisionIds, [approvedRev.revisionId]);
      assert.equal(propagation.updatedPatternRevisions[0].currentLifecycleState, 'approved');

      // Grading artifact MUST be invalidated
      assert.deepEqual(propagation.invalidatedGradingArtifactIds, [gradingArtifact.gradingArtifactId]);
      assert.equal(propagation.updatedGradingArtifacts[0].lifecycleState, 'revoked');

      // Multi-size package MUST be invalidated, while single-size base package MUST be preserved
      assert.deepEqual(propagation.invalidatedPackageIds, ['pkg-multi-size-01']);
      assert.deepEqual(propagation.preservedPackageIds, ['pkg-single-size-01']);
      assert.equal(propagation.updatedProductionPackages[0].currentPackageState, 'invalidated');
      assert.equal(propagation.updatedProductionPackages[1].currentPackageState, 'active');

      // Also verify evaluatePipelineDependencyIntegrity does not mark art-production-snapshot stale on grading-only rule change
      const pipelineReport = evaluatePipelineDependencyIntegrity({
        specification: approvedSpec,
        measurements: SIZE_M_MEASUREMENTS,
        measurementSet: approvedMeas,
        measurementApprovalState: 'approved',
        measurementProvenance: 'physically-measured',
        isMeasurementApproved: true,
        activeSize: 'M',
        fabric: enhancedFabric,
        patternPieces: pieces,
        validationReport,
        productionSnapshot: approvedRev,
        gradingArtifact,
        gradingRulesVersion: 'iso8559-petite-v2', // Changed grading rules version!
        verificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier
        }
      });

      assert.equal(pipelineReport.artifacts.grading.status, 'stale');
      assert.equal(pipelineReport.artifacts['production-snapshot'].status, 'current');
    });

    it('scopes upstream specification/measurement invalidation strictly to dependent revisions of the affected garment', () => {
      const fixtureA = buildApprovedSpecAndMeasurements(GARMENT_A_ID, 64);
      const fixtureB = buildApprovedSpecAndMeasurements(GARMENT_B_ID, 70);

      const revA = validatePatternRevision(
        createDraftPatternRevision({
          revisionId: 'pat-rev-garment-a-1',
          revisionNumber: 1,
          projectId: PROJECT_ID,
          garmentId: GARMENT_A_ID,
          createdAt: FIXED_TIMESTAMP,
          designSpec: fixtureA.designSpecForDrafting,
          authoritativeSpec: fixtureA.approvedSpec,
          authoritativeMeasurementSet: fixtureA.approvedMeas,
          pieces: fixtureA.pieces,
          validationReport: fixtureA.validationReport,
          enhancedFabric: fixtureA.enhancedFabric,
          fabricSource: 'verified-preset'
        }),
        { validatedAt: FIXED_TIMESTAMP }
      );

      const revB = validatePatternRevision(
        createDraftPatternRevision({
          revisionId: 'pat-rev-garment-b-1',
          revisionNumber: 1,
          projectId: PROJECT_ID,
          garmentId: GARMENT_B_ID,
          createdAt: FIXED_TIMESTAMP,
          designSpec: fixtureB.designSpecForDrafting,
          authoritativeSpec: fixtureB.approvedSpec,
          authoritativeMeasurementSet: fixtureB.approvedMeas,
          pieces: fixtureB.pieces,
          validationReport: fixtureB.validationReport,
          enhancedFabric: fixtureB.enhancedFabric,
          fabricSource: 'verified-preset'
        }),
        { validatedAt: FIXED_TIMESTAMP }
      );

      // Update Garment A specification (length changed from 64 -> 78)
      const updatedFixtureA = buildApprovedSpecAndMeasurements(GARMENT_A_ID, 78);

      const propagation = propagateUpstreamChangeToPatternRevisions({
        patternRevisions: [revA, revB],
        activeUpstream: {
          garmentId: GARMENT_A_ID,
          specification: updatedFixtureA.approvedSpec
        },
        invalidatedAt: '2026-11-12T12:00:00.000Z'
      });

      // Only Garment A revision is invalidated; Garment B revision is untouched
      assert.deepEqual(propagation.invalidatedRevisionIds, ['pat-rev-garment-a-1']);
      assert.deepEqual(propagation.preservedRevisionIds, ['pat-rev-garment-b-1']);
      assert.equal(propagation.updatedPatternRevisions[0].currentLifecycleState, 'invalidated');
      assert.equal(propagation.updatedPatternRevisions[0].invalidationRecords?.[0]?.cause, 'specification_changed');
      assert.equal(propagation.updatedPatternRevisions[1].currentLifecycleState, 'validated');
    });
  });

  // --------------------------------------------------------------------------
  // 5. AMENDMENT 5: EXPLICIT LEGACY PATTERN DRAFT COMPATIBILITY ADAPTER
  // --------------------------------------------------------------------------
  describe('Amendment 5: Explicit Legacy PatternDraft Compatibility Adapter', () => {
    it('rejects unsafe approval and readiness mappings from legacy PatternDraft statuses (graded, production-ready, approved, isProductionReady: true)', () => {
      const { approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      const unsafeStatuses: Array<'graded' | 'production-ready' | 'approved'> = [
        'graded',
        'production-ready',
        'approved'
      ];

      for (const legacyStatus of unsafeStatuses) {
        const legacyDraft: PatternDraft & { status?: string; isProductionReady?: boolean } = {
          id: `draft-legacy-${legacyStatus}`,
          designSpecId: designSpecForDrafting.id,
          designName: designSpecForDrafting.name,
          garmentCategory: designSpecForDrafting.garmentCategory,
          createdAt: FIXED_TIMESTAMP,
          version: 1,
          sizeLabel: 'M',
          bodyMeasurements: SIZE_M_MEASUREMENTS,
          appliedEaseCm: { waist: 2, hip: 3 },
          finishedGarmentMeasurements: {
            waistCircumferenceCm: SIZE_M_MEASUREMENTS.waist + 2,
            hipCircumferenceCm: SIZE_M_MEASUREMENTS.lowHip + 3,
            totalLengthCm: designSpecForDrafting.lengthCm
          },
          pieces,
          validation: validationReport,
          status: legacyStatus,
          isProductionReady: true
        };

        const adapted = adaptLegacyPatternDraftToPatternRevision(legacyDraft, {
          revisionId: `pat-rev-legacy-${legacyStatus}`,
          revisionNumber: 1,
          projectId: PROJECT_ID,
          garmentId: GARMENT_A_ID,
          createdAt: FIXED_TIMESTAMP,
          designSpec: designSpecForDrafting,
          authoritativeSpec: approvedSpec,
          authoritativeMeasurementSet: approvedMeas,
          enhancedFabric,
          fabricSource: 'verified-preset'
        });

        // Must NEVER map to 'approved' or grant production authorization
        assert.equal(adapted.isAuthoritativeApprovalGranted, false);
        assert.equal(adapted.isProductionAuthorized, false);
        assert.equal(adapted.patternRevision.currentLifecycleState, 'validated');
        assert.notEqual(adapted.patternRevision.currentLifecycleState, 'approved');
        assert.equal(adapted.patternRevision.isProductionReady, false);
        assert.ok(adapted.rejectedUnsafeElevationClaims.length >= 2);
      }

      // If validation failed, legacy 'production-ready' maps only to 'draft'
      const invalidMapping = mapLegacyStatusToAuthoritativeLifecycle('production-ready', {
        hasPassingValidationReport: false,
        legacyIsProductionReadyFlag: true
      });
      assert.equal(invalidMapping.mappedLifecycleState, 'draft');
      assert.equal(invalidMapping.isAuthoritativeApprovalGranted, false);
      assert.equal(invalidMapping.isProductionAuthorized, false);
    });
  });

  // --------------------------------------------------------------------------
  // 6. AMENDMENT 2, 3, 6 & SECTION 8: AUTHORITATIVE PRODUCTION PACKAGE
  // --------------------------------------------------------------------------
  describe('Section 8 & Amendments 2, 3, 6: AuthoritativeProductionPackage Creation, Manifest Immutability & Fail-Closed Gates', () => {
    it('creates a trace-complete AuthoritativeProductionPackage and preserves manifestFingerprint across package lifecycle transitions', () => {
      const { auth, approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      const draftRev = createDraftPatternRevision({
        revisionId: 'pat-rev-pkg-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });
      const validatedRev = validatePatternRevision(draftRev, { validatedAt: FIXED_TIMESTAMP });

      const sig = signPatternRevisionApprovalPayload(
        {
          schemaVersion: 'm05.1-pattern-approval-v1',
          projectId: PROJECT_ID,
          tenantId: PROJECT_ID,
          garmentId: GARMENT_A_ID,
          patternRevisionId: validatedRev.revisionId,
          patternRevisionNumber: validatedRev.revisionIndex,
          basePatternFingerprint: validatedRev.basePatternFingerprint!,
          geometryFingerprint: validatedRev.geometryFingerprint!,
          sourceSpecificationFingerprint: approvedSpec.approvedContentFingerprint!,
          sourceMeasurementSetFingerprint: approvedMeas.canonicalFingerprint,
          approvalEventId: 'pat-app-pkg-01',
          approverPrincipal: 'Elena Vance (Principal Pattern Engineer)',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'pattern:approve',
          approvalTimestamp: FIXED_TIMESTAMP
        },
        {
          keyId: CRYPTO_KEY_ID,
          privateKeyHex: auth.cryptoKey.privateKeyHex,
          tenantId: PROJECT_ID
        }
      );

      const approvedRev = approvePatternRevision(validatedRev, {
        approverName: 'Elena Vance (Principal Pattern Engineer)',
        approvedAt: FIXED_TIMESTAMP,
        approvalEventId: 'pat-app-pkg-01',
        authorityTier: 'cryptographic_principal',
        sourceSpecification: approvedSpec,
        sourceMeasurementSet: approvedMeas,
        cryptographicVerifier: auth.cryptographicVerifier,
        cryptographicSignature: sig
      });

      const gradedSet = gradePattern(designSpecForDrafting);
      const gradingArtifact = createAuthoritativeGradingArtifact({
        projectId: PROJECT_ID,
        tenantId: PROJECT_ID,
        sourceSpecificationId: GARMENT_A_ID,
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
        createdAt: FIXED_TIMESTAMP
      });

      const pkgRes = createAuthoritativeProductionPackage({
        packageId: 'pkg-auth-01',
        projectId: PROJECT_ID,
        createdAt: FIXED_TIMESTAMP,
        patternRevision: approvedRev,
        specification: approvedSpec,
        measurementSet: approvedMeas,
        gradingArtifact,
        exportGradingPolicy: {
          mode: 'graded-multi-size',
          requiredSizes: [...DEFAULT_SIZE_RANGE]
        },
        specificationVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier
        },
        patternApprovalVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier,
          cryptographicSignature: sig
        }
      });

      assert.equal(pkgRes.isPackageCreated, true);
      const pkg = pkgRes.package!;
      assert.equal(pkg.isProductionReady, false);
      assert.equal(pkg.manifest.isProductionReady, false);
      assert.equal(pkg.currentPackageState, 'active');
      assert.equal(pkg.manifest.basePatternFingerprint, approvedRev.basePatternFingerprint);
      assert.equal(pkg.manifest.gradingArtifactFingerprint, gradingArtifact.contentFingerprint);

      const originalManifestFp = pkg.manifestFingerprint;
      assert.equal(computeProductionPackageManifestFingerprint(pkg.manifest), originalManifestFp);

      // Transition package: active -> superseded -> archived, and active -> revoked -> archived
      const supersededPkg = supersedeProductionPackage(pkg, {
        supersededByPackageId: 'pkg-auth-02',
        timestamp: '2026-11-12T11:00:00.000Z'
      });
      assert.equal(supersededPkg.currentPackageState, 'superseded');
      assert.equal(supersededPkg.manifestFingerprint, originalManifestFp);

      const archivedPkg = archiveProductionPackage(supersededPkg, {
        archivedAt: '2026-11-12T11:30:00.000Z'
      });
      assert.equal(archivedPkg.currentPackageState, 'archived');
      assert.equal(archivedPkg.manifestFingerprint, originalManifestFp);

      const revokedPkg = revokeProductionPackage(pkg, {
        reason: 'Specification superseded by seasonal update',
        revokedAt: '2026-11-12T11:05:00.000Z'
      });
      assert.equal(revokedPkg.currentPackageState, 'revoked');
      assert.equal(revokedPkg.manifestFingerprint, originalManifestFp);

      const invalidatedPkg = invalidateProductionPackage(pkg, {
        cause: 'specification_changed',
        reason: 'Upstream specification changed',
        invalidatedAt: '2026-11-12T11:10:00.000Z'
      });
      assert.equal(invalidatedPkg.currentPackageState, 'invalidated');
      assert.equal(invalidatedPkg.manifestFingerprint, originalManifestFp);

      // Verify all transitioned packages pass manifest + lifecycle hash-chain verification
      assert.equal(verifyProductionPackageIntegrity(pkg).isValid, true);
      assert.equal(verifyProductionPackageIntegrity(supersededPkg).isValid, true);
      assert.equal(verifyProductionPackageIntegrity(archivedPkg).isValid, true);
      assert.equal(verifyProductionPackageIntegrity(revokedPkg).isValid, true);
      assert.equal(verifyProductionPackageIntegrity(invalidatedPkg).isValid, true);
    });

    it('rejects package creation when pattern revision is unapproved, superseded, invalidated, or missing trust verifiers', () => {
      const { auth, approvedSpec, approvedMeas, designSpecForDrafting, pieces, validationReport, enhancedFabric } =
        buildApprovedSpecAndMeasurements();

      const draftRev = createDraftPatternRevision({
        revisionId: 'pat-rev-pkg-reject-1',
        revisionNumber: 1,
        projectId: PROJECT_ID,
        garmentId: GARMENT_A_ID,
        createdAt: FIXED_TIMESTAMP,
        designSpec: designSpecForDrafting,
        authoritativeSpec: approvedSpec,
        authoritativeMeasurementSet: approvedMeas,
        pieces,
        validationReport,
        enhancedFabric,
        fabricSource: 'verified-preset'
      });

      // 1. Reject 'draft' pattern revision
      const draftPkgRes = createAuthoritativeProductionPackage({
        patternRevision: draftRev,
        specification: approvedSpec,
        measurementSet: approvedMeas,
        exportGradingPolicy: { mode: 'single-size-ungraded', nonGradingReason: 'Base size only' }
      });
      assert.equal(draftPkgRes.isPackageCreated, false);
      assert.equal(draftPkgRes.rejectionCode, 'PATTERN_REVISION_NOT_APPROVED');

      // 2. Reject 'validated' (but not approved) pattern revision
      const validatedRev = validatePatternRevision(draftRev, { validatedAt: FIXED_TIMESTAMP });
      const valPkgRes = createAuthoritativeProductionPackage({
        patternRevision: validatedRev,
        specification: approvedSpec,
        measurementSet: approvedMeas,
        exportGradingPolicy: { mode: 'single-size-ungraded', nonGradingReason: 'Base size only' }
      });
      assert.equal(valPkgRes.isPackageCreated, false);
      assert.equal(valPkgRes.rejectionCode, 'PATTERN_REVISION_NOT_APPROVED');

      // Approve the revision
      const sig = signPatternRevisionApprovalPayload(
        {
          schemaVersion: 'm05.1-pattern-approval-v1',
          projectId: PROJECT_ID,
          tenantId: PROJECT_ID,
          garmentId: GARMENT_A_ID,
          patternRevisionId: validatedRev.revisionId,
          patternRevisionNumber: validatedRev.revisionIndex,
          basePatternFingerprint: validatedRev.basePatternFingerprint!,
          geometryFingerprint: validatedRev.geometryFingerprint!,
          sourceSpecificationFingerprint: approvedSpec.approvedContentFingerprint!,
          sourceMeasurementSetFingerprint: approvedMeas.canonicalFingerprint,
          approvalEventId: 'pat-app-pkg-reject-01',
          approverPrincipal: 'Elena Vance (Principal Pattern Engineer)',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'pattern:approve',
          approvalTimestamp: FIXED_TIMESTAMP
        },
        {
          keyId: CRYPTO_KEY_ID,
          privateKeyHex: auth.cryptoKey.privateKeyHex,
          tenantId: PROJECT_ID
        }
      );

      const approvedRev = approvePatternRevision(validatedRev, {
        approverName: 'Elena Vance (Principal Pattern Engineer)',
        approvedAt: FIXED_TIMESTAMP,
        approvalEventId: 'pat-app-pkg-reject-01',
        authorityTier: 'cryptographic_principal',
        sourceSpecification: approvedSpec,
        sourceMeasurementSet: approvedMeas,
        cryptographicVerifier: auth.cryptographicVerifier,
        cryptographicSignature: sig
      });

      // 3. Reject when patternApprovalVerificationContext is unavailable (Amendment 3 fail-closed)
      const noVerifierPkgRes = createAuthoritativeProductionPackage({
        patternRevision: approvedRev,
        specification: approvedSpec,
        measurementSet: approvedMeas,
        exportGradingPolicy: { mode: 'single-size-ungraded', nonGradingReason: 'Base size only' },
        specificationVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier
        }
      });
      assert.equal(noVerifierPkgRes.isPackageCreated, false);
      assert.equal(noVerifierPkgRes.rejectionCode, 'AUTHORIZATION_PROVIDER_UNAVAILABLE');

      // 4. Reject superseded pattern revision
      const supersededRev = supersedePatternRevision(approvedRev, {
        supersededByRevisionId: 'pat-rev-pkg-reject-2',
        timestamp: FIXED_TIMESTAMP
      });
      const supPkgRes = createAuthoritativeProductionPackage({
        patternRevision: supersededRev,
        specification: approvedSpec,
        measurementSet: approvedMeas,
        exportGradingPolicy: { mode: 'single-size-ungraded', nonGradingReason: 'Base size only' },
        specificationVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier
        },
        patternApprovalVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier,
          cryptographicSignature: sig
        }
      });
      assert.equal(supPkgRes.isPackageCreated, false);
      assert.equal(supPkgRes.rejectionCode, 'PATTERN_REVISION_SUPERSEDED');

      // 5. Reject invalidated pattern revision
      const invalidatedRev = invalidatePatternRevision(approvedRev, {
        cause: 'measurement_changed',
        reason: 'Waist measurement updated',
        invalidatedAt: FIXED_TIMESTAMP
      });
      const invPkgRes = createAuthoritativeProductionPackage({
        patternRevision: invalidatedRev,
        specification: approvedSpec,
        measurementSet: approvedMeas,
        exportGradingPolicy: { mode: 'single-size-ungraded', nonGradingReason: 'Base size only' },
        specificationVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier
        },
        patternApprovalVerificationContext: {
          cryptographicVerifier: auth.cryptographicVerifier,
          cryptographicSignature: sig
        }
      });
      assert.equal(invPkgRes.isPackageCreated, false);
      assert.equal(invPkgRes.rejectionCode, 'PATTERN_REVISION_INVALIDATED');

      // 6. Reject in-place mutation of non-draft revision via updateDraftPatternRevision
      assert.throws(
        () =>
          updateDraftPatternRevision(validatedRev, {
            updatedAt: '2026-11-12T12:00:00.000Z'
          }),
        /Immutable pattern revision violation/i
      );
    });
  });
});
