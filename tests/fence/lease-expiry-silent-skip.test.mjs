/**
 * انقضاءُ الإيجار (‏`WL-608 LIVE-75`) — جزءُ `LIVE-75/RLS-SILENT-SKIP` (‏الهجرة 0037). تُتخطّى بلا `DATABASE_URL`.
 *
 * ‏`WL-623`: الكتلةُ نفسُها في `tests/helpers/lease-expiry-suite.mjs` (‏منقولةٌ حرفيّاً من `tests/fence/effects.test.mjs` لمهلةِ
 * الملفّ)؛ هذا الملفُّ يُسجِّلُ جزءَ `silent-skip` وحدَه، و`tests/fence/lease-expiry.test.mjs` يُسجِّلُ الباقي.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { defineLeaseExpirySuite } from '../helpers/lease-expiry-suite.mjs';

const registered = defineLeaseExpirySuite('silent-skip');

test('WL-623: جزءُ «silent-skip» من كتلةِ انقضاءِ الإيجارِ غيرُ فارغ (‏التقسيمُ لا يُسقِطُ اختبارات)', () => {
  assert.ok(registered.length > 0, 'لا اختبارَ مسجَّلاً');
});
