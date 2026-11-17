#!/usr/bin/env node
/**
 * حاصدُ عمليّةِ السياديّ (‏`WL-546`): عمليّةٌ مستقلّةٌ عن الجذرِ وحافظِ الإيجار تُنادي `fence.reap_lapsed()` بوصلةِ
 * `xf_sovereign` عندَ موعدِ القاعدة (‏`next_due_ms`، الهجرة 0027) — فموتُ عمليّةِ الجذرِ لا يتركُ جلسةَ اعتمادٍ منقضٍ حيّة.
 *
 * **ما هو وما ليس:** أداةُ تشغيلٍ تُطلَقُ يدويّاً أو من مُشرِف. **لا تنصيب، ولا خدمةَ نظام، ولا مضيفَ مختار** — موضعُ
 * تشغيلِها ودورةُ حياتِها (‏مَن يُطلقُها، وبأيِّ مستخدم، وكيفَ تُعادُ بعدَ موتِها) قرارٌ تشغيليٌّ للمالك.
 * **بلا مفتاحِ توقيع:** تحصدُ ولا تُصدِرُ أمراً سياديّاً؛ وتُرفَضُ إن لم يكن الدورُ `xf_sovereign` (‏خروجٌ بـ2).
 *
 * الدخل: `XUUX_SOVEREIGN_DATABASE_URL` (‏لا تُطبَعُ أبداً). الخيارات: `--ceiling-ms` (‏5000)، `--retry-ms` (‏1000)،
 * `--min-delay-ms` (‏5)، `--heartbeat-ms` (‏10000، 0 = بلا نبض)، `--query-timeout-ms` (‏10000، ≥ 1 — لا «بلا مهلة»)،
 * `--max-retry-ms` (‏WL-553، افتراضاً = `--ceiling-ms`: سقفُ التراجعِ الأُسّيّ بتذبذب، ∈ [retry، ceiling])،
 * `--permanent-limit` (‏WL-553، 5، ≥ 1: أخطاءٌ دائمةٌ متتاليةٌ بجدولِ `REAPER_ERROR_TABLE` قبلَ الخروجِ بـ78)،
 * `--role` (‏WL-558: `sovereign` افتراضاً، أو `reaper` = دورُ `xf_reaper` وبابُ 0030 `fence.reaper_tick` بوصلةِ
 * `XUUX_REAPER_DATABASE_URL`؛ ومعه `--query-timeout-ms` ∈ [2000، 300000] و`--ceiling-ms` ≤ 300000).
 * الخرج: سطرُ JSON لكلِّ حدثٍ على stdout: `started`، `connected`، `reaped`، `unresolved`، `error`، `heartbeat`،
 * `fatal`، `stopped` (‏بعدّاداتِ النبضاتِ والأخطاءِ والمحصودِ وغيرِ المحسوم). SIGTERM/SIGINT ⇒ إيقافٌ منضبطٌ ينتظرُ
 * النداءَ الجاريَ ثمّ خروجٌ بـ0.
 *
 * **رموزُ الخروج (‏WL-553):** `0` إيقافٌ بإشارة · `2` استعمالٌ خاطئ (‏خيارٌ أو وصلةٌ غيرُ مضبوطة) أو دورٌ غيرُ `xf_sovereign` ·
 * `78` (‏EX_CONFIG) خطأٌ دائمٌ تكرّرَ `--permanent-limit` مرّةً متتالية (‏مصادقة، قاعدةٌ مفقودة، صلاحيّة، هجرةٌ ناقصة، TLS).
 * المُشرِفُ يُعيدُ ما سواها ويمنعُ إعادةَ `2` و`78` (‏`RestartPreventExitStatus=2 78`) — فالخطأُ الدائمُ لا يُعادُ بلا نهاية،
 * والمؤقّتُ والمجهولُ يبقيانِ داخلَ العمليّةِ بتراجعٍ حتى `--max-retry-ms`.
 */

import process from 'node:process';
import { parseArgs } from 'node:util';

import pg from 'pg';

import { FENCE_ERRORS, runSovereignReaper } from '../src/fence/db-fence.mjs';

/** @param {Record<string, unknown>} event */
const emit = (event) =>
  process.stdout.write(
    `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ...event })}\n`,
  );

const { values } = parseArgs({
  options: {
    'ceiling-ms': { type: 'string', default: '5000' },
    'retry-ms': { type: 'string', default: '1000' },
    'min-delay-ms': { type: 'string', default: '5' },
    'heartbeat-ms': { type: 'string', default: '10000' },
    'query-timeout-ms': { type: 'string', default: '10000' },
    'max-retry-ms': { type: 'string' },
    'permanent-limit': { type: 'string', default: '5' },
    role: { type: 'string', default: 'sovereign' },
  },
});
/** @param {string} name @param {number} [min] */
const int = (name, min = 0) => {
  const v = Number(/** @type {Record<string, string>} */ (values)[name]);
  if (!Number.isInteger(v) || v < min) {
    emit({ ev: 'fatal', reason: `--${name} عددٌ صحيحٌ ≥ ${min}` });
    process.exit(2);
  }
  return v;
};
// WL-558: `--role reaper` ⇒ دورُ xf_reaper وبابُ 0030 (‏fence.reaper_tick بنبضٍ في القاعدة) ووصلتُه XUUX_REAPER_DATABASE_URL.
const role = /** @type {Record<string, string>} */ (values)['role'];
if (role !== 'sovereign' && role !== 'reaper') {
  emit({ ev: 'fatal', reason: '--role ∈ {sovereign، reaper}' });
  process.exit(2);
}
const urlVar = role === 'reaper' ? 'XUUX_REAPER_DATABASE_URL' : 'XUUX_SOVEREIGN_DATABASE_URL';
const url = process.env[urlVar];
if (url === undefined || url === '') {
  emit({ ev: 'fatal', reason: `${urlVar} غيرُ مضبوط` });
  process.exit(2);
}
// WL-548: 0 في pg يعني «بلا مهلة» للاتصالِ والنداءِ معاً ⇒ قاعدةٌ لا تُجيبُ تُعلِّقُ الحصادَ صامتاً (‏لا error ولا إعادة) — أرضيّةٌ 1.
const queryTimeoutMs = int('query-timeout-ms', 1);
if (role === 'reaper' && (queryTimeoutMs < 2000 || queryTimeoutMs > 300000)) {
  // ‏WL-558: البابُ يرفضُ ما دونَ 2000 (‏> lock_timeout = 1 ث) — رفضٌ هنا بـ2 لا 78 بعدَ خمسِ محاولات.
  emit({ ev: 'fatal', reason: '--query-timeout-ms ∈ [2000، 300000] مع --role reaper' });
  process.exit(2);
}
const heartbeatMs = int('heartbeat-ms');
const ceilingMs = int('ceiling-ms');
const maxRetryMs =
  /** @type {Record<string, unknown>} */ (values)['max-retry-ms'] === undefined
    ? ceilingMs
    : int('max-retry-ms', 1);
const permanentLimit = int('permanent-limit', 1);

/** @type {ReturnType<typeof runSovereignReaper> | null} */
let reaper = null;
let exiting = false;
/** @param {number} code */
const shutdown = async (code) => {
  if (exiting) return;
  exiting = true;
  if (reaper !== null) await reaper.stop();
  process.exit(code);
};

emit({ ev: 'started' });
try {
  reaper = runSovereignReaper({
    ceilingMs,
    retryMs: int('retry-ms'),
    maxRetryMs,
    permanentLimit,
    minDelayMs: int('min-delay-ms'),
    mode: role,
    ...(role === 'reaper' ? { queryTimeoutMs } : {}),
    connect: async () => {
      const c = new pg.Client({
        connectionString: url,
        connectionTimeoutMillis: queryTimeoutMs,
        query_timeout: queryTimeoutMs,
        // ‏WL-558: الخادمُ يُلغي النداءَ عندَ المهلةِ نفسِها (‏57014) — فلا يبقى حصادٌ يعملُ بعدَ تخلّي العميلِ عنه.
        statement_timeout: queryTimeoutMs,
        application_name: role === 'reaper' ? 'xuux-reaper' : 'xuux-sovereign-reaper',
      });
      c.on('error', () => {});
      try {
        await c.connect();
      } catch (error) {
        await c.end().catch(() => {});
        throw error;
      }
      return c;
    },
    log: (event) => {
      emit(event);
      // ‏دورٌ غيرُ xf_sovereign خطأُ إعدادٍ لا انقطاع: لا إعادةَ محاولةٍ بلا نهاية — خروجٌ بـ2.
      if (event['ev'] === 'error' && event['code'] === FENCE_ERRORS.REAPER_ROLE) {
        emit({ ev: 'fatal', reason: 'role' });
        void shutdown(2);
      } else if (event['ev'] === 'error' && event['permanent_exhausted'] === true) {
        // ‏WL-553: خطأٌ دائمٌ متكرّر ⇒ 78 لا إعادةَ محاولةٍ بلا نهاية (‏ولا يُعيدُه المُشرِف).
        emit({ ev: 'fatal', reason: 'permanent', code: event['code'], rule: event['rule'] });
        void shutdown(78);
      }
    },
  });
} catch (error) {
  emit({ ev: 'fatal', reason: String(/** @type {any} */ (error)?.message ?? error) });
  process.exit(2);
}
if (heartbeatMs > 0) {
  setInterval(() => {
    if (reaper !== null && !exiting) emit({ ev: 'heartbeat', ...reaper.stats() });
  }, heartbeatMs).unref();
}
for (const sig of /** @type {const} */ (['SIGTERM', 'SIGINT'])) {
  process.on(sig, () => {
    emit({ ev: 'signal', signal: sig });
    void shutdown(0);
  });
}
