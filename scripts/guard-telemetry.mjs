#!/usr/bin/env node
/**
 * حاجزُ القياسِ الموحّد — البوابةُ الرابعةُ والثلاثون في تسلسلِ الحواجزِ
 * المُعلَنِ في سجلِّ العمل (الخطوة `M10.01`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** موضعُ هذا الحاجزِ المقيسُ في سلسلةِ
 * `npm run validate` هو **الثانيةُ والثلاثون** بين خطواتِها كلِّها،
 * و**الرابعُ والعشرون** بين حواجزِها؛ وهو **السادسُ والعشرون** عدداً بين نصوصِ
 * `guard:*` في `package.json` (وهي ستةٌ وعشرون نصّاً بعد إضافتِه). والرتبةُ
 * المُعلَنةُ أعلاه تتبع التسلسلَ المكتوبَ في سجلِّ العملِ منذ `WL-043`، وفارقُهما
 * دَينُ توثيقٍ **سابقٌ** لهذه الخطوةِ مسجَّلٌ في `WL-048` و`WL-050` و`WL-051`
 * و`WL-052` ولا يُصلَح بتعديلِ سجلٍّ قديم.
 *
 * البوابةُ الثالثةُ والثلاثون تحرس أن يكون لشهادةِ الدولةِ **موضعُ قراءة**. وهذه
 * تحرس أن يكون للنداءِ الواحدِ **معرّفُ ارتباطٍ واحد**، وأن لا تخرج إشارةٌ باسمٍ
 * لا تعرفه وثيقتُها. وعشرُ قواعد:
 *
 *   R0: `config/telemetry.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ تُخالف مخطَّطَها
 *       تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: **كلُّ مدًى معلَنٍ يُصدَر من ملفِّه**: اسمُ كلِّ مدًى حاضرٌ نصّاً في
 *       `emittedIn` الذي أعلنته الوثيقةُ له؛ فاسمٌ في الوثيقةِ لا يُصدِره ملفُّه
 *       وعدٌ لا يقع، وموضعُ إصدارٍ يخالف المُعلَنَ يجعل قارئَ الوثيقةِ يبحث في
 *       غيرِ موضعه.
 *   R2: **كلُّ مقياسٍ معلَنٍ مستعمَل**: اسمُه حاضرٌ نصّاً في `src/`؛ ومقياسٌ
 *       يُعلَن ولا يُنادى عمودٌ فارغٌ في لوحةٍ يُقرأ صفراً على أنه قياس.
 *   R3: التقابلُ في الاتجاهين بين `refusalCodes` في الوثيقةِ و`TELEMETRY_ERRORS`
 *       في `src/telemetry/telemetry.mjs`: رمزٌ في الكودِ بلا إعلانٍ رمزٌ لا يجده
 *       قارئُ الوثيقة، ورمزٌ في الوثيقةِ بلا كودٍ وعدٌ لا يُنفَّذ.
 *   R4: كلُّ رمزِ ضمانٍ (`G-TEL-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن؛
 *       فضمانٌ مكتوبٌ في وثيقةٍ ولا أثرَ له في كودٍ ضمانٌ يُقرأ ولا يُقاس.
 *   R5: **معيارُ W3C مقيسٌ في الكودِ لا موصوفٌ في نصّ**: الطولان 32 و16
 *       معلَنان ثابتَين في `tracer.mjs`، والنسخةُ `00` مُثبَّتةٌ فيه، وصيغةُ
 *       `traceparent` تُقرأ بنمطٍ يفرض الطولين.
 *   R6: **الساعةُ مُمرَّرةٌ لا ساعةُ النظام**: `Date.now(` لا يظهر في
 *       `src/telemetry/tracer.mjs` إلا مرّةً واحدةً — قيمةً افتراضيةً في المُنشئ —
 *       وكلُّ قراءةِ زمنٍ في مسارِ القياسِ تمرّ من `#readClock(` المتحقِّقة.
 *   R7: الحاجزُ مربوطٌ بالمسار: `npm run guard:telemetry` في `validate` وفي
 *       `.github/workflows/ci.yml`؛ فبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.
 *   R8: **السجلُّ مقرونٌ بالأثر**: سطرُ السجلِّ المهيكلِ يحمل حقلَي الارتباطِ
 *       المُعلَنَين (`traceId` و`spanId`) مقروءَين من السياقِ النشط.
 *   R9: مواضعُ القياسِ الثلاثةُ حاضرةٌ فعلاً في مصادرِها (بوابةٌ ← مراقبةٌ ←
 *       تخزين)، والوثيقةُ الواصفةُ `docs/TELEMETRY.md` موجودةٌ وتُعلن كلَّ مدًى
 *       وكلَّ مقياسٍ وكلَّ رمزِ رفضٍ بالاسم، وملفّا الاختبارِ موجودان.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يُشغّل نداءً ولا يقيس
 * أثراً؛ ومعيارُ القبولِ («نداءٌ واحدٌ من الواجهةِ إلى التخزينِ في أثرٍ واحد»)
 * سلوكٌ مقيسٌ في `tests/telemetry/one-trace.test.mjs` على تركيبٍ حقيقيٍّ لا نصٍّ
 * مقروء.
 *
 * **حدٌّ معلَن ثانٍ:** R1 يقيس **حضورَ الاسمِ نصّاً** في ملفِّه لا صحةَ موضعِه
 * في تدفّقِ التنفيذ؛ فمن كتب الاسمَ في تعليقٍ في الملفِّ نفسِه مرَّ من هذه
 * القاعدة — ويُمسكه اختبارُ معيارِ القبولِ لأنه يقيس المدَياتِ المنتَجةَ فعلاً.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { TELEMETRY_ERRORS, loadTelemetryPolicy } from '../src/telemetry/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @type {string[]} */
const violations = [];

/**
 * @param {string} relative
 * @returns {string}
 */
function readOrEmpty(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
function countOf(haystack, needle) {
  if (needle === '') return 0;
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

// ── R0: الوثيقةُ تُحمَّل بمخطَّطها، وإلا وقفت البوابة ──

/** @type {import('../src/telemetry/telemetry.mjs').TelemetryPolicy | null} */
let policy = null;
try {
  policy = loadTelemetryPolicy();
} catch (error) {
  violations.push(
    `R0: وثيقةُ القياسِ لا تُحمَّل بمخطَّطها: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (policy !== null) {
  const tracer = readOrEmpty('src/telemetry/tracer.mjs');
  const telemetry = readOrEmpty('src/telemetry/telemetry.mjs');

  // ── R1: كلُّ مدًى معلَنٍ يُصدَر من ملفِّه المُعلَن ──

  for (const span of policy.spans) {
    const source = readOrEmpty(span.emittedIn);
    if (source === '') {
      violations.push(`R1: ملفُّ إصدارِ المدى «${span.name}» غائبٌ (${span.emittedIn}).`);
      continue;
    }
    if (!source.includes(`'${span.name}'`)) {
      violations.push(
        `R1: المدى «${span.name}» مُعلَنٌ في ${span.emittedIn} ولا يُصدَر منه — واسمٌ في وثيقةٍ بلا موضعِ إصدارٍ وعدٌ لا يقع.`,
      );
    }
  }

  // ── R2: كلُّ مقياسٍ معلَنٍ مستعمَلٌ في المصدر ──

  const gateway = readOrEmpty('src/api/gateway.mjs');
  const monitor = readOrEmpty('src/observability/monitor-agent.mjs');
  const allSources = `${tracer}\n${telemetry}\n${gateway}\n${monitor}\n${readOrEmpty('src/telemetry/metrics.mjs')}`;
  for (const metric of policy.metrics) {
    if (!allSources.includes(`'${metric.name}'`)) {
      violations.push(
        `R2: المقياس «${metric.name}» مُعلَنٌ ولا يُنادى في أيِّ مصدر — وعمودٌ فارغٌ في لوحةٍ يُقرأ صفراً على أنه قياس.`,
      );
    }
  }

  // ── R3: التقابلُ في الاتجاهين بين الوثيقةِ وكتالوجِ الرموز ──

  /** @type {Set<string>} */
  const codeValues = new Set(Object.values(TELEMETRY_ERRORS));
  /** @type {Set<string>} */
  const declaredCodes = new Set(policy.refusalCodes);
  for (const code of codeValues) {
    if (!declaredCodes.has(code)) {
      violations.push(`R3: الرمز ${code} في الكودِ وغيرُ مُعلَنٍ في الوثيقة.`);
    }
  }
  for (const code of declaredCodes) {
    if (!codeValues.has(code)) {
      violations.push(`R3: الرمز ${code} في الوثيقةِ وغيرُ موجودٍ في \`TELEMETRY_ERRORS\`.`);
    }
  }

  // ── R4: كلُّ ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه ──

  for (const guarantee of policy.guarantees) {
    const source = readOrEmpty(guarantee.enforcedIn);
    if (source === '') {
      violations.push(`R4: ملفُّ إنفاذِ الضمان ${guarantee.id} غائبٌ (${guarantee.enforcedIn}).`);
      continue;
    }
    if (!source.includes(guarantee.id)) {
      violations.push(
        `R4: الضمان ${guarantee.id} غيرُ حاضرٍ نصّاً في ${guarantee.enforcedIn} — وضمانٌ بلا أثرٍ في كودٍ ضمانٌ يُقرأ ولا يُقاس.`,
      );
    }
  }

  // ── R5: معيارُ W3C مقيسٌ في الكودِ ──

  if (!tracer.includes('export const TRACE_ID_HEX_LENGTH = 32;')) {
    violations.push('R5: طولُ معرّفِ الأثرِ (32) غيرُ مُثبَّتٍ ثابتاً في `tracer.mjs`.');
  }
  if (!tracer.includes('export const SPAN_ID_HEX_LENGTH = 16;')) {
    violations.push('R5: طولُ معرّفِ المدى (16) غيرُ مُثبَّتٍ ثابتاً في `tracer.mjs`.');
  }
  if (
    !tracer.includes(
      `export const TRACEPARENT_VERSION = '${policy.correlation.traceparentVersion}';`,
    )
  ) {
    violations.push(
      `R5: نسخةُ traceparent المُعلَنةُ «${policy.correlation.traceparentVersion}» غيرُ مُثبَّتةٍ في \`tracer.mjs\`.`,
    );
  }
  if (!tracer.includes('[0-9a-f]{32}') || !tracer.includes('[0-9a-f]{16}')) {
    violations.push(
      'R5: نمطُ قراءةِ `traceparent` لا يفرض الطولين 32 و16 — وقارئٌ متسامحٌ يقبل معرّفاً مُشوَّهاً فيقطع سلسلةَ الارتباطِ صامتاً.',
    );
  }

  // ── R6: الساعةُ مُمرَّرةٌ لا ساعةُ النظام ──

  const clockUses = countOf(tracer, 'Date.now(');
  if (clockUses > 1) {
    violations.push(
      `R6: \`Date.now(\` يظهر ${clockUses} مرّاتٍ في \`tracer.mjs\` — والمسموحُ واحدةٌ قيمةً افتراضيةً في المُنشئ؛ ومدّةٌ مقيسةٌ بساعةٍ لا تُقاد لا تُختبَر.`,
    );
  }
  if (!tracer.includes('#readClock(')) {
    violations.push('R6: `#readClock(` غائبٌ — ولا موضعَ واحدٌ يتحقّق من الساعةِ قبل القياس.');
  }
  if (!tracer.includes("'TELEMETRY_CLOCK_INVALID'")) {
    violations.push('R6: ساعةٌ فاسدةٌ بلا رفضٍ مُسمّىً في `tracer.mjs`.');
  }

  // ── R7: الحاجزُ مربوطٌ بالمسار ──

  const pkg = readOrEmpty('package.json');
  const ci = readOrEmpty('.github/workflows/ci.yml');
  if (!pkg.includes('"guard:telemetry"')) {
    violations.push('R7: `guard:telemetry` غيرُ مُعلَنٍ نصّاً في `package.json`.');
  }
  if (!pkg.includes('npm run guard:telemetry')) {
    violations.push(
      'R7: `npm run guard:telemetry` غيرُ مربوطٍ بسلسلةِ `validate` — وبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.',
    );
  }
  if (!ci.includes('guard:telemetry')) {
    violations.push('R7: `guard:telemetry` غيرُ مربوطٍ بمسارِ التكاملِ المستمرّ.');
  }

  // ── R8: السجلُّ مقرونٌ بالأثر ──

  if (
    !telemetry.includes(
      `${policy.correlation.traceIdField}: context === null ? null : context.traceId`,
    )
  ) {
    violations.push(
      `R8: سطرُ السجلِّ لا يحمل حقلَ الأثرِ «${policy.correlation.traceIdField}» مقروءاً من السياقِ النشط — وسطرٌ بلا معرّفِ أثرِه يُقرأ مجاوراً لا منسوباً.`,
    );
  }
  if (
    !telemetry.includes(
      `${policy.correlation.spanIdField}: context === null ? null : context.spanId`,
    )
  ) {
    violations.push(
      `R8: سطرُ السجلِّ لا يحمل حقلَ المدى «${policy.correlation.spanIdField}» مقروءاً من السياقِ النشط.`,
    );
  }
  if (!telemetry.includes('activeContext()')) {
    violations.push('R8: السجلُّ لا يقرأ السياقَ النشطَ أصلاً.');
  }

  // ── R9: مواضعُ القياسِ والوثيقةُ الواصفةُ والاختبارات ──

  if (!gateway.includes('telemetry.span(') || !gateway.includes("'api.call'")) {
    violations.push('R9: بوابةُ الواجهةِ لا تفتح المدى الجذرَ `api.call` — ولا رأسَ للأثر.');
  }
  if (gateway.includes("from '../telemetry/")) {
    violations.push(
      'R9: بوابةُ الواجهةِ تستورد من `src/telemetry/` — والقياسُ يُحقَن ولا يُستورَد، وذاك حدٌّ معلَنٌ في رأسِها منذ `M9.02`.',
    );
  }
  if (!monitor.includes("'monitor.read'") || !monitor.includes("'storage.read'")) {
    violations.push(
      'R9: طبقةُ الرصدِ لا تفتح المدَيين `monitor.read` و`storage.read` — والأثرُ لا يبلغ التخزين.',
    );
  }
  if (monitor.includes("from '../telemetry/")) {
    violations.push('R9: طبقةُ الرصدِ تستورد من `src/telemetry/` — والقياسُ يُحقَن ولا يُستورَد.');
  }

  const doc = readOrEmpty('docs/TELEMETRY.md');
  if (doc === '') {
    violations.push('R9: `docs/TELEMETRY.md` غائبةٌ — ولا عملَ بلا وثيقةٍ (المادة 1).');
  } else {
    for (const span of policy.spans) {
      if (!doc.includes(span.name)) violations.push(`R9: المدى «${span.name}» غيرُ موثَّقٍ.`);
    }
    for (const metric of policy.metrics) {
      if (!doc.includes(metric.name)) violations.push(`R9: المقياس «${metric.name}» غيرُ موثَّقٍ.`);
    }
    for (const code of policy.refusalCodes) {
      if (!doc.includes(code)) violations.push(`R9: الرمز ${code} غيرُ موثَّقٍ.`);
    }
    for (const guarantee of policy.guarantees) {
      if (!doc.includes(guarantee.id)) {
        violations.push(`R9: الضمان ${guarantee.id} غيرُ موثَّقٍ.`);
      }
    }
  }

  for (const testFile of [
    'tests/telemetry/telemetry.test.mjs',
    'tests/telemetry/one-trace.test.mjs',
  ]) {
    if (readOrEmpty(testFile) === '') {
      violations.push(
        `R9: ملفُّ الاختبار ${testFile} غائبٌ — ولا ادّعاءَ بلا دليلٍ يُشغَّل (المادة 2).`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز القياس الموحّد رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const spanCount = policy === null ? 0 : policy.spans.length;
const metricCount = policy === null ? 0 : policy.metrics.length;
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
const maxSpans = policy === null ? 0 : policy.limits.maxSpansPerTrace;
console.log(
  `✅ حاجز القياس الموحّد: ${spanCount} مدَياتٍ مُعلَنةٍ كلٌّ يُصدَر من ملفِّه المُعلَن، و${metricCount} مقاييسَ كلُّها منادىً بها في المصدر، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين مع \`TELEMETRY_ERRORS\`، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، ومعرّفاتُ W3C بطولَي 32 و16 والنسخةِ 00 مُثبَّتةً في الكود، والساعةُ مُمرَّرةٌ لا ساعةَ نظام، وسطرُ السجلِّ يحمل معرّفَي أثرِه ومداه، وسقفُ المدَياتِ ${maxSpans} من الوثيقةِ لا من الكود، والبوابةُ وطبقةُ الرصدِ لا تستوردان القياسَ بل يُحقَن فيهما.`,
);
