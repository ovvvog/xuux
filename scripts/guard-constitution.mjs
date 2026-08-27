#!/usr/bin/env node
/**
 * حاجزُ الدستور — البوابة الثامنة عشرة في `npm run validate` (الخطوة M8.01).
 *
 * الحاجزُ يفحص **المستودعَ** لا التشغيل: يمنع أن يعود الدستورُ نصّاً زخرفياً كما
 * كانت مراجعُ القانون قبل هذه الخطوة. وقواعده:
 *
 *   R1: `config/constitution.yaml` يُحمَّل ويجتاز مخطَّطه وفحوصَ تماسكه.
 *   R2: كلُّ بندِ ضمانٍ يُعلِن رمزَ رفضٍ **موجوداً فعلاً في وحدة إنفاذه**؛ فبندٌ
 *       برمزٍ لا يقع في كودٍ وعدٌ لا ضمان.
 *   R3: كلُّ ملفٍّ في `enforcedBy` (للموادّ والبنود) **موجودٌ في المستودع**.
 *   R4: **كلُّ `lawRef` في `config/*.yaml` يُسنَد إلى مادةٍ دستوريّةٍ قائمة.**
 *       هذه القاعدةُ هي التي تُغلق العيبَ المقيس: إحدى وعشرون قاعدةً كانت تستند
 *       إلى ثمانية مراجعَ لا وجودَ لها.
 *   R5: لا وحدةَ خارج `integrity.holders` تكتب في مخزن الدستور
 *       (‏`appendAmendment`)؛ فمن أراد تعديلاً يمرّ بالمسار أو لا يمرّ.
 *   R6: كلُّ خطوةٍ مُعلَنةٍ في `amendment.steps` لها دالّةٌ في
 *       `src/constitution/amendment-path.mjs`؛ فخطوةٌ مُعلَنةٌ بلا كودٍ نصٌّ لا مسار.
 *   R7: `constitution/ARTICLES.md` يذكر **كلَّ مادةٍ بمعرّفها وتجزئتِها**
 *       المحسوبة الآن؛ فوثيقةٌ متخلّفةٌ عن النصّ أخطرُ من غيابها.
 *
 * حدٌّ معلَن: الحاجزُ يفحص النصَّ المؤسِّس في `config/`، **لا العهودَ النافذة في
 * مخزنٍ تشغيليّ** — تلك تُفحص في التشغيل بـ`ConstitutionStore.assertIntact`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { articleHash, loadConstitutionPolicy } from '../src/constitution/constitution.mjs';

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
 * يجمع كلَّ قيم `lawRef` في ملفّات الإعداد مع موضعها.
 * @param {string} dir
 * @returns {Array<{ file: string, value: string }>}
 */
function collectLawRefs(dir) {
  /** @type {Array<{ file: string, value: string }>} */
  const found = [];
  /**
   * @param {unknown} node
   * @param {string} file
   * @returns {void}
   */
  const walk = (node, file) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, file);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'lawRef' && typeof value === 'string') found.push({ file, value });
      else walk(value, file);
    }
  };
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.yaml')) continue;
    /** @type {unknown} */
    let parsed;
    try {
      parsed = YAML.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch (error) {
      violations.push(`R4: تعذّرت قراءة config/${name}: ${String(error)}`);
      continue;
    }
    walk(parsed, `config/${name}`);
  }
  return found;
}

// ═══ R1 ═══
/** @type {import('../src/constitution/constitution.mjs').ConstitutionPolicy | null} */
let policy = null;
try {
  policy = loadConstitutionPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R1: ${error instanceof Error ? error.message : String(error)}`);
}

if (policy) {
  // ═══ R2 + R3 (بنودُ الضمان) ═══
  for (const guarantee of policy.guarantees) {
    const file = path.join(ROOT, guarantee.enforcedBy);
    if (!fs.existsSync(file)) {
      violations.push(
        `R3: بندُ «${guarantee.id}» يُسنَد إلى ملفٍّ غير موجود: ${guarantee.enforcedBy}`,
      );
      continue;
    }
    if (!fs.readFileSync(file, 'utf8').includes(guarantee.code)) {
      violations.push(
        `R2: بندُ «${guarantee.id}» يُعلِن الرمز ${guarantee.code} ولا وجودَ له في ${guarantee.enforcedBy} — وعدٌ بلا إنفاذ.`,
      );
    }
  }

  // ═══ R3 (موادُّ الدستور) ═══
  for (const article of policy.articles) {
    for (const target of article.enforcedBy) {
      if (!fs.existsSync(path.join(ROOT, target))) {
        violations.push(`R3: المادة ${article.id} تُسنَد إلى ملفٍّ غير موجود: ${target}`);
      }
    }
  }

  // ═══ R4 ═══
  const known = new Set(policy.articles.map((article) => article.lawRef));
  /** @type {Map<string, Set<string>>} */
  const dangling = new Map();
  for (const { file, value } of collectLawRefs(path.join(ROOT, 'config'))) {
    if (known.has(value)) continue;
    const places = dangling.get(value) ?? new Set();
    places.add(file);
    dangling.set(value, places);
  }
  for (const [value, places] of [...dangling.entries()].sort()) {
    violations.push(
      `R4 [CONSTITUTION_LAW_REFERENCE_DANGLING]: المرجعُ ${value} لا يُسنَد إلى مادةٍ دستوريّة — ورد في: ${[...places].sort().join(', ')}`,
    );
  }

  // ═══ R5 ═══
  const holders = new Set(policy.integrity.holders);
  /**
   * @param {string} dir
   * @returns {string[]}
   */
  const filesUnder = (dir) => {
    /** @type {string[]} */
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...filesUnder(full));
      else if (/\.(mjs|mts)$/.test(entry.name) && !entry.name.endsWith('.d.mts')) out.push(full);
    }
    return out;
  };
  for (const file of [
    ...filesUnder(path.join(ROOT, 'src')),
    ...filesUnder(path.join(ROOT, 'scripts')),
  ]) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (holders.has(relative) || relative === 'scripts/guard-constitution.mjs') continue;
    // الفحصُ على **النداء** لا على ورود الاسم؛ فذكرُ التابع في تعليقٍ أو
    // وثيقةٍ ليس لمساً للمخزن.
    if (!/\.appendAmendment\s*\(/.test(fs.readFileSync(file, 'utf8'))) continue;
    violations.push(
      `R5: ${relative} يلمس مخزنَ الدستور (appendAmendment) وهو ليس من الحائزين المُعلَنين — التعديلُ يمرّ بالمسار أو لا يمرّ.`,
    );
  }

  // ═══ R6 ═══
  const pathFile = path.join(ROOT, 'src', 'constitution', 'amendment-path.mjs');
  if (!fs.existsSync(pathFile)) {
    violations.push('R6: src/constitution/amendment-path.mjs غير موجود؛ ومسارٌ بلا كودٍ نصٌّ فقط.');
  } else {
    const source = fs.readFileSync(pathFile, 'utf8');
    /** @type {Record<string, string>} */
    const stepSymbols = {
      propose: 'propose(',
      review: 'review(',
      deliberate: 'deliberationRemaining(',
      ratify: 'ratify(',
    };
    for (const step of policy.amendment.steps) {
      const symbol = stepSymbols[step];
      if (!symbol) {
        violations.push(
          `R6: الخطوة «${step}» مُعلَنةٌ في السياسة ولا يعرف الحاجزُ لها دالّةً مقابلة.`,
        );
        continue;
      }
      if (!source.includes(symbol)) {
        violations.push(`R6: الخطوة «${step}» مُعلَنةٌ ولا دالّةَ ${symbol}) لها في مسار التعديل.`);
      }
    }
  }

  // ═══ R7 ═══
  const articlesDoc = path.join(ROOT, 'constitution', 'ARTICLES.md');
  if (!fs.existsSync(articlesDoc)) {
    violations.push(
      'R7: constitution/ARTICLES.md غير موجود؛ ودستورٌ بلا وثيقةٍ منشورةٍ نصٌّ مخفيّ.',
    );
  } else {
    const doc = fs.readFileSync(articlesDoc, 'utf8');
    for (const article of policy.articles) {
      const hash = articleHash(article);
      if (!doc.includes(article.id)) {
        violations.push(`R7: المادة ${article.id} غائبةٌ عن constitution/ARTICLES.md`);
      } else if (!doc.includes(hash)) {
        violations.push(
          `R7: تجزئةُ المادة ${article.id} في الوثيقة لا تطابق النصَّ الحاليّ (المحسوبة ${hash.slice(0, 16)}…) — الوثيقةُ متخلّفةٌ عن النصّ.`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز الدستور رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const articleCount = policy ? policy.articles.length : 0;
const entrenched = policy ? policy.articles.filter((article) => article.entrenched).length : 0;
const guarantees = policy ? policy.guarantees.length : 0;
console.log(
  `✅ حاجز الدستور: ${articleCount} مادةً (منها ${entrenched} مختومة) و${guarantees} بندَ ضمانٍ مربوطاً برمزِ رفضٍ واقع، ولا مرجعَ قانونٍ معلَّقاً في config/.`,
);
