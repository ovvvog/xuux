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

// ── محلّلات مخرجات القدرات (فشل مغلق: ما لا يُحلَّل يُرفض لا يُخمَّن) ──

/**
 * يفسر قيمة TPM2_PT_NV_COUNTERS_MAX **بحسب المراجعة التي تعلنها الشريحة** (TPM2_PT_REVISION).
 *
 * - قيمة موجبة ⇒ حدّ أعلى لعدد فهارس العدّادات (لا سعة حرّة).
 * - صفر مع مراجعة ≥ 1.59 ⇒ «لا حدّ أقصى ثابتاً»: نصّ NOTE 2 في TPM 2.0 Library Part 2 r1.59
 *   («The value zero indicates that there is no fixed maximum»).
 * - صفر مع مراجعة أقدم (مثل r1.38 التي تعلنها SLB9670، ADR 0007 annex A) أو بلا مراجعة ⇒
 *   **دلالة غير معرَّفة نصّاً**: NOTE 2 غائبة عن r1.38، فلا يُقرأ الصفر «غير مدعوم» ولا «بلا حدّ».
 *
 * ولا يُستنتج من هذه الخاصية دعمُ العدّادات أصلاً: الدعم يُثبَت عملياً بإنشاء عدّاد
 * (`supportProvenBy: 'counter-creation'`)، فلا حقل `supported` في المخرج (LIVE-46، WL-438).
 * التفسير نفسه في `sim/tpm-host/decode_inventory.mjs` (interpretNvCountersMax).
 * @param {number|string} rawValue رقم أو نص مثل "0x0"
 * @param {number|string} [revisionTimes100] قيمة TPM2_PT_REVISION الخام (المراجعة × 100، مثل 0x8A = 1.38)
 * @returns {{ok: true, maxCounters: number, revisionTimes100: number|null, supportProvenBy: 'counter-creation',
 *   semantics: 'no-fixed-maximum'|'fixed-maximum'|'zero-meaning-not-defined-for-reported-revision'}|{ok: false, error: string}}
 */
export function interpretNvCountersMax(rawValue, revisionTimes100) {
  const value = typeof rawValue === 'number' ? rawValue : parseHexValue(String(rawValue ?? ''));
  if (value === null || !Number.isInteger(value) || value < 0) {
    return { ok: false, error: 'NV_COUNTERS_MAX_UNKNOWN: unparsable value' };
  }
  let revision = null;
  if (revisionTimes100 !== undefined && revisionTimes100 !== null) {
    revision =
      typeof revisionTimes100 === 'number' ? revisionTimes100 : parseHexValue(String(revisionTimes100));
    if (revision === null || !Number.isInteger(revision) || revision <= 0) {
      return { ok: false, error: 'TPM_PT_REVISION_UNKNOWN: unparsable revision' };
    }
  }
  const base = { ok: true, maxCounters: value, revisionTimes100: revision, supportProvenBy: 'counter-creation' };
  if (value > 0) return { ...base, semantics: 'fixed-maximum' };
  if (revision !== null && revision >= 159) return { ...base, semantics: 'no-fixed-maximum' };
  return { ...base, semantics: 'zero-meaning-not-defined-for-reported-revision' };
}

/**
 * يستخرج قيمة خام (raw) لخاصية من مخرجات tpm2 getcap properties-*.
 * مثال الإدخال: "TPM2_PT_NV_COUNTERS_MAX:\n  raw: 0x0"
 * @returns {string|null} نص القيمة الخام أو null إن لم توجد
 */
export function parsePropertyRaw(stdout, propertyName) {
  if (typeof stdout !== 'string' || typeof propertyName !== 'string') return null;
  const re = new RegExp(
    propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*\\n\\s*raw:\\s*(\\S+)',
  );
  const m = stdout.match(re);
  return m ? m[1] : null;
}

/**
 * يفسّر حالة moreData من مخرجات getcap: 'yes' | 'no' | 'unknown'.
 * الغياب أو النص غير المعروف ⇒ 'unknown' (فشل مغلق لا تخمين).
 */
export function parseMoreData(stdout) {
  if (typeof stdout !== 'string') return 'unknown';
  const m = stdout.match(/More\s+data:\s*(\S+)/i);
  if (!m) return 'unknown';
  const v = m[1].toLowerCase();
  return v === 'yes' || v === 'no' ? v : 'unknown';
}

/**
 * يجرد مقابض فهارس NV من مخرجات handles-nv-index.
 * @returns {string[]} قائمة المقابض كنصوص؛ فارغة إن لم يوجد شيء
 */
export function parseHandlesNvIndex(stdout) {
  if (typeof stdout !== 'string') return [];
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

/** يحوّل نصاً مثل "0x1f" إلى رقم، أو null. */
function parseHexValue(text) {
  const t = text.trim();
  if (!/^(0x[0-9a-f]+|\d+)$/i.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}
