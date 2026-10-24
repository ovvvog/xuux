/**
 * G2 — اختباراتُ وحدةِ تجميعِ قالبِ EK للحالاتِ الأربعِ (ملفُ اعتمادِ EK §2.2.1.6 عبرَ الملحقِ هـ
 * §4.3 صفُّ CreatePrimary). تُشغَّلُ دائمًا (لا تحتاجُ محاكيًا) — تركيبٌ صرفٌ بلا إرسالٍ ولا اتصال.
 *
 * **حدٌّ معلَنٌ:** وحدةُ نطاقِ المحاكاةِ لا إثباتُ عتاد. أما اختبارُ العبورِ الحقيقيِّ لهذهِ
 * الحالاتِ عبرَ البوّابةِ على swtpm ففي `g2-gate-swtpm.test.mjs` (مقيَّدٌ بـ`isSimEnabled()`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTpmtPublic,
  defaultEkTemplateRsa2048,
  defaultEkTemplateEccP256,
  ekTemplateWithNonce,
  COMMAND_BUILDER_ERRORS,
  TPM_ALG,
} from '../../sim/tpm/command_builder.mjs';
import { assembleEkInPublic } from '../../sim/tpm/ek_template.mjs';
import { GATE_ERRORS } from '../../sim/tpm/gate.mjs';

const tpm2bAt = (/** @type {Buffer} */ bytes, /** @type {number} */ offset) => {
  const len = bytes.readUInt16BE(offset);
  return { len, content: bytes.subarray(offset + 2, offset + 2 + len) };
};

test('G2-ek: الحالةُ (1) — الغائبَانِ: القالبُ الافتراضيُّ حرفيًا (RSA وECC)', () => {
  assert.deepEqual(assembleEkInPublic({ keyType: 'rsa2048', templateBytes: null, nonceBytes: null }), defaultEkTemplateRsa2048());
  assert.deepEqual(assembleEkInPublic({ keyType: 'eccP256', templateBytes: null, nonceBytes: null }), defaultEkTemplateEccP256());
});

test('G2-ek: الحالةُ (2) — قالبٌ مقروءٌ بلا nonce: يُعادُ بلا تعديلٍ بايتًا ببايت', () => {
  const read = defaultEkTemplateRsa2048(); // قالبٌ صالحٌ كاملُ التحليلِ بصفةِ قالبٍ مقروءٍ
  assert.deepEqual(assembleEkInPublic({ keyType: 'rsa2048', templateBytes: read, nonceBytes: null }), read);
  const readEcc = defaultEkTemplateEccP256();
  assert.deepEqual(assembleEkInPublic({ keyType: 'eccP256', templateBytes: readEcc, nonceBytes: null }), readEcc);
});

test('G2-ek: الحالةُ (3) RSA — الـnonce يحلُّ محلَّ unique كاملًا محشوًّا إلى 256 والرأسُ محفوظٌ بايتًا ببايت', () => {
  const read = defaultEkTemplateRsa2048();
  const nonce = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const out = assembleEkInPublic({ keyType: 'rsa2048', templateBytes: read, nonceBytes: nonce });
  const parsed = parseTpmtPublic(out);
  const offset = /** @type {number} */ (parsed.uniqueOffset);
  const unique = tpm2bAt(out, offset);
  assert.equal(unique.len, 256, 'unique length must be 256');
  assert.deepEqual(unique.content.subarray(0, 4), nonce, 'nonce first');
  assert.deepEqual(unique.content.subarray(4), Buffer.alloc(252), 'padding is appended 0x00');
  // الرأسُ (قبلَ unique) محفوظٌ بايتًا ببايتٍ من القالبِ المقروءِ.
  assert.deepEqual(out.subarray(0, offset), read.subarray(0, offset), 'template header preserved');
});

test('G2-ek: الحالةُ (3) RSA — قالبٌ مقروءٌ ذو unique أقصر (128): الاستبدالُ الواعي بالتحليلِ لا اللاحقةُ الثابتة (انحدارُ WL-462)', () => {
  // قبلَ الإصلاحِ كانت ekTemplateWithNonce تقصُّ 258 بايتًا من آخرِ القالبِ مهما كانَ طولُ
  // unique الفعليُّ فتفسدُ القالبَ الأقصرَ — هذا الاختبارُ يسقطُ على النصِّ القديمِ وينجحُ بالجديد.
  const read = defaultEkTemplateRsa2048();
  const parsedRead = parseTpmtPublic(read);
  const short = Buffer.concat([read.subarray(0, /** @type {number} */ (parsedRead.uniqueOffset)), Buffer.from([0x00, 0x80]), Buffer.alloc(128)]);
  assert.equal(parseTpmtPublic(short).rsa?.modulus.length, 128, 'fixture: short-unique template parses');
  const nonce = Buffer.alloc(32, 0x5a);
  const out = assembleEkInPublic({ keyType: 'rsa2048', templateBytes: short, nonceBytes: nonce });
  const parsed = parseTpmtPublic(out);
  const offset = /** @type {number} */ (parsed.uniqueOffset);
  const unique = tpm2bAt(out, offset);
  assert.equal(unique.len, 256, 'replaced unique is 256');
  assert.deepEqual(unique.content.subarray(0, 32), nonce, 'nonce first');
  assert.deepEqual(out.subarray(0, offset), short.subarray(0, offset), 'short template header preserved');
});

test('G2-ek: الحالةُ (3) ECC — x يحملُ الـnonce محشوًّا إلى 32 وy = 32 صفرًا', () => {
  const read = defaultEkTemplateEccP256();
  const nonce = Buffer.from('xuux-ek-nonce-32-bytes----------', 'latin1').subarray(0, 32);
  const out = assembleEkInPublic({ keyType: 'eccP256', templateBytes: read, nonceBytes: nonce });
  const parsed = parseTpmtPublic(out);
  const offset = /** @type {number} */ (parsed.uniqueOffset);
  const x = tpm2bAt(out, offset);
  const y = tpm2bAt(out, offset + 2 + x.len);
  assert.equal(x.len, 32, 'x length must be 32');
  assert.deepEqual(x.content.subarray(0, 32), nonce, 'nonce fills x (no padding needed at 32)');
  assert.equal(y.len, 32, 'y length must be 32');
  assert.deepEqual(y.content, Buffer.alloc(32), 'y is 32 zeros');
  assert.deepEqual(out.subarray(0, offset), read.subarray(0, offset), 'template header preserved');
});

test('G2-ek: الحالةُ (4) — قالبٌ غائبٌ وnonce موجود: توقّفٌ بـFRESHNESS_TPM_IDENTITY_UNPROVEN', () => {
  assert.throws(
    () => assembleEkInPublic({ keyType: 'rsa2048', templateBytes: null, nonceBytes: Buffer.alloc(32, 1) }),
    (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN,
  );
});

test('G2-ek: قالبٌ ببايتٍ زائدٍ في الذيلِ ⇒ رفضٌ مسمًّى قبلَ أيِّ تركيب', () => {
  const read = defaultEkTemplateRsa2048();
  const padded = Buffer.concat([read, Buffer.from([0x00])]);
  assert.throws(
    () => assembleEkInPublic({ keyType: 'rsa2048', templateBytes: padded, nonceBytes: null }),
    (/** @type {{ code?: string }} */ e) => e.code === COMMAND_BUILDER_ERRORS.PUBLIC_INVALID,
  );
});

test('G2-ek: نوعُ القالبِ يخالفُ نوعَ الشهادةِ ⇒ رفضٌ مسمًّى (RSA مع eccP256 والعكس)', () => {
  const rsa = defaultEkTemplateRsa2048();
  const ecc = defaultEkTemplateEccP256();
  assert.throws(
    () => assembleEkInPublic({ keyType: 'eccP256', templateBytes: rsa, nonceBytes: null }),
    (/** @type {{ code?: string }} */ e) => e.code === COMMAND_BUILDER_ERRORS.PUBLIC_INVALID,
  );
  assert.throws(
    () => assembleEkInPublic({ keyType: 'rsa2048', templateBytes: ecc, nonceBytes: null }),
    (/** @type {{ code?: string }} */ e) => e.code === COMMAND_BUILDER_ERRORS.PUBLIC_INVALID,
  );
});

test('G2-ek: nonce أطولُ من حدِّ الحشوِ ⇒ رفضٌ مسمًّى (256 لـRSA و32 لـECC)', () => {
  const read = defaultEkTemplateRsa2048();
  assert.throws(
    () => assembleEkInPublic({ keyType: 'rsa2048', templateBytes: read, nonceBytes: Buffer.alloc(257, 1) }),
    (/** @type {{ code?: string }} */ e) => e.code === COMMAND_BUILDER_ERRORS.FIELD_INVALID,
  );
  const readEcc = defaultEkTemplateEccP256();
  assert.throws(
    () => assembleEkInPublic({ keyType: 'eccP256', templateBytes: readEcc, nonceBytes: Buffer.alloc(33, 1) }),
    (/** @type {{ code?: string }} */ e) => e.code === COMMAND_BUILDER_ERRORS.FIELD_INVALID,
  );
});

test('G2-ek: kind يخالفُ نوعَ القالبِ في ekTemplateWithNonce مباشرةً ⇒ رفضٌ مسمًّى', () => {
  const rsa = defaultEkTemplateRsa2048();
  assert.throws(
    () => ekTemplateWithNonce(rsa, Buffer.alloc(8), 'ecc'),
    (/** @type {{ code?: string }} */ e) => e.code === COMMAND_BUILDER_ERRORS.FIELD_INVALID,
  );
});

test('G2-ek: ثابتُ النوعِ متاحٌ للتحققِ المتبادلِ (لا ترميزًا سحريًا في الاختباراتِ)', () => {
  assert.equal(parseTpmtPublic(defaultEkTemplateRsa2048()).type, TPM_ALG.RSA);
  assert.equal(parseTpmtPublic(defaultEkTemplateEccP256()).type, TPM_ALG.ECC);
});
