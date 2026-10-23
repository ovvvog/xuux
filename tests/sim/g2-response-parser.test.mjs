// tests/sim/g2-response-parser.test.mjs
//
// WL-454 — G2-2: محلّلُ ردودِ TPM (`sim/tpm/response_parser.mjs`). وحدةٌ صرفٌ،
// فالاختباراتُ هنا تُشغَّلُ دائمًا بلا محاكٍ. **ولا يُعَدُّ نجاحُها إثباتًا لتكاملِ G2** (الحزمةُ G2-4).
//
// (1) متجهاتٌ ثابتةٌ منقولةٌ حرفيًّا من اختبارِ WL-452 (`tests/adr/0007-annex-e-gate-states.test.mjs`
//     على `aec7cfbdf342f92b578e4e561258a86e1c774558`، PR #409) — بلا تغييرٍ في المدخلاتِ ولا القيم.
// (2) HMAC الردِّ مبنيٌّ هنا **ببناءٍ مستقلٍّ** بـ`node:crypto` لا بدوالِّ الوحدة، ثمّ يُقلَبُ كلُّ بايتٍ
//     في المنطقةِ المحميّة: كلُّ قلبٍ رفض.
// (3) الأشكالُ الأربعةُ وقواعدُ الجلساتِ والإعادة.
// (4) طفراتٌ على نصِّ الوحدة: كلُّ طفرةٍ مسمّاةٍ يُسقِطُها صفٌّ على الأقلّ، والأصلُ يجتازُ كلَّ شيء.
//     ولا خطّافَ طفراتٍ في الوحدةِ نفسِها.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as real from '../../sim/tpm/response_parser.mjs';

const MODULE = fileURLToPath(
  new URL('../../sim/tpm/response_parser.mjs', import.meta.url),
);

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
const tpm2b = (/** @type {Buffer} */ b) => Buffer.concat([u16(b.length), b]);
/** @param {number} tag @param {number} rc @param {Buffer} body */
const frame = (tag, rc, body) => {
  const b = Buffer.concat([u16(tag), u32(0), u32(rc), body]);
  b.writeUInt32BE(b.length, 2);
  return b;
};

// ——— بناءٌ مستقلٌّ لردٍّ بجلساتٍ (لا يستعملُ دوالَّ الوحدة) ———

const CC_NV_READ = 0x14e;
const CC_NV_INCREMENT = 0x134;
const KEY = Buffer.alloc(32, 0x11);
const NC = Buffer.alloc(32, 0x22);
const NT = Buffer.alloc(32, 0x33);
const PARAMS = tpm2b(Buffer.from('0000000000000007', 'hex'));

/**
 * @param {{ cc?: number, params?: Buffer, key?: Buffer, authValue?: Buffer, nonceTPM?: Buffer, nonceCaller?: Buffer, attrs?: number, handles?: number[] }} [o]
 */
function signedResponse(o = {}) {
  const cc = o.cc ?? CC_NV_READ;
  const params = o.params ?? PARAMS;
  const nt = o.nonceTPM ?? NT;
  const nc = o.nonceCaller ?? NC;
  const attrs = o.attrs ?? 0x01;
  const rp = createHash('sha256')
    .update(Buffer.concat([u32(0), u32(cc), params]))
    .digest();
  const mac = createHmac('sha256', Buffer.concat([o.key ?? KEY, o.authValue ?? Buffer.alloc(0)]))
    .update(Buffer.concat([rp, nt, nc, Buffer.from([attrs])]))
    .digest();
  const handles = Buffer.concat((o.handles ?? []).map(u32));
  return frame(
    0x8002,
    0,
    Buffer.concat([
      handles,
      u32(params.length),
      params,
      tpm2b(nt),
      Buffer.from([attrs]),
      tpm2b(mac),
    ]),
  );
}

/** @param {Partial<import('../../sim/tpm/response_parser.mjs').CommandDescriptor> & { sessionAttrs?: number, authValue?: Buffer }} [o] */
function hmacCmd(o = {}) {
  return {
    commandCode: o.commandCode ?? CC_NV_READ,
    tag: 0x8002,
    sessions: o.sessions ?? [
      {
        kind: /** @type {const} */ ('hmac'),
        sessionKey: KEY,
        nonceCaller: NC,
        attrs: o.sessionAttrs ?? 0x01,
        ...(o.authValue ? { authValue: o.authValue } : {}),
      },
    ],
    responseHandleCount: o.responseHandleCount ?? 0,
    mutating: o.mutating ?? false,
    allowNoSessionsResponse: false,
  };
}

/** @param {boolean} mutating @param {boolean} [allowN1] */
const noSessCmd = (mutating, allowN1 = true) => ({
  commandCode: 0x17a,
  tag: 0x8001,
  sessions: [],
  responseHandleCount: 0,
  mutating,
  allowNoSessionsResponse: allowN1,
});

/** @param {typeof real} m @param {() => unknown} fn @param {string} code */
const rejectsCode = (m, fn, code) =>
  assert.throws(fn, (e) => e instanceof m.ResponseRejection && e.code === code, code);

// ——— (1) المتجهاتُ الثابتة ———

test('G2-2 متجهات WL-452 حرفيًّا: sessionKey = KDFa(salt, "ATH", nonceTPM, nonceCaller, 256)', () => {
  const salt = Buffer.alloc(32, 0x01);
  const nt = Buffer.alloc(32, 0x02);
  const nc = Buffer.alloc(32, 0x03);
  assert.equal(
    real.sessionKeyFor(salt, nt, nc).toString('hex'),
    'd61e4115d0e81cb1945ebb5d9b419bee7a4ee232e491f18649e90032a4af1aaa',
  );
  assert.equal(
    real
      .responseHmac(real.sessionKeyFor(salt, nt, nc), Buffer.alloc(32, 0x0a), nt, nc, 0x81)
      .toString('hex'),
    '3bed9c83f098b14732419c7f9fcfff4eaf0198f7a5512c961260c1fa2e78ace9',
  );
  // ترتيبُ السياقِ جزءٌ من التعريف.
  assert.notEqual(
    real.kdfa(salt, 'ATH', nc, nt, 256).toString('hex'),
    real.sessionKeyFor(salt, nt, nc).toString('hex'),
  );
  assert.throws(() => real.kdfa(salt, 'ATH', nt, nc, 0), RangeError);
});

// ——— (2) HMAC ببناءٍ مستقلٍّ وقلبُ كلِّ بايتٍ محميّ ———

test('G2-2 (ن2): ردٌّ موقَّعٌ ببناءٍ مستقلٍّ يُقبَل، وnonceTPM الجديدةُ تُعادُ بعدَ التحقّقِ وحدَه', () => {
  const r = real.parseResponse(signedResponse(), hmacCmd());
  assert.equal(r.form, 'n2');
  assert.ok(r.authenticated);
  assert.ok(r.form === 'n2' && r.sessions[0]?.nonceTPM.equals(NT));
  assert.ok(r.parameters.equals(PARAMS));
});

test('G2-2 (ن2): قلبُ أيِّ بتٍّ في رمزِ الردِّ أو المعاملاتِ أو nonceTPM أو السماتِ أو HMAC ⇒ رفض، ولا nonce', () => {
  const good = signedResponse();
  let flipped = 0;
  for (let i = 6; i < good.length; i++) {
    if (i >= 2 && i < 6) continue; // responseSize: يُفحَصُ بنفسِه أدناه
    for (const bit of [0x01, 0x80]) {
      const bad = Buffer.from(good);
      bad[i] = /** @type {number} */ (bad[i]) ^ bit;
      assert.throws(
        () => real.parseResponse(bad, hmacCmd()),
        (e) => e instanceof real.ResponseRejection,
        `البايت ${i} قُلِبَ بـ0x${bit.toString(16)} فقُبِل`,
      );
      flipped += 1;
    }
  }
  assert.ok(flipped > 100);
  const sized = Buffer.from(good);
  sized.writeUInt32BE(good.length + 1, 2);
  rejectsCode(
    real,
    () => real.parseResponse(sized, hmacCmd()),
    real.RESPONSE_REJECTIONS.SIZE_MISMATCH,
  );
});

test('G2-2 (ن2): مفتاحٌ خاطئ، أو nonceCaller آخرُ (إعادةُ ردٍّ قديمٍ لأمرٍ لاحق)، أو أمرٌ آخر ⇒ HMAC_MISMATCH', () => {
  const resp = signedResponse();
  const M = real.RESPONSE_REJECTIONS.HMAC_MISMATCH;
  rejectsCode(
    real,
    () =>
      real.parseResponse(resp, {
        ...hmacCmd(),
        sessions: [{ kind: 'hmac', sessionKey: Buffer.alloc(32, 0x12), nonceCaller: NC, attrs: 1 }],
      }),
    M,
  );
  rejectsCode(
    real,
    () =>
      real.parseResponse(resp, {
        ...hmacCmd(),
        sessions: [
          { kind: 'hmac', sessionKey: KEY, nonceCaller: Buffer.alloc(32, 0x23), attrs: 1 },
        ],
      }),
    M,
  );
  rejectsCode(real, () => real.parseResponse(resp, hmacCmd({ commandCode: CC_NV_INCREMENT })), M);
});

const LONG_AUTH = Buffer.alloc(40, 0xab);

test('G2-2 (ن2): authValue بأصفارٍ ذيليّةٍ يُقتطَع (Part 1 §19.6.5)، وauthValue غائبٌ لا يساوي حاضرًا', () => {
  // مفتاحٌ 32+40 > 64 بايتًا: يُجزَّأ في HMAC، فلا يُخفي الحشوُ بالأصفارِ أثرَ الاقتطاع.
  const resp = signedResponse({ authValue: LONG_AUTH });
  assert.equal(
    real.parseResponse(resp, hmacCmd({ authValue: Buffer.concat([LONG_AUTH, Buffer.alloc(2)]) }))
      .form,
    'n2',
  );
  rejectsCode(
    real,
    () => real.parseResponse(resp, hmacCmd()),
    real.RESPONSE_REJECTIONS.HMAC_MISMATCH,
  );
  // والمفتاحُ القصيرُ: الحشوُ في HMAC نفسِه يجعلُ الذيلَ بلا أثرٍ — موثَّقٌ لا مُفترَض.
  const short = signedResponse({ authValue: Buffer.from('abcd', 'hex') });
  assert.equal(
    real.parseResponse(short, hmacCmd({ authValue: Buffer.from('abcd0000', 'hex') })).form,
    'n2',
  );
  assert.equal(real.trimAuthValue(Buffer.from('00ab00', 'hex')).toString('hex'), '00ab');
});

test('G2-2 (ن2): nonceTPM ليس 32، وHMAC فارغ أو بطولٍ آخر، وبتر، وذيل ⇒ رموزٌ مسمّاة', () => {
  const R = real.RESPONSE_REJECTIONS;
  const p = Buffer.concat([u32(PARAMS.length), PARAMS]);
  const mk = (/** @type {Buffer} */ nt, /** @type {Buffer} */ mac, extra = Buffer.alloc(0)) =>
    frame(0x8002, 0, Buffer.concat([p, tpm2b(nt), Buffer.from([1]), tpm2b(mac), extra]));
  rejectsCode(
    real,
    () => real.parseResponse(mk(Buffer.alloc(20), Buffer.alloc(32)), hmacCmd()),
    R.NONCE_SIZE,
  );
  rejectsCode(real, () => real.parseResponse(mk(NT, Buffer.alloc(0)), hmacCmd()), R.HMAC_EMPTY);
  rejectsCode(
    real,
    () => real.parseResponse(mk(Buffer.alloc(0), Buffer.alloc(0)), hmacCmd()),
    R.NONCE_SIZE,
  );
  rejectsCode(real, () => real.parseResponse(mk(NT, Buffer.alloc(20)), hmacCmd()), R.HMAC_SIZE);
  const good = signedResponse();
  rejectsCode(
    real,
    () =>
      real.parseResponse(
        frame(0x8002, 0, Buffer.concat([good.subarray(10), Buffer.from([0])])),
        hmacCmd(),
      ),
    R.TRAILING_BYTES,
  );
  rejectsCode(
    real,
    () => real.parseResponse(frame(0x8002, 0, good.subarray(10, good.length - 1)), hmacCmd()),
    R.TRUNCATED,
  );
  rejectsCode(
    real,
    () => real.parseResponse(frame(0x8002, 0, Buffer.concat([u32(0xffff), PARAMS])), hmacCmd()),
    R.TRUNCATED,
  );
});

test('G2-2: سماتُ الردِّ بقواعدِ الردّ: تفويضٌ كما أُرسِل؛ وتدقيقٌ 0x81 ⇒ 0x81 أو 0x83 وحدَهما، وHMAC على البايتِ المستلَم', () => {
  const R = real.RESPONSE_REJECTIONS;
  assert.equal(
    real.parseResponse(signedResponse({ attrs: 0x83 }), hmacCmd({ sessionAttrs: 0x81 })).form,
    'n2',
  );
  assert.equal(
    real.parseResponse(signedResponse({ attrs: 0x81 }), hmacCmd({ sessionAttrs: 0x81 })).form,
    'n2',
  );
  for (const [sent, got] of /** @type {Array<[number, number]>} */ ([
    [0x01, 0x00],
    [0x01, 0x03],
    [0x00, 0x01],
    [0x81, 0x01],
    [0x81, 0x85],
    [0x81, 0xc1],
  ])) {
    rejectsCode(
      real,
      () => real.parseResponse(signedResponse({ attrs: got }), hmacCmd({ sessionAttrs: sent })),
      R.ATTRS_INVALID,
    );
  }
  assert.equal(real.responseAttrsLegal(0x01, 0x01), true);
  assert.equal(real.responseAttrsLegal(0x80, 0x82), true);
});

test('G2-2: جلستانِ بالترتيب — تبديلُ منطقتَي الردِّ ⇒ رفض', () => {
  const k2 = Buffer.alloc(32, 0x44);
  const nc2 = Buffer.alloc(32, 0x55);
  const rp = createHash('sha256')
    .update(Buffer.concat([u32(0), u32(CC_NV_READ), PARAMS]))
    .digest();
  const area = (/** @type {Buffer} */ k, /** @type {Buffer} */ nc, /** @type {Buffer} */ nt) =>
    Buffer.concat([
      tpm2b(nt),
      Buffer.from([1]),
      tpm2b(
        createHmac('sha256', k)
          .update(Buffer.concat([rp, nt, nc, Buffer.from([1])]))
          .digest(),
      ),
    ]);
  const a1 = area(KEY, NC, NT);
  const a2 = area(k2, nc2, Buffer.alloc(32, 0x66));
  const cmd = {
    ...hmacCmd(),
    sessions: [
      { kind: /** @type {const} */ ('hmac'), sessionKey: KEY, nonceCaller: NC, attrs: 1 },
      { kind: /** @type {const} */ ('hmac'), sessionKey: k2, nonceCaller: nc2, attrs: 1 },
    ],
  };
  const body = (/** @type {Buffer[]} */ areas) =>
    frame(0x8002, 0, Buffer.concat([u32(PARAMS.length), PARAMS, ...areas]));
  assert.equal(real.parseResponse(body([a1, a2]), cmd).form, 'n2');
  rejectsCode(
    real,
    () => real.parseResponse(body([a2, a1]), cmd),
    real.RESPONSE_REJECTIONS.HMAC_MISMATCH,
  );
});

// ——— (3) ن3 ون1 وخ ———

test('G2-2 (ن3): TPM_RS_PW لجلسةٍ أُرسِلَت كذلك وحدَها؛ وأيُّ nonce أو HMAC أو سماتٍ أخرى ⇒ رفض؛ وشكلُ ن3 لجلسةِ HMAC رفض', () => {
  const R = real.RESPONSE_REJECTIONS;
  const pwCmd = {
    ...hmacCmd({ mutating: true }),
    sessions: [{ kind: /** @type {const} */ ('password') }],
  };
  const pw = (/** @type {Buffer} */ nt, /** @type {number} */ attrs, /** @type {Buffer} */ mac) =>
    frame(0x8002, 0, Buffer.concat([u32(0), tpm2b(nt), Buffer.from([attrs]), tpm2b(mac)]));
  const ok = real.parseResponse(pw(Buffer.alloc(0), 1, Buffer.alloc(0)), pwCmd);
  assert.equal(ok.form, 'n3');
  rejectsCode(
    real,
    () => real.parseResponse(pw(Buffer.alloc(32), 1, Buffer.alloc(0)), pwCmd),
    R.PASSWORD_FORM_INVALID,
  );
  rejectsCode(
    real,
    () => real.parseResponse(pw(Buffer.alloc(0), 1, Buffer.alloc(32)), pwCmd),
    R.PASSWORD_FORM_INVALID,
  );
  rejectsCode(
    real,
    () => real.parseResponse(pw(Buffer.alloc(0), 0, Buffer.alloc(0)), pwCmd),
    R.PASSWORD_FORM_INVALID,
  );
  // ردُّ كلمةِ مرورٍ لجلسةٍ مملّحة: HMAC فارغٌ لا يُعَدُّ ن3.
  rejectsCode(
    real,
    () => real.parseResponse(pw(Buffer.alloc(0), 1, Buffer.alloc(0)), hmacCmd()),
    R.NONCE_SIZE,
  );
  rejectsCode(real, () => real.parseResponse(pw(NT, 1, Buffer.alloc(0)), hmacCmd()), R.HMAC_EMPTY);
});

test('G2-2 (ن1): يُقبَلُ شكلًا فقط وحيثُ يجيزُه الواصف؛ ووسمٌ مخالفٌ لوسمِ الأمرِ رفض', () => {
  const R = real.RESPONSE_REJECTIONS;
  const n1 = frame(0x8001, 0, Buffer.from('0102', 'hex'));
  const r = real.parseResponse(n1, noSessCmd(false));
  assert.equal(r.form, 'n1');
  assert.equal(r.authenticated, false);
  rejectsCode(real, () => real.parseResponse(n1, noSessCmd(false, false)), R.N1_NOT_PERMITTED);
  rejectsCode(real, () => real.parseResponse(n1, hmacCmd()), R.TAG_MISMATCH);
  rejectsCode(real, () => real.parseResponse(signedResponse(), noSessCmd(false)), R.TAG_MISMATCH);
  // StartAuthSession: مقبضٌ واحدٌ في منطقةِ المقابض.
  const sas = real.parseResponse(frame(0x8001, 0, Buffer.concat([u32(0x02000000), tpm2b(NT)])), {
    ...noSessCmd(false),
    commandCode: 0x176,
    responseHandleCount: 1,
  });
  assert.deepEqual(sas.form === 'n1' && sas.handles, [0x02000000]);
  rejectsCode(
    real,
    () =>
      real.parseResponse(frame(0x8001, 0, Buffer.from('0102', 'hex')), {
        ...noSessCmd(false),
        responseHandleCount: 1,
      }),
    R.TRUNCATED,
  );
});

test('G2-2 (خ): ردُّ الخطأِ عشرةُ بايتاتٍ بوسمِ 0x8001 بالضبط؛ وما خالفَ ذلك لا يُحلَّل؛ ولا nonce بعدَه', () => {
  const R = real.RESPONSE_REJECTIONS;
  const e = real.parseResponse(frame(0x8001, 0x9a2, Buffer.alloc(0)), hmacCmd());
  assert.equal(e.form, 'error');
  assert.equal(/** @type {any} */ (e).sessions, undefined);
  rejectsCode(
    real,
    () => real.parseResponse(frame(0x8001, 0x9a2, Buffer.from('00', 'hex')), hmacCmd()),
    R.ERROR_FORM_INVALID,
  );
  rejectsCode(
    real,
    () => real.parseResponse(frame(0x8002, 0x9a2, Buffer.alloc(0)), hmacCmd()),
    R.ERROR_FORM_INVALID,
  );
  rejectsCode(
    real,
    () => real.parseResponse(Buffer.from('8001000000', 'hex'), hmacCmd()),
    R.MALFORMED,
  );
  // شكلُ BAD_TAG القديم: خطأٌ نهائيّ.
  const legacy = real.parseResponse(frame(0x00c4, 0x01e, Buffer.alloc(0)), noSessCmd(false));
  assert.ok(legacy.form === 'error' && legacy.fatal && !legacy.retryable);
  rejectsCode(
    real,
    () => real.parseResponse(frame(0x00c4, 0x101, Buffer.alloc(0)), noSessCmd(false)),
    R.ERROR_FORM_INVALID,
  );
});

// ——— الإعادة ———

test('G2-2 الإعادة: القراءةُ وحدَها، لـ0x922 و0x908 وحدَهما، وثلاثُ محاولاتٍ على الأكثر؛ والمُغيِّرُ ⇒ reconcile لا إعادة', () => {
  const read = (/** @type {number} */ rc) =>
    real.parseResponse(frame(0x8001, rc, Buffer.alloc(0)), noSessCmd(false));
  const write = (/** @type {number} */ rc) =>
    real.parseResponse(frame(0x8001, rc, Buffer.alloc(0)), noSessCmd(true));
  for (const rc of [0x922, 0x908]) {
    assert.equal(real.retryDecision(read(rc), 1), 'retry');
    assert.equal(real.retryDecision(read(rc), 2), 'retry');
    assert.equal(real.retryDecision(read(rc), 3), 'stop');
    const w = write(rc);
    assert.ok(w.form === 'error' && !w.retryable && w.outcome === 'unknown');
    assert.equal(real.retryDecision(w, 1), 'reconcile');
  }
  for (const rc of [0x101, 0x9a2, 0x18b, 0x921, 0x923])
    assert.equal(real.retryDecision(read(rc), 1), 'stop');
  for (const rc of [0x80280400, 0x80280800, 0x80280001]) {
    const t = read(rc);
    assert.ok(t.form === 'error' && t.fatal && !t.retryable, `0x${rc.toString(16)}`);
    assert.equal(real.retryDecision(t, 1), 'stop');
  }
  assert.equal(real.retryDecision(real.parseResponse(signedResponse(), hmacCmd()), 1), 'stop');
});

test('G2-2: رفضُ ردِّ أمرٍ مُغيِّرٍ نتيجتُه unknown، ولقراءةٍ failed', () => {
  const bad = Buffer.from(signedResponse({ cc: CC_NV_INCREMENT }));
  bad[bad.length - 1] = /** @type {number} */ (bad[bad.length - 1]) ^ 1;
  assert.throws(
    () => real.parseResponse(bad, hmacCmd({ commandCode: CC_NV_INCREMENT, mutating: true })),
    (e) => e instanceof real.ResponseRejection && e.outcome === 'unknown',
  );
  const badRead = Buffer.from(signedResponse());
  badRead[badRead.length - 1] = /** @type {number} */ (badRead[badRead.length - 1]) ^ 1;
  assert.throws(
    () => real.parseResponse(badRead, hmacCmd()),
    (e) => e instanceof real.ResponseRejection && e.outcome === 'failed',
  );
});

test('G2-2: واصفٌ متناقضٌ يُرفَضُ قبلَ قراءةِ أيِّ بايت', () => {
  const D = real.RESPONSE_REJECTIONS.DESCRIPTOR_INVALID;
  rejectsCode(real, () => real.parseResponse(signedResponse(), { ...hmacCmd(), tag: 0x8001 }), D);
  rejectsCode(real, () => real.parseResponse(signedResponse(), { ...hmacCmd(), sessions: [] }), D);
  rejectsCode(real, () => real.parseResponse(signedResponse(), { ...hmacCmd(), tag: 0xc001 }), D);
  rejectsCode(
    real,
    () => real.parseResponse(signedResponse(), { ...hmacCmd(), responseHandleCount: -1 }),
    D,
  );
  rejectsCode(
    real,
    () =>
      real.parseResponse(signedResponse(), {
        ...hmacCmd(),
        sessions: [{ kind: 'hmac', sessionKey: KEY, nonceCaller: Buffer.alloc(0), attrs: 1 }],
      }),
    D,
  );
});

// ——— (4) الطفرات ———

/** @param {typeof real} m @returns {string[]} أسماءُ الصفوفِ الساقطة */
function corpusFailures(m) {
  /** @type {Array<[string, () => void]>} */
  const rows = [
    [
      'vector-key',
      () =>
        assert.equal(
          m
            .sessionKeyFor(Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3))
            .toString('hex'),
          'd61e4115d0e81cb1945ebb5d9b419bee7a4ee232e491f18649e90032a4af1aaa',
        ),
    ],
    [
      'independent-hmac',
      () => assert.equal(m.parseResponse(signedResponse(), hmacCmd()).form, 'n2'),
    ],
    [
      'hmac-flip',
      () => {
        const b = Buffer.from(signedResponse());
        b[b.length - 1] = /** @type {number} */ (b[b.length - 1]) ^ 1;
        assert.throws(() => m.parseResponse(b, hmacCmd()));
      },
    ],
    [
      'empty-hmac',
      () =>
        assert.throws(() =>
          m.parseResponse(
            frame(
              0x8002,
              0,
              Buffer.concat([
                u32(PARAMS.length),
                PARAMS,
                tpm2b(NT),
                Buffer.from([1]),
                tpm2b(Buffer.alloc(0)),
              ]),
            ),
            hmacCmd(),
          ),
        ),
    ],
    [
      'audit-0x83',
      () =>
        assert.equal(
          m.parseResponse(signedResponse({ attrs: 0x83 }), hmacCmd({ sessionAttrs: 0x81 })).form,
          'n2',
        ),
    ],
    [
      'attrs-auth-changed',
      () =>
        assert.throws(() =>
          m.parseResponse(signedResponse({ attrs: 0x00 }), hmacCmd({ sessionAttrs: 0x01 })),
        ),
    ],
    [
      'trailing',
      () =>
        assert.throws(() =>
          m.parseResponse(
            frame(0x8002, 0, Buffer.concat([signedResponse().subarray(10), Buffer.from([0])])),
            hmacCmd(),
          ),
        ),
    ],
    [
      'error-11-bytes',
      () =>
        assert.throws(() =>
          m.parseResponse(frame(0x8001, 0x101, Buffer.from('00', 'hex')), noSessCmd(false)),
        ),
    ],
    // ‖sessionKey‖authValue‖ > 64: وإلّا فحشوُ مفتاحِ HMAC بالأصفارِ يُخفي الاقتطاعَ (RFC 2104).
    [
      'owner-auth-trim',
      () =>
        assert.equal(
          m.parseResponse(
            signedResponse({ authValue: LONG_AUTH }),
            hmacCmd({ authValue: Buffer.concat([LONG_AUTH, Buffer.alloc(2)]) }),
          ).form,
          'n2',
        ),
    ],
    [
      'password-nonce',
      () =>
        assert.throws(() =>
          m.parseResponse(
            frame(
              0x8002,
              0,
              Buffer.concat([
                u32(0),
                tpm2b(Buffer.alloc(32)),
                Buffer.from([1]),
                tpm2b(Buffer.alloc(0)),
              ]),
            ),
            { ...hmacCmd(), sessions: [{ kind: 'password' }] },
          ),
        ),
    ],
    [
      'retry-mutating',
      () => {
        const w = m.parseResponse(frame(0x8001, 0x922, Buffer.alloc(0)), noSessCmd(true));
        assert.ok(w.form === 'error' && !w.retryable);
        assert.equal(m.retryDecision(w, 1), 'reconcile');
      },
    ],
    [
      'retry-cap',
      () =>
        assert.equal(
          m.retryDecision(
            m.parseResponse(frame(0x8001, 0x922, Buffer.alloc(0)), noSessCmd(false)),
            3,
          ),
          'stop',
        ),
    ],
    [
      'tbs-fatal',
      () => {
        const t = m.parseResponse(frame(0x8001, 0x80280400, Buffer.alloc(0)), noSessCmd(false));
        assert.ok(t.form === 'error' && t.fatal);
      },
    ],
    [
      'n1-not-permitted',
      () =>
        assert.throws(() =>
          m.parseResponse(frame(0x8001, 0, Buffer.alloc(0)), noSessCmd(false, false)),
        ),
    ],
    [
      'password-form',
      () =>
        assert.throws(() =>
          m.parseResponse(
            frame(
              0x8002,
              0,
              Buffer.concat([
                u32(0),
                tpm2b(Buffer.alloc(0)),
                Buffer.from([1]),
                tpm2b(Buffer.alloc(0)),
              ]),
            ),
            hmacCmd(),
          ),
        ),
    ],
  ];
  const failed = [];
  for (const [name, fn] of rows) {
    try {
      fn();
    } catch {
      failed.push(name);
    }
  }
  return failed;
}

/** @type {Array<[string, string, string]>} [الاسم، النصُّ الأصليُّ في الوحدة، البديل] */
const MUTANTS = [
  ['skip-hmac-compare', 'if (!timingSafeEqual(expected, area.hmac)) {', 'if (false) {'],
  [
    'empty-hmac-as-password',
    "if (sent.kind === 'password') {",
    "if (sent.kind === 'password' || area.hmac.length === 0) {",
  ],
  [
    'attrs-byte-equality',
    'if ((sent & ATTR_AUDIT) === 0) return received === sent;',
    'return received === sent;',
  ],
  ['ignore-trailing', 'if (r.remaining !== 0) {', 'if (false) {'],
  [
    'error-length-unchecked',
    'if (buf.length !== HEADER || (tag !== TPM_ST_NO_SESSIONS && !legacyBadTag)) {',
    'if (tag !== TPM_ST_NO_SESSIONS && !legacyBadTag) {',
  ],
  ['retry-mutating', 'const retryable = !cmd.mutating && !fatal &&', 'const retryable = !fatal &&'],
  ['reconcile-dropped', "if (parsed.outcome === 'unknown') return 'reconcile';", ''],
  ['retry-uncapped', 'return attemptsSoFar < MAX_READ_ATTEMPTS ?', 'return true ?'],
  ['tbs-not-fatal', 'const fatal = legacyBadTag || tbs;', 'const fatal = legacyBadTag && tbs;'],
  [
    'rphash-order',
    'Buffer.concat([u32(rc), u32(commandCode), parameters])',
    'Buffer.concat([u32(commandCode), u32(rc), parameters])',
  ],
  [
    'hmac-nonce-order',
    'Buffer.concat([rp, nonceTPM, nonceCaller, Buffer.from([attrs & 0xff])])',
    'Buffer.concat([rp, nonceCaller, nonceTPM, Buffer.from([attrs & 0xff])])',
  ],
  [
    'kdfa-context-order',
    "kdfa(salt, 'ATH', nonceTPM, nonceCaller, 256)",
    "kdfa(salt, 'ATH', nonceCaller, nonceTPM, 256)",
  ],
  ['no-authvalue-trim', 'while (end > 0 && authValue[end - 1] === 0)', 'while (false)'],
  ['n1-anywhere', 'if (!cmd.allowNoSessionsResponse) {', 'if (false) {'],
  [
    'password-form-unchecked',
    'if (area.nonceTPM.length !== 0 || area.hmac.length !== 0 || area.attrs !== 0x01) {',
    'if (false) {',
  ],
];

test('G2-2 (طفرات): الأصلُ يجتازُ الجدولَ كلَّه، وكلُّ طفرةٍ من 15 على نصِّ الوحدةِ يُسقِطُها صفٌّ على الأقلّ', async () => {
  assert.deepEqual(corpusFailures(real), []);
  const source = readFileSync(MODULE, 'utf8');
  const dir = mkdtempSync(path.join(tmpdir(), 'xuux-g2-2-mutants-'));
  try {
    const survivors = [];
    for (const [name, from, to] of MUTANTS) {
      const count = source.split(from).length - 1;
      assert.equal(
        count,
        1,
        `الطفرةُ ${name}: النصُّ الأصليُّ يجبُ أن يظهرَ مرّةً واحدةً بالضبطِ في الوحدة (ظهرَ ${count})`,
      );
      const file = path.join(dir, `${name}.mjs`);
      writeFileSync(file, source.replace(from, to));
      const mutant = await import(pathToFileURL(file).href);
      if (corpusFailures(mutant).length === 0) survivors.push(name);
    }
    assert.deepEqual(survivors, [], 'طفراتٌ لم يُسقِطْها أيُّ صفّ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
