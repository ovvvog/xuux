#!/usr/bin/env node
// حاجز حدود ذاكرة الوكلاء — M7.05، بوابة G7
//
// الغرض: أن يفشل البناء إذا عاد **الطريق** الذي كان يجعل الذاكرة بلا حدّ ولا
// عزل. وفحص القبول المعلَن للخطوة («وكيل لا يقرأ ذاكرة وكيل آخر بأي مسار») يُقاس
// في `tests/data/memory-limits.test.mjs`؛ وهذا الحاجز يحرس ما لا يحرسه اختبارُ
// سلوك: أن لا يُفتح المسارُ نفسه من جديد في موضعٍ آخر. وخمس قواعد:
//
//   R1 — السياسة تتماسك أو يسقط الحاجز: التحميل نفسه هو الفحص، فلا تُكرَّر قواعده
//        هنا كي لا تنحرف نسخةُ الحاجز عن نسخة الكود.
//   R2 — كل قيدٍ معلَن له قيدٌ في هجرة: قيدٌ في ملف YAML لا يردّ كتابةً مباشرة في
//        القاعدة، وإعلانٌ بلا قيد يُقرأ ضماناً وهو وعد.
//   R3 — كل مسارٍ محكوم موجودٌ **ويقيس الملكية على الفاعل**: كل طريقة في
//        `guardedPaths` موجودة في الوحدة، ولا طريقةَ منها تأخذ `agentId` وسيطاً
//        أوّل موثوقاً بلا مرور بمشتقّ المالك من الفاعل. وهذا نصّ العيب الذي أُغلق:
//        `remember(agentId, …)` و`forget(agentId, id)` كانا يقيسان الملكية على
//        وسيطٍ يُمرّره المُنادي.
//   R4 — لا مسار جانبي: لا وحدة في `src/` تلمس مستودع الذاكرة أو سجلّها إلا
//        الوحدات المعلَنة في `repositoryHolders`. فمن أراد ذاكرة غيره لا يحتاج
//        ثغرةً في المخزن، بل مساراً أقصر: المستودع مباشرةً و`agentId` مرشِّحٌ فيه.
//   R5 — **فحص المخزون**: إن وُجدت `DATABASE_URL` فيُقاس أن لا صفَّ ذاكرةٍ أبدياً
//        (بلا انتهاء ولا حفظٍ قانوني)، ولا وكيلَ فوق حصّته. وبلا `DATABASE_URL`
//        يُعلَن الفحص **متروكاً** صراحةً ولا يُدّعى نجاحه: حاجزٌ يقول «✅» وهو لم
//        يقرأ قاعدةً هو ادّعاء دليل (المادة 2).
//
// رمز الخروج 1 عند أي مخالفة، ولا يُسكت الحاجز ببيئةٍ ولا بوسيط.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMemoryPolicy } from '../src/data/memory-limits.mjs';

// `--root` يسمح بتشغيل الحاجز على شجرةٍ أخرى، وهو ما يجعل **الحاجز نفسه** قابلاً
// للاختبار: اختبارٌ ينسخ الشجرة ويزرع فيها الانحراف ويقيس أن الحاجز يفشل. وكل
// قراءةٍ هنا تُحلّ على الشجرة المفحوصة لا على شجرة الحاجز — وهو خطأٌ ارتكبتُه في
// أول تركيب حاجز النسب (WL-028) فلا يُعاد.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const skipped = [];

// ── R1: السياسة تُحمَّل أو يسقط الحاجز ──
const policy = loadMemoryPolicy({ dir: path.join(ROOT, 'config') });

// ── R2: كل قيدٍ معلَن له قيدٌ في هجرة ──
const migrationsDir = path.join(ROOT, 'migrations');
const sql = fs.existsSync(migrationsDir)
  ? fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => read(path.join(migrationsDir, file)))
      .join('\n')
  : '';
for (const constraint of policy.store.dbConstraints) {
  if (!sql.includes(constraint)) {
    violations.push(
      `R2: القيد «${constraint}» معلَنٌ في config/memory.yaml ولا وجود له في أي هجرة؛ قيدٌ في ملفٍ لا يردّ كتابةً مباشرة في القاعدة.`,
    );
  }
}
if (!sql.includes(policy.store.table)) {
  violations.push(
    `R2: الجدول «${policy.store.table}» معلَنٌ في الإعداد ولا تُنشئه أي هجرة؛ مخزنٌ بلا جدول مخزنٌ لا يُكتب.`,
  );
}

// ── R3: المسارات المحكومة قائمة وتقيس الملكية على الفاعل ──
for (const guarded of policy.guardedPaths) {
  const file = path.join(ROOT, guarded.module);
  if (!fs.existsSync(file)) {
    violations.push(
      `R3: الوحدة «${guarded.module}» معلَنة مساراً محكوماً ولا وجود لها؛ إعلانُ حكمٍ على مسارٍ غائب حكمٌ لا يُطبَّق.`,
    );
    continue;
  }
  const source = read(file);
  // المالك يُشتقّ في موضعٍ واحد، فوجودُه شرطُ كل مسارٍ محكوم في هذه الوحدة.
  if (!source.includes('#ownerFor(')) {
    violations.push(
      `R3: الوحدة «${guarded.module}» لا تشتقّ المالك من الفاعل (لا وجود لـ«#ownerFor»)؛ ملكيّةٌ تُقاس على وسيطٍ يُمرّره المُنادي هي العيب الذي أُغلق في M7.05.`,
    );
  }
  for (const method of guarded.methods) {
    const declaration = new RegExp(`\\n\\s+async ${method}\\s*\\(([^)]*)\\)`).exec(source);
    if (declaration === null) {
      violations.push(
        `R3: الطريقة «${method}» معلَنة مساراً محكوماً في «${guarded.module}» ولا وجود لها؛ فمن يتصفّح الذاكرة سيذهب إلى المستودع مباشرةً.`,
      );
      continue;
    }
    const params = String(declaration[1] ?? '');
    // وسيطٌ أوّل اسمه `agentId` يعني أن المُنادي يسمّي المالك. وهو مأذونٌ في
    // `remember` وحدها لأن مسار التهيئة التشغيلي يكتب لوكيلٍ سجّله — وهناك
    // يمرّ الوسيط عبر `#ownerFor` الذي يرفضه إن كان الفاعل وكيلاً.
    if (/^\s*agentId\b/.test(params) && method !== 'remember') {
      violations.push(
        `R3: «${method}» في «${guarded.module}» تأخذ «agentId» وسيطاً أوّل؛ هذا هو توقيع forget(agentId, id) الذي كان يمحو ذاكرة أي وكيلٍ يُعرَف معرّفه.`,
      );
    }
    // كل مسارٍ محكوم يجب أن يذكر `actor`: مسارٌ بلا فاعل لا يُقاس عليه عزل.
    const body = source.slice(declaration.index, source.indexOf('\n  }', declaration.index));
    if (!body.includes('actor')) {
      violations.push(
        `R3: «${method}» في «${guarded.module}» لا تذكر الفاعل «actor» في متنها؛ فقرارُ العزل فيها مقيسٌ على غير الفاعل.`,
      );
    }
  }
}

// ── R4: لا مسار جانبي إلى المستودع ──
const allowed = new Set(policy.repositoryHolders.map((entry) => entry.replaceAll('\\', '/')));
for (const file of walk(path.join(ROOT, 'src'))) {
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  if (allowed.has(relative)) continue;
  const source = read(file);
  const touches = ['repositories.memories', 'registries.memory.repository', 'MEMORY_SPEC)'].filter(
    (needle) => source.includes(needle),
  );
  if (touches.length > 0) {
    violations.push(
      `R4: الوحدة «${relative}» تلمس مستودع الذاكرة (${touches.join('، ')}) وليست في repositoryHolders؛ مسارٌ جانبي إلى المستودع يتجاوز العزل كلَّه لأن «agentId» مرشِّحٌ مسموح فيه.`,
    );
  }
}
for (const holder of allowed) {
  if (!fs.existsSync(path.join(ROOT, holder))) {
    violations.push(
      `R4: «${holder}» معلَنٌ حاملاً للمستودع ولا وجود له؛ قائمةُ إذنٍ فيها اسمٌ ميّت تُوسّع الإذن بلا حاجة.`,
    );
  }
}

// ── R5: فحص المخزون ──
const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  skipped.push(
    'R5: فحص المخزون متروك — لا DATABASE_URL. خلوُّ الجدول من ذاكرةٍ أبديّة ومن وكيلٍ فوق حصّته لم يُقاسا على قاعدة في هذا التشغيل، ويُقاسان في CI حيث القاعدة قائمة.',
  );
} else {
  const { Pool } = await import('pg');
  const { resolveDatabaseConfig } = await import('../src/persistence/db.mjs');
  resolveDatabaseConfig({ url: databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const eternal = await pool.query(
      `SELECT count(*)::int AS total FROM state.memories WHERE expires_at IS NULL AND NOT legal_hold`,
    );
    const total = eternal.rows[0]?.total ?? 0;
    if (total > 0) {
      violations.push(
        `R5: ${total} صفَّ ذاكرةٍ بلا تاريخ انتهاء ولا حفظٍ قانوني؛ هذه هي الذاكرة الأبديّة التي كانت دورةُ المحو تمرّ عليها فتعدّ صفراً وتُعلن نجاحها.`,
      );
    }
    const over = await pool.query(
      `SELECT agent_id::text AS agent, count(*)::int AS held
         FROM state.memories
        GROUP BY agent_id
       HAVING count(*) > $1`,
      [policy.quotas.perAgentEntries],
    );
    for (const row of over.rows) {
      violations.push(
        `R5: الوكيل «${row.agent}» يحمل ${row.held} مدخلاً وحصّته ${policy.quotas.perAgentEntries}؛ حصّةٌ تُتجاوز في المخزون تعني كتابةً جرت من غير طريق المخزن.`,
      );
    }
    console.log(
      `   • فُحص ${total} صفّاً أبدياً و${over.rows.length} وكيلاً فوق حصّته في state.memories.`,
    );
  } finally {
    await pool.end();
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز الذاكرة: طريقٌ إلى ذاكرةٍ بلا حدّ أو بلا عزل.');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

for (const note of skipped) console.log(`⚠️  ${note}`);
console.log(
  `✅ حاجز الذاكرة: حصّةُ ${policy.quotas.perAgentEntries} مدخلاً لكل وكيل، و${policy.store.dbConstraints.length} قيداً في القاعدة، و${policy.guardedPaths.reduce((sum, entry) => sum + entry.methods.length, 0)} مساراً محكوماً يقيس الملكية على الفاعل، و${policy.repositoryHolders.length} وحدةً وحدها تلمس المستودع.`,
);

/**
 * @param {string} file
 * @returns {string}
 */
function read(file) {
  return fs.readFileSync(file, 'utf8');
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.mjs')) files.push(full);
  }
  return files;
}
