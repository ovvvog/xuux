// مهيّئُ اختبارات السلطة القضائية — دولةٌ مصغَّرةٌ حقيقيةٌ لا محاكاة.
//
// **لماذا ملفٌ مشترك:** يقيس ملفان اليوم السلطةَ القضائية — مسارُ القضية
// (`court.test.mjs`) وفصلُ المصالح والمراجعةُ البشرية (`interests.test.mjs`) —
// وكلاهما يحتاج نفسَ الدولة: تاجٌ حقيقيٌّ بمفتاحٍ وتوقيع، وسجلُّ قوانينَ
// وسلطةٌ تشريعيةٌ تُنفِذ القانونَ الذي تقوم عليه الدعوى، وسجلُّ هوياتٍ يقع عليه
// أثرُ التنفيذ ومنه تُقرأ الملكيةُ في فحص المصالح. ونسخُ المهيّئ في ملفين يجعل
// أحدَ النسختين تتخلّف عن الأخرى، فيمرّ اختبارٌ على دولةٍ لم تعد قائمة.
//
// وليس فيه اختبارٌ واحد: `node --test tests/*/*.test.mjs` لا يُشغّله، وهو
// مهيّئٌ يُستورد لا ملفُ اختبارٍ يُعدّ.
//
// **حدٌّ معلَن:** المستودعُ ذاكريٌّ لا PostgreSQL، فقيودُ الهجرتين 0012 و0013 لا
// تُقاس هنا بل في اختبارات الهجرات (وهي متروكةٌ `skipped` بلا قاعدة). والذي
// يُقاس هنا شرطان: ثوابتُ `CASE_SPEC`، ومنطقُ المحكمة. وتطابقُ نصِّ القيود مع
// أسماء الثوابت محروسٌ في البوابة 20 (`scripts/guard-judiciary.mjs`).

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
  Judiciary,
  createAgentSuspensionExecutor,
  executorIndex,
  loadJudiciaryPolicy,
} from '../../src/judiciary/index.mjs';

export const POLICY = loadJudiciaryPolicy({ dir: path.join(process.cwd(), 'config') });

// دورُ المراجعة يُقرأ من الوثيقة لا يُكتب حرفاً في الاختبار، ويُتحقَّق من وجوده
// عند التحميل: وثيقةٌ بلا حاملٍ لسلطة المراجعة خطأُ إعدادٍ يجب أن يقع هنا لا أن
// يُقرأ لاحقاً `undefined` فيُفسَّر إخفاقُ الاختبار تفسيراً خاطئاً.
const [REVIEWER_ROLE_OR_NONE] = POLICY.review.reviewerRoles;
if (typeof REVIEWER_ROLE_OR_NONE !== 'string') {
  throw new Error('config/judiciary.yaml لا تُعلن حاملاً لسلطة المراجعة البشرية');
}

/** @type {string} */
export const REVIEWER_ROLE = REVIEWER_ROLE_OR_NONE;

/**
 * قراءةُ حقلٍ من حِمل حادثةٍ في السجل: الحِملُ عقدٌ مفتوحُ الشكل، فتُقرأ حقولُه
 * بمفتاحٍ لا بخاصيّةٍ مُعلَنةِ النوع.
 * @param {unknown} data
 * @param {string} key
 * @returns {unknown}
 */
export function field(data, key) {
  return /** @type {Record<string, unknown>} */ (data ?? {})[key];
}
export const LEGISLATION_POLICY = loadLegislationPolicy({
  dir: path.join(process.cwd(), 'config'),
});

// المادةُ والسياسةُ التي يُربَط بهما قانونُ هذه الاختبارات. والنفاذُ لا يقع هنا
// بانتقالِ حالةٍ: `LawRegistry.transition` يرفض «النافذَ» بلا مادةٍ وسياسة
// (`LAW_ENACTMENT_PATH_REQUIRED`) ويشترط فاعلاً اسمُه `crown` — وهو ما لا يُشترى
// بنصّ. فالقانونُ الذي تقوم عليه القضيةُ يمرُّ بالسلطةِ التشريعيةِ نفسِها
// (M8.02) بأمرٍ ملكيٍّ موقَّع، وبذلك يثبت أنّ القضاءَ يقف على قانونٍ نافذٍ
// بالمسارِ الحقيقيِّ لا على صفٍّ كُتِبَت فيه كلمةُ «نافذ».
export const ARTICLES = Object.freeze([Object.freeze({ id: 'art:11', lawRef: 'law:judiciary' })]);

/** @returns {import('../../src/policy/loader.mjs').PolicyBundle} */
export function bundleOf() {
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

export const CLAIM = 'ادّعاءٌ بتجاوز حدِّ الذاكرة المقرَّر لهذا الوكيل في سياسةٍ نافذة.';
export const REASON = 'ر'.repeat(POLICY.procedure.minReasonLength);
export const APPEAL_REASON = 'س'.repeat(POLICY.procedure.minAppealReasonLength);
export const REVERSAL_REASON = 'ت'.repeat(POLICY.procedure.minReversalReasonLength);
export const REVIEW_REASON = 'م'.repeat(POLICY.review.minReviewReasonLength);

/**
 * يُركّب دولةً مصغَّرة: سجلٌّ، تاجٌ حقيقي، قوانين، وكلاء، وقضاءٌ نافذ.
 * @param {{ crown?: boolean, executors?: boolean }} [options]
 */
export function state({ crown = true, executors = true } = {}) {
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
    // وسجلُ الهويات موصولٌ كما في `composition.mjs`: به وحده يقع فحصُ المصالح
    // وتُقرأ بشريةُ المراجع (الخطوة M8.04)، وتركُه يجعل السماعَ مرفوضاً.
    agents,
  });
  return { log, king, ca, gateway, laws, legislature, agents, executor, judiciary };
}

/**
 * قانونٌ نافذٌ فعلاً: مقترحٌ، ثم مطروحٌ، ثم مُنفَذٌ بالسلطةِ التشريعيةِ بأمرٍ
 * ملكيٍّ موقَّعٍ ومربوطٍ بمادةٍ وسياسة.
 * @param {ReturnType<typeof state>} s
 * @returns {Promise<string>}
 */
export async function enactedLaw(s) {
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
export async function agentId(agents, name) {
  const agent = await agents.register({ name, role: 'role:operator' });
  return agent.id;
}

/** أسماءُ الهويات فريدةٌ في السجل، فيُرقَّم المراجعون كي يجتمع عدةُ مراجعين في اختبارٍ واحد. */
let reviewers = 0;

/**
 * مراجعٌ بشريٌ مسجلٌ فعلاً: نوعُه `human` وحالُه `active` ودورُه من
 * `review.reviewerRoles`. والحالُ `active` منذ التسجيل (`AgentRegistry.register`)
 * فلا يُنقَل إليها بنداءٍ زائد. وبشريتُه تُقرأ من المستودع لا تُدّعى بالاسم.
 * @param {ReturnType<typeof state>} s
 * @returns {Promise<string>}
 */
export async function humanReviewer(s) {
  reviewers += 1;
  const agent = await s.agents.register({
    name: `مُدقّقٌ بشري ${reviewers}`,
    role: REVIEWER_ROLE,
    kind: 'human',
  });
  return agent.id;
}

/**
 * أمرٌ ملكيٌّ موقَّعٌ فعلاً.
 * @param {KingIdentity} king
 * @param {string} action
 * @param {string} target
 */
export function command(king, action, target) {
  const cmd = createRoyalCommand(action, target);
  return { command: cmd, signature: king.sign(cmd) };
}

/**
 * يُجري المسارَ إلى ما قبل التنفيذ: دعوى، جلسة، حكمٌ مُسبَّب، ثم مراجعةٌ بشريةٌ
 * موافقة.
 *
 * **والمراجعةُ في المهيّئ لا في كل اختبار** لأنّ المنطوق `guilty` مُعلَنٌ
 * حسّاساً في `config/judiciary.yaml` (الخطوة M8.04)، فالتنفيذُ بلا مراجعةٍ
 * مرفوض. والرفضُ نفسُه مقيسٌ في `tests/judiciary/interests.test.mjs` لا مفترضٌ هنا؛
 * وما تقيسه هذه الاختبارات هو ما بعدَ المراجعة: الأمرُ الملكيُ وقياسُ الأثر.
 * @param {ReturnType<typeof state>} s
 * @param {{ review?: boolean }} [options]
 */
export async function judged(s, { review = true } = {}) {
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
  if (!review) return { caseId, lawId, claimant, respondent, reviewer: null };
  const reviewer = await humanReviewer(s);
  await s.judiciary.ratify({ caseId, reviewer, decision: 'approved', reason: REVIEW_REASON });
  return { caseId, lawId, claimant, respondent, reviewer };
}
