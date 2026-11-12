import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { createWorker } from '../../src/execution/worker.mjs';
import { probeIsolation } from '../../src/execution/isolation.mjs';
import {
  FENCE_ERRORS,
  pemKeyProvider,
  prepareFencedWorker,
  rawEd25519PublicKey,
} from '../../src/fence/db-fence.mjs';
import {
  APP_MODULES as BOOT_APP_MODULES,
  ISOLATION_ERRORS,
  LAUNCH_SUDO,
  bootstrapIsolation,
  bootstrapTrustPaths,
  codeTrustViolations,
  hostileLaunchInputs,
  isolatedLaunchCommand,
  isolationMode,
  keyFdViolations,
  isolatedLaunchEnv,
  ALLOWED_CAP_BND,
} from '../../scripts/worker.mjs';
import { UNSET_ENV, boundingCapabilities, parseUnit, systemdUnit } from '../../scripts/worker.mjs';

const skip = probeIsolation().available
  ? false
  : 'العزل الحقيقي غير متاح في المضيف؛ لا يُحوّل إلى نجاح وهمي.';

function queueFixture() {
  /** @type {any} */
  const task = {
    id: 'isolated-worker-task',
    action: 'اختبار.نجاح',
    payload: { قيمة: 11 },
    timeoutMs: 2_000,
    memoryLimitMb: 1_024,
    cancelRequested: false,
  };
  let claimed = false;
  /** @type {string[]} */
  const calls = [];
  return {
    task,
    calls,
    async claim() {
      if (claimed) return [];
      claimed = true;
      calls.push('claim');
      return [task];
    },
    async heartbeat() {
      calls.push('heartbeat');
      return { cancelRequested: false, extended: true };
    },
    /** @param {{ taskId: string, result: Record<string, unknown> }} input */
    async succeed(input) {
      calls.push(`succeed:${input.taskId}`);
      task.result = input.result;
    },
    /** @param {{ code: string }} input */
    async fail(input) {
      calls.push(`fail:${input.code}`);
      task.failure = input;
    },
    async get() {
      return task;
    },
  };
}

test('العامل يمرّر المهمة إلى namespaces حقيقية ويثبت نتيجتها', { skip }, async () => {
  const queue = queueFixture();
  const outputRoot = registerTmpRoot(
    fs.mkdtempSync(path.join(process.cwd(), '.xuux-worker-isolation-')),
  );
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  const log = {
    /** @param {string} type @param {string} actor @param {object} payload */
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
  try {
    const worker = createWorker({
      queue: /** @type {any} */ (queue),
      pool: /** @type {any} */ ({}),
      haltGuard: { assertOperational() {} },
      worker: 'عامل-العزل',
      isolation: { workdir: process.cwd(), outputRoot, log },
    });
    const tick = await worker.tick();
    assert.equal(tick.outcome, 'done');
    assert.equal(queue.task.result.صدى.قيمة, 11);
    assert.ok(queue.calls.some((call) => call.startsWith('succeed:')));
    assert.ok(events.some((event) => event.type === 'isolation.started'));
    assert.ok(events.some((event) => event.type === 'isolation.completed'));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// `WL-533` (مراجعةُ #546) — مُقلِعُ العزلِ في `scripts/worker.mjs`.
//  - ISO-01..19: نظامٌ مزيَّف — الترتيب، والفشلُ المغلق، وعقدُ الواصف، وCapBnd/NoNewPrivs.
//  - ISO-20/21: عملياتٌ حقيقيّةٌ بلا root.
//  - ISO-40: رسمُ الاستيرادِ الثابتِ للمُقلِعِ وكاتبِ المختبر `node:` وحدَه.
//  - ISO-41..45: عملياتٌ حقيقيّةٌ عبرَ `sudo -n` + `setpriv` (تُتخطّى بلا sudo): أثرٌ جانبيٌّ في وحدةٍ
//    مستوردةٍ لا يقعُ بـroot، وNODE_OPTIONS، وتسرّبُ الواصفِ إلى الأبناء، و/proc بالـUID نفسِه.
// لا يُثبتُ شيءٌ هنا هويّةَ العمليةِ ولا حمايةً من root. القياسُ على مضيفٍ واحد.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const ISO_PEM = String(
  generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
);

/** @param {{ uid: number, gid: number, cap?: string, bnd?: string, nnp?: string }} s */
const isoStatus = (s) =>
  [
    'Name:\tnode',
    `Uid:\t${s.uid}\t${s.uid}\t${s.uid}\t${s.uid}`,
    `Gid:\t${s.gid}\t${s.gid}\t${s.gid}\t${s.gid}`,
    `Groups:\t${s.gid} `,
    'CapInh:\t0000000000000000',
    `CapPrm:\t${s.cap ?? '0000000000000000'}`,
    `CapEff:\t${s.cap ?? '0000000000000000'}`,
    `CapBnd:\t${s.bnd ?? '00000000000000c0'}`,
    'CapAmb:\t0000000000000000',
    `NoNewPrivs:\t${s.nnp ?? '1'}`,
  ].join('\n');

/**
 * نظامٌ مزيَّفٌ يسجّلُ كلَّ نداء. يحاكي النواة: بعدَ setuid(≠0) يُرفَضُ setuid(0).
 * @param {Partial<{ euid: number, suid: string, fd: string|Error, regain: boolean, procOwner: number,
 *   cap: string, statusUid: number, bnd: string, nnp: string, bndAfter: string,
 *   stat: Partial<import('../../scripts/worker.mjs').FdStat>, copies: number[] }>} [o]
 */
function isoFakeOs(o = {}) {
  /** @type {string[]} */
  const calls = [];
  let uid = o.euid ?? 0;
  let gid = o.euid ?? 0;
  return {
    calls,
    os: {
      getuid: () => uid,
      geteuid: () => uid,
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
      fstat: (/** @type {number} */ fd) => {
        calls.push(`fstat:${fd}`);
        return {
          type: 'file',
          uid: 0,
          mode: 0o400,
          size: ISO_PEM.length,
          dev: 1,
          ino: 42,
          ...o.stat,
        };
      },
      readFd: (/** @type {number} */ fd) => {
        calls.push(`readFd:${fd}`);
        if (o.fd instanceof Error) throw o.fd;
        return o.fd ?? ISO_PEM;
      },
      closeFd: (/** @type {number} */ fd) => void calls.push(`closeFd:${fd}`),
      scanFds: (/** @type {number} */ dev, /** @type {number} */ ino) => {
        calls.push(`scanFds:${dev}:${ino}`);
        return o.copies ?? [];
      },
      readText: (/** @type {string} */ p) => {
        if (p === '/proc/sys/fs/suid_dumpable') return `${o.suid ?? '0'}\n`;
        if (p === '/proc/self/status') {
          const dropped = uid !== 0;
          return isoStatus({
            uid: o.statusUid ?? uid,
            gid,
            ...(dropped && o.cap !== undefined ? { cap: o.cap } : {}),
            ...(o.bnd !== undefined && !dropped ? { bnd: o.bnd } : {}),
            ...(o.bndAfter !== undefined && dropped ? { bnd: o.bndAfter } : {}),
            ...(o.nnp !== undefined ? { nnp: o.nnp } : {}),
          });
        }
        throw new Error(`unexpected ${p}`);
      },
      ownerOf: () => o.procOwner ?? 0,
    },
  };
}

const ISO_ENV = Object.freeze({
  XUUX_FENCE_ISOLATION: 'required',
  XUUX_DB_FENCE: 'required',
  XUUX_FENCE_KEY_FD: '3',
  XUUX_FENCE_WORKER_UID: '1001',
  XUUX_FENCE_WORKER_GID: '1002',
});

/** @param {() => unknown} fn @param {string} code */
const isoRejects = (fn, code) =>
  assert.throws(fn, (e) => {
    assert.equal(/** @type {any} */ (e).code, code, String(/** @type {any} */ (e).message));
    return true;
  });

/** @param {Record<string, string>} env @param {ReturnType<typeof isoFakeOs>['os']} os */
const boot = (env, os) =>
  bootstrapIsolation(env, { os, execArgv: [], trust: TRUST_OK, trustPaths: ['/fake/node'] });

/** فحصُ ثقةٍ مزيَّفٌ ناجح — لأنّ اختباراتِ النظامِ المزيَّفِ تقيسُ غيرَه (‏ISO-18 يقيسُه). */
const TRUST_OK = () => ({ violations: [], checked: [{}] });

/**
 * نظامُ ملفّاتٍ مزيَّفٌ لعقدِ الثقة: كلُّ مسارٍ مجلّدٌ ملكُ root ‏0755 إلا ما يُعلَن.
 * @param {Record<string, { type?: string, uid?: number, mode?: number, link?: string, sha?: string }>} [m]
 */
const trustFs = (m = {}) => ({
  lstat: (/** @type {string} */ p) => {
    const e = m[p] ?? {};
    const leafish = /\.(mjs|pem)$|\/(node|env|setpriv|sh|sudo|dash)$/.test(p);
    return {
      type: e.link !== undefined ? 'symlink' : (e.type ?? (leafish ? 'file' : 'dir')),
      uid: e.uid ?? 0,
      mode: e.mode ?? 0o755,
    };
  },
  readlink: (/** @type {string} */ p) => String(m[p]?.link),
  sha256: (/** @type {string} */ p) => m[p]?.sha ?? 'f'.repeat(64),
});

test.describe('WL-533 مُقلِعُ العزل — نظامٌ مزيَّف', () => {
  test('ISO-01: الترتيب — fstat ثمّ قراءةٌ وإغلاقٌ قبلَ أيِّ إسقاط، ثمّ setgroups→setgid→setuid ثمّ التحقّق', () => {
    const f = isoFakeOs();
    const r = /** @type {NonNullable<ReturnType<typeof bootstrapIsolation>>} */ (
      boot(ISO_ENV, f.os)
    );
    assert.deepEqual(f.calls, [
      'fstat:3',
      'readFd:3',
      'closeFd:3',
      'setgroups:1002',
      'setgid:1002',
      'setuid:1001',
      'setuid:0',
      'scanFds:1:42',
    ]);
    assert.equal(r.pem, ISO_PEM);
    assert.equal(r.evidence['mode'], 'uid-drop-after-exec');
    assert.deepEqual(r.evidence['caps_zero'], ['CapInh', 'CapPrm', 'CapEff', 'CapAmb']);
    assert.equal(r.evidence['cap_bnd'], 'c0');
    assert.equal(r.evidence['no_new_privs'], true);
    assert.equal(r.evidence['key_fd_open_copies'], 0);
    assert.deepEqual(r.evidence['key_fd'], {
      fd: 3,
      type: 'file',
      owner: 0,
      mode: '400',
      bytes: ISO_PEM.length,
    });
    assert.equal('capabilities_zero' in r.evidence, false, 'لا ادّعاءَ «كلِّ القدرات»');
    const key = pemKeyProvider(r.pem, 'worker-fd:alpha');
    assert.equal(key.hardwareBacked, false, 'مفتاحٌ برمجيٌّ لا يدّعي عتاداً');
    assert.deepEqual(key.publicKeyRaw(), rawEd25519PublicKey(ISO_PEM));
  });

  test('ISO-02: بلا متغيّراتِ عزلٍ ⇒ null (لا عزلَ مطلوب)؛ وoff صريحٌ كذلك', () => {
    const f = isoFakeOs();
    assert.equal(boot({}, f.os), null);
    assert.equal(boot({ XUUX_FENCE_ISOLATION: 'off' }, f.os), null);
    assert.deepEqual(f.calls, []);
    assert.equal(isolationMode({ XUUX_FENCE_ISOLATION: ' required ' }), 'required');
  });

  for (const [name, env] of /** @type {Array<[string, Record<string, string>]>} */ ([
    ['XUUX_FENCE_KEY_FD بلا وضع', { XUUX_FENCE_KEY_FD: '3' }],
    ['UID/GID بلا وضع', { XUUX_FENCE_WORKER_UID: '1001', XUUX_FENCE_WORKER_GID: '1002' }],
    ['off مع واصف', { XUUX_FENCE_ISOLATION: 'off', XUUX_FENCE_KEY_FD: '3' }],
    ['وضعٌ مجهول', { ...ISO_ENV, XUUX_FENCE_ISOLATION: 'yes' }],
    ['required بلا واصف', { ...ISO_ENV, XUUX_FENCE_KEY_FD: '' }],
    ['required بلا uid', { ...ISO_ENV, XUUX_FENCE_WORKER_UID: '' }],
    ['required بلا gid', { ...ISO_ENV, XUUX_FENCE_WORKER_GID: '' }],
    ['تراجعٌ إلى XUUX_FENCE_WORKER_KEY', { ...ISO_ENV, XUUX_FENCE_WORKER_KEY: '/k.pem' }],
    ['بلا XUUX_DB_FENCE=required', { ...ISO_ENV, XUUX_DB_FENCE: '' }],
    ['uid=0', { ...ISO_ENV, XUUX_FENCE_WORKER_UID: '0' }],
    ['gid=0', { ...ISO_ENV, XUUX_FENCE_WORKER_GID: '0' }],
    ['uid غيرُ رقميّ', { ...ISO_ENV, XUUX_FENCE_WORKER_UID: 'alpha' }],
    ['fd=0', { ...ISO_ENV, XUUX_FENCE_KEY_FD: '0' }],
    ['fd=2', { ...ISO_ENV, XUUX_FENCE_KEY_FD: '2' }],
    ['fd سالب', { ...ISO_ENV, XUUX_FENCE_KEY_FD: '-3' }],
    ['fd خارجَ مدى المسح', { ...ISO_ENV, XUUX_FENCE_KEY_FD: '5000' }],
  ])) {
    test(`ISO-03: يفشلُ مغلقاً — ${name}`, () => {
      const f = isoFakeOs();
      isoRejects(() => boot(env, f.os), ISOLATION_ERRORS.CONFIG);
      assert.deepEqual(f.calls, [], 'لا قراءةَ ولا إسقاطَ قبلَ صحّةِ الإعداد');
    });
  }

  for (const [
    name,
    env,
    argv,
  ] of /** @type {Array<[string, Record<string, string>, string[]]>} */ ([
    ['NODE_OPTIONS', { ...ISO_ENV, NODE_OPTIONS: '--require /tmp/x.cjs' }, []],
    ['NODE_PATH', { ...ISO_ENV, NODE_PATH: '/tmp' }, []],
    ['LD_PRELOAD', { ...ISO_ENV, LD_PRELOAD: '/tmp/x.so' }, []],
    ['LD_LIBRARY_PATH', { ...ISO_ENV, LD_LIBRARY_PATH: '/tmp' }, []],
    ['DYLD_INSERT_LIBRARIES', { ...ISO_ENV, DYLD_INSERT_LIBRARIES: '/tmp/x' }, []],
    ['execArgv --import', ISO_ENV, ['--import=/tmp/x.mjs']],
  ])) {
    test(`ISO-04: مدخلُ إطلاقٍ عدائيّ ⇒ HOSTILE_ENV قبلَ قراءةِ الواصف — ${name}`, () => {
      const f = isoFakeOs();
      isoRejects(
        () => bootstrapIsolation(env, { os: f.os, execArgv: argv }),
        ISOLATION_ERRORS.HOSTILE_ENV,
      );
      assert.deepEqual(f.calls, []);
    });
  }

  test('ISO-05: NODE_ENV ليس عدائيّاً', () => {
    assert.deepEqual(hostileLaunchInputs({ NODE_ENV: 'production' }, []), []);
  });

  test('ISO-06: عمليةٌ بُدئت بغيرِ root ⇒ NOT_PRIVILEGED ولا يُقرأُ الواصف', () => {
    const f = isoFakeOs({ euid: 1001 });
    isoRejects(() => boot(ISO_ENV, f.os), ISOLATION_ERRORS.NOT_PRIVILEGED);
    assert.deepEqual(f.calls, []);
  });

  for (const [name, o] of /** @type {Array<[string, Parameters<typeof isoFakeOs>[0]]>} */ ([
    ['NoNewPrivs=0', { nnp: '0' }],
    ['CapBnd كامل (بلا setpriv)', { bnd: '000001ffffffffff' }],
    ['CapBnd فيه CAP_DAC_OVERRIDE', { bnd: '00000000000000c2' }],
  ])) {
    test(`ISO-07: سياسةُ الإطلاق ⇒ LAUNCH_POLICY قبلَ قراءةِ الواصف — ${name}`, () => {
      const f = isoFakeOs(o);
      isoRejects(() => boot(ISO_ENV, f.os), ISOLATION_ERRORS.LAUNCH_POLICY);
      assert.deepEqual(f.calls, []);
    });
  }

  test('ISO-08: fs.suid_dumpable=1 ⇒ مرفوضٌ قبلَ قراءةِ المفتاح؛ و2 مقبول', () => {
    const f = isoFakeOs({ suid: '1' });
    isoRejects(() => boot(ISO_ENV, f.os), ISOLATION_ERRORS.DUMPABLE_POLICY);
    assert.deepEqual(f.calls, []);
    assert.equal(boot(ISO_ENV, isoFakeOs({ suid: '2' }).os)?.evidence['suid_dumpable'], '2');
  });

  for (const [name, stat] of /** @type {Array<[string, Record<string, unknown>]>} */ ([
    ['أنبوب (fifo)', { type: 'fifo' }],
    ['مقبس', { type: 'socket' }],
    ['طرفيّة', { type: 'char' }],
    ['مجلّد', { type: 'dir' }],
    ['مالكٌ غيرُ root', { uid: 1001 }],
    ['0440 (group)', { mode: 0o440 }],
    ['0604 (other)', { mode: 0o604 }],
    ['0200 (المالكُ لا يقرأ)', { mode: 0o200 }],
    ['حجمٌ صفر', { size: 0 }],
    ['حجمٌ ضخم', { size: 16_385 }],
  ])) {
    test(`ISO-09: عقدُ الواصف ⇒ KEY_FD ويُغلَقُ الواصفُ ولا يُقرأُ ولا يُسقَط — ${name}`, () => {
      const f = isoFakeOs({ stat });
      isoRejects(() => boot(ISO_ENV, f.os), ISOLATION_ERRORS.KEY_FD);
      assert.deepEqual(f.calls, ['fstat:3', 'closeFd:3']);
    });
  }

  test('ISO-10: keyFdViolations — عقدٌ صريحٌ لكلِّ حقل', () => {
    assert.deepEqual(
      keyFdViolations({ type: 'file', uid: 0, mode: 0o400, size: 119, dev: 1, ino: 1 }),
      [],
    );
    assert.deepEqual(
      keyFdViolations({ type: 'file', uid: 0, mode: 0o600, size: 119, dev: 1, ino: 1 }),
      [],
    );
    assert.equal(
      keyFdViolations({ type: 'fifo', uid: 5, mode: 0o666, size: 0, dev: 1, ino: 1 }).length,
      4,
    );
  });

  test('ISO-11: فشلُ قراءةِ الواصف ⇒ KEY_FD ويُغلَقُ ولا يُسقَطُ شيء', () => {
    const f = isoFakeOs({ fd: new Error('EBADF') });
    isoRejects(() => boot(ISO_ENV, f.os), ISOLATION_ERRORS.KEY_FD);
    assert.deepEqual(f.calls, ['fstat:3', 'readFd:3', 'closeFd:3']);
  });

  test('ISO-12: محتوًى ليس مفتاحَ Ed25519 ⇒ KEY_FD قبلَ الإسقاط', () => {
    for (const fd of [
      'not a key',
      String(
        generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
          type: 'pkcs8',
          format: 'pem',
        }),
      ),
    ]) {
      const f = isoFakeOs({ fd });
      isoRejects(() => boot(ISO_ENV, f.os), ISOLATION_ERRORS.KEY_FD);
      assert.ok(!f.calls.some((c) => c.startsWith('set')));
    }
  });

  for (const [name, o] of /** @type {Array<[string, Parameters<typeof isoFakeOs>[0]]>} */ ([
    ['setuid(0) ينجحُ بعدَ الإسقاط', { regain: true }],
    ['/proc/self/environ ملكُ العامل (dumpable=1)', { procOwner: 1001 }],
    ['CapEff≠0 بعدَ الإسقاط', { cap: '0000000000000080' }],
    ['Uid مختلف', { statusUid: 1003 }],
    ['CapBnd اتّسعَ بعدَ الإسقاط', { bndAfter: '00000000000000c4' }],
    ['نسخةٌ مكرَّرةٌ من واصفِ المفتاحِ مفتوحة (4<&3)', { copies: [4] }],
  ])) {
    test(`ISO-13: التحقّقُ يفشلُ مغلقاً ⇒ VERIFY_FAILED — ${name}`, () => {
      isoRejects(() => boot(ISO_ENV, isoFakeOs(o).os), ISOLATION_ERRORS.VERIFY_FAILED);
    });
  }

  test('ISO-14: prepareFencedWorker — العزلُ الإلزاميُّ بلا مفتاحٍ معزولٍ يُرفَض (لا تراجعَ إلى الملف)', async () => {
    await assert.rejects(
      prepareFencedWorker({
        env: {
          XUUX_FENCE_WORKER_ID: 'alpha',
          XUUX_FENCE_ISOLATION: 'required',
          XUUX_FENCE_WORKER_KEY: '/k.pem',
        },
        halt: /** @type {any} */ ({}),
      }),
      (e) =>
        /** @type {any} */ (e).code === FENCE_ERRORS.WORKER_CONFIG &&
        /XUUX_FENCE_ISOLATION=required/.test(String(/** @type {any} */ (e).message)),
    );
    const r = /** @type {NonNullable<ReturnType<typeof bootstrapIsolation>>} */ (
      boot(ISO_ENV, isoFakeOs().os)
    );
    await assert.rejects(
      prepareFencedWorker({
        env: { XUUX_FENCE_WORKER_ID: 'alpha', XUUX_FENCE_WORKER_KEY: '/k.pem' },
        halt: /** @type {any} */ ({}),
        isolated: { key: pemKeyProvider(r.pem, 'worker-fd:alpha'), evidence: r.evidence },
      }),
      (e) => /** @type {any} */ (e).code === FENCE_ERRORS.WORKER_CONFIG,
    );
  });

  test('ISO-15: المُطلِق — بيئةُ سماحٍ صريحة: NODE_OPTIONS وLD_PRELOAD والمفتاحُ لا تعبر', () => {
    const l = isolatedLaunchCommand({
      node: '/usr/local/bin/node',
      entry: '/app/scripts/worker.mjs',
      args: ['--once'],
      keyFile: '/app/keys/alpha.root.pem',
      uid: 987,
      gid: 987,
      env: {
        NODE_OPTIONS: '--require /tmp/evil.cjs',
        LD_PRELOAD: '/tmp/evil.so',
        XUUX_FENCE_WORKER_KEY: '/app/keys/alpha.pem',
        HOME: '/root',
        DATABASE_URL: 'postgresql:///x',
      },
      pass: ['DATABASE_URL'],
      trust: { fs: trustFs() },
    });
    // مسارٌ مطلقٌ لا بحثٌ في PATH (‏الجولةُ الثالثة): الملفُّ الذي يُفحَصُ هو الذي يُشغَّل.
    assert.equal(l.command, LAUNCH_SUDO);
    assert.deepEqual(l.args.slice(0, 3), ['-n', '/usr/bin/env', '-i']);
    assert.deepEqual(l.env, {
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
      DATABASE_URL: 'postgresql:///x',
      XUUX_FENCE_ISOLATION: 'required',
      XUUX_FENCE_KEY_FD: '3',
      XUUX_FENCE_WORKER_UID: '987',
      XUUX_FENCE_WORKER_GID: '987',
    });
    const joined = l.args.join(' ');
    for (const bad of ['NODE_OPTIONS', 'LD_PRELOAD', 'evil', 'HOME=', 'alpha.pem'])
      assert.ok(!joined.includes(bad), `«${bad}» عبرَ المُطلِق`);
    assert.ok(
      joined.includes('/usr/bin/setpriv --no-new-privs --bounding-set -all,+setuid,+setgid'),
    );
    assert.equal(l.args.at(-3), '/usr/local/bin/node');
    assert.equal(isolatedLaunchCommand({ ...BASE_LAUNCH, sudo: false }).command, '/usr/bin/env');
  });

  for (const name of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'XUUX_FENCE_WORKER_KEY',
    'XUUX_FENCE_KEY_FD',
    'XUUX_FENCE_ISOLATION',
    'lower_case',
  ]) {
    test(`ISO-16: المُطلِقُ يرفضُ تمريرَ «${name}»`, () => {
      isoRejects(
        () => isolatedLaunchCommand({ ...BASE_LAUNCH, pass: [name], env: { [name]: 'x' } }),
        ISOLATION_ERRORS.HOSTILE_ENV,
      );
    });
  }

  test('ISO-17: المُطلِقُ يرفضُ مساراتٍ نسبيّةً وuid/gid=0 وقيمةً فيها سطرٌ جديد', () => {
    isoRejects(
      () => isolatedLaunchCommand({ ...BASE_LAUNCH, node: 'node' }),
      ISOLATION_ERRORS.CONFIG,
    );
    isoRejects(() => isolatedLaunchCommand({ ...BASE_LAUNCH, uid: 0 }), ISOLATION_ERRORS.CONFIG);
    isoRejects(
      () => isolatedLaunchCommand({ ...BASE_LAUNCH, pass: ['A'], env: { A: 'x\nB=y' } }),
      ISOLATION_ERRORS.CONFIG,
    );
  });
});

const BASE_LAUNCH = Object.freeze({
  node: '/usr/local/bin/node',
  entry: '/app/scripts/worker.mjs',
  keyFile: '/app/k.pem',
  uid: 987,
  gid: 987,
  env: {},
  trust: { fs: trustFs() },
});

const WORKER_ENTRY = fileURLToPath(new URL('../../scripts/worker.mjs', import.meta.url));
const WRITER_ENTRY = fileURLToPath(new URL('../../scripts/fence-lab-writer.mjs', import.meta.url));

/** @param {string} file */
const staticImports = (file) =>
  [
    ...readFileSync(file, 'utf8').matchAll(
      /^\s*(?:import|export)\s(?:[^'";]*?\sfrom\s)?\s*'([^']+)'/gm,
    ),
  ].map((m) => String(m[1]));

test('ISO-40: رسمُ الاستيرادِ الثابت — المُقلِعُ `node:` وحدَه، وكاتبُ المختبرِ `node:` + المُقلِع', () => {
  const w = staticImports(WORKER_ENTRY);
  assert.ok(w.length >= 3, `لا استيراد؟ ${w}`);
  assert.deepEqual(
    w.filter((s) => !s.startsWith('node:')),
    [],
    'وحدةٌ تطبيقيّةٌ مستوردةٌ ثابتاً تُقيَّمُ بـroot قبلَ الإسقاط',
  );
  const wr = staticImports(WRITER_ENTRY);
  assert.deepEqual(
    wr.filter((s) => !s.startsWith('node:') && s !== './worker.mjs'),
    [],
  );
  // `main()` يبدأُ بالمُقلِع ثمّ `loadApp()`؛ ولا `await import` خارجَ `loadApp`/الكاتب.
  const src = readFileSync(WORKER_ENTRY, 'utf8');
  const mainBody = src.slice(src.indexOf('async function main() {'));
  assert.ok(
    mainBody.indexOf('bootstrapIsolation(process.env)') < mainBody.indexOf('await loadApp()'),
  );
});

/** @param {string[]} args @param {Record<string, string>} env */
const runClean = (args, env) =>
  spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...env },
  });

test('ISO-20: عمليةٌ حقيقيّةٌ بلا root تطلبُ العزل ⇒ NOT_PRIVILEGED (لا عزلٌ صامت)', (t) => {
  if (process.platform !== 'linux') return t.skip('Linux فقط');
  if (process.getuid?.() === 0) return t.skip('يعملُ بـroot');
  const r = runClean([WORKER_ENTRY], ISO_ENV);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, new RegExp(ISOLATION_ERRORS.NOT_PRIVILEGED));
});

test('ISO-21: نقطةُ الدخولِ الحقيقيّةُ تفشلُ مغلقةً بلا واصفٍ أو مع مسارِ المفتاحِ القديم', (t) => {
  if (process.platform !== 'linux') return t.skip('Linux فقط');
  for (const env of [
    { XUUX_FENCE_ISOLATION: 'required', XUUX_DB_FENCE: 'required' },
    { ...ISO_ENV, XUUX_FENCE_WORKER_KEY: '/k.pem' },
    { XUUX_FENCE_KEY_FD: '3' },
  ]) {
    const r = runClean([WORKER_ENTRY], env);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, new RegExp(ISOLATION_ERRORS.CONFIG), JSON.stringify(env));
  }
});

// ── عملياتٌ حقيقيّةٌ بـroot (sudo -n + setpriv) ──────────────────────────────────────────────

const canRoot = () =>
  process.platform === 'linux' &&
  spawnSync('sudo', ['-n', 'true']).status === 0 &&
  spawnSync('/usr/bin/setpriv', ['--version']).status === 0 &&
  spawnSync('id', ['-u', 'nobody']).status === 0;
const ROOT_SKIP = 'لا sudo -n أو setpriv أو nobody (المختبرُ يقيسُ LAB-UID-06)';

/** @param {string} what */
const idOf = (what) =>
  Number(spawnSync('id', [what, 'nobody'], { encoding: 'utf8' }).stdout.trim());

/** @param {string[]} a */
const sudo = (a) => {
  const r = spawnSync('sudo', ['-n', ...a], { encoding: 'utf8' });
  assert.equal(r.status, 0, `sudo ${a.join(' ')}: ${r.stderr}`);
  return r;
};

/** @type {string | null} */
let trustedNodeDir = null;
/**
 * نسخةُ node موثوقة: ملكُ root ‏0755 في مجلّدٍ ملكِ root (‏node المضيفِ هنا 0777 ملكُ uid 1001 — يرفضُه
 * عقدُ الثقة، وهذا ما يجب). تُنشأُ مرّةً للملفّ وتُحذَفُ في نهايتِه.
 */
function trustedNode() {
  if (trustedNodeDir === null) {
    const d = mkdtempSync(join(tmpdir(), 'xuux-iso-node-'));
    sudo(['install', '-o', 'root', '-g', 'root', '-m', '0755', process.execPath, join(d, 'node')]);
    sudo(['chown', 'root:root', d]);
    sudo(['chmod', '0755', d]);
    trustedNodeDir = d;
  }
  return join(trustedNodeDir, 'node');
}
test.after(() => {
  if (trustedNodeDir !== null) spawnSync('sudo', ['-n', 'rm', '-rf', trustedNodeDir]);
});

/**
 * شجرةٌ **ملكُ root** لا يكتبُها غيرُه (‏عقدُ الثقة)، يقرؤها root منقوصُ القدرات (‏لا DAC_OVERRIDE):
 * `/tmp/…` ‏0755، ومفتاحٌ ملكُ root ‏0400، ومجلّدُ علاماتٍ 0777 خارجَ مساراتِ الشيفرة. الكتابةُ عبرَ sudo.
 */
function rootTree() {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-iso-'));
  const stage = mkdtempSync(join(tmpdir(), 'xuux-iso-stage-'));
  sudo(['chown', 'root:root', dir]);
  sudo(['chmod', '0755', dir]);
  /** @param {string} rel @param {string} body @param {string} [mode] */
  const put = (rel, body, mode = '0644') => {
    const tmp = join(stage, 'f');
    writeFileSync(tmp, body);
    sudo(['install', '-D', '-o', 'root', '-g', 'root', '-m', mode, tmp, join(dir, rel)]);
    rmSync(tmp);
    return join(dir, rel);
  };
  put('scripts/worker.mjs', readFileSync(WORKER_ENTRY, 'utf8'));
  const marks = join(dir, 'marks');
  sudo(['install', '-d', '-o', 'root', '-g', 'root', '-m', '0777', marks]);
  const keyFile = put('k.root.pem', ISO_PEM, '0400');
  /** @param {string} name */
  const mark = (name) => {
    const p = join(marks, name);
    return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n') : null;
  };
  return {
    dir,
    stage,
    keyFile,
    marks,
    put,
    mark,
    /** @param {string} name */
    unmark: (name) => spawnSync('sudo', ['-n', 'rm', '-f', join(marks, name)]),
    clean: () => {
      spawnSync('sudo', ['-n', 'rm', '-rf', dir]);
      rmSync(stage, { recursive: true, force: true });
    },
  };
}

/** @param {{ command: string, args: string[] }} l */
const runLaunch = (l) => spawnSync(l.command, l.args, { encoding: 'utf8', timeout: 30_000 });

/** وحداتُ `loadApp()` كلُّها — كلٌّ منها يسجّلُ `getuid()` لحظةَ تقييمِه (أثرٌ جانبيّ). */
const APP_MODULES = [
  'src/root-of-trust/persistent-log.mjs',
  'src/root-of-trust/index.mjs',
  'src/execution/queue.mjs',
  'src/execution/worker.mjs',
  'src/execution/pending-results.mjs',
  'src/execution/db-recovery.mjs',
  'src/policy/quota.mjs',
  'src/policy/loader.mjs',
  'src/persistence/db.mjs',
  'src/execution/worker-registry.mjs',
  'src/fence/db-fence.mjs',
];

/** @param {ReturnType<typeof rootTree>} tree */
function hookApp(tree) {
  for (const rel of APP_MODULES) {
    tree.put(
      rel,
      `import { appendFileSync } from 'node:fs';\n` +
        `appendFileSync(${JSON.stringify(join(tree.marks, 'app'))}, process.getuid() + '\\n');\n`,
    );
  }
}

test('ISO-41: عدائيّ — أثرٌ جانبيٌّ في كلِّ وحدةٍ تطبيقيّةٍ مستوردةٍ يقعُ بالهويّةِ المُسقَطة، والضابطُ يكشفُ root', (t) => {
  if (!canRoot()) return t.skip(ROOT_SKIP);
  const tree = rootTree();
  try {
    hookApp(tree);
    const uid = idOf('-u');
    const gid = idOf('-g');
    const launch = (/** @type {string} */ entry) =>
      runLaunch(
        isolatedLaunchCommand({
          node: trustedNode(),
          entry,
          keyFile: tree.keyFile,
          uid,
          gid,
          env: { XUUX_DB_FENCE: 'required' },
          pass: ['XUUX_DB_FENCE'],
        }),
      );
    const r = launch(join(tree.dir, 'scripts', 'worker.mjs'));
    assert.doesNotMatch(r.stderr, /FENCE_ISOLATION_/, `المُقلِعُ رفض: ${r.stderr}`);
    const seen = tree.mark('app');
    assert.ok(seen !== null, `لم تُحمَّلِ الوحداتُ أصلاً — القياسُ فارغ: ${r.stderr}`);
    assert.equal(seen.length, APP_MODULES.length, String(seen));
    assert.deepEqual([...new Set(seen)], [String(uid)], 'وحدةٌ تطبيقيّةٌ قُيِّمت بـroot');
    // الضابط: نقطةُ دخولٍ تستوردُ وحدةً تطبيقيّةً ثابتاً (كما كان قبلَ المراجعة) ⇒ تُقيَّمُ بـroot.
    tree.unmark('app');
    const ctl = tree.put(
      'scripts/static-entry.mjs',
      `import '../src/execution/queue.mjs';\nimport { bootstrapIsolation } from './worker.mjs';\nbootstrapIsolation(process.env);\n`,
    );
    launch(ctl);
    assert.deepEqual(tree.mark('app'), ['0'], 'الضابطُ لا يكشفُ root ⇒ المسبارُ لا يقيس');
  } finally {
    tree.clean();
  }
});

test('ISO-42: NODE_OPTIONS — إطلاقٌ مباشرٌ يُنفِّذُ الحِمْلَ بـroot (خطرٌ مقيس) والمُقلِعُ يرفض؛ المُطلِقُ يُسقِطُه', (t) => {
  if (!canRoot()) return t.skip(ROOT_SKIP);
  const tree = rootTree();
  try {
    hookApp(tree);
    const pre = tree.put(
      'pre.cjs',
      `require('node:fs').appendFileSync(${JSON.stringify(join(tree.marks, 'pre'))}, process.getuid() + '\\n');\n`,
    );
    const parentEnv = { XUUX_DB_FENCE: 'required', NODE_OPTIONS: `--require ${pre}` };
    const l = isolatedLaunchCommand({
      node: trustedNode(),
      entry: join(tree.dir, 'scripts', 'worker.mjs'),
      keyFile: tree.keyFile,
      uid: idOf('-u'),
      gid: idOf('-g'),
      env: parentEnv,
      pass: ['XUUX_DB_FENCE'],
    });
    // (أ) عبرَ المُطلِق: البيئةُ الموروثةُ لا تعبر.
    runLaunch(l);
    assert.equal(tree.mark('pre'), null, 'NODE_OPTIONS عبرَ بيئةَ السماح');
    assert.ok(tree.mark('app') !== null, 'المُقلِعُ لم يُكمِل ⇒ (أ) لا يقيس');
    tree.unmark('app');
    // (ب) تجاوزُ المُطلِق (حقنٌ في env): الحِمْلُ يعملُ بـroot قبلَ المُقلِع — لا يمنعُه المُقلِع،
    //     بل يكشفُه ويرفضُ الإكمالَ فلا يُقرأُ المفتاحُ ولا تُحمَّلُ وحدةٌ تطبيقيّة.
    const i = l.args.indexOf('-i');
    const bypass = [
      ...l.args.slice(0, i + 1),
      `NODE_OPTIONS=--require ${pre}`,
      ...l.args.slice(i + 1),
    ];
    const r = spawnSync(l.command, bypass, { encoding: 'utf8', timeout: 30_000 });
    assert.deepEqual(tree.mark('pre'), ['0'], 'الحِمْلُ يعملُ بـroot — الخطرُ قائمٌ بلا المُطلِق');
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, new RegExp(ISOLATION_ERRORS.HOSTILE_ENV));
    assert.equal(tree.mark('app'), null, 'وحداتٌ تطبيقيّةٌ حُمِّلت رغمَ الرفض');
  } finally {
    tree.clean();
  }
});

const FD_SCAN_PY = `
import os, sys, json
st = os.stat(sys.argv[1]); hits = []
for fd in os.listdir('/proc/self/fd'):
    try:
        s = os.fstat(int(fd))
        if (s.st_dev, s.st_ino) == (st.st_dev, st.st_ino): hits.append(int(fd))
    except OSError: pass
print(json.dumps({'uid': os.getuid(), 'hits': hits}))
`;

test('ISO-43: الواصفُ لا يتسرّبُ إلى الأبناء؛ والضابطُ (4<&3) يفشلُ بـVERIFY_FAILED', (t) => {
  if (!canRoot()) return t.skip(ROOT_SKIP);
  const python = spawnSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
  if (python === '') return t.skip('لا python3');
  const tree = rootTree();
  try {
    const entry = tree.put(
      'scripts/fd-child.mjs',
      `import { spawnSync } from 'node:child_process';\n` +
        `import { bootstrapIsolation } from './worker.mjs';\n` +
        `try {\n  const r = bootstrapIsolation(process.env);\n` +
        `  const c = spawnSync(${JSON.stringify(python)}, ['-c', ${JSON.stringify(FD_SCAN_PY)}, ${JSON.stringify(tree.keyFile)}], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });\n` +
        `  process.stdout.write(JSON.stringify({ ok: true, evidence: r?.evidence, child: JSON.parse(c.stdout) }) + '\\n');\n` +
        `} catch (e) {\n  process.stdout.write(JSON.stringify({ ok: false, code: e.code, message: e.message }) + '\\n');\n}\n`,
    );
    const uid = idOf('-u');
    const l = isolatedLaunchCommand({
      node: trustedNode(),
      entry,
      keyFile: tree.keyFile,
      uid,
      gid: idOf('-g'),
      env: { XUUX_DB_FENCE: 'required' },
      pass: ['XUUX_DB_FENCE'],
    });
    const ok = JSON.parse(runLaunch(l).stdout || '{}');
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.deepEqual(ok.child, { uid, hits: [] }, 'الابنُ ورثَ واصفاً إلى ملفِّ المفتاح');
    assert.equal(ok.evidence.key_fd_open_copies, 0);
    assert.deepEqual(ok.evidence.key_fd, {
      fd: 3,
      type: 'file',
      owner: 0,
      mode: '400',
      bytes: ISO_PEM.length,
    });
    assert.equal(ok.evidence.cap_bnd, 'c0');
    // الضابط: مُطلِقٌ يكرّرُ الواصف (4<&3) ⇒ نسخةٌ تبقى بعدَ إغلاقِ 3 ⇒ التحقّقُ يرفض.
    const dup = l.args.map((a) =>
      a === 'k=$1; shift; exec "$@" 3<"$k"' ? 'k=$1; shift; exec "$@" 3<"$k" 4<&3' : a,
    );
    assert.notDeepEqual(dup, l.args);
    const bad = JSON.parse(spawnSync(l.command, dup, { encoding: 'utf8' }).stdout || '{}');
    assert.equal(bad.code, ISOLATION_ERRORS.VERIFY_FAILED, JSON.stringify(bad));
    assert.match(bad.message, /نسخُ واصفِ المفتاحِ مفتوحة: 4/);
  } finally {
    tree.clean();
  }
});

test('ISO-44: عقدُ الواصفِ على عمليةٍ حقيقيّة — مفتاحٌ يقرؤه غيرُ root (0644) أو يملكُه غيرُ root ⇒ KEY_FD', (t) => {
  if (!canRoot()) return t.skip(ROOT_SKIP);
  const tree = rootTree();
  try {
    hookApp(tree);
    const base = {
      node: trustedNode(),
      entry: join(tree.dir, 'scripts', 'worker.mjs'),
      uid: idOf('-u'),
      gid: idOf('-g'),
      env: { XUUX_DB_FENCE: 'required' },
      pass: ['XUUX_DB_FENCE'],
    };
    // مفتاحٌ ملكُ غيرِ root ‏0644 في مجلّدٍ يقرؤه root منقوصُ القدرات.
    chmodSync(tree.stage, 0o755);
    const loose = join(tree.stage, 'loose.pem');
    writeFileSync(loose, ISO_PEM, { mode: 0o644 });
    chmodSync(loose, 0o644);
    for (const keyFile of [loose]) {
      const r = runLaunch(isolatedLaunchCommand({ ...base, keyFile }));
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, new RegExp(ISOLATION_ERRORS.KEY_FD));
    }
    assert.equal(tree.mark('app'), null, 'وحداتٌ تطبيقيّةٌ حُمِّلت رغمَ رفضِ الواصف');
  } finally {
    tree.clean();
  }
});

test('ISO-45: root ⇒ nobody — الـUID نفسُه لا يقرأُ /proc/<pid>/environ ولا fd، والضابطُ مكشوف', async (t) => {
  if (!canRoot()) return t.skip(ROOT_SKIP);
  const tree = rootTree();
  const entry = tree.put(
    'scripts/hold.mjs',
    `import { bootstrapIsolation } from './worker.mjs';\n` +
      `const r = bootstrapIsolation(process.env);\n` +
      `process.stdout.write(JSON.stringify({ pid: process.pid, evidence: r?.evidence }) + '\\n');\n` +
      `setInterval(() => {}, 1000);\n`,
  );
  const l = isolatedLaunchCommand({
    node: trustedNode(),
    entry,
    keyFile: tree.keyFile,
    uid: idOf('-u'),
    gid: idOf('-g'),
    env: { XUUX_DB_FENCE: 'required' },
    pass: ['XUUX_DB_FENCE'],
  });
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
  const iso = spawn(l.command, l.args, { stdio: ['ignore', 'pipe', 'inherit'] });
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
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  /** @type {any} */
  let m = {};
  /** @type {any} */
  let c = {};
  try {
    m = await firstLine(iso);
    c = await firstLine(ctl);
    assert.equal(m.evidence?.uid, idOf('-u'), JSON.stringify(m));
    /** @param {string[]} a */
    const asNobody = (a) => spawnSync('sudo', ['-n', '-u', 'nobody', ...a], { encoding: 'utf8' });
    assert.notEqual(asNobody(['cat', `/proc/${m.pid}/environ`]).status, 0, 'nobody قرأ environ');
    assert.notEqual(asNobody(['ls', `/proc/${m.pid}/fd`]).status, 0, 'nobody سردَ الواصفات');
    assert.equal(asNobody(['cat', `/proc/${c.pid}/environ`]).status, 0, 'الضابطُ غيرُ مكشوف');
    assert.equal(asNobody(['ls', `/proc/${c.pid}/fd`]).status, 0, 'الضابطُ غيرُ مكشوف');
  } finally {
    for (const pid of [m.pid, c.pid]) {
      if (Number.isInteger(pid)) spawnSync('sudo', ['-n', 'kill', '-KILL', String(pid)]);
    }
    iso.kill();
    ctl.kill();
    tree.clean();
  }
});

// ── ثقةُ الشيفرةِ العاملةِ بـroot (‏الجولةُ الثالثة) ────────────────────────────────────────────────
//  - ISO-18/19/22: نظامٌ مزيَّف؛ ISO-46/47: عملياتٌ حقيقيّة.

test('ISO-18: المُقلِعُ يرفضُ شيفرةً غيرَ موثوقةٍ قبلَ أيِّ قراءةٍ للمفتاحِ أو إسقاط (UNTRUSTED_CODE)', () => {
  const f = isoFakeOs();
  /** @type {readonly string[]} */
  let asked = [];
  isoRejects(
    () =>
      bootstrapIsolation(ISO_ENV, {
        os: f.os,
        execArgv: [],
        trustPaths: ['/usr/local/bin/node', '/app/scripts/worker.mjs'],
        trust: (ps) => {
          asked = ps;
          return { violations: ['/usr/local/bin/node: ملفٌّ يكتبُه غيرُ root (777)'], checked: [] };
        },
      }),
    ISOLATION_ERRORS.UNTRUSTED_CODE,
  );
  assert.deepEqual(asked, ['/usr/local/bin/node', '/app/scripts/worker.mjs']);
  assert.deepEqual(f.calls, [], 'نداءٌ للنظامِ (fstat/readFd/set*id) قبلَ رفضِ الثقة');
  // والمساراتُ الافتراضيّة: node ونقطةُ الدخولِ والمُقلِعُ ووحداتُ التطبيق.
  const d = bootstrapTrustPaths(['/n', '/app/scripts/worker.mjs']);
  assert.ok(d.includes(process.execPath) && d.includes('/app/scripts/worker.mjs'));
  assert.ok(d.includes(WORKER_ENTRY));
  assert.equal(d.filter((p) => p.includes('/src/')).length, BOOT_APP_MODULES.length);
});

test.describe('ISO-19: عقدُ الثقة — codeTrustViolations على نظامِ ملفّاتٍ مزيَّف', () => {
  /** @param {Parameters<typeof trustFs>[0]} m @param {string[]} paths @param {object} [o] */
  const v = (m, paths, o = {}) => codeTrustViolations(paths, { fs: trustFs(m), ...o });
  test('مسارٌ كلُّه root ‏0755 ⇒ مقبول', () => {
    const r = v({}, ['/usr/bin/node']);
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.checked, [{ path: '/usr/bin/node', real: '/usr/bin/node' }]);
  });
  test('ملفٌّ 0777 ملكُ 1001 (كما على مضيفِ المختبر) ⇒ مرفوض', () => {
    const r = v({ '/usr/local/bin/node': { uid: 1001, mode: 0o777 } }, ['/usr/local/bin/node']);
    assert.equal(r.violations.length, 2, String(r.violations));
  });
  test('ملفٌّ ملكُ root يكتبُه group ⇒ مرفوض', () => {
    assert.equal(v({ '/a/node': { mode: 0o775 } }, ['/a/node']).violations.length, 1);
  });
  test('مجلّدٌ ملكُ مستخدم، أو يكتبُه group بلا sticky ⇒ مرفوض؛ و/tmp ‏1777 ملكُ root ⇒ مقبول', () => {
    assert.match(
      v({ '/home/u': { uid: 1000 } }, ['/home/u/node']).violations[0] ?? '',
      /ملكُ 1000/,
    );
    assert.match(v({ '/opt': { mode: 0o775 } }, ['/opt/node']).violations[0] ?? '', /775/);
    assert.deepEqual(v({ '/tmp': { mode: 0o1777 } }, ['/tmp/x/node']).violations, []);
    assert.equal(v({ '/tmp': { mode: 0o777 } }, ['/tmp/x/node']).violations.length, 1);
  });
  test('رابطٌ رمزيٌّ: كلُّ قفزةٍ تُفحَص — رابطٌ ملكُ مستخدم، أو هدفٌ في مجلّدٍ يكتبُه غيرُ root ⇒ مرفوض', () => {
    // /bin -> usr/bin (‏ملكُ root) ⇒ مقبولٌ ويُفحَصُ /usr/bin.
    const ok = v({ '/bin': { link: 'usr/bin' } }, ['/bin/sh']);
    assert.deepEqual(ok.violations, []);
    assert.equal(ok.checked[0]?.real, '/usr/bin/sh');
    assert.equal(
      v({ '/usr/bin/x': { link: '/opt/node', uid: 1000 } }, ['/usr/bin/x']).violations.length,
      1,
    );
    // قفزةٌ وسيطةٌ إلى مجلّدٍ يكتبُه مستخدم (‏لا يكشفُها realpath واحد ثمّ فحصُ الهدفِ وحدَه إن عادَ الرابط).
    const hop = v(
      {
        '/usr/bin/n': { link: '/home/u/n' },
        '/home/u': { uid: 1000 },
        '/home/u/n': { link: '/usr/lib/node' },
      },
      ['/usr/bin/n'],
    );
    assert.deepEqual(hop.violations, ['/home/u: مجلّدٌ ملكُ 1000'], String(hop.violations));
    const loop = v({ '/a/x': { link: '/a/y' }, '/a/y': { link: '/a/x' } }, ['/a/x']);
    assert.match(loop.violations[0] ?? '', /40/);
  });
  test('ليس ملفّاً عاديّاً، ومسارٌ نسبيّ، وغائبٌ إلزاميّ ⇒ مرفوض؛ وغائبٌ اختياريّ في مجلّدٍ سليم ⇒ مقبول', () => {
    assert.equal(v({ '/a/node': { type: 'fifo' } }, ['/a/node']).violations.length, 1);
    assert.equal(v({}, ['node']).violations.length, 1);
    const fsMissing = {
      ...trustFs({ '/app/src': { uid: 1000 } }),
      lstat: (/** @type {string} */ p) => {
        if (p.startsWith('/app/src/')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return trustFs({ '/app/src': { uid: 1000 } }).lstat(p);
      },
    };
    const req = codeTrustViolations(['/app/src/m.mjs'], { fs: fsMissing });
    assert.ok(req.violations.some((x) => /ENOENT/.test(x)));
    const opt = codeTrustViolations(['/app/src/m.mjs'], {
      fs: fsMissing,
      optional: ['/app/src/m.mjs'],
    });
    assert.deepEqual(opt.absent, ['/app/src/m.mjs']);
    assert.ok(
      opt.violations.some((x) => x.startsWith('/app/src:')),
      'مجلّدٌ يكتبُه مستخدمٌ مقبولٌ لغيابِ الملفّ',
    );
  });
  test('بصمةٌ مثبَّتة: تطابقٌ ⇒ مقبولٌ ومسجَّل؛ اختلافٌ ⇒ مرفوض', () => {
    const good = v({ '/a/node': { sha: 'a'.repeat(64) } }, ['/a/node'], {
      pins: { '/a/node': 'a'.repeat(64) },
    });
    assert.deepEqual(good.violations, []);
    assert.equal(good.checked[0]?.sha256, 'a'.repeat(64));
    const bad = v({ '/a/node': { sha: 'b'.repeat(64) } }, ['/a/node'], {
      pins: { '/a/node': 'a'.repeat(64) },
    });
    assert.match(bad.violations[0] ?? '', /بصمة/);
  });
  test('المُطلِقُ يفحصُ sudo وenv وsetpriv وsh وnode ونقطةَ الدخول — ويرفضُ قبلَ بناءِ الأمر', () => {
    const l = isolatedLaunchCommand(BASE_LAUNCH);
    assert.deepEqual(
      l.trust.map((x) => x.path),
      [
        '/usr/bin/sudo',
        '/usr/bin/env',
        '/usr/bin/setpriv',
        '/bin/sh',
        '/usr/local/bin/node',
        '/app/scripts/worker.mjs',
      ],
    );
    for (const p of ['/usr/bin/setpriv', '/bin/sh', '/usr/bin/sudo', '/app/scripts/worker.mjs']) {
      isoRejects(
        () =>
          isolatedLaunchCommand({ ...BASE_LAUNCH, trust: { fs: trustFs({ [p]: { uid: 1000 } }) } }),
        ISOLATION_ERRORS.UNTRUSTED_CODE,
      );
    }
    // sudo:false لا يفحصُ sudo لأنّه لا يُشغِّلُه.
    const ns = isolatedLaunchCommand({
      ...BASE_LAUNCH,
      sudo: false,
      trust: { fs: trustFs({ '/usr/bin/sudo': { uid: 1000 } }) },
    });
    assert.equal(ns.command, '/usr/bin/env');
  });
});

test('ISO-22: قائمةُ وحداتِ التطبيقِ في فحصِ الثقةِ هي ما يستوردُه loadApp() بعينه', () => {
  const src = readFileSync(WORKER_ENTRY, 'utf8');
  const body = src.slice(
    src.indexOf('export async function loadApp()'),
    src.indexOf('return {', src.indexOf('export async function loadApp()')),
  );
  const imported = [...body.matchAll(/import\('([^']+)'\)/g)].map((m) => String(m[1]));
  assert.deepEqual(imported, [...BOOT_APP_MODULES]);
});

test('ISO-46: عمليّةٌ حقيقيّة — المُطلِقُ يرفضُ node يكتبُه غيرُ root ونقطةَ دخولٍ ملكَ مستخدم؛ وتجاوزُه يكشفُه المُقلِعُ قبلَ قراءةِ المفتاح', (t) => {
  if (!canRoot()) return t.skip(ROOT_SKIP);
  const tree = rootTree();
  try {
    hookApp(tree);
    // node المضيف (‏إن كان يكتبُه غيرُ root) — حقيقةٌ تُسجَّلُ ولا تُفترض.
    const host = codeTrustViolations([process.execPath]);
    t.diagnostic(
      `node المضيف ${process.execPath}: ${host.violations.length === 0 ? 'موثوق' : host.violations.join('؛ ')}`,
    );
    // (أ) نسخةُ node ملكُ المستخدم 0777 — كحالِ مضيفِ المختبر — في مجلّدٍ يقرؤه root منقوصُ القدرات.
    chmodSync(tree.stage, 0o755);
    const loose = join(tree.stage, 'node');
    copyFileSync(process.execPath, loose);
    chmodSync(loose, 0o777);
    const base = {
      entry: join(tree.dir, 'scripts', 'worker.mjs'),
      keyFile: tree.keyFile,
      uid: idOf('-u'),
      gid: idOf('-g'),
      env: { XUUX_DB_FENCE: 'required' },
      pass: ['XUUX_DB_FENCE'],
    };
    isoRejects(
      () => isolatedLaunchCommand({ ...base, node: loose }),
      ISOLATION_ERRORS.UNTRUSTED_CODE,
    );
    // (ب) نقطةُ دخولٍ ملكُ المستخدم.
    const userEntry = join(tree.stage, 'worker.mjs');
    copyFileSync(WORKER_ENTRY, userEntry);
    isoRejects(
      () => isolatedLaunchCommand({ ...base, node: trustedNode(), entry: userEntry }),
      ISOLATION_ERRORS.UNTRUSTED_CODE,
    );
    // (ج) تجاوزُ فحصِ المُطلِق: الأمرُ نفسُه بـnode غيرِ موثوق ⇒ المُقلِعُ (بـroot) يرفضُ بـUNTRUSTED_CODE
    //     قبلَ قراءةِ الواصف، ولا تُحمَّلُ وحدةٌ تطبيقيّة. كاشفٌ لا حاجز: node مستبدَلٌ لا يفحصُ نفسَه.
    const l = isolatedLaunchCommand({ ...base, node: trustedNode() });
    const bypass = l.args.map((a) => (a === trustedNode() ? loose : a));
    assert.notDeepEqual(bypass, l.args);
    const r = spawnSync(l.command, bypass, { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, new RegExp(ISOLATION_ERRORS.UNTRUSTED_CODE));
    assert.match(r.stderr, /يكتبُه غيرُ root \(777\)/);
    assert.equal(tree.mark('app'), null, 'وحداتٌ تطبيقيّةٌ حُمِّلت رغمَ رفضِ الثقة');
    // والضابط: الأمرُ نفسُه بـnode الموثوق يُكمِلُ ويُحمِّلُ التطبيقَ بالهويّةِ المُسقَطة.
    runLaunch(l);
    assert.deepEqual([...new Set(tree.mark('app') ?? [])], [String(idOf('-u'))]);
  } finally {
    tree.clean();
  }
});

test('ISO-47: عمليّةٌ حقيقيّة — بصمةُ node المثبَّتة: تطابقٌ يُطلِق، واختلافٌ يُرفَضُ قبلَ الإطلاق', (t) => {
  if (!canRoot()) return t.skip(ROOT_SKIP);
  const tree = rootTree();
  try {
    const node = trustedNode();
    const h = String(spawnSync('sha256sum', [node], { encoding: 'utf8' }).stdout.split(' ')[0]);
    assert.match(h, /^[0-9a-f]{64}$/);
    const base = {
      node,
      entry: join(tree.dir, 'scripts', 'worker.mjs'),
      keyFile: tree.keyFile,
      uid: idOf('-u'),
      gid: idOf('-g'),
      env: { XUUX_DB_FENCE: 'required' },
      pass: ['XUUX_DB_FENCE'],
    };
    const l = isolatedLaunchCommand({ ...base, trust: { pins: { [node]: h } } });
    assert.equal(l.trust.find((x) => x.path === node)?.sha256, h);
    isoRejects(
      () => isolatedLaunchCommand({ ...base, trust: { pins: { [node]: '0'.repeat(64) } } }),
      ISOLATION_ERRORS.UNTRUSTED_CODE,
    );
  } finally {
    tree.clean();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// `WL-533` (‏جولةٌ لاحقة، البند ٣) — عقدُ وحدةِ systemd المكافئةِ للمُطلِق (`systemdUnit` في scripts/worker.mjs).
//  - ISO-48..51: نصٌّ مولَّد — مطابقةُ المُطلِق (‏البيئة والحدّ)، ورفضُ الحقن، وفحصُ الثقة، ولا تثبيت.
//  - ISO-52: محاكاةٌ حقيقيّةٌ **من نصِّ الوحدةِ المحلَّل** (‏sudo + env + setpriv + sh)، مع ضوابطَ سلبيّة.
// لم يُشغَّل systemd: هذا عقدٌ نصّيٌّ ومحاكاتُه، لا دليلٌ على سلوكِ مديرِ systemd على مضيفٍ ما.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const UNIT_BASE = Object.freeze({
  ...BASE_LAUNCH,
  keyFile: '/etc/xuux/worker.key',
  env: { XUUX_DB_FENCE: 'required', PGHOST: '127.0.0.1' },
  pass: ['XUUX_DB_FENCE', 'PGHOST'],
});

test('ISO-48: الوحدةُ تطابقُ المُطلِق — البيئةُ نفسُها، والحدُّ CAP_SETUID CAP_SETGID من ALLOWED_CAP_BND', () => {
  const { unit, env } = systemdUnit(UNIT_BASE);
  const d = parseUnit(unit);
  const launch = isolatedLaunchCommand(UNIT_BASE);
  assert.deepEqual(env, launch.env);
  assert.deepEqual(env, isolatedLaunchEnv(UNIT_BASE));
  assert.deepEqual(
    Object.fromEntries(
      (d.Environment ?? []).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]),
    ),
    launch.env,
  );
  assert.deepEqual(d.User, ['root']);
  assert.deepEqual(d.NoNewPrivileges, ['yes']);
  assert.deepEqual(d.AmbientCapabilities, ['']);
  assert.deepEqual(d.CapabilityBoundingSet, ['CAP_SETUID CAP_SETGID']);
  assert.equal(ALLOWED_CAP_BND, (1n << 6n) | (1n << 7n));
  assert.deepEqual(boundingCapabilities(), ['CAP_SETUID', 'CAP_SETGID']);
  assert.deepEqual(d.OpenFile, ['/etc/xuux/worker.key:xuux-key:read-only']);
  assert.deepEqual(d.ExecStart, [`${UNIT_BASE.node} ${UNIT_BASE.entry}`]);
  assert.equal(d.EnvironmentFile, undefined, 'EnvironmentFile يُدخِلُ بيئةً غيرَ مسمّاة');
  assert.equal(env.XUUX_FENCE_KEY_FD, '3');
  // UnsetEnvironment يُزيلُ ما يورّثُه المدير؛ وكلُّ اسمٍ فيه يرفضُه المُقلِعُ أصلاً (‏مصدرٌ واحد).
  const unset = String(d.UnsetEnvironment?.[0]).split(' ');
  assert.deepEqual(unset, [...UNSET_ENV]);
  for (const n of unset) {
    if (n === 'XUUX_FENCE_WORKER_KEY') continue;
    assert.deepEqual(hostileLaunchInputs({ [n]: 'x' }, []), [n]);
  }
});

test('ISO-49: الوحدةُ ترفضُ الحقنَ والمُدخلاتِ الممنوعةَ بدلَ أن تهرّبَها', () => {
  for (const bad of [
    { node: 'node' },
    { node: '/usr/bin/no de' },
    { entry: '/app/x.mjs\nExecStartPre=/bin/sh' },
    { keyFile: '/etc/%h/k' },
    { keyFile: '/etc/k";x' },
    { args: ['--x;y'] },
    { uid: 0 },
    { env: { XUUX_DB_FENCE: 'a b' } },
  ]) {
    isoRejects(() => systemdUnit({ ...UNIT_BASE, ...bad }), ISOLATION_ERRORS.CONFIG);
  }
  for (const name of ['NODE_OPTIONS', 'LD_PRELOAD', 'XUUX_FENCE_WORKER_KEY', 'XUUX_FENCE_KEY_FD']) {
    isoRejects(
      () => systemdUnit({ ...UNIT_BASE, pass: [name], env: { [name]: 'x' } }),
      ISOLATION_ERRORS.HOSTILE_ENV,
    );
  }
});

test('ISO-50: الوحدةُ لا تُولَّدُ لشيفرةٍ غيرِ موثوقة (‏العقدُ نفسُه للمُطلِق)', () => {
  isoRejects(
    () =>
      systemdUnit({
        ...UNIT_BASE,
        trust: { fs: trustFs({ '/usr/local/bin/node': { uid: 1001, mode: 0o777 } }) },
      }),
    ISOLATION_ERRORS.UNTRUSTED_CODE,
  );
  isoRejects(
    () => systemdUnit({ ...UNIT_BASE, trust: { fs: trustFs({ '/app': { uid: 1001 } }) } }),
    ISOLATION_ERRORS.UNTRUSTED_CODE,
  );
  assert.equal(systemdUnit(UNIT_BASE).trust, 2);
  // التعطيلُ صريحٌ ومرئيٌّ في الوسائط، لا افتراضيّ.
  assert.equal(systemdUnit({ ...UNIT_BASE, trust: false }).trust, 0);
});

test('ISO-51: المولّدُ نقيٌّ — لا يكتبُ ولا يُشغِّلُ ولا يستدعي systemctl، ولا يستدعيه مسارُ الإقلاع', () => {
  const src = readFileSync(WORKER_ENTRY, 'utf8');
  const a = src.indexOf('// ── عقدُ وحدةِ systemd');
  const b = src.indexOf('export async function loadApp()');
  assert.ok(a > 0 && b > a, 'قسمُ المولّدِ قبلَ loadApp');
  const code = src
    .slice(a, b)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(
    code,
    /systemctl|daemon-reload|writeFile|appendFile|mkdir|openSync|spawn|exec(File)?Sync|process\.(stdout|exit)/,
  );
  // لا يُستدعى خارجَ قسمِه: الإقلاعُ (bootstrapIsolation/main) لا يمرُّ به.
  const outside = src.slice(0, a) + src.slice(b);
  assert.doesNotMatch(outside, /systemdUnit\(|parseUnit\(/);
  // وعبرَ الاستيرادِ كما يُستعمَل.
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { systemdUnit } from ${JSON.stringify(WORKER_ENTRY)};` +
        `process.stdout.write(systemdUnit({ node: '/usr/bin/node', entry: '/opt/x/w.mjs', keyFile: '/etc/k',` +
        ` uid: 990, gid: 990, env: {}, trust: false }).unit)`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^CapabilityBoundingSet=CAP_SETUID CAP_SETGID$/m);
  assert.match(r.stdout, /^OpenFile=\/etc\/k:xuux-key:read-only$/m);
});

/**
 * محاكاةُ الوحدة: يُبنى الأمرُ من **النصِّ المحلَّل** وحدَه — بيئةُ المديرِ ناقصاً UnsetEnvironment زائداً
 * Environment، وno_new_privs إن NoNewPrivileges=yes، والحدُّ من CapabilityBoundingSet، وOpenFile على 3.
 * @param {Record<string, string[]>} d @param {Record<string, string>} [manager]
 */
function emulateUnit(d, manager = {}) {
  const unset = new Set(String(d.UnsetEnvironment?.[0] ?? '').split(' '));
  const env = Object.entries(manager)
    .filter(([k]) => !unset.has(k))
    .map(([k, v]) => `${k}=${v}`);
  env.push(...(d.Environment ?? []));
  const caps = String(d.CapabilityBoundingSet?.[0] ?? '')
    .split(' ')
    .filter((c) => c !== '')
    .map((c) => `+${c.replace(/^CAP_/, '').toLowerCase()}`);
  const priv = [
    ...(d.NoNewPrivileges?.[0] === 'yes' ? ['--no-new-privs'] : []),
    ...(caps.length > 0 ? ['--bounding-set', `-all,${caps.join(',')}`] : []),
    '--inh-caps',
    '-all',
  ];
  const key = String(d.OpenFile?.[0]).split(':')[0];
  const exec = String(d.ExecStart?.[0]).split(' ');
  return spawnSync(
    'sudo',
    [
      '-n',
      '/usr/bin/env',
      '-i',
      ...env,
      '/usr/bin/setpriv',
      ...priv,
      '/bin/sh',
      '-c',
      'k=$1; shift; exec "$@" 3<"$k"',
      'sh',
      String(key),
      ...exec,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
}

test('ISO-52: محاكاةٌ حقيقيّةٌ من نصِّ الوحدة — يُقلِعُ ويُحمِّلُ التطبيقَ بالهويّةِ المُسقَطة؛ وحذفُ NoNewPrivileges أو الحدِّ يُرفَض، وNODE_* من المدير يُزالُ أو يُكشَف', (t) => {
  if (!canRoot()) return t.skip(ROOT_SKIP);
  const tree = rootTree();
  try {
    hookApp(tree);
    const uid = idOf('-u');
    const { unit } = systemdUnit({
      node: trustedNode(),
      entry: join(tree.dir, 'scripts', 'worker.mjs'),
      keyFile: tree.keyFile,
      uid,
      gid: idOf('-g'),
      env: { XUUX_DB_FENCE: 'required' },
      pass: ['XUUX_DB_FENCE'],
    });
    const d = parseUnit(unit);
    // (أ) الوحدةُ كما هي، وبيئةُ مديرٍ ملوّثةٌ بما في UnsetEnvironment ⇒ يُزالُ ويُقلِع.
    const r = emulateUnit(d, {
      NODE_OPTIONS: `--require ${join(tree.marks, 'nope.cjs')}`,
      LD_PRELOAD: '/nope.so',
    });
    assert.doesNotMatch(r.stderr, /FENCE_ISOLATION_/, `المُقلِعُ رفض: ${r.stderr}`);
    assert.deepEqual(
      [...new Set(tree.mark('app') ?? [])],
      [String(uid)],
      `لم يُحمَّلْ بالهويّةِ المُسقَطة: ${r.stderr}`,
    );
    // (ب) بلا NoNewPrivileges ⇒ LAUNCH_POLICY ولا تحميل.
    for (const [
      what,
      mut,
    ] of /** @type {Array<[string, Record<string, string[] | undefined>]>} */ ([
      ['NoNewPrivileges', { NoNewPrivileges: undefined }],
      ['CapabilityBoundingSet', { CapabilityBoundingSet: undefined }],
    ])) {
      tree.unmark('app');
      const x = emulateUnit(/** @type {Record<string, string[]>} */ ({ ...d, ...mut }));
      assert.match(x.stderr, new RegExp(ISOLATION_ERRORS.LAUNCH_POLICY), `${what}: ${x.stderr}`);
      assert.equal(tree.mark('app'), null, `${what}: حُمِّل التطبيقُ رغمَ الرفض`);
    }
    // (ج) اسمٌ عدائيٌّ ليس في UnsetEnvironment (لا أنماطَ فيها) ⇒ يصلُ، والمُقلِعُ يكشفُه — كشفٌ لا منع.
    tree.unmark('app');
    const y = emulateUnit(d, { NODE_ICU_DATA: '/nope' });
    assert.match(y.stderr, new RegExp(ISOLATION_ERRORS.HOSTILE_ENV), y.stderr);
    assert.equal(tree.mark('app'), null);
  } finally {
    tree.clean();
  }
});
