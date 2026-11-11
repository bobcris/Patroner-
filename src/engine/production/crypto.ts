/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Patroner Hardened Cryptographic Primitives (Milestone 04.6.2.3.4)
 *
 * Uses audited @noble/ed25519 and @noble/hashes implementations:
 * 1. NIST FIPS 180-4 SHA-256 & SHA-512 (@noble/hashes/sha2.js)
 * 2. RFC 8032 Ed25519 asymmetric signing and strict public-key-only verification
 *    with small-order torsion point rejection (FINDING-01..FINDING-05)
 * 3. RFC 4648 Base64URL encoding/decoding and RFC 7515 / OIDC Compact JWT (EdDSA) signing
 * 4. Canonical JSON serialization with Unicode NFC normalization (FINDING-13)
 */

import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';

// Configure synchronous SHA-512 for @noble/ed25519
ed.hashes.sha512 = ((message: Uint8Array) => sha512(message)) as typeof ed.hashes.sha512;

const ED25519_P = (1n << 255n) - 19n;
const ED25519_L = (1n << 252n) + 27742317777372353535851937790883648493n;

/**
 * Exhaustive set of all 8 torsion points of order dividing 8 on Edwards25519 (RFC 8032).
 * Any public key or signature R commitment matching these encodings is strictly rejected
 * to prevent cofactor-clearing universal signature forgery (FINDING-02, FINDING-03).
 */
export const ED25519_TORSION_PUBLIC_KEYS: ReadonlySet<string> = new Set<string>([
  // Order 1 (Neutral / Identity element (0, 1))
  '0100000000000000000000000000000000000000000000000000000000000000',
  // Order 2 ((0, -1))
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  // Order 4 ((+sqrt(-1), 0) and (-sqrt(-1), 0))
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000080',
  // Order 8 (4 points)
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa'
]);

export function encodeUtf8Bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export const utf8ToBytes = encodeUtf8Bytes;

export function decodeUtf8Bytes(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Invalid hex string.');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Computes the SHA-256 digest of a UTF-8 string or raw byte array, returning a 64-character lowercase hex string.
 */
export function sha256Hex(input: string | Uint8Array): string {
  const data = typeof input === 'string' ? encodeUtf8Bytes(input) : input;
  return bytesToHex(sha256(data));
}

/**
 * Computes the 64-byte SHA-512 digest of a byte array.
 */
export function sha512Bytes(data: Uint8Array): Uint8Array {
  return sha512(data);
}

/**
 * Computes the 128-character lowercase hex SHA-512 digest of a UTF-8 string or byte array.
 */
export function sha512Hex(input: string | Uint8Array): string {
  const data = typeof input === 'string' ? encodeUtf8Bytes(input) : input;
  return bytesToHex(sha512(data));
}

function bytesToLittleEndianBigInt(bytes: Uint8Array): bigint {
  let res = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    res = (res << 8n) | BigInt(bytes[i]);
  }
  return res;
}

/**
 * Strictly validates that a 32-byte array is a canonical, on-curve, non-small-order
 * Ed25519 point encoding per RFC 8032 §5.1.3 (FINDING-02, FINDING-03, FINDING-04).
 */
export function isValidEd25519PublicKeyBytes(pubBytes: Uint8Array): boolean {
  try {
    if (!(pubBytes instanceof Uint8Array) || pubBytes.length !== 32) {
      return false;
    }
    const lowerHex = bytesToHex(pubBytes);
    if (ED25519_TORSION_PUBLIC_KEYS.has(lowerHex)) {
      return false;
    }

    // Check canonical y < p and reject negative zero (x == 0 with sign bit 1 -> y == 1 with sign bit 1)
    const signBit = (pubBytes[31] >>> 7) & 1;
    const yCopy = new Uint8Array(pubBytes);
    yCopy[31] &= 0x7f;
    const y = bytesToLittleEndianBigInt(yCopy);
    if (y >= ED25519_P) {
      return false;
    }
    if (y === 1n && signBit === 1) {
      return false;
    }

    const pt = ed.Point.fromHex(lowerHex);
    if (pt.isSmallOrder()) {
      return false;
    }
    // Enforce strict canonical re-encoding match
    if (pt.toHex() !== lowerHex) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Strictly validates that a 64-character hex string is a canonical, on-curve,
 * non-small-order Ed25519 public key (FINDING-02, FINDING-04).
 */
export function isValidEd25519PublicKey(publicKeyHex: string): boolean {
  if (typeof publicKeyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) {
    return false;
  }
  return isValidEd25519PublicKeyBytes(hexToBytes(publicKeyHex.toLowerCase()));
}

export interface Ed25519KeyPair {
  readonly privateKeyHex: string;
  readonly publicKeyHex: string;
  readonly publicKeyBase64Url: string;
  readonly publicKeyFingerprint: string;
  readonly algorithm: 'Ed25519';
}

/**
 * Computes a deterministic SHA-256 fingerprint of an Ed25519 public key (64-char hex).
 */
export function computeEd25519PublicKeyFingerprint(publicKeyHex: string): string {
  return sha256Hex(`ed25519-spki-v1:${publicKeyHex.trim().toLowerCase()}`);
}

/**
 * Derives an RFC 8032 Ed25519 keypair from an exact 32-byte (64-char hex) raw seed (FINDING-05).
 */
export function generateEd25519KeyPairFromRawSeedHex(rawSeedHex: string): Ed25519KeyPair {
  if (typeof rawSeedHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(rawSeedHex)) {
    throw new Error('Ed25519 raw seed must be a 64-character hexadecimal string (32 bytes).');
  }
  const seedBytes = hexToBytes(rawSeedHex.toLowerCase());
  const pubBytes = ed.getPublicKey(seedBytes);
  const publicKeyHex = bytesToHex(pubBytes);
  const privateKeyHex = bytesToHex(seedBytes);

  return Object.freeze({
    privateKeyHex,
    publicKeyHex,
    publicKeyBase64Url: base64UrlEncodeBytes(pubBytes),
    publicKeyFingerprint: computeEd25519PublicKeyFingerprint(publicKeyHex),
    algorithm: 'Ed25519' as const
  });
}

/**
 * Derives an RFC 8032 Ed25519 keypair deterministically from a symbolic passphrase string (FINDING-05).
 */
export function generateEd25519KeyPairFromPassphrase(passphrase: string): Ed25519KeyPair {
  if (typeof passphrase !== 'string' || passphrase.trim().length === 0) {
    throw new Error('Ed25519 seed passphrase must be a non-empty string.');
  }
  const derivedSeedHex = sha256Hex(`ed25519-seed-v1:${passphrase}`);
  return generateEd25519KeyPairFromRawSeedHex(derivedSeedHex);
}

/**
 * Derives an RFC 8032 Ed25519 keypair from either a 64-char hex private seed or a string seed phrase.
 * Supports explicit `options.inputFormat` (`'raw-seed-hex' | 'passphrase' | 'auto'`) to prevent ambiguity (FINDING-05).
 */
export function generateEd25519KeyPairFromSeed(
  seedOrHex: string,
  options?: { inputFormat?: 'raw-seed-hex' | 'passphrase' | 'auto' }
): Ed25519KeyPair {
  if (!seedOrHex || typeof seedOrHex !== 'string' || seedOrHex.trim() === '') {
    throw new Error('Ed25519 private key seed must be a non-empty string.');
  }
  const mode = options?.inputFormat ?? 'auto';
  if (mode === 'raw-seed-hex') {
    return generateEd25519KeyPairFromRawSeedHex(seedOrHex);
  }
  if (mode === 'passphrase') {
    return generateEd25519KeyPairFromPassphrase(seedOrHex);
  }
  if (seedOrHex.length === 64 && /^[0-9a-fA-F]{64}$/.test(seedOrHex)) {
    return generateEd25519KeyPairFromRawSeedHex(seedOrHex);
  }
  return generateEd25519KeyPairFromPassphrase(seedOrHex);
}

/**
 * Signs arbitrary raw bytes (`Uint8Array`) using an RFC 8032 Ed25519 private key seed (FINDING-01).
 * Returns the 128-character lowercase hex signature (64 bytes: R || S).
 */
export function signEd25519Bytes(
  messageBytes: Uint8Array,
  privateKeySeedOrHex: string
): string {
  if (!(messageBytes instanceof Uint8Array)) {
    throw new Error('signEd25519Bytes requires a Uint8Array message.');
  }
  const keyPair = generateEd25519KeyPairFromSeed(privateKeySeedOrHex);
  const seedBytes = hexToBytes(keyPair.privateKeyHex);
  const sigBytes = ed.sign(messageBytes, seedBytes);
  return bytesToHex(sigBytes);
}

/**
 * Signs a UTF-8 message or raw `Uint8Array` using an RFC 8032 Ed25519 private key seed (hex or seed string).
 * Returns an object containing `signatureHex` (128-char lowercase hex), `publicKeyHex`, and `publicKeyFingerprint`.
 */
export function signEd25519Message(
  message: string | Uint8Array,
  privateKeySeedOrHex: string
): {
  readonly signatureHex: string;
  readonly publicKeyHex: string;
  readonly publicKeyFingerprint: string;
} {
  const keyPair = generateEd25519KeyPairFromSeed(privateKeySeedOrHex);
  const seedBytes = hexToBytes(keyPair.privateKeyHex);
  const msgBytes = typeof message === 'string' ? encodeUtf8Bytes(message) : message;
  const sigBytes = ed.sign(msgBytes, seedBytes);
  const signatureHex = bytesToHex(sigBytes);

  return {
    signatureHex,
    publicKeyHex: keyPair.publicKeyHex,
    publicKeyFingerprint: keyPair.publicKeyFingerprint
  };
}

/**
 * Verifies an RFC 8032 Ed25519 signature over raw `Uint8Array` message bytes using ONLY the 32-byte public key (64-char hex).
 *
 * Enforces strict RFC 8032 / NIST SP 800-186 verification rules (`zip215: false`):
 * - Rejects all 8 small-order torsion public keys A (`ED25519_TORSION_PUBLIC_KEYS`, `FINDING-02`)
 * - Rejects all 8 small-order torsion commitment points R (`FINDING-03`)
 * - Rejects non-canonical point encodings (`y >= p` or `x == 0, sign == 1`)
 * - Rejects non-canonical scalars `S >= L`
 */
export function verifyEd25519Bytes(
  messageBytes: Uint8Array,
  signatureHex: string,
  publicKeyHex: string
): boolean {
  try {
    if (!(messageBytes instanceof Uint8Array)) {
      return false;
    }
    if (typeof publicKeyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) {
      return false;
    }
    if (typeof signatureHex !== 'string' || !/^[0-9a-fA-F]{128}$/.test(signatureHex)) {
      return false;
    }

    const pubHexLower = publicKeyHex.toLowerCase();
    const sigHexLower = signatureHex.toLowerCase();

    // 1. Validate public key A (rejects torsion points, off-curve points, and non-canonical encodings)
    const pubBytes = hexToBytes(pubHexLower);
    if (!isValidEd25519PublicKeyBytes(pubBytes)) {
      return false;
    }

    // 2. Validate signature commitment point R and scalar S < L
    const sigBytes = hexToBytes(sigHexLower);
    const rBytes = sigBytes.slice(0, 32);
    const sBytes = sigBytes.slice(32, 64);

    if (!isValidEd25519PublicKeyBytes(rBytes)) {
      return false;
    }

    const S = bytesToLittleEndianBigInt(sBytes);
    if (S < 0n || S >= ED25519_L) {
      return false;
    }

    // 3. Perform strict RFC 8032 verification (zip215: false) via @noble/ed25519
    return ed.verify(sigBytes, messageBytes, pubBytes, { zip215: false });
  } catch {
    return false;
  }
}

/**
 * Verifies an RFC 8032 Ed25519 signature using ONLY the 32-byte public key (64-char hex).
 * Never requires, accesses, or accepts private key material.
 *
 * Supports both `(publicKeyHex, message, signatureHex)` and `(message, signatureHex, publicKeyHex)` call conventions,
 * as well as `string | Uint8Array` messages (`FINDING-01`..`FINDING-04`).
 */
export function verifyEd25519Signature(
  firstArg: string | Uint8Array,
  secondArg: string | Uint8Array,
  thirdArg: string
): boolean {
  try {
    // Convention B: (message: string | Uint8Array, signatureHex: 128-hex, publicKeyHex: 64-hex)
    if (
      typeof secondArg === 'string' &&
      /^[0-9a-fA-F]{128}$/.test(secondArg) &&
      typeof thirdArg === 'string' &&
      /^[0-9a-fA-F]{64}$/.test(thirdArg) &&
      !(typeof firstArg === 'string' && /^[0-9a-fA-F]{64}$/.test(firstArg) && /^[0-9a-fA-F]{128}$/.test(thirdArg))
    ) {
      const msgBytes = typeof firstArg === 'string' ? encodeUtf8Bytes(firstArg) : firstArg;
      return verifyEd25519Bytes(msgBytes, secondArg, thirdArg);
    }

    // Primary Convention A: (publicKeyHex: 64-hex, message: string | Uint8Array, signatureHex: 128-hex)
    if (typeof firstArg !== 'string') {
      return false;
    }
    const msgBytes = typeof secondArg === 'string' ? encodeUtf8Bytes(secondArg) : secondArg;
    return verifyEd25519Bytes(msgBytes, thirdArg, firstArg);
  } catch {
    return false;
  }
}

// ============================================================================
// RFC 4648 Base64URL & RFC 7515 / OIDC JWT (EdDSA) Helpers
// ============================================================================

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;

    out += B64_CHARS[b0 >>> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >>> 4)];
    if (i + 1 < bytes.length) {
      out += B64_CHARS[((b1 & 0x0f) << 2) | (b2 >>> 6)];
    }
    if (i + 2 < bytes.length) {
      out += B64_CHARS[b2 & 0x3f];
    }
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlEncodeUtf8(str: string): string {
  return base64UrlEncodeBytes(encodeUtf8Bytes(str));
}

export function base64UrlDecodeBytes(b64url: string): Uint8Array {
  if (typeof b64url !== 'string' || !/^[A-Za-z0-9\-_]*$/.test(b64url)) {
    throw new Error('Invalid Base64URL string.');
  }
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (b64.length % 4)) % 4;
  if (b64.length % 4 === 1) {
    throw new Error('Invalid Base64URL length.');
  }
  const padded = b64 + '='.repeat(padLen);
  const out: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    const c0 = B64_CHARS.indexOf(padded[i]);
    const c1 = B64_CHARS.indexOf(padded[i + 1]);
    const c2 = padded[i + 2] === '=' ? -1 : B64_CHARS.indexOf(padded[i + 2]);
    const c3 = padded[i + 3] === '=' ? -1 : B64_CHARS.indexOf(padded[i + 3]);
    if (c0 < 0 || c1 < 0) throw new Error('Invalid Base64URL character.');
    out.push((c0 << 2) | (c1 >>> 4));
    if (c2 >= 0) {
      out.push(((c1 & 0x0f) << 4) | (c2 >>> 2));
      if (c3 >= 0) {
        out.push(((c2 & 0x03) << 6) | c3);
      }
    }
  }
  return new Uint8Array(out);
}

export const base64UrlDecodeToBytes = base64UrlDecodeBytes;

export function base64UrlDecodeUtf8(b64url: string): string {
  return decodeUtf8Bytes(base64UrlDecodeBytes(b64url));
}

export const base64UrlDecodeToUtf8 = base64UrlDecodeUtf8;

export interface OidcJwtHeader {
  readonly alg: string;
  readonly typ?: string;
  readonly kid?: string;
  readonly crit?: readonly string[];
}

export interface OidcJwtPayload {
  readonly iss?: string;
  readonly sub?: string;
  readonly aud?: string | readonly string[];
  readonly exp?: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly jti?: string;
  readonly tid?: string;
  readonly tenantId?: string;
  readonly name?: string;
  readonly roles?: readonly string[];
  readonly authorizationClaims?: readonly string[];
  readonly use?: string;
  readonly provider_id?: string;
  readonly spec_id?: string;
  readonly target_revision_id?: string;
  readonly target_specification_fingerprint?: string;
  readonly acr?: string;
  readonly amr?: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * Signs an RFC 7515 / OIDC compact JWT (`header.payload.signature`) using asymmetric EdDSA (Ed25519).
 */
export function signOidcJwtEdDsa(
  header: OidcJwtHeader,
  payload: OidcJwtPayload,
  privateKeySeedOrHex: string
): {
  readonly jwt: string;
  readonly publicKeyHex: string;
  readonly publicKeyXBase64Url: string;
} {
  const encodedHeader = base64UrlEncodeUtf8(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeUtf8(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sig = signEd25519Message(signingInput, privateKeySeedOrHex);
  const sigBytes = hexToBytes(sig.signatureHex);
  const encodedSignature = base64UrlEncodeBytes(sigBytes);
  const pubBytes = hexToBytes(sig.publicKeyHex);

  return {
    jwt: `${signingInput}.${encodedSignature}`,
    publicKeyHex: sig.publicKeyHex,
    publicKeyXBase64Url: base64UrlEncodeBytes(pubBytes)
  };
}

// ============================================================================
// CANONICAL JSON & SHA-256 FINGERPRINTING HELPERS (WITH UNICODE NFC — FINDING-13)
// ============================================================================

export const MISSING_FIELD_SENTINEL = '__PATRONER_MISSING_FIELD__';

export interface CanonicalizeJsonOptions {
  preserveUndefinedAsSentinel?: boolean;
}

function normalizeCanonicalValue(
  value: unknown,
  options?: CanonicalizeJsonOptions
): unknown {
  if (value === undefined) {
    return options?.preserveUndefinedAsSentinel ? MISSING_FIELD_SENTINEL : undefined;
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot canonicalize non-finite number: ${String(value)}`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(item =>
      item === undefined
        ? options?.preserveUndefinedAsSentinel
          ? MISSING_FIELD_SENTINEL
          : null
        : normalizeCanonicalValue(item, options)
    );
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const rawKey of sortedKeys) {
      const normalizedKey = rawKey.normalize('NFC');
      const propVal = record[rawKey];
      if (propVal === undefined) {
        if (options?.preserveUndefinedAsSentinel) {
          result[normalizedKey] = MISSING_FIELD_SENTINEL;
        }
      } else {
        result[normalizedKey] = normalizeCanonicalValue(propVal, options);
      }
    }
    return result;
  }
  return String(value).normalize('NFC');
}

export function canonicalizeJson(
  value: unknown,
  options?: CanonicalizeJsonOptions
): string {
  return JSON.stringify(normalizeCanonicalValue(value, options));
}

export function computeCanonicalSha256(
  value: unknown,
  options?: CanonicalizeJsonOptions
): string {
  return sha256Hex(canonicalizeJson(value, options));
}
