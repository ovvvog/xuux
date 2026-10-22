// sim/tpm/raw_transport.mjs
//
// WL-453 — G2-1: نقلُ بايتاتِ أوامرِ TPM خامًا إلى swtpm على loopback (الطبقةُ L-D في الملحقِ هـ
// لـADR 0007، المستوى 2 في §10). **غيرُ إنتاجيّ:** مكيّفُ محاكٍ وحدَه، ولا يُستورَدُ من `src/`،
// ولا يتّصلُ بـTPM حقيقيٍّ ولا بـTBS ولا بأيِّ مسارِ جهاز. مكيّفاتُ المنصّةِ تنتظرُ قرارَ E3.
//
// **واجهةُ swtpm المقيسة (اختبارٌ استكشافيٌّ على swtpm 0.10.1، WL-453):** منفذُ البياناتِ في
// `swtpm socket --server type=tcp` يستقبلُ بايتاتِ الأمرِ خامًا بلا أيِّ إطارٍ إضافيّ، ويُعيدُ
// الردَّ خامًا؛ والاتّصالُ الواحدُ يحملُ أوامرَ متتالية؛ وأوامرُ التحكّمِ على منفذٍ مستقلّ (لا يمسُّه
// هذا الملفّ). أمّا `mssim:` فإطارُه مختلفٌ (رمزُ إرسالٍ ومحلّيّةٌ وطول)، فيُرفَضُ هنا صراحةً.
//
// **العقد:** `submit(bytes) → bytes` لأمرٍ واحدٍ في كلِّ مرّة، بمهلةٍ لكلِّ أمر. يقرأُ رأسَ الردّ،
// ثمّ `responseSize` بحدٍّ أعلى، ولا يقرأُ خارجَ الحدود. **ولا يُعيدُ الإرسالَ أبدًا:** كلُّ فشلٍ
// بعدَ كتابةِ أيِّ بايتٍ من الأمرِ يحملُ `outcome: 'unknown'` (§4.4–§4.5: لا يُعادُ إرسالُ أمرٍ
// نتيجتُه مجهولة)، وقبلَها `outcome: 'not-sent'`. والاتّصالُ بعدَ أيِّ فشلٍ مسمومٌ لا يُستعمَل.
//
// **ما ليسَه:** ليس محلِّلَ ردود (ذاك G2-2 في `src/`)، فلا يفحصُ الوسمَ ولا رمزَ الردِّ ولا
// منطقةَ التفويض؛ يُسلِّمُ إطارًا كاملًا محدودًا أو يرمي خطأً مسمّى.

import net from 'node:net';
import { assertSimulatorTcti } from './tcti_guard.mjs';

export const TPM_HEADER_SIZE = 10;
export const DEFAULT_MAX_RESPONSE_BYTES = 4096;
export const DEFAULT_TIMEOUT_MS = 5000;

const LOOPBACK_HOSTS = Object.freeze(new Set(['127.0.0.1', '::1']));
const COMMAND_TAGS = Object.freeze(new Set([0x8001, 0x8002]));

export const RAW_TRANSPORT_ERRORS = Object.freeze({
  DESTINATION_REFUSED: 'RAW_TRANSPORT_DESTINATION_REFUSED',
  CONNECT_FAILED: 'RAW_TRANSPORT_CONNECT_FAILED',
  COMMAND_INVALID: 'RAW_TRANSPORT_COMMAND_INVALID',
  BUSY: 'RAW_TRANSPORT_BUSY',
  TIMEOUT: 'RAW_TRANSPORT_TIMEOUT',
  CONNECTION_CLOSED: 'RAW_TRANSPORT_CONNECTION_CLOSED',
  RESPONSE_SIZE_INVALID: 'RAW_TRANSPORT_RESPONSE_SIZE_INVALID',
  RESPONSE_TOO_LARGE: 'RAW_TRANSPORT_RESPONSE_TOO_LARGE',
  RESPONSE_TRAILING_BYTES: 'RAW_TRANSPORT_RESPONSE_TRAILING_BYTES',
  UNSOLICITED_BYTES: 'RAW_TRANSPORT_UNSOLICITED_BYTES',
  POISONED: 'RAW_TRANSPORT_POISONED',
});

export class RawTransportError extends Error {
  /**
   * @param {string} code
   * @param {'not-sent' | 'unknown'} outcome
   * @param {string} detail
   */
  constructor(code, outcome, detail) {
    super(`${code}: ${detail}`);
    this.name = 'RawTransportError';
    this.code = code;
    this.outcome = outcome;
  }
}

/**
 * يحلّلُ وجهةَ المحاكي من سلسلةِ TCTI، بعدَ `assertSimulatorTcti`، ويقصرُها على `swtpm:` وعلى
 * عنوانِ loopback حرفيٍّ (لا `localhost`: الاسمُ يُحَلُّ عبرَ ملفّاتِ النظامِ فلا يُضمَنُ loopback).
 * @param {string} tcti
 * @returns {{ host: string, port: number }}
 */
export function parseSimulatorEndpoint(tcti) {
  let value;
  try {
    value = assertSimulatorTcti(tcti);
  } catch (e) {
    throw new RawTransportError(
      RAW_TRANSPORT_ERRORS.DESTINATION_REFUSED,
      'not-sent',
      /** @type {Error} */ (e).message,
    );
  }
  const refuse = (/** @type {string} */ why) =>
    new RawTransportError(RAW_TRANSPORT_ERRORS.DESTINATION_REFUSED, 'not-sent', why);
  if (!value.startsWith('swtpm:')) {
    throw refuse(`raw transport speaks the swtpm data-port protocol only: ${value}`);
  }
  /** @type {Record<string, string>} */
  const kv = {};
  for (const part of value.slice('swtpm:'.length).split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) throw refuse(`malformed TCTI option: ${part}`);
    const key = part.slice(0, eq);
    if (key in kv) throw refuse(`duplicate TCTI option: ${key}`);
    kv[key] = part.slice(eq + 1);
  }
  for (const key of Object.keys(kv)) {
    if (key !== 'host' && key !== 'port') throw refuse(`unsupported TCTI option: ${key}`);
  }
  const host = kv.host;
  const portText = kv.port;
  if (host === undefined || !LOOPBACK_HOSTS.has(host)) {
    throw refuse(`host must be a literal loopback address (127.0.0.1 or ::1): ${host ?? '(none)'}`);
  }
  if (portText === undefined || !/^[0-9]{1,5}$/.test(portText)) {
    throw refuse(`port must be a decimal integer: ${portText ?? '(none)'}`);
  }
  const port = Number(portText);
  if (port < 1 || port > 65535) throw refuse(`port out of range: ${port}`);
  return { host, port };
}

/**
 * يفحصُ بايتاتِ الأمرِ قبلَ الإرسال: رأسٌ كامل، ووسمُ أمرٍ صالح، و`commandSize` = الطول.
 * @param {Uint8Array} bytes
 * @returns {Buffer}
 */
export function checkCommandBytes(bytes) {
  const invalid = (/** @type {string} */ why) =>
    new RawTransportError(RAW_TRANSPORT_ERRORS.COMMAND_INVALID, 'not-sent', why);
  if (!(bytes instanceof Uint8Array)) throw invalid('command must be bytes');
  const buf = Buffer.from(bytes);
  if (buf.length < TPM_HEADER_SIZE) throw invalid(`command shorter than header: ${buf.length}`);
  const tag = buf.readUInt16BE(0);
  if (!COMMAND_TAGS.has(tag)) throw invalid(`command tag 0x${tag.toString(16)}`);
  const size = buf.readUInt32BE(2);
  if (size !== buf.length) throw invalid(`commandSize ${size} != length ${buf.length}`);
  return buf;
}

/**
 * مُجمِّعُ إطارِ ردٍّ واحد — صرفٌ بلا إدخالٍ وإخراج، ليُختبَرَ بالطفرات.
 * الحالة: `need-more` أو `complete` (الإطار) أو `error` (رمزٌ مسمّى).
 */
export class ResponseFramer {
  /** @param {number} maxResponseBytes */
  constructor(maxResponseBytes) {
    this.max = maxResponseBytes;
    /** @type {Buffer[]} */
    this.chunks = [];
    this.length = 0;
    /** @type {number | null} */
    this.expected = null;
  }

  /**
   * @param {Uint8Array} chunk
   * @returns {{ state: 'need-more' } | { state: 'complete', frame: Buffer } | { state: 'error', code: string, detail: string }}
   */
  push(chunk) {
    this.chunks.push(Buffer.from(chunk));
    this.length += chunk.length;
    if (this.expected === null) {
      if (this.length < 6) return { state: 'need-more' };
      const head = Buffer.concat(this.chunks);
      const size = head.readUInt32BE(2);
      if (size < TPM_HEADER_SIZE) {
        return {
          state: 'error',
          code: RAW_TRANSPORT_ERRORS.RESPONSE_SIZE_INVALID,
          detail: `responseSize ${size} < ${TPM_HEADER_SIZE}`,
        };
      }
      if (size > this.max) {
        return {
          state: 'error',
          code: RAW_TRANSPORT_ERRORS.RESPONSE_TOO_LARGE,
          detail: `responseSize ${size} > ${this.max}`,
        };
      }
      this.expected = size;
    }
    if (this.length < this.expected) return { state: 'need-more' };
    if (this.length > this.expected) {
      return {
        state: 'error',
        code: RAW_TRANSPORT_ERRORS.RESPONSE_TRAILING_BYTES,
        detail: `received ${this.length} > responseSize ${this.expected}`,
      };
    }
    return { state: 'complete', frame: Buffer.concat(this.chunks) };
  }
}

export class SwtpmRawTransport {
  /**
   * @param {string} tcti مثل `swtpm:host=127.0.0.1,port=2321`
   * @param {{ timeoutMs?: number, maxResponseBytes?: number, connectTimeoutMs?: number }} [options]
   * @returns {Promise<SwtpmRawTransport>}
   */
  static async open(tcti, options = {}) {
    const { host, port } = parseSimulatorEndpoint(tcti);
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const socket = await new Promise((resolve, reject) => {
      const s = net.connect({ host, port });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new RawTransportError(RAW_TRANSPORT_ERRORS.CONNECT_FAILED, 'not-sent', 'connect timeout'));
      }, connectTimeoutMs);
      s.once('connect', () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('error', (/** @type {Error} */ e) => {
        clearTimeout(timer);
        reject(new RawTransportError(RAW_TRANSPORT_ERRORS.CONNECT_FAILED, 'not-sent', e.message));
      });
    });
    return new SwtpmRawTransport(/** @type {net.Socket} */ (socket), options);
  }

  /**
   * @param {net.Socket} socket
   * @param {{ timeoutMs?: number, maxResponseBytes?: number }} options
   */
  constructor(socket, options) {
    this.socket = socket;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    /** @type {null | ((chunk: Buffer) => void)} */
    this.onChunk = null;
    /** @type {null | (() => void)} */
    this.onEnd = null;
    /** @type {string | null} */
    this.poisoned = null;
    this.busy = false;
    this.commandsWritten = 0;
    socket.setNoDelay(true);
    socket.on('data', (chunk) => {
      if (this.onChunk) this.onChunk(chunk);
      else this.poison(RAW_TRANSPORT_ERRORS.UNSOLICITED_BYTES);
    });
    const ended = () => {
      if (this.onEnd) this.onEnd();
      else if (this.poisoned === null) this.poisoned = RAW_TRANSPORT_ERRORS.CONNECTION_CLOSED;
    };
    socket.on('end', ended);
    socket.on('close', ended);
    socket.on('error', () => ended());
  }

  /** @param {string} code */
  poison(code) {
    if (this.poisoned === null) this.poisoned = code;
    this.socket.destroy();
  }

  /**
   * يرسلُ أمرًا واحدًا ويُعيدُ إطارَ ردِّه كاملًا. لا يُعيدُ الإرسالَ أبدًا.
   * @param {Uint8Array} commandBytes
   * @returns {Promise<Buffer>}
   */
  submit(commandBytes) {
    if (this.poisoned !== null) {
      return Promise.reject(
        new RawTransportError(RAW_TRANSPORT_ERRORS.POISONED, 'not-sent', `connection poisoned by ${this.poisoned}`),
      );
    }
    if (this.busy) {
      return Promise.reject(
        new RawTransportError(RAW_TRANSPORT_ERRORS.BUSY, 'not-sent', 'a command is already in flight'),
      );
    }
    let buf;
    try {
      buf = checkCommandBytes(commandBytes);
    } catch (e) {
      return Promise.reject(e);
    }
    this.busy = true;
    const framer = new ResponseFramer(this.maxResponseBytes);
    return new Promise((resolve, reject) => {
      /** @param {string} code @param {string} detail */
      const fail = (code, detail) => {
        cleanup();
        this.poison(code);
        reject(new RawTransportError(code, 'unknown', detail));
      };
      const timer = setTimeout(() => fail(RAW_TRANSPORT_ERRORS.TIMEOUT, `no complete response in ${this.timeoutMs} ms`), this.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.onChunk = null;
        this.onEnd = null;
        this.busy = false;
      };
      this.onChunk = (chunk) => {
        const r = framer.push(chunk);
        if (r.state === 'need-more') return;
        if (r.state === 'error') return fail(r.code, r.detail);
        cleanup();
        resolve(r.frame);
      };
      this.onEnd = () => fail(RAW_TRANSPORT_ERRORS.CONNECTION_CLOSED, `connection ended after ${framer.length} response bytes`);
      this.commandsWritten += 1;
      this.socket.write(buf);
    });
  }

  close() {
    this.poisoned = this.poisoned ?? 'closed';
    this.socket.destroy();
  }
}
