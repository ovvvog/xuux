/**
 * السلطةُ التشريعية: ربطُ القانون بسياسته، ونفاذُه بأمرٍ ملكيّ، ومنعُ الإنفاذ
 * عند التعارض — الخطوة M8.02
 *
 * **العيوبُ الثلاثةُ التي يُغلقها هذا الملف** (وكلُّها قائمةٌ في
 * `src/governance/law-system.mjs` قبل هذه الخطوة، وتُقرأ في رأسه):
 *
 *   1. **قانونٌ لا يُنفِّذه شيء.** `propose({title, text, scope, proposer})` يقبل
 *      نصّاً حرّاً، ولا حقلَ يربط النصَّ بمادةٍ دستوريةٍ تسنده ولا بسياسةٍ
 *      تُنفِّذه، ولا موضعَ في الدولة يقرأ القوانينَ عند التفويض. فالقانونُ
 *      النافذُ كان صفّاً في جدولٍ لا أثرَ له في قرارٍ واحد. وهنا صار النفاذُ
 *      مشروطاً بمادةٍ قائمةٍ وبسياسةٍ **مُفعَّلة** مرجعُ قانونها هو مرجعُ المادة
 *      نفسِها — ربطٌ في الاتجاهين يُقاس، لا إحالةٌ في تعليق.
 *
 *   2. **«اعتمادُ التاج» كان مقارنةَ نصّ.** `transition(id, 'enacted', actor)`
 *      يرفض إن كان `actor !== 'crown'`، أي أنّ كلَّ من يكتب الحرفَ `crown` في
 *      وسيطٍ صار تاجاً. وهنا لا يقع النفاذُ إلا بأمرٍ ملكيٍّ موقَّعٍ يمرُّ
 *      ببوابة التاج (`CrownGateway.command`): توقيعٌ يُتحقَّق، ومعرّفٌ لا يُعاد،
 *      وعمرٌ لا يُتجاوز، وشهادةٌ تُقرأ منها الصلاحية.
 *
 *   3. **التعارضُ كان يُحسم صامتاً.** غَلَبةُ الرفض والأولويةُ ثم ترتيبُ
 *      المعرّفات أبجدياً تجعل تضادَّ مشرِّعَين قراراً لا يعلمه أحد. وهنا يُكشف
 *      قبل النفاذ (`conflict-engine.mjs`)، ويُمنع نفاذُ القانون الذي يُنشئ
 *      تعارضاً مانعاً، ويُمنع **إنفاذُ الأفعال المتقاطعة** ما دام التعارض قائماً
 *      — عبر `EnforcementPoint`، أي في المسار الواقع لا في تقريرٍ جانبي.
 *
 * **وحدٌّ معلَن (الحلُّ يُقاس ولا يُعلَن):** `resolve` لا تُسجِّل «حُلَّ» بل
 * تُنفِّذ تغييراً في البيانات (تعليقُ أحد القانونين) ثم **تُعيد الكشف**: إن لم
 * تنقص بصمةُ التعارضات المانعة رُفض الأمرُ برمز `LEGISLATION_RESOLUTION_INEFFECTIVE`
 * ولم يُترك أثرُ حلٍّ في السجل. فلا يوجد في هذه الخطوة عَلَمٌ يُرفع اسمُه
 * «مَحلولٌ» — الحالةُ محسوبةٌ من البيانات دائماً.
 *
 * **وحدٌّ معلَن ثانٍ:** القوانينُ المربوطةُ تُقرأ من `LawRegistry` عند كل نداء،
 * ولا ذاكرةَ وسيطة. وهذا يُثقل النداءَ بقراءةٍ للجدول مقابل ألّا يوجد كشفٌ
 * يُحسب على صورةٍ قديمة. والاختيارُ مقصود، والبديلُ (ذاكرةٌ بإبطالٍ عند التغيير)
 * مسجَّل في `docs/REMAINING_WORK.md`.
 */

import { LawState } from '../governance/law-system.mjs';
import { blockedActions, conflictFingerprint, detectConflicts } from './conflict-engine.mjs';
import { LEGISLATION_ERRORS, LegislationError } from './legislation.mjs';

/** @typedef {import('./conflict-engine.mjs').BoundLaw} BoundLaw */
/** @typedef {import('./conflict-engine.mjs').LegislationConflict} LegislationConflict */
/** @typedef {import('./legislation.mjs').LegislationPolicy} LegislationPolicy */
/** @typedef {import('../policy/loader.mjs').PolicyBundle} PolicyBundle */
/** @typedef {import('../root-of-trust/crown.mjs').RoyalCommand} RoyalCommand */

/**
 * أنواعُ أحداثِ قناة القوانين التي تنشأ في هذا الملف. القيمُ تُكتب حرفياً في
 * مواضع النشر (يقتضيه المُستخرِج الساكن في `scripts/lib/event-emissions.mjs`)،
 * وهذا الجدولُ للقارئ ولمن يستهلك القناة.
 */
export const LEGISLATION_EVENTS = Object.freeze({
  BOUND: 'law.bound',
  BINDING_REFUSED: 'law.binding.refused',
  CONFLICT_DETECTED: 'law.conflict.detected',
  CONFLICT_RESOLVED: 'law.conflict.resolved',
  ENFORCEMENT_BLOCKED: 'law.enforcement.blocked',
});

/**
 * السلطةُ التشريعية.
 */
export class Legislature {
  /**
   * الاعتماديةُ الوحيدةُ الاختياريةُ حقّاً هي بوابةُ التاج: تركُها يجعل
   * `enact` ترفض دائماً برمز `LEGISLATION_ROYAL_COMMAND_REQUIRED` — وهو الفشلُ
   * المُغلَق: دولةٌ بلا تاجٍ مركَّبٍ لا تُصدر قانوناً، ولا تُصدره بمقارنةِ نصّ.
   * @param {object} deps
   * @param {LegislationPolicy} deps.policy - وثيقةُ التشريع المُحمَّلة
   * @param {PolicyBundle} deps.bundle - حزمةُ السياسات المُحمَّلة
   * @param {readonly { id: string, lawRef: string }[]} deps.articles - موادُّ الدستور القائمة
   * @param {import('../governance/law-system.mjs').LawRegistry} deps.laws
   * @param {import('../root-of-trust/event-log.mjs').EventLog} deps.log
   * @param {{ command: (command: RoyalCommand, signature: string) => unknown } | null} [deps.crown]
   */
  constructor({ policy, bundle, articles, laws, log, crown = null }) {
    if (!policy || !bundle || !articles || !laws || !log) {
      throw new Error('LEGISLATURE_DEPENDENCY_MISSING');
    }
    this.policy = policy;
    this.bundle = bundle;
    this.articles = articles;
    this.laws = laws;
    this.log = log;
    this.crown = crown;
    /**
     * الربطُ المقروءُ من صفوف القوانين. لا يُكتب هنا شيءٌ لا يوجد في الجدول:
     * الحقلان `articleId` و`policyIds` عمودان في `state.laws` (الهجرة 0011).
     * @type {Map<string, BoundLaw>}
     */
    this.pending = new Map();
  }

  /**
   * يفحص شرطَ الربط ويرفع خطأً مُسمّى عند أول خُلف. لا يكتب شيئاً: الفحصُ
   * منفصلٌ عن الأثر كي يُستدعى قبل الأمر الملكيّ وبعده بالنتيجة نفسها.
   * @param {{ text: string, scope: string, articleId: string, policyIds: readonly string[] }} draft
   * @returns {{ article: { id: string, lawRef: string } }}
   */
  assertBindable(draft) {
    const binding = this.policy.binding;
    if (typeof draft.text !== 'string' || draft.text.trim().length < binding.minTextLength) {
      throw new LegislationError(
        LEGISLATION_ERRORS.TEXT_TOO_SHORT,
        `نصُّ القانون أقصرُ من الحدِّ المُعلَن (${binding.minTextLength} حرفاً)؛ ونصٌّ لا يُقاس عليه إنفاذٌ ليس قانوناً.`,
      );
    }
    if (typeof draft.scope !== 'string' || draft.scope.trim() === '') {
      throw new LegislationError(
        LEGISLATION_ERRORS.BINDING_REQUIRED,
        'القانونُ بلا نطاقٍ معلَن؛ ونطاقٌ غائبٌ يسري على كل شيءٍ بلا أن يقول ذلك.',
      );
    }
    const article = this.articles.find((entry) => entry.id === draft.articleId);
    if (article === undefined) {
      throw new LegislationError(
        LEGISLATION_ERRORS.ARTICLE_UNKNOWN,
        `المادةُ ${String(draft.articleId)} ليست في الدستور المُحمَّل؛ وقانونٌ بلا سندٍ أعلى لا يُقاس دستوريتُه.`,
      );
    }
    const policyIds = draft.policyIds ?? [];
    if (policyIds.length < binding.minPolicies) {
      throw new LegislationError(
        LEGISLATION_ERRORS.BINDING_REQUIRED,
        `القانونُ بلا سياسةٍ تُنفِّذه (المطلوب ${binding.minPolicies} على الأقل)؛ وقانونٌ لا يُنفِّذه شيءٌ نصٌّ في جدول.`,
      );
    }
    for (const id of policyIds) {
      const record = this.bundle.policies.find((entry) => entry.id === id);
      if (record === undefined) {
        throw new LegislationError(
          LEGISLATION_ERRORS.POLICY_UNKNOWN,
          `السياسةُ ${id} غيرُ معلَنةٍ في حزمة السياسات؛ والربطُ بها ربطٌ بمعرّفٍ لا وجودَ له.`,
        );
      }
      if (!record.enabled) {
        throw new LegislationError(
          LEGISLATION_ERRORS.POLICY_DISABLED,
          `السياسةُ ${id} معلَّقة؛ وقانونٌ أداةُ إنفاذه نائمةٌ قانونٌ معطَّلٌ يُعَدُّ نافذاً.`,
        );
      }
      if (binding.requireLawRefMatch && record.lawRef !== article.lawRef) {
        throw new LegislationError(
          LEGISLATION_ERRORS.LAWREF_MISMATCH,
          `السياسةُ ${id} مرجعُ قانونها ${record.lawRef ?? '—'} والمادةُ ${article.id} مرجعُها ${article.lawRef}؛ وسلسلةُ السند لا تُقرأ إن اختلفا.`,
        );
      }
    }
    return { article };
  }

  /**
   * القوانينُ النافذةُ المربوطة، كما تُقرأ من الجدول الآن.
   * @returns {Promise<readonly BoundLaw[]>}
   */
  async bound() {
    const rows = await this.laws.repository.list({ filter: { state: LawState.ENACTED } });
    /** @type {BoundLaw[]} */
    const laws = [];
    for (const row of rows) {
      const articleId = row['articleId'];
      const policyIds = row['policyIds'];
      // صفٌّ نافذٌ بلا ربطٍ لا يُقرأ قانوناً هنا ولا يُسقَط في صمت: قيدُ الهجرة
      // 0011 يمنع وجودَه، فإن وُجد فهو صفٌّ سابقٌ للهجرة ويُبلَّغ عنه حدثاً.
      if (typeof articleId !== 'string' || !Array.isArray(policyIds) || policyIds.length === 0) {
        this.log.append('law.binding.refused', 'role:auditor', {
          id: String(row['id']),
          reason: LEGISLATION_ERRORS.BINDING_REQUIRED,
          open: true,
        });
        continue;
      }
      laws.push(
        Object.freeze({
          id: String(row['id']),
          articleId,
          policyIds: Object.freeze(policyIds.map((value) => String(value))),
          scope: String(row['scope']),
        }),
      );
    }
    return Object.freeze(laws);
  }

  /**
   * الكشفُ الحاليُّ للتعارض على القوانين النافذة، مع إمكان إضافةِ مرشَّحٍ لم
   * يَنفُذ بعد — وهو ما يجعل الكشفَ **قبل** النفاذ لا بعده.
   * @param {BoundLaw | null} [candidate]
   * @returns {Promise<readonly LegislationConflict[]>}
   */
  async conflicts(candidate = null) {
    const laws = await this.bound();
    const all = candidate === null ? laws : [...laws, candidate];
    return detectConflicts({ laws: all, bundle: this.bundle, policy: this.policy });
  }

  /**
   * الأفعالُ الممنوعةُ إنفاذاً الآن. هذه هي الدالّةُ التي تقرؤها نقطةُ
   * الإنفاذ، وهي تُحسب من البيانات في كل نداء.
   * @returns {Promise<ReadonlySet<string>>}
   */
  async blocked() {
    return blockedActions(await this.conflicts());
  }

  /**
   * يُصدر قانوناً: يفحص الربطَ، ثم يمرِّر الأمرَ الملكيَّ ببوابة التاج، ثم يكشف
   * التعارضَ **قبل** الانتقال إلى النفاذ، ثم ينقل الحالة ويثبّت الربط.
   *
   * الترتيبُ مقصود: الفحصُ قبل الأمر كي لا يُحرق معرّفُ أمرٍ على قانونٍ مرفوض،
   * والكشفُ بعد قبول الأمر وقبل الانتقال كي لا يَنفُذ نصٌّ يُنشئ تعارضاً مانعاً.
   * @param {object} input
   * @param {string} input.lawId
   * @param {string} input.articleId
   * @param {readonly string[]} input.policyIds
   * @param {RoyalCommand} input.command
   * @param {string} input.signature
   * @returns {Promise<{ law: Record<string, unknown>, conflicts: readonly LegislationConflict[] }>}
   */
  async enact({ lawId, articleId, policyIds, command, signature }) {
    if (this.crown === null) {
      throw new LegislationError(
        LEGISLATION_ERRORS.ROYAL_COMMAND_REQUIRED,
        'لا بوابةَ تاجٍ مركَّبة؛ والنفاذُ لا يقع بمقارنةِ اسمِ فاعلٍ بالنصِّ «crown».',
      );
    }
    if (command === undefined || command === null || typeof signature !== 'string') {
      throw new LegislationError(
        LEGISLATION_ERRORS.ROYAL_COMMAND_REQUIRED,
        'النفاذُ يقتضي أمراً ملكيّاً موقَّعاً؛ ونداءٌ بلا أمرٍ نداءٌ بلا سلطة.',
      );
    }
    if (command.action !== this.policy.binding.enactAction) {
      throw new LegislationError(
        LEGISLATION_ERRORS.ROYAL_COMMAND_REQUIRED,
        `فعلُ الأمر ${command.action} ليس فعلَ النفاذ المُعلَن (${this.policy.binding.enactAction}).`,
      );
    }
    if (command.target !== lawId) {
      throw new LegislationError(
        LEGISLATION_ERRORS.ROYAL_COMMAND_REQUIRED,
        `هدفُ الأمر ${command.target} ليس القانونَ ${lawId}؛ وأمرٌ على غير هدفه أمرٌ يُعاد استعمالُه.`,
      );
    }
    const row = await this.laws.repository.findById(lawId);
    if (row === null) throw new Error('LAW_NOT_FOUND');
    const text = String(row['text'] ?? '');
    const scope = String(row['scope'] ?? '');
    this.assertBindable({ text, scope, articleId, policyIds });

    /** @type {BoundLaw} */
    const candidate = Object.freeze({
      id: lawId,
      articleId,
      policyIds: Object.freeze([...policyIds]),
      scope,
    });
    const conflicts = await this.conflicts(candidate);
    const blocking = conflicts.filter((conflict) => conflict.blocking);
    if (blocking.length > 0) {
      // البلاغُ يقع **قبل** الرفض: تعارضٌ مكشوفٌ لا واقعةَ له يبقى معلوماً
      // للفاحص وحده، ودولةٌ تُخفي تعارضَها تُخفي سببَ رفضِها.
      this.log.append('law.conflict.detected', 'role:king', {
        id: lawId,
        count: blocking.length,
        codes: blocking.map((conflict) => conflict.code),
        open: true,
      });
      throw new LegislationError(
        LEGISLATION_ERRORS.CONFLICT_UNRESOLVED,
        `نفاذُ ${lawId} يُنشئ ${blocking.length} تعارضاً مانعاً: ${blocking.map((conflict) => `${conflict.code} (${conflict.detail})`).join(' | ')}`,
      );
    }
    // الأمرُ الملكيُّ يُقبل بعد ثبوت صلاحية النصِّ وخلوِّه من التعارض: أمرٌ
    // يُحرَق معرّفُه على قانونٍ مرفوضٍ يمنع إعادةَ إصداره بعد التصحيح.
    this.crown.command(command, signature);
    const updated = await this.laws.repository.update(lawId, Number(row['version']), {
      state: LawState.ENACTED,
      articleId,
      policyIds: [...policyIds],
      enactedBy: 'crown',
      enactedAt: row['enactedAt'] instanceof Date ? row['enactedAt'] : new Date(),
      stateChangedAt: new Date(),
    });
    this.log.append('law.bound', 'role:king', {
      id: lawId,
      articleId,
      policyIds: [...policyIds],
      commandId: command.id,
    });
    this.log.append('law.enacted', 'crown', { id: lawId, version: updated['version'] });
    return { law: updated, conflicts };
  }

  /**
   * يحلُّ تعارضاً بأمرٍ ملكيٍّ: يعلّق أحدَ القانونين، ثم **يقيس** زوالَ
   * التعارض. وإن لم تنقص البصمةُ المانعة رُدَّ الأمرُ ولم يُسجَّل حلٌّ.
   * @param {object} input
   * @param {string} input.lawId - القانونُ الذي يُعلَّق حلاًّ للتعارض
   * @param {RoyalCommand} input.command
   * @param {string} input.signature
   * @param {string} input.reason
   * @returns {Promise<{ before: string, after: string, resolved: number }>}
   */
  async resolve({ lawId, command, signature, reason }) {
    if (this.crown === null) {
      throw new LegislationError(
        LEGISLATION_ERRORS.ROYAL_COMMAND_REQUIRED,
        'حلُّ التعارض قرارٌ سياديٌّ موقَّع؛ ولا بوابةَ تاجٍ مركَّبة.',
      );
    }
    if (command.action !== this.policy.binding.resolveAction) {
      throw new LegislationError(
        LEGISLATION_ERRORS.ROYAL_COMMAND_REQUIRED,
        `فعلُ الأمر ${command.action} ليس فعلَ حلِّ التعارض المُعلَن (${this.policy.binding.resolveAction}).`,
      );
    }
    if (typeof reason !== 'string' || reason.trim().length < 20) {
      throw new LegislationError(
        LEGISLATION_ERRORS.RESOLUTION_INEFFECTIVE,
        'حلُّ التعارض بلا سببٍ مكتوبٍ مُفصَّل؛ وقرارٌ بلا سببٍ لا يُراجَع.',
      );
    }
    const before = conflictFingerprint(await this.conflicts());
    if (before === '') {
      throw new LegislationError(
        LEGISLATION_ERRORS.RESOLUTION_INEFFECTIVE,
        'لا تعارضَ مانعاً قائماً؛ وتعليقُ قانونٍ بلا تعارضٍ إسقاطٌ لنافذٍ باسم الحلّ.',
      );
    }
    this.crown.command(command, signature);
    await this.laws.transition(lawId, LawState.SUSPENDED, 'crown');
    const after = conflictFingerprint(await this.conflicts());
    if (after === before) {
      throw new LegislationError(
        LEGISLATION_ERRORS.RESOLUTION_INEFFECTIVE,
        `تعليقُ ${lawId} لم يُزل شيئاً من التعارض المانع (${before}); والحلُّ يُقاس بزوال أثره لا بتسجيله.`,
      );
    }
    const resolved = before.split(' ; ').length - (after === '' ? 0 : after.split(' ; ').length);
    this.log.append('law.conflict.resolved', 'role:king', {
      id: lawId,
      commandId: command.id,
      reason,
      resolved,
    });
    return { before, after, resolved };
  }
}

/**
 * بوابةُ التشريع كما تقرؤها نقطةُ الإنفاذ: كائنٌ بدالّةٍ واحدة تردّ الأفعالَ
 * الممنوعة. وحصرُ الواجهة على هذا القدر مقصود: نقطةُ الإنفاذ لا يجوز أن تملك
 * سبيلاً إلى `enact` أو `resolve`، وإلا صار الإنفاذُ قادراً على التشريع.
 * @param {Legislature} legislature
 * @returns {{ blockedActions: () => Promise<ReadonlySet<string>> }}
 */
export function enforcementGate(legislature) {
  return Object.freeze({
    blockedActions: () => legislature.blocked(),
  });
}
