// دالةُ القرارِ المرجعيةُ لمصفوفةِ التعافي — ملحق ADR 0007-أ §د (التنقيحُ الثاني، 2026-10-17).
//
// **هذه مرجعٌ تصميميٌّ لا شيفرةَ إنتاجٍ:** تُطابقُ نصَّ المصفوفةِ في
// `docs/adr/0007-annex-a-seal-transaction-and-recovery-matrix.md` §د حرفيًّا،
// وتُستعملُها اختباراتُ `tests/adr/0007-annex-a-decision-matrix.test.mjs` لإثباتِ
// الحصريةِ والكمالِ (لكلِّ تركيبةٍ نتيجةً واحدةً، ولا طريقَ إلى `running` من متنٍ
// غيرِ ملتزمٍ). لا يستوردها `src/` ولا `sim/` ولا أيُّ مسارِ إنتاجٍ، وتمكينُها
// ليس تمكينَ مصدرِ حداثةٍ — هي إثباتُ اتساقِ النصِّ لا قياسُ عتادٍ.
//
// **قراراتُ التنقيحِ الثاني المُثبَّتةُ هنا:**
// - **أسبقيةُ `retired` على `halted`** في المرحلةِ 3 (المرحلةُ 3 تُفحَصُ `retired`
//   أولًا): الجهازُ المُرحَّلُ لا يستأنفُ ولا يعملُ ولو كانَ موقوفًا قبلَ التقاعدِ.
// - **الاستئنافُ ليسَ منَ المصفوفةِ:** `STATE_HALT_SOVEREIGN` حالةٌ نهائيةٌ في
//   المصفوفةِ، والاستئنافُ معاملةٌ سياديةٌ مستقلةٌ (شروطُها في الملحقِ §د.2) لا
//   «تصنيفًا» يقعُ في المراحلِ.

/**
 * المدخلاتُ كما تُعرِّفها المراحلُ 0–3.
 *
 * @typedef {Object} RecoveryInputs
 * @property {'ok'|'channel-failed'|'unavailable'|'index-missing'|'attest-invalid'} anchor
 *        المرحلةُ 0: قراءةُ المرساةِ (السببُ الأولَ لا تجميعُ الأسبابِ).
 * @property {boolean} manifestPresent
 * @property {boolean} manifestParseable
 * @property {boolean} sealVerifies   ختمُ HSM يتحقَّقُ.
 * @property {boolean} certVerifies  الشهادةُ حاضرةٌ وتتحقَّقُ (بما فيها `qualifyingData`).
 * @property {boolean} attestCounterEqualsB  `attest.counter == B`.
 * @property {boolean} halted
 * @property {boolean} retired
 * @property {bigint|null} C  قراءةٌ حيَّةٌ للعدّادِ (8 بايتاتٍ/bigint — لا Number).
 * @property {bigint|null} B  عدّادُ المتنِ الملتزَمِ.
 */

/** @typedef {'running'|'STATE_HALT_SOVEREIGN'|'STATE_RETIRED'|'STATE_MANIFEST_TPM_TORN'|'STATE_TPM_COUNTER_MISMATCH'|'STATE_TPM_ATTEST_INVALID'|'STATE_TPM_CHANNEL_FAILED'|'STATE_TPM_UNAVAILABLE'|'STATE_TPM_INDEX_MISSING'} RecoveryState */

/**
 * دالةُ القرارِ — مراحلُ متنافيةٌ بترتيبٍ حتميٍّ، لكلِّ تركيبةٍ نتيجةً واحدة.
 *
 * @param {RecoveryInputs} inputs
 * @returns {{ state: RecoveryState, closed: boolean, phase: 0|1|2|3 }}
 */
export function decideRecovery(inputs) {
  // المرحلةُ 0 — قراءةُ المرساةِ: بحسبِ السببِ الأولِ (لا تجميعَ).
  if (inputs.anchor !== 'ok') {
    const map = {
      'channel-failed': 'STATE_TPM_CHANNEL_FAILED',
      unavailable: 'STATE_TPM_UNAVAILABLE',
      'index-missing': 'STATE_TPM_INDEX_MISSING',
      'attest-invalid': 'STATE_TPM_ATTEST_INVALID',
    };
    const state = /** @type {RecoveryState} */ (map[inputs.anchor]);
    return { state, closed: true, phase: 0 };
  }
  // المرحلةُ 1 — صلاحيةُ البنيةِ: لا مسارَ إلى `running` من متنٍ بلا شهادةٍ.
  if (
    !inputs.manifestPresent ||
    !inputs.manifestParseable ||
    !inputs.sealVerifies ||
    !inputs.certVerifies ||
    !inputs.attestCounterEqualsB
  ) {
    return { state: 'STATE_TPM_ATTEST_INVALID', closed: true, phase: 1 };
  }
  // المرحلةُ 2 — مقارنةُ العدّادِ قبلَ أيِّ تصنيفِ إيقافٍ.
  if (inputs.C === null || inputs.B === null) {
    return { state: 'STATE_TPM_ATTEST_INVALID', closed: true, phase: 1 };
  }
  if (inputs.C < inputs.B) {
    // تزويرٌ أماميٌّ أو متنٌ من جهازٍ آخر.
    return { state: 'STATE_TPM_COUNTER_MISMATCH', closed: true, phase: 2 };
  }
  if (inputs.C === inputs.B) {
    // الحالةُ متّسقةٌ ⇐ المرحلةُ 3.
  } else {
    // C > B: زيادةٌ استُهلكتْ بلا التزامٍ مُثبَتٍ (==B+1) أو فجوةٌ غيرُ مفسَّرةٍ (>B+1).
    return { state: 'STATE_MANIFEST_TPM_TORN', closed: true, phase: 2 };
  }
  // المرحلةُ 3 — تصنيفُ الحالةِ المقبولةِ: **`retired` أولًا** (تنقيحٌ ثانٍ):
  // الجهازُ المُرحَّلُ مرفوضٌ للتشغيلِ دائمًا، والاستئنافُ لا يرفعُ تقاعدًا.
  if (inputs.retired) {
    return { state: 'STATE_RETIRED', closed: true, phase: 3 };
  }
  if (inputs.halted) {
    return { state: 'STATE_HALT_SOVEREIGN', closed: true, phase: 3 };
  }
  return { state: 'running', closed: false, phase: 3 };
}

/**
 * شروطُ معاملةِ الاستئنافِ السياديِّ (الملحقُ §د.2) — **ليست تصنيفًا** بل معاملةٌ
 * مستقلةٌ بشروطِها؛ تُعرَضُ هنا ليربطَها الاختبارُ بالمصفوفةِ: الاستئنافُ لا يُطلَقُ
 * إلا من `STATE_HALT_SOVEREIGN` (لا من `TORN` ولا من `RETIRED` ولا من `running`).
 *
 * @param {RecoveryState} state
 * @returns {boolean}
 */
export function resumeEligible(state) {
  return state === 'STATE_HALT_SOVEREIGN';
}
