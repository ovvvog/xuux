// @ts-nocheck
// sim/tpm/tpm_client.mjs
//
// عميل TPM NV لمحاكي swtpm — عمليات العدّاد فقط، argv آمن، بلا shell.
// غير إنتاجي: تحقيق/محاكاة فقط. TCTI محاكي إلزامي (tcti_guard).
//
// لا أوامر كتابة تُمرر كنص: كل استدعاء يبني argv ثابتاً.

import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { assertSimulatorTcti } from './tcti_guard.mjs';

/**
 * يشغّل tpm2 بأمر ووسائط ثابتة. argv مصفوفة، shell:false.
 * @param {string[]} args
 * @param {{tcti?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{rc: number, stdout: string, stderr: string}>}
 */
export function runTpm(args, opts = {}) {
  const tcti = assertSimulatorTcti(opts.tcti ?? process.env.TPM2TOOLS_TCTI);
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    throw new Error('TPM_ARGS_INVALID: args must be string array');
  }
  const argv = ['tpm2', ...args];
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      shell: false,
      env: { ...process.env, TPM2TOOLS_TCTI: tcti },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 20000);
    child.on('close', (rc) => {
      clearTimeout(timer);
      resolve({ rc: rc ?? 0, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ rc: 1, stdout, stderr: stderr + String(err) });
    });
  });
}

/** TPM2_Startup(SU_CLEAR). */
export function startup(opts) {
  return runTpm(['startup', '-c'], opts);
}

/** يعرّف فهرس عدّاد NV بحجم 8 بايت في هرم المالك. */
export function nvDefineCounter(nvIndex, opts) {
  return runTpm(
    ['nvdefine', '-C', 'o', '-s', '8', '-a', 'ownerread|ownerwrite|nt=counter', String(nvIndex)],
    opts,
  );
}

/** يزيد عدّاد NV بمقدار واحد. */
export function nvIncrement(nvIndex, opts) {
  return runTpm(['nvincrement', '-C', 'o', String(nvIndex)], opts);
}

/**
 * يقرأ قيمة عدّاد NV الخام (8 بايت) كعدد صحيح كبير (big-endian) عبر ملف.
 * عدّاد غير مهيّأ (خطأ 0x14A) يُعامَل كقيمة 0.
 * @returns {Promise<{rc: number, counter: number, raw: string, stderr: string}>}
 */
export async function nvReadCounter(nvIndex, opts) {
  const tmp = `/tmp/xuux-nv-${process.pid}-${Date.now()}.bin`;
  const r = await runTpm(['nvread', '-C', 'o', '-o', tmp, String(nvIndex)], opts);
  let counter = 0;
  if (r.rc === 0) {
    try {
      const buf = readFileSync(tmp);
      counter = Number(buf.readBigUInt64BE(0));
    } catch {
      counter = 0;
    }
  } else {
    // 0x14A: العدّاد غير مهيّأ بعد ⇒ قيمته 0.
    counter = 0;
  }
  try { unlinkSync(tmp); } catch { /* noop */ }
  return { rc: r.rc, counter, raw: r.stdout, stderr: r.stderr };
}

/** يحذف فهرس NV. */
export function nvUndefine(nvIndex, opts) {
  return runTpm(['nvundefine', '-C', 'o', String(nvIndex)], opts);
}

/** يقرأ المنطقة العامة لفهرس NV (name). */
export function nvReadPublic(nvIndex, opts) {
  return runTpm(['nvreadpublic', String(nvIndex)], opts);
}
