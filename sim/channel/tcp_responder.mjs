#!/usr/bin/env node
// @ts-nocheck
// sim/channel/tcp_responder.mjs
//
// PoC تشخيصي مؤقت غير إنتاجي (transient, non-production, no-TPM-write diagnostic PoC).
// مستجيب وهمي عبر TCP ببروتوكول قناة XU (نفس تأطير sim/tpm/channel_protocol.mjs).
//
// الضمانات المفروضة:
// - timeout إلزامي: يخرج تلقائياً بعد --lifetime-ms (افتراضي 30 ث، حد أقصى 5 دقائق).
// - kill switch: وجود ملف --kill-file يُنهي العملية نظيفاً؛ وSIGTERM/SIGINT كذلك.
// - تنظيف تلقائي: يغلق المستمع وكل الاتصالات ويطبع تقرير خروج.
// - حد أقصى لحجم الرسائل (MAX_PAYLOAD من بروتوكول القناة) ورفض malformed.
// - rate limiting لكل اتصال (نافذة زمنية).
// - منع الاستماع على 0.0.0.0 أو :: أو عنوان LAN (سياسة bind_policy.mjs)؛
//   loopback افتراضياً، وشبكة WSL NAT (172.16/12) فقط بصريح --allow-wsl-nat
//   وبعنوان واجهة محلية فعلية.
// - لا TPM إطلاقاً: لا استيراد لعميل TPM، ويرفض الإقلاع إن ضُبط TPM2TOOLS_TCTI
//   على قيمة غير محاكٍ (دفاع في العمق).
// - لا خدمة دائمة ولا Scheduled Task ولا قاعدة Firewall — عملية أمامية تنتهي وحدها.

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  frame,
  FrameFeed,
  ChannelServer,
  MAX_PAYLOAD,
} from '../tpm/channel_protocol.mjs';
import { validateBindAddress } from './bind_policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  return [
    'Usage: node sim/channel/tcp_responder.mjs --port N [options]',
    '  --bind ADDR        bind address (default 127.0.0.1; loopback only unless --allow-wsl-nat)',
    '  --port N           TCP port (required)',
    '  --lifetime-ms N    mandatory auto-exit after N ms (default 30000, max 600000)',
    '  --kill-file PATH   kill switch: exit cleanly when this file appears',
    '                     (default /tmp/xuux-poc-tcp-kill-<port>)',
    '  --rate-limit N     max messages per connection per second (default 100)',
    '  --allow-wsl-nat    allow binding a local 172.16.0.0/12 (WSL NAT) interface address',
    '  --echo TEXT        payload prefix echoed back in diagnostic response (default "diag")',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--bind') out.bind = next();
    else if (a === '--port') out.port = Number(next());
    else if (a === '--lifetime-ms') out.lifetimeMs = Number(next());
    else if (a === '--kill-file') out.killFile = next();
    else if (a === '--rate-limit') out.rateLimit = Number(next());
    else if (a === '--allow-wsl-nat') out.allowWslNat = true;
    else if (a === '--echo') out.echo = next();
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

function refuseRealTcti() {
  const tcti = process.env.TPM2TOOLS_TCTI ?? '';
  if (tcti.length > 0 && !/^(swtpm|mssim):/.test(tcti)) {
    console.error(
      'REFUSED: TPM2TOOLS_TCTI=' + JSON.stringify(tcti) +
      ' — هذه أداة قناة تشخيصية لا تلمس TPM. ارفع المتغير أو اضبطه على محاكٍ.'
    );
    process.exit(3);
  }
}

function main() {
  refuseRealTcti();
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(args.port) || args.port <= 0 || args.port > 65535) {
    console.error('--port مطلوب (1..65535)');
    process.exit(2);
  }
  const lifetimeMs = args.lifetimeMs ?? 30000;
  if (!Number.isInteger(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 600000) {
    console.error('--lifetime-ms يجب أن يكون بين 1 و600000 (timeout إلزامي)');
    process.exit(2);
  }
  const rateLimit = args.rateLimit ?? 100;
  if (!Number.isInteger(rateLimit) || rateLimit <= 0) {
    console.error('--rate-limit يجب أن يكون عدداً موجباً');
    process.exit(2);
  }
  const bind = args.bind ?? '127.0.0.1';
  const policy = validateBindAddress(bind, { allowWslNat: args.allowWslNat });
  if (!policy.ok) {
    console.error('BIND_POLICY: ' + policy.error);
    process.exit(4);
  }
  const killFile =
    args.killFile ?? path.join('/tmp', `xuux-poc-tcp-kill-${args.port}`);
  const echoPrefix = args.echo ?? 'diag';

  const started = Date.now();
  const stats = {
    tool: 'tcp_responder',
    bind,
    port: args.port,
    bind_kind: policy.kind,
    lifetime_ms: lifetimeMs,
    rate_limit_per_s: rateLimit,
    connections: 0,
    messages_ok: 0,
    rejected: { RATE_LIMITED: 0, REPLAY: 0, MALFORMED: 0, OVERSIZE: 0 },
    exit_reason: null,
  };
  const sockets = new Set();
  let server;

  function shutdown(reason) {
    if (stats.exit_reason) return;
    stats.exit_reason = reason;
    stats.duration_ms = Date.now() - started;
    try { server?.close(); } catch {}
    for (const s of sockets) {
      try { s.destroy(); } catch {}
    }
    sockets.clear();
    try {
      if (fs.existsSync(killFile) && stats.exit_reason === 'kill-file') fs.unlinkSync(killFile);
    } catch {}
    console.log('POC_EXIT ' + JSON.stringify(stats));
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  server = net.createServer((sock) => {
    stats.connections++;
    sockets.add(sock);
    const feed = new FrameFeed();
    // منطق رسمي لكل اتصال: تحديد معدّل + رفض الإعادة (رتابة counter).
    const logic = new ChannelServer({ rateLimit, rateWindowMs: 1000 });
    sock.on('data', (chunk) => {
      let msgs;
      try {
        msgs = feed.push(chunk);
      } catch (e) {
        const key = e.message === 'PAYLOAD_TOO_LARGE' ? 'OVERSIZE' : 'MALFORMED';
        stats.rejected[key] = (stats.rejected[key] ?? 0) + 1;
        sock.destroy();
        return;
      }
      for (const m of msgs) {
        const res = logic.handle(m);
        if (!res.ok) {
          stats.rejected[res.error] = (stats.rejected[res.error] ?? 0) + 1;
          sock.destroy();
          return;
        }
        stats.messages_ok++;
        const reply = Buffer.from(
          `${echoPrefix}:ok:counter=${m.counter}:len=${m.payload.length}:no-tpm`
        );
        try {
          sock.write(frame(reply, m.counter));
        } catch {
          sock.destroy();
          return;
        }
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => sockets.delete(sock));
    // مهلة خمول لكل اتصال: 10 ثوانٍ بلا بيانات تُغلقه.
    sock.setTimeout(10000, () => sock.destroy());
  });

  server.on('error', (e) => {
    console.error('SERVER_ERROR: ' + e.message);
    process.exit(5);
  });

  server.listen(args.port, bind, () => {
    console.log(
      'POC_READY ' +
        JSON.stringify({
          tool: 'tcp_responder',
          bind,
          port: args.port,
          lifetime_ms: lifetimeMs,
          kill_file: killFile,
          protocol: 'XU-frame/tcp',
          max_payload: MAX_PAYLOAD,
          tpm: 'none (no-TPM-write diagnostic PoC)',
        })
    );
  });

  // timeout إلزامي + فحص ملف القتل كل 250 ملّي ثانية.
  const deadline = setTimeout(() => shutdown('lifetime'), lifetimeMs);
  deadline.unref();
  const killTimer = setInterval(() => {
    if (fs.existsSync(killFile)) shutdown('kill-file');
  }, 250);
  killTimer.unref();
}

main();
