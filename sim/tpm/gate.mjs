/**
 * G2-3 (الوحدةُ الثانية) — البوّابةُ (L-C): آلةُ حالاتِ الاتّصالِ المغلقةُ فوقَ G2-1/G2-2.
 *
 * **العقدُ (الملحقُ هـ لـADR 0007 §4.3، التنقيحُ السادس):**
 * - الوضعُ (تشغيلٌ أو مراسم) يُثبَّتُ عندَ الإنشاءِ، والحالةُ تتقدّمُ داخلَ الاتّصالِ
 *   في اتّجاهٍ واحدٍ ولا ترجعُ: `bootstrap ──(ردُّ ن2 متحقَّقٌ منه لأمرِ الإثباتِ P0
 *   وحدَه)──▶ salted ──(نجاحُ C1 كاملًا)──▶ confirmed`. أيُّ فشلٍ أو انقطاعٍ يُغلقُ
 *   الاتّصالَ، والاتّصالُ الجديدُ يبدأُ من `bootstrap`.
 * - «أيُّ أمرٍ خارجَ قائمةِ الوضعِ يُرفَضُ قبلَ الإرسال» — كلُّ صفٍّ هنا يتحقّقُ من
 *   الحالةِ والشروطِ المسبقةِ **قبلَ** بناءِ أيِّ بايتٍ، والبوّابةُ لا تقبلُ بايتاتِ
 *   أمرٍ جاهزةً من طبقةٍ أعلى (تبنيها من حقولٍ مسمّاةٍ عبرَ `command_builder`).
 * - P0 محاولةٌ واحدة: تُعلَّمُ مُرسَلةً **قبلَ** أوّلِ `await`، وأيُّ شكلٍ آخرَ غيرِ ن2
 *   متحقَّقٍ منه (HMAC بـsessionKey، السماتُ 0x81، rc=0) يُغلقُ الاتّصالَ بـ
 *   `FRESHNESS_TPM_IDENTITY_UNPROVEN` بلا محاولةٍ ثانية.
 * - قاعدةُ التنقيحِ الخامسِ (R5-01): لا أمرَ يحملُ جلسةً في `bootstrap` غيرِ P0 —
 *   فالجلسةُ المملّحةُ لا تُبلّغُ `salted` إلا عبرَ P0 (إثباتُ التنقيحِ السادسِ نفسِه).
 * - C1: مجموعةُ المقابضِ تساوي ما رآهُ T1 بالضبط، وكلُّ منطقةٍ عامّةٍ وكلُّ محتوى وكلُّ
 *   `TPMT_PUBLIC` يساوي بايتاتِ التمهيدِ بالضبط؛ بصمةُ الهويّةِ من بايتاتِ C1.
 *
 * **ما هذهِ الحزمةُ تنفّذُهُ فعلًا:** صفوفَ التمهيدِ T1–T6 وP0 وC1 و`StartAuthSession`
 * (المملّحة) و`FlushContext`. صفوفُ ما بعدَ `confirmed` (الأوامرُ المُغيِّرةُ وجلساتُ
 * السياسةِ) **غيرُ منفَّذةٍ** وتُرفَضُ قبلَ الإرسالِ بـ`ROW_NOT_IMPLEMENTED` — بلا ادّعاءِ
 * اكتمالِ G2.
 *
 * **حدودُ الصدق:** محاكاةٌ وتصميمٌ على `sim/`؛ لا تُثبتُ جاهزيةَ عتادٍ ولا تُغيّرُ
 * `SUPPORTED_FRESHNESS_BACKENDS` (تبقى فارغةً؛ قرارُ NO-GO قائمٌ).
 */

import { randomBytes } from 'node:crypto';
import { strict as assert } from 'node:assert';
import * as builder from './command_builder.mjs';
import { parseResponse, sessionKeyFor } from './response_parser.mjs';
import { verifyEkIdentity } from './ek_identity.mjs';

export const GATE_ERRORS = Object.freeze({
  OPTIONS_INVALID: 'GATE_OPTIONS_INVALID',
  STATE_INVALID: 'GATE_STATE_INVALID',
  PRECONDITION_FAILED: 'GATE_PRECONDITION_FAILED',
  DUPLICATE_ATTEMPT: 'GATE_DUPLICATE_ATTEMPT',
  ROW_NOT_IMPLEMENTED: 'GATE_ROW_NOT_IMPLEMENTED',
  CONNECTION_CLOSED: 'GATE_CONNECTION_CLOSED',
  IDENTITY_UNPROVEN: 'FRESHNESS_TPM_IDENTITY_UNPROVEN',
});

class GateError extends Error {
  /**
   * @param {string} code من `GATE_ERRORS`
   * @param {string} row الصفُّ الذي رُفض
   * @param {string} detail
   */
  constructor(code, row, detail) {
    super(`${code} [${row}]: ${detail}`);
    this.name = 'GateError';
    this.code = code;
    this.row = row;
    this.detail = detail;
  }
}

/** أقصى عددِ صفحاتِ جردٍ في اتّصالٍ واحدٍ (حدُّ الوقايةِ من الاستنزافِ، لا من المواصفة). */
const MAX_INVENTORY_PAGES = 64;
/** حدُّ محاولاتِ إعادةِ القراءةِ (§4.4: ثلاثٌ على الأكثرِ لـRETRY/YIELDED). */
const MAX_READ_RETRIES = 3;

/**
 * @typedef {'bootstrap' | 'salted' | 'confirmed'} GateState
 * @typedef {{ submit(commandBytes: Uint8Array): Promise<Buffer> }} GateTransport
 * @typedef {{ transport: GateTransport, mode: 'operation' | 'ceremony', ekIdentity: { certificatePem: string, caPem: string }, persistentEkHandle?: number | null }} GateOptions
 */

/** تحويلُ خطأٍ مجهولٍ إلى نصٍّ بلا كشفِ غيرِ المعلومةِ المقصودةِ. @param {unknown} e */
function errorText(e) {
  return String(e instanceof Error ? e.message : e);
}

/** الجلسةُ الأولى المُتحقَّقُ منها في ردِّ ن2 — الردُّ بلا جلسةٍ يُغلقُ الاتصال.
 * @param {import('./response_parser.mjs').ParsedResponse} parsed @param {string} row
 * @returns {{ nonceTPM: Buffer, attrs: number }} */
function verifiedSession0(parsed, row) {
  assert(parsed.form === 'n2', `${row} response must be n2`);
  const sess = parsed.sessions[0];
  assert(sess !== undefined, `${row} response must carry the verified session`);
  return sess;
}

/**
 * البوّابةُ. تُنشأ لكلِّ اتّصالٍ واحدٍ، ولا تُعيدُ استخدامُها بعدَ الإغلاقِ.
 */
export class FreshnessGate {
  /**
   * @param {GateOptions} options — نقلُ G2-1، ووضعٌ يُثبَّتُ عندَ الإنشاءِ ولا يتغيّر،
   *   ومدخلاتُ التحقّقِ §3.2-2 (شهادةُ EK وسلسلتُها)، ومقبضُ EK المستمرُّ المعلنُ في الإعدادِ (T4) أو `null`.
   */
  constructor(options) {
    const transport = options?.transport;
    if (!options || !transport || typeof transport.submit !== 'function') {
      throw new GateError(GATE_ERRORS.OPTIONS_INVALID, 'constructor', 'a G2-1 transport with submit() is required');
    }
    if (options.mode !== 'operation' && options.mode !== 'ceremony') {
      throw new GateError(GATE_ERRORS.OPTIONS_INVALID, 'mode', `must be 'operation' or 'ceremony': ${String(options.mode)}`);
    }
    if (!options.ekIdentity || typeof options.ekIdentity.certificatePem !== 'string' || typeof options.ekIdentity.caPem !== 'string') {
      throw new GateError(GATE_ERRORS.OPTIONS_INVALID, 'ekIdentity', 'EK certificate and CA PEM are required for §3.2-2');
    }
    if (options.persistentEkHandle !== undefined && options.persistentEkHandle !== null && !Number.isInteger(options.persistentEkHandle)) {
      throw new GateError(GATE_ERRORS.OPTIONS_INVALID, 'persistentEkHandle', 'must be an integer or null');
    }
    this.transport = transport;
    this.mode = options.mode;
    this.ekIdentity = options.ekIdentity;
    this.persistentEkHandle = options.persistentEkHandle ?? null;

    /** @type {GateState} */ this.state = 'bootstrap';
    this.closed = false;
    this.closeReason = null;
    /** @type {{ complete: boolean, handles: number[] }} */
    this.t1 = { complete: false, handles: [] };
    this.nvBufferMax = null;
    /** @type {Map<number, { nvPublic: Buffer, dataSize: number, content: Buffer }>} */
    this.bootstrapReads = new Map();
    /** @type {{ handle: number, outPublic: Buffer, name: Buffer, parsed: ReturnType<typeof builder.parseTpmtPublic> } | null} */
    this.ek = null;
    this.ekVerified = false;
    /** @type {{ handle: number, nonceTPM: Buffer, sessionKey: Buffer, nonceCaller: Buffer, salt: Buffer } | null} */
    this.saltedSession = null;
    this.startAuthSessionCount = 0;
    this.createPrimaryCount = 0;
    this.p0Reserved = false;
    this.p0Used = false;
    /** @type {{ handles: number[], moreData: boolean } | null} */
    this.p0Page = null;
    /** مقابضُ أنشأها هذا المُكيِّفُ في هذا الاتّصالِ (دفترُ FlushContext). */
    this.createdHandles = new Set();
    /** @type {Set<number>} مقابضُ مستهلَكة (FlushContext أُرسلَ لها ولو فشلَت). */
    this.consumedHandles = new Set();
  }

  // ——— الإغلاقُ والرفضُ المسبق ———

  /** @param {string} code @param {string} row @param {string} detail @returns {never} */
  fail(code, row, detail) {
    this.closed = true;
    this.closeReason = { code, row, detail };
    throw new GateError(code, row, detail);
  }

  /** @param {string} row @returns {void} */
  assertOpen(row) {
    if (this.closed) {
      throw new GateError(GATE_ERRORS.CONNECTION_CLOSED, row, `connection closed by ${this.closeReason?.code ?? 'unknown'} [${this.closeReason?.row ?? '?'}]`);
    }
  }

  /** @param {GateState} state @param {string} row @returns {void} */
  requireState(state, row) {
    if (this.state !== state) {
      throw new GateError(GATE_ERRORS.STATE_INVALID, row, `row requires state=${state}, current=${this.state}`);
    }
  }

  // ——— إرسالٌ معَ إعادةِ القراءةِ فقط (§4.4) ———

  /**
   * يرسلُ ويُحلِّلُ. الأوامرُ القرائيّةُ فقطَ تُعادُ لـRETRY/YIELDED بثلاثِ محاولاتٍ
   * على الأكثر؛ ما عدا ذلكَ نتيجةٌ نهائيّة. أيُّ خطأِ نقلٍ أو تحليلٍ يُغلقُ الاتّصالَ.
   * @template T
   * @param {{ row: string, build: () => { command: Uint8Array, descriptor: import('./response_parser.mjs').CommandDescriptor }, parse: (parsed: import('./response_parser.mjs').ParsedResponse) => T, readRetry?: (parsed: import('./response_parser.mjs').ParsedResponse) => boolean }} spec
   * @returns {Promise<T>}
   */
  async exchange(spec) {
    this.assertOpen(spec.row);
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const built = spec.build();
      let frame;
      try {
        frame = await this.transport.submit(built.command);
      } catch (e) {
        this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, spec.row, `transport error: ${errorText(e)}`);
      }
      let parsed;
      try {
        parsed = parseResponse(frame, built.descriptor);
      } catch (e) {
        this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, spec.row, `unparseable response: ${errorText(e)}`);
      }
      if (parsed.form === 'error') {
        const retryable = typeof spec.readRetry === 'function' && spec.readRetry(parsed);
        if (retryable && attempt + 1 < MAX_READ_RETRIES) {
          attempt += 1;
          continue;
        }
        this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, spec.row, `error response rc=0x${parsed.rc.toString(16)}${parsed.fatal ? ' (fatal)' : ''}`);
      }
      let outcome;
      try {
        outcome = spec.parse(parsed);
      } catch (e) {
        if (e instanceof GateError) throw e;
        this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, spec.row, `response rejected: ${errorText(e)}`);
      }
      return outcome;
    }
  }

  /** الجلسةُ المملّحةُ كمدخلٍ لبنّاءِ الأوامرِ — بلا كشفِ sessionKey خارجَ البوّابة. */
  saltedHmacSession(/** @type {Buffer} */ cpHash, /** @type {number} */ attrs) {
    assert(this.saltedSession, 'salted session required');
    return builder.hmacSession({
      handle: this.saltedSession.handle,
      nonceCaller: this.saltedSession.nonceCaller,
      nonceTPM: this.saltedSession.nonceTPM,
      attrs,
      sessionKey: this.saltedSession.sessionKey,
      authValue: Buffer.alloc(0),
      cpHash,
    });
  }

  // ——— صفوفُ التمهيدِ (T1–T6) ———

  /**
   * T1 — جردُ مقابضِ مجالِ EK بصفحاتٍ (الاكتمالُ بـ`moreData` = NO وحدَه).
   * @returns {Promise<{ handles: number[] }>}
   */
  async t1Inventory() {
    this.assertOpen('T1');
    this.requireState('bootstrap', 'T1');
    if (this.t1.complete) {
      throw new GateError(GATE_ERRORS.DUPLICATE_ATTEMPT, 'T1', 'inventory already complete in this connection');
    }
    const handles = [];
    let property = builder.EK_NV_RANGE.first;
    for (let page = 0; page < MAX_INVENTORY_PAGES; page += 1) {
      const result = await this.exchange({
        row: 'T1',
        build: () => builder.buildGetCapability({
          capability: builder.TPM_CAP.HANDLES,
          property,
          propertyCount: builder.T1_PAGE_MAX_COUNT,
        }),
        parse: (parsed) => parseGetCapabilityHandles(parsed, 'T1'),
        readRetry: (parsed) => parsed.form === 'error' && parsed.retryable,
      });
      for (const h of result.handles) {
        if (h > builder.EK_NV_RANGE.last) break; // أوّلُ مقبضٍ أعلى من المجالِ ينهيهِ ولا يُستعمل
        handles.push(h);
      }
      if (!result.moreData) {
        this.t1 = { complete: true, handles };
        return { handles: [...handles] };
      }
      const last = result.handles[result.handles.length - 1];
      if (last === undefined) {
        this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, 'T1', 'moreData=YES with an empty page is contradictory');
      }
      property = last + 1;
      if (property > builder.EK_NV_RANGE.last) {
        // استنفدنا المجالَ بترقيةِ الصفحة؛ الاكتمالُ هنا غيرُ قابلٍ للتمييزِ عن
        // صفحةٍ فارغةٍ قادمة، فنطلبُها صراحةً لتوثيقِ moreData = NO.
        const finalPage = await this.exchange({
          row: 'T1',
          build: () => builder.buildGetCapability({
            capability: builder.TPM_CAP.HANDLES,
            property: builder.EK_NV_RANGE.last,
            propertyCount: 1,
          }),
          parse: (parsed) => parseGetCapabilityHandles(parsed, 'T1'),
          readRetry: (p) => p.form === 'error' && p.retryable,
        });
        assert(!finalPage.moreData, 'T1: range end must terminate paging');
        this.t1 = { complete: true, handles };
        return { handles: [...handles] };
      }
    }
    this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, 'T1', `inventory exceeded ${MAX_INVENTORY_PAGES} pages`);
  }

  /** T6 — قراءةُ `TPM_PT_NV_BUFFER_MAX` (لا يُخمَّن). */
  async t6nvBufferMax() {
    this.assertOpen('T6');
    this.requireState('bootstrap', 'T6');
    const value = await this.exchange({
      row: 'T6',
      build: () => builder.buildGetCapability({
        capability: builder.TPM_CAP.TPM_PROPERTIES,
        property: builder.TPM_PT_NV_BUFFER_MAX,
        propertyCount: 1,
      }),
      parse: (parsed) => parseTpmProperty(parsed, 'T6', builder.TPM_PT_NV_BUFFER_MAX),
      readRetry: (p) => p.form === 'error' && p.retryable,
    });
    this.nvBufferMax = value;
    return value;
  }

  /**
   * T2 — `NV_ReadPublic` لفهرسٍ من الستّةِ **ظهرَ في T1**.
   * @param {{ nvIndex: number }} fields
   * @returns {Promise<{ nvPublic: Buffer, dataSize: number }>}
   */
  async t2nvReadPublic(fields) {
    this.assertOpen('T2');
    this.requireState('bootstrap', 'T2');
    if (!builder.EK_NV_RANGE.indices.includes(fields.nvIndex)) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'T2', `nvIndex 0x${fields.nvIndex.toString(16)} outside the six EK indices`);
    }
    if (!this.t1.complete || !this.t1.handles.includes(fields.nvIndex)) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'T2', `nvIndex 0x${fields.nvIndex.toString(16)} did not appear in T1`);
    }
    const result = await this.exchange({
      row: 'T2',
      build: () => builder.buildNvReadPublic({ nvIndex: fields.nvIndex }),
      parse: (parsed) => {
        assert(parsed.form === 'n1', 'T2 response must be n1');
        return parseNvReadPublic(parsed.parameters, 'T2');
      },
      readRetry: (p) => p.form === 'error' && p.retryable,
    });
    const prev = this.bootstrapReads.get(fields.nvIndex);
    this.bootstrapReads.set(fields.nvIndex, {
      nvPublic: result.nvPublic,
      dataSize: result.dataSize,
      content: prev?.content ?? Buffer.alloc(0),
    });
    return result;
  }

  /**
   * T3 — `NV_Read` بـ`TPM_RS_PW` وحدَها (مدخلٌ غيرُ موثوق؛ يُثبَتُ في C1).
   * @param {{ nvIndex: number, size: number, offset: number }} fields
   */
  async t3nvRead(fields) {
    this.assertOpen('T3');
    this.requireState('bootstrap', 'T3');
    const stored = this.bootstrapReads.get(fields.nvIndex);
    if (!stored) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'T3', `T2 for nvIndex 0x${fields.nvIndex.toString(16)} must precede T3`);
    }
    if (this.nvBufferMax === null) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'T3', 'T6 (NV_BUFFER_MAX) must precede T3');
    }
    if (fields.size > this.nvBufferMax) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'T3', `size ${fields.size} > TPM_PT_NV_BUFFER_MAX ${this.nvBufferMax}`);
    }
    if (fields.offset + fields.size > stored.dataSize) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'T3', `offset+size ${fields.offset + fields.size} > dataSize ${stored.dataSize}`);
    }
    const name = builder.nvIndexName(stored.nvPublic, builder.TPM_ALG.SHA256);
    const result = await this.exchange({
      row: 'T3',
      build: () => builder.buildNvRead({
        authHandle: fields.nvIndex,
        nvIndex: fields.nvIndex,
        size: fields.size,
        offset: fields.offset,
        session: builder.passwordSession(),
        handleNames: [name, name],
      }),
      parse: (parsed) => {
        assert(parsed.form === 'n3', 'T3 response must be n3 (TPM_RS_PW)');
        const r = new ResponseReader(parsed.parameters, 'T3');
        const data = r.tpm2b();
        r.end();
        return data;
      },
      readRetry: (p) => p.form === 'error' && p.retryable,
    });
    stored.content = Buffer.concat([stored.content.subarray(0, fields.offset), result, stored.content.subarray(fields.offset + result.length)]);
    return result;
  }

  /** T4 — `ReadPublic` لمقبضِ EK المستمرِّ المعلنِ في الإعدادِ وحدَه. */
  async t4readPublic() {
    this.assertOpen('T4');
    this.requireState('bootstrap', 'T4');
    if (this.persistentEkHandle === null) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'T4', 'no persistent EK handle declared in settings');
    }
    const ekHandle = this.persistentEkHandle;
    assert(ekHandle !== null, 'T4 requires a declared persistent EK handle');
    const rp = await this.exchange({
      row: 'T4',
      build: () => builder.buildReadPublic({ objectHandle: ekHandle }),
      parse: (parsed) => {
        assert(parsed.form === 'n1', 'T4 response must be n1');
        return parseReadPublic(parsed.parameters, 'T4');
      },
      readRetry: (p) => p.form === 'error' && p.retryable,
    });
    this.ek = {
      handle: this.persistentEkHandle,
      outPublic: rp.outPublic,
      name: rp.name,
      parsed: builder.parseTpmtPublic(rp.outPublic),
    };
    return { outPublic: rp.outPublic };
  }

  /**
   * T5 — `CreatePrimary` مرّةً واحدةً في الاتّصالِ، بعدَ اكتمالِ T1، بقالبٍ من حالاتِ
   * §4.3 الأربعِ (يبنيهِ المستدعي من جردِ التمهيدِ غيرِ الموثَّقِ؛ يُثبَتُ أو يُرفضُ في C1).
   * @param {{ inPublic: Buffer }} fields
   * @returns {Promise<{ handle: number, outPublic: Buffer }>}
   */
  async t5createPrimary(fields) {
    this.assertOpen('T5');
    this.requireState('bootstrap', 'T5');
    if (this.createPrimaryCount > 0) {
      throw new GateError(GATE_ERRORS.DUPLICATE_ATTEMPT, 'T5', 'CreatePrimary once per connection');
    }
    if (!this.t1.complete) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'T5', 'T1 must complete before T5');
    }
    // تحقّقٌ شكليٌّ قبلَ البناءِ: القالبُ يُحلَّلُ `TPMT_PUBLIC` كاملًا بلا بايتٍ زائد.
    const parsedTemplate = builder.parseTpmtPublic(fields.inPublic);
    this.createPrimaryCount += 1;
    const result = await this.exchange({
      row: 'T5',
      build: () => builder.buildCreatePrimary({ inPublic: fields.inPublic, session: builder.passwordSession() }),
      parse: (parsed) => {
        assert(parsed.form === 'n3', 'T5 response must be n3 (TPM_RS_PW)');
        assert(parsed.handles.length === 1, 'T5 response must carry the transient handle');
        const r = parseCreatePrimary(parsed.parameters, 'T5');
        const handle = parsed.handles[0];
        assert(handle !== undefined, 'T5 response must carry the transient handle');
        return { handle, outPublic: r.outPublic, name: r.name };
      },
      readRetry: (p) => p.form === 'error' && p.retryable,
    });
    this.createdHandles.add(result.handle);
    this.ek = {
      handle: result.handle,
      outPublic: result.outPublic,
      name: result.name,
      parsed: builder.parseTpmtPublic(result.outPublic),
    };
    void parsedTemplate;
    return result;
  }

  /**
   * §3.2-2 — التحقّقُ من هويّةِ EK: سلسلةُ الشهادةِ وتطابقُ `SubjectPublicKeyInfo`
   * معَ المفتاحِ العامّ من T4/T5. تُستدعى بعدَ T4 أو T5 وقبلَ `StartAuthSession`.
   */
  verifyEkIdentity() {
    this.assertOpen('§3.2-2');
    this.requireState('bootstrap', '§3.2-2');
    if (!this.ek) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, '§3.2-2', 'T4 or T5 must provide the EK public first');
    }
    try {
      verifyEkIdentity({
        certificatePem: this.ekIdentity.certificatePem,
        caPem: this.ekIdentity.caPem,
        ekPublic: this.ek.outPublic,
      });
    } catch (e) {
      this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, '§3.2-2', errorText(e));
    }
    this.ekVerified = true;
    return true;
  }

  /**
   * `StartAuthSession` المملّحةُ — مرّةً واحدةً في الاتّصالِ، HMAC وحدَها، غيرُ مربوطة،
   * `tpmKey` = مقبضُ EK الذي اجتازَ §3.2-2. **لا تُغيّرُ الحالة** (الانتقالُ بـP0 وحدَه).
   */
  async startAuthSession() {
    this.assertOpen('StartAuthSession');
    this.requireState('bootstrap', 'StartAuthSession');
    if (this.startAuthSessionCount > 0) {
      throw new GateError(GATE_ERRORS.DUPLICATE_ATTEMPT, 'StartAuthSession', 'once per connection');
    }
    if (!this.ekVerified || !this.ek) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'StartAuthSession', 'EK must pass §3.2-2 before salting');
    }
    this.startAuthSessionCount += 1;
    const gateEk = this.ek;
    assert(gateEk !== null, 'StartAuthSession requires the EK');
    const salt = randomBytes(32);
    const nonceCaller = randomBytes(32);
    const encryptedSalt = builder.encryptSaltForEk(gateEk.parsed, salt);
    const result = await this.exchange({
      row: 'StartAuthSession',
      build: () => builder.buildStartAuthSession({
        tpmKey: gateEk.handle,
        bind: builder.TPM_RH.NULL,
        nonceCaller,
        encryptedSalt,
        sessionType: builder.TPM_SE.HMAC,
      }),
      parse: (parsed) => {
        assert(parsed.form === 'n1', 'StartAuthSession response must be n1');
        assert(parsed.handles.length === 1, 'StartAuthSession response must carry the session handle');
        const r = new ResponseReader(parsed.parameters, 'StartAuthSession');
        const nonceTPM = r.tpm2b();
        r.end();
        assert(nonceTPM.length === 32, 'nonceTPM must be 32 bytes (SHA-256 session)');
        const handle = parsed.handles[0];
        assert(handle !== undefined, 'StartAuthSession response must carry the session handle');
        return { handle, nonceTPM };
      },
    });
    this.createdHandles.add(result.handle);
    this.saltedSession = {
      handle: result.handle,
      nonceTPM: result.nonceTPM,
      nonceCaller,
      salt,
      sessionKey: sessionKeyFor(salt, result.nonceTPM, nonceCaller),
    };
    return { handle: result.handle };
  }

  /**
   * P0 — أمرُّ الإثباتِ (التنقيحُ السادس): `GetCapability(HANDLES)` بالجلسةِ المملّحةِ
   * بسماتِ 0x81. ردُّ ن2 متحقَّقٌ منه (يُثبِتُهُ المحلِّلُ بـsessionKey) **وحدَه** ينقلُ إلى
   * `salted`. محاولةٌ واحدة: تُحجَزُ **قبلَ** أوّلِ `await`.
   */
  async p0Attest() {
    this.assertOpen('P0');
    this.requireState('bootstrap', 'P0');
    if (this.p0Reserved) {
      throw new GateError(GATE_ERRORS.DUPLICATE_ATTEMPT, 'P0', 'single attempt per connection (reserved)');
    }
    if (!this.saltedSession) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'P0', 'StartAuthSession must precede P0');
    }
    if (!this.t1.complete) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'P0', 'T1 must complete before P0');
    }
    this.p0Reserved = true; // الحجزُ قبلَ أيِّ انتظارٍ — محاولةٌ واحدةٌ لا تتنافس
    const built = builder.buildGetCapability({
      capability: builder.TPM_CAP.HANDLES,
      property: builder.EK_NV_RANGE.first,
      propertyCount: builder.T1_PAGE_MAX_COUNT,
    });
    const session = builder.hmacSession({
      handle: this.saltedSession.handle,
      nonceCaller: this.saltedSession.nonceCaller,
      nonceTPM: this.saltedSession.nonceTPM,
      attrs: builder.SESSION_ATTRS.AUDIT_CONTINUE,
      sessionKey: this.saltedSession.sessionKey,
      authValue: Buffer.alloc(0),
      cpHash: built.cpHash,
    });
    const result = await this.exchange({
      row: 'P0',
      build: () => builder.buildGetCapability({
        capability: builder.TPM_CAP.HANDLES,
        property: builder.EK_NV_RANGE.first,
        propertyCount: builder.T1_PAGE_MAX_COUNT,
        session,
      }),
      parse: (parsed) => {
        assert(parsed.form === 'n2', `P0 response must be n2, got ${String(parsed.form)}`);
        const page = parseGetCapabilityHandles(parsed, 'P0');
        return { page, verifiedNonce: verifiedSession0(parsed, 'n2').nonceTPM };
      },
    });
    // ن2 متحقَّقٌ منه — تحديثُ nonceTPM المحفوظة (§4.4: بعدَ التحقّقِ وحدَه).
    this.saltedSession.nonceTPM = result.verifiedNonce;
    this.p0Used = true;
    this.state = 'salted';
    this.p0Page = { handles: [...result.page.handles], moreData: result.page.moreData };
    return { handles: [...result.page.handles] };
  }

  /**
   * C1 — التأكيدُ داخلَ `salted`: تكملةُ صفحاتِ الجردِ من ردِّ P0 نفسِهِ، ومطابقةُ
   * مجموعةِ المقابضِ معَ T1 بالضبط، ثمّ `NV_ReadPublic`/`NV_Read` لكلِّ فهرسٍ ظهرَ
   * و`ReadPublic` لمقبضِ EK، ومطابقةُ كلِّ بايت. النجاحُ الكاملُ وحدَهُ يُبلّغُ `confirmed`.
   */
  async c1Confirm() {
    this.assertOpen('C1');
    this.requireState('salted', 'C1');
    assert(this.p0Page, 'C1 requires P0');
    assert(this.saltedSession, 'C1 requires the salted session');

    const handles = [...this.p0Page.handles];
    if (this.p0Page.moreData) {
      let property = (handles[handles.length - 1] ?? builder.EK_NV_RANGE.first - 1) + 1;
      for (let page = 0; page < MAX_INVENTORY_PAGES; page += 1) {
        const built = builder.buildGetCapability({
          capability: builder.TPM_CAP.HANDLES,
          property,
          propertyCount: builder.T1_PAGE_MAX_COUNT,
        });
        const session = this.saltedHmacSession(built.cpHash, builder.SESSION_ATTRS.AUDIT_CONTINUE);
        const result = await this.exchange({
          row: 'C1',
          build: () => builder.buildGetCapability({
            capability: builder.TPM_CAP.HANDLES,
            property,
            propertyCount: builder.T1_PAGE_MAX_COUNT,
            session,
          }),
          parse: (parsed) => {
            assert(parsed.form === 'n2', 'C1 inventory page must be n2');
            const p = parseGetCapabilityHandles(parsed, 'C1');
            return { page: p, verifiedNonce: verifiedSession0(parsed, 'n2').nonceTPM };
          },
        });
    this.saltedSession.nonceTPM = result.verifiedNonce;
        for (const h of result.page.handles) {
          if (h > builder.EK_NV_RANGE.last) break;
          handles.push(h);
        }
        if (!result.page.moreData) break;
        const last = result.page.handles[result.page.handles.length - 1];
        if (last === undefined) {
          this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, 'C1', 'moreData=YES with an empty page is contradictory');
        }
        property = last + 1;
      }
    }
    const c1Set = [...new Set(handles)].sort((a, b) => a - b);
    const t1Set = [...new Set(this.t1.handles)].sort((a, b) => a - b);
    if (c1Set.length !== t1Set.length || c1Set.some((h, i) => h !== t1Set[i])) {
      this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, 'C1', `handle set differs from T1: C1=[${c1Set.map(hex)}] T1=[${t1Set.map(hex)}]`);
    }

    // بصمةُ الهويّةِ من بايتاتِ C1 لا من بايتاتِ التمهيدِ (§4.3).
    const identityBytes = [];
    for (const nvIndex of c1Set) {
      // اسمُ الفهرسِ (nameAlg‖H(nvPublic)) مطلوبٌ في cpHash للجلسةِ المملّحةِ (Part 1 §18.7)،
      // ويُؤخَذُ من قراءةِ التمهيدِ T2 — قبلَ بناءِ الجلسةِ.
      const stored = this.bootstrapReads.get(nvIndex);
      if (!stored) {
        this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, 'C1', `index 0x${nvIndex.toString(16)} appeared in C1 but has no bootstrap read`);
      }
      const indexName = builder.nvIndexName(stored.nvPublic, builder.TPM_ALG.SHA256);
      const readPublicBuilt = builder.buildNvReadPublic({ nvIndex, indexName });
      const rpSession = this.saltedHmacSession(readPublicBuilt.cpHash, builder.SESSION_ATTRS.AUDIT_CONTINUE);
      const pub = await this.exchange({
        row: 'C1',
        build: () => builder.buildNvReadPublic({ nvIndex, indexName, session: rpSession }),
        parse: (parsed) => {
          assert(parsed.form === 'n2', 'C1 NV_ReadPublic must be n2');
          return { read: parseNvReadPublic(parsed.parameters, 'C1'), verifiedNonce: verifiedSession0(parsed, 'n2').nonceTPM };
        },
      });
      this.saltedSession.nonceTPM = pub.verifiedNonce;
      identityBytes.push(pub.read.nvPublic);

      if (!pub.read.nvPublic.equals(stored.nvPublic)) {
        this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, 'C1', `nvPublic of 0x${nvIndex.toString(16)} differs from T2 by a byte`);
      }

      const name = builder.nvIndexName(pub.read.nvPublic, builder.TPM_ALG.SHA256);
      const nvReadCp = builder.nvReadCpHash([name, name], stored.dataSize, 0);
      const authSession = this.saltedHmacSession(nvReadCp, builder.SESSION_ATTRS.CONTINUE);
      const content = await this.exchange({
        row: 'C1',
        build: () => builder.buildNvRead({
          authHandle: nvIndex,
          nvIndex,
          size: stored.dataSize,
          offset: 0,
          handleNames: [name, name],
          session: authSession,
        }),
        parse: (parsed) => {
          assert(parsed.form === 'n2', 'C1 NV_Read must be n2');
          const r = new ResponseReader(parsed.parameters, 'C1');
          const data = r.tpm2b();
          r.end();
          return { data, verifiedNonce: verifiedSession0(parsed, 'n2').nonceTPM };
        },
      });
      this.saltedSession.nonceTPM = content.verifiedNonce;
      identityBytes.push(content.data);
      if (!content.data.equals(stored.content)) {
        this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, 'C1', `content of 0x${nvIndex.toString(16)} differs from T3 by a byte`);
      }
    }

    assert(this.ek !== null, 'C1 requires the EK');
    const gateEk = this.ek;
    // cpHash للجلسةِ يستخدمُ اسمَ EK (nameAlg‖H(public)) من ردِّ التمهيدِ — لا بايتاتِ المقبضِ (§18.7).
    const readPublicBuilt = builder.buildReadPublic({ objectHandle: gateEk.handle, objectName: gateEk.name });
    const ekSession = this.saltedHmacSession(readPublicBuilt.cpHash, builder.SESSION_ATTRS.AUDIT_CONTINUE);
    const ek = await this.exchange({
      row: 'C1',
      build: () => builder.buildReadPublic({ objectHandle: gateEk.handle, objectName: gateEk.name, session: ekSession }),
      parse: (parsed) => {
        assert(parsed.form === 'n2', 'C1 ReadPublic must be n2');
        return { outPublic: parseReadPublic(parsed.parameters, 'C1').outPublic, verifiedNonce: verifiedSession0(parsed, 'n2').nonceTPM };
      },
    });
    this.saltedSession.nonceTPM = ek.verifiedNonce;
    identityBytes.push(ek.outPublic);
    if (!ek.outPublic.equals(this.ek.outPublic)) {
      this.fail(GATE_ERRORS.IDENTITY_UNPROVEN, 'C1', 'EK public differs from the bootstrap read by a byte');
    }

    this.state = 'confirmed';
    this.identityFingerprint = Buffer.concat(identityBytes).toString('hex');
    return { handles: c1Set, identityFingerprint: this.identityFingerprint };
  }

  /**
   * `FlushContext` — المقبضُ يجبُ أن يكونَ أنشأهُ هذا المُكيِّفُ في هذا الاتّصالِ.
   * في `salted`: لا تُفرَّغُ الجلسةُ المملّحةُ نفسُها ولا مقبضُ EK قبلَ نجاحِ C1 (WL-447).
   * النجاحُ لا يُعتمدُ والمقبضُ مستهلَكٌ في الحالتَينِ (§4.4 ن1). @param {{ flushHandle: number }} fields */
  async flushContext(fields) {
    this.assertOpen('FlushContext');
    if (!Number.isInteger(fields.flushHandle)) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'FlushContext', 'flushHandle must be an integer');
    }
    if (!this.createdHandles.has(fields.flushHandle)) {
      throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'FlushContext', `handle 0x${fields.flushHandle.toString(16)} was not created by this gate in this connection`);
    }
    if (this.state === 'salted') {
      if (this.saltedSession && fields.flushHandle === this.saltedSession.handle) {
        throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'FlushContext', 'the salted session handle is not flushed before C1 succeeds (§4.3)');
      }
      if (this.ek && fields.flushHandle === this.ek.handle) {
        throw new GateError(GATE_ERRORS.PRECONDITION_FAILED, 'FlushContext', 'the salted EK handle is not flushed before C1 succeeds (WL-447)');
      }
    }
    this.consumedHandles.add(fields.flushHandle);
    await this.exchange({
      row: 'FlushContext',
      build: () => builder.buildFlushContext({ flushHandle: fields.flushHandle }),
      parse: (parsed) => {
        assert(parsed.form === 'n1', 'FlushContext response must be n1');
        return true;
      },
    });
    this.createdHandles.delete(fields.flushHandle);
    return true;
  }

  /**
   * صفوفُ ما بعدَ `confirmed` غيرُ منفَّذةٍ في هذهِ الحزمةِ — تُرفَضُ قبلَ الإرسالِ
   * بصدقٍ (لا ادّعاءَ اكتمالِ G2). الصفوفُ هي: أوامرُ التغييرِ وجلساتُ السياسةِ
   * والجلسةُ المالكيّةُ (`NV_Increment`/`NV_Write`/`NV_DefineSpace`/`PolicySigned`/...).
   */
  mutatingRow() {
    this.assertOpen('mutating-row');
    throw new GateError(
      GATE_ERRORS.ROW_NOT_IMPLEMENTED,
      'mutating-row',
      'post-confirmed rows (NV_Increment/NV_Write/policy sessions/owner session) are not implemented in G2-3 slice',
    );
  }
}

// ——— أدواتُ قراءةِ الردودِ (بالأطوالِ المعلنةِ فقط، وبلا قراءةٍ خارجَ الحدود) ———

const hex = (/** @type {number} */ n) => `0x${n.toString(16)}`;

class ResponseReader {
  /**
   * @param {Buffer} buf
   * @param {string} row
   */
  constructor(buf, row) {
    this.buf = buf;
    this.off = 0;
    this.row = row;
  }
  /** @param {number} n */
  take(n) {
    if (this.off + n > this.buf.length) {
      throw new GateError(GATE_ERRORS.IDENTITY_UNPROVEN, this.row, `truncated response parameters: need ${this.off + n}, have ${this.buf.length}`);
    }
    const b = this.buf.subarray(this.off, this.off + n);
    this.off += n;
    return b;
  }
  tpm2b() {
    const len = this.take(2).readUInt16BE(0);
    return this.take(len);
  }
  end() {
    if (this.off !== this.buf.length) {
      throw new GateError(GATE_ERRORS.IDENTITY_UNPROVEN, this.row, `${this.buf.length - this.off} trailing bytes in response parameters`);
    }
  }
}

/** `GetCapability` الردودِ: صفحاتُ المقابضِ — قيسَ على swtpm حيٍّ: الردُّ يُرجعُ مُعرّفَ القدرةِ نفسِهِ (`moreData ‖ capability ‖ TPML_HANDLE`) قبلَ الاتحادِ. @param {import('./response_parser.mjs').ParsedResponse} parsed @param {string} row @returns {{ moreData: boolean, handles: number[] }} */
function parseGetCapabilityHandles(parsed, row) {
  if (parsed.form === 'n1' || parsed.form === 'n2' || parsed.form === 'n3') {
    const r = new ResponseReader(parsed.parameters, row);
    const more = r.take(1).readUInt8(0);
    const capability = r.take(4).readUInt32BE(0);
    if (capability !== builder.TPM_CAP.HANDLES) {
      throw new GateError(GATE_ERRORS.IDENTITY_UNPROVEN, row, `capability echo 0x${capability.toString(16)} != HANDLES`);
    }
    const count = r.take(4).readUInt32BE(0);
    const handles = [];
    for (let i = 0; i < count; i += 1) handles.push(r.take(4).readUInt32BE(0));
    r.end();
    return { moreData: more === 1, handles };
  }
  throw new GateError(GATE_ERRORS.IDENTITY_UNPROVEN, row, `unexpected form ${String(parsed.form)}`);
}

/** @param {import('./response_parser.mjs').ParsedResponse} parsed @param {string} row @param {number} expectedProperty @returns {number} */
function parseTpmProperty(parsed, row, expectedProperty) {
  if (parsed.form !== 'n1' && parsed.form !== 'n2') {
    throw new GateError(GATE_ERRORS.IDENTITY_UNPROVEN, row, `unexpected form ${String(parsed.form)}`);
  }
  const r = new ResponseReader(parsed.parameters, row);
  r.take(1); // moreData — يُقرأ ويُهمَل (البنيةُ تُطابقُ صفحاتِ المقابضِ)
  const capability = r.take(4).readUInt32BE(0);
  if (capability !== builder.TPM_CAP.TPM_PROPERTIES) {
    throw new GateError(GATE_ERRORS.IDENTITY_UNPROVEN, row, `capability echo 0x${capability.toString(16)} != TPM_PROPERTIES`);
  }
  const count = r.take(4).readUInt32BE(0);
  if (count !== 1) {
    throw new GateError(GATE_ERRORS.IDENTITY_UNPROVEN, row, `property count ${count} != 1`);
  }
  const property = r.take(4).readUInt32BE(0);
  const value = r.take(4).readUInt32BE(0);
  r.end();
  // moreData=YES هنا مشروعٌ: يعني وجودَ خصائصَ تاليةٍ في الفضاءِ، لا نقصًا في قراءتِنا
  // (قيسَ على swtpm حيٍّ: يردُّ YES بعدَ PT_NV_BUFFER_MAX).
  if (property !== expectedProperty) {
    throw new GateError(GATE_ERRORS.IDENTITY_UNPROVEN, row, `property 0x${property.toString(16)} != expected 0x${expectedProperty.toString(16)}`);
  }
  return value;
}

/** @param {Buffer} parameters @param {string} row */
function parseNvReadPublic(parameters, row) {
  const r = new ResponseReader(parameters, row);
  const nvPublic = r.tpm2b();
  const nvName = r.tpm2b();
  r.end();
  // TPMS_NV_PUBLIC: nvIndex(4) nameAlg(2) attributes(4) authPolicy(TPM2B) dataSize(2)
  const p = new ResponseReader(nvPublic, row);
  const nvIndex = p.take(4).readUInt32BE(0);
  const nameAlg = p.take(2).readUInt16BE(0);
  p.take(4);
  const policyLen = p.take(2).readUInt16BE(0);
  p.take(policyLen);
  const dataSize = p.take(2).readUInt16BE(0);
  p.end();
  return { nvPublic, nvName, nvIndex, nameAlg, dataSize };
}

/** @param {Buffer} parameters @param {string} row */
function parseReadPublic(parameters, row) {
  const r = new ResponseReader(parameters, row);
  const outPublic = r.tpm2b();
  const name = r.tpm2b();
  const qualifiedName = r.tpm2b();
  r.end();
  return { outPublic, name, qualifiedName };
}

/** ردُّ `CreatePrimary` (Part 3 جدولُ 158): outPublic ‖ creationData ‖ creationHash ‖ creationTicket ‖ name — الاسمُ أخيرًا. */
/** @param {Buffer} parameters @param {string} row */
function parseCreatePrimary(parameters, row) {
  const r = new ResponseReader(parameters, row);
  const outPublic = r.tpm2b();
  const creationData = r.tpm2b();
  const creationHash = r.tpm2b();
  // TPMT_TK_CREATION: tag(2) ‖ hierarchy(4) ‖ digest(TPM2B)
  r.take(2);
  r.take(4);
  r.tpm2b();
  const name = r.tpm2b();
  r.end();
  return { outPublic, name, creationData, creationHash };
}
