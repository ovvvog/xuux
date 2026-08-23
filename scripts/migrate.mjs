#!/usr/bin/env node
// أداة الهجرات — الخطوة M3.03
//
// الاستخدام:
//   npm run migrate -- status        عرض حالة كل هجرة
//   npm run migrate -- up            تقديم كل ما لم يُطبَّق
//   npm run migrate -- up --to 1     تقديم حتى رقم معيّن
//   npm run migrate -- down          تراجع خطوة واحدة
//   npm run migrate -- down --steps 2
//
// الوصلة تُقرأ من DATABASE_URL وحدها. لا وصلة افتراضية ولا سقوط صامت إلى
// localhost (راجع src/persistence/db.mjs).

import { createPool } from '../src/persistence/db.mjs';
import { down, status, up } from '../src/persistence/migrator.mjs';

/**
 * @param {string[]} argv
 * @param {string} flag
 * @returns {number | undefined}
 */
function numberFlag(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const raw = argv[index + 1];
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 1) {
    throw new Error(`القيمة بعد ${flag} يجب أن تكون عدداً صحيحاً موجباً.`);
  }
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'status';
  const pool = createPool();
  try {
    switch (command) {
      case 'status': {
        const result = await status(pool);
        console.log(`النسخة الحالية: ${result.current}`);
        for (const row of result.rows) {
          const mark = row.isApplied ? '✅' : '⬜';
          const when = row.appliedAt === null ? '' : ` — ${row.appliedAt.toISOString()}`;
          console.log(`${mark} ${String(row.version).padStart(4, '0')} ${row.name}${when}`);
        }
        return;
      }
      case 'up': {
        const to = numberFlag(argv, '--to');
        const result = await up(pool, to === undefined ? {} : { to });
        console.log(
          result.applied.length === 0
            ? `لا هجرة جديدة. النسخة ${result.current}.`
            : `طُبِّقت: ${result.applied.join(', ')} ⇒ النسخة ${result.current}.`,
        );
        return;
      }
      case 'down': {
        const steps = numberFlag(argv, '--steps');
        const result = await down(pool, steps === undefined ? {} : { steps });
        console.log(`تُراجع عن: ${result.reverted.join(', ')} ⇒ النسخة ${result.current}.`);
        return;
      }
      default:
        throw new Error(`أمر غير معروف: ${command} — المدعوم status|up|down.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((/** @type {unknown} */ error) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = /** @type {Record<string, unknown>} */ (
    typeof error === 'object' && error !== null ? error : {}
  )['code'];
  console.error(`⛔ ${code === undefined ? '' : `[${String(code)}] `}${message}`);
  process.exitCode = 1;
});
