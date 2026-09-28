// مجسُّ `S13` للجولةِ السادسةِ من `M11.04` — شواهدُ `WL-278`.
//
// المقيسُ ليسَ «هل يعملُ المجسُّ» بل عيوبُه الأربعةُ التي رفعَها المجلسُ:
//   - `R6-CS-02`/`R6-LU-01`: الاستيرادُ مُطلَقٌ فيَقيسُ شجرةً غيرَ نسخةِ المُشغِّل.
//   - `R6-CS-01`/`R6-LU-02`: الحكمُ ثنائيٌّ فيُخفي تجاوزاً جزئيّاً (ثلاثةٌ من خمسةٍ ⇒ `BLOCKED`).
//   - `R6-LU-03`: رمزُ الخروجِ صفرٌ أيّاً كانَ الحكمُ.
// وكلُّ اختبارٍ هنا يسقطُ على نسخةِ المجسِّ التي قاسَها المجلسُ (الكائنُ `607daf0e`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROBE_URL = new URL(
  '../../docs/external-review/evidence/M11.04-round-6-s13-probe.mjs',
  import.meta.url,
);
const PROBE_TEXT = readFileSync(PROBE_URL, 'utf8');
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('R6-CS-02/R6-LU-01: لا استيرادَ من مسارٍ مُطلَقٍ، والجذرُ المقيسُ هو نسخةُ الملفِّ', async () => {
  assert.equal(
    /from\s+['"]\/|import\(\s*['"]\//.test(PROBE_TEXT),
    false,
    'استيرادٌ مُطلَقٌ يَقيسُ شجرةً غيرَ نسخةِ المُشغِّل',
  );
  assert.equal(PROBE_TEXT.includes('/home/user/'), false, 'لا مسارَ مُثبَّتٌ لبيئةٍ بعينِها');
  const probe = await import(PROBE_URL.href);
  assert.equal(probe.REPO, REPO_ROOT);
});

test('R6-CS-01/R6-LU-02: ثلاثةُ بنودٍ من خمسةٍ حكمُها `PARTIAL` مُسمّاةً — لا `BLOCKED`', async () => {
  const { gradeReplay } = await import(PROBE_URL.href);
  // أرقامُ `S13` كما قاسَها المجلسُ على `main@1648d450`.
  const graded = gradeReplay({
    haltState: { state: 'halted', epoch: 1 },
    advanced: { sequence: 8, ledgerCommitted: 1 },
    after: { sequence: 4, ledgerCommitted: 0 },
    replay: 'ACCEPTED_NO_THROW',
  });
  assert.equal(graded.verdict, 'PARTIAL');
  assert.deepEqual(graded.achieved, [
    'sequence-rolled-back',
    'ledger-rolled-back',
    'committed-command-replayed',
  ]);
  const full = gradeReplay({
    haltState: { state: 'running', epoch: 0 },
    advanced: { sequence: 6, ledgerCommitted: 1 },
    after: { sequence: 4, ledgerCommitted: 0 },
    replay: 'ACCEPTED_NO_THROW',
  });
  assert.equal(full.verdict, 'VIABLE');
  const none = gradeReplay({
    haltState: { state: 'halted', epoch: 1 },
    advanced: { sequence: 8, ledgerCommitted: 1 },
    after: { sequence: 8, ledgerCommitted: 1 },
    replay: 'THROWN:LEDGER_REPLAY',
  });
  assert.equal(none.verdict, 'BLOCKED');
  assert.equal(PROBE_TEXT.includes("record('S13',"), false, 'الاسمُ `S13` الملتبسُ لا يُطبَع');
});

test('R6-LU-03: رمزُ الخروجِ يَحرُسُ الحكمَ — صفرٌ لكلِّ `BLOCKED` وحدَه', async () => {
  const { exitCodeFor } = await import(PROBE_URL.href);
  assert.equal(exitCodeFor([{ verdict: 'BLOCKED' }, { verdict: 'BLOCKED' }]), 0);
  assert.equal(exitCodeFor([{ verdict: 'BLOCKED' }, { verdict: 'PARTIAL' }]), 1);
  assert.equal(exitCodeFor([{ verdict: 'VIABLE' }]), 1);
  assert.equal(exitCodeFor([{ verdict: 'BOOTED' }]), 1, 'ضابطٌ أقلعَ بلا رفضٍ ليسَ نجاحاً');
  assert.equal(exitCodeFor([{ verdict: 'UNEXPECTED-BOOT' }]), 1);
  assert.equal(exitCodeFor([]), 2, 'لا شيءَ مقيسٌ ليسَ صفراً');
});
