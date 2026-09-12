/**
 * المُوائمُ الحتميُّ بلا شبكةٍ — سدادُ `D-11` (الشطرُ الثاني: مُنفِّذٌ يُقاسُ عليه).
 *
 * **لماذا مُوائمٌ حتميٌّ أوّلاً؟** لأنّ اختبارَ بوابةِ الاستدلالِ كان يَحقُنُ
 * دالّةً مزيّفةً في كلِّ حالةٍ، فكانَ يُثبِتُ **النداءَ** ولا يُثبِتُ **العقدَ**:
 * لا مُهلةَ تُقاسُ، ولا ناتجَ يُفحَصُ، ولا استهلاكَ يُحاسَبُ عليه بقاعدةٍ واحدةٍ.
 * وهذا المُوائمُ مُنفِّذٌ **حقيقيٌّ** بمعنى أنّه يمرُّ بالعقدِ كاملاً، و**حتميٌّ**
 * بمعنى أنّ المُخرَجَ دالّةٌ في (النموذجِ، الغرضِ، المُدخلِ) وحدَها — فالاختبارُ
 * يقيسُ سلوكاً يتكرَّرُ لا حظّاً.
 *
 * **ثلاثةُ حدودٍ مُعلَنةٌ:**
 *   1. **لا شبكةَ ولا نظامَ ملفّاتٍ.** لا يُستوردُ في هذا الملفِّ إلّا
 *      `node:crypto`؛ ولا `node:http` ولا `node:https` ولا `node:net` ولا
 *      `node:tls` ولا `fetch`. والحاجزُ `scripts/guard-inference.mjs` يحرسُ ذلك
 *      نصّاً، فإعلانُ `network: 'disabled'` **يُقاسُ** ولا يُصدَّقُ.
 *   2. **ليس نموذجَ لغةٍ ولا يُدّعى أنّه كذلك.** مُخرَجُه نصٌّ مُشتَقٌّ من بصمةِ
 *      مُدخلِه، ومُهمّتُه أن يُثبِتَ **مرورَ الاستدلالِ بالعقباتِ** لا أن يُفهِمَ
 *      كلاماً. ومن قرأ مُخرَجَه ذكاءً قرأ ما لا تدّعيه هذه الوحدةُ.
 *   3. **الأجوبةُ المُقرَّرةُ بياناتٌ لا شروطٌ.** يُمرَّرُ `answers` فيُطابَقُ
 *      بالغرضِ والمُدخلِ الحرفيَّين؛ وما لا يُطابِقُ يُجابُ بالصيغةِ الحتميّةِ.
 *      فلا فرعَ في الشفرةِ لكلِّ حالةِ اختبارٍ.
 */

import { createHash } from 'node:crypto';

import { assertAdapterDeclaration, executorFor } from './contract.mjs';

/** معرّفُ هذا المُوائمِ كما يُقيَّدُ. */
export const DETERMINISTIC_ADAPTER_ID = 'adapter:deterministic';

/** مُهلةٌ مُعلَنةٌ: تنفيذٌ داخليٌّ في مِللي ثانياتٍ، فمُهلةٌ ثانيةٌ واحدةٌ سقفٌ سخيٌّ. */
export const DETERMINISTIC_TIMEOUT_MS = 1_000;

/**
 * تقديرُ الرموزِ: **نفسُ قاعدةِ البوابةِ** (بايتٌ ÷ 4، بحدٍّ أدنى 1). ولو اختلفَ
 * التقديرُ بينَ المُوائمِ والبوابةِ لاختلفَ الخصمُ عن السقفِ، فصارَ للميزانيّةِ
 * مقياسانِ.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}

/**
 * @typedef {object} DeterministicAnswer
 * @property {string} purpose
 * @property {string} input
 * @property {string} output
 */

/**
 * @param {{ answers?: readonly DeterministicAnswer[], costPerThousandTokens?: number }} [options]
 * @returns {import('./contract.mjs').InferenceAdapter}
 */
export function createDeterministicAdapter(options = {}) {
  const answers = options.answers ?? [];
  const costPerThousandTokens = options.costPerThousandTokens ?? 0;
  const declaration = assertAdapterDeclaration({
    id: DETERMINISTIC_ADAPTER_ID,
    provider: 'داخليٌّ — حتميٌّ بلا شبكةٍ',
    transport: 'in-process',
    network: 'disabled',
    apiKeyEnv: null,
    timeoutMs: DETERMINISTIC_TIMEOUT_MS,
  });

  return {
    declaration,
    /**
     * @param {{ model: { id: string, purpose: string }, purpose: string, input: string, signal: AbortSignal }} call
     * @returns {Promise<{ output: string, usage: { inputTokens: number, outputTokens: number, totalTokens: number, cost: number } }>}
     */
    async invoke({ model, purpose, input, signal }) {
      // الإجهاضُ يُحترَمُ حتّى في مُنفِّذٍ سريعٍ: مُنفِّذٌ يُهمِلُ الإشارةَ يُعلِّمُ
      // من يقرأُه أنّ الإشارةَ تُهمَلُ.
      if (signal.aborted) {
        throw new Error('نداءُ المُوائمِ الحتميِّ أُجهِضَ قبلَ تنفيذِه.');
      }
      const declared = answers.find(
        (answer) => answer.purpose === purpose && answer.input === input,
      );
      const digest = createHash('sha256')
        .update(`${model.id}\n${purpose}\n${input}`, 'utf8')
        .digest('hex');
      const output =
        declared?.output ??
        `[استدلالٌ حتميٌّ] الغرضُ: ${purpose}؛ النموذجُ: ${model.id}؛ بصمةُ المُدخلِ: ${digest.slice(0, 32)}.`;
      const inputTokens = estimateTokens(input);
      const outputTokens = estimateTokens(output);
      const totalTokens = inputTokens + outputTokens;
      return {
        output,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          cost: Math.round((totalTokens / 1000) * costPerThousandTokens),
        },
      };
    },
  };
}

/**
 * مُنفِّذٌ جاهزٌ للبوابةِ: مُوائمٌ حتميٌّ مُغلَّفٌ بعقدِه.
 *
 * @param {{ answers?: readonly DeterministicAnswer[], costPerThousandTokens?: number }} [options]
 * @returns {(call: { model: { id: string, purpose: string }, purpose: string, input: string }) => Promise<{ output: string, usage: { inputTokens?: number, outputTokens?: number, totalTokens?: number, cost?: number } }>}
 */
export function deterministicExecutor(options = {}) {
  return executorFor(createDeterministicAdapter(options));
}
