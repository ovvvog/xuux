#!/usr/bin/env node
/**
 * كاتبُ المختبرِ المُسيَّج (`WL-532` §5): عمليةٌ تعملُ **بمستخدمِ نظامِ العامل** (`sudo -u xuuxw-*`)
 * وتسلكُ مسارَ العاملِ الحقيقيّ: مجمّعُ `pg` بدورِ الإقلاع (peer، بلا سرّ)، ختمُ كلِّ وصلاتِه
 * بمفتاحِ العاملِ (`sealFencedPool`)، التحقّقُ (`assertFencedSession`)، ثمّ كتابةٌ متواصلةٌ حتى
 * ترفضَها القاعدة.
 *
 * ملفٌّ منفصلٌ عن `scripts/fence-lab.mjs` عمداً: يُنسَخُ وحدَه (مع `src/` واعتمادِ `pg`) إلى
 * مجلّدٍ يقرؤه مستخدمُ العامل، فلا يحتاجُ مستخدمُ العاملِ قراءةَ المستودعِ ولا يُحمِّلُ شيفرةَ
 * المختبرِ (initdb، sudo، التقرير) في عمليةٍ بصلاحيةٍ أخرى.
 *
 * الدخل: وسيطٌ واحدٌ JSON بـbase64url:
 *   { sock, port, database, role, workerId, bootId, epoch, sysid, keyFile, poolSize, writer,
 *     sealOnly? }
 * الخرج: أسطرُ JSON على stdout بنوعِ رسائلِ IPC نفسِها (`xuux-fence/sealed` | `xuux-fence/seal-failed`)
 * ثمّ `{type:'stopped', committed, code, message}`. لا يقرأُ المُشرِفُ إلا هذه الأسطر.
 */

import pg from 'pg';

import { assertFencedSession, fileKeyProvider, sealFencedPool } from '../src/fence/db-fence.mjs';

const input = JSON.parse(Buffer.from(String(process.argv[2] ?? ''), 'base64url').toString('utf8'));
/** @param {Record<string, unknown>} m */
const emit = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

const pool = new pg.Pool({
  host: input.sock,
  port: input.port,
  user: input.role,
  database: input.database,
  max: input.poolSize,
  idleTimeoutMillis: 0,
});
pool.on('error', () => {});

let committed = 0;
try {
  const key = fileKeyProvider(input.keyFile);
  let sessions;
  try {
    sessions = await sealFencedPool(pool, input.poolSize, key, {
      db: input.database,
      sysid: input.sysid,
      workerId: input.workerId,
      bootId: input.bootId,
      epoch: input.epoch,
      roleName: input.role,
    });
  } catch (error) {
    emit({
      type: 'xuux-fence/seal-failed',
      role_name: input.role,
      reason: error instanceof Error ? error.message : String(error),
    });
    process.exit(4);
  }
  emit({ type: 'xuux-fence/sealed', role_name: input.role, sessions, pid: process.pid });
  await assertFencedSession(pool, { workerId: input.workerId, bootId: input.bootId });
  if (input.sealOnly === true) {
    // يبقى حيّاً (وصلاتُه مختومةٌ مفتوحة) حتى يُنهيه المختبر.
    await new Promise(() => {});
  }
  for (;;) {
    await pool.query('INSERT INTO state.lab_probe(writer) VALUES ($1)', [input.writer]);
    committed++;
    await new Promise((r) => setTimeout(r, 5));
  }
} catch (error) {
  emit({
    type: 'stopped',
    committed,
    code: /** @type {any} */ (error)?.code ?? null,
    message: error instanceof Error ? error.message.slice(0, 200) : String(error),
  });
  await pool.end().catch(() => {});
  process.exit(3);
}
