// النموذجُ المرجعيُّ القابلُ للتنفيذ لحالاتِ بوّابةِ الملحق هـ §4.3 (التنقيحُ السادس، WL-451).
//
// ما هو: نموذجٌ تصميميٌّ لقواعدِ الحالات `bootstrap → salted → confirmed` في الاتّصالِ الواحد،
// يُثبتُ بالاختبارِ أنّ التصميمَ المعدَّلَ يبلغُ `confirmed` لمفتاحِ EK مستمرٍّ وعابر، وأنّ التصميمَ
// السابقَ (التنقيحُ الخامس) لا يبلغُ `salted` أبدًا (WL437-gpt_6_1_sol-R5-01، WL437-grok_4_7-R5-01).
//
// ما ليس هو: ليس منفّذَ G2 ولا جزءًا منه؛ لا تستوردُه `src/` ولا `sim/` (والاختبارُ يقفلُ ذلك).
// لا يبني بايتاتِ TPM، ولا يتحقّقُ من شهادةٍ أو سلسلة، ولا يشفّرُ الملحَ بـRSA-OAEP/ECDH:
// الملحُ يُمرَّرُ رمزيًّا مربوطًا بهويّةِ المفتاحِ العامّ، والوسيطُ الذي لا يملكُ النظيرَ الخاصَّ لا يقرؤُه.
// والمعاملاتُ تُرمَّزُ ترميزًا قانونيًّا (JSON مرتّبَ المفاتيح) لا ترميزَ Part 2.
// أمّا اشتقاقُ `sessionKey` وHMAC الردّ فحقيقيّان (SHA-256 وHMAC من node:crypto) بالمعادلاتِ
// المعلنةِ في الملحق §4.3 (التنقيحُ السادس، R5-02).
//
// السابقة: نموذجا الملحق أ المرجعيّان في `docs/adr/` (نموذجٌ تصميميٌّ يُختبَرُ ولا يُشحَن).

import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomBytes } from 'node:crypto';

/** @typedef {Record<string, any>} Loose */

export const EK_INDICES = Object.freeze([
  0x01c00002, 0x01c00003, 0x01c00004, 0x01c0000a, 0x01c0000b, 0x01c0000c,
]);
const EK_RANGE_FIRST = 0x01c00002;
const EK_RANGE_LAST = 0x01c0000c;
const PAGE_MAX = 16;
const ATTR_INTEGRITY = 0x81; // audit | continueSession
const ATTR_AUTH = 0x01; // continueSession
const MUTATING = new Set([
  'NV_Increment',
  'NV_Write',
  'NV_DefineSpace',
  'NV_UndefineSpace',
  'EvictControl',
  'Clear',
]);
export const CC = Object.freeze({
  GetCapability: 0x17a,
  NV_ReadPublic: 0x169,
  NV_Read: 0x14e,
  ReadPublic: 0x173,
  CreatePrimary: 0x131,
  StartAuthSession: 0x176,
  FlushContext: 0x165,
});

export class GateRejection extends Error {
  /** @param {string} code @param {string} detail */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

// ——— التشفيرُ المعلن (R5-02) ———
const u32 = (/** @type {number} */ n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const sha256 = (/** @type {Buffer[]} */ ...parts) =>
  createHash('sha256').update(Buffer.concat(parts)).digest();
const canonical = (/** @type {unknown} */ value) =>
  JSON.stringify(value, (_k, v) => {
    if (Buffer.isBuffer(v)) return { hex: v.toString('hex') };
    if (v && v.type === 'Buffer' && Array.isArray(v.data))
      return { hex: Buffer.from(v.data).toString('hex') };
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, v[k]]),
      );
    }
    return v;
  });

// KDFa بحسبِ SP 800-108 (عدّاد، HMAC) كما في Part 1 §11.4.10.2:
// HMAC(key, [i]₃₂ ‖ label ‖ 0x00 ‖ contextU ‖ contextV ‖ [bits]₃₂).
/**
 * @param {Buffer} key @param {string} label @param {Buffer} contextU @param {Buffer} contextV @param {number} bits
 * @returns {Buffer}
 */
export function kdfa(key, label, contextU, contextV, bits) {
  const out = [];
  for (let i = 1; out.length * 32 * 8 < bits; i++) {
    out.push(
      createHmac('sha256', key)
        .update(
          Buffer.concat([
            u32(i),
            Buffer.from(label, 'ascii'),
            Buffer.from([0]),
            contextU,
            contextV,
            u32(bits),
          ]),
        )
        .digest(),
    );
  }
  return Buffer.concat(out).subarray(0, bits / 8);
}

// جلسةٌ مملّحةٌ غيرُ مربوطة (`bind` = TPM_RH_NULL): المفتاحُ = الملحُ وحدَه،
// والسياقُ U = nonceTPM، وV = nonceCaller (Part 1 §19.6.8).
/** @type {(salt: Buffer, nonceTPM: Buffer, nonceCaller: Buffer) => Buffer} */
export const sessionKeyFor = (salt, nonceTPM, nonceCaller) =>
  kdfa(salt, 'ATH', nonceTPM, nonceCaller, 256);

/** @type {(rc: number, commandName: string, params: unknown) => Buffer} */
export const rpHash = (rc, commandName, params) =>
  sha256(
    u32(rc),
    u32(/** @type {Record<string, number>} */ (CC)[commandName] ?? 0),
    Buffer.from(canonical(params)),
  );

/** @type {(sessionKey: Buffer, rp: Buffer, nonceTPM: Buffer, nonceCaller: Buffer, attrs: number) => Buffer} */
export const responseHmac = (sessionKey, rp, nonceTPM, nonceCaller, attrs) =>
  createHmac('sha256', sessionKey)
    .update(Buffer.concat([rp, nonceTPM, nonceCaller, Buffer.from([attrs])]))
    .digest();

// ——— البوّابة ———
//
// revision: 6 (المعتمدُ هنا) أو 5 (القاعدةُ السابقةُ حرفيًّا، للإثباتِ السلبيّ فقط).
/**
 * @param {{ mode?: string, persistentEkHandle?: number | null, certificateEkPublic?: unknown, revision?: number, random?: (n: number) => Buffer }} [options]
 */
export function createGate({
  mode = 'run',
  persistentEkHandle = null,
  certificateEkPublic,
  revision = 6,
  random = randomBytes,
} = {}) {
  if (!certificateEkPublic)
    throw new Error(
      'certificateEkPublic مطلوب (SubjectPublicKeyInfo من شهادةٍ تحقّقت سلسلتُها خارجَ النموذج)',
    );
  if (revision !== 5 && revision !== 6) throw new Error('revision ∈ {5, 6}');

  /** @type {Loose} */
  const g = {
    mode,
    revision,
    state: 'bootstrap',
    closedReason: null,
    t1: { pages: 0, last: null, done: false, handles: new Set() },
    t6: { bufferMax: null },
    t2: new Map(), // index → public (غيرُ موثوق)
    t3: new Map(), // index → Buffer (غيرُ موثوق، تراكميّ)
    ekPublicByHandle: new Map(), // handle → public (غيرُ موثوق)
    transientEk: null,
    createPrimaryCount: 0,
    verifiedEk: null, // المقبضُ الذي اجتازَ §3.2-2 في هذا الاتّصال
    bootstrapSession: null, // { handle, salt, nonceCaller, nonceTPM, key }
    startAuthCount: 0,
    p0Sent: false,
    sessions: new Map(), // handle → جلسةٌ أنشأها المُكيِّف
    c1: {
      pages: 0,
      last: null,
      done: false,
      handles: new Set(),
      pub: new Map(),
      data: new Map(),
      ekPublic: null,
    },
    pending: null,
    log: [],
  };

  const close = (/** @type {string} */ reason) => {
    g.state = 'closed';
    g.closedReason = reason;
    g.pending = null;
    return { state: g.state, reason };
  };
  /** @type {(code: string, detail: string) => never} */
  const reject = (code, detail) => {
    throw new GateRejection(code, detail);
  };
  const isEk6 = (/** @type {number} */ i) => EK_INDICES.includes(i);
  const noSession = (/** @type {Loose} */ cmd) =>
    cmd.session === undefined && cmd.auth === undefined;
  /** @type {(cmd: Loose, st: Loose) => boolean} */
  const t1Exact = (cmd, st) =>
    cmd.capability === 'HANDLES' &&
    cmd.propertyCount >= 1 &&
    cmd.propertyCount <= PAGE_MAX &&
    cmd.property === (st.pages === 0 ? EK_RANGE_FIRST : st.last + 1) &&
    !st.done;

  // ——— الفحصُ قبلَ الإرسال ———
  /** @param {Loose} cmd @returns {string} */
  function checkBootstrap(cmd) {
    if (MUTATING.has(cmd.cc)) reject('MUTATING_BEFORE_CONFIRMED', cmd.cc);
    switch (cmd.cc) {
      case 'GetCapability': {
        if (noSession(cmd)) {
          if (
            cmd.capability === 'TPM_PROPERTIES' &&
            cmd.property === 0x12c &&
            cmd.propertyCount === 1
          )
            return 'T6';
          if (t1Exact(cmd, g.t1)) return 'T1';
          reject('NOT_IN_BOOTSTRAP_TABLE', 'GetCapability بلا جلساتٍ خارجَ T1/T6');
        }
        if (g.revision === 5)
          reject('NOT_IN_BOOTSTRAP_TABLE', 'التنقيحُ الخامس: لا أمرَ بجلسةٍ في bootstrap');
        // P0 (التنقيحُ السادس)
        if (g.p0Sent) reject('P0_ONCE', 'محاولةٌ واحدةٌ لـP0 في الاتّصال');
        if (!g.t1.done) reject('P0_BEFORE_T1', 'P0 قبلَ اكتمالِ T1 (moreData = NO)');
        if (!g.bootstrapSession) reject('P0_NO_SESSION', 'P0 قبلَ StartAuthSession');
        if (
          cmd.capability !== 'HANDLES' ||
          cmd.property !== EK_RANGE_FIRST ||
          !(cmd.propertyCount >= 1 && cmd.propertyCount <= PAGE_MAX)
        ) {
          reject('P0_SHAPE', 'P0 = GetCapability(TPM_CAP_HANDLES, 0x01c00002, ≤16) بالضبط');
        }
        if (!cmd.session || cmd.session.handle !== g.bootstrapSession.handle)
          reject('P0_SESSION', 'جلسةُ P0 هي جلسةُ التمهيدِ المملّحةُ وحدَها');
        if (cmd.session.attrs !== ATTR_INTEGRITY) reject('P0_ATTRS', 'سماتُ P0 = 0x81 وحدَها');
        if (cmd.auth !== undefined) reject('P0_SHAPE', 'لا تفويضَ في P0');
        return 'P0';
      }
      case 'NV_ReadPublic':
        if (!noSession(cmd)) reject('SESSION_IN_BOOTSTRAP', 'NV_ReadPublic بجلسةٍ في bootstrap');
        if (!isEk6(cmd.nvIndex) || !g.t1.handles.has(cmd.nvIndex))
          reject('T2_INDEX', 'T2: فهرسٌ من الستّةِ ظهرَ في T1');
        return 'T2';
      case 'NV_Read':
        if (cmd.session !== undefined || cmd.auth !== 'PW')
          reject('T3_AUTH', 'T3: TPM_RS_PW وحدَها');
        if (!g.t2.has(cmd.nvIndex)) reject('T3_INDEX', 'T3: أحدُ مقابضِ T2 (فلا C ولا R)');
        if (g.t6.bufferMax === null || cmd.size > g.t6.bufferMax)
          reject('T3_CHUNK', 'قطعةٌ ≤ TPM_PT_NV_BUFFER_MAX من T6');
        if (cmd.offset + cmd.size > g.t2.get(cmd.nvIndex).dataSize)
          reject('T3_RANGE', 'offset + size ≤ dataSize');
        return 'T3';
      case 'ReadPublic':
        if (!noSession(cmd)) reject('SESSION_IN_BOOTSTRAP', 'ReadPublic بجلسةٍ في bootstrap');
        if (persistentEkHandle === null || cmd.objectHandle !== persistentEkHandle)
          reject('T4_HANDLE', 'T4: مقبضُ EK المستمرُّ المعلنُ وحدَه');
        return 'T4';
      case 'CreatePrimary':
        if (cmd.auth !== 'PW' || cmd.primaryHandle !== 'ENDORSEMENT') reject('T5_SHAPE', 'T5');
        if (!g.t1.done) reject('T5_BEFORE_T1', 'T5 يحتاجُ جردَ T1 مكتملًا');
        if (g.createPrimaryCount > 0) reject('T5_ONCE', 'مفتاحٌ عابرٌ واحدٌ في الاتّصال');
        return 'T5';
      case 'StartAuthSession':
        if (!noSession(cmd)) reject('SAS_SHAPE', 'StartAuthSession بلا جلسات');
        if (g.verifiedEk === null || cmd.tpmKey !== g.verifiedEk)
          reject('SAS_TPMKEY', 'tpmKey = مقبضُ EK الذي اجتازَ §3.2-2');
        if (cmd.bind !== 'NULL') reject('SAS_BIND', 'bind = TPM_RH_NULL');
        if (g.revision === 6) {
          if (cmd.sessionType !== 'HMAC')
            reject('SAS_TYPE_BOOTSTRAP', 'في bootstrap: TPM_SE_HMAC وحدَه');
          if (g.startAuthCount > 0)
            reject('SAS_ONCE_BOOTSTRAP', 'StartAuthSession واحدٌ في bootstrap');
        } else if (cmd.sessionType !== 'HMAC' && cmd.sessionType !== 'POLICY')
          reject('SAS_TYPE', 'sessionType');
        return 'SAS';
      case 'FlushContext':
        return reject('NOT_IN_BOOTSTRAP_TABLE', 'FlushContext ليسَ في جدولِ bootstrap');
      default:
        return reject('NOT_IN_BOOTSTRAP_TABLE', cmd.cc);
    }
  }

  /** @param {Loose} cmd @param {number} attrs */
  function sessionOk(cmd, attrs) {
    return (
      cmd.session &&
      g.bootstrapSession &&
      cmd.session.handle === g.bootstrapSession.handle &&
      cmd.session.attrs === attrs
    );
  }

  /** @param {Loose} cmd @returns {string} */
  function checkSalted(cmd) {
    if (MUTATING.has(cmd.cc)) reject('MUTATING_BEFORE_CONFIRMED', cmd.cc);
    if (
      noSession(cmd) &&
      ['GetCapability', 'NV_ReadPublic', 'ReadPublic', 'CreatePrimary'].includes(cmd.cc)
    ) {
      reject('BOOTSTRAP_ROW_AFTER_SALT', `${cmd.cc} بلا جلساتٍ بعدَ الملح`);
    }
    if (cmd.cc === 'NV_Read' && cmd.auth === 'PW')
      reject('BOOTSTRAP_ROW_AFTER_SALT', 'T3 بعدَ الملح');
    switch (cmd.cc) {
      case 'GetCapability':
        if (!sessionOk(cmd, ATTR_INTEGRITY) || !t1Exact(cmd, g.c1))
          reject('C1_LISTING', 'تتابعُ صفحاتِ C1 من آخرِ مقبضٍ موثَّق + 1');
        return 'C1-list';
      case 'NV_ReadPublic':
        if (!g.c1.done || !g.c1.handles.has(cmd.nvIndex) || !sessionOk(cmd, ATTR_INTEGRITY))
          reject('C1_READPUBLIC', 'C1');
        return 'C1-pub';
      case 'NV_Read': {
        const pub = g.c1.pub.get(cmd.nvIndex);
        if (!pub || !sessionOk(cmd, ATTR_AUTH))
          reject('C1_READ', 'C1: فهرسٌ قُرئت منطقتُه العامّةُ في C1، بالجلسةِ المملّحة');
        if (cmd.size > g.t6.bufferMax || cmd.offset + cmd.size > pub.dataSize)
          reject('C1_READ', 'حدودُ القطعة');
        return 'C1-read';
      }
      case 'ReadPublic':
        if (cmd.objectHandle !== g.verifiedEk || !sessionOk(cmd, ATTR_INTEGRITY))
          reject('C1_EK', 'C1: ReadPublic لمقبضِ EK المملَّحِ به');
        return 'C1-ek';
      case 'FlushContext':
        if (cmd.flushHandle === g.verifiedEk)
          reject('FLUSH_EK_BEFORE_C1', 'لا يُفرَّغُ مقبضُ EK قبلَ نجاحِ C1 (WL-447)');
        if (cmd.flushHandle === g.bootstrapSession.handle)
          reject('FLUSH_SESSION_BEFORE_C1', 'لا تُفرَّغُ الجلسةُ المملّحةُ قبلَ نجاحِ C1');
        if (!g.sessions.has(cmd.flushHandle) && cmd.flushHandle !== g.transientEk)
          reject('FLUSH_FOREIGN', 'مقبضٌ لم ينشئْه المُكيِّف');
        return 'flush';
      default:
        return reject('NOT_IN_SALTED', cmd.cc);
    }
  }

  /** @param {Loose} cmd @returns {string} */
  function checkConfirmed(cmd) {
    if (noSession(cmd) && ['GetCapability', 'NV_ReadPublic', 'ReadPublic'].includes(cmd.cc))
      reject('BOOTSTRAP_ROW_AFTER_SALT', cmd.cc);
    if (cmd.cc === 'CreatePrimary') reject('CREATEPRIMARY_AFTER_BOOTSTRAP', 'CreatePrimary');
    if (cmd.cc === 'NV_Read' && cmd.auth === 'PW') reject('BOOTSTRAP_ROW_AFTER_SALT', 'T3');
    if (
      cmd.cc === 'FlushContext' &&
      !g.sessions.has(cmd.flushHandle) &&
      cmd.flushHandle !== g.transientEk
    )
      reject('FLUSH_FOREIGN', 'مقبضٌ لم ينشئْه المُكيِّف');
    // ما عدا ذلك يُحالُ إلى الجدولِ العامّ في الملحق §4.3، وهو خارجَ هذا النموذج.
    return 'general';
  }

  // يبني الطلبَ بعدَ الفحص؛ ولا شيءَ يُرسَلُ إن رُفض.
  /** @param {Loose} input @returns {Loose} */
  function prepare(input) {
    if (g.state === 'closed') reject('CLOSED', g.closedReason);
    if (g.pending) reject('PENDING', 'أمرٌ واحدٌ في الطيران');
    const cmd = { ...input };
    const row =
      g.state === 'bootstrap'
        ? checkBootstrap(cmd)
        : g.state === 'salted'
          ? checkSalted(cmd)
          : checkConfirmed(cmd);
    if (cmd.cc === 'StartAuthSession') {
      cmd.nonceCaller = random(32);
      cmd.salt = { forPublic: g.ekPublicByHandle.get(cmd.tpmKey), value: random(32) };
      g.startAuthCount++;
    }
    if (cmd.session) cmd.session = { ...cmd.session, nonceCaller: random(32) };
    if (row === 'P0') g.p0Sent = true; // محاولةٌ واحدة، ولو لم يصلْ ردّ
    if (row === 'T5') g.createPrimaryCount++;
    g.pending = { cmd, row };
    g.log.push({ state: g.state, row, cc: cmd.cc });
    return cmd;
  }

  // ردّ: { rc, params, auth? } حيث auth = { nonceTPM, attrs, hmac } (ن2) أو { password: true } (ن3).
  /** @param {Loose} cmd @param {Loose} resp */
  function verifyN2(cmd, resp) {
    const s = g.bootstrapSession;
    if (resp.rc !== 0 || !resp.auth || resp.auth.password || !resp.auth.hmac) return false;
    if (resp.auth.attrs !== cmd.session.attrs) return false;
    const mac = responseHmac(
      s.key,
      rpHash(0, cmd.cc, resp.params),
      resp.auth.nonceTPM,
      cmd.session.nonceCaller,
      resp.auth.attrs,
    );
    if (!mac.equals(resp.auth.hmac)) return false;
    s.nonceTPM = resp.auth.nonceTPM;
    return true;
  }

  /** @param {Loose} st @param {Loose} params */
  function takePage(st, params) {
    const hs = params.handles;
    let prev = st.last;
    for (const h of hs) {
      if (prev !== null && h <= prev) return false; // ترتيبٌ صارمٌ بلا تكرار
      prev = h;
    }
    const inRange = hs.filter(
      (/** @type {number} */ h) => h >= EK_RANGE_FIRST && h <= EK_RANGE_LAST,
    );
    const ended = hs.some((/** @type {number} */ h) => h > EK_RANGE_LAST);
    inRange.forEach((/** @type {number} */ h) => st.handles.add(h));
    st.pages++;
    if (hs.length) st.last = hs[hs.length - 1];
    st.done = params.moreData === false || ended;
    if (!st.done && hs.length === 0) return false; // moreData = YES بلا عنصرٍ: لا تقدّم
    return true;
  }

  /** @type {(a: unknown, b: unknown) => boolean} */
  const sameBytes = (a, b) => Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b);
  /** @type {(a: unknown, b: unknown) => boolean} */
  const samePub = (a, b) => Boolean(a && b && canonical(a) === canonical(b));

  function maybeConfirm() {
    const c = g.c1;
    if (!c.done) return;
    if (c.handles.size !== g.t1.handles.size || [...c.handles].some((h) => !g.t1.handles.has(h))) {
      close('FRESHNESS_TPM_IDENTITY_UNPROVEN: مجموعةُ مقابضِ C1 ≠ T1');
      return;
    }
    if (c.ekPublic === null) return;
    for (const h of c.handles) {
      if (!c.pub.has(h)) return;
      const d = c.data.get(h);
      if (!d || d.length < c.pub.get(h).dataSize) return;
    }
    g.state = 'confirmed';
  }

  /** @param {Loose} resp @returns {Loose} */
  function accept(resp) {
    if (!g.pending) throw new Error('لا أمرَ معلّق');
    const { cmd, row } = g.pending;
    g.pending = null;
    const fail = (/** @type {string} */ why) => close(`FRESHNESS_TPM_IDENTITY_UNPROVEN: ${why}`);

    if (g.state === 'bootstrap') {
      if (row === 'P0') {
        // ن2 متحقَّقٌ منه وحدَه ينقلُ إلى salted؛ وكلُّ شكلٍ آخر (ن1، ن3، خطأ، HMAC فاسد) يُغلق.
        if (!verifyN2(cmd, resp)) return fail('ردُّ P0 ليسَ ن2 متحقَّقًا منه');
        g.state = 'salted';
        if (!takePage(g.c1, resp.params)) return fail('صفحةُ C1 الأولى غيرُ صالحة');
        maybeConfirm();
        return { state: g.state };
      }
      if (resp.rc !== 0) return close(`خطأ في ${row}`);
      if (row === 'SAS') {
        const nonceTPM = resp.params.nonceTPM;
        const key = sessionKeyFor(cmd.salt.value, nonceTPM, cmd.nonceCaller);
        g.bootstrapSession = {
          handle: resp.params.sessionHandle,
          salt: cmd.salt.value,
          nonceCaller: cmd.nonceCaller,
          nonceTPM,
          key,
        };
        g.sessions.set(resp.params.sessionHandle, g.bootstrapSession);
        return { state: g.state };
      }
      if (resp.auth && !(row === 'T3' || row === 'T5'))
        return close('ردٌّ بمنطقةِ تفويضٍ لأمرٍ بلا جلسات');
      if (row === 'T1' && !takePage(g.t1, resp.params)) return close('صفحةُ T1 غيرُ صالحة');
      if (row === 'T6') g.t6.bufferMax = resp.params.value;
      if (row === 'T2') g.t2.set(cmd.nvIndex, resp.params.nvPublic);
      if (row === 'T3') {
        const prev = g.t3.get(cmd.nvIndex) ?? Buffer.alloc(0);
        if (cmd.offset !== prev.length) return close('T3 خارجَ الترتيب');
        g.t3.set(cmd.nvIndex, Buffer.concat([prev, resp.params.data]));
      }
      if (row === 'T4' || row === 'T5') {
        const handle = row === 'T4' ? cmd.objectHandle : resp.params.objectHandle;
        if (row === 'T5') g.transientEk = handle;
        g.ekPublicByHandle.set(handle, resp.params.outPublic);
        // §3.2-2 (وإعادتُها كاملةً بعدَ T5): المفتاحُ يطابقُ SubjectPublicKeyInfo في الشهادة، وإلّا فرفضٌ قبلَ أيِّ جلسة.
        if (!samePub(resp.params.outPublic, certificateEkPublic))
          return fail('مفتاحُ EK لا يطابقُ الشهادة (§3.2-2)');
        g.verifiedEk = handle;
      }
      return { state: g.state };
    }

    if (g.state === 'salted') {
      if (row === 'flush') {
        if (resp.rc === 0) g.sessions.delete(cmd.flushHandle);
        return { state: g.state };
      }
      if (!verifyN2(cmd, resp)) return fail(`ردُّ C1 (${row}) ليسَ ن2 متحقَّقًا منه`);
      if (row === 'C1-list' && !takePage(g.c1, resp.params)) return fail('صفحةُ C1 غيرُ صالحة');
      if (row === 'C1-pub') {
        if (!samePub(resp.params.nvPublic, g.t2.get(cmd.nvIndex)))
          return fail(`المنطقةُ العامّةُ لـ0x${cmd.nvIndex.toString(16)} تختلف`);
        g.c1.pub.set(cmd.nvIndex, resp.params.nvPublic);
      }
      if (row === 'C1-read') {
        const prev = g.c1.data.get(cmd.nvIndex) ?? Buffer.alloc(0);
        if (cmd.offset !== prev.length) return fail('C1 خارجَ الترتيب');
        const next = Buffer.concat([prev, resp.params.data]);
        const boot = g.t3.get(cmd.nvIndex) ?? Buffer.alloc(0);
        if (!sameBytes(next, boot.subarray(0, next.length)) || next.length > boot.length)
          return fail(`محتوى 0x${cmd.nvIndex.toString(16)} يختلف`);
        g.c1.data.set(cmd.nvIndex, next);
      }
      if (row === 'C1-ek') {
        if (!samePub(resp.params.outPublic, g.ekPublicByHandle.get(g.verifiedEk)))
          return fail('TPMT_PUBLIC لـEK يختلف');
        g.c1.ekPublic = resp.params.outPublic;
      }
      maybeConfirm();
      return { state: g.state };
    }

    if (row === 'general' && cmd.cc === 'FlushContext' && resp.rc === 0)
      g.sessions.delete(cmd.flushHandle);
    return { state: g.state };
  }

  // بصمةُ الهويّة من بايتاتِ C1 وحدَها.
  function identityFingerprint() {
    if (g.state !== 'confirmed') return null;
    const parts = [...g.c1.handles]
      .sort((a, b) => a - b)
      .map((h) => [h, g.c1.pub.get(h), g.c1.data.get(h)]);
    return sha256(Buffer.from(canonical({ parts, ek: g.c1.ekPublic }))).toString('hex');
  }

  return {
    get state() {
      return g.state;
    },
    get closedReason() {
      return g.closedReason;
    },
    get log() {
      return g.log.slice();
    },
    prepare,
    accept,
    identityFingerprint,
    // للنموذجِ وحدَه: مقبضُ جلسةِ التمهيد بعدَ فتحِها.
    get bootstrapSessionHandle() {
      return g.bootstrapSession?.handle ?? null;
    },
  };
}
