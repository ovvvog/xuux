#!/usr/bin/env node
// حاجز التشفير عند التخزين وعند النقل — M7.03، بوابة G7
//
// الغرض: أن يفشل البناء إذا انفتح طريقٌ إلى **مادةٍ مصنَّفة مخزَّنة نصّاً**. وفحص
// القبول المُعلَن للخطوة هو «صفر بيانات مصنَّفة مخزَّنة بلا تشفير»، وهذا الحاجز هو
// موضع قياسه، فخمس قواعد:
//
//   R1 — تماسك السياسة مع سلّم التصنيف: كل مرتبة `encryptAtRest` لها مفتاح
//        معلَن، وكل مفتاح معلَن يحيل إلى مرتبةٍ قائمة تحتاج تشفيراً. (يُقاس
//        بتحميل السياسة نفسها، فالتحميل يرفض الانحراف.)
//   R2 — لا مادةَ مفتاح في الإعداد: لا مفتاح ولا سرّ base64/hex في أي ملف إعداد
//        تشفير. مفتاحٌ في المستودع مفتاحٌ منشور، والتشفير حينها تنكّرٌ لا حماية.
//   R3 — كل كاتبٍ معلَن يُغلّف فعلاً: كل `writer` في `stores` يجب أن يستدعي
//        `seal(`. فبيانٌ يقول «هذا المخزن مشفَّر» وكودُه يكتب نصّاً هو أسوأ من
//        بيانٍ لا يقول شيئاً، لأنه يُقرأ ضماناً.
//   R4 — لا كتابة نصّية باقية في مسار الكاتب: لا `content: { value:` في أي كاتب
//        معلَن — وهو الشكل القديم بعينه، فبقاؤه يعني مساراً جانبياً حول التغليف.
//   R5 — **فحص المخزون**: إن وُجدت `DATABASE_URL` فُيقرأ كل صفٍّ في كل مخزنٍ
//        معلَن ويُقاس عليه `scanForPlaintextAtRest`. صفٌّ واحد بلا غلاف = خروج 1.
//        وبلا `DATABASE_URL` يُعلَن الفحص **متروكاً** صراحةً ولا يُدّعى نجاحه:
//        حاجزٌ يقول «✅» وهو لم يقرأ قاعدةً هو ادّعاء دليل (المادة 2).
//
// رمز الخروج 1 عند أي مخالفة، ولا يُسكت الحاجز ببيئةٍ ولا بوسيط.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadClassificationLattice } from '../src/data/classification.mjs';
import {
  assertNoKeyMaterial,
  loadEncryptionPolicy,
  scanForPlaintextAtRest,
} from '../src/data/encryption.mjs';

// `--root` يسمح بتشغيل الحاجز على شجرة أخرى، وهو ما يجعل **الحاجز نفسه** قابلاً
// للاختبار: اختبارٌ ينسخ الشجرة ويزرع فيها كاتباً لا يُغلّف ويقيس أن الحاجز يفشل.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const skipped = [];

// ── R1: تماسك السياسة مع السلّم ──
// التحميل نفسه هو الفحص: `loadEncryptionPolicy` يرفض مرتبةً تُشفَّر بلا مفتاح،
// ومفتاحاً لمرتبةٍ لا تُشفَّر، ومفتاحين باسمٍ واحد. فلا تُكرَّر القواعد هنا كي لا
// تنحرف نسخةُ الحاجز عن نسخة الكود — وهو الانحراف الذي يحرسه R4 في حاجز التفويض.
const lattice = loadClassificationLattice({ dir: path.join(ROOT, 'config') });
const policy = loadEncryptionPolicy({ dir: path.join(ROOT, 'config'), lattice });

/** @type {string[]} */
const encryptedTiers = [];
for (const tier of lattice.tiers) {
  if (lattice.requiresEncryption(tier.id)) encryptedTiers.push(tier.id);
}

// ── R2: لا مادة مفتاح في الإعداد ──
// `assertNoKeyMaterial` يفحص الشكل لا الأسماء: أي نصٍّ يشبه مادة مفتاح
// (base64/hex بطول ≥ 32) في أي موضع يُرفض. وحقلٌ اسمه `note` يحمل مفتاحاً يُكشف
// كما يُكشف حقلٌ اسمه `key`.
for (const file of ['encryption.yaml', 'classification.yaml']) {
  const full = path.join(ROOT, 'config', file);
  if (!fs.existsSync(full)) continue;
  try {
    // النصّ الخام يُفحص سطراً سطراً: التحليل يُسقط التعليقات، ومفتاحٌ في تعليق
    // مفتاحٌ منشور كالذي في حقل.
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, index) => {
      assertNoKeyMaterial(line, `${file}:${index + 1}`);
    });
  } catch (error) {
    violations.push(`R2: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── R3 و R4: الكاتب المُعلَن يُغلّف، ولا كتابة نصّية باقية ──
for (const store of policy.stores) {
  const writerPath = path.join(ROOT, store.writer);
  if (!fs.existsSync(writerPath)) {
    violations.push(
      `R3: المخزن «${store.name}» يُعلن كاتبه «${store.writer}» ولا وجود للملف. بيانٌ يشير إلى كاتبٍ غير موجود لا يحرس شيئاً.`,
    );
    continue;
  }
  const source = fs.readFileSync(writerPath, 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  if (!/\.seal\(/.test(code)) {
    violations.push(
      `R3: كاتب المخزن «${store.name}» (${store.writer}) لا يستدعي seal( — البيان يَعِد بتغليفٍ والكودُ لا يُغلّف.`,
    );
  }
  if (/content:\s*\{\s*value:/.test(code)) {
    violations.push(
      `R4: كاتب المخزن «${store.name}» (${store.writer}) ما زال يكتب content: { value: … } نصّاً صريحاً.`,
    );
  }
  if (store.dbConstraint !== undefined && store.dbConstraint !== '') {
    // القيد المُعلَن يجب أن يوجد في هجرةٍ ما: قيدٌ مذكور في البيان وغير مُنشأ في
    // القاعدة يُقرأ ضماناً وهو معدوم.
    const migrationsDir = path.join(ROOT, 'migrations');
    const declared = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.up.sql'))
      .some((name) =>
        fs.readFileSync(path.join(migrationsDir, name), 'utf8').includes(store.dbConstraint),
      );
    if (!declared) {
      violations.push(
        `R3: القيد «${store.dbConstraint}» معلَن للمخزن «${store.name}» ولا هجرة تُنشئه.`,
      );
    }
  }
}

// ── R5: فحص المخزون الفعلي ──
const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  // الترك مُعلَن لا مسكوت عنه: هذا هو الفرق بين «لم يُقَس» و«قِيس فنجح».
  skipped.push(
    'R5: فحص المخزون متروك — لا DATABASE_URL. فحص القبول «صفر بيانات مصنَّفة مخزَّنة بلا تشفير» لم يُقَس على قاعدة في هذا التشغيل، ويُقاس في CI حيث القاعدة قائمة.',
  );
} else {
  const { Pool } = await import('pg');
  const { resolveDatabaseConfig } = await import('../src/persistence/db.mjs');
  // الوصلة تمرّ بنفس الحرس الذي يمرّ به التشغيل، فالحاجز لا يفتح وصلةً نصّية
  // إلى مضيفٍ على الشبكة كي «يفحص التشفير».
  resolveDatabaseConfig({ url: databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const store of policy.stores) {
      const [schema, table] = store.name.split('.');
      // التصنيف يسكن `state.data_assets`، فيُضَمّ لقياس مطابقة مفتاح الغلاف
      // لمرتبة الأصل اليوم — لا لتخزينه ثانياً في جدول المادة.
      const { rows } = await pool.query(
        `SELECT m.id::text AS id, m.${store.field} AS content, a.classification AS classification
           FROM ${schema}.${table} m
           LEFT JOIN state.data_assets a ON a.id = m.dataset_id`,
      );
      const result = scanForPlaintextAtRest({
        rows: /** @type {Array<{ id: string, content: unknown, classification?: string | null }>} */ (
          rows
        ),
        store: store.name,
      });
      for (const violation of result.violations) {
        violations.push(`R5: ${violation.reason} (المعرّف ${violation.id})`);
      }
      console.log(`   • ${store.name}: فُحص ${result.scanned} صفّاً.`);
    }
  } finally {
    await pool.end();
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز التشفير: مادةٌ مصنَّفة قد تكون مخزَّنة أو منقولة بلا تشفير.');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

for (const note of skipped) console.log(`⚠️  ${note}`);
console.log(
  `✅ حاجز التشفير: ${encryptedTiers.length} مرتبةً تُشفَّر (${encryptedTiers.join('، ')})، و${policy.stores.length} مخزناً معلَناً بكاتبٍ يُغلّف.`,
);
