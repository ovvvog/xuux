#!/usr/bin/env node
// التثبيت الدوري الموقَّع لسجل الأحداث — الخطوة M2.06
//
// الغرض:      أداة التشغيل التي تجعل التثبيت **دورياً** فعلاً: تُنادى من مُجدول
//             (cron أو مؤقّت الخدمة) فتثبّت إن انقضت الفترة، وتتحقق عند الطلب،
//             وتُظهر المدى المُثبَت والنافذة غير المثبَّتة.
// المدخلات:   status | anchor [--force] | verify   [--json]
//             المسارات والمخزن من البيئة لا من الأمر:
//               EVENT_LOG_FILE     ملف الأحداث
//               ANCHOR_STORE_FILE  ملف التثبيتات (يجب أن يكون منفصلاً)
//               ANCHOR_INTERVAL_MINUTES  الفترة بالدقائق (افتراضها 60)
//               ومخزن المفاتيح كما في rotate-king-key.mjs
// المخرجات:   تقرير نصي أو JSON بـ‏`--json`. لا تُطبع مادة مفتاح خاص أبداً.
// التشغيل:    node scripts/anchor-log.mjs anchor
// الاختبار:   node --test tests/tooling/anchor-log-cli.test.mjs
// الصلاحيات:  قراءة السجل (بلا قفل وبلا كتابة)، وإلحاق في مخزن التثبيتات،
//             وقراءة مخزن المفاتيح. لا تمرّ ببوابة التاج.
// المالك:     مسؤول جذر الثقة.
//
// لماذا لا تفتح الأداة السجل للكتابة: فتحه يأخذ قفل الكاتب الواحد وقد يقتطع
// ذيلاً غير مكتمل، فتصير أداةُ التدقيق مُغيِّرةً للمدقَّق ومُعطِّلةً للخدمة التي
// تكتب. فتُقرأ الأحداث بالفحص القرائي المحض (`inspectEventLog`)، والإلحاق يقع
// في مخزن التثبيتات وحده.

import {
  FileAnchorStore,
  LogAnchorer,
  inspectEventLog,
  kingKeyProviderFromEnv,
  loadKingKeySet,
} from '../src/root-of-trust/index.mjs';

/** الاستعمال المطبوع عند الخطأ أو عند `--help`. */
const USAGE = `الاستعمال:
  node scripts/anchor-log.mjs status [--json]
  node scripts/anchor-log.mjs anchor [--force] [--json]
  node scripts/anchor-log.mjs verify [--json]

البيئة:
  EVENT_LOG_FILE            ملف سجل الأحداث (إلزامي)
  ANCHOR_STORE_FILE         ملف التثبيتات المنفصل (إلزامي)
  ANCHOR_INTERVAL_MINUTES   الفترة بين تثبيتين بالدقائق (افتراضها 60)
  مخزن المفاتيح:            KING_KEY_STORE_ENDPOINT/TOKEN أو KING_KEY_DIR/KING_KEY_MASTER`;

/**
 * يفكّ وسائط سطر الأوامر إلى أمرٍ وخيارات.
 * @param {string[]} argv - الوسائط بعد اسم السكربت
 * @returns {{ command: string, json: boolean, force: boolean }}
 */
export function parseArgs(argv) {
  const parsed = { command: argv[0] ?? 'status', json: false, force: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') parsed.json = true;
    else if (argument === '--force') parsed.force = true;
    else throw new Error(`وسيط غير معروف: ${argument}`);
  }
  return parsed;
}

/**
 * يقرأ الإعداد من البيئة ويرفض ما ينقص، فلا يُخترع مسار افتراضي لسجل دولة.
 * @param {NodeJS.ProcessEnv} env - البيئة
 * @returns {{ logFile: string, storeFile: string, intervalMs: number }}
 */
export function readConfig(env) {
  const logFile = env['EVENT_LOG_FILE'];
  const storeFile = env['ANCHOR_STORE_FILE'];
  if (!logFile) throw new Error('EVENT_LOG_FILE غير معلَن');
  if (!storeFile) throw new Error('ANCHOR_STORE_FILE غير معلَن');
  const minutes = Number(env['ANCHOR_INTERVAL_MINUTES'] ?? 60);
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new Error('ANCHOR_INTERVAL_MINUTES غير صالح');
  return { logFile, storeFile, intervalMs: minutes * 60 * 1000 };
}

/**
 * يصوغ تقرير التحقق نصاً.
 * @param {import('../src/root-of-trust/anchor.mjs').AnchorVerification} result - نتيجة التحقق
 * @returns {string} التقرير
 */
export function formatVerification(result) {
  const lines = [
    result.ok ? '✅ السجل مطابق لتثبيتاته الموقَّعة' : '❌ السجل لا يطابق تثبيتاته',
    `التثبيتات: ${result.anchors}`,
    `أحداث مُثبَتة: ${result.provenEvents}`,
    `أحداث بعد آخر تثبيت (غير مثبَّتة): ${result.unanchoredEvents}`,
    `إصدارات المفاتيح التي قَبِلت: ${result.keyVersions.join('، ') || '—'}`,
  ];
  if (result.problem)
    lines.push(`العطب: ${result.problem}${result.problemAt ? ` عند ${result.problemAt}` : ''}`);
  if (result.detail) lines.push(`التفصيل: ${result.detail}`);
  return lines.join('\n');
}

/**
 * ينفّذ الأمر ويرجع ما يُطبع، بلا مسّ `process`, كي يُختبر نداءً لا عملية.
 * @param {string[]} argv - الوسائط
 * @param {NodeJS.ProcessEnv} env - البيئة
 * @returns {Promise<string>} المخرج المطبوع
 */
export async function run(argv, env) {
  const args = parseArgs(argv);
  if (args.command === '--help' || args.command === 'help') return USAGE;
  const config = readConfig(env);
  const king = await loadKingKeySet(kingKeyProviderFromEnv(env));
  const store = new FileAnchorStore(config.storeFile);
  store.assertSeparateFrom(config.logFile);
  const anchorer = new LogAnchorer(store, king, { intervalMs: config.intervalMs });
  const inspection = inspectEventLog(config.logFile);
  const log = { events: inspection.events, file: config.logFile };

  if (args.command === 'status') {
    const latest = anchorer.latest();
    const payload = {
      logFile: config.logFile,
      storeFile: store.location,
      events: inspection.count,
      logProblem: inspection.problem ?? null,
      anchors: store.read().length,
      latestAnchor: latest
        ? { seq: latest.seq, count: latest.count, at: latest.at, keyVersion: latest.keyVersion }
        : null,
      intervalMinutes: config.intervalMs / 60000,
      acceptedKeyVersions: king.acceptedVersions ?? [1],
    };
    if (args.json) return JSON.stringify(payload, null, 2);
    return [
      `ملف السجل: ${payload.logFile}`,
      `مخزن التثبيتات: ${payload.storeFile}`,
      `أحداث على القرص: ${payload.events}${payload.logProblem ? ` (عطب: ${payload.logProblem})` : ''}`,
      `تثبيتات محفوظة: ${payload.anchors}`,
      latest
        ? `آخر تثبيت: رقم ${latest.seq} عند الحدث ${latest.count} في ${latest.at} بإصدار المفتاح ${latest.keyVersion}`
        : 'آخر تثبيت: لا يوجد — السجل غير مُثبَت بعد',
      `الفترة: ${payload.intervalMinutes} دقيقة`,
    ].join('\n');
  }

  if (args.command === 'anchor') {
    if (inspection.problem) throw new Error(`لا يُثبَّت سجل معطوب: ${inspection.problem}`);
    const record = args.force ? anchorer.anchor(log) : anchorer.maybeAnchor(log);
    if (record === null) {
      const message = 'لم يقع تثبيت: الفترة لم تنقضِ أو لا جديد. استعمل --force للتثبيت الآن.';
      return args.json
        ? JSON.stringify({ anchored: false, reason: 'INTERVAL_OR_NO_NEW_EVENTS' })
        : message;
    }
    if (args.json) return JSON.stringify({ anchored: true, anchor: record }, null, 2);
    return `✅ تثبيت رقم ${record.seq} عند الحدث ${record.count} بإصدار المفتاح ${record.keyVersion}\nالتجزئة المشهود لها: ${record.lastHash}`;
  }

  if (args.command === 'verify') {
    const result = anchorer.verify(log);
    if (args.json) return JSON.stringify(result, null, 2);
    return formatVerification(result);
  }

  throw new Error(`أمر غير معروف: ${args.command}\n\n${USAGE}`);
}

// التشغيل المباشر فقط؛ الاستيراد للاختبار لا يُنفّذ شيئاً.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), process.env)
    .then((output) => {
      process.stdout.write(output + '\n');
    })
    .catch((error) => {
      process.stderr.write(`خطأ: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
