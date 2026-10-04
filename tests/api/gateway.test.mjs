// اختبارُ قبولِ الخطوة M9.02: **نداءٌ بلا مصادقةٍ أو بلا تفويضٍ يُرفض ويُسجَّل**.
//
// و«يُرفض ويُسجَّل» جملةٌ بشقّين، وكلُّ شقٍّ يفشل وحدَه إن انكسر: الرفضُ يُقاس
// برمزِه المُعلَنِ لا بمجرّدِ رميِ خطأ، والتسجيلُ يُقاس بقيدٍ في سجلِّ الأحداثِ
// يحمل ذلك الرمزَ نفسَه. فرفضٌ صامتٌ ليس رفضاً محكوماً: من رُفض ولم يُكتب رفضُه
// لا يُعرَف أنه حاول.
//
// وتُقاس معه أركانُ الطبقةِ الخمسة بترتيبِها المُعلَن:
//   ١. **مسارٌ معلَن** — اسمٌ يخترعه المُنادي لا وجودَ له (`API_ROUTE_UNKNOWN`).
//   ٢. **مصادقةٌ** — بلا رمزٍ، أو برمزٍ مجهولٍ، أو برمزٍ انتهت مهلتُه، أو بهويةٍ
//      عُلِّقت **بعد** فتحِ جلستِها. والمهلةُ لا تُمدَّد بالاستعمال.
//   ٣. **حدُّ معدَّلٍ يَعُدُّ المرفوض** — وهذا هو الشقُّ الذي يسهل أن يُكتب خطأً:
//      يُقاس بأن نداءاتٍ **مرفوضةً** وحدَها تستنفد الحدّ.
//   ٤. **نقطةُ التفويضِ المركزيةُ وحدها** — دورٌ بلا قدرةٍ يُرفض
//      (`API_AUTHORIZATION_DENIED`) بقرارِ الحزمةِ الحقيقيةِ لا بحكمِ البوابة،
//      وتذكرةُ القرارِ تُستهلَك مرّةً واحدة.
//   ٥. **الفشلُ مغلق (المادة 9)** — بلا سجلٍّ لا نداءَ، وبلا نقطةِ تفويضٍ لا
//      نداءَ، وبلا وكيلِ مراقبةٍ لا قراءةَ. والنقصُ رفضٌ لا سماح.
//
// والمكوّناتُ **حقيقيةٌ**: نقطةُ تفويضٍ على حزمةِ السياساتِ النافذةِ من القرص،
// ووكيلُ مراقبةٍ على وثيقةِ المراقبةِ النافذة، ومستودعاتٌ حقيقيةُ الواجهة، وسجلُّ
// أحداثٍ حقيقيّ. فما يُقاس هنا حكمُ النظامِ لا حكمُ مزيَّفٍ صُنع ليوافق.
//
// **حدٌّ معلَن:** المستودعاتُ ذاكريةٌ لا PostgreSQL، وسجلُّ الهوياتِ يُمثَّل
// بقارئٍ يُرجِع صفوفاً مصنوعةً كي تُقاس حالاتُ الهويةِ (معلَّقٌ، بدورٍ آخر) بلا
// إصدارِ شهادةٍ لكلِّ حالة — وسلامةُ الإصدارِ مقيسةٌ في `tests/identity`. وليس
// هنا نقلٌ شبكيّ: البوابةُ نداءٌ داخليٌّ، وأمنُ النقلِ خارجَ ما تدّعيه الخطوة.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { API_ERRORS, ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });

const AUDITOR = 'agent:api-auditor';
const SUSPENDED = 'agent:api-suspended';
const MINISTER = 'human:api-minister';
const KING = 'human:api-king';

/**
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(/** @type {{ code: unknown }} */ (error).code)
    : `بلا رمز: ${String(error)}`;
}

/**
 * @param {() => Promise<unknown>} work
 * @param {string} expected
 * @param {string} what
 */
async function refuses(work, expected, what) {
  try {
    await work();
    assert.fail(`${what}: مرّ ولم يُرفض — والمرورُ هنا هو العيبُ نفسُه.`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.equal(codeOf(error), expected, `${what}: رُفض برمزٍ آخر`);
  }
}

/**
 * دولةٌ مصغَّرةٌ ببوابةٍ حقيقيةٍ على مكوّناتٍ حقيقية.
 * @param {object} [options]
 * @param {boolean} [options.withLog]
 * @param {boolean} [options.withAgents]
 * @param {boolean} [options.withMonitor]
 * @param {boolean} [options.withEnforcement]
 * @param {Record<string, Record<string, unknown>>} [options.identities]
 * @param {{ current: Date }} [options.clock]
 */
function state(options = {}) {
  const { withLog = true, withAgents = true, withMonitor = true, withEnforcement = true } = options;
  const clock = options.clock ?? { current: new Date('2026-08-30T00:00:00.000Z') };
  const log = new EventLog();
  const repositories = createMemoryRepositories();
  /** @type {Record<string, Record<string, unknown>>} */
  const identities = options.identities ?? {
    [AUDITOR]: {
      id: AUDITOR,
      kind: 'service',
      state: 'active',
      role: MONITORING_POLICY.role,
      capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
    },
    [SUSPENDED]: {
      id: SUSPENDED,
      kind: 'service',
      state: 'suspended',
      role: MONITORING_POLICY.role,
      capabilities: ['action:read-registry'],
    },
    [MINISTER]: {
      id: MINISTER,
      kind: 'human',
      state: 'active',
      role: 'role:minister',
      capabilities: ['action:read-registry', 'action:read-memory'],
    },
    // والملكُ **ليس** في قائمةِ المأذونين بفعلِ `read-registry` في
    // `config/policies.yaml`، ولا القدرةُ في دورِه بـ`config/roles.yaml`. فهو
    // هنا حالةُ المنعِ المركزيِّ الحقيقية، لا حالةٌ مُختلَقةٌ بدورٍ لا وجودَ له.
    [KING]: {
      id: KING,
      kind: 'human',
      state: 'active',
      role: 'role:king',
      capabilities: ['sovereign:command'],
    },
  };
  const agents = {
    /** @param {string} id */
    get: async (id) => identities[id] ?? null,
  };
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: API_POLICY,
    log: withLog ? log : null,
    agents: withAgents ? agents : null,
    monitor: withMonitor ? monitor : null,
    enforcementPoint: withEnforcement ? enforcementPointFor(log) : null,
    now: () => clock.current,
    requirePoP: false, // اختباراتٌ بلا إثباتِ حيازةٍ
  });
  return { gateway, log, repositories, identities, clock };
}

/**
 * @param {EventLog} log
 * @returns {ReadonlyArray<{ type: string, actor: string, data: Record<string, unknown> }>}
 */
function events(log) {
  return /** @type {never} */ (log.snapshot());
}

/**
 * @param {EventLog} log
 * @param {string} code
 * @returns {boolean}
 */
function refusalLogged(log, code) {
  return events(log).some(
    (entry) => entry.type === API_POLICY.audit.refusalEvent && entry.data['code'] === code,
  );
}

test('نداءٌ بلا رمزِ جلسةٍ يُرفض ويُسجَّل — وهذا نصُّ قبولِ الخطوة', async () => {
  const { gateway, log } = state();
  await refuses(
    () => gateway.call({ route: 'state.agents.list' }),
    API_ERRORS.AUTH_REQUIRED,
    'نداءٌ بلا رمز',
  );
  assert.ok(
    refusalLogged(log, API_ERRORS.AUTH_REQUIRED),
    'رُفض ولم يُسجَّل رفضُه؛ ورفضٌ لا أثرَ له لا يُعرَف أنّ صاحبَه حاول.',
  );
});

test('نداءٌ بلا تفويضٍ يُرفض بقرارِ النقطةِ المركزيةِ ويُسجَّل', async () => {
  const { gateway, log } = state();
  // هويةٌ نشطةٌ فتُفتح لها جلسةٌ — والرفضُ يقع عند التفويضِ لا عند المصادقة،
  // وهذا هو الفصلُ الذي تقيسه هذه الحالة.
  const session = await gateway.openSession({ actorId: KING });
  await refuses(
    () => gateway.call({ route: 'state.cases.list', token: session.token }),
    API_ERRORS.AUTHORIZATION_DENIED,
    'دورٌ بلا قدرةِ القراءةِ المحكومة',
  );
  assert.ok(refusalLogged(log, API_ERRORS.AUTHORIZATION_DENIED), 'الرفضُ لم يُسجَّل');
  assert.ok(
    events(log).some((entry) => entry.type === 'policy.decision'),
    'لم يُسجَّل قرارُ سياسةٍ؛ فالبوابةُ قرَّرت بنفسِها بدل أن تسأل النقطةَ المركزية.',
  );
});

test('قيدُ النداءِ يسبق قرارَ التفويض', async () => {
  const { gateway, log } = state();
  const session = await gateway.openSession({ actorId: KING });
  await gateway.call({ route: 'state.cases.list', token: session.token }).catch(() => {});
  const types = events(log).map((entry) => entry.type);
  const callIndex = types.indexOf(API_POLICY.audit.callEvent);
  const decisionIndex = types.indexOf('policy.decision');
  assert.ok(callIndex >= 0, 'لا قيدَ للنداء');
  assert.ok(decisionIndex >= 0, 'لا قيدَ للقرار');
  assert.ok(
    callIndex < decisionIndex,
    'القيدُ جاء بعد القرار؛ وأثرٌ يُكتب بعد السؤال يضيع إن أخفق السؤالُ نفسُه.',
  );
});

test('قراءةٌ مفوَّضةٌ تمرّ وتُعيد بياناتٍ مُجمَّدة، ولا يُعاد الرمز', async () => {
  const { gateway, log } = state();
  const session = await gateway.openSession({ actorId: AUDITOR });
  const result = await gateway.call({
    route: 'state.agents.list',
    token: session.token,
    params: { limit: 5 },
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.route, 'state.agents.list');
  assert.ok(Object.isFrozen(result), 'المُعادُ غيرُ مُجمَّد');
  assert.equal(result.session, session.sessionId);
  assert.ok(
    !JSON.stringify(result).includes(session.token),
    'الرمزُ عاد في جسمِ الجواب؛ وسرٌّ يُعاد في كلِّ جوابٍ سرٌّ يُسرَّب بأولِ سجلٍّ يُطبع.',
  );
  assert.ok(
    events(log).some(
      (entry) =>
        entry.type === API_POLICY.audit.callEvent && entry.data['route'] === 'state.agents.list',
    ),
    'النداءُ الناجحُ لم يُسجَّل',
  );
  assert.ok(
    events(log).every((entry) => !JSON.stringify(entry.data).includes(session.token)),
    'الرمزُ كُتب في سجلِّ التدقيق؛ والسجلُّ يُقرأ من مواضعَ كثيرةٍ فيصير خزانةَ أسرار.',
  );
});

test('مسارٌ غيرُ مُعلَنٍ لا وجودَ له', async () => {
  const { gateway, log } = state();
  const session = await gateway.openSession({ actorId: AUDITOR });
  await refuses(
    () => gateway.call({ route: 'state.agents.delete', token: session.token }),
    API_ERRORS.ROUTE_UNKNOWN,
    'اسمٌ اخترعه المُنادي',
  );
  assert.ok(refusalLogged(log, API_ERRORS.ROUTE_UNKNOWN), 'الرفضُ لم يُسجَّل');
});

test('الجلسةُ تنتهي بمهلتِها ولا تُمدَّد بالاستعمال', async () => {
  const clock = { current: new Date('2026-08-30T00:00:00.000Z') };
  const { gateway, log } = state({ clock });
  const session = await gateway.openSession({ actorId: AUDITOR });
  // استعمالٌ متكرِّرٌ داخلَ المهلة: لو كانت المهلةُ تُمدَّد بالنداءِ لبقيت الجلسةُ
  // حيّةً بعد المهلةِ الأصلية، وهذا ما تنفيه هذه الحالة.
  for (let minute = 1; minute <= 14; minute += 1) {
    clock.current = new Date(Date.parse('2026-08-30T00:00:00.000Z') + minute * 60_000);
    await gateway.call({ route: 'state.agents.count', token: session.token });
  }
  clock.current = new Date(Date.parse('2026-08-30T00:00:00.000Z') + 901_000);
  await refuses(
    () => gateway.call({ route: 'state.agents.count', token: session.token }),
    API_ERRORS.SESSION_EXPIRED,
    'جلسةٌ انتهت مهلتُها',
  );
  assert.ok(refusalLogged(log, API_ERRORS.SESSION_EXPIRED), 'الانتهاءُ لم يُسجَّل');
});

test('رمزٌ مجهولٌ ورمزٌ مُغلَقٌ يُرفضان', async () => {
  const { gateway } = state();
  await refuses(
    () => gateway.call({ route: 'state.agents.count', token: 'ليس-برمز' }),
    API_ERRORS.SESSION_INVALID,
    'رمزٌ مجهول',
  );
  const session = await gateway.openSession({ actorId: AUDITOR });
  assert.equal(gateway.closeSession(session.token), true);
  await refuses(
    () => gateway.call({ route: 'state.agents.count', token: session.token }),
    API_ERRORS.SESSION_INVALID,
    'رمزٌ أُغلقت جلستُه',
  );
});

test('هويةٌ عُلِّقت بعد فتحِ جلستِها لا تُنادي بها', async () => {
  /** @type {Record<string, Record<string, unknown>>} */
  const identities = {
    [AUDITOR]: {
      id: AUDITOR,
      kind: 'service',
      state: 'active',
      role: MONITORING_POLICY.role,
      capabilities: ['action:read-registry'],
    },
  };
  const { gateway, log } = state({ identities });
  const session = await gateway.openSession({ actorId: AUDITOR });
  const auditorRow = identities[AUDITOR];
  assert.ok(auditorRow, 'هويةُ المدقّقِ شرطُ هذا القياس');
  auditorRow['state'] = 'suspended';
  await refuses(
    () => gateway.call({ route: 'state.agents.count', token: session.token }),
    API_ERRORS.IDENTITY_UNVERIFIED,
    'هويةٌ عُلِّقت بعد الفتح',
  );
  assert.ok(refusalLogged(log, API_ERRORS.IDENTITY_UNVERIFIED), 'الرفضُ لم يُسجَّل');
});

test('هويةٌ معلَّقةٌ لا تُفتح لها جلسةٌ أصلاً', async () => {
  const { gateway } = state();
  await refuses(
    () => gateway.openSession({ actorId: SUSPENDED }),
    API_ERRORS.IDENTITY_UNVERIFIED,
    'فتحُ جلسةٍ لهويةٍ معلَّقة',
  );
  await refuses(
    () => gateway.openSession({ actorId: 'agent:لا-وجود-له' }),
    API_ERRORS.IDENTITY_UNVERIFIED,
    'فتحُ جلسةٍ لهويةٍ غيرِ مسجَّلة',
  );
});

test('حدُّ المعدَّلِ يَعُدُّ النداءَ المرفوضَ لا الناجحَ وحده', async () => {
  const { gateway, log } = state();
  // هذا المُنادي يُرفض تفويضُه في كلِّ نداء. فلو كان الحدُّ يَعُدُّ الناجحَ وحدَه
  // لَما استُنفد أبداً، ولبقي المسارُ مفتوحاً لمحاولاتٍ بلا نهاية.
  const session = await gateway.openSession({ actorId: KING });
  const route = 'state.agents.list';
  const limit = gateway.routes().find((entry) => entry.id === route)?.limit;
  assert.ok(limit !== undefined, 'المسارُ بلا حدٍّ معلَن');
  /** @type {string[]} */
  const codes = [];
  for (let attempt = 0; attempt < limit.maxCalls + 1; attempt += 1) {
    await gateway.call({ route, token: session.token }).catch((error) => {
      codes.push(codeOf(error));
    });
  }
  assert.equal(codes.length, limit.maxCalls + 1, 'نداءٌ مرّ ولم يُرفض');
  assert.equal(
    codes[limit.maxCalls],
    API_ERRORS.RATE_LIMITED,
    'الحدُّ لم يُستنفد بالنداءاتِ المرفوضة؛ فهو يَعُدُّ الناجحَ وحدَه ولا يحدُّ من يُخفق ألفَ مرّة.',
  );
  assert.ok(refusalLogged(log, API_ERRORS.RATE_LIMITED), 'تجاوزُ الحدِّ لم يُسجَّل');
});

test('حدُّ كلِّ مسارٍ مستقلٌّ عن غيرِه', async () => {
  const { gateway } = state();
  const session = await gateway.openSession({ actorId: KING });
  const route = 'state.agents.list';
  const limit = gateway.routes().find((entry) => entry.id === route)?.limit;
  assert.ok(limit !== undefined);
  for (let attempt = 0; attempt < limit.maxCalls; attempt += 1) {
    await gateway.call({ route, token: session.token }).catch(() => {});
  }
  // المسارُ نفسُه استُنفد؛ ومسارٌ آخرُ يجب أن يبقى مفتوحاً وإلا صار مُنادٍ واحدٌ
  // يُغلق الواجهةَ كلَّها على نفسِه بنداءٍ واحدٍ ثقيل.
  await refuses(
    () => gateway.call({ route, token: session.token }),
    API_ERRORS.RATE_LIMITED,
    'المسارُ المستنفَد',
  );
  await refuses(
    () => gateway.call({ route: 'state.agents.count', token: session.token }),
    API_ERRORS.AUTHORIZATION_DENIED,
    'مسارٌ آخرُ لم يُستنفد',
  );
});

test('رفضُ المُعالِجِ لا يخرج برمزِ طبقةٍ أخرى، ويُحفَظ سببُه', async () => {
  const { gateway, log } = state();
  // تفاوتٌ حقيقيٌّ في الحَوْكمةِ يُقاس هنا ولا يُخفى: كتالوجُ السياساتِ **يأذن**
  // للوزيرِ بفعلِ `read-registry`، ووكيلُ المراقبةِ لا يخدم إلا `role:auditor`.
  // فالنداءُ يمرّ بالنقطةِ المركزيةِ ثم يردّه المُعالِج. والمقيسُ أمران: أنّ
  // الخارجَ من الطبقةِ رمزٌ مُعلَنٌ في كتالوجِها لا `MONITOR_*`، وأنّ رمزَ
  // المُعالِجِ محفوظٌ في التفصيلِ فلا يضيع السببُ في التغليف.
  const session = await gateway.openSession({ actorId: MINISTER });
  await refuses(
    () => gateway.call({ route: 'state.agents.count', token: session.token }),
    API_ERRORS.HANDLER_REFUSED,
    'مأذونٌ مركزياً يردّه المُعالِج',
  );
  const refusal = events(log).find(
    (entry) =>
      entry.type === API_POLICY.audit.refusalEvent &&
      entry.data['code'] === API_ERRORS.HANDLER_REFUSED,
  );
  assert.ok(refusal !== undefined, 'الرفضُ لم يُسجَّل');
  assert.equal(
    /** @type {Record<string, unknown>} */ (refusal.data['detail'])['handlerCode'],
    'MONITOR_IDENTITY_UNVERIFIED',
    'رمزُ المُعالِجِ ضاع في التغليف؛ وقيدٌ يقول «رُفض» ولا يقول «لماذا» قيدٌ لا يُفهم بعد شهر.',
  );
  for (const entry of events(log)) {
    if (entry.type !== API_POLICY.audit.refusalEvent) continue;
    assert.ok(
      API_POLICY.refusalCodes.includes(String(entry.data['code'])),
      `خرج من الطبقةِ رمزٌ غيرُ مُعلَنٍ في كتالوجِها: ${String(entry.data['code'])}`,
    );
  }
});

test('الوسيطُ غيرُ المقبولِ يُرفض ولا يُهمَل صامتاً', async () => {
  const { gateway, log } = state();
  const session = await gateway.openSession({ actorId: AUDITOR });
  await refuses(
    () => gateway.call({ route: 'state.agents.list', token: session.token, params: { id: 'x' } }),
    API_ERRORS.PARAMS_INVALID,
    'وسيطٌ لا يقبله النداء',
  );
  await refuses(
    () => gateway.call({ route: 'state.agents.get', token: session.token }),
    API_ERRORS.PARAMS_INVALID,
    'قراءةُ صفٍّ بلا معرّف',
  );
  assert.ok(refusalLogged(log, API_ERRORS.PARAMS_INVALID), 'الرفضُ لم يُسجَّل');
});

test('الفشلُ مغلق: بلا سجلٍّ ولا نقطةِ تفويضٍ ولا وكيلِ مراقبةٍ لا نداء', async () => {
  const withoutLog = state({ withLog: false });
  await refuses(
    () => withoutLog.gateway.call({ route: 'state.agents.count' }),
    API_ERRORS.AUDIT_REQUIRED,
    'بوابةٌ بلا سجلِّ أحداث',
  );

  const withoutEnforcement = state({ withEnforcement: false });
  const s1 = await withoutEnforcement.gateway.openSession({ actorId: AUDITOR });
  await refuses(
    () => withoutEnforcement.gateway.call({ route: 'state.agents.count', token: s1.token }),
    API_ERRORS.ENFORCEMENT_REQUIRED,
    'بوابةٌ بلا نقطةِ تفويض',
  );

  const withoutMonitor = state({ withMonitor: false });
  const s2 = await withoutMonitor.gateway.openSession({ actorId: AUDITOR });
  await refuses(
    () => withoutMonitor.gateway.call({ route: 'state.agents.count', token: s2.token }),
    API_ERRORS.HANDLER_UNDECLARED,
    'بوابةٌ بلا وكيلِ مراقبة',
  );

  const withoutAgents = state({ withAgents: false });
  await refuses(
    () => withoutAgents.gateway.openSession({ actorId: AUDITOR }),
    API_ERRORS.IDENTITY_UNVERIFIED,
    'بوابةٌ بلا سجلِّ هويات',
  );
});

test('لا مسارَ ثانٍ: البوابةُ لا تُصدِّر مشهداً ولا مستودعاً ولا مخزنَ جلسات', () => {
  const { gateway } = state();
  const surface = new Set([
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(gateway)),
    ...Object.getOwnPropertyNames(gateway),
  ]);
  const allowed = new Set([
    'constructor',
    'policy',
    'routes',
    'openSession',
    'closeSession',
    'call',
    'registerPoPKey',
  ]);
  for (const name of surface) {
    assert.ok(
      allowed.has(name),
      `البوابةُ تكشف «${name}» على سطحِها؛ وكلُّ اسمٍ زائدٍ بابٌ ثانٍ يلتفّ حول العقباتِ الخمس.`,
    );
  }
  for (const name of ['insert', 'update', 'remove', 'delete', 'upsert', 'monitor', 'sessions']) {
    assert.equal(
      /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (gateway))[name],
      undefined,
      `البوابةُ تكشف «${name}»`,
    );
  }
});

test('كلُّ مسارٍ مُعلَنٍ قارئٌ فقط وفعلُه ومشهدُه مُعلَنان', () => {
  const { gateway } = state();
  const views = new Set(MONITORING_POLICY.views.map((view) => view.id));
  for (const route of API_POLICY.routes) {
    assert.equal(route.method, 'GET', `المسار ${route.id} ليس قارئاً`);
    assert.ok(
      MONITORING_POLICY.readMethods.includes(route.call),
      `النداء «${route.call}» في المسار ${route.id} غيرُ مُعلَنٍ مقروءاً`,
    );
    assert.ok(views.has(route.view), `المشهد «${route.view}» في المسار ${route.id} غيرُ مُعلَن`);
  }
  assert.equal(gateway.routes().length, API_POLICY.routes.length);
});
