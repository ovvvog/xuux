/**
 * الحاصدُ المُجدوَلُ لعقودِ العمّالِ الموتى — إغلاقُ الدَينِ `LIVE-45` (أ) (`WL-391`).
 *
 * **العيبُ الذي يُغلقه:** `reclaimExpired()` (‏`src/execution/queue.mjs`) كانَ يُنادى
 * في الاختبارِ وحدَه. عاملٌ ماتَ (‏`SIGKILL`، تعطُّلُ عقدةٍ، مقتلُ حاويةٍ) يُتركُ
 * مهمّتَه `running` بعقدٍ منتهي، ولا شيءَ في الإنتاجِ يُنادي `reclaimExpired`
 * إلّا عاملٌ آخرٌ يدويّاً. هذا الملفُّ هو **المسارُ المُنتِجُ** الذي يُناديه
 * بِحكمِ عملٍ مُجدوَلٍ (لا وعدٍ على الورقِ) — وحدَه لا أكثر: الحصادُ فعلٌ لا
 * دينٌ يُعلَنُ في كلِّ حزمةٍ.
 *
 * **حكمةُ الحصادِ فعلٌ حسّاسٌ لا قراءةٌ:** الحصادُ يُعدّلُ مهامّ (قد يُعلِنُها فاشلةً
 * ويُنقِلُها إلى الرسائلِ الميتةِ)، فلا يقعُ إلّا بقرارٍ مُسجَّلٍ: `authorize` للفعلِ
 * `reclaim-expired-leases` ثمّ `verify` **قبلَ أولِ كتابةٍ في القاعدةِ** — لا بعدَها.
 * وقرارٌ صادرٌ لفعلٍ آخرَ (`run-scheduled-job` لِلإطلاقِ) لا يَمنحُ حقَّ الحصادِ:
 * فالإطلاقُ والحصادُ فعلانِ مُتمايزانِ بموردَيهما المُتمايزَين (`job:*` و`task:*`).
 *
 * **حدٌّ مُعلَنٌ لا يُتجاوَزُ:** `reclaimExpired()` يأخذُ كلَّ `running` انتهى عقدُه —
 * **وليسَ حكماً على نتيجةِ خصمٍ مُعلّقة**. الخصمُ المُلتزَمُ (‏`budget_debited_at`)
 * لا يُعادُ ولا يُفرَجُ عنه هنا؛ والحصادُ لا يَعترضُ مسارَ `db-recovery.mjs` الذي
 * يحرسُ عقدَ العاملِ **الحيّ** — فذاكَ يملكُ حجزَه وحدَه (شرطُ `lease_owner`)،
 * والحصادُ يأخذُ ما ماتَ حامِلُه فعلًا (شرطُ `lease_expires_at < now`).
 *
 * @module execution/reaper
 */

/**
 * فعلُ الحصادِ المُسمّى. **اسمٌ واحدٌ لفعلٍ واحدٍ**: من كتبَه نصّاً في موضعٍ
 * ثانٍ فتحَ بابَ فعلَينِ بمسمّيَينِ، والحاجزُ يفحصُ هذا الرمزَ لا النصَّ. وموضعُه
 * هذا الملفُّ لا `scripts/scheduler.mjs` ولا `policies.yaml`: **الفعلُ يُسمّى حيثُ
 * يُنفَّذُ** (قاعدةُ `R2` في `guard:authorization`).
 */
export const REAPER_RECLAIM_ACTION = 'reclaim-expired-leases';

/**
 * يُنفِّذُ حصاداً واحداً: قرارٌ مُسجَّلٌ ثمّ استهلاكُ التذكرةِ ثمّ نداءُ الطابورِ.
 *
 * والترتيبُ مقصودٌ: تذكرةٌ تُستهلَكُ **قبلَ أولِ كتابةٍ في القاعدةِ** لا بعدها
 * (تذكرةٌ تُستهلَكُ بعدَ الحصادِ تجعلُ الرفضَ يقعُ بعدَ الفعلِ). ولا «نجاحٌ صفرٌ»
 * يُدّعى على ما لم يُفحَصْ: بلا قاعدةٍ لا حصادَ ولا تقريرٌ فارغٌ يُقرأُ نجاحاً.
 *
 * @param {object} input
 * @param {ReturnType<import('./queue.mjs').createTaskQueue> | null} input.queue طابورُ قاعدةِ البياناتِ (مجمّعٌ واحدٌ من التركيبِ لا مجمّعٌ لكلِّ حصادٍ).
 * @param {{ id: string, role: string, kind: string }} input.actor فاعلُ الحصادِ — لا فاعلَ اسمُه «النظامُ».
 * @param {{ append: (type: string, actor: string, payload: Record<string, unknown>) => unknown }} input.log سجلُّ يُقيَّدُ فيه الحصادُ.
 * @param {{ authorize: Function, verify: Function }} input.enforcementPoint نقطةُ التفويضِ المركزيّةِ من جذرِ التركيبِ.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runReclaimLeasesJob({ queue, actor, log, enforcementPoint }) {
  if (queue === null || queue === undefined) {
    throw new Error(
      'الحاصدُ يحتاجُ طابوراً على قاعدةِ البياناتِ: بلا `DATABASE_URL` لا عقدَ يُقرأُ، ولا «نجاحٌ صفرٌ» يُدّعى على ما لم يُفحَصْ.',
    );
  }
  const now = new Date();
  const request = {
    actor,
    action: REAPER_RECLAIM_ACTION,
    resource: { type: 'task', id: '*', classification: 'internal' },
    context: {
      scheduledJobId: 'job:reclaim-expired-leases',
      dispatchedAt: now.toISOString(),
    },
  };
  // الحصادُ فعلٌ حسّاسٌ لا يقعُ إلّا بقرارٍ مُسجَّلٍ ونقطةِ تفويضٍ: تذكرةٌ تُستهلَكُ
  // عندَ التنفيذِ لا عندَ الطلبِ. والقرارُ يُقيَّمُ على الفعلِ نفسِهِ (`reclaim-expired-leases`)
  // لا على فعلِ الإطلاقِ (`run-scheduled-job`) — فما صدرَ لفعلٍ لا يُنفَّذُ لفعلٍ آخرَ.
  const { decision, token } = await enforcementPoint.authorize(request);
  if (!decision.allowed) {
    throw new Error(`الحصادُ رُفض بقرارٍ: برمزِ ${decision.code} — ${decision.reason}`);
  }
  if (token === null || token === undefined) {
    throw new Error('الحاصدُ بلا تذكرةِ تفويضٍ: قرارٌ لا تذكرةَ له لا يُنفّذُ.');
  }
  // التذكرةُ تُستهلَكُ **قبلَ أولِ كتابةٍ في القاعدةِ**: تذكرةٌ تُستهلَكُ بعدَ الحصادِ
  // تجعلُ الرفضَ يقعُ بعدَ الفعلِ — والحصادُ لا يُتراجَعُ برمّةٍ ردٍّ من الرفضِ.
  enforcementPoint.verify(token, {
    actorId: actor.id,
    action: REAPER_RECLAIM_ACTION,
    resourceKey: 'task:*',
  });
  const reclaimed = await queue.reclaimExpired({ actor: actor.id });
  log.append('scheduler.reaper.reclaimed', actor.id, {
    requeued: reclaimed.requeued.length,
    failed: reclaimed.failed.length,
  });
  return {
    requeued: reclaimed.requeued.length,
    failed: reclaimed.failed.length,
    taskIds: [...reclaimed.requeued, ...reclaimed.failed].map((task) => task.id),
  };
}
