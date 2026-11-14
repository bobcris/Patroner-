/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner Authoritative Garment Specification Engine (Milestone 04.6.2.3.4)
 *
 * Implements:
 * 1. Complete canonical specification serialization & SHA-256 fingerprinting.
 * 2. Hardened RFC 8032 Ed25519 asymmetric public-key signature creation & verification
 *    with strict small-order torsion point rejection and public-key-only boundaries (FINDING-01..05, 08..11).
 * 3. Hardened OIDC / JWT (`EdDSA` / `Ed25519`) compact token verification against a
 *    controlled JWKS registry with target-revision/fingerprint binding (`FINDING-06`),
 *    atomic single-use JTI replay protection (`JtiReplayStore`), critical header (`crit`)
 *    rejection (`FINDING-07`), `amr`/`acr` context validation, and trusted-time key
 *    lifecycle & compromise revocation enforcement (`FINDING-11`).
 * 4. Immutable revision and append-only approval/revocation history.
 */

import {
  BodiceDartStyle,
  DesignSpecification,
  EaseProfile,
  FabricProperty,
  GarmentCategory,
  GarmentConstructionFeature,
  Silhouette,
  SleeveEaseStrategy
} from '../../types';
import {
  EnhancedFabricProperty
} from '../fabric/fabric-types';
import { getEnhancedFabricById } from '../fabric/fabric-presets';
import {
  base64UrlDecodeToBytes,
  base64UrlDecodeToUtf8,
  base64UrlEncodeBytes,
  base64UrlEncodeUtf8,
  bytesToHex,
  canonicalizeJson,
  computeCanonicalSha256,
  computeEd25519PublicKeyFingerprint,
  Ed25519KeyPair,
  generateEd25519KeyPairFromPassphrase,
  generateEd25519KeyPairFromRawSeedHex,
  hexToBytes,
  isValidEd25519PublicKey,
  isValidEd25519PublicKeyBytes,
  sha256Hex,
  signEd25519Bytes,
  signEd25519Message,
  utf8ToBytes,
  verifyEd25519Bytes,
  verifyEd25519Signature
} from './crypto';
import {
  ApprovalAuthorityTier,
  ApprovalVerificationContext,
  AuthoritativeGarmentSpecification,
  AuthorityProviderContext,
  CanonicalApprovalSigningPayload,
  ControlledPublicKeyRegistration,
  ControlledPublicKeyRegistry,
  CreateAuthoritativeSpecificationInput,
  CryptographicApprovalBindingPayload,
  CryptographicVerificationResult,
  ExplicitGarmentEaseAllowances,
  IdentityCredentialVerificationOptions,
  IdentityVerificationResult,
  JtiReplayRecord,
  JtiReplayStore,
  ManufacturingSeamAllowances,
  OidcJwkPublicKey,
  OidcJwtHeader,
  OidcJwtPayload,
  ParameterValueProvenance,
  SPECIFICATION_CANONICAL_SCHEMA_VERSION,
  SpecificationApprovalEvent,
  SpecificationApprovalRecord,
  SpecificationApprovalVerificationContext,
  SpecificationApprovalVerificationResult,
  SpecificationLifecycleEvent,
  SpecificationRevocationEvent,
  SpecificationValueProvenance,
  TargetFinishedGarmentDimensions,
  TrustedCryptographicVerifier,
  TrustedIdentityVerifier,
  VerifiableCryptographicSignature,
  VerifiableIdentityCredential,
  VerifiedIdentityProvenance
} from './garment-specification-types';
import {
  CanonicalPatternApprovalSigningPayload,
  EngineProvenanceRecord,
  FabricSnapshotProvenance,
  PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION,
  ProductionSnapshotValidationError
} from './production-types';

// ============================================================================
// STRICT PUBLIC-KEY-ONLY BOUNDARY GUARD & ALLOWLISTED SCHEMAS (FINDING-08, FINDING-10, AUDIT-04.6.2.3.5-04)
// ============================================================================

/**
 * Exhaustive list of private-key, seed, and shared-secret field names that MUST NEVER
 * appear at any nesting depth in any verification-only configuration, public-key registration, or JWK (`FINDING-10`, `AUDIT-04.6.2.3.5-04`).
 */
export const FORBIDDEN_VERIFIER_PRIVATE_KEY_FIELDS = Object.freeze([
  'd',
  'k',
  'privateKey',
  'privateKeyHex',
  'privateKeyBytes',
  'privateKeyPem',
  'privateKeyDer',
  'privateKeyJwk',
  'privateKeySecret',
  'privateKeySeed',
  'privateKeySeedHex',
  'privateKeyMaterial',
  'privateSeed',
  'privateSeedHex',
  'rawPrivateSeed',
  'rawSeed',
  'rawSeedHex',
  'seed',
  'seedHex',
  'seedBytes',
  'seedPhrase',
  'passphrase',
  'signingKey',
  'signingKeyHex',
  'signingKeyMaterial',
  'signingMaterial',
  'signingSeed',
  'signingSecret',
  'signingSecretOrPrivateKeyHex',
  'secret',
  'secretKey',
  'secretSeed',
  'secretMaterial',
  'sharedSecret',
  'providerSecret',
  'hmacSecret',
  'clientSecret',
  'private_key_seed'
] as const);

const NORMALIZED_FORBIDDEN_VERIFIER_FIELDS: ReadonlySet<string> = new Set(
  FORBIDDEN_VERIFIER_PRIVATE_KEY_FIELDS.map(f =>
    f.replace(/[_\-\.\s]/g, '').toLowerCase()
  )
);

const FORBIDDEN_VERIFIER_FIELD_SUBSTRINGS = [
  'privatekey',
  'privateseed',
  'rawseed',
  'signingkey',
  'signingsecret',
  'signingmaterial',
  'secretkey',
  'secretmaterial',
  'secretseed',
  'sharedsecret',
  'providersecret'
] as const;

export const ALLOWED_PUBLIC_KEY_REGISTRATION_KEYS: ReadonlySet<string> = new Set([
  'keyId',
  'publicKeyHex',
  'publicKeyBase64Url',
  'publicKeyFingerprint',
  'algorithm',
  'principalId',
  'ownerPrincipal',
  'issuer',
  'providerId',
  'tenantId',
  'organizationScope',
  'activatedAt',
  'expiresAt',
  'revoked',
  'compromised',
  'revokedAt',
  'revocationReason',
  'revocationReasonCode',
  'trustStatus',
  'registrationProvenance',
  'allowedPrincipals',
  'allowedScopes'
]);

export const ALLOWED_PUBLIC_KEY_REGISTRY_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'entries'
]);

export const ALLOWED_OIDC_JWK_KEYS: ReadonlySet<string> = new Set([
  'kty',
  'crv',
  'kid',
  'alg',
  'use',
  'x',
  'publicKeyHex',
  'issuer',
  'tenantId',
  'activatedAt',
  'expiresAt',
  'revoked',
  'compromised',
  'revokedAt',
  'revocationReason',
  'trustStatus'
]);

export const ALLOWED_CRYPTO_VERIFIER_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'publicKeyRegistry',
  'trustedKeys',
  'trustedIssuers',
  'expectedTenantId',
  'referenceTimeIso',
  'clockSkewToleranceSeconds',
  'allowDuplicatePublicKeyMaterial'
]);

export const ALLOWED_IDENTITY_VERIFIER_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'trustedIssuer',
  'trustedIssuers',
  'expectedAudience',
  'publicJwks',
  'expectedTenantId',
  'referenceTimeIso',
  'clockSkewToleranceSeconds',
  'replayStore',
  'requireDurableReplayStore',
  'requiredAcr',
  'requiredAmr',
  'supportedCriticalHeaders'
]);

export const ALLOWED_REPLAY_STORE_KEYS: ReadonlySet<string> = new Set([
  'isDurableDistributedStore',
  'storeType',
  'consumeJti',
  'getConsumedRecord',
  'purgeExpired'
]);

function isPlainRecordObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isForbiddenSecretPropertyName(rawKey: string): boolean {
  const normalized = rawKey.replace(/[_\-\.\s]/g, '').toLowerCase();
  if (NORMALIZED_FORBIDDEN_VERIFIER_FIELDS.has(normalized)) {
    return true;
  }
  for (const sub of FORBIDDEN_VERIFIER_FIELD_SUBSTRINGS) {
    if (normalized.includes(sub)) {
      return true;
    }
  }
  return false;
}

function assertStrictAllowedKeys(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  boundaryName: string
): void {
  const ownSymbols = Object.getOwnPropertySymbols(obj);
  if (ownSymbols.length > 0) {
    throw new ProductionSnapshotValidationError(
      `Security boundary violation: ${boundaryName} must not contain Symbol-keyed properties.`,
      ['verifier-unknown-property-rejected']
    );
  }
  for (const key of Object.keys(obj)) {
    if (isForbiddenSecretPropertyName(key)) {
      if (key.trim() === 'd') {
        const dBoundary =
          boundaryName.includes('publicJwks') || boundaryName.includes('JWK')
            ? 'JWK in publicJwks'
            : boundaryName;
        throw new ProductionSnapshotValidationError(
          `Security boundary violation: ${dBoundary} must not contain private key parameter "d".`,
          ['verifier-private-key-material-forbidden']
        );
      }
      const secretBoundary =
        boundaryName.includes('publicKeyRegistry') ||
        boundaryName.includes('ControlledPublicKeyRegistration')
          ? 'ControlledPublicKeyRegistration'
          : boundaryName;
      throw new ProductionSnapshotValidationError(
        `Security boundary violation: ${secretBoundary} must contain public-key material only (forbidden private/secret field "${key}" detected).`,
        ['verifier-private-key-material-forbidden']
      );
    }
    if (!allowedKeys.has(key)) {
      throw new ProductionSnapshotValidationError(
        `Security boundary violation: unknown or unsupported property "${key}" in ${boundaryName} is rejected by strict verifier schema.`,
        ['verifier-unknown-property-rejected']
      );
    }
  }
}

/**
 * Recursively inspects any verifier configuration, key registration, or JWK structure
 * for private-key/seed/secret material, circular references, and non-plain objects (`AUDIT-04.6.2.3.5-04`).
 */
export function assertNoPrivateKeyMaterialInVerifierBoundary(
  candidate: unknown,
  boundaryName: string,
  visited: WeakSet<object> = new WeakSet<object>()
): void {
  if (candidate === null || candidate === undefined) {
    return;
  }
  const t = typeof candidate;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return;
  }
  if (t !== 'object') {
    throw new ProductionSnapshotValidationError(
      `Security boundary violation: ${boundaryName} contains unsupported value of type "${t}".`,
      ['verifier-non-plain-object-rejected']
    );
  }

  const obj = candidate as object;
  if (visited.has(obj)) {
    throw new ProductionSnapshotValidationError(
      `Security boundary violation: circular reference detected in ${boundaryName}.`,
      ['verifier-circular-reference-forbidden']
    );
  }

  if (
    ArrayBuffer.isView(obj) ||
    obj instanceof ArrayBuffer ||
    obj instanceof Date ||
    obj instanceof Map ||
    obj instanceof Set ||
    obj instanceof RegExp ||
    obj instanceof WeakMap ||
    obj instanceof WeakSet ||
    obj instanceof Promise
  ) {
    throw new ProductionSnapshotValidationError(
      `Security boundary violation: ${boundaryName} must not contain raw byte buffers, TypedArrays, or non-plain built-in instances (${obj.constructor?.name ?? 'Object'}).`,
      ['verifier-non-plain-object-rejected']
    );
  }

  if (Array.isArray(obj)) {
    visited.add(obj);
    for (let i = 0; i < obj.length; i++) {
      assertNoPrivateKeyMaterialInVerifierBoundary(
        obj[i],
        `${boundaryName}[${i}]`,
        visited
      );
    }
    return;
  }

  if (!isPlainRecordObject(obj)) {
    throw new ProductionSnapshotValidationError(
      `Security boundary violation: ${boundaryName} must be a plain object with a standard prototype (custom class instance "${obj.constructor?.name ?? 'unknown'}" rejected).`,
      ['verifier-non-plain-object-rejected']
    );
  }

  visited.add(obj);

  const ownSymbols = Object.getOwnPropertySymbols(obj);
  if (ownSymbols.length > 0) {
    throw new ProductionSnapshotValidationError(
      `Security boundary violation: ${boundaryName} must not contain Symbol-keyed properties.`,
      ['verifier-unknown-property-rejected']
    );
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (isForbiddenSecretPropertyName(key) && val !== undefined) {
      if (key.trim() === 'd') {
        const dBoundary =
          boundaryName.includes('publicJwks') || boundaryName.includes('JWK')
            ? 'JWK in publicJwks'
            : boundaryName;
        throw new ProductionSnapshotValidationError(
          `Security boundary violation: ${dBoundary} must not contain private key parameter "d".`,
          ['verifier-private-key-material-forbidden']
        );
      }
      const secretBoundary =
        boundaryName.includes('publicKeyRegistry') ||
        boundaryName.includes('ControlledPublicKeyRegistration')
          ? 'ControlledPublicKeyRegistration'
          : boundaryName;
      throw new ProductionSnapshotValidationError(
        `Security boundary violation: ${secretBoundary} must contain public-key material only (forbidden private/secret field "${key}" detected).`,
        ['verifier-private-key-material-forbidden']
      );
    }
    if (key === 'replayStore' && val && typeof val === 'object' && !Array.isArray(val)) {
      if (visited.has(val as object)) {
        throw new ProductionSnapshotValidationError(
          `Security boundary violation: circular reference detected in ${boundaryName}.replayStore.`,
          ['verifier-circular-reference-forbidden']
        );
      }
      if (!isPlainRecordObject(val)) {
        throw new ProductionSnapshotValidationError(
          `Security boundary violation: ${boundaryName}.replayStore must be a plain JtiReplayStore object.`,
          ['verifier-non-plain-object-rejected']
        );
      }
      visited.add(val as object);
      assertStrictAllowedKeys(val, ALLOWED_REPLAY_STORE_KEYS, `${boundaryName}.replayStore`);
      continue;
    }
    assertNoPrivateKeyMaterialInVerifierBoundary(
      val,
      `${boundaryName}.${key}`,
      visited
    );
  }
}

function resolveSigningKeyPairInternal(
  seedOrHex: string,
  options?: { inputFormat?: 'raw-seed-hex' | 'passphrase' }
): Ed25519KeyPair {
  if (typeof seedOrHex !== 'string' || seedOrHex.trim().length === 0) {
    throw new Error('Ed25519 signing seed cannot be empty.');
  }
  if (options?.inputFormat === 'raw-seed-hex') {
    return generateEd25519KeyPairFromRawSeedHex(seedOrHex);
  }
  if (options?.inputFormat === 'passphrase') {
    return generateEd25519KeyPairFromPassphrase(seedOrHex);
  }
  const trimmed = seedOrHex.trim();
  if (trimmed.length === 64 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return generateEd25519KeyPairFromRawSeedHex(trimmed);
  }
  return generateEd25519KeyPairFromPassphrase(seedOrHex);
}

// ============================================================================
// AUTHORITY PROVIDER CONTEXT (LEGACY BOOLEAN BYPASS PERMANENTLY DISABLED)
// ============================================================================

/**
 * Retained only for backwards-compatible test imports; never enables Tier 3 or Tier 4.
 * Calling `setAuthorityProviderContext({ identityProviderConfigured: true })` is a no-op
 * that keeps both flags `false`, preventing boolean privilege elevation (Scenario 31).
 */
export function setAuthorityProviderContext(_ctx: Partial<AuthorityProviderContext>): void {
  // Intentionally ignored: Tier 3 and Tier 4 require real asymmetric verifiers.
}

export function getAuthorityProviderContext(): AuthorityProviderContext {
  return {
    identityProviderConfigured: false,
    cryptographicProviderConfigured: false
  };
}

export function resetAuthorityProviderContext(): void {
  // No-op: global boolean flags are permanently disabled.
}

// ============================================================================
// CONTROLLED PUBLIC-KEY REGISTRY & GOVERNANCE (Ed25519)
// ============================================================================

export const PUBLIC_KEY_REGISTRY_SCHEMA_VERSION = '04.6.2.3.4-pk-registry-v1';

/**
 * Derives an Ed25519 signing keypair and a corresponding public-key-only
 * `ControlledPublicKeyRegistration` for test/HSM signing setup.
 * Supports both `deriveEd25519SigningKeyPair(seed)` and `deriveEd25519SigningKeyPair(keyId, seed, options)`.
 */
export function deriveEd25519SigningKeyPair(
  firstArg: string,
  secondArg?: string,
  options?: Partial<ControlledPublicKeyRegistration>
): {
  readonly keyId: string;
  readonly privateKeyHex: string;
  readonly publicKeyHex: string;
  readonly publicKeyBase64Url: string;
  readonly publicKeyFingerprint: string;
  readonly algorithm: 'Ed25519';
  readonly publicKeyRegistration: ControlledPublicKeyRegistration;
} {
  const hasExplicitKeyId = typeof secondArg === 'string' && secondArg.trim().length > 0;
  const seedOrHex = hasExplicitKeyId ? secondArg! : firstArg;
  const kp = resolveSigningKeyPairInternal(seedOrHex);
  const keyId = hasExplicitKeyId
    ? firstArg.trim()
    : options?.keyId?.trim() || `ed25519-key-${kp.publicKeyFingerprint.slice(0, 12)}`;

  const publicKeyRegistration: ControlledPublicKeyRegistration = Object.freeze({
    keyId,
    algorithm: 'Ed25519',
    publicKeyHex: kp.publicKeyHex,
    publicKeyBase64Url: kp.publicKeyBase64Url,
    publicKeyFingerprint: kp.publicKeyFingerprint,
    principalId: options?.principalId ?? options?.ownerPrincipal ?? '*',
    ownerPrincipal: options?.ownerPrincipal ?? options?.principalId ?? '*',
    issuer: options?.issuer ?? 'urn:patroner:pki:default',
    tenantId: options?.tenantId ?? '*',
    allowedScopes: options?.allowedScopes ?? ['specification:approve'],
    activatedAt: options?.activatedAt ?? '2025-01-01T00:00:00.000Z',
    expiresAt: options?.expiresAt ?? '2030-01-01T00:00:00.000Z',
    revoked: options?.revoked ?? false,
    trustStatus: options?.trustStatus ?? 'controlled_local_public_key'
  });

  return Object.freeze({
    keyId,
    privateKeyHex: kp.privateKeyHex,
    publicKeyHex: kp.publicKeyHex,
    publicKeyBase64Url: kp.publicKeyBase64Url,
    publicKeyFingerprint: kp.publicKeyFingerprint,
    algorithm: 'Ed25519' as const,
    publicKeyRegistration
  });
}

/**
 * Creates an empty or initialized controlled public-key registry.
 */
export function createControlledPublicKeyRegistry(
  initialEntries: ControlledPublicKeyRegistration[] = []
): ControlledPublicKeyRegistry {
  let registry: ControlledPublicKeyRegistry = {
    schemaVersion: PUBLIC_KEY_REGISTRY_SCHEMA_VERSION,
    entries: {}
  };
  for (const entry of initialEntries) {
    registry = registerPublicKeyInRegistry(registry, entry);
  }
  return registry;
}

/**
 * Validates a `ControlledPublicKeyRegistration` entry to ensure it contains only
 * valid, canonical, non-torsion Ed25519 public-key material (`FINDING-02`, `FINDING-08`, `FINDING-10`, `AUDIT-04.6.2.3.5-04`).
 */
export function validateControlledPublicKeyRegistration(
  registration: ControlledPublicKeyRegistration
): ControlledPublicKeyRegistration {
  if (!registration || typeof registration !== 'object') {
    throw new ProductionSnapshotValidationError(
      'Invalid public-key registration: registration must be an object.',
      ['invalid-public-key-registration']
    );
  }

  // Strictly forbid any private-key, seed, circular reference, non-plain object, or unknown property (FINDING-08, FINDING-10, AUDIT-04.6.2.3.5-04)
  assertNoPrivateKeyMaterialInVerifierBoundary(
    registration,
    'ControlledPublicKeyRegistration'
  );
  assertStrictAllowedKeys(
    registration as unknown as Record<string, unknown>,
    ALLOWED_PUBLIC_KEY_REGISTRATION_KEYS,
    'ControlledPublicKeyRegistration'
  );

  if (typeof registration.keyId !== 'string' || registration.keyId.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'Public-key registration requires a non-empty keyId.',
      ['missing-key-id']
    );
  }

  const alg = registration.algorithm ?? 'Ed25519';
  if (alg !== 'Ed25519') {
    throw new ProductionSnapshotValidationError(
      `Unsupported public-key registration algorithm "${String(alg)}". Only "Ed25519" is permitted.`,
      ['unsupported-key-algorithm']
    );
  }

  const pubHex =
    typeof registration.publicKeyHex === 'string'
      ? registration.publicKeyHex.trim().toLowerCase()
      : '';
  if (!/^[0-9a-f]{64}$/.test(pubHex)) {
    throw new ProductionSnapshotValidationError(
      `Invalid Ed25519 publicKeyHex for keyId "${registration.keyId}": must be a 64-character hexadecimal string (32 bytes).`,
      ['invalid-ed25519-public-key']
    );
  }

  // Reject small-order torsion points and non-canonical curve encodings at registration time (FINDING-02, FINDING-04)
  if (!isValidEd25519PublicKey(pubHex)) {
    throw new ProductionSnapshotValidationError(
      `Invalid or small-order torsion Ed25519 publicKeyHex rejected for keyId "${registration.keyId}".`,
      ['torsion-or-invalid-ed25519-public-key']
    );
  }

  if (registration.publicKeyBase64Url !== undefined) {
    let decodedBytes: Uint8Array;
    try {
      decodedBytes = base64UrlDecodeToBytes(registration.publicKeyBase64Url);
    } catch {
      throw new ProductionSnapshotValidationError(
        `Invalid publicKeyBase64Url encoding for keyId "${registration.keyId}".`,
        ['invalid-ed25519-public-key-b64']
      );
    }
    if (bytesToHex(decodedBytes) !== pubHex) {
      throw new ProductionSnapshotValidationError(
        `Mismatch between publicKeyHex and publicKeyBase64Url for keyId "${registration.keyId}".`,
        ['inconsistent-public-key-encoding']
      );
    }
  }

  const expectedFp = computeEd25519PublicKeyFingerprint(pubHex);
  if (
    registration.publicKeyFingerprint !== undefined &&
    registration.publicKeyFingerprint.trim().toLowerCase() !== expectedFp &&
    registration.publicKeyFingerprint.trim().toLowerCase() !== sha256Hex(pubHex)
  ) {
    throw new ProductionSnapshotValidationError(
      `Public-key registration "${registration.keyId}" has inconsistent publicKeyFingerprint.`,
      ['inconsistent-public-key-fingerprint']
    );
  }

  const activatedAt = registration.activatedAt ?? '2020-01-01T00:00:00.000Z';
  const expiresAt = registration.expiresAt ?? '2035-01-01T00:00:00.000Z';
  const activatedMs = Date.parse(activatedAt);
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(activatedMs) || Number.isNaN(expiresMs) || expiresMs <= activatedMs) {
    throw new ProductionSnapshotValidationError(
      `Public-key registration "${registration.keyId}" has invalid activatedAt/expiresAt window.`,
      ['invalid-key-validity-window']
    );
  }

  const resolvedPrincipal =
    registration.ownerPrincipal?.trim() ||
    registration.principalId?.trim() ||
    '*';
  const resolvedTenant =
    registration.tenantId?.trim() ||
    registration.organizationScope?.trim() ||
    '*';
  const resolvedScopes =
    Array.isArray(registration.allowedScopes) && registration.allowedScopes.length > 0
      ? [...registration.allowedScopes]
      : ['specification:approve'];

  return {
    ...registration,
    keyId: registration.keyId.trim(),
    algorithm: 'Ed25519',
    publicKeyHex: pubHex,
    publicKeyFingerprint: registration.publicKeyFingerprint ?? expectedFp,
    principalId: resolvedPrincipal,
    ownerPrincipal: resolvedPrincipal,
    tenantId: resolvedTenant,
    allowedScopes: resolvedScopes,
    activatedAt,
    expiresAt,
    revoked: registration.revoked ?? false
  };
}

/**
 * Validates and constructs a `ControlledPublicKeyRegistration` entry (`FINDING-02`, `FINDING-08`, `FINDING-10`).
 */
export function createControlledPublicKeyRegistration(
  registration: ControlledPublicKeyRegistration
): ControlledPublicKeyRegistration {
  return validateControlledPublicKeyRegistration(registration);
}

function keyWindowsOverlap(
  a: { activatedAt?: string; expiresAt?: string; revoked?: boolean },
  b: { activatedAt?: string; expiresAt?: string; revoked?: boolean }
): boolean {
  if (a.revoked || b.revoked) {
    return false;
  }
  const aStart = a.activatedAt ? Date.parse(a.activatedAt) : 0;
  const aEnd = a.expiresAt ? Date.parse(a.expiresAt) : Number.MAX_SAFE_INTEGER;
  const bStart = b.activatedAt ? Date.parse(b.activatedAt) : 0;
  const bEnd = b.expiresAt ? Date.parse(b.expiresAt) : Number.MAX_SAFE_INTEGER;
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Registers a validated Ed25519 public key into a `ControlledPublicKeyRegistry`.
 * Rejects duplicate `keyId` and duplicate `publicKeyHex` across concurrently active keys (`FINDING-09`).
 */
export function registerPublicKeyInRegistry(
  registry: ControlledPublicKeyRegistry,
  registration: ControlledPublicKeyRegistration,
  options?: { allowOverwrite?: boolean; allowDuplicatePublicKeyMaterial?: boolean }
): ControlledPublicKeyRegistry {
  const normalized = validateControlledPublicKeyRegistration(registration);

  if (!options?.allowOverwrite && registry.entries[normalized.keyId]) {
    throw new ProductionSnapshotValidationError(
      `Duplicate keyId "${normalized.keyId}" in ControlledPublicKeyRegistry is prohibited.`,
      ['duplicate-key-id']
    );
  }

  if (!options?.allowDuplicatePublicKeyMaterial) {
    for (const [existingKeyId, existingEntry] of Object.entries(registry.entries)) {
      if (
        existingKeyId !== normalized.keyId &&
        existingEntry.publicKeyHex === normalized.publicKeyHex &&
        keyWindowsOverlap(existingEntry, normalized)
      ) {
        throw new ProductionSnapshotValidationError(
          `Duplicate publicKeyHex material across distinct active keyIds ("${existingKeyId}" and "${normalized.keyId}") is prohibited.`,
          ['duplicate-public-key-material']
        );
      }
    }
  }

  return {
    ...registry,
    entries: {
      ...registry.entries,
      [normalized.keyId]: normalized
    }
  };
}

/**
 * Marks a registered public key as revoked in the `ControlledPublicKeyRegistry`.
 */
export function revokePublicKeyInRegistry(
  registry: ControlledPublicKeyRegistry,
  keyId: string,
  reason: string,
  revokedAt: string = new Date().toISOString(),
  options?: { compromised?: boolean }
): ControlledPublicKeyRegistry {
  const existing = registry.entries[keyId];
  if (!existing) {
    throw new ProductionSnapshotValidationError(
      `Cannot revoke unknown keyId "${keyId}" in ControlledPublicKeyRegistry.`,
      ['unknown-key-id']
    );
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'Public-key revocation reason cannot be empty.',
      ['empty-key-revocation-reason']
    );
  }

  const isCompromise =
    options?.compromised === true || reason.toLowerCase().includes('compromise');

  const updated: ControlledPublicKeyRegistration = {
    ...existing,
    revoked: true,
    compromised: isCompromise,
    revokedAt,
    revocationReason: reason.trim(),
    revocationReasonCode: isCompromise ? 'compromise' : 'unspecified',
    trustStatus: 'revoked_key'
  };

  return {
    ...registry,
    entries: {
      ...registry.entries,
      [keyId]: updated
    }
  };
}

// ============================================================================
// CANONICAL SPECIFICATION PAYLOAD & FINGERPRINTING
// ============================================================================

function assertValidPositiveNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ProductionSnapshotValidationError(
      `Specification validation failed: "${fieldName}" must be a finite number > 0 (received ${String(value)}).`,
      [fieldName]
    );
  }
  return value;
}

function assertValidNonNegativeNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ProductionSnapshotValidationError(
      `Specification validation failed: "${fieldName}" must be a finite number >= 0 (received ${String(value)}).`,
      [fieldName]
    );
  }
  return value;
}

function assertValidFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProductionSnapshotValidationError(
      `Specification validation failed: "${fieldName}" must be a finite number (received ${String(value)}).`,
      [fieldName]
    );
  }
  return value;
}

const KNOWN_SPECIFICATION_TOP_LEVEL_KEYS = new Set<string>([
  'schemaVersion',
  'projectId',
  'garmentId',
  'id',
  'specificationRevisionId',
  'version',
  'specificationVersion',
  'specificationFingerprint',
  'parentRevisionId',
  'previousRevisionId',
  'supersededByRevisionId',
  'name',
  'garmentCategory',
  'silhouette',
  'prompt',
  'fabric',
  'fabricRevision',
  'fabricProvenance',
  'color',
  'easeProfile',
  'sleeveEaseStrategy',
  'dartStyle',
  'waistband',
  'lengthCm',
  'targetFinishedDimensions',
  'explicitEaseCm',
  'allowances',
  'constructionFeatures',
  'designNotes',
  'fieldProvenance',
  'createdAt',
  'updatedAt',
  'isApproved',
  'approvalState',
  'approvalAuthorityTier',
  'approvedBy',
  'approvedAt',
  'approvedContentFingerprint',
  'approvalProvenance',
  'engineProvenance',
  'aiEstimates',
  'approvalRecord',
  'revocationRecord',
  'approvalHistory',
  'verifiedIdentity',
  'cryptographicSignature',
  'isProductionReady'
]);

function ensureAuthoritativeSpec(
  specOrDesign: AuthoritativeGarmentSpecification | DesignSpecification
): AuthoritativeGarmentSpecification {
  if (!specOrDesign || typeof specOrDesign !== 'object') {
    throw new ProductionSnapshotValidationError(
      'Cannot process null or non-object garment specification.',
      ['specification']
    );
  }
  const candidate = specOrDesign as Partial<AuthoritativeGarmentSpecification> & Partial<DesignSpecification>;
  if (
    typeof candidate.garmentId === 'string' &&
    typeof candidate.specificationRevisionId === 'string' &&
    typeof candidate.version === 'number' &&
    candidate.targetFinishedDimensions !== undefined
  ) {
    return specOrDesign as AuthoritativeGarmentSpecification;
  }
  return convertFromDesignSpecification(specOrDesign as DesignSpecification);
}

/**
 * Extracts and validates the complete canonical engineering payload of an
 * `AuthoritativeGarmentSpecification` for deterministic serialization.
 */
export function canonicalizeSpecificationPayload(
  specInput: AuthoritativeGarmentSpecification | DesignSpecification
): string {
  if (!specInput || typeof specInput !== 'object') {
    throw new ProductionSnapshotValidationError(
      'Cannot canonicalize null or non-object garment specification.',
      ['specification']
    );
  }

  const rawInput = specInput as Partial<AuthoritativeGarmentSpecification> & Partial<DesignSpecification>;
  if ('name' in rawInput && (typeof rawInput.name !== 'string' || rawInput.name.trim().length === 0)) {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "name" is required and cannot be empty.',
      ['name']
    );
  }
  if ('garmentCategory' in rawInput && rawInput.garmentCategory !== 'skirt' && rawInput.garmentCategory !== 'bodice') {
    throw new ProductionSnapshotValidationError(
      `Specification canonicalization failed: invalid "garmentCategory" (${String(rawInput.garmentCategory)}).`,
      ['garmentCategory']
    );
  }
  if (
    'fabric' in rawInput &&
    (!rawInput.fabric || typeof rawInput.fabric !== 'object' || typeof rawInput.fabric.id !== 'string' || rawInput.fabric.id.trim().length === 0)
  ) {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "fabric" object with non-empty id is required.',
      ['fabric']
    );
  }

  const spec = ensureAuthoritativeSpec(specInput);

  if (typeof spec.projectId !== 'string' || spec.projectId.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "projectId" is required and cannot be empty.',
      ['projectId']
    );
  }

  if (typeof spec.garmentId !== 'string' || spec.garmentId.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "garmentId" is required and cannot be empty.',
      ['garmentId']
    );
  }

  if (typeof spec.specificationRevisionId !== 'string' || spec.specificationRevisionId.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "specificationRevisionId" is required and cannot be empty.',
      ['specificationRevisionId']
    );
  }

  if (typeof spec.version !== 'number' || !Number.isInteger(spec.version) || spec.version < 1) {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "version" must be a positive integer >= 1.',
      ['version']
    );
  }

  if (typeof spec.name !== 'string' || spec.name.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "name" is required and cannot be empty.',
      ['name']
    );
  }

  if (spec.garmentCategory !== 'skirt' && spec.garmentCategory !== 'bodice') {
    throw new ProductionSnapshotValidationError(
      `Specification canonicalization failed: invalid "garmentCategory" (${String(spec.garmentCategory)}).`,
      ['garmentCategory']
    );
  }

  if (!spec.silhouette || typeof spec.silhouette !== 'string') {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "silhouette" is required.',
      ['silhouette']
    );
  }

  if (!spec.easeProfile || typeof spec.easeProfile !== 'string') {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "easeProfile" is required.',
      ['easeProfile']
    );
  }

  const effectiveLength = spec.lengthCm ?? spec.targetFinishedDimensions?.lengthCm;
  assertValidPositiveNumber(effectiveLength, 'lengthCm');

  if (!spec.fabric || typeof spec.fabric !== 'object' || typeof spec.fabric.id !== 'string' || spec.fabric.id.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "fabric" object with non-empty id is required.',
      ['fabric']
    );
  }

  const enhancedFabric = spec.fabric as Partial<EnhancedFabricProperty> & {
    gsm?: number;
    drape?: unknown;
    blend?: unknown;
    weaveStructure?: unknown;
    shrinkage?: unknown;
    patternAdjustmentPolicy?: unknown;
  };
  assertValidPositiveNumber(enhancedFabric.gsm, 'fabric.gsm');
  if (enhancedFabric.thicknessMm !== undefined) {
    assertValidPositiveNumber(enhancedFabric.thicknessMm, 'fabric.thicknessMm');
  }

  if (!spec.targetFinishedDimensions || typeof spec.targetFinishedDimensions !== 'object') {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "targetFinishedDimensions" is required.',
      ['targetFinishedDimensions']
    );
  }

  assertValidPositiveNumber(spec.targetFinishedDimensions.lengthCm, 'targetFinishedDimensions.lengthCm');
  if (spec.targetFinishedDimensions.waistCm !== undefined && spec.targetFinishedDimensions.waistCm !== null) {
    assertValidPositiveNumber(spec.targetFinishedDimensions.waistCm, 'targetFinishedDimensions.waistCm');
  }
  if (spec.targetFinishedDimensions.hipCm !== undefined && spec.targetFinishedDimensions.hipCm !== null) {
    assertValidPositiveNumber(spec.targetFinishedDimensions.hipCm, 'targetFinishedDimensions.hipCm');
  }
  if (spec.targetFinishedDimensions.bustCm !== undefined && spec.targetFinishedDimensions.bustCm !== null) {
    assertValidPositiveNumber(spec.targetFinishedDimensions.bustCm, 'targetFinishedDimensions.bustCm');
  }
  if (spec.targetFinishedDimensions.hemSweepCm !== undefined && spec.targetFinishedDimensions.hemSweepCm !== null) {
    assertValidPositiveNumber(spec.targetFinishedDimensions.hemSweepCm, 'targetFinishedDimensions.hemSweepCm');
  }
  if (spec.targetFinishedDimensions.bicepsCm !== undefined && spec.targetFinishedDimensions.bicepsCm !== null) {
    assertValidPositiveNumber(spec.targetFinishedDimensions.bicepsCm, 'targetFinishedDimensions.bicepsCm');
  }
  if (spec.targetFinishedDimensions.bicepCm !== undefined && spec.targetFinishedDimensions.bicepCm !== null) {
    assertValidPositiveNumber(spec.targetFinishedDimensions.bicepCm, 'targetFinishedDimensions.bicepCm');
  }
  if (spec.targetFinishedDimensions.wristCm !== undefined && spec.targetFinishedDimensions.wristCm !== null) {
    assertValidPositiveNumber(spec.targetFinishedDimensions.wristCm, 'targetFinishedDimensions.wristCm');
  }
  if (spec.targetFinishedDimensions.sleeveLengthCm !== undefined && spec.targetFinishedDimensions.sleeveLengthCm !== null) {
    assertValidPositiveNumber(spec.targetFinishedDimensions.sleeveLengthCm, 'targetFinishedDimensions.sleeveLengthCm');
  }

  if (spec.explicitEaseCm !== undefined && spec.explicitEaseCm !== null) {
    for (const [easeKey, easeVal] of Object.entries(spec.explicitEaseCm)) {
      if (easeVal !== undefined && easeVal !== null) {
        assertValidFiniteNumber(easeVal, `explicitEaseCm.${easeKey}`);
      }
    }
  }

  if (!spec.allowances || typeof spec.allowances !== 'object') {
    throw new ProductionSnapshotValidationError(
      'Specification canonicalization failed: "allowances" is required.',
      ['allowances']
    );
  }
  assertValidNonNegativeNumber(spec.allowances.seamAllowanceCm, 'allowances.seamAllowanceCm');
  assertValidNonNegativeNumber(spec.allowances.hemAllowanceCm, 'allowances.hemAllowanceCm');
  if (spec.allowances.waistAllowanceCm !== undefined) {
    assertValidNonNegativeNumber(spec.allowances.waistAllowanceCm, 'allowances.waistAllowanceCm');
  }
  if (spec.allowances.neckAllowanceCm !== undefined) {
    assertValidNonNegativeNumber(spec.allowances.neckAllowanceCm, 'allowances.neckAllowanceCm');
  }
  if (spec.allowances.armholeAllowanceCm !== undefined) {
    assertValidNonNegativeNumber(spec.allowances.armholeAllowanceCm, 'allowances.armholeAllowanceCm');
  }
  if (spec.allowances.shoulderAllowanceCm !== undefined) {
    assertValidNonNegativeNumber(spec.allowances.shoulderAllowanceCm, 'allowances.shoulderAllowanceCm');
  }

  if (spec.color !== undefined && spec.color !== null) {
    if (
      typeof spec.color !== 'object' ||
      typeof spec.color.name !== 'string' ||
      spec.color.name.trim().length === 0 ||
      typeof spec.color.hex !== 'string' ||
      !/^#[0-9a-fA-F]{6}$/.test(spec.color.hex)
    ) {
      throw new ProductionSnapshotValidationError(
        'Specification canonicalization failed: "color" must include a non-empty name and a valid 6-digit hex code (#RRGGBB).',
        ['color']
      );
    }
  }

  const additionalFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(specInput as unknown as Record<string, unknown>)) {
    if (!KNOWN_SPECIFICATION_TOP_LEVEL_KEYS.has(k)) {
      additionalFields[k] = v;
    }
  }

  const hasPromptKey = 'prompt' in (specInput as object);
  const promptVal = hasPromptKey ? (specInput as { prompt?: unknown }).prompt : undefined;

  const hasColorKey = 'color' in (specInput as object);
  const colorVal = hasColorKey ? (specInput as { color?: unknown }).color : spec.color;

  const canonicalObject = {
    schemaVersion: spec.schemaVersion || SPECIFICATION_CANONICAL_SCHEMA_VERSION,
    projectId: spec.projectId,
    garmentId: spec.garmentId,
    specificationRevisionId: spec.specificationRevisionId,
    version: spec.version,
    previousRevisionId: spec.previousRevisionId ?? spec.parentRevisionId,
    name: spec.name,
    garmentCategory: spec.garmentCategory,
    silhouette: spec.silhouette,
    prompt: hasPromptKey ? promptVal : undefined,
    fabric: {
      id: spec.fabric.id,
      name: spec.fabric.name,
      weight: spec.fabric.weight,
      drape: enhancedFabric.drape,
      stretch: spec.fabric.stretch,
      gsm: enhancedFabric.gsm,
      blend: enhancedFabric.blend,
      composition: enhancedFabric.composition,
      weaveStructure: enhancedFabric.weaveStructure,
      thicknessMm: enhancedFabric.thicknessMm,
      directional: enhancedFabric.directional,
      shrinkage: enhancedFabric.shrinkage,
      patternAdjustmentPolicy: enhancedFabric.patternAdjustmentPolicy,
      provenance: enhancedFabric.provenance ?? spec.fabricProvenance,
      revision: enhancedFabric.revision ?? spec.fabricRevision
    },
    fabricRevision: spec.fabricRevision,
    fabricProvenance: spec.fabricProvenance,
    color: colorVal,
    easeProfile: spec.easeProfile,
    sleeveEaseStrategy: spec.sleeveEaseStrategy,
    dartStyle: spec.dartStyle,
    waistband: spec.waistband,
    lengthCm: effectiveLength,
    targetFinishedDimensions: {
      waistCm: spec.targetFinishedDimensions.waistCm,
      hipCm: spec.targetFinishedDimensions.hipCm,
      bustCm: spec.targetFinishedDimensions.bustCm,
      lengthCm: spec.targetFinishedDimensions.lengthCm,
      hemSweepCm: spec.targetFinishedDimensions.hemSweepCm,
      bicepsCm: spec.targetFinishedDimensions.bicepsCm ?? spec.targetFinishedDimensions.bicepCm,
      wristCm: spec.targetFinishedDimensions.wristCm,
      sleeveLengthCm: spec.targetFinishedDimensions.sleeveLengthCm
    },
    explicitEaseCm: {
      waist: spec.explicitEaseCm?.waist,
      hip: spec.explicitEaseCm?.hip,
      bust: spec.explicitEaseCm?.bust,
      biceps: spec.explicitEaseCm?.biceps,
      wrist: spec.explicitEaseCm?.wrist,
      neck: spec.explicitEaseCm?.neck,
      armholeDepth: spec.explicitEaseCm?.armholeDepth,
      capEase: spec.explicitEaseCm?.capEase
    },
    allowances: {
      seamAllowanceCm: spec.allowances.seamAllowanceCm,
      hemAllowanceCm: spec.allowances.hemAllowanceCm,
      waistAllowanceCm: spec.allowances.waistAllowanceCm,
      neckAllowanceCm: spec.allowances.neckAllowanceCm,
      armholeAllowanceCm: spec.allowances.armholeAllowanceCm,
      shoulderAllowanceCm: spec.allowances.shoulderAllowanceCm
    },
    constructionFeatures: spec.constructionFeatures.map(cf => ({
      id: cf.id,
      category: cf.category,
      name: cf.name,
      description: cf.description,
      patternImpact: cf.patternImpact
    })),
    designNotes: [...spec.designNotes],
    fieldProvenance: { ...(spec.fieldProvenance ?? {}) },
    additionalEngineeringFields: additionalFields
  };

  return canonicalizeJson(canonicalObject, { preserveUndefinedAsSentinel: true });
}

/**
 * Computes the 64-character hex SHA-256 fingerprint over the canonical specification payload.
 */
export function computeSpecificationFingerprint(
  spec: AuthoritativeGarmentSpecification | DesignSpecification
): string {
  const canonicalPayload = canonicalizeSpecificationPayload(spec);
  return sha256Hex(canonicalPayload);
}

// ============================================================================
// ATOMIC JTI REPLAY PROTECTION IMPLEMENTATION (FINDING-06)
// ============================================================================

export interface InMemoryJtiReplayStoreOptions {
  /** Additional retention window beyond `exp` (seconds, default 300) */
  retentionGraceSeconds?: number;
  /** Maximum tracked entries before oldest expired are purged (default 10_000) */
  maxEntries?: number;
}

/**
 * Creates a process-local atomic JTI replay store (`FINDING-06`).
 *
 * Disclosure: `isDurableDistributedStore = false` — this store enforces atomic
 * single-use JTI semantics within the active JavaScript runtime process, and does NOT
 * persist across process restarts or coordinate across multi-instance deployments.
 */
export function createInMemoryJtiReplayStore(
  options: InMemoryJtiReplayStoreOptions = {}
): JtiReplayStore {
  const retentionGraceSeconds = options.retentionGraceSeconds ?? 300;
  const maxEntries = options.maxEntries ?? 10000;
  const consumedMap = new Map<string, JtiReplayRecord>();
  let lockActive = false;

  function makeCompositeKey(jti: string, issuer?: string): string {
    return `${(issuer ?? '*').trim()}::${jti.trim()}`;
  }

  function purgeExpired(nowEpochSeconds: number): number {
    let purged = 0;
    for (const [key, rec] of consumedMap.entries()) {
      if (rec.expiresAtEpochSeconds + retentionGraceSeconds < nowEpochSeconds) {
        consumedMap.delete(key);
        purged++;
      }
    }
    return purged;
  }

  return {
    isDurableDistributedStore: false,
    storeType: 'in-memory-local-process',

    consumeJti(record: JtiReplayRecord, nowEpochSeconds: number) {
      if (lockActive) {
        return {
          consumed: false,
          reason: 'Concurrent JTI replay store access contention detected (fail-closed).'
        };
      }
      lockActive = true;
      try {
        if (!record || typeof record.jti !== 'string' || record.jti.trim().length === 0) {
          return {
            consumed: false,
            reason: 'Invalid or empty JWT jti claim cannot be recorded in replay store.'
          };
        }
        if (typeof record.issuer !== 'string' || record.issuer.trim().length === 0) {
          return {
            consumed: false,
            reason: 'Invalid or empty JWT issuer claim cannot be recorded in replay store.'
          };
        }
        if (
          typeof record.expiresAtEpochSeconds !== 'number' ||
          !Number.isFinite(record.expiresAtEpochSeconds)
        ) {
          return {
            consumed: false,
            reason: 'Invalid JWT expiration timestamp for replay store retention.'
          };
        }

        purgeExpired(nowEpochSeconds);

        const compositeKey = makeCompositeKey(record.jti, record.issuer);
        const rawJtiKey = makeCompositeKey(record.jti, '*');

        const existing = consumedMap.get(compositeKey) ?? consumedMap.get(rawJtiKey);
        if (existing) {
          return {
            consumed: false,
            reason: `Replay detected: JWT jti "${record.jti.trim()}" from issuer "${record.issuer.trim()}" has already been consumed at ${existing.consumedAtIso}.`,
            existingRecord: existing
          };
        }

        if (consumedMap.size >= maxEntries) {
          return {
            consumed: false,
            reason: 'JTI replay store capacity exhausted (fail-closed).'
          };
        }

        const frozenRecord: JtiReplayRecord = Object.freeze({
          ...record,
          jti: record.jti.trim(),
          issuer: record.issuer.trim()
        });
        consumedMap.set(compositeKey, frozenRecord);
        consumedMap.set(rawJtiKey, frozenRecord);

        return { consumed: true };
      } finally {
        lockActive = false;
      }
    },

    getConsumedRecord(jti: string, issuer?: string): JtiReplayRecord | undefined {
      if (typeof jti !== 'string' || jti.trim().length === 0) {
        return undefined;
      }
      if (issuer) {
        const byIssuer = consumedMap.get(makeCompositeKey(jti, issuer));
        if (byIssuer) return byIssuer;
      }
      return consumedMap.get(makeCompositeKey(jti, '*'));
    },

    purgeExpired
  };
}

// ============================================================================
// OIDC / JWT ASYMMETRIC EdDSA CREDENTIAL ISSUANCE & VERIFICATION (TIER 3)
// ============================================================================

export interface IssueIdentityCredentialParams {
  subjectId?: string;
  subject?: string;
  displayName?: string;
  expectedApprover?: string;
  issuer: string;
  audience: string;
  issuedAt: string;
  notBefore?: string;
  expiresAt: string;
  claims?: readonly string[];
  authorizationClaims?: readonly string[];
  /** Key ID (`kid`) in the OIDC JWK Set */
  keyId?: string;
  /** Organization / project / tenant identifier (`tid`) */
  tenantId?: string;
  /** Unique JWT ID (`jti` / `credentialId`) */
  jti?: string;
  credentialId?: string;
  /** Bound specification / garment ID (`spec_id`, `FINDING-06`) */
  specificationId?: string;
  /** Bound target specification revision ID (`target_revision_id`, `FINDING-06`) */
  targetRevisionId?: string;
  /** Bound target canonical specification fingerprint (`target_specification_fingerprint`, `FINDING-06`) */
  targetSpecificationFingerprint?: string;
  /** Optional token use override (`'specification_approval'` or `'pattern_approval'`) */
  use?: 'specification_approval' | 'pattern_approval' | string;
  /** Bound pattern revision ID (`pattern_revision_id`, `AUDIT-05.1-05`) */
  patternRevisionId?: string;
  /** Bound immutable base pattern fingerprint (`base_pattern_fingerprint`, `AUDIT-05.1-05`) */
  basePatternFingerprint?: string;
  /** Bound pattern geometry fingerprint (`geometry_fingerprint`, `Safeguard 1`) */
  geometryFingerprint?: string;
  /** Bound upstream specification fingerprint (`source_specification_fingerprint`, `Safeguard 1`) */
  sourceSpecificationFingerprint?: string;
  /** Bound upstream measurement set fingerprint (`source_measurement_set_fingerprint`, `Safeguard 1`) */
  sourceMeasurementSetFingerprint?: string;
  /** Optional Authentication Context Class Reference (`acr`, `FINDING-07`) */
  acr?: string;
  /** Optional Authentication Methods References (`amr`, `FINDING-07`) */
  amr?: readonly string[];
}

let monotonicJtiCounter = 0;

/**
 * Helper to derive an RFC 8037 `OKP` `Ed25519` public JWK from a signing seed or private key.
 * Returns ONLY the public JWK (`kty`, `crv`, `alg`, `kid`, `x`), never the private parameter `d`.
 */
export function createOidcPublicJwk(
  firstArg:
    | string
    | {
        keyId: string;
        publicKeyHex?: string;
        signingSecretOrPrivateKeyHex?: string;
        privateKeySeed?: string;
        privateKeyHex?: string;
        issuer?: string;
        tenantId?: string;
        activatedAt?: string;
        expiresAt?: string;
        revoked?: boolean;
        compromised?: boolean;
        revokedAt?: string;
        revocationReason?: string;
      },
  secondArg?:
    | string
    | {
        publicKeyHex?: string;
        privateKeySeed?: string;
        privateKeyHex?: string;
        signingSecretOrPrivateKeyHex?: string;
      },
  thirdArg?: {
    issuer?: string;
    tenantId?: string;
    activatedAt?: string;
    expiresAt?: string;
    revoked?: boolean;
    compromised?: boolean;
    revokedAt?: string;
    revocationReason?: string;
  }
): OidcJwkPublicKey {
  let keyId: string;
  let seed = '';
  let directPubHex = '';
  let meta: {
    issuer?: string;
    tenantId?: string;
    activatedAt?: string;
    expiresAt?: string;
    revoked?: boolean;
    compromised?: boolean;
    revokedAt?: string;
    revocationReason?: string;
  } = {};

  if (typeof firstArg === 'string') {
    keyId = firstArg.trim();
    if (typeof secondArg === 'string') {
      seed = secondArg;
    } else if (secondArg && typeof secondArg === 'object') {
      directPubHex = secondArg.publicKeyHex?.trim().toLowerCase() ?? '';
      seed =
        secondArg.privateKeySeed ??
        secondArg.privateKeyHex ??
        secondArg.signingSecretOrPrivateKeyHex ??
        '';
    }
    meta = thirdArg ?? {};
  } else {
    keyId = firstArg.keyId.trim();
    directPubHex = firstArg.publicKeyHex?.trim().toLowerCase() ?? '';
    seed =
      firstArg.signingSecretOrPrivateKeyHex ??
      firstArg.privateKeySeed ??
      firstArg.privateKeyHex ??
      '';
    meta = firstArg;
  }

  let pubHex: string;
  let pubB64Url: string;
  if (directPubHex && !seed) {
    pubHex = directPubHex;
    pubB64Url = base64UrlEncodeBytes(hexToBytes(pubHex));
  } else {
    const kp = resolveSigningKeyPairInternal(seed);
    pubHex = kp.publicKeyHex;
    pubB64Url = kp.publicKeyBase64Url;
  }

  return {
    kty: 'OKP',
    crv: 'Ed25519',
    alg: 'EdDSA',
    use: 'sig',
    kid: keyId,
    x: pubB64Url,
    publicKeyHex: pubHex,
    issuer: meta.issuer,
    tenantId: meta.tenantId,
    activatedAt: meta.activatedAt,
    expiresAt: meta.expiresAt,
    revoked: meta.revoked ?? false,
    compromised: meta.compromised ?? false,
    revokedAt: meta.revokedAt,
    revocationReason: meta.revocationReason
  };
}

/**
 * Issues a standard 3-part compact OIDC/JWT (`header.payload.signature`) signed with
 * asymmetric Ed25519 (`EdDSA` per RFC 8037 / RFC 7515), including target specification/revision/fingerprint
 * binding claims (`FINDING-06`) and unique `jti`.
 */
export function issueVerifiableIdentityCredential(
  params: IssueIdentityCredentialParams,
  signingPrivateKeyOrSeed: string
): VerifiableIdentityCredential {
  const subjectId = (params.subjectId ?? params.subject ?? '').trim();
  const displayName = (params.displayName ?? params.expectedApprover ?? '').trim();
  const claimsList = params.claims ?? params.authorizationClaims ?? [];

  if (!subjectId) {
    throw new ProductionSnapshotValidationError('Identity credential subjectId cannot be empty.');
  }
  if (!displayName) {
    throw new ProductionSnapshotValidationError('Identity credential displayName cannot be empty.');
  }
  if (subjectId === displayName) {
    throw new ProductionSnapshotValidationError(
      'Identity credential subjectId must be a unique principal identifier distinct from displayName.',
      ['subjectId']
    );
  }
  if (typeof signingPrivateKeyOrSeed !== 'string' || signingPrivateKeyOrSeed.trim().length === 0) {
    throw new ProductionSnapshotValidationError('Identity provider Ed25519 signing seed/private key cannot be empty.');
  }

  const issuedMs = Date.parse(params.issuedAt);
  const expiresMs = Date.parse(params.expiresAt);
  if (Number.isNaN(issuedMs) || Number.isNaN(expiresMs)) {
    throw new ProductionSnapshotValidationError('Identity credential issuedAt and expiresAt must be valid ISO-8601 timestamps.');
  }

  const iat = Math.floor(issuedMs / 1000);
  const exp = Math.floor(expiresMs / 1000);
  const nbf = params.notBefore ? Math.floor(Date.parse(params.notBefore) / 1000) : iat;
  const kid = params.keyId?.trim() || 'idp-ed25519-default-kid';
  monotonicJtiCounter += 1;
  const jti =
    params.jti?.trim() ||
    params.credentialId?.trim() ||
    `jwt-${sha256Hex(`${params.issuer}:${subjectId}:${params.issuedAt}:${kid}:${monotonicJtiCounter}`).slice(0, 24)}`;

  const header: OidcJwtHeader = {
    alg: 'EdDSA',
    typ: 'at+jwt',
    kid
  };

  const isPatternScopeOnly =
    claimsList.includes('pattern:approve') && !claimsList.includes('specification:approve');
  const resolvedUse =
    params.use?.trim() ||
    (isPatternScopeOnly ? 'pattern_approval' : 'specification_approval');

  const payload: OidcJwtPayload = {
    iss: params.issuer.trim(),
    sub: subjectId,
    aud: params.audience.trim(),
    iat,
    nbf,
    exp,
    jti,
    name: displayName,
    tid: params.tenantId?.trim(),
    use: resolvedUse,
    scope: claimsList.join(' '),
    roles: [...claimsList],
    ...(params.specificationId ? { spec_id: params.specificationId.trim() } : {}),
    ...(params.targetRevisionId ? { target_revision_id: params.targetRevisionId.trim() } : {}),
    ...(params.targetSpecificationFingerprint
      ? { target_specification_fingerprint: params.targetSpecificationFingerprint.trim().toLowerCase() }
      : {}),
    ...(params.patternRevisionId ? { pattern_revision_id: params.patternRevisionId.trim() } : {}),
    ...(params.basePatternFingerprint
      ? { base_pattern_fingerprint: params.basePatternFingerprint.trim().toLowerCase() }
      : {}),
    ...(params.geometryFingerprint
      ? { geometry_fingerprint: params.geometryFingerprint.trim().toLowerCase() }
      : {}),
    ...(params.sourceSpecificationFingerprint
      ? { source_specification_fingerprint: params.sourceSpecificationFingerprint.trim().toLowerCase() }
      : {}),
    ...(params.sourceMeasurementSetFingerprint
      ? { source_measurement_set_fingerprint: params.sourceMeasurementSetFingerprint.trim().toLowerCase() }
      : {}),
    ...(params.acr ? { acr: params.acr.trim() } : {}),
    ...(params.amr ? { amr: [...params.amr] } : {})
  };

  const encodedHeader = base64UrlEncodeUtf8(canonicalizeJson(header));
  const encodedPayload = base64UrlEncodeUtf8(canonicalizeJson(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const kp = resolveSigningKeyPairInternal(signingPrivateKeyOrSeed);
  const signatureHex = signEd25519Bytes(utf8ToBytes(signingInput), kp.privateKeyHex, {
    inputFormat: 'raw-seed-hex'
  });
  const signatureBytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    signatureBytes[i] = parseInt(signatureHex.slice(i * 2, i * 2 + 2), 16);
  }
  const encodedSignature = base64UrlEncodeBytes(signatureBytes);

  const compactJwt = `${signingInput}.${encodedSignature}`;

  return {
    credentialToken: compactJwt,
    token: compactJwt,
    credentialId: jti,
    subjectId,
    subject: subjectId,
    displayName,
    expectedApprover: displayName,
    issuer: params.issuer.trim(),
    audience: params.audience.trim(),
    issuedAt: params.issuedAt,
    notBefore: params.notBefore,
    expiresAt: params.expiresAt,
    claims: [...claimsList],
    authorizationClaims: [...claimsList],
    keyId: kid,
    tenantId: params.tenantId?.trim(),
    jti,
    intendedUse: resolvedUse,
    specificationId: params.specificationId?.trim(),
    targetRevisionId: params.targetRevisionId?.trim(),
    targetSpecificationFingerprint: params.targetSpecificationFingerprint?.trim().toLowerCase(),
    patternRevisionId: params.patternRevisionId?.trim(),
    basePatternFingerprint: params.basePatternFingerprint?.trim().toLowerCase(),
    geometryFingerprint: params.geometryFingerprint?.trim().toLowerCase(),
    sourceSpecificationFingerprint: params.sourceSpecificationFingerprint?.trim().toLowerCase(),
    sourceMeasurementSetFingerprint: params.sourceMeasurementSetFingerprint?.trim().toLowerCase(),
    acr: params.acr?.trim(),
    amr: params.amr ? [...params.amr] : undefined
  };
}

export interface TrustedIdentityVerifierConfig {
  trustedIssuer?: string;
  trustedIssuers?: readonly string[];
  expectedAudience: string;
  /** Controlled JWKS registry of trusted public Ed25519 keys (`OKP` / `Ed25519`, mandatory) */
  publicJwks: readonly OidcJwkPublicKey[];
  /** Optional expected organization/project/tenant identifier (`tid`) */
  expectedTenantId?: string;
  /** Optional reference time for deterministic testing; defaults to current system clock */
  referenceTimeIso?: string;
  /** Optional clock skew tolerance in seconds (default: 60s) */
  clockSkewToleranceSeconds?: number;
  /** Optional atomic JTI replay store (`FINDING-06`); defaults to an internal process-local store */
  replayStore?: JtiReplayStore;
  /** When true, rejects in-memory process-local replay stores and requires an external durable store (`FINDING-06`) */
  requireDurableReplayStore?: boolean;
  /** Optional required Authentication Context Class Reference (`acr`, `FINDING-07`) */
  requiredAcr?: string | readonly string[];
  /** Optional required Authentication Methods References (`amr`, `FINDING-07`) */
  requiredAmr?: readonly string[];
  /** Optional list of supported critical (`crit`) JWT header extensions (default: none, `FINDING-07`) */
  supportedCriticalHeaders?: readonly string[];
}

/**
 * Validates an `OidcJwkPublicKey` entry at registration/configuration time (`FINDING-08`, `FINDING-09`, `FINDING-10`, `FINDING-11`, `AUDIT-04.6.2.3.5-04`).
 * Returns the validated 64-character lowercase hex Ed25519 public key.
 */
export function validateOidcPublicJwk(jwk: OidcJwkPublicKey): string {
  if (!jwk || typeof jwk !== 'object') {
    throw new ProductionSnapshotValidationError(
      'Invalid JWK in publicJwks: entry must be an object.',
      ['invalid-jwk']
    );
  }

  // Reject any private-key or seed parameter (including "d"), nested secrets, or unknown properties
  assertNoPrivateKeyMaterialInVerifierBoundary(jwk, 'JWK in publicJwks');
  assertStrictAllowedKeys(
    jwk as unknown as Record<string, unknown>,
    ALLOWED_OIDC_JWK_KEYS,
    'JWK in publicJwks'
  );

  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
    throw new ProductionSnapshotValidationError(
      `Unsupported JWK key type/curve (${String(jwk.kty)} / ${String(jwk.crv)}). Expected kty="OKP", crv="Ed25519".`,
      ['unsupported-jwk-curve']
    );
  }

  if (jwk.alg !== 'EdDSA') {
    throw new ProductionSnapshotValidationError(
      `Unsupported JWK alg "${String(jwk.alg)}". Expected alg="EdDSA".`,
      ['unsupported-jwk-alg']
    );
  }

  if (jwk.use !== undefined && jwk.use !== 'sig') {
    throw new ProductionSnapshotValidationError(
      `Unsupported JWK use "${String(jwk.use)}". Expected use="sig".`,
      ['unsupported-jwk-use']
    );
  }

  if (typeof jwk.kid !== 'string' || jwk.kid.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'JWK in publicJwks requires a non-empty kid.',
      ['missing-jwk-kid']
    );
  }

  if (typeof jwk.x !== 'string' || jwk.x.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      `JWK "${jwk.kid}" requires a non-empty Base64URL public key parameter "x".`,
      ['missing-jwk-x']
    );
  }

  let xBytes: Uint8Array;
  try {
    xBytes = base64UrlDecodeToBytes(jwk.x.trim());
  } catch {
    throw new ProductionSnapshotValidationError(
      `JWK "${jwk.kid}" contains invalid Base64URL public key parameter "x".`,
      ['invalid-jwk-x-base64url']
    );
  }

  if (!isValidEd25519PublicKeyBytes(xBytes)) {
    throw new ProductionSnapshotValidationError(
      `JWK "${jwk.kid}" contains an invalid, non-canonical, or small-order torsion Ed25519 public key in "x".`,
      ['torsion-or-invalid-jwk-public-key']
    );
  }

  const derivedHex = bytesToHex(xBytes);
  if (jwk.publicKeyHex !== undefined) {
    const providedHex =
      typeof jwk.publicKeyHex === 'string' ? jwk.publicKeyHex.trim().toLowerCase() : '';
    if (providedHex !== derivedHex) {
      throw new ProductionSnapshotValidationError(
        `JWK "${jwk.kid}" has inconsistent publicKeyHex and Base64URL "x" parameters.`,
        ['inconsistent-jwk-public-key-hex']
      );
    }
  }

  if (jwk.activatedAt !== undefined && jwk.expiresAt !== undefined) {
    const actMs = Date.parse(jwk.activatedAt);
    const expMs = Date.parse(jwk.expiresAt);
    if (Number.isNaN(actMs) || Number.isNaN(expMs) || expMs <= actMs) {
      throw new ProductionSnapshotValidationError(
        `JWK "${jwk.kid}" has an invalid activatedAt/expiresAt validity window.`,
        ['invalid-jwk-validity-window']
      );
    }
  }

  return derivedHex;
}

/**
 * Creates a `TrustedIdentityVerifier` that validates compact OIDC/JWT (`EdDSA` / `Ed25519`)
 * tokens against a controlled JWKS registry of public keys with target-revision binding (`FINDING-06`)
 * and atomic single-use JTI replay protection (`FINDING-06`).
 */
export function createTrustedIdentityVerifier(
  config: TrustedIdentityVerifierConfig
): TrustedIdentityVerifier {
  if (!config || typeof config !== 'object') {
    throw new ProductionSnapshotValidationError(
      'TrustedIdentityVerifier requires a configuration object.',
      ['missing-identity-verifier-config']
    );
  }

  // Strictly forbid private keys, seeds, sharedSecret, providerSecret, circular refs, or unknown properties on the verifier config (FINDING-10, AUDIT-04.6.2.3.5-04)
  assertNoPrivateKeyMaterialInVerifierBoundary(config, 'TrustedIdentityVerifierConfig');
  assertStrictAllowedKeys(
    config as unknown as Record<string, unknown>,
    ALLOWED_IDENTITY_VERIFIER_CONFIG_KEYS,
    'TrustedIdentityVerifierConfig'
  );

  const trustedIssuersList = [
    ...(config.trustedIssuer ? [config.trustedIssuer.trim()] : []),
    ...(Array.isArray(config.trustedIssuers) ? config.trustedIssuers.map(i => i.trim()) : [])
  ].filter(Boolean);

  if (trustedIssuersList.length === 0) {
    throw new ProductionSnapshotValidationError('TrustedIdentityVerifier requires a non-empty trustedIssuer or trustedIssuers.');
  }
  if (!config.expectedAudience || config.expectedAudience.trim().length === 0) {
    throw new ProductionSnapshotValidationError('TrustedIdentityVerifier requires a non-empty expectedAudience.');
  }

  if (!Array.isArray(config.publicJwks) || config.publicJwks.length === 0) {
    throw new ProductionSnapshotValidationError(
      'TrustedIdentityVerifier requires at least one public JWK in publicJwks.'
    );
  }

  const jwkMap = new Map<string, { jwk: OidcJwkPublicKey; publicKeyHex: string }>();

  for (const jwk of config.publicJwks) {
    const validatedPubHex = validateOidcPublicJwk(jwk);
    const normalizedKid = jwk.kid.trim();

    if (jwkMap.has(normalizedKid)) {
      throw new ProductionSnapshotValidationError(
        `Duplicate JWK kid "${normalizedKid}" in publicJwks is prohibited.`,
        ['duplicate-jwk-kid']
      );
    }

    for (const [existingKid, existingItem] of jwkMap.entries()) {
      if (
        existingKid !== normalizedKid &&
        existingItem.publicKeyHex === validatedPubHex &&
        keyWindowsOverlap(existingItem.jwk, jwk)
      ) {
        throw new ProductionSnapshotValidationError(
          `Duplicate Ed25519 public key material across distinct active JWK kids ("${existingKid}" and "${normalizedKid}") is prohibited.`,
          ['duplicate-jwk-public-key-material']
        );
      }
    }

    jwkMap.set(normalizedKid, {
      jwk: {
        ...jwk,
        kid: normalizedKid,
        publicKeyHex: validatedPubHex
      },
      publicKeyHex: validatedPubHex
    });
  }

  const replayStore: JtiReplayStore = config.replayStore ?? createInMemoryJtiReplayStore();
  if (config.requireDurableReplayStore && !replayStore.isDurableDistributedStore) {
    throw new ProductionSnapshotValidationError(
      'TrustedIdentityVerifier configuration error: requireDurableReplayStore is true, but the provided JtiReplayStore is a process-local in-memory store (isDurableDistributedStore === false).',
      ['non-durable-replay-store-rejected']
    );
  }

  const skewSec = config.clockSkewToleranceSeconds ?? 60;
  const supportedCrit = new Set<string>(config.supportedCriticalHeaders ?? []);

  function evaluateCredential(
    credential: VerifiableIdentityCredential,
    options?: IdentityCredentialVerificationOptions
  ): IdentityVerificationResult {
    const fail = (reason: string): IdentityVerificationResult => ({
      verified: false,
      isValid: false,
      reason
    });

    if (!credential || typeof credential !== 'object') {
      return fail('Missing or malformed identity credential object.');
    }

    const rawToken = credential.credentialToken ?? credential.token;
    if (typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      return fail('Missing cryptographic credentialToken.');
    }

    const rawJwt = rawToken.trim();

    if (rawJwt.startsWith('pat-id-v1.')) {
      return fail(
        'Legacy pat-id-v1.* custom shared-secret tokens are rejected. A standard 3-part compact OIDC/JWT signed with asymmetric EdDSA (Ed25519) is required.'
      );
    }

    const parts = rawJwt.split('.');
    if (parts.length !== 3) {
      return fail(
        'Malformed OIDC/JWT token: expected compact 3-part serialization (header.payload.signature).'
      );
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      return fail(
        'Malformed OIDC/JWT token: header, payload, and signature segments must all be non-empty (alg: "none" is forbidden).'
      );
    }

    let headerObj: Record<string, unknown>;
    let payloadObj: Record<string, unknown>;
    let signatureBytes: Uint8Array;

    try {
      headerObj = JSON.parse(base64UrlDecodeToUtf8(encodedHeader)) as Record<string, unknown>;
      payloadObj = JSON.parse(base64UrlDecodeToUtf8(encodedPayload)) as Record<string, unknown>;
      signatureBytes = base64UrlDecodeToBytes(encodedSignature);
    } catch {
      return fail(
        'Malformed OIDC/JWT token: failed to decode Base64URL JSON header, payload, or signature.'
      );
    }

    // 1. Validate JWT Header: reject alg: "none", HS256/384/512, RS256, etc. Only EdDSA is permitted.
    const alg = headerObj.alg;
    if (alg === 'none' || typeof alg !== 'string') {
      return fail('JWT header alg: "none" or missing algorithm is strictly forbidden.');
    }
    if (alg.startsWith('HS')) {
      return fail(
        `Symmetric JWT algorithm "${alg}" is forbidden. Only asymmetric "EdDSA" (Ed25519) is permitted.`
      );
    }
    if (alg !== 'EdDSA') {
      return fail(`Unsupported JWT algorithm "${alg}". Expected "EdDSA" (Ed25519).`);
    }

    // Reject unknown critical header parameters per RFC 7515 §4.1.11 (FINDING-07)
    if ('crit' in headerObj && headerObj.crit !== undefined) {
      if (
        !Array.isArray(headerObj.crit) ||
        headerObj.crit.length === 0 ||
        !headerObj.crit.every(
          ext => typeof ext === 'string' && ext.trim().length > 0 && supportedCrit.has(ext)
        )
      ) {
        return fail(
          'Unsupported or malformed critical JWT header parameter ("crit") rejected per RFC 7515 §4.1.11.'
        );
      }
    }

    const kid = typeof headerObj.kid === 'string' ? headerObj.kid.trim() : '';
    if (!kid) {
      return fail('JWT header is missing required "kid" (Key ID) parameter.');
    }

    // 2. Lookup JWK in controlled JWKS registry
    const matchedEntry = jwkMap.get(kid);
    if (!matchedEntry) {
      return fail(
        `Unknown or untrusted OIDC JWK kid "${kid}": key is not registered in the controlled JWKS registry.`
      );
    }

    const { jwk: matchedJwk, publicKeyHex } = matchedEntry;

    if (
      matchedJwk.revoked === true ||
      matchedJwk.compromised === true ||
      matchedJwk.trustStatus === 'revoked' ||
      matchedJwk.trustStatus === 'revoked_key' ||
      matchedJwk.revocationReason?.toLowerCase().includes('compromise')
    ) {
      return fail(
        `OIDC JWK "${kid}" has been revoked${matchedJwk.revocationReason ? ` (${matchedJwk.revocationReason})` : ''} and cannot verify credentials.`
      );
    }

    if (matchedJwk.issuer && !trustedIssuersList.includes(matchedJwk.issuer.trim())) {
      return fail(
        `OIDC JWK "${kid}" is bound to issuer "${matchedJwk.issuer}", which does not match trustedIssuers.`
      );
    }

    const nowMs = config.referenceTimeIso
      ? Date.parse(config.referenceTimeIso)
      : options?.approvalTimestamp
        ? Date.parse(options.approvalTimestamp)
        : Date.now();
    if (Number.isNaN(nowMs)) {
      return fail('Invalid verifier referenceTimeIso.');
    }

    if (matchedJwk.revokedAt) {
      const revMs = Date.parse(matchedJwk.revokedAt);
      if (Number.isNaN(revMs) || nowMs >= revMs) {
        return fail(
          `OIDC JWK "${kid}" was revoked at "${matchedJwk.revokedAt}" and cannot verify credentials.`
        );
      }
    }

    if (matchedJwk.activatedAt) {
      const actMs = Date.parse(matchedJwk.activatedAt);
      if (!Number.isNaN(actMs) && nowMs + skewSec * 1000 < actMs) {
        return fail(
          `OIDC JWK "${kid}" is not yet active (activatedAt: ${matchedJwk.activatedAt}).`
        );
      }
    }

    if (matchedJwk.expiresAt) {
      const expKeyMs = Date.parse(matchedJwk.expiresAt);
      if (!Number.isNaN(expKeyMs) && nowMs - skewSec * 1000 >= expKeyMs) {
        return fail(
          `OIDC JWK "${kid}" has expired (expiresAt: ${matchedJwk.expiresAt}).`
        );
      }
    }

    // 3. Verify asymmetric Ed25519 signature over raw UTF-8 bytes of `base64url(header).base64url(payload)`
    if (signatureBytes.length !== 64) {
      return fail(
        `Invalid EdDSA JWT signature length (${signatureBytes.length} bytes; expected 64 bytes).`
      );
    }

    const signingInputBytes = utf8ToBytes(`${encodedHeader}.${encodedPayload}`);
    const signatureHex = bytesToHex(signatureBytes);

    if (!verifyEd25519Bytes(signingInputBytes, signatureHex, publicKeyHex)) {
      return fail(
        'OIDC/JWT asymmetric Ed25519 signature verification failed: token is forged, tampered, or signed by an untrusted key.'
      );
    }

    // 4. Validate standard OIDC/JWT claims inside the signed payload
    const iss = typeof payloadObj.iss === 'string' ? payloadObj.iss.trim() : '';
    if (!trustedIssuersList.includes(iss)) {
      return fail(
        `Untrusted OIDC issuer "${iss}" (expected one of ${trustedIssuersList.join(', ')}).`
      );
    }

    const audClaim = payloadObj.aud;
    const expectedAud = config.expectedAudience.trim();
    const audMatches =
      (typeof audClaim === 'string' && audClaim.trim() === expectedAud) ||
      (Array.isArray(audClaim) && audClaim.some(a => typeof a === 'string' && a.trim() === expectedAud));
    if (!audMatches) {
      return fail(
        `Invalid OIDC audience "${JSON.stringify(audClaim)}" (expected "${expectedAud}").`
      );
    }

    const sub = typeof payloadObj.sub === 'string' ? payloadObj.sub.trim() : '';
    const wrapperSub = (credential.subjectId ?? credential.subject ?? '').trim();
    const wrapperName = (credential.displayName ?? credential.expectedApprover ?? '').trim();
    const displayName = typeof payloadObj.name === 'string' ? payloadObj.name.trim() : wrapperName;

    if (!sub) {
      return fail('OIDC/JWT payload is missing required "sub" (subject) claim.');
    }
    if (sub === displayName) {
      return fail(
        'OIDC/JWT "sub" claim must be a unique principal identifier distinct from display name.'
      );
    }

    if (wrapperSub && wrapperSub !== sub) {
      return fail(
        `Credential wrapper subjectId "${wrapperSub}" does not match signed JWT sub claim "${sub}".`
      );
    }
    if (credential.issuer && credential.issuer.trim() !== iss) {
      return fail(
        `Credential wrapper issuer "${credential.issuer}" does not match signed JWT iss claim "${iss}".`
      );
    }

    const iat = typeof payloadObj.iat === 'number' ? payloadObj.iat : NaN;
    const exp = typeof payloadObj.exp === 'number' ? payloadObj.exp : NaN;
    const nbf = typeof payloadObj.nbf === 'number' ? payloadObj.nbf : iat;

    if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= iat) {
      return fail('OIDC/JWT payload contains invalid "iat" or "exp" numeric timestamps.');
    }

    const nowSec = Math.floor(nowMs / 1000);
    if (nowSec + skewSec < iat) {
      return fail('OIDC/JWT token issuedAt (iat) is in the future.');
    }
    if (nowSec + skewSec < nbf) {
      return fail('OIDC/JWT token is not valid before its nbf (not-before) timestamp.');
    }
    if (nowSec - skewSec >= exp) {
      return fail('OIDC/JWT token has expired (exp).');
    }

    // Validate JTI claim presence (mandatory for replay protection, FINDING-06)
    const jti = typeof payloadObj.jti === 'string' ? payloadObj.jti.trim() : '';
    if (!jti) {
      return fail(
        'OIDC/JWT payload is missing required "jti" (unique token ID) claim for replay protection.'
      );
    }
    const wrapperJti = credential.jti ?? credential.credentialId;
    if (wrapperJti !== undefined && wrapperJti.trim() !== jti) {
      return fail(
        `Credential wrapper jti "${wrapperJti}" does not match signed JWT jti claim "${jti}".`
      );
    }

    // 5. Validate domain-separated token purpose (`use`) and approval role/scope (`specification:approve` vs `pattern:approve`, AUDIT-05.1-05)
    const expectedScope = (options?.expectedScope ?? 'specification:approve').trim();
    if (expectedScope !== 'specification:approve' && expectedScope !== 'pattern:approve') {
      return fail(
        `Unsupported approval scope "${expectedScope}". Expected "specification:approve" or "pattern:approve".`
      );
    }
    const expectedTokenUse =
      expectedScope === 'pattern:approve' ? 'pattern_approval' : 'specification_approval';

    const tokenUse = typeof payloadObj.use === 'string' ? payloadObj.use.trim() : '';
    if (tokenUse !== expectedTokenUse) {
      return fail(
        `OIDC/JWT token "use" claim must be "${expectedTokenUse}" for scope "${expectedScope}" (received "${tokenUse}").`
      );
    }

    const roles: string[] = Array.isArray(payloadObj.roles)
      ? payloadObj.roles.filter((r): r is string => typeof r === 'string')
      : [];
    const authClaims: string[] = Array.isArray(payloadObj.authorizationClaims)
      ? payloadObj.authorizationClaims.filter((r): r is string => typeof r === 'string')
      : [];
    const scopes: string[] =
      typeof payloadObj.scope === 'string'
        ? payloadObj.scope.split(/\s+/).filter(Boolean)
        : [];
    const combinedClaims = Array.from(new Set([...roles, ...authClaims, ...scopes]));

    if (!combinedClaims.includes(expectedScope)) {
      return fail(
        `OIDC/JWT token does not grant required "${expectedScope}" role or scope.`
      );
    }

    // 6. Validate tenant/project scope (`tid`) if configured on verifier or expected in options
    const tid =
      typeof payloadObj.tid === 'string'
        ? payloadObj.tid.trim()
        : typeof payloadObj.tenantId === 'string'
          ? payloadObj.tenantId.trim()
          : undefined;
    const expectedTenant =
      options?.expectedTenantId?.trim() ?? config.expectedTenantId?.trim();
    if (expectedTenant) {
      if (!tid || tid !== expectedTenant) {
        return fail(
          `OIDC/JWT tenantId (tid="${String(tid)}") does not match expected project/tenant "${expectedTenant}".`
        );
      }
    }

    // 7. Validate Authentication Context (`acr` / `amr`, FINDING-07)
    const tokenAcr = typeof payloadObj.acr === 'string' ? payloadObj.acr.trim() : undefined;
    const tokenAmr = Array.isArray(payloadObj.amr)
      ? payloadObj.amr.filter((m): m is string => typeof m === 'string')
      : undefined;

    if (config.requiredAcr !== undefined) {
      const allowedAcrs = Array.isArray(config.requiredAcr)
        ? config.requiredAcr
        : [config.requiredAcr];
      if (!tokenAcr || !allowedAcrs.includes(tokenAcr)) {
        return fail(
          `OIDC/JWT authentication context class (acr="${String(tokenAcr)}") does not satisfy required policy (${allowedAcrs.join(', ')}).`
        );
      }
    }

    if (config.requiredAmr !== undefined && config.requiredAmr.length > 0) {
      if (!tokenAmr || !config.requiredAmr.every(reqMethod => tokenAmr.includes(reqMethod))) {
        return fail(
          `OIDC/JWT authentication methods (amr=${JSON.stringify(tokenAmr ?? [])}) do not satisfy required policy (${config.requiredAmr.join(', ')}).`
        );
      }
    }

    // 8. Validate mandatory signed target specification / pattern / fingerprint binding (FINDING-06, AUDIT-04.6.2.3.5-02, AUDIT-05.1-05, Safeguard 1)
    if (options?.requireTargetBinding === false) {
      return fail(
        'Security policy violation: disabling JWT target binding (requireTargetBinding: false) is strictly forbidden.'
      );
    }

    const tokenSpecId =
      typeof payloadObj.spec_id === 'string' && payloadObj.spec_id.trim().length > 0
        ? payloadObj.spec_id.trim()
        : undefined;
    const tokenTargetRevId =
      typeof payloadObj.target_revision_id === 'string' &&
      payloadObj.target_revision_id.trim().length > 0
        ? payloadObj.target_revision_id.trim()
        : undefined;
    const tokenTargetFp =
      typeof payloadObj.target_specification_fingerprint === 'string' &&
      payloadObj.target_specification_fingerprint.trim().length > 0
        ? payloadObj.target_specification_fingerprint.trim().toLowerCase()
        : undefined;
    const tokenPatternRevId =
      typeof payloadObj.pattern_revision_id === 'string' &&
      payloadObj.pattern_revision_id.trim().length > 0
        ? payloadObj.pattern_revision_id.trim()
        : undefined;
    const tokenBasePatternFp =
      typeof payloadObj.base_pattern_fingerprint === 'string' &&
      payloadObj.base_pattern_fingerprint.trim().length > 0
        ? payloadObj.base_pattern_fingerprint.trim().toLowerCase()
        : undefined;
    const tokenGeometryFp =
      typeof payloadObj.geometry_fingerprint === 'string' &&
      payloadObj.geometry_fingerprint.trim().length > 0
        ? payloadObj.geometry_fingerprint.trim().toLowerCase()
        : undefined;
    const tokenSourceSpecFp =
      typeof payloadObj.source_specification_fingerprint === 'string' &&
      payloadObj.source_specification_fingerprint.trim().length > 0
        ? payloadObj.source_specification_fingerprint.trim().toLowerCase()
        : undefined;
    const tokenSourceMeasFp =
      typeof payloadObj.source_measurement_set_fingerprint === 'string' &&
      payloadObj.source_measurement_set_fingerprint.trim().length > 0
        ? payloadObj.source_measurement_set_fingerprint.trim().toLowerCase()
        : undefined;

    const wrapperSpecId =
      credential.specificationId !== undefined
        ? credential.specificationId.trim()
        : credential.targetSpecificationId !== undefined
          ? credential.targetSpecificationId.trim()
          : undefined;
    if (
      credential.specificationId !== undefined &&
      credential.targetSpecificationId !== undefined &&
      credential.specificationId.trim() !== credential.targetSpecificationId.trim()
    ) {
      return fail(
        `Credential wrapper specificationId "${credential.specificationId}" disagrees with wrapper targetSpecificationId "${credential.targetSpecificationId}".`
      );
    }
    if (wrapperSpecId !== undefined && wrapperSpecId !== tokenSpecId) {
      return fail(
        `Credential wrapper specificationId "${wrapperSpecId}" does not match signed JWT spec_id claim "${String(tokenSpecId)}".`
      );
    }
    if (credential.targetRevisionId !== undefined && credential.targetRevisionId.trim() !== tokenTargetRevId) {
      return fail(
        `Credential wrapper targetRevisionId "${credential.targetRevisionId}" does not match signed JWT target_revision_id claim "${String(tokenTargetRevId)}".`
      );
    }
    if (
      credential.targetSpecificationFingerprint !== undefined &&
      credential.targetSpecificationFingerprint.trim().toLowerCase() !== tokenTargetFp
    ) {
      return fail(
        'Credential wrapper targetSpecificationFingerprint does not match signed JWT target_specification_fingerprint claim.'
      );
    }
    if (
      credential.patternRevisionId !== undefined &&
      credential.patternRevisionId.trim() !== tokenPatternRevId
    ) {
      return fail(
        `Credential wrapper patternRevisionId "${credential.patternRevisionId}" does not match signed JWT pattern_revision_id claim "${String(tokenPatternRevId)}".`
      );
    }
    if (
      credential.basePatternFingerprint !== undefined &&
      credential.basePatternFingerprint.trim().toLowerCase() !== tokenBasePatternFp
    ) {
      return fail(
        'Credential wrapper basePatternFingerprint does not match signed JWT base_pattern_fingerprint claim.'
      );
    }
    if (
      credential.geometryFingerprint !== undefined &&
      credential.geometryFingerprint.trim().toLowerCase() !== tokenGeometryFp
    ) {
      return fail(
        'Credential wrapper geometryFingerprint does not match signed JWT geometry_fingerprint claim.'
      );
    }
    if (
      credential.sourceSpecificationFingerprint !== undefined &&
      credential.sourceSpecificationFingerprint.trim().toLowerCase() !== tokenSourceSpecFp
    ) {
      return fail(
        'Credential wrapper sourceSpecificationFingerprint does not match signed JWT source_specification_fingerprint claim.'
      );
    }
    if (
      credential.sourceMeasurementSetFingerprint !== undefined &&
      credential.sourceMeasurementSetFingerprint.trim().toLowerCase() !== tokenSourceMeasFp
    ) {
      return fail(
        'Credential wrapper sourceMeasurementSetFingerprint does not match signed JWT source_measurement_set_fingerprint claim.'
      );
    }

    if (expectedScope === 'pattern:approve') {
      if (
        !tokenSpecId ||
        !tokenPatternRevId ||
        !tokenBasePatternFp ||
        !tokenGeometryFp ||
        !tokenSourceSpecFp ||
        !tokenSourceMeasFp
      ) {
        return fail(
          'OIDC/JWT pattern approval credential is missing required pattern target-binding claims ("spec_id", "pattern_revision_id", "base_pattern_fingerprint", "geometry_fingerprint", "source_specification_fingerprint", "source_measurement_set_fingerprint").'
        );
      }
      if (tokenTargetRevId && tokenTargetRevId !== tokenPatternRevId) {
        return fail(
          `OIDC/JWT target_revision_id "${tokenTargetRevId}" disagrees with pattern_revision_id "${tokenPatternRevId}".`
        );
      }
      if (tokenTargetFp && tokenTargetFp !== tokenBasePatternFp) {
        return fail(
          'OIDC/JWT target_specification_fingerprint disagrees with base_pattern_fingerprint.'
        );
      }

      if (options !== undefined) {
        if (!options || typeof options !== 'object') {
          return fail('Invalid identity credential verification options.');
        }
        const expectedSpecId =
          typeof options.expectedSpecificationId === 'string'
            ? options.expectedSpecificationId.trim()
            : '';
        const expectedPatRevId =
          typeof (options.expectedPatternRevisionId ?? options.expectedRevisionId) === 'string'
            ? (options.expectedPatternRevisionId ?? options.expectedRevisionId)!.trim()
            : '';
        const expectedBaseFp =
          typeof (options.expectedBasePatternFingerprint ?? options.expectedSpecificationFingerprint) === 'string'
            ? (options.expectedBasePatternFingerprint ?? options.expectedSpecificationFingerprint)!.trim().toLowerCase()
            : '';
        const expectedGeomFp =
          typeof options.expectedGeometryFingerprint === 'string'
            ? options.expectedGeometryFingerprint.trim().toLowerCase()
            : '';
        const expectedSrcSpecFp =
          typeof options.expectedSourceSpecificationFingerprint === 'string'
            ? options.expectedSourceSpecificationFingerprint.trim().toLowerCase()
            : '';
        const expectedSrcMeasFp =
          typeof options.expectedSourceMeasurementSetFingerprint === 'string'
            ? options.expectedSourceMeasurementSetFingerprint.trim().toLowerCase()
            : '';

        if (
          !expectedSpecId ||
          !expectedPatRevId ||
          !expectedBaseFp ||
          !expectedGeomFp ||
          !expectedSrcSpecFp ||
          !expectedSrcMeasFp
        ) {
          return fail(
            'OIDC/JWT pattern verification context is incomplete: expectedSpecificationId, expectedPatternRevisionId, expectedBasePatternFingerprint, expectedGeometryFingerprint, expectedSourceSpecificationFingerprint, and expectedSourceMeasurementSetFingerprint are all mandatory.'
          );
        }

        if (tokenSpecId !== expectedSpecId) {
          return fail(
            `OIDC/JWT garmentId mismatch: token bound to spec_id="${tokenSpecId}", expected "${expectedSpecId}".`
          );
        }
        if (tokenPatternRevId !== expectedPatRevId) {
          return fail(
            `OIDC/JWT patternRevisionId mismatch: token bound to pattern_revision_id="${tokenPatternRevId}", expected "${expectedPatRevId}".`
          );
        }
        if (tokenBasePatternFp !== expectedBaseFp) {
          return fail(
            `OIDC/JWT basePatternFingerprint mismatch: token bound to "${tokenBasePatternFp}", expected "${expectedBaseFp}".`
          );
        }
        if (tokenGeometryFp !== expectedGeomFp) {
          return fail(
            `OIDC/JWT geometryFingerprint mismatch: token bound to "${tokenGeometryFp}", expected "${expectedGeomFp}".`
          );
        }
        if (tokenSourceSpecFp !== expectedSrcSpecFp) {
          return fail(
            `OIDC/JWT sourceSpecificationFingerprint mismatch: token bound to "${tokenSourceSpecFp}", expected "${expectedSrcSpecFp}".`
          );
        }
        if (tokenSourceMeasFp !== expectedSrcMeasFp) {
          return fail(
            `OIDC/JWT sourceMeasurementSetFingerprint mismatch: token bound to "${tokenSourceMeasFp}", expected "${expectedSrcMeasFp}".`
          );
        }
      }
    } else {
      // Signed JWT target-binding claims ("spec_id", "target_revision_id", "target_specification_fingerprint")
      // are mandatory across ALL specification identity verification entry points (AUDIT-04.6.2.3.5-02).
      if (!tokenSpecId || !tokenTargetRevId || !tokenTargetFp) {
        return fail(
          'OIDC/JWT approval credential is missing required target-binding claims ("spec_id", "target_revision_id", and "target_specification_fingerprint"). Unbound tokens cannot approve a garment specification.'
        );
      }

      if (options !== undefined) {
        if (!options || typeof options !== 'object') {
          return fail('Invalid identity credential verification options.');
        }
        const expectedSpecId =
          typeof options.expectedSpecificationId === 'string'
            ? options.expectedSpecificationId.trim()
            : '';
        const expectedRevId =
          typeof options.expectedRevisionId === 'string'
            ? options.expectedRevisionId.trim()
            : '';
        const expectedFp =
          typeof options.expectedSpecificationFingerprint === 'string'
            ? options.expectedSpecificationFingerprint.trim().toLowerCase()
            : '';

        if (!expectedSpecId || !expectedRevId || !expectedFp) {
          return fail(
            'OIDC/JWT verification context is incomplete: expectedSpecificationId, expectedRevisionId, and expectedSpecificationFingerprint are all mandatory.'
          );
        }

        if (tokenSpecId !== expectedSpecId) {
          return fail(
            `OIDC/JWT target specificationId mismatch: token is bound to spec_id="${tokenSpecId}", but target specification is "${expectedSpecId}".`
          );
        }
        if (tokenTargetRevId !== expectedRevId) {
          return fail(
            `OIDC/JWT targetRevisionId mismatch: token is bound to target_revision_id="${tokenTargetRevId}", but target revision is "${expectedRevId}".`
          );
        }
        if (tokenTargetFp !== expectedFp) {
          return fail(
            `OIDC/JWT targetSpecificationFingerprint mismatch: token is bound to fingerprint "${tokenTargetFp}", but target specification fingerprint is "${expectedFp}".`
          );
        }
      }
    }

    const effectiveBoundRevId =
      expectedScope === 'pattern:approve' ? tokenPatternRevId! : tokenTargetRevId!;
    const effectiveBoundFp =
      expectedScope === 'pattern:approve' ? tokenBasePatternFp! : tokenTargetFp!;

    // 9. Atomic JTI Replay Protection (FINDING-06)
    const tokenDigest = sha256Hex(rawJwt);
    const verifiedAtIso = new Date(nowMs).toISOString();

    if (options?.reverifyRecordedApproval) {
      const reverify = options.reverifyRecordedApproval;
      if (
        !reverify.recordedTokenDigest ||
        !reverify.recordedSpecificationId ||
        !reverify.recordedRevisionId ||
        !reverify.recordedSpecificationFingerprint
      ) {
        return fail('Incomplete recorded approval binding context for credential re-verification.');
      }
      if (reverify.recordedScope && reverify.recordedScope !== expectedScope) {
        return fail(
          `Recorded approval scope "${reverify.recordedScope}" does not match expected scope "${expectedScope}".`
        );
      }
      if (tokenDigest !== reverify.recordedTokenDigest) {
        return fail('Identity credential token digest does not match the recorded approval tokenDigest.');
      }
      if (reverify.recordedJti && jti !== reverify.recordedJti) {
        return fail(
          `Identity credential jti "${jti}" does not match the recorded approval jti "${reverify.recordedJti}".`
        );
      }
      if (
        tokenSpecId !== reverify.recordedSpecificationId.trim() ||
        effectiveBoundRevId !== reverify.recordedRevisionId.trim() ||
        effectiveBoundFp !== reverify.recordedSpecificationFingerprint.trim().toLowerCase()
      ) {
        return fail(
          'Identity credential target binding does not match the recorded approval target binding.'
        );
      }
      if (expectedScope === 'pattern:approve') {
        if (
          (reverify.recordedGeometryFingerprint &&
            tokenGeometryFp !== reverify.recordedGeometryFingerprint.trim().toLowerCase()) ||
          (reverify.recordedSourceSpecificationFingerprint &&
            tokenSourceSpecFp !== reverify.recordedSourceSpecificationFingerprint.trim().toLowerCase()) ||
          (reverify.recordedSourceMeasurementSetFingerprint &&
            tokenSourceMeasFp !== reverify.recordedSourceMeasurementSetFingerprint.trim().toLowerCase())
        ) {
          return fail(
            'Identity credential pattern dependency binding does not match the recorded pattern approval.'
          );
        }
      }
      const existingRecord = replayStore.getConsumedRecord(jti, iss);
      if (existingRecord) {
        if (
          existingRecord.tokenDigest !== reverify.recordedTokenDigest ||
          (existingRecord.approvalScope && existingRecord.approvalScope !== expectedScope) ||
          existingRecord.targetRevisionId !== reverify.recordedRevisionId ||
          existingRecord.targetSpecificationFingerprint !==
            reverify.recordedSpecificationFingerprint.toLowerCase() ||
          existingRecord.specificationId !== reverify.recordedSpecificationId
        ) {
          return fail(
            `Replay detected during approval re-verification: JWT jti "${jti}" was originally consumed for a different approval domain, specification, or revision.`
          );
        }
      }
    } else {
      try {
        const consumeRes = replayStore.consumeJti(
          {
            jti,
            issuer: iss,
            subjectId: sub,
            consumedAtIso: verifiedAtIso,
            expiresAtEpochSeconds: exp,
            approvalScope: expectedScope,
            specificationId: tokenSpecId,
            targetRevisionId: effectiveBoundRevId,
            targetSpecificationFingerprint: effectiveBoundFp,
            tokenDigest
          },
          nowSec
        );
        if (!consumeRes.consumed) {
          return fail(
            consumeRes.reason ??
              `Replay detected: OIDC/JWT token jti "${jti}" has already been consumed.`
          );
        }
      } catch (err) {
        return fail(
          `JTI replay store failure (fail-closed): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const provenance: VerifiedIdentityProvenance = {
      subject: sub,
      subjectId: sub,
      displayName,
      expectedApprover: displayName,
      issuer: iss,
      audience: expectedAud,
      tenantId: tid,
      keyId: kid,
      tokenId: jti,
      jti,
      credentialId: jti,
      notBefore: credential.notBefore,
      issuedAt: credential.issuedAt,
      expiresAt: credential.expiresAt,
      verifiedAt: verifiedAtIso,
      claims: combinedClaims,
      authorizationClaims: combinedClaims,
      providerId: iss,
      verificationMethod: 'OIDC-JWT-EdDSA',
      tokenDigest,
      approvalScope: expectedScope,
      tokenUse,
      targetSpecificationId: tokenSpecId,
      targetRevisionId: effectiveBoundRevId,
      targetSpecificationFingerprint: effectiveBoundFp,
      ...(tokenPatternRevId ? { patternRevisionId: tokenPatternRevId } : {}),
      ...(tokenBasePatternFp ? { basePatternFingerprint: tokenBasePatternFp } : {}),
      ...(tokenGeometryFp ? { geometryFingerprint: tokenGeometryFp } : {}),
      ...(tokenSourceSpecFp ? { sourceSpecificationFingerprint: tokenSourceSpecFp } : {}),
      ...(tokenSourceMeasFp ? { sourceMeasurementSetFingerprint: tokenSourceMeasFp } : {}),
      acr: tokenAcr,
      amr: tokenAmr
    };

    return {
      verified: true,
      isValid: true,
      provenance,
      verifiedSubjectId: sub,
      verifiedDisplayName: displayName,
      verifiedIssuer: iss,
      verifiedAudience: expectedAud,
      verifiedKeyId: kid,
      verifiedTenantId: tid,
      verifiedClaims: combinedClaims,
      verifiedJti: jti,
      verifiedSpecificationId: tokenSpecId,
      verifiedTargetRevisionId: effectiveBoundRevId,
      verifiedTargetSpecificationFingerprint: effectiveBoundFp,
      verifiedAcr: tokenAcr,
      verifiedAmr: tokenAmr,
      verifiedAt: verifiedAtIso
    };
  }

  return {
    verifierId: `oidc-verifier-${trustedIssuersList[0]}`,
    trustedIssuers: trustedIssuersList,
    expectedAudience: config.expectedAudience.trim(),
    expectedTenantId: config.expectedTenantId?.trim(),
    publicJwks: Array.from(jwkMap.values()).map(v => v.jwk),
    replayStore,

    verifyCredential(
      credential: VerifiableIdentityCredential,
      options?: IdentityCredentialVerificationOptions
    ): IdentityVerificationResult {
      return evaluateCredential(credential, options);
    },

    verifyIdentityCredential(
      credential: VerifiableIdentityCredential,
      context: {
        readonly targetRevisionId?: string;
        readonly expectedRevisionId?: string;
        readonly targetSpecificationFingerprint?: string;
        readonly expectedSpecificationFingerprint?: string;
        readonly expectedApprover?: string;
        readonly approvalTimestamp?: string;
        readonly expectedTenantId?: string;
        readonly expectedSpecificationId?: string;
        readonly reverifyRecordedApproval?: IdentityCredentialVerificationOptions['reverifyRecordedApproval'];
      }
    ): IdentityVerificationResult {
      if (!context || typeof context !== 'object') {
        return {
          verified: false,
          isValid: false,
          reason: 'verifyIdentityCredential requires a non-empty verification context.'
        };
      }
      const expectedSpecificationId =
        typeof context.expectedSpecificationId === 'string'
          ? context.expectedSpecificationId.trim()
          : '';
      const rawRevId = context.targetRevisionId ?? context.expectedRevisionId;
      const targetRevisionId =
        typeof rawRevId === 'string'
          ? rawRevId.trim()
          : '';
      const rawFp =
        context.targetSpecificationFingerprint ?? context.expectedSpecificationFingerprint;
      const targetSpecificationFingerprint =
        typeof rawFp === 'string'
          ? rawFp.trim()
          : '';

      if (!expectedSpecificationId || !targetRevisionId || !targetSpecificationFingerprint) {
        return {
          verified: false,
          isValid: false,
          reason:
            'verifyIdentityCredential context is missing required target binding parameters (expectedSpecificationId, targetRevisionId, and targetSpecificationFingerprint are all mandatory).'
        };
      }

      return evaluateCredential(credential, {
        expectedSpecificationId,
        expectedRevisionId: targetRevisionId,
        expectedSpecificationFingerprint: targetSpecificationFingerprint,
        expectedApprover: context.expectedApprover,
        approvalTimestamp: context.approvalTimestamp,
        expectedTenantId: context.expectedTenantId,
        requireTargetBinding: true,
        reverifyRecordedApproval: context.reverifyRecordedApproval
      });
    }
  };
}

// ============================================================================
// CRYPTOGRAPHIC PRINCIPAL Ed25519 SIGNING & VERIFICATION (TIER 4)
// ============================================================================

/**
 * Deterministically serializes the canonical approval signing payload.
 */
export function canonicalizeApprovalSigningPayload(
  payload: CanonicalApprovalSigningPayload
): string {
  const ordered: CanonicalApprovalSigningPayload = {
    schemaVersion: payload.schemaVersion || SPECIFICATION_CANONICAL_SCHEMA_VERSION,
    projectId: payload.projectId,
    tenantId: payload.tenantId || payload.projectId,
    garmentId: payload.garmentId,
    specificationRevisionId: payload.specificationRevisionId,
    specificationVersion: payload.specificationVersion,
    canonicalSpecificationFingerprint: payload.canonicalSpecificationFingerprint,
    approvalEventId: payload.approvalEventId,
    approverPrincipal: payload.approverPrincipal,
    authorityTier: 'cryptographic_principal',
    approvalScope: 'specification:approve',
    approvalTimestamp: payload.approvalTimestamp,
    keyId: payload.keyId,
    algorithm: 'Ed25519'
  };
  return canonicalizeJson(ordered, { preserveUndefinedAsSentinel: true });
}

/**
 * Deterministically serializes a domain-separated pattern revision approval signing payload
 * (`PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION`, scope `'pattern:approve'`, `AUDIT-05.1-05`).
 */
export function canonicalizePatternApprovalSigningPayload(
  payload: CanonicalPatternApprovalSigningPayload
): string {
  const ordered: CanonicalPatternApprovalSigningPayload = {
    schemaVersion: PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION,
    projectId: payload.projectId,
    tenantId: payload.tenantId || payload.projectId,
    garmentId: payload.garmentId,
    patternRevisionId: payload.patternRevisionId,
    patternRevisionNumber: payload.patternRevisionNumber,
    basePatternFingerprint: payload.basePatternFingerprint,
    geometryFingerprint: payload.geometryFingerprint,
    sourceSpecificationFingerprint: payload.sourceSpecificationFingerprint,
    sourceMeasurementSetFingerprint: payload.sourceMeasurementSetFingerprint,
    approvalEventId: payload.approvalEventId,
    approverPrincipal: payload.approverPrincipal,
    authorityTier: 'cryptographic_principal',
    approvalScope: 'pattern:approve',
    approvalTimestamp: payload.approvalTimestamp,
    keyId: payload.keyId,
    algorithm: 'Ed25519'
  };
  return canonicalizeJson(ordered, { preserveUndefinedAsSentinel: true });
}

export interface SignSpecificationApprovalOptions {
  keyId: string;
  /** 64-character hex private seed or symbolic seed for key derivation on the signing side */
  privateKeyHex?: string;
  /** Alias for `privateKeyHex` on the signing side */
  signingKeyMaterial?: string;
  /** Optional issuer metadata */
  issuer?: string;
  /** Optional tenantId override (defaults to `payload.projectId`) */
  tenantId?: string;
}

/**
 * Signs a specification approval payload using RFC 8032 Ed25519.
 */
export function signSpecificationApprovalPayload(
  payloadInput: Omit<CanonicalApprovalSigningPayload, 'tenantId' | 'approvalScope' | 'keyId' | 'algorithm'> & {
    tenantId?: string;
    approvalScope?: string;
    keyId?: string;
    algorithm?: string;
  },
  keyConfig: SignSpecificationApprovalOptions
): VerifiableCryptographicSignature {
  if (!keyConfig.keyId || keyConfig.keyId.trim().length === 0) {
    throw new ProductionSnapshotValidationError('Cryptographic signing keyId cannot be empty.');
  }
  const secretSeed = keyConfig.privateKeyHex ?? keyConfig.signingKeyMaterial;
  if (!secretSeed || secretSeed.trim().length === 0) {
    throw new ProductionSnapshotValidationError('Cryptographic signing requires privateKeyHex or signingKeyMaterial.');
  }

  const fullPayload: CanonicalApprovalSigningPayload = {
    schemaVersion: payloadInput.schemaVersion || SPECIFICATION_CANONICAL_SCHEMA_VERSION,
    projectId: payloadInput.projectId,
    tenantId: payloadInput.tenantId ?? keyConfig.tenantId ?? payloadInput.projectId,
    garmentId: payloadInput.garmentId,
    specificationRevisionId: payloadInput.specificationRevisionId,
    specificationVersion: payloadInput.specificationVersion,
    canonicalSpecificationFingerprint: payloadInput.canonicalSpecificationFingerprint,
    approvalEventId: payloadInput.approvalEventId,
    approverPrincipal: payloadInput.approverPrincipal,
    authorityTier: 'cryptographic_principal',
    approvalScope: 'specification:approve',
    approvalTimestamp: payloadInput.approvalTimestamp,
    keyId: keyConfig.keyId.trim(),
    algorithm: 'Ed25519'
  };

  const canonicalJson = canonicalizeApprovalSigningPayload(fullPayload);
  const payloadFp = sha256Hex(canonicalJson);

  const kp = resolveSigningKeyPairInternal(secretSeed);
  const sigObj = signEd25519Message(canonicalJson, kp.privateKeyHex, {
    inputFormat: 'raw-seed-hex'
  });

  return {
    keyId: fullPayload.keyId!,
    algorithm: 'Ed25519',
    publicKeyHex: kp.publicKeyHex,
    publicKeyFingerprint: kp.publicKeyFingerprint,
    signerPrincipal: fullPayload.approverPrincipal,
    signatureHex: sigObj.signatureHex,
    signatureDigest: sigObj.signatureHex,
    signedPayload: fullPayload,
    signedPayloadCanonicalJson: canonicalJson,
    signedPayloadFingerprint: payloadFp,
    signedAt: fullPayload.approvalTimestamp
  };
}

export interface TrustedCryptographicVerifierConfig {
  /**
   * Controlled registry of trusted Ed25519 public keys (either a `ControlledPublicKeyRegistry`
   * or an array of `ControlledPublicKeyRegistration` entries).
   */
  publicKeyRegistry?: ControlledPublicKeyRegistry | readonly ControlledPublicKeyRegistration[];
  /**
   * Public-key map (`keyId -> 64-char publicKeyHex` or `ed25519-pub:<64-char publicKeyHex>`)
   * or map of `keyId -> ControlledPublicKeyRegistration`.
   * NOTE: Raw seeds or passphrases in `trustedKeys` are strictly rejected (`FINDING-10`).
   */
  trustedKeys?: Record<string, string | ControlledPublicKeyRegistration>;
  /** Optional trusted issuers list */
  trustedIssuers?: readonly string[];
  /** Optional expected tenant/project scope */
  expectedTenantId?: string;
  /** Optional trusted reference time for key lifecycle checks (`FINDING-11`) */
  referenceTimeIso?: string;
  /** Optional clock skew tolerance in seconds for approvalTimestamp vs referenceTimeIso (default: 300s) */
  clockSkewToleranceSeconds?: number;
  /** Optional flag to allow multiple keyIds to share the same publicKeyHex (default: false, `FINDING-09`) */
  allowDuplicatePublicKeyMaterial?: boolean;
}

/**
 * Creates a `TrustedCryptographicVerifier` that verifies RFC 8032 Ed25519 signatures
 * strictly against a controlled registry of public keys (`ControlledPublicKeyRegistration`).
 */
export function createTrustedCryptographicVerifier(
  config: TrustedCryptographicVerifierConfig
): TrustedCryptographicVerifier {
  if (!config || typeof config !== 'object') {
    throw new ProductionSnapshotValidationError(
      'TrustedCryptographicVerifier requires a configuration object.',
      ['missing-crypto-verifier-config']
    );
  }

  // Strictly forbid private keys, seeds, circular refs, non-plain objects, or unknown properties on the config (FINDING-08, FINDING-10, AUDIT-04.6.2.3.5-04)
  assertNoPrivateKeyMaterialInVerifierBoundary(config, 'TrustedCryptographicVerifierConfig');
  assertStrictAllowedKeys(
    config as unknown as Record<string, unknown>,
    ALLOWED_CRYPTO_VERIFIER_CONFIG_KEYS,
    'TrustedCryptographicVerifierConfig'
  );

  const registryMap = new Map<string, ControlledPublicKeyRegistration>();

  function addRegistrationEntry(entry: ControlledPublicKeyRegistration): void {
    const normalized = validateControlledPublicKeyRegistration(entry);
    const keyId = normalized.keyId;
    const pubHex = normalized.publicKeyHex;

    if (registryMap.has(keyId)) {
      throw new ProductionSnapshotValidationError(
        `Duplicate keyId "${keyId}" in TrustedCryptographicVerifier publicKeyRegistry is prohibited.`,
        ['duplicate-key-id']
      );
    }

    if (!config.allowDuplicatePublicKeyMaterial) {
      for (const [existingKeyId, existingEntry] of registryMap.entries()) {
        if (
          existingKeyId !== keyId &&
          existingEntry.publicKeyHex === pubHex &&
          keyWindowsOverlap(existingEntry, normalized)
        ) {
          throw new ProductionSnapshotValidationError(
            `Duplicate Ed25519 publicKeyHex across distinct active keyIds ("${existingKeyId}" and "${keyId}") is prohibited.`,
            ['duplicate-public-key-material']
          );
        }
      }
    }

    registryMap.set(keyId, normalized);
  }

  // 1. Load from `publicKeyRegistry`
  if (config.publicKeyRegistry) {
    if (Array.isArray(config.publicKeyRegistry)) {
      for (const entry of config.publicKeyRegistry) {
        addRegistrationEntry(entry);
      }
    } else if (
      typeof config.publicKeyRegistry === 'object' &&
      'entries' in config.publicKeyRegistry &&
      config.publicKeyRegistry.entries &&
      typeof config.publicKeyRegistry.entries === 'object'
    ) {
      assertNoPrivateKeyMaterialInVerifierBoundary(
        config.publicKeyRegistry,
        'ControlledPublicKeyRegistry'
      );
      assertStrictAllowedKeys(
        config.publicKeyRegistry as unknown as Record<string, unknown>,
        ALLOWED_PUBLIC_KEY_REGISTRY_KEYS,
        'ControlledPublicKeyRegistry'
      );
      for (const entry of Object.values(config.publicKeyRegistry.entries)) {
        addRegistrationEntry(entry);
      }
    } else {
      throw new ProductionSnapshotValidationError(
        'Invalid publicKeyRegistry passed to createTrustedCryptographicVerifier.',
        ['invalid-public-key-registry']
      );
    }
  }

  // 2. Load from `trustedKeys` (strictly public-key hex or ControlledPublicKeyRegistration only — NO seed derivation! FINDING-10)
  if (config.trustedKeys && typeof config.trustedKeys === 'object') {
    for (const [kId, val] of Object.entries(config.trustedKeys)) {
      if (typeof val === 'object' && val !== null) {
        addRegistrationEntry(val);
      } else if (typeof val === 'string' && val.trim().length > 0) {
        const rawVal = val.trim();
        const candidatePubHex = rawVal.startsWith('ed25519-pub:')
          ? rawVal.slice('ed25519-pub:'.length).trim().toLowerCase()
          : rawVal.toLowerCase();

        if (!/^[0-9a-f]{64}$/.test(candidatePubHex) || !isValidEd25519PublicKey(candidatePubHex)) {
          throw new ProductionSnapshotValidationError(
            `Security boundary violation: trustedKeys["${kId}"] must be a valid, canonical, non-torsion 64-character hex Ed25519 public key. Private seeds, passphrases, and small-order keys are rejected in verification services.`,
            ['verifier-private-seed-or-invalid-key-rejected']
          );
        }

        addRegistrationEntry({
          keyId: kId.trim(),
          algorithm: 'Ed25519',
          publicKeyHex: candidatePubHex,
          ownerPrincipal: '*',
          principalId: '*',
          tenantId: config.expectedTenantId ?? '*',
          allowedScopes: ['specification:approve'],
          trustStatus: 'trusted_local_Configured_key',
          activatedAt: '2020-01-01T00:00:00.000Z',
          expiresAt: '2035-01-01T00:00:00.000Z',
          revoked: false
        });
      } else {
        throw new ProductionSnapshotValidationError(
          `Invalid entry for trustedKeys["${kId}"] in createTrustedCryptographicVerifier.`,
          ['invalid-trusted-key-entry']
        );
      }
    }
  }

  if (registryMap.size === 0) {
    throw new ProductionSnapshotValidationError(
      'TrustedCryptographicVerifier requires at least one valid public key in publicKeyRegistry or trustedKeys.'
    );
  }

  const skewMs = (config.clockSkewToleranceSeconds ?? 300) * 1000;
  const trustedIssuersSet =
    Array.isArray(config.trustedIssuers) && config.trustedIssuers.length > 0
      ? new Set(config.trustedIssuers.map(i => i.trim()))
      : null;

  // Track approvalEventId -> domain::canonicalJson to detect cross-payload or cross-domain replay (Crypto 10, AUDIT-05.1-05)
  const consumedApprovalEvents = new Map<string, string>();

  function validateKeyForScopeAndTime(
    keyId: string,
    approverPrincipal: string,
    tenantId: string,
    projectId: string,
    approvalTimestamp: string,
    requiredScope: 'specification:approve' | 'pattern:approve',
    signature: VerifiableCryptographicSignature,
    fail: (
      reason: string,
      trustStatus?: ControlledPublicKeyRegistration['trustStatus']
    ) => CryptographicVerificationResult
  ): {
    readonly ok: true;
    readonly keyEntry: ControlledPublicKeyRegistration;
    readonly expectedTenant: string;
  } | {
    readonly ok: false;
    readonly result: CryptographicVerificationResult;
  } {
    const keyEntry = registryMap.get(keyId);
    if (!keyEntry || keyEntry.trustStatus === 'unregistered_key' || keyEntry.trustStatus === 'untrusted') {
      return {
        ok: false,
        result: fail(
          `Unregistered or untrusted public keyId "${keyId}": arbitrary caller-supplied public keys are not trusted.`,
          'unregistered_key'
        )
      };
    }

    if (
      trustedIssuersSet &&
      keyEntry.issuer &&
      !trustedIssuersSet.has(keyEntry.issuer.trim())
    ) {
      return {
        ok: false,
        result: fail(`Public key "${keyId}" issuer "${keyEntry.issuer}" is not in trustedIssuers.`)
      };
    }

    if (
      keyEntry.revoked ||
      keyEntry.compromised === true ||
      keyEntry.trustStatus === 'revoked_key' ||
      keyEntry.trustStatus === 'revoked' ||
      keyEntry.revocationReasonCode === 'compromise' ||
      keyEntry.revocationReason?.toLowerCase().includes('compromise')
    ) {
      return {
        ok: false,
        result: fail(
          `Public key "${keyId}" has been revoked${keyEntry.revocationReason ? ` (${keyEntry.revocationReason})` : ''} and cannot verify approvals.`,
          'revoked_key'
        )
      };
    }

    const signedTimeMs = Date.parse(approvalTimestamp);
    if (Number.isNaN(signedTimeMs)) {
      return { ok: false, result: fail('Invalid approvalTimestamp in expected signing payload.') };
    }

    const refTimeMs = config.referenceTimeIso ? Date.parse(config.referenceTimeIso) : signedTimeMs;
    if (Number.isNaN(refTimeMs)) {
      return { ok: false, result: fail('Invalid referenceTimeIso in TrustedCryptographicVerifier.') };
    }

    if (keyEntry.revokedAt) {
      const revokedAtMs = Date.parse(keyEntry.revokedAt);
      if (Number.isNaN(revokedAtMs) || signedTimeMs >= revokedAtMs || refTimeMs >= revokedAtMs) {
        return {
          ok: false,
          result: fail(
            `Public key "${keyId}" was revoked at "${keyEntry.revokedAt}" and cannot verify approvals.`,
            'revoked_key'
          )
        };
      }
    }

    const keyActivatedMs = Date.parse(keyEntry.activatedAt ?? '2020-01-01T00:00:00.000Z');
    const keyExpiresMs = Date.parse(keyEntry.expiresAt ?? '2035-01-01T00:00:00.000Z');
    if (signedTimeMs < keyActivatedMs || refTimeMs + skewMs < keyActivatedMs) {
      return {
        ok: false,
        result: fail(
          `Public key "${keyId}" was not yet active at "${approvalTimestamp}" (activatedAt: "${keyEntry.activatedAt}").`
        )
      };
    }
    if (
      signedTimeMs >= keyExpiresMs ||
      refTimeMs - skewMs >= keyExpiresMs ||
      keyEntry.trustStatus === 'expired_key' ||
      keyEntry.trustStatus === 'expired'
    ) {
      return {
        ok: false,
        result: fail(
          `Public key "${keyId}" has expired (expiresAt: "${keyEntry.expiresAt}").`,
          'expired_key'
        )
      };
    }

    if (config.referenceTimeIso && signedTimeMs > refTimeMs + skewMs) {
      return {
        ok: false,
        result: fail(
          `Approval timestamp "${approvalTimestamp}" is in the future relative to trusted evaluation time "${config.referenceTimeIso}".`
        )
      };
    }

    const keyOwner = keyEntry.ownerPrincipal ?? keyEntry.principalId ?? '*';
    if (keyOwner !== '*' && keyOwner !== approverPrincipal.trim()) {
      return {
        ok: false,
        result: fail(
          `Public key "${keyId}" is bound to principal "${keyOwner}", not "${approverPrincipal}".`
        )
      };
    }
    const sigSigner =
      signature.signerPrincipal ?? signature.signedPayload?.approverPrincipal;
    if (sigSigner && sigSigner.trim() !== approverPrincipal.trim()) {
      return {
        ok: false,
        result: fail(
          `Signature signerPrincipal "${sigSigner}" does not match expected approverPrincipal "${approverPrincipal}".`
        )
      };
    }

    const expectedTenant = config.expectedTenantId ?? tenantId ?? projectId;
    const keyTenant = keyEntry.tenantId ?? keyEntry.organizationScope ?? '*';
    if (keyTenant !== '*' && keyTenant !== expectedTenant) {
      return {
        ok: false,
        result: fail(
          `Public key "${keyId}" is scoped to tenant "${keyTenant}", which does not match active tenant/project "${expectedTenant}".`
        )
      };
    }

    const scopes = keyEntry.allowedScopes ?? ['specification:approve'];
    if (!scopes.includes(requiredScope)) {
      return {
        ok: false,
        result: fail(
          `Public key "${keyId}" is not authorized for scope "${requiredScope}".`
        )
      };
    }

    if (
      signature.publicKeyHex &&
      signature.publicKeyHex.trim().toLowerCase() !== keyEntry.publicKeyHex
    ) {
      return {
        ok: false,
        result: fail(
          `Signature publicKeyHex does not match registered public key for keyId "${keyId}".`
        )
      };
    }

    return { ok: true, keyEntry, expectedTenant };
  }

  function performVerification(
    signature: VerifiableCryptographicSignature,
    expectedPayload: CanonicalApprovalSigningPayload
  ): CryptographicVerificationResult {
    const fail = (
      reason: string,
      trustStatus?: ControlledPublicKeyRegistration['trustStatus']
    ): CryptographicVerificationResult => ({
      verified: false,
      isValid: false,
      reason,
      trustStatus
    });

    if (!signature || typeof signature !== 'object') {
      return fail('Missing or malformed cryptographic signature object.');
    }
    if (!expectedPayload || typeof expectedPayload !== 'object') {
      return fail('Missing or malformed expected specification signing payload.');
    }

    // Domain separation guard (AUDIT-05.1-05): reject pattern payloads in specification verification
    const rawExpected = expectedPayload as unknown as Record<string, unknown>;
    const rawSigned = signature.signedPayload as unknown as Record<string, unknown> | undefined;
    if (
      rawExpected.approvalScope === 'pattern:approve' ||
      rawExpected.schemaVersion === PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION ||
      'patternRevisionId' in rawExpected ||
      (rawSigned &&
        (rawSigned.approvalScope === 'pattern:approve' ||
          rawSigned.schemaVersion === PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION ||
          'patternRevisionId' in rawSigned))
    ) {
      return fail(
        'Cross-domain signature rejected: pattern approval payload cannot be verified in specification:approve domain.'
      );
    }

    if (signature.algorithm !== 'Ed25519') {
      return fail(
        `Unsupported or downgraded signature algorithm "${String(signature.algorithm)}". Only asymmetric "Ed25519" is permitted.`
      );
    }

    const keyId = typeof signature.keyId === 'string' ? signature.keyId.trim() : '';
    if (!keyId) {
      return fail('Signature is missing required keyId.');
    }

    const keyValidation = validateKeyForScopeAndTime(
      keyId,
      expectedPayload.approverPrincipal,
      expectedPayload.tenantId || expectedPayload.projectId,
      expectedPayload.projectId,
      expectedPayload.approvalTimestamp,
      'specification:approve',
      signature,
      fail
    );
    if (!keyValidation.ok) {
      return keyValidation.result;
    }
    const { keyEntry, expectedTenant } = keyValidation;

    const expectedPayloadWithKey: CanonicalApprovalSigningPayload = {
      ...expectedPayload,
      tenantId: expectedPayload.tenantId || expectedPayload.projectId,
      approvalScope: 'specification:approve',
      keyId,
      algorithm: 'Ed25519'
    };
    const expectedCanonicalJson = canonicalizeApprovalSigningPayload(expectedPayloadWithKey);
    const expectedPayloadFp = sha256Hex(expectedCanonicalJson);

    const specSignedPayload =
      signature.signedPayload && !('patternRevisionId' in signature.signedPayload)
        ? (signature.signedPayload as CanonicalApprovalSigningPayload)
        : undefined;
    const actualSignedCanonicalJson =
      signature.signedPayloadCanonicalJson ??
      (specSignedPayload ? canonicalizeApprovalSigningPayload(specSignedPayload) : '');
    const actualSignedFp =
      signature.signedPayloadFingerprint ??
      (actualSignedCanonicalJson ? sha256Hex(actualSignedCanonicalJson) : '');

    if (
      actualSignedCanonicalJson !== expectedCanonicalJson ||
      actualSignedFp !== expectedPayloadFp
    ) {
      return fail(
        'Cryptographic signature payload mismatch: signed payload does not match active specification revision, fingerprint, project, version, or approval metadata.'
      );
    }

    const domainPrefixedRecord = `specification:approve::${expectedCanonicalJson}`;
    const existingEventCanonical = consumedApprovalEvents.get(expectedPayload.approvalEventId);
    if (existingEventCanonical && existingEventCanonical !== domainPrefixedRecord) {
      return fail(
        `Replay detected: approvalEventId "${expectedPayload.approvalEventId}" has already been used for a different approval payload.`
      );
    }

    const rawSigHex = (signature.signatureHex ?? signature.signatureDigest ?? '').trim();
    const isEd25519Valid = verifyEd25519Signature(
      keyEntry.publicKeyHex,
      expectedCanonicalJson,
      rawSigHex
    );

    if (!isEd25519Valid) {
      return fail('Ed25519 asymmetric digital signature verification failed.');
    }

    consumedApprovalEvents.set(expectedPayload.approvalEventId, domainPrefixedRecord);

    return {
      verified: true,
      isValid: true,
      keyId,
      verifiedKeyId: keyId,
      verifiedPublicKeyHex: keyEntry.publicKeyHex,
      publicKeyFingerprint: keyEntry.publicKeyFingerprint,
      verifiedPrincipal: expectedPayload.approverPrincipal.trim(),
      verifiedTenantId: expectedTenant,
      verifiedScope: 'specification:approve',
      algorithm: 'Ed25519',
      verifiedAlgorithm: 'Ed25519',
      verifiedPayloadDigest: expectedPayloadFp,
      trustStatus: keyEntry.trustStatus,
      verifiedAt: config.referenceTimeIso ?? new Date().toISOString()
    };
  }

  function performPatternVerification(
    signature: VerifiableCryptographicSignature,
    expectedPayload: CanonicalPatternApprovalSigningPayload
  ): CryptographicVerificationResult {
    const fail = (
      reason: string,
      trustStatus?: ControlledPublicKeyRegistration['trustStatus']
    ): CryptographicVerificationResult => ({
      verified: false,
      isValid: false,
      reason,
      trustStatus
    });

    if (!signature || typeof signature !== 'object') {
      return fail('Missing or malformed cryptographic signature object.');
    }
    if (!expectedPayload || typeof expectedPayload !== 'object') {
      return fail('Missing or malformed expected pattern signing payload.');
    }

    // Strict domain separation (AUDIT-05.1-05): reject specification payloads or mismatched schemas/scopes
    if (
      expectedPayload.schemaVersion !== PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION ||
      expectedPayload.approvalScope !== 'pattern:approve'
    ) {
      return fail(
        `Cross-domain signature rejected: pattern approval requires schemaVersion="${PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION}" and approvalScope="pattern:approve".`
      );
    }
    const rawSigned = signature.signedPayload as unknown as Record<string, unknown> | undefined;
    if (
      !rawSigned ||
      rawSigned.schemaVersion !== PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION ||
      rawSigned.approvalScope !== 'pattern:approve' ||
      'canonicalSpecificationFingerprint' in rawSigned ||
      typeof rawSigned.patternRevisionId !== 'string'
    ) {
      return fail(
        'Cross-domain signature rejected: signed payload is not a valid pattern:approve payload.'
      );
    }

    if (
      !expectedPayload.patternRevisionId ||
      !expectedPayload.basePatternFingerprint ||
      !expectedPayload.geometryFingerprint ||
      !expectedPayload.sourceSpecificationFingerprint ||
      !expectedPayload.sourceMeasurementSetFingerprint ||
      !expectedPayload.approvalEventId ||
      !expectedPayload.approverPrincipal
    ) {
      return fail(
        'Pattern approval signing payload is missing required pattern revision, content, geometry, or upstream source bindings.'
      );
    }

    if (signature.algorithm !== 'Ed25519') {
      return fail(
        `Unsupported or downgraded signature algorithm "${String(signature.algorithm)}". Only asymmetric "Ed25519" is permitted.`
      );
    }

    const keyId = typeof signature.keyId === 'string' ? signature.keyId.trim() : '';
    if (!keyId) {
      return fail('Signature is missing required keyId.');
    }

    const keyValidation = validateKeyForScopeAndTime(
      keyId,
      expectedPayload.approverPrincipal,
      expectedPayload.tenantId || expectedPayload.projectId,
      expectedPayload.projectId,
      expectedPayload.approvalTimestamp,
      'pattern:approve',
      signature,
      fail
    );
    if (!keyValidation.ok) {
      return keyValidation.result;
    }
    const { keyEntry, expectedTenant } = keyValidation;

    const expectedPayloadWithKey: CanonicalPatternApprovalSigningPayload = {
      ...expectedPayload,
      schemaVersion: PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION,
      tenantId: expectedPayload.tenantId || expectedPayload.projectId,
      approvalScope: 'pattern:approve',
      keyId,
      algorithm: 'Ed25519'
    };
    const expectedCanonicalJson = canonicalizePatternApprovalSigningPayload(expectedPayloadWithKey);
    const expectedPayloadFp = sha256Hex(expectedCanonicalJson);

    const patternSignedPayload = signature.signedPayload as CanonicalPatternApprovalSigningPayload;
    const actualSignedCanonicalJson =
      signature.signedPayloadCanonicalJson ??
      canonicalizePatternApprovalSigningPayload(patternSignedPayload);
    const actualSignedFp =
      signature.signedPayloadFingerprint ??
      (actualSignedCanonicalJson ? sha256Hex(actualSignedCanonicalJson) : '');

    if (
      actualSignedCanonicalJson !== expectedCanonicalJson ||
      actualSignedFp !== expectedPayloadFp
    ) {
      return fail(
        'Cryptographic pattern signature payload mismatch: signed payload does not match pattern revisionId, basePatternFingerprint, geometryFingerprint, upstream dependencies, or approval metadata.'
      );
    }

    const domainPrefixedRecord = `pattern:approve::${expectedCanonicalJson}`;
    const existingEventCanonical = consumedApprovalEvents.get(expectedPayload.approvalEventId);
    if (existingEventCanonical && existingEventCanonical !== domainPrefixedRecord) {
      return fail(
        `Replay detected: approvalEventId "${expectedPayload.approvalEventId}" has already been used for a different approval payload.`
      );
    }

    const rawSigHex = (signature.signatureHex ?? signature.signatureDigest ?? '').trim();
    const isEd25519Valid = verifyEd25519Signature(
      keyEntry.publicKeyHex,
      expectedCanonicalJson,
      rawSigHex
    );

    if (!isEd25519Valid) {
      return fail('Ed25519 asymmetric digital signature verification failed for pattern approval.');
    }

    consumedApprovalEvents.set(expectedPayload.approvalEventId, domainPrefixedRecord);

    return {
      verified: true,
      isValid: true,
      keyId,
      verifiedKeyId: keyId,
      verifiedPublicKeyHex: keyEntry.publicKeyHex,
      publicKeyFingerprint: keyEntry.publicKeyFingerprint,
      verifiedPrincipal: expectedPayload.approverPrincipal.trim(),
      verifiedTenantId: expectedTenant,
      verifiedScope: 'pattern:approve',
      algorithm: 'Ed25519',
      verifiedAlgorithm: 'Ed25519',
      verifiedPayloadDigest: expectedPayloadFp,
      trustStatus: keyEntry.trustStatus,
      verifiedAt: config.referenceTimeIso ?? new Date().toISOString()
    };
  }

  const allEntries = Array.from(registryMap.values());

  return {
    verifierId: `crypto-verifier-${allEntries.map(e => e.keyId).join(',')}`,
    trustedPublicKeyFingerprints: allEntries.map(
      e => e.publicKeyFingerprint ?? computeEd25519PublicKeyFingerprint(e.publicKeyHex)
    ),
    publicKeyRegistry: allEntries,

    verifyApprovalSignature(
      signature: VerifiableCryptographicSignature,
      expectedPayload: CryptographicApprovalBindingPayload
    ): CryptographicVerificationResult {
      return performVerification(signature, expectedPayload);
    },

    verifyPatternApprovalSignature(
      signature: VerifiableCryptographicSignature,
      expectedPayload: CanonicalPatternApprovalSigningPayload
    ): CryptographicVerificationResult {
      return performPatternVerification(signature, expectedPayload);
    },

    verifySignature(
      firstArg:
        | CryptographicApprovalBindingPayload
        | CanonicalPatternApprovalSigningPayload
        | VerifiableCryptographicSignature,
      secondArg:
        | VerifiableCryptographicSignature
        | CryptographicApprovalBindingPayload
        | CanonicalPatternApprovalSigningPayload
    ): CryptographicVerificationResult {
      const isFirstSignature =
        firstArg &&
        typeof firstArg === 'object' &&
        ('signatureHex' in firstArg || 'signatureDigest' in firstArg || 'signedPayload' in firstArg);
      const sig = (isFirstSignature ? firstArg : secondArg) as VerifiableCryptographicSignature;
      const expected = (isFirstSignature ? secondArg : firstArg) as
        | CryptographicApprovalBindingPayload
        | CanonicalPatternApprovalSigningPayload;
      const rawExp = expected as unknown as Record<string, unknown>;
      if (
        rawExp &&
        (rawExp.approvalScope === 'pattern:approve' ||
          rawExp.schemaVersion === PATTERN_APPROVAL_CANONICAL_SCHEMA_VERSION ||
          'patternRevisionId' in rawExp)
      ) {
        return performPatternVerification(
          sig,
          expected as CanonicalPatternApprovalSigningPayload
        );
      }
      return performVerification(sig, expected as CryptographicApprovalBindingPayload);
    }
  };
}

// ============================================================================
// SPECIFICATION CREATION, REVISION, SUPERSEDING, APPROVAL & VERIFICATION
// ============================================================================

export type CreateGarmentSpecificationParams = CreateAuthoritativeSpecificationInput;

const DEFAULT_ALLOWANCES: ManufacturingSeamAllowances = {
  seamAllowanceCm: 1.5,
  hemAllowanceCm: 3.0,
  waistAllowanceCm: 1.0,
  neckAllowanceCm: 1.0,
  armholeAllowanceCm: 1.0,
  shoulderAllowanceCm: 1.0
};

const DEFAULT_ENGINE_PROVENANCE: EngineProvenanceRecord = {
  engineVersion: '0.4.6-production-snapshot',
  draftingEngineVersion: '0.4.3-drafting',
  gradingEngineVersion: '0.4.5-grading',
  validationEngineVersion: '0.4.4-validation',
  fabricEngineVersion: '0.4.6-fabric'
};

/**
 * Creates a new draft `AuthoritativeGarmentSpecification` (unapproved, `version: 1` by default).
 */
export function createAuthoritativeGarmentSpecification(
  params: CreateAuthoritativeSpecificationInput
): AuthoritativeGarmentSpecification {
  const now = params.createdAt ?? '2026-11-01T00:00:00.000Z';
  const projectId = params.projectId?.trim() || 'project-patroner-default';
  const garmentId = params.garmentId?.trim() || `garment-${sha256Hex(params.name || 'unnamed').slice(0, 10)}`;
  const version = params.version ?? 1;
  const specificationRevisionId =
    params.specificationRevisionId?.trim() || `spec-${garmentId}-v${version}`;

  const enhancedLookup = params.fabric?.id ? getEnhancedFabricById(params.fabric.id) : { status: 'not-found' as const };
  const resolvedFabric: FabricProperty =
    enhancedLookup.status === 'found'
      ? { ...enhancedLookup.fabric, ...params.fabric }
      : params.fabric;

  const enhancedPart = resolvedFabric as Partial<EnhancedFabricProperty>;
  const fabricRevision =
    params.fabricRevision ?? enhancedPart.revision ?? `fab-rev-${resolvedFabric?.id ?? 'unknown'}-v1`;
  const fabricProvenance: FabricSnapshotProvenance =
    params.fabricProvenance ?? enhancedPart.provenance ?? 'preset-default';

  const targetFinishedDimensions: TargetFinishedGarmentDimensions = {
    lengthCm: params.targetFinishedDimensions?.lengthCm ?? params.lengthCm,
    waistCm: params.targetFinishedDimensions?.waistCm,
    hipCm: params.targetFinishedDimensions?.hipCm,
    bustCm: params.targetFinishedDimensions?.bustCm,
    chestCm: params.targetFinishedDimensions?.chestCm,
    acrossBackCm: params.targetFinishedDimensions?.acrossBackCm,
    bicepCm: params.targetFinishedDimensions?.bicepCm ?? params.targetFinishedDimensions?.bicepsCm,
    bicepsCm: params.targetFinishedDimensions?.bicepsCm ?? params.targetFinishedDimensions?.bicepCm,
    wristCm: params.targetFinishedDimensions?.wristCm,
    hemSweepCm: params.targetFinishedDimensions?.hemSweepCm,
    sleeveLengthCm: params.targetFinishedDimensions?.sleeveLengthCm
  };

  const explicitEaseCm: ExplicitGarmentEaseAllowances = {
    waist: params.explicitEaseCm?.waist,
    hip: params.explicitEaseCm?.hip,
    bust: params.explicitEaseCm?.bust,
    biceps: params.explicitEaseCm?.biceps,
    wrist: params.explicitEaseCm?.wrist,
    neck: params.explicitEaseCm?.neck,
    armholeDepth: params.explicitEaseCm?.armholeDepth,
    capEase: params.explicitEaseCm?.capEase
  };

  const allowances: ManufacturingSeamAllowances = {
    seamAllowanceCm: params.allowances?.seamAllowanceCm ?? DEFAULT_ALLOWANCES.seamAllowanceCm,
    hemAllowanceCm: params.allowances?.hemAllowanceCm ?? DEFAULT_ALLOWANCES.hemAllowanceCm,
    waistAllowanceCm: params.allowances?.waistAllowanceCm ?? DEFAULT_ALLOWANCES.waistAllowanceCm,
    neckAllowanceCm: params.allowances?.neckAllowanceCm ?? DEFAULT_ALLOWANCES.neckAllowanceCm,
    armholeAllowanceCm: params.allowances?.armholeAllowanceCm ?? DEFAULT_ALLOWANCES.armholeAllowanceCm,
    shoulderAllowanceCm: params.allowances?.shoulderAllowanceCm ?? DEFAULT_ALLOWANCES.shoulderAllowanceCm
  };

  const defaultProvenance: Record<string, ParameterValueProvenance> = {
    name: 'explicit-value',
    garmentCategory: 'explicit-value',
    silhouette: 'explicit-value',
    fabric: 'explicit-value',
    easeProfile: 'explicit-value',
    lengthCm: 'explicit-value',
    allowances: params.allowances ? 'explicit-value' : 'approved-project-default',
    ...(params.fieldProvenance ?? {})
  };

  const prevRev = params.previousRevisionId ?? params.parentRevisionId;

  const spec: AuthoritativeGarmentSpecification = {
    schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
    projectId,
    garmentId,
    specificationRevisionId,
    version,
    parentRevisionId: prevRev,
    previousRevisionId: prevRev,
    supersededByRevisionId: params.supersededByRevisionId,
    name: params.name,
    garmentCategory: params.garmentCategory,
    silhouette: params.silhouette,
    prompt: params.prompt ?? '',
    fabric: resolvedFabric,
    fabricRevision,
    fabricProvenance,
    color: params.color ?? { name: 'Atelier Charcoal', hex: '#1E1E24' },
    easeProfile: params.easeProfile,
    sleeveEaseStrategy: params.sleeveEaseStrategy ?? 'classic',
    dartStyle: params.dartStyle ?? 'single',
    waistband: params.waistband ?? 'straight',
    lengthCm: params.lengthCm,
    targetFinishedDimensions,
    explicitEaseCm,
    allowances,
    constructionFeatures: params.constructionFeatures ? [...params.constructionFeatures] : [],
    designNotes: params.designNotes ? [...params.designNotes] : [],
    fieldProvenance: defaultProvenance,
    createdAt: now,
    updatedAt: params.updatedAt ?? now,
    isApproved: params.isApproved ?? false,
    approvalState: params.approvalState ?? 'draft',
    approvalAuthorityTier: params.approvalAuthorityTier,
    approvalRecord: params.approvalRecord,
    revocationRecord: params.revocationRecord,
    approvedBy: params.approvedBy,
    approvedAt: params.approvedAt,
    approvalProvenance: params.approvalProvenance ?? 'unknown',
    engineProvenance: {
      ...DEFAULT_ENGINE_PROVENANCE,
      ...(params.engineProvenance ?? {})
    },
    aiEstimates: params.aiEstimates as AuthoritativeGarmentSpecification['aiEstimates'],
    approvalHistory: params.approvalHistory ? [...params.approvalHistory] : [],
    isProductionReady: false
  };

  if (!('prompt' in params)) {
    delete (spec as { prompt?: string }).prompt;
  }
  if (!('color' in params)) {
    delete (spec as { color?: unknown }).color;
  }

  canonicalizeSpecificationPayload(spec);
  return {
    ...spec,
    prompt: params.prompt ?? '',
    color: params.color ?? { name: 'Atelier Charcoal', hex: '#1E1E24' }
  };
}

export type GarmentSpecificationRevisionChanges = Partial<
  Pick<
    AuthoritativeGarmentSpecification,
    | 'name'
    | 'garmentCategory'
    | 'silhouette'
    | 'prompt'
    | 'fabric'
    | 'fabricRevision'
    | 'fabricProvenance'
    | 'color'
    | 'easeProfile'
    | 'sleeveEaseStrategy'
    | 'dartStyle'
    | 'waistband'
    | 'lengthCm'
    | 'targetFinishedDimensions'
    | 'explicitEaseCm'
    | 'allowances'
    | 'constructionFeatures'
    | 'designNotes'
    | 'fieldProvenance'
  >
> & {
  updatedAt?: string;
  specificationRevisionId?: string;
};

/**
 * Creates a new draft revision from an existing specification.
 */
export function reviseAuthoritativeGarmentSpecification(
  currentInput: AuthoritativeGarmentSpecification | DesignSpecification,
  changes: GarmentSpecificationRevisionChanges
): AuthoritativeGarmentSpecification {
  const current = ensureAuthoritativeSpec(currentInput);
  const nextVersion = current.version + 1;
  const nextRevisionId =
    changes.specificationRevisionId?.trim() || `spec-${current.garmentId}-v${nextVersion}`;
  const updatedAt = changes.updatedAt ?? new Date().toISOString();

  const nextLengthCm =
    changes.lengthCm ??
    changes.targetFinishedDimensions?.lengthCm ??
    current.lengthCm ??
    current.targetFinishedDimensions.lengthCm;

  const nextTargetFinishedDimensions: TargetFinishedGarmentDimensions = {
    ...current.targetFinishedDimensions,
    ...(changes.targetFinishedDimensions ?? {}),
    lengthCm:
      changes.targetFinishedDimensions?.lengthCm ??
      (changes.lengthCm !== undefined ? changes.lengthCm : current.targetFinishedDimensions.lengthCm)
  };

  const nextFabric = changes.fabric ?? current.fabric;
  const enhancedNextFabric = nextFabric as Partial<EnhancedFabricProperty>;
  const nextFabricRevision =
    changes.fabricRevision ??
    (changes.fabric ? enhancedNextFabric.revision ?? `fab-rev-${nextFabric.id}-v${nextVersion}` : current.fabricRevision);
  const nextFabricProvenance =
    changes.fabricProvenance ??
    (changes.fabric ? enhancedNextFabric.provenance ?? current.fabricProvenance : current.fabricProvenance);

  const revised: AuthoritativeGarmentSpecification = {
    ...current,
    schemaVersion: SPECIFICATION_CANONICAL_SCHEMA_VERSION,
    specificationRevisionId: nextRevisionId,
    version: nextVersion,
    parentRevisionId: current.specificationRevisionId,
    previousRevisionId: current.specificationRevisionId,
    supersededByRevisionId: undefined,
    name: changes.name ?? current.name,
    garmentCategory: changes.garmentCategory ?? current.garmentCategory,
    silhouette: changes.silhouette ?? current.silhouette,
    prompt: changes.prompt !== undefined ? changes.prompt : current.prompt,
    color: changes.color !== undefined ? changes.color : current.color,
    fabric: nextFabric,
    fabricRevision: nextFabricRevision,
    fabricProvenance: nextFabricProvenance,
    easeProfile: changes.easeProfile ?? current.easeProfile,
    sleeveEaseStrategy: changes.sleeveEaseStrategy ?? current.sleeveEaseStrategy,
    dartStyle: changes.dartStyle ?? current.dartStyle,
    waistband: changes.waistband ?? current.waistband,
    lengthCm: nextLengthCm,
    targetFinishedDimensions: nextTargetFinishedDimensions,
    explicitEaseCm: {
      ...(current.explicitEaseCm ?? {}),
      ...(changes.explicitEaseCm ?? {})
    },
    allowances: {
      ...current.allowances,
      ...(changes.allowances ?? {})
    },
    constructionFeatures: changes.constructionFeatures
      ? [...changes.constructionFeatures]
      : [...current.constructionFeatures],
    designNotes: changes.designNotes ? [...changes.designNotes] : [...current.designNotes],
    fieldProvenance: {
      ...(current.fieldProvenance ?? {}),
      ...(changes.fieldProvenance ?? {})
    },
    updatedAt,
    isApproved: false,
    approvalState: 'draft',
    approvalAuthorityTier: undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    approvedContentFingerprint: undefined,
    approvalRecord: undefined,
    revocationRecord: undefined,
    verifiedIdentity: undefined,
    cryptographicSignature: undefined,
    approvalProvenance: 'designer-edited',
    approvalHistory: [],
    isProductionReady: false
  };

  canonicalizeSpecificationPayload(revised);
  return revised;
}

/**
 * Supersedes an existing specification revision, returning both the marked
 * `supersededSpec` (`approvalState: 'superseded'`) and the new `nextRevision` (`draft`).
 */
export function supersedeAuthoritativeGarmentSpecification(
  currentInput: AuthoritativeGarmentSpecification | DesignSpecification,
  changes: GarmentSpecificationRevisionChanges
): {
  supersededSpec: AuthoritativeGarmentSpecification;
  nextRevision: AuthoritativeGarmentSpecification;
} {
  const current = ensureAuthoritativeSpec(currentInput);
  const nextRevision = reviseAuthoritativeGarmentSpecification(current, changes);
  const supersededSpec: AuthoritativeGarmentSpecification = {
    ...current,
    isApproved: false,
    approvalState: 'superseded',
    supersededByRevisionId: nextRevision.specificationRevisionId,
    updatedAt: nextRevision.updatedAt,
    isProductionReady: false
  };
  return { supersededSpec, nextRevision };
}

export interface ApproveSpecificationOptions {
  authorityTier?: ApprovalAuthorityTier;
  approverId?: string;
  approvalEventId?: string;
  approvedAt?: string;
  notes?: string;
  provenance?: SpecificationValueProvenance;
  /** Required when `authorityTier === 'authenticated_designer'` */
  identityCredential?: VerifiableIdentityCredential;
  /** Required when `authorityTier === 'authenticated_designer'` */
  identityVerifier?: TrustedIdentityVerifier;
  /** Required when `authorityTier === 'cryptographic_principal'` (unless `cryptographicKeyConfig` is provided) */
  cryptographicSignature?: VerifiableCryptographicSignature;
  /** Optional signing key configuration when signing at approval time */
  cryptographicKeyConfig?: SignSpecificationApprovalOptions;
  /** Required when `authorityTier === 'cryptographic_principal'` */
  cryptographicVerifier?: TrustedCryptographicVerifier;
}

/**
 * Approves an `AuthoritativeGarmentSpecification` under the four-tier authority model.
 */
export function approveAuthoritativeGarmentSpecification(
  specInput: AuthoritativeGarmentSpecification | DesignSpecification,
  approverName: string,
  optionsOrNotes?: string | ApproveSpecificationOptions
): AuthoritativeGarmentSpecification {
  const options: ApproveSpecificationOptions =
    typeof optionsOrNotes === 'string'
      ? { notes: optionsOrNotes }
      : optionsOrNotes ?? {};

  if (typeof approverName !== 'string' || approverName.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'Cannot approve specification without a valid approvedBy identity: approverName is mandatory and cannot be empty.',
      ['approverName']
    );
  }

  const spec = ensureAuthoritativeSpec(specInput);

  if (spec.approvalState === 'superseded' || spec.supersededByRevisionId) {
    throw new ProductionSnapshotValidationError(
      `Cannot approve superseded specification revision "${spec.specificationRevisionId}" (superseded by "${String(spec.supersededByRevisionId)}").`,
      ['supersededByRevisionId']
    );
  }

  const trimmedApprover = approverName.trim();
  const authorityTier: ApprovalAuthorityTier =
    options.authorityTier ?? 'unauthenticated_local_session';
  const approvedAt = options.approvedAt ?? '2026-11-01T12:00:00.000Z';
  const canonicalFingerprint = computeSpecificationFingerprint(spec);
  const eventId =
    options.approvalEventId?.trim() ||
    `evt-app-${spec.specificationRevisionId}-${(spec.approvalHistory?.length ?? 0) + 1}`;

  let verifiedIdentity: VerifiedIdentityProvenance | undefined;
  let verifiedSignature: VerifiableCryptographicSignature | undefined;
  let resolvedApproverId = options.approverId?.trim() || trimmedApprover;

  if (authorityTier === 'authenticated_designer') {
    if (
      !options.identityVerifier ||
      (typeof options.identityVerifier.verifyCredential !== 'function' &&
        typeof options.identityVerifier.verifyIdentityCredential !== 'function')
    ) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: authenticated_designer authority tier is unavailable without an external TrustedIdentityVerifier.',
        ['identityVerifier']
      );
    }
    if (!options.identityCredential) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: authenticated_designer authority tier requires a VerifiableIdentityCredential.',
        ['identityCredential']
      );
    }

    let idResult: IdentityVerificationResult;
    try {
      if (typeof options.identityVerifier.verifyCredential === 'function') {
        idResult = options.identityVerifier.verifyCredential(options.identityCredential, {
          expectedSpecificationId: spec.garmentId,
          expectedRevisionId: spec.specificationRevisionId,
          expectedSpecificationFingerprint: canonicalFingerprint,
          expectedApprover: trimmedApprover,
          approvalTimestamp: approvedAt,
          requireTargetBinding: true
        });
      } else {
        idResult = options.identityVerifier.verifyIdentityCredential!(options.identityCredential, {
          expectedSpecificationId: spec.garmentId,
          expectedRevisionId: spec.specificationRevisionId,
          targetRevisionId: spec.specificationRevisionId,
          expectedSpecificationFingerprint: canonicalFingerprint,
          targetSpecificationFingerprint: canonicalFingerprint,
          expectedApprover: trimmedApprover,
          approvalTimestamp: approvedAt,
          requireTargetBinding: true
        });
      }
    } catch (err) {
      throw new ProductionSnapshotValidationError(
        `Specification approval rejected: TrustedIdentityVerifier threw an exception during verification (${err instanceof Error ? err.message : String(err)}).`,
        ['identityVerifier']
      );
    }

    const isIdValid = idResult && (idResult.isValid || idResult.verified);
    if (!isIdValid) {
      throw new ProductionSnapshotValidationError(
        `Specification approval rejected by TrustedIdentityVerifier: ${idResult?.reason ?? 'invalid identity credential'}.`,
        ['identityCredential']
      );
    }

    // Independently verify signed JWT target-binding claims on the credential so even a custom
    // verifier implementing only verifyIdentityCredential can never accept an unbound or mismatched JWT (AUDIT-04.6.2.3.5-02).
    const rawTokenForBindingCheck = (
      options.identityCredential.credentialToken ??
      options.identityCredential.token ??
      ''
    ).trim();
    const jwtSegments = rawTokenForBindingCheck.split('.');
    if (jwtSegments.length !== 3 || !jwtSegments[0] || !jwtSegments[1] || !jwtSegments[2]) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: malformed OIDC/JWT compact token.',
        ['identityCredential']
      );
    }
    let decodedSignedPayload: Record<string, unknown>;
    try {
      decodedSignedPayload = JSON.parse(
        base64UrlDecodeToUtf8(jwtSegments[1])
      ) as Record<string, unknown>;
    } catch {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: failed to decode OIDC/JWT payload.',
        ['identityCredential']
      );
    }
    const signedSpecId =
      typeof decodedSignedPayload.spec_id === 'string' ? decodedSignedPayload.spec_id.trim() : '';
    const signedTargetRevId =
      typeof decodedSignedPayload.target_revision_id === 'string'
        ? decodedSignedPayload.target_revision_id.trim()
        : '';
    const signedTargetFp =
      typeof decodedSignedPayload.target_specification_fingerprint === 'string'
        ? decodedSignedPayload.target_specification_fingerprint.trim().toLowerCase()
        : '';

    if (!signedSpecId || !signedTargetRevId || !signedTargetFp) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: OIDC/JWT approval credential is missing required signed target-binding claims ("spec_id", "target_revision_id", and "target_specification_fingerprint").',
        ['identityCredential']
      );
    }
    if (signedSpecId !== spec.garmentId) {
      throw new ProductionSnapshotValidationError(
        `Specification approval rejected: JWT target specificationId mismatch (token bound to "${signedSpecId}", expected "${spec.garmentId}").`,
        ['identityCredential']
      );
    }
    if (
      signedTargetRevId !== spec.specificationRevisionId ||
      signedTargetFp !== canonicalFingerprint.toLowerCase()
    ) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: OIDC/JWT signed target-binding claims do not match target specification garmentId, specificationRevisionId, or canonical fingerprint.',
        ['identityCredential']
      );
    }
    const wrapperSpec =
      options.identityCredential.specificationId ?? options.identityCredential.targetSpecificationId;
    if (wrapperSpec !== undefined && wrapperSpec.trim() !== signedSpecId) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: credential wrapper specificationId disagrees with signed JWT spec_id claim.',
        ['identityCredential']
      );
    }
    if (
      options.identityCredential.targetRevisionId !== undefined &&
      options.identityCredential.targetRevisionId.trim() !== signedTargetRevId
    ) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: credential wrapper targetRevisionId disagrees with signed JWT target_revision_id claim.',
        ['identityCredential']
      );
    }
    if (
      options.identityCredential.targetSpecificationFingerprint !== undefined &&
      options.identityCredential.targetSpecificationFingerprint.trim().toLowerCase() !==
        signedTargetFp
    ) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: credential wrapper targetSpecificationFingerprint disagrees with signed JWT target_specification_fingerprint claim.',
        ['identityCredential']
      );
    }

    const verifiedSub =
      idResult?.verifiedSubjectId ??
      idResult?.provenance?.subjectId ??
      (typeof decodedSignedPayload.sub === 'string' ? decodedSignedPayload.sub.trim() : '');
    if (!verifiedSub) {
      throw new ProductionSnapshotValidationError(
        `Specification approval rejected by TrustedIdentityVerifier: ${idResult?.reason ?? 'invalid identity credential'}.`,
        ['identityCredential']
      );
    }

    const verifiedSpecId =
      idResult.verifiedSpecificationId ?? idResult.provenance?.targetSpecificationId ?? signedSpecId;
    const verifiedRevId =
      idResult.verifiedTargetRevisionId ?? idResult.provenance?.targetRevisionId ?? signedTargetRevId;
    const verifiedFp = (
      idResult.verifiedTargetSpecificationFingerprint ??
      idResult.provenance?.targetSpecificationFingerprint ??
      signedTargetFp
    ).toLowerCase();

    if (
      verifiedSpecId !== spec.garmentId ||
      verifiedRevId !== spec.specificationRevisionId ||
      verifiedFp !== canonicalFingerprint.toLowerCase()
    ) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: verified identity target binding does not match active specification.',
        ['identityCredential']
      );
    }

    if (options.approverId && options.approverId.trim() !== verifiedSub) {
      throw new ProductionSnapshotValidationError(
        `Specification approval rejected: credential subject "${verifiedSub}" does not match requested approver "${options.approverId.trim()}".`,
        ['approverId']
      );
    }
    const verifiedDisp = idResult.verifiedDisplayName ?? idResult.provenance?.expectedApprover;
    if (
      verifiedDisp &&
      verifiedDisp !== trimmedApprover &&
      verifiedSub !== trimmedApprover
    ) {
      throw new ProductionSnapshotValidationError(
        `Specification approval rejected: credential displayName "${verifiedDisp}" does not match requested approver "${trimmedApprover}".`,
        ['approverName']
      );
    }

    resolvedApproverId = verifiedSub;
    const rawTokenStr = rawTokenForBindingCheck;
    const claimsArr = idResult.verifiedClaims ?? options.identityCredential.claims ?? options.identityCredential.authorizationClaims ?? [];

    verifiedIdentity = idResult.provenance ?? {
      subject: verifiedSub,
      subjectId: verifiedSub,
      displayName: verifiedDisp ?? trimmedApprover,
      expectedApprover: verifiedDisp ?? trimmedApprover,
      issuer: idResult.verifiedIssuer ?? options.identityCredential.issuer,
      audience: idResult.verifiedAudience ?? options.identityCredential.audience,
      issuedAt: options.identityCredential.issuedAt,
      expiresAt: options.identityCredential.expiresAt,
      verifiedAt: idResult.verifiedAt ?? approvedAt,
      claims: [...claimsArr],
      authorizationClaims: [...claimsArr],
      providerId: idResult.verifiedIssuer ?? options.identityCredential.issuer,
      credentialId: idResult.verifiedJti ?? options.identityCredential.jti ?? eventId,
      tokenId: idResult.verifiedJti ?? options.identityCredential.jti,
      jti: idResult.verifiedJti ?? options.identityCredential.jti,
      tokenDigest: sha256Hex(rawTokenStr),
      keyId: idResult.verifiedKeyId ?? options.identityCredential.keyId,
      tenantId: idResult.verifiedTenantId ?? options.identityCredential.tenantId,
      targetSpecificationId: signedSpecId,
      targetRevisionId: signedTargetRevId,
      targetSpecificationFingerprint: signedTargetFp,
      acr: idResult.verifiedAcr ?? options.identityCredential.acr,
      amr: idResult.verifiedAmr ?? options.identityCredential.amr,
      verificationMethod: 'OIDC-JWT-EdDSA'
    };
  } else if (authorityTier === 'cryptographic_principal') {
    if (
      !options.cryptographicVerifier ||
      (typeof options.cryptographicVerifier.verifySignature !== 'function' &&
        typeof options.cryptographicVerifier.verifyApprovalSignature !== 'function')
    ) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: cryptographic_principal authority tier is unavailable without cryptographic provider configuration (TrustedCryptographicVerifier).',
        ['cryptographicVerifier']
      );
    }

    const candidateSignature: VerifiableCryptographicSignature | undefined =
      options.cryptographicSignature ??
      (options.cryptographicKeyConfig
        ? signSpecificationApprovalPayload(
            {
              schemaVersion: spec.schemaVersion || SPECIFICATION_CANONICAL_SCHEMA_VERSION,
              projectId: spec.projectId,
              tenantId: spec.projectId,
              garmentId: spec.garmentId,
              specificationRevisionId: spec.specificationRevisionId,
              specificationVersion: spec.version,
              canonicalSpecificationFingerprint: canonicalFingerprint,
              approvalEventId: eventId,
              approverPrincipal: options.approverId?.trim() || trimmedApprover,
              authorityTier: 'cryptographic_principal',
              approvalTimestamp: approvedAt
            },
            options.cryptographicKeyConfig
          )
        : undefined);

    if (!candidateSignature) {
      throw new ProductionSnapshotValidationError(
        'Specification approval rejected: cryptographic_principal authority tier requires a VerifiableCryptographicSignature.',
        ['cryptographicSignature']
      );
    }

    const expectedSigningPayload: CanonicalApprovalSigningPayload = {
      schemaVersion: spec.schemaVersion || SPECIFICATION_CANONICAL_SCHEMA_VERSION,
      projectId: spec.projectId,
      tenantId: spec.projectId,
      garmentId: spec.garmentId,
      specificationRevisionId: spec.specificationRevisionId,
      specificationVersion: spec.version,
      canonicalSpecificationFingerprint: canonicalFingerprint,
      approvalEventId: eventId,
      approverPrincipal: options.approverId?.trim() || trimmedApprover,
      authorityTier: 'cryptographic_principal',
      approvalScope: 'specification:approve',
      approvalTimestamp: approvedAt,
      keyId: candidateSignature.keyId,
      algorithm: 'Ed25519'
    };

    let cryptoResult: CryptographicVerificationResult;
    try {
      if (typeof options.cryptographicVerifier.verifySignature === 'function') {
        cryptoResult = options.cryptographicVerifier.verifySignature(
          candidateSignature,
          expectedSigningPayload
        );
      } else {
        cryptoResult = options.cryptographicVerifier.verifyApprovalSignature(
          candidateSignature,
          expectedSigningPayload
        );
      }
    } catch (err) {
      throw new ProductionSnapshotValidationError(
        `Specification approval rejected: TrustedCryptographicVerifier threw an exception (${err instanceof Error ? err.message : String(err)}).`,
        ['cryptographicVerifier']
      );
    }

    if (!cryptoResult || (!cryptoResult.isValid && !cryptoResult.verified)) {
      throw new ProductionSnapshotValidationError(
        `Cryptographic signature verification failed: ${cryptoResult?.reason ?? 'invalid signature'}.`,
        ['cryptographicSignature']
      );
    }

    resolvedApproverId = cryptoResult.verifiedPrincipal ?? resolvedApproverId;
    verifiedSignature = {
      ...candidateSignature,
      publicKeyHex: cryptoResult.verifiedPublicKeyHex ?? candidateSignature.publicKeyHex
    };
  }

  const approvalProvenance: SpecificationValueProvenance =
    options.provenance ??
    (authorityTier === 'demonstration_fixture'
      ? 'demonstration-fixture'
      : authorityTier === 'unauthenticated_local_session'
        ? 'unauthenticated-local-approval'
        : 'designer-approved');

  const approvalEvent: SpecificationApprovalEvent = {
    id: eventId,
    eventId,
    eventType: 'approval',
    targetRevisionId: spec.specificationRevisionId,
    specificationRevisionId: spec.specificationRevisionId,
    specificationVersion: spec.version,
    targetSpecificationFingerprint: canonicalFingerprint,
    canonicalContentFingerprint: canonicalFingerprint,
    approverId: resolvedApproverId,
    approverName: trimmedApprover,
    authorityTier,
    approvedAt,
    notes: options.notes,
    provenance: approvalProvenance,
    verifiedIdentity,
    cryptographicSignature: verifiedSignature
  };

  const approvalRecord: SpecificationApprovalRecord = {
    eventId,
    eventType: 'approval',
    approverId: resolvedApproverId,
    approverName: trimmedApprover,
    authorityTier,
    approvedAt,
    targetRevisionId: spec.specificationRevisionId,
    specificationRevisionId: spec.specificationRevisionId,
    specificationVersion: spec.version,
    targetSpecificationFingerprint: canonicalFingerprint,
    canonicalContentFingerprint: canonicalFingerprint,
    notes: options.notes,
    provenance: approvalProvenance,
    verifiedIdentity,
    cryptographicSignature: verifiedSignature
  };

  const priorHistory: SpecificationLifecycleEvent[] = Array.isArray(spec.approvalHistory)
    ? [...spec.approvalHistory]
    : [];

  return {
    ...spec,
    updatedAt: approvedAt,
    isApproved: true,
    approvalState: 'approved',
    approvalAuthorityTier: authorityTier,
    approvedBy: trimmedApprover,
    approvedAt,
    approvedContentFingerprint: canonicalFingerprint,
    approvalProvenance,
    approvalRecord,
    revocationRecord: undefined,
    verifiedIdentity,
    cryptographicSignature: verifiedSignature,
    approvalHistory: [...priorHistory, approvalEvent],
    isProductionReady: false
  };
}

/**
 * Revokes an existing specification approval, appending an immutable
 * `SpecificationRevocationEvent` to `approvalHistory` without erasing prior events.
 */
export function revokeAuthoritativeGarmentSpecificationApproval(
  specInput: AuthoritativeGarmentSpecification | DesignSpecification,
  reason: string,
  options: { revokerName?: string; revokerId?: string; revokedAt?: string } = {}
): AuthoritativeGarmentSpecification {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new ProductionSnapshotValidationError(
      'Revocation reason is mandatory and cannot be empty.',
      ['reason']
    );
  }

  const spec = ensureAuthoritativeSpec(specInput);
  const canonicalFp = computeSpecificationFingerprint(spec);
  const revokedAt = options.revokedAt ?? new Date().toISOString();
  const revokerName = options.revokerName?.trim() || 'System Operator';
  const revokerId = options.revokerId?.trim() || revokerName;
  const priorHistory: SpecificationLifecycleEvent[] = Array.isArray(spec.approvalHistory)
    ? [...spec.approvalHistory]
    : [];

  const eventId = `evt-rev-${spec.specificationRevisionId}-${priorHistory.length + 1}`;
  const revocationRecord: SpecificationRevocationEvent = {
    id: eventId,
    eventId,
    eventType: 'revocation',
    originalApprovalEventId: spec.approvalRecord?.eventId,
    revokedApprovalEventId: spec.approvalRecord?.eventId,
    targetRevisionId: spec.specificationRevisionId,
    specificationRevisionId: spec.specificationRevisionId,
    specificationVersion: spec.version,
    targetSpecificationFingerprint: canonicalFp,
    revokerId,
    revokerName,
    authorityTier: spec.approvalAuthorityTier ?? 'unauthenticated_local_session',
    revokedAt,
    reason: reason.trim()
  };

  const revocationNote = `[Approval revoked: ${reason.trim()} by ${revokerName} at ${revokedAt}]`;
  const updatedNotes = Array.isArray(spec.designNotes)
    ? [...spec.designNotes, revocationNote]
    : [revocationNote];

  return {
    ...spec,
    updatedAt: revokedAt,
    isApproved: false,
    approvalState: 'revoked',
    designNotes: updatedNotes,
    revocationRecord,
    approvalHistory: [...priorHistory, revocationRecord],
    isProductionReady: false
  };
}

/**
 * Independently verifies the approval state, content fingerprint, append-only lifecycle history,
 * and authority tier evidence of an `AuthoritativeGarmentSpecification` or `DesignSpecification`.
 */
export function verifySpecificationApproval(
  specInput: AuthoritativeGarmentSpecification | DesignSpecification,
  verificationContext?: SpecificationApprovalVerificationContext
): SpecificationApprovalVerificationResult {
  let spec: AuthoritativeGarmentSpecification;
  let canonicalFingerprint: string;
  try {
    spec = ensureAuthoritativeSpec(specInput);
    canonicalFingerprint = computeSpecificationFingerprint(specInput);
  } catch (err) {
    return {
      isValid: false,
      state: 'invalid',
      canonicalFingerprint: '',
      reason: `Specification canonicalization failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  // 1. Check superseded state
  if (spec.approvalState === 'superseded' || Boolean(spec.supersededByRevisionId)) {
    return {
      isValid: false,
      state: 'superseded',
      canonicalFingerprint,
      recordedFingerprint: spec.approvedContentFingerprint,
      reason: `Specification revision "${spec.specificationRevisionId}" has been superseded by "${String(spec.supersededByRevisionId)}".`
    };
  }

  // 2. Inspect append-only approvalHistory for latest event
  const history = Array.isArray(spec.approvalHistory) ? spec.approvalHistory : [];
  const latestEvent = history.length > 0 ? history[history.length - 1] : undefined;

  if (
    spec.approvalState === 'revoked' ||
    Boolean(spec.revocationRecord) ||
    latestEvent?.eventType === 'revocation'
  ) {
    const revReason =
      spec.revocationRecord?.reason ??
      (latestEvent?.eventType === 'revocation' ? latestEvent.reason : undefined) ??
      spec.approvalRecord?.revocationReason ??
      'Approval was revoked.';
    return {
      isValid: false,
      state: 'revoked',
      canonicalFingerprint,
      recordedFingerprint: spec.approvedContentFingerprint,
      reason: `Specification approval was revoked: ${revReason}`
    };
  }

  // 3. Check draft / unapproved state
  if (!spec.isApproved || spec.approvalState !== 'approved' || !spec.approvalRecord) {
    return {
      isValid: false,
      state: 'draft',
      canonicalFingerprint,
      reason: 'Specification is in draft state and has no active approval record.'
    };
  }

  const record = spec.approvalRecord;
  const recordedRevId = record.specificationRevisionId ?? record.targetRevisionId;
  const recordedFp = record.canonicalContentFingerprint ?? record.targetSpecificationFingerprint;

  // 4. Verify revision & version linkage
  if (
    recordedRevId !== spec.specificationRevisionId ||
    (record.specificationVersion !== undefined && record.specificationVersion !== spec.version)
  ) {
    return {
      isValid: false,
      state: 'invalid',
      canonicalFingerprint,
      recordedFingerprint: recordedFp,
      reason: 'Approval record revisionId or version does not match the specification.'
    };
  }

  // 5. Verify canonical content fingerprint against recorded fingerprint
  if (
    recordedFp !== canonicalFingerprint ||
    (spec.approvedContentFingerprint && spec.approvedContentFingerprint !== canonicalFingerprint)
  ) {
    return {
      isValid: false,
      state: 'invalid',
      canonicalFingerprint,
      recordedFingerprint: recordedFp,
      reason:
        'Specification content fingerprint mismatch: specification engineering parameters were modified after approval.'
    };
  }

  // 6. Verify approver identity consistency
  if (
    typeof record.approverName !== 'string' ||
    record.approverName.trim().length === 0 ||
    (spec.approvedBy && spec.approvedBy.trim() !== record.approverName.trim())
  ) {
    return {
      isValid: false,
      state: 'invalid',
      canonicalFingerprint,
      recordedFingerprint: recordedFp,
      reason: 'Specification approver identity mismatch or blank approverName.'
    };
  }

  const tier: ApprovalAuthorityTier =
    spec.approvalAuthorityTier ?? record.authorityTier ?? 'unauthenticated_local_session';
  if (spec.approvalAuthorityTier && spec.approvalAuthorityTier !== record.authorityTier) {
    return {
      isValid: false,
      state: 'invalid',
      canonicalFingerprint,
      recordedFingerprint: recordedFp,
      reason: 'Specification approvalAuthorityTier disagrees with approvalRecord.authorityTier.'
    };
  }

  // 7. Tier-specific cryptographic & identity verification
  if (tier === 'authenticated_designer') {
    const idProv = spec.verifiedIdentity ?? record.verifiedIdentity;
    if (!idProv || idProv.verificationMethod !== 'OIDC-JWT-EdDSA') {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        recordedFingerprint: recordedFp,
        reason:
          'authenticated_designer authority tier is unavailable without verified OIDC-JWT-EdDSA identity provenance.'
      };
    }

    if (
      !idProv.targetSpecificationId ||
      idProv.targetSpecificationId !== spec.garmentId
    ) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        recordedFingerprint: recordedFp,
        reason: 'Verified identity provenance targetSpecificationId is missing or does not match specification garmentId.'
      };
    }
    if (
      !idProv.targetRevisionId ||
      idProv.targetRevisionId !== spec.specificationRevisionId
    ) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        recordedFingerprint: recordedFp,
        reason: 'Verified identity provenance targetRevisionId is missing or does not match specificationRevisionId.'
      };
    }
    if (
      !idProv.targetSpecificationFingerprint ||
      idProv.targetSpecificationFingerprint.toLowerCase() !== canonicalFingerprint.toLowerCase()
    ) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        recordedFingerprint: recordedFp,
        reason: 'Verified identity provenance targetSpecificationFingerprint is missing or does not match canonical specification fingerprint.'
      };
    }

    if (
      !verificationContext?.identityVerifier ||
      (typeof verificationContext.identityVerifier.verifyCredential !== 'function' &&
        typeof verificationContext.identityVerifier.verifyIdentityCredential !== 'function')
    ) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        recordedFingerprint: recordedFp,
        reason:
          'authenticated_designer approval cannot be verified without an active TrustedIdentityVerifier in verificationContext.'
      };
    }

    if (verificationContext.identityCredential) {
      const reverifyBinding = {
        recordedTokenDigest: idProv.tokenDigest,
        recordedJti: idProv.jti ?? idProv.tokenId,
        recordedSpecificationId: spec.garmentId,
        recordedRevisionId: spec.specificationRevisionId,
        recordedSpecificationFingerprint: canonicalFingerprint
      };
      let reverify: IdentityVerificationResult;
      try {
        if (typeof verificationContext.identityVerifier.verifyCredential === 'function') {
          reverify = verificationContext.identityVerifier.verifyCredential(
            verificationContext.identityCredential,
            {
              expectedSpecificationId: spec.garmentId,
              expectedRevisionId: spec.specificationRevisionId,
              expectedSpecificationFingerprint: canonicalFingerprint,
              expectedApprover: record.approverName,
              approvalTimestamp: record.approvedAt,
              requireTargetBinding: true,
              reverifyRecordedApproval: reverifyBinding
            }
          );
        } else {
          reverify = verificationContext.identityVerifier.verifyIdentityCredential!(
            verificationContext.identityCredential,
            {
              expectedSpecificationId: spec.garmentId,
              targetRevisionId: spec.specificationRevisionId,
              targetSpecificationFingerprint: canonicalFingerprint,
              expectedApprover: record.approverName,
              approvalTimestamp: record.approvedAt,
              reverifyRecordedApproval: reverifyBinding
            }
          );
        }
      } catch (err) {
        return {
          isValid: false,
          state: 'invalid',
          authorityTier: tier,
          authorityClassification: tier,
          isApprovalAuthenticated: false,
          isApprovalCryptographicallySigned: false,
          canonicalFingerprint,
          reason: `TrustedIdentityVerifier threw an exception: ${err instanceof Error ? err.message : String(err)}`
        };
      }
      const reverifiedSub = reverify.verifiedSubjectId ?? reverify.provenance?.subjectId;
      if (!reverify.isValid || reverifiedSub !== idProv.subjectId) {
        return {
          isValid: false,
          state: 'invalid',
          authorityTier: tier,
          authorityClassification: tier,
          isApprovalAuthenticated: false,
          isApprovalCryptographicallySigned: false,
          canonicalFingerprint,
          reason: `Re-verification of OIDC/JWT identity credential failed: ${reverify.reason ?? 'subject mismatch'}`
        };
      }
    }
  } else if (tier === 'cryptographic_principal') {
    const sig = spec.cryptographicSignature ?? record.cryptographicSignature;
    if (!sig) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        recordedFingerprint: recordedFp,
        reason:
          'cryptographic_principal authority tier is unavailable without a VerifiableCryptographicSignature.'
      };
    }

    if (!verificationContext?.cryptographicVerifier) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        recordedFingerprint: recordedFp,
        reason:
          'cryptographic_principal authority tier is unavailable without an active TrustedCryptographicVerifier in verificationContext.'
      };
    }

    const expectedPayload: CanonicalApprovalSigningPayload = {
      schemaVersion: spec.schemaVersion || SPECIFICATION_CANONICAL_SCHEMA_VERSION,
      projectId: spec.projectId,
      tenantId: spec.projectId,
      garmentId: spec.garmentId,
      specificationRevisionId: spec.specificationRevisionId,
      specificationVersion: spec.version,
      canonicalSpecificationFingerprint: canonicalFingerprint,
      approvalEventId: record.eventId ?? `evt-app-${spec.specificationRevisionId}-1`,
      approverPrincipal: record.approverId || record.approverName,
      authorityTier: 'cryptographic_principal',
      approvalScope: 'specification:approve',
      approvalTimestamp: record.approvedAt,
      keyId: sig.keyId,
      algorithm: 'Ed25519'
    };

    let cryptoRes: CryptographicVerificationResult;
    try {
      cryptoRes = verificationContext.cryptographicVerifier.verifySignature(sig, expectedPayload);
    } catch (err) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        reason: `TrustedCryptographicVerifier threw an exception: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    if (!cryptoRes.isValid && !cryptoRes.verified) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        recordedFingerprint: recordedFp,
        reason: `Cryptographic signature re-verification failed: ${cryptoRes.reason ?? 'invalid signature'}`
      };
    }
  }

  if (latestEvent && latestEvent.eventType === 'approval') {
    const latestFp = latestEvent.canonicalContentFingerprint ?? latestEvent.targetSpecificationFingerprint;
    if (
      latestEvent.approverName !== record.approverName ||
      (latestEvent.approverId && record.approverId && latestEvent.approverId !== record.approverId) ||
      latestFp !== recordedFp ||
      latestEvent.authorityTier !== record.authorityTier
    ) {
      return {
        isValid: false,
        state: 'invalid',
        authorityTier: tier,
        authorityClassification: tier,
        isApprovalAuthenticated: false,
        isApprovalCryptographicallySigned: false,
        canonicalFingerprint,
        recordedFingerprint: recordedFp,
        reason: 'Specification approvalRecord approver identity mismatch against append-only approvalHistory.'
      };
    }
  }

  return {
    isValid: true,
    state: 'approved',
    authorityTier: tier,
    authorityClassification: tier,
    isApprovalAuthenticated: tier === 'authenticated_designer',
    isApprovalCryptographicallySigned: tier === 'cryptographic_principal',
    canonicalFingerprint,
    recordedFingerprint: recordedFp,
    approverName: record.approverName,
    approvedAt: record.approvedAt,
    verifiedIdentity: spec.verifiedIdentity ?? record.verifiedIdentity,
    cryptographicSignature: spec.cryptographicSignature ?? record.cryptographicSignature
  };
}

// ============================================================================
// BIDIRECTIONAL CONVERSION WITH UI DesignSpecification
// ============================================================================

/**
 * Converts an `AuthoritativeGarmentSpecification` into a `DesignSpecification`
 * while preserving all revision, fingerprint, provenance, and approval lineage fields.
 */
export function convertToDesignSpecification(
  spec: AuthoritativeGarmentSpecification
): DesignSpecification {
  const canonicalFp = computeSpecificationFingerprint(spec);
  return {
    id: spec.garmentId,
    projectId: spec.projectId,
    specificationRevisionId: spec.specificationRevisionId,
    version: spec.version,
    specificationVersion: spec.version,
    specificationFingerprint: canonicalFp,
    previousRevisionId: spec.previousRevisionId ?? spec.parentRevisionId,
    supersededByRevisionId: spec.supersededByRevisionId,
    name: spec.name,
    garmentCategory: spec.garmentCategory,
    silhouette: spec.silhouette,
    prompt: spec.prompt ?? '',
    fabric: spec.fabric,
    fabricRevision: spec.fabricRevision,
    fabricProvenance: spec.fabricProvenance,
    color: spec.color ?? { name: 'Atelier Charcoal', hex: '#1E1E24' },
    easeProfile: spec.easeProfile,
    sleeveEaseStrategy: spec.sleeveEaseStrategy,
    dartStyle: spec.dartStyle,
    waistband: spec.waistband,
    lengthCm: spec.lengthCm ?? spec.targetFinishedDimensions.lengthCm,
    targetFinishedDimensions: { ...spec.targetFinishedDimensions },
    explicitEaseCm: spec.explicitEaseCm ? { ...spec.explicitEaseCm } : undefined,
    allowances: { ...spec.allowances },
    constructionFeatures: spec.constructionFeatures.map(cf => ({ ...cf })),
    designNotes: [...spec.designNotes],
    fieldProvenance: spec.fieldProvenance ? { ...spec.fieldProvenance } : undefined,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
    isApproved: spec.isApproved,
    approvalState: spec.approvalState,
    approvalAuthorityTier: spec.approvalAuthorityTier,
    approvedBy: spec.approvedBy,
    approvedAt: spec.approvedAt,
    approvedContentFingerprint: spec.approvedContentFingerprint,
    approvalRecord: spec.approvalRecord,
    revocationRecord: spec.revocationRecord,
    approvalHistory: spec.approvalHistory ? [...spec.approvalHistory] : [],
    verifiedIdentity: spec.verifiedIdentity,
    cryptographicSignature: spec.cryptographicSignature,
    aiEstimates: spec.aiEstimates,
    isProductionReady: false
  } as DesignSpecification;
}

/**
 * Lifts a `DesignSpecification` into an `AuthoritativeGarmentSpecification`
 * without silently inventing missing engineering fields or promoting unverified approvals.
 */
export function convertFromDesignSpecification(
  designSpec: DesignSpecification,
  options?: { readonly projectId?: string }
): AuthoritativeGarmentSpecification {
  const raw = designSpec as unknown as Partial<AuthoritativeGarmentSpecification> & DesignSpecification;
  const effectiveProjectId = options?.projectId || raw.projectId || 'project-patroner-default';

  if (
    raw.specificationRevisionId &&
    typeof raw.version === 'number' &&
    raw.targetFinishedDimensions &&
    raw.allowances
  ) {
    return {
      ...raw,
      garmentId: raw.garmentId || designSpec.id,
      projectId: effectiveProjectId,
      lengthCm: raw.lengthCm ?? raw.targetFinishedDimensions.lengthCm,
      approvalProvenance: raw.approvalProvenance ?? 'unknown',
      engineProvenance: raw.engineProvenance ?? DEFAULT_ENGINE_PROVENANCE,
      approvalHistory: Array.isArray(raw.approvalHistory) ? [...raw.approvalHistory] : [],
      isProductionReady: false
    } as AuthoritativeGarmentSpecification;
  }

  const base = createAuthoritativeGarmentSpecification({
    projectId: effectiveProjectId,
    garmentId: designSpec.id,
    specificationRevisionId:
      raw.specificationRevisionId ||
      `spec-${designSpec.id}-v${(raw as { specificationVersion?: number }).specificationVersion ?? 1}`,
    version: (raw as { specificationVersion?: number }).specificationVersion ?? 1,
    previousRevisionId: raw.previousRevisionId ?? raw.parentRevisionId,
    name: designSpec.name,
    garmentCategory: designSpec.garmentCategory ?? 'skirt',
    silhouette: designSpec.silhouette,
    prompt: designSpec.prompt,
    fabric: designSpec.fabric,
    fabricRevision: raw.fabricRevision,
    fabricProvenance: raw.fabricProvenance,
    color: designSpec.color,
    easeProfile: designSpec.easeProfile,
    sleeveEaseStrategy: designSpec.sleeveEaseStrategy,
    dartStyle: designSpec.dartStyle,
    waistband: (designSpec as { waistband?: string }).waistband,
    lengthCm: designSpec.lengthCm,
    targetFinishedDimensions: raw.targetFinishedDimensions,
    explicitEaseCm: designSpec.explicitEaseCm,
    allowances: raw.allowances,
    constructionFeatures: designSpec.constructionFeatures,
    designNotes: designSpec.designNotes,
    fieldProvenance: raw.fieldProvenance,
    aiEstimates: designSpec.aiEstimates,
    createdAt: designSpec.createdAt
  });

  if (raw.supersededByRevisionId || raw.approvalState === 'superseded') {
    return {
      ...base,
      isApproved: false,
      approvalState: 'superseded',
      supersededByRevisionId: raw.supersededByRevisionId
    };
  }

  if (raw.approvalState === 'revoked' || raw.revocationRecord) {
    return {
      ...base,
      isApproved: false,
      approvalState: 'revoked',
      revocationRecord: raw.revocationRecord,
      approvalHistory: Array.isArray(raw.approvalHistory) ? [...raw.approvalHistory] : []
    };
  }

  if (designSpec.isApproved && designSpec.approvedBy) {
    if (raw.approvalRecord) {
      return {
        ...base,
        isApproved: true,
        approvalState: 'approved',
        approvalAuthorityTier: raw.approvalAuthorityTier ?? raw.approvalRecord.authorityTier,
        approvedBy: designSpec.approvedBy,
        approvedAt: designSpec.approvedAt ?? raw.approvalRecord.approvedAt,
        approvedContentFingerprint:
          raw.approvedContentFingerprint ??
          raw.approvalRecord.canonicalContentFingerprint ??
          raw.approvalRecord.targetSpecificationFingerprint,
        approvalRecord: raw.approvalRecord,
        verifiedIdentity: raw.verifiedIdentity ?? raw.approvalRecord.verifiedIdentity,
        cryptographicSignature: raw.cryptographicSignature ?? raw.approvalRecord.cryptographicSignature,
        approvalHistory: Array.isArray(raw.approvalHistory)
          ? [...raw.approvalHistory]
          : []
      };
    }

    const tier: ApprovalAuthorityTier =
      raw.approvalAuthorityTier === 'demonstration_fixture'
        ? 'demonstration_fixture'
        : 'unauthenticated_local_session';

    return approveAuthoritativeGarmentSpecification(base, designSpec.approvedBy, {
      authorityTier: tier,
      approvedAt: designSpec.approvedAt ?? designSpec.createdAt
    });
  }

  return base;
}

export { computeCanonicalSha256 };
export type { ApprovalVerificationContext };
