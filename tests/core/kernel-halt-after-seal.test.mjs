// WL-317 — «صفرُ تنفيذٍ بعدَ الإيقافِ» على السجلِّ المختوم: إيقافٌ يصدرُ في أثناءِ ختمِ قيودِ
// المهمّةِ يمنعُ المُعالِجَ.
//
// `ExecutionKernel.submit` يفحصُ الإيقافَ مرّتَين: قبلَ قبولِ التاجِ، ثمّ «قبلَ تشغيلِ المُعالِجِ
// مباشرةً» لأنّ «بينَ قبولِ التاجِ وبدءِ الفعلِ نافذةٌ زمنيّةٌ قد يصدرُ فيها إيقاف». وفي `WL-304`
// (‏`LIVE-25`) صارَ بينَ الفحصِ الثاني والمُعالِجِ `await this.flushAudit()` — ختمُ قيودِ التفويضِ
// والقبولِ والطابورِ والبدءِ بالتوكن، وهو أطولُ خطوةٍ في المسارِ. فالنافذةُ التي أُغلِقَت بالفحصِ
// الثاني فُتِحَت ثانيةً بعدَه: إيقافٌ يصدرُ (‏من هذه العمليّةِ أو من غيرِها على القرص) في أثناءِ
// الختمِ لا يُرى، والمُعالِجُ يُنادى على دولةٍ موقوفة.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';

import { ExecutionKernel } from '../../src/core/execution-kernel.mjs';
import { sealedAudit } from '../../src/root-of-trust/sealed-audit.mjs';

/** حاجزُ إيقافٍ بديلٌ بعقدِ `HaltSwitch.assertOperational`: يُقرأُ في كلِّ نداء. */
function haltGuard() {
  const guard = {
    halted: false,
    assertOperational() {
      if (guard.halted) throw new Error('SOVEREIGN_HALT');
    },
  };
  return guard;
}

/**
 * سجلٌّ مختومٌ بديلٌ عبرَ المُحوِّلِ الإنتاجيِّ نفسِه؛ ختمُ القيدِ المُسمّى يُطلِقُ الإيقافَ
 * في أثنائِه — كإيقافٍ يصدرُ والتوكنُ يختمُ.
 * @param {{ halted: boolean }} guard
 * @param {string} haltDuring
 */
function sealedLogHaltingDuring(guard, haltDuring) {
  /** @type {string[]} */
  const written = [];
  const audit = sealedAudit({
    appendSealed: async (/** @type {string} */ type) => {
      await new Promise((resolve) => setImmediate(resolve));
      if (type === haltDuring) guard.halted = true;
      written.push(type);
      return { type };
    },
  });
  return { audit, written };
}

const accepted = {
  id: 'cmd:wl-317',
  action: 'read-dashboard',
  target: 'dash:x',
  payload: {},
  issuedAt: '2026-10-03T00:00:00.000Z',
  acceptedAt: '2026-10-03T00:00:00.000Z',
};

describe('WL-317 — الإيقافُ في أثناءِ ختمِ قيودِ المهمّةِ يمنعُ المُعالِج', () => {
  test('H1 — إيقافٌ في أثناءِ ختمِ `kernel.task.started` ⇒ لا يُنادى المُعالِجُ ويُرفَعُ `SOVEREIGN_HALT`', async () => {
    const guard = haltGuard();
    const { audit, written } = sealedLogHaltingDuring(guard, 'kernel.task.started');
    const kernel = new ExecutionKernel({
      crown: /** @type {never} */ ({ commandAsync: async () => accepted, command: () => accepted }),
      log: /** @type {never} */ (audit),
      haltSwitch: guard,
    });
    let ran = false;
    await assert.rejects(
      () => kernel.submit(accepted, 'sig', async () => (ran = true)),
      /SOVEREIGN_HALT/,
    );
    assert.equal(ran, false, 'المُعالِجُ نُوديَ بعدَ صدورِ الإيقاف');
    assert.ok(written.includes('kernel.task.failed'), 'الرفضُ يُقيَّدُ فشلاً للمهمّة');
    assert.equal(written.includes('kernel.task.succeeded'), false);
  });

  test('H2 — بلا إيقافٍ: المُعالِجُ يُنادى مرّةً بعدَ ختمِ قيودِه', async () => {
    const guard = haltGuard();
    const { audit, written } = sealedLogHaltingDuring(guard, 'never');
    const kernel = new ExecutionKernel({
      crown: /** @type {never} */ ({ commandAsync: async () => accepted, command: () => accepted }),
      log: /** @type {never} */ (audit),
      haltSwitch: guard,
    });
    let calls = 0;
    /** @type {string[]} */
    let sealedBeforeHandler = [];
    const task = await kernel.submit(accepted, 'sig', async () => {
      calls += 1;
      sealedBeforeHandler = [...written];
      return 'done';
    });
    assert.equal(calls, 1);
    assert.equal(task.state, 'succeeded');
    assert.deepEqual(sealedBeforeHandler, ['kernel.task.queued', 'kernel.task.started']);
  });
});
