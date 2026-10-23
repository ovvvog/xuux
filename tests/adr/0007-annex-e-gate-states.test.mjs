// اختباراتُ حالاتِ بوّابةِ الملحق هـ §4.3 — التنقيحُ السادس (WL-451، R5-01).
//
// **المُقيس:** أنّ قاعدةَ الانتقالِ المعدَّلة (أمرُ الإثباتِ P0) تُوصِلُ اتّصالًا سليمًا إلى `confirmed`
// بمفتاحِ EK مستمرٍّ وعابر، وأنّ كلَّ انحرافٍ عن شكلِ P0 أو ترتيبِه أو ردِّه يُرفَضُ قبلَ الإرسالِ أو
// يُغلقُ الاتّصال، وأنّ القاعدةَ السابقة (التنقيحُ الخامس) لا تبلغُ `salted` بأيِّ أمرٍ مسموح.
// **وهذه اختباراتُ اتّساقِ نصٍّ تصميميٍّ لا قياسُ عتادٍ ولا تمكينُ مصدرِ حداثة:** الـTPM هنا محاكاةٌ
// في الذاكرة، والنموذجُ في `docs/adr/` ولا يستوردُه مسارُ إنتاج. HMAC الردِّ و`KDFa` حقيقيّان.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  EK_INDICES,
  GateRejection,
  createGate,
  kdfa,
  responseHmac,
  rpHash,
  sessionKeyFor,
} from '../../docs/adr/0007-annex-e-reference-gate.mjs';

const EK_PUBLIC = { type: 'RSA', bits: 2048, n: 'aa'.repeat(32) };
const OTHER_PUBLIC = { type: 'RSA', bits: 2048, n: 'bb'.repeat(32) };
const PERSISTENT = 0x81010001;
const C_INDEX = 0x01800020;

/** @typedef {Record<string, any>} Loose */

/**
 * محاكاةُ TPM: تملكُ النظيرَ الخاصَّ لـownedPublic وحدَه.
 * @param {{ ekPublic?: unknown, ownedPublic?: unknown, persistent?: boolean, nv?: Array<[number, Loose]>, pageSize?: number }} [options]
 * @returns {Loose}
 */
function simulatedTpm({
  ekPublic = EK_PUBLIC,
  ownedPublic = EK_PUBLIC,
  persistent = true,
  nv,
  pageSize = 16,
} = {}) {
  /** @type {Map<number, Loose>} */
  const store = new Map(
    nv ?? [
      [0x01c00002, { pub: { dataSize: 40, attrs: 'cert' }, data: Buffer.alloc(40, 0x11) }],
      [0x01c00004, { pub: { dataSize: 24, attrs: 'tmpl' }, data: Buffer.alloc(24, 0x22) }],
      [0x01c0000a, { pub: { dataSize: 8, attrs: 'cert-ecc' }, data: Buffer.alloc(8, 0x33) }],
      [C_INDEX, { pub: { dataSize: 8, attrs: 'C' }, data: Buffer.alloc(8, 0x44) }],
      [0x01d00000, { pub: { dataSize: 4, attrs: 'other' }, data: Buffer.alloc(4, 0x55) }],
    ],
  );
  /** @type {Map<number, Loose>} */
  const sessions = new Map();
  let nextSession = 0x02000000;
  /** @type {Loose} */
  const tpm = {
    store,
    sessions,
    transient: null,
    /** @param {Loose} cmd @returns {Loose} */
    respond(cmd) {
      /** @type {(params: Loose, auth?: Loose) => Loose} */
      const ok = (params, auth) => ({ rc: 0, params, ...(auth ? { auth } : {}) });
      const withSession = (/** @type {Loose} */ params) => {
        if (cmd.auth === 'PW') return ok(params, { password: true });
        if (!cmd.session) return ok(params);
        const s = sessions.get(cmd.session.handle);
        if (!s) return { rc: 0x98b };
        const nonceTPM = randomBytes(32);
        const hmac = responseHmac(
          s.key,
          rpHash(0, cmd.cc, params),
          nonceTPM,
          cmd.session.nonceCaller,
          cmd.session.attrs,
        );
        return ok(params, { nonceTPM, attrs: cmd.session.attrs, hmac });
      };
      switch (cmd.cc) {
        case 'GetCapability': {
          if (cmd.capability === 'TPM_PROPERTIES') return withSession({ value: 16 });
          const all = [...store.keys()].sort((a, b) => a - b).filter((h) => h >= cmd.property);
          const n = Math.min(cmd.propertyCount, pageSize);
          return withSession({ handles: all.slice(0, n), moreData: all.length > n });
        }
        case 'NV_ReadPublic':
          return withSession({ nvPublic: /** @type {Loose} */ (store.get(cmd.nvIndex)).pub });
        case 'NV_Read':
          return withSession({
            data: /** @type {Loose} */ (store.get(cmd.nvIndex)).data.subarray(
              cmd.offset,
              cmd.offset + cmd.size,
            ),
          });
        case 'ReadPublic': {
          if (cmd.objectHandle === PERSISTENT && persistent)
            return withSession({ outPublic: ekPublic });
          if (cmd.objectHandle === tpm.transient) return withSession({ outPublic: ekPublic });
          return { rc: 0x18b };
        }
        case 'CreatePrimary':
          tpm.transient = 0x80000001;
          return withSession({ objectHandle: tpm.transient, outPublic: ekPublic });
        case 'StartAuthSession': {
          // الملحُ مشفَّرٌ لـforPublic؛ ولا يقرؤُه إلّا مالكُ نظيرِه الخاصّ.
          const owns = JSON.stringify(cmd.salt.forPublic) === JSON.stringify(ownedPublic);
          const salt = owns ? cmd.salt.value : randomBytes(32);
          const nonceTPM = randomBytes(32);
          const handle = nextSession++;
          sessions.set(handle, { key: sessionKeyFor(salt, nonceTPM, cmd.nonceCaller) });
          return ok({ sessionHandle: handle, nonceTPM });
        }
        case 'FlushContext':
          sessions.delete(cmd.flushHandle);
          return ok({});
        default:
          return ok({});
      }
    },
  };
  return tpm;
}

/**
 * @param {Loose} gate @param {Loose} tpm @param {Loose} cmd @param {((r: Loose, c: Loose) => Loose)} [tamper]
 * @returns {Loose}
 */
function send(gate, tpm, cmd, tamper) {
  const prepared = gate.prepare(cmd);
  let resp = tpm.respond(prepared);
  if (tamper) resp = tamper(resp, prepared);
  return { prepared, resp, out: gate.accept(resp) };
}

/**
 * @param {Loose} gate @param {Loose} tpm @param {number | undefined} sessionAttrs @param {string} startState
 * @param {((r: Loose, c: Loose) => Loose)} [tamper]
 * @returns {number[]}
 */
function listing(gate, tpm, sessionAttrs, startState, tamper) {
  let property = 0x01c00002;
  /** @type {number[]} */
  const seen = [];
  for (let page = 0; page < 64; page++) {
    /** @type {Loose} */
    const cmd = { cc: 'GetCapability', capability: 'HANDLES', property, propertyCount: 16 };
    if (sessionAttrs !== undefined)
      cmd.session = { handle: gate.bootstrapSessionHandle, attrs: sessionAttrs };
    const { resp } = send(gate, tpm, cmd, tamper);
    if (gate.state !== startState) return seen;
    seen.push(...resp.params.handles);
    if (
      !resp.params.moreData ||
      resp.params.handles.some((/** @type {number} */ h) => h > 0x01c0000c)
    )
      return seen;
    property = resp.params.handles.at(-1) + 1;
  }
  throw new Error('listing did not terminate');
}

const ek6 = (/** @type {number[]} */ handles) => handles.filter((h) => EK_INDICES.includes(h));

/** التمهيدُ كاملًا حتى ما قبلَ StartAuthSession. يُعيدُ { ekHandle, indices }. */
/**
 * @param {Loose} gate @param {Loose} tpm
 * @param {{ transient?: boolean, tamperT1?: (r: Loose, c: Loose) => Loose }} [options]
 */
function bootstrapRows(gate, tpm, { transient = false, tamperT1 } = {}) {
  send(gate, tpm, {
    cc: 'GetCapability',
    capability: 'TPM_PROPERTIES',
    property: 0x12c,
    propertyCount: 1,
  });
  const indices = ek6(listing(gate, tpm, undefined, 'bootstrap', tamperT1));
  for (const i of indices) {
    const { resp } = send(gate, tpm, { cc: 'NV_ReadPublic', nvIndex: i });
    for (let off = 0; off < resp.params.nvPublic.dataSize; off += 16) {
      send(gate, tpm, {
        cc: 'NV_Read',
        nvIndex: i,
        offset: off,
        size: Math.min(16, resp.params.nvPublic.dataSize - off),
        auth: 'PW',
      });
    }
  }
  let ekHandle = PERSISTENT;
  if (transient) {
    const { resp } = send(gate, tpm, {
      cc: 'CreatePrimary',
      primaryHandle: 'ENDORSEMENT',
      auth: 'PW',
    });
    ekHandle = resp.params.objectHandle;
  } else {
    send(gate, tpm, { cc: 'ReadPublic', objectHandle: PERSISTENT });
  }
  return { ekHandle, indices };
}

/** @type {(tpmKey: number, sessionType?: string) => Loose} */
const sas = (tpmKey, sessionType = 'HMAC') => ({
  cc: 'StartAuthSession',
  tpmKey,
  bind: 'NULL',
  sessionType,
});
/** @type {(gate: Loose, attrs?: number, extra?: Loose) => Loose} */
const p0 = (gate, attrs = 0x81, extra = {}) => ({
  cc: 'GetCapability',
  capability: 'HANDLES',
  property: 0x01c00002,
  propertyCount: 16,
  session: { handle: gate.bootstrapSessionHandle, attrs },
  ...extra,
});

/** C1 بعدَ salted حتى confirmed. */
/**
 * @param {Loose} gate @param {Loose} tpm @param {number} ekHandle @param {((r: Loose, c: Loose) => Loose)} [tamper]
 */
function confirmRows(gate, tpm, ekHandle, tamper) {
  const s = (/** @type {number} */ attrs) => ({ handle: gate.bootstrapSessionHandle, attrs });
  const indices = [...ek6([...tpm.store.keys()])].sort((a, b) => a - b);
  for (const i of indices) {
    if (gate.state !== 'salted') return;
    const { resp } = send(gate, tpm, { cc: 'NV_ReadPublic', nvIndex: i, session: s(0x81) }, tamper);
    if (gate.state !== 'salted') return;
    for (let off = 0; off < resp.params.nvPublic.dataSize; off += 16) {
      send(
        gate,
        tpm,
        {
          cc: 'NV_Read',
          nvIndex: i,
          offset: off,
          size: Math.min(16, resp.params.nvPublic.dataSize - off),
          session: s(0x01),
        },
        tamper,
      );
      if (gate.state !== 'salted') return;
    }
  }
  send(gate, tpm, { cc: 'ReadPublic', objectHandle: ekHandle, session: s(0x81) }, tamper);
}

/** @param {{ transient?: boolean, persistent?: boolean, tpmOptions?: Loose }} [options] */
function fullRun({ transient = false, persistent = true, tpmOptions = {} } = {}) {
  const tpm = simulatedTpm({ persistent, ...tpmOptions });
  const gate = createGate({
    persistentEkHandle: persistent ? PERSISTENT : null,
    certificateEkPublic: EK_PUBLIC,
  });
  const { ekHandle } = bootstrapRows(gate, tpm, { transient });
  send(gate, tpm, sas(ekHandle));
  send(gate, tpm, p0(gate));
  assert.equal(gate.state, 'salted');
  confirmRows(gate, tpm, ekHandle);
  return { gate, tpm, ekHandle };
}

/** @type {(fn: () => unknown, code: string) => void} */
const rejects = (fn, code) =>
  assert.throws(fn, (e) => e instanceof GateRejection && e.code === code, code);

test('R5-02: KDFa مطابقٌ لـSP 800-108 بعدّادٍ واحد، وsessionKey = KDFa(salt, "ATH", nonceTPM, nonceCaller, 256)', () => {
  const salt = Buffer.alloc(32, 1);
  const nt = Buffer.alloc(32, 2);
  const nc = Buffer.alloc(32, 3);
  const key = sessionKeyFor(salt, nt, nc);
  assert.equal(key.length, 32);
  assert.ok(key.equals(kdfa(salt, 'ATH', nt, nc, 256)));
  // ترتيبُ السياق جزءٌ من التعريف: تبديلُ الـnonceَين يغيّرُ المفتاح.
  assert.ok(!key.equals(kdfa(salt, 'ATH', nc, nt, 256)));
});

test('EK مستمرّ (T4): bootstrap → salted بـP0 → confirmed، والبصمةُ من C1', () => {
  const { gate } = fullRun();
  assert.equal(gate.state, 'confirmed');
  assert.match(String(gate.identityFingerprint()), /^[0-9a-f]{64}$/);
  const rows = gate.log.map((/** @type {Loose} */ l) => `${l.state}:${l.row}`);
  assert.equal(rows.filter((/** @type {string} */ r) => r === 'bootstrap:P0').length, 1);
  assert.ok(rows.indexOf('bootstrap:SAS') < rows.indexOf('bootstrap:P0'));
});

test('EK عابر (T5 ثمّ إعادةُ §3.2-2): يبلغُ confirmed، ولا يُفرَّغُ المقبضُ العابرُ في salted', () => {
  const tpm = simulatedTpm({ persistent: false });
  const gate = createGate({ certificateEkPublic: EK_PUBLIC });
  const { ekHandle } = bootstrapRows(gate, tpm, { transient: true });
  assert.equal(ekHandle, 0x80000001);
  send(gate, tpm, sas(ekHandle));
  send(gate, tpm, p0(gate));
  assert.equal(gate.state, 'salted');
  rejects(() => gate.prepare({ cc: 'FlushContext', flushHandle: ekHandle }), 'FLUSH_EK_BEFORE_C1');
  confirmRows(gate, tpm, ekHandle);
  assert.equal(gate.state, 'confirmed');
  send(gate, tpm, { cc: 'FlushContext', flushHandle: ekHandle });
  assert.equal(gate.state, 'confirmed');
});

test('صفحاتُ P0/C1 المتعدّدة: ردُّ P0 صفحةُ C1 الأولى، والتتابعُ في salted من آخرِ مقبضٍ + 1', () => {
  const tpm = simulatedTpm({ pageSize: 1 });
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  const { ekHandle } = bootstrapRows(gate, tpm);
  send(gate, tpm, sas(ekHandle));
  const { resp } = send(gate, tpm, p0(gate));
  assert.equal(gate.state, 'salted');
  assert.equal(resp.params.moreData, true);
  // البدايةُ ثابتةٌ للصفحةِ الأولى وحدَها: إعادةُ 0x01c00002 في salted رفض.
  rejects(() => gate.prepare(p0(gate)), 'C1_LISTING');
  let property = resp.params.handles.at(-1) + 1;
  for (;;) {
    const r = send(gate, tpm, {
      cc: 'GetCapability',
      capability: 'HANDLES',
      property,
      propertyCount: 16,
      session: { handle: gate.bootstrapSessionHandle, attrs: 0x81 },
    }).resp;
    if (!r.params.moreData || r.params.handles.some((/** @type {number} */ h) => h > 0x01c0000c))
      break;
    property = r.params.handles.at(-1) + 1;
  }
  confirmRows(gate, tpm, ekHandle);
  assert.equal(gate.state, 'confirmed');
});

test('R5-01 (الإثباتُ السلبيّ): بقاعدةِ التنقيحِ الخامس لا يبلغُ أيُّ أمرٍ مسموحٍ salted', () => {
  const tpm = simulatedTpm();
  const gate = createGate({
    persistentEkHandle: PERSISTENT,
    certificateEkPublic: EK_PUBLIC,
    revision: 5,
  });
  const { ekHandle } = bootstrapRows(gate, tpm);
  send(gate, tpm, sas(ekHandle));
  send(gate, tpm, sas(ekHandle, 'POLICY')); // التنقيحُ الخامس يسمحُ بالنوعَين وبأكثرَ من جلسة
  const session = { handle: gate.bootstrapSessionHandle, attrs: 0x81 };
  const candidates = [
    p0(gate),
    {
      cc: 'GetCapability',
      capability: 'TPM_PROPERTIES',
      property: 0x12c,
      propertyCount: 1,
      session,
    },
    { cc: 'NV_ReadPublic', nvIndex: 0x01c00002, session },
    {
      cc: 'NV_Read',
      nvIndex: 0x01c00002,
      offset: 0,
      size: 8,
      session: { ...session, attrs: 0x01 },
    },
    { cc: 'ReadPublic', objectHandle: ekHandle, session },
    { cc: 'CreatePrimary', primaryHandle: 'ENDORSEMENT', session },
  ];
  for (const c of candidates) assert.throws(() => gate.prepare(c), GateRejection);
  // والأوامرُ المقبولة (T2/T3/T4/T6 بلا جلسات) لا تحملُ ردودُها ن2.
  const accepted = [
    { cc: 'GetCapability', capability: 'TPM_PROPERTIES', property: 0x12c, propertyCount: 1 },
    { cc: 'NV_ReadPublic', nvIndex: 0x01c00002 },
    { cc: 'NV_Read', nvIndex: 0x01c00002, offset: 40, size: 0, auth: 'PW' }, // متابعةٌ صحيحةٌ بعدَ آخرِ قطعة
    { cc: 'ReadPublic', objectHandle: ekHandle },
  ];
  for (const c of accepted) {
    const { resp } = send(gate, tpm, c);
    assert.ok(!resp.auth || resp.auth.password, `${c.cc}: ن1 أو ن3`);
    assert.equal(gate.state, 'bootstrap');
  }
});

test('P0 قبلَ StartAuthSession، وقبلَ اكتمالِ T1: رفضٌ قبلَ الإرسال', () => {
  const tpm = simulatedTpm({ pageSize: 1 });
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  send(gate, tpm, {
    cc: 'GetCapability',
    capability: 'HANDLES',
    property: 0x01c00002,
    propertyCount: 16,
  });
  rejects(
    () => gate.prepare({ ...p0(gate), session: { handle: 0x02000000, attrs: 0x81 } }),
    'P0_BEFORE_T1',
  );
  const tpm2 = simulatedTpm();
  const gate2 = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  bootstrapRows(gate2, tpm2);
  rejects(
    () => gate2.prepare({ ...p0(gate2), session: { handle: 0x02000000, attrs: 0x81 } }),
    'P0_NO_SESSION',
  );
  assert.equal(gate2.state, 'bootstrap');
});

test('شكلُ P0: السمة 0x01، وجلسةٌ أخرى، وخاصّيّةٌ أو قدرةٌ أخرى، وpropertyCount > 16، وتفويض — كلُّها رفض', () => {
  const tpm = simulatedTpm();
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  const { ekHandle } = bootstrapRows(gate, tpm);
  send(gate, tpm, sas(ekHandle));
  rejects(() => gate.prepare(p0(gate, 0x01)), 'P0_ATTRS');
  rejects(
    () => gate.prepare(p0(gate, 0x81, { session: { handle: 0x02000099, attrs: 0x81 } })),
    'P0_SESSION',
  );
  rejects(() => gate.prepare(p0(gate, 0x81, { property: 0x01000000 })), 'P0_SHAPE');
  rejects(() => gate.prepare(p0(gate, 0x81, { property: 0x81000000 })), 'P0_SHAPE');
  rejects(
    () =>
      gate.prepare(
        p0(gate, 0x81, { capability: 'TPM_PROPERTIES', property: 0x12c, propertyCount: 1 }),
      ),
    'P0_SHAPE',
  );
  rejects(() => gate.prepare(p0(gate, 0x81, { propertyCount: 17 })), 'P0_SHAPE');
  rejects(() => gate.prepare(p0(gate, 0x81, { auth: 'PW' })), 'P0_SHAPE');
  // الجلسةُ نفسُها على أيِّ صفٍّ آخرَ في bootstrap رفض.
  rejects(
    () =>
      gate.prepare({
        cc: 'NV_ReadPublic',
        nvIndex: 0x01c00002,
        session: { handle: gate.bootstrapSessionHandle, attrs: 0x81 },
      }),
    'SESSION_IN_BOOTSTRAP',
  );
  rejects(
    () =>
      gate.prepare({
        cc: 'ReadPublic',
        objectHandle: ekHandle,
        session: { handle: gate.bootstrapSessionHandle, attrs: 0x81 },
      }),
    'SESSION_IN_BOOTSTRAP',
  );
  assert.equal(gate.state, 'bootstrap');
  // ولم يُستهلَكْ P0 بعد: الشكلُ الصحيحُ ما زالَ ممكنًا.
  send(gate, tpm, p0(gate));
  assert.equal(gate.state, 'salted');
});

/** @type {Array<[string, (r: Loose) => Loose]>} */
const P0_TAMPERS = [
  ['ن1 (بلا منطقةِ تفويض)', (r) => ({ rc: 0, params: r.params })],
  ['ن3 (ردُّ كلمةِ مرور)', (r) => ({ rc: 0, params: r.params, auth: { password: true } })],
  ['خطأ (rc ≠ 0)', () => ({ rc: 0x18b, params: {} })],
  ['HMAC فاسد', (r) => ({ ...r, auth: { ...r.auth, hmac: Buffer.alloc(32) } })],
  ['سماتٌ مختلفة في الردّ', (r) => ({ ...r, auth: { ...r.auth, attrs: 0x01 } })],
  [
    'معاملاتٌ مُبدَّلة (إسقاطُ فهرس) معَ HMAC الأصل',
    (r) => ({ ...r, params: { ...r.params, handles: r.params.handles.slice(1) } }),
  ],
];
for (const [name, tamper] of P0_TAMPERS) {
  test(`ردُّ P0 ${name}: إغلاقٌ، ولا محاولةَ ثانية`, () => {
    const tpm = simulatedTpm();
    const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
    const { ekHandle } = bootstrapRows(gate, tpm);
    send(gate, tpm, sas(ekHandle));
    send(gate, tpm, p0(gate), tamper);
    assert.equal(gate.state, 'closed');
    assert.match(gate.closedReason, /FRESHNESS_TPM_IDENTITY_UNPROVEN/);
    rejects(() => gate.prepare(p0(gate)), 'CLOSED');
  });
}

test('P0 الثاني في الاتّصالِ نفسِه رفض (محاولةٌ واحدة): ولو قبلَ وصولِ الردّ', () => {
  const tpm = simulatedTpm();
  const g2 = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  const { ekHandle } = bootstrapRows(g2, tpm);
  send(g2, tpm, sas(ekHandle));
  g2.prepare(p0(g2));
  rejects(() => g2.prepare(p0(g2)), 'PENDING');
});

test('وسيطٌ يقدّمُ مفتاحَ EK آخر لا يطابقُ الشهادة: رفضٌ قبلَ أيِّ جلسة', () => {
  const tpm = simulatedTpm({ ekPublic: OTHER_PUBLIC, ownedPublic: OTHER_PUBLIC });
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  bootstrapRows(gate, tpm);
  assert.equal(gate.state, 'closed');
  assert.match(gate.closedReason, /§3\.2-2/);
});

test('وسيطٌ يمرّرُ المفتاحَ الصحيحَ بلا نظيرِه الخاصّ: لا يحسبُ HMAC ردِّ P0، فلا salted', () => {
  // الـ«TPM» هنا وسيطٌ يعرضُ EK_PUBLIC ولا يملكُ إلّا OTHER_PUBLIC.
  const tpm = simulatedTpm({ ekPublic: EK_PUBLIC, ownedPublic: OTHER_PUBLIC });
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  const { ekHandle } = bootstrapRows(gate, tpm);
  send(gate, tpm, sas(ekHandle));
  send(gate, tpm, p0(gate));
  assert.equal(gate.state, 'closed');
});

test('bootstrap: StartAuthSession من نوعِ السياسة، أو ثانٍ، أو بمفتاحٍ لم يجتزْ §3.2-2 — رفض', () => {
  const tpm = simulatedTpm();
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  rejects(() => gate.prepare(sas(PERSISTENT)), 'SAS_TPMKEY');
  const { ekHandle } = bootstrapRows(gate, tpm);
  rejects(() => gate.prepare(sas(ekHandle, 'POLICY')), 'SAS_TYPE_BOOTSTRAP');
  rejects(() => gate.prepare({ ...sas(ekHandle), bind: 0x40000001 }), 'SAS_BIND');
  send(gate, tpm, sas(ekHandle));
  rejects(() => gate.prepare(sas(ekHandle)), 'SAS_ONCE_BOOTSTRAP');
});

test('قبلَ confirmed: لا C ولا R ولا أمرَ مُغيِّر، في bootstrap وsalted', () => {
  const tpm = simulatedTpm();
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  rejects(
    () => gate.prepare({ cc: 'NV_Read', nvIndex: C_INDEX, offset: 0, size: 8, auth: 'PW' }),
    'T3_INDEX',
  );
  rejects(() => gate.prepare({ cc: 'NV_ReadPublic', nvIndex: C_INDEX }), 'T2_INDEX');
  rejects(
    () => gate.prepare({ cc: 'NV_Increment', nvIndex: C_INDEX }),
    'MUTATING_BEFORE_CONFIRMED',
  );
  const { ekHandle } = bootstrapRows(gate, tpm);
  send(gate, tpm, sas(ekHandle));
  send(gate, tpm, p0(gate));
  assert.equal(gate.state, 'salted');
  const s = { handle: gate.bootstrapSessionHandle, attrs: 0x01 };
  rejects(
    () => gate.prepare({ cc: 'NV_Read', nvIndex: C_INDEX, offset: 0, size: 8, session: s }),
    'C1_READ',
  );
  rejects(() => gate.prepare({ cc: 'NV_Write', nvIndex: C_INDEX }), 'MUTATING_BEFORE_CONFIRMED');
  rejects(() => gate.prepare({ cc: 'NV_DefineSpace' }), 'MUTATING_BEFORE_CONFIRMED');
  rejects(
    () =>
      gate.prepare({
        cc: 'StartAuthSession',
        tpmKey: ekHandle,
        bind: 'NULL',
        sessionType: 'POLICY',
      }),
    'NOT_IN_SALTED',
  );
});

test('لا رجوع: صفوفُ التمهيدِ بلا جلساتٍ ترفضُ في salted وconfirmed، وCreatePrimary كذلك', () => {
  const tpm = simulatedTpm();
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  const { ekHandle } = bootstrapRows(gate, tpm);
  send(gate, tpm, sas(ekHandle));
  send(gate, tpm, p0(gate));
  for (const st of ['salted', 'confirmed']) {
    assert.equal(gate.state, st);
    rejects(
      () =>
        gate.prepare({
          cc: 'GetCapability',
          capability: 'HANDLES',
          property: 0x01c00002,
          propertyCount: 16,
        }),
      'BOOTSTRAP_ROW_AFTER_SALT',
    );
    rejects(
      () => gate.prepare({ cc: 'NV_ReadPublic', nvIndex: 0x01c00002 }),
      'BOOTSTRAP_ROW_AFTER_SALT',
    );
    rejects(
      () => gate.prepare({ cc: 'NV_Read', nvIndex: 0x01c00002, offset: 0, size: 8, auth: 'PW' }),
      'BOOTSTRAP_ROW_AFTER_SALT',
    );
    rejects(
      () => gate.prepare({ cc: 'ReadPublic', objectHandle: ekHandle }),
      'BOOTSTRAP_ROW_AFTER_SALT',
    );
    assert.throws(
      () => gate.prepare({ cc: 'CreatePrimary', primaryHandle: 'ENDORSEMENT', auth: 'PW' }),
      GateRejection,
    );
    if (st === 'salted') confirmRows(gate, tpm, ekHandle);
  }
});

test('C1: وسيطٌ يُسقطُ فهرسَ القالبِ في T1 ثمّ يمرّرُه في P0 ⇒ إغلاق', () => {
  const tpm = simulatedTpm();
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  const dropTemplate = (/** @type {Loose} */ r) =>
    r.params.handles
      ? {
          ...r,
          params: {
            ...r.params,
            handles: r.params.handles.filter((/** @type {number} */ h) => h !== 0x01c00004),
          },
        }
      : r;
  const { ekHandle } = bootstrapRows(gate, tpm, { tamperT1: dropTemplate });
  send(gate, tpm, sas(ekHandle));
  send(gate, tpm, p0(gate));
  assert.equal(gate.state, 'closed');
  assert.match(gate.closedReason, /C1 ≠ T1/);
});

test('C1: اختلافُ بايتٍ واحدٍ بينَ T3 وC1 ⇒ إغلاق، وفي المنطقةِ العامّة كذلك', () => {
  for (const which of ['data', 'pub']) {
    const tpm = simulatedTpm();
    const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
    const { ekHandle } = bootstrapRows(gate, tpm);
    send(gate, tpm, sas(ekHandle));
    send(gate, tpm, p0(gate));
    const entry = tpm.store.get(0x01c00002);
    if (which === 'data') {
      entry.data = Buffer.from(entry.data);
      entry.data[3] ^= 1;
    } else entry.pub = { ...entry.pub, attrs: 'changed' };
    confirmRows(gate, tpm, ekHandle);
    assert.equal(gate.state, 'closed', which);
  }
});

test('salted: لا تُفرَّغُ الجلسةُ المملّحةُ قبلَ C1، ولا مقبضٌ لم ينشئْه المُكيِّف', () => {
  const tpm = simulatedTpm();
  const gate = createGate({ persistentEkHandle: PERSISTENT, certificateEkPublic: EK_PUBLIC });
  const { ekHandle } = bootstrapRows(gate, tpm);
  send(gate, tpm, sas(ekHandle));
  send(gate, tpm, p0(gate));
  rejects(
    () => gate.prepare({ cc: 'FlushContext', flushHandle: gate.bootstrapSessionHandle }),
    'FLUSH_SESSION_BEFORE_C1',
  );
  rejects(
    () => gate.prepare({ cc: 'FlushContext', flushHandle: PERSISTENT }),
    'FLUSH_EK_BEFORE_C1',
  );
  rejects(() => gate.prepare({ cc: 'FlushContext', flushHandle: 0x02000077 }), 'FLUSH_FOREIGN');
});

test('النموذجُ تصميميّ: لا يستوردُه src/ ولا sim/، والملحقُ يعلنُ P0 وصيغةَ sessionKey', () => {
  const root = new URL('../../', import.meta.url).pathname;
  /** @type {(dir: string) => string[]} */
  const walk = (dir) =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (n === 'node_modules' || n === 'bin' || n === 'obj') return [];
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  for (const top of ['src', 'sim']) {
    for (const f of walk(join(root, top))) {
      if (!/\.(mjs|js|cjs|ts|cs)$/.test(f)) continue;
      assert.ok(!readFileSync(f, 'utf8').includes('0007-annex-e-reference-gate'), f);
    }
  }
  const annex = readFileSync(
    join(root, 'docs/adr/0007-annex-e-production-backend-design.md'),
    'utf8',
  );
  assert.match(annex, /\| P0 \| `GetCapability`/);
  assert.match(annex, /sessionKey = KDFa\(SHA-256, salt, "ATH", nonceTPM, nonceCaller, 256\)/);
  assert.match(annex, /0007-annex-e-reference-gate\.mjs/);
});
