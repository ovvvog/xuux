/**
 * نسب البيانات — اختبارات الخطوة `M7.04`.
 *
 * **معيار القبول بنصّه:** «استعلام النسب يُعيد السلسلة كاملة لأي أصل». وهو أول
 * اختبار في هذا الملف، ومقياسُه سلسلةٌ بعمق أربع طبقات فيها التقاءُ فرعين، مع
 * قراءاتٍ وكتاباتٍ على طبقاتٍ مختلفة — لأن سلسلةً بطبقةٍ واحدة تُجاب بمسحٍ
 * ساذج، والالتقاء هو ما يكشف عدّ العُقد مرّتين.
 *
 * وبقيّة الملف تقيس ما يمنع أن يعود النسب ادّعاءً: سلفٌ مجهول، واشتقاقٌ ينزل
 * بالتصنيف، ودورة، وحقلُ `lineage` الملغى، وسلسلةُ تجزئةٍ تُكشف بالعبث، وبوابةٌ
 * بلا دفتر، وقيدٌ يُكتب قبل الأثر.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { EventLog } from '../../src/root-of-trust/index.mjs';
import { Classification, loadClassificationLattice } from '../../src/data/classification.mjs';
import { DataCatalog } from '../../src/data/data-catalog.mjs';
import { ACCESS_ERRORS, DataAccessGate } from '../../src/data/access-gate.mjs';
import {
  LINEAGE_ERRORS,
  LINEAGE_GENESIS,
  LineageLedger,
  loadLineagePolicy,
} from '../../src/data/lineage.mjs';
import { DATA_ASSET_SPEC, DATA_LINEAGE_SPEC } from '../../src/persistence/entities.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { enforcementPointFor, testActor } from '../helpers/authorization.mjs';
import { createTestLedger } from '../helpers/lineage.mjs';

const lattice = loadClassificationLattice();
const ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * تركيبٌ كما في التشغيل: فهرسٌ ودفترٌ وبوابةٌ على مستودعات ذاكرة.
 * @param {{ withLineage?: boolean }} [options]
 */
function setup({ withLineage = true } = {}) {
  const log = new EventLog();
  const enforcementPoint = enforcementPointFor(log);
  const assets = createMemoryRepository(DATA_ASSET_SPEC);
  const { ledger, repository } = createTestLedger({ log, assets, lattice });
  const catalog = new DataCatalog({
    log,
    repository: assets,
    lattice,
    enforcementPoint,
    lineage: ledger,
  });
  const gate = new DataAccessGate({
    log,
    catalog,
    lattice,
    enforcementPoint,
    lineage: withLineage ? ledger : null,
  });
  return { log, assets, catalog, gate, ledger, repository };
}

/**
 * @param {DataCatalog} catalog
 * @param {string} name
 * @param {{ derivedFrom?: string[], classification?: import('../../src/data/classification.mjs').ClassificationValue }} [options]
 */
async function register(catalog, name, { derivedFrom = [], classification } = {}) {
  return catalog.register({
    name,
    owner: 'role:minister',
    source: derivedFrom.length === 0 ? 'خارجي: تعداد 2026' : 'تحويل',
    classification: classification ?? Classification.INTERNAL,
    derivedFrom,
    purpose: 'اختبار النسب',
  });
}

/**
 * @param {() => Promise<unknown>} work
 * @param {string} code
 */
async function refuses(work, code) {
  await assert.rejects(work, (error) => {
    assert.equal(
      /** @type {{ code?: string }} */ (error).code,
      code,
      `الرمز المنتظر ${code} والواقع ${String(/** @type {{ code?: string }} */ (error).code)}`,
    );
    return true;
  });
}

test('معيار القبول — استعلام النسب يُعيد السلسلة كاملة لأي أصل', async () => {
  const { catalog, gate, ledger } = setup();
  const agent = testActor('role:agent', { id: 'agent:reader-1' });
  const minister = testActor('role:minister', { id: 'agent:minister-1' });

  // طبقة 1: جذران مستقلّان. طبقة 2: فرعان من كل جذر. طبقة 3: التقاء الفرعين.
  // طبقة 4: تقريرٌ من الالتقاء. والالتقاء مقصود: هو ما يجعل الاستعلام رسماً لا خطّاً.
  const censusRoot = await register(catalog, 'تعداد-خام');
  const registryRoot = await register(catalog, 'سجل-خام');
  const censusClean = await register(catalog, 'تعداد-منقّى', { derivedFrom: [censusRoot.id] });
  const registryClean = await register(catalog, 'سجل-منقّى', { derivedFrom: [registryRoot.id] });
  const joined = await register(catalog, 'مزيج', {
    derivedFrom: [censusClean.id, registryClean.id],
  });
  const report = await register(catalog, 'تقرير', { derivedFrom: [joined.id] });

  // قراءةٌ على العقدة الأخيرة وأخرى على عقدةٍ وسطى، وكتابةٌ على جذر: «من قرأه»
  // سؤالٌ عن الأصل **وعن أسلافه**، فقراءةُ سلفٍ جزءٌ من نسب ما اشتُقّ منه.
  await gate.read({ actor: agent, assetId: report.id, purpose: 'عرض', reader: () => 'قُرئ' });
  await gate.read({ actor: minister, assetId: joined.id, purpose: 'تدقيق', reader: () => 'قُرئ' });
  // الكاتب بتخليصٍ **مطابق** للتصنيف: «لا كتابة إلى الأسفل» تمنع الوزير
  // (‏sensitive) من الكتابة في أصلٍ داخلي، وهذا قيدُ `M7.02` لا شأن لهذه الخطوة به.
  await gate.write({
    actor: agent,
    assetId: censusRoot.id,
    purpose: 'تصحيح',
    writer: () => 'كُتب',
  });

  const trace = await ledger.trace(report.id);

  assert.equal(trace.assetId, report.id);
  assert.equal(trace.complete, true, 'السلسلة أُعيدت منقوصة');
  // العمق ثلاثُ حِرَفٍ لأربع طبقات: يُقاس بالمسافة لا بعدّ الطبقات.
  assert.equal(trace.depth, 3, `العمق المنتظر 3 والواقع ${trace.depth}`);

  // كل العُقد الستّ حاضرة مرّة واحدة لا مرّتين، والالتقاء لا يضاعف عقدة.
  assert.deepEqual(
    trace.nodes.map((node) => node.assetId).sort(),
    [censusClean.id, censusRoot.id, joined.id, registryClean.id, registryRoot.id, report.id].sort(),
  );
  assert.equal(new Set(trace.nodes.map((node) => node.assetId)).size, 6);

  // العمق يُقاس من الأصل المسؤول عنه: التقرير 0، والجذور 3.
  const depthOf = new Map(trace.nodes.map((node) => [node.assetId, node.depth]));
  assert.equal(depthOf.get(report.id), 0);
  assert.equal(depthOf.get(joined.id), 1);
  assert.equal(depthOf.get(censusClean.id), 2);
  assert.equal(depthOf.get(censusRoot.id), 3);

  // كل حرفٍ في الرسم حاضر: خمس حِرَف لست عُقد بالتقاءٍ واحد.
  assert.deepEqual(
    trace.edges.map((edge) => `${edge.child}<-${edge.parent}`).sort(),
    [
      `${report.id}<-${joined.id}`,
      `${joined.id}<-${censusClean.id}`,
      `${joined.id}<-${registryClean.id}`,
      `${censusClean.id}<-${censusRoot.id}`,
      `${registryClean.id}<-${registryRoot.id}`,
    ].sort(),
  );

  // «من مصدره»: الجذران وحدهما لهما قيد أصلٍ، ومصدرُهما الخارجي معلَن.
  assert.deepEqual(
    trace.origins.map((origin) => origin.assetId).sort(),
    [censusRoot.id, registryRoot.id].sort(),
  );
  for (const origin of trace.origins) {
    assert.equal(origin.source, 'خارجي: تعداد 2026');
    assert.equal(origin.actorId, 'role:minister');
  }

  // «ومن قرأه»: القراءتان، كلٌّ بفاعلها وغرضها وموضعها من الرسم.
  assert.deepEqual(
    trace.reads.map((read) => `${read.assetId}:${read.actorId}:${read.purpose}`).sort(),
    [`${report.id}:agent:reader-1:عرض`, `${joined.id}:agent:minister-1:تدقيق`].sort(),
  );

  // «ومن كتب فيه»: الكتابة على الجذر تظهر في نسب التقرير المشتقّ منه.
  assert.equal(trace.writes.length, 1);
  assert.equal(trace.writes[0]?.assetId, censusRoot.id);
  assert.equal(trace.writes[0]?.actorId, 'agent:reader-1');

  // والسلسلة متّصلة: أوّل قيدٍ لكل أصل `genesis` وما بعده يحمل تجزئة ما قبله.
  const rootEntries = trace.entries
    .filter((entry) => entry.assetId === censusRoot.id)
    .sort((left, right) => left.seq - right.seq);
  assert.equal(rootEntries[0]?.prevHash, LINEAGE_GENESIS);
  assert.equal(rootEntries[1]?.prevHash, rootEntries[0]?.hash);
  assert.equal((await ledger.verify()).ok, true);

  // واستعلامُ **أي** أصل يعمل، لا الأصل الأخير وحده: جذرٌ بلا أسلاف يُعيد نفسه.
  const rootTrace = await ledger.trace(censusRoot.id);
  assert.equal(rootTrace.depth, 0);
  assert.deepEqual(
    rootTrace.nodes.map((node) => node.assetId),
    [censusRoot.id],
  );
  assert.equal(rootTrace.origins.length, 1);
  assert.equal(rootTrace.writes.length, 1);
});

test('السلف نصٌّ حرّ مرفوض، والحقل الملغى مرفوضٌ باسمه لا متجاهَلاً', async () => {
  const { catalog } = setup();

  // ما كان يُقبل قبل هذه الخطوة: مصفوفةٌ حرّة في الطلب. صار رفضاً مُسمّى، لأن
  // تجاهُل حقلٍ يظنّ مُمرِّره أنه يُحفظ أسوأ من رفضه.
  await refuses(
    () =>
      catalog.register({
        name: 'مُدّعى',
        owner: 'role:minister',
        source: 'أمر',
        // @ts-expect-error — الحقل أُلغي في `M7.04` قصداً، وهذا ما يقيسه الاختبار.
        lineage: ['command'],
      }),
    LINEAGE_ERRORS.CLAIM_REFUSED,
  );

  // وسلفٌ لا وجود له في الفهرس يُرفض ولا يُكتب اسماً.
  await refuses(
    () => register(catalog, 'مشتقّ-من-وهم', { derivedFrom: ['data:لا-وجود-له'] }),
    LINEAGE_ERRORS.PARENT_UNKNOWN,
  );

  // ولا حقل `lineage` في مواصفة الأصل: بقاؤه كان سيجعل للحقيقة موضعين ينحرفان.
  assert.equal(Object.hasOwn(DATA_ASSET_SPEC.fields, 'lineage'), false);
});

test('الاشتقاق لا ينزل بالتصنيف — وإلا صار التحويل غسلاً للتصنيف', async () => {
  const { catalog, assets } = setup();
  const sovereign = await register(catalog, 'سيادي', {
    classification: Classification.SOVEREIGN,
  });

  // هذا هو الطريق الذي يُغلق: تُنسخ المادة السيادية إلى أصلٍ «داخلي» بالتحويل، ثم
  // تُقرأ بتخليصٍ داخلي بلا اعتماد تخفيض — فيتجاوز التحويلُ كلَّ ما بُني في M7.01.
  await refuses(
    () =>
      register(catalog, 'مُغسَّل', {
        derivedFrom: [sovereign.id],
        classification: Classification.INTERNAL,
      }),
    LINEAGE_ERRORS.DECLASSIFYING_DERIVATION,
  );

  // والاشتقاق **صعوداً** مقبول: أصلٌ أشدُّ حساسيةً من سلفه لا يُخرج مادةً من مرتبتها.
  const stricter = await register(catalog, 'أشدّ', {
    derivedFrom: [sovereign.id],
    classification: Classification.SOVEREIGN,
  });
  assert.ok(stricter.id);

  // **حدٌّ معلن مقيس:** الأصل المرفوض بقي صفّاً في الفهرس بلا نسب — لأن مرجع
  // القاعدة يشترط وجود الأصل قبل قيده، والذرّية تحتاج مُشغّل معاملة. والمقيس أنّ
  // الأصل المُعلَّق **يُكشف** لا أنه لا يقع.
  const orphans = (await assets.list()).filter((row) => row['name'] === 'مُغسَّل');
  assert.equal(orphans.length, 1, 'الحدّ المعلن تغيّر: الأصل المرفوض لم يبقَ مكتوباً');
});

test('الدورة تُرفض عند التسجيل لا عند الاستعلام', async () => {
  const { catalog, ledger } = setup();
  const first = await register(catalog, 'أ');
  const second = await register(catalog, 'ب', { derivedFrom: [first.id] });
  const third = await register(catalog, 'ج', { derivedFrom: [second.id] });

  // إغلاق الحلقة: «أ» يصير مشتقّاً من «ج» وهو سلفُ سلفه. دفترٌ فيه دورةٌ لا
  // يُصلحه استعلام، فالرفض عند الكتابة.
  await refuses(
    () =>
      ledger.record({ assetId: first.id, kind: 'derivation', actorId: 'x', parents: [third.id] }),
    LINEAGE_ERRORS.CYCLE_REFUSED,
  );
  // وأصلٌ سلفُ نفسه يُرفض برمزه المستقلّ: دورةٌ بطول واحد أشدُّ خفاءً.
  await refuses(
    () =>
      ledger.record({ assetId: first.id, kind: 'derivation', actorId: 'x', parents: [first.id] }),
    LINEAGE_ERRORS.SELF_PARENT,
  );
  assert.equal((await ledger.trace(third.id)).complete, true);
});

test('العبث بالدفتر يُكشف: سلسلة التجزئة لكل أصل', async () => {
  const { catalog, ledger, repository } = setup();
  const asset = await register(catalog, 'مُراقَب');
  await ledger.record({ assetId: asset.id, kind: 'read', actorId: 'agent:1', purpose: 'أولى' });
  await ledger.record({ assetId: asset.id, kind: 'read', actorId: 'agent:2', purpose: 'ثانية' });
  assert.equal((await ledger.verify()).ok, true);

  // تعديلٌ في القاعدة من غير طريق الدفتر: تبديل فاعل قراءةٍ وقعت.
  const rows = await repository.list({ filter: { assetId: asset.id } });
  const target = rows.find((row) => row['seq'] === 2);
  assert.ok(target);
  await repository.update(
    /** @type {string} */ (target['id']),
    /** @type {number} */ (target['version']),
    { actorId: 'agent:مدسوس' },
  );

  const verdict = await ledger.verify();
  assert.equal(verdict.ok, false, 'العبث لم يُكشف');
  assert.equal(verdict.broken.length >= 1, true);
  // ولا يُعاد أثرٌ مكسورٌ بوصفه سلسلةً: الاستعلام يرفض بدل أن يُطمئن كذباً.
  await refuses(() => ledger.trace(asset.id), LINEAGE_ERRORS.CHAIN_BROKEN);
});

test('البوابة بلا دفتر ترفض كل وصول، والقيد يُكتب قبل الأثر', async () => {
  // بلا دفتر: رفضٌ مُسمّى لا وصولٌ بلا أثر نسب.
  const bare = setup({ withLineage: false });
  const asset = await register(bare.catalog, 'أصل');
  await refuses(
    () =>
      bare.gate.read({
        actor: testActor('role:agent', { id: 'agent:1' }),
        assetId: asset.id,
        reader: () => 'قُرئ',
      }),
    ACCESS_ERRORS.LINEAGE_REQUIRED,
  );

  // ومع دفتر: الأثر يُخفق **بعد** القيد، والقيد يبقى. هذا هو الاتجاه المقبول
  // المعلَن — نُسجّل زائداً لا ناقصاً — ومحلُّ قياسه هنا لا في التوثيق وحده.
  const live = setup();
  const target = await register(live.catalog, 'أصل-حيّ');
  await assert.rejects(
    () =>
      live.gate.read({
        actor: testActor('role:agent', { id: 'agent:9' }),
        assetId: target.id,
        purpose: 'أثرٌ يسقط',
        reader: () => {
          throw new Error('EFFECT_FAILED');
        },
      }),
    /EFFECT_FAILED/,
  );
  const trace = await live.ledger.trace(target.id);
  assert.equal(trace.reads.length, 1, 'القيد كُتب بعد الأثر فسقط مع سقوطه');
  assert.equal(trace.reads[0]?.actorId, 'agent:9');
});

test('سياسة النسب بيانٌ محكوم، والدفتر بلا مسار تعديل', async () => {
  const policy = loadLineagePolicy({ lattice });
  assert.deepEqual(policy.kindIds.sort(), ['derivation', 'origin', 'read', 'write']);
  assert.equal(policy.kindSpec('derivation').requiresParents, true);
  assert.equal(policy.kindSpec('origin').requiresParents, false);
  assert.equal(policy.rules.recordBeforeEffect, true);
  assert.equal(policy.rules.requireMonotonicClassification, true);
  assert.equal(policy.rules.refuseCycles, true);
  assert.equal(policy.chain.hash, 'sha256');
  // النوع المجهول يُرفض: نوعٌ لا يعرفه الإعداد لا يُكتب في الدفتر.
  const { ledger, catalog } = setup();
  const asset = await register(catalog, 'أصل-نوع');
  await refuses(
    () => ledger.record({ assetId: asset.id, kind: 'inferred', actorId: 'agent:1' }),
    LINEAGE_ERRORS.KIND_UNKNOWN,
  );

  // ولا `update` ولا `delete` في الواجهة: الحذف المحكوم موضعه `M7.06`.
  for (const forbidden of ['update', 'delete', 'remove', 'erase']) {
    assert.equal(
      typeof (
        /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (LineageLedger.prototype))[
          forbidden
        ]
      ),
      'undefined',
      `الدفتر يحمل مسار «${forbidden}» — والنسب يُكتب فيه ولا يُعدَّل`,
    );
  }

  // وكلُّ قيدٍ في الإعداد له قيدٌ في هجرةٍ فعلية: إعلانٌ بلا قيدٍ في القاعدة وعدٌ.
  const migration = readFileSync(path.join(ROOT, 'migrations', '0007_data_lineage.up.sql'), 'utf8');
  for (const constraint of policy.store.dbConstraints) {
    assert.ok(migration.includes(constraint), `القيد «${constraint}» غير موجود في الهجرة`);
  }
  assert.equal(policy.store.table, DATA_LINEAGE_SPEC.table);
  assert.equal(policy.retiredClaimColumn?.column, 'lineage');
});

test('الحدود المعلنة: العمق الأقصى يُرفض ولا يُعاد أثراً منقوصاً', async () => {
  const { catalog, ledger } = setup();
  const shallow = loadLineagePolicy({ lattice });
  // سلسلةٌ أطول من الحدّ: الحدّ يُقاس بسياسةٍ بحدٍّ صغيرٍ مركَّبةٍ يدوياً بدل بناء
  // خمسٍ وستّين عقدة — والمقيس هو **الرفض** لا الرقم.
  /** @type {string[]} */
  const chain = [];
  for (let index = 0; index < 4; index += 1) {
    const asset = await register(catalog, `طبقة-${index}`, {
      derivedFrom: index === 0 ? [] : [/** @type {string} */ (chain[index - 1])],
    });
    chain.push(asset.id);
  }
  const leaf = /** @type {string} */ (chain[chain.length - 1]);
  // السياسة نفسها بحدٍّ أصغر: تُبنى على نموذج `LineagePolicy` كي تبقى توابعُها
  // توابعَ السياسة الحقيقية، فلا يقيس الاختبار بديلاً مصنوعاً في الاختبار.
  const limited = new LineageLedger({
    log: ledger.log,
    repository: ledger.repository,
    catalog: ledger.catalog,
    lattice,
    policy: Object.assign(Object.create(Object.getPrototypeOf(shallow)), shallow, {
      rules: Object.freeze({ ...shallow.rules, maxDepth: 2 }),
    }),
  });
  await refuses(() => limited.trace(leaf), LINEAGE_ERRORS.DEPTH_EXCEEDED);
});
