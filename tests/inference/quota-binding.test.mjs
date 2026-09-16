// اختباراتُ ربطِ سقفِ الاستدلالِ بالوثيقةِ وقيدِ استهلاكِه في دفترِ التكلفةِ —
// `D-11`، الشوطُ الثالثُ (ب).
//
// **العيبُ المقيسُ هنا** كان مُعلَناً في `docs/INFERENCE.md` §5: سقفُ الرموزِ
// رقمٌ في الشفرةِ لا من `config/quotas.yaml`، والاستهلاكُ يقعُ بلا قيدٍ في دفترِ
// التكلفةِ. فما يُقاسُ في هذا الملفِّ ثلاثةٌ:
//   1. **الوثيقةُ هي المصدرُ**: البوابةُ بلا سقفٍ مُمرَّرٍ تحملُ حدَّ الوثيقةِ
//      ونافذتَها، وغيابُ الحصّةِ **رفضٌ مُسمّىً** لا سقوطٌ إلى رقمٍ مكتوبٍ.
//   2. **النافذتانِ مستقلّتانِ**: نافذةُ الميزانيةِ لا تُغلَقُ بمرورِ نافذةِ حدِّ
//      المعدَّلِ، وكان خلطُهما يُنفِذُ سقفَ ساعةٍ في دقيقةٍ.
//   3. **الاستهلاكُ يُقيَّدُ أو يُرفَضُ المُخرَجُ**: قيدٌ ناجحٌ في الدفترِ بكمّيةِ
//      الرموزِ وأبعادِها الثلاثةِ، وفشلُ القيدِ يمنعُ إعادةَ المُخرَجِ.

import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import { CostCapacity, loadCostCapacityPolicy } from '../../src/cost-capacity/index.mjs';
import { INFERENCE_ERRORS, InferenceError } from '../../src/inference/inference-gate.mjs';
import {
  INFERENCE_COST_ITEM,
  INFERENCE_QUOTA_ERRORS,
  INFERENCE_TOKENS_RESOURCE,
  inferenceCostItem,
  InferenceQuotaError,
  loadInferenceTokenQuota,
} from '../../src/inference/quota.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';

import { gateWithAdapter, memoryLog, minister } from '../helpers/inference-gate.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const INSTITUTION = 'institution:digital-administration';

/** @param {number} nowMs */
function ledgerOn(nowMs) {
  const log = memoryLog();
  const ledger = new CostCapacity({
    policy: loadCostCapacityPolicy({ dir: CONFIG_DIR }),
    log: /** @type {never} */ (/** @type {unknown} */ (log)),
    ledger: () => log.events.map((event) => ({ type: event.type, data: event.payload })),
    operations: null,
    nowMs: () => nowMs,
  });
  return { log, ledger };
}

test('حصّةُ الرموزِ تُقرأُ من الوثيقةِ بحدِّها ونافذتِها لا من رقمٍ في الشفرةِ', () => {
  const declared = loadPolicyBundle().quotas.find(
    (entry) => entry.resource === INFERENCE_TOKENS_RESOURCE,
  );
  assert.ok(declared !== undefined, 'الوثيقةُ لا تُعلنُ حصّةَ الاستدلالِ؛ والقياسُ بلا مرجعٍ');
  const quota = loadInferenceTokenQuota();
  assert.equal(quota.tokensPerWindow, declared.limit);
  assert.equal(quota.windowSeconds, declared.windowSeconds);
  assert.equal(quota.budgetWindowMs, declared.windowSeconds * 1000);
  assert.equal(quota.resource, INFERENCE_TOKENS_RESOURCE);
});

test('غيابُ الحصّةِ رفضٌ مُسمّىً لا سقوطٌ صامتٌ إلى سقفٍ افتراضيٍّ', () => {
  assert.throws(
    () => loadInferenceTokenQuota({ bundle: { quotas: [] } }),
    (error) =>
      error instanceof InferenceQuotaError &&
      error.code === INFERENCE_QUOTA_ERRORS.QUOTA_UNDECLARED,
  );
});

test('حدٌّ أو نافذةٌ غيرُ صحيحةٍ موجبةٍ ترفعُ رفضاً مُسمّىً', () => {
  for (const quota of [
    { resource: INFERENCE_TOKENS_RESOURCE, limit: 0, windowSeconds: 3600 },
    { resource: INFERENCE_TOKENS_RESOURCE, limit: 1.5, windowSeconds: 3600 },
    { resource: INFERENCE_TOKENS_RESOURCE, limit: 10, windowSeconds: 0 },
    { resource: INFERENCE_TOKENS_RESOURCE, limit: 10, windowSeconds: 'ساعة' },
  ]) {
    assert.throws(
      () => loadInferenceTokenQuota({ bundle: { quotas: [quota] } }),
      (error) =>
        error instanceof InferenceQuotaError && error.code === INFERENCE_QUOTA_ERRORS.QUOTA_INVALID,
      `الحصّةُ ${JSON.stringify(quota)} قُبِلت وهي غيرُ صالحةٍ`,
    );
  }
});

test('بندُ الكلفةِ يُقابَلُ بموردِ الحصّةِ: بندٌ مفقودٌ أو لموردٍ آخرَ يُرفَضُ', () => {
  assert.equal(inferenceCostItem().id, INFERENCE_COST_ITEM);
  assert.equal(inferenceCostItem().resource, INFERENCE_TOKENS_RESOURCE);
  assert.throws(
    () => inferenceCostItem({ policy: { costItems: [] } }),
    (error) =>
      error instanceof InferenceQuotaError &&
      error.code === INFERENCE_QUOTA_ERRORS.COST_ITEM_UNDECLARED,
  );
  assert.throws(
    () =>
      inferenceCostItem({
        policy: { costItems: [{ id: INFERENCE_COST_ITEM, resource: 'egress-bytes' }] },
      }),
    (error) =>
      error instanceof InferenceQuotaError &&
      error.code === INFERENCE_QUOTA_ERRORS.COST_ITEM_MISMATCH,
  );
});

test('البوابةُ بلا سقفٍ مُمرَّرٍ تحملُ حدَّ الوثيقةِ ونافذتَها، ونافذةُ المعدَّلِ تبقى مستقلّةً', async () => {
  const { gate } = await gateWithAdapter();
  const quota = loadInferenceTokenQuota();
  assert.equal(gate.tokensPerWindow, quota.tokensPerWindow);
  assert.equal(gate.budgetWindowMs, quota.budgetWindowMs);
  assert.notEqual(gate.budgetWindowMs, gate.windowMs);
  assert.equal(gate.windowMs, 60_000);
});

test('نافذةُ الميزانيةِ لا تُغلَقُ بمرورِ نافذةِ حدِّ المعدَّلِ', async () => {
  // السقفُ يُقاسُ لا يُخمَّنُ: نداءٌ واحدٌ على بوابةٍ بسقفِ الوثيقةِ يُعطي
  // استهلاكَ النداءِ، فيُبنى سقفٌ يكفي نداءً واحداً بالضبطِ ويُقاسُ عليه إغلاقُ
  // النافذةِ.
  const probe = await gateWithAdapter();
  const measured = await probe.gate.infer({
    actor: minister(),
    purpose: 'planning',
    input: 'خطّةٌ قصيرةٌ',
  });
  let nowMs = Date.UTC(2026, 4, 10, 12);
  const { gate } = await gateWithAdapter({
    tokensPerWindow: measured.usage.totalTokens,
    budgetWindowMs: 3_600_000,
    now: () => new Date(nowMs),
  });
  const actor = minister();
  const first = await gate.infer({ actor, purpose: 'planning', input: 'خطّةٌ قصيرةٌ' });
  assert.equal(first.usage.totalTokens, measured.usage.totalTokens);
  // مرورُ نافذةِ حدِّ المعدَّلِ (دقيقةٌ) لا يُصفِّرُ ميزانيةَ الرموزِ: لو صفَّرها
  // لَنَفَذَ سقفُ الساعةِ في كلِّ دقيقةٍ، فصار المُعلَنُ ستّينَ ضِعفَ النافذِ.
  nowMs += 61_000;
  await assert.rejects(
    () => gate.infer({ actor, purpose: 'planning', input: 'خطّةٌ قصيرةٌ' }),
    (error) => error instanceof InferenceError && error.code === INFERENCE_ERRORS.BUDGET_EXCEEDED,
  );
  // وبمرورِ نافذةِ الحصّةِ كاملةً تُفتَحُ الميزانيةُ من جديدٍ.
  nowMs += 3_600_000;
  const later = await gate.infer({ actor, purpose: 'planning', input: 'خطّةٌ قصيرةٌ' });
  assert.equal(later.usage.totalTokens, measured.usage.totalTokens);
});

test('الاستهلاكُ يُقيَّدُ في دفترِ التكلفةِ ببندِه وكمّيتِه وأبعادِه الثلاثةِ', async () => {
  const nowMs = Date.UTC(2026, 4, 10, 12);
  const { ledger, log: ledgerLog } = ledgerOn(nowMs);
  const { gate } = await gateWithAdapter({
    costLedger: ledger,
    costInstitution: INSTITUTION,
    now: () => new Date(nowMs),
  });
  const actor = minister();
  const result = await gate.infer({ actor, purpose: 'planning', input: 'خطّةٌ تُقيَّدُ كلفتُها' });
  const recorded = ledgerLog.events.filter((event) => event.type === 'cost.usage.recorded');
  assert.equal(recorded.length, 1);
  const entry = /** @type {{ payload: Record<string, unknown> }} */ (recorded[0]);
  assert.equal(entry.payload['item'], INFERENCE_COST_ITEM);
  assert.equal(entry.payload['resource'], INFERENCE_TOKENS_RESOURCE);
  assert.equal(entry.payload['quantity'], result.usage.totalTokens);
  assert.equal(entry.payload['institution'], INSTITUTION);
  assert.equal(entry.payload['agent'], actor.id);
  assert.equal(entry.payload['model'], `model:${result.modelId}`);
  assert.ok(Number(entry.payload['costMilli']) >= 0);
});

test('فشلُ القيدِ يمنعُ إعادةَ المُخرَجِ ويُقيَّدُ رفضاً مُسمّىً', async () => {
  const nowMs = Date.UTC(2026, 4, 10, 12);
  const { ledger } = ledgerOn(nowMs);
  const { gate, log } = await gateWithAdapter({
    costLedger: ledger,
    // مؤسسةٌ غيرُ مُعلَنةٍ في `config/cost-capacity.yaml`: الدفترُ يرفضُ الإسنادَ.
    costInstitution: 'institution:not-declared',
    now: () => new Date(nowMs),
  });
  await assert.rejects(
    () => gate.infer({ actor: minister(), purpose: 'planning', input: 'خطّةٌ بلا صاحبٍ للإنفاقِ' }),
    (error) => error instanceof InferenceError && error.code === INFERENCE_ERRORS.USAGE_UNRECORDED,
  );
  const refusals = log.events.filter((event) => event.type === 'inference.refused');
  assert.equal(refusals.length, 1);
  const refusal = /** @type {{ payload: Record<string, unknown> }} */ (refusals[0]);
  assert.equal(refusal.payload['code'], INFERENCE_ERRORS.USAGE_UNRECORDED);
  assert.equal(
    log.events.some((event) => event.type === 'inference.completed'),
    false,
    'أُعيدَ مُخرَجٌ استُهلِكَ له موردٌ بلا قيدٍ',
  );
});

test('دفترٌ بلا مؤسسةٍ يُسنَدُ إليها الإنفاقُ يُرفَضُ عندَ البناءِ لا عندَ أوّلِ قيدٍ', async () => {
  const { ledger } = ledgerOn(Date.UTC(2026, 4, 10, 12));
  // لا نُمرِّرُ `gateWithAdapter` لأنّه يوفّرُ مؤسسةً افتراضيّةً — نُنشئُ البوابةَ
  // مباشرةً لنقيسَ الرفضَ عندَ غيابِ المؤسسةِ.
  await assert.rejects(
    () => gateWithAdapter({ costLedger: ledger, costInstitution: '' }),
    (error) =>
      error instanceof InferenceError && error.code === INFERENCE_ERRORS.DEPENDENCY_MISSING,
  );
});
