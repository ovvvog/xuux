// @ts-nocheck
// tests/root-of-trust/wl-330-clock-state.test.mjs
//
// `WL-331` — `LIVE-37`: حالةُ الساعةِ السياديّةِ (‏P13، `clock-state.json`) داخلَ بصمةِ
// الحالةِ `V` وتحتَ حاجزِ الالتزام. قبلَ هذا كانت تُكتَبُ خارجَ الحاجزِ وخارجَ البصمةِ —
// غابت عن جردِ P0–P12 في `WL-325` — فاسترجاعُها أقدمَ (إحياءً لنافذةِ الإعادةِ بإعادةِ
// إدخالِ الحدِّ الأعلى للساعةِ) لم يكن يكشفُه حكمُ الإقلاعِ المربوطُ بالحالة.
//
// كلُّ ما هنا على **جذرِ الثقةِ الإنتاجيِّ الحقيقيّ** (‏`createProductionRootOfTrust` بحاجزِه
// وبيانِه المختومِ وسجلِّه المختومِ) بمرجعِ `testFixture` المربوطِ بالحالةِ — أدلّةُ سلوكٍ
// للشفرةِ لا على عتادٍ (‏`D2` غيرُ محسومٍ، `LIVE-38`).
//
// الأقسام:
//   V    الكتابةُ لا تقعُ إلّا عبرَ الحاجزِ (معاملةُ `clock.persist`)، وP13 داخلَ البصمةِ.
//   R    الاسترجاعُ أقدمَ يُكشَفُ: عندَ الإقلاعِ (‏`B8`/‏بصمةٌ لا تطابقُ) وبينَ التشغيلِ (‏`D6`).

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import {
  SovereignClock,
  computeStateDigest,
  productionStateLayout,
  stateManifestPath,
} from '../../src/root-of-trust/index.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { FileStateBoundSocket, bootRoot, makeKeys } from '../helpers/wl-326-root.mjs';

/** مجلدٌ مؤقّتٌ فيه الجذرُ وملفُّ المرجعِ خارجَه. */
function workspace() {
  const base = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl331-')));
  return {
    base,
    root: join(base, 'root'),
    socketFile: join(base, 'freshness.json'),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/** يمسكُ خطأً غيرَ متزامن. */
async function rejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفَعْ خطأ');
}

/** يمسكُ خطأً متزامناً. */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('لم يُرفَعْ خطأ');
}

/**
 * يُقلِعُ الجذرَ ويبني ساعةً سياديّةً مربوطةً بحاجزِه على ساعةِ حائطٍ محقونةٍ تتقدّمُ
 * باليدِ. يُرجِعُ ما يلزمُ لقياسِ P13.
 */
async function bootWithClock(root, keys, socket) {
  const runtime = await bootRoot(root, keys, socket);
  const clockPath = join(root, 'clock-state.json');
  let wall = 1_000_000;
  const clock = new SovereignClock({
    statePath: clockPath,
    commitBarrier: runtime.commitBarrier,
    wallClock: () => wall,
    monotonic: () => BigInt(wall) * 1_000_000n,
    // كلَّ تقدُّمٍ يُوجِبُ الكتابةَ: القياسُ لا ينتظرُ ثانيةً كاملة.
    persistEveryMs: 1,
  });
  return { runtime, clock, clockPath, advance: (ms) => (wall += ms) };
}

/** ينتظرُ طابورَ الحاجزِ حتى تستقرَّ كلُّ معاملةٍ مودَعةٍ فيه. */
async function settle(barrier) {
  await barrier.run('probe.wait', () => undefined);
}

describe('V — P13 داخلَ البصمةِ والكتابةُ عبرَ الحاجزِ (LIVE-37)', () => {
  test('الكتابةُ معاملةُ `clock.persist` في الحاجزِ لا كتابةٌ مباشرةً، وتُختمُ في البصمةِ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, clock, clockPath, advance } = await bootWithClock(ws.root, keys, socket);
      try {
        const epochAtBoot = runtime.commitBarrier.lastReceipt?.epoch ?? 0;
        // القراءةُ الأولى تُوجِبُ الكتابةَ (الحدُّ الأعلىُ صفرٌ) — لكن لا مباشرةً:
        assert.ok(!existsSync(clockPath), 'لا كتابةَ حالةٍ خارجَ معاملةٍ في الحاجز');
        clock.now();
        advance(60_000);
        clock.now();
        await settle(runtime.commitBarrier);
        // الكتابةُ وقعت عبرَ معاملةٍ خاصّةٍ بها، لا تُرجِعُ نجاحاً إلّا بعدَ الدوامِ والترقية.
        assert.ok(existsSync(clockPath), 'clock-state.json مكتوبٌ');
        const persisted = JSON.parse(readFileSync(clockPath, 'utf8'));
        assert.equal(persisted.version, 1);
        assert.equal(persisted.highWaterMs, 1_060_000);
        assert.equal(runtime.commitBarrier.lastReceipt.intent, 'clock.persist');
        assert.ok(
          runtime.commitBarrier.lastReceipt.epoch > epochAtBoot,
          'تقدَّمَ العهدُ فوقَ معاملةِ الساعة',
        );
        // والمتنُ المختومُ يشهدُ على بصمةٍ **تشملُ** clock-state.json — بالحسابِ لا بالظنّ.
        const body = JSON.parse(readFileSync(stateManifestPath(ws.root), 'utf8')).body;
        assert.equal(
          body.stateDigest,
          computeStateDigest(productionStateLayout(ws.root, join(ws.root, 'anchors.jsonl'))),
        );
      } finally {
        await runtime.close();
      }
    } finally {
      ws.cleanup();
    }
  });

  test('بلاِ حاجزٍ تبقى الكتابةُ مباشرةً كما كانت — وضعُ التطويرِ والاختبارِ', () => {
    const base = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl331-')));
    try {
      const clockPath = join(base, 'clock-state.json');
      const wall = 1_000_000;
      const clock = new SovereignClock({
        statePath: clockPath,
        wallClock: () => wall,
        monotonic: () => BigInt(wall) * 1_000_000n,
        persistEveryMs: 1,
      });
      clock.now();
      assert.ok(existsSync(clockPath), 'الكتابةُ المباشرةُ باقيةٌ بلاِ حاجزٍ');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('R — استرجاعُ P13 أقدمَ يُكشَفُ (LIVE-37)', () => {
  test('استرجاعُ clock-state.json أقدمَ وحدَه يُرَدُّ عندَ الإقلاعِ بفرقِ البصمة', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, clock, clockPath, advance } = await bootWithClock(ws.root, keys, socket);
      let older;
      try {
        clock.now();
        advance(60_000);
        clock.now();
        await settle(runtime.commitBarrier);
        older = readFileSync(clockPath, 'utf8');
        // الحالةُ تتقدّمُ فوقَها: سِيَقٌ أحدثُ يُختمُ في البصمةِ والمرجعِ.
        advance(60_000);
        clock.now();
        await settle(runtime.commitBarrier);
        assert.notEqual(readFileSync(clockPath, 'utf8'), older);
      } finally {
        await runtime.close();
      }
      // الخصمُ يعيدُ clock-state.json أقدمَ **وحده** — البيانُ والمرجعُ والمارِسُ لم تُمسَّ.
      writeFileSync(clockPath, older);
      const error = await rejection(() => bootRoot(ws.root, keys, socket));
      assert.equal(error.code, 'FRESHNESS_STATE_DIGEST_MISMATCH');
      assert.equal(error.name, 'ProductionRuntimeError');
    } finally {
      ws.cleanup();
    }
  });

  test('بلاِ استرجاعٍ يُقلِعُ الجذرُ طبيعيّاً — الرفضُ بسببُ الاسترجاعِ لا بسببِ الجردِ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, clock, advance } = await bootWithClock(ws.root, keys, socket);
      try {
        clock.now();
        advance(60_000);
        clock.now();
        await settle(runtime.commitBarrier);
      } finally {
        await runtime.close();
      }
      const again = await bootRoot(ws.root, keys, socket);
      try {
        assert.equal(again.freshnessBoot, 'B1');
      } finally {
        await again.close();
      }
    } finally {
      ws.cleanup();
    }
  });

  test('كاتبٌ أجنبيٌّ يستبدلُ clock-state.json والجذرُ حيٌّ يُسيَّجُ الحاجزُ وتُبطَلُ الساعة', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, clock, clockPath, advance } = await bootWithClock(ws.root, keys, socket);
      try {
        clock.now();
        advance(60_000);
        clock.now();
        await settle(runtime.commitBarrier);
        const older = readFileSync(clockPath, 'utf8');
        advance(60_000);
        clock.now();
        await settle(runtime.commitBarrier);
        // كتابةٌ أجنبيّةٌ بغيرِ الحاجزِ: استبدالٌ بأقدمَ والحاجزُ مُفعَّل.
        writeFileSync(clockPath, older);
        const error = await rejection(() =>
          runtime.commitBarrier.run('crown.command', () => undefined),
        );
        assert.equal(error.code, 'STATE_FOREIGN_WRITE_DETECTED');
        assert.ok(runtime.commitBarrier.fenced, 'الحاجزُ مُسيَّجٌ');
        // والساعةُ نفسُها لا تدّعي الثقةَ فوقَ حالةٍ لا تُكتَب: فشلُ معاملتِها يُبطلُها.
        advance(60_000);
        clock.now();
        await new Promise((resolveWait) => setTimeout(resolveWait, 0));
        assert.equal(thrown(() => clock.assertTrusted()).code, 'CLOCK_STATE_UNWRITABLE');
      } finally {
        await runtime.close();
      }
    } finally {
      ws.cleanup();
    }
  });
});
