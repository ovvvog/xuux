// @ts-nocheck
// اختبار الربط الإنتاجي لمفاتيح HSM — WL-088 / ADR 0003.
//
// لماذا موفّرٌ مزيَّف لا SoftHSM: اختبارات `pkcs11-provider.test.mjs` تُتجاوز
// كلها في CI (لا SoftHSM ولا pkcs11js هناك)، واختبارٌ يُتجاوز لا يحمي شيئاً.
// فالمزيَّف هنا يحقق عقد `HsmKeySource` حرفياً — يوقّع ويشفّر ولا يُخرج مادة —
// فيُشتغَّل كل منطق الربط والرفض في CI فعلاً. والمادة الخاصة داخل المزيَّف
// محصورةٌ في المزيَّف نفسه: كود الإنتاج في `hsm-binding.mts` لا يراها ولا
// يستطيع بلوغها، وذاك ما يُثبته الاختبار الخصمي الساكن في الملف المجاور.
//
// ما يُقاس هنا: ختم F05 وفكّه، توقيع F06 للتثبيتات، توقيع F07 لسطور الدفتر،
// ورفض كل مسار برمجي للمادة الخاصة.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import {
  EventLog,
  FileAnchorStore,
  HSM_KEY_ROLES,
  HsmBindingError,
  HsmBindingErrorCodes,
  HsmSigner,
  SEAL_ALGORITHM,
  SEAL_IV_BYTES,
  SEAL_TAG_BYTES,
  SOFTWARE_KEY_ENV_VARS,
  anchorLogWithHsm,
  assertNoSoftwareKeyFallback,
  assertNonExportingSource,
  bindHsmRootOfTrust,
  createHsmAnchor,
  ledgerEntryBody,
  openEventData,
  sealEventData,
  signLedgerEntry,
  verifyAnchorChain,
  verifyAnchoredLog,
  verifyLedgerEntry,
} from '../../src/root-of-trust/index.mjs';

/**
 * توكن مزيَّف: يحفظ المفاتيح داخله ولا يُصدِّر إلا العام، كما يفعل التوكن.
 * @returns موفّراً يحقق عقد `HsmKeySource`
 */
function fakeToken() {
  const aesKeys = new Map();
  const edKeys = new Map();
  for (const keyId of ['05']) aesKeys.set(keyId, randomBytes(32));
  for (const keyId of ['06', '07']) edKeys.set(keyId, generateKeyPairSync('ed25519'));
  const aad = Buffer.from('xuux-event');
  return {
    describe: () => ({ canExport: false }),
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

/** بيئة نظيفة: بلا أي متغيّر مخزن مفاتيح برمجي. */
const CLEAN_ENV = Object.freeze({ NODE_ENV: 'production' });
/**
 * يمسك الخطأ المرفوع ليُفحص حقلاه؛ `assert.throws` لا يعيد الخطأ.
 * @param fn - الدالة المتوقّع فشلها
 * @returns الخطأ المرفوع
 */
function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفع خطأ');
}

describe('خريطة الأدوار مثبَّتة في الكود', () => {
  test('المعرّفات والأسماء هي 05/06/07 بأسمائها في التوكن', () => {
    assert.deepEqual(HSM_KEY_ROLES.eventLogAead, { keyId: '05', label: 'event-log-aead-key' });
    assert.deepEqual(HSM_KEY_ROLES.kingSigning, { keyId: '06', label: 'king-signing-key' });
    assert.deepEqual(HSM_KEY_ROLES.commandLedgerSigning, {
      keyId: '07',
      label: 'command-ledger-signing-key',
    });
  });

  test('رموز الأخطاء مثبَّتة نصاً وفريدة', () => {
    assert.equal(new Set(HsmBindingErrorCodes).size, HsmBindingErrorCodes.length);
    assert.ok(HsmBindingErrorCodes.includes('HSM_SYNC_SIGN_UNSUPPORTED'));
    assert.ok(HsmBindingErrorCodes.includes('HSM_SOFTWARE_FALLBACK_FORBIDDEN'));
  });

  test('ثوابت الختم هي AES-256-GCM بـ96 بت متجهاً و128 بت علامة', () => {
    assert.equal(SEAL_ALGORITHM, 'AES-256-GCM');
    assert.equal(SEAL_IV_BYTES, 12);
    assert.equal(SEAL_TAG_BYTES, 16);
  });
});

describe('F05 — ختم جسم الحدث داخل التوكن', () => {
  test('ختمٌ ثم فكٌّ يعيد البيانات نفسها', async () => {
    const token = fakeToken();
    const handle = await token.getAeadKey('05');
    const data = { actor: 'king', amount: 42, nested: { list: [1, 2, 3] } };
    const sealed = await sealEventData(handle, data);
    assert.equal(sealed.alg, SEAL_ALGORITHM);
    assert.equal(sealed.keyId, '05');
    assert.deepEqual(await openEventData(handle, sealed), data);
  });

  test('النص الصريح لا يظهر في الختم', async () => {
    const token = fakeToken();
    const handle = await token.getAeadKey('05');
    const sealed = await sealEventData(handle, { secret: 'ملك-الدولة-الرقمية' });
    assert.ok(!JSON.stringify(sealed).includes('ملك-الدولة-الرقمية'));
  });

  test('ختمان لنفس البيانات يختلفان (متجه تهيئة جديد كل مرة)', async () => {
    const token = fakeToken();
    const handle = await token.getAeadKey('05');
    const a = await sealEventData(handle, { x: 1 });
    const b = await sealEventData(handle, { x: 1 });
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ct, b.ct);
  });

  test('null وقيمة بسيطة تُختمان وتُفكّان', async () => {
    const token = fakeToken();
    const handle = await token.getAeadKey('05');
    assert.equal(await openEventData(handle, await sealEventData(handle, null)), null);
    assert.equal(await openEventData(handle, await sealEventData(handle, 'نص')), 'نص');
  });
});

describe('F06 — تثبيت موقَّع داخل التوكن', () => {
  test('التوقيع يتحقق بالمفتاح العام المُصدَّر، والمعرّف بصمة ملك', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'kingSigning', { env: CLEAN_ENV });
    assert.match(signer.id, /^king:[0-9a-f]{24}$/);
    assert.equal(signer.keyId, '06');
    assert.equal(signer.activeVersion, 1);
    const payload = { a: 1 };
    const signature = await signer.signAsync(payload);
    assert.equal(Buffer.from(signature, 'base64url').length, 64);
    assert.ok(signer.verify(payload, signature));
    assert.ok(!signer.verify({ a: 2 }, signature));
    assert.equal(signer.verifyingVersion(payload, signature), 1);
    assert.equal(signer.verifyingVersion({ a: 2 }, signature), null);
  });

  test('المفتاح العام المُصدَّر هو Ed25519 فعلاً', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'kingSigning', { env: CLEAN_ENV });
    assert.equal(createPublicKey(signer.publicKeyPem).asymmetricKeyType, 'ed25519');
  });

  test('تثبيتٌ عتاديٌّ يجتاز `verifyAnchorChain` القائم بلا تعديل فيه', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'kingSigning', {
      env: CLEAN_ENV,
      keyVersion: 2,
    });
    const first = await createHsmAnchor({ count: 3, lastHash: 'h3' }, null, signer);
    const second = await createHsmAnchor({ count: 5, lastHash: 'h5' }, first, signer);
    assert.equal(first.seq, 1);
    assert.equal(second.previousAnchorHash, first.hash);
    assert.equal(second.keyVersion, 2);
    const result = verifyAnchorChain([first, second], signer);
    assert.ok(result.ok, result.problem);
    assert.deepEqual(result.keyVersions, [2, 2]);
    assert.equal(result.provenEvents, 5);
  });

  test('سجلٌ حقيقي يُثبَّت ويُطابَق عبر مخزن ملفّي منفصل', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xuux-hsm-bind-'));
    try {
      const signer = await HsmSigner.open(fakeToken(), 'kingSigning', { env: CLEAN_ENV });
      const log = new EventLog();
      log.append({ type: 'decree', actor: 'king', data: { n: 1 } });
      log.append({ type: 'decree', actor: 'king', data: { n: 2 } });
      const store = new FileAnchorStore(join(dir, 'anchors.jsonl'), { fsync: false });
      const record = await anchorLogWithHsm(store, signer, { events: log.events });
      assert.equal(record.count, 2);
      const verification = verifyAnchoredLog({
        events: log.events,
        anchors: store.read(),
        king: signer,
      });
      assert.ok(verification.ok, verification.problem);
      assert.equal(verification.provenEvents, 2);
      assert.equal(verification.unanchoredEvents, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F07 — سطور الدفتر موقَّعة داخل التوكن', () => {
  test('سطرٌ موقَّع يتحقق، ويحمل معرّف المفتاح وإصداره', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'commandLedgerSigning', { env: CLEAN_ENV });
    assert.match(signer.id, /^ledger:[0-9a-f]{24}$/);
    const entry = { id: 'cmd-1', state: 'committed', pid: 4242, at: '2026-09-08T18:00:00.000Z' };
    const signed = await signLedgerEntry(signer, entry);
    assert.equal(signed.keyId, '07');
    assert.equal(signed.keyVersion, 1);
    assert.ok(verifyLedgerEntry(signer, signed));
  });

  test('سبب الإلغاء داخل المادة الموقَّعة لا خارجها', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'commandLedgerSigning', { env: CLEAN_ENV });
    const signed = await signLedgerEntry(signer, {
      id: 'cmd-2',
      state: 'aborted',
      pid: 7,
      at: '2026-09-08T18:00:01.000Z',
      reason: 'policy',
    });
    assert.ok(verifyLedgerEntry(signer, signed));
    assert.ok(!verifyLedgerEntry(signer, { ...signed, reason: 'other' }));
  });

  test('مادة السطر مصفوفة مرتَّبة بالبناء', () => {
    assert.deepEqual(ledgerEntryBody({ id: 'a', state: 'committed', pid: 1, at: 'T' }), [
      'a',
      'committed',
      1,
      'T',
      null,
    ]);
  });
});

describe('الربط الكامل وفحوص فشل مغلق', () => {
  test('`bindHsmRootOfTrust` يعيد المقابض الثلاثة بمعرّفاتها', async () => {
    const binding = await bindHsmRootOfTrust(fakeToken(), { env: CLEAN_ENV });
    assert.equal(binding.eventLogAead.keyId, '05');
    assert.equal(binding.kingSigner.keyId, '06');
    assert.equal(binding.ledgerSigner.keyId, '07');
    assert.notEqual(binding.kingSigner.id, binding.ledgerSigner.id);
  });

  test('كل متغيّر مخزن برمجي يُرفض على حدة، وبأسماء لا قيم', () => {
    assert.doesNotThrow(() => assertNoSoftwareKeyFallback(CLEAN_ENV));
    for (const name of SOFTWARE_KEY_ENV_VARS) {
      const error = caught(() =>
        assertNoSoftwareKeyFallback({ ...CLEAN_ENV, [name]: 'سرٌّ-لا-يُطبع' }),
      );
      assert.ok(error instanceof HsmBindingError);
      assert.equal(error.code, 'HSM_SOFTWARE_FALLBACK_FORBIDDEN');
      assert.equal(error.detail, name);
      assert.ok(!JSON.stringify({ m: error.message, d: error.detail }).includes('سرٌّ-لا-يُطبع'));
    }
  });

  test('موفّرٌ يُعلن `canExport: true` يُرفض قبل أي مقبض', async () => {
    const exporting = { ...fakeToken(), describe: () => ({ canExport: true }) };
    assert.throws(() => assertNonExportingSource(exporting), {
      code: 'HSM_PROVIDER_EXPORTS_MATERIAL',
    });
    await assert.rejects(bindHsmRootOfTrust(exporting, { env: CLEAN_ENV }), {
      code: 'HSM_PROVIDER_EXPORTS_MATERIAL',
    });
  });

  test('التوقيع المتزامن مرفوض ولا يُرجع توقيعاً برمجياً', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'kingSigning', { env: CLEAN_ENV });
    const error = caught(() => signer.sign({ a: 1 }));
    assert.ok(error instanceof HsmBindingError);
    assert.equal(error.code, 'HSM_SYNC_SIGN_UNSUPPORTED');
  });

  test('غياب المفتاح في التوكن خطأٌ صريح لا سقوطٌ إلى مفتاح مولَّد', async () => {
    const empty = {
      describe: () => ({ canExport: false }),
      getAeadKey: () => Promise.reject(new Error('KEY_NOT_FOUND')),
      getSigningKey: () => Promise.reject(new Error('KEY_NOT_FOUND')),
    };
    await assert.rejects(bindHsmRootOfTrust(empty, { env: CLEAN_ENV }), /KEY_NOT_FOUND/);
  });
});
