// WL-320 — LIVE-32: عدّادُ `pending` في `createSealedEventSink` لا يتضخّمُ بعدَ الفشل.
//
// العقدُ المُعلَنُ في `src/root-of-trust/production-runtime.mts`: «عددُ ما لم يستقرَّ
// بعد» (`pending`). والمنفِّذُ يَعِدُ بأنَّ `drain` يَرفَعُ أولَ فشلٍ ولا يُفقَدُ قيدٌ
// بصمت. لكنَّ `pending` كانَ يُنقَصُ في `finally` وحده، والإرجاعُ المبكّرُ بعدَ الفشلِ
// يتخطّاه — فيتضخّمُ العدّادُ بكلِّ قيدٍ تالٍ، فيُقرأُ عددٌ كاذبٌ.
//
// المقيسُ: بعدَ فشلٍ واحدٍ وثلاثةِ قيودٍ تالٍ، `pending` = 0 لا 3.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { PersistentEventLog } from '../../src/root-of-trust/persistent-log.mjs';
import { createSealedEventSink } from '../../src/root-of-trust/production-runtime.mjs';

/**
 * خاتمٌ بديلٌ يَسقُطُ في ختمِ الجسمِ الأوّلِ مرّةً واحدة، كتوكنٍ لم يُجِبْ.
 */
function flakySealer() {
  let failed = false;
  return {
    keyId: '05',
    seal: async (/** @type {unknown} */ data) => {
      await Promise.resolve();
      if (/** @type {{ failSeal?: boolean }} */ (data).failSeal === true && !failed) {
        failed = true;
        throw new Error('HSM_SEAL_TRANSIENT_FAILURE');
      }
      return { sealed: JSON.stringify(data) };
    },
    open: async (/** @type {unknown} */ sealed) =>
      JSON.parse(/** @type {{ sealed: string }} */ (sealed).sealed),
  };
}

describe('WL-320 — LIVE-32: `pending` لا يتضخّمُ بعدَ الفشل', () => {
  test('P1 — ثلاثةُ قيودٍ بعدَ فشلٍ ⇒ `pending` = 0 لا 3', async () => {
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl-320-pending-')));
    const file = join(root, 'events.log');
    const log = new PersistentEventLog(file, { sealer: flakySealer(), fsync: false, env: {} });
    try {
      log.load();
      const sink = createSealedEventSink(log);

      // القيدُ الأوّلُ يُسقِطُ الختمَ.
      sink.append('kernel.task.queued', 'dash:x', { taskId: 't1', failSeal: true });
      // ثلاثةُ قيودٍ تالٍ تُدرَجُ بعدَ أن صارَ `failures.length > 0`.
      sink.append('kernel.task.started', 'dash:x', { taskId: 't1' });
      sink.append('quarantine.signal', 'agent:a', { kind: 'egress-refused' });
      sink.append('quarantine.isolated', 'agent:a', { kind: 'egress-refused' });

      await assert.rejects(() => sink.drain(), /HSM_SEAL_TRANSIENT_FAILURE/);

      assert.equal(
        sink.pending,
        0,
        'pending يتضخّمُ بعدَ الفشل: القيودُ الثلاثةُ التاليةُ لم تُنقَصْ — عدّادٌ كاذبٌ',
      );
    } finally {
      log.close();
    }
  });

  test('P2 — بلا فشلٍ: `pending` = 0 بعدَ `drain`', async () => {
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl-320-ok-')));
    const file = join(root, 'events.log');
    const log = new PersistentEventLog(file, { sealer: flakySealer(), fsync: false, env: {} });
    try {
      log.load();
      const sink = createSealedEventSink(log);

      sink.append('kernel.task.queued', 'dash:x', { taskId: 't1' });
      sink.append('kernel.task.started', 'dash:x', { taskId: 't1' });

      await sink.drain();

      assert.equal(sink.pending, 0, 'pending يجب أن يكون صفراً بعد الاستقرار');
    } finally {
      log.close();
    }
  });

  test('P3 — `pending` يَعكِسُ القيودَ غيرَ المستقرةِ قبلَ `drain`', async () => {
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl-320-inflight-')));
    const file = join(root, 'events.log');
    const log = new PersistentEventLog(file, { sealer: flakySealer(), fsync: false, env: {} });
    try {
      log.load();
      const sink = createSealedEventSink(log);

      sink.append('a', 'x', {});
      sink.append('b', 'x', {});
      sink.append('c', 'x', {});

      // قبلَ drain قد تكون القيودُ في الطابورِ — والعدّادُ لا يَعِدُ بأنّه صفرٌ.
      // لكنّه لا يتجاوزُ عددَ القيودِ المُدرَجة.
      assert.ok(sink.pending <= 3, `pending (${sink.pending}) يتجاوزُ عددَ القيودِ المُدرَجة (3)`);

      await sink.drain();
      assert.equal(sink.pending, 0);
    } finally {
      log.close();
    }
  });
});
