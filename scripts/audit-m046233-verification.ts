/**
 * MILESTONE 04.6.2.3.3 — READ-ONLY INDEPENDENT CRYPTOGRAPHIC & GOVERNANCE AUDIT SCRIPT
 *
 * Temporary, isolated audit harness outside production source directories.
 * Does NOT modify any production source or existing test files.
 */

import * as nodeCrypto from 'node:crypto';
import {
  bytesToHex,
  encodeUtf8Bytes,
  generateEd25519KeyPairFromSeed,
  hexToBytes,
  sha256Hex,
  sha512Bytes,
  signEd25519Message,
  signOidcJwtEdDsa,
  verifyEd25519Signature
} from '../src/engine/production/crypto';
import {
  approveAuthoritativeGarmentSpecification,
  computeSpecificationFingerprint,
  convertToDesignSpecification,
  createAuthoritativeGarmentSpecification,
  createOidcPublicJwk,
  createTrustedCryptographicVerifier,
  createTrustedIdentityVerifier,
  deriveEd25519SigningKeyPair,
  issueVerifiableIdentityCredential
} from '../src/engine/production/garment-specification';
import {
  canonicalizeJson,
  computeCanonicalGradingArtifactFingerprint,
  createAuthoritativeGradingArtifact,
  createProductionPatternRevision,
  revokeAuthoritativeGradingArtifact,
  verifyGradingArtifactIntegrity
} from '../src/engine/production/pattern-revision-snapshot';
import {
  computeArtifactInputFingerprint,
  evaluatePipelineDependencyIntegrity,
  validateProductionExportPrerequisites
} from '../src/engine/production/dependency-invalidation';
import { draftSkirtBlock } from '../src/engine/drafting/skirt-block';
import { validatePatternDraft } from '../src/engine/validation/seam-validator';
import { gradePattern, DEFAULT_SIZE_RANGE } from '../src/engine/grading';
import { STANDARD_SIZING_SYSTEM } from '../src/engine/measurements/standards';
import { getEnhancedFabricById, DEFAULT_ILLUSTRATIVE_FABRIC } from '../src/engine/fabric/fabric-presets';

const STANDARD_MEASUREMENTS = STANDARD_SIZING_SYSTEM.sizes;
const fabricLookup = getEnhancedFabricById('wool-crepe');
const AUDIT_FABRIC = fabricLookup.status === 'found' ? fabricLookup.fabric : DEFAULT_ILLUSTRATIVE_FABRIC;

function nodeSha512Hex(bytes: Uint8Array): string {
  return nodeCrypto.createHash('sha512').update(bytes).digest('hex');
}

function ed25519SeedToPkcs8Der(seed32: Uint8Array): Buffer {
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return Buffer.concat([prefix, Buffer.from(seed32)]);
}

function ed25519PubToSpkiDer(pub32: Uint8Array): Buffer {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return Buffer.concat([prefix, Buffer.from(pub32)]);
}

async function runAudit(): Promise<void> {
  console.log('================================================================================');
  console.log('MILESTONE 04.6.2.3.3 — INDEPENDENT CRYPTOGRAPHIC & GOVERNANCE AUDIT');
  console.log('================================================================================');
  console.log(`Node.js version: ${process.version}`);
  console.log(`OpenSSL version: ${process.versions.openssl}`);

  // ==========================================================================
  // PHASE 1: SHA-512 INDEPENDENT VERIFICATION
  // ==========================================================================
  console.log('\n--- PHASE 1: SHA-512 INDEPENDENT VERIFICATION ---');

  const fipsVectors: Array<{ name: string; inputBytes: Uint8Array; expectedHex: string }> = [
    {
      name: 'FIPS 180-4 Vector 1: Empty input (0 bytes)',
      inputBytes: new Uint8Array(0),
      expectedHex:
        'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce' +
        '47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e'
    },
    {
      name: 'FIPS 180-4 Vector 2: "abc" (3 bytes)',
      inputBytes: encodeUtf8Bytes('abc'),
      expectedHex:
        'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
    },
    {
      name: 'FIPS 180-4 Vector 3: 896-bit / 112-byte two-block message',
      inputBytes: encodeUtf8Bytes(
        'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'
      ),
      expectedHex:
        '8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018' +
        '501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909'
    },
    {
      name: 'FIPS 180-4 Vector 4: 1,000,000 repetitions of "a"',
      inputBytes: new Uint8Array(1_000_000).fill(0x61),
      expectedHex:
        'e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973eb' +
        'de0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b'
    }
  ];

  for (const vec of fipsVectors) {
    const actualHex = bytesToHex(sha512Bytes(vec.inputBytes));
    const nodeRefHex = nodeSha512Hex(vec.inputBytes);
    const matchesOfficial = actualHex === vec.expectedHex && actualHex === nodeRefHex;
    console.log(
      `[SHA-512 Official] ${vec.name}: ${matchesOfficial ? 'PASS' : 'FAIL'} (actual=${actualHex.slice(0, 24)}...)`
    );
  }

  const boundaryLengths = [
    0, 1, 2, 3, 15, 16, 31, 32, 55, 56, 63, 64, 65,
    110, 111, 112, 113, 126, 127, 128, 129,
    238, 239, 240, 241, 254, 255, 256, 257,
    511, 512, 513, 1023, 1024, 1025, 4096, 8192
  ];

  let sha512DiffTotal = 0;
  let sha512DiffPassed = 0;
  let sha512WebCryptoPassed = 0;

  for (const len of boundaryLengths) {
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      buf[i] = (i * 131 + 17) & 0xff;
    }
    const inputCopy = new Uint8Array(buf);
    const actualHex = bytesToHex(sha512Bytes(buf));
    const refNodeHex = nodeSha512Hex(buf);
    const refWebBuf = await globalThis.crypto.subtle.digest('SHA-512', Buffer.from(buf));
    const refWebHex = bytesToHex(new Uint8Array(refWebBuf));

    const mutated = buf.some((b, idx) => b !== inputCopy[idx]);
    sha512DiffTotal++;
    if (actualHex === refNodeHex && !mutated) sha512DiffPassed++;
    if (actualHex === refWebHex) sha512WebCryptoPassed++;
  }

  const specialStrings = [
    '\x00',
    '\x00\x00\x00\x00',
    'a\x00b\x00c\x00',
    'Patroner — Modélisation Géométrique & Patronage Déterministe 🧵📐👗',
    '𝕮𝖗𝖞𝖕𝖙𝖔𝖌𝖗𝖆𝖕𝖍𝖎𝖈 𝕬𝖚𝖉𝖎𝖙 04.6.2.3.3 — カタカナ — العربية',
    '\xff'.repeat(111),
    '\xff'.repeat(112),
    '\xff'.repeat(127),
    '\xff'.repeat(128),
    '\xff'.repeat(129),
    '\x80'.repeat(112),
    '\x00'.repeat(128)
  ];

  for (const s of specialStrings) {
    const bytes = encodeUtf8Bytes(s);
    const actualHex = bytesToHex(sha512Bytes(bytes));
    const refNodeHex = nodeSha512Hex(bytes);
    const refWebHex = bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-512', Buffer.from(bytes))));
    sha512DiffTotal++;
    if (actualHex === refNodeHex) sha512DiffPassed++;
    if (actualHex === refWebHex) sha512WebCryptoPassed++;
  }

  for (let caseIdx = 0; sha512DiffTotal < 150; caseIdx++) {
    const seedHash = nodeCrypto.createHash('sha256').update(`sha512-diff-case-${caseIdx}`).digest();
    const len = (caseIdx * 19 + seedHash[0]) % 600;
    const data = new Uint8Array(len);
    for (let j = 0; j < len; j++) {
      data[j] = (seedHash[j % 32] ^ ((j * 73 + caseIdx) & 0xff)) & 0xff;
    }
    const actualHex = bytesToHex(sha512Bytes(data));
    const refNodeHex = nodeSha512Hex(data);
    const refWebHex = bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-512', Buffer.from(data))));
    sha512DiffTotal++;
    if (actualHex === refNodeHex) sha512DiffPassed++;
    if (actualHex === refWebHex) sha512WebCryptoPassed++;
  }

  console.log(
    `[SHA-512 Differential] Total=${sha512DiffTotal}, NodeCryptoMatch=${sha512DiffPassed}/${sha512DiffTotal}, WebCryptoMatch=${sha512WebCryptoPassed}/${sha512DiffTotal}`
  );

  // ==========================================================================
  // PHASE 2: ED25519 INDEPENDENT VERIFICATION (RFC 8032 & node:crypto)
  // ==========================================================================
  console.log('\n--- PHASE 2: ED25519 INDEPENDENT VERIFICATION ---');

  const rfc8032Vectors = [
    {
      name: 'RFC 8032 §7.1 TEST 1 (Empty message "")',
      seedHex: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
      expectedPublicKeyHex: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      isValidUtf8: true,
      messageUtf8: '',
      expectedSignatureHex:
        'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
        '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
    },
    {
      name: 'RFC 8032 §7.1 TEST 2 (1-byte ASCII 0x72 = "r")',
      seedHex: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
      expectedPublicKeyHex: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
      isValidUtf8: true,
      messageUtf8: 'r',
      expectedSignatureHex:
        '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da' +
        '085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'
    },
    {
      name: 'RFC 8032 §7.1 TEST 3 (2-byte raw binary 0xaf82 — non-UTF8)',
      seedHex: 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7',
      expectedPublicKeyHex: 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
      isValidUtf8: false,
      messageUtf8: '\u00af\u0082',
      expectedSignatureHex:
        '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac' +
        '18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a'
    },
    {
      name: 'RFC 8032 §7.1 TEST SHA(abc) (64-byte raw binary — non-UTF8)',
      seedHex: '833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42',
      expectedPublicKeyHex: 'ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf',
      isValidUtf8: false,
      messageUtf8: '',
      expectedSignatureHex:
        'dc2a4459e7369633a52b1bf277839a00201009a3efbf3ecb69bea2186c26b589' +
        '09351fc9ac90b3ecfdfbc7c66431e0303dca179c138ac17ad9bef1177331a704'
    }
  ];

  for (const vec of rfc8032Vectors) {
    const kp = generateEd25519KeyPairFromSeed(vec.seedHex);
    const pubMatches = kp.publicKeyHex === vec.expectedPublicKeyHex;
    const sig = signEd25519Message(vec.messageUtf8, vec.seedHex);
    const sigMatches = sig.signatureHex === vec.expectedSignatureHex;
    const verified = verifyEd25519Signature(vec.expectedPublicKeyHex, vec.messageUtf8, vec.expectedSignatureHex);
    console.log(
      `[Ed25519 RFC 8032] ${vec.name}: pubKeyMatch=${pubMatches}, sigMatch=${sigMatches}, verify=${verified}`
    );
  }

  let dirAPassed = 0;
  let dirBPassed = 0;
  const edDiffTotal = 120;

  for (let i = 0; i < edDiffTotal; i++) {
    const seedBytes = nodeCrypto.createHash('sha256').update(`ed25519-diff-seed-${i}`).digest();
    const seedHex = seedBytes.toString('hex');
    const msg =
      i === 0
        ? ''
        : i === 1
          ? 'r'
          : i === 2
            ? 'a\x00b\x00c'
            : i === 3
              ? 'Patroner Haute Couture — Édition 2026 🧵📐'
              : `Deterministic message payload #${i} - length=${i * 17} - ${'X'.repeat((i * 13) % 300)}`;

    const nodePrivKey = nodeCrypto.createPrivateKey({
      key: ed25519SeedToPkcs8Der(seedBytes),
      format: 'der',
      type: 'pkcs8'
    });
    const nodePubKey = nodeCrypto.createPublicKey(nodePrivKey);
    const spkiDer = nodePubKey.export({ format: 'der', type: 'spki' }) as Buffer;
    const nodePubHex = spkiDer.subarray(spkiDer.length - 32).toString('hex');
    const nodeSigHex = nodeCrypto.sign(null, Buffer.from(msg, 'utf8'), nodePrivKey).toString('hex');

    if (verifyEd25519Signature(nodePubHex, msg, nodeSigHex)) dirAPassed++;

    const patKp = generateEd25519KeyPairFromSeed(seedHex);
    const patSig = signEd25519Message(msg, seedHex);
    const patPubSpki = nodeCrypto.createPublicKey({
      key: ed25519PubToSpkiDer(hexToBytes(patKp.publicKeyHex)),
      format: 'der',
      type: 'spki'
    });
    const nodeVerifiedPatSig = nodeCrypto.verify(
      null,
      Buffer.from(msg, 'utf8'),
      patPubSpki,
      Buffer.from(patSig.signatureHex, 'hex')
    );

    if (nodeVerifiedPatSig && patKp.publicKeyHex === nodePubHex && patSig.signatureHex === nodeSigHex) {
      dirBPassed++;
    }
  }

  console.log(`[Ed25519 Cross-Verification] Direction A (node:crypto -> Patroner): ${dirAPassed}/${edDiffTotal} PASS`);
  console.log(`[Ed25519 Cross-Verification] Direction B (Patroner -> node:crypto): ${dirBPassed}/${edDiffTotal} PASS`);

  // ==========================================================================
  // PHASE 2.4: ADVERSARIAL ED25519 SIGNATURE VERIFICATION
  // ==========================================================================
  console.log('\n--- PHASE 2.4: ADVERSARIAL ED25519 VERIFICATION ---');

  const validSeed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
  const validKp = generateEd25519KeyPairFromSeed(validSeed);
  const validMsg = 'Approve specification rev-1';
  const validSig = signEd25519Message(validMsg, validSeed).signatureHex;
  const ED25519_L = (1n << 252n) + 27742317777372353535851937790883648493n;

  function bigintTo32LEHex(n: bigint): string {
    const out = new Uint8Array(32);
    let v = n;
    for (let i = 0; i < 32; i++) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return bytesToHex(out);
  }

  const order1PointHex = '01' + '00'.repeat(31);
  const order2PointHex = 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f';
  const order4PointPosHex = '00'.repeat(32);
  const order4PointNegHex = '00'.repeat(31) + '80';

  const RHex = validSig.slice(0, 64);
  const SHex = validSig.slice(64, 128);
  const SVal = (() => {
    const sb = hexToBytes(SHex);
    let r = 0n;
    for (let i = 31; i >= 0; i--) r = (r << 8n) | BigInt(sb[i]);
    return r;
  })();

  const malleableSHex = bigintTo32LEHex(SVal + ED25519_L);
  const sEqualsLHex = bigintTo32LEHex(ED25519_L);
  const nonCanonicalYHex = 'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f';
  const xZeroSignOneHex = '01' + '00'.repeat(30) + '80';

  const adversarialEdCases: Array<{ name: string; result: boolean; expected: boolean }> = [
    {
      name: 'Altered message (1-char diff)',
      result: verifyEd25519Signature(validKp.publicKeyHex, validMsg + '!', validSig),
      expected: false
    },
    {
      name: 'Altered signature R (bit flip)',
      result: verifyEd25519Signature(
        validKp.publicKeyHex,
        validMsg,
        (parseInt(validSig.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') + validSig.slice(2)
      ),
      expected: false
    },
    {
      name: 'Altered signature S (bit flip)',
      result: verifyEd25519Signature(
        validKp.publicKeyHex,
        validMsg,
        validSig.slice(0, 126) + (parseInt(validSig.slice(126, 128), 16) ^ 1).toString(16).padStart(2, '0')
      ),
      expected: false
    },
    {
      name: 'Wrong public key',
      result: verifyEd25519Signature(
        '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
        validMsg,
        validSig
      ),
      expected: false
    },
    {
      name: 'Truncated signature (126 hex chars)',
      result: verifyEd25519Signature(validKp.publicKeyHex, validMsg, validSig.slice(0, 126)),
      expected: false
    },
    {
      name: 'Extended signature (130 hex chars)',
      result: verifyEd25519Signature(validKp.publicKeyHex, validMsg, validSig + '00'),
      expected: false
    },
    {
      name: 'Non-canonical scalar S = S + L (signature malleability)',
      result: verifyEd25519Signature(validKp.publicKeyHex, validMsg, RHex + malleableSHex),
      expected: false
    },
    {
      name: 'Non-canonical scalar S = L',
      result: verifyEd25519Signature(validKp.publicKeyHex, validMsg, RHex + sEqualsLHex),
      expected: false
    },
    {
      name: 'Non-canonical public key y = p (y >= p)',
      result: verifyEd25519Signature(nonCanonicalYHex, validMsg, validSig),
      expected: false
    },
    {
      name: 'Non-canonical R point y = p (y >= p)',
      result: verifyEd25519Signature(validKp.publicKeyHex, validMsg, nonCanonicalYHex + SHex),
      expected: false
    },
    {
      name: 'Invalid point encoding x = 0 with sign bit = 1 (A)',
      result: verifyEd25519Signature(xZeroSignOneHex, validMsg, validSig),
      expected: false
    },
    {
      name: 'Invalid point encoding x = 0 with sign bit = 1 (R)',
      result: verifyEd25519Signature(validKp.publicKeyHex, validMsg, xZeroSignOneHex + SHex),
      expected: false
    },
    {
      name: 'Order-1 identity public key A = (0, 1) with R = (0, 1), S = 0',
      result: verifyEd25519Signature(order1PointHex, 'Any forged message', order1PointHex + '00'.repeat(32)),
      expected: false
    },
    {
      name: 'Order-2 small-order public key A = (0, -1) with R = (0, 1), S = 0',
      result: verifyEd25519Signature(order2PointHex, 'Any forged message', order1PointHex + '00'.repeat(32)),
      expected: false
    },
    {
      name: 'Order-4 small-order public key A = (+i, 0) with R = (0, 1), S = 0',
      result: verifyEd25519Signature(order4PointPosHex, 'Any forged message', order1PointHex + '00'.repeat(32)),
      expected: false
    },
    {
      name: 'Order-4 small-order public key A = (-i, 0) with R = (0, 1), S = 0',
      result: verifyEd25519Signature(order4PointNegHex, 'Any forged message', order1PointHex + '00'.repeat(32)),
      expected: false
    }
  ];

  for (const tc of adversarialEdCases) {
    const ok = tc.result === tc.expected;
    console.log(
      `[Ed25519 Adversarial] ${tc.name}: actual=${tc.result}, expected=${tc.expected} -> ${ok ? 'PASS' : 'DEFECT DETECTED'}`
    );
  }

  // ==========================================================================
  // PHASE 3 & 4: JWT / OIDC & KEY REGISTRY GOVERNANCE AUDIT
  // ==========================================================================
  console.log('\n--- PHASE 3 & 4: JWT / OIDC & KEY REGISTRY GOVERNANCE AUDIT ---');

  const idpSeed = 'audit-idp-seed-001';
  const jwk = createOidcPublicJwk('idp-key-1', { privateKeySeed: idpSeed }, {
    issuer: 'https://idp.patroner.enterprise',
    tenantId: 'tenant-1'
  });

  const cred1 = issueVerifiableIdentityCredential(
    {
      credentialId: 'jti-replay-test-001',
      subject: 'usr-designer-01',
      expectedApprover: 'Claire Dubois',
      issuer: 'https://idp.patroner.enterprise',
      audience: 'patroner-spec-approval',
      tenantId: 'tenant-1',
      keyId: 'idp-key-1',
      issuedAt: '2026-11-10T10:00:00.000Z',
      expiresAt: '2026-11-10T11:00:00.000Z',
      authorizationClaims: ['specification:approve']
    },
    idpSeed
  );

  const idVerifier = createTrustedIdentityVerifier({
    trustedIssuers: ['https://idp.patroner.enterprise'],
    expectedAudience: 'patroner-spec-approval',
    expectedTenantId: 'tenant-1',
    publicJwks: [jwk],
    referenceTimeIso: '2026-11-10T10:05:00.000Z'
  });

  const verifyCall1 = idVerifier.verifyIdentityCredential(cred1, {
    targetRevisionId: 'spec-skirt-v1',
    targetSpecificationFingerprint: 'fp-111',
    expectedApprover: 'Claire Dubois',
    approvalTimestamp: '2026-11-10T10:05:00.000Z',
    expectedTenantId: 'tenant-1'
  });
  const verifyCall2Replay = idVerifier.verifyIdentityCredential(cred1, {
    targetRevisionId: 'spec-skirt-v2',
    targetSpecificationFingerprint: 'fp-222',
    expectedApprover: 'Claire Dubois',
    approvalTimestamp: '2026-11-10T10:06:00.000Z',
    expectedTenantId: 'tenant-1'
  });
  console.log(
    `[JWT Audit] Token JTI Replay across distinct revisions/fingerprints: first=${verifyCall1.verified}, replay=${verifyCall2Replay.verified}`
  );

  const decodedPayload = JSON.parse(
    Buffer.from(cred1.token.split('.')[1], 'base64url').toString('utf8')
  ) as Record<string, unknown>;
  console.log(
    `[JWT Audit] Issued JWT payload has 'amr': ${'amr' in decodedPayload}, has 'acr': ${'acr' in decodedPayload}`
  );

  const critJwt = signOidcJwtEdDsa(
    {
      alg: 'EdDSA',
      typ: 'at+jwt',
      kid: 'idp-key-1',
      crit: ['exp', 'custom_must_understand'],
      custom_must_understand: true
    } as unknown as Parameters<typeof signOidcJwtEdDsa>[0],
    decodedPayload,
    idpSeed
  ).jwt;
  const critVerifyRes = idVerifier.verifyIdentityCredential(
    { ...cred1, token: critJwt, credentialToken: critJwt },
    {
      targetRevisionId: 'spec-skirt-v1',
      targetSpecificationFingerprint: 'fp-111',
      expectedApprover: 'Claire Dubois',
      approvalTimestamp: '2026-11-10T10:05:00.000Z',
      expectedTenantId: 'tenant-1'
    }
  );
  console.log(`[JWT Audit] RFC 7515 §4.1.11 unsupported 'crit' header accepted: ${critVerifyRes.verified}`);

  const badJwkVerifier = createTrustedIdentityVerifier({
    trustedIssuers: ['https://idp.patroner.enterprise'],
    expectedAudience: 'patroner-spec-approval',
    expectedTenantId: 'tenant-1',
    publicJwks: [
      {
        kty: 'RSA',
        crv: 'P-256',
        use: 'enc',
        kid: 'idp-key-1',
        alg: 'EdDSA',
        x: jwk.x,
        publicKeyHex: jwk.publicKeyHex,
        issuer: 'https://idp.patroner.enterprise',
        tenantId: 'tenant-1'
      } as unknown as typeof jwk
    ],
    referenceTimeIso: '2026-11-10T10:05:00.000Z'
  });
  const badJwkRes = badJwkVerifier.verifyIdentityCredential(cred1, {
    targetRevisionId: 'spec-skirt-v1',
    targetSpecificationFingerprint: 'fp-111',
    expectedApprover: 'Claire Dubois',
    approvalTimestamp: '2026-11-10T10:05:00.000Z',
    expectedTenantId: 'tenant-1'
  });
  console.log(`[JWT Audit] JWK with wrong kty='RSA', crv='P-256', use='enc' accepted: ${badJwkRes.verified}`);

  const recordSeedVerifier = createTrustedCryptographicVerifier({
    trustedKeys: {
      'legacy-seed-key': 'raw-private-seed-material-in-verifier'
    }
  });
  console.log(
    `[Registry Audit] createTrustedCryptographicVerifier accepts raw seed in Record<string, string> trustedKeys: ${
      recordSeedVerifier.trustedPublicKeyFingerprints.length === 1
    }`
  );

  const kpGov = deriveEd25519SigningKeyPair('gov-key-1', 'gov-seed-1');
  let rejectedPrivateKeySeedField = false;
  try {
    createTrustedCryptographicVerifier({
      publicKeyRegistry: [
        {
          ...kpGov.publicKeyRegistration,
          privateKeySeed: 'gov-seed-1',
          d: 'private-jwk-d-param'
        } as unknown as typeof kpGov.publicKeyRegistration
      ]
    });
  } catch {
    rejectedPrivateKeySeedField = true;
  }
  console.log(`[Registry Audit] Verifier rejects 'privateKeySeed'/'d' on ControlledPublicKeyRegistration: ${rejectedPrivateKeySeedField}`);

  // ==========================================================================
  // PHASE 5 & 6: GRADING ARTIFACT FINGERPRINT & EXPORT BYPASS AUDIT
  // ==========================================================================
  console.log('\n--- PHASE 5 & 6: GRADING ARTIFACT FINGERPRINT & EXPORT BYPASS AUDIT ---');

  const baseSpec = createAuthoritativeGarmentSpecification({
    projectId: 'project-patroner-default',
    garmentId: 'skirt-audit-01',
    specificationRevisionId: 'spec-skirt-audit-01-v1',
    version: 1,
    name: 'Audit Architectural Pencil Skirt',
    garmentCategory: 'skirt',
    silhouette: 'pencil',
    easeProfile: 'fitted',
    lengthCm: 68,
    fabric: AUDIT_FABRIC,
    fabricProvenance: AUDIT_FABRIC.provenance
  });

  const approvedSpec = approveAuthoritativeGarmentSpecification(baseSpec, 'Claire Dubois', {
    approvedAt: '2026-11-10T10:05:00.000Z',
    authorityTier: 'authenticated_designer',
    identityCredential: cred1,
    identityVerifier: idVerifier
  });
  const designSpec = convertToDesignSpecification(approvedSpec);
  const pieces = draftSkirtBlock(STANDARD_MEASUREMENTS.M, designSpec);
  const valReport = validatePatternDraft(pieces);
  const gradedSet = gradePattern(designSpec);

  const snapshot = createProductionPatternRevision({
    projectId: 'project-patroner-default',
    revisionId: 'rev-skirt-audit-01-v1-M',
    targetSize: 'M',
    designSpecification: designSpec,
    measurements: {
      values: ({ ...STANDARD_MEASUREMENTS.M } as unknown) as Record<string, number>,
      defaultOrigin: 'standard-chart',
      approval: {
        state: 'approved',
        approvedBy: 'Claire Dubois',
        approvedAt: '2026-11-10T10:05:00.000Z'
      }
    },
    fabric: AUDIT_FABRIC,
    patternPieces: pieces,
    validation: valReport,
    physicalValidationStatus: 'not-assessed'
  });

  const measFp = computeArtifactInputFingerprint({
    unit: STANDARD_MEASUREMENTS.M.unit,
    waist: STANDARD_MEASUREMENTS.M.waist,
    lowHip: STANDARD_MEASUREMENTS.M.lowHip,
    highHip: STANDARD_MEASUREMENTS.M.highHip,
    skirtLength: STANDARD_MEASUREMENTS.M.skirtLength,
    bust: STANDARD_MEASUREMENTS.M.bust,
    waistToHip: STANDARD_MEASUREMENTS.M.waistToHip,
    backWaistLength: STANDARD_MEASUREMENTS.M.backWaistLength,
    frontWaistLength: STANDARD_MEASUREMENTS.M.frontWaistLength,
    acrossBack: STANDARD_MEASUREMENTS.M.acrossBack,
    shoulderLength: STANDARD_MEASUREMENTS.M.shoulderLength,
    neckCircumference: STANDARD_MEASUREMENTS.M.neckCircumference,
    bustSpan: STANDARD_MEASUREMENTS.M.bustSpan,
    bustHeight: STANDARD_MEASUREMENTS.M.bustHeight,
    armholeDepth: STANDARD_MEASUREMENTS.M.armholeDepth,
    bicepsCircumference: STANDARD_MEASUREMENTS.M.bicepsCircumference,
    elbowCircumference: STANDARD_MEASUREMENTS.M.elbowCircumference,
    wristCircumference: STANDARD_MEASUREMENTS.M.wristCircumference,
    sleeveLength: STANDARD_MEASUREMENTS.M.sleeveLength,
    armLengthToElbow: STANDARD_MEASUREMENTS.M.armLengthToElbow,
    activeSize: 'M'
  });

  const gradingArtifact = createAuthoritativeGradingArtifact({
    projectId: 'project-patroner-default',
    tenantId: 'project-patroner-default',
    sourceSpecificationId: approvedSpec.garmentId,
    sourceSpecificationRevisionId: approvedSpec.specificationRevisionId,
    sourceSpecificationFingerprint: computeSpecificationFingerprint(approvedSpec),
    sourcePatternRevisionId: snapshot.revisionId,
    sourceMeasurementSetFingerprint: measFp,
    baseSize: 'M',
    sizeRange: [...DEFAULT_SIZE_RANGE],
    gradedPatternSet: gradedSet,
    basePatternPieces: pieces,
    createdAt: '2026-11-10T10:10:00.000Z'
  });

  const revokedGa1 = revokeAuthoritativeGradingArtifact(
    gradingArtifact,
    'Audit revocation test',
    '2026-11-10T12:00:00.000Z'
  );
  const revokedGa2 = {
    ...revokedGa1,
    revokedAt: '2099-12-31T23:59:59.000Z'
  };
  console.log(
    `[Grading Fingerprint Audit] Modifying 'revokedAt' detected as tampered: ${
      verifyGradingArtifactIntegrity(revokedGa2).isTampered
    } (same fingerprint: ${computeCanonicalGradingArtifactFingerprint(revokedGa2) === revokedGa1.canonicalFingerprint})`
  );

  const validReport = evaluatePipelineDependencyIntegrity({
    specification: approvedSpec,
    measurements: STANDARD_MEASUREMENTS.M,
    measurementApprovalState: 'approved',
    measurementProvenance: 'standard-chart',
    activeSize: 'M',
    fabric: AUDIT_FABRIC,
    patternPieces: pieces,
    validationReport: valReport,
    productionSnapshot: snapshot,
    gradingArtifact,
    verificationContext: {
      identityVerifier: idVerifier,
      identityCredential: cred1
    }
  });

  const omitPolicyWithGaRes = validateProductionExportPrerequisites(validReport, snapshot, {
    specification: approvedSpec,
    measurements: STANDARD_MEASUREMENTS.M,
    measurementApprovalState: 'approved',
    measurementProvenance: 'standard-chart',
    fabric: AUDIT_FABRIC,
    patternPieces: pieces,
    validationReport: valReport,
    gradingArtifact,
    verificationContext: {
      identityVerifier: idVerifier,
      identityCredential: cred1
    }
  });
  console.log(
    `[Export Bypass Audit 6.1] Omitted exportGradingPolicy when gradingArtifact is present: isExportPermitted=${omitPolicyWithGaRes.isExportPermitted}`
  );
}

runAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
