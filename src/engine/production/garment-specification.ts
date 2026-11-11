/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DesignSpecification } from '../../types';
import { CURRENT_ENGINE_VERSION } from './pattern-revision-snapshot';
import { canonicalizeJson, deepFreeze } from './pattern-revision-snapshot';
import {
  base64UrlDecodeBytes,
  base64UrlDecodeUtf8,
  base64UrlEncodeBytes,
  bytesToHex,
  computeEd25519PublicKeyFingerprint,
  Ed25519KeyPair,
  generateEd25519KeyPairFromSeed,
  hexToBytes,
  OidcJwtHeader,
  OidcJwtPayload,
  sha256Hex,
  signEd25519Message,
  signOidcJwtEdDsa,
  verifyEd25519Signature
} from './crypto';
import {
  ApprovalAuthorityTier,
  ApprovalVerificationContext,
  AuthorityProviderContext,
  AuthoritativeGarmentSpecification,
  ControlledPublicKeyRegistration,
  CreateAuthoritativeSpecificationInput,
  CryptographicApprovalBindingPayload,
  OidcJwkPublicKey,
  ParameterValueProvenance,
  SPECIFICATION_CANONICAL_SCHEMA_VERSION,
  SpecificationApprovalEvent,
  SpecificationApprovalRecord,
  SpecificationApprovalState,
  SpecificationLifecycleEvent,
  SpecificationRevocationEvent,
  SpecificationSupersessionEvent,
  SpecificationValueProvenance,
  TrustedCryptographicVerificationResult,
  TrustedCryptographicVerifier,
  TrustedIdentityVerificationResult,
  TrustedIdentityVerifier,
  VerifiableCryptographicSignature,
  VerifiableIdentityCredential,
  VerifiedIdentityProvenance
} from './garment-specification-types';
import { EnhancedFabricProperty } from '../fabric/fabric-types';
import { ProductionSnapshotValidationError } from './production-types';

const CANONICAL_MISSING_SENTINEL = '__MISSING__' as const;

const VALID_GARMENT_CATEGORIES = new Set(['skirt', 'bodice', 'trouser', 'dress']);
const VALID_SILHOUETTES = new Set(['a-line', 'straight', 'pencil', 'flared', 'tailored', 'relaxed', 'wrap']);
const VALID_EASE_PROFILES = new Set(['ultra-fitted', 'fitted', 'classic', 'relaxed', 'oversized']);

/**
 * Validates whether an ISO date string is syntactically well-formed and parseable.
 */
function isValidIsoDate(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string' || dateStr.trim() === '') return false;
  const epoch = Date.parse(dateStr);
  return Number.isFinite(epoch);
}

/**
 * Locked global authority provider context.
 * CORRECTION B: Global mutable boolean state is NEVER trusted as proof of identity or cryptographic signing.
 * Callers cannot elevate their own approval authority by configuring global boolean flags.
 */
const LOCKED_UNTRUSTED_GLOBAL_PROVIDER_CONTEXT: AuthorityProviderContext = Object.freeze({
  identityProviderConfigured: false,
  cryptographicProviderConfigured: false,
  hasAuthenticatedIdentityProvider: () => false,
  hasCryptographicSigningProvider: () => false
});

export function setAuthorityProviderContext(_ctx: AuthorityProviderContext): void {
  // Security boundary (Correction B): Global mutable authority configuration is disabled.
  // Authority verification requires dependency-injected TrustedIdentityVerifier / TrustedCryptographicVerifier
  // and verifiable credentials/signatures per operation.
}

export function resetAuthorityProviderContext(): void {
  // No-op: global authority context remains permanently locked.
}

export function getAuthorityProviderContext(): AuthorityProviderContext {
  return LOCKED_UNTRUSTED_GLOBAL_PROVIDER_CONTEXT;
}

/**
 * Generates an RFC 8032 Ed25519 asymmetric keypair and controlled public-key registration entry
 * from a seed string or 64-character hex seed.
 */
export function deriveEd25519SigningKeyPair(
  keyIdOrSeed: string,
  privateKeySeed?: string,
  metadata?: {
    readonly issuer?: string;
    readonly providerId?: string;
    readonly tenantId?: string;
    readonly activatedAt?: string;
    readonly expiresAt?: string;
    readonly revoked?: boolean;
    readonly trustStatus?: 'trusted' | 'untrusted' | 'revoked' | 'expired' | 'controlled_local_public_key';
    readonly registrationProvenance?: string;
    readonly allowedPrincipals?: readonly string[];
  }
): Ed25519KeyPair & {
  readonly keyId: string;
  readonly keyPair: Ed25519KeyPair;
  readonly publicKeyRegistration: ControlledPublicKeyRegistration;
} {
  const effectiveKeyId = privateKeySeed !== undefined ? keyIdOrSeed : 'ed25519-key-default';
  const effectiveSeed = privateKeySeed !== undefined ? privateKeySeed : keyIdOrSeed;
  const keyPair = generateEd25519KeyPairFromSeed(effectiveSeed);
  const publicKeyRegistration: ControlledPublicKeyRegistration = Object.freeze({
    keyId: effectiveKeyId,
    publicKeyHex: keyPair.publicKeyHex,
    publicKeyFingerprint: keyPair.publicKeyFingerprint,
    algorithm: 'Ed25519',
    issuer: metadata?.issuer ?? 'patroner-enterprise-kms',
    providerId: metadata?.providerId ?? 'patroner-kms-ed25519',
    tenantId: metadata?.tenantId,
    organizationScope: metadata?.tenantId,
    activatedAt: metadata?.activatedAt,
    expiresAt: metadata?.expiresAt,
    revoked: metadata?.revoked ?? false,
    trustStatus: metadata?.trustStatus ?? (metadata?.revoked ? 'revoked' : 'trusted'),
    registrationProvenance: metadata?.registrationProvenance ?? 'controlled-key-registry',
    allowedPrincipals: metadata?.allowedPrincipals ? [...metadata.allowedPrincipals] : undefined
  });
  return Object.freeze({
    ...keyPair,
    keyId: effectiveKeyId,
    keyPair,
    publicKeyRegistration
  });
}

/**
 * Creates a public-key-only OIDC JWK entry (`kty: 'OKP'`, `crv: 'Ed25519'`, `alg: 'EdDSA'`) from a seed or public key hex.
 */
export function createOidcPublicJwk(
  kidOrOptions:
    | string
    | {
        readonly kid?: string;
        readonly keyId?: string;
        readonly signingSecretOrPrivateKeyHex?: string;
        readonly privateKeySeed?: string;
        readonly publicKeyHex?: string;
        readonly issuer?: string;
        readonly tenantId?: string;
        readonly activatedAt?: string;
        readonly expiresAt?: string;
        readonly revoked?: boolean;
        readonly trustStatus?: 'trusted' | 'untrusted' | 'revoked' | 'expired';
      },
  seedOrPublicKey?: { readonly privateKeySeed?: string; readonly publicKeyHex?: string },
  metadata?: {
    readonly issuer?: string;
    readonly tenantId?: string;
    readonly activatedAt?: string;
    readonly expiresAt?: string;
    readonly revoked?: boolean;
    readonly trustStatus?: 'trusted' | 'untrusted' | 'revoked' | 'expired';
  }
): OidcJwkPublicKey {
  if (typeof kidOrOptions === 'object' && kidOrOptions !== null) {
    const kid = (kidOrOptions.kid ?? kidOrOptions.keyId ?? '').trim();
    const seed = kidOrOptions.signingSecretOrPrivateKeyHex ?? kidOrOptions.privateKeySeed ?? '';
    const pubHex = kidOrOptions.publicKeyHex
      ? kidOrOptions.publicKeyHex.toLowerCase()
      : generateEd25519KeyPairFromSeed(seed).publicKeyHex;
    const pubBytes = hexToBytes(pubHex);
    return Object.freeze({
      kty: 'OKP',
      crv: 'Ed25519',
      kid,
      alg: 'EdDSA',
      use: 'sig',
      x: base64UrlEncodeBytes(pubBytes),
      publicKeyHex: pubHex,
      issuer: kidOrOptions.issuer,
      tenantId: kidOrOptions.tenantId,
      activatedAt: kidOrOptions.activatedAt,
      expiresAt: kidOrOptions.expiresAt,
      revoked: kidOrOptions.revoked ?? false,
      trustStatus: kidOrOptions.trustStatus ?? (kidOrOptions.revoked ? 'revoked' : 'trusted')
    });
  }

  const pubHex = seedOrPublicKey?.publicKeyHex
    ? seedOrPublicKey.publicKeyHex.toLowerCase()
    : generateEd25519KeyPairFromSeed(seedOrPublicKey?.privateKeySeed ?? '').publicKeyHex;
  const pubBytes = hexToBytes(pubHex);
  return Object.freeze({
    kty: 'OKP',
    crv: 'Ed25519',
    kid: kidOrOptions,
    alg: 'EdDSA',
    use: 'sig',
    x: base64UrlEncodeBytes(pubBytes),
    publicKeyHex: pubHex,
    issuer: metadata?.issuer,
    tenantId: metadata?.tenantId,
    activatedAt: metadata?.activatedAt,
    expiresAt: metadata?.expiresAt,
    revoked: metadata?.revoked ?? false,
    trustStatus: metadata?.trustStatus ?? (metadata?.revoked ? 'revoked' : 'trusted')
  });
}

/**
 * Canonicalizes the complete cryptographic approval binding payload for asymmetric signing and verification.
 */
export function canonicalizeApprovalSignaturePayload(
  payload: CryptographicApprovalBindingPayload
): string {
  if (!payload || typeof payload !== 'object') {
    throw new ProductionSnapshotValidationError('Cryptographic approval binding payload must be a non-null object.');
  }
  return canonicalizeJson({
    algorithm: payload.algorithm ?? 'Ed25519',
    approvalEventId: payload.approvalEventId,
    approvalScope: payload.approvalScope ?? 'specification_approval',
    approvalTimestamp: payload.approvalTimestamp,
    approverPrincipal: payload.approverPrincipal,
    authorityTier: payload.authorityTier,
    canonicalSpecificationFingerprint: payload.canonicalSpecificationFingerprint,
    garmentId: payload.garmentId,
    keyId: payload.keyId ?? '',
    projectId: payload.projectId,
    schemaVersion: payload.schemaVersion,
    specificationRevisionId: payload.specificationRevisionId,
    specificationVersion: payload.specificationVersion,
    tenantId: payload.tenantId ?? payload.projectId
  });
}

/**
 * Computes the deterministic SHA-256 digest of the canonical approval binding payload.
 */
export function computeApprovalSignaturePayloadDigest(
  payload: CryptographicApprovalBindingPayload
): string {
  return sha256Hex(canonicalizeApprovalSignaturePayload(payload));
}

/**
 * Signs a CryptographicApprovalBindingPayload using an asymmetric Ed25519 private key
 * to produce a VerifiableCryptographicSignature.
 *
 * Legacy shared-secret SHA-256 constructions are strictly prohibited.
 */
export function signSpecificationApprovalPayload(
  payload: CryptographicApprovalBindingPayload,
  keyMaterial: {
    readonly keyId: string;
    readonly privateKeyHex?: string;
    readonly privateKeySecret?: string;
    readonly signingKeyMaterial?: string;
    readonly algorithm?: string;
    readonly issuer?: string;
    readonly tenantId?: string;
  }
): VerifiableCryptographicSignature {
  const secretOrSeed = keyMaterial.privateKeyHex ?? keyMaterial.privateKeySecret ?? keyMaterial.signingKeyMaterial ?? '';
  if (!keyMaterial.keyId || !secretOrSeed) {
    throw new ProductionSnapshotValidationError('Key ID and asymmetric private key seed are required for cryptographic signing.');
  }
  const requestedAlgorithm = keyMaterial.algorithm ?? payload.algorithm ?? 'Ed25519';
  if (requestedAlgorithm !== 'Ed25519') {
    throw new ProductionSnapshotValidationError(
      `Unsupported cryptographic signing algorithm '${requestedAlgorithm}'. Only asymmetric 'Ed25519' is permitted.`
    );
  }

  const boundPayload: CryptographicApprovalBindingPayload = {
    schemaVersion: payload.schemaVersion,
    projectId: payload.projectId,
    tenantId: payload.tenantId ?? keyMaterial.tenantId ?? payload.projectId,
    garmentId: payload.garmentId,
    specificationRevisionId: payload.specificationRevisionId,
    specificationVersion: payload.specificationVersion,
    canonicalSpecificationFingerprint: payload.canonicalSpecificationFingerprint,
    approvalEventId: payload.approvalEventId,
    approverPrincipal: payload.approverPrincipal,
    authorityTier: 'cryptographic_principal',
    approvalScope: payload.approvalScope ?? 'specification_approval',
    approvalTimestamp: payload.approvalTimestamp,
    keyId: payload.keyId ?? keyMaterial.keyId,
    algorithm: 'Ed25519'
  };

  const canonicalPayload = canonicalizeApprovalSignaturePayload(boundPayload);
  const sigResult = signEd25519Message(canonicalPayload, secretOrSeed);

  return deepFreeze({
    keyId: keyMaterial.keyId,
    publicKeyHex: sigResult.publicKeyHex,
    publicKeyFingerprint: sigResult.publicKeyFingerprint,
    algorithm: 'Ed25519',
    signatureHex: sigResult.signatureHex,
    signatureDigest: sigResult.signatureHex,
    signedPayload: boundPayload
  });
}

/**
 * Creates a trusted asymmetric cryptographic signature verifier backed by a controlled public-key registry.
 *
 * SECURITY INVARIANTS (Milestone 04.6.2.3.2):
 * 1. Signature verification uses ONLY public-key material (`publicKeyHex`).
 * 2. Any ControlledPublicKeyRegistration entry containing private key fields is rejected.
 * 3. Legacy shared-secret `SHA256-KEYED-BINDING` signatures are strictly rejected.
 * 4. Validates key trustStatus, revocation, activation/expiration window, algorithm, tenant scope, and all bound payload fields.
 */
export function createTrustedCryptographicVerifier(config: {
  readonly verifierId?: string;
  readonly trustedIssuers?: readonly string[];
  readonly expectedTenantId?: string;
  readonly referenceTimeIso?: string;
  readonly trustedKeys?:
    | ReadonlyArray<ControlledPublicKeyRegistration>
    | Readonly<Record<string, string>>;
  readonly publicKeyRegistry?: ReadonlyArray<ControlledPublicKeyRegistration>;
}): TrustedCryptographicVerifier & {
  verifySignature(
    expectedPayload: CryptographicApprovalBindingPayload,
    signature: VerifiableCryptographicSignature
  ): TrustedCryptographicVerificationResult & { readonly isValid: boolean };
} {
  const registryEntries: ControlledPublicKeyRegistration[] = [];
  const rawKeysInput = config.trustedKeys ?? config.publicKeyRegistry;

  if (Array.isArray(rawKeysInput)) {
    for (const k of rawKeysInput) {
      const raw = k as unknown as Record<string, unknown>;
      if (
        raw.privateKeyHex !== undefined ||
        raw.privateKeySecret !== undefined ||
        raw.signingKeyMaterial !== undefined ||
        raw.privateKeyPem !== undefined ||
        raw.sharedSecret !== undefined
      ) {
        throw new ProductionSnapshotValidationError(
          `Security boundary violation: ControlledPublicKeyRegistration must contain public-key material only (key '${k.keyId}').`
        );
      }
      if (!k.keyId || !k.publicKeyHex || !/^[0-9a-fA-F]{64}$/.test(k.publicKeyHex)) {
        throw new ProductionSnapshotValidationError(
          `ControlledPublicKeyRegistration for key '${k?.keyId ?? 'unknown'}' requires a valid 64-character hex Ed25519 publicKeyHex.`
        );
      }
      const pubHex = k.publicKeyHex.toLowerCase();
      const computedFp = computeEd25519PublicKeyFingerprint(pubHex);
      if (k.publicKeyFingerprint && k.publicKeyFingerprint !== computedFp) {
        throw new ProductionSnapshotValidationError(
          `Public key fingerprint mismatch for key '${k.keyId}'.`
        );
      }
      const normalizedAllowedPrincipals = k.allowedPrincipals
        ? Object.freeze([...k.allowedPrincipals])
        : k.principalId
          ? Object.freeze([k.principalId])
          : undefined;
      registryEntries.push(
        Object.freeze({
          keyId: k.keyId,
          publicKeyHex: pubHex,
          publicKeyFingerprint: computedFp,
          algorithm: k.algorithm ?? 'Ed25519',
          principalId: k.principalId,
          issuer: k.issuer ?? 'patroner-enterprise-kms',
          providerId: k.providerId ?? 'patroner-kms-ed25519',
          tenantId: k.tenantId ?? k.organizationScope,
          organizationScope: k.organizationScope ?? k.tenantId,
          activatedAt: k.activatedAt,
          expiresAt: k.expiresAt,
          revoked: Boolean(k.revoked),
          revokedAt: k.revokedAt,
          revocationReason: k.revocationReason,
          trustStatus: k.trustStatus ?? (k.revoked ? 'revoked' : 'trusted'),
          registrationProvenance: k.registrationProvenance ?? 'controlled-key-registry',
          allowedPrincipals: normalizedAllowedPrincipals
        })
      );
    }
  } else if (rawKeysInput && typeof rawKeysInput === 'object') {
    for (const [keyId, pubOrSeed] of Object.entries(rawKeysInput as Record<string, string>)) {
      const pubHex =
        pubOrSeed.startsWith('ed25519-pub:') && /^[0-9a-fA-F]{64}$/.test(pubOrSeed.slice(12))
          ? pubOrSeed.slice(12).toLowerCase()
          : generateEd25519KeyPairFromSeed(pubOrSeed).publicKeyHex;
      const pubFp = computeEd25519PublicKeyFingerprint(pubHex);
      registryEntries.push(
        Object.freeze({
          keyId,
          publicKeyHex: pubHex,
          publicKeyFingerprint: pubFp,
          algorithm: 'Ed25519',
          issuer: 'patroner-enterprise-kms',
          providerId: 'patroner-kms-ed25519',
          revoked: false,
          trustStatus: 'trusted',
          registrationProvenance: 'controlled-key-registry'
        })
      );
    }
  }

  const isTrustedStatus = (st?: string) =>
    st === undefined ||
    st === 'trusted' ||
    st === 'controlled_local_public_key' ||
    st === 'enterprise_pki_verified';

  const keyById = new Map(registryEntries.map(k => [k.keyId, k]));
  const trustedPublicKeyFingerprints = registryEntries
    .filter(k => isTrustedStatus(k.trustStatus) && !k.revoked)
    .map(k => k.publicKeyFingerprint!);

  const observedEvents = new Map<string, string>();

  function performVerification(
    signature: VerifiableCryptographicSignature,
    expectedPayload: CryptographicApprovalBindingPayload
  ): TrustedCryptographicVerificationResult & { readonly isValid: boolean } {
    try {
      if (!signature || typeof signature !== 'object' || !signature.signedPayload) {
        return { verified: false, isValid: false, reason: 'Missing or malformed cryptographic signature object.' };
      }

      // Reject legacy shared-secret or non-Ed25519 algorithms immediately
      if (signature.algorithm === 'SHA256-KEYED-BINDING' || signature.algorithm !== 'Ed25519') {
        return {
          verified: false,
          isValid: false,
          reason: `Unsupported or downgraded signature algorithm '${signature.algorithm}'. Asymmetric 'Ed25519' signature is required.`
        };
      }

      const trustedKey = keyById.get(signature.keyId);
      if (!trustedKey) {
        return {
          verified: false,
          isValid: false,
          reason: `Unregistered or untrusted public keyId '${signature.keyId}' not found in controlled public-key registry.`
        };
      }

      if (trustedKey.revoked || trustedKey.trustStatus === 'revoked' || trustedKey.trustStatus === 'revoked_key') {
        return {
          verified: false,
          isValid: false,
          reason: `Signing key '${signature.keyId}' has been revoked${trustedKey.revocationReason ? `: ${trustedKey.revocationReason}` : ''}.`
        };
      }

      if (!isTrustedStatus(trustedKey.trustStatus)) {
        return {
          verified: false,
          isValid: false,
          reason: `Signing key '${signature.keyId}' is not trusted (status: '${trustedKey.trustStatus}').`
        };
      }

      if (trustedKey.algorithm !== 'Ed25519' || trustedKey.algorithm !== signature.algorithm) {
        return {
          verified: false,
          isValid: false,
          reason: `Signing key '${signature.keyId}' algorithm '${trustedKey.algorithm}' does not match signature algorithm '${signature.algorithm}'.`
        };
      }

      if (signature.publicKeyFingerprint !== trustedKey.publicKeyFingerprint) {
        return {
          verified: false,
          isValid: false,
          reason: `Public key fingerprint '${signature.publicKeyFingerprint}' does not match registered public key for '${signature.keyId}'.`
        };
      }

      if (signature.publicKeyHex && signature.publicKeyHex.toLowerCase() !== trustedKey.publicKeyHex) {
        return {
          verified: false,
          isValid: false,
          reason: `Public key material on signature does not match registered public key for '${signature.keyId}'.`
        };
      }

      if (
        config.trustedIssuers &&
        config.trustedIssuers.length > 0 &&
        (!trustedKey.issuer || !config.trustedIssuers.includes(trustedKey.issuer))
      ) {
        return {
          verified: false,
          isValid: false,
          reason: `Signing key issuer '${trustedKey.issuer ?? 'unknown'}' is not in the trusted issuers allowlist.`
        };
      }

      // Validate key activation and expiration window
      const evalTimeIso = config.referenceTimeIso ?? expectedPayload.approvalTimestamp;
      if (!isValidIsoDate(expectedPayload.approvalTimestamp) || !isValidIsoDate(evalTimeIso)) {
        return {
          verified: false,
          isValid: false,
          reason: 'Approval or verification timestamp is not a valid ISO 8601 date.'
        };
      }
      const approvalMs = Date.parse(expectedPayload.approvalTimestamp);
      const evalMs = Date.parse(evalTimeIso);

      if (trustedKey.activatedAt) {
        if (!isValidIsoDate(trustedKey.activatedAt)) {
          return { verified: false, isValid: false, reason: `Signing key '${signature.keyId}' has an invalid activatedAt timestamp.` };
        }
        const activatedMs = Date.parse(trustedKey.activatedAt);
        if (approvalMs < activatedMs || evalMs < activatedMs) {
          return {
            verified: false,
            isValid: false,
            reason: `Signing key '${signature.keyId}' was not yet active at approval timestamp '${expectedPayload.approvalTimestamp}' (activatedAt: '${trustedKey.activatedAt}').`
          };
        }
      }

      if (trustedKey.expiresAt) {
        if (!isValidIsoDate(trustedKey.expiresAt)) {
          return { verified: false, isValid: false, reason: `Signing key '${signature.keyId}' has an invalid expiresAt timestamp.` };
        }
        const expiresMs = Date.parse(trustedKey.expiresAt);
        if (approvalMs >= expiresMs || evalMs >= expiresMs) {
          return {
            verified: false,
            isValid: false,
            reason: `Signing key '${signature.keyId}' expired at '${trustedKey.expiresAt}' prior to approval or verification.`
          };
        }
      }

      // Validate tenant / organization scope binding
      const expectedTenant = config.expectedTenantId ?? expectedPayload.tenantId ?? expectedPayload.projectId;
      const signedTenant = signature.signedPayload.tenantId ?? signature.signedPayload.projectId;
      if (trustedKey.tenantId && trustedKey.tenantId !== expectedTenant) {
        return {
          verified: false,
          isValid: false,
          reason: `Signing key '${signature.keyId}' tenant scope '${trustedKey.tenantId}' does not match specification tenant/project '${expectedTenant}'.`
        };
      }
      if (signedTenant !== expectedTenant) {
        return {
          verified: false,
          isValid: false,
          reason: `Cryptographic signature verification failed: signed payload tenant '${signedTenant}' does not match expected tenant/project '${expectedTenant}'.`
        };
      }

      if (
        trustedKey.allowedPrincipals &&
        trustedKey.allowedPrincipals.length > 0 &&
        !trustedKey.allowedPrincipals.includes(expectedPayload.approverPrincipal)
      ) {
        return {
          verified: false,
          isValid: false,
          reason: `Cryptographic signature verification failed: Principal '${expectedPayload.approverPrincipal}' is not authorized to sign with key '${signature.keyId}'.`
        };
      }

      // Verify exact match of all bound payload fields
      const sp = signature.signedPayload;
      const signedScope = sp.approvalScope ?? 'specification_approval';
      const expectedScope = expectedPayload.approvalScope ?? signedScope;
      const isStandardSpecScope = (s: string) =>
        s === 'specification_approval' || s === 'specification:approve';
      const isValidApprovalScope = isStandardSpecScope(signedScope);
      const scopesMatch =
        signedScope === expectedScope ||
        (isStandardSpecScope(signedScope) && isStandardSpecScope(expectedScope));
      const signedKeyId = sp.keyId ?? signature.keyId;
      const signedAlg = sp.algorithm ?? signature.algorithm;

      if (
        sp.projectId !== expectedPayload.projectId ||
        signedTenant !== expectedTenant ||
        sp.garmentId !== expectedPayload.garmentId ||
        sp.specificationRevisionId !== expectedPayload.specificationRevisionId ||
        sp.specificationVersion !== expectedPayload.specificationVersion ||
        sp.canonicalSpecificationFingerprint !== expectedPayload.canonicalSpecificationFingerprint ||
        sp.approvalEventId !== expectedPayload.approvalEventId ||
        sp.approverPrincipal !== expectedPayload.approverPrincipal ||
        sp.authorityTier !== 'cryptographic_principal' ||
        !isValidApprovalScope ||
        !scopesMatch ||
        sp.approvalTimestamp !== expectedPayload.approvalTimestamp ||
        sp.schemaVersion !== expectedPayload.schemaVersion ||
        signedKeyId !== signature.keyId ||
        signedAlg !== 'Ed25519'
      ) {
        const isReplayMismatch = observedEvents.has(expectedPayload.approvalEventId);
        return {
          verified: false,
          isValid: false,
          reason: `Cryptographic signature verification failed: signed approval payload mismatch${isReplayMismatch ? ' (Replay detected for approvalEventId)' : ''} — does not match expected specification revision, fingerprint, event ID, tenant scope, timestamp, keyId, or principal.`
        };
      }

      const normalizedExpectedPayload: CryptographicApprovalBindingPayload = {
        schemaVersion: expectedPayload.schemaVersion,
        projectId: expectedPayload.projectId,
        tenantId: expectedTenant,
        garmentId: expectedPayload.garmentId,
        specificationRevisionId: expectedPayload.specificationRevisionId,
        specificationVersion: expectedPayload.specificationVersion,
        canonicalSpecificationFingerprint: expectedPayload.canonicalSpecificationFingerprint,
        approvalEventId: expectedPayload.approvalEventId,
        approverPrincipal: expectedPayload.approverPrincipal,
        authorityTier: 'cryptographic_principal',
        approvalScope: signedScope,
        approvalTimestamp: expectedPayload.approvalTimestamp,
        keyId: signature.keyId,
        algorithm: 'Ed25519'
      };

      const expectedCanonical = canonicalizeApprovalSignaturePayload(normalizedExpectedPayload);
      const expectedDigest = sha256Hex(expectedCanonical);

      // Replay check on approvalEventId across distinct payloads
      const existingDigestForEvent = observedEvents.get(expectedPayload.approvalEventId);
      if (existingDigestForEvent && existingDigestForEvent !== expectedDigest) {
        return {
          verified: false,
          isValid: false,
          reason: `Cryptographic signature verification failed: Replay detected for approvalEventId '${expectedPayload.approvalEventId}'.`
        };
      }

      const rawSigHex =
        signature.signatureDigest && signature.signatureDigest !== signature.signatureHex
          ? signature.signatureDigest
          : (signature.signatureHex ?? signature.signatureDigest ?? '');

      // Perform genuine RFC 8032 Ed25519 public-key verification using ONLY trustedKey.publicKeyHex
      const isSignatureValid = verifyEd25519Signature(
        trustedKey.publicKeyHex,
        expectedCanonical,
        rawSigHex
      );

      if (!isSignatureValid) {
        return {
          verified: false,
          isValid: false,
          reason: 'Cryptographic signature verification failed: Ed25519 asymmetric digital signature verification failed.'
        };
      }

      observedEvents.set(expectedPayload.approvalEventId, expectedDigest);

      return {
        verified: true,
        isValid: true,
        keyId: signature.keyId,
        algorithm: 'Ed25519',
        publicKeyFingerprint: trustedKey.publicKeyFingerprint,
        verifiedPayloadDigest: expectedDigest
      };
    } catch (err) {
      return {
        verified: false,
        isValid: false,
        reason: `Cryptographic verifier exception: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  return Object.freeze({
    verifierId: config.verifierId ?? 'crypto-verifier-ed25519',
    trustedPublicKeyFingerprints: Object.freeze([...trustedPublicKeyFingerprints]),
    publicKeyRegistry: Object.freeze([...registryEntries]),
    verifyApprovalSignature(
      signature: VerifiableCryptographicSignature,
      expectedPayload: CryptographicApprovalBindingPayload
    ): TrustedCryptographicVerificationResult {
      return performVerification(signature, expectedPayload);
    },
    verifySignature(
      expectedPayload: CryptographicApprovalBindingPayload,
      signature: VerifiableCryptographicSignature
    ): TrustedCryptographicVerificationResult & { readonly isValid: boolean } {
      return performVerification(signature, expectedPayload);
    }
  });
}

/**
 * Issues a verifiable OIDC/JWT identity credential (`header.payload.signature`) signed with
 * an asymmetric EdDSA (Ed25519) identity-provider private key.
 *
 * Legacy `pat-id-v1.*` shared-secret hashes are strictly prohibited.
 */
export function issueVerifiableIdentityCredential(
  params: {
    readonly credentialId?: string;
    readonly subject?: string;
    readonly subjectId?: string;
    readonly expectedApprover?: string;
    readonly displayName?: string;
    readonly issuer: string;
    readonly audience: string;
    readonly tenantId?: string;
    readonly keyId?: string;
    readonly algorithm?: string;
    readonly tokenType?: string;
    readonly intendedUse?: string;
    readonly notBefore?: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly authorizationClaims?: readonly string[];
    readonly claims?: readonly string[];
    readonly providerId?: string;
  },
  idpPrivateKeySeed: string
): VerifiableIdentityCredential & { readonly token: string; readonly credentialToken: string } {
  const subject = (params.subject ?? params.subjectId ?? '').trim();
  const expectedApprover = (params.expectedApprover ?? params.displayName ?? '').trim();
  if (!subject || (expectedApprover && subject === expectedApprover)) {
    throw new ProductionSnapshotValidationError(
      'Identity credential subjectId must be a non-empty opaque identifier distinct from displayName.'
    );
  }
  const authorizationClaims = [...(params.authorizationClaims ?? params.claims ?? [])];
  const credentialId = params.credentialId ?? `jti-${subject || 'anon'}`;
  const providerId = params.providerId ?? 'patroner-oidc-idp';
  const keyId = params.keyId ?? 'idp-eddsa-key-01';
  const algorithm = params.algorithm ?? 'EdDSA';
  const tokenType = params.tokenType ?? 'at+jwt';
  const intendedUse = params.intendedUse ?? 'specification_approval';
  const notBeforeIso = params.notBefore ?? params.issuedAt;

  const iatSec = Math.floor(Date.parse(params.issuedAt) / 1000);
  const nbfSec = Math.floor(Date.parse(notBeforeIso) / 1000);
  const expSec = Math.floor(Date.parse(params.expiresAt) / 1000);

  const header: OidcJwtHeader = {
    alg: algorithm,
    typ: tokenType,
    kid: keyId
  };

  const payload: OidcJwtPayload = {
    iss: params.issuer,
    sub: subject,
    aud: params.audience,
    jti: credentialId,
    iat: iatSec,
    nbf: nbfSec,
    exp: expSec,
    name: expectedApprover,
    roles: authorizationClaims,
    use: intendedUse,
    provider_id: providerId,
    ...(params.tenantId ? { tid: params.tenantId } : {})
  };

  const { jwt } = signOidcJwtEdDsa(header, payload, idpPrivateKeySeed);

  return deepFreeze({
    credentialId,
    subject,
    subjectId: subject,
    expectedApprover,
    displayName: expectedApprover,
    issuer: params.issuer,
    audience: params.audience,
    tenantId: params.tenantId,
    keyId,
    algorithm,
    tokenType,
    intendedUse,
    notBefore: notBeforeIso,
    issuedAt: params.issuedAt,
    expiresAt: params.expiresAt,
    authorizationClaims,
    claims: authorizationClaims,
    providerId,
    token: jwt,
    credentialToken: jwt
  });
}

/**
 * Creates a trusted OIDC/JWT identity verifier that validates asymmetric EdDSA JWT signatures
 * against a trusted JWKS public-key registry along with issuer, audience, subject, tenant,
 * expiration (`exp`), not-before (`nbf`), issued-at (`iat`), token type (`typ`), intended use (`use`),
 * and authorization claims (`specification:approve`).
 */
export function createTrustedIdentityVerifier(config: {
  readonly verifierId?: string;
  readonly trustedIssuers?: readonly string[];
  readonly trustedIssuer?: string;
  readonly expectedAudience: string;
  readonly expectedTenantId?: string;
  readonly jwks?: readonly OidcJwkPublicKey[];
  readonly publicJwks?: readonly OidcJwkPublicKey[];
  readonly providerSecret?: string;
  readonly sharedSecret?: string;
  readonly requiredClaim?: string;
  readonly referenceTimeIso?: string;
  readonly maxClockSkewSeconds?: number;
}): TrustedIdentityVerifier & {
  verifyIdentityCredential(
    credential: VerifiableIdentityCredential,
    context: {
      readonly targetRevisionId: string;
      readonly targetSpecificationFingerprint: string;
      readonly expectedApprover: string;
      readonly approvalTimestamp: string;
      readonly expectedTenantId?: string;
    }
  ): TrustedIdentityVerificationResult;
  verifyCredential(
    credential: VerifiableIdentityCredential,
    context?: unknown
  ): TrustedIdentityVerificationResult & { readonly isValid: boolean };
} {
  const requiredClaim = config.requiredClaim ?? 'specification:approve';
  const trustedIssuers = config.trustedIssuers ?? (config.trustedIssuer ? [config.trustedIssuer] : []);
  const verifierId = config.verifierId ?? 'oidc-jwt-verifier-eddsa';
  const clockSkewSec = config.maxClockSkewSeconds ?? 0;

  const publicJwks: OidcJwkPublicKey[] = [];
  const rawJwksInput = config.jwks ?? config.publicJwks;
  if (Array.isArray(rawJwksInput)) {
    for (const jwk of rawJwksInput) {
      const raw = jwk as unknown as Record<string, unknown>;
      if (raw.d !== undefined || raw.privateKeyHex !== undefined || raw.privateKeySecret !== undefined) {
        throw new ProductionSnapshotValidationError(
          `Security boundary violation: JWK in publicJwks must not contain private key parameter "d" (kid '${jwk.kid}').`
        );
      }
      let pubHex = jwk.publicKeyHex ? jwk.publicKeyHex.toLowerCase() : undefined;
      if (!pubHex && jwk.x) {
        pubHex = bytesToHex(base64UrlDecodeBytes(jwk.x));
      }
      if (!jwk.kid || !pubHex || pubHex.length !== 64) {
        throw new ProductionSnapshotValidationError(
          `OIDC JWK '${jwk?.kid ?? 'unknown'}' requires a valid 32-byte Ed25519 public key ('x' or 'publicKeyHex').`
        );
      }
      publicJwks.push(
        Object.freeze({
          kty: 'OKP',
          crv: 'Ed25519',
          kid: jwk.kid,
          alg: jwk.alg ?? 'EdDSA',
          use: jwk.use ?? 'sig',
          x: jwk.x ?? base64UrlEncodeBytes(hexToBytes(pubHex)),
          publicKeyHex: pubHex,
          issuer: jwk.issuer,
          tenantId: jwk.tenantId,
          activatedAt: jwk.activatedAt,
          expiresAt: jwk.expiresAt,
          revoked: Boolean(jwk.revoked),
          trustStatus: jwk.trustStatus ?? (jwk.revoked ? 'revoked' : 'trusted')
        })
      );
    }
  } else {
    const seed = config.providerSecret ?? config.sharedSecret ?? '';
    if (seed) {
      publicJwks.push(
        createOidcPublicJwk('idp-eddsa-key-01', { privateKeySeed: seed }, {
          issuer: trustedIssuers[0],
          tenantId: config.expectedTenantId
        })
      );
    }
  }

  const jwkByKid = new Map(publicJwks.map(k => [k.kid, k]));

  function performIdentityVerification(
    credential: VerifiableIdentityCredential,
    context?: {
      readonly targetRevisionId?: string;
      readonly targetSpecificationFingerprint?: string;
      readonly expectedApprover?: string;
      readonly approvalTimestamp?: string;
      readonly expectedTenantId?: string;
    }
  ): TrustedIdentityVerificationResult & { readonly isValid: boolean } {
    try {
      if (!credential || typeof credential !== 'object') {
        return { verified: false, isValid: false, reason: 'Identity credential is missing or malformed.' };
      }
      const rawToken = credential.token ?? credential.credentialToken;
      if (!rawToken || typeof rawToken !== 'string') {
        return { verified: false, isValid: false, reason: 'OIDC JWT token is missing.' };
      }

      // Reject legacy custom pat-id-v1 shared-secret tokens immediately
      if (rawToken.startsWith('pat-id-v1.')) {
        return {
          verified: false,
          isValid: false,
          reason: 'Legacy pat-id-v1.* custom shared-secret tokens are rejected; a signed OIDC/JWT token is required.'
        };
      }

      const parts = rawToken.split('.');
      if (parts.length !== 3 || !parts[0] || !parts[1]) {
        return {
          verified: false,
          isValid: false,
          reason: 'Malformed OIDC JWT: token must be a compact 3-part Base64URL string (header.payload.signature).'
        };
      }

      const [encodedHeader, encodedPayload, encodedSignature] = parts;
      let header: OidcJwtHeader;
      let payload: OidcJwtPayload;
      try {
        header = JSON.parse(base64UrlDecodeUtf8(encodedHeader)) as OidcJwtHeader;
        payload = JSON.parse(base64UrlDecodeUtf8(encodedPayload)) as OidcJwtPayload;
      } catch {
        return {
          verified: false,
          isValid: false,
          reason: 'Malformed OIDC JWT: unable to decode Base64URL JSON header or payload.'
        };
      }

      if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') {
        return { verified: false, isValid: false, reason: 'Malformed OIDC JWT header or payload structure.' };
      }

      // Strictly reject alg: "none" and any non-EdDSA / symmetric HMAC algorithm
      if (!header.alg || header.alg.toLowerCase() === 'none') {
        return {
          verified: false,
          isValid: false,
          reason: 'OIDC JWT verification rejected: unsigned JWT (alg: "none") is strictly prohibited.'
        };
      }
      if (header.alg !== 'EdDSA') {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT verification rejected: Symmetric JWT algorithm or unsupported algorithm '${header.alg}' is prohibited; asymmetric 'EdDSA' required.`
        };
      }
      if (credential.algorithm && credential.algorithm !== header.alg) {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT algorithm mismatch between credential metadata ('${credential.algorithm}') and JWT header ('${header.alg}').`
        };
      }

      // Validate JWT token type (typ)
      if (!header.typ || (header.typ !== 'at+jwt' && header.typ !== 'JWT')) {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT verification rejected: invalid token type '${header.typ ?? 'missing'}' (expected 'at+jwt' or 'JWT').`
        };
      }

      // Validate key ID (kid) against trusted JWKS registry
      if (!header.kid || typeof header.kid !== 'string' || header.kid.trim() === '') {
        return {
          verified: false,
          isValid: false,
          reason: 'OIDC JWT verification rejected: missing key ID (kid) in JWT header.'
        };
      }
      const jwk = jwkByKid.get(header.kid);
      if (!jwk) {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT verification rejected: Unknown or untrusted OIDC JWK kid '${header.kid}' not found in trusted JWKS.`
        };
      }
      if (jwk.revoked || jwk.trustStatus === 'revoked' || jwk.trustStatus === 'revoked_key') {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT verification rejected: JWKS public key '${jwk.kid}' has been revoked.`
        };
      }
      if (
        jwk.trustStatus !== undefined &&
        jwk.trustStatus !== 'trusted' &&
        jwk.trustStatus !== 'controlled_local_public_key' &&
        jwk.trustStatus !== 'enterprise_pki_verified'
      ) {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT verification rejected: JWKS public key '${jwk.kid}' is not trusted (status: '${jwk.trustStatus}').`
        };
      }
      if (jwk.alg !== 'EdDSA' || jwk.alg !== header.alg) {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT verification rejected: JWKS key '${jwk.kid}' algorithm '${jwk.alg}' does not match JWT header '${header.alg}'.`
        };
      }

      const approvalTimestamp = context?.approvalTimestamp ?? config.referenceTimeIso ?? credential.issuedAt;
      const evalTimestamp = config.referenceTimeIso ?? approvalTimestamp;
      if (!isValidIsoDate(evalTimestamp) || !isValidIsoDate(approvalTimestamp)) {
        return {
          verified: false,
          isValid: false,
          reason: 'Approval or verification timestamp is not a valid ISO 8601 date.'
        };
      }
      const evalMs = Date.parse(evalTimestamp);
      const approvalMs = Date.parse(approvalTimestamp);

      if (jwk.activatedAt && (evalMs < Date.parse(jwk.activatedAt) || approvalMs < Date.parse(jwk.activatedAt))) {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT verification rejected: JWKS key '${jwk.kid}' was not yet active.`
        };
      }
      if (jwk.expiresAt && (evalMs >= Date.parse(jwk.expiresAt) || approvalMs >= Date.parse(jwk.expiresAt))) {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT verification rejected: JWKS key '${jwk.kid}' has expired.`
        };
      }

      // Verify cryptographic Ed25519 signature over header.payload using ONLY the JWK public key
      if (!encodedSignature) {
        return {
          verified: false,
          isValid: false,
          reason: 'OIDC JWT verification rejected: missing cryptographic signature segment.'
        };
      }
      let sigBytes: Uint8Array;
      try {
        sigBytes = base64UrlDecodeBytes(encodedSignature);
      } catch {
        return {
          verified: false,
          isValid: false,
          reason: 'OIDC JWT verification rejected: malformed Base64URL signature.'
        };
      }
      if (sigBytes.length !== 64) {
        return {
          verified: false,
          isValid: false,
          reason: 'OIDC JWT verification rejected: invalid Ed25519 signature length.'
        };
      }
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const isJwtSigValid = verifyEd25519Signature(jwk.publicKeyHex!, signingInput, bytesToHex(sigBytes));
      if (!isJwtSigValid) {
        return {
          verified: false,
          isValid: false,
          reason: 'OIDC/JWT asymmetric Ed25519 signature verification failed.'
        };
      }

      // Validate signed JWT payload claims and cross-check against outer credential wrapper
      const jwtSub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      const credSub = (credential.subject ?? credential.subjectId ?? '').trim();
      if (!jwtSub || !credSub || jwtSub !== credSub) {
        return {
          verified: false,
          isValid: false,
          reason: 'Identity credential missing subject (sub) or outer credential subject does not match signed JWT sub claim.'
        };
      }

      const expectedApproverInCred = (credential.expectedApprover ?? credential.displayName ?? '').trim();
      const targetApprover = (context?.expectedApprover ?? expectedApproverInCred).trim();

      // Do not infer identity from display name: subject must be a distinct principal identifier
      if (jwtSub === targetApprover || (expectedApproverInCred && jwtSub === expectedApproverInCred)) {
        return {
          verified: false,
          isValid: false,
          reason: 'Identity subject cannot be inferred solely from display name (must be distinct from displayName).'
        };
      }

      const jwtName = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (jwtName !== expectedApproverInCred) {
        return {
          verified: false,
          isValid: false,
          reason: 'Outer credential expectedApprover/displayName does not match signed JWT name claim.'
        };
      }
      if (
        targetApprover &&
        expectedApproverInCred !== targetApprover &&
        jwtSub !== targetApprover
      ) {
        return {
          verified: false,
          isValid: false,
          reason: `Identity credential subject/expectedApprover '${expectedApproverInCred}' does not match requested approver '${targetApprover}'.`
        };
      }

      // Validate issuer (iss)
      if (typeof payload.iss !== 'string' || payload.iss !== credential.issuer || !trustedIssuers.includes(payload.iss)) {
        return {
          verified: false,
          isValid: false,
          reason: `Untrusted OIDC issuer '${payload.iss ?? credential.issuer}'.`
        };
      }
      if (jwk.issuer && jwk.issuer !== payload.iss) {
        return {
          verified: false,
          isValid: false,
          reason: `JWKS key '${jwk.kid}' issuer '${jwk.issuer}' does not match JWT iss '${payload.iss}'.`
        };
      }

      // Validate audience (aud)
      const audList = Array.isArray(payload.aud) ? payload.aud : (typeof payload.aud === 'string' ? [payload.aud] : []);
      if (!audList.includes(config.expectedAudience) || credential.audience !== config.expectedAudience) {
        return {
          verified: false,
          isValid: false,
          reason: `Invalid identity audience '${String(payload.aud)}' (expected '${config.expectedAudience}').`
        };
      }

      // Validate intended use (use)
      if (payload.use !== 'specification_approval') {
        return {
          verified: false,
          isValid: false,
          reason: `Invalid OIDC token intended use '${String(payload.use)}' (expected 'specification_approval').`
        };
      }

      // Validate tenant / organization claim (tid / tenantId)
      const jwtTenant = typeof payload.tid === 'string'
        ? payload.tid
        : (typeof payload.tenantId === 'string' ? payload.tenantId : undefined);
      const requiredTenant = config.expectedTenantId ?? context?.expectedTenantId ?? jwk.tenantId;
      if (requiredTenant && jwtTenant !== requiredTenant) {
        return {
          verified: false,
          isValid: false,
          reason: `OIDC JWT tenantId claim '${jwtTenant ?? 'missing'}' does not match expected tenantId '${requiredTenant}'.`
        };
      }
      if (credential.tenantId && credential.tenantId !== jwtTenant) {
        return {
          verified: false,
          isValid: false,
          reason: `Credential tenantId '${credential.tenantId}' does not match signed JWT tenant claim '${jwtTenant ?? 'missing'}'.`
        };
      }

      // Validate iat, nbf, exp timestamps & clock skew
      if (
        typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) ||
        typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) ||
        typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) ||
        !isValidIsoDate(credential.issuedAt) || !isValidIsoDate(credential.expiresAt)
      ) {
        return {
          verified: false,
          isValid: false,
          reason: 'OIDC JWT missing or invalid numeric iat, nbf, or exp claim.'
        };
      }

      const evalSec = Math.floor(evalMs / 1000);
      const approvalSec = Math.floor(approvalMs / 1000);

      if (evalSec + clockSkewSec < payload.nbf || approvalSec + clockSkewSec < payload.nbf) {
        return {
          verified: false,
          isValid: false,
          reason: 'Identity credential is not valid before (nbf) the approval or evaluation timestamp (issued in the future).'
        };
      }
      if (evalSec + clockSkewSec < payload.iat || approvalSec + clockSkewSec < payload.iat) {
        return {
          verified: false,
          isValid: false,
          reason: 'Identity credential issued-at (iat) is in the future (not valid before evaluation or approval timestamp).'
        };
      }
      if (evalSec - clockSkewSec >= payload.exp || approvalSec - clockSkewSec >= payload.exp) {
        return {
          verified: false,
          isValid: false,
          reason: `Identity credential expired at '${credential.expiresAt}' prior to evaluation time '${evalTimestamp}'.`
        };
      }

      // Validate authorization claims / roles
      const jwtRoles = Array.isArray(payload.roles)
        ? payload.roles
        : (Array.isArray(payload.authorizationClaims) ? payload.authorizationClaims : []);
      const credClaims = credential.authorizationClaims ?? credential.claims ?? [];
      if (
        !jwtRoles.includes(requiredClaim) ||
        !Array.isArray(credClaims) ||
        !credClaims.includes(requiredClaim)
      ) {
        return {
          verified: false,
          isValid: false,
          reason: `Identity credential lacks required authorization claim '${requiredClaim}'.`
        };
      }

      const jti = typeof payload.jti === 'string' && payload.jti.trim() !== '' ? payload.jti : (credential.credentialId ?? `jti-${jwtSub}`);
      const provenance: VerifiedIdentityProvenance = deepFreeze({
        subject: jwtSub,
        subjectId: jwtSub,
        expectedApprover: expectedApproverInCred,
        issuer: payload.iss,
        audience: config.expectedAudience,
        tenantId: jwtTenant,
        keyId: header.kid,
        tokenId: jti,
        credentialId: jti,
        notBefore: new Date(payload.nbf * 1000).toISOString(),
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt,
        verifiedAt: approvalTimestamp,
        authorizationClaims: [...jwtRoles],
        providerId: typeof payload.provider_id === 'string' ? payload.provider_id : (credential.providerId ?? 'patroner-oidc-idp'),
        verificationMethod: 'OIDC-JWT-EdDSA',
        tokenDigest: sha256Hex(rawToken)
      });

      return {
        verified: true,
        isValid: true,
        provenance
      };
    } catch (err) {
      return {
        verified: false,
        isValid: false,
        reason: `Identity verifier exception: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  return Object.freeze({
    verifierId,
    trustedIssuers: Object.freeze([...trustedIssuers]),
    expectedAudience: config.expectedAudience,
    expectedTenantId: config.expectedTenantId,
    publicJwks: Object.freeze([...publicJwks]),
    verifyIdentityCredential(
      credential: VerifiableIdentityCredential,
      context: {
        readonly targetRevisionId: string;
        readonly targetSpecificationFingerprint: string;
        readonly expectedApprover: string;
        readonly approvalTimestamp: string;
        readonly expectedTenantId?: string;
      }
    ): TrustedIdentityVerificationResult {
      return performIdentityVerification(credential, context);
    },
    verifyCredential(
      credential: VerifiableIdentityCredential,
      context?: unknown
    ): TrustedIdentityVerificationResult & { readonly isValid: boolean } {
      return performIdentityVerification(
        credential,
        context && typeof context === 'object' ? (context as Record<string, string>) : undefined
      );
    }
  });
}

/**
 * Helper to preserve explicit distinction between missing (undefined), null, and supplied values.
 */
function canonicalizeOptionalValue<T>(val: T | undefined | null): T | null | typeof CANONICAL_MISSING_SENTINEL {
  if (val === undefined) return CANONICAL_MISSING_SENTINEL;
  if (val === null) return null;
  return val;
}

/**
 * Validates that any numeric values within an unknown engineering structure are finite.
 */
function validateFiniteEngineeringNumbers(value: unknown, path: string): unknown {
  if (value === undefined) return CANONICAL_MISSING_SENTINEL;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ProductionSnapshotValidationError(`Non-finite numeric value at '${path}' (received ${value}).`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) => validateFiniteEngineeringNumbers(item, `${path}[${idx}]`));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = validateFiniteEngineeringNumbers(v, `${path}.${k}`);
    }
    return out;
  }
  return value;
}

/**
 * Produces an exhaustive, canonical JSON representation of all engineering-significant
 * specification properties for cryptographic hashing and tamper detection.
 *
 * CANONICALIZATION CONTRACT (Milestone 04.6.2.3.1 — Schema v1.1.0):
 * 1. Independent of property insertion order (recursively sorted keys).
 * 2. Independent of locale.
 * 3. Preserves exact numeric precision without rounding or silent defaults.
 * 4. Explicitly distinguishes missing ('__MISSING__'), null (null), and supplied values.
 * 5. Includes parameter-level value provenance classifications.
 * 6. Rejects missing mandatory engineering fields and non-finite/invalid numbers.
 * 7. Validates color hex format (#RGB, #RRGGBB, #RRGGBBAA).
 * 8. Preserves array order where order has engineering meaning (constructionFeatures).
 * 9. Sorts order-independent collections (designNotes, suggestedFabrics).
 * 10. Includes complete fabric mechanical properties and provenance, plus any additional engineering fields.
 */
export function canonicalizeSpecificationPayload(
  spec: AuthoritativeGarmentSpecification | CreateAuthoritativeSpecificationInput | DesignSpecification,
  options?: { schemaVersion?: string }
): string {
  if (!spec || typeof spec !== 'object') {
    throw new ProductionSnapshotValidationError('Specification payload must be a non-null object.');
  }

  // 1. Identity and revision
  const rawGarmentId = 'garmentId' in spec && spec.garmentId !== undefined
    ? spec.garmentId
    : ('id' in spec && (spec as DesignSpecification).id !== undefined ? (spec as DesignSpecification).id : undefined);

  if (rawGarmentId !== undefined && (typeof rawGarmentId !== 'string' || rawGarmentId.trim() === '')) {
    throw new ProductionSnapshotValidationError('Garment ID, when provided, must be a non-empty string.');
  }
  const garmentId = rawGarmentId ? rawGarmentId.trim() : 'garment';

  const version = spec.version ?? 1;
  if (!Number.isInteger(version) || version <= 0) {
    throw new ProductionSnapshotValidationError(`Specification version must be a positive integer (received ${version}).`);
  }

  const specificationRevisionId = spec.specificationRevisionId ?? `spec-${garmentId}-v${version}`;
  const parentRevisionId = canonicalizeOptionalValue(spec.parentRevisionId);
  const projectId = ('projectId' in spec && spec.projectId) ? spec.projectId : 'project-patroner-default';

  const garmentCategory = spec.garmentCategory;
  if (!garmentCategory || !VALID_GARMENT_CATEGORIES.has(garmentCategory)) {
    throw new ProductionSnapshotValidationError(`Valid garmentCategory is required (received '${garmentCategory}').`);
  }

  const silhouette = spec.silhouette;
  if (!silhouette || !VALID_SILHOUETTES.has(silhouette)) {
    throw new ProductionSnapshotValidationError(`Valid silhouette is required (received '${silhouette}').`);
  }

  const easeProfile = spec.easeProfile;
  if (!easeProfile || !VALID_EASE_PROFILES.has(easeProfile)) {
    throw new ProductionSnapshotValidationError(`Valid easeProfile is required (received '${easeProfile}').`);
  }

  // 2. Name validation
  const name = typeof spec.name === 'string' ? spec.name.trim() : '';
  if (!name) {
    throw new ProductionSnapshotValidationError('Specification name is required and cannot be empty.');
  }

  // 3. Color validation (distinguishes missing vs null vs supplied)
  let colorData: { name: string; hex: string } | null | typeof CANONICAL_MISSING_SENTINEL = CANONICAL_MISSING_SENTINEL;
  if ('color' in spec) {
    if (spec.color === null) {
      colorData = null;
    } else if (spec.color !== undefined) {
      if (typeof spec.color !== 'object') {
        throw new ProductionSnapshotValidationError('Specification color must be an object.');
      }
      const cName = typeof spec.color.name === 'string' ? spec.color.name.trim() : '';
      const cHex = typeof spec.color.hex === 'string' ? spec.color.hex.trim().toLowerCase() : '';
      if (cHex && !/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(cHex)) {
        throw new ProductionSnapshotValidationError(
          `Invalid color hex format: "${spec.color.hex}". Must be #RGB, #RRGGBB, or #RRGGBBAA.`
        );
      }
      colorData = {
        name: cName,
        hex: cHex
      };
    }
  }

  // 4. Target Finished Dimensions (extract all dimensions without loss, distinguishing missing vs null)
  let lengthCm: number | undefined = undefined;
  let waistCm: number | null | typeof CANONICAL_MISSING_SENTINEL = CANONICAL_MISSING_SENTINEL;
  let hipCm: number | null | typeof CANONICAL_MISSING_SENTINEL = CANONICAL_MISSING_SENTINEL;
  let bustCm: number | null | typeof CANONICAL_MISSING_SENTINEL = CANONICAL_MISSING_SENTINEL;
  let chestCm: number | null | typeof CANONICAL_MISSING_SENTINEL = CANONICAL_MISSING_SENTINEL;
  let acrossBackCm: number | null | typeof CANONICAL_MISSING_SENTINEL = CANONICAL_MISSING_SENTINEL;
  let bicepCm: number | null | typeof CANONICAL_MISSING_SENTINEL = CANONICAL_MISSING_SENTINEL;
  let wristCm: number | null | typeof CANONICAL_MISSING_SENTINEL = CANONICAL_MISSING_SENTINEL;

  const extraDimensions: Record<string, unknown> = {};

  if ('targetFinishedDimensions' in spec && spec.targetFinishedDimensions) {
    const td = spec.targetFinishedDimensions as Record<string, unknown>;
    if (typeof td.lengthCm === 'number') lengthCm = td.lengthCm;
    else if (typeof td.length === 'number') lengthCm = td.length;

    const extractDim = (kCm: string, kShort: string): number | null | typeof CANONICAL_MISSING_SENTINEL => {
      if (kCm in td && td[kCm] !== undefined) {
        return td[kCm] as number | null;
      }
      if (kShort in td && td[kShort] !== undefined) {
        return td[kShort] as number | null;
      }
      return CANONICAL_MISSING_SENTINEL;
    };

    waistCm = extractDim('waistCm', 'waist');
    hipCm = extractDim('hipCm', 'hip');
    bustCm = extractDim('bustCm', 'bust');
    chestCm = extractDim('chestCm', 'chest');
    acrossBackCm = extractDim('acrossBackCm', 'acrossBack');
    bicepCm = extractDim('bicepCm', 'bicep');
    wristCm = extractDim('wristCm', 'wrist');

    const standardDimKeys = new Set([
      'lengthCm', 'length',
      'waistCm', 'waist',
      'hipCm', 'hip',
      'bustCm', 'bust',
      'chestCm', 'chest',
      'acrossBackCm', 'acrossBack',
      'bicepCm', 'bicep',
      'wristCm', 'wrist'
    ]);
    for (const [k, v] of Object.entries(td)) {
      if (!standardDimKeys.has(k)) {
        if (typeof v === 'number') {
          if (!Number.isFinite(v) || v <= 0) {
            throw new ProductionSnapshotValidationError(
              `Target finished dimension "${k}" must be a positive finite number (received ${v}).`
            );
          }
          extraDimensions[k] = v;
        } else {
          extraDimensions[k] = canonicalizeOptionalValue(v);
        }
      }
    }
  }

  if (lengthCm === undefined && 'lengthCm' in spec && typeof spec.lengthCm === 'number') {
    lengthCm = spec.lengthCm;
  }

  if (typeof lengthCm !== 'number' || !Number.isFinite(lengthCm) || lengthCm <= 0) {
    throw new ProductionSnapshotValidationError(
      `Target finished lengthCm is mandatory and must be a positive finite number (received ${lengthCm}).`
    );
  }

  for (const [dimKey, dimVal] of [
    ['waistCm', waistCm],
    ['hipCm', hipCm],
    ['bustCm', bustCm],
    ['chestCm', chestCm],
    ['acrossBackCm', acrossBackCm],
    ['bicepCm', bicepCm],
    ['wristCm', wristCm]
  ] as const) {
    if (dimVal !== CANONICAL_MISSING_SENTINEL && dimVal !== null) {
      if (typeof dimVal !== 'number' || !Number.isFinite(dimVal) || dimVal <= 0) {
        throw new ProductionSnapshotValidationError(
          `Target finished dimension "${dimKey}" must be a positive finite number (received ${dimVal}).`
        );
      }
    }
  }

  // 5. Explicit Ease (distinguishes missing vs null vs supplied, preserves extra ease keys)
  let explicitEase: Record<string, unknown> | null | typeof CANONICAL_MISSING_SENTINEL = CANONICAL_MISSING_SENTINEL;
  if ('explicitEaseCm' in spec) {
    if (spec.explicitEaseCm === null) {
      explicitEase = null;
    } else if (spec.explicitEaseCm !== undefined) {
      const easeRecord: Record<string, unknown> = {
        waist: canonicalizeOptionalValue(spec.explicitEaseCm.waist),
        hip: canonicalizeOptionalValue(spec.explicitEaseCm.hip),
        bust: canonicalizeOptionalValue(spec.explicitEaseCm.bust),
        biceps: canonicalizeOptionalValue(spec.explicitEaseCm.biceps),
        wrist: canonicalizeOptionalValue(spec.explicitEaseCm.wrist),
        neck: canonicalizeOptionalValue(spec.explicitEaseCm.neck)
      };
      for (const [k, v] of Object.entries(spec.explicitEaseCm as Record<string, unknown>)) {
        if (v !== undefined && v !== null) {
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            throw new ProductionSnapshotValidationError(
              `Explicit ease value for "${k}" must be a finite number (received ${v}).`
            );
          }
        }
        if (!(k in easeRecord)) {
          easeRecord[k] = canonicalizeOptionalValue(v);
        }
      }
      explicitEase = easeRecord;
    }
  }

  // 6. Design and construction features (preserves array sequence for constructionFeatures)
  const constructionFeatures = Array.isArray(spec.constructionFeatures)
    ? [...spec.constructionFeatures].map(f => ({
        id: f.id,
        category: f.category,
        name: f.name,
        description: canonicalizeOptionalValue(f.description),
        patternImpact: canonicalizeOptionalValue(f.patternImpact)
      }))
    : [];

  const designNotes = Array.isArray(spec.designNotes)
    ? [...spec.designNotes].filter(n => typeof n === 'string' && n.trim() !== '').sort()
    : [];

  // 7. Complete Fabric Engineering Properties & Provenance
  const fab = spec.fabric;
  if (!fab || typeof fab !== 'object') {
    throw new ProductionSnapshotValidationError('Fabric property specification is required.');
  }
  if (!fab.id || typeof fab.id !== 'string' || fab.id.trim() === '') {
    throw new ProductionSnapshotValidationError('Fabric specification requires a non-empty id.');
  }
  if (!fab.name || typeof fab.name !== 'string' || fab.name.trim() === '') {
    throw new ProductionSnapshotValidationError('Fabric specification requires a non-empty name.');
  }
  if (!fab.weight) {
    throw new ProductionSnapshotValidationError('Fabric specification requires weight.');
  }
  if (!fab.stretch) {
    throw new ProductionSnapshotValidationError('Fabric specification requires stretch.');
  }

  const enhanced = fab as Partial<EnhancedFabricProperty>;
  const extraFab = fab as unknown as Record<string, unknown>;

  if (enhanced.gsm !== undefined && enhanced.gsm !== null) {
    if (!Number.isFinite(enhanced.gsm) || enhanced.gsm <= 0) {
      throw new ProductionSnapshotValidationError(
        `Fabric GSM must be a positive finite number (received ${enhanced.gsm}).`
      );
    }
  }
  if (enhanced.thicknessMm !== undefined && enhanced.thicknessMm !== null) {
    if (!Number.isFinite(enhanced.thicknessMm) || enhanced.thicknessMm <= 0) {
      throw new ProductionSnapshotValidationError(
        `Fabric thickness must be a positive finite number (received ${enhanced.thicknessMm}).`
      );
    }
  }
  if (enhanced.moldingFactor !== undefined && enhanced.moldingFactor !== null) {
    if (!Number.isFinite(enhanced.moldingFactor) || enhanced.moldingFactor <= 0) {
      throw new ProductionSnapshotValidationError(
        `Fabric molding factor must be a positive finite number (received ${enhanced.moldingFactor}).`
      );
    }
  }

  const knownFabricKeys = new Set([
    'id', 'name', 'composition', 'weight', 'stretch', 'drapeDescription',
    'recommendedEaseCm', 'gsm', 'thicknessMm', 'moldingFactor', 'directional',
    'revision', 'provenance', 'propertyProvenance', 'propertyVerificationDetails',
    'testStandard', 'laboratoryReference', 'supplierReference', 'isVerified',
    'isIllustrativeReference', 'isIllustrative', 'isProvisional'
  ]);
  const additionalFabricFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extraFab)) {
    if (!knownFabricKeys.has(k)) {
      additionalFabricFields[k] = validateFiniteEngineeringNumbers(v, `fabric.${k}`);
    }
  }

  const fabricData = {
    id: fab.id,
    name: fab.name,
    composition: canonicalizeOptionalValue(fab.composition),
    drapeDescription: canonicalizeOptionalValue(fab.drapeDescription),
    weight: fab.weight,
    stretch: fab.stretch,
    gsm: canonicalizeOptionalValue(enhanced.gsm),
    thicknessMm: canonicalizeOptionalValue(enhanced.thicknessMm),
    moldingFactor: canonicalizeOptionalValue(enhanced.moldingFactor),
    directional: enhanced.directional === undefined
      ? CANONICAL_MISSING_SENTINEL
      : enhanced.directional === null
      ? null
      : {
          warp: enhanced.directional.warp ? {
            shrinkagePercent: enhanced.directional.warp.shrinkagePercent,
            stretchPercent: enhanced.directional.warp.stretchPercent
          } : canonicalizeOptionalValue(enhanced.directional.warp),
          weft: enhanced.directional.weft ? {
            shrinkagePercent: enhanced.directional.weft.shrinkagePercent,
            stretchPercent: enhanced.directional.weft.stretchPercent
          } : canonicalizeOptionalValue(enhanced.directional.weft),
          bias: enhanced.directional.bias ? {
            stretchPercent: enhanced.directional.bias.stretchPercent
          } : canonicalizeOptionalValue(enhanced.directional.bias)
        },
    recommendedEaseCm: fab.recommendedEaseCm === undefined
      ? CANONICAL_MISSING_SENTINEL
      : fab.recommendedEaseCm === null
      ? null
      : {
          waist: fab.recommendedEaseCm.waist,
          hip: fab.recommendedEaseCm.hip,
          bust: canonicalizeOptionalValue(fab.recommendedEaseCm.bust)
        },
    fabricRevision: 'fabricRevision' in spec && spec.fabricRevision !== undefined
      ? canonicalizeOptionalValue(spec.fabricRevision)
      : canonicalizeOptionalValue(enhanced.revision),
    fabricProvenance: 'fabricProvenance' in spec && spec.fabricProvenance !== undefined
      ? spec.fabricProvenance
      : (enhanced.provenance ?? 'unknown'),
    propertyProvenance: canonicalizeOptionalValue(enhanced.propertyProvenance),
    propertyVerificationDetails: canonicalizeOptionalValue(extraFab.propertyVerificationDetails),
    testStandard: canonicalizeOptionalValue(enhanced.testStandard),
    laboratoryReference: canonicalizeOptionalValue(extraFab.laboratoryReference),
    supplierReference: canonicalizeOptionalValue(extraFab.supplierReference),
    isVerified: canonicalizeOptionalValue(enhanced.isVerified),
    isIllustrativeReference: canonicalizeOptionalValue(enhanced.isIllustrativeReference ?? extraFab.isIllustrative),
    isProvisional: canonicalizeOptionalValue(extraFab.isProvisional),
    additionalFabricFields
  };

  // 8. Allowances (preserve exact supplied values vs missing vs null without silent substitution during canonicalization)
  const rawAllowancesSource: Record<string, unknown> =
    'allowances' in spec && spec.allowances && typeof spec.allowances === 'object'
      ? (spec.allowances as unknown as Record<string, unknown>)
      : {
          seamAllowanceCm: (spec as DesignSpecification).seamAllowanceCm,
          hemAllowanceCm: (spec as DesignSpecification).hemAllowanceCm,
          waistAllowanceCm: (spec as DesignSpecification).waistAllowanceCm,
          neckAllowanceCm: (spec as DesignSpecification).neckAllowanceCm,
          armholeAllowanceCm: (spec as DesignSpecification).armholeAllowanceCm,
          shoulderAllowanceCm: (spec as DesignSpecification).shoulderAllowanceCm
        };

  const allowances: Record<string, unknown> = {
    seamAllowanceCm: canonicalizeOptionalValue(rawAllowancesSource.seamAllowanceCm),
    hemAllowanceCm: canonicalizeOptionalValue(rawAllowancesSource.hemAllowanceCm),
    waistAllowanceCm: canonicalizeOptionalValue(rawAllowancesSource.waistAllowanceCm),
    neckAllowanceCm: canonicalizeOptionalValue(rawAllowancesSource.neckAllowanceCm),
    armholeAllowanceCm: canonicalizeOptionalValue(rawAllowancesSource.armholeAllowanceCm),
    shoulderAllowanceCm: canonicalizeOptionalValue(rawAllowancesSource.shoulderAllowanceCm)
  };

  for (const [k, v] of Object.entries(rawAllowancesSource)) {
    if (!(k in allowances)) {
      allowances[k] = canonicalizeOptionalValue(v);
    }
  }

  for (const [aKey, aVal] of Object.entries(allowances)) {
    if (aVal !== CANONICAL_MISSING_SENTINEL && aVal !== null) {
      if (typeof aVal !== 'number' || !Number.isFinite(aVal) || aVal < 0) {
        throw new ProductionSnapshotValidationError(
          `Allowance "${aKey}" must be a non-negative finite number (received ${aVal}).`
        );
      }
    }
  }

  // 9. AI Estimates (explicitly separated as non-authoritative proposals)
  const aiEstimates =
    !('aiEstimates' in spec) || spec.aiEstimates === undefined
      ? CANONICAL_MISSING_SENTINEL
      : spec.aiEstimates === null
      ? null
      : {
          suggestedSilhouette: canonicalizeOptionalValue(spec.aiEstimates.suggestedSilhouette),
          styleConfidenceScore: canonicalizeOptionalValue(spec.aiEstimates.styleConfidenceScore),
          suggestedFabrics: Array.isArray(spec.aiEstimates.suggestedFabrics)
            ? [...spec.aiEstimates.suggestedFabrics].sort()
            : [],
          technicalAdvice: canonicalizeOptionalValue(spec.aiEstimates.technicalAdvice),
          disclaimer: canonicalizeOptionalValue(spec.aiEstimates.disclaimer)
        };

  // 10. Parameter-level Value Provenance Classification
  const explicitFieldProvenance =
    'fieldProvenance' in spec && spec.fieldProvenance
      ? { ...spec.fieldProvenance }
      : {};

  const classifyFieldState = (val: unknown, defaultProvenance: ParameterValueProvenance): ParameterValueProvenance => {
    if (val === undefined || val === CANONICAL_MISSING_SENTINEL) return 'missing';
    if (val === null) return 'explicit-null';
    return defaultProvenance;
  };

  const computedFieldProvenance: Record<string, ParameterValueProvenance> = {
    lengthCm: explicitFieldProvenance.lengthCm ?? 'explicit-value',
    waistCm: explicitFieldProvenance.waistCm ?? classifyFieldState(waistCm, 'explicit-value'),
    hipCm: explicitFieldProvenance.hipCm ?? classifyFieldState(hipCm, 'explicit-value'),
    bustCm: explicitFieldProvenance.bustCm ?? classifyFieldState(bustCm, 'explicit-value'),
    explicitEaseCm: explicitFieldProvenance.explicitEaseCm ?? classifyFieldState(explicitEase, 'explicit-value'),
    seamAllowanceCm:
      explicitFieldProvenance.seamAllowanceCm ??
      classifyFieldState(allowances.seamAllowanceCm, 'explicit-value'),
    hemAllowanceCm:
      explicitFieldProvenance.hemAllowanceCm ??
      classifyFieldState(allowances.hemAllowanceCm, 'explicit-value'),
    aiEstimates:
      explicitFieldProvenance.aiEstimates ??
      classifyFieldState(aiEstimates, 'ai-proposed'),
    ...explicitFieldProvenance
  };

  // 11. Preserve any unknown / additional engineering fields on the specification object
  const knownSpecKeys = new Set([
    'id', 'garmentId', 'projectId', 'specificationRevisionId', 'parentRevisionId',
    'supersededByRevisionId', 'version', 'name', 'garmentCategory', 'silhouette',
    'prompt', 'color', 'fabric', 'fabricRevision', 'fabricProvenance',
    'easeProfile', 'explicitEaseCm', 'targetFinishedDimensions', 'lengthCm',
    'dartStyle', 'sleeveEaseStrategy', 'allowances',
    'seamAllowanceCm', 'hemAllowanceCm', 'waistAllowanceCm',
    'neckAllowanceCm', 'armholeAllowanceCm', 'shoulderAllowanceCm',
    'constructionFeatures', 'designNotes', 'fieldProvenance',
    'aiEstimates', 'engineProvenance',
    // Approval / lifecycle / volatile timestamp metadata (excluded from content hash so approval binds to content)
    'isApproved', 'approvalState', 'approvalAuthorityTier', 'approvalRecord',
    'verifiedIdentity', 'cryptographicSignature',
    'approvalHistory', 'revocationRecord', 'approvedBy', 'approvedAt',
    'approvalProvenance', 'createdAt', 'updatedAt'
  ]);

  const additionalEngineeringFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec as unknown as Record<string, unknown>)) {
    if (!knownSpecKeys.has(k)) {
      additionalEngineeringFields[k] = validateFiniteEngineeringNumbers(v, `spec.${k}`);
    }
  }

  // 12. Engine & Schema Version
  const engineVersion = ('engineProvenance' in spec && spec.engineProvenance?.engineVersion)
    ? spec.engineProvenance.engineVersion
    : CURRENT_ENGINE_VERSION;
  const schemaVersion = options?.schemaVersion ?? SPECIFICATION_CANONICAL_SCHEMA_VERSION;

  const promptVal = !('prompt' in spec) || spec.prompt === undefined
    ? CANONICAL_MISSING_SENTINEL
    : spec.prompt === null
    ? null
    : spec.prompt;

  const payload = {
    schemaVersion,
    projectId,
    garmentId,
    specificationRevisionId,
    parentRevisionId,
    version,
    garmentCategory,
    name,
    silhouette,
    prompt: promptVal,
    color: colorData,
    dartStyle: canonicalizeOptionalValue(spec.dartStyle),
    sleeveEaseStrategy: canonicalizeOptionalValue(spec.sleeveEaseStrategy),
    constructionFeatures,
    designNotes,
    fabric: fabricData,
    targetFinishedDimensions: {
      lengthCm,
      waistCm,
      hipCm,
      bustCm,
      chestCm,
      acrossBackCm,
      bicepCm,
      wristCm,
      ...extraDimensions
    },
    explicitEaseCm: explicitEase,
    easeProfile,
    allowances,
    aiEstimates,
    fieldProvenance: computedFieldProvenance,
    additionalEngineeringFields,
    engineVersion
  };

  return canonicalizeJson(payload);
}

/**
 * Computes a deterministic SHA-256 fingerprint for ALL engineering-significant specification fields.
 * Used for cryptographic approval binding, tamper detection, and dependency tracking.
 *
 * Excludes volatile metadata (createdAt, updatedAt) and approval wrapper state so the approval
 * record can bind directly to the exact canonical content digest.
 */
export function computeSpecificationFingerprint(
  spec: AuthoritativeGarmentSpecification | CreateAuthoritativeSpecificationInput | DesignSpecification,
  options?: { schemaVersion?: string }
): string {
  const canonical = canonicalizeSpecificationPayload(spec, options);
  return sha256Hex(canonical);
}

/**
 * Verifies whether a specification revision has a valid, untampered approval record.
 * Recomputes the canonical specification fingerprint, enforces revocation/supersession precedence,
 * and requires real provider verification for authenticated_designer and cryptographic_principal tiers.
 */
export function verifySpecificationApproval(
  spec: AuthoritativeGarmentSpecification | DesignSpecification,
  verificationContext?: ApprovalVerificationContext
): {
  isValid: boolean;
  state: SpecificationApprovalState;
  authorityTier?: ApprovalAuthorityTier;
  reason?: string;
  fingerprint: string;
} {
  const currentFingerprint = computeSpecificationFingerprint(spec);
  const specId = 'garmentId' in spec && spec.garmentId
    ? spec.garmentId
    : ('id' in spec && (spec as DesignSpecification).id ? (spec as DesignSpecification).id : 'garment');
  const specRevId = spec.specificationRevisionId ?? `spec-${specId}-v${spec.version || 1}`;
  const specProjectId = spec.projectId ?? 'project-patroner-default';

  // CORRECTION G: Check revocation across state, revocationRecord, approvalRecord.revocation, and approvalHistory
  // BEFORE checking isApproved, so a revoked specification remains invalid even if legacy booleans are tampered.
  const historyEvents = Array.isArray(spec.approvalHistory) ? spec.approvalHistory : [];
  const revEventsForRev = historyEvents.filter(
    e => e.eventType === 'revocation' && e.targetRevisionId === specRevId
  );
  const latestEventForRev = [...historyEvents]
    .reverse()
    .find(e => e.targetRevisionId === specRevId);

  const hasActiveRevocationInHistory =
    latestEventForRev?.eventType === 'revocation' ||
    (spec.approvalRecord?.eventId !== undefined &&
      revEventsForRev.some(
        e => (e as SpecificationRevocationEvent).originalApprovalEventId === spec.approvalRecord?.eventId
      ));

  if (
    spec.approvalState === 'revoked' ||
    spec.revocationRecord !== undefined ||
    spec.approvalRecord?.revocation !== undefined ||
    Boolean(spec.approvalRecord?.revocationReason) ||
    hasActiveRevocationInHistory
  ) {
    const revReason =
      spec.revocationRecord?.reason ??
      spec.approvalRecord?.revocation?.reason ??
      spec.approvalRecord?.revocationReason ??
      (latestEventForRev?.eventType === 'revocation' ? latestEventForRev.reason : undefined);

    return {
      isValid: false,
      state: 'revoked',
      reason: revReason
        ? `Specification approval was explicitly revoked: ${revReason}`
        : 'Specification approval was explicitly revoked.',
      fingerprint: currentFingerprint
    };
  }

  // CORRECTION G: Check supersession across state, supersededByRevisionId, and approvalHistory
  // BEFORE checking isApproved, so a superseded specification remains invalid even if isApproved is manipulated.
  const hasSupersessionInHistory = historyEvents.some(
    e => e.eventType === 'supersession' && e.targetRevisionId === specRevId
  );

  if (
    spec.approvalState === 'superseded' ||
    Boolean(spec.supersededByRevisionId) ||
    hasSupersessionInHistory
  ) {
    return {
      isValid: false,
      state: 'superseded',
      reason: spec.supersededByRevisionId
        ? `Specification revision '${specRevId}' has been superseded by revision '${spec.supersededByRevisionId}'.`
        : 'Specification revision has been superseded by a newer revision.',
      fingerprint: currentFingerprint
    };
  }

  if (!spec.isApproved) {
    const st = spec.approvalState ?? 'draft';
    return {
      isValid: false,
      state: st === 'approved' ? 'draft' : st,
      reason: 'Specification is not approved.',
      fingerprint: currentFingerprint
    };
  }

  const effectiveTier = spec.approvalRecord?.authorityTier ?? spec.approvalAuthorityTier;

  // Verify specification authority tier claims before trusting record
  if (effectiveTier === 'authenticated_designer') {
    if (
      !verificationContext?.identityVerifier ||
      (typeof verificationContext.identityVerifier.verifyIdentityCredential !== 'function' &&
        typeof verificationContext.identityVerifier.verifyCredential !== 'function')
    ) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: effectiveTier,
        reason: 'authenticated_designer authority tier is unavailable without verified identity provider configuration.',
        fingerprint: currentFingerprint
      };
    }
  }

  if (effectiveTier === 'cryptographic_principal') {
    if (!verificationContext?.cryptographicVerifier || typeof verificationContext.cryptographicVerifier.verifyApprovalSignature !== 'function') {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: effectiveTier,
        reason: 'cryptographic_principal authority tier is unavailable without cryptographic provider configuration.',
        fingerprint: currentFingerprint
      };
    }
  }

  if (!spec.approvalRecord) {
    if (spec.approvalAuthorityTier === 'demonstration_fixture') {
      if (!spec.approvedBy || spec.approvedBy.trim() === '') {
        return {
          isValid: false,
          state: 'invalid',
          authorityTier: 'demonstration_fixture',
          reason: 'Approved demonstration fixture lacks an approver identity.',
          fingerprint: currentFingerprint
        };
      }
      if (!spec.approvedAt || !isValidIsoDate(spec.approvedAt)) {
        return {
          isValid: false,
          state: 'invalid',
          authorityTier: 'demonstration_fixture',
          reason: 'Approved demonstration fixture lacks a valid ISO approval timestamp.',
          fingerprint: currentFingerprint
        };
      }
      return {
        isValid: true,
        state: 'approved',
        authorityTier: 'demonstration_fixture',
        fingerprint: currentFingerprint
      };
    }

    return {
      isValid: false,
      state: 'invalid',
      authorityTier: effectiveTier,
      reason: 'Approved specification lacks an authoritative approval record.',
      fingerprint: currentFingerprint
    };
  }

  const record = spec.approvalRecord;

  if (spec.approvalAuthorityTier && record.authorityTier !== spec.approvalAuthorityTier) {
    return {
      isValid: false,
      state: 'invalid',
      authorityTier: record.authorityTier,
      reason: `Approval authority tier mismatch between specification ('${spec.approvalAuthorityTier}') and approvalRecord ('${record.authorityTier}').`,
      fingerprint: currentFingerprint
    };
  }

  // Verify exact revision ID
  if (record.targetRevisionId !== specRevId) {
    return {
      isValid: false,
      state: 'invalid',
      authorityTier: record.authorityTier,
      reason: `Approval record target revision '${record.targetRevisionId}' does not match specification revision '${specRevId}'.`,
      fingerprint: currentFingerprint
    };
  }

  // Verify exact specification fingerprint
  if (record.targetSpecificationFingerprint !== currentFingerprint) {
    return {
      isValid: false,
      state: 'invalid',
      authorityTier: record.authorityTier,
      reason: 'Specification content has been modified after approval was granted; content fingerprint mismatch.',
      fingerprint: currentFingerprint
    };
  }

  // Verify approver identity
  if (!record.approverName || record.approverName.trim() === '' || !record.approverId || record.approverId.trim() === '') {
    return {
      isValid: false,
      state: 'invalid',
      authorityTier: record.authorityTier,
      reason: 'Approved specification approval record lacks a valid approver identity.',
      fingerprint: currentFingerprint
    };
  }

  if (spec.approvedBy && record.approverName !== spec.approvedBy && record.approverId !== spec.approvedBy) {
    return {
      isValid: false,
      state: 'invalid',
      authorityTier: record.authorityTier,
      reason: 'approver identity mismatch between approvedBy and approvalRecord.',
      fingerprint: currentFingerprint
    };
  }

  // Prevent local unauthenticated session from claiming verified identity or cryptographic provenance
  if (record.authorityTier === 'unauthenticated_local_session' || record.authorityTier === 'demonstration_fixture') {
    if (record.approverId === record.approverName) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: 'Approver ID cannot be a raw display name impersonation; must use distinct principal or local session identifier.',
        fingerprint: currentFingerprint
      };
    }
  }

  // Verify approval timestamp
  if (!record.approvedAt || !isValidIsoDate(record.approvedAt)) {
    return {
      isValid: false,
      state: 'invalid',
      authorityTier: record.authorityTier,
      reason: 'Approved specification approval record lacks a valid ISO approval timestamp.',
      fingerprint: currentFingerprint
    };
  }

  if (spec.approvedAt && spec.approvedAt !== record.approvedAt) {
    return {
      isValid: false,
      state: 'invalid',
      authorityTier: record.authorityTier,
      reason: `Approval timestamp mismatch between specification ('${spec.approvedAt}') and approvalRecord ('${record.approvedAt}').`,
      fingerprint: currentFingerprint
    };
  }

  // Tier 3 (authenticated_designer) real OIDC/JWT identity provenance verification
  if (record.authorityTier === 'authenticated_designer') {
    const idProv = record.verifiedIdentity;
    if (!idProv) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: 'authenticated_designer approval record lacks verifiedIdentity provenance.',
        fingerprint: currentFingerprint
      };
    }
    if (idProv.verificationMethod !== 'OIDC-JWT-EdDSA') {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: `authenticated_designer provenance verificationMethod '${idProv.verificationMethod ?? 'missing'}' is invalid; 'OIDC-JWT-EdDSA' required.`,
        fingerprint: currentFingerprint
      };
    }
    const idVerifier = verificationContext?.identityVerifier;
    if (!idVerifier) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: 'authenticated_designer authority tier is unavailable without verified identity provider configuration.',
        fingerprint: currentFingerprint
      };
    }
    if (verificationContext?.identityCredential) {
      const verifyFn =
        idVerifier.verifyIdentityCredential?.bind(idVerifier) ??
        idVerifier.verifyCredential?.bind(idVerifier);
      if (typeof verifyFn === 'function') {
        const liveCheck = verifyFn(verificationContext.identityCredential, {
          targetRevisionId: specRevId,
          targetSpecificationFingerprint: currentFingerprint,
          expectedApprover: record.approverName,
          approvalTimestamp: verificationContext.currentTimestamp ?? record.approvedAt,
          expectedTenantId: idVerifier.expectedTenantId
        });
        if (!liveCheck.verified || !liveCheck.provenance) {
          return {
            isValid: false,
            state: 'invalid',
            authorityTier: record.authorityTier,
            reason: `authenticated_designer OIDC credential re-verification failed: ${liveCheck.reason ?? 'invalid credential'}`,
            fingerprint: currentFingerprint
          };
        }
        if (liveCheck.provenance.tokenDigest !== idProv.tokenDigest) {
          return {
            isValid: false,
            state: 'invalid',
            authorityTier: record.authorityTier,
            reason: 'authenticated_designer credential token digest does not match recorded approval provenance.',
            fingerprint: currentFingerprint
          };
        }
      }
    }
    if (idVerifier.trustedIssuers && !idVerifier.trustedIssuers.includes(idProv.issuer)) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: `authenticated_designer provenance issuer '${idProv.issuer}' is not trusted by verifier '${idVerifier.verifierId ?? 'default'}'.`,
        fingerprint: currentFingerprint
      };
    }
    if (idVerifier.expectedAudience && idProv.audience !== idVerifier.expectedAudience) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: `authenticated_designer provenance audience '${idProv.audience}' does not match expected audience '${idVerifier.expectedAudience}'.`,
        fingerprint: currentFingerprint
      };
    }
    if (idVerifier.expectedTenantId && idProv.tenantId !== idVerifier.expectedTenantId) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: `authenticated_designer provenance tenantId '${idProv.tenantId ?? 'missing'}' does not match expected tenant '${idVerifier.expectedTenantId}'.`,
        fingerprint: currentFingerprint
      };
    }
    if (idVerifier.publicJwks && idVerifier.publicJwks.length > 0) {
      const matchedJwk = idVerifier.publicJwks.find(k => k.kid === idProv.keyId);
      if (!matchedJwk || matchedJwk.revoked || matchedJwk.trustStatus !== 'trusted') {
        return {
          isValid: false,
          state: 'invalid',
          authorityTier: record.authorityTier,
          reason: `authenticated_designer provenance JWKS key '${idProv.keyId ?? 'missing'}' is unknown, untrusted, or revoked.`,
          fingerprint: currentFingerprint
        };
      }
    }
    if (idProv.subject !== record.approverId || idProv.subject === record.approverName) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: 'authenticated_designer subject mismatch or inferred from display name.',
        fingerprint: currentFingerprint
      };
    }
    const evalTime = verificationContext?.currentTimestamp ?? record.approvedAt;
    if (!isValidIsoDate(idProv.issuedAt) || !isValidIsoDate(idProv.expiresAt) || !isValidIsoDate(evalTime)) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: 'authenticated_designer credential timestamps are invalid.',
        fingerprint: currentFingerprint
      };
    }
    if (idProv.notBefore && isValidIsoDate(idProv.notBefore)) {
      if (Date.parse(evalTime) < Date.parse(idProv.notBefore) || Date.parse(record.approvedAt) < Date.parse(idProv.notBefore)) {
        return {
          isValid: false,
          state: 'invalid',
          authorityTier: record.authorityTier,
          reason: `authenticated_designer identity credential is not yet valid before '${idProv.notBefore}'.`,
          fingerprint: currentFingerprint
        };
      }
    }
    if (Date.parse(evalTime) >= Date.parse(idProv.expiresAt) || Date.parse(record.approvedAt) >= Date.parse(idProv.expiresAt)) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: `authenticated_designer identity credential expired at '${idProv.expiresAt}'.`,
        fingerprint: currentFingerprint
      };
    }
  }

  // Tier 4 (cryptographic_principal) real asymmetric Ed25519 signature verification over all bound fields
  if (record.authorityTier === 'cryptographic_principal') {
    const sig = record.cryptographicSignature;
    if (!sig || !sig.signedPayload) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: 'cryptographic_principal approval record lacks a verifiable cryptographicSignature.',
        fingerprint: currentFingerprint
      };
    }
    const cryptoVerifier = verificationContext?.cryptographicVerifier;
    if (!cryptoVerifier) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: 'cryptographic_principal authority tier is unavailable without cryptographic provider configuration.',
        fingerprint: currentFingerprint
      };
    }

    const expectedBindingPayload: CryptographicApprovalBindingPayload = {
      schemaVersion: sig.signedPayload.schemaVersion || SPECIFICATION_CANONICAL_SCHEMA_VERSION,
      projectId: specProjectId,
      tenantId: specProjectId,
      garmentId: specId,
      specificationRevisionId: specRevId,
      specificationVersion: spec.version || 1,
      canonicalSpecificationFingerprint: currentFingerprint,
      approvalEventId: record.eventId ?? '',
      approverPrincipal: record.approverId,
      authorityTier: 'cryptographic_principal',
      approvalScope: 'specification_approval',
      approvalTimestamp: record.approvedAt,
      keyId: sig.keyId,
      algorithm: sig.algorithm
    };

    const sigCheck = cryptoVerifier.verifyApprovalSignature(sig, expectedBindingPayload);
    if (!sigCheck.verified) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: record.authorityTier,
        reason: `Cryptographic signature verification failed: ${sigCheck.reason ?? 'invalid signature'}`,
        fingerprint: currentFingerprint
      };
    }
  }

  // Verify append-only approvalHistory consistency if present
  if (historyEvents.length > 0 && record.eventId) {
    const matchingEvt = historyEvents.find(
      e => e.eventType === 'approval' && e.id === record.eventId
    ) as SpecificationApprovalEvent | undefined;
    if (matchingEvt) {
      if (
        matchingEvt.targetRevisionId !== specRevId ||
        matchingEvt.targetSpecificationFingerprint !== currentFingerprint ||
        matchingEvt.authorityTier !== record.authorityTier ||
        matchingEvt.approvedAt !== record.approvedAt ||
        matchingEvt.approverId !== record.approverId
      ) {
        return {
          isValid: false,
          state: 'invalid',
          authorityTier: record.authorityTier,
          reason: 'Approval history event does not match approvalRecord lineage or fingerprint.',
          fingerprint: currentFingerprint
        };
      }
    }
  }

  return {
    isValid: true,
    state: 'approved',
    authorityTier: record.authorityTier,
    fingerprint: currentFingerprint
  };
}

/**
 * Creates an authoritative garment specification binding creative design intent
 * with deterministic mechanical allowances, target dimensions, and explicit ease.
 */
export function createAuthoritativeGarmentSpecification(
  input: CreateAuthoritativeSpecificationInput
): AuthoritativeGarmentSpecification {
  if (!input.name || input.name.trim() === '') {
    throw new ProductionSnapshotValidationError('Specification name is required and cannot be empty.');
  }
  if (!input.garmentCategory || !VALID_GARMENT_CATEGORIES.has(input.garmentCategory)) {
    throw new ProductionSnapshotValidationError('Garment category is required.');
  }
  if (!input.silhouette || !VALID_SILHOUETTES.has(input.silhouette)) {
    throw new ProductionSnapshotValidationError('Valid silhouette is required.');
  }
  if (!input.easeProfile || !VALID_EASE_PROFILES.has(input.easeProfile)) {
    throw new ProductionSnapshotValidationError('Valid easeProfile is required.');
  }
  if (!Number.isFinite(input.lengthCm) || input.lengthCm <= 0) {
    throw new ProductionSnapshotValidationError(
      `Target lengthCm must be a positive finite number (received ${input.lengthCm}).`
    );
  }
  if (!input.fabric || typeof input.fabric !== 'object') {
    throw new ProductionSnapshotValidationError('Fabric property specification is required.');
  }

  const now = new Date().toISOString();
  const version = input.version ?? 1;
  const garmentId = input.garmentId ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const specId = input.specificationRevisionId ?? `spec-${garmentId}-v${version}`;

  const hasApprover = Boolean(input.approvedBy && input.approvedBy.trim() !== '');
  const isRevoked = input.approvalState === 'revoked' || input.revocationRecord !== undefined;
  const isSuperseded = input.approvalState === 'superseded' || Boolean(input.supersededByRevisionId);
  const isApprovedRequested = Boolean((input.isApproved || input.approvalState === 'approved') && !isRevoked && !isSuperseded);
  const isApproved = isApprovedRequested && hasApprover;

  let approvedBy = isApproved ? input.approvedBy?.trim() : undefined;
  let approvedAt = isApproved ? input.approvedAt : undefined;
  let approvalAuthorityTier: ApprovalAuthorityTier | undefined = isApproved
    ? (input.approvalAuthorityTier ?? 'unauthenticated_local_session')
    : undefined;

  let approvalState: SpecificationApprovalState = isRevoked
    ? 'revoked'
    : isSuperseded
    ? 'superseded'
    : (input.approvalState ?? (isApproved ? 'approved' : 'draft'));

  if (isApprovedRequested && !hasApprover) {
    approvalState = 'draft';
  }

  let approvalProvenance: SpecificationValueProvenance = input.approvalProvenance ?? (
    isApproved
      ? (approvalAuthorityTier === 'demonstration_fixture'
          ? 'demonstration-fixture'
          : approvalAuthorityTier === 'authenticated_designer' || approvalAuthorityTier === 'cryptographic_principal'
          ? 'designer-approved'
          : 'unauthenticated-local-approval')
      : 'designer-edited'
  );

  if (isApproved) {
    if (!approvedAt || !isValidIsoDate(approvedAt)) {
      approvedAt = now;
    }
  } else {
    approvedBy = undefined;
    approvedAt = undefined;
    approvalAuthorityTier = undefined;
    if (approvalProvenance === 'designer-approved' || approvalProvenance === 'unauthenticated-local-approval') {
      approvalProvenance = 'designer-edited';
    }
  }

  const targetFinishedDimensions = {
    lengthCm: input.lengthCm,
    ...(input.targetFinishedDimensions ?? {})
  };

  const allowances = {
    seamAllowanceCm: input.allowances?.seamAllowanceCm ?? 1.5,
    hemAllowanceCm: input.allowances?.hemAllowanceCm ?? 3.0,
    waistAllowanceCm: input.allowances?.waistAllowanceCm ?? 1.0,
    neckAllowanceCm: input.allowances?.neckAllowanceCm ?? 1.0,
    armholeAllowanceCm: input.allowances?.armholeAllowanceCm ?? 1.0,
    shoulderAllowanceCm: input.allowances?.shoulderAllowanceCm ?? 1.0
  };

  const fieldProvenance: Record<string, ParameterValueProvenance> = {
    lengthCm: 'explicit-value',
    seamAllowanceCm: input.allowances?.seamAllowanceCm !== undefined ? 'explicit-value' : 'approved-project-default',
    hemAllowanceCm: input.allowances?.hemAllowanceCm !== undefined ? 'explicit-value' : 'approved-project-default',
    waistAllowanceCm: input.allowances?.waistAllowanceCm !== undefined ? 'explicit-value' : 'approved-project-default',
    neckAllowanceCm: input.allowances?.neckAllowanceCm !== undefined ? 'explicit-value' : 'approved-project-default',
    armholeAllowanceCm: input.allowances?.armholeAllowanceCm !== undefined ? 'explicit-value' : 'approved-project-default',
    shoulderAllowanceCm: input.allowances?.shoulderAllowanceCm !== undefined ? 'explicit-value' : 'approved-project-default',
    ...(input.fieldProvenance ?? {})
  };

  const engineProvenance = {
    engineVersion: input.engineProvenance?.engineVersion ?? CURRENT_ENGINE_VERSION,
    snapshotEngine: 'Patroner Authoritative Specification Engine v1.1',
    buildTimestamp: input.engineProvenance?.buildTimestamp ?? now,
    ...(input.engineProvenance ?? {})
  };

  const tempSpecPayload = {
    projectId: input.projectId ?? 'project-patroner-default',
    garmentId,
    specificationRevisionId: specId,
    parentRevisionId: input.parentRevisionId,
    supersededByRevisionId: input.supersededByRevisionId,
    version,
    name: input.name.trim(),
    garmentCategory: input.garmentCategory,
    silhouette: input.silhouette,
    prompt: input.prompt ?? '',
    color: input.color ?? { name: 'Chalk Oatmeal', hex: '#E8E3D9' },
    fabric: input.fabric,
    fabricRevision: input.fabricRevision,
    fabricProvenance: input.fabricProvenance ?? 'unknown',
    easeProfile: input.easeProfile,
    explicitEaseCm: input.explicitEaseCm,
    targetFinishedDimensions,
    dartStyle: input.dartStyle,
    sleeveEaseStrategy: input.sleeveEaseStrategy,
    allowances,
    constructionFeatures: input.constructionFeatures ?? [],
    designNotes: input.designNotes ?? [],
    fieldProvenance,
    aiEstimates: input.aiEstimates,
    engineProvenance
  };

  const specFingerprint = computeSpecificationFingerprint(tempSpecPayload as unknown as AuthoritativeGarmentSpecification);

  let approvalRecord: SpecificationApprovalRecord | undefined = undefined;
  const approvalHistory: SpecificationLifecycleEvent[] = input.approvalHistory ? [...input.approvalHistory] : [];
  // CORRECTION G: Never silently discard revocationRecord
  const revocationRecord: SpecificationRevocationEvent | undefined = input.revocationRecord;

  if (isApproved) {
    if (input.approvalRecord && input.approvalRecord.targetSpecificationFingerprint === specFingerprint) {
      approvalRecord = input.approvalRecord;
    } else {
      const eventId = `appr-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const approvalEvent: SpecificationApprovalEvent = {
        id: eventId,
        eventType: 'approval',
        targetRevisionId: specId,
        targetSpecificationFingerprint: specFingerprint,
        approverId: `approver-${(approvedBy ?? 'operator').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        approverName: approvedBy ?? 'Local Operator',
        authorityTier: approvalAuthorityTier ?? 'unauthenticated_local_session',
        approvedAt: approvedAt!,
        provenance: approvalProvenance
      };

      approvalRecord = {
        eventId,
        approverId: approvalEvent.approverId,
        approverName: approvalEvent.approverName,
        authorityTier: approvalEvent.authorityTier,
        approvedAt: approvalEvent.approvedAt,
        targetRevisionId: specId,
        targetSpecificationFingerprint: specFingerprint,
        provenance: approvalProvenance
      };

      approvalHistory.push(approvalEvent);
    }
  } else if (revocationRecord) {
    if (input.approvalRecord) {
      approvalRecord = {
        ...input.approvalRecord,
        revocation: revocationRecord,
        revocationReason: revocationRecord.reason
      };
    }
  }

  const spec: AuthoritativeGarmentSpecification = {
    projectId: input.projectId ?? 'project-patroner-default',
    garmentId,
    specificationRevisionId: specId,
    parentRevisionId: input.parentRevisionId,
    supersededByRevisionId: input.supersededByRevisionId,
    version,
    name: input.name.trim(),
    garmentCategory: input.garmentCategory,
    silhouette: input.silhouette,
    prompt: input.prompt ?? '',
    color: input.color ?? { name: 'Chalk Oatmeal', hex: '#E8E3D9' },
    fabric: input.fabric,
    fabricRevision: input.fabricRevision,
    fabricProvenance: input.fabricProvenance ?? 'unknown',
    easeProfile: input.easeProfile,
    explicitEaseCm: input.explicitEaseCm ? { ...input.explicitEaseCm } : undefined,
    targetFinishedDimensions,
    dartStyle: input.dartStyle,
    sleeveEaseStrategy: input.sleeveEaseStrategy,
    allowances,
    constructionFeatures: input.constructionFeatures ? [...input.constructionFeatures] : [],
    designNotes: input.designNotes ? [...input.designNotes] : [],
    fieldProvenance,
    isApproved,
    approvalState,
    approvalAuthorityTier,
    approvalRecord,
    verifiedIdentity: approvalRecord?.verifiedIdentity,
    cryptographicSignature: approvalRecord?.cryptographicSignature,
    approvalHistory: approvalHistory.length > 0 ? approvalHistory : undefined,
    revocationRecord,
    approvedBy,
    approvedAt,
    approvalProvenance,
    engineProvenance,
    aiEstimates: input.aiEstimates,
    createdAt: now,
    updatedAt: now
  };

  return deepFreeze(spec);
}

/**
 * Creates a revised specification from an existing baseline.
 * Enforces historical immutability: the base specification remains unchanged.
 * Prohibits editing an approved specification in place.
 * The new revision increments the version, tracks parentRevisionId, records supersession in history,
 * and resets approval to 'draft'.
 */
export function reviseAuthoritativeGarmentSpecification(
  base: AuthoritativeGarmentSpecification,
  updates: Partial<CreateAuthoritativeSpecificationInput>
): AuthoritativeGarmentSpecification {
  if (base.isApproved || base.approvalState === 'approved') {
    if (
      (updates.version !== undefined && updates.version <= base.version) ||
      (updates.specificationRevisionId !== undefined && updates.specificationRevisionId === base.specificationRevisionId)
    ) {
      throw new ProductionSnapshotValidationError(
        'Cannot edit an approved specification in place. A modification must create a new revision with an incremented version.'
      );
    }
  }

  const newVersion = updates.version ?? (base.version + 1);
  const newRevisionId = updates.specificationRevisionId ?? `spec-${base.garmentId}-v${newVersion}`;
  const parentRevisionId = updates.parentRevisionId !== undefined
    ? updates.parentRevisionId
    : (newVersion === base.version ? base.parentRevisionId : base.specificationRevisionId);

  const baseFp = computeSpecificationFingerprint(base);
  const supersessionEvent: SpecificationSupersessionEvent = {
    id: `sup-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    eventType: 'supersession',
    targetRevisionId: base.specificationRevisionId,
    targetSpecificationFingerprint: baseFp,
    supersededByRevisionId: newRevisionId,
    authorityTier: base.approvalAuthorityTier ?? 'unauthenticated_local_session',
    supersededAt: new Date().toISOString(),
    reason: `Superseded by revision ${newRevisionId} (v${newVersion}).`
  };

  const history: SpecificationLifecycleEvent[] = updates.approvalHistory
    ? [...updates.approvalHistory]
    : base.approvalHistory
    ? [...base.approvalHistory, supersessionEvent]
    : [supersessionEvent];

  return createAuthoritativeGarmentSpecification({
    projectId: updates.projectId ?? base.projectId,
    garmentId: updates.garmentId ?? base.garmentId,
    specificationRevisionId: newRevisionId,
    parentRevisionId,
    version: newVersion,
    name: updates.name ?? base.name,
    garmentCategory: updates.garmentCategory ?? base.garmentCategory,
    silhouette: updates.silhouette ?? base.silhouette,
    prompt: updates.prompt ?? base.prompt,
    color: updates.color ?? base.color,
    fabric: updates.fabric ?? base.fabric,
    fabricRevision: updates.fabricRevision ?? base.fabricRevision,
    fabricProvenance: updates.fabricProvenance ?? base.fabricProvenance,
    easeProfile: updates.easeProfile ?? base.easeProfile,
    explicitEaseCm: updates.explicitEaseCm !== undefined ? updates.explicitEaseCm : base.explicitEaseCm,
    lengthCm: updates.lengthCm ?? base.targetFinishedDimensions.lengthCm,
    targetFinishedDimensions: {
      ...base.targetFinishedDimensions,
      ...(updates.targetFinishedDimensions ?? {})
    },
    dartStyle: updates.dartStyle ?? base.dartStyle,
    sleeveEaseStrategy: updates.sleeveEaseStrategy ?? base.sleeveEaseStrategy,
    allowances: {
      ...base.allowances,
      ...(updates.allowances ?? {})
    },
    constructionFeatures: updates.constructionFeatures ?? base.constructionFeatures,
    designNotes: updates.designNotes ?? base.designNotes,
    fieldProvenance: updates.fieldProvenance ?? base.fieldProvenance,
    // A newly modified specification requires new approval
    isApproved: updates.isApproved ?? false,
    approvalState: updates.approvalState ?? (updates.isApproved ? 'approved' : 'draft'),
    approvalAuthorityTier: updates.approvalAuthorityTier,
    approvalRecord: updates.approvalRecord,
    approvalHistory: history,
    revocationRecord: updates.revocationRecord,
    approvedBy: updates.approvedBy,
    approvedAt: updates.approvedAt,
    approvalProvenance: updates.approvalProvenance ?? 'designer-edited',
    engineProvenance: updates.engineProvenance ?? base.engineProvenance,
    aiEstimates: updates.aiEstimates ?? (base.aiEstimates ? {
      suggestedSilhouette: base.aiEstimates.suggestedSilhouette,
      styleConfidenceScore: base.aiEstimates.styleConfidenceScore,
      suggestedFabrics: [...base.aiEstimates.suggestedFabrics],
      technicalAdvice: base.aiEstimates.technicalAdvice,
      disclaimer: base.aiEstimates.disclaimer
    } : undefined)
  });
}

/**
 * Marks a specification revision as superseded by a newer revision, preserving append-only history.
 * Supports either passing a target revision ID string or an updates object (returning both supersededSpec and nextRevision).
 */
export function supersedeAuthoritativeGarmentSpecification(
  spec: AuthoritativeGarmentSpecification,
  supersededByRevisionId: string,
  reason?: string
): AuthoritativeGarmentSpecification;
export function supersedeAuthoritativeGarmentSpecification(
  spec: AuthoritativeGarmentSpecification,
  updates: Partial<CreateAuthoritativeSpecificationInput>,
  reason?: string
): {
  supersededSpec: AuthoritativeGarmentSpecification;
  nextRevision: AuthoritativeGarmentSpecification;
};
export function supersedeAuthoritativeGarmentSpecification(
  spec: AuthoritativeGarmentSpecification,
  supersededByOrUpdates: string | Partial<CreateAuthoritativeSpecificationInput>,
  reason?: string
):
  | AuthoritativeGarmentSpecification
  | {
      supersededSpec: AuthoritativeGarmentSpecification;
      nextRevision: AuthoritativeGarmentSpecification;
    } {
  if (typeof supersededByOrUpdates === 'object' && supersededByOrUpdates !== null) {
    const nextRevision = reviseAuthoritativeGarmentSpecification(spec, supersededByOrUpdates);
    const supersededSpec = supersedeAuthoritativeGarmentSpecification(
      spec,
      nextRevision.specificationRevisionId,
      reason
    );
    return deepFreeze({ supersededSpec, nextRevision });
  }

  const supersededByRevisionId = supersededByOrUpdates;
  if (!supersededByRevisionId || supersededByRevisionId.trim() === '') {
    throw new ProductionSnapshotValidationError('supersededByRevisionId is required to mark a specification superseded.');
  }
  const now = new Date().toISOString();
  const specFingerprint = computeSpecificationFingerprint(spec);
  const supEvent: SpecificationSupersessionEvent = {
    id: `sup-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    eventType: 'supersession',
    targetRevisionId: spec.specificationRevisionId,
    targetSpecificationFingerprint: specFingerprint,
    supersededByRevisionId: supersededByRevisionId.trim(),
    authorityTier: spec.approvalAuthorityTier ?? 'unauthenticated_local_session',
    supersededAt: now,
    reason: reason ?? `Superseded by ${supersededByRevisionId.trim()}`
  };

  const history: SpecificationLifecycleEvent[] = spec.approvalHistory
    ? [...spec.approvalHistory, supEvent]
    : [supEvent];

  return createAuthoritativeGarmentSpecification({
    ...spec,
    lengthCm: spec.targetFinishedDimensions.lengthCm,
    supersededByRevisionId: supersededByRevisionId.trim(),
    isApproved: false,
    approvalState: 'superseded',
    approvalHistory: history
  });
}

export interface ApproveSpecificationOptions {
  readonly approvedAt?: string;
  readonly approverId?: string;
  readonly authorityTier?: ApprovalAuthorityTier;
  readonly notes?: string;
  readonly eventId?: string;
  readonly approvalEventId?: string;
  readonly identityCredential?: VerifiableIdentityCredential;
  readonly identityVerifier?: TrustedIdentityVerifier;
  readonly cryptographicSignature?: VerifiableCryptographicSignature;
  readonly cryptographicVerifier?: TrustedCryptographicVerifier;
}

/**
 * Formally approves a specification revision.
 * Enforces real identity-credential verification for Tier 3 (authenticated_designer) and
 * real 10-field signature verification for Tier 4 (cryptographic_principal).
 */
export function approveAuthoritativeGarmentSpecification(
  spec: AuthoritativeGarmentSpecification,
  approvedBy: string,
  approvedAtOrOptions?: string | ApproveSpecificationOptions
): AuthoritativeGarmentSpecification {
  if (!approvedBy || approvedBy.trim() === '') {
    throw new ProductionSnapshotValidationError('Cannot approve specification without a valid approvedBy identity.');
  }

  let approvedAt: string;
  let authorityTier: ApprovalAuthorityTier = 'unauthenticated_local_session';
  let notes: string | undefined = undefined;
  let opts: ApproveSpecificationOptions = {};

  if (typeof approvedAtOrOptions === 'string') {
    approvedAt = approvedAtOrOptions;
  } else if (approvedAtOrOptions && typeof approvedAtOrOptions === 'object') {
    opts = approvedAtOrOptions;
    approvedAt = opts.approvedAt ?? new Date().toISOString();
    authorityTier = opts.authorityTier ?? 'unauthenticated_local_session';
    notes = opts.notes;
  } else {
    approvedAt = new Date().toISOString();
  }

  if (!isValidIsoDate(approvedAt)) {
    throw new ProductionSnapshotValidationError('Approval timestamp must be a valid ISO 8601 date.');
  }

  // Prepare clean specification copy without prior revocation so fingerprint reflects approved state
  const cleanSpecForFp: AuthoritativeGarmentSpecification = {
    ...spec,
    supersededByRevisionId: undefined,
    revocationRecord: undefined
  };
  const specFingerprint = computeSpecificationFingerprint(cleanSpecForFp);
  const eventId =
    opts.eventId ??
    opts.approvalEventId ??
    `appr-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  let approverId =
    opts.approverId && opts.approverId.trim() !== '' && opts.approverId.trim() !== approvedBy.trim()
      ? opts.approverId.trim()
      : `approver-${approvedBy.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  let verifiedIdentity: VerifiedIdentityProvenance | undefined = undefined;
  let cryptographicSignature: VerifiableCryptographicSignature | undefined = undefined;

  // Tier 3: Require real identity provider verification operation
  if (authorityTier === 'authenticated_designer') {
    const verifyFn =
      opts.identityVerifier?.verifyIdentityCredential?.bind(opts.identityVerifier) ??
      opts.identityVerifier?.verifyCredential?.bind(opts.identityVerifier);

    if (!opts.identityVerifier || typeof verifyFn !== 'function' || !opts.identityCredential) {
      throw new ProductionSnapshotValidationError(
        'authenticated_designer authority tier is unavailable without verified identity provider configuration (TrustedIdentityVerifier and VerifiableIdentityCredential required).'
      );
    }

    let idResult: TrustedIdentityVerificationResult;
    try {
      idResult = verifyFn(opts.identityCredential, {
        targetRevisionId: spec.specificationRevisionId,
        targetSpecificationFingerprint: specFingerprint,
        expectedApprover: approvedBy.trim(),
        approvalTimestamp: approvedAt
      });
    } catch (err) {
      throw new ProductionSnapshotValidationError(
        `authenticated_designer identity verification failed closed due to verifier exception: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!idResult || !idResult.verified || !idResult.provenance) {
      throw new ProductionSnapshotValidationError(
        `authenticated_designer identity verification rejected: ${idResult?.reason ?? 'invalid identity credential'}`
      );
    }

    if (opts.approverId && idResult.provenance.subject !== opts.approverId.trim()) {
      throw new ProductionSnapshotValidationError(
        `Identity credential subject '${idResult.provenance.subject}' does not match requested approver '${opts.approverId}'.`
      );
    }

    verifiedIdentity = idResult.provenance;
    approverId = verifiedIdentity.subject;
  }

  // Tier 4: Require real cryptographic signature verification operation over all 10 required fields
  if (authorityTier === 'cryptographic_principal') {
    if (
      !opts.cryptographicVerifier ||
      typeof opts.cryptographicVerifier.verifyApprovalSignature !== 'function' ||
      !opts.cryptographicSignature
    ) {
      throw new ProductionSnapshotValidationError(
        'cryptographic_principal authority tier is unavailable without cryptographic provider configuration (TrustedCryptographicVerifier and VerifiableCryptographicSignature required).'
      );
    }

    const expectedPrincipal =
      opts.approverId && opts.approverId.trim() !== ''
        ? opts.approverId.trim()
        : opts.cryptographicSignature.signedPayload?.approverPrincipal;
    if (!expectedPrincipal || expectedPrincipal.trim() === '') {
      throw new ProductionSnapshotValidationError(
        'cryptographic_principal requires a non-empty cryptographic principal identifier.'
      );
    }

    const expectedBindingPayload: CryptographicApprovalBindingPayload = {
      schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
      projectId: spec.projectId,
      tenantId: spec.projectId,
      garmentId: spec.garmentId,
      specificationRevisionId: spec.specificationRevisionId,
      specificationVersion: spec.version,
      canonicalSpecificationFingerprint: specFingerprint,
      approvalEventId: eventId,
      approverPrincipal: expectedPrincipal,
      authorityTier: 'cryptographic_principal',
      approvalScope: 'specification_approval',
      approvalTimestamp: approvedAt,
      keyId: opts.cryptographicSignature.keyId,
      algorithm: opts.cryptographicSignature.algorithm
    };

    let sigResult: TrustedCryptographicVerificationResult;
    try {
      sigResult = opts.cryptographicVerifier.verifyApprovalSignature(
        opts.cryptographicSignature,
        expectedBindingPayload
      );
    } catch (err) {
      throw new ProductionSnapshotValidationError(
        `Cryptographic signature verification failed due to verifier exception: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!sigResult || !sigResult.verified) {
      throw new ProductionSnapshotValidationError(
        `Cryptographic signature verification failed: ${sigResult?.reason ?? 'invalid signature'}`
      );
    }

    cryptographicSignature = opts.cryptographicSignature;
    approverId = expectedPrincipal;
  }

  const finalEventId = cryptographicSignature?.signedPayload.approvalEventId ?? eventId;

  const approvalEvent: SpecificationApprovalEvent = {
    id: finalEventId,
    eventType: 'approval',
    targetRevisionId: spec.specificationRevisionId,
    targetSpecificationFingerprint: specFingerprint,
    approverId,
    approverName: approvedBy.trim(),
    authorityTier,
    approvedAt,
    notes,
    provenance:
      authorityTier === 'demonstration_fixture'
        ? 'demonstration-fixture'
        : authorityTier === 'authenticated_designer' || authorityTier === 'cryptographic_principal'
        ? 'designer-approved'
        : 'unauthenticated-local-approval',
    verifiedIdentity,
    cryptographicSignature
  };

  const approvalRecord: SpecificationApprovalRecord = {
    eventId: finalEventId,
    approverId: approvalEvent.approverId,
    approverName: approvalEvent.approverName,
    authorityTier,
    approvedAt,
    targetRevisionId: spec.specificationRevisionId,
    targetSpecificationFingerprint: specFingerprint,
    notes,
    provenance: approvalEvent.provenance,
    verifiedIdentity,
    cryptographicSignature
  };

  const history: SpecificationLifecycleEvent[] = spec.approvalHistory
    ? [...spec.approvalHistory, approvalEvent]
    : [approvalEvent];

  return createAuthoritativeGarmentSpecification({
    ...spec,
    lengthCm: spec.targetFinishedDimensions.lengthCm,
    specificationRevisionId: spec.specificationRevisionId,
    parentRevisionId: spec.parentRevisionId,
    supersededByRevisionId: undefined,
    version: spec.version,
    isApproved: true,
    approvalState: 'approved',
    approvalAuthorityTier: authorityTier,
    approvalRecord,
    approvalHistory: history,
    revocationRecord: undefined,
    approvedBy: approvedBy.trim(),
    approvedAt,
    approvalProvenance: approvalEvent.provenance
  });
}

/**
 * Revokes approval on a specification.
 * Returns a new record explicitly marked unapproved with revocation state.
 * Preserves the original approval event in append-only history.
 */
export function revokeAuthoritativeGarmentSpecificationApproval(
  spec: AuthoritativeGarmentSpecification,
  reason: string,
  options?: {
    revokerId?: string;
    revokerName?: string;
    revokedAt?: string;
    authorityTier?: ApprovalAuthorityTier;
  }
): AuthoritativeGarmentSpecification {
  const cleanReason = (reason ?? '').trim();
  if (!cleanReason) {
    throw new ProductionSnapshotValidationError('Revocation reason is mandatory and cannot be empty.');
  }

  const now = options?.revokedAt ?? new Date().toISOString();
  if (!isValidIsoDate(now)) {
    throw new ProductionSnapshotValidationError('Revocation timestamp must be a valid ISO 8601 date.');
  }

  const revokerId = options?.revokerId ?? 'operator-revoker';
  const revokerName = options?.revokerName ?? 'Local Atelier Operator';
  const authorityTier = options?.authorityTier ?? spec.approvalRecord?.authorityTier ?? 'unauthenticated_local_session';

  const specFingerprint = computeSpecificationFingerprint(spec);
  const revocationEventId = `rev-evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const revocationEvent: SpecificationRevocationEvent = {
    id: revocationEventId,
    eventType: 'revocation',
    originalApprovalEventId: spec.approvalRecord?.eventId,
    targetRevisionId: spec.specificationRevisionId,
    targetSpecificationFingerprint: specFingerprint,
    revokerId,
    revokerName,
    authorityTier,
    revokedAt: now,
    reason: cleanReason
  };

  const updatedApprovalRecord: SpecificationApprovalRecord | undefined = spec.approvalRecord ? {
    ...spec.approvalRecord,
    revocation: revocationEvent,
    revocationReason: cleanReason
  } : undefined;

  const history: SpecificationLifecycleEvent[] = spec.approvalHistory
    ? [...spec.approvalHistory, revocationEvent]
    : [revocationEvent];

  const notes = [...spec.designNotes, `Approval revoked: ${cleanReason}`];

  return createAuthoritativeGarmentSpecification({
    ...spec,
    lengthCm: spec.targetFinishedDimensions.lengthCm,
    specificationRevisionId: spec.specificationRevisionId,
    parentRevisionId: spec.parentRevisionId,
    version: spec.version,
    isApproved: false,
    approvalState: 'revoked',
    approvalAuthorityTier: undefined,
    approvalRecord: updatedApprovalRecord,
    approvalHistory: history,
    revocationRecord: revocationEvent,
    approvedBy: undefined,
    approvedAt: undefined,
    approvalProvenance: 'designer-edited',
    designNotes: notes
  });
}

/**
 * Converts an AuthoritativeGarmentSpecification to the standard DesignSpecification
 * consumed across the CAD and UI layers, ensuring bidirectional lossless compatibility.
 */
export function convertToDesignSpecification(
  spec: AuthoritativeGarmentSpecification
): DesignSpecification {
  return {
    id: spec.garmentId,
    name: spec.name,
    prompt: spec.prompt,
    garmentCategory: spec.garmentCategory,
    silhouette: spec.silhouette,
    fabric: spec.fabric,
    color: spec.color,
    easeProfile: spec.easeProfile,
    lengthCm: spec.targetFinishedDimensions.lengthCm,
    dartStyle: spec.dartStyle,
    sleeveEaseStrategy: spec.sleeveEaseStrategy,
    constructionFeatures: [...spec.constructionFeatures],
    designNotes: [...spec.designNotes],
    fieldProvenance: spec.fieldProvenance ? { ...spec.fieldProvenance } : undefined,
    supersededByRevisionId: spec.supersededByRevisionId,
    isApproved: spec.isApproved,
    approvalState: spec.approvalState,
    approvalAuthorityTier: spec.approvalAuthorityTier,
    approvalRecord: spec.approvalRecord ? {
      eventId: spec.approvalRecord.eventId,
      approverId: spec.approvalRecord.approverId,
      approverName: spec.approvalRecord.approverName,
      authorityTier: spec.approvalRecord.authorityTier,
      approvedAt: spec.approvalRecord.approvedAt,
      targetRevisionId: spec.approvalRecord.targetRevisionId,
      targetSpecificationFingerprint: spec.approvalRecord.targetSpecificationFingerprint,
      revocationReason: spec.approvalRecord.revocationReason,
      notes: spec.approvalRecord.notes,
      provenance: spec.approvalRecord.provenance,
      verifiedIdentity: spec.approvalRecord.verifiedIdentity ? { ...spec.approvalRecord.verifiedIdentity } : undefined,
      cryptographicSignature: spec.approvalRecord.cryptographicSignature ? {
        ...spec.approvalRecord.cryptographicSignature,
        signedPayload: { ...spec.approvalRecord.cryptographicSignature.signedPayload }
      } : undefined,
      revocation: spec.approvalRecord.revocation ? { ...spec.approvalRecord.revocation } : undefined
    } : undefined,
    approvalHistory: spec.approvalHistory ? spec.approvalHistory.map(evt => ({ ...evt })) : undefined,
    revocationRecord: spec.revocationRecord ? { ...spec.revocationRecord } : undefined,
    approvedAt: spec.approvedAt,
    version: spec.version,
    aiEstimates: spec.aiEstimates ? {
      suggestedSilhouette: spec.aiEstimates.suggestedSilhouette,
      styleConfidenceScore: spec.aiEstimates.styleConfidenceScore,
      suggestedFabrics: [...spec.aiEstimates.suggestedFabrics],
      technicalAdvice: spec.aiEstimates.technicalAdvice,
      disclaimer: spec.aiEstimates.disclaimer
    } : undefined,
    specificationRevisionId: spec.specificationRevisionId,
    parentRevisionId: spec.parentRevisionId,
    projectId: spec.projectId,
    fabricRevision: spec.fabricRevision,
    fabricProvenance: spec.fabricProvenance,
    approvedBy: spec.approvedBy,
    approvalProvenance: spec.approvalProvenance,
    explicitEaseCm: spec.explicitEaseCm ? { ...spec.explicitEaseCm } : undefined,
    targetFinishedDimensions: {
      length: spec.targetFinishedDimensions.lengthCm,
      waist: spec.targetFinishedDimensions.waistCm,
      hip: spec.targetFinishedDimensions.hipCm,
      bust: spec.targetFinishedDimensions.bustCm,
      chest: spec.targetFinishedDimensions.chestCm,
      acrossBack: spec.targetFinishedDimensions.acrossBackCm,
      bicep: spec.targetFinishedDimensions.bicepCm,
      wrist: spec.targetFinishedDimensions.wristCm
    },
    seamAllowanceCm: spec.allowances.seamAllowanceCm,
    hemAllowanceCm: spec.allowances.hemAllowanceCm,
    waistAllowanceCm: spec.allowances.waistAllowanceCm,
    neckAllowanceCm: spec.allowances.neckAllowanceCm,
    armholeAllowanceCm: spec.allowances.armholeAllowanceCm,
    shoulderAllowanceCm: spec.allowances.shoulderAllowanceCm
  };
}

/**
 * Converts a standard DesignSpecification into an AuthoritativeGarmentSpecification.
 * Strictly prevents unauthenticated, empty, or fabricated approvals from being granted.
 */
export function convertFromDesignSpecification(
  design: DesignSpecification,
  options: {
    projectId?: string;
    parentRevisionId?: string;
    specificationRevisionId?: string;
  } = {}
): AuthoritativeGarmentSpecification {
  const targetFinishedDimensions: Partial<AuthoritativeGarmentSpecification['targetFinishedDimensions']> = {
    lengthCm: design.lengthCm,
    waistCm: design.targetFinishedDimensions?.waist,
    hipCm: design.targetFinishedDimensions?.hip,
    bustCm: design.targetFinishedDimensions?.bust,
    chestCm: design.targetFinishedDimensions?.chest,
    acrossBackCm: design.targetFinishedDimensions?.acrossBack,
    bicepCm: design.targetFinishedDimensions?.bicep,
    wristCm: design.targetFinishedDimensions?.wrist
  };

  const hasValidApprover = Boolean(design.approvedBy && design.approvedBy.trim() !== '');
  const isRevoked = design.approvalState === 'revoked' || design.revocationRecord !== undefined;
  const isSuperseded = design.approvalState === 'superseded' || Boolean(design.supersededByRevisionId);
  const isApproved = Boolean(design.isApproved && hasValidApprover && !isRevoked && !isSuperseded);
  const approvalState: SpecificationApprovalState = isRevoked
    ? 'revoked'
    : isSuperseded
    ? 'superseded'
    : isApproved
    ? (design.approvalState ?? 'approved')
    : 'draft';

  return createAuthoritativeGarmentSpecification({
    projectId: options.projectId ?? design.projectId ?? 'project-patroner-default',
    garmentId: design.id,
    specificationRevisionId: options.specificationRevisionId ?? design.specificationRevisionId ?? `spec-${design.id}-v${design.version || 1}`,
    parentRevisionId: options.parentRevisionId ?? design.parentRevisionId,
    supersededByRevisionId: design.supersededByRevisionId,
    version: design.version || 1,
    name: design.name,
    garmentCategory: design.garmentCategory,
    silhouette: design.silhouette,
    prompt: design.prompt,
    color: design.color,
    fabric: design.fabric,
    fabricRevision: design.fabricRevision,
    fabricProvenance: design.fabricProvenance,
    easeProfile: design.easeProfile,
    explicitEaseCm: design.explicitEaseCm,
    lengthCm: design.lengthCm,
    targetFinishedDimensions,
    dartStyle: design.dartStyle,
    sleeveEaseStrategy: design.sleeveEaseStrategy,
    allowances: {
      seamAllowanceCm: design.seamAllowanceCm ?? 1.5,
      hemAllowanceCm: design.hemAllowanceCm ?? 3.0,
      waistAllowanceCm: design.waistAllowanceCm ?? 1.0,
      neckAllowanceCm: design.neckAllowanceCm ?? 1.0,
      armholeAllowanceCm: design.armholeAllowanceCm ?? 1.0,
      shoulderAllowanceCm: design.shoulderAllowanceCm ?? 1.0
    },
    constructionFeatures: design.constructionFeatures,
    designNotes: design.designNotes,
    fieldProvenance: design.fieldProvenance,
    isApproved,
    approvalState,
    approvalAuthorityTier: design.approvalAuthorityTier ?? (isApproved ? 'unauthenticated_local_session' : undefined),
    approvalRecord: design.approvalRecord as SpecificationApprovalRecord | undefined,
    approvalHistory: design.approvalHistory as SpecificationLifecycleEvent[] | undefined,
    revocationRecord: design.revocationRecord as SpecificationRevocationEvent | undefined,
    approvedBy: isApproved ? design.approvedBy : undefined,
    approvedAt: isApproved ? design.approvedAt : undefined,
    approvalProvenance: design.approvalProvenance ?? (isApproved ? 'unauthenticated-local-approval' : 'designer-edited'),
    aiEstimates: design.aiEstimates
  });
}
