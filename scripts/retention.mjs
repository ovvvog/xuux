#!/usr/bin/env node
/**
 * أداة تشغيل سياسة الاحتفاظ — الخطوة `M3.08`.
 *
 * الاستخدام:
 *   node scripts/retention.mjs [plan]
 *   node scripts/retention.mjs purge [--table data_assets|memories|events] [--dry-run]
 *
 * الأمر بلا وسائط آمن: يعرض خطة جافة ولا ينفذ محواً.
 */

import { createPool } from '../src/persistence/db.mjs';
import { plan, purge } from '../src/persistence/retention.mjs';

/**
 * @typedef {{ command: 'plan' | 'purge', tables: string[] | undefined, dryRun: boolean }} Arguments
 */

/**
 * @param {string[]} argv
 * @returns {Arguments}
 */
function parseArguments(argv) {
  const first = argv[0];
  const command = first === undefined ? 'plan' : first;
  if (command !== 'plan' && command !== 'purge') {
    throw new Error(`RETENTION_ARGUMENT_INVALID: أمر غير معروف: ${command}. المدعوم plan|purge.`);
  }
  /** @type {string[]} */
  const tables = [];
  let dryRun = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--table') {
      const table = argv[index + 1];
      if (table === undefined || table.startsWith('--')) {
        throw new Error('RETENTION_ARGUMENT_INVALID: يجب أن يلي --table مفتاح جدول معلن.');
      }
      tables.push(table);
      index += 1;
      continue;
    }
    throw new Error(`RETENTION_ARGUMENT_INVALID: وسيط غير معروف: ${String(argument)}.`);
  }
  if (command === 'plan' && (tables.length > 0 || dryRun)) {
    throw new Error(
      'RETENTION_ARGUMENT_INVALID: plan لا يقبل --table أو --dry-run لأنه جاف دائماً.',
    );
  }
  return { command, tables: tables.length === 0 ? undefined : tables, dryRun };
}

/**
 * @param {{ table: string, eligible: number, legalHoldProtected: number, deleted?: number }} row
 * @returns {string}
 */
function formatRow(row) {
  const deleted = row.deleted === undefined ? '' : `، المحذوف=${row.deleted}`;
  return `- ${row.table}: المؤهل=${row.eligible}، المحمي_قانوناً=${row.legalHoldProtected}${deleted}`;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const pool = createPool();
  try {
    const now = new Date();
    if (arguments_.command === 'plan') {
      const report = await plan(pool, { now });
      console.log(`تقرير احتفاظ جاف عند ${report.now.toISOString()}:`);
      for (const row of report.tables) console.log(formatRow(row));
      return;
    }
    const report = await purge(pool, {
      now,
      ...(arguments_.tables === undefined ? {} : { tables: arguments_.tables }),
      dryRun: arguments_.dryRun,
    });
    console.log(
      report.dryRun
        ? `محاكاة محو عند ${report.now.toISOString()}:`
        : `محو احتفاظ مكتمل عند ${report.now.toISOString()}:`,
    );
    for (const row of report.tables) console.log(formatRow(row));
  } finally {
    await pool.end();
  }
}

main().catch((/** @type {unknown} */ error) => {
  const message = error instanceof Error ? error.message : String(error);
  const source = /** @type {Record<string, unknown>} */ (
    typeof error === 'object' && error !== null ? error : {}
  );
  const code = typeof source['code'] === 'string' ? source['code'] : 'RETENTION_FAILED';
  console.error(`[${code}] ${message}`);
  process.exitCode = 1;
});
