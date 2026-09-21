// اختباراتُ منفذِ الإخفاقِ الذاتيِّ المرجعيِّ — LIVE-16.
//
// **ما تُثبِتُه:** أنَّ مقياسَ خطِّ أساسِ التخطّي يُميِّزُ الإخفاقَ الذاتيَّ
// المرجعيَّ (R6/STALE من guard-skip-baseline) عن الأجنبيِّ، فيَسمَحُ بتحديثِ
// الأثرِ على تشغيلةٍ إخفاقُها الوحيدُ هو تقادُمُ الأثرِ نفسِهِ — لا بإلغاءِ
// شرطِ «لا خطَّ أساسٍ من تشغيلةٍ فاشلةٍ»، بل بتمييزِ إخفاقٍ بعينِهِ.
// وتشغيلةٌ فيها إخفاقٌ آخرُ ما زالت مردودةً.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailures, allowSelfStaleOnly } from '../../scripts/measure-skip-baseline.mjs';

const SELF_STALE_TAP = [
  'TAP version 13',
  '# Subtest: tests/external-review/skip-baseline.test.mjs',
  '    TAP version 13',
  '    # Subtest: الحاجزُ عمليّةً منفصلةً: يَخرُجُ بـ0 على المستودعِ وبـ1 على شجرةٍ مُطفَّرةٍ',
  '        1..1',
  '        not ok 1 - assertion failed',
  '          ---',
  '          error: "Command failed: node scripts/guard-skip-baseline.mjs\\n' +
    '            ⛔ حاجزُ خطِّ أساسِ التخطّي: عددٌ مُعلَنٌ غيرُ مقيسٍ.\\n' +
    '               - R6/STALE: المُدخلةُ 0 قِيسَت على 218 ملفَّ اختبارٍ والشجرةُ الحاليّةُ فيها 219"',
  '          ---',
  '    1..1',
  '    # tests 1',
  '    # pass 0',
  '    # fail 1',
  'not ok 1 - tests/external-review/skip-baseline.test.mjs',
  '  ---',
  '  tests: 1',
  '  pass: 0',
  '  fail: 1',
  '  ---',
  '1..1',
  '# tests 1',
  '# pass 0',
  '# fail 1',
  '# skipped 0',
].join('\n');

const MIXED_FAIL_TAP = [
  'TAP version 13',
  '# Subtest: tests/external-review/skip-baseline.test.mjs',
  '    TAP version 13',
  '    # Subtest: الحاجزُ عمليّةً منفصلةٌ',
  '        1..1',
  '        not ok 1 - assertion failed',
  '          ---',
  '          error: "R6/STALE: guard-skip-baseline ..."',
  '          ---',
  '    1..1',
  '    # tests 1',
  '    # pass 0',
  '    # fail 1',
  'not ok 1 - tests/external-review/skip-baseline.test.mjs',
  '  ---',
  '  tests: 1',
  '  pass: 0',
  '  fail: 1',
  '  ---',
  '# Subtest: tests/other/other.test.mjs',
  '    TAP version 13',
  '    # Subtest: شيءٌ آخرُ',
  '        1..1',
  '        not ok 1 - assertion failed',
  '          ---',
  '          error: "expected 5 to equal 6"',
  '          ---',
  '    1..1',
  '    # tests 1',
  '    # pass 0',
  '    # fail 1',
  'not ok 2 - tests/other/other.test.mjs',
  '  ---',
  '  tests: 1',
  '  pass: 0',
  '  fail: 1',
  '  ---',
  '1..2',
  '# tests 2',
  '# pass 0',
  '# fail 2',
  '# skipped 0',
].join('\n');

test('LIVE-16: إخفاقٌ ذاتيٌّ مرجعيٌّ واحدٌ ⇒ مصنَّفٌ ذاتيّاً', () => {
  const cls = classifyFailures(SELF_STALE_TAP);
  assert.equal(cls.total, 1, `تُوقِّعَ كتلةٌ واحدةٌ، والذي وَجدَ: ${cls.total}`);
  assert.equal(cls.selfStale, 1, 'الإخفاقُ الذاتيُّ المرجعيُّ ينبغي أن يُصنَّفَ ذاتيّاً');
  assert.equal(cls.other, 0, 'لا ينبغي أن يكونَ إخفاقٌ أجنبيٌّ');
});

test('LIVE-16: إخفاقٌ ذاتيٌّ + إخفاقٌ أجنبيٌّ ⇒ مصنَّفانِ، الأجنبيُّ يَمنَعُ', () => {
  const cls = classifyFailures(MIXED_FAIL_TAP);
  assert.equal(cls.total, 2, `تُوقِّعَ كتلتانِ، والذي وَجدَ: ${cls.total}`);
  assert.equal(cls.selfStale, 1, 'كتلةٌ واحدةٌ ذاتيّةٌ');
  assert.equal(cls.other, 1, 'كتلةٌ واحدةٌ أجنبيّةٌ — تَمنَعُ تحديثَ الأثرِ');
});

test('LIVE-16: TAP بلا إخفاقٍ ⇒ صفرُ كتلٍ وصفرُ ذاتيٍّ', () => {
  const okTap = [
    'TAP version 13',
    'ok 1 - ناجحٌ',
    '1..1',
    '# tests 1',
    '# pass 1',
    '# fail 0',
  ].join('\n');
  const cls = classifyFailures(okTap);
  assert.equal(cls.total, 0);
  assert.equal(cls.selfStale, 0);
  assert.equal(cls.other, 0);
});

test('LIVE-16: فشلٌ بلا كتلةِ not ok ⇒ مصنَّفٌ صفرٌ (فشلٌ بلا تحليلٍ)', () => {
  const weirdTap = ['TAP version 13', '1..0', '# tests 0', '# pass 0', '# fail 1'].join('\n');
  const cls = classifyFailures(weirdTap);
  assert.equal(cls.total, 0, 'لا كتلَ إخفاقٍ قابلةٍ للتحليلِ');
  assert.equal(cls.selfStale, 0);
  assert.equal(cls.other, 0);
});

// ── اختباراتُ دالة القرارِ allowSelfStaleOnly ──

test('LIVE-16: قرارٌ — تشغيلةٌ ذاتيّةٌ واحدةٌ ⇒ مسموحٌ', () => {
  const d = allowSelfStaleOnly(SELF_STALE_TAP, 1);
  assert.equal(d.allowed, true, `ينبغي السماحُ: ${d.reason}`);
  assert.match(d.reason, /LIVE-16/);
});

test('LIVE-16: قرارٌ — ذاتيٌّ + أجنبيٌّ ⇒ مردودٌ', () => {
  const d = allowSelfStaleOnly(MIXED_FAIL_TAP, 2);
  assert.equal(d.allowed, false, 'ينبغي الرفضُ لوجودِ إخفاقٍ أجنبيٍّ');
  assert.match(d.reason, /أجنبيّاً/);
});

test('LIVE-16: قرارٌ — تشغيلةٌ ناجحةٌ (fail=0) ⇒ غيرُ مسموحٍ (لا حاجةَ)', () => {
  const okTap = [
    'TAP version 13',
    'ok 1 - ناجحٌ',
    '1..1',
    '# tests 1',
    '# pass 1',
    '# fail 0',
  ].join('\n');
  const d = allowSelfStaleOnly(okTap, 0);
  assert.equal(d.allowed, false, 'التشغيلةُ الناجحةُ لا تَحتاجُ المنفذَ');
});

test('LIVE-16: طفرةٌ — fail=2 مع كتلةٍ ذاتيّةٍ واحدةٍ ⇒ مردودٌ (تباينٌ)', () => {
  // TAP يقولُ # fail 2 لكنّ هناك كتلةَ not ok واحدةً فقط — تباينٌ يَمنَعُ.
  const mismatchTap = SELF_STALE_TAP.replace('# fail 1\n# skipped 0', '# fail 2\n# skipped 0');
  const d = allowSelfStaleOnly(mismatchTap, 2);
  assert.equal(d.allowed, false, 'التباينُ بينَ عددِ الإخفاقاتِ وكتلِها يَمنَعُ التحديثَ');
  assert.match(d.reason, /تباي/);
});

test('LIVE-16: طفرةٌ — fail=1 بلا كتلٍ ⇒ مردودٌ (فشلٌ بلا تحليلٍ)', () => {
  const emptyTap = ['TAP version 13', '1..0', '# tests 0', '# pass 0', '# fail 1'].join('\n');
  const d = allowSelfStaleOnly(emptyTap, 1);
  assert.equal(d.allowed, false, 'فشلٌ بلا كتلٍ يَنبغي أن يُرَدَّ');
  assert.match(d.reason, /لا كتلة/);
});
