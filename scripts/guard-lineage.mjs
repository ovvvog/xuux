#!/usr/bin/env node
// حاجز نسب البيانات — M7.04، بوابة G7
//
// الغرض: أن يفشل البناء إذا عاد النسب **ادّعاءً** بعد أن صار قيداً. وفحص القبول
// المُعلَن للخطوة هو «استعلام النسب يُعيد السلسلة كاملة لأي أصل»، ويُقاس في
// `tests/data/lineage.test.mjs`. أما هذا الحاجز فيحرس ما لا يحرسه اختبارُ سلوك:
// أن لا يعود **الطريق** الذي كان يجعل النسب ادّعاءً. وخمس قواعد:
//
//   R1 — عمود الادّعاء **لا يعود**: لا حقل `lineage` في مواصفة أصل البيانات، ولا
//        عمود `lineage` مُنشأ في أي هجرة بعد الهجرة التي أسقطته. حقلٌ يعود بصمت
//        يعيد معه المسار القديم كلَّه، ولا يفشل شيء.
//   R2 — كل مُسجّل معلَن يسجّل فعلاً: كل `module` في `recorders` يجب أن يستدعي
//        `.record(`. فإعدادٌ يقول «هذا المسار يكتب النسب» وكودُه لا يكتب هو أسوأ
//        من إعدادٍ لا يقول شيئاً، لأنه يُقرأ ضماناً.
//   R3 — كل قيدٍ معلَن له قيدٌ في هجرة: كل اسمٍ في `store.dbConstraints` موجودٌ
//        نصّاً في ملفات الهجرة. قيدٌ في الإعداد بلا قيدٍ في القاعدة وعدٌ لا ضمان،
//        ومن كتب في الجدول من غير طريق الكود لا يردّه إعدادٌ في ملف YAML.
//   R4 — السياسة متماسكة مع سلّم التصنيف: التحميل نفسه هو الفحص، فلا تُكرَّر
//        قواعدُه هنا كي لا تنحرف نسخةُ الحاجز عن نسخة الكود.
//   R5 — **فحص المخزون**: إن وُجدت `DATABASE_URL` فُتُفحَص سلاسل التجزئة كلها،
//        ويُقاس أن **كل أصلٍ في الفهرس له قيد أصل** — أصلٌ بلا قيدٍ هو الحدُّ
//        المعلَن في `DataCatalog.register` (القيد يُكتب بعد صفّ الأصل بلا معاملة)،
//        وهذا موضع كشفه. وبلا `DATABASE_URL` يُعلَن الفحص **متروكاً** صراحةً ولا
//        يُدّعى نجاحه: حاجزٌ يقول «✅» وهو لم يقرأ قاعدةً هو ادّعاء دليل (المادة 2).
//
// رمز الخروج 1 عند أي مخالفة، ولا يُسكت الحاجز ببيئةٍ ولا بوسيط.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadClassificationLattice } from '../src/data/classification.mjs';
import { loadLineagePolicy } from '../src/data/lineage.mjs';

// `--root` يسمح بتشغيل الحاجز على شجرة أخرى، وهو ما يجعل **الحاجز نفسه** قابلاً
// للاختبار: اختبارٌ ينسخ الشجرة ويعيد فيها حقلَ الادّعاء ويقيس أن الحاجز يفشل.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const skipped = [];

// ── R4 أولاً: السياسة تُحمَّل أو يسقط الحاجز ──
// ترتيبُها أوّلاً مقصود: القواعد الأخرى تُقرأ **من** السياسة، فقياسها على سياسةٍ
// غير متماسكة قياسٌ على رمل.
const lattice = loadClassificationLattice({ dir: path.join(ROOT, 'config') });
const policy = loadLineagePolicy({ dir: path.join(ROOT, 'config'), lattice });

// ── R1: عمود الادّعاء لا يعود ──
const retired = policy.retiredClaimColumn;
if (retired === null) {
  violations.push(
    'R1: `retiredClaimColumn` غير معلَن في config/lineage.yaml؛ بلا إعلانٍ لما أُلغي لا يُحرَس رجوعُه.',
  );
} else {
  // المواصفة تُقرأ **نصّاً من الشجرة المفحوصة** لا باستيرادها: الحاجز يُشغَّل على
  // شجرةٍ منسوخة (‏`--root`) كي يُختبَر هو نفسه، واستيرادُ الوحدة يقرأ شجرةَ
  // الحاجز فيمرّ الانحراف المزروع. هذا خطأٌ ارتكبتُه في أول تركيبٍ لهذا الحاجز.
  const specSource = read(path.join(ROOT, 'src', 'persistence', 'entities.mjs'));
  const assetBlock = specSource.slice(specSource.indexOf('export const DATA_ASSET_SPEC'));
  const assetFields = assetBlock.slice(0, assetBlock.indexOf('invariants'));
  if (/^\s+lineage\s*:/m.test(assetFields)) {
    violations.push(
      `R1: الحقل «${retired.column}» عاد إلى مواصفة ${retired.table}؛ هذا هو النسب المُدّعى الذي أُغلق في M7.04 — مصفوفةٌ حرّة يكتبها من يسجّل الأصل ثم تُقرأ كأنها محقَّقة.`,
    );
  }
  const migrationsDir = path.join(ROOT, 'migrations');
  const files = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir).sort() : [];
  // الهجرة التي أسقطت العمود هي الحدّ: ما قبلها تاريخٌ لا يُعاد كتابته، وما بعدها
  // إن أنشأ العمود فقد أعاده. والتراجع (`*.down.sql`) يُعيده بإعلانه فلا يُحاسب.
  const dropper = files.find(
    (file) =>
      file.endsWith('.up.sql') &&
      read(path.join(migrationsDir, file)).includes('DROP COLUMN lineage'),
  );
  if (dropper === undefined) {
    violations.push(
      'R1: لا هجرةَ تُسقط عمود الادّعاء `state.data_assets.lineage`؛ إسقاطُه في مواصفة الكود وحدها يُبقي العمود في كل قاعدة قائمة.',
    );
  }
  for (const file of files) {
    if (!file.endsWith('.up.sql')) continue;
    if (dropper !== undefined && file <= dropper) continue;
    const body = read(path.join(migrationsDir, file));
    if (/ADD COLUMN\s+lineage\b/i.test(body) || /\blineage\s+jsonb/i.test(body)) {
      violations.push(
        `R1: الهجرة ${file} تُنشئ عمود «${retired.column}» في ${retired.table} بعد إسقاطه؛ عودةُ العمود عودةُ الادّعاء.`,
      );
    }
  }
}

// ── R2: كل مُسجّل معلَن يسجّل فعلاً ──
for (const recorder of policy.recorders) {
  const full = path.join(ROOT, recorder.module);
  if (!fs.existsSync(full)) {
    violations.push(
      `R2: المسار المعلَن «${recorder.module}» غير موجود؛ إعلانُ مُسجّلٍ لا وجود له يُقرأ ضماناً وهو فراغ.`,
    );
    continue;
  }
  const body = read(full);
  if (!body.includes('.record(')) {
    violations.push(
      `R2: «${recorder.module}» معلَنٌ مُسجّلاً للأنواع (${recorder.kinds.join('، ')}) ولا يستدعي \`.record(\`؛ مسارٌ يُقال إنه يكتب النسب ولا يكتبه يجعل «من قرأه» بلا جواب.`,
    );
  }
}

// ── R3: كل قيدٍ معلَن له قيدٌ في هجرة ──
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
      `R3: القيد «${constraint}» معلَنٌ في الإعداد ولا وجود له في أي هجرة؛ قيدٌ في ملفٍ لا يردّ كتابةً مباشرة في القاعدة.`,
    );
  }
}
if (!sql.includes(policy.store.table)) {
  violations.push(
    `R3: الجدول «${policy.store.table}» معلَنٌ في الإعداد ولا تُنشئه أي هجرة؛ دفترٌ بلا جدول دفترٌ لا يُكتب.`,
  );
}

// ── R5: فحص المخزون ──
const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  skipped.push(
    'R5: فحص المخزون متروك — لا DATABASE_URL. سلامةُ سلاسل النسب ووجودُ قيد أصلٍ لكل أصل لم يُقاسا على قاعدة في هذا التشغيل، ويُقاسان في CI حيث القاعدة قائمة.',
  );
} else {
  const { Pool } = await import('pg');
  const { resolveDatabaseConfig } = await import('../src/persistence/db.mjs');
  const { LineageLedger } = await import('../src/data/lineage.mjs');
  const { createPostgresRepository } = await import('../src/persistence/repository-postgres.mjs');
  const { DATA_LINEAGE_SPEC, DATA_ASSET_SPEC } = await import('../src/persistence/entities.mjs');
  const { EventLog } = await import('../src/root-of-trust/event-log.mjs');
  resolveDatabaseConfig({ url: databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const assets = createPostgresRepository(pool, DATA_ASSET_SPEC);
    const ledger = new LineageLedger({
      log: new EventLog(),
      repository: createPostgresRepository(pool, DATA_LINEAGE_SPEC),
      catalog: { get: (id) => assets.findById(id) },
      lattice,
      policy,
    });
    const verdict = await ledger.verify();
    for (const fault of verdict.broken) {
      violations.push(`R5: سلسلة «${fault.assetId}» عند التسلسل ${fault.seq}: ${fault.reason}`);
    }
    const { rows } = await pool.query(
      `SELECT a.id::text AS id
         FROM state.data_assets a
         LEFT JOIN state.data_lineage l ON l.asset_id = a.id AND l.kind = 'origin'
        WHERE l.id IS NULL`,
    );
    for (const row of rows) {
      violations.push(
        `R5: الأصل «${row.id}» بلا قيد أصلٍ في الدفتر؛ هذا هو الحدّ المعلَن في DataCatalog.register (القيد يُكتب بعد صفّ الأصل، والذرّية تحتاج مُشغّل معاملة) — فيُكشف هنا ولا يُسكت عنه.`,
      );
    }
    console.log(
      `   • فُحص ${verdict.entries} قيداً على ${verdict.assets} أصلاً، و${rows.length} أصلاً بلا قيد أصل.`,
    );
  } finally {
    await pool.end();
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز النسب: طريقٌ إلى نسبٍ مُدّعىً أو دفترٍ لا يُكتب.');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

for (const note of skipped) console.log(`⚠️  ${note}`);
console.log(
  `✅ حاجز النسب: ${policy.kindIds.length} أنواعٍ معلَنة (${policy.kindIds.join('، ')})، و${policy.recorders.length} مُسجّلاً يكتب فعلاً، و${policy.store.dbConstraints.length} قيداً في القاعدة، وعمود الادّعاء لم يعد.`,
);

/**
 * @param {string} file
 * @returns {string}
 */
function read(file) {
  return fs.readFileSync(file, 'utf8');
}
