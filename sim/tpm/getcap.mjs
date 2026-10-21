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

// أوّلُ إصدارِ إراتا لـr1.38 تحقّقنا أنّه يحوي البندَ 2.22 (إضافةُ NOTE «الصفرُ = لا حدَّ أقصى ثابتاً»):
// Errata v1.8، بتاريخ 2019-07-12 (اليوم 193). وإراتا v1.0 (2017-01-16) لا تحويه. الإصداراتُ بينهما
// (v1.1/v1.3/v1.4) لم يُتحقَّق منها، فتاريخٌ أقدمُ من v1.8 لا يُثبِتُ الدلالةَ (تحفّظٌ لا نفي).
// والشريحةُ تعلنُ تاريخَ آخرِ إراتا تطبّقُها في TPM_PT_YEAR/TPM_PT_DAY_OF_YEAR (Errata 1.11/1.15 §2.24،
// وTCG Guide 1.38→1.59: «The errata version that is implemented by a TPM is reported in … TPM_PT_DAY_OF_YEAR and TPM_PT_YEAR»).
const R138_ERRATA_2_22_FIRST_CONFIRMED = { year: 2019, dayOfYear: 193 };

/**
 * يفسر قيمة TPM2_PT_NV_COUNTERS_MAX **بحسب مستوى المواصفة الذي تعلنه الشريحة**:
 * المراجعة (TPM2_PT_REVISION) وتاريخ المواصفة/الإراتا (TPM2_PT_YEAR، TPM2_PT_DAY_OF_YEAR).
 *
 * - قيمة موجبة ⇒ `fixed-maximum`: حدّ أعلى لعدد فهارس العدّادات (لا سعة حرّة).
 * - صفر مع مراجعة ≥ 159 (1.59) ⇒ `no-fixed-maximum`: NOTE 2 في Part 2 r1.59 فأحدث
 *   («The value zero indicates that there is no fixed maximum»).
 * - صفر مع مراجعة 138 وتاريخ ≥ 2019-07-12 ⇒ `no-fixed-maximum`: النصُّ الأصليُّ لـr1.38 بلا هذه الـNOTE،
 *   لكنّ إراتا r1.38 (البند 2.22، من v1.8 فأحدث) تضيفها.
 * - غير ذلك (r1.38 بتاريخٍ أقدمَ أو بلا تاريخ، أو مراجعةٌ أخرى < 159، أو بلا مراجعة) ⇒
 *   `zero-meaning-not-established`: الدلالةُ **غيرُ مثبَتةٍ من المعلَن**، فلا يُقرأ الصفر «غير مدعوم» ولا «بلا حدّ».
 *
 * الخاصيةُ لا تُثبت دعمَ العدّادات: `supportProven: false` دائماً، و`supportProofRequires: 'counter-creation'`
 * يسمّي ما يلزمُ لإثباته (إنشاءُ عدّادٍ فعليّ) ولا يدّعي أنّه حدث (LIVE-46، WL-438).
 * والمدخلات الخام: رقمٌ صحيحٌ أو نصٌّ عشريٌّ أو `0x…`؛ وما لا يُحلَّل ⇒ فشلٌ مغلق.
 * @param {number|string} rawValue رقم أو نص مثل "0x0"
 * @param {number|string|null} [revisionTimes100] TPM2_PT_REVISION الخام (المراجعة × 100: 0x8A = 1.38، 0x9F = 1.59)
 * @param {{year?: number|string|null, dayOfYear?: number|string|null}|null} [specDate] TPM2_PT_YEAR وTPM2_PT_DAY_OF_YEAR الخام
 * @returns {{ok: true, maxCounters: number, revisionTimes100: number|null, specDate: {year: number, dayOfYear: number}|null,
 *   supportProven: false, supportProofRequires: 'counter-creation', basis: string,
 *   semantics: 'no-fixed-maximum'|'fixed-maximum'|'zero-meaning-not-established'}|{ok: false, error: string}}
 */
export function interpretNvCountersMax(rawValue, revisionTimes100, specDate) {
  const value = parseRawInteger(rawValue);
  if (value === null) return { ok: false, error: 'NV_COUNTERS_MAX_UNKNOWN: unparsable value' };
  let revision = null;
  if (revisionTimes100 !== undefined && revisionTimes100 !== null) {
    revision = parseRawInteger(revisionTimes100);
    if (revision === null || revision === 0) return { ok: false, error: 'TPM_PT_REVISION_UNKNOWN: unparsable revision' };
  }
  let date = null;
  if (specDate !== undefined && specDate !== null) {
    const year = parseRawInteger(specDate.year);
    const dayOfYear = parseRawInteger(specDate.dayOfYear);
    if (year === null || dayOfYear === null || year < 2013 || dayOfYear < 1 || dayOfYear > 366) {
      return { ok: false, error: 'TPM_PT_SPEC_DATE_UNKNOWN: unparsable year/day-of-year' };
    }
    date = { year, dayOfYear };
  }
  const base = {
    ok: /** @type {true} */ (true),
    maxCounters: value,
    revisionTimes100: revision,
    specDate: date,
    supportProven: /** @type {false} */ (false),
    supportProofRequires: /** @type {'counter-creation'} */ ('counter-creation'),
  };
  if (value > 0) return { ...base, semantics: 'fixed-maximum', basis: 'nonzero-value' };
  if (revision !== null && revision >= 159) {
    return { ...base, semantics: 'no-fixed-maximum', basis: 'part2-r1.59+-note2' };
  }
  if (revision === 138 && date !== null && dateAtLeast(date, R138_ERRATA_2_22_FIRST_CONFIRMED)) {
    return { ...base, semantics: 'no-fixed-maximum', basis: 'r1.38-errata-2.22' };
  }
  return { ...base, semantics: 'zero-meaning-not-established', basis: 'no-normative-text-established-for-reported-level' };
}

/** @param {{year: number, dayOfYear: number}} a @param {{year: number, dayOfYear: number}} b */
function dateAtLeast(a, b) {
  return a.year > b.year || (a.year === b.year && a.dayOfYear >= b.dayOfYear);
}

/** عددٌ صحيحٌ غيرُ سالبٍ آمنٌ من رقمٍ أو نصٍّ عشريٍّ/`0x…`؛ وإلّا null. */
function parseRawInteger(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseHexValue(v) : null;
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
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
