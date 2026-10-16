#!/usr/bin/env node
// scripts/sync-plan-commits.mjs — تحديثُ خططِ المراجعةِ بالكوميتِ المقيسِ الجديد
//
// ── لماذا هذا السكربت ──
//
// مسارُ النشرِ (publish-skip-baseline.yml) يضعُ الأثرَ الجديدَ في الشجرةِ ثم
// يُشغِّلُ حاجزَ `guard:skip-baseline`. والحاجزُ يتحقَّقُ (R5) أنَّ كلَّ خطّةٍ
// تُسمّي الكوميتَ المقيسَ. لكنَّ الخططَّ تُذكِرُ الكوميتَ المقيسَ القديمَ،
// فالخطّةُ لا تُحدَّثُ تلقائيّاً عندَ إنتاجِ أثرٍ جديد. هذا السكربتُ يُصلِحُ
// الفجوةَ: يقرأُ الأثرَ، ويُحدِّثُ كلَّ خطّةٍ لتذكرَ الكوميتَ المقيسَ الجديد.
//
// ── العقد ──
//
//   S1 — لكلِّ مُدخلةٍ في `measurements[]` يوجدُ ملفُّ خطّةٍ على القرصِ.
//   S2 — في كلِّ خطّةٍ سطرٌ واحدٌ يحوي «الكوميتُ المقيسُ» يليهُ كوميتٌ بـ8 محارف.
//   S3 — السطرُ نفسُهُ يحوي الأمرَ المقيسَ (`command`).
//   S4 — لا يُمَسُّ سطرُ «الكوميتُ المُراجَعُ» بحرف.
//   S5 — التاريخُ في السطرِ نفسهِ يُحدَّثُ لـ`measuredOn`.
//   S6 — الفشلُ مغلقٌ: أيُّ خرقٍ لـS1–S4 يُوقفُ السكربتَ برمزِ خروجٍ `1`.
//   S7 — فقرةُ «ملاحظةُ بيئةٍ مُقاسةٌ» إن وُجدت في الخطّةِ **تُوَلَّدُ من الأثرِ**
//        لا تُنسخُ يدًا: الأرقامُ الأربعةُ (المنسوبُ للقاعدةِ، والعدّادُ الختاميُّ،
//        وأسطرُ التخطّي، والنقاطُ العليا) وتفصيلُ الأسبابِ الأُخرى — فهذا عينُ ما
//        كان يقعُ كلَّ دورةِ قياسٍ: يزيدُ اختبارُ قاعدةٍ فينحرفُ الرقمُ المعلنُ في
//        الخطّةِ عن الأثرِ ويُسقِطُ الحاجزُ R4/DRIFT، فتُفتَحُ حزمةُ شفاءٍ يدويّةٌ.
//        المُولِّدُ هنا يجعلُ فرعَ البوتِ يُصلِحُ الرقمَ بنفسِهِ.
//   S8 — كلُّ سببٍ في `otherReasons` يجب أن يُطابِقَ بندًا معروفًا في القالبِ؛
//        سببٌ جديدٌ يُوقفُ السكربتَ (لا يُبتلَعُ ولا يُحذفُ) — تحديثُ القالبِ عمدةٌ.
//   S9 — حسابُ الأثرِ مقفولٌ: مجموعُ تفصيلِ الأسبابِ يسوّي أسطرَ التخطّي الباقيةَ
//        (‏skipLines − المنسوبِ للقاعدةِ) — وإلّا انغلقَ السكربتُ لا كتبَ فقرةً كاذبةً.
//
// الوسائط: <artifact-path> [root]
//   artifact-path — مسارُ ملفِّ الأثر (skip-baseline.json)
//   root          — جذرُ المستودع (افتراضيّاً `.`)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ARTIFACT_PATH = process.argv[2];
const ROOT = process.argv[3] || '.';

// ── قالبُ فقرةِ الأرقامِ (‏S7…S9) ──

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
/** كلماتُ عدِّ الفرادى: «وثلاثةٌ فرادى» لا «و٣ فرادى» ما دامَ العددُ صغيرًا. */
const SINGLES_WORDS = [
  '',
  'واحدٌ',
  'اثنانِ',
  'ثلاثةٌ',
  'أربعةٌ',
  'خمسةٌ',
  'ستةٌ',
  'سبعةٌ',
  'ثمانيةٌ',
  'تسعةٌ',
  'عشرةٌ',
];

/** @param {number} n */
function toArabicDigits(n) {
  return String(n)
    .split('')
    .map((d) => AR_DIGITS[Number(d)] ?? d)
    .join('');
}

const NUMBERS_MARK = 'ملاحظةُ بيئةٍ مُقاسةٌ لا مُقدَّرةٌ';

/**
 * بنودُ تفصيلِ الأسبابِ الأُخرى: مفتاحٌ يُطابِقُ وصفَ السببِ في الأثرِ وعنوانٌ ثابتٌ
 * في الفقرةِ. البندُ ذو العدِّ ١ يُجمَعُ في «فرادى»، وما فوقَهُ يُذكَرُ بعدِّهِ.
 */
const OTHER_CLAUSES = [
  { key: /swtpm|XUUX_TPM_SIM/, label: 'لغيابِ `swtpm/XUUX_TPM_SIM`' },
  {
    key: /مساحاتِ أسماء|namespaces|unshare|uid_map/,
    label: 'لتعذُّرِ إنشاءِ مساحاتِ أسماءِ النواةِ في مضيفِ القياسِ',
  },
  {
    key: /SoftHSM|التوكنِ الحقيقي/,
    label: 'لاختباراتِ التوكنِ الحقيقيِّ (`XUUX_HSM_TEST`)',
  },
  {
    key: /XUUX_REAL_PG_TLS/,
    label: 'لخادمِ PostgreSQL بـTLS (`XUUX_REAL_PG_TLS`)',
  },
  { key: /XUUX_CHANNEL_POC/, label: 'للقناةِ الحيّةِ (`XUUX_CHANNEL_POC`)' },
  { key: /الإنتاجي/, label: 'للمسارِ الإنتاجيِّ على توكنٍ حقيقيٍّ' },
  { key: /العزل الحقيقي/, label: 'عزلٌ حقيقيٌّ غيرُ متاحٍ' },
  { key: /متغيّراتٌ بيئيّة/, label: 'متغيّراتٌ بيئيّةٌ خارجيّةٌ' },
  { key: /SMTP/, label: 'بياناتُ اعتمادِ SMTP' },
];

/**
 * يبني فقرةَ الأرقامِ من مُدخلةِ قياسٍ واحدة: الأرقامُ الأربعةُ وتفصيلُ الأسبابِ
 * كلُّها من الأثرِ — لا رقمًا يُنسخُ يدًا. مطابقةُ الناتجِ لما في الشجرةِ الآنَ
 * شرطُ العودةِ الآمنةِ (لا فرقَ عندَ إعادةِ التشغيلِ على الأثرِ نفسِهِ).
 * @param {{ attributedToDatabaseUrl: number, skipped: number, skipLines: number, topLevelSkipPoints: number, otherReasons?: Array<{ reason: string, count: number }> }} entry
 * @returns {string}
 */
function renderNumbersLine(entry) {
  /** @type {string[]} */
  const parts = [];
  /** @type {string[]} */
  const singles = [];
  for (const clause of OTHER_CLAUSES) {
    const reason = (entry.otherReasons ?? []).find((r) => clause.key.test(String(r.reason)));
    if (reason === undefined) continue;
    if (reason.count === 1) singles.push(clause.label);
    else parts.push(`${toArabicDigits(reason.count)} ${clause.label}`);
  }
  if (singles.length > 0) {
    const word = SINGLES_WORDS[singles.length] ?? toArabicDigits(singles.length);
    parts.push(`${word} فرادى: ${singles.join('، و')}`);
  }
  const breakdown = `\u200f${parts.join('، و')}`;
  return (
    `> **${NUMBERS_MARK} (\u200fمُصحَّحةٌ في \`WL-232\` بالنتيجةِ \`R5-A-06\`):** ` +
    `بلا \`DATABASE_URL\` تتخطّى الحزمةُ ${toArabicDigits(entry.attributedToDatabaseUrl)} اختباراً ` +
    `**بسببِ غيابِ القاعدةِ وحدَه**. وعدّادُ التخطّي الختاميُّ **${toArabicDigits(entry.skipped)}** ` +
    `لأنَّ بقيّتَهُ أسبابٌ أُخرى مُسمّاةٌ (${breakdown})، وأسطرُ \`# SKIP\` كافّةً ` +
    `**${toArabicDigits(entry.skipLines)}**، ونقاطُ التخطّي في المستوى الأعلى ` +
    `**${toArabicDigits(entry.topLevelSkipPoints)}**. **وهذهِ ثلاثةُ مقاييسَ مختلفةٍ لا رقمٌ واحدٌ** ` +
    `— فالعضوُ يُصرِّحُ بأيِّها قاسَ ولا يَخلِطُها.`
  );
}

if (!ARTIFACT_PATH) {
  console.error('SYNC_PLAN_USAGE: يُمرَّرُ مسارُ ملفِّ الأثر.');
  process.exit(1);
}

const artifactAbs = resolve(ARTIFACT_PATH);
if (!existsSync(artifactAbs)) {
  console.error(`SYNC_PLAN_ARTIFACT_MISSING: ملفُّ الأثرِ غيرُ موجودٍ: ${artifactAbs}`);
  process.exit(1);
}

/** @type {{ measurements: Array<{ engagement: string; plan: string; command: string; commit: string; measuredOn: string; skipped?: number; skipLines?: number; topLevelSkipPoints?: number; attributedToDatabaseUrl?: number; otherReasons?: Array<{ reason: string; count: number }> }> }} */
const artifact = JSON.parse(readFileSync(artifactAbs, 'utf8'));

if (!Array.isArray(artifact.measurements) || artifact.measurements.length === 0) {
  console.error('SYNC_PLAN_NO_MEASUREMENTS: الأثرُ بلا مُدخلاتِ قياسٍ.');
  process.exit(1);
}

let updated = 0;
const violations = [];

for (const m of artifact.measurements) {
  const planPath = join(ROOT, m.plan);
  if (!existsSync(planPath)) {
    violations.push(`S1/PLAN_MISSING: ${m.plan} غيرُ موجودٍ.`);
    continue;
  }

  const text = readFileSync(planPath, 'utf8');
  const lines = text.split('\n');

  // S2 — ابحث عن سطر «الكوميتُ المقيسُ». قد يكونُ هناكَ أكثرُ من سطرٍ
  // (سجلُّ قياساتٍ سابقةٍ)، فيُحدَّثُ الأخيرُ (الأحدثُ) فقط.
  const measuredIndices = /** @type {number[]} */ ([]);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && l.includes('الكوميتُ المقيسُ')) {
      measuredIndices.push(i);
    }
  }
  if (measuredIndices.length === 0) {
    violations.push(`S2/NO_MEASURED_LINE: ${m.plan} لا يحوي سطرَ «الكوميتُ المقيسُ».`);
    continue;
  }

  // السطرُ الأخيرُ هو الأحدثُ — هو الذي يُحدَّثُ.
  const lineIdx = measuredIndices[measuredIndices.length - 1];
  if (lineIdx === undefined) {
    violations.push(`S2/NO_MEASURED_LINE: ${m.plan} لا يحوي سطرَ «الكوميتُ المقيسُ».`);
    continue;
  }
  const line = lines[lineIdx];
  if (!line) {
    violations.push(`S2/NO_MEASURED_LINE: ${m.plan} لا يحوي سطرَ «الكوميتُ المقيسُ».`);
    continue;
  }

  // S3 — السطرُ يحوي الأمرَ المقيس
  if (!line.includes(m.command)) {
    violations.push(
      `S3/COMMAND_MISSING: ${m.plan} السطرُ لا يحوي الأمرَ المقيس: \`${m.command}\`.`,
    );
    continue;
  }

  // S4 — لا يُمَسُّ «الكوميتُ المُراجَعُ»
  if (line.includes('الكوميتُ المُراجَعُ')) {
    violations.push(`S4/REVIEWED_LINE: ${m.plan} السطرُ يحوي «الكوميتُ المُراجَعُ» — لا يُمَسُّ.`);
    continue;
  }

  // استخرج الكوميتَ القديمَ (8–40 محرف hex)
  const hexMatch = line.match(/`([0-9a-f]{8,40})`/);
  if (!hexMatch) {
    violations.push(`S2/NO_HEX: ${m.plan} السطرُ لا يحوي كوميتاً بـ8–40 محرفٍ hex.`);
    continue;
  }

  const oldCommit = hexMatch[1];
  const newCommit = m.commit.slice(0, 8);

  // استخرج التاريخَ القديم
  const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
  const oldDate = dateMatch ? dateMatch[1] : null;
  const newDate = m.measuredOn;

  // S5 — حدِّث الكوميتَ والتاريخَ
  let newLine = line.replace(`\`${oldCommit}\``, `\`${newCommit}\``);
  if (oldDate && newDate && oldDate !== newDate) {
    newLine = newLine.replace(oldDate, newDate);
  }

  lines[lineIdx] = newLine;

  // S7 — فقرةُ الأرقامِ المقاسةِ: إن وُجدت وُلِّدت من الأثرِ لا تُنسخُ يدًا. غيابُها
  // ليسَ خرقًا هنا (الحاجزُ R4 يملكُ اكتمالَ الإعلانِ) — أما تعدُّدُها فغموضٌ يُغلقُ.
  const numbersIndices = /** @type {number[]} */ ([]);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && l.includes(NUMBERS_MARK)) numbersIndices.push(i);
  }
  if (numbersIndices.length > 1) {
    violations.push(
      `S7/AMBIGUOUS: ${m.plan} يحوي ${numbersIndices.length} فقراتِ أرقامٍ — واحدةٌ فقط.`,
    );
    continue;
  }
  if (numbersIndices.length === 1 && numbersIndices[0] !== undefined) {
    // S9 — حسابُ الأثرِ مقفولٌ قبلَ الكتابةِ: تفصيلُ الأسبابِ يسوّي الأسطرَ الباقيةَ.
    const others = (m.otherReasons ?? []).map((r) => Number(r.count));
    const othersSum = others.reduce((a, b) => a + b, 0);
    const remainder = Number(m.skipLines) - Number(m.attributedToDatabaseUrl);
    if (othersSum !== remainder) {
      violations.push(
        `S9/ACCOUNTING: ${m.plan} تفصيلُ الأسبابِ (${othersSum}) لا يسوّي أسطرَ التخطّي الباقيةَ (${remainder}).`,
      );
      continue;
    }
    // S8 — كلُّ سببٍ معروفٌ: سببٌ جديدٌ يوقفُ السكربتَ لا يُبتلَعُ — تحديثُ القالبِ عمدةٌ.
    let unknown = false;
    for (const r of m.otherReasons ?? []) {
      const matched = OTHER_CLAUSES.some((c) => c.key.test(String(r.reason)));
      if (!matched) {
        violations.push(`S8/UNKNOWN_REASON: ${m.plan} سببٌ لا يعرفهُ القالبُ: «${r.reason}».`);
        unknown = true;
      }
    }
    if (unknown) continue;
    const numbersEntry = {
      attributedToDatabaseUrl: Number(m.attributedToDatabaseUrl),
      skipped: Number(m.skipped),
      skipLines: Number(m.skipLines),
      topLevelSkipPoints: Number(m.topLevelSkipPoints),
      otherReasons: m.otherReasons ?? [],
    };
    const regenerated = renderNumbersLine(numbersEntry);
    if (lines[numbersIndices[0]] !== regenerated) {
      lines[numbersIndices[0]] = regenerated;
      console.log(`✅ ${m.plan}: فقرةُ الأرقامِ وُلِّدت من الأثرِ.`);
    }
  }

  writeFileSync(planPath, lines.join('\n'));
  updated += 1;

  console.log(
    `✅ ${m.plan}: ${oldCommit} → ${newCommit}` +
      (oldDate && oldDate !== newDate ? ` · ${oldDate} → ${newDate}` : ''),
  );
}

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`⛔ ${v}`);
  }
  process.exit(1);
}

console.log(`\nتمَّ تحديثُ ${updated} خطّةٍ.`);
