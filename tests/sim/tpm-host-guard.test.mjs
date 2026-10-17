// @ts-nocheck
// tests/sim/tpm-host-guard.test.mjs
//
// WL-410 — حارسُ أداةِ جردِ المضيف (sim/tpm-host/): تثبيتُ أنّها لا تُنفِّذُ إلا الاستعلاماتِ
// المسموحة.
//   1) static: فحصٌ نصّيٌّ لملفّاتِ الأداة — لا رموزَ تغييرِ حالة، ولا نقلَ محاكٍ، ولا تعديلَ
//      سياسات، ونقاطُ دخولِ tbs.dll محصورةٌ بأربع، وحقولُ Get-Tpm قائمةٌ مغلقةٌ بلا OwnerAuth.
//   2) pwsh: النواةُ الحقيقيةُ (TpmInventoryCore.cs) تُحمَّلُ في PowerShell فترفضُ كلَّ كودِ أمرٍ في
//      المجالِ 0x11F..0x1A0 عدا الشكلَين المسموحَين، ولا يبلغُ النقلَ أيٌّ منها.
//   3) pwsh: الأداةُ على غيرِ Windows تخرجُ 2 (NOT_WINDOWS) — لا سقوطَ إلى محاكٍ.
//   4) sim: النواةُ نفسُها على swtpm تُنتجُ جرداً يُفسَّرُ كاملاً (بعدَ assertSimulatorTcti).
// حدٌّ مُعلَن: لا شيءَ هنا يُثبِتُ سلوكَ TBS أو شريحةٍ حقيقية — ذلك ينتظرُ تشغيلَ المالك.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertSimulatorTcti, isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import { analyzeInventory } from '../../sim/tpm-host/decode_inventory.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hostScript = join(root, 'sim/tpm-host/win_tpm_inventory.ps1');
const coreFile = join(root, 'sim/tpm-host/TpmInventoryCore.cs');
const harness = join(root, 'tests/helpers/tpm-host-sim-harness.ps1');
const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const stripPsComments = (s) => s.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
const stripCsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const pwshTest = (name, fn) => test(name, { skip: pwshAvailable ? false : 'pwsh unavailable' }, fn);
const sim = isSimEnabled();
const simPwshTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : (!pwshAvailable ? 'pwsh unavailable' : false) }, fn);

test('static: ملفّاتُ الأداةِ خاليةٌ من رموزِ تغييرِ الحالةِ والسياسات', () => {
  const ps = stripPsComments(read(hostScript));
  const cs = stripCsComments(read(coreFile));
  const forbidden = [
    /Clear-Tpm/i, /Initialize-Tpm/i, /Set-Tpm/i, /Unblock-Tpm/i, /Disable-Tpm/i, /Enable-Tpm/i,
    /Import-TpmOwnerAuth/i, /ConvertTo-TpmOwnerAuth/i, /Set-TpmOwnerAuth/i, /OwnerAuth/,
    /Tbsi_Get_OwnerAuth/, /Tbsi_Physical_Presence_Command/, /Tbsi_Revoke_Attestation/, /Tbsi_Get_TCG_Log/,
    /New-Service/i, /sc\.exe/i, /Set-Service/i, /Start-Service/i, /New-NetFirewallRule/i, /netsh/i,
    /ExecutionPolicy/i, /\.wslconfig/i, /wsl(\.exe)?\s/i, /Invoke-WebRequest/i, /Invoke-RestMethod/i,
    /Install-Module/i, /Install-Package/i, /Start-BitsTransfer/i, /Net\.WebClient/i,
    /Set-ItemProperty/i, /New-ItemProperty/i, /Remove-Item/i, /Remove-ItemProperty/i, /reg(\.exe)?\s+add/i,
    /Invoke-CimMethod/i, /Invoke-WmiMethod/i, /IsCommandBlocked/i, /bcdedit/i, /Start-Process/i,
    /Invoke-Expression/i, /\biex\b/i, /Add-Type\s+-TypeDefinition/i,
  ];
  for (const re of forbidden) {
    assert.equal(re.test(ps), false, `win_tpm_inventory.ps1 contains ${re}`);
    assert.equal(re.test(cs), false, `TpmInventoryCore.cs contains ${re}`);
  }
});

test('static: نقاطُ دخولِ tbs.dll أربعٌ بعينها، ولا نقلَ شبكيٌّ أو محاكٍ في الأداة', () => {
  const cs = stripCsComments(read(coreFile));
  const entries = [...cs.matchAll(/EntryPoint\s*=\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(entries, ['Tbsi_Context_Create', 'Tbsi_GetDeviceInfo', 'Tbsip_Context_Close', 'Tbsip_Submit_Command']);
  const dlls = [...cs.matchAll(/DllImport\s*\(\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  assert.ok(dlls.length > 0 && dlls.every((d) => d === 'tbs.dll'), 'only tbs.dll is imported');
  for (const re of [/System\.Net/, /TcpClient/, /Socket/, /swtpm/i, /mssim/i, /2321/]) {
    assert.equal(re.test(cs), false, `core contains ${re}`);
  }
  const ps = stripPsComments(read(hostScript));
  for (const re of [/TpmHostSimTransport/, /swtpm/i, /mssim/i, /SwtpmTcp/i, /2321/, /tests[\\/]/]) {
    assert.equal(re.test(ps), false, `host script contains ${re}`);
  }
});

test('static: Get-Tpm يُقرأُ بقائمةِ حقولٍ مغلقة؛ ولا معاملاتِ دخلٍ غيرُ -OutDir', () => {
  const ps = stripPsComments(read(hostScript));
  assert.match(ps, /Get-Tpm\b/);
  assert.equal(/Get-TpmEndorsementKeyInfo|Get-TpmSupportedFeature/i.test(ps), false);
  const paramBlock = ps.match(/param\s*\(([\s\S]*?)\)\s*\n/i);
  assert.ok(paramBlock, 'param block');
  const params = [...paramBlock[1].matchAll(/\$([A-Za-z]+)/g)].map((m) => m[1]);
  assert.deepEqual(params, ['OutDir']);
});

test('static: النواةُ بصيغةِ C# 5 (Windows PowerShell 5.1) وتحصرُ الأوامرَ بالكودَين', () => {
  const cs = stripCsComments(read(coreFile));
  for (const re of [/\$"/, /\?\./, /nameof\s*\(/, /out\s+var\b/, /\)\s*=>/, /\bget;\s*\}\s*=/]) {
    assert.equal(re.test(cs), false, `C# 6+ construct ${re}`);
  }
  assert.match(cs, /TPM_CC_GetCapability\s*=\s*0x0000017A/i);
  assert.match(cs, /TPM_CC_NV_ReadPublic\s*=\s*0x00000169/i);
  // Submit غيرُ قابلٍ للتجاوز: الحارسُ قبلَ النقلِ دائماً.
  assert.match(cs, /public\s+TransportResult\s+Submit\s*\(/);
  assert.equal(/virtual\s+TransportResult\s+Submit\s*\(/.test(cs), false);
});

test('static: حاجزُ المحاكي assertSimulatorTcti لم يُخفَّف', () => {
  assert.throws(() => assertSimulatorTcti('device:/dev/tpmrm0'), /TCTI_REAL_OR_UNKNOWN/);
  assert.throws(() => assertSimulatorTcti('tbs'), /TCTI_REAL_OR_UNKNOWN/);
  assert.throws(() => assertSimulatorTcti(''), /TCTI_REAL_OR_UNKNOWN/);
  assert.equal(assertSimulatorTcti('swtpm:host=127.0.0.1,port=2321'), 'swtpm:host=127.0.0.1,port=2321');
});

pwshTest('pwsh: النواةُ ترفضُ كلَّ أمرٍ غيرِ مسموحٍ قبلَ النقل، ولا يبلغُ النقلَ إلا الشكلان', () => {
  const cases = [];
  const mk = (name, bytes) => cases.push({ name, hex: Buffer.from(bytes).toString('hex') });
  for (let cc = 0x11f; cc <= 0x1a0; cc++) {
    for (const tag of [0x8001, 0x8002]) {
      for (const len of [14, 22, 27]) {
        const b = Buffer.alloc(len);
        b.writeUInt16BE(tag, 0);
        b.writeUInt32BE(len, 2);
        b.writeUInt32BE(cc, 6);
        if (len >= 22) { b.writeUInt32BE(6, 10); b.writeUInt32BE(0x100, 14); b.writeUInt32BE(64, 18); } else b.writeUInt32BE(0x01500016, 10);
        const allowed = tag === 0x8001 && ((cc === 0x17a && len === 22) || (cc === 0x169 && len === 14));
        if (!allowed) mk(`cc=${cc.toString(16)} tag=${tag.toString(16)} len=${len}`, b);
      }
    }
  }
  const gc = (cap, prop, count, size = 22) => {
    const b = Buffer.alloc(22);
    b.writeUInt16BE(0x8001, 0); b.writeUInt32BE(size, 2); b.writeUInt32BE(0x17a, 6);
    b.writeUInt32BE(cap, 10); b.writeUInt32BE(prop, 14); b.writeUInt32BE(count, 18);
    return b;
  };
  mk('cap PCRS', gc(5, 0, 1));
  mk('cap AUDIT_COMMANDS', gc(4, 0, 1));
  mk('cap PCR_PROPERTIES', gc(7, 0, 1));
  mk('cap AUTH_POLICIES', gc(9, 0x40000001, 1));
  mk('cap VENDOR', gc(0x100, 0, 1));
  mk('handles persistent', gc(1, 0x81000000, 1));
  mk('handles transient', gc(1, 0x80000000, 1));
  mk('handles permanent', gc(1, 0x40000000, 1));
  mk('count 0', gc(6, 0x100, 0));
  mk('count 257', gc(6, 0x100, 257));
  mk('size lie', gc(6, 0x100, 64, 0xff));
  const rp = Buffer.from('80010000000e0000016940000001', 'hex');
  mk('NV_ReadPublic owner hierarchy handle', rp);
  mk('short', Buffer.from('8001000000', 'hex'));
  mk('empty', Buffer.alloc(0));

  const dir = mkdtempSync(join(tmpdir(), 'xuux-tpmhost-'));
  try {
    const file = join(dir, 'cases.json');
    writeFileSync(file, JSON.stringify(cases));
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, '-Mode', 'guard', '-CasesFile', file], { encoding: 'utf8', maxBuffer: 64 << 20 });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.cases.length, cases.length);
    for (const c of out.cases) {
      assert.equal(c.rejected, true, c.name);
      assert.match(String(c.message), /XUUX_TPM_COMMAND_NOT_ALLOWED/, c.name);
    }
    assert.deepEqual(out.allowedCommandCodes, ['0x0000017a', '0x00000169']);
    assert.equal(out.submittedCount, 2, 'only the two allowed shapes reached the transport');
    assert.deepEqual(out.reached, ['8001000000160000017a000000060000010000000040', '80010000000e0000016901500016']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pwsh: الأداةُ على غيرِ Windows ⇒ خروجٌ 2 NOT_WINDOWS، بلا ملفٍّ ولا سقوطٍ إلى محاكٍ', { skip: !pwshAvailable ? 'pwsh unavailable' : (process.platform === 'win32' ? 'runs only off-Windows' : false) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-tpmhost-'));
  try {
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', hostScript, '-OutDir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /XUUX_TPM_INVENTORY status=NOT_WINDOWS exit=2/);
    assert.deepEqual(readdirSync(dir), [], 'no inventory file is produced off-Windows');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

simPwshTest('sim: النواةُ على swtpm ⇒ جردٌ كاملٌ يُفسَّر، ومقابضُه تطابقُ TPM_PT_HR_NV_INDEX', () => {
  const tcti = process.env.TPM2TOOLS_TCTI;
  assertSimulatorTcti(tcti);
  const m = /^swtpm:host=(127\.0\.0\.1|localhost),port=(\d+)$/.exec(tcti);
  assert.ok(m, 'harness supports swtpm:host=127.0.0.1,port=N only: ' + tcti);
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, '-Mode', 'inventory', '-SimHost', '127.0.0.1', '-SimPort', m[2]], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  const inv = JSON.parse(r.stdout);
  assert.equal(inv.transport, 'simulator:swtpm-tcp');
  const rep = analyzeInventory(inv);
  assert.deepEqual(rep.errors, []);
  assert.equal(rep.evidenceClass, 'simulator-not-hardware');
  for (const [k, v] of Object.entries(rep.capabilitiesComplete)) assert.equal(v, true, k);
  assert.equal(rep.nv.handleCount, rep.nv.nvIndexesDefined);
  assert.deepEqual(rep.nvIndexes.map((e) => e.handle), inv.nvHandles);
  assert.ok(rep.nvIndexes.every((e) => !e.error), JSON.stringify(rep.nvIndexes.filter((e) => e.error)));
});
