// @ts-nocheck
// R6-A-08 (جولتا 7 و8) — إثباتُ إغلاقِ مسارَي الالتفافِ على الوضعِ الآمنِ.
//
// **المعيار الأول:** الوضعُ الآمنُ خاصٌّ — لا يُدخَلُ ولا يُخرَجُ منه من خارجِ
// النواةِ. كانَ الحقلُ `safeMode` عامًّا فمكّنَ مناداةَ `kernel.safeMode.enter()`
// مباشرةً فتتجاوزُ فحصَ الإنتاجِ في `stop`/`resume`.
//
// **المعيار الثاني:** إنتاجيةُ النواةِ لا تنزلُ بحقنِ بيئةٍ — عمليةٌ إنتاجيةٌ
// حقيقيةٌ تبني النواةَ بـ`env: {}` لا تُخفي إنتاجيّتَها: البيئةُ الحقيقيةُ تُقرأُ
// معَ المُمرَّرةِ وترفعُ إلى الإنتاجِ ولا تخفضُه.
//
// **وحدودُ الاختبارِ باقية:** حقنُ بيئةٍ إنتاجيةٍ في عمليةٍ غيرِ إنتاجيةٍ يبقى
// يحاكي الإنتاجَ كما في اختباراتِ `WL-302` — فالرفعُ إلى الإنتاجِ مقبولٌ دائمًا
// والخفضُ مستحيلٌ.
//
// **الحدُّ المعلَن:** هذا إثباتُ إنفاذٍ لا إثباتُ إغلاقٍ. صلاحيّةُ الإغلاقِ للمجلس.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { ExecutionKernel, SafeMode } from '../../src/core/execution-kernel.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';

function buildKernel(env) {
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
  return { kernel: new ExecutionKernel({ crown, log, ...(env ? { env } : {}) }), log, crown };
}

const PROD_ENV = { STATE_ENV: 'production' };

test('R6-A-08: الوضعُ الآمنُ خاصٌّ — لا سبيلَ إلى دخولِه من خارجِ النواةِ', () => {
  const { kernel } = buildKernel(PROD_ENV);
  assert.equal(kernel.safeMode, undefined, 'الحقلُ العامُّ بقي — مسارُ الالتفافِ مفتوحٌ');
  assert.equal('safeMode' in kernel, false, 'الخاصيةُ الظاهرةُ بقيَت على النواة');
  // غيابُ الحقلِ نفسُه هو الإغلاقُ: من لا يملكُ الحقلَ لا يملكُ `enter`/`leave`.
  assert.throws(() => kernel.safeMode.enter('bypass'), TypeError);
});

test('R6-A-08: دخولُ الوضعِ الآمنِ في الإنتاجِ لا يمرُّ إلا بأمرٍ ملكيّ', () => {
  const { kernel } = buildKernel(PROD_ENV);
  assert.equal(kernel.production, true, 'حقنُ بيئةٍ إنتاجيةٍ لم يعدْ يُنتِجُ نواةً إنتاجية');
  assert.throws(() => kernel.stop('free path'), /^Error: KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND$/);
});

test('R6-A-08: عمليةٌ إنتاجيةٌ حقيقيةٌ لا تُخفي إنتاجيّتَها بحقنِ env فارغة', () => {
  const previous = process.env.STATE_ENV;
  process.env.STATE_ENV = 'production';
  try {
    const { kernel } = buildKernel({});
    assert.equal(
      kernel.production,
      true,
      'البيئةُ الحقيقيةُ الإنتاجيةُ لم تُقرأ — الالتفافُ بـenv:{} مفتوحٌ',
    );
    assert.throws(
      () => kernel.stop('free path'),
      /^Error: KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND$/,
      'الإيقافُ الحرُّ مرَّ في نواةٍ إنتاجيةٍ حقيقيةٍ',
    );
  } finally {
    if (previous === undefined) delete process.env.STATE_ENV;
    else process.env.STATE_ENV = previous;
  }
});

test('R6-A-08: إنتاجيةُ النواةِ للقراءةِ لا للكتابةِ — خفضُها من الخارجِ مرفوضٌ', () => {
  const { kernel } = buildKernel(PROD_ENV);
  assert.equal(kernel.production, true);
  // الكتابةُ على getter بلا setterٍ رميٌ في النمطِ الصارمِ — وهذا هو الإغلاقُ:
  // `kernel.production = false` لم يعدْ مسارًا إلى الإيقافِ الحرِّ.
  assert.throws(() => {
    kernel.production = false;
  }, TypeError);
  assert.equal(kernel.production, true, 'الكتابةُ غيّرتِ الإنتاجيةَ رغمَ رفضِها');
  assert.throws(() => kernel.stop('bypass'), /^Error: KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND$/);
  assert.throws(() => kernel.resume(), /^Error: KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND$/);
});

test('R6-A-08: غيرُ الإنتاجِ يبقى حرَّ الدخولِ والخروجِ — الحقنُ لا يوسّعُ الإنتاج', () => {
  const { kernel } = buildKernel({});
  assert.equal(kernel.production, false);
  kernel.stop('test path');
  kernel.resume();
});

test('R6-A-08: حقنُ بيئةٍ إنتاجيةٍ في عمليةٍ غيرِ إنتاجيةٍ يبقى يحاكي الإنتاجَ (حدودُ WL-302)', () => {
  // بلا مسِّ لبيئةِ العمليةِ نفسِها: الادعاءُ هو أنّ الحقنَ وحدهُ يرفعُ إلى
  // الإنتاجِ في عمليةٍ غيرِ إنتاجيةٍ، وقدرةُ الاختبارِ على المحاكاةِ باقية.
  const { kernel } = buildKernel({ STATE_ENV: 'production' });
  assert.equal(kernel.production, true, 'قدرةُ الاختبارِ على محاكاةِ الإنتاجِ انكسرت');
  assert.throws(() => kernel.stop('free path'), /^Error: KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND$/);
});

/**
 * R6-A-08: الوضعُ الآمنُ المحلّيُّ للنواةِ يُدخَلُ ويُخرَجُ منه بنداءِ دالّةٍ بلا
 * فاعلٍ ولا أمرٍ. صارَ الفاعلُ يُمرَّرُ اختياريّاً، والمنادي مسؤولٌ عن تمريرِه.
 */
describe('R6-A-08: kernel safe-mode stop/resume accept actor identity', () => {
  function buildKernel() {
    const log = new EventLog();
    const crown = /** @type {any} */ ({
      stopped: false,
      stop() {
        this.stopped = true;
      },
      resume() {
        this.stopped = false;
      },
      command: async () => ({ ok: true }),
    });
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

// R6-A-05 — الجزءُ الثاني: ثباتُ حالةِ الوضعِ الآمنِ للنواةِ عبرَ إعادةِ التشغيل.
//
// العيب: `SafeMode` في `execution-kernel.mjs` كان حالتُه في الذاكرةِ وحدَها.
// لو دخلَ النظامُ في الوضعِ الآمن ثمّ أُعيدَ تشغيلُه، فُقدَت الحالةُ وعادَ
// النظامُ إلى التشغيلِ بلا حماية.
//
// الإصلاح: `snapshot()` و`restore()` يُلتقطُ بهما حالةُ الوضعِ الآمن ويُعادُ
// بناؤها بعدَ إعادةِ التشغيل، كنمطِ `QuarantineWarden` نفسِه.

test('SafeMode.snapshot يلتقط الحالة النشطة', () => {
  const sm = new SafeMode();
  sm.enter('kernel panic');
  const snap = sm.snapshot();
  assert.equal(snap.active, true, 'نشط في اللقطة');
  assert.equal(snap.reason, 'kernel panic', 'السبب في اللقطة');
});

test('SafeMode.snapshot يلتقط الحالة غير النشطة', () => {
  const sm = new SafeMode();
  const snap = sm.snapshot();
  assert.equal(snap.active, false, 'غير نشط في اللقطة');
  assert.equal(snap.reason, null, 'لا سبب في اللقطة');
});

test('SafeMode.restore يعيد بناء الحالة النشطة بعد إعادة التشغيل', () => {
  // العمليةُ الأولى: ندخلُ الوضعَ الآمن.
  const sm1 = new SafeMode();
  sm1.enter('emergency halt');
  const snap = sm1.snapshot();
  assert.equal(sm1.active, true, 'نشط قبل التوقف');

  // «إعادةُ التشغيل»: نواةٌ جديدةٌ بلا ذاكرةٍ مشتركة.
  const sm2 = new SafeMode();
  assert.equal(sm2.active, false, 'غير نشط قبل الاستعادة');
  const ok = sm2.restore(snap);
  assert.equal(ok, true, 'الاستعادة نجحت');
  assert.equal(sm2.active, true, 'نشط بعد الاستعادة');
  assert.equal(sm2.reason, 'emergency halt', 'السبب بعد الاستعادة');
  assert.throws(() => sm2.assertOperational(), /SAFE_MODE/, 'يرفض التنفيذ');
});

test('SafeMode.restore يعيد بناء الحالة غير النشطة', () => {
  const sm1 = new SafeMode();
  const snap = sm1.snapshot();
  const sm2 = new SafeMode();
  sm2.enter('temporary');
  sm2.restore(snap);
  assert.equal(sm2.active, false, 'غير نشط بعد الاستعادة');
  assert.equal(sm2.reason, null, 'لا سبب بعد الاستعادة');
});

test('SafeMode.restore يرفض اللقطة الفاسدة', () => {
  const sm = new SafeMode();
  assert.equal(sm.restore(/** @type {any} */ (null)), false, 'null مرفوض');
  assert.equal(sm.restore(/** @type {any} */ ('string')), false, 'string مرفوض');
  // كائنٌ فارغ: الاستعادةُ ناجحةٌ لكنّها لا تُغيّر الحالة.
  assert.equal(sm.restore({}), true, 'كائن فارغ: ناجح بلا تغيير');
  assert.equal(sm.active, false, 'بقي غير نشط');
});

test('SafeMode.restore يتعامل مع الحقول الناقصة بأمان', () => {
  const sm1 = new SafeMode();
  sm1.enter('test');
  // لقطةٌ ناقصةُ الحقول.
  const partial = { active: true };
  const sm2 = new SafeMode();
  sm2.restore(partial);
  assert.equal(sm2.active, true, 'استعاد active فقط');
  assert.equal(sm2.reason, null, 'reason لم يكن في اللقطة');
});

test('SafeMode: دورة كاملة — enter → snapshot → restore → leave', () => {
  const sm1 = new SafeMode();
  sm1.enter('planned maintenance');
  const snap = sm1.snapshot();

  // إعادةُ تشغيل.
  const sm2 = new SafeMode();
  sm2.restore(snap);
  assert.equal(sm2.active, true, 'الوضع الآمن مستعاد');
  assert.throws(() => sm2.assertOperational(), /SAFE_MODE/, 'يرفض التنفيذ');

  // الاستئناف.
  sm2.leave();
  assert.equal(sm2.active, false, 'غادر الوضع الآمن');
  sm2.assertOperational(); // لا يرمي
});

test('SafeMode.snapshot بعد leave يلتقط الحالة غير النشطة', () => {
  const sm = new SafeMode();
  sm.enter('test');
  sm.leave();
  const snap = sm.snapshot();
  assert.equal(snap.active, false, 'غير نشط بعد leave');
  assert.equal(snap.reason, null, 'لا سبب بعد leave');
});
