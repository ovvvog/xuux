// اختبارُ قبولِ الخطوة `M9.06`: **تمرينٌ موثَّقٌ يُنفَّذ من الواجهةِ كاملاً**.
// وأربعةُ أشقٍّ لا شقٌّ واحد، وكلٌّ يفشل وحدَه إن انكسر:
//   ١. «من الواجهةِ» — كلُّ أثرٍ سياديٍّ في التمرينِ يمرّ بـ`RoyalConsole.issue`
//      بأمرٍ معلَنٍ في `config/royal-console.yaml` موقَّعٍ بمفتاحِ الملكِ الحقيقيِّ
//      وبجلسةٍ قويةٍ من `KingAuthenticator`؛ لا نداءَ مباشرٌ على زرِّ الإيقاف.
//   ٢. «كاملاً» — الخطواتُ الستُّ المُعلَنةُ في `procedure:rogue-agent` تُنفَّذ
//      بترتيبِها، ولا تُطوى واحدةٌ، ولا تُقدَّم على ما قبلها.
//   ٣. «يُنفَّذ» — يُقاس بأثرِه في العالمِ لا بقيمةٍ مُعادة: توجيهُ الإيقافِ يُقرأ
//      من **القرصِ** فيُرى `halted` ثم `running`، والحجْرُ يُقاس بأن **طبقةَ
//      الواجهةِ الحقيقيةَ** ترُدُّ المحجورَ بـ`API_IDENTITY_UNVERIFIED` بجلسةٍ
//      كانت مفتوحةً قبل حجْره، ثم تقبله بعد رفعِه.
//   ٤. «موثَّقٌ» — الإغلاقُ لا يُقبَل إلا وقد قرأت الغرفةُ **ملفَّ** السجلِّ من
//      القرصِ ووجدت قيدَ تنفيذٍ لكلِّ خطوةٍ معلَنة. فلو كان السجلُّ ذاكريّاً أو
//      نقصت خطوةٌ لسقط الإغلاقُ برمزٍ مُعلَن.
//
// والمكوّناتُ **حقيقية**: `KingIdentity` يوقّع ويتحقّق، و`HaltSwitch` يكتب توجيهَه
// على القرصِ ويقرأه، و`CrownGateway` بدفترِ أوامرَ دائم، و`PersistentEventLog`
// بملفٍّ متسلسلٍ برأسٍ متسلسل، و`AgentRegistry` حقيقيٌّ على مستودعٍ حقيقيٍّ يكتب
// حالةَ الحجْر، و`ApiGateway` حقيقيةٌ على نقطةِ تفويضٍ حقيقيةٍ تقرأ الهويةَ من
// **السجلِّ نفسِه** فيقع أثرُ الحجْرِ على المسارِ الذي يستعمله الناس.
//
// **حدٌّ معلَن أول:** لا نقلَ شبكيّاً ولا واجهةَ رسوميّةً هنا — الغرفةُ والديوانُ
// نداءٌ داخليّ، وطبقةُ النقلِ دَينٌ معلَنٌ مملوكٌ للمسار `M10`. فما يُقاس «من
// الواجهة» بمعنى: من مِقبضِ الديوانِ وحدَه لا من محرّكاتِه.
//
// **حدٌّ معلَن ثانٍ:** جلساتُ التمرينِ في الذاكرةِ لا على القرص، والدليلُ الذي
// يُبنى عليه الإغلاقُ من القرص — فتمرينٌ نُسي بإعادةِ تشغيلٍ لا يُغلَق أصلاً.
//
// **حدٌّ معلَن ثالث:** مستودعاتُ المشهدِ ذاكريةٌ لا PostgreSQL؛ وما يُقاس هنا
// مرورُ الحجْرِ بطبقةِ الجلساتِ والتفويضِ وقيدُه، وسلامةُ الطبقةِ نفسِها مقيسةٌ
// في `tests/api`.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import {
  KingAuthenticator,
  factorCodeForStep,
  loadKingAuthPolicy,
} from '../../src/authn/index.mjs';
import { RoyalConsole, loadConsolePolicy } from '../../src/console/index.mjs';
import { CRISIS_ERRORS, CrisisRoom, loadCrisisPolicy } from '../../src/crisis/index.mjs';
import { AgentRegistry, AgentState } from '../../src/identity/agent-registry.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import { OperationsCenter, loadOperationsPolicy } from '../../src/operations/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import {
  CertificateAuthority,
  CommandLedger,
  CrownGateway,
  HaltSwitch,
  KingIdentity,
  PersistentEventLog,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';

const REPO_ROOT = process.cwd();
const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const CRISIS_POLICY = loadCrisisPolicy({ dir: CONFIG_DIR });
const CONSOLE_POLICY = loadConsolePolicy({ dir: CONFIG_DIR });
const OPERATIONS_POLICY = loadOperationsPolicy({ dir: CONFIG_DIR });
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });
const AUTHN_POLICY = loadKingAuthPolicy({ dir: CONFIG_DIR });

/** الإجراءُ الحاكمُ لمعيارِ القبولِ ومعرّفاتُ خطواتِه — من الوثيقةِ لا من الكود. */
const ROGUE = (() => {
  const procedure = CRISIS_POLICY.procedures.find((entry) => entry.id === 'procedure:rogue-agent');
  assert.ok(procedure !== undefined, 'الوثيقةُ بلا `procedure:rogue-agent` — ولا معيارَ يُقاس.');
  return procedure;
})();

const OPERATOR = 'agent:crisis-operator';
const SOVEREIGN_DESK = 'contact:sovereign-desk';
const AUDIT_DESK = 'contact:audit-desk';
const REASON = 'شذوذٌ مقيسٌ في سلوكِ الوكيلِ خلال تمرينِ القبول';

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
 * @param {() => unknown | Promise<unknown>} work
 * @param {string} expected
 * @param {string} what
 * @returns {Promise<unknown>}
 */
async function refuses(work, expected, what) {
  try {
    await work();
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.equal(codeOf(error), expected, `${what}: رُفض برمزٍ آخر`);
    return error;
  }
  assert.fail(`${what}: مرّ ولم يُرفض — والمرورُ هنا هو العيبُ نفسُه.`);
}

/**
 * قراءةُ **ملفِّ** السجلِّ من القرص — لا لقطةٌ من الذاكرة.
 * @param {string} logFile
 * @returns {ReadonlyArray<{ type: string, actor: string, data: Record<string, unknown> }>}
 */
function onDisk(logFile) {
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/**
 * غرفةُ أزماتٍ على جذرِ ثقةٍ حقيقيٍّ وطبقةِ واجهةٍ حقيقيةٍ وسجلِّ هوياتٍ حقيقيٍّ
 * في مجلدٍ مؤقّت. والساعةُ **مُقادةٌ** من الاختبارِ كي تُقاس المهلةُ والمدّةُ.
 * @param {object} [options]
 * @param {boolean} [options.withConsole]
 * @param {boolean} [options.withLog]
 * @param {boolean} [options.withOperations]
 * @param {boolean} [options.withRegistry]
 * @param {boolean} [options.withEvidence]
 * @param {readonly string[]} [options.hideEvidenceFor]
 * @param {(() => number) | null} [options.clock]
 */
async function room(options = {}) {
  const {
    withConsole = true,
    withLog = true,
    withOperations = true,
    withRegistry = true,
    withEvidence = true,
    hideEvidenceFor = [],
  } = options;
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'crisis-room-')));
  const logFile = path.join(directory, 'events.log');
  const log = new PersistentEventLog(logFile, { fsync: false });
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const ledger = new CommandLedger(path.join(directory, 'commands.ledger'), { fsync: false });
  const haltSwitch = new HaltSwitch(path.join(directory, 'halt.directive'), king, {
    log,
    fsync: false,
  });
  const crown = new CrownGateway(king, ca, log, { commandLedger: ledger, haltSwitch });

  // ساعةٌ مُقادة: تبدأ من الآنَ كي تبقى أعمارُ الأوامرِ والجلساتِ الحقيقيةُ
  // مقبولةً، وتُقدَّم بـ`advance` حيث يُقاس شرطٌ زمنيٌّ في الغرفةِ وحدَها.
  let nowMs = Date.now();
  const clock = options.clock ?? (() => nowMs);
  /** @param {number} ms */
  const advance = (ms) => {
    nowMs += ms;
  };

  // سجلُّ هوياتٍ حقيقيٌّ على المستودعِ نفسِه الذي تقرأه طبقةُ الواجهة: فحجْرٌ
  // يُكتب هنا يُرى هناك، ولو كان لكلٍّ مستودعُه لقِيس الحجْرُ على مرآة.
  const repositories = createMemoryRepositories();
  const registry = new AgentRegistry({
    ca,
    log: /** @type {never} */ (log),
    repository: repositories.agents,
  });
  const suspect = await registry.register({
    name: 'crisis-suspect',
    role: MONITORING_POLICY.role,
    capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
  });

  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (registry),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: API_POLICY,
    log: /** @type {never} */ (log),
    agents: /** @type {never} */ (registry),
    monitor,
    enforcementPoint: enforcementPointFor(/** @type {never} */ (log)),
    requirePoP: false, // اختباراتٌ بلا إثباتِ حيازةٍ
  });

  const factorSecret = randomBytes(32).toString('hex');
  /** @type {Record<string, string>} */
  const vault = {};
  for (const device of AUTHN_POLICY.devices) vault[device.factorRef] = factorSecret;
  const kingAuth = new KingAuthenticator({
    policy: AUTHN_POLICY,
    king,
    log,
    factorSecrets: {
      /** @param {string} name */
      read: (name) => vault[name] ?? null,
    },
  });
  const trustedDevice = AUTHN_POLICY.devices[0];
  assert.ok(trustedDevice !== undefined, 'وثيقةُ المصادقةِ بلا جهازٍ موثوقٍ واحد.');
  const { stepSeconds, digits, algorithm } = AUTHN_POLICY.secondFactor;
  const sovereign = await kingAuth.authenticate({
    actorId: king.id,
    deviceId: trustedDevice.id,
    factorCode: factorCodeForStep({
      secret: factorSecret,
      step: Math.floor(Date.now() / 1000 / stepSeconds),
      digits,
      algorithm,
    }),
  });

  const royalConsole = new RoyalConsole({
    policy: CONSOLE_POLICY,
    gateway,
    crown,
    haltSwitch,
    king,
    kingAuth,
    commandLedger: ledger,
    log,
  });
  const operations = new OperationsCenter({
    policy: OPERATIONS_POLICY,
    log,
    gateway,
    nowMs: clock,
  });
  const crisis = new CrisisRoom({
    policy: CRISIS_POLICY,
    console: withConsole ? royalConsole : null,
    operations: withOperations ? operations : null,
    agents: withRegistry ? registry : null,
    log: withLog ? log : null,
    evidence: withEvidence
      ? () =>
          onDisk(logFile).filter(
            (entry) => !hideEvidenceFor.includes(String(entry.data['step'] ?? '')),
          )
      : null,
    nowMs: clock,
  });

  /** @param {string} action @param {string} target @param {Record<string, unknown>} [payload] */
  const signed = (action, target, payload = {}) => {
    const royal = createRoyalCommand(action, target, payload);
    return {
      royalCommand: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (royal)),
      signature: king.sign(royal),
      sovereignSession: sovereign.token,
    };
  };

  const cleanup = () => {
    log.close?.();
    fs.rmSync(directory, { recursive: true, force: true });
  };

  return {
    crisis,
    royalConsole,
    registry,
    gateway,
    haltSwitch,
    suspect,
    log,
    logFile,
    signed,
    advance,
    cleanup,
  };
}

test('تمرينٌ موثَّقٌ يُنفَّذ من الديوانِ كاملاً — نصُّ قبولِ الخطوة M9.06', async () => {
  const { crisis, registry, gateway, haltSwitch, suspect, logFile, signed, cleanup } = await room();
  try {
    // جلسةٌ حقيقيةٌ للمشتبَهِ على طبقةِ الواجهةِ **قبل** الحجْر، ونداءٌ ناجحٌ
    // بها: فبلا نجاحٍ قبله لا يكون الرفضُ بعده دليلاً على شيء.
    const session = await gateway.openSession({ actorId: suspect.id });
    const before = await gateway.call({ route: 'state.agents.count', token: session.token });
    assert.equal(before.route, 'state.agents.count');

    const opened = crisis.openDrill({
      procedure: ROGUE.id,
      actor: OPERATOR,
      reason: 'تمرينُ قبولِ الخطوة M9.06',
    });
    assert.deepEqual(
      [...opened.steps],
      ROGUE.steps.map((step) => step.id),
      'التمرينُ فُتح بخطواتٍ غيرِ خطواتِ الإجراءِ المُعلَن.',
    );

    // (١) الحادثةُ تُقيَّد في مركزِ العملياتِ لا في سجلٍّ خاصٍّ بالغرفة.
    const incident = await crisis.executeStep({
      drill: opened.drill,
      step: 'step:record-incident',
      actor: OPERATOR,
      incident: { id: 'incident:m906-drill', title: 'وكيلٌ خرج عن حدِّه', source: 'crisis:drill' },
    });
    assert.equal(incident.effect['severity'], 'critical', 'الدرجةُ لم تُؤخَذ من الوثيقة.');

    // (٢) الحجْر: حالةٌ في سجلِّ الهوياتِ يقع أثرُها على المسارِ الحقيقيّ.
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:quarantine-actor',
      actor: OPERATOR,
      target: suspect.id,
      reason: REASON,
    });
    const quarantined = await registry.get(suspect.id);
    assert.equal(quarantined?.state, AgentState.QUARANTINED);
    assert.equal(quarantined?.stateReason, REASON, 'الحجْرُ وقع بلا سببٍ مسجَّلٍ يُراجَع.');
    // وهذا هو موضعُ الأسنان: الجلسةُ التي فُتحت قبل الحجْرِ لم تعد تنفع.
    const refused = await refuses(
      () => gateway.call({ route: 'state.agents.count', token: session.token }),
      'API_IDENTITY_UNVERIFIED',
      'نداءُ المحجورِ على طبقةِ الواجهة',
    );
    assert.ok(refused !== undefined);

    // (٣) الإيقافُ الشامل — من الديوانِ بأمرٍ موقَّعٍ وجلسةٍ قوية.
    const halted = await crisis.executeStep({
      drill: opened.drill,
      step: 'step:halt-state',
      actor: OPERATOR,
      ...signed('stop-state', 'state:sovereign', { reason: 'تمرينُ أزمةٍ — إيقافٌ شامل' }),
    });
    assert.equal(halted.effect['command'], 'cmd:halt');
    assert.equal(
      haltSwitch.read().state,
      'halted',
      'الأمرُ أُعلن منفَّذاً ولم يقع أثرُه على القرص.',
    );
    assert.ok(Object.isFrozen(halted), 'شهادةُ التنفيذِ غيرُ مجمَّدة.');

    // (٤) التصعيدُ البشريُّ ثم إقرارُه من جهةٍ **غيرِ** رافعِه.
    const escalated = await crisis.executeStep({
      drill: opened.drill,
      step: 'step:escalate-sovereign',
      actor: OPERATOR,
    });
    const escalationId = String(escalated.effect['escalation']);
    const acknowledged = crisis.acknowledge({
      drill: opened.drill,
      escalation: escalationId,
      actor: SOVEREIGN_DESK,
    });
    assert.equal(acknowledged.acknowledgedBy, SOVEREIGN_DESK);

    // (٥) الاستئنافُ بمسارِ التعافي — والأثرُ يُقرأ من القرص.
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:resume-state',
      actor: OPERATOR,
      ...signed('resume-state', 'state:sovereign', { reason: 'انتهى التمرين — استئنافٌ' }),
    });
    assert.equal(haltSwitch.read().state, 'running', 'الاستئنافُ لم يُكتب على القرص.');

    // (٦) رفعُ الحجْر — ويُقاس بأن المسارَ الحقيقيَّ عاد يقبل صاحبَه.
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:release-actor',
      actor: OPERATOR,
      target: suspect.id,
    });
    assert.equal((await registry.get(suspect.id))?.state, AgentState.ACTIVE);
    const reopened = await gateway.openSession({ actorId: suspect.id });
    const after = await gateway.call({ route: 'state.agents.count', token: reopened.token });
    assert.equal(after.route, 'state.agents.count', 'المحجورُ المُفرَجُ عنه لم يعد يُقبَل.');

    // والإغلاق: يُقاس بدليلِ **القرصِ** لا بشهادةِ الذاكرة.
    const closed = crisis.closeDrill({ drill: opened.drill, actor: OPERATOR });
    assert.deepEqual(
      [...closed.steps],
      ROGUE.steps.map((step) => step.id),
      'الإغلاقُ شهد بخطواتٍ غيرِ المُعلَنة.',
    );
    assert.equal(closed.evidence, 'on-disk-log');
    assert.equal(closed.escalations.length, 1);
    assert.equal(closed.escalations[0]?.acknowledgedBy, SOVEREIGN_DESK);
    assert.ok(Object.isFrozen(closed), 'شهادةُ الإغلاقِ غيرُ مجمَّدة.');

    // ── الدليلُ نفسُه: قيودُ الملفِّ على القرصِ بترتيبها ──
    const entries = onDisk(logFile);
    const types = entries.map((entry) => entry.type);
    const executed = entries.filter(
      (entry) =>
        entry.type === CRISIS_POLICY.audit.stepExecutedEvent &&
        entry.data['drill'] === opened.drill,
    );
    assert.equal(
      executed.length,
      ROGUE.steps.length,
      `قيودُ التنفيذِ على القرصِ ${executed.length} والخطواتُ المُعلَنةُ ${ROGUE.steps.length}.`,
    );
    assert.deepEqual(
      executed.map((entry) => String(entry.data['step'])),
      ROGUE.steps.map((step) => step.id),
      'قيودُ القرصِ بترتيبٍ غيرِ ترتيبِ الإجراء.',
    );
    assert.ok(
      types.indexOf(CRISIS_POLICY.audit.drillOpenedEvent) <
        types.indexOf(CRISIS_POLICY.audit.stepExecutedEvent),
      'قيدُ خطوةٍ سبق قيدَ فتحِ التمرينِ على القرص.',
    );
    assert.ok(
      types.lastIndexOf(CRISIS_POLICY.audit.drillClosedEvent) >
        types.lastIndexOf(CONSOLE_POLICY.audit.commandExecutedEvent),
      'قيدُ الإغلاقِ سبق تنفيذَ الديوانِ لأوامرِ التمرين.',
    );
    assert.ok(
      types.includes(CRISIS_POLICY.audit.escalationRaisedEvent) &&
        types.includes(CRISIS_POLICY.audit.escalationAcknowledgedEvent),
      'قيودُ التصعيدِ والإقرارِ غائبةٌ عن ملفِّ السجل.',
    );
    // ومرورُ الأمرِ بالديوانِ مقيسٌ على **قيودِ الديوانِ نفسِه** لا على قيمةٍ
    // أعادتها الغرفة: أمرانِ ملكيّانِ في الإجراءِ ⇒ قيدُ تنفيذٍ وقيدُ تعافٍ.
    assert.equal(
      types.filter((type) => type === CONSOLE_POLICY.audit.commandExecutedEvent).length,
      2,
      'أمرا الإيقافِ والاستئنافِ لم يُقيَّدا في سجلِّ الديوان.',
    );
    assert.equal(
      types.filter((type) => type === CONSOLE_POLICY.audit.recoveryEvent).length,
      1,
      'أمرُ الاستئنافِ لم يمرّ بمسارِ التعافي في الديوان.',
    );
    assert.equal(
      types.filter((type) => type === CONSOLE_POLICY.audit.commandRefusedEvent).length,
      0,
      'التمرينُ الناجحُ خلَّف رفضاً في الديوان.',
    );
  } finally {
    cleanup();
  }
});

test('الترتيبُ محفوظٌ: خطوةٌ تُقدَّم على ما قبلها تُرَدُّ ولا يقع أثرُها', async () => {
  const { crisis, haltSwitch, logFile, signed, cleanup } = await room();
  try {
    const opened = crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    await refuses(
      () =>
        crisis.executeStep({
          drill: opened.drill,
          step: 'step:halt-state',
          actor: OPERATOR,
          ...signed('stop-state', 'state:sovereign', { reason: 'محاولةُ إيقافٍ قبل العزل' }),
        }),
      CRISIS_ERRORS.STEP_OUT_OF_ORDER,
      'إيقافٌ قبل الحجْر',
    );
    // والأهمُّ من الرمز: لم يقع الأثر. فرفضٌ يُعلَن بعد وقوعِ الأثرِ ليس رفضاً.
    assert.equal(
      haltSwitch.read().state,
      'running',
      'الخطوةُ رُفضت وقد أوقفت الدولةَ — والرفضُ بعد الأثرِ لا قيمةَ له.',
    );
    const refusals = onDisk(logFile).filter(
      (entry) => entry.type === CRISIS_POLICY.audit.stepRefusedEvent,
    );
    assert.equal(refusals.length, 1, 'الرفضُ لم يُقيَّد في السجلِّ الدائم.');
    assert.equal(refusals[0]?.data['code'], CRISIS_ERRORS.STEP_OUT_OF_ORDER);

    // وخطوةٌ لا وجودَ لها في الإجراءِ تُرَدُّ برمزِها الخاصِّ لا برمزِ الترتيب.
    await refuses(
      () =>
        crisis.executeStep({ drill: opened.drill, step: 'step:invent-something', actor: OPERATOR }),
      CRISIS_ERRORS.STEP_UNDECLARED,
      'خطوةٌ مخترَعة',
    );
    // وخطوةٌ من إجراءٍ آخرَ ليست من هذا الإجراء.
    await refuses(
      () => crisis.executeStep({ drill: opened.drill, step: 'step:veto-crown', actor: OPERATOR }),
      CRISIS_ERRORS.STEP_UNDECLARED,
      'خطوةٌ من إجراءٍ آخر',
    );
  } finally {
    cleanup();
  }
});

test('الإجراءُ والتمرينُ بياناتٌ معلَنةٌ: لا إجراءَ مخترَعٌ ولا تمرينانِ معاً ولا خطوةَ بلا تمرين', async () => {
  const { crisis, cleanup } = await room();
  try {
    await refuses(
      () => crisis.openDrill({ procedure: 'procedure:whatever', actor: OPERATOR }),
      CRISIS_ERRORS.PROCEDURE_UNDECLARED,
      'إجراءٌ مخترَع',
    );
    const opened = crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    await refuses(
      () => crisis.openDrill({ procedure: 'procedure:crown-breach', actor: OPERATOR }),
      CRISIS_ERRORS.DRILL_ACTIVE,
      'تمرينانِ متزامنان',
    );
    await refuses(
      () =>
        crisis.executeStep({ drill: 'drill:none', step: 'step:record-incident', actor: OPERATOR }),
      CRISIS_ERRORS.DRILL_REQUIRED,
      'خطوةٌ بلا تمرينٍ مفتوح',
    );
    assert.equal(crisis.describe().openDrills, 1, 'وصفُ الغرفةِ لا يُطابق تمرينَها المفتوح.');
    assert.ok(Object.isFrozen(crisis.describe()), 'وصفُ الغرفةِ غيرُ مجمَّد.');
    assert.equal(opened.procedure, ROGUE.id);
  } finally {
    cleanup();
  }
});

test('المدّةُ والمهلةُ تُقاسانِ على ساعةٍ مُقادةٍ، وساعةٌ فاسدةٌ تُرَدُّ', async () => {
  const { crisis, advance, cleanup } = await room();
  try {
    const opened = crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    advance(CRISIS_POLICY.drill.maxDurationMs + 1);
    await refuses(
      () =>
        crisis.executeStep({
          drill: opened.drill,
          step: 'step:record-incident',
          actor: OPERATOR,
          incident: { id: 'incident:late', title: 'متأخّرة', source: 'crisis:drill' },
        }),
      CRISIS_ERRORS.DRILL_EXPIRED,
      'خطوةٌ بعد مدّةِ التمرين',
    );
  } finally {
    cleanup();
  }

  const broken = await room({ clock: () => Number.NaN });
  try {
    await refuses(
      () => broken.crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR }),
      CRISIS_ERRORS.CLOCK_INVALID,
      'ساعةٌ فاسدة',
    );
  } finally {
    broken.cleanup();
  }
});

test('التصعيدُ البشريُّ لا يُقرّه رافعُه ولا يُقبل بعد المهلةِ المُعلَنة', async () => {
  const { crisis, registry, suspect, signed, advance, cleanup } = await room();
  try {
    const opened = crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:record-incident',
      actor: OPERATOR,
      incident: { id: 'incident:esc', title: 'تصعيد', source: 'crisis:drill' },
    });
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:quarantine-actor',
      actor: OPERATOR,
      target: suspect.id,
      reason: REASON,
    });
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:halt-state',
      actor: OPERATOR,
      ...signed('stop-state', 'state:sovereign', { reason: 'تمرينُ تصعيد' }),
    });
    // الرافعُ هنا **جهةٌ معلَنة**، كي يكون منعُ الإقرارِ الذاتيِّ هو السببَ
    // الوحيدَ للرفضِ لا كونُه غيرَ معلَن.
    const raised = await crisis.executeStep({
      drill: opened.drill,
      step: 'step:escalate-sovereign',
      actor: SOVEREIGN_DESK,
    });
    const escalation = String(raised.effect['escalation']);
    await refuses(
      () => crisis.acknowledge({ drill: opened.drill, escalation, actor: SOVEREIGN_DESK }),
      CRISIS_ERRORS.ESCALATION_SELF_ACK,
      'إقرارٌ ذاتيّ',
    );
    await refuses(
      () => crisis.acknowledge({ drill: opened.drill, escalation, actor: 'human:passerby' }),
      CRISIS_ERRORS.ESCALATION_CONTACT_UNKNOWN,
      'إقرارٌ من غيرِ جهةٍ معلَنة',
    );
    // الاستئنافُ أمرٌ ملكيٌّ لا يحتاج إقراراً — فالتاجُ صاحبُه. أمّا **رفعُ
    // الحجْرِ** فيحتاج شاهداً بشريّاً: من حجَر لا يُفرِج وحدَه.
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:resume-state',
      actor: OPERATOR,
      ...signed('resume-state', 'state:sovereign', { reason: 'استئنافٌ بعد الإيقاف' }),
    });
    await refuses(
      () =>
        crisis.executeStep({
          drill: opened.drill,
          step: 'step:release-actor',
          actor: OPERATOR,
          target: suspect.id,
        }),
      CRISIS_ERRORS.ESCALATION_PENDING,
      'رفعُ حجْرٍ قبل إقرارِ التصعيد',
    );
    assert.equal(
      (await registry.get(suspect.id))?.state,
      AgentState.QUARANTINED,
      'الحجْرُ رُفع فعلاً وقد رُفض رفعُه.',
    );
    advance(CRISIS_POLICY.escalation.acknowledgmentDeadlineMs + 1);
    await refuses(
      () => crisis.acknowledge({ drill: opened.drill, escalation, actor: AUDIT_DESK }),
      CRISIS_ERRORS.ESCALATION_DEADLINE_MISSED,
      'إقرارٌ بعد المهلة',
    );
    // وتمرينٌ فيه تصعيدٌ معلَّقٌ لا يُغلَق «ناجحاً».
    await refuses(
      () => crisis.closeDrill({ drill: opened.drill, actor: OPERATOR }),
      CRISIS_ERRORS.ESCALATION_PENDING,
      'إغلاقٌ بتصعيدٍ معلَّق',
    );
  } finally {
    cleanup();
  }
});

test('الحجْرُ لا يقع بسببٍ لا يُقرأ، ورفعُ حجْرٍ لم يقع مرفوض', async () => {
  const { crisis, registry, suspect, cleanup } = await room();
  try {
    const opened = crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:record-incident',
      actor: OPERATOR,
      incident: { id: 'incident:reason', title: 'سبب', source: 'crisis:drill' },
    });
    await refuses(
      () =>
        crisis.executeStep({
          drill: opened.drill,
          step: 'step:quarantine-actor',
          actor: OPERATOR,
          target: suspect.id,
          reason: 'خطأ',
        }),
      CRISIS_ERRORS.QUARANTINE_REASON_REQUIRED,
      'حجْرٌ بسببٍ أقصرَ من الحدِّ المُعلَن',
    );
    assert.equal(
      (await registry.get(suspect.id))?.state,
      AgentState.ACTIVE,
      'الحجْرُ رُفض وقد وقع فعلاً في السجل.',
    );
    await refuses(
      () =>
        crisis.executeStep({
          drill: opened.drill,
          step: 'step:quarantine-actor',
          actor: OPERATOR,
          target: 'agent:ghost',
          reason: REASON,
        }),
      CRISIS_ERRORS.QUARANTINE_REFUSED,
      'حجْرُ هويةٍ لا وجودَ لها',
    );
  } finally {
    cleanup();
  }
});

test('لا أثرَ سياديٌّ خارجَ الديوان: بلا ديوانٍ رفضٌ مُسمّى، ورفضُ الديوانِ يُنقل كما هو', async () => {
  const headless = await room({ withConsole: false });
  try {
    const opened = headless.crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    await headless.crisis.executeStep({
      drill: opened.drill,
      step: 'step:record-incident',
      actor: OPERATOR,
      incident: { id: 'incident:headless', title: 'بلا ديوان', source: 'crisis:drill' },
    });
    await headless.crisis.executeStep({
      drill: opened.drill,
      step: 'step:quarantine-actor',
      actor: OPERATOR,
      target: headless.suspect.id,
      reason: REASON,
    });
    await refuses(
      () =>
        headless.crisis.executeStep({
          drill: opened.drill,
          step: 'step:halt-state',
          actor: OPERATOR,
          ...headless.signed('stop-state', 'state:sovereign', { reason: 'بلا ديوان' }),
        }),
      CRISIS_ERRORS.CONSOLE_REQUIRED,
      'أمرٌ بلا ديوان',
    );
    assert.equal(
      headless.haltSwitch.read().state,
      'running',
      'الدولةُ أُوقفت من غرفةٍ بلا ديوان — وذاك الطريقُ الذي جاءت الخطوةُ لتغلقه.',
    );
  } finally {
    headless.cleanup();
  }

  const tampered = await room();
  try {
    const opened = tampered.crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    await tampered.crisis.executeStep({
      drill: opened.drill,
      step: 'step:record-incident',
      actor: OPERATOR,
      incident: { id: 'incident:tamper', title: 'توقيعٌ مُعبَثٌ به', source: 'crisis:drill' },
    });
    await tampered.crisis.executeStep({
      drill: opened.drill,
      step: 'step:quarantine-actor',
      actor: OPERATOR,
      target: tampered.suspect.id,
      reason: REASON,
    });
    const material = tampered.signed('stop-state', 'state:sovereign', {
      reason: 'أمرٌ سيُعبَث به',
    });
    const error = await refuses(
      () =>
        tampered.crisis.executeStep({
          drill: opened.drill,
          step: 'step:halt-state',
          actor: OPERATOR,
          royalCommand: material.royalCommand,
          signature: `${material.signature.slice(0, -2)}00`,
          sovereignSession: material.sovereignSession,
        }),
      CRISIS_ERRORS.COMMAND_REFUSED,
      'أمرٌ بتوقيعٍ مُعبَثٍ به',
    );
    // ورفضُ الديوانِ لا يُبتلَع: سببُه محفوظٌ في `cause` وفي تفصيلِ الرفض.
    const detail = /** @type {{ detail?: Record<string, unknown>, cause?: unknown }} */ (error);
    assert.match(String(detail.detail?.['cause']), /^CONSOLE_/, 'رمزُ سببِ الديوانِ غيرُ محفوظ.');
    assert.ok(detail.cause !== undefined, 'خطأُ الديوانِ الأصليُّ غيرُ مربوطٍ بـ`cause`.');
    assert.equal(tampered.haltSwitch.read().state, 'running');
    // وبلا أمرٍ موقَّعٍ أصلاً: الغرفةُ لا توقّع بالنيابة.
    await refuses(
      () =>
        tampered.crisis.executeStep({
          drill: opened.drill,
          step: 'step:halt-state',
          actor: OPERATOR,
        }),
      CRISIS_ERRORS.COMMAND_REFUSED,
      'أمرٌ بلا توقيع',
    );
  } finally {
    tampered.cleanup();
  }
});

test('الوصلاتُ الناقصةُ رفضٌ مُسمّى لا سماحٌ صامت: بلا سجلٍّ ولا مركزِ عملياتٍ ولا سجلِّ هويات', async () => {
  const noLog = await room({ withLog: false });
  try {
    await refuses(
      () => noLog.crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR }),
      CRISIS_ERRORS.AUDIT_REQUIRED,
      'تمرينٌ بلا سجلٍّ دائم',
    );
  } finally {
    noLog.cleanup();
  }

  const noOperations = await room({ withOperations: false });
  try {
    const opened = noOperations.crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    await refuses(
      () =>
        noOperations.crisis.executeStep({
          drill: opened.drill,
          step: 'step:record-incident',
          actor: OPERATOR,
          incident: { id: 'incident:blind', title: 'بلا مركز', source: 'crisis:drill' },
        }),
      CRISIS_ERRORS.OPERATIONS_REQUIRED,
      'حادثةٌ بلا مركزِ عمليات',
    );
  } finally {
    noOperations.cleanup();
  }

  const noRegistry = await room({ withRegistry: false });
  try {
    const opened = noRegistry.crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    await noRegistry.crisis.executeStep({
      drill: opened.drill,
      step: 'step:record-incident',
      actor: OPERATOR,
      incident: { id: 'incident:noreg', title: 'بلا سجل', source: 'crisis:drill' },
    });
    await refuses(
      () =>
        noRegistry.crisis.executeStep({
          drill: opened.drill,
          step: 'step:quarantine-actor',
          actor: OPERATOR,
          target: noRegistry.suspect.id,
          reason: REASON,
        }),
      CRISIS_ERRORS.REGISTRY_REQUIRED,
      'حجْرٌ بلا سجلِّ هويات',
    );
  } finally {
    noRegistry.cleanup();
  }
});

test('الإغلاقُ يشترط دليلَ القرصِ: خطوةٌ لا يشهد بها الملفُّ تُسقط التمرين', async () => {
  // نسخةٌ تُخفي قيدَ خطوةٍ واحدةٍ عن قارئِ الدليلِ — كما لو حُذف من الملف.
  const { crisis, registry, suspect, signed, cleanup } = await room({
    hideEvidenceFor: ['step:release-actor'],
  });
  try {
    const opened = crisis.openDrill({ procedure: ROGUE.id, actor: OPERATOR });
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:record-incident',
      actor: OPERATOR,
      incident: { id: 'incident:evidence', title: 'دليل', source: 'crisis:drill' },
    });
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:quarantine-actor',
      actor: OPERATOR,
      target: suspect.id,
      reason: REASON,
    });
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:halt-state',
      actor: OPERATOR,
      ...signed('stop-state', 'state:sovereign', { reason: 'تمرينُ الدليل' }),
    });
    const raised = await crisis.executeStep({
      drill: opened.drill,
      step: 'step:escalate-sovereign',
      actor: OPERATOR,
    });
    crisis.acknowledge({
      drill: opened.drill,
      escalation: String(raised.effect['escalation']),
      actor: SOVEREIGN_DESK,
    });
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:resume-state',
      actor: OPERATOR,
      ...signed('resume-state', 'state:sovereign', { reason: 'استئنافٌ' }),
    });
    await crisis.executeStep({
      drill: opened.drill,
      step: 'step:release-actor',
      actor: OPERATOR,
      target: suspect.id,
    });
    // كلُّ الخطواتِ نُفِّذت فعلاً في الذاكرةِ وفي العالم…
    assert.equal((await registry.get(suspect.id))?.state, AgentState.ACTIVE);
    // …ومع ذلك يُرفَض الإغلاقُ لأن الدليلَ المقروءَ من القرصِ ناقص.
    const error = await refuses(
      () => crisis.closeDrill({ drill: opened.drill, actor: OPERATOR }),
      CRISIS_ERRORS.EVIDENCE_MISSING,
      'إغلاقٌ بدليلٍ ناقص',
    );
    assert.match(
      String(/** @type {{ message?: string }} */ (error).message),
      /step:release-actor/,
      'الرفضُ لم يُسمِّ الخطوةَ الغائبةَ عن الدليل.',
    );
  } finally {
    cleanup();
  }

  const blind = await room({ withEvidence: false });
  try {
    const opened = blind.crisis.openDrill({ procedure: 'procedure:crown-breach', actor: OPERATOR });
    await refuses(
      () => blind.crisis.closeDrill({ drill: opened.drill, actor: OPERATOR }),
      CRISIS_ERRORS.EVIDENCE_MISSING,
      'إغلاقٌ بلا قارئِ دليل',
    );
  } finally {
    blind.cleanup();
  }
});

test('حاجزُ غرفةِ الأزماتِ يسقط على نسخةٍ مُزيَّفةٍ — رتبتُه مقيسةٌ لا مُدَّعاة', () => {
  const scratch = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'crisis-guard-')));
  try {
    for (const entry of ['config', 'scripts', 'src', 'tests', 'docs', '.github']) {
      fs.cpSync(path.join(REPO_ROOT, entry), path.join(scratch, entry), { recursive: true });
    }
    fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(scratch, 'package.json'));

    const guard = path.join(REPO_ROOT, 'scripts', 'guard-crisis.mjs');
    // النسخةُ السليمةُ تمرّ، وإلا لم يكن الإخفاقُ لاحقاً دليلاً على شيء.
    execFileSync(process.execPath, [guard, '--root', scratch], { encoding: 'utf8' });

    const configPath = path.join(scratch, 'config', 'crisis-room.yaml');
    const original = fs.readFileSync(configPath, 'utf8');

    /**
     * @param {string} content
     * @param {RegExp} rule
     * @param {RegExp} where
     * @param {string} what
     */
    const rejects = (content, rule, where, what) => {
      fs.writeFileSync(configPath, content);
      let failed = '';
      try {
        execFileSync(process.execPath, [guard, '--root', scratch], { encoding: 'utf8' });
        assert.fail(`الحاجزُ مرَّ على ${what} — والمرورُ هنا هو العيبُ نفسُه.`);
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        const failure = /** @type {{ status?: number, stderr?: string, stdout?: string }} */ (
          error
        );
        assert.equal(failure.status, 1, 'خروجُ الحاجزِ ليس 1');
        failed = `${failure.stderr ?? ''}${failure.stdout ?? ''}`;
      }
      assert.match(failed, rule, `الحاجزُ لم يُسمِّ قاعدتَه عند ${what}`);
      assert.match(failed, where, `الحاجزُ لم يُسمِّ موضعَ الخلل عند ${what}`);
    };

    // تزييفٌ أول: أمرٌ غيرُ معلَنٍ في وثيقةِ الديوان.
    rejects(
      original.replace('command: cmd:halt', 'command: cmd:shutdown'),
      /R0|R1/,
      /cmd:shutdown|command/,
      'أمرٍ لا وجودَ له في الديوان',
    );

    // تزييفٌ ثانٍ: حذفُ رمزِ رفضٍ يرفعه الكودُ — تقابلٌ منكسرٌ في اتجاه.
    rejects(
      original.replace('  - CRISIS_STEP_OUT_OF_ORDER\n', ''),
      /R0|R2/,
      /CRISIS_STEP_OUT_OF_ORDER/,
      'وثيقةٍ بلا رمزِ الترتيب',
    );

    // تزييفٌ ثالث: حالةُ حجْرٍ لا وجودَ لها في سجلِّ الهويات.
    rejects(
      original.replace('  state: quarantined', '  state: frozen'),
      /R0|R7/,
      /frozen|AgentState/,
      'حالةِ حجْرٍ مخترَعة',
    );

    // تزييفٌ رابع: ضمانٌ يُسند إلى ملفٍ لا يحمل رمزَ إنفاذِه — إنفاذٌ مُدَّعى.
    rejects(
      original.replace(
        'enforcedBy: src/crisis/crisis-room.mjs',
        'enforcedBy: src/crisis/index.mjs',
      ),
      /R0|R2/,
      /G-CRISIS|index\.mjs/,
      'ضمانٍ مُسنَدٍ إلى ملفٍ لا يُنفِّذُه',
    );

    fs.writeFileSync(configPath, original);
    execFileSync(process.execPath, [guard, '--root', scratch], { encoding: 'utf8' });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
