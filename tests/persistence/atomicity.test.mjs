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
import { spawn } from 'node:child_process';
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
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
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

// ─── القسمُ الأوّل: الضمانُ المستهدفُ ضدَّ `scripts/restore.mjs` (‏كانَ أحمرَ؛ أخضرُ منذُ `WL-624`) ───

test(
  // ‏`WL-624`: كانَ أحمرَ `todo` منذُ `WL-603`؛ أخضرُ بلا تليينٍ بعدَ أن صارت الاستعادةُ معاملةً واحدة.
  'LIVE-78: إخفاقُ pg_restore في منتصفِه بعدَ `--force` يُبقي الهدفَ كما كان (‏كانَ الإنتاجُ ينقضُه: المحوُ مُلتزَمٌ قبلَه)',
  {
    skip: skipWithoutDatabase,
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
      const before = await l78TargetImage(target.pool);
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
      // الضمان: محتوىً مخالفٌ ⇒ لا RESTORE_OK، بل فشلٌ مسمّى يسمّي الجدول. ورسالةُ المخالفةِ نفسُها دليلُ
      // أنّ الحقنَ وقعَ داخلَ المعاملة (‏لا حقنَ ⇒ لا مخالفةَ في laws).
      assert.notEqual(outcome, 'RESTORE_OK', 'RESTORE_OK أُعلِنَ والمحتوى مُبدَّل');
      assert.equal(/** @type {any} */ (outcome)?.code, 'RESTORE_CONTENT_MISMATCH', String(outcome));
      assert.match(String(/** @type {any} */ (outcome)?.message), /table laws: sha256/);
      // ‏`WL-624`: كانَ التأكيدُ «الدفترُ لم يُركَّب» والمحتوى المُبدَّلُ باقٍ في الهدف. الآنَ أضيق: التحقّقُ قبلَ
      // ‏`COMMIT` في المعاملةِ نفسِها ⇒ لا أثرَ للمستعادِ أصلاً — لا `state` ولا دفتر، والصورةُ كما كانت.
      const leftovers = await target.pool.query(
        `SELECT to_regnamespace('state') IS NULL AS state_absent,
                to_regclass('public.schema_migrations') IS NULL AS ledger_absent`,
      );
      assert.deepEqual(leftovers.rows[0], { state_absent: true, ledger_absent: true });
      assert.equal(await l78TargetImage(target.pool), before, 'الهدفُ تغيّرَ بعدَ تحقّقٍ فاشل');
      // ضابط: الحقنُ نفسُه منزوعاً ⇒ الاستعادةُ نفسُها تنجحُ والمحتوى أصليّ (‏فالفشلُ أعلاه من الحقنِ لا من غيرِه).
      await l78DropInjected(target.pool);
      await restoreBackup(
        { dumpPath: prodDump, database: target.name, force: false },
        l78AdminUrl(),
      );
      const bodies = await target.pool.query(
        `SELECT count(*) FILTER (WHERE body = 'مُبدَّل')::int AS t, count(*)::int AS n FROM state.laws`,
      );
      assert.deepEqual(bodies.rows[0], { t: 0, n: 300 });
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

// ═══ ‏`WL-624` — ‏`LIVE-78`: الاستعادةُ معاملةٌ واحدةٌ و`COMMIT` الانتقالُ الوحيد ══════════════════════════
// كلُّ اختبارٍ هنا ضدَّ `scripts/restore.mjs` الإنتاجيّ (‏العمليّةِ أو `restoreBackup`)، وكلُّ إخفاقٍ يُقاسُ
// بصورةِ الهدفِ كاملةً قبلُ/بعد (‏`l78TargetImage`) لا بعلامةٍ واحدة، ومعه ضابطٌ ينجحُ بالمسارِ نفسِه منزوعَ
// العطب — كي لا يخضرَّ اختبارٌ لأنّ الاستعادةَ لا تعملُ أصلاً.

const L78_RESTORE_CLI = new URL('../../scripts/restore.mjs', import.meta.url).pathname;

/**
 * يُشغِّلُ `restore.mjs` عمليّةً مستقلّة (‏الأداةُ كما يُشغِّلُها المشغّل).
 * @param {string[]} args
 * @param {Record<string, string>} env
 */
function l78RunCli(args, env) {
  const child = spawn(process.execPath, [L78_RESTORE_CLI, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  /** @type {Promise<{ code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>} */
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
}

/**
 * ينتظرُ جلسةَ الاستعادةِ (‏`application_name = xuux-restore`) على الهدفِ بشرطِ `where`؛ رصدُ حالٍ لا مهلة.
 * @param {string} database
 * @param {string} where
 * @returns {Promise<number | null>} رقمُ الخلفيّة أو `null` عندَ انقضاءِ الحدّ.
 */
async function l78WaitForRestoreBackend(database, where) {
  const admin = new pg.Client({ connectionString: l78AdminUrl() });
  await admin.connect();
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await admin.query(
        `SELECT pid FROM pg_stat_activity
          WHERE datname = $1 AND application_name = 'xuux-restore' AND ${where}`,
        [database],
      );
      if ((r.rowCount ?? 0) > 0) return Number(r.rows[0].pid);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  } finally {
    await admin.end();
  }
}

/**
 * ينتظرُ ألّا تبقى على الهدفِ جلسةُ استعادة (‏أُجهِضت معاملتُها وخرجت).
 * @param {string} database
 * @returns {Promise<boolean>}
 */
async function l78WaitForNoRestoreBackend(database) {
  const admin = new pg.Client({ connectionString: l78AdminUrl() });
  await admin.connect();
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await admin.query(
        `SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND application_name = 'xuux-restore'`,
        [database],
      );
      if ((r.rowCount ?? 0) === 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  } finally {
    await admin.end();
  }
}

/**
 * قادحُ أحداثٍ خارجَ `state` يُوقِفُ أوّلَ `CREATE INDEX` من خرجِ `pg_restore` ‏`seconds` ثانيةً (‏مرّةً في
 * المعاملة) — فتقفُ الاستعادةُ في منتصفِها بعدَ المحوِ وبعدَ إنشاءِ الجداولِ وتعبئتِها، حتميّاً بلا `sleep` في الاختبار.
 * @param {import('pg').Pool} pool
 * @param {number} seconds
 */
async function l78InstallMidRestorePause(pool, seconds) {
  await pool.query(`CREATE FUNCTION public.l78_pause_once() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF pg_catalog.current_setting('xuux.l78_paused', true) IS DISTINCT FROM '1' THEN
        PERFORM pg_catalog.set_config('xuux.l78_paused', '1', true);
        PERFORM pg_catalog.pg_sleep(${Number(seconds)});
      END IF;
    END $f$`);
  await pool.query(`CREATE EVENT TRIGGER l78_pause_once ON ddl_command_end
    WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION public.l78_pause_once()`);
}

/**
 * مصدرٌ بنسخةٍ **إنتاجيّةٍ** (‏`createBackup`، بصمةُ محتوى `WL-606`) وهدفٌ مشغولٌ بصفٍّ قديم.
 * @param {string} label
 */
async function l78ProductionFixture(label) {
  const fixture = await l78Source(label);
  const dump = path.join(fixture.dir, 'prod.dump');
  await createBackup(dump, l78Url(fixture.source.name));
  const target = await l78BusyTarget(`${label}t`);
  return {
    fixture,
    dump,
    target,
    cleanup: async () => {
      await l78DropInjected(target.pool).catch(() => undefined);
      await target.pool.query('DROP EVENT TRIGGER IF EXISTS l78_pause_once').catch(() => undefined);
      await target.pool.query('DROP EVENT TRIGGER IF EXISTS l78_gate_arm').catch(() => undefined);
      await target.drop();
      await fixture.cleanup();
    },
  };
}

/**
 * الصفُّ القديمُ مقروءٌ من الهدفِ بعدَ الإخفاق (‏البياناتُ القديمةُ صالحةٌ للاستعمال لا مجرّدُ «صورةٍ» متطابقة).
 * @param {import('pg').Pool} pool
 */
async function l78AssertStaleUsable(pool) {
  const r = await pool.query(`SELECT body FROM state.laws WHERE id = 'law-stale1'`);
  assert.deepEqual(r.rows, [{ body: 'صفٌّ قبلَ الاستعادة' }], 'الصفُّ القديمُ لم يعدْ مقروءاً');
  const ledger = await pool.query('SELECT max(version)::int AS v FROM public.schema_migrations');
  assert.equal(ledger.rows[0].v, 23, 'دفترُ الهدفِ القديمُ تغيّر');
}

/**
 * الاستعادةُ اكتملت فعلاً: محتوى المصدرِ كاملاً، ولا صفَّ قديم، والدفترُ مُركَّب.
 * @param {import('pg').Pool} pool
 */
async function l78AssertRestored(pool) {
  const r = await pool.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE id = 'law-stale1')::int AS stale FROM state.laws`,
  );
  assert.deepEqual(r.rows[0], { n: 300, stale: 0 });
  const ledger = await pool.query(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS l`,
  );
  assert.equal(ledger.rows[0].l, true);
}

test(
  'WL-624 LIVE-78: قتلُ عمليّةِ restore.mjs بـSIGKILL في منتصفِ pg_restore ⇒ لا COMMIT؛ الهدفُ كما كانَ مقروءاً، ولا [RESTORE_OK]، وإعادةُ المحاولةِ تنجح',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78kill');
    // ‏SIGKILL لا يُشغِّلُ تنظيفاً: النسخةُ الخاصّةُ للأرشيف (‏`xuux-restore-*`، `snapshotVerifiedArchive`)
    // تبقى. تُوجَّهُ إلى جذرٍ يملكُه الاختبارُ (‏`TMPDIR`) فيُقاسُ بقاؤُها حدّاً مُعلَناً ويُمحى الجذر.
    const killTmp = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-l78kill-')));
    try {
      await l78InstallMidRestorePause(env.target.pool, 3);
      const before = await l78TargetImage(env.target.pool);
      const live = l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
        TMPDIR: killTmp,
      });
      const pid = await l78WaitForRestoreBackend(env.target.name, `wait_event = 'PgSleep'`);
      assert.notEqual(pid, null, 'الاستعادةُ لم تبلغ منتصفَها (‏CREATE INDEX)');
      // في هذه اللحظة: المحوُ وقعَ والجداولُ أُنشئت وعُبِّئت داخلَ المعاملة — لم يُلتزَم منها شيء.
      live.child.kill('SIGKILL');
      const killed = await live.done;
      assert.equal(killed.signal, 'SIGKILL');
      assert.doesNotMatch(killed.stdout, /RESTORE_OK/);
      // حدٌّ مُعلَنٌ منذُ `WL-614` (‏`docs/RECOVERY.md`، الحدُّ 3): القتلُ يتركُ النسخةَ الخاصّةَ للأرشيفِ في `TMPDIR` (‏0700) — بلا أثرٍ على الهدف.
      assert.deepEqual(
        fs.readdirSync(killTmp).filter((name) => name.startsWith('xuux-restore-')).length,
        1,
        'النسخةُ الخاصّةُ للأرشيفِ بعدَ SIGKILL',
      );
      // الأداةُ ماتت ولم ترسلْ COMMIT ⇒ ‏psql يبلغُ نهايةَ مدخلِه فيخرج ⇒ يُجهِضُ الخادمُ المعاملة.
      const gone = await l78WaitForNoRestoreBackend(env.target.name);
      assert.ok(gone, 'بقيت جلسةُ الاستعادةِ حيّةً بعدَ موتِ الأداة');
      assert.equal(await l78TargetImage(env.target.pool), before, 'الهدفُ تغيّرَ بعدَ قتلِ الأداة');
      await l78AssertStaleUsable(env.target.pool);
      // إعادةُ المحاولة: الأمرُ نفسُه بلا العطبِ ينجحُ كاملاً — لا أثرَ متبقٍّ من المحاولةِ المقتولةِ يعيقُها.
      await env.target.pool.query('DROP EVENT TRIGGER l78_pause_once');
      const retry = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(retry.code, 0, retry.stderr);
      assert.match(retry.stdout, /\[RESTORE_OK\]/);
      await l78AssertRestored(env.target.pool);
    } finally {
      await env.cleanup();
      fs.rmSync(killTmp, { recursive: true, force: true });
    }
  },
);

test(
  'WL-624 LIVE-78: إنهاءُ جلسةِ الاستعادةِ من الخادم (‏pg_terminate_backend) في منتصفِ pg_restore ⇒ RESTORE_COMMAND_FAILED، والهدفُ كما كانَ مقروءاً',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78term');
    try {
      await l78InstallMidRestorePause(env.target.pool, 30);
      const before = await l78TargetImage(env.target.pool);
      const run = l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      });
      const pid = await l78WaitForRestoreBackend(env.target.name, `wait_event = 'PgSleep'`);
      assert.notEqual(pid, null, 'الاستعادةُ لم تبلغ منتصفَها');
      const admin = new pg.Client({ connectionString: l78AdminUrl() });
      await admin.connect();
      try {
        await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      } finally {
        await admin.end();
      }
      const result = await run.done;
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.match(result.stderr, /⛔ \[RESTORE_COMMAND_FAILED\]/);
      assert.match(result.stderr, /لا COMMIT: الهدفُ كما كان/);
      assert.equal(
        await l78TargetImage(env.target.pool),
        before,
        'الهدفُ تغيّرَ بعدَ إنهاءِ الجلسة',
      );
      await l78AssertStaleUsable(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

/**
 * مُغلِّفُ `pg_restore` يُمرِّرُ `--version` و`--list` إلى الأداةِ الحقيقيّة، ويُخرِجُ من الاستعادةِ **نصفَ** نصِّها
 * ثمّ يخرجُ برمز 1 — موتُ `pg_restore` في منتصفِ الضخّ بعدَ أن نُفِّذَت عباراتٌ منه. والنصفُ يُحفَظُ دليلاً.
 * و`listExtra` سطرٌ يُلحَقُ بخرجِ `--list` (‏فهرسٌ مُزوَّر)، و`listFake` عددُ مدخلاتِ تعليقٍ مزوّرةٍ تُلحَقُ به.
 * @param {string} dir
 * @param {{ listExtra?: string, listFake?: number }} [options]
 */
async function l78RestoreWrapper(dir, options = {}) {
  const { resolvePgTool } = await import('../../scripts/lib/pg-tools.mjs');
  const real = JSON.stringify(resolvePgTool('pg_restore'));
  const wrapper = path.join(dir, 'pg_restore');
  const full = JSON.stringify(path.join(dir, 'full.sql'));
  const half = path.join(dir, 'half.sql');
  const fake =
    options.listFake === undefined
      ? ''
      : `i=0; while [ $i -lt ${options.listFake} ]; do echo "$((90000 + i)); 0 0 COMMENT - fake $i state"; i=$((i + 1)); done; `;
  const lines = [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then exec ' + real + ' "$@"; fi',
    options.listFake !== undefined
      ? `if [ "$1" = "--list" ]; then ${real} "$@" || exit $?; ${fake}exit 0; fi`
      : options.listExtra === undefined
        ? 'if [ "$1" = "--list" ]; then exec ' + real + ' "$@"; fi'
        : `if [ "$1" = "--list" ]; then ${real} "$@" || exit $?; echo ${JSON.stringify(options.listExtra)}; exit 0; fi`,
    `${real} "$@" > ${full} || exit 9`,
    `size=$(wc -c < ${full})`,
    `head -c $((size / 2)) ${full} | tee ${JSON.stringify(half)}`,
    'exit 1',
    '',
  ];
  fs.writeFileSync(wrapper, lines.join('\n'), { mode: 0o700 });
  return { wrapper, half };
}

test(
  'WL-624 LIVE-78: موتُ pg_restore بعدَ ضخِّ نصفِ الاستعادة ⇒ لا COMMIT؛ الهدفُ القائمُ كما كانَ مقروءاً، والهدفُ الذي أنشأته الاستعادةُ يُحذَف',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78half');
    const fresh = `l78half_new_${process.pid}`;
    try {
      const { wrapper, half } = await l78RestoreWrapper(env.fixture.dir);
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
        PG_RESTORE: wrapper,
      }).done;
      // النصفُ المضخوخُ فيه محوٌ وإنشاءٌ حقيقيّان — فالاختبارُ يقيسُ تراجعَ ما نُفِّذ، لا استعادةً لم تبدأ.
      const pumped = fs.readFileSync(half, 'utf8');
      assert.match(pumped, /CREATE TABLE state\./);
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.match(result.stderr, /⛔ \[RESTORE_COMMAND_FAILED\]/);
      assert.equal(
        await l78TargetImage(env.target.pool),
        before,
        'الهدفُ تغيّرَ بعدَ موتِ pg_restore',
      );
      await l78AssertStaleUsable(env.target.pool);

      // هدفٌ غيرُ موجود: تُنشئُه الاستعادة ثمّ تفشل ⇒ يُحذَف (‏«كما كان» = غائب).
      const created = await l78RunCli([env.dump, '--database', fresh], {
        DATABASE_URL: l78AdminUrl(),
        PG_RESTORE: wrapper,
      }).done;
      assert.equal(created.code, 1, created.stdout);
      assert.doesNotMatch(created.stdout, /RESTORE_OK/);
      const admin = new pg.Client({ connectionString: l78AdminUrl() });
      await admin.connect();
      try {
        const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [fresh]);
        assert.equal(exists.rowCount, 0, 'بقيت قاعدةُ الهدفِ التي أنشأتها استعادةٌ فاشلة');
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS "${fresh}"`).catch(() => undefined);
        await admin.end();
      }
      // ضابط: الأمرُ نفسُه بالأداةِ الحقيقيّةِ ينجح.
      const control = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(control.code, 0, control.stderr);
      await l78AssertRestored(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

test(
  'WL-624 LIVE-78: إخفاقُ التحقّقِ (‏بصمةُ المحتوى) قبلَ الانتقال على هدفٍ مشغول بـ--force ⇒ RESTORE_CONTENT_MISMATCH، والقديمُ كما كانَ مقروءاً',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78vfail');
    try {
      await l78InstallContentTamper(env.target.pool);
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK|CONTENT_VERIFIED/);
      assert.match(result.stderr, /⛔ \[RESTORE_CONTENT_MISMATCH\].*table laws: sha256/s);
      assert.equal(await l78TargetImage(env.target.pool), before, 'الهدفُ تغيّرَ بعدَ تحقّقٍ فاشل');
      await l78AssertStaleUsable(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

/**
 * بوّابةٌ تُسقِطُ `COMMIT` نفسَه: قيدٌ مؤجَّلٌ (‏`INITIALLY DEFERRED`) على جدولٍ في `public` يُعبِّئُه قادحُ أحداثٍ
 * عندَ أيِّ `ALTER TABLE` — فكلُّ العباراتِ تنجح، والتحقّقُ ينجح، ولا يسقطُ إلا الالتزام.
 * @param {import('pg').Pool} pool
 */
async function l78InstallCommitGate(pool) {
  await pool.query('CREATE TABLE public.l78_gate (n integer)');
  await pool.query(`CREATE FUNCTION public.l78_gate_fail() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN RAISE EXCEPTION 'L78_INJECTED_COMMIT_FAILURE'; END $f$`);
  await pool.query(`CREATE CONSTRAINT TRIGGER l78_gate_fail AFTER INSERT ON public.l78_gate
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.l78_gate_fail()`);
  await pool.query(`CREATE FUNCTION public.l78_gate_arm() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN INSERT INTO public.l78_gate VALUES (1); END $f$`);
  await pool.query(`CREATE EVENT TRIGGER l78_gate_arm ON ddl_command_end
    WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION public.l78_gate_arm()`);
}

test(
  'WL-624 LIVE-78: إخفاقُ الانتقالِ نفسِه (‏COMMIT يُرفَض بقيدٍ مؤجَّل) ⇒ RESTORE_COMMIT_FAILED لا [RESTORE_OK]، والهدفُ كما كانَ مقروءاً',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78cfail');
    try {
      await l78InstallCommitGate(env.target.pool);
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(result.code, 1, result.stdout);
      // التحقّقُ نجحَ قبلَ COMMIT، لكنّ النجاحَ لا يُعلَنُ إلا بعدَ الانتقال.
      assert.doesNotMatch(result.stdout, /RESTORE_OK|CONTENT_VERIFIED/);
      assert.match(result.stderr, /⛔ \[RESTORE_COMMIT_FAILED\].*L78_INJECTED_COMMIT_FAILURE/s);
      assert.equal(
        await l78TargetImage(env.target.pool),
        before,
        'الهدفُ تغيّرَ بعدَ COMMIT مرفوض',
      );
      await l78AssertStaleUsable(env.target.pool);
      const gate = await env.target.pool.query('SELECT count(*)::int AS n FROM public.l78_gate');
      assert.equal(gate.rows[0].n, 0, 'أثرٌ من المعاملةِ المُجهَضةِ باقٍ');
      // ضابط: البوّابةُ منزوعةً ⇒ الأمرُ نفسُه ينجح.
      await env.target.pool.query('DROP EVENT TRIGGER l78_gate_arm');
      const control = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(control.code, 0, control.stderr);
      assert.match(control.stdout, /\[RESTORE_OK\]/);
      await l78AssertRestored(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

/** رابطُ الإدارةِ عبرَ الوسيط، بلا TLS كي يرى الوسيطُ نصَّ البروتوكول. */
function l78ProxiedAdminUrl(/** @type {{ urlFor: (u: string) => string }} */ proxy) {
  const url = new URL(proxy.urlFor(l78AdminUrl()));
  url.searchParams.set('sslmode', 'disable');
  return url.toString();
}

test(
  'WL-624 LIVE-78: انقطاعُ الاتصالِ حولَ COMMIT — بعدَ الالتزامِ ⇒ يُحسَمُ من الخادمِ نجاحاً؛ قبلَ وصولِه ⇒ RESTORE_COMMIT_FAILED والهدفُ كما كان؛ وبلا خادمٍ يُسأل ⇒ RESTORE_COMMIT_OUTCOME_UNKNOWN والحالُ أحدُ الطرفين لا بينَهما',
  { skip: skipWithoutDatabase, timeout: 240_000 },
  async () => {
    const env = await l78ProductionFixture('l78commit');
    const proxy = await startFaultProxy({
      host: '127.0.0.1',
      port: Number(new URL(l78AdminUrl()).port || 5432),
    });
    const args = [env.dump, '--database', env.target.name, '--force'];
    /** @type {Awaited<ReturnType<typeof l78BusyTarget>> | undefined} */
    let second;
    try {
      const before = await l78TargetImage(env.target.pool);
      // (‏أ) ‏COMMIT لا يصلُ الخادم: يُقطَعُ الاتصالُ قبلَ تمريرِه ⇒ الخادمُ يُجهِض ⇒ الحسمُ `aborted`.
      const fired = { before: false, acked: false, unknown: false };
      void proxy.severOn('COMMIT;\0', { mode: 'before' }).then(() => {
        fired.before = true;
      });
      const lost = await l78RunCli(args, { DATABASE_URL: l78ProxiedAdminUrl(proxy) }).done;
      assert.ok(fired.before, 'القطعُ قبلَ COMMIT لم يقع');
      assert.equal(lost.code, 1, lost.stdout);
      assert.doesNotMatch(lost.stdout, /RESTORE_OK/);
      assert.match(lost.stderr, /⛔ \[RESTORE_COMMIT_FAILED\]/);
      assert.equal(await l78TargetImage(env.target.pool), before, 'الهدفُ تغيّرَ وCOMMIT لم يصل');
      await l78AssertStaleUsable(env.target.pool);

      // (‏ب) ‏COMMIT يُلتزَمُ ويضيعُ ردُّه، والخادمُ متاحٌ للسؤال ⇒ ‏`pg_xact_status` = committed ⇒ نجاحٌ حقيقيّ.
      void proxy.severOn('RENAME TO "schema_migrations"', { mode: 'after-commit' }).then(() => {
        fired.acked = true;
      });
      const acked = await l78RunCli(args, { DATABASE_URL: l78ProxiedAdminUrl(proxy) }).done;
      assert.ok(fired.acked, 'القطعُ بعدَ COMMIT لم يقع');
      assert.equal(acked.code, 0, acked.stderr);
      assert.match(acked.stdout, /\[RESTORE_OK\]/);
      await l78AssertRestored(env.target.pool);

      // (‏ج) الشيءُ نفسُه والوسيطُ يُغلَقُ بعدَه فلا يُسأَلُ الخادم ⇒ نتيجةٌ مجهولةٌ مُعلَنة لا نجاحٌ مُدّعى.
      // هدفٌ مشغولٌ ثانٍ: الأوّلُ صارَ مُسيَّجاً بالاستعادةِ الناجحة، و`--force` يرفضُ المُسيَّج (‏`WL-597`).
      second = await l78BusyTarget('l78commit2t');
      void proxy
        .severOn('RENAME TO "schema_migrations"', { mode: 'after-commit', thenDown: true })
        .then(() => {
          fired.unknown = true;
        });
      const unknown = await l78RunCli([env.dump, '--database', second.name, '--force'], {
        DATABASE_URL: l78ProxiedAdminUrl(proxy),
      }).done;
      assert.ok(fired.unknown, 'القطعُ الثاني لم يقع');
      assert.equal(unknown.code, 1, unknown.stdout);
      assert.doesNotMatch(unknown.stdout, /RESTORE_OK/);
      assert.match(unknown.stderr, /⛔ \[RESTORE_COMMIT_OUTCOME_UNKNOWN\]/);
      // والحالُ الفعليُّ أحدُ الطرفين بالضبط — هنا الالتزامُ وقع: المستعادُ كاملاً، لا خليط.
      await l78AssertRestored(second.pool);
    } finally {
      await proxy.close();
      await second?.drop();
      await env.cleanup();
    }
  },
);

test(
  'WL-624 LIVE-78: انقطاعُ الاتصالِ في منتصفِ pg_restore ⇒ RESTORE_COMMAND_FAILED، والهدفُ كما كانَ مقروءاً',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78sever');
    const proxy = await startFaultProxy({
      host: '127.0.0.1',
      port: Number(new URL(l78AdminUrl()).port || 5432),
    });
    try {
      const before = await l78TargetImage(env.target.pool);
      let fired = false;
      void proxy.severOn('CREATE INDEX', { mode: 'before' }).then(() => {
        fired = true;
      });
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78ProxiedAdminUrl(proxy),
      }).done;
      assert.ok(fired, 'القطعُ لم يقع');
      assert.equal(result.code, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.match(result.stderr, /⛔ \[RESTORE_COMMAND_FAILED\]/);
      assert.equal(await l78TargetImage(env.target.pool), before, 'الهدفُ تغيّرَ بعدَ الانقطاع');
      await l78AssertStaleUsable(env.target.pool);
    } finally {
      await proxy.close();
      await env.cleanup();
    }
  },
);

test(
  'WL-624 LIVE-78: أرشيفٌ في فهرسِه كائنٌ كبير (‏BLOB) يُرفَضُ RESTORE_ARCHIVE_UNSUPPORTED قبلَ اللمس — خرجُه يحملُ BEGIN/COMMIT خاصّةً تكسرُ المعاملةَ الواحدة',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78blob');
    try {
      const { wrapper } = await l78RestoreWrapper(env.fixture.dir, {
        listExtra: '9999; 2613 16400 BLOB - 16400 state',
      });
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
        PG_RESTORE: wrapper,
      }).done;
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stderr, /⛔ \[RESTORE_ARCHIVE_UNSUPPORTED\]/);
      assert.equal(
        fs.existsSync(path.join(env.fixture.dir, 'full.sql')),
        false,
        'شُغِّلَت الاستعادةُ رغمَ الرفض',
      );
      assert.equal(await l78TargetImage(env.target.pool), before);
      await l78AssertStaleUsable(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);

test(
  'WL-624 LIVE-78: فهرسٌ يتجاوزُ تقديرُ أقفالِه نصفَ جدولِ الأقفالِ المشترك يُرفَضُ RESTORE_LOCK_CAPACITY قبلَ اللمس — بلا رفعِ إعداد',
  { skip: skipWithoutDatabase, timeout: 180_000 },
  async () => {
    const env = await l78ProductionFixture('l78lock');
    try {
      const { LOCKS_PER_ARCHIVE_ENTRY } = await import('../../scripts/restore.mjs');
      const settings = (
        await env.target.pool.query(
          `SELECT current_setting('max_locks_per_transaction')::int * (current_setting('max_connections')::int + current_setting('max_prepared_transactions')::int) AS capacity`,
        )
      ).rows[0];
      // مدخلاتٌ مزوّرةٌ تكفي وحدَها لتجاوزِ النصف — الحدُّ يُقرأُ من الخادمِ لا يُفترَض.
      const fake = Math.ceil(Number(settings.capacity) / 2 / LOCKS_PER_ARCHIVE_ENTRY) + 1;
      const { wrapper } = await l78RestoreWrapper(env.fixture.dir, { listFake: fake });
      const before = await l78TargetImage(env.target.pool);
      const result = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
        PG_RESTORE: wrapper,
      }).done;
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stderr, /⛔ \[RESTORE_LOCK_CAPACITY\]/);
      assert.doesNotMatch(result.stdout, /RESTORE_OK/);
      assert.equal(
        fs.existsSync(path.join(env.fixture.dir, 'full.sql')),
        false,
        'شُغِّلَت الاستعادةُ رغمَ الرفض',
      );
      assert.equal(await l78TargetImage(env.target.pool), before);
      await l78AssertStaleUsable(env.target.pool);
      await l78WaitForNoRestoreBackend(env.target.name);

      // ضابط: الأرشيفُ نفسُه بلا تزويرٍ يمرُّ من الفحصِ نفسِه ويُستعاد.
      const control = await l78RunCli([env.dump, '--database', env.target.name, '--force'], {
        DATABASE_URL: l78AdminUrl(),
      }).done;
      assert.equal(control.code, 0, control.stderr);
      assert.match(control.stdout, /\[RESTORE_OK\]/);
      await l78AssertRestored(env.target.pool);
    } finally {
      await env.cleanup();
    }
  },
);
