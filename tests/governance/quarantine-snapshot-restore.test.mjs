import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { QuarantineWarden } from '../../src/governance/quarantine.mjs';

/**
 * R6-A-05: أربعُ حالاتِ نقضٍ/احتواءٍ تُفقَدُ بإعادةِ التشغيلِ. هذا الاختبارُ
 * يُثبتُ أنّ لقطةَ الحجرِ (snapshot/restore) تُعيدُ بناءَ حالةِ المحجورين بعدَ
 * الفقدِ.
 */

function buildWarden() {
  /** @type {{ type: string, actor: string, payload: object }[]} */
  const events = [];
  const incidents = {
    open(/** @type {{ type: string, subject: string }} */ spec) {
      return { id: `inc-${spec.subject}-${Date.now()}` };
    },
    close() {},
  };
  const log = {
    append(/** @type {string} */ type, /** @type {string} */ actor, /** @type {object} */ payload) {
      events.push({ type, actor, payload });
    },
  };
  const warden = new QuarantineWarden({
    incidents,
    log,
    isolate: null,
    thresholds: {},
    now: () => new Date('2026-09-13T12:00:00Z'),
  });
  return { warden, events };
}

describe('R6-A-05: quarantine snapshot/restore survives restart', () => {
  test('snapshot تُلتقطُ المحجورين وrestore تُعيدُهم', () => {
    const { warden, events } = buildWarden();

    // محجورانِ مختلفان
    warden.report({ kind: 'budget-exceeded', subject: 'agent:one', detail: {} });
    // Second report to trigger quarantine (threshold is 3 by default)
    warden.report({ kind: 'budget-exceeded', subject: 'agent:one', detail: {} });
    warden.report({ kind: 'budget-exceeded', subject: 'agent:one', detail: {} });

    warden.report({ kind: 'budget-exceeded', subject: 'agent:two', detail: {} });
    warden.report({ kind: 'budget-exceeded', subject: 'agent:two', detail: {} });
    warden.report({ kind: 'budget-exceeded', subject: 'agent:two', detail: {} });

    assert.equal(warden.isQuarantined('agent:one'), true);
    assert.equal(warden.isQuarantined('agent:two'), true);

    // لقطة
    const snap = warden.snapshot();
    assert.equal(snap.length, 2, 'snapshot should have 2 quarantined subjects');

    // محاكاةُ إعادةِ التشغيل: وردانٌ جديدٌ بلا حالة
    const { warden: warden2, events: events2 } = buildWarden();
    assert.equal(warden2.isQuarantined('agent:one'), false, 'new warden should be empty');

    // استعادة
    const restored = warden2.restore(snap);
    assert.equal(restored, 2, 'should restore 2 subjects');
    assert.equal(warden2.isQuarantined('agent:one'), true, 'agent:one should be quarantined');
    assert.equal(warden2.isQuarantined('agent:two'), true, 'agent:two should be quarantined');

    // استُعيدَ كلٌّ بسجلِّ quarantine.restored
    const restoreEvents = events2.filter((e) => e.type === 'quarantine.restored');
    assert.equal(restoreEvents.length, 2, 'should log 2 restore events');
  });

  test('restore لا تُكرِّرُ المحجورَ القائمَ', () => {
    const { warden } = buildWarden();
    warden.report({ kind: 'budget-exceeded', subject: 'agent:dup', detail: {} });
    warden.report({ kind: 'budget-exceeded', subject: 'agent:dup', detail: {} });
    warden.report({ kind: 'budget-exceeded', subject: 'agent:dup', detail: {} });
    assert.equal(warden.isQuarantined('agent:dup'), true);

    const snap = warden.snapshot();
    // محاولةُ استعادةِ محجورٍ قائمٍ بالفعل
    const restored = warden.restore(snap);
    assert.equal(restored, 0, 'should not duplicate existing quarantine');
  });

  test('restore تتجاهلُ المدخلاتِ غيرَ الصالحة', () => {
    const { warden } = buildWarden();
    assert.equal(warden.restore(null), 0);
    assert.equal(warden.restore('not-an-array'), 0);
    assert.equal(warden.restore([{ subject: 'x' }]), 0, 'missing kind should be skipped');
    assert.equal(warden.restore([{ kind: 'x' }]), 0, 'missing subject should be skipped');
  });
});
