/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Milestone 04.3 — Deterministic Canonical JSON Serialization & FIPS 180-4 SHA-256 Pipeline
 *
 * Strictly separates canonical payload construction, UTF-8 encoding, and SHA-256 hashing.
 * Rejects empty-object ("{}") collapse for assembly report digests.
 */

export const EMPTY_JSON_OBJECT_SHA256 =
  '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const SHA256_H_INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);

const utf8Encoder = new TextEncoder();

function rotr32(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Encodes a JS string strictly to UTF-8 bytes.
 * Rejects non-string inputs rather than silently coercing.
 */
export function encodeUtf8(input: string): Uint8Array {
  if (typeof input !== 'string') {
    throw new TypeError(`encodeUtf8 expected a string payload, received ${typeof input}.`);
  }
  return utf8Encoder.encode(input);
}

/**
 * FIPS 180-4 SHA-256 digest over raw byte array, returning 64-character lowercase hexadecimal string.
 */
export function sha256BytesHex(data: Uint8Array): string {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('sha256BytesHex requires a Uint8Array input.');
  }

  const bitLength = BigInt(data.length) * 8n;
  // Pad to 56 mod 64 bytes (+1 for 0x80 byte, +8 for 64-bit big-endian length)
  const remainder = (data.length + 1) % 64;
  const zeroPadLen = remainder <= 56 ? 56 - remainder : 64 + 56 - remainder;
  const padded = new Uint8Array(data.length + 1 + zeroPadLen + 8);
  padded.set(data, 0);
  padded[data.length] = 0x80;

  const dv = new DataView(padded.buffer);
  const lengthOffset = padded.length - 8;
  dv.setUint32(lengthOffset, Number((bitLength >> 32n) & 0xffffffffn), false);
  dv.setUint32(lengthOffset + 4, Number(bitLength & 0xffffffffn), false);

  const H = new Uint32Array(SHA256_H_INIT);
  const W = new Uint32Array(64);

  for (let chunkOffset = 0; chunkOffset < padded.length; chunkOffset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = dv.getUint32(chunkOffset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(W[i - 15], 7) ^ rotr32(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr32(W[i - 2], 17) ^ rotr32(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
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

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += H[i].toString(16).padStart(8, '0');
  }
  return hex;
}

/**
 * Computes the FIPS 180-4 SHA-256 hex digest of a UTF-8 string.
 */
export function sha256Hex(canonicalUtf8Text: string): string {
  return sha256BytesHex(encodeUtf8(canonicalUtf8Text));
}

function normalizeValueForCanonicalJson(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalizeAssemblyJson cannot serialize non-finite number: ${String(value)}`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`canonicalizeAssemblyJson cannot serialize unsupported type: ${typeof value}`);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    const obj = value as object;
    if (seen.has(obj)) {
      throw new Error('canonicalizeAssemblyJson encountered a circular reference.');
    }
    seen.add(obj);

    try {
      if (Array.isArray(obj)) {
        return obj.map(item => {
          if (item === undefined) return null;
          const normalized = normalizeValueForCanonicalJson(item, seen);
          return normalized === undefined ? null : normalized;
        });
      }

      if (obj instanceof Set) {
        return Array.from(obj.values()).map(item => normalizeValueForCanonicalJson(item, seen));
      }

      if (obj instanceof Map) {
        const mapped: Record<string, unknown> = {};
        const entries = Array.from(obj.entries())
          .map(([k, v]) => [String(k).normalize('NFC'), v] as const)
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        for (const [k, v] of entries) {
          if (v !== undefined) {
            mapped[k] = normalizeValueForCanonicalJson(v, seen);
          }
        }
        return mapped;
      }

      const record = obj as Record<string, unknown>;
      // Handle objects with custom toJSON safely if present
      if (typeof (record as { toJSON?: unknown }).toJSON === 'function') {
        const jsonified = (record as { toJSON: () => unknown }).toJSON();
        return normalizeValueForCanonicalJson(jsonified, seen);
      }

      const normalizedKeys = Object.keys(record)
        .map(k => ({ raw: k, norm: k.normalize('NFC') }))
        .sort((a, b) => (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0));

      const out: Record<string, unknown> = {};
      for (const { raw, norm } of normalizedKeys) {
        const propVal = record[raw];
        if (propVal !== undefined) {
          const normalizedProp = normalizeValueForCanonicalJson(propVal, seen);
          if (normalizedProp !== undefined) {
            out[norm] = normalizedProp;
          }
        }
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  }

  throw new TypeError(`Unsupported value type in canonicalizeAssemblyJson: ${typeof value}`);
}

/**
 * Deterministic canonical JSON string serializer with sorted keys and Unicode NFC normalization.
 */
export function canonicalizeAssemblyJson(payload: unknown): string {
  if (payload === undefined) {
    throw new TypeError('canonicalizeAssemblyJson cannot serialize undefined root payload.');
  }
  const normalized = normalizeValueForCanonicalJson(payload, new WeakSet<object>());
  const serialized = JSON.stringify(normalized);
  if (typeof serialized !== 'string') {
    throw new Error('canonicalizeAssemblyJson produced non-string serialization.');
  }
  return serialized;
}

export interface CanonicalDigestEnvelope {
  canonicalJson: string;
  byteLength: number;
  sha256Hex: string;
}

/**
 * Computes canonical JSON, UTF-8 byte length, and SHA-256 hex digest.
 * By default (requireNonEmptyObject = true), strictly rejects collapse to "{}".
 */
export function digestCanonicalPayload(
  payload: unknown,
  options?: { requireNonEmptyObject?: boolean }
): CanonicalDigestEnvelope {
  const requireNonEmptyObject = options?.requireNonEmptyObject ?? true;

  if (requireNonEmptyObject) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Canonical report payload must be a non-null JSON object.');
    }
  }

  const canonicalJson = canonicalizeAssemblyJson(payload);
  const utf8Bytes = encodeUtf8(canonicalJson);
  const digest = sha256BytesHex(utf8Bytes);

  if (requireNonEmptyObject && (canonicalJson === '{}' || digest === EMPTY_JSON_OBJECT_SHA256)) {
    throw new Error(
      'Canonical assembly payload serialized to empty JSON object "{}" (digest 44136fa3...): refusing empty digest.'
    );
  }

  return {
    canonicalJson,
    byteLength: utf8Bytes.byteLength,
    sha256Hex: digest
  };
}
