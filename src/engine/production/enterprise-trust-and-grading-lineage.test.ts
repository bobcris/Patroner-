/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  base64UrlEncodeUtf8,
  base64UrlEncodeBytes,
  computeEd25519PublicKeyFingerprint,
  generateEd25519KeyPairFromSeed,
  signEd25519Message,
  verifyEd25519Signature,
  signOidcJwtEdDsa
} from './crypto';
import {
  SPECIFICATION_CANONICAL_SCHEMA_VERSION,
  ControlledPublicKeyRegistration,
  OidcJwkPublicKey,
  VerifiableCryptographicSignature,
  VerifiableIdentityCredential
} from './garment-specification-types';
import {
  createAuthoritativeGarmentSpecification,
  approveAuthoritativeGarmentSpecification,
  computeSpecificationFingerprint,
  verifySpecificationApproval,
  convertToDesignSpecification,
  deriveEd25519SigningKeyPair,
  createControlledPublicKeyRegistration,
  createOidcPublicJwk,
  issueVerifiableIdentityCredential,
  createTrustedIdentityVerifier,
  signSpecificationApprovalPayload,
  createTrustedCryptographicVerifier
} from './garment-specification';
import {
  createProductionPatternRevision,
  createAuthoritativeGradingArtifact,
  supersedeAuthoritativeGradingArtifact,
  revokeAuthoritativeGradingArtifact,
  verifyGradingArtifactIntegrity
} from './pattern-revision-snapshot';
import {
  evaluatePipelineDependencyIntegrity,
  validateProductionExportPrerequisites,
  computeArtifactInputFingerprint
} from './dependency-invalidation';
import { STANDARD_SIZING_SYSTEM } from '../measurements/standards';
import { draftSkirtBlock } from '../drafting/skirt-block';
import { getEnhancedFabricById, DEFAULT_ILLUSTRATIVE_FABRIC } from '../fabric/fabric-presets';
import { gradePattern } from '../grading/pattern-grader';
import { ValidationReport } from '../../types';

describe('Milestone 04.6.2.3.2: Enterprise Trust Provider Integration & Complete Grading Export Lineage', () => {
  const sizeM = STANDARD_SIZING_SYSTEM.sizes.M;
  const standardFabricLookup = getEnhancedFabricById('wool-crepe');
  const standardFabric =
    standardFabricLookup.status === 'found' ? standardFabricLookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;

  const validReport: ValidationReport = {
    status: 'validated',
    isValid: true,
    isProductionReady: false,
    statusLabel: 'DRAFT_VALIDATED',
    timestamp: '2026-11-10T08:00:00.000Z',
    passedCount: 48,
    warningCount: 0,
    failureCount: 0,
    checks: [],
    unassessedConditions: [],
    declaration: '2D geometry and seam matches verified.'
  };

  function createDraftSkirtSpec(overrides: Partial<Parameters<typeof createAuthoritativeGarmentSpecification>[0]> = {}) {
    const effectiveLength = overrides.lengthCm ?? 68.0;
    return createAuthoritativeGarmentSpecification({
      projectId: 'tenant-atelier-01',
      garmentId: 'skirt-enterprise-01',
      specificationRevisionId: 'spec-skirt-enterprise-01-v1',
      name: 'Enterprise Trust Skirt',
      garmentCategory: 'skirt',
      silhouette: 'straight',
      fabric: standardFabric,
      easeProfile: 'classic',
      lengthCm: effectiveLength,
      targetFinishedDimensions: {
        lengthCm: effectiveLength,
        waistCm: 78.0,
        hipCm: 103.0
      },
      explicitEaseCm: {
        waist: 6.0,
        hip: 5.0,
        neck: 1.0
      },
      allowances: {
        seamAllowanceCm: 1.5,
        hemAllowanceCm: 3.0,
        waistAllowanceCm: 1.0,
        neckAllowanceCm: 1.0,
        armholeAllowanceCm: 1.0,
        shoulderAllowanceCm: 1.0
      },
      dartStyle: 'waist',
      sleeveEaseStrategy: 'classic',
      ...overrides
    });
  }

  // ===========================================================================
  // PART 1: CRYPTOGRAPHIC ASYMMETRIC ED25519 SIGNATURE VERIFICATION (16 TESTS)
  // ===========================================================================
  describe('Phase 1: Asymmetric Ed25519 Digital Signature & Controlled Public-Key Registry', () => {
    const privateSeedPhrase = 'ed25519-enterprise-hsm-seed-001';
    const keyPair = deriveEd25519SigningKeyPair(privateSeedPhrase);

    function createPublicKeyRegistration(
      overrides: Partial<ControlledPublicKeyRegistration> = {}
    ): ControlledPublicKeyRegistration {
      return {
        keyId: 'ed25519-key-prod-01',
        algorithm: 'Ed25519',
        publicKeyHex: keyPair.publicKeyHex,
        publicKeyFingerprint: keyPair.publicKeyFingerprint,
        principalId: 'principal:chief-pattern-engineer-01',
        issuer: 'urn:patroner:pki:enterprise-ca',
        tenantId: 'tenant-atelier-01',
        activatedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
        revoked: false,
        trustStatus: 'controlled_local_public_key',
        ...overrides
      };
    }

    it('Crypto 1: verifies valid asymmetric Ed25519 signature using public-key registry entry only (no private key in verifier)', () => {
      const draft = createDraftSkirtSpec();
      const pubRegistration = createPublicKeyRegistration();

      // Verifier receives ONLY public key registration (publicKeyHex), never privateKeyHex or seed
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [pubRegistration],
        trustedIssuers: ['urn:patroner:pki:enterprise-ca'],
        expectedTenantId: 'tenant-atelier-01',
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const signature = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-valid-01',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        {
          keyId: 'ed25519-key-prod-01',
          privateKeyHex: keyPair.privateKeyHex,
          issuer: 'urn:patroner:pki:enterprise-ca',
          tenantId: 'tenant-atelier-01'
        }
      );

      assert.equal(signature.algorithm, 'Ed25519');
      assert.equal(signature.publicKeyHex, keyPair.publicKeyHex);
      assert.equal(signature.signatureHex.length, 128);

      const approved = approveAuthoritativeGarmentSpecification(
        draft,
        'principal:chief-pattern-engineer-01',
        {
          authorityTier: 'cryptographic_principal',
          approverId: 'principal:chief-pattern-engineer-01',
          approvalEventId: 'evt-ed25519-valid-01',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: signature,
          cryptographicVerifier: verifier
        }
      );

      assert.equal(approved.isApproved, true);
      assert.equal(approved.approvalAuthorityTier, 'cryptographic_principal');
      assert.equal(approved.cryptographicSignature?.algorithm, 'Ed25519');

      const recheck = verifySpecificationApproval(approved, { cryptographicVerifier: verifier });
      assert.equal(recheck.isValid, true);
      assert.equal(recheck.authorityTier, 'cryptographic_principal');
    });

    it('Crypto 2: fails verification when Ed25519 signature bytes are mutated', () => {
      const draft = createDraftSkirtSpec();
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration()],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const validSig = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-mutated-02',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      // Flip first byte of 64-byte Ed25519 signature
      const flippedFirstNibbles = validSig.signatureHex.startsWith('00') ? 'ff' : '00';
      const mutatedSig: VerifiableCryptographicSignature = {
        ...validSig,
        signatureHex: flippedFirstNibbles + validSig.signatureHex.slice(2),
        signatureDigest: undefined
      };

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-mutated-02',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: mutatedSig,
          cryptographicVerifier: verifier
        });
      }, /Ed25519 asymmetric digital signature verification failed/);
    });

    it('Crypto 3: fails verification when signed specification fingerprint differs from active specification fingerprint', () => {
      const draft1 = createDraftSkirtSpec({ lengthCm: 68.0 });
      const draft2 = createDraftSkirtSpec({ lengthCm: 74.0 });
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration()],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sigOverDraft1 = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft2.projectId,
          tenantId: draft2.projectId,
          garmentId: draft2.garmentId,
          specificationRevisionId: draft2.specificationRevisionId,
          specificationVersion: draft2.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft1),
          approvalEventId: 'evt-ed25519-fp-03',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft2, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-fp-03',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sigOverDraft1,
          cryptographicVerifier: verifier
        });
      }, /Cryptographic signature verification failed/);
    });

    it('Crypto 4: fails verification when signed specificationRevisionId differs from active revision', () => {
      const draft = createDraftSkirtSpec({ specificationRevisionId: 'spec-rev-active-01' });
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration()],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sigWrongRev = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: 'spec-rev-other-99',
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-rev-04',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-rev-04',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sigWrongRev,
          cryptographicVerifier: verifier
        });
      }, /Cryptographic signature verification failed/);
    });

    it('Crypto 5: fails verification when signed specificationVersion differs from active version', () => {
      const draft = createDraftSkirtSpec({ version: 2 });
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration()],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sigWrongVersion = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: 1, // Wrong version
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-ver-05',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-ver-05',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sigWrongVersion,
          cryptographicVerifier: verifier
        });
      }, /Cryptographic signature verification failed/);
    });

    it('Crypto 6: fails verification when signed projectId or tenantId differs from active context', () => {
      const draft = createDraftSkirtSpec({ projectId: 'tenant-atelier-01' });
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration({ tenantId: 'tenant-atelier-01' })],
        expectedTenantId: 'tenant-atelier-01',
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sigWrongTenant = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: 'tenant-foreign-99',
          tenantId: 'tenant-foreign-99',
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-tenant-06',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex, tenantId: 'tenant-foreign-99' }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-tenant-06',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sigWrongTenant,
          cryptographicVerifier: verifier
        });
      }, /Cryptographic signature verification failed/);
    });

    it('Crypto 7: fails verification when signed garmentId differs from active garment', () => {
      const draft = createDraftSkirtSpec({ garmentId: 'skirt-enterprise-01' });
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration()],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sigWrongGarment = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: 'bodice-other-99',
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-garment-07',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-garment-07',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sigWrongGarment,
          cryptographicVerifier: verifier
        });
      }, /Cryptographic signature verification failed/);
    });

    it('Crypto 8: fails verification when signed approverPrincipal differs from approval record', () => {
      const draft = createDraftSkirtSpec();
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration()],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sigForPrincipalA = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-principal-08',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:impersonator-99', {
          authorityTier: 'cryptographic_principal',
          approverId: 'principal:impersonator-99',
          approvalEventId: 'evt-ed25519-principal-08',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sigForPrincipalA,
          cryptographicVerifier: verifier
        });
      }, /Cryptographic signature verification failed/);
    });

    it('Crypto 9: fails verification when signed approvalTimestamp differs from approval record', () => {
      const draft = createDraftSkirtSpec();
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration()],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sigTimeA = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-time-09',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-time-09',
          approvedAt: '2026-11-10T11:30:00.000Z', // Different timestamp
          cryptographicSignature: sigTimeA,
          cryptographicVerifier: verifier
        });
      }, /Cryptographic signature verification failed/);
    });

    it('Crypto 10: fails verification when signed approvalEventId is replayed across two distinct approval records', () => {
      const draft = createDraftSkirtSpec();
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration()],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sig = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-replay-10',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      // First approval with evt-ed25519-replay-10 succeeds
      const firstApproved = approveAuthoritativeGarmentSpecification(
        draft,
        'principal:chief-pattern-engineer-01',
        {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-replay-10',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sig,
          cryptographicVerifier: verifier
        }
      );
      assert.equal(firstApproved.isApproved, true);

      // Replaying the same approvalEventId on a different specification or timestamp is rejected
      const secondCheck = verifier.verifySignature(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: 'different-garment-id',
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-replay-10',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:05:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        sig
      );
      assert.equal(secondCheck.isValid, false);
      assert.ok(secondCheck.reason?.includes('Replay detected') || secondCheck.reason?.includes('mismatch'));
    });

    it('Crypto 11: fails verification when public key is not registered in ControlledPublicKeyRegistry', () => {
      const draft = createDraftSkirtSpec();
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration({ keyId: 'ed25519-key-prod-01' })],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sigUnregisteredKey = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-unreg-11',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-unregistered-99',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-unregistered-99', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-unreg-11',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sigUnregisteredKey,
          cryptographicVerifier: verifier
        });
      }, /Unregistered or untrusted public keyId/);
    });

    it('Crypto 12: fails verification when registered public key is revoked', () => {
      const draft = createDraftSkirtSpec();
      const revokedRegistration = createPublicKeyRegistration({
        revoked: true,
        revokedAt: '2026-11-01T00:00:00.000Z',
        revocationReason: 'Key compromise suspected',
        trustStatus: 'revoked_key'
      });

      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [revokedRegistration],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sig = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-revoked-12',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-revoked-12',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sig,
          cryptographicVerifier: verifier
        });
      }, /revoked/);
    });

    it('Crypto 13: fails verification when registered public key is expired or not yet active', () => {
      const draft = createDraftSkirtSpec();
      const expiredRegistration = createPublicKeyRegistration({
        activatedAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:00:00.000Z' // Expired before 2026-11-10
      });
      const futureRegistration = createPublicKeyRegistration({
        keyId: 'ed25519-key-future-02',
        activatedAt: '2027-01-01T00:00:00.000Z', // Not yet active at 2026-11-10
        expiresAt: '2028-01-01T00:00:00.000Z'
      });

      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [expiredRegistration, futureRegistration],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const sigExpired = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-expkey-13a',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-expkey-13a',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sigExpired,
          cryptographicVerifier: verifier
        });
      }, /expired/);

      const sigFuture = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-futkey-13b',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-future-02',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-future-02', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-futkey-13b',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: sigFuture,
          cryptographicVerifier: verifier
        });
      }, /not yet active/);
    });

    it('Crypto 14: fails verification when signature algorithm is unsupported or downgraded (legacy SHA256-KEYED-BINDING rejected)', () => {
      const draft = createDraftSkirtSpec();
      const verifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [createPublicKeyRegistration()],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const validSig = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-downgrade-14',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      const downgradedSig: VerifiableCryptographicSignature = {
        ...validSig,
        algorithm: 'SHA256-KEYED-BINDING'
      };

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-downgrade-14',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: downgradedSig,
          cryptographicVerifier: verifier
        });
      }, /Unsupported or downgraded signature algorithm/);
    });

    it('Crypto 15: fails when caller attempts to pass private key or shared secret into publicKeyRegistry verification boundary', () => {
      assert.throws(() => {
        createTrustedCryptographicVerifier({
          publicKeyRegistry: [
            {
              ...createPublicKeyRegistration(),
              privateKeyHex: keyPair.privateKeyHex
            } as unknown as ControlledPublicKeyRegistration
          ]
        });
      }, /Security boundary violation: ControlledPublicKeyRegistration must contain public-key material only/);
    });

    it('Crypto 16: fails verification when cryptographic_principal is claimed without a cryptographic verifier', () => {
      const draft = createDraftSkirtSpec();
      const validSig = signSpecificationApprovalPayload(
        {
          schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
          projectId: draft.projectId,
          tenantId: draft.projectId,
          garmentId: draft.garmentId,
          specificationRevisionId: draft.specificationRevisionId,
          specificationVersion: draft.version,
          canonicalSpecificationFingerprint: computeSpecificationFingerprint(draft),
          approvalEventId: 'evt-ed25519-noverifier-16',
          approverPrincipal: 'principal:chief-pattern-engineer-01',
          authorityTier: 'cryptographic_principal',
          approvalScope: 'specification:approve',
          approvalTimestamp: '2026-11-10T10:00:00.000Z',
          keyId: 'ed25519-key-prod-01',
          algorithm: 'Ed25519'
        },
        { keyId: 'ed25519-key-prod-01', privateKeyHex: keyPair.privateKeyHex }
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'principal:chief-pattern-engineer-01', {
          authorityTier: 'cryptographic_principal',
          approvalEventId: 'evt-ed25519-noverifier-16',
          approvedAt: '2026-11-10T10:00:00.000Z',
          cryptographicSignature: validSig
          // cryptographicVerifier omitted!
        });
      }, /TrustedCryptographicVerifier/);
    });
  });

  // ===========================================================================
  // PART 2: OIDC / JWT ASYMMETRIC EdDSA VERIFICATION BOUNDARY (15 TESTS)
  // ===========================================================================
  describe('Phase 2: OIDC / JWT Identity Provider Verification Boundary', () => {
    const idpSeed = 'oidc-idp-ed25519-signing-seed-001';
    const idpJwk = createOidcPublicJwk({
      keyId: 'idp-kid-2026-01',
      signingSecretOrPrivateKeyHex: idpSeed,
      issuer: 'https://idp.patroner.enterprise',
      activatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z'
    });

    it('OIDC 1: verifies valid compact OIDC/JWT token with trusted issuer, audience, kid, public JWK, active lifetime, and approval claim', () => {
      const draft = createDraftSkirtSpec();

      // Verifier configured with public JWK only (no sharedSecret!)
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-atelier-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const credential = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-atelier-01',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          notBefore: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draft.garmentId,
          targetRevisionId: draft.specificationRevisionId,
          targetSpecificationFingerprint: computeSpecificationFingerprint(draft)
        },
        idpSeed
      );

      // Token must be a genuine 3-part compact JWT
      assert.equal(credential.credentialToken.split('.').length, 3);
      assert.ok(!credential.credentialToken.startsWith('pat-id-v1.'));

      const approved = approveAuthoritativeGarmentSpecification(draft, 'Claire Moreau', {
        authorityTier: 'authenticated_designer',
        approverId: 'oidc|designer-claire-01',
        approvedAt: '2026-11-10T10:00:00.000Z',
        identityCredential: credential,
        identityVerifier: verifier
      });

      assert.equal(approved.isApproved, true);
      assert.equal(approved.approvalAuthorityTier, 'authenticated_designer');
      assert.equal(approved.verifiedIdentity?.verificationMethod, 'OIDC-JWT-EdDSA');
      assert.equal(approved.verifiedIdentity?.subjectId, 'oidc|designer-claire-01');
      assert.equal(approved.verifiedIdentity?.keyId, 'idp-kid-2026-01');
    });

    it('OIDC 2: rejects OIDC/JWT token with invalid or tampered signature', () => {
      const draft = createDraftSkirtSpec();
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const validCred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve']
        },
        'WRONG-IDP-SIGNING-KEY'
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'Claire Moreau', {
          authorityTier: 'authenticated_designer',
          approverId: 'oidc|designer-claire-01',
          approvedAt: '2026-11-10T10:00:00.000Z',
          identityCredential: validCred,
          identityVerifier: verifier
        });
      }, /OIDC\/JWT asymmetric Ed25519 signature verification failed/);
    });

    it('OIDC 3: rejects OIDC/JWT token with alg: "none"', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const headerB64 = base64UrlEncodeUtf8(JSON.stringify({ alg: 'none', typ: 'at+jwt', kid: 'idp-kid-2026-01' }));
      const payloadB64 = base64UrlEncodeUtf8(
        JSON.stringify({
          iss: 'https://idp.patroner.enterprise',
          sub: 'oidc|designer-claire-01',
          aud: 'patroner-spec-approval',
          iat: Math.floor(Date.parse('2026-11-10T09:30:00.000Z') / 1000),
          exp: Math.floor(Date.parse('2026-11-10T11:30:00.000Z') / 1000),
          use: 'specification_approval',
          roles: ['specification:approve']
        })
      );
      const algNoneJwt = `${headerB64}.${payloadB64}.`;

      const res = verifier.verifyCredential({
        credentialToken: algNoneJwt,
        subjectId: 'oidc|designer-claire-01',
        displayName: 'Claire Moreau',
        issuer: 'https://idp.patroner.enterprise',
        audience: 'patroner-spec-approval',
        issuedAt: '2026-11-10T09:30:00.000Z',
        expiresAt: '2026-11-10T11:30:00.000Z',
        claims: ['specification:approve']
      });

      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('alg: "none"') || res.reason?.includes('compact 3-part'));
    });

    it('OIDC 4: rejects OIDC/JWT token with symmetric HS256 or unexpected algorithm', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const headerB64 = base64UrlEncodeUtf8(JSON.stringify({ alg: 'HS256', typ: 'at+jwt', kid: 'idp-kid-2026-01' }));
      const payloadB64 = base64UrlEncodeUtf8(
        JSON.stringify({
          iss: 'https://idp.patroner.enterprise',
          sub: 'oidc|designer-claire-01',
          aud: 'patroner-spec-approval',
          iat: Math.floor(Date.parse('2026-11-10T09:30:00.000Z') / 1000),
          exp: Math.floor(Date.parse('2026-11-10T11:30:00.000Z') / 1000),
          use: 'specification_approval',
          roles: ['specification:approve']
        })
      );
      const hs256Jwt = `${headerB64}.${payloadB64}.${base64UrlEncodeBytes(new Uint8Array(64))}`;

      const res = verifier.verifyCredential({
        credentialToken: hs256Jwt,
        subjectId: 'oidc|designer-claire-01',
        displayName: 'Claire Moreau',
        issuer: 'https://idp.patroner.enterprise',
        audience: 'patroner-spec-approval',
        issuedAt: '2026-11-10T09:30:00.000Z',
        expiresAt: '2026-11-10T11:30:00.000Z',
        claims: ['specification:approve']
      });

      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('Symmetric JWT algorithm') || res.reason?.includes('HS256'));
    });

    it('OIDC 5: rejects OIDC/JWT token signed by unknown kid', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const credUnknownKid = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-unknown-999',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      const res = verifier.verifyCredential(credUnknownKid);
      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('Unknown or untrusted OIDC JWK kid'));
    });

    it('OIDC 6: rejects OIDC/JWT token signed by revoked or expired JWK', () => {
      const revokedJwk: OidcJwkPublicKey = {
        ...idpJwk,
        revoked: true
      };
      const expiredJwk: OidcJwkPublicKey = {
        ...idpJwk,
        kid: 'idp-kid-expired-02',
        activatedAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:00:00.000Z'
      };

      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [revokedJwk, expiredJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const credRevoked = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );
      assert.equal(verifier.verifyCredential(credRevoked).isValid, false);
      assert.ok(verifier.verifyCredential(credRevoked).reason?.includes('revoked'));

      const credExpiredJwk = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-expired-02',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );
      assert.equal(verifier.verifyCredential(credExpiredJwk).isValid, false);
      assert.ok(verifier.verifyCredential(credExpiredJwk).reason?.includes('expired'));
    });

    it('OIDC 7: rejects OIDC/JWT token with wrong iss (issuer)', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const credWrongIss = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://evil-idp.example.com',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      const res = verifier.verifyCredential(credWrongIss);
      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('Untrusted OIDC issuer'));
    });

    it('OIDC 8: rejects OIDC/JWT token with wrong aud (audience)', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const credWrongAud = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'unrelated-billing-service',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      const res = verifier.verifyCredential(credWrongAud);
      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('audience'));
    });

    it('OIDC 9: rejects expired OIDC/JWT token (exp)', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T12:00:00.000Z'
      });

      const credExpired = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T08:00:00.000Z',
          expiresAt: '2026-11-10T09:00:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      const res = verifier.verifyCredential(credExpired);
      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('expired'));
    });

    it('OIDC 10: rejects future OIDC/JWT token (nbf or future iat)', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const credFutureNbf = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T10:00:00.000Z',
          notBefore: '2026-11-10T11:00:00.000Z', // 1 hour in the future
          expiresAt: '2026-11-10T14:00:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      const resNbf = verifier.verifyCredential(credFutureNbf);
      assert.equal(resNbf.isValid, false);
      assert.ok(resNbf.reason?.includes('not valid before'));

      const credFutureIat = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T12:00:00.000Z', // 2 hours in the future
          expiresAt: '2026-11-10T14:00:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      const resIat = verifier.verifyCredential(credFutureIat);
      assert.equal(resIat.isValid, false);
      assert.ok(resIat.reason?.includes('in the future'));
    });

    it('OIDC 11: rejects OIDC/JWT token missing sub or where sub is identical to displayName', () => {
      assert.throws(() => {
        issueVerifiableIdentityCredential(
          {
            subjectId: 'Claire Moreau',
            displayName: 'Claire Moreau', // Identical to subjectId!
            issuer: 'https://idp.patroner.enterprise',
            audience: 'patroner-spec-approval',
            keyId: 'idp-kid-2026-01',
            issuedAt: '2026-11-10T09:30:00.000Z',
            expiresAt: '2026-11-10T11:30:00.000Z',
            claims: ['specification:approve']
          },
          idpSeed
        );
      }, /distinct from displayName/);
    });

    it('OIDC 12: rejects OIDC/JWT token missing specification:approve claim/role', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const credNoRole = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:read-only']
        },
        idpSeed
      );

      const res = verifier.verifyCredential(credNoRole);
      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('specification:approve'));
    });

    it('OIDC 13: rejects OIDC/JWT token issued for wrong project/tenant (tid)', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-atelier-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const credWrongTenant = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-foreign-99',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      const res = verifier.verifyCredential(credWrongTenant);
      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('tenantId'));
    });

    it('OIDC 14: rejects legacy custom pat-id-v1.* token in production authentication mode', () => {
      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      const legacyToken: VerifiableIdentityCredential = {
        credentialToken: 'pat-id-v1.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        subjectId: 'oidc|designer-claire-01',
        displayName: 'Claire Moreau',
        issuer: 'https://idp.patroner.enterprise',
        audience: 'patroner-spec-approval',
        issuedAt: '2026-11-10T09:30:00.000Z',
        expiresAt: '2026-11-10T11:30:00.000Z',
        claims: ['specification:approve']
      };

      const res = verifier.verifyCredential(legacyToken);
      assert.equal(res.isValid, false);
      assert.ok(res.reason?.includes('Legacy pat-id-v1.* custom shared-secret tokens are rejected'));
    });

    it('OIDC 15: fails when authenticated_designer is claimed without an identity verifier or when JWK contains private key parameter d', () => {
      const draft = createDraftSkirtSpec();
      const validCred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-claire-01',
          displayName: 'Claire Moreau',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          keyId: 'idp-kid-2026-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draft, 'Claire Moreau', {
          authorityTier: 'authenticated_designer',
          approverId: 'oidc|designer-claire-01',
          identityCredential: validCred
          // identityVerifier omitted!
        });
      }, /TrustedIdentityVerifier/);

      assert.throws(() => {
        createTrustedIdentityVerifier({
          trustedIssuer: 'https://idp.patroner.enterprise',
          expectedAudience: 'patroner-spec-approval',
          publicJwks: [
            {
              ...idpJwk,
              d: 'private-key-material-forbidden'
            } as unknown as OidcJwkPublicKey
          ]
        });
      }, /Security boundary violation: JWK in publicJwks must not contain private key parameter "d"/);
    });
  });

  // ===========================================================================
  // PART 3: COMPLETE GRADING EXPORT LINEAGE & INDEPENDENT VERIFICATION (14 TESTS)
  // ===========================================================================
  describe('Phase 3 & 4: Complete Grading Export Lineage & Mandatory Export Verification', () => {
    function buildCompleteExportPipelineFixture() {
      const draft = createDraftSkirtSpec();
      const signingKey = deriveEd25519SigningKeyPair(
        'ed25519-key-export-pipeline-01',
        'enterprise-export-pipeline-seed-2026'
      );
      const cryptographicVerifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [
          createControlledPublicKeyRegistration({
            keyId: signingKey.keyId,
            publicKeyHex: signingKey.publicKeyHex,
            principalId: 'principal-master-tailor-01',
            tenantId: 'tenant-atelier-01',
            allowedScopes: ['specification:approve'],
            activatedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z'
          })
        ]
      });

      const spec = approveAuthoritativeGarmentSpecification(draft, 'Certified Master Tailor', {
        authorityTier: 'cryptographic_principal',
        approverId: 'principal-master-tailor-01',
        approvedAt: '2026-11-10T09:00:00.000Z',
        cryptographicKeyConfig: {
          keyId: signingKey.keyId,
          privateKeyHex: signingKey.privateKeyHex
        },
        cryptographicVerifier
      });
      const designSpec = convertToDesignSpecification(spec);
      const pieces = draftSkirtBlock(sizeM, designSpec);
      const graded = gradePattern(designSpec);

      const snapshot = createProductionPatternRevision({
        projectId: 'tenant-atelier-01',
        revisionId: 'rev-enterprise-skirt-01-M',
        targetSize: 'M',
        designSpecification: designSpec,
        measurements: {
          values: ({ ...sizeM } as unknown) as Record<string, number>,
          defaultOrigin: 'user-entered',
          approval: {
            state: 'approved',
            approvedBy: 'Master Tailor',
            approvedAt: '2026-11-10T08:00:00.000Z'
          }
        },
        fabric: standardFabric,
        patternPieces: pieces,
        validation: validReport,
        physicalValidationStatus: 'not-assessed'
      });

      const measFp = computeArtifactInputFingerprint({
        unit: sizeM.unit,
        waist: sizeM.waist,
        lowHip: sizeM.lowHip,
        highHip: sizeM.highHip,
        skirtLength: sizeM.skirtLength,
        bust: sizeM.bust,
        waistToHip: sizeM.waistToHip,
        backWaistLength: sizeM.backWaistLength,
        frontWaistLength: sizeM.frontWaistLength,
        acrossBack: sizeM.acrossBack,
        shoulderLength: sizeM.shoulderLength,
        neckCircumference: sizeM.neckCircumference,
        bustSpan: sizeM.bustSpan,
        bustHeight: sizeM.bustHeight,
        armholeDepth: sizeM.armholeDepth,
        bicepsCircumference: sizeM.bicepsCircumference,
        elbowCircumference: sizeM.elbowCircumference,
        wristCircumference: sizeM.wristCircumference,
        sleeveLength: sizeM.sleeveLength,
        armLengthToElbow: sizeM.armLengthToElbow,
        activeSize: 'M'
      });

      const gradingRulesFp = computeArtifactInputFingerprint({
        system: 'standard-iso-8559',
        baseSize: 'M',
        version: 'iso8559-standard',
        sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
      });

      const gradingArtifact = createAuthoritativeGradingArtifact({
        projectId: 'tenant-atelier-01',
        tenantId: 'tenant-atelier-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: spec.specificationRevisionId,
        sourceSpecificationFingerprint: computeSpecificationFingerprint(spec),
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: measFp,
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: gradingRulesFp,
        baseSize: 'M',
        sizeRange: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        gradedPatternSet: graded,
        basePatternPieces: pieces
      });

      const report = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact,
        verificationContext: { cryptographicVerifier }
      });

      return {
        spec,
        designSpec,
        pieces,
        graded,
        snapshot,
        gradingArtifact,
        report,
        measFp,
        gradingRulesFp,
        cryptographicVerifier
      };
    }

    it('Grading 1: graded export succeeds when specification, measurements, fabric, base draft, geometry validation, grading artifact, and production snapshot are all current and valid', () => {
      const { spec, pieces, snapshot, gradingArtifact, report, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      assert.equal(gradingArtifact.isProductionReady, false);
      assert.equal(report.artifacts.grading.status, 'current');
      assert.equal(report.artifacts.grading.revisionId, gradingArtifact.gradingRevisionId);

      const exportRes = validateProductionExportPrerequisites(report, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: {
          mode: 'graded-multi-size',
          requiredSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
        }
      });

      assert.equal(exportRes.isExportPermitted, true);
      assert.equal(exportRes.manufacturingDocumentation?.isProductionReady, false);
      assert.equal(exportRes.manufacturingDocumentation?.gradingMode, 'graded-multi-size');
      assert.equal(exportRes.manufacturingDocumentation?.gradingArtifactId, gradingArtifact.gradingArtifactId);
      assert.equal(exportRes.manufacturingDocumentation?.gradingArtifactFingerprint, gradingArtifact.canonicalFingerprint);
    });

    it('Grading 2: graded export fails when gradingArtifact is omitted (never infers grading applicability from omission)', () => {
      const { spec, pieces, snapshot, cryptographicVerifier } = buildCompleteExportPipelineFixture();

      const reportWithoutGrading = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportWithoutGrading, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: {
          mode: 'graded-multi-size'
        }
        // gradingArtifact intentionally omitted!
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'GRADING_ARTIFACT_MISSING');
    });

    it('Grading 3: graded export fails when gradingArtifact fingerprint is tampered', () => {
      const { spec, pieces, snapshot, gradingArtifact, report, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const tamperedGrading = {
        ...gradingArtifact,
        baseSize: 'L' // Mutate payload without recomputing canonicalFingerprint
      };

      const exportRes = validateProductionExportPrerequisites(report, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: tamperedGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.ok(
        exportRes.rejectionCode === 'GRADING_ARTIFACT_TAMPERED' ||
          exportRes.rejectionCode === 'FORGED_REPORT_DETECTED'
      );

      // Direct verification without report mismatch confirms GRADING_ARTIFACT_TAMPERED
      const reportNoGa = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        verificationContext: { cryptographicVerifier }
      });
      const directRes = validateProductionExportPrerequisites(reportNoGa, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: tamperedGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });
      assert.equal(directRes.isExportPermitted, false);
      assert.equal(directRes.rejectionCode, 'GRADING_ARTIFACT_TAMPERED');
    });

    it('Grading 4: graded export fails when gradingArtifact.sourceSpecificationRevisionId is stale', () => {
      const { spec, pieces, graded, snapshot, measFp, gradingRulesFp, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const staleRevGrading = createAuthoritativeGradingArtifact({
        projectId: 'tenant-atelier-01',
        tenantId: 'tenant-atelier-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: 'spec-skirt-enterprise-01-v0-stale',
        sourceSpecificationFingerprint: computeSpecificationFingerprint(spec),
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: measFp,
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: gradingRulesFp,
        baseSize: 'M',
        sizeRange: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        gradedPatternSet: graded,
        basePatternPieces: pieces
      });

      const reportStale = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: staleRevGrading,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportStale, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: staleRevGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'STALE_GRADING_RESULT');
    });

    it('Grading 5: graded export fails when gradingArtifact.sourceSpecificationFingerprint is stale', () => {
      const { spec, pieces, graded, snapshot, measFp, gradingRulesFp, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const staleSpecFpGrading = createAuthoritativeGradingArtifact({
        projectId: 'tenant-atelier-01',
        tenantId: 'tenant-atelier-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: spec.specificationRevisionId,
        sourceSpecificationFingerprint: 'a'.repeat(64), // Stale specification fingerprint
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: measFp,
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: gradingRulesFp,
        baseSize: 'M',
        sizeRange: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        gradedPatternSet: graded,
        basePatternPieces: pieces
      });

      const reportStale = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: staleSpecFpGrading,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportStale, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: staleSpecFpGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'STALE_GRADING_RESULT');
    });

    it('Grading 6: graded export fails when gradingArtifact.sourcePatternRevisionId is stale', () => {
      const { spec, pieces, graded, snapshot, measFp, gradingRulesFp, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const stalePatRevGrading = createAuthoritativeGradingArtifact({
        projectId: 'tenant-atelier-01',
        tenantId: 'tenant-atelier-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: spec.specificationRevisionId,
        sourceSpecificationFingerprint: computeSpecificationFingerprint(spec),
        sourcePatternRevisionId: 'rev-obsolete-pattern-000',
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: measFp,
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: gradingRulesFp,
        baseSize: 'M',
        sizeRange: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        gradedPatternSet: graded,
        basePatternPieces: pieces
      });

      const reportStale = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: stalePatRevGrading,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportStale, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: stalePatRevGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'STALE_GRADING_RESULT');
    });

    it('Grading 7: graded export fails when gradingArtifact.sourceMeasurementSetFingerprint is stale', () => {
      const { spec, pieces, graded, snapshot, gradingRulesFp, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const staleMeasFpGrading = createAuthoritativeGradingArtifact({
        projectId: 'tenant-atelier-01',
        tenantId: 'tenant-atelier-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: spec.specificationRevisionId,
        sourceSpecificationFingerprint: computeSpecificationFingerprint(spec),
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: 'b'.repeat(64), // Stale measurement set fingerprint
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: gradingRulesFp,
        baseSize: 'M',
        sizeRange: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        gradedPatternSet: graded,
        basePatternPieces: pieces
      });

      const reportStale = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: staleMeasFpGrading,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportStale, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: staleMeasFpGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'STALE_GRADING_RESULT');
    });

    it('Grading 8: graded export fails when gradingArtifact.gradingRuleSetFingerprint is stale', () => {
      const { spec, pieces, graded, snapshot, measFp, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const staleRuleFpGrading = createAuthoritativeGradingArtifact({
        projectId: 'tenant-atelier-01',
        tenantId: 'tenant-atelier-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: spec.specificationRevisionId,
        sourceSpecificationFingerprint: computeSpecificationFingerprint(spec),
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: measFp,
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: 'c'.repeat(64), // Stale grading rules fingerprint
        baseSize: 'M',
        sizeRange: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        gradedPatternSet: graded,
        basePatternPieces: pieces
      });

      const reportStale = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: staleRuleFpGrading,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportStale, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: staleRuleFpGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'GRADING_RULES_MISMATCH');
    });

    it('Grading 9: graded export fails when any required size is missing from perSizePatternGeometry or sizeRange', () => {
      const { spec, pieces, graded, snapshot, measFp, gradingRulesFp, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      // Create artifact with only S, M, L but require XS, S, M, L, XL, XXL at export
      const partialSizeGrading = createAuthoritativeGradingArtifact({
        projectId: 'tenant-atelier-01',
        tenantId: 'tenant-atelier-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: spec.specificationRevisionId,
        sourceSpecificationFingerprint: computeSpecificationFingerprint(spec),
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: measFp,
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: gradingRulesFp,
        baseSize: 'M',
        sizeRange: ['S', 'M', 'L'],
        gradedPatternSet: graded,
        basePatternPieces: pieces
      });

      const reportPartial = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: partialSizeGrading,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportPartial, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: partialSizeGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: {
          mode: 'graded-multi-size',
          requiredSizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
        }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'GRADING_SIZE_RANGE_INCOMPLETE');
    });

    it('Grading 10: graded export fails when any size fails perSizeGeometryValidation', () => {
      const { spec, pieces, graded, snapshot, measFp, gradingRulesFp, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const failedSizeValidationGrading = createAuthoritativeGradingArtifact({
        projectId: 'tenant-atelier-01',
        tenantId: 'tenant-atelier-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: spec.specificationRevisionId,
        sourceSpecificationFingerprint: computeSpecificationFingerprint(spec),
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: measFp,
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: gradingRulesFp,
        baseSize: 'M',
        sizeRange: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        gradedPatternSet: graded,
        basePatternPieces: pieces,
        perSizeGeometryValidation: {
          XL: { size: 'XL', isValid: false, status: 'invalid', passedCount: 45, warningCount: 0, failureCount: 3 }
        }
      });

      const reportFailedSize = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: failedSizeValidationGrading,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportFailedSize, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: failedSizeValidationGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'GRADING_VALIDATION_FAILED');
    });

    it('Grading 11: graded export fails when crossSizeIntegrityReport is invalid', () => {
      const { spec, pieces, graded, snapshot, measFp, gradingRulesFp, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const failedCrossSizeGrading = createAuthoritativeGradingArtifact({
        projectId: 'tenant-atelier-01',
        tenantId: 'tenant-atelier-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: spec.specificationRevisionId,
        sourceSpecificationFingerprint: computeSpecificationFingerprint(spec),
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: measFp,
        gradingRuleSetRevision: 'rules-grading-iso8559-standard',
        gradingRuleSetFingerprint: gradingRulesFp,
        baseSize: 'M',
        sizeRange: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        gradedPatternSet: graded,
        basePatternPieces: pieces,
        crossSizeIntegrityReport: {
          ...graded.integrityReport,
          isOverallGradingValid: false,
          failedSizeCount: 1
        }
      });

      const reportFailedCross = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: failedCrossSizeGrading,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportFailedCross, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: failedCrossSizeGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'GRADING_VALIDATION_FAILED');
    });

    it('Grading 12: graded export fails when grading artifact is superseded or revoked', () => {
      const { spec, pieces, snapshot, gradingArtifact, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const supersededGa = supersedeAuthoritativeGradingArtifact(gradingArtifact, 'grade-rev-next-02');
      const revokedGa = revokeAuthoritativeGradingArtifact(gradingArtifact, 'Grading curve distortion in XL');

      assert.equal(verifyGradingArtifactIntegrity(supersededGa).isValid, false);
      assert.equal(verifyGradingArtifactIntegrity(revokedGa).isValid, false);

      const reportSuperseded = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: supersededGa,
        verificationContext: { cryptographicVerifier }
      });

      const supersededRes = validateProductionExportPrerequisites(reportSuperseded, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: supersededGa,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });
      assert.equal(supersededRes.isExportPermitted, false);
      assert.equal(supersededRes.rejectionCode, 'GRADING_ARTIFACT_SUPERSEDED');

      const reportRevoked = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        gradingArtifact: revokedGa,
        verificationContext: { cryptographicVerifier }
      });

      const revokedRes = validateProductionExportPrerequisites(reportRevoked, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact: revokedGa,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });
      assert.equal(revokedRes.isExportPermitted, false);
      assert.equal(revokedRes.rejectionCode, 'GRADING_ARTIFACT_REVOKED');
    });

    it('Grading 13: single-size ungraded export succeeds ONLY when exportGradingPolicy.mode === "single-size-ungraded" and nonGradingReason are explicitly declared', () => {
      const { spec, pieces, snapshot, cryptographicVerifier } = buildCompleteExportPipelineFixture();

      const reportNoGa = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportNoGa, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'Bespoke couture single-client atelier toile (Size M only)'
        }
      });

      assert.equal(exportRes.isExportPermitted, true);
      assert.equal(exportRes.manufacturingDocumentation?.isProductionReady, false);
      assert.equal(exportRes.manufacturingDocumentation?.gradingMode, 'single-size-ungraded');
      assert.equal(
        exportRes.manufacturingDocumentation?.nonGradingReason,
        'Bespoke couture single-client atelier toile (Size M only)'
      );
    });

    it('Grading 14: single-size ungraded export fails when nonGradingReason is missing or when graded export data is attached/requested', () => {
      const { spec, pieces, snapshot, gradingArtifact, cryptographicVerifier } =
        buildCompleteExportPipelineFixture();

      const reportNoGa = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        productionSnapshot: snapshot,
        verificationContext: { cryptographicVerifier }
      });

      // Missing nonGradingReason -> GRADING_APPLICABILITY_UNDECLARED
      const missingReasonRes = validateProductionExportPrerequisites(reportNoGa, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: '   '
        }
      });
      assert.equal(missingReasonRes.isExportPermitted, false);
      assert.equal(missingReasonRes.rejectionCode, 'GRADING_APPLICABILITY_UNDECLARED');

      // Contradictory: claiming single-size-ungraded while attaching gradingArtifact or multi-size requiredSizes -> GRADING_SCOPE_MISMATCH
      const contradictoryRes = validateProductionExportPrerequisites(reportNoGa, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validReport,
        gradingArtifact,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: {
          mode: 'single-size-ungraded',
          nonGradingReason: 'Claiming single size while attaching multi-size grading artifact',
          requiredSizes: ['XS', 'S', 'M', 'L']
        }
      });
      assert.equal(contradictoryRes.isExportPermitted, false);
      assert.equal(contradictoryRes.rejectionCode, 'GRADING_SCOPE_MISMATCH');
    });
  });
});
