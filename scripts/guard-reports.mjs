#!/usr/bin/env node
/**
 * حاجزُ التقاريرِ الملكيةِ الدورية — البوابةُ الخامسةُ والعشرون في
 * `npm run validate` (الخطوة M8.09).
 *
 * البوابةُ 22 تحرس اختصاصَ المؤسسةِ ودورتَها، وهذه تحرس تقريرَ **الدولة**: أنّ
 * كلَّ حقلٍ فيه **مقيسٌ من صفوفٍ بمصدرٍ مُسمّى** أو **تقديريٌّ مُعلَنٌ بفرضيته**،
 * ولا ثالثَ لهما؛ وأنّ الحقولَ المعلَنةَ والمقاييسَ المنفَّذةَ متقابلةٌ في
 * الاتجاهين؛ وأنّ المراجعةَ بشريةٌ مقروءةٌ من سجلِّ الهويات؛ وأنّ النشرَ أمرٌ
 * ملكيٌّ يمرّ ببوابةِ التاجِ **قبل** لمسِ الحال، وبعد إعادةِ قياسٍ تُطابق البصمة.
 * وثماني قواعد:
 *
 *   R1: `config/royal-reports.yaml` تُحمَّل بمخطَّطها، وأقسامُها الأربعةُ معلَنة،
 *       وكلُّ حقلٍ فيها إمّا بمصدرٍ وإمّا بفرضيةٍ لا تقلّ عن ستين حرفاً.
 *   R2: كلُّ رمزٍ في `REPORT_ERRORS` له ضمانٌ في الوثيقة وبالعكس؛ فرفضٌ بلا نصٍّ
 *       رفضٌ لا يُحاسب عليه أحد.
 *   R3: `ROYAL_REPORT_SPEC` قائمةٌ بتفرُّدِ `reportId` وبثوابتِه الخمسة.
 *   R4: الهجرة 0018 صعوداً ونزولاً موجودةٌ بجدولها وقيودِها الثمانيةِ بأسمائها،
 *       ونزولُها يرفض التراجعَ إن كان في الجدولِ صفٌّ واحد.
 *   R5: المُولِّدُ **مركَّبٌ** في `composition.mjs`، والمواصفةُ في
 *       `composition.mjs` و`unit-of-work.mjs`، وتُمرَّر بوابةُ التاجِ وسجلُّ
 *       الهويات؛ فتقريرٌ ككودٍ غيرِ مركَّبٍ تقريرٌ لا مسارَ له في التشغيل.
 *   R6: البوابةُ تُنادى **قبل** كلِّ لمسٍ للحالةِ في `royal-report.mjs`: قبل
 *       `this.reports.update(` وقبل `this.reports.insert(` في مسارِ النشر.
 *   R7: القياسُ لا يُمرَّر: لا موضعَ يقرأ قيمةَ حقلٍ من دخلِ مستدعٍ
 *       (`input.value` / `input.fields`)، وإعادةُ القياسِ عند النشرِ مقابلةٌ
 *       بالبصمةِ نصّاً.
 *   R8: ملفُّ اختبارِ التقاريرِ موجودٌ ويقيس التقديرَ غيرَ المعلَنِ والمراجعةَ
 *       البشريةَ والنشرَ بأمرٍ والبياتَ؛ فبوابةٌ تحرس النصَّ بلا اختبارٍ يقيس
 *       السلوكَ نصفُ حاجز.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ المستودعَ ولا يشغّل قاعدةً؛ أنّ الهجرة 0018
 * طُبِّقت على PostgreSQL حقيقيٍّ غيرُ مُثبَتٍ هنا كما في البوابات 21–24، وهو
 * مسجَّلٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثانٍ:** الحاجزُ يحرس **وقوعَ** النداءِ وترتيبَه نصّاً، لا صحّةَ
 * التوقيعِ ولا صدقَ القياسِ نفسِه — الأولُ عملُ بوابةِ التاج، والثاني مقيسٌ في
 * `tests/reports/royal-report.test.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { REPORT_ERRORS, loadReportPolicy } from '../src/reports/royal-report.mjs';
import { ROYAL_REPORT_SPEC } from '../src/persistence/entities.mjs';

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf('--root');
const rootArg = rootIndex >= 0 ? argv[rootIndex + 1] : undefined;
const ROOT =
  rootArg !== undefined && rootArg !== ''
    ? path.resolve(rootArg)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const violations = [];

/**
 * @param {string} relative
 * @returns {string}
 */
function readFile(relative) {
  const full = path.join(ROOT, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

// ═══ R1 ═══
/** @type {import('../src/reports/royal-report.mjs').ReportPolicy | null} */
let policy = null;
try {
  policy = loadReportPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R1: ${error instanceof Error ? error.message : String(error)}`);
}

let declaredFields = 0;
let estimatedFields = 0;
if (policy !== null) {
  for (const id of ['state', 'risks', 'violations', 'cost']) {
    if (!policy.sections.some((section) => section.id === id)) {
      violations.push(`R1: القسم ${id} غيرُ معلَنٍ — تقريرُ الدولةِ أربعةُ أقسامٍ لا أقلّ.`);
    }
  }
  for (const section of policy.sections) {
    for (const field of section.fields) {
      declaredFields += 1;
      if (field.estimated) {
        estimatedFields += 1;
        if (typeof field.assumption !== 'string' || field.assumption.trim().length < 60) {
          violations.push(
            `R1: الحقل ${field.id} تقديريٌّ بفرضيةٍ أقصرَ من ستين حرفاً — تقديرٌ بلا فرضيةٍ مكتوبةٍ تقديرٌ غيرُ معلَن.`,
          );
        }
        continue;
      }
      if (typeof field.measure !== 'string' || field.measure === '') {
        violations.push(
          `R1: الحقل ${field.id} غيرُ تقديريٍّ ولا مصدرَ قياسٍ له — حقلٌ لا يُعرف من أين جاء رقمُه.`,
        );
      }
    }
  }
  if (declaredFields < 4) {
    violations.push(
      `R1: عددُ الحقولِ المعلَنةِ ${declaredFields} — تقريرٌ بحقلٍ أو حقلين ليس تقريراً.`,
    );
  }
}

// ═══ R2 ═══
if (policy !== null) {
  const declaredCodes = new Set(policy.guarantees.map((entry) => entry.code));
  for (const code of Object.values(REPORT_ERRORS)) {
    if (!declaredCodes.has(code)) {
      violations.push(`R2: الرمز ${code} مُنفَّذٌ ولا ضمانَ له في الوثيقة — رفضٌ بلا نصٍّ يُقرأ.`);
    }
  }
  for (const code of declaredCodes) {
    if (!Object.values(REPORT_ERRORS).includes(/** @type {never} */ (code))) {
      violations.push(
        `R2: الضمان ${code} معلَنٌ ولا رمزَ له في الوحدة — ضمانٌ لا يُنفَّذ وعدٌ لا يُقاس.`,
      );
    }
  }
}

// ═══ R3 ═══
const uniqueOnReport = ROYAL_REPORT_SPEC.unique.some(
  (group) => group.length === 1 && group[0] === 'reportId',
);
if (!uniqueOnReport) {
  violations.push(
    'R3: `ROYAL_REPORT_SPEC` بلا تفرُّدٍ على `reportId` — تقريران بمعرّفٍ واحدٍ يُقرأ أحدُهما تصحيحاً للآخر بلا إعلان.',
  );
}
const invariantCodes = new Set(ROYAL_REPORT_SPEC.invariants.map((entry) => entry.code));
for (const code of [
  'ROYAL_REPORT_PERIOD_ORDERED',
  'ROYAL_REPORT_FIELDS_MEASURED',
  'ROYAL_REPORT_ESTIMATES_DECLARED',
  'ROYAL_REPORT_REVIEW_BOUND',
  'ROYAL_REPORT_PUBLISH_REQUIRES_REVIEW',
]) {
  if (!invariantCodes.has(code)) {
    violations.push(
      `R3: ثابتُ ${code} غائبٌ عن مواصفةِ التقرير — صفٌّ يُقبل بحقولٍ لا يُعرف قياسُها.`,
    );
  }
}

// ═══ R4 ═══
const up = readFile('migrations/0018_royal_reports.up.sql');
const down = readFile('migrations/0018_royal_reports.down.sql');
if (up === '' || down === '') {
  violations.push(
    'R4: الهجرة 0018 صعوداً أو نزولاً غائبة — تقريرٌ في الكودِ بلا جدولٍ في القاعدة تقريرٌ يُفقَد بإعادةِ التشغيل.',
  );
} else {
  if (!up.includes('CREATE TABLE state.royal_reports')) {
    violations.push('R4: الهجرة 0018 لا تُنشئ `state.royal_reports`.');
  }
  for (const constraint of [
    'royal_reports_id_once',
    'royal_reports_period_ordered',
    'royal_reports_fields_measured',
    'royal_reports_sections_shaped',
    'royal_reports_estimates_declared',
    'royal_reports_review_bound',
    'royal_reports_publish_requires_review',
    'royal_reports_decision_matches_state',
  ]) {
    if (!up.includes(constraint)) {
      violations.push(
        `R4: القيد ${constraint} غائبٌ عن الهجرة 0018 — ثابتٌ في الكودِ وحدَه يُخترَق بأولِ كتابةٍ مباشرةٍ في القاعدة.`,
      );
    }
  }
  // والتقديرُ مفروضٌ في القاعدةِ على كلِّ حقلٍ في `sections` لا على عدّادٍ وحدَه.
  if (!up.includes('jsonb_array_elements(sections)')) {
    violations.push(
      'R4: قيدُ التقديرِ في الهجرة 0018 لا يمرّ على حقولِ `sections` — عدّادٌ يُفحَص وحقولٌ تُقبل بلا فرضيةٍ ولا مصدر.',
    );
  }
  if (!down.includes('RAISE EXCEPTION')) {
    violations.push(
      'R4: تراجعُ الهجرة 0018 لا يرفض إسقاطَ جدولٍ فيه تقاريرُ مسجَّلة — محوُ التقاريرِ محوُ المراجعةِ وأمرِ النشر.',
    );
  }
}

// ═══ R5 ═══
const composition = readFile('src/persistence/composition.mjs');
const unitOfWork = readFile('src/persistence/unit-of-work.mjs');
/** @type {Array<[string, string]>} */
const composed = [
  ['src/persistence/composition.mjs', composition],
  ['src/persistence/unit-of-work.mjs', unitOfWork],
];
for (const [file, source] of composed) {
  if (!source.includes('ROYAL_REPORT_SPEC')) {
    violations.push(
      `R5: مواصفةُ التقريرِ غيرُ مركَّبةٍ في ${file} — جدولٌ بلا مستودعٍ لا يُكتب فيه.`,
    );
  }
}
if (!composition.includes('new RoyalReportGenerator(')) {
  violations.push('R5: `RoyalReportGenerator` غيرُ مُنشَأٍ في composition.mjs.');
}
for (const needle of ['createReportMeasures(', 'reports: repositories.royalReports', 'agents,']) {
  if (!composition.includes(needle)) {
    violations.push(
      `R5: \`${needle}\` غيرُ مُمرَّرٍ إلى RoyalReportGenerator في composition.mjs — تقريرٌ بلا مقاييسَ أو بلا سجلِّ هوياتٍ تقريرٌ يُكتب بالتقديرِ ويُراجَع بالاسم.`,
    );
  }
}

// ═══ R6 و R7 ═══
const source = readFile('src/reports/royal-report.mjs');
if (source === '') {
  violations.push('R6: `src/reports/royal-report.mjs` غائب.');
} else {
  const publishAt = source.indexOf('async publish(');
  const crownAt = source.indexOf('this.crown.command(');
  const updateAt = source.indexOf('this.reports.update(', publishAt >= 0 ? publishAt : 0);
  if (crownAt < 0) {
    violations.push(
      'R6: `this.crown.command(` غيرُ موجودٍ — نشرٌ بلا نداءِ بوابةِ التاجِ فعلٌ بلا أمرٍ ملكيّ.',
    );
  } else if (updateAt >= 0 && crownAt > updateAt) {
    violations.push(
      'R6: نداءُ بوابةِ التاجِ يقع بعد `this.reports.update(` في مسارِ النشر — حالٌ كُتب ثم استُؤذِن التاجُ فيه.',
    );
  }
  if (!source.includes('REPORT_ERRORS.STALE') || !source.includes('measurement.digest')) {
    violations.push(
      'R7: النشرُ لا يقابل إعادةَ القياسِ بالبصمةِ المحفوظة — تقريرٌ يُنشر بعد تغيُّرِ الصفوفِ تقريرٌ عن دولةٍ أخرى.',
    );
  }
  for (const forbidden of ['input.value', 'input.fields', 'input.rowCount']) {
    if (source.includes(forbidden)) {
      violations.push(
        `R7: \`${forbidden}\` يُقرأ من دخلِ المستدعي — قيمةٌ تُمرَّر جاهزةً ليست قياساً.`,
      );
    }
  }
}

// ═══ R8 ═══
const test = readFile('tests/reports/royal-report.test.mjs');
if (test === '') {
  violations.push(
    'R8: `tests/reports/royal-report.test.mjs` غائب — حاجزٌ يقرأ النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['ESTIMATE_UNDECLARED', 'التقديرُ غيرُ المعلَنِ غيرُ مقيسٍ في الاختبار'],
    ['HUMAN_REVIEW_REQUIRED', 'المراجعةُ البشريةُ غيرُ مقيسة'],
    ['ROYAL_COMMAND_REQUIRED', 'النشرُ بأمرٍ ملكيٍّ غيرُ مقيس'],
    ['STALE', 'بياتُ القياسِ عند النشرِ غيرُ مقيس'],
    ['MEASURE_MISSING', 'تقابلُ الحقولِ بالمقاييسِ غيرُ مقيس'],
  ];
  for (const [needle, why] of measured) {
    if (!test.includes(needle)) violations.push(`R8: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز التقارير الملكية الدورية رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

console.log(
  `✅ حاجز التقارير الملكية الدورية: ${declaredFields} حقلاً معلَناً في أربعةِ أقسامٍ، كلٌّ منها بمصدرِ قياسٍ مُسمّىً أو بفرضيةٍ مكتوبةٍ (${estimatedFields} تقديريّاً معلَناً)، و${ROYAL_REPORT_SPEC.invariants.length} ثوابتَ و8 قيوداً مسمَّاةً في الهجرة 0018، والنشرُ يمرّ ببوابةِ التاجِ قبل لمسِ الحالِ وبعد إعادةِ قياسٍ تُطابق البصمة.`,
);
