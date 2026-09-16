/**
 * مخزنُ دوامِ ميزانيةِ الاستدلالِ على قرصٍ — `LIM-1` (‏`WL-197`).
 *
 * العيبُ الذي يُقاسُ هنا: العدّادُ كان في الذاكرةِ وحدَها، فمن استنفدَ سقفَه
 * استأنفَ الإنفاقَ بإعادةِ التشغيلِ. والقياسُ هنا على ثلاثِ ركائزَ:
 *   1. **الدوامُ على قرصٍ:** ما استُهلِكَ في نافذةٍ حيّةٍ يُكتَبُ على ملفٍّ،
 *      وبوابةٌ جديدةٌ تقرأُه فترفضُ ما تجاوزَ السقفَ.
 *   2. **الملفُّ معطوبٌ لا يُفترَضُ صفراً:** تلفُ JSON يُرفَعُ لا يُبتلَعُ.
 *   3. **الرفضُ عندَ البناءِ:** بوابةٌ بلا `budgetStore` أو بلا `costLedger` تُرفَضُ
 *      عندَ البناءِ لا عندَ أوّلِ نداءٍ.
 *
 * التشغيل: node --test tests/inference/budget-store.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileInferenceBudgetStore } from '../../src/inference/budget-store.mjs';
import { INFERENCE_ERRORS, InferenceError } from '../../src/inference/inference-gate.mjs';
import { gateWithAdapter } from '../helpers/inference-gate.mjs';

/** @returns {string} */
function tempBudgetPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lim1-store-'));
  return path.join(dir, 'budget.json');
}

/** @param {number} startMs */
function clockAt(startMs) {
  let cursor = startMs;
  return {
    now: () => new Date(cursor),
    /** @param {number} ms */
    advance(ms) {
      cursor += ms;
    },
  };
}

const WINDOW_MS = 3_600_000;
const TOKENS = 400;

/** @param {{ now: () => Date }} clock @param {string} [budgetPath] */
async function budgetGate(clock, budgetPath) {
  const store = new FileInferenceBudgetStore({
    filePath: budgetPath ?? tempBudgetPath(),
  });
  return gateWithAdapter({
    tokensPerWindow: TOKENS,
    budgetWindowMs: WINDOW_MS,
    now: clock.now,
    budgetStore: store,
  });
}

/** @param {Awaited<ReturnType<typeof budgetGate>>} harness @param {string} actorId @param {string} input */
async function spend(harness, actorId, input) {
  return harness.gate.infer({
    actor: {
      id: actorId,
      role: 'role:minister',
      kind: /** @type {const} */ ('human'),
      state: 'active',
      scope: 'org:planning',
    },
    purpose: harness.purpose,
    input,
  });
}

test('LIM-1: الملفُّ يُكتَبُ على قرصٍ بعدَ الاستهلاكِ', () => {
  const budgetPath = tempBudgetPath();
  const store = new FileInferenceBudgetStore({ filePath: budgetPath });
  assert.ok(!fs.existsSync(budgetPath), 'الملفُّ لم يُخلَقْ بعد');
  store.save([{ actorId: 'agent:test-1', startedAt: Date.now(), tokens: 100, cost: 5 }]);
  assert.ok(fs.existsSync(budgetPath), 'الملفُّ خُلِقَ بعدَ الحفظ');
  const raw = fs.readFileSync(budgetPath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed), 'المحتوى مصفوفة');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].actorId, 'agent:test-1');
  assert.equal(parsed[0].tokens, 100);
});

test('LIM-1: الملفُّ الغائبُ يعني عدّاداً نظيفاً لا خطأً', () => {
  const budgetPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lim1-empty-')), 'nope.json');
  const store = new FileInferenceBudgetStore({ filePath: budgetPath });
  assert.deepEqual(store.load(), [], 'ملفٌّ غائبٌ يعني مصفوفةً فارغة');
});

test('LIM-1: الملفُّ المعطوبُ يُرفَضُ لا يُفترَضُ صفراً', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lim1-corrupt-'));
  const budgetPath = path.join(dir, 'budget.json');
  fs.writeFileSync(budgetPath, 'ليس JSON صالح', 'utf8');
  const store = new FileInferenceBudgetStore({ filePath: budgetPath });
  assert.throws(
    () => store.load(),
    (error) => error instanceof Error && error.message.includes('تعذُّرَ قراءةُ'),
    'JSON معطوبٌ يُرفَضُ لا يُفترَضُ صفراً',
  );
});

test('LIM-1: المصفوفةُ المتوقَّعةُ تُقرأُ كما هي', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lim1-read-'));
  const budgetPath = path.join(dir, 'budget.json');
  const entries = [
    { actorId: 'agent:a', startedAt: 1000, tokens: 50, cost: 2 },
    { actorId: 'agent:b', startedAt: 2000, tokens: 30, cost: 1 },
  ];
  fs.writeFileSync(budgetPath, JSON.stringify(entries), 'utf8');
  const store = new FileInferenceBudgetStore({ filePath: budgetPath });
  const loaded = store.load();
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0]?.actorId, 'agent:a');
  assert.equal(loaded[1]?.tokens, 30);
});

test('LIM-1: الدوامُ عبرَ الإقلاعِ على ملفٍّ حقيقيٍّ', async () => {
  const clock = clockAt(Date.UTC(2026, 8, 17, 12, 0, 0));
  const budgetPath = tempBudgetPath();
  const actorId = 'agent:lim1-durability';

  const first = await budgetGate(clock, budgetPath);
  let consumed = 0;
  for (let index = 0; index < 2; index++) {
    const result = await spend(first, actorId, `خطّةٌ رقم ${String(index)} `);
    consumed += /** @type {{ usage: { totalTokens: number } }} */ (result).usage.totalTokens;
    clock.advance(1_000);
  }
  assert.ok(consumed > 0, 'الاستهلاكُ المقيسُ موجب');
  assert.ok(fs.existsSync(budgetPath), 'الملفُّ خُلِقَ على قرص');

  // «إعادةُ التشغيلِ»: بوابةٌ جديدةٌ على نفسِ الملفِّ — بلا استعادةٍ يدويّة.
  const second = await budgetGate(clock, budgetPath);
  await assert.rejects(
    () => spend(second, actorId, 'إعادةُ الإنفاقِ بعدَ الإقلاعِ '.repeat(40)),
    (error) => /** @type {{ code?: string }} */ (error).code === INFERENCE_ERRORS.BUDGET_EXCEEDED,
    'السقفُ المدومُ على قرصٍ يجبُ أن يمنعَ التجاوزَ بعدَ الإقلاع',
  );
});

test('LIM-1: بوابةٌ بلا budgetStore تُرفَضُ عندَ البناءِ', async () => {
  // ننشئُ البوابةَ مباشرةً لا عبرَ gateWithAdapter لأنّ المساعدَ يوفّرُ مخزناً افتراضيّاً.
  const { InferenceGate } = await import('../../src/inference/inference-gate.mjs');
  assert.throws(
    () =>
      new InferenceGate(
        /** @type {never} */ (
          /** @type {unknown} */ ({
            modelRegistry: {},
            enforcementPoint: {},
            log: { append() {} },
            execute: async () => ({ output: '' }),
            costLedger: { record() {} },
            costInstitution: 'institution:test',
          })
        ),
      ),
    (error) =>
      error instanceof InferenceError && error.code === INFERENCE_ERRORS.DEPENDENCY_MISSING,
    'غيابُ budgetStore رفضٌ عندَ البناءِ',
  );
});

test('LIM-1: بوابةٌ بلا costLedger تُرفَضُ عندَ البناءِ', async () => {
  const { InferenceGate } = await import('../../src/inference/inference-gate.mjs');
  assert.throws(
    () =>
      new InferenceGate(
        /** @type {never} */ (
          /** @type {unknown} */ ({
            modelRegistry: {},
            enforcementPoint: {},
            log: { append() {} },
            execute: async () => ({ output: '' }),
            budgetStore: {
              load() {
                return [];
              },
              save() {},
            },
            costInstitution: 'institution:test',
          })
        ),
      ),
    (error) =>
      error instanceof InferenceError && error.code === INFERENCE_ERRORS.DEPENDENCY_MISSING,
    'غيابُ costLedger رفضٌ عندَ البناءِ',
  );
});

test('LIM-1: بوابةٌ بلا costInstitution تُرفَضُ عندَ البناءِ', async () => {
  const { InferenceGate } = await import('../../src/inference/inference-gate.mjs');
  assert.throws(
    () =>
      new InferenceGate(
        /** @type {never} */ (
          /** @type {unknown} */ ({
            modelRegistry: {},
            enforcementPoint: {},
            log: { append() {} },
            execute: async () => ({ output: '' }),
            budgetStore: {
              load() {
                return [];
              },
              save() {},
            },
            costLedger: { record() {} },
          })
        ),
      ),
    (error) =>
      error instanceof InferenceError && error.code === INFERENCE_ERRORS.DEPENDENCY_MISSING,
    'غيابُ costInstitution رفضٌ عندَ البناءِ',
  );
});
