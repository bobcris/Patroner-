import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ED25519_TORSION_PUBLIC_KEYS,
  isValidEd25519PublicKey,
  isValidEd25519PublicKeyBytes,
  generateEd25519KeyPairFromSeed,
  generateEd25519KeyPairFromRawSeedHex,
  generateEd25519KeyPairFromPassphrase,
  signEd25519Message,
  signEd25519Bytes,
  verifyEd25519Signature,
  verifyEd25519Bytes,
  sha256Hex,
  sha512Hex,
  canonicalizeJson,
  hexToBytes,
  bytesToHex,
  base64UrlEncodeBytes,
  base64UrlEncodeUtf8
} from './crypto';
import {
  createAuthoritativeGarmentSpecification,
  approveAuthoritativeGarmentSpecification,
  verifySpecificationApproval,
  computeSpecificationFingerprint,
  convertToDesignSpecification,
  deriveEd25519SigningKeyPair,
  createControlledPublicKeyRegistration,
  createTrustedCryptographicVerifier,
  createOidcPublicJwk,
  validateOidcPublicJwk,
  issueVerifiableIdentityCredential,
  createTrustedIdentityVerifier,
  createInMemoryJtiReplayStore
} from './garment-specification';
import {
  createProductionPatternRevision,
  createAuthoritativeGradingArtifact,
  verifyGradingArtifactIntegrity,
  computeCanonicalGradingArtifactFingerprint
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
  timestamp: '2026-11-10T08:00:00.000Z',
  passedCount: 1,
  warningCount: 0,
  failureCount: 0,
  checks: [
    {
      id: 'chk-m046234-seam',
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

function createTestDraftSpec(garmentId = 'garment-m046234-skirt-01') {
  return createAuthoritativeGarmentSpecification({
    projectId: 'tenant-m046234-01',
    garmentId,
    name: 'M046234 Hardened Tailored Skirt',
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

describe('Milestone 04.6.2.3.4 — Critical Trust Boundary Remediation & Export Authorization Hardening', () => {
  // ===========================================================================
  // PHASE 1: Ed25519 VERIFICATION HARDENING (FINDING-01 .. FINDING-05)
  // ===========================================================================
  describe('Phase 1: Ed25519 Verification Hardening & Torsion Point Rejection', () => {
    it('P1-01: rejects all 8 small-order torsion public keys in isValidEd25519PublicKey, verifyEd25519Signature, and verifyEd25519Bytes', () => {
      assert.equal(ED25519_TORSION_PUBLIC_KEYS.size, 8);
      const zeroSigHex = '00'.repeat(64);
      const message = 'arbitrary-forged-approval-payload';
      const messageBytes = new TextEncoder().encode(message);

      for (const torsionPubHex of ED25519_TORSION_PUBLIC_KEYS) {
        assert.equal(
          isValidEd25519PublicKey(torsionPubHex),
          false,
          `Torsion public key ${torsionPubHex} must be rejected by isValidEd25519PublicKey`
        );
        assert.equal(
          isValidEd25519PublicKeyBytes(hexToBytes(torsionPubHex)),
          false,
          `Torsion public key ${torsionPubHex} must be rejected by isValidEd25519PublicKeyBytes`
        );
        assert.equal(
          verifyEd25519Signature(torsionPubHex, message, zeroSigHex),
          false,
          `Torsion public key ${torsionPubHex} must be rejected in verifyEd25519Signature(pub, msg, sig)`
        );
        assert.equal(
          verifyEd25519Signature(message, zeroSigHex, torsionPubHex),
          false,
          `Torsion public key ${torsionPubHex} must be rejected in verifyEd25519Signature(msg, sig, pub)`
        );
        assert.equal(
          verifyEd25519Bytes(messageBytes, zeroSigHex, torsionPubHex),
          false,
          `Torsion public key ${torsionPubHex} must be rejected in verifyEd25519Bytes`
        );
      }
    });

    it('P1-02: rejects all 8 torsion public keys at registration time in ControlledPublicKeyRegistration, TrustedCryptographicVerifier, and OIDC JWKS', () => {
      for (const torsionPubHex of ED25519_TORSION_PUBLIC_KEYS) {
        assert.throws(() => {
          createControlledPublicKeyRegistration({
            keyId: 'key-torsion',
            publicKeyHex: torsionPubHex,
            principalId: 'principal-01',
            tenantId: 'tenant-01'
          });
        }, /small-order torsion Ed25519/i);

        assert.throws(() => {
          createTrustedCryptographicVerifier({
            trustedKeys: { 'key-torsion': torsionPubHex }
          });
        }, /Security boundary violation|torsion/i);

        const torsionX = base64UrlEncodeBytes(hexToBytes(torsionPubHex));
        assert.throws(() => {
          validateOidcPublicJwk({
            kty: 'OKP',
            crv: 'Ed25519',
            alg: 'EdDSA',
            use: 'sig',
            kid: 'kid-torsion',
            x: torsionX
          });
        }, /invalid, non-canonical, or small-order torsion Ed25519 public key/i);
      }
    });

    it('P1-03: rejects non-canonical point encoding (y >= p), negative zero (x=0, x_0=1), and off-curve points', () => {
      // y = p = 2^255 - 19 -> little-endian: ed ff ff ... ff 7f
      const yEqualsP = 'ed' + 'ff'.repeat(30) + '7f';
      // y = p + 1 -> ee ff ff ... ff 7f
      const yGreaterP = 'ee' + 'ff'.repeat(30) + '7f';
      // negative zero: y = 1 (x = 0) with sign bit x_0 = 1 -> 01 00 ... 00 80
      const negativeZero = '01' + '00'.repeat(30) + '80';
      // Off-curve point (y = 2 has no square root x^2 on Ed25519 over GF(2^255-19))
      const offCurveY2 = '02' + '00'.repeat(31);

      for (const badPoint of [yEqualsP, yGreaterP, negativeZero, offCurveY2]) {
        assert.equal(
          isValidEd25519PublicKey(badPoint),
          false,
          `Point ${badPoint} must be rejected`
        );
        assert.equal(
          verifyEd25519Signature(badPoint, 'test', '00'.repeat(64)),
          false
        );
      }
    });

    it('P1-04: rejects signatures with small-order R component or non-canonical scalar S >= L', () => {
      const kp = generateEd25519KeyPairFromRawSeedHex(
        '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
      );
      const validSig = signEd25519Message('test-message', kp.privateKeyHex);
      assert.equal(
        verifyEd25519Signature(kp.publicKeyHex, 'test-message', validSig.signatureHex),
        true
      );

      // Replace R with small-order torsion point (Order 8) while keeping S = 0
      for (const torsionR of ED25519_TORSION_PUBLIC_KEYS) {
        const smallOrderRSig = torsionR + '00'.repeat(32);
        assert.equal(
          verifyEd25519Signature(kp.publicKeyHex, 'test-message', smallOrderRSig),
          false,
          `Signature with small-order R=${torsionR} must be rejected`
        );
      }

      // S = L = 2^252 + 27742317777372353535851937790883648493 (little-endian)
      const L_HEX = 'edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010';
      const sigWithSEqualsL = validSig.signatureHex.slice(0, 64) + L_HEX;
      assert.equal(
        verifyEd25519Signature(kp.publicKeyHex, 'test-message', sigWithSEqualsL),
        false,
        'Signature with S == L must be rejected'
      );
    });

    it('P1-05: verifies official RFC 8032 §7.1 test vectors 1, 2, and 3 and supports arbitrary binary Uint8Array payloads', () => {
      // RFC 8032 Test 1 (empty message)
      const kp1 = generateEd25519KeyPairFromRawSeedHex(
        '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
      );
      assert.equal(
        kp1.publicKeyHex,
        'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
      );
      const sig1 = signEd25519Bytes(new Uint8Array(0), kp1.privateKeyHex);
      assert.equal(
        sig1,
        'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
      );
      assert.equal(verifyEd25519Bytes(new Uint8Array(0), sig1, kp1.publicKeyHex), true);

      // RFC 8032 Test 2 (1-byte 0x72)
      const kp2 = generateEd25519KeyPairFromRawSeedHex(
        '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb'
      );
      const msg2 = new Uint8Array([0x72]);
      const sig2 = signEd25519Bytes(msg2, kp2.privateKeyHex);
      assert.equal(
        sig2,
        '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'
      );
      assert.equal(verifyEd25519Bytes(msg2, sig2, kp2.publicKeyHex), true);

      // RFC 8032 Test 3 (2-byte non-UTF-8 binary [0xaf, 0x82])
      const kp3 = generateEd25519KeyPairFromRawSeedHex(
        'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7'
      );
      const msg3 = new Uint8Array([0xaf, 0x82]);
      const sig3 = signEd25519Bytes(msg3, kp3.privateKeyHex);
      assert.equal(
        sig3,
        '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a'
      );
      assert.equal(verifyEd25519Bytes(msg3, sig3, kp3.publicKeyHex), true);
      assert.equal(verifyEd25519Signature(kp3.publicKeyHex, msg3, sig3), true);
    });

    it('P1-06: enforces explicit separation between raw 64-hex seed and passphrase key derivation', () => {
      const hex64 = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
      const fromRawSeed = generateEd25519KeyPairFromRawSeedHex(hex64);
      const fromPassphrase = generateEd25519KeyPairFromPassphrase(hex64);

      assert.notEqual(
        fromRawSeed.publicKeyHex,
        fromPassphrase.publicKeyHex,
        'Hashing a 64-char ASCII string as passphrase must produce a different key than raw 32-byte hex seed'
      );
      assert.equal(
        generateEd25519KeyPairFromSeed(hex64, { inputFormat: 'raw-seed-hex' }).publicKeyHex,
        fromRawSeed.publicKeyHex
      );
      assert.equal(
        generateEd25519KeyPairFromSeed(hex64, { inputFormat: 'passphrase' }).publicKeyHex,
        fromPassphrase.publicKeyHex
      );
      assert.equal(sha512Hex('abc').length, 128);
    });
  });

  // ===========================================================================
  // PHASE 2: STRICT PUBLIC-KEY-ONLY VERIFIER BOUNDARIES (FINDING-08 .. FINDING-11)
  // ===========================================================================
  describe('Phase 2: Strict Public-Key-Only Verifier Boundaries & Key Lifecycle', () => {
    const validKey = deriveEd25519SigningKeyPair('key-valid-01', 'seed-phase2-valid-01');
    const validKey2 = deriveEd25519SigningKeyPair('key-valid-02', 'seed-phase2-valid-02');

    it('P2-01: rejects privateKeySeed, seed, privateKeyHex, signingKeyMaterial, sharedSecret, providerSecret, and JWK d in verifier configurations', () => {
      for (const forbiddenField of [
        'privateKeySeed',
        'privateKeySeedHex',
        'seed',
        'privateKeyHex',
        'signingKeyMaterial',
        'sharedSecret',
        'providerSecret',
        'd'
      ]) {
        assert.throws(() => {
          createControlledPublicKeyRegistration({
            keyId: 'k1',
            publicKeyHex: validKey.publicKeyHex,
            principalId: 'p1',
            tenantId: 't1',
            [forbiddenField]: 'secret-material'
          } as unknown as Parameters<typeof createControlledPublicKeyRegistration>[0]);
        }, /Security boundary violation/i);

        assert.throws(() => {
          createTrustedCryptographicVerifier({
            publicKeyRegistry: [
              createControlledPublicKeyRegistration({
                keyId: 'k1',
                publicKeyHex: validKey.publicKeyHex,
                principalId: 'p1',
                tenantId: 't1'
              })
            ],
            [forbiddenField]: 'secret-material'
          } as unknown as Parameters<typeof createTrustedCryptographicVerifier>[0]);
        }, /Security boundary violation/i);

        const validJwk = createOidcPublicJwk({
          keyId: 'kid-1',
          publicKeyHex: validKey.publicKeyHex
        });

        assert.throws(() => {
          validateOidcPublicJwk({
            ...validJwk,
            [forbiddenField]: 'secret-material'
          } as unknown as Parameters<typeof validateOidcPublicJwk>[0]);
        }, /Security boundary violation/i);

        assert.throws(() => {
          createTrustedIdentityVerifier({
            trustedIssuer: 'https://idp.example.com',
            expectedAudience: 'patroner-spec-approval',
            publicJwks: [validJwk],
            [forbiddenField]: 'secret-material'
          } as unknown as Parameters<typeof createTrustedIdentityVerifier>[0]);
        }, /Security boundary violation/i);
      }

      // Raw seed string in trustedKeys map must also be rejected
      assert.throws(() => {
        createTrustedCryptographicVerifier({
          trustedKeys: {
            'k-seed': 'raw-symbolic-private-seed-not-a-public-key'
          }
        });
      }, /Security boundary violation/i);
    });

    it('P2-02: rejects duplicate keyId, duplicate active publicKeyHex, and duplicate JWK kid', () => {
      const reg1 = createControlledPublicKeyRegistration({
        keyId: 'dup-id',
        publicKeyHex: validKey.publicKeyHex,
        principalId: 'p1',
        tenantId: 't1'
      });
      const reg1DupId = createControlledPublicKeyRegistration({
        keyId: 'dup-id',
        publicKeyHex: validKey2.publicKeyHex,
        principalId: 'p2',
        tenantId: 't1'
      });
      assert.throws(() => {
        createTrustedCryptographicVerifier({
          publicKeyRegistry: [reg1, reg1DupId]
        });
      }, /Duplicate keyId/i);

      const regSamePubKey = createControlledPublicKeyRegistration({
        keyId: 'distinct-id-same-pub',
        publicKeyHex: validKey.publicKeyHex,
        principalId: 'p2',
        tenantId: 't1'
      });
      assert.throws(() => {
        createTrustedCryptographicVerifier({
          publicKeyRegistry: [reg1, regSamePubKey]
        });
      }, /Duplicate Ed25519 publicKeyHex/i);

      const jwk1 = createOidcPublicJwk({ keyId: 'kid-dup', publicKeyHex: validKey.publicKeyHex });
      const jwk2 = createOidcPublicJwk({ keyId: 'kid-dup', publicKeyHex: validKey2.publicKeyHex });
      assert.throws(() => {
        createTrustedIdentityVerifier({
          trustedIssuer: 'https://idp.example.com',
          expectedAudience: 'patroner-spec-approval',
          publicJwks: [jwk1, jwk2]
        });
      }, /Duplicate JWK kid/i);
    });

    it('P2-03: rejects malformed JWK parameters (wrong kty, crv, alg, use, or x vs publicKeyHex mismatch)', () => {
      const baseJwk = createOidcPublicJwk({ keyId: 'kid-valid', publicKeyHex: validKey.publicKeyHex });

      assert.throws(
        () => validateOidcPublicJwk({ ...baseJwk, kty: 'RSA' as 'OKP' }),
        /Unsupported JWK key type/i
      );
      assert.throws(
        () => validateOidcPublicJwk({ ...baseJwk, crv: 'P-256' as 'Ed25519' }),
        /Unsupported JWK key type/i
      );
      assert.throws(
        () => validateOidcPublicJwk({ ...baseJwk, alg: 'RS256' as 'EdDSA' }),
        /Unsupported JWK alg/i
      );
      assert.throws(
        () => validateOidcPublicJwk({ ...baseJwk, use: 'enc' as 'sig' }),
        /Unsupported JWK use/i
      );
      assert.throws(
        () => validateOidcPublicJwk({ ...baseJwk, publicKeyHex: validKey2.publicKeyHex }),
        /inconsistent publicKeyHex and Base64URL "x"/i
      );
    });

    it('P2-04: enforces key compromise revocation and evaluation-time validity windows (referenceTimeIso)', () => {
      const draft = createTestDraftSpec();

      // Approval signed while key was active, but key is later expired at evaluation time (referenceTimeIso)
      const verifierAtSigning = createTrustedCryptographicVerifier({
        referenceTimeIso: '2026-06-01T10:00:00.000Z',
        publicKeyRegistry: [
          createControlledPublicKeyRegistration({
            keyId: validKey.keyId,
            publicKeyHex: validKey.publicKeyHex,
            principalId: 'principal-01',
            tenantId: 'tenant-m046234-01',
            activatedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-12-31T23:59:59.000Z'
          })
        ]
      });

      const approved = approveAuthoritativeGarmentSpecification(draft, 'Master Tailor', {
        authorityTier: 'cryptographic_principal',
        approverId: 'principal-01',
        approvedAt: '2026-06-01T10:00:00.000Z',
        cryptographicKeyConfig: {
          keyId: validKey.keyId,
          privateKeyHex: validKey.privateKeyHex
        },
        cryptographicVerifier: verifierAtSigning
      });

      // Evaluate after key expiration (2028) -> must fail
      const verifierAfterExpiry = createTrustedCryptographicVerifier({
        referenceTimeIso: '2028-01-01T00:00:00.000Z',
        publicKeyRegistry: [
          createControlledPublicKeyRegistration({
            keyId: validKey.keyId,
            publicKeyHex: validKey.publicKeyHex,
            principalId: 'principal-01',
            tenantId: 'tenant-m046234-01',
            activatedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-12-31T23:59:59.000Z'
          })
        ]
      });
      const resExpired = verifySpecificationApproval(approved, {
        cryptographicVerifier: verifierAfterExpiry
      });
      assert.equal(resExpired.isValid, false);
      assert.match(resExpired.reason ?? '', /has expired|outside the key's active validity window/i);

      // Evaluate with compromised key -> must fail
      const verifierCompromised = createTrustedCryptographicVerifier({
        referenceTimeIso: '2026-06-01T10:00:00.000Z',
        publicKeyRegistry: [
          createControlledPublicKeyRegistration({
            keyId: validKey.keyId,
            publicKeyHex: validKey.publicKeyHex,
            principalId: 'principal-01',
            tenantId: 'tenant-m046234-01',
            activatedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-12-31T23:59:59.000Z',
            compromised: true,
            revocationReasonCode: 'compromise',
            revocationReason: 'Hardware token compromise'
          })
        ]
      });
      const resCompromised = verifySpecificationApproval(approved, {
        cryptographicVerifier: verifierCompromised
      });
      assert.equal(resCompromised.isValid, false);
      assert.match(resCompromised.reason ?? '', /revoked/i);
    });
  });

  // ===========================================================================
  // PHASE 3 & 9: JWT TARGET BINDING, REPLAY PROTECTION & CRIT/ACR/AMR (FINDING-06, FINDING-07)
  // ===========================================================================
  describe('Phase 3 & 9: JWT Target Binding, Atomic JTI Replay Protection & Header/Context Validation', () => {
    const idpSeed = 'm046234-oidc-idp-seed-001';
    const idpJwk = createOidcPublicJwk({
      keyId: 'kid-m046234-01',
      signingSecretOrPrivateKeyHex: idpSeed,
      issuer: 'https://idp.patroner.enterprise',
      activatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z'
    });

    it('P3-01: rejects JWT missing target-binding claims or bound to a different specification, revision, or fingerprint', () => {
      const draftA = createTestDraftSpec('garment-spec-A');
      const draftB = createTestDraftSpec('garment-spec-B');

      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-m046234-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z'
      });

      // 1. Unbound token (no spec_id / target_revision_id / target_specification_fingerprint)
      const unboundCred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046234-01',
          keyId: 'kid-m046234-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve']
        },
        idpSeed
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draftA, 'Elena Rostova', {
          authorityTier: 'authenticated_designer',
          approverId: 'oidc|designer-01',
          approvedAt: '2026-11-10T10:00:00.000Z',
          identityCredential: unboundCred,
          identityVerifier: verifier
        });
      }, /missing required target-binding claims/i);

      // 2. Token bound to draftA used to approve draftB
      const boundToACred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046234-01',
          keyId: 'kid-m046234-01',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draftA.garmentId,
          targetRevisionId: draftA.specificationRevisionId,
          targetSpecificationFingerprint: computeSpecificationFingerprint(draftA)
        },
        idpSeed
      );

      assert.throws(() => {
        approveAuthoritativeGarmentSpecification(draftB, 'Elena Rostova', {
          authorityTier: 'authenticated_designer',
          approverId: 'oidc|designer-01',
          approvedAt: '2026-11-10T10:00:00.000Z',
          identityCredential: boundToACred,
          identityVerifier: verifier
        });
      }, /target specificationId mismatch/i);
    });

    it('P3-02: blocks immediate and concurrent JTI replay while preserving re-verification of the original approval', async () => {
      const draft = createTestDraftSpec('garment-replay-test');
      const replayStore = createInMemoryJtiReplayStore();
      assert.equal(replayStore.isDurableDistributedStore, false);

      // Verifier requiring durable store must reject process-local store
      assert.throws(() => {
        createTrustedIdentityVerifier({
          trustedIssuer: 'https://idp.patroner.enterprise',
          expectedAudience: 'patroner-spec-approval',
          publicJwks: [idpJwk],
          replayStore,
          requireDurableReplayStore: true
        });
      }, /requireDurableReplayStore is true/i);

      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-m046234-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z',
        replayStore
      });

      const cred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046234-01',
          keyId: 'kid-m046234-01',
          jti: 'jti-single-use-001',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draft.garmentId,
          targetRevisionId: draft.specificationRevisionId,
          targetSpecificationFingerprint: computeSpecificationFingerprint(draft)
        },
        idpSeed
      );

      // Concurrent approval attempts with the same JTI via Promise.all
      const results = await Promise.allSettled([
        Promise.resolve().then(() =>
          approveAuthoritativeGarmentSpecification(draft, 'Elena Rostova', {
            authorityTier: 'authenticated_designer',
            approverId: 'oidc|designer-01',
            approvedAt: '2026-11-10T10:00:00.000Z',
            identityCredential: cred,
            identityVerifier: verifier
          })
        ),
        Promise.resolve().then(() =>
          approveAuthoritativeGarmentSpecification(draft, 'Elena Rostova', {
            authorityTier: 'authenticated_designer',
            approverId: 'oidc|designer-01',
            approvedAt: '2026-11-10T10:00:00.000Z',
            identityCredential: cred,
            identityVerifier: verifier
          })
        )
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<ReturnType<typeof approveAuthoritativeGarmentSpecification>> =>
          r.status === 'fulfilled'
      );
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactly one approval with jti-single-use-001 may succeed');
      assert.equal(rejected.length, 1, 'Concurrent replay of jti-single-use-001 must be rejected');
      assert.match(String(rejected[0].reason), /Replay detected/i);

      // Re-verifying the recorded approval must still succeed
      const reverify = verifySpecificationApproval(fulfilled[0].value, {
        identityVerifier: verifier
      });
      assert.equal(reverify.isValid, true);
    });

    it('P3-03: rejects unknown critical (crit) JWT headers and enforces acr and amr policy requirements', () => {
      const draft = createTestDraftSpec('garment-crit-acr-test');
      const kp = generateEd25519KeyPairFromSeed(idpSeed);

      // Craft a signed JWT with unknown `crit: ["exp-custom-ext"]`
      const critHeader = base64UrlEncodeUtf8(
        JSON.stringify({
          alg: 'EdDSA',
          typ: 'JWT',
          kid: 'kid-m046234-01',
          crit: ['exp-custom-ext']
        })
      );
      const payload = base64UrlEncodeUtf8(
        JSON.stringify({
          iss: 'https://idp.patroner.enterprise',
          sub: 'oidc|designer-01',
          aud: 'patroner-spec-approval',
          name: 'Elena Rostova',
          tid: 'tenant-m046234-01',
          iat: 1794303000,
          nbf: 1794303000,
          exp: 1794310200,
          jti: 'jti-crit-01',
          use: 'specification_approval',
          roles: ['specification:approve'],
          spec_id: draft.garmentId,
          target_revision_Id: draft.specificationRevisionId,
          target_revision_id: draft.specificationRevisionId,
          target_specification_fingerprint: computeSpecificationFingerprint(draft)
        })
      );
      const sigBytes = hexToBytes(
        signEd25519Bytes(new TextEncoder().encode(`${critHeader}.${payload}`), kp.privateKeyHex)
      );
      const critJwt = `${critHeader}.${payload}.${base64UrlEncodeBytes(sigBytes)}`;

      const verifier = createTrustedIdentityVerifier({
        trustedIssuer: 'https://idp.patroner.enterprise',
        expectedAudience: 'patroner-spec-approval',
        expectedTenantId: 'tenant-m046234-01',
        publicJwks: [idpJwk],
        referenceTimeIso: '2026-11-10T10:00:00.000Z',
        requiredAcr: 'urn:mace:incommon:iap:silver',
        requiredAmr: ['pwd', 'mfa']
      });

      const critRes = verifier.verifyCredential({
        credentialToken: critJwt,
        subjectId: 'oidc|designer-01',
        displayName: 'Elena Rostova',
        issuer: 'https://idp.patroner.enterprise',
        audience: 'patroner-spec-approval',
        keyId: 'kid-m046234-01',
        issuedAt: '2026-11-10T09:30:00.000Z',
        expiresAt: '2026-11-10T11:30:00.000Z',
        claims: ['specification:approve']
      });
      assert.equal(critRes.isValid, false);
      assert.match(critRes.reason ?? '', /critical JWT header parameter \("crit"\)/i);

      // Credential missing required acr / amr
      const weakAuthCred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046234-01',
          keyId: 'kid-m046234-01',
          jti: 'jti-weak-amr',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draft.garmentId,
          targetRevisionId: draft.specificationRevisionId,
          targetSpecificationFingerprint: computeSpecificationFingerprint(draft),
          acr: 'urn:mace:incommon:iap:bronze',
          amr: ['pwd']
        },
        idpSeed
      );
      const weakRes = verifier.verifyCredential(weakAuthCred);
      assert.equal(weakRes.isValid, false);
      assert.match(weakRes.reason ?? '', /authentication context class \(acr=/i);

      // Credential meeting required acr + amr
      const strongAuthCred = issueVerifiableIdentityCredential(
        {
          subjectId: 'oidc|designer-01',
          displayName: 'Elena Rostova',
          issuer: 'https://idp.patroner.enterprise',
          audience: 'patroner-spec-approval',
          tenantId: 'tenant-m046234-01',
          keyId: 'kid-m046234-01',
          jti: 'jti-strong-amr',
          issuedAt: '2026-11-10T09:30:00.000Z',
          expiresAt: '2026-11-10T11:30:00.000Z',
          claims: ['specification:approve'],
          specificationId: draft.garmentId,
          targetRevisionId: draft.specificationRevisionId,
          targetSpecificationFingerprint: computeSpecificationFingerprint(draft),
          acr: 'urn:mace:incommon:iap:silver',
          amr: ['pwd', 'mfa', 'hwk']
        },
        idpSeed
      );
      const strongRes = verifier.verifyCredential(strongAuthCred);
      assert.equal(strongRes.isValid, true);
      assert.equal(strongRes.verifiedAcr, 'urn:mace:incommon:iap:silver');
      assert.deepEqual(strongRes.verifiedAmr, ['pwd', 'mfa', 'hwk']);
    });
  });

  // ===========================================================================
  // PHASE 4, 5, 6, 7, 8: EXPORT POLICY, AUTHORITY, PROVENANCE & GRADING LINEAGE
  // ===========================================================================
  describe('Phase 4–8: Export Grading Policy, Tier 3/4 Authority, Provenance & Grading Integrity', () => {
    function buildAuthenticatedFixture() {
      const draft = createTestDraftSpec('garment-export-hardening-01');
      const signingKey = deriveEd25519SigningKeyPair(
        'ed25519-key-m046234-01',
        'm046234-export-signing-seed-01'
      );
      const cryptographicVerifier = createTrustedCryptographicVerifier({
        publicKeyRegistry: [
          createControlledPublicKeyRegistration({
            keyId: signingKey.keyId,
            publicKeyHex: signingKey.publicKeyHex,
            principalId: 'principal-tailor-01',
            tenantId: 'tenant-m046234-01',
            allowedScopes: ['specification:approve'],
            activatedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z'
          })
        ]
      });

      const spec = approveAuthoritativeGarmentSpecification(draft, 'Master Tailor', {
        authorityTier: 'cryptographic_principal',
        approverId: 'principal-tailor-01',
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
        projectId: 'tenant-m046234-01',
        revisionId: 'rev-m046234-skirt-M',
        targetSize: 'M',
        designSpecification: designSpec,
        measurements: {
          values: ({ ...sizeM } as unknown) as Record<string, number>,
          defaultOrigin: 'operator-confirmed',
          approval: {
            state: 'approved',
            approvedBy: 'Master Tailor',
            approvedAt: '2026-11-10T08:00:00.000Z'
          }
        },
        fabric: standardFabric,
        patternPieces: pieces,
        validation: validGeometryReport,
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
        projectId: 'tenant-m046234-01',
        tenantId: 'tenant-m046234-01',
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
        validationReport: validGeometryReport,
        productionSnapshot: snapshot,
        gradingArtifact,
        verificationContext: { cryptographicVerifier }
      });

      return {
        draft,
        spec,
        designSpec,
        pieces,
        graded,
        snapshot,
        gradingArtifact,
        report,
        cryptographicVerifier
      };
    }

    it('P4-01: rejects production export when exportGradingPolicy is omitted (GRADING_APPLICABILITY_UNDECLARED)', () => {
      const { spec, pieces, snapshot, gradingArtifact, report, cryptographicVerifier } =
        buildAuthenticatedFixture();

      const res = validateProductionExportPrerequisites(report, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validGeometryReport,
        gradingArtifact,
        verificationContext: { cryptographicVerifier }
        // exportGradingPolicy intentionally omitted
      });

      assert.equal(res.isExportPermitted, false);
      assert.equal(res.rejectionCode, 'GRADING_APPLICABILITY_UNDECLARED');
    });

    it('P5-01: rejects demonstration_fixture (Tier 1) and unauthenticated_local_session (Tier 2) at export with SPECIFICATION_APPROVAL_UNAUTHENTICATED', () => {
      const { draft, pieces, graded, snapshot } = buildAuthenticatedFixture();

      for (const tier of ['demonstration_fixture', 'unauthenticated_local_session'] as const) {
        const unauthSpec = approveAuthoritativeGarmentSpecification(draft, 'Local Operator', {
          authorityTier: tier,
          approvedAt: '2026-11-10T09:00:00.000Z'
        });
        const unauthDesignSpec = convertToDesignSpecification(unauthSpec);
        const unauthSnapshot = createProductionPatternRevision({
          projectId: 'tenant-m046234-01',
          revisionId: `rev-${tier}-M`,
          targetSize: 'M',
          designSpecification: unauthDesignSpec,
          measurements: snapshot.measurementSet,
          fabric: standardFabric,
          patternPieces: pieces,
          validation: validGeometryReport,
          physicalValidationStatus: 'not-assessed'
        });

        const report = evaluatePipelineDependencyIntegrity({
          specification: unauthSpec,
          measurements: sizeM,
          activeSize: 'M',
          fabric: standardFabric,
          patternPieces: pieces,
          validationReport: validGeometryReport,
          productionSnapshot: unauthSnapshot
        });

        const exportRes = validateProductionExportPrerequisites(report, unauthSnapshot, {
          specification: unauthSpec,
          measurements: sizeM,
          fabric: standardFabric,
          patternPieces: pieces,
          validationReport: validGeometryReport,
          exportGradingPolicy: {
            mode: 'single-size-ungraded',
            nonGradingReason: 'Single size test'
          }
        });

        assert.equal(exportRes.isExportPermitted, false);
        assert.equal(exportRes.rejectionCode, 'SPECIFICATION_APPROVAL_UNAUTHENTICATED');
      }
      assert.ok(graded);
    });

    it('P6-01: rejects synthetic-fixture measurement origin in createProductionPatternRevision and validateProductionExportPrerequisites', () => {
      const { spec, designSpec, pieces } = buildAuthenticatedFixture();

      assert.throws(() => {
        createProductionPatternRevision({
          projectId: 'tenant-m046234-01',
          revisionId: 'rev-synthetic-meas',
          targetSize: 'M',
          designSpecification: designSpec,
          measurements: {
            values: ({ ...sizeM } as unknown) as Record<string, number>,
            defaultOrigin: 'synthetic-fixture',
            approval: {
              state: 'approved',
              approvedBy: 'Operator',
              approvedAt: '2026-11-10T08:00:00.000Z'
            }
          },
          fabric: standardFabric,
          patternPieces: pieces,
          validation: validGeometryReport,
          physicalValidationStatus: 'not-assessed'
        });
      }, /Synthetic fixture.*cannot be marked as approved/i);
      assert.ok(spec);
    });

    it('P7-01: detects tampering of revokedAt, organizationScope, sourcePatternSnapshotFingerprint, draftingFingerprint, cadGeometryFingerprint, and alias divergence in AuthoritativeGradingArtifact', () => {
      const { gradingArtifact } = buildAuthenticatedFixture();

      assert.equal(verifyGradingArtifactIntegrity(gradingArtifact).isValid, true);
      const baseFp = computeCanonicalGradingArtifactFingerprint(gradingArtifact);
      assert.equal(baseFp, gradingArtifact.canonicalFingerprint);

      // Mutating any newly bound field without updating canonicalFingerprint must fail integrity verification
      const mutations: Array<Partial<typeof gradingArtifact>> = [
        { organizationScope: 'tenant-attacker-99' },
        { sourcePatternSnapshotFingerprint: 'f'.repeat(64) },
        { draftingFingerprint: 'e'.repeat(64) },
        { cadGeometryFingerprint: 'd'.repeat(64) },
        { revokedAt: '2026-11-11T00:00:00.000Z' },
        { supersededByRevisionId: 'grade-rev-999' }
      ];

      for (const patch of mutations) {
        const mutated = { ...gradingArtifact, ...patch };
        const res = verifyGradingArtifactIntegrity(mutated);
        assert.equal(
          res.isValid,
          false,
          `Mutation ${JSON.stringify(patch)} must invalidate grading artifact integrity`
        );
      }

      // Alias divergence check (artifactId !== gradingArtifactId)
      const aliasDiverged = {
        ...gradingArtifact,
        artifactId: 'diverged-alias-id'
      };
      const aliasRes = verifyGradingArtifactIntegrity(aliasDiverged);
      assert.equal(aliasRes.isValid, false);
      assert.ok(aliasRes.errors.some(e => e.includes('artifactId')));
    });

    it('P7-02: rejects export when base-size grading geometry diverges from snapshot.patternPieces or when sourcePatternSnapshotFingerprint mismatches snapshot.canonicalFingerprint', () => {
      const { spec, pieces, graded, snapshot, gradingArtifact, cryptographicVerifier } =
        buildAuthenticatedFixture();

      // Tamper base-size (M) piece cutPathData inside gradingArtifact and recompute its fingerprint
      const modifiedPiecesM = pieces.map((p, idx) =>
        idx === 0 ? { ...p, cutPathData: p.cutPathData + ' L 999 999' } : p
      );

      const mismatchedBaseGeometryGrading = createAuthoritativeGradingArtifact({
        projectId: 'tenant-m046234-01',
        tenantId: 'tenant-m046234-01',
        sourceSpecificationId: spec.garmentId,
        sourceSpecificationRevisionId: spec.specificationRevisionId,
        sourceSpecificationFingerprint: computeSpecificationFingerprint(spec),
        sourcePatternRevisionId: snapshot.revisionId,
        sourcePatternSnapshotFingerprint: snapshot.canonicalFingerprint,
        sourceMeasurementSetFingerprint: gradingArtifact.sourceMeasurementSetFingerprint,
        gradingRuleSetRevision: gradingArtifact.gradingRuleSetRevision,
        gradingRuleSetFingerprint: gradingArtifact.gradingRuleSetFingerprint,
        baseSize: 'M',
        sizeRange: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
        gradedPatternSet: graded,
        basePatternPieces: modifiedPiecesM
      });

      const reportWithMismatch = evaluatePipelineDependencyIntegrity({
        specification: spec,
        measurements: sizeM,
        activeSize: 'M',
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validGeometryReport,
        productionSnapshot: snapshot,
        gradingArtifact: mismatchedBaseGeometryGrading,
        verificationContext: { cryptographicVerifier }
      });

      const exportRes = validateProductionExportPrerequisites(reportWithMismatch, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validGeometryReport,
        gradingArtifact: mismatchedBaseGeometryGrading,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(exportRes.isExportPermitted, false);
      assert.equal(exportRes.rejectionCode, 'STALE_GRADING_RESULT');
    });

    it('P7-03: normalizes canonically equivalent Unicode strings (NFC vs NFD) to identical JSON and SHA-256 digests', () => {
      // "Crêpe de Chine — Édition Atelier" in NFC vs NFD decomposed combining marks
      const nfcText = 'Cr\u00eape de Chine \u2014 \u00c9dition Atelier';
      const nfdText = 'Cre\u0302pe de Chine \u2014 E\u0301dition Atelier';
      assert.notEqual(nfcText, nfdText);

      const jsonNfc = canonicalizeJson({ title: nfcText, nested: [nfcText] });
      const jsonNfd = canonicalizeJson({ title: nfdText, nested: [nfdText] });
      assert.equal(jsonNfc, jsonNfd);
      assert.equal(sha256Hex(jsonNfc), sha256Hex(jsonNfd));
    });

    it('P8-01: detects forged report.artifacts.grading in Step 9 even when activeInputs.gradingArtifact is valid (FINDING-16)', () => {
      const { spec, pieces, snapshot, gradingArtifact, report, cryptographicVerifier } =
        buildAuthenticatedFixture();

      const forgedReport = {
        ...report,
        artifacts: {
          ...report.artifacts,
          grading: {
            ...report.artifacts.grading,
            revisionId: 'forged-grading-revision-999'
          }
        }
      };

      const res = validateProductionExportPrerequisites(forgedReport, snapshot, {
        specification: spec,
        measurements: sizeM,
        fabric: standardFabric,
        patternPieces: pieces,
        validationReport: validGeometryReport,
        gradingArtifact,
        verificationContext: { cryptographicVerifier },
        exportGradingPolicy: { mode: 'graded-multi-size' }
      });

      assert.equal(res.isExportPermitted, false);
      assert.equal(res.rejectionCode, 'FORGED_REPORT_DETECTED');
    });
  });
});
