/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure TypeScript, zero-dependency, browser- and Node.js-compatible implementation
 * of the NIST FIPS 180-4 / RFC 6234 Secure Hash Algorithm 256 (SHA-256).
 *
 * Runs synchronously in both client-side Vite browser bundles and server-side runtimes
 * without requiring the 'node:crypto' module or browser polyfills.
 *
 * Documented Boundary:
 * This digest function provides cryptographic content-integrity verification.
 * It is an integrity digest, NOT an authenticated digital signature or public-key certificate.
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

// 64 round constants (first 32 bits of the fractional parts of the cube roots of the first 64 primes)
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function encodeUtf8(str: string): number[] {
  if (typeof TextEncoder !== 'undefined') {
    const uint8 = new TextEncoder().encode(str);
    const arr: number[] = new Array(uint8.length);
    for (let i = 0; i < uint8.length; i++) arr[i] = uint8[i];
    return arr;
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
  return bytes;
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

  const buffer = encodeUtf8(ascii);
  const bitLength = buffer.length * 8;

  // Append 0x80
  buffer.push(0x80);

  // Pad with zeros until length % 64 === 56
  while (buffer.length % 64 !== 56) {
    buffer.push(0x00);
  }

  // Append 64-bit length in big-endian
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
      const T1 = h + sigma1(e) + choice(e, f, g) + K[t] + W[t];
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
