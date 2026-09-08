// @ts-nocheck
// اختبارات خصمية للربط الإنتاجي لمفاتيح HSM — WL-088 / ADR 0003.
//
// قاعدة هذا الملف: كل عبثٍ يُختبر **متسقاً** — يفعل الخصم كل ما يستطيعه بلا
// المفتاح: يعيد ترميز الحقول، ويبدّل الخوارزمية إلى اسمٍ يبدو أقوى، ويعيد
// استعمال ختمٍ صحيح في موضع آخر، ويوقّع بمفتاح آخر ويزعم إصداراً غير إصداره.
// وعبثٌ غير متسق تكشفه فحوص الصيغة، فلا يقيس هذه الطبقة.
//
// وفيه فحوصٌ **ساكنة** على شيفرة الإنتاج نفسها: أن `hsm-binding.mts` لا يستورد
// ولا يستعمل أي مسار توليد أو تحميل مادة خاصة برمجية، وأن البحث عن المفاتيح في
// `pkcs11-provider.mts` مقيَّد بصنف المفتاح. والفحص الساكن هنا مقصود: منعُ
// إعادة إدخال fallback لاحقاً لا يقوم على اختبارٍ سلوكيّ، لأن الـfallback حين
// يُدخَل يجعل السلوك ناجحاً لا فاشلاً.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as softwareSign,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';

import {
  HSM_KEY_ROLES,
  HsmSigner,
  SEAL_ALGORITHM,
  createHsmAnchor,
  hashAnchorBody,
  openEventData,
  sealEventData,
  signLedgerEntry,
  verifyAnchorChain,
  verifyLedgerEntry,
} from '../../src/root-of-trust/index.mjs';

const AAD = Buffer.from('xuux-event');
const CLEAN_ENV = Object.freeze({ NODE_ENV: 'production' });

/**
 * توكن مزيَّف بمفاتيح مستقلة لكل نداء — كي يُمكن بناء «توكن الخصم».
 * @param seedAes - مفتاح AES مفروض، أو عشوائي
 * @returns موفّراً يحقق عقد `HsmKeySource`
 */
function fakeToken(seedAes = randomBytes(32)) {
  const ed = new Map([
    ['06', generateKeyPairSync('ed25519')],
    ['07', generateKeyPairSync('ed25519')],
  ]);
  return {
    describe: () => ({ canExport: false }),
    getAeadKey: async (keyId) => ({
      keyId,
      encrypt: async (plaintext) => {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', seedAes, iv);
        cipher.setAAD(AAD);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return { ciphertext, iv, tag: cipher.getAuthTag() };
      },
      decrypt: async (ciphertext, iv, tag) => {
        const decipher = createDecipheriv('aes-256-gcm', seedAes, iv);
        decipher.setAAD(AAD);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      },
    }),
    getSigningKey: async (keyId) => {
      const pair = ed.get(keyId);
      return {
        keyId,
        sign: async (message) => softwareSign(null, message, pair.privateKey),
        exportPublicPem: async () => pair.publicKey.export({ type: 'spki', format: 'pem' }),
      };
    },
  };
}

/**
 * يقلب بايتاً واحداً في حقلٍ base64.
 * @param value - القيمة الأصلية
 * @param index - موضع البايت
 * @returns القيمة بعد القلب
 */
function flipByte(value, index = 0) {
  const raw = Buffer.from(value, 'base64');
  raw[index] ^= 0x01;
  return raw.toString('base64');
}

describe('عبث بختم F05', () => {
  test('قلب بايت في النص المشفَّر يُرفض', async () => {
    const handle = await fakeToken().getAeadKey('05');
    const sealed = await sealEventData(handle, { n: 1 });
    await assert.rejects(openEventData(handle, { ...sealed, ct: flipByte(sealed.ct) }));
  });

  test('قلب بايت في العلامة يُرفض', async () => {
    const handle = await fakeToken().getAeadKey('05');
    const sealed = await sealEventData(handle, { n: 1 });
    await assert.rejects(openEventData(handle, { ...sealed, tag: flipByte(sealed.tag) }));
  });

  test('قلب بايت في متجه التهيئة يُرفض', async () => {
    const handle = await fakeToken().getAeadKey('05');
    const sealed = await sealEventData(handle, { n: 1 });
    await assert.rejects(openEventData(handle, { ...sealed, iv: flipByte(sealed.iv) }));
  });

  test('هبوط الخوارزمية يُرفض قبل أي نداء تشفير — ولو إلى اسمٍ يبدو أقوى', async () => {
    const handle = await fakeToken().getAeadKey('05');
    const sealed = await sealEventData(handle, { n: 1 });
    for (const alg of ['AES-512-GCM', 'aes-256-gcm', 'none', '', null, undefined]) {
      await assert.rejects(openEventData(handle, { ...sealed, alg }), {
        code: 'HSM_SEAL_ALGORITHM_REJECTED',
      });
    }
  });

  test('ختمٌ بمعرّف مفتاح آخر يُرفض ولو صحّ تشفيره', async () => {
    const shared = randomBytes(32);
    const token = fakeToken(shared);
    const five = await token.getAeadKey('05');
    const seven = await token.getAeadKey('07');
    const sealed = await sealEventData(seven, { n: 1 });
    // نفس المفتاح المادي، ومعرّفٌ آخر: يُرفض بالمعرّف لا بفشل التشفير.
    await assert.rejects(openEventData(five, sealed), { code: 'HSM_SEAL_KEY_MISMATCH' });
  });

  test('طول متجه أو علامة غير المطلوب يُرفض بصيغته', async () => {
    const handle = await fakeToken().getAeadKey('05');
    const sealed = await sealEventData(handle, { n: 1 });
    await assert.rejects(
      openEventData(handle, { ...sealed, iv: Buffer.alloc(16).toString('base64') }),
      { code: 'HSM_SEAL_FORMAT_INVALID' },
    );
    await assert.rejects(
      openEventData(handle, { ...sealed, tag: Buffer.alloc(8).toString('base64') }),
      { code: 'HSM_SEAL_FORMAT_INVALID' },
    );
  });

  test('حقول ناقصة أو غير نصية أو ليست base64 تُرفض', async () => {
    const handle = await fakeToken().getAeadKey('05');
    const sealed = await sealEventData(handle, { n: 1 });
    for (const patch of [{ ct: '' }, { ct: 123 }, { iv: '!!!!' }, { tag: undefined }]) {
      await assert.rejects(openEventData(handle, { ...sealed, ...patch }), {
        code: 'HSM_SEAL_FORMAT_INVALID',
      });
    }
    for (const bad of [null, 'نص', 7, []]) {
      await assert.rejects(openEventData(handle, bad));
    }
  });
});

describe('عبث بتوقيع F06', () => {
  test('توقيعٌ صحيح بمفتاح آخر يُرفض', async () => {
    const legit = await HsmSigner.open(fakeToken(), 'kingSigning', { env: CLEAN_ENV });
    const rogue = await HsmSigner.open(fakeToken(), 'kingSigning', { env: CLEAN_ENV });
    const body = { a: 1 };
    assert.ok(!legit.verify(body, await rogue.signAsync(body)));
  });

  test('تعديل حقلٍ في مادة التثبيت يُكشف عند التحقق', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'kingSigning', { env: CLEAN_ENV });
    const anchor = await createHsmAnchor({ count: 4, lastHash: 'h4' }, null, signer);
    // عبثٌ متسق: يعيد الخصم حساب التجزئة بعد تعديل العدد، ولا يملك المفتاح.
    const forged = { ...anchor, count: 9 };
    forged.hash = hashAnchorBody({
      version: forged.version,
      seq: forged.seq,
      count: forged.count,
      lastHash: forged.lastHash,
      previousAnchorHash: forged.previousAnchorHash,
      at: forged.at,
      kingId: forged.kingId,
      keyVersion: forged.keyVersion,
    });
    const result = verifyAnchorChain([forged], signer);
    assert.equal(result.ok, false);
    assert.equal(result.problem, 'ANCHOR_SIGNATURE_INVALID');
  });

  test('زعم إصدارٍ غير الذي قَبِل التوقيع يُكشف', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'kingSigning', {
      env: CLEAN_ENV,
      keyVersion: 1,
    });
    const anchor = await createHsmAnchor({ count: 2, lastHash: 'h2' }, null, signer);
    const result = verifyAnchorChain([{ ...anchor, keyVersion: 5 }], signer);
    assert.equal(result.ok, false);
    // التجزئة تُحسب على المادة، فتغيير الإصدار يُكشف بالتجزئة أولاً.
    assert.equal(result.problem, 'ANCHOR_HASH_MISMATCH');
  });

  test('توقيعٌ بطولٍ غير 64 بايت يُرفض ولا يُمرَّر', async () => {
    const token = fakeToken();
    const broken = {
      ...token,
      getSigningKey: async (keyId) => ({
        ...(await token.getSigningKey(keyId)),
        sign: async () => Buffer.alloc(32),
      }),
    };
    const signer = await HsmSigner.open(broken, 'kingSigning', { env: CLEAN_ENV });
    await assert.rejects(signer.signAsync({ a: 1 }), { code: 'HSM_SIGNATURE_LENGTH_INVALID' });
  });

  test('توقيعٌ فارغ أو تالف يُقرأ باطلاً لا يُسقط التحقق', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'kingSigning', { env: CLEAN_ENV });
    for (const bad of ['', 'ليس-base64url', null, undefined, 123]) {
      assert.equal(signer.verify({ a: 1 }, bad), false);
    }
  });

  test('مفتاحٌ عامٌّ ليس Ed25519 يُرفض عند الفتح', async () => {
    const token = fakeToken();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const wrong = {
      ...token,
      getSigningKey: async (keyId) => ({
        ...(await token.getSigningKey(keyId)),
        exportPublicPem: async () => rsa.publicKey.export({ type: 'spki', format: 'pem' }),
      }),
    };
    await assert.rejects(HsmSigner.open(wrong, 'kingSigning', { env: CLEAN_ENV }), {
      code: 'HSM_PUBLIC_KEY_UNAVAILABLE',
    });
  });

  test('فشل تصدير المفتاح العام يُرفض برمزه لا يُتجاوز', async () => {
    const token = fakeToken();
    const blind = {
      ...token,
      getSigningKey: async (keyId) => ({
        ...(await token.getSigningKey(keyId)),
        exportPublicPem: () => Promise.reject(new Error('CKA_EC_POINT')),
      }),
    };
    await assert.rejects(HsmSigner.open(blind, 'kingSigning', { env: CLEAN_ENV }), {
      code: 'HSM_PUBLIC_KEY_UNAVAILABLE',
    });
  });
});

describe('عبث بسطور دفتر F07', () => {
  test('تبديل الحالة من ملغى إلى مثبَّت يُكشف', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'commandLedgerSigning', { env: CLEAN_ENV });
    const signed = await signLedgerEntry(signer, {
      id: 'cmd-9',
      state: 'aborted',
      pid: 3,
      at: '2026-09-08T18:00:00.000Z',
    });
    assert.ok(!verifyLedgerEntry(signer, { ...signed, state: 'committed' }));
  });

  test('تبديل المعرّف أو رقم العملية أو الوقت يُكشف', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'commandLedgerSigning', { env: CLEAN_ENV });
    const signed = await signLedgerEntry(signer, {
      id: 'cmd-10',
      state: 'committed',
      pid: 3,
      at: '2026-09-08T18:00:00.000Z',
    });
    assert.ok(!verifyLedgerEntry(signer, { ...signed, id: 'cmd-11' }));
    assert.ok(!verifyLedgerEntry(signer, { ...signed, pid: 4 }));
    assert.ok(!verifyLedgerEntry(signer, { ...signed, at: '2026-09-08T18:00:02.000Z' }));
  });

  test('زعم معرّف مفتاح أو إصدار غير الذي وقّع يُرفض ولو صحّ التوقيع', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'commandLedgerSigning', { env: CLEAN_ENV });
    const signed = await signLedgerEntry(signer, {
      id: 'cmd-12',
      state: 'committed',
      pid: 3,
      at: '2026-09-08T18:00:00.000Z',
    });
    assert.ok(!verifyLedgerEntry(signer, { ...signed, keyId: '06' }));
    assert.ok(!verifyLedgerEntry(signer, { ...signed, keyVersion: 2 }));
  });

  test('سطرٌ موقَّع بمفتاح ملك (06) لا يُقبل في مسار الدفتر', async () => {
    const token = fakeToken();
    const king = await HsmSigner.open(token, 'kingSigning', { env: CLEAN_ENV });
    const ledger = await HsmSigner.open(token, 'commandLedgerSigning', { env: CLEAN_ENV });
    const signedByKing = await signLedgerEntry(king, {
      id: 'cmd-13',
      state: 'committed',
      pid: 3,
      at: '2026-09-08T18:00:00.000Z',
    });
    assert.ok(!verifyLedgerEntry(ledger, signedByKing));
  });

  test('سطرٌ ناقص الحقول يُرفض توقيعاً وتحققاً', async () => {
    const signer = await HsmSigner.open(fakeToken(), 'commandLedgerSigning', { env: CLEAN_ENV });
    await assert.rejects(signLedgerEntry(signer, { id: '', state: 'committed', pid: 1, at: 'T' }), {
      code: 'HSM_LEDGER_ENTRY_INVALID',
    });
    assert.equal(verifyLedgerEntry(signer, { keyId: '07', keyVersion: 1, signature: 'x' }), false);
  });
});

describe('فحوص ساكنة تمنع إعادة إدخال fallback', () => {
  const source = readFileSync(
    new URL('../../src/root-of-trust/hsm-binding.mts', import.meta.url),
    'utf8',
  );
  // التعليقات تُنزع (السطرية والكتلية) كي يُفحص الكود نفسه لا شرحُه: الشرح
  // يذكر ما يُمنع بالاسم، ومنعُ ذكره في الشرح يُفقد التوثيق لا يزيد أمناً.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  for (const forbidden of [
    'generateKeyPairSync',
    'createPrivateKey',
    'createSecretKey',
    'createCipheriv',
    'createDecipheriv',
    'privateKey',
    'CKA_VALUE',
    'PIN',
  ]) {
    test(`لا ذكر لـ${forbidden} في شيفرة الربط`, () => {
      assert.ok(!code.includes(forbidden), `${forbidden} ظهر في hsm-binding.mts`);
    });
  }

  test('الاستيراد من node:crypto محصور في التحقق بالمفتاح العام', () => {
    const imports = /import \{([^}]*)\} from 'node:crypto';/.exec(source)?.[1] ?? '';
    const names = imports
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split(' as ')[0].trim());
    assert.deepEqual(names.sort(), ['createPublicKey', 'verify']);
  });

  test('البحث عن مفاتيح التوقيع وAEAD مقيَّد بصنف المفتاح', () => {
    const provider = readFileSync(
      new URL('../../src/root-of-trust/pkcs11-provider.mts', import.meta.url),
      'utf8',
    );
    assert.ok(!/\bfindKey\(/.test(provider), 'بحثٌ بالمعرّف وحده ما زال موجوداً');
    assert.match(
      provider,
      /findKeyOfClass\(keyId, \(this\.lib\.CKO_PRIVATE_KEY as number\) \?\? 3\)/,
    );
    assert.match(
      provider,
      /findKeyOfClass\(keyId, \(this\.lib\.CKO_SECRET_KEY as number\) \?\? 4\)/,
    );
    assert.match(provider, /CKA_CLASS as number\) \?\? 0, value: keyClass/);
  });

  test('خريطة الأدوار لا تُقرأ من البيئة', () => {
    assert.ok(!/HSM_KEY_ROLES[^\n]*process\.env/.test(source));
    assert.equal(HSM_KEY_ROLES.kingSigning.keyId, '06');
    assert.equal(SEAL_ALGORITHM, 'AES-256-GCM');
  });
});
