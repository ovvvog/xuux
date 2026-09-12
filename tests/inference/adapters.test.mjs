// اختبارُ عقدِ مُوائمِ الاستدلالِ والمُوائمِ الحتميِّ — سدادُ `D-11` (الدفعةُ الأولى).
//
// **المقيسُ هنا هو الرفضُ لا المرورُ:** أنّ إعلاناً مُتناقِضاً يُرفَضُ، وأنّ
// مُوائماً يدّعي قراراً يُرفَضُ ولا يُهمَلُ حقلُه، وأنّ استهلاكاً فاسداً يُرفَضُ
// قبلَ أن يُخصَمَ من ميزانيّةٍ، وأنّ نداءً يتجاوزُ مُهلتَه يُجهَضُ فعلاً
// بإشارةٍ يراها المُنفِّذُ. ثمَّ يُقاسُ المرورُ **عبرَ البوابةِ نفسِها** لا عبرَ
// دالّةٍ مزيّفةٍ: استدلالٌ يمرُّ بالعقباتِ ويعودُ بمُخرَجٍ حتميٍّ واستهلاكٍ مقيسٍ.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADAPTER_ERRORS,
  assertAdapterDeclaration,
  assertAdapterResult,
  executorFor,
  MAX_ADAPTER_TIMEOUT_MS,
} from '../../src/inference/adapters/contract.mjs';
import {
  createDeterministicAdapter,
  DETERMINISTIC_ADAPTER_ID,
  deterministicExecutor,
  estimateTokens,
} from '../../src/inference/adapters/deterministic.mjs';
import { INFERENCE_ERRORS } from '../../src/inference/inference-gate.mjs';
import { gateWithAdapter, minister } from '../helpers/inference-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('الإعلانُ المُتناقِضُ مع نقلِه يُرفَضُ، والمُهلةُ المفتوحةُ تُرفَضُ', () => {
  const base = {
    id: 'adapter:x',
    provider: 'جهةٌ',
    transport: 'in-process',
    network: 'disabled',
    apiKeyEnv: null,
    timeoutMs: 1_000,
  };
  assert.deepEqual(assertAdapterDeclaration(base).id, 'adapter:x');
  assert.throws(
    () => assertAdapterDeclaration({ ...base, network: 'https-only' }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.NETWORK_UNDECLARED,
  );
  assert.throws(
    () => assertAdapterDeclaration({ ...base, transport: 'https', network: 'disabled' }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.NETWORK_UNDECLARED,
  );
  assert.throws(
    () => assertAdapterDeclaration({ ...base, timeoutMs: 0 }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
  assert.throws(
    () => assertAdapterDeclaration({ ...base, timeoutMs: MAX_ADAPTER_TIMEOUT_MS + 1 }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
  assert.throws(
    () => assertAdapterDeclaration({ ...base, id: '' }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('سرٌّ في الإعلانِ يُرفَضُ: القيمةُ لا تُقبَلُ مكانَ اسمِ متغيّرِ البيئةِ', () => {
  const base = {
    id: 'adapter:y',
    provider: 'جهةٌ',
    transport: 'https',
    network: 'https-only',
    timeoutMs: 5_000,
  };
  assert.equal(
    assertAdapterDeclaration({ ...base, apiKeyEnv: 'STATE_MODEL_API_KEY' }).apiKeyEnv,
    'STATE_MODEL_API_KEY',
  );
  assert.throws(
    () => assertAdapterDeclaration({ ...base, apiKeyEnv: 'sk-abcdefghijklmnop' }),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.SECRET_INLINE,
  );
  assert.throws(
    () => assertAdapterDeclaration({ ...base, apiKeyEnv: 'state_model_api_key' }),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.SECRET_INLINE,
  );
  assert.throws(
    () => assertAdapterDeclaration({ ...base, apiKeyEnv: null, token: 'Bearer xyz.abc' }),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.SECRET_INLINE,
  );
});

test('مُوائمٌ يدّعي قراراً أو نموذجاً غيرَ المُوجَّهِ إليه يُرفَضُ', () => {
  const expectation = { model: { id: 'model-1' }, adapterId: 'adapter:z' };
  assert.equal(assertAdapterResult({ output: 'نصٌّ' }, expectation).output, 'نصٌّ');
  for (const field of ['policyId', 'decision', 'allowed', 'token', 'ticket', 'actor']) {
    assert.throws(
      () => assertAdapterResult({ output: 'نصٌّ', [field]: 'أيُّ قيمةٍ' }, expectation),
      (/** @type {Error & { code?: string }} */ error) =>
        error.code === ADAPTER_ERRORS.AUTHORITY_CLAIMED,
      `الحقلُ ${field} كان يجبُ أن يُرفَضَ`,
    );
  }
  assert.throws(
    () => assertAdapterResult({ output: 'نصٌّ', modelId: 'model-2' }, expectation),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.MODEL_MISMATCH,
  );
  assert.throws(
    () => assertAdapterResult({ output: 42 }, expectation),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.RESULT_INVALID,
  );
});

test('استهلاكٌ فاسدٌ يُرفَضُ قبلَ أن يُخصَمَ من ميزانيّةٍ', () => {
  const expectation = { model: { id: 'model-1' }, adapterId: 'adapter:z' };
  for (const usage of [
    { totalTokens: -1 },
    { totalTokens: 1.5 },
    { totalTokens: Number.NaN },
    { cost: -5 },
    { inputTokens: '10' },
  ]) {
    assert.throws(
      () => assertAdapterResult({ output: 'نصٌّ', usage }, expectation),
      (/** @type {Error & { code?: string }} */ error) =>
        error.code === ADAPTER_ERRORS.USAGE_INVALID,
      `الاستهلاكُ ${JSON.stringify(usage)} كان يجبُ أن يُرفَضَ`,
    );
  }
  const clean = assertAdapterResult(
    { output: 'نصٌّ', usage: { totalTokens: 12, cost: 3, extra: 9 } },
    expectation,
  );
  assert.deepEqual({ ...clean.usage }, { totalTokens: 12, cost: 3 });
});

test('المُهلةُ تُجهِضُ النداءَ بإشارةٍ يراها المُنفِّذُ لا تُهمِلُه', async () => {
  /** @type {{ aborted: boolean }} */
  const observed = { aborted: false };
  const execute = executorFor({
    declaration: {
      id: 'adapter:slow',
      provider: 'جهةٌ',
      transport: 'in-process',
      network: 'disabled',
      apiKeyEnv: null,
      timeoutMs: 25,
    },
    invoke: ({ signal }) =>
      new Promise((resolve, reject) => {
        const late = setTimeout(() => resolve({ output: 'متأخِّرٌ' }), 500);
        late.unref?.();
        signal.addEventListener('abort', () => {
          observed.aborted = true;
          clearTimeout(late);
          reject(new Error('نداءُ المُوائمِ أُجهِضَ بإشارةِ المُهلةِ.'));
        });
      }),
  });
  await assert.rejects(
    execute({ model: { id: 'model-1', purpose: 'planning' }, purpose: 'planning', input: 'س' }),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.TIMED_OUT,
  );
  assert.equal(
    observed.aborted,
    true,
    'الإشارةُ لم تصلْ إلى المُنفِّذِ فالنداءُ أُهمِلَ ولم يُجهَضْ',
  );
});

test('مُوائمٌ بلا `invoke` يُرفَضُ — وهذا هو الدَينُ نفسُه', () => {
  assert.throws(
    () => executorFor(/** @type {never} */ ({ declaration: {} })),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.INVOKE_MISSING,
  );
});

test('المُوائمُ الحتميُّ: نفسُ المُدخلِ ⇒ نفسُ المُخرَجِ، ومُدخلٌ آخرُ ⇒ مُخرَجٌ آخرُ', async () => {
  const execute = deterministicExecutor();
  const call = {
    model: { id: 'model-1', purpose: 'planning' },
    purpose: 'planning',
    input: 'خطّةٌ لأسبوعٍ',
  };
  const first = await execute(call);
  const second = await execute(call);
  assert.equal(first.output, second.output);
  const other = await execute({ ...call, input: 'خطّةٌ لشهرٍ' });
  assert.notEqual(other.output, first.output);
  assert.equal(first.usage.inputTokens, estimateTokens(call.input));
  const inputTokens = /** @type {number} */ (first.usage.inputTokens);
  const outputTokens = /** @type {number} */ (first.usage.outputTokens);
  assert.equal(first.usage.totalTokens, inputTokens + outputTokens);
  assert.equal(createDeterministicAdapter().declaration.id, DETERMINISTIC_ADAPTER_ID);
  assert.equal(createDeterministicAdapter().declaration.network, 'disabled');
});

test('الأجوبةُ المُقرَّرةُ بياناتٌ تُطابَقُ بالغرضِ والمُدخلِ', async () => {
  const execute = deterministicExecutor({
    answers: [{ purpose: 'planning', input: 'س', output: 'جوابٌ مُقرَّرٌ' }],
  });
  const matched = await execute({
    model: { id: 'model-1', purpose: 'planning' },
    purpose: 'planning',
    input: 'س',
  });
  assert.equal(matched.output, 'جوابٌ مُقرَّرٌ');
  const unmatched = await execute({
    model: { id: 'model-1', purpose: 'planning' },
    purpose: 'planning',
    input: 'ص',
  });
  assert.notEqual(unmatched.output, 'جوابٌ مُقرَّرٌ');
});

/**
 * يُجرَّدُ النصُّ من التعليقاتِ قبلَ القياسِ: الوثيقةُ تذكرُ ما تمنعُه بالاسمِ،
 * فقياسٌ على النصِّ كاملاً يقيسُ الكلامَ عن المنعِ لا المنعَ نفسَه.
 * @param {string} source
 * @returns {string}
 */
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

test('وحدةُ المُوائمِ الحتميِّ لا تستوردُ شبكةً ولا نظامَ ملفّاتٍ — الإعلانُ مقيسٌ لا مُصدَّقٌ', () => {
  const source = codeOf(
    fs.readFileSync(path.join(ROOT, 'src', 'inference', 'adapters', 'deterministic.mjs'), 'utf8'),
  );
  for (const forbidden of [
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:fs',
    'fetch(',
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `المُوائمُ الحتميُّ يستوردُ «${forbidden}» بينما يُعلنُ شبكةً مُعطَّلةً`,
    );
  }
});

test('استدلالٌ يمرُّ بالبوابةِ فعلاً بمُوائمٍ لا بدالّةٍ مزيّفةٍ، ويُقيَّدُ استهلاكُه', async () => {
  const { gate, log, purpose } = await gateWithAdapter();
  const result = await gate.infer({
    actor: minister(),
    purpose,
    input: 'اكتبْ خطّةً لأسبوعٍ',
    inputClassification: 'internal',
  });
  assert.match(result.output, /استدلالٌ حتميٌّ/u);
  assert.ok(result.usage.totalTokens > 0);
  assert.equal(result.usage.totalTokens, result.usage.inputTokens + result.usage.outputTokens);
  const completed = log.events.filter((event) => event.type === 'inference.completed');
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0]?.payload['usage'], result.usage);
});

test('البوابةُ ترفضُ ناتجَ مُوائمٍ خالفَ عقدَه ولا تُقيِّدُه إتماماً', async () => {
  const execute = executorFor({
    declaration: {
      id: 'adapter:liar',
      provider: 'جهةٌ',
      transport: 'in-process',
      network: 'disabled',
      apiKeyEnv: null,
      timeoutMs: 500,
    },
    invoke: async () => ({ output: 'نصٌّ', policyId: 'policy:forged' }),
  });
  const { gate, log, purpose } = await gateWithAdapter({ execute });
  await assert.rejects(
    gate.infer({ actor: minister(), purpose, input: 'س', inputClassification: 'internal' }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === INFERENCE_ERRORS.EXECUTION_FAILED,
  );
  assert.equal(
    log.events.some((event) => event.type === 'inference.completed'),
    false,
    'قُيِّدَ إتمامٌ لاستدلالٍ خالفَ مُوائمُه عقدَه',
  );
  const refused = log.events.filter((event) => event.type === 'inference.refused');
  assert.equal(refused.length, 1);
  assert.match(String(refused[0]?.payload['reason']), /AUTHORITY_CLAIMED|حقلَ سلطةٍ/u);
});

test('الاستهلاكُ المقيسُ من المُوائمِ يُخصَمُ فيُرفَضُ التاليُ عندَ تجاوزِ السقفِ', async () => {
  // والسقفُ يُشتَقُّ من قياسٍ لا يُكتَبُ رقماً يداً: يُنادى المُوائمُ مرّةً خارجَ
  // البوابةِ ليُعرَفَ استهلاكُ نداءٍ واحدٍ، فيُجعَلَ السقفُ نداءً واحداً بالضبطِ.
  // فلو كُتِبَ رقمٌ تقديراً لصارَ الاختبارُ يمرُّ أو يفشلُ بطولِ نصٍّ لا بحكمٍ.
  const { gate, purpose, model } = await gateWithAdapter();
  const probe = await deterministicExecutor()({
    model: { id: model.id, purpose },
    purpose,
    input: 'س',
  });
  const oneCall = /** @type {number} */ (probe.usage.totalTokens);
  gate.tokensPerWindow = oneCall;
  const first = await gate.infer({
    actor: minister(),
    purpose,
    input: 'س',
    inputClassification: 'internal',
  });
  assert.equal(first.usage.totalTokens, oneCall);
  await assert.rejects(
    gate.infer({ actor: minister(), purpose, input: 'س', inputClassification: 'internal' }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === INFERENCE_ERRORS.BUDGET_EXCEEDED,
  );
});
