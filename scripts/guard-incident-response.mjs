#!/usr/bin/env node
/**
 * حاجزُ مسارِ الاستجابةِ للحوادث — البوابةُ السادسةُ والثلاثون في تسلسلِ
 * الحواجزِ المُعلَنِ في سجلِّ العمل (الخطوة `M10.03`).
 *
 * **رتبةٌ مقيسةٌ لا مُدَّعاة (المادة 4):** موضعُ هذا الحاجزِ المقيسُ في سلسلةِ
 * `npm run validate` هو **الرابعةُ والثلاثون** بين خطواتِها كلِّها (وهي سبعٌ
 * وثلاثون بعد إضافتِه)، و**السادسُ والعشرون** بين حواجزِها (وهي ثمانيةٌ
 * وعشرون)، وهو **الثامنُ والعشرون** عدداً بين نصوصِ `guard:*` في
 * `package.json`. والرتبةُ المُعلَنةُ في العنوانِ أعلاه تتبع التسلسلَ المكتوبَ
 * في سجلِّ العملِ منذ `WL-043`، وفارقُهما دَينُ توثيقٍ **سابقٌ** لهذه الخطوةِ
 * مسجَّلٌ في `WL-048` و`WL-050` و`WL-051` و`WL-052` و`WL-053` و`WL-054`، ولا
 * يُصلَح بتعديلِ سجلٍّ قديم (المادة 4).
 *
 * البوابةُ الخامسةُ والثلاثون تحرس أن يكون لكلِّ إشارةٍ **هدفٌ مُعلَنٌ تُقاس
 * عليه**. وهذه تحرس أن يكون لكلِّ **هدفٍ مُعلَنٍ مسارُ استجابةٍ مكتوبٌ**:
 * قاعدةٌ تُنبِّه، ودرجةٌ بمهلتَيها، ومستجيبٌ يُحَلُّ من شِفتٍ لا فجوةَ فيه،
 * وسلَّمٌ لا يُقفَز، وتقريرُ مراجعةٍ خطُّ زمنِه من القرص. واثنتا عشرةَ قاعدة:
 *
 *   R0: `config/incident-response.yaml` تُحمَّل بمخطَّطها الصارم؛ ووثيقةٌ
 *       تُخالف مخطَّطَها تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: **التقابلُ مع وثيقةِ مستوياتِ الخدمةِ في الاتجاهين**: كلُّ هدفٍ تُشير
 *       إليه قاعدةٌ معلَنٌ هناك، **وكلُّ هدفٍ معلَنٍ هناك له قاعدةٌ واحدةٌ على
 *       الأقلّ** — فهدفٌ بلا قاعدةٍ عهدٌ لا يراقبه أحدٌ، وقاعدةٌ بلا هدفٍ
 *       تنبيهٌ لا مصدرَ لحكمِه.
 *   R2: كلُّ قاعدةٍ ودرجةٍ ورمزِ رفضٍ وضمانٍ وشِفتٍ موثَّقٌ بالاسمِ في
 *       `docs/INCIDENT_RESPONSE.md` (المادة 1).
 *   R3: التقابلُ في الاتجاهين بين `refusalCodes` في الوثيقةِ و`IR_ERRORS` في
 *       `src/incident-response/errors.mjs`.
 *   R4: كلُّ رمزِ ضمانٍ (`G-IR-*`) حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R5: **المهلاتُ بياناتٌ لا كود**: كلُّ مهلةٍ مُعلَنةٍ في الوثيقةِ (بالملّي
 *       ثانيةِ، من ١٠٠٠ فما فوق) **لا تظهر نصّاً** في وحداتِ المسار؛ فرقمٌ
 *       مكتوبٌ في الوثيقةِ وفي الكودِ مصدرا حقيقةٍ لشيءٍ واحد، يُشدَّد أحدهما
 *       ويبقى الآخر.
 *   R6: **المناوبةُ تُغطّي الدورةَ بلا فجوةٍ ولا تداخُل**، **وكلُّ مستجيبٍ
 *       وكلُّ جهةِ تصعيدٍ معلَنةٌ في `config/crisis-room.yaml`** — لا قائمةَ
 *       جهاتٍ ثانيةً تُصان في موضعين فتتباعدان.
 *   R7: الحاجزُ مربوطٌ بالمسار: `npm run guard:incident-response` في `validate`
 *       وفي `.github/workflows/ci.yml` بنصٍّ واحد؛ فبوابةٌ لا تُشغَّل آلياً
 *       ليست بوابةً بل نيّة.
 *   R8: **المسارُ يقرأ ولا يقيس ولا يستورد**: لا `addCounter(` ولا
 *       `recordHistogram(` في وحداتِه، ولا استيرادَ من `../telemetry/` ولا من
 *       `../service-levels/` ولا من `../operations/` ولا من `../crisis/` —
 *       اللوحةُ والمركزُ **يُحقَنان** لا يُستورَدان، وإلا صار في التركيبِ
 *       لوحتان ومركزان.
 *   R9: **لا ساعةَ نظامٍ ولا مؤقِّتَ ذاتيّ**: `Date.now(` لا يظهر إلا مرّةً
 *       واحدةً على الأكثرِ (قيمةً افتراضيةً في المُنشئ)، ولا `setTimeout(` ولا
 *       `setInterval(` في أيِّ وحدةٍ من وحداتِ المسار.
 *   R10: **لا سجلَّ حوادثَ ثانياً ولا درجاتَ ثانيةً**: أسماءُ درجاتِ مركزِ
 *        العملياتِ (`incidentSeverity`) لا تظهر نصّاً في وحداتِ المسار، وتقييدُ
 *        الحادثةِ يمرّ من `operations.record(` وحدَه.
 *   R11: ملفّاتُ المسارِ والاختبارِ موجودة، **واختبارُ القبولِ يقرأ ملفَّ
 *        السجلِّ من القرص** (`readFileSync`) ويُنادي `publishReview(` — فمعيارُ
 *        «تقريرِ مراجعةٍ موثَّق» لا يُقاس بنصٍّ يُقرأ في حاجزٍ بل بسلوكٍ يُشغَّل.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يرفع تنبيهاً ولا يقيس
 * مهلةً؛ ومعيارُ القبولِ («تمرين: تنبيهٌ ⇒ استجابةٌ ⇒ تقريرُ مراجعةٍ موثَّق»)
 * سلوكٌ مقيسٌ في `tests/incident-response/drill.test.mjs` على تركيبٍ حقيقيٍّ
 * بسجلٍّ دائمٍ على القرصِ ومركزِ عملياتٍ حقيقيٍّ ولوحةِ مستوياتِ خدمةٍ حقيقية.
 *
 * **حدٌّ معلَن ثانٍ:** R5 يقيس المهلاتِ من ١٠٠٠ فما فوقَ وحدَها؛ فحدودُ الطولِ
 * الصغيرةُ (٢٠ و٤٠ و٦٠) أعدادٌ تظهر في أيِّ كودٍ لأسبابٍ أخرى، وفحصُها نصّاً
 * كان سيُنتج ضجيجاً لا حراسة. وحراستُها في مكانِها الصحيح: `assertSections`
 * تقرؤها من الوثيقةِ لا من ثابتٍ، ويقيس ذلك اختبارُ الوثيقةِ المُبدَّلة.
 *
 * **حدٌّ معلَن ثالث:** الحاجزُ لا يفحص وجودَ قناةِ نقلٍ خارجيةٍ لأنّ الخطوةَ
 * لا تدّعيها: `channel` معرّفٌ يُقيَّد في السجلِّ، والنقلُ دَينٌ معلَنٌ موروثٌ
 * من `M9.06` مسجَّلٌ في `REMAINING_WORK.md`.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { IR_ERRORS, loadIncidentResponsePolicy } from '../src/incident-response/index.mjs';
import { loadServiceLevelPolicy } from '../src/service-levels/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @param {string} relative @returns {string} */
function readOrEmpty(relative) {
  const file = path.join(ROOT, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @type {string[]} */
const violations = [];

/** وحداتُ المسارِ التي تُفحَص نصّاً — تُعلَن هنا كي لا يُفلت ملفٌّ بإضافتِه. */
const MODULE_FILES = [
  'src/incident-response/incident-response.mjs',
  'src/incident-response/alerts.mjs',
  'src/incident-response/rotation.mjs',
  'src/incident-response/review.mjs',
  'src/incident-response/errors.mjs',
  'src/incident-response/index.mjs',
  'src/incident-response/notifier.mjs',
];

// ── R0: الوثيقةُ تُحمَّل بمخطَّطها ──
/** @type {import('../src/incident-response/incident-response.mjs').IncidentResponsePolicy | null} */
let policy = null;
try {
  policy = loadIncidentResponsePolicy();
} catch (error) {
  violations.push(
    `R0: وثيقةُ مسارِ الاستجابةِ لا تُحمَّل: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** @type {import('../src/service-levels/service-levels.mjs').ServiceLevelPolicy | null} */
let sloPolicy = null;
try {
  sloPolicy = loadServiceLevelPolicy();
} catch (error) {
  violations.push(
    `R1: وثيقةُ مستوياتِ الخدمةِ لا تُحمَّل فلا يُقاس تقابلُها مع قواعدِ التنبيه: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (policy !== null) {
  // ── R1: التقابلُ مع أهدافِ مستوياتِ الخدمةِ في الاتجاهين ──
  if (sloPolicy !== null) {
    /** @type {Set<string>} */
    const objectives = new Set();
    for (const capability of sloPolicy.capabilities) {
      for (const objective of capability.objectives) objectives.add(objective.id);
    }
    const watched = new Set(policy.rules.map((rule) => rule.objective));
    for (const rule of policy.rules) {
      if (!objectives.has(rule.objective)) {
        violations.push(
          `R1: القاعدة ${rule.id} تُشير إلى الهدف ${rule.objective} وليس معلَناً في config/service-levels.yaml — وقاعدةٌ بلا هدفٍ تنبيهٌ لا مصدرَ لحكمِه.`,
        );
      }
    }
    for (const objective of objectives) {
      if (!watched.has(objective)) {
        violations.push(
          `R1: الهدف ${objective} معلَنٌ في وثيقةِ مستوياتِ الخدمةِ ولا قاعدةَ تنبيهٍ واحدةً عليه — وعهدٌ لا يراقبه أحدٌ عهدٌ يُقاس ولا يُبلَّغ، وهو بعينُه العيبُ الذي جاءت M10.03 لتُغلقه.`,
        );
      }
    }
  }

  // ── R2: التوثيقُ بالاسم (المادة 1) ──
  const doc = readOrEmpty('docs/INCIDENT_RESPONSE.md');
  if (doc === '') {
    violations.push(
      'R2: docs/INCIDENT_RESPONSE.md غائبٌ — ولا عملَ بلا توثيقٍ (المادة 1)، ومسارُ استجابةٍ غيرُ مكتوبٍ مسارٌ لا يُتَّبع في الثالثةِ صباحاً.',
    );
  } else {
    /** @type {Array<[string, readonly string[]]>} */
    const named = [
      ['قاعدة', policy.rules.map((rule) => rule.id)],
      ['درجة', policy.severities.map((severity) => severity.id)],
      ['رمزَ رفضٍ', policy.refusalCodes],
      ['ضمانَ', policy.guarantees.map((guarantee) => guarantee.id)],
      ['شِفتَ', policy.rotation.shifts.map((shift) => shift.id)],
      ['قسمَ تقريرٍ', policy.review.requiredSections.map((section) => section.id)],
    ];
    for (const [kind, names] of named) {
      for (const name of names) {
        if (!doc.includes(name)) {
          violations.push(`R2: ${kind} ${name} غيرُ موثَّقٍ بالاسمِ في docs/INCIDENT_RESPONSE.md.`);
        }
      }
    }
  }

  // ── R3: رموزُ الرفضِ في الاتجاهين ──
  const errorsText = readOrEmpty('src/incident-response/errors.mjs');
  for (const code of policy.refusalCodes) {
    if (!errorsText.includes(`'${code}'`)) {
      violations.push(
        `R3: الرمز ${code} مُعلَنٌ في الوثيقةِ ولا يُكتب نصّاً في src/incident-response/errors.mjs — ووعدُ رفضٍ لا يُنفَّذ أسوأُ من غيابِه.`,
      );
    }
  }
  const declared = new Set(policy.refusalCodes);
  for (const code of Object.values(IR_ERRORS)) {
    if (!declared.has(code)) {
      violations.push(
        `R3: الرمز ${code} يُرفع في الكودِ ولا يُعلَنُ في config/incident-response.yaml — ورفضٌ لا يجده قارئُ الوثيقةِ رفضٌ لا يُتوقَّع.`,
      );
    }
  }

  // ── R4: رمزُ كلِّ ضمانٍ في ملفِّ إنفاذِه ──
  for (const guarantee of policy.guarantees) {
    const enforcing = readOrEmpty(guarantee.enforcedBy);
    if (enforcing === '') {
      violations.push(
        `R4: ملفُّ إنفاذِ الضمان ${guarantee.id} (${guarantee.enforcedBy}) غائبٌ — وضمانٌ بلا موضعِ إنفاذٍ دعوى.`,
      );
      continue;
    }
    for (const code of guarantee.codes) {
      if (!enforcing.includes(code.replace(/^IR_/, ''))) {
        violations.push(
          `R4: الضمان ${guarantee.id} يزعم رفعَ ${code} في ${guarantee.enforcedBy} ولا يظهر فيه نصّاً.`,
        );
      }
    }
  }

  // ── R5: المهلاتُ بياناتٌ لا كود ──
  /** @type {Map<number, string>} */
  const deadlines = new Map();
  for (const severity of policy.severities) {
    deadlines.set(severity.acknowledgeWithinMs, `${severity.id}.acknowledgeWithinMs`);
    deadlines.set(severity.escalateAfterMs, `${severity.id}.escalateAfterMs`);
  }
  for (const rule of policy.rules) {
    if (typeof rule.graceMs === 'number') deadlines.set(rule.graceMs, `${rule.id}.graceMs`);
  }
  deadlines.set(policy.rotation.cycleMs, 'rotation.cycleMs');
  for (const shift of policy.rotation.shifts) {
    if (shift.startMs >= 1000) deadlines.set(shift.startMs, `${shift.id}.startMs`);
    if (shift.endMs >= 1000) deadlines.set(shift.endMs, `${shift.id}.endMs`);
  }
  deadlines.set(policy.review.dueWithinMs, 'review.dueWithinMs');
  for (const relative of MODULE_FILES) {
    const text = readOrEmpty(relative);
    for (const [value, where] of deadlines) {
      if (value < 1000) continue;
      if (new RegExp(`(^|[^0-9])${value}([^0-9]|$)`).test(text)) {
        violations.push(
          `R5: المهلة ${value} المُعلَنةُ في الوثيقةِ (${where}) مكتوبةٌ نصّاً في ${relative} — ومصدرا حقيقةٍ لمهلةٍ واحدةٍ يتباعدان عند أولِ تعديل.`,
        );
      }
    }
  }

  // ── R6: المناوبةُ والجهاتُ من غرفةِ الأزمات ──
  // التغطيةُ نفسُها مفحوصةٌ في المُحمِّلِ (R0 يسقط دونها)، والمقيسُ هنا أنّ كلَّ
  // مستجيبٍ وكلَّ جهةِ تصعيدٍ **معلَنةٌ في وثيقةِ غرفةِ الأزماتِ** بمعرّفِها.
  /** @type {Set<string>} */
  const crisisContacts = new Set();
  const crisisFile = path.join(ROOT, 'config', 'crisis-room.yaml');
  if (!fs.existsSync(crisisFile)) {
    violations.push(
      'R6: config/crisis-room.yaml غائبٌ — ومسارُ استجابةٍ يُصعِّد إلى جهاتٍ لا وثيقةَ لها يُصعِّد إلى أسماءٍ لا مسؤولياتٍ.',
    );
  } else {
    const crisis = /** @type {{ escalation?: { contacts?: Array<{ id?: string }> } }} */ (
      YAML.parse(fs.readFileSync(crisisFile, 'utf8'))
    );
    for (const contact of crisis.escalation?.contacts ?? []) {
      if (typeof contact?.id === 'string') crisisContacts.add(contact.id);
    }
    if (crisisContacts.size === 0) {
      violations.push(
        'R6: لا جهةَ تصعيدٍ واحدةً في config/crisis-room.yaml تُقابَل بها جهاتُ المسار.',
      );
    }
    for (const shift of policy.rotation.shifts) {
      if (!crisisContacts.has(shift.responder)) {
        violations.push(
          `R6: مستجيبُ الشِفت ${shift.id} هو ${shift.responder} وليس معلَناً في جهاتِ config/crisis-room.yaml — وقائمةُ جهاتٍ ثانيةٌ تُصان في موضعين فتتباعدان.`,
        );
      }
    }
    for (const step of policy.escalation.ladder) {
      if (!crisisContacts.has(step.contact)) {
        violations.push(
          `R6: جهةُ المرتبة ${step.tier} في السلَّم هي ${step.contact} وليست معلَنةً في جهاتِ config/crisis-room.yaml.`,
        );
      }
    }
  }

  // ── R7: الحاجزُ مربوطٌ بالمسارِ بنصٍّ واحد ──
  const pkg = readOrEmpty('package.json');
  const ci = readOrEmpty('.github/workflows/ci.yml');
  const invocation = 'npm run guard:incident-response';
  if (!pkg.includes('"guard:incident-response"')) {
    violations.push('R7: النصُّ guard:incident-response غيرُ معلَنٍ في package.json.');
  }
  if (!pkg.includes(invocation)) {
    violations.push(
      `R7: «${invocation}» غيرُ مربوطٍ بسلسلةِ validate في package.json — وبوابةٌ لا تُشغَّل آلياً ليست بوابةً بل نيّة.`,
    );
  }
  if (!ci.includes(invocation)) {
    violations.push(
      `R7: «${invocation}» غيرُ مُشغَّلٍ في .github/workflows/ci.yml — والأخضرُ المحليُّ ليس حكمَ CI (المادة 2).`,
    );
  }

  // ── R8 و R9 و R10: قراءةُ نصِّ الوحدات ──
  const incidentSeverities = new Set(policy.severities.map((s) => s.incidentSeverity));
  let dateNowCount = 0;
  for (const relative of MODULE_FILES) {
    const text = readOrEmpty(relative);
    if (text === '') {
      violations.push(`R11: الملفُّ ${relative} غائبٌ — ولا ادّعاءَ بلا دليلٍ يُشغَّل (المادة 2).`);
      continue;
    }

    // R8
    for (const forbidden of ['addCounter(', 'recordHistogram(']) {
      if (text.includes(forbidden)) {
        violations.push(
          `R8: ${relative} يكتب في طبقةِ القياسِ (${forbidden}) — ومسارُ الاستجابةِ يقرأ الحكمَ ولا يقيس، وإلا صار في النظامِ عدّادان.`,
        );
      }
    }
    for (const forbidden of [
      "from '../telemetry/",
      "from '../service-levels/",
      "from '../operations/",
      "from '../crisis/",
    ]) {
      if (text.includes(forbidden)) {
        violations.push(
          `R8: ${relative} يستورد «${forbidden}…» — واللوحةُ والمركزُ يُحقَنان لا يُستورَدان، وإلا صار في التركيبِ لوحتان ومركزان لشيءٍ واحد.`,
        );
      }
    }

    // R9
    dateNowCount += (text.match(/Date\.now\(/g) ?? []).length;
    for (const forbidden of ['setTimeout(', 'setInterval(']) {
      if (text.includes(forbidden)) {
        violations.push(
          `R9: ${relative} يستعمل ${forbidden} — ولا مؤقِّتَ يعمل بنفسِه في هذه الوحدة؛ التقييمُ يقع عند النداءِ بساعةٍ مُمرَّرة، ومؤقِّتٌ يموت بصمتٍ يُخفي أنّ التقييمَ لم يقع.`,
        );
      }
    }

    // R10
    if (relative !== 'src/incident-response/errors.mjs') {
      for (const severity of incidentSeverities) {
        if (text.includes(`'${severity}'`)) {
          violations.push(
            `R10: ${relative} يكتب درجةَ مركزِ العمليات «${severity}» نصّاً — والدرجاتُ تُقرأ من الوثيقةِ وتُقابَل بوثيقةِ المركزِ، ولا تُكتب قائمةٌ ثانيةٌ في الكود.`,
          );
        }
      }
    }
  }
  if (dateNowCount > 1) {
    violations.push(
      `R9: Date.now( يظهر ${dateNowCount} مرّاتٍ في وحداتِ المسارِ والمسموحُ مرّةٌ واحدةٌ (قيمةً افتراضيةً في المُنشئ) — وزمنٌ يُقرأ من ساعةِ النظامِ زمنٌ لا يملكه الاختبار.`,
    );
  }

  const engine = readOrEmpty('src/incident-response/incident-response.mjs');
  if (!engine.includes('operations.record(')) {
    violations.push(
      'R10: تقييدُ الحادثةِ لا يمرّ من operations.record( في محرِّكِ المسار — ولا يُنشأ سجلُّ حوادثَ ثانٍ بديلاً عن مركزِ العمليات.',
    );
  }
  if (!engine.includes('#clock(')) {
    violations.push(
      'R9: محرِّكُ المسارِ بلا مِقبضِ ساعةٍ متحقِّقةٍ (#clock) — ومهلةٌ على ساعةٍ لا تُفحَص مهلةٌ تُزوَّر بصمت.',
    );
  }

  // ── R11: ملفّاتُ الاختبارِ وسلوكُ القبول ──
  for (const relative of [
    'config/incident-response.yaml',
    'config/schemas/incident-response.schema.json',
    'tests/incident-response/incident-response.test.mjs',
    'tests/incident-response/drill.test.mjs',
  ]) {
    if (readOrEmpty(relative) === '') {
      violations.push(`R11: الملفُّ ${relative} غائبٌ — ولا ادّعاءَ بلا دليلٍ يُشغَّل (المادة 2).`);
    }
  }
  const drill = readOrEmpty('tests/incident-response/drill.test.mjs');
  if (drill !== '') {
    if (!drill.includes('readFileSync')) {
      violations.push(
        'R11: اختبارُ القبولِ لا يقرأ ملفَّ السجلِّ من القرصِ (readFileSync غائب) — وتقريرٌ يُبنى على ذاكرةِ العمليةِ عن نفسِها ليس تقريراً موثَّقاً.',
      );
    }
    if (!drill.includes('publishReview(')) {
      violations.push(
        'R11: اختبارُ القبولِ لا يُنادي publishReview( — ومعيارُ الخطوةِ «تنبيهٌ ⇒ استجابةٌ ⇒ تقريرُ مراجعةٍ موثَّق» لا يُقاس بنصٍّ يُقرأ.',
      );
    }
    if (!drill.includes('PersistentEventLog')) {
      violations.push(
        'R11: اختبارُ القبولِ لا يُركِّب سجلًّا دائماً حقيقيّاً (PersistentEventLog غائب) — وسجلٌّ ذاكريٌّ يُسقِط معنى «الدليلِ من القرص».',
      );
    }
  }

  // ── R12: كلُّ قناةِ تنبيهٍ لها نقطةُ تسليمٍ مُعلَنة ──
  if (policy.delivery?.endpoints) {
    /** @type {Set<string>} */
    const deliveryChannels = new Set(
      policy.delivery.endpoints.map((/** @type {{ id: string }} */ ep) => ep.id),
    );
    for (const rule of policy.rules) {
      if (!deliveryChannels.has(rule.channel)) {
        violations.push(`R12: ${rule.id} channel ${rule.channel} has no delivery endpoint.`);
      }
    }
    if (readOrEmpty('src/incident-response/notifier.mjs') === '') {
      violations.push('R12: src/incident-response/notifier.mjs missing.');
    }
  } else {
    violations.push('R12: delivery.endpoints section missing.');
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز مسار الاستجابة للحوادث رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const ruleCount = policy === null ? 0 : policy.rules.length;
const severityCount = policy === null ? 0 : policy.severities.length;
const shiftCount = policy === null ? 0 : policy.rotation.shifts.length;
const tierCount = policy === null ? 0 : policy.escalation.ladder.length;
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
const sectionCount = policy === null ? 0 : policy.review.requiredSections.length;
const endpointCount = policy === null ? 0 : (policy.delivery?.endpoints?.length ?? 0);
console.log(
  `✅ حاجز مسار الاستجابة للحوادث: ${ruleCount} قواعدَ تنبيهٍ كلٌّ مربوطةٌ، و${severityCount} درجاتٍ، و${shiftCount} شِفتاً، و${tierCount} مرتبةً، و${sectionCount} أقسامًا، و${codeCount} رمزَ رفضٍ، و${guaranteeCount} ضماناتٍ، و${endpointCount} نقاطَ تسليمٍ مُعلَنةٌ، والمسار يقرأ الحكمَ ولا يقيس ولا يستورد، والساعة مُمرّرةٌ ولا مؤقِّتَ يعمل بنفسِهِ.`,
);
