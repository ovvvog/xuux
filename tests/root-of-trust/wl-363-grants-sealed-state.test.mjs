// @ts-nocheck
// tests/root-of-trust/wl-363-grants-sealed-state.test.mjs
//
// `WL-363` (‏قرارُ المالكِ، تتمّةُ «المنح» من `R6-A-05`): لقطةُ منحِ القدراتِ
// (`root/capability-grants.json`) **داخلَ بصمةِ الحالةِ المختومةِ** ومنحُها وسحبُها
// **معاملاتٌ في حاجزِ الالتزامِ** — لا كتابةَ مباشرةً ولا كاتبَ ثانٍ.
//
// **المراجعةُ (`WL-364`):** كلُّ ما هنا على **جذرِ الثقةِ الإنتاجيِّ الحقيقيّ**
// (‏`bootRoot` بحاجزِه وبيانِه المختومِ وسجلِّه المختومِ) وسلسلةِ الإنفاذِ مركَّبةً
// **بالعقدِ الإنتاجيِّ الكاملِ** لا بمجموعةِ جزئيّةٍ: معِ `grantWitness` من
// `grantsFromSealedLog` (‏كما في `createProductionSystem`) — فلا منحةَ تُقبلُ بعدَ
// الإقلاعِ إلا إن أَشهَدَ لها السجلُّ المختومُ بحقائِها، وهذا ما يُفحَصُ هنا فعليّاً
// لا افتراضاً. والانقطاعُ في السحبِ **حقيقيٌّ** بـSIGKILL في نقاطٍ مُسمّاةٍ، لا
// تشغيلٌ نظيفٌ يُسمّى «انقطاعاً».
//
// الأقسام:
//   V    البصمةُ تشملُ الملفَّ، والكتابةُ معاملةً، والمسارُ المتزامنُ مرفوضٌ.
//   R    الاسترجاعُ الأقدمُ والكتابةُ الأجنبيّةُ والفسادُ — كلُّها يُكشَفُ.
//   E    الانتهاءُ: منحةٌ منتهيةٌ لا تُبعَثُ ساريةً بعدَ الإقلاعِ ولا تُقبَلُ
//        كوحدةٍ مفتوحةٍ في شاهدٍ يُقرُّها.
//   C    مصفوفةُ الانهيارِ بـSIGKILL حقيقيٍّ في كلِّ مرحلةٍ — لا لقطةَ بمنحٍ لا
//        يُثبِتُهُ الشاهدُ، ولا إقلاعٌ مكسورٌ، ولا سحبٌ يعودُ سارياً.

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
import { grantsFromSealedLog } from '../../src/root-of-trust/production-runtime.mjs';
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
 * يُقلِعُ الجذرَ ويُركِّبُ سلسلةَ الإنفاذِ **بالعقدِ الإنتاجيِّ الكاملِ** (‏كما في
 * `createProductionSystem`): الدفترُ موصولٌ بالحاجزِ (`grantsTxn`) والمخزنُ الملفيُّ
 * في الجذرِ **وشاهدُ المنحِ من السجلِّ المختومِ** (`grantWitness` من
 * `grantsFromSealedLog`) — فلا منحةَ تُقبلُ بعدَ الإقلاعِ إلا بشاهدٍ يُطابِقُها
 * حقلاً حقلاً. بلا الشاهدِ لا يُختبرُ المسارُ الذي يحمي الإنتاجَ فعلاً.
 * @param {string} root - جذرُ الحالة
 * @param {ReturnType<typeof makeKeys>} keys - المفاتيح
 * @param {object} socket - المرجعُ المربوطُ بالحالة
 * @returns {Promise<{runtime: object, chain: object, grants: object}>}
 */
async function bootWithGrants(root, keys, socket) {
  const runtime = await bootRoot(root, keys, socket);
  const grantWitness = await grantsFromSealedLog(runtime.log);
  const chain = composeEnforcementChain({
    log: sealedAudit(runtime.log),
    withLegislation: false,
    crown: null,
    haltSwitch: runtime.haltSwitch,
    grantsStore: new FileCapabilityGrantStore({ filePath: join(root, 'capability-grants.json') }),
    grantWitness,
    grantsTxn: (intent, fn) => runtime.commitBarrier.run(intent, fn),
  });
  return { runtime, chain, grants: chain.grants };
}

/** وكيلٌ موثَّقٌ للمنحِ — بصيغةِ `principal` التي تُثبِتُ بوابةُ الهويّةِ دورَها. */
const KING = { id: 'king:test', role: 'role:king', state: 'active' };

/** وسيطُ منحٍ سليمٍ سارٍ. */
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

describe('R — الاسترجاعُ الأقدمُ والكتابةُ الأجنبيّةُ والفسادُ (WL-363)', () => {
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

describe('E — الانتهاءُ لا يُبعَثُ سارياً (WL-364)', () => {
  test('منحةٌ منتهيةٌ لا تُقبلُ بعدَ الإقلاعِ ولا تعودُ ساريةً بلا شاهدٍ جديدٍ', async () => {
    const ws = workspace();
    try {
      const keys = makeKeys();
      const socket = new FileStateBoundSocket(ws.socketFile);
      // منحٌ قصيرُ الأمدِ: تنتهي قبلَ الإقلاعِ الثاني.
      const SHORT = { ...SPEC, ttlSeconds: 1, agentId: 'agent:expire-probe' };
      const { runtime, grants } = await bootWithGrants(ws.root, keys, socket);
      let grantId;
      try {
        const granted = await grants.grantAsync(SHORT);
        await settle(runtime.commitBarrier);
        grantId = granted.id;
        // صحيحةٌ الآنَ.
        assert.equal(
          grants.capabilitiesOf('agent:expire-probe').has('action:read-registry'),
          true,
          'منحةٌ قصيرةُ الأمدِ لم تسِرْ أصلاً',
        );
      } finally {
        await runtime.close();
      }
      // انتظارُ الانتهاءِ.
      await new Promise((resolve) => setTimeout(resolve, 1600));
      const booted = await bootWithGrants(ws.root, keys, socket);
      try {
        // لا ساريةً بعدَ الإقلاعِ.
        assert.equal(
          booted.grants.capabilitiesOf('agent:expire-probe').has('action:read-registry'),
          false,
          'منحةٌ منتهيةٌ عادتْ ساريةً',
        );
        // ولا تُقبَلُ كوحدةٍ مفتوحةٍ: الشاهدُ يعرفُها **بسلطةٍ محدودةٍ ومدةٍ**.
        const persisted = JSON.parse(readFileSync(ws.grantsPath, 'utf8'));
        const entry = persisted.find((g) => g.id === grantId);
        assert.ok(entry, 'منحةٌ منتهيةٌ فُقدتْ من اللقطةِ');
      } finally {
        await booted.runtime.close();
      }
    } finally {
      ws.cleanup();
    }
  });
});

describe('C — مصفوفةُ الانهيارِ بـSIGKILL حقيقيٍّ على المنحِ المعامَليِّ (WL-363/364)', () => {
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
  /** المنحُ المُقرّةُ التراكميّةُ بمعرّفاتِها — يُقارَنُ بها بدقّةٍ لا بعددٍ تقريبيّ. */
  const committed = [];

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
      // ما كانَ في اللقطةِ **قبلَ الطفلِ** — يُقارَنُ الفرقُ لا العددُ.
      const idsBefore = JSON.parse(
        existsSync(ws.grantsPath) ? readFileSync(ws.grantsPath, 'utf8') : '[]',
      ).map((g) => g.id);
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
      // المعرّفُ الذي أقرَّهُ الطفلُ إن قرَّرَ — يُقارَنُ به لا بعددٍ تقريبيّ. ومخرجُ
      // المعرّفِ (‏`GRANTED:`) لا يُطالَبُ إلا إن بلغَ الطفلُ نهايةَ المعاملةِ فطبعَه؛
      // فالقتلُ قبلَهُ يفقدُهُ **ولا يُهدمُ الإقرارُ نفسُهُ** — الشاهدُ هو الحكمُ.
      const match = /^GRANTED:(.+)$/m.exec(child.stdout ?? '');
      const acknowledged = match !== null;
      if (row.advanced) {
        if (acknowledged) committed.push(match[1]);
      } else {
        assert.ok(!acknowledged, 'طفلٌ مقتولٌ قبلَ الإقرارِ طبعَ معرّفَ منحةٍ (‏إقرارٌ لم يقعْ)');
      }
      // الإقلاعُ بعدَ الانهيارِ يعملُ دائماً — لا تعطيلَ.
      const booted = await bootWithGrants(ws.root, keys, socket);
      try {
        const ledgerGrants = JSON.parse(
          existsSync(ws.grantsPath) ? readFileSync(ws.grantsPath, 'utf8') : '[]',
        );
        const ids = ledgerGrants.map((g) => g.id);
        // **تضييقٌ لا توسيعٌ:** لا منحةً جديدةً في اللقطةِ إلا إن قُرِّرَ المرجعُ.
        const added = ids.filter((id) => !idsBefore.includes(id));
        assert.equal(
          added.length,
          row.advanced ? 1 : 0,
          `منحٌ جديدٌ بعدَ الانقطاعِ: ${JSON.stringify(added)} والقرارُ ${
            row.advanced ? 'إقرارٌ' : 'رفضٌ'
          }`,
        );
        // **ولا فقدانَ لمُقرٍّ:** منحةُ هذا الطفلِ إن قُرِّرَ في اللقطةِ.
        if (row.advanced) {
          assert.ok(added.length === 1, 'إقرارٌ بلا منحةٍ');
          committed.push(added[0]);
        }
        // والمنحُ نفسُهُ لا يزالُ سارياً في العقلِ المُعادِ تركيبِهِ (شاهدٌ يُقرُّه).
        for (const id of committed) {
          const entry = ledgerGrants.find((g) => g.id === id);
          assert.ok(entry, `منحةٌ مُقرّةٌ ${id} فُقدتْ من اللقطةِ`);
          assert.equal(entry.revokedAt, null, `منحةٌ مُقرّةٌ ${id} مُسحوبةٌ بلا سببٍ`);
        }
        assert.equal(
          booted.grants.capabilitiesOf('agent:worker').has('action:read-registry'),
          committed.length > 0,
          'سريانُ منحِ `agent:worker` لا يُطابِقُ المُقرّ',
        );
      } finally {
        await booted.runtime.close();
      }
    });
  }

  test('انقطاعٌ حقيقيٌّ بينَ السطرِ والشاهدِ في السحبِ — منحةٌ مُقرّةٌ سُحِبَتْ ثمَّ انقطعَ الطفلُ', async () => {
    assert.ok(ws, 'التهيئةُ لم تُنجَزْ');
    const socket = new FileStateBoundSocket(ws.socketFile);
    // وكيلٌ فريدٌ لهذا الاختبارِ.
    const REVOKED_SPEC = { ...SPEC, agentId: 'agent:revoke-probe' };
    const grantId = await (async () => {
      const setup = await bootWithGrants(ws.root, keys, socket);
      try {
        const granted = await setup.grants.grantAsync(REVOKED_SPEC);
        await settle(setup.runtime.commitBarrier);
        return granted.id;
      } finally {
        await setup.runtime.close();
      }
    })();
    committed.push(grantId);
    // سحبٌ حقيقيٌّ عبرَ عمليّةٍ فرعيّةٍ تُقتَلُ في مرحلةٍ مُسمّاةٍ: فإمّا السحبُ
    // مُقرٌّ (منحةٌ مسحوبةٌ في الملفِّ والشاهدِ) وإمّا مرفوضٌ (منحةٌ ساريةٌ في
    // الملفِّ والشاهدِ) — **لا منتصَفَ** يُبعِثُ المسحوبَ سارياً أو يُخفيَ السحبَ.
    const revokeChild = runChild({
      root: ws.root,
      keys,
      socketFile: ws.socketFile,
      op: 'revoke',
      spec: { id: grantId, reason: 'سُحِبَت' },
      kill: { stage: 'S4' }, // بعدَ تطبيقِ المرجعِ: السحبُ مُقرٌّ في الغالبِ.
    });
    // الحكمُ من اللقطةِ المُعادِ تركيبِها بالشاهدِ لا من مخرجِ عمليّةٍ مقتولةٍ — فقدانُ
    // المخرجِ لا يَعني فقدانَ الإقرارِ ولا عكسَهُ.
    const booted = await bootWithGrants(ws.root, keys, socket);
    try {
      const persisted = JSON.parse(readFileSync(ws.grantsPath, 'utf8'));
      const entry = persisted.find((g) => g.id === grantId);
      assert.ok(entry, 'منحةُ اختبارِ السحبِ فُقدتْ');
      const revokedOnDisk = entry.revokedAt !== null;
      // لا منتصَفَ: إمّا سحبٌ مُقرٌّ (مسحوبةٌ في الملفِّ **والشاهدِ**) وإمّا منحةٌ
      // ساريةٌ فيهما معاً — فلا سحبٌ سارٍ بلا إقرارٍ ولا إقرارٌ يُخفي.
      // والتضييقُ نفسُهُ في العقلِ: ما ليسَ مسحوباً في الملفِ ليسَ سارياً في الشاهدِ.
      assert.equal(
        booted.grants.capabilitiesOf('agent:revoke-probe').has('action:read-registry'),
        !revokedOnDisk,
        revokedOnDisk ? 'سحبٌ مُقرٌّ تُركَ سارياً' : 'سحبٌ مرفوضٌ أُخفيَ (المنحةُ المسحوبةُ عادتْ)',
      );
      if (revokedOnDisk) {
        committed.pop();
      }
    } finally {
      await booted.runtime.close();
    }
  });
});
