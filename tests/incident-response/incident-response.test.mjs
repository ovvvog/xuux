// اختبارُ وحدةِ مسارِ الاستجابةِ للحوادثِ (`M10.03`).
//
// ومَحَلُّ القياسِ هنا **الوثيقةُ وفحوصُ تماسكِها والدوالُّ الخالصة**: أنّ
// وثيقةً مخالفةً توقف التحميلَ ولا تُستكمَل بافتراضٍ، وأنّ جدولَ المناوبةِ
// يُغطّي دورتَه كلَّها بلا ثقبٍ ولا تراكب، وأنّ حكمَ القاعدةِ يُشتَقُّ من صفِّ
// اللوحةِ لا من ظنٍّ في الكود، وأنّ كلَّ رمزِ رفضٍ مُعلَنٍ في الوثيقةِ له موضعٌ
// في الكودِ وكلَّ رمزٍ في الكودِ مُعلَنٌ في الوثيقة.
//
// **حدٌّ معلَن:** مسارُ التمرينِ الكاملِ (تنبيهٌ ⇒ استجابةٌ ⇒ تقريرٌ) لا يُقاس
// هنا بل في `tests/incident-response/drill.test.mjs` على تركيبٍ حقيقيٍّ بسجلٍّ
// على القرص — فاختبارُ الوحدةِ لا يُغني عن اختبارِ القبول، ولا يُقاس بمثيلٍ
// مصنوعٍ ما وُعِد به عن التركيب.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import YAML from 'yaml';

import {
  IR_ERRORS,
  IR_SECTIONS,
  IncidentResponse,
  IncidentResponseError,
  assertRotationCovers,
  evaluateRules,
  loadIncidentResponsePolicy,
  responderAt,
} from '../../src/incident-response/index.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const POLICY = loadIncidentResponsePolicy({ dir: CONFIG_DIR });
const RAW = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'incident-response.yaml'), 'utf8'));

/**
 * يُحمِّل نسخةً مُحوَّلةً من الوثيقةِ في مجلَّدٍ مؤقّتٍ بمخطَّطِها نفسِه، فيُقاس
 * أنّ **الفحصَ هو الذي رَدَّ** لا أنّ الملفَّ غاب.
 *
 * @param {(document: Record<string, any>) => void} mutate
 * @returns {() => void}
 */
function loadMutated(mutate) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-ir-config-'));
  fs.mkdirSync(path.join(directory, 'schemas'));
  const document = structuredClone(RAW);
  mutate(document);
  fs.writeFileSync(path.join(directory, 'incident-response.yaml'), YAML.stringify(document));
  fs.copyFileSync(
    path.join(CONFIG_DIR, 'schemas', 'incident-response.schema.json'),
    path.join(directory, 'schemas', 'incident-response.schema.json'),
  );
  // ووثيقةُ مستوياتِ الخدمةِ تُنقل كما هي: الفحصُ المقيسُ هو **التحويلُ** وحدَه،
  // فلو نقص ملفٌّ لسقط التحميلُ لسببٍ آخرَ وقُرئ الاختبارُ أخضرَ بلا مقياس.
  fs.copyFileSync(
    path.join(CONFIG_DIR, 'service-levels.yaml'),
    path.join(directory, 'service-levels.yaml'),
  );
  return () => loadIncidentResponsePolicy({ dir: directory });
}

/** @param {unknown} error @param {string} code @returns {boolean} */
function hasCode(error, code) {
  return /** @type {{ code?: string }} */ (error).code === code;
}

// ── الوثيقةُ وفحوصُ تماسكِها ──

test('الوثيقةُ النافذةُ تُحمَّل، وكلُّ رمزٍ فيها له موضعٌ في الكودِ والعكس', () => {
  assert.equal(POLICY.version, 1);
  assert.deepEqual(
    [...POLICY.refusalCodes].sort(),
    [...Object.values(IR_ERRORS)].sort(),
    'رموزُ الوثيقةِ ورموزُ الكودِ ليست الطائفةَ نفسَها في الاتجاهين.',
  );
  assert.ok(POLICY.rules.length > 0);
  for (const rule of POLICY.rules) {
    assert.ok(
      POLICY.severities.some((severity) => severity.id === rule.severity),
      `درجةُ القاعدة ${rule.id} غيرُ مُعلَنة.`,
    );
  }
});

test('وثيقةٌ غائبةٌ توقف التحميلَ ولا تُستكمَل بقواعدَ افتراضية', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-ir-empty-'));
  assert.throws(
    () => loadIncidentResponsePolicy({ dir: directory }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.CONFIG_INVALID),
  );
});

test('مخطَّطٌ غائبٌ يوقف التحميلَ: إعلانُ قاعدةٍ بلا مخطَّطٍ نصٌّ حرٌّ كالعُرفِ الذي جاءت لتمنعه', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-ir-noschema-'));
  fs.copyFileSync(
    path.join(CONFIG_DIR, 'incident-response.yaml'),
    path.join(directory, 'incident-response.yaml'),
  );
  assert.throws(
    () => loadIncidentResponsePolicy({ dir: directory }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.CONFIG_INVALID),
  );
});

test('رمزٌ مُعلَنٌ في الوثيقةِ بلا موضعٍ في الكودِ يوقف التحميل — ووعدُ رفضٍ لا يُنفَّذ أسوأُ من غيابِه', () => {
  const load = loadMutated((document) => {
    document.refusalCodes.push('IR_A_PROMISE_WITH_NO_CODE');
  });
  assert.throws(load, (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.CONFIG_INVALID));
});

test('رمزٌ يُرفع في الكودِ ولا يُعلَنُ في الوثيقةِ يوقف التحميل — ورفضٌ لا يجده قارئُ الوثيقةِ رفضٌ لا يُتوقَّع', () => {
  const load = loadMutated((document) => {
    document.refusalCodes = document.refusalCodes.filter(
      (/** @type {string} */ code) => code !== IR_ERRORS.ROTATION_GAP,
    );
  });
  assert.throws(load, (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.CONFIG_INVALID));
});

test('مهلةُ تصعيدٍ قبل مهلةِ الإقرارِ توقف التحميل: من يُصعِّد قبل أن يُمهِل يُصعِّد إلى من لم يُبلَّغ', () => {
  const load = loadMutated((document) => {
    const critical = document.severities.find(
      (/** @type {{ id: string }} */ severity) => severity.id === 'severity:critical',
    );
    critical.escalateAfterMs = critical.acknowledgeWithinMs - 1;
  });
  assert.throws(load, (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.CONFIG_INVALID));
});

test('قاعدةٌ على هدفٍ غيرِ مُعلَنٍ في مستوياتِ الخدمةِ توقف التحميل — لا تنبيهَ عن عهدٍ لم يُقطَع', () => {
  const load = loadMutated((document) => {
    document.rules[0].objective = 'slo:a.promise.nobody.made';
  });
  assert.throws(load, (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.CONFIG_INVALID));
});

test('كلُّ ضمانةٍ مُعلَنةٍ لها ملفٌّ موجودٌ يذكر رموزَها نصّاً — والضمانةُ بلا موضعِ تنفيذٍ إعلانٌ', () => {
  // **حدٌّ معلَن:** الرَدُّ على وثيقةٍ مُحوَّلةٍ هنا مَحَلُّه حاجزُ البوابة
  // (`scripts/guard-incident-response.mjs` قاعدةُ R4) لأن الفحصَ **نصّيٌّ على
  // ملفاتِ المستودع** لا تماسُكٌ داخلَ الوثيقة، والمُحمِّلُ لا يقرأ شجرةَ
  // المستودعِ في زمنِ التشغيل. والمقيسُ هنا الحالُ الواقعُ نفسُه على الوثيقةِ
  // النافذة، فلو انفصلت ضمانةٌ عن موضعِ تنفيذِها سقط هذا الاختبارُ قبل الحاجز.
  assert.ok(POLICY.guarantees.length > 0, 'وثيقةٌ بلا ضماناتٍ وثيقةٌ لا تَعِد بشيءٍ يُحاسَب عليه.');
  for (const guarantee of POLICY.guarantees) {
    const file = path.join(process.cwd(), guarantee.enforcedBy);
    assert.ok(
      fs.existsSync(file),
      `ملفُّ تنفيذِ الضمانة ${guarantee.id} غائبٌ: ${guarantee.enforcedBy}`,
    );
    const source = fs.readFileSync(file, 'utf8');
    for (const code of guarantee.codes) {
      assert.ok(
        source.includes(code.replace(/^IR_/, '')),
        `الضمانة ${guarantee.id} تَعِد بالرمز ${code} وملفُّها ${guarantee.enforcedBy} لا يذكره.`,
      );
    }
  }
});

test('قسمٌ لازمٌ خارجَ أقسامِ التقريرِ المُعلَنةِ في الكودِ يوقف التحميل', () => {
  const load = loadMutated((document) => {
    document.review.requiredSections[0].id = 'section:whatever';
  });
  assert.throws(load, (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.CONFIG_INVALID));
  assert.deepEqual(
    [...POLICY.review.requiredSections.map((section) => section.id)].sort(),
    [...IR_SECTIONS].sort(),
  );
});

// ── جدولُ المناوبة: دالّةٌ خالصةٌ لا تقرأ ساعةً ولا تكتب سجلّاً ──

test('جدولُ المناوبةِ النافذُ يُغطّي دورتَه كلَّها بلا ثقبٍ ولا تراكب', () => {
  assertRotationCovers(POLICY.rotation);
  const cycleMs = POLICY.rotation.cycleMs;
  // العيّنةُ على حدودِ المناوباتِ نفسِها لا على أرقامٍ اعتباطية: الحدُّ هو موضعُ
  // الخطأِ المعتاد (طرفٌ مفتوحٌ يُحسَب مرّتين أو لا يُحسَب أصلاً).
  for (const shift of POLICY.rotation.shifts) {
    for (const atMs of [shift.startMs, shift.endMs - 1]) {
      const resolved = responderAt(POLICY.rotation, atMs);
      assert.equal(resolved.shift, shift.id, `اللحظة ${atMs} خرجت من مناوبتِها ${shift.id}.`);
      assert.equal(resolved.responder, shift.responder);
    }
  }
  // والدورةُ دوريّةٌ فعلاً: لحظةٌ بعد دورةٍ كاملةٍ لها مستجيبُ نظيرتِها.
  assert.equal(
    responderAt(POLICY.rotation, 1_234).responder,
    responderAt(POLICY.rotation, 1_234 + cycleMs * 3).responder,
  );
  // ولحظةٌ سالبةٌ لا تُخرِج الجدولَ عن دورتِه.
  assert.equal(
    responderAt(POLICY.rotation, -1).responder,
    responderAt(POLICY.rotation, cycleMs - 1).responder,
  );
});

test('ثقبٌ في الدورةِ يُرَدُّ برمزٍ مُعلَن — ولحظةٌ بلا مستجيبٍ صمتٌ يُسمّى تغطية', () => {
  assert.throws(
    () =>
      assertRotationCovers({
        statement: 'جدولٌ مصنوعٌ للقياسِ وحدَه',
        cycleMs: 100,
        shifts: [
          { id: 'shift:a', startMs: 0, endMs: 40, responder: 'contact:a', purpose: 'أ' },
          { id: 'shift:b', startMs: 60, endMs: 100, responder: 'contact:b', purpose: 'ب' },
        ],
      }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.ROTATION_GAP),
  );
});

test('تراكبُ مناوبتينِ يُرَدُّ: لحظةٌ لها مستجيبانِ لحظةٌ لا مالكَ لها', () => {
  assert.throws(
    () =>
      assertRotationCovers({
        statement: 'جدولٌ مصنوعٌ للقياسِ وحدَه',
        cycleMs: 100,
        shifts: [
          { id: 'shift:a', startMs: 0, endMs: 70, responder: 'contact:a', purpose: 'أ' },
          { id: 'shift:b', startMs: 60, endMs: 100, responder: 'contact:b', purpose: 'ب' },
        ],
      }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.ROTATION_GAP),
  );
});

// ── حكمُ القاعدة: من صفِّ اللوحةِ لا من ظنٍّ في الكود ──

/**
 * لوحةٌ مصنوعةٌ **للوحدةِ فقط**: صفوفٌ بأشكالِ صفوفِ `M10.02` كي يُقاس اشتقاقُ
 * الحكمِ من الصفِّ وحدَه. والقياسُ على لوحةٍ حقيقيةٍ في اختبارِ القبول.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {number} [ageMs]
 */
function board(rows, ageMs = 10_000) {
  const document = {
    generatedAtMs: 1_000,
    window: { scope: 'process', ageMs },
    capabilities: [{ id: 'capability:api-call', statement: 'x', objectives: rows }],
    summary: {
      objectives: rows.length,
      meeting: 0,
      breaching: 0,
      unmeasured: 0,
      budgetsExhausted: 0,
    },
  };
  return /** @type {never} */ (/** @type {unknown} */ (document));
}

/** @param {Record<string, any>} overrides */
function row(overrides) {
  return {
    id: 'slo:api.availability',
    kind: 'availability',
    status: 'meeting',
    target: 0.995,
    thresholdMs: null,
    measured: 1,
    deviation: 0.005,
    events: { total: 10, good: 10, bad: 0 },
    errorBudget: {
      allowed: 1,
      consumed: 0,
      remaining: 1,
      consumedRatio: 0,
      exhausted: false,
    },
    ...overrides,
  };
}

/** @param {string} id */
function ruleOf(id) {
  const rule = POLICY.rules.find((entry) => entry.id === id);
  assert.ok(rule !== undefined, `القاعدة ${id} غائبةٌ عن الوثيقة.`);
  return rule;
}

test('حكمُ الانكسارِ يُشتَقُّ من حالةِ الصفِّ لا من رقمٍ يُعاد حسابُه في القاعدة', () => {
  const rule = ruleOf('alert:api-availability-breaching');
  const firing = evaluateRules({ rules: [rule], dashboard: board([row({ status: 'breaching' })]) });
  assert.equal(firing[0]?.firing, true);
  const quiet = evaluateRules({ rules: [rule], dashboard: board([row({ status: 'meeting' })]) });
  const quietFirst = quiet[0];
  assert.ok(quietFirst, 'القاعدةُ الساكتةُ لم تُعَد في المُخرَج.');
  assert.equal(quietFirst.firing, false);
  assert.ok(
    quietFirst.reason.length > 20,
    'القاعدةُ الساكتةُ لم تُعلِّل سكوتَها — و«لا شيء» ليس جواباً.',
  );
});

test('استنفادُ الميزانيةِ قاعدةٌ مستقلّةٌ عن الانكسار: مستوفٍ بميزانيةٍ فرغت مستوفٍ إلى نهايةِ النافذةِ فقط', () => {
  const rule = ruleOf('alert:api-availability-budget-exhausted');
  const exhausted = row({
    status: 'meeting',
    errorBudget: { allowed: 1, consumed: 1, remaining: 0, consumedRatio: 1, exhausted: true },
  });
  assert.equal(evaluateRules({ rules: [rule], dashboard: board([exhausted]) })[0]?.firing, true);
  assert.equal(
    evaluateRules({ rules: [rule], dashboard: board([row({})]) })[0]?.firing,
    false,
    'ميزانيةٌ لم تفرغ أشعلت قاعدةَ استنفاد.',
  );
});

test('غيابُ القياسِ يُنبَّه عليه بعد مهلةِ إمهالٍ مُعلَنةٍ — والصمتُ إشارةٌ لا غيابَ إشارة', () => {
  const rule = ruleOf('alert:api-availability-unmeasured');
  assert.equal(
    typeof rule.graceMs,
    'number',
    'قاعدةُ غيابِ القياسِ بلا مهلةِ إمهالٍ مُعلَنة — والمخطَّطُ يُلزِم بها.',
  );
  const graceMs = /** @type {number} */ (rule.graceMs);
  const unmeasured = row({
    status: 'unmeasured',
    measured: null,
    events: { total: 0, good: 0, bad: 0 },
  });
  const early = evaluateRules({
    rules: [rule],
    dashboard: board([unmeasured], graceMs - 1),
  });
  assert.equal(
    early[0]?.firing,
    false,
    'نُبِّه على غيابِ قياسٍ قبل انقضاءِ الإمهالِ فصار الضجيجُ قاعدة.',
  );
  const late = evaluateRules({ rules: [rule], dashboard: board([unmeasured], graceMs + 1) });
  assert.equal(
    late[0]?.firing,
    true,
    'مضى الإمهالُ ولا قياسَ ولم يُنبَّه — وهذا بعينُه عيبُ M10.02: «غيرُ مقيسٍ» يبقى صامتاً إلى الأبد.',
  );
});

test('قاعدةٌ على هدفٍ غائبٍ عن اللوحةِ تُرَدُّ برمزٍ مُعلَنٍ ولا تُقرأ سكوتاً', () => {
  const rule = ruleOf('alert:api-availability-breaching');
  assert.throws(
    () => evaluateRules({ rules: [rule], dashboard: board([row({ id: 'slo:something.else' })]) }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.OBJECTIVE_UNDECLARED),
  );
});

// ── التبعياتُ والساعة: لا مسارَ استجابةٍ بلا سجلٍّ ولا بلا لوحةٍ ولا بساعةٍ مجهولة ──

test('الوحدةُ تُرَدُّ عند بنائِها بلا وثيقة، وتُرَدُّ عند العملِ بلا سجلٍّ أو لوحةٍ أو مركزِ عمليات', () => {
  assert.throws(
    () => new IncidentResponse({ policy: /** @type {never} */ ({ version: 1, rules: [] }) }),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.POLICY_REQUIRED),
  );
  const bare = new IncidentResponse({ policy: POLICY, nowMs: () => 1_000 });
  assert.throws(
    () => bare.evaluate({}),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.AUDIT_REQUIRED),
  );
  const logged = new IncidentResponse({
    policy: POLICY,
    nowMs: () => 1_000,
    log: /** @type {never} */ ({ append: () => undefined }),
  });
  assert.throws(
    () => logged.evaluate({}),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.SERVICE_LEVELS_REQUIRED),
  );
  const levelled = new IncidentResponse({
    policy: POLICY,
    nowMs: () => 1_000,
    log: /** @type {never} */ ({ append: () => undefined }),
    serviceLevels: /** @type {never} */ ({ dashboard: () => board([]) }),
  });
  assert.throws(
    () => levelled.evaluate({}),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.OPERATIONS_REQUIRED),
  );
});

test('ساعةٌ لا تُرجِع رقماً محدوداً تُرَدُّ — ووقتٌ مجهولٌ يُحوِّل كلَّ مهلةٍ إلى ظنّ', () => {
  const broken = new IncidentResponse({
    policy: POLICY,
    nowMs: () => /** @type {never} */ (Number.NaN),
  });
  assert.throws(
    () => broken.onCall(),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.CLOCK_INVALID),
  );
});

test('وصفُ الوحدةِ يُعلِن ما حُمِّل لا ما يُرجى: كلُّ معرّفٍ فيه من الوثيقة', () => {
  const engine = new IncidentResponse({ policy: POLICY, nowMs: () => 1_000 });
  const described = engine.describe();
  assert.deepEqual(
    described.rules,
    POLICY.rules.map((rule) => rule.id),
  );
  assert.deepEqual(
    described.severities,
    POLICY.severities.map((severity) => severity.id),
  );
  assert.deepEqual(
    described.shifts,
    POLICY.rotation.shifts.map((shift) => shift.id),
  );
  assert.deepEqual(
    described.ladder,
    POLICY.escalation.ladder.map((tier) => tier.contact),
  );
  assert.equal(described.cycleMs, POLICY.rotation.cycleMs);
  assert.equal(described.openAlerts, 0);
  assert.equal(engine.alert('alert:api-availability-breaching'), null);
  assert.throws(
    () => engine.alert('alert:nope'),
    (/** @type {unknown} */ error) => hasCode(error, IR_ERRORS.RULE_UNDECLARED),
  );
});

test('خطأُ الوحدةِ يحمل رمزَه ومَحَلَّه: رسالةٌ بلا رمزٍ لا يُبنى عليها قرار', () => {
  const error = new IncidentResponseError(IR_ERRORS.ALERT_UNKNOWN, 'تنبيهٌ مجهول', { alert: 'x' });
  assert.equal(error.code, IR_ERRORS.ALERT_UNKNOWN);
  assert.equal(error.name, 'IncidentResponseError');
  assert.deepEqual(error.detail, { alert: 'x' });
  assert.ok(error instanceof Error);
});
