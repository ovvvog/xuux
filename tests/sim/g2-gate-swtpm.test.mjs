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
import { assembleEkInPublic } from '../../sim/tpm/ek_template.mjs';
import { GATE_ERRORS } from '../../sim/tpm/gate.mjs';

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

/**
 * عصٌّ تجريبيٌّ (خارجَ البوّابةِ): قراءةُ محتوى فهرسِ NV بكاملِهِ على دُفعاتٍ لا تتجاوزُ
 * 256 بايتًا (حدَّ أمانٍ دونَ TPM_PT_NV_BUFFER_MAX مهما كانَ صغيرًا في نسخةِ المحاكي).
 * @param {import('../../sim/tpm/raw_transport.mjs').SwtpmRawTransport} t
 * @param {number} nvIndex @param {Buffer} indexName @param {number} size
 */
async function probeNvRead(t, nvIndex, indexName, size) {
  const parts = [];
  for (let offset = 0; offset < size; offset += 256) {
    const chunk = Math.min(256, size - offset);
    const built = builder.buildNvRead({
      authHandle: nvIndex,
      nvIndex,
      size: chunk,
      offset,
      session: builder.passwordSession(),
      handleNames: [indexName, indexName],
    });
    const parsed = parseResponse(await t.submit(Buffer.from(built.command)), /** @type {any} */ (built.descriptor));
    assert.equal(parsed.form, 'n3', `probe NV_Read(0x${nvIndex.toString(16)}@${offset}) must be n3`);
    const len = parsed.parameters.readUInt16BE(0);
    assert.ok(2 + len <= parsed.parameters.length, 'probe NV_Read response truncated');
    parts.push(Buffer.from(parsed.parameters.subarray(2, 2 + len)));
  }
  return Buffer.concat(parts);
}

simTest('G2: الحالاتُ (2) و(3) — قالبُ EK المقروءُ من فهرسِ NV يحكمُ T5 عبرَ البوّابةِ على swtpm حيّ (WL-462)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  const defined = /** @type {{ nvIndex: number, indexName: Buffer }[]} */ ([]);
  try {
    // (أ) عصٌّ تجريبيٌّ خارجَ البوّابةِ: فهرسُ القالبِ 0x01c00004 يحملُ قالبَ L-1 الافتراضيَّ كاملًا
    // (على دُفعاتِ كتابةٍ لا تتجاوزُ 256)، وفهرسُ الـnonce 0x01c00003 (32 بايتًا) يُنشأ في الحالةِ (3).
    const TEMPLATE_INDEX = 0x01c00004;
    const NONCE_INDEX = 0x01c00003;
    const templateBytes = builder.defaultEkTemplateRsa2048();
    const nonceBytes = Buffer.alloc(32, 0x3c);
    /** @param {number} nvIndex @param {number} size */
    const defineIndex = async (nvIndex, size) => {
      const define = builder.buildNvDefineSpace({ nvIndex, dataSize: size, attributes: 0x00040004, session: builder.passwordSession() });
      const resp = await submitRetry(t, define);
      assert.equal(resp.form, 'n3', `NV_DefineSpace(0x${nvIndex.toString(16)}) response must be n3`);
      defined.push({ nvIndex, indexName: define.indexName });
    };
    /** @param {number} nvIndex @param {Buffer} indexName @param {Buffer} data */
    const writeIndex = async (nvIndex, indexName, data) => {
      for (let offset = 0; offset < data.length; offset += 256) {
        const chunk = data.subarray(offset, offset + 256);
        const write = builder.buildNvWrite({ nvIndex, data: chunk, offset, session: builder.passwordSession(), indexName });
        const written = await submitRetry(t, write);
        assert.equal(written.form, 'n3', `NV_Write(0x${nvIndex.toString(16)}@${offset}) must be n3`);
      }
    };
    await defineIndex(TEMPLATE_INDEX, templateBytes.length);
    /** @param {number} idx */
    const nameOf = (idx) => {
      const entry = defined.find((d) => d.nvIndex === idx);
      assert.ok(entry, `index 0x${idx.toString(16)} defined`);
      return entry.indexName;
    };
    const templateName = defined[defined.length - 1];
    assert.ok(templateName, 'template index defined');
    await writeIndex(TEMPLATE_INDEX, templateName.indexName, templateBytes);

    // (ب) الحالةُ (2): قراءةُ القالبِ عبرَ العصِّ التجريبيِّ (مدخلٌ غيرُ موثوق) ← التجميعُ ← CreatePrimary
    // عصٌّ خارجَ البوّابةِ بالقالبِ المجمَّع نفسِهِ ← شهادةٌ مُحاكاةٌ ← البوّابةُ فوقَ ذلكَ كلِّهِ.
    const probeRead2 = await probeNvRead(t, TEMPLATE_INDEX, templateName.indexName, templateBytes.length);
    assert.ok(probeRead2.equals(templateBytes), 'probe read of the template index must return the written bytes');
    const inPublic2 = assembleEkInPublic({ keyType: 'rsa2048', templateBytes: probeRead2, nonceBytes: null });
    assert.deepEqual(inPublic2, templateBytes, 'case 2: read template returned unmodified');
    const probe2 = builder.buildCreatePrimary({ inPublic: inPublic2, session: builder.passwordSession() });
    const probe2Parsed = parseResponse(await t.submit(probe2.command), probe2.descriptor);
    assert.equal(probe2Parsed.form, 'n3', 'case 2 probe CreatePrimary must be n3');
    const probe2Out = firstTpm2b(probe2Parsed.parameters);
    const probe2Flush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probe2Parsed.handles[0]) });
    assert.equal(parseResponse(await t.submit(probe2Flush.command), probe2Flush.descriptor).form, 'n1');
    const pub2 = builder.parseTpmtPublic(probe2Out);
    assert.ok(pub2.rsa, 'case 2 probe public is RSA');
    const ekIdentity2 = mintSimulatedEkCertificatePair({ kty: 'RSA', n: pub2.rsa.modulus.toString('base64url'), e: 'AQAB' });

    // البوّابةُ (المسارُ الأمينُ): T1 يجردُ فهرسَ القالبِ، وT6، وT2/T3 يقرآنِهِ فيُجمَّعُ القالبُ
    // من قراءاتِ البوّابةِ نفسِها ويُطابَقُ مع تجميعِ العصِّ، ثمّ T5 بالقالبِ المجمَّعِ والتحققُ من الهويّةِ.
    const gate2 = new FreshnessGate({ transport: t, mode: 'operation', persistentEkHandle: null, ekIdentity: ekIdentity2 });
    const t1 = await gate2.t1Inventory();
    assert.ok(t1.handles.includes(TEMPLATE_INDEX), 'T1 must inventory the template index');
    await gate2.t6nvBufferMax();
    const t2 = await gate2.t2nvReadPublic({ nvIndex: TEMPLATE_INDEX });
    assert.equal(t2.dataSize, templateBytes.length, 'T2 dataSize of the template index');
    const gateRead = await gate2.t3nvRead({ nvIndex: TEMPLATE_INDEX, size: templateBytes.length, offset: 0 });
    assert.ok(gateRead.equals(templateBytes), 'T3 through the gate must return the template bytes');
    const gateInPublic2 = assembleEkInPublic({ keyType: 'rsa2048', templateBytes: gateRead, nonceBytes: null });
    assert.deepEqual(gateInPublic2, inPublic2, 'gate-assembled inPublic equals probe-assembled (case 2)');
    const t5 = await gate2.t5createPrimary({ inPublic: gateInPublic2 });
    assert.ok(t5.outPublic.equals(probe2Out), 'case 2: T5 over the read template derives the same EK as the probe');
    assert.equal(gate2.verifyEkIdentity(), true, 'case 2: EK identity verified');
    await gate2.flushContext({ flushHandle: t5.handle });

    // (ج) الحالةُ (3): يُنشأ فهرسُ الـnonce ويُكتبُ، فيُقرأُ القالبُ والـnonce معًا (عصٌّ تجريبيٌّ)
    // ويُجمَّعُ القالبُ بالحشوِ، وCreatePrimary عصٌّ بالقالبِ المحشوِّ نفسِهِ، ثمّ البوّابةُ كاملةً
    // من قراءاتِها إلى T5 وتحقّقِ الهويّةِ.
    await defineIndex(NONCE_INDEX, nonceBytes.length);
    await writeIndex(NONCE_INDEX, nameOf(NONCE_INDEX), nonceBytes);
    const probeTemplate3 = await probeNvRead(t, TEMPLATE_INDEX, nameOf(TEMPLATE_INDEX), templateBytes.length);
    const probeNonce3 = await probeNvRead(t, NONCE_INDEX, nameOf(NONCE_INDEX), nonceBytes.length);
    assert.ok(probeNonce3.equals(nonceBytes), 'probe read of the nonce index must return the written bytes');
    const inPublic3 = assembleEkInPublic({ keyType: 'rsa2048', templateBytes: probeTemplate3, nonceBytes: probeNonce3 });
    const parsed3 = builder.parseTpmtPublic(inPublic3);
    const offset3 = /** @type {number} */ (parsed3.uniqueOffset);
    assert.equal(inPublic3.readUInt16BE(offset3), 256, 'case 3: assembled unique is 256');
    assert.deepEqual(inPublic3.subarray(offset3 + 2, offset3 + 2 + 32), nonceBytes, 'case 3: nonce first in unique');
    const probe3 = builder.buildCreatePrimary({ inPublic: inPublic3, session: builder.passwordSession() });
    const probe3Parsed = parseResponse(await t.submit(probe3.command), probe3.descriptor);
    assert.equal(probe3Parsed.form, 'n3', 'case 3 probe CreatePrimary must be n3');
    const probe3Out = firstTpm2b(probe3Parsed.parameters);
    const probe3Flush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probe3Parsed.handles[0]) });
    assert.equal(parseResponse(await t.submit(probe3Flush.command), probe3Flush.descriptor).form, 'n1');
    const pub3 = builder.parseTpmtPublic(probe3Out);
    assert.ok(pub3.rsa, 'case 3 probe public is RSA');
    const ekIdentity3 = mintSimulatedEkCertificatePair({ kty: 'RSA', n: pub3.rsa.modulus.toString('base64url'), e: 'AQAB' });
    assert.ok(!probe3Out.equals(probe2Out), 'case 3 EK must differ from case 2 EK (nonce in unique)');

    const gate3 = new FreshnessGate({ transport: t, mode: 'operation', persistentEkHandle: null, ekIdentity: ekIdentity3 });
    const t1b = await gate3.t1Inventory();
    assert.ok(t1b.handles.includes(TEMPLATE_INDEX) && t1b.handles.includes(NONCE_INDEX), 'T1 inventories template and nonce indices');
    await gate3.t6nvBufferMax();
    await gate3.t2nvReadPublic({ nvIndex: TEMPLATE_INDEX });
    await gate3.t2nvReadPublic({ nvIndex: NONCE_INDEX });
    const gateTemplate3 = await gate3.t3nvRead({ nvIndex: TEMPLATE_INDEX, size: templateBytes.length, offset: 0 });
    const gateNonce3 = await gate3.t3nvRead({ nvIndex: NONCE_INDEX, size: nonceBytes.length, offset: 0 });
    const gateInPublic3 = assembleEkInPublic({ keyType: 'rsa2048', templateBytes: gateTemplate3, nonceBytes: gateNonce3 });
    assert.deepEqual(gateInPublic3, inPublic3, 'gate-assembled inPublic equals probe-assembled (case 3)');
    const t5b = await gate3.t5createPrimary({ inPublic: gateInPublic3 });
    assert.ok(t5b.outPublic.equals(probe3Out), 'case 3: T5 over the padded template derives the same EK as the probe');
    assert.equal(gate3.verifyEkIdentity(), true, 'case 3: EK identity verified');
    await gate3.flushContext({ flushHandle: t5b.handle });

    // تنطيفٌ صارمٌ: محوُ الفهرسَينِ قبلَ إغلاقِ النقلِ.
    for (const { nvIndex, indexName } of defined) {
      const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: builder.passwordSession() });
      const r = await submitRetry(t, undef);
      assert.equal(r.rc, 0, `NV_UndefineSpace(0x${nvIndex.toString(16)}) must succeed`);
    }
  } finally {
    try {
      for (const { nvIndex, indexName } of defined) {
        try {
          const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: builder.passwordSession() });
          await submitRetry(t, undef);
        } catch { /* already undefined — ignore */ }
      }
    } catch { /* transport dead — ignore */ }
    await t.close();
  }
});

simTest('G2: الحالةُ (4) — قالبٌ غائبٌ وnonce موجود: توقّفٌ بـFRESHNESS_TPM_IDENTITY_UNPROVEN بلا CreatePrimary أصلًا (WL-462)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  let createPrimaryCount = 0;
  const counting = {
    submit: async (/** @type {Uint8Array | Buffer} */ bytes) => {
      const b = Buffer.from(bytes);
      if (b.length >= 8 && b.readUInt16BE(6) === 0x131) createPrimaryCount++;
      return t.submit(b);
    },
  };
  const defined = [];
  try {
    // عصٌّ تجريبيٌّ: فهرسُ nonce وحدهُ بلا فهرسِ قالبٍ — الحالةُ التي يقولُ عنها ملفُّ الاعتمادِ
    // «unspecified and MUST NOT be provisioned» فتتوقّفُ المراسمُ قبلَ أيِّ CreatePrimary.
    const NONCE_INDEX = 0x01c00003;
    const nonceBytes = Buffer.alloc(32, 0x77);
    const define = builder.buildNvDefineSpace({ nvIndex: NONCE_INDEX, dataSize: nonceBytes.length, attributes: 0x00040004, session: builder.passwordSession() });
    const resp = await submitRetry(t, define);
    assert.equal(resp.form, 'n3', 'NV_DefineSpace(nonce) response must be n3');
    defined.push({ nvIndex: NONCE_INDEX, indexName: define.indexName });
    const write = builder.buildNvWrite({ nvIndex: NONCE_INDEX, data: nonceBytes, offset: 0, session: builder.passwordSession(), indexName: define.indexName });
    assert.equal((await submitRetry(t, write)).form, 'n3');

    // البوّابةُ تقرأُ الجردَ والـnonce (صفوفُ التمهيدِ)، والتجميعُ يرفضُ الحالةَ (4) صراحةً،
    // ويُثبَتُ بالعدِّ أنّ لا CreatePrimary أُرسلَ قطّ.
    const ekIdentity = mintSimulatedEkCertificatePair({ kty: 'RSA', n: Buffer.alloc(256, 0x11).toString('base64url'), e: 'AQAB' });
    const gate = new FreshnessGate({ transport: /** @type {any} */ (counting), mode: 'operation', persistentEkHandle: null, ekIdentity });
    const t1 = await gate.t1Inventory();
    assert.ok(t1.handles.includes(NONCE_INDEX), 'T1 inventories the nonce index');
    await gate.t6nvBufferMax();
    await gate.t2nvReadPublic({ nvIndex: NONCE_INDEX });
    const readNonce = await gate.t3nvRead({ nvIndex: NONCE_INDEX, size: nonceBytes.length, offset: 0 });
    assert.ok(readNonce.equals(nonceBytes), 'T3 reads the nonce bytes');
    assert.throws(
      () => assembleEkInPublic({ keyType: 'rsa2048', templateBytes: null, nonceBytes: readNonce }),
      (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN,
    );
    assert.equal(createPrimaryCount, 0, 'case 4: no CreatePrimary may be submitted (halt before it)');

    // تنطيفٌ صارمٌ.
    const undef = builder.buildNvUndefineSpace({ nvIndex: NONCE_INDEX, indexName: define.indexName, session: builder.passwordSession() });
    assert.equal((await submitRetry(t, undef)).rc, 0);
  } finally {
    try {
      for (const { nvIndex, indexName } of defined) {
        try {
          const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: builder.passwordSession() });
          await submitRetry(t, undef);
        } catch { /* already undefined — ignore */ }
      }
    } catch { /* transport dead — ignore */ }
    await t.close();
  }
});

simTest('G2: مسارُ T4 — EK مستمرّ عبرَ البوّابةِ على swtpm حيّ: ReadPublic للمقبضِ المستمرِّ ثمّ salted ثمّ confirmed (WL-462)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  const PERSISTENT_HANDLE = 0x81000000;
  try {
    // (أ) عصٌّ تجريبيٌّ خارجَ البوّابةِ: CreatePrimary بالقالبِ الافتراضيِّ ثمّ EvictControl
    // إلى مقبضٍ مستمرٍّ في المدىِ 0x81000000 (البوّابةُ لا ترى هذه الخطوة — EvictControl
    // ممنوعٌ فيها دائمًا بحسبِ §4.3؛ هذا تثبيتُ رقعةِ اختبارِ مسارِ T4 وحده).
    const probe = builder.buildCreatePrimary({ inPublic: builder.defaultEkTemplateRsa2048(), session: builder.passwordSession() });
    const probeParsed = parseResponse(await t.submit(probe.command), probe.descriptor);
    assert.equal(probeParsed.form, 'n3', 'probe CreatePrimary must be n3');
    const probeOut = firstTpm2b(probeParsed.parameters);
    const evict = builder.buildEvictControl({ objectHandle: /** @type {number} */ (probeParsed.handles[0]), persistentHandle: PERSISTENT_HANDLE, session: builder.passwordSession() });
    const evictParsed = parseResponse(await t.submit(evict.command), evict.descriptor);
    assert.equal(evictParsed.form, 'n3', 'EvictControl response must be n3 (password session)');
    const probeFlush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probeParsed.handles[0]) });
    assert.equal(parseResponse(await t.submit(probeFlush.command), probeFlush.descriptor).form, 'n1');
    const pubT4 = builder.parseTpmtPublic(probeOut);
    assert.ok(pubT4.rsa, 'T4 probe public is RSA');
    const ekIdentity = mintSimulatedEkCertificatePair({ kty: 'RSA', n: pubT4.rsa.modulus.toString('base64url'), e: 'AQAB' });

    // (ب) البوّابةُ على المسارِ المستمرِّ: T4 يقرأُ المفتاحَ من مقبضِهِ المستمرِّ (لا CreatePrimary)،
    // ثمّ تحقّقُ الهويّةِ والجلسةُ المملّحةُ بذاكَ المقبضِ عينِهِ، وP0 وC1 إلى confirmed.
    const gate = new FreshnessGate({ transport: t, mode: 'operation', persistentEkHandle: PERSISTENT_HANDLE, ekIdentity });
    const t1 = await gate.t1Inventory();
    assert.deepEqual(t1.handles, [], 'fresh simulator carries no EK NV indices');
    const t4 = await gate.t4readPublic();
    assert.ok(t4.outPublic.equals(probeOut), 'T4 must read the evicted EK public bytes');
    assert.equal(gate.verifyEkIdentity(), true, 'T4: EK identity verified against the persistent handle');
    const sas = await gate.startAuthSession();
    assert.ok(Number.isInteger(sas.handle), 'salted HMAC session opened with the persistent EK as tpmKey');
    const p0 = await gate.p0Attest();
    assert.deepEqual(p0.handles, [], 'P0 page over the empty inventory');
    assert.equal(gate.state, 'salted', 'P0 promotes to salted (R5-01)');
    const c1 = await gate.c1Confirm();
    assert.deepEqual(c1.handles, [], 'C1 confirms the empty handle set');
    assert.equal(gate.state, 'confirmed', 'persistent-EK path reaches confirmed');
    await gate.flushContext({ flushHandle: sas.handle });
    assert.equal(gate.closed, false, 'clean close, no gate failure');

    // تنطيفٌ مُتحقَّقٌ منه (لا مجرّدَ مسعىً): إزالةُ المستمرِّ يجبَ أن تنجحَ، ثمّ إزالةٌ
    // ثانيةٌ للمقبضِ نفسِهِ يجبُ أن تخفقَ (لا كائنَ بعدَها) — هذا إثباتُ الزوالِ الفعليِّ.
    const evictDone = builder.buildEvictControl({ objectHandle: PERSISTENT_HANDLE, persistentHandle: PERSISTENT_HANDLE, session: builder.passwordSession() });
    const evictDoneParsed = await submitRetry(t, evictDone);
    assert.equal(evictDoneParsed.form, 'n3', 'cleanup EvictControl must succeed (n3)');
    const evictAgain = builder.buildEvictControl({ objectHandle: PERSISTENT_HANDLE, persistentHandle: PERSISTENT_HANDLE, session: builder.passwordSession() });
    const evictAgainParsed = parseResponse(await t.submit(evictAgain.command), evictAgain.descriptor);
    assert.equal(evictAgainParsed.form, 'error', 'second EvictControl must fail — the persistent handle is gone');
    assert.ok(/** @type {number} */ (evictAgainParsed.rc) !== 0, 'second EvictControl rc must be nonzero (no such persistent object)');
  } finally {
    // تنطيفٌ صارمٌ: إزالةُ المفتاحِ المستمرِّ (EvictControl بالمقبضِ نفسِهِ في الحقلَينِ) قبلَ الإغلاقِ —
    // مسعىً أخيرٌ لا يُفشِلُ الاختبارَ إن كانَ قد زال.
    try {
      const evictCleanup = builder.buildEvictControl({ objectHandle: PERSISTENT_HANDLE, persistentHandle: PERSISTENT_HANDLE, session: builder.passwordSession() });
      try {
        await submitRetry(t, evictCleanup);
      } catch { /* already evicted — ignore */ }
    } catch { /* transport dead — ignore */ }
    await t.close();
  }
});

