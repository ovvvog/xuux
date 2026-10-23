// tests/sim/g2-raw-transport.test.mjs
//
// WL-453 — G2-1: النقلُ الخامُ إلى swtpm (`sim/tpm/raw_transport.mjs`).
//
// قسمان: (أ) خادمٌ وهميٌّ على 127.0.0.1 داخلَ العمليّة — يُشغَّلُ دائمًا ويقيسُ المهلة، والانقطاع،
// والأحجامَ غيرَ الصحيحة، والبايتاتِ الزائدة، وعدمَ الإعادة؛ و(ب) swtpm حقيقيٌّ على loopback —
// مقيَّدٌ بـ`isSimEnabled()` ويُشغَّلُ إلزاميًّا في خطوةِ CI `scripts/tpm-sim-ci.sh` (تسقطُ إن تُخطّي).
// والطفراتُ في (ج) تثبتُ أنّ جدولَ الإطاراتِ يُسقِطُ كلَّ سلوكٍ خاطئٍ مسمّى ويقبلُ الصحيح.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  RAW_TRANSPORT_ERRORS as E,
  RawTransportError,
  ResponseFramer,
  SwtpmRawTransport,
  checkCommandBytes,
  parseSimulatorEndpoint,
} from '../../sim/tpm/raw_transport.mjs';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import { getCapability } from '../../sim/tpm/getcap.mjs';

// TPM2_GetCapability(TPM_CAP_TPM_PROPERTIES, TPM_PT_MANUFACTURER, 1) — قراءةٌ بلا جلسات.
const GETCAP_MANUFACTURER = Buffer.from('8001000000160000017a000000060000010500000001', 'hex');
const ok10 = Buffer.from('80010000000a00000000', 'hex');

/**
 * خادمٌ وهميٌّ: `onCommand(socket, bytes, index)` يقرّرُ الردّ.
 * @param {(socket: net.Socket, bytes: Buffer, index: number) => void} onCommand
 */
async function fakeServer(onCommand) {
  /** @type {Buffer[]} */
  const received = [];
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    socket.on('data', (d) => {
      received.push(Buffer.from(d));
      onCommand(socket, Buffer.from(d), received.length - 1);
    });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {net.AddressInfo} */ (server.address()).port;
  return {
    tcti: `swtpm:host=127.0.0.1,port=${port}`,
    received,
    connections: () => connections,
    close: () => new Promise((r) => server.close(() => r(undefined))),
  };
}

/** @type {(p: Promise<unknown>, code: string, outcome: string) => Promise<void>} */
const rejectsWith = (p, code, outcome) =>
  assert.rejects(p, (e) => e instanceof RawTransportError && e.code === code && e.outcome === outcome, `${code}/${outcome}`);

// ——— (أ) الوجهات ———

test('G2-1: الوجهاتُ المحظورةُ تُرفَضُ قبلَ أيِّ اتّصال (assertSimulatorTcti ثمّ loopback حرفيّ ثمّ swtpm وحدَه)', async () => {
  const srv = await fakeServer(() => {});
  const port = srv.tcti.split('port=')[1];
  const refused = [
    '',
    'device:/dev/tpm0',
    'device:/dev/tpmrm0',
    '/dev/tpm0',
    'tbs',
    'tabrmd:bus_type=system',
    `swtpm:host=10.0.0.5,port=${port}`,
    `swtpm:host=0.0.0.0,port=${port}`,
    `swtpm:host=localhost,port=${port}`,
    `swtpm:host=127.0.0.2,port=${port}`,
    `mssim:host=127.0.0.1,port=${port}`,
    'swtpm:host=127.0.0.1',
    'swtpm:host=127.0.0.1,port=0',
    'swtpm:host=127.0.0.1,port=70000',
    'swtpm:host=127.0.0.1,port=23x',
    `swtpm:host=127.0.0.1,port=${port},path=/dev/tpm0`,
    `swtpm:host=127.0.0.1,port=${port},host=10.0.0.5`,
    `swtpm:host=127.0.0.1,port=${port};rm`,
    `swtpm:port=${port}`,
  ];
  for (const tcti of refused) {
    await rejectsWith(SwtpmRawTransport.open(tcti), E.DESTINATION_REFUSED, 'not-sent');
  }
  assert.equal(srv.connections(), 0, 'لا اتّصالَ لأيِّ وجهةٍ مرفوضة');
  assert.deepEqual(parseSimulatorEndpoint(srv.tcti), { host: '127.0.0.1', port: Number(port) });
  assert.deepEqual(parseSimulatorEndpoint(`swtpm:host=::1,port=${port}`), { host: '::1', port: Number(port) });
  await srv.close();
});

test('G2-1: فشلُ الاتّصالِ ⇒ CONNECT_FAILED/not-sent', async () => {
  const srv = await fakeServer(() => {});
  const tcti = srv.tcti;
  await srv.close();
  await rejectsWith(SwtpmRawTransport.open(tcti, { connectTimeoutMs: 2000 }), E.CONNECT_FAILED, 'not-sent');
});

// ——— (أ) الأمرُ قبلَ الإرسال ———

test('G2-1: أمرٌ غيرُ صالحٍ يُرفَضُ ولا يُكتَبُ منه بايت', async () => {
  const srv = await fakeServer((s) => s.write(ok10));
  const t = await SwtpmRawTransport.open(srv.tcti);
  const bad = [
    Buffer.alloc(0),
    Buffer.from('80010000000a000001', 'hex'), // أقصرُ من الرأس
    Buffer.from('c0010000000c000001440000', 'hex'), // وسمٌ غيرُ صالح
    Buffer.from('00c40000000c000001440000', 'hex'), // وسمُ TPM 1.2
    Buffer.from('8001000000ff000001440000', 'hex'), // commandSize أكبرُ من الطول
    Buffer.from('80010000000b000001440000', 'hex'), // commandSize أصغرُ من الطول
  ];
  for (const b of bad) await rejectsWith(t.submit(b), E.COMMAND_INVALID, 'not-sent');
  await assert.rejects(t.submit(/** @type {any} */ ('8001')), (e) => e instanceof RawTransportError && e.code === E.COMMAND_INVALID);
  assert.equal(srv.received.length, 0);
  assert.equal(t.commandsWritten, 0);
  // والاتّصالُ سليمٌ بعدَ رفضٍ قبلَ الإرسال.
  assert.ok((await t.submit(GETCAP_MANUFACTURER)).equals(ok10));
  t.close();
  await srv.close();
  assert.throws(() => checkCommandBytes(Buffer.from('80010000000c00000144', 'hex')), (e) => e instanceof RawTransportError);
});

// ——— (أ) الردود ———

test('G2-1: ردٌّ مُجزَّأٌ بايتًا بايتًا يُجمَّعُ كاملًا، وأوامرُ متتاليةٌ على اتّصالٍ واحد', async () => {
  const resp = Buffer.from('80010000001b000000000100000006000000010000010549424d00', 'hex');
  const srv = await fakeServer((s) => {
    let i = 0;
    const tick = () => {
      if (i < resp.length) {
        s.write(resp.subarray(i, i + 1));
        i += 1;
        setTimeout(tick, 1);
      }
    };
    tick();
  });
  const t = await SwtpmRawTransport.open(srv.tcti);
  assert.ok((await t.submit(GETCAP_MANUFACTURER)).equals(resp));
  assert.ok((await t.submit(GETCAP_MANUFACTURER)).equals(resp));
  assert.equal(srv.received.length, 2);
  t.close();
  await srv.close();
});

test('G2-1: المهلةُ ⇒ TIMEOUT/unknown، ولا إعادةَ إرسال، والاتّصالُ مسمومٌ بعدَها', async () => {
  const srv = await fakeServer(() => {}); // لا يردُّ أبدًا
  const t = await SwtpmRawTransport.open(srv.tcti, { timeoutMs: 150 });
  await rejectsWith(t.submit(GETCAP_MANUFACTURER), E.TIMEOUT, 'unknown');
  await rejectsWith(t.submit(GETCAP_MANUFACTURER), E.POISONED, 'not-sent');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(srv.received.length, 1, 'الأمرُ وصلَ مرّةً واحدةً فقط');
  assert.equal(t.commandsWritten, 1);
  await srv.close();
});

test('G2-1: انقطاعٌ منتصفَ الردّ ⇒ CONNECTION_CLOSED/unknown؛ وانقطاعٌ قبلَ أيِّ ردٍّ كذلك', async () => {
  const mid = await fakeServer((s) => {
    s.write(Buffer.from('800100000020', 'hex')); // ستّةُ بايتاتٍ من رأسٍ يعلنُ 32
    setTimeout(() => s.destroy(), 20);
  });
  const t1 = await SwtpmRawTransport.open(mid.tcti);
  await rejectsWith(t1.submit(GETCAP_MANUFACTURER), E.CONNECTION_CLOSED, 'unknown');
  await rejectsWith(t1.submit(GETCAP_MANUFACTURER), E.POISONED, 'not-sent');
  assert.equal(mid.received.length, 1);
  await mid.close();

  const none = await fakeServer((s) => s.destroy());
  const t2 = await SwtpmRawTransport.open(none.tcti);
  await rejectsWith(t2.submit(GETCAP_MANUFACTURER), E.CONNECTION_CLOSED, 'unknown');
  await none.close();
});

test('G2-1: انقطاعٌ والاتّصالُ خامل ⇒ الأمرُ التالي POISONED/not-sent بلا كتابة', async () => {
  /** @type {net.Socket | null} */
  let peer = null;
  const srv = await fakeServer((s) => s.write(ok10));
  const server = net.createServer((s) => {
    peer = s;
    s.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {net.AddressInfo} */ (server.address()).port;
  const t = await SwtpmRawTransport.open(`swtpm:host=127.0.0.1,port=${port}`);
  await new Promise((r) => setTimeout(r, 30));
  /** @type {net.Socket} */ (/** @type {unknown} */ (peer)).destroy();
  await new Promise((r) => setTimeout(r, 50));
  await rejectsWith(t.submit(GETCAP_MANUFACTURER), E.POISONED, 'not-sent');
  assert.equal(t.commandsWritten, 0);
  await new Promise((r) => server.close(() => r(undefined)));
  await srv.close();
});

test('G2-1: أحجامُ ردٍّ غيرُ صحيحة: responseSize < 10، وأكبرُ من الحدّ، وذيلٌ زائد — كلُّها unknown ومسمومة', async () => {
  const cases = [
    { bytes: Buffer.from('800100000009000000', 'hex'), code: E.RESPONSE_SIZE_INVALID },
    { bytes: Buffer.from('800100000000', 'hex'), code: E.RESPONSE_SIZE_INVALID },
    { bytes: Buffer.from('8001ffffffff', 'hex'), code: E.RESPONSE_TOO_LARGE },
    { bytes: Buffer.from('800100001001', 'hex'), code: E.RESPONSE_TOO_LARGE }, // 4097 > 4096
    { bytes: Buffer.concat([ok10, Buffer.from('00', 'hex')]), code: E.RESPONSE_TRAILING_BYTES },
  ];
  for (const { bytes, code } of cases) {
    const srv = await fakeServer((s) => s.write(bytes));
    const t = await SwtpmRawTransport.open(srv.tcti);
    await rejectsWith(t.submit(GETCAP_MANUFACTURER), code, 'unknown');
    await rejectsWith(t.submit(GETCAP_MANUFACTURER), E.POISONED, 'not-sent');
    assert.equal(srv.received.length, 1, `${code}: لا إعادة`);
    await srv.close();
  }
});

test('G2-1: بايتاتٌ زائدةٌ تصلُ بعدَ اكتمالِ الإطار (أو بلا أمر) تسمُّ الاتّصالَ قبلَ الأمرِ التالي', async () => {
  const srv = await fakeServer((s) => {
    s.write(ok10);
    setTimeout(() => s.write(Buffer.from('ff', 'hex')), 20);
  });
  const t = await SwtpmRawTransport.open(srv.tcti);
  assert.ok((await t.submit(GETCAP_MANUFACTURER)).equals(ok10));
  await new Promise((r) => setTimeout(r, 60));
  await rejectsWith(t.submit(GETCAP_MANUFACTURER), E.POISONED, 'not-sent');
  assert.equal(srv.received.length, 1);
  await srv.close();
});

test('G2-1: أمرٌ ثانٍ أثناءَ أمرٍ جارٍ ⇒ BUSY/not-sent بلا كتابة', async () => {
  const srv = await fakeServer((s) => setTimeout(() => s.write(ok10), 40));
  const t = await SwtpmRawTransport.open(srv.tcti);
  const first = t.submit(GETCAP_MANUFACTURER);
  await rejectsWith(t.submit(GETCAP_MANUFACTURER), E.BUSY, 'not-sent');
  assert.ok((await first).equals(ok10));
  assert.equal(srv.received.length, 1);
  t.close();
  await srv.close();
});

// ——— (ج) الطفرات: الجدولُ يُسقِطُ السلوكَ الخاطئَ ويقبلُ الصحيح ———

/** @typedef {{ push(chunk: Uint8Array): { state: string, frame?: Buffer, code?: string } }} Framer */
/** @type {Array<{ name: string, chunks: string[], expect: { state: string, code?: string, frame?: string } }>} */
const FRAME_TABLE = [
  { name: 'رأسٌ مُجزَّأ', chunks: ['8001', '0000', '000a', '00000000'], expect: { state: 'complete', frame: '80010000000a00000000' } },
  { name: 'ردٌّ على دفعتين', chunks: ['80010000000c0000', '00001234'], expect: { state: 'complete', frame: '80010000000c000000001234' } },
  { name: 'responseSize < 10', chunks: ['800100000009000000'], expect: { state: 'error', code: E.RESPONSE_SIZE_INVALID } },
  { name: 'responseSize > الحدّ', chunks: ['8001ffffffff'], expect: { state: 'error', code: E.RESPONSE_TOO_LARGE } },
  { name: 'ذيلٌ زائد', chunks: ['80010000000a0000000000'], expect: { state: 'error', code: E.RESPONSE_TRAILING_BYTES } },
];

/** @param {Framer} framer @param {string[]} chunks */
function runFramer(framer, chunks) {
  /** @type {{ state: string, frame?: Buffer, code?: string }} */
  let r = { state: 'need-more' };
  for (const c of chunks) {
    r = framer.push(Buffer.from(c, 'hex'));
    if (r.state !== 'need-more') break;
  }
  return r;
}

/** @param {() => Framer} make */
function tableFailures(make) {
  const failures = [];
  for (const row of FRAME_TABLE) {
    const r = runFramer(make(), row.chunks);
    const okState = r.state === row.expect.state;
    const okCode = row.expect.code === undefined || r.code === row.expect.code;
    const okFrame = row.expect.frame === undefined || (r.frame && r.frame.toString('hex') === row.expect.frame);
    if (!(okState && okCode && okFrame)) failures.push(row.name);
  }
  return failures;
}

test('G2-1 (طفرات): المُجمِّعُ الصحيحُ يجتازُ الجدولَ كلَّه، وكلُّ طفرةٍ مسمّاةٍ تُسقِطُ صفًّا على الأقلّ', () => {
  assert.deepEqual(tableFailures(() => new ResponseFramer(4096)), []);
  /** @type {Record<string, () => Framer>} */
  const mutants = {
    // يعدُّ أوّلَ دفعةٍ ردًّا كاملًا (قراءةُ `data` واحدةٍ — الخطأُ الشائع).
    'first-chunk-is-response': () => ({ push: (c) => ({ state: 'complete', frame: Buffer.from(c) }) }),
    // بلا حدٍّ أعلى لـresponseSize.
    'no-upper-bound': () => {
      const f = new ResponseFramer(Number.MAX_SAFE_INTEGER);
      return f;
    },
    // يقتطعُ الذيلَ بصمتٍ بدلَ الرفض.
    'truncate-trailing': () => {
      /** @type {Buffer} */
      let acc = Buffer.alloc(0);
      return {
        push: (c) => {
          acc = Buffer.concat([acc, Buffer.from(c)]);
          if (acc.length < 6) return { state: 'need-more' };
          const size = acc.readUInt32BE(2);
          if (size < 10) return { state: 'error', code: E.RESPONSE_SIZE_INVALID };
          if (size > 4096) return { state: 'error', code: E.RESPONSE_TOO_LARGE };
          if (acc.length < size) return { state: 'need-more' };
          return { state: 'complete', frame: acc.subarray(0, size) };
        },
      };
    },
    // بلا حدٍّ أدنى (يقبلُ responseSize < 10).
    'no-lower-bound': () => {
      /** @type {Buffer} */
      let acc = Buffer.alloc(0);
      return {
        push: (c) => {
          acc = Buffer.concat([acc, Buffer.from(c)]);
          if (acc.length < 6) return { state: 'need-more' };
          const size = acc.readUInt32BE(2);
          if (size > 4096) return { state: 'error', code: E.RESPONSE_TOO_LARGE };
          if (acc.length < size) return { state: 'need-more' };
          if (acc.length > size) return { state: 'error', code: E.RESPONSE_TRAILING_BYTES };
          return { state: 'complete', frame: acc };
        },
      };
    },
  };
  for (const [name, make] of Object.entries(mutants)) {
    assert.ok(tableFailures(make).length > 0, `الطفرةُ ${name} لم يُسقِطْها أيُّ صفّ`);
  }
});

// ——— (د) خياراتٌ غيرُ صالحةٍ (WL-455) ———

test('G2-1 (WL-455): خياراتٌ غيرُ نهائيّةٍ أو غيرُ صحيحةٍ تُرفَضُ مسمّاةً قبلَ أيِّ اتّصال — NaN/Infinity كانت تُعطِّلُ الحدَّ الأعلىَ صامتةً', async () => {
  // المُجمِّعُ: NaN/Infinity (وكذا 0 وسالبٌ وكسريٌّ وغيرُ عددٍ) رفضٌ مسمّى بنتيجةِ not-sent،
  // لا حدٌّ أعلى معطَّل. قبلَ الإصلاحِ كانَ `new ResponseFramer(NaN)` يمرُّ و`size > NaN`
  // كاذبةٌ دائمًا، فيُقبلُ ردٌّ يعلنُ أيَّ حجمٍ (قيس: رأسٌ يعلنُ 100000 بايتٍ ⇒ need-more).
  const badMax = [NaN, Infinity, -Infinity, 0, -5, 4096.5, '4096', null];
  for (const bad of badMax) {
    assert.throws(
      () => new ResponseFramer(/** @type {any} */ (bad)),
      (e) => e instanceof RawTransportError && e.code === E.OPTIONS_INVALID && e.outcome === 'not-sent',
      `maxResponseBytes=${String(bad)}`,
    );
  }
  // النقلُ: الخيارُ غيرُ الصالحِ يُرفَضُ قبلَ إنشاءِ المقعدِ — لا اتّصالَ ولا كتابةَ أصلًا.
  const srv = await fakeServer(() => {});
  const badOpens = [
    { maxResponseBytes: NaN },
    { maxResponseBytes: Infinity },
    { timeoutMs: NaN },
    { connectTimeoutMs: Infinity },
    { maxResponseBytes: 9 },
  ];
  for (const bad of badOpens) {
    await rejectsWith(SwtpmRawTransport.open(srv.tcti, bad), E.OPTIONS_INVALID, 'not-sent');
  }
  assert.equal(srv.connections(), 0, 'لا اتّصالَ لأيِّ خيارٍ مرفوض');
  await srv.close();
});

// ——— (ب) swtpm حقيقيٌّ على loopback ———

const sim = isSimEnabled();
/** @type {(name: string, fn: () => Promise<void>) => void} */
const simTest = (name, fn) => {
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);
};

simTest('G2-1 على swtpm: GetCapability خامٌّ يطابقُ قراءةَ tpm2-tools للحالةِ نفسِها (تنفيذانِ مستقلّان)', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  const r = await t.submit(GETCAP_MANUFACTURER);
  t.close();
  // رأسُ النجاح، ثمّ moreData(1) ‖ capability(4) ‖ count(4) ‖ property(4) ‖ value(4).
  assert.equal(r.readUInt16BE(0), 0x8001);
  assert.equal(r.readUInt32BE(2), r.length);
  assert.equal(r.readUInt32BE(6), 0);
  assert.equal(r.readUInt32BE(11), 6);
  assert.equal(r.readUInt32BE(15), 1);
  assert.equal(r.readUInt32BE(19), 0x105);
  const raw = r.readUInt32BE(23);
  const viaTools = await getCapability('properties-fixed');
  assert.equal(viaTools.rc, 0, viaTools.stderr);
  const m = /TPM2_PT_MANUFACTURER:\s*\n\s*raw:\s*(0x[0-9A-Fa-f]+)/.exec(viaTools.stdout);
  assert.ok(m, 'tpm2_getcap يُعلنُ TPM2_PT_MANUFACTURER');
  assert.equal(raw, Number(m[1]));
});

simTest('G2-1 على swtpm: أوامرُ متتاليةٌ على اتّصالٍ واحدٍ بلا إطارٍ إضافيّ، والردُّ مطابقٌ بايتيًّا', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  const a = await t.submit(GETCAP_MANUFACTURER);
  const b = await t.submit(GETCAP_MANUFACTURER);
  const c = await t.submit(GETCAP_MANUFACTURER);
  t.close();
  assert.ok(a.equals(b) && b.equals(c));
  assert.equal(t.commandsWritten, 3);
});

simTest('G2-1 على swtpm: أمرٌ بوسمٍ غيرِ صالحٍ لا يُرسَلُ أصلًا؛ وأمرٌ مقطوعُ المعاملاتِ يُعيدُ ردَّ خطأٍ من عشرةِ بايتات', async () => {
  const t = await SwtpmRawTransport.open(/** @type {string} */ (process.env.TPM2TOOLS_TCTI));
  await rejectsWith(t.submit(Buffer.from('c0010000000c000001440000', 'hex')), E.COMMAND_INVALID, 'not-sent');
  // GetCapability بلا معاملات: رأسٌ صالحٌ وطولٌ صادق، والـTPM يرفضُه.
  const r = await t.submit(Buffer.from('80010000000a0000017a', 'hex'));
  t.close();
  assert.equal(r.length, 10);
  assert.equal(r.readUInt16BE(0), 0x8001);
  assert.equal(r.readUInt32BE(2), 10);
  assert.notEqual(r.readUInt32BE(6), 0);
});
