/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure TypeScript, zero-dependency, browser- and Node.js-compatible implementation
 * of:
 * 1. NIST FIPS 180-4 / RFC 6234 Secure Hash Algorithm 256 (SHA-256)
 * 2. NIST FIPS 180-4 / RFC 6234 Secure Hash Algorithm 512 (SHA-512)
 * 3. RFC 8032 Edwards-Curve Digital Signature Algorithm (Ed25519) asymmetric signing
 *    and public-key-only verification
 * 4. RFC 4648 Base64URL encoding/decoding and RFC 7515 / OIDC Compact JWT (EdDSA) verification
 *
 * Runs synchronously in both client-side Vite browser bundles and server-side runtimes
 * without requiring the 'node:crypto' module or browser polyfills.
 */

function rotateRight(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

function choice(e: number, f: number, g: number): number {
  return (e & f) ^ (~e & g);
}

function majority(e: number, f: number, g: number): number {
  return (e & f) ^ (e & g) ^ (f & g);
}

function sigma0(x: number): number {
  return rotateRight(2, x) ^ rotateRight(13, x) ^ rotateRight(22, x);
}

function sigma1(x: number): number {
  return rotateRight(6, x) ^ rotateRight(11, x) ^ rotateRight(25, x);
}

function gamma0(x: number): number {
  return rotateRight(7, x) ^ rotateRight(18, x) ^ (x >>> 3);
}

function gamma1(x: number): number {
  return rotateRight(17, x) ^ rotateRight(19, x) ^ (x >>> 10);
}

// 64 round constants for SHA-256
const K256: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

export function encodeUtf8Bytes(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      i++;
      code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
}

export function decodeUtf8Bytes(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return decodeURIComponent(escape(out));
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
 * Computes the SHA-256 digest of a UTF-8 string, returning a 64-character lowercase hex string.
 * Meets NIST FIPS 180-4 standard test vectors.
 */
export function sha256Hex(ascii: string): string {
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const utf8 = encodeUtf8Bytes(ascii);
  const buffer: number[] = Array.from(utf8);
  const bitLength = buffer.length * 8;

  buffer.push(0x80);
  while (buffer.length % 64 !== 56) {
    buffer.push(0x00);
  }

  const highLen = Math.floor(bitLength / 0x100000000);
  const lowLen = bitLength >>> 0;

  const M = new Uint8Array(
    buffer.concat([
      (highLen >>> 24) & 0xff,
      (highLen >>> 16) & 0xff,
      (highLen >>> 8) & 0xff,
      highLen & 0xff,
      (lowLen >>> 24) & 0xff,
      (lowLen >>> 16) & 0xff,
      (lowLen >>> 8) & 0xff,
      lowLen & 0xff
    ])
  );

  const W = new Array<number>(64);

  for (let i = 0; i < M.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] =
        (M[i + t * 4] << 24) |
        (M[i + t * 4 + 1] << 16) |
        (M[i + t * 4 + 2] << 8) |
        M[i + t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      W[t] = (gamma1(W[t - 2]) + W[t - 7] + gamma0(W[t - 15]) + W[t - 16]) | 0;
    }

    let [a, b, c, d, e, f, g, h] = H;

    for (let t = 0; t < 64; t++) {
      const T1 = h + sigma1(e) + choice(e, f, g) + K256[t] + W[t];
      const T2 = sigma0(a) + majority(a, b, c);
      h = g;
      g = f;
      f = e;
      e = (d + T1) | 0;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) | 0;
    }

    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  return H.map(val => ('00000000' + (val >>> 0).toString(16)).slice(-8)).join('');
}

// ============================================================================
// NIST FIPS 180-4 SHA-512 (Required by RFC 8032 Ed25519)
// ============================================================================

const MASK64 = 0xffffffffffffffffn;

const K512: readonly bigint[] = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n
];

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | ((x << (64n - n)) & MASK64)) & MASK64;
}

function sigma512_0(x: bigint): bigint {
  return rotr64(x, 28n) ^ rotr64(x, 34n) ^ rotr64(x, 39n);
}

function sigma512_1(x: bigint): bigint {
  return rotr64(x, 14n) ^ rotr64(x, 18n) ^ rotr64(x, 41n);
}

function gamma512_0(x: bigint): bigint {
  return rotr64(x, 1n) ^ rotr64(x, 8n) ^ (x >> 7n);
}

function gamma512_1(x: bigint): bigint {
  return rotr64(x, 19n) ^ rotr64(x, 61n) ^ (x >> 6n);
}

/**
 * Computes the 64-byte SHA-512 digest of a byte array.
 */
export function sha512Bytes(data: Uint8Array): Uint8Array {
  const H: bigint[] = [
    0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn,
    0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn,
    0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n
  ];

  const bitLen = BigInt(data.length) * 8n;
  const padZeroCount = (112 - ((data.length + 1) % 128) + 128) % 128;
  const totalLen = data.length + 1 + padZeroCount + 16;
  const M = new Uint8Array(totalLen);
  M.set(data, 0);
  M[data.length] = 0x80;

  // Write 128-bit big-endian bit length at the end of M
  let rem = bitLen;
  for (let i = totalLen - 1; i >= totalLen - 16; i--) {
    M[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }

  const W = new Array<bigint>(80);

  for (let offset = 0; offset < totalLen; offset += 128) {
    for (let t = 0; t < 16; t++) {
      let word = 0n;
      for (let b = 0; b < 8; b++) {
        word = (word << 8n) | BigInt(M[offset + t * 8 + b]);
      }
      W[t] = word;
    }
    for (let t = 16; t < 80; t++) {
      W[t] = (gamma512_1(W[t - 2]) + W[t - 7] + gamma512_0(W[t - 15]) + W[t - 16]) & MASK64;
    }

    let [a, b, c, d, e, f, g, h] = H;

    for (let t = 0; t < 80; t++) {
      const ch = (e & f) ^ ((~e & MASK64) & g);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const T1 = (h + sigma512_1(e) + ch + K512[t] + W[t]) & MASK64;
      const T2 = (sigma512_0(a) + maj) & MASK64;
      h = g;
      g = f;
      f = e;
      e = (d + T1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) & MASK64;
    }

    H[0] = (H[0] + a) & MASK64;
    H[1] = (H[1] + b) & MASK64;
    H[2] = (H[2] + c) & MASK64;
    H[3] = (H[3] + d) & MASK64;
    H[4] = (H[4] + e) & MASK64;
    H[5] = (H[5] + f) & MASK64;
    H[6] = (H[6] + g) & MASK64;
    H[7] = (H[7] + h) & MASK64;
  }

  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    let w = H[i];
    for (let b = 7; b >= 0; b--) {
      out[i * 8 + b] = Number(w & 0xffn);
      w >>= 8n;
    }
  }
  return out;
}

// ============================================================================
// RFC 8032 Ed25519 Asymmetric Public-Key Cryptography
// ============================================================================

const ED25519_P = (1n << 255n) - 19n;
const ED25519_L = (1n << 252n) + 27742317777372353535851937790883648493n;

function modP(a: bigint): bigint {
  const r = a % ED25519_P;
  return r < 0n ? r + ED25519_P : r;
}

function modL(a: bigint): bigint {
  const r = a % ED25519_L;
  return r < 0n ? r + ED25519_L : r;
}

function modPowP(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = modP(base);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = modP(result * b);
    b = modP(b * b);
    e >>= 1n;
  }
  return result;
}

function modInvP(a: bigint): bigint {
  return modPowP(a, ED25519_P - 2n);
}

// Curve constant d = -121665 / 121666 mod p
const ED25519_D = modP(-121665n * modInvP(121666n));
// sqrt(-1) mod p = 2^((p-1)/4) mod p
const ED25519_I = modPowP(2n, (ED25519_P - 1n) / 4n);

// Extended twisted Edwards coordinates (X : Y : Z : T) where x = X/Z, y = Y/Z, x*y = T/Z
interface ExtPoint {
  readonly X: bigint;
  readonly Y: bigint;
  readonly Z: bigint;
  readonly T: bigint;
}

const ZERO_POINT: ExtPoint = { X: 0n, Y: 1n, Z: 1n, T: 0n };

// Base point B from RFC 8032 Section 5.1
const ED25519_BY = modP(4n * modInvP(5n));
const ED25519_BX = recoverX(ED25519_BY, 0n)!;
const BASE_POINT: ExtPoint = {
  X: ED25519_BX,
  Y: ED25519_BY,
  Z: 1n,
  T: modP(ED25519_BX * ED25519_BY)
};

function recoverX(y: bigint, sign: bigint): bigint | null {
  if (y >= ED25519_P) return null;
  const y2 = modP(y * y);
  const u = modP(y2 - 1n);
  const v = modP(ED25519_D * y2 + 1n);
  // x^2 = u / v = u * v^3 * (u * v^7)^((p - 5) / 8) mod p
  const v3 = modP(modP(v * v) * v);
  const v7 = modP(modP(v3 * v3) * v);
  const uv7 = modP(u * v7);
  let x = modP(modP(u * v3) * modPowP(uv7, (ED25519_P - 5n) / 8n));
  const vx2 = modP(v * modP(x * x));
  if (vx2 === u) {
    // x is a valid square root
  } else if (vx2 === modP(-u)) {
    x = modP(x * ED25519_I);
  } else {
    return null;
  }
  if (x === 0n && sign === 1n) return null;
  if ((x & 1n) !== sign) {
    x = ED25519_P - x;
  }
  return x;
}

function pointAdd(P: ExtPoint, Q: ExtPoint): ExtPoint {
  const A = modP((P.Y - P.X) * (Q.Y - Q.X));
  const B = modP((P.Y + P.X) * (Q.Y + Q.X));
  const C = modP(P.T * 2n * ED25519_D * Q.T);
  const D = modP(P.Z * 2n * Q.Z);
  const E = modP(B - A);
  const F = modP(D - C);
  const G = modP(D + C);
  const H = modP(B + A);
  return {
    X: modP(E * F),
    Y: modP(G * H),
    Z: modP(F * G),
    T: modP(E * H)
  };
}

function pointMul(P: ExtPoint, scalar: bigint): ExtPoint {
  let result = ZERO_POINT;
  let addend = P;
  let s = scalar;
  while (s > 0n) {
    if ((s & 1n) === 1n) {
      result = pointAdd(result, addend);
    }
    addend = pointAdd(addend, addend);
    s >>= 1n;
  }
  return result;
}

function pointEquals(P: ExtPoint, Q: ExtPoint): boolean {
  return modP(P.X * Q.Z) === modP(Q.X * P.Z) && modP(P.Y * Q.Z) === modP(Q.Y * P.Z);
}

function encodePoint(P: ExtPoint): Uint8Array {
  const zInv = modInvP(P.Z);
  const x = modP(P.X * zInv);
  const y = modP(P.Y * zInv);
  const out = new Uint8Array(32);
  let tempY = y;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(tempY & 0xffn);
    tempY >>= 8n;
  }
  out[31] |= Number(x & 1n) << 7;
  return out;
}

function decodePoint(bytes: Uint8Array): ExtPoint | null {
  if (bytes.length !== 32) return null;
  const sign = BigInt((bytes[31] >>> 7) & 1);
  let y = 0n;
  for (let i = 31; i >= 0; i--) {
    const b = i === 31 ? (bytes[i] & 0x7f) : bytes[i];
    y = (y << 8n) | BigInt(b);
  }
  if (y >= ED25519_P) return null;
  const x = recoverX(y, sign);
  if (x === null) return null;
  return {
    X: x,
    Y: y,
    Z: 1n,
    T: modP(x * y)
  };
}

function bytesToLittleEndianBigInt(bytes: Uint8Array): bigint {
  let res = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    res = (res << 8n) | BigInt(bytes[i]);
  }
  return res;
}

function bigIntTo32BytesLE(val: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = val;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export interface Ed25519KeyPair {
  readonly privateKeyHex: string;
  readonly publicKeyHex: string;
  readonly publicKeyFingerprint: string;
  readonly algorithm: 'Ed25519';
}

/**
 * Computes a deterministic SHA-256 fingerprint of an Ed25519 public key (64-char hex).
 */
export function computeEd25519PublicKeyFingerprint(publicKeyHex: string): string {
  return sha256Hex(`ed25519-spki-v1:${publicKeyHex.toLowerCase()}`);
}

/**
 * Derives an RFC 8032 Ed25519 keypair from either a 64-char hex private seed or a string seed phrase.
 */
export function generateEd25519KeyPairFromSeed(seedOrHex: string): Ed25519KeyPair {
  if (!seedOrHex || typeof seedOrHex !== 'string' || seedOrHex.trim() === '') {
    throw new Error('Ed25519 private key seed must be a non-empty string.');
  }
  const seedBytes =
    seedOrHex.length === 64 && /^[0-9a-fA-F]{64}$/.test(seedOrHex)
      ? hexToBytes(seedOrHex)
      : hexToBytes(sha256Hex(`ed25519-seed-v1:${seedOrHex}`));

  const h = sha512Bytes(seedBytes);
  const sBytes = h.slice(0, 32);
  sBytes[0] &= 248;
  sBytes[31] &= 127;
  sBytes[31] |= 64;

  const s = bytesToLittleEndianBigInt(sBytes);
  const A = pointMul(BASE_POINT, s);
  const publicKeyHex = bytesToHex(encodePoint(A));
  const privateKeyHex = bytesToHex(seedBytes);

  return Object.freeze({
    privateKeyHex,
    publicKeyHex,
    publicKeyFingerprint: computeEd25519PublicKeyFingerprint(publicKeyHex),
    algorithm: 'Ed25519' as const
  });
}

/**
 * Signs a UTF-8 message using an RFC 8032 Ed25519 private key seed (hex or seed string).
 * Returns a 128-character lowercase hex Ed25519 signature (64 bytes: R || S).
 */
export function signEd25519Message(
  messageUtf8: string,
  privateKeySeedOrHex: string
): {
  readonly signatureHex: string;
  readonly publicKeyHex: string;
  readonly publicKeyFingerprint: string;
} {
  const keyPair = generateEd25519KeyPairFromSeed(privateKeySeedOrHex);
  const seedBytes = hexToBytes(keyPair.privateKeyHex);
  const h = sha512Bytes(seedBytes);

  const sBytes = h.slice(0, 32);
  sBytes[0] &= 248;
  sBytes[31] &= 127;
  sBytes[31] |= 64;
  const s = bytesToLittleEndianBigInt(sBytes);

  const prefix = h.slice(32, 64);
  const msgBytes = encodeUtf8Bytes(messageUtf8);

  const rHash = sha512Bytes(concatBytes(prefix, msgBytes));
  const r = modL(bytesToLittleEndianBigInt(rHash));
  const RBytes = encodePoint(pointMul(BASE_POINT, r));
  const ABytes = hexToBytes(keyPair.publicKeyHex);

  const kHash = sha512Bytes(concatBytes(RBytes, ABytes, msgBytes));
  const k = modL(bytesToLittleEndianBigInt(kHash));
  const S = modL(r + k * s);
  const SBytes = bigIntTo32BytesLE(S);

  const signatureHex = bytesToHex(concatBytes(RBytes, SBytes));
  return {
    signatureHex,
    publicKeyHex: keyPair.publicKeyHex,
    publicKeyFingerprint: keyPair.publicKeyFingerprint
  };
}

/**
 * Verifies an RFC 8032 Ed25519 signature using ONLY the 32-byte public key (64-char hex).
 * Never requires, accesses, or accepts private key material.
 */
export function verifyEd25519Signature(
  publicKeyHex: string,
  messageUtf8: string,
  signatureHex: string
): boolean {
  try {
    if (
      typeof publicKeyHex !== 'string' ||
      publicKeyHex.length !== 64 ||
      !/^[0-9a-fA-F]{64}$/.test(publicKeyHex)
    ) {
      return false;
    }
    if (
      typeof signatureHex !== 'string' ||
      signatureHex.length !== 128 ||
      !/^[0-9a-fA-F]{128}$/.test(signatureHex)
    ) {
      return false;
    }

    const ABytes = hexToBytes(publicKeyHex);
    const A = decodePoint(ABytes);
    if (!A) return false;
    // Reject identity point as public key
    if (pointEquals(A, ZERO_POINT)) return false;

    const sigBytes = hexToBytes(signatureHex);
    const RBytes = sigBytes.slice(0, 32);
    const SBytes = sigBytes.slice(32, 64);

    const R = decodePoint(RBytes);
    if (!R) return false;

    const S = bytesToLittleEndianBigInt(SBytes);
    if (S < 0n || S >= ED25519_L) return false;

    const msgBytes = encodeUtf8Bytes(messageUtf8);
    const kHash = sha512Bytes(concatBytes(RBytes, ABytes, msgBytes));
    const k = modL(bytesToLittleEndianBigInt(kHash));

    // Verify [8*S]B == [8]R + [8*k]A on Edwards25519 (cofactor-verified equation)
    const lhs = pointMul(BASE_POINT, 8n * S);
    const rhs = pointAdd(pointMul(R, 8n), pointMul(A, 8n * k));
    return pointEquals(lhs, rhs);
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

export function base64UrlDecodeUtf8(b64url: string): string {
  return decodeUtf8Bytes(base64UrlDecodeBytes(b64url));
}

export interface OidcJwtHeader {
  readonly alg: string;
  readonly typ?: string;
  readonly kid?: string;
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
