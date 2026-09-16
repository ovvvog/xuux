// بوّابةُ التاجِ ترفضُ الساعةَ غيرَ المُبرهَنةِ — معيارُ إغلاقِ `D-7` (‏`WL-192`).
//
// معيارُ الإغلاقِ شقّانِ: توقيعٌ يُتحقَّقُ منه (يُقاسُ في `tests/time/`)، و**رفضُ
// الساعةِ غيرِ المُبرهَنةِ في المسارِ السياديِّ** — وهو المقيسُ هنا. والمقيسُ رفضٌ
// لا وجودُ حقلٍ: أمرٌ ملكيٌّ صحيحُ التوقيعِ يُرفَضُ لأنَّ الوقتَ الذي ستُقاسُ به
// مُهلتُه غيرُ مُبرهَنٍ، ثمّ يُقبَلُ بعينِه حينَ يحضرُ البُرهانُ.
//
// ولماذا ساعةٌ اصطناعيّةٌ لا `AttestedClock`: المقيسُ هنا **قرارُ البوّابةِ** أمامَ
// عقدِ `attestation()` وحدَه — حضوراً وعدماً وسقوطاً بالعمرِ. والمسارُ الحقيقيُّ
// على سلكِ UDP مقيسٌ في `tests/time/attested-clock.test.mjs`، فلا يُقاسُ مرّتينِ
// ولا يُترَكُ واحدٌ منهما بلا قياسٍ.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CertificateAuthority,
  ClockError,
  CrownGateway,
  EventLog,
  KingIdentity,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';

/** @param {() => unknown} action @returns {Error} */
function capture(action) {
  try {
    action();
  } catch (error) {
    return /** @type {Error} */ (error);
  }
  throw new Error('كان يجب أن يفشل ولم يفشل');
}

/**
 * ساعةٌ موثوقةٌ تُعلِنُ بُرهاناً يُبدَّلُ حضورُه في الاختبارِ.
 *
 * @param {{ present?: boolean }} [state]
 */
function attestingClock(state = {}) {
  const shared = { present: state.present ?? true };
  return {
    shared,
    clock: {
      now: () => Date.now(),
      assertTrusted: () => {},
      attestation: () =>
        shared.present
          ? {
              atMs: Date.now(),
              radiusMs: 1000,
              ageMs: 25,
              sources: ['witness-a', 'witness-b'],
              localSkewMs: 3,
            }
          : null,
    },
  };
}

/** ساعةٌ موثوقةٌ **لا تُعلِنُ** بُرهاناً — عقدُ ما قبلَ `D-7`. */
function plainClock() {
  return { now: () => Date.now(), assertTrusted: () => {} };
}

/** @param {Record<string, unknown>} options */
function crown(options) {
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const log = new EventLog();
  return { king, ca, log, gateway: new CrownGateway(king, ca, log, options) };
}

test('ساعةٌ لا تُعلِنُ بُرهاناً تُرفَضُ عندَ البناءِ لا عندَ أوّلِ أمرٍ', () => {
  const error = capture(() => crown({ requireAttestedTime: true, clock: plainClock() }));
  assert.ok(error instanceof ClockError);
  assert.equal(/** @type {ClockError} */ (error).code, 'ATTESTED_TIME_REQUIRED');
  // ولا ساعةَ أصلاً: العقدُ نفسُه غائبٌ، فالرفضُ واحدٌ لا رمزانِ.
  assert.equal(
    /** @type {ClockError} */ (capture(() => crown({ requireAttestedTime: true }))).code,
    'ATTESTED_TIME_REQUIRED',
  );
});

test('أمرٌ ملكيٌّ صحيحُ التوقيعِ يُرفَضُ حينَ يغيبُ البُرهانُ ويُقبَلُ بعينِه حينَ يحضرُ', () => {
  const { shared, clock } = attestingClock({ present: false });
  const { king, gateway } = crown({ requireAttestedTime: true, clock });
  const command = createRoyalCommand('inspect', 'agent:one');
  const signature = king.sign(command);

  const error = capture(() => gateway.command(command, signature));
  assert.equal(/** @type {ClockError} */ (error).code, 'ATTESTED_TIME_REQUIRED');

  // ورفضُ الوقتِ لا يُحرِقُ معرِّفَ الأمرِ: الأمرُ **بعينِه** يُقبَلُ بعدَ
  // البُرهانِ. ولو استُهلِكَ المعرِّفُ قبلَ الفحصِ لصارَ انقطاعُ مصادرِ الوقتِ
  // إتلافاً دائماً لأوامرَ صحيحةٍ.
  shared.present = true;
  assert.equal(gateway.command(command, signature).id, command.id);
});

test('بُرهانٌ فاتَ عمرُه يُقرأُ عدماً فتُرفَضُ الأوامرُ بعدَه', () => {
  const { shared, clock } = attestingClock();
  const { king, gateway } = crown({ requireAttestedTime: true, clock });
  const first = createRoyalCommand('inspect', 'agent:one');
  assert.equal(gateway.command(first, king.sign(first)).id, first.id);
  shared.present = false;
  const next = createRoyalCommand('inspect', 'agent:two');
  assert.equal(
    /** @type {ClockError} */ (capture(() => gateway.command(next, king.sign(next)))).code,
    'ATTESTED_TIME_REQUIRED',
  );
});

test('في الإنتاجِ الإلزامُ لا يُطفأُ بخيارٍ: `requireAttestedTime:false` يُرفَضُ باسمِه', () => {
  const error = capture(() =>
    crown({
      requireAttestedTime: false,
      env: { NODE_ENV: 'production', STATE_ENV: 'production' },
    }),
  );
  assert.match(
    error.message,
    /CROWN_GUARANTEE_CANNOT_BE_DISABLED_IN_PRODUCTION:requireAttestedTime/,
  );
});

test('خارجَ الإنتاجِ الإلزامُ مُطفأٌ افتراضاً فلا يكسرُ تركيباً قائماً', () => {
  const { king, gateway } = crown({});
  assert.equal(gateway.requireAttestedTime, false);
  const command = createRoyalCommand('inspect', 'agent:one');
  assert.equal(gateway.command(command, king.sign(command)).id, command.id);
});
