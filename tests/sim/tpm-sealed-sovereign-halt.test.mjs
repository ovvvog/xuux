// @ts-nocheck
// tests/sim/tpm-sealed-sovereign-halt.test.mjs
//
// WL-374 — الإيقافُ السياديُّ في المحاكي **مختومٌ داخلَ المتنِ ويُقدِّمُ عدّادَ TPM**،
// لا علامةٌ في ملفٍّ غيرِ مختومٍ.
//
// ما قيسَ قبلَ هذه الدفعةِ على `main@01085e8a` (‏بعدَ WL-372): الإيقافُ السياديُّ كانَ
// يُعرَفُ من `halt.json` وحدَه (`epoch: 1`) — ملفٌّ خارجَ الختمِ وخارجَ العدّادِ. فحذفُه
// (‏أو الكتابةُ فوقَه) يُعيدُ `recover()` إلى `running`، ومسارُ `STATE_TPM_INDEX_MISSING`
// يكتبُ فوقَه `epoch: 0` فيُفتَحُ الإيقافُ عندَ عودةِ TPM. وهذا يُخالفُ ADR 0007 §4.8
// («أمرٌ موقَّعٌ + إيقافٌ سياديٌّ، فيتقدّمُ العدّادُ … ويبقى الإيقافُ قائماً»).
//
// محاكي swtpm فقط — لا يُثبِتُ شيئاً عن TPM حقيقيٍّ (‏ADR 0007 §9).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import * as tpm from '../../sim/tpm/tpm_client.mjs';
import { FreshnessAnchorSim, snapshotState, restoreState } from '../../sim/tpm/manifest_seal_sim.mjs';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sim = isSimEnabled();
const simTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);

const NV = '0x1500012';
const BASE = 'sim/tpm/_sovereign';
const MAN = 'root-of-trust.manifest.json';
const STAGED = 'root-of-trust.manifest.staged.json';
const HALT_FILE = 'halt.json';

async function setup(name) {
  await tpm.nvUndefine(NV);
  await tpm.nvDefineCounter(NV);
  const root = join(BASE, name);
  rmSync(root, { recursive: true, force: true });
  const a = new FreshnessAnchorSim(root, tpm, 'ak-sov', 'nv-sov', NV);
  await a.provision('inst-sov');
  const s = await a.seal();
  assert.equal(s.ok, true);
  return { a, root };
}

/** عميلُ TPM يُحاكي غيابَ الفهرسِ/العتادِ مؤقّتاً (‏rc ≠ 0) — لا يمسُّ swtpm. */
const tpmDown = Object.freeze({
  nvReadCounter: async () => ({ rc: 1, counter: null }),
  nvIncrement: async () => ({ rc: 1 }),
});

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

simTest('sovereign 1: haltSovereign() يختمُ الإيقافَ في المتنِ ويُقدِّمُ العدّادَ', async (t) => {
  const { a, root } = await setup('s1');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = await a.readCounter();
  const h = await a.haltSovereign('owner-order');
  assert.equal(h.ok, true);
  assert.equal(await a.readCounter(), before + 1, 'الإيقافُ السياديُّ يُقدِّمُ عدّادَ TPM');
  const body = readJson(join(root, MAN));
  assert.equal(body.halted, true);
  assert.equal(body.tpm.counter, before + 1);
  assert.ok(body.tpm.certify, 'المتنُ الموقوفُ مشهودٌ كغيرِه');
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_HALT_SOVEREIGN');
  await assert.rejects(() => a.seal(), /HALTED/);
});

simTest('sovereign 2: حذفُ halt.json لا يفتحُ الإيقافَ السياديَّ المختومَ', async (t) => {
  const { a, root } = await setup('s2');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal((await a.haltSovereign('owner-order')).ok, true);
  rmSync(join(root, HALT_FILE));
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_HALT_SOVEREIGN');
  // والختمُ مرفوضٌ ولو غابَ الملفُّ — الحكمُ للمتنِ لا للعلامةِ
  rmSync(join(root, HALT_FILE), { force: true });
  await assert.rejects(() => a.seal(), /HALTED/);
});

simTest('sovereign 3: الكتابةُ فوقَ halt.json بـrunning لا تفتحُ الإيقافَ المختومَ', async (t) => {
  const { a, root } = await setup('s3');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal((await a.haltSovereign('owner-order')).ok, true);
  writeFileSync(join(root, HALT_FILE), JSON.stringify({ state: 'running', epoch: 0 }));
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_HALT_SOVEREIGN');
});

simTest('sovereign 4: غيابُ TPM أثناءَ الإيقافِ لا يُخفِّضُه — وعودتُه لا تفتحُه', async (t) => {
  const { a, root } = await setup('s4');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // الصيغةُ القديمةُ (‏halt.json وحدَه، WL-372) — تبقى محترَمةً: أيُّ دليلِ إيقافٍ سياديٍّ يُبقيه
  writeFileSync(join(root, HALT_FILE), JSON.stringify({ state: 'halted', epoch: 1 }));
  const down = new FreshnessAnchorSim(root, tpmDown, 'ak-sov', 'nv-sov', NV);
  const r1 = await down.recover();
  assert.equal(r1.state, 'halted');
  assert.equal(r1.error, 'STATE_TPM_INDEX_MISSING');
  assert.equal(readJson(join(root, HALT_FILE)).epoch, 1, 'مسارُ غيابِ TPM لا يكتبُ epoch=0 فوقَ إيقافٍ سياديٍّ');
  const r2 = await a.recover();
  assert.equal(r2.state, 'halted');
  assert.equal(r2.error, 'STATE_HALT_SOVEREIGN');
});

simTest('sovereign 5: غيابُ TPM مع إيقافٍ مختومٍ ثمّ حذفُ الملفِّ ⇒ يبقى موقوفاً', async (t) => {
  const { a, root } = await setup('s5');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal((await a.haltSovereign('owner-order')).ok, true);
  const down = new FreshnessAnchorSim(root, tpmDown, 'ak-sov', 'nv-sov', NV);
  assert.equal((await down.recover()).error, 'STATE_TPM_INDEX_MISSING');
  rmSync(join(root, HALT_FILE), { force: true });
  const r = await a.recover();
  assert.equal(r.state, 'halted');
  assert.equal(r.error, 'STATE_HALT_SOVEREIGN');
});

simTest('sovereign 6: استعادةُ لقطةِ ما قبلَ الإيقافِ كاملةً ⇒ MISMATCH لا running (‏ADR 0007 §4.8)', async (t) => {
  const { a, root } = await setup('s6');
  const snap = join(BASE, 's6-snap');
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(snap, { recursive: true, force: true });
  });
  rmSync(snap, { recursive: true, force: true });
  snapshotState(root, snap);
  assert.equal((await a.haltSovereign('owner-order')).ok, true);
  restoreState(snap, root); // المتنُ والتوكنُ وhalt.json من عصرِ ما قبلَ الإيقافِ
  const rec = await a.recover();
  assert.equal(rec.state, 'halted');
  assert.equal(rec.error, 'STATE_TPM_COUNTER_MISMATCH');
  assert.equal(rec.direction, 'replay');
});

simTest('sovereign 7: انقطاعٌ بعدَ زيادةِ العدّادِ قبلَ إتمامِ الإيقافِ ⇒ التعافي يُتمُّه موقوفاً لا running', async (t) => {
  const { a, root } = await setup('s7');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(
    () => a.haltSovereign('owner-order', { beforeCertify() { throw new Error('TEAR_HALT_AFTER_INC'); } }),
    /TEAR_HALT_AFTER_INC/,
  );
  assert.equal(readJson(join(root, STAGED)).halted, true);
  const r1 = await a.recover();
  assert.equal(r1.state, 'halted');
  assert.equal(r1.error, 'STATE_HALT_SOVEREIGN');
  assert.equal(r1.recovered, 'recertify-complete');
  assert.equal(readJson(join(root, MAN)).halted, true, 'المتنُ المُستكمَلُ موقوفٌ');
  assert.equal(existsSync(join(root, STAGED)), false);
  // التكرارُ خاملٌ: يبقى سياديّاً لا إغلاقاً زائفاً
  const r2 = await a.recover();
  assert.equal(r2.state, 'halted');
  assert.equal(r2.error, 'STATE_HALT_SOVEREIGN');
});

simTest('sovereign 8: انقطاعٌ قبلَ زيادةِ العدّادِ ⇒ الإيقافُ لم يُلتزَمْ ولم يُعلَنْ نجاحُه', async (t) => {
  const { a, root } = await setup('s8');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = await a.readCounter();
  await assert.rejects(
    () => a.haltSovereign('owner-order', { beforeIncrement() { throw new Error('TEAR_HALT_BEFORE_INC'); } }),
    /TEAR_HALT_BEFORE_INC/,
  );
  assert.equal(await a.readCounter(), before);
  const r = await a.recover();
  // الحدُّ المُعلَنُ: لم يتقدّمِ العدّادُ فلم يُلتزَمِ الإيقافُ — ولم يُعَدْ لطالبِه نجاحٌ،
  // فعليه أن يُعيدَ الطلبَ. لا يُدَّعى إيقافٌ لم يُلتزَمْ.
  assert.equal(r.state, 'running');
  assert.equal(r.recovered, 'discard-staged');
  assert.notEqual(readJson(join(root, MAN)).halted, true);
});

simTest('sovereign 9: haltSovereign() مرفوضٌ فوقَ إغلاقِ عطبٍ — لا يُختَمُ متنٌ غيرُ متحقَّقٍ', async (t) => {
  const { a, root } = await setup('s9');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, HALT_FILE), JSON.stringify({ state: 'halted', epoch: 0 }));
  await assert.rejects(() => a.haltSovereign('owner-order'), /HALTED/);
});

simTest('sovereign 10: staged مصطنعٌ بالعدّادِ نفسِه بلا halted لا يستبدلُ المتنَ الموقوفَ', async (t) => {
  const { a, root } = await setup('s10');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal((await a.haltSovereign('owner-order')).ok, true);
  const committed = readJson(join(root, MAN));
  const forged = { ...committed, halted: false, tpm: { ...committed.tpm, certify: null } };
  writeFileSync(join(root, STAGED), JSON.stringify(forged)); // S === C === B
  rmSync(join(root, HALT_FILE), { force: true });
  const r = await a.recover();
  assert.equal(r.state, 'halted');
  assert.notEqual(r.state, 'running');
  assert.equal(readJson(join(root, MAN)).halted, true, 'المتنُ الموقوفُ لم يُستبدَلْ');
  await assert.rejects(() => a.seal(), /HALTED/);
});

simTest('sovereign 11: staged بالعدّادِ نفسِه (‏B === C) يختلفُ عن المتنِ الملتزمِ ⇒ TORN لا إعادةَ شهادة', async (t) => {
  const { a, root } = await setup('s11');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const committed = readJson(join(root, MAN));
  const forged = { ...committed, journalHead: 'forged-head', tpm: { ...committed.tpm, certify: null } };
  writeFileSync(join(root, STAGED), JSON.stringify(forged));
  const r = await a.recover();
  assert.equal(r.state, 'halted');
  assert.equal(r.error, 'STATE_MANIFEST_TPM_TORN');
  assert.equal(r.torn, 'staged-differs-from-committed');
  assert.equal(readJson(join(root, MAN)).journalHead, committed.journalHead, 'المتنُ الملتزمُ لم يُستبدَلْ');
});
