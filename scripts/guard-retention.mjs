#!/usr/bin/env node
// حاجز دورة الاحتفاظ والمحو — M7.06، بوابة G7
//
// الغرض: أن يفشل البناء إذا عاد **الطريق** الذي كان يجعل المحو يقع بلا شاهد.
// ومعيار القبول المعلَن («دورة احتفاظ كاملة تُمحى وتُسجَّل») يُقاس في
// `tests/data/retention-cycle.test.mjs`؛ وهذا الحاجز يحرس ما لا يحرسه اختبارُ
// سلوك: أن لا يُفتح المسارُ نفسه من جديد في موضعٍ آخر. وخمس قواعد:
//
//   R1 — السياسة تتماسك أو يسقط الحاجز: التحميل نفسه هو الفحص (ترتيبُ الأهداف،
//        وتطابقُ أدوار المطهِّر مع `config/memory.yaml`)، فلا تُكرَّر قواعده هنا كي
//        لا تنحرف نسخةُ الحاجز عن نسخة الكود.
//   R2 — كل قيدٍ معلَن للدفتر له قيدٌ في هجرة: قيدٌ في ملف YAML لا يردّ كتابةً
//        مباشرة في القاعدة، وإعلانٌ بلا قيد يُقرأ ضماناً وهو وعد.
//   R3 — كل مسارٍ محكوم موجودٌ **ويقيس الفاعل**، و**لا حذفَ في الوحدة بلا شاهد**:
//        كل طريقة في `guardedPaths` موجودة وتذكر `actor`، والوحدة تكتب في الدفتر
//        (`erasureLedger.record`) وتُثبت سلامته (`assertIntact`). وهذا نصّ العيب
//        الذي أُغلق: `retention.purge` كان يحذف بـ`DELETE` بلا شاهد ولا فاعل.
//   R4 — لا مسار جانبي: لا وحدة في `src/` تلمس مستودع الشواهد أو تُنشئ دفتراً إلا
//        الوحدات المعلَنة في `ledgerHolders`. فمن أراد محواً بلا شاهد لا يحتاج
//        ثغرةً في الدورة، بل مساراً أقصر: المستودع مباشرةً و`remove` فيه.
//   R5 — **فحص المخزون**: إن وُجدت `DATABASE_URL` فيُقاس أن سلسلة الشواهد متّصلة
//        بلا ثغرة تسلسل، وأن لا عقدَ بياناتٍ يتيماً في الفهرس. وبلا `DATABASE_URL`
//        يُعلَن الفحص **متروكاً** صراحةً ولا يُدّعى نجاحه: حاجزٌ يقول «✅» وهو لم
//        يقرأ قاعدةً هو ادّعاء دليل (المادة 2).
//
// رمز الخروج 1 عند أي مخالفة، ولا يُسكت الحاجز ببيئةٍ ولا بوسيط.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRetentionPolicy } from '../src/data/retention-cycle.mjs';

// `--root` يسمح بتشغيل الحاجز على شجرةٍ أخرى، وهو ما يجعل **الحاجز نفسه** قابلاً
// للاختبار. وكل قراءةٍ هنا تُحلّ على الشجرة المفحوصة لا على شجرة الحاجز.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const skipped = [];

// ── R1: السياسة تُحمَّل أو يسقط الحاجز ──
const policy = loadRetentionPolicy({ dir: path.join(ROOT, 'config') });

// ── R2: كل قيدٍ معلَن له قيدٌ في هجرة ──
const migrationsDir = path.join(ROOT, 'migrations');
const sql = fs.existsSync(migrationsDir)
  ? fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => read(path.join(migrationsDir, file)))
      .join('\n')
  : '';
for (const constraint of policy.ledger.dbConstraints) {
  if (!sql.includes(constraint)) {
    violations.push(
      `R2: القيد «${constraint}» معلَنٌ في config/retention.yaml ولا وجود له في أي هجرة؛ قيدٌ في ملفٍ لا يردّ كتابةً مباشرة في القاعدة.`,
    );
  }
}
if (!sql.includes(policy.ledger.table)) {
  violations.push(
    `R2: جدول الشواهد «${policy.ledger.table}» معلَنٌ في الإعداد ولا تُنشئه أي هجرة؛ دفترٌ بلا جدول محوٌ بلا شاهد.`,
  );
}
// المانع الذي يفرض الترتيب هو مرجعُ القاعدة نفسه، فوجودُه شرطُ صحّة الترتيب
// المعلَن: بلا `RESTRICT` يصير عكسُ الترتيب ممكناً في القاعدة فيمحو الأصلَ قبل
// ذاكرته ويترك مدخلاً يشير إلى عقدٍ زائل.
if (!/dataset_id[^;]*ON DELETE RESTRICT/s.test(sql)) {
  violations.push(
    'R2: لا وجود لمرجع `state.memories.dataset_id … ON DELETE RESTRICT` في الهجرات؛ وهو الضمانُ الأخير خلف ترتيب الدورة (الذاكرة قبل عقدها) — والترتيبُ وحده في ملفٍ لا يمنع مساراً آخر من عكسه.',
  );
}

// ── R3: المسارات المحكومة قائمة وتقيس الفاعل ولا تمحو بلا شاهد ──
for (const guarded of policy.guardedPaths) {
  const file = path.join(ROOT, guarded.module);
  if (!fs.existsSync(file)) {
    violations.push(
      `R3: الوحدة «${guarded.module}» معلَنة مساراً محكوماً ولا وجود لها؛ إعلانُ حكمٍ على مسارٍ غائب حكمٌ لا يُطبَّق.`,
    );
    continue;
  }
  const source = read(file);
  if (!source.includes('erasureLedger.record(')) {
    violations.push(
      `R3: الوحدة «${guarded.module}» لا تكتب في دفتر الشواهد (لا وجود لـ«erasureLedger.record»)؛ ومحوٌ بلا شاهد هو العيب الذي أُغلق في M7.06 — ومعيار القبول شطرُه الثاني «وتُسجَّل».`,
    );
  }
  if (!source.includes('assertIntact(')) {
    violations.push(
      `R3: الوحدة «${guarded.module}» لا تُثبت سلامة السلسلة («assertIntact»)؛ دفترٌ يُكتب فيه ولا يُتحقَّق منه يُقرأ ضماناً وهو ادّعاء.`,
    );
  }
  if (!source.includes('assertSweeper(')) {
    violations.push(
      `R3: الوحدة «${guarded.module}» لا تقيس دور المطهِّر («assertSweeper»)؛ فمن يمحو ما انتهت مدّته يمحو دليلاً، ومحوٌ بلا دورٍ مُعلَن محوٌ لا يُراجَع.`,
    );
  }
  for (const method of guarded.methods) {
    const declaration = new RegExp(`\\n\\s+async ${method}\\s*\\(([^)]*)\\)`).exec(source);
    if (declaration === null) {
      violations.push(
        `R3: الطريقة «${method}» معلَنة مساراً محكوماً في «${guarded.module}» ولا وجود لها؛ فمن أراد الدورة سيذهب إلى المستودع مباشرةً.`,
      );
      continue;
    }
    const body = source.slice(declaration.index, source.indexOf('\n  }', declaration.index));
    if (!body.includes('actor')) {
      violations.push(
        `R3: «${method}» في «${guarded.module}» لا تذكر الفاعل «actor» في متنها؛ فقرارُ المحو فيها مقيسٌ على غير الفاعل.`,
      );
    }
  }
}

// ── R4: لا مسار جانبي إلى دفتر الشواهد ──
const allowed = new Set(policy.ledgerHolders.map((entry) => entry.replaceAll('\\', '/')));
for (const file of walk(path.join(ROOT, 'src'))) {
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  if (allowed.has(relative)) continue;
  const source = read(file);
  const touches = [
    'repositories.erasureRecords',
    'ERASURE_RECORD_SPEC)',
    'new ErasureLedger(',
  ].filter((needle) => source.includes(needle));
  if (touches.length > 0) {
    violations.push(
      `R4: الوحدة «${relative}» تلمس دفتر الشواهد (${touches.join('، ')}) وليست في ledgerHolders؛ مسارٌ جانبي إلى المستودع يكتب شاهداً بلا سلسلةٍ أو يمحو بلا شاهد.`,
    );
  }
}
for (const holder of allowed) {
  if (!fs.existsSync(path.join(ROOT, holder))) {
    violations.push(
      `R4: «${holder}» معلَنٌ حاملاً للدفتر ولا وجود له؛ قائمةُ إذنٍ فيها اسمٌ ميّت تُوسّع الإذن بلا حاجة.`,
    );
  }
}

// ── R5: فحص المخزون ──
const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  skipped.push(
    'R5: فحص المخزون متروك — لا DATABASE_URL. اتّصالُ سلسلة الشواهد وخلوُّها من شاهدٍ يناقض مشهودَه لم يُقاسا على قاعدة في هذا التشغيل، ويُقاسان في CI حيث القاعدة قائمة.',
  );
} else {
  const { Pool } = await import('pg');
  const { resolveDatabaseConfig } = await import('../src/persistence/db.mjs');
  resolveDatabaseConfig({ url: databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const chain = await pool.query(
      `SELECT count(*)::int AS total, coalesce(max(seq), 0)::int AS head FROM state.erasure_records`,
    );
    const total = chain.rows[0]?.total ?? 0;
    const head = chain.rows[0]?.head ?? 0;
    if (total !== head) {
      violations.push(
        `R5: دفتر الشواهد يحمل ${total} شاهداً ورأسُ تسلسله ${head}؛ الفرقُ ثغرةٌ في السلسلة — شاهدٌ حُذف أو أُدرج بتسلسلٍ مُخترَع، وكلاهما يُبطل الدفتر كدليل.`,
      );
    }
    // شاهدٌ يقول «مُحي» ومشهودُه قائمٌ في الجدول: تناقضٌ يُبطل الدفتر كدليل، وهو
    // ما يقع لو كُتب الشاهد في وصلةٍ غير وصلة المحو فتراجعت معاملةُ المحو وحدها.
    const contradicted = await pool.query(
      `SELECT count(*)::int AS total
         FROM state.erasure_records e
         JOIN state.data_assets a ON a.id::text = e.target_id
        WHERE e.target = 'data_assets'`,
    );
    const stale = contradicted.rows[0]?.total ?? 0;
    if (stale > 0) {
      violations.push(
        `R5: ${stale} شاهدَ محوٍ لعقد بياناتٍ ما زال قائماً في state.data_assets؛ شهادةٌ على محوٍ لم يقع تُبطل الدفتر كدليل — والسبب المعروف كتابةُ الشاهد في وصلةٍ غير وصلة المحو.`,
      );
    }
    console.log(`   • فُحص ${total} شاهداً في السلسلة و${stale} شاهداً متناقضاً.`);
  } finally {
    await pool.end();
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز الاحتفاظ: طريقٌ إلى محوٍ بلا شاهد أو إلى شاهدٍ بلا سلسلة.');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

for (const note of skipped) console.log(`⚠️  ${note}`);
console.log(
  `✅ حاجز الاحتفاظ: ترتيبٌ معلَن (${policy.cycle.order.join(' → ')})، و${policy.ledger.dbConstraints.length} قيداً في القاعدة، و${policy.guardedPaths.reduce((sum, entry) => sum + entry.methods.length, 0)} مساراً محكوماً يكتب شاهده، و${policy.ledgerHolders.length} وحدةً وحدها تلمس الدفتر.`,
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
