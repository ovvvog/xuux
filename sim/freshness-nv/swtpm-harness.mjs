// @ts-nocheck
// sim/freshness-nv/swtpm-harness.mjs
//
// WL-431 — مُشغِّلُ swtpm معزولٌ لمجسِّ مرجعِ الحداثةِ (R3-A-01 / EXT-6). **محاكاةٌ وقياسٌ فقط.**
//
// - كلُّ نسخةٍ لها مجلدُ حالةٍ مؤقّتٌ خاصٌّ ومنفذانِ على loopback وحدَه؛ لا `/dev/tpm*` ولا TBS
//   ولا أيُّ TCTI غيرُ `swtpm:` (يمرُّ كلُّ أمرٍ على `assertSimulatorTcti` من `sim/tpm/tcti_guard.mjs`).
// - الأوامرُ `tpm2_*` تُشغَّلُ بـargv ثابتٍ (`shell: false`). وكلُّ فشلٍ يُرفَعُ خطأً — لا قيمةَ بديلةَ
//   (بخلافِ `sim/tpm/tpm_client.mjs#nvReadCounter` الذي يقرأُ الفشلَ صفرًا، فلا يُستعمَلُ هنا).
// - `snapshotState`/`restoreState` ينسخانِ مجلدَ حالةِ المحاكي كما هو — لقياسِ حدِّ «الاسترجاعِ
//   الكاملِ» صراحةً، لا لادّعاءِ حمايةٍ منه.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertSimulatorTcti } from '../tpm/tcti_guard.mjs';

/** خطأٌ برمزٍ مسمّى. */
export function codedError(code, message, extra = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/**
 * يُشغِّلُ برنامجًا بـargv ثابتٍ ويُعيدُ مخرجاتِه الخامَّ.
 * @param {string} file - البرنامج
 * @param {string[]} args - الوسائط
 * @param {{env?: object, input?: Buffer, timeoutMs?: number}} [opts]
 * @returns {Promise<{rc: number, stdout: Buffer, stderr: string}>}
 */
export function run(file, args, opts = {}) {
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    throw codedError('SIM_ARGS_INVALID', 'args must be a string array');
  }
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      shell: false,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: [opts.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    const out = [];
    let stderr = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 15000);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ rc: 127, stdout: Buffer.concat(out), stderr: stderr + String(err) });
    });
    child.on('close', (rc, signal) => {
      clearTimeout(timer);
      resolve({ rc: rc ?? (signal ? 128 : 1), stdout: Buffer.concat(out), stderr });
    });
    if (opts.input) child.stdin.end(opts.input);
  });
}

/**
 * عميلُ `tpm2_*` مقيَّدٌ بـTCTI محاكٍ على loopback.
 */
export class Tpm2Tools {
  /** @param {string} tcti - مثل `swtpm:host=127.0.0.1,port=NNNN` */
  constructor(tcti) {
    const value = assertSimulatorTcti(tcti);
    if (!/^swtpm:host=127\.0\.0\.1,port=\d+$/.test(value)) {
      throw codedError('SIM_TCTI_NOT_LOOPBACK', `only swtpm on 127.0.0.1 is allowed: ${value}`);
    }
    this.tcti = value;
  }

  /**
   * @param {string} tool - اسمُ الأداةِ (‏`tpm2_nvread`…) من قائمةٍ ثابتة
   * @param {string[]} args
   * @param {{input?: Buffer}} [opts]
   */
  async exec(tool, args, opts = {}) {
    if (!Tpm2Tools.ALLOWED.has(tool)) throw codedError('SIM_TOOL_REFUSED', tool);
    const r = await run(tool, args, { env: { TPM2TOOLS_TCTI: this.tcti }, input: opts.input });
    if (r.rc !== 0) {
      throw codedError('SIM_TPM_COMMAND_FAILED', `${tool} rc=${r.rc} ${r.stderr.trim().split('\n').pop() ?? ''}`, {
        rc: r.rc,
        stderr: r.stderr,
      });
    }
    return r.stdout;
  }
}

/** الأدواتُ المسموحةُ وحدَها: تعريفُ NV وكتابتُه وقراءتُه وزيادتُه وحذفُه في المحاكي. */
Tpm2Tools.ALLOWED = new Set([
  'tpm2_startup',
  'tpm2_getcap',
  'tpm2_nvdefine',
  'tpm2_nvwrite',
  'tpm2_nvread',
  'tpm2_nvincrement',
  'tpm2_nvreadpublic',
  'tpm2_nvundefine',
]);

/** منفذٌ حرٌّ على loopback. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** هل المنفذُ حرّ؟ */
function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/** زوجُ منافذَ حرّة `(p, p+1)` — TCTI الـswtpm يفترضُ منفذَ التحكّمِ التاليَ لمنفذِ الخادم. */
export async function freePortPair() {
  for (let i = 0; i < 50; i += 1) {
    const p = await freePort();
    if (p < 65535 && (await portFree(p + 1))) return p;
  }
  throw codedError('SIM_NO_FREE_PORTS', 'no adjacent free port pair');
}

/** هل الأدواتُ متاحةٌ في هذه البيئة؟ */
export async function toolsAvailable() {
  const a = await run('swtpm', ['--version'], { timeoutMs: 5000 });
  const b = await run('tpm2_nvincrement', ['--version'], { timeoutMs: 5000 });
  return a.rc === 0 && b.rc === 0;
}

/**
 * نسخةُ swtpm واحدةٌ بمجلدِ حالةٍ دائمٍ عبرَ إعادةِ تشغيلِها.
 */
export class SwtpmInstance {
  /** @param {{stateDir?: string}} [opts] */
  constructor(opts = {}) {
    this.stateDir = opts.stateDir ?? mkdtempSync(join(tmpdir(), 'xuux-fnv-swtpm-'));
    this.ownsStateDir = opts.stateDir === undefined;
    this.port = null;
    this.ctrl = null;
    this.pid = null;
    this.starts = 0;
  }

  get tcti() {
    return `swtpm:host=127.0.0.1,port=${this.port}`;
  }

  tools() {
    return new Tpm2Tools(this.tcti);
  }

  /** يبدأُ المحاكي على مجلدِ الحالةِ نفسِه (‏منافذُ جديدةٌ في كلِّ بدء). */
  async start() {
    if (this.pid !== null) throw codedError('SIM_ALREADY_RUNNING', String(this.pid));
    this.port = await freePortPair();
    this.ctrl = this.port + 1;
    const pidFile = join(this.stateDir, 'swtpm.pid');
    rmSync(pidFile, { force: true });
    const r = await run('swtpm', [
      'socket',
      '--tpm2',
      '--tpmstate',
      `dir=${this.stateDir}`,
      '--server',
      `type=tcp,port=${this.port},bindaddr=127.0.0.1`,
      '--ctrl',
      `type=tcp,port=${this.ctrl},bindaddr=127.0.0.1`,
      '--flags',
      'not-need-init,startup-clear',
      '--pid',
      `file=${pidFile}`,
      '-d',
    ]);
    if (r.rc !== 0) throw codedError('SIM_SWTPM_START_FAILED', r.stderr.trim());
    for (let i = 0; i < 100; i += 1) {
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, 'utf8').trim());
        if (pid > 0) {
          this.pid = pid;
          break;
        }
      }
      await sleep(20);
    }
    if (this.pid === null) throw codedError('SIM_SWTPM_START_FAILED', 'no pid file');
    for (let i = 0; i < 100; i += 1) {
      try {
        await this.tools().exec('tpm2_getcap', ['properties-fixed']);
        this.starts += 1;
        return this;
      } catch {
        await sleep(30);
      }
    }
    throw codedError('SIM_SWTPM_START_FAILED', 'swtpm did not answer GetCapability');
  }

  /**
   * يوقفُ المحاكي.
   * @param {'SIGTERM'|'SIGKILL'} [signal]
   */
  async stop(signal = 'SIGTERM') {
    if (this.pid === null) return;
    const pid = this.pid;
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 200; i += 1) {
      try {
        process.kill(pid, 0);
        await sleep(20);
      } catch {
        this.pid = null;
        return;
      }
    }
    throw codedError('SIM_SWTPM_STOP_FAILED', String(pid));
  }

  /** يُعيدُ التشغيلَ على الحالةِ نفسِها. */
  async restart(signal = 'SIGTERM') {
    await this.stop(signal);
    await this.start();
  }

  /** ينسخُ مجلدَ الحالةِ (‏المحاكي موقوفٌ وجوبًا كي لا تُنسخَ حالةٌ نصفُ مكتوبة). */
  snapshotState(destination) {
    if (this.pid !== null) throw codedError('SIM_SNAPSHOT_WHILE_RUNNING', 'stop swtpm first');
    cpSync(this.stateDir, destination, { recursive: true });
  }

  /** يُعيدُ مجلدَ الحالةِ إلى نسخةٍ سابقة — **الاسترجاعُ الكاملُ** للمرجعِ المحاكى. */
  restoreState(source) {
    if (this.pid !== null) throw codedError('SIM_RESTORE_WHILE_RUNNING', 'stop swtpm first');
    rmSync(this.stateDir, { recursive: true, force: true });
    cpSync(source, this.stateDir, { recursive: true });
  }

  async dispose() {
    await this.stop('SIGKILL').catch(() => undefined);
    if (this.ownsStateDir) rmSync(this.stateDir, { recursive: true, force: true });
  }
}
