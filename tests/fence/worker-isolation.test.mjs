/**
 * عزلُ عمليةِ العامل (`WL-533`، علاجُ `LAB-UID-05`) — `src/fence/worker-isolation.mjs`.
 *
 * ثلاثُ طبقات:
 *  - **ISO-01..ISO-12:** نظامُ تشغيلٍ مزيَّف — الترتيب (قراءةُ الواصفِ وإغلاقُه قبلَ إسقاطِ الهويّة)،
 *    والرفضُ المغلقُ لكلِّ إعدادٍ ناقصٍ أو تحقّقٍ فاشل.
 *  - **ISO-20:** عمليةٌ حقيقيّةٌ بلا root تطلبُ العزل ⇒ تُرفَض (لا «عزلٌ» صامتٌ لعمليةٍ بُدئت بالـUID).
 *  - **ISO-30:** عمليةٌ حقيقيّةٌ عبرَ `sudo -n` تبدأُ بـroot وتُسقِطُ إلى `nobody`، ثمّ عمليةٌ أخرى بـ
 *    `nobody` تحاولُ قراءةَ `/proc/<pid>/environ` و`/proc/<pid>/fd` ⇒ مرفوض؛ والضابطُ (عمليةٌ بُدئت
 *    بـ`nobody` مباشرةً) مكشوف. يُتخطّى بلا `sudo -n` (CI) — والمختبرُ (`LAB-UID-06`) يقيسُ الشيءَ
 *    نفسَه بمستخدمي العمّالِ مع ptrace و`pidfd_getfd`.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FENCE_ERRORS,
  prepareFencedWorker,
  rawEd25519PublicKey,
} from '../../src/fence/db-fence.mjs';
import {
  ISOLATION_ERRORS,
  isolateWorkerProcess,
  isolationRequested,
  verifyIsolation,
} from '../../src/fence/worker-isolation.mjs';

const MODULE = fileURLToPath(new URL('../../src/fence/worker-isolation.mjs', import.meta.url));
const pem = String(
  generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
);

const STATUS = (/** @type {number} */ uid, /** @type {number} */ gid, cap = '0000000000000000') =>
  [
    'Name:\tnode',
    `Uid:\t${uid}\t${uid}\t${uid}\t${uid}`,
    `Gid:\t${gid}\t${gid}\t${gid}\t${gid}`,
    `Groups:\t${gid} `,
    `CapInh:\t0000000000000000`,
    `CapPrm:\t${cap}`,
    `CapEff:\t${cap}`,
    `CapBnd:\t000001ffffffffff`,
    `CapAmb:\t0000000000000000`,
  ].join('\n');

/**
 * نظامٌ مزيَّفٌ يسجّلُ كلَّ نداء. يحاكي النواة: بعدَ setuid(≠0) يصيرُ setuid(0) مرفوضاً و
 * `/proc/self/environ` ملكَ root (dumpable=0).
 * @param {Partial<{ euid: number, suid: string, fd: string|Error, regain: boolean, procOwner: number,
 *   cap: string, statusUid: number }>} [o]
 */
function fakeOs(o = {}) {
  /** @type {string[]} */
  const calls = [];
  let uid = o.euid ?? 0;
  let gid = o.euid ?? 0;
  return {
    calls,
    os: {
      getuid: () => uid,
      geteuid: () => uid,
      getgid: () => gid,
      getegid: () => gid,
      setgroups: (/** @type {number[]} */ g) => void calls.push(`setgroups:${g.join(',')}`),
      setgid: (/** @type {number} */ g) => {
        calls.push(`setgid:${g}`);
        gid = g;
      },
      setuid: (/** @type {number} */ u) => {
        calls.push(`setuid:${u}`);
        if (u === 0 && uid !== 0 && o.regain !== true) throw new Error('EPERM');
        uid = u;
      },
      readFd: (/** @type {number} */ fd) => {
        calls.push(`readFd:${fd}`);
        if (o.fd instanceof Error) throw o.fd;
        return o.fd ?? pem;
      },
      closeFd: (/** @type {number} */ fd) => void calls.push(`closeFd:${fd}`),
      readText: (/** @type {string} */ p) => {
        if (p === '/proc/sys/fs/suid_dumpable') return `${o.suid ?? '0'}\n`;
        if (p === '/proc/self/status') return STATUS(o.statusUid ?? uid, gid, o.cap);
        throw new Error(`unexpected ${p}`);
      },
      ownerOf: () => o.procOwner ?? 0,
    },
  };
}

const ENV = {
  XUUX_FENCE_KEY_FD: '3',
  XUUX_FENCE_WORKER_UID: '1001',
  XUUX_FENCE_WORKER_GID: '1002',
};

/** @param {() => unknown} fn @param {string} code */
const rejects = (fn, code) => assert.throws(fn, (e) => /** @type {any} */ (e).code === code);

describe('WL-533 عزلُ العامل — نظامٌ مزيَّف', () => {
  test('ISO-01: الترتيب — قراءةُ الواصفِ وإغلاقُه قبلَ أيِّ إسقاط، ثمّ setgroups→setgid→setuid', () => {
    const f = fakeOs();
    const { key, evidence } = isolateWorkerProcess(ENV, { os: f.os, workerId: 'alpha' });
    assert.deepEqual(f.calls, [
      'readFd:3',
      'closeFd:3',
      'setgroups:1002',
      'setgid:1002',
      'setuid:1001',
      'setuid:0',
    ]);
    assert.equal(evidence.mode, 'uid-drop-after-exec');
    assert.equal(evidence.setuid0_refused, true);
    assert.equal(key.hardwareBacked, false, 'مفتاحٌ برمجيٌّ لا يدّعي عتاداً');
    assert.equal(key.id, 'worker-fd:alpha');
    assert.deepEqual(key.publicKeyRaw(), rawEd25519PublicKey(pem));
  });

  test('ISO-02: مسارُ ملفِّ المفتاحِ مع الواصف ⇒ مرفوض (الملفُّ يُلغي العزل)', () => {
    rejects(
      () => isolateWorkerProcess({ ...ENV, XUUX_FENCE_WORKER_KEY: '/k.pem' }, { os: fakeOs().os }),
      ISOLATION_ERRORS.CONFIG,
    );
  });

  test('ISO-03: عمليةٌ بُدئت بغيرِ root ⇒ NOT_PRIVILEGED ولا يُقرأُ الواصف', () => {
    const f = fakeOs({ euid: 1001 });
    rejects(() => isolateWorkerProcess(ENV, { os: f.os }), ISOLATION_ERRORS.NOT_PRIVILEGED);
    assert.deepEqual(f.calls, []);
  });

  test('ISO-04: fs.suid_dumpable=1 ⇒ مرفوض قبلَ قراءةِ المفتاح', () => {
    const f = fakeOs({ suid: '1' });
    rejects(() => isolateWorkerProcess(ENV, { os: f.os }), ISOLATION_ERRORS.DUMPABLE_POLICY);
    assert.deepEqual(f.calls, []);
  });

  test('ISO-05: suid_dumpable=2 مقبول (التفريغُ لـroot وحدَه)', () => {
    assert.equal(
      isolateWorkerProcess(ENV, { os: fakeOs({ suid: '2' }).os }).evidence.suid_dumpable,
      '2',
    );
  });

  for (const [name, env] of /** @type {Array<[string, Record<string, string>]>} */ ([
    ['uid=0', { ...ENV, XUUX_FENCE_WORKER_UID: '0' }],
    ['gid=0', { ...ENV, XUUX_FENCE_WORKER_GID: '0' }],
    ['uid غيرُ رقميّ', { ...ENV, XUUX_FENCE_WORKER_UID: 'alpha' }],
    ['uid غائب', { XUUX_FENCE_KEY_FD: '3', XUUX_FENCE_WORKER_GID: '1002' }],
    ['fd=0 (stdin)', { ...ENV, XUUX_FENCE_KEY_FD: '0' }],
    ['fd=2', { ...ENV, XUUX_FENCE_KEY_FD: '2' }],
    ['fd سالب', { ...ENV, XUUX_FENCE_KEY_FD: '-3' }],
  ])) {
    test(`ISO-06: إعدادٌ مرفوض — ${name}`, () => {
      const f = fakeOs();
      rejects(() => isolateWorkerProcess(env, { os: f.os }), ISOLATION_ERRORS.CONFIG);
      assert.deepEqual(f.calls, [], 'لا قراءةَ ولا إسقاطَ قبلَ صحّةِ الإعداد');
    });
  }

  test('ISO-07: فشلُ قراءةِ الواصف ⇒ يُغلَقُ الواصفُ ولا يُسقَطُ شيءٌ ولا يُكمَل', () => {
    const f = fakeOs({ fd: new Error('EBADF') });
    assert.throws(() => isolateWorkerProcess(ENV, { os: f.os }), /EBADF/);
    assert.deepEqual(f.calls, ['readFd:3', 'closeFd:3']);
  });

  test('ISO-08: مفتاحٌ تالفٌ على الواصف ⇒ يُرفَضُ قبلَ الإسقاط', () => {
    const f = fakeOs({ fd: 'not a key' });
    assert.throws(() => isolateWorkerProcess(ENV, { os: f.os }));
    assert.ok(!f.calls.some((c) => c.startsWith('set')));
  });

  test('ISO-09: setuid(0) ينجحُ بعدَ الإسقاط ⇒ VERIFY_FAILED', () => {
    rejects(
      () => isolateWorkerProcess(ENV, { os: fakeOs({ regain: true }).os }),
      ISOLATION_ERRORS.VERIFY_FAILED,
    );
  });

  test('ISO-10: /proc/self/environ ملكُ العامل (dumpable=1) ⇒ VERIFY_FAILED', () => {
    rejects(
      () => isolateWorkerProcess(ENV, { os: fakeOs({ procOwner: 1001 }).os }),
      ISOLATION_ERRORS.VERIFY_FAILED,
    );
  });

  test('ISO-11: قدراتٌ متبقّية (CapEff≠0) أو Uid مختلف ⇒ VERIFY_FAILED', () => {
    rejects(
      () =>
        verifyIsolation(fakeOs({ cap: '0000000000000080', euid: 1001 }).os, {
          uid: 1001,
          gid: 1001,
          suidDumpable: '0',
        }),
      ISOLATION_ERRORS.VERIFY_FAILED,
    );
    rejects(
      () => isolateWorkerProcess(ENV, { os: fakeOs({ statusUid: 1003 }).os }),
      ISOLATION_ERRORS.VERIFY_FAILED,
    );
  });

  test('ISO-12: isolationRequested + prepareFencedWorker يرفضُ مفتاحاً معزولاً مع مسارِ ملف', async () => {
    assert.equal(isolationRequested({}), false);
    assert.equal(isolationRequested({ XUUX_FENCE_KEY_FD: ' 3 ' }), true);
    const { key, evidence } = isolateWorkerProcess(ENV, { os: fakeOs().os });
    await assert.rejects(
      prepareFencedWorker({
        env: { XUUX_FENCE_WORKER_ID: 'alpha', XUUX_FENCE_WORKER_KEY: '/k.pem' },
        halt: /** @type {any} */ ({}),
        isolated: { key, evidence },
      }),
      (e) => /** @type {any} */ (e).code === FENCE_ERRORS.WORKER_CONFIG,
    );
  });
});

/** @param {string[]} args @param {Record<string, string>} [env] */
const runNode = (args, env = {}) =>
  spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, ...env } });

const CHILD = (/** @type {string} */ mod) => `
import { isolateWorkerProcess } from ${JSON.stringify(mod)};
try {
  const r = isolateWorkerProcess(process.env, { workerId: 't' });
  process.stdout.write(JSON.stringify({ ok: true, pid: process.pid, evidence: r.evidence }) + '\\n');
  setInterval(() => {}, 1000);
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, code: e.code, message: e.message }) + '\\n');
  process.exit(9);
}
`;

describe('WL-533 عزلُ العامل — عملياتٌ حقيقيّة', () => {
  test('ISO-20: عمليةٌ بلا root تطلبُ العزل ⇒ NOT_PRIVILEGED (لا عزلٌ صامت)', (t) => {
    if (process.platform !== 'linux') return t.skip('Linux فقط');
    if (process.getuid?.() === 0) return t.skip('يعملُ بـroot');
    const r = runNode(['--input-type=module', '-e', CHILD(MODULE)], ENV);
    assert.equal(r.status, 9, r.stderr);
    assert.equal(JSON.parse(r.stdout).code, ISOLATION_ERRORS.NOT_PRIVILEGED);
  });

  test('ISO-30: root ⇒ nobody بواصفٍ موروث: الـUID نفسُه لا يقرأُ /proc/<pid>، والضابطُ مكشوف', async (t) => {
    if (process.platform !== 'linux') return t.skip('Linux فقط');
    if (spawnSync('sudo', ['-n', 'true']).status !== 0)
      return t.skip('لا sudo -n (المختبرُ يقيسُ LAB-UID-06)');
    const nobody = spawnSync('id', ['-u', 'nobody'], { encoding: 'utf8' });
    const nogroup = spawnSync('id', ['-g', 'nobody'], { encoding: 'utf8' });
    if (nobody.status !== 0) return t.skip('لا مستخدمَ nobody');
    const dir = mkdtempSync(join(tmpdir(), 'xuux-iso-'));
    chmodSync(dir, 0o755);
    const keyFile = join(dir, 'k.pem');
    const script = join(dir, 'child.mjs');
    writeFileSync(keyFile, pem, { mode: 0o600 });
    writeFileSync(script, CHILD(MODULE), { mode: 0o644 });
    const uid = nobody.stdout.trim();
    const gid = nogroup.stdout.trim();
    /** @param {import('node:child_process').ChildProcess} c */
    const firstLine = (c) =>
      new Promise((res) => {
        let b = '';
        c.stdout?.on('data', (d) => {
          b += d;
          if (b.includes('\n')) res(JSON.parse(b.split('\n')[0] ?? '{}'));
        });
        c.on('exit', () => res(JSON.parse(b.split('\n')[0] || '{}')));
      });
    const iso = spawn(
      'sudo',
      [
        '-n',
        'env',
        'XUUX_FENCE_KEY_FD=3',
        `XUUX_FENCE_WORKER_UID=${uid}`,
        `XUUX_FENCE_WORKER_GID=${gid}`,
        'sh',
        '-c',
        'exec "$0" "$1" 3<"$2"',
        process.execPath,
        script,
        keyFile,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const ctl = spawn(
      'sudo',
      [
        '-n',
        '-u',
        'nobody',
        process.execPath,
        '-e',
        'console.log(JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    /** @type {any} */
    let m = {};
    /** @type {any} */
    let c = {};
    try {
      m = await firstLine(iso);
      c = await firstLine(ctl);
      assert.equal(m.ok, true, JSON.stringify(m));
      assert.equal(m.evidence.uid, Number(uid));
      /** @param {number} pid @param {string} f */
      const asNobody = (pid, f) =>
        spawnSync('sudo', ['-n', '-u', 'nobody', 'cat', `/proc/${pid}/${f}`], { encoding: 'utf8' });
      const lsNobody = (/** @type {number} */ pid) =>
        spawnSync('sudo', ['-n', '-u', 'nobody', 'ls', `/proc/${pid}/fd`], { encoding: 'utf8' });
      assert.notEqual(asNobody(m.pid, 'environ').status, 0, 'nobody قرأ environ العاملِ المعزول');
      assert.notEqual(lsNobody(m.pid).status, 0, 'nobody سردَ واصفاتِ العاملِ المعزول');
      assert.equal(asNobody(c.pid, 'environ').status, 0, 'الضابطُ غيرُ مكشوف ⇒ القياسُ فارغ');
      assert.equal(lsNobody(c.pid).status, 0, 'الضابطُ غيرُ مكشوف ⇒ القياسُ فارغ');
    } finally {
      for (const pid of [m.pid, c.pid]) {
        if (Number.isInteger(pid)) spawnSync('sudo', ['-n', 'kill', '-KILL', String(pid)]);
      }
      iso.kill();
      ctl.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
