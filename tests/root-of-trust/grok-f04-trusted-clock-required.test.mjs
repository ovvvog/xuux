// Grok-F04 — الساعة الموثوقة مطفأة افتراضياً؛ رجوع ساعة الجهاز يُحيي أمراً منتهياً.
//
// الإ سالاح: `CrownGateway` يلزمُ الآن بساعةٍ موثوقةٍ في أيِّ تركيبٍ غيرِ اختباريٍّ
// (`requireTrustedClock`، افتراضُه `NODE_ENV === 'production'`). غيابُها فشلٌ مغلقٌ
// (`CLOCK_REQUIRED_IN_PRODUCTION`) لا سقوطٌ إلى `Date.now()`. وساعةٌ غيرُ موثوقةٍ
// ترفضُ الأمرَ قبلَ استهلاكِ معرّفِه. وفي التطويرِ يُسمَحُ بالغيابِ صراحةً.
//
// اختباراتٌ خصميّةٌ تُثبتُ: (أ) الإنتاجُ بلا ساعةٍ يفشلُ مغلقاً؛ (ب) الإنتاجُ بساعةٍ
// موثوقةٍ يعملُ؛ (ج) ساعةٌ غيرُ موثوقةٍ (انزياحٌ) ترفضُ الأمرَ فشلاً مغلقاً؛ (د) الأمرُ
// يُرفضُ قبلَ استهلاكِ معرّفِه (إعادةُ الإرسالِ ما زالت ممكنةً بعد إصلاحِ الساعة)؛
// (هـ) التطويرُ بلا ساعةٍ يبقى يعملُ (توافقٌ مع المستهلكين القائمين).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CrownGateway } from '../../src/root-of-trust/crown.mjs';
import { KingIdentity, CertificateAuthority } from '../../src/root-of-trust/identity.mjs';
import { EventLog } from '../../src/root-of-trust/event-log.mjs';
import { ClockError } from '../../src/root-of-trust/clock.mjs';

/**
 * ساعةٌ موثوقةٌ مُسجَّلةٌ قابلٌ للحقنِ والتحكّمِ في «الآن».
 * @implements {import('../../src/root-of-trust/clock.mjs').TrustedClock}
 */
class FakeTrustedClock {
  #now = Date.now();
  #trusted = true;

  /** @param {number} ms */ setNow(ms) {
    this.#now = ms;
  }
  /** @param {boolean} trusted */ setTrusted(trusted) {
    this.#trusted = trusted;
  }

  /** @returns {number} */
  now() {
    if (!this.#trusted) throw new ClockError('CLOCK_SKEW_DETECTED', { driftMs: 9999 });
    return this.#now;
  }

  assertTrusted() {
    if (!this.#trusted) throw new ClockError('CLOCK_SKEW_DETECTED', { driftMs: 9999 });
  }
}

/** يبني بوابةً للإنتاجِ (تُلزمُ الساعةَ الموثوقة) أو للتطويرِ. */
function makeGateway({ requireTrustedClock, clock }) {
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  return {
    king,
    ca,
    gateway: new CrownGateway(king, ca, new EventLog(), { requireTrustedClock, clock }),
  };
}

/** يصنع أمراً ملكياً موقعاً صالحاً لنصفِ ساعةٍ مضت. */
function signedRecentCommand(king) {
  const issuedAt = new Date(Date.now() - 30_000).toISOString();
  const command = {
    id: `cmd:${Math.random().toString(36).slice(2)}`,
    action: 'read',
    target: 'resource:x',
    payload: {},
    issuedAt,
  };
  return { command, signature: king.sign(command) };
}

test('Grok-F04: التركيبُ الإنتاجيُّ بلا ساعةٍ موثوقةٍ يفشلُ مغلقاً (CLOCK_REQUIRED_IN_PRODUCTION)', () => {
  const { king, gateway } = makeGateway({ requireTrustedClock: true, clock: null });
  const { command, signature } = signedRecentCommand(king);
  assert.throws(
    () => gateway.command(command, signature),
    (err) => err instanceof ClockError && err.code === 'CLOCK_REQUIRED_IN_PRODUCTION',
    'يجبُ رفضُ الأمرِ في الإنتاجِ بلا ساعةٍ موثوقةٍ برمزِ CLOCK_REQUIRED_IN_PRODUCTION',
  );
});

test('Grok-F04: التركيبُ الإنتاجيُّ بساعةٍ موثوقةٍ يقبلُ الأمرَ الصالحَ', () => {
  const clock = new FakeTrustedClock();
  const { king, gateway } = makeGateway({ requireTrustedClock: true, clock });
  const { command, signature } = signedRecentCommand(king);
  const accepted = gateway.command(command, signature);
  assert.equal(accepted.id, command.id, 'الأمرُ مقبولٌ بساعةٍ موثوقةٍ');
});

test('Grok-F04: ساعةٌ غيرُ موثوقةٍ (انزياحٌ) ترفضُ الأمرَ فشلاً مغلقاً', () => {
  const clock = new FakeTrustedClock();
  clock.setTrusted(false);
  const { king, gateway } = makeGateway({ requireTrustedClock: true, clock });
  const { command, signature } = signedRecentCommand(king);
  assert.throws(
    () => gateway.command(command, signature),
    (err) => err instanceof ClockError && err.code === 'CLOCK_SKEW_DETECTED',
    'ساعةٌ موثوقةٌ لكنّها غيرُ موثوقةٍ (انزياحٌ) ترفضُ الأمرَ برمزِ CLOCK_SKEW_DETECTED',
  );
});

test('Grok-F04: الأمرُ يُرفضُ قبلَ استهلاكِ معرّفِه — إعادةُ الإرسالِ ممكنةٌ بعد الإصلاح', () => {
  const clock = new FakeTrustedClock();
  clock.setTrusted(false);
  const { king, gateway } = makeGateway({ requireTrustedClock: true, clock });
  const { command, signature } = signedRecentCommand(king);
  // الرفضُ الأولُ بسببِ الساعةِ غيرِ الموثوقةِ.
  assert.throws(() => gateway.command(command, signature), ClockError);
  // بعد إصلاحِ الساعة، الأمرُ نفسُه (نفسُ المعرّفِ) يُقبلُ — لم يُستهلك.
  clock.setTrusted(true);
  const accepted = gateway.command(command, signature);
  assert.equal(accepted.id, command.id, 'المعرّفُ لم يُستهلك عند الرفض، فأُعيد إرسالُه بنجاح');
});

test('Grok-F04: التطويرُ بلا ساعةٍ (requireTrustedClock:false) يبقى يعملُ (توافقٌ مع القائمين)', () => {
  const { king, gateway } = makeGateway({ requireTrustedClock: false, clock: null });
  const { command, signature } = signedRecentCommand(king);
  const accepted = gateway.command(command, signature);
  assert.equal(
    accepted.id,
    command.id,
    'التطويرُ بلا ساعةٍ يقبلُ الأمرَ — توافقٌ مع المستهلكين القائمين',
  );
});

test('Grok-F04: النبضُ في الإنتاجِ بلا ساعةٍ يفشلُ مغلقاً كذلك', () => {
  const { gateway } = makeGateway({ requireTrustedClock: true, clock: null });
  assert.throws(
    () => gateway.heartbeat(),
    (err) => err instanceof ClockError && err.code === 'CLOCK_REQUIRED_IN_PRODUCTION',
    'النبضُ كذلك يلزمُه ساعةٌ موثوقةٌ في الإنتاج',
  );
});
