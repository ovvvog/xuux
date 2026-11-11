/**
 * الآثارُ (`WL-532`، §9) — `T-EFF-02` و`T-EFF-03` وجردُ E1..E16 وقتلُ اليتامى (E6).
 *
 * قتلُ اليتامى يتطلّبُ cgroup v2 مفوَّضاً (`XUUX_CGROUP_PARENT`)؛ بدونه يُعلَنُ الاختبارُ
 * `NOT RUN` بسببِه (تخطٍّ صريحٌ لا نجاح) — ويُشغَّلُ في `scripts/fence-lab.mjs`.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import YAML from 'yaml';

import {
  CgroupScope,
  EFFECTS_ERRORS,
  EffectsError,
  FencingReceiver,
  HaltFencedTransport,
  buildEffectsStopper,
  cgroupDelegated,
  fencingToken,
} from '../../src/fence/effects.mjs';
import { createEgressGate } from '../../src/egress/egress-gate.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('E1..E16: كلُّ أثرٍ مُصنَّفٌ بضابطٍ وحالةٍ ودليل — لا أثرَ غيرُ مصنَّف', () => {
  const doc = YAML.parse(
    readFileSync(new URL('../../config/fence-effects.yaml', import.meta.url), 'utf8'),
  );
  const ids = doc.effects.map((/** @type {{ id: string }} */ e) => e.id);
  assert.deepEqual(
    ids,
    Array.from({ length: 16 }, (_, i) => `E${i + 1}`),
  );
  for (const effect of doc.effects) {
    for (const field of ['name', 'control', 'status', 'evidence']) {
      assert.equal(typeof effect[field], 'string', `${effect.id}.${field}`);
      assert.ok(effect[field].trim().length > 0, `${effect.id}.${field} فارغ`);
    }
    assert.ok(
      ['ENFORCED', 'PARTIAL', 'RESIDUAL'].includes(effect.status),
      `${effect.id}: ${effect.status}`,
    );
  }
  const residual = doc.effects
    .filter((/** @type {{ status: string }} */ e) => e.status === 'RESIDUAL')
    .map((/** @type {{ id: string }} */ e) => e.id);
  assert.deepEqual(residual, ['E3', 'E11', 'E12', 'E13'], 'المتبقّياتُ المعلنةُ لا تتغيّرُ صامتة');
});

const parent = process.env['XUUX_CGROUP_PARENT'] ?? '';
const delegated =
  parent === '' ? { ok: false, reason: 'XUUX_CGROUP_PARENT غيرُ مضبوط' } : cgroupDelegated(parent);

test(
  'E6: cgroup.kill يقتلُ الابنَ والحفيدَ اليتيم (setsid، أبوه مات) ويُثبتُ الخلوّ',
  { skip: delegated.ok ? false : `NOT RUN — ${delegated.reason}` },
  async () => {
    const scope = new CgroupScope(parent, `t${process.pid}${Date.now()}`);
    try {
      // الابنُ يُطلقُ حفيداً في جلسةٍ جديدة ثمّ يموت: الحفيدُ يتيمٌ يتبنّاه init — لكنّه في النطاق.
      const child = scope.spawn(
        '/bin/sh',
        ['-c', 'setsid sh -c "sleep 300" >/dev/null 2>&1 & echo $!; sleep 0.2'],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      let out = '';
      child.stdout?.on('data', (b) => (out += String(b)));
      await new Promise((resolve) => child.on('exit', resolve));
      const orphan = Number(out.trim());
      assert.ok(Number.isInteger(orphan) && orphan > 0, out);
      await delay(50);
      assert.ok(alive(orphan), 'اليتيمُ حيٌّ بعدَ موتِ أبيه');
      assert.ok(scope.procs().length >= 1, 'واليتيمُ في النطاق');
      const r = await scope.kill();
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(r.procsAfter, []);
      assert.equal(r.populated, false);
      await delay(50);
      assert.equal(alive(orphan), false, 'اليتيمُ مات');
      assert.throws(
        () => scope.spawn('/bin/true', []),
        (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.SCOPE_CLOSED,
      );
    } finally {
      if (existsSync(scope.path)) scope.remove();
    }
  },
);

test('E6: بلا cgroup مفوَّض يرفضُ CgroupScope الإنشاءَ صراحةً (لا نطاقَ وهميّ)', () => {
  assert.throws(
    () => new CgroupScope('/nonexistent/cgroup', 'x'),
    (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.CGROUP_UNAVAILABLE,
  );
});

/** بوّابةُ الخروجِ الحقيقيّة (`createEgressGate`) بناقلٍ مُسيَّج. */
function realGate(/** @type {HaltFencedTransport} */ fenced) {
  /** @type {Array<{ type: string }>} */
  const events = [];
  const log = { append: (/** @type {string} */ type) => void events.push({ type }) };
  const point = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle: loadPolicyBundle() }),
    log,
    requireIdentityGate: false,
  });
  const gate = createEgressGate({
    enforcementPoint: point,
    log,
    destinations: [
      {
        id: 'federation:audit-mirror',
        uri: 'https://audit-mirror.federation.example/ingest',
        purpose: 'مرآة تدقيق',
      },
    ],
    quarantine: null,
    classifier: null,
    callsPerWindow: 30,
    maxPayloadBytes: 1024,
    transport: fenced.transport,
  });
  return { gate, events };
}

const actor = {
  id: 'agent:minister-1',
  role: 'role:minister',
  kind: /** @type {const} */ ('human'),
  state: 'active',
  scope: 'org:interior',
};
const request = (/** @type {string} */ payload) => ({
  actor,
  destination: 'federation:audit-mirror',
  payload,
  classification: 'internal',
  resourceId: `audit:${payload}`,
});

test('T-EFF-02: الخروجُ عبرَ EgressGate القائمة — الإيقافُ يُجهِضُ الجاريَ ويرفضُ الجديد، والحارسُ يُقرأ قبلَ كلِّ نقل', async () => {
  let halted = false;
  const guard = {
    assertOperational() {
      if (halted) throw Object.assign(new Error('SOVEREIGN_HALT'), { code: 'SOVEREIGN_HALT' });
    },
  };
  /** @type {string[]} */
  const delivered = [];
  const fenced = new HaltFencedTransport(guard, async (record) => {
    const signal = /** @type {AbortSignal} */ (record.signal);
    if (String(record.payload) === 'slow') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      });
    }
    delivered.push(String(record.payload));
    return { status: 202 };
  });
  const { gate } = realGate(fenced);
  await gate.send(request('one'));
  assert.deepEqual(delivered, ['one']);
  const slow = gate.send(request('slow'));
  await delay(30);
  assert.equal(fenced.inflight.size, 1, 'نقلٌ جارٍ');
  const stopper = buildEffectsStopper({ egress: [fenced] });
  const stopped = await stopper.stop();
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  await assert.rejects(slow, 'الجاري أُجهِض');
  assert.deepEqual(delivered, ['one'], 'لم يُسلَّم الجاري');
  await assert.rejects(() => gate.send(request('after')), 'الجديدُ مرفوض');
  assert.deepEqual(delivered, ['one']);
  // الحارسُ وحده (بلا close) يمنعُ أيضاً: ناقلٌ ثانٍ لم يُغلَق.
  halted = true;
  const fenced2 = new HaltFencedTransport(guard, async () => {
    delivered.push('leak');
    return { status: 202 };
  });
  await assert.rejects(() => realGate(fenced2).gate.send(request('guarded')));
  assert.ok(!delivered.includes('leak'));
  assert.ok(fenced2.refused >= 1);
});

test('T-EFF-03: المستقبِلُ يرفضُ العهدَ القديمَ والتكرارَ وغيرَ RUNNING (رمزُ السياج)', async () => {
  let fence = { state: 'RUNNING', epoch: 4 };
  const rx = new FencingReceiver(() => fence);
  const t4 = fencingToken({
    epoch: 4,
    workerId: 'alpha',
    bootId: 'b1',
    idempotencyKey: 'msg-0001',
  });
  assert.equal(await rx.accept(t4, 'hello'), true);
  await assert.rejects(
    () => rx.accept(t4, 'hello'),
    (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.REPLAY,
  );
  fence = { state: 'HALTED', epoch: 5 };
  const t4b = fencingToken({
    epoch: 4,
    workerId: 'alpha',
    bootId: 'b1',
    idempotencyKey: 'msg-0002',
  });
  await assert.rejects(
    () => rx.accept(t4b, 'late'),
    (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.NOT_RUNNING,
  );
  fence = { state: 'RUNNING', epoch: 6 };
  await assert.rejects(
    () => rx.accept(t4b, 'stale'),
    (e) => e instanceof EffectsError && e.code === EFFECTS_ERRORS.STALE_EPOCH,
  );
  const t6 = fencingToken({
    epoch: 6,
    workerId: 'alpha',
    bootId: 'b2',
    idempotencyKey: 'msg-0003',
  });
  assert.equal(await rx.accept(t6, 'fresh'), true);
  assert.equal(rx.accepted.length, 2);
  assert.throws(
    () => fencingToken({ epoch: 0, workerId: 'a', bootId: 'b', idempotencyKey: 'msg-0004' }),
    TypeError,
  );
  assert.throws(
    () => fencingToken({ epoch: 1, workerId: 'a', bootId: 'b', idempotencyKey: 'short' }),
    TypeError,
  );
});

test('الخطوة 11: موقِفُ آثارٍ بلا أيِّ ضابطٍ ليس نجاحاً', async () => {
  const r = await buildEffectsStopper({}).stop();
  assert.equal(r.ok, false);
});
