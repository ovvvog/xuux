import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { loadCapabilityCatalog } from '../../src/identity/capability-catalog.mjs';
import { CapabilityGrantLedger } from '../../src/identity/capability-grants.mjs';
/** استبدالُ مخزنِ الدفترِ بلا تحديثٍ على حالةٍ قديمةٍ (يتجنّبُ require-atomic-updates). */
/**
 * استبدالُ مخزنِ الدفترِ بلا تحديثٍ على حالةٍ قديمةٍ (يتجنّبُ require-atomic-updates).
 * @param {import('../../src/identity/capability-grants.mjs').CapabilityGrantLedger} ledger
 * @param {{ load(): unknown; save(entries: unknown[]): void }} store
 */
function swapStore(ledger, store) {
  ledger.store = /** @type {never} */ (store);
}

import { FileCapabilityGrantStore } from '../../src/identity/capability-grant-store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const base = {
  agentId: 'agent:worker',
  capability: 'action:read-registry',
  reason: 'تدقيق حادثة رقم 7',
  principal: { id: 'agent:minister', role: 'role:minister', state: 'active' },
  ttlSeconds: 3600,
};

/**
 * دفترٌ بساعةٍ متحكَّمٍ بها ومخزنٍ ملفيٍّ في دليلٍ مؤقّتٍ.
 * @param {string} dir
 */
function setup(dir) {
  const log = new EventLog();
  const store = new FileCapabilityGrantStore({
    filePath: path.join(dir, 'grants.json'),
  });
  const ledger = new CapabilityGrantLedger({
    catalog: loadCapabilityCatalog(),
    log,
    store,
  });
  return { ledger, store };
}

test('الملفُّ الغائبُ إقلاعٌ نظيفٌ: لا منحَ ولا خطأ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-clean-'));
  try {
    const { ledger } = setup(dir);
    assert.equal(ledger.capabilitiesOf('agent:worker').size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('إعادةُ تشغيلِ عمليّةٍ فعليةٍ تُبقي المنحَ الساريةَ وتُخفي المنتهيَ وتحفظَ المسحوبَ', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-restart-'));
  try {
    // العمليةُ الأولى: ساعةٌ متحكَّمٌ بها تمنحُ ثلاثاً — ساريةً ومنتهيةً ومسحوبةً.
    const log = new EventLog();
    const store = new FileCapabilityGrantStore({
      filePath: path.join(dir, 'grants.json'),
    });
    const grantedAtMs = Date.now() - 120_000; // قبل دقيقتين
    const ledger = new CapabilityGrantLedger({
      catalog: loadCapabilityCatalog(),
      log,
      store,
      now: () => new Date(grantedAtMs),
    });
    const live = ledger.grant({ ...base, ttlSeconds: 3600 });
    const expired = ledger.grant({
      ...base,
      reason: 'منحة انقضت مدتها قبل الإقلاع الثاني',
      ttlSeconds: 60,
    });
    const revoked = ledger.grant({
      ...base,
      reason: 'منحة سُحبت قبل الإقلاع الثاني',
      ttlSeconds: 3600,
    });
    ledger.revoke(revoked.id, 'حادثة اختراق مشتبهة');
    // **WL-361 (‏`R6-A-05`، تتمّةُ «المنح»): الحفظُ صارَ «الشاهدُ المختومُ أوّلاً ثمّ الملفُّ» — فقبلَ
    // أن تُقرأَ اللقطةُ (أو تُنشأَ العملليّةُ الابنةُ) يُنتظرُ اكتمالُ حفظِ آخرِ عمليةٍ (`persist()`).
    await ledger.persist();
    assert.equal(fs.existsSync(store.filePath), true, 'المنحُ تُكتبُ اللقطةَ فورَ كلِّ منحٍ وسحبٍ');
    const snapshot = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
    assert.equal(snapshot.length, 3, 'المنحُ الثلاثُ في اللقطةِ: الساريةُ والمنتهيةُ والمسحوبةُ');

    // العملليّةُ الجديدةُ (ابنةٌ حقيقيةٌ): تعيدَ بناءَ الدفترِ من القرصِ وحدها.
    const childScript = path.join(dir, 'child.mjs');
    // نكتبُ النصَّ كاستيرادٍ صريحٍ لا كتوليدٍ نصيٍّ هشٍّ:
    fs.writeFileSync(
      childScript,
      [
        `import { CapabilityGrantLedger } from ${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src/identity/capability-grants.mjs')).href)};`,
        `import { FileCapabilityGrantStore } from ${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src/identity/capability-grant-store.mjs')).href)};`,
        `import { loadCapabilityCatalog } from ${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src/identity/capability-catalog.mjs')).href)};`,
        `const store = new FileCapabilityGrantStore({ filePath: ${JSON.stringify(store.filePath)} });`,
        `const ledger = new CapabilityGrantLedger({`,
        `  catalog: loadCapabilityCatalog(),`,
        `  log: { append: () => {} },`,
        `  store,`,
        `});`,
        `const grants = [...ledger.grants.values()].map((g) => ({`,
        `  id: g.id,`,
        `  expiresAt: g.expiresAt,`,
        `  revokedAt: g.revokedAt,`,
        `  active: ledger.capabilitiesOf(${JSON.stringify(base.agentId)}).size > 0 && ledger.activeGrants(${JSON.stringify(base.agentId)}).some((x) => x.id === g.id),`,
        `}));`,
        `console.log(JSON.stringify({ count: grants.length, grants }));`,
      ].join('\n'),
      'utf8',
    );
    const run = spawnSync(process.execPath, [childScript], { encoding: 'utf8' });
    assert.equal(run.status, 0, `العملليّةُ الابنةُ فشلت: ${run.stderr}`);
    const seen =
      /** @type {{ count: number, grants: Array<{ id: string, active: boolean, revokedAt: string | null }> }} */ (
        JSON.parse(run.stdout.trim())
      );
    assert.equal(seen.count, 3, 'المنحُ الثلاثُ نجت من إعادةِ التشغيلِ الفعليةِ');
    const liveAfter = seen.grants.find((g) => g.id === live.id);
    const expiredAfter = seen.grants.find((g) => g.id === expired.id);
    const revokedAfter = seen.grants.find((g) => g.id === revoked.id);
    assert.ok(liveAfter, 'المنحةُ الساريةُ موجودةٌ في العمليّةِ الابنةِ');
    assert.equal(liveAfter.active, true, 'الساريةُ تبقى ساريةً في العمليّةِ الجديدةِ');
    assert.ok(expiredAfter, 'المنحةُ المنتهيةُ موجودةٌ في العمليّةِ الابنةِ');
    assert.equal(
      expiredAfter.active,
      false,
      'المنتهيةُ لا تعودُ ساريةً بإعادةِ التشغيلِ — الانتهاءُ يُحسبُ وقتَ القراءةِ',
    );
    assert.ok(revokedAfter, 'المنحةُ المسحوبةُ موجودةٌ في العمليّةِ الابنةِ');
    assert.notEqual(revokedAfter.revokedAt, null, 'السحبُ يبقى بعدَ إعادةِ التشغيلِ');
    assert.equal(revokedAfter.active, false, 'والمسحوبةُ لا تعودُ فعّالةً');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('لقطةٌ معطوبةٌ تُرفعُ بخطأٍ مسمّى لا تُفترضُ فارغة', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-corrupt-'));
  try {
    const store = new FileCapabilityGrantStore({
      filePath: path.join(dir, 'grants.json'),
    });
    fs.writeFileSync(store.filePath, '{ليست JSON', 'utf8');
    assert.throws(
      () =>
        new CapabilityGrantLedger({
          catalog: loadCapabilityCatalog(),
          log: new EventLog(),
          store,
        }),
      /CAPABILITY_GRANT_STORE_UNREADABLE/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('مدخلٌ مُسترجَعٌ ناقصُ الحقولِ أو فاسدُ التاريخِ أو متناقضُ السحبِ يُرفضُ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-invalid-'));
  try {
    const valid = {
      id: 'grant:x',
      agentId: 'agent:worker',
      capability: 'action:read-registry',
      reason: 'سبب مكتوب',
      grantedBy: 'agent:minister',
      grantorRole: 'role:minister',
      grantedAt: '2026-10-08T10:00:00.000Z',
      expiresAt: '2026-10-08T11:00:00.000Z',
      revokedAt: null,
      revokedReason: null,
    };
    /** @type {Array<[string, Record<string, unknown>]>} */
    const cases = [
      ['ناقصُ حقلٍ نصيٍّ', { ...valid, reason: '' }],
      ['تاريخٌ غيرُ مقروءٍ', { ...valid, expiresAt: 'ليست تاريخاً' }],
      ['سحبٌ بلا سببٍ', { ...valid, revokedAt: '2026-10-08T10:30:00.000Z', revokedReason: null }],
      ['سببُ سحبٍ بلا ختمٍ', { ...valid, revokedReason: 'سبب بلا ختم' }],
    ];
    for (const [label, entry] of cases) {
      const store = new FileCapabilityGrantStore({
        filePath: path.join(dir, 'grants.json'),
      });
      store.save([entry]);
      assert.throws(
        () =>
          new CapabilityGrantLedger({
            catalog: loadCapabilityCatalog(),
            log: new EventLog(),
            store,
          }),
        /CAPABILITY_GRANT_STORE_INVALID/,
        label,
      );
    }
    // ومعرِّفٌ مكرَّرٌ مرفوضٌ كذلك:
    const store = new FileCapabilityGrantStore({
      filePath: path.join(dir, 'grants.json'),
    });
    store.save([valid, { ...valid }]);
    assert.throws(
      () =>
        new CapabilityGrantLedger({
          catalog: loadCapabilityCatalog(),
          log: new EventLog(),
          store,
        }),
      /CAPABILITY_GRANT_STORE_INVALID/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('فشلُ كتابةِ المنحِ يُحفَظُ ويُرفعُ لا يُبتلَعُ: لا لقطةَ بمنحٍ لم يُلتزمْ بهِ (`WL-361`)', async () => {
  // **العقدُ تغيّرَ بـ`WL-361` (‏`R6-A-05`، تتمّةُ «المنح»):** الحفظُ صارَ «الشاهدُ المختومُ أوّلاً
  // ثمّ الملفُّ» — فالمنحُ لا يُرجِعُ خطأً كتابةِ القرصِ فوراً، بل يُسجِّلُهُ ويُحفَظُ ويرفعُهُ عندَ
  // نداءِ `persist()` التالي. والاختبارُ يُثبتُ أنّ الفشلَ لا يُبتلَعُ وأنّ اللقطةَ لا تُخرجُ منحاً بلا
  // شاهدٍ: الشاهدُ المختومُ أوّلاً (الحدثُ يُسجَّلُ في السجلِّ) ثمّ الملفُّ يُحفَظُ (فشلُهُ يُحفَظُ لا
  // يُنتجُ لقطةً ناقصةً الشاهدِ).
  const log = new EventLog();
  let shouldFail = true;
  const failingStore = {
    load: () => null,
    save: () => {
      if (shouldFail) throw new Error('disk full');
    },
  };
  const ledger = new CapabilityGrantLedger({
    catalog: loadCapabilityCatalog(),
    log,
    store: failingStore,
  });
  ledger.grant({ ...base, ttlSeconds: 60 });
  // الفشلُ لا يُبتلَعُ: يُحفَظُ ويُرفعُ عندَ `persist()` التالي — لا يُفترَضُ ناجحاً.
  await assert.rejects(() => ledger.persist(), /CAPABILITY_GRANT_STORE_WRITE_FAILED/);
  // ولا تُقرأُ منحٌ بلا شاهدٍ: الاسترجاعُ يَقبلُ منحاً مُشهَداً لهُ وحدَهُ.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-retry-'));
  try {
    const goodStore = new FileCapabilityGrantStore({
      filePath: path.join(dir, 'grants.json'),
    });
    swapStore(ledger, goodStore);
    shouldFail = false;
    const granted = ledger.grant({ ...base, ttlSeconds: 60 });
    await ledger.persist();
    // **العقدُ الجديدُ (`WL-361`):** المنحُ الأوّلُ واقعٌ مُشهَداً لهُ (الحدثُ المختومُ سُجِّلَ
    // قبلَ الحفظِ) وفشلُ ملفِّهِ لا يُلغيهِ — فالذاكرةُ تحفظُهُما معاً، واللُقطةُ بعدَ النجاحِ
    // تُخرِجُ الاثنَينِ: منحٌ فشلَ ملفُّهُ ليسَ منحاً ملفياً بلا شاهدٍ.
    assert.equal(ledger.grants.size, 2);
    const onDiskAfterRetry = JSON.parse(fs.readFileSync(goodStore.filePath, 'utf8'));
    assert.equal(onDiskAfterRetry.length, 2, 'وبعدَ النجاحِ اللقطةُ على القرصِ للمنحَينِ');
    assert.equal(
      log.events.filter((e) => e.type === 'capability.granted').length,
      2,
      'والشاهدُ المختومُ مكتوبٌ للمنحَينِ (الشاهدُ أوّلاً لا الملفُّ)',
    );
    const grantedEvents = log.events.filter((e) => e.type === 'capability.granted');
    assert.equal(
      /** @type {{ data: { id: string } }} */ (grantedEvents[1]).data.id,
      granted.id,
      'وثاني شاهدٍ هو المنحُ الثاني',
    );
    assert.equal(
      /** @type {{ data: { id: string } }} */ (grantedEvents[0]).data.id === granted.id,
      false,
      'والأوّلُ شاهدٌ للمنحِ الأولِ لا للثاني',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('فشلُ كتابةِ السحبِ لا يُوسّعُ صلاحيةً: المسحوبُ يبقى سارياً في الذاكرةِ والقرصِ معاً (`WL-361`)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-revoke-fail-'));
  try {
    const log = new EventLog();
    const store = new FileCapabilityGrantStore({
      filePath: path.join(dir, 'grants.json'),
    });
    const ledger = new CapabilityGrantLedger({
      catalog: loadCapabilityCatalog(),
      log,
      store,
    });
    const granted = ledger.grant({ ...base, ttlSeconds: 3600 });
    await ledger.persist();

    // المخزنُ يتعطّلُ بعدَ المنحِ: السحبُ يُسجِّلُ الشاهدَ ثمّ يفشلُ حفظُهُ فلا يُبتلَعُ. (المخزنُ
    // واحدٌ يُبدَّلُ سلوكُهُ بمتغيّرٍ لا يُعادَ ربطُهُ — فلا تحديثٌ على حالةٍ قديمةٍ.)
    const failing = { mode: 'fail' };
    const statefulStore = {
      load: () => null,
      save: () => {
        if (failing.mode === 'fail') throw new Error('disk full');
      },
    };
    swapStore(ledger, statefulStore);
    ledger.revoke(granted.id, 'سبب إداري');
    await assert.rejects(() => ledger.persist(), /CAPABILITY_GRANT_STORE_WRITE_FAILED/);
    // **والحفظُ لا يُوسّعُ صلاحيةً:** الشاهدُ (الحدثُ المختومُ) يقولُ «مُسحوبٌ»، والملفُّ لم
    // يُحفَظْ بعدُ. القراءةُ الحيّةُ تُطبِّقُ **الشاهدَ لا الذاكرةَ ولا الملفَّ** — فالسحبُ واقعٌ
    // مُشهَداً لهُ حتى لو فشلَ حفظُ الملفّ: من سحبَ فقد سحبَ، لا عودةَ ساريةً إلا بمنحٍ جديدٍ.
    assert.equal(
      ledger.capabilitiesOf('agent:worker').size,
      0,
      'سحبٌ شُهِدَ لهُ واقعٌ في السجلِّ المختومِ — لا تُوسّعُهُ ذاكرةٌ ولا ملفٌّ',
    );
    const onDisk = /** @type {Array<{ id: string, revokedAt: string | null }>} */ (
      JSON.parse(fs.readFileSync(store.filePath, 'utf8'))
    );
    const onDiskGranted = onDisk.find((g) => g.id === granted.id);
    assert.ok(onDiskGranted, 'المنحةُ على القرصِ');
    assert.equal(
      onDiskGranted.revokedAt,
      null,
      'والقرصُ ما زالَ يقولُ سارياً — الحالتانِ متّسقتانِ',
    );

    // وإعادةُ المحاولةِ بمخزنٍ سليمٍ تنجحُ (لا مأزقَ «مُسحوبٌ في الذاكرةِ فقط»): السحبُ واقعٌ
    // في الذاكرةِ (مُشهَدٌ لهُ في السجلِّ)، و`persist()` يَصرِفُ عمليّةَ الحفظِ المُعلَّقةَ — فلا
    // يبقى «مُسحوبٌ في الذاكرةِ فقط» إلا حتى أوّلِ صرفٍ.
    swapStore(ledger, store);
    failing.mode = 'ok';
    ledger.revoke(granted.id, 'سبب إداري');
    await ledger.persist();
    assert.equal(ledger.capabilitiesOf('agent:worker').size, 0);
    const afterRetry = /** @type {Array<{ id: string, revokedAt: string | null }>} */ (
      JSON.parse(fs.readFileSync(store.filePath, 'utf8'))
    );
    const retried = afterRetry.find((g) => g.id === granted.id);
    assert.ok(retried, 'المنحةُ بعدَ إعادةِ المحاولةِ على القرصِ');
    assert.notEqual(retried.revokedAt, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('السحبُ والتفريغُ يُدمانِ اللقطةَ أيضاً لا المنحُ وحدَه (`WL-361`)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-persist-'));
  try {
    const { ledger, store } = setup(dir);
    const granted = ledger.grant({ ...base, ttlSeconds: 60 });
    await ledger.persist();
    const afterGrant = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
    assert.equal(afterGrant.length, 1);

    ledger.revoke(granted.id, 'سبب إداري');
    await ledger.persist();
    const afterRevoke = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
    assert.notEqual(afterRevoke[0].revokedAt, null, 'السحبُ مُدوَّمٌ في اللقطةِ');

    // التفريغُ يُدوِمُ الحذفَ: لقطةٌ بعدَ انتهاءِ المدةِ تصيرُ فارغةً.
    const pruned = ledger.prune();
    assert.equal(pruned, 1);
    await ledger.persist();
    const afterPrune = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
    assert.deepEqual(afterPrune, [], 'التفريغُ مُدوَّمٌ لا ذاكرةٌ تعودُ بما حُذفَ');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('حذفُ حقلي السحبِ من لقطةٍ يُرفضُ: المسحوبَ لا يُبعثُ سارياً', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-norevoke-'));
  try {
    const store = new FileCapabilityGrantStore({
      filePath: path.join(dir, 'grants.json'),
    });
    const revokedGrant = {
      id: 'grant:r',
      agentId: 'agent:worker',
      capability: 'action:read-registry',
      reason: 'سبب مكتوب',
      grantedBy: 'agent:minister',
      grantorRole: 'role:minister',
      grantedAt: '2026-10-08T10:00:00.000Z',
      expiresAt: '2027-10-08T10:00:00.000Z',
      revokedAt: '2026-10-08T10:30:00.000Z',
      revokedReason: 'حادثة',
    };
    const { revokedAt: _a, revokedReason: _b, ...withoutFields } = revokedGrant;
    store.save([withoutFields]);
    assert.throws(
      () =>
        new CapabilityGrantLedger({
          catalog: loadCapabilityCatalog(),
          log: new EventLog(),
          store,
        }),
      /CAPABILITY_GRANT_STORE_INVALID/,
      'غيابُ حقلي السحبِ رفضٌ لا صفرٌ — وإلا صارَ حذفُ الحقلينِ طريقَ إحياءِ مسحوبٍ',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('لقطةٌ تُحيي قدرةً محرَّمةً تُرفضُ: الاسترجاعُ لا يلتفُّ حولَ المحرَّمِ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-forbidden-'));
  try {
    const store = new FileCapabilityGrantStore({
      filePath: path.join(dir, 'grants.json'),
    });
    store.save([
      {
        id: 'grant:f',
        agentId: 'agent:worker',
        capability: 'sovereign:root',
        reason: 'محاولة إحياء محرَّم عبر اللقطة',
        grantedBy: 'agent:minister',
        grantorRole: 'role:minister',
        grantedAt: '2026-10-08T10:00:00.000Z',
        expiresAt: '2027-10-08T10:00:00.000Z',
        revokedAt: null,
        revokedReason: null,
      },
    ]);
    assert.throws(
      () =>
        new CapabilityGrantLedger({
          catalog: loadCapabilityCatalog(),
          log: new EventLog(),
          store,
        }),
      /CAPABILITY_GRANT_STORE_INVALID/,
      'ما يرفضُه المسارُ الحيُّ يرفضُه الاسترجاعُ',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('جذرُ التركيبِ يمرِّرُ المخزنَ إلى الدفترِ لا يبنيهُ في الخفاءِ', async () => {
  const { composeEnforcementChain } = await import('../../src/core/composition-root.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl355-compose-'));
  try {
    const store = new FileCapabilityGrantStore({
      filePath: path.join(dir, 'grants.json'),
    });
    const chain = composeEnforcementChain({
      log: new EventLog(),
      grantsStore: store,
    });
    assert.equal(chain.grants.store, store, 'المخزنُ الذي مرَّرَهُ المُركِّبُ هو الذي يعيشُ');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
