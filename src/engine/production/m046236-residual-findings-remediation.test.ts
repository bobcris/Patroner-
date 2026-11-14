/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Milestone 04.6.2.3.6 — Residual Security Findings Remediation & Final Trust-Boundary Closure
 * Regression & Adversarial Test Suite covering AUDIT-04.6.2.3.5-01 through AUDIT-04.6.2.3.5-05.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ALLOWED_PREVIEW_HOSTS, resolveAllowedPreviewHosts } from '../../../vite.config';
import type { TrustedIdentityVerifier } from './garment-specification-types';
import {
  generateEd25519KeyPairFromSeed,
  generateEd25519KeyPairFromPassphrase
} from './crypto';
import {
  approveAuthoritativeGarmentSpecification,
  computeSpecificationFingerprint,
  convertToDesignSpecification,
  createAuthoritativeGarmentSpecification,
  createControlledPublicKeyRegistration,
  createInMemoryJtiReplayStore,
  createOidcPublicJwk,
  createTrustedCryptographicVerifier,
  createTrustedIdentityVerifier,
  deriveEd25519SigningKeyPair,
  issueVerifiableIdentityCredential,
  validateOidcPublicJwk,
  verifySpecificationApproval
} from './garment-specification';
import {
  approveAuthoritativeMeasurementSet,
  approvePatternRevision,
  createAuthoritativeGradingArtifact,
  createAuthoritativeMeasurementSet,
  createMeasurementSetSnapshot,
  createProductionPatternRevision,
  isMisleadingChartApproverIdentity,
  NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS,
  signPatternRevisionApprovalPayload,
  transitionMeasurementProvenance,
  validateMeasurementProvenanceEvidence,
  validatePatternRevision
} from './pattern-revision-snapshot';
import {
  evaluatePipelineDependencyIntegrity,
  validateProductionExportPrerequisites,
  computeArtifactInputFingerprint
} from './dependency-invalidation';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { getEnhancedFabricById, DEFAULT_ILLUSTRATIVE_FABRIC } from '../fabric/fabric-presets';
import { gradePattern, DEFAULT_SIZE_RANGE } from '../grading';
import { validatePatternDraft } from '../validation/seam-validator';
import { ValidationReport } from '../../types/index';

const sizeM = STANDARD_SIZING_SYSTEM.sizes.M;
const standardFabricLookup = getEnhancedFabricById('wool-crepe');
const standardFabric =
  standardFabricLookup.status === 'found' ? standardFabricLookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;

const validGeometryReport: ValidationReport = {
  status: 'validated',
  isValid: true,
  isProductionReady: false,
  statusLabel: 'Validated',
  timestamp: '2026-11-12T08:00:00.000Z',
  passedCount: 1,
  warningCount: 0,
  failureCount: 0,
  checks: [
    {
      id: 'chk-m046236-seam',
      name: 'Seam Continuity',
      category: 'seam-match',
      status: 'pass',
      severity: 'info',
      message: 'All seams continuous'
    }
  ],
  unassessedConditions: [],
  declaration: 'Deterministic geometry validation passed.'
};

function createTestDraftSpec(garmentId = 'garment-m046236-skirt-01') {
  return createAuthoritativeGarmentSpecification({
    projectId: 'tenant-m046236-01',
    garmentId,
    name: 'M046236 Hardened Tailored Skirt',
    garmentCategory: 'skirt',
    silhouette: 'a-line',
    dartStyle: 'single',
    waistband: 'contoured',
    easeProfile: 'classic',
    explicitEaseCm: { waist: 2, hip: 4 },
    lengthCm: 65,
    targetFinishedDimensions: {
      waistCm: sizeM.waist + 2,
      hipCm: sizeM.lowHip + 4,
      lengthCm: 65
    },
    allowances: {
      seamAllowanceCm: 1.5,
      hemAllowanceCm: 3.0,
      waistAllowanceCm: 1.0
    },
    fabric: standardFabric,
    fabricRevision: 'fab-rev-wool-crepe-v1',
    fabricProvenance: 'laboratory-tested'
  });
}

describe('Milestone 04.6.2.3.6 — Residual Security Findings Remediation', () => {
  // =========================================================================
  // FINDING 01: Vite Host Header Protection (AUDIT-04.6.2.3.5-01)
  // =========================================================================
  describe('Finding 01 (AUDIT-04.6.2.3.5-01): Vite Host Header Protection', () => {
    it('F01-1: ALLOWED_PREVIEW_HOSTS is an explicit string array and never unrestricted boolean true or wildcard *', () => {
      assert.equal(Array.isArray(ALLOWED_PREVIEW_HOSTS), true);
      assert.notEqual(ALLOWED_PREVIEW_HOSTS as unknown, true);
      for (const entry of ALLOWED_PREVIEW_HOSTS) {
        assert.equal(typeof entry, 'string');
        assert.notEqual(entry, '*');
        assert.notEqual(entry.toLowerCase(), 'true');
      }
      assert.equal(ALLOWED_PREVIEW_HOSTS.includes('localhost'), true);
      assert.equal(ALLOWED_PREVIEW_HOSTS.includes('127.0.0.1'), true);
      assert.equal(
        ALLOWED_PREVIEW_HOSTS.includes('ais-dev-2anxszslqxyctn6qzb56jm-631135174463.europe-west3.run.app'),
        true
      );
      assert.equal(
        ALLOWED_PREVIEW_HOSTS.includes('ais-pre-2anxszslqxyctn6qzb56jm-631135174463.europe-west3.run.app'),
        true
      );
      assert.equal(ALLOWED_PREVIEW_HOSTS.includes('.run.app'), true);
    });

    it('F01-2: resolveAllowedPreviewHosts parses VITE_ALLOWED_HOSTS and APP_URL while ignoring true and *', () => {
      const hosts = resolveAllowedPreviewHosts({
        VITE_ALLOWED_HOSTS: 'true, *, https://custom-preview.run.app:8080/path, preview-two.internal.example',
        APP_URL: 'https://dynamic-ais-dev-999.europe-west3.run.app'
      });
      assert.equal(hosts.includes('true'), false);
      assert.equal(hosts.includes('*'), false);
      assert.equal(hosts.includes('custom-preview.run.app'), true);
      assert.equal(hosts.includes('preview-two.internal.example'), true);
      assert.equal(hosts.includes('dynamic-ais-dev-999.europe-west3.run.app'), true);
    });
  });

  // =========================================================================
  // FINDING 02: Identity Credential Target Binding Parity (AUDIT-04.6.2.3.5-02)
  // =========================================================================
  describe('Finding 02 (AUDIT-04.6.2.3.5-02): Identity Credential Target Binding Parity Across All Entry Points', () => {
    const idpSeed = 'm046236-oidc-idp-seed-001';
    const idpJwk = createOidcPublicJwk({
      keyId: 'kid-m046236-01',
      signingSecretOrPrivateKeyHex: idpSeed,
      issuer: 'https://idp.patroner.enterprise',
      activatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z'
    });

    it('F02-1: verifyIdentityCredential rejects JWT missing signed spec_id, target_revision_id, or target_specification_fingerprint', () => {
      const draftA = createTestDraftSpec('garment-f02-A');
      const fpA = computeSpecificationFingerprint(draftA);

      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-m046236-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-12T10:00:00.000Z'
      });

      // Unbound credential (missing target-binding claims inside signed JWT)
      const unboundCred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046236-01',
          keyId: 'kid-m046236-01',
          issuedAt: '2026-11-12T09:30:00.000Z',
          expiresAt: '2026-11-12T11:30:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      // 1a. Unbound credential directly -> rejected with missing required target-binding claims
      const resDirectUnbound = verifier.verifyIdentityCredential!(unboundCred, {
        expectedSpecificationId: draftA.garmentId,
        targetRevisionId: draftA.specificationRevisionId,
        targetSpecificationFingerprint: fpA,
        expectedApprover: 'Elena Rostova',
        approvalTimestamp: '2026-11-12T10:00:00.000Z'
      });
      assert.equal(resDirectUnbound.isValid, false);
      assert.match(resDirectUnbound.reason ?? '', /missing required target-binding claims/i);

      // 1b. Even if caller attaches unsigned wrapper fields, verifyIdentityCredential MUST reject because the signed JWT lacks target-binding claims
      const tamperedWrapperCred = {
        ...unboundCred,
        specificationId: draftA.garmentId,
        targetRevisionId: draftA.specificationRevisionId,
        targetSpecificationFingerprint: fpA
      };

      const res1 = verifier.verifyIdentityCredential!(tamperedWrapperCred, {
        expectedSpecificationId: draftA.garmentId,
        targetRevisionId: draftA.specificationRevisionId,
        targetSpecificationFingerprint: fpA,
        expectedApprover: 'Elena Rostova',
        approvalTimestamp: '2026-11-12T10:00:00.000Z'
      });
      assert.equal(res1.isValid, false);
      assert.match(
        res1.reason ?? '',
        /missing required target-binding claims|does not match signed JWT spec_id claim/i
      );
    });

    it('F02-2: verifyIdentityCredential rejects when caller omits expectedSpecificationId, targetRevisionId, or targetSpecificationFingerprint', () => {
      const draftA = createTestDraftSpec('garment-f02-B');
      const fpA = computeSpecificationFingerprint(draftA);

      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-m046236-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-12T10:00:00.000Z'
      });

      const validBoundCred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046236-01',
          keyId: 'kid-m046236-01',
          issuedAt: '2026-11-12T09:30:00.000Z',
          expiresAt: '2026-11-12T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draftA.garmentId,
          targetRevisionId: draftA.specificationRevisionId,
          targetSpecificationFingerprint: fpA
        },
        idpSeed
      );

      // Calling verifyIdentityCredential without expected target context must fail closed
      const resEmpty = verifier.verifyIdentityCredential!(
        validBoundCred,
        {} as unknown as Parameters<NonNullable<typeof verifier.verifyIdentityCredential>>[1]
      );
      assert.equal(resEmpty.isValid, false);

      const resPartial = verifier.verifyIdentityCredential!(
        validBoundCred,
        {
          expectedSpecificationId: draftA.garmentId
        } as unknown as Parameters<NonNullable<typeof verifier.verifyIdentityCredential>>[1]
      );
      assert.equal(resPartial.isValid, false);
    });

    it('F02-3: verifyIdentityCredential rejects cross-specification and cross-revision token transplant', () => {
      const draftA = createTestDraftSpec('garment-f02-spec-A');
      const draftB = createTestDraftSpec('garment-f02-spec-B');
      const fpA = computeSpecificationFingerprint(draftA);
      const fpB = computeSpecificationFingerprint(draftB);

      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-m046236-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-12T10:00:00.000Z'
      });

      const boundToACred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046236-01',
          keyId: 'kid-m046236-01',
          issuedAt: '2026-11-12T09:30:00.000Z',
          expiresAt: '2026-11-12T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draftA.garmentId,
          targetRevisionId: draftA.specificationRevisionId,
          targetSpecificationFingerprint: fpA
        },
        idpSeed
      );

      // Verify against draftB -> must be false
      const resTransplant = verifier.verifyIdentityCredential!(boundToACred, {
        expectedSpecificationId: draftB.garmentId,
        targetRevisionId: draftB.specificationRevisionId,
        targetSpecificationFingerprint: fpB,
        expectedApprover: 'Elena Rostova',
        approvalTimestamp: '2026-11-12T10:00:00.000Z'
      });
      assert.equal(resTransplant.isValid, false);

      // Verify against draftA -> must be true
      const resValid = verifier.verifyIdentityCredential!(boundToACred, {
        expectedSpecificationId: draftA.garmentId,
        targetRevisionId: draftA.specificationRevisionId,
        targetSpecificationFingerprint: fpA,
        expectedApprover: 'Elena Rostova',
        approvalTimestamp: '2026-11-12T10:00:00.000Z'
      });
      assert.equal(resValid.isValid, true);
    });

    it('F02-4: verifyCredential rejects requireTargetBinding: false downgrade and unsigned wrapper mismatch', () => {
      const draftA = createTestDraftSpec('garment-f02-downgrade');
      const fpA = computeSpecificationFingerprint(draftA);

      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-m046236-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-12T10:00:00.000Z'
      });

      const boundToACred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046236-01',
          keyId: 'kid-m046236-01',
          issuedAt: '2026-11-12T09:30:00.000Z',
          expiresAt: '2026-11-12T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draftA.garmentId,
          targetRevisionId: draftA.specificationRevisionId,
          targetSpecificationFingerprint: fpA
        },
        idpSeed
      );

      // Attempt to pass requireTargetBinding: false
      const resDowngrade = verifier.verifyCredential!(boundToACred, {
        expectedSpecificationId: draftA.garmentId,
        expectedRevisionId: draftA.specificationRevisionId,
        expectedSpecificationFingerprint: fpA,
        requireTargetBinding: false
      });
      assert.equal(resDowngrade.isValid, false);
      assert.match(resDowngrade.reason ?? '', /requireTargetBinding: false.*forbidden/i);

      // Attempt to tamper with unsigned wrapper targetRevisionId while signed JWT still has draftA
      const wrapperTamperedCred = {
        ...boundToACred,
        targetRevisionId: 'tampered-unsigned-rev-999'
      };
      const resWrapperMismatch = verifier.verifyCredential!(wrapperTamperedCred, {
        expectedSpecificationId: draftA.garmentId,
        expectedRevisionId: draftA.specificationRevisionId,
        expectedSpecificationFingerprint: fpA
      });
      assert.equal(resWrapperMismatch.isValid, false);
      assert.match(resWrapperMismatch.reason ?? '', /Unsigned credential wrapper|targetRevisionId.*does not match signed JWT/i);
    });

    it('F02-5: approveAuthoritativeGarmentSpecification and verifySpecificationApproval enforce signed JWT target binding even with a custom verifyIdentityCredential-only verifier', () => {
      const draftA = createTestDraftSpec('garment-f02-legacy-A');
      const draftB = createTestDraftSpec('garment-f02-legacy-B');
      const fpA = computeSpecificationFingerprint(draftA);
      const fpB = computeSpecificationFingerprint(draftB);

      const fullVerifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-m046236-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-12T10:00:00.000Z'
      });

      // Custom verifier exposing ONLY verifyIdentityCredential (and returning isValid: true unconditionally to simulate a weak custom verifier)
      const permissiveLegacyVerifier = {
        verifyIdentityCredential: () => ({ verified: true, isValid: true })
      };

      const boundToACred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046236-01',
          keyId: 'kid-m046236-01',
          issuedAt: '2026-11-12T09:30:00.000Z',
          expiresAt: '2026-11-12T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draftA.garmentId,
          targetRevisionId: draftA.specificationRevisionId,
          targetSpecificationFingerprint: fpA
        },
        idpSeed
      );

      // Even if unsigned wrapper fields are rewritten to match draftB AND permissiveLegacyVerifier returns isValid: true,
      // approveAuthoritativeGarmentSpecification inspects the signed JWT payload and rejects!
      const forgedCredForB = {
        ...boundToACred,
        specificationId: draftB.garmentId,
        targetRevisionId: draftB.specificationRevisionId,
        targetSpecificationFingerprint: fpB
      };

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draftB, 'Elena Rostova', {
          authorityTier: 'authenticated_designer',
          approverId: 'oidc|designer-01',
          approvedAt: '2026-11-12T10:00:00.000Z',
          identityCredential: forgedCredForB,
          identityVerifier: (permissiveLegacyVerifier as unknown) as TrustedIdentityVerifier
        });
      }, /target specificationId mismatch/i);

      // And with the real verifyIdentityCredential-only wrapper:
      const realLegacyOnlyVerifier = {
        verifyIdentityCredential: fullVerifier.verifyIdentityCredential
      };
      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draftB, 'Elena Rostova', {
          authorityTier: 'authenticated_designer',
          approverId: 'oidc|designer-01',
          approvedAt: '2026-11-12T10:00:00.000Z',
          identityCredential: boundToACred,
          identityVerifier: (realLegacyOnlyVerifier as unknown) as TrustedIdentityVerifier
        });
      }, /target specificationId mismatch/i);
    });
  });

  // =========================================================================
  // FINDING 03: Grading Integrity Recomputation Without Heuristics (AUDIT-04.6.2.3.5-03)
  // =========================================================================
  describe('Finding 03 (AUDIT-04.6.2.3.5-03): Grading Integrity Recomputation Without Heuristics', () => {
    function buildFullExportFixture() {
      const idpSeed = 'm046236-f03-idp-seed';
      const idpJwk = createOidcPublicJwk({
        keyId: 'kid-f03-01',
        signingSecretOrPrivateKeyHex: idpSeed,
        issuer: 'https://idp.patroner.enterprise',
        activatedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z'
      });

      const draft = createTestDraftSpec('garment-f03-skirt');
      const fp = computeSpecificationFingerprint(draft);
      const replayStore = createInMemoryJtiReplayStore();

      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-m046236-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-12T10:00:00.000Z',
        replayStore
      });

      const cred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-f03',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046236-01',
          keyId: 'kid-f03-01',
          issuedAt: '2026-11-12T09:30:00.000Z',
          expiresAt: '2026-11-12T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draft.garmentId,
          targetRevisionId: draft.specificationRevisionId,
          targetSpecificationFingerprint: fp
        },
        idpSeed
      );

      const approvedSpec = approveAuthoritativeGarmentSpecification(draft, 'Elena Rostova', {
        authorityTier: 'authenticated_designer',
        approverId: 'oidc|designer-f03',
        approvedAt: '2026-11-12T10:00:00.000Z',
        identityCredential: cred,
        identityVerifier: verifier
      });

      const measurements = { ...sizeM, skirtLength: 65 };
      const designSpec = convertToDesignSpecification(approvedSpec);

      const pieces = draftSkirtBlock(measurements, designSpec);
      const validation = validatePatternDraft(pieces);
      const rawGradedPatternSet = gradePattern(designSpec);
      const gradedPatternSet = {
        ...rawGradedPatternSet,
        sizeResults: Object.fromEntries(
          Object.entries(rawGradedPatternSet.sizeResults).map(([sz, res]) => [
            sz,
            {
              ...res,
              bodicePieces: [],
              sleevePiece: undefined,
              skirtPieces: draftSkirtBlock(res.measurements, designSpec)
            }
          ])
        ) as typeof rawGradedPatternSet.sizeResults
      };

      const draftSnapshot = createProductionPatternRevision({
        projectId: 'tenant-m046236-01',
        revisionId: 'rev-f03-v1-M',
        createdAt: '2026-11-12T10:01:00.000Z',
        targetSize: 'M',
        designSpecification: designSpec,
        measurements: {
          values: ({ ...measurements } as unknown) as Record<string, number>,
          defaultOrigin: 'physically-measured',
          approval: {
            state: 'approved',
            approvedBy: 'Elena Rostova (Master Patternmaker)',
            approvedAt: '2026-11-12T09:45:00.000Z'
          }
        },
        fabric: standardFabric,
        patternPieces: pieces,
        validation,
        physicalValidationStatus: 'not-assessed'
      });

      const patKey = deriveEd25519SigningKeyPair('ed25519-f03-pat-01', 'm046236-f03-pattern-seed-01', {
        ownerPrincipal: 'Elena Rostova (Principal Patternmaker)',
        tenantId: 'tenant-m046236-01',
        allowedScopes: ['pattern:approve']
      });
      const patCryptoVerifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [
          createControlledPublicKeyRegistration({
            keyId: patKey.keyId,
            publicKeyHex: patKey.publicKeyHex,
            principalId: 'Elena Rostova (Principal Patternmaker)',
            tenantId: 'tenant-m046236-01',
            allowedScopes: ['pattern:approve'],
            activatedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z'
          })
        ]
      });
      const validatedSnapshot = validatePatternRevision(draftSnapshot, {
        validatedAt: '2026-11-12T10:02:00.000Z'
      });
      const patSig = signPatternRevisionApprovalPayload(
        {
          schemaVersion: 'm05.1-pattern-approval-v1',
          projectId: 'tenant-m046236-01',
          tenantId: 'tenant-m046236-01',
          garmentId: approvedSpec.garmentId,
          patternRevisionId: validatedSnapshot.revisionId,
          patternRevisionNumber: validatedSnapshot.revisionIndex,
          basePatternFingerprint: validatedSnapshot.basePatternFingerprint!,
          geometryFingerprint: validatedSnapshot.geometryFingerprint!,
          sourceSpecificationFingerprint: validatedSnapshot.sourceSpecificationFingerprint!,
          sourceMeasurementSetFingerprint: validatedSnapshot.sourceMeasurementSetFingerprint!,
          approvalEventId: 'pat-app-f03-01',
          approverPrincipal: 'Elena Rostova (Principal Patternmaker)',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'pattern:approve',
          approvalTimestamp: '2026-11-12T10:05:00.000Z'
        },
        {
          keyId: patKey.keyId,
          privateKeyHex: patKey.privateKeyHex,
          tenantId: 'tenant-m046236-01'
        }
      );
      const snapshot = approvePatternRevision(validatedSnapshot, {
        approverName: 'Elena Rostova (Principal Patternmaker)',
        approvedAt: '2026-11-12T10:05:00.000Z',
        approvalEventId: 'pat-app-f03-01',
        authorityTier: 'cryptographic_principal',
        cryptographicVerifier: patCryptoVerifier,
        cryptographicSignature: patSig
      });

      const measFp = computeArtifactInputFingerprint({
        unit: measurements.unit,
        waist: measurements.waist,
        lowHip: measurements.lowHip,
        highHip: measurements.highHip,
        skirtLength: measurements.skirtLength,
        bust: measurements.bust,
        waistToHip: measurements.waistToHip,
        backWaistLength: measurements.backWaistLength,
        frontWaistLength: measurements.frontWaistLength,
        acrossBack: measurements.acrossBack,
        shoulderLength: measurements.shoulderLength,
        neckCircumference: measurements.neckCircumference,
        bustSpan: measurements.bustSpan,
        bustHeight: measurements.bustHeight,
        armholeDepth: measurements.armholeDepth,
        bicepsCircumference: measurements.bicepsCircumference,
        elbowCircumference: measurements.elbowCircumference,
        wristCircumference: measurements.wristCircumference,
        sleeveLength: measurements.sleeveLength,
        armLengthToElbow: measurements.armLengthToElbow,
        activeSize: 'M'
      });

      const gradingRulesFp = computeArtifactInputFingerprint({
        system: 'standard-iso-8559',
        baseSize: 'M',
        version: 'iso8559-standard',
        sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
      });

      const gradingArtifact = createAuthoritativeGradingArtifact({
        projectId: 'tenant-m046236-01',
        tenantId: 'tenant-m046236-01',
        sourceSpecificationId: approvedSpec.garmentId,
        sourceSpecificationRevisionId: approvedSpec.specificationRevisionId,
        sourceSpecificationFingerprint: computeSpecificationFingerprint(approvedSpec),
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: measFp,
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: gradingRulesFp,
        baseSize: 'M',
        sizeRange: [...DEFAULT_SIZE_RANGE],
        gradedPatternSet,
        basePatternPieces: pieces
      });

      return {
        approvedSpec,
        measurements,
        fabric: standardFabric,
        pieces,
        validation,
        snapshot,
        gradingArtifact,
        verificationContext: {
          identityVerifier: verifier,
          cryptographicVerifier: patCryptoVerifier
        }
      };
    }

    it('F03-1: rejects caller-supplied report computed WITHOUT gradingArtifact when activeInputs.gradingArtifact IS provided (closes baseline heuristic bypass)', () => {
      const ctx = buildFullExportFixture();

      // Compute a report WITHOUT gradingArtifact (baseline fingerprint)
      const baselineReportWithoutGradingArtifact = evaluatePipelineDependencyIntegrity({
        specification: ctx.approvedSpec,
        measurements: ctx.measurements,
        measurementApprovalState: 'approved',
        measurementProvenance: 'physically-measured',
        activeSize: 'M',
        fabric: ctx.fabric,
        patternPieces: ctx.pieces,
        validationReport: ctx.validation,
        productionSnapshot: ctx.snapshot,
        verificationContext: ctx.verificationContext
        // gradingArtifact intentionally omitted!
      });

      // Now call validateProductionExportPrerequisites WITH activeInputs.gradingArtifact
      const exportResult = validateProductionExportPrerequisites(
        baselineReportWithoutGradingArtifact,
        ctx.snapshot,
        {
          specification: ctx.approvedSpec,
          measurements: ctx.measurements,
          measurementApprovalState: 'approved',
          measurementProvenance: 'physically-measured',
          fabric: ctx.fabric,
          patternPieces: ctx.pieces,
          validationReport: ctx.validation,
          verificationContext: ctx.verificationContext,
          gradingArtifact: ctx.gradingArtifact,
          exportGradingPolicy: {
            mode: 'graded-multi-size',
            requiredSizes: [...DEFAULT_SIZE_RANGE]
          }
        }
      );

      assert.equal(exportResult.isExportPermitted, false);
      assert.equal(exportResult.rejectionCode, 'FORGED_REPORT_DETECTED');
      assert.equal(
        exportResult.blockingArtifacts.some(b => b.includes("stage 'grading' mismatch")),
        true
      );
    });

    it('F03-2: rejects caller-supplied report with forged report.artifacts.grading fingerprint', () => {
      const ctx = buildFullExportFixture();

      const validReportWithGradingArtifact = evaluatePipelineDependencyIntegrity({
        specification: ctx.approvedSpec,
        measurements: ctx.measurements,
        measurementApprovalState: 'approved',
        measurementProvenance: 'physically-measured',
        activeSize: 'M',
        fabric: ctx.fabric,
        patternPieces: ctx.pieces,
        validationReport: ctx.validation,
        productionSnapshot: ctx.snapshot,
        verificationContext: ctx.verificationContext,
        gradingArtifact: ctx.gradingArtifact
      });

      const forgedReport = {
        ...validReportWithGradingArtifact,
        artifacts: {
          ...validReportWithGradingArtifact.artifacts,
          grading: {
            ...validReportWithGradingArtifact.artifacts.grading,
            generatedContentFingerprint: '0'.repeat(64)
          }
        }
      };

      const exportResult = validateProductionExportPrerequisites(forgedReport, ctx.snapshot, {
        specification: ctx.approvedSpec,
        measurements: ctx.measurements,
        measurementApprovalState: 'approved',
        measurementProvenance: 'physically-measured',
        fabric: ctx.fabric,
        patternPieces: ctx.pieces,
        validationReport: ctx.validation,
        verificationContext: ctx.verificationContext,
        gradingArtifact: ctx.gradingArtifact,
        exportGradingPolicy: {
          mode: 'graded-multi-size',
          requiredSizes: [...DEFAULT_SIZE_RANGE]
        }
      });

      assert.equal(exportResult.isExportPermitted, false);
      assert.equal(exportResult.rejectionCode, 'FORGED_REPORT_DETECTED');
    });

    it('F03-3: permits graded export when report and activeInputs both include the valid AuthoritativeGradingArtifact, and permits single-size ungraded export with explicit nonGradingReason', () => {
      const ctx = buildFullExportFixture();

      const validReportWithGrading = evaluatePipelineDependencyIntegrity({
        specification: ctx.approvedSpec,
        measurements: ctx.measurements,
        measurementApprovalState: 'approved',
        measurementProvenance: 'physically-measured',
        activeSize: 'M',
        fabric: ctx.fabric,
        patternPieces: ctx.pieces,
        validationReport: ctx.validation,
        productionSnapshot: ctx.snapshot,
        verificationContext: ctx.verificationContext,
        gradingArtifact: ctx.gradingArtifact
      });

      const gradedExportResult = validateProductionExportPrerequisites(
        validReportWithGrading,
        ctx.snapshot,
        {
          specification: ctx.approvedSpec,
          measurements: ctx.measurements,
          measurementApprovalState: 'approved',
          measurementProvenance: 'physically-measured',
          fabric: ctx.fabric,
          patternPieces: ctx.pieces,
          validationReport: ctx.validation,
          verificationContext: ctx.verificationContext,
          gradingArtifact: ctx.gradingArtifact,
          exportGradingPolicy: {
            mode: 'graded-multi-size',
            requiredSizes: [...DEFAULT_SIZE_RANGE]
          }
        }
      );

      assert.equal(gradedExportResult.isExportPermitted, true);
      assert.equal(gradedExportResult.manufacturingDocumentation?.isProductionReady, false);

      // Single-size ungraded export with explicit nonGradingReason and no gradingArtifact
      const ungradedReport = evaluatePipelineDependencyIntegrity({
        specification: ctx.approvedSpec,
        measurements: ctx.measurements,
        measurementApprovalState: 'approved',
        measurementProvenance: 'physically-measured',
        activeSize: 'M',
        fabric: ctx.fabric,
        patternPieces: ctx.pieces,
        validationReport: ctx.validation,
        productionSnapshot: ctx.snapshot,
        verificationContext: ctx.verificationContext
      });

      const ungradedExportResult = validateProductionExportPrerequisites(
        ungradedReport,
        ctx.snapshot,
        {
          specification: ctx.approvedSpec,
          measurements: ctx.measurements,
          measurementApprovalState: 'approved',
          measurementProvenance: 'physically-measured',
          fabric: ctx.fabric,
          patternPieces: ctx.pieces,
          validationReport: ctx.validation,
          verificationContext: ctx.verificationContext,
          exportGradingPolicy: {
            mode: 'single-size-ungraded',
            nonGradingReason: 'Bespoke single-client atelier fitting toile (Size M only)'
          }
        }
      );

      assert.equal(ungradedExportResult.isExportPermitted, true);
      assert.equal(ungradedExportResult.manufacturingDocumentation?.gradingMode, 'single-size-ungraded');
    });
  });

  // =========================================================================
  // FINDING 04: Verifier Boundary Schema Validation & Explicit Seed Format (AUDIT-04.6.2.3.5-04)
  // =========================================================================
  describe('Finding 04 (AUDIT-04.6.2.3.5-04): Verifier Boundary Schema Validation & Explicit Seed Format', () => {
    const validKey = deriveEd25519SigningKeyPair('key-f04-01', 'seed-f04-valid-01');

    it('F04-1: rejects alternate private-key property names (rawPrivateSeed, rawSeed, privateSeed, privateKeyMaterial, secretMaterial, signingMaterial)', () => {
      const forbiddenVariants = [
        'rawPrivateSeed',
        'rawSeed',
        'privateSeed',
        'privateKeyMaterial',
        'secretMaterial',
        'signingMaterial',
        'private_key_seed'
      ];

      for (const propName of forbiddenVariants) {
        assert.throws(
          () =>
            createControlledPublicKeyRegistration({
              keyId: 'k-f04',
              publicKeyHex: validKey.publicKeyHex,
              principalId: 'p-f04',
              tenantId: 't-f04',
              [propName]: 'aa'.repeat(32)
            } as unknown as Parameters<typeof createControlledPublicKeyRegistration>[0]),
          /Security boundary violation.*forbidden private\/secret field/i
        );
      }
    });

    it('F04-2: rejects unknown properties on ControlledPublicKeyRegistration, JWK entries, and verifier configs', () => {
      assert.throws(
        () =>
          createControlledPublicKeyRegistration({
            keyId: 'k-f04',
            publicKeyHex: validKey.publicKeyHex,
            principalId: 'p-f04',
            tenantId: 't-f04',
            unexpectedCustomField: 'some-value'
          } as unknown as Parameters<typeof createControlledPublicKeyRegistration>[0]),
        /Security boundary violation.*unknown or unsupported property/i
      );

      const reg = createControlledPublicKeyRegistration({
        keyId: 'k-f04',
        publicKeyHex: validKey.publicKeyHex,
        principalId: 'p-f04',
        tenantId: 't-f04'
      });

      assert.throws(
        () =>
          createTrustedCryptographicVerifier({
            publicKeyRegistry: [reg],
            extraConfigFlag: 123
          } as unknown as Parameters<typeof createTrustedCryptographicVerifier>[0]),
        /Security boundary violation.*unknown or unsupported property/i
      );

      const validJwk = createOidcPublicJwk({
        keyId: 'kid-f04',
        publicKeyHex: validKey.publicKeyHex
      });

      assert.throws(
        () =>
          validateOidcPublicJwk({
            ...validJwk,
            unrecognizedJwkField: 'forbidden'
          } as unknown as Parameters<typeof validateOidcPublicJwk>[0]),
        /Security boundary violation.*unknown or unsupported property/i
      );
    });

    it('F04-3: rejects circular references and non-plain objects (Uint8Array, Map, Set, Date, custom class instances) in verifier boundary', () => {
      const circularObj: Record<string, unknown> = {
        keyId: 'k-f04',
        publicKeyHex: validKey.publicKeyHex,
        principalId: 'p-f04',
        tenantId: 't-f04'
      };
      circularObj.self = circularObj;

      assert.throws(
        () =>
          createControlledPublicKeyRegistration(
            circularObj as unknown as Parameters<typeof createControlledPublicKeyRegistration>[0]
          ),
        /Security boundary violation.*circular reference detected/i
      );

      assert.throws(
        () =>
          createControlledPublicKeyRegistration({
            keyId: 'k-f04',
            publicKeyHex: new Uint8Array(32) as unknown as string,
            principalId: 'p-f04',
            tenantId: 't-f04'
          }),
        /Security boundary violation.*raw byte buffers, TypedArrays, or non-plain built-in instances/i
      );

      class CustomCarrier {
        keyId = 'k-f04';
        publicKeyHex = validKey.publicKeyHex;
        principalId = 'p-f04';
        tenantId = 't-f04';
      }
      assert.throws(
        () =>
          createControlledPublicKeyRegistration(
            new CustomCarrier() as unknown as Parameters<typeof createControlledPublicKeyRegistration>[0]
          ),
        /Security boundary violation.*plain object with a standard prototype/i
      );
    });

    it('F04-4: generateEd25519KeyPairFromSeed requires explicit inputFormat for 64-character hex strings and rejects inputFormat: auto', () => {
      const hex64 = 'a1'.repeat(32);

      // Ambiguous 64-char hex without explicit inputFormat must fail closed
      assert.throws(
        () => generateEd25519KeyPairFromSeed(hex64),
        /Ambiguous 64-character hex input to generateEd25519KeyPairFromSeed/i
      );

      // inputFormat: 'auto' must be rejected
      assert.throws(
        () =>
          generateEd25519KeyPairFromSeed(hex64, {
            inputFormat: 'auto' as unknown as 'raw-seed-hex'
          }),
        /Invalid or unsupported Ed25519 seed inputFormat "auto"/i
      );

      // Explicit 'raw-seed-hex' vs 'passphrase' produce distinct, deterministic keys
      const rawKey = generateEd25519KeyPairFromSeed(hex64, { inputFormat: 'raw-seed-hex' });
      const passKey = generateEd25519KeyPairFromSeed(hex64, { inputFormat: 'passphrase' });
      assert.notEqual(rawKey.publicKeyHex, passKey.publicKeyHex);
      assert.equal(passKey.publicKeyHex, generateEd25519KeyPairFromPassphrase(hex64).publicKeyHex);
    });
  });

  // =========================================================================
  // FINDING 05: Measurement Provenance & Approval Integrity (AUDIT-04.6.2.3.5-05)
  // =========================================================================
  describe('Finding 05 (AUDIT-04.6.2.3.5-05): Measurement Provenance & Approval Integrity', () => {
    const sampleValues: Record<string, number> = {
      waist: STANDARD_SIZING_SYSTEM.sizes.M.waist,
      lowHip: STANDARD_SIZING_SYSTEM.sizes.M.lowHip,
      highHip: STANDARD_SIZING_SYSTEM.sizes.M.highHip,
      waistToHip: STANDARD_SIZING_SYSTEM.sizes.M.waistToHip,
      skirtLength: STANDARD_SIZING_SYSTEM.sizes.M.skirtLength
    };

    it('F05-1: rejects approving standard-chart, synthetic-fixture, synthetic-persona, ai-estimated, and unknown measurements across all domain helpers', () => {
      const nonApprovableOrigins = [
        'standard-chart',
        'synthetic-fixture',
        'synthetic-persona',
        'ai-estimated',
        'unknown'
      ] as const;

      for (const origin of nonApprovableOrigins) {
        assert.equal(NON_APPROVABLE_PRODUCTION_MEASUREMENT_ORIGINS.has(origin), true);

        if (origin === 'standard-chart' || origin === 'synthetic-fixture' || origin === 'synthetic-persona') {
          assert.throws(
            () =>
              createMeasurementSetSnapshot(sampleValues, {
                defaultOrigin: origin,
                approval: {
                  state: 'approved',
                  approvedBy: 'Operator Jane',
                  approvedAt: '2026-11-12T12:00:00.000Z'
                }
              }),
            /cannot be marked as approved/i
          );
        }

        assert.throws(
          () =>
            createAuthoritativeMeasurementSet({
              values: sampleValues,
              provenance: origin,
              approvalState: 'approved',
              approvedAt: '2026-11-12T12:00:00.000Z',
              approvingAuthority: 'Atelier Pattern Lead'
            }),
          /cannot be marked as approved/i
        );

        const unverifiedRecord = createAuthoritativeMeasurementSet({
          values: sampleValues,
          provenance: origin,
          approvalState: 'unverified'
        });

        assert.throws(
          () =>
            approveAuthoritativeMeasurementSet(unverifiedRecord, {
              approvingAuthority: 'Atelier Pattern Lead',
              approvedAt: '2026-11-12T12:00:00.000Z'
            }),
          /cannot be marked as approved/i
        );
      }
    });

    it('F05-2: rejects misleading chart approver identity (e.g. ISO 13402 Standard Reference Chart)', () => {
      assert.equal(isMisleadingChartApproverIdentity('ISO 13402 Standard Reference Chart'), true);
      assert.equal(isMisleadingChartApproverIdentity('Standard Reference Chart'), true);
      assert.equal(isMisleadingChartApproverIdentity('Elena Rostova (Master Patternmaker)'), false);

      assert.throws(
        () =>
          createMeasurementSetSnapshot(sampleValues, {
            defaultOrigin: 'physically-measured',
            approval: {
              state: 'approved',
              approvedBy: 'ISO 13402 Standard Reference Chart',
              approvedAt: '2026-11-12T12:00:00.000Z'
            }
          }),
        /Standard reference chart label 'ISO 13402 Standard Reference Chart' cannot be used as an approving human authority/i
      );
    });

    it('F05-3: transitionMeasurementProvenance requires structured operator & source evidence before upgrading to physically-measured or operator-confirmed', () => {
      // Missing evidence -> rejected
      const noEvidenceRes = transitionMeasurementProvenance(
        'standard-chart',
        'physically-measured',
        undefined
      );
      assert.equal(noEvidenceRes.isValid, false);

      // Misleading chart name in operatorName -> rejected
      const fakeOperatorRes = transitionMeasurementProvenance(
        'standard-chart',
        'physically-measured',
        {
          operatorName: 'ISO 13402 Standard Reference Chart',
          measurementSource: 'Direct tape measurement',
          recordedAt: '2026-11-12T12:00:00.000Z'
        }
      );
      assert.equal(fakeOperatorRes.isValid, false);

      // Valid structured operator & source evidence -> accepted
      const validRes = transitionMeasurementProvenance(
        'standard-chart',
        'physically-measured',
        {
          operatorName: 'Elena Rostova',
          measurementSource: 'Direct tape measurement on client in Atelier Room 2',
          sessionReference: 'FIT-2026-11-12',
          recordedAt: '2026-11-12T12:00:00.000Z'
        }
      );
      assert.equal(validRes.isValid, true);
      assert.equal(validRes.nextOrigin, 'physically-measured');
      assert.equal(validRes.evidence?.operatorName, 'Elena Rostova');
      assert.equal(validateMeasurementProvenanceEvidence('physically-measured', validRes.evidence).isValid, true);
    });

    it('F05-4: standard-chart measurements remain usable for pattern drafting but are blocked from production export', () => {
      const draft = createTestDraftSpec('garment-f05-drafting');
      const chartMeasurements = {
        ...STANDARD_SIZING_SYSTEM.sizes.M,
        skirtLength: draft.lengthCm
      };

      const designSpec = {
        id: draft.garmentId,
        name: draft.name,
        prompt: 'M046236 F05 test skirt',
        version: draft.version,
        garmentCategory: 'skirt' as const,
        silhouette: draft.silhouette,
        waistband: draft.waistband,
        easeProfile: draft.easeProfile,
        explicitEaseCm: draft.explicitEaseCm,
        lengthCm: draft.lengthCm,
        fabric: standardFabric,
        color: { name: 'Obsidian', hex: '#222222' },
        constructionFeatures: [],
        designNotes: ['Test specification'],
        isApproved: false,
        specificationRevisionId: draft.specificationRevisionId
      };

      // Pattern drafting works cleanly with standard-chart measurements
      const pieces = draftSkirtBlock(chartMeasurements, designSpec);
      const validation = validatePatternDraft(pieces);
      assert.equal(pieces.length > 0, true);
      assert.equal(validation.isValid, true);

      // Pipeline dependency integrity marks standard-chart as unverified even if caller passes measurementApprovalState: 'approved'
      const report = evaluatePipelineDependencyIntegrity({
        specification: draft,
        measurements: chartMeasurements,
        measurementApprovalState: 'approved',
        measurementProvenance: 'standard-chart',
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validationGeometryReportOrDefault(validation)
      });
      assert.notEqual(report.artifacts.measurements.validationStatus, 'approved');
      assert.equal(report.canExportProductionDocumentation, false);
    });
  });
});

function validationGeometryReportOrDefault(v: ValidationReport): ValidationReport {
  return v ?? validGeometryReport;
}
