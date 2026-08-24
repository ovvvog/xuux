// اختبار مراتب التصنيف وقواعد الترقية والتخفيض — M7.01.
//
// معيار القبول: «تخفيض تصنيف بلا اعتماد يُرفض». والمقيس أوسع من العبارة، لأن
// عبارةً واحدة تُمرَّر بشرطٍ واحد: المفحوص هنا هل يبقى **مسارٌ** لإنزال حساسية
// بيانات بلا اعتماد مسجّل — عبر تمرير كائن اعتماد مختلق، أو إعادة استعمال اعتماد
// مستهلَك، أو استعماله على انتقالٍ غير الذي صدر له، أو بعد أن تغيّر الأصل، أو
// باعتماد المنفّذ نفسه.
//
// ونقطة التفويض هنا **حقيقية** بحزمة السياسات الحقيقية: فهرسٌ يُختبر بنقطةٍ
// مزيّفة يُثبت أنه ينادي مزيّفاً لا أنه محكوم.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import {
  APPROVAL_ERRORS,
  CLASSIFICATION_ERRORS,
  Classification,
  ClassificationApprovalRegistry,
  DataCatalog,
  RECLASSIFY_ERRORS,
  loadClassificationLattice,
} from '../../src/data/index.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';

const bundle = loadPolicyBundle();
const lattice = loadClassificationLattice();
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** سجل أحداث صغير: المقيس ما سُجّل، فلا يُستعار سجلٌ ثقيل لقياس التسجيل. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  return {
    events,
    /**
     * @param {string} type
     * @param {string} actor
     * @param {object} payload
     * @returns {void}
     */
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
}

/**
 * @param {{ withEnforcement?: boolean, withApprovals?: boolean }} [options]
 */
function setup({ withEnforcement = true, withApprovals = true } = {}) {
  const log = memoryLog();
  const approvals = new ClassificationApprovalRegistry({
    log: /** @type {never} */ (log),
    repository: createMemoryRepository(ClassificationApprovalRegistry.spec),
    lattice,
  });
  const enforcementPoint = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
  });
  const catalog = new DataCatalog({
    log: /** @type {never} */ (log),
    repository: createMemoryRepository(DataCatalog.spec),
    lattice,
    approvals: withApprovals ? approvals : null,
    enforcementPoint: withEnforcement ? enforcementPoint : null,
  });
  return { log, approvals, catalog, enforcementPoint };
}

/**
 * @param {Record<string, unknown>} [patch]
 */
function minister(patch = {}) {
  return {
    id: 'agent:minister-1',
    role: 'role:minister',
    kind: /** @type {const} */ ('human'),
    state: 'active',
    scope: 'org:interior',
    ...patch,
  };
}

/**
 * @param {DataCatalog} catalog
 * @param {string} classification
 * @param {string} name
 */
function registerAsset(catalog, classification, name) {
  return catalog.register({
    name,
    owner: 'crown',
    classification: /** @type {never} */ (classification),
    source: 'crown',
  });
}

// ── السلّم نفسه ─────────────────────────────────────────────────────────────

test('السلّم يُحمَّل من الإعدادات ويقرأ الاتجاه والدرجات', () => {
  assert.deepEqual([...lattice.ids], ['public', 'internal', 'sensitive', 'sovereign']);
  assert.equal(lattice.direction('internal', 'sensitive'), 'promotion');
  assert.equal(lattice.direction('sensitive', 'internal'), 'demotion');
  assert.equal(lattice.direction('sensitive', 'sensitive'), 'unchanged');
  assert.equal(lattice.steps('public', 'sovereign'), 3);
  assert.equal(lattice.isSealed('sovereign'), true);
  assert.equal(lattice.isSealed('sensitive'), false);
});

test('المترادف يُحَلّ إلى مرتبته ولا يصير مرتبةً خامسة', () => {
  // العيب المُصلَح: بوابة الاستدلال كانت تعرف `secret` ولا تعرف `sovereign`،
  // فكان أعلى تصنيف يُسجَّل بنصّه. الآن `secret` اسمٌ آخر للمرتبة العليا.
  assert.equal(lattice.normalize('secret'), 'sovereign');
  assert.equal(lattice.rank('secret'), lattice.rank('sovereign'));
  assert.equal(lattice.redactInLogs('secret'), true);
  assert.equal(lattice.normalize('top-secret'), null);
});

test('التصريح المجهول يسقط دون كل المراتب لا يُقرأ عاماً', () => {
  assert.equal(lattice.rank('nonsense'), -1);
  assert.equal(lattice.dominates('nonsense', 'public'), false);
  assert.equal(lattice.dominates(undefined, 'public'), false);
  assert.equal(lattice.dominates('sovereign', 'sensitive'), true);
  assert.equal(lattice.dominates('internal', 'sensitive'), false);
  assert.throws(
    () => lattice.tier('nonsense'),
    (error) => /** @type {{ code: string }} */ (error).code === CLASSIFICATION_ERRORS.TIER_UNKNOWN,
  );
});

test('سلّم منحرف عن تعداد الكود يُسقط التحميل ولا يمرّ صامتاً', () => {
  // انحراف البيانات عن التعداد هو **العيب الأصلي** بعينه، فيُفشل التحميل.
  // والإعداد يُكتب في دليل مؤقت لا في ملفّ ثابت: ملفّ إعدادٍ فاسد يبقى في
  // المستودع يُقرأ يوماً على أنه إعداد.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classification-drift-'));
  fs.mkdirSync(path.join(dir, 'schemas'));
  fs.copyFileSync(
    path.join(REPO_ROOT, 'config', 'schemas', 'classification.schema.json'),
    path.join(dir, 'schemas', 'classification.schema.json'),
  );
  const source = YAML.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'config', 'classification.yaml'), 'utf8'),
  );
  // سلّم متماسك في نفسه (رتب متلاصقة، قمّة مختومة) ومع ذلك يخالف تعداد الكود:
  // إعادة تسمية مرتبة واحدة تكفي لتصير المرتبة معروفةً في ملفّ ومجهولةً في الكود.
  const internal = source.tiers.find(
    (/** @type {{ id: string }} */ tier) => tier.id === 'internal',
  );
  assert.ok(internal, 'ملفّ الإعدادات يجب أن يحوي مرتبة internal');
  internal.id = 'restricted';
  fs.writeFileSync(path.join(dir, 'classification.yaml'), YAML.stringify(source), 'utf8');
  try {
    assert.throws(
      () => loadClassificationLattice({ dir }),
      (error) => /** @type {{ code: string }} */ (error).code === CLASSIFICATION_ERRORS.ENUM_DRIFT,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('سلّم بلا ملفّ معلَن لا يُفترَض في الكود', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classification-missing-'));
  try {
    assert.throws(
      () => loadClassificationLattice({ dir }),
      (error) =>
        /** @type {{ code: string }} */ (error).code === CLASSIFICATION_ERRORS.CONFIG_MISSING,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── الترقية ─────────────────────────────────────────────────────────────────

test('الترقية تنفُذ بتسبيب مسجّل بلا اعتماد', async () => {
  const { catalog, log } = setup();
  const asset = await registerAsset(catalog, Classification.INTERNAL, 'سجل الترقية');
  const after = await catalog.reclassify({
    id: asset.id,
    actor: minister(),
    to: Classification.SENSITIVE,
    justification: 'تبيّن أن السجل يحوي أسماء أشخاص فرُفعت حساسيته.',
  });
  assert.equal(after.classification, 'sensitive');
  const changed = log.events.filter((event) => event.type === 'data.classification.changed');
  assert.equal(changed.length, 1);
  assert.equal(changed[0]?.payload['direction'], 'promotion');
  assert.equal(changed[0]?.payload['approvalId'], null);
});

test('الترقية بلا تسبيب مقروء تُرفض وتُسجَّل', async () => {
  const { catalog, log } = setup();
  const asset = await registerAsset(catalog, Classification.INTERNAL, 'سجل بلا سبب');
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.SENSITIVE,
        justification: 'لأن',
      }),
    (error) =>
      /** @type {{ code: string }} */ (error).code === RECLASSIFY_ERRORS.JUSTIFICATION_REQUIRED,
  );
  assert.equal(
    log.events.filter((event) => event.type === 'data.classification.refused').length,
    1,
    'الرفض يُسجَّل كما يُسجَّل القبول',
  );
  const still = await catalog.get(asset.id);
  assert.equal(still?.classification, 'internal');
});

// ── التخفيض: معيار القبول ───────────────────────────────────────────────────

test('تخفيض تصنيف بلا اعتماد يُرفض ولا يُكتب', async () => {
  const { catalog, log } = setup();
  const asset = await registerAsset(catalog, Classification.SENSITIVE, 'سجل التخفيض');
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.INTERNAL,
        justification: 'انتهى سبب الحساسية بعد إخفاء أسماء الأشخاص.',
      }),
    (error) =>
      /** @type {{ code: string }} */ (error).code ===
      RECLASSIFY_ERRORS.DOWNGRADE_APPROVAL_REQUIRED,
  );
  const still = await catalog.get(asset.id);
  assert.equal(still?.classification, 'sensitive', 'التصنيف لم يُكتب');
  assert.equal(still?.version, 1, 'الرفض لا يُنتج كتابة');
  assert.equal(
    log.events.filter((event) => event.type === 'data.classification.refused').length,
    1,
  );
});

test('كائن اعتماد مُختلق لا ينفع: الاعتماد يُقرأ بمُعرّفه من الدفتر', async () => {
  const { catalog } = setup();
  const asset = await registerAsset(catalog, Classification.SENSITIVE, 'سجل الاختلاق');
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.INTERNAL,
        justification: 'انتهى سبب الحساسية بعد إخفاء الأسماء.',
        // مُعرّف يشبه المُعرّفات ولا صفَّ له في الدفتر.
        approvalId: 'approval:00000000-0000-4000-8000-000000000000',
      }),
    (error) => /** @type {{ code: string }} */ (error).code === APPROVAL_ERRORS.NOT_FOUND,
  );
  assert.equal((await catalog.get(asset.id))?.classification, 'sensitive');
});

test('التخفيض باعتماد مسجّل ينفُذ مرّة واحدة ثم يُرفض إعادة استعماله', async () => {
  const { catalog, approvals, log } = setup();
  const asset = await registerAsset(catalog, Classification.SENSITIVE, 'سجل الاعتماد الصحيح');
  const approval = await approvals.grant({
    assetId: asset.id,
    from: Classification.SENSITIVE,
    to: Classification.INTERNAL,
    requestedBy: 'agent:minister-1',
    approvedBy: 'agent:auditor-1',
    approverRole: 'role:auditor',
    justification: 'رُوجعت المادة فلم يبقَ فيها ما يُعرِّف شخصاً.',
    recordVersion: asset.version,
  });
  const after = await catalog.reclassify({
    id: asset.id,
    actor: minister(),
    to: Classification.INTERNAL,
    justification: 'رُوجعت المادة فلم يبقَ فيها ما يُعرِّف شخصاً.',
    approvalId: approval.id,
  });
  assert.equal(after.classification, 'internal');
  const consumed = await approvals.get(approval.id);
  assert.ok(consumed?.consumedAt instanceof Date, 'الاعتماد يُختم بالاستهلاك');
  assert.equal(consumed?.consumedBy, 'agent:minister-1');
  assert.equal(
    log.events.filter((event) => event.type === 'data.classification.approval.consumed').length,
    1,
  );

  // إعادة الاستعمال: الأصل صار `internal`، فتُطلب رقيةٌ ثانية باعتمادٍ ثانٍ.
  const promoted = await catalog.reclassify({
    id: asset.id,
    actor: minister(),
    to: Classification.SENSITIVE,
    justification: 'أُعيدت مادةٌ حسّاسة إلى الأصل فرُفع تصنيفه.',
  });
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: promoted.id,
        actor: minister(),
        to: Classification.INTERNAL,
        justification: 'محاولة إعادة استعمال اعتماد مستهلَك.',
        approvalId: approval.id,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === APPROVAL_ERRORS.CONSUMED,
  );
  assert.equal((await catalog.get(asset.id))?.classification, 'sensitive');
});

test('الاعتماد مربوط بالانتقال وبنسخة السجل، فلا يُستعمل على غيرهما', async () => {
  const { catalog, approvals } = setup();
  const asset = await registerAsset(catalog, Classification.SENSITIVE, 'سجل الربط');
  const approval = await approvals.grant({
    assetId: asset.id,
    from: Classification.SENSITIVE,
    to: Classification.INTERNAL,
    requestedBy: 'agent:minister-1',
    approvedBy: 'agent:auditor-1',
    approverRole: 'role:auditor',
    justification: 'اعتماد لانتقالٍ بعينه على نسخةٍ بعينها.',
    recordVersion: asset.version,
  });
  // نسخة الأصل تغيّرت بعد الاعتماد: القرار كان على حالٍ لم تبقَ.
  await catalog.markQuality(asset.id, 'verified');
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.INTERNAL,
        justification: 'الأصل تغيّر بعد الاعتماد.',
        approvalId: approval.id,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === APPROVAL_ERRORS.MISMATCH,
  );
  assert.equal((await catalog.get(asset.id))?.classification, 'sensitive');
});

test('من اعتمد التخفيض لا ينفّذه، ومن طلبه لا يعتمده', async () => {
  const { catalog, approvals } = setup();
  const asset = await registerAsset(catalog, Classification.SENSITIVE, 'سجل فصل السلطات');
  await assert.rejects(
    () =>
      approvals.grant({
        assetId: asset.id,
        from: Classification.SENSITIVE,
        to: Classification.INTERNAL,
        requestedBy: 'agent:minister-1',
        approvedBy: 'agent:minister-1',
        approverRole: 'role:auditor',
        justification: 'اعتماد ذاتي يجب أن يُرفض.',
        recordVersion: asset.version,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === APPROVAL_ERRORS.SELF,
  );

  const approval = await approvals.grant({
    assetId: asset.id,
    from: Classification.SENSITIVE,
    to: Classification.INTERNAL,
    requestedBy: 'agent:auditor-2',
    approvedBy: 'agent:minister-1',
    approverRole: 'role:auditor',
    justification: 'المعتمِد هو نفسه المنفّذ في هذه المحاولة.',
    recordVersion: asset.version,
  });
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.INTERNAL,
        justification: 'المعتمِد ينفّذ اعتماده بنفسه.',
        approvalId: approval.id,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === APPROVAL_ERRORS.SELF,
  );
});

test('الاعتماد المنتهي لا يُقبل، فالنافذة ليست رخصة دائمة', async () => {
  const log = memoryLog();
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const approvals = new ClassificationApprovalRegistry({
    log: /** @type {never} */ (log),
    repository: createMemoryRepository(ClassificationApprovalRegistry.spec),
    lattice,
    now: () => clock,
  });
  const catalog = new DataCatalog({
    log: /** @type {never} */ (log),
    repository: createMemoryRepository(DataCatalog.spec),
    lattice,
    approvals,
    enforcementPoint: new EnforcementPoint({
      decisionPoint: createPolicyDecisionPoint({ bundle }),
      log,
    }),
  });
  const asset = await registerAsset(catalog, Classification.SENSITIVE, 'سجل النافذة');
  const approval = await approvals.grant({
    assetId: asset.id,
    from: Classification.SENSITIVE,
    to: Classification.INTERNAL,
    requestedBy: 'agent:auditor-2',
    approvedBy: 'agent:auditor-1',
    approverRole: 'role:auditor',
    justification: 'اعتماد سيُترك حتى تنتهي نافذته.',
    recordVersion: asset.version,
  });
  clock = new Date(clock.getTime() + lattice.demotion.approvalTtlMs + 1000);
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.INTERNAL,
        justification: 'استعمال اعتماد بعد انتهاء نافذته.',
        approvalId: approval.id,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === APPROVAL_ERRORS.EXPIRED,
  );
  assert.equal((await catalog.get(asset.id))?.classification, 'sensitive');
});

// ── الحدود المعلنة ──────────────────────────────────────────────────────────

test('المرتبة السيادية مختومة: لا تُخفَّض ولا يُمنح لها اعتماد', async () => {
  const { catalog, approvals } = setup();
  const asset = await registerAsset(catalog, Classification.SOVEREIGN, 'سجل سيادي');
  await assert.rejects(
    () =>
      approvals.grant({
        assetId: asset.id,
        from: Classification.SOVEREIGN,
        to: Classification.SENSITIVE,
        requestedBy: 'agent:minister-1',
        approvedBy: 'agent:auditor-1',
        approverRole: 'role:auditor',
        justification: 'محاولة اعتماد إنزال مرتبة مختومة.',
        recordVersion: asset.version,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === APPROVAL_ERRORS.TIER_SEALED,
  );
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.SENSITIVE,
        justification: 'محاولة إنزال المرتبة المختومة.',
        approvalId: 'approval:whatever',
      }),
    (error) => /** @type {{ code: string }} */ (error).code === RECLASSIFY_ERRORS.TIER_SEALED,
  );
});

test('الهبوط قفزاً لا يُعتمد: كل درجة قرارٌ مستقل', async () => {
  const { catalog, approvals } = setup();
  const asset = await registerAsset(catalog, Classification.SENSITIVE, 'سجل القفز');
  await assert.rejects(
    () =>
      approvals.grant({
        assetId: asset.id,
        from: Classification.SENSITIVE,
        to: Classification.PUBLIC,
        requestedBy: 'agent:minister-1',
        approvedBy: 'agent:auditor-1',
        approverRole: 'role:auditor',
        justification: 'محاولة إنزال درجتين باعتماد واحد.',
        recordVersion: asset.version,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === APPROVAL_ERRORS.STEP_TOO_LARGE,
  );
});

test('دورٌ خارج أدوار الاعتماد المعلنة لا يعتمد تخفيضاً', async () => {
  const { catalog, approvals } = setup();
  const asset = await registerAsset(catalog, Classification.SENSITIVE, 'سجل الأدوار');
  await assert.rejects(
    () =>
      approvals.grant({
        assetId: asset.id,
        from: Classification.SENSITIVE,
        to: Classification.INTERNAL,
        requestedBy: 'agent:minister-1',
        approvedBy: 'agent:operator-9',
        approverRole: 'role:operator',
        justification: 'دور تشغيلي يحاول اعتماد تخفيض.',
        recordVersion: asset.version,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === APPROVAL_ERRORS.ROLE_FORBIDDEN,
  );
});

test('السياسة تمنع التخفيض إلى العام ولو حمل اعتماداً صحيحاً', async () => {
  const { catalog, approvals } = setup();
  const asset = await registerAsset(catalog, Classification.INTERNAL, 'سجل النشر');
  const approval = await approvals.grant({
    assetId: asset.id,
    from: Classification.INTERNAL,
    to: Classification.PUBLIC,
    requestedBy: 'agent:auditor-2',
    approvedBy: 'agent:auditor-1',
    approverRole: 'role:auditor',
    justification: 'اعتماد صحيح لنشرٍ تمنعه السياسة.',
    recordVersion: asset.version,
  });
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.PUBLIC,
        justification: 'اعتماد صحيح لكن السياسة تمنع النشر.',
        approvalId: approval.id,
      }),
    (error) => /** @type {{ code: string }} */ (error).code === RECLASSIFY_ERRORS.NOT_AUTHORIZED,
  );
  assert.equal((await catalog.get(asset.id))?.classification, 'internal');
  // الاعتماد لم يُحرَق على طلبٍ رفضته السياسة.
  assert.equal((await approvals.get(approval.id))?.consumedAt, null);
});

test('فاعلٌ لا سياسة تسمح له بإعادة التصنيف يُرفض ويُسجَّل قراره', async () => {
  const { catalog, log } = setup();
  const asset = await registerAsset(catalog, Classification.INTERNAL, 'سجل غير المأذون');
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister({ id: 'agent:operator-1', role: 'role:operator', kind: 'autonomous' }),
        to: Classification.SENSITIVE,
        justification: 'فاعل تشغيلي يحاول رفع التصنيف.',
      }),
    (error) => /** @type {{ code: string }} */ (error).code === RECLASSIFY_ERRORS.NOT_AUTHORIZED,
  );
  assert.ok(
    log.events.some((event) => event.type === 'policy.decision'),
    'قرار السياسة يُسجَّل ولو كان رفضاً',
  );
});

test('فهرسٌ بلا نقطة تفويض يرفض إعادة التصنيف ولا يتجاوزها', async () => {
  const { catalog } = setup({ withEnforcement: false });
  const asset = await registerAsset(catalog, Classification.INTERNAL, 'سجل بلا تفويض');
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.SENSITIVE,
        justification: 'تركيبٌ ناقص لا يصير مساراً جانبياً.',
      }),
    (error) =>
      /** @type {{ code: string }} */ (error).code === RECLASSIFY_ERRORS.ENFORCEMENT_REQUIRED,
  );
});

test('فهرسٌ بلا دفتر اعتمادات يرفض التخفيض ولا يمرّره', async () => {
  const { catalog } = setup({ withApprovals: false });
  const asset = await registerAsset(catalog, Classification.SENSITIVE, 'سجل بلا دفتر');
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.INTERNAL,
        justification: 'تركيبٌ بلا دفتر اعتمادات.',
      }),
    (error) =>
      /** @type {{ code: string }} */ (error).code === RECLASSIFY_ERRORS.APPROVALS_REQUIRED,
  );
});

test('إعادة تصنيف إلى نفس المرتبة تُرفض فلا تملأ السجل بلا قرار', async () => {
  const { catalog } = setup();
  const asset = await registerAsset(catalog, Classification.INTERNAL, 'سجل بلا تغيير');
  await assert.rejects(
    () =>
      catalog.reclassify({
        id: asset.id,
        actor: minister(),
        to: Classification.INTERNAL,
        justification: 'لا تغيير في المرتبة المطلوبة.',
      }),
    (error) => /** @type {{ code: string }} */ (error).code === RECLASSIFY_ERRORS.UNCHANGED,
  );
});
