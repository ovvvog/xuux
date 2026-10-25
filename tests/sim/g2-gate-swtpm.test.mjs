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
      // (WL-465) رمزُ الأمرِ u32 عندَ الإزاحةِ 6 (‏tag‗size‗cc — Part 2 §6): القراءةُ
      // السابقةُ u16@6 كانت تُطابقُ صفرًا دائمًا فلا يعدُّ الأمرَ قطّ — عدّادٌ ميتٌ يجعلُ
      // تأكيدَ «لا CreatePrimary مُرسلًا» فارغَ المنفعةِ (يمرُّ لو أُرسلَ فعلًا). صُحّحت إلى
      // u32@6 معَ طولٍ كافٍ قبلَ القراءةِ.
      if (b.length >= 10 && b.readUInt32BE(6) === builder.TPM_CC.CreatePrimary) createPrimaryCount++;
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
  /** مقابضٌ أُنشئت ولم يُثبَت زوالُها بعد — للتنظيفِ الاحتياطيِّ في finally (مسارُ الفشلِ). @type {number | null} */
  let probeHandle = null;
  /** @type {number | null} */
  let sessionHandle = null;
  try {
    // (أ) عصٌّ تجريبيٌّ خارجَ البوّابةِ: CreatePrimary بالقالبِ الافتراضيِّ ثمّ EvictControl
    // إلى مقبضٍ مستمرٍّ في المدىِ 0x81000000 (البوّابةُ لا ترى هذه الخطوة — EvictControl
    // ممنوعٌ فيها دائمًا بحسبِ §4.3؛ هذا تثبيتُ رقعةِ اختبارِ مسارِ T4 وحده).
    const probe = builder.buildCreatePrimary({ inPublic: builder.defaultEkTemplateRsa2048(), session: builder.passwordSession() });
    const probeParsed = parseResponse(await t.submit(probe.command), probe.descriptor);
    assert.equal(probeParsed.form, 'n3', 'probe CreatePrimary must be n3');
    probeHandle = /** @type {number} */ (probeParsed.handles[0]);
    const probeOut = firstTpm2b(probeParsed.parameters);
    const evict = builder.buildEvictControl({ objectHandle: /** @type {number} */ (probeParsed.handles[0]), persistentHandle: PERSISTENT_HANDLE, session: builder.passwordSession() });
    const evictParsed = parseResponse(await t.submit(evict.command), evict.descriptor);
    assert.equal(evictParsed.form, 'n3', 'EvictControl response must be n3 (password session)');
    const probeFlush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probeParsed.handles[0]) });
    assert.equal(parseResponse(await t.submit(probeFlush.command), probeFlush.descriptor).form, 'n1');
    probeHandle = null; // زالَ وتحقّقنا من الاستجابةِ (n1)
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
    sessionHandle = sas.handle;
    const p0 = await gate.p0Attest();
    assert.deepEqual(p0.handles, [], 'P0 page over the empty inventory');
    assert.equal(gate.state, 'salted', 'P0 promotes to salted (R5-01)');
    const c1 = await gate.c1Confirm();
    assert.deepEqual(c1.handles, [], 'C1 confirms the empty handle set');
    assert.equal(gate.state, 'confirmed', 'persistent-EK path reaches confirmed');
    await gate.flushContext({ flushHandle: sas.handle });
    sessionHandle = null; // زالَ وتحقّقنا من الاستجابةِ
    assert.equal(gate.closed, false, 'clean close, no gate failure');

    // تنطيفٌ مُتحقَّقٌ منه (لا مجرّدَ مسعىً): إزالةُ المستمرِّ يجبَ أن تنجحَ، ثمّ إزالةٌ
    // ثانيةٌ للمقبضِ نفسِهِ يجبُ أن تخفقَ بخطإِ غيابِ objectHandle تحديدًا — هذا إثباتُ الزوالِ.
    const evictDone = builder.buildEvictControl({ objectHandle: PERSISTENT_HANDLE, persistentHandle: PERSISTENT_HANDLE, session: builder.passwordSession() });
    const evictDoneParsed = await submitRetry(t, evictDone);
    assert.equal(evictDoneParsed.form, 'n3', 'cleanup EvictControl must succeed (n3)');
    const evictAgain = builder.buildEvictControl({ objectHandle: PERSISTENT_HANDLE, persistentHandle: PERSISTENT_HANDLE, session: builder.passwordSession() });
    const evictAgainParsed = parseResponse(await t.submit(evictAgain.command), evictAgain.descriptor);
    assert.equal(evictAgainParsed.form, 'error', 'second EvictControl must fail — the persistent handle is gone');
    // 0x28b مفكوكُ الاسمِ عبرَ tpm2_rc_decode: «tpm:handle(2): the handle is not correct for
    // the use» — المقبضُ الثاني في منطقةِ المقايسِ هو objectHandle (الكائنُ المستمرُّ) وقد زال؛
    // قيمةٌ مُلاحظةٌ تجريبيًا لا مُخمَّنة، ومُتسقةٌ مع مواصفةِ TPM2 (ليست خاصّيةَ إصدارِ swtpm).
    assert.equal(evictAgainParsed.rc, 0x28b, 'second EvictControl rc must be 0x28b (handle(2): objectHandle not correct for use)');
    assert.equal(evictAgainParsed.retryable, false, 'the absence error is terminal, not retryable');
    assert.equal(evictAgainParsed.fatal, false, 'the absence error is a normal TPM error, not fatal');
  } finally {
    // مسعىً احتياطيًّا لمسارِ الفشلِ فقط (المسارُ الناجحُ يُثبتُ التنظيفَ أعلاه): أيُّ مقبضٍ
    // أُنشئ ولم يُثبَت زوالُه يُطالَبُ هنا بالتنظيفِ، ونتائجُ المساعي متجاهَلةٌ لا تُفشِلُ الاختبار.
    try {
      if (sessionHandle !== null) await t.submit(builder.buildFlushContext({ flushHandle: sessionHandle }).command);
    } catch { /* already flushed or transport dead — ignore */ }
    try {
      if (probeHandle !== null) await t.submit(builder.buildFlushContext({ flushHandle: probeHandle }).command);
    } catch { /* already flushed or transport dead — ignore */ }
    try {
      const evictCleanup = builder.buildEvictControl({ objectHandle: PERSISTENT_HANDLE, persistentHandle: PERSISTENT_HANDLE, session: builder.passwordSession() });
      try {
        await submitRetry(t, evictCleanup);
      } catch { /* already evicted — ignore */ }
    } catch { /* transport dead — ignore */ }
    await t.close();
  }
});


// ——— WL-465: تسديدُ فجواتِ G2 على swtpm الحيّ ———
//
// حاشيةُ WL-462 تركت البندَ (5) على المحاكي الحيّ بلا وسيطِ عبثٍ متاح، وحالاتِ الرفضِ في
// البنودِ (3) و(4) و(6)–(9) على النادلِ الوهميّ وحده. تُسدَّدُ هنا بأربعةِ أدلةٍ حيّةٍ
// صادقةِ التسميةِ:
//
// 1. **انجرافُ المحتوى (5):** كتابةُ NV **مشروعةٌ** على المحاكي الحيّ بينَ قراءةِ التمهيدِ
//    (T3) وقراءةِ C1 — لا وسيطَ عبثٍ مُختلَق: المحتوى يتغيّرُ فعلًا، واسمُ الفهرسِ لا
//    يتغيّرُ بالمحتوى فتبقى مصادقةُ أوامرِ C1 سليمةً، فيصلُ التناقضُ إلى **مقارنةِ البايتاتِ**
//    نفسِها — المسارُ الحقيقيُّ الذي أرادَهُ بندُ القبول. لكلِّ فهرسٍ من الستّةِ.
// 2. **انجرافُ مجموعةِ المقابضِ (5)/(6):** إضافةُ فهرسٍ بـNV_DefineSpace وحذفُ فهرسٍ بـ
//    NV_UndefineSpace بعدَ اكتمالِ T1 — عمليّاتٌ مشروعةٌ على المحاكي، ومقارنةُ مجموعةِ
//    C1 (من صفحةِ P0) معَ مجموعةِ T1 هي التي تُغلقُ.
// 3. **رفضٌ قبلَ الإرسالِ (3)/(4)/(7)/(8):** حالاتُ رفضِ البوّابةِ قبلَ أيِّ بايتٍ يُرسَل —
//    فوقَ النقلِ الحيّ نفسِهِ، بغلافِ عدٍّ يحصي الأوامرَ المُرسَلةَ فعلًا (الرفضُ طبقةُ
//    البوّابةِ، والعدّادُ يُثبتُ أنّ النقلَ لم يُلمَس).
// 4. **حقنُ أعطالٍ في النقلِ (7 — أشكالُ الردّ):** غلافٌ فوقَ swtpm الحيّ يعترضُ ردَّ P0
//    (أولَ GetCapability بجلسةٍ) ويُحرّفُه: HMAC فاسدٌ، أو سمةُ 0x01، أو ردُّ خطأٍ
//    مُصنَّعٌ. تسميةٌ دقيقةٌ: **حقنُ أعطالٍ في النقلِ** لا «استجابةٌ طبيعيةٌ»؛ كلُّ أمرٍ غيرِ
//    مستهدَفٍ يمرُّ كما هو (والعدّادُ يُثبتُهُ)، والاعتراضُ أصابَ الأمرَ المقصودَ وحدَه،
//    والرفضُ وقعَ في طبقةِ التحقّقِ من الردّ للسببِ الصحيحِ.
//
// **حدٌّ معلَن:** كلُّ ذلك دليلُ محاكاةٍ على swtpm لا دليلَ عتادٍ (ADR 0007 §9)، ولا يرفعُ
// أيَّ قرارِ مخاطرةٍ إنتاجيّ، و`SUPPORTED_FRESHNESS_BACKENDS` يبقى فارغًا.

/**
 * غلافُ عدٍّ فوقَ النقلِ الخام: يحصي كلَّ أمرٍ يُرسَل فعلًا إلى المحاكي. رفضُ البوّابةِ
 * قبلَ الإرسالِ يُثبَتُ بهذهِ الحاصّةِ — العدّادُ لا يتحرّكُ إلا ببايتاتٍ بلغتِ النقلَ الحيّ.
 */
class CountingTransport {
  /** @param {import('../../sim/tpm/raw_transport.mjs').SwtpmRawTransport} inner */
  constructor(inner) {
    this.inner = inner;
    /** @type {Buffer[]} */
    this.sent = [];
  }
  /** @param {Uint8Array | Buffer} bytes @returns {Promise<Uint8Array>} */
  async submit(bytes) {
    const b = Buffer.from(bytes);
    this.sent.push(b);
    return this.inner.submit(b);
  }
}

/**
 * غلافُ حقنِ أعطالٍ في النقلِ فوقَ swtpm حيّ. كلُّ أمرٍ غيرِ مستهدَفٍ يُمرَّرُ إلى المحاكي
 * كما هو (يُحصى في `passedThrough`)، والأمرُ المستهدَفُ — أولُ GetCapability بجلسةٍ =
 * أمرُ الإثباتِ P0 — يُمرَّرُ فيُحرَّفُ ردُّهُ (حُقنَتِ العطلَةُ في النقلِ لا في المحاكي):
 *
 * - `corruptHmac`: قلبُ آخرِ بايتٍ في الردّ (آخرُ بايتِ HMAC في منطقةِ التفويضِ).
 * - `flipAttrs`: تعيينُ بايتِ سماتِ الجلسةِ في الردّ إلى 0x01 (حالةُ «بالسمة 0x01»
 *   في مصفوفةِ القبولِ — بلا audit، فيرفضُهُ فحصُ السماتِ في محلّلِ الردودِ).
 * - `errorResponse`: ردُّ خطأٍ مُصنَّعٌ بعشرةِ بايتاتٍ (§4.4 خ) لا يُمرَّرُ إلى المحاكي أصلًا.
 *
 * حقنةٌ واحدةٌ لا تتكرّرُ (single-shot): ما بعدَها يعودُ الغلافُ شفّافًا.
 */
class FaultInjectingTransport {
  /**
   * @param {import('../../sim/tpm/raw_transport.mjs').SwtpmRawTransport} inner
   * @param {'corruptHmac' | 'flipAttrs' | 'errorResponse'} fault
   * @param {number} errorCode — رمزُ ردِّ الخطأِ المُصنَّعِ وحده
   */
  constructor(inner, fault, errorCode = 0x9a2) {
    this.inner = inner;
    this.fault = fault;
    this.errorCode = errorCode;
    /** @type {Buffer[]} */
    this.passedThrough = [];
    this.injected = 0;
  }
  /** @param {Uint8Array | Buffer} bytes @returns {Promise<Uint8Array | Buffer>} */
  async submit(bytes) {
    const b = Buffer.from(bytes);
    const isSessionedGetCapability =
      b.length >= 10 && b.readUInt16BE(0) === 0x8002 && b.readUInt32BE(6) === builder.TPM_CC.GetCapability;
    if (!isSessionedGetCapability || this.injected > 0) {
      this.passedThrough.push(b);
      return this.inner.submit(b);
    }
    this.injected += 1;
    if (this.fault === 'errorResponse') {
      // ردُّ خطأٍ بعشرةِ بايتاتٍ: وسمُ بلا جلساتٍ + حجمٌ + رمزٌ — مُصنَّعٌ لا من المحاكي.
      const frame = Buffer.alloc(10);
      frame.writeUInt16BE(0x8001, 0);
      frame.writeUInt32BE(10, 2);
      frame.writeUInt32BE(this.errorCode, 6);
      return frame;
    }
    const response = Buffer.from(await this.inner.submit(b));
    if (this.fault === 'corruptHmac') {
      const lastByte = response.length - 1;
      response[lastByte] = (response[lastByte] ?? 0) ^ 0x01;
      return response;
    }
    // flipAttrs: منطقةُ التفويضِ تبدأُ بعدَ المعاملاتِ (u32 حجمُها عندَ 10): nonceTPM
    // (tpm2b) ثمّ بايتُ السماتِ — يُعيَّنُ إلى 0x01 كما في حالةِ المصفوفةِ.
    const parameterSize = response.readUInt32BE(10);
    const authStart = 14 + parameterSize;
    const attrsOffset = authStart + 2 + response.readUInt16BE(authStart);
    response[attrsOffset] = 0x01;
    return response;
  }
}

simTest('G2 (5): انجرافُ محتوى الفهرسِ بينَ التمهيدِ وC1 على swtpm حيّ — كتابةُ NV مشروعةٌ على المحاكي، لكلِّ فهرسٍ من الستّةِ (WL-465)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  /** فهارسُ عُرّفت ولم تُمحَ بعد — للتنطيفِ الاحتياطيِّ في finally. @type {{ nvIndex: number, indexName: Buffer }[]} */
  const defined = [];
  /** مقابضُ عابرةٌ نشطةٌ (جلسةٌ وEK) — تُفرَّغُ يدويًّا بعدَ إغلاقِ البوّابةِ بالفشلِ. @type {number[]} */
  const liveHandles = [];
  try {
    // (أ) عصٌّ تجريبيٌّ واحدٌ للهويّةِ: الاشتقاقُ حتميٌّ (القالبُ نفسُهُ على حالةِ المحاكي
    // نفسِها ⇒ المفتاحُ نفسُهُ)، فيكفي استخراجُ معاملِ EK مرةً واحدةً لكلِّ الدوراتِ.
    const probeBuilt = builder.buildCreatePrimary({ inPublic: builder.defaultEkTemplateRsa2048(), session: builder.passwordSession() });
    const probeParsed = parseResponse(await t.submit(probeBuilt.command), probeBuilt.descriptor);
    assert.equal(probeParsed.form, 'n3', 'probe CreatePrimary response must be n3');
    const probeOutPublic = firstTpm2b(probeParsed.parameters);
    const probeFlush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probeParsed.handles[0]) });
    assert.equal(parseResponse(await t.submit(probeFlush.command), probeFlush.descriptor).form, 'n1', 'probe flush must be n1');
    const probeTpmt = builder.parseTpmtPublic(probeOutPublic);
    assert(probeTpmt.rsa, 'probe EK must be RSA');
    const ekIdentity = mintSimulatedEkCertificatePair({ kty: 'RSA', n: probeTpmt.rsa.modulus.toString('base64url'), e: 'AQAB' });

    const NV_DATA_SIZE = 32;
    // (ب) لكلِّ فهرسٍ من الستّةِ دورةٌ كاملةٌ: تعريفٌ وكتابةٌ ثمّ تمهيدٌ حتى P0 ثمّ انجرافٌ
    // مشروعٌ (كتابةٌ فوقَ الفهرسِ) ثمّ C1 يجبُ أن يُغلقَ عندَ المقارنةِ البايتيّةِ.
    for (const nvIndex of builder.EK_NV_RANGE.indices) {
      const contentA = Buffer.alloc(NV_DATA_SIZE, 0x5a);
      contentA.writeUInt8(nvIndex & 0xff, 0); // يحملُ الفهرسَ في بايتِهِ الأول
      const define = builder.buildNvDefineSpace({ nvIndex, dataSize: NV_DATA_SIZE, attributes: 0x00040004, session: builder.passwordSession() });
      const definedResp = await submitRetry(t, define);
      assert.equal(definedResp.form, 'n3', `NV_DefineSpace(0x${nvIndex.toString(16)}) must succeed`);
      defined.push({ nvIndex, indexName: define.indexName });
      const writeA = builder.buildNvWrite({ nvIndex, data: contentA, offset: 0, session: builder.passwordSession(), indexName: define.indexName });
      assert.equal((await submitRetry(t, writeA)).form, 'n3', `initial NV_Write(0x${nvIndex.toString(16)}) must succeed`);

      const gate = new FreshnessGate({ transport: t, mode: 'operation', persistentEkHandle: null, ekIdentity });
      const t1 = await gate.t1Inventory();
      assert.deepEqual(t1.handles, [nvIndex], `T1 must inventory exactly 0x${nvIndex.toString(16)}`);
      await gate.t6nvBufferMax();
      await gate.t2nvReadPublic({ nvIndex });
      const t3 = await gate.t3nvRead({ nvIndex, size: NV_DATA_SIZE, offset: 0 });
      assert.ok(t3.equals(contentA), `T3 must read the written content for 0x${nvIndex.toString(16)}`);
      const t5 = await gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
      liveHandles.push(t5.handle);
      assert.equal(gate.verifyEkIdentity(), true, 'EK identity verified against the live swtpm EK');
      const sas = await gate.startAuthSession();
      liveHandles.push(sas.handle);
      const p0 = await gate.p0Attest();
      assert.deepEqual(p0.handles, [nvIndex], `P0 page must cover 0x${nvIndex.toString(16)}`);
      assert.equal(gate.state, 'salted', 'P0 verified response promotes to salted');

      // (ج) الانجرافُ المشروعُ: كتابةٌ فوقَ الفهرسِ خارجَ البوّابةِ عبرَ النقلِ الخامِّ — لا
      // وسيطَ عبثٍ مُختلَق: المحاكي نفسُهُ يقبلُ الكتابةَ (تفويضُ الفهرسِ فارغٌ)، والمحتوى
      // يتغيّرُ فعلًا ببايتٍ واحدٍ. اسمُ الفهرسِ لا يتغيّرُ بالمحتوى فتبقى مصادقةُ أوامرِ
      // C1 سليمةً — فيصلُ التناقضُ إلى المقارنةِ البايتيّةِ نفسِها لا إلى فشلِ HMAC.
      const contentB = Buffer.from(contentA);
      const driftByte = contentB.length - 1;
      contentB[driftByte] = (contentB[driftByte] ?? 0) ^ 0x01;
      const writeB = builder.buildNvWrite({ nvIndex, data: contentB, offset: 0, session: builder.passwordSession(), indexName: define.indexName });
      assert.equal((await submitRetry(t, writeB)).form, 'n3', `legitimate drift NV_Write(0x${nvIndex.toString(16)}) must succeed on the simulator`);

      // C1 يقرأُ المحتوى الجديدَ بردٍّ مصادَقٍ سليمِ، ثمّ تُسقطُهُ المقارنةُ البايتيّةُ.
      /** @type {unknown} */
      let caught;
      await assert.rejects(gate.c1Confirm(), (/** @type {{ code?: string }} */ e) => { caught = e; return e.code === GATE_ERRORS.IDENTITY_UNPROVEN; });
      assert.match(String(/** @type {Error} */ (caught).message), /differs from T3/, `rejection must come from the byte comparison for 0x${nvIndex.toString(16)}`);
      assert.equal(gate.closed, true, `gate closed on content drift for 0x${nvIndex.toString(16)}`);

      // (د) تنطيفُ الدورةِ: البوّابةُ أُغلقت بالفشلِ فلا تُفرِّغُ عبرَها — تفريغٌ خامٌّ
      // للمقبضينِ (الجلسةُ وEK العابرُ) ثمّ محوُ الفهرسِ قبلَ الدورةِ التاليةِ.
      for (const h of liveHandles.splice(0)) {
        const flush = builder.buildFlushContext({ flushHandle: h });
        const flushed = parseResponse(await t.submit(flush.command), flush.descriptor);
        assert.equal(flushed.rc, 0, `FlushContext(0x${h.toString(16)}) must succeed`);
      }
      const undef = builder.buildNvUndefineSpace({ nvIndex, indexName: define.indexName, session: builder.passwordSession() });
      const undefinedResp = await submitRetry(t, undef);
      assert.equal(undefinedResp.rc, 0, `NV_UndefineSpace(0x${nvIndex.toString(16)}) must succeed`);
      defined.pop();
    }
    assert.equal(defined.length, 0, 'all six drift cycles cleaned up');
  } finally {
    try {
      for (const h of liveHandles.splice(0)) {
        try { await t.submit(builder.buildFlushContext({ flushHandle: h }).command); } catch { /* already flushed — ignore */ }
      }
      for (const { nvIndex, indexName } of defined.splice(0)) {
        try {
          const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: builder.passwordSession() });
          await submitRetry(t, undef);
        } catch { /* already undefined — ignore */ }
      }
    } catch { /* transport dead — ignore */ }
    await t.close();
  }
});

simTest('G2 (5)/(6): انجرافُ مجموعةِ المقابضِ بينَ T1 وC1 على swtpm حيّ — إضافةُ فهرسٍ وحذفُ فهرسٍ بعدَ التمهيدِ (WL-465)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  /** @type {{ nvIndex: number, indexName: Buffer }[]} */
  const defined = [];
  /** @type {number[]} */
  const liveHandles = [];
  try {
    // عصٌّ تجريبيٌّ للهويّةِ — كما في اختبارِ الانجرافِ أعلاه.
    const probeBuilt = builder.buildCreatePrimary({ inPublic: builder.defaultEkTemplateRsa2048(), session: builder.passwordSession() });
    const probeParsed = parseResponse(await t.submit(probeBuilt.command), probeBuilt.descriptor);
    assert.equal(probeParsed.form, 'n3', 'probe CreatePrimary response must be n3');
    const probeOutPublic = firstTpm2b(probeParsed.parameters);
    const probeFlush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probeParsed.handles[0]) });
    assert.equal(parseResponse(await t.submit(probeFlush.command), probeFlush.descriptor).form, 'n1', 'probe flush must be n1');
    const probeTpmt = builder.parseTpmtPublic(probeOutPublic);
    assert(probeTpmt.rsa, 'probe EK must be RSA');
    const ekIdentity = mintSimulatedEkCertificatePair({ kty: 'RSA', n: probeTpmt.rsa.modulus.toString('base64url'), e: 'AQAB' });

    const NV_DATA_SIZE = 8;
    const content = Buffer.alloc(NV_DATA_SIZE, 0x3c);
    const A = 0x01c00002;
    const B = 0x01c00003;
    /** تعريفُ فهرسٍ وكتابةُ محتواهُ عبرَ النقلِ الخامِّ (تثبيتُ رقعةِ الاختبارِ). @param {number} nvIndex */
    const defineAndWrite = async (nvIndex) => {
      const define = builder.buildNvDefineSpace({ nvIndex, dataSize: NV_DATA_SIZE, attributes: 0x00040004, session: builder.passwordSession() });
      assert.equal((await submitRetry(t, define)).form, 'n3', `NV_DefineSpace(0x${nvIndex.toString(16)}) must succeed`);
      defined.push({ nvIndex, indexName: define.indexName });
      const write = builder.buildNvWrite({ nvIndex, data: content, offset: 0, session: builder.passwordSession(), indexName: define.indexName });
      assert.equal((await submitRetry(t, write)).form, 'n3', `NV_Write(0x${nvIndex.toString(16)}) must succeed`);
    };

    // (أ) الإضافةُ: التمهيدُ على {A} وحدها (B لم تُعرَّفْ بعدُ)، ثمّ تعريفُ B قبلَ P0 —
    // صفحةُ P0 تجلبُ {A,B} فتخالفُ مجموعةَ T1 عندَ المقارنةِ في C1.
    await defineAndWrite(A);
    const gateAdd = new FreshnessGate({ transport: t, mode: 'operation', persistentEkHandle: null, ekIdentity });
    const t1Add = await gateAdd.t1Inventory();
    assert.deepEqual(t1Add.handles, [A], 'T1 inventories only A before B is defined');
    await gateAdd.t6nvBufferMax();
    await gateAdd.t2nvReadPublic({ nvIndex: A });
    await gateAdd.t3nvRead({ nvIndex: A, size: NV_DATA_SIZE, offset: 0 });
    const t5Add = await gateAdd.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
    liveHandles.push(t5Add.handle);
    assert.equal(gateAdd.verifyEkIdentity(), true, 'EK identity verified');
    const sasAdd = await gateAdd.startAuthSession();
    liveHandles.push(sasAdd.handle);
    // الإضافةُ المشروعةُ بعدَ اكتمالِ T1: تعريفُ B عبرَ النقلِ الخامِّ (خارجَ البوّابةِ).
    await defineAndWrite(B);
    const p0Add = await gateAdd.p0Attest();
    assert.deepEqual(p0Add.handles, [A, B], 'P0 page must now carry both indices');
    /** @type {unknown} */
    let caughtAdd;
    await assert.rejects(gateAdd.c1Confirm(), (/** @type {{ code?: string }} */ e) => { caughtAdd = e; return e.code === GATE_ERRORS.IDENTITY_UNPROVEN; });
    assert.match(String(/** @type {Error} */ (caughtAdd).message), /handle set differs from T1/, 'add: C1 set comparison must close the gate');
    assert.equal(gateAdd.closed, true, 'add: gate closed');

    // (ب) الحذفُ: تعريفُ الفهرسينِ قبلَ البوّابةِ، تمهيدٌ على {A,B}، ثمّ محوُ B قبلَ P0 —
    // صفحةُ P0 تجلبُ {A} وحدها فتخالفُ مجموعةَ T1.
    const gateDrop = new FreshnessGate({ transport: t, mode: 'operation', persistentEkHandle: null, ekIdentity });
    const t1Drop = await gateDrop.t1Inventory();
    assert.deepEqual(t1Drop.handles, [A, B], 'T1 inventories both indices');
    await gateDrop.t6nvBufferMax();
    await gateDrop.t2nvReadPublic({ nvIndex: A });
    await gateDrop.t3nvRead({ nvIndex: A, size: NV_DATA_SIZE, offset: 0 });
    await gateDrop.t2nvReadPublic({ nvIndex: B });
    await gateDrop.t3nvRead({ nvIndex: B, size: NV_DATA_SIZE, offset: 0 });
    const t5Drop = await gateDrop.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
    liveHandles.push(t5Drop.handle);
    assert.equal(gateDrop.verifyEkIdentity(), true, 'EK identity verified');
    const sasDrop = await gateDrop.startAuthSession();
    liveHandles.push(sasDrop.handle);
    // الحذفُ المشروعُ بعدَ اكتمالِ T1: محوُ B عبرَ النقلِ الخامِّ (خارجَ البوّابةِ).
    const bEntry = defined.find((d) => d.nvIndex === B);
    assert.ok(bEntry, 'B must have been defined and tracked');
    const undefB = builder.buildNvUndefineSpace({ nvIndex: B, indexName: bEntry.indexName, session: builder.passwordSession() });
    assert.equal((await submitRetry(t, undefB)).rc, 0, 'legitimate NV_UndefineSpace(B) must succeed on the simulator');
    // مُحي مشروعًا وسطَ الاختبارِ عمدًا — يُحذفُ من سجلِّ التنطيفِ كي لا «يُمحى» مرتينِ.
    defined.splice(defined.findIndex((d) => d.nvIndex === B), 1);
    const p0Drop = await gateDrop.p0Attest();
    assert.deepEqual(p0Drop.handles, [A], 'P0 page must carry only A after B is dropped');
    /** @type {unknown} */
    let caughtDrop;
    await assert.rejects(gateDrop.c1Confirm(), (/** @type {{ code?: string }} */ e) => { caughtDrop = e; return e.code === GATE_ERRORS.IDENTITY_UNPROVEN; });
    assert.match(String(/** @type {Error} */ (caughtDrop).message), /handle set differs from T1/, 'drop: C1 set comparison must close the gate');
    assert.equal(gateDrop.closed, true, 'drop: gate closed');

    // تنطيفٌ صارمٌ: المقابضُ العابرةُ خامًّا (البوّابتانِ مغلقتانِ بالفشلِ)، ثمّ محوُ ما بقيَ.
    for (const h of liveHandles.splice(0)) {
      const flush = builder.buildFlushContext({ flushHandle: h });
      const flushed = parseResponse(await t.submit(flush.command), flush.descriptor);
      assert.equal(flushed.rc, 0, `FlushContext(0x${h.toString(16)}) must succeed`);
    }
    for (const { nvIndex, indexName } of defined.splice(0)) {
      const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: builder.passwordSession() });
      assert.equal((await submitRetry(t, undef)).rc, 0, `NV_UndefineSpace(0x${nvIndex.toString(16)}) must succeed`);
    }
  } finally {
    try {
      for (const h of liveHandles.splice(0)) {
        try { await t.submit(builder.buildFlushContext({ flushHandle: h }).command); } catch { /* already flushed — ignore */ }
      }
      for (const { nvIndex, indexName } of defined.splice(0)) {
        try {
          const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: builder.passwordSession() });
          await submitRetry(t, undef);
        } catch { /* already undefined — ignore */ }
      }
    } catch { /* transport dead — ignore */ }
    await t.close();
  }
});

simTest('G2 (3)/(8): رفضُ صفوفٍ خارجَ الحالةِ وجلسةٍ ثانيةٍ وP0 مزدوجٍ قبلَ الإرسالِ على swtpm حيّ — غلافُ عدٍّ يُثبتُ صفرَ بايتاتٍ (WL-465)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  const counting = new CountingTransport(t);
  /** @type {{ nvIndex: number, indexName: Buffer }[]} */
  const defined = [];
  try {
    const NV_DATA_SIZE = 8;
    const A = 0x01c00002;
    const define = builder.buildNvDefineSpace({ nvIndex: A, dataSize: NV_DATA_SIZE, attributes: 0x00040004, session: builder.passwordSession() });
    assert.equal((await submitRetry(t, define)).form, 'n3', 'NV_DefineSpace(A) must succeed');
    defined.push({ nvIndex: A, indexName: define.indexName });
    const write = builder.buildNvWrite({ nvIndex: A, data: Buffer.alloc(NV_DATA_SIZE, 0x21), offset: 0, session: builder.passwordSession(), indexName: define.indexName });
    assert.equal((await submitRetry(t, write)).form, 'n3', 'NV_Write(A) must succeed');

    // عصٌّ تجريبيٌّ للهويّةِ.
    const probeBuilt = builder.buildCreatePrimary({ inPublic: builder.defaultEkTemplateRsa2048(), session: builder.passwordSession() });
    const probeParsed = parseResponse(await t.submit(probeBuilt.command), probeBuilt.descriptor);
    assert.equal(probeParsed.form, 'n3', 'probe CreatePrimary response must be n3');
    const probeOutPublic = firstTpm2b(probeParsed.parameters);
    const probeFlush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probeParsed.handles[0]) });
    assert.equal(parseResponse(await t.submit(probeFlush.command), probeFlush.descriptor).form, 'n1', 'probe flush must be n1');
    const probeTpmt = builder.parseTpmtPublic(probeOutPublic);
    assert(probeTpmt.rsa, 'probe EK must be RSA');
    const ekIdentity = mintSimulatedEkCertificatePair({ kty: 'RSA', n: probeTpmt.rsa.modulus.toString('base64url'), e: 'AQAB' });

    // (3) C1 في bootstrap — رفضٌ قبلَ الإرسالِ: العدّادُ لا يتحرّكُ.
    const gate = new FreshnessGate({ transport: /** @type {any} */ (counting), mode: 'operation', persistentEkHandle: null, ekIdentity });
    let sent = counting.sent.length;
    await assert.rejects(gate.c1Confirm(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
    assert.equal(counting.sent.length, sent, 'C1 in bootstrap sends nothing');

    // تمهيدٌ كاملٌ فوقَ الغلافِ نفسِهِ.
    const t1 = await gate.t1Inventory();
    assert.deepEqual(t1.handles, [A], 'T1 inventories the test index');
    await gate.t6nvBufferMax();
    await gate.t2nvReadPublic({ nvIndex: A });
    await gate.t3nvRead({ nvIndex: A, size: NV_DATA_SIZE, offset: 0 });
    const t5 = await gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
    assert.equal(gate.verifyEkIdentity(), true, 'EK identity verified');
    const sas = await gate.startAuthSession();

    // (8) جلسةٌ ثانيةٌ — رفضٌ قبلَ الإرسالِ (مرةٌ واحدةٌ في الاتصالِ).
    sent = counting.sent.length;
    await assert.rejects(gate.startAuthSession(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.DUPLICATE_ATTEMPT);
    assert.equal(counting.sent.length, sent, 'second StartAuthSession sends nothing');

    // P0 → salted.
    const p0 = await gate.p0Attest();
    assert.deepEqual(p0.handles, [A], 'P0 page covers the test index');
    assert.equal(gate.state, 'salted', 'P0 promotes to salted');

    // (3) صفوفُ التمهيدِ في salted — رفضٌ قبلَ الإرسالِ.
    sent = counting.sent.length;
    await assert.rejects(gate.t6nvBufferMax(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
    await assert.rejects(gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
    await assert.rejects(gate.t2nvReadPublic({ nvIndex: A }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
    await assert.rejects(gate.t3nvRead({ nvIndex: A, size: NV_DATA_SIZE, offset: 0 }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
    assert.equal(counting.sent.length, sent, 'bootstrap rows in salted send nothing');

    // C1 → confirmed ثمّ الصفوفُ بعدَها مرفوضةٌ (لا إعادةَ للجردِ الموثّقِ).
    await gate.c1Confirm();
    assert.equal(gate.state, 'confirmed', 'C1 confirms');
    sent = counting.sent.length;
    await assert.rejects(gate.c1Confirm(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
    assert.equal(counting.sent.length, sent, 'C1 after confirmed sends nothing');

    // تفريغٌ نظيفٌ عبرَ البوّابةِ وحدَها.
    await gate.flushContext({ flushHandle: sas.handle });
    await gate.flushContext({ flushHandle: t5.handle });
    assert.equal(gate.closed, false, 'clean close, no gate failure');

    // (7) P0 مزدوجٌ: نداءانِ متوازيانِ — واحدٌ ينفَّذُ والثاني DUPLICATE_ATTEMPT قبلَ
    // الإرسالِ. بوّابةٌ ثانيةٌ فوقَ الغلافِ نفسِهِ (المحاكي مشتركٌ بينَ الاختباراتِ).
    const gate2 = new FreshnessGate({ transport: /** @type {any} */ (counting), mode: 'operation', persistentEkHandle: null, ekIdentity });
    await gate2.t1Inventory();
    await gate2.t6nvBufferMax();
    await gate2.t2nvReadPublic({ nvIndex: A });
    await gate2.t3nvRead({ nvIndex: A, size: NV_DATA_SIZE, offset: 0 });
    const t5b = await gate2.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
    gate2.verifyEkIdentity();
    const sasb = await gate2.startAuthSession();
    const before = counting.sent.length;
    const results = await Promise.allSettled([gate2.p0Attest(), gate2.p0Attest()]);
    const rejected = results.filter((r) => r.status === 'rejected');
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.equal(rejected.length, 1, 'exactly one P0 attempt rejected');
    assert.equal(fulfilled.length, 1, 'exactly one P0 attempt fulfilled');
    assert.equal(/** @type {{ reason: { code?: string } }} */ (rejected[0]).reason.code, GATE_ERRORS.DUPLICATE_ATTEMPT);
    assert.equal(gate2.state, 'salted', 'the winning P0 promotes to salted');
    // المرفوضُ لم يُرسِلْ شيئًا: ما زادَ في العدّادِ هو أمرُ الفائزِ وحدَه.
    assert.equal(counting.sent.length - before, 1, 'only the winning P0 attempt reached the simulator');
    await gate2.c1Confirm();
    await gate2.flushContext({ flushHandle: sasb.handle });
    await gate2.flushContext({ flushHandle: t5b.handle });
    assert.equal(gate2.closed, false, 'clean close');

    // تنطيفُ الفهرسِ.
    const undef = builder.buildNvUndefineSpace({ nvIndex: A, indexName: define.indexName, session: builder.passwordSession() });
    assert.equal((await submitRetry(t, undef)).rc, 0, 'NV_UndefineSpace(A) must succeed');
    defined.pop();
  } finally {
    try {
      for (const { nvIndex, indexName } of defined.splice(0)) {
        try {
          const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: builder.passwordSession() });
          await submitRetry(t, undef);
        } catch { /* already undefined — ignore */ }
      }
    } catch { /* transport dead — ignore */ }
    await t.close();
  }
});

simTest('G2 (4)/(7): رفضُ T2/T3 بفهرسٍ ليس في T1 أو خارجَ الستّةِ، وP0 قبلَ StartAuthSession — قبلَ الإرسالِ على swtpm حيّ (WL-465)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  const counting = new CountingTransport(t);
  /** @type {{ nvIndex: number, indexName: Buffer }[]} */
  const defined = [];
  /** @type {number[]} */
  const liveHandles = [];
  try {
    const NV_DATA_SIZE = 8;
    const A = 0x01c00002;
    const define = builder.buildNvDefineSpace({ nvIndex: A, dataSize: NV_DATA_SIZE, attributes: 0x00040004, session: builder.passwordSession() });
    assert.equal((await submitRetry(t, define)).form, 'n3', 'NV_DefineSpace(A) must succeed');
    defined.push({ nvIndex: A, indexName: define.indexName });
    const write = builder.buildNvWrite({ nvIndex: A, data: Buffer.alloc(NV_DATA_SIZE, 0x21), offset: 0, session: builder.passwordSession(), indexName: define.indexName });
    assert.equal((await submitRetry(t, write)).form, 'n3', 'NV_Write(A) must succeed');

    const probeBuilt = builder.buildCreatePrimary({ inPublic: builder.defaultEkTemplateRsa2048(), session: builder.passwordSession() });
    const probeParsed = parseResponse(await t.submit(probeBuilt.command), probeBuilt.descriptor);
    assert.equal(probeParsed.form, 'n3', 'probe CreatePrimary response must be n3');
    const probeOutPublic = firstTpm2b(probeParsed.parameters);
    const probeFlush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probeParsed.handles[0]) });
    assert.equal(parseResponse(await t.submit(probeFlush.command), probeFlush.descriptor).form, 'n1', 'probe flush must be n1');
    const probeTpmt = builder.parseTpmtPublic(probeOutPublic);
    assert(probeTpmt.rsa, 'probe EK must be RSA');
    const ekIdentity = mintSimulatedEkCertificatePair({ kty: 'RSA', n: probeTpmt.rsa.modulus.toString('base64url'), e: 'AQAB' });

    const gate = new FreshnessGate({ transport: /** @type {any} */ (counting), mode: 'operation', persistentEkHandle: null, ekIdentity });
    const t1 = await gate.t1Inventory();
    assert.deepEqual(t1.handles, [A], 'T1 inventories the test index');
    await gate.t6nvBufferMax();
    // قراءاتُ التمهيدِ للفهرسِ المُعرَّفِ نفسِهِ — بلاها لا تملكُ C1 جردَ تمهيدٍ تقارِنُ عليهِ
    // (بعدَ T6: ترتيبُ صفوفِ التمهيدِ T1→T6→T2→T3 ملزمٌ في البوّابةِ).
    await gate.t2nvReadPublic({ nvIndex: A });
    await gate.t3nvRead({ nvIndex: A, size: NV_DATA_SIZE, offset: 0 });

    // (4) T2/T3 بفهرسٍ في المدى وليسَ في T1 (0x01c00003)، وبفهرسٍ خارجَ الستّةِ (0x01800000)
    // — رفضٌ قبلَ الإرسالِ: العدّادُ لا يتحرّكُ.
    let sent = counting.sent.length;
    await assert.rejects(gate.t2nvReadPublic({ nvIndex: 0x01c00003 }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
    await assert.rejects(gate.t3nvRead({ nvIndex: 0x01c00003, size: 1, offset: 0 }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
    await assert.rejects(gate.t2nvReadPublic({ nvIndex: 0x01800000 }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
    await assert.rejects(gate.t3nvRead({ nvIndex: 0x01800000, size: 1, offset: 0 }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
    assert.equal(counting.sent.length, sent, 'T2/T3 rejections send nothing');

    // (7) P0 قبلَ StartAuthSession — رفضٌ قبلَ الإرسالِ (شرطاه: T1 مكتملٌ والجلسةُ قائمةٌ).
    const t5 = await gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
    liveHandles.push(t5.handle);
    assert.equal(gate.verifyEkIdentity(), true, 'EK identity verified');
    sent = counting.sent.length;
    await assert.rejects(gate.p0Attest(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
    assert.equal(counting.sent.length, sent, 'P0 before StartAuthSession sends nothing');

    // بعدَ الجلسةِ: P0 يمرُّ.
    const sas = await gate.startAuthSession();
    liveHandles.push(sas.handle);
    const p0 = await gate.p0Attest();
    assert.deepEqual(p0.handles, [A], 'P0 passes after StartAuthSession');
    assert.equal(gate.state, 'salted', 'P0 promotes to salted');
    await gate.c1Confirm();
    assert.equal(gate.state, 'confirmed', 'C1 confirms');
    await gate.flushContext({ flushHandle: sas.handle });
    await gate.flushContext({ flushHandle: t5.handle });
    assert.equal(gate.closed, false, 'clean close');

    const undef = builder.buildNvUndefineSpace({ nvIndex: A, indexName: define.indexName, session: builder.passwordSession() });
    assert.equal((await submitRetry(t, undef)).rc, 0, 'NV_UndefineSpace(A) must succeed');
    defined.pop();
  } finally {
    try {
      for (const h of liveHandles.splice(0)) {
        try { await t.submit(builder.buildFlushContext({ flushHandle: h }).command); } catch { /* already flushed — ignore */ }
      }
      for (const { nvIndex, indexName } of defined.splice(0)) {
        try {
          const undef = builder.buildNvUndefineSpace({ nvIndex, indexName, session: builder.passwordSession() });
          await submitRetry(t, undef);
        } catch { /* already undefined — ignore */ }
      }
    } catch { /* transport dead — ignore */ }
    await t.close();
  }
});

simTest('G2 (7): حقن أعطالٍ في النقلِ فوقَ swtpm حيّ — HMAC فاسدٌ وسمةُ 0x01 وردُّ خطأٍ مُصنَّعٌ لردِّ P0 ⇒ إغلاقٌ قبلَ salted (R5-01) (WL-465)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  try {
    // عصٌّ تجريبيٌّ واحدٌ للهويّةِ (الاشتقاقُ حتميٌّ فيكفي مرةً واحدةً للعيّناتِ الثلاثِ).
    const probeBuilt = builder.buildCreatePrimary({ inPublic: builder.defaultEkTemplateRsa2048(), session: builder.passwordSession() });
    const probeParsed = parseResponse(await t.submit(probeBuilt.command), probeBuilt.descriptor);
    assert.equal(probeParsed.form, 'n3', 'probe CreatePrimary response must be n3');
    const probeOutPublic = firstTpm2b(probeParsed.parameters);
    const probeFlush = builder.buildFlushContext({ flushHandle: /** @type {number} */ (probeParsed.handles[0]) });
    assert.equal(parseResponse(await t.submit(probeFlush.command), probeFlush.descriptor).form, 'n1', 'probe flush must be n1');
    const probeTpmt = builder.parseTpmtPublic(probeOutPublic);
    assert(probeTpmt.rsa, 'probe EK must be RSA');
    const ekIdentity = mintSimulatedEkCertificatePair({ kty: 'RSA', n: probeTpmt.rsa.modulus.toString('base64url'), e: 'AQAB' });

    for (const fault of /** @type {('corruptHmac' | 'flipAttrs' | 'errorResponse')[]} */ (['corruptHmac', 'flipAttrs', 'errorResponse'])) {
      const wrapper = new FaultInjectingTransport(t, fault);
      const gate = new FreshnessGate({ transport: /** @type {any} */ (wrapper), mode: 'operation', persistentEkHandle: null, ekIdentity });
      await gate.t1Inventory();
      await gate.t6nvBufferMax();
      const t5 = await gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
      gate.verifyEkIdentity();
      const sas = await gate.startAuthSession();

      // إثباتُ العبورِ: أوامرُ التمهيدِ كلُّها مرَّتْ عبرَ الغلافِ نفسِهِ كما هي — وإلّا
      // لما اكتملَ التمهيدُ أصلًا (الردودُ الحيّةُ من swtpm تحقَّقتْ منها البوّابةُ).
      assert.ok(wrapper.passedThrough.length > 0, 'non-targeted bootstrap commands passed through the wrapper untouched');
      assert.equal(wrapper.injected, 0, 'fault has not fired before P0');

      // الحقنةُ: P0 (أولُ GetCapability بجلسةٍ) يُعترَضُ ردُّهُ — مرةً واحدةً.
      /** @type {unknown} */
      let caught;
      await assert.rejects(gate.p0Attest(), (/** @type {{ code?: string }} */ e) => { caught = e; return e.code === GATE_ERRORS.IDENTITY_UNPROVEN; });
      assert.equal(wrapper.injected, 1, 'fault fired exactly once on the sessioned GetCapability (P0)');

      // الرفضُ للسببِ الصحيحِ في الطبقةِ الصحيحةِ (تحقُّقُ محلّلِ الردودِ):
      if (fault === 'corruptHmac') {
        assert.match(String(/** @type {Error} */ (caught).message), /TPM_RESPONSE_HMAC_MISMATCH/, 'HMAC corruption caught at response verification');
      } else if (fault === 'flipAttrs') {
        assert.match(String(/** @type {Error} */ (caught).message), /TPM_RESPONSE_ATTRS_INVALID/, 'attrs 0x01 caught at response verification');
      } else {
        assert.match(String(/** @type {Error} */ (caught).message), /rc=0x9a2/, 'fabricated error response rejected');
      }
      assert.equal(gate.state, 'bootstrap', 'R5-01: no salted without a verified P0 response');
      assert.equal(gate.closed, true, 'gate closed on the tampered P0 response');

      // تفريغٌ خامٌّ (البوّابةُ مغلقةٌ بالفشلِ لا تُفرِّغُ عبرَها): الجلسةُ وEK العابرُ.
      for (const h of [sas.handle, t5.handle]) {
        const flush = builder.buildFlushContext({ flushHandle: h });
        const flushed = parseResponse(await t.submit(flush.command), flush.descriptor);
        assert.equal(flushed.rc, 0, `FlushContext(0x${h.toString(16)}) must succeed`);
      }
    }
  } finally {
    await t.close();
  }
});
