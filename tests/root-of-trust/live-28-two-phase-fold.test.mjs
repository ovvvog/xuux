// @ts-nocheck
// WL-321 — `LIVE-28`: الطيُّ ذو المرحلتَين على عقدِ `FreshnessSocket` القائم.
//
// المقيسُ قبلَ الإصلاح: `createProductionRootOfTrust` يُنادي `freshnessSocket.bump()` ثمَّ
// يختمُ العهدَ في البيان. فسقوطُ العمليّةِ بينَهما يتركُ المرجعَ الخارجيَّ أحدثَ من البيانِ
// بواحدٍ، فيُرَدُّ كلُّ إقلاعٍ تالٍ بـ`STALE_MANIFEST_EPOCH` — جذرٌ سليمٌ معطَّلٌ بلا تعافٍ.
//
// والإصلاح: حجزٌ مختومٌ (`freshnessReserved = epoch + 1`) ثمَّ الرفعُ ثمَّ إتمامٌ مختوم.
// والإقلاعُ يُتِمُّ الطيَّ في حالٍ واحدةٍ بعينِها: حجزٌ مختومٌ يساوي `epoch + 1` ومرجعٌ
// يساويه بالضبط. وكلُّ ما سواها يُرَدُّ كما كان.
//
// **السقوطُ حقيقيٌّ لا مُحاكىً:** عمليّةٌ ابنٌ تُقلِعُ ثمَّ تقتلُ نفسَها بـ`SIGKILL` داخلَ
// `bump()` (‏بعدَ الرفعِ أو قبلَه)، والمرجعُ ملفٌّ يبقى بعدَها — **مقبسُ اختبارٍ لا مرجعٌ
// إنتاجيٌّ** (‏لا TPM ولا NV ولا خدمة؛ `EXT-6` لم يُنفَّذ).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProductionRootOfTrust, fingerprint } from '../../src/root-of-trust/index.mjs';

const MANIFEST = 'root-of-trust.manifest.json';
const SELF = fileURLToPath(import.meta.url);

/** توكنٌ مزيَّفٌ ثابتُ المفاتيحِ عبرَ الإقلاعاتِ. */
function stableToken(king, aeadKey, ledgerPair) {
  const aad = Buffer.from('xuux-event');
  const ed = new Map([
    ['06', king],
    ['07', ledgerPair],
  ]);
  return {
    describe: () => ({ kind: 'pkcs11-hsm', canExport: false, tokenSerial: 'DEADBEEFCAFE0001' }),
    getAeadKey: async (keyId) => {
      if (keyId !== '05') throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        encrypt: async (plaintext) => {
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', aeadKey, iv);
          cipher.setAAD(aad);
          return {
            ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]),
            iv,
            tag: cipher.getAuthTag(),
          };
        },
        decrypt: async (ciphertext, iv, tag) => {
          const decipher = createDecipheriv('aes-256-gcm', aeadKey, iv);
          decipher.setAAD(aad);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        },
      };
    },
    getSigningKey: async (keyId) => {
      const pair = ed.get(keyId);
      if (!pair) throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        sign: async (message) => softwareSign(null, message, pair.privateKey),
        exportPublicPem: async () => pair.publicKey.export({ type: 'spki', format: 'pem' }),
      };
    },
  };
}

/**
 * مرجعُ حداثةٍ في ملفٍّ — **للاختبارِ وحدَه**: يبقى بعدَ موتِ العمليّةِ فيُقاسُ السقوطُ
 * بينَ المرحلتَين. `crash` يقتلُ العمليّةَ داخلَ `bump()`: `after` بعدَ كتابةِ الرفعِ،
 * و`before` قبلَها. و`foreign` يرفعُه كاتبٌ آخرُ قبلَ الرفعِ.
 */
class FileFreshnessSocket {
  constructor(file, { crash = null, foreign = false } = {}) {
    this.file = file;
    this.crash = crash;
    this.foreign = foreign;
  }
  current() {
    return existsSync(this.file) ? BigInt(readFileSync(this.file, 'utf8').trim()) : 0n;
  }
  async read() {
    const epoch = this.current();
    return { epoch, anchor: `file:${epoch}` };
  }
  async bump() {
    if (this.crash === 'before') process.kill(process.pid, 'SIGKILL');
    if (this.foreign) writeFileSync(this.file, String(this.current() + 1n));
    const epoch = this.current() + 1n;
    writeFileSync(this.file, String(epoch));
    if (this.crash === 'after') process.kill(process.pid, 'SIGKILL');
    return { epoch, anchor: `file:${epoch}` };
  }
}

function serialKeys() {
  const king = generateKeyPairSync('ed25519');
  const ledger = generateKeyPairSync('ed25519');
  const royal = generateKeyPairSync('ed25519');
  const pem = (k) => k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    king: pem(king),
    ledger: pem(ledger),
    royal: pem(royal),
    aead: randomBytes(32).toString('hex'),
  };
}

function pairOf(privatePem) {
  const privateKey = createPrivateKey(privatePem);
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

function bootWith(serial, root, socket) {
  const king = pairOf(serial.king);
  const ledgerPair = pairOf(serial.ledger);
  const royal = pairOf(serial.royal);
  const royalId = 'king:' + fingerprint(royal.publicKey).slice(0, 24);
  const env = {
    NODE_ENV: 'production',
    STATE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source',
    XUUX_KING_ID: 'king:' + fingerprint(king.publicKey).slice(0, 24),
    XUUX_ROYAL_PUBLIC_KEY_PEM: royal.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    XUUX_ROYAL_KEY_ID: royalId,
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
  };
  return createProductionRootOfTrust(
    env,
    { root, fsync: false, freshnessSocket: socket },
    {
      openSource: async () => ({
        source: stableToken(king, Buffer.from(serial.aead, 'hex'), ledgerPair),
        close: async () => undefined,
      }),
    },
  );
}

if (process.env.LIVE28_CHILD === '1') {
  // العمليّةُ الابنُ: تُقلِعُ على الجذرِ وتموتُ داخلَ `bump()` بحسبِ `LIVE28_CRASH`.
  const serial = JSON.parse(readFileSync(process.env.LIVE28_KEYS, 'utf8'));
  const socket = new FileFreshnessSocket(process.env.LIVE28_REF, {
    crash: process.env.LIVE28_CRASH,
  });
  await bootWith(serial, process.env.LIVE28_ROOT, socket);
  process.exit(0);
} else {
  const { test, describe } = await import('node:test');
  const { registerTmpRoot } = await import('../helpers/tmp-roots.mjs');

  const tmp = (label) => registerTmpRoot(mkdtempSync(join(tmpdir(), `xuux-live28-${label}-`)));
  const body = (root) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body;

  /** يُهيِّئُ جذراً بإقلاعٍ نظيفٍ ثمَّ يُسقِطُ إقلاعاً ثانياً في عمليّةٍ ابنٍ داخلَ `bump()`. */
  async function crashedRoot(label, crash) {
    const dir = tmp(label);
    const root = join(dir, 'root');
    const ref = join(dir, 'freshness.ref');
    const keysFile = join(dir, 'keys.json');
    const serial = serialKeys();
    writeFileSync(keysFile, JSON.stringify(serial), { mode: 0o600 });
    const first = await bootWith(serial, root, new FileFreshnessSocket(ref));
    first.log.close?.();
    assert.equal(body(root).freshnessEpoch, 1);
    const child = spawnSync(process.execPath, [SELF], {
      env: {
        ...process.env,
        LIVE28_CHILD: '1',
        LIVE28_KEYS: keysFile,
        LIVE28_ROOT: root,
        LIVE28_REF: ref,
        LIVE28_CRASH: crash,
      },
      encoding: 'utf8',
    });
    assert.equal(
      child.signal,
      'SIGKILL',
      `العمليّةُ الابنُ لم تَسقُطْ داخلَ bump(): ${child.stderr}`,
    );
    rmSync(join(root, 'events.log.lock'), { force: true });
    return { dir, root, ref, serial };
  }

  describe('WL-321 — LIVE-28: الطيُّ ذو المرحلتَين يحتملُ سقوطَ العمليّةِ بينَ الرفعِ والختم', () => {
    test('L1 — SIGKILL بعدَ رفعِ المرجعِ وقبلَ الختم ⇒ الإقلاعُ التالي يُتِمُّ الطيَّ ولا يُرَدُّ', async () => {
      const { dir, root, ref, serial } = await crashedRoot('l1', 'after');
      try {
        assert.equal(readFileSync(ref, 'utf8').trim(), '2', 'المرجعُ لم يُرفَعْ قبلَ السقوط');
        assert.equal(body(root).freshnessEpoch, 1);
        assert.equal(body(root).freshnessReserved, 2, 'لا حجزَ مختوماً قبلَ رفعِ المرجع');
        const next = await bootWith(serial, root, new FileFreshnessSocket(ref));
        next.log.close?.();
        assert.equal(body(root).freshnessEpoch, Number(readFileSync(ref, 'utf8').trim()));
        assert.equal(body(root).freshnessReserved, undefined, 'حجزٌ باقٍ بعدَ الإتمام');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('L2 — SIGKILL بعدَ الحجزِ وقبلَ رفعِ المرجع ⇒ الإقلاعُ التالي يمضي والعهدُ يساوي المرجع', async () => {
      const { dir, root, ref, serial } = await crashedRoot('l2', 'before');
      try {
        assert.equal(readFileSync(ref, 'utf8').trim(), '1');
        assert.equal(body(root).freshnessReserved, 2);
        const next = await bootWith(serial, root, new FileFreshnessSocket(ref));
        next.log.close?.();
        assert.equal(body(root).freshnessEpoch, 2);
        assert.equal(readFileSync(ref, 'utf8').trim(), '2');
        assert.equal(body(root).freshnessReserved, undefined);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('L3 — لقطةُ الحجزِ بعدَ أن تقدَّمَ المرجعُ أبعدَ من المحجوز ⇒ STALE_MANIFEST_EPOCH', async () => {
      const { dir, root, ref, serial } = await crashedRoot('l3', 'after');
      const snap = join(dir, 'snap');
      try {
        cpSync(root, snap, { recursive: true });
        const next = await bootWith(serial, root, new FileFreshnessSocket(ref));
        next.log.close?.();
        assert.ok(Number(readFileSync(ref, 'utf8').trim()) > body(snap).freshnessReserved);
        rmSync(root, { recursive: true, force: true });
        cpSync(snap, root, { recursive: true });
        await assert.rejects(
          () => bootWith(serial, root, new FileFreshnessSocket(ref)),
          (err) => err.code === 'STALE_MANIFEST_EPOCH',
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('L4 — رفعٌ لا يساوي المحجوزَ (كاتبٌ آخرُ) ⇒ FRESHNESS_RESERVATION_MISMATCH ولا إتمام', async () => {
      const dir = tmp('l4');
      const root = join(dir, 'root');
      const ref = join(dir, 'freshness.ref');
      const serial = serialKeys();
      try {
        const first = await bootWith(serial, root, new FileFreshnessSocket(ref));
        first.log.close?.();
        rmSync(join(root, 'events.log.lock'), { force: true });
        await assert.rejects(
          () => bootWith(serial, root, new FileFreshnessSocket(ref, { foreign: true })),
          (err) => err.code === 'FRESHNESS_RESERVATION_MISMATCH',
        );
        assert.equal(body(root).freshnessEpoch, 1, 'العهدُ خُتِمَ على رفعٍ لم يُحجَز');
        assert.equal(body(root).freshnessReserved, 2);
        rmSync(join(root, 'events.log.lock'), { force: true });
        await assert.rejects(
          () => bootWith(serial, root, new FileFreshnessSocket(ref)),
          (err) => err.code === 'STALE_MANIFEST_EPOCH',
          'حجزٌ ومرجعٌ أبعدُ منه يجبُ أن يُرَدَّ',
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('L5 — حجزٌ لا يساوي `epoch + 1` في متنِ البيان ⇒ STATE_MANIFEST_CORRUPT', async () => {
      const dir = tmp('l5');
      const root = join(dir, 'root');
      const ref = join(dir, 'freshness.ref');
      const serial = serialKeys();
      try {
        const first = await bootWith(serial, root, new FileFreshnessSocket(ref));
        first.log.close?.();
        rmSync(join(root, 'events.log.lock'), { force: true });
        const sealed = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
        sealed.body.freshnessReserved = sealed.body.freshnessEpoch + 3;
        writeFileSync(join(root, MANIFEST), JSON.stringify(sealed, null, 2) + '\n');
        await assert.rejects(
          () => bootWith(serial, root, new FileFreshnessSocket(ref)),
          (err) => err.code === 'STATE_MANIFEST_CORRUPT',
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}
