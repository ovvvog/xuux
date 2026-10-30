// @ts-nocheck
// tests/tooling/live-39-judge.test.mjs
//
// `WL-499` (‏`LIVE-39`) — أسنانُ دوالِّ الحكمِ في `scripts/lib/live-39-judge.sh`. خطوةُ CI
// «قياس LIVE-39 — القطع عند كل مرحلة» قياسٌ بقدرِ ما يُسقِطُ حكمُها المخالِفَ؛ هذا الاختبارُ
// يُغذّيها بنتائجَ مصطنعةٍ (‏بلا نواةٍ ولا أجهزةٍ) ويقيسُ أنّ كلَّ مخالفةٍ تُسقِطُ والسليمةَ تنجحُ،
// وأنّ غيابَ لقطةِ المرجعِ سقوطٌ لا ملاحظةٌ.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/lib/live-39-judge.sh');

/**
 * يُشغِّلُ أمرَ حكمٍ واحداً ويعيدُ عدّادَيه وسطرَه.
 * @param {string[]} args - اسمُ الدالةِ ثمّ وسائطُها
 * @returns {{checks: number, failures: number, out: string}}
 */
function judge(...args) {
  const script =
    'set -euo pipefail; CHECKS=0; FAILURES=0; source "$1"; shift; "$@"; ' +
    'echo "COUNTS ${CHECKS} ${FAILURES}"';
  const result = spawnSync('bash', ['-c', script, 'judge', LIB, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `الحكمُ نفسُهُ انهارَ: ${result.stderr}`);
  const match = /COUNTS (\d+) (\d+)/u.exec(result.stdout);
  assert.ok(match, `لا عدّادَ في المخرَجِ: ${result.stdout}`);
  return { checks: Number(match[1]), failures: Number(match[2]), out: result.stdout };
}

const COMMITTED = 'BOOT_OK STATE:cmd-cut=committed';
const UNKNOWN = 'BOOT_OK STATE:cmd-cut=unknown';
const REFUSED = 'BOOT_REFUSED:STALE_MANIFEST_EPOCH';

/** @param {string} label @param {string[]} args @param {boolean} pass */
function expectVerdict(label, args, pass) {
  const { checks, failures, out } = judge(...args);
  assert.equal(checks, 1, `${label}: حكمٌ واحدٌ متوقَّعٌ`);
  assert.equal(
    failures,
    pass ? 0 : 1,
    `${label}: ${pass ? 'يجبُ أن ينجحَ' : 'يجبُ أن يسقطَ'}\n${out}`,
  );
}

test('judge_cut: PL1 — القطعُ عندَ S5/ACK لا يقبلُ إلّا committed', () => {
  for (const stage of ['S5', 'ACK']) {
    expectVerdict(`${stage} committed`, ['judge_cut', '1', stage, stage, COMMITTED], true);
    expectVerdict(`${stage} unknown`, ['judge_cut', '1', stage, stage, UNKNOWN], false);
    expectVerdict(`${stage} refused`, ['judge_cut', '1', stage, stage, REFUSED], false);
  }
});

test('judge_cut: PL2 — قبلَ تقدّمِ المرجعِ لا التزامَ شبحيّاً', () => {
  for (const stage of ['S2', 'S3']) {
    expectVerdict(`${stage} unknown`, ['judge_cut', '1', stage, stage, UNKNOWN], true);
    expectVerdict(`${stage} committed`, ['judge_cut', '1', stage, stage, COMMITTED], false);
    expectVerdict(`${stage} refused`, ['judge_cut', '1', stage, stage, REFUSED], false);
  }
});

test('judge_cut: PL3 — المرجعُ متقدّمٌ: إكمالٌ أو رفضٌ مسمّى، لا قبولٌ صامتٌ ولا رفضٌ بلا اسمٍ', () => {
  for (const [stage, witness] of [
    ['S3', 'S4'],
    ['S4', 'S4'],
  ]) {
    expectVerdict('committed', ['judge_cut', '1', stage, witness, COMMITTED], true);
    expectVerdict('named refusal', ['judge_cut', '1', stage, witness, REFUSED], true);
    expectVerdict('silent rollback', ['judge_cut', '1', stage, witness, UNKNOWN], false);
    expectVerdict(
      'unnamed refusal',
      ['judge_cut', '1', stage, witness, 'BOOT_REFUSED:UNNAMED'],
      false,
    );
    expectVerdict('empty', ['judge_cut', '1', stage, witness, ''], false);
  }
});

test('judge_negative: PLN1/PLN2 — الشاهدُ السلبيُّ يجبُ أن يرى الفقدَ', () => {
  expectVerdict('S2 unknown', ['judge_negative', 'S2', 'S2', UNKNOWN], true);
  expectVerdict('S3 committed (blind)', ['judge_negative', 'S3', 'S3', COMMITTED], false);
  for (const stage of ['S4', 'S5', 'ACK']) {
    expectVerdict(`${stage} refused`, ['judge_negative', stage, stage, REFUSED], true);
    expectVerdict(`${stage} committed (blind)`, ['judge_negative', stage, stage, COMMITTED], false);
    expectVerdict(`${stage} unknown (rollback)`, ['judge_negative', stage, stage, UNKNOWN], false);
  }
});

test('judge_eio_ack/judge_eio_reboot: PL5 — لا إقرارَ معَ خطأِ كتابةٍ', () => {
  expectVerdict('NO_ACK named', ['judge_eio_ack', 'S2', 'NO_ACK:EROFS'], true);
  expectVerdict('ACK despite EIO', ['judge_eio_ack', 'S2', 'ACK'], false);
  expectVerdict('NO_ACK unnamed', ['judge_eio_ack', 'S2', 'NO_ACK:UNNAMED'], false);
  expectVerdict('S2 reboot unknown', ['judge_eio_reboot', 'S2', UNKNOWN], true);
  expectVerdict('S2 reboot committed', ['judge_eio_reboot', 'S2', COMMITTED], false);
  expectVerdict('S3 reboot committed', ['judge_eio_reboot', 'S3', COMMITTED], true);
  expectVerdict('S3 reboot unnamed', ['judge_eio_reboot', 'S3', 'BOOT_REFUSED:UNNAMED'], false);
});

test('judge_witness: غيابُ لقطةِ المرجعِ سقوطٌ لا ملاحظةٌ', (t) => {
  const base = registerTmpRoot(mkdtempSync(join(tmpdir(), 'l39j-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const present = join(base, 'S2.json');
  writeFileSync(present, '{}');
  expectVerdict('present', ['judge_witness', 'iter1/S2', present], true);
  expectVerdict('absent', ['judge_witness', 'iter1/S4', join(base, 'S4.json')], false);
});
