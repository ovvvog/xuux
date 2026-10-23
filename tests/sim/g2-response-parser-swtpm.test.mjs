// tests/sim/g2-response-parser-swtpm.test.mjs
//
// WL-454 — G2-2: **تحقّقٌ متقاطعٌ للصيغة** بين محلّلِ الردود (`sim/tpm/response_parser.mjs`)
// وswtpm حقيقيٍّ على loopback عبرَ النقلِ الخامِ لـG2-1. ليس هذا تكاملَ G2-4: لا NV، ولا جلسةَ مملّحة،
// ولا أوامرَ مُغيِّرةٌ للحالةِ الدائمة. جلسةُ HMAC غيرُ مملّحةٍ وغيرُ مربوطة (sessionKey فارغ)، فيُقاسُ
// هنا rpHash وترتيبُ HMAC وسلسلةُ nonce وقاعدةُ سماتِ التدقيق وشكلُ ردِّ الخطأ على TPM مرجعيّ؛
// أمّا مسارُ KDFa المملّح فمغطًّى بالمتجهاتِ الثابتةِ وحدَها (`tests/sim/g2-response-parser.test.mjs`).
//
// مقيَّدٌ بـ`isSimEnabled()`، ويُشغَّلُ إلزاميًّا في خطوةِ CI `scripts/tpm-sim-ci.sh` (تسقطُ إن تُخطّي).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { SwtpmRawTransport } from '../../sim/tpm/raw_transport.mjs';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import { parseResponse, ResponseRejection, RESPONSE_REJECTIONS as R } from '../../sim/tpm/response_parser.mjs';

const sim = isSimEnabled();
/** @param {string} name @param {() => Promise<void>} fn */
const simTest = (name, fn) => test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);

const u16 = (/** @type {number} */ n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (/** @type {number} */ n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
/** @param {number} tag @param {number} cc @param {Buffer} body */
const command = (tag, cc, body) => {
  const b = Buffer.concat([u16(tag), u32(0), u32(cc), body]);
  b.writeUInt32BE(b.length, 2);
  return b;
};

const CC_START_AUTH_SESSION = 0x176;
const CC_GET_RANDOM = 0x17b;
const CC_FLUSH_CONTEXT = 0x165;
const TPM_RH_NULL = 0x40000007;

/** StartAuthSession(tpmKey=NULL, bind=NULL, HMAC, sym=NULL, SHA-256) ⇒ { handle, nonceTPM } عبرَ المحلّل (ن1). */
async function startUnsaltedHmacSession(/** @type {SwtpmRawTransport} */ t) {
  const nonceCaller = randomBytes(32);
  const body = Buffer.concat([u32(TPM_RH_NULL), u32(TPM_RH_NULL), u16(32), nonceCaller, u16(0), Buffer.from([0x00]), u16(0x0010), u16(0x000b)]);
  const r = parseResponse(await t.submit(command(0x8001, CC_START_AUTH_SESSION, body)), {
    commandCode: CC_START_AUTH_SESSION,
    tag: 0x8001,
    sessions: [],
    responseHandleCount: 1,
    mutating: false,
    allowNoSessionsResponse: true,
  });
  assert.equal(r.form, 'n1');
  assert.ok(r.form === 'n1');
  assert.equal(r.handles.length, 1);
  assert.equal(r.parameters.readUInt16BE(0), 32);
  assert.equal(r.parameters.length, 34);
  return { handle: /** @type {number} */ (r.handles[0]), nonceTPM: Buffer.from(r.parameters.subarray(2, 34)) };
}

/** GetRandom(8) بجلسةِ تدقيقٍ 0x81 وHMAC أمرٍ بمفتاحٍ فارغ. يعيدُ البايتاتِ الخامَ وnonceCaller. */
async function auditedGetRandom(/** @type {SwtpmRawTransport} */ t, /** @type {number} */ handle, /** @type {Buffer} */ nonceTPM) {
  const nonceCaller = randomBytes(32);
  const params = u16(8);
  const attrs = 0x81;
  const cp = createHash('sha256').update(Buffer.concat([u32(CC_GET_RANDOM), params])).digest();
  const mac = createHmac('sha256', Buffer.alloc(0)).update(Buffer.concat([cp, nonceCaller, nonceTPM, Buffer.from([attrs])])).digest();
  const auth = Buffer.concat([u32(handle), u16(32), nonceCaller, Buffer.from([attrs]), u16(32), mac]);
  const raw = await t.submit(command(0x8002, CC_GET_RANDOM, Buffer.concat([u32(auth.length), auth, params])));
  return { raw, nonceCaller, attrs };
}

/** @param {Buffer} nonceCaller @param {number} attrs */
const getRandomDescriptor = (nonceCaller, attrs) => ({
  commandCode: CC_GET_RANDOM,
  tag: 0x8002,
  sessions: [{ kind: /** @type {const} */ ('hmac'), sessionKey: Buffer.alloc(0), nonceCaller, attrs }],
  responseHandleCount: 0,
  mutating: false,
  allowNoSessionsResponse: false,
});

async function flush(/** @type {SwtpmRawTransport} */ t, /** @type {number} */ handle) {
  const fl = await t.submit(command(0x8001, CC_FLUSH_CONTEXT, u32(handle)));
  assert.equal(fl.toString('hex'), '80010000000a00000000');
}

simTest('G2-2 × swtpm: HMAC الردِّ وسلسلةُ nonceTPM عبرَ ثلاثةِ أوامرَ تُقبَلُ بالصيغة؛ وسماتُ التدقيقِ 0x81 ⇒ 0x83', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  try {
    const s = await startUnsaltedHmacSession(t);
    /** @type {Buffer} */
    let nonceTPM = s.nonceTPM;
    /** @type {number[]} */
    const seenAttrs = [];
    for (let i = 0; i < 3; i++) {
      const { raw, nonceCaller, attrs } = await auditedGetRandom(t, s.handle, nonceTPM);
      const p = parseResponse(raw, getRandomDescriptor(nonceCaller, attrs));
      assert.equal(p.form, 'n2');
      assert.ok(p.form === 'n2');
      assert.equal(p.parameters.readUInt16BE(0), 8);
      const next = /** @type {NonNullable<(typeof p.sessions)[0]>} */ (p.sessions[0]);
      assert.notDeepEqual(next.nonceTPM, nonceTPM, 'nonceTPM لم يتجدّد');
      seenAttrs.push(next.attrs);
      nonceTPM = next.nonceTPM;
    }
    // مقيسٌ على swtpm 0.10.1: يُعيدُ continueSession|audit|auditExclusive (0x83) في كلِّ مرّة.
    assert.deepEqual(seenAttrs, [0x83, 0x83, 0x83]);
    await flush(t, s.handle);
  } finally {
    t.close();
  }
});

simTest('G2-2 × swtpm: ردٌّ حقيقيٌّ يُقلَبُ فيه بتٌّ واحدٌ ⇒ HMAC_MISMATCH؛ وnonceCaller آخرُ ⇒ HMAC_MISMATCH', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  try {
    const s = await startUnsaltedHmacSession(t);
    const { raw, nonceCaller, attrs } = await auditedGetRandom(t, s.handle, s.nonceTPM);
    // بايتُ عشوائيّةٍ في المعاملات (بعدَ الرأس 10 + parameterSize 4 + طول 2).
    const tampered = Buffer.from(raw);
    tampered[16] = /** @type {number} */ (tampered[16]) ^ 0x01;
    assert.throws(() => parseResponse(tampered, getRandomDescriptor(nonceCaller, attrs)), (e) => e instanceof ResponseRejection && e.code === R.HMAC_MISMATCH);
    assert.throws(() => parseResponse(raw, getRandomDescriptor(randomBytes(32), attrs)), (e) => e instanceof ResponseRejection && e.code === R.HMAC_MISMATCH);
    assert.equal(parseResponse(raw, getRandomDescriptor(nonceCaller, attrs)).form, 'n2');
    await flush(t, s.handle);
  } finally {
    t.close();
  }
});

simTest('G2-2 × swtpm: nonceTPM قديمٌ ⇒ ردُّ خطأٍ بعشرةِ بايتاتٍ (rc 0x9a2) لا يُعيدُه المحلّلُ ولا يحملُ nonce', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  try {
    const s = await startUnsaltedHmacSession(t);
    const { raw, nonceCaller, attrs } = await auditedGetRandom(t, s.handle, Buffer.alloc(32, 0x09));
    assert.equal(raw.length, 10);
    const p = parseResponse(raw, getRandomDescriptor(nonceCaller, attrs));
    assert.equal(p.form, 'error');
    assert.ok(p.form === 'error');
    assert.equal(p.rc, 0x9a2);
    assert.equal(p.retryable, false);
    await flush(t, s.handle);
  } finally {
    t.close();
  }
});
