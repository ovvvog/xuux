/**
 * G2-3 — اختباراتُ البوّابةِ (L-C) دائمَةُ التشغيلِ: آلةُ الحالاتِ والصفوفُ المغلقةُ
 * فوقَ مستجيبِ TPM محليٍّ مستقلٍّ الحساباتِ.
 *
 * (1) المستجيبُ يحسبُ HMAC الردودِ ببناءٍ مستقلٍّ (`node:crypto` مضمّنةً في الاختبار)
 *     مقيدٌ بمتجهِ WL-452 الثابتِ (المُعلَنِ في اختبارِ G2-2)، ويتحقّقُ من HMAC الأوامرِ
 *     الواصلةِ — فأيُّ خطأٍ في cpHash البوّابةِ يُغلقُ المسارَ السليمَ فيفشلُ الاختبارُ.
 * (2) الحالاتُ: المسارُ الكاملُ bootstrap→salted→confirmed، وقاعدةُ التنقيحِ الخامسِ
 *     (R5-01: لا انتقالَ بغيرِ P0)، والرفضُ قبلَ الإرسالِ خارجَ الحالةِ، وP0 محاولةٌ
 *     واحدةٌ (بالتوازي)، وC1 بالمطابقةِ البايتيّةِ (اختلافُ بايتٍ يُغلق)، وFlushContext
 *     بقيودِ WL-447، وإعادةُ القراءةِ (RETRY).
 * (3) لا شكوى على محاكاةِ swtpm هنا — اختباراتُ العبورِ الحقيقيُّ في
 *     `g2-gate-swtpm.test.mjs`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, randomBytes, privateDecrypt, constants as cryptoConstants } from 'node:crypto';
import { FreshnessGate, GATE_ERRORS } from '../../sim/tpm/gate.mjs';
import * as builder from '../../sim/tpm/command_builder.mjs';
import { mintSimulatedEkCertificatePair } from '../../sim/tpm/ek_identity.mjs';

/**
 * @typedef {object} FakeCommandSession
 * @property {number} handle
 * @property {number} attrs
 * @property {Buffer} hmac
 * @property {Buffer} nonceCaller
 *
 * @typedef {object} FakeParsedCommand
 * @property {number} tag
 * @property {number} cc
 * @property {number[]} handles
 * @property {FakeCommandSession | null} session
 * @property {Buffer} parameters
 *
 * @typedef {object} FakeSessionRecord
 * @property {number} handle
 * @property {Buffer} sessionKey
 * @property {Buffer} nonceTPM
 *
 * @typedef {object} FakeTamper
 * @property {boolean} [corruptResponseHmac]
 * @property {number} [p0Attrs]
 * @property {number} [dropHandleInC1]
 * @property {number} [addHandlerInC1]
 * @property {boolean} [retryOnce]
 * @property {number} [driftNvContent]
 * @property {boolean} [driftEkInC1]
 * @property {boolean} [failP0WithRc]
 *
 * @typedef {object} FakeOkSession
 * @property {'hmac' | 'password'} kind
 * @property {number} handle
 * @property {Buffer} [sessionKey]
 * @property {Buffer} nonceCaller
 * @property {Buffer} newNonceTPM
 * @property {number} sentAttrs
 */
const sha256 = (/** @type {Buffer[]} */ ...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
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
const tpm2b = (/** @type {Buffer} */ bytes) => Buffer.concat([u16(bytes.length), bytes]);
const u8 = (/** @type {number} */ n) => Buffer.from([n]);

/** KDFa مستقلٌّ داخلَ الاختبارِ — مقيدٌ بمتجهِ WL-452 (لا يستوردُ وحدةً تحتَ الاختبار). */
/** @param {Buffer} key @param {string} label @param {Buffer} contextU @param {Buffer} contextV @param {number} bits */
function independentKdfa(key, label, contextU, contextV, bits) {
  const labelBytes = Buffer.concat([Buffer.from(label, 'utf8'), Buffer.alloc(1)]);
  const context = Buffer.concat([contextU, contextV]);
  const bytes = Math.ceil(bits / 8);
  const outs = [];
  let counter = 1;
  let produced = 0;
  while (produced < bytes) {
    const i = Buffer.alloc(4);
    i.writeUInt32BE(counter);
    const l = Buffer.alloc(4);
    l.writeUInt32BE(bits);
    outs.push(createHmac('sha256', key).update(Buffer.concat([i, labelBytes, context, l])).digest());
    produced += 32;
    counter += 1;
  }
  return Buffer.concat(outs).subarray(0, bytes);
}

test('المستجيب المحلي: KDFa المستقل يطابق متجه WL-452 الثابت', () => {
  const salt = Buffer.alloc(32, 0x01);
  const nt = Buffer.alloc(32, 0x02);
  const nc = Buffer.alloc(32, 0x03);
  assert.equal(
    independentKdfa(salt, 'ATH', nt, nc, 256).toString('hex'),
    'd61e4115d0e81cb1945ebb5d9b419bee7a4ee232e491f18649e90032a4af1aaa',
  );
});

/**
 * مستجيبُ TPM محليٌّ: يعرفُ فهارسَ NV (منطقتها العامّةُ ومحتواها)، ومفتاحَ EK (زوجُهُ
 * الكاملُ)، وجلساتِ الملح. يتحقّقُ من HMAC الأوامرِ ذاتِ الجلساتِ ويحسبُ HMAC الردودِ
 * ببناءٍ مستقلٍّ. `tamper` يفتحُ سيناريوهاتِ الفشلِ المسمّاة.
 */
class FakeTpm {
  /**
   * @param {{ nv?: Array<{ index: number, data: Buffer }>, pageSize?: number, tamper?: FakeTamper }} [options]
   */
  constructor(options = {}) {
    this.nv = new Map();
    for (const entry of options.nv ?? []) {
      const nvPublic = Buffer.concat([
        u32(entry.index),
        u16(builder.TPM_ALG.SHA256),
        u32(0x00002006), // PPWRITE|AUTHWRITE|AUTHREAD|NO_DA (شكلٌ كافٍ للاختبار)
        tpm2b(Buffer.alloc(0)),
        u16(entry.data.length),
      ]);
      this.nv.set(entry.index, { nvPublic, data: Buffer.from(entry.data) });
    }
    this.pageSize = options.pageSize ?? 16;
    this.tamper = /** @type {FakeTamper} */ (options.tamper ?? {});
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.ekPrivateKey = privateKey;
    const jwkN = publicKey.export({ format: 'jwk' }).n;
    assert.ok(jwkN, 'fake responder: RSA JWK must carry n');
    const modulus = Buffer.from(jwkN, 'base64url');
    const template = builder.defaultEkTemplateRsa2048();
    this.ekOutPublic = Buffer.concat([template.subarray(0, template.length - 258), u16(0x0100), modulus]);
    this.sessions = new Map();
    this.transients = new Map();
    this.nextSessionHandle = 0x03000000;
    this.nextTransientHandle = 0x80000000;
    this.commandsSeen = /** @type {{ cc: number, tag: number, cap: number | undefined }[]} */ ([]);
    this.hmacChecks = 0;
    this.transport = {
      submit: async (/** @type {Uint8Array} */ commandBytes) => this.handle(Buffer.from(commandBytes)),
    };
  }

  /** خطأٌ بعشرةِ بايتاتٍ (§4.4 خ). */
  /** @param {number} rc */
  errorResponse(rc) {
    return Buffer.concat([u16(0x8001), u32(10), u32(rc)]);
  }

  /** ردٌّ ناجحٌ بمنطقةِ تفويضٍ: ن1 (بلا جلسات) أو ن2/ن3 (بجلسة). */
  /** @param {number} commandCode @param {number[]} handles @param {Buffer} parameters @param {FakeOkSession | null} session @param {FakeParsedCommand} parsedCommand */
  okResponse(commandCode, handles, parameters, session, parsedCommand) {
    const parts = [];
    let tag = 0x8001;
    let authArea = Buffer.alloc(0);
    if (session) {
      tag = 0x8002;
      const nonceTPM = session.newNonceTPM;
      let attrs = session.sentAttrs;
      let hmac = Buffer.alloc(0);
      if (session.kind === 'hmac') {
        const sessionKey = session.sessionKey;
        assert.ok(sessionKey, 'fake responder: hmac session must carry sessionKey');
        const rp = sha256(u32(0), u32(commandCode), parameters);
        hmac = createHmac('sha256', Buffer.concat([sessionKey, Buffer.alloc(0)]))
          .update(Buffer.concat([rp, nonceTPM, session.nonceCaller, u8(attrs)]))
          .digest();
      }
      if (this.tamper.corruptResponseHmac && hmac.length > 0) hmac[0] = (hmac[0] ?? 0) ^ 0xff;
      if (this.tamper.p0Attrs !== undefined) attrs = this.tamper.p0Attrs;
      // منطقةُ تفويضِ الردِّ: nonceTPM ‖ attrs ‖ hmac — بلا عدٍّ ولا مقبضٍ (Part 2).
      authArea = Buffer.concat([tpm2b(nonceTPM), u8(attrs), tpm2b(hmac)]);
    }
    for (const h of handles) parts.push(u32(h));
    if (session) parts.push(u32(parameters.length)); // parameterSize في ردودِ الجلساتِ
    parts.push(parameters);
    parts.push(authArea);
    const body = Buffer.concat(parts);
    const size = 10 + body.length;
    void parsedCommand;
    return Buffer.concat([u16(tag), u32(size), u32(0), body]);
  }

  /** تحليلُ أمرٍّ بسيطٌ: رأسٌ + مقابضُ + منطقةُ تفويضٍ + معاملات. */
  /** @param {Buffer} buf @returns {FakeParsedCommand} */
  parseCommand(buf) {
    const tag = buf.readUInt16BE(0);
    const cc = buf.readUInt32BE(6);
    let off = 10;
    const handles = [];
    // عددُ المقابضِ معروفٌ من الرمزِ في صفوفِ هذهِ الحزمةِ.
    /** @type {Record<number, number>} */
    const handleCounts = { [builder.TPM_CC.NV_ReadPublic]: 1, [builder.TPM_CC.NV_Read]: 2, [builder.TPM_CC.ReadPublic]: 1, [builder.TPM_CC.FlushContext]: 1, [builder.TPM_CC.CreatePrimary]: 1 };
    const n = handleCounts[cc] ?? 0;
    for (let i = 0; i < n; i += 1) {
      handles.push(buf.readUInt32BE(off));
      off += 4;
    }
    let session = null;
    if (tag === 0x8002) {
      const authSize = buf.readUInt32BE(off);
      off += 4;
      const authEnd = off + authSize;
      // منطقةُ التفويضِ سلسلةُ جلسةٍ واحدةٍ بلا عدّادٍ (كما على TPM حقيقيّ).
      const sessionHandle = buf.readUInt32BE(off);
      off += 4;
      const nonceLen = buf.readUInt16BE(off);
      off += 2;
      const nonceCallerBytes = buf.subarray(off, off + nonceLen);
      off += nonceLen;
      const attrs = buf.readUInt8(off);
      off += 1;
      const hmacLen = buf.readUInt16BE(off);
      off += 2;
      const hmac = buf.subarray(off, off + hmacLen);
      off += hmacLen;
      assert.equal(off, authEnd, 'fake responder: auth area mismatch');
      session = { handle: sessionHandle, attrs, hmac, nonceCaller: nonceCallerBytes };
    }
    const parameters = buf.subarray(off);
    return { tag, cc, handles, session, parameters };
  }

  /** قراءةُ nonceCaller من منطقةِ التفويضِ (للجلساتِ المملّحةِ). */
  /** @param {Buffer} buf @returns {Buffer} */
  static readNonceCaller(buf) {
    let off = 10;
    const cc = buf.readUInt32BE(6);
    /** @type {Record<number, number>} */
    const handleCounts = { [builder.TPM_CC.NV_ReadPublic]: 1, [builder.TPM_CC.NV_Read]: 2, [builder.TPM_CC.ReadPublic]: 1, [builder.TPM_CC.CreatePrimary]: 1 };
    const n = handleCounts[cc] ?? 0;
    off += 4 * n;
    off += 4; // authorizationSize
    off += 4; // sessionHandle
    const nonceLen = buf.readUInt16BE(off);
    off += 2;
    return buf.subarray(off, off + nonceLen);
  }

  /** التحقّقُ من HMAC أمرٍّ مملّحٍ — ببناءٍ مستقلٍّ فوقَ cpHash معادِ بناؤهِ هنا. */
  /** @param {Buffer} buf @param {FakeParsedCommand} parsed @param {FakeSessionRecord} sessionRecord @param {Buffer[]} handleNames */
  verifyCommandHmac(buf, parsed, sessionRecord, handleNames) {
    const sess = parsed.session;
    assert.ok(sess, 'fake responder: HMAC check requires a session');
    const cp = sha256(u32(parsed.cc), Buffer.concat(handleNames), parsed.parameters);
    const nonceCaller = FakeTpm.readNonceCaller(buf);
    const expected = createHmac('sha256', Buffer.concat([sessionRecord.sessionKey, Buffer.alloc(0)]))
      .update(Buffer.concat([cp, nonceCaller, sessionRecord.nonceTPM, u8(sess.attrs)]))
      .digest();
    this.hmacChecks += 1;
    assert.ok(sess.hmac.equals(expected), 'fake responder: command HMAC mismatch (gate cpHash is wrong)');
  }

  /** التنفيذُ الرئيسُّ. */
  /** @param {Buffer} buf @returns {Promise<Buffer> | Buffer} */
  handle(buf) {
    const parsed = this.parseCommand(buf);
    this.commandsSeen.push({ cc: parsed.cc, tag: parsed.tag, cap: parsed.cc === builder.TPM_CC.GetCapability ? parsed.parameters.readUInt32BE(0) : undefined });

    // فهرسُ الجلسةِ إن كانتِ الجلسةُ مملّحةً.
    let sessionRecord = null;
    if (parsed.session && parsed.session.handle >= 0x03000000 && this.sessions.has(parsed.session.handle)) {
      sessionRecord = this.sessions.get(parsed.session.handle);
    }

    switch (parsed.cc) {
      case builder.TPM_CC.GetCapability: {
        const r = new FakeReader(parsed.parameters);
        const capability = r.take(4).readUInt32BE(0);
        const property = r.take(4).readUInt32BE(0);
        const count = r.take(4).readUInt32BE(0);
        r.end();
        let params;
        if (capability === builder.TPM_CAP.HANDLES) {
          const all = [...this.nv.keys()].sort((a, b) => a - b).filter((h) => h >= property && h <= builder.EK_NV_RANGE.last);
          let handlesPage = all.slice(0, Math.min(count, this.pageSize));
          if (this.tamper.dropHandleInC1 && parsed.session) handlesPage = handlesPage.filter((h) => h !== this.tamper.dropHandleInC1);
          if (this.tamper.addHandlerInC1 && parsed.session) handlesPage = [...handlesPage, this.tamper.addHandlerInC1].sort((a, b) => a - b);
          const more = all.length > handlesPage.length;
          params = Buffer.concat([u8(more ? 1 : 0), u32(builder.TPM_CAP.HANDLES), u32(handlesPage.length), ...handlesPage.map((h) => u32(h))]);
        } else {
          const prop = property === builder.TPM_PT_NV_BUFFER_MAX ? 1024 : 0;
          params = Buffer.concat([u8(0), u32(builder.TPM_CAP.TPM_PROPERTIES), u32(1), u32(property), u32(prop)]);
        }
        if (parsed.session && sessionRecord) {
          if (parsed.session.attrs === 0x81) {
            this.verifyCommandHmac(buf, parsed, sessionRecord, []);
          }
          const newNonce = randomBytes(32);
          sessionRecord.nonceTPM = newNonce;
          return this.okResponse(parsed.cc, [], params, {
            kind: 'hmac',
            handle: sessionRecord.handle,
            sessionKey: sessionRecord.sessionKey,
            nonceCaller: FakeTpm.readNonceCaller(buf),
            newNonceTPM: newNonce,
            sentAttrs: parsed.session.attrs,
          }, parsed);
        }
        if (parsed.session) {
          // جلسةُ `TPM_RS_PW` على قراءةٍ لا تفويضَ لها: الرفضُ الأصليّ من فحصِ الجلسةِ
          // (المسبارُ في الملحقِ هـ) — لكنّ صفوفَ البوابةِ لا ترسلُه أصلًا؛ رفضٌ حاسم.
          return this.errorResponse(0x982);
        }
        if (this.tamper.retryOnce && this.commandsSeen.filter((c) => c.cc === builder.TPM_CC.GetCapability).length === 1) {
          return this.errorResponse(0x922); // TPM_RC_RETRY
        }
        return this.okResponse(parsed.cc, [], params, null, parsed);
      }
      case builder.TPM_CC.NV_ReadPublic: {
        const index = parsed.handles[0];
        const entry = this.nv.get(index);
        if (!entry) return this.errorResponse(0x143); // TPM_RC_HANDLE
        const name = Buffer.concat([u16(builder.TPM_ALG.SHA256), sha256(entry.nvPublic)]);
        const params = Buffer.concat([tpm2b(entry.nvPublic), tpm2b(name)]);
        if (parsed.session && sessionRecord) {
          // cpHash للجلسةِ المملّحةِ يستخدمُ اسمَ الفهرسِ (nameAlg‖H(nvPublic)) — Part 1 §18.7.
          if (parsed.session.attrs === 0x81) this.verifyCommandHmac(buf, parsed, sessionRecord, [name]);
          const newNonce = randomBytes(32);
          sessionRecord.nonceTPM = newNonce;
          return this.okResponse(parsed.cc, [], params, {
            kind: 'hmac', handle: sessionRecord.handle, sessionKey: sessionRecord.sessionKey,
            nonceCaller: FakeTpm.readNonceCaller(buf), newNonceTPM: newNonce, sentAttrs: parsed.session.attrs,
          }, parsed);
        }
        return this.okResponse(parsed.cc, [], params, null, parsed);
      }
      case builder.TPM_CC.NV_Read: {
        const index = parsed.handles[1];
        const entry = this.nv.get(index);
        if (!entry) return this.errorResponse(0x143);
        const r = new FakeReader(parsed.parameters);
        const size = r.take(2).readUInt16BE(0);
        const offset = r.take(2).readUInt16BE(0);
        r.end();
        let data = entry.data.subarray(offset, offset + size);
        if (parsed.session && sessionRecord) {
          // C1: التفويضُ بالجلسةِ المملّحةِ (سماتُ 0x01) معَ cpHash بأسماءِ المقبضينِ.
          const name = Buffer.concat([u16(builder.TPM_ALG.SHA256), sha256(entry.nvPublic)]);
          if (parsed.session.attrs === 0x01 || parsed.session.attrs === 0x00) {
            this.verifyCommandHmac(buf, parsed, sessionRecord, [name, name]);
          }
          if (this.tamper.driftNvContent === index && data.length > 0) {
            // اختلافُ بايتٍ واحدٍ في محتوى C1 عن التمهيدِ.
            data = Buffer.concat([data.subarray(0, data.length - 1), Buffer.from([data[data.length - 1] ^ 1])]);
          }
          const newNonce = randomBytes(32);
          sessionRecord.nonceTPM = newNonce;
          return this.okResponse(parsed.cc, [], tpm2b(data), {
            kind: 'hmac', handle: sessionRecord.handle, sessionKey: sessionRecord.sessionKey,
            nonceCaller: FakeTpm.readNonceCaller(buf), newNonceTPM: newNonce, sentAttrs: parsed.session.attrs,
          }, parsed);
        }
        // T3: TPM_RS_PW.
        return this.okResponse(parsed.cc, [], tpm2b(data), {
          kind: 'password', handle: builder.TPM_RH.RS_PW, newNonceTPM: Buffer.alloc(0),
          sentAttrs: 0x01, nonceCaller: Buffer.alloc(0),
        }, parsed);
      }
      case builder.TPM_CC.ReadPublic: {
        let outPublic = this.ekOutPublic;
        if (this.tamper.driftEkInC1 && parsed.session) {
          outPublic = Buffer.from(outPublic);
          const last = outPublic.length - 1;
          outPublic[last] = (outPublic[last] ?? 0) ^ 1;
        }
        const name = Buffer.concat([u16(builder.TPM_ALG.SHA256), sha256(outPublic)]);
        const params = Buffer.concat([tpm2b(outPublic), tpm2b(name), tpm2b(Buffer.alloc(0))]);
        if (parsed.session && sessionRecord) {
          // cpHash للجلسةِ المملّحةِ يستخدمُ اسمَ EK (nameAlg‖H(public)) لا بايتاتِ المقبضِ.
          if (parsed.session.attrs === 0x81) this.verifyCommandHmac(buf, parsed, sessionRecord, [name]);
          const newNonce = randomBytes(32);
          sessionRecord.nonceTPM = newNonce;
          return this.okResponse(parsed.cc, [], params, {
            kind: 'hmac', handle: sessionRecord.handle, sessionKey: sessionRecord.sessionKey,
            nonceCaller: FakeTpm.readNonceCaller(buf), newNonceTPM: newNonce, sentAttrs: parsed.session.attrs,
          }, parsed);
        }
        return this.okResponse(parsed.cc, [], params, null, parsed);
      }
      case builder.TPM_CC.CreatePrimary: {
        const handle = this.nextTransientHandle;
        this.nextTransientHandle += 1;
        this.transients.set(handle, true);
        const name = Buffer.concat([u16(builder.TPM_ALG.SHA256), sha256(this.ekOutPublic)]);
        // Part 3 جدولُ 158: outPublic ‖ creationData ‖ creationHash ‖ creationTicket ‖ name.
        const params = Buffer.concat([
          tpm2b(this.ekOutPublic),
          tpm2b(Buffer.alloc(0)),
          tpm2b(Buffer.alloc(0)),
          u16(0x8025), u32(builder.TPM_RH.NULL), tpm2b(Buffer.alloc(0)),
          tpm2b(name),
        ]);
        return this.okResponse(parsed.cc, [handle], params, {
          kind: 'password', handle: builder.TPM_RH.RS_PW, newNonceTPM: Buffer.alloc(0),
          sentAttrs: 0x01, nonceCaller: Buffer.alloc(0),
        }, parsed);
      }
      case builder.TPM_CC.StartAuthSession: {
        const r = new FakeReader(parsed.parameters);
        r.take(4); // tpmKey
        r.take(4); // bind
        const nonceCaller = r.tpm2b();
        const encryptedSalt = r.tpm2b();
        const sessionType = r.take(1).readUInt8(0);
        r.take(2); // symmetric
        r.take(2); // authHash
        r.end();
        if (sessionType !== builder.TPM_SE.HMAC) return this.errorResponse(0x142); // TPM_RC_VALUE
        const salt = privateDecrypt(
          { key: this.ekPrivateKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: Buffer.from('SECRET\0') },
          encryptedSalt,
        );
        const nonceTPM = randomBytes(32);
        const handle = this.nextSessionHandle;
        this.nextSessionHandle += 1;
        const sessionKey = independentKdfa(salt, 'ATH', nonceTPM, nonceCaller, 256);
        this.sessions.set(handle, { sessionKey, nonceTPM, nonceCaller });
        const params = tpm2b(nonceTPM);
        return this.okResponse(parsed.cc, [handle], params, null, parsed);
      }
      case builder.TPM_CC.FlushContext: {
        const handle = parsed.handles[0];
        this.sessions.delete(handle);
        this.transients.delete(handle);
        return this.okResponse(parsed.cc, [], Buffer.alloc(0), null, parsed);
      }
      default:
        return this.errorResponse(0x143);
    }
  }
}

class FakeReader {
  /** @param {Buffer} buf */
  constructor(buf) {
    this.buf = buf;
    this.off = 0;
  }
  /** @param {number} n @returns {Buffer} */
  take(n) {
    const b = this.buf.subarray(this.off, this.off + n);
    assert.ok(this.off + n <= this.buf.length, 'fake responder: truncated');
    this.off += n;
    return b;
  }
  tpm2b() {
    return this.take(this.take(2).readUInt16BE(0));
  }
  end() {
    assert.equal(this.off, this.buf.length, 'fake responder: trailing bytes');
  }
}

/** تجهيزُ بوابةٍ فوقَ مستجيبٍ: T1..T5 + §3.2-2 + StartAuthSession (لا P0 بعد). */
/** @param {FakeTpm} fake @param {object} [extra] */
async function bootstrappedGate(fake, extra = {}) {
  const gate = new FreshnessGate({
    transport: fake.transport,
    mode: 'operation',
    persistentEkHandle: null,
    ekIdentity: mintSimulatedEkCertificatePair(ekJwk(fake)),
    ...extra,
  });
  const t1 = await gate.t1Inventory();
  await gate.t6nvBufferMax();
  for (const h of t1.handles) {
    await gate.t2nvReadPublic({ nvIndex: h });
    const stored = gate.bootstrapReads.get(h);
    assert.ok(stored, 'bootstrap read must be stored');
    await gate.t3nvRead({ nvIndex: h, size: stored.dataSize, offset: 0 });
  }
  const ek = await gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
  gate.verifyEkIdentity();
  await gate.startAuthSession();
  return { gate, ek };
}

/** JWK لمفتاحِ EK للمستجيبِ — لصكِّ الشهادةِ عبرَ §3.2-2. */
/** @param {FakeTpm} fake */
function ekJwk(fake) {
  const modulus = fake.ekOutPublic.subarray(fake.ekOutPublic.length - 256);
  return { kty: 'RSA', n: modulus.toString('base64url'), e: 'AQAB' };
}

// ——— (1) المسارُ الكاملُ ———

test('G2-3: مسارٌ كاملٌ bootstrap→salted→confirmed فوقَ مستجيبٍ محليٍّ بفهرسٍ واحدٍ', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(64, 0xab) }] });
  const { gate } = await bootstrappedGate(fake);
  assert.equal(gate.state, 'bootstrap', 'salting alone must not leave bootstrap (R5-01)');
  const p0 = await gate.p0Attest();
  assert.deepEqual(p0.handles, [0x01c00002]);
  assert.equal(gate.state, 'salted');
  const c1 = await gate.c1Confirm();
  assert.equal(gate.state, 'confirmed');
  assert.deepEqual(c1.handles, [0x01c00002]);
  assert.match(c1.identityFingerprint, /^[0-9a-f]{64,}$/, 'identity fingerprint from C1 bytes');
  // صفوفُ ما بعدَ confirmed غيرُ منفَّذةٍ — رفضٌ صادقٌ قبلَ الإرسال.
  assert.throws(() => gate.mutatingRow(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.ROW_NOT_IMPLEMENTED);
  assert.ok(fake.hmacChecks >= 4, 'responder verified gate command HMACs (cpHash correct)');
});

test('G2-3: جردٌ بصفحاتٍ متعددةٍ (المستجيبُ يردُّ 3 عناصرٍ كحدٍّ أقصى للصفحة)', async () => {
  const fake = new FakeTpm({
    nv: [0x01c00002, 0x01c00003, 0x01c00004, 0x01c0000a, 0x01c0000b].map((index) => ({ index, data: Buffer.alloc(16, index) })),
    pageSize: 3,
  });
  const { gate } = await bootstrappedGate(fake);
  const p0 = await gate.p0Attest();
  // صفحةُ P0 الأولى يحدُّها المستجيبُ (3 عناصر) — والاكتمالُ في C1 بالتكملةِ.
  assert.equal(p0.handles.length, 3, 'P0 first page is responder-limited');
  const c1 = await gate.c1Confirm();
  assert.deepEqual(c1.handles, [0x01c00002, 0x01c00003, 0x01c00004, 0x01c0000a, 0x01c0000b]);
  assert.equal(gate.state, 'confirmed');
});

// ——— (2) قاعدةُ التنقيحِ الخامسِ (R5-01) ———

test('G2-3 (R5-01): الجلسةُ المملّحةُ لا تُبلّغُ salted — الانتقالُ بـP0 وحدَه', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }] });
  const { gate } = await bootstrappedGate(fake);
  assert.equal(gate.state, 'bootstrap');
  // لا صفًّا آخرَ يحملُ الجلسةَ في bootstrap غيرِ P0 — والجلسةُ نفسُها لا تنقلُ الحالة.
  await assert.rejects(gate.startAuthSession(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.DUPLICATE_ATTEMPT);
  await gate.p0Attest();
  assert.equal(gate.state, 'salted');
});

// ——— (3) الرفضُ قبلَ الإرسالِ ———

test('G2-3: صفوفُ التمهيدِ تُرفضُ خارجَ bootstrap قبلَ الإرسالِ (لا بايتاتٍ تُرسَل)', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }] });
  const { gate } = await bootstrappedGate(fake);
  // C1 صفٌّ لحالةِ salted — وهو في bootstrap مرفوضٌ قبلَ الإرسالِ.
  const seen0 = fake.commandsSeen.length;
  await assert.rejects(gate.c1Confirm(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
  assert.equal(fake.commandsSeen.length, seen0, 'nothing sent for C1 in bootstrap');
  await gate.p0Attest();
  const seen = fake.commandsSeen.length;
  await assert.rejects(gate.t6nvBufferMax(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
  await assert.rejects(gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
  assert.equal(fake.commandsSeen.length, seen, 'nothing sent for rejected rows');
  await assert.rejects(gate.p0Attest(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.STATE_INVALID);
});

test('G2-3: T2/T3 بفهرسٍ لم يظهر في T1 أو خارجَ الستّةِ ⇒ رفضٌ قبلَ الإرسالِ', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }] });
  const gate = new FreshnessGate({
    transport: fake.transport,
    mode: 'operation',
    persistentEkHandle: null,
    ekIdentity: mintSimulatedEkCertificatePair(ekJwk(fake)),
  });
  await gate.t1Inventory();
  await gate.t6nvBufferMax();
  const seen = fake.commandsSeen.length;
  await assert.rejects(gate.t2nvReadPublic({ nvIndex: 0x01c00003 }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
  await assert.rejects(gate.t3nvRead({ nvIndex: 0x01c00003, size: 1, offset: 0 }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
  await assert.rejects(gate.t2nvReadPublic({ nvIndex: 0x01800000 }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
  assert.equal(fake.commandsSeen.length, seen);
});

test('G2-3: P0 قبلَ StartAuthSession أو قبلَ اكتمالِ T1 ⇒ رفضٌ قبلَ الإرسالِ', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }] });
  const gate = new FreshnessGate({
    transport: fake.transport,
    mode: 'operation',
    persistentEkHandle: null,
    ekIdentity: mintSimulatedEkCertificatePair(ekJwk(fake)),
  });
  await gate.t1Inventory();
  const seen = fake.commandsSeen.length;
  await assert.rejects(gate.p0Attest(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
  assert.equal(fake.commandsSeen.length, seen);
  // T1 مكتملٌ لكن لا جلسةَ بعدُ.
  const ek = await gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
  gate.verifyEkIdentity();
  await assert.rejects(gate.p0Attest(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
  await gate.startAuthSession();
  void ek;
  const p0 = await gate.p0Attest();
  assert.deepEqual(p0.handles, [0x01c00002]);
});

// ——— (4) P0 محاولةٌ واحدةٌ ———

test('G2-3: P0 محاولةٌ واحدةٌ — نداءانِ متوازيانِ يُنفَّذُ منهما واحدٌ', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }] });
  const { gate } = await bootstrappedGate(fake);
  const results = await Promise.allSettled([gate.p0Attest(), gate.p0Attest()]);
  const rejected = results.filter((r) => r.status === 'rejected');
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.equal(rejected.length, 1);
  assert.equal(fulfilled.length, 1);
  assert.ok(rejected[0] !== undefined);
  assert.equal(/** @type {{ reason: { code?: string } }} */ (rejected[0]).reason.code, GATE_ERRORS.DUPLICATE_ATTEMPT);
  assert.equal(gate.state, 'salted');
});

test('G2-3: P0 بسماتٍ مغايرةٍ (0x01) في الردِّ ⇒ إغلاقٌ بلا محاولةٍ ثانية', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }], tamper: { p0Attrs: 0x01 } });
  const { gate } = await bootstrappedGate(fake);
  await assert.rejects(gate.p0Attest(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN);
  assert.equal(gate.state, 'bootstrap');
  assert.ok(gate.closed);
  await assert.rejects(gate.t1Inventory(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.CONNECTION_CLOSED);
});

test('G2-3: P0 بـHMAC ردٍّ فاسدٍ ⇒ إغلاقٌ ورفضُ ما بعدَه', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }], tamper: { corruptResponseHmac: true } });
  const { gate } = await bootstrappedGate(fake);
  await assert.rejects(gate.p0Attest(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN);
  assert.ok(gate.closed);
});

test('G2-3: P0 بردِّ خطأٍ (rc) ⇒ إغلاقٌ بFRESHNESS_TPM_IDENTITY_UNPROVEN', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }], tamper: { failP0WithRc: true } });
  const originalHandle = fake.handle.bind(fake);
  fake.handle = (buf) => {
    const parsed = fake.parseCommand(buf);
    if (parsed.cc === builder.TPM_CC.GetCapability && parsed.session && fake.tamper.failP0WithRc) {
      return fake.errorResponse(0x9a2);
    }
    return originalHandle(buf);
  };
  const { gate } = await bootstrappedGate(fake);
  await assert.rejects(gate.p0Attest(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN);
  assert.ok(gate.closed);
});

// ——— (5) C1: المطابقةُ البايتيّةُ ———

test('G2-3 (C1): اختلافُ بايتٍ واحدٍ في محتوى فهرسٍ بينَ التمهيدِ وC1 ⇒ إغلاق', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(64, 0xab) }], tamper: { driftNvContent: 0x01c00002 } });
  const { gate } = await bootstrappedGate(fake);
  await gate.p0Attest();
  assert.equal(gate.state, 'salted');
  await assert.rejects(gate.c1Confirm(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN);
  assert.ok(gate.closed);
});

test('G2-3 (C1): فهرسٌ يظهرُ في C1 ولم يرهُ T1 ⇒ إغلاقٌ (لا زائدَ)', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }], tamper: { addHandlerInC1: 0x01c0000a } });
  const { gate } = await bootstrappedGate(fake);
  await gate.p0Attest();
  await assert.rejects(gate.c1Confirm(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN);
  assert.ok(gate.closed);
});

test('G2-3 (C1): فهرسٌ من T1 يُسقِطُهُ وسيطٌ في C1 ⇒ إغلاقٌ (لا ناقصَ)', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }, { index: 0x01c00003, data: Buffer.alloc(8) }], tamper: { dropHandleInC1: 0x01c00003 } });
  const { gate } = await bootstrappedGate(fake);
  await gate.p0Attest();
  await assert.rejects(gate.c1Confirm(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN);
  assert.ok(gate.closed);
});

test('G2-3 (C1): اختلافُ بايتٍ في EK public بينَ T5 وC1 ⇒ إغلاق', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }], tamper: { driftEkInC1: true } });
  const { gate } = await bootstrappedGate(fake);
  await gate.p0Attest();
  await assert.rejects(gate.c1Confirm(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN);
  assert.ok(gate.closed);
});

// ——— (6) FlushContext (WL-447) ———

test('G2-3: لا تفريغَ للجلسةِ المملّحةِ أو مقبضِ EK قبلَ نجاحِ C1، ولا لمقبضٍ لم ينشئهِ المُكيِّف', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }] });
  const { gate, ek } = await bootstrappedGate(fake);
  assert.equal(gate.state, 'bootstrap');
  // في bootstrap: التفريغُ مسموحٌ للمقابضِ المنشأةِ (كائنٌ عابرٌ مثلًا).
  await assert.rejects(gate.flushContext({ flushHandle: 0x12345678 }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
  await gate.p0Attest();
  const saltedSession = gate.saltedSession;
  assert.ok(saltedSession, 'salted session must exist');
  const salted = saltedSession.handle;
  await assert.rejects(gate.flushContext({ flushHandle: salted }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
  await assert.rejects(gate.flushContext({ flushHandle: ek.handle }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.PRECONDITION_FAILED);
  await gate.c1Confirm();
  // بعدَ confirmed: تفريغُ مقبضِ EK العابرِ جائزٌ.
  await gate.flushContext({ flushHandle: ek.handle });
  assert.ok(!gate.createdHandles.has(ek.handle));
});

// ——— (7) إعادةُ القراءةِ ———

test('G2-3: ردُّ TPM_RC_RETRY على قراءةٍ يُعادُ إرسالُهُ (قراءاتٌ فقط، ثلاثٌ كحدٍّ أقصى)', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }], tamper: { retryOnce: true } });
  const { gate } = await bootstrappedGate(fake);
  assert.equal(gate.t1.complete, true, 'T1 completed after a RETRY cycle');
  const caps = fake.commandsSeen.filter((c) => c.cc === builder.TPM_CC.GetCapability && c.cap === builder.TPM_CAP.HANDLES).length;
  assert.equal(caps, 2, 'the read was re-sent exactly once after TPM_RC_RETRY');
});

// ——— (8) البوّابةُ لا تقبلُ بايتاتٍ جاهزةً ———

test('G2-3: لا واجهةَ لاستقبالِ بايتاتِ أمرٍ جاهزةٍ من طبقةٍ أعلى', async () => {
  const fake = new FakeTpm({ nv: [{ index: 0x01c00002, data: Buffer.alloc(8) }] });
  const { gate } = await bootstrappedGate(fake);
  assert.ok(!('submit' in gate) && !('send' in gate), 'gate must not expose raw byte submission');
  await gate.p0Attest();
  assert.equal(gate.state, 'salted');
});

// ——— (9) الوضعُ يُثبَّتُ عندَ الإنشاءِ ———

test('G2-3: خياراتٌ غيرُ صالحةٍ تُرفضُ عندَ الإنشاءِ (وضعٌ مجهولٌ، لا نقلَ، لا شهادةَ)', async () => {
  const fake = new FakeTpm();
  assert.throws(() => new FreshnessGate({ transport: fake.transport, mode: /** @type {any} */ ('invalid'), ekIdentity: { certificatePem: 'x', caPem: 'y' } }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.OPTIONS_INVALID);
  assert.throws(() => new FreshnessGate({ transport: /** @type {any} */ (null), mode: 'operation', ekIdentity: { certificatePem: 'x', caPem: 'y' } }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.OPTIONS_INVALID);
  assert.throws(() => new FreshnessGate({ transport: fake.transport, mode: 'operation', ekIdentity: /** @type {any} */ (null) }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.OPTIONS_INVALID);
  assert.throws(() => new FreshnessGate({ transport: fake.transport, mode: 'operation', ekIdentity: { certificatePem: 'x', caPem: 'y' }, persistentEkHandle: /** @type {any} */ ('no') }), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.OPTIONS_INVALID);
});

test('G2-3: §3.2-2 بفهرسِ EK يخالفُ الشهادةَ ⇒ FRESHNESS_TPM_IDENTITY_UNPROVEN وإغلاق', async () => {
  const fake = new FakeTpm();
  const other = new FakeTpm(); // مفتاحٌ آخرَ — شهادةُ الأولَ لا تطابقُهُ
  const gate = new FreshnessGate({
    transport: fake.transport,
    mode: 'operation',
    persistentEkHandle: null,
    ekIdentity: mintSimulatedEkCertificatePair(ekJwk(other)),
  });
  await gate.t1Inventory();
  await gate.t6nvBufferMax();
  await gate.t5createPrimary({ inPublic: builder.defaultEkTemplateRsa2048() });
  assert.throws(() => gate.verifyEkIdentity(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.IDENTITY_UNPROVEN);
  assert.ok(gate.closed);
  // وبعدَ الإغلاقِ لا أمرًّا يُرسَل.
  await assert.rejects(gate.startAuthSession(), (/** @type {{ code?: string }} */ e) => e.code === GATE_ERRORS.CONNECTION_CLOSED);
});
