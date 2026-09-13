import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionKernel } from '../../src/core/execution-kernel.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';

/**
 * R6-A-08: الوضعُ الآمنُ المحلّيُّ للنواةِ يُدخَلُ ويُخرَجُ منه بنداءِ دالّةٍ بلا
 * فاعلٍ ولا أمرٍ. صارَ الفاعلُ يُمرَّرُ اختياريّاً، والمنادي مسؤولٌ عن تمريرِه.
 */
describe('R6-A-08: kernel safe-mode stop/resume accept actor identity', () => {
  function buildKernel() {
    const log = new EventLog();
    const crown = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
      resume() {
        this.stopped = false;
      },
      command: async () => ({ ok: true }),
    };
    const kernel = new ExecutionKernel({ crown, log });
    return { kernel, log };
  }

  test('stop يُسجِّلُ هويةَ الفاعلِ الآمرِ بالإيقافِ لا ثابتاً', () => {
    const { kernel, log } = buildKernel();
    kernel.stop('emergency', 'king:test-actor-08');
    const events = log.snapshot();
    const stopEvent = events.find((e) => e.type === 'kernel.safe-mode.entered');
    assert.ok(stopEvent, 'stop must log an event');
    assert.equal(
      stopEvent.actor,
      'king:test-actor-08',
      'actor must be the passed identity, not hardcoded crown',
    );
  });

  test('resume يُسجِّلُ هويةَ الفاعلِ الآمرِ بالاستئنافِ لا ثابتاً', () => {
    const { kernel, log } = buildKernel();
    kernel.stop('emergency', 'king:test-stop-actor');
    kernel.resume('king:test-resume-actor');
    const events = log.snapshot();
    const resumeEvent = events.find((e) => e.type === 'kernel.safe-mode.left');
    assert.ok(resumeEvent, 'resume must log an event');
    assert.equal(
      resumeEvent.actor,
      'king:test-resume-actor',
      'actor must be the passed identity, not hardcoded crown',
    );
  });

  test('stop بلا فاعلٍ يرجعُ إلى crown للتوافقِ مع الوراءِ', () => {
    const { kernel, log } = buildKernel();
    kernel.stop('test');
    const events = log.snapshot();
    const stopEvent = events.find((e) => e.type === 'kernel.safe-mode.entered');
    assert.ok(stopEvent);
    assert.equal(stopEvent.actor, 'crown', 'default actor remains crown');
  });
});
