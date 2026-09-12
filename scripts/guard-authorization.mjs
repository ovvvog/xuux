#!/usr/bin/env node
// حاجز نقطة التفويض — M4.05، بوابة G4
//
// الغرض: أن يفشل البناء إذا فُتح مسار جانبي حول نقطة التفويض. والحاجز يفحص أربع
// قواعد، كل واحدة منها سدّت ثغرة كانت موجودة فعلاً قبل M4:
//
//   R1 — النواة تتحقّق من التذكرة: `src/core/execution-kernel.mjs` يجب أن يقرأ
//        الكتالوج من البيانات ويستدعي `verify`. كانت النواة قبل M4 لا تسأل أحداً.
//   R2 — لا وحدة أخرى تُسمّي فعلاً محكوماً: أي ملف في `src` خارج `src/policy/`
//        يذكر فعلاً محكوماً كنصّ حرفي يجب أن يمرّ بالتفويض (يذكر `verify` أو
//        `authorize`)، وإلا فذلك فعلٌ حسّاس يُنفَّذ من مكانٍ لا يعرفه المحرّك.
//   R3 — لا فعل محكوم في الكود لا تعرفه البيانات: كل فعل مذكور في مجموعات الكود
//        يجب أن يكون معلَناً في `config/policies.yaml`.
//   R5 — الحصّةُ تُخصمُ بوحدةِ قياسٍ مُعلَنةٍ (‏`R6-A-02`): كلُّ موردِ حصّةٍ مربوطٍ
//        بفعلٍ له `measure` في `config/quotas.yaml`؛ ونقطةُ التفويضِ **لا تقرأُ
//        مقدارَ الخصمِ من سياقِ الطلبِ** ولا تُمرِّرُ رقماً ثابتاً إلى `debit`؛
//        وكلُّ موردٍ `measured` له مُنادٍ في `src/` يُمرِّرُ مفتاحَ قياسِه في قناةِ
//        القياسِ. وهذه القاعدةُ هي ما يجعلُ التثبيتَ على `amount: 1` مكشوفاً.
//   R4 — لا انحراف بين المحرّك الأدنى والبيانات: مجموعة `SENSITIVE` في
//        `src/root-of-trust/policy.mts` يجب أن تكون **جزءاً** من الكتالوج
//        المعلَن، فلا تبقى قائمةٌ في الكود تحكم بما لا يعرفه الملف.
//
// رمز الخروج 1 عند أي مخالفة، ولا يُسكت الحاجز ببيئةٍ ولا بوسيط.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicyBundle } from '../src/policy/loader.mjs';

// `--root` يسمح بتشغيل الحاجز على شجرة أخرى، وهو ما يجعل **الحاجز نفسه** قابلاً
// للاختبار: اختبارٌ ينسخ الشجرة ويزرع فيها مساراً جانبياً ويقيس أن الحاجز يفشل.
// وبلا ذلك كان الحاجز يُقاس بنجاحه وحده — أي بلا دليل على أنه يفشل حين يجب.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** @type {string[]} */
const violations = [];

/**
 * @param {string} dir
 * @returns {string[]} كل ملفات الكود تحت المجلد
 */
function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
      continue;
    }
    if (/\.(mjs|mts)$/.test(entry.name) && !entry.name.endsWith('.d.mts')) found.push(full);
  }
  return found;
}

const bundle = loadPolicyBundle({ dir: path.join(ROOT, 'config') });
/** @type {Set<string>} */
const governed = new Set();
for (const action of bundle.actions.values()) if (action.sensitive) governed.add(action.id);
for (const entry of bundle.threshold) governed.add(entry.action);

// ── R1: النواة تمرّ بالنقطة ──
const kernelPath = path.join(ROOT, 'src', 'core', 'execution-kernel.mjs');
const kernelSource = fs.readFileSync(kernelPath, 'utf8');
if (!kernelSource.includes('loadGovernedActions')) {
  violations.push('R1: النواة لا تقرأ كتالوج الأفعال المحكومة من البيانات.');
}
if (!/this\.enforcement\.verify\(/.test(kernelSource)) {
  violations.push('R1: النواة لا تتحقّق من تذكرة القرار عبر نقطة التفويض.');
}
if (!kernelSource.includes('AUTHORIZATION_POINT_REQUIRED')) {
  violations.push('R1: النواة لا ترفض الفعل المحكوم عند غياب نقطة التفويض.');
}

// ── R2: لا فعل محكوم مُسمّى خارج وحدة السياسة إلا بمرور بالتفويض ──
const policyDir = path.join(ROOT, 'src', 'policy');
const legacyEngine = path.join(ROOT, 'src', 'root-of-trust', 'policy.mts');
for (const file of walk(path.join(ROOT, 'src'))) {
  if (file.startsWith(policyDir)) continue;
  if (file === legacyEngine) continue;
  const source = fs.readFileSync(file, 'utf8');
  // النصوص داخل التعليقات لا تُنفَّذ فعلاً، فتُسقط قبل الفحص كي لا يعاقب الحاجز
  // من شرح قراره بالعربية في تعليق.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  for (const action of governed) {
    const literal = new RegExp(`['"\`]${action.replace(/[-]/g, '\\-')}['"\`]`);
    if (!literal.test(code)) continue;
    if (/verify\(|authorize\(/.test(code)) continue;
    violations.push(
      `R2: ${path.relative(ROOT, file)} يُسمّي الفعل المحكوم «${action}» ولا يمرّ بنقطة التفويض.`,
    );
  }
}

// ── R3 و R4: لا انحراف بين قوائم الكود والبيانات ──
const legacySource = fs.readFileSync(legacyEngine, 'utf8');
const sensitiveBlock = /const SENSITIVE: Set<string> = new Set\(\[([\s\S]*?)\]\)/.exec(
  legacySource,
);
if (sensitiveBlock === null) {
  violations.push(
    'R4: لم تُقرأ مجموعة SENSITIVE من المحرّك الأدنى — تغيّر شكلها بلا تحديث الحاجز.',
  );
} else {
  const listed = [...(sensitiveBlock[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const action of listed) {
    if (action === undefined) continue;
    if (!bundle.actions.has(action)) {
      violations.push(`R3: المحرّك الأدنى يعرف فعلاً لا تعرفه البيانات: ${action}.`);
      continue;
    }
    if (!governed.has(action)) {
      violations.push(`R4: فعلٌ حسّاس في الكود وغير محكوم في البيانات: ${action}.`);
    }
  }
}

// ── R5: مقدارُ خصمِ الحصّةِ بوحدةِ قياسٍ مُعلَنةٍ لا برقمٍ ثابتٍ ولا بسياقِ المُنادي ──
/** @type {Map<string, { kind?: string, key?: string }>} */
const measures = new Map();
for (const quota of bundle.quotas ?? []) {
  measures.set(
    String(quota['resource']),
    /** @type {{ kind?: string, key?: string }} */ (quota['measure'] ?? {}),
  );
}
/** @type {Set<string>} */
const attachedResources = new Set();
for (const action of bundle.actions.values()) {
  const resource = /** @type {{ quotaResource?: string }} */ (action).quotaResource;
  if (typeof resource === 'string') attachedResources.add(resource);
}
for (const resource of attachedResources) {
  const measure = measures.get(resource);
  if (measure === undefined) {
    violations.push(`R5: الفعلُ يُخصم على المورد «${resource}» ولا حصّةَ معلَنةً له.`);
    continue;
  }
  if (measure.kind !== 'calls' && measure.kind !== 'measured') {
    violations.push(
      `R5: المورد «${resource}» بلا وحدةِ قياسٍ معلَنةٍ (measure.kind)؛ فالخصمُ يقعُ بوحدةٍ لا تُقرأ من الوثيقةِ.`,
    );
    continue;
  }
  if (measure.kind === 'measured' && typeof measure.key !== 'string') {
    violations.push(`R5: المورد «${resource}» معلَنٌ measured بلا مفتاحِ قياسٍ (measure.key).`);
  }
}

const enforcementPath = path.join(ROOT, 'src', 'policy', 'enforcement-point.mjs');
const enforcementSource = fs.readFileSync(enforcementPath, 'utf8');
const enforcementCode = enforcementSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');
if (/quotaAmount/.test(enforcementCode)) {
  violations.push(
    'R5: نقطةُ التفويضِ تقرأُ مقدارَ الخصمِ من سياقِ الطلبِ (quotaAmount)؛ والسياقُ يملكُه المُنادي فيُعلنُ عن نفسِه ما يُخصمُ منه.',
  );
}
if (!/resolveQuotaAmount\(/.test(enforcementCode)) {
  violations.push(
    'R5: نقطةُ التفويضِ لا تُشتقُّ مقدارَ الخصمِ من وحدةِ القياسِ المعلَنةِ (resolveQuotaAmount).',
  );
}
// الفحصُ على **نداءِ الخصمِ نفسِه** لا على الملفِّ كلِّه: الفرعُ المُعلَنُ
// `kind: 'calls'` يُرجعُ واحداً بحقٍّ لأنّ الوثيقةَ أعلنت أنّ النداءَ هو الكمّيةُ،
// أمّا نداءُ `debit` فلا يجوزُ أن يحملَ رقماً في الشفرةِ بحالٍ.
for (const call of enforcementCode.matchAll(/quotaLedger\.debit\(\{([\s\S]*?)\}\)/g)) {
  if (/amount:\s*\d/.test(call[1] ?? '')) {
    violations.push(
      'R5: نقطةُ التفويضِ تُمرِّرُ مقداراً ثابتاً إلى دفترِ الحصصِ؛ ورقمٌ ثابتٌ يجعلُ الحدَّ المعلَنَ بالوحدةِ عدَّ نداءاتٍ.',
    );
  }
}

// قناةُ القياسِ لا بدَّ لها من مُنادٍ: مفتاحُ قياسٍ لا يُمرِّرُه أحدٌ يعني أنّ كلَّ
// نداءٍ على ذلك الموردِ يُرفَض — أو أنّ الخصمَ لا يقعُ. وكلتاهما عيبٌ يُكشَف.
/** @type {Set<string>} */
const passedMeasureKeys = new Set();
for (const file of walk(path.join(ROOT, 'src'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/measured:\s*\{([^}]*)\}/g)) {
    for (const key of (match[1] ?? '').matchAll(/([a-zA-Z][a-zA-Z0-9]*)\s*:/g)) {
      if (key[1] !== undefined) passedMeasureKeys.add(key[1]);
    }
    // الشكلُ المختصرُ `{ bytes }` لا يحمل نقطتين.
    for (const key of (match[1] ?? '').matchAll(/(?:^|,)\s*([a-zA-Z][a-zA-Z0-9]*)\s*(?:,|$)/g)) {
      if (key[1] !== undefined) passedMeasureKeys.add(key[1]);
    }
  }
}
// ونطاقُ القاعدةِ مُعلَنٌ: تُطبَّقُ على الموردِ الذي **له مُستهلِكٌ** يُسمّي فعلَه في
// `src/`. فعلٌ مُعلَنٌ بلا مستهلِكٍ أصلاً (‏`allocate-budget` اليومَ) عيبٌ من نوعٍ
// آخرَ — «مُعلَنٌ لا يَنفُذ» — مُسجَّلٌ في `docs/REMAINING_WORK.md`، ولا تُخفيه هذه
// القاعدةُ ولا تدّعي إغلاقَه: خصمٌ لموردٍ لا يُنادى عليه أحدٌ لا يُقاس بحاجزٍ نصّي.
/** @type {Map<string, string>} */
const resourceOfAction = new Map();
for (const action of bundle.actions.values()) {
  const resource = /** @type {{ quotaResource?: string }} */ (action).quotaResource;
  if (typeof resource === 'string') resourceOfAction.set(action.id, resource);
}
// والمحرّكُ الأدنى مُستثنىً كما في R2: قائمةُ `SENSITIVE` فيه تُسمّي الأفعالَ
// تعريفاً لا استهلاكاً، فعدُّها مُستهلِكاً يُخفي فعلاً بلا مستهلِكٍ.
const srcCorpus = walk(path.join(ROOT, 'src'))
  .filter((file) => file !== legacyEngine && file !== legacyEngine.replace(/\.mts$/, '.mjs'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
for (const [actionId, resource] of resourceOfAction) {
  const measure = measures.get(resource);
  if (measure === undefined || measure.kind !== 'measured') continue;
  const key = measure.key;
  if (typeof key !== 'string') continue;
  const consumed = new RegExp(`['"\`]${actionId.replace(/[-]/g, '\\-')}['"\`]`).test(srcCorpus);
  if (!consumed) continue;
  if (!passedMeasureKeys.has(key)) {
    violations.push(
      `R5: المورد «${resource}» (الفعل «${actionId}») يُخصم بالكمّيةِ المقيسةِ «${key}» ولا مُنادٍ في src يُمرِّرُها في قناةِ القياسِ.`,
    );
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز نقطة التفويض: مسار جانبي محتمل حول قرار السياسة.');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

console.log(`✅ حاجز نقطة التفويض: ${governed.size} فعلاً محكوماً، ولا مسار جانبي.`);
