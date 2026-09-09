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
