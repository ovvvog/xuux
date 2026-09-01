#!/usr/bin/env node
/**
 * حاجزُ عارضِ سجلِّ التدقيق — البوابةُ الثالثةُ والثلاثون في تسلسلِ الحواجزِ
 * المُعلَنِ في سجلِّ العمل (الخطوة `M9.07`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** موضعُ هذا الحاجزِ المقيسُ في سلسلةِ
 * `npm run validate` هو **الحاديةُ والثلاثون** بين خطواتِها كلِّها،
 * و**الثالثُ والعشرون** بين حواجزِها؛ وهو **الخامسُ والعشرون** عدداً بين نصوصِ
 * `guard:*` في `package.json` (وهي خمسةٌ وعشرون نصّاً بعد إضافتِه). والرتبةُ المُعلَنةُ أعلاه تتبع التسلسلَ المكتوبَ في سجلِّ
 * العملِ منذ `WL-043`، وفارقُهما دَينُ توثيقٍ **سابقٌ** لهذه الخطوةِ مسجَّلٌ في
 * `WL-048` و`WL-050` و`WL-051` ولا يُصلَح بتعديلِ سجلٍّ قديم.
 *
 * البوابةُ الثانيةُ والثلاثون تحرس **إدارةَ** الأزمة. وهذه تحرس **المساءلةَ**
 * نفسَها: أن يكون لشهادةِ الدولةِ موضعُ قراءةٍ كاملُ الأوجهِ الثلاثةِ التي
 * سمّاها نصُّ الخطوةِ، قارئاً وحدَه لا يكتب في المفحوصِ بايتاً، **ولا يُخرج
 * صفّاً واحداً بلا حكمِ سلامةٍ يرافقه**. وعشرُ قواعد:
 *
 *   R0: `config/audit-log-viewer.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ تُخالف
 *       مخطَّطَها تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: الأوجهُ الثلاثةُ (`AUDIT_VIEWER_FACES`) كلٌّ منها بمشهدٍ **واحدٍ**؛
 *       فعارضٌ ناقصُ وجهٍ عارضٌ أعمى عن سؤالٍ سُمِّي في الخطوةِ بحرفه.
 *   R2: **الأصلُ لا يُخترَع**: كلُّ حقلِ بحثٍ معلَنٍ حقلٌ في `EventRecord`، وأسبابُ
 *       الانكسارِ المُعلَنةُ مطابقةٌ لـ`ChainBreakReasons` **في الاتجاهين** — كلاهما
 *       يُقرأ من `src/root-of-trust/event-log.mts` نفسِه لا من نسخةٍ في الوثيقة.
 *   R3: كلُّ رمزٍ في `AUDIT_VIEWER_ERRORS` مُعلَنٌ في الوثيقةِ وبالعكس، وكلُّ رمزِ
 *       ضمانٍ حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R4: **الساعةُ مُمرَّرةٌ لا ساعةُ النظام**: `Date.now(` لا يظهر في
 *       `src/audit-viewer/` إلا مرّةً واحدةً — قيمةً افتراضيةً في المُنشئ — وكلُّ
 *       ختمِ زمنٍ يمرّ من `#clock(` المتحقِّقة.
 *   R5: **قارئٌ لا يمسّ المفحوص**: لا `.insert(` ولا `.update(` ولا `.remove(`
 *       ولا كلمةَ `repository`، **ولا نداءَ كتابةٍ على نظامِ الملفّات** واحداً
 *       (`writeFileSync`, `appendFileSync`, `openSync`, `truncateSync`, `rmSync`)،
 *       والقراءةُ من `inspectEventLog` وحدَه، والصفوفُ مُجمَّدةٌ عميقاً.
 *   R6: القيدُ **قبل** الأثر: قيدُ قراءةِ المشهدِ يسبق نصّاً فتحَ المفحوص.
 *   R7: الحاجزُ مربوطٌ بالمسار: `npm run guard:audit-viewer` في `validate` وفي
 *       `.github/workflows/ci.yml`؛ فبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.
 *   R8: الوثيقةُ الواصفةُ `docs/AUDIT_LOG_VIEWER.md` موجودةٌ وتُعلن مشاهدَها
 *       بمعرّفاتِها ورموزَ رفضِها كلَّها وحدَّ صفوفِها بالرقم؛ وملفُّ الاختبارِ
 *       موجودٌ ويقيس الرموزَ الحاكمةَ ومعيارَ القبولِ والتجميدَ العميق.
 *   R9: **لا مشهدَ بلا حكمِ سلامة**: حكمُ السلسلةِ يُحسَب نصّاً **قبل** بناءِ
 *       الصفوفِ ويُعاد في الردِّ الواحدِ (`integrity: verdict`)، والمقابضُ
 *       الثلاثةُ العامّةُ كلُّها تمرّ بـ`this.view(` فلا طريقَ جانبيٌّ يُخرج
 *       صفوفاً بلا حكم.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يعبث بسجلٍّ حقيقيٍّ ولا
 * يقيس ظهورَ تحذير — قياسُ معيارِ القبولِ سلوكٌ مقيسٌ في
 * `tests/audit-viewer/audit-log-viewer.test.mjs` على سجلٍّ دائمٍ على القرصِ
 * يُعبَث به ببايتٍ حقيقيّ.
 *
 * **حدٌّ معلَن ثانٍ:** R5 يحرس **الكتابةَ** لا الالتفافَ في زمنِ التشغيل: من
 * مرَّر إلى العارضِ كائنَ سجلٍّ يكتب في مكانٍ آخرَ فذاك اختيارُ مُركِّبٍ مُعلَنٌ،
 * والمقصودُ هنا أن الوحدةَ نفسَها لا تملك في نصِّها مِقبضَ كتابةٍ على المفحوص.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  AUDIT_VIEWER_ERRORS,
  AUDIT_VIEWER_FACES,
  loadAuditViewerPolicy,
} from '../src/audit-viewer/audit-log-viewer.mjs';

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

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ═══ R0 ═══
/** @type {import('../src/audit-viewer/audit-log-viewer.mjs').AuditViewerPolicy | null} */
let policy = null;
try {
  policy = loadAuditViewerPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R0: ${error instanceof Error ? error.message : String(error)}`);
}

// ═══ R1 ═══
if (policy !== null) {
  /** @type {Map<string, string[]>} */
  const byFace = new Map();
  for (const view of policy.views) {
    const list = byFace.get(view.face) ?? [];
    list.push(view.id);
    byFace.set(view.face, list);
  }
  for (const face of AUDIT_VIEWER_FACES) {
    const list = byFace.get(face) ?? [];
    if (list.length === 0) {
      violations.push(
        `R1: الوجه «${face}» بلا مشهدٍ معلَنٍ — ونصُّ الخطوةِ يُسمّي الأوجهَ الثلاثةَ بحرفها، فعارضٌ ناقصُ وجهٍ يُخفي سؤالاً لا يُجاب.`,
      );
    } else if (list.length > 1) {
      violations.push(`R1: الوجه «${face}» له ${list.length} مشاهدَ (${list.join('، ')}).`);
    }
  }
  for (const face of byFace.keys()) {
    if (!AUDIT_VIEWER_FACES.includes(face)) {
      violations.push(`R1: الوجه «${face}» غيرُ معلَنٍ في \`AUDIT_VIEWER_FACES\`.`);
    }
  }
}

// ═══ R2 ═══
if (policy !== null) {
  const eventLog = readFile('src/root-of-trust/event-log.mts');
  if (eventLog === '') {
    violations.push(
      'R2: `src/root-of-trust/event-log.mts` غير مقروء — ولا أصلَ تُقاس عليه حقولُ البحثِ ولا أسبابُ الانكسار.',
    );
  } else {
    const recordBlock = /export interface EventRecord \{([\s\S]*?)\n\}/.exec(eventLog);
    /** @type {Set<string>} */
    const recordFields = new Set();
    for (const line of (recordBlock?.[1] ?? '').split('\n')) {
      const field = /^\s*([A-Za-z][A-Za-z0-9_]*)\??\s*:/.exec(line);
      if (field?.[1] !== undefined) recordFields.add(field[1]);
    }
    if (recordFields.size === 0) {
      violations.push('R2: تعذّرت قراءة حقولِ `EventRecord` من جذرِ الثقة.');
    }
    for (const field of policy.search.fields) {
      if (recordFields.size > 0 && !recordFields.has(field)) {
        violations.push(
          `R2: حقلُ البحث «${field}» ليس حقلاً في \`EventRecord\` — وبحثٌ على حقلٍ لا وجودَ له في الحدثِ بحثٌ لا يُطابق شيئاً أبداً، وذاك أسوأُ من رفضٍ مُسمّى.`,
        );
      }
    }
    const reasonsBlock = /export const ChainBreakReasons = \[([\s\S]*?)\] as const;/.exec(eventLog);
    /** @type {Set<string>} */
    const chainReasons = new Set();
    for (const match of (reasonsBlock?.[1] ?? '').matchAll(/'([A-Z][A-Z_]+)'/g)) {
      chainReasons.add(/** @type {string} */ (match[1]));
    }
    if (chainReasons.size === 0) {
      violations.push('R2: تعذّرت قراءة `ChainBreakReasons` من جذرِ الثقة.');
    } else {
      for (const reason of policy.integrity.breakReasons) {
        if (!chainReasons.has(reason)) {
          violations.push(
            `R2: سببُ الانكسار «${reason}» مُعلَنٌ في الوثيقةِ ولا يرفعه جذرُ الثقةِ — ووعدٌ بتحذيرٍ لا يقع وعدٌ كاذب.`,
          );
        }
      }
      for (const reason of chainReasons) {
        if (!policy.integrity.breakReasons.includes(reason)) {
          violations.push(
            `R2: سببُ الانكسار «${reason}» يرفعه جذرُ الثقةِ ولا تُعلنه وثيقةُ العارضِ — وتحذيرٌ يظهر بلا اسمٍ معلَنٍ تحذيرٌ لا يُتصرَّف عليه.`,
          );
        }
      }
    }
  }
}

// ═══ R3 ═══
if (policy !== null) {
  const listed = new Set(policy.refusalCodes);
  for (const code of Object.values(AUDIT_VIEWER_ERRORS)) {
    if (!listed.has(code)) {
      violations.push(`R3: الرمز ${code} يرفعه الكودُ ولا إعلانَ له في الوثيقة.`);
    }
  }
  /** @type {Set<string>} */
  const inCode = new Set(Object.values(AUDIT_VIEWER_ERRORS));
  for (const code of policy.refusalCodes) {
    if (!inCode.has(code)) {
      violations.push(`R3: الرمز ${code} مُعلَنٌ في الوثيقةِ ولا يرفعه كودٌ.`);
    }
  }
  for (const guarantee of policy.guarantees) {
    const enforcing = readFile(guarantee.enforcedBy);
    if (enforcing === '') {
      violations.push(
        `R3: الضمان ${guarantee.id} يُعلن ملفَّ إنفاذٍ «${guarantee.enforcedBy}» غيرَ مقروء — ضمانٌ بلا موضعِ إنفاذٍ وعدٌ بلا كفيل.`,
      );
      continue;
    }
    for (const code of guarantee.codes) {
      if (!enforcing.includes(code.replace('AUDIT_VIEWER_', ''))) {
        violations.push(
          `R3: الضمان ${guarantee.id} يُشير إلى ${code} وهو غائبٌ نصّاً عن ${guarantee.enforcedBy}.`,
        );
      }
    }
  }
}

// ═══ R4 ═══
const viewer = readFile('src/audit-viewer/audit-log-viewer.mjs');
if (viewer === '') {
  violations.push('R4: `src/audit-viewer/audit-log-viewer.mjs` غير مقروء.');
} else {
  const dateNow = countOf(viewer, 'Date.now(');
  if (dateNow > 1) {
    violations.push(
      `R4: \`Date.now(\` يظهر ${dateNow} مرّاتٍ في وحدةِ العارض — والمسموحُ مرّةٌ واحدةٌ قيمةً افتراضيةً في المُنشئ، فحكمُ سلامةٍ يُختم بساعةٍ لا تُقاد حكمٌ لا يُختبَر.`,
    );
  }
  if (!viewer.includes('deps.nowMs ?? (() => Date.now())')) {
    violations.push('R4: الساعةُ المُمرَّرةُ `nowMs` غيرُ معلَنةٍ قيمةً افتراضيةً في المُنشئ.');
  }
  for (const needle of ['#clock(', 'CLOCK_INVALID', 'const observedAtMs = this.#clock(']) {
    if (!viewer.includes(needle)) {
      violations.push(`R4: مسارُ الساعةِ المتحقَّقِ منها ناقص (${needle} غائب).`);
    }
  }
  if (!viewer.includes('this.#policy.search.maxRows')) {
    violations.push(
      'R4: حدُّ الصفوفِ لا يُقرأ من الوثيقةِ — ورقمٌ مثبَّتٌ في الكودِ حدٌّ لا يملكه من يملك الوثيقة.',
    );
  }
}

// ═══ R5 ═══
const viewerDir = path.join(ROOT, 'src', 'audit-viewer');
/** @type {string[]} */
const viewerFiles = fs.existsSync(viewerDir)
  ? fs.readdirSync(viewerDir).filter((name) => name.endsWith('.mjs'))
  : [];
if (viewerFiles.length === 0) {
  violations.push('R5: لا ملفَّ واحدٌ في `src/audit-viewer/` — لا مسارَ للعارضِ أصلاً.');
}
for (const name of viewerFiles) {
  const text = fs.readFileSync(path.join(viewerDir, name), 'utf8');
  for (const writer of ['.insert(', '.update(', '.remove(', '.upsert(']) {
    if (text.includes(writer)) {
      violations.push(
        `R5: نداءٌ كاتبٌ «${writer}» في src/audit-viewer/${name} — والعارضُ سطحُ قراءةٍ وحده.`,
      );
    }
  }
  for (const writer of [
    'writeFileSync',
    'appendFileSync',
    'truncateSync',
    'ftruncateSync',
    'rmSync',
    'unlinkSync',
    'openSync',
    'writeSync',
  ]) {
    if (text.includes(writer)) {
      violations.push(
        `R5: نداءُ كتابةٍ على نظامِ الملفّات «${writer}» في src/audit-viewer/${name} — ومن كتب في المفحوصِ ليقرأه جعل الفحصَ نفسَه تغييراً للمفحوص.`,
      );
    }
  }
  if (/\brepository\b/.test(text)) {
    violations.push(
      `R5: كلمةُ \`repository\` في src/audit-viewer/${name} — ولا مستودعَ في يدِ هذه الطبقة، قراءتُها من ملفِّ السجلِّ وحدَه.`,
    );
  }
}
if (viewer !== '') {
  for (const needle of ['#views = new Map()', 'function deepFreeze(', 'inspectEventLog(file)']) {
    if (!viewer.includes(needle)) {
      violations.push(`R5: حدُّ الإغلاقِ أو القراءةِ المحضةِ ناقص (${needle} غائب).`);
    }
  }
}

// ═══ R6 ═══
if (viewer !== '') {
  const readAudit = viewer.indexOf('log.append(this.#policy.audit.viewEvent');
  const openSource = viewer.indexOf('const inspection = this.#inspect(');
  if (readAudit < 0 || openSource < 0) {
    violations.push('R6: مسارُ قراءةِ المشهدِ غيرُ مقروءٍ نصّاً (قيدٌ أو فحصٌ غائب).');
  } else if (readAudit > openSource) {
    violations.push(
      'R6: قيدُ القراءةِ يُكتب **بعد** فتحِ المفحوص — ومطالعةٌ لشهادةِ الدولةِ قد تقع بلا أثرٍ يشهد عليها.',
    );
  }
}

// ═══ R7 ═══
const pkgText = readFile('package.json');
if (pkgText === '') {
  violations.push('R7: `package.json` غير مقروء.');
} else {
  /** @type {{ scripts?: Record<string, string> }} */
  const pkg = JSON.parse(pkgText);
  const scripts = pkg.scripts ?? {};
  if (scripts['guard:audit-viewer'] === undefined) {
    violations.push('R7: النصُّ `guard:audit-viewer` غيرُ معلَنٍ في package.json.');
  }
  if (!String(scripts['validate'] ?? '').includes('npm run guard:audit-viewer')) {
    violations.push('R7: `guard:audit-viewer` غائبٌ عن سلسلةِ `validate`.');
  }
}
const workflow = readFile('.github/workflows/ci.yml');
if (!workflow.includes('npm run guard:audit-viewer')) {
  violations.push(
    'R7: `guard:audit-viewer` غائبٌ عن `.github/workflows/ci.yml` — وبوابةٌ لا تُشغَّل آلياً لا تمنع دمجاً.',
  );
}

// ═══ R8 ═══
const doc = readFile('docs/AUDIT_LOG_VIEWER.md');
if (doc === '') {
  violations.push('R8: `docs/AUDIT_LOG_VIEWER.md` غائبة — ولا عملَ بلا وثيقةٍ تصفه (المادة 1).');
} else if (policy !== null) {
  if (!doc.includes(String(policy.search.maxRows))) {
    violations.push(
      `R8: حدُّ الصفوفِ المُعلَن (${policy.search.maxRows}) غائبٌ عن الوثيقةِ الواصفة.`,
    );
  }
  for (const view of policy.views) {
    if (!doc.includes(view.id)) violations.push(`R8: المشهد ${view.id} غائبٌ عن الوثيقة.`);
  }
  for (const code of policy.refusalCodes) {
    if (!doc.includes(code)) violations.push(`R8: الرمز ${code} غائبٌ عن الوثيقةِ الواصفة.`);
  }
}
const testText = readFile('tests/audit-viewer/audit-log-viewer.test.mjs');
if (testText === '') {
  violations.push(
    'R8: `tests/audit-viewer/audit-log-viewer.test.mjs` غائب — حاجزٌ يقرأ النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['INTEGRITY_BROKEN', 'معيارُ القبولِ نفسُه غيرُ مقيس'],
    ['VIEW_UNDECLARED', 'ردُّ المشهدِ غيرِ المُعلَنِ غيرُ مقيس'],
    ['AUDIT_REQUIRED', 'الفشلُ المغلقُ بلا سجلٍّ دائمٍ غيرُ مقيس'],
    ['SOURCE_MISSING', 'رفضُ العارضِ بلا مفحوصٍ غيرُ مقيس'],
    ['LOG_UNREADABLE', 'ردُّ ملفِّ السجلِّ الغائبِ غيرُ مقيس'],
    ['FIELD_UNDECLARED', 'ردُّ حقلِ البحثِ غيرِ المُعلَنِ غيرُ مقيس'],
    ['TERM_INVALID', 'ردُّ المصطلحِ الفارغِ غيرُ مقيس'],
    ['RANGE_INVALID', 'ردُّ المدى المقلوبِ غيرُ مقيس'],
    ['ROWS_EXCEEDED', 'رفضُ تجاوزِ حدِّ الصفوفِ غيرُ مقيس'],
    ['CLOCK_INVALID', 'ردُّ الساعةِ الفاسدةِ غيرُ مقيس'],
    ['PersistentEventLog', 'القياسُ ليس على سجلٍّ دائمٍ حقيقيٍّ على القرص'],
    ['Object.isFrozen', 'تجميدُ صفوفِ المشاهدِ غيرُ مقيس'],
    ['--root', 'الحاجزُ لا يُشغَّل على نسخةٍ مُزيَّفةٍ فتُقاس رتبتُه بالدعوى'],
  ];
  for (const [needle, why] of measured) {
    if (!testText.includes(needle)) violations.push(`R8: ${why} (${needle}).`);
  }
}

// ═══ R9 ═══
if (viewer !== '') {
  const verdictAt = viewer.indexOf('const verdict = this.#verdict(');
  const rowsAt = viewer.indexOf('const rows =');
  if (verdictAt < 0 || rowsAt < 0) {
    violations.push('R9: مسارُ حكمِ السلامةِ غيرُ مقروءٍ نصّاً (حكمٌ أو صفوفٌ غائبة).');
  } else if (verdictAt > rowsAt) {
    violations.push(
      'R9: الصفوفُ تُبنى **قبل** حكمِ السلامةِ — ومشهدٌ يُبنى ثم يُسأل عن سلامتِه مشهدٌ قد يُعرَض بلا حكم.',
    );
  }
  if (!viewer.includes('integrity: verdict,')) {
    violations.push(
      'R9: الردُّ لا يحمل `integrity: verdict` — والقاعدةُ الحاكمةُ أن لا مشهدَ بلا حكمِ سلامةٍ يرافقه في الردِّ نفسِه.',
    );
  }
  for (const handle of [
    '  search(request) {',
    '  timeline(request = {}) {',
    '  integrity(context = {}) {',
  ]) {
    if (!viewer.includes(handle)) {
      violations.push(`R9: مِقبضُ وجهٍ من الأوجهِ الثلاثةِ غائبٌ نصّاً (${handle.trim()}).`);
    }
  }
  if (countOf(viewer, 'return this.view({ view: this.#viewOf(') !== 3) {
    violations.push(
      'R9: ليست المقابضُ الثلاثةُ كلُّها تمرّ بـ`this.view(` — وطريقٌ جانبيٌّ إلى الصفوفِ طريقٌ بلا قيدٍ وبلا حكم.',
    );
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز عارض سجل التدقيق رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const viewCount = policy === null ? 0 : policy.views.length;
const fieldCount = policy === null ? 0 : policy.search.fields.length;
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
const maxRows = policy === null ? 0 : policy.search.maxRows;
console.log(
  `✅ حاجز عارض سجل التدقيق: ${viewCount} مشاهدَ تُغطّي الأوجهَ الثلاثةَ (${AUDIT_VIEWER_FACES.join('، ')}) وجهاً بمشهدٍ واحدٍ، و${fieldCount} حقلَ بحثٍ كلُّها حقولٌ في \`EventRecord\`، وأسبابُ الانكسارِ متقابلةٌ في الاتجاهين مع \`ChainBreakReasons\`، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، وحدُّ الصفوفِ ${maxRows} من الوثيقةِ لا من الكودِ، والقيدُ يُكتب قبل فتحِ المفحوص، وحكمُ السلامةِ يُحسَب قبل الصفوفِ ويرافقها، ولا نداءَ كتابةٍ واحداً في مسارِ العارض.`,
);
