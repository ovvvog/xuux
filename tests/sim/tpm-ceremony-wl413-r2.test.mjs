// @ts-nocheck
// tests/sim/tpm-ceremony-wl413-r2.test.mjs
//
// WL-413 الدفعة الثانية — عيوبٌ اكتُشفت بإعادةِ الفحصِ المستقلِّ على 42c0050a (بعدَ إصلاحِ الدفعةِ الأولى)،
// ولم تُغطِّها حزمةُ مراجعةِ WL-412. لكلِّ عيبٍ إعادةُ إنتاجٍ قبلَ الإصلاحِ (موثّقةٌ في حزمةِ المراجعةِ
// adr0007-ceremony-wl413-remediation-review/evidence/r2-baseline) واختبارُ رجوعٍ هنا:
//   R2-01 فهرسٌ عُرِّفَ ثمّ ضاعَ ردُّه ثمّ كتبَه طرفٌ آخرُ (WRITTEN=1): كانت المصالحةُ تعلنُ «الملكيّةَ مُثبَتةً»
//         وتحذفُه. الآن: غيرُ محسومِ الملكيّة، يُتركُ ويُعلَن، والجردُ النهائيُّ يُثبتُ بقاءَه.
//   R2-02 زيادةٌ سلبيّةٌ (يُتوقَّعُ رفضُها) ضاعَ ردُّها: لم تكن مقيّدةً في دفترِ الموارد، فلا يذكرُ التقريرُ
//         أثرَها. الآن: تُجرَدُ قيمةُ العدّادِ قرائيًّا.
//   R2-03 بايتاتٌ زائدةٌ أو بنيةٌ داخليّةٌ خاطئةٌ في معاملاتِ ردٍّ ناجحٍ (الحجمُ الكلّيُّ متّسق): كانت تُقبَلُ
//         والحالةُ COMPLETE. الآن: مخطّطٌ لكلِّ أمرٍ — فشلٌ مغلقٌ مسمّى؛ ولأمرٍ مُغيِّرٍ ⇒ نتيجةٌ مجهولةٌ تُجرَد.
//   R2-04 التقريرُ قد يعلنُ بقيّةً ثبتَ غيابُها أو يغفلُ مقبضًا باقيًا: الآن جردٌ قرائيٌّ نهائيٌّ مقابلَ خطِّ
//         الأساسِ هو المرجعُ (postRunInventory)؛ وتعذُّرُه (نقلٌ مقطوع) ⇒ الحالةُ المتبقّيةُ مجهولةٌ معلَنة.
//   R2-05 وسيطٌ (proxy) على loopback يمرّرُ إلى أيِّ نقلٍ: كانت البروفةُ تكتملُ عبرَه حتّى مع ملفِّ PID لـswtpm
//         حقيقيّ. الآن: مالكُ مقبسِ الاستماعِ يُحدَّدُ من جدولِ مقابسِ النظامِ ويجبُ أن يكونَ swtpm نفسَه.
// كلُّ اختبارٍ يشغّلُ محاكيَه الخاصَّ (حالةٌ ومنافذُ معزولة). لا TBS، ولا /dev/tpm*، ولا عتاد.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = join(root, 'tests/helpers/tpm-ceremony-harness.ps1');
const runner = join(root, 'sim/tpm-ceremony/rehearse.ps1');

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const sim = isSimEnabled();
const simPwshTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : (!pwshAvailable ? 'pwsh unavailable' : false) }, fn);

const STATE_CHANGING = new Set(['0x0000012a', '0x00000134', '0x00000122', '0x00000131', '0x00000153', '0x00000157', '0x00000176', '0x00000160', '0x0000016c', '0x00000165']);

function startSim(bindaddr = '127.0.0.1') {
  for (let attempt = 0; attempt < 8; attempt++) {
    const dir = mkdtempSync(join(tmpdir(), 'xuux-wl413r2-'));
    const port = 2700 + 2 * Math.floor(Math.random() * 150);
    const pidFile = join(dir, 'swtpm.pid');
    const r = spawnSync('swtpm', ['socket', '--tpm2',
      '--tpmstate', `dir=${dir}`, '--server', `type=tcp,port=${port},bindaddr=${bindaddr}`,
      '--ctrl', `type=tcp,port=${port + 1},bindaddr=127.0.0.1`, '--flags', 'not-need-init,startup-clear',
      '--pid', `file=${pidFile}`, '--daemon'], { encoding: 'utf8' });
    if (r.status !== 0) { rmSync(dir, { recursive: true, force: true }); continue; }
    let ready = false;
    for (let i = 0; i < 10; i++) {
      try {
        execFileSync('tpm2_getcap', ['--tcti=swtpm:host=127.0.0.1,port=' + port, 'properties-fixed'], { stdio: 'ignore' });
        ready = true; break;
      } catch { /* لم يجهز بعد */ }
      execFileSync('sleep', ['1']);
    }
    if (!ready || !existsSync(pidFile)) { rmSync(dir, { recursive: true, force: true }); continue; }
    return { dir, port, pidFile, pid: Number(readFileSync(pidFile, 'utf8').trim()) };
  }
  throw new Error('WL-413/R2: تعذّرَ تشغيلُ محاكٍ معزول');
}

function stopSim(s) {
  try { process.kill(s.pid, 'SIGTERM'); } catch { /* انتهى */ }
  try { rmSync(s.dir, { recursive: true, force: true }); } catch { /* أفضلُ جهد */ }
}

function fault(s, mode) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness,
    '-Mode', 'fault', '-SimPort', String(s.port), '-Fault', mode], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

function rehearse(port, extra = [], stages = 'ALL') {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', runner, '-SimHost', '127.0.0.1',
    '-SimPort', String(port), '-Stages', stages, ...extra], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return { rc: r.status, stdout: r.stdout, stderr: r.stderr };
}

const list = (x) => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** بعدَ الفشلِ لا يُرسَلُ أمرٌ مُغيِّرٌ من مرحلةٍ لاحقةٍ: ما بعدَ خطوةِ الفشلِ مصالحةٌ/تنظيفٌ/جردٌ نهائيٌّ فقط. */
function assertNoLaterStage(report, failedStepName) {
  const i = report.steps.findIndex((x) => x.name === failedStepName);
  assert.ok(i >= 0, 'failed step recorded: ' + failedStepName);
  for (const st of report.steps.slice(i + 1)) {
    assert.ok(['reconcile', 'cleanup', 'post-run'].includes(st.stage), `step after failure in stage ${st.stage}: ${st.name}`);
    if (st.stage !== 'cleanup') assert.ok(!STATE_CHANGING.has(st.commandCode), `state-changing in ${st.stage}: ${st.name}`);
  }
}

// ── R2-01 ──
simPwshTest('R2-01: فهرسٌ كتبَه طرفٌ آخرُ بعدَ ضياعِ ردِّ التعريف ⇒ غيرُ محسومِ الملكيّة، لا يُحذَف، ويُعلَن', () => {
  const s = startSim();
  try {
    const o = fault(s, 'written-before-reconcile');
    const r = o.report;
    const h = o.fault.definedHandle;
    assert.equal(o.fault.thirdPartyRc, '0x00000000', 'the simulated third-party write really happened');
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace/);
    assert.ok(list(r.reconciliation).some((x) => x.startsWith('nv-define ' + h) && /TPMA_NV_WRITTEN is set/.test(x)), JSON.stringify(r.reconciliation));
    assert.ok(!list(r.reconciliation).some((x) => /ownership proven/.test(x)), 'ownership must not be claimed');
    assert.ok(list(r.cleanupLeftovers).some((x) => x.startsWith('nv ' + h) && /ownership-undetermined/.test(x)));
    assert.ok(!r.steps.some((x) => x.commandCode === '0x00000122'), 'no NV_UndefineSpace sent for an index of undetermined ownership');
    assert.equal(r.postRunInventory.verified, true);
    assert.deepEqual(list(r.postRunInventory.residualNv), [h]);
    assert.ok(list(o.nvAfter).includes(h), 'index remains on the simulator as evidence');
    assertNoLaterStage(r, 's1.probe:NV_DefineSpace');
  } finally { stopSim(s); }
});

// ── R2-02 ──
simPwshTest('R2-02: زيادةٌ سلبيّةٌ ضاعَ ردُّها ⇒ تُجرَدُ قيمةُ العدّاد (لم تُنفَّذ) ولا تبقى صامتة', () => {
  const s = startSim();
  try {
    const o = fault(s, 'neg-increment-loss');
    const r = o.report;
    assert.equal(o.fault.changes, 1);
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s2v:NV_Increment\(password-auth\)/);
    assert.ok(list(r.reconciliation).some((x) => /^nv-increment 0x01[0-9a-f]{6}: not-executed \(counter still uninitialized\)$/.test(x)), JSON.stringify(r.reconciliation));
    assert.deepEqual(list(r.cleanupLeftovers), []);
    assert.equal(r.postRunInventory.verified, true);
    assert.deepEqual(list(r.postRunInventory.residualNv), []);
    assert.deepEqual(list(r.postRunInventory.residualSessions), []);
    assert.deepEqual(list(r.postRunInventory.residualTransients), []);
    assert.deepEqual(list(o.nvAfter), list(o.nvBefore));
    assertNoLaterStage(r, 's2v:NV_Increment(password-auth)');
  } finally { stopSim(s); }
});

// ── R2-03 ──
simPwshTest('R2-03a: بايتاتٌ زائدةٌ في معاملاتِ ردِّ NV_ReadPublic ⇒ فشلٌ مغلقٌ مسمّى، والبقيّةُ معلَنةٌ ومثبتةٌ بالجرد', () => {
  const s = startSim();
  try {
    const o = fault(s, 'trailing-readpublic');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^RESPONSE_PARAMS_TRAILING_BYTES: NV_ReadPublic extra=3/);
    assert.ok(!r.steps.some((x) => x.stage === 'S2' || x.stage === 'S2-validate'), 'ceremony did not proceed to S2');
    // كلُّ ردِّ ReadPublic مشوَّهٌ ⇒ فحصُ الملكيّةِ قبلَ الحذفِ متعذّرٌ ⇒ لا حذفَ، والفهرسُ معلَنٌ ومرصود.
    assert.equal(r.postRunInventory.verified, true);
    const residual = list(r.postRunInventory.residualNv);
    assert.equal(residual.length, 1);
    assert.ok(list(r.cleanupLeftovers).some((x) => x.includes(residual[0])));
    assert.ok(list(o.nvAfter).includes(residual[0]));
  } finally { stopSim(s); }
});

simPwshTest('R2-03b: معاملاتٌ غيرُ فارغةٍ في ردِّ نجاحِ NV_DefineSpace ⇒ نتيجةٌ مجهولةٌ تُجرَدُ ثمَّ تُتركُ بملكيّةِ غيرِ قابلةِ للإثباتِ', () => {
  const s = startSim();
  try {
    const o = fault(s, 'define-params-extra');
    const r = o.report;
    const h = o.fault.definedHandle;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace .*RESPONSE_PARAMS_TRAILING_BYTES: empty-params/);
    // قرار المراجع G47-413-1 (WL-413 R3): ردٌّ غيرُ قابلِ للاستخدامِ ⇒ لا حذفَ ولو طابقتُ المنطقةُ العامّةُ: يُتركُ ويُعلَن.
    assert.ok(list(r.reconciliation).some((x) => x.startsWith('nv-define ' + h) && x.includes('the define reply was lost or unusable so execution and ownership cannot be proven')), JSON.stringify(r.reconciliation));
    assert.ok(!list(r.reconciliation).some((x) => /ownership proven/.test(x)));
    assert.ok(list(r.cleanupLeftovers).some((x) => x === 'nv ' + h + ': ownership-undetermined (define reply lost; matching publicArea is not proof); left in place'), JSON.stringify(r.cleanupLeftovers));
    assert.equal(r.postRunInventory.verified, true);
    assert.deepEqual(list(r.postRunInventory.residualNv), [h]);
    assert.ok(list(o.nvAfter).includes(h));
    assertNoLaterStage(r, 's1.probe:NV_DefineSpace');
  } finally { stopSim(s); }
});

simPwshTest('R2-03c: ردُّ GetCapability بقدرةٍ غيرِ المسؤولِ عنها ⇒ فشلٌ قبلَ أيِّ أمرٍ مُغيِّر', () => {
  const s = startSim();
  try {
    const o = fault(s, 'getcap-wrong-cap');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^RESPONSE_CAPABILITY_MISMATCH: asked=0x00000006 got=0x00000001/);
    assert.equal(r.steps.length, 1);
    assert.ok(!r.steps.some((x) => STATE_CHANGING.has(x.commandCode)));
    assert.equal(r.postRunInventory.verified, false, 'no baseline taken ⇒ no clean claim');
    assert.match(r.postRunInventory.error, /no baseline/);
  } finally { stopSim(s); }
});

simPwshTest('R2-03d: اسمٌ قصيرٌ في ردِّ Load ⇒ نتيجةٌ مجهولةٌ؛ الكائنُ العابرُ الظاهرُ غيرُ محسومٍ ويُعلَن', () => {
  const s = startSim();
  try {
    const o = fault(s, 'load-name-short');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s2:Load\(service-key\) .*RESPONSE_NAME_MALFORMED: Load len=2/);
    assert.ok(list(r.reconciliation).some((x) => /^object-create 0x80[0-9a-f]{6}: appeared during run; ownership not provable; left in place$/.test(x)), JSON.stringify(r.reconciliation));
    const tr = list(r.postRunInventory.residualTransients);
    assert.equal(tr.length, 1, 'exactly the unprovable transient remains (primary was flushed)');
    assert.ok(list(r.cleanupLeftovers).some((x) => x.includes(tr[0]) && /ownership-undetermined/.test(x)));
    assertNoLaterStage(r, 's2:Load(service-key)');
  } finally { stopSim(s); }
});

// ── R2-04 ──
simPwshTest('R2-04: نقلٌ ماتَ بعدَ تنفيذِ التعريف ⇒ لا ادّعاءَ نظافة: الحالةُ المتبقّيةُ مجهولةٌ معلَنة، والفهرسُ باقٍ فعلًا', () => {
  const s = startSim();
  try {
    const o = fault(s, 'transport-dead-after-define');
    const r = o.report;
    const h = o.fault.definedHandle;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace/);
    assert.equal(r.postRunInventory.verified, false);
    assert.ok(list(r.cleanupLeftovers).some((x) => /^reconcile nv-define 0x01[0-9a-f]{6} unverifiable/.test(x)), JSON.stringify(r.cleanupLeftovers));
    assert.ok(list(r.cleanupLeftovers).some((x) => /^post-run inventory unavailable: residual state unknown/.test(x)));
    assert.ok(list(o.nvAfter).includes(h), 'the index really remains on the simulator (seen over an independent connection)');
  } finally { stopSim(s); }
});

simPwshTest('R2-04: تشغيلٌ نظيفٌ يحملُ جردًا نهائيًّا مُتحقَّقًا فارغًا', () => {
  const s = startSim();
  try {
    const run = rehearse(s.port, ['-SimPidFile', s.pidFile]);
    assert.equal(run.rc, 0, run.stdout.slice(0, 1500));
    const r = JSON.parse(run.stdout);
    assert.equal(r.status, 'COMPLETE');
    assert.equal(r.postRunInventory.verified, true);
    assert.deepEqual([...list(r.postRunInventory.residualNv), ...list(r.postRunInventory.residualSessions), ...list(r.postRunInventory.residualTransients)], []);
    assert.ok(r.steps.filter((x) => x.stage === 'post-run').every((x) => !STATE_CHANGING.has(x.commandCode)));
    assert.equal(r.facts['transport.listener.before'], `pid=${s.pid} comm=swtpm`);
    assert.equal(r.facts['transport.listener.after'], r.facts['transport.listener.before']);
  } finally { stopSim(s); }
});

// ── R2-05 ──
function startProxy(target) {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-wl413r2-proxy-'));
  const log = join(dir, 'bytes');
  writeFileSync(log, '0');
  const port = 3100 + Math.floor(Math.random() * 400);
  const src = `const net=require('net');const fs=require('fs');let n=0;net.createServer(c=>{const s=net.connect(${target},'127.0.0.1');c.on('data',d=>{n+=d.length;fs.writeFileSync(${JSON.stringify(log)},String(n));s.write(d)});s.pipe(c);c.on('close',()=>s.destroy())}).listen(${port},'127.0.0.1',()=>console.log('ready'))`;
  const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve) => child.stdout.once('data', () => resolve({ child, port, dir, bytes: () => Number(readFileSync(log, 'utf8')) })));
}

simPwshTest('R2-05: وسيطٌ على loopback يُرفَضُ قبلَ أيِّ أمرٍ — بلا ملفِّ PID ومع ملفِّ PID لـswtpm الحقيقيّ', async () => {
  const s = startSim();
  const p = await startProxy(s.port);
  try {
    for (const extra of [[], ['-SimPidFile', s.pidFile]]) {
      const run = rehearse(p.port, extra, 'S1');
      assert.equal(run.rc, 4, run.stdout);
      const r = JSON.parse(run.stdout);
      assert.equal(r.status, 'TOOL_ERROR');
      assert.match(r.failure, /^simulator context mismatch: SIMULATOR_LISTENER_NOT_SWTPM: (node|MainThread)/);
    }
    assert.equal(p.bytes(), 0, 'not a single byte reached the non-simulator listener');
  } finally { p.child.kill(); rmSync(p.dir, { recursive: true, force: true }); stopSim(s); }
});

simPwshTest('R2-05: ملفُّ PID لعمليةٍ أخرى ⇒ PID_MISMATCH؛ مستمعٌ غيرُ loopback ⇒ NOT_LOOPBACK', () => {
  const s = startSim();
  const fake = mkdtempSync(join(tmpdir(), 'xuux-wl413r2-pid-'));
  try {
    writeFileSync(join(fake, 'pid'), String(process.pid));
    const run = rehearse(s.port, ['-SimPidFile', join(fake, 'pid')], 'S1');
    assert.equal(run.rc, 4);
    assert.match(JSON.parse(run.stdout).failure, new RegExp(`SIMULATOR_LISTENER_PID_MISMATCH: listener=${s.pid} pidfile=${process.pid}`));
  } finally { rmSync(fake, { recursive: true, force: true }); stopSim(s); }
  const wide = startSim('0.0.0.0');
  try {
    const run = rehearse(wide.port, ['-SimPidFile', wide.pidFile], 'S1');
    assert.equal(run.rc, 4);
    assert.match(JSON.parse(run.stdout).failure, /SIMULATOR_LISTENER_NOT_LOOPBACK: 00000000/);
    const nv = execFileSync('tpm2_getcap', ['--tcti=swtpm:host=127.0.0.1,port=' + wide.port, 'handles-nv-index'], { encoding: 'utf8' });
    assert.doesNotMatch(nv, /0x1/, 'no command reached the wide-bound simulator');
  } finally { stopSim(wide); }
});

simPwshTest('R2-05: منفذٌ بلا مستمعٍ ⇒ SIMULATOR_LISTENER_ABSENT (لا اتصالَ ولا افتراض)', () => {
  const run = rehearse(2299, [], 'S1');
  assert.equal(run.rc, 4);
  assert.match(JSON.parse(run.stdout).failure, /SIMULATOR_LISTENER_ABSENT/);
});
