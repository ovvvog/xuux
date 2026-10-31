// @ts-nocheck
// tests/tooling/live-39-dirsync.test.mjs
//
// `WL-505` (‏`LIVE-39` ع١) — أسنانُ أداةِ علاماتِ مزامنةِ المجلّدِ **بلا نواةٍ ولا device-mapper**:
//   (١) الحائلُ `scripts/lib/live-39-dirsync-marks.c` يُترجَمُ ويُحمَّلُ على عمليّةٍ تكتبُ وتُزامِنُ
//       بنمطِ الإنتاجِ (‏ملفٌّ مؤقّتٌ ⇐ `fsync` ⇐ `rename`/`link` ⇐ `fsync` المجلّد)، ومُعلِّمٌ مزيّفٌ
//       يُلحِقُ `MARK_ACK` — فيُقاسُ موضعُ العلامةِ من النداءِ في كلِّ وضعٍ، والأسماءُ المُلتقَطة،
//       وأنّ ما خارجَ النطاقِ لا يُعلَّم، وأنّ غيابَ متغيّرٍ لازمٍ سقوطٌ صاخب.
//   (٢) المِحكُّ `scripts/lib/live-39-dirsync-check.mjs`: كلُّ مخالفةٍ لدوامِ الاسمِ تُرى.
//   (٣) `judge_dirsync` في `scripts/lib/live-39-judge.sh`: كلُّ نتيجةٍ مخالفةٍ تُسقِط.
// والقياسُ الحقيقيُّ على `dm-log-writes` في `scripts/live-39-dirsync-marks.sh` (‏اختياريٌّ، خارجَ CI).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifySite,
  judgeMark,
  judgeName,
  orderHolds,
  parseLog,
} from '../../scripts/lib/live-39-dirsync-check.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM_C = join(HERE, '../../scripts/lib/live-39-dirsync-marks.c');
const JUDGE = join(HERE, '../../scripts/lib/live-39-judge.sh');

const work = registerTmpRoot(realpathSync(mkdtempSync(join(tmpdir(), 'wl505-'))));
const SO = join(work, 'shim.so');

test('الحائلُ يُترجَمُ بلا تحذير', () => {
  const result = spawnSync(
    'gcc',
    [
      '-shared',
      '-fPIC',
      '-O1',
      '-Wall',
      '-Werror',
      '-Wno-bidi-chars',
      '-Wno-format-truncation',
      '-o',
      SO,
      SHIM_C,
      '-ldl',
      '-lpthread',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

/** كاتبٌ بنمطِ الإنتاجِ: rename في الجذرِ ثمّ link/unlink في مجلّدٍ فرعيٍّ، وmزامنةٌ خارجَ النطاق. */
const WRITER = `
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
const [root, outside] = process.argv.slice(2);
const syncDir = (d) => { const fd = openSync(d, 'r'); fsyncSync(fd); closeSync(fd); };
const put = (p, text) => { const fd = openSync(p, 'w'); writeSync(fd, text); fsyncSync(fd); closeSync(fd); };
put(root + '/m.json.tmp', 'v1');
renameSync(root + '/m.json.tmp', root + '/m.json');
syncDir(root);
mkdirSync(root + '/claims');
put(root + '/claims/.claiming-x', 'claim');
linkSync(root + '/claims/.claiming-x', root + '/claims/id');
rmSync(root + '/claims/.claiming-x');
syncDir(root + '/claims');
put(outside + '/s.tmp', 'socket');
renameSync(outside + '/s.tmp', outside + '/s.json');
syncDir(outside);
`;

/**
 * يُشغِّلُ الكاتبَ تحتَ الحائلِ بوضعٍ.
 * @param {string} mode
 * @param {Record<string, string>} [overrides]
 */
function runShim(mode, overrides = {}) {
  const dir = join(work, `${mode}-${Math.random().toString(16).slice(2)}`);
  const root = join(dir, 'root');
  const outside = join(dir, 'outside');
  const snaps = join(dir, 'snaps');
  for (const d of [root, outside, snaps]) mkdirSync(d, { recursive: true });
  const log = join(dir, 'dirsync.log');
  const marker = join(dir, 'marker.sh');
  writeFileSync(marker, `#!/usr/bin/env bash\necho "MARK_ACK|$1" >> '${log}'\n`);
  chmodSync(marker, 0o755);
  const writer = join(dir, 'writer.mjs');
  writeFileSync(writer, WRITER);
  const env = {
    ...process.env,
    LD_PRELOAD: SO,
    LIVE39_DIRSYNC_MODE: mode,
    LIVE39_DIRSYNC_LOG: log,
    LIVE39_DIRSYNC_SNAPS: snaps,
    LIVE39_DIRSYNC_MARKER: marker,
    LIVE39_DIRSYNC_SCOPE: root,
    ...overrides,
  };
  const result = spawnSync(process.execPath, [writer, root, outside], { encoding: 'utf8', env });
  return { result, log, root, snaps, text: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

for (const mode of ['witness', 'mutate', 'early']) {
  test(`الحائلُ (${mode}): علامتانِ في النطاقِ وحدَه، بأسمائِهما وموضعِهما من النداء`, () => {
    const { result, text, root } = runShim(mode);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, new RegExp(`LIVE39_DIRSYNC_SUMMARY mode=${mode} marks=2 out_of_scope=1`));
    const marks = parseLog(text);
    assert.equal(marks.length, 2);
    assert.equal(marks[0].primary, `${root}/m.json`);
    assert.equal(marks[0].op, 'rename');
    assert.deepEqual(
      marks[0].names.map((n) => [n.path, n.state, n.primary]),
      [
        [`${root}/m.json.tmp`, 'absent', false],
        [`${root}/m.json`, 'present', true],
      ],
    );
    assert.equal(readFileSync(marks[0].names[1].snap, 'utf8'), 'v1');
    assert.equal(marks[1].dir, `${root}/claims`);
    assert.equal(marks[1].primary, `${root}/claims/id`);
    assert.equal(marks[1].op, 'link');
    assert.deepEqual(
      marks[1].names.map((n) => [n.path, n.state]),
      [
        [`${root}/claims/id`, 'present'],
        [`${root}/claims/.claiming-x`, 'absent'],
      ],
    );
    for (const mark of marks) assert.ok(orderHolds(mode, mark.events), `${mode}: ${mark.events}`);
    // الترتيبُ نفسُه بوضعٍ آخرَ يجبُ أن يُرفَضَ — المِحكُّ يميّزُ الأوضاعَ لا يقبلُ كلَّ تسلسل.
    for (const other of ['witness', 'mutate', 'early'].filter((m) => m !== mode)) {
      assert.equal(orderHolds(other, marks[0].events), false, `${mode} بوصفِ ${other}`);
    }
    assert.match(text, /^DIRSYNC_OUT_OF_SCOPE\|dir=.*\/outside$/mu);
  });
}

test('الحائلُ: متغيّرٌ لازمٌ غائبٌ سقوطٌ صاخبٌ لا استمرارٌ صامت', () => {
  const { result } = runShim('witness', { LIVE39_DIRSYNC_MARKER: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LIVE39_DIRSYNC_HARNESS_FAULT missing LIVE39_DIRSYNC_MARKER/u);
});

test('الحائلُ: مُعلِّمٌ يفشلُ سقوطٌ — لا علامةَ مفترضة', () => {
  const { result } = runShim('witness', { LIVE39_DIRSYNC_MARKER: '/bin/false' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LIVE39_DIRSYNC_HARNESS_FAULT marker failed/u);
});

test('الحائلُ: وضعٌ مجهولٌ سقوط', () => {
  const { result } = runShim('sometimes');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown LIVE39_DIRSYNC_MODE/u);
});

test('المِحكُّ: الدوامُ على الشجرةِ الحيّةِ نفسِها DURABLE، وكلُّ مخالفةٍ تُسمّى', () => {
  const { text, root } = runShim('witness');
  const [first] = parseLog(text);
  const fs = {
    exists: (p) => existsSync(p),
    read: (p) => readFileSync(p),
    isFile: () => true,
  };
  assert.equal(judgeMark(first, fs).result, 'DURABLE');
  assert.equal(judgeMark(first, fs).primaryResult, 'DURABLE');
  // اسمٌ أوّليٌّ غائبٌ (‏الإعادةُ قبلَ الإيداع)
  const missing = { ...fs, exists: (p) => p !== `${root}/m.json` && existsSync(p) };
  assert.equal(judgeMark(first, missing).primaryResult, `LOST:MISSING:${root}/m.json`);
  // المؤقّتُ ما زالَ ظاهراً (‏rename لم تَدُم)
  const stale = { ...fs, exists: (p) => p === `${root}/m.json.tmp` || existsSync(p) };
  assert.equal(judgeMark(first, stale).result, `LOST:PRESENT:${root}/m.json.tmp`);
  assert.equal(judgeMark(first, stale).primaryResult, 'DURABLE');
  // الاسمُ موجودٌ بمحتوى قديم (‏مدخلٌ قديمٌ لا الملفُّ المُزامَن)
  const old = { ...fs, read: (p) => (p === `${root}/m.json` ? Buffer.from('v0') : readFileSync(p)) };
  assert.equal(judgeMark(first, old).primaryResult, `LOST:CONTENT:${root}/m.json`);
});

test('المِحكُّ: محتوى الثانويِّ لا يُحكَم (‏مزامنةُ المجلّدِ تَعِدُ بالاسمِ لا بالمحتوى)', () => {
  const fs = { exists: () => true, read: () => Buffer.from('x'), isFile: () => true };
  const secondary = { path: '/r/lock', state: 'present', snap: '/s/1-0.bin', primary: false };
  assert.equal(judgeName(secondary, fs), 'OK');
  assert.equal(judgeName({ ...secondary, primary: true }, { ...fs, read: (p) => Buffer.from(p) }), 'CONTENT');
  assert.equal(judgeName({ ...secondary, state: 'absent' }, fs), 'PRESENT');
});

test('تصنيفُ المواضعِ بحسبِ تحليلِ WL-503 §2', () => {
  const at = (window, primary, dir = '/r') => classifySite({ window, primary, dir });
  assert.equal(at('BOOT', '/r/root-of-trust.manifest.json'), 'BOOT');
  assert.equal(at('TXN', '/r/root-of-trust.undo.jsonl'), 'M1');
  assert.equal(at('TXN', '/r/root-of-trust.manifest.json'), 'M2');
  assert.equal(at('S2', '/r/commands.ledger.claims/abc', '/r/commands.ledger.claims'), 'M3');
  assert.equal(at('S4', '/r/root-of-trust.manifest.json'), 'M4');
  assert.equal(at('S3', '/r/root-of-trust.manifest.json'), 'OTHER');
});

/**
 * @param {...string} args
 * @returns {{checks: number, failures: number, out: string}}
 */
function judge(...args) {
  const script =
    'set -euo pipefail; CHECKS=0; FAILURES=0; source "$1"; shift; "$@"; ' +
    'echo "COUNTS ${CHECKS} ${FAILURES}"';
  const result = spawnSync('bash', ['-c', script, 'judge', JUDGE, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const match = /COUNTS (\d+) (\d+)/u.exec(result.stdout);
  return { checks: Number(match[1]), failures: Number(match[2]), out: result.stdout };
}

const LOST = 'LOST:MISSING:/r/root-of-trust.manifest.json';

test('judge_dirsync: PLD1 — الشاهدُ لا يقبلُ إلّا DURABLE لكلِّ الأسماء', () => {
  assert.deepEqual(judge('judge_dirsync', 'witness', 'M2', 'l', 'DURABLE', 'DURABLE').failures, 0);
  assert.equal(judge('judge_dirsync', 'witness', 'M2', 'l', 'DURABLE', 'LOST:PRESENT:/r/x').failures, 1);
  assert.equal(judge('judge_dirsync', 'witness', 'BOOT', 'l', LOST, LOST).failures, 1);
});

for (const [mode, guarantee] of [
  ['mutate', 'PLD2'],
  ['early', 'PLD3'],
]) {
  test(`judge_dirsync: ${guarantee} — عندَ M2/M4 بقاءُ الاسمِ دائماً عمى، وغيرُهما يُعلَنُ بلا حكم`, () => {
    for (const site of ['M2', 'M4']) {
      const seen = judge('judge_dirsync', mode, site, 'l', LOST, LOST);
      assert.deepEqual([seen.checks, seen.failures], [1, 0], seen.out);
      assert.match(seen.out, new RegExp(`PASS\\|${guarantee}\\|`));
      const blind = judge('judge_dirsync', mode, site, 'l', 'DURABLE', 'DURABLE');
      assert.deepEqual([blind.checks, blind.failures], [1, 1], blind.out);
      // الثانويُّ وحدَه ضائعٌ والأوّليُّ دائمٌ ⇐ عمى (‏الحكمُ على الاسمِ الذي وُجِدَت المزامنةُ لأجلِه)
      assert.equal(judge('judge_dirsync', mode, site, 'l', 'DURABLE', 'LOST:PRESENT:/r/t').failures, 1);
    }
    for (const site of ['BOOT', 'M1', 'M3', 'OTHER']) {
      const observed = judge('judge_dirsync', mode, site, 'l', 'DURABLE', 'DURABLE');
      assert.deepEqual([observed.checks, observed.failures], [0, 0]);
      assert.match(observed.out, new RegExp(`^OBSERVED\\|${guarantee}\\|`, 'mu'));
    }
  });
}

test('judge_dirsync: وضعٌ مجهولٌ سقوطُ حزام', () => {
  assert.equal(judge('judge_dirsync', 'both', 'M2', 'l', LOST, LOST).failures, 1);
});
