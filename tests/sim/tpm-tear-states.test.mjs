// @ts-nocheck
// tests/sim/tpm-tear-states.test.mjs
//
// اختبارات حالات التمزّق السبع من ADR 0007 §4.4. كل حالة تُبنى مباشرة على القرص
// (manifest + staged + عدّاد TPM) ثم يُستدعى recover() ويُتحقّق من الناتج.
//
// القاعدة: كل ما لا يطابق ⇒ إغلاق (HALT). لا توجد حالة «إصلاح تلقائي خارج القواعد».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import * as tpm from '../../sim/tpm/tpm_client.mjs';
import { FreshnessAnchorSim } from '../../sim/tpm/manifest_seal_sim.mjs';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const sim = isSimEnabled();
const simTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);

const NV = '0x1500011';
const MAN = 'root-of-trust.manifest.json';
const STAGED = 'root-of-trust.manifest.staged.json';
const TOKEN = 'token-state.json';

function body(anchor, counter, certify = null) {
  return {
    version: 3, instanceId: 'inst-tear', sequence: 2, anchoredCount: 0, haltEpoch: 0,
    ledgerCommitted: 0, journalHead: 'j', tpm: {
      akName: anchor.akName, nvIndexName: anchor.nvIndexName, counter, certify,
    },
  };
}
function writeMan(dir, b) { writeFileSync(join(dir, MAN), JSON.stringify(b)); }
function writeStaged(dir, b) { writeFileSync(join(dir, STAGED), JSON.stringify(b)); }
// حالةُ التوكنِ البرمجيِّ المُحاكى على القرص: التوكنُ يختمُ المتنَ الملتزمَ،
// فآخرُ عدّادٍ مختومٍ داخلَهُ يطابقُ عدّادَ المتنِ المكتوبِ في كل بناءٍ يدويّ.
function writeToken(dir, counter) {
  writeFileSync(join(dir, TOKEN), JSON.stringify({ tokenSerial: 'sim-token-inst-tear', sealEpoch: 1, lastSealedCounter: counter }));
}

async function setup() {
  await tpm.nvUndefine(NV);
  await tpm.nvDefineCounter(NV);
  const root = 'sim/tpm/_tear/root';
  rmSync(root, { recursive: true, force: true });
  const a = new FreshnessAnchorSim(root, tpm, 'ak-tear', 'nv-tear', NV);
  await a.provision('inst-tear'); // يهيّئ العدّاد ويضبط body.counter = C0
  return { a, root };
}

// 1) HEALTHY: no staged, body.counter === C, certify صالحة
simTest('tear 1: HEALTHY ⇒ RUNNING', async () => {
  const { a } = await setup();
  const s = await a.seal(); // ينتج شهادة صالحة، body.counter == TPM counter
  assert.equal(s.ok, true);
  const rec = await a.recover();
  assert.equal(rec.state, 'running');
});

// 2) staged قبل الزيادة: staged.counter == C+1, body.counter == C ⇒ تجاهل staged، RUNNING
simTest('tear 2: staged قبل الزيادة ⇒ تجاهل staged', async () => {
  const { a, root } = await setup();
  const C = await a.readCounter();
  writeMan(root, body(a, C));              // المتن الملتزم = C
  writeToken(root, C);                     // التوكنُ ختمَ المتنَ الملتزمَ
  writeStaged(root, body(a, C + 1));       // staged = C+1 (قبل الزيادة)
  const rec = await a.recover();
  assert.equal(rec.state, 'running');
  assert.equal(rec.recovered, 'discard-staged');
});

// 3) staged بعد الزيادة قبل الإتمام: staged.counter == C, body.counter == C-1 ⇒ recertify+complete
simTest('tear 3: staged بعد الزيادة ⇒ recertify-complete', async () => {
  const { a, root } = await setup();
  // أدِّ العدّاد إلى C، والمتن الملتزم عند C-1، وstaged عند C.
  await a.seal(); // now body == TPM == C0+1
  const C = await a.readCounter();
  writeMan(root, body(a, C - 1));           // المتن الملتزم متخلّف
  writeToken(root, C - 1);                  // التوكنُ ختمَ آخرَ متنٍ مكتملٍ (C-1)
  writeStaged(root, body(a, C));            // staged عند C (بعد الزيادة)
  const rec = await a.recover();
  assert.equal(rec.state, 'running');
  assert.equal(rec.recovered, 'recertify-complete');
});

// 4) staged غير مطابق ⇒ STATE_MANIFEST_TPM_TORN
simTest('tear 4: staged غير مطابق ⇒ TORN', async () => {
  const { a, root } = await setup();
  const C = await a.readCounter();
  writeMan(root, body(a, C));
  writeToken(root, C);
  writeStaged(root, body(a, C + 5)); // غير مطابق لـ C أو C+1
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_MANIFEST_TPM_TORN');
});

// 5) body.counter > TPM (المتقدّم) ⇒ MISMATCH (تزوير/رجوع أمامي)
simTest('tear 5: body يتقدّم على العدّاد ⇒ MISMATCH', async () => {
  const { a, root } = await setup();
  const C = await a.readCounter();
  writeMan(root, body(a, C + 1)); // body > TPM
  writeToken(root, C + 1);
  if (existsSync(join(root, STAGED))) rmSync(join(root, STAGED));
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_TPM_COUNTER_MISMATCH');
  assert.equal(rec.direction, 'body-ahead');
});

// 6) body.counter < TPM، لا staged (إعادة) ⇒ MISMATCH (replay)
simTest('tear 6: replay ⇒ MISMATCH', async () => {
  const { a, root } = await setup();
  await a.seal();
  const C = await a.readCounter();
  writeMan(root, body(a, C - 1)); // body < TPM
  writeToken(root, C - 1);
  if (existsSync(join(root, STAGED))) rmSync(join(root, STAGED));
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_TPM_COUNTER_MISMATCH');
  assert.equal(rec.direction, 'replay');
});

// 7) شهادة مُلبّدة ⇒ STATE_TPM_ATTEST_INVALID
simTest('tear 7: شهادة تالفة ⇒ ATTEST_INVALID', async () => {
  const { a, root } = await setup();
  const s = await a.seal();
  assert.equal(s.ok, true);
  const man = a.readManifest();
  // العبث بتوقيع الشهادة
  man.tpm.certify.signature = '00'.repeat(64);
  writeMan(root, man);
  if (existsSync(join(root, STAGED))) rmSync(join(root, STAGED));
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_TPM_ATTEST_INVALID');
});

// ── حالات الانقطاع عبر نقاط التعليق في مسار الختم نفسه (hooks) ──
// تُحاكي انقطاعَ العملية في كل نقطة من ترتيب الكتابة الذرّي (§4.4 خطوات 1–6)،
// ثم يُستدعى recover() كما لو أُعيد الإقلاع بعد الانقطاع.

// 8) انقطاع قبل زيادة العدّاد (بين الخطوتين 2 و3)
simTest('tear 8: انقطاع قبل زيادة العدّاد (hook) ⇒ تجاهل staged والمتابعة', async () => {
  const { a } = await setup();
  await assert.rejects(
    () => a.seal({ beforeIncrement() { throw new Error('TEAR_BEFORE_INCREMENT'); } }),
    /TEAR_BEFORE_INCREMENT/,
  );
  // staged موجود (C+1) والعدّاد لم يُزَد (C) والمتن الملتزم عند C
  const rec = await a.recover();
  assert.equal(rec.state, 'running');
  assert.equal(rec.recovered, 'discard-staged');
});

// 9) انقطاع بعد الزيادة وقبل الشهادة (بين الخطوتين 3 و4)
simTest('tear 9: انقطاع بعد الزيادة وقبل certify (hook) ⇒ recertify-complete', async () => {
  const { a } = await setup();
  await assert.rejects(
    () => a.seal({ beforeCertify() { throw new Error('TEAR_BEFORE_CERTIFY'); } }),
    /TEAR_BEFORE_CERTIFY/,
  );
  // staged عند C+1 (بلا شهادة)، العدّاد صار C+1، المتن الملتزم عند C
  const rec = await a.recover();
  assert.equal(rec.state, 'running');
  assert.equal(rec.recovered, 'recertify-complete');
  assert.equal(rec.counter, rec.bodyCounter);
});

// 10) انقطاع بعد الشهادة وقبل rename (بين الخطوتين 4 و5)
simTest('tear 10: انقطاع بعد certify وقبل rename (hook) ⇒ recertify-complete', async () => {
  const { a } = await setup();
  await assert.rejects(
    () => a.seal({ beforeRename() { throw new Error('TEAR_BEFORE_RENAME'); } }),
    /TEAR_BEFORE_RENAME/,
  );
  // نفس الحالة على القرص: staged عند C+1، العدّاد C+1، المتن الملتزم عند C
  const rec = await a.recover();
  assert.equal(rec.state, 'running');
  assert.equal(rec.recovered, 'recertify-complete');
});

// 11) انقطاع بعد rename وقبل حذف staged (بين الخطوتين 5 و6)
simTest('tear 11: انقطاع بعد rename وقبل حذف staged (hook) ⇒ إتمام خامد التكرار', async () => {
  const { a } = await setup();
  await assert.rejects(
    () => a.seal({ beforeUnlinkStaged() { throw new Error('TEAR_BEFORE_UNLINK'); } }),
    /TEAR_BEFORE_UNLINK/,
  );
  // المتن الملتزم صار C+1 بالشهادة، وstaged ما زال موجوداً عند C+1
  const rec = await a.recover();
  assert.equal(rec.state, 'running');
  assert.equal(rec.recovered, 'recertify-complete');
  // إعادة التنفيذ بعد «إعادة إقلاع» أخرى: نفس الحالة، لا تغيير — خاملة التكرار
  const rec2 = await a.recover();
  assert.equal(rec2.state, 'running');
  assert.equal(rec2.bodyCounter, rec2.counter);
});

// 12) إعادة التنفيذ بعد restart: recover متكرر لا يغيّر شيئاً (خمول التكرار)
simTest('tear 12: إعادة recover بعد تعافٍ ناجح ⇒ نفس الحالة بلا تغيير', async () => {
  const { a } = await setup();
  const s = await a.seal();
  assert.equal(s.ok, true);
  const r1 = await a.recover();
  const r2 = await a.recover();
  const r3 = await a.recover();
  assert.deepEqual([r1.state, r2.state, r3.state], ['running', 'running', 'running']);
  assert.equal(r3.counter, r1.counter);
  assert.equal(r3.bodyCounter, r1.bodyCounter);
});

// 13) العدّاد متقدّم على body.counter بأكثر من واحد وبلا staged مطابق
//     ملاحظة تصنيفية: جدول §4.4 يسمّي هذه الحالة TORN («تمزّق أو عبث»)،
//     بينما يفرض §4.8 رمز MISMATCH لسيناريو الإعادة. المحاكاة تحسمها
//     إغلاقاً برمز MISMATCH (direction=replay) — كلتاهما إغلاقٌ لا إقلعاً.
//     يُسجَّل هذا التفاوت التسميوي كسؤالٍ مفتوح لصاحب ADR 0007 (يبقى proposed).
simTest('tear 13: العدّاد متقدّم بأكثر من واحد بلا staged ⇒ إغلاق MISMATCH', async () => {
  const { a, root } = await setup();
  await a.seal();
  await a.seal(); // يتقدّم العدّاد خطوتين
  const C = await a.readCounter();
  writeMan(root, body(a, C - 3)); // المتن متخلّف بأكثر من واحد
  writeToken(root, C - 3);
  if (existsSync(join(root, STAGED))) rmSync(join(root, STAGED));
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_TPM_COUNTER_MISMATCH');
  assert.equal(rec.direction, 'replay');
  // لا إقلعاً لاحقاً: الأمر المكرر يُرفض
  await assert.rejects(() => a.seal(), /HALTED/);
});

// 14) التوكنُ البرمجيُّ وحدهُ متخلّفٌ عن المتنِ (أو متقدّمٌ عليه) ⇒ تمزّقٌ لا إقلاعَ.
//     يمثّلُ استعادةَ لقطةِ توكنٍ قديمةٍ فوقَ متنٍ أحدثَ (والعكس) بلا تقدّمٍ في TPM.
simTest('tear 14: توكنٌ لا يطابقُ المتنَ ⇒ TORN (token-manifest-inconsistent)', async () => {
  const { a, root } = await setup();
  const C = await a.readCounter();
  writeMan(root, body(a, C));
  rmSync(join(root, STAGED), { force: true });
  // ختمُ توكنٍ أقدمَ منَ المتنِ الملتزمِ (C):
  writeToken(root, C - 1);
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_MANIFEST_TPM_TORN');
  assert.equal(rec.torn, 'token-manifest-inconsistent');
  assert.equal(rec.tokenSealedCounter, C - 1);
  assert.equal(rec.bodyCounter, C);
  // والعكسُ أيضاً: توكنٌ متقدّمٌ على المتنِ
  writeToken(root, C + 1);
  const rec2 = await a.recover();
  assert.equal(rec2.state, 'halted');
  assert.equal(rec2.error, 'STATE_MANIFEST_TPM_TORN');
  assert.equal(rec2.torn, 'token-manifest-inconsistent');
});
