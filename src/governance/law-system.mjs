import { randomUUID } from 'node:crypto';
import { LAW_SPEC } from '../persistence/entities.mjs';

/** @typedef {import('../root-of-trust/event-log.mjs').EventLog} EventLog */

/**
 * نظام القانون. **سجل القوانين صار دائماً** في الخطوة `M3.05`: قانونٌ نافذ يُمحى
 * بإعادة التشغيل ليس قانوناً، وهذا أخطر ما كان في المخزن المؤقّت.
 *
 * **وحُذِف من هذا الملف قضاءٌ ثانٍ:** كان فيه `Court` و`CaseState` بمفرداتِ
 * `open/heard/decided` تفتحُ القضيةَ في `Map` تُمحى بإعادةِ التشغيلِ، ولا ينادِيه
 * مسارٌ إنتاجيٌّ واحدٌ منذ أن حلَّ محلَّه القضاءُ النافذُ في `src/judiciary/`
 * (الخطوةُ `M8.03`): سجلٌّ على `state.cases`، وإجراءٌ من وثيقةِ `config/judiciary.yaml`،
 * وتنفيذٌ بأمرٍ ملكيٍّ موقَّعٍ. وبقاءُ الاثنينِ كان يجعلَ قارئَ المستودعِ يجدُ
 * «قضاءينِ» ولا يعلمُ أيُّهما الحاكمُ — وذاك عيبُ قراءةٍ لا زخرفة. ونصُّ الصنفِ
 * المحذوفِ محفوظٌ في تاريخِ git لا في شجرةِ العملِ.
 */

/**
 * حالات القانون الخمس، مشتقة من الكائن المُجمَّد نفسه فلا تنحرف عنه.
 * @typedef {(typeof LawState)[keyof typeof LawState]} LawStateValue
 */

/**
 * قانون في السجل. `version` يديره المستودع ويزيد مع كل كتابة، فهو أثرٌ لا وصف —
 * وهذه هي نفس دلالة النسخة التي كان السجل يحسبها بيده.
 * @typedef {object} Law
 * @property {string} id
 * @property {string} title
 * @property {string} text
 * @property {string} scope - نطاق السريان، و'all' تعني كل النطاقات
 * @property {string} proposer
 * @property {LawStateValue} state
 * @property {number} version
 * @property {string | null} enactedBy - سلطة النفاذ؛ لا نفاذ بلا سلطة مسمّاة
 * @property {Date | null} enactedAt
 * @property {Date | null} repealedAt
 * @property {Date | null} stateChangedAt
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {string | null} articleId - المادةُ الدستوريةُ الساندة (‏M8.02)
 * @property {readonly string[] | null} policyIds - السياساتُ التي تُنفِّذ القانون (‏M8.02)
 */

/**
 * عقد المستودع الذي يحتاجه سجل القوانين.
 * @typedef {object} LawRepository
 * @property {(record: Record<string, unknown>) => Promise<Record<string, unknown>>} insert
 * @property {(id: string) => Promise<Record<string, unknown> | null>} findById
 * @property {(query?: { filter?: Record<string, unknown>, limit?: number }) => Promise<Array<Record<string, unknown>>>} list
 * @property {(id: string, expectedVersion: number, patch: Record<string, unknown>) => Promise<Record<string, unknown>>} update
 */

export const LawState = Object.freeze({
  DRAFT: 'draft',
  PROPOSED: 'proposed',
  ENACTED: 'enacted',
  SUSPENDED: 'suspended',
  REPEALED: 'repealed',
});
/**
 * @param {Record<string, unknown>} row
 * @returns {Law}
 */
function toLaw(row) {
  return /** @type {Law} */ (/** @type {unknown} */ (Object.freeze({ ...row })));
}

export class LawRegistry {
  /**
   * الاعتماديات اختيارية في النوع لأن التوقيع يقبل الاستدعاء بلا وسائط ويردّ
   * بخطأ مُسمّى `LAW_LOG_REQUIRED`؛ التحقّق في أول سطر هو ما يضيّق النوع بعده.
   * @param {{ log?: EventLog, repository?: LawRepository }} [deps]
   */
  constructor({ log, repository } = {}) {
    if (!log || !repository) throw new Error('LAW_LOG_REQUIRED');
    this.log = log;
    /** @type {LawRepository} */
    this.repository = repository;
  }

  /** @returns {import('../persistence/entities.mjs').EntitySpec} */
  static get spec() {
    return LAW_SPEC;
  }

  /**
   * يقترح قانوناً جديداً في حالة مسوّدة. الاقتراح لا يُنفّذ شيئاً بذاته.
   * @param {{ title: string, text: string, scope: string, proposer: string }} draft
   * @returns {Promise<Law>}
   */
  async propose({ title, text, scope, proposer }) {
    if (!title || !text || !scope || !proposer) throw new Error('LAW_REQUIRED');
    const id = 'law:' + randomUUID();
    const row = await this.repository.insert({
      id,
      title,
      text,
      scope,
      proposer,
      state: LawState.DRAFT,
    });
    this.log.append('law.proposed', proposer, { id, title, scope });
    return toLaw(row);
  }

  /**
   * ينقل قانوناً إلى حالة أخرى. الإنفاذ حصر على التاج، والملغى لا يُعاد فتحه.
   *
   * وصار **التعليق والإلغاء لا يقعان على ما لم يَنفُذ**: قيد القاعدة
   * `laws_enactment_authority_recorded` يشترط سلطة نفاذ ووقت نفاذ لكل حالةٍ بعد
   * النفاذ، ومسوّدةٌ «معلَّقة» حالةٌ بلا معنى كانت تُقبل قبل هذه الخطوة.
   * @param {string} id
   * @param {LawStateValue} state - الحالة المطلوبة
   * @param {string} actor - من يطلب الانتقال؛ الإنفاذ يشترط 'crown'
   * @returns {Promise<Law>}
   */
  async transition(id, state, actor) {
    const row = await this.repository.findById(id);
    if (row === null) throw new Error('LAW_NOT_FOUND');
    const law = toLaw(row);
    if (!Object.values(LawState).includes(state)) throw new Error('INVALID_LAW_STATE');
    if (law.state === LawState.REPEALED) throw new Error('REPEALED_LAW_IMMUTABLE');
    if (state === LawState.ENACTED && actor !== 'crown') throw new Error('CROWN_APPROVAL_REQUIRED');
    // النفاذُ لم يبقَ انتقالَ حالةٍ (‏M8.02): القانونُ النافذُ مربوطٌ بمادةٍ
    // وبسياسةٍ تُنفِّذه، والربطُ لا يُصنَع هنا. فمن أراد نفاذاً مرَّ بـ
    // `Legislature.enact` — أمرٌ ملكيٌّ موقَّعٌ وكشفُ تعارضٍ قبل النفاذ — أو لم
    // يمرّ. وتركُ هذا المسار مفتوحاً يُعيد «النافذَ» صفّاً لا يقرؤه قرار، حتى
    // لو منعه ثابتُ الكيان بعد حين برسالةٍ لا تدلّ على الطريق.
    if (state === LawState.ENACTED && (law.articleId === null || law.policyIds === null)) {
      throw new Error('LAW_ENACTMENT_PATH_REQUIRED');
    }
    const now = new Date();
    /** @type {Record<string, unknown>} */
    const patch = { state, stateChangedAt: now };
    if (state === LawState.ENACTED) {
      patch['enactedBy'] = actor;
      patch['enactedAt'] = law.enactedAt ?? now;
    } else if (state === LawState.SUSPENDED || state === LawState.REPEALED) {
      if (law.enactedAt === null) throw new Error('LAW_NOT_ENACTED_YET');
      if (state === LawState.REPEALED) patch['repealedAt'] = now;
    }
    const updated = await this.repository.update(id, law.version, patch);
    this.log.append(`law.${state}`, actor, { id, version: updated['version'] });
    return toLaw(updated);
  }

  /**
   * القوانين المُنفَّذة السارية على نطاق معيّن، بما فيها ما نطاقه 'all'.
   *
   * **حدٌّ معلن:** الترشيح على الحالة يجري في القاعدة (فهرس `laws_scope_status_idx`)
   * وعلى النطاق في الذاكرة، لأن «نطاق هذا أو 'all'» ليس ترشيحاً بحقلٍ واحد.
   * @param {string} scope
   * @returns {Promise<Law[]>}
   */
  async active(scope) {
    const rows = await this.repository.list({ filter: { state: LawState.ENACTED } });
    return rows
      .map((row) => toLaw(row))
      .filter((law) => law.scope === scope || law.scope === 'all');
  }
}
