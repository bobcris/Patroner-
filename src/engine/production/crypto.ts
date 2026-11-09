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

// Initial hash values (first 32 bits of the fractional parts of the square roots of the first 8 primes)
const H_INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);

// Round constants (first 32 bits of the fractional parts of the cube roots of the first 64 primes)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0bef9a3f, 0xc67178f2
]);

function rotr(n: number, b: number): number {
  return (n >>> b) | (n << (32 - b));
}

function encodeUtf8(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  // Fallback UTF-8 encoder if TextEncoder is unavailable
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

/**
 * Computes the SHA-256 digest of a UTF-8 string, returning a 64-character lowercase hex string.
 */
export function sha256Hex(input: string): string {
  const data = encodeUtf8(input);
  const dataLen = data.length;

  // Pre-processing (Padding):
  // message + 0x80 + zeroes + 64-bit length
  const bitLenHi = Math.floor(dataLen / 0x20000000);
  const bitLenLo = (dataLen * 8) >>> 0;

  const paddedLen = (((dataLen + 9 + 63) >>> 6) << 6);
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[dataLen] = 0x80;

  // Append 64-bit big-endian length in bits
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  const words = new Uint32Array(64);
  let h0 = H_INIT[0];
  let h1 = H_INIT[1];
  let h2 = H_INIT[2];
  let h3 = H_INIT[3];
  let h4 = H_INIT[4];
  let h5 = H_INIT[5];
  let h6 = H_INIT[6];
  let h7 = H_INIT[7];

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      words[i] = view.getUint32(offset + (i * 4), false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(words[i - 15], 7) ^ rotr(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotr(words[i - 2], 17) ^ rotr(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (((words[i - 16] + s0) >>> 0) + ((words[i - 7] + s1) >>> 0)) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (((((h + S1) >>> 0) + ch) >>> 0) + ((K[i] + words[i]) >>> 0)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint32Array([h0, h1, h2, h3, h4, h5, h6, h7]);
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += out[i].toString(16).padStart(8, '0');
  }
  return hex;
}
