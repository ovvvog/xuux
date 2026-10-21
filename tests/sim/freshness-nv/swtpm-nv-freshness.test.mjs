// @ts-nocheck
// tests/sim/freshness-nv/swtpm-nv-freshness.test.mjs
//
// WL-431 — مجسُّ مرجعِ الحداثةِ على NV في **swtpm** (‏R3-A-01 / EXT-6). **محاكاةٌ وقياسٌ، لا عتاد.**
//
// يقيسُ الفجوةَ المحدّدة: ثباتُ مرجعِ الحداثةِ **خارجَ قرصِ بياناتِ التطبيقِ** عبرَ إعادةِ التشغيلِ
// واسترجاعِ لقطةٍ قديمة — على **جذرِ الثقةِ الحقيقيِّ** (‏`createProductionRootOfTrust` عبرَ
// `tests/helpers/wl-326-root.mjs`) فرموزُ الرفضِ من الشيفرةِ الحقيقيّةِ لا من المجسّ.
//
// كلُّ حالةٍ تُشغِّلُ swtpm خاصًّا بمجلدِ حالةٍ مؤقّتٍ ومنفذَينِ على loopback. لا `/dev/tpm*`.
// يُشغَّلُ بـ`XUUX_TPM_SIM=1` معَ `swtpm` و`tpm2-tools` (‏`scripts/tpm-sim-ci.sh` في CI)؛ ويُتخطّى
// بعلّتِه المعلنةِ خارجَهما.
//
// **الضابطُ السلبيُّ الإلزاميّ (‏T6):** استرجاعُ لقطةِ التطبيقِ **ولقطةِ حالةِ المحاكي معًا** يُقبَل —
// المرجعُ المحاكى ملفٌّ قابلٌ للاسترجاع، فلا يُثبتُ هذا المجسُّ مناعةً من استرجاعِ الحالةِ كلِّها.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FreshnessAdvanceError, FRESHNESS_GENESIS_ANCHOR } from '../../../src/root-of-trust/index.mjs';
import { SwtpmInstance, toolsAvailable } from '../../../sim/freshness-nv/swtpm-harness.mjs';
import {
  NV_PROBE_CODES,
  RECORD_SIZE,
  SwtpmNvStateBoundSocket,
  encodeRecord,
} from '../../../sim/freshness-nv/nv-state-bound-socket.mjs';
import { registerTmpRoot } from '../../helpers/tmp-roots.mjs';
import { bootRoot, makeKeys } from '../../helpers/wl-326-root.mjs';

const CHILD = fileURLToPath(new URL('../../../sim/freshness-nv/child.mjs', import.meta.url));
const COUNTER = '0x01500030';
const RECORD = '0x01500031';

const enabled = process.env.XUUX_TPM_SIM === '1' && (await toolsAvailable());
const skip = enabled ? false : 'يتطلّبُ XUUX_TPM_SIM=1 معَ swtpm وtpm2-tools (‏scripts/tpm-sim-ci.sh)';

const anchor = (label) => createHash('sha256').update(`wl-431:${label}`).digest('hex');
const at = (epoch, label) => ({
  epoch: BigInt(epoch),
  anchor: label === 'genesis' ? FRESHNESS_GENESIS_ANCHOR : anchor(label),
});

/** بيئةٌ معزولة: swtpm بمجلدِ حالةٍ خاصٍّ، وجذرُ تطبيقٍ، ومجلدُ أقفالٍ — كلُّها خارجَ الشجرة. */
async function lab() {
  const base = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl431-fnv-')));
  const sw = new SwtpmInstance({ stateDir: join(base, 'swtpm-state') });
  mkdirSync(sw.stateDir, { recursive: true });
  await sw.start();
  const lockDir = join(base, 'locks');
  const socket = (opts = {}) =>
    new SwtpmNvStateBoundSocket({
      tools: () => sw.tools(),
      counterIndex: COUNTER,
      recordIndex: RECORD,
      lockDir,
      ...opts,
    });
  return {
    base,
    sw,
    lockDir,
    root: join(base, 'app-root'),
    socket,
    cleanup: async () => {
      await sw.dispose();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

/** يُشغِّلُ عمليّةَ عميلٍ مستقلّة. */
function child(env, spec) {
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [
        CHILD,
        JSON.stringify({
          tcti: env.sw.tcti,
          counterIndex: COUNTER,
          recordIndex: RECORD,
          lockDir: env.lockDir,
          ...spec,
          from: spec.from && { epoch: spec.from.epoch.toString(), anchor: spec.from.anchor },
          to: spec.to && { epoch: spec.to.epoch.toString(), anchor: spec.to.anchor },
        }),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => {
      out += d;
    });
    proc.stderr.on('data', (d) => {
      err += d;
    });
    proc.on('close', (code, signal) => {
      const line = out.trim().split('\n').filter(Boolean).pop();
      resolve({ code, signal, result: line ? JSON.parse(line) : null, stderr: err });
    });
  });
}

const sameReading = (actual, expected) => {
  assert.equal(String(actual.epoch), String(expected.epoch));
  assert.equal(actual.anchor, expected.anchor);
};

async function rejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفَعْ خطأ');
}

/** أمرٌ يُثبَّتُ عبرَ الحاجزِ كما في `wl-326-commit-barrier.test.mjs`. */
async function commitCommand(runtime, id) {
  await runtime.ledger.transactAsync('crown.command', async () => {
    runtime.ledger.begin({ id });
    await runtime.ledger.commitSigned({ id });
  });
}

/** نتيجةٌ لا تُحسَمُ على الجذرِ الحقيقيّ: المحاكي يسقطُ قبلَ الزيادةِ أو بعدَها في منتصفِ الحاجز. */
async function unresolvedCase(env, keys, where) {
  const s = env.socket();
  const hook = async () => {
    await env.sw.stop('SIGKILL');
  };
  s.hooks = where === 'before' ? { beforeIncrement: hook } : { afterIncrement: hook };
  const first = await bootRoot(env.root, keys, s);
  const error = await rejection(() => commitCommand(first, `cmd-unknown-${where}`));
  assert.equal(error.code, 'FRESHNESS_ADVANCE_UNRESOLVED', `${where}: ${error.code}`);
  assert.equal((await rejection(() => commitCommand(first, 'x'))).code, 'COMMIT_BARRIER_FENCED');
  await first.close();
  const fresh = env.socket();
  assert.equal((await rejection(() => bootRoot(env.root, keys, fresh))).code, 'FRESHNESS_SOURCE_UNAVAILABLE');
  await env.sw.start();
  const recovered = await bootRoot(env.root, keys, fresh);
  assert.equal(recovered.freshnessBoot, where === 'before' ? 'B2' : 'B3');
  assert.equal(recovered.ledger.state(`cmd-unknown-${where}`), where === 'before' ? 'unknown' : 'committed');
  await recovered.close();
}

describe('WL-431 — مرجعُ الحداثةِ على NV في swtpm (محاكاةٌ لا عتاد)', { skip }, () => {
  test('T1 المرجعُ يدومُ عبرَ إنهاءِ عمليّةِ العميلِ وإعادةِ تشغيلِها، وعبرَ إعادةِ تشغيلِ swtpm (SIGTERM وSIGKILL)', async () => {
    const env = await lab();
    try {
      const p = await child(env, { op: 'provision' });
      assert.equal(p.code, 0, p.stderr);
      const a = await child(env, { op: 'advance', from: at(0, 'genesis'), to: at(1, 'a1') });
      assert.equal(a.code, 0, JSON.stringify(a.result));
      // عمليّةٌ جديدةٌ تقرأُ ما كتبَتْه عمليّةٌ انتهت.
      const r1 = await child(env, { op: 'read' });
      assert.equal(r1.code, 0);
      sameReading(r1.result.reading, at(1, 'a1'));
      const base = BigInt(p.result.base);
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        await env.sw.restart(signal);
        const r = await child(env, { op: 'read' });
        assert.equal(r.code, 0, `${signal}: ${JSON.stringify(r.result)}`);
        sameReading(r.result.reading, at(1, 'a1'));
        const raw = await env.socket().inspect();
        assert.equal(raw.counter, base + 1n, `${signal}: العدّادُ لم يتغيّرْ بإعادةِ التشغيل`);
        assert.equal(raw.record.phase, 0);
      }
      assert.equal(env.sw.starts, 3);
    } finally {
      await env.cleanup();
    }
  });

  test('T2 الجذرُ الحقيقيّ: لقطةُ التطبيقِ الحاليّةُ تُقبَل (B1)، واسترجاعُ لقطةِ التطبيقِ وحدَها أقدمَ يُرفَضُ STALE_MANIFEST_EPOCH', async () => {
    const env = await lab();
    try {
      await env.socket().provision();
      const keys = makeKeys();
      let runtime = await bootRoot(env.root, keys, env.socket());
      await commitCommand(runtime, 'cmd-1');
      await runtime.close();
      const old = join(env.base, 'app-old');
      cpSync(env.root, old, { recursive: true });
      // عمليّةٌ «جديدةٌ» ومحاكٍ أُعيدَ تشغيلُه: نسخةُ مقبسٍ جديدةٌ لا ذاكرةَ لها.
      await env.sw.restart('SIGKILL');
      runtime = await bootRoot(env.root, keys, env.socket());
      await commitCommand(runtime, 'cmd-2');
      await runtime.close();
      const current = join(env.base, 'app-current');
      cpSync(env.root, current, { recursive: true });
      const reference = await env.socket().read();

      rmSync(env.root, { recursive: true, force: true });
      cpSync(old, env.root, { recursive: true });
      const stale = await rejection(() => bootRoot(env.root, keys, env.socket()));
      assert.equal(stale.code, 'STALE_MANIFEST_EPOCH');
      sameReading(await env.socket().read(), reference); // الرفضُ لا يحرّكُ المرجع

      rmSync(env.root, { recursive: true, force: true });
      cpSync(current, env.root, { recursive: true });
      runtime = await bootRoot(env.root, keys, env.socket());
      assert.equal(runtime.freshnessBoot, 'B1');
      assert.equal(runtime.ledger.state('cmd-2'), 'committed');
      await runtime.close();
    } finally {
      await env.cleanup();
    }
  });

  test('T3 تقدّمٌ متتابع، وإعادةُ المحاولةِ بالحُجَجِ نفسِها بعدَ نتيجةٍ مجهولةٍ تطبِّقُ مرّةً واحدة، والانتقالاتُ القديمةُ والمتفرّعةُ تُرفَضُ برمزِها', async () => {
    const env = await lab();
    try {
      const s = env.socket();
      const { base } = await s.provision();
      sameReading(await s.advanceState(at(0, 'genesis'), at(1, 'a1')), at(1, 'a1'));
      sameReading(await s.advanceState(at(1, 'a1'), at(2, 'a2')), at(2, 'a2'));

      // سقوطُ الردِّ بعدَ الالتزامِ (‏بعدَ الزيادةِ وقبلَ إتمامِ السجلّ): المرجعُ تقدّم، والإعادةُ ⇒ `already`.
      // سقوطٌ قبلَ أيِّ كتابة: لا أثر.
      s.faults.push('throw-before-apply');
      assert.equal((await rejection(() => s.advanceState(at(2, 'a2'), at(3, 'a3')))).code, NV_PROBE_CODES.TRANSPORT_LOST);
      assert.equal((await s.inspect()).counter, base + 2n);
      assert.equal((await s.inspect()).record.phase, 0);

      s.faults.push('throw-after-increment');
      assert.equal((await rejection(() => s.advanceState(at(2, 'a2'), at(3, 'a3')))).code, NV_PROBE_CODES.TRANSPORT_LOST);
      let raw = await s.inspect();
      assert.equal(raw.record.phase, 1);
      assert.equal(raw.reference.pending, 'after-increment');
      sameReading(await s.read(), at(3, 'a3'));
      sameReading(await s.advanceState(at(2, 'a2'), at(3, 'a3')), at(3, 'a3'));
      raw = await s.inspect();
      assert.equal(raw.counter, base + 3n, 'زيادةٌ واحدةٌ لا اثنتان');
      assert.equal(raw.record.phase, 0);

      // سقوطٌ بعدَ كتابةِ القصدِ وقبلَ الزيادة: لم يتقدّم، والإعادةُ بالحُجَجِ نفسِها تُكمل.
      s.faults.push('throw-after-intent');
      assert.equal((await rejection(() => s.advanceState(at(3, 'a3'), at(4, 'a4')))).code, NV_PROBE_CODES.TRANSPORT_LOST);
      raw = await s.inspect();
      assert.equal(raw.reference.pending, 'before-increment');
      assert.equal(raw.counter, base + 3n);
      sameReading(await s.read(), at(3, 'a3'));
      sameReading(await s.advanceState(at(3, 'a3'), at(4, 'a4')), at(4, 'a4'));
      assert.equal((await s.inspect()).counter, base + 4n);

      // رفضٌ مسمّىً بلا أيِّ زيادة.
      const named = [
        [at(2, 'a2'), at(3, 'x3'), 'FRESHNESS_STALE_TRANSITION'],
        [at(3, 'a3'), at(4, 'x4'), 'FRESHNESS_STALE_TRANSITION'],
        [at(4, 'wrong'), at(5, 'a5'), 'FRESHNESS_SAME_EPOCH_FORK'],
        [at(6, 'a6'), at(7, 'a7'), 'FRESHNESS_REFERENCE_BEHIND'],
        [at(4, 'a4'), at(6, 'a6'), 'FRESHNESS_ADVANCE_INVALID'],
        [at(4, 'a4'), { epoch: 5n, anchor: 'not-hex' }, 'FRESHNESS_ADVANCE_INVALID'],
      ];
      for (const [from, to, code] of named) {
        const error = await rejection(() => s.advanceState(from, to));
        assert.ok(error instanceof FreshnessAdvanceError, `${code}: رفضٌ مسمّىً لا خطأٌ مجهول`);
        assert.equal(error.code, code);
      }
      assert.equal((await s.inspect()).counter, base + 4n, 'الرفضُ لا يزيدُ العدّاد');

      // SIGKILL لعمليّةِ العميلِ بعدَ القصد، ثمّ بعدَ الزيادة — والقفلُ الميّتُ يُستعاد.
      const k1 = await child(env, { op: 'advance', from: at(4, 'a4'), to: at(5, 'a5'), faults: ['kill-after-intent'] });
      assert.equal(k1.signal, 'SIGKILL');
      assert.ok(existsSync(s.lockFile), 'القفلُ بقيَ من العمليّةِ الميّتة');
      sameReading(await s.read(), at(4, 'a4'));
      const k1r = await child(env, { op: 'advance', from: at(4, 'a4'), to: at(5, 'a5') });
      assert.equal(k1r.code, 0, JSON.stringify(k1r.result));
      assert.equal((await s.inspect()).counter, base + 5n);
      const k2 = await child(env, { op: 'advance', from: at(5, 'a5'), to: at(6, 'a6'), faults: ['kill-after-increment'] });
      assert.equal(k2.signal, 'SIGKILL');
      sameReading(await s.read(), at(6, 'a6'));
      const k2r = await child(env, { op: 'advance', from: at(5, 'a5'), to: at(6, 'a6') });
      assert.equal(k2r.code, 0);
      assert.equal(k2r.result.applied, 0, 'الإعادةُ بعدَ الالتزامِ لا تزيد');
      assert.equal((await s.inspect()).counter, base + 6n);
    } finally {
      await env.cleanup();
    }
  });

  test('T3b الجذرُ الحقيقيّ: ضياعُ الردِّ بعدَ الالتزامِ يحسمُه الحاجزُ بإعادةٍ واحدةٍ ولا يزيدُ مرّتين', async () => {
    const env = await lab();
    try {
      const s = env.socket();
      const { base } = await s.provision();
      const runtime = await bootRoot(env.root, makeKeys(), s);
      const before = (await s.inspect()).counter;
      s.faults.push('throw-after-increment');
      await commitCommand(runtime, 'cmd-lost-reply');
      assert.equal(runtime.ledger.state('cmd-lost-reply'), 'committed');
      const after = await s.inspect();
      assert.equal(after.counter, before + 1n, 'زيادةٌ واحدة');
      assert.ok(after.counter > base);
      // الحاجزُ حسمَ بالقراءة: السجلُّ قد يبقى «قصدًا بعدَ الزيادة» — ويُقرأُ ملتزمًا، والانتقالُ التالي يُتمُّه.
      if (after.record.phase === 1) assert.equal(after.reference.pending, 'after-increment');
      await commitCommand(runtime, 'cmd-next');
      const next = await s.inspect();
      assert.equal(next.counter, before + 2n);
      assert.equal(next.record.phase, 0);
      await runtime.close();
    } finally {
      await env.cleanup();
    }
  });

  test('T4 تقدّمانِ متزامنانِ من العهدِ نفسِه (داخلَ العمليّةِ وعبرَ عمليّتَين): واحدٌ يُقبَلُ وواحدٌ يُرفَضُ، والعدّادُ +1', async () => {
    const env = await lab();
    try {
      const { base } = await env.socket().provision();
      await env.socket().advanceState(at(0, 'genesis'), at(1, 'a1'));
      // داخلَ العمليّة: نسختانِ مستقلّتانِ تتشاركانِ مجلدَ الأقفال.
      const results = await Promise.allSettled([
        env.socket().advanceState(at(1, 'a1'), at(2, 'x')),
        env.socket().advanceState(at(1, 'a1'), at(2, 'y')),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const no = results.filter((r) => r.status === 'rejected');
      assert.equal(ok.length, 1);
      assert.equal(no.length, 1);
      assert.ok(no[0].reason instanceof FreshnessAdvanceError);
      assert.equal(no[0].reason.code, 'FRESHNESS_STALE_TRANSITION');
      let raw = await env.socket().inspect();
      assert.equal(raw.counter, base + 2n);
      sameReading(await env.socket().read(), ok[0].value);

      // عبرَ عمليّتَين تنطلقانِ معًا.
      const won = ok[0].value;
      const go = join(env.base, 'go');
      const pending = [
        child(env, { op: 'advance', from: won, to: at(3, 'p'), goFile: go }),
        child(env, { op: 'advance', from: won, to: at(3, 'q'), goFile: go }),
      ];
      await new Promise((r) => setTimeout(r, 300));
      writeFileSync(go, '1');
      const procs = await Promise.all(pending);
      const pOk = procs.filter((p) => p.code === 0);
      const pNo = procs.filter((p) => p.code !== 0);
      assert.equal(pOk.length, 1, JSON.stringify(procs.map((p) => p.result)));
      assert.equal(pNo.length, 1);
      assert.equal(pNo[0].result.code, 'FRESHNESS_STALE_TRANSITION');
      raw = await env.socket().inspect();
      assert.equal(raw.counter, base + 3n);
      sameReading(await env.socket().read(), pOk[0].result.reading);
    } finally {
      await env.cleanup();
    }
  });

  test('T4-ضابطٌ سالب: بلا قفلٍ لا يمنعُ TPM NV Counter زيادتَين — والمجسُّ يكشفُها فيرفضُ مغلقًا لا صامتًا', async () => {
    const env = await lab();
    try {
      const { base } = await env.socket().provision();
      // الاثنانِ يقرآنِ قبلَ أن يكتبَ أيٌّ منهما (‏تشابكٌ حتميٌّ بحاجزٍ).
      let arrived = 0;
      let open;
      const gate = new Promise((r) => {
        open = r;
      });
      const afterRead = async () => {
        arrived += 1;
        if (arrived === 2) open();
        await gate;
      };
      const a = env.socket({ unsafeNoLock: true });
      const b = env.socket({ unsafeNoLock: true });
      a.hooks.afterRead = afterRead;
      b.hooks.afterRead = afterRead;
      const results = await Promise.allSettled([
        a.advanceState(at(0, 'genesis'), at(1, 'x')),
        b.advanceState(at(0, 'genesis'), at(1, 'y')),
      ]);
      assert.ok(
        results.some((r) => r.status === 'rejected' && r.reason.code === NV_PROBE_CODES.CONCURRENT_INCREMENT),
        JSON.stringify(results.map((r) => r.status === 'rejected' ? r.reason.code : 'ok')),
      );
      assert.ok(results.some((r) => r.status === 'rejected'), 'لا يُقبَلُ الانتقالانِ المتعارضانِ معًا');
      const counter = await (async () => {
        try {
          return (await env.socket().inspect()).counter;
        } catch {
          return null;
        }
      })();
      assert.equal(counter, null, 'السجلُّ والعدّادُ متناقضانِ بعدَ الزيادتَين');
      const err = await rejection(() => env.socket().read());
      assert.equal(err.code, NV_PROBE_CODES.INCONSISTENT);
      // والعدّادُ نفسُه زادَ مرّتين — ما لا يمنعُه الـTPM.
      const tools = env.sw.tools();
      const raw = await tools.exec('tpm2_nvread', ['-C', 'o', '-s', '8', COUNTER]);
      assert.equal(raw.readBigUInt64BE(0), base + 2n);
    } finally {
      await env.cleanup();
    }
  });

  test('T5 فشلٌ مغلق: مرجعٌ لا يُقرأ، وأمرُ NV يفشلُ في منتصفِ الانتقال، ونتيجةٌ لا تُحسَم، وسجلٌّ تالفٌ أو مُرجَع', async () => {
    const env = await lab();
    try {
      const s = env.socket();
      const { base } = await s.provision();
      const keys = makeKeys();
      const runtime = await bootRoot(env.root, keys, s);
      await commitCommand(runtime, 'cmd-1');
      await runtime.close();

      // (أ) المحاكي متوقّف: القراءةُ والانتقالُ والإقلاعُ كلُّها تُرفَضُ — لا قيمةَ بديلة.
      await env.sw.stop('SIGKILL');
      assert.equal((await rejection(() => s.read())).code, NV_PROBE_CODES.SOURCE_UNAVAILABLE);
      const adv = await rejection(() => s.advanceState(at(0, 'genesis'), at(1, 'z')));
      assert.equal(adv.code, NV_PROBE_CODES.SOURCE_UNAVAILABLE);
      assert.ok(!(adv instanceof FreshnessAdvanceError));
      assert.equal((await rejection(() => bootRoot(env.root, keys, s))).code, 'FRESHNESS_SOURCE_UNAVAILABLE');
      await env.sw.start();

      // (ب) نتيجةٌ لا تُحسَم على الجذرِ الحقيقيّ: المحاكي يسقطُ قبلَ الزيادةِ ثمّ بعدَها.
      for (const where of ['before', 'after']) await unresolvedCase(env, keys, where);

      // (ج) سجلٌّ تالفٌ (‏تمزّقٌ أو عبثٌ) ⇒ INCONSISTENT؛ والإقلاعُ يُرفَض.
      const good = await s.inspect();
      const torn = encodeRecord({ ...good.record, cur: good.record.cur });
      torn[40] ^= 0xff;
      await s.writeRawRecordForTest(torn);
      assert.equal((await rejection(() => s.read())).code, NV_PROBE_CODES.INCONSISTENT);
      assert.ok((await rejection(() => bootRoot(env.root, keys, s))).code);
      // (د) كاتبٌ يملكُ تفويضَ NV يُرجِعُ السجلَّ إلى عهدٍ أقدمَ بختمٍ صحيح: العدّادُ لا يرجعُ فيُكشَف.
      await s.writeRawRecordForTest(
        encodeRecord({ phase: 0, base, epoch: 1n, cur: good.record.cur }),
      );
      assert.equal((await rejection(() => s.read())).code, NV_PROBE_CODES.INCONSISTENT);
      // إعادةُ السجلِّ الصحيحِ تُعيدُ القراءةَ (‏لا حالةَ مخفيّةً في العميل).
      await s.writeRawRecordForTest(encodeRecord(good.record));
      sameReading(await s.read(), good.reference);
      assert.equal(RECORD_SIZE, 128);
    } finally {
      await env.cleanup();
    }
  });

  test('T6 ضابطٌ سالبٌ إلزاميّ — حدُّ swtpm: استرجاعُ لقطةِ التطبيقِ **ولقطةِ حالةِ المحاكي معًا** يُقبَلُ ولا يُكشَف', async () => {
    const env = await lab();
    try {
      await env.socket().provision();
      const keys = makeKeys();
      let runtime = await bootRoot(env.root, keys, env.socket());
      await commitCommand(runtime, 'cmd-1');
      await runtime.close();
      await env.sw.stop();
      const appOld = join(env.base, 'app-old');
      const tpmOld = join(env.base, 'swtpm-old');
      cpSync(env.root, appOld, { recursive: true });
      env.sw.snapshotState(tpmOld);
      await env.sw.start();
      runtime = await bootRoot(env.root, keys, env.socket());
      await commitCommand(runtime, 'cmd-2');
      await runtime.close();
      const appNow = join(env.base, 'app-now');
      cpSync(env.root, appNow, { recursive: true });

      // (أ) حالةُ المحاكي وحدَها أقدم، والتطبيقُ حاليّ ⇒ البيانُ أمامَ المرجعِ: يُرفَض.
      await env.sw.stop();
      env.sw.restoreState(tpmOld);
      await env.sw.start();
      const ahead = await rejection(() => bootRoot(env.root, keys, env.socket()));
      assert.equal(ahead.code, 'FRESHNESS_EPOCH_REGRESSION');

      // (ب) الاثنانِ معًا أقدم ⇒ حالةٌ قديمةٌ متّسقةٌ **تُقبَل**: `cmd-2` اختفى بلا كشف.
      rmSync(env.root, { recursive: true, force: true });
      cpSync(appOld, env.root, { recursive: true });
      runtime = await bootRoot(env.root, keys, env.socket());
      assert.equal(runtime.freshnessBoot, 'B1', 'حدٌّ مقيس: المحاكي لا يكشفُ الاسترجاعَ الكامل');
      assert.equal(runtime.ledger.state('cmd-1'), 'committed');
      assert.notEqual(runtime.ledger.state('cmd-2'), 'committed', 'الأمرُ الأحدثُ ضاعَ بلا رفض');
      await runtime.close();
    } finally {
      await env.cleanup();
    }
  });

  test('T7 (WL-432) ضابطٌ سالب: مَن يملكُ كتابةَ R يعيدُ كتابةَ base فيُقبَلُ استرجاعُ لقطةِ التطبيقِ وحدَها — والتثبيتُ خارجَ R يرفضُه', async () => {
    const env = await lab();
    try {
      const { base } = await env.socket().provision();
      const keys = makeKeys();
      let runtime = await bootRoot(env.root, keys, env.socket());
      await commitCommand(runtime, 'cmd-1');
      await runtime.close();
      const oldRef = await env.socket().read();
      const appOld = join(env.base, 'app-old');
      cpSync(env.root, appOld, { recursive: true });
      runtime = await bootRoot(env.root, keys, env.socket());
      await commitCommand(runtime, 'cmd-2');
      await runtime.close();
      const now = await env.socket().inspect();
      assert.ok(now.reference.epoch > oldRef.epoch);

      // كاتبٌ يملكُ تفويضَ كتابةِ R (‏في المجسّ: تفويضُ المالك) — العدّادُ لا يرجع، لكنّ base يُزاح.
      await env.socket().writeRawRecordForTest(
        encodeRecord({ phase: 0, base: now.counter - oldRef.epoch, epoch: oldRef.epoch, cur: oldRef.anchor }),
      );
      rmSync(env.root, { recursive: true, force: true });
      cpSync(appOld, env.root, { recursive: true });
      // (أ) بلا تثبيت: الحالةُ القديمةُ تُقبَل — استرجاعٌ بلا كشفٍ وبلا لمسِ لقطةِ المحاكي.
      runtime = await bootRoot(env.root, keys, env.socket());
      assert.equal(runtime.freshnessBoot, 'B1', 'حدٌّ مقيس: base في R ليس مرجعًا رتيبًا');
      assert.notEqual(runtime.ledger.state('cmd-2'), 'committed');
      await runtime.close();
      // (ب) ضابطٌ موجب للتخفيف: base مثبَّتٌ خارجَ R ⇒ القراءةُ والإقلاعُ يُرفَضانِ مغلقَين.
      const pinned = env.socket({ pinnedBase: base });
      assert.equal((await rejection(() => pinned.read())).code, NV_PROBE_CODES.INCONSISTENT);
      assert.equal((await rejection(() => bootRoot(env.root, keys, pinned))).code, 'FRESHNESS_SOURCE_UNAVAILABLE');
    } finally {
      await env.cleanup();
    }
  });
});
