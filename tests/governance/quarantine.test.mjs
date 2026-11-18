// اختبار الحجر الصحّي التلقائي — M6.09.
//
// المعيار المعلَن: «شذوذ ⇒ عزل تلقائي وفتح حادثة». والمقيس هنا أنّ العزل يقع
// عند العتبة لا قبلها ولا بعدها، وأن الحادثة تُفتح مرّة واحدة لا مع كل إشارة،
// وأن فشل العازل الدائم لا يُقرأ إذناً، وأن الخروج من الحجر بسبب مسجَّل بيدٍ
// بشرية لا بمرور الوقت. والإشارة المجهولة تُرفض بخطأ لا تُتجاهل.

import test from 'node:test';
import assert from 'node:assert/strict';
import { IncidentRegister, IncidentSeverity } from '../../src/identity/incident-register.mjs';
import {
  ANOMALY_KINDS,
  QUARANTINE_ERRORS,
  QuarantineWarden,
  createQuarantineWarden,
} from '../../src/governance/quarantine.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { LawRegistry, LawState } from '../../src/governance/index.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';

/** سجل أحداث صغير. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  return {
    events,
    /**
     * @param {string} type
     * @param {string} actor
     * @param {object} payload
     * @returns {void}
     */
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
}

/**
 * @param {{ isolate?: ((subject: string, reason: string) => Promise<unknown>) | null, now?: () => Date, windowMs?: number }} [deps]
 */
function setup(deps = {}) {
  const log = memoryLog();
  const incidents = new IncidentRegister({ log });
  const warden = createQuarantineWarden({
    incidents,
    log,
    isolate: deps.isolate ?? null,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.windowMs === undefined ? {} : { windowMs: deps.windowMs }),
  });
  return { log, incidents, warden };
}

test('تبدّل بصمة الأوزان يعزل من الإشارة الأولى ويفتح حادثة حرجة', async () => {
  /** @type {Array<{ subject: string, reason: string }>} */
  const isolated = [];
  const { warden, incidents } = setup({
    isolate: async (subject, reason) => {
      isolated.push({ subject, reason });
    },
  });
  const outcome = warden.report({
    kind: 'model-fingerprint-mismatch',
    subject: 'model:1',
    detail: { fingerprint: 'a'.repeat(64) },
  });
  assert.equal(outcome.isolated, true);
  assert.equal(outcome.threshold, 1);
  assert.ok(warden.isQuarantined('model:1'));
  await warden.settle();
  assert.equal(isolated.length, 1);
  assert.equal(isolated[0]?.subject, 'model:1');
  const open = incidents.list({ state: 'open' });
  assert.equal(open.length, 1);
  assert.equal(open[0]?.severity, IncidentSeverity.CRITICAL);
  assert.equal(open[0]?.type, 'quarantine:model-fingerprint-mismatch');
});

test('رفض الخروج المتكرّر يعزل عند العتبة لا قبلها', () => {
  const { warden, incidents } = setup();
  assert.equal(ANOMALY_KINDS['egress-refused']?.threshold, 3);
  const first = warden.report({ kind: 'egress-refused', subject: 'agent:1' });
  const second = warden.report({ kind: 'egress-refused', subject: 'agent:1' });
  assert.equal(first.isolated, false);
  assert.equal(second.isolated, false);
  assert.equal(incidents.list({ state: 'open' }).length, 0);
  const third = warden.report({ kind: 'egress-refused', subject: 'agent:1' });
  assert.equal(third.isolated, true);
  assert.equal(third.count, 3);
  assert.equal(incidents.list({ state: 'open' }).length, 1);
});

test('المحجور يبقى محجوراً بحادثة واحدة لا حادثة لكل إشارة', () => {
  const { warden, incidents } = setup();
  const first = warden.report({ kind: 'identity-unverified', subject: 'agent:2' });
  const again = warden.report({ kind: 'identity-unverified', subject: 'agent:2' });
  assert.equal(first.isolated, true);
  assert.equal(again.isolated, false);
  assert.equal(again.incidentId, first.incidentId);
  assert.equal(incidents.list({ state: 'open' }).length, 1);
});

test('إشارات خارج النافذة لا تتراكم فلا يُعزل بريءٌ بمرور الشهر', () => {
  let clock = new Date('2026-08-24T10:00:00.000Z');
  const { warden } = setup({ windowMs: 60_000, now: () => clock });
  warden.report({ kind: 'egress-refused', subject: 'agent:3' });
  warden.report({ kind: 'egress-refused', subject: 'agent:3' });
  clock = new Date('2026-08-24T10:05:00.000Z');
  const late = warden.report({ kind: 'egress-refused', subject: 'agent:3' });
  assert.equal(late.count, 1, 'القديم سقط من النافذة');
  assert.equal(late.isolated, false);
});

test('نوع شذوذ غير معلَن يُرفض بخطأ مُسمّى لا يُتجاهل', () => {
  const { warden } = setup();
  assert.throws(
    () => warden.report({ kind: 'شيء-جديد', subject: 'agent:4' }),
    (error) =>
      /** @type {{ code: string }} */ (error).code === QUARANTINE_ERRORS.SIGNAL_KIND_UNKNOWN,
  );
  assert.throws(
    () => warden.report({ kind: 'egress-refused', subject: '   ' }),
    (error) => /** @type {{ code: string }} */ (error).code === QUARANTINE_ERRORS.SUBJECT_REQUIRED,
  );
});

test('فشل العزل الدائم يُسجَّل والمحجور يبقى محجوراً', async () => {
  const { warden, log } = setup({
    isolate: async () => {
      throw new Error('القاعدة غير متاحة');
    },
  });
  warden.report({ kind: 'model-fingerprint-mismatch', subject: 'model:9' });
  await warden.settle();
  assert.ok(warden.isQuarantined('model:9'), 'فشل العازل لا يُقرأ إذناً');
  assert.ok(
    log.events.some((event) => event.type === 'quarantine.isolation-failed'),
    'فشل العزل يُسجَّل كي يُرى',
  );
});

test('الإخراج من الحجر بسبب مسجَّل يغلق الحادثة ويصفّر العدّاد', () => {
  const { warden, incidents } = setup();
  const outcome = warden.report({ kind: 'identity-unverified', subject: 'agent:5' });
  assert.throws(
    () => warden.release('agent:5', '  '),
    (error) =>
      /** @type {{ code: string }} */ (error).code === QUARANTINE_ERRORS.RELEASE_REASON_REQUIRED,
  );
  assert.throws(
    () => warden.release('agent:404', 'سبب'),
    (error) => /** @type {{ code: string }} */ (error).code === QUARANTINE_ERRORS.NOT_QUARANTINED,
  );
  const incidentId = outcome.incidentId;
  assert.ok(incidentId !== null, 'العزل يفتح حادثة بمعرّف');
  const released = warden.release('agent:5', 'انتهى التحقيق: شهادة أُعيد إصدارها');
  assert.equal(released.incidentId, incidentId);
  assert.equal(warden.isQuarantined('agent:5'), false);
  assert.equal(incidents.get(incidentId)?.state, 'closed');
  assert.equal(warden.list().length, 0);
});

test('عتبةٌ مُمرَّرة تتغلّب على المعلَنة، والحاجب يرفض الإنشاء بلا سجل حوادث', () => {
  const incidents = new IncidentRegister({});
  const warden = new QuarantineWarden({
    incidents,
    log: memoryLog(),
    thresholds: { 'egress-refused': 1 },
  });
  assert.equal(warden.thresholdFor('egress-refused'), 1);
  assert.equal(warden.report({ kind: 'egress-refused', subject: 'agent:6' }).isolated, true);
  assert.throws(
    () => new QuarantineWarden({ log: memoryLog() }),
    (error) =>
      /** @type {{ code: string }} */ (error).code === QUARANTINE_ERRORS.DEPENDENCY_MISSING,
  );
});

// ── WL-556: دُمِجَ هنا `tests/governance/law-system.test.mjs` حرفيّاً (‏أجسامُ الاختباراتِ ومساعداتُها كما هي؛ أُضيفت استيراداتُه الجديدةُ وحدَها) لتوفيرِ ملفٍّ تحتَ G1. ──
/** @returns {LawRegistry} */
function registry(log = new EventLog()) {
  return new LawRegistry({ log, repository: createMemoryRepository(LawRegistry.spec) });
}

/**
 * يُنفِّذ قانوناً في المستودع مباشرةً مع ربطِه بمادةٍ وسياسة. الربطُ شرطُ نفاذٍ
 * بعد `M8.02` (ثابتُ `LAW_ENACTED_REQUIRES_BINDING` وقيدُ الهجرة 0011)، والمسارُ
 * السياديُّ الكاملُ (أمرٌ ملكيٌّ وكشفُ تعارض) يُختبر في `tests/legislation/`.
 * هنا يُكتفى بحالةٍ نافذةٍ صحيحةٍ كي تُختبر ما بعدها من انتقالات.
 * @param {LawRegistry} r
 * @param {string} id
 * @returns {Promise<Record<string, unknown>>}
 */
async function bind(r, id) {
  const row = await r.repository.findById(id);
  if (row === null) throw new Error('LAW_NOT_FOUND');
  return r.repository.update(id, Number(row['version']), {
    state: LawState.ENACTED,
    articleId: 'art:05',
    policyIds: ['pol:test'],
    enactedBy: 'crown',
    enactedAt: new Date(),
    stateChangedAt: new Date(),
  });
}

test('law requires crown for enactment and is versioned', async () => {
  const r = registry(),
    l = await r.propose({
      title: 'safe operation',
      text: 'stop on uncertainty',
      scope: 'operations',
      proposer: 'council',
    });
  assert.equal(l.state, LawState.DRAFT);
  assert.equal(l.version, 1);
  await r.transition(l.id, LawState.PROPOSED, 'council');
  await assert.rejects(
    () => r.transition(l.id, LawState.ENACTED, 'ministry'),
    /CROWN_APPROVAL_REQUIRED/,
  );
  // بعد `M8.02` لم يبقَ النفاذُ انتقالَ حالة: حتى مع كتابة الحرف «crown» يُردّ
  // الانتقالُ إلى `enacted` بلا ربطٍ بمادةٍ وسياسة، والطريقُ `Legislature.enact`.
  await assert.rejects(
    () => r.transition(l.id, LawState.ENACTED, 'crown'),
    /LAW_ENACTMENT_PATH_REQUIRED/,
  );
  const e = await bind(r, l.id);
  assert.equal(e['state'], LawState.ENACTED);
  // النسخة أثرٌ لا وصف: الاقتراح ثم انتقالان يعنيان ثلاث كتابات.
  assert.equal(e['version'], 3);
  assert.equal(e['enactedBy'], 'crown');
  assert.ok(e['enactedAt'] instanceof Date, 'النفاذ فعلٌ مؤرَّخ');
  assert.equal((await r.active('operations')).length, 1);
});

test('repealed law cannot be changed', async () => {
  const r = registry(),
    l = await r.propose({ title: 'x', text: 'x', scope: 'x', proposer: 'council' });
  // الإلغاء لا يقع على ما لم يَنفُذ: هذا تضييق `M3.05` وقيدٌ في القاعدة معاً.
  await assert.rejects(() => r.transition(l.id, LawState.REPEALED, 'crown'), /LAW_NOT_ENACTED_YET/);
  await bind(r, l.id);
  const repealed = await r.transition(l.id, LawState.REPEALED, 'crown');
  assert.ok(repealed.repealedAt instanceof Date, 'الإلغاء يُؤرَّخ');
  await assert.rejects(
    () => r.transition(l.id, LawState.ENACTED, 'crown'),
    /REPEALED_LAW_IMMUTABLE/,
  );
  assert.equal((await r.active('x')).length, 0);
});
