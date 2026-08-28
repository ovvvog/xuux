// مهيّئُ اختبارات التشغيل المؤسسي — دولةٌ مصغَّرةٌ حقيقيةٌ لا محاكاة.
//
// **لماذا ملفٌ مشترك:** اختبارُ دورةِ التشغيل يحتاج سجلَّ أحداثٍ حقيقيّاً،
// وسجلَّ هوياتٍ حقيقيّاً (منه تُقرأ حالةُ الوكيل ودورُه في الإسناد)، وثلاثةَ
// مستودعاتٍ على مواصفاتها المُعلَنة، ومنفِّذَي الأثرِ الحقيقيَّين لا بديلاً
// مُختلقاً. وبديلٌ مُختلقٌ للمنفِّذ يجعل «قياسَ الأثر» يقيس البديلَ لا المخزن.
//
// وليس فيه اختبارٌ واحد: `node --test tests/*/*.test.mjs` لا يُشغّله، وهو
// مهيّئٌ يُستورد لا ملفُ اختبارٍ يُعدّ.
//
// **حدٌّ معلَن:** المستودعاتُ ذاكريةٌ لا PostgreSQL، فقيودُ الهجرة 0014 لا
// تُقاس هنا. والذي يُقاس شرطان: ثوابتُ المواصفات الثلاث في `entities.mjs`،
// ومنطقُ `InstitutionOperations`. وتطابقُ أسماءِ القيود مع أسماء الثوابت محروسٌ
// في البوابة 21 (`scripts/guard-institutions.mjs`).

import path from 'node:path';
import { CertificateAuthority, EventLog, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { AgentRegistry } from '../../src/identity/agent-registry.mjs';
import {
  INSTITUTION_BREACH_SPEC,
  INSTITUTION_MANDATE_SPEC,
  INSTITUTION_OUTPUT_SPEC,
  INSTITUTION_REPORT_CYCLE_SPEC,
  INSTITUTION_SPEC,
  INSTITUTION_TASK_SPEC,
} from '../../src/persistence/entities.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import {
  InstitutionMandate,
  InstitutionOperations,
  createServiceCatalogExecutor,
  createStatisticalBulletinExecutor,
  effectIndex,
  loadInstitutionsPolicy,
  loadMandatesPolicy,
  mandateFor,
} from '../../src/institutions/index.mjs';

export const POLICY = loadInstitutionsPolicy({ dir: path.join(process.cwd(), 'config') });

/** نموذجُ التشغيل المؤسسي النافذ، مقروءاً من الوثيقة لا مُختلقاً في الاختبار. */
export const MANDATES = loadMandatesPolicy({ dir: path.join(process.cwd(), 'config') });

/** حاملُ فعلِ الإنفاذ وحاملُ فعلِ إغلاقِ الدورة، مقروءان من الوثيقة. */
export const ENACTOR = MANDATES.acts.enact;
export const CYCLE_CLOSER = MANDATES.acts.closeCycle;

/**
 * نموذجُ تشغيلِ مؤسسةٍ بمفتاحها.
 * @param {string} key
 * @returns {import('../../src/institutions/mandate.mjs').InstitutionMandateEntry}
 */
export function mandateOf(key) {
  return mandateFor(MANDATES, key);
}

/**
 * مجالُ الاختصاصِ المُعلَنُ لنوعِ مهمّةٍ في نموذجِ مؤسستها: يُقرأ من الوثيقة كي
 * لا يبقى الاختبارُ أخضرَ بعد تغيُّرِ حدِّ الاختصاص.
 * @param {string} key
 * @param {string} kind
 * @returns {string}
 */
export function domainFor(key, kind) {
  const act = mandateOf(key).acts.find((entry) => entry.kind === kind);
  if (act === undefined) {
    throw new Error(`النوع ${kind} لا حدَّ حاكماً له في نموذج ${key}`);
  }
  return act.domain;
}

/**
 * نموذجٌ يُرفع فيه سقفُ المدّةِ إلى المُخصَّصِ الكلّي، **لا أكثر**.
 *
 * ولهذا موضعٌ واحدٌ مشروع: اختبارُ نفادِ المُخصَّصِ الكلّي في `M8.05`. فسقفُ
 * المدّةِ المُعلَنُ في الوثيقة أدنى من المُخصَّص، فلو بقي لَحجب الرفضَ الذي يقيسه
 * ذاك الاختبارُ برمزٍ آخر، فيصير اختبارُ الميزانيةِ يقيس السقفَ الزمنيَّ لا نفادَ
 * المُخصَّص. والسقفُ الزمنيُّ يُقاس في `mandate.test.mjs` بوثيقته النافذة.
 * @returns {import('../../src/institutions/mandate.mjs').MandatesPolicy}
 */
export function mandatesWithCeilingAtAllocation() {
  return /** @type {import('../../src/institutions/mandate.mjs').MandatesPolicy} */ ({
    ...MANDATES,
    mandates: MANDATES.mandates.map((entry) => ({
      ...entry,
      budget: { ...entry.budget, ceiling: pilot(entry.key).budget.allocation },
    })),
  });
}

/**
 * حاملُ فعلٍ مُعلَنٌ في العهد. يُقرأ من الوثيقة لا يُكتب حرفاً في الاختبار:
 * حرفٌ مكتوبٌ يُبقي الاختبارَ أخضرَ بعد تغيُّرِ العهد فيقيس ما لم يبقَ.
 * @param {import('../../src/institutions/institutions.mjs').InstitutionalAct} act
 * @returns {string}
 */
export function holderOf(act) {
  const holder = POLICY.holders.find((entry) => entry.may.includes(act));
  if (holder === undefined) {
    throw new Error(`config/institutions.yaml لا تُعلن حاملاً للفعل ${act}`);
  }
  return holder.role;
}

export const SUBMITTER = holderOf('submit');
export const OPERATOR = holderOf('execute');
export const REPORTER = holderOf('report');

/**
 * قراءةُ حقلٍ من صفٍّ أو حِملِ حادثة: كلاهما عقدٌ مفتوحُ الشكل، فتُقرأ حقولُه
 * بمفتاحٍ لا بخاصيّةٍ مُعلَنةِ النوع.
 * @param {unknown} data
 * @param {string} key
 * @returns {unknown}
 */
export function field(data, key) {
  return /** @type {Record<string, unknown>} */ (data ?? {})[key];
}

/**
 * المؤسسةُ التجريبيةُ بمفتاحها من العهد.
 * @param {string} key
 * @returns {import('../../src/institutions/institutions.mjs').InstitutionPilot}
 */
export function pilot(key) {
  const found = POLICY.pilots.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`لا مؤسسةَ تجريبيةً بالمفتاح ${key} في العهد`);
  return found;
}

/**
 * أوّلُ نوعِ مهمّةٍ مُعلَنٍ للمؤسسة.
 * @param {string} key
 * @returns {import('../../src/institutions/institutions.mjs').InstitutionTaskKind}
 */
export function firstTaskKind(key) {
  const [kind] = pilot(key).tasks;
  if (kind === undefined) throw new Error(`المؤسسة ${key} بلا نوعِ مهمّةٍ مُعلَن`);
  return kind;
}

/**
 * موضوعٌ يبلغ الحدَّ المُعلَن، لا حرفاً أقلّ ولا نصّاً مُختلقَ الطول.
 * @param {string} kind
 * @returns {string}
 */
export function subjectFor(kind) {
  const text = `طلبُ ${kind} للنشر في السجل العام باسم الدولة`;
  if (text.trim().length < POLICY.procedure.minSubjectLength) {
    throw new Error('موضوعُ الاختبار أقصرُ من الحدِّ المُعلَن');
  }
  return text;
}

/**
 * يُركّب دولةً مصغَّرة: سجلُّ أحداثٍ، سجلُّ هويات، ثلاثةُ مستودعات، ومنفِّذا
 * الأثرِ الحقيقيّان، وتشغيلٌ مؤسسيٌّ نافذ.
 * @param {{
 *   effects?: boolean,
 *   now?: () => Date,
 *   mandatesPolicy?: import('../../src/institutions/mandate.mjs').MandatesPolicy,
 * }} [options]
 */
export function state({ effects = true, now, mandatesPolicy = MANDATES } = {}) {
  const log = new EventLog();
  const ca = new CertificateAuthority(new KingIdentity());
  const agents = new AgentRegistry({
    ca,
    log,
    repository: createMemoryRepository(AgentRegistry.spec),
  });
  const institutions = createMemoryRepository(INSTITUTION_SPEC);
  const tasks = createMemoryRepository(INSTITUTION_TASK_SPEC);
  const outputs = createMemoryRepository(INSTITUTION_OUTPUT_SPEC);
  const mandateRows = createMemoryRepository(INSTITUTION_MANDATE_SPEC);
  const breaches = createMemoryRepository(INSTITUTION_BREACH_SPEC);
  const cycles = createMemoryRepository(INSTITUTION_REPORT_CYCLE_SPEC);
  const mandate = new InstitutionMandate({
    policy: mandatesPolicy,
    log,
    institutions,
    mandates: mandateRows,
    breaches,
    cycles,
    tasks,
    now,
  });
  const ops = new InstitutionOperations({
    policy: POLICY,
    log,
    institutions,
    tasks,
    outputs,
    agents,
    mandate,
    now,
    effects: effectIndex(
      effects
        ? [
            createServiceCatalogExecutor({ outputs }),
            createStatisticalBulletinExecutor({ outputs }),
          ]
        : [],
    ),
  });
  return {
    log,
    ca,
    agents,
    institutions,
    tasks,
    outputs,
    mandateRows,
    breaches,
    cycles,
    mandate,
    ops,
  };
}

/**
 * مؤسسةٌ مُؤسَّسةٌ **ونموذجُ تشغيلِها مُنفَذ**: الشرطان معاً هما ما يجعل العملَ
 * ممكناً بعد `M8.06`، فلا تُستقبَل مهمّةٌ قبل أن يكون للاختصاصِ صفٌّ محفوظ.
 * @param {ReturnType<typeof state>} s
 * @param {string} key
 * @returns {Promise<import('../../src/persistence/entities.mjs').EntityRecord>}
 */
export async function establish(s, key) {
  const institution = await s.ops.commission({ key });
  await s.mandate.enact({ institutionKey: key, actorRole: ENACTOR });
  return institution;
}

/** أسماءُ الهويات فريدةٌ في السجل، فتُرقَّم كي يجتمع عدةُ وكلاءَ في اختبارٍ واحد. */
let serial = 0;

/**
 * وكيلٌ مسجَّلٌ فعلاً بدورٍ مُعطى. حالتُه `active` منذ التسجيل، فلا يُنقَل إليها
 * بنداءٍ زائد، وأهليّتُه تُقرأ من المستودع لا تُدّعى بالاسم.
 * @param {ReturnType<typeof state>} s
 * @param {string} role
 * @returns {Promise<string>}
 */
export async function agentWithRole(s, role) {
  serial += 1;
  const agent = await s.agents.register({ name: `وكيلٌ مؤسسيٌّ ${serial}`, role });
  return agent.id;
}

/**
 * أوّلُ دورٍ مؤهَّلٍ لوكلاء المؤسسة كما هو مُعلَنٌ في العهد.
 * @param {string} key
 * @returns {string}
 */
export function eligibleRole(key) {
  const [role] = pilot(key).agentRoles;
  if (role === undefined) throw new Error(`المؤسسة ${key} بلا دورٍ مؤهَّل`);
  return role;
}

/**
 * دورةٌ كاملة لمهمّةٍ واحدة: استقبالٌ، ثم إسنادٌ إلى وكيلٍ نشطٍ مؤهَّل، ثم تنفيذٌ.
 * @param {ReturnType<typeof state>} s
 * @param {{ key: string, id: string }} input
 */
export async function ranTask(s, { key, id }) {
  const kind = firstTaskKind(key);
  await s.ops.submit({
    id,
    institutionKey: key,
    kind: kind.kind,
    domain: domainFor(key, kind.kind),
    subject: subjectFor(kind.kind),
    submittedBy: SUBMITTER,
    actorRole: SUBMITTER,
  });
  const agentId = await agentWithRole(s, eligibleRole(key));
  await s.ops.assign({ taskId: id, agentId, actorRole: OPERATOR });
  const executed = await s.ops.execute({ taskId: id, actorRole: OPERATOR });
  return { executed, agentId, kind };
}
