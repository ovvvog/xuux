// WL-316 — مُحوِّلُ السجلِّ المختومِ (‏`sealedAudit`) لا يَكتُبُ قيداً بعدَ قيدٍ سقطَ ختمُه.
//
// العقدُ المُعلَنُ في رأسِ `src/root-of-trust/sealed-audit.mts`: «بعدَ أوّلِ فشلٍ يُرفَضُ كلُّ
// إلحاقٍ تالٍ — فلا يمضي السجلُّ بثقبٍ صامت». والمقيسُ قبلَ الإصلاح أنّ الرفضَ يُفحَصُ **عندَ
// الإدراجِ** وحدَه: قيدٌ أُدرِجَ في الطابورِ قبلَ أن يُعرَفَ فشلُ سابقِه يُختَمُ ويُكتَبُ بعدَه.
// فإن سقطَ ختمُ `A` (‏توكنٌ لم يُجِبْ مرّةً) وكانَ `B` في الطابورِ، صارَ على القرصِ `B` بلا `A`
// — سلسلةُ تجزئةٍ صحيحةٌ (‏`verify()` صادقةٌ) وفيها ثقبٌ لا يُرى. وهذا ما يُدرِجُه كلُّ مستهلكٍ
// متزامنٍ في الإنتاجِ: نقطةُ الإنفاذِ والنواةُ (‏`kernel.task.queued` ثمّ `kernel.task.started`)
// والحاجبُ (‏`quarantine.signal` ثمّ `quarantine.isolated`) — يُدرِجونَ متتابعينَ ثمّ `flush`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { sealedAudit } from '../../src/root-of-trust/sealed-audit.mjs';
import { PersistentEventLog } from '../../src/root-of-trust/persistent-log.mjs';

/**
 * سجلٌّ مختومٌ بديلٌ يَحفَظُ ما كُتِبَ بترتيبِه ويُسقِطُ الإلحاقَ ذا النوعِ المُسمّى مرّةً.
 * @param {string} failingType
 */
function recordingLog(failingType) {
  /** @type {string[]} */
  const written = [];
  let failed = false;
  return {
    written,
    appendSealed: async (/** @type {string} */ type) => {
      await Promise.resolve();
      if (type === failingType && !failed) {
        failed = true;
        throw new Error('SEAL_TRANSIENT_FAILURE');
      }
      written.push(type);
      return { type };
    },
  };
}

/**
 * خاتمٌ بديلٌ (‏لا تشفيرَ — الموضوعُ ترتيبُ الكتابةِ لا سرّيّتُها) يَسقُطُ في ختمِ الجسمِ
 * المُعلَّمِ مرّةً، كتوكنٍ لم يُجِبْ في نداءٍ واحد.
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

describe('WL-316 — sealedAudit: لا قيدَ يُكتَبُ بعدَ قيدٍ سقطَ ختمُه', () => {
  test('S1 — `append` متتابعٌ: سقوطُ ختمِ الأوّلِ ⇒ الثاني لا يُكتَبُ، و`flush` يَرفعُ الفشل', async () => {
    const log = recordingLog('kernel.task.queued');
    const audit = sealedAudit(log);
    audit.append('kernel.task.queued', 'dash:x', { taskId: 't1' });
    audit.append('kernel.task.started', 'dash:x', { taskId: 't1' });
    await assert.rejects(() => audit.flush(), /SEAL_TRANSIENT_FAILURE/);
    assert.deepEqual(
      log.written,
      [],
      'قيدُ البدءِ كُتِبَ بلا قيدِ الطابورِ قبلَه: ثقبٌ صامتٌ في السجلِّ المختوم',
    );
  });

  test('S2 — `appendSealed` المُدرَجُ قبلَ معرفةِ الفشلِ يُرفَضُ ولا يُكتَب', async () => {
    const log = recordingLog('quarantine.signal');
    const audit = sealedAudit(log);
    const first = audit.appendSealed('quarantine.signal', 'agent:a', { kind: 'egress-refused' });
    const second = audit.appendSealed('quarantine.isolated', 'agent:a', { kind: 'egress-refused' });
    await assert.rejects(() => first, /SEAL_TRANSIENT_FAILURE/);
    await assert.rejects(() => second, /SEAL_TRANSIENT_FAILURE/);
    assert.deepEqual(log.written, []);
    // وبعدَ الفشلِ يبقى الرفضُ كما كانَ: لا إلحاقَ متزامناً ولا غيرَ متزامن.
    assert.throws(() => audit.append('x', 'y', {}), /SEAL_TRANSIENT_FAILURE/);
    await assert.rejects(() => audit.appendSealed('x', 'y', {}), /SEAL_TRANSIENT_FAILURE/);
  });

  test('S3 — ما قبلَ الفشلِ يُكتَبُ بترتيبِه ولا يُمَسّ', async () => {
    const log = recordingLog('c');
    const audit = sealedAudit(log);
    audit.append('a', 'x', {});
    audit.append('b', 'x', {});
    audit.append('c', 'x', {});
    audit.append('d', 'x', {});
    await assert.rejects(() => audit.flush(), /SEAL_TRANSIENT_FAILURE/);
    assert.deepEqual(log.written, ['a', 'b']);
  });

  test('S4 — بلا فشلٍ: كلُّ قيدٍ يُكتَبُ بترتيبِ إدراجِه و`flush` يستقرّ', async () => {
    const log = recordingLog('never');
    const audit = sealedAudit(log);
    for (const type of ['a', 'b', 'c']) audit.append(type, 'x', {});
    await audit.flush();
    assert.deepEqual(log.written, ['a', 'b', 'c']);
  });

  test('S5 — على `PersistentEventLog` حقيقيٍّ: سقوطُ ختمِ قيدٍ لا يتركُ على القرصِ ما بعدَه', async () => {
    const root = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl-316-sealed-audit-')));
    const file = join(root, 'events.log');
    const log = new PersistentEventLog(file, { sealer: flakySealer(), fsync: false, env: {} });
    try {
      log.load();
      const audit = sealedAudit(log);
      audit.append('kernel.task.queued', 'dash:x', { taskId: 't1', failSeal: true });
      audit.append('kernel.task.started', 'dash:x', { taskId: 't1' });
      await assert.rejects(() => audit.flush(), /HSM_SEAL_TRANSIENT_FAILURE/);
    } finally {
      log.close();
    }
    const reopened = new PersistentEventLog(file, { sealer: flakySealer(), fsync: false, env: {} });
    try {
      reopened.load();
      assert.equal(reopened.verify(), true);
      assert.deepEqual(
        reopened.events.map((event) => event.type),
        [],
        'على القرصِ `kernel.task.started` بلا `kernel.task.queued` — والسلسلةُ صحيحةٌ فلا يُرى الثقب',
      );
    } finally {
      reopened.close();
    }
  });
});
