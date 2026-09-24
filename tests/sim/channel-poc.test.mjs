// @ts-nocheck
// tests/sim/channel-poc.test.mjs
//
// اختبارات أدوات PoC القنوات (sim/channel/) — transient, non-production,
// no-TPM-write diagnostic PoC.
//
// 1) اختبارات ساكنة/وحدوية تعمل دائماً (وفي CI):
//    - سياسة الربط (منع 0.0.0.0/::/LAN، loopback فقط افتراضياً،
//      172.16.0.0/12 بشارة صريحة وواجهة فعلية).
//    - حارس ساكن: sim/channel لا يستورد عميل TPM ولا يستدعي أوامر TPM.
//    - تعادل التأطير بين python (vsock_lib) وnode (channel_protocol) —
//      يتخطّى إن غاب python3.
//    - وثائق العقد والمصفوفة موجودة (ضمان عدم انجرار الوثائق).
// 2) اختبارات حية خلف بوابة XUUX_CHANNEL_POC=1 (لا تعمل في CI):
//    تشغيل المستجيب/العميل فعلياً على loopback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { frame, parseMessage } from '../../sim/tpm/channel_protocol.mjs';
import {
  validateBindAddress,
  isWslNatRange,
  isLoopback,
} from '../../sim/channel/bind_policy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const channelDir = join(__dirname, '../../sim/channel');
const pocLive = process.env.XUUX_CHANNEL_POC === '1';
// `LIVE-17/SKIP-NO-REASON`: التخطّي يَحملُ سببَه في TAP.
const pocSkip = pocLive ? false : 'XUUX_CHANNEL_POC=1 غيرُ مُعلَنٍ — مسارُ القناةِ الحيُّ محلّيٌّ لا CI';

// ----------------------------------------------------------- سياسة الربط

test('bind policy: يرفض البدائل وغير Loopback', () => {
  for (const bad of ['0.0.0.0', '::', '::0', '', '   ']) {
    const r = validateBindAddress(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /WILDCARD|EMPTY/);
  }
  for (const bad of ['192.168.1.5', '10.0.0.1', '8.8.8.8', 'fe80::1', 'localhost']) {
    const r = validateBindAddress(bad);
    assert.equal(r.ok, false, bad);
  }
});

test('bind policy: يسمح بـloopback دائماً', () => {
  for (const good of ['127.0.0.1', '127.0.0.2']) {
    const r = validateBindAddress(good);
    assert.equal(r.ok, true, good);
    assert.equal(r.kind, 'loopback');
  }
});

test('bind policy: 172.16/12 يتطلب الشارة الصريحة وواجهة فعلية', () => {
  const fakeIfaces = ['172.20.0.5'];
  // بلا شارة: مرفوض
  assert.equal(validateBindAddress('172.20.0.5').ok, false);
  assert.match(validateBindAddress('172.20.0.5').error, /WITHOUT_FLAG/);
  // بالشارة لكن عنوان غير محلي: مرفوض
  assert.equal(
    validateBindAddress('172.20.0.5', { allowWslNat: true, interfaces: fakeIfaces }).ok,
    true
  );
  assert.equal(
    validateBindAddress('172.20.0.9', { allowWslNat: true, interfaces: fakeIfaces }).ok,
    false
  );
  // نطاق 172.17 (خارج 172.16/12؟ لا — 172.17 داخل /12) ونطاق 172.32 خارجها
  assert.equal(isWslNatRange('172.31.255.254'), true);
  assert.equal(isWslNatRange('172.32.0.1'), false);
  assert.equal(isWslNatRange('172.15.0.1'), false);
  assert.equal(isLoopback('127.9.9.9'), true);
  assert.equal(isLoopback('126.0.0.1'), false);
});

// ----------------------------------------------------------- حارس ساكن: لا TPM في أدوات القناة

test('static: أدوات sim/channel لا تستورد عميل TPM ولا أوامر TPM', () => {
  const forbidden = [
    /tpm_client/,
    /getcap/,
    /manifest_seal/,
    /assertSimulatorTcti/,
    /\bNV_DefineSpace\b/,
    /\bNV_Increment\b/,
    /\bNV_Write\b/,
    /\bNV_UndefineSpace\b/,
    /\bNV_Certify\b/,
    /\bClear-Tpm\b/,
    /\btpm2_[a-z]/,
    /\/dev\/tpm/,
  ];
  const files = readdirSync(channelDir).filter((f) => /\.(mjs|py|ps1|sh)$/.test(f));
  assert.ok(files.length >= 10, 'ملفات كود أدوات القناة موجودة: ' + files.length);
  for (const f of files) {
    const content = readFileSync(join(channelDir, f), 'utf8');
    for (const re of forbidden) {
      assert.doesNotMatch(
        content,
        re,
        `${f} يحتوي نمطاً محظوراً: ${re} — أدوات القناة لا تلمس TPM`
      );
    }
  }
});

test('static: مستجيبات TCP/vsock تفرض timeout إلزامياً وkill switch وتنظيفاً', () => {
  const responder = readFileSync(join(channelDir, 'tcp_responder.mjs'), 'utf8');
  assert.match(responder, /lifetime/);
  assert.match(responder, /kill-file/);
  assert.match(responder, /POC_EXIT/);
  assert.match(responder, /REFUSED/); // رفض TCTI حقيقي قبل الإقلاع
  const vresponder = readFileSync(join(channelDir, 'vsock_responder.py'), 'utf8');
  assert.match(vresponder, /lifetime-ms|lifetime_ms/);
  assert.match(vresponder, /kill-file|kill_file/);
  assert.match(vresponder, /POC_EXIT/);
  assert.match(vresponder, /refuse_real_tcti/);
  for (const f of ['win_responder.ps1', 'win_hvsock_listener.ps1']) {
    const ps = readFileSync(join(channelDir, f), 'utf8');
    assert.match(ps, /LifetimeSec/, f + ' يفرض lifetime');
    assert.match(ps, /KillFile/, f + ' فيه kill switch');
    assert.match(ps, /finally/, f + ' ينظف في finally');
    assert.doesNotMatch(ps, /New-Service|schtasks|New-ScheduledTask|netsh advfirewall/, f + ' لا ينشئ خدمة/مهمة/قاعدة جدار');
  }
});

test('static: أوامر التنظيف والتحقق موجودة للجهتين', () => {
  assert.ok(existsSync(join(channelDir, 'win_cleanup_verify.ps1')));
  assert.ok(existsSync(join(channelDir, 'wsl_cleanup_verify.sh')));
  const wv = readFileSync(join(channelDir, 'win_cleanup_verify.ps1'), 'utf8');
  assert.match(wv, /Get-NetTCPConnection/);
  assert.match(wv, /GuestCommunicationServices/);
  assert.match(wv, /Get-NetFirewallRule/);
});

test('docs: عقد TORN/MISMATCH ومصفوفة الأدلة موثّقة', () => {
  const readme = readFileSync(join(channelDir, 'README.md'), 'utf8');
  assert.match(readme, /STATE_MANIFEST_TPM_TORN/);
  assert.match(readme, /STATE_TPM_COUNTER_MISMATCH/);
  assert.match(readme, /transient, non-production, no-TPM-write diagnostic PoC/);
  assert.match(readme, /مصفوفة الأدلة/);
  assert.match(readme, /أثبته المحاكي/);
  assert.match(readme, /يحتاج TPM حقيقياً/);
  const tpmReadme = readFileSync(join(__dirname, '../../sim/tpm/README.md'), 'utf8');
  assert.match(tpmReadme, /عقد رموز الحالة: TORN مقابل MISMATCH/);
});

// ----------------------------------------------------------- تعادل python/node للتأطير

test('parity: تأطير XU متطابق بايتاً-بايتاً بين python وnode', () => {
  const py = spawnSync('python3', ['-c', 'import sys; print(sys.version_info >= (3,6))'], { encoding: 'utf8' });
  if (py.status !== 0 || py.stdout.trim() !== 'True') {
    console.log('  [skip] python3 غير متاح — تعادل التأطير python يتخطى');
    return;
  }
  // node يؤطر → python يحلل
  const payload = Buffer.from('cross-impl-parity-القناة-قناة');
  const nframe = frame(payload, 1234567);
  const out = spawnSync(
    'python3',
    [
      '-c',
      `import sys; sys.path.insert(0, r'${channelDir}'); import vsock_lib as vs, json
r = vs.parse_message(bytes.fromhex(sys.argv[1]))
print(json.dumps({'ok': r['ok'], 'counter': r.get('counter'), 'payload_hex': r.get('payload', b'').hex()}))`,
      nframe.toString('hex'),
    ],
    { encoding: 'utf8' }
  );
  assert.equal(out.status, 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.counter, 1234567);
  assert.equal(parsed.payload_hex, payload.toString('hex'));

  // python يؤطر → node يحلل
  const out2 = spawnSync(
    'python3',
    [
      '-c',
      `import sys; sys.path.insert(0, r'${channelDir}'); import vsock_lib as vs
print(vs.frame(b'py-side-parity-check', 99).hex())`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(out2.status, 0, out2.stderr);
  const m = parseMessage(Buffer.from(out2.stdout.trim(), 'hex'));
  assert.equal(m.ok, true);
  assert.equal(m.counter, 99);
  assert.equal(m.payload.toString(), 'py-side-parity-check');
});

// ----------------------------------------------------------- اختبارات حية (خلف بوابة)

test('live (XUUX_CHANNEL_POC=1): مستجيب/عميل TCP على loopback مع رفض malformed', { skip: pocSkip }, async () => {
  const { spawn } = await import('node:child_process');
  const port = 47910 + (process.pid % 500);
  const resp = spawn('node', [
    join(channelDir, 'tcp_responder.mjs'),
    '--port', String(port),
    '--lifetime-ms', '8000',
  ]);
  try {
    await new Promise((res, rej) => {
      resp.stdout.on('data', (d) => {
        if (String(d).includes('POC_READY')) res();
      });
      resp.once('exit', (c) => rej(new Error('responder exited early: ' + c)));
      setTimeout(rej, 3000, new Error('ready timeout'));
    });
    const probe = spawnSync('node', [
      join(channelDir, 'tcp_probe.mjs'), '--port', String(port), '--count', '3',
    ], { encoding: 'utf8', timeout: 10000 });
    assert.equal(probe.status, 0, probe.stdout + probe.stderr);
    assert.match(probe.stdout, /"ok":3/);
    // malformed
    const py = spawnSync('python3', ['-c', `
import socket, time
s = socket.create_connection(('127.0.0.1', ${port}), timeout=3)
s.sendall(b'\\x00\\x01garbage'); time.sleep(0.3); s.close()`], { encoding: 'utf8' });
    assert.equal(py.status, 0);
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    resp.kill('SIGTERM');
    await new Promise((r) => resp.once('exit', r));
  }
});

test('live (XUUX_CHANNEL_POC=1): فحص توافر vsock يعمل ويطبع تقريراً منظماً', { skip: pocSkip }, async () => {
  const out = spawnSync('python3', [join(channelDir, 'vsock_probe_wsl.py')], {
    encoding: 'utf8', timeout: 35000,
  });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /PROBE_RESULT/);
  const line = out.stdout.split('\n').find((l) => l.startsWith('PROBE_RESULT'));
  const report = JSON.parse(line.slice('PROBE_RESULT '.length));
  assert.ok(['available', 'unavailable', 'family-missing'].includes(report.verdict));
  assert.equal(typeof report.dev_vsock, 'boolean');
  assert.equal(typeof report.family_supported, 'boolean');
});

// انحدارٌ مثبَتٌ ميدانياً (WL-105): في PowerShell يبقى [byte] -shl 8 بعرضِ بايتٍ ويُقصُّ
// إلى صفر، فيُحسبُ CRC على مدخلاتٍ صفريةٍ ويُرفضُ كلُّ إطارٍ سليمٍ بـBAD_CRC.
// أُثبتَ ذلك على حدِّ Windows↔WSL2 الحقيقي: got=0x8dff want=0xac9f، و0xac9f هي
// بالضبط قيمةُ CRC عندما تكونُ كلُّ بايتاتِ الدخلِ صفراً. الحشوُ إلى [int] إلزامي.
test('static: سكربتات PowerShell تحشو البايت إلى [int] قبل الإزاحة في CRC', () => {
  const psFiles = readdirSync(channelDir).filter((f) => f.endsWith('.ps1'));
  assert.ok(psFiles.length >= 3);
  for (const f of psFiles) {
    const src = readFileSync(join(channelDir, f), 'utf8');
    if (!/-shl\s+8/.test(src)) continue;
    assert.match(
      src,
      /\[int\]\$b\s+-shl\s+8/,
      `${f}: يجب أن تكون الإزاحة ([int]$b -shl 8) لا ($b -shl 8) — وإلا قُصَّت إلى صفر`,
    );
    assert.ok(
      !/[^\]]\$b\s+-shl\s+8/.test(src.replace(/\[int\]\$b\s+-shl\s+8/g, '')),
      `${f}: بقيت إزاحةُ بايتٍ بلا حشو`,
    );
  }
});
