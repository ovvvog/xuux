#!/usr/bin/env node
/**
 * حاجزُ مركزِ العمليات — البوابةُ الحاديةُ والثلاثون في `npm run validate`
 * (الخطوة `M9.05`).
 *
 * البوابةُ الثلاثون تحرس **سلطةَ** الملكِ: ألّا يُصدَر أمرٌ سياديٌّ بجلسةٍ بلا
 * عاملٍ ثانٍ. وهذه تحرس **رؤيةَ** التشغيل: أن يكون مركزُ العملياتِ كاملَ
 * الأوجهِ الخمسةِ التي سمّاها نصُّ الخطوةِ، قارئاً وحدَه، على مصادرَ معلَنةٍ لا
 * مخترَعةٍ، بمهلةٍ **في الوثيقةِ** مقيسةٍ على ساعةٍ مُمرَّرة. وتسعُ قواعد:
 *
 *   R0: `config/operations-center.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ تُخالف
 *       مخطَّطَها تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: الأوجهُ الخمسةُ (`OPERATIONS_FACES`) كلٌّ منها بلوحةٍ **واحدةٍ**؛ فمركزُ
 *       عملياتٍ ناقصُ وجهٍ مركزٌ أعمى عن سؤالٍ سُمِّي في الخطوةِ بحرفه.
 *   R2: لوحةٌ مصدرُها مسارٌ ⇒ المسارُ مُعلَنٌ في `config/api.yaml`؛ ولوحةُ حصصٍ ⇒
 *       كلُّ موردٍ فيها مُعلَنٌ في `config/quotas.yaml`. فرقمٌ بلا أصلٍ رقمٌ مخترَع.
 *   R3: كلُّ رمزٍ في `OPERATIONS_ERRORS` مُعلَنٌ في الوثيقةِ وبالعكس، وكلُّ رمزِ
 *       ضمانٍ حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R4: **الساعةُ مُمرَّرةٌ لا ساعةُ النظام**: `Date.now(` لا يظهر في
 *       `src/operations/` إلا مرّةً واحدةً — قيمةً افتراضيةً في المُنشئ — وكلُّ
 *       قياسٍ يمرّ من `#clock(`؛ فمهلةٌ تُقاس بساعةٍ لا تُقاد لا تُختبَر.
 *   R5: قارئٌ وحدَه: لا `.insert(` ولا `.update(` ولا `.remove(` في
 *       `src/operations/`، ولا كلمةَ `repository`، واللوحاتُ في حقلٍ خاصٍّ،
 *       والصفوفُ المُعادةُ مُجمَّدةٌ عميقاً (`deepFreeze`).
 *   R6: القيدُ **قبل** الأثر: قيدُ الحادثةِ يسبق نصّاً إدخالَها الذاكرةَ، وقيدُ
 *       اللوحةِ يسبق قراءةَ مصدرِها.
 *   R7: الحاجزُ مربوطٌ بالمسار: `npm run guard:operations` في `validate` وفي
 *       `.github/workflows/ci.yml`؛ فبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.
 *   R8: الوثيقةُ الواصفةُ `docs/OPERATIONS_CENTER.md` موجودةٌ وتُعلن المهلةَ
 *       بالرقمِ ولوحاتِها بمعرّفاتِها ورموزَ رفضِها كلَّها؛ وملفُّ الاختبارِ موجودٌ
 *       ويقيس الرموزَ الحاكمةَ ومعيارَ القبولِ والتجميدَ العميق.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يشغّل قاعدةً ولا يقيس
 * زمنَ ظهورٍ حقيقيّاً — قياسُ المهلةِ سلوكٌ مقيسٌ في
 * `tests/operations/operations-center.test.mjs` على ساعةٍ مُقادة.
 *
 * **حدٌّ معلَن ثانٍ:** R4 يحرس **الكتابةَ** لا الالتفافَ في زمنِ التشغيل: من
 * مرَّر ساعةً تقرأ `Date.now()` من خارجِ الوحدةِ فذاك اختيارُ مُركِّبٍ مُعلَنٌ،
 * والمقصودُ هنا أن الوحدةَ نفسَها لا تُثبِّت ساعتَها في نصِّها.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import {
  OPERATIONS_ERRORS,
  OPERATIONS_FACES,
  QUOTA_FACES,
  loadOperationsPolicy,
} from '../src/operations/operations-center.mjs';

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
/** @type {import('../src/operations/operations-center.mjs').OperationsPolicy | null} */
let policy = null;
try {
  policy = loadOperationsPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R0: ${error instanceof Error ? error.message : String(error)}`);
}

// ═══ R1 ═══
if (policy !== null) {
  /** @type {Map<string, string[]>} */
  const byFace = new Map();
  for (const panel of policy.panels) {
    const list = byFace.get(panel.face) ?? [];
    list.push(panel.id);
    byFace.set(panel.face, list);
  }
  for (const face of OPERATIONS_FACES) {
    const list = byFace.get(face) ?? [];
    if (list.length === 0) {
      violations.push(
        `R1: الوجه «${face}» بلا لوحةٍ معلَنةٍ — ونصُّ الخطوةِ يُسمّي الأوجهَ الخمسةَ بحرفها، فمركزٌ ناقصُ وجهٍ يُخفي سؤالاً لا يُجاب.`,
      );
    } else if (list.length > 1) {
      violations.push(`R1: الوجه «${face}» له ${list.length} لوحاتٍ (${list.join('، ')}).`);
    }
  }
  for (const face of byFace.keys()) {
    if (!OPERATIONS_FACES.includes(face)) {
      violations.push(`R1: الوجه «${face}» غيرُ معلَنٍ في \`OPERATIONS_FACES\`.`);
    }
  }
}

// ═══ R2 ═══
if (policy !== null) {
  /** @type {Set<string>} */
  const routes = new Set();
  try {
    const apiRaw = YAML.parse(readFile('config/api.yaml'));
    for (const route of apiRaw?.routes ?? []) routes.add(String(route?.id));
  } catch (error) {
    violations.push(`R2: تعذّرت قراءة config/api.yaml — ${String(error)}`);
  }
  /** @type {Set<string>} */
  const quotaResources = new Set();
  try {
    const quotasRaw = YAML.parse(readFile('config/quotas.yaml'));
    for (const quota of quotasRaw?.quotas ?? []) quotaResources.add(String(quota?.resource));
  } catch (error) {
    violations.push(`R2: تعذّرت قراءة config/quotas.yaml — ${String(error)}`);
  }
  for (const panel of policy.panels) {
    if (panel.source.startsWith('route:')) {
      const route = panel.source.slice('route:'.length);
      if (!routes.has(route)) {
        violations.push(
          `R2: اللوحة ${panel.id} مصدرُها المسار «${route}» وهو غيرُ معلَنٍ في config/api.yaml — لوحةٌ على مسارٍ لا وجودَ له تسقط عند أولِ قراءة.`,
        );
      }
    }
    if (QUOTA_FACES.includes(panel.face)) {
      for (const resource of panel.resources ?? []) {
        if (!quotaResources.has(resource)) {
          violations.push(
            `R2: اللوحة ${panel.id} تُعلن الموردَ «${resource}» وهو غيرُ معلَنٍ في config/quotas.yaml — حدٌّ بلا أصلٍ حدٌّ مخترَع.`,
          );
        }
      }
    }
  }
}

// ═══ R3 ═══
if (policy !== null) {
  const listed = new Set(policy.refusalCodes);
  for (const code of Object.values(OPERATIONS_ERRORS)) {
    if (!listed.has(code)) {
      violations.push(`R3: الرمز ${code} يرفعه الكودُ ولا إعلانَ له في الوثيقة.`);
    }
  }
  /** @type {Set<string>} */
  const inCode = new Set(Object.values(OPERATIONS_ERRORS));
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
      if (!enforcing.includes(code.replace('OPERATIONS_', ''))) {
        violations.push(
          `R3: الضمان ${guarantee.id} يُشير إلى ${code} وهو غائبٌ نصّاً عن ${guarantee.enforcedBy}.`,
        );
      }
    }
  }
}

// ═══ R4 ═══
const center = readFile('src/operations/operations-center.mjs');
if (center === '') {
  violations.push('R4: `src/operations/operations-center.mjs` غير مقروء.');
} else {
  const dateNow = countOf(center, 'Date.now(');
  if (dateNow > 1) {
    violations.push(
      `R4: \`Date.now(\` يظهر ${dateNow} مرّاتٍ في وحدةِ مركزِ العمليات — والمسموحُ مرّةٌ واحدةٌ قيمةً افتراضيةً في المُنشئ، فمهلةٌ تُقاس بساعةٍ لا تُقاد مهلةٌ لا تُختبَر.`,
    );
  }
  if (!center.includes('deps.nowMs ?? (() => Date.now())')) {
    violations.push('R4: الساعةُ المُمرَّرةُ `nowMs` غيرُ معلَنةٍ قيمةً افتراضيةً في المُنشئ.');
  }
  for (const needle of ['#clock(', 'CLOCK_INVALID']) {
    if (!center.includes(needle)) {
      violations.push(`R4: مسارُ الساعةِ المتحقَّقِ منها ناقص (${needle}).`);
    }
  }
  for (const needle of ["this.#clock('تسجيلِ حادثة')", 'const observedAtMs = this.#clock(']) {
    if (!center.includes(needle)) {
      violations.push(`R4: قياسٌ لا يمرّ من الساعةِ المتحقَّقِ منها (${needle} غائب).`);
    }
  }
  if (!center.includes('this.#policy.visibility.deadlineMs')) {
    violations.push(
      'R4: المهلةُ لا تُقرأ من الوثيقةِ — ورقمٌ مثبَّتٌ في الكودِ مهلةٌ لا يملكها من يملك الوثيقة.',
    );
  }
}

// ═══ R5 ═══
const operationsDir = path.join(ROOT, 'src', 'operations');
/** @type {string[]} */
const operationsFiles = fs.existsSync(operationsDir)
  ? fs.readdirSync(operationsDir).filter((name) => name.endsWith('.mjs'))
  : [];
if (operationsFiles.length === 0) {
  violations.push('R5: لا ملفَّ واحدٌ في `src/operations/` — لا مسارَ لمركزِ العمليات أصلاً.');
}
for (const name of operationsFiles) {
  const text = fs.readFileSync(path.join(operationsDir, name), 'utf8');
  for (const writer of ['.insert(', '.update(', '.remove(', '.upsert(']) {
    if (text.includes(writer)) {
      violations.push(
        `R5: نداءٌ كاتبٌ «${writer}» في src/operations/${name} — ومركزُ العملياتِ سطحُ قراءةٍ وحده.`,
      );
    }
  }
  if (/\brepository\b/.test(text)) {
    violations.push(
      `R5: كلمةُ \`repository\` في src/operations/${name} — ولا مستودعَ في يدِ هذه الطبقة، قراءتُها من طبقةِ الواجهةِ ومزوِّديها.`,
    );
  }
}
if (center !== '') {
  for (const needle of ['#panels = new Map()', '#incidents = new Map()', 'function deepFreeze(']) {
    if (!center.includes(needle)) {
      violations.push(`R5: حدُّ الإغلاقِ أو التجميدِ ناقص (${needle} غائب).`);
    }
  }
}

// ═══ R6 ═══
if (center !== '') {
  const incidentAudit = center.indexOf('log.append(this.#policy.audit.incidentEvent');
  const incidentStore = center.indexOf('this.#incidents.set(');
  if (incidentAudit < 0 || incidentStore < 0) {
    violations.push('R6: مسارُ تسجيلِ الحادثةِ غيرُ مقروءٍ نصّاً (قيدٌ أو إدخالٌ غائب).');
  } else if (incidentAudit > incidentStore) {
    violations.push(
      'R6: قيدُ الحادثةِ يُكتب **بعد** إدخالِها الذاكرةَ — وحادثةٌ في المركزِ بلا قيدٍ حادثةٌ لا شهادةَ عليها.',
    );
  }
  const panelAudit = center.indexOf('log.append(this.#policy.audit.panelEvent');
  const panelRead = center.indexOf('rows = await this.#readRoute(');
  if (panelAudit < 0 || panelRead < 0) {
    violations.push('R6: مسارُ قراءةِ اللوحةِ غيرُ مقروءٍ نصّاً (قيدٌ أو قراءةٌ غائبة).');
  } else if (panelAudit > panelRead) {
    violations.push('R6: قيدُ اللوحةِ يُكتب **بعد** قراءةِ مصدرِها — فقراءةٌ قد تقع بلا أثر.');
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
  if (scripts['guard:operations'] === undefined) {
    violations.push('R7: النصُّ `guard:operations` غيرُ معلَنٍ في package.json.');
  }
  if (!String(scripts['validate'] ?? '').includes('npm run guard:operations')) {
    violations.push('R7: `guard:operations` غائبٌ عن سلسلةِ `validate`.');
  }
}
const workflow = readFile('.github/workflows/ci.yml');
if (!workflow.includes('npm run guard:operations')) {
  violations.push(
    'R7: `guard:operations` غائبٌ عن `.github/workflows/ci.yml` — وبوابةٌ لا تُشغَّل آلياً لا تمنع دمجاً.',
  );
}

// ═══ R8 ═══
const doc = readFile('docs/OPERATIONS_CENTER.md');
if (doc === '') {
  violations.push('R8: `docs/OPERATIONS_CENTER.md` غائبة — ولا عملَ بلا وثيقةٍ تصفه (المادة 1).');
} else if (policy !== null) {
  if (!doc.includes(String(policy.visibility.deadlineMs))) {
    violations.push(
      `R8: المهلةُ المُعلَنةُ (${policy.visibility.deadlineMs}) غائبةٌ عن الوثيقةِ الواصفة.`,
    );
  }
  for (const panel of policy.panels) {
    if (!doc.includes(panel.id)) violations.push(`R8: اللوحة ${panel.id} غائبةٌ عن الوثيقة.`);
  }
  for (const code of policy.refusalCodes) {
    if (!doc.includes(code)) violations.push(`R8: الرمز ${code} غائبٌ عن الوثيقةِ الواصفة.`);
  }
}
const testText = readFile('tests/operations/operations-center.test.mjs');
if (testText === '') {
  violations.push(
    'R8: `tests/operations/operations-center.test.mjs` غائب — حاجزٌ يقرأ النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['VISIBILITY_MISSED', 'تفويتُ المهلةِ المُعلَنةِ غيرُ مقيس'],
    ['INCIDENT_UNKNOWN', 'ردُّ حادثةٍ لا تظهر غيرُ مقيس'],
    ['PANEL_UNDECLARED', 'ردُّ اللوحةِ غيرِ المُعلَنةِ غيرُ مقيس'],
    ['GATEWAY_REQUIRED', 'اشتراطُ طبقةِ الواجهةِ غيرُ مقيس'],
    ['PANEL_REFUSED', 'تغليفُ ردِّ طبقةِ الواجهةِ غيرُ مقيس'],
    ['SOURCE_MISSING', 'رفضُ اللوحةِ بلا مزوِّدٍ غيرُ مقيس'],
    ['AUDIT_REQUIRED', 'الفشلُ المغلقُ بلا سجلٍّ دائمٍ غيرُ مقيس'],
    ['SEVERITY_UNDECLARED', 'ردُّ الدرجةِ غيرِ المُعلَنةِ غيرُ مقيس'],
    ['INCIDENT_REPLAYED', 'منعُ إعادةِ المعرّفِ غيرُ مقيس'],
    ['INCIDENT_OVERFLOW', 'رفضُ السعةِ المُعلَنةِ غيرُ مقيس'],
    ['CLOCK_INVALID', 'ردُّ الساعةِ الفاسدةِ غيرُ مقيس'],
    ['assertVisible', 'معيارُ القبولِ نفسُه غيرُ مقيس'],
    ['Object.isFrozen', 'تجميدُ صفوفِ اللوحاتِ غيرُ مقيس'],
    ['--root', 'الحاجزُ لا يُشغَّل على نسخةٍ مُزيَّفةٍ فتُقاس رتبتُه بالدعوى'],
  ];
  for (const [needle, why] of measured) {
    if (!testText.includes(needle)) violations.push(`R8: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز مركز العمليات رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const panelCount = policy === null ? 0 : policy.panels.length;
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
const deadline = policy === null ? 0 : policy.visibility.deadlineMs;
console.log(
  `✅ حاجز مركز العمليات: ${panelCount} لوحاتٍ تُغطّي الأوجهَ الخمسةَ (${OPERATIONS_FACES.join('، ')}) وجهاً بلوحةٍ واحدةٍ، ومصادرُها كلُّها معلَنةٌ في وثيقةِ المساراتِ ووثيقةِ الحصص، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، والمهلةُ ${deadline} ملي ثانيةٍ من الوثيقةِ لا من الكودِ مقيسةً على ساعةٍ مُمرَّرةٍ، والقيدُ يُكتب قبل الأثر، ولا نداءَ كتابةٍ واحداً في مسارِ المركز.`,
);
