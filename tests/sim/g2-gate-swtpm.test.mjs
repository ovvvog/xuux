/**
 * G2-3 — اختبارُ العبورِ الحقيقيُّ للبوّابةِ (L-C) على swtpm حيٍّ عبرَ نقلِ G2-1
 * ومحلّلِ G2-2. مقيَّدٌ بـ`isSimEnabled()` ويُشغَّلُ إلزاميًّا في `scripts/tpm-sim-ci.sh`.
 *
 * **حدٌّ معلَنٌ (صادق):** محاكاةٌ لا عتاد. هذا يثبتُ أنّ مسارَ البوّابةِ الكاملَ
 * (T1/T6/T5/§3.2-2/StartAuthSession/P0/C1) يمرُّ فوقَ محاكٍ حقيقيٍّ لا مستجيبٍ
 * محليٍّ: فـswtpm (libtpms) نفسُه يفكُّ ملحَ OAEP، ويشتقُّ sessionKey بـKDFa،
 * ويتحقّقُ من HMAC الأوامر، والبوّابةُ تتحققُّ من HMAC الردود. ولا يثبتُ شيئًا عن
 * TPM عتاديّ (ADR 0007 §9)، ولا يرفعُ أيَّ قرارِ مخاطرةٍ إنتاجيٍّ، و`SUPPORTED_FRESHNESS_BACKENDS`
 * يبقى فارغًا.
 *
 * **ما لا يغطّيه هذا الملفُّ (مغطًّى بالمستجيبِ المحليّ):** فهارسُ NV (T2/T3/C1-NV)
 * وصفحاتُ الجردِ المتعدّدةُ وسيناريوهاتُ التلاعبِ — `g2-gate.test.mjs`. فالمحاكيُّ
 * الحيُّ هنا نسخةٌ طازجةٌ بلا فهارسَ (جردٌ فارغٌ)، وهذا الاختبارُ يقيسُ العبورَ
 * الحقيقيَّ لا كلَّ المساراتِ المنطقيّة.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwtpmRawTransport } from '../../sim/tpm/raw_transport.mjs';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import { parseResponse } from '../../sim/tpm/response_parser.mjs';
import * as builder from '../../sim/tpm/command_builder.mjs';
import { FreshnessGate } from '../../sim/tpm/gate.mjs';
import { mintSimulatedEkCertificatePair } from '../../sim/tpm/ek_identity.mjs';

const sim = isSimEnabled();
/** @param {string} name @param {() => Promise<void>} fn */
const simTest = (name, fn) => test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);

/** يقرأُ أوّلَ `TPM2B` من المعاملاتِ (outPublic لردِّ CreatePrimary). */
function firstTpm2b(/** @type {Buffer} */ parameters) {
  assert.ok(parameters.length >= 2, 'parameters too short for a TP2B');
  const len = parameters.readUInt16BE(0);
  assert.ok(parameters.length >= 2 + len, 'parameters truncated');
  return Buffer.from(parameters.subarray(2, 2 + len));
}

simTest('G2-3/G2-4: مسارُ البوّابةِ الكاملُ bootstrap→confirmed على swtpm حيٍّ (محاكاةٌ صادقةُ التسمية)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  try {

  // (أ) عصٌّ تجريبيٌّ لشهادةِ §3.2-2: CreatePrimary خامٌ (خارجَ البوّابةِ) لاستخراجِ
  // معاملِ EK من المحاكيِ نفسِه، ثمّ لصقُ الزوجِ المُحاكى، ثمّ تفريغُ العابرِ. هذا
  // تثبيتُ رقعةِ الاختبارِ وحدَه — البوّابةُ نفسُها لا ترى هذه الخطوة.
  const probeBuilt = builder.buildCreatePrimary({
    inPublic: builder.defaultEkTemplateRsa2048(),
    session: builder.passwordSession(),
  });
  const probeParsed = parseResponse(await t.submit(probeBuilt.command), probeBuilt.descriptor);
  assert.equal(probeParsed.form, 'n3', 'probe CreatePrimary response must be n3');
  assert.ok(probeParsed.handles.length === 1, 'probe must return the transient handle');
  const probeOutPublic = firstTpm2b(probeParsed.parameters);
  const probeFlush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probeParsed.handles[0]) });
  const flushParsed = parseResponse(await t.submit(probeFlush.command), probeFlush.descriptor);
  assert.equal(flushParsed.form, 'n1', 'probe flush must be n1');

  // اشتقاقُ EK أوّليٍّ محتدٌّ بالقالبِ نفسِه على الحالةِ نفسِها ⇒ معاملٌ مطابقٌ
  // للبوّابةِ لاحقًا. إن خالفَ (نظريةً) فشلَ §3.2-2 في (ج) صراحةً.
  const probeTpmt = builder.parseTpmtPublic(probeOutPublic);
  assert(probeTpmt.rsa, 'probe EK must be RSA');
  const probeJwk = {
    kty: 'RSA',
    n: probeTpmt.rsa.modulus.toString('base64url'),
    e: 'AQAB',
  };
  const ekIdentity = mintSimulatedEkCertificatePair(probeJwk);

  // (ب) البوّابةُ على الاتّصالِ الحيِّ نفسِه.
  const gate = new FreshnessGate({
    transport: t,
    mode: 'operation',
    persistentEkHandle: null,
    ekIdentity,
  });

  // T1 على جردٍ حقيقيٍّ: النسخةُ طازجةٌ ⇒ لا فهارسَ EK. (مسارُ الفهارسِ مغطًّى
  // بالمستجيبِ المحليّ).
  const t1 = await gate.t1Inventory();
  assert.deepEqual(t1.handles, [], 'fresh swtpm carries no EK NV indices');

  // T6: قراءةُ حدِّ المخزنِ من المحاكيِ لا تخمينُه.
  const t6 = await gate.t6nvBufferMax();
  assert.ok(Number.isInteger(t6) && t6 > 0, 'TPM_PT_NV_BUFFER_MAX read from swtpm');

  // T5: CreatePrimary حقيقيٌّ عبرَ البوّابةِ.
  const t5 = await gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
  assert.ok(t5.outPublic.equals(probeOutPublic), 'same template on the same state must derive the same EK');

  // §3.2-2: سلسلةُ الشهادةِ وتطابقُ SPKI معَ مفتاحِ المحاكيِ الحيّ.
  assert.equal(gate.verifyEkIdentity(), true, 'EK identity verified against the live swtpm EK');

  // StartAuthSession: المحاكيُّ نفسُه يفكُّ ملحَ OAEP (SHA-256، علامةُ «SECRET\0»)
  // ويشتقُّ sessionKey — أيُّ خللٍ في OAEP/KDFa/الترميزِ يُسقطُ الجلسةَ هنا.
  const sas = await gate.startAuthSession();
  assert.ok(Number.isInteger(sas.handle), 'salted HMAC session opened on swtpm');

  // P0: أوّلُ أمرٍ بجلسةٍ مملّحةٍ — swtpm يتحققُّ من HMAC الأمرِ، والبوّابةُ من ن2.
  const p0 = await gate.p0Attest();
  assert.deepEqual(p0.handles, [], 'P0 page over the empty fresh inventory');
  assert.equal(gate.state, 'salted', 'P0 verified response alone promotes to salted (R5-01)');

  // C1: مطابقةُ مجموعةٍ فارغةٍ + ReadPublic حقيقيٌّ لمقبضِ EK بمطابقةٍ بايتيّةٍ.
  const c1 = await gate.c1Confirm();
  assert.deepEqual(c1.handles, [], 'C1 confirms the empty handle set');
  assert.equal(gate.state, 'confirmed');
  assert.match(c1.identityFingerprint, /^[0-9a-f]+$/, 'identity fingerprint from live C1 bytes');

    // تفريغٌ عبرَ البوّابةِ وحدَها (WL-447: الجلسةُ وEK بعدَ نجاحِ C1، ومقابضُها هي).
    await gate.flushContext({ flushHandle: sas.handle });
    await gate.flushContext({ flushHandle: t5.handle });
    assert.equal(gate.closed, false, 'clean close, no gate failure');
  } finally {
    // إغلاقُ النقلِ دائمًا — الفشلُ لا يُعلّقُ الاختبارَ ولا يُسرّبُ جلسةً في المحاكي.
    await t.close();
  }
});
