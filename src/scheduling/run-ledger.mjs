/**
 * دفترُ الإطلاقاتِ المُجدوَلةِ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
 *
 * **لِمَ دفترٌ لا متغيِّرٌ في الذاكرةِ:** معيارُ إغلاقِ `D-4` نصُّه «مُجدوِلٌ
 * يُطلِقُ التقاريرَ والتمارينَ بلا نداءٍ يدويٍّ، **مقيسٌ بواقعةٍ في دفترٍ**».
 * ومُجدوِلٌ يحفظُ «آخرَ تشغيلٍ» في الذاكرةِ الحيّةِ يُعيدُ كلَّ شيءٍ عندَ إعادةِ
 * التشغيلِ: يُطلِقُ عملاً وقعَ قبلَ دقيقةٍ، ولا يعرفُ أحدٌ بعدَ ساعةٍ أنّه وقعَ
 * مرّتَينِ. فالدفترُ هو **موضعُ الحقيقةِ** للموعدِ وللقفلِ معاً.
 *
 * **والقفلُ قيدٌ في القاعدةِ لا شرطٌ في الكودِ:** تفرُّدُ `(jobId, slotAt, phase)`
 * يجعلَ إطلاقَ الشقِّ نفسِه مرّتَينِ **مستحيلاً** ولو عملت نسختانِ من المُجدوِلِ
 * معاً؛ إحداهما تفشلُ بتضاربٍ مُسمّى من المستودعِ لا بكتابةٍ مزدوجةٍ صامتةٍ.
 * ولذلك حجزُ الشقِّ يُكتَبُ **قبلَ** تشغيلِ العملِ لا بعدَه: كتابتُه بعدَه تجعلُ
 * انقطاعاً في المنتصفِ يُقرأُ «لم يقعْ» فيُعادُ العملُ.
 *
 * **والسلسلةُ بالتجزئةِ كدفترِ المحوِ:** حذفُ واقعةٍ أو تعديلُها مكشوفٌ بـ
 * `verify()`. والتجزئةُ تُحسبُ على `recordedAt` **نصّاً** لا على عمودٍ زمنيٍّ،
 * لأنّ فرقَ الدقّةِ بين ساعةِ القاعدةِ و`Date` يكسرُ السلسلةَ على البريءِ — وهو
 * انحرافٌ سقطَ فيه المشروعُ مرّةً في `M3.05`.
 *
 * **حدٌّ معلَنٌ:** السلسلةُ **واحدةٌ للدفترِ كلِّه** لا سلسلةٌ لكلِّ عملٍ. وأثرُ
 * ذلك أنّ الكتابةَ متسلسلةٌ (`seq` فريدٌ)، فنبضتانِ متوازيتانِ تتنافسانِ على نفسِ
 * الرقمِ وتفشلُ إحداهما بتضاربٍ مُسمّى — وهو المطلوبُ لا عيبٌ.
 *
 * @module scheduling/run-ledger
 */

import { createHash, randomUUID } from 'node:crypto';

import { SCHEDULER_ERRORS, SchedulerError } from './errors.mjs';

/** أولُ وصلةٍ في السلسلةِ. */
export const SCHEDULED_RUN_GENESIS = 'genesis';

/**
 * أطوارُ الواقعةِ: حجزٌ ثمّ نتيجةٌ. و**الحجزُ ليس نجاحاً**: قراءةُ الموعدِ تعتمدُ
 * `completed` وحدَه، فانقطاعٌ بعدَ الحجزِ يبقى ظاهراً شقّاً محجوزاً بلا نتيجةٍ لا
 * شقّاً ناجحاً ولا شقّاً لم يقعْ.
 */
export const SCHEDULED_RUN_PHASES = Object.freeze(['dispatched', 'completed', 'failed']);

/**
 * نوعُ الحدثِ لكلِّ طورٍ — **للقراءةِ والاختبارِ**، والنشرُ نفسُه يكتبُ النوعَ
 * نصّاً حرفيّاً في موضعِه (انظر `append`): نوعٌ يُبنى بالتضمينِ أو بفهرسةِ كائنٍ
 * لا يراهُ مُستخرِجُ مواضعِ النشرِ، فيُقرأُ العقدُ إعلاناً بلا مُنتِجٍ — وحاجزٌ
 * يُخدَعُ بتركيبِ نصٍّ ليس حاجزاً.
 */
export const PHASE_EVENT_TYPES = Object.freeze({
  dispatched: 'scheduler.job.dispatched',
  completed: 'scheduler.job.completed',
  failed: 'scheduler.job.failed',
});

/**
 * تمثيلٌ قانونيٌّ للتفصيلِ: مفاتيحُه مرتَّبةٌ. تجزئةٌ تتغيّرُ بترتيبِ مفاتيحِ
 * كائنٍ تُبلّغُ عن كسرٍ لم يقعْ، فيُهمَلُ التبليغُ كلُّه بعدَ أوّلِ إنذارٍ كاذبٍ.
 * @param {Record<string, unknown>} detail
 * @returns {Array<[string, unknown]>}
 */
function canonicalDetail(detail) {
  return Object.keys(detail)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => /** @type {[string, unknown]} */ ([key, detail[key]]));
}

/**
 * تجزئةُ واقعةٍ واحدةٍ. الترتيبُ ثابتٌ ومكتوبٌ مرّةً واحدةً ويُستعملُ للكتابةِ
 * وللفحصِ معاً: حسابانِ منفصلانِ لنفسِ القيمةِ يفترقانِ أوّلَ تعديلٍ فيصيرُ الفحصُ
 * إنذاراً كاذباً.
 * @param {{ prevHash: string, seq: number, jobId: string, slotAt: string, phase: string, actorId: string, decisionId: string, detail: Record<string, unknown>, recordedAt: string }} input
 * @returns {string}
 */
export function scheduledRunHash({
  prevHash,
  seq,
  jobId,
  slotAt,
  phase,
  actorId,
  decisionId,
  detail,
  recordedAt,
}) {
  const canonical = JSON.stringify([
    prevHash,
    seq,
    jobId,
    slotAt,
    phase,
    actorId,
    decisionId,
    canonicalDetail(detail),
    recordedAt,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * عيبٌ واحدٌ في صفٍّ من السلسلةِ أو `null` إن كان سليماً. والفحصُ يُعيدُ حسابَ
 * التجزئةِ أيضاً لا الوصلةَ وحدَها: بلا إعادةِ الحسابِ يمرُّ **تعديلُ الصفِّ
 * الأخيرِ** بلا كشفٍ، لأنّ لا صفَّ بعدَه يحملُ تجزئتَه.
 * @param {Record<string, unknown>} row
 * @param {string} expectedPrev
 * @param {number} expectedSeq
 * @returns {string | null}
 */
export function runChainFault(row, expectedPrev, expectedSeq) {
  const seq = Number(row['seq']);
  if (seq !== expectedSeq) {
    return `ثغرةٌ في التسلسلِ: المتوقّعُ ${expectedSeq} والموجودُ ${seq} — واقعةٌ حُذفت أو أُدرجت خارجَ الدفترِ.`;
  }
  if (row['prevHash'] !== expectedPrev) {
    return 'الوصلةُ بما قبلَها مكسورةٌ: الواقعةُ السابقةُ عُدِّلت أو حُذفت.';
  }
  const recomputed = scheduledRunHash({
    prevHash: String(row['prevHash']),
    seq,
    jobId: String(row['jobId']),
    slotAt: String(row['slotAt']),
    phase: String(row['phase']),
    actorId: String(row['actorId']),
    decisionId: String(row['decisionId']),
    detail: /** @type {Record<string, unknown>} */ (row['detail'] ?? {}),
    recordedAt: String(row['recordedAt']),
  });
  return recomputed === row['hash']
    ? null
    : 'التجزئةُ لا تطابقُ حقولَ الواقعةِ: عُدِّلت بعدَ كتابتِها.';
}

/**
 * @typedef {object} RunRepository
 * @property {(record: Record<string, unknown>) => Promise<Record<string, unknown>>} insert
 * @property {(query?: object) => Promise<Array<Record<string, unknown>>>} list
 */

/** دفترُ الإطلاقاتِ: يُكتَبُ فيه ولا يُعدَّلُ، ويُفحَصُ بسلسلتِه. */
export class ScheduledRunLedger {
  /**
   * @param {object} deps
   * @param {RunRepository} deps.repository
   * @param {{ append: (type: string, actor: string, data: object) => unknown } | undefined} [deps.log]
   * @param {(() => Date) | undefined} [deps.now]
   */
  constructor({ repository, log, now }) {
    if (repository === undefined || repository === null) {
      throw new SchedulerError(
        SCHEDULER_ERRORS.INPUT_INVALID,
        'دفترُ الإطلاقاتِ يحتاجُ مستودعاً: دفترٌ بلا مستودعٍ موعدٌ يزولُ بإعادةِ التشغيلِ، وقفلٌ لا يقفلُ.',
      );
    }
    this.repository = repository;
    this.log = log ?? undefined;
    this.now = now ?? (() => new Date());
  }

  /**
   * أعلى تسلسلٍ وأحدثُ تجزئةٍ في الدفترِ. يُقرآنِ من المستودعِ في كلِّ كتابةٍ لا
   * يُحفظانِ في الذاكرةِ: رأسٌ محفوظٌ في عمليّةٍ يفترقُ عن الدفترِ أوّلَ كتابةٍ من
   * عمليّةٍ أخرى، فتُكتَبُ وصلةٌ إلى ماضٍ لم يعدْ آخراً.
   * @returns {Promise<{ seq: number, hash: string }>}
   */
  async #head() {
    const rows = await this.repository.list({});
    if (rows.length === 0) return { seq: 0, hash: SCHEDULED_RUN_GENESIS };
    const sorted = [...rows].sort((left, right) => Number(left['seq']) - Number(right['seq']));
    const last = /** @type {Record<string, unknown>} */ (sorted[sorted.length - 1]);
    return { seq: Number(last['seq']), hash: String(last['hash']) };
  }

  /**
   * كتابةُ واقعةٍ في الدفترِ.
   * @param {{ jobId: string, slotAt: number, phase: 'dispatched' | 'completed' | 'failed', actorId: string, decisionId: string, detail?: Record<string, unknown> }} input
   * @returns {Promise<Record<string, unknown>>}
   */
  async append({ jobId, slotAt, phase, actorId, decisionId, detail = {} }) {
    if (!SCHEDULED_RUN_PHASES.includes(phase)) {
      throw new SchedulerError(
        SCHEDULER_ERRORS.INPUT_INVALID,
        `طورٌ غيرُ معلَنٍ للواقعةِ: «${phase}»؛ وطورٌ مخترعٌ يجعلُ قراءةَ الموعدِ تتجاهلُ واقعةً وقعت.`,
        { phase },
      );
    }
    if (!Number.isSafeInteger(slotAt)) {
      throw new SchedulerError(
        SCHEDULER_ERRORS.INPUT_INVALID,
        'الشقُّ ليس عدداً صحيحاً: شقٌّ بلا اسمٍ محسوبٍ لا يصلحُ قفلاً.',
        { slotAt },
      );
    }
    const head = await this.#head();
    const seq = head.seq + 1;
    const recordedAt = this.now().toISOString();
    const slotText = new Date(slotAt).toISOString();
    const hash = scheduledRunHash({
      prevHash: head.hash,
      seq,
      jobId,
      slotAt: slotText,
      phase,
      actorId,
      decisionId,
      detail,
      recordedAt,
    });
    const record = await this.repository.insert({
      id: randomUUID(),
      jobId,
      slotAt: slotText,
      phase,
      actorId,
      decisionId,
      detail,
      seq,
      recordedAt,
      prevHash: head.hash,
      hash,
    });
    // النشرُ بثلاثةِ نداءاتٍ بأنواعٍ **حرفيّةٍ** لا بنداءٍ واحدٍ بنوعٍ مُفهرَسٍ:
    // مُستخرِجُ مواضعِ النشرِ يقرأُ الوسيطَ الأوّلَ سكونيّاً، ونوعٌ يأتي من فهرسةِ
    // كائنٍ لا يراهُ — فيصيرُ العقدُ مُعلَناً بلا موضعِ نشرٍ مقيسٍ، ويُقرأُ
    // إعلاناً بلا مُنتِجٍ. والحاجزُ محقٌّ: عقدٌ لا يُقاسُ موضعُه وعدٌ.
    // والحملُ **كائنٌ حرفيٌّ في كلِّ موضعٍ** لا متغيّرٌ يُمرَّرُ: حملٌ لا تُقرأُ
    // حقولُه سكونيّاً يُعفى من مقايسةِ المفاتيحِ، فيصيرُ العقدُ المُعلَنُ مغلقاً
    // **غيرَ مقيسٍ** — وذاك ادّعاءُ ضمانٍ لا ضمانٌ.
    if (phase === 'dispatched') {
      this.log?.append('scheduler.job.dispatched', actorId, {
        jobId,
        slotAt: slotText,
        phase,
        seq,
      });
    } else if (phase === 'completed') {
      this.log?.append('scheduler.job.completed', actorId, {
        jobId,
        slotAt: slotText,
        phase,
        seq,
      });
    } else {
      this.log?.append('scheduler.job.failed', actorId, { jobId, slotAt: slotText, phase, seq });
    }
    return record;
  }

  /**
   * أطوارُ شقٍّ بعينِه. تُقرأُ قبلَ الحجزِ: شقٌّ محجوزٌ لا يُحجَزُ ثانيةً، وشقٌّ
   * مكتملٌ لا يُعادُ.
   * @param {{ jobId: string, slotAt: number }} query
   * @returns {Promise<Set<string>>}
   */
  async phasesOfSlot({ jobId, slotAt }) {
    const slotText = new Date(slotAt).toISOString();
    const rows = await this.#rowsOf(jobId);
    return new Set(
      rows.filter((row) => String(row['slotAt']) === slotText).map((row) => String(row['phase'])),
    );
  }

  /**
   * صفوفُ عملٍ بعينِه — **وتصفيةٌ ثانيةٌ في الذاكرةِ بعدَ تصفيةِ المستودعِ**.
   *
   * والسببُ واقعةٌ لا احتمالٌ: مستودعٌ يُمرَّرُ له مُصفٍّ بشكلٍ لا يعرفُه يُعيدُ
   * **كلَّ** الصفوفِ بلا خطأٍ، فيُقرأُ شقُّ عملٍ آخرَ محجوزاً ويُرفَضُ إطلاقٌ
   * مستحقٌّ بـ`SLOT_ALREADY_CLAIMED` — رفضٌ باسمٍ صحيحٍ عن سببٍ كاذبٍ، وهو أسوأُ
   * من عطلٍ ظاهرٍ. فالتصفيةُ هنا حدٌّ لا تحسينٌ.
   * @param {string} jobId
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async #rowsOf(jobId) {
    const rows = await this.repository.list({ filter: { jobId } });
    return rows.filter((row) => String(row['jobId']) === jobId);
  }

  /**
   * آخرُ شقٍّ **اكتملَ** لعملٍ، أو `undefined` إن لم يكتملْ له شقٌّ قطُّ.
   *
   * و`undefined` **ليست براءةً**: غيابُ الدليلِ يعني أنّ العملَ مستحقٌّ الآنَ —
   * وهي نفسُ القاعدةِ المعمولُ بها في `src/recovery/schedule.mjs`.
   * @param {string} jobId
   * @returns {Promise<number | undefined>}
   */
  async lastCompletedSlot(jobId) {
    const rows = await this.#rowsOf(jobId);
    const completed = rows
      .filter((row) => String(row['phase']) === 'completed')
      .map((row) => Date.parse(String(row['slotAt'])))
      .filter((value) => Number.isFinite(value));
    if (completed.length === 0) return undefined;
    return Math.max(...completed);
  }

  /**
   * فحصُ سلسلةِ الدفترِ كلِّها.
   * @returns {Promise<{ ok: boolean, rows: number, faults: Array<{ seq: number, fault: string }> }>}
   */
  async verify() {
    const rows = [...(await this.repository.list({}))].sort(
      (left, right) => Number(left['seq']) - Number(right['seq']),
    );
    /** @type {Array<{ seq: number, fault: string }>} */
    const faults = [];
    let prev = SCHEDULED_RUN_GENESIS;
    let expectedSeq = 1;
    for (const row of rows) {
      const fault = runChainFault(row, prev, expectedSeq);
      if (fault !== null) faults.push({ seq: Number(row['seq']), fault });
      prev = String(row['hash']);
      expectedSeq += 1;
    }
    return { ok: faults.length === 0, rows: rows.length, faults };
  }

  /**
   * فحصٌ يرفعُ خطأً مُسمّى عندَ الكسرِ. يُستعملُ في المسارِ الذي لا يجوزُ أن
   * يمضيَ على دفترٍ مكسورٍ.
   * @returns {Promise<void>}
   */
  async assertIntact() {
    const result = await this.verify();
    if (!result.ok) {
      throw new SchedulerError(
        SCHEDULER_ERRORS.LEDGER_CHAIN_BROKEN,
        `سلسلةُ دفترِ الإطلاقاتِ مكسورةٌ في ${result.faults.length} موضعاً؛ ودفترٌ مكسورٌ لا يُقاسُ عليه موعدٌ ولا يُعتمدُ قفلُه.`,
        { faults: result.faults },
      );
    }
  }
}
