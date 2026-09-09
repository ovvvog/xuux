// @ts-nocheck
// sim/tpm/channel_protocol.mjs
//
// بروتوكول قناة TPM (same-environment TCP protocol PoC) — منطق التأطير فقط.
// غير إنتاجي: تحقيق/محاكاة. لا يتصل بـTPM حقيقي ولا بـWSL.
//
// الرسالة: [magic(2)][counter(8)][len(4)][payload(len)][crc16(2)].
// الأمان: تأطير صارم، حد أقصى للحجم، كشف التشويه، حماية من الإعادة عبر counter،
// تحديد معدّل، وتحمل انقطاع منتصف الرسالة.

import { createHash } from 'node:crypto';

export const MAGIC = 0x5855; // 'XU'
export const HEADER_LEN = 14; // 2 + 8 + 4
export const CRC_LEN = 2;
export const MAX_PAYLOAD = 65536;
export const MAX_FRAME = HEADER_LEN + MAX_PAYLOAD + CRC_LEN;

/** crc16-ccitt (0x1021, init 0xFFFF) — كشف التشويه. */
export function crc16(buf) {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/**
 * يُؤطّر حمولة بـcounter. يرفض الحمولات الكبيرة.
 * @returns {Buffer}
 */
export function frame(payload, counter) {
  if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload);
  if (payload.length > MAX_PAYLOAD) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }
  const buf = Buffer.alloc(HEADER_LEN + payload.length + CRC_LEN);
  buf.writeUInt16BE(MAGIC, 0);
  // counter 8 بايت (big-endian). يُدعم حتى 2^53.
  buf.writeBigUInt64BE(BigInt(counter), 2);
  buf.writeUInt32BE(payload.length, 10);
  payload.copy(buf, 14);
  buf.writeUInt16BE(crc16(buf.subarray(0, 14 + payload.length)), 14 + payload.length);
  return buf;
}

/**
 * يُحلّل رسالة كاملة. يتحقق من magic وcrc والحد الأقصى.
 * @returns {{ok: boolean, error?: string, counter?: number, payload?: Buffer}}
 */
export function parseMessage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_LEN + CRC_LEN) {
    return { ok: false, error: 'TOO_SHORT' };
  }
  const magic = buf.readUInt16BE(0);
  if (magic !== MAGIC) return { ok: false, error: 'BAD_MAGIC' };
  const len = buf.readUInt32BE(10);
  if (len > MAX_PAYLOAD) return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
  if (buf.length < HEADER_LEN + len + CRC_LEN) return { ok: false, error: 'INCOMPLETE' };
  const payload = buf.subarray(HEADER_LEN, HEADER_LEN + len);
  const crc = buf.readUInt16BE(HEADER_LEN + len);
  const expected = crc16(buf.subarray(0, HEADER_LEN + len));
  if (crc !== expected) return { ok: false, error: 'BAD_CRC' };
  return { ok: true, counter: Number(buf.readBigUInt64BE(2)), payload: Buffer.from(payload) };
}

/**
 * محلّل تدفّق: يراكم البايتات ويُخرج رسائل كاملة. يتحمل انقطاع منتصف الرسالة.
 */
export class FrameFeed {
  constructor() { this.buf = Buffer.alloc(0); }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const msgs = [];
    for (;;) {
      if (this.buf.length < HEADER_LEN) break;
      const len = this.buf.readUInt32BE(10);
      if (len > MAX_PAYLOAD) {
        this.buf = Buffer.alloc(0);
        throw new Error('PAYLOAD_TOO_LARGE');
      }
      const total = HEADER_LEN + len + CRC_LEN;
      if (this.buf.length < total) break; // جزئية — انتظار المزيد
      const m = parseMessage(this.buf.subarray(0, total));
      if (!m.ok) { this.buf = Buffer.alloc(0); throw new Error('PARSE_ERROR:' + m.error); }
      msgs.push(m);
      this.buf = this.buf.subarray(total);
    }
    return msgs;
  }
}

/**
 * خادم منطقي يفرض رتابة counter (حماية من الإعادة) وتحديد المعدّل.
 */
export class ChannelServer {
  constructor({ rateLimit = 100, rateWindowMs = 1000 } = {}) {
    this.lastCounter = 0;
    this.timestamps = [];
    this.rateLimit = rateLimit;
    this.rateWindowMs = rateWindowMs;
  }
  /** يعالج رسالة. يرفض الإعادة (counter <= last) وتجاوز المعدّل. */
  handle(message) {
    // تحديد المعدّل
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.rateWindowMs);
    if (this.timestamps.length >= this.rateLimit) {
      return { ok: false, error: 'RATE_LIMITED' };
    }
    this.timestamps.push(now);
    if (!message.ok) return { ok: false, error: message.error ?? 'MALFORMED' };
    if (message.counter <= this.lastCounter) {
      return { ok: false, error: 'REPLAY' };
    }
    this.lastCounter = message.counter;
    return { ok: true, counter: message.counter };
  }
}
