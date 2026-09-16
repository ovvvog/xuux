#!/usr/bin/env node
// حاجزُ الجدولةِ السياديّةِ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
//
// الغرضُ: أن يسقطَ البناءُ إذا عادَ **الطريقُ** الذي كانَ يجعلُ الدوريّةَ عهداً
// في وثيقةٍ لا فعلاً يقعُ، أو الذي يجعلُ الإطلاقَ يقعُ بلا نسبةٍ. والسلوكُ
// نفسُه مقيسٌ في `tests/scheduling/scheduler.test.mjs`؛ وهذا الحاجزُ يحرسُ ما
// لا يحرسُه اختبارُ سلوكٍ: أن لا يُفتحَ المسارُ من موضعٍ آخرَ بعدَ إغلاقِه.
// وسبعُ قواعدَ:
//
//   S1 — القيودُ تتماسكُ أو يسقطُ الحاجزُ: التحميلُ نفسُه هو الفحصُ
//        (‏`loadSchedulePolicy` يقرأُ `config/schedule.yaml` مقابلَ حزمةِ
//        السياسةِ)، فلا تُكرَّرُ قواعدُه هنا كي لا تنحرفَ نسخةُ الحاجزِ عن الكودِ.
//   S2 — **لا عملَ مُعلَنٌ بلا مُنفِّذٍ مسجَّلٍ**: كلُّ عملٍ في القيودِ يجبُ أن
//        يُسجَّلَ له مُنفِّذٌ في `scripts/scheduler.mjs`. وعملٌ مُعلَنٌ بلا مُنفِّذٍ
//        يُقرأُ في الوثيقةِ مجدوَلاً ويُرفَضُ في كلِّ نبضةٍ — جدولةٌ على الورقِ.
//   S3 — **لا جدولةَ لفعلٍ فوقَ العتبةِ السياديّةِ**: العتبةُ تُقرأُ من
//        `config/policies.yaml` لا تُثبَّتُ هنا، وفعلُ الإطلاقِ وكلُّ ما تُعلِنُه
//        الأعمالُ أنّها تفعلُه يجبُ أن يكونَ تحتَها. فما لا يقعُ إلا بأمرٍ ملكيٍّ
//        لا يقعُ بمؤقِّتٍ.
//   S4 — **الإطلاقُ يمرُّ بقرارٍ**: مسارُ `dispatch` يجبُ أن يُنادي `authorize`
//        و`verify` قبلَ أوّلِ كتابةٍ في الدفترِ، وأن يرفضَ بلا نقطةِ تفويضٍ
//        (‏`#assertAuthorizer`). ومُجدوِلٌ يُطلِقُ بلا قرارٍ مسارٌ يعملُ في غيابِ
//        الناسِ بلا نسبةٍ.
//   S5 — **الموعدُ من الدفترِ لا من الذاكرةِ**: لا حقلَ `lastRunAt` ولا ما
//        يُشبهُه في `src/scheduling/`، و`dueJobs` تقرأُ `lastCompletedSlot` من
//        الدفترِ. وموعدٌ في الذاكرةِ يزولُ بإعادةِ التشغيلِ فيُعادُ عملٌ وقعَ أو
//        يُنسى عملٌ فاتَ.
//   S6 — **قفلُ الشقِّ في القاعدةِ لا في الكودِ**: هجرةٌ فيها قيدُ تفرّدٍ على
//        (‏`job_id`, `slot_at`, `phase`)، ووصفُ الكيانِ يُعلِنُ القيدَ نفسَه،
//        والتركيبُ يوصلُ الدفترَ ونقطةَ التفويضِ. وقفلٌ في الكودِ وحدَه لا يمنعُ
//        نسختينِ من المُجدوِلِ من إطلاقِ الشقِّ نفسِه.
//   S7 — **تصفيةُ المستودعِ بالشكلِ الذي يعرفُه**: كلُّ نداءِ `list` في دفترِ
//        الإطلاقاتِ يجبُ أن يُمرِّرَ `filter:`. وهذا نصُّ عيبٍ وقعَ فعلاً: مُصفٍّ
//        بشكلٍ لا يعرفُه المستودعُ يُعادُ معه **كلُّ** الصفوفِ بلا خطأٍ، فيُقرأُ
//        شقُّ عملٍ آخرَ محجوزاً ويُرفَضُ إطلاقٌ مستحقٌّ باسمِ قفلٍ لم يقعْ.
//
// ورمزُ الخروجِ 1 عندَ أيِّ مخالفةٍ، ولا يُسكَتُ الحاجزُ ببيئةٍ ولا بوسيطٍ.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPolicyBundle } from '../src/policy/loader.mjs';
import { SCHEDULER_DISPATCH_ACTION, loadSchedulePolicy } from '../src/scheduling/index.mjs';

const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** @type {string[]} */
const violations = [];

/**
 * @param {string} relative
 * @returns {string}
 */
function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/**
 * يُجرِّدُ النصَّ من التعليقاتِ قبلَ الفحصِ. والسببُ أنّ هذا الحاجزَ يفحصُ
 * **ما يعملُ** لا ما يُوصَفُ: ملفٌّ يشرحُ في تعليقِه أنّه لا يحملُ موعداً في
 * الذاكرةِ كانَ يُسقِطُ الحاجزَ باسمِ ما نفاه، وحاجزٌ يقرأُ الشرحَ يُعاقِبُ
 * التوثيقَ ويمرُّ على الشفرةِ.
 * @param {string} text
 * @returns {string}
 */
function withoutComments(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').replaceAll(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ── S1: القيودُ تُحمَّلُ أو يسقطُ الحاجزُ ──
const bundle = loadPolicyBundle({ dir: path.join(ROOT, 'config') });
/** @type {import('../src/scheduling/index.mjs').SchedulePolicy} */
let policy;
try {
  policy = loadSchedulePolicy({ dir: path.join(ROOT, 'config'), bundle });
} catch (error) {
  // الرفضُ يُسمّى ولا يُرمى: خطأٌ يخرجُ بأثرِ مكدّسٍ يجعلُ المُراجِعَ يقرأُ عطلاً
  // في الحاجزِ حيثُ الواقعُ مخالفةٌ في القيودِ.
  console.error(
    `⛔ S1: قيودُ الجدولةِ لا تُحمَّلُ: ${error instanceof Error ? error.message : error}`,
  );
  console.error('\n⛔ حاجز الجدولة: مخالفةً واحدةً.');
  process.exit(1);
}
if (policy.jobs.length === 0) {
  violations.push(
    'S1: لا عملَ مُعلَنٌ في `config/schedule.yaml`؛ ومُجدوِلٌ بلا عملٍ ليس إغلاقاً لدَينِ الجدولةِ.',
  );
}

// ── S2: لا عملَ مُعلَنٌ بلا مُنفِّذٍ مسجَّلٍ ──
const runner = read('scripts/scheduler.mjs');
for (const job of policy.jobs) {
  if (!runner.includes(`'${job.id}'`)) {
    violations.push(
      `S2: العملُ «${job.id}» مُعلَنٌ في القيودِ ولا مُنفِّذَ مسجَّلٌ له في \`scripts/scheduler.mjs\`؛ فيُرفَضُ في كلِّ نبضةٍ ويُقرأُ مجدوَلاً.`,
    );
  }
}

// ── S3: لا جدولةَ لفعلٍ فوقَ العتبةِ السياديّةِ ──
const sovereign = new Set((bundle.threshold ?? []).map((entry) => String(entry.action)));
const scheduledActions = new Set([
  SCHEDULER_DISPATCH_ACTION,
  ...policy.jobs.flatMap((job) => [...job.performs]),
]);
for (const action of scheduledActions) {
  if (sovereign.has(action)) {
    violations.push(
      `S3: الفعلُ «${action}» فوقَ العتبةِ السياديّةِ وهو مجدوَلٌ؛ وما لا يقعُ إلا بأمرٍ ملكيٍّ لا يقعُ بمؤقِّتٍ.`,
    );
  }
  if (!bundle.actions.has(action)) {
    violations.push(
      `S3: الفعلُ «${action}» مجدوَلٌ وليس في فهرسِ الأفعالِ؛ وفعلٌ بلا تعريفٍ لا يُقيَّمُ فيُقرأُ الرفضُ عطلاً.`,
    );
  }
}

// ── S4: الإطلاقُ يمرُّ بقرارٍ ──
const schedulerSource = withoutComments(read('src/scheduling/scheduler.mjs'));
const dispatchBody = schedulerSource.slice(
  schedulerSource.indexOf('async dispatch('),
  schedulerSource.indexOf('async tick('),
);
if (dispatchBody === '') {
  violations.push(
    'S4: لم يُعثَرْ على مسارِ `dispatch` في المُجدوِلِ؛ ولا يُقاسُ حكمٌ على مسارٍ غائبٍ.',
  );
} else {
  const authorizeAt = dispatchBody.indexOf('.authorize(');
  const verifyAt = dispatchBody.indexOf('.verify(');
  const appendAt = dispatchBody.indexOf('this.ledger.append(');
  if (authorizeAt < 0 || verifyAt < 0) {
    violations.push(
      'S4: مسارُ الإطلاقِ لا يُنادي `authorize` و`verify`؛ وقرارٌ لا يُطلَبُ أو تذكرةٌ لا تُستهلَكُ يجعلُ البوّابةَ ورقةً.',
    );
  } else if (!(authorizeAt < appendAt && verifyAt < appendAt)) {
    violations.push(
      'S4: الكتابةُ في الدفترِ تسبقُ التفويضَ أو استهلاكَ التذكرةِ؛ وحجزٌ قبلَ القرارِ يجعلُ الرفضَ يقعُ بعدَ الفعلِ.',
    );
  }
  if (!dispatchBody.includes('#assertAuthorizer()')) {
    violations.push(
      'S4: مسارُ الإطلاقِ لا يفحصُ وجودَ نقطةِ التفويضِ وبوابةِ الهويةِ؛ وفشلٌ مفتوحٌ هنا مسارٌ يعملُ بلا حاضرٍ.',
    );
  }
}

// ── S5: الموعدُ من الدفترِ لا من الذاكرةِ ──
const schedulingDir = path.join(ROOT, 'src', 'scheduling');
for (const entry of fs.readdirSync(schedulingDir)) {
  if (!entry.endsWith('.mjs')) continue;
  const text = withoutComments(fs.readFileSync(path.join(schedulingDir, entry), 'utf8'));
  if (/lastRunAt|lastDispatchedAt|#lastRun\b/.test(text)) {
    violations.push(
      `S5: \`src/scheduling/${entry}\` يحملُ موعداً في الذاكرةِ؛ ومصدرُ الموعدِ الوحيدُ دفترُ الإطلاقاتِ، فذاكرةٌ تزولُ بإعادةِ التشغيلِ.`,
    );
  }
}
const duenessBody = schedulerSource.slice(
  schedulerSource.indexOf('async dueJobs('),
  schedulerSource.indexOf('#assertAuthorizer('),
);
if (!duenessBody.includes('this.ledger.lastCompletedSlot(')) {
  violations.push(
    'S5: قراءةُ الاستحقاقِ لا تسألُ الدفترَ عن آخرِ شقٍّ مكتملٍ؛ فالموعدُ يُقرأُ من موضعٍ آخرَ لا يشهدُ عليه أحدٌ.',
  );
}

// ── S6: قفلُ الشقِّ في القاعدةِ لا في الكودِ ──
const migrations = fs
  .readdirSync(path.join(ROOT, 'migrations'))
  .filter((name) => name.endsWith('.up.sql'))
  .map((name) => read(path.join('migrations', name)))
  .join('\n');
const slotLock = /UNIQUE\s*\(\s*job_id\s*,\s*slot_at\s*,\s*phase\s*\)/i;
if (!slotLock.test(migrations)) {
  violations.push(
    'S6: لا قيدَ تفرّدٍ في هجرةٍ على (job_id, slot_at, phase)؛ وقفلُ الشقِّ في الكودِ وحدَه لا يمنعُ نسختينِ من إطلاقِ شقٍّ واحدٍ.',
  );
}
const entities = read('src/persistence/entities.mjs');
if (!/\[\s*'jobId'\s*,\s*'slotAt'\s*,\s*'phase'\s*\]/.test(entities)) {
  violations.push(
    "S6: وصفُ كيانِ الإطلاقاتِ لا يُعلِنُ تفرّدَ ['jobId','slotAt','phase']؛ فمستودعُ الذاكرةِ يقبلُ ما ترفضُه القاعدةُ فيفترقُ الاختبارُ عن التشغيلِ.",
  );
}
const composition = read('src/persistence/composition.mjs');
/** @type {Array<[string, string]>} */
const compositionRules = [
  [
    'new Scheduler(',
    'التركيبُ لا يبني مُجدوِلاً؛ ومُجدوِلٌ يُبنى في نصِّ مُشغِّلٍ وحدَه يبقى خارجَ الدولةِ.',
  ],
  [
    'new ScheduledRunLedger(',
    'التركيبُ لا يوصلُ دفترَ الإطلاقاتِ؛ ودفترٌ يُبنى في كلِّ موضعٍ يجعلُ الموعدَ يُقرأُ من دفترٍ ويُكتَبُ في آخرَ.',
  ],
  [
    'scheduledRuns:',
    'مستودعُ الإطلاقاتِ غيرُ مُركَّبٍ في `StateRepositories`؛ فالدفترُ بلا موضعٍ يُقرأُ منه.',
  ],
];
for (const [needle, message] of compositionRules) {
  if (!composition.includes(needle)) violations.push(`S6: ${message}`);
}

// ── S7: تصفيةُ المستودعِ بالشكلِ الذي يعرفُه ──
const ledgerSource = withoutComments(read('src/scheduling/run-ledger.mjs'));
for (const match of ledgerSource.matchAll(/this\.repository\.list\(([^)]*)\)/g)) {
  const argument = String(match[1]).trim();
  if (argument !== '{}' && !argument.includes('filter:')) {
    violations.push(
      `S7: نداءُ \`list(${argument})\` في دفترِ الإطلاقاتِ يُمرِّرُ مُصفّياً بشكلٍ لا يعرفُه المستودعُ؛ فتُعادُ كلُّ الصفوفِ بلا خطأٍ ويُرفَضُ إطلاقٌ مستحقٌّ باسمِ قفلٍ لم يقعْ.`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(`⛔ ${violation}`);
  console.error(`\n⛔ حاجز الجدولة: ${violations.length} مخالفةً.`);
  process.exit(1);
}

console.log(
  `✅ حاجز الجدولة: ${policy.jobs.length} عملاً مُعلَناً لكلٍّ مُنفِّذٌ مسجَّلٌ، ونبضٌ كلَّ ${policy.tick.everyMinutes} دقيقةً، و${scheduledActions.size} فعلاً مجدوَلاً كلُّها تحتَ العتبةِ السياديّةِ (${sovereign.size} فعلاً فوقَها)، وقفلُ الشقِّ قيدٌ في القاعدةِ.`,
);
