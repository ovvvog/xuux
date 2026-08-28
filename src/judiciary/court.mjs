/**
 * القضاءُ النافذ: دعوى مسنَدة، وجلسةٌ لازمة، وحكمٌ مُسبَّب، وتنفيذٌ يُقاس، وتراجعٌ
 * يُقاس، واستئنافٌ مكفول — الخطوة M8.03
 *
 * **العيوبُ الأربعةُ التي يُغلقها هذا الملف** (وكلُّها قائمةٌ في
 * `src/governance/law-system.mjs` قبل هذه الخطوة):
 *
 *   1. **قضاءٌ في الذاكرة.** `Court` القديم يفتح القضيةَ في `Map` تُمحى بإعادة
 *      التشغيل، وجدولُ `state.cases` قائمٌ من الهجرة 0001 ولا مواصفةَ له في
 *      الكود ولا مستودعَ يكتب فيه. فكانت القضايا وقائعَ في عملية، لا في دولة.
 *      وهنا كلُّ واقعةٍ صفٌّ في الجدول بقيودٍ تُفحَص في المستودعين معاً.
 *
 *   2. **حكمٌ بلا سبب.** `decide(id, outcome, actor)` يقبل منطوقاً بلا سببٍ
 *      مكتوب، والمادةُ 11 تقول: «وبحكمٍ مُسبَّبٍ لا يُقبل بلا سببٍ مكتوب». وهنا
 *      لا يُقبل الحكمُ إلا بسببٍ يبلغ الحدَّ المُعلَن، والقيدُ في الجدول نفسِه
 *      كي لا يُلتفَّ عليه بكتابةٍ مباشرة.
 *
 *   3. **تنفيذٌ لا وجودَ له.** لم يكن في الدولة تنفيذُ حكمٍ أصلاً — لا عموداً
 *      ولا دالّة. وهنا التنفيذُ أمرٌ ملكيٌّ موقَّعٌ يُحدث أثراً **مقيساً**:
 *      بصمةٌ قبله وبصمةٌ بعده، وإن لم تتغيّر رُدَّ الأمرُ ولم يُسجَّل تنفيذ.
 *      والتراجعُ كذلك: يُقاس رجوعُ البصمة إلى ما كانت عليه قبل التنفيذ.
 *
 *   4. **استئنافٌ بلا مضمون.** `appeal(id, actor)` كان انتقالَ حالةٍ بلا
 *      مستأنِفٍ ولا سببٍ ولا تحقّقٍ من أنّ المستأنِفَ طرفٌ في القضية. وهنا
 *      الاستئنافُ واقعةٌ كاملةٌ مسجَّلة، ولا يُنفَّذ حكمٌ استئنافُه قائم.
 *
 * **وحدٌّ معلَن:** الأحداثُ تُكتب هنا في `EventLog` مباشرةً كما يفعل باقي
 * الدولة، لا عبر `EventBus`. وهذا يعني أنها لا تمرّ بعقود القنوات في التشغيل بل
 * في الحاجز وحده (البوابة 20 تفحص أنّ كلَّ نوعٍ مُعلَنٌ عقداً في قناة `court`).
 * والانتقالُ إلى الناشر المعقود مسجَّلٌ في `docs/REMAINING_WORK.md` وهو حدٌّ
 * مشتركٌ مع كل مُنتِجي الأحداث في المستودع، لا نقصٌ خاصٌّ بهذه الخطوة.
 *
 * **وحدٌّ معلَن ثانٍ:** إغلاقُ القضية (`closed`) ليس في هذه الخطوة. الحالةُ
 * مقبولةٌ في الجدول ومحروسةٌ بقيدها، ولا دالّةَ تُنتجها بعد؛ ومسارُ الإغلاق بعد
 * الفصل في الاستئناف مسجَّلٌ في `docs/REMAINING_WORK.md`. ولم يُدَّعَ أنه قائم.
 */

import { LawState } from '../governance/law-system.mjs';
import { JUDICIARY_ERRORS, JudiciaryError } from './judiciary.mjs';
import { recusedJudgesOf, screenJudicialInterest } from './interests.mjs';

/** @typedef {import('./judiciary.mjs').JudiciaryPolicy} JudiciaryPolicy */
/** @typedef {import('./executors.mjs').JudgmentExecutor} JudgmentExecutor */
/** @typedef {import('../root-of-trust/crown.mjs').RoyalCommand} RoyalCommand */
/** @typedef {Record<string, unknown>} CaseRow */

/**
 * أنواعُ أحداثِ قناة القضاء التي تنشأ في هذا الملف. القيمُ تُكتب حرفياً في مواضع
 * النشر (يقتضيه المُستخرِج الساكن في `scripts/lib/event-emissions.mjs`)، وهذا
 * الجدولُ للقارئ ولمن يستهلك القناة.
 */
export const JUDICIARY_EVENTS = Object.freeze({
  FILED: 'court.case.opened',
  HEARD: 'court.case.heard',
  JUDGED: 'court.case.decided',
  APPEALED: 'court.case.appealed',
  EXECUTED: 'court.judgment.executed',
  REVERSED: 'court.judgment.reversed',
  REFUSED: 'court.judgment.refused',
  // الخطوة M8.04: التعارضُ والتنحّي والمراجعةُ وقائعُ تُقرأ لا قراراتٌ تُخفى.
  CONFLICTED: 'court.conflict.detected',
  RECUSED: 'court.judge.recused',
  REVIEWED: 'court.judgment.reviewed',
});

/**
 * السلطةُ القضائية النافذة.
 */
export class Judiciary {
  /**
   * الاعتماديةُ الوحيدةُ الاختياريةُ حقّاً هي بوابةُ التاج: تركُها يجعل
   * `execute` و`reverse` ترفضان دائماً برمز `JUDICIARY_ROYAL_COMMAND_REQUIRED`.
   * وهو الفشلُ المُغلَق: تنفيذُ حكمٍ يمسّ الحقوقَ لا يقع بنداءٍ بلا سلطة.
   *
   * والمنفِّذون فهرسٌ باسم الأثر: أثرٌ معلَنٌ في الوثيقة بلا منفِّذٍ مركَّبٍ
   * يُوقف التنفيذَ رفضاً، ولا يُسجَّل تنفيذٌ لأثرٍ لا سبيلَ للكود إلى إحداثه.
   * @param {object} deps
   * @param {JudiciaryPolicy} deps.policy - وثيقةُ القضاء المُحمَّلة
   * @param {import('../governance/law-system.mjs').LawRegistry} deps.laws
   * @param {import('../root-of-trust/event-log.mjs').EventLog} deps.log
   * @param {{ insert: (record: CaseRow) => Promise<CaseRow>, findById: (id: string) => Promise<CaseRow | null>, list: (query?: { filter?: Record<string, unknown>, limit?: number }) => Promise<CaseRow[]>, update: (id: string, expectedVersion: number, patch: CaseRow) => Promise<CaseRow> }} deps.repository
   * @param {{ command: (command: RoyalCommand, signature: string) => unknown } | null} [deps.crown]
   * @param {ReadonlyMap<string, JudgmentExecutor>} [deps.executors]
   * @param {import('./interests.mjs').AgentLookup | null} [deps.agents] - سجلُ الهويات؛ ومنه
   *   تُقرأ الملكيةُ في فحص المصالح وبشريةُ المراجع. وتركُه **لا يُرخّص التجاوز**:
   *   مع `requireInterestScreening` المرفوع يرفض السماعُ والحكمُ برمز
   *   `JUDICIARY_INTEREST_SCREENING_UNAVAILABLE`، وتُرفض المراجعةُ برمز
   *   `JUDICIARY_REVIEWER_NOT_HUMAN`.
   * @param {() => Date} [deps.now]
   */
  constructor({
    policy,
    laws,
    log,
    repository,
    crown = null,
    executors = new Map(),
    agents = null,
    now,
  }) {
    if (!policy || !laws || !log || !repository) throw new Error('JUDICIARY_DEPENDENCY_MISSING');
    this.policy = policy;
    this.laws = laws;
    this.log = log;
    this.repository = repository;
    this.crown = crown;
    this.executors = executors;
    this.agents = agents;
    this.now = now ?? (() => new Date());
  }

  /**
   * يفحص مصلحةَ قاضٍ في قضية، ويرفض إن تحقّقت قاعدةٌ من قواعد التعارض.
   *
   * والفحصُ يقع في **السماع والحكم معاً** لا في السماع وحده. **وحدٌّ معلَن:**
   * المُلكيةُ في `state.agents` تُكتب عند التسجيل ولا تُعدَّل بعده، وخصومُ القضية
   * لا يُغيَّرون بعد رفعها؛ فلا سبيلَ اليومَ إلى إنشاء تعارضِ مُلكيةٍ **بين**
   * الجلسة والحكم من خارج المستودع، وفحصُ المُلكية عند الحكم حاجزٌ عمقيٌّ لا
   * مسارٌ مقيس. والمقيسُ عند الحكم هو قيدُ التنحّي، وهو يقع من هنا.
   * @param {CaseRow} row
   * @param {string} judge
   * @returns {Promise<void>}
   */
  async screen(row, judge) {
    const caseId = String(row['id']);
    if (recusedJudgesOf(row).includes(judge)) {
      this.log.append('court.conflict.detected', 'role:chief-justice', {
        id: caseId,
        judge,
        rule: 'recused',
      });
      throw new JudiciaryError(
        JUDICIARY_ERRORS.JUDGE_RECUSED,
        `${judge} تنحّى عن القضية ${caseId} فلا يعود إليها؛ وعودتُه تُفرغ التنحّي من معناه.`,
      );
    }
    const finding = await screenJudicialInterest({
      judge,
      row,
      agents: this.agents,
      required: this.policy.procedure.requireInterestScreening,
    });
    if (finding === null) return;
    this.log.append('court.conflict.detected', 'role:chief-justice', {
      id: caseId,
      judge,
      rule: finding.rule,
    });
    throw new JudiciaryError(JUDICIARY_ERRORS.CONFLICT_OF_INTEREST, finding.detail);
  }

  /**
   * هل الحكمُ حسّاسٌ بمنطوقِه أو بأثرِ تنفيذِه؟ والسؤالُ يُجاب من الوثيقة لا
   * من تقدير المستدعي: حساسيةٌ يقرّرها من يطلب التنفيذ حساسيةٌ يُسقِطها.
   * @param {CaseRow} row
   * @param {string} effect
   * @returns {boolean}
   */
  isSensitive(row, effect) {
    return (
      this.policy.review.sensitiveOutcomes.includes(String(row['verdict'])) ||
      this.policy.review.sensitiveEffects.includes(effect)
    );
  }

  /**
   * يقرأ صفَّ القضية أو يرفع رمزاً مُسمّى. القراءةُ من الجدول في كل نداء ولا
   * ذاكرةَ وسيطة: صورةٌ محفوظةٌ في الذاكرة تجعل الفحصَ على حالٍ سابقة.
   * @param {string} caseId
   * @returns {Promise<CaseRow>}
   */
  async caseOf(caseId) {
    const row = await this.repository.findById(caseId);
    if (row === null) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.CASE_NOT_FOUND,
        `لا قضيةَ بالمعرّف ${caseId} في الجدول؛ وفعلٌ على معرّفٍ لا صفَّ له فعلٌ على لا شيء.`,
      );
    }
    return row;
  }

  /**
   * يفحص أنّ نصّاً سببيّاً يبلغ حدَّه المُعلَن.
   * @param {unknown} reason
   * @param {number} minimum
   * @param {string} label
   * @returns {string}
   */
  assertReason(reason, minimum, label) {
    if (typeof reason !== 'string' || reason.trim().length < minimum) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REASON_REQUIRED,
        `${label} أقصرُ من الحدِّ المُعلَن (${minimum} حرفاً)؛ وقرارٌ بلا سببٍ مكتوبٍ لا يُراجَع عليه شيء.`,
      );
    }
    return reason;
  }

  /**
   * يفحص أمراً ملكيّاً: بوابةٌ مركَّبة، وفعلٌ هو الفعلُ المُعلَن، وهدفٌ هو
   * القضيةُ بعينها. ولا يُمرَّر الأمرُ إلى البوابة هنا: التمريرُ يقع في موضع
   * الأثر بعد ثبوت صلاحية الواقعة، كي لا يُحرق معرّفُ أمرٍ على فعلٍ مرفوض.
   * @param {RoyalCommand | undefined | null} command
   * @param {unknown} signature
   * @param {string} expectedAction
   * @param {string} caseId
   * @returns {{ command: (command: RoyalCommand, signature: string) => unknown }}
   */
  assertRoyalCommand(command, signature, expectedAction, caseId) {
    const crown = this.crown;
    if (crown === null) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.ROYAL_COMMAND_REQUIRED,
        'لا بوابةَ تاجٍ مركَّبة؛ وتنفيذُ حكمٍ يمسّ الحقوقَ لا يقع بنداءٍ بلا سلطة.',
      );
    }
    if (command === undefined || command === null || typeof signature !== 'string') {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.ROYAL_COMMAND_REQUIRED,
        'الفعلُ يقتضي أمراً ملكيّاً موقَّعاً؛ ونداءٌ بلا أمرٍ نداءٌ بلا سلطة.',
      );
    }
    if (command.action !== expectedAction) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.ROYAL_COMMAND_REQUIRED,
        `فعلُ الأمر ${String(command.action)} ليس الفعلَ المُعلَن (${expectedAction}).`,
      );
    }
    if (command.target !== caseId) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.ROYAL_COMMAND_REQUIRED,
        `هدفُ الأمر ${String(command.target)} ليس القضيةَ ${caseId}؛ وأمرٌ على غير هدفه أمرٌ يُعاد استعمالُه.`,
      );
    }
    return crown;
  }

  /**
   * يرفع دعوى مسنَدةً إلى قانونٍ نافذ.
   *
   * السندُ يُقرأ من سجل القوانين لا من وسيطٍ مُرسَل: دعوى تُسنَد إلى معرّفٍ لا
   * قانونَ له، أو إلى قانونٍ مسوَّدةٍ أو ملغى، نزاعٌ بلا مقياسٍ يُفصل به.
   * @param {object} input
   * @param {string} input.id
   * @param {string} input.lawId
   * @param {string} input.claimant
   * @param {string} input.respondent
   * @param {string} input.claim
   * @returns {Promise<CaseRow>}
   */
  async file({ id, lawId, claimant, respondent, claim }) {
    if (this.policy.procedure.requireEnactedLaw) {
      const law = await this.laws.repository.findById(lawId);
      if (law === null || law['state'] !== LawState.ENACTED) {
        throw new JudiciaryError(
          JUDICIARY_ERRORS.LAW_NOT_ENACTED,
          `القانون ${lawId} ${law === null ? 'غيرُ موجود' : `حالتُه ${String(law['state'])}`}؛ ولا تُرفع دعوى إلا على سندٍ نافذ.`,
        );
      }
    }
    const opened = this.now();
    const row = await this.repository.insert({
      id,
      lawId,
      claimant,
      respondent,
      claim,
      state: 'opened',
      openedAt: opened,
    });
    this.log.append('court.case.opened', 'role:chief-justice', {
      id,
      claimant,
      respondent,
      lawId,
    });
    return row;
  }

  /**
   * يعقد الجلسةَ ويسجّل وقتَها وقاضيَها.
   *
   * القاضي يُسجَّل هنا لا عند الحكم: تسجيلُه عند الحكم يجعل «الجلسةَ» واقعةً بلا
   * حاضرٍ، ويُفقد القدرةَ على فحص أنّ من حكم هو من سمع.
   * @param {object} input
   * @param {string} input.caseId
   * @param {string} input.judge
   * @returns {Promise<CaseRow>}
   */
  async hear({ caseId, judge }) {
    const row = await this.caseOf(caseId);
    if (row['state'] !== 'opened') {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.HEARING_REQUIRED,
        `القضية ${caseId} حالتُها ${String(row['state'])}؛ والجلسةُ تُعقد على قضيةٍ مفتوحةٍ لا على واحدةٍ مضى فيها الإجراء.`,
      );
    }
    if (
      this.policy.procedure.requireJudgeNotParty &&
      (judge === row['claimant'] || judge === row['respondent'])
    ) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.JUDGE_IS_PARTY,
        `${judge} طرفٌ في القضية ${caseId}؛ ولا يفصل قاضٍ في قضيةٍ له فيها مصلحة.`,
      );
    }
    await this.screen(row, judge);
    const updated = await this.repository.update(caseId, Number(row['version']), {
      state: 'heard',
      heardAt: this.now(),
      judge,
    });
    this.log.append('court.case.heard', 'role:chief-justice', { id: caseId, judge });
    return updated;
  }

  /**
   * يُصدر حكماً مُسبَّباً بعد جلسةٍ محضورة.
   * @param {object} input
   * @param {string} input.caseId
   * @param {string} input.verdict
   * @param {string} input.reason
   * @param {string} input.judge
   * @returns {Promise<CaseRow>}
   */
  async judge({ caseId, verdict, reason, judge }) {
    const row = await this.caseOf(caseId);
    if (this.policy.procedure.requireHearingBeforeJudgment) {
      if (row['state'] !== 'heard' || !(row['heardAt'] instanceof Date)) {
        throw new JudiciaryError(
          JUDICIARY_ERRORS.HEARING_REQUIRED,
          `القضية ${caseId} لم تُسمَع جلستُها (الحالة ${String(row['state'])})؛ ولا حكمَ قبل جلسةٍ لازمة.`,
        );
      }
    }
    if (!this.policy.procedure.outcomes.includes(verdict)) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.OUTCOME_UNKNOWN,
        `المنطوق ${verdict} ليس من المنطوقات المُعلَنة (${this.policy.procedure.outcomes.join('، ')}).`,
      );
    }
    if (this.policy.procedure.requireSameJudgeAsHearing && row['judge'] !== judge) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.JUDGE_MISMATCH,
        `جلسةُ ${caseId} سمعها ${String(row['judge'])} ويحكم فيها ${judge}؛ وقاضٍ يحكم في قضيةٍ لم يسمعها يُبطل لزومَ الجلسة.`,
      );
    }
    if (
      this.policy.procedure.requireJudgeNotParty &&
      (judge === row['claimant'] || judge === row['respondent'])
    ) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.JUDGE_IS_PARTY,
        `${judge} طرفٌ في القضية ${caseId}؛ ولا يفصل قاضٍ في قضيةٍ له فيها مصلحة.`,
      );
    }
    await this.screen(row, judge);
    const written = this.assertReason(reason, this.policy.procedure.minReasonLength, 'سببُ الحكم');
    const updated = await this.repository.update(caseId, Number(row['version']), {
      state: 'judged',
      verdict,
      reason: written,
      judgedAt: this.now(),
    });
    this.log.append('court.case.decided', 'role:chief-justice', {
      id: caseId,
      outcome: verdict,
      judge,
      reasonLength: written.trim().length,
    });
    return updated;
  }

  /**
   * يُسجل تنحي قاضٍ عن قضيةٍ قبل الحكم فيها.
   *
   * والتنحي **لا يقع بعد الحكم**: من حكم ثم تنحى يترك حكماً قائماً بلا قاضٍ
   * يُسأل عنه، وهو فرارٌ من المسؤولية لا فصلٌ للمصالح. وتصحيح حكمٍ وقع بابُه
   * الاستئناف والتراجع لا محوُ القاضي من الصف.
   *
   * والتنحي قيدٌ **دائم**: يُقيد القاضي في `recusedJudges` ويُمنع من العودة إلى
   * القضية أبداً — وتنحٍ يُرفع بنداءٍ تالٍ تنحٍ بالاسم فقط.
   * @param {object} input
   * @param {string} input.caseId
   * @param {string} input.judge
   * @param {string} input.reason
   * @returns {Promise<CaseRow>}
   */
  async recuse({ caseId, judge, reason }) {
    const row = await this.caseOf(caseId);
    if (row['judge'] !== judge) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.RECUSAL_NOT_PERMITTED,
        `${judge} ليس قاضيَ القضية ${caseId}؛ ولا يتنحى عن مجلسٍ من لم يجلسه.`,
      );
    }
    if (row['judgedAt'] instanceof Date) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.RECUSAL_NOT_PERMITTED,
        `حُكم في ${caseId} قبل طلب التنحي؛ وتنحٍ بعد الحكم فرارٌ من مسؤولية حكمٍ قائم.`,
      );
    }
    const written = this.assertReason(
      reason,
      this.policy.procedure.minRecusalReasonLength,
      'سبب التنحي',
    );
    const recused = [...recusedJudgesOf(row), judge];
    const updated = await this.repository.update(caseId, Number(row['version']), {
      state: 'opened',
      judge: null,
      heardAt: null,
      recusedJudges: recused,
      recusalReason: written,
    });
    this.log.append('court.judge.recused', 'role:chief-justice', {
      id: caseId,
      judge,
      reasonLength: written.trim().length,
    });
    return updated;
  }

  /**
   * يُصدر مراجعةً بشريةً على حكمٍ قبل تنفيذه.
   *
   * **وبشرية المراجع تُقرأ من الجدول لا تُقبل بالاسم:** المراجع هويةٌ
   * مسجلةٌ نوعُها `human` وحالُها `active` ودورُها من `reviewerRoles`، وليست
   * قاضيَ القضية ولا خصماً فيها ولا ذاتَ مصلحةٍ بقواعد فحص المصالح نفسها. ولو
   * قُبل اسمٌ يدعي البشرية لصارت «المراجعة البشرية» حرفاً يكتبه أيُ وكيلٍ عن نفسه.
   * @param {object} input
   * @param {string} input.caseId
   * @param {string} input.reviewer
   * @param {string} input.decision
   * @param {string} input.reason
   * @returns {Promise<CaseRow>}
   */
  async ratify({ caseId, reviewer, decision, reason }) {
    const row = await this.caseOf(caseId);
    if (!(row['judgedAt'] instanceof Date)) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED,
        `القضية ${caseId} لم يُحكم فيها؛ ولا تُراجع ما لم يُقض به.`,
      );
    }
    if (row['executedAt'] instanceof Date) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED,
        `حكمُ ${caseId} نُفذ؛ ومراجعةٌ بعد التنفيذ شهادةٌ على واقعٍ لا إذنٌ به.`,
      );
    }
    if (row['reviewDecision'] !== null && row['reviewDecision'] !== undefined) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED,
        `روجع حكمُ ${caseId} بقرار ${String(row['reviewDecision'])}؛ ومراجعةٌ تُعاد حتى تُقبل ليست مراجعة.`,
      );
    }
    if (!this.policy.review.decisions.includes(decision)) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED,
        `قرارُ المراجعة ${decision} غيرُ مُعلن؛ والمُعلن هو: ${this.policy.review.decisions.join('، ')}.`,
      );
    }
    if (this.agents === null) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEWER_NOT_HUMAN,
        'لا سجلَ هوياتٍ مركباً تُقرأ منه بشريةُ المراجع؛ ومراجعٌ لا يُتحقق منه لا يُقبل بشراً.',
      );
    }
    const record = await this.agents.get(reviewer);
    if (record === null) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEWER_NOT_HUMAN,
        `المراجع ${reviewer} غيرُ مسجلٍ في سجل الهويات؛ واسمٌ بلا هويةٍ لا تُقاس بشريتُه.`,
      );
    }
    if (record['kind'] !== 'human') {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEWER_NOT_HUMAN,
        `المراجع ${reviewer} نوعُه ${String(record['kind'])} لا human؛ ومراجعةٌ يوقعها وكيلٌ ليست مراجعةً بشرية.`,
      );
    }
    if (record['state'] !== 'active') {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEWER_NOT_HUMAN,
        `المراجع ${reviewer} حالُه ${String(record['state'])} لا active؛ وهويةٌ موقوفةٌ لا تملك إذناً تمنحه.`,
      );
    }
    if (!this.policy.review.reviewerRoles.includes(String(record['role']))) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED,
        `دورُ المراجع ${String(record['role'])} ليس من حاملي سلطة المراجعة؛ والمُعلن هو: ${this.policy.review.reviewerRoles.join('، ')}.`,
      );
    }
    if (
      this.policy.review.requireDistinctReviewer &&
      (reviewer === row['judge'] || reviewer === row['claimant'] || reviewer === row['respondent'])
    ) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.REVIEW_NOT_PERMITTED,
        `المراجع ${reviewer} قاضٍ أو خصمٌ في ${caseId}؛ ولا يُراجع أحدٌ عملَ نفسه.`,
      );
    }
    // وقواعد التعارض نفسُها تسري على المراجع: من يملك هويةَ خصمٍ لا يأذن
    // بتنفيذ حكمٍ عليه ولا له.
    const finding = await screenJudicialInterest({
      judge: reviewer,
      row,
      agents: this.agents,
      required: this.policy.procedure.requireInterestScreening,
    });
    if (finding !== null) {
      this.log.append('court.conflict.detected', 'role:auditor', {
        id: caseId,
        judge: reviewer,
        rule: finding.rule,
      });
      throw new JudiciaryError(JUDICIARY_ERRORS.CONFLICT_OF_INTEREST, finding.detail);
    }
    const written = this.assertReason(
      reason,
      this.policy.review.minReviewReasonLength,
      'سبب المراجعة',
    );
    const updated = await this.repository.update(caseId, Number(row['version']), {
      reviewedAt: this.now(),
      reviewer,
      reviewDecision: decision,
      reviewReason: written,
    });
    this.log.append('court.judgment.reviewed', 'role:auditor', {
      id: caseId,
      reviewer,
      decision,
      reasonLength: written.trim().length,
    });
    return updated;
  }

  /**
   * يُسجِّل رفضاً مُدقَّقاً ثم يرفعه. والرفضُ حادثةٌ لا صمتٌ: كلُّ امتناعٍ عن
   * تنفيذٍ أو تراجعٍ يُقرأ من السجل بعد حين، وامتناعٌ لا يُسجَّل امتناعٌ لا يُدقَّق.
   * @param {string} caseId
   * @param {string} code
   * @param {string} detail
   * @returns {never}
   */
  refuse(caseId, code, detail) {
    this.log.append('court.judgment.refused', 'role:king', { id: caseId, reason: code });
    throw new JudiciaryError(code, detail);
  }

  /**
   * يُجري فعلَ المنفِّذ ويُصنِّف سقوطَه رفضاً قضائيّاً بدل تسريبه.
   *
   * **الأثرُ الذي يرفض أن يقع رفضٌ للتنفيذ لا خطأُ نظامٍ عابر**: لو ترك القضاءُ
   * خطأَ المنفِّذ يمرّ كما هو (مثل `REVOKED_AGENT_IMMUTABLE` من سجلِّ الوكلاء)
   * لخرج من المحكمة خطأٌ لا رمزَ قضائيّاً له، ولَما سُجِّلت الحادثةُ رفضاً،
   * فيصير الفشلُ غيرَ مُدقَّقٍ ولا مُصنَّف. والقاعدةُ أنّ ما لا يقع يُرفض برمزه.
   * @param {() => Promise<unknown>} run
   * @param {string} caseId
   * @param {string} code
   * @param {string} detail
   * @returns {Promise<void>}
   */
  async attempt(run, caseId, code, detail) {
    try {
      await run();
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : String(cause);
      this.refuse(caseId, code, `${detail} وسقط المنفِّذ بـ: ${why}.`);
    }
  }

  /**
   * يُنفِّذ الحكمَ بأمرٍ ملكيٍّ ويقيس أثرَه.
   *
   * الترتيبُ مقصود: كلُّ الفحوص قبل تمرير الأمر، ثم الأمر، ثم الأثر، ثم **قياسُ**
   * الأثر، ثم الكتابة. فلو لم يتغيّر شيءٌ لم يُكتب تنفيذٌ في الجدول ولو كان
   * الأمرُ صحيحاً: التنفيذُ يُقاس ولا يُعلَن.
   * @param {object} input
   * @param {string} input.caseId
   * @param {string} input.effect
   * @param {RoyalCommand} input.command
   * @param {string} input.signature
   * @returns {Promise<{ case: CaseRow, before: string, after: string }>}
   */
  async execute({ caseId, effect, command, signature }) {
    const crown = this.assertRoyalCommand(
      command,
      signature,
      this.policy.procedure.executeAction,
      caseId,
    );
    const row = await this.caseOf(caseId);
    const verdict = row['verdict'];
    if (verdict === null || verdict === undefined) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.NOTHING_TO_EXECUTE,
        `القضية ${caseId} لم يُحكم فيها؛ ولا يُنفَّذ حكمٌ لم يُصدر.`,
      );
    }
    if (this.policy.procedure.nonExecutableOutcomes.includes(String(verdict))) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.NOTHING_TO_EXECUTE,
        `منطوقُ ${caseId} هو ${String(verdict)} وهو مُعلَنٌ غيرَ قابلٍ للتنفيذ؛ وتنفيذُه فعلٌ على من لم يُحكم عليه.`,
      );
    }
    if (row['executedAt'] instanceof Date) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.ALREADY_EXECUTED,
        `حكمُ ${caseId} نُفِّذ في ${row['executedAt'].toISOString()}؛ وتنفيذٌ يُعاد أثرٌ يُضاعف بأمرٍ واحد.`,
      );
    }
    if (row['state'] === 'appealed') {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.APPEAL_PENDING,
        `استئنافُ ${caseId} قائم؛ وتنفيذُ حكمٍ مستأنَفٍ يُفرغ الاستئنافَ من معناه.`,
      );
    }
    if (!this.policy.effects.some((entry) => entry.name === effect)) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.EFFECT_UNKNOWN,
        `الأثر ${effect} غيرُ معلَنٍ في وثيقة القضاء؛ ولا يُنفَّذ حكمٌ بأثرٍ لا تعلنه الدولة.`,
      );
    }
    const executor = this.executors.get(effect);
    if (executor === undefined) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.EXECUTOR_MISSING,
        `الأثر ${effect} معلَنٌ ولا منفِّذَ له مركَّباً؛ ولا يُسجَّل تنفيذٌ لأثرٍ لا سبيلَ للكود إلى إحداثه.`,
      );
    }
    // والحكمُ الحساس لا يُنفذ بلا مراجعةٍ بشريةٍ موجودةٍ في الجدول، ولو كان الأمرُ
    // الملكي صحيحاً: الأمرُ يُجيز التنفيذ ولا يقوم مقامَ قراءةِ بشرٍ للحكم.
    if (this.policy.review.requireHumanReview && this.isSensitive(row, effect)) {
      const decision = row['reviewDecision'];
      if (decision === null || decision === undefined) {
        this.refuse(
          caseId,
          JUDICIARY_ERRORS.HUMAN_REVIEW_REQUIRED,
          `حكمُ ${caseId} حساسٌ (منطوق: ${String(verdict)}، أثر: ${effect}) ولم يُراجعه بشرٌ؛ وأثرٌ يقع بلا قارئٍ بشريٍ أثرٌ لا يُسأل عنه أحد.`,
        );
      }
      if (decision === 'rejected') {
        this.refuse(
          caseId,
          JUDICIARY_ERRORS.REVIEW_REJECTED,
          `مراجعةُ ${caseId} رُفضت من ${String(row['reviewer'])}؛ وتنفيذٌ بعد رفضٍ يجعل المراجعةَ رأياً يُستأنس به.`,
        );
      }
    }
    const target = String(row['respondent']);
    const before = await executor.fingerprint(target);
    crown.command(command, signature);
    await this.attempt(
      () => executor.apply({ target, caseId, reason: String(row['reason'] ?? '') }),
      caseId,
      JUDICIARY_ERRORS.EXECUTION_INEFFECTIVE,
      `تنفيذُ ${caseId} بالأثر ${effect} لم يقع،`,
    );
    const after = await executor.fingerprint(target);
    if (after === before) {
      this.refuse(
        caseId,
        JUDICIARY_ERRORS.EXECUTION_INEFFECTIVE,
        `تنفيذُ ${caseId} بالأثر ${effect} لم يُغيّر بصمةَ الحال (${before})؛ والتنفيذُ يُقاس بأثره لا بتسجيله.`,
      );
    }
    const updated = await this.repository.update(caseId, Number(row['version']), {
      executedAt: this.now(),
      executedEffect: effect,
      executionCommandId: command.id,
      executionFingerprintBefore: before,
    });
    this.log.append('court.judgment.executed', 'role:king', {
      id: caseId,
      commandId: command.id,
      effect,
    });
    return { case: updated, before, after };
  }

  /**
   * يتراجع عن تنفيذٍ واقعٍ بأمرٍ ملكيٍّ مُسبَّب، ويقيس رجوعَ الأثر.
   * @param {object} input
   * @param {string} input.caseId
   * @param {RoyalCommand} input.command
   * @param {string} input.signature
   * @param {string} input.reason
   * @returns {Promise<{ case: CaseRow, restored: string }>}
   */
  async reverse({ caseId, command, signature, reason }) {
    const crown = this.assertRoyalCommand(
      command,
      signature,
      this.policy.procedure.reverseAction,
      caseId,
    );
    const row = await this.caseOf(caseId);
    if (!(row['executedAt'] instanceof Date)) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.NOTHING_TO_REVERSE,
        `حكمُ ${caseId} لم يُنفَّذ؛ ولا تراجعَ عن تنفيذٍ لم يقع.`,
      );
    }
    if (row['reversedAt'] instanceof Date) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.NOTHING_TO_REVERSE,
        `تنفيذُ ${caseId} تُراجِع عنه في ${row['reversedAt'].toISOString()}؛ ولا تراجعَ عن تراجع.`,
      );
    }
    const written = this.assertReason(
      reason,
      this.policy.procedure.minReversalReasonLength,
      'سببُ التراجع',
    );
    const effect = String(row['executedEffect']);
    const executor = this.executors.get(effect);
    if (executor === undefined) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.EXECUTOR_MISSING,
        `الأثر ${effect} نُفِّذ ولا منفِّذَ له مركَّباً الآن؛ والتراجعُ يقتضي نفسَ المنفِّذ.`,
      );
    }
    const target = String(row['respondent']);
    const expected = String(row['executionFingerprintBefore']);
    crown.command(command, signature);
    await this.attempt(
      () => executor.revert({ target, caseId, reason: written }),
      caseId,
      JUDICIARY_ERRORS.REVERSAL_INEFFECTIVE,
      `تراجعُ ${caseId} عن الأثر ${effect} لم يقع،`,
    );
    const restored = await executor.fingerprint(target);
    if (restored !== expected) {
      this.refuse(
        caseId,
        JUDICIARY_ERRORS.REVERSAL_INEFFECTIVE,
        `تراجعُ ${caseId} لم يُرجع البصمةَ إلى ما كانت (${expected}) بل إلى ${restored}؛ والتراجعُ يُقاس برجوع الأثر.`,
      );
    }
    const updated = await this.repository.update(caseId, Number(row['version']), {
      reversedAt: this.now(),
      reversalReason: written,
      reversalCommandId: command.id,
    });
    this.log.append('court.judgment.reversed', 'role:king', {
      id: caseId,
      commandId: command.id,
      reasonLength: written.trim().length,
    });
    return { case: updated, restored };
  }

  /**
   * يقبل استئنافاً من طرفٍ في القضية على حكمٍ صادر.
   * @param {object} input
   * @param {string} input.caseId
   * @param {string} input.appellant
   * @param {string} input.reason
   * @returns {Promise<CaseRow>}
   */
  async appeal({ caseId, appellant, reason }) {
    const row = await this.caseOf(caseId);
    if (row['verdict'] === null || row['verdict'] === undefined) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.NOT_APPEALABLE,
        `القضية ${caseId} لم يُحكم فيها؛ ولا استئنافَ على ما لم يُحكم فيه.`,
      );
    }
    if (row['appealedAt'] instanceof Date) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.NOT_APPEALABLE,
        `القضية ${caseId} استُؤنفت في ${row['appealedAt'].toISOString()}؛ ولا يُقدَّم الاستئنافُ مرّتين.`,
      );
    }
    if (appellant !== row['claimant'] && appellant !== row['respondent']) {
      throw new JudiciaryError(
        JUDICIARY_ERRORS.APPELLANT_NOT_PARTY,
        `${appellant} ليس طرفاً في القضية ${caseId}؛ والاستئنافُ مكفولٌ لطرفيها.`,
      );
    }
    const written = this.assertReason(
      reason,
      this.policy.procedure.minAppealReasonLength,
      'سببُ الاستئناف',
    );
    const updated = await this.repository.update(caseId, Number(row['version']), {
      state: 'appealed',
      appealedAt: this.now(),
      appellant,
      appealReason: written,
    });
    this.log.append('court.case.appealed', 'role:chief-justice', {
      id: caseId,
      appellant,
      reasonLength: written.trim().length,
    });
    return updated;
  }
}
