#!/usr/bin/env node
// @ts-nocheck
// sim/channel/tcp_probe.mjs
//
// عميل PoC تشخيصي مؤقت غير إنتاجي (transient, non-production, no-TPM-write
// diagnostic PoC). يرسل رسائل XU-frame إلى مستجيب القناة ويقيس زمن الذهاب
// والعودة، ثم يطبع تقريراً ويخرج. لا يستمع ولا يغيّر شيئاً ولا يلمس TPM.

import net from 'node:net';
import { frame, parseMessage, MAX_PAYLOAD } from '../tpm/channel_protocol.mjs';

function usage() {
  return [
    'Usage: node sim/channel/tcp_probe.mjs --host H --port N [options]',
    '  --host H           target host (default 127.0.0.1)',
    '  --port N           target TCP port (required)',
    '  --count N          number of framed messages (default 5, max 100)',
    '  --payload-size N   payload bytes per message (default 64, max 65536)',
    '  --timeout-ms N     overall deadline (default 10000, max 60000)',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--host') out.host = next();
    else if (a === '--port') out.port = Number(next());
    else if (a === '--count') out.count = Number(next());
    else if (a === '--payload-size') out.payloadSize = Number(next());
    else if (a === '--timeout-ms') out.timeoutMs = Number(next());
    else if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      console.error('Unknown arg: ' + a);
      console.error(usage());
      process.exit(2);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(args.port) || args.port <= 0 || args.port > 65535) {
    console.error('--port مطلوب (1..65535)');
    process.exit(2);
  }
  const host = args.host ?? '127.0.0.1';
  const count = args.count ?? 5;
  if (!Number.isInteger(count) || count <= 0 || count > 100) {
    console.error('--count يجب أن يكون بين 1 و100');
    process.exit(2);
  }
  const payloadSize = args.payloadSize ?? 64;
  if (!Number.isInteger(payloadSize) || payloadSize <= 0 || payloadSize > MAX_PAYLOAD) {
    console.error('--payload-size يجب أن يكون بين 1 و' + MAX_PAYLOAD);
    process.exit(2);
  }
  const timeoutMs = args.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) {
    console.error('--timeout-ms يجب أن يكون بين 1 و60000');
    process.exit(2);
  }

  const report = {
    tool: 'tcp_probe',
    host,
    port: args.port,
    count,
    payload_size: payloadSize,
    ok: 0,
    failed: 0,
    rtts_ms: [],
    error: null,
  };

  const sock = net.createConnection({ host, port: args.port });
  let buf = Buffer.alloc(0);
  let sent = 0;
  const started = Date.now();

  const deadline = setTimeout(() => {
    report.error = 'TIMEOUT';
    finish();
  }, timeoutMs);

  function finish() {
    clearTimeout(deadline);
    try { sock.destroy(); } catch {}
    report.total_ms = Date.now() - started;
    delete report._t0;
    if (report.rtts_ms.length > 0) {
      const sorted = [...report.rtts_ms].sort((a, b) => a - b);
      report.rtt_min_ms = sorted[0];
      report.rtt_median_ms = sorted[Math.floor(sorted.length / 2)];
      report.rtt_max_ms = sorted[sorted.length - 1];
    }
    console.log('PROBE_RESULT ' + JSON.stringify(report));
    process.exit(report.ok === count && report.failed === 0 ? 0 : 1);
  }

  sock.on('connect', () => {
    const sendNext = () => {
      if (sent >= count) return;
      sent++;
      const payload = Buffer.alloc(payloadSize, 0x61 + (sent % 26));
      report._t0 = Date.now();
      sock.write(frame(payload, sent));
    };
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const m = parseMessage(buf);
      if (m.ok) {
        const total = 14 + m.payload.length + 2; // HEADER_LEN + payload + CRC
        buf = buf.subarray(total);
        report.rtts_ms.push(Date.now() - report._t0);
        report.ok++;
        if (report.ok >= count) finish();
        else sendNext();
      } else if (m.error === 'INCOMPLETE' || m.error === 'TOO_SHORT') {
        // انتظار بقية الرسالة
      } else {
        report.error = 'BAD_RESPONSE:' + m.error;
        report.failed++;
        finish();
      }
    });
    sendNext();
  });

  sock.on('error', (e) => {
    report.error = 'CONNECT_ERROR:' + e.code;
    finish();
  });
}

main();
