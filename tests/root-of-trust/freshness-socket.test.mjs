// @ts-nocheck
// tests/root-of-trust/freshness-socket.test.mjs
//
// اختبارُ قبولٍ موحَّدٌ لمجموعةِ rollback الخمس (UF-01 · UF-03 · UF-07 ·
// M11.04-F07 · R4-K3-01).
//
// **المرحلةُ الأولى — إثباتُ القبولِ على الأساسِ الحالي:** لقطةٌ كاملةٌ متّسقةٌ
// (البيانُ المختومُ + دفترُ الرفعِ + السجلُ + الإيقافُ) تُقبَلُ بلا مصدرِ
// حداثةٍ موصولٍ. هذا هو الحدُّ المُعلَنُ في ADR 0006.
//
// **المرحلةُ الثانية — إثباتُ الرفضِ بعدَ وصلِ مصدرِ حداثةٍ:** نفسُ اللقطةِ
// تُرفَضُ بفشلٍ مغلقٍ ورمزٍ ثابتٍ `STALE_MANIFEST_EPOCH` حين يكونُ مصدرُ الحداثةِ
// قد تقدّمَ. الواجهةُ وحدَها ليست إصلاحاً: لا يُدَّعى منعُ rollback حتى يصبحَ
// مصدرُ الحداثةِ الحقيقيُّ موصولاً.
//
// **حدٌّ مُعلَنٌ:** هذا اختبارُ قبولٍ لا إغلاقٌ. صلاحيّةُ الإغلاقِ للمجلسِ.

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
import { InMemoryFreshnessSocket, NullFreshnessSocket } from '../../src/root-of-trust/index.mjs';

const MANIFEST = 'root-of-trust.manifest.json';

/**
 * توكنٌ مزيَّفٌ ثابتُ المفاتيحِ عبرَ الإقلاعاتِ.
 */
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
          const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
          return { ciphertext, iv, tag: cipher.getAuthTag() };
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
 * جهازُ اختبارٍ ثابتُ الهويةِ.
 */
function rig(freshnessSocket = null) {
  const king = generateKeyPairSync('ed25519');
  const aeadKey = randomBytes(32);
  const ledgerPair = generateKeyPairSync('ed25519');
  const env = {
    NODE_ENV: 'production',
    XUUX_ROOT_OF_TRUST_MODE: 'hsm',
    XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
    XUUX_PKCS11_TOKEN: 'xuux-test',
    XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
    XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
    XUUX_PKCS11_PIN: 'unused-by-injected-source',
    XUUX_KING_ID: 'king:' + fingerprint(king.publicKey).slice(0, 24),
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
  };
  const boot = (root) =>
    createProductionRootOfTrust(
      env,
      { root, fsync: false, royalCommandVerifier: () => true, freshnessSocket },
      {
        openSource: async () => ({
          source: stableToken(king, aeadKey, ledgerPair),
          close: async () => undefined,
        }),
      },
    );
  return {
    boot,
    body: (root) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body,
    king,
    freshnessSocket,
  };
}

describe('FreshnessSocket — اختبارُ قبولٍ موحَّدٌ لمجموعةِ rollback', () => {
  test('المرحلةُ 1: لقطةٌ كاملةٌ متّسقةٌ تُقبَلُ بلا مصدرِ حداثةٍ (NullFreshnessSocket)', async () => {
    const { boot, body } = rig(NullFreshnessSocket.INSTANCE);
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-fresh-')));
    const snapshot = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-fresh-snap-')));
    try {
      const first = await boot(root);
      first.log.close?.();

      // لقطةٌ كاملةٌ للجذرِ
      rmSync(snapshot, { recursive: true, force: true });
      cpSync(root, snapshot, { recursive: true });

      // تقدّمُ الحالةِ: أمرٌ موقَّعٌ ثمَّ إيقافٌ سياديٌّ
      const second = await boot(root);
      const command = { id: 'أمرٌ-قابلٌ-للإعادة' };
      second.ledger.begin(command);
      await second.ledger.commitSigned(command, 'تمّ');
      await second.haltSwitch.haltAsync('إيقافٌ سياديّ', { id: 'test-cmd' });
      assert.equal(body(root).haltEpoch >= 1, true);
      assert.equal(body(root).ledgerCommitted >= 1, true);
      second.log.close?.();

      // الخصمُ يملكُ القرصَ: يُعيدُ اللقطةَ كلَّها
      rmSync(root, { recursive: true, force: true });
      cpSync(snapshot, root, { recursive: true });

      // الحدُّ المُعلَنُ: اللقطةُ الكاملةُ المتّسقةُ تُقبَلُ بلا مصدرِ حداثةٍ
      const third = await boot(root);
      try {
        assert.equal(third.haltSwitch.read().state, 'running', 'الإيقافُ نجا من الإعادةِ');
        assert.equal(body(root).freshnessEpoch, 0, 'لا مصدرَ حداثةٍ موصولٍ');
      } finally {
        third.log.close?.();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });

  test('المرحلةُ 2: لقطةٌ كاملةٌ متّسقةٌ تُرفَضُ بـSTALE_MANIFEST_EPOCH بعدَ وصلِ مصدرِ حداثةٍ', async () => {
    const socket = new InMemoryFreshnessSocket(0n, 'test');
    const { boot, body } = rig(socket);
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-fresh-')));
    const snapshot = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-fresh-snap-')));
    try {
      // الإقلاعُ الأوّلُ بمصدرِ حداثةٍ موصولٍ: العَهْدُ يُرفعُ ويُخزَّنُ
      const first = await boot(root);
      first.log.close?.();
      const firstEpoch = body(root).freshnessEpoch;
      assert.equal(firstEpoch >= 1, true, 'العَهْدُ لم يُرفَعْ في الإقلاعِ الأوّل');

      // لقطةٌ كاملةٌ بعدَ الإقلاعِ الأوّل
      rmSync(snapshot, { recursive: true, force: true });
      cpSync(root, snapshot, { recursive: true });

      // تقدّمُ الحالةِ: يُرفعُ العَهْدُ في مصدرِ الحداثةِ ويُخزَّنُ في البيانِ
      const second = await boot(root);
      const command = { id: 'أمرٌ-يُرفَضُ لاحقاً' };
      second.ledger.begin(command);
      await second.ledger.commitSigned(command, 'تمّ');
      await second.haltSwitch.haltAsync('إيقافٌ سياديّ', { id: 'test-cmd' });
      second.log.close?.();
      const secondEpoch = body(root).freshnessEpoch;
      assert.equal(secondEpoch > firstEpoch, true, 'العَهْدُ لم يتقدّمْ');

      // الخصمُ يملكُ القرصَ: يُعيدُ اللقطةَ القديمةَ (العَهْدُ فيها أقلُّ)
      rmSync(root, { recursive: true, force: true });
      cpSync(snapshot, root, { recursive: true });

      // مصدرُ الحداثةِ في الذاكرةِ: عَهْدُهُ أعلى من اللقطةِ المستعادةِ
      // ⇒ رفضٌ مغلقٌ برمزٍ ثابتٍ
      await assert.rejects(
        () => boot(root),
        (err) => {
          const code = /** @type {Error & { code?: string }} */ (err).code;
          return code === 'STALE_MANIFEST_EPOCH';
        },
        'اللقطةُ القديمةُ المتّسقةُ يجبُ أن تُرفَضَ حين يكونَ مصدرُ الحداثةِ قد تقدّمَ',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });

  test('الواجهةُ وحدَها ليست إصلاحاً: NullFreshnessSocket لا يمنعُ rollback', async () => {
    const { boot, body } = rig(null);
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-fresh-null-')));
    const snapshot = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-fresh-null-snap-')));
    try {
      const first = await boot(root);
      first.log.close?.();

      rmSync(snapshot, { recursive: true, force: true });
      cpSync(root, snapshot, { recursive: true });

      const second = await boot(root);
      second.ledger.begin({ id: 'أمرٌ-قابلٌ-للإعادة' });
      await second.ledger.commitSigned({ id: 'أمرٌ-قابلٌ-للإعادة' }, 'تمّ');
      await second.haltSwitch.haltAsync('إيقافٌ سياديّ', { id: 'test-cmd' });
      second.log.close?.();

      rmSync(root, { recursive: true, force: true });
      cpSync(snapshot, root, { recursive: true });

      // بلا مصدرِ حداثةٍ: اللقطةُ القديمةُ تُقبَلُ — الحدُّ المُعلَنُ قائمٌ
      const third = await boot(root);
      try {
        assert.equal(third.haltSwitch.read().state, 'running');
        assert.equal(body(root).freshnessEpoch, 0, 'لا عَهْدَ حداثةٍ بلا مصدرٍ موصولٍ');
      } finally {
        third.log.close?.();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });
});
