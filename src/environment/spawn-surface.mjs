/**
 * سطحُ استدعاءِ العمليّاتِ في مسارِ البيئة — وحدةُ حكمٍ نقيّةٌ (`M10.05`).
 *
 * **العيبُ الذي تُغلقه:** كان `docs/ENVIRONMENT.md` يقول إنّ جمعَ وقائعِ البيئةِ
 * محصورٌ في `scripts/lib/environment-facts.mjs`، وكان ذلك **اتفاقاً معلَناً لا
 * قاعدةً مُنفَذة**: من أضافَ جمعاً ثانياً في ملفٍّ ثالثٍ لا يُردُّ نصّاً. والحدُّ
 * مسجَّلٌ بنصِّه في `docs/REMAINING_WORK.md` (دَينُ `M10.05` غيرُ المانع) وفي
 * ترويسةِ `scripts/guard-environment.mjs` («حدٌّ معلَن ثالث»). وهذه الوحدةُ تُحوّلُ
 * الاتفاقَ إلى قاعدةٍ تُقاس.
 *
 * **لماذا الإغلاقُ التبعيُّ لا قائمةُ ملفّاتٍ ثابتة:** فحصُ قائمةٍ مكتوبةٍ بيدٍ
 * يُفلِتُ الملفَّ الجديدَ لأنّ كاتبَه هو من يُدرِجُه. أمّا الإغلاقُ من المداخلِ
 * المُعلَنةِ فيَشملُ **كلَّ ما يصلُ إليه المسارُ فعلاً**: جامعُ وقائعَ ثانٍ لا
 * يعملُ إلّا إن استُورِد، ومتى استُورِدَ دخلَ الإغلاقَ ورُدَّ.
 *
 * **نقاءٌ بنيويّ:** لا `node:fs` ولا `node:child_process` ولا `node:process` هنا —
 * القراءةُ تُحقَن دالّةً (`sourceOf`)، فالوحدةُ التي تحكمُ على من يلمسُ العمليّاتِ
 * لا تملكُ هي أن تلمسَها.
 */

import path from 'node:path';

/** المُلحِقُ الذي يمنحُ صاحبَه إطلاقَ عمليّةٍ ابنة. */
export const SPAWN_IMPORT = 'node:child_process';

/** يلتقطُ مواصفةَ كلِّ استيرادٍ ساكنٍ أو `export ... from`. */
const IMPORT_SPEC = /(?:^|\n)\s*(?:import|export)[^'";]*?from\s*['"]([^'"]+)['"]/gu;

/** يلتقطُ `import('…')` و`require('…')` بمواصفةٍ **حرفيّةٍ** تُقرأ. */
const DYNAMIC_SPEC = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;

/** يلتقطُ تحميلاً بمواصفةٍ **غيرِ حرفيّةٍ** — لا تُقاس فلا تُمرَّر. */
const OPAQUE_LOAD = /\b(?:import|require)\s*\(\s*(?!['"])[^)]/u;

/** `createRequire` بابٌ إلى `require` في مستودعٍ كلُّه وحداتُ ESM. */
const CREATE_REQUIRE = /\bcreateRequire\b/u;

/**
 * تجريدُ النصِّ من التعليقاتِ قبلَ قياسِه.
 *
 * **لماذا هذا شرطٌ لا زينة:** `import('…')` يَرِدُ في هذا المستودعِ **داخلَ
 * تعليقاتِ JSDoc** نوعاً لا تحميلاً (`@type {import('./x.mjs').T}`) — عشراتُ
 * المواضع. فمن عدَّها تحميلاً أطلقَ إنذاراتٍ كاذبةً تُدرَّب العينُ على
 * تجاهلِها، وحاجزٌ يُتجاهَل أسوأُ من حاجزٍ لا يوجد.
 *
 * والسلاسلُ النصّيّةُ تُصان كما هي: `'//'` داخلَ سلسلةٍ ليس بدايةَ تعليق.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  let out = '';
  let index = 0;
  /** @type {null | 'line' | 'block' | '\'' | '"' | '`'} */
  let mode = null;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    const ch = source[index] ?? '';
    if (mode === null) {
      if (two === '//') {
        mode = 'line';
        index += 2;
        continue;
      }
      if (two === '/*') {
        mode = 'block';
        index += 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') mode = /** @type {'\'' | '"' | '`'} */ (ch);
      out += ch;
      index += 1;
      continue;
    }
    if (mode === 'line') {
      if (ch === '\n') {
        mode = null;
        out += ch;
      }
      index += 1;
      continue;
    }
    if (mode === 'block') {
      if (two === '*/') {
        mode = null;
        index += 2;
      } else {
        if (ch === '\n') out += ch;
        index += 1;
      }
      continue;
    }
    // داخلَ سلسلةٍ نصّيّة.
    if (ch === '\\') {
      out += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (ch === mode) mode = null;
    out += ch;
    index += 1;
  }
  return out;
}

/**
 * مواصفاتُ التحميلِ الديناميِّ الحرفيّةِ — `import('…')` و`require('…')`.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function dynamicSpecifiers(source) {
  /** @type {string[]} */
  const specs = [];
  for (const match of stripComments(source).matchAll(DYNAMIC_SPEC)) {
    const spec = match[1];
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

/**
 * أسبابُ تعذُّرِ القياسِ في ملفٍّ — تحميلٌ بمواصفةٍ غيرِ حرفيّةٍ أو `createRequire`.
 *
 * **فشلٌ مغلَقٌ عن قصد:** حاجزٌ لا يستطيع أن يقيسَ ملفّاً **لا يُمرِّرُه**.
 * فالمرورُ عند العجزِ يقول «قِستُ فلم أجد» وهو لم يَقِس.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function opaqueLoadReasons(source) {
  const code = stripComments(source);
  /** @type {string[]} */
  const reasons = [];
  if (OPAQUE_LOAD.test(code)) reasons.push('تحميلٌ بمواصفةٍ غيرِ حرفيّةٍ لا تُقرأ نصّاً');
  if (CREATE_REQUIRE.test(code))
    reasons.push('`createRequire` — بابٌ إلى `require` خارجَ قياسِ الاستيراد');
  return reasons;
}

/**
 * مواصفاتُ الاستيرادِ الظاهرةُ في نصِّ ملفٍّ واحد.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function importSpecifiers(source) {
  /** @type {string[]} */
  const specs = [];
  for (const match of source.matchAll(IMPORT_SPEC)) {
    const spec = match[1];
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

/**
 * حلُّ مواصفةٍ نسبيّةٍ إلى مسارٍ من جذرِ المستودعِ بفواصلَ أماميّةٍ دائماً.
 *
 * @param {string} from مسارُ الملفِّ المستورِدِ من جذرِ المستودع.
 * @param {string} spec المواصفةُ كما كُتبت.
 * @returns {string | null} المسارُ المحلولُ، أو `null` إن لم تكن نسبيّة.
 */
export function resolveRelative(from, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
}

/**
 * الإغلاقُ التبعيُّ للاستيراداتِ النسبيّةِ ابتداءً من المداخلِ المُعلَنة.
 *
 * الملفُّ الذي تتعذّرُ قراءتُه يُقيَّد في `missing` ولا يُبتلَع: مدخلٌ مُعلَنٌ لا
 * وجودَ له وثيقةٌ تصفُ مستودعاً آخر.
 *
 * @param {object} input
 * @param {string[]} input.entries مداخلُ المسارِ من جذرِ المستودع.
 * @param {(file: string) => string | null} input.sourceOf قارئٌ محقونٌ يُعيد `null` عند الغياب.
 * @returns {{ closure: string[], missing: string[] }}
 */
export function importClosure({ entries, sourceOf }) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) continue;
    const source = sourceOf(file);
    if (source === null) {
      missing.push(file);
      continue;
    }
    seen.add(file);
    for (const spec of [...importSpecifiers(source), ...dynamicSpecifiers(source)]) {
      const resolved = resolveRelative(file, spec);
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return { closure: [...seen].sort(), missing: [...new Set(missing)].sort() };
}

/**
 * مقايسةُ سطحِ الاستدعاءِ الفعليِّ بالسطحِ المُعلَنِ في الوثيقةِ — في الاتجاهين.
 *
 * الاتجاهُ الأوّل يمنعُ **جامعاً ثانياً يتسلّل**، والثاني يمنعُ **إعلاناً يبقى
 * بعد زوالِ سببِه**: قائمةٌ تذكرُ ملفّاً لم يعدْ يُطلِقُ عمليّةً تُعلِّمُ القارئَ
 * خطأً وتُوسِّعُ الإذنَ بلا حاجة.
 *
 * @param {object} input
 * @param {string[]} input.entries
 * @param {string[]} input.declared الملفّاتُ التي تُجيز لها الوثيقةُ إطلاقَ عمليّة.
 * @param {(file: string) => string | null} input.sourceOf
 * @returns {{ closure: string[], spawners: string[], undeclared: string[], stale: string[], missing: string[], opaque: { file: string, reasons: string[] }[] }}
 */
export function auditSpawnSurface({ entries, declared, sourceOf }) {
  const { closure, missing } = importClosure({ entries, sourceOf });
  const allowed = new Set(declared);
  /** @type {string[]} */
  const spawners = [];
  /** @type {{ file: string, reasons: string[] }[]} */
  const opaque = [];
  for (const file of closure) {
    const source = sourceOf(file);
    if (source === null) continue;
    const specs = [...importSpecifiers(source), ...dynamicSpecifiers(source)];
    if (specs.includes(SPAWN_IMPORT)) spawners.push(file);
    const reasons = opaqueLoadReasons(source);
    if (reasons.length > 0) opaque.push({ file, reasons });
  }
  const undeclared = spawners.filter((file) => !allowed.has(file));
  const stale = declared.filter((file) => !spawners.includes(file)).sort();
  return { closure, spawners, undeclared, stale, missing, opaque };
}
