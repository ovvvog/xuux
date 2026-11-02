// @ts-nocheck
// tests/sim/win11-qualification.test.mjs
//
// WL-510 — حارسُ أدواتِ التأهيلِ القرائيِّ على Windows 11 ومُقيِّمِ أدلّتِها
// (‏docs/adr/0007-annex-f-windows11-tbs-qualification.md §5).
//   1) static: الأداتانِ خاليتانِ من رموزِ تغييرِ الحالةِ ومن أيِّ مسارٍ إلى أسرارِ المالك أو إلى TPM.
//   2) pwsh: الأداةُ على غيرِ Windows تخرجُ 2 (NOT_WINDOWS) بلا ملفّ.
//   3) bash: المسبارُ على غيرِ WSL يخرجُ 2 (NOT_WSL) بلا ملفّ.
//   4) المُقيِّم: أحكامُه على مدخلاتٍ **اصطناعيّةٍ موسومة** (‏ليست أدلّةً من جهازِ المالك)، وثوابتُه
//      freshnessProven/productionEligible/ekChainVerified = false تحتَ كلِّ مدخل.
// حدٌّ مُعلَن: لا شيءَ هنا يُثبتُ سلوكَ TBS أو شريحةٍ حقيقية — ذلك ينتظرُ تشغيلَ المالكِ بإذنِه.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  evaluateWin11Qualification,
  QUALIFICATION_SCHEMA,
  INTEROP_SCHEMA,
} from '../../sim/tpm-host/check_win11_qualification.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const psTool = join(root, 'sim/tpm-host/win11_qualification_readonly.ps1');
const shTool = join(root, 'sim/tpm-host/wsl_interop_probe.sh');
const checker = join(root, 'sim/tpm-host/check_win11_qualification.mjs');
const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const stripHash = (s) => s.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const onWsl = /microsoft|wsl/i.test(release());

test('static: أداةُ PowerShell قرائيّة — لا أوامرَ TPM ولا أسرارَ المالكِ ولا كتابةَ في السجلِّ أو الخدمات', () => {
  const ps = stripHash(read(psTool));
  const forbidden = [
    /\bGet-Tpm(?!EndorsementKeyInfo)\b/i,
    /Tbsi_/i,
    /OwnerAuth/i,
    /Services\\TPM\\WMI/i,
    /manage-bde/i,
    /\b(Set|Clear|Initialize|Enable|Disable|Unblock|Import|ConvertTo)-Tpm/i,
    /\b(Set|New|Remove|Rename|Clear)-Item(Property)?\b/i,
    /\b(Start|Stop|Restart|Set|Suspend)-Service\b/i,
    /\bwsl\.exe\b|&\s*['"]?wsl\b|Start-Process/i,
    /\breg(\.exe)?\s+(add|delete|import)/i,
    /Add-Type|DllImport|tbs\.dll/i,
    /Invoke-(Expression|WebRequest|RestMethod)|\biex\b/i,
  ];
  for (const re of forbidden) assert.doesNotMatch(ps, re, `forbidden token ${re}`);
  // الكتابةُ الوحيدة: ملفُّ التقرير.
  const writes = ps.match(/\b(Set-Content|Out-File|Add-Content)\b/g) ?? [];
  assert.equal(writes.length, 1, 'exactly one write (the report file)');
  assert.match(ps, /readOnly = \$true/);
  assert.match(ps, /tpmCommandsSent = 0/);
});

test('static: مسبارُ WSL قرائيّ — لا TPM ولا تشغيلَ لبرامجِ Windows ولا كتابةَ خارجَ ملفِّ التقرير', () => {
  const sh = stripHash(read(shTool));
  for (const re of [/\/dev\/tpm/, /tpm2_/, /\bcmd\.exe\b/, /\bwsl\.exe\b/, /\brm\s/, /\bsudo\b/, />\s*\/(etc|proc|sys)\//, /\bcurl\b|\bwget\b/]) {
    assert.doesNotMatch(sh, re, `forbidden token ${re}`);
  }
  for (const line of sh.split('\n').filter((l) => /powershell\.exe/.test(l))) {
    assert.match(line, /command -v powershell\.exe/, 'powershell.exe is only resolved, never executed');
  }
  const redirects = sh.match(/>"\$file"/g) ?? [];
  assert.equal(redirects.length, 1, 'exactly one write (the report file)');
});

test('pwsh: الأداةُ على غيرِ Windows ⇒ خروجٌ 2 NOT_WINDOWS بلا ملفّ', {
  skip: !pwshAvailable ? 'pwsh unavailable' : process.platform === 'win32' ? 'running on Windows' : false,
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'w11q-'));
  try {
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', psTool, '-OutDir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /NOT_WINDOWS/);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bash: المسبارُ على غيرِ WSL ⇒ خروجٌ 2 NOT_WSL بلا ملفّ', { skip: onWsl ? 'running inside WSL' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wslp-'));
  try {
    const r = spawnSync('bash', [shTool, dir], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /NOT_WSL/);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── مدخلاتٌ اصطناعيّةٌ موسومة (‏SYNTHETIC) — ليست قراءاتٍ من أيِّ جهاز ──
const SYN_DRV = 'a'.repeat(64);
const qual = (elevated, over = {}) => ({
  schema: QUALIFICATION_SCHEMA,
  readOnly: true,
  tpmCommandsSent: 0,
  status: elevated ? 'COMPLETE' : 'PARTIAL',
  errors: elevated ? [] : ['EK_REQUIRES_ELEVATION'],
  os: { caption: 'SYNTHETIC', version: '10.0.0', buildNumber: '00000' },
  tpmDriver: { fileVersion: 'SYNTHETIC', sha256: SYN_DRV },
  tbsService: { status: 'Running', startType: 'Automatic' },
  caller: { elevated },
  ek: elevated
    ? {
        read: true,
        isPresent: true,
        publicKeyHashSha256: 'SYNTHETIC',
        manufacturerCertificates: [{ subject: '', issuer: 'CN=SYNTHETIC CA', thumbprintSha1: 'SYNTHETIC', rawSha256: 'b'.repeat(64) }],
        additionalCertificates: [],
      }
    : { read: false },
  wsl: { distributions: [{ name: 'SYNTHETIC', isDefault: true, version: 2, flags: 15, interopFlag: true }] },
  ...over,
});
const interop = (over = {}) => ({
  schema: INTEROP_SCHEMA,
  readOnly: true,
  windowsProcessesStarted: 0,
  tpmCommandsSent: 0,
  status: 'COMPLETE',
  errors: [],
  kernelRelease: 'SYNTHETIC-microsoft-standard-WSL2',
  binfmt: { name: 'WSLInterop', enabled: true },
  wslConfInteropEnabled: null,
  wslInteropEnvPresent: true,
  powershellResolvable: true,
  ...over,
});
const byId = (v) => Object.fromEntries(v.items.map((i) => [i.id, i]));

function assertInvariants(v) {
  assert.equal(v.freshnessProven, false);
  assert.equal(v.productionEligible, false);
  assert.equal(v.ekChainVerified, false);
  for (const i of v.items) if (i.id === 'W-R3') assert.equal(i.ekChainVerified, false);
}

test('المُقيِّم: مدخلاتٌ كاملةٌ متّسقة ⇒ PASS للأربعة، والثوابتُ false', () => {
  const v = evaluateWin11Qualification({ standard: qual(false), elevated: qual(true), interop: interop() });
  const m = byId(v);
  for (const id of ['W-R2a', 'W-R2b', 'W-R3', 'W-R4']) assert.equal(m[id].verdict, 'PASS', `${id}: ${m[id].reasons}`);
  assert.deepEqual(m['W-R3'].issuers, ['CN=SYNTHETIC CA']);
  assertInvariants(v);
});

test('المُقيِّم: بلا مدخلات ⇒ NOT_RUN للجميع، لا PASS ضمنيّ', () => {
  const v = evaluateWin11Qualification({});
  for (const i of v.items) assert.equal(i.verdict, 'NOT_RUN', i.id);
  assertInvariants(v);
});

test('المُقيِّم: تقريرٌ يدّعي أوامرَ TPM أو ليس قرائيًّا ⇒ INVALID لما يعتمدُ عليه', () => {
  for (const bad of [{ readOnly: false }, { tpmCommandsSent: 1 }, { schema: 'other/1' }]) {
    const v = evaluateWin11Qualification({ standard: qual(false), elevated: qual(true, bad), interop: interop() });
    const m = byId(v);
    assert.equal(m['W-R2a'].verdict, 'INVALID');
    assert.equal(m['W-R2b'].verdict, 'INVALID');
    assert.equal(m['W-R3'].verdict, 'INVALID');
    assertInvariants(v);
  }
  const v = evaluateWin11Qualification({ standard: qual(false), elevated: qual(true), interop: interop({ windowsProcessesStarted: 1 }) });
  assert.equal(byId(v)['W-R4'].verdict, 'INVALID');
});

test('المُقيِّم: جلستانِ من الفئةِ نفسِها أو مُشغِّلٌ مختلف ⇒ FAIL', () => {
  let m = byId(evaluateWin11Qualification({ standard: qual(true), elevated: qual(true), interop: interop() }));
  assert.equal(m['W-R2b'].verdict, 'FAIL');
  m = byId(
    evaluateWin11Qualification({
      standard: qual(false, { tpmDriver: { sha256: 'c'.repeat(64) } }),
      elevated: qual(true),
      interop: interop(),
    }),
  );
  assert.equal(m['W-R2a'].verdict, 'FAIL');
  assert.match(m['W-R2a'].reasons.join(' '), /tpm\.sys differs/);
});

test('المُقيِّم: EK غيرُ مقروءٍ أو بلا شهادةِ صانع ⇒ FAIL لـW-R3 دونَ أن يمسَّ غيرَه', () => {
  let m = byId(evaluateWin11Qualification({ standard: qual(false), elevated: qual(true, { ek: { read: false } }) }));
  assert.equal(m['W-R3'].verdict, 'FAIL');
  assert.equal(m['W-R2a'].verdict, 'PASS');
  m = byId(
    evaluateWin11Qualification({
      standard: qual(false),
      elevated: qual(true, { ek: { read: true, isPresent: true, manufacturerCertificates: [], additionalCertificates: [] } }),
    }),
  );
  assert.equal(m['W-R3'].verdict, 'FAIL');
  assert.equal(m['W-R4'].verdict, 'NOT_RUN');
});

test('المُقيِّم: قناةُ التشغيلِ البينيِّ معطَّلةٌ بأيِّ طريق ⇒ FAIL لـW-R4', () => {
  const cases = [
    { interop: interop({ binfmt: { name: null, enabled: null } }) },
    { interop: interop({ wslConfInteropEnabled: false }) },
    { interop: interop({ powershellResolvable: false }) },
    {
      interop: interop(),
      standard: qual(false, { wsl: { distributions: [{ name: 'S', isDefault: true, version: 2, flags: 14, interopFlag: false }] } }),
    },
    // WL-514 (B-20): قيمةُ wsl.conf غيرُ المفهومةِ لا تمرّ.
    { interop: interop({ wslConfInteropEnabled: '0' }) },
    { interop: interop({ wslConfInteropEnabled: 'no' }) },
    // WL-514 (B-19): بلا توزيعةٍ افتراضيّةٍ في التقريرِ العاديّ ⇒ FAIL لا تخطٍّ صامت.
    { interop: interop(), standard: qual(false, { wsl: { distributions: [] } }) },
    { interop: interop(), standard: qual(false, { wsl: { distributions: [{ name: 'S', isDefault: false, version: 2, flags: 15, interopFlag: true }] } }) },
  ];
  for (const c of cases) {
    const v = evaluateWin11Qualification({ standard: qual(false), elevated: qual(true), ...c });
    assert.equal(byId(v)['W-R4'].verdict, 'FAIL');
    assertInvariants(v);
  }
});

test('WL-514 (B-19): W-R4 يقرأُ تقريرَ الجلسةِ العاديّة — مديرٌ بلا توزيعاتٍ لا يُخفي علمَ التشغيلِ المعطَّل', () => {
  const v = evaluateWin11Qualification({
    standard: qual(false, { wsl: { distributions: [{ name: 'S', isDefault: true, version: 2, flags: 14, interopFlag: false }] } }),
    elevated: qual(true, { wsl: { distributions: [] } }),
    interop: interop(),
  });
  assert.equal(byId(v)['W-R4'].verdict, 'FAIL');
  // وبلا تقريرٍ عاديٍّ لا PASS لـW-R4.
  const v2 = evaluateWin11Qualification({ elevated: qual(true), interop: interop() });
  assert.equal(byId(v2)['W-R4'].verdict, 'FAIL');
  assert.deepEqual(v.notEvaluatedHere, ['W-R0', 'W-R1', 'W-R5']);
});

test('WL-514 (B-18): CLI بمدخلٍ ناقصٍ (فحوصٌ NOT_RUN) يخرجُ 2 «غيرُ مكتمل» لا 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w11n-'));
  try {
    const p = join(dir, 'interop.json');
    writeFileSync(p, JSON.stringify(interop()));
    const r = spawnSync(process.execPath, [checker, '--interop', p], { encoding: 'utf8' });
    // بلا تقريرٍ عاديٍّ يفشلُ W-R4 (1)، وفي غيرِ ذلك NOT_RUN ⇒ 2؛ في الحالَين ليسَ 0.
    assert.notEqual(r.status, 0);
    const s2 = join(dir, 'standard.json');
    const e2 = join(dir, 'elevated.json');
    writeFileSync(s2, JSON.stringify(qual(false)));
    writeFileSync(e2, JSON.stringify(qual(true)));
    const r2 = spawnSync(process.execPath, [checker, '--standard', s2, '--elevated', e2], { encoding: 'utf8' });
    assert.equal(r2.status, 2, r2.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: يقرأُ الملفّاتِ ويثبّتُ بصماتِها ويخرجُ 0 عندَ النجاح و1 عندَ الإخفاق', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w11c-'));
  try {
    const files = { standard: qual(false), elevated: qual(true), interop: interop() };
    const args = [];
    for (const [k, v] of Object.entries(files)) {
      const p = join(dir, `${k}.json`);
      writeFileSync(p, '\uFEFF' + JSON.stringify(v));
      args.push(`--${k}`, p);
    }
    let r = spawnSync(process.execPath, [checker, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.match(out.inputs.standard.sha256, /^[0-9a-f]{64}$/);
    assert.equal(out.freshnessProven, false);
    writeFileSync(join(dir, 'interop.json'), JSON.stringify(interop({ powershellResolvable: false })));
    r = spawnSync(process.execPath, [checker, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    r = spawnSync(process.execPath, [checker, '--bogus', 'x'], { encoding: 'utf8' });
    assert.equal(r.status, 64);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
