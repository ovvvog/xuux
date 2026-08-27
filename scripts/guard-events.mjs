#!/usr/bin/env node
// حاجز قنوات الأحداث — M7.07، بوابة G8
//
// الغرض: أن يفشل البناء إذا انحرف **الإعلان** عن **الواقع**. ومعيار القبول
// المعلَن («مُنتِج ومستهلك عبر كل قناة، مع رفض رسالة تخالف العقد») يُقاس في
// `tests/events/event-bus.test.mjs`؛ وهذا الحاجز يحرس ما لا يحرسه اختبارُ سلوك:
// أن تبقى العقودُ المعلَنة **مطابقةً لما يُنشر فعلاً في `src/`**، وأن لا يُفتح
// مسارٌ جانبيٌّ حول الناقل، وأن لا تُكسر توافقيةُ عقدٍ منشورٍ في صمت. وستُّ قواعد:
//
//   R1 — السياسة تتماسك أو يسقط الحاجز: التحميلُ نفسه هو الفحص (انتسابُ النوع
//        لقناته، ولا نوعَ مكرَّر، ولا حقلَ بوصفين، ولا حقلَ محرَّماً في عقد)، فلا
//        تُكرَّر قواعده هنا كي لا تنحرف نسخةُ الحاجز عن نسخة الكود.
//   R2 — **كل نوعٍ يُنشر في `src/` له عقد، وكل عقدٍ له موضعُ نشر**: تُستخرج مواضعُ
//        الإصدار من شجرة الإعراب (لا بمطابقة نصّية)، فنوعٌ يُصدَر بلا عقد يُقرأ
//        عند النشر رفضاً مفاجئاً، وعقدٌ لا موضعَ له وعدٌ لقارئٍ لن يصل إليه شيء.
//   R3 — **العقدُ يقول ما يُرسَل فعلاً**: كل حقلٍ إلزاميٍّ في العقد موجودٌ في **كل**
//        موضعِ نشرٍ مغلقٍ لذلك النوع، وكل حقلٍ يُرسله موضعٌ معلَنٌ إلزاميّاً أو
//        اختيارياً. وعقدٌ يُعلن إلزاميّاً ما يُرسله موضعٌ واحدٌ فقط أسوأ من عقدٍ
//        فضفاض: القارئ يبني عليه ثم يسقط عند الموضع الآخر.
//   R4 — **`open` يطابق الواقع**: نوعٌ يُنشر بحملٍ مبثوثٍ أو متغيّرٍ لا تُقرأ
//        حقولُه ثابتةً يجب أن يكون معلَناً `open`؛ ونوعٌ معلَنٌ `open` وكل مواضعه
//        مغلقةٌ إعلانٌ يُخفي عقداً كان يمكن قياسُه.
//   R5 — لا مسار جانبي، ولا حقلَ محرَّماً في حملٍ منشور: لا وحدة في `src/` تلمس
//        مستودعَي الرسائل والمواضع إلا المعلَنة في `repositoryHolders`، ولا موضعُ
//        نشرٍ يُرسل حقلاً من `forbiddenPayloadKeys`. فمن أراد قناةً بلا عقدٍ ولا
//        تخليصٍ لا يحتاج ثغرةً في الناقل، بل مساراً أقصر: المستودع مباشرةً.
//   R6 — **التوافقُ الخلفي يُقاس لا يُدَّعى**: تُقارن السياسةُ بخط الأساس
//        `config/events.baseline.json`، فحذفُ نوعٍ أو قناةٍ أو إضافةُ حقلٍ إلزاميٍّ
//        على نسخةٍ قائمة يُسقط الحاجز حتى تُرفع النسخة صراحةً. وكلُّ قيدٍ في
//        الجدولين له نظيرٌ في هجرة: إعلانٌ بلا قيدٍ يُقرأ ضماناً وهو وعد.
//
// رمز الخروج 1 عند أي مخالفة، ولا يُسكت الحاجز ببيئةٍ ولا بوسيط.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectEventEmissions } from './lib/event-emissions.mjs';
import { findBreakingChanges, loadEventsBaseline, loadEventsPolicy } from '../src/events/index.mjs';

// `--root` يسمح بتشغيل الحاجز على شجرةٍ أخرى، وهو ما يجعل **الحاجز نفسه** قابلاً
// للاختبار. وكل قراءةٍ هنا تُحلّ على الشجرة المفحوصة لا على شجرة الحاجز.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** @type {string[]} */
const violations = [];

// ── R1: السياسة تُحمَّل أو يسقط الحاجز ──
const policy = loadEventsPolicy({ dir: path.join(ROOT, 'config') });

// ── R2/R3/R4: الإعلان يطابق ما يُنشر فعلاً في `src/` ──
const emissions = collectEventEmissions(ROOT, path.join(ROOT, 'src'));

/** @type {Map<string, typeof emissions>} */
const sites = new Map();
for (const emission of emissions.filter((entry) => !entry.pattern)) {
  const list = sites.get(emission.type) ?? [];
  list.push(emission);
  sites.set(emission.type, list);
}
// الموضعُ القالبي (`agent.${state}`) يُنسب إليه **ما لا موضعَ صريحَ له** في
// مجاله. وهذا **حدٌّ معلَن**: قيمةُ المتغيّر لا تُقرأ من شجرة الإعراب، فلو
// نُسب إلى القالب كلُّ ما يبدأ بسابقته لقيس عقدُ كل نوعٍ على حملٍ ليس له
// ولسقط الحاجز على البريء. والأثرُ أن نوعاً يُنشر من موضعٍ قالبيٍّ **ومن** موضعٍ
// صريحٍ يُقاس عقدُه على الصريح وحده — وهو مكتوب في `docs/REMAINING_WORK.md`.
for (const emission of emissions.filter((entry) => entry.pattern)) {
  const prefix = emission.type.slice(0, -1);
  const covered = policy.channels
    .flatMap((channel) => channel.types)
    // القالبُ يولّد **مقطعاً واحداً**: `model.${state}` لا يولّد
    // `model.evaluation.passed` — وذاك له قالبُه في `evaluation.mjs`. ومطابقةُ
    // السابقة وحدها كانت تنسب إلى قالبٍ حملَ قالبٍ آخر فيسقط الحاجز على البريء.
    .filter(
      (contract) =>
        contract.type.startsWith(prefix) &&
        !contract.type.slice(prefix.length).includes('.') &&
        !sites.has(contract.type),
    );
  if (
    covered.length === 0 &&
    !policy.channels.some((channel) => channel.types.some((c) => c.type.startsWith(prefix)))
  ) {
    violations.push(
      `R2: الإصدار في ${emission.file}:${emission.line} يُنشر النمط «${emission.type}» ولا يقابله نوعٌ معلَن؛ نشرٌ بلا عقدٍ يُرفض عند التشغيل رفضاً مفاجئاً.`,
    );
    continue;
  }
  for (const contract of covered) {
    sites.set(contract.type, [emission]);
  }
}

for (const [type, list] of sites) {
  const contract = policy.contractFor(type);
  if (contract === null) {
    violations.push(
      `R2: النوع «${type}» يُنشر في ${list.map((site) => `${site.file}:${site.line}`).join('، ')} ولا عقدَ له في config/events.yaml.`,
    );
  }
}

for (const channel of policy.channels) {
  for (const contract of channel.types) {
    const list = sites.get(contract.type) ?? [];
    if (list.length === 0) {
      violations.push(
        `R2: العقد «${contract.type}» معلَنٌ ولا موضعَ نشرٍ له في src/؛ عقدٌ بلا مُنتِجٍ وعدٌ لقارئٍ لن يصل إليه شيء.`,
      );
      continue;
    }
    const closed = list.filter((site) => !site.payloadOpen);
    // R4: الانفتاحُ صفةُ الواقع لا صفةُ الإعلان.
    const anyOpen = list.some((site) => site.payloadOpen);
    if (anyOpen && !contract.open) {
      violations.push(
        `R4: «${contract.type}» يُنشر بحملٍ لا تُقرأ حقولُه ثابتةً (${list
          .filter((site) => site.payloadOpen)
          .map((site) => `${site.file}:${site.line}`)
          .join('، ')}) وليس معلَناً \`open\`؛ عقدٌ يُدّعى مغلقاً وهو غير مقيس ادّعاءُ ضمان.`,
      );
    }
    if (!anyOpen && contract.open) {
      violations.push(
        `R4: «${contract.type}» معلَنٌ \`open\` وكلُّ مواضعه مغلقةٌ؛ إعلانٌ يُخفي عقداً كان يمكن قياسه.`,
      );
    }
    // R3: الإلزاميُّ موجودٌ في كل موضعٍ مغلق، والمُرسَلُ كلُّه معلَن.
    for (const site of closed) {
      const missing = contract.required.filter((field) => !site.payloadKeys.includes(field));
      if (missing.length > 0) {
        violations.push(
          `R3: «${contract.type}» يُعلن إلزاميّاً ${missing.join('، ')} ولا يُرسله الموضع ${site.file}:${site.line}؛ قارئٌ يبني على الإلزامي يسقط عند هذا الموضع.`,
        );
      }
      const undeclared = site.payloadKeys.filter(
        (field) => !contract.required.includes(field) && !contract.optional.includes(field),
      );
      if (undeclared.length > 0) {
        violations.push(
          `R3: الموضع ${site.file}:${site.line} يُرسل في «${contract.type}» حقولاً غير معلَنة: ${undeclared.join('، ')}؛ حقلٌ يُرسل ولا يُعلن حقلٌ لا يجرؤ قارئٌ على قراءته.`,
        );
      }
    }
  }
}

// ── R5: لا حقلَ محرَّماً في حملٍ منشور، ولا مسار جانبي ──
for (const emission of emissions) {
  const banned = emission.payloadKeys.filter((field) =>
    policy.forbiddenPayloadKeys.includes(field),
  );
  if (banned.length > 0) {
    violations.push(
      `R5: الموضع ${emission.file}:${emission.line} يُرسل حقلاً محرَّماً (${banned.join('، ')}) في «${emission.type}»؛ قناةٌ تحمل مادّةً تُبطل التصنيف والتشفير معاً.`,
    );
  }
}

const holders = policy.repositoryHolders.map((entry) => path.normalize(entry));
for (const file of walk(path.join(ROOT, 'src'))) {
  const relative = path.relative(ROOT, file);
  if (holders.includes(path.normalize(relative))) continue;
  const text = read(file);
  if (/eventMessages|eventOffsets|EVENT_MESSAGE_SPEC|EVENT_OFFSET_SPEC/.test(text)) {
    violations.push(
      `R5: ${relative} يلمس مستودعَ الرسائل أو المواضع وهو ليس من الوحدات المعلَنة في repositoryHolders؛ المسارُ الأقصر إلى قناةٍ بلا عقدٍ ولا تخليصٍ هو المستودع مباشرة.`,
    );
  }
}

// ── R6: التوافقُ الخلفي وقيودُ القاعدة ──
const baseline = loadEventsBaseline({ dir: path.join(ROOT, 'config') });
if (baseline === null) {
  violations.push(
    'R6: خط أساس العقود غائب (config/events.baseline.json)؛ بلا خط أساسٍ لا يُقاس كسرُ توافقٍ بل يُدَّعى عدمُه.',
  );
} else {
  for (const breaking of findBreakingChanges(baseline, {
    channels: policy.channels.map((channel) => ({
      id: channel.id,
      version: channel.version,
      types: channel.types.map((contract) => ({
        type: contract.type,
        version: contract.version,
        required: [...contract.required],
        optional: [...contract.optional],
      })),
    })),
  })) {
    violations.push(
      `R6: كسرُ توافقٍ خلفيٍّ بلا رفعِ نسخة [${breaking.kind}] في «${breaking.subject}» — ${breaking.detail}`,
    );
  }
}

const migrationsDir = path.join(ROOT, 'migrations');
const sql = fs.existsSync(migrationsDir)
  ? fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => read(path.join(migrationsDir, file)))
      .join('\n')
  : '';
const REQUIRED_CONSTRAINTS = Object.freeze([
  'event_messages_channel_seq_unique',
  'event_messages_hash_unique',
  'event_messages_chain_linked',
  'event_messages_type_in_channel',
  'event_offsets_group_channel_unique',
]);
for (const constraint of REQUIRED_CONSTRAINTS) {
  if (!sql.includes(constraint)) {
    violations.push(
      `R6: القيد «${constraint}» معلَنٌ في الكود ولا نظيرَ له في أي هجرة؛ قيدٌ في الكود وحده لا يردّ كتابةً مباشرةً في القاعدة.`,
    );
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز الأحداث: الإعلانُ انحرف عن الواقع، أو انفتح مسارٌ حول القنوات.');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

const typeCount = policy.channels.reduce((sum, channel) => sum + channel.types.length, 0);
console.log(
  `✅ حاجز الأحداث: ${policy.channels.length} قناةً و${typeCount} عقداً مطابقةً لـ${emissions.length} موضعَ نشرٍ في src/، و${REQUIRED_CONSTRAINTS.length} قيداً في القاعدة، و${policy.repositoryHolders.length} وحدةً وحدها تلمس المستودعين، ولا كسرَ توافقٍ عن خط الأساس.`,
);

/**
 * @param {string} file
 * @returns {string}
 */
function read(file) {
  return fs.readFileSync(file, 'utf8');
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.mts')) files.push(full);
  }
  return files;
}
