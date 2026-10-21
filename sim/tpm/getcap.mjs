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

// ── مصدرُ التاريخِ ومجالُه (WL-441) ──
// Part 2 r1.59 الجدول 23: ‏TPM_PT_YEAR «the specification year using the CE»، وTPM_PT_DAY_OF_YEAR
// «the specification day of year» (المثال: 15 نوفمبر 2010 = 319، فالأوّلُ من يناير = 1)، و«The specification
// date is on the title page of the specification or errata». وإراتا r1.38 v1.15 §2.24 (‏2025-06-10):
// «TPM_SPEC_YEAR and TPM_SPEC_DAY_OF_YEAR should be set to the date of the most recent Errata document
// that revised the behavior of the TPM» (والمنصوصُ هناك 2024/172). فالتاريخُ تاريخُ وثيقةٍ منشورة:
//   (1) صلاحيّةٌ تقويميّة: سنةٌ ميلاديّةٌ ≥ 1 (لا سنةَ صفرٍ في CE)، واليومُ 1..365، أو 366 في السنةِ الكبيسةِ
//       الغريغوريّةِ وحدَها؛ وما خالفَ ذلك ليس تاريخًا ⇒ فشلٌ مغلق.
//   (2) اتّساقٌ مع المراجعة: لا تسبقُ وثيقةٌ لـr1.38 نصَّ r1.38 نفسَه (صفحةُ عنوانِه: 2016-09-29، اليوم 273،
//       كما تنقلُه صفحاتُ عنوانِ إراتاه) ⇒ تاريخٌ أقدمُ مع المراجعة 138 تناقضٌ ⇒ فشلٌ مغلق.
//   (3) نافذةُ الدليل: لا تُرقّى الدلالةُ إلّا داخلَ [أوّلِ إراتا مؤكَّدٍ أنّها تحوي البندَ 2.22، آخرِ إراتا
//       تحقّقنا من نصِّها أنّها تحويه]. وما بعدَ الحدِّ الأعلى (ومنه سنواتٌ كـ0xFFFFFFFF) لا وثيقةَ متحقَّقًا منها
//       تقابلُه ⇒ `zero-meaning-not-established` لا خطأٌ ولا ترقية. لا حدَّ زمنيَّ مخترَعًا: الحدّانِ تاريخا صفحتَي
//       عنوانِ وثيقتَين قُرئ نصُّهما، ويُرفَعُ الأعلى حينَ يُقرأُ نصُّ إراتا أحدث (v1.16 بتاريخ 2026-08-11 لم يُقرأ).
// أوّلُ إصدارٍ تحقّقنا أنّه يحوي البندَ 2.22 (إضافةُ NOTE «الصفرُ = لا حدَّ أقصى ثابتاً»): Errata v1.8
// بتاريخ 2019-07-12 (اليوم 193). وإراتا v1.0 (2017-01-16) لا تحويه، والإصداراتُ بينهما لم يُتحقَّق منها،
// فتاريخٌ أقدمُ من v1.8 لا يُثبِتُ الدلالةَ (تحفّظٌ لا نفي). والإرشادُ (TCG Guide 1.38→1.59): «The errata
// version that is implemented by a TPM is reported in the TPM properties TPM_PT_DAY_OF_YEAR and TPM_PT_YEAR».
const R138_SPEC_TITLE_DATE = { year: 2016, dayOfYear: 273 };
const R138_ERRATA_2_22_FIRST_CONFIRMED = { year: 2019, dayOfYear: 193 };
// آخرُ إراتا لـr1.38 قُرئ نصُّها فوُجدَ فيه البندُ 2.22: v1.15، صفحةُ عنوانِها 2025-06-10 (اليوم 161).
const R138_ERRATA_2_22_LATEST_VERIFIED = { year: 2025, dayOfYear: 161 };

/**
 * يفسر قيمة TPM2_PT_NV_COUNTERS_MAX **بحسب مستوى المواصفة الذي تعلنه الشريحة**:
 * المراجعة (TPM2_PT_REVISION) وتاريخ المواصفة/الإراتا (TPM2_PT_YEAR، TPM2_PT_DAY_OF_YEAR).
 *
 * - قيمة موجبة ⇒ `fixed-maximum`: حدّ أعلى لعدد فهارس العدّادات (لا سعة حرّة).
 * - صفر مع مراجعة ≥ 159 (1.59) ⇒ `no-fixed-maximum`: NOTE 2 في Part 2 r1.59 فأحدث
 *   («The value zero indicates that there is no fixed maximum»).
 * - صفر مع مراجعة 138 وتاريخ في [2019-07-12، 2025-06-10] ⇒ `no-fixed-maximum`: النصُّ الأصليُّ لـr1.38 بلا هذه الـNOTE،
 *   لكنّ إراتا r1.38 (البند 2.22، من v1.8 فأحدث) تضيفها.
 * - صفر مع مراجعة 138 وتاريخ بعدَ آخرِ إراتا متحقَّقٍ منها (2025-06-10) ⇒ `zero-meaning-not-established`
 *   بأساسِ `r1.38-spec-date-beyond-latest-verified-errata` (WL-441).
 * - تاريخٌ ليس تاريخًا تقويميًّا (اليوم 366 في سنةٍ غيرِ كبيسة، أو صفر، أو السنة 0)، أو أقدمُ من نصِّ r1.38 مع
 *   المراجعة 138 ⇒ فشلٌ مغلق `TPM_PT_SPEC_DATE_UNKNOWN` (WL-441).
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
    if (year === null || dayOfYear === null) {
      return { ok: false, error: 'TPM_PT_SPEC_DATE_UNKNOWN: unparsable year/day-of-year' };
    }
    if (year < 1 || dayOfYear < 1 || dayOfYear > daysInCeYear(year)) {
      return { ok: false, error: 'TPM_PT_SPEC_DATE_UNKNOWN: not a calendar date (day-of-year outside the CE year)' };
    }
    date = { year, dayOfYear };
    if (revision === 138 && !dateAtLeast(date, R138_SPEC_TITLE_DATE)) {
      return { ok: false, error: 'TPM_PT_SPEC_DATE_UNKNOWN: date precedes the r1.38 specification (2016-09-29)' };
    }
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
    if (!dateAtLeast(R138_ERRATA_2_22_LATEST_VERIFIED, date)) {
      // تاريخٌ صحيحٌ تقويميًّا بعدَ آخرِ إراتا متحقَّقٍ منها: لا وثيقةَ مقروءةً تقابلُه ⇒ لا ترقية.
      return { ...base, semantics: 'zero-meaning-not-established', basis: 'r1.38-spec-date-beyond-latest-verified-errata' };
    }
    return { ...base, semantics: 'no-fixed-maximum', basis: 'r1.38-errata-2.22' };
  }
  return { ...base, semantics: 'zero-meaning-not-established', basis: 'no-normative-text-established-for-reported-level' };
}

/** عددُ أيّامِ السنةِ الميلاديّةِ بقاعدةِ الكبيسِ الغريغوريّة (÷4، إلّا ÷100 ما لم تقبلْ ÷400). @param {number} year */
function daysInCeYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** @param {{year: number, dayOfYear: number}} a @param {{year: number, dayOfYear: number}} b */
function dateAtLeast(a, b) {
  return a.year > b.year || (a.year === b.year && a.dayOfYear >= b.dayOfYear);
}

/**
 * عددٌ صحيحٌ غيرُ سالبٍ ضمنَ مدى `UINT32` (‏`0x0`–`0xFFFFFFFF`: خاصيّاتُ TPM التي تُفسَّرُ هنا من هذا النوعِ)،
 * من رقمٍ أو نصٍّ عشريٍّ/`0x…`؛ وما جاوزَ المدى أو لم يُحلَّل ⇒ `null` (فشلٌ مغلق: قيمةٌ خامٌ فوقَ المدى
 * لا تصدرُ عن خاصيةٍ من هذا النوعِ فلا تُقرأ مراجعةً ولا حدًّا).
 */
function parseRawInteger(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseHexValue(v) : null;
  return n !== null && Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff ? n : null;
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
