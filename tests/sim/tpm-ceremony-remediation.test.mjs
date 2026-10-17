// @ts-nocheck
// tests/sim/tpm-ceremony-remediation.test.mjs
//
// WL-413 — اختباراتُ إصلاحِ عوائقِ مراجعةِ WL-412 المستقلّة (إعادةُ إنتاجٍ → إصلاحٌ → إثباتُ رجوعٍ):
//   1) الردُّ المشوَّهُ (وسمٌ غيرُ صالحٍ / منطقةُ تفويضِ ردٍّ محذوفة) يُفشِلُ مغلقًا برمزٍ مسمّى — لا
//      تُتابَعُ المراسمُ وكأنّ الاستجابةَ سليمةٌ (SOL-01).
//   2) فقدُ ردِّ NV_DefineSpace بعدَ التنفيذِ: حالةٌ مجهولةٌ تُجردُ قبلَ التنظيفِ — تُثبتُ وقوعَ الأثرِ
//      وملكيّتَهُ (مطابقةُ المنطقةِ العامّةِ) فيُحذَفُ الفهرسُ؛ وبالمقابلِ فقدُ الردِّ قبلَ التنفيذِ يُثبتُ
//      غيابَ الأثرِ. لا تقريرَ نجاحٍ كاذبًا ولا فهرسًا خفيًّا (SOL-02 — النتيجتانِ منفصلتانِ).
//   3) رفضُ تحريرِ الجلسةِ المستمرُّ: المقبضُ المعروفُ يُعلَنُ في البقايا والجلسةُ تبقى مرصودةً على
//      المحاكي — لا تقريرَ نظيفًا فوقَ جلسةٍ معلّقةٍ (SOL-03).
//   4) الرمزُ العامُّ (0x101) مكانَ رفضِ اختبارِ إعادةِ التوقيعِ يُرفَضُ هوَ نفسُهُ: لكلِّ حالةٍ سلبيّةٍ
//      رمزُها المتوقَّعُ تحديدًا (0x14A/0x18B/0x12F/0x5DB/0x99D — مقيسةٌ على swtpm) (SOL-04).
//   5) حجبُ الحذفِ الدائمُ: البقيّةُ تُعلَنُ والفهرسُ يبقى على المحاكي دليلًا (SOL-06/G47-2).
//   6) الهويّةُ الكاملةُ: سلاسلُ البائعِ الزائدةُ وطيُّ المسافاتِ والخاصيّةُ الناقصةُ تُرفضُ (G47-1).
//   7) متجهٌ ثابتٌ لبصمةِ السياسةِ يطابقُ حسابًا ثالثًا مستقلًّا، والبتاتُ المحجوزةُ (8-9 و20-24)
//      تُسمّى في فاحصِ السماتِ (SOL-05).
//   8) سياقُ تشغيلِ المحاكي: المشغِّلُ يتحقّقُ من ملفِّ PID (عمليةُ swtpm نفسُها) ويرفضُ السياقَ المنتحلَ.
// كلُّ مجموعةٍ تشغّلُ محاكيَها الخاصَّ بحالةٍ ومنافذَ معزولةٍ — لا مشاركةَ لحالةٍ معَ غيرِها.
// حدٌّ مُعلَن: هذا محاكٍ؛ لا يُثبِتُ سماحَ TBS ولا منعَهُ، ولا السعةَ الحرّة، ولا تفويضَ هرمِ التخزين.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import {
  anchorIncrementPolicy, anchorAttributeViolations,
} from '../../sim/tpm-ceremony/policy_digest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = join(root, 'tests/helpers/tpm-ceremony-harness.ps1');
const runner = join(root, 'sim/tpm-ceremony/rehearse.ps1');

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const sim = isSimEnabled();
const simPwshTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : (!pwshAvailable ? 'pwsh unavailable' : false) }, fn);

/** محاكٍ خاصٌّ معزولٌ: حالةٌ في مجلّدٍ مؤقّتٍ ومنفذانِ خاصّان وملفُّ PIDٍ للتحقّقِ السياقيّ. */
function startSim() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const dir = mkdtempSync(join(tmpdir(), 'xuux-wl413-'));
    const port = 2400 + 2 * Math.floor(Math.random() * 150);
    const pidFile = join(dir, 'swtpm.pid');
    const r = spawnSync('swtpm', ['socket', '--tpm2',
      '--tpmstate', `dir=${dir}`, '--server', `type=tcp,port=${port},bindaddr=127.0.0.1`,
      '--ctrl', `type=tcp,port=${port + 1},bindaddr=127.0.0.1`, '--flags', 'not-need-init,startup-clear',
      '--pid', `file=${pidFile}`, '--daemon'], { encoding: 'utf8' });
    if (r.status !== 0) { rmSync(dir, { recursive: true, force: true }); continue; }
    let ready = false;
    for (let i = 0; i < 10; i++) {
      try {
        execFileSync('tpm2_getcap', ['--tcti=swtpm:host=127.0.0.1,port=' + port, 'properties-fixed'], { stdio: 'ignore' });
        ready = true; break;
      } catch { /* المحاكيُ لم يجهز بعد */ }
      execFileSync('sleep', ['1']);
    }
    if (!ready || !existsSync(pidFile)) { rmSync(dir, { recursive: true, force: true }); continue; }
    return { dir, port, pidFile, pid: Number(execFileSync('cat', [pidFile]).toString().trim()) };
  }
  throw new Error('WL-413: تعذّرَ تشغيلُ محاكٍ معزول');
}

function stopSim(s) {
  try { process.kill(s.pid, 'SIGTERM'); } catch { /* انتهى */ }
  try { rmSync(s.dir, { recursive: true, force: true }); } catch { /* نظافة أفضل جهد */ }
}

function fault(s, mode) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness,
    '-Mode', 'fault', '-SimPort', String(s.port), '-Fault', mode], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

function rehearseOn(s, extraArgs = []) {
  const args = ['-NoProfile', '-NonInteractive', '-File', runner, '-SimHost', '127.0.0.1', '-SimPort', String(s.port), '-Stages', 'ALL', ...extraArgs];
  const r = spawnSync('pwsh', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  return { rc: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ── 1) متجهٌ ثابتٌ لبصمةِ السياسة (بلا محاكٍ): حسابُ Node يطابقُ حسابَ Python مستقلًّا من معادلةِ Part 3. ──
test('static: بصمةُ سياسةِ الزيادةِ لمتجهٍ ثابتٍ تطابقُ حسابًا ثالثًا مستقلًّا (Python/معادلةُ المواصفة)', () => {
  const name1 = '000b' + 'aa'.repeat(32);
  const name2 = '000b' + 'bb'.repeat(32);
  // حُسِبَت القيمتانِ بـhashlib خارجَ هذهِ الشيفرةِ من معادلاتِ Part 3 r1.38 §23.2.3/§23.11.
  assert.equal(anchorIncrementPolicy(name1), 'f64ae17f0b109c67e69d4518a9fd69590536dbb12d154368398c96c2cd8f8d3c');
  assert.equal(anchorIncrementPolicy(name2), '493d9ca9e83393f6923226555db094c31c16d7a6298d436dc6c686d85a87f452');
});

// ── 2) البتاتُ المحجوزةُ (بلا محاكٍ): الفاحصُ يُسمّيها لا أن يغفلَها (SOL-05). ──
test('static: فاحصُ السماتِ يُعلِنُ مخالفةَ البتاتِ المحجوزةِ 8-9 و20-24', () => {
  const base = anchorAttributeViolations(0x02040018); // شكلُ المرساةِ سليمٌ
  assert.deepEqual(base, []);
  for (const bit of [8, 9, 20, 21, 22, 23, 24]) {
    const v = anchorAttributeViolations(0x02040018 | (1 << bit));
    assert.ok(v.includes(`RESERVED_BIT_${bit}=1`), `bit ${bit}: ${JSON.stringify(v)}`);
  }
});

// ── 3) المشغّلُ يتحقّقُ من سياقِ تشغيلِ المحاكي عبرَ ملفِّ PID (بلا محاكٍ للحالاتِ الرافضةِ). ──
test('pwsh: المشغّلُ يرفضُ ملفَّ PID غائبًا أو منتحلًا (ليسَ swtpm) قبلَ أيِّ اتصال', () => {
  const absent = rehearseOn({ port: 2400 }, ['-SimPidFile', '/nonexistent/wl413.pid']);
  assert.equal(absent.rc, 4);
  assert.match(absent.stdout, /TOOL_ERROR/);
  assert.match(absent.stdout, /simulator pid file absent/);
  const fake = mkdtempSync(join(tmpdir(), 'xuux-wl413-fakepid-'));
  try {
    writeFileSync(join(fake, 'pid'), String(process.pid)); // عمليةُ Node ليست swtpm
    const forged = rehearseOn({ port: 2400 }, ['-SimPidFile', join(fake, 'pid')]);
    assert.equal(forged.rc, 4);
    assert.match(forged.stdout, /simulator context mismatch/);
  } finally { rmSync(fake, { recursive: true, force: true }); }
});

// ── 4) التشغيلُ النظيفُ والرموزُ السلبيّةُ المحدَّدةُ على محاكٍ معزول (إثباتُ رجوعٍ لا انحدار). ──
simPwshTest('sim: تشغيلٌ نظيفٌ على محاكٍ معزول ⇒ COMPLETE، بلا بقايا، ورموزُ الرفضِ السلبيّةِ محدَّدةٌ', () => {
  const s = startSim();
  try {
    const run = rehearseOn(s, ['-SimPidFile', s.pidFile]);
    assert.equal(run.rc, 0, run.stderr || run.stdout.slice(0, 2000));
    const report = JSON.parse(run.stdout);
    assert.equal(report.status, 'COMPLETE');
    assert.deepEqual(report.cleanupLeftovers, []);
    assert.deepEqual(report.reconciliation, []);
    assert.equal(report.facts['tpm.manufacturer'], 'IBM');
    const steps = Object.fromEntries(report.steps.map((x) => [x.name, x]));
    // رموزُ الرفضِ المقيسةُ على swtpm — كلُّ حالةٍ سلبيّةٍ برمزِها تحديدًا لا بأيِّ خطأٍ عامٍّ.
    assert.equal(steps['s1.probe:NV_Read(before-first-increment)'].responseCode, '0x0000014a');
    assert.equal(steps['s1.probe:NV_ReadPublic(after-undefine)'].responseCode, '0x0000018b');
    assert.equal(steps['s2v:NV_Increment(password-auth)'].responseCode, '0x0000012f');
    assert.equal(steps['s2v.replay:PolicySigned(old-signature)'].responseCode, '0x000005db');
    assert.equal(steps['s2v.foreign:PolicySigned(foreign-signature)'].responseCode, '0x000005db');
    assert.equal(steps['s2v.otherkey:NV_Increment(policy-of-other-key)'].responseCode, '0x0000099d');
    assert.equal(steps['s2v.wrongcc:NV_Increment(policy-for-NV_Read)'].responseCode, '0x0000099d');
    // القيمةُ لم تتغيّر بعدَ المساراتِ المرفوضةِ، والزيادةُ الشرعيّةُ وحدها قدّمَت العدّادَ.
    assert.equal(report.facts['s2v.anchorShape.valueAfterRejectedPaths'], report.facts['s2v.anchorShape.value1']);
    for (const st of report.steps) assert.ok(['ok', 'rejected-as-expected'].includes(st.outcome), JSON.stringify(st));
  } finally { stopSim(s); }
});

// ── 5) الردُّ المشوَّهُ: وسمٌ غيرُ صالحٍ (SOL-01). ──
simPwshTest('sim: وسمُّ ردٍّ مشوَّهٌ ⇒ FAILED_CLOSED برمزٍ مسمّى ولا أثرَ على المحاكي', () => {
  const s = startSim();
  try {
    const res = fault(s, 'invalid-tag');
    const r = res.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /RESPONSE_TAG_MISMATCH: expected=0x8001 got=0x1234/);
    assert.deepEqual(r.cleanupLeftovers, []);
    assert.deepEqual(sortedDiff(res.nvBefore, res.nvAfter), []);
    assert.deepEqual(sortedDiff(res.sessionsBefore, res.sessionsAfter), []);
  } finally { stopSim(s); }
});

// ── 6) الردُّ المشوَّهُ: حذفُ منطقةِ تفويضِ الردِّ (SOL-01) — أمرٌ مُغيِّرٌ فالأثرُ مجهولٌ يُجرد. ──
simPwshTest('sim: حذفُ منطقةِ تفويضِ الردِّ ⇒ فشلٌ مغلقٌ مسمّى وجردُ مصالحةٍ يُثبتُ التنفيذَ والملكيّةَ', () => {
  const s = startSim();
  try {
    const res = fault(s, 'missing-response-auth');
    const r = res.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace/);
    assert.match(r.failure, /RESPONSE_AUTH_AREA_MALFORMED/);
    // الجردُ يُثبتُ: عُرِّفَ الفهرسُ وملكيّتُهُ مثبتةٌ بمطابقةِ المنطقةِ العامّةِ، والحذفُ وقعَ وتحقّقَ غيابُه.
    assert.ok(r.reconciliation.some((x) => x.includes('nv-define') && x.includes('executed; ownership proven by publicArea match')), JSON.stringify(r.reconciliation));
    assert.ok(r.reconciliation.some((x) => x.includes('nv-undefine') && x.includes('verified absent')), JSON.stringify(r.reconciliation));
    assert.deepEqual(sortedDiff(res.nvBefore, res.nvAfter), []);
  } finally { stopSim(s); }
});

// ── 7) فقدُ ردِّ التعريفِ بعدَ التنفيذِ (SOL-02 — النتيجةُ الأولى): الأثرُ وقعَ فيُكتشفُ ويُملَكُ ويُحذَف. ──
simPwshTest('sim: فقدُ ردِّ NV_DefineSpace بعدَ التنفيذِ ⇒ مجهولٌ يُجردُ: التنفيذُ مثبتٌ والملكيّةُ مثبتةٌ والفهرسُ يُحذَفُ', () => {
  const s = startSim();
  try {
    const res = fault(s, 'define-response-loss');
    const r = res.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace/);
    assert.match(r.failure, /WL413_RESPONSE_LOSS_AFTER_DEFINE_EXECUTION/);
    assert.ok(r.reconciliation.some((x) => x.includes('nv-define') && x.includes('executed; ownership proven by publicArea match')), JSON.stringify(r.reconciliation));
    // لا فهرسَ يبقى على المحاكي ولا بقايَا معلنةً — التقريرُ لا يدّعي نجاحًا (الحالةُ مغلفةٌ بفشلٍ).
    assert.deepEqual(sortedDiff(res.nvBefore, res.nvAfter), []);
    assert.deepEqual(r.cleanupLeftovers.filter((x) => x.startsWith('nv ')), []);
  } finally { stopSim(s); }
});

// ── 8) فقدُ ردِّ التعريفِ قبلَ التنفيذِ (SOL-02 — النتيجةُ الثانية): الغيابُ يتحقّقُ قرائيًّا. ──
simPwshTest('sim: فقدُ ردِّ NV_DefineSpace قبلَ التنفيذِ ⇒ مجهولٌ يُجردُ: الغيابُ محقَّقٌ ولا أثرَ', () => {
  const s = startSim();
  try {
    const res = fault(s, 'define-not-executed');
    const r = res.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace/);
    assert.match(r.failure, /WL413_DEFINE_DROPPED_BEFORE_EXECUTION/);
    assert.ok(r.reconciliation.some((x) => x.includes('nv-define') && x.includes('not-executed (verified absent by read-only inventory)')), JSON.stringify(r.reconciliation));
    assert.deepEqual(sortedDiff(res.nvBefore, res.nvAfter), []);
    assert.deepEqual(r.cleanupLeftovers, []);
  } finally { stopSim(s); }
});

// ── 9) رفضُ تحريرِ الجلسةِ المستمرُّ (SOL-03): المقبضُ المعروفُ معلَنٌ والجلسةُ مرصودةٌ على المحاكي. ──
simPwshTest('sim: رفضُ FlushContext المستمرُّ ⇒ الجلسةُ معلَنةٌ في البقايا بمقبضِها وتبقى على المحاكي', () => {
  const s = startSim();
  try {
    const res = fault(s, 'flush-refusal');
    const r = res.report;
    assert.equal(r.status, 'BLOCKED_FAIL_CLOSED');
    assert.match(r.failure, /BLOCKED_FAIL_CLOSED: s2\.trial:FlushContext rc=0x80280400/);
    const sessionLeftovers = r.cleanupLeftovers.filter((x) => x.startsWith('transient 0x03'));
    assert.ok(sessionLeftovers.length >= 1, JSON.stringify(r.cleanupLeftovers));
    assert.ok(sessionLeftovers.every((x) => x.includes('BLOCKED_FAIL_CLOSED: cleanup:FlushContext')));
    // الدليلُ على المحاكي: الجلسةُ ما زالت محمّلةً بعدَ التشغيلِ — لا يُخفيها التقريرُ.
    assert.ok(sortedDiff(res.sessionsBefore, res.sessionsAfter).some((h) => h.startsWith('0x03')), JSON.stringify(res.sessionsAfter));
  } finally { stopSim(s); }
});

// ── 10) الرمزُ العامُّ مكانَ الرفضِ المقصودِ (SOL-04): يُرفضُ الاختبارُ لا أن يُقبَل. ──
simPwshTest('sim: رمزٌ عامٌّ (0x101) مكانَ رفضِ إعادةِ التوقيعِ ⇒ NEGATIVE_WRONG_RC لا قبولًا', () => {
  const s = startSim();
  try {
    const res = fault(s, 'unexpected-negative');
    const r = res.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /NEGATIVE_WRONG_RC: s2v\.replay:PolicySigned\(old-signature\) expected=0x000005db got=0x00000101/);
    assert.deepEqual(sortedDiff(res.nvBefore, res.nvAfter), []);
  } finally { stopSim(s); }
});

// ── 11) حجبُ الحذفِ المستمرُّ (SOL-06/G47-2): البقيّةُ معلَنةٌ والفهرسُ باقٍ على المحاكي دليلًا. ──
simPwshTest('sim: حجبُ NV_UndefineSpace الدائمُ ⇒ البقيّةُ معلَنةٌ والفهرسُ يبقى مرصودًا على المحاكي', () => {
  const s = startSim();
  try {
    const res = fault(s, 'blocked-forever-undefine');
    const r = res.report;
    assert.equal(r.status, 'BLOCKED_FAIL_CLOSED');
    assert.match(r.failure, /BLOCKED_FAIL_CLOSED: s1\.probe:NV_UndefineSpace rc=0x80280400/);
    assert.ok(r.cleanupLeftovers.some((x) => x.startsWith('nv ') && x.includes('BLOCKED_FAIL_CLOSED: cleanup:NV_UndefineSpace')), JSON.stringify(r.cleanupLeftovers));
    // الدليلُ على المحاكي: الفهرسُ الذي أنشأته الجولةُ ما زال موجودًا — لا يُدّعى حذفُهُ.
    const created = sortedDiff(res.nvBefore, res.nvAfter);
    assert.equal(created.length, 1, JSON.stringify(created));
  } finally { stopSim(s); }
});

// ── 12) الهويّةُ الكاملةُ (G47-1): ثلاثُ تحريفاتٍ تُرفضُ قبلَ أيِّ أمرٍ مُغيِّر. ──
simPwshTest('sim: سلاسلُ بائعٍ زائدةٌ (EVIL/XXXX) وطيُّ مسافاتٍ وخاصيّةٌ ناقصةٌ ⇒ رفضُ الهويّةِ', () => {
  const s = startSim();
  try {
    for (const [mode, pattern] of [
      ['identity-string34', /SIMULATOR_IDENTITY_REQUIRED: manufacturer=IBM vendor=0x53572020,0x2054504d,0x4556494c,0x58585858/],
      ['identity-spacefold', /SIMULATOR_IDENTITY_REQUIRED: manufacturer=IBM vendor=0x53205720,0x5420504d,0x00000000,0x00000000/],
      ['identity-missing-prop', /SIMULATOR_IDENTITY_INCOMPLETE: properties=4/],
    ]) {
      const res = fault(s, mode);
      const r = res.report;
      assert.equal(r.status, 'FAILED_CLOSED', mode);
      assert.match(r.failure, pattern, mode);
      // لا أمرَ مُغيِّرًا بعدَ رفضِ الهويّةِ، ولا أثرَ على المحاكي.
      assert.deepEqual(sortedDiff(res.nvBefore, res.nvAfter), [], mode);
      assert.deepEqual(sortedDiff(res.sessionsBefore, res.sessionsAfter), [], mode);
      assert.ok(r.steps.every((st) => st.name.startsWith('identity:')), mode);
    }
  } finally { stopSim(s); }
});

function sortedDiff(before, after) {
  const b = new Set(before);
  return [...after].filter((h) => !b.has(h)).sort();
}
