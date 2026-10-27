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
import test from 'node:test';

import { ExecutionKernel } from '../../src/core/execution-kernel.mjs';
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
