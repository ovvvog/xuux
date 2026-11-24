// ذرّية العمليات المركّبة — الخطوة `M3.06`.
//
// الدعوى المُختبَرة: العملية التي تكتب في أكثر من جدول إمّا أن تتم كلها أو لا
// يبقى منها أثر. وإثباتُها لا يكون بمسار سعيد، بل بإخفاقٍ **بين** الكتابتين ثم
// فحصٍ للقاعدة من وصلةٍ أخرى: أي صفٍّ باقٍ من عملية أخفقت هو دليل نقض.
//
// وفيه أيضاً اختبار «الفرق»: نفس العملية بلا معاملة تُبقي أثراً جزئياً. وُضع
// لأن اختباراً يمرّ في الحالتين لا يُثبت شيئاً عن المعاملة.
//
// التشغيل: DATABASE_URL=... node --test tests/persistence/atomicity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CertificateAuthority, EventLog, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { ModelState } from '../../src/models/model-registry.mjs';
import {
  createPostgresRegistries,
  createPostgresRepositories,
  createRegistries,
} from '../../src/persistence/composition.mjs';
import { withUnitOfWork } from '../../src/persistence/unit-of-work.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {
  createIsolatedDatabase,
  databaseUrl,
  LIVE78_NOTICE_TAIL,
  LIVE78_OUTCOMES,
  live78DigestBlock,
  live78PrototypeBackup,
  live78PrototypeRestore,
  skipWithoutDatabase,
} from '../helpers/pg.mjs';
import { startFaultProxy } from '../helpers/pg-fault-proxy.mjs';
import { restoreBackup } from '../../scripts/restore.mjs';
import { createBackup } from '../../scripts/backup.mjs';
import { enforcementPointFor, testActor } from '../helpers/authorization.mjs';
import { registerEvaluationExperiment } from '../helpers/experiment-support.mjs';
import { createTestEncryptor } from '../helpers/encryption.mjs';

/**
 * @param {import('pg').Pool} pool
 * @param {string} table
 * @returns {Promise<number>}
 */
async function countRows(pool, table) {
  const result = await pool.query(`SELECT count(*)::int AS n FROM state.${table}`);
  return Number(result.rows[0]?.n ?? -1);
}

/** @returns {CertificateAuthority} */
function authority() {
  return new CertificateAuthority(new KingIdentity());
}

test(
  'إخفاق في منتصف «تذكّر» لا يُبقي عقد بيانات يتيماً',
  { skip: skipWithoutDatabase },
  async () => {
    const encryption = await createTestEncryptor();
    // مزوّد المفاتيح يُمرَّر: `remember` صار يشترط مغلِّفاً (`M7.03`) ويرفض
    // بـ`MEMORY_ENCRYPTOR_REQUIRED` **قبل** أي كتابة. وبلا مزوّدٍ كان الاختبار
    // يقيس رفضاً سابقاً للكتابتين لا إخفاقاً بينهما — أي لا يقيس الذرّية أصلاً.
    // لم يظهر لأن اختبارات القاعدة كانت متخطّاةً دائماً (`WL-045`).
    const created = await createIsolatedDatabase('atomic');
    try {
      await up(created.pool);
      // نقطة التفويض تُمرَّر كي يصل الطلب إلى الكتابة أصلاً: بلا بوابةٍ مُفوَّضة
      // يُرفض «تذكّر» قبل أي كتابة، فلا يبقى إخفاقٌ **بين** الكتابتين ليُقاس.
      const log = new EventLog();
      const registries = createPostgresRegistries({
        pool: created.pool,
        ca: authority(),
        log,
        enforcementPoint: enforcementPointFor(log),
        keyProvider: encryption.keyProvider,
      });
      const operator = testActor('role:operator');
      const agent = await registries.agents.register({ name: 'وكيل-ذرّي', role: 'auditor' });

      // نوع ذاكرة خارج القيم المُعلنة: يُرفض عند كتابة **الذاكرة** أي بعد كتابة
      // عقد البيانات. فهذا إخفاق واقع بين الكتابتين لا محاكاةً مصطنعة له.
      await assert.rejects(
        () =>
          registries.memory.remember(
            agent.id,
            { note: 'لا ينبغي أن يبقى' },
            {
              kind: /** @type {'episodic'} */ (/** @type {unknown} */ ('نوع-غير-معلن')),
              actor: operator,
            },
          ),
        /REPOSITORY_INVALID_RECORD|FIELD_ENUM/,
      );

      assert.equal(await countRows(created.pool, 'memories'), 0, 'ذاكرة كُتبت رغم الإخفاق');
      assert.equal(
        await countRows(created.pool, 'data_assets'),
        0,
        'عقد بيانات يتيم بقي بعد إخفاق «تذكّر»',
      );
    } finally {
      await created.drop();
      encryption.cleanup();
    }
  },
);

test(
  'بلا معاملة يبقى الأثر الجزئي — الفرق الذي تصنعه وحدة العمل',
  { skip: skipWithoutDatabase },
  async () => {
    const encryption = await createTestEncryptor();
    // مزوّد المفاتيح يُمرَّر: `remember` صار يشترط مغلِّفاً (`M7.03`) ويرفض
    // بـ`MEMORY_ENCRYPTOR_REQUIRED` **قبل** أي كتابة. وبلا مزوّدٍ كان الاختبار
    // يقيس رفضاً سابقاً للكتابتين لا إخفاقاً بينهما — أي لا يقيس الذرّية أصلاً.
    // لم يظهر لأن اختبارات القاعدة كانت متخطّاةً دائماً (`WL-045`).
    const created = await createIsolatedDatabase('nonatomic');
    try {
      await up(created.pool);
      // نفس المستودعات، بلا مُشغّل معاملة: هذا هو ما كان عليه الحال قبل `M3.06`.
      const log = new EventLog();
      const registries = createRegistries({
        ca: authority(),
        log,
        repositories: createPostgresRepositories(created.pool),
        enforcementPoint: enforcementPointFor(log),
        keyProvider: encryption.keyProvider,
      });
      const operator = testActor('role:operator');
      const agent = await registries.agents.register({ name: 'وكيل-غير-ذرّي', role: 'auditor' });
      await assert.rejects(() =>
        registries.memory.remember(
          agent.id,
          { note: 'أثر جزئي' },
          {
            kind: /** @type {'episodic'} */ (/** @type {unknown} */ ('نوع-غير-معلن')),
            actor: operator,
          },
        ),
      );
      assert.equal(await countRows(created.pool, 'memories'), 0);
      assert.equal(
        await countRows(created.pool, 'data_assets'),
        1,
        'لو صار هذا صفراً فالاختبار السابق لم يُثبت شيئاً عن المعاملة',
      );
    } finally {
      await created.drop();
      encryption.cleanup();
    }
  },
);

test(
  'إخفاق بعد إسقاط النشط السابق لا يترك الغرض بلا نشط',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('activate');
    try {
      await up(created.pool);
      const ca = authority();
      const log = new EventLog();
      const registries = createPostgresRegistries({ pool: created.pool, ca, log });

      /**
       * @param {string} name
       * @param {string} version
       * @param {string} weights
       */
      const approved = async (name, version, weights) => {
        const model = await registries.models.register({
          name,
          modelVersion: version,
          purpose: 'audit',
          provider: 'internal',
          weights,
        });
        await registries.models.transition(model.id, ModelState.SANDBOXED, 'اختبار معزول');
        await registries.models.transition(model.id, ModelState.APPROVED, 'اعتماد');
        registries.models.evaluationLedger.record({
          modelId: model.id,
          fingerprint: model.fingerprint,
          evaluatedBy: 'role:minister',
          experimentId: registerEvaluationExperiment(registries.models.evaluationLedger, {
            modelId: model.id,
            fingerprint: model.fingerprint,
          }),
          results: [
            { checkId: 'safety', score: 1 },
            { checkId: 'quality', score: 1 },
          ],
        });
        return model;
      };

      const first = await approved('أول', '1.0.0', 'w-1');
      const second = await approved('ثانٍ', '2.0.0', 'w-2');
      await registries.models.activate(first.id);
      assert.equal((await registries.models.getActive('audit'))?.id, first.id);

      // إخفاقٌ مُقحَم **بين** الكتابتين: أُسقط النشط السابق ثم يُرفع خطأ قبل رفع
      // الجديد. بلا معاملة يبقى الغرض بلا نشط؛ ومعها يعود الأول نشطاً كما كان.
      await assert.rejects(
        () =>
          withUnitOfWork(created.pool, async (repositories) => {
            const inner = createRegistries({ ca, log, repositories });
            const previous = await inner.models.getActive('audit');
            assert.ok(previous);
            await repositories.models.update(previous.id, previous.version, { isActive: false });
            throw new Error('انقطاع مُقحَم بين الكتابتين');
          }),
        /انقطاع مُقحَم/,
      );

      const stillActive = await registries.models.getActive('audit');
      assert.equal(stillActive?.id, first.id, 'الغرض بقي بلا نشط بعد إخفاق التفعيل');
      assert.ok(second.id, 'النموذج الثاني مسجَّل ولم يُفعَّل');
    } finally {
      await created.drop();
    }
  },
);

test(
  'وحدة العمل تشمل أكثر من سجل: تراجعٌ واحد لكل ما كُتب فيها',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('uow');
    try {
      await up(created.pool);
      const ca = authority();
      const log = new EventLog();
      await assert.rejects(
        () =>
          withUnitOfWork(created.pool, async (repositories) => {
            const inner = createRegistries({ ca, log, repositories });
            await inner.agents.register({ name: 'وكيل-داخل-معاملة', role: 'observer' });
            await inner.laws.propose({
              title: 'قانون داخل معاملة',
              text: 'لا يبقى إن تراجعت',
              scope: 'operations',
              proposer: 'council',
            });
            throw new Error('إخفاق بعد كتابتين في سجلّين');
          }),
        /إخفاق بعد كتابتين/,
      );
      assert.equal(await countRows(created.pool, 'agents'), 0, 'وكيل بقي بعد تراجع المعاملة');
      assert.equal(await countRows(created.pool, 'laws'), 0, 'قانون بقي بعد تراجع المعاملة');
    } finally {
      await created.drop();
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ‏`LIVE-78` — ذرّيّةُ الاستعادةِ وسلامةُ محتواها (‏`WL-603`).
//
// **الضمانُ المستهدف** (‏اتّجاهُ المالك «ج»+«هـ»): (‏١) إخفاقُ الاستعادةِ في أيِّ نقطةٍ قبلَ نجاحِها
// يُبقي الهدفَ كما كان بالضبط؛ (‏٢) `RESTORE_OK` لا يُعلَنُ إلا ومحتوى الهدفِ (‏بياناتٍ وبنيةً وقيوداً)
// يطابقُ النسخةَ لا عددَ صفوفِها؛ (‏٣) نتيجةُ `COMMIT` بعدَ انقطاعٍ تُحسَمُ لا تُفترَض.
//
// القسمُ الأوّل **أحمرُ عمداً** ضدَّ `scripts/restore.mjs` الحاليّ: كلُّ اختبارٍ يؤكّدُ الضمانَ المستهدفَ
// ومعلَّمٌ `todo` لأنّ التنفيذَ الحاليَّ ينقضُه — فيظهرُ في TAP «not ok … # TODO» بفشلِه الفعليّ ولا
// يُخفى، ولا يُسقِطُ الحزمة. **لا يُحوَّلُ إلى أخضرَ بتليينِ تأكيد**؛ يصيرُ أخضرَ حين يُعتمَدُ تغييرُ الإنتاج.
// والقسمُ الثاني أخضرُ ضدَّ النموذجِ المختبريّ (‏`live78PrototypeRestore` في `tests/helpers/pg.mjs`).
// ‏ملاحظة: اختباراتُ `WL-602` السبعةُ (‏`0a389e08`) لم تصل إلى المستودعِ البعيد؛ هذه إعادةُ صياغتِها.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** وصلةُ الإدارة (‏superuser الاختبار). */
function l78AdminUrl() {
  return /** @type {string} */ (databaseUrl());
}

/** @param {string} name */
function l78Url(name) {
  const url = new URL(/** @type {string} */ (process.env.DATABASE_URL));
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * صورةُ الهدفِ كلِّه للمقارنة قبلُ/بعد: بصمةُ `state` و`fence` و`public` (‏بنيةً ومحتوى) وقوادحُ الأحداث.
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
async function l78TargetImage(pool) {
  const client = await pool.connect();
  try {
    let digest = '';
    const onNotice = (/** @type {any} */ n) => {
      const m = /^XUUX_L78_DIGEST=(.*)$/s.exec(String(n.message));
      if (m) digest = String(m[1]);
    };
    client.on('notice', onNotice);
    await client.query('BEGIN');
    const ledger = (
      await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS l`)
    ).rows[0].l;
    await client.query(
      live78DigestBlock(
        ['state', 'fence', 'public'],
        ledger ? 'public.schema_migrations' : null,
        LIVE78_NOTICE_TAIL,
      ),
    );
    await client.query('ROLLBACK');
    client.off('notice', onNotice);
    const evt = await client.query(
      `SELECT string_agg(evtname || ':' || evtevent || ':' || evtenabled::text, ',' ORDER BY evtname) AS e FROM pg_event_trigger`,
    );
    return `${digest}|evt=${evt.rows[0].e ?? ''}`;
  } finally {
    client.release();
  }
}

/**
 * مصدرٌ مُهاجَرٌ بمحتوى، ونسختُه النموذجيّة (‏البيانُ يحملُ `prototypeDigest` — حقلٌ مختبريٌّ باسمٍ مستقلٍّ عن `contentDigest` الإنتاجيّ منذُ `WL-606`، فلا تُقرأُ صيغةٌ بالأخرى؛ والإنتاجُ يرى نسخةَ النموذجِ بلا بصمة).
 * @param {string} label
 * `bodyRepeat` يكبّرُ الأرشيفَ فوقَ سعةِ الأنبوب.
 * @param {{ to?: number, bodyRepeat?: number }} [options]
 */
async function l78Source(label, options = {}) {
  const source = await createIsolatedDatabase(label);
  await up(source.pool, options.to === undefined ? {} : { to: options.to });
  const body =
    options.bodyRepeat === undefined ? `'نصّ '` : `repeat('نصّ ', ${Number(options.bodyRepeat)})`;
  await source.pool.query(
    `INSERT INTO state.laws (id, title, body, status, scope, proposer)
     SELECT 'law-' || lpad(g::text, 6, '0'), 'عنوان ' || g, ${body} || g, 'draft', 'testing', 'agent-001'
       FROM generate_series(1, 300) g`,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `l78-${label}-`));
  const dump = path.join(dir, 'state.dump');
  const manifest = await live78PrototypeBackup(dump, l78Url(source.name));
  return {
    source,
    dir,
    dump,
    manifest,
    cleanup: async () => {
      fs.rmSync(dir, { recursive: true, force: true });
      await source.drop();
    },
  };
}

/** هدفٌ «مُهاجَرٌ مشغول» قبلَ السياج (‏الحالُ الوحيدُ الذي يستبدلُه `--force`) ومعه صفٌّ قديم. */
async function l78BusyTarget(/** @type {string} */ label) {
  const target = await createIsolatedDatabase(label);
  await up(target.pool, { to: 23 });
  await target.pool.query(
    `INSERT INTO state.laws (id, title, body, status, scope, proposer)
     VALUES ('law-stale1', 'قديم', 'صفٌّ قبلَ الاستعادة', 'draft', 'testing', 'agent-001')`,
  );
  return target;
}

/** قادحُ أحداثٍ خارجَ `state` (‏ينجو من المحو) يرفضُ أوّلَ `CREATE INDEX` ⇒ `pg_restore` يفشلُ في منتصفه. */
async function l78InstallMidRestoreFailure(/** @type {import('pg').Pool} */ pool) {
  await pool.query(`CREATE FUNCTION public.l78_fail_index() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN RAISE EXCEPTION 'L78_INJECTED_MID_RESTORE_FAILURE'; END $f$`);
  await pool.query(`CREATE EVENT TRIGGER l78_fail_index ON ddl_command_end
    WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION public.l78_fail_index()`);
}

/**
 * قادحُ أحداثٍ خارجَ `state` يُلحقُ بـ`state.laws` حالَ إنشائها قادحَ صفوفٍ يغيّرُ كلَّ نصٍّ يُنسَخ —
 * فالأعدادُ تتطابقُ والمحتوى يختلف. (‏قادحُ الأحداثِ يتطلّبُ superuser: التهديدُ بقيّةٌ في الهدفِ أو مُشغِّلٌ.)
 */
async function l78InstallContentTamper(/** @type {import('pg').Pool} */ pool) {
  await pool.query(`CREATE FUNCTION public.l78_tamper_row() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN NEW.body := 'مُبدَّل'; RETURN NEW; END $f$`);
  await pool.query(`CREATE FUNCTION public.l78_attach_tamper() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    DECLARE o record;
    BEGIN
      FOR o IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE object_identity = 'state.laws' AND command_tag = 'CREATE TABLE' LOOP
        EXECUTE 'CREATE TRIGGER l78_tamper BEFORE INSERT ON state.laws FOR EACH ROW EXECUTE FUNCTION public.l78_tamper_row()';
      END LOOP;
    END $f$`);
  await pool.query(`CREATE EVENT TRIGGER l78_attach_tamper ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.l78_attach_tamper()`);
}

/** @param {import('pg').Pool} pool */
async function l78DropInjected(pool) {
  await pool.query('DROP EVENT TRIGGER IF EXISTS l78_fail_index');
  await pool.query('DROP EVENT TRIGGER IF EXISTS l78_attach_tamper');
}

// ─── القسمُ الأحمر: الضمانُ المستهدفُ ضدَّ `scripts/restore.mjs` الحاليّ ───

test(
  'LIVE-78 أحمر: إخفاقُ pg_restore في منتصفِه بعدَ `--force` يُبقي الهدفَ كما كان (‏الإنتاجُ ينقضُه: المحوُ مُلتزَمٌ قبلَه)',
  {
    skip: skipWithoutDatabase,
    todo: 'LIVE-78: scripts/restore.mjs يلتزمُ المحوَ في معاملةٍ ثمّ يشغّلُ pg_restore منفصلاً — الهدفُ يبقى ممحوّاً/جزئيّاً',
    timeout: 120_000,
  },
  async () => {
    const fixture = await l78Source('l78redmid');
    const target = await l78BusyTarget('l78redmidt');
    try {
      await l78InstallMidRestoreFailure(target.pool);
      const before = await l78TargetImage(target.pool);
      await assert.rejects(
        () =>
          restoreBackup(
            // ‏`allowUnverified`: نسخةُ النموذجِ بلا `contentDigest` إنتاجيّ (‏`WL-606`)؛ بدونِه يرفضُ الإنتاجُ
            // قبلَ اللمس (‏`RESTORE_DIGEST_MISSING`) فيخضرُّ الاختبارُ لسببٍ غيرِ الذي يقيسُه.
            { dumpPath: fixture.dump, database: target.name, force: true, allowUnverified: true },
            l78AdminUrl(),
          ),
        /pg_restore|COMMAND_FAILED/,
      );
      // الضمانُ المستهدف: لا أثرَ لاستعادةٍ فشلت. (‏الحاليّ: الصفُّ القديمُ ممحوٌّ والجداولُ بلا فهارس.)
      assert.equal(await l78TargetImage(target.pool), before, 'الهدفُ تغيّرَ بعدَ استعادةٍ فاشلة');
    } finally {
      await l78DropInjected(target.pool).catch(() => undefined);
      await target.drop();
      await fixture.cleanup();
    }
  },
);

// ‏`WL-606`: كانَ هذا الاختبارُ أحمرَ `todo` (‏`WL-603`) — `RESTORE_OK` أُعلِنَ والمحتوى مُبدَّلٌ بالأعدادِ
// نفسِها. صارَ أخضرَ بتنفيذِ بصمةِ المحتوى في `scripts/backup.mjs`/`restore.mjs`، **بلا تليينِ تأكيد**:
// التأكيدُ صارَ أضيق (‏رمزُ الفشلِ المحدَّد، ولا دفترَ مُركَّب)، والنسخةُ إنتاجيّةٌ لا نموذجيّة.
test(
  'LIVE-78/CONTENT-INTEGRITY: RESTORE_OK لا يُعلَنُ ومحتوى الهدفِ يخالفُ النسخةَ بأعدادٍ مطابقة (‏`WL-606`)',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    const fixture = await l78Source('l78redtamper');
    const target = await createIsolatedDatabase('l78redtampert');
    const prodDump = path.join(fixture.dir, 'prod.dump');
    try {
      await createBackup(prodDump, l78Url(fixture.source.name));
      await l78InstallContentTamper(target.pool);
      /** @type {unknown} */
      let outcome;
      try {
        await restoreBackup(
          { dumpPath: prodDump, database: target.name, force: false },
          l78AdminUrl(),
        );
        outcome = 'RESTORE_OK';
      } catch (error) {
        outcome = error;
      }
      const bodies = await target.pool.query(
        `SELECT count(*) FILTER (WHERE body = 'مُبدَّل')::int AS t, count(*)::int AS n FROM state.laws`,
      );
      // يُثبَتُ أوّلاً أنّ الحقنَ وقعَ فعلاً (‏وإلا فالاختبارُ لا يقيسُ شيئاً).
      assert.equal(bodies.rows[0].n, 300);
      assert.ok(bodies.rows[0].t > 0, 'الحقنُ لم يقع — الاختبارُ لا يقيس');
      // الضمان: محتوىً مخالفٌ ⇒ لا RESTORE_OK، بل فشلٌ مسمّى يسمّي الجدول.
      assert.notEqual(outcome, 'RESTORE_OK', 'RESTORE_OK أُعلِنَ والمحتوى مُبدَّل');
      assert.equal(/** @type {any} */ (outcome)?.code, 'RESTORE_CONTENT_MISMATCH', String(outcome));
      assert.match(String(/** @type {any} */ (outcome)?.message), /table laws: sha256/);
      // والهدفُ لا يُقرأُ مُهاجَراً سليماً: الدفترُ لم يُركَّب.
      const ledger = await target.pool.query(
        `SELECT to_regclass('public.schema_migrations') IS NULL AS absent`,
      );
      assert.equal(ledger.rows[0].absent, true, 'رُكِّبَ دفترُ الهجراتِ رغمَ فشلِ التحقّق');
    } finally {
      await l78DropInjected(target.pool).catch(() => undefined);
      await target.drop();
      await fixture.cleanup();
    }
  },
);

// ─── القسمُ الأخضر: النموذجُ المختبريّ (‏ج)+(‏هـ) ───

test(
  'LIVE-78 نموذج: استعادةٌ في معاملةٍ واحدةٍ إلى هدفٍ جديد ⇒ L78_RESTORE_OK وبصمةُ الهدفِ تطابقُ البيان',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    const fixture = await l78Source('l78ok');
    const name = `l78_ok_${crypto.randomBytes(4).toString('hex')}`;
    try {
      const result = await live78PrototypeRestore({
        dumpPath: fixture.dump,
        database: name,
        url: l78AdminUrl(),
      });
      assert.equal(result.outcome, LIVE78_OUTCOMES.OK, result.stderr);
      const pool = new pg.Pool({ connectionString: l78Url(name), max: 1 });
      try {
        const laws = await pool.query('SELECT count(*)::int AS n FROM state.laws');
        assert.equal(laws.rows[0].n, 300);
        const version = await pool.query(
          'SELECT max(version)::int AS v FROM public.schema_migrations',
        );
        assert.equal(version.rows[0].v, fixture.manifest.migrationVersion);
        // البصمةُ تُعادُ حسابُها مستقلّةً بعدَ COMMIT — لا ثقةَ بما قالته معاملةُ الاستعادة عن نفسها.
        const image = await l78TargetImage(pool);
        const digest = JSON.parse(image.slice(0, image.lastIndexOf('|evt=')));
        for (const [table, value] of Object.entries(fixture.manifest.prototypeDigest.tables)) {
          assert.deepEqual(digest.tables[table], value, `محتوى ${table}`);
        }
        assert.deepEqual(digest.ledger, fixture.manifest.prototypeDigest.ledger);
      } finally {
        await pool.end();
      }
    } finally {
      const admin = new pg.Client({ connectionString: l78AdminUrl() });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
      await fixture.cleanup();
    }
  },
);

test(
  'LIVE-78 نموذج: إخفاقُ pg_restore في منتصفِه بعدَ المحو ⇒ تراجعٌ كاملٌ والهدفُ كما كان بالضبط',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    const fixture = await l78Source('l78mid');
    const target = await l78BusyTarget('l78midt');
    try {
      await l78InstallMidRestoreFailure(target.pool);
      const before = await l78TargetImage(target.pool);
      const result = await live78PrototypeRestore({
        dumpPath: fixture.dump,
        database: target.name,
        url: l78AdminUrl(),
        force: true,
      });
      assert.equal(result.outcome, LIVE78_OUTCOMES.ROLLED_BACK, result.stderr);
      assert.equal(result.xactStatus, 'aborted');
      assert.match(result.stderr, /L78_INJECTED_MID_RESTORE_FAILURE/);
      assert.equal(await l78TargetImage(target.pool), before, 'الهدفُ تغيّر');
      const stale = await target.pool.query(
        `SELECT count(*)::int AS n FROM state.laws WHERE id = 'law-stale1'`,
      );
      assert.equal(stale.rows[0].n, 1, 'الصفُّ القديمُ مُحيَ');
    } finally {
      await l78DropInjected(target.pool).catch(() => undefined);
      await target.drop();
      await fixture.cleanup();
    }
  },
);

test(
  'LIVE-78/CONTENT-INTEGRITY نموذج: محتوىً مُبدَّلٌ بالأعدادِ نفسِها ⇒ L78_RESTORE_CONTENT_MISMATCH ولا COMMIT',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    const fixture = await l78Source('l78tamper');
    const target = await createIsolatedDatabase('l78tampert');
    try {
      await l78InstallContentTamper(target.pool);
      const before = await l78TargetImage(target.pool);
      const result = await live78PrototypeRestore({
        dumpPath: fixture.dump,
        database: target.name,
        url: l78AdminUrl(),
      });
      assert.equal(result.outcome, LIVE78_OUTCOMES.CONTENT_MISMATCH, result.stderr);
      // الفرقُ مسمّى: الجدولُ المُبدَّلُ وبنيةُ القادحِ المُلحَق.
      assert.match(result.stderr, /state\.laws/);
      assert.match(result.stderr, /"structure"/);
      assert.equal(await l78TargetImage(target.pool), before, 'الهدفُ تغيّر');
    } finally {
      await l78DropInjected(target.pool).catch(() => undefined);
      await target.drop();
      await fixture.cleanup();
    }
  },
);

test(
  'LIVE-78 نموذج: بيانٌ تُعدَّلُ بصمتُه وحدَها ⇒ رفضٌ وتراجع (‏البصمةُ تُقارَنُ فعلاً)، وهدفٌ مسيَّجٌ يُرفَضُ بلا لمس',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    const fixture = await l78Source('l78manifest');
    const fresh = await createIsolatedDatabase('l78manifestt');
    const fenced = await createIsolatedDatabase('l78fencedt');
    try {
      const manifestPath = `${fixture.dump}.manifest.json`;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.prototypeDigest.tables['state.laws'].sha256 = '0'.repeat(64);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      const before = await l78TargetImage(fresh.pool);
      const tampered = await live78PrototypeRestore({
        dumpPath: fixture.dump,
        database: fresh.name,
        url: l78AdminUrl(),
      });
      assert.equal(tampered.outcome, LIVE78_OUTCOMES.CONTENT_MISMATCH, tampered.stderr);
      assert.equal(await l78TargetImage(fresh.pool), before);

      await up(fenced.pool);
      const fencedBefore = await l78TargetImage(fenced.pool);
      const refused = await live78PrototypeRestore({
        dumpPath: fixture.dump,
        database: fenced.name,
        url: l78AdminUrl(),
        force: true,
      });
      assert.equal(refused.outcome, LIVE78_OUTCOMES.REFUSED_FENCED, refused.stderr);
      assert.equal(await l78TargetImage(fenced.pool), fencedBefore);
    } finally {
      await fresh.drop();
      await fenced.drop();
      await fixture.cleanup();
    }
  },
);

test(
  'LIVE-78 نموذج: رفضُ التمهيدِ (‏psql يخرجُ قبلَ `pg_restore`) يُحسَمُ ولا يُعلِّقُ الوعد — خمسُ جولاتٍ متتالية',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    // ‏مقيس قبلَ الإصلاح: 4/6 تشغيلاتٍ يفرغُ فيها حلقُ الأحداثِ والوعدُ معلّق (‏خرجُ `pg_restore` موقوفٌ بعدَ انفصالِ
    // الأنبوب)، فيسقطُ الملفُّ كلُّه في CI بـ«Promise resolution is still pending». المؤقّتُ يُبقي الحلقَ حيّاً
    // كي يظهرَ التعليقُ سقوطاً مسمّىً لا إلغاءً للملفّ.
    const fixture = await l78Source('l78refloop', { to: 23, bodyRepeat: 50 });
    const fenced = await createIsolatedDatabase('l78refloopt');
    try {
      await up(fenced.pool);
      const before = await l78TargetImage(fenced.pool);
      for (let round = 1; round <= 5; round += 1) {
        /** @type {NodeJS.Timeout | undefined} */
        let timer;
        const hung = new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`الجولة ${round}: الوعدُ معلّقٌ بعدَ 20 ث`)),
            20_000,
          );
        });
        try {
          const refused = await Promise.race([
            live78PrototypeRestore({
              dumpPath: fixture.dump,
              database: fenced.name,
              url: l78AdminUrl(),
              force: true,
            }),
            hung,
          ]);
          assert.equal(
            /** @type {any} */ (refused).outcome,
            LIVE78_OUTCOMES.REFUSED_FENCED,
            /** @type {any} */ (refused).stderr,
          );
        } finally {
          clearTimeout(timer);
        }
      }
      assert.equal(await l78TargetImage(fenced.pool), before);
    } finally {
      await fenced.drop();
      await fixture.cleanup();
    }
  },
);

test(
  'LIVE-78 نموذج: انقطاعٌ قبلَ COMMIT ⇒ aborted والهدفُ كما كان؛ وانقطاعٌ بعدَ وصولِ COMMIT ⇒ committed مُثبَتٌ لا مُفترَض',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const fixture = await l78Source('l78commit');
    const before = await l78BusyTarget('l78commitb');
    const after = await l78BusyTarget('l78commita');
    const base = new URL(/** @type {string} */ (l78AdminUrl()));
    const proxy = await startFaultProxy({ host: base.hostname, port: Number(base.port || 5432) });
    // ‏psql يفاوضُ TLS إن عرضَه الخادم، فلا يرى الوسيطُ النمط؛ الوسيطُ يقطعُ بالنصِّ الصريح.
    const viaProxy = () => {
      const url = new URL(proxy.urlFor(/** @type {string} */ (l78AdminUrl())));
      url.searchParams.set('sslmode', 'disable');
      return url.toString();
    };
    try {
      const imageBefore = await l78TargetImage(before.pool);
      const severedBefore = proxy.severOn('XUUX_L78_VERIFIED', { mode: 'before' });
      const lost = await live78PrototypeRestore({
        dumpPath: fixture.dump,
        database: before.name,
        url: l78AdminUrl(),
        connectUrl: viaProxy(),
        force: true,
      });
      await severedBefore;
      assert.equal(lost.outcome, LIVE78_OUTCOMES.ROLLED_BACK, lost.stderr);
      assert.equal(lost.xactStatus, 'aborted');
      assert.equal(await l78TargetImage(before.pool), imageBefore);

      const severedAfter = proxy.severOn('XUUX_L78_VERIFIED', { mode: 'after-commit' });
      const unknown = await live78PrototypeRestore({
        dumpPath: fixture.dump,
        database: after.name,
        url: l78AdminUrl(),
        connectUrl: viaProxy(),
        force: true,
      });
      await severedAfter;
      // ‏psql رأى انقطاعاً لا نجاحاً؛ الحسمُ من الخادم: المعاملةُ التُزمت.
      assert.equal(unknown.outcome, LIVE78_OUTCOMES.COMMIT_CONFIRMED, unknown.stderr);
      assert.equal(unknown.xactStatus, 'committed');
      const laws = await after.pool.query('SELECT count(*)::int AS n FROM state.laws');
      assert.equal(laws.rows[0].n, 300);
    } finally {
      await proxy.close();
      await before.drop();
      await after.drop();
      await fixture.cleanup();
    }
  },
);

test(
  'LIVE-78 نموذج: كاتبٌ متزامنٌ أثناءَ النسخ ⇒ البصمةُ من لقطةِ pg_dump نفسِها، فالاستعادةُ تطابقُها',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async () => {
    const source = await createIsolatedDatabase('l78writer');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l78-writer-'));
    const name = `l78_writer_${crypto.randomBytes(4).toString('hex')}`;
    let stop = false;
    let writes = 0;
    try {
      await up(source.pool, { to: 23 });
      const writer = (async () => {
        while (!stop) {
          writes += 1;
          await source.pool.query(
            `INSERT INTO state.laws (id, title, body, status, scope, proposer)
             VALUES ($1, $2, 'كتابةٌ متزامنة', 'draft', 'testing', 'agent-001')`,
            [`law-w${String(writes).padStart(6, '0')}`, `متزامن ${writes}`],
          );
        }
      })();
      while (writes < 20) await new Promise((r) => setTimeout(r, 5));
      const dump = path.join(dir, 'state.dump');
      const manifest = await live78PrototypeBackup(dump, l78Url(source.name));
      const atBackup = writes;
      while (writes < atBackup + 20) await new Promise((r) => setTimeout(r, 5));
      stop = true;
      await writer;
      const captured = Number(manifest.prototypeDigest.tables['state.laws'].rows);
      assert.ok(
        captured > 0 && captured < writes,
        `اللقطةُ ليست نقطةً وسطى: ${captured} من ${writes}`,
      );
      const result = await live78PrototypeRestore({
        dumpPath: dump,
        database: name,
        url: l78AdminUrl(),
      });
      assert.equal(result.outcome, LIVE78_OUTCOMES.OK, result.stderr);
    } finally {
      stop = true;
      const admin = new pg.Client({ connectionString: l78AdminUrl() });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
      fs.rmSync(dir, { recursive: true, force: true });
      await source.drop();
    }
  },
);
