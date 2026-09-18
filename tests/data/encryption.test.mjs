// اختبار التشفير عند التخزين وعند النقل — M7.03.
//
// معيار القبول المُعلَن: «فحص: صفر بيانات مصنَّفة مخزَّنة بلا تشفير». وعبارةٌ
// كهذه تُمرَّر بشرطٍ واحد، فالمقيس هنا أوسع منها: هل بقي **مسارٌ** إلى مادةٍ
// مصنَّفة مخزَّنة أو منقولة نصّاً — بمخزنٍ يُركَّب بلا مغلِّف، أو بمفتاحٍ لمرتبةٍ
// غير معلَنة، أو بغلافٍ يُنقل إلى صفٍّ آخر، أو بمعمّى يُعدَّل ويُقبل، أو بمفتاح
// مرتبةٍ أدنى لمادةٍ أعلى، أو بوصلةٍ نصّية إلى قاعدةٍ اسمُ بيئتها ليس `production`.
//
// والمقيس على **مخزون حقيقي**: يُكتب مدخلٌ بمسار `AgentMemoryStore` كما يُكتب في
// التشغيل، ثم يُقرأ الصفّ من المستودع كما يقرؤه من ملك القاعدة لا من ملك المفتاح.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import YAML from 'yaml';

import {
  AgentMemoryStore,
  DataAccessGate,
  DataCatalog,
  DataEncryptor,
  ENCRYPTION_ERRORS,
  ENVELOPE_MARKER,
  assertNoKeyMaterial,
  assertSecureTransport,
  isSealedEnvelope,
  loadClassificationLattice,
  loadEncryptionPolicy,
  scanForPlaintextAtRest,
} from '../../src/data/index.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { EventLog } from '../../src/root-of-trust/event-log.mjs';
import { enforcementPointFor, testActor } from '../helpers/authorization.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';
import { createTestLedger } from '../helpers/lineage.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lattice = loadClassificationLattice();
const fixture = await createTestEncryptor();
test.after(() => fixture.cleanup());

const BINDING = Object.freeze({
  id: 'memory:1',
  agentId: 'agent:a',
  datasetId: 'dataset:1',
});

/**
 * @param {() => Promise<unknown>} fn
 * @param {string} code
 */
async function rejectsWithCode(fn, code) {
  await assert.rejects(fn, (error) => {
    assert.equal(
      /** @type {{ code?: string }} */ (error).code,
      code,
      `الرمز المنتظر ${code} والواقع ${String(/** @type {{ code?: string }} */ (error).code)}`,
    );
    return true;
  });
}

/** مخزن ذاكرةٍ مُركَّب كما يُركَّب في التشغيل، ومستودعُه مقروءٌ مباشرةً في الاختبار. */
function memorySetup({ withEncryptor = true } = {}) {
  const log = new EventLog();
  const enforcementPoint = enforcementPointFor(log);
  const assets = createMemoryRepository(DataCatalog.spec);
  const { ledger } = createTestLedger({ log, assets, lattice });
  const catalog = new DataCatalog({
    log,
    repository: assets,
    lattice,
    enforcementPoint,
    lineage: ledger,
  });
  const accessGate = new DataAccessGate({
    log,
    catalog,
    lattice,
    enforcementPoint,
    lineage: ledger,
  });
  const repository = createMemoryRepository(AgentMemoryStore.spec);
  const memory = new AgentMemoryStore({
    catalog,
    log,
    repository,
    accessGate,
    encryptor: withEncryptor ? fixture.encryptor : null,
  });
  return { log, catalog, accessGate, repository, memory };
}

// ── فحص القبول: صفر مادة مصنَّفة مخزَّنة نصّاً ────────────────────────────────

test('فحص القبول: كتابةٌ حقيقية في كل مرتبة ثم صفر مادة مخزَّنة نصّاً', async () => {
  const { memory, repository, catalog } = memorySetup();
  // فاعلٌ لكل مرتبة بتخليصٍ **مطابق**: الكتابة إلى الأسفل مرفوضة أصلاً (`M7.02`)،
  // فمن كتب بتخليص أعلى من تصنيف مادته لم يقِس التشفير بل قِيس عليه رفضُ الكتابة.
  /** @type {Array<[string, string]>} */
  const cases = [
    ['internal', 'role:agent'],
    ['sensitive', 'role:minister'],
    ['sovereign', 'role:king'],
  ];
  /** @type {string[]} */
  const ids = [];
  for (const [classification, role] of cases) {
    const entry = await memory.remember(
      'agent:a',
      { plan: `سرّ ${classification}`, n: 7 },
      {
        classification: /** @type {never} */ (classification),
        actor: /** @type {never} */ (testActor(role, { id: 'agent:a' })),
      },
    );
    ids.push(entry.id);
  }

  // القراءة من **المستودع** لا من المخزن: هذا هو ما يراه من ملك القاعدة ولم
  // يملك المفتاح، وهو موضع الفحص المُعلَن.
  const rows = [];
  for (const id of ids) {
    const row = await repository.findById(id);
    assert.ok(row, 'الصفّ يجب أن يكون مكتوباً');
    const asset = await catalog.get(String(row['datasetId']));
    rows.push({
      id,
      content: row['content'],
      classification: asset === null ? null : asset.classification,
    });
  }
  const result = scanForPlaintextAtRest({ rows, store: 'state.memories' });
  assert.equal(result.scanned, 3);
  assert.deepEqual(result.violations, [], 'وُجدت مادة مخزَّنة بلا تشفير');

  // ولا يكفي «لا نصّ صريح»: لا بدّ أن تكون المادة **غائبة** عن المخزون نصّاً.
  const serialized = JSON.stringify(rows);
  assert.ok(!serialized.includes('سرّ sovereign'), 'مادة سيادية ظهرت نصّاً في المخزون');
  assert.ok(!serialized.includes('"plan"'), 'اسم حقل المادة ظهر نصّاً في المخزون');
});

test('مادةٌ عامّة لا تُكتب مكشوفة: تُرفض بمفتاحٍ غير معلَن لا تُخزَّن نصّاً', async () => {
  // حدٌّ معلَن لا عيبٌ مسكوت عنه: المرتبة `public` لا تُشفَّر في سلّم التصنيف،
  // ولا مفتاح معلَن لها (ومفتاحٌ لمرتبةٍ لا تُشفَّر يرفضه تحميل السياسة). ومخزنُ
  // الذاكرة يُغلّف **دائماً** لأن قيد القاعدة لا يقرأ التصنيف. فالنتيجة أن ذاكرةً
  // مصنَّفة `public` تُرفض عند الكتابة بـ`ENCRYPTION_TIER_KEY_UNDECLARED`.
  //
  // والمسار غير مطروق اليوم: لا دور في `config/roles.yaml` بتخليص `public`،
  // والكتابة إلى الأسفل مرفوضة، فلا فاعل يستطيع طلبها. والمقيس هنا أنّ الرفض
  // **صريح** لو صار المسار مطروقاً، لا كتابةٌ نصّية صامتة. وهو مقيَّد في
  // `docs/REMAINING_WORK.md`.
  await rejectsWithCode(
    () =>
      fixture.encryptor.seal({
        value: { note: 'عامّ' },
        classification: 'public',
        binding: BINDING,
      }),
    ENCRYPTION_ERRORS.TIER_KEY_UNDECLARED,
  );
  assert.equal(lattice.requiresEncryption('public'), false);
});

test('الاستدعاء يُعيد المادة كما سُلِّمت، والدورة كاملة لا تفقد شيئاً', async () => {
  const { memory } = memorySetup();
  const actor = testActor('role:agent', { id: 'agent:a' });
  const content = { note: 'أصل', deep: { list: [1, 2, 3], flag: false } };
  const entry = await memory.remember('agent:a', content, { actor: /** @type {never} */ (actor) });
  const recalled = await memory.recall({ id: entry.id, actor: /** @type {never} */ (actor) });
  assert.deepEqual(recalled.content, content);
});

test('مخزنٌ بلا مغلِّف يرفض التذكّر والاستدعاء ولا يكتب نصّاً', async () => {
  const { memory } = memorySetup({ withEncryptor: false });
  const actor = testActor('role:agent', { id: 'agent:a' });
  await assert.rejects(
    () => memory.remember('agent:a', { x: 1 }, { actor: /** @type {never} */ (actor) }),
    /MEMORY_ENCRYPTOR_REQUIRED/,
  );
  await assert.rejects(
    () => memory.recall({ id: 'memory:none', actor: /** @type {never} */ (actor) }),
    /MEMORY_ENCRYPTOR_REQUIRED/,
  );
});

test('السجل يشهد بالتغليف ولا يحمل المادة: سجلٌّ يحملها يُبطل التشفير', async () => {
  const { memory, log } = memorySetup();
  await memory.remember(
    'agent:a',
    { secret: 'لا يُسجَّل' },
    {
      classification: /** @type {never} */ ('sensitive'),
      actor: /** @type {never} */ (testActor('role:minister')),
    },
  );
  const events = log.snapshot().filter((event) => event.type === 'memory.created');
  assert.equal(events.length, 1);
  const payload = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (events[0]?.data ?? {})
  );
  assert.equal(payload['encrypted'], true);
  assert.equal(payload['tier'], 'sensitive');
  assert.ok(!JSON.stringify(events).includes('لا يُسجَّل'), 'المادة ظهرت في السجل');
});

// ── الغلاف مصادق ومربوط بصفّه ────────────────────────────────────────────────

test('غلافٌ يُنقل إلى صفٍّ آخر يُخفق عند الفكّ ولا يُعاد نصّاً', async () => {
  const sealed = await fixture.encryptor.seal({
    value: { x: 1 },
    classification: 'sensitive',
    binding: BINDING,
  });
  await rejectsWithCode(
    () =>
      fixture.encryptor.open({
        envelope: sealed,
        binding: { ...BINDING, id: 'memory:2' },
        classification: 'sensitive',
      }),
    ENCRYPTION_ERRORS.ENVELOPE_TAMPERED,
  );
});

test('معمّى مُعدَّل يُكشف بالمصادقة ولا يُعاد نصّاً محرَّفاً', async () => {
  const sealed = await fixture.encryptor.seal({
    value: { x: 1 },
    classification: 'internal',
    binding: BINDING,
  });
  const bytes = Buffer.from(sealed.ct, 'base64');
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  await rejectsWithCode(
    () =>
      fixture.encryptor.open({
        envelope: { ...sealed, ct: bytes.toString('base64') },
        binding: BINDING,
        classification: 'internal',
      }),
    ENCRYPTION_ERRORS.ENVELOPE_TAMPERED,
  );
});

test('غلافٌ بمفتاح مرتبةٍ لا تطابق تصنيف أصله اليوم يُرفض', async () => {
  const sealed = await fixture.encryptor.seal({
    value: { x: 1 },
    classification: 'internal',
    binding: BINDING,
  });
  // نفس الغلاف، ومادّته صارت سياديةً: داخليٌّ يحمي سيادياً، ويُرفض.
  await rejectsWithCode(
    () =>
      fixture.encryptor.open({ envelope: sealed, binding: BINDING, classification: 'sovereign' }),
    ENCRYPTION_ERRORS.ENVELOPE_TIER_MISMATCH,
  );
  const scan = scanForPlaintextAtRest({
    rows: [{ id: 'memory:1', content: sealed, classification: 'sovereign' }],
  });
  assert.equal(scan.violations.length, 1, 'الفحص لم يعدّ الغلاف بمفتاح مرتبةٍ أدنى مخالفةً');
});

test('غلافٌ بجانبه حقل نصٍّ صريح مرفوض: أسوأ من غياب التشفير لأنه يُقرأ ضماناً', async () => {
  const sealed = await fixture.encryptor.seal({
    value: { x: 1 },
    classification: 'internal',
    binding: BINDING,
  });
  assert.equal(isSealedEnvelope({ ...sealed, value: { x: 1 } }), false);
  assert.equal(isSealedEnvelope({ [ENVELOPE_MARKER]: 1 }), false);
  assert.equal(isSealedEnvelope({ value: { x: 1 } }), false);
});

test('ربطٌ فارغ القيمة يُرفض: ربطٌ فارغ يُطابق كل صفّ فلا يربط شيئاً', async () => {
  await rejectsWithCode(
    () =>
      fixture.encryptor.seal({
        value: { x: 1 },
        classification: 'internal',
        binding: {},
      }),
    ENCRYPTION_ERRORS.BINDING_REQUIRED,
  );
  // وربطٌ **ناقصُ حقل** لا يُرفض عند التغليف — وهذا مقصود: الوحدة لا تعرف حقول
  // ربط كل مخزن، ولو فرضت قائمةً لصارت قائمةٌ في الكود تحكم بما لا يعرفه البيان.
  // وأثرُه ليس نصّاً مكشوفاً بل غلافاً **لا يُفكّ** بالربط الكامل، فيُكشف عند أول
  // قراءة لا يُقرأ خطأً. والمقيس أن الفكّ يُخفق فعلاً.
  const partial = await fixture.encryptor.seal({
    value: { x: 1 },
    classification: 'internal',
    binding: { id: BINDING.id },
  });
  await rejectsWithCode(
    () =>
      fixture.encryptor.open({ envelope: partial, binding: BINDING, classification: 'internal' }),
    ENCRYPTION_ERRORS.ENVELOPE_TAMPERED,
  );
  await rejectsWithCode(
    () =>
      fixture.encryptor.seal({
        value: { x: 1 },
        classification: 'internal',
        binding: { ...BINDING, agentId: '' },
      }),
    ENCRYPTION_ERRORS.BINDING_REQUIRED,
  );
});

test('تصنيفٌ غير معروف لا يُغلَّف بمفتاحٍ مفترض ولا يُخزَّن نصّاً', async () => {
  await rejectsWithCode(
    () =>
      fixture.encryptor.seal({ value: { x: 1 }, classification: 'top-secret', binding: BINDING }),
    ENCRYPTION_ERRORS.TIER_KEY_UNDECLARED,
  );
});

test('مفتاح المرتبة لا يُنشأ عند أول كتابة: غيابه رفضٌ لا توليدٌ تلقائي', async () => {
  const scoped = await createTestEncryptor({ tiers: ['internal'] });
  try {
    await rejectsWithCode(
      () =>
        scoped.encryptor.seal({ value: { x: 1 }, classification: 'sovereign', binding: BINDING }),
      ENCRYPTION_ERRORS.KEY_UNAVAILABLE,
    );
    // ولا يُطمس مفتاحٌ قائم عند إعادة الإنشاء: طمسُه يُفقد كل ما غُلِّف به.
    const again = await scoped.encryptor.ensureTierKey('internal');
    assert.equal(again.created, false);
  } finally {
    scoped.cleanup();
  }
});

test('مفاتيح المراتب متمايزة: مفتاحٌ واحد لكل المراتب يُلغي معنى المرتبة', () => {
  const names = new Set(fixture.policy.keyNames.values());
  assert.equal(names.size, fixture.policy.keyNames.size);
  for (const tier of lattice.tiers) {
    if (!lattice.requiresEncryption(tier.id)) continue;
    assert.equal(typeof fixture.policy.keyNameFor(tier.id), 'string');
  }
});

// ── المزوّد: لا مفتاح في الكود ولا قرصٌ محلي في الإنتاج ──────────────────────

test('مغلِّفٌ بلا مزوّد مفاتيح يُرفض عند الإنشاء: لا مفتاح مولَّد في الذاكرة', () => {
  assert.throws(
    () =>
      new DataEncryptor({
        policy: fixture.policy,
        lattice,
        keyProvider: /** @type {never} */ (null),
      }),
    (error) => {
      assert.equal(
        /** @type {{ code?: string }} */ (error).code,
        ENCRYPTION_ERRORS.PROVIDER_REQUIRED,
      );
      return true;
    },
  );
});

test('مزوّدٌ يُعلن أنه غير صالح للإنتاج يُرفض في بيئة الإنتاج', () => {
  assert.throws(
    () =>
      new DataEncryptor({
        policy: fixture.policy,
        lattice,
        keyProvider: fixture.keyProvider,
        environment: 'production',
      }),
    (error) => {
      assert.equal(
        /** @type {{ code?: string }} */ (error).code,
        ENCRYPTION_ERRORS.PROVIDER_NOT_PRODUCTION_READY,
      );
      return true;
    },
  );
});

// ── الإعداد: لا مادة مفتاح، ولا انحراف عن سلّم التصنيف ───────────────────────

test('مادة مفتاح في الإعداد تُرفض بفحص الشكل لا باسم الحقل', () => {
  assert.throws(
    () => assertNoKeyMaterial({ note: Buffer.alloc(32, 7).toString('base64') }),
    (error) => {
      assert.equal(
        /** @type {{ code?: string }} */ (error).code,
        ENCRYPTION_ERRORS.KEY_MATERIAL_IN_CONFIG,
      );
      return true;
    },
  );
  // والإعداد القائم نظيف: هذا هو ما يقيسه الحاجب على كل تشغيل.
  assert.doesNotThrow(() =>
    assertNoKeyMaterial(
      YAML.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'encryption.yaml'), 'utf8')),
    ),
  );
});

test('مفتاحٌ معلَن لمرتبةٍ لا تُشفَّر يُرفض عند التحميل: الملفّان لا ينحرفان', () => {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-encryption-')));
  try {
    fs.mkdirSync(path.join(dir, 'schemas'));
    fs.copyFileSync(
      path.join(REPO_ROOT, 'config', 'schemas', 'encryption.schema.json'),
      path.join(dir, 'schemas', 'encryption.schema.json'),
    );
    const parsed = YAML.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'config', 'encryption.yaml'), 'utf8'),
    );
    // `public` لا تُشفَّر في سلّم التصنيف؛ ومفتاحٌ لها يقول إنّ أحد الملفين تغيّر.
    parsed.keys.perTier.push({ tier: 'public', keyName: 'data:kek:public' });
    fs.writeFileSync(path.join(dir, 'encryption.yaml'), YAML.stringify(parsed), 'utf8');
    assert.throws(
      () => loadEncryptionPolicy({ dir, lattice }),
      (error) => {
        assert.equal(
          /** @type {{ code?: string }} */ (error).code,
          ENCRYPTION_ERRORS.CONFIG_INVALID,
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('التشفير رتيبٌ صعوداً في السلّم: مرتبةٌ أعلى لا تُشفَّر وأدناها يُشفَّر انحراف', () => {
  let seenEncrypted = false;
  for (const tier of lattice.tiers) {
    const encrypted = lattice.requiresEncryption(tier.id);
    if (encrypted) seenEncrypted = true;
    else assert.equal(seenEncrypted, false, `المرتبة «${tier.id}» لا تُشفَّر وأدنى منها يُشفَّر`);
  }
  // ومرتبةٌ غير معروفة تُشفَّر: الجهل بالتصنيف يُغلَّف ولا يُخزَّن نصّاً.
  assert.equal(lattice.requiresEncryption('غير-معروفة'), true);
});

// ── التشفير عند النقل ────────────────────────────────────────────────────────

test('وصلةٌ بلا TLS إلى مضيف غير محلي مرفوضة في كل بيئة لا في الإنتاج وحده', () => {
  for (const environment of ['development', 'test', 'staging', 'production']) {
    assert.throws(
      () =>
        assertSecureTransport({
          host: 'db.internal.example',
          tls: false,
          environment,
          policy: fixture.policy,
        }),
      (error) => {
        assert.equal(
          /** @type {{ code?: string }} */ (error).code,
          ENCRYPTION_ERRORS.TRANSPORT_INSECURE,
        );
        return true;
      },
      `بيئة «${environment}» سمحت بنقلٍ نصّي إلى مضيف على الشبكة`,
    );
  }
});

test('الاستثناء المحلي للتطوير وحده، والإنتاج لا يُستثنى ولو كان المضيف محلياً', () => {
  assert.doesNotThrow(() =>
    assertSecureTransport({
      host: '127.0.0.1',
      tls: false,
      environment: 'development',
      policy: fixture.policy,
    }),
  );
  assert.throws(() =>
    assertSecureTransport({
      host: '127.0.0.1',
      tls: false,
      environment: 'production',
      policy: fixture.policy,
    }),
  );
  // ووصلةٌ بـTLS تمرّ في كل حال.
  assert.doesNotThrow(() =>
    assertSecureTransport({
      host: 'db.internal.example',
      tls: true,
      environment: 'production',
      policy: fixture.policy,
    }),
  );
});

test('حرس الوصلة يطبّق شرط النقل: وصلةٌ نصّية إلى الشبكة تُرفض في التطوير', async () => {
  const { resolveDatabaseConfig } = await import('../../src/persistence/db.mjs');
  assert.throws(
    () =>
      resolveDatabaseConfig({
        url: 'postgres://state@db.internal.example:5432/state',
        environment: 'development',
      }),
    (error) => {
      assert.equal(
        /** @type {{ code?: string }} */ (error).code,
        ENCRYPTION_ERRORS.TRANSPORT_INSECURE,
      );
      return true;
    },
  );
  // ووصلة `docker-compose` المحلية تبقى صالحة للتطوير، وإلا تعطّل الاختبار كلّه.
  assert.doesNotThrow(() =>
    resolveDatabaseConfig({
      url: 'postgres://state@127.0.0.1:5432/state',
      environment: 'development',
    }),
  );
});

// ── القيد في القاعدة: الشرط قائم ولو كُتب الصفّ من غير طريق الكود ────────────

test('هجرة القيد تمنع النصّ الصريح وتمنع بقاء حقل value بجانب الغلاف', () => {
  const sql = fs.readFileSync(
    path.join(REPO_ROOT, 'migrations', '0006_memory_encryption.up.sql'),
    'utf8',
  );
  assert.match(sql, /memories_content_sealed/);
  assert.match(sql, /NOT \(content \? 'value'\)/);
  for (const field of ['__enc', 'alg', 'kek', 'tier', 'dek', 'iv', 'tag', 'ct']) {
    assert.ok(sql.includes(`content ? '${field}'`), `القيد لا يشترط الحقل ${field}`);
  }
  // والفشل مُغلَق: صفوفٌ نصّية قائمة توقف الترحيل ولا تُحذف ولا يُمرّ عنها.
  assert.match(sql, /RAISE EXCEPTION/);
  // ولا معاملة داخل معاملة: المُهاجر يفتحها، وCOMMIT هنا يُثبّتها قبل صفّها.
  assert.ok(!/^\s*COMMIT;/m.test(sql), 'ملف الهجرة يفتح معاملةً بنفسه');
});

test('الحاجب يعرف كاتب كل مخزنٍ معلَن، وكاتبه يستدعي seal فعلاً', () => {
  for (const store of fixture.policy.stores) {
    const source = fs.readFileSync(path.join(REPO_ROOT, store.writer), 'utf8');
    assert.match(source, /\.seal\(/, `${store.writer} لا يُغلّف`);
    assert.ok(!/content:\s*\{\s*value:/.test(source), `${store.writer} ما زال يكتب نصّاً صريحاً`);
  }
});
