// @ts-nocheck
// sim/tpm/tcti_guard.mjs
//
// حارس قناة TPM — يمنع اختيار TCTI حقيقي في CI ومسار الاختبار الافتراضي.
// غير إنتاجي: تجهيز تحقيق/محاكاة فقط. لا يتصل بـTPM الحقيقي افتراضياً.
// تشغيل أي أمر يتطلب TCTI صريحاً للمحاكي (swtpm/mssim).

import { execFileSync } from 'node:child_process';

/**
 * أنماط TCTI المسموح بها فقط: محاكيات.
 */
const SIM_TCTI_PATTERNS = [
  /^swtpm:/,
  /^mssim:/,
];

/**
 * يتحقق أن سلسلة TCTI تشير إلى محاكي فقط. يرمي إن كانت حقيقية أو غير معروفة.
 * @param {string} tcti
 * @returns {string}
 * @throws {Error} TCTI_REAL_OR_UNKNOWN
 */
export function assertSimulatorTcti(tcti) {
  const value = String(tcti ?? '').trim();
  if (value.length === 0) {
    throw new Error('TCTI_REAL_OR_UNKNOWN: empty TCTI');
  }
  if (/device:/.test(value) || /\/dev\/tpm/.test(value)) {
    throw new Error('TCTI_REAL_OR_UNKNOWN: device TCTI refused: ' + value);
  }
  // رفض أي محارف shell خطرة في سلسلة TCTI (حقن).
  if (/[^A-Za-z0-9:=,.\-_]/.test(value)) {
    throw new Error('TCTI_REAL_OR_UNKNOWN: unsafe characters in TCTI: ' + value);
  }
  if (!SIM_TCTI_PATTERNS.some((re) => re.test(value))) {
    throw new Error('TCTI_REAL_OR_UNKNOWN: not a simulator TCTI: ' + value);
  }
  return value;
}

/**
 * هل مسار اختبار المحاكي مُفعّل؟
 * يتطلب: XUUX_TPM_SIM=1 AND TCTI محاكي AND swtpm متاح.
 * @returns {boolean}
 */
export function isSimEnabled() {
  if (process.env.XUUX_TPM_SIM !== '1') return false;
  const tcti = process.env.TPM2TOOLS_TCTI ?? '';
  try {
    assertSimulatorTcti(tcti);
  } catch {
    return false;
  }
  try {
    execFileSync('swtpm', ['--version'], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
