#!/usr/bin/env node
// أداةُ برهانِ حفظِ البياناتِ عبرَ الهجرات — الخطوة `M3.03`
//
// تُنشئُ قاعدةً معزولةً على الخادمِ المُعلَنِ في `DATABASE_URL`، وتملؤها بمدوَّنةِ
// بياناتٍ تمثيليةٍ مستوىً بعدَ مستوىً كلَّما أتاحَ المخطَّطُ جداولَها، ثمّ تُثبتُ
// على كلِّ هجرةٍ **على حدة** أنّ `up` ثمّ `down` يُعيدانِ الصفوفَ كما كانت
// حرفاً بحرف، وأنّ الهجراتِ التي تُعلنُ الرفضَ ترفضُ بلا إتلاف. ثمّ تُسقطُ
// القاعدةَ ولو أخفقَ الفحص، وتُنهي بـ1 عندَ أوّلِ إخفاق.
//
// الاستخدام:
//   npm run verify:data                            برهانٌ وطبعٌ على الطرفية
//   npm run verify:data -- --out FILE.md           كتابةُ تقريرِ دليل
//   npm run verify:data -- --json out.json         كتابةُ الوقائعِ خاماً
//   npm run verify:data -- --keep                  إبقاءُ القاعدةِ للتقصّي
//
// القاعدةُ تُنشَأُ ولا يُشتغَلُ على قاعدةِ الوصلةِ نفسِها: البرهانُ يزرعُ ويحذفُ
// ويُسقطُ المخطَّطَ عشراتِ المرّات، وتشغيلُه على قاعدةٍ فيها بياناتٌ إتلافٌ لا فحص.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { proveDataPreservation } from '../src/persistence/data-preservation.mjs';
import { createPool, resolveDatabaseConfig } from '../src/persistence/db.mjs';

/**
 * @param {string[]} argv
 * @param {string} flag
 * @returns {string | undefined}
 */
function stringFlag(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`الرايةُ ${flag} تحتاجُ قيمةً بعدَها.`);
  }
  return value;
}

/**
 * @param {string} identifier
 * @returns {string}
 */
function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * @param {import('../src/persistence/data-preservation.mjs').PreservationReport} report
 * @returns {string}
 */
function renderMarkdown(report) {
  const mark = (/** @type {boolean} */ value) => (value ? '✅' : '⛔');
  const lines = [];
  lines.push('# دليلُ حفظِ البياناتِ عبرَ الهجرات — المسار `M3`، الخطوة `M3.03`');
  lines.push('');
  lines.push('وُلِّدَ هذا الملفُّ آلياً بـ`npm run verify:data`. لا يُحرَّرُ يدوياً:');
  lines.push('تحريرُه يجعلُ الدليلَ ادّعاءً، والمادّةُ 2 من القاعدةِ الحاكمةِ تمنعُه.');
  lines.push('');
  lines.push('## ظرفُ التشغيل');
  lines.push('');
  lines.push(`- **الخادم**: \`${report.server}\``);
  lines.push(`- **القاعدةُ المعزولة**: \`${report.database}\``);
  lines.push(`- **وقتُ البدء**: \`${report.startedAt}\``);
  lines.push(`- **المدّة**: ${report.durationMs} مللي ثانية`);
  lines.push(`- **الهجراتُ المفحوصة**: ${report.passed}/${report.total}`);
  lines.push(`- **أقصى حمولةٍ أثناءَ الفحص**: ${report.peakRows} صفّاً`);
  lines.push(`- **مواضعُ الرفضِ المُعلَنِ المُثبَتة**: ${report.refusals}`);
  lines.push(`- **الحكم**: ${report.ok ? '✅ لم يُفقَد صفٌّ ولم يتبدّل' : '⛔ إخفاق'}`);
  lines.push('');
  lines.push('## الأحكامُ لكلِّ هجرة');
  lines.push('');
  lines.push('| الحكم | معناه |');
  lines.push('| --- | --- |');
  lines.push(
    '| `مأهولة` | القاعدةُ كانت فيها صفوفٌ فعلاً حينَ فُحِصَت — يمنعُ برهاناً على الفراغ. |',
  );
  lines.push('| `حفظ` | صفوفُ القاعدةِ بعدَ `down` تُطابقُ صفوفَها قبلَ `up` قيمةً قيمة. |');
  lines.push('| `حتمية` | إعادةُ `up` بعدَ `down` تُنتجُ البياناتِ نفسَها. |');
  lines.push('| `مخطَّط` | الكتالوجُ عادَ كما كان — شاهدٌ مُلازمٌ لا يُغني عنه حفظُ الصفوف. |');
  lines.push('| `رفض` | الهجرةُ التي تُعلنُ الرفضَ رفضت برسالتِها ولم تُتلِفْ صفّاً. |');
  lines.push('');
  lines.push('## الوقائع');
  lines.push('');
  lines.push(
    '| # | الهجرة | صفوفٌ قبلها | مأهولة | حفظ | حتمية | مخطَّط | رفض | بصمة قبل | بصمة بعد down |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const check of report.checks) {
    lines.push(
      `| ${String(check.version).padStart(4, '0')} | \`${check.name}\` | ${check.rowsBefore} | ` +
        `${mark(check.nonEmpty)} | ${mark(check.preserved)} | ${mark(check.deterministic)} | ` +
        `${mark(check.schemaReversible)} | ${check.refusal ? mark(check.refusal.ok) : '—'} | ` +
        `\`${check.digests.before}\` | \`${check.digests.afterDown}\` |`,
    );
  }
  lines.push('');
  const withRefusal = report.checks.filter((check) => check.refusal !== null);
  if (withRefusal.length > 0) {
    lines.push('## مواضعُ الرفضِ المُعلَن');
    lines.push('');
    for (const check of withRefusal) {
      const refusal = /** @type {NonNullable<typeof check.refusal>} */ (check.refusal);
      lines.push(`- **${String(check.version).padStart(4, '0')}** — ${refusal.title}:`);
      lines.push(
        `  رفضت ${mark(refusal.refused)} · بالرسالةِ المُعلَنة ${mark(refusal.declared)} · ` +
          `بلا إتلاف ${mark(refusal.atomic)}`,
      );
      if (refusal.message !== '') lines.push(`  - نصُّ الرفض: \`${refusal.message}\``);
    }
    lines.push('');
  }
  const dropped = report.checks.filter((check) => check.droppedColumns.length > 0);
  if (dropped.length > 0) {
    lines.push('## الفقدانُ المقصودُ المُعلَن');
    lines.push('');
    lines.push('أعمدةٌ أسقطَتها الهجرةُ عمداً؛ تُذكَرُ لأنّ خلطَها بالفقدانِ العَرَضيِّ يُفسدُ');
    lines.push('البرهانَ في الاتجاهَين — إمّا بإخفاءِ عطلٍ أو بإنذارٍ كاذبٍ يُسكَت.');
    lines.push('');
    for (const check of dropped) {
      lines.push(
        `- **${String(check.version).padStart(4, '0')}** \`${check.name}\`: ` +
          check.droppedColumns.map((column) => `\`${column}\``).join('، '),
      );
    }
    lines.push('');
  }
  const failed = report.checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    lines.push('## الفروقُ عندَ الإخفاق');
    lines.push('');
    for (const check of failed) {
      lines.push(`### ${String(check.version).padStart(4, '0')} \`${check.name}\``);
      lines.push('');
      if (check.diff.length === 0) {
        lines.push('لا فرقَ في الصفوف؛ الإخفاقُ في حكمٍ آخرَ (حتمية أو مخطَّط أو رفض).');
      }
      for (const diff of check.diff) {
        lines.push(`- جدولُ \`${diff.table}\` (${diff.kind}):`);
        for (const row of diff.lost) lines.push(`  - **فُقِدَ بالتراجع**: \`${row}\``);
        for (const row of diff.gained) lines.push(`  - **ظهرَ بالتراجع**: \`${row}\``);
      }
      lines.push('');
    }
  }
  lines.push('## حدودُ هذا الدليل');
  lines.push('');
  for (const limit of report.limits) lines.push(`- ${limit}`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const out = stringFlag(argv, '--out');
  const jsonOut = stringFlag(argv, '--json');
  const keep = argv.includes('--keep');

  const { url } = resolveDatabaseConfig();
  const name = `state_data_${crypto.randomBytes(4).toString('hex')}`;

  const admin = createPool({ max: 1 });
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }
  console.log(`قاعدةُ الفحصِ المعزولة: ${name}`);

  const target = new URL(url.toString());
  target.pathname = `/${name}`;
  const pool = createPool({ url: target.toString(), max: 4 });

  /** @type {import('../src/persistence/data-preservation.mjs').PreservationReport | undefined} */
  let report;
  try {
    report = await proveDataPreservation(pool, {
      onProgress: (line) => {
        console.log(line);
      },
    });
  } finally {
    await pool.end().catch(() => undefined);
    if (keep) {
      console.log(`⚠️ أُبقيت القاعدةُ ${name} بطلبِ --keep؛ أسقِطها يدوياً.`);
    } else {
      const cleaner = createPool({ max: 1 });
      try {
        await cleaner.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
        console.log(`أُسقطت قاعدةُ الفحص: ${name}`);
      } finally {
        await cleaner.end();
      }
    }
  }

  if (report === undefined) throw new Error('لم يُنتِجِ البرهانُ تقريراً.');

  if (out !== undefined) {
    const file = path.resolve(out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${renderMarkdown(report)}`, 'utf8');
    console.log(`التقرير: ${out}`);
  }
  if (jsonOut !== undefined) {
    const file = path.resolve(jsonOut);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`الوقائعُ الخام: ${jsonOut}`);
  }

  console.log(
    report.ok
      ? `✅ ${report.passed}/${report.total} هجرة على قاعدةٍ مأهولةٍ بلغت ${report.peakRows} صفّاً: ` +
          `لم يُفقَد صفٌّ ولم تتبدّل قيمة، و${report.refusals} موضعَ رفضٍ مُعلَنٍ رفضت بلا إتلاف.`
      : `⛔ ${report.passed}/${report.total} هجرة اجتازت — راجعِ الفروقَ أعلاه.`,
  );
  return report.ok;
}

main()
  .then((ok) => {
    if (!ok) process.exitCode = 1;
  })
  .catch((/** @type {unknown} */ error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`⛔ ${message}`);
    process.exitCode = 1;
  });
