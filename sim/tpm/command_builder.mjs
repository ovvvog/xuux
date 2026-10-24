/**
 * G2-3 (الوحدةُ الأولى) — بانيُّ أوامرِ TPM2 من حقولٍ مسمّاة، لا بايتاتٍ جاهزة.
 *
 * **العقدُ (الملحقُ هـ لـADR 0007، §4.3):** «الرموزُ وحدَها لا تكفي. البوّابةُ لا
 * تقبلُ بايتاتِ أمرٍ جاهزةً من طبقةٍ أعلى، بل تبنيها من حقولٍ مسمّاة» — فكلُّ دالةٍ
 * هنا تأخذُ حقولًا مسمّاةً بقيودٍ مغلقةٍ (مصفوفةُ §4.3)، وتُخرِجُ بايتاتِ الأمرِ كاملةً
 * (رأسٌ + مقابضُ + منطقةُ تفويضٍ + معاملات)، وتُعيدُ معها ما يلزمُ لبناءِ جلسةِ HMAC
 * (cpHash والأمرُّ والجلسةُ) بلا كشفِ مفاتيح.
 *
 * **ما لا تفعلهُ هذهِ الوحدةُ:** لا ترسلُ شيئًا (الإرسالُ للنقلِ G2-1)، ولا تُحلِّلُ
 * ردًّا (التحليلُ للمحلِّلِ G2-2)، ولا تقررُ جاهزيةَ أيِّ صفٍّ (ذلك للبوّابةِ G2-3 نفسِها).
 *
 * **حدودُ الصدق:** وحدةُ محاكاةٍ وتصميمٍ على مسارِ `sim/`؛ لا مسارَ إنتاجيًّا يقرؤُها،
 * و`SUPPORTED_FRESHNESS_BACKENDS` تبقى فارغةً (قرارُ NO-GO قائمٌ بلا تغييرٍ).
 */

import { createHash, createHmac, publicEncrypt, createPublicKey, constants as cryptoConstants } from 'node:crypto';
import { strict as assert } from 'node:assert';

/** أخطاءُ البانيِ المسمّاة — تُرمى قبلَ بناءِ أيِّ بايتٍ إذا خالفتِ الحقولُ القيودَ. */
export const COMMAND_BUILDER_ERRORS = Object.freeze({
  FIELD_INVALID: 'COMMAND_BUILDER_FIELD_INVALID',
  SESSION_INVALID: 'COMMAND_BUILDER_SESSION_INVALID',
  TEMPLATE_INVALID: 'COMMAND_BUILDER_TEMPLATE_INVALID',
  PUBLIC_INVALID: 'COMMAND_BUILDER_PUBLIC_INVALID',
  NOT_IMPLEMENTED: 'COMMAND_BUILDER_NOT_IMPLEMENTED',
});

// WL-462: صُدِّرَ ليستعملهُ تجميعُ قالبِ EK (ek_template.mjs) في رفضِ القالبِ المخالفِ لنوعِ الشهادةِ.
export class CommandBuilderError extends Error {
  /**
   * @param {string} code من `COMMAND_BUILDER_ERRORS`
   * @param {string} field الحقلُ المخالف
   * @param {string} detail
   */
  constructor(code, field, detail) {
    super(`${code} [${field}]: ${detail}`);
    this.name = 'CommandBuilderError';
    this.code = code;
    this.field = field;
    this.detail = detail;
  }
}

const invalid = (/** @type {string} */ field, /** @type {string} */ detail) => new CommandBuilderError(COMMAND_BUILDER_ERRORS.FIELD_INVALID, field, detail);

// ——— الثوابتُ (Part 2 r1.59؛ والقيمُ المذكورةُ حرفيًّا في الملحقِ هـ §4.3) ———

export const TPM_ST = Object.freeze({ NO_SESSIONS: 0x8001, SESSIONS: 0x8002 });
export const TPM_RC_SUCCESS = 0x000;
export const TPM_CC = Object.freeze({
  NV_DefineSpace: 0x12a,
  NV_UndefineSpace: 0x122,
  NV_Increment: 0x134,
  NV_Write: 0x137,
  NV_Read: 0x14e,
  NV_ReadPublic: 0x169,
  ReadPublic: 0x173,
  EvictControl: 0x120,
  GetCapability: 0x17a,
  CreatePrimary: 0x131,
  StartAuthSession: 0x176,
  FlushContext: 0x165,
  GetRandom: 0x17b,
});
export const TPM_RH = Object.freeze({
  OWNER: 0x40000001,
  NULL: 0x40000007,
  RS_PW: 0x40000009,
  LOCKOUT: 0x4000000a,
  ENDORSEMENT: 0x4000000b,
});
export const TPM_SE = Object.freeze({ HMAC: 0x00, POLICY: 0x01 });
export const TPM_CAP = Object.freeze({ HANDLES: 0x01, TPM_PROPERTIES: 0x06 });
export const TPM_ALG = Object.freeze({
  RSA: 0x0001,
  SHA1: 0x0004,
  SHA256: 0x000b,
  SHA384: 0x000c,
  AES: 0x0006,
  CFB: 0x0043,
  NULL: 0x0010,
  ECC: 0x0023,
  KDF1_SP800_56A: 0x0020,
});
export const SESSION_ATTRS = Object.freeze({ CONTINUE: 0x01, AUDIT: 0x40, AUDIT_CONTINUE: 0x81 });
/** مجالُ فهارسِ EK/الملحِ المغلقُ من §4.3 (T1/T2). */
export const EK_NV_RANGE = Object.freeze({
  first: 0x01c00002,
  last: 0x01c0000c,
  indices: Object.freeze([
    0x01c00002, 0x01c00003, 0x01c00004, 0x01c0000a, 0x01c0000b, 0x01c0000c,
  ]),
});
/** `TPM_PT_NV_BUFFER_MAX` — T6 يقرؤُهُ لا يخمِّنُه. */
export const TPM_PT_NV_BUFFER_MAX = 0x0000012c;
/** حدُّ صفحةِ T1/P0 من §4.3: `propertyCount` ≤ 16. */
export const T1_PAGE_MAX_COUNT = 16;

const u8 = (/** @type {number} */ n) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xff) throw invalid('byte', `not a byte: ${String(n)}`);
  const b = Buffer.alloc(1);
  b.writeUInt8(n);
  return b;
};
const u16 = (/** @type {number} */ n) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw invalid('u16', `not a u16: ${String(n)}`);
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (/** @type {number} */ n) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw invalid('u32', `not a u32: ${String(n)}`);
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
/** TPM2B: طولٌ + بايتات. */
const tpm2b = (/** @type {Buffer} */ bytes) => Buffer.concat([u16(bytes.length), bytes]);
const sha256 = (/** @type {Buffer[]} */ ...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
const isBuffer = (/** @type {unknown} */ v) => Buffer.isBuffer(v);

// ——— منطقةُ التفويضِ (Part 1 §18.5؛ `authorizationSize` طولُ بايتاتِ المنطقةِ لا عددُ الجلسات) ———

/**
 * جلسةُ تفويضٍ بصلاحيةِ كلمةِ المرورِ (`TPM_RS_PW`) — موضعاها الوحيدانِ هنا هما T3/T5
 * في `bootstrap` بتفويضٍ فارغٍ (السماتُ `continueSession` وحدَها).
 * @param {{ authValue?: Buffer }} [fields]
 * @returns {{ kind: 'password', area: Buffer, descriptor: { kind: 'password' } }}
 */
export function passwordSession(fields = {}) {
  const authValue = fields.authValue ?? Buffer.alloc(0);
  if (!isBuffer(authValue)) throw invalid('authValue', 'must be bytes');
  if (authValue.length !== 0) {
    throw new CommandBuilderError(
      COMMAND_BUILDER_ERRORS.SESSION_INVALID,
      'authValue',
      'TPM_RS_PW authValue must be empty in this design (§4.3: never owner auth over RS_PW)',
    );
  }
  const area = Buffer.concat([u32(TPM_RH.RS_PW), tpm2b(Buffer.alloc(0)), u8(SESSION_ATTRS.CONTINUE), tpm2b(Buffer.alloc(0))]);
  return { kind: 'password', area, descriptor: { kind: 'password' } };
}

/**
 * جلسةُ HMAC مملّحة — تُبنى معاملاتُ تفويضِها (nonce ‖ attrs ‖ HMAC) فوقَ cpHash.
 * @param {{ handle: number, nonceCaller: Buffer, attrs: number, sessionKey: Buffer, authValue?: Buffer, cpHash: Buffer, nonceTPM?: Buffer }} fields
 */
export function hmacSession(fields) {
  if (!Number.isInteger(fields.handle)) throw invalid('handle', 'must be an integer');
  if (!isBuffer(fields.nonceCaller) || fields.nonceCaller.length !== 32) throw invalid('nonceCaller', 'must be 32 bytes');
  if (!Number.isInteger(fields.attrs)) throw invalid('attrs', 'must be an integer');
  if (!isBuffer(fields.sessionKey) || fields.sessionKey.length !== 32) throw invalid('sessionKey', 'must be 32 bytes');
  const authValue = fields.authValue ?? Buffer.alloc(0);
  if (!isBuffer(authValue)) throw invalid('authValue', 'must be bytes');
  if (!isBuffer(fields.cpHash) || fields.cpHash.length !== 32) throw invalid('cpHash', 'must be 32 bytes');
  const hmac = commandHmac(fields.sessionKey, authValue, fields.cpHash, fields.nonceCaller, fields.nonceTPM ?? Buffer.alloc(0), fields.attrs);
  // منطقةُ التفويضِ سلسلةُ جلساتٍ بلا عدّادٍ (Part 3: authorizationSize ثمّ الجلساتُ مباشرةً).
  const area = Buffer.concat([u32(fields.handle), tpm2b(fields.nonceCaller), u8(fields.attrs), tpm2b(hmac)]);
  return {
    kind: 'hmac',
    area,
    descriptor: { kind: 'hmac', handle: fields.handle, nonceCaller: fields.nonceCaller, attrs: fields.attrs, sessionKey: fields.sessionKey, authValue },
  };
}

/**
 * منطقةُ التفويضِ كاملةً (authorizationSize ‖ الجلساتُ بالترتيبِ). جلسةٌ واحدةٌ في
 * كلِّ صفوفِ هذا التصميمِ (§4.3: لا صفًّا بجلساتٍ متعددةٍ في هذه الحزمة).
 * @param {{ area: Buffer }} session
 * @returns {Buffer}
 */
export function authorizationArea(session) {
  if (!session || !isBuffer(session.area)) throw invalid('session', 'missing area bytes');
  return Buffer.concat([u32(session.area.length), session.area]);
}

// ——— cpHash وHMAC الأمرِ (Part 1 §19.6.3/§19.6.5) ———

/**
 * `cpHash = SHA-256(commandCode ‖ Names(handles) ‖ parameters)` — الأسماءُ تُحسبُ
 * محلّيًّا (اسمُ فهرسِ NV من منطقتِهِ العامّةِ؛ واسمُ كيانٍ دائمٍ مقبضُهُ).
 * @param {number} commandCode
 * @param {Buffer[]} handleNames أسماءُ المقابضِ بترتيبِ الأمر
 * @param {Buffer} parameters
 */
export function cpHash(commandCode, handleNames, parameters) {
  return sha256(u32(commandCode), Buffer.concat(handleNames), parameters);
}

/** اسمُ كيانٍ دائمٍ (هرمٍ) = مقبضُهُ نفسُهُ. @param {number} handle */
export function permanentName(handle) {
  return u32(handle);
}

/** اسمُ فهرسِ NV = `nameAlg ‖ H(nvPublic)` محسوبًا محلّيًّا من منطقةٍ عامّةٍ قُرئت. @param {Buffer} nvPublicBytes @param {number} nameAlg */
export function nvIndexName(nvPublicBytes, nameAlg) {
  if (!isBuffer(nvPublicBytes) || nvPublicBytes.length === 0) throw invalid('nvPublicBytes', 'must be non-empty bytes');
  if (nameAlg !== TPM_ALG.SHA256) throw invalid('nameAlg', 'only SHA-256 in this design (§4.3)');
  return Buffer.concat([u16(nameAlg), sha256(nvPublicBytes)]);
}

/**
 * HMAC الأمرِ = `HMAC-SHA-256(sessionKey ‖ authValue, cpHash ‖ nonceCaller ‖ nonceTPM ‖ sessionAttributes)`.
 * يطابقُ معادلةَ الملحقِ هـ §4.3 (جلسةُ المالكِ) معَ `authValue` فارغةٍ في كلِّ استعمالاتِ هذهِ الحزمة.
 * @param {Buffer} sessionKey @param {Buffer} authValue @param {Buffer} cp @param {Buffer} nonceCaller @param {Buffer} nonceTPM @param {number} attrs
 */
export function commandHmac(sessionKey, authValue, cp, nonceCaller, nonceTPM, attrs) {
  return createHmac('sha256', Buffer.concat([sessionKey, authValue]))
    .update(Buffer.concat([cp, nonceCaller, nonceTPM, u8(attrs)]))
    .digest();
}

// ——— تجميعُ الأمرِ ———

/**
 * @param {{ tag: number, commandCode: number, handles?: Buffer[], authorization?: Buffer | undefined, parameters: Buffer }} parts
 * @returns {Uint8Array}
 */
function assemble(parts) {
  const handles = parts.handles ?? [];
  const body = Buffer.concat([...handles, ...(parts.authorization ? [parts.authorization] : []), parts.parameters]);
  return new Uint8Array(Buffer.concat([u16(parts.tag), u32(10 + body.length), u32(parts.commandCode), body]));
}

/**
 * T1/P0/C1 — `GetCapability`. الصفُّ يتحققُ من قيودِ المجالِ والعددِ قبلَ البناءِ.
 * @param {{ capability: number, property: number, propertyCount: number, session?: { area: Buffer } }} fields
 */
export function buildGetCapability(fields) {
  if (fields.capability !== TPM_CAP.HANDLES && fields.capability !== TPM_CAP.TPM_PROPERTIES) {
    throw invalid('capability', `must be HANDLES or TPM_PROPERTIES: 0x${fields.capability.toString(16)}`);
  }
  if (fields.capability === TPM_CAP.HANDLES) {
    if (!Number.isInteger(fields.property) || fields.property < EK_NV_RANGE.first || fields.property > EK_NV_RANGE.last) {
      throw invalid('property', `handles pages start inside 0x${EK_NV_RANGE.first.toString(16)}–0x${EK_NV_RANGE.last.toString(16)}`);
    }
    if (!Number.isInteger(fields.propertyCount) || fields.propertyCount < 1 || fields.propertyCount > T1_PAGE_MAX_COUNT) {
      throw invalid('propertyCount', `handles pages use count 1..${T1_PAGE_MAX_COUNT}`);
    }
  } else if (fields.capability === TPM_CAP.TPM_PROPERTIES) {
    if (!Number.isInteger(fields.propertyCount) || fields.propertyCount < 1) throw invalid('propertyCount', 'must be >= 1');
  }
  const parameters = Buffer.concat([u32(fields.capability), u32(fields.property), u32(fields.propertyCount)]);
  const auth = fields.session ? authorizationArea(fields.session) : undefined;
  const command = assemble({
    tag: auth ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
    commandCode: TPM_CC.GetCapability,
    authorization: auth,
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.GetCapability,
      tag: auth ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
      responseHandleCount: 0,
      mutating: false,
      allowNoSessionsResponse: !auth,
      sessions: fields.session ? [/** @type {any} */ (fields.session).descriptor] : [],
    },
    parameters,
    cpHash: cpHash(TPM_CC.GetCapability, [], parameters),
  };
}

/** T2/C1 — `NV_ReadPublic`. @param {{ nvIndex: number, indexName?: Buffer, session?: { area: Buffer, descriptor: unknown } }} fields */
export function buildNvReadPublic(fields) {
  if (!Number.isInteger(fields.nvIndex)) throw invalid('nvIndex', 'must be an integer');
  if (fields.indexName !== undefined && !Buffer.isBuffer(fields.indexName)) {
    throw invalid('indexName', 'must be a Buffer when provided');
  }
  const parameters = Buffer.alloc(0);
  // اسمُ فهرسِ NV في cpHash هو nameAlg‖H(nvPublic) لا بايتاتِ المقبضِ (Part 1 §18.7).
  const handleNames = [fields.indexName ?? u32(fields.nvIndex)];
  const command = assemble({
    tag: fields.session ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
    commandCode: TPM_CC.NV_ReadPublic,
    handles: [u32(fields.nvIndex)],
    authorization: fields.session ? authorizationArea(fields.session) : undefined,
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.NV_ReadPublic,
      tag: fields.session ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
      responseHandleCount: 0,
      mutating: false,
      allowNoSessionsResponse: !fields.session,
      sessions: fields.session ? [/** @type {any} */ (fields.session).descriptor] : [],
    },
    parameters,
    cpHash: cpHash(TPM_CC.NV_ReadPublic, handleNames, parameters),
  };
}

/** معاملاتُ `NV_Read` (لحسابِ cpHash مسبقًا قبلَ بناءِ الجلسةِ). @param {number} size @param {number} offset */
export function nvReadParameters(size, offset) {
  return Buffer.concat([u16(size), u16(offset)]);
}

/** cpHash لأمرِ `NV_Read` — يُحسَبُ قبلَ فتحِ الجلسةِ (أسماءُ المقبضينِ مطلوبةٌ). @param {Buffer[]} handleNames @param {number} size @param {number} offset */
export function nvReadCpHash(handleNames, size, offset) {
  if (!Array.isArray(handleNames) || handleNames.length !== 2 || !handleNames.every(isBuffer)) {
    throw invalid('handleNames', 'NV_Read cpHash needs the names of authHandle and nvIndex');
  }
  return cpHash(TPM_CC.NV_Read, handleNames, nvReadParameters(size, offset));
}

/**
 * المنطقةُ العامّةُ لفهرسِ NV كما تُرسَلُ في `NV_DefineSpace` وتُعادُ في `NV_ReadPublic`:
 * `nvIndex(4) † nameAlg(2) † attributes(4) † authPolicy(TPM2B) † dataSize(2)`.
 * @param {{ nvIndex: number, dataSize: number, attributes: number, authPolicy?: Buffer }} fields
 */
export function nvPublicArea(fields) {
  if (!Number.isInteger(fields.nvIndex)) throw invalid('nvIndex', 'must be an integer');
  if (!Number.isInteger(fields.dataSize) || fields.dataSize < 0) throw invalid('dataSize', 'must be a non-negative integer');
  if (!Number.isInteger(fields.attributes)) throw invalid('attributes', 'must be an integer');
  const authPolicy = fields.authPolicy ?? Buffer.alloc(0);
  if (!isBuffer(authPolicy)) throw invalid('authPolicy', 'must be bytes when provided');
  return Buffer.concat([
    u32(fields.nvIndex),
    u16(TPM_ALG.SHA256),
    u32(fields.attributes),
    tpm2b(authPolicy),
    u16(fields.dataSize),
  ]);
}

/**
 * عصٌّ تجريبيٌّ (خارجَ البوّابةِ) — `NV_DefineSpace`: يُنشئُ فهرسًا بسماتِ
 * AUTHREAD|AUTHWRITE وقيمةِ تفويضٍ فارغةٍ، فيقرأُهُ الجلسةُ المملّحةُ غيرُ المربوطةِ
 * (مفتاحُ HMAC = sessionKey † authValue الفارغةِ — Part 1 §18.3) وجلسةُ كلمةِ
 * المرورِ على حدٍّ سواءٍ. التفويضُ: مالكُِ الهرمِ بجلسةِ كلمةِ مرورٍ فارغةٍ.
 * @param {{ nvIndex: number, dataSize: number, attributes: number, authPolicy?: Buffer, session: { area: Buffer, descriptor: unknown } }} fields
 */
export function buildNvDefineSpace(fields) {
  const publicInfo = nvPublicArea(fields);
  // معاملاتُ الأمرِ: auth(TPMS_NV_AUTH = TPM2B nvAuth فارغةٌ في هذا التصميمِ) † publicInfo(TPM2B_NV_PUBLIC)
  const parameters = Buffer.concat([tpm2b(Buffer.alloc(0)), tpm2b(publicInfo)]);
  const command = assemble({
    tag: TPM_ST.SESSIONS,
    commandCode: TPM_CC.NV_DefineSpace,
    handles: [u32(TPM_RH.OWNER)],
    authorization: authorizationArea(fields.session),
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.NV_DefineSpace,
      tag: TPM_ST.SESSIONS,
      responseHandleCount: 0,
      mutating: true,
      allowNoSessionsResponse: false,
      sessions: [/** @type {any} */ (fields.session).descriptor],
    },
    parameters,
    cpHash: cpHash(TPM_CC.NV_DefineSpace, [permanentName(TPM_RH.OWNER)], parameters),
    indexName: nvIndexName(publicInfo, TPM_ALG.SHA256),
  };
}

/**
 * عصٌّ تجريبيٌّ (خارجَ البوّابةِ) — `NV_UndefineSpace`: تنطيفُ فهرسٍ أنشأهُ الاختبارُ — لا يتسرّبُ حالةً
 * للاختباراتِ اللاحقةِ في المحاكي المشتركِ.
 * @param {{ nvIndex: number, indexName?: Buffer, session: { area: Buffer, descriptor: unknown } }} fields
 */
export function buildNvUndefineSpace(fields) {
  if (!Number.isInteger(fields.nvIndex)) throw invalid('nvIndex', 'must be an integer');
  const parameters = Buffer.alloc(0);
  const command = assemble({
    tag: TPM_ST.SESSIONS,
    commandCode: TPM_CC.NV_UndefineSpace,
    handles: [u32(TPM_RH.OWNER), u32(fields.nvIndex)],
    authorization: authorizationArea(fields.session),
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.NV_UndefineSpace,
      tag: TPM_ST.SESSIONS,
      responseHandleCount: 0,
      mutating: true,
      allowNoSessionsResponse: false,
      sessions: [/** @type {any} */ (fields.session).descriptor],
    },
    parameters,
    cpHash: cpHash(TPM_CC.NV_UndefineSpace, [permanentName(TPM_RH.OWNER), fields.indexName ?? u32(fields.nvIndex)], parameters),
  };
}

/**
 * عصٌّ تجريبيٌّ (خارجَ البوّابةِ) — `NV_Write`: يكتبُ محتوى معلومًا في فهرسٍ بسمةِ
 * AUTHWRITE وقيمةِ تفويضٍ فارغةٍ (جلسةُ كلمةِ المرورِ على الفهرسِ نفسِهِ — المقبضانِ هُما الفهرسُ).
 * @param {{ nvIndex: number, data: Buffer, offset: number, session: { area: Buffer, descriptor: unknown }, indexName?: Buffer }} fields
 */
export function buildNvWrite(fields) {
  if (!Number.isInteger(fields.nvIndex)) throw invalid('nvIndex', 'must be an integer');
  if (!isBuffer(fields.data) || fields.data.length === 0) throw invalid('data', 'must be non-empty bytes');
  if (!Number.isInteger(fields.offset) || fields.offset < 0) throw invalid('offset', 'must be a non-negative integer');
  const parameters = Buffer.concat([tpm2b(fields.data), u16(fields.offset)]);
  const command = assemble({
    tag: TPM_ST.SESSIONS,
    commandCode: TPM_CC.NV_Write,
    handles: [u32(fields.nvIndex), u32(fields.nvIndex)],
    authorization: authorizationArea(fields.session),
    parameters,
  });
  if (fields.indexName !== undefined && !isBuffer(fields.indexName)) throw invalid('indexName', 'must be bytes when provided');
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.NV_Write,
      tag: TPM_ST.SESSIONS,
      responseHandleCount: 0,
      mutating: true,
      allowNoSessionsResponse: false,
      sessions: [/** @type {any} */ (fields.session).descriptor],
    },
    parameters,
    // cpHash لأمرِ NV_Write يحتاجُ اسمَي الفهرسِ (المقبضانِ هُما الفهرسُ) — يُمرَّرُ من خطوةِ التعريفِ.
    cpHash: fields.indexName ? cpHash(TPM_CC.NV_Write, [fields.indexName, fields.indexName], parameters) : null,
  };
}

/**
 * T3/C1 — `NV_Read`. `handleNames` أسماءُ المقبضينِ (authHandle وnvIndex) بترتيبِ الأمرِ
 * — واسمُ الفهرسِ يُحسَبُ محلّيًّا من منطقتِهِ العامّةِ (`nvIndexName`).
 * @param {{ authHandle: number, nvIndex: number, size: number, offset: number, session: { area: Buffer, descriptor: unknown }, handleNames: Buffer[] }} fields
 */
export function buildNvRead(fields) {
  if (!Number.isInteger(fields.authHandle) || !Number.isInteger(fields.nvIndex)) {
    throw invalid('handles', 'must be integers');
  }
  if (!Number.isInteger(fields.size) || fields.size < 0) throw invalid('size', 'must be a non-negative integer');
  if (!Number.isInteger(fields.offset) || fields.offset < 0) throw invalid('offset', 'must be a non-negative integer');
  const parameters = nvReadParameters(fields.size, fields.offset);
  const auth = authorizationArea(fields.session);
  const command = assemble({
    tag: TPM_ST.SESSIONS,
    commandCode: TPM_CC.NV_Read,
    handles: [u32(fields.authHandle), u32(fields.nvIndex)],
    authorization: auth,
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.NV_Read,
      tag: TPM_ST.SESSIONS,
      responseHandleCount: 0,
      mutating: false,
      allowNoSessionsResponse: false,
      sessions: [/** @type {any} */ (fields.session).descriptor],
    },
    parameters,
    cpHash: cpHash(TPM_CC.NV_Read, fields.handleNames, parameters),
  };
}

/** T4/C1 — `ReadPublic`. @param {{ objectHandle: number, objectName?: Buffer, session?: { area: Buffer, descriptor: unknown } }} fields */
export function buildReadPublic(fields) {
  if (!Number.isInteger(fields.objectHandle)) throw invalid('objectHandle', 'must be an integer');
  if (fields.objectName !== undefined && !Buffer.isBuffer(fields.objectName)) {
    throw invalid('objectName', 'must be a Buffer when provided');
  }
  const parameters = Buffer.alloc(0);
  const auth = fields.session ? authorizationArea(fields.session) : undefined;
  // cpHash يستخدم «اسم» المقبضِ (Part 1 §18.7): للكائنِ العابرِ اسمُهُ nameAlg‖H(public)،
  // وليسَ بايتاتِ المقبضِ الخامَّ — يُمرَّر من جهةِ الاستدعاءِ (من ردِّ T4/T5).
  const handleNames = [fields.objectName ?? u32(fields.objectHandle)];
  const command = assemble({
    tag: auth ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
    commandCode: TPM_CC.ReadPublic,
    handles: [u32(fields.objectHandle)],
    authorization: auth,
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.ReadPublic,
      tag: auth ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
      responseHandleCount: 0,
      mutating: false,
      allowNoSessionsResponse: !auth,
      sessions: fields.session ? [/** @type {any} */ (fields.session).descriptor] : [],
    },
    parameters,
    cpHash: cpHash(TPM_CC.ReadPublic, handleNames, parameters),
  };
}

/** `TPM2B_SENSITIVE_CREATE` فارغةٌ (بغلافِ TP2B الخارجيّ) و`TPML_PCR_SELECTION` فارغة — كاملُ مدخلاتِ T5 الحسّاسةِ. */
// قيسَ على swtpm حيٍّ: بلا الغلافِ يردُّ الـTPM `0x1d5` (parameter 1: wrong size).
const EMPTY_SENSITIVE_CREATE = tpm2b(Buffer.concat([tpm2b(Buffer.alloc(0)), tpm2b(Buffer.alloc(0))]));
const EMPTY_PCR_SELECTION = u32(0);

/**
 * T5 — `CreatePrimary` (تفويضُ `TPM_RS_PW` فارغٌ على هرمِ المصادقةِ، وحدَه في `bootstrap`).
 * @param {{ inPublic: Buffer, session?: { area: Buffer, descriptor: unknown } }} fields
 */
export function buildCreatePrimary(fields) {
  if (!isBuffer(fields.inPublic) || fields.inPublic.length < 14) throw invalid('inPublic', 'must be a marshaled TPMT_PUBLIC');
  const parameters = Buffer.concat([EMPTY_SENSITIVE_CREATE, tpm2b(fields.inPublic), tpm2b(Buffer.alloc(0)), EMPTY_PCR_SELECTION]);
  const auth = fields.session ? authorizationArea(fields.session) : undefined;
  const command = assemble({
    tag: auth ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
    commandCode: TPM_CC.CreatePrimary,
    handles: [u32(TPM_RH.ENDORSEMENT)],
    authorization: auth,
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.CreatePrimary,
      tag: auth ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
      responseHandleCount: 1,
      mutating: false,
      allowNoSessionsResponse: !auth,
      sessions: fields.session ? [/** @type {any} */ (fields.session).descriptor] : [],
    },
    parameters,
    cpHash: cpHash(TPM_CC.CreatePrimary, [u32(TPM_RH.ENDORSEMENT)], parameters),
  };
}

/**
 * `StartAuthSession` — بلا جلساتٍ (أمرُّ تحكّمٍ، ردُّهُ ن1). الجلسةُ المملّحةُ: `tpmKey`
 * مقبضُ EK، و`bind` = `TPM_RH_NULL`، والملحُ يُعمَّلُ بـRSA-OAEP بالعلامةِ `"SECRET\0"`.
 * @param {{ tpmKey: number, bind?: number, nonceCaller: Buffer, encryptedSalt: Buffer, sessionType: number, symmetricAlg?: number, authHash?: number }} fields
 */
export function buildStartAuthSession(fields) {
  if (!Number.isInteger(fields.tpmKey)) throw invalid('tpmKey', 'must be an integer');
  const bind = fields.bind ?? TPM_RH.NULL;
  if (bind !== TPM_RH.NULL) {
    throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.SESSION_INVALID, 'bind', 'salted session in this design is unbound (bind = TPM_RH_NULL)');
  }
  if (fields.sessionType !== TPM_SE.HMAC && fields.sessionType !== TPM_SE.POLICY) {
    throw invalid('sessionType', 'must be TPM_SE_HMAC or TPM_SE_POLICY');
  }
  if (!isBuffer(fields.nonceCaller) || fields.nonceCaller.length !== 32) throw invalid('nonceCaller', 'must be 32 bytes');
  if (!isBuffer(fields.encryptedSalt) || fields.encryptedSalt.length === 0) {
    throw invalid('encryptedSalt', 'must be non-empty bytes (mandatory in this design)');
  }
  const symmetricAlg = fields.symmetricAlg ?? TPM_ALG.NULL;
  if (symmetricAlg !== TPM_ALG.NULL) {
    throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.SESSION_INVALID, 'symmetricAlg', 'TPM_ALG_NULL only (§4.3: no parameter encryption)');
  }
  const authHash = fields.authHash ?? TPM_ALG.SHA256;
  if (authHash !== TPM_ALG.SHA256) throw invalid('authHash', 'SHA-256 only (§4.3)');
  const parameters = Buffer.concat([
    u32(fields.tpmKey),
    u32(bind),
    tpm2b(fields.nonceCaller),
    tpm2b(fields.encryptedSalt),
    u8(fields.sessionType),
    u16(symmetricAlg),
    u16(authHash),
  ]);
  const command = assemble({
    tag: TPM_ST.NO_SESSIONS,
    commandCode: TPM_CC.StartAuthSession,
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.StartAuthSession,
      tag: TPM_ST.NO_SESSIONS,
      responseHandleCount: 1,
      mutating: false,
      allowNoSessionsResponse: true,
      sessions: [],
    },
    parameters,
    cpHash: cpHash(TPM_CC.StartAuthSession, [u32(fields.tpmKey), u32(bind)], parameters),
  };
}

/** `FlushContext` — بلا جلساتٍ (Part 3 §28.4 يفرضُ `TPM_ST_NO_SESSIONS`). @param {{ flushHandle: number }} fields */
export function buildFlushContext(fields) {
  if (!Number.isInteger(fields.flushHandle)) throw invalid('flushHandle', 'must be an integer');
  const command = assemble({
    tag: TPM_ST.NO_SESSIONS,
    commandCode: TPM_CC.FlushContext,
    handles: [u32(fields.flushHandle)],
    parameters: Buffer.alloc(0),
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.FlushContext,
      tag: TPM_ST.NO_SESSIONS,
      responseHandleCount: 0,
      mutating: false,
      allowNoSessionsResponse: true,
      sessions: [],
    },
    parameters: Buffer.alloc(0),
    cpHash: cpHash(TPM_CC.FlushContext, [u32(fields.flushHandle)], Buffer.alloc(0)),
  };
}

/** `GetRandom` — بلا جلساتٍ (مسارُ العرضِ للتشخيصِ؛ لا دورَ لهُ في صفوفِ البوابة). @param {{ bytesRequested: number, session?: { area: Buffer, descriptor: unknown } }} fields */
export function buildGetRandom(fields) {
  if (!Number.isInteger(fields.bytesRequested) || fields.bytesRequested < 1 || fields.bytesRequested > 32) {
    throw invalid('bytesRequested', 'must be 1..32');
  }
  const parameters = u16(fields.bytesRequested);
  const command = assemble({
    tag: fields.session ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
    commandCode: TPM_CC.GetRandom,
    authorization: fields.session ? authorizationArea(fields.session) : undefined,
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.GetRandom,
      tag: fields.session ? TPM_ST.SESSIONS : TPM_ST.NO_SESSIONS,
      responseHandleCount: 0,
      mutating: false,
      allowNoSessionsResponse: !fields.session,
      sessions: fields.session ? [/** @type {any} */ (fields.session).descriptor] : [],
    },
    parameters,
    cpHash: cpHash(TPM_CC.GetRandom, [], parameters),
  };
}

// ——— قوالبُ EK (ملفُّ اعتمادِ EK §2.2.1.6 حرفيًّا؛ الحالاتُ 1/2 من §4.3) ———

/** القالبُ الافتراضيُّ L-1 (RSA 2048) — `unique` 256 صفرًا (حالةُ غيابِ القالبِ والـnonce). */
export function defaultEkTemplateRsa2048() {
  const symmetric = Buffer.concat([u16(TPM_ALG.AES), u16(0x0080), u16(TPM_ALG.CFB)]);
  const scheme = u16(TPM_ALG.NULL);
  const parameters = Buffer.concat([symmetric, scheme, u16(0x0800), u32(0)]);
  const unique = tpm2b(Buffer.alloc(256));
  return Buffer.concat([u16(TPM_ALG.RSA), u16(TPM_ALG.SHA256), u32(0x00030072), tpm2b(Buffer.alloc(0)), parameters, unique]);
}

/** القالبُ الافتراضيُّ L-2 (ECC P-256) — `unique.x`/`unique.y` 32 صفرًا لكلٍّ منهما. */
export function defaultEkTemplateEccP256() {
  const symmetric = u16(TPM_ALG.NULL);
  const scheme = u16(TPM_ALG.NULL);
  const parameters = Buffer.concat([symmetric, scheme, u16(0x0003 /* P-256 */), u16(TPM_ALG.NULL)]);
  const unique = Buffer.concat([tpm2b(Buffer.alloc(32)), tpm2b(Buffer.alloc(32))]);
  return Buffer.concat([u16(TPM_ALG.ECC), u16(TPM_ALG.SHA256), u32(0x00030072), tpm2b(Buffer.alloc(0)), parameters, unique]);
}

/**
 * قالبٌ بقالبٍ مقروءٍ وحشوِ nonce (حالةُ 3 من ملفِ اعتمادِ EK §2.2.1.6): يُعطى القالبُ المقروءُ
 * كاملًا والـnonce، فيُستبدَلُ حقلُ unique كلُّهُ بالقيمةِ المحشوّةِ — **واعيًا بالتحليلِ** لا
 * بلاحقةٍ ثابتةِ الطولِ (WL-462: كانتِ اللاحقةُ الثابتةُ (258) تفترضُ unique بطولِ 256 فتُفسِدُ
 * أيَّ قالبٍ مقروءٍ أقصرَ — عيبٌ مُثبَتٌ باختبارِ انحدارٍ في `tests/sim/g2-ek-template.test.mjs`).
 * القالبُ يُحلَّلُ أولًا `parseTpmtPublic` فلا بايتَ زائدًا ولا بنيةً فاسدةً، وkind يطابقُ نوعَ القالب.
 * @param {Buffer} readTemplate @param {Buffer} nonce @param {'rsa'|'ecc'} kind
 */
export function ekTemplateWithNonce(readTemplate, nonce, kind) {
  if (!isBuffer(readTemplate) || readTemplate.length === 0) throw invalid('readTemplate', 'must be bytes');
  if (!isBuffer(nonce)) throw invalid('nonce', 'must be bytes');
  const parsed = parseTpmtPublic(readTemplate);
  if (kind === 'rsa') {
    if (parsed.type !== TPM_ALG.RSA) throw invalid('kind', 'template is not RSA');
    if (nonce.length > 256) throw invalid('nonce', 'RSA nonce padded to 256');
    const padded = Buffer.concat([nonce, Buffer.alloc(256 - nonce.length)]);
    // استبدالُ حقلِ unique من حدِّهِ المقيسِ بالتحليلِ (لا افتراضَ لطولِ اللاحقةِ).
    const body = readTemplate.subarray(0, /** @type {number} */ (parsed.uniqueOffset));
    return Buffer.concat([body, tpm2b(padded)]);
  }
  if (kind === 'ecc') {
    if (parsed.type !== TPM_ALG.ECC) throw invalid('kind', 'template is not ECC');
    if (nonce.length > 32) throw invalid('nonce', 'ECC nonce padded to 32');
    const x = Buffer.concat([nonce, Buffer.alloc(32 - nonce.length)]);
    const body = readTemplate.subarray(0, /** @type {number} */ (parsed.uniqueOffset));
    // unique.ecc = TPMS_ECC_POINT: x محشوٌّ إلى 32 وy = 32 صفرًا (§4.3 حالةُ 3).
    return Buffer.concat([body, tpm2b(x), tpm2b(Buffer.alloc(32))]);
  }
  throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.NOT_IMPLEMENTED, 'kind', `unknown kind ${String(kind)}`);
}

/**
 * عصٌّ تجريبيٌّ (خارجَ البوّابةِ) — `EvictControl`: ترقيةُ مفتاحٍ عابرٍ إلى مقبضٍ مستمرٍّ أو
 * إزالةُ مقبضٍ مستمرٍّ (بتمريرِ المقبضِ المستمرِّ في الحقلَينِ معًا). لا ترسلهُ البوّابةُ أبدًا
 * (§4.3: ممنوعٌ دائمًا في هذا المنفّذ) — هذا تثبيتُ رقعةِ اختبارِ مسارِ T4 وحدَه.
 * @param {{ objectHandle: number, persistentHandle: number, objectName?: Buffer, session: { area: Buffer, descriptor: unknown } }} fields
 */
export function buildEvictControl(fields) {
  if (!Number.isInteger(fields.objectHandle)) throw invalid('objectHandle', 'must be an integer');
  if (!Number.isInteger(fields.persistentHandle) || fields.persistentHandle < 0x81000000 || fields.persistentHandle > 0x81ffffff) {
    throw invalid('persistentHandle', 'must be inside the TPM persistent range 0x81000000–0x81ffffff');
  }
  // persistentHandle بارامترٌ لا مقبضٌ ثالثٌ (Part 3 §30: مقبضانِ فقط ثمّ البرامترات) —
  // وضعُهُ مقبضًا يجعلُ المحاكيَ يقرؤُهُ authorizationSizeً فيرفضُ الأمرَ بـTPM_RC_SIZE.
  const parameters = u32(fields.persistentHandle);
  const command = assemble({
    tag: TPM_ST.SESSIONS,
    commandCode: TPM_CC.EvictControl,
    handles: [u32(TPM_RH.OWNER), u32(fields.objectHandle)],
    authorization: authorizationArea(fields.session),
    parameters,
  });
  return {
    command,
    descriptor: {
      commandCode: TPM_CC.EvictControl,
      tag: TPM_ST.SESSIONS,
      responseHandleCount: 0,
      mutating: true,
      allowNoSessionsResponse: false,
      sessions: [/** @type {any} */ (fields.session).descriptor],
    },
    parameters,
    cpHash: cpHash(TPM_CC.EvictControl, [permanentName(TPM_RH.OWNER), fields.objectName ?? u32(fields.objectHandle)], parameters),
  };
}

// ——— تحليلُ `TPMT_PUBLIC` (لقراءةِ مفتاحِ EK العامّ من ردِّ T4/T5) ———

/**
 * يحلّلُ `TPMT_PUBLIC` (بدونَ بادئةِ الطولِ) لنوعَي RSA وECC، ويتحقّقُ من nameAlg.
 * لا يقبلُ بايتاتٍ زائدةً (قراءةٌ بالأطوالِ المعلنةِ فقط).
 * @param {Buffer} bytes
 * @returns {{ type: number, nameAlg: number, objectAttributes: number, uniqueOffset: number, rsa?: { keyBits: number, exponent: number, modulus: Buffer }, ecc?: { curveId: number, x: Buffer, y: Buffer }, publicBytes: Buffer }}
 */
export function parseTpmtPublic(bytes) {
  if (!isBuffer(bytes) || bytes.length < 12) throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'TPMT_PUBLIC', 'too short');
  let off = 0;
  const take = (/** @type {number} */ n) => {
    if (off + n > bytes.length) throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'TPMT_PUBLIC', 'truncated');
    const b = bytes.subarray(off, off + n);
    off += n;
    return b;
  };
  const type = take(2).readUInt16BE(0);
  const nameAlg = take(2).readUInt16BE(0);
  const objectAttributes = take(4).readUInt32BE(0);
  const authPolicyLen = take(2).readUInt16BE(0);
  take(authPolicyLen);
  if (type === TPM_ALG.RSA) {
    const symAlg = take(2).readUInt16BE(0);
    if (symAlg === TPM_ALG.AES) {
      take(2);
      take(2);
    } else if (symAlg !== TPM_ALG.NULL) {
      throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'symmetric', `alg 0x${symAlg.toString(16)}`);
    }
    const scheme = take(2).readUInt16BE(0);
    if (scheme !== TPM_ALG.NULL) {
      throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'scheme', `alg 0x${scheme.toString(16)}`);
    }
    const keyBits = take(2).readUInt16BE(0);
    const exponent = take(4).readUInt32BE(0);
    // WL-462: حدُّ بدايةِ حقلِ unique (بادئةُ TP2B) — يُلتقطُ هنا قبلَ قراءةِ الحقلِ نفسِه.
    const uniqueOffset = off;
    const modulusLen = take(2).readUInt16BE(0);
    const modulus = take(modulusLen);
    if (off !== bytes.length) throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'TPMT_PUBLIC', `${bytes.length - off} trailing bytes`);
    if (nameAlg !== TPM_ALG.SHA256) throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'nameAlg', 'SHA-256 only');
    // WL-462: موضعُ بدايةِ حقلِ unique — يعيدهُ التجميعُ الواعي بالتحليلِ (ekTemplateWithNonce)
    // بدلَ افتراضِ لاحقةٍ ثابتةٍ الطولِ كانَ يفسدُ القوالبَ ذاتَ unique أقصر.
    return { type, nameAlg, objectAttributes, rsa: { keyBits, exponent, modulus }, publicBytes: bytes, uniqueOffset };
  }
  if (type === TPM_ALG.ECC) {
    const symAlg = take(2).readUInt16BE(0);
    if (symAlg !== TPM_ALG.NULL) {
      throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'symmetric', 'must be NULL for ECC EK');
    }
    const scheme = take(2).readUInt16BE(0);
    if (scheme !== TPM_ALG.NULL) {
      throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'scheme', 'must be NULL');
    }
    const curveId = take(2).readUInt16BE(0);
    const kdf = take(2).readUInt16BE(0);
    if (kdf !== TPM_ALG.NULL) {
      throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'kdf', 'must be NULL');
    }
    // WL-462: حدُّ بدايةِ unique (بادئةُ TP2B لـx) — كما في فرعِ RSA أعلاه.
    const uniqueOffset = off;
    const xLen = take(2).readUInt16BE(0);
    const x = take(xLen);
    const yLen = take(2).readUInt16BE(0);
    const y = take(yLen);
    if (off !== bytes.length) throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'TPMT_PUBLIC', `${bytes.length - off} trailing bytes`);
    if (nameAlg !== TPM_ALG.SHA256) throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'nameAlg', 'SHA-256 only');
    // WL-462: موضعُ بدايةِ unique (x أولًا) — كما في فرعِ RSA أعلاه.
    return { type, nameAlg, objectAttributes, ecc: { curveId, x, y }, publicBytes: bytes, uniqueOffset };
  }
  throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'type', `unsupported 0x${type.toString(16)}`);
}

/**
 * الملحُ المعمَّلُ: RSA-OAEP بـSHA-256 وبالعلامةِ `"SECRET\0"` لمفتاحِ EK العامّ
 * (Part 1 §؛ ملحقُ هـ §4.3 صفُّ StartAuthSession).
 * @param {{ rsa?: { keyBits: number, exponent: number, modulus: Buffer }, ecc?: object, type: number, nameAlg: number, objectAttributes: number, publicBytes: Buffer }} parsed
 * @param {Buffer} salt
 */
export function encryptSaltForEk(parsed, salt) {
  assert(parsed.rsa, 'OAEP salt encryption is RSA-only in this slice');
  if (parsed.rsa.keyBits !== 2048) {
    throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'keyBits', 'EK must be RSA-2048 in this slice');
  }
  const e = parsed.rsa.exponent === 0 ? 65537 : parsed.rsa.exponent;
  if (e !== 65537) {
    throw new CommandBuilderError(COMMAND_BUILDER_ERRORS.PUBLIC_INVALID, 'exponent', 'EK exponent must be 65537');
  }
  const expBytes = Buffer.from([0x01, 0x00, 0x01]); // 65537 big-endian
  const jwk = {
    kty: 'RSA',
    n: parsed.rsa.modulus.toString('base64url'),
    e: expBytes.toString('base64url'),
  };
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  return publicEncrypt(
    { key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: Buffer.from('SECRET\0') },
    salt,
  );
}
