#!/usr/bin/env node
/**
 * حاجز المعرفة — البوابة السابعة عشرة (‏M7.08).
 *
 * خارطةُ الطريق تُلزم بمعايير معرفةٍ **«مربوطة بالكود لا نصوصاً حرة»**. وهذه
 * الجملةُ نفسُها تحتاج مَن يفرضها، وإلا كانت هي أوّلَ نصٍّ حرّ في المستودع: تُكتب
 * وثائقُ جميلةٌ في `knowledge/`، ثم تتغيّر الشيفرةُ فتصير الوثائقُ ذاكرةً لعيبٍ
 * أُغلق أو لحاجزٍ لم يُبنَ قطّ. فهذا الحاجزُ يقيس الرابطةَ نفسَها.
 *
 * القواعد:
 *   R1  سياسةُ المعرفة تُحمَّل وتطابق مخطَّطها الصارم، وتتماسك داخلياً.
 *   R2  لكل معيارٍ وثيقةٌ موجودةٌ في `knowledge/`، وتذكر **كلَّ** بندٍ بمعرّفه
 *       **ورمزِ رفضه** — فبندٌ في السياسة لا تشرحه وثيقتُه إعلانٌ بلا سند،
 *       ووثيقةٌ لا تذكر الرمزَ نصٌّ حرٌّ بالضبط.
 *   R3  كلُّ رمزِ رفضٍ معلَنٍ في بندٍ **موجودٌ فعلاً** في إحدى وحدات إنفاذ
 *       معياره؛ فرمزٌ لا يُرمى في الشيفرة رفضٌ لا يقع.
 *   R4  كلُّ وحدةِ إنفاذٍ معلَنةٍ موجودة.
 *   R5  لا طريقَ جانبيّ في مسار تقييم النماذج: `src/models/evaluation.mjs` تنادي
 *       `assertRegistered`، وترفض التركيبَ بلا `experiments`، وتشترط
 *       `experimentId` في `record` وفي تحميل المخزن الدائم.
 *   R6  كلُّ نوعِ تجربةٍ إمّا مربوطٌ بموضعٍ **موجود** في الشيفرة، أو `null`
 *       **بسببٍ مكتوب**؛ فارتباطٌ يُعلن ولا وجود له أسوأُ من غيابٍ مُعلَن.
 *   R7  لا وحدةَ تحت `src/` تستورد سجلَّ التجارب إلا المُعلَنات في
 *       `ledgerHolders`؛ فمسارٌ ثالثٌ إلى المخزن يُبطل الحاجز من حيث لا يُقرأ.
 *
 * الاستعمال: node scripts/guard-knowledge.mjs [--root <path>]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT =
  rootIndex !== -1 && args[rootIndex + 1] !== undefined
    ? path.resolve(/** @type {string} */ (args[rootIndex + 1]))
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const violations = [];

/** @param {string} relative @returns {string | null} */
function readIfExists(relative) {
  const absolute = path.join(ROOT, relative);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;
}

/** @param {string} directory @param {string[]} found @returns {string[]} */
function collectModules(directory, found = []) {
  if (!fs.existsSync(directory)) return found;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectModules(absolute, found);
    else if (entry.name.endsWith('.mjs')) found.push(absolute);
  }
  return found;
}

// ── R1 ──
/** @type {import('../src/knowledge/experiment-ledger.mjs').KnowledgePolicy | null} */
let policy = null;
try {
  const module = await import(
    path.join(ROOT, 'src', 'knowledge', 'experiment-ledger.mjs').replace(/\\/gu, '/')
  );
  policy = module.loadKnowledgePolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(
    `R1 سياسة المعرفة لا تُحمَّل: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (policy !== null) {
  const standards = policy.standards;

  // ── R2 و R3 و R4 ──
  for (const standard of standards) {
    const document = readIfExists(standard.document);
    if (document === null) {
      violations.push(`R2 وثيقةُ المعيار «${standard.id}» غائبة: ${standard.document}`);
    }
    /** @type {string[]} */
    const enforcerTexts = [];
    for (const module of standard.enforcedBy) {
      const text = readIfExists(module);
      if (text === null) {
        violations.push(`R4 وحدةُ إنفاذٍ معلَنةٌ غائبة في «${standard.id}»: ${module}`);
      } else {
        enforcerTexts.push(text);
      }
    }
    const enforcers = enforcerTexts.join('\n');
    for (const clause of standard.clauses) {
      if (document !== null) {
        if (!document.includes(clause.id)) {
          violations.push(
            `R2 البند «${clause.id}» من المعيار «${standard.id}» غير مذكورٍ في وثيقته`,
          );
        }
        if (!document.includes(clause.code)) {
          violations.push(
            `R2 وثيقةُ «${standard.id}» تذكر البند «${clause.id}» ولا تذكر رمزَ رفضه «${clause.code}» — وهذا هو النصُّ الحرّ بعينه`,
          );
        }
      }
      if (enforcers !== '' && !enforcers.includes(clause.code)) {
        violations.push(
          `R3 الرمز «${clause.code}» (البند ${clause.id}/${standard.id}) غيرُ موجودٍ في أيٍّ من وحدات إنفاذه؛ رفضٌ معلَنٌ لا يقع`,
        );
      }
    }
  }

  // ── R6 ──
  for (const kind of policy.experimentKinds) {
    if (kind.boundTo === null) {
      if ((kind.reason ?? '').trim() === '') {
        violations.push(`R6 النوع «${kind.id}» بلا ارتباطٍ وبلا سببٍ مكتوب`);
      }
      continue;
    }
    const [modulePath, symbolPath] = kind.boundTo.split('#');
    const text = readIfExists(/** @type {string} */ (modulePath));
    if (text === null) {
      violations.push(`R6 ارتباطُ النوع «${kind.id}» يشير إلى وحدةٍ غائبة: ${modulePath}`);
      continue;
    }
    const symbols = (symbolPath ?? '').split('.').filter((part) => part !== '');
    for (const symbol of symbols) {
      if (!text.includes(symbol)) {
        violations.push(
          `R6 ارتباطُ النوع «${kind.id}» يذكر «${symbol}» ولا وجودَ له في ${modulePath}`,
        );
      }
    }
  }

  // ── R7 ──
  const allowed = new Set(policy.ledgerHolders.map((entry) => entry.replace(/\\/gu, '/')));
  for (const absolute of collectModules(path.join(ROOT, 'src'))) {
    const relative = path.relative(ROOT, absolute).replace(/\\/gu, '/');
    if (allowed.has(relative)) continue;
    const text = fs.readFileSync(absolute, 'utf8');
    if (/experiment-ledger\.mjs/u.test(text) || /from\s+'[^']*knowledge\/index\.mjs'/u.test(text)) {
      violations.push(
        `R7 الوحدة «${relative}» تستورد سجلَّ التجارب وليست في ledgerHolders؛ مسارٌ ثالثٌ إلى المخزن`,
      );
    }
  }
}

// ── R5 ── يُقاس نصّاً لأن المطلوب غيابُ **مسارٍ بديل** لا سلوكُ نداءٍ واحد.
const evaluation = readIfExists('src/models/evaluation.mjs');
if (evaluation === null) {
  violations.push('R5 src/models/evaluation.mjs غائبة؛ لا موضعَ للإنفاذ أصلاً');
} else {
  if (!evaluation.includes('assertRegistered')) {
    violations.push('R5 سجلُّ التقييم لا ينادي assertRegistered؛ فالنتيجةُ تُكتب بلا سندٍ مسجَّل');
  }
  if (!/if\s*\(!experiments\)/u.test(evaluation)) {
    violations.push(
      'R5 سجلُّ التقييم لا يرفض التركيبَ بلا experiments؛ واعتمادٌ اختياريٌّ حاجزٌ يُتجاوَز بحذف وسيط',
    );
  }
  if (!/record\(\{[^}]*experimentId/u.test(evaluation)) {
    violations.push('R5 الدالة record لا تشترط experimentId في وسائطها');
  }
  if (!/record\.experimentId/u.test(evaluation)) {
    violations.push(
      'R5 تحميلُ المخزن الدائم لا يشترط experimentId؛ فالملفُّ طريقٌ جانبيٌّ يُبطل الشرط',
    );
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز المعرفة رفض:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

const standardCount = policy?.standards.length ?? 0;
const clauseCount = (policy?.standards ?? []).reduce(
  (total, standard) => total + standard.clauses.length,
  0,
);
const kindCount = policy?.experimentKinds.length ?? 0;
const boundCount = (policy?.experimentKinds ?? []).filter((kind) => kind.boundTo !== null).length;
console.log(
  `✅ حاجز المعرفة: ${standardCount} معايير و${clauseCount} بنداً كلُّها مربوطةٌ برموز رفضٍ قائمةٍ في وحدات إنفاذها، و${boundCount} من ${kindCount} أنواعِ تجاربَ مربوطةٌ بالشيفرة والباقي بأسبابٍ مكتوبة.`,
);
