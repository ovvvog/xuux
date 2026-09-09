// @ts-nocheck
// tests/sim/tpm-channel-protocol.test.mjs
//
// اختبارات بروتوكول قناة TCP (same-environment): تأطير، حد أقصى، انقطاع
// منتصف الرسالة، إعادة، تشويه، تحديد معدّل. منطق صرف (لا شبكة، لا TPM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frame, parseMessage, FrameFeed, ChannelServer, MAX_PAYLOAD, crc16,
} from '../../sim/tpm/channel_protocol.mjs';

test('framing: round-trip ناجح', () => {
  const payload = Buffer.from('hello-tpm');
  const f = frame(payload, 7);
  const m = parseMessage(f);
  assert.equal(m.ok, true);
  assert.equal(m.counter, 7);
  assert.equal(m.payload.toString(), 'hello-tpm');
});

test('framing: round-trip بـpayload فارغ', () => {
  const f = frame(Buffer.alloc(0), 1);
  const m = parseMessage(f);
  assert.equal(m.ok, true);
  assert.equal(m.payload.length, 0);
});

test('max-size: payload فوق الحد يُرفض عند التأطير', () => {
  assert.throws(() => frame(Buffer.alloc(MAX_PAYLOAD + 1), 1), /PAYLOAD_TOO_LARGE/);
});

test('max-size: len مُزوّر فوق الحد يُرفض عند التحليل', () => {
  const f = frame(Buffer.from('x'), 1);
  // زيّف len إلى قيمة ضخمة
  f.writeUInt32BE(MAX_PAYLOAD + 1, 10);
  const m = parseMessage(f);
  assert.equal(m.ok, false);
  assert.equal(m.error, 'PAYLOAD_TOO_LARGE');
});

test('malformed: magic خاطئ ⇒ رفض', () => {
  const f = frame(Buffer.from('x'), 1);
  f.writeUInt16BE(0x1234, 0);
  assert.equal(parseMessage(f).error, 'BAD_MAGIC');
});

test('malformed: crc تالفة ⇒ رفض', () => {
  const f = frame(Buffer.from('x'), 1);
  f[f.length - 1] ^= 0xff;
  assert.equal(parseMessage(f).error, 'BAD_CRC');
});

test('malformed: رسالة مبتورة ⇒ INCOMPLETE', () => {
  const f = frame(Buffer.from('hello'), 1);
  assert.equal(parseMessage(f.subarray(0, f.length - 1)).error, 'INCOMPLETE');
});

test('replay: counter قديم يُرفض', () => {
  const srv = new ChannelServer();
  const m1 = parseMessage(frame(Buffer.from('a'), 10));
  assert.equal(srv.handle(m1).ok, true);
  const m2 = parseMessage(frame(Buffer.from('b'), 10)); // نفس counter ⇒ إعادة
  assert.equal(srv.handle(m2).error, 'REPLAY');
  const m3 = parseMessage(frame(Buffer.from('c'), 9)); // أقل ⇒ إعادة
  assert.equal(srv.handle(m3).error, 'REPLAY');
  const m4 = parseMessage(frame(Buffer.from('d'), 11)); // أكبر ⇒ OK
  assert.equal(srv.handle(m4).ok, true);
});

test('rate-limit: تجاوز المعدّل يُرفض', () => {
  const srv = new ChannelServer({ rateLimit: 3, rateWindowMs: 5000 });
  for (let i = 1; i <= 3; i++) {
    assert.equal(srv.handle(parseMessage(frame(Buffer.from('x'), i))).ok, true);
  }
  // الرابعة تُرفض
  assert.equal(srv.handle(parseMessage(frame(Buffer.from('x'), 4))).error, 'RATE_LIMITED');
});

test('mid-message disconnect: جزء ثم بقيّة ⇒ يكتمل', () => {
  const feed = new FrameFeed();
  const f = frame(Buffer.from('partial-test'), 5);
  // أطعم النصف الأول
  let msgs = feed.push(f.subarray(0, 6));
  assert.equal(msgs.length, 0);
  // أطعم البقيّة
  msgs = feed.push(f.subarray(6));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].counter, 5);
  assert.equal(msgs[0].payload.toString(), 'partial-test');
});

test('mid-message disconnect: رسالتان متتاليتان في تدفّق واحد', () => {
  const feed = new FrameFeed();
  const f1 = frame(Buffer.from('one'), 1);
  const f2 = frame(Buffer.from('two'), 2);
  const msgs = feed.push(Buffer.concat([f1, f2]));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].payload.toString(), 'one');
  assert.equal(msgs[1].payload.toString(), 'two');
});

test('timeout: رسالة غير مكتملة لا تُخرج (تنتظر المزيد)', () => {
  const feed = new FrameFeed();
  const f = frame(Buffer.from('wait'), 1);
  const msgs = feed.push(f.subarray(0, 5)); // جزء فقط
  assert.equal(msgs.length, 0); // ما زال ينتظر — لا رسالة مكتملة
});

test('crc: دالة crc16 متّسقة', () => {
  const b = Buffer.from('test');
  assert.equal(crc16(b), crc16(Buffer.from('test')));
  assert.notEqual(crc16(b), crc16(Buffer.from('tesu')));
});
