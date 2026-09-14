/**
 * ميزانيّةُ الاستدلالِ لا تُمحى بإعادةِ التشغيلِ — `R6-A-05` (حالةُ الميزانيّةِ)
 *
 * العيبُ الذي يُقاسُ هنا: دفترُ الميزانيّةِ في بوابةِ الاستدلالِ كان في الذاكرةِ
 * وفي عمليّةٍ واحدةٍ، فمن استنفدَ سقفَه في نافذتِه استأنفَ الإنفاقَ بعدَ إعادةِ
 * تشغيلِ العمليّةِ بنافذةٍ نظيفةٍ. وهذا **يوسِّعُ الصلاحيةَ** بإعادةِ التشغيلِ لا
 * يضيِّقُها — وهو خلافُ حدِّ دفترِ المنحِ المُعلَنِ (حيثُ السقوطُ يضيِّقُ) — فصارَ
 * السقفُ المُعلَنُ في `config/quotas.yaml` قابلاً للتجاوزِ بفعلٍ لا يحتاجُ صلاحيةً:
 * إعادةُ الإقلاعِ.
 *
 * والقياسُ هنا على ثلاثِ ركائزَ:
 *   1. **الدوامُ يعملُ:** ما استُهلِكَ في نافذةٍ حيّةٍ يعودُ بعدَ الإقلاعِ فيُرفَضُ
 *      ما كان سيُرفَضُ.
 *   2. **الاستعادةُ لا تُخفِّضُ:** لقطةٌ مصنوعةٌ تُعلِنُ استهلاكاً أقلَّ لا تمحو
 *      استهلاكاً أعلى قائماً — الأعلى هو المُلزِمُ، فلا تصيرُ الاستعادةُ بابَ
 *      تصفيرٍ.
 *   3. **النافذةُ المنتهيةُ لا تُمَدُّ:** لقطةٌ من نافذةٍ انقضتْ تُهمَلُ، فلا
 *      يُحمَلُ استهلاكٌ قديمٌ على نافذةٍ جديدةٍ ولا يُمَدُّ عمرُ نافذةٍ بلقطةٍ.
 *
 * التشغيل: node --test tests/inference/budget-snapshot-restore.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { INFERENCE_ERRORS } from '../../src/inference/inference-gate.mjs';
import { gateWithAdapter } from '../helpers/inference-gate.mjs';

/**
 * ساعةٌ مُقادةٌ: النافذةُ تُقاسُ بها لا بمرورِ زمنٍ حقيقيٍّ.
 * @param {number} startMs
 * @returns {{ now: () => Date, advance: (ms: number) => void }}
 */
function clockAt(startMs) {
  let cursor = startMs;
  return {
    now: () => new Date(cursor),
    advance(ms) {
      cursor += ms;
    },
  };
}

const WINDOW_MS = 3_600_000;
const TOKENS = 400;

/**
 * بوابةٌ بسقفِ رموزٍ ضيّقٍ ونافذةٍ طويلةٍ، كي يكونَ الاستنفادُ مقيساً بالاستهلاكِ
 * لا بمرورِ الوقتِ.
 * @param {{ now: () => Date }} clock
 */
async function budgetGate(clock) {
  return gateWithAdapter({
    tokensPerWindow: TOKENS,
    budgetWindowMs: WINDOW_MS,
    now: clock.now,
  });
}

/**
 * @param {Awaited<ReturnType<typeof gateWithAdapter>>} harness
 * @param {string} actorId
 * @param {string} input
 */
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

describe('R6-A-05: ميزانيّةُ الاستدلالِ تُقاسُ عبرَ إعادةِ التشغيلِ', () => {
  test('ما استُهلِكَ في نافذةٍ حيّةٍ يعودُ باللقطةِ فيُرفَضُ تجاوزُه بعدَ الإقلاعِ', async () => {
    const clock = clockAt(Date.UTC(2026, 8, 14, 12, 0, 0));
    const first = await budgetGate(clock);
    const actorId = 'agent-budget-restart';

    // إنفاقٌ يقتربُ من السقفِ في نافذةٍ واحدةٍ.
    let consumed = 0;
    for (let index = 0; index < 2; index++) {
      const result = await spend(first, actorId, `تحليلُ خطّةٍ رقم ${String(index)} `);
      consumed += /** @type {{ usage: { totalTokens: number } }} */ (result).usage.totalTokens;
      clock.advance(1_000);
    }
    assert.ok(consumed > 0, 'الاستهلاكُ المقيسُ يجبُ أن يكونَ موجباً');

    const snapshot = first.gate.budgetSnapshot();
    assert.equal(snapshot.length, 1, 'اللقطةُ تحملُ صاحبَ الإنفاقِ الوحيدَ');
    const captured = /** @type {{ actorId: string, tokens: number }} */ (snapshot[0]);
    assert.equal(captured.actorId, actorId);
    assert.equal(captured.tokens, consumed, 'اللقطةُ تحملُ الاستهلاكَ المقيسَ نفسَه');

    // «إعادةُ التشغيلِ»: بوابةٌ جديدةٌ بساعةٍ في النافذةِ نفسِها.
    const second = await budgetGate(clock);
    assert.equal(second.gate.budgetRestore(snapshot), 1, 'الاستعادةُ تُعيدُ بناءَ نافذةٍ واحدةٍ');
    assert.equal(
      /** @type {{ tokens: number }} */ (second.gate.budgetSnapshot()[0]).tokens,
      consumed,
    );

    // وما كان سيُرفَضُ لتجاوزِ السقفِ يُرفَضُ بعدَ الإقلاعِ.
    await assert.rejects(
      () => spend(second, actorId, 'إعادةُ الإنفاقِ بعدَ الإقلاعِ '.repeat(40)),
      (error) => /** @type {{ code?: string }} */ (error).code === INFERENCE_ERRORS.BUDGET_EXCEEDED,
      'الميزانيّةُ المستعادةُ يجبُ أن تمنعَ ما يتجاوزُ السقفَ',
    );
  });

  test('لقطةٌ تُعلِنُ استهلاكاً أقلَّ لا تُخفِّضُ استهلاكاً قائماً', async () => {
    const clock = clockAt(Date.UTC(2026, 8, 14, 13, 0, 0));
    const harness = await budgetGate(clock);
    const actorId = 'agent-budget-monotone';

    const result = await spend(harness, actorId, 'قياسُ استهلاكٍ حقيقيٍّ ');
    const consumed = /** @type {{ usage: { totalTokens: number } }} */ (result).usage.totalTokens;
    const startedAt = /** @type {{ startedAt: number }} */ (harness.gate.budgetSnapshot()[0])
      .startedAt;

    // لقطةٌ مصنوعةٌ تُعلِنُ صفراً: لا تُقبَلُ تخفيضاً.
    const applied = harness.gate.budgetRestore([{ actorId, startedAt, tokens: 0, cost: 0 }]);
    assert.equal(applied, 0, 'لقطةٌ أدنى من القائمِ لا تُطبَّقُ');
    assert.equal(
      /** @type {{ tokens: number }} */ (harness.gate.budgetSnapshot()[0]).tokens,
      consumed,
      'الاستهلاكُ الأعلى يبقى هو المُلزِمَ',
    );
  });

  test('لقطةٌ من نافذةٍ انقضتْ تُهمَلُ ولا تُمَدُّ بها نافذةٌ', async () => {
    const clock = clockAt(Date.UTC(2026, 8, 14, 14, 0, 0));
    const harness = await budgetGate(clock);
    const actorId = 'agent-budget-expired';
    const staleStartedAt = clock.now().getTime() - WINDOW_MS - 1;

    const applied = harness.gate.budgetRestore([
      { actorId, startedAt: staleStartedAt, tokens: TOKENS, cost: 0 },
    ]);
    assert.equal(applied, 0, 'نافذةٌ انقضتْ لا تُستعادُ');
    assert.deepEqual(harness.gate.budgetSnapshot(), [], 'لا نافذةَ تُنشَأُ من لقطةٍ منتهيةٍ');

    // ولأنّ النافذةَ القديمةَ لم تُحمَلْ، الإنفاقُ الجديدُ مقبولٌ ضمنَ سقفِه.
    const fresh = await spend(harness, actorId, 'نافذةٌ جديدةٌ ');
    assert.ok(
      /** @type {{ usage: { totalTokens: number } }} */ (fresh).usage.totalTokens > 0,
      'نافذةٌ جديدةٌ تُقاسُ من الصفرِ لا من لقطةٍ منتهيةٍ',
    );
  });

  test('لقطةٌ معطوبةُ الشكلِ تُهمَلُ سطراً سطراً ولا تُسقِطُ الاستعادةَ', async () => {
    const clock = clockAt(Date.UTC(2026, 8, 14, 15, 0, 0));
    const harness = await budgetGate(clock);
    const startedAt = clock.now().getTime();

    const applied = harness.gate.budgetRestore([
      null,
      { actorId: '', startedAt, tokens: 5, cost: 0 },
      { actorId: 'agent-ok', startedAt, tokens: 5, cost: 1 },
      { actorId: 'agent-bad-tokens', startedAt, tokens: Number.NaN, cost: 0 },
      { actorId: 'agent-negative', startedAt, tokens: -50, cost: 0 },
    ]);
    assert.equal(applied, 1, 'يُطبَّقُ السليمُ وحدَه');
    assert.deepEqual(
      harness.gate.budgetSnapshot().map((entry) => entry.actorId),
      ['agent-ok'],
    );
  });

  test('الاستعادةُ بغيرِ مصفوفةٍ تُرجِعُ صفراً ولا ترمي', async () => {
    const clock = clockAt(Date.UTC(2026, 8, 14, 16, 0, 0));
    const harness = await budgetGate(clock);
    assert.equal(harness.gate.budgetRestore(undefined), 0);
    assert.equal(harness.gate.budgetRestore(null), 0);
    assert.equal(harness.gate.budgetRestore('لقطة'), 0);
  });
});

describe('R6-A-05: مخزنُ الدوامِ يجعلُ القيدَ آليّاً لا موقوفاً على إقلاعٍ يدويٍّ', () => {
  test('المخزنُ يُقرأُ عندَ أوّلِ قياسٍ ويُكتَبُ عندَ كلِّ استهلاكٍ، فالسقفُ يبقى بعدَ الإقلاعِ', async () => {
    const clock = clockAt(Date.UTC(2026, 8, 14, 17, 0, 0));
    /** @type {Array<{ actorId: string, startedAt: number, tokens: number, cost: number }>} */
    let durable = [];
    const store = {
      load: () => durable,
      /** @param {Array<{ actorId: string, startedAt: number, tokens: number, cost: number }>} entries */
      save: (entries) => {
        durable = entries.map((entry) => ({ ...entry }));
      },
    };
    const actorId = 'agent:minister-inference-1';

    const first = await gateWithAdapter({
      tokensPerWindow: TOKENS,
      budgetWindowMs: WINDOW_MS,
      now: clock.now,
      budgetStore: store,
    });
    for (let index = 0; index < 2; index++) {
      await spend(first, actorId, `تحليلُ خطّةٍ رقم ${String(index)} `);
      clock.advance(1_000);
    }
    assert.equal(durable.length, 1, 'المخزنُ كُتِبَ بلا نداءٍ يدويٍّ');
    const persisted = /** @type {{ tokens: number }} */ (durable[0]);
    assert.ok(persisted.tokens > 0, 'المخزنُ يحملُ الاستهلاكَ المقيسَ');

    // بوابةٌ جديدةٌ على المخزنِ نفسِه — ولا شفرةَ إقلاعٍ تُنادي الاستعادةَ.
    const second = await gateWithAdapter({
      tokensPerWindow: TOKENS,
      budgetWindowMs: WINDOW_MS,
      now: clock.now,
      budgetStore: store,
    });
    await assert.rejects(
      () => spend(second, actorId, 'إعادةُ الإنفاقِ بعدَ الإقلاعِ '.repeat(40)),
      (error) => /** @type {{ code?: string }} */ (error).code === INFERENCE_ERRORS.BUDGET_EXCEEDED,
      'السقفُ المُدامُ يجبُ أن يمنعَ التجاوزَ بعدَ الإقلاعِ بلا تركيبٍ يدويٍّ',
    );
  });

  test('مخزنٌ لا يُقرأُ يُغلِقُ البوابةَ ولا يُفترَضُ صفراً', async () => {
    const clock = clockAt(Date.UTC(2026, 8, 14, 18, 0, 0));
    const harness = await gateWithAdapter({
      tokensPerWindow: TOKENS,
      budgetWindowMs: WINDOW_MS,
      now: clock.now,
      budgetStore: {
        load: () => {
          throw new Error('DISK_UNREADABLE');
        },
        save: () => undefined,
      },
    });
    await assert.rejects(
      () => spend(harness, 'agent:minister-inference-1', 'قياسٌ على مخزنٍ معطوبٍ '),
      (error) =>
        /** @type {{ code?: string }} */ (error).code === INFERENCE_ERRORS.BUDGET_UNREADABLE,
      'تعذُّرُ القراءةِ يُرفَضُ برمزٍ مُسمّىً لا يُبتلَعُ',
    );
  });

  test('استهلاكٌ وقعَ ولم يُدَمْ لا يُعادُ مُخرَجُه', async () => {
    const clock = clockAt(Date.UTC(2026, 8, 14, 19, 0, 0));
    const harness = await gateWithAdapter({
      tokensPerWindow: TOKENS,
      budgetWindowMs: WINDOW_MS,
      now: clock.now,
      budgetStore: {
        load: () => [],
        save: () => {
          throw new Error('DISK_FULL');
        },
      },
    });
    await assert.rejects(
      () => spend(harness, 'agent:minister-inference-1', 'استهلاكٌ لا يُقيَّدُ '),
      (error) =>
        /** @type {{ code?: string }} */ (error).code === INFERENCE_ERRORS.BUDGET_UNPERSISTED,
      'فشلُ الدوامِ يمنعُ إعادةَ المُخرَجِ',
    );
    // والاستهلاكُ مع ذلك مقيسٌ في الذاكرةِ: لا يُمحى لأنّ الكتابةَ فشلتْ.
    assert.equal(harness.gate.budgetSnapshot().length, 1, 'الاستهلاكُ الواقعُ يبقى مقيساً');
  });
});
