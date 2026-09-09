// @ts-nocheck
// tests/root-of-trust/replay-limit.test.mjs
//
// شاهدُ الحدِّ الأمنيِّ القائمِ — WL-099.
//
// هذا الملفُّ **لا يُثبِتُ إصلاحاً**؛ يُثبِتُ **حدّاً**: أنّ استرجاعَ لقطةٍ
// كاملةٍ متّسقةٍ لجذرِ الحالةِ (البيانُ المختومُ ودفترُ رفعِه والسجلُّ والدفترُ
// ومجلَّدُ الإيقافِ) معَ حالةِ التوكنِ نفسِها **ينجحُ**: تعودُ الدولةُ من
// `halted` إلى `running`، ويُقبَلُ أمرٌ كان قد ثُبِّتَ. وصحّةُ التوقيعِ لا
// تكشفُه لأنّ الخاتَمَ وقّعَ تلك الحالةَ بنفسِه.
//
// التفصيلُ والخياراتُ في
// `docs/adr/0006-state-manifest-seal-and-anti-rollback-limit.md`، والنصوصُ
// الخامّةُ — بمصدرٍ محقونٍ **وعلى SoftHSM حقيقيٍّ** — في
// `docs/external-review/evidence/WL-099-full-snapshot-replay.md`.
//
// **عقدُ التعديلِ:** إن نُفِّذَ يوماً منعُ إعادةٍ (عدّادٌ رتيبٌ في عتادٍ، أو
// مرساةٌ خارجَ نطاقِ القرصِ، أو توقيعٌ سياديٌّ دوريٌّ)، فهذا الشاهدُ **يجبُ
// أن يفشلَ**، ولا يُصحَّحُ إلّا معَ تحديثِ `ADR 0006` ومدخلةِ عملٍ جديدةٍ. وهو
// لا يُغلِقُ `R3-A-01` ولا يُخفِّفُ حكمَه؛ الأحكامُ للمجلسِ.

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

import {
  SEAL_IV_BYTES,
  createProductionRootOfTrust,
  fingerprint,
} from '../../src/root-of-trust/index.mjs';

const MANIFEST = 'root-of-trust.manifest.json';

/**
 * توكنٌ مزيَّفٌ **ثابتُ المفاتيحِ** عبرَ الإقلاعاتِ — نظيرُ توكنٍ لم يُبدَّل.
 * @param king - زوجُ مفاتيحِ الملك
 * @param aeadKey - مفتاحُ الختمِ المتماثلُ الثابت
 * @param ledgerPair - مفتاحُ توقيعِ الدفترِ الثابت
 * @returns موفّرٌ يحقّقُ عقدَ `HsmKeySource`
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
          const iv = randomBytes(SEAL_IV_BYTES);
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
 * جهازٌ ثابتُ الهويةِ يُقلعُ الجذرَ نفسَه مرّاتٍ متعدّدةً.
 * @returns دالةُ الإقلاعِ ودالةُ قراءةِ المتنِ
 */
function rig() {
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
    XUUX_PKCS11_PIN: 'unused-by-injected-source', // secret-scan:allow
    XUUX_KING_ID: 'king:' + fingerprint(king.publicKey).slice(0, 24),
    XUUX_ROOT_OF_TRUST_PROVISION: '1',
  };
  const boot = (root) =>
    createProductionRootOfTrust(
      env,
      { root, fsync: false },
      {
        openSource: async () => ({
          source: stableToken(king, aeadKey, ledgerPair),
          close: async () => undefined,
        }),
      },
    );
  return { boot, body: (root) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')).body };
}

describe('حدُّ الإعادةِ — لقطةٌ كاملةٌ متّسقةٌ لا يكشفُها الخاتَم', () => {
  test('استرجاعُ الجذرِ كلِّه يُعيدُ halted إلى running ويُقبَلُ أمرٌ مُثبَّتٌ سابقاً', async () => {
    const { boot, body } = rig();
    const root = mkdtempSync(join(tmpdir(), 'xuux-replay-'));
    const snapshot = mkdtempSync(join(tmpdir(), 'xuux-replay-snap-'));
    try {
      const first = await boot(root);
      first.log.close?.();

      // لقطةٌ **كاملةٌ** للجذرِ عندَ زمنٍ صحيحٍ.
      rmSync(snapshot, { recursive: true, force: true });
      cpSync(root, snapshot, { recursive: true });

      // تقدّمُ الحالةِ: أمرٌ موقَّعٌ ثمَّ إيقافٌ سياديٌّ موقَّع.
      const second = await boot(root);
      const command = { id: 'أمرٌ-قابلٌ-للإعادة' };
      second.ledger.begin(command);
      await second.ledger.commitSigned(command, 'تمّ');
      const directive = await second.haltSwitch.haltAsync('إيقافٌ سياديّ');
      assert.equal(directive.state, 'halted');
      assert.equal(body(root).haltEpoch >= 1, true);
      assert.equal(body(root).ledgerCommitted >= 1, true);
      second.log.close?.();

      // الخصمُ يملكُ القرصَ: يمحو الجذرَ ويُعيدُ اللقطةَ كلَّها معاً.
      rmSync(root, { recursive: true, force: true });
      cpSync(snapshot, root, { recursive: true });

      const third = await boot(root);
      try {
        // الحدُّ المُعلَنُ: لا رفضَ، والحالةُ رجعَت.
        assert.equal(third.haltSwitch.read().state, 'running', 'الإيقافُ نجا من الإعادةِ');
        assert.equal(third.haltSwitch.read().epoch, 0, 'العهدُ لم يرجعْ بالإعادةِ');
        // والأمرُ الذي ثُبِّتَ ووُقِّعَ يُقبَلُ ثانيةً.
        third.ledger.begin(command);
        await third.ledger.commitSigned(command, 'إعادةُ تنفيذٍ');
        assert.equal(body(root).ledgerCommitted >= 1, true);
      } finally {
        third.log.close?.();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });

  test('لا مرجعَ حداثةٍ خارجَ اللقطةِ: تسلسلُ الختمِ يرجعُ إلى الوراءِ بلا كشف', async () => {
    const { boot, body } = rig();
    const root = mkdtempSync(join(tmpdir(), 'xuux-replay-'));
    const snapshot = mkdtempSync(join(tmpdir(), 'xuux-replay-snap-'));
    try {
      const first = await boot(root);
      first.log.close?.();
      const snapshotSequence = body(root).sequence;
      rmSync(snapshot, { recursive: true, force: true });
      cpSync(root, snapshot, { recursive: true });

      const second = await boot(root);
      const command = { id: 'أمرٌ-يُسقَط' };
      second.ledger.begin(command);
      await second.ledger.commitSigned(command, 'تمّ');
      await second.haltSwitch.haltAsync('إيقافٌ سياديّ');
      const advancedSequence = body(root).sequence;
      second.log.close?.();
      assert.equal(advancedSequence > snapshotSequence, true, 'التسلسلُ لم يتقدّمْ');

      rmSync(root, { recursive: true, force: true });
      cpSync(snapshot, root, { recursive: true });
      const third = await boot(root);
      try {
        // الشاهدُ: الجذرُ أقلعَ بمتنٍ تسلسلُه أقلُّ ممّا بلغَه فعلاً، ولا شيءَ
        // في النظامِ يعرفُ ذلك — لأنّ كلَّ مرجعِ حداثةٍ داخلَ اللقطةِ المستعادةِ.
        assert.equal(body(root).sequence < advancedSequence, true, 'التسلسلُ لم يرجعْ');
        assert.equal(body(root).haltEpoch, 0, 'العهدُ لم يرجعْ');
      } finally {
        third.log.close?.();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });
});
