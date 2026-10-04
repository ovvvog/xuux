// @ts-nocheck
// tests/root-of-trust/freshness-socket.test.mjs
//
// اختبارُ إنفاذِ الحداثةِ ومضادِّ الإعادة — P0 Freshness Enforcement.
//
// الحالاتُ الخمسُ المطلوبةُ:
//   Case 1: لقطةٌ قديمةٌ متّسقةٌ → REJECT (STALE_MANIFEST_EPOCH)
//   Case 2: لقطةٌ أحدثُ من المرجعِ بلا إذنٍ → REJECT (FRESHNESS_EPOCH_REGRESSION)
//   Case 3: إعادةُ لقطةٍ سابقةٍ → REJECT (STALE_MANIFEST_EPOCH)
//   Case 4: استعادةٌ بعدَ عطلٍ → لا تُقبَلُ حالةٌ قديمةٌ
//   Case 5: تقدّمٌ رتيبٌ ناجحٌ → ACCEPT
//
// وأيضاً:
//   - الإنتاجُ بلا مقبسِ حداثةٍ → REJECT (PRODUCTION_FRESHNESS_SOCKET_REQUIRED)
//   - التطويرُ بلا مقبسِ حداثةٍ → قبولٌ (الحدُّ المُعلَنُ في ADR 0006 قائمٌ)

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { createProductionRootOfTrust, fingerprint } from '../../src/root-of-trust/index.mjs';
import { InMemoryFreshnessSocket } from '../../src/root-of-trust/index.mjs';
import { registerTestKing, royalCommandFor, royalKeyEnv } from '../helpers/royal-halt-command.mjs';

/** `LIVE-24`: مفتاحٌ ملكيٌّ مستقلٌّ عن مفتاحِ المرساةِ في التوكن. */
const ROYAL_KEY = royalKeyEnv();

const MANIFEST = 'root-of-trust.manifest.json';

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

/** مفاتيحُ ثابتةٌ للاختبار. */
function fixedKeys() {
  return {
    king: registerTestKing(generateKeyPairSync('ed25519')),
    aeadKey: randomBytes(32),
    ledgerPair: registerTestKing(generateKeyPairSync('ed25519')),
  };
}

/**
 * يُنشئُ بيئةَ إنتاجٍ ووظيفةَ إقلاعٍ بمفاتيحَ ومقبسِ حداثةٍ محدَّدين.
 * يُسمحُ بتمريرِ مفاتيحٍ موجودةٍ لإعادةِ الاستخدامِ عبرَ الإقلاعاتِ.
 */
function rig({ freshnessSocket = null, production = true, keys } = {}) {
  const k = keys ?? fixedKeys();
  const env = {
    NODE_ENV: production ? 'production' : 'development',
    STATE_ENV: production ? 'production' : 'development',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source',
    XUUX_KING_ID: 'king:' + fingerprint(k.king.publicKey).slice(0, 24),
    ...ROYAL_KEY.env,
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
  };
  const boot = (root) =>
    createProductionRootOfTrust(
      env,
      { root, fsync: false, freshnessSocket },
      {
        openSource: async () => ({
          source: stableToken(k.king, k.aeadKey, k.ledgerPair),
          close: async () => undefined,
        }),
      },
    );
  return {
    boot,
    body: (root) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body,
    keys: k,
    env,
  };
}

function tmp(label) {
  return registerTmpRoot(mkdtempSync(join(tmpdir(), `xuux-${label}-`)));
}

describe('P0 Freshness Enforcement — إنفاذُ الحداثةِ ومضادِّ الإعادة', () => {
  test('الإنتاجُ بلا مقبسِ حداثةٍ → REJECT (PRODUCTION_FRESHNESS_SOCKET_REQUIRED)', async () => {
    const { boot } = rig({ freshnessSocket: null, production: true });
    const root = tmp('prod-no-socket');
    try {
      await assert.rejects(
        () => boot(root),
        (err) => err.code === 'PRODUCTION_FRESHNESS_SOCKET_REQUIRED',
        'الإنتاجُ بلا مقبسِ حداثةٍ يجبُ أن يُرفَضَ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('التطويرُ بلا مقبسِ حداثةٍ → قبولٌ (ADR 0006)', async () => {
    const { boot, body } = rig({ freshnessSocket: null, production: false });
    const root = tmp('dev-no-socket');
    try {
      const rt = await boot(root);
      assert.equal(body(root).freshnessEpoch, 0);
      rt.log.close?.();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('Case 1: لقطةٌ قديمةٌ متّسقةٌ → REJECT (STALE_MANIFEST_EPOCH)', async () => {
    const socket = new InMemoryFreshnessSocket(0n, 'test');
    const { boot, body } = rig({ freshnessSocket: socket, production: true });
    const root = tmp('case1');
    const snap = tmp('case1-snap');
    try {
      const first = await boot(root);
      first.log.close?.();
      const firstEpoch = body(root).freshnessEpoch;
      assert.ok(firstEpoch >= 1);

      rmSync(snap, { recursive: true, force: true });
      cpSync(root, snap, { recursive: true });

      const second = await boot(root);
      await second.ledger.beginAsync({ id: 'cmd-1' });
      await second.ledger.commitSigned({ id: 'cmd-1' }, 'ok');
      second.log.close?.();

      rmSync(root, { recursive: true, force: true });
      cpSync(snap, root, { recursive: true });

      await assert.rejects(
        () => boot(root),
        (err) => err.code === 'STALE_MANIFEST_EPOCH',
        'اللقطةُ القديمةُ يجبُ أن تُرفَضَ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snap, { recursive: true, force: true });
    }
  });

  test('Case 2: لقطةٌ أحدثُ من المرجعِ بلا إذنٍ → REJECT (FRESHNESS_EPOCH_REGRESSION)', async () => {
    const keys = fixedKeys();
    // إقلاعٌ أوّلُ بمقبسٍ يبدأُ من 0 → العَهْدُ يرتفعُ
    const sock1 = new InMemoryFreshnessSocket(0n, 'test');
    const { boot: boot1, body: body1 } = rig({ freshnessSocket: sock1, production: true, keys });
    const root = tmp('case2');
    try {
      const rt = await boot1(root);
      rt.log.close?.();
      const manifestEpoch = body1(root).freshnessEpoch;
      assert.ok(manifestEpoch >= 1, 'العَهْدُ لم يُرفَعْ');

      // إقلاعٌ ثانٍ بمقبسٍ جديدٍ يبدأُ من 0 (أقلَّ من manifestEpoch)
      // البيانُ متقدّمٌ على المرجعِ ⇒ تقدّمٌ غيرُ مُشروعٍ
      const sock2 = new InMemoryFreshnessSocket(0n, 'test');
      const { boot: boot2 } = rig({ freshnessSocket: sock2, production: true, keys });

      await assert.rejects(
        () => boot2(root),
        (err) => err.code === 'FRESHNESS_EPOCH_REGRESSION',
        'البيانُ الأحدثُ من المرجعِ يجبُ أن يُرفَضَ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('Case 3: إعادةُ لقطةٍ سابقةٍ → REJECT (STALE_MANIFEST_EPOCH)', async () => {
    const socket = new InMemoryFreshnessSocket(0n, 'test');
    const { boot, body } = rig({ freshnessSocket: socket, production: true });
    const root = tmp('case3');
    const snap = tmp('case3-snap');
    try {
      const first = await boot(root);
      await first.ledger.beginAsync({ id: 'replay-cmd' });
      await first.ledger.commitSigned({ id: 'replay-cmd' }, 'ok');
      await first.haltSwitch.haltAsync('halt', royalCommandFor(first.haltSwitch, 'halt', 'halt'));
      first.log.close?.();
      const firstEpoch = body(root).freshnessEpoch;
      assert.ok(firstEpoch >= 1);

      rmSync(snap, { recursive: true, force: true });
      cpSync(root, snap, { recursive: true });

      const second = await boot(root);
      await second.ledger.beginAsync({ id: 'cmd-2' });
      await second.ledger.commitSigned({ id: 'cmd-2' }, 'ok');
      second.log.close?.();
      assert.ok(body(root).freshnessEpoch > firstEpoch);

      rmSync(root, { recursive: true, force: true });
      cpSync(snap, root, { recursive: true });

      await assert.rejects(
        () => boot(root),
        (err) => err.code === 'STALE_MANIFEST_EPOCH',
        'إعادةُ لقطةٍ سابقةٍ يجبُ أن تُرفَضَ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snap, { recursive: true, force: true });
    }
  });

  test('Case 4: استعادةٌ بعدَ عطلٍ → لا تُقبَلُ حالةٌ قديمةٌ', async () => {
    const socket = new InMemoryFreshnessSocket(0n, 'test');
    const { boot, body } = rig({ freshnessSocket: socket, production: true });
    const root = tmp('case4');
    const snap = tmp('case4-snap');
    try {
      const first = await boot(root);
      first.log.close?.();
      const firstEpoch = body(root).freshnessEpoch;

      rmSync(snap, { recursive: true, force: true });
      cpSync(root, snap, { recursive: true });

      const second = await boot(root);
      await second.ledger.beginAsync({ id: 'pre-crash' });
      await second.ledger.commitSigned({ id: 'pre-crash' }, 'ok');
      second.log.close?.();
      assert.ok(body(root).freshnessEpoch > firstEpoch);

      // العطلُ: استعادةُ لقطةٍ من قبلَ التقدّمِ
      rmSync(root, { recursive: true, force: true });
      cpSync(snap, root, { recursive: true });

      await assert.rejects(
        () => boot(root),
        (err) => err.code === 'STALE_MANIFEST_EPOCH',
        'استعادةُ حالةٍ قديمةٍ بعدَ عطلٍ يجبُ أن تُرفَضَ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snap, { recursive: true, force: true });
    }
  });

  test('Case 5: تقدّمٌ رتيبٌ ناجحٌ → ACCEPT', async () => {
    const socket = new InMemoryFreshnessSocket(0n, 'test');
    const { boot, body } = rig({ freshnessSocket: socket, production: true });
    const root = tmp('case5');
    try {
      const first = await boot(root);
      await first.ledger.beginAsync({ id: 'p1' });
      await first.ledger.commitSigned({ id: 'p1' }, 'ok');
      first.log.close?.();
      const e1 = body(root).freshnessEpoch;
      assert.ok(e1 >= 1);

      const second = await boot(root);
      await second.ledger.beginAsync({ id: 'p2' });
      await second.ledger.commitSigned({ id: 'p2' }, 'ok');
      second.log.close?.();
      const e2 = body(root).freshnessEpoch;
      assert.ok(e2 > e1, 'العَهْدُ لم يتقدّمْ في الإقلاعِ الثاني');

      const third = await boot(root);
      await third.ledger.beginAsync({ id: 'p3' });
      await third.ledger.commitSigned({ id: 'p3' }, 'ok');
      third.log.close?.();
      const e3 = body(root).freshnessEpoch;
      assert.ok(e3 > e2, 'العَهْدُ لم يتقدّمْ في الإقلاعِ الثالث');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // R10-F-01 (WL-308): بيانٌ مختومٌ عهدُه `0` لا يُعفى من مقارنتِه بالمرجعِ الخارجيِّ.
  // يُلتقَطُ البيانُ الصفريُّ المختومُ في نافذةِ الإقلاعِ الأوّلِ (المسارُ (أ) في تقريرِ
  // المجلسِ): نقطةُ الضبطِ تُختَمُ قبلَ طيِّ العهدِ، فنَسخُ الجذرِ لحظةَ `bump()` الأولى
  // يُعطي لقطةً صحيحةَ الخاتَمِ عهدُها `0`.
  test('R10-F-01: لقطةٌ مختومةٌ صفريّةُ العهدِ بعدَ تقدُّمِ المرجعِ → REJECT (STALE_MANIFEST_EPOCH)', async () => {
    const keys = fixedKeys();
    const inner = new InMemoryFreshnessSocket(0n, 'test');
    const root = tmp('r10f01');
    const snap = tmp('r10f01-snap');
    let captured = false;
    const socket = {
      read: () => inner.read(),
      bump: async () => {
        if (!captured) {
          captured = true;
          rmSync(snap, { recursive: true, force: true });
          cpSync(root, snap, { recursive: true });
        }
        return inner.bump();
      },
    };
    const { boot, body } = rig({ freshnessSocket: socket, production: true, keys });
    try {
      const first = await boot(root);
      await first.ledger.beginAsync({ id: 'r10-cmd' });
      await first.ledger.commitSigned({ id: 'r10-cmd' }, 'ok');
      first.log.close?.();
      assert.ok(captured, 'النافذةُ لم تُلتقَطْ');
      assert.equal(body(snap).freshnessEpoch, 0, 'اللقطةُ الملتقَطةُ ليست صفريّةَ العهدِ');
      assert.ok(body(root).freshnessEpoch >= 1);
      assert.ok(Number((await inner.read()).epoch) >= 1);

      rmSync(root, { recursive: true, force: true });
      cpSync(snap, root, { recursive: true });
      await assert.rejects(
        () => boot(root),
        (err) => err.code === 'STALE_MANIFEST_EPOCH',
        'اللقطةُ الصفريّةُ المختومةُ بعدَ تقدُّمِ المرجعِ يجبُ أن تُرفَضَ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snap, { recursive: true, force: true });
    }
  });
});
