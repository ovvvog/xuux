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

if (violations.length > 0) {
  console.error('⛔ حاجز نقطة التفويض: مسار جانبي محتمل حول قرار السياسة.');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

console.log(`✅ حاجز نقطة التفويض: ${governed.size} فعلاً محكوماً، ولا مسار جانبي.`);
