#!/usr/bin/env node
// حاجز اتّصالِ ترقيمِ سجلِّ الأعمالِ — أُضيف في `WL-178` إغلاقاً للدَينِ `DOC-8`.
//
// **العيبُ الذي يُغلقه، وقد قِيس لا افتُرض:** في `WL-170` قِيسَ سجلُّ الأعمالِ
// آليّاً فظهرَ أنّ ترقيمَه **ليس متّصلاً ولا مُفرَداً**: معرِّفاتٌ غائبةٌ
// ومعرِّفانِ مكرَّرانِ. ثمّ ظهرَ في `WL-178` أنّ الغيابَ **لم يكن كلُّه من نوعٍ
// واحدٍ**: مُدخلتانِ كُتِبتا في وقتِهما ثمّ **حُذِفتا سهواً** بكتابةِ الملفِّ
// كاملاً فوقَ سابقِه (`WL-087` في `8182c4f1`، و`WL-140` في `30a24eba`)، وثالثةٌ
// **كُرِّرت حرفاً بحرفٍ** في الكوميتِ نفسِه. **فالخطرُ ليس فجوةَ ترقيمٍ، بل أنّ
// عملاً موثَّقاً يزولُ توثيقُه ولا يصرخُ أحدٌ** — وذاك نقضٌ للمادة 1 يمرُّ صامتاً.
//
// **ولا يُغلَقُ مثلُ هذا باستعادةِ ما ضاعَ:** الاستعادةُ تُصلحُ الحادثةَ،
// والحاجزُ يمنعُ الصنفَ. فمن حذفَ مُدخلةً سهواً بعدَ اليومِ **سقطَ عددُ عناوينِها
// فظهرت فجوةٌ فأوقفَه `npm run validate` قبلَ الدفعِ**.
//
// **ما يقيسه بالضبطِ:**
//   R1: كلُّ عنوانِ مُدخلةٍ (`### `) يبدأُ بتاريخٍ ثمّ معرِّفِ المُدخلةِ بصيغةِ
//       `### [YYYY-MM-DD] — WL-###`. **ومعرِّفُ المُدخلةِ هو الأوّلُ لا غيرُ**؛
//       فعنوانٌ يُصحِّحُ قيداً آخرَ يذكرُ معرِّفَه أيضاً، وذكرٌ ليس مُلْكاً.
//   R2: لا معرِّفَ مكرَّراً إلا ما أُعلِنَ في `config/work-log-ids.yaml` بعددِه.
//   R3: لا فجوةَ في المدى `1..الأقصى` إلا ما أُعلِنَ فيه بسببِه.
//   R4: **ولا استثناءَ بلا محلٍّ**: فجوةٌ مُعلَنةٌ صارَ لها عنوانٌ، أو تكرارٌ
//       مُعلَنٌ لم يبقَ مكرَّراً بعددِه — يُرفَضُ، لئلّا يصيرَ الملفُّ مقبرةَ
//       أعذارٍ تُخفي عيباً جديداً تحتَ عذرٍ قديمٍ.
//   R5: كلُّ استثناءٍ يحملُ `reason` غيرَ فارغٍ، وكلُّ معرِّفٍ فيه بصيغةٍ صحيحةٍ.
//   R6: الترتيبُ تنازليٌّ — كلُّ مُدخلةٍ يَلِيها ما هو أقدمُ منها (أو مُكرَّرٌ مُعلَنٌ)،
//       لأنّ المُدخلةَ الأحدثَ في الأعلىِ مباشرةً بعدَ الفاصلِ. مُدخلةٌ يَسبِقُها
//       أصغرُ منها في الرقمِ هو خرقٌ للترتيبِ. والتكرارُ المُعلَنُ وحده يُقبَل.
//
// **حدٌّ معلَنٌ لا يُتجاوَزُ:** هذا حاجزُ **اتّصالِ ترقيمٍ** لا حاجزُ **صدقِ
// مضمونٍ**: يقيسُ أنّ المعرِّفاتِ متّصلةٌ مُفرَدةٌ، **ولا يقيسُ أنّ المُدخلةَ
// تصفُ ما جرى وصفاً صحيحاً**، ولا يمنعُ من حذفَ مُدخلةً **وأعلنَ معرِّفَها فجوةً**
// في ملفِّ الاستثناءاتِ — وذاك يبقى شرطَ المادة 1 والمادة 6 على المنفِّذِ،
// **ومراجعةُ التعديلِ على ملفِّ الاستثناءاتِ نفسِه واجبُ المراجعِ لا الحاجزِ**.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

const rootIndex = process.argv.indexOf('--root');
const rootArgument = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
const root = rootArgument ? path.resolve(rootArgument) : process.cwd();

const LOG_PATH = 'docs/roadmap/05-work-log.md';
const CONFIG_PATH = 'config/work-log-ids.yaml';
const MAP_PATH = 'docs/audit/work-log-id-map.md';

const ID_PATTERN = /WL-(\d{3})/gu;

/**
 * @param {string} relative مسارٌ نسبيٌّ من جذرِ المستودعِ.
 * @returns {string} نصُّ الملفِّ.
 */
function readText(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}

const HEADING_PATTERN = /^### \[\d{4}-\d{2}-\d{2}\] — WL-(\d{3})\b/u;
// شكلٌ قديمٌ قائمٌ في مُدخلتَينِ (`WL-115` و`WL-116`): المعرِّفُ في ذيلِ العنوانِ
// بين قوسَينِ. **يُقبَلُ قياساً لا استحساناً** — المعرِّفُ موجودٌ والصيغةُ وحدَها
// تختلفُ، وتغييرُ عنوانِ مُدخلةٍ مضت تعديلٌ للتاريخِ تمنعُه المادة 6.
const LEGACY_TAIL_PATTERN = /\(WL-(\d{3})\)\s*$/u;

/**
 * @param {string} logText نصُّ سجلِّ الأعمالِ.
 * @returns {{ line: string, id: number | null, mentioned: number[] }[]} عناوينُ المُدخلاتِ.
 */
export function collectHeadings(logText) {
  const headings = [];
  for (const line of logText.split('\n')) {
    if (!line.startsWith('### ')) continue;
    const canonical = HEADING_PATTERN.exec(line) ?? LEGACY_TAIL_PATTERN.exec(line);
    const mentioned = [...line.matchAll(ID_PATTERN)].map((match) => Number(match[1]));
    headings.push({
      line,
      id: canonical ? Number(canonical[1]) : null,
      mentioned,
    });
  }
  return headings;
}

/**
 * @param {{ logText: string, configText: string, mapText?: string }} input النصوصُ المقيسةُ.
 * @returns {{ failures: string[], total: number, unique: number, max: number, gaps: number[] }} حكمُ القياسِ.
 */
export function auditWorkLogIds({ logText, configText, mapText = '' }) {
  /** @type {string[]} */
  const failures = [];
  const headings = collectHeadings(logText);

  // R1
  for (const heading of headings) {
    if (heading.id === null) {
      failures.push(
        `R1: عنوانٌ لا يحملُ معرِّفَ مُدخلةٍ لا في صدرِه «### [YYYY-MM-DD] — WL-###» ولا في ذيلِه «(WL-###)»: ${heading.line.slice(0, 120)}`,
      );
    }
  }

  /** @type {number[]} */
  const ids = [];
  for (const heading of headings) {
    if (heading.id !== null) ids.push(heading.id);
  }
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  const config = YAML.parse(configText) ?? {};
  /** @type {Map<number, string>} */
  const declaredGaps = new Map();
  /** @type {Map<number, number>} */
  const declaredDuplicates = new Map();

  // R5
  for (const [key, list] of [
    ['allowed_gaps', config.allowed_gaps ?? []],
    ['allowed_duplicates', config.allowed_duplicates ?? []],
  ]) {
    for (const item of list) {
      const raw = String(item?.id ?? '');
      const match = /^WL-(\d{3})$/u.exec(raw);
      if (!match) {
        failures.push(`R5: معرِّفٌ غيرُ صحيحِ الصيغةِ في ${key}: «${raw}»`);
        continue;
      }
      const reason = String(item?.reason ?? '').trim();
      if (reason.length === 0) {
        failures.push(`R5: استثناءٌ بلا سببٍ مكتوبٍ في ${key}: ${raw}`);
      }
      const numeric = Number(match[1]);
      if (key === 'allowed_gaps') declaredGaps.set(numeric, reason);
      else declaredDuplicates.set(numeric, Number(item?.count ?? 0));
    }
  }

  const max = ids.length > 0 ? Math.max(...ids) : 0;

  // R2
  for (const [id, count] of counts) {
    if (count === 1) continue;
    const allowed = declaredDuplicates.get(id);
    if (allowed !== count) {
      failures.push(
        `R2: المعرِّفُ WL-${String(id).padStart(3, '0')} مكرَّرٌ ${count} مرّاتٍ${
          allowed === undefined ? ' بلا إعلانٍ' : ` والمُعلَنُ ${allowed}`
        }`,
      );
    }
  }

  // R3
  /** @type {number[]} */
  const gaps = [];
  for (let id = 1; id <= max; id += 1) {
    if (counts.has(id)) continue;
    gaps.push(id);
    if (!declaredGaps.has(id)) {
      failures.push(
        `R3: فجوةٌ غيرُ مُعلَنةٍ عندَ WL-${String(id).padStart(3, '0')} — إمّا مُدخلةٌ حُذِفت أو معرِّفٌ أُهمِلَ`,
      );
    }
  }

  // R4
  for (const id of declaredGaps.keys()) {
    if (counts.has(id)) {
      failures.push(
        `R4: استثناءُ فجوةٍ بلا محلٍّ — WL-${String(id).padStart(3, '0')} صارَ له عنوانٌ فيُحذَفُ من ${CONFIG_PATH}`,
      );
    }
  }
  for (const [id, declared] of declaredDuplicates) {
    if ((counts.get(id) ?? 0) !== declared) {
      failures.push(
        `R4: استثناءُ تكرارٍ بلا محلٍّ — WL-${String(id).padStart(3, '0')} مُعلَنٌ ${declared} والمقيسُ ${counts.get(id) ?? 0}`,
      );
    }
  }

  // R6: الترتيبُ تنازليٌّ — المُدخلةُ الأحدثُ في الأعلى
  const orderedIds = headings.map((h) => h.id).filter((id) => id !== null);
  for (let i = 0; i < orderedIds.length - 1; i += 1) {
    const current = orderedIds[i];
    const next = orderedIds[i + 1];
    if (current === undefined || next === undefined) continue;
    if (current < next) {
      failures.push(
        `R6: الترتيبُ غيرُ تنازليٍّ — WL-${String(current).padStart(3, '0')} يَسبِقُ WL-${String(next).padStart(3, '0')} والمُدخلةُ الأحدثُ في الأعلى`,
      );
    }
  }

  // R5 (تكملة): كلُّ استثناءٍ مذكورٌ في الخريطةِ المقروءةِ للبشرِ
  for (const id of [...declaredGaps.keys(), ...declaredDuplicates.keys()]) {
    const label = `WL-${String(id).padStart(3, '0')}`;
    if (mapText.length > 0 && !mapText.includes(label)) {
      failures.push(`R5: استثناءٌ غيرُ مشروحٍ في ${MAP_PATH}: ${label}`);
    }
  }

  return { failures, total: headings.length, unique: counts.size, max, gaps };
}

function main() {
  const logText = readText(LOG_PATH);
  const configText = readText(CONFIG_PATH);
  // خريطةُ المعرِّفاتِ المقروءةُ للبشرِ: إن غابت **لم يُخترَعْ لها بديلٌ** — يُمرَّرُ
  // نصٌّ فارغٌ فتُسقَطُ قاعدةُ التشارُحِ وحدَها، ولا تُدَّعى مطابقةٌ لم تُقَسْ.
  let mapText = '';
  try {
    mapText = readText(MAP_PATH);
  } catch {
    // غيابُ الخريطةِ لا يُوقِفُ قياسَ الترقيمِ.
  }

  const result = auditWorkLogIds({ logText, configText, mapText });

  console.log('حاجز اتّصالِ ترقيمِ سجلِّ الأعمالِ');
  console.log(
    `  العناوينُ: ${result.total} · المعرِّفاتُ المُفرَدةُ: ${result.unique} · الأقصى: WL-${String(
      result.max,
    ).padStart(3, '0')} · الفجواتُ المُعلَنةُ: ${result.gaps.length}`,
  );

  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`  ❌ ${failure}`);
    console.error(
      '\n❌ الحكمُ: ترقيمُ السجلِّ منقطعٌ أو مكرَّرٌ بلا إعلانٍ. **وأوّلُ ما يُفحَصُ: هل حُذِفت مُدخلةٌ بكتابةِ الملفِّ فوقَ سابقِه؟**',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    '✅ الحكمُ: الترقيمُ متّصلٌ مُفرَدٌ، وكلُّ استثناءٍ مُعلَنٌ بسببِه. **اتّصالٌ مقيسٌ لا صدقُ مضمونٍ: صحّةُ ما في المُدخلةِ تبقى شرطَ المادة 1 على المنفِّذِ.**',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
