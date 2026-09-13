// R6-A-05 — الجزءُ الثاني: ثباتُ حالةِ الوضعِ الآمنِ للنواةِ عبرَ إعادةِ التشغيل.
//
// العيب: `SafeMode` في `execution-kernel.mjs` كان حالتُه في الذاكرةِ وحدَها.
// لو دخلَ النظامُ في الوضعِ الآمن ثمّ أُعيدَ تشغيلُه، فُقدَت الحالةُ وعادَ
// النظامُ إلى التشغيلِ بلا حماية.
//
// الإصلاح: `snapshot()` و`restore()` يُلتقطُ بهما حالةُ الوضعِ الآمن ويُعادُ
// بناؤها بعدَ إعادةِ التشغيل، كنمطِ `QuarantineWarden` نفسِه.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SafeMode } from '../../src/core/execution-kernel.mjs';

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
  assert.equal(sm.restore(null), false, 'null مرفوض');
  assert.equal(sm.restore('string'), false, 'string مرفوض');
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
