// sim/tpm/response_parser.mjs
//
// محلّلُ ردودِ TPM 2.0 (الطبقةُ L-B في الملحقِ هـ لـADR 0007) — WL-454، الحزمةُ G2-2.
//
// **الموضع:** تحتَ `sim/tpm/` لا `src/root-of-trust/`: المجلّدُ الثاني نطاقٌ محميٌّ بقرارِ المالكِ
// في WL-429 (حارسُ نطاقِ الإقلاعِ الإنتاجيّ)، ونقلُ الوحدةِ إليه — أو وصلُها بأيِّ مسارٍ إنتاجيّ —
// قرارٌ للمالكِ لا لهذه الحزمة. وهي صرفٌ لا تستوردُ شيئًا من المحاكي، فنقلُها لاحقًا نقلُ ملفٍّ لا إعادةُ كتابة.
//
// **ما هو:** وحدةٌ صرفٌ بلا إدخالٍ وإخراج: بايتاتُ ردٍّ + واصفُ الأمرِ المُرسَل ⇒ ردٌّ مُصنَّفٌ بشكلٍ
// واحدٍ من أربعة (§4.4 من التنقيحِ السادس على `aec7cfbd`، PR #409)، أو رفضٌ مسمّى لا يُستعمَلُ معه
// بايتٌ من الرد:
//
//   (خ)  ردُّ خطأ: عشرةُ بايتاتٍ بالضبط، والوسمُ 0x8001، و`responseSize` = 10، بلا ذيل.
//   (ن1) نجاحٌ بلا جلسات: الأمرُ بلا جلسات، والواصفُ يجيزُ ن1 — ويُقبَلُ **شكلًا فقط**.
//   (ن2) نجاحٌ بجلسةٍ: nonceTPM بطولِ الخلاصة، وHMAC غيرُ فارغٍ يطابقُ:
//        rpHash = SHA-256(responseCode ‖ commandCode ‖ responseParameters)
//        HMAC   = HMAC-SHA-256(sessionKey ‖ authValue, rpHash ‖ nonceTPM ‖ nonceCaller ‖ attrs)
//   (ن3) `TPM_RS_PW`: nonce وHMAC فارغان، والسماتُ 0x01 — لجلسةٍ أُرسِلَت كذلك وحدَها.
//
// **ما ليسَه:** ليس البوّابةَ (L-C، الحزمةُ G2-3): لا يعرفُ حالاتِ `bootstrap`/`salted`/`confirmed`،
// ولا الصفوفَ T1–T6، ولا أيَّ أمرٍ مسموحٌ متى؛ ذلك كلُّه يأتيه في الواصف. وليس ناقلًا: لا يُرسِلُ
// شيئًا ولا يُعيدُ إرسالَ شيء. **ولا يُحدِّثُ أيَّ nonce:** يُعيدُ `nonceTPM` الجديدةَ بعدَ التحقّقِ
// وحدَه، والمستدعي يحفظُها؛ وعندَ الرفضِ أو ردِّ الخطأِ لا nonce تُعاد.
//
// **قواعدُ الإعادة (§4.4):** القراءةُ وحدَها تُعادُ، لرمزَي `TPM_RC_RETRY` (0x922) و`TPM_RC_YIELDED`
// (0x908) فقط، بثلاثِ محاولاتٍ على الأكثر. وعائلةُ TBS (`(rc & 0xFFFF0000) == 0x80280000`) والشكلُ
// القديمُ لـ`TPM_RC_BAD_TAG` توقّفٌ مغلق. **وكلُّ ردٍّ لأمرٍ مُغيِّرٍ ليس نجاحًا متحقَّقًا (ن2/ن3)
// نتيجةٌ مجهولةٌ لا تُعادُ بايتاتُها** — يتولّاها منسّقُ الالتزامِ بالقراءةِ ثمّ الحكمِ على الحالة.
//
// **ما لا يثبتُه نجاحُ اختباراتِ هذه الوحدة:** تكاملَ G2 (البوّابةُ عبرَ هذا المحلّلِ عبرَ النقلِ على
// محاكٍ — الحزمةُ G2-4)، ولا سلوكَ أيِّ TPM عتاديّ.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const TPM_ST_NO_SESSIONS = 0x8001;
export const TPM_ST_SESSIONS = 0x8002;
export const TPM_ST_RSP_COMMAND = 0x00c4;
export const TPM_RC_SUCCESS = 0x000;
export const TPM_RC_BAD_TAG = 0x01e;
export const TPM_RC_RETRY = 0x922;
export const TPM_RC_YIELDED = 0x908;
export const TBS_RC_MASK = 0xffff0000;
export const TBS_RC_FAMILY = 0x80280000;
export const SHA256_DIGEST_SIZE = 32;
export const MAX_READ_ATTEMPTS = 3;

const HEADER = 10;

/** سماتُ الجلسة: continueSession = 0x01، auditExclusive = 0x02، audit = 0x80. */
const ATTR_AUDIT_EXCLUSIVE = 0x02;
const ATTR_AUDIT = 0x80;

/** @typedef {'failed' | 'unknown'} ResponseOutcome */

export const RESPONSE_REJECTIONS = Object.freeze({
  MALFORMED: 'TPM_RESPONSE_MALFORMED',
  SIZE_MISMATCH: 'TPM_RESPONSE_SIZE_MISMATCH',
  ERROR_FORM_INVALID: 'TPM_RESPONSE_ERROR_FORM_INVALID',
  TAG_MISMATCH: 'TPM_RESPONSE_TAG_MISMATCH',
  N1_NOT_PERMITTED: 'TPM_RESPONSE_N1_NOT_PERMITTED',
  TRUNCATED: 'TPM_RESPONSE_TRUNCATED',
  TRAILING_BYTES: 'TPM_RESPONSE_TRAILING_BYTES',
  NONCE_SIZE: 'TPM_RESPONSE_NONCE_SIZE',
  HMAC_EMPTY: 'TPM_RESPONSE_HMAC_EMPTY',
  HMAC_SIZE: 'TPM_RESPONSE_HMAC_SIZE',
  HMAC_MISMATCH: 'TPM_RESPONSE_HMAC_MISMATCH',
  ATTRS_INVALID: 'TPM_RESPONSE_ATTRS_INVALID',
  PASSWORD_FORM_INVALID: 'TPM_RESPONSE_PASSWORD_FORM_INVALID',
  DESCRIPTOR_INVALID: 'TPM_RESPONSE_DESCRIPTOR_INVALID',
});

export class ResponseRejection extends Error {
  /**
   * @param {string} code
   * @param {ResponseOutcome} outcome `unknown` لأمرٍ مُغيِّر (لا يُعادُ إرسالُه)، و`failed` لقراءة.
   * @param {string} detail
   */
  constructor(code, outcome, detail) {
    super(`${code}: ${detail}`);
    this.name = 'ResponseRejection';
    /** @readonly */
    this.code = code;
    /** @readonly */
    this.outcome = outcome;
  }
}

/**
 * جلسةٌ أُرسِلَت في الأمر، بالترتيبِ نفسِه. لجلسةِ HMAC: `sessionKey` المفتاحُ المشتقّ (`sessionKeyFor`)،
 * فارغٌ لجلسةٍ غيرِ مملّحةٍ وغيرِ مربوطة؛ و`authValue` قيمةُ تفويضِ الكيانِ إن كانت الجلسةُ تفوّضُه؛
 * و`attrs` السماتُ المرسَلة: 0x00 أو 0x01 (تفويض)، أو 0x80 أو 0x81 (تدقيق).
 * @typedef {{ readonly kind: 'password' }
 *   | { readonly kind: 'hmac', readonly sessionKey: Uint8Array, readonly authValue?: Uint8Array,
 *       readonly nonceCaller: Uint8Array, readonly attrs: number }} SentSession
 */

/**
 * واصفُ الأمرِ كما أُرسِل — يملؤه المستدعي (البوّابةُ) لا المحلّل. `tag` الوسمُ المرسَل (0x8001/0x8002)؛
 * و`responseHandleCount` عددُ المقابضِ في منطقةِ مقابضِ الرد (مثلًا 1 لـ`StartAuthSession`)؛ و`mutating`
 * ⇒ كلُّ ما ليس نجاحًا متحقَّقًا نتيجةٌ مجهولة؛ و`allowNoSessionsResponse`: صفُّ الواصفِ في §4.3 يجيزُ ن1.
 * @typedef {{ readonly commandCode: number, readonly tag: number, readonly sessions: readonly SentSession[],
 *   readonly responseHandleCount: number, readonly mutating: boolean,
 *   readonly allowNoSessionsResponse: boolean }} CommandDescriptor
 */

/**
 * `nonceTPM` الجديدةُ — يحفظُها المستدعي **بعدَ** هذا التحقّقِ وحدَه؛ فارغةٌ لـن3.
 * @typedef {{ readonly nonceTPM: Buffer, readonly attrs: number }} VerifiedSession
 */

/**
 * `retryable`: أمرٌ قرائيٌّ ورمزٌ في قائمةِ الإعادة. `fatal`: عائلةُ TBS أو الشكلُ القديمُ لـBAD_TAG.
 * ون1 شكلٌ فقط: لا مصادقة.
 * @typedef {{ readonly form: 'error', readonly rc: number, readonly retryable: boolean,
 *     readonly fatal: boolean, readonly outcome: ResponseOutcome }
 *   | { readonly form: 'n1', readonly rc: 0, readonly handles: readonly number[],
 *     readonly parameters: Buffer, readonly authenticated: false }
 *   | { readonly form: 'n2' | 'n3', readonly rc: 0, readonly handles: readonly number[],
 *     readonly parameters: Buffer, readonly sessions: readonly VerifiedSession[],
 *     readonly authenticated: true }} ParsedResponse
 */

/** @param {number} n */
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

/**
 * KDFa بحسبِ SP 800-108 (عدّاد، HMAC-SHA-256) كما في Part 1 §11.4.10.2.
 * @param {Uint8Array} key @param {string} label @param {Uint8Array} contextU
 * @param {Uint8Array} contextV @param {number} bits @returns {Buffer}
 */
export function kdfa(key, label, contextU, contextV, bits) {
  if (!Number.isInteger(bits) || bits <= 0 || bits % 8 !== 0) {
    throw new RangeError(`kdfa: bits must be a positive multiple of 8: ${bits}`);
  }
  /** @type {Buffer[]} */
  const out = [];
  for (let i = 1; out.length * SHA256_DIGEST_SIZE * 8 < bits; i++) {
    out.push(
      createHmac('sha256', key)
        .update(Buffer.concat([u32(i), Buffer.from(label, 'ascii'), Buffer.from([0]), contextU, contextV, u32(bits)]))
        .digest(),
    );
  }
  return Buffer.concat(out).subarray(0, bits / 8);
}

/**
 * جلسةٌ مملّحةٌ غيرُ مربوطة: sessionKey = KDFa(salt, "ATH", nonceTPM, nonceCaller, 256).
 * @param {Uint8Array} salt @param {Uint8Array} nonceTPM @param {Uint8Array} nonceCaller @returns {Buffer}
 */
export const sessionKeyFor = (salt, nonceTPM, nonceCaller) => kdfa(salt, 'ATH', nonceTPM, nonceCaller, 256);

/**
 * rpHash = SHA-256(responseCode ‖ commandCode ‖ responseParameters).
 * @param {number} rc @param {number} commandCode @param {Uint8Array} parameters @returns {Buffer}
 */
export const rpHash = (rc, commandCode, parameters) =>
  createHash('sha256')
    .update(Buffer.concat([u32(rc), u32(commandCode), parameters]))
    .digest();

/**
 * حذفُ الأصفارِ الذيليّةِ من authValue قبلَ دخولِها مفتاحَ HMAC (Part 1 §19.6.5).
 * @param {Uint8Array} authValue @returns {Buffer}
 */
export function trimAuthValue(authValue) {
  let end = authValue.length;
  while (end > 0 && authValue[end - 1] === 0) end -= 1;
  return Buffer.from(authValue.subarray(0, end));
}

/**
 * HMAC-SHA-256(sessionKey ‖ authValue, rp ‖ nonceTPM ‖ nonceCaller ‖ attrs).
 * @param {Uint8Array} sessionKey @param {Uint8Array} rp @param {Uint8Array} nonceTPM
 * @param {Uint8Array} nonceCaller @param {number} attrs @param {Uint8Array} [authValue]
 * @returns {Buffer}
 */
export function responseHmac(sessionKey, rp, nonceTPM, nonceCaller, attrs, authValue = Buffer.alloc(0)) {
  return createHmac('sha256', Buffer.concat([sessionKey, trimAuthValue(authValue)]))
    .update(Buffer.concat([rp, nonceTPM, nonceCaller, Buffer.from([attrs & 0xff])]))
    .digest();
}

/**
 * قانونيّةُ سماتِ الرد بقواعدِ الردِّ لا بالمساواةِ البايتيّة (§4.4، WL437-gpt_6_1_sol-R2-01).
 * @param {number} sent @param {number} received @returns {boolean}
 */
export function responseAttrsLegal(sent, received) {
  if ((sent & ATTR_AUDIT) === 0) return received === sent;
  // جلسةُ تدقيق: يضيفُ الـTPM auditExclusive أو يُبقيه أو يُسقِطُه بحسبِ نموذجِ التدقيق؛ ولا شيءَ غيرُه.
  return (received & ~ATTR_AUDIT_EXCLUSIVE) === (sent & ~ATTR_AUDIT_EXCLUSIVE);
}

/**
 * قرارُ الإعادة: القراءةُ وحدَها، للرمزَين وحدَهما، وثلاثُ محاولاتٍ على الأكثر.
 * @param {ParsedResponse} parsed @param {number} attemptsSoFar @returns {'retry' | 'stop' | 'reconcile'}
 */
export function retryDecision(parsed, attemptsSoFar) {
  if (parsed.form !== 'error') return 'stop';
  if (parsed.outcome === 'unknown') return 'reconcile';
  if (parsed.fatal || !parsed.retryable) return 'stop';
  return attemptsSoFar < MAX_READ_ATTEMPTS ? 'retry' : 'stop';
}

class Reader {
  /**
   * @param {Buffer} buf @param {number} start
   * @param {(code: string, detail: string) => never} reject
   */
  constructor(buf, start, reject) {
    /** @private @readonly */
    this.buf = buf;
    /** @private */
    this.offset = start;
    /** @private @readonly */
    this.reject = reject;
  }
  get remaining() {
    return this.buf.length - this.offset;
  }
  /** @param {number} n @param {string} what @returns {Buffer} */
  take(n, what) {
    if (n < 0 || this.offset + n > this.buf.length) {
      this.reject(RESPONSE_REJECTIONS.TRUNCATED, `${what}: need ${n}, have ${this.remaining}`);
    }
    const out = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  /** @param {string} what */
  u8(what) {
    return this.take(1, what).readUInt8(0);
  }
  /** @param {string} what */
  u16(what) {
    return this.take(2, what).readUInt16BE(0);
  }
  /** @param {string} what */
  u32(what) {
    return this.take(4, what).readUInt32BE(0);
  }
  /** @param {string} what */
  tpm2b(what) {
    return this.take(this.u16(`${what}.size`), what);
  }
}

/** @param {CommandDescriptor} cmd @param {ResponseOutcome} outcome */
function checkDescriptor(cmd, outcome) {
  /** @param {string} detail @returns {never} */
  const bad = (detail) => {
    throw new ResponseRejection(RESPONSE_REJECTIONS.DESCRIPTOR_INVALID, outcome, detail);
  };
  if (cmd.tag !== TPM_ST_NO_SESSIONS && cmd.tag !== TPM_ST_SESSIONS) bad(`tag ${cmd.tag}`);
  if ((cmd.tag === TPM_ST_SESSIONS) !== cmd.sessions.length > 0) bad('tag/sessions disagree');
  if (!Number.isInteger(cmd.responseHandleCount) || cmd.responseHandleCount < 0) {
    bad(`responseHandleCount ${cmd.responseHandleCount}`);
  }
  for (const s of cmd.sessions) {
    if (s.kind === 'hmac' && s.nonceCaller.length === 0) bad('hmac session without nonceCaller');
  }
}

/**
 * يحلّلُ ردًّا كاملًا (إطارًا من النقل) بحسبِ واصفِ أمرِه. يرمي `ResponseRejection` لكلِّ خلل.
 * @param {Uint8Array} bytes @param {CommandDescriptor} cmd @returns {ParsedResponse}
 */
export function parseResponse(bytes, cmd) {
  /** @type {ResponseOutcome} */
  const outcome = cmd.mutating ? 'unknown' : 'failed';
  checkDescriptor(cmd, outcome);
  const buf = Buffer.from(bytes);
  /** @param {string} code @param {string} detail @returns {never} */
  const reject = (code, detail) => {
    throw new ResponseRejection(code, outcome, detail);
  };
  if (buf.length < HEADER) reject(RESPONSE_REJECTIONS.MALFORMED, `length ${buf.length} < 10`);
  const tag = buf.readUInt16BE(0);
  const size = buf.readUInt32BE(2);
  const rc = buf.readUInt32BE(6);
  if (size !== buf.length) {
    reject(RESPONSE_REJECTIONS.SIZE_MISMATCH, `responseSize ${size} != length ${buf.length}`);
  }

  // (خ) — الرمزُ أوّلًا.
  if (rc !== TPM_RC_SUCCESS) {
    const legacyBadTag = tag === TPM_ST_RSP_COMMAND && rc === TPM_RC_BAD_TAG;
    if (buf.length !== HEADER || (tag !== TPM_ST_NO_SESSIONS && !legacyBadTag)) {
      reject(
        RESPONSE_REJECTIONS.ERROR_FORM_INVALID,
        `error response must be 10 bytes tagged 0x8001 (tag 0x${tag.toString(16)}, length ${buf.length})`,
      );
    }
    const tbs = (rc & TBS_RC_MASK) >>> 0 === TBS_RC_FAMILY;
    const fatal = legacyBadTag || tbs;
    const retryable = !cmd.mutating && !fatal && (rc === TPM_RC_RETRY || rc === TPM_RC_YIELDED);
    return { form: 'error', rc, retryable, fatal, outcome };
  }

  if (tag !== cmd.tag) {
    reject(RESPONSE_REJECTIONS.TAG_MISMATCH, `response tag 0x${tag.toString(16)} != command tag`);
  }
  const r = new Reader(buf, HEADER, reject);
  /** @type {number[]} */
  const handles = [];
  for (let i = 0; i < cmd.responseHandleCount; i++) handles.push(r.u32(`handle[${i}]`));

  // (ن1)
  if (tag === TPM_ST_NO_SESSIONS) {
    if (!cmd.allowNoSessionsResponse) {
      reject(RESPONSE_REJECTIONS.N1_NOT_PERMITTED, `command 0x${cmd.commandCode.toString(16)}`);
    }
    const parameters = Buffer.from(r.take(r.remaining, 'parameters'));
    return { form: 'n1', rc: 0, handles, parameters, authenticated: false };
  }

  // (ن2)/(ن3): parameterSize ثمّ المعاملات ثمّ منطقةُ تفويضٍ لكلِّ جلسةٍ بالترتيب.
  const parameterSize = r.u32('parameterSize');
  const parameters = Buffer.from(r.take(parameterSize, 'parameters'));
  /** @type {{ nonceTPM: Buffer, attrs: number, hmac: Buffer }[]} */
  const areas = [];
  for (let i = 0; i < cmd.sessions.length; i++) {
    const nonceTPM = Buffer.from(r.tpm2b(`auth[${i}].nonceTPM`));
    const attrs = r.u8(`auth[${i}].attrs`);
    const hmac = Buffer.from(r.tpm2b(`auth[${i}].hmac`));
    areas.push({ nonceTPM, attrs, hmac });
  }
  if (r.remaining !== 0) {
    reject(RESPONSE_REJECTIONS.TRAILING_BYTES, `${r.remaining} bytes after the last auth area`);
  }

  const rp = rpHash(TPM_RC_SUCCESS, cmd.commandCode, parameters);
  /** @type {VerifiedSession[]} */
  const verified = [];
  let sawHmacSession = false;
  cmd.sessions.forEach((sent, i) => {
    const area = /** @type {{ nonceTPM: Buffer, attrs: number, hmac: Buffer }} */ (areas[i]);
    if (sent.kind === 'password') {
      if (area.nonceTPM.length !== 0 || area.hmac.length !== 0 || area.attrs !== 0x01) {
        reject(RESPONSE_REJECTIONS.PASSWORD_FORM_INVALID, `auth[${i}]`);
      }
      verified.push({ nonceTPM: Buffer.alloc(0), attrs: area.attrs });
      return;
    }
    sawHmacSession = true;
    if (area.nonceTPM.length !== SHA256_DIGEST_SIZE) {
      reject(RESPONSE_REJECTIONS.NONCE_SIZE, `auth[${i}].nonceTPM ${area.nonceTPM.length}`);
    }
    if (area.hmac.length === 0) reject(RESPONSE_REJECTIONS.HMAC_EMPTY, `auth[${i}]`);
    if (area.hmac.length !== SHA256_DIGEST_SIZE) {
      reject(RESPONSE_REJECTIONS.HMAC_SIZE, `auth[${i}].hmac ${area.hmac.length}`);
    }
    if (!responseAttrsLegal(sent.attrs, area.attrs)) {
      reject(
        RESPONSE_REJECTIONS.ATTRS_INVALID,
        `auth[${i}] sent 0x${sent.attrs.toString(16)} received 0x${area.attrs.toString(16)}`,
      );
    }
    const expected = responseHmac(
      sent.sessionKey,
      rp,
      area.nonceTPM,
      sent.nonceCaller,
      area.attrs,
      sent.authValue ?? Buffer.alloc(0),
    );
    if (!timingSafeEqual(expected, area.hmac)) {
      reject(RESPONSE_REJECTIONS.HMAC_MISMATCH, `auth[${i}]`);
    }
    verified.push({ nonceTPM: area.nonceTPM, attrs: area.attrs });
  });
  return {
    form: sawHmacSession ? 'n2' : 'n3',
    rc: 0,
    handles,
    parameters,
    sessions: verified,
    authenticated: true,
  };
}
