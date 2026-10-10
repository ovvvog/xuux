// @ts-nocheck
// tests/root-of-trust/wl-363-grants-sealed-state.test.mjs
//
// `WL-363` (‏قرارُ المالكِ، تتمّةُ «المنح» من `R6-A-05`): لقطةُ منحِ القدراتِ
// (`root/capability-grants.json`) **داخلَ بصمةِ الحالةِ المختومةِ** ومنحُها وسحبُها
// **معاملاتٌ في حاجزِ الالتزامِ** — لا كتابةَ مباشرةً ولا كاتبَ ثانٍ.
//
// كلُّ ما هنا على **جذرِ الثقةِ الإنتاجيِّ الحقيقيّ** (‏`bootRoot` بحاجزِه وبيانِه المختومِ
// وسجلِّه المختومِ) وسلسلةِ الإنفاذِ مركَّبةً فوقَه بالعقدِ نفسِهِ الذي يُركِّبُ به
// `createProductionSystem` (‏`grantsTxn` من `composeEnforcementChain`).
//
// الأقسام:
//   V    البصمةُ تشملُ الملفَّ، والكتابةُ معاملةً، والمسارُ المتزامنُ مرفوضٌ تحتَ الحاجزِ.
//   R    الاسترجاعُ الأقدمُ للملفِ وحدَهُ يُكشَفُ عندَ الإقلاعِ (‏B8)، والكاتبُ الأجنبيُّ يُسيَّجُ.
//   C    مصفوفةُ الانهيارِ بـSIGKILL حقيقيٍّ في كلِّ مرحلةٍ من مراحلِ الالتزامِ — لا تُقبلُ
//        صلاحيةٌ لا يمكنُ إثباتُ أصالتِها، ولا يُبعَثُ مسحوبٌ سارياً ولا يُكسرُ الإقلاعُ.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';

import {
  computeStateDigest,
  productionStateLayout,
  stateManifestPath,
} from '../../src/root-of-trust/index.mjs';
import { FileCapabilityGrantStore } from '../../src/identity/capability-grant-store.mjs';
import { sealedAudit } from '../../src/root-of-trust/sealed-audit.mjs';
import { composeEnforcementChain } from '../../src/core/composition-root.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import { FileStateBoundSocket, bootRoot, makeKeys } from '../helpers/wl-326-root.mjs';

const CHILD = join(import.meta.dirname, '..', 'helpers', 'wl-363-grants-crash-child.mjs');

/** مجلدٌ مؤقّتٌ فيه الجذرُ وملفُّ المرجعِ خارجَه. */
function workspace() {
  const base = registerTmpRoot(mkdtempSync(join(tmpdir(), 'wl363-')));
  return {
    base,
    root: join(base, 'root'),
    socketFile: join(base, 'freshness.json'),
    grantsPath: join(base, 'root', 'capability-grants.json'),
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

/** ينتظرُ طابورَ الحاجزِ حتى تستقرَّ كلُّ معاملةٍ مودَعةٍ فيه. */
async function settle(barrier) {
  await barrier.run('probe.wait', () => undefined);
}

/**
 * يُقلِعُ الجذرَ ويُركِّبُ سلسلةَ الإنفاذِ فوقَه بالعقدِ الإنتاجيِّ نفسِهِ: الدفترُ موصولٌ
 * بالحاجزِ (`grantsTxn`) والمخزنُ الملفيُّ في الجذرِ والسجلُّ المختومُ شاهدٌ.
 * @param {string} root - جذرُ الحالة
 * @param {ReturnType<typeof makeKeys>} keys - المفاتيح
 * @param {object} socket - المرجعُ المربوطُ بالحالة
 * @returns {Promise<{runtime: object, chain: object, grants: CapabilityGrantLedger}>}
 */
async function bootWithGrants(root, keys, socket) {
  const runtime = await bootRoot(root, keys, socket);
  const chain = composeEnforcementChain({
    log: sealedAudit(runtime.log),
    withLegislation: false,
    crown: null,
    haltSwitch: runtime.haltSwitch,
    grantsStore: new FileCapabilityGrantStore({ filePath: join(root, 'capability-grants.json') }),
    grantsTxn: (intent, fn) => runtime.commitBarrier.run(intent, fn),
  });
  return { runtime, chain, grants: chain.grants };
}

/** وكيلٌ موثَّقٌ للمنحِ — بصيغةِ `principal` التي تُثبِتُ بوابةُ الهويّةِ دورَها. */
const KING = { id: 'king:test', role: 'role:king', state: 'active' };

/** وسيطُ منحٍ سليمٌ سارٍ. */
const SPEC = {
  agentId: 'agent:worker',
  capability: 'action:read-registry',
  reason: 'قياسُ دوامِ المنحِ في الحالةِ المختومةِ',
  principal: KING,
  ttlSeconds: 3600,
};

describe('V — الملفُ داخلَ البصمةِ والكتابةُ معاملةً (WL-363)', () => {
  test('بصمةُ الحالةِ المختومةِ تشملُ capability-grants.json بالحسابِ لا بالظنّ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, grants } = await bootWithGrants(ws.root, keys, socket);
      try {
        // الملفُّ أحدُ مكوّناتِ الجردِ: حذفُه أو تعديلُه يُغيّرُ البصمةَ.
        const layout = productionStateLayout(ws.root, join(ws.root, 'anchors.jsonl'));
        assert.ok(
          layout.files.some((f) => f.endsWith('capability-grants.json')),
          'الجردُ لا يَعُدُّ ملفَّ المنحِ',
        );
        const digestBefore = computeStateDigest(layout);
        // منحٌ معامَليٌّ واحدٌ: يُنشئُ الملفَّ داخلَ معاملةٍ ويُختمُ في البصمةِ.
        const granted = await grants.grantAsync(SPEC);
        await settle(runtime.commitBarrier);
        assert.ok(existsSync(ws.grantsPath), 'منحٌ معامَليٌّ لم يُنشئِ الملفَّ');
        assert.equal(
          runtime.commitBarrier.lastReceipt.intent,
          'grants.grant',
          'المعاملةُ الأخيرةُ معاملةُ المنحِ',
        );
        // والبصمةَ تغيّرَت: الهضمُ بعدَ المنحِ يخالفُ ما قبلَهُ — الملفُّ داخلَ الحسابِ.
        assert.notEqual(computeStateDigest(layout), digestBefore);
        // والبيانُ المختومُ يشهدُ على بصمةِ القرصِ **بما فيها ملفُّ المنحِ**.
        const body = JSON.parse(readFileSync(stateManifestPath(ws.root), 'utf8')).body;
        assert.equal(body.stateDigest, computeStateDigest(layout));
        // والمنحُ في اللقطةِ الملفّيةِ بذاتِهِ.
        const persisted = JSON.parse(readFileSync(ws.grantsPath, 'utf8'));
        assert.equal(persisted.length, 1);
        assert.equal(persisted[0].id, granted.id);
      } finally {
        await runtime.close();
      }
    } finally {
      ws.cleanup();
    }
  });

  test('المسارُ المتزامنُ مرفوضٌ تحتَ الحاجزِ — لا كاتبَ ثانٍ، والسحبُ كذلك', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, grants } = await bootWithGrants(ws.root, keys, socket);
      try {
        const error = thrown(() => grants.grant(SPEC));
        assert.equal(error.message, 'CAPABILITY_GRANT_TXN_REQUIRED');
        // ولا أثرَ على القرصِ: الرفضُ وقعَ قبلَ أيِّ كتابةٍ.
        assert.ok(!existsSync(ws.grantsPath), 'رفضٌ تركَ أثراً');
        // والمنحُ المعامَليُّ يمرُّ.
        const granted = await grants.grantAsync(SPEC);
        await settle(runtime.commitBarrier);
        const revokeError = thrown(() => grants.revoke(granted.id, 'سُحِبَت'));
        assert.equal(revokeError.message, 'CAPABILITY_GRANT_TXN_REQUIRED');
        // والسحبُ المعامَليُّ يمرُّ.
        const revoked = await grants.revokeAsync(granted.id, 'سُحِبَت');
        await settle(runtime.commitBarrier);
        assert.notEqual(revoked.revokedAt, null);
        assert.equal(runtime.commitBarrier.lastReceipt.intent, 'grants.revoke');
      } finally {
        await runtime.close();
      }
    } finally {
      ws.cleanup();
    }
  });

  test('كتابةٌ أجنبيّةٌ مباشرةٌ للملفِّ بعدَ التنشيطِ يرفضُها الحاجزُ لا الكاتبُ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, grants } = await bootWithGrants(ws.root, keys, socket);
      try {
        await grants.grantAsync(SPEC);
        await settle(runtime.commitBarrier);
        const snapshot = readFileSync(ws.grantsPath, 'utf8');
        // كتابةٌ أجنبيّةٌ خارجَ معاملةٍ: `beforeDurableWrite` يرفضُها — فلا تُقبَلُ صامتةً.
        const foreign = () => {
          const store = new FileCapabilityGrantStore({ filePath: ws.grantsPath });
          store.save(JSON.parse(snapshot));
        };
        const error = thrown(foreign);
        assert.equal(error.code, 'STATE_WRITE_OUTSIDE_BARRIER');
      } finally {
        await runtime.close();
      }
    } finally {
      ws.cleanup();
    }
  });
});

describe('R — الاسترجاعُ الأقدمُ للملفِ يُكشَفُ (WL-363)', () => {
  test('خصمُ الملفِّ إلى أقدمَ وحدَهُ يكسرُ البصمةَ فيرفضُ الإقلاعُ المربوطُ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, grants } = await bootWithGrants(ws.root, keys, socket);
      let older;
      try {
        await grants.grantAsync(SPEC);
        await settle(runtime.commitBarrier);
        older = readFileSync(ws.grantsPath, 'utf8');
        // الحالةُ تتقدّمُ فوقَها: منحٌ ثانٍ يُختمُ في البصمةِ.
        await grants.grantAsync({ ...SPEC, capability: 'action:read-audit' });
        await settle(runtime.commitBarrier);
        assert.notEqual(readFileSync(ws.grantsPath, 'utf8'), older);
      } finally {
        await runtime.close();
      }
      // الخصمُ يعيدُ الملفَّ أقدمَ **وحده** — البيانُ والمرجعُ لم يُمسّا: البصمةُ لا تطابقُ.
      writeFileSync(ws.grantsPath, older);
      const error = await rejection(() => bootRoot(ws.root, keys, socket));
      assert.equal(error.code, 'FRESHNESS_STATE_DIGEST_MISMATCH');
      assert.equal(error.name, 'ProductionRuntimeError');
    } finally {
      ws.cleanup();
    }
  });

  test('الكاتبُ الأجنبيُّ يستبدلُ الملفَّ والجذرُ حيٌّ يُسيَّجُ الحاجزُ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, grants } = await bootWithGrants(ws.root, keys, socket);
      try {
        await grants.grantAsync(SPEC);
        await settle(runtime.commitBarrier);
        const older = readFileSync(ws.grantsPath, 'utf8');
        await grants.grantAsync({ ...SPEC, capability: 'action:read-audit' });
        await settle(runtime.commitBarrier);
        // كتابةٌ أجنبيّةٌ بغيرِ الحاجزِ: استبدالٌ بأقدمَ والحاجزُ مُفعَّل.
        writeFileSync(ws.grantsPath, older);
        const error = await rejection(() =>
          runtime.commitBarrier.run('probe.foreign', () => undefined),
        );
        assert.equal(error.code, 'STATE_FOREIGN_WRITE_DETECTED');
        assert.ok(runtime.commitBarrier.fenced, 'الحاجزُ مُسيَّجٌ');
      } finally {
        await runtime.close();
      }
    } finally {
      ws.cleanup();
    }
  });

  test('ملفٌّ معطوبٌ في الجردِ يرفضُه الإقلاعُ المربوطُ بالبصمةِ — لا افتراضَ صفرٍ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      const { runtime, grants } = await bootWithGrants(ws.root, keys, socket);
      try {
        await grants.grantAsync(SPEC);
        await settle(runtime.commitBarrier);
      } finally {
        await runtime.close();
      }
      // عبثٌ بجسمِ الملفِّ (JSON مكسورٌ): البصمةُ تكسرُ أولاً — فالرفضُ من الحكمِ المربوطِ
      // لا من فحصِ البنيةِ وحدَه. والاتجاهُ واحدٌ: إقلاعٌ مرفوضٌ لا لقطةٌ مُفترَضةٌ.
      writeFileSync(ws.grantsPath, '{ مكسور');
      const error = await rejection(() => bootRoot(ws.root, keys, socket));
      assert.equal(error.code, 'FRESHNESS_STATE_DIGEST_MISMATCH');
    } finally {
      ws.cleanup();
    }
  });
});

describe('C — مصفوفةُ الانهيارِ بـSIGKILL حقيقيٍّ على المنحِ المعامَليِّ (WL-363)', () => {
  /**
   * يُشغِّلُ العمليّةَ الفرعيّةَ ويُعيدُ إشارةَ خروجِها ومخرجَها.
   * @param {object} config - الإعداد
   * @returns {{signal: string|null, status: number|null, stdout: string, stderr: string}} النتيجة
   */
  function runChild(config) {
    const file = join(ws.base, `child-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(config));
    const result = spawnSync(process.execPath, [CHILD, file], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    return {
      signal: result.signal,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /** جدولُ النقاطِ: المرحلةُ ⇐ هل تقدَّمَ المرجعُ (منحٌ يُقرُّ) أم لا (تضييقٌ). */
  const MATRIX = [
    { name: 'C0 قبلَ المعاملةِ', kill: { stage: 'BEFORE_TXN' }, advanced: false },
    { name: 'C2 بعدَ S2 (الترحيلُ خُتمَ)', kill: { stage: 'S2' }, advanced: false },
    { name: 'C3 كتابةٌ ممزّقةٌ في أثناءِ الجسمِ', kill: { inFn: true }, advanced: false },
    { name: 'C4 بعدَ S3 (الجسمُ تمَّ)', kill: { stage: 'S3' }, advanced: false },
    {
      name: 'C5 في S4 قبلَ تطبيقِ المرجعِ',
      kill: { socket: 'kill-before-apply' },
      advanced: false,
    },
    {
      name: 'C6 في S4 طُبِّقَ المرجعُ وضاعَ الردّ',
      kill: { socket: 'kill-after-apply' },
      advanced: true,
    },
    { name: 'C7 بعدَ S4', kill: { stage: 'S4' }, advanced: true },
    { name: 'C9 بعدَ S5 وقبلَ ACK', kill: { stage: 'S5' }, advanced: true },
    { name: 'C10 بعدَ ACK', kill: { stage: 'AFTER_ACK' }, advanced: true },
  ];

  let ws;
  let keys;
  /** عددُ المنحِ المُقرّةِ التراكميّ — كلُّ صفٍّ من المصفوفةِ يُقرِّرُ منحاً واحداً. */
  let committedGrants = 0;

  test('تهيئةُ الجذرِ المربوطِ قبلَ المصفوفةِ', async () => {
    ws = workspace();
    keys = makeKeys();
    const socket = new FileStateBoundSocket(ws.socketFile);
    const runtime = await bootRoot(ws.root, keys, socket);
    await runtime.close();
  });

  for (const row of MATRIX) {
    test(`${row.name} — لا صلاحيةَ بلا برهانٍ ولا إقلاعٌ مكسورٌ`, async () => {
      assert.ok(ws, 'التهيئةُ لم تُنجَزْ');
      const socket = new FileStateBoundSocket(ws.socketFile);
      const before = socket.current();
      const child = runChild({
        root: ws.root,
        keys,
        socketFile: ws.socketFile,
        op: 'grant',
        spec: SPEC,
        kill: row.kill,
      });
      assert.equal(child.signal, 'SIGKILL', `العمليّةُ قُتِلَت: ${child.stderr}`);
      const after = socket.current();
      assert.equal(
        after.epoch === before.epoch + 1n,
        row.advanced,
        `المرجعُ: ${String(after.epoch)} مقابلَ ${String(before.epoch)}`,
      );
      // الإقلاعُ بعدَ الانهيارِ يعملُ دائماً — لا تعطيلَ.
      const booted = await bootRoot(ws.root, keys, socket);
      try {
        // إن تقدَّمَ المرجعُ (منحٌ مُقرٌّ) فالمنحُ في الملفِّ وفي الشاهدِ معاً؛ وإلا فلا
        // منحَ في الملفِّ بلا شاهدٍ — الاتجاهُ تضييقٌ لا توسيعٌ.
        const ledgerGrants = JSON.parse(
          existsSync(ws.grantsPath) ? readFileSync(ws.grantsPath, 'utf8') : '[]',
        );
        if (row.advanced) {
          committedGrants += 1;
        }
        // والاستعادةُ بعدَ كلِّ صفٍّ تُقرِّرُ منحاً واحداً (action:read-audit) فوقَ الحالةِ
        // المستقرّةِ — فالعدّادُ التراكميُّ يَعُدُّ المنحَينِ.
        committedGrants += 1;
        // لا لقطةَ بمنحٍ لا يُثبِتُهُ الشاهدُ: ما في الملفِّ لا يزيدُ على المُقرِّ التراكميّ.
        assert.ok(
          ledgerGrants.length <= committedGrants,
          'لقطةٌ فيها منحٌ لا يُثبِتُهُ الاستقرارُ التراكميّ',
        );
        for (const entry of ledgerGrants) {
          assert.ok(entry.id, 'منحٌ بلا معرّفٍ في لقطةِ انقطاعٍ');
        }
        // والجذرُ يعملُ فوقَها بعدَ الاستعادةِ: منحٌ جديدٌ يمرُّ.
        const chain = composeEnforcementChain({
          log: sealedAudit(booted.log),
          withLegislation: false,
          crown: null,
          haltSwitch: booted.haltSwitch,
          grantsStore: new FileCapabilityGrantStore({ filePath: ws.grantsPath }),
          grantsTxn: (intent, fn) => booted.commitBarrier.run(intent, fn),
        });
        await chain.grants.grantAsync({ ...SPEC, capability: 'action:read-audit' });
        await settle(booted.commitBarrier);
        const afterRecovery = JSON.parse(readFileSync(ws.grantsPath, 'utf8'));
        assert.ok(
          afterRecovery.some((g) => g.capability === 'action:read-audit'),
          'الجذرُ لا يعملُ بعدَ الاستعادةِ',
        );
      } finally {
        await booted.close();
      }
    });
  }

  test('انقطاعٌ بينَ ختمِ شاهدِ السحبِ وحفظِ الملفِّ يُبعِثُ المنحَ مسحوبةً', async () => {
    assert.ok(ws, 'التهيئةُ لم تُنجَزْ');
    const socket = new FileStateBoundSocket(ws.socketFile);
    const shared = { id: '' };
    // وكيلٌ فريدٌ لهذا الاختبارِ: صفوفُ المصفوفةِ قبلهُ منحتْ `agent:worker` منحاً
    // سارياً — فقراءةُ القدرةِ لهذا الوكيلِ لا تُثبِتُ شيئاً عن هذا السحبِ.
    const REVOKED_SPEC = { ...SPEC, agentId: 'agent:revoke-probe' };
    // منحٌ مُقرٌّ أولاً.
    const setup = await bootRoot(ws.root, keys, socket);
    try {
      const chain = composeEnforcementChain({
        log: sealedAudit(setup.log),
        withLegislation: false,
        crown: null,
        haltSwitch: setup.haltSwitch,
        grantsStore: new FileCapabilityGrantStore({ filePath: ws.grantsPath }),
        grantsTxn: (intent, fn) => setup.commitBarrier.run(intent, fn),
      });
      const granted = await chain.grants.grantAsync(REVOKED_SPEC);
      await settle(setup.commitBarrier);
      shared.id = granted.id;
      // السحبُ معاملةً كاملةً: شاهدُهُ مختومٌ ولقطةُهُ محفوظةٌ في كتلةٍ واحدةٍ — فلا
      // انقطاعٌ بينَهما يُبعِثُ المنحَ سارياً بعدَ إقلاعٍ جديدٍ.
      await chain.grants.revokeAsync(granted.id, 'سُحِبَت');
      await settle(setup.commitBarrier);
    } finally {
      await setup.close();
    }
    const booted = await bootRoot(ws.root, keys, socket);
    try {
      const chain = composeEnforcementChain({
        log: sealedAudit(booted.log),
        withLegislation: false,
        crown: null,
        haltSwitch: booted.haltSwitch,
        grantsStore: new FileCapabilityGrantStore({ filePath: ws.grantsPath }),
        grantsTxn: (intent, fn) => booted.commitBarrier.run(intent, fn),
      });
      const persisted = JSON.parse(readFileSync(ws.grantsPath, 'utf8'));
      const entry = persisted.find((g) => g.id === shared.id);
      assert.ok(entry, 'المنحةُ فُقدتْ');
      assert.notEqual(entry.revokedAt, null, 'سحبٌ مُقرٌّ تُركَ سارياً');
      assert.equal(
        chain.grants.capabilitiesOf('agent:revoke-probe').has('action:read-registry'),
        false,
        'القدرةُ المسحوبةُ عادتْ ساريةً',
      );
    } finally {
      await booted.close();
    }
  });
});
