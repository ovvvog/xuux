/**
 * انقضاءُ الإيجار (‏`WL-608 LIVE-75`) — جزءُ `LIVE-75/RLS-SILENT-SKIP` (‏الهجرة 0037). تُتخطّى بلا `DATABASE_URL`.
 *
 * ‏`WL-623`: الكتلةُ نفسُها في `tests/helpers/lease-expiry-suite.mjs` (‏منقولةٌ حرفيّاً من `tests/fence/effects.test.mjs` لمهلةِ
 * الملفّ)؛ هذا الملفُّ يُسجِّلُ جزءَ `silent-skip` وحدَه، و`tests/fence/lease-expiry.test.mjs` يُسجِّلُ الباقي.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { defineLeaseExpirySuite } from '../helpers/lease-expiry-suite.mjs';
import { skipWithoutDatabase } from '../helpers/pg.mjs';

const registered = defineLeaseExpirySuite('silent-skip');

// ‏`WL-629`: بلا قاعدةٍ لا تُنفَّذُ الكتلةُ المتخطّاةُ فلا تُسجِّلُ شيئاً — فالحارسُ يُتخطّى معها بالسببِ نفسِه (‏لا رسوبَ زائف)،
// ‏ومعَ القاعدةِ (‏CI) كما كان.
test(
  'WL-623: جزءُ «silent-skip» من كتلةِ انقضاءِ الإيجارِ غيرُ فارغ (‏التقسيمُ لا يُسقِطُ اختبارات)',
  { skip: skipWithoutDatabase },
  () => {
    assert.ok(registered.length > 0, 'لا اختبارَ مسجَّلاً');
  },
);
