// @ts-nocheck
// tests/sim/tpm-ceremony-wl414-fup.test.mjs
//
// WL-414 — دورةُ المعالجةِ المحدودةُ بعدَ متابعةِ المراجعةِ المستقلّةِ (تقريرُ gpt_6_1_sol على 3e67d362،
// وإعادةُ الإنتاجِ على a3272058). اختباراتُ رجوعٍ إيجابيّةٌ وسلبيّةٌ لكلِّ مسألةٍ:
//   FUP-SOL-01  تذكرةُ PolicySigned عندَ expiration=0 (تذكرةُ NULL): وسمٌ غيرُ 0x8025، أو هرميّةٌ غيرُ RH_NULL،
//               أو بصمةٌ غيرُ فارغةٍ ⇒ فشلٌ مسمّى (كانت 1/32/64 والهرميّاتُ الثلاثُ و0x8023 تُقبلُ).
//   FUP-SOL-02  parentName/parentQualifiedName/parentNameAlg/outsideInfo في بياناتِ الإنشاءِ مربوطةٌ بالطلبِ
//               وبالأصلِ المعروفِ (كانت تُستهلَكُ بنيويًّا فقط).
//   FUP-SOL-03  فشلُ جاهزيّةِ startSim بعدَ إطلاقِ swtpm ⇒ يُنهى المحاكي فلا يبقى يتيمٌ.
//   FUP-SOL-04  نصُّ المصالحةِ بعدَ استنفادِ محاولةِ التنظيفِ يصفُ الميزانيّةَ المستنفدةَ (لا «متروكٌ للمحاولة»).
//   FUP-SOL-05  الردُّ الصحيحُ عندَ expiration=3600 (تذكرةُ NULL، timeout فارغ) مقبولٌ.
//   البصمة       طولُ بصمةِ تذكرةِ PolicySigned مربوطٌ بالطلبِ: 0 لتذكرةِ NULL و64 للتذكرةِ الحقيقيّةِ
//               (expiration سالبٌ في جلسةِ سياسةٍ) — قِيسَ على swtpm.
// كلُّ اختبارٍ يشغّلُ محاكيَه الخاصَّ. لا TBS، ولا /dev/tpm*، ولا عتاد.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startSim as startSimShared, stopSim, swtpmProcessesWithPath } from '../helpers/ceremony-swtpm.mjs';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = join(root, 'tests/helpers/tpm-ceremony-harness.ps1');

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const sim = isSimEnabled();
const simTest = (name, fn) => test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);
const simPwshTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : (!pwshAvailable ? 'pwsh unavailable' : false) }, fn);

function startSim() {
  return startSimShared({ prefix: 'xuux-wl414fup-', portBase: 3100, label: 'WL-414/FUP' });
}

function harnessRun(s, args) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, '-SimPort', String(s.port), ...args],
    { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

const fault = (s, mode) => harnessRun(s, ['-Mode', 'fault', '-Fault', mode]);
const list = (x) => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);

// ── FUP-SOL-05 + البصمة: الأشكالُ الحقيقيّةُ الستّةُ على swtpm مقبولةٌ، وكلٌّ بالشكلِ المقيس ──
simPwshTest('FUP-1: ردودُ PolicySigned الحقيقيّةُ (سياسة/تجربة × 0/3600/-3600) مقبولةٌ بأشكالِها المقيسة', () => {
  const s = startSim();
  try {
    const o = harnessRun(s, ['-Mode', 'policysigned-shapes']);
    const shapes = list(o.shapes);
    assert.equal(shapes.length, 6, JSON.stringify(shapes));
    const nullTicket = 'timeoutLen=0 tag=0x8025 hierarchy=0x40000007 digestLen=0 SCHEMA_ACCEPT';
    const expected = {
      'session=policy expiration=0': nullTicket,
      'session=policy expiration=3600': nullTicket,
      // التذكرةُ الحقيقيّةُ الوحيدةُ: timeout UINT64، وهرميّةُ مفتاحِ التوقيعِ (المالك)، وبصمةٌ بطولِ 64.
      'session=policy expiration=-3600': 'timeoutLen=8 tag=0x8025 hierarchy=0x40000001 digestLen=64 SCHEMA_ACCEPT',
      'session=trial expiration=0': nullTicket,
      'session=trial expiration=3600': nullTicket,
      'session=trial expiration=-3600': nullTicket,
    };
    for (const [k, v] of Object.entries(expected)) {
      assert.ok(shapes.includes(k + ' rc=0x00000000 ' + v), k + ' => ' + JSON.stringify(shapes));
    }
  } finally { stopSim(s); }
});

// ── FUP-SOL-01 + البصمة: تذكرةُ NULL المشوَّهةُ عندَ expiration=0 مرفوضةٌ باسمٍ ──
const psRejectCases = [
  ['fup-ps-digest-1', 'RESPONSE_TICKET_DIGEST_MALFORMED: PolicySigned len=1 expected=0'],
  ['fup-ps-digest-32', 'RESPONSE_TICKET_DIGEST_MALFORMED: PolicySigned len=32 expected=0'],
  ['fup-ps-digest-64', 'RESPONSE_TICKET_DIGEST_MALFORMED: PolicySigned len=64 expected=0'],
  ['fup-ps-hierarchy-40000001', 'RESPONSE_TICKET_HIERARCHY_MALFORMED: PolicySigned 0x40000001 expected=0x40000007'],
  ['fup-ps-hierarchy-4000000b', 'RESPONSE_TICKET_HIERARCHY_MALFORMED: PolicySigned 0x4000000b expected=0x40000007'],
  ['fup-ps-hierarchy-4000000c', 'RESPONSE_TICKET_HIERARCHY_MALFORMED: PolicySigned 0x4000000c expected=0x40000007'],
  ['fup-ps-tag-8023', 'RESPONSE_TICKET_TAG_MALFORMED: PolicySigned 0x8023'],
  ['fup-ps-tag-8024', 'RESPONSE_TICKET_TAG_MALFORMED: PolicySigned 0x8024'],
];

for (const [mode, err] of psRejectCases) {
  simPwshTest('FUP-2: تذكرةُ PolicySigned عندَ expiration=0 (' + mode + ') ⇒ نتيجةٌ مجهولةٌ مسمّاةٌ ومُجرَدة', () => {
    const s = startSim();
    try {
      const o = fault(s, mode);
      const r = o.report;
      assert.equal(o.fault.changes, 1, 'probe fired once');
      assert.equal(r.status, 'FAILED_CLOSED');
      assert.ok(r.failure.startsWith('OUTCOME_UNKNOWN: s2.trial:PolicySigned '), 'prefix: ' + r.failure);
      assert.ok(r.failure.includes(err), 'error name: ' + r.failure);
    } finally { stopSim(s); }
  });
}

// ضوابطُ إيجابيّةٌ للمُعيدِ نفسِه: إعادةُ ترميزٍ بالقيمِ الصحيحةِ لا تُغيّرُ القبولَ (المسبرُ لا يكسرُ الردَّ بذاتِه).
for (const mode of ['fup-ps-digest-0', 'fup-ps-hierarchy-40000007', 'fup-ps-tag-8025']) {
  simPwshTest('FUP-2c: إعادةُ ترميزِ تذكرةِ PolicySigned بقيمِها الصحيحةِ (' + mode + ') ⇒ COMPLETE', () => {
    const s = startSim();
    try {
      const o = fault(s, mode);
      assert.equal(o.fault.changes, 1, 'probe fired once');
      assert.equal(o.report.status, 'COMPLETE', o.report.failure);
    } finally { stopSim(s); }
  });
}

// ── FUP-SOL-02: الحقولُ الذيليّةُ لبياناتِ الإنشاءِ مربوطةٌ بالطلبِ وبالأصلِ المعروف ──
const createStep = 's2:Create(service-key,ECDSA-P256)';
const primaryStep = 's2:CreatePrimary(storage,ECC-P256)';
const cdRejectCases = [
  ['fup-cd-parentname', createStep, 'RESPONSE_CREATION_DATA_MALFORMED: Create parentName differs from known parent'],
  ['fup-cd-parentqn', createStep, 'RESPONSE_CREATION_DATA_MALFORMED: Create parentQualifiedName differs from known parent'],
  ['fup-cd-outsideinfo', createStep, 'RESPONSE_CREATION_DATA_MALFORMED: Create outsideInfo differs from request'],
  ['fup-cd-pna-null', createStep, 'RESPONSE_CREATION_DATA_MALFORMED: Create parentNameAlg=0x0010 expected=0x000b'],
  ['fup-cdp-parentname', primaryStep, 'RESPONSE_CREATION_DATA_MALFORMED: CreatePrimary parentName differs from known parent'],
  ['fup-cdp-parentqn', primaryStep, 'RESPONSE_CREATION_DATA_MALFORMED: CreatePrimary parentQualifiedName differs from known parent'],
  ['fup-cdp-outsideinfo', primaryStep, 'RESPONSE_CREATION_DATA_MALFORMED: CreatePrimary outsideInfo differs from request'],
  ['fup-cdp-pna-sha256', primaryStep, 'RESPONSE_CREATION_DATA_MALFORMED: CreatePrimary parentNameAlg=0x000b expected=0x0010'],
];

for (const [mode, step, err] of cdRejectCases) {
  simPwshTest('FUP-3: بياناتُ إنشاءٍ بحقلٍ غيرِ مربوطٍ (' + mode + ') ⇒ نتيجةٌ مجهولةٌ مسمّاة', () => {
    const s = startSim();
    try {
      const o = fault(s, mode);
      const r = o.report;
      assert.equal(o.fault.changes, 1, 'probe fired once');
      assert.equal(r.status, 'FAILED_CLOSED');
      assert.ok(r.failure.startsWith('OUTCOME_UNKNOWN: ' + step + ' '), 'prefix: ' + r.failure);
      assert.ok(r.failure.includes(err), 'error name: ' + r.failure);
    } finally { stopSim(s); }
  });
}

for (const mode of ['fup-cd-identity', 'fup-cdp-identity']) {
  simPwshTest('FUP-3c: إعادةُ ترميزِ بياناتِ الإنشاءِ بقيمِها الحقيقيّةِ (' + mode + ') ⇒ COMPLETE', () => {
    const s = startSim();
    try {
      const o = fault(s, mode);
      assert.equal(o.fault.changes, 1, 'probe fired once');
      assert.equal(o.report.status, 'COMPLETE', o.report.failure);
    } finally { stopSim(s); }
  });
}

// ── FUP-SOL-04: نصُّ المصالحةِ يطابقُ ميزانيّةَ محاولاتِ التنظيفِ ──
simPwshTest('FUP-4: حذفُ التنظيفِ يُسقَطُ قبلَ الإرسالِ ⇒ «الميزانيّةُ مستنفدةٌ» وبقيّةٌ معلَنةٌ، لا «متروكٌ لمحاولةٍ»', () => {
  const s = startSim();
  try {
    const o = fault(s, 'fup-cleanup-undefine-before');
    const r = o.report;
    const h = o.fault.definedHandle;
    assert.equal(o.fault.changes, 2, 'both injections fired');
    assert.equal(r.status, 'FAILED_CLOSED');
    const rec = list(r.reconciliation);
    assert.ok(rec.includes('nv-undefine ' + h + ': still present; deletion outcome unknown; cleanup attempt budget already spent (1 per resource; no further attempt); declared as leftover'), JSON.stringify(rec));
    assert.ok(!rec.some((x) => x.includes('left for the bounded cleanup attempt')), JSON.stringify(rec));
    assert.ok(list(r.cleanupLeftovers).some((x) => x.startsWith('nv ' + h + ':')), JSON.stringify(r.cleanupLeftovers));
    // الفهرسُ باقٍ فعلًا على المحاكي — الإعلانُ يطابقُ الحالة.
    assert.ok(list(o.nvAfter).includes(h), JSON.stringify(o.nvAfter));
  } finally { stopSim(s); }
});

simPwshTest('FUP-4c: حذفُ المرحلةِ يُسقَطُ قبلَ التنظيفِ ⇒ «متروكٌ لمحاولةِ التنظيفِ» ثمّ يُحذفُ فعلًا', () => {
  const s = startSim();
  try {
    const o = fault(s, 'fup-undefine-drop-before');
    const r = o.report;
    const h = o.fault.definedHandle;
    assert.equal(o.fault.changes, 1, 'probe fired once');
    const rec = list(r.reconciliation);
    assert.ok(rec.includes('nv-undefine ' + h + ': still present; deletion outcome unknown; left for the bounded cleanup attempt (declared as leftover if it remains)'), JSON.stringify(rec));
    assert.ok(!rec.some((x) => x.includes('budget already spent')), JSON.stringify(rec));
    assert.ok(!list(o.nvAfter).includes(h), 'cleanup removed the run-owned index: ' + JSON.stringify(o.nvAfter));
  } finally { stopSim(s); }
});

// ── FUP-SOL-03: فشلُ جاهزيّةِ startSim لا يتركُ محاكيًا يتيمًا ──
simTest('FUP-5: swtpm يُطلَقُ ثمّ يفشلُ استعلامُ الجاهزيّةِ ⇒ يُنهى قبلَ رميِ الخطأ ولا يبقى يتيم', () => {
  const prefix = 'xuux-wl414fup-notready-' + process.pid + '-';
  const abandoned = [];
  assert.throws(() => startSimShared({
    prefix, portBase: 3500, attempts: 2, readyTries: 1, probe: () => false,
    onAbandon: (x) => abandoned.push(x), label: 'WL-414/FUP-5',
  }), /WL-414\/FUP-5: تعذّرَ تشغيلُ محاكٍ معزول/);
  assert.equal(abandoned.length, 2, JSON.stringify(abandoned));
  for (const a of abandoned) {
    assert.equal(a.reason, 'not-ready');
    assert.ok(Number.isInteger(a.pid) && a.pid > 1, 'swtpm was actually launched: ' + JSON.stringify(a));
    assert.equal(a.stopped, true, 'launched simulator stopped: ' + JSON.stringify(a));
    let alive = true;
    try { process.kill(a.pid, 0); } catch { alive = false; }
    assert.equal(alive, false, 'pid ' + a.pid + ' gone');
  }
  // فورَ رجوعِ الخطأ — قبلَ أيِّ تنظيفٍ خارجيٍّ — لا عمليّةَ swtpm تحملُ بادئةَ هذا الاختبار.
  assert.deepEqual(swtpmProcessesWithPath(join(tmpdir(), prefix)), []);
});

simTest('FUP-5c: مسارُ النجاحِ ⇒ stopSim ينتظرُ زوالَ المحاكي ولا يبقى يتيم', () => {
  const s = startSim();
  assert.ok(swtpmProcessesWithPath(s.dir).length === 1, 'running before stop');
  assert.equal(stopSim(s), true);
  assert.deepEqual(swtpmProcessesWithPath(s.dir), []);
});
