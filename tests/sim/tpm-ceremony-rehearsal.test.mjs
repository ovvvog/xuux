// @ts-nocheck
// tests/sim/tpm-ceremony-rehearsal.test.mjs
//
// WL-412 — بروفةُ المراسمِ S1/S2 على المحاكي (ADR 0007 §11.2؛ تفويضُ المالكِ 2026-10-17):
//   1) البروفةُ كاملةً على swtpm (بعدَ assertSimulatorTcti) ⇒ COMPLETE وبلا بقايا، وعددُ فهارسِ NV يعودُ كما كان.
//   2) بصمةُ سياسةِ الزيادة: بصمةُ جلسةِ تجربةِ الـTPM = حسابُ نواةِ C# = حسابٌ مستقلٌّ بـNode من نصِّ المواصفة
//      (sim/tpm-ceremony/policy_digest.mjs)، ونصفُ PolicyCommandCode يُطابَقُ أيضاً بـtpm2-tools.
//   3) الأسماءُ والسماتُ والأحجامُ تُعادُ حسابُها وفحصُها في Node بتاً بتاً (§4.1).
//   4) حقنُ TPM_E_COMMAND_BLOCKED داخلَ الاختبارِ عندَ كلِّ أمرٍ مُغيِّر ⇒ BLOCKED_FAIL_CLOSED: لا إعادة،
//      ولا بديل، ولا أمرَ غيرَ أوامرِ التنظيفِ بعدَ الرفض، والفهرسُ الذي أنشأته البروفةُ وحدَه يُحذَف.
// حدٌّ مُعلَن: هذا محاكٍ؛ لا يُثبِتُ سماحَ TBS ولا منعَه، ولا السعةَ الحرّة، ولا تفويضَ هرمِ التخزين،
// ولا ثباتَ العدّادِ على شريحةٍ حقيقية.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { assertSimulatorTcti, isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import {
  anchorIncrementPolicy, nameOfPublicArea, decodeNvPublic, anchorAttributeViolations,
  policyCommandCodeUpdate, TPM_CC, TPMA_NV,
} from '../../sim/tpm-ceremony/policy_digest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = join(root, 'sim/tpm-ceremony/rehearse.ps1');
const harness = join(root, 'tests/helpers/tpm-ceremony-harness.ps1');

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const sim = isSimEnabled();
const simPwshTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : (!pwshAvailable ? 'pwsh unavailable' : false) }, fn);

function simPort() {
  const tcti = assertSimulatorTcti(process.env.TPM2TOOLS_TCTI);
  const m = /^swtpm:host=(127\.0\.0\.1|localhost),port=(\d+)$/.exec(tcti);
  assert.ok(m, 'rehearsal supports swtpm:host=127.0.0.1,port=N only: ' + tcti);
  return m[2];
}

function nvHandleCount() {
  const out = execFileSync('tpm2_getcap', ['handles-nv-index'], { encoding: 'utf8' });
  return out.split('\n').filter((l) => /0x01[0-9a-fA-F]{6}/.test(l)).length;
}

function rehearse(stages) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', runner, '-SimHost', '127.0.0.1', '-SimPort', simPort(), '-Stages', stages], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return { rc: r.status, report: JSON.parse(r.stdout), stderr: r.stderr };
}

function inject(cc, nth = 1) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, '-Mode', 'inject-blocked', '-SimPort', simPort(), '-BlockCc', cc, '-Nth', String(nth)], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const STATE_CHANGING = new Set(['0x0000012a', '0x00000134', '0x00000122', '0x00000131', '0x00000153', '0x00000157']);

let full;
simPwshTest('sim: البروفةُ الكاملة (S1 ثمّ S2 ثمّ التحقّقُ من السمات) ⇒ COMPLETE، بلا بقايا، والفهارسُ كما كانت', () => {
  const before = nvHandleCount();
  full = rehearse('ALL');
  assert.equal(full.rc, 0, JSON.stringify(full.report).slice(0, 2000));
  assert.equal(full.report.status, 'COMPLETE');
  assert.equal(full.report.transport, 'simulator:swtpm-tcp');
  assert.deepEqual(full.report.cleanupLeftovers, []);
  assert.equal(nvHandleCount(), before, 'NV index count must return to baseline');
  assert.equal(full.report.facts['tpm.manufacturer'], 'IBM');
  // كلُّ خطوةٍ إمّا نجحت كما يُتوقَّع أو رُفِضت كما يُتوقَّع — لا ثالث.
  for (const s of full.report.steps) assert.ok(['ok', 'rejected-as-expected'].includes(s.outcome), JSON.stringify(s));
  // التقريرُ لا يحملُ أوامرَ خامّة: بصمةُ SHA-256 فقط.
  for (const s of full.report.steps) {
    assert.match(s.commandSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(s).sort(), ['commandCode', 'commandSha256', 'expectation', 'name', 'outcome', 'responseCode', 'stage']);
  }
});

simPwshTest('sim: بصمةُ سياسةِ الزيادة — جلسةُ تجربةِ الـTPM = نواةُ C# = حسابُ Node المستقلّ', () => {
  const f = full.report.facts;
  const nodeDigest = anchorIncrementPolicy(f['s2.serviceKey.name']);
  assert.equal(f['s2.policy.tpmTrialDigest'], nodeDigest, 'TPM trial digest vs independent Node computation');
  assert.equal(f['s2.policy.coreFormulaDigest'], nodeDigest, 'C# core formula vs independent Node computation');
  // اسمُ المفتاحِ يُعادُ حسابُه في Node من منطقتِه العامّةِ التي أعادَها الـTPM.
  assert.equal(nameOfPublicArea(f['s2.serviceKey.publicAreaHex']), f['s2.serviceKey.name']);
  // البصمةُ مثبَّتةٌ في authPolicy لفهرسِ شكلِ المرساة.
  assert.equal(decodeNvPublic(f['s2v.anchorShape.nvPublicHex(after-define)']).authPolicy, nodeDigest);
});

simPwshTest('sim: نصفُ PolicyCommandCode(NV_Increment) يطابقُ tpm2-tools (تنفيذٌ ثالث)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-pcc-'));
  try {
    execFileSync('tpm2_startauthsession', ['-S', join(dir, 's.ctx')], { stdio: 'ignore' });
    execFileSync('tpm2_policycommandcode', ['-S', join(dir, 's.ctx'), '-L', join(dir, 'p.bin'), 'TPM2_CC_NV_Increment'], { stdio: 'ignore' });
    execFileSync('tpm2_flushcontext', [join(dir, 's.ctx')], { stdio: 'ignore' });
    const tools = readFileSync(join(dir, 'p.bin')).toString('hex');
    assert.equal(tools, policyCommandCodeUpdate(Buffer.alloc(32), TPM_CC.NV_Increment).toString('hex'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

simPwshTest('sim: السماتُ والأسماءُ والأحجامُ (§4.1) مفحوصةٌ في Node بتاً بتاً', () => {
  const f = full.report.facts;
  const anchorDefined = decodeNvPublic(f['s2v.anchorShape.nvPublicHex(after-define)']);
  const anchorWritten = decodeNvPublic(f['s2v.anchorShape.nvPublicHex(after-write)']);
  assert.deepEqual(anchorAttributeViolations(anchorDefined.attributes, { written: false }), []);
  assert.deepEqual(anchorAttributeViolations(anchorWritten.attributes, { written: true }), []);
  for (const a of [anchorDefined, anchorWritten]) {
    assert.equal(a.nameAlg, 0x000b);
    assert.equal(a.dataSize, 8);
    assert.equal(a.attributes & TPMA_NV.ORDERLY, 0);
    assert.equal(a.attributes & TPMA_NV.POLICY_DELETE, 0);
    assert.notEqual(a.attributes & TPMA_NV.NO_DA, 0);
    assert.ok(a.index >= 0x01800000 && a.index <= 0x01bfffff, 'owner index range');
  }
  for (const k of ['s1.probe', 's2v.anchorShape']) {
    assert.equal(nameOfPublicArea(f[k + '.nvPublicHex(after-define)']), f[k + '.nvName(after-define)']);
    assert.equal(nameOfPublicArea(f[k + '.nvPublicHex(after-write)']), f[k + '.nvName(after-write)']);
    assert.notEqual(f[k + '.nvName(after-define)'], f[k + '.nvName(after-write)'], 'name changes once WRITTEN is set');
  }
  // فهرسُ السبرِ (S1) ليس شكلَ المرساة: AUTHWRITE بدلَ POLICYWRITE — مقصود.
  assert.deepEqual(anchorAttributeViolations(decodeNvPublic(f['s1.probe.nvPublicHex(after-define)']).attributes).sort(), ['AUTHWRITE=1', 'POLICYWRITE=0']);
});

simPwshTest('sim: النتائجُ السلبيةُ والإيجابيةُ المقيسة (لا تعميمَ على العتاد)', () => {
  const steps = Object.fromEntries(full.report.steps.map((s) => [s.name, s]));
  const f = full.report.facts;
  assert.equal(steps['s1.probe:NV_Read(before-first-increment)'].responseCode, '0x0000014a'); // TPM_RC_NV_UNINITIALIZED
  assert.equal(Number(f['s1.probe.value2']), Number(f['s1.probe.value1']) + 1);
  assert.equal(steps['s1.probe:NV_ReadPublic(after-undefine)'].responseCode, '0x0000018b'); // TPM_RC_HANDLE (handle 1)
  assert.equal(f['s1.redefine.aboveProbe'], 'true'); // محاكٍ فقط
  assert.equal(steps['s2v:NV_Increment(password-auth)'].outcome, 'rejected-as-expected');
  assert.equal(steps['s2v.policy:NV_Increment(policy-session)'].outcome, 'ok');
  for (const n of ['s2v.replay:PolicySigned(old-signature)', 's2v.foreign:PolicySigned(foreign-signature)',
    's2v.otherkey:NV_Increment(policy-of-other-key)', 's2v.wrongcc:NV_Increment(policy-for-NV_Read)']) {
    assert.equal(steps[n].outcome, 'rejected-as-expected', n);
  }
  assert.equal(f['s2v.anchorShape.valueAfterRejectedPaths'], f['s2v.anchorShape.value1']);
});

for (const [label, cc] of [['NV_DefineSpace', '0x12A'], ['NV_Increment', '0x134'], ['PolicySigned', '0x160'], ['NV_UndefineSpace', '0x122'], ['CreatePrimary', '0x131']]) {
  simPwshTest('sim: حقنُ TPM_E_COMMAND_BLOCKED عندَ ' + label + ' ⇒ توقّفٌ مغلقٌ بلا بديلٍ ولا إعادة', () => {
    const before = nvHandleCount();
    const res = inject(cc);
    const r = res.report;
    assert.equal(res.blockedCount, 1);
    assert.equal(r.status, 'BLOCKED_FAIL_CLOSED');
    assert.match(r.failure, /rc=0x80280400$/);
    const idx = r.steps.findIndex((s) => s.outcome === 'blocked');
    assert.ok(idx >= 0);
    assert.equal(r.steps[idx].commandCode, '0x' + cc.slice(2).toLowerCase().padStart(8, '0'));
    const after = r.steps.slice(idx + 1);
    // بعدَ الرفضِ: أوامرُ التنظيفِ وحدَها، ولا محاولةَ ثانيةَ للأمرِ المرفوضِ إلا حذفُ ما أنشأته البروفة.
    for (const s of after) {
      assert.equal(s.stage, 'cleanup', 'non-cleanup command after block: ' + s.name);
      assert.ok(['0x00000169', '0x00000122', '0x00000165'].includes(s.commandCode), s.name);
    }
    if (label !== 'NV_UndefineSpace') {
      for (const s of after) assert.notEqual(s.commandCode, r.steps[idx].commandCode, 'retry of blocked command');
      assert.deepEqual(r.cleanupLeftovers, []);
      assert.equal(nvHandleCount(), before);
    } else {
      // حذفُ الفهرسِ نفسُه رُفِض ⇒ التنظيفُ يحاولُ مرّةً واحدةً (التي تمرُّ هنا)، ولا يُخفي البقايا.
      assert.ok(r.cleanupLeftovers.length === 0 && nvHandleCount() === before);
    }
    // لا أمرَ مُغيِّرٌ بديلٌ (تعريفٌ بسماتٍ أخرى أو مقبضٍ آخر) بعدَ الرفض.
    for (const s of after) assert.ok(!(s.commandCode === '0x0000012a'), 'fallback define after block');
    assert.ok(after.every((s) => !STATE_CHANGING.has(s.commandCode) || s.commandCode === '0x00000122'));
  });
}
