// @ts-nocheck
// tests/sim/tpm-ceremony-guard.test.mjs
//
// WL-412 — حارسُ بروفةِ المراسم (sim/tpm-ceremony/): إثباتُ أنّ مسارَ TBS الخاصَّ بالمضيفِ غيرُ قابلٍ
// للوصولِ من أداةِ المحاكاة، وأنّ أيَّ نقلٍ غيرِ محاكٍ يُرفَضُ بفشلٍ مغلق.
//   1) static: لا DllImport ولا tbs ولا Tbsi ولا TbsTransport ولا OwnerAuth ولا Clear-Tpm في الأداة؛ النقلُ
//      الوحيدُ loopback؛ C# 5؛ والتقريرُ لا يُسلسِلُ بايتاتِ الأوامر.
//   2) pwsh: المُشغِّلُ يرفضُ مضيفاً غيرَ loopback (ValidateSet)، والنقلُ يرفضُه بـSIMULATOR_TRANSPORT_LOOPBACK_ONLY.
//   3) pwsh: نقلٌ يدّعي شريحةً غيرَ المحاكي (IFX) ⇒ FAILED_CLOSED بعدَ استعلامِ الهويّةِ وحدَه.
//   4) pwsh: كلُّ أمرٍ تبنيه البروفةُ يُعرَضُ على حارسِ أداةِ المضيف (TpmGuard) ⇒ يُرفَضُ كلُّه ولا يبلغُ النقل.
//   5) static: حارسُ المحاكي القائمُ (sim/tpm/tcti_guard.mjs) وقائمةُ الحداثةِ الإنتاجيةِ لم تُمَسّا.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = join(root, 'sim/tpm-ceremony');
const core = join(dir, 'TpmCeremonyCore.cs');
const runner = join(dir, 'rehearse.ps1');
const harness = join(root, 'tests/helpers/tpm-ceremony-harness.ps1');
const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const stripPsComments = (s) => s.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
const stripCsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const pwshTest = (name, fn) => test(name, { skip: pwshAvailable ? false : 'pwsh unavailable' }, fn);

test('static: لا مسارَ إلى TBS أو جهازٍ أو أسرارِ المالكِ في أداةِ البروفة', () => {
  const files = readdirSync(dir).filter((f) => /\.(cs|ps1|mjs)$/.test(f));
  assert.deepEqual(files.sort(), ['TpmCeremonyCore.cs', 'policy_digest.mjs', 'rehearse.ps1']);
  const forbidden = [
    /DllImport/, /tbs\.dll/i, /\bTbsi?_/, /TbsTransport/, /Xuux\.TpmHost/, /OwnerAuth/, /LockoutAuth/i,
    /Clear-Tpm/i, /Initialize-Tpm/i, /Set-Tpm/i, /Get-Tpm/i, /Win32_Tpm/i, /\/dev\/tpm/, /tpmrm/i,
    /device:/, /NV_Certify/i, /CC_NV_Certify/, /0x00000184/i, /HierarchyChangeAuth/i, /\bClear\b\s*\(/,
    /ExecutionPolicy/i, /Invoke-WebRequest/i, /Install-Module/i, /Start-Process/i, /Invoke-Expression/i,
    /xuux-tpmd/, /SUPPORTED_FRESHNESS_BACKENDS/,
  ];
  for (const f of files) {
    const p = join(dir, f);
    const body = f.endsWith('.cs') ? stripCsComments(read(p)) : f.endsWith('.ps1') ? stripPsComments(read(p)) : read(p).replace(/^\s*\/\/.*$/gm, '');
    for (const re of forbidden) assert.equal(re.test(body), false, `${f} contains ${re}`);
  }
});

test('static: النقلُ الوحيدُ swtpm على loopback، والنواةُ C# 5، والتقريرُ بلا بايتاتِ أوامر', () => {
  const cs = stripCsComments(read(core));
  const transports = [...cs.matchAll(/class\s+(\w+)\s*:\s*ICeremonyTransport/g)].map((m) => m[1]);
  assert.deepEqual(transports, ['SwtpmLoopbackTransport']);
  assert.match(cs, /host != "127\.0\.0\.1" && host != "::1"\) throw new CeremonyFailedException\("SIMULATOR_TRANSPORT_LOOPBACK_ONLY"/);
  // الهويّةُ الكاملةُ ثمّ خطُّ الأساسِ ثمّ المراحلُ — لا أمرٍ مُغيّرٍ قبلَ الهويّةِ والجردِ (WL-413).
  assert.match(cs, /AssertSimulatorIdentity\(\);\s*\n\s*SnapshotBaseline\(\);\s*\n\s*if \(stages == "S1"/);
  for (const re of [/\$"/, /\?\./, /\bnameof\b/, /out var\b/, /\)\s*=>/]) assert.equal(re.test(cs), false, `C# 5 violation ${re}`);
  // المُسلسِلُ: بصمةُ الأمرِ لا بايتاتُه.
  const toJson = cs.slice(cs.indexOf('public string ToJson()'));
  assert.equal(/Hex\.Of\(\s*s\.Command\b|"command"\s*:/.test(toJson), false);
  assert.match(toJson, /commandSha256/);
  // لا قوالبَ بايتٍ ثابتةٍ للأوامر: كلُّ أمرٍ يمرُّ عبرَ Cmd.Build.
  assert.equal(/new byte\[\]\s*\{\s*0x80,\s*0x0[12]/.test(cs), false);
  const ps = stripPsComments(read(runner));
  assert.match(ps, /\[ValidateSet\('127\.0\.0\.1', '::1'\)\]\[string\]\$SimHost/);
  assert.equal(/TpmInventoryCore|sim\/tpm-host|tpm-host/.test(ps), false);
});

test('static: سماتُ المرساةِ في النواةِ تطابقُ §4.1 (ORDERLY=0، NO_DA، بلا POLICY_DELETE ولا AUTHWRITE)', () => {
  const cs = stripCsComments(read(core));
  assert.match(cs, /ANCHOR_ATTRIBUTES = NV_TPM_NT_COUNTER \| NV_POLICYWRITE \| NV_AUTHREAD \| NV_NO_DA;/);
  assert.match(cs, /NV_ORDERLY = 1u << 26;/);
  assert.match(cs, /NV_POLICY_DELETE = 1u << 10;/);
  assert.match(cs, /NV_NO_DA = 1u << 25;/);
});

pwshTest('pwsh: المُشغِّلُ يرفضُ أيَّ مضيفٍ غيرِ loopback قبلَ الاتصال', () => {
  for (const h of ['192.168.1.10', 'localhost', 'tpm.local', '0.0.0.0']) {
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', runner, '-SimHost', h, '-SimPort', '2321'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, h);
    assert.match(r.stderr + r.stdout, /ValidateSet|does not belong to the set/i, h);
  }
});

pwshTest('pwsh: نقلُ المحاكي نفسُه يرفضُ غيرَ loopback بـSIMULATOR_TRANSPORT_LOOPBACK_ONLY', () => {
  const cmd = `Add-Type -Path '${core}' -IgnoreWarnings; try { New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport('10.0.0.1', 2321) | Out-Null; 'NO-THROW' } catch { $_.Exception.InnerException.Message }`;
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });
  assert.match(r.stdout, /SIMULATOR_TRANSPORT_LOOPBACK_ONLY/);
});

pwshTest('pwsh: شريحةٌ غيرُ المحاكي (IFX) ⇒ FAILED_CLOSED بعدَ استعلامِ الهويّةِ وحدَه، بلا أيِّ أمرٍ مُغيِّر', () => {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, '-Mode', 'foreign-identity'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.report.status, 'FAILED_CLOSED');
  assert.match(res.report.failure, /^SIMULATOR_IDENTITY_REQUIRED: manufacturer=IFX/);
  assert.deepEqual(res.received, ['0x0000017a']);
  assert.equal(res.report.steps.length, 1);
  assert.deepEqual(res.report.cleanupLeftovers, []);
});

pwshTest('pwsh: حارسُ أداةِ المضيفِ يرفضُ أوامرَ التغييرِ والسياساتِ ويسمحُ باستعلامَيِ الجردِ فقط', () => {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, '-Mode', 'host-guard'], { encoding: 'utf8', maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.ok(res.cases.length >= 17);
  // الاستثناءانِ المقصودانِ (WL-413/SOL-06): استعلامُ القدراتِ وقراءةُ المنطقةِ العامّةِ — قرائيّانِ مسموحانِ في
  // حارسِ أداةِ الجردِ؛ وكلُّ أوامرِ التغييرِ والسياساتِ والتوقيعِ تُرفضُ ولا تبلغُ النقلَ.
  for (const c of res.cases) {
    if (c.name === 'GetCapability' || c.name === 'NV_ReadPublic') {
      assert.equal(c.rejected, false, c.name);
    } else {
      assert.equal(c.rejected, true, c.name);
      assert.match(c.message, /^XUUX_TPM_COMMAND_NOT_ALLOWED/, c.name);
    }
  }
  assert.equal(res.reached.length, 2);
  assert.ok(res.reached.every((h) => h.startsWith('8001')));
  assert.ok(res.reached.some((h) => h.includes('0000017a')));
  assert.ok(res.reached.some((h) => h.includes('00000169')));
  assert.equal(res.submittedCount, 2);
  const ccs = new Set(res.cases.map((c) => c.commandCode));
  for (const cc of ['0x0000012a', '0x00000134', '0x00000122', '0x00000160', '0x00000131']) assert.ok(ccs.has(cc), cc);
});

test('static: حارسُ المحاكي القائمُ وبوابةُ الحداثةِ الإنتاجيةُ وعقدُ المراجعةِ لم تُمَسّ في هذه الدفعة', () => {
  // المقارنةُ بكوميتِ الأساسِ 8b9fca7a (رأسُ PR #376) — إن توفّرَ في تاريخِ النسخة.
  const base = '8b9fca7ac2541e28e1c840b6e171b00cc8580adf';
  const has = spawnSync('git', ['cat-file', '-e', base + '^{commit}'], { cwd: root }).status === 0;
  if (!has) return; // نسخةٌ سطحيةٌ بلا الأساس: الفحصُ النصّيُّ أدناه يبقى.
  const changed = execFileSync('git', ['diff', '--name-only', base, '--', 'sim/tpm/tcti_guard.mjs', 'config/external-review.yaml', 'version.json', 'src/', 'scripts/production-entry.mjs', 'scripts/tpm-sim-ci.sh'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(changed, '', 'protected files changed: ' + changed);
});
