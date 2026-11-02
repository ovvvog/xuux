// @ts-nocheck
// tests/sim/wb-helper-protocol.test.mjs
//
// WL-511 — مِحكُّ عقدِ بروتوكولِ مساعدِ W-B على بيئةِ المحاكاةِ (sim/tpm-host/wb_helper_protocol.mjs).
//
// **ما يُقاسُ هنا (تكليفُ WL-511): بصمةُ المساعدِ والفشلُ المغلقُ وسلامةُ مدخلاتِ
// ومخرجاتِ البروتوكول — على مساعدٍ زائفٍ في CI، قبلَ أيِّ بناءٍ على Windows.**
//
// الحدودُ المعلنةُ: لا شيءَ هنا يُثبتُ سلوكَ TBS أو مساعدًا حقيقيًّا — البصمةُ
// هنا لملفِ node نفسِه والمساعدُ زائفٌ؛ قياسُ العقدِ لا قياسُ العتاد.
//
//   1) static: الوحدةُ طبقةُ نقلٍ فقط — لا TPM ولا TBS ولا Windows ولا شبكة.
//   2) happy path: طلبٌ واحدٌ وردٌّ واحدٌ ونداءٌ يعادُ حرفيًا والبصمةُ مطابقة.
//   3) البصمةُ قبلَ التشغيل: غيرُ مثبَّتةٍ ⇒ UNPINNED، وملفٌّ تبدَّلت بايتاتُه ⇒ MISMATCH.
//   4) سلامةُ المدخلات: op بمحارفِ تحكّمٍ أو طويلٌ، وargs غيرُ مصفوفةٍ أو زائدةٌ أو ضخمة ⇒ رفضٌ قبلَ التشغيل.
//   5) الفشلُ المغلقُ سلوكًا (كلُّ وضعٍ فاسدٍ من المساعدِ الزائفِ برمزِه المسمّى):
//      garbage/badcrc ⇒ BAD_FRAME · extra ⇒ EXTRA_OUTPUT · exit1 ⇒ EXIT_1 · stderr ⇒ STDERR ·
//      silent/late ⇒ TIMEOUT (يُقتَل) · wrongnonce ⇒ NONCE_MISMATCH · okfalse ⇒ رمزُ المساعد.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runWbHelper,
  WbHelperError,
  assertValidRequest,
  sha256File,
  WB_HELPER_DEFAULT_TIMEOUT_MS,
} from '../../sim/tpm-host/wb_helper_protocol.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const protoPath = join(root, 'sim/tpm-host/wb_helper_protocol.mjs');
const fixture = join(root, 'tests/sim/fixtures/wb_fake_helper.mjs');
const nodeBin = process.execPath;
const pinned = sha256File(nodeBin);
const stripHash = (s) => s.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');

const call = (mode, over = {}) =>
  runWbHelper({
    helperPath: nodeBin,
    fingerprintSha256: pinned,
    op: 'inventory.getCapability',
    args: ['TPM_PT_MANUFACTURER_ID'],
    spawnArgs: mode ? [fixture, mode] : [fixture],
    timeoutMs: 4000,
    ...over,
  });

const expectCode = async (code, fn) => {
  await assert.rejects(fn, (e) => e instanceof WbHelperError && e.code === code);
};

test('static: الوحدةُ طبقةُ نقلٍ فقط — لا TPM ولا TBS ولا Windows ولا شبكة', () => {
  const src = stripHash(readFileSync(protoPath, 'utf8'));
  for (const re of [
    /Tbsi_/i,
    /tbs\.dll/i,
    /powershell/i,
    /wsl\.exe/i,
    /\/dev\/tpm/i,
    /tpm2_/,
    /net\.connect|createServer|dgram/i,
  ]) {
    assert.doesNotMatch(src, re, `forbidden token ${re}`);
  }
  // التأطيرُ المشتركُ معَ قناةِ TPM: إعادةُ استعمالٍ لا تصديعٌ جديد.
  assert.match(src, /from '\.\.\/tpm\/channel_protocol\.mjs'/);
});

test('happy path: طلبٌ واحدٌ وردٌّ واحدٌ — النداءُ يعادُ والناتجُ يصلُ والبصمةُ مطابقة', async () => {
  const result = await call(null);
  assert.deepEqual(result, { echo: 'inventory.getCapability', args: ['TPM_PT_MANUFACTURER_ID'] });
  // المهلةُ الافتراضيّةُ محدودةٌ ومعلَنةٌ (ميزانيّةُ انتظارٍ لا انتظارٌ مفتوح).
  assert.equal(typeof WB_HELPER_DEFAULT_TIMEOUT_MS, 'number');
  assert.ok(WB_HELPER_DEFAULT_TIMEOUT_MS > 0 && WB_HELPER_DEFAULT_TIMEOUT_MS <= 10_000);
});

test('البصمةُ قبلَ التشغيل: بلا مثبَّتٍ ⇒ WB_HELPER_FINGERPRINT_UNPINNED', async () => {
  await expectCode('WB_HELPER_FINGERPRINT_UNPINNED', () =>
    call(null, { fingerprintSha256: 'not-a-sha256' }),
  );
  await expectCode('WB_HELPER_FINGERPRINT_UNPINNED', () => call(null, { fingerprintSha256: undefined }));
});

test('البصمةُ قبلَ التشغيل: ملفٌّ لا يطابقُ المثبَّت ⇒ WB_HELPER_FINGERPRINT_MISMATCH', async () => {
  const wrongPin = createHash('sha256').update('other bytes').digest('hex');
  await expectCode('WB_HELPER_FINGERPRINT_MISMATCH', () => call(null, { fingerprintSha256: wrongPin }));
  await expectCode('WB_HELPER_FINGERPRINT_MISMATCH', () =>
    call(null, { helperPath: join(root, 'no-such-binary'), fingerprintSha256: pinned }),
  );
});

test('سلامةُ المدخلات: كلُّ مدخلٍ فاسدٍ يُرفَضُ قبلَ تشغيلِ المساعدِ برمزِه', async () => {
  await expectCode('WB_HELPER_REQUEST_OP_INVALID', () => call(null, { op: 'op\u0000with-control-chars' }));
  await expectCode('WB_HELPER_REQUEST_OP_INVALID', () => call(null, { op: 'x'.repeat(200) }));
  await expectCode('WB_HELPER_REQUEST_OP_INVALID', () => call(null, { op: '' }));
  await expectCode('WB_HELPER_REQUEST_ARGS_INVALID', () => call(null, { args: 'not-an-array' }));
  await expectCode('WB_HELPER_REQUEST_ARGS_INVALID', () => call(null, { args: Array.from({ length: 32 }, (_, i) => i) }));
  await expectCode('WB_HELPER_REQUEST_ARGS_INVALID', () =>
    call(null, { args: ['x'.repeat(8192)] }),
  );
  // assertValidRequest يُصدَّرُ ويُقاسُ مباشرةً: لا كودَ يمرُّ بمدخلٍ فاسدٍ إلى التشغيل.
  assert.throws(() => assertValidRequest(undefined, []), /WB_HELPER_REQUEST_OP_INVALID/);
});

test('الفشلُ المغلقُ سلوكًا: إطارٌ تالفٌ أو زائدٌ أو خروجٌ فاسدٌ أو ضجيجٌ — برموزِها', async () => {
  await expectCode('WB_HELPER_BAD_FRAME', () => call('garbage'));
  await expectCode('WB_HELPER_BAD_FRAME', () => call('badcrc'));
  await expectCode('WB_HELPER_EXTRA_OUTPUT', () => call('extra'));
  await expectCode('WB_HELPER_EXIT_1', () => call('exit1'));
  await expectCode('WB_HELPER_STDERR', () => call('stderr'));
});

test('الفشلُ المغلقُ سلوكًا: لا ردَّ أبدًا أو ردٌّ متأخّرٌ ⇒ TIMEOUT ويُقتَلُ المساعدُ', async () => {
  await expectCode('WB_HELPER_TIMEOUT', () => call('silent', { timeoutMs: 300 }));
  await expectCode('WB_HELPER_TIMEOUT', () => call('late', { timeoutMs: 300 }));
});

test('النداءُ يربطُ الردَّ بالطلبِ: عدمُ مطابقتِه أو إبلاغُ فشلٍ ⇒ رمزُه المسمّى', async () => {
  await expectCode('WB_HELPER_NONCE_MISMATCH', () => call('wrongnonce'));
  await expectCode('WB_HELPER_REPORTED_FAILURE', () => call('okfalse'));
});

test('البروتوكولُ يرفضُ الطلباتِ الكبيرةَ حتى معَ مساعدٍ سليمٍ (حدُّ الحمولةِ المشتركِ)', async () => {
  await assert.rejects(
    () => call(null, { op: 'inventory.getCapability', args: [ 'x'.repeat(70_000) ] }),
    (e) => e instanceof WbHelperError && /WB_HELPER_REQUEST_ARGS_INVALID/.test(e.code),
  );
});
