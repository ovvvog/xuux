// @ts-nocheck
// sim/tpm/getcap.mjs
//
// مساعد GetCapability — قائمة مسموحات ثابتة (allowlist) لا تسمح إلا باستعلامات
// TPM2_GetCapability. غير إنتاجي: تحقيق/محاكاة فقط.
//
// الأمان:
//   - cap يجب أن يكون في ALLOWED_CAPS (مطابقة نصية صارمة).
//   - يُمرّر argv آمناً (مصفوفة) إلى spawn بلا shell. لا concat، لا تفسير shell.
//   - TCTI يجب أن يكون محاكياً (tcti_guard).
//   - لا يمكن تمرير أوامر كتابة أو وسائط shell إضافية: cap واحدة فقط، محصورة.

import { spawn } from 'node:child_process';
import { assertSimulatorTcti } from './tcti_guard.mjs';

/**
 * قائمة مسموحات ثابتة — أسماء قدرات TPM2_GetCapability فقط.
 * أي اسم غير موجود هنا يُرفض. لا أوامر كتابة/تخصيص/حذف ممكنة إطلاقاً.
 */
export const ALLOWED_CAPS = Object.freeze(new Set([
  'algorithms',
  'commands',
  'pcrs',
  'properties-fixed',
  'properties-variable',
  'ecc-curves',
  'handles-transient',
  'handles-persistent',
  'handles-permanent',
  'handles-pcr',
  'handles-nv-index',
  'handles-loaded-session',
  'handles-saved-session',
  'vendor',
]));

/**
 * يشغّل `tpm2 getcap <cap>` بآمان. يرفض أي cap خارج القائمة.
 * @param {string} cap
 * @param {{tcti?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{rc: number, stdout: string, stderr: string, argv: string[]}>}
 * @throws {Error} DISALLOWED_CAPABILITY | TCTI_REAL_OR_UNKNOWN
 */
export function getCapability(cap, opts = {}) {
  if (!ALLOWED_CAPS.has(cap)) {
    throw new Error('DISALLOWED_CAPABILITY: ' + String(cap));
  }
  const tcti = assertSimulatorTcti(opts.tcti ?? process.env.TPM2TOOLS_TCTI);
  // argv ثابت: tpm2 + getcap + cap (مسموح). لا مجال لوسائط إضافية.
  const argv = ['tpm2', 'getcap', cap];
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
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? 20000);
    child.on('close', (rc) => {
      clearTimeout(timer);
      resolve({ rc: rc ?? 0, stdout, stderr, argv });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ rc: 1, stdout, stderr: stderr + String(err), argv });
    });
  });
}
