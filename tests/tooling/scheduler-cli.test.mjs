// اختبارُ مُشغِّلِ المُجدوِلِ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
//
// المُشغِّلُ هو الموضعُ الذي يصيرُ فيه العهدُ فعلاً، فيُقاسُ من الخارجِ كما
// يُشغِّلُه المُشغِّلُ: رمزُ خروجٍ، ونصٌّ يُقرأُ، وأرقامٌ في `--json`. و`--self-check`
// يُقاسُ بأنّه **يُخرِجُ براهينَه** لا بأنّه يقولُ «سليمٌ»: حكمٌ بلا أرقامٍ
// ادّعاءُ دليلٍ (المادة 2).

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'scripts', 'scheduler.mjs');

/**
 * @param {string[]} args
 * @returns {{ status: number, output: string }}
 */
function run(args) {
  const env = { ...process.env };
  // بلا `DATABASE_URL`: المقيسُ آليّةُ المُجدوِلِ لا اتّصالُ قاعدةٍ، والمُشغِّلُ
  // يُعلِنُ مصدرَه (`memory`) صراحةً فلا يُقرأُ الفحصُ كأنّه فحصُ قاعدةٍ.
  delete env['DATABASE_URL'];
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      timeout: 600_000,
    });
    return { status: 0, output };
  } catch (error) {
    const failure = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (error);
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

test('`--self-check` يُخرِجُ براهينَه مقيسةً ويخرجُ بصفرٍ', () => {
  const { status, output } = run(['--self-check', '--json']);
  assert.equal(status, 0, `فحصُ المُجدوِلِ الذاتيُّ سقطَ: ${output}`);
  const parsed =
    /** @type {{ ok: boolean, witnesses: Array<{ id: string, measured: Record<string, unknown> }> }} */ (
      JSON.parse(output)
    );
  assert.equal(parsed.ok, true);
  const byId = new Map(parsed.witnesses.map((witness) => [witness.id, witness.measured]));
  assert.equal(byId.size, parsed.witnesses.length, 'برهانٌ مكرَّرُ المعرِّفِ');
  assert.ok(Number(byId.get('W1')?.['handlerCalls']) >= 1, 'لم يُنادَ مُنفِّذٌ في نبضةٍ');
  const phases = /** @type {string[]} */ (byId.get('W2')?.['phases'] ?? []);
  assert.deepEqual([...phases].sort(), ['completed', 'dispatched']);
  assert.equal(byId.get('W3')?.['code'], 'SCHEDULER_SLOT_ALREADY_CLAIMED');
  assert.equal(byId.get('W4')?.['code'], 'SCHEDULER_HANDLER_MISSING');
  assert.deepEqual(byId.get('W4')?.['phasesAfter'], []);
  assert.equal(byId.get('W5')?.['code'], 'SCHEDULER_NOT_AUTHORIZED');
  assert.equal(byId.get('W6')?.['code'], 'SCHEDULER_AUTHORIZER_REQUIRED');
  assert.equal(byId.get('W7')?.['ok'], true);
});

test('`--once` يُطلِقُ الأعمالَ المستحقّةَ فعلاً ويُعلِنُ مصدرَ دفترِه', () => {
  const { status, output } = run(['--once', '--json']);
  assert.equal(status, 0, `النبضةُ الواحدةُ سقطت: ${output}`);
  const parsed =
    /** @type {{ source: string, dispatched: Array<{ jobId: string, outcome: string }>, refused: unknown[] }} */ (
      JSON.parse(output)
    );
  assert.equal(parsed.source, 'memory');
  assert.deepEqual(parsed.refused, []);
  assert.ok(parsed.dispatched.length >= 1, 'لم يُطلَقْ عملٌ مستحقٌّ');
  for (const entry of parsed.dispatched) {
    assert.equal(entry.outcome, 'completed', `عملٌ لم يكتملْ: ${JSON.stringify(entry)}`);
  }
  // والأعمالُ المُعلَنةُ في القيودِ كلُّها أُطلِقت: عملٌ مُعلَنٌ لا يُطلَقُ في
  // نبضةٍ على دفترٍ فارغٍ إمّا بلا مُنفِّذٍ أو بلا سياسةٍ تمنحُه — وكلاهما جدولةٌ
  // على الورقِ.
  const ids = parsed.dispatched.map((entry) => entry.jobId).sort();
  assert.deepEqual(ids, ['job:readiness-report', 'job:recovery-drill']);
});
