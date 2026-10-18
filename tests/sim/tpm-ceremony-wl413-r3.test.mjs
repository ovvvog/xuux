// @ts-nocheck
// tests/sim/tpm-ceremony-wl413-r3.test.mjs
//
// WL-413 الدفعة الثالثة — عوائقُ المراجعةِ المستقلّةِ الثانيةِ (تقاريرُ gpt_6_1_sol وgrok_4_7 على 8b48a568):
//   R3/SOL413-01 مقبضٌ من خطِّ الأساسِ يُعادُ في ردِّ إنشاءٍ ⇒ لا يُتبنّى: فشلٌ مغلقٌ مسمّى وجردٌ يُعلِنُه.
//   R3/SOL413-02 جردُ مقابضَ بلا تقدّمٍ (more=1/count=0) أو بفئةٍ خاطئةٍ ⇒ فشلٌ مسمّى، لا نهايةٌ صامتةٌ
//                 تجعلُ الجردَ ناقصًا وخطَّ الأساسِ كاذبًا.
//   R3/SOL413-03 محتوى تفويضِ الردِّ (nonce/السمات/hmac) يُتحقَّقُ حسبَ ملفّيْ البروفةِ (password/policy):
//                 أربعةُ تشويهاتٍ مخالفةٍ تُرفَضُ بأسماءٍ مسمّاةٍ.
//   R3/SOL413-07 إعلانُ parameterSize يفوقُ المتبقّيَ من الردِّ ⇒ فشلٌ مسمّى قبلَ أيِّ تخصيصٍ.
//   R3/SOL413-05 ردُّ غيابٍ/عدمِ تهيئةٍ (0x18B/0x14A) مشوَّهُ البنيةِ لا يُعَدُّ دليلًا قرائيًّا: المصالحةُ
//                 تُعلِنُ «unverifiable» ولا تدّعي الغيابَ من ردٍّ مشوَّهٍ.
//   R3/SOL413-06 Create والرفضُ السلبيُّ لـPolicySigned مُقيَّدانِ في دفترِ المواردِ: فقدُ الردِّ ⇒ نتيجةٌ
//                 مجهولةٌ تُجرَدُ ولا تختفي من التقريرِ.
//   R3/G47-413-1 فقدُ ردِّ تعريفٍ (أو ردٍّ مشوَّهٍ) ⇒ لا حذفَ أبدًا حتى مع مطابقةِ المنطقةِ العامّةِ: الملكيّةُ
//                 غيرُ قابلةٍ للإثباتِ (فهرسٌ مطابقٌ سابقُ الوجودِ لا يُميَّزُ) — يُتركُ ويُعلَنُ.
// كلُّ اختبارٍ يشغّلُ محاكيَه الخاصَّ (حالةٌ ومنافذُ معزولة). لا TBS، ولا /dev/tpm*، ولا عتاد.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = join(root, 'tests/helpers/tpm-ceremony-harness.ps1');

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const sim = isSimEnabled();
const simPwshTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : (!pwshAvailable ? 'pwsh unavailable' : false) }, fn);

const STATE_CHANGING = new Set(['0x0000012a', '0x00000134', '0x00000122', '0x00000131', '0x00000153', '0x00000157', '0x00000176', '0x00000160', '0x0000016c', '0x00000165']);

function startSim() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const dir = mkdtempSync(join(tmpdir(), 'xuux-wl413r3-'));
    const port = 2700 + 2 * Math.floor(Math.random() * 150);
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
      } catch { /* لم يجهز بعد */ }
      execFileSync('sleep', ['1']);
    }
    if (!ready) { rmSync(dir, { recursive: true, force: true }); continue; }
    return { dir, port, pidFile };
  }
  throw new Error('WL-413/R3: تعذّرَ تشغيلُ محاكٍ معزول');
}

function stopSim(s) {
  try { rmSync(s.dir, { recursive: true, force: true }); } catch { /* أفضلُ جهد */ }
}

function fault(s, mode) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness,
    '-Mode', 'fault', '-SimPort', String(s.port), '-Fault', mode], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

const list = (x) => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** بعدَ الفشلِ لا يُرسَلُ أمرٌ مُغيّرٌ من مرحلةٍ لاحقةٍ: ما بعدَ خطوةِ الفشلِ مصالحةٌ/تنظيفٌ/جردٌ نهائيٌّ فقط. */
function assertNoLaterStage(report, failedStepName) {
  const i = report.steps.findIndex((x) => x.name === failedStepName);
  assert.ok(i >= 0, 'failed step recorded: ' + failedStepName);
  for (const st of report.steps.slice(i + 1)) {
    assert.ok(['reconcile', 'cleanup', 'post-run'].includes(st.stage), `step after failure in stage ${st.stage}: ${st.name}`);
    if (st.stage !== 'cleanup') assert.ok(!STATE_CHANGING.has(st.commandCode), `state-changing in ${st.stage}: ${st.name}`);
  }
}

// ── SOL413-01: مقبضٌ من خطِّ الأساسِ في ردِّ إنشاءٍ ──

simPwshTest('R3-01: مقبضٌ موجودٌ في خطِّ الأساسِ يُعادُ في ردِّ StartAuthSession ⇒ لا يُتبنّى ويُفشِلُ مغلقًا ويُجرد', () => {
  const s = startSim();
  try {
    const o = fault(s, 'session-alias');
    const r = o.report;
    assert.equal(o.fault.changes >= 1, true, 'probe fired');
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s2\.trial:StartAuthSession/);
    assert.match(r.failure, /RESPONSE_HANDLE_PREEXISTING: StartAuthSession 0x0[23][0-9a-f]{6} existed in baseline sessions inventory/);
    assert.ok(list(r.reconciliation).some((x) => /^session-create 0x0[23][0-9a-f]{6}: appeared during run; ownership not provable; left in place$/.test(x)), JSON.stringify(r.reconciliation));
    assert.ok(list(r.cleanupLeftovers).some((x) => /^session 0x0[23][0-9a-f]{6}: ownership-undetermined \(appeared during run\); not removed$/.test(x)), JSON.stringify(r.cleanupLeftovers));
    assert.equal(r.postRunInventory.verified, true);
    assert.equal(list(r.postRunInventory.residualSessions).length, 1, 'exactly the unadopted session remains');
    assertNoLaterStage(r, 's2.trial:StartAuthSession');
  } finally { stopSim(s); }
});

// ── SOL413-02: جردٌ بلا تقدّمٍ أو بفئةٍ خاطئةٍ ──

simPwshTest('R3-02a: جردُ مقابضَ يعيدُ more=1 مع count=0 ⇒ فشلٌ مسمّى، لا نهايةٌ صامتةٌ تجعلُ خطَّ الأساسِ كاذبًا', () => {
  const s = startSim();
  try {
    const o = fault(s, 'inventory-no-progress');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /RESPONSE_CAPABILITY_NO_PROGRESS: more=1 count=0 rc=0x00000000/);
    assert.ok(!r.steps.some((x) => STATE_CHANGING.has(x.commandCode)), 'no state-changing command before the named failure');
    assert.equal(r.postRunInventory.verified, false);
    assert.match(r.postRunInventory.error, /no baseline/);
  } finally { stopSim(s); }
});

simPwshTest('R3-02b: جردُ مقابضَ يعيدُ مقبضاً من فئةٍ أخرى ⇒ فشلٌ مسمّى، لا جردٌ ناقصٌ يبدو كاملًا', () => {
  const s = startSim();
  try {
    const o = fault(s, 'inventory-wrong-class');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: 0x80000001 asked=0x01000000 rc=0x00000000/);
    assert.ok(!r.steps.some((x) => STATE_CHANGING.has(x.commandCode)));
    assert.equal(r.postRunInventory.verified, false);
  } finally { stopSim(s); }
});

// ── SOL413-03: محتوى تفويضِ الردِّ ──

const authCases = [
  ['auth-nonce-byte', 'nonceLen=1 attrs=0x01 hmacLen=0'],
  ['auth-hmac-byte', 'nonceLen=0 attrs=0x01 hmacLen=1'],
  ['auth-attrs-ff', 'nonceLen=0 attrs=0xff hmacLen=0'],
  ['auth-attrs-clear', 'nonceLen=0 attrs=0x00 hmacLen=0'],
];

for (const [mode, detail] of authCases) {
  simPwshTest(`R3-03: تفويضُ ردٍّ مخالفٌ للملفِّ المتوقَّعِ (${mode}) ⇒ فشلٌ مغلقٌ مسمّى لا يُمرَّرُ`, () => {
    const s = startSim();
    try {
      const o = fault(s, mode);
      const r = o.report;
      assert.equal(r.status, 'FAILED_CLOSED');
      assert.match(r.failure, /^OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace/);
      assert.match(r.failure, new RegExp('RESPONSE_AUTH_CONTENT_MALFORMED: auth#0 ' + detail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      // الفهرسُ عُرِّفَ فعلًا (الأمرُ نُفِّذَ) لكنّ ردَّهُ مرفوضٌ ⇒ ملكيّتُهُ غيرَ قابلةٍ للإثباتِ ⇒ يُتركُ ويُعلَنُ.
      assert.ok(list(r.reconciliation).some((x) => /nv-define 0x01[0-9a-f]{6}: exists with definition matching this run's request/.test(x)), JSON.stringify(r.reconciliation));
      assert.ok(!list(r.reconciliation).some((x) => /ownership proven/.test(x)));
      const residual = list(r.postRunInventory.residualNv);
      assert.equal(residual.length, 1);
      assert.ok(list(o.nvAfter).includes(residual[0]), 'index remains on the simulator');
      assertNoLaterStage(r, 's1.probe:NV_DefineSpace');
    } finally { stopSim(s); }
  });
}

// ── SOL413-07: حدُّ parameterSize ──

simPwshTest('R3-04: parameterSize يعلنُ أكثرَ من المتبقّي من الردِّ ⇒ فشلٌ مسمّى قبلَ أيِّ تخصيصٍ', () => {
  const s = startSim();
  try {
    const o = fault(s, 'paramsize-huge');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace/);
    assert.match(r.failure, /RESPONSE_PARAMETER_SIZE_INVALID: 2147483632 > remaining /);
    assert.ok(!r.steps.some((x) => x.name.includes('NV_Increment')), 'ceremony did not proceed past the malformed response');
    const residual = list(r.postRunInventory.residualNv);
    assert.equal(residual.length, 1);
    assert.ok(list(o.nvAfter).includes(residual[0]));
  } finally { stopSim(s); }
});

// ── SOL413-05: ردُّ غيابٍ مشوَّهٌ لا يُبتلَعُ دليلًا ──

simPwshTest('R3-05a: فقدُ ردِّ تعريفٍ قبلَ التنفيذِ ثمّ ردُّ غيابٍ 0x18B مشوَّهٌ ⇒ «unverifiable» لا «verified absent»', () => {
  const s = startSim();
  try {
    const o = fault(s, 'readpublic-malformed-18b');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace/);
    assert.match(r.failure, /WL413R3_DEFINE_DROPPED_THEN_MALFORMED_ABSENCE/);
    // المصالحةُ لم تدّعِ الغيابَ من ردٍّ مشوَّهٍ: فشلٌ مسمّى يُعلَنُ في البقايا.
    assert.ok(list(r.cleanupLeftovers).some((x) => /^reconcile nv-define 0x01[0-9a-f]{6} unverifiable: RESPONSE_ERROR_TAG_MALFORMED/.test(x)), JSON.stringify(r.cleanupLeftovers));
    assert.ok(!list(r.reconciliation).some((x) => /verified absent/.test(x)), 'absence must not be claimed from a malformed response');
    assert.deepEqual(list(r.postRunInventory.residualNv), []);
    assert.deepEqual(o.nvAfter, o.nvBefore, 'nothing was really created');
    assertNoLaterStage(r, 's1.probe:NV_DefineSpace');
  } finally { stopSim(s); }
});

simPwshTest('R3-05b: فقدُ ردِّ زيادةٍ سلبيّةٍ ثمّ ردُّ قراءةٍ 0x14A مشوَّهٌ ⇒ «unverifiable» لا «still uninitialized»', () => {
  const s = startSim();
  try {
    const o = fault(s, 'readcounter-malformed-14a');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s2v:NV_Increment\(password-auth\)/);
    assert.ok(list(r.cleanupLeftovers).some((x) => /^reconcile nv-increment 0x01[0-9a-f]{6} unverifiable: RESPONSE_ERROR_TAG_MALFORMED/.test(x)), JSON.stringify(r.cleanupLeftovers));
    assert.ok(!list(r.reconciliation).some((x) => /counter still uninitialized/.test(x)), 'uninitialized must not be claimed from a malformed response');
    // الفهرسُ عُرِّفَ بردٍّ سليمٍ فملكيّتُهُ مثبتةٌ ويُحذَفُ في التنظيفِ؛ البقيّةُ المعلَنةُ هي فشلُ الجردِ وحدَهُ.
    assert.deepEqual(list(r.postRunInventory.residualNv), []);
    assert.deepEqual(o.nvAfter, o.nvBefore);
    assertNoLaterStage(r, 's2v:NV_Increment(password-auth)');
  } finally { stopSim(s); }
});

// ── SOL413-06: Create والرفضُ السلبيُّ داخلَ الدفترِ ──

simPwshTest('R3-06a: فقدُ ردِّ Create ⇒ نتيجةٌ مجهولةٌ مُقيَّدةٌ تُجرَدُ ولا تبقى صامتةً', () => {
  const s = startSim();
  try {
    const o = fault(s, 'create-response-loss');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s2:Create\(service-key,ECDSA-P256\)/);
    assert.ok(list(r.reconciliation).some((x) => x === 'object-create: no new handle since baseline (likely not executed)'), JSON.stringify(r.reconciliation));
    // المفتاحُ الأوّليُّ عُرِّفَ بردٍّ سليمٍ فتحريرُهُ في التنظيفِ مسموحٌ ومُتحقَّقٌ.
    assert.deepEqual(list(r.postRunInventory.residualTransients), []);
    assert.deepEqual(o.sessionsAfter, o.sessionsBefore);
    assertNoLaterStage(r, 's2:Create(service-key,ECDSA-P256)');
  } finally { stopSim(s); }
});

simPwshTest('R3-06b: فقدُ ردِّ الرفضِ السلبيِّ لـPolicySigned ⇒ نتيجةٌ مجهولةٌ تُجرَدُ الجلسةُ وسياسةً، لا تختفي', () => {
  const s = startSim();
  try {
    const o = fault(s, 'policysigned-neg-loss');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s2v\.replay:PolicySigned\(old-signature\)/);
    assert.ok(list(r.reconciliation).some((x) => /^policy-mutation 0x03[0-9a-f]{6}: session still present; policy state unverifiable after lost response; left for bounded cleanup$/.test(x)), JSON.stringify(r.reconciliation));
    // الجلسةُ معلومةُ المقبضِ فيُحرَّرُها التنظيفُ المحدودُ؛ التقريرُ لا يدّعي نجاحًا (الحالةُ مغلقَةٌ بفشلٍ).
    assert.deepEqual(list(r.postRunInventory.residualSessions), []);
    assertNoLaterStage(r, 's2v.replay:PolicySigned(old-signature)');
  } finally { stopSim(s); }
});

// ── G47-413-1: فقدُ ردِّ التعريفِ ⇒ لا حذفَ حتى مع مطابقةِ المنطقةِ العامّةِ ──

simPwshTest('R3-07: فقدُ ردِّ تعريفٍ نُفِّذَ ⇒ الملكيّةُ غيرُ قابلةٍ للإثباتِ (فهرسٌ مطابقٌ سابقٌ لا يُميَّزُ) ⇒ لا حذفَ ويُعلَن', () => {
  const s = startSim();
  try {
    const o = fault(s, 'define-response-loss');
    const r = o.report;
    const h = o.fault.definedHandle;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s1\.probe:NV_DefineSpace/);
    assert.match(r.failure, /WL413_RESPONSE_LOSS_AFTER_DEFINE_EXECUTION/);
    assert.ok(list(r.reconciliation).some((x) => x.startsWith('nv-define ' + h) && /the define reply was lost or unusable so execution and ownership cannot be proven/.test(x)), JSON.stringify(r.reconciliation));
    assert.ok(!list(r.reconciliation).some((x) => /ownership proven/.test(x)), 'ownership must not be claimed from a lost reply');
    assert.ok(!r.steps.some((x) => x.commandCode === '0x00000122'), 'no NV_UndefineSpace sent for an index of unprovable ownership');
    assert.ok(list(r.cleanupLeftovers).some((x) => x === 'nv ' + h + ': ownership-undetermined (define reply lost; matching publicArea is not proof); left in place'), JSON.stringify(r.cleanupLeftovers));
    assert.equal(r.postRunInventory.verified, true);
    assert.deepEqual(list(r.postRunInventory.residualNv), [h]);
    assert.ok(list(o.nvAfter).includes(h), 'index remains on the simulator as evidence');
    assertNoLaterStage(r, 's1.probe:NV_DefineSpace');
  } finally { stopSim(s); }
});

// ── SOL413-04/G47-413-3: البنيةُ الداخليّةُ للردودِ ──
// كلُّ مسبرٍ يشوّهُ حقلًا واحدًا داخلَ معاملاتِ ردٍّ ناجحٍ (بنيةٌ كلّيّةٌ سليمةٌ): المخطّطُ الداخليُّ
// يرفضُهُ باسمٍ مسمّى لا COMPLETE بصحّةٍ زائفةٍ. الأوامرُ المُغيّرةُ تُغلَّفُ بنتيجةٍ مجهولةٍ وتُجرَدُ.

const schemaCases = [
  ['schema-public-empty', 's2:CreatePrimary(storage,ECC-P256)', 'RESPONSE_PUBLIC_AREA_MALFORMED: CreatePrimary len=0'],
  ['schema-creationdata-short', 's2:CreatePrimary(storage,ECC-P256)', 'RESPONSE_CREATION_DATA_MALFORMED: CreatePrimary len=1'],
  ['schema-creationhash-short', 's2:CreatePrimary(storage,ECC-P256)', 'RESPONSE_CREATION_HASH_MALFORMED: len=0'],
  ['schema-ticket-tag-flip', 's2:CreatePrimary(storage,ECC-P256)', 'RESPONSE_TICKET_TAG_MALFORMED: CreatePrimary'],
  ['schema-nonce-empty', 's2.trial:StartAuthSession', 'RESPONSE_SESSION_NONCE_MALFORMED: len=0 nonceCaller=32'],
];

for (const [mode, step, err] of schemaCases) {
  simPwshTest(`R3-08: \u062a\u0634\u0648\u064a\u0647\u064f \u062d\u0642\u0644\u064d \u062f\u0627\u062e\u0644\u064a\u0651\u064d \u0641\u064a \u0631\u062f\u0651\u064d \u0646\u0627\u062c\u062d\u064d (${mode}) \u21d2 \u0641\u0634\u0644\u064c \u0645\u063a\u0644\u0642\u064c \u0645\u0633\u0645\u0651\u0649 \u0644\u0627 \u0646\u062c\u0627\u062d\u064c \u0628\u0635\u062d\u0651\u0629\u064d \u0632\u0627\u0626\u0641\u0629\u064d`, () => {
    const s = startSim();
    try {
      const o = fault(s, mode);
      const r = o.report;
      assert.equal(r.status, 'FAILED_CLOSED');
      assert.ok(r.failure.startsWith('OUTCOME_UNKNOWN: ' + step + ' '), 'prefix: ' + r.failure);
      assert.ok(r.failure.includes(err), 'error name: ' + r.failure);
      // \u0627\u0644\u0623\u0645\u0631\u064f \u0645\u064f\u063a\u064a\u0651\u0631\u064c \u21d2 \u0644\u0627 \u0645\u0631\u062d\u0644\u0629\u064b \u0644\u0627\u062d\u0642\u0629\u064b \u062a\u064f\u063a\u064a\u0651\u0631\u064f \u062d\u0627\u0644\u0629\u064b.
      assertNoLaterStage(r, step);
    } finally { stopSim(s); }
  });
}

simPwshTest('R3-09: قراءةُ NV بردٍّ ناجحٍ وبياناتٍ أقصرَ من المطلوبِ ⇒ فشلٌ مغلقٌ مسمّى (قراءةٌ لا تُغيّرُ)', () => {
  const s = startSim();
  try {
    const o = fault(s, 'schema-nvread-short');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /RESPONSE_NV_READ_SIZE_MALFORMED: len=1 asked=/);
    assert.ok(!/OUTCOME_UNKNOWN/.test(r.failure), 'NV_Read is not state-changing');
  } finally { stopSim(s); }
});

simPwshTest('R3-10: توقيعٌ بردٍّ ناجحٍ ومكوّنٌ مقتطَعٌ ⇒ فشلٌ مغلقٌ مسمّى (Sign لا يُغيّرُ)', () => {
  const s = startSim();
  try {
    const o = fault(s, 'schema-sign-short');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /RESPONSE_SIGNATURE_COMPONENT_MALFORMED: r=1 s=32/);
  } finally { stopSim(s); }
});

simPwshTest('R3-11: PolicySigned ناجحٌ ببصمةِ تذكرةٍ تتجاوزُ الحدَّ ⇒ نتيجةٌ مجهولةٌ مُغلَفةٌ ومُجرَدة', () => {
  const s = startSim();
  try {
    const o = fault(s, 'schema-policysigned-digest');
    const r = o.report;
    assert.equal(r.status, 'FAILED_CLOSED');
    assert.match(r.failure, /^OUTCOME_UNKNOWN: s2\.trial:PolicySigned/);
    assert.match(r.failure, /RESPONSE_TICKET_DIGEST_MALFORMED: len=65/);
    assertNoLaterStage(r, 's2.trial:PolicySigned');
  } finally { stopSim(s); }
});
