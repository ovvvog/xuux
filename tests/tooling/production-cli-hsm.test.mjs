// @ts-nocheck
// اختبارُ أدواتِ التشغيلِ الثلاثِ في **الإنتاج** — WL-092 / ADR 0005.
//
// لماذا ملفٌّ منفصلٌ عن `anchor-log-cli.test.mjs` وأخويه: تلك تقيسُ المسارَ
// التطويريَّ بمخزنٍ برمجيّ. وهذه تقيسُ أن الأدواتَ **تعملُ فعلاً** في الإنتاج على
// التوكن، لا أن تبقى «ديناً معلَناً» معطَّلاً كما كانت في WL-089: كلُّ اختبارٍ هنا
// يُقلعُ الأداةَ ببيئةِ إنتاجٍ كاملةِ الشرطِ ويُحقنُ فيها مصدرُ مفاتيحَ يحقّقُ عقدَ
// `HsmKeySource`، فتمرُّ عبرَ `openProductionSigners` والأصنافِ الإنتاجيةِ نفسِها.
//
// والتوكنُ مزيَّفٌ لأن `pkcs11js` وSoftHSM غيرُ متوفّرين في CI — والتوقيعُ
// والتعميةُ فيه حقيقيّان من `node:crypto`. ولا يُدّعى هنا أن توكناً حقيقياً قِيسَ
// في CI: ذاك في `tests/root-of-trust/production-runtime-softhsm.test.mjs` محلياً.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import {
  SEAL_IV_BYTES,
  createProductionRootOfTrust,
  fingerprint,
} from '../../src/root-of-trust/index.mjs';
import { run as runAnchor } from '../../scripts/anchor-log.mjs';
import { run as runHalt } from '../../scripts/halt-switch.mjs';
import { run as runRotate } from '../../scripts/rotate-king-key.mjs';

/** بيئةُ إنتاجٍ كاملةُ الشرط: وضعٌ ووحدةٌ وتوكنٌ وPIN. */
// WL-094 (`UF-05`): التثبيتُ صارَ جزءاً من شرطِ الإنتاج، فبيئةُ الأدواتِ تحملُه.
// وهويةُ الملكِ تُشتقُّ في `context()` من مفتاحِ البديلِ لا تُخترَع.
const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: 'production',
  XUUX_ROOT_OF_TRUST_MODE: 'hsm',
  XUUX_PKCS11_MODULE: '/usr/lib/softhsm/libsofthsm2.so',
  XUUX_PKCS11_TOKEN: 'xuux-test',
  XUUX_PKCS11_TOKEN_SERIAL: 'DEADBEEFCAFE0001',
  XUUX_PKCS11_MODULE_SHA256: 'f'.repeat(64),
  XUUX_PKCS11_PIN: 'fake-pin-not-used-by-injected-source', // secret-scan:allow
  XUUX_ROOT_OF_TRUST_PROVISION: '1',
});

/**
 * توكنٌ مزيَّفٌ: المفاتيحُ لا تخرجُ منه إلا عامّةً، كما يفعلُ التوكن.
 * @returns {object} موفّرٌ يحقّقُ عقدَ `HsmKeySource`
 */
function fakeToken(king = generateKeyPairSync('ed25519')) {
  const aesKeys = new Map([['05', randomBytes(32)]]);
  const edKeys = new Map([
    ['06', king],
    ['07', generateKeyPairSync('ed25519')],
  ]);
  const aad = Buffer.from('xuux-event');
  return {
    describe: () => ({
      kind: 'pkcs11-hsm',
      canExport: false,
      tokenSerial: 'DEADBEEFCAFE0001',
    }),
    getAeadKey: async (keyId) => {
      const key = aesKeys.get(keyId);
      if (!key) throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        encrypt: async (plaintext) => {
          const iv = randomBytes(SEAL_IV_BYTES);
          const cipher = createCipheriv('aes-256-gcm', key, iv);
          cipher.setAAD(aad);
          const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
          return { ciphertext, iv, tag: cipher.getAuthTag() };
        },
        decrypt: async (ciphertext, iv, tag) => {
          const decipher = createDecipheriv('aes-256-gcm', key, iv);
          decipher.setAAD(aad);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        },
      };
    },
    getSigningKey: async (keyId) => {
      const pair = edKeys.get(keyId);
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
 * يهيّئ مجلداً مؤقّتاً وبيئةً وحقنَ مصدرٍ واحدٍ لكلِّ الأدوات.
 * @returns {{root: string, env: object, deps: object, cleanup: () => void}} السياق
 */
function context() {
  const root = mkdtempSync(join(tmpdir(), 'xuux-prod-cli-'));
  const king = generateKeyPairSync('ed25519');
  const token = fakeToken(king);
  return {
    root,
    env: {
      ...PRODUCTION_ENV,
      XUUX_KING_ID: 'king:' + fingerprint(king.publicKey).slice(0, 24),
      EVENT_LOG_FILE: join(root, 'events.log'),
      ANCHOR_STORE_FILE: join(root, 'anchors.jsonl'),
      HALT_SWITCH_FILE: join(root, 'halt', 'directive.json'),
    },
    deps: { openSource: async () => ({ source: token, close: async () => undefined }) },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('أدوات التشغيل في الإنتاج تعمل على التوكن (WL-092)', () => {
  test('anchor-log: الحالة تُقرأ من التوكن لا من مخزن برمجي', async () => {
    const ctx = context();
    try {
      const runtime = await createProductionRootOfTrust(
        ctx.env,
        { root: ctx.root, fsync: false },
        ctx.deps,
      );
      await runtime.log.appendSealed('cli.status', 'مدقّق', { n: 1 });
      await runtime.close();

      const output = await runAnchor(['status', '--json'], ctx.env, ctx.deps);
      const payload = JSON.parse(output);
      assert.equal(payload.mode, 'hsm');
      assert.equal(payload.keyId, '06');
      assert.equal(payload.events, 1);
      assert.deepEqual(payload.acceptedKeyVersions, [1]);
    } finally {
      ctx.cleanup();
    }
  });

  test('anchor-log: التثبيت يقع بمفتاح التوكن والتحقق يقبله', async () => {
    const ctx = context();
    try {
      const runtime = await createProductionRootOfTrust(
        ctx.env,
        { root: ctx.root, fsync: false },
        ctx.deps,
      );
      await runtime.log.appendSealed('cli.anchor', 'مدقّق', { n: 1 });
      await runtime.close();

      const anchored = JSON.parse(
        await runAnchor(['anchor', '--force', '--json'], ctx.env, ctx.deps),
      );
      assert.equal(anchored.anchored, true);
      assert.equal(anchored.mode, 'hsm');
      assert.equal(anchored.anchor.count, 1);

      const verified = JSON.parse(await runAnchor(['verify', '--json'], ctx.env, ctx.deps));
      assert.equal(verified.ok, true);
      assert.equal(verified.anchors, 1);
      assert.equal(verified.provenEvents, 1);

      // والدليلُ على أنّ التثبيتَ حقيقيٌّ لا شكليّ: ملفُّ المخزنِ يحملُ توقيعاً
      // وإصدارَ مفتاح، وسجلُّ الوقائعِ على القرصِ لا نصَّ ظاهرَ فيه.
      const store = readFileSync(ctx.env.ANCHOR_STORE_FILE, 'utf8');
      assert.match(store, /"signature":/);
      const log = readFileSync(ctx.env.EVENT_LOG_FILE, 'utf8');
      assert.equal(log.includes('"n":1'), false);
      assert.match(log, /"alg":"AES-256-GCM"/);
    } finally {
      ctx.cleanup();
    }
  });

  test('halt-switch: الإيقاف والاستئناف يُوقَّعان داخل التوكن', async () => {
    const ctx = context();
    try {
      const halted = JSON.parse(
        await runHalt(['halt', '--reason', 'تمرين إنتاجي', '--json'], ctx.env, ctx.deps),
      );
      assert.equal(halted.halted, true);
      assert.equal(halted.directive.state, 'halted');
      assert.ok(halted.directive.signature.length > 0);

      const verified = JSON.parse(await runHalt(['verify', '--json'], ctx.env, ctx.deps));
      assert.equal(verified.ok, true);

      const resumed = JSON.parse(
        await runHalt(['resume', '--reason', 'انتهى التمرين', '--json'], ctx.env, ctx.deps),
      );
      assert.equal(resumed.resumed, true);
      assert.equal(resumed.directive.state, 'running');
      assert.equal(resumed.directive.epoch, halted.directive.epoch + 1);
    } finally {
      ctx.cleanup();
    }
  });

  test('rotate-king-key: الحالة من التوكن، والتدوير يُردُّ إلى أداة التوكن', async () => {
    const ctx = context();
    const lines = [];
    const errors = [];
    const log = console.log;
    const error = console.error;
    // الاستعادةُ في دالّةٍ مستقلّةٍ لا إسناداً بعدَ `await` في المجالِ نفسِه:
    // إسنادٌ كذلك يُقرأُ سباقاً محتملاً على حالةِ `console`.
    const restore = () => {
      console.log = log;
      console.error = error;
    };
    console.log = (line) => lines.push(String(line));
    console.error = (line) => errors.push(String(line));
    try {
      assert.equal(await runRotate(['status', '--json'], ctx.env, ctx.deps), 0);
      const payload = JSON.parse(lines.join('\n'));
      assert.equal(payload.mode, 'hsm');
      assert.equal(payload.keyId, '06');
      assert.equal(payload.activeVersion, 1);
      assert.match(payload.publicKeyPem, /BEGIN PUBLIC KEY/);
      // لا مادةَ مفتاحٍ خاصٍّ في المخرج — الشرطُ الأصليُّ للأداة.
      assert.equal(payload.publicKeyPem.includes('PRIVATE'), false);

      assert.equal(await runRotate(['rotate'], ctx.env, ctx.deps), 2);
      assert.match(errors.join('\n'), /HSM_ROTATION_REQUIRES_TOKEN_TOOL/);
      assert.match(errors.join('\n'), /scripts\/pkcs11-keygen\.mjs/);

      assert.equal(
        await runRotate(['revoke', '--version', '1', '--reason', 'س'], ctx.env, ctx.deps),
        2,
      );
    } finally {
      restore();
      ctx.cleanup();
    }
  });
});
