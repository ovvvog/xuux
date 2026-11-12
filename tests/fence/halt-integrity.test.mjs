/**
 * `D-14` (‏`WL-532`): القراءةُ الصارمةُ لمفتاحِ الإيقاف — كلُّ إفسادٍ يُقرأُ مغلقاً.
 *
 * يعملُ على `HaltSwitch` و`KingIdentity` حقيقيّين (توقيعاتٌ حقيقية)، ويُفسِدُ الملفّاتِ
 * يدوياً. حيث يختلفُ القارئُ الأصليُّ (المحميُّ بـ`LIVE-40`) يُثبَتُ الفرقُ صراحةً: الطبقةُ
 * لا تُغيّرُ القارئَ الأصليّ، بل تُضافُ في مساراتِ قرارِ السياج.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync as genKeys } from 'node:crypto';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  STRICT_PROBLEMS,
  StrictHaltError,
  createStrictHaltGuard,
  fileEpochFloor,
  strictFullyConfirmed,
  strictHaltReading,
} from '../../src/fence/halt-integrity.mjs';
import {
  HaltSwitch,
  KingIdentity,
  haltAckPayload,
  hashHaltBody,
  signHaltAck,
} from '../../src/root-of-trust/index.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

/** @returns {{ dir: string, halt: HaltSwitch, king: KingIdentity, floor: (n: number) => { read(): number } }} */
function setup() {
  const dir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'fence-halt-')));
  const king = new KingIdentity();
  const halt = new HaltSwitch(join(dir, 'state', 'halt.json'), king, {
    fsync: false,
    allowUnsignedTestHalt: true,
  });
  return { dir, halt, king, floor: (n) => ({ read: () => n }) };
}

/** نظامٌ مُزوَّد: إيقافٌ ثمّ استئناف ⇒ عهدان، والتوجيهُ الأخيرُ `running`. */
function provisioned() {
  const env = setup();
  env.halt.halt('provision');
  env.halt.resume('provision-resume');
  return env;
}

/** @param {ReturnType<typeof strictHaltReading>} r */
const codes = (r) => r.problems.map((p) => p.code);

test('D-14: نظامٌ سليمٌ يُقرأُ كما هو — RUNNING بعدَ الاستئناف، HALTED بعدَ الإيقاف', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = strictHaltReading(halt, { epochFloor: floor(2) });
  assert.equal(r.state, 'RUNNING', JSON.stringify(r.problems));
  assert.equal(r.epoch, 2);
  assert.equal(r.historyLength, 2);
  halt.halt('stop');
  const h = strictHaltReading(halt, { epochFloor: floor(2) });
  assert.equal(h.state, 'HALTED');
  assert.equal(h.epoch, 3);
});

test('D-14: غيابُ الثلاثيّةِ كلِّها = محوٌ ⇒ RECOVERY_REQUIRED (والقارئُ الأصليُّ يقرأُه running — الفرقُ مقصود)', (t) => {
  const { dir, halt, floor } = setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(halt.read().state, 'running', 'سلوكُ LIVE-40 المحميّ باقٍ كما هو');
  const r = strictHaltReading(halt, { epochFloor: floor(0) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.deepEqual(codes(r), [STRICT_PROBLEMS.TRUST_STATE_MISSING]);
});

test('D-14: بلا حدٍّ خارجيٍّ للعهد لا قراءةَ RUNNING، والحدُّ التالفُ كالغائب', (t) => {
  const { dir, halt } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(strictHaltReading(halt).state, 'RECOVERY_REQUIRED');
  assert.ok(codes(strictHaltReading(halt)).includes(STRICT_PROBLEMS.EPOCH_FLOOR_REQUIRED));
  const bad = join(dir, 'floor');
  writeFileSync(bad, 'abc\n');
  const r = strictHaltReading(halt, { epochFloor: fileEpochFloor(bad) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.ok(codes(r).includes(STRICT_PROBLEMS.EPOCH_FLOOR_REQUIRED));
  writeFileSync(bad, '2\n');
  assert.equal(strictHaltReading(halt, { epochFloor: fileEpochFloor(bad) }).state, 'RUNNING');
});

test('D-14: استرجاعُ ثلاثيّةٍ أقدمَ من الحدِّ الخارجيّ ⇒ EPOCH_FLOOR_AHEAD', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = strictHaltReading(halt, { epochFloor: floor(5) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.ok(codes(r).includes(STRICT_PROBLEMS.EPOCH_FLOOR_AHEAD));
});

test('D-14: توجيهٌ محذوفٌ أو تالف ⇒ RECOVERY_REQUIRED', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = readFileSync(halt.file, 'utf8');
  unlinkSync(halt.file);
  assert.ok(
    codes(strictHaltReading(halt, { epochFloor: floor(2) })).includes(
      STRICT_PROBLEMS.DIRECTIVE_MISSING,
    ),
  );
  writeFileSync(halt.file, '{"version":1,');
  assert.ok(
    codes(strictHaltReading(halt, { epochFloor: floor(2) })).includes(
      STRICT_PROBLEMS.DIRECTIVE_CORRUPT,
    ),
  );
  const forged = JSON.parse(original);
  forged.reason = 'forged';
  forged.hash = hashHaltBody(forged);
  writeFileSync(halt.file, JSON.stringify(forged) + '\n');
  const r = strictHaltReading(halt, { epochFloor: floor(2) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.ok(
    codes(r).includes(STRICT_PROBLEMS.DIRECTIVE_CORRUPT),
    'هاشٌ مُعادُ الحسابِ بلا توقيعٍ صالح',
  );
});

test('D-14: توجيهٌ موقَّعٌ صحيحٌ لكنّه أقدمُ من آخرِ التاريخ (إعادةُ running قديم) ⇒ DIRECTIVE_NOT_LAST', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const runningAt2 = readFileSync(halt.file, 'utf8');
  halt.halt('stop');
  writeFileSync(halt.file, runningAt2);
  const r = strictHaltReading(halt, { epochFloor: floor(3) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.ok(codes(r).includes(STRICT_PROBLEMS.DIRECTIVE_NOT_LAST));
});

test('D-14: سطرُ تاريخٍ تالفٌ — في الأوّلِ أو الوسط — لا يُتجاوَز', (t) => {
  for (const at of [0, 1]) {
    const { dir, halt, floor } = provisioned();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    halt.halt('third');
    const lines = readFileSync(halt.historyFile, 'utf8').split('\n');
    lines[at] = '{not json';
    writeFileSync(halt.historyFile, lines.join('\n'));
    const r = strictHaltReading(halt, { epochFloor: floor(3) });
    assert.equal(r.state, 'RECOVERY_REQUIRED', `السطر ${at + 1}`);
    assert.ok(codes(r).includes(STRICT_PROBLEMS.HISTORY_LINE_CORRUPT));
    assert.equal(
      r.problems.find((p) => p.code === STRICT_PROBLEMS.HISTORY_LINE_CORRUPT)?.at,
      at + 1,
    );
  }
});

test('D-14: ذيلُ تاريخٍ مقطوع (كتابةٌ منقطعة) ⇒ HISTORY_TAIL_TRUNCATED', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  appendFileSync(halt.historyFile, '{"version":1,"epoch":3');
  const r = strictHaltReading(halt, { epochFloor: floor(2) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.ok(codes(r).includes(STRICT_PROBLEMS.HISTORY_TAIL_TRUNCATED));
});

test('D-14: تاريخٌ محذوفٌ والتوجيهُ باقٍ ⇒ HISTORY_MISSING (ولا يُقرأُ التوجيهُ وحدَه)', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  unlinkSync(halt.historyFile);
  const r = strictHaltReading(halt, { epochFloor: floor(2) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.ok(codes(r).includes(STRICT_PROBLEMS.HISTORY_MISSING));
});

test('D-14: سطرٌ وسطيٌّ عُدِّلَ: هاشٌ قديم ⇒ HASH_MISMATCH؛ هاشٌ مُعادٌ ⇒ SIGNATURE_INVALID وانقطاعُ الربط', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt('third');
  const lines = readFileSync(halt.historyFile, 'utf8').split('\n');
  const first = JSON.parse(lines[0] ?? '');
  first.reason = 'rewritten';
  lines[0] = JSON.stringify(first);
  writeFileSync(halt.historyFile, lines.join('\n'));
  let r = strictHaltReading(halt, { epochFloor: floor(3) });
  assert.ok(codes(r).includes(STRICT_PROBLEMS.HISTORY_HASH_MISMATCH));
  first.hash = hashHaltBody(first);
  lines[0] = JSON.stringify(first);
  writeFileSync(halt.historyFile, lines.join('\n'));
  r = strictHaltReading(halt, { epochFloor: floor(3) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.ok(codes(r).includes(STRICT_PROBLEMS.HISTORY_SIGNATURE_INVALID));
  assert.ok(
    codes(r).includes(STRICT_PROBLEMS.HISTORY_LINK_MISMATCH),
    'السطرُ التالي يشيرُ إلى الهاشِ الأصليّ',
  );
});

test('D-14: حذفُ سطرٍ من الوسط ⇒ فجوةُ عهدٍ وانقطاعُ ربط', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.halt('third');
  const lines = readFileSync(halt.historyFile, 'utf8').split('\n');
  lines.splice(1, 1);
  writeFileSync(halt.historyFile, lines.join('\n'));
  const r = strictHaltReading(halt, { epochFloor: floor(3) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.ok(codes(r).includes(STRICT_PROBLEMS.HISTORY_EPOCH_GAP));
  assert.ok(codes(r).includes(STRICT_PROBLEMS.HISTORY_LINK_MISMATCH));
});

test('D-14: ملفُّ العهد: أعلى من التاريخ، أدنى، تالف، غائب — كلُّها مغلقة', (t) => {
  /** @type {Array<[string | null, string]>} */
  const cases = [
    ['9\n', STRICT_PROBLEMS.EPOCH_AHEAD_OF_HISTORY],
    ['1\n', STRICT_PROBLEMS.EPOCH_BEHIND_HISTORY],
    ['x\n', STRICT_PROBLEMS.EPOCH_FILE_CORRUPT],
    [null, STRICT_PROBLEMS.EPOCH_FILE_MISSING],
  ];
  for (const [content, code] of cases) {
    const { dir, halt, floor } = provisioned();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    if (content === null) unlinkSync(halt.epochFile);
    else writeFileSync(halt.epochFile, content);
    const r = strictHaltReading(halt, { epochFloor: floor(2) });
    assert.equal(r.state, 'RECOVERY_REQUIRED', String(code));
    assert.ok(codes(r).includes(String(code)), `${code}: ${JSON.stringify(codes(r))}`);
  }
});

test('D-14: سجلُّ عقدةٍ أو إقرارٌ تالف لا يُتجاهَل', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  halt.registerNode('w1', { pid: process.pid, nodeKey: nodeKey() });
  writeFileSync(join(halt.nodesDir, 'broken.json'), '{"nodeId":');
  let r = strictHaltReading(halt, { epochFloor: floor(2) });
  assert.equal(r.state, 'RECOVERY_REQUIRED');
  assert.ok(codes(r).includes(STRICT_PROBLEMS.NODE_RECORD_CORRUPT));
  unlinkSync(join(halt.nodesDir, 'broken.json'));
  writeFileSync(join(halt.acksDir, 'junk.json'), 'null');
  r = strictHaltReading(halt, { epochFloor: floor(2) });
  assert.ok(codes(r).includes(STRICT_PROBLEMS.ACK_RECORD_CORRUPT));
});

/** @returns {{ publicKeyPem: string, privateKeyPem: string, sign(payload: object): string }} */
function nodeKey() {
  const pair = genKeys('ed25519');
  const privateKeyPem = String(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return {
    publicKeyPem: String(pair.publicKey.export({ type: 'spki', format: 'pem' })),
    privateKeyPem,
    sign: (payload) => signHaltAck(privateKeyPem, payload),
  };
}

test('D-14: العمليةُ الميتةُ ليست إقراراً؛ الإقرارُ الموقَّعُ للعهدِ الجاري وحدَه يُكمِل، والحيُّ غيرُ المسجَّلِ يمنع', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = nodeKey();
  const dead = spawnSync(process.execPath, ['-e', '0']).pid ?? 999999;
  halt.registerNode('w1', { pid: dead, nodeKey: key });
  const directive = halt.halt('stop');
  assert.equal(halt.read().state, 'halted');
  let c = strictFullyConfirmed(halt, { epochFloor: floor(3) });
  assert.equal(c.ok, false, 'عمليةٌ ميتةٌ بلا إقرارٍ موقَّع');
  assert.deepEqual(c.unconfirmed, ['w1']);
  // إقرارٌ موقَّعٌ لعهدٍ آخر لا يُحسَب.
  const stale = signHaltAck(
    key.privateKeyPem,
    haltAckPayload(directive.hash, directive.epoch - 1, 'w1'),
  );
  writeFileSync(
    join(halt.acksDir, 'w1-stale.json'),
    JSON.stringify({
      nodeId: 'w1',
      epoch: directive.epoch - 1,
      directiveHash: directive.hash,
      pid: dead,
      at: 'x',
      proof: stale,
    }),
  );
  c = strictFullyConfirmed(halt, { epochFloor: floor(3) });
  assert.equal(c.ok, false, 'إقرارُ عهدٍ سابق');
  // الإقرارُ الموقَّعُ عبرَ المسارِ الأصليّ.
  halt.confirmHalt(
    'w1',
    signHaltAck(key.privateKeyPem, haltAckPayload(directive.hash, directive.epoch, 'w1')),
  );
  c = strictFullyConfirmed(halt, { epochFloor: floor(3) });
  assert.equal(c.ok, true, JSON.stringify(c));
  c = strictFullyConfirmed(halt, { epochFloor: floor(3), livePids: [424242] });
  assert.equal(c.ok, false);
  assert.deepEqual(c.unregisteredLivePids, [424242], 'عمليةٌ حيّةٌ في نطاقِ الإقلاعِ بلا سجلّ');
});

test('D-14: الحارسُ الصارمُ يرمي على HALTED وRECOVERY_REQUIRED ويمرُّ على RUNNING', (t) => {
  const { dir, halt, floor } = provisioned();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const guard = createStrictHaltGuard(halt, { epochFloor: floor(2) });
  assert.doesNotThrow(() => guard.assertOperational());
  halt.halt('stop');
  assert.throws(
    () => guard.assertOperational(),
    (e) => e instanceof StrictHaltError && e.code === 'SOVEREIGN_HALT',
  );
  writeFileSync(halt.epochFile, '99\n');
  assert.throws(
    () => guard.assertOperational(),
    (e) => e instanceof StrictHaltError && e.code === 'RECOVERY_REQUIRED',
  );
});
