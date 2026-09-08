// @ts-nocheck
// tests/root-of-trust/pkcs11-keygen-selective-rotation.test.mjs
//
// التحقق من التدوير الانتقائي (--only 06,07) وحماية F05 من التدمير العرضي.
// لا يتطلّب HSM — يختبر الدوال النقية فقط.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseOnly, selectSpecs, f05Protected } = await import('../../scripts/pkcs11-keygen.mjs');

const F05 = { id: '05', label: 'event-log-aead-key', kind: 'aes' };
const F06 = { id: '06', label: 'king-signing-key', kind: 'ed25519' };
const F07 = { id: '07', label: 'command-ledger-signing-key', kind: 'ed25519' };
const SPECS = [F06, F05, F07];

test('parseOnly: يُرجع null عند غياب --only', () => {
  assert.equal(parseOnly(['node', 'keygen']), null);
});

test('parseOnly: يُرجع مجموعة المعرّفات المفصولة بفواصل', () => {
  assert.deepEqual([...parseOnly(['node', 'keygen', '--only', '06,07'])].sort(), ['06', '07']);
});

test('parseOnly: يُطبّع المعرّف من رقم واحد إلى صيغة 06', () => {
  assert.ok(parseOnly(['node', 'keygen', '--only', '6,7']).has('06'));
  assert.ok(parseOnly(['node', 'keygen', '--only', '6,7']).has('07'));
});

test('selectSpecs: --only 06,07 يستثني F05 (AES) تماماً', () => {
  const only = parseOnly(['node', 'keygen', '--only', '06,07']);
  const selected = selectSpecs(only, SPECS);
  const ids = selected.map((s) => s.id);
  assert.deepEqual(ids.sort(), ['06', '07']);
  assert.ok(!ids.includes('05'), 'F05 يجب ألا يُختار عند --only 06,07');
});

test('selectSpecs: بدون --only يُرجع كل المفاتيح (تشمل F05)', () => {
  const selected = selectSpecs(null, SPECS);
  assert.equal(selected.length, 3);
});

test('f05Protected: F05 محميّة عند --only 06,07', () => {
  const only = parseOnly(['node', 'keygen', '--only', '06,07']);
  assert.equal(f05Protected(F05, only), true, 'F05 يجب أن تكون محمية');
});

test('f05Protected: F05 غير محمية فقط عند ذكر 05 صراحةً', () => {
  const only = parseOnly(['node', 'keygen', '--only', '05,06,07']);
  assert.equal(f05Protected(F05, only), false);
});

test('f05Protected: F06/F07 لا تُحظَر بقيد F05', () => {
  const only = parseOnly(['node', 'keygen', '--only', '06,07']);
  assert.equal(f05Protected(F06, only), false);
  assert.equal(f05Protected(F07, only), false);
});

test('f05Protected: F05 محمية عند --replace شامل بلا --only', () => {
  // تدويرٌ شاملٌ دون تحديد --only يجب أن يحمي F05 أيضاً.
  assert.equal(f05Protected(F05, null), true);
});

test('static: keygen يحتوي حارس F05_PROTECTED وواقي تشغيل main', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../scripts/pkcs11-keygen.mjs', import.meta.url), 'utf8');
  assert.match(src, /F05_PROTECTED/, 'يجب وجود رمز خطأ F05_PROTECTED');
  assert.match(src, /import\.meta\.url/, 'يجب أن يحمي main من التشغيل عند الاستيراد');
  assert.match(src, /--only/, 'يجب دعم علم --only');
});
