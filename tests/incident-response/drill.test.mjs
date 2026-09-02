// اختبارُ قبولِ الخطوة `M10.03`: **تمرينٌ — تنبيهٌ ⇒ استجابةٌ ⇒ تقريرُ مراجعةٍ
// موثَّق**. وثلاثةُ أشقٍّ لا شقٌّ واحد، وكلٌّ يفشل وحدَه إن انكسر:
//
//   ١. **تنبيهٌ** — لا يُصنَع في الاختبارِ ولا يُمرَّر يدويّاً: يُرفَع من
//      **حكمٍ مقيسٍ حقيقيٍّ** على لوحةِ `M10.02`، وذلك الحكمُ ناتجٌ عن **نداءٍ
//      حقيقيٍّ على بوابةٍ حقيقيةٍ** رُدَّ بـ`API_AUTH_REQUIRED` فاستهلك ميزانيةَ
//      أخطاءِ الإتاحةِ فعلاً. فلو انفصلت اللوحةُ عن المقاييسِ أو انفصل التنبيهُ
//      عن اللوحةِ سقط هذا الشقُّ وحدَه.
//
//   ٢. **استجابةٌ** — تُقاس بأثرِها لا بقيمةٍ مُعادة: الحادثةُ تُقيَّد في
//      **مركزِ عملياتٍ حقيقيٍّ** فيُقرأ عددُ حوادثِه المفتوحةِ، والمستجيبُ
//      **يُحَلُّ من جدولِ مناوبةٍ** فيُرَدُّ من ليس على مناوبتِه، والتصعيدُ
//      **يُرَدُّ قبل مهلتِه** ويُقبَل بعدها بترتيبِ السلَّمِ ثم يُرَدُّ بعد آخرِ
//      مرتبةٍ.
//
//   ٣. **تقريرُ مراجعةٍ موثَّق** — الإغلاقُ لا يُقبَل إلا وقد نُشر تقريرٌ خطُّ
//      زمنِه **مقروءٌ من ملفِّ السجلِّ على القرصِ** لا من ذاكرةِ العمليةِ عن
//      نفسِها، وأقسامُه اللازمةُ حاضرةٌ بحدودِ طولِها، **والمُراجِعُ غيرُ
//      المستجيبِ**. فلو صار السجلُّ ذاكريّاً أو نقص قسمٌ أو راجع المستجيبُ نفسَه
//      سقط الإغلاقُ برمزٍ مُعلَن.
//
// والمكوّناتُ **حقيقية**: `PersistentEventLog` بملفٍّ متسلسلٍ برأسٍ متسلسلٍ على
// القرص، و`ApiGateway` حقيقيةٌ على وثيقتِها النافذةِ ونقطةِ تفويضٍ حقيقيةٍ،
// و`MonitorAgent` حقيقيٌّ، و`createTelemetry` حقيقيٌّ، ولوحةُ مستوياتِ خدمةٍ
// مبنيةٌ على **سجلِّ مقاييسِ المثيلِ نفسِه**، و`OperationsCenter` حقيقيٌّ على
// وثيقتِه.
//
// **حدٌّ معلَن أول:** لا قناةَ نقلٍ خارجيةً — `channel` معرّفٌ يُقيَّد في
// السجلِّ، والنقلُ دَينٌ معلَنٌ موروثٌ من `M9.06` مسجَّلٌ في `REMAINING_WORK.md`.
// فما يُقاس هنا أنّ التنبيهَ **رُفع وقُيِّد ووُجِّه ووُجد له مستجيبٌ وأُقِرَّ
// وصُعِّد ورُوجِع وحُلَّ**، لا وصولُ حزمةٍ إلى هاتف.
//
// **حدٌّ معلَن ثانٍ:** المستودعاتُ ذاكريةٌ لا PostgreSQL وسجلُّ الهوياتِ قارئٌ
// يُرجِع صفوفاً مصنوعةً — كما في اختبارِ `M10.02`. والمقيسُ هنا مسارُ الاستجابةِ
// لا سلامةُ الطبقاتِ تحتَه، وهي مقيسةٌ في `tests/api` و`tests/operations`.
//
// **حدٌّ معلَن ثالث:** الساعةُ **مُقادةٌ** من الاختبارِ كي تُقاس المهلاتُ في
// ثوانٍ لا في ساعات؛ وذاك بعينُه سببُ حقنِ الساعةِ في الوحدة.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import { ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import {
  IR_ERRORS,
  IncidentResponse,
  loadIncidentResponsePolicy,
} from '../../src/incident-response/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import { OperationsCenter, loadOperationsPolicy } from '../../src/operations/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { PersistentEventLog } from '../../src/root-of-trust/index.mjs';
import { createServiceLevels, loadServiceLevelPolicy } from '../../src/service-levels/index.mjs';
import { createTelemetry, loadTelemetryPolicy } from '../../src/telemetry/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });
const TELEMETRY_POLICY = loadTelemetryPolicy({ dir: CONFIG_DIR });
const SERVICE_LEVELS_POLICY = loadServiceLevelPolicy({ dir: CONFIG_DIR });
const OPERATIONS_POLICY = loadOperationsPolicy({ dir: CONFIG_DIR });
const IR_POLICY = loadIncidentResponsePolicy({ dir: CONFIG_DIR });

const AUDITOR = 'agent:incident-response-auditor';
const DAY_DESK = 'contact:audit-desk';
const NIGHT_DESK = 'contact:sovereign-desk';

/** درجةُ التنبيهِ الحرِجِ ومهلتاها — **من الوثيقةِ لا من ثابتٍ في الاختبار**. */
const CRITICAL = IR_POLICY.severities.find((severity) => severity.id === 'severity:critical');
assert.ok(CRITICAL !== undefined, 'الدرجةُ severity:critical غائبةٌ عن وثيقةِ مسارِ الاستجابة.');

/**
 * قراءةُ قيودِ السجلِّ **من القرص** سطراً سطراً — وهي عينُ ما يُبنى عليه خطُّ
 * زمنِ التقرير؛ فلو كان السجلُّ ذاكريّاً لم يُقرأ منه شيءٌ هنا.
 * @param {string} logFile
 * @returns {Array<Record<string, unknown>>}
 */
function onDisk(logFile) {
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/**
 * دولةٌ مصغَّرةٌ حقيقيةٌ على قرصٍ مؤقّت، بساعةٍ **مُقادةٍ** من الاختبار.
 *
 * `evidence: null` يفصل قارئَ الدليلِ عن السجلِّ ليُقاس سقوطُ التقريرِ لغيابِه
 * وحدَه لا لغيابِ شيءٍ آخر.
 *
 * @param {{ evidence?: null }} [options]
 */
function state(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-incident-'));
  const logFile = path.join(directory, 'events.log');
  const log = new PersistentEventLog(logFile, { fsync: false });

  let clock = 5_000;
  /** @param {number} ms */
  const advance = (ms) => {
    clock += ms;
  };
  const nowMs = () => clock;

  const repositories = createMemoryRepositories();
  /** @type {Record<string, Record<string, unknown>>} */
  const identities = {
    [AUDITOR]: {
      id: AUDITOR,
      kind: 'service',
      state: 'active',
      role: MONITORING_POLICY.role,
      capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
    },
  };
  const agents = {
    /** @param {string} id */
    get: async (id) => identities[id] ?? null,
  };
  const telemetry = createTelemetry({ policy: TELEMETRY_POLICY, now: nowMs });
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
    telemetry,
  });
  const gateway = new ApiGateway({
    policy: API_POLICY,
    log: /** @type {never} */ (log),
    agents: /** @type {never} */ (agents),
    monitor,
    enforcementPoint: enforcementPointFor(/** @type {never} */ (log)),
    telemetry,
  });
  const serviceLevels = createServiceLevels({
    policy: SERVICE_LEVELS_POLICY,
    telemetryPolicy: TELEMETRY_POLICY,
    metrics: telemetry.metrics,
    now: nowMs,
  });
  const operations = new OperationsCenter({
    policy: OPERATIONS_POLICY,
    log: /** @type {never} */ (log),
    gateway,
    nowMs,
  });
  const incidents = new IncidentResponse({
    policy: IR_POLICY,
    serviceLevels,
    operations: /** @type {never} */ (operations),
    log: /** @type {never} */ (log),
    evidence: options.evidence === null ? null : () => /** @type {never} */ (onDisk(logFile)),
    nowMs,
  });

  return { directory, logFile, gateway, serviceLevels, operations, incidents, advance, nowMs };
}

/** @param {unknown} error @param {string} code @returns {boolean} */
function hasCode(error, code) {
  return /** @type {{ code?: string }} */ (error).code === code;
}

test('معيارُ القبول: تنبيهٌ من حكمٍ مقيسٍ ⇒ استجابةٌ من مناوبةٍ ⇒ تقريرُ مراجعةٍ خطُّ زمنِه من القرص', async () => {
  const { logFile, gateway, serviceLevels, operations, incidents, advance } = state();

  // ── الشقُّ الأول: التنبيهُ من حكمٍ مقيسٍ حقيقيٍّ لا من قيمةٍ مُمرَّرة ──
  // نداءٌ بلا رمزٍ يُرَدُّ بـ`API_AUTH_REQUIRED` فيُعَدُّ إخفاقاً في القدرة:
  // الميزانيةُ تقيس ما رآه المستدعي لا ما نواه النظام.
  await gateway.call({ route: 'state.agents.list' }).catch(() => {});
  const availability = serviceLevels
    .dashboard()
    .capabilities.flatMap((capability) => capability.objectives)
    .find((row) => row.id === 'slo:api.availability');
  assert.ok(availability !== undefined);
  assert.equal(
    availability.status,
    'breaching',
    'اللوحةُ لم تحكم بالإخفاقِ فلا تنبيهَ يُقاس عليه.',
  );

  const evaluation = incidents.evaluate({ actor: 'agent:drill' });
  const raisedIds = evaluation.raised.map((entry) => entry.alert);
  assert.ok(
    raisedIds.includes('alert:api-availability-breaching'),
    'انكسارُ عهدِ الإتاحةِ لم يرفع تنبيهاً — واللوحةُ التي تُقرأ ولا تُرسِل هي بعينُها عيبُ M10.02 الذي جاءت M10.03 لتُغلقه.',
  );
  const raised = evaluation.raised.find(
    (entry) => entry.alert === 'alert:api-availability-breaching',
  );
  assert.ok(raised !== undefined);
  assert.equal(raised.severity, 'severity:critical');
  assert.equal(
    raised.responder,
    DAY_DESK,
    'المستجيبُ لم يُحَلَّ من جدولِ المناوبةِ على الساعةِ المُقادة.',
  );
  assert.ok(
    IR_POLICY.rules.some((rule) => rule.id === raised.alert && rule.channel === raised.channel),
    'قناةُ التنبيهِ ليست قناةَ قاعدتِه المُعلَنة.',
  );

  // والقاعدةُ التي لم تُشعِل تُعاد بسببِ صمتِها لا تُطوى: «لا شيءَ» ليس جواباً.
  assert.ok(evaluation.quiet.length > 0);
  for (const quiet of evaluation.quiet) assert.ok(quiet.reason.length > 20);

  // ── الشقُّ الثاني: الاستجابةُ تُقاس بأثرِها ──
  // (أ) الحادثةُ في **مركزِ العملياتِ نفسِه** لا في سجلٍّ ثانٍ.
  assert.equal(
    operations.describe().openIncidents,
    evaluation.raised.length,
    'الحوادثُ لم تُقيَّد في مركزِ العملياتِ — وسجلٌّ ثانٍ عدّةٌ ثانيةٌ لشيءٍ واحد.',
  );

  // (ب) القيدُ على **القرص** لا في الذاكرة.
  const raisedEntries = onDisk(logFile).filter(
    (entry) => entry['type'] === IR_POLICY.audit.alertRaisedEvent,
  );
  assert.equal(raisedEntries.length, evaluation.raised.length);

  // (ج) التنبيهُ المفتوحُ لا يُرفَع مرّتين: يُقيَّد كتماً بسببِه.
  const again = incidents.evaluate({ actor: 'agent:drill' });
  assert.equal(again.raised.length, 0);
  assert.ok(again.suppressed.some((entry) => entry.alert === raised.alert));
  assert.equal(
    operations.describe().openIncidents,
    evaluation.raised.length,
    'الكتمُ قيَّد حادثةً ثانيةً — وفيضُ نسخِ حادثةٍ واحدةٍ يُسقِط سعةَ سجلِّ المركزِ فيصير عمًى في موضعِ الرؤية.',
  );

  // (د) من ليس على المناوبةِ لا يُقِرّ.
  assert.throws(
    () => incidents.acknowledge({ alert: raised.alert, responder: NIGHT_DESK }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.RESPONDER_NOT_ON_CALL),
  );
  assert.throws(
    () => incidents.acknowledge({ alert: raised.alert, responder: 'contact:whoever' }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.RESPONDER_UNKNOWN),
  );

  // (هـ) التصعيدُ قبل مهلتِه مردودٌ.
  assert.throws(
    () => incidents.escalate({ alert: raised.alert }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.ESCALATION_PREMATURE),
  );

  // (و) الإقرارُ من المناوبِ يُقبَل داخلَ مهلتِه.
  const ack = incidents.acknowledge({
    alert: raised.alert,
    responder: DAY_DESK,
    note: 'تمرينُ M10.03',
  });
  assert.equal(ack.responder, DAY_DESK);
  assert.equal(ack.shift, 'shift:day');
  assert.equal(ack.deadlineMissed, false);
  assert.equal(ack.deadlineMs, CRITICAL.acknowledgeWithinMs);
  incidents.assertAcknowledgedInTime({ alert: raised.alert });

  // ولا إقرارَ مرّتين: معرّفُ أوّلِ من ملك الحادثةَ لا يُطمَس.
  assert.throws(
    () => incidents.acknowledge({ alert: raised.alert, responder: DAY_DESK }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.ALERT_ALREADY_ACKNOWLEDGED),
  );

  // (ز) التصعيدُ بترتيبِ السلَّمِ بعد انقضاءِ المهلةِ، ولا مرتبةَ بعد آخرِها.
  advance(CRITICAL.escalateAfterMs + 1);
  const first = incidents.escalate({ alert: raised.alert, reason: 'لم يُحَلّ بعد الإقرار' });
  assert.equal(first.tier, 1);
  assert.equal(first.contact, DAY_DESK);
  assert.throws(
    () => incidents.escalate({ alert: raised.alert }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.ESCALATION_PREMATURE),
  );
  advance(CRITICAL.escalateAfterMs + 1);
  const second = incidents.escalate({ alert: raised.alert });
  assert.equal(second.tier, 2);
  assert.equal(second.contact, NIGHT_DESK);
  advance(CRITICAL.escalateAfterMs + 1);
  assert.throws(
    () => incidents.escalate({ alert: raised.alert }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.ESCALATION_TIER_EXHAUSTED),
  );

  // ── الشقُّ الثالث: لا إغلاقَ بلا تقريرِ مراجعةٍ موثَّق ──
  assert.throws(
    () => incidents.resolve({ alert: raised.alert }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.REVIEW_REQUIRED),
  );

  // والمُراجِعُ ليس المستجيب: من راجع نفسَه كتب شهادةً على مرآة.
  assert.throws(
    () =>
      incidents.publishReview({
        alert: raised.alert,
        reviewer: DAY_DESK,
        impact:
          'رُدَّ نداءٌ واحدٌ على مسارِ قراءةِ سجلِّ الوكلاءِ بلا رمزِ جلسةٍ فاستُهلكت ميزانيةُ الإتاحة.',
        rootCause:
          'نداءٌ بلا رمزِ جلسةٍ يُعَدُّ إخفاقاً في القدرةِ لأن الميزانيةَ تقيس ما رآه المستدعي لا ما نواه النظام.',
        correctiveActions: ['تثبيتُ فتحِ الجلسةِ قبل النداءِ في مسارِ التمرين.'],
      }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.REVIEW_REVIEWER_CONFLICT),
  );

  // وقسمٌ أقصرُ من حدِّ الوثيقةِ يُسقِط التقريرَ برمزٍ مُعلَن.
  assert.throws(
    () =>
      incidents.publishReview({
        alert: raised.alert,
        reviewer: NIGHT_DESK,
        impact:
          'رُدَّ نداءٌ واحدٌ على مسارِ قراءةِ سجلِّ الوكلاءِ بلا رمزِ جلسةٍ فاستُهلكت الميزانية.',
        rootCause: 'خطأٌ عارض.',
        correctiveActions: ['تثبيتُ فتحِ الجلسةِ قبل النداءِ في مسارِ التمرين.'],
      }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.REVIEW_SECTION_MISSING),
  );

  const review = incidents.publishReview({
    alert: raised.alert,
    reviewer: NIGHT_DESK,
    impact:
      'رُدَّ نداءٌ واحدٌ على مسارِ قراءةِ سجلِّ الوكلاءِ بلا رمزِ جلسةٍ فاستُهلكت ميزانيةُ الإتاحة.',
    rootCause:
      'نداءٌ بلا رمزِ جلسةٍ يُعَدُّ إخفاقاً في القدرةِ لأن الميزانيةَ تقيس ما رآه المستدعي لا ما نواه النظام، وميزانيةُ نافذةِ عمرِ العمليةِ تُستنفَد بحدثٍ واحدٍ حين لا حدثَ ناجحٌ قبله.',
    correctiveActions: [
      'فتحُ الجلسةِ قبل النداءِ في مسارِ التمرينِ كي لا يُستهلَك مقياسُ الإتاحةِ بنداءٍ مقصودِ الرفض.',
      'تسجيلُ حدِّ نافذةِ عمرِ العمليةِ في REMAINING_WORK بوصفِه دَيناً معلَناً لا عطباً مكتوماً.',
    ],
  });

  // خطُّ الزمنِ **من القرص**: كلُّ قيدٍ فيه له ترقيمٌ متسلسلٌ من ملفِّ السجلِّ،
  // ولا يُبنى من ذاكرةِ العمليةِ عن نفسِها.
  assert.ok(review.timeline.length >= 4, 'خطُّ الزمنِ أقصرُ من مسارٍ وقع فعلاً.');
  for (const entry of review.timeline) {
    assert.equal(typeof entry.seq, 'number');
    assert.equal(entry.data['alert'], raised.alert);
  }
  const types = review.timeline.map((entry) => entry.type);
  assert.ok(types.includes(IR_POLICY.audit.alertRaisedEvent));
  assert.ok(types.includes(IR_POLICY.audit.alertAcknowledgedEvent));
  assert.ok(types.includes(IR_POLICY.audit.alertEscalatedEvent));
  assert.ok(
    types.includes(IR_POLICY.audit.refusedEvent),
    'الرفضُ لم يُقيَّد — ورفضٌ يُبتلَع رفضٌ يُنكَر.',
  );
  assert.deepEqual(
    review.timeline.map((entry) => entry.seq),
    [...review.timeline].sort((a, b) => Number(a.seq) - Number(b.seq)).map((entry) => entry.seq),
    'خطُّ الزمنِ غيرُ مرتَّبٍ بترتيبِ كتابتِه على القرص.',
  );

  // والقيدُ نفسُه على القرص.
  const published = onDisk(logFile).filter(
    (entry) => entry['type'] === IR_POLICY.audit.reviewPublishedEvent,
  );
  assert.equal(published.length, 1);
  const publishedFirst = published[0];
  assert.ok(publishedFirst, 'قيدُ نشرِ التقريرِ غائبٌ عن الملفِّ.');
  assert.equal(
    /** @type {Record<string, unknown>} */ (publishedFirst['data'])['reviewer'],
    NIGHT_DESK,
  );

  // ── الإغلاقُ بعد التقريرِ، ولا أثرَ على مُغلَق ──
  const resolved = incidents.resolve({ alert: raised.alert, note: 'انتهى التمرين' });
  assert.equal(resolved.reviewedBy, NIGHT_DESK);
  assert.ok(resolved.durationMs > 0);
  assert.throws(
    () => incidents.resolve({ alert: raised.alert }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.ALERT_NOT_OPEN),
  );
});

test('لا حلَّ لتنبيهٍ لم يُقَرّ — وحادثةٌ تُغلَق بلا مالكٍ حادثةٌ لا يُعرف من رآها', async () => {
  const { gateway, incidents } = state();
  await gateway.call({ route: 'state.agents.list' }).catch(() => {});
  const evaluation = incidents.evaluate({ actor: 'agent:drill' });
  const alert = evaluation.raised[0]?.alert;
  assert.ok(alert !== undefined);
  assert.throws(
    () => incidents.resolve({ alert }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.RESOLVE_BEFORE_ACKNOWLEDGE),
  );
});

test('مهلةُ الإقرارِ تُقاس ولا تُقرأ: إقرارٌ متأخّرٌ يُقبَل ويُقيَّد تفويتُه ويُرَدُّ به مِقبضُ القياس', async () => {
  const { gateway, incidents, advance, logFile } = state();
  await gateway.call({ route: 'state.agents.list' }).catch(() => {});
  const evaluation = incidents.evaluate({ actor: 'agent:drill' });
  const alert = evaluation.raised.find(
    (entry) => entry.alert === 'alert:api-availability-breaching',
  );
  assert.ok(alert !== undefined);

  // المهلةُ من الوثيقةِ لا من ثابتٍ هنا، والساعةُ مُقادةٌ فتُقاس في ثوانٍ.
  advance(CRITICAL.acknowledgeWithinMs + 1);
  const onCall = incidents.onCall();
  const ack = incidents.acknowledge({ alert: alert.alert, responder: onCall.responder });
  assert.equal(
    ack.deadlineMissed,
    true,
    'التفويتُ لم يُقرأ — ومهلةٌ تُفوَّت بلا قيدٍ مهلةٌ في وثيقةٍ لا في نظام.',
  );
  assert.throws(
    () => incidents.assertAcknowledgedInTime({ alert: alert.alert }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.ACKNOWLEDGE_DEADLINE_MISSED),
  );
  const acked = onDisk(logFile).filter(
    (entry) =>
      entry['type'] === IR_POLICY.audit.alertAcknowledgedEvent &&
      /** @type {Record<string, unknown>} */ (entry['data'])['alert'] === alert.alert,
  );
  assert.equal(acked.length, 1);
  const ackedFirst = acked[0];
  assert.ok(ackedFirst, 'قيدُ الإقرارِ غائبٌ عن الملفِّ.');
  assert.equal(/** @type {Record<string, unknown>} */ (ackedFirst['data'])['deadlineMissed'], true);
});

test('لا تقريرَ بلا دليلٍ من القرص: قارئُ الدليلِ غيرُ الموصولِ يُسقِط النشرَ برمزٍ مُعلَن', async () => {
  // التركيبُ نفسُه والنداءُ نفسُه والإخفاقُ نفسُه — **إلا قارئَ الدليل**، فهو
  // غيرُ موصول. فالمقيسُ هنا أن التقريرَ يسقط لغيابِ الدليلِ وحدَه لا لغيابِ
  // شيءٍ آخر، وأن غيابَه **يُقيَّد رفضاً** ولا يُستبدَل بخطِّ زمنٍ من ذاكرةِ
  // العمليةِ عن نفسِها — فذاك تقريرُ متّهمٍ عن نفسِه.
  const { gateway, incidents, logFile } = state({ evidence: null });
  await gateway.call({ route: 'state.agents.list' }).catch(() => {});
  const evaluation = incidents.evaluate({ actor: 'agent:drill' });
  const alert = evaluation.raised[0]?.alert;
  assert.ok(alert !== undefined, 'لم يُرفَع تنبيهٌ على إخفاقٍ مقيسٍ — فلا شيءَ يُراجَع.');
  incidents.acknowledge({ alert, responder: incidents.onCall().responder });
  assert.throws(
    () =>
      incidents.publishReview({
        alert,
        reviewer: NIGHT_DESK,
        impact:
          'رُدَّ نداءٌ واحدٌ على مسارِ قراءةِ سجلِّ الوكلاءِ فاستُهلكت ميزانيةُ الإتاحةِ كلُّها.',
        rootCause:
          'نافذةُ عمرِ العمليةِ بلا حدثٍ ناجحٍ تُستنفَد ميزانيتُها بحدثٍ مرفوضٍ واحد، وهو حدٌّ معلَنٌ في M10.02 لا عطبٌ في القياس.',
        correctiveActions: ['تسجيلُ حدِّ نافذةِ عمرِ العمليةِ دَيناً معلَناً في REMAINING_WORK.'],
      }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.REVIEW_EVIDENCE_MISSING),
  );
  const refusals = onDisk(logFile).filter(
    (entry) => entry['type'] === IR_POLICY.audit.refusedEvent,
  );
  assert.ok(
    refusals.some(
      (entry) =>
        /** @type {Record<string, unknown>} */ (entry['data'])['code'] ===
        IR_ERRORS.REVIEW_EVIDENCE_MISSING,
    ),
    'الرفضُ لم يُقيَّد على القرص — ورفضٌ لا يُقرأ بعد حينٍ رفضٌ لم يقع.',
  );
});
