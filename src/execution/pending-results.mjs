/**
 * مخزنُ النتائجِ المعلّقةِ الدائمُ وتسويتُها — إغلاقُ الدَينِ `LIVE-45` (ب) (`WL-392`).
 *
 * **العيبُ الذي يُغلقه:** النتيجةُ المعلّقةُ كانت تسكنُ ذاكرةَ العمليةِ وحدَها
 * (`cursor.pending` في `worker.mjs`): عاملٌ يُقتلُ بعدَ أن يُنتجَ مُعالِجُهُ قيمةً
 * وقبلَ أن يُسجّلَها في القاعدةِ يفقدُ القيمةَ كلَّها، فتُعادُ المهمّةُ بعدَ
 * انتهاءِ عقدِها إلى «مرّةٍ على الأقل» على حسابِ إعادةِ تشغيلٍ كاملة، والسجلُّ
 * يحفظُ بصمتَها لا قيمتَها. الاستردادُ الذاتيّ (`db-recovery.mjs`) لا يغطّي هذا:
 * فهو يفهرسُ عطبَ العمليةِ **الحية**، أمّا القتلُ فلا يتركُ عطباً يُفهرَس.
 *
 * **الحلُّ هنا — مخزنٌ محليٌّ دائمٌ لا يعتمدُ على اتصالِ القاعدةِ:** القيمةُ
 * تُخزَّن على القرصِ في سجلِّ العاملِ الدائمِ (نفسُ سجلِّ العزلِ: سلسلةُ تجزئاتٍ
 * مُزامَنةٌ بـ`fsync`، مختومةٌ في الإنتاج) **قبلَ أولِ كتابةٍ للقاعدةِ**، ثمّ
 * تُسوّى عندَ إقلاعٍ جديدٍ من العمليةِ نفسِها أو من حياةٍ تاليةٍ لها. فإذا كانت
 * القاعدةُ متوقّفةً عندَ التسجيلِ — أو قُتلتِ العمليةُ في نافذةِ التسجيلِ —
 * بقيتِ القيمةُ على القرصِ واستُوفيت دونَ إعادةِ تشغيلِ المُعالِج.
 *
 * **هويةُ الحجزِ — معرِّفٌ لا يُعادُ استعمالُه (`claim_id`):** السجلُّ المُخزَّنُ
 * يحملُ `(taskId, worker, attempt, claimId)` حيثُ `claimId` معرِّفٌ وُلدَ عندَ
 * الحجزِ وحدَه. وكلُّ حجزٍ جديدٍ — ولو بالمهمّةِ والاسمِ والعدّادِ نفْسِها بعدَ
 * مساراتِ الإرجاعِ (`releaseUnstarted`/`releaseForHalt`) — معرِّفُهُ جديدٌ، فنتيجةُ
 * حياةٍ سابقةٍ لا تُسوّى فوقَ حجزٍ أحدثَ. والتسويةُ تتحقّقُ من المعرِّفِ داخلَ
 * كتابةِ النتيجةِ نفسِها (`queue.succeed` بشرطِ `claimId`).
 *
 * **ترتيبُ الدوامِ معلَنٌ لا ذرّيّةُ مزعومة:** «السجلُّ الدائمُ أوّلًا، ثمّ التزامُ
 * القاعدةِ، ثمّ قيدُ الاستيفاءِ» — ثلاثةُ آثارٍ بهذا الترتيبِ، **لا معاملةً واحدةً
 * تستهلكُها معاً**. فقتلُ العمليةِ بينَ أيٍّ منها لا يُفقدُ القيمةَ ولا يكرّرُ
 * انتقالاً: قتلٌ بعدَ الالتزامِ تقرؤهُ التسويةُ من القاعدةِ (بصمةٌ مطابقةٌ ⇒
 * استيفاءٌ بالقيدِ بلا كتابةٍ)، وقتلٌ قبلهُ تُسوّيهِ الحياةُ الجديدةُ من القرص.
 *
 * **وحدودُ التسويةِ معلَنة:** التسويةُ لا تستبدلُ ولا تُكرّرُ ولا تختارُ صامتةً:
 *   - تخزينٌ ثانٍ للهويةِ نفْسِها بقيمةٍ **مطابقةٍ** ⇒ خمولٌ (لا دليلَ جديداً)؛
 *   - تخزينٌ ثانٍ بقيمةٍ **مخالفةٍ** ⇒ تضادٌّ مُسمّى يُقيَّدُ في الحالِ ولا يُختارُ
 *     منهما شيءٌ ولا يُمحى دليلٌ — قرارُهُ لمالكٍ لا لقارئٍ؛
 *   - نتيجةٌ قائمةٌ من الحياةِ نفْسِها **مطابقةُ البصمةِ** ⇒ قيدُ استيفاءٍ بلا
 *     كتابةٍ ولا انتقالٍ جديد؛ **مخالفةٌ** ⇒ تضادٌّ مُسمّى لا استبدالَ صامتاً؛
 *   - نجاحٌ أو حياةٌ **أحدثُ** من السجلِّ (حُصدت وحُجزت من جديدٍ) ⇒ تعليقٌ
 *     `superseded` — القيمُ المختلفةُ بينَ عملياتٍ مختلفةٍ ليست تضادّاً — ولا
 *     تُمحى أدلتُها محواً: السجلُّ تراكميٌّ لا يُحذفُ منه شيء.
 *   - والإيقافُ السياديُّ يؤجّلُ التسويةَ كما يؤجّلُ الاستردادَ: لا كتابةَ تحتَه.
 *
 * @module execution/pending-results
 */

import { TaskLifecycle } from './lifecycle.mjs';
import { QUEUE_ERRORS, QueueError } from './queue.mjs';
import { resultDigest } from './db-recovery.mjs';

/** واقعةُ تخزينِ نتيجةٍ معلّقةٍ على القرصِ قبلَ كتابةِ القاعدة. */
export const PENDING_RESULT_STAGED_EVENT = 'kernel.worker.result-staged';
/** واقعةُ تسويةِ نتيجةٍ معلّقةٍ: استوفيت أو عُلّقت أو تضادّت. */
export const PENDING_RESULT_RESOLVED_EVENT = 'kernel.worker.result-resolved';

/**
 * بصمةُ مفتاحِ السجلِّ المعلّق: (المهمّة، المحاولة، معرِّفُ الحجزِ).
 * @param {string} taskId
 * @param {number} attempt
 * @param {string} claimId
 */
function recordKey(taskId, attempt, claimId) {
  return `${taskId}#${attempt}#${claimId}`;
}

/**
 * السجلُّ الذي يُكتبُ فيه المخزنُ: سجلٌّ دائمٌ عاديٌّ (`append` متزامن) أو
 * مختومٌ (`append` + `drain` للكتابةِ و`openEvent` لفكِّ ختمِ القراءة).
 * @typedef {object} PendingResultLog
 * @property {(type: string, actor: string, data: Record<string, unknown>) => unknown} append
 * @property {() => Promise<void>} [drain]
 */

/**
 * قارئُ السجلِّ الذي يُستعملُ في التسويةِ عندَ الإقلاع: سجلُّ الأحداثِ الدائمُ
 * نفسُه (`PersistentEventLog`) — كشفُ الأحداثِ، وخاصيةُ `sealed` و`openEvent`
 * لفكِّ ختمِ الأجسامِ إن كانَ مختوماً (الإنتاج) — فجسمُ الحدثِ المختومِ على
 * القرصِ نصٌّ مصونٌ لا يُقرأُ إلا بالخاتم، والقارئُ بلا خاتمٍ أعمى لا قارئ.
 * @typedef {import('../root-of-trust/persistent-log.mjs').PersistentEventLog} PendingResultReader
 */

/**
 * سجلٌّ معلّقٌ لم يُسوَّ بعد: القيمةُ نفسُها مع هويةِ حجزِها. وحين يقرأُ القارئُ
 * قيمتَينِ مختلفتَينِ للهويةِ نفْسِها بلا حكمٍ بينَهما (قتلٌ بينَ التخزينِ الثاني
 * وقيدِ التضادِّ) يُعلَّمُ `conflict` — والتسويةُ تُسمّيهِ ولا تختارُ منهما شيئاً.
 * @typedef {object} UnresolvedPendingResult
 * @property {string} taskId
 * @property {string} worker
 * @property {number} attempt
 * @property {string} claimId
 * @property {Record<string, unknown>} result
 * @property {boolean} conflict
 */

/**
 * تضادُّ تخزينٍ صريحٌ يُرمى من `stage` حين تُخزَّنُ قيمةٌ مخالفةٌ لهويةٍ لها قيمةٌ
 * معلّقة: لا يُعطى إذنًا باستكمالِ النجاحِ بالقيمةِ الثانيةِ (ذاك اختيارٌ صامت)،
 * بل يُرمى ليوقفَ المسارَ عندَ حدٍّ آمنٍ — والقيدُ في السجلِّ يُسمّي التضادَّ
 * وقرارُهُ لمالكٍ مخوَّلٍ.
 */
export class PendingResultConflict extends Error {
  /**
   * @param {string} taskId
   * @param {string} claimId
   */
  constructor(taskId, claimId) {
    super(
      `تضادُّ تخزينٍ للمهمّةِ ${taskId} (حجزُ ${claimId}): قيمتانِ مختلفتانِ للهويةِ نفْسِها — لا يُختارُ منهما شيءٌ ويُرمى لا يُبتلَع`,
    );
    this.name = 'PendingResultConflict';
    this.taskId = taskId;
    this.claimId = claimId;
  }
}

/**
 * شكلُ مخزنِ النتائجِ المعلّقةِ كما يستهلكهُ العامل — يُصدَّر لِتَعليقِ الأنواعِ
 * (‏`pendingResults` في `worker.mjs`) لا لإنشاءِ بدائلَ خارجَ الوحدة.
 * @typedef {object} PendingResultStoreLike
 * @property {(record: { taskId: string, attempt: number, claimId: string, result: Record<string, unknown> }) => Promise<void>} stage
 * @property {(record: { taskId: string, attempt: number, claimId: string, outcome: 'settled' | 'superseded' | 'conflict', reason: string }) => Promise<void>} resolve
 */

/**
 * مخزنُ النتائجِ المعلّقةِ: يكتبُ في سجلِّ العاملِ الدائمِ (قارئٌ ومكتِب) لا
 * يفتحُ ملفّاً من عنده — سجلُّ العزلِ القائمُ هو الحامل، فواحدٌ يقرأُه عندَ الإقلاع
 * يرى نتائجَ الحياةِ السابقةِ للعمليةِ على العقدةِ نفسِها.
 *
 * @param {object} input
 * @param {PendingResultReader} input.reader كشفُ أحداثِ السجلِّ للقراءةِ وفكُّ ختمِها.
 * @param {PendingResultLog} input.writer الكتابةُ الدائمةُ (العاديةُ أو المختومة).
 * @param {string} input.worker اسمُ العاملِ صاحبِ السجلّ.
 * @returns {PendingResultStoreLike & { worker: string, unresolved: () => Promise<UnresolvedPendingResult[]> }}
 */
export function createPendingResultStore({ reader, writer, worker }) {
  if (
    !Array.isArray(reader.events) ||
    typeof writer.append !== 'function' ||
    typeof worker !== 'string' ||
    worker.trim() === ''
  ) {
    throw new Error(
      'مخزنُ النتائجِ المعلّقةِ يحتاجُ قارئَ سجلٍّ ومكتِباً دائماً واسمَ عاملٍ صاحبِ السجلّ.',
    );
  }
  const actor = `worker:${worker}`;
  const sealed = reader.sealed === true && typeof reader.openEvent === 'function';
  if (reader.sealed === true && !sealed) {
    throw new Error(
      'قارئُ النتائجِ المعلّقةِ مختومٌ بلا فكِّ ختمٍ: جسمُ الحدثِ على القرصِ مصونٌ لا يُقرأُ بلا خاتمٍ — والمخزنُ يرفضُ القراءةَ العمياءَ.',
    );
  }

  /**
   * يفكُّ جسمَ حدثٍ إن كانَ السجلُّ مختوماً، ويرجعهُ كما هو في العاديّ.
   * @param {import('../root-of-trust/persistent-log.mjs').PersistentEventLog['events'][number]} event
   */
  async function openBody(event) {
    if (!sealed) return event.data;
    return /** @type {Record<string, unknown>} */ (await reader.openEvent?.(event));
  }

  /**
   * السجلاتُ المعلّقةُ التي لم يُقيَّد لها حكمٌ بعد. القراءةُ **بالترتيبِ** لا
   * بفهرسةٍ ختاميّةٍ: قيدُ التسويةِ يُلغي ما سبقهُ من تخزينٍ وحدَه — فتخزينٌ
   * لاحقٌ لقيدٍ سابقٍ باقٍ معلّقٌ لا يُخفيهِ قيدٌ تقدّمَ عليه. والسجلُّ
   * تراكميٌّ فالأدلةُ لا تُمحى؛ التسويةُ قيدٌ جديدٌ فوقَ التخزينِ لا حذفٌ له.
   *
   * والقراءةُ مختومةً تُفكُّ ختمَها حدثاً حدثاً: جسمُ الحدثِ على القرصِ في
   * الإنتاجِ نصٌّ مصونٌ، والقارئُ بلا خاتمٍ أعمى لا قارئ.
   * @returns {Promise<UnresolvedPendingResult[]>}
   */
  async function unresolved() {
    /** @type {Map<string, UnresolvedPendingResult>} */
    const pending = new Map();
    for (const event of reader.events) {
      if (
        event.type !== PENDING_RESULT_STAGED_EVENT &&
        event.type !== PENDING_RESULT_RESOLVED_EVENT
      ) {
        continue;
      }
      const data = /** @type {Record<string, unknown>} */ (await openBody(event));
      if (
        typeof data['taskId'] !== 'string' ||
        typeof data['attempt'] !== 'number' ||
        typeof data['claimId'] !== 'string'
      ) {
        continue;
      }
      const key = recordKey(data['taskId'], data['attempt'], data['claimId']);
      if (event.type === PENDING_RESULT_RESOLVED_EVENT) {
        // القيدُ يُلغي ما سبقهُ من تخزينٍ لهذه الهويةِ وحدَه.
        pending.delete(key);
        continue;
      }
      if (
        typeof data['worker'] !== 'string' ||
        typeof data['result'] !== 'object' ||
        data['result'] === null
      ) {
        continue;
      }
      const incoming = {
        taskId: data['taskId'],
        worker: data['worker'],
        attempt: data['attempt'],
        claimId: data['claimId'],
        result: /** @type {Record<string, unknown>} */ (data['result']),
        conflict: false,
      };
      const earlier = pending.get(key);
      if (earlier !== undefined) {
        // قيمتانِ مختلفتانِ للهويةِ نفْسِها بلا حكمٍ بينَهما (قتلٌ بينَ التخزينِ
        // الثاني وقيدِ التضادِّ): لا اختيارَ للأخيرِ ولا للأول — تضادٌّ يُكتشفُ
        // عندَ القراءةِ نفسِها ويمنعُ التسويةَ الآليةَ حتى يُقيَّدَ الحكمُ.
        // **والتضادُ لاصقٌ:** ما وُسِمَ متضادًّا لا يُمحى وسمُه بتخزينٍ ثالثٍ
        // مطابقٍ للمحتجَزةِ — فإحياءُ القيمةِ الأولى بيدٍ لاحقةٍ لا يُعيدُ
        // الإذنَ بها بعدَ أن قامتِ الثانيةُ دليلًا على التضادّ.
        if (
          resultDigest(earlier.result) !== resultDigest(incoming.result) ||
          earlier.conflict === true
        ) {
          earlier.conflict = true;
          continue;
        }
      }
      pending.set(key, incoming);
    }
    return [...pending.values()];
  }

  /**
   * يُقيّدُ حكمَ التسويةِ: استيفاءٌ أو تعليقٌ أو تضادٌّ — دليلٌ يُقرأُ لا نتيجةٌ
   * تُمحى. النوعُ نصٌّ حرفيٌّ عندَ النداءِ لا ثابتٌ مُستورَد، والحِمْلُ كائنٌ
   * حرفيٌّ لا متغيّرٌ يُمرَّر: حاجزُ العقودِ يقرأُ الشيفرةَ سكونياً عندَ نداءِ
   * `append` نفسِهِ، فالمُغلَّفُ (دالةٌ تُخفي النداء) والثابتُ كلاهما يُخرجانِ النداءَ
   * من المقايسةِ — والعقدُ الذي لا يُقاوَمُ وعدٌ لقارئٍ لن يصلَهُ شيء.
   * @param {{ taskId: string, attempt: number, claimId: string }} record
   * @param {'settled' | 'superseded' | 'conflict'} outcome
   * @param {string} reason
   */
  async function appendResolved(record, outcome, reason) {
    if (typeof writer.drain === 'function') {
      writer.append('kernel.worker.result-resolved', actor, {
        taskId: record.taskId,
        attempt: record.attempt,
        claimId: record.claimId,
        outcome,
        reason,
      });
      await writer.drain();
      return;
    }
    writer.append('kernel.worker.result-resolved', actor, {
      taskId: record.taskId,
      attempt: record.attempt,
      claimId: record.claimId,
      outcome,
      reason,
    });
  }

  /**
   * يُخزّنُ واقعةَ التخزينِ (النوعُ والجسمُ حرفيّانِ عندَ نداءِ `append` — شرطُ
   * حاجزِ العقودِ السكونيّ) ويضمنُ دوامَها قبلَ العودةِ: المختومُ يُصفَّى
   * بـ`drain`، والعاديُّ يكتبُ متزامناً مُزامَناً (fsync) فالنداءُ نفسُهُ الضمان.
   * @param {{ taskId: string, attempt: number, claimId: string, result: Record<string, unknown> }} record
   */
  async function appendStaged(record) {
    if (typeof writer.drain === 'function') {
      writer.append('kernel.worker.result-staged', actor, {
        taskId: record.taskId,
        worker,
        attempt: record.attempt,
        claimId: record.claimId,
        result: record.result,
      });
      await writer.drain();
      return;
    }
    writer.append('kernel.worker.result-staged', actor, {
      taskId: record.taskId,
      worker,
      attempt: record.attempt,
      claimId: record.claimId,
      result: record.result,
    });
  }

  return {
    worker,
    unresolved,

    /**
     * يُخزّنُ نتيجةً معلّقةً **بضمانِ الدوامِ قبلَ العودةِ**: القيمةُ تُكتبُ على
     * القرصِ قبلَ أن يُسجّلها العاملُ في القاعدةِ، فقتلُ العمليةِ في نافذةِ
     * التسجيلِ لا يُفقدُها.
     *
     * والتخزينُ المزدوجُ للهويةِ نفْسِها مُسمّى: قيمةٌ مطابقةٌ ⇒ خمولٌ (إعادةُ
     * محاولةٍ خاملةٍ لا دليلَ فيها)، وقيمةٌ مخالفةٌ ⇒ تضادٌّ يُقيَّدُ في الحالِ
     * ولا يُختارُ منهما شيءٌ — كلا التخزينَينِ دليلٌ باقٍ لا يُمحى.
     * @param {{ taskId: string, attempt: number, claimId: string, result: Record<string, unknown> }} record
     */
    async stage(record) {
      const existing = (await unresolved()).find(
        (pending) =>
          pending.taskId === record.taskId &&
          pending.attempt === record.attempt &&
          pending.claimId === record.claimId,
      );
      if (existing !== undefined) {
        if (existing.conflict === true) {
          // التضادُّ قائمٌ ولم يُقضَ: إعادةُ تخزينٍ — ولو مطابقةً للمحتجَزةِ —
          // لا تُعيدُ الإذنَ بمواصلةِ النجاحِ بالقيمةِ المحتجزةِ، فقد قامتِ
          // المخالفةُ دليلًا والقرارَ لمالكٍ مخوَّلٍ لا لمُعيدِ التخزينِ.
          await appendResolved(
            record,
            'conflict',
            'تضادٌّ قائمٌ لم يُقضَ: لا إذنَ باستكمالِ النجاحِ بقيمةٍ محتجزةٍ',
          );
          throw new PendingResultConflict(record.taskId, record.claimId);
        }
        const same = resultDigest(existing.result) === resultDigest(record.result);
        if (same) return;
        // تضادُّ تخزينٍ مُسمّى: القيمةُ الثانيةُ **دليلٌ يُخزَّنُ لا يُخفى** — ثمّ
        // يُقيَّدُ الحكمُ تضادًّا فورًا. لا اختيارَ للأحدثِ ولا إخفاءً للأقدمِ؛
        // قرارُ التضادِّ لمالكٍ مخوَّلٍ لا لقارئٍ صامت. **ويُرمى خطأٌ مسمّى**: لا
        // يُعطى إذنًا باستكمالِ النجاحِ بالقيمةِ الثانيةِ (ذاك اختيارٌ صامت) —
        // العاملُ يتوقّفُ عندَ حدٍّ آمنٍ والقيدُ في السجلِّ يُسمّي التضادَّ.
        // (إن كانَ التضادُّ مكتشفاً من قبلُ عندَ القراءةِ فالدليلانِ باقيانِ — لا
        // يُكرَّرُ التخزينُ.)
        // (التضادُّ القائمُ رُميَ في الفرعِ أعلاه — فها هنا التضادُّ حديثُ العهدِ
        // بهذا التخزينِ: الدليلانِ يُخزَّنانِ معًا.)
        await appendStaged(record);
        await appendResolved(
          record,
          'conflict',
          'قيمتانِ مختلفتانِ للحجزِ نفسِهِ: تضادٌّ يُقيَّدُ ولا يُختارُ منهما شيء',
        );
        throw new PendingResultConflict(record.taskId, record.claimId);
      }
      await appendStaged(record);
    },

    /**
     * يُقيّدُ حكمَ التسويةِ للسجلِّ المُخزَّن: استيفاءٌ أو تعليقٌ أو تضادٌّ —
     * دليلٌ يُقرأُ لا نتيجةٌ تُمحى.
     * @param {{ taskId: string, attempt: number, claimId: string, outcome: 'settled' | 'superseded' | 'conflict', reason: string }} record
     */
    async resolve(record) {
      await appendResolved(record, record.outcome, record.reason);
    },
  };
}

/**
 * تسويةُ النتائجِ المعلّقةِ من حياةٍ سابقةٍ للعمليةِ — تُنادى عندَ الإقلاعِ
 * **قبلَ أيِّ حجزٍ جديدٍ**، وبعدَ كلِّ استردادٍ من عطبِ قاعدة.
 *
 * لكلِّ سجلٍّ معلّقٍ قرارٌ واحدٌ، والقرارُ لا يستبدلُ ولا يُكرّرُ ولا يختارُ صامتةً:
 *   - المهمّةُ غابت ⇒ تعليقٌ (أدلتُها باقية).
 *   - المهمّةُ نجحت: من حياةِ السجلِّ نفْسِها — بصمةٌ مطابقةٌ ⇒ استيفاءٌ بالقيودِ
 *     من دونِ انتقالٍ جديد؛ بصمةٌ مخالفةٌ ⇒ تضادٌّ مُسمّى، لا استبدالٌ صامت. ومن
 *     حياةٍ أحدثَ ⇒ تعليقٌ: القيمُ المختلفةُ بينَ عملياتٍ مختلفةٍ ليست تضادّاً.
 *   - المهمّةُ جاريةٌ بعقدِ صاحبِ النتيجةِ **ومعرِّفِ حجزِها** ⇒ استيفاءٌ عبرَ
 *     `queue.succeed` بشرطِ الهويةِ (‏`claimId` و`attempt`) — كتابةٌ واحدةٌ تُغلقُ
 *     المهمّةَ، ثمّ قيدُ الاستيفاءِ أثرٌ تالٍ لا جزءٌ من معاملتِها (الترتيبُ
 *     معلَنٌ أعلاه). وفقدُ العقدِ أثناءَها سباقٌ معَ الحاصدِ لا فقدانٌ: يُعلَّقُ
 *     السجلُ ولا يُكتبَ فوقَ حياةٍ أحدث.
 *   - غيرُ ذلك (حُصدت وحُجزت من جديد، أو فُكَّ الحجزُ) ⇒ تعليقٌ: معرِّفُ الحجزِ
 *     الجديدِ غيرُ معرِّفِ السجلِّ فلا تُقبلُ عليه نتيجةُ حياةٍ سابقة.
 *
 * **والإيقافُ السياديُّ يؤجّلُ التسويةَ:** لا تُسوّى نتيجةٌ تحتَ الإيقافِ كما لا
 * يُستردُّ عطبٌ تحته — تُتركُ السجلاتُ كما هي حتى الاستئناف.
 *
 * عطبُ القاعدةِ عندَ التسويةِ يُرمى كما جاءَ (الاستردادُ في مُقلِعِ العاملِ
 * يُصنّفُه `WorkerDatabaseFault` فيؤجّلُ الحجزَ الجديدَ ويعيدُ المحاولةَ بعدَ عودةِ
 * القاعدةِ)؛ وما ليسَ عطبَ قاعدةٍ يُرمى كما هو ليوقفَ العاملَ عندَ حدٍّ آمنٍ لا
 * أن يُبتلَع.
 *
 * @param {object} input
 * @param {ReturnType<typeof createPendingResultStore>} input.store
 * @param {ReturnType<typeof import('./queue.mjs').createTaskQueue>} input.queue
 * @param {{ assertOperational: () => void }} [input.haltGuard] حرسُ الإيقافِ الشامل: التسويةُ تحتَه تأجيلٌ لا كتابة.
 * @returns {Promise<{ examined: number, settled: number, superseded: number, conflicts: number }>}
 */
export async function settlePendingResults({
  store,
  queue,
  haltGuard = { assertOperational: () => {} },
}) {
  const counts = { examined: 0, settled: 0, superseded: 0, conflicts: 0 };
  for (const record of await store.unresolved()) {
    // الإيقافُ السياديُّ يؤجّلُ التسويةَ كلَّها: لا كتابةَ تحتَهُ ولا قيدَ،
    // والسجلاتُ تنتظرُ الاستئنافَ كما ينتظرُ الاستردادُ.
    if (haltGuard !== undefined && typeof haltGuard.assertOperational === 'function') {
      try {
        haltGuard.assertOperational();
      } catch {
        return counts;
      }
    }
    counts.examined += 1;
    if (record.conflict === true) {
      // تضادٌّ اكتشفتهُ القراءةُ نفسُها (قيمتانِ للهويةِ بلا حكمٍ بينَهما): يُقيَّدُ
      // الحكمُ تضادًّا ولا تُكتبُ قيمةٌ في القاعدةِ — لا اختيارَ صامتَ ولا
      // استبدال، وقرارُ التضادِّ لمالكٍ مخوَّلٍ.
      await store.resolve({
        taskId: record.taskId,
        attempt: record.attempt,
        claimId: record.claimId,
        outcome: 'conflict',
        reason: 'قيمتانِ مختلفتانِ للهويةِ نفْسِها في السجلِّ: تضادٌّ يُسمّى ولا يُختار',
      });
      counts.conflicts += 1;
      continue;
    }
    const task = await queue.get(record.taskId);
    if (task === null) {
      await store.resolve({
        taskId: record.taskId,
        attempt: record.attempt,
        claimId: record.claimId,
        outcome: 'superseded',
        reason: 'المهمّةُ لم تعد موجودةً في القاعدة',
      });
      counts.superseded += 1;
      continue;
    }
    if (task.state === TaskLifecycle.SUCCEEDED) {
      // نجاحٌ من حياةٍ **أحدثَ** من سجلِّ التخزينِ: السجلُّ عفا عليه الزمنُ (حُصدَ
      // حاملُهُ وحُجزت المهمّةُ من جديدٍ فنجحت) — قيمتُها مختلفةٌ بالضرورةِ لا
      // تضادّاً: عملياتٌ مختلفةٌ تُنتجُ قيماً مختلفةً، فلا يُسمّى تعليقُها تضادّاً.
      if (task.claimId !== record.claimId) {
        await store.resolve({
          taskId: record.taskId,
          attempt: record.attempt,
          claimId: record.claimId,
          outcome: 'superseded',
          reason: 'نجحت المهمّةُ من حياةٍ أحدثَ من حياةِ السجلّ',
        });
        counts.superseded += 1;
        continue;
      }
      // نتيجةٌ قائمةٌ من حياةِ السجلِّ نفسِها: المطابقةُ استيفاءٌ بالقيودِ،
      // والمخالفةُ تضادٌّ يُسمّى ولا يُستبدل — كتابةُ القيمةِ هنا كانت ستكونَ
      // استبدالاً صامتاً.
      const settledDigest = resultDigest(task.result);
      const stagedDigest = resultDigest(record.result);
      const matches = settledDigest === stagedDigest;
      await store.resolve({
        taskId: record.taskId,
        attempt: record.attempt,
        claimId: record.claimId,
        outcome: matches ? 'settled' : 'conflict',
        reason: matches
          ? 'سُجّلت النتيجةُ في القاعدةِ وبصمتُها مطابقةٌ للمعلّقة'
          : 'نتيجةٌ مسجّلةٌ في القاعدةِ تخالفُ المعلّقة: تضادٌّ يُقيَّدُ لا يُستبدل',
      });
      if (matches) counts.settled += 1;
      else counts.conflicts += 1;
      continue;
    }
    const ownsRunningClaim =
      task.state === TaskLifecycle.RUNNING &&
      task.leaseOwner === record.worker &&
      task.attempts === record.attempt &&
      task.claimId === record.claimId;
    if (!ownsRunningClaim) {
      // المهمّةُ خرجت من يدِ صاحبِ النتيجةِ (حُصدت وحُجزت من جديدٍ أو فُكَّ حجزُها
      // فعادَ العدّادُ وحُجزَ بالاسمِ نفسِهِ) — معرِّفُ الحجزِ الجديدِ غيرُ معرِّفِ
      // السجلِّ فلا تُكتبُ نتيجةُ الحياةِ السابقةِ فوقَ حياةٍ أحدث.
      await store.resolve({
        taskId: record.taskId,
        attempt: record.attempt,
        claimId: record.claimId,
        outcome: 'superseded',
        reason: 'المهمّةُ لم تعد جاريةً بعقدِ صاحبِ النتيجةِ ومعرِّفِ حجزِها',
      });
      counts.superseded += 1;
      continue;
    }
    try {
      await queue.succeed({
        taskId: record.taskId,
        worker: record.worker,
        result: record.result,
        attempt: record.attempt,
        claimId: record.claimId,
        reason: 'تسويةُ نتيجةٍ معلّقةٍ خُزّنت دائماً قبلَ انقطاعِ العملية',
      });
    } catch (error) {
      if (error instanceof QueueError && error.code === QUEUE_ERRORS.LEASE_LOST) {
        // سباقُ الحاصدِ بينَ القراءةِ والكتابة: خرجت المهمّةُ من يدِ صاحبِ
        // النتيجةِ — تعليقٌ لا فقدان.
        await store.resolve({
          taskId: record.taskId,
          attempt: record.attempt,
          claimId: record.claimId,
          outcome: 'superseded',
          reason: 'فُقد العقدُ أثناءَ التسوية: خرجت المهمّةُ من يدِ صاحبِ النتيجة',
        });
        counts.superseded += 1;
        continue;
      }
      throw error;
    }
    await store.resolve({
      taskId: record.taskId,
      attempt: record.attempt,
      claimId: record.claimId,
      outcome: 'settled',
      reason: 'سُوّيت من المخزنِ الدائمِ دونَ إعادةِ تشغيلِ المُعالِج',
    });
    counts.settled += 1;
  }
  return counts;
}
