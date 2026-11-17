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
 * `--min-delay-ms` (‏5)، `--heartbeat-ms` (‏10000، 0 = بلا نبض)، `--query-timeout-ms` (‏10000، ≥ 1 — لا «بلا مهلة»).
 * الخرج: سطرُ JSON لكلِّ حدثٍ على stdout: `started`، `connected`، `reaped`، `unresolved`، `error`، `heartbeat`،
 * `fatal`، `stopped` (‏بعدّاداتِ النبضاتِ والأخطاءِ والمحصودِ وغيرِ المحسوم). SIGTERM/SIGINT ⇒ إيقافٌ منضبطٌ ينتظرُ
 * النداءَ الجاريَ ثمّ خروجٌ بـ0.
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
const url = process.env['XUUX_SOVEREIGN_DATABASE_URL'];
if (url === undefined || url === '') {
  emit({ ev: 'fatal', reason: 'XUUX_SOVEREIGN_DATABASE_URL غيرُ مضبوط' });
  process.exit(2);
}
// WL-548: 0 في pg يعني «بلا مهلة» للاتصالِ والنداءِ معاً ⇒ قاعدةٌ لا تُجيبُ تُعلِّقُ الحصادَ صامتاً (‏لا error ولا إعادة) — أرضيّةٌ 1.
const queryTimeoutMs = int('query-timeout-ms', 1);
const heartbeatMs = int('heartbeat-ms');

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
    ceilingMs: int('ceiling-ms'),
    retryMs: int('retry-ms'),
    minDelayMs: int('min-delay-ms'),
    connect: async () => {
      const c = new pg.Client({
        connectionString: url,
        connectionTimeoutMillis: queryTimeoutMs,
        query_timeout: queryTimeoutMs,
        application_name: 'xuux-sovereign-reaper',
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
