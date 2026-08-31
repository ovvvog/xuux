#!/usr/bin/env node
/**
 * حاجزُ غرفةِ الأزمات — البوابةُ الثانيةُ والثلاثون في `npm run validate`
 * (الخطوة `M9.06`).
 *
 * البوابةُ الحاديةُ والثلاثون تحرس **رؤيةَ** التشغيل، وهذه تحرس **إدارةَ
 * الأزمة**: أن يكون الإجراءُ بياناتٍ لا عُرفاً، وترتيبُه محفوظاً لا مُستحسَناً،
 * وأثرُه السياديُّ ماراً بالديوانِ لا حولَه، وحجْرُه حالةً في سجلِّ الهوياتِ لا
 * علماً في ذاكرة، وتصعيدُه بشريّاً من غيرِ رافعِه، ودليلُه من السجلِّ على القرص.
 * وعشرُ قواعد:
 *
 *   R0: `config/crisis-room.yaml` تُحمَّل بمخطَّطها الصارمِ وفحوصِ تماسكِها؛
 *       ووثيقةٌ تُخالف مخطَّطَها تُوقف البوابةَ قبل أيِّ فحصٍ آخر.
 *   R1: كلُّ خطوةِ أمرٍ في كلِّ إجراءٍ تُشير إلى أمرٍ **مُعلَنٍ في
 *       `config/royal-console.yaml`**؛ فأمرٌ يُسمّى هنا ولا وجودَ له في الديوانِ
 *       خطوةٌ ترفعها الأزمةُ فتسقط عند التنفيذ.
 *   R2: كلُّ رمزٍ في `CRISIS_ERRORS` مُعلَنٌ في الوثيقةِ وبالعكس، وكلُّ رمزِ
 *       ضمانٍ حاضرٌ **نصّاً** في ملفِّ إنفاذِه المُعلَن.
 *   R3: جهاتُ التصعيدِ أدوارُها معلَنةٌ في `config/roles.yaml`؛ فتصعيدٌ إلى دورٍ
 *       لا وجودَ له في دستورِ الأدوارِ تصعيدٌ بلا مُخاطَب.
 *   R4: **الساعةُ مُمرَّرةٌ لا ساعةُ النظام**: `Date.now(` لا يظهر في
 *       `src/crisis/` إلا مرّةً واحدةً — قيمةً افتراضيةً في المُنشئ — وكلُّ قياسٍ
 *       يمرّ من `#clock(`.
 *   R5: **لا طريقَ حولَ الديوان**: `src/crisis/` لا يستورد زرَّ الإيقافِ ولا
 *       بوابةَ التاجِ ولا هويةَ الملك، ولا يُنادي `haltSwitch.` ولا `.veto`
 *       ولا `sign(`؛ ونداءُ الأمرِ الوحيدُ `royalConsole.issue(`.
 *   R6: القيدُ **قبل** الأثر: قيدُ الخطوةِ يسبق نصّاً `switch (declared.kind)`،
 *       وقيدُ فتحِ التمرينِ يسبق `this.#drills.set(`، وقيدُ الإقرارِ يسبق
 *       `escalation.acknowledgedBy = actor`.
 *   R7: حالةُ الحجْرِ وحالةُ رفعِه في الوثيقةِ **قيمتانِ معلَنتانِ في
 *       `AgentState`** بسجلِّ الهويات؛ فحالةٌ تُخترع هنا تُرفَض في السجلِّ عند أوّلِ
 *       حجْر، وحجْرٌ يُرفَض في الأزمةِ أسوأُ من حجْرٍ لم يُبنَ.
 *   R8: الحاجزُ مربوطٌ بالمسار: `npm run guard:crisis` في `validate` وفي
 *       `.github/workflows/ci.yml` بالنصِّ نفسِه.
 *   R9: `docs/CRISIS_ROOM.md` موجودةٌ وتُعلن الإجراءاتَ بمعرّفاتِها وخطواتِها
 *       ورموزَ الرفضِ كلَّها والمهلةَ بالرقم؛ وملفُّ الاختبارِ موجودٌ ويقيس
 *       الرموزَ الحاكمةَ ومعيارَ القبولِ نفسَه.
 *
 * **حدٌّ معلَن أول:** الحاجزُ يقرأ النصَّ والوثيقةَ ولا يُنفِّذ تمريناً — تنفيذُ
 * التمرينِ كاملاً من الواجهةِ مقيسٌ في `tests/crisis/crisis-room.test.mjs` على
 * ديوانٍ حقيقيٍّ وسجلٍّ على القرص.
 *
 * **حدٌّ معلَن ثانٍ:** R5 يحرس **الكتابةَ** لا الالتفافَ في زمنِ التشغيل: من
 * مرَّر إلى الغرفةِ كائناً يُسمّي نفسَه ديواناً وهو ينادي الزرَّ مباشرةً فذاك
 * اختيارُ مُركِّبٍ مُعلَنٌ، والمقصودُ أن الوحدةَ نفسَها لا تعرف طريقاً غيرَ الديوان.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { CRISIS_ERRORS, CRISIS_STEP_KINDS, loadCrisisPolicy } from '../src/crisis/crisis-room.mjs';
import { AgentState } from '../src/identity/agent-registry.mjs';

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf('--root');
const rootArg = rootIndex >= 0 ? argv[rootIndex + 1] : undefined;
const ROOT =
  rootArg !== undefined && rootArg !== ''
    ? path.resolve(rootArg)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const violations = [];

/**
 * @param {string} relative
 * @returns {string}
 */
function readFile(relative) {
  const full = path.join(ROOT, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ═══ R0 ═══
/** @type {import('../src/crisis/crisis-room.mjs').CrisisPolicy | null} */
let policy = null;
try {
  policy = loadCrisisPolicy({ dir: path.join(ROOT, 'config') });
} catch (error) {
  violations.push(`R0: ${error instanceof Error ? error.message : String(error)}`);
}

// ═══ R1 ═══
if (policy !== null) {
  const consoleText = readFile('config/royal-console.yaml');
  /** @type {Set<string>} */
  const declaredCommands = new Set();
  if (consoleText === '') {
    violations.push(
      'R1: `config/royal-console.yaml` غير مقروءة، ولا تُقاس أوامرُ الأزمةِ بلا ديوان.',
    );
  } else {
    const parsed = /** @type {{ commands?: ReadonlyArray<{ id?: unknown }> }} */ (
      YAML.parse(consoleText)
    );
    for (const command of parsed.commands ?? []) {
      if (typeof command.id === 'string') declaredCommands.add(command.id);
    }
  }
  for (const procedure of policy.procedures) {
    for (const step of procedure.steps) {
      if (!CRISIS_STEP_KINDS.includes(step.kind)) {
        violations.push(
          `R1: الخطوة ${step.id} نوعُها «${step.kind}» وهو غيرُ مكتوبٍ في \`CRISIS_STEP_KINDS\`.`,
        );
      }
      if (step.kind !== 'command') continue;
      const command = String(step.command);
      if (declaredCommands.size > 0 && !declaredCommands.has(command)) {
        violations.push(
          `R1: الخطوة ${step.id} في ${procedure.id} تُصدر «${command}» وهو غيرُ معلَنٍ في وثيقةِ الديوان؛ وخطوةٌ ترفعها الأزمةُ ثم تسقط عند التنفيذِ أسوأُ من خطوةٍ لم تُكتب.`,
        );
      }
    }
  }
}

// ═══ R2 ═══
const roomSource = readFile('src/crisis/crisis-room.mjs');
if (roomSource === '') {
  violations.push('R2: `src/crisis/crisis-room.mjs` غير مقروء — ولا حاجزَ على كودٍ غائب.');
}
if (policy !== null) {
  /** @type {Set<string>} */
  const inCode = new Set(Object.values(CRISIS_ERRORS));
  /** @type {Set<string>} */
  const inDoc = new Set(policy.refusalCodes);
  for (const code of inCode) {
    if (!inDoc.has(code)) {
      violations.push(`R2: الرمز ${code} في الكودِ وغيرُ معلَنٍ في الوثيقة — رفضٌ بلا إعلان.`);
    }
  }
  for (const code of inDoc) {
    if (!inCode.has(code)) {
      violations.push(`R2: الرمز ${code} في الوثيقةِ ولا موضعَ له في الكودِ — إعلانٌ بلا إنفاذ.`);
    }
  }
  for (const guarantee of policy.guarantees) {
    const enforcing = readFile(guarantee.enforcedBy);
    if (enforcing === '') {
      violations.push(
        `R2: ملفُّ إنفاذِ الضمان ${guarantee.id} (${guarantee.enforcedBy}) غيرُ مقروء.`,
      );
      continue;
    }
    for (const code of guarantee.codes) {
      if (!enforcing.includes(code.replace(/^CRISIS_/, ''))) {
        violations.push(
          `R2: الضمان ${guarantee.id} يستند إلى ${code} وهو غائبٌ نصّاً عن ${guarantee.enforcedBy}.`,
        );
      }
    }
  }
}

// ═══ R3 ═══
if (policy !== null) {
  const rolesText = readFile('config/roles.yaml');
  if (rolesText === '') {
    violations.push(
      'R3: `config/roles.yaml` غير مقروءة، ولا تُقاس أدوارُ التصعيدِ بلا دستورِ أدوار.',
    );
  } else {
    const parsed = /** @type {{ roles?: ReadonlyArray<{ id?: unknown }> }} */ (
      YAML.parse(rolesText)
    );
    /** @type {Set<string>} */
    const declaredRoles = new Set();
    for (const role of parsed.roles ?? []) {
      if (typeof role.id === 'string') declaredRoles.add(role.id);
    }
    for (const contact of policy.escalation.contacts) {
      if (!declaredRoles.has(contact.role)) {
        violations.push(
          `R3: جهةُ التصعيد ${contact.id} دورُها «${contact.role}» وهو غيرُ معلَنٍ في وثيقةِ الأدوار؛ وتصعيدٌ إلى دورٍ لا وجودَ له تصعيدٌ بلا مُخاطَب.`,
        );
      }
    }
  }
}

// ═══ R4 ═══
if (roomSource !== '') {
  const systemClock = countOf(roomSource, 'Date.now(');
  if (systemClock !== 1) {
    violations.push(
      `R4: \`Date.now(\` يظهر ${systemClock} مرّةً في مسارِ الغرفةِ والمسموحُ واحدةٌ (القيمةُ الافتراضيةُ في المُنشئ)؛ ومهلةٌ تُقاس بساعةٍ لا تُقاد لا تُختبَر.`,
    );
  }
  if (!roomSource.includes('this.#nowMs = deps.nowMs ?? (() => Date.now())')) {
    violations.push('R4: الساعةُ المُمرَّرةُ ليست وصلةً في المُنشئ.');
  }
  for (const needle of [
    "this.#clock('فتحِ تمرين')",
    "this.#clock('تنفيذِ خطوة')",
    "this.#clock('إقرارِ تصعيد')",
    "this.#clock('إغلاقِ تمرين')",
  ]) {
    if (!roomSource.includes(needle)) {
      violations.push(`R4: قياسٌ لا يمرّ من الساعةِ المُمرَّرة (${needle} غائب).`);
    }
  }
}

// ═══ R5 ═══
if (roomSource !== '') {
  /** @type {Array<[string, string]>} */
  const forbidden = [
    ['halt-switch', 'استيرادُ زرِّ الإيقافِ مباشرةً يبني طريقاً حولَ التوقيعِ والتاج'],
    ['crown-gateway', 'استيرادُ بوابةِ التاجِ مباشرةً يُلغي معنى مرورِ الأمرِ بالديوان'],
    ['haltSwitch.', 'نداءُ زرِّ الإيقافِ من الغرفةِ يوقف دولةً بلا أمرٍ موقَّع'],
    ['.veto.', 'نداءُ النقضِ من الغرفةِ يَنقُض بلا أمرٍ موقَّع'],
    ['.sign(', 'الغرفةُ لا توقّع بالنيابةِ عن الملك'],
  ];
  for (const [needle, why] of forbidden) {
    if (roomSource.includes(needle)) {
      violations.push(`R5: «${needle}» يظهر في مسارِ الغرفة — ${why}.`);
    }
  }
  if (!roomSource.includes('await royalConsole.issue(issue)')) {
    violations.push(
      'R5: نداءُ الديوانِ `royalConsole.issue(` غائبٌ — فلا أثرَ سياديٌّ مقروءٌ نصّاً من مسارِ الغرفة.',
    );
  }
  if (countOf(roomSource, '.issue(') !== 1) {
    violations.push(
      `R5: نداءُ الأمرِ يجب أن يكون موضعاً واحداً في الغرفةِ ووُجد ${countOf(roomSource, '.issue(')}؛ ومقبضانِ للأمرِ يُختلف في أيِّهما تُقاس العقبات.`,
    );
  }
  for (const needle of ['deepFreeze', 'Object.freeze']) {
    if (!roomSource.includes(needle)) {
      violations.push(`R5: حدُّ التجميدِ ناقص (${needle} غائب).`);
    }
  }
}

// ═══ R6 ═══
if (roomSource !== '') {
  /** @type {Array<[string, string, string]>} */
  const ordered = [
    [
      'log.append(this.#policy.audit.stepExecutedEvent',
      'switch (declared.kind)',
      'قيدُ الخطوةِ يُكتب **بعد** وقوعِ أثرِها — وخطوةٌ تقع بلا قيدٍ خطوةٌ لا تُرى',
    ],
    [
      'append(this.#policy.audit.drillOpenedEvent',
      'this.#drills.set(',
      'قيدُ فتحِ التمرينِ يُكتب **بعد** إثباتِه في الذاكرة',
    ],
    [
      'append(this.#policy.audit.escalationAcknowledgedEvent',
      'escalation.acknowledgedBy = actor',
      'قيدُ الإقرارِ يُكتب **بعد** تثبيتِه — فإقرارٌ قد يقع بلا شاهد',
    ],
    [
      'append(this.#policy.audit.escalationRaisedEvent',
      'drill.escalations.set(',
      'قيدُ رفعِ التصعيدِ يُكتب **بعد** إثباتِه في الذاكرة',
    ],
  ];
  for (const [first, second, why] of ordered) {
    const a = roomSource.indexOf(first);
    const b = roomSource.indexOf(second);
    if (a < 0 || b < 0) {
      violations.push(`R6: مسارٌ غيرُ مقروءٍ نصّاً (${first} أو ${second} غائب).`);
    } else if (a > b) {
      violations.push(`R6: ${why}.`);
    }
  }
}

// ═══ R7 ═══
if (policy !== null) {
  /** @type {Set<string>} */
  const states = new Set(Object.values(AgentState));
  for (const [label, state] of [
    ['حالةُ الحجْر', policy.quarantine.state],
    ['حالةُ رفعِ الحجْر', policy.quarantine.releaseState],
  ]) {
    if (!states.has(String(state))) {
      violations.push(
        `R7: ${label} «${String(state)}» ليست قيمةً معلَنةً في \`AgentState\`؛ وحالةٌ تُخترع في الوثيقةِ تُرفَض في سجلِّ الهوياتِ عند أوّلِ حجْر.`,
      );
    }
  }
  if (policy.quarantine.state === policy.quarantine.releaseState) {
    violations.push('R7: حالةُ الحجْرِ وحالةُ رفعِه واحدةٌ — فرفعُ الحجْرِ لا يُغيّر شيئاً.');
  }
  const sessionStore = readFile('src/api/session-store.mjs');
  if (sessionStore !== '' && !sessionStore.includes("!== 'active'")) {
    violations.push(
      'R7: طبقةُ الجلساتِ لا تُقرأ نصّاً وهي ترُدُّ غيرَ النشِط؛ فأثرُ الحجْرِ على المسارِ الحقيقيِّ غيرُ مضمون.',
    );
  }
}

// ═══ R8 ═══
const pkgText = readFile('package.json');
if (pkgText === '') {
  violations.push('R8: `package.json` غير مقروء.');
} else {
  /** @type {{ scripts?: Record<string, string> }} */
  const pkg = JSON.parse(pkgText);
  const scripts = pkg.scripts ?? {};
  if (scripts['guard:crisis'] === undefined) {
    violations.push('R8: النصُّ `guard:crisis` غيرُ معلَنٍ في package.json.');
  }
  if (!String(scripts['validate'] ?? '').includes('npm run guard:crisis')) {
    violations.push('R8: `guard:crisis` غائبٌ عن سلسلةِ `validate`.');
  }
}
const workflow = readFile('.github/workflows/ci.yml');
if (!workflow.includes('npm run guard:crisis')) {
  violations.push(
    'R8: `guard:crisis` غائبٌ عن `.github/workflows/ci.yml` — وبوابةٌ لا تُشغَّل آلياً لا تمنع دمجاً.',
  );
}

// ═══ R9 ═══
const doc = readFile('docs/CRISIS_ROOM.md');
if (doc === '') {
  violations.push('R9: `docs/CRISIS_ROOM.md` غائبة — ولا عملَ بلا وثيقةٍ تصفه (المادة 1).');
} else if (policy !== null) {
  if (!doc.includes(String(policy.escalation.acknowledgmentDeadlineMs))) {
    violations.push(
      `R9: مهلةُ الإقرارِ المُعلَنةُ (${policy.escalation.acknowledgmentDeadlineMs}) غائبةٌ عن الوثيقةِ الواصفة.`,
    );
  }
  for (const procedure of policy.procedures) {
    if (!doc.includes(procedure.id)) {
      violations.push(`R9: الإجراء ${procedure.id} غائبٌ عن الوثيقةِ الواصفة.`);
    }
    for (const step of procedure.steps) {
      if (!doc.includes(step.id)) violations.push(`R9: الخطوة ${step.id} غائبةٌ عن الوثيقة.`);
    }
  }
  for (const code of policy.refusalCodes) {
    if (!doc.includes(code)) violations.push(`R9: الرمز ${code} غائبٌ عن الوثيقةِ الواصفة.`);
  }
}
const testText = readFile('tests/crisis/crisis-room.test.mjs');
if (testText === '') {
  violations.push(
    'R9: `tests/crisis/crisis-room.test.mjs` غائب — حاجزٌ يقرأ النصَّ بلا اختبارٍ يقيس السلوكَ نصفُ حاجز.',
  );
} else {
  /** @type {Array<[string, string]>} */
  const measured = [
    ['STEP_OUT_OF_ORDER', 'حفظُ ترتيبِ الخطواتِ غيرُ مقيس'],
    ['STEP_UNDECLARED', 'ردُّ الخطوةِ غيرِ المُعلَنةِ غيرُ مقيس'],
    ['PROCEDURE_UNDECLARED', 'ردُّ الإجراءِ غيرِ المُعلَنِ غيرُ مقيس'],
    ['CONSOLE_REQUIRED', 'اشتراطُ مرورِ الأمرِ بالديوانِ غيرُ مقيس'],
    ['COMMAND_REFUSED', 'نقلُ رفضِ الديوانِ كما هو غيرُ مقيس'],
    ['ESCALATION_SELF_ACK', 'منعُ الإقرارِ الذاتيِّ غيرُ مقيس'],
    ['ESCALATION_DEADLINE_MISSED', 'مهلةُ الإقرارِ غيرُ مقيسةٍ على ساعةٍ مُقادة'],
    ['ESCALATION_PENDING', 'منعُ إغلاقِ تمرينٍ بتصعيدٍ معلَّقٍ غيرُ مقيس'],
    ['EVIDENCE_MISSING', 'اشتراطُ دليلِ السجلِّ عند الإغلاقِ غيرُ مقيس'],
    ['QUARANTINE_REASON_REQUIRED', 'حدُّ سببِ الحجْرِ غيرُ مقيس'],
    ['DRILL_ACTIVE', 'منعُ تمرينَينِ متزامنَينِ غيرُ مقيس'],
    ['DRILL_EXPIRED', 'تجاوزُ مدّةِ التمرينِ غيرُ مقيس'],
    ['CLOCK_INVALID', 'ردُّ الساعةِ الفاسدةِ غيرُ مقيس'],
    ['API_IDENTITY_UNVERIFIED', 'أثرُ الحجْرِ على المسارِ الحقيقيِّ غيرُ مقيس'],
    ['closeDrill', 'معيارُ القبولِ نفسُه — إغلاقُ التمرينِ بدليلِه — غيرُ مقيس'],
    ['Object.isFrozen', 'تجميدُ شهاداتِ التنفيذِ غيرُ مقيس'],
    ['--root', 'الحاجزُ لا يُشغَّل على نسخةٍ مُزيَّفةٍ فتُقاس رتبتُه بالدعوى'],
  ];
  for (const [needle, why] of measured) {
    if (!testText.includes(needle)) violations.push(`R9: ${why} (${needle}).`);
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز غرفة الأزمات رفض:');
  for (const violation of violations) console.error(`   • ${violation}`);
  process.exit(1);
}

const procedureCount = policy === null ? 0 : policy.procedures.length;
const stepCount =
  policy === null
    ? 0
    : policy.procedures.reduce((total, procedure) => total + procedure.steps.length, 0);
const codeCount = policy === null ? 0 : policy.refusalCodes.length;
const guaranteeCount = policy === null ? 0 : policy.guarantees.length;
const deadline = policy === null ? 0 : policy.escalation.acknowledgmentDeadlineMs;
console.log(
  `✅ حاجز غرفة الأزمات: ${procedureCount} إجراءات بـ${stepCount} خطوةً معلَنةً بترتيبٍ محفوظٍ، وكلُّ أمرٍ فيها معلَنٌ في وثيقةِ الديوانِ ويمرّ به وحدَه، و${codeCount} رمزَ رفضٍ متقابلةً في الاتجاهين، و${guaranteeCount} ضماناتٍ كلٌّ برمزٍ حاضرٍ في ملفِّ إنفاذِه، وحالةُ الحجْرِ قيمةٌ معلَنةٌ في سجلِّ الهوياتِ تُرَدُّ عند طبقةِ الواجهة، ومهلةُ الإقرارِ ${deadline} ملي ثانيةٍ من الوثيقةِ مقيسةً على ساعةٍ مُمرَّرةٍ، والقيدُ يُكتب قبل الأثر.`,
);
