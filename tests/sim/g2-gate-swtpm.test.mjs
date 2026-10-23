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
 * **حدودُ التغطيةِ:** مسارُ الفهارسِ (T2/T3/C1-NV) مغطًّى هنا منذُ WL-460 على
 * محاكٍ حيٍّ تُنشأ فهرساه داخلَ الاختبارِ (فحصٌ ثانٍ أدناه)؛ وتبقى سيناريوهاتُ
 * التلاعبِ وصفحاتُ الجردِ المتعدّدةُ للمستجيبِ المحليِّ — `g2-gate.test.mjs` —
 * لأنها حالاتٌ منطقيّةٌ للفشلِ لا عبورًا حقيقيًّا للاعتمادِ.
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

/**
 * إصدارُ أمرٍ معَ إعادةٍ محدودةٍ عندَ TPM_RC_RETRY (0x922) وحدهُ (Part 1 §4.4):
 * RETRY يعني أنَّ الأمرَ لم يُنفذْ فإعادةُ إصدارِهِ آمنةٌ. يُستعملُ في العصِّ التجريبيِّ
 * خارجَ البوّابةِ وحدهُ — محلّلُ البوّابةِ لا يُعيدُ الأوامرَ المُغيّرةَ بقرارٍ تصميميٍّ (§4.4)، وswtpm 0.7.x (libtpms 0.9)
 * يُطلقُ RETRY عابرًا لأولِ كتابةِ NV بعدَ تعريفٍ أحيانًً — فيُغلّفُ الفرقُ بينَ الإصداراتِ هنا.
 * @param {import('../../sim/tpm/raw_transport.mjs').SwtpmRawTransport} t @param {{ command: Uint8Array | Buffer, descriptor: unknown }} built
 */
async function submitRetry(t, built) {
  for (let attempt = 0; ; attempt++) {
    const parsed = parseResponse(await t.submit(Buffer.from(built.command)), /** @type {any} */ (built.descriptor));
    if (parsed.form !== 'error' || /** @type {number} */ (parsed.rc) !== 0x922 || attempt >= 4) return parsed;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
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

simTest('G2-3: مسارُ NV الكاملُ (T1/T2/T3/C1-NV) على swtpm حيٍّ — الفهارسُ تُنشأُ وتكتبُ داخلَ المحاكياتِ (WL-460)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  // يُعلنُ خارجَ try كي تراهُ كتلةُ finally (التنطيفُ الاحتياطيُّ) — كتلةُ try وfinally شقيقتانِ لا تتشاركانِ النطاقَ.
  const defined = [];
  try {
    // (أ) عصٌّ تجريبيٌّ خارجَ البوّابةِ: إنشاءُ فهرسينِ في مدى نطاقِ EK بــ`NV_DefineSpace`
    // بسماتِ AUTHREAD|AUTHWRITE وقيمةِ تفويضٍ فارغةٍ، ثمَّ كتابةُ محتوى معلومٍ بــ`NV_Write` فوقَ كلٍّ فهرسٍ. هذا تثبيتُ رقعةِ
    // الاختبارِ وحدهُ — البوّابةُ لا ترى هذهِ الخطوةَ ولا تعتمدُ فيهاَ على أيِّ كودٍ إنشاءٍ.
    const NV_INDEX_A = 0x01c00002;
    const NV_INDEX_B = 0x01c0000a;
    const NV_DATA_SIZE = 32;
    // TPMA_NV (الجزءُ 2 §B.9): القراءةُ في البتّاتِ العلياَ: PPREAD=0x10000؛ OWNERREAD=0x20000؛ AUTHREAD=0x40000؛ POLICYREAD=0x80000؛
    // والكتابةُ في السفلىَ: AUTHWRITE=0x4. فيقطٌُ AUTHREAD|AUTHWRITE = 0x00040004.
    const NV_ATTRIBUTES = 0x00040004; // TPMA_NV: AUTHREAD | AUTHWRITE
    const content = Buffer.concat([Buffer.from('xuux-nv-live-path'), Buffer.alloc(NV_DATA_SIZE - 17, 0x5a)]);
    assert.equal(content.length, NV_DATA_SIZE, 'known 32-byte content');
    for (const nvIndex of [NV_INDEX_A, NV_INDEX_B]) {
      const define = builder.buildNvDefineSpace({
        nvIndex,
        dataSize: NV_DATA_SIZE,
        attributes: NV_ATTRIBUTES,
        session: builder.passwordSession(),
      });
      const resp = await submitRetry(t, define);
      assert.equal(resp.form, 'n3', `NV_DefineSpace(0x${nvIndex.toString(16)}) response must be n3`);
      defined.push({ nvIndex, indexName: define.indexName });
      const write = builder.buildNvWrite({
        nvIndex,
        data: content,
        offset: 0,
        session: builder.passwordSession(),
        indexName: define.indexName,
      });
      const written = await submitRetry(t, write);
      assert.equal(written.form, 'n3', `NV_Write(0x${nvIndex.toString(16)}) response must be n3 (rc=0x${written.rc?.toString(16)})`);
    }

    // (ب) عصٌّ تجريبيٌّ لشهادةِ §3.2-2: نفسُ مسارِ الفحصِ الأولك— استخراجُ معاملِ EK منَ المحاكي ولصقُ الزوجِ المُحاكىَ وتفريغُ العابرِ.
    const probeBuilt = builder.buildCreatePrimary({
      inPublic: builder.defaultEkTemplateRsa2048(),
      session: builder.passwordSession(),
    });
    const probeParsed = parseResponse(await t.submit(probeBuilt.command), probeBuilt.descriptor);
    assert.equal(probeParsed.form, 'n3', 'probe CreatePrimary response must be n3');
    const probeOutPublic = firstTpm2b(probeParsed.parameters);
    const probeFlush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probeParsed.handles[0]) });
    const flushParsed = parseResponse(await t.submit(probeFlush.command), probeFlush.descriptor);
    assert.equal(flushParsed.form, 'n1', 'probe flush must be n1');
    const probeTpmt = builder.parseTpmtPublic(probeOutPublic);
    assert(probeTpmt.rsa, 'probe EK must be RSA');
    const probeJwk = {
      kty: 'RSA',
      n: probeTpmt.rsa.modulus.toString('base64url'),
      e: 'AQAB',
    };
    const ekIdentity = mintSimulatedEkCertificatePair(probeJwk);

    // (ج) البوّابةُ على المسارِ الكاملِ معَ الفهارسِ: T1 يجردُ فهرسينِ
    // المُنشأةَ فعلًا منَ المحاكيَ لا منَ كودٍ مُدركٍّ.
    const gate = new FreshnessGate({
      transport: t,
      mode: 'operation',
      persistentEkHandle: null,
      ekIdentity,
    });

    const expected = [NV_INDEX_A, NV_INDEX_B];

    // T1: الجردُ يُلاقي فهرسينِ الاختبارِ حصرً.
    const t1 = await gate.t1Inventory();
    assert.deepEqual(t1.handles, expected, 'T1 must inventory exactly the two test-defined EK NV indices');

    // T6: حدُّ مخزنِ NV منَ المحاكي لا تخمينُ.
    const t6 = await gate.t6nvBufferMax();
    assert.ok(Number.isInteger(t6) && t6 >= NV_DATA_SIZE, 'TPM_PT_NV_BUFFER_MAX read from swtpm');

    // T2 لكلِّ فهرسٍ: منطقةٌ عامّةٌ وحدٌّ منَ المحاكيَ الحيٍّ.
    for (const nvIndex of expected) {
      const t2 = await gate.t2nvReadPublic({ nvIndex });
      assert.equal(t2.dataSize, NV_DATA_SIZE, `T2 dataSize for 0x${nvIndex.toString(16)}`);
      assert.ok(t2.nvPublic.length > 0, `T2 nvPublic for 0x${nvIndex.toString(16)}`);
      // T3: قراءةُ المحتوىَ بكلمةِ المرورِ منَ المحاكي الحيٍّ — ومطابقةُ بايتٌ لما كتبناهُ.
      const t3 = await gate.t3nvRead({ nvIndex, size: NV_DATA_SIZE, offset: 0 });
      assert.ok(t3.equals(content), `T3 content for 0x${nvIndex.toString(16)} must equal the written bytes`);
    }

    // T5 و§3.2-2 والجلسةُ المملّحةُ: نفسُ مسارِ الفحصِ الأولك.
    const t5 = await gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
    assert.ok(t5.outPublic.equals(probeOutPublic), 'same template on the same state must derive the same EK');
    assert.equal(gate.verifyEkIdentity(), true, 'EK identity verified against the live swtpm EK');
    const sas = await gate.startAuthSession();
    assert.ok(Number.isInteger(sas.handle), 'salted HMAC session opened on swtpm');

    // P0: أولُ أمرٍ بجلسةٍ مملّحةٍ — وصفحةُ المدى تُغطيّ فهرسينِ الاختبارِ.
    const p0 = await gate.p0Attest();
    assert.deepEqual(p0.handles, expected, 'P0 page must cover the two test-defined indices');
    assert.equal(gate.state, 'salted', 'P0 verified response alone promotes to salted (R5-01)');

    // C1: القراءةُ المُصادقةُ عبرَ الجلسةِ المملّحةِ غيرِ المربوطةِ —
    // swtpm نفسُهُ يفرضُ أنَّ مفتاحَ HMAC = sessionKey † authValue الفارغةَ (§18.3)،
    // ويقرأُ NV_ReadPublic وNV_Read لكلِّ فهرسٍ ويُطابقُ بايتًٍ معَ T2/T3.
    const c1 = await gate.c1Confirm();
    assert.deepEqual(c1.handles, expected, 'C1 confirms exactly the two test-defined indices');
    assert.equal(gate.state, 'confirmed', 'full NV path confirmed on live swtpm');
    assert.match(c1.identityFingerprint, /^[0-9a-f]+$/, 'identity fingerprint from live C1 NV + EK bytes');
    // بصمةُ الهويّةِ هُنا تحملُ باياتٍ منَ الفهارسِ لا منَ العنصرِ الفارغِ.
    assert.ok(c1.identityFingerprint.length > 64, 'fingerprint carries NV bytes, not just the empty-set EK read');

    // تفريغٌ عبرَ البوّابةِ وحدها: الجلسةُ وEK العابرُ.
    await gate.flushContext({ flushHandle: sas.handle });
    await gate.flushContext({ flushHandle: t5.handle });
    assert.equal(gate.closed, false, 'clean close, no gate failure');

    // تنطيفٌ صارمٌ في مسارِ النجاحِ: الفهارسُ اختُبرتْ وعليها أن تُمحى قبلَ إغلاقِ النقلِ —
    // لا تتسرّبُ حالةُ NV إلى اختبارٍ لاحقٍ في المحاكي المشتركِ.
    const cleanupSession = builder.passwordSession();
    for (const { nvIndex, indexName } of defined) {
      const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: cleanupSession });
      const r = await submitRetry(t, undef);
      assert.equal(r.rc, 0, `NV_UndefineSpace(0x${nvIndex.toString(16)}) must succeed`);
      assert.equal(r.form, 'n3', 'undefine response must be n3');
    }
  } finally {
    // مسعىً أخيرٌ (best-effort) إن فشلَ مبكّرًا: محاولةُ تنطيفِ ما بقيَ منَ الفهارسِ قبلَ إغلاقِ النقلِ.
    try {
      const cleanupSession = builder.passwordSession();
      for (const { nvIndex, indexName } of defined) {
        try {
          const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: cleanupSession });
          await submitRetry(t, undef);
        } catch { /* already undefined — ignore */ }
      }
    } catch { /* transport dead — ignore */ }
    // إغلاقُ النقلِ دائمًا — الفشلُ لا يُعلّقُ الاختبارَ ولا يُسرّبُ جلسةً في المحاكي.
    await t.close();
  }
});

