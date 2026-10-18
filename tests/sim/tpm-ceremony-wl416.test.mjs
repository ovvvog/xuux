// @ts-nocheck
// tests/sim/tpm-ceremony-wl416.test.mjs
//
// WL-416 — إغلاقُ ثغراتِ متابعةِ المراجعةِ المستقلّةِ على e23bd431 (قرارا المالكِ + FUP-SOL-03 + سياقُ الردّ).
//   (أ) دورةُ حياةِ startSim: غيابُ ملفِ PID ليسَ برهانَ توقّفٍ؛ استثناءُ probe/onAbandon لا يتجاوزُ التنظيفَ؛
//        الحذفَ بعدَ إثباتِ الزوالِ حدَّه؛ الهويّةُ مربوطةٌ بمسارِ الحالةِ من سطرِ الأوامرِ؛ لا قتلَ لعمليّةٍ
//        لا تُثبَتُ ملكيّتُها؛ والتوقّفُ لا يُعلَنُ بلا قرينةٍ.
//   (ب) دورةُ حياةِ سياقِ الردّ (ResponseContext): إزالةٌ مسمّاةٌ عندَ إثباتِ انتهاءِ العمرِ (تحريرٌ مؤكَّدٌ،
//        غيابٌ مُثبَتٌ بجردٍ قرائيّ، استهلاكُ جلسةِ السياسةِ)؛ لا وراثةَ لمقابضَ أُعيدَ استخدامُها؛ والسياقُ
//        المفقودُ لا يتحوّلُ قبولًا افتراضيًّا (رفضٌ مسمّى: RESPONSE_CREATION_PARENT_UNKNOWN للفحصِ وRESPONSE_POLICY_CONTEXT_UNKNOWN لفحوصِ الجلساتِ).
//   (ج) قرارُ المالكِ (more=0): الإبقاءُ على السلوكِ الحاليّ مع توثيقِ حدِّهِ — الردُّ الصحيحُ البنيةِ الذي
//        يُعلنُ more=0 نهايةُ جردٍ بحسبِ العقدِ لا برهانَ خلوٍّ: فهرسٌ حقيقيٌّ يُحجبُ من الصفحاتِ والبروفةُ
//        تكتملُ، والجردُ المباشرُ يُثبتُ وجودَهُ بعدَها.
//   (د) حاجزُ إرهاقِ فهارسِ NV (قرارُ المالكِ المحافِظ): فهرسٌ واحدٌ داخلَ مجالِ المالكِ لا يمكنُ إثباتُ
//        أنّ هذه البروفةَ أنشأتهُ ⇒ إيقافٌ مسمّى قبلَ أيِّ أمرٍ مُغيِّرٍ، بلا حذفٍ، سواءٌ وُجدَ قبلَ خطِّ
//        الأساسِ أو ظهرَ بعدَهُ.
// كلُّ اختبارٍ يشغّلُ محاكيَه الخاصَّ. لا TBS، ولا /dev/tpm*، ولا عتاد.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  startSim as startSimShared,
  stopSim,
  killSim,
  discoverSimPids,
  stateDirExists,
} from '../helpers/ceremony-swtpm.mjs';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = join(root, 'tests/helpers/tpm-ceremony-harness.ps1');

const pwshAvailable =
  spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const sim = isSimEnabled();
const simTest = (name, fn) => test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);
const simPwshTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : (!pwshAvailable ? 'pwsh unavailable' : false) }, fn);

function startSim() {
  return startSimShared({ prefix: 'xuux-wl416-', portBase: 3300, label: 'WL-416' });
}

function harnessRun(s, args) {
  const r = spawnSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-File', harness, '-SimPort', String(s.port), ...args],
    { encoding: 'utf8', maxBuffer: 64 << 20 },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

const fault = (s, mode) => harnessRun(s, ['-Mode', 'fault', '-Fault', mode]);

// كلُّ اختبارٍ يملكُ محاكيَه وينهيهِ في finally — وفشلُ الإيقافِ يُفشلُ الاختبارَ بعدَ نجاحِ الجسمِ (لا يُبتلَعُ).
function withSim(fn) {
  const s = startSim();
  let ok = false;
  try {
    fn(s);
    ok = true;
  } finally {
    const st = stopSim(s);
    if (ok) assert.equal(st, true, 'stopSim must prove termination and remove the state dir');
  }
}

// ESRCH وحدها غيابٌ مؤكَّدٌ لرقمِ مقبضٍ معروفٍ: أيُّ خطأٍ آخر (EPERM مثلًا) حالةٌ مجهولةٌ لا دليلَ موتٍ.
// والزومبي (Z) منتهيةٌ فعليًا وإن بقي مدخلُها في /proc حتى يُلقَّ — «ميّتةٌ» لا «حيّةٌ».
function pidProvenDead(pid) {
  try {
    process.kill(pid, 0);
    return false; // العمليّةُ موجودةٌ: ليس دليلَ موتٍ — ESRCH وحدها الدليلُ المقبولُ (حسمُ المراجعةِ 3)
  } catch (e) {
    return e && e.code === 'ESRCH';
  }
}
const list = (x) => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);

// أوامرُ البروفةِ المُغيِّرةُ للحالةِ (مثلُ wl413-r3): لا يجوزُ ظهورُها قبلَ الفشلِ المسمّى.
const STATE_CHANGING = new Set([
  '0x0000012a', '0x00000134', '0x00000122', '0x00000131', '0x00000153',
  '0x00000157', '0x00000176', '0x00000160', '0x0000016c', '0x00000165',
]);

// عمليّةُ نومٍ بريئةٌ (node) تحملُ رقمًا في ملفِ PID: يجبُ ألّا تُقتَلَ عندَ التحقّقِ من هويّةِ المحاكي.
function spawnSleeper() {
  const p = spawn(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);'], {
    stdio: 'ignore',
    detached: true,
  });
  p.unref();
  return p.pid;
}

function pgrepSwtpmCount() {
  const r = spawnSync('pgrep', ['-c', '--', 'swtpm'], { encoding: 'utf8' });
  return Number(String(r.stdout || '').trim()) || 0;
}

// ── (أ) دورةُ حياةِ startSim ──

// L1: غيابُ ملفِ PID ليسَ برهانَ توقّفٍ — الاكتشافُ البديلُ يربطُ العمليّةَ بمسارِ الحالةِ ويُنهيها.
simTest('L1: فقدُ ملفِ PID بعدَ الإطلاقِ لا يُعلَنُ توقّفًا والاكتشافُ البديلُ يُنهي المحاكي', () => {
  const abandoned = [];
  let launchedPid = null;
  let threw = null;
  try {
    startSimShared({
      prefix: 'xuux-wl416-l1-',
      portBase: 3340,
      label: 'WL-416/L1',
      attempts: 1,
      probe: () => false,
      afterSpawn: ({ pid, pidFile }) => {
        launchedPid = pid; // المقبضُ يُقرأُ قبلَ الحذفِ: هويةٌ محفوظةٌ للتحققِ المستقلِّ
        unlinkSync(pidFile); // الملفُّ يختفي: الهويّةُ من /proc فقط
      },
      onAbandon: (a) => abandoned.push(a),
    });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, 'startSim must reject when readiness never succeeds');
  assert.equal(abandoned.length, 1, JSON.stringify(abandoned));
  const a = abandoned[0];
  assert.equal(a.reason, 'not-ready');
  assert.equal(a.stopped, true, 'discovery-bound termination must prove the stop');
  // تحقّقٌ مستقلٌّ عن آليةِ الاكتشافِ التي يُختبرُ سلوكُها: العمليّةُ المُطلَقةُ نفسُها زالت (ESRCH وحدَها).
  assert.ok(launchedPid !== null, 'afterSpawn must hand over the pid before the pid file is deleted');
  assert.ok(pidProvenDead(launchedPid), 'the launched swtpm must be provably dead (ESRCH only)');
  assert.equal(stateDirExists(a.dir), false, 'state dir removed only after proven termination');
});

// L2: استثناءُ probe لا يتجاوزُ التنظيفَ — المحاكي يُنهى ولا يتيمَ.
simTest('L2: رميُ probe بعدَ الإطلاقِ يمرُّ عبرَ التنظيفِ المضمونِ فلا يتيمَ', () => {
  const abandoned = [];
  let threw = null;
  try {
    startSimShared({
      prefix: 'xuux-wl416-l2-',
      portBase: 3360,
      label: 'WL-416/L2',
      attempts: 1,
      probe: () => {
        throw new Error('probe exploded (WL-416 test)');
      },
      onAbandon: (a) => abandoned.push(a),
    });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw);
  assert.match(String(threw.message), /probe exploded/);
  assert.equal(abandoned.length, 1, JSON.stringify(abandoned));
  assert.equal(abandoned[0].stopped, true);
  assert.equal(abandoned[0].reason, 'exception-after-launch');
  assert.equal(discoverSimPids(abandoned[0].dir).length, 0, 'no orphan despite probe throwing');
  assert.equal(stateDirExists(abandoned[0].dir), false);
});

// L3: رميُ onAbandon لا يتجاوزُ التنظيفَ — الإنهاءُ يكتملُ والخطأُ يظهرُ بعدهُ.
simTest('L3: رميُ onAbandon لا يمنعُ التنظيفَ ولا يُخفي فشلَهُ', () => {
  const abandoned = [];
  let threw = null;
  try {
    startSimShared({
      prefix: 'xuux-wl416-l3-',
      portBase: 3380,
      label: 'WL-416/L3',
      attempts: 1,
      probe: () => false,
      onAbandon: (a) => {
        abandoned.push(a);
        throw new Error('onAbandon exploded (WL-416 test)');
      },
    });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw);
  assert.match(String(threw.message), /onAbandon exploded/);
  assert.equal(abandoned.length, 1);
  assert.equal(abandoned[0].stopped, true, 'termination must complete before the monitor error surfaces');
  assert.equal(discoverSimPids(abandoned[0].dir).length, 0, 'no orphan despite onAbandon throwing');
  assert.equal(stateDirExists(abandoned[0].dir), false);
});

// L4: ترتيبُ زوالِ-العمليّةِ-قبلَ-الحذفِ: المراقبُ يرى العمليّةَ منتهيةً والمجلّدَ ما زالَ موجودًا.
simTest('L4: المجلّدُ لا يُحذفُ إلّا بعدَ زوالِ العمليّةِ (المراقبُ شاهدُ الترتيبِ)', () => {
  const observations = [];
  let threw = null;
  try {
    startSimShared({
      prefix: 'xuux-wl416-l4-',
      portBase: 3400,
      label: 'WL-416/L4',
      attempts: 1,
      probe: () => false,
      onAbandon: (a) => {
        observations.push({
          pid: a.pid,
          dirStillOnDisk: stateDirExists(a.dir),
          simGone: discoverSimPids(a.dir).length === 0,
        });
      },
    });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw);
  assert.equal(observations.length, 1);
  const o = observations[0];
  assert.equal(o.dirStillOnDisk, true, 'state dir must still exist when the monitor runs');
  assert.equal(o.simGone, true, 'the intended process must already be gone when the monitor runs');
  // pid الذي رآه المراقبُ (قُرئ قبلَ الإنهاءِ) لم يبقَ حيًّا — وESRCH وحدها الغيابُ المؤكَّدُ:
  assert.ok(pidProvenDead(o.pid), 'the launched swtpm pid must be provably dead (ESRCH only) before dir deletion');
});

// L5: فشلُ الإشارةِ (EPERM محقونٌ) ليسَ إثباتَ موتٍ: stopped=false صادقةٌ والمجلّدُ يُحفَظُ دليلًا.
simTest('L5a: فشلُ إرسالِ الإشارةِ يُعلَنُ فشلًا صادقًا ويُحفَظُ مجلّدُ الحالةِ ولا يُقتَلُ شىءٌ زورًا', () => {
  const abandoned = [];
  let threw = null;
  try {
    startSimShared({
      prefix: 'xuux-wl416-l5a-',
      portBase: 3420,
      label: 'WL-416/L5a',
      attempts: 1,
      probe: () => false,
      injectKillFailure: true,
      onAbandon: (a) => abandoned.push(a),
    });
  } catch (e) {
    threw = e;
  }
  // الحمايةُ تغطّي **جسمَ الاختبارِ كلَّهُ بعدَ الاستحواذِ** (كلَّ تأكيدٍ بما فيها threw وabandoned —
  // حسمُ الجولتَينِ 3 و4): فشلُ أيِّ تأكيدٍ لا يتجاوزُ التنظيفَ.
  try {
    assert.ok(threw);
    assert.match(String(threw.message), /not proven stopped/);
    assert.equal(abandoned.length, 1, JSON.stringify(abandoned));
    const a = abandoned[0];
    assert.equal(a.stopped, false, 'EPERM is not proof of death: stopped must stay false');
    assert.equal(stateDirExists(a.dir), true, 'state dir kept as evidence when death is unproven');
    assert.ok(discoverSimPids(a.dir).length >= 1, 'the unproven simulator must still be alive');
    assert.equal(killSim(a.pid, { dir: a.dir }), true);
    assert.equal(stateDirExists(a.dir), true, 'dir remains until the caller decides after honest report');
    assert.equal(stopSim({ pid: a.pid, dir: a.dir }), true);
    assert.equal(stateDirExists(a.dir), false);
  } finally {
    const a = abandoned[0];
    if (a && stateDirExists(a.dir) && discoverSimPids(a.dir).length > 0) {
      try { killSim(a.pid, { dir: a.dir }); } catch { /* زالت سلفًا */ }
    }
  }
});

// L5b: ملفُّ PID يشيرُ إلى عمليّةٍ بريئةٍ (نائمةٍ) — لا تُقتَلُ، والمحاكيُّ الحقيقيُّ يُنهى بالاكتشافِ.
simTest('L5b: ملفُّ PID مشوّشٌ نحوَ عمليّةٍ بريئةٍ لا يُقتلُها والاكتشافُ يُنهي الملكَ الحقيقيّ', () => {
  const sleeperPid = spawnSleeper();
  const abandoned = [];
  let threw = null;
  try {
    startSimShared({
      prefix: 'xuux-wl416-l5b-',
      portBase: 3440,
      label: 'WL-416/L5b',
      attempts: 1,
      probe: () => false,
      afterSpawn: ({ pidFile }) => writeFileSync(pidFile, String(sleeperPid)),
      onAbandon: (a) => abandoned.push(a),
    });
  } catch (e) {
    threw = e;
  }
  // الحمايةُ تغطّي جسمَ الاختبارِ كلَّهُ بعدَ الاستحواذِ — والنائمُ البريءُ يُحمى من أولِ تأكيدٍ (جولتا 3 و4).
  try {
    assert.ok(threw);
    assert.equal(abandoned.length, 1, JSON.stringify(abandoned));
    const a = abandoned[0];
    assert.equal(a.stopped, true, 'the real simulator (state-dir-bound) is terminated by discovery');
    assert.equal(discoverSimPids(a.dir).length, 0, 'no orphan swtpm');
    assert.equal(stateDirExists(a.dir), false);
    let sleeperAlive;
    try {
      process.kill(sleeperPid, 0);
      sleeperAlive = true;
    } catch {
      sleeperAlive = false;
    }
    assert.equal(sleeperAlive, true, 'the innocent sleeper pointed at by the pid file must not be killed');
  } finally {
    try {
      process.kill(sleeperPid, 'SIGKILL');
    } catch {
      /* زالت سلفًا */
    }
  }
});

// L6: إخفاقاتُ جاهزيّةٍ متكرّرةٌ لا تُخلّفُ يتامى ولا تُراكمُ عملياتٍ.
simTest('L6: ثلاثُ إخفاقاتِ جاهزيّةٍ متتاليةٍ تنتهي بلا أيِّ يتيمٍ', () => {
  const before = pgrepSwtpmCount();
  const dirs = [];
  for (let i = 0; i < 3; i++) {
    let threw = null;
    try {
      startSimShared({
        prefix: 'xuux-wl416-l6-',
        portBase: 3460 + 20 * i,
        label: 'WL-416/L6',
        attempts: 1,
        probe: () => false,
        onAbandon: (a) => dirs.push(a.dir),
      });
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'each failed start must reject');
  }
  for (const d of dirs) assert.equal(discoverSimPids(d).length, 0, 'no orphan for ' + d);
  const after = pgrepSwtpmCount();
  assert.ok(after <= before, `swtpm count must not grow (before=${before} after=${after})`);
});

// ── (ب) دورةُ حياةِ سياقِ الردّ (ResponseContext) — قياسٌ مباشرٌ على swtpm ──

simPwshTest('CTX: فقدُ ردِّ التحريرِ وإثباتُ الغيابِ وإعادةُ الاستخدامِ واستهلاكُ الجلسةِ كما قِيسَ', () => {
  withSim((s) => {
    const o = harnessRun(s, ['-Mode', 'ctx-lifetime']);
    const cases = list(o.cases);
    assert.ok(cases.includes('probe: done'), JSON.stringify(cases));
    const line = (prefix) => {
      const found = cases.filter((c) => c.startsWith(prefix));
      assert.equal(found.length, 1, 'exactly one line for ' + prefix + ': ' + JSON.stringify(cases));
      return found[0];
    };
    // الحالةُ 1: فقدُ ردِّ التحريرِ ⇒ غيابٌ مُثبَتٌ بجردٍ قرائيّ، ثمّ EndOfLife يزيلُ السياقَ.
    assert.match(line('record:'), /known=True hier=0x40000001 nameLen=34/);
    assert.match(line('flush-loss:'), /presentAfterLoss=False/);
    assert.match(line('endoflife:'), /contextRemoved=True/);
    // إعادةُ استخدامٍ غيرُ مسجَّلةٍ: لا وراثةَ، ورفضٌ مسمّى لا ادّعاءُ تلفٍ.
    assert.match(line('reuse-unrecorded: handle='), /inheritedContext=False/);
    assert.match(
      line('reuse-unrecorded: createCheck='),
      /createCheck=REJECT RESPONSE_CREATION_PARENT_UNKNOWN/,
      'unrecorded reuse must fail with the named missing-context failure (RESPONSE_CREATION_PARENT_UNKNOWN), not default-accept',
    );
    // الحالةُ 2: إعادةُ الاستخدامِ معَ التسجيلِ ⇒ مقبولٌ (الاسمُ يُبنى من الردِّ الجديدِ لا يُورَّثُ).
    assert.match(line('reuse-recorded: known='), /known=True/);
    assert.match(line('reuse-recorded: createCheck='), /createCheck=ACCEPT/);
    // الحالةُ 3: المقبضُ الباقي ⇒ السياقُ محفوظٌ (لا EndOfLife بلا قرينةِ زوالٍ).
    assert.match(line('still-present:'), /flushFailed=True present=True contextKept=True/);
    // الحالةُ 4: جلسةُ السياسةِ تُستهلَكُ بالأمرِ المُفوِّزِ الناجحِ (قياسٌ مباشرٌ فوريّ) ثمّ يزولُ سياقُها.
    assert.match(line('policy-session:'), /known=True type=1/);
    assert.match(line('consumed:'), /sessionGoneImmediately=True contextRemoved=True/);
  });
});

// ── (ج) قرارُ المالكِ (more=0): السلوكُ باقٍ وحدُّهُ موثَّقٌ بالقياسِ ──

// CTX2: شاهدُ المسارِ الحقيقيّ لا القياسَ اليدويّ فحسب: فقدُ ردِّ FlushContext داخلَ دورةِ البروفةِ نفسِها
// يُفعّلُ المصالحةَ القرائيّةَ التي تُثبِتُ الغيابَ فتُزيلُ السياقَ من المسارِ الإنتاجيّ (ReconcileOne→EndOfLife)،
// ورفضُ التحريرِ (المقبضُ باقٍ) لا يُزيلُ شيئًا — والفرقُ بينَ الحالتَينِ مُثبَتٌ في حقائقِ التقرير.
simPwshTest('CTX2: فقدُ ردِّ التحريرِ داخلَ البروفةِ يُزيلُ السياقَ عبرَ مسارِ المصالحةِ الحقيقيّ', () => {
  withSim((s) => {
    const o = fault(s, 'flush-response-loss');
    const r = o.report;
    // المصالحةُ جرتْ وأثبتَتِ الغيابَ فمُسِحَ السياقُ من المسارِ الحقيقيِّ — والشاهدُ **حالةُ السياقِ نفسُهُ**
    // (contextGone تُشتَقُّ من الخرائطِ بعدَ الاستدعاءِ: حذفُ EndOfLife مع إبقاءِ الحقيقةِ يُسقطُ الشاهدَ — جولةُ 4):
    const eol = String(r.facts['ctx.endOfLife.flush'] || '');
    assert.match(
      eol,
      /verified-absent 0x[0-9a-f]+ contextGone=True/i,
      'the real path must prove context end-of-life (state, not adjacency) after flush response loss: ' + JSON.stringify(r.facts['ctx.endOfLife.flush']),
    );
    const rec = list(r.reconciliation);
    assert.ok(
      rec.some((x) => /verified absent \(release took effect\)/.test(String(x))),
      'reconciliation must record the read-only proof of absence: ' + JSON.stringify(rec),
    );
    // وبفقدِ الردّ دون تنفيذٍ (المقبضُ باقٍ بحقٍّ): لا إزالةَ ولا شاهدَ — والفرقُ بينَ الحالتَينِ مُقاسٌ
    // بجردٍ قرائيّ لا مُدّعى: العَرَضُ الخارجيُّ واحدٌ والحقيقةُ مُتمايزةٌ بالقراءةِ وحدَها:
    const o2 = fault(s, 'flush-response-loss-noexec');
    const r2 = o2.report;
    assert.doesNotMatch(
      String(r2.facts['ctx.endOfLife.flush'] || ''),
      /verified-absent/,
      'a flush whose response was lost without execution (handle still present) must not claim context end-of-life',
    );
    // والشاهدُ الموجبُ للحفظِ: حالةُ السياقِ نفسُهُ (contextKnown=True من الخرائطِ — جولةُ 4):
    assert.match(
      String(r2.facts['ctx.endOfLife.flushKept'] || ''),
      /present contextKnown=True/i,
      'the still-present handle must provably keep its context (state, not adjacency)',
    );
    assert.ok(
      list(r2.reconciliation).some((x) => /still present; release outcome unknown/.test(String(x))),
      'reconciliation must honestly record the unknown release outcome: ' + JSON.stringify(list(r2.reconciliation)),
    );
  });
});

simPwshTest('M0: more=0 يُنهي الجردَ بحسبِ العقدِ لا بحسبِ الحقيقةِ — فهرسٌ محجوبٌ يبقى موجودًا', () => {
  withSim((s) => {
    const o = fault(s, 'inventory-more0-hide');
    const r = o.report;
    // البروفةُ تكتملُ: الجردُ المحجوبُ لا يُفسدُ العقدَ (نهايةُ الجردِ more=0 عقدُ ردٍّ لا برهانَ خلوٍّ).
    assert.equal(r.status, 'COMPLETE', r.failure || JSON.stringify(r).slice(0, 400));
    assert.ok(Number(o.fault.changes) >= 1, 'the hiding rewrite must have engaged');
    // البرهانُ المباشرُ: الجردُ عبرَ النقلِ الداخليّ (بلا حجبٍ) يُثبتُ أنّ الفهرسَ ما زالَ موجودًا.
    const nvAfter = list(o.nvAfter).map((h) => h.toLowerCase());
    assert.ok(
      nvAfter.includes('0x01000001'),
      'hidden index must provably still exist by direct inventory: ' + JSON.stringify(o.nvAfter),
    );
    // وحدودُ القرارِ: الردودُ المُشوَّهةُ و more=1/count=0 تبقى فشلًا مغلقًا (تُغطّيها اختباراتُ wl413-r3
    // على الأوضاعِ inventory-no-progress و inventory-wrong-class — لا يُكرَّر قياسُها هنا).
  });
});

// ── (د) حاجزُ ملكيّةِ مجالِ المالكِ (قرارُ المالكِ المحافِظ: عتبةُ فهرسٍ واحدٍ) ──

simPwshTest('NV1: فهرسٌ داخلَ مجالِ المالكِ قبلَ البروفةِ يُوقفُها مسمّىً بلا أيِّ أمرٍ مُغيِّرٍ ولا حذفٍ', () => {
  withSim((s) => {
    const o = fault(s, 'nv-preseed-unattributable');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(
      r.failure,
      /^NV_INDEX_UNATTRIBUTABLE_OWNER_REVIEW_REQUIRED/,
      'named conservative halt: ' + (r.failure || '').slice(0, 200),
    );
    // لا أمرًا مُغيّرًا للحالةِ إطلاقًا قبلَ الفشلِ المسمّى:
    assert.ok(
      !r.steps.some((x) => STATE_CHANGING.has(x.commandCode)),
      'no state-changing command before the named failure',
    );
    // الفهرسُ لم يُحذَفْ (تنظيفُ ما لا يُثبَتُ ملكُهُ ممنوعٌ):
    const nvAfter = list(o.nvAfter).map((h) => h.toLowerCase());
    assert.ok(nvAfter.includes('0x01807777'), 'planted owner-range index must survive untouched');
    // الحقائقُ المُسجَّلةُ للمراجعةِ:
    assert.equal(r.facts['nvOwnershipGuard.stopThreshold'], '1');
    assert.ok(Number(r.facts['nvOwnershipGuard.unresolvedCount']) >= 1);
    assert.match(r.facts['nvOwnershipGuard.ownerRange'], /^0x01800000-0x01bfffff$/i);
    // قائمةُ الفهارسِ غيرِ المنسوبةِ مسجَّلةٌ للمراجعةِ (سجلٌّ كاملٌ لا عددًا وحدَهُ):
    assert.match(r.facts['nvOwnershipGuard.unresolvedIndices'] || '', /0x01807777/i);
  });
});

simPwshTest('NV2: فهرسٌ من طرفٍ ثالثٍ يظهرُ بعدَ خطِّ الأساسِ يُوقفُ البروفةَ قبلَ أيِّ تعريفٍ', () => {
  withSim((s) => {
    const o = fault(s, 'nv-appear-midrun');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^NV_INDEX_UNATTRIBUTABLE_OWNER_REVIEW_REQUIRED/);
    assert.ok(
      !r.steps.some((x) => STATE_CHANGING.has(x.commandCode)),
      'no state-changing command before the named failure',
    );
    const nvAfter = list(o.nvAfter).map((h) => h.toLowerCase());
    assert.ok(nvAfter.includes('0x01807777'), 'the third-party index must not be deleted by the rehearsal');
    // الحاجزُ قامَ بعدَ جردٍ كاملٍ لخطِّ الأساسِ (قياسُ more يُوثَّقُ في الحقائقِ):
    assert.equal(r.facts['nvOwnershipGuard.stopThreshold'], '1');
  });
});

// ── (هـ) جولةُ المراجعةِ الثانيةِ (WL-416-R2): عائقانِ عاليانِ — الاكتشافُ الفارغُ ليسَ إثباتَ موتٍ،
// والتصعيدُ لا يقعُ على رقمِ PID وحدَهُ. الشاهدانِ بحقنٍ مضبوطٍ كما طلَبَ المراجعُ (القراءةُ غيرُ المقروءةِ
// وتغيّرُ الهويّةِ بينَ الإشارتَينِ لا يحدثانِ طبيعيًا في بيئةِ الاختبارِ — قيدٌ موثَّقٌ في سجلِّ العملِ).

// R2-01: عمليّةُ محاكٍ حيّةٌ لا تُقرأُ هويّتُها (سطرُ أوامرٍ غيرُ مقروءٍ) — لا يُعلَنَ التوقّفُ ولا يُحذَفُ
// المجلّدُ، ويُرفَضُ التقدّمُ (بدلَ الاكتشافِ الفارغِ الزائفِ الذي كانَ يُعلِنُ التوقّفَ).
simTest('R2-01: محاكٍ حيٌّ بهويّةٍ غيرِ مقروءةٍ يُبقي الحالةَ غيرَ محسومةٍ — لا توقّفَ ولا حذفَ', () => {
  const abandoned = [];
  let launchedPid = null;
  let threw = null;
  try {
    startSimShared({
      prefix: 'xuux-wl416-r201-',
      portBase: 3480,
      label: 'WL-416/R2-01',
      attempts: 1,
      probe: () => false,
      afterSpawn: ({ pid, pidFile }) => {
        launchedPid = pid;
        unlinkSync(pidFile); // ملفُّ PID مفقودٌ والهويّةُ غيرُ مقروءةٍ: أسوأ حالةِ مجهولةٍ
      },
      // حقنُ قراءةٍ غيرِ مقروءةٍ للمحاكي المُطلَقِ وحدَهُ؛ وسائطُ سليمةٌ لغيرِهِ (أجانبُ لا يُمسّونَ):
      readCmdline: (pid) => (pid === launchedPid ? null : ['bash', '-lc', 'innocent']),
      onAbandon: (a) => abandoned.push(a),
    });
  } catch (e) {
    threw = e;
  }
  // الحمايةُ تغطّي جسمَ الاختبارِ كلَّهُ بعدَ الاستحواذِ — والمقبضُ المحفوظُ عندَ الإطلاقِ هو المرجعُ
  // للتنظيفِ لا ملفٌّ قد يزولَ (جولتا 3 و4).
  try {
    assert.ok(threw, 'unreadable identity must not be declared stopped');
    assert.match(String(threw.message), /not proven stopped/);
    assert.equal(abandoned.length, 1, JSON.stringify(abandoned));
    const a = abandoned[0];
    assert.equal(a.stopped, false, 'empty discovery is not proof of death: stopped must stay false');
    assert.equal(stateDirExists(a.dir), true, 'state dir kept as evidence');
    assert.ok(!pidProvenDead(launchedPid), 'the alive unreadable simulator must not be declared dead');
    assert.ok(discoverSimPids(a.dir).length >= 1, 'the simulator is really still alive (real read)');
    assert.equal(killSim(launchedPid, { dir: a.dir }), true);
    assert.equal(stopSim({ pid: launchedPid, dir: a.dir }), true);
    assert.equal(stateDirExists(a.dir), false);
  } finally {
    const a = abandoned[0];
    if (a && stateDirExists(a.dir) && discoverSimPids(a.dir).length > 0) {
      try { killSim(launchedPid, { dir: a.dir }); } catch { /* زالت سلفًا */ }
    }
  }
});

// R2-02: تغيّرُ الهويّةِ بينَ SIGTERM والتصعيدِ (إعادةُ استخدامِ PID لعمليّةٍ أخرى) — لا يصلُ SIGKILLُ
// إلى الهويّةِ البديلةِ، وتُعادُ false بصدقٍ ويبقى التنظيفُ بيدِ المتصلِ.
simTest('R2-02: تغيّرُ الهويّةِ عندَ التصعيدِ يمنعُ SIGKILL ويُعيدُ فشلًا صادقًا', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-wl416-r202-'));
  // محاكٍ زائفٌ يتجاهلُ SIGTERM (كما قد يفعلُ محاكٍ معلّقٌ) ويمتلكُ مسارَ الحالةِ في وسائطِهِ: ملفُّ
  // سكربتٍ مؤقتٌ (وسائطُ node بعدَ -e تُفسَّرُ كخياراتِ node لا كوسائطِ السكربتِ — قيدٌ مُقاسٌ):
  const fakeScript = join(dir, 'fake-swtpm.js');
  const readyMarker = join(dir, 'term-handler-ready');
  writeFileSync(
    fakeScript,
    `process.on("SIGTERM", () => {}); require('node:fs').writeFileSync(${JSON.stringify(readyMarker)}, '1');` +
      'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);',
  );
  // الحمايةُ تغطّي **جسمَ الاختبارِ كلَّهُ بعدَ الإطلاقِ** (اكتشافًا وتأكيداتٍ — جولتا 3 و4): فشلُ أيِّ
  // تأكيدٍ — بما فيها تأكيدا الاكتشافِ قبلَ try سابقًا — لا يتجاوزُ التنظيفَ، والتنظيفُ يعيدُ الاكتشافَ
  // بنفسِهِ فلا يعتمدُ على متغيّرٍ قد يبقى null.
  try {
    spawn(
      'bash',
      ['-c', `exec -a swtpm ${process.execPath} ${fakeScript} --tpmstate dir=${dir} x &`],
      { stdio: 'ignore' },
    );
    // الوسمُ بـ & يجعلُ الوالدَ (bash) يخرجُ سريعًا فيُودَعُ المحاكيُّ الزائفُ لعملِ init (ppid=1)
    // فيُلقَّ عندَ موتِهِ — تمامًا كسلوكِ swtpm-daemon الحقيقيّ — ويتحقّقُ زوالُهُ بـ ESRCH دونَ توسيعِ
    // معيارِ الموتِ (حسمُ المراجعةِ 3): لا يُدّعى موتُ زومبيٍّ لم يُلقَّ بعدُ.
    // انتظارُ ظهورِ الوسائطِ في /proc وانتظارِ جاهزيّةِ معالجِ SIGTERM (سباقٌ مُقاسٌ: الاكتشافُ قد يسبقُ
    // تسجيلَ المعالجِ فيُميتُ الإشارةُ الأولى العمليةَ البريئةَ عن سباقٍ لا عن قصدٍ):
    let fakePid = null;
    for (let i = 0; i < 250; i++) {
      const found = discoverSimPids(dir);
      if (found.length === 1) {
        fakePid = found[0];
        if (existsSync(readyMarker)) break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    assert.ok(fakePid !== null, 'fake swtpm must be discoverable by its state dir');
    assert.ok(existsSync(readyMarker), 'fake swtpm must have its SIGTERM handler armed before the kill test');
    // القراءةُ الأولى (قبلَ SIGTERM) سليمةٌ؛ وعندَ التصعيدِ تغيّرَتِ الهويّةُ (رقمٌ أُعيدَ استخدامُهُ):
    let readCount = 0;
    const statefulRead = (_pid) => {
      readCount++;
      if (readCount === 1) return ['swtpm', '--tpmstate', `dir=${dir}`];
      return ['bash', '-lc', 'reused-pid-innocent']; // الهويّةُ البديلةُ عندَ التصعيدِ
    };
    const r = killSim(fakePid, { dir, graceMs: 60, readCmdline: statefulRead });
    assert.equal(r, false, 'escalation must be refused when identity changed');
    assert.ok(readCount >= 2, 'identity must be re-proven at escalation');
    // الهويّةُ البديلةُ لم تُقتَلْ — العمليّةُ ما زالت حيّةً (SIGKILL لم يُرسَلْ):
    assert.ok(!pidProvenDead(fakePid), 'the identity-changed process must not have been SIGKILLed');
    // وبالقارئِ الحقيقيّ: الهويّةُ ما زالت مطابقةً فيقتلهُ SIGKILLُ بعدَ إعادةِ إثباتِها — المسارُ السليمُ:
    assert.equal(killSim(fakePid, { dir, graceMs: 60 }), true);
    assert.ok(pidProvenDead(fakePid), 'the fake simulator must be dead after honest escalation');
  } finally {
    // الإيقافُ أولًا ثمّ الحذفُ — ولا يُحذَفُ المجلّدُ إلّا بعدَ إثباتِ زوالِ كلِّ عمليّةٍ تملكُهُ. والاكتشافُ
    // يُعادُ هنا بنفسِهِ فلا يتيمَ حتى لو فشلَ تأكيدُ الاكتشافِ أعلاهُ (جولتا 3 و4).
    let allStopped = true;
    for (const pid of discoverSimPids(dir)) {
      try {
        allStopped = killSim(pid, { dir, graceMs: 60 }) && allStopped;
      } catch {
        /* زالت سلفًا */
      }
    }
    try {
      if (allStopped && discoverSimPids(dir).length === 0) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* أفضلُ جهدٍ */
    }
  }
});

// NV3: الحاجزُ المتكرّرُ داخلَ PickVacantHandle — فهرسٌ يظهرُ بعدَ اجتيازِ حاجزِ ما بعدِ الأساسِ
// (الجردُ الثالثُ هو جردُ PickVacantHandle نفسِهِ) يُوقفُ البروفةَ قبلَ أيِّ تعريفٍ.
simPwshTest('NV3: فهرسٌ يظهرُ بعدَ اجتيازِ الحاجزِ الأولِ يُوقفُ البروفةَ عندَ حاجزِ التعريفِ المتكرّرِ', () => {
  withSim((s) => {
    const o = fault(s, 'nv-appear-late');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^NV_INDEX_UNATTRIBUTABLE_OWNER_REVIEW_REQUIRED/);
    assert.ok(
      !r.steps.some((x) => STATE_CHANGING.has(x.commandCode)),
      'no state-changing command before the named failure',
    );
    const nvAfter = list(o.nvAfter).map((h) => h.toLowerCase());
    assert.ok(nvAfter.includes('0x01807777'), 'third-party index must survive untouched');
    assert.match(r.facts['nvOwnershipGuard.unresolvedIndices'] || '', /0x01807777/i);
  });
});

// الإيقافُ النهائيُّ للمحاكي المشتركِ ليسَ من هذا الملفِ: كلُّ اختبارٍ يملكُ محاكيَه وينهيه في finally.
