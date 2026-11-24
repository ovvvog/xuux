/**
 * `D-14` (‏`WL-532`): القراءةُ الصارمةُ لمفتاحِ الإيقاف — كلُّ إفسادٍ يُقرأُ مغلقاً.
 *
 * يعملُ على `HaltSwitch` و`KingIdentity` حقيقيّين (توقيعاتٌ حقيقية)، ويُفسِدُ الملفّاتِ
 * يدوياً. حيث يختلفُ القارئُ الأصليُّ (المحميُّ بـ`LIVE-40`) يُثبَتُ الفرقُ صراحةً: الطبقةُ
 * لا تُغيّرُ القارئَ الأصليّ، بل تُضافُ في مساراتِ قرارِ السياج.
 *
 * ‏`WL-608` (‏`§7` مهلةُ الملفّ): نُقلت هنا حرفيّاً كتلةُ `LIVE-75` ‏SUP-11..16 من `tests/fence/lease-reap-window.test.mjs`
 * (‏بلغَ مع SUP-17 والكتلةِ الجديدةِ نحوَ 127 ث من مهلةِ 120 ث). لا تعتمدُ على هذا الملفِّ إلا
 * بالاستيراد؛ والعمّالُ يُطلَقون عبرَ `supervisorLab` بقاعدةٍ حقيقيّة (‏تُتخطّى بلا `DATABASE_URL`).
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, generateKeyPairSync as genKeys, randomBytes } from 'node:crypto';
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
import test, { before, describe } from 'node:test';

import pg from 'pg';

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
import { FenceRoot, SUPERVISOR_LOCK_KEY } from '../../src/fence/db-fence.mjs';
import {
  L75_WORKER_SRC,
  NO_EFFECTS,
  REPO_ROOT,
  l75Until,
  rejection,
  supervisorLab,
  t_note,
} from '../helpers/fence-harness.mjs';
import { skipWithoutDatabase } from '../helpers/pg.mjs';
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

// ── WL-607 (‏LIVE-75): اختباراتُ المُشرِفِ SUP-11..SUP-16 — هنا لا في `fence-lifecycle.test.mjs` لأنّ مهلةَ الملفِّ في
// ‏`test:suite` (‏120 ث) لا تتّسعُ لها مع SUP-01..10 هناك (‏قيسَ 120.9 ث منفرداً فسقطَ الملفُّ بالمهلةِ في الحزمة).
// ‏الإعدادُ المشترَكُ `supervisorLab` في `tests/helpers/fence-harness.mjs` (‏قاعدةٌ معزولةٌ مستقلّة).
describe(
  'LIVE-75 — المُشرِفُ المركّب FenceSupervisor: موتٌ في كلِّ مرحلة ونافذةُ SUP-06 وتعافٍ وتسلسل (‏WL-607)',
  { skip: skipWithoutDatabase },
  () => {
    const lab = supervisorLab('fence_supw');
    /** @type {Awaited<ReturnType<typeof import('../helpers/fence-harness.mjs').harness>>} */
    let h;
    before(() => {
      h = lab.h;
    });
    const {
      secret,
      keyFiles,
      children,
      grandchildren,
      rootUrl,
      workerDbUrl,
      connectAt,
      probeId,
      mk,
      creds,
      active,
      sessionsOf,
      lockHolders,
      workerOf,
      dead,
      clean,
    } = lab;

    // ── WL-607 (‏LIVE-75): ما لم تغطِّه SUP-01..10 — موتُ المُشرِفِ في كلِّ مرحلة، ونافذةُ SUP-06 مقيسةً بحدِّها،
    // ‏والتعافي، وفشلُ الحاصدِ أثناءَ العمل، وفشلُ التنظيف، والسباقُ على القفل، والطابورُ بقياسٍ مستقلّ. ──

    /**
     * يُطلِقُ `fence-lab supervise` عمليّةً منفصلة (‏موتُها بـSIGKILL موتُ مُشرِفٍ حقيقيّ).
     * @param {Record<string, string>} modes
     */
    const launchCli = (modes) => {
      const cfgPath = join(lab.dir, `sup-${randomBytes(4).toString('hex')}.json`);
      const cmd = [process.execPath, '--input-type=module', '-e', L75_WORKER_SRC];
      writeFileSync(
        cfgPath,
        JSON.stringify({
          harnessPasswordBroker: true,
          workers: Object.entries(modes).map(([w, mode]) => ({
            workerId: w,
            command: cmd,
            env: {
              XUUX_FENCE_WORKER_KEY: keyFiles[w],
              L75_MODE: mode,
              L75_DB_URL: workerDbUrl(),
              L75_HARNESS_SECRET: secret,
              L75_ID: String(probeId[w]),
            },
          })),
          options: {
            leaseIntervalMs: 200,
            monitorIntervalMs: 100,
            killGraceMs: 500,
            reaper: { ceilingMs: 1000, retryMs: 50, firstTickTimeoutMs: 3000 },
          },
        }),
        { mode: 0o600 },
      );
      const cli = spawn(
        process.execPath,
        ['scripts/fence-lab.mjs', 'supervise', '--config', cfgPath],
        {
          cwd: REPO_ROOT,
          env: {
            PATH: process.env['PATH'] ?? '',
            XUUX_ROOT_DATABASE_URL: rootUrl(),
            XUUX_FENCE_HARNESS: '1',
            XUUX_HARNESS_SUPERUSER_URL: workerDbUrl(),
            XUUX_HARNESS_SECRET: secret,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      children.add(cli);
      /** @type {any[]} */
      const lines = [];
      let buf = '';
      cli.stdout?.on('data', (d) => {
        buf += String(d);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          try {
            lines.push(JSON.parse(line));
          } catch {
            lines.push({ raw: line });
          }
        }
      });
      cli.stderr?.on('data', () => {});
      cli.stdout?.on('data', () => {
        for (const pid of spawnedPids(lines)) grandchildren.add(pid);
      });
      return { cli, lines, cfgPath };
    };
    /** @param {number} pid */
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    /** pids عمّالِ CLI من سطورِ `worker_spawned`. @param {any[]} lines */
    const spawnedPids = (lines) =>
      lines.filter((l) => l.ev === 'worker_spawned' && l.pid).map((l) => Number(l.pid));
    const probe = async (/** @type {number | undefined} */ id) =>
      (await h.db.pool.query('SELECT v FROM state.fence_probe WHERE id = $1', [id])).rows[0]?.v ??
      null;

    test('SUP-11: موتُ المُشرِفِ (‏SIGKILL) في كلِّ مرحلةٍ حرجة ⇒ القفلُ يُحرَّر، ولا اعتمادَ للمُشرِفِ الميّتِ يبقى ACTIVE بعدَ كنسِ التالي، ولا جلسةَ له', async () => {
      /** @type {Array<Record<string, unknown>>} */
      const outcomes = [];
      for (const stage of [
        'supervisor_locking',
        'supervisor_swept',
        'supervisor_running',
        'worker_spawned',
        'worker_credential',
        'worker_running',
      ]) {
        await clean();
        const { cli, lines, cfgPath } = launchCli({ alpha: 'write', beta: 'write' });
        await l75Until(
          () => lines.some((l) => l.ev === stage) || dead(cli),
          20_000,
          `المُشرِفُ بلغَ ${stage}`,
        );
        assert.ok(!dead(cli), `المُشرِفُ حيٌّ عندَ ${stage}`);
        cli.kill('SIGKILL');
        await l75Until(() => dead(cli), 5_000, 'المُشرِفُ مات');
        // ‏ما بلغَه فعلاً قبلَ الموت (‏القراءةُ غيرُ متزامنةٍ مع القتل — يُسجَّلُ ولا يُفترَض).
        const reached = lines.filter((l) => l.src === 'supervisor').map((l) => l.ev);
        await l75Until(async () => (await lockHolders()) === 0, 5_000, `القفلُ حُرِّرَ (${stage})`);
        const pids = spawnedPids(lines);
        await l75Until(
          () => pids.every((p) => !alive(p)),
          5_000,
          `عمّالُ المُشرِفِ الميّتِ خرجوا بانقطاعِ IPC (${stage})`,
        );
        const orphanRoles = (await active()).map((c) => c.role_name);
        // ‏المُشرِفُ التالي يكنس — ثمّ لا يبقى من اعتماداتِ الميّتِ ACTIVE ولا جلسة.
        const next = mk({ workers: ['beta'] });
        await next.sup.start();
        const nextRole = String(workerOf(next.sup, 'beta')?.role);
        const leftovers = (await active()).filter((c) => c.role_name !== nextRole);
        assert.deepEqual(leftovers, [], `لا ACTIVE من المُشرِفِ الميّتِ بعدَ الكنس (${stage})`);
        for (const r of orphanRoles) {
          const c = (await creds()).find((x) => x.role_name === r);
          assert.equal(c?.status, 'REVOKED', `${r} أُلغي (${stage})`);
        }
        assert.equal(await sessionsOf(orphanRoles), 0, `لا جلسةَ للمُلغى (${stage})`);
        await l75Until(async () => (await probe(probeId.beta)) !== null, 8_000, 'التالي يكتب');
        await next.sup.stop();
        rmSync(cfgPath, { force: true });
        outcomes.push({ stage, reached: reached.at(-1), orphansSwept: orphanRoles.length });
      }
      t_note('SUP-11', outcomes);
    });

    test('SUP-12: نافذةُ SUP-06 بحدِّها — عاملٌ عنيدٌ بعدَ موتِ المُشرِفِ بلا مُشرِفٍ تالٍ: الكتابةُ تُرفَضُ بانقضاءِ الإيجارِ في القاعدة، والدورُ NOLOGIN منذُ الختم، لكنّ الاعتمادَ يبقى ACTIVE حتى الكنس', async () => {
      await clean();
      const ctl = (
        await h.db.pool.query('SELECT lease_window_s, lease_renew_s FROM fence.control WHERE id')
      ).rows[0];
      const WINDOW_S = 5;
      // ‏ضبطُ الإيجارِ أمرٌ سياديٌّ تحتَ HALTED وحدَه — إيقافٌ ثمّ ضبطٌ ثمّ استئناف (‏وعكسُه في النهاية).
      /** @param {number} w @param {number} r */
      const setLease = async (w, r) => {
        await h.root.halt(`l75-sup-12-${w}`, { effects: NO_EFFECTS });
        await h.sovereign.command('lease_set', { lease_window_s: w, lease_renew_s: r });
        await h.resume();
      };
      await setLease(WINDOW_S, 1);
      /** @type {number | null} */
      let stubbornPid = null;
      try {
        const { cli, lines, cfgPath } = launchCli({ alpha: 'stubborn' });
        await l75Until(
          () => lines.some((l) => l.ev === 'cli_started') || dead(cli),
          20_000,
          'المُشرِفُ أقلع',
        );
        const started = lines.find((l) => l.ev === 'cli_started');
        assert.ok(started, 'cli_started');
        const role = String(started.snapshot.workers[0].role);
        const pid = Number(started.snapshot.workers[0].pid);
        stubbornPid = pid;
        await l75Until(async () => (await probe(probeId.alpha)) !== null, 8_000, 'العنيدُ يكتب');
        cli.kill('SIGKILL');
        const tDeath = Date.now();
        await l75Until(() => dead(cli), 5_000, 'المُشرِفُ مات');
        assert.ok(alive(pid), 'العنيدُ حيٌّ بلا مُشرِف');
        // ‏آخرُ كتابةٍ ناجحة: القيمةُ تتوقّفُ عن التغيّر. الحدُّ الأعلى: نافذةُ الإيجارِ + هامشُ الجدولة.
        let last = await probe(probeId.alpha);
        let tLastChange = tDeath;
        const deadline = tDeath + (WINDOW_S + 5) * 1000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
          const v = await probe(probeId.alpha);
          if (v !== last) {
            last = v;
            tLastChange = Date.now();
          }
        }
        const writesAfterDeathMs = tLastChange - tDeath;
        assert.ok(
          writesAfterDeathMs <= (WINDOW_S + 1) * 1000,
          `الكتابةُ توقّفت خلالَ نافذةِ الإيجار (${writesAfterDeathMs} ms)`,
        );
        // ‏ما يبقى في النافذة: اعتمادٌ ACTIVE (‏لا حاصدَ يعمل — حاصدُ المُشرِفِ مات معه) وجلسةٌ مفتوحة.
        const c = (await creds()).find((x) => x.role_name === role);
        assert.equal(
          c?.status,
          'ACTIVE',
          'لا إلغاءَ بلا مُشرِفٍ ولا حاصد — جزءٌ من النافذةِ المعلنة',
        );
        // ‏والدورُ NOLOGIN منذُ الختم (‏`0024_fence` — لا جلسةَ جديدةَ بعدَه)، فما يبقى جلساتُه المختومةُ القائمة.
        // ‏عددُها غيرُ ثابت: مجمّعُ `pg` يُتلِفُ الوصلةَ بعدَ كتابةٍ مرفوضةٍ ولا يستطيعُ فتحَ غيرِها — يُسجَّلُ ولا يُؤكَّد.
        const canLogin = (
          await h.db.pool.query('SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', [role])
        ).rows[0]?.rolcanlogin;
        assert.equal(canLogin, false, 'الدورُ NOLOGIN داخلَ النافذة (‏منذُ الختم)');
        const sessionsInWindow = await sessionsOf([role]);
        // ‏وكتابةٌ مباشرةٌ بدورِه تُرفَضُ بـXF009 (‏فحصُ القاعدة، لا المُشرِف).
        const u = new URL(workerDbUrl());
        u.username = role;
        u.password = createHmac('sha256', secret).update(role).digest('base64url');
        const direct = new pg.Client({ connectionString: u.toString() });
        direct.on('error', () => {});
        /** @type {string | null} */
        let directCode = null;
        try {
          await direct.connect();
          await direct.query(
            "INSERT INTO state.fence_probe (id, v) VALUES ($1, 'direct') ON CONFLICT (id) DO UPDATE SET v = excluded.v",
            [probeId['alpha'] ?? 7501],
          );
        } catch (error) {
          directCode = String(/** @type {any} */ (error)?.code ?? error);
        } finally {
          await direct.end().catch(() => {});
        }
        assert.ok(directCode !== null, 'كتابةُ جلسةٍ جديدةٍ بالدورِ مرفوضة');
        // ‏والتالي يُغلقُ النافذة: كنسٌ يُلغي ويُنهي الجلسة.
        const next = mk({ workers: ['beta'] });
        await next.sup.start();
        assert.equal((await creds()).find((x) => x.role_name === role)?.status, 'REVOKED');
        assert.equal(await sessionsOf([role]), 0);
        await next.sup.stop();
        rmSync(cfgPath, { force: true });
        t_note('SUP-12', { windowS: WINDOW_S, writesAfterDeathMs, directCode, sessionsInWindow });
      } finally {
        // ‏العنيدُ حفيدُ عمليّةِ CLI لا ابنُها — خارجَ `children`، فيُقتَلُ هنا دائماً.
        if (stubbornPid !== null && alive(stubbornPid)) process.kill(stubbornPid, 'SIGKILL');
        await setLease(Number(ctl.lease_window_s), Number(ctl.lease_renew_s));
      }
    });

    test('SUP-13: إعادةُ التشغيلِ والتعافي — نسخةٌ موقوفةٌ لا تُقلِعُ ثانية، ومُشرِفٌ جديدٌ يتعافى بعدَ STOPPED وبعدَ FAILED (‏فقدُ القفل)', async () => {
      await clean();
      const a = mk();
      await a.sup.start();
      await a.sup.stop();
      assert.equal((await rejection(() => a.sup.start())).code, 'FENCE_SUPERVISOR_STATE');
      assert.deepEqual(await active(), []);
      // ‏تعافٍ بعدَ STOPPED.
      const b = mk();
      await b.sup.start();
      await l75Until(
        async () => (await probe(probeId.alpha)) !== null && (await probe(probeId.beta)) !== null,
        8_000,
        'b يكتب',
      );
      const bRoles = b.sup.snapshot().workers.map((w) => String(w.role));
      // ‏FAILED: إنهاءُ وصلةِ القفلِ من خارج.
      await h.db.pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::oid
           AND objid = $2::oid AND objsubid = 2 AND granted`,
        [...SUPERVISOR_LOCK_KEY],
      );
      const failed = await b.sup.done;
      assert.equal(failed.state, 'FAILED');
      assert.equal(failed.reason, 'FENCE_SUPERVISOR_LOCK_LOST');
      assert.deepEqual(failed.revokeErrors, []);
      for (const r of bRoles)
        assert.equal((await creds()).find((x) => x.role_name === r)?.status, 'REVOKED');
      assert.equal(await sessionsOf(bRoles), 0);
      await l75Until(() => b.spawned.every((s) => dead(s.child)), 5_000, 'عمّالُ b ماتوا');
      // ‏تعافٍ بعدَ FAILED: مُشرِفٌ جديدٌ بأدوارٍ جديدة.
      await h.db.pool.query('DELETE FROM state.fence_probe WHERE id IN (7501, 7502)');
      const c = mk();
      await c.sup.start();
      await l75Until(
        async () => (await probe(probeId.alpha)) !== null && (await probe(probeId.beta)) !== null,
        8_000,
        'c يكتب بعدَ التعافي',
      );
      const cRoles = c.sup.snapshot().workers.map((w) => String(w.role));
      assert.equal(cRoles.filter((r) => bRoles.includes(r)).length, 0, 'أدوارٌ جديدة');
      await c.sup.stop();
      assert.deepEqual(await active(), []);
    });

    test('SUP-14: فشلُ الحاصدِ أثناءَ العمل يُسجَّلُ ولا يُسقِطُ المُشرِف؛ وفشلُ التنظيفِ (‏الإلغاءُ عندَ الإيقاف) يُعلَنُ في التقريرِ ويكنسُه التالي', async () => {
      await clean();
      // ‏(أ) الحاصد: أوّلُ نداءٍ ناجح (‏شرطُ الإقلاع)، ثمّ يرمي.
      let calls = 0;
      const target = {
        reapLapsed: async () => {
          calls++;
          if (calls === 1) return h.root.reapLapsed();
          throw Object.assign(new Error('reaper down'), { code: '57P01' });
        },
      };
      const a = mk({
        options: { reaper: { ceilingMs: 100, retryMs: 50, firstTickTimeoutMs: 3_000, target } },
      });
      await a.sup.start();
      await l75Until(
        () => a.events.filter((e) => e['ev'] === 'reaper_error').length >= 3,
        8_000,
        'أخطاءُ الحاصدِ تُسجَّل',
      );
      const snap = a.sup.snapshot();
      assert.equal(snap.state, 'RUNNING', 'خطأُ الحاصدِ لا يُسقِطُ المُشرِف (‏سلوكٌ معلَن)');
      assert.ok((snap.reaper?.errors ?? 0) >= 3, JSON.stringify(snap.reaper));
      assert.ok(snap.workers.every((w) => w.state === 'RUNNING'));
      await a.sup.stop();
      // ‏(ب) فشلُ الإلغاءِ عندَ الإيقاف.
      await clean();
      let failRevoke = false;
      class FlakyRoot extends FenceRoot {
        /** @override @param {string} role @param {string} reason */
        async revokeCredential(role, reason) {
          if (failRevoke) throw Object.assign(new Error('revoke down'), { code: '08006' });
          return super.revokeCredential(role, reason);
        }
      }
      const b = mk({ root: new FlakyRoot(connectAt(rootUrl())) });
      await b.sup.start();
      const roles = b.sup.snapshot().workers.map((w) => String(w.role));
      failRevoke = true;
      const r = await b.sup.stop();
      assert.equal(r.state, 'STOPPED');
      assert.deepEqual(
        r.revokeErrors.map((/** @type {any} */ x) => x.role).sort(),
        [...roles].sort(),
        'كلُّ إلغاءٍ فشلَ مُعلَنٌ في التقرير',
      );
      assert.deepEqual(r.revoked, [], 'لا يُعلَنُ إلغاءٌ لم يقع');
      await l75Until(
        () => b.spawned.every((s) => dead(s.child)),
        5_000,
        'العمّالُ قُتلوا رغمَ فشلِ الإلغاء',
      );
      assert.deepEqual(
        (await active()).map((c) => c.role_name).sort(),
        [...roles].sort(),
        'الاعتماداتُ باقيةٌ ACTIVE — لا تُخفى',
      );
      const next = mk({ workers: ['beta'] });
      await next.sup.start();
      for (const role of roles)
        assert.equal((await creds()).find((x) => x.role_name === role)?.status, 'REVOKED');
      await next.sup.stop();
    });

    test('SUP-15: مُشرِفانِ يُقلِعانِ معاً على القاعدةِ نفسِها ⇒ واحدٌ فقط ينجح، والخاسرُ لا يكنسُ ولا يُطلِق', async () => {
      for (let round = 0; round < 3; round++) {
        await clean();
        const x = mk();
        const y = mk();
        const [rx, ry] = await Promise.allSettled([x.sup.start(), y.sup.start()]);
        const won = [rx, ry].filter((r) => r.status === 'fulfilled').length;
        assert.equal(won, 1, `فائزٌ واحد (‏جولة ${round})`);
        const [winner, loser, lost] = rx.status === 'fulfilled' ? [x, y, ry] : [y, x, rx];
        assert.equal(/** @type {any} */ (lost).reason?.code, 'FENCE_SUPERVISOR_LOCKED');
        assert.equal(loser.spawned.length, 0);
        assert.equal(loser.events.filter((e) => e['ev'] === 'supervisor_swept').length, 0);
        const roles = winner.sup.snapshot().workers.map((w) => String(w.role));
        assert.deepEqual(
          (await active()).map((c) => c.role_name).sort(),
          [...roles].sort(),
          'اعتماداتُ الفائزِ سليمة',
        );
        await winner.sup.stop();
      }
    });

    test('SUP-16: الطابورُ التسلسليُّ بقياسٍ مستقلٍّ عن عدّادِ المُشرِف — إصدارٌ وإلغاءٌ مُبطَّآنِ عمداً لا يتداخلان', async () => {
      await clean();
      const probeQ = { active: 0, max: 0, issue: 0, revoke: 0 };
      const delay = () => new Promise((r) => setTimeout(r, 25));
      /** @template T @param {'issue'|'revoke'} k @param {() => Promise<T>} fn */
      const track = async (k, fn) => {
        probeQ.active++;
        probeQ.max = Math.max(probeQ.max, probeQ.active);
        probeQ[k]++;
        try {
          await delay();
          return await fn();
        } finally {
          probeQ.active--;
        }
      };
      class SlowRoot extends FenceRoot {
        /** @override @param {string} w @param {string} b */
        async issueChallenge(w, b) {
          return track('issue', () => super.issueChallenge(w, b));
        }
        /** @override @param {string} n @param {Buffer} s */
        async completeCredential(n, s) {
          return track('issue', () => super.completeCredential(n, s));
        }
        /** @override @param {string} role @param {string} reason */
        async revokeCredential(role, reason) {
          return track('revoke', () => super.revokeCredential(role, reason));
        }
      }
      const a = mk({
        root: new SlowRoot(connectAt(rootUrl())),
        modes: { alpha: ['die-after-ready'], beta: ['write'] },
        options: { restart: { maxRestarts: 4, windowMs: 60_000, backoffMs: 0 } },
      });
      await a.sup.start();
      await l75Until(() => workerOf(a.sup, 'alpha')?.state === 'GAVE_UP', 25_000, 'alpha استسلم');
      await a.sup.stop();
      const serial = a.sup.snapshot().serial;
      assert.equal(probeQ.max, 1, `تداخلٌ مقيسٌ من خارج: ${JSON.stringify(probeQ)}`);
      assert.equal(probeQ.issue, serial.issue, 'عدُّ الإصدارِ المستقلُّ = عدُّ المُشرِف');
      assert.equal(probeQ.revoke, serial.revoke, 'عدُّ الإلغاءِ المستقلُّ = عدُّ المُشرِف');
      assert.ok(probeQ.issue >= 10 && probeQ.revoke >= 5, JSON.stringify(probeQ));
      assert.deepEqual(await active(), []);
      t_note('SUP-16', { probeQ, serial });
    });
  },
);
