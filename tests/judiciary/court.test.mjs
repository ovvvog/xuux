// اختبارات السلطة القضائية (M8.03).
//
// معيارُ القبول المُعلَن في خارطة الطريق: «اختبار مسار كامل من الدعوى إلى تنفيذ
// الحكم إلى الاستئناف». وهو يُشترى هنا بمسارٍ واقعٍ لا بمحاكاة:
//
//   • بوابةُ تاجٍ حقيقيةٌ (مفتاحٌ وشهادةٌ وتوقيعٌ فعليّ) لا كائنٌ مزيَّف، لأنّ
//     «الأمرَ الملكيّ» لو كان مزيَّفاً في الاختبار لما ثبت أنّ التنفيذَ يقتضي
//     سلطةً؛ وهو أوّلُ ما تدّعيه الخطوة.
//   • سجلُّ وكلاءٍ حقيقيٌّ على مستودعٍ حقيقيّ، والأثرُ المُنفَّذ تعليقُ هويةٍ
//     **تُقرأ حالتُها من المستودع** قبل التنفيذ وبعده. فلو كتب القضاءُ عموداً
//     ولم يتغيّر حالُ الهوية لسقط الاختبار — وهذا هو الفرقُ بين تنفيذٍ يُقاس
//     وتنفيذٍ يُعلَن.
//   • مستودعُ قضايا حقيقيٌّ على `CASE_SPEC`، فالثوابتُ التسعةُ في المواصفة
//     تُفحَص في كل كتابةٍ وكل تحديث، ويثبت أنّ الرفضَ يقع لا أنه مكتوب.
//
// **حدٌّ معلَن:** المستودعُ ذاكريٌّ لا PostgreSQL، فقيودُ الهجرة 0012 لا تُقاس
// هنا بل في اختبارات الهجرات التي تتطلّب قاعدةً (وهي متروكةٌ `skipped` بلا
// قاعدة). والذي يُقاس هنا شرطان: ثوابتُ المواصفة، ومنطقُ المحكمة. وتطابقُ نصّ
// القيود مع أسماء الثوابت محروسٌ في البوابة 20 (`scripts/guard-judiciary.mjs`).

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  CertificateAuthority,
  CrownGateway,
  EventLog,
  KingIdentity,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';
import { LawRegistry, LawState } from '../../src/governance/index.mjs';
import { AgentRegistry } from '../../src/identity/agent-registry.mjs';
import { CASE_SPEC } from '../../src/persistence/entities.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { Legislature, loadLegislationPolicy } from '../../src/legislation/index.mjs';
import {
  JUDICIARY_ERRORS,
  Judiciary,
  createAgentSuspensionExecutor,
  executorIndex,
  loadJudiciaryPolicy,
} from '../../src/judiciary/index.mjs';

const POLICY = loadJudiciaryPolicy({ dir: path.join(process.cwd(), 'config') });
const LEGISLATION_POLICY = loadLegislationPolicy({ dir: path.join(process.cwd(), 'config') });

// المادةُ والسياسةُ التي يُربَط بهما قانونُ هذه الاختبارات. والنفاذُ لا يقع هنا
// بانتقالِ حالةٍ: `LawRegistry.transition` يرفض «النافذَ» بلا مادةٍ وسياسة
// (`LAW_ENACTMENT_PATH_REQUIRED`) ويشترط فاعلاً اسمُه `crown` — وهو ما لا يُشترى
// بنصّ. فالقانونُ الذي تقوم عليه القضيةُ يمرُّ بالسلطةِ التشريعيةِ نفسِها
// (M8.02) بأمرٍ ملكيٍّ موقَّع، وبذلك يثبت أنّ القضاءَ يقف على قانونٍ نافذٍ
// بالمسارِ الحقيقيِّ لا على صفٍّ كُتِبَت فيه كلمةُ «نافذ».
const ARTICLES = Object.freeze([Object.freeze({ id: 'art:11', lawRef: 'law:judiciary' })]);

/** @returns {import('../../src/policy/loader.mjs').PolicyBundle} */
function bundleOf() {
  return /** @type {import('../../src/policy/loader.mjs').PolicyBundle} */ (
    /** @type {unknown} */ ({
      actions: new Map([
        [
          'run-task',
          { id: 'run-task', sensitive: false, resource: 'task', description: 'فعلُ اختبار' },
        ],
      ]),
      policies: [
        Object.freeze({
          id: 'pol:memory',
          name: 'pol:memory',
          owner: 'role:king',
          version: 1,
          effect: 'allow',
          priority: 50,
          reason: 'سياسةُ حدود الذاكرة',
          enabled: true,
          lawRef: 'law:judiciary',
          actors: { roles: ['role:operator'] },
          actions: ['run-task'],
          resources: ['task'],
        }),
      ],
      roles: new Map([['role:operator', { id: 'role:operator', capabilities: [] }]]),
      threshold: [],
      quotas: [],
      versions: { policies: 1, roles: 1, royalAuthority: 1, quotas: 1 },
    })
  );
}

const CLAIM = 'ادّعاءٌ بتجاوز حدِّ الذاكرة المقرَّر لهذا الوكيل في سياسةٍ نافذة.';
const REASON = 'ر'.repeat(POLICY.procedure.minReasonLength);
const APPEAL_REASON = 'س'.repeat(POLICY.procedure.minAppealReasonLength);
const REVERSAL_REASON = 'ت'.repeat(POLICY.procedure.minReversalReasonLength);

/**
 * يُركّب دولةً مصغَّرة: سجلٌّ، تاجٌ حقيقي، قوانين، وكلاء، وقضاءٌ نافذ.
 * @param {{ crown?: boolean, executors?: boolean }} [options]
 */
function state({ crown = true, executors = true } = {}) {
  const log = new EventLog();
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const gateway = new CrownGateway(king, ca, log);
  const laws = new LawRegistry({ log, repository: createMemoryRepository(LawRegistry.spec) });
  const agents = new AgentRegistry({
    ca,
    log,
    repository: createMemoryRepository(AgentRegistry.spec),
  });
  const legislature = new Legislature({
    policy: LEGISLATION_POLICY,
    bundle: bundleOf(),
    articles: ARTICLES,
    laws,
    log,
    crown: gateway,
  });
  const executor = createAgentSuspensionExecutor({ agents });
  const judiciary = new Judiciary({
    policy: POLICY,
    laws,
    log,
    repository: createMemoryRepository(CASE_SPEC),
    crown: crown ? gateway : null,
    executors: executorIndex(executors ? [executor] : []),
  });
  return { log, king, ca, gateway, laws, legislature, agents, executor, judiciary };
}

/**
 * قانونٌ نافذٌ فعلاً: مقترحٌ، ثم مطروحٌ، ثم مُنفَذٌ بالسلطةِ التشريعيةِ بأمرٍ
 * ملكيٍّ موقَّعٍ ومربوطٍ بمادةٍ وسياسة.
 * @param {ReturnType<typeof state>} s
 * @returns {Promise<string>}
 */
async function enactedLaw(s) {
  const law = await s.laws.propose({
    title: 'قانونُ حدود الذاكرة',
    text: 'ن'.repeat(200),
    scope: 'operations',
    proposer: 'role:minister',
  });
  await s.laws.transition(law.id, LawState.PROPOSED, 'role:minister');
  await s.legislature.enact({
    lawId: law.id,
    articleId: 'art:11',
    policyIds: ['pol:memory'],
    ...command(s.king, LEGISLATION_POLICY.binding.enactAction, law.id),
  });
  return law.id;
}

/**
 * هويةُ وكيلٍ مسجَّلةٌ فعلاً — هي التي يقع عليها أثرُ التنفيذ.
 * @param {import('../../src/identity/agent-registry.mjs').AgentRegistry} agents
 * @param {string} name
 * @returns {Promise<string>}
 */
async function agentId(agents, name) {
  const agent = await agents.register({ name, role: 'role:operator' });
  return agent.id;
}

/**
 * أمرٌ ملكيٌّ موقَّعٌ فعلاً.
 * @param {KingIdentity} king
 * @param {string} action
 * @param {string} target
 */
function command(king, action, target) {
  const cmd = createRoyalCommand(action, target);
  return { command: cmd, signature: king.sign(cmd) };
}

/**
 * يُجري المسارَ إلى ما قبل التنفيذ: دعوى، جلسة، حكمٌ مُسبَّب.
 * @param {ReturnType<typeof state>} s
 */
async function judged(s) {
  const lawId = await enactedLaw(s);
  const respondent = await agentId(s.agents, 'وكيلُ المدّعى عليه');
  const claimant = await agentId(s.agents, 'وكيلُ المدّعي');
  const caseId = 'case:0001';
  await s.judiciary.file({ id: caseId, lawId, claimant, respondent, claim: CLAIM });
  await s.judiciary.hear({ caseId, judge: 'role:chief-justice' });
  await s.judiciary.judge({
    caseId,
    verdict: 'guilty',
    reason: REASON,
    judge: 'role:chief-justice',
  });
  return { caseId, lawId, claimant, respondent };
}

// ═══════════════════════════════════════════════════════════════════════════
// ١. المسارُ الكامل: معيارُ القبول نفسُه.
// ═══════════════════════════════════════════════════════════════════════════

test('المسارُ الكامل: دعوى ⇒ جلسة ⇒ حكمٌ مُسبَّب ⇒ تنفيذٌ مقيس ⇒ استئناف ⇒ تراجعٌ مقيس', async () => {
  const s = state();
  const { caseId, respondent } = await judged(s);

  // الحالُ قبل التنفيذ: الهويةُ نشطةٌ فعلاً في السجل لا في ادّعاء الاختبار.
  assert.equal((await s.agents.get(respondent))?.state, 'active');

  const execution = command(s.king, POLICY.procedure.executeAction, caseId);
  const executed = await s.judiciary.execute({
    caseId,
    effect: 'suspend-respondent-agent',
    ...execution,
  });

  // والأثرُ **وقع في السجل** لا في عمودٍ وحده: هذا هو الدليل.
  assert.equal((await s.agents.get(respondent))?.state, 'suspended');
  assert.equal(executed.before, 'state:active');
  assert.equal(executed.after, 'state:suspended');
  assert.equal(executed.case['executedEffect'], 'suspend-respondent-agent');
  assert.equal(executed.case['executionCommandId'], execution.command.id);
  assert.equal(executed.case['executionFingerprintBefore'], 'state:active');

  // الاستئنافُ مكفولٌ لطرفٍ في القضية بسببٍ مكتوب.
  const appealed = await s.judiciary.appeal({
    caseId,
    appellant: respondent,
    reason: APPEAL_REASON,
  });
  assert.equal(appealed['state'], 'appealed');
  assert.equal(appealed['appellant'], respondent);

  // والتراجعُ يُرجع الأثرَ فعلاً، ويُقاس رجوعُه بالبصمة المحفوظة قبل التنفيذ.
  const reversal = command(s.king, POLICY.procedure.reverseAction, caseId);
  const reversed = await s.judiciary.reverse({ caseId, ...reversal, reason: REVERSAL_REASON });
  assert.equal(reversed.restored, 'state:active');
  assert.equal((await s.agents.get(respondent))?.state, 'active');
  assert.equal(reversed.case['reversalCommandId'], reversal.command.id);

  // وكلُّ واقعةٍ منشورةٌ في السجل: قضاءٌ لا يُقرأ أثرُه قضاءٌ لا يُدقَّق.
  const types = s.log.snapshot().map((entry) => entry.type);
  for (const type of [
    'court.case.opened',
    'court.case.heard',
    'court.case.decided',
    'court.judgment.executed',
    'court.case.appealed',
    'court.judgment.reversed',
  ]) {
    assert.ok(types.includes(type), `الحدث ${type} غيرُ منشور`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ٢. الرفضُ يقع فعلاً — بندٌ بندٌ.
// ═══════════════════════════════════════════════════════════════════════════

test('لا دعوى إلا على قانونٍ نافذ', async () => {
  const s = state();
  const law = await s.laws.propose({
    title: 'مسوَّدة',
    text: 'ن'.repeat(200),
    scope: 'operations',
    proposer: 'role:minister',
  });
  await assert.rejects(
    () =>
      s.judiciary.file({
        id: 'case:draft',
        lawId: law.id,
        claimant: 'a',
        respondent: 'b',
        claim: CLAIM,
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.LAW_NOT_ENACTED,
  );
  await assert.rejects(
    () =>
      s.judiciary.file({
        id: 'case:ghost',
        lawId: 'law:missing',
        claimant: 'a',
        respondent: 'b',
        claim: CLAIM,
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.LAW_NOT_ENACTED,
  );
});

test('لا حكمَ قبل جلسةٍ لازمة، ولا حكمَ بلا سببٍ يبلغ الحدَّ، ولا منطوقَ غيرَ معلَن', async () => {
  const s = state();
  const lawId = await enactedLaw(s);
  const caseId = 'case:0002';
  await s.judiciary.file({
    id: caseId,
    lawId,
    claimant: 'ag:claimant',
    respondent: 'ag:respondent',
    claim: CLAIM,
  });

  // حكمٌ قبل الجلسة يُرفض برمزه.
  await assert.rejects(
    () =>
      s.judiciary.judge({
        caseId,
        verdict: 'guilty',
        reason: REASON,
        judge: 'role:chief-justice',
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.HEARING_REQUIRED,
  );

  await s.judiciary.hear({ caseId, judge: 'role:chief-justice' });

  // سببٌ أقصرُ من الحدِّ بحرفٍ واحدٍ يُرفض: الحدُّ حدٌّ لا توصية.
  await assert.rejects(
    () =>
      s.judiciary.judge({
        caseId,
        verdict: 'guilty',
        reason: 'ر'.repeat(POLICY.procedure.minReasonLength - 1),
        judge: 'role:chief-justice',
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.REASON_REQUIRED,
  );

  // منطوقٌ غيرُ معلَنٍ في الوثيقة يُرفض ولو كان معقولاً لفظاً.
  await assert.rejects(
    () =>
      s.judiciary.judge({
        caseId,
        verdict: 'مسؤولٌ جزئياً',
        reason: REASON,
        judge: 'role:chief-justice',
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.OUTCOME_UNKNOWN,
  );

  // ومن يحكم هو من سمع: قاضٍ آخرُ يُرفض.
  await assert.rejects(
    () =>
      s.judiciary.judge({
        caseId,
        verdict: 'guilty',
        reason: REASON,
        judge: 'role:other-justice',
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.JUDGE_MISMATCH,
  );
});

test('لا يفصل قاضٍ في قضيةٍ هو طرفٌ فيها', async () => {
  const s = state();
  const lawId = await enactedLaw(s);
  const caseId = 'case:0003';
  await s.judiciary.file({
    id: caseId,
    lawId,
    claimant: 'ag:claimant',
    respondent: 'ag:respondent',
    claim: CLAIM,
  });
  await assert.rejects(
    () => s.judiciary.hear({ caseId, judge: 'ag:claimant' }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.JUDGE_IS_PARTY,
  );
  await assert.rejects(
    () => s.judiciary.hear({ caseId, judge: 'ag:respondent' }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.JUDGE_IS_PARTY,
  );
});

test('تنفيذُ الحكم لا يقع بلا أمرٍ ملكيٍّ على القضية بعينها', async () => {
  const s = state();
  const { caseId } = await judged(s);

  // بلا أمرٍ أصلاً.
  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect: 'suspend-respondent-agent',
        command: /** @type {never} */ (undefined),
        signature: /** @type {never} */ (undefined),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code ===
      JUDICIARY_ERRORS.ROYAL_COMMAND_REQUIRED,
  );

  // بأمرٍ على فعلٍ آخر.
  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect: 'suspend-respondent-agent',
        ...command(s.king, POLICY.procedure.reverseAction, caseId),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code ===
      JUDICIARY_ERRORS.ROYAL_COMMAND_REQUIRED,
  );

  // وبأمرٍ صحيحٍ على قضيةٍ أخرى: هذا هو منعُ إعادة استعمال الأمر.
  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect: 'suspend-respondent-agent',
        ...command(s.king, POLICY.procedure.executeAction, 'case:other'),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code ===
      JUDICIARY_ERRORS.ROYAL_COMMAND_REQUIRED,
  );

  // وقضاءٌ بلا بوابةِ تاجٍ مركَّبةٍ يرفض التنفيذَ ولا يُنفِّذ صامتاً.
  const bare = state({ crown: false });
  const bareCase = await judged(bare);
  await assert.rejects(
    () =>
      bare.judiciary.execute({
        caseId: bareCase.caseId,
        effect: 'suspend-respondent-agent',
        ...command(bare.king, POLICY.procedure.executeAction, bareCase.caseId),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code ===
      JUDICIARY_ERRORS.ROYAL_COMMAND_REQUIRED,
  );
});

test('التنفيذُ يُقاس: أثرٌ لا يُغيّر شيئاً يُرفض ولا يُسجَّل تنفيذاً', async () => {
  const s = state();
  const { caseId, respondent } = await judged(s);

  // الهويةُ معلَّقةٌ سلفاً: فتعليقُها لا يغيّر البصمة، والقياسُ يكشف ذلك ولو صحّ
  // الأمرُ والحكمُ والأثر. وهذا بالضبط ما يميّز التنفيذَ المقيس عن العَلَم.
  await s.agents.transition(respondent, 'suspended', 'تعليقٌ إداريٌّ سابقٌ للحكم');

  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect: 'suspend-respondent-agent',
        ...command(s.king, POLICY.procedure.executeAction, caseId),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code ===
      JUDICIARY_ERRORS.EXECUTION_INEFFECTIVE,
  );

  // ولم يُكتب في القضية تنفيذٌ: الرفضُ رفضٌ لا تسجيلٌ بحاشية.
  const row = await s.judiciary.caseOf(caseId);
  assert.equal(row['executedAt'], null);
  assert.equal(row['executedEffect'], null);

  // والرفضُ منشورٌ حدثاً كي يُدقَّق: تنفيذٌ مرفوضٌ في صمتٍ لا يُراجَع.
  assert.ok(s.log.snapshot().some((entry) => entry.type === 'court.judgment.refused'));
});

test('أثرٌ غيرُ معلَنٍ يُرفض، وأثرٌ معلَنٌ بلا منفِّذٍ مركَّبٍ يُرفض', async () => {
  const s = state();
  const { caseId } = await judged(s);
  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect: 'seize-assets',
        ...command(s.king, POLICY.procedure.executeAction, caseId),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.EFFECT_UNKNOWN,
  );

  const unwired = state({ executors: false });
  const other = await judged(unwired);
  await assert.rejects(
    () =>
      unwired.judiciary.execute({
        caseId: other.caseId,
        effect: 'suspend-respondent-agent',
        ...command(unwired.king, POLICY.procedure.executeAction, other.caseId),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.EXECUTOR_MISSING,
  );
});

test('لا تنفيذَ لما لم يُحكم فيه، ولا لمنطوقٍ مُعلَنٍ غيرَ قابلٍ للتنفيذ، ولا تنفيذَ مرّتين', async () => {
  const s = state();
  const lawId = await enactedLaw(s);
  const respondent = await agentId(s.agents, 'وكيلٌ بريء');
  const caseId = 'case:0004';
  await s.judiciary.file({
    id: caseId,
    lawId,
    claimant: 'ag:claimant',
    respondent,
    claim: CLAIM,
  });

  // قضيةٌ لم يُحكم فيها.
  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect: 'suspend-respondent-agent',
        ...command(s.king, POLICY.procedure.executeAction, caseId),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.NOTHING_TO_EXECUTE,
  );

  // منطوقُ البراءة مُعلَنٌ غيرَ قابلٍ للتنفيذ: تنفيذُه فعلٌ على من لم يُحكم عليه.
  await s.judiciary.hear({ caseId, judge: 'role:chief-justice' });
  await s.judiciary.judge({
    caseId,
    verdict: 'innocent',
    reason: REASON,
    judge: 'role:chief-justice',
  });
  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect: 'suspend-respondent-agent',
        ...command(s.king, POLICY.procedure.executeAction, caseId),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.NOTHING_TO_EXECUTE,
  );
  assert.equal((await s.agents.get(respondent))?.state, 'active');

  // وتنفيذٌ يُعاد على حكمٍ نُفِّذ يُرفض: أثرٌ يُضاعف بأمرٍ واحد.
  const guilty = state();
  const g = await judged(guilty);
  await guilty.judiciary.execute({
    caseId: g.caseId,
    effect: 'suspend-respondent-agent',
    ...command(guilty.king, POLICY.procedure.executeAction, g.caseId),
  });
  await assert.rejects(
    () =>
      guilty.judiciary.execute({
        caseId: g.caseId,
        effect: 'suspend-respondent-agent',
        ...command(guilty.king, POLICY.procedure.executeAction, g.caseId),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.ALREADY_EXECUTED,
  );
});

test('لا يُنفَّذ حكمٌ استئنافُه قائم', async () => {
  const s = state();
  const { caseId, respondent } = await judged(s);
  await s.judiciary.appeal({ caseId, appellant: respondent, reason: APPEAL_REASON });
  await assert.rejects(
    () =>
      s.judiciary.execute({
        caseId,
        effect: 'suspend-respondent-agent',
        ...command(s.king, POLICY.procedure.executeAction, caseId),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.APPEAL_PENDING,
  );
  assert.equal((await s.agents.get(respondent))?.state, 'active');
});

test('الاستئنافُ لطرفٍ في القضية على حكمٍ صادرٍ بسببٍ مكتوبٍ مرّةً واحدة', async () => {
  const s = state();
  const lawId = await enactedLaw(s);
  const caseId = 'case:0005';
  await s.judiciary.file({
    id: caseId,
    lawId,
    claimant: 'ag:claimant',
    respondent: 'ag:respondent',
    claim: CLAIM,
  });

  // لا استئنافَ على ما لم يُحكم فيه.
  await assert.rejects(
    () => s.judiciary.appeal({ caseId, appellant: 'ag:claimant', reason: APPEAL_REASON }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.NOT_APPEALABLE,
  );

  await s.judiciary.hear({ caseId, judge: 'role:chief-justice' });
  await s.judiciary.judge({
    caseId,
    verdict: 'guilty',
    reason: REASON,
    judge: 'role:chief-justice',
  });

  // ومن ليس طرفاً لا يستأنف ولو كان دوراً رفيعاً.
  await assert.rejects(
    () => s.judiciary.appeal({ caseId, appellant: 'role:minister', reason: APPEAL_REASON }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code ===
      JUDICIARY_ERRORS.APPELLANT_NOT_PARTY,
  );

  // وسببٌ أقصرُ من الحدِّ يُرفض.
  await assert.rejects(
    () =>
      s.judiciary.appeal({
        caseId,
        appellant: 'ag:claimant',
        reason: 'س'.repeat(POLICY.procedure.minAppealReasonLength - 1),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.REASON_REQUIRED,
  );

  await s.judiciary.appeal({ caseId, appellant: 'ag:claimant', reason: APPEAL_REASON });

  // ولا يُقدَّم مرّتين.
  await assert.rejects(
    () => s.judiciary.appeal({ caseId, appellant: 'ag:respondent', reason: APPEAL_REASON }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.NOT_APPEALABLE,
  );
});

test('لا تراجعَ عن تنفيذٍ لم يقع، ولا تراجعَ بلا سببٍ يبلغ الحدَّ، ولا تراجعَ عن تراجع', async () => {
  const s = state();
  const { caseId } = await judged(s);

  await assert.rejects(
    () =>
      s.judiciary.reverse({
        caseId,
        ...command(s.king, POLICY.procedure.reverseAction, caseId),
        reason: REVERSAL_REASON,
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.NOTHING_TO_REVERSE,
  );

  await s.judiciary.execute({
    caseId,
    effect: 'suspend-respondent-agent',
    ...command(s.king, POLICY.procedure.executeAction, caseId),
  });

  await assert.rejects(
    () =>
      s.judiciary.reverse({
        caseId,
        ...command(s.king, POLICY.procedure.reverseAction, caseId),
        reason: 'ت'.repeat(POLICY.procedure.minReversalReasonLength - 1),
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.REASON_REQUIRED,
  );

  await s.judiciary.reverse({
    caseId,
    ...command(s.king, POLICY.procedure.reverseAction, caseId),
    reason: REVERSAL_REASON,
  });

  await assert.rejects(
    () =>
      s.judiciary.reverse({
        caseId,
        ...command(s.king, POLICY.procedure.reverseAction, caseId),
        reason: REVERSAL_REASON,
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.NOTHING_TO_REVERSE,
  );
});

test('التراجعُ يُقاس: أثرٌ لا يرجع إلى ما كان يُرفض ولا يُسجَّل تراجعاً', async () => {
  const s = state();
  const { caseId, respondent } = await judged(s);
  await s.judiciary.execute({
    caseId,
    effect: 'suspend-respondent-agent',
    ...command(s.king, POLICY.procedure.executeAction, caseId),
  });

  // الهويةُ تُسحب سحباً لا رجعةَ فيه بعد التنفيذ: فالتراجعُ لا يُرجع الحالَ إلى
  // ما كان، والقياسُ يكشفه بدل أن يُسجَّل «تراجعٌ» على حالٍ لم ترجع.
  await s.agents.transition(respondent, 'revoked', 'سحبُ هويةٍ لسببٍ أمنيٍّ مستقل');

  await assert.rejects(
    () =>
      s.judiciary.reverse({
        caseId,
        ...command(s.king, POLICY.procedure.reverseAction, caseId),
        reason: REVERSAL_REASON,
      }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code ===
      JUDICIARY_ERRORS.REVERSAL_INEFFECTIVE,
  );

  const row = await s.judiciary.caseOf(caseId);
  assert.equal(row['reversedAt'], null);
  assert.equal(row['reversalCommandId'], null);
  assert.ok(s.log.snapshot().some((entry) => entry.type === 'court.judgment.refused'));
});

test('فعلٌ على معرّفٍ لا قضيةَ له يُرفض برمزه', async () => {
  const s = state();
  await assert.rejects(
    () => s.judiciary.hear({ caseId: 'case:ghost', judge: 'role:chief-justice' }),
    (error) =>
      /** @type {Error & { code?: string }} */ (error).code === JUDICIARY_ERRORS.CASE_NOT_FOUND,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ٣. ثوابتُ المواصفة تُفحَص فعلاً — لا في الكود وحده.
// ═══════════════════════════════════════════════════════════════════════════

test('ثوابتُ CASE_SPEC ترفض الكتابةَ المباشرةَ التي تلتفّ على المحكمة', async () => {
  const repository = createMemoryRepository(CASE_SPEC);
  const base = {
    id: 'case:direct',
    lawId: 'law:x',
    claimant: 'ag:claimant',
    respondent: 'ag:respondent',
    claim: CLAIM,
    state: 'opened',
    openedAt: new Date('2026-01-01T00:00:00Z'),
  };

  // حكمٌ بلا جلسة، مكتوبٌ في المستودع مباشرةً بلا مرورٍ بالمحكمة.
  await assert.rejects(() =>
    repository.insert({
      ...base,
      id: 'case:no-hearing',
      state: 'judged',
      verdict: 'guilty',
      reason: REASON,
      judge: 'role:chief-justice',
      judgedAt: new Date('2026-01-02T00:00:00Z'),
    }),
  );

  // حكمٌ بسببٍ أقصرَ من الحدّ.
  await assert.rejects(() =>
    repository.insert({
      ...base,
      id: 'case:thin-reason',
      state: 'judged',
      heardAt: new Date('2026-01-01T01:00:00Z'),
      verdict: 'guilty',
      reason: 'قصير',
      judge: 'role:chief-justice',
      judgedAt: new Date('2026-01-02T00:00:00Z'),
    }),
  );

  // قاضٍ هو طرفٌ في القضية.
  await assert.rejects(() =>
    repository.insert({
      ...base,
      id: 'case:judge-party',
      state: 'heard',
      heardAt: new Date('2026-01-01T01:00:00Z'),
      judge: 'ag:claimant',
    }),
  );

  // تنفيذٌ بلا حكمٍ ولا بصمةٍ ولا أمر.
  await assert.rejects(() =>
    repository.insert({
      ...base,
      id: 'case:bare-execution',
      state: 'opened',
      executedAt: new Date('2026-01-03T00:00:00Z'),
    }),
  );

  // تراجعٌ عن تنفيذٍ لم يقع.
  await assert.rejects(() =>
    repository.insert({
      ...base,
      id: 'case:bare-reversal',
      state: 'opened',
      reversedAt: new Date('2026-01-03T00:00:00Z'),
      reversalReason: REVERSAL_REASON,
      reversalCommandId: 'cmd:x',
    }),
  );

  // والصفُّ الصحيحُ يُقبل: القيدُ يمنع الخطأ ولا يمنع العمل.
  const ok = await repository.insert(base);
  assert.equal(ok['state'], 'opened');
});
