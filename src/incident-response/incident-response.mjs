// مسارُ الاستجابةِ للحوادث — الخطوة `M10.03`.
//
// ما كان قبل هذه الخطوة: لوحةُ `M10.02` تُقرأ ولا تُرسِل — الانكسارُ يُقاس
// بعتبةٍ معلَنةٍ ولا يبلغ أحداً. وغيابُ القياسِ يبقى «غيرَ مقيسٍ» بلا صوتٍ
// إلى الأبد. وغرفةُ أزماتِ `M9.06` ومركزُ عملياتِ `M9.05` قائمانِ ولا يُشعِلهما
// إلا يدُ إنسانٍ قرّرت أن تُشعِلهما. وجهاتُ التصعيدِ أدوارٌ بلا مناوبةٍ فلا
// يُعرف «من على المناوبةِ الآن». والحادثةُ تُغلَق بلا مراجعةٍ لاحقةٍ فتعود.
//
// وما صار: **قاعدةٌ ⇒ تنبيهٌ ⇒ حادثةٌ مُقيَّدةٌ ⇒ مستجيبٌ مُحَلٌّ من شِفتٍ ⇒
// تصعيدٌ بترتيبٍ ⇒ تقريرُ مراجعةٍ خطُّ زمنِه مقروءٌ من القرص.** والمنسِّقُ
// **لا يقيس ولا يُخزِّن مستقلًّا**:
//
//   • الحكمُ من `serviceLevels.dashboard()` — **الحقنُ لا الاستيراد**، فلا
//     تصير طبقةُ الاستجابةِ تبعيةَ ترجمةٍ لطبقةِ الأهدافِ، ولا يُحسَب هنا
//     هدفٌ ولا عتبةٌ من جديد. ومصدرُ الحقيقةِ واحدٌ يتغيّر في وثيقتِه.
//
//   • الحادثةُ تُقيَّد في **مركزِ العملياتِ نفسِه** بدرجاتِه المُعلَنةِ، لا
//     في سجلِّ حوادثَ ثانٍ. ومن بنى سجلًّا ثانياً بنى عدّتَين للحوادثِ
//     تختلفان، وأيُّهما يُقرأ في التقرير؟
//
//   • جهاتُ التصعيدِ جهاتُ `config/crisis-room.yaml` **بمعرّفاتِها**، لا
//     قائمةٌ ثانيةٌ تُصان في موضعين فتتباعدان.
//
//   • الزمنُ كلُّه من ساعةٍ **مُمرَّرة**: حلُّ الشِفتِ، ومهلةُ الإقرارِ،
//     ومهلةُ التصعيدِ، ومهلةُ التقرير. **ولا مؤقِّتَ يعمل بنفسِه هنا** — لا
//     `setInterval` ولا `setTimeout`. والتقييمُ يقع عند النداءِ، فمن أراد
//     دوريّةً جدولها فوقَ هذه الوحدةِ. وهذا حدٌّ معلَنٌ لا نقصٌ مُضمَر:
//     مؤقِّتٌ داخليٌّ يجعل الوحدةَ غيرَ قابلةٍ للاختبارِ في زمنٍ مضغوطٍ،
//     ويُخفي أنّ التقييمَ لم يقع إن مات المؤقِّت.
//
// **حدٌّ معلَنٌ ثانٍ — لا قناةَ نقل:** `channel` في القاعدةِ **معرّفٌ يُقيَّد
// في السجلِّ**، لا اتصالٌ بشبكةٍ ولا بريدٌ ولا رسالة. والنقلُ الخارجيُّ دَينٌ
// معلَنٌ موروثٌ من `M9.06` ومسجَّلٌ في `REMAINING_WORK.md`؛ ولا يُدَّعى إغلاقُه
// هنا. فما يُقاس في هذه الخطوةِ: أنّ التنبيهَ **رُفع وقُيِّد ووُجِّه إلى جهةٍ
// معلَنةٍ ووُجد له مستجيبٌ على مناوبةٍ وأُقِرَّ وصُعِّد وحُلَّ ورُوجِع** — وهو
// المسارُ المكتوبُ الذي يطلبه معيارُ القبول، لا وصولُ حزمةٍ إلى هاتف.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';
// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للبناء» في الفحصِ الصارم — وهو نفسُ ما فُعل في طبقةِ مستوياتِ الخدمة.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { evaluateRules } from './alerts.mjs';
import { IR_CONDITIONS, IR_ERRORS, IncidentResponseError } from './errors.mjs';
import { buildNotification } from './notifier.mjs';
/** @typedef {import('./notifier.mjs').Notifier} Notifier */
import { assertOnCall, assertRotationCovers, responderAt } from './rotation.mjs';
import { assertEvidence, assertSections, buildTimeline } from './review.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لمسارِ الاستجابة. */
export const DEFAULT_INCIDENT_RESPONSE_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/**
 * أقسامُ التقريرِ المكتوبةُ في الكود — تُقابَل بـ`review.requiredSections` في
 * الوثيقةِ **في الاتجاهين**، فقسمٌ يُعلَن بلا موضعِ فحصٍ وعدٌ لا يُنفَّذ،
 * وقسمٌ يُفحَص بلا إعلانٍ شرطٌ لا يعرفه من يكتب التقرير.
 */
export const IR_SECTIONS = Object.freeze([
  'section:timeline',
  'section:impact',
  'section:root-cause',
  'section:corrective-actions',
]);

/**
 * حقولُ الوثيقةِ التي لا يقوم المسارُ بدونِها — تُفحَص عند **تمريرِ**
 * وثيقةٍ لا تُقرأ من القرص؛ فالمقروءةُ تمرُّ على مخطَّطِها وفحوصِ تماسُكِها.
 */
const REQUIRED_POLICY_FIELDS = Object.freeze([
  'version',
  'rules',
  'severities',
  'rotation',
  'escalation',
  'review',
  'audit',
  'refusalCodes',
  'guarantees',
  'delivery',
]);

/**
 * تثبيتٌ عميقٌ لما يُعاد من المِقابض: قراءةٌ لا مِقبضُ كتابةٍ في يدِ المُنادي.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(/** @type {Record<string, unknown>} */ (value)[key]);
  }
  return value;
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} reason @returns {never} */
function invalidConfig(reason) {
  throw new IncidentResponseError(IR_ERRORS.CONFIG_INVALID, reason, {});
}

/**
 * @typedef {import('./rotation.mjs').RotationPolicy} RotationPolicy
 * @typedef {import('./alerts.mjs').AlertRule} AlertRule
 * @typedef {import('./alerts.mjs').DashboardLike} DashboardLike
 * @typedef {import('./review.mjs').ReviewPolicy} ReviewPolicy
 * @typedef {import('./review.mjs').LogEntryLike} LogEntryLike
 */

/**
 * @typedef {object} SeveritySpec
 * @property {string} id
 * @property {string} incidentSeverity
 * @property {number} acknowledgeWithinMs
 * @property {number} escalateAfterMs
 * @property {boolean} requiresReview
 * @property {string} statement
 */

/**
 * @typedef {object} DeliveryEndpoint
 * @property {string} id
 * @property {string} url
 * @property {string} method
 */

/**
 * @typedef {object} DeliveryPolicy
 * @property {readonly DeliveryEndpoint[]} endpoints
 * @property {string} statement
 */

/**
 * @typedef {object} IncidentResponsePolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ alertRaisedEvent: string, alertSuppressedEvent: string, alertAcknowledgedEvent: string, alertEscalatedEvent: string, alertResolvedEvent: string, reviewPublishedEvent: string, refusedEvent: string, notificationDeliveredEvent: string, statement: string }} audit
 * @property {string[]} refusalCodes
 * @property {SeveritySpec[]} severities
 * @property {AlertRule[]} rules
 * @property {RotationPolicy} rotation
 * @property {{ selfAcknowledgeForbidden: true, statement: string, ladder: Array<{ tier: number, contact: string, purpose: string }> }} escalation
 * @property {ReviewPolicy} review
 * @property {Array<{ id: string, statement: string, enforcedBy: string, codes: string[] }>} guarantees
 * @property {DeliveryPolicy} delivery
 */

/**
 * يقرأ وثيقةَ مسارِ الاستجابةِ ويتحقّق منها بمخطَّطِها ثم بفحوصِ تماسكٍ لا
 * يُعبِّر عنها مخطَّط. **ووثيقةٌ غائبةٌ أو مخالفةٌ توقف التحميلَ** ولا يُبتدأ
 * مسارٌ بقواعدَ افتراضية — فقاعدةٌ افتراضيةٌ تُنبِّه أو تسكت بما لم يقرّره أحد.
 *
 * @param {{ dir?: string }} [options]
 * @returns {IncidentResponsePolicy}
 */
export function loadIncidentResponsePolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_INCIDENT_RESPONSE_CONFIG_DIR;
  const file = path.join(dir, 'incident-response.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      `وثيقةُ مسارِ الاستجابةِ غائبةٌ عن ${file}؛ وبلا وثيقةٍ لا يُعرف أيُّ انكسارٍ يُنبَّه عليه ولا من يُبلَّغ ولا في أيِّ مهلة.`,
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة incident-response.yaml: ${errorText(error)}`);
  }

  const schemaPath = path.join(dir, 'schemas', 'incident-response.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ مسارِ الاستجابةِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ القاعدةِ نصّاً حرّاً كالعُرفِ الذي جاءت لتمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((/** @type {{ instancePath: string, message?: string }} */ entry) =>
        `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim(),
      )
      .join(' · ');
    invalidConfig(`incident-response.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {IncidentResponsePolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  // ١. رموزُ الرفضِ في الاتجاهين: الوثيقةُ والكود.
  const declaredCodes = new Set(parsed.refusalCodes);
  const codedCodes = new Set(/** @type {readonly string[]} */ (Object.values(IR_ERRORS)));
  for (const code of codedCodes) {
    if (!declaredCodes.has(code)) {
      invalidConfig(
        `الرمز «${code}» يُرفع في الكودِ ولا يُعلَنُ في الوثيقة؛ ورفضٌ لا يجده قارئُ الوثيقةِ رفضٌ لا يُتوقَّع.`,
      );
    }
  }
  for (const code of declaredCodes) {
    if (!codedCodes.has(code)) {
      invalidConfig(
        `الرمز «${code}» مُعلَنٌ في الوثيقةِ ولا موضعَ له في الكود؛ ووعدُ رفضٍ لا يُنفَّذ أسوأُ من غيابِه.`,
      );
    }
  }

  // ٢. الدرجاتُ: معرّفاتٌ لا تتكرّر، ومهلةُ التصعيدِ بعد مهلةِ الإقرارِ لا قبلها.
  /** @type {Map<string, SeveritySpec>} */
  const severities = new Map();
  for (const severity of parsed.severities) {
    if (severities.has(severity.id)) {
      invalidConfig(
        `الدرجة «${severity.id}» مُعلَنةٌ مرّتين؛ ودرجةٌ بتعريفين ثقلٌ لا يُعرف أيُّه يُقرأ.`,
      );
    }
    if (severity.escalateAfterMs <= severity.acknowledgeWithinMs) {
      invalidConfig(
        `الدرجة «${severity.id}»: مهلةُ التصعيدِ (${severity.escalateAfterMs}) ليست بعد مهلةِ الإقرارِ (${severity.acknowledgeWithinMs})؛ وتصعيدٌ يُستحقُّ قبل انقضاءِ مهلةِ من عليه الإقرارُ تصعيدٌ يُحرق سلَّمَه في كلِّ حادثة.`,
      );
    }
    severities.set(severity.id, severity);
  }

  // ٣. القواعدُ: معرّفاتٌ لا تتكرّر، ودرجةٌ معلَنةٌ، وشرطٌ من الشروطِ المكتوبة.
  const ruleIds = new Set();
  for (const rule of parsed.rules) {
    if (ruleIds.has(rule.id)) {
      invalidConfig(`القاعدة «${rule.id}» مُعلَنةٌ مرّتين؛ ومعرّفٌ يُعاد يُخفي قاعدةً بأخرى.`);
    }
    ruleIds.add(rule.id);
    if (!severities.has(rule.severity)) {
      invalidConfig(
        `القاعدة «${rule.id}» تُشير إلى الدرجة «${rule.severity}» وليست معلَنةً في الوثيقة؛ ودرجةٌ لا مهلةَ لها تنبيهٌ لا يُعرف متى يُصعَّد.`,
      );
    }
    if (!IR_CONDITIONS.includes(rule.condition)) {
      invalidConfig(
        `القاعدة «${rule.id}» على شرطٍ «${rule.condition}» لا موضعَ له في الكود؛ والشروطُ المكتوبةُ ${IR_CONDITIONS.join('، ')}.`,
      );
    }
  }

  // ٤. المناوبةُ تُغطّي الدورةَ بلا فجوةٍ ولا تداخُل — يسقط الملفُّ عند القراءةِ
  //    لا عند أولِ حادثةٍ في الثالثةِ صباحاً.
  assertRotationCovers(parsed.rotation);

  // ٥. سلَّمُ التصعيدِ مرتَّبٌ من ١ بلا قفزٍ ولا تكرارِ جهةٍ في مرتبتين.
  const seenContacts = new Set();
  parsed.escalation.ladder.forEach((step, index) => {
    if (step.tier !== index + 1) {
      invalidConfig(
        `سلَّمُ التصعيدِ: المرتبةُ عند الموضع ${index + 1} معلَنةٌ «${step.tier}»؛ والمراتبُ متصلةٌ من ١ كي لا تُقفَز مرتبةٌ لا وجودَ لها.`,
      );
    }
    if (seenContacts.has(step.contact)) {
      invalidConfig(
        `الجهة «${step.contact}» في مرتبتين من السلَّم؛ وتصعيدٌ إلى من بلغه الخبرُ سابقاً ليس تصعيداً.`,
      );
    }
    seenContacts.add(step.contact);
  });

  // ٦. أقسامُ التقريرِ في الاتجاهين: الوثيقةُ والكود.
  const declaredSections = new Set(parsed.review.requiredSections.map((section) => section.id));
  for (const section of IR_SECTIONS) {
    if (!declaredSections.has(section)) {
      invalidConfig(
        `القسم «${section}» يُفحَص في الكودِ ولا يُعلَنُ في الوثيقة؛ وشرطٌ لا يعرفه من يكتب التقريرَ شرطٌ يُسقِط تقريراً بُذل فيه جهدٌ.`,
      );
    }
  }
  for (const section of declaredSections) {
    if (!IR_SECTIONS.includes(section)) {
      invalidConfig(
        `القسم «${section}» مُعلَنٌ في الوثيقةِ ولا موضعَ فحصٍ له في الكود؛ وقسمٌ لازمٌ لا يُفحَص قسمٌ اختياريٌّ بلافتةِ لزوم.`,
      );
    }
  }
  const timelineSection = parsed.review.requiredSections.find(
    (section) => section.id === 'section:timeline',
  );
  if (timelineSection?.source !== 'on-disk-log') {
    invalidConfig(
      'قسمُ خطِّ الزمنِ مُعلَنٌ بمصدرٍ غيرِ سجلِّ القرص؛ وخطُّ زمنٍ يكتبه المُراجِعُ من ذاكرتِه هو بعينُه ما جاءت المراجعةُ الموثَّقةُ لتمنعه.',
    );
  }

  // ٧. هدفُ كلِّ قاعدةٍ مُعلَنٌ في **وثيقةِ مستوياتِ الخدمة**.
  //
  // وتُقرأ تلك الوثيقةُ **وثيقةً** لا وحدةً: `readFileSync` و`YAML.parse` لا
  // `import`. وذاك مقصودٌ من وجهين. الأول أنّ مسارَ الاستجابةِ **لا يستورد**
  // من `../service-levels/` (والحاجزُ يمنعه نصّاً) كي لا تنقلب طبقةُ الإنذارِ
  // تابعةً لطبقةِ القياسِ فيسقطا معاً. والثاني أنّ المعنيَّ هنا **العهدُ
  // المُعلَن** لا مثيلُ اللوحةِ في زمنِ التشغيل.
  //
  // وهذا الفحصُ يقع **عند التحميل** لا عند أولِ تقييم: قاعدةٌ على هدفٍ لا
  // وجودَ له في العهودِ تسكت سكوتاً تامّاً في التقييمِ إن لم تُرَدَّ هنا،
  // فيُقرأ صمتُها التزاماً — وهو عينُ ما جاءت الخطوةُ لتمنعه.
  const objectivesFile = path.join(dir, 'service-levels.yaml');
  if (!fs.existsSync(objectivesFile)) {
    invalidConfig(
      `وثيقةُ مستوياتِ الخدمةِ غائبةٌ عن ${objectivesFile}؛ وقاعدةُ تنبيهٍ بلا عهدٍ مقروءٍ تنبيهٌ لا مصدرَ لحكمِه.`,
    );
  }
  /** @type {Set<string>} */
  const declaredObjectives = new Set();
  try {
    const objectivesDocument =
      /** @type {{ capabilities?: Array<{ objectives?: Array<{ id?: string }> }> }} */ (
        YAML.parse(fs.readFileSync(objectivesFile, 'utf8'))
      );
    for (const capability of objectivesDocument?.capabilities ?? []) {
      for (const objective of capability?.objectives ?? []) {
        if (typeof objective?.id === 'string') declaredObjectives.add(objective.id);
      }
    }
  } catch (error) {
    invalidConfig(
      `تعذّرت قراءة service-levels.yaml للتحقّقِ من أهدافِ القواعد: ${errorText(error)}`,
    );
  }
  for (const rule of parsed.rules) {
    if (!declaredObjectives.has(rule.objective)) {
      invalidConfig(
        `القاعدة «${rule.id}» تُنبِّه على الهدف «${rule.objective}» وهو غيرُ معلَنٍ في service-levels.yaml؛ والمُعلَنُ ${[...declaredObjectives].join('، ')} — ${IR_ERRORS.OBJECTIVE_UNDECLARED}: لا تنبيهَ عن عهدٍ لم يُقطَع، وقاعدةٌ كهذه تسكت في كلِّ تقييمٍ فيُقرأ صمتُها التزاماً.`,
      );
    }
  }

  // ٨. التسليمُ: كلُّ قناةِ تنبيهٍ لها نقطةُ تسليمٍ مُعلَنة، ونقاطُ التسليمِ
  //    معرّفاتُها فريدة. فقناةٌ بلا نقطةِ تسليمٍ عنوانٌ يُكتب ولا يُرسَل إليه،
  //    ونقطتانِ لقناةٍ واحدةٍ موعدانِ يُرسلُ إلى أحدهما ويُنسى الآخر.
  /** @type {Set<string>} */
  const deliveryChannels = new Set();
  for (const endpoint of parsed.delivery.endpoints) {
    if (deliveryChannels.has(endpoint.id)) {
      invalidConfig(
        `نقطةُ التسليمِ «${endpoint.id}» مُعلَنةٌ مرّتين؛ ونقطتانِ لقناةٍ واحدةٍ موعدانِ يُرسلُ إلى أحدهما ويُنسى الآخر.`,
      );
    }
    deliveryChannels.add(endpoint.id);
  }
  for (const rule of parsed.rules) {
    if (!deliveryChannels.has(rule.channel)) {
      invalidConfig(
        `القاعدة «${rule.id}» تُنبِّه على القناةِ «${rule.channel}» وليس لها نقطةُ تسليمٍ في قسمِ delivery.endpoints؛ وقناةٌ بلا نقطةِ تسليمٍ عنوانٌ يُكتب ولا يُرسَل إليه.`,
      );
    }
  }

  return parsed;
}

/**
 * @typedef {object} ServiceLevelsLike
 * @property {() => DashboardLike} dashboard
 */

/**
 * @typedef {object} OperationsLike
 * @property {(incident: { id: string, severity: string, title: string, source: string, detail?: Record<string, unknown> }, context?: { actor?: string }) => { id: string, severity: string, recordedAtMs: number }} record
 * @property {() => { severities: readonly string[] }} describe
 */

/**
 * @typedef {object} LogLike
 * @property {(type: string, actor: string, data: object) => unknown} append
 */

/**
 * @typedef {object} AlertState
 * @property {string} rule
 * @property {string} severity
 * @property {string} objective
 * @property {string} channel
 * @property {string} incident
 * @property {number} raisedAtMs
 * @property {string | null} acknowledgedBy
 * @property {number | null} acknowledgedAtMs
 * @property {boolean} acknowledgeDeadlineMissed
 * @property {number} escalatedTier
 * @property {number | null} escalatedAtMs
 * @property {string | null} reviewedBy
 * @property {number | null} reviewedAtMs
 * @property {number | null} deliveredAtMs
 * @property {number} deliveryStatus
 * @property {'open' | 'resolved'} state
 */

/**
 * منسِّقُ الاستجابة: خمسةُ مقابضَ لا سادسَ — `evaluate` و`acknowledge`
 * و`escalate` و`publishReview` و`resolve`، ومِقبضا قياسٍ (`onCall`
 * و`assertAcknowledgedInTime`) ووصفٌ يُقرأ.
 */
export class IncidentResponse {
  /** @type {IncidentResponsePolicy} */
  #policy;
  /** @type {Map<string, SeveritySpec>} */
  #severities = new Map();
  /** @type {Map<string, AlertRule>} */
  #rules = new Map();
  /** @type {ServiceLevelsLike | null} */
  #serviceLevels;
  /** @type {OperationsLike | null} */
  #operations;
  /** @type {LogLike | null} */
  #log;
  /** @type {(() => readonly LogEntryLike[]) | null} */
  #evidence;
  /** @type {() => number} */
  #nowMs;
  /** @type {Map<string, AlertState>} */
  #alerts = new Map();
  /** @type {Notifier | null} */
  #notifier;

  /**
   * @param {{ policy?: IncidentResponsePolicy, dir?: string, serviceLevels?: ServiceLevelsLike | null, operations?: OperationsLike | null, log?: LogLike | null, evidence?: (() => readonly LogEntryLike[]) | null, notifier?: Notifier | null, nowMs?: () => number }} [deps]
   */
  constructor(deps = {}) {
    if (deps.policy !== undefined && deps.policy !== null) {
      // وثيقةٌ **تُمرَّر** لا تُقرأ من القرص؛ ومن مرَّر كائناً ناقصاً حسبه
      // وثيقةً فتنفجر في أولِ حادثةٍ بخطأٍ لا يدُلُّ على سببِه. **ولحظةُ الحادثةِ
      // أسوأُ لحظةٍ لكشفِ عطبِ إعلان.**
      const shape = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (deps.policy));
      for (const field of REQUIRED_POLICY_FIELDS) {
        if (shape[field] === undefined || shape[field] === null) {
          throw new IncidentResponseError(
            IR_ERRORS.POLICY_REQUIRED,
            `وثيقةُ مسارِ الاستجابةِ المُمرَّرةُ تنقصها «${field}»؛ ووثيقةٌ ناقصةٌ تُقبَل هنا تنفجر عند أولِ حادثةٍ بخطأٍ لا يدُلُّ على سببِه — فتُرَدُّ هنا بالاسم. ومن أراد وثيقةً من القرصِ فليمرَّر مجلَّدَها لا كائناً يصنعه.`,
            { field },
          );
        }
      }
    }
    this.#policy =
      deps.policy ?? loadIncidentResponsePolicy(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#serviceLevels = deps.serviceLevels ?? null;
    this.#operations = deps.operations ?? null;
    this.#log = deps.log ?? null;
    this.#evidence = deps.evidence ?? null;
    this.#notifier = deps.notifier ?? null;
    this.#nowMs = deps.nowMs ?? (() => Date.now());
    for (const severity of this.#policy.severities) this.#severities.set(severity.id, severity);
    for (const rule of this.#policy.rules) this.#rules.set(rule.id, rule);

    // درجاتُ هذه الوثيقةِ تُقابَل بدرجاتِ **مركزِ العملياتِ** عند التركيبِ لا
    // عند أولِ حادثة: فدرجةٌ لا يعرف المركزُ ثقلَها ستُسقِط تقييدَ الحادثةِ في
    // أسوأِ لحظةٍ ممكنة، وتأخيرُ كشفِ عطبِ الإعلانِ إلى لحظةِ الحاجةِ عطبٌ ثانٍ.
    if (this.#operations !== null) {
      const known = new Set(this.#operations.describe().severities);
      for (const severity of this.#policy.severities) {
        if (!known.has(severity.incidentSeverity)) {
          throw new IncidentResponseError(
            IR_ERRORS.SEVERITY_UNDECLARED,
            `الدرجة «${severity.id}» تُقيِّد الحادثةَ بدرجةِ مركزِ العمليات «${severity.incidentSeverity}» وهي غيرُ معلَنةٍ فيه؛ والمُعلَنُ ${[...known].join('، ')} — ودرجتانِ لا تتقابلانِ تعني حادثةً تُرفَض عند تقييدِها.`,
            { severity: severity.id, incidentSeverity: severity.incidentSeverity },
          );
        }
      }
    }
  }

  /** @returns {IncidentResponsePolicy} */
  get policy() {
    return this.#policy;
  }

  /**
   * وصفُ ما يملكه المسارُ — بياناتٌ تُقرأ لا مِقبضٌ يُنفَّذ به شيء.
   * @returns {{ rules: readonly string[], severities: readonly string[], shifts: readonly string[], ladder: readonly string[], openAlerts: number, cycleMs: number }}
   */
  describe() {
    return deepFreeze({
      rules: [...this.#rules.keys()],
      severities: [...this.#severities.keys()],
      shifts: this.#policy.rotation.shifts.map((shift) => shift.id),
      ladder: this.#policy.escalation.ladder.map((step) => step.contact),
      openAlerts: [...this.#alerts.values()].filter((alert) => alert.state === 'open').length,
      cycleMs: this.#policy.rotation.cycleMs,
    });
  }

  /**
   * السجلُّ الدائمُ أو رفضٌ مُسمّى — العقبةُ الأولى على كلِّ مِقبض.
   * @returns {LogLike}
   */
  #requireLog() {
    const log = this.#log;
    if (log === null) {
      throw new IncidentResponseError(
        IR_ERRORS.AUDIT_REQUIRED,
        'السجلُّ الدائمُ غيرُ موصولٍ بمسارِ الاستجابة؛ وتنبيهٌ لا قيدَ له تنبيهٌ يُنكَر وقوعُه بعد أسبوع.',
        {},
      );
    }
    return log;
  }

  /** @returns {ServiceLevelsLike} */
  #requireServiceLevels() {
    const serviceLevels = this.#serviceLevels;
    if (serviceLevels === null) {
      throw new IncidentResponseError(
        IR_ERRORS.SERVICE_LEVELS_REQUIRED,
        'لوحةُ مستوياتِ الخدمةِ غيرُ موصولةٍ بمسارِ الاستجابة؛ وتنبيهٌ يُرفَع بلا حكمٍ مقيسٍ رأيٌ لا رصد.',
        {},
      );
    }
    return serviceLevels;
  }

  /** @returns {OperationsLike} */
  #requireOperations() {
    const operations = this.#operations;
    if (operations === null) {
      throw new IncidentResponseError(
        IR_ERRORS.OPERATIONS_REQUIRED,
        'مركزُ العملياتِ غيرُ موصولٍ بمسارِ الاستجابة؛ ولا يُنشأ سجلُّ حوادثَ ثانٍ بديلاً عنه، فحادثةٌ لا تُرى في المركزِ حادثةٌ خارجَ موضعِ الرؤية.',
        {},
      );
    }
    return operations;
  }

  /**
   * الساعةُ المُمرَّرةُ أو رفضٌ مُسمّى: ساعةٌ تُعيد غيرَ عددٍ منتهٍ تجعل كلَّ
   * مهلةٍ بعدها قابلةً للتزوير بصمت.
   * @param {string} where
   * @returns {number}
   */
  #clock(where) {
    const value = this.#nowMs();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new IncidentResponseError(
        IR_ERRORS.CLOCK_INVALID,
        `ساعةُ ${where} أعادت قيمةً غيرَ صالحةٍ (${String(value)})؛ ومهلةٌ تُقاس على ساعةٍ معتلّةٍ مهلةٌ تُقرأ ولا تُلزِم.`,
        { where, value: String(value) },
      );
    }
    return value;
  }

  /**
   * قيدُ رفضٍ ثم رفعُه — فالرفضُ حدثٌ يُقرأ في السجلِّ لا استثناءٌ يُبتلَع.
   * @param {string} actor
   * @param {IncidentResponseError} error
   * @param {Record<string, unknown>} data
   * @returns {never}
   */
  #refuse(actor, error, data) {
    const log = this.#log;
    if (log !== null) {
      log.append(this.#policy.audit.refusedEvent, actor, {
        ...data,
        code: error.code,
        reason: error.message,
      });
    }
    throw error;
  }

  /**
   * @param {string} id
   * @param {string} actor
   * @returns {AlertState}
   */
  #openAlert(id, actor) {
    const alert = this.#alerts.get(id);
    if (alert === undefined) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.ALERT_UNKNOWN,
          `لا تنبيهَ بالمعرّف «${id}»؛ ومعرّفٌ يخترعه المُنادي إقرارٌ على حادثةٍ لم تقع.`,
          { alert: id },
        ),
        { alert: id },
      );
    }
    if (alert.state !== 'open') {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.ALERT_NOT_OPEN,
          `التنبيه «${id}» ليس مفتوحاً (حالتُه «${alert.state}»)؛ وأثرٌ على تنبيهٍ مُغلَقٍ يُعيد كتابةَ تاريخِ حادثةٍ انتهت.`,
          { alert: id, state: alert.state },
        ),
        { alert: id, state: alert.state },
      );
    }
    return alert;
  }

  /**
   * @param {string} id
   * @returns {SeveritySpec}
   */
  #severityOf(id) {
    const severity = this.#severities.get(id);
    if (severity === undefined) {
      throw new IncidentResponseError(
        IR_ERRORS.SEVERITY_UNDECLARED,
        `الدرجة «${id}» غيرُ معلَنةٍ في وثيقةِ مسارِ الاستجابة.`,
        { severity: id },
      );
    }
    return severity;
  }

  /**
   * «من على المناوبةِ في هذه اللحظة؟» — قراءةٌ بلا أثرٍ ولا قيد.
   * @param {{ atMs?: number }} [options]
   * @returns {{ shift: string, responder: string, offsetMs: number, startMs: number, endMs: number }}
   */
  onCall(options = {}) {
    const atMs = options.atMs ?? this.#clock('حلِّ المناوبة');
    return deepFreeze(responderAt(this.#policy.rotation, atMs));
  }

  /**
   * تقييمُ القواعدِ على اللوحةِ ورفعُ ما استحقّ.
   *
   * **والتنبيهُ المفتوحُ لا يُرفَع مرّتين**: يُقيَّد كتماً بسببِه المُعلَنِ ولا
   * يُقيَّد حادثةً ثانيةً في المركز. ومن رفع تنبيهاً في كلِّ تقييمٍ صنع فيضاً
   * يُخفي الحادثةَ الثانيةَ الحقيقيةَ تحت مئةِ نسخةٍ من الأولى، **وأسقط سعةَ
   * سجلِّ حوادثِ المركزِ المُعلَنةَ** فصار الفيضُ عمًى في موضعِ الرؤية.
   *
   * @param {{ actor?: string }} [context]
   * @returns {{ evaluatedAtMs: number, raised: ReadonlyArray<{ alert: string, severity: string, incident: string, channel: string, responder: string }>, suppressed: ReadonlyArray<{ alert: string, reason: string }>, quiet: ReadonlyArray<{ alert: string, reason: string }> }}
   */
  evaluate(context = {}) {
    const actor = context.actor ?? 'incident:response';
    const log = this.#requireLog();
    const serviceLevels = this.#requireServiceLevels();
    const operations = this.#requireOperations();
    const evaluatedAtMs = this.#clock('تقييمِ القواعد');

    const dashboard = serviceLevels.dashboard();
    const candidates = evaluateRules({ rules: this.#policy.rules, dashboard });

    /** @type {Array<{ alert: string, severity: string, incident: string, channel: string, responder: string }>} */
    const raised = [];
    /** @type {Array<{ alert: string, reason: string }>} */
    const suppressed = [];
    /** @type {Array<{ alert: string, reason: string }>} */
    const quiet = [];

    for (const candidate of candidates) {
      if (!candidate.firing) {
        quiet.push({ alert: candidate.rule, reason: candidate.reason });
        continue;
      }
      const existing = this.#alerts.get(candidate.rule);
      if (existing !== undefined && existing.state === 'open') {
        const reason = `التنبيه «${candidate.rule}» مفتوحٌ منذ ${existing.raisedAtMs} ولم يُحَلّ؛ ونسخةٌ ثانيةٌ منه تُخفي الحادثةَ الثانيةَ الحقيقيةَ وتستهلك سعةَ سجلِّ حوادثِ المركز.`;
        log.append(this.#policy.audit.alertSuppressedEvent, actor, {
          alert: candidate.rule,
          incident: existing.incident,
          reason,
        });
        suppressed.push({ alert: candidate.rule, reason });
        continue;
      }

      const severity = this.#severityOf(candidate.severity);
      const onCall = responderAt(this.#policy.rotation, evaluatedAtMs);
      const incidentId = `incident:${candidate.rule}@${evaluatedAtMs}`;

      // القيدُ قبل الأثر: تُكتب شهادةُ الرفعِ في السجلِّ الدائمِ، ثم تُقيَّد
      // الحادثةُ في المركز، ثم تدخل الذاكرةَ. فترتيبُ الفشلِ معلومٌ: قيدٌ بلا
      // حادثةٍ يُقرأ ويُصلَح، ولا حادثةٌ بلا قيدٍ تُنكَر.
      log.append(this.#policy.audit.alertRaisedEvent, actor, {
        alert: candidate.rule,
        incident: incidentId,
        objective: candidate.objective,
        capability: candidate.capability,
        condition: candidate.condition,
        severity: severity.id,
        channel: candidate.channel,
        responder: onCall.responder,
        shift: onCall.shift,
        raisedAtMs: evaluatedAtMs,
        acknowledgeWithinMs: severity.acknowledgeWithinMs,
        escalateAfterMs: severity.escalateAfterMs,
        requiresReview: severity.requiresReview,
        reason: candidate.reason,
        reading: candidate.reading,
      });

      operations.record(
        {
          id: incidentId,
          severity: severity.incidentSeverity,
          title: candidate.reason,
          source: candidate.rule,
          detail: {
            objective: candidate.objective,
            condition: candidate.condition,
            channel: candidate.channel,
            responder: onCall.responder,
            ...candidate.reading,
          },
        },
        { actor },
      );

      this.#alerts.set(candidate.rule, {
        rule: candidate.rule,
        severity: severity.id,
        objective: candidate.objective,
        channel: candidate.channel,
        incident: incidentId,
        raisedAtMs: evaluatedAtMs,
        acknowledgedBy: null,
        acknowledgedAtMs: null,
        acknowledgeDeadlineMissed: false,
        escalatedTier: 0,
        escalatedAtMs: null,
        reviewedBy: null,
        reviewedAtMs: null,
        deliveredAtMs: null,
        deliveryStatus: 0,
        state: 'open',
      });

      raised.push({
        alert: candidate.rule,
        severity: severity.id,
        incident: incidentId,
        channel: candidate.channel,
        responder: onCall.responder,
      });
    }

    return deepFreeze({ evaluatedAtMs, raised, suppressed, quiet });
  }

  /**
   * إقرارُ تنبيهٍ من المستجيبِ الذي على المناوبةِ في لحظتِه.
   *
   * **والإقرارُ المتأخّرُ يُقبَل ويُقيَّد تفويتُه ولا يُرفَض.** وهذا قرارٌ
   * معلَنٌ: رفضُ الإقرارِ المتأخّرِ يترك الحادثةَ بلا صاحبٍ إلى الأبدِ عقاباً
   * على تأخُّرٍ وقع فعلاً، فيُعاقَب النظامُ لا المُتأخِّر. والمقصودُ أن يُقرأ
   * التفويتُ في السجلِّ وفي مِقبضِ القياسِ (`assertAcknowledgedInTime`)، لا أن
   * يُمنَع تمليكُ الحادثة.
   *
   * @param {{ alert: string, responder: string, actor?: string, note?: string }} request
   * @returns {{ alert: string, responder: string, shift: string, acknowledgedAtMs: number, elapsedMs: number, deadlineMs: number, deadlineMissed: boolean }}
   */
  acknowledge(request) {
    const actor = request?.actor ?? 'incident:response';
    const log = this.#requireLog();
    const acknowledgedAtMs = this.#clock('إقرارِ تنبيه');
    const alert = this.#openAlert(String(request?.alert ?? ''), actor);

    if (alert.acknowledgedBy !== null) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.ALERT_ALREADY_ACKNOWLEDGED,
          `التنبيه «${alert.rule}» أُقِرَّ سابقاً من «${alert.acknowledgedBy}»؛ وإقرارٌ ثانٍ يُخفي أوّلَ من ملك الحادثةَ ويُفسِد قياسَ زمنِ إقرارِها.`,
          { alert: alert.rule, acknowledgedBy: alert.acknowledgedBy },
        ),
        { alert: alert.rule },
      );
    }

    const responder = String(request?.responder ?? '');
    /** @type {{ shift: string, responder: string, offsetMs: number, startMs: number, endMs: number }} */
    let onCall;
    try {
      onCall = assertOnCall(this.#policy.rotation, responder, acknowledgedAtMs);
    } catch (error) {
      this.#refuse(actor, /** @type {IncidentResponseError} */ (error), {
        alert: alert.rule,
        responder,
      });
    }

    const severity = this.#severityOf(alert.severity);
    const elapsedMs = acknowledgedAtMs - alert.raisedAtMs;
    const deadlineMissed = elapsedMs > severity.acknowledgeWithinMs;

    log.append(this.#policy.audit.alertAcknowledgedEvent, actor, {
      alert: alert.rule,
      incident: alert.incident,
      responder,
      shift: onCall.shift,
      acknowledgedAtMs,
      elapsedMs,
      deadlineMs: severity.acknowledgeWithinMs,
      deadlineMissed,
      note: typeof request?.note === 'string' ? request.note : '',
    });

    alert.acknowledgedBy = responder;
    alert.acknowledgedAtMs = acknowledgedAtMs;
    alert.acknowledgeDeadlineMissed = deadlineMissed;

    return deepFreeze({
      alert: alert.rule,
      responder,
      shift: onCall.shift,
      acknowledgedAtMs,
      elapsedMs,
      deadlineMs: severity.acknowledgeWithinMs,
      deadlineMissed,
    });
  }

  /**
   * قياسُ مهلةِ الإقرارِ — رفضٌ مُسمّىً حين تُفوَّت، على نسقِ `assertVisible`
   * في مركزِ العملياتِ و`assertWithinBudget` في مستوياتِ الخدمة: **المهلةُ
   * التي لا يُنادى عليها مِقبضٌ يقيسها مهلةٌ في وثيقةٍ لا في نظام.**
   *
   * @param {{ alert: string, atMs?: number }} request
   * @returns {{ alert: string, elapsedMs: number, deadlineMs: number }}
   */
  assertAcknowledgedInTime(request) {
    const id = String(request?.alert ?? '');
    const alert = this.#alerts.get(id);
    if (alert === undefined) {
      throw new IncidentResponseError(
        IR_ERRORS.ALERT_UNKNOWN,
        `لا تنبيهَ بالمعرّف «${id}» تُقاس مهلةُ إقرارِه.`,
        { alert: id },
      );
    }
    const severity = this.#severityOf(alert.severity);
    const atMs = request?.atMs ?? this.#clock('قياسِ مهلةِ الإقرار');
    const elapsedMs = (alert.acknowledgedAtMs ?? atMs) - alert.raisedAtMs;
    if (elapsedMs > severity.acknowledgeWithinMs) {
      throw new IncidentResponseError(
        IR_ERRORS.ACKNOWLEDGE_DEADLINE_MISSED,
        `مهلةُ إقرارِ التنبيه «${id}» فُوِّتت: مضى ${elapsedMs}ms والمُعلَنُ للدرجة «${severity.id}» ${severity.acknowledgeWithinMs}ms.`,
        { alert: id, elapsedMs, deadlineMs: severity.acknowledgeWithinMs },
      );
    }
    return deepFreeze({ alert: id, elapsedMs, deadlineMs: severity.acknowledgeWithinMs });
  }

  /**
   * تصعيدُ تنبيهٍ مرتبةً واحدةً في السلَّم — بعد انقضاءِ مهلةِ درجتِه.
   * @param {{ alert: string, actor?: string, reason?: string }} request
   * @returns {{ alert: string, tier: number, contact: string, escalatedAtMs: number, elapsedMs: number }}
   */
  escalate(request) {
    const actor = request?.actor ?? 'incident:response';
    const log = this.#requireLog();
    const escalatedAtMs = this.#clock('تصعيدِ تنبيه');
    const alert = this.#openAlert(String(request?.alert ?? ''), actor);
    const severity = this.#severityOf(alert.severity);

    const nextTier = alert.escalatedTier + 1;
    const step = this.#policy.escalation.ladder.find((entry) => entry.tier === nextTier);
    if (step === undefined) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.ESCALATION_TIER_EXHAUSTED,
          `التنبيه «${alert.rule}» بلغ آخرَ مرتبةٍ في السلَّم (${alert.escalatedTier} من ${this.#policy.escalation.ladder.length})؛ ولا مرتبةَ بعد صاحبِ القرارِ السياديِّ، ورفضٌ مُسمّىً أصدقُ من تصعيدٍ إلى فراغٍ يُقرأ نجاحاً.`,
          { alert: alert.rule, tier: alert.escalatedTier },
        ),
        { alert: alert.rule, tier: alert.escalatedTier },
      );
    }

    const sinceMs = alert.escalatedAtMs ?? alert.raisedAtMs;
    const elapsedMs = escalatedAtMs - sinceMs;
    if (elapsedMs < severity.escalateAfterMs) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.ESCALATION_PREMATURE,
          `تصعيدُ التنبيه «${alert.rule}» قبل انقضاءِ مهلةِ درجتِه: مضى ${elapsedMs}ms والمُعلَنُ للدرجة «${severity.id}» ${severity.escalateAfterMs}ms؛ ومن صعَّد في الثانيةِ الأولى أحرق سلَّمَه، ونداءٌ يتكرّر في كلِّ خبرٍ نداءٌ لا يُسمَع.`,
          { alert: alert.rule, elapsedMs, requiredMs: severity.escalateAfterMs },
        ),
        { alert: alert.rule, elapsedMs, requiredMs: severity.escalateAfterMs },
      );
    }

    log.append(this.#policy.audit.alertEscalatedEvent, actor, {
      alert: alert.rule,
      incident: alert.incident,
      tier: step.tier,
      contact: step.contact,
      escalatedAtMs,
      elapsedMs,
      acknowledgedBy: alert.acknowledgedBy,
      reason: typeof request?.reason === 'string' ? request.reason : '',
    });

    alert.escalatedTier = step.tier;
    alert.escalatedAtMs = escalatedAtMs;

    return deepFreeze({
      alert: alert.rule,
      tier: step.tier,
      contact: step.contact,
      escalatedAtMs,
      elapsedMs,
    });
  }

  /**
   * نشرُ تقريرِ المراجعةِ اللاحقة — **خطُّ زمنِه مقروءٌ من قيودِ القرص**.
   *
   * @param {{ alert: string, reviewer: string, impact: string, rootCause: string, correctiveActions: readonly string[], actor?: string }} request
   * @returns {{ alert: string, reviewer: string, publishedAtMs: number, timeline: ReadonlyArray<{ seq: number | null, type: string, actor: string | null, at: string | null, data: Record<string, unknown> }>, sections: readonly string[], impact: string, rootCause: string, correctiveActions: readonly string[] }}
   */
  publishReview(request) {
    const actor = request?.actor ?? 'incident:response';
    const log = this.#requireLog();
    const publishedAtMs = this.#clock('نشرِ تقريرِ المراجعة');
    const alert = this.#openAlert(String(request?.alert ?? ''), actor);

    const reviewer = String(request?.reviewer ?? '');
    if (this.#policy.escalation.selfAcknowledgeForbidden && reviewer === alert.acknowledgedBy) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.REVIEW_REVIEWER_CONFLICT,
          `المُراجِع «${reviewer}» هو من أقرّ التنبيه «${alert.rule}»؛ ومن راجع نفسَه كتب شهادةً على مرآة، وهي نفسُ قاعدةِ المراجعةِ المستقلةِ في القاعدةِ الحاكمةِ وفي غرفةِ الأزمات.`,
          { alert: alert.rule, reviewer, acknowledgedBy: alert.acknowledgedBy },
        ),
        { alert: alert.rule, reviewer },
      );
    }

    const dueElapsedMs = publishedAtMs - alert.raisedAtMs;
    if (dueElapsedMs > this.#policy.review.dueWithinMs) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.REVIEW_DEADLINE_MISSED,
          `مهلةُ تقريرِ مراجعةِ التنبيه «${alert.rule}» انقضت: مضى ${dueElapsedMs}ms والمُعلَنُ ${this.#policy.review.dueWithinMs}ms؛ وتقريرٌ يُكتب بعد شهرٍ تقريرٌ عن حادثةٍ نُسي نصفُها، ورفضُه يُقيَّد ولا يُتجاوَز بصمت.`,
          { alert: alert.rule, elapsedMs: dueElapsedMs },
        ),
        { alert: alert.rule, elapsedMs: dueElapsedMs },
      );
    }

    const evidence = this.#evidence;
    if (evidence === null) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.REVIEW_EVIDENCE_MISSING,
          'قارئُ الدليلِ غيرُ موصولٍ بمسارِ الاستجابة؛ وتقريرٌ يُبنى على ذاكرةِ العمليةِ عن نفسِها ليس تقريراً موثَّقاً، وذاك نفسُ حدِّ الدليلِ في غرفةِ الأزمات.',
          { alert: alert.rule },
        ),
        { alert: alert.rule },
      );
    }
    /** @type {readonly LogEntryLike[]} */
    let entries;
    try {
      entries = evidence();
    } catch (error) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.REVIEW_EVIDENCE_MISSING,
          `تعذّرت قراءةُ الدليلِ من القرصِ للتنبيه «${alert.rule}»: ${errorText(error)}`,
          { alert: alert.rule },
        ),
        { alert: alert.rule },
      );
    }

    const eventTypes = [
      this.#policy.audit.alertRaisedEvent,
      this.#policy.audit.alertSuppressedEvent,
      this.#policy.audit.alertAcknowledgedEvent,
      this.#policy.audit.alertEscalatedEvent,
      this.#policy.audit.alertResolvedEvent,
      this.#policy.audit.reviewPublishedEvent,
      this.#policy.audit.refusedEvent,
      this.#policy.audit.notificationDeliveredEvent,
    ];
    const timeline = buildTimeline({ entries, alertId: alert.rule, eventTypes });
    try {
      assertEvidence({
        timeline,
        alertId: alert.rule,
        raisedEvent: this.#policy.audit.alertRaisedEvent,
      });
    } catch (error) {
      this.#refuse(actor, /** @type {IncidentResponseError} */ (error), { alert: alert.rule });
    }

    /** @type {{ impact: string, rootCause: string, correctiveActions: string[] }} */
    let sections;
    try {
      sections = assertSections({
        policy: this.#policy.review,
        report: {
          impact: request?.impact,
          rootCause: request?.rootCause,
          correctiveActions: request?.correctiveActions,
        },
        alertId: alert.rule,
      });
    } catch (error) {
      this.#refuse(actor, /** @type {IncidentResponseError} */ (error), { alert: alert.rule });
    }

    log.append(this.#policy.audit.reviewPublishedEvent, actor, {
      alert: alert.rule,
      incident: alert.incident,
      reviewer,
      publishedAtMs,
      timelineEntries: timeline.length,
      sections: [...IR_SECTIONS],
      impact: sections.impact,
      rootCause: sections.rootCause,
      correctiveActions: sections.correctiveActions,
    });

    alert.reviewedBy = reviewer;
    alert.reviewedAtMs = publishedAtMs;

    return deepFreeze({
      alert: alert.rule,
      reviewer,
      publishedAtMs,
      timeline,
      sections: [...IR_SECTIONS],
      impact: sections.impact,
      rootCause: sections.rootCause,
      correctiveActions: sections.correctiveActions,
    });
  }

  /**
   * حلُّ التنبيه — ولا يُحَلُّ ما لم يُقَرّ، ولا تُغلَق حادثةٌ تستوجب مراجعةً
   * بلا تقريرٍ منشور.
   * @param {{ alert: string, actor?: string, note?: string }} request
   * @returns {{ alert: string, incident: string, resolvedAtMs: number, durationMs: number, reviewedBy: string | null }}
   */
  resolve(request) {
    const actor = request?.actor ?? 'incident:response';
    const log = this.#requireLog();
    const resolvedAtMs = this.#clock('حلِّ تنبيه');
    const alert = this.#openAlert(String(request?.alert ?? ''), actor);
    const severity = this.#severityOf(alert.severity);

    if (alert.acknowledgedBy === null) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.RESOLVE_BEFORE_ACKNOWLEDGE,
          `التنبيه «${alert.rule}» يُراد حلُّه ولم يُقَرَّ من أحد؛ وحادثةٌ تُغلَق بلا مالكٍ أقرّها حادثةٌ يُقال إنها حُلَّت ولا يُعرف من رآها.`,
          { alert: alert.rule },
        ),
        { alert: alert.rule },
      );
    }
    if (severity.requiresReview && alert.reviewedBy === null) {
      this.#refuse(
        actor,
        new IncidentResponseError(
          IR_ERRORS.REVIEW_REQUIRED,
          `الدرجة «${severity.id}» تُلزِم بتقريرِ مراجعةٍ ولم يُنشَر للتنبيه «${alert.rule}»؛ والحادثةُ التي تُغلَق بلا مراجعةٍ تعود، لا لإهمالٍ بل لأن ما تعلَّمه المستجيبُ بقي في رأسِه وحدَه.`,
          { alert: alert.rule, severity: severity.id },
        ),
        { alert: alert.rule, severity: severity.id },
      );
    }

    const durationMs = resolvedAtMs - alert.raisedAtMs;
    log.append(this.#policy.audit.alertResolvedEvent, actor, {
      alert: alert.rule,
      incident: alert.incident,
      resolvedAtMs,
      durationMs,
      acknowledgedBy: alert.acknowledgedBy,
      reviewedBy: alert.reviewedBy,
      escalatedTier: alert.escalatedTier,
      note: typeof request?.note === 'string' ? request.note : '',
    });
    alert.state = 'resolved';

    return deepFreeze({
      alert: alert.rule,
      incident: alert.incident,
      resolvedAtMs,
      durationMs,
      reviewedBy: alert.reviewedBy,
    });
  }

  /**
   * مُبلِّغُ الإشعاراتِ أو رفضٌ مُسمّى — يُطالَبُ عند التسليم.
   * @returns {Notifier}
   */
  #requireNotifier() {
    const notifier = this.#notifier;
    if (notifier === null) {
      throw new IncidentResponseError(
        IR_ERRORS.DELIVERY_REQUIRED,
        'مُبلِّغُ الإشعاراتِ غيرُ موصولٍ بمسارِ الاستجابة؛ والتنبيهُ الذي لا يصل صاحبَه تنبيهٌ يُكتب ولا يُقرأ.',
        {},
      );
    }
    return notifier;
  }

  /**
   * تسليمُ إشعاراتِ التنبيهاتِ المفتوحةِ عبر القناةِ المُعلَنة — رسالةٌ تُرسَل
   * فعلاً ويُقاسُ وصولُها. والمُرسِلُ محقونٌ لا مستورد: فالنقلُ أثرٌ والوحدةُ
   * حكمٌ، ومن خلطهما جعل الحكمَ تابعاً لشبكةٍ قد تنقطع.
   *
   * @param {{ actor?: string }} [context]
   * @returns {Promise<{ deliveredAtMs: number, results: ReadonlyArray<{ alert: string, channel: string, delivered: boolean, status: number, atMs: number }> }>}
   */
  async deliver(context = {}) {
    const actor = context.actor ?? 'incident:response';
    const notifier = this.#requireNotifier();
    const log = this.#requireLog();
    const deliveredAtMs = this.#clock('تسليمِ الإشعارات');

    /** @type {Array<{ alert: string, channel: string, delivered: boolean, status: number, atMs: number }>} */
    const results = [];
    for (const alert of this.#alerts.values()) {
      if (alert.state !== 'open') continue;
      if (alert.deliveredAtMs !== null) continue;

      const notification = buildNotification(alert);
      let result;
      try {
        result = await notifier.deliver(notification, deliveredAtMs);
      } catch (error) {
        result = {
          channel: alert.channel,
          delivered: false,
          status: 0,
          atMs: deliveredAtMs,
          error: errorText(error),
        };
      }

      log.append(this.#policy.audit.notificationDeliveredEvent, actor, {
        alert: alert.rule,
        incident: alert.incident,
        channel: alert.channel,
        delivered: result.delivered,
        status: result.status,
        atMs: deliveredAtMs,
      });

      alert.deliveredAtMs = deliveredAtMs;
      alert.deliveryStatus = result.status;

      results.push({
        alert: alert.rule,
        channel: alert.channel,
        delivered: result.delivered,
        status: result.status,
        atMs: deliveredAtMs,
      });
    }

    return deepFreeze({ deliveredAtMs, results });
  }

  /**
   * قراءةُ حالِ تنبيهٍ — بياناتٌ مثبَّتةٌ لا مِقبضٌ يُعدَّل به شيء.
   * @param {string} id
   * @returns {AlertState | null}
   */
  alert(id) {
    // معرّفٌ مجهولٌ يُرَدُّ بالاسم، ولا يُرجَع `null` فيوافق **جوابَ قاعدةٍ
    // مُعلَنةٍ لا حادثةَ لها**: جمعُ الحالتين في جوابٍ واحدٍ يجعل خطأَ الكتابةِ
    // في معرّفٍ يُقرأ «لا حادثةَ هاهنا» — وهو أخطرُ ما يُقرأ في مراقبة.
    if (!this.#rules.has(id)) {
      throw new IncidentResponseError(
        IR_ERRORS.RULE_UNDECLARED,
        `لا قاعدةَ تنبيهٍ بالمعرّف «${id}» في الوثيقة؛ وقراءةُ حالِ ما لا يُعلَن تُرَدُّ بالاسم، ولا تُرجَع «لا حادثةَ» فتُقرأ طُمأنينةً.`,
        { alert: id },
      );
    }
    const alert = this.#alerts.get(id);
    return alert === undefined ? null : deepFreeze({ ...alert });
  }
}
