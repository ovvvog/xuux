// sim/tpm-host/check_win11_qualification.mjs
//
// WL-510 — مُقيِّمُ أدلّةِ التأهيلِ القرائيِّ على Windows 11 (‏docs/adr/0007-annex-f-windows11-tbs-qualification.md §5).
//
// المدخلات: ناتجُ win11_qualification_readonly.ps1 مرّتين (‏جلسةٌ عاديّةٌ وجلسةُ مدير) وناتجُ wsl_interop_probe.sh.
// المخرَج: حكمٌ لكلِّ فحصٍ (‏PASS / FAIL / NOT_RUN / INVALID) مع أسبابِه.
//
// ثوابتُ لا يكسرُها أيُّ مدخل (‏مُختبَرةٌ في tests/sim/win11-qualification.test.mjs):
//   - freshnessProven = false دائمًا: لا شيءَ قرائيٌّ يُثبتُ حداثةَ الحالة.
//   - productionEligible = false دائمًا: الأهليّةُ الإنتاجيّةُ قرارُ المالكِ والمجلس (‏ق5) لا ناتجُ أداة.
//   - ekChainVerified = false دائمًا: سلسلةُ شهادةِ EK تُتحقَّقُ يدويًّا مقابلَ جذرِ الصانعِ المنشور.
//   - تقريرٌ يدّعي readOnly≠true أو أرسلَ أوامرَ TPM ⇒ INVALID لكلِّ ما يعتمدُ عليه.
//
//   node sim/tpm-host/check_win11_qualification.mjs --standard <a.json> --elevated <b.json> --interop <c.json>

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const QUALIFICATION_SCHEMA = 'xuux.win11-qualification/1';
export const INTEROP_SCHEMA = 'xuux.wsl-interop/1';

const HEX64 = /^[0-9a-f]{64}$/;

/** @param {any} r @returns {string | null} */
function validQualification(r) {
  if (!r || typeof r !== 'object') return 'missing';
  if (r.schema !== QUALIFICATION_SCHEMA) return 'wrong schema';
  if (r.readOnly !== true) return 'readOnly is not true';
  if (r.tpmCommandsSent !== 0) return 'report claims TPM commands were sent';
  return null;
}

/** @param {any} r @returns {string | null} */
function validInterop(r) {
  if (!r || typeof r !== 'object') return 'missing';
  if (r.schema !== INTEROP_SCHEMA) return 'wrong schema';
  if (r.readOnly !== true) return 'readOnly is not true';
  if (r.tpmCommandsSent !== 0 || r.windowsProcessesStarted !== 0) return 'probe claims side effects';
  return null;
}

/**
 * @param {string} id
 * @param {string} verdict
 * @param {any[]} reasons
 * @param {Record<string, unknown>} [extra]
 */
const item = (id, verdict, reasons, extra = {}) => ({ id, verdict, reasons, ...extra });

/**
 * @param {{ standard?: any, elevated?: any, interop?: any }} input
 */
export function evaluateWin11Qualification(input = {}) {
  const { standard, elevated, interop } = input;
  const sErr = standard === undefined ? 'not supplied' : validQualification(standard);
  const eErr = elevated === undefined ? 'not supplied' : validQualification(elevated);
  const iErr = interop === undefined ? 'not supplied' : validInterop(interop);
  const items = [];

  // W-R2a — نظامُ التشغيلِ ومُشغِّلُ TPM مسجَّلانِ ومتّسقانِ بينَ الجلستَين.
  if (standard === undefined && elevated === undefined) {
    items.push(item('W-R2a', 'NOT_RUN', ['no qualification report supplied']));
  } else if (sErr || eErr) {
    items.push(item('W-R2a', 'INVALID', [sErr && `standard: ${sErr}`, eErr && `elevated: ${eErr}`].filter(Boolean)));
  } else {
    const reasons = [];
    for (const [name, r] of [['standard', standard], ['elevated', elevated]]) {
      if (!r.os?.buildNumber) reasons.push(`${name}: os.buildNumber missing`);
      if (!HEX64.test(r.tpmDriver?.sha256 ?? '')) reasons.push(`${name}: tpmDriver.sha256 missing or malformed`);
    }
    if (!reasons.length) {
      if (standard.os.buildNumber !== elevated.os.buildNumber) reasons.push('build differs between sessions');
      if (standard.tpmDriver.sha256 !== elevated.tpmDriver.sha256) reasons.push('tpm.sys differs between sessions');
    }
    items.push(
      item('W-R2a', reasons.length ? 'FAIL' : 'PASS', reasons, {
        recorded: reasons.length
          ? undefined
          : { buildNumber: standard.os.buildNumber, tpmDriverSha256: standard.tpmDriver.sha256 },
      }),
    );
  }

  // W-R2b — فئتا المستدعي مقيستانِ فعلًا (‏عاديٌّ ثمّ مدير).
  if (sErr || eErr) {
    items.push(item('W-R2b', sErr === 'not supplied' && eErr === 'not supplied' ? 'NOT_RUN' : 'INVALID', ['requires both valid reports']));
  } else {
    const reasons = [];
    if (standard.caller?.elevated !== false) reasons.push('standard report is not from a non-elevated session');
    if (elevated.caller?.elevated !== true) reasons.push('elevated report is not from an elevated session');
    items.push(item('W-R2b', reasons.length ? 'FAIL' : 'PASS', reasons));
  }

  // W-R3 — هويّةُ العتاد (‏EK) مسجَّلة. أصالةُ عتادٍ فقط؛ السلسلةُ تُراجَعُ يدويًّا.
  if (eErr) {
    items.push(item('W-R3', eErr === 'not supplied' ? 'NOT_RUN' : 'INVALID', [`elevated: ${eErr}`], { ekChainVerified: false }));
  } else {
    const ek = elevated.ek ?? {};
    const reasons = [];
    if (ek.read !== true) reasons.push('EK was not read');
    else {
      if (ek.isPresent !== true) reasons.push('EK not present');
      const certs = Array.isArray(ek.manufacturerCertificates) ? ek.manufacturerCertificates : [];
      if (!certs.length) reasons.push('no manufacturer EK certificate');
      for (const c of certs) if (!HEX64.test(c?.rawSha256 ?? '')) reasons.push('certificate without a SHA-256 of its bytes');
    }
    items.push(
      item('W-R3', reasons.length ? 'FAIL' : 'PASS', reasons, {
        ekChainVerified: false,
        issuers: reasons.length ? undefined : [...new Set(ek.manufacturerCertificates.map((/** @type {any} */ c) => c.issuer))],
      }),
    );
  }

  // W-R4 — توفّرُ قناةِ التشغيلِ البينيِّ (‏شرطٌ للخيار W-B وحدَه؛ غيابُه لا يُسقطُ W-A).
  if (iErr) {
    items.push(item('W-R4', iErr === 'not supplied' ? 'NOT_RUN' : 'INVALID', [`interop: ${iErr}`]));
  } else {
    const reasons = [];
    if (interop.binfmt?.enabled !== true) reasons.push('WSLInterop binfmt handler not enabled');
    if (interop.wslConfInteropEnabled === false) reasons.push('/etc/wsl.conf disables interop');
    if (interop.powershellResolvable !== true) reasons.push('powershell.exe not resolvable');
    const host = !eErr ? elevated : !sErr ? standard : null;
    const dist = host?.wsl?.distributions?.find?.((/** @type {any} */ d) => d.isDefault);
    if (host && dist && dist.interopFlag === false) reasons.push('default distribution has interop flag cleared');
    items.push(item('W-R4', reasons.length ? 'FAIL' : 'PASS', reasons));
  }

  return {
    schema: 'xuux.win11-qualification-verdict/1',
    items,
    freshnessProven: false,
    productionEligible: false,
    ekChainVerified: false,
    note: 'read-only evidence: platform context, hardware identity and channel availability only',
  };
}

/** @param {string} path */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** @param {string[]} argv */
function main(argv) {
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = /** @type {string} */ (argv[i]);
    if (!['--standard', '--elevated', '--interop'].includes(k) || argv[i + 1] === undefined) {
      process.stderr.write(`usage: --standard <file> --elevated <file> --interop <file>\n`);
      return 64;
    }
    args[k.slice(2)] = /** @type {string} */ (argv[i + 1]);
  }
  /** @type {Record<string, any>} */
  const input = {};
  /** @type {Record<string, { path: string, sha256: string }>} */
  const inputs = {};
  for (const [k, p] of Object.entries(args)) {
    input[k] = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    inputs[k] = { path: p, sha256: sha256File(p) };
  }
  const verdict = evaluateWin11Qualification(input);
  process.stdout.write(JSON.stringify({ ...verdict, inputs }, null, 2) + '\n');
  return verdict.items.some((x) => x.verdict === 'INVALID' || x.verdict === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
