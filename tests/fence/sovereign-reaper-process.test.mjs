/**
 * حاصدُ عمليّةِ السياديّ (‏`WL-546`) — `scripts/fence-sovereign-reaper.mjs` عمليّةٌ مستقلّةٌ عن الجذرِ وحافظِ الإيجار.
 *
 * الدليلُ الحاسمُ عمليّتان حقيقيّتان (‏لا نداءٌ في عمليّةٍ واحدة): عمليّةُ جذرٍ ابنةٌ (‏`node`) تُصدِرُ الاعتمادَ وتُشغِّلُ
 * حافظَ الإيجار، وعمليّةُ حاصدٍ ابنةٌ ثانيةٌ بوصلةِ `xf_sovereign`؛ تُقتَلُ عمليّةُ الجذرِ بـSIGKILL فعلاً ويُقاسُ
 * `revoked_at − expires_at` بساعةِ القاعدة. فُصِلَ في ملفٍّ لأنّه يقيسُ بساعةٍ حقيقيّة (‏نافذةُ 5 ث) — مهلةُ الملفِّ
 * الواحد (‏`--test-timeout=120000`). الحزامُ وحدودُه كما في `tests/fence/db-fence.test.mjs`؛ ولا تنصيبَ ولا مضيف:
 * العمليّتان ابنتا الاختبارِ على قاعدةٍ معزولة.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import {
  FENCE_ERRORS,
  REAPER_ERROR_TABLE,
  REAPER_RETRY_FLOOR_MS,
  classifyReaperError,
  runSovereignReaper,
  sealFencedSessions,
  startLapseReaper,
} from '../../src/fence/db-fence.mjs';
import { databaseUrl, quoteIdent, skipWithoutDatabase } from '../helpers/pg.mjs';
import { harness, rejection } from '../helpers/fence-harness.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const REAPER_CLI = fileURLToPath(
  new URL('../../scripts/fence-sovereign-reaper.mjs', import.meta.url),
);
const FENCE_MODULE = new URL('../../src/fence/db-fence.mjs', import.meta.url).href;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** @template T @param {T[]} xs @returns {T} */
const first = (xs) => {
  const x = xs[0];
  if (x === undefined) throw new Error('فارغ');
  return x;
};

// ── WL-546: النداءاتُ الراجعةُ لا تُسقِطُ الجدولة (‏بلا قاعدة) ───────────────────────────────

describe('WL-546: startLapseReaper — استثناءُ نداءٍ راجعٍ لا يوقفُ النبض', () => {
  test('onReap يرمي في كلِّ نداء: النبضُ يمضي، والاستثناءُ يُعَدُّ ويُبلَّغ', async () => {
    let calls = 0;
    /** @type {unknown[]} */
    const reported = [];
    const h = startLapseReaper(
      {
        reapLapsed: async () => {
          calls += 1;
          return { ok: true, reaped: [{ role: `r${calls}` }], unresolved: [], next_due_ms: 10 };
        },
      },
      {
        ceilingMs: 50,
        minDelayMs: 1,
        onReap: () => {
          throw new Error('onReap boom');
        },
        onCallbackError: (e) => reported.push(e),
      },
    );
    await sleep(250);
    await h.stop();
    const s = h.stats();
    assert.ok(s.ticks >= 5, `النبضُ مضى بعدَ الاستثناء (‏${s.ticks})`);
    assert.equal(s.reaped, s.ticks, 'كلُّ حصادٍ عُدَّ رغمَ رمي onReap');
    assert.equal(s.callbackErrors, s.ticks);
    assert.equal(reported.length, s.ticks);
    assert.equal(s.errors, 0, 'استثناءُ النداءِ الراجعِ ليس فشلَ حصاد');
  });

  test('onError يرمي والحصادُ يفشلُ دائماً: إعادةٌ بعدَ retryMs بلا توقّفٍ ولا حلقةٍ ساخنة', async () => {
    /** @type {number[]} */
    const at = [];
    const h = startLapseReaper(
      {
        reapLapsed: async () => {
          at.push(Date.now());
          throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
        },
      },
      {
        ceilingMs: 1000,
        retryMs: 40,
        onError: () => {
          throw new Error('onError boom');
        },
      },
    );
    await sleep(330);
    await h.stop();
    const s = h.stats();
    assert.ok(s.ticks >= 4 && s.ticks <= 10, `إعادةٌ مضبوطةٌ بـretryMs (‏${s.ticks} في 330 مث)`);
    assert.equal(s.errors, s.ticks);
    assert.equal(s.callbackErrors, s.ticks, 'رميُ onError عُدَّ ولم يوقفِ الإعادة');
    assert.equal(s.reaped, 0, 'لا يُعلَنُ حصادٌ لم يقع');
    for (let i = 1; i < at.length; i++)
      assert.ok(Number(at[i]) - Number(at[i - 1]) >= 35, 'لا حلقةَ ساخنة');
  });

  test('onCallbackError نفسُه يرمي: يُبتلَعُ والحاصدُ يمضي', async () => {
    const h = startLapseReaper(
      { reapLapsed: async () => ({ ok: false, reaped: [], unresolved: ['x'], next_due_ms: 0 }) },
      {
        ceilingMs: 50,
        retryMs: 10,
        onReap: () => {
          throw new Error('a');
        },
        onCallbackError: () => {
          throw new Error('b');
        },
      },
    );
    await sleep(120);
    await h.stop();
    const s = h.stats();
    assert.ok(s.ticks >= 4, `${s.ticks}`);
    assert.equal(s.callbackErrors, s.ticks);
    assert.equal(s.unresolved, s.ticks, 'غيرُ المحسومِ يُعَدّ ويُعادُ قريباً');
  });

  test('stop() ينتظرُ النداءَ الجاري ولا نداءَ بعدَه — ولو رمى onReap', async () => {
    /** @type {(v: any) => void} */
    let release = () => {};
    let calls = 0;
    const h = startLapseReaper(
      {
        reapLapsed: () => {
          calls += 1;
          return new Promise((r) => (release = r));
        },
      },
      {
        ceilingMs: 20,
        minDelayMs: 1,
        onReap: () => {
          throw new Error('boom');
        },
      },
    );
    await sleep(10);
    assert.equal(calls, 1);
    let done = false;
    const stopping = h.stop().then(() => (done = true));
    await sleep(30);
    assert.equal(done, false, 'stop() لم يَعُد والنداءُ جارٍ');
    release({ ok: true, reaped: [{ role: 'x' }], unresolved: [], next_due_ms: 1 });
    await stopping;
    await sleep(60);
    assert.equal(calls, 1, 'لا نداءَ بعدَ stop()');
    assert.equal(h.stopped(), true);
    assert.equal(h.stats().callbackErrors, 1);
  });
});

// ── WL-546: runSovereignReaper (‏اتصالٌ مزيّف) ────────────────────────────────────────────

describe('WL-546: runSovereignReaper — اتصالٌ عندَ الحاجةِ وإعادةُ اتصالٍ ودورٌ مفروض', () => {
  /**
   * @param {{ role?: string, reapFails?: number, result?: any }} [o]
   */
  const fakeClient = (o = {}) => {
    const st = { ended: 0, reaps: 0, fails: o.reapFails ?? 0 };
    const c = {
      st,
      on() {},
      async end() {
        st.ended += 1;
      },
      /** @param {string} sql */
      async query(sql) {
        if (sql.includes('current_user')) {
          const r = o.role ?? 'xf_sovereign';
          return { rows: [{ u: r, s: r }] };
        }
        assert.match(sql, /fence\.reap_lapsed\(\)/, 'لا استعلامَ غيرُ الحصاد');
        st.reaps += 1;
        if (st.fails > 0) {
          st.fails -= 1;
          throw Object.assign(new Error('terminating connection'), { code: '57P01' });
        }
        return {
          rows: [{ r: o.result ?? { ok: true, reaped: [], unresolved: [], next_due_ms: 1000 } }],
        };
      },
    };
    return c;
  };

  test('فشلُ الاتصالِ يُسجَّلُ ويُعادُ بعدَ retryMs ثمّ يتّصلُ ويحصد — بلا إعلانِ حصادٍ قبلَه', async () => {
    /** @type {Array<Record<string, any>>} */
    const log = [];
    let attempts = 0;
    const r = runSovereignReaper({
      ceilingMs: 200,
      retryMs: 30,
      log: (e) => log.push({ ...e, at: Date.now() }),
      connect: async () => {
        attempts += 1;
        if (attempts <= 3)
          throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        return /** @type {any} */ (
          fakeClient({
            result: {
              ok: true,
              reaped: [{ role: 'xf_w_1', reason: 'expired' }],
              unresolved: [],
              next_due_ms: 500,
            },
          })
        );
      },
    });
    await sleep(200);
    const st = await r.stop();
    const errs = log.filter((e) => e.ev === 'error');
    assert.equal(errs.length, 3);
    assert.ok(errs.every((e) => e.code === 'ECONNREFUSED'));
    for (let i = 1; i < errs.length; i++)
      assert.ok(Number(errs[i]?.at) - Number(errs[i - 1]?.at) >= 25, 'لا حلقةَ ساخنة');
    const firstReap = log.findIndex((e) => e.ev === 'reaped');
    assert.ok(firstReap > log.findIndex((e) => e.ev === 'connected'), 'لا حصادَ قبلَ الاتصال');
    assert.equal(log.filter((e) => e.ev === 'reaped').length, 1);
    assert.equal(st.connects, 1);
    assert.equal(st.errors, 3);
    assert.equal(log.at(-1)?.ev, 'stopped');
  });

  test('فشلُ النداءِ يُسقِطُ الوصلةَ ويُعيدُ الاتصال (‏انقطاعٌ أو إعادةُ تشغيلِ القاعدة)', async () => {
    /** @type {Array<Record<string, any>>} */
    const log = [];
    /** @type {any[]} */
    const made = [];
    const r = runSovereignReaper({
      ceilingMs: 40,
      retryMs: 10,
      log: (e) => log.push(e),
      connect: async () => {
        const c = fakeClient({
          reapFails: made.length === 0 ? 1 : 0,
          result: { ok: true, reaped: [], unresolved: [], next_due_ms: 20 },
        });
        made.push(c);
        return /** @type {any} */ (c);
      },
    });
    await sleep(120);
    const st = await r.stop();
    assert.equal(made[0].st.ended, 1, 'الوصلةُ الفاشلةُ أُغلِقت');
    assert.ok(made.length === 2, `وصلةٌ جديدةٌ واحدة (‏${made.length})`);
    assert.equal(st.connects, 2);
    assert.equal(log.filter((e) => e.ev === 'error' && e.code === '57P01').length, 1);
    assert.ok(st.ticks >= 3);
    assert.equal(made[1].st.ended, 1, 'stop() يُغلِقُ الوصلةَ القائمة');
  });

  test('دورٌ غيرُ xf_sovereign يُرفَض: لا حصادَ بوصلةِ الجذرِ أو superuser، والوصلةُ تُغلَق', async () => {
    /** @type {Array<Record<string, any>>} */
    const log = [];
    /** @type {any[]} */
    const made = [];
    const r = runSovereignReaper({
      ceilingMs: 100,
      retryMs: 20,
      log: (e) => log.push(e),
      connect: async () => {
        const c = fakeClient({ role: 'xf_root' });
        made.push(c);
        return /** @type {any} */ (c);
      },
    });
    await sleep(70);
    const st = await r.stop();
    assert.ok(made.length >= 2);
    assert.ok(
      made.every((c) => c.st.reaps === 0 && c.st.ended === 1),
      'لا نداءَ حصادٍ بدورٍ آخر',
    );
    assert.ok(
      log.filter((e) => e.ev === 'error').every((e) => e.code === FENCE_ERRORS.REAPER_ROLE),
    );
    assert.equal(log.filter((e) => e.ev === 'connected' || e.ev === 'reaped').length, 0);
    assert.equal(st.connects, 0);
  });
});

// ── WL-553: تراجعٌ أُسّيٌّ بتذبذبٍ وتصنيفُ الأخطاء (‏بلا قاعدة) ───────────────────────────────

describe('WL-553: startLapseReaper — تراجعٌ أُسّيٌّ بتذبذبٍ بينَ أرضيّةِ retryMs وسقفِ maxRetryMs', () => {
  /**
   * حاصدٌ يفشلُ `fails` مرّةً ثمّ ينجح، ويُسجِّلُ التأخيرَ المُعلَنَ لكلِّ فشل.
   * @param {{ retryMs: number, maxRetryMs?: number, ceilingMs: number, random?: () => number,
   *           pattern: Array<'e' | 'ok'>, waitMs: number }} o
   */
  const drive = async (o) => {
    let i = 0;
    /** @type {number[]} */
    const delays = [];
    /** @type {number[]} */
    const at = [];
    const h = startLapseReaper(
      {
        reapLapsed: async () => {
          at.push(Date.now());
          const step = o.pattern[Math.min(i, o.pattern.length - 1)];
          i += 1;
          if (step === 'e')
            throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
          return { ok: true, reaped: [], unresolved: [], next_due_ms: 1 };
        },
      },
      {
        ceilingMs: o.ceilingMs,
        retryMs: o.retryMs,
        minDelayMs: 1,
        ...(o.maxRetryMs === undefined ? {} : { maxRetryMs: o.maxRetryMs }),
        ...(o.random === undefined ? {} : { random: o.random }),
        onError: (_e, info) => delays.push(Number(info?.retryInMs)),
      },
    );
    await sleep(o.waitMs);
    await h.stop();
    return { delays, at, stats: h.stats() };
  };

  test('بلا تذبذب (‏random = 0 ⇒ الحدُّ الأعلى): 10، 20، 40، 80 ثمّ السقفُ 100 — والفواصلُ المقيسةُ تتبعُها', async () => {
    const { delays, at } = await drive({
      retryMs: 10,
      maxRetryMs: 100,
      ceilingMs: 1000,
      random: () => 0,
      pattern: ['e'],
      waitMs: 500,
    });
    assert.deepEqual(delays.slice(0, 6), [10, 20, 40, 80, 100, 100]);
    for (let k = 1; k < 5; k++) {
      const gap = Number(at[k]) - Number(at[k - 1]);
      assert.ok(gap >= Number(delays[k - 1]) - 2, `فاصلُ ${k}: ${gap} ≥ ${delays[k - 1]}`);
    }
  });

  test('تذبذبٌ أقصى (‏random → 1): لا تأخيرَ دونَ retryMs (‏أرضيّةُ #565) ولا فوقَ maxRetryMs', async () => {
    const { delays } = await drive({
      retryMs: REAPER_RETRY_FLOOR_MS,
      maxRetryMs: 80,
      ceilingMs: 1000,
      random: () => 0.999999,
      pattern: ['e'],
      waitMs: 400,
    });
    assert.ok(delays.length >= 6, `${delays.length}`);
    assert.equal(delays[0], REAPER_RETRY_FLOOR_MS, 'الفشلُ الأوّلُ = retryMs بعينِه (‏سلوكُ #565)');
    for (const d of delays) {
      assert.ok(d >= REAPER_RETRY_FLOOR_MS && d <= 80, `${d}`);
    }
    // ‏التذبذبُ يُنزِلُ حتى نصفِ الأساسِ لا أدنى: الأساسُ 80 ⇒ ≥ 40.
    assert.ok(
      delays.slice(4).every((d) => d >= 40),
      JSON.stringify(delays),
    );
  });

  test('التذبذبُ فعليٌّ بـMath.random: تأخيراتُ السقفِ ليست كلُّها متساوية', async () => {
    const { delays } = await drive({
      retryMs: 10,
      maxRetryMs: 40,
      ceilingMs: 1000,
      pattern: ['e'],
      waitMs: 700,
    });
    const capped = delays.slice(3);
    assert.ok(capped.length >= 8, `${capped.length}`);
    assert.ok(new Set(capped).size > 1, `تذبذب: ${JSON.stringify(capped)}`);
    assert.ok(
      capped.every((d) => d >= 20 && d <= 40),
      JSON.stringify(capped),
    );
  });

  test('نداءٌ ناجحٌ يُصفِّرُ العدّاد: الفشلُ بعدَه يبدأُ من retryMs', async () => {
    const { delays, stats } = await drive({
      retryMs: 10,
      maxRetryMs: 1000,
      ceilingMs: 1000,
      random: () => 0,
      pattern: ['e', 'e', 'e', 'ok', 'e', 'e'],
      waitMs: 250,
    });
    assert.deepEqual(delays.slice(0, 5), [10, 20, 40, 10, 20]);
    assert.ok(stats.errors >= 5);
  });

  test('الافتراضُ بلا maxRetryMs = retryMs ثابت (‏سلوكُ #565 حرفيّاً لمن لم يطلب التراجع)', async () => {
    const { delays } = await drive({
      retryMs: 15,
      ceilingMs: 1000,
      random: () => 0,
      pattern: ['e'],
      waitMs: 200,
    });
    assert.ok(delays.length >= 5);
    assert.ok(
      delays.every((d) => d === 15),
      JSON.stringify(delays),
    );
  });

  test('maxRetryMs خارجَ [retryMs، ceilingMs] أو غيرُ صحيح ⇒ TypeError قبلَ أيِّ نداء', () => {
    let calls = 0;
    const r = { reapLapsed: async () => (calls++, { ok: true, reaped: [], unresolved: [] }) };
    for (const maxRetryMs of [5, 1001, 1.5, Number.NaN]) {
      assert.throws(
        () => startLapseReaper(r, { ceilingMs: 1000, retryMs: 10, maxRetryMs }),
        TypeError,
        String(maxRetryMs),
      );
    }
    assert.equal(calls, 0);
  });
});

describe('WL-553: classifyReaperError — جدولُ التصنيف (‏لا كلُّ SQL دائم، ولا كلُّ اتصالٍ مؤقّت)', () => {
  /** @param {string} code @param {string} [message] */
  const cls = (code, message = 'x') =>
    classifyReaperError(Object.assign(new Error(message), code === '' ? {} : { code })).class;

  test('دائمٌ: مصادقةٌ وقاعدةٌ مفقودةٌ وصلاحيّةٌ وهجرةٌ ناقصةٌ ودورٌ خاطئ وشهادةُ TLS', () => {
    for (const c of [
      '28P01',
      '28000',
      '3D000',
      '42501',
      '42883',
      '3F000',
      '42P01',
      FENCE_ERRORS.REAPER_ROLE,
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ])
      assert.equal(cls(c), 'permanent', c);
    assert.equal(cls('', 'The server does not support SSL connections'), 'permanent');
    assert.equal(
      cls('', 'SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string'),
      'permanent',
    );
  });

  test('مؤقّتٌ: أخطاءُ SQL للإيقافِ والموارد والتعارض والمهلة — ليست دائمة', () => {
    for (const c of [
      '57P01',
      '57P02',
      '57P03',
      '53300',
      '53100',
      '53200',
      '40001',
      '40P01',
      '55P03',
      '57014',
      '25006',
      '08006',
      '08001',
      '08003',
      '08004',
    ])
      assert.equal(cls(c), 'transient', c);
  });

  test('مؤقّتٌ: أخطاءُ الشبكة — وأخطاءُ اتصالٍ دائمةٌ أعلاه (‏28P01، TLS) ليست مؤقّتة', () => {
    for (const c of [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EAI_AGAIN',
      'EPIPE',
      'ENOTFOUND',
    ])
      assert.equal(cls(c), 'transient', c);
    for (const m of [
      'Connection terminated unexpectedly',
      'Connection terminated due to connection timeout',
      'Query read timeout',
      'timeout exceeded when trying to connect',
    ])
      assert.equal(cls('', m), 'transient', m);
  });

  test('مجهولٌ ⇒ unknown (‏يُعادُ كالمؤقّتِ ولا يُخرِجُ بـ78) — ومعه القاعدةُ التي طابقت لكلِّ صنف', () => {
    for (const c of ['XX000', '22012', 'P0001', 'ZZZZZ', ''])
      assert.equal(cls(c), 'unknown', c || '(بلا رمز)');
    const r = classifyReaperError(Object.assign(new Error('x'), { code: '28P01' }));
    assert.equal(typeof r.rule, 'string');
    assert.ok(r.rule.length > 0);
    assert.equal(classifyReaperError(null).class, 'unknown');
    assert.equal(classifyReaperError('boom').class, 'unknown');
  });

  test('الجدولُ مُصدَّرٌ ومتناسق: كلُّ صفٍّ صنفٌ معلومٌ وسبب، ولا رمزٌ في صنفَين', () => {
    assert.ok(Array.isArray(REAPER_ERROR_TABLE) && REAPER_ERROR_TABLE.length >= 8);
    /** @type {Map<string, string>} */
    const seen = new Map();
    for (const row of REAPER_ERROR_TABLE) {
      assert.ok(row.class === 'permanent' || row.class === 'transient', JSON.stringify(row));
      assert.ok(typeof row.why === 'string' && row.why.length > 0);
      for (const c of row.codes ?? []) {
        assert.ok(!seen.has(c) || seen.get(c) === row.class, `${c} في صنفَين`);
        seen.set(c, row.class);
      }
    }
  });
});

describe('WL-553: runSovereignReaper — الصنفُ في السجلّ وحدُّ الأخطاءِ الدائمةِ المتتالية', () => {
  /** @param {Array<string>} codes - رمزُ كلِّ محاولةِ اتصال؛ 'ok' = اتصالٌ يحصد */
  const run = async (
    /** @type {string[]} */ codes,
    /** @type {number} */ limit,
    /** @type {number} */ waitMs,
  ) => {
    /** @type {Array<Record<string, any>>} */
    const log = [];
    let i = 0;
    const r = runSovereignReaper({
      ceilingMs: 100,
      retryMs: 10,
      maxRetryMs: 10,
      permanentLimit: limit,
      log: (e) => log.push(e),
      connect: async () => {
        const c = codes[Math.min(i, codes.length - 1)] ?? 'ok';
        i += 1;
        if (c !== 'ok') throw Object.assign(new Error(`fail ${c}`), { code: c });
        let reaps = 0;
        return /** @type {any} */ ({
          on() {},
          async end() {},
          /** @param {string} sql */
          async query(sql) {
            if (sql.includes('current_user'))
              return { rows: [{ u: 'xf_sovereign', s: 'xf_sovereign' }] };
            // ‏وصلةٌ تحصدُ مرّةً بنجاحٍ ثمّ ترفضُ بصلاحيّة (‏42501 دائم) ⇒ المحاولةُ التالية اتصالٌ جديد.
            reaps += 1;
            if (reaps === 1)
              return { rows: [{ r: { ok: true, reaped: [], unresolved: [], next_due_ms: 1 } }] };
            throw Object.assign(new Error('permission denied for function reap_lapsed'), {
              code: '42501',
            });
          },
        });
      },
    });
    await sleep(waitMs);
    await r.stop();
    return log.filter((e) => e.ev === 'error');
  };

  test('28P01 متتالياً ⇒ consecutive_permanent يتصاعدُ وpermanent_exhausted عندَ الحدِّ مرّةً واحدة', async () => {
    const errs = await run(['28P01'], 3, 120);
    assert.ok(errs.length >= 4, `${errs.length}`);
    assert.ok(errs.every((e) => e.class === 'permanent'));
    assert.deepEqual(
      errs.slice(0, 3).map((e) => e.consecutive_permanent),
      [1, 2, 3],
    );
    assert.deepEqual(
      errs.slice(0, 3).map((e) => e.permanent_exhausted === true),
      [false, false, true],
    );
    assert.ok(errs.every((e) => typeof e.retry_in_ms === 'number'));
  });

  test('دائمٌ يتخلّلُه مؤقّتٌ أو مجهول ⇒ العدّادُ يُصفَّرُ ولا استنفاد', async () => {
    const errs = await run(
      ['28P01', '28P01', 'ECONNREFUSED', '28P01', '28P01', 'XX000', '28P01', '28P01', 'ECONNRESET'],
      3,
      150,
    );
    assert.ok(errs.length >= 9);
    assert.equal(
      errs.filter((e) => e.permanent_exhausted === true).length,
      0,
      JSON.stringify(errs.slice(0, 9).map((e) => e.code)),
    );
    assert.deepEqual(
      errs.slice(0, 9).map((e) => e.class),
      [
        'permanent',
        'permanent',
        'transient',
        'permanent',
        'permanent',
        'unknown',
        'permanent',
        'permanent',
        'transient',
      ],
    );
  });

  test('حصادٌ ناجحٌ يُصفِّرُ العدّاد: الدائمُ بعدَه يبدأُ من 1، والاستنفادُ بعدَ الحدِّ كاملاً', async () => {
    const errs = await run(['28P01', '28P01', '28P01', 'ok', '28P01'], 4, 150);
    assert.ok(errs.length >= 7, `${errs.length}`);
    assert.deepEqual(
      errs.slice(0, 7).map((e) => [e.code, e.consecutive_permanent]),
      [
        ['28P01', 1],
        ['28P01', 2],
        ['28P01', 3],
        ['42501', 1],
        ['28P01', 2],
        ['28P01', 3],
        ['28P01', 4],
      ],
    );
    assert.equal(
      errs.findIndex((e) => e.permanent_exhausted === true),
      6,
    );
  });
});

// ── WL-546: عمليّتان حقيقيّتان على قاعدةٍ حقيقيّة ────────────────────────────────────────

/**
 * عمليّةٌ ابنةٌ تُخرِجُ سطورَ JSON.
 * @param {string[]} args @param {Record<string, string>} env
 */
function child(args, env) {
  const base = { ...process.env };
  delete base['DATABASE_URL']; // ‏الابنُ لا يرثُ وصلةَ superuser
  const p = spawn(process.execPath, args, {
    cwd: REPO,
    env: { ...base, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  /** @type {Array<Record<string, any>>} */
  const events = [];
  let buf = '';
  let stderr = '';
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        events.push({ ...JSON.parse(line), seenAt: Date.now() });
      } catch {
        events.push({ ev: 'raw', line });
      }
    }
  });
  p.stderr.on('data', (d) => (stderr += d));
  /** @type {Promise<{ code: number | null, signal: string | null }>} */
  const exited = new Promise((r) => p.on('exit', (code, signal) => r({ code, signal })));
  /**
   * @param {(e: Record<string, any>) => boolean} pred @param {number} ms
   */
  const waitFor = async (pred, ms) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const e = events.find(pred);
      if (e) return e;
      await sleep(20);
    }
    throw new Error(
      `لم يظهر الحدث خلال ${ms} مث: ${JSON.stringify(events.slice(-8))} ${stderr.slice(-500)}`,
    );
  };
  return { p, events, waitFor, exited, stderr: () => stderr };
}

/** عمليّةُ الجذر: تُصدِرُ اعتماداً لكلِّ عاملٍ وتُشغِّلُ حافظَ إيجارِه ثمّ تبقى حتى تُقتَل. */
const ROOT_CHILD = `
import pg from 'pg';
import { FenceRoot, newBootId, pemKeyProvider, signCredentialChallenge } from ${JSON.stringify(FENCE_MODULE)};
const out = (e) => process.stdout.write(JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ...e }) + '\\n');
const url = process.env.XUUX_ROOT_DATABASE_URL;
const root = new FenceRoot(async () => {
  const c = new pg.Client({ connectionString: url, application_name: 'xuux-wl546-root' });
  c.on('error', () => {});
  await c.connect();
  return c;
}, { lockTimeoutMs: 400 });
for (const w of JSON.parse(process.env.XUUX_WORKERS)) {
  const key = pemKeyProvider(w.pem, w.workerId);
  const bootId = newBootId();
  const cred = await root.issueCredential(w.workerId, bootId, (ch) => signCredentialChallenge(key, ch, { workerId: w.workerId, bootId }));
  root.startLeaseKeeper(String(cred.role_name), { assertOperational() {} }, {
    intervalMs: Number(process.env.XUUX_KEEPER_MS),
    onStop: (r) => out({ ev: 'keeper_stop', role: cred.role_name, reason: String(r?.code ?? r) }),
  });
  out({ ev: 'issued', workerId: w.workerId, bootId, role: cred.role_name, epoch: cred.epoch });
}
setInterval(() => {}, 1 << 30);
`;

/** وكيلُ TCP بينَ الحاصدِ والقاعدة: يُسقَطُ (‏انقطاعٌ: الوصلاتُ تُقطَعُ والاتصالُ يُرفَض) ويُعاد. */
async function tcpProxy() {
  const target = new URL(databaseUrl() ?? '');
  /** @type {Set<net.Socket>} */
  const socks = new Set();
  /** @type {net.Server | null} */
  let server = null;
  let port = 0;
  const up = () =>
    new Promise((res, rej) => {
      const s = net.createServer((a) => {
        const b = net.connect(Number(target.port || 5432), target.hostname);
        for (const x of [a, b]) {
          socks.add(x);
          x.on('error', () => {});
          x.on('close', () => socks.delete(x));
        }
        a.pipe(b).pipe(a);
      });
      s.once('error', rej);
      s.listen(port, '127.0.0.1', () => {
        port = /** @type {net.AddressInfo} */ (s.address()).port;
        server = s;
        res(undefined);
      });
    });
  const down = () =>
    new Promise((res) => {
      for (const x of socks) x.destroy();
      if (server === null) return res(undefined);
      const s = server;
      server = null;
      s.close(() => res(undefined));
    });
  await up();
  return { up, down, port: () => port };
}

describe(
  'WL-546: حاصدُ السياديّ في عمليّةٍ مستقلّة — قتلُ عمليّةِ الجذرِ فعلاً (‏قاعدةٌ حقيقيّة، ساعةٌ حقيقيّة)',
  { skip: skipWithoutDatabase, timeout: 110_000 },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    const WINDOW_S = 5;
    let rootUrl = '';
    let sovUrl = '';
    /** @type {number[]} */
    const windows = [];
    /** @type {string[]} */
    const labelled = [];
    /** @type {Array<ReturnType<typeof child>>} */
    const children = [];

    /** وصلةُ دورٍ لعمليّةٍ ابنة (‏كما يدخلُ الحزام: كلمةُ مرورٍ عشوائيّةٌ من superuser). @param {string} role @param {number} [port] */
    const roleUrl = async (role, port) => {
      const v = (
        await h.db.pool.query(
          `SELECT rolcanlogin AND (rolvaliduntil IS NULL OR rolvaliduntil > now()) AS ok FROM pg_roles WHERE rolname = $1`,
          [role],
        )
      ).rows[0];
      assert.equal(v?.ok, true, `${role} يدخل`);
      const password = randomBytes(18).toString('base64url');
      await h.db.pool.query(`ALTER ROLE ${quoteIdent(role)} PASSWORD '${password}'`);
      const url = new URL(databaseUrl() ?? '');
      url.username = role;
      url.password = password;
      url.pathname = `/${h.db.name}`;
      if (port !== undefined) {
        url.hostname = '127.0.0.1';
        url.port = String(port);
      }
      return url.toString();
    };
    /** @param {string} url @param {string[]} [extra] */
    const startReaper = (url, extra = []) => {
      const c = child(
        [
          REAPER_CLI,
          '--ceiling-ms',
          '5000',
          '--retry-ms',
          '200',
          '--heartbeat-ms',
          '500',
          ...extra,
        ],
        { XUUX_SOVEREIGN_DATABASE_URL: url },
      );
      children.push(c);
      return c;
    };
    /** @param {ReturnType<typeof child>} r */
    const stopReaper = async (r) => {
      r.p.kill('SIGTERM');
      const ex = await r.exited;
      assert.deepEqual(ex, { code: 0, signal: null }, `خروجٌ منضبط: ${r.stderr().slice(-400)}`);
      const s = r.events.find((e) => e.ev === 'stopped');
      assert.ok(s, 'سجلُّ stopped بعدّاداته');
      return s;
    };
    /** @param {string} role */
    const cred = async (role) =>
      (
        await h.db.pool.query(
          `SELECT c.status, c.revoke_reason, c.revoked_at, l.expires_at::text AS expires_at,
                  (SELECT count(*)::int FROM pg_stat_activity a WHERE a.usename = c.role_name) AS alive,
                  (SELECT rolcanlogin FROM pg_roles WHERE rolname = c.role_name) AS canlogin
             FROM fence.credentials c LEFT JOIN fence.run_lease l ON l.role_name = c.role_name
            WHERE c.role_name = $1`,
          [role],
        )
      ).rows[0];
    /** @param {string} role @param {number} ms */
    const untilGone = async (role, ms) => {
      const t = Date.now();
      while (Date.now() - t < ms) {
        const c = await cred(role);
        if (c.alive === 0 && c.status === 'REVOKED') return true;
        await sleep(20);
      }
      return false;
    };
    /** @param {import('pg').Client} c */
    const notify = (c) =>
      c.query(`NOTIFY wl546, 'x'`).then(
        () => 'ACCEPTED',
        (/** @type {any} */ e) => `REJ ${e.code ?? e.message}`,
      );
    /** النافذةُ بساعةِ القاعدةِ وحدَها. @param {string} role @param {string} expText */
    const windowMs = async (role, expText) =>
      Number(
        (
          await h.db.pool.query(
            `SELECT (extract(epoch FROM revoked_at - $2::timestamptz) * 1000)::float8 AS w FROM fence.credentials WHERE role_name = $1`,
            [role, expText],
          )
        ).rows[0].w,
      );
    /** مللي ثوانٍ بساعةِ القاعدةِ حتى expText. @param {string} expText */
    const msUntil = async (expText) =>
      Number(
        (
          await h.db.pool.query(
            `SELECT (extract(epoch FROM $1::timestamptz - clock_timestamp()) * 1000)::float8 AS d`,
            [expText],
          )
        ).rows[0].d,
      );

    /**
     * عمليّةُ جذرٍ تُصدِرُ وتُشغِّلُ الحافظ؛ والاختبارُ يدخلُ بدورِ العاملِ ويختمُ جلستَه (‏كإقلاعِ الحزام).
     * @param {Array<'alpha' | 'beta'>} workers
     */
    const spawnRoot = async (workers) => {
      const rc = child(['--input-type=module', '-e', ROOT_CHILD], {
        XUUX_ROOT_DATABASE_URL: rootUrl,
        XUUX_KEEPER_MS: '1000',
        XUUX_WORKERS: JSON.stringify(
          workers.map((w) => ({ workerId: w, pem: h.keys[w].privateKeyPem })),
        ),
      });
      children.push(rc);
      const live = (await h.sovereign.status()).live;
      /** @type {Array<{ workerId: string, role: string, client: import('pg').Client }>} */
      const sessions = [];
      for (const w of workers) {
        const ev = await rc.waitFor((e) => e.ev === 'issued' && e.workerId === w, 15_000);
        const role = String(ev.role);
        const client = await h.login(role);
        await sealFencedSessions([client], h.keys[w], {
          db: h.db.name,
          sysid: String(live.sysid),
          workerId: w,
          bootId: String(ev.bootId),
          epoch: ev.epoch,
          roleName: role,
        });
        assert.equal(await notify(client), 'ACCEPTED');
        sessions.push({ workerId: w, role, client });
      }
      return { rc, sessions };
    };
    /**
     * يقتلُ عمليّةَ الجذرِ بـSIGKILL ويقرأُ آخرَ expires_at (‏بعدَ مهلةٍ تُلزِمُ تجديداً كان على الطريق).
     * @param {ReturnType<typeof child>} rc @param {string[]} roles
     */
    const killRoot = async (rc, roles) => {
      assert.notEqual(rc.p.pid, process.pid);
      rc.p.kill('SIGKILL');
      const ex = await rc.exited;
      assert.equal(ex.signal, 'SIGKILL', 'عمليّةُ الجذرِ قُتِلت فعلاً');
      await sleep(250);
      /** @type {Record<string, string>} */
      const exp = {};
      for (const r of roles) {
        const c = await cred(r);
        assert.equal(c.status, 'ACTIVE');
        exp[r] = String(c.expires_at);
      }
      return exp;
    };

    before(async () => {
      h = await harness('wl546');
      await h.sovereign.command('lease_set', { lease_window_s: WINDOW_S, lease_renew_s: 1 });
      await h.resume();
      rootUrl = await roleUrl('xf_root');
      sovUrl = await roleUrl('xf_sovereign');
    });
    after(async () => {
      for (const c of children)
        if (c.p.exitCode === null && c.p.signalCode === null) c.p.kill('SIGKILL');
      if (windows.length > 0) {
        const s = [...windows].sort((a, b) => a - b);
        const q = (/** @type {number} */ p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
        // ‏التوزيعُ لا المتوسّطُ وحدَه: يُطبَعُ في سجلِّ الاختبار دليلاً.
        console.log(
          `# WL-546 window(revoked_at − expires_at, DB clock, ms): n=${s.length} min=${s[0]?.toFixed(1)} p50=${q(0.5)?.toFixed(1)} p90=${q(0.9)?.toFixed(1)} max=${s.at(-1)?.toFixed(1)} all=[${s.map((x) => x.toFixed(1)).join(', ')}] by=[${labelled.join(', ')}]`,
        );
      }
      if (h) await h.close();
    });

    test('عمليّتان: الحافظُ يُبقي الاعتمادَ بعدَ النافذة، ثمّ SIGKILL للجذرِ ⇒ السياديُّ يحصدُ ويُنهي الجلسةَ ويُرفَضُ NOTIFY', async (t) => {
      const reaper = startReaper(sovUrl);
      await reaper.waitFor((e) => e.ev === 'connected', 10_000);
      const { rc, sessions } = await spawnRoot(['alpha']);
      const { role, client } = first(sessions);
      assert.ok(new Set([process.pid, rc.p.pid, reaper.p.pid]).size === 3, 'ثلاثُ عمليّاتٍ مختلفة');
      // ‏الجذرُ حيّ: الحافظُ يُجدِّدُ فلا يحصدُ السياديُّ شيئاً وإن تجاوزَ الزمنُ النافذة.
      await sleep(WINDOW_S * 1000 + 1500);
      const alive = await cred(role);
      assert.equal(alive.status, 'ACTIVE', 'الحافظُ حيٌّ ⇒ لا حصاد');
      assert.equal(alive.alive, 1);
      assert.equal(await notify(client), 'ACCEPTED');
      assert.equal(reaper.events.filter((e) => e.ev === 'reaped' && e.role === role).length, 0);
      const exp = await killRoot(rc, [role]);
      assert.ok(await untilGone(role, WINDOW_S * 1000 + 3000), 'السياديُّ حصدَ بعدَ موتِ الجذر');
      const c = await cred(role);
      assert.equal(c.revoke_reason, 'LEASE_LAPSED:expired');
      assert.equal(c.canlogin, false, 'NOLOGIN');
      assert.match(await notify(client), /^REJ /, 'NOTIFY لم يَعُد مقبولاً');
      const ev = await reaper.waitFor((e) => e.ev === 'reaped' && e.role === role, 2000);
      assert.equal(ev.reason, 'expired');
      assert.ok(Number(ev.terminated) >= 1);
      assert.equal(ev.alive_after, 0);
      const w = await windowMs(role, String(exp[role]));
      windows.push(w);
      labelled.push(`single:${w.toFixed(1)}`);
      assert.ok(w >= 0 && w < 1000, `النافذة ${w.toFixed(1)} مث`);
      assert.ok(
        reaper.events.some((e) => e.ev === 'heartbeat' && e.ticks >= 2),
        'نبضٌ مُسجَّل',
      );
      const st = await stopReaper(reaper);
      assert.equal(st.errors, 0);
      assert.equal(st.callbackErrors, 0);
      assert.ok(st.reaped >= 1 && st.unresolved === 0);
      t.diagnostic(
        `pids test=${process.pid} root=${rc.p.pid} reaper=${reaper.p.pid}; window=${w.toFixed(1)}ms; stopped=${JSON.stringify(st)}`,
      );
    });

    test('اعتماداتٌ متعدّدة (‏alpha وbeta) في دورتين: كلُّها تُحصَدُ بعدَ قتلِ الجذر — عيّناتٌ للتوزيع', async (t) => {
      const reaper = startReaper(sovUrl);
      await reaper.waitFor((e) => e.ev === 'connected', 10_000);
      for (let cycle = 0; cycle < 2; cycle++) {
        const { rc, sessions } = await spawnRoot(['alpha', 'beta']);
        await sleep(1200);
        const exp = await killRoot(
          rc,
          sessions.map((s) => s.role),
        );
        for (const s of sessions) {
          assert.ok(await untilGone(s.role, WINDOW_S * 1000 + 3000), `${s.workerId} حُصِد`);
          assert.match(await notify(s.client), /^REJ /);
          assert.equal((await cred(s.role)).revoke_reason, 'LEASE_LAPSED:expired');
          const w = await windowMs(s.role, String(exp[s.role]));
          windows.push(w);
          labelled.push(`c${cycle}/${s.workerId}:${w.toFixed(1)}`);
        }
      }
      const st = await stopReaper(reaper);
      assert.ok(st.reaped >= 4, JSON.stringify(st));
      assert.equal(st.errors, 0);
      assert.equal(st.unresolved, 0);
      t.diagnostic(`stopped=${JSON.stringify(st)}`);
    });

    test('إعادةُ تشغيلِ السياديّ (‏SIGTERM ثمّ SIGKILL): بلا حاصدٍ لا حصاد، والإيقافُ لا يُحيي ولا يمدّ؛ والحاصدُ الجديدُ يحصدُ في نبضتِه الأولى', async (t) => {
      // ‏(أ) SIGTERM: إيقافٌ منضبطٌ بعدّاداته، ثمّ لا حاصد.
      const a = startReaper(sovUrl);
      await a.waitFor((e) => e.ev === 'connected', 10_000);
      await stopReaper(a);
      const { rc, sessions } = await spawnRoot(['alpha']);
      const { role, client } = first(sessions);
      const exp = await killRoot(rc, [role]);
      await sleep(Math.max(0, await msUntil(String(exp[role]))) + 1000);
      const lapsed = await cred(role);
      assert.equal(lapsed.status, 'ACTIVE', 'بلا حاصدٍ يبقى ACTIVE — الحصادُ هو الحاصد');
      assert.equal(await notify(client), 'ACCEPTED', 'العيبُ المعلَن بلا حاصد');
      // ‏الإيقافُ لا يمدُّ إيجاراً منقضياً: التجديدُ يُرفَضُ وexpires_at لم يتغيّر.
      const renew = await rejection(() => h.root.renewLease(role));
      assert.equal(/** @type {any} */ (renew).code, 'XF009');
      assert.equal((await cred(role)).expires_at, String(exp[role]), 'لا مدّ');
      // ‏(ب) حاصدٌ جديد: يحصدُ في أوّلِ نبضة.
      const b = startReaper(sovUrl);
      const started = await b.waitFor((e) => e.ev === 'started', 10_000);
      const reaped = await b.waitFor((e) => e.ev === 'reaped' && e.role === role, 5000);
      assert.ok(await untilGone(role, 2000));
      assert.match(await notify(client), /^REJ /);
      assert.ok(reaped.seenAt - started.seenAt < 3000, 'نبضةٌ أولى بلا انتظار موعد');
      // ‏SIGKILL للحاصد (‏موتٌ بلا إيقاف) ثمّ اعتمادٌ جديدٌ يموتُ جذرُه، وحاصدٌ ثالثٌ يحصدُه.
      b.p.kill('SIGKILL');
      assert.equal((await b.exited).signal, 'SIGKILL');
      const r2 = await spawnRoot(['alpha']);
      const role2 = first(r2.sessions).role;
      const exp2 = await killRoot(r2.rc, [role2]);
      await sleep(Math.max(0, await msUntil(String(exp2[role2]))) + 800);
      assert.equal((await cred(role2)).status, 'ACTIVE', 'الحاصدُ المقتولُ لا يحصد');
      const c3 = startReaper(sovUrl);
      await c3.waitFor((e) => e.ev === 'reaped' && e.role === role2, 5000);
      assert.ok(await untilGone(role2, 2000));
      const st = await stopReaper(c3);
      // ‏بعدَ إيقافِ الحاصد: المُلغى يبقى مُلغى، والتجديدُ يُرفَض، والدخولُ ممنوع.
      await sleep(300);
      for (const r of [role, role2]) {
        const c = await cred(r);
        assert.equal(c.status, 'REVOKED');
        assert.equal(c.canlogin, false);
        assert.equal(
          /** @type {any} */ (await rejection(() => h.root.renewLease(r))).code,
          'XF007', // ‏اعتمادٌ غيرُ نشِط: المُلغى لا يُجدَّد
        );
        await assert.rejects(h.login(r), 'لا دخولَ لاعتمادٍ محصود');
      }
      t.diagnostic(
        `restart: first-tick reap after ${reaped.seenAt - started.seenAt}ms; stopped=${JSON.stringify(st)}`,
      );
    });

    test('انقطاعُ القاعدة (‏وكيلٌ يُسقَط): أخطاءٌ مُسجَّلةٌ بإيقاعِ retryMs، لا حصادَ مُعلَنٌ أثناءَه، وإعادةُ اتصالٍ وحصادٌ بعدَه', async (t) => {
      const proxy = await tcpProxy();
      // ‏WL-553: التعافي بعدَ عودةِ القاعدةِ ≤ سقفِ التراجع؛ افتراضُه = السقف (‏5 ث هنا) ⇒ يُثبَّتُ 1 ث ليبقى انتظارُ
      // الحصادِ أدناه (‏5 ث) قياساً للتعافي لا لزمنِ التراجع. التراجعُ نفسُه مقيسٌ في اختبارِ «خطأٌ مؤقّت» أدناه.
      const reaper = startReaper(await roleUrl('xf_sovereign', proxy.port()), [
        '--query-timeout-ms',
        '1000',
        '--max-retry-ms',
        '1000',
      ]);
      try {
        await reaper.waitFor((e) => e.ev === 'connected', 10_000);
        const { rc, sessions } = await spawnRoot(['alpha']);
        const { role, client } = first(sessions);
        await proxy.down();
        const downAt = Date.now();
        const exp = await killRoot(rc, [role]);
        await sleep(Math.max(0, await msUntil(String(exp[role]))) + 1500);
        const during = await cred(role);
        assert.equal(during.status, 'ACTIVE', 'القاعدةُ غيرُ مُتاحةٍ للحاصد ⇒ لا حصاد');
        assert.equal(await notify(client), 'ACCEPTED');
        assert.equal(
          reaper.events.filter((e) => e.ev === 'reaped').length,
          0,
          'لا يُعلَنُ حصادٌ لم يقع',
        );
        const outageMs = Date.now() - downAt;
        const errs = reaper.events.filter((e) => e.ev === 'error');
        assert.ok(errs.length >= 3, `أخطاءٌ مُسجَّلة (‏${errs.length})`);
        assert.ok(
          errs.length <= outageMs / 200 + 5,
          `لا حلقةَ ساخنة: ${errs.length} في ${outageMs} مث`,
        );
        await proxy.up();
        const upAt = Date.now();
        await reaper.waitFor((e) => e.ev === 'reaped' && e.role === role, 5000);
        assert.ok(await untilGone(role, 2000));
        assert.match(await notify(client), /^REJ /);
        const st = await stopReaper(reaper);
        assert.ok(st.connects >= 2, 'أُعيدَ الاتصال');
        assert.equal(
          st.errors,
          reaper.events.filter((e) => e.ev === 'error').length,
          'كلُّ فشلٍ مُسجَّل',
        );
        t.diagnostic(
          `outage=${outageMs}ms errors=${errs.length} codes=${[...new Set(errs.map((e) => e.code))].join(',')} reapedAfterUp=${(reaper.events.find((e) => e.ev === 'reaped')?.seenAt ?? 0) - upAt}ms stopped=${JSON.stringify(st)}`,
        );
      } finally {
        await proxy.down();
      }
    });

    test('إعدادٌ خاطئ: الحاصدُ بوصلةِ xf_root يرفضُ ويخرجُ بـ2 بلا حصاد؛ وبلا وصلةٍ يخرجُ بـ2', async () => {
      const r = startReaper(rootUrl);
      const ex = await r.exited;
      assert.equal(ex.code, 2);
      assert.ok(r.events.some((e) => e.ev === 'error' && e.code === FENCE_ERRORS.REAPER_ROLE));
      assert.equal(r.events.filter((e) => e.ev === 'reaped' || e.ev === 'connected').length, 0);
      const n = startReaper('');
      assert.equal((await n.exited).code, 2);
      assert.ok(n.events.some((e) => e.ev === 'fatal'));
      // WL-548: ‏--retry-ms 0 أو --min-delay-ms 0 = حلقةٌ ساخنة، و--query-timeout-ms 0 = بلا مهلة (‏pg: 0 يُعطِّلُ مهلتَي
      // الاتصالِ والنداء ⇒ نداءٌ معلَّقٌ يُوقِفُ الحصادَ صامتاً، مقيس) ⇒ رفضٌ قبلَ أيِّ اتصال (‏خروجٌ 2).
      for (const bad of [
        ['--retry-ms', '0'],
        ['--min-delay-ms', '0'],
        ['--query-timeout-ms', '0'],
      ]) {
        const z = startReaper(sovUrl, bad);
        // انحدارٌ يُقبَلُ فيه الإعدادُ يُبقي العمليّةَ حيّةً — تُقتَلُ بعدَ 5 ث فيفشلُ الاختبارُ سريعاً لا بمهلةِ الملفّ.
        const killer = setTimeout(() => z.p.kill('SIGKILL'), 5000);
        const zx = await z.exited;
        clearTimeout(killer);
        assert.equal(zx.code, 2, bad.join(' '));
        assert.ok(
          z.events.some((e) => e.ev === 'fatal'),
          bad.join(' '),
        );
        assert.equal(
          z.events.filter((e) => e.ev === 'connected' || e.ev === 'error').length,
          0,
          bad.join(' '),
        );
      }
      const secret = decodeURIComponent(new URL(rootUrl).password);
      assert.ok(secret.length > 10);
      assert.ok(!JSON.stringify([...r.events, ...n.events]).includes(secret), 'لا سرَّ في السجل');
    });

    /**
     * WL-553: مُشرِفٌ بسياسةِ الوحدةِ المقترحة (‏Restart=always مع RestartPreventExitStatus=2 78): يُعيدُ التشغيلَ لكلِّ
     * خروجٍ آخر حتى `maxStarts`. ليس systemd — يُثبِتُ أنّ رمزَ الخروجِ يُوقِفُ الإعادةَ تحتَ هذه السياسة، لا أنّ وحدةً نُصِّبت.
     * @param {string} url @param {string[]} extra @param {number} maxStarts
     */
    const supervise = async (url, extra, maxStarts) => {
      /** @type {Array<{ code: number | null, signal: string | null, events: Array<Record<string, any>> }>} */
      const runs = [];
      while (runs.length < maxStarts) {
        const c = startReaper(url, extra);
        const killer = setTimeout(() => c.p.kill('SIGKILL'), 15_000);
        const ex = await c.exited;
        clearTimeout(killer);
        runs.push({ ...ex, events: c.events });
        if (ex.code === 2 || ex.code === 78) break;
      }
      return runs;
    };

    test('WL-553: خطأٌ دائمٌ (‏28P01 كلمةُ مرورٍ خاطئة، 3D000 قاعدةٌ مفقودة) ⇒ خروجٌ بـ78 بعدَ الحدّ، والمُشرِفُ لا يُعيدُ التشغيلَ', async (t) => {
      // ‏وصلةٌ صالحةٌ جديدة (‏roleUrl يُغيّرُ كلمةَ المرور؛ sovUrl قد يكونُ قديماً بعدَ اختبارٍ سابق) ⇒ 3D000 لا 28P01.
      const good = await roleUrl('xf_sovereign');
      const wrongPw = new URL(good);
      wrongPw.password = randomBytes(18).toString('base64url');
      const noDb = new URL(good);
      noDb.pathname = `/${h.db.name}_wl553_missing`;
      const extra = ['--retry-ms', '50', '--max-retry-ms', '200', '--permanent-limit', '3'];
      for (const [label, url, code] of /** @type {const} */ ([
        ['28P01', wrongPw.toString(), '28P01'],
        ['3D000', noDb.toString(), '3D000'],
      ])) {
        const runs = await supervise(url, extra, 4);
        assert.equal(runs.length, 1, `${label}: تشغيلٌ واحدٌ لا إعادة (‏${runs.length})`);
        const run = first(runs);
        assert.equal(run.code, 78, `${label}: ${JSON.stringify(run.events.slice(-4))}`);
        const errs = run.events.filter((e) => e.ev === 'error');
        assert.equal(errs.length, 3, `${label}: الحدُّ 3 محاولات`);
        assert.ok(
          errs.every((e) => e.code === code && e.class === 'permanent'),
          JSON.stringify(errs),
        );
        assert.ok(
          run.events.some((e) => e.ev === 'fatal' && e.reason === 'permanent' && e.code === code),
        );
        assert.equal(run.events.filter((e) => e.ev === 'connected' || e.ev === 'reaped').length, 0);
        const secret = decodeURIComponent(wrongPw.password);
        assert.ok(!JSON.stringify(run.events).includes(secret), 'لا سرَّ في السجل');
        assert.ok(!JSON.stringify(run.events).includes(decodeURIComponent(new URL(good).password)));
        t.diagnostic(
          `${label}: exit=${run.code} errors=${errs.length} retry=${errs.map((e) => e.retry_in_ms).join(',')}`,
        );
      }
    });

    test('WL-553: خطأٌ مؤقّتٌ (‏منفذٌ مغلق) ⇒ لا خروج، والتأخيرُ يتضاعفُ من retryMs حتى maxRetryMs ولا يتجاوزُه', async (t) => {
      const proxy = await tcpProxy();
      const port = proxy.port();
      await proxy.down();
      const r = startReaper(await roleUrl('xf_sovereign', port), [
        '--retry-ms',
        '50',
        '--max-retry-ms',
        '400',
        '--permanent-limit',
        '2',
      ]);
      await sleep(3000);
      assert.equal(r.p.exitCode, null, `حيٌّ بعدَ 3 ث: ${JSON.stringify(r.events.slice(-3))}`);
      const errs = r.events.filter((e) => e.ev === 'error');
      assert.ok(errs.length >= 6 && errs.length <= 20, `${errs.length}`);
      assert.ok(
        errs.every((e) => e.code === 'ECONNREFUSED' && e.class === 'transient'),
        JSON.stringify(errs.slice(0, 3)),
      );
      assert.ok(errs.every((e) => e.consecutive_permanent === 0 && e.permanent_exhausted !== true));
      const d = errs.map((e) => Number(e.retry_in_ms));
      assert.equal(d[0], 50, 'الفشلُ الأوّلُ = retryMs');
      assert.ok(
        d.every((x) => x >= 50 && x <= 400),
        JSON.stringify(d),
      );
      assert.ok(
        d.slice(4).every((x) => x >= 200),
        `بلغَ السقفَ (‏±التذبذب): ${JSON.stringify(d)}`,
      );
      for (let k = 1; k < 5; k++) {
        const gap = Number(errs[k]?.seenAt) - Number(errs[k - 1]?.seenAt);
        assert.ok(gap >= Number(d[k - 1]) - 20, `فاصلٌ مقيسٌ ${gap} ≥ ${d[k - 1]}`);
      }
      const st = await stopReaper(r);
      assert.ok(st.errors >= errs.length, 'كلُّ فشلٍ مُسجَّلٌ في العدّاد');
      t.diagnostic(`transient: errors=${errs.length} retry=${d.join(',')}`);
    });

    test('سباقُ التجديدِ والحصادِ عندَ حدِّ الانقضاء: تجديدٌ نجحَ ⇒ لا إلغاء؛ وإلغاءٌ ⇒ التجديدُ مرفوضٌ (‏XF009/XF007)', async (t) => {
      let renewed = 0;
      let revoked = 0;
      for (let i = 0; i < 16; i++) {
        const b = await h.boot('alpha', { connect: false });
        const role = String(b.credential.role_name);
        await h.db.pool.query(
          `UPDATE fence.run_lease SET expires_at = clock_timestamp() + interval '150 milliseconds' WHERE role_name = $1`,
          [role],
        );
        await sleep(150 + ((i % 8) - 4) * 20);
        const [rn] = await Promise.allSettled([h.root.renewLease(role), h.sovereign.reapLapsed()]);
        await h.sovereign.reapLapsed();
        const c = await cred(role);
        if (rn.status === 'fulfilled') {
          renewed += 1;
          assert.equal(c.status, 'ACTIVE', `تجديدٌ نجحَ ثمّ أُلغي (‏i=${i})`);
          assert.ok((await msUntil(String(c.expires_at))) > 3000, 'الإيجارُ مُدَّ فعلاً');
        } else {
          revoked += 1;
          // ‏XF009: انقضى ولم يُحصَد بعد؛ XF007: الحصادُ سبقَه فالاعتمادُ غيرُ نشِط.
          assert.ok(
            ['XF009', 'XF007'].includes(/** @type {any} */ (rn.reason).code),
            String(rn.reason),
          );
          assert.equal(c.status, 'REVOKED');
        }
      }
      assert.ok(renewed > 0 && revoked > 0, `الطرفانِ وقعا: renewed=${renewed} revoked=${revoked}`);
      t.diagnostic(`race: renewed=${renewed} revoked=${revoked}`);
    });
  },
);
