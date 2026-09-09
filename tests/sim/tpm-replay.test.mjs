// @ts-nocheck
// tests/sim/tpm-replay.test.mjs
//
// اختبار الإعادة الكامل (full-snapshot replay):
// يُثبت أن استعادة لقطة قديمة من ملفات الجذر (body.counter قديمة) فوق عدّاد TPM
// متقدّم يُنتج STATE_TPM_COUNTER_MISMATCH، ويبقى الإغلاق، ويُرفض أي أمر لاحق.
//
// لا تشمل اللقطة حالة TPM (عمداً) — وهذا أساس كشف الإعادة.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSimEnabled } from '../../sim/tpm/tcti_guard.mjs';
import * as tpm from '../../sim/tpm/tpm_client.mjs';
import { FreshnessAnchorSim, snapshotState, restoreState } from '../../sim/tpm/manifest_seal_sim.mjs';
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sim = isSimEnabled();
const simTest = (name, fn) =>
  test(name, { skip: !sim ? 'swtpm/XUUX_TPM_SIM unavailable' : false }, fn);

const NV = '0x1500010';

simTest('replay: لقطة قديمة فوق عدّاد متقدّم ⇒ MISMATCH + إغلاق دائم + رفض', async () => {
  const root = 'sim/tpm/_replay/root';
  const snap = 'sim/tpm/_replay/snap';
  rmSync(root, { recursive: true, force: true });
  rmSync(snap, { recursive: true, force: true });

  await tpm.nvUndefine(NV);
  await tpm.nvDefineCounter(NV);

  const a = new FreshnessAnchorSim(root, tpm, 'ak-replay', 'nv-replay', NV);
  await a.provision('inst-replay');

  // ختم ناجح #1
  const s1 = await a.seal();
  assert.equal(s1.ok, true, 'seal1 should succeed');

  // لقطة لملفات الجذر فقط (لا تشمل TPM)
  snapshotState(root, snap);

  // ختم ناجح #2 — يُقدّم عدّاد TPM
  const s2 = await a.seal();
  assert.equal(s2.ok, true, 'seal2 should succeed');
  assert.ok(s2.counter > s1.counter, 'counter must advance');

  // استعد اللقطة القديمة: body.counter = s1.counter، لكن TPM = s2.counter
  // اللقطةُ تشملُ التوكنَ البرمجيَّ المُحاكى (token-state.json) — استُعيدَ معها
  // فكانت الحالةُ المُستعادةُ كلُّها متّسقةً داخليّاً (توكنٌ ومتنٌ من عصرِ s1).
  restoreState(snap, root);
  const tokenState = JSON.parse(readFileSync(join(root, 'token-state.json'), 'utf8'));
  assert.equal(tokenState.lastSealedCounter, s1.counter, 'old software-token state must be the restored one');

  // التعافي يجب أن يكشف الإعادة ويُغلق
  const rec = await a.recover();
  assert.equal(rec.state, 'halted', 'must halt on replay');
  assert.equal(rec.error, 'STATE_TPM_COUNTER_MISMATCH');
  assert.equal(rec.direction, 'replay');
  assert.equal(rec.bodyCounter, s1.counter);
  assert.equal(rec.counter, s2.counter);

  // الإغلاق دائم: أمر ختم لاحق يُرفض
  await assert.rejects(() => a.seal(), /HALTED/);

  // ولا يُرفع الإغلاق بإعادة recover
  const rec2 = await a.recover();
  assert.equal(rec2.state, 'halted');
});
