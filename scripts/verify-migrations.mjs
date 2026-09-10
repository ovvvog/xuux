#!/usr/bin/env node
// أداةُ برهانِ انعكاسِ الهجرات — الخطوة `M3.03`
//
// تُنشئُ قاعدةً معزولةً على الخادمِ المُعلَنِ في `DATABASE_URL`، وتُثبتُ على كلِّ
// هجرةٍ **على حدة** أنّ `up` يُغيّرُ المخطَّطَ وأنّ `down` يُعيدُه حرفاً بحرف،
// ثمّ تُسقطُ القاعدةَ ولو أخفقَ الفحص. تُنهي بـ1 عندَ أوّلِ إخفاق.
//
// الاستخدام:
//   npm run verify:migrations                 برهانٌ وطبعٌ على الطرفية
//   npm run verify:migrations -- --out FILE.md   كتابةُ تقريرِ دليل
//   npm run verify:migrations -- --json out.json           كتابةُ الوقائعِ خاماً
//   npm run verify:migrations -- --keep                    إبقاءُ القاعدةِ للتقصّي
//
// القاعدةُ تُنشَأُ ولا يُشتغَلُ على قاعدةِ الوصلةِ نفسِها: البرهانُ يُسقطُ
// المخطَّطاتِ ويُعيدُ إنشاءَها عشراتِ المرّات، وتشغيلُه على قاعدةٍ فيها بيانات
// إتلافٌ لا فحص.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createPool, resolveDatabaseConfig } from '../src/persistence/db.mjs';
import { proveReversibility } from '../src/persistence/reversibility.mjs';

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
 * اقتباسُ معرّفٍ بأسلوبِ PostgreSQL — اسمُ القاعدةِ مولَّدٌ هنا ولا يأتي من
 * مُدخلٍ خارجي، ويُقتبَسُ مع ذلك فلا يُبنى نصُّ استعلامٍ بلا اقتباس.
 * @param {string} identifier
 * @returns {string}
 */
function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * @param {import('../src/persistence/reversibility.mjs').ReversibilityReport} report
 * @returns {string}
 */
function renderMarkdown(report) {
  const lines = [];
  lines.push('# دليلُ انعكاسِ الهجرات — المسار `M3`، الخطوة `M3.03`');
  lines.push('');
  lines.push('وُلِّدَ هذا الملفُّ آلياً بـ`npm run verify:migrations`. لا يُحرَّرُ يدوياً:');
  lines.push('تحريرُه يجعلُ الدليلَ ادّعاءً، والمادّةُ 2 من القاعدةِ الحاكمةِ تمنعُه.');
  lines.push('');
  lines.push('## ظرفُ التشغيل');
  lines.push('');
  lines.push(`- **الخادم**: \`${report.server}\``);
  lines.push(`- **القاعدةُ المعزولة**: \`${report.database}\``);
  lines.push(`- **وقتُ البدء**: \`${report.startedAt}\``);
  lines.push(`- **المدّة**: ${report.durationMs} مللي ثانية`);
  lines.push(`- **الهجراتُ المفحوصة**: ${report.passed}/${report.total}`);
  lines.push(`- **الحكم**: ${report.ok ? '✅ اجتازت جميعُها' : '⛔ إخفاق'}`);
  lines.push('');
  lines.push('## الأحكامُ الأربعةُ لكلِّ هجرة');
  lines.push('');
  lines.push('| الحكم | معناه |');
  lines.push('| --- | --- |');
  lines.push('| `انعكاس` | صورةُ الكتالوجِ بعدَ `down` تُطابقُ صورتَها قبلَ `up` حرفاً بحرف. |');
  lines.push('| `أثر` | `up` غيّرَ الكتالوجَ فعلاً — يمنعُ مرورَ هجرةٍ فارغةٍ بتراجعٍ فارغ. |');
  lines.push('| `حتمية` | إعادةُ `up` بعدَ `down` تُنتجُ المخطَّطَ نفسَه. |');
  lines.push(
    '| `دفتر` | `schema_migrations` سجّلَ الرقمَ عندَ التقديمِ وحذفَه عندَ التراجعِ ولم يمسَّ غيرَه. |',
  );
  lines.push('');
  lines.push('## الوقائع');
  lines.push('');
  lines.push(
    '| # | الهجرة | انعكاس | أثر | حتمية | دفتر | up | down | بصمة قبل | بصمة بعد up | بصمة بعد down |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const check of report.checks) {
    const mark = (/** @type {boolean} */ value) => (value ? '✅' : '⛔');
    lines.push(
      `| ${String(check.version).padStart(4, '0')} | \`${check.name}\` | ${mark(check.reversible)} | ` +
        `${mark(check.effective)} | ${mark(check.deterministic)} | ${mark(check.bookkeeping)} | ` +
        `${check.upMs}ms | ${check.downMs}ms | \`${check.digests.before}\` | ` +
        `\`${check.digests.afterUp}\` | \`${check.digests.afterDown}\` |`,
    );
  }
  lines.push('');
  const failed = report.checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    lines.push('## الفروقُ عندَ الإخفاق');
    lines.push('');
    for (const check of failed) {
      lines.push(`### ${String(check.version).padStart(4, '0')} \`${check.name}\``);
      lines.push('');
      if (check.diff.length === 0) {
        lines.push('لا فرقَ في الكتالوج؛ الإخفاقُ في حكمٍ آخرَ (أثر أو حتمية أو دفتر).');
      }
      for (const diff of check.diff) {
        lines.push(`- قسمُ \`${diff.section}\`:`);
        for (const row of diff.added) lines.push(`  - **بقيَ بعدَ التراجع**: \`${row}\``);
        for (const row of diff.removed) lines.push(`  - **فُقِدَ بالتراجع**: \`${row}\``);
      }
      lines.push('');
    }
  }
  lines.push('## حدودُ هذا الدليل');
  lines.push('');
  lines.push('- الصورةُ تصفُ **بنيةَ** القاعدةِ لا بياناتِها: انعكاسُ المخطَّطِ مُبرهَنٌ،');
  lines.push('  وحفظُ البياناتِ عبرَ التراجعِ **ليس** مُبرهَناً هنا ولا يُدَّعى.');
  lines.push('- الفحصُ يجري على قاعدةٍ فارغةٍ معزولة؛ سلوكُ التراجعِ على قاعدةٍ');
  lines.push('  عامرةٍ بالبياناتِ قد يختلفُ بقيودِ المفاتيحِ الأجنبية.');
  lines.push('- صلاحياتُ الأدوارِ ومتسلسلاتُ الهويةِ خارجَ الصورةِ عمداً.');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const out = stringFlag(argv, '--out');
  const jsonOut = stringFlag(argv, '--json');
  const keep = argv.includes('--keep');

  // الوصلةُ تُحلُّ أوّلاً بسياسةِ المشروعِ نفسِها (TLS ومخطَّطٌ مسموح)، فلا
  // تُنشَأُ قاعدةٌ على وصلةٍ ترفضُها السياسةُ ثمّ يُكتشَفُ الرفضُ بعدَ الإنشاء.
  const { url } = resolveDatabaseConfig();
  const name = `state_verify_${crypto.randomBytes(4).toString('hex')}`;

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

  /** @type {import('../src/persistence/reversibility.mjs').ReversibilityReport | undefined} */
  let report;
  try {
    report = await proveReversibility(pool, {
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

  // الحارسُ صريحٌ لا شكليّ: لو خرجَ البرهانُ برميةٍ لَما وصلَ التنفيذُ هنا،
  // لكنّ إعلانَ الاحتمالِ خيرٌ من قراءةِ حقلٍ على قيمةٍ قد تكونُ غائبة.
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
      ? `✅ ${report.passed}/${report.total} هجرة: كلٌّ منها تُقدَّمُ وتُتراجَعُ فتعودُ القاعدةُ كما كانت.`
      : `⛔ ${report.passed}/${report.total} هجرة اجتازت — راجعِ الفروقَ أعلاه.`,
  );
  return report.ok;
}

// رمزُ الخروجِ يُضبَطُ خارجَ الدالّةِ غيرِ المتزامنة: ضبطُه بعدَ `await` داخلَها
// قد يُكتَبُ على حالةٍ فاتَها التحديث (`require-atomic-updates`).
main()
  .then((ok) => {
    if (!ok) process.exitCode = 1;
  })
  .catch((/** @type {unknown} */ error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`⛔ ${message}`);
    process.exitCode = 1;
  });
