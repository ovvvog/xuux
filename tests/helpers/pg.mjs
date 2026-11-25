/**
 * مساعد اختبارات قاعدة البيانات — المسار `M3`.
 *
 * كل ملف اختبار يعمل في **قاعدة خاصة به** يُنشئها ويُسقطها: ملفات الاختبار تعمل
 * متوازية في `node --test`، وقاعدة مشتركة تجعل هجرةً في ملفٍ تُسقط جداول ملفٍ
 * آخر فيصير الفشل عشوائياً. والقاعدة تُسقط في `after` ولو أخفق الاختبار.
 *
 * وإن لم تُعلَن `DATABASE_URL` فالاختبار **يُتخطّى بسببٍ مطبوع** لا يمرّ صامتاً:
 * تخطٍّ صامت يُقرأ نجاحاً. وCI يُعلنها عبر خدمة postgres في
 * `.github/workflows/ci.yml`، فالتخطّي محليٌّ لا في البوابة.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/** @returns {string | undefined} */
export function databaseUrl() {
  const url = process.env.DATABASE_URL;
  return typeof url === 'string' && url.trim() !== '' ? url : undefined;
}

/** سبب التخطّي إن لم توجد قاعدة، أو `false` إن وُجدت (شكل خيار `skip` في node:test). */
export const skipWithoutDatabase = databaseUrl()
  ? false
  : 'DATABASE_URL غير معلَنة — شغّل: docker compose up -d ثم أعلن الوصلة.';

/**
 * أنشئ قاعدة معزولة وأعِد مجمّعاً موصولاً بها ودالة إسقاط.
 * @param {string} label وسم قصير يظهر في اسم القاعدة فيُعرف صاحبها عند التقصّي.
 * @returns {Promise<{ pool: import('pg').Pool, name: string, drop: () => Promise<void> }>}
 */
export async function createIsolatedDatabase(label) {
  const url = databaseUrl();
  if (url === undefined) throw new Error('DATABASE_URL غير معلَنة.');
  const safeLabel = label.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'test';
  const name = `state_test_${safeLabel}_${crypto.randomBytes(4).toString('hex')}`.toLowerCase();

  const admin = new pg.Pool({ connectionString: url, max: 1 });
  // اسم القاعدة مولَّد هنا ومقصور على حروف وأرقام وشرطة سفلية، ولا يأتي من
  // مُدخل خارجي؛ ومع ذلك يُقتبس بـ`quote_ident` فلا يُبنى نصٌّ بلا اقتباس.
  await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  await admin.end();

  const target = new URL(url);
  target.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: target.toString(), max: 4 });
  // إسقاط القاعدة بـ`FORCE` يقطع أي اتصال ساكن بقي، وخطأ الاتصال الساكن في `pg`
  // يصير استثناءً غير ملتقط يُفشل ملف الاختبار بعد نجاحه. فيُلتقط هنا ويُلازم
  // موضعه: لا يُكتم خطأ استعلام، وإنما خطأ مجمّع في مرحلة التنظيف.
  pool.on('error', (error) => {
    console.warn(`[تنبيه] اتصال ساكن انقطع في ${name}: ${error.message}`);
  });

  return {
    pool,
    name,
    drop: async () => {
      // اختبار إعادة التشغيل يقطع المجمّع بنفسه (فذلك جزء من المحاكاة)، و`pg`
      // يرفع «Called end on pool more than once». فالإقفال هنا يُبتلع خطؤه
      // **وحده**: التنظيف لا يُفشل اختباراً نجح، وإسقاط القاعدة يبقى قاطعاً.
      await pool.end().catch(() => undefined);
      const cleaner = new pg.Pool({ connectionString: url, max: 1 });
      try {
        await cleaner.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}

/**
 * اقتباس معرّف بأسلوب PostgreSQL.
 * @param {string} identifier
 * @returns {string}
 */
export function quoteIdent(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// صورةُ الكتالوجِ تعيشُ في `src/persistence/catalog.mjs` منذ برهانِ الانعكاس
// (`WL-109`): الاختبارُ والأداةُ يقيسانِ بالمسطرةِ نفسِها، لا بنسختَينِ منها.
// وتُصدَّرُ من هنا كذلك حفاظاً على مواضعِ الاستيرادِ القائمةِ في الاختبارات.
export { catalogSnapshot } from '../../src/persistence/catalog.mjs';

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ‏`LIVE-78` — نموذجٌ أوّليٌّ مختبريٌّ (‏الاتّجاهُ «ج»+«هـ» بقرارِ المالك، مرحلةُ النموذجِ والقياسِ وحدَها)
//
// **ليس مسارَ إنتاج.** يعيشُ تحتَ `tests/` عمداً: لا يستوردُه `scripts/` ولا `src/`، فلا يصيرُ مسارَ
// الاستعادةِ الإنتاجيَّ (‏`scripts/restore.mjs`) بلا تفويضِ تنفيذٍ مستقلّ؛ وفي هذا الملفِّ لا في ملفٍّ
// جديدٍ لأنّ G1 ثابتٌ عندَ 3220.
//
// (‏ج) الاستعادةُ كلُّها معاملةٌ واحدة: `psql --single-transaction -v ON_ERROR_STOP=1` يقرأُ من stdin
//      ‏[تمهيدٌ: فحصُ السياجِ وحجزُ اسمِه والمحو] ثمّ [`pg_restore -f -`] ثمّ [نقلُ الدفترِ والتحقّقُ من
//      البصمة] — فلا `COMMIT` إلا بعدَ نجاحِ التحقّق، وأيُّ فشلٍ قبلَه يُبقي الهدفَ كما كان.
// (‏هـ) بصمةُ محتوى (‏`live78DigestBlock`) تُحسَبُ في المصدرِ **داخلَ لقطةِ `pg_dump` نفسِها**، وفي الهدفِ
//      **داخلَ معاملةِ الاستعادةِ قبلَ `COMMIT`** — لا عدُّ صفوف.
// ونتيجةُ `COMMIT` بعدَ انقطاعٍ تُحسَمُ بـ`pg_xact_status(xid)` لا تُفترَض.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * كتلةُ البصمة: `DO` بلا DDL (‏لا دالّةَ تُنشأ فلا يلتقطُها قادحُ `fence.ddl_audit`) — `live78DigestBlock(schemas, ledger, tail)`.
 * **ما تغطّيه:** لكلِّ مخطّطٍ مسمّى — الجداولُ (‏النوع، الدوام، RLS) والأعمدةُ بترتيبِها (‏النوع، NOT NULL،
 * الافتراضيّ، الهويّة، التوليد، الترتيب)، والقيودُ (‏`pg_get_constraintdef`)، والفهارسُ (‏`pg_get_indexdef`)،
 * والقوادحُ غيرُ الداخليّة وحالتُها، والسياساتُ، والمتسلسلاتُ بقيمِها، والعروضُ، والدوالُّ، والأنواع؛ ولكلِّ
 * جدولٍ عاديٍّ أو مقسَّمٍ عددُ صفوفِه وبصمةُ multiset لنصِّ صفوفِه (‏sha256 لكلِّ صفّ، مرتّبة، مُجمَّعةً في
 * دلاءٍ بـ65536 فلا نصَّ بحجمِ الجدول)، ولدفترِ الهجراتِ صفوفُه بأعمدتِه الخمسة.
 * **ما لا تغطّيه (‏معلن):** المالكون والصلاحيّات (‏الاستعادةُ `--no-owner --no-privileges` أصلاً)، والتعليقات
 * والوسومُ الأمنيّة، والكائناتُ الكبيرة، والإحصاءات، وبنيةُ جدولِ الدفترِ (‏المرحليُّ يُعادُ تسميتُه)، وكلُّ ما
 * خارجَ المخطّطاتِ المسمّاة. **وليست توقيعاً:** البيانُ غيرُ موقَّع، فمن يكتبُ الملفَّ والبيانَ معاً يُزوِّرُهما.
 * الإعداداتُ التي تغيّرُ نصَّ القيمِ مثبَّتةٌ محلّيّاً في المعاملة (‏المنطقةُ الزمنيّة، DateStyle، IntervalStyle،
 * extra_float_digits، bytea_output، lc_monetary، search_path فارغ ⇒ أسماءٌ مؤهَّلةٌ في التعريفات).
 */
const LIVE78_DIGEST_BODY = String.raw`
DECLARE
  result jsonb;
  r record; tables jsonb := '{}'::jsonb; seqs jsonb := '{}'::jsonb; t jsonb; structure text;
  q text; led jsonb := NULL; seqv text; structure_text text;
BEGIN
  -- الإعداداتُ المثبَّتةُ محلّيّةٌ للمعاملة (‏is_local): لا تتسرّبُ بعدَها.
  PERFORM pg_catalog.set_config('search_path', '', true);
  PERFORM pg_catalog.set_config('TimeZone', 'UTC', true);
  PERFORM pg_catalog.set_config('DateStyle', 'ISO, YMD', true);
  PERFORM pg_catalog.set_config('IntervalStyle', 'postgres', true);
  PERFORM pg_catalog.set_config('extra_float_digits', '1', true);
  PERFORM pg_catalog.set_config('bytea_output', 'hex', true);
  PERFORM pg_catalog.set_config('lc_monetary', 'C', true);
  -- البنية: أسطرٌ نصّيّةٌ مرتّبةٌ بترتيبِ C ثمّ sha256 واحدة.
  SELECT encode(sha256(convert_to(coalesce(string_agg(l, E'\n' ORDER BY l COLLATE "C"), ''), 'UTF8')), 'hex'),
         coalesce(string_agg(l, E'\n' ORDER BY l COLLATE "C"), '')
  INTO structure, structure_text FROM (
    SELECT format('rel|%s|%s|%s|%s|%s|%s', n.nspname, c.relname, c.relkind, c.relpersistence,
                  c.relrowsecurity, c.relforcerowsecurity) AS l
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r','p','v','m','S','f')
       AND c.relname !~ '^__backup_schema_migrations_'
    UNION ALL
    SELECT format('col|%s|%s|%s|%s|%s|%s|%s|%s|%s', n.nspname, c.relname,
                  lpad((row_number() OVER (PARTITION BY c.oid ORDER BY a.attnum))::text, 5, '0'),
                  a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
                  coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''),
                  a.attidentity::text || a.attgenerated::text, coalesce(co.collname, ''))
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      LEFT JOIN pg_catalog.pg_collation co ON co.oid = a.attcollation AND a.attcollation <> 0
     WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0
       AND NOT a.attisdropped AND c.relname !~ '^__backup_schema_migrations_'
    UNION ALL
    SELECT format('con|%s|%s|%s|%s', n.nspname, c.relname, k.conname, pg_catalog.pg_get_constraintdef(k.oid, true))
      FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relname !~ '^__backup_schema_migrations_'
    UNION ALL
    SELECT format('idx|%s|%s', n.nspname, pg_catalog.pg_get_indexdef(i.indexrelid))
      FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relname !~ '^__backup_schema_migrations_'
    UNION ALL
    SELECT format('trg|%s|%s|%s', n.nspname, tg.tgenabled, pg_catalog.pg_get_triggerdef(tg.oid, true))
      FROM pg_catalog.pg_trigger tg JOIN pg_catalog.pg_class c ON c.oid = tg.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND NOT tg.tgisinternal
       AND c.relname !~ '^__backup_schema_migrations_'
    UNION ALL
    SELECT format('pol|%s|%s|%s|%s|%s|%s|%s', p.schemaname, p.tablename, p.policyname, p.permissive,
                  p.cmd, coalesce(p.qual, ''), coalesce(p.with_check, ''))
      FROM pg_catalog.pg_policies p WHERE p.schemaname = ANY (schemas)
       AND p.tablename !~ '^__backup_schema_migrations_'
    UNION ALL
    SELECT format('view|%s|%s|%s', n.nspname, c.relname, pg_catalog.pg_get_viewdef(c.oid, true))
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relkind IN ('v','m')
    UNION ALL
    SELECT format('fn|%s|%s', n.nspname, pg_catalog.pg_get_functiondef(p.oid))
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ANY (schemas) AND p.prokind IN ('f','p','w')
    UNION ALL
    SELECT format('type|%s|%s|%s|%s', n.nspname, ty.typname, ty.typtype,
                  coalesce((SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
                              FROM pg_catalog.pg_enum e WHERE e.enumtypid = ty.oid), ''))
      FROM pg_catalog.pg_type ty JOIN pg_catalog.pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = ANY (schemas) AND ty.typtype IN ('e','d','c')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = ty.typrelid AND c.relkind <> 'c')
  ) lines;

  -- تشخيص: بنصِّ البنيةِ كاملاً حين يُطلَبُ صراحةً (‏SET xuux.l78_debug = on)، لتحديدِ سطرِ الفرق.
  IF pg_catalog.current_setting('xuux.l78_debug', true) = 'on' THEN
    RAISE WARNING 'XUUX_L78_STRUCTURE=%', structure_text;
  END IF;

  -- المتسلسلات: التعريفُ وآخرُ قيمة.
  FOR r IN SELECT s.schemaname, s.sequencename FROM pg_catalog.pg_sequences s
            WHERE s.schemaname = ANY (schemas) ORDER BY 1, 2 LOOP
    EXECUTE format('SELECT format(''%%s|%%s'', last_value, is_called) FROM %I.%I', r.schemaname, r.sequencename)
      INTO seqv;
    seqs := seqs || jsonb_build_object(r.schemaname || '.' || r.sequencename, seqv);
  END LOOP;

  -- المحتوى: لكلِّ جدولٍ عاديٍّ أو مقسَّمٍ عددٌ وبصمةُ multiset بدلاءٍ محدودة.
  FOR r IN SELECT n.nspname, c.relname FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r','p') AND NOT c.relispartition
              AND c.relname !~ '^__backup_schema_migrations_' ORDER BY 1, 2 LOOP
    q := format($q$
      SELECT jsonb_build_object('rows', coalesce(sum(n), 0)::bigint,
               'sha256', encode(sha256(convert_to(coalesce(string_agg(b, '' ORDER BY k), ''), 'UTF8')), 'hex'))
        FROM (SELECT k, count(*) AS n,
                     encode(sha256(convert_to(string_agg(h, '' ORDER BY h COLLATE "C"), 'UTF8')), 'hex') AS b
                FROM (SELECT h, (row_number() OVER (ORDER BY h COLLATE "C") - 1) / 65536 AS k
                        FROM (SELECT encode(sha256(convert_to(t::text, 'UTF8')), 'hex') AS h FROM %I.%I t) s0) s1
               GROUP BY k) s2 $q$, r.nspname, r.relname);
    EXECUTE q INTO t;
    tables := tables || jsonb_build_object(r.nspname || '.' || r.relname, t);
  END LOOP;

  IF ledger IS NOT NULL THEN
    EXECUTE format($q$
      SELECT jsonb_build_object('rows', count(*)::bigint,
               'sha256', encode(sha256(convert_to(coalesce(string_agg(
                  format('%%s|%%s|%%s|%%s|%%s', version, name, checksum, applied_at, applied_by),
                  E'\n' ORDER BY version), ''), 'UTF8')), 'hex'))
        FROM %s $q$, ledger) INTO led;
  END IF;

  result := jsonb_build_object('spec', 'xuux-l78-digest/v1', 'schemas', to_jsonb(schemas),
                            'structure', structure, 'sequences', seqs, 'tables', tables, 'ledger', led);
  @@TAIL@@
END`;

/**
 * كتلةُ `DO` تحسبُ البصمةَ ثمّ تنفّذُ `tail` على المتغيّرِ `result`. **لا DDL**: لا دالّةَ تُنشأ —
 * فلا يلتقطُها قادحُ الأحداثِ في قاعدةٍ مسيَّجة (‏`fence.ddl_audit`)، ولا تغيّرُ لقطةَ المصدر.
 * @param {string[]} schemas
 * @param {string | null} ledger
 * @param {string} tail
 */
export function live78DigestBlock(schemas, ledger, tail) {
  const lit = (/** @type {string} */ v) => `'${v.replace(/'/g, "''")}'`;
  const decl = `DECLARE schemas text[] := ARRAY[${schemas.map(lit).join(',')}]::text[];
  ledger text := ${ledger === null ? 'NULL' : lit(ledger)};\n`;
  return `DO $l78$ ${decl}${LIVE78_DIGEST_BODY.replace('DECLARE\n', '').replace('@@TAIL@@', tail)} $l78$;`;
}

/** ذيلُ المصدر: البصمةُ إلى العميلِ في إشعار. */
export const LIVE78_NOTICE_TAIL = `RAISE NOTICE 'XUUX_L78_DIGEST=%', result::text;`;

/** @param {string} name */
const l78Ident = (name) => `"${name.replace(/"/g, '""')}"`;

/**
 * ‏`LIVE-78` (‏هـ): نسخةٌ نموذجيّة — كـ`createBackup` في `scripts/backup.mjs` (‏دفترٌ مرحليٌّ، لقطةُ
 * REPEATABLE READ مُصدَّرة، `pg_dump --snapshot`)، وتزيدُ `prototypeDigest` محسوبةً **في اللقطةِ نفسِها**.
 * البيانُ مجموعةٌ أعمّ من بيانِ الإنتاج، فتقرؤه `scripts/restore.mjs` الحاليّةُ أيضاً (‏للمقارنة).
 * @param {string} dumpPath
 * @param {string} url
 * @returns {Promise<Record<string, any>>}
 */
export async function live78PrototypeBackup(dumpPath, url) {
  const { resolveVerifiedDumpTool, manifestPathFor } = await import('../../scripts/backup.mjs');
  const fs = await import('node:fs');
  const { spawn } = await import('node:child_process');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const staging = `__backup_schema_migrations_${crypto.randomBytes(6).toString('hex')}`;
  let staged = false;
  try {
    const version = String((await client.query('SHOW server_version')).rows[0].server_version);
    const dumpTool = await resolveVerifiedDumpTool(version);
    await client.query('BEGIN');
    await client.query(
      `CREATE TABLE state.${l78Ident(staging)} (LIKE public.schema_migrations INCLUDING ALL)`,
    );
    await client.query(
      `INSERT INTO state.${l78Ident(staging)} SELECT * FROM public.schema_migrations`,
    );
    await client.query('COMMIT');
    staged = true;
    const started = process.hrtime.bigint();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const snapshotId = String((await client.query('SELECT pg_export_snapshot() AS s')).rows[0].s);
    const diff = await client.query(
      `SELECT (SELECT count(*) FROM (TABLE public.schema_migrations EXCEPT ALL TABLE state.${l78Ident(staging)}) a)
            + (SELECT count(*) FROM (TABLE state.${l78Ident(staging)} EXCEPT ALL TABLE public.schema_migrations) b) AS n`,
    );
    if (Number(diff.rows[0].n) !== 0) throw new Error('LIVE78_LEDGER_SNAPSHOT_MISMATCH');
    const fenced = (await client.query(`SELECT to_regnamespace('fence') IS NOT NULL AS f`)).rows[0]
      .f;
    const schemas = fenced ? ['state', 'fence'] : ['state'];
    const digestStarted = process.hrtime.bigint();
    /** @type {any} */
    let prototypeDigest = null;
    const onNotice = (/** @type {any} */ n) => {
      const m = /^XUUX_L78_DIGEST=(.*)$/s.exec(String(n.message));
      if (m) prototypeDigest = JSON.parse(String(m[1]));
    };
    client.on('notice', onNotice);
    if (process.env.XUUX_L78_DEBUG === '1') {
      client.on('notice', (n) => {
        if (String(n.message).startsWith('XUUX_L78_STRUCTURE='))
          process.stderr.write(`SRC ${n.message}\n`);
      });
      await client.query(`SET LOCAL xuux.l78_debug = 'on'`);
    }
    await client.query(live78DigestBlock(schemas, 'public.schema_migrations', LIVE78_NOTICE_TAIL));
    client.off('notice', onNotice);
    if (prototypeDigest === null) throw new Error('LIVE78_DIGEST_NOT_RECEIVED');
    const digestMs = Number((process.hrtime.bigint() - digestStarted) / 1_000_000n);
    /** @type {Record<string, number>} */
    const rowCounts = {};
    for (const [name, v] of Object.entries(prototypeDigest.tables)) {
      if (name.startsWith('state.')) rowCounts[name.slice(6)] = Number(/** @type {any} */ (v).rows);
    }
    const migrationVersion = Number(
      (
        await client.query(
          'SELECT COALESCE(max(version),0)::int AS v FROM public.schema_migrations',
        )
      ).rows[0].v,
    );
    const args = ['--format=custom', '--file', dumpPath, '--no-owner', '--no-privileges'];
    for (const s of schemas) args.push('--schema', s);
    args.push('--snapshot', snapshotId, url);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(dumpTool, args, { stdio: ['ignore', 'ignore', 'inherit'] });
      child.on('error', reject);
      child.on('close', resolve);
    });
    if (code !== 0) throw new Error(`LIVE78_PG_DUMP_FAILED ${code}`);
    await client.query('ROLLBACK');
    const manifest = {
      startedAt: new Date().toISOString(),
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      databaseVersion: version,
      migrationVersion,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(dumpPath)).digest('hex'),
      rowCounts,
      dumpFile: dumpPath.split('/').pop(),
      ledgerStagingTable: staging,
      prototypeDigest,
      digestMs,
    };
    fs.writeFileSync(manifestPathFor(dumpPath), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    if (staged)
      await client.query(`DROP TABLE IF EXISTS state.${l78Ident(staging)}`).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

/** رموزُ نتائجِ النموذج. */
export const LIVE78_OUTCOMES = Object.freeze({
  OK: 'L78_RESTORE_OK',
  REFUSED_FENCED: 'L78_RESTORE_TARGET_FENCED',
  CONTENT_MISMATCH: 'L78_RESTORE_CONTENT_MISMATCH',
  ROLLED_BACK: 'L78_RESTORE_ROLLED_BACK',
  COMMIT_CONFIRMED: 'L78_RESTORE_COMMIT_CONFIRMED_AFTER_DISCONNECT',
  OUTCOME_UNKNOWN: 'L78_RESTORE_OUTCOME_UNKNOWN',
});

/**
 * ‏`LIVE-78` (‏ج)+(‏هـ): الاستعادةُ النموذجيّة في معاملةٍ واحدة. لا تمسُّ `scripts/restore.mjs`، وتستوردُ
 * منه ومن `backup.mjs` دوالَّ التحقّقِ المُصدَّرةَ وحدَها.
 * @param {{ dumpPath: string, database: string, url: string, force?: boolean,
 *           connectUrl?: string, lockTimeoutMs?: number, settleMs?: number,
 *           onBackend?: (pid: number) => void,
 *           onChild?: (child: import('node:child_process').ChildProcess) => void }} o
 *   ‏`connectUrl` وصلةُ psql (‏وسيطُ أعطابٍ في الاختبار)؛ و`url` وصلةُ الحسمِ والإدارة.
 * @returns {Promise<{ outcome: string, xid: string | null, xactStatus: string | null,
 *                     durationMs: number, stderr: string, digest?: any }>}
 */
export async function live78PrototypeRestore(o) {
  const { verifyBackup } = await import('../../scripts/backup.mjs');
  const { resolveVerifiedRestoreTool } = await import('../../scripts/restore.mjs');
  const { resolvePgTool, readToolVersion, assertClientNotOlder } =
    await import('../../scripts/lib/pg-tools.mjs');
  const { spawn } = await import('node:child_process');
  const manifest = /** @type {any} */ (await verifyBackup(o.dumpPath));
  if (!manifest.prototypeDigest) throw new Error('LIVE78_MANIFEST_WITHOUT_DIGEST');
  const restoreTool = await resolveVerifiedRestoreTool(manifest.databaseVersion);
  const psql = resolvePgTool('psql');
  assertClientNotOlder({
    toolPath: psql,
    clientVersion: await readToolVersion(psql),
    serverVersion: manifest.databaseVersion,
  });
  const adminUrl = new URL(o.url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [o.database]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${l78Ident(o.database)}`);
  } finally {
    await admin.end();
  }
  const target = new URL(o.url);
  target.pathname = `/${o.database}`;
  const psqlTarget = new URL(o.connectUrl ?? o.url);
  psqlTarget.pathname = `/${o.database}`;
  psqlTarget.searchParams.set('application_name', 'xuux-l78-restore');
  const schemas = /** @type {string[]} */ (manifest.prototypeDigest.schemas);
  const dumpHasFence = schemas.includes('fence');
  const expected = JSON.stringify(manifest.prototypeDigest).replace(/'/g, "''");
  const staging = l78Ident(manifest.ledgerStagingTable);
  const preamble = [
    `SET lock_timeout = ${Number(o.lockTimeoutMs ?? 0)};`,
    ...(process.env.XUUX_L78_DEBUG === '1' ? [`SET xuux.l78_debug = 'on';`] : []),
    `SELECT 'XUUX_L78_XID=' || pg_current_xact_id() || '|' || pg_backend_pid();`,
    // نفسُ قاعدةِ `refuseFencedTarget` في الإنتاج، داخلَ المعاملة.
    `DO $l78$ DECLARE fenced boolean; BEGIN
       IF to_regnamespace('fence') IS NOT NULL THEN RAISE EXCEPTION 'L78_RESTORE_TARGET_FENCED: fence schema'; END IF;
       IF EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtname LIKE 'xf\\_%') THEN
         RAISE EXCEPTION 'L78_RESTORE_TARGET_FENCED: xf_* event trigger'; END IF;
       IF to_regclass('public.schema_migrations') IS NOT NULL THEN
         EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version >= 24)' INTO fenced;
         IF fenced THEN RAISE EXCEPTION 'L78_RESTORE_TARGET_FENCED: ledger >= 24'; END IF;
       END IF;
       IF ${o.force ? 'false' : 'true'} AND (to_regnamespace('state') IS NOT NULL
          OR to_regclass('public.schema_migrations') IS NOT NULL) THEN
         RAISE EXCEPTION 'L78_RESTORE_TARGET_NOT_CLEAN'; END IF;
     END $l78$;`,
    // حجزُ الاسم: إنشاءٌ متزامنٌ لـ`fence` ينتظرُ هذه المعاملةَ حتى نهايتِها.
    `CREATE SCHEMA fence;`,
    `DROP SCHEMA IF EXISTS state CASCADE;`,
    `DROP TABLE IF EXISTS public.schema_migrations;`,
    ...(dumpHasFence ? [`DROP SCHEMA fence RESTRICT;`] : []),
    `SELECT 'XUUX_L78_RESTORE_BEGIN';`,
  ].join('\n');
  const epilogue = [
    `\\unset ECHO`,
    `SELECT pg_catalog.set_config('search_path', 'public', false);`,
    ...(dumpHasFence ? [] : [`DROP SCHEMA fence RESTRICT;`]),
    `ALTER TABLE state.${staging} SET SCHEMA public;`,
    `ALTER TABLE public.${staging} RENAME TO schema_migrations;`,
    live78DigestBlock(
      schemas,
      'public.schema_migrations',
      `DECLARE want jsonb := '${expected}'::jsonb; got jsonb := result;
       BEGIN
         IF got IS DISTINCT FROM want THEN
           RAISE EXCEPTION 'L78_RESTORE_CONTENT_MISMATCH: keys=% tables=% sequences=%',
             (SELECT jsonb_agg(k) FROM jsonb_object_keys(want || got) k WHERE want->k IS DISTINCT FROM got->k),
             (SELECT jsonb_agg(k) FROM jsonb_object_keys((want->'tables') || (got->'tables')) k
               WHERE want->'tables'->k IS DISTINCT FROM got->'tables'->k),
             (SELECT jsonb_object_agg(k, jsonb_build_array(want->'sequences'->k, got->'sequences'->k))
                FROM jsonb_object_keys((want->'sequences') || (got->'sequences')) k
               WHERE want->'sequences'->k IS DISTINCT FROM got->'sequences'->k);
         END IF;
       END;`,
    ),
    `SELECT 'XUUX_L78_VERIFIED';`,
    '',
  ].join('\n');

  const started = process.hrtime.bigint();
  const psqlChild = spawn(
    psql,
    [
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '--single-transaction',
      '-d',
      psqlTarget.toString(),
      '-f',
      '-',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  o.onChild?.(psqlChild);
  let stdout = '';
  let stderr = '';
  psqlChild.stdout.setEncoding('utf8');
  psqlChild.stderr.setEncoding('utf8');
  let pid = 0;
  psqlChild.stdout.on('data', (c) => {
    stdout += c;
    const m = /XUUX_L78_XID=\d+\|(\d+)/.exec(stdout);
    if (m && pid === 0) {
      pid = Number(m[1]);
      o.onBackend?.(pid);
    }
  });
  psqlChild.stderr.on('data', (c) => (stderr += c));
  psqlChild.stdin.on('error', () => undefined);
  // ‏psql إن خرجَ مبكّراً (‏رفضٌ في التمهيد، انقطاع) فلا قارئَ لـ`pg_restore`: يُقتَلُ كي لا يعلقَ على الأنبوب.
  /** @type {import('node:child_process').ChildProcess | null} */
  let dumperRef = null;
  // ‏وإذا انغلقَ مدخلُ psql انفصلَ الأنبوبُ وبقيَ خرجُ `pg_restore` موقوفاً ببقيّةٍ لا تُقرأ، فلا يُطلَقُ `close`
  // ويفرغُ حلقُ الأحداثِ والوعدُ معلّق (‏مقيس: 4/6 تشغيلاتٍ برفضِ التمهيد، وفي CI). البقيّةُ تُصرَفُ إلى لا شيء.
  const discardDumper = () => {
    dumperRef?.stdout?.unpipe();
    dumperRef?.stdout?.resume();
  };
  psqlChild.stdin.on('close', discardDumper);
  const exited = new Promise((resolve) =>
    psqlChild.on('close', (code) => {
      discardDumper();
      dumperRef?.kill('SIGKILL');
      resolve(code ?? 1);
    }),
  );
  psqlChild.stdin.write(`${preamble}\n`);
  const dumper = spawn(restoreTool, ['--no-owner', '--no-privileges', '-f', '-', o.dumpPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  dumperRef = dumper;
  dumper.stderr.on('data', (c) => (stderr += c));
  dumper.stdout.pipe(psqlChild.stdin, { end: false });
  if (psqlChild.stdin.destroyed) discardDumper();
  const dumped = await new Promise((resolve) => dumper.on('close', (code) => resolve(code ?? 1)));
  if (psqlChild.exitCode !== null || psqlChild.stdin.destroyed) {
    // لا شيء: psql خرج.
  } else if (dumped === 0) psqlChild.stdin.end(epilogue);
  else psqlChild.stdin.end(`\\echo L78_PG_RESTORE_FAILED\nSELECT 1/0;\n`);
  const code = await exited;
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const xidMatch = /XUUX_L78_XID=(\d+)/.exec(stdout);
  const xid = xidMatch?.[1] ?? null;
  if (code === 0 && stdout.includes('XUUX_L78_VERIFIED')) {
    return { outcome: LIVE78_OUTCOMES.OK, xid, xactStatus: 'committed', durationMs, stderr };
  }
  // الحسم: ما الذي التزمَه الخادمُ فعلاً؟ لا افتراض.
  let xactStatus = null;
  if (xid !== null) {
    const probe = new pg.Client({ connectionString: target.toString() });
    await probe.connect();
    try {
      const deadline = Date.now() + (o.settleMs ?? 10_000);
      for (;;) {
        xactStatus = (await probe.query('SELECT pg_xact_status($1::xid8) AS s', [xid])).rows[0].s;
        if (xactStatus !== 'in progress' || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      await probe.end();
    }
  }
  /** @type {string} */
  let outcome;
  if (xactStatus === 'committed') outcome = LIVE78_OUTCOMES.COMMIT_CONFIRMED;
  else if (xid === null || xactStatus === 'aborted') {
    if (/L78_RESTORE_TARGET_FENCED|L78_RESTORE_TARGET_NOT_CLEAN/.test(stderr))
      outcome = LIVE78_OUTCOMES.REFUSED_FENCED;
    else if (/L78_RESTORE_CONTENT_MISMATCH/.test(stderr))
      outcome = LIVE78_OUTCOMES.CONTENT_MISMATCH;
    else outcome = LIVE78_OUTCOMES.ROLLED_BACK;
  } else outcome = LIVE78_OUTCOMES.OUTCOME_UNKNOWN;
  return { outcome, xid, xactStatus, durationMs, stderr };
}

// ─── ‏`LIVE-78`: قياسٌ متدرّج (‏مختبريّ؛ يُشغَّلُ يدويّاً، لا في الحزمة) ───────────────────────────────
//
// ‏`DATABASE_URL=… node tests/helpers/pg.mjs live78-bench --tables 10 --rows 100000 [--payload 100]
//   [--modes prod,proto,force,kill,writer] [--label M] [--out /tmp/l78/results.jsonl]`
// يُنشئُ مصدراً مُهاجَراً إلى 23 (‏قبلَ السياج) وجداولَ اصطناعيّةً في `state`، ثمّ يقيسُ لكلِّ نمط: الزمن،
// وWAL (‏فرقُ `pg_current_wal_lsn`)، وأقصى عددِ أقفالِ خلفيّاتِ الاستعادة وأقصى عمرِ معاملتِها، وزمنَ انتظارِ
// قارئٍ متزامنٍ وما رآه، وأثرَ أفقِ التنظيف (‏VACUUM VERBOSE على جدولٍ جانبيٍّ في الهدفِ وفي قاعدةٍ أخرى).
// النتائجُ الخامُ إلى `--out` خارجَ المستودع؛ والملخّصُ في `docs/RECOVERY.md`.

/** @param {string} base @param {string} name @param {{user?: string, password?: string}} [as] */
function l78DbUrl(base, name, as = {}) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  if (as.user) url.username = as.user;
  if (as.password) url.password = as.password;
  return url.toString();
}

/**
 * @param {string} base
 * @param {{ tables: number, rows: number, payload: number, modes: string[], label: string, out: string }} o
 */
export async function live78Bench(base, o) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { up } = await import('../../src/persistence/migrator.mjs');
  const { createBackup } = await import('../../scripts/backup.mjs');
  const { restoreBackup } = await import('../../scripts/restore.mjs');
  const tag = crypto.randomBytes(3).toString('hex');
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const created = /** @type {string[]} */ ([]);
  const mkdb = async (/** @type {string} */ n, owner = '') => {
    await admin.query(`CREATE DATABASE ${l78Ident(n)}${owner ? ` OWNER ${l78Ident(owner)}` : ''}`);
    created.push(n);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l78-bench-'));
  const results = /** @type {any[]} */ ([]);
  const emit = (/** @type {any} */ r) => {
    const row = { label: o.label, tables: o.tables, rows: o.rows, payload: o.payload, ...r };
    results.push(row);
    fs.appendFileSync(o.out, `${JSON.stringify(row)}\n`);
    process.stderr.write(`${JSON.stringify(row)}\n`);
  };
  const walLsn = async () =>
    String((await admin.query('SELECT pg_current_wal_lsn() AS l')).rows[0].l);
  const walDiff = async (/** @type {string} */ a) =>
    Number(
      (await admin.query('SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1)::bigint AS d', [a]))
        .rows[0].d,
    );
  const other = `l78b_other_${tag}`;
  try {
    // ‏١) المصدر.
    const src = `l78b_src_${tag}`;
    await mkdb(src);
    await mkdb(other);
    const srcPool = new pg.Pool({ connectionString: l78DbUrl(base, src), max: 2 });
    const t0 = Date.now();
    await up(srcPool, { to: 23 });
    for (let i = 0; i < o.tables; i += 1) {
      await srcPool.query(`CREATE TABLE state.l78_bench_${i} (id bigint PRIMARY KEY, k integer NOT NULL,
        payload text NOT NULL, at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z')`);
      await srcPool.query(`CREATE INDEX ON state.l78_bench_${i} (k)`);
      if (o.rows > 0) {
        await srcPool.query(`INSERT INTO state.l78_bench_${i} (id, k, payload)
          SELECT g, g % 1000, repeat(md5(g::text), ${Math.max(1, Math.ceil(o.payload / 32))})::text
            FROM generate_series(1, ${o.rows}) g`);
      }
    }
    await srcPool.query('ANALYZE');
    const size = Number(
      (await srcPool.query('SELECT pg_database_size(current_database()) AS s')).rows[0].s,
    );
    await srcPool.end();
    emit({ phase: 'source', seedMs: Date.now() - t0, sourceBytes: size });

    // ‏٢) النسخ: الإنتاجُ مقابلَ النموذج (‏النموذجُ = الإنتاجُ + بصمةٌ في اللقطةِ نفسِها).
    const dumpProd = path.join(dir, 'prod.dump');
    const w = await walLsn();
    let t = Date.now();
    await createBackup(dumpProd, l78DbUrl(base, src));
    emit({
      phase: 'backup',
      mode: 'prod',
      ms: Date.now() - t,
      dumpBytes: fs.statSync(dumpProd).size,
    });
    const dump = path.join(dir, 'proto.dump');
    t = Date.now();
    const manifest = await live78PrototypeBackup(dump, l78DbUrl(base, src));
    emit({
      phase: 'backup',
      mode: 'proto',
      ms: Date.now() - t,
      digestMs: manifest.digestMs,
      dumpBytes: fs.statSync(dump).size,
      walBytes: await walDiff(w),
    });

    /**
     * يقيسُ استعادةً واحدة: أقفال/عمرُ معاملة/قارئ/أفقُ تنظيف/WAL.
     * @param {string} mode
     * @param {string} target
     * @param {() => Promise<any>} runRestore
     * @param {{ reader?: boolean, vacuum?: boolean, as?: {user?: string, password?: string} }} [opt]
     */
    const measure = async (mode, target, runRestore, opt = {}) => {
      const watch = new pg.Client({ connectionString: l78DbUrl(base, target) });
      await watch.connect();
      const watchPid = Number((await watch.query('SELECT pg_backend_pid() AS p')).rows[0].p);
      const ignore = [watchPid];
      /** @type {pg.Client | null} */
      let reader = null;
      if (opt.reader) {
        reader = new pg.Client({ connectionString: l78DbUrl(base, target) });
        await reader.connect();
        ignore.push(Number((await reader.query('SELECT pg_backend_pid() AS p')).rows[0].p));
      }
      const side = new pg.Client({ connectionString: l78DbUrl(base, target) });
      await side.connect();
      ignore.push(Number((await side.query('SELECT pg_backend_pid() AS p')).rows[0].p));
      const otherC = new pg.Client({ connectionString: l78DbUrl(base, other) });
      await otherC.connect();
      if (opt.vacuum) {
        for (const c of [side, otherC]) {
          await c.query(
            'CREATE TABLE IF NOT EXISTS public.l78_side (id int PRIMARY KEY, v int NOT NULL)',
          );
          await c.query('TRUNCATE public.l78_side');
          await c.query('INSERT INTO public.l78_side SELECT g, 0 FROM generate_series(1, 1000) g');
          await c.query('VACUUM public.l78_side');
        }
      }
      let done = false;
      const stats = {
        maxLocks: 0,
        maxAccessExclusive: 0,
        maxXactAgeMs: 0,
        samples: 0,
        /** @type {Record<string, number>} */ watchErrors: {},
      };
      const sampler = (async () => {
        while (!done) {
          // ‏أخطاءُ جلسةِ المراقبةِ نفسِها دليلٌ (‏مثلاً 53200 حين يستنفدُ الاسترجاعُ جدولَ الأقفالِ المشترك) — تُعَدُّ ولا تُسقِطُ القياس.
          const r = await watch
            .query(
              `SELECT coalesce(max(n), 0)::int AS n, coalesce(max(ae), 0)::int AS ae, coalesce(max(age), 0)::float8 AS age FROM (
               SELECT a.pid, count(l.*) AS n, count(l.*) FILTER (WHERE l.mode = 'AccessExclusiveLock') AS ae,
                      extract(epoch FROM now() - a.xact_start) * 1000 AS age
                 FROM pg_stat_activity a LEFT JOIN pg_locks l ON l.pid = a.pid
                WHERE a.datname = current_database() AND a.pid <> ALL ($1::int[]) AND a.backend_type = 'client backend'
                GROUP BY a.pid, a.xact_start) x`,
              [ignore],
            )
            .catch((/** @type {any} */ e) => {
              stats.watchErrors[e?.code ?? 'ERR'] = (stats.watchErrors[e?.code ?? 'ERR'] ?? 0) + 1;
              return null;
            });
          stats.samples += 1;
          if (!r) {
            await new Promise((res) => setTimeout(res, 50));
            continue;
          }
          stats.maxLocks = Math.max(stats.maxLocks, r.rows[0].n);
          stats.maxAccessExclusive = Math.max(stats.maxAccessExclusive, r.rows[0].ae);
          stats.maxXactAgeMs = Math.max(stats.maxXactAgeMs, Math.round(r.rows[0].age));
          await new Promise((res) => setTimeout(res, 50));
        }
      })();
      const readerStats = {
        queries: 0,
        maxLatencyMs: 0,
        errors: /** @type {Record<string, number>} */ ({}),
        observed: /** @type {Record<string, number>} */ ({}),
      };
      const readerLoop = (async () => {
        if (!reader) return;
        while (!done) {
          const s0 = Date.now();
          try {
            const r = await reader.query('SELECT count(*)::bigint AS n FROM state.l78_bench_0');
            const key = String(r.rows[0].n);
            readerStats.observed[key] = (readerStats.observed[key] ?? 0) + 1;
          } catch (error) {
            const code = String(/** @type {any} */ (error).code ?? 'ERR');
            readerStats.errors[code] = (readerStats.errors[code] ?? 0) + 1;
          }
          readerStats.queries += 1;
          readerStats.maxLatencyMs = Math.max(readerStats.maxLatencyMs, Date.now() - s0);
          await new Promise((res) => setTimeout(res, 20));
        }
      })();
      /** @type {any} */
      let vacuum = null;
      const vacuumProbe = (async () => {
        if (!opt.vacuum) return;
        // ينتظرُ حتى تبدأَ معاملةُ الاستعادةِ فعلاً (‏قفلٌ واحدٌ على الأقلّ).
        const deadline = Date.now() + 120_000;
        while (!done && stats.maxLocks === 0 && Date.now() < deadline)
          await new Promise((r) => setTimeout(r, 20));
        if (done) return;
        /** @param {pg.Client} c */
        const probe = async (c) => {
          await c.query('UPDATE public.l78_side SET v = v + 1');
          const notes = /** @type {string[]} */ ([]);
          const onN = (/** @type {any} */ n) => notes.push(String(n.message));
          c.on('notice', onN);
          await c.query('VACUUM (VERBOSE) public.l78_side');
          c.off('notice', onN);
          const m = /(\d+) are dead but not yet removable/.exec(notes.join('\n'));
          return m ? Number(m[1]) : null;
        };
        const sameDb = await probe(side);
        const otherDb = await probe(otherC);
        vacuum = { sameDbNotRemovable: sameDb, otherDbNotRemovable: otherDb, duringRestore: !done };
      })();
      const wal0 = await walLsn();
      const s0 = Date.now();
      /** @type {any} */
      let outcome;
      try {
        outcome = await runRestore();
      } catch (error) {
        outcome = {
          error: String(/** @type {any} */ (error).code ?? ''),
          message: String(/** @type {any} */ (error).message).slice(0, 300),
        };
      }
      const ms = Date.now() - s0;
      done = true;
      await Promise.all([sampler, readerLoop, vacuumProbe]);
      const walBytes = await walDiff(wal0);
      for (const c of [watch, side, otherC, reader]) await c?.end().catch(() => undefined);
      emit({
        phase: 'restore',
        mode,
        ms,
        walBytes,
        ...stats,
        reader: opt.reader ? readerStats : undefined,
        vacuum,
        outcome: outcome?.outcome ?? outcome?.error ?? (outcome ? 'RESTORE_OK' : outcome),
        xactStatus: outcome?.xactStatus,
        detail:
          outcome?.message ??
          (outcome?.outcome && outcome.outcome !== LIVE78_OUTCOMES.OK
            ? String(outcome.stderr ?? '').slice(-400)
            : undefined),
      });
      return outcome;
    };

    // ‏٣) الاستعادات.
    if (o.modes.includes('prod')) {
      const tgt = `l78b_prod_${tag}`;
      await mkdb(tgt);
      await measure(
        'prod-fresh',
        tgt,
        () =>
          restoreBackup(
            { dumpPath: dump, database: tgt, force: false, allowUnverified: true },
            base,
          ),
        { vacuum: true },
      );
    }
    if (o.modes.includes('proto')) {
      const tgt = `l78b_proto_${tag}`;
      await mkdb(tgt);
      await measure(
        'proto-fresh',
        tgt,
        () => live78PrototypeRestore({ dumpPath: dump, database: tgt, url: base }),
        {
          vacuum: true,
        },
      );
    }
    if (o.modes.includes('force')) {
      // هدفٌ مشغولٌ بالمحتوى نفسِه ونصفِ الجدولِ الأوّل ⇒ يرى القارئُ «قديماً» أو «جديداً» أو غيرَهما.
      for (const [mode, run] of /** @type {const} */ ([
        ['prod-force', 'prod'],
        ['proto-force', 'proto'],
      ])) {
        const tgt = `l78b_${run}f_${tag}`;
        await mkdb(tgt);
        await live78PrototypeRestore({ dumpPath: dump, database: tgt, url: base });
        const c = new pg.Client({ connectionString: l78DbUrl(base, tgt) });
        await c.connect();
        await c.query(`DELETE FROM state.l78_bench_0 WHERE id % 2 = 0`);
        await c.end();
        await measure(
          mode,
          tgt,
          () =>
            run === 'prod'
              ? restoreBackup(
                  { dumpPath: dump, database: tgt, force: true, allowUnverified: true },
                  base,
                )
              : live78PrototypeRestore({ dumpPath: dump, database: tgt, url: base, force: true }),
          { reader: true, vacuum: true },
        );
      }
    }
    if (o.modes.includes('kill')) {
      // ‏SIGKILL لـpsql في منتصفِ الاستعادةِ فوقَ هدفٍ مشغول ⇒ المتوقَّع: aborted والهدفُ كما كان.
      const tgt = `l78b_kill_${tag}`;
      await mkdb(tgt);
      await live78PrototypeRestore({ dumpPath: dump, database: tgt, url: base });
      const c = new pg.Client({ connectionString: l78DbUrl(base, tgt) });
      await c.connect();
      await c.query(`DELETE FROM state.l78_bench_0 WHERE id % 2 = 0`);
      const before = (await c.query('SELECT count(*)::bigint AS n FROM state.l78_bench_0')).rows[0]
        .n;
      const proto = results.find((r) => r.mode === 'proto-fresh');
      const killAfter = Math.max(50, Math.round((proto?.ms ?? 1000) / 2));
      const outcome = await measure('proto-kill', tgt, () =>
        live78PrototypeRestore({
          dumpPath: dump,
          database: tgt,
          url: base,
          force: true,
          onBackend: () => undefined,
          onChild: (child) => setTimeout(() => child.kill('SIGKILL'), killAfter),
        }),
      );
      const after = (await c.query('SELECT count(*)::bigint AS n FROM state.l78_bench_0')).rows[0]
        .n;
      await c.end();
      emit({
        phase: 'kill-check',
        killAfterMs: killAfter,
        outcome: outcome?.outcome,
        before,
        after,
        unchanged: before === after,
      });
    }
    if (o.modes.includes('writer')) {
      // دورُ كتابةٍ عاديّ (‏ليس superuser) يملكُ قاعدةَ الهدف.
      const role = `l78_writer_${tag}`;
      const password = crypto.randomBytes(12).toString('hex');
      await admin.query(
        `CREATE ROLE ${l78Ident(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
      );
      // ‏الأداتانِ تتّصلانِ بقاعدةِ الصيانة `postgres` (‏`scripts/restore.mjs` و`adminUrl` هنا)؛ وفي عنقودٍ مرَّ بـ
      // ‏`fence.contain_database_reach` يُسحَبُ CONNECT منها عن PUBLIC — فيُمنَحُ هنا صراحةً للدورِ وحدَه ويُسحَبُ بعد.
      await admin.query(`GRANT CONNECT ON DATABASE postgres TO ${l78Ident(role)}`);
      try {
        const as = { user: role, password };
        for (const run of ['prod', 'proto']) {
          const tgt = `l78b_${run}w_${tag}`;
          await mkdb(tgt, role);
          const asUrl = l78DbUrl(base, 'postgres', as);
          await measure(`${run}-writer`, tgt, () =>
            run === 'prod'
              ? restoreBackup(
                  { dumpPath: dump, database: tgt, force: false, allowUnverified: true },
                  asUrl,
                )
              : live78PrototypeRestore({ dumpPath: dump, database: tgt, url: asUrl }),
          );
          await admin.query(`DROP DATABASE ${l78Ident(tgt)} WITH (FORCE)`);
          created.splice(created.indexOf(tgt), 1);
        }
      } finally {
        await admin
          .query(`REVOKE CONNECT ON DATABASE postgres FROM ${l78Ident(role)}`)
          .catch(() => undefined);
        await admin.query(`DROP ROLE IF EXISTS ${l78Ident(role)}`);
      }
    }
    return results;
  } finally {
    for (const n of created)
      await admin
        .query(`DROP DATABASE IF EXISTS ${l78Ident(n)} WITH (FORCE)`)
        .catch(() => undefined);
    await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (
  process.argv[2] === 'live78-bench' &&
  import.meta.url === (await import('node:url')).pathToFileURL(String(process.argv[1])).href
) {
  const { parseArgs } = await import('node:util');
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      tables: { type: 'string', default: '10' },
      rows: { type: 'string', default: '1000' },
      payload: { type: 'string', default: '100' },
      modes: { type: 'string', default: 'prod,proto,force,kill' },
      label: { type: 'string', default: '' },
      out: { type: 'string', default: '/tmp/l78/results.jsonl' },
    },
  });
  const base = databaseUrl();
  if (base === undefined) throw new Error('DATABASE_URL غير معلَنة.');
  await live78Bench(base, {
    tables: Number(values.tables),
    rows: Number(values.rows),
    payload: Number(values.payload),
    modes: String(values.modes).split(','),
    label: String(values.label || `${values.tables}x${values.rows}`),
    out: String(values.out),
  });
}

// ‏`WL-606` — قياسُ كلفةِ بصمةِ المحتوى: النصّانِ **قبلَ** البصمة (‏`693654d9`) وبعدَها على **البياناتِ نفسِها**.
// ‏`DATABASE_URL=… node tests/helpers/pg.mjs wl606-bench --tables 10 --rows 100000 --reps 2 --out /tmp/wl606/r.jsonl`
// لكلِّ (‏نسخة، استعادةٌ إلى قاعدةٍ جديدة) × (‏قديم، جديد): الزمنُ، ووقتُ المعالجِ للعميلِ وأبنائه (‏`pg_dump`/
// ‏`pg_restore`)، ووقتُ المعالجِ للنظامِ كلِّه (‏`/proc/stat` — يشملُ الخادم؛ جهازٌ مخصَّصٌ للقياس)، وأعلى
// ‏VmHWM لعمليّاتِ الخادمِ الخادمةِ للقاعدةِ المعنيّة، وأعلى RSS للعميل. وزمنُ البصمةِ نفسِها: إنشاءً
// ‏(`contentDigestMs` في البيان) وتحقّقاً (‏من سطرِ `[CONTENT_VERIFIED]`).

/**
 * @param {string} base
 * @param {{ tables: number, rows: number, reps: number, out: string, oldRef: string }} o
 */
export async function wl606Bench(base, o) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync, spawn } = await import('node:child_process');
  const { up } = await import('../../src/persistence/migrator.mjs');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl606-bench-'));
  // نسخةُ النصوصِ القديمة: `scripts/` كلُّها من المرجعِ، و`node_modules` بوصلةٍ رمزيّة.
  for (const ver of ['old', 'new']) {
    fs.mkdirSync(path.join(dir, ver, 'scripts/lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, ver, 'node_modules'));
    fs.writeFileSync(path.join(dir, ver, 'package.json'), '{"type":"module"}');
    for (const f of ['scripts/backup.mjs', 'scripts/restore.mjs', 'scripts/lib/pg-tools.mjs']) {
      const body =
        ver === 'old'
          ? execFileSync('git', ['-C', root, 'show', `${o.oldRef}:${f}`])
          : fs.readFileSync(path.join(root, f));
      fs.writeFileSync(path.join(dir, ver, f), body);
    }
    // غلافٌ يطبعُ استهلاكَ العمليّةِ وأبنائها المنتظَرين (‏`cutime`/`cstime` من `/proc/self/stat`).
    fs.writeFileSync(
      path.join(dir, ver, 'run.mjs'),
      `const [, , script, ...args] = process.argv;
const fs = await import('node:fs');
const mod = await import(new URL('./scripts/' + script, import.meta.url).href);
let code = 0;
try { await mod.main(args, process.env.DATABASE_URL ?? ''); } catch (e) { console.error('ERR ' + (e?.code ?? '') + ' ' + e?.message); code = 1; }
const st = fs.readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ');
const hz = 100;
const ru = process.resourceUsage();
console.log('WL606_RUSAGE ' + JSON.stringify({ selfCpuMs: (ru.userCPUTime + ru.systemCPUTime) / 1000, childCpuMs: (Number(st[13]) + Number(st[14])) * 1000 / hz, selfMaxRssKb: ru.maxRSS }));
process.exit(code);
`,
    );
  }
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const tag = crypto.randomBytes(3).toString('hex');
  const created = /** @type {string[]} */ ([]);
  const url = (/** @type {string} */ db) => {
    const u = new URL(base);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const busyJiffies = () => {
    const f = String(fs.readFileSync('/proc/stat', 'utf8').split('\n')[0])
      .trim()
      .split(/\s+/)
      .slice(1)
      .map(Number);
    return f.reduce((a, b) => a + b, 0) - (f[3] ?? 0) - (f[4] ?? 0);
  };
  /** يقيسُ أمراً ابناً ويُراقبُ ذاكرةَ الخادمِ للقاعدة `db`. */
  const measure = (
    /** @type {string} */ ver,
    /** @type {string[]} */ args,
    /** @type {string} */ db,
    /** @type {string} */ connectTo,
  ) =>
    new Promise((resolve, reject) => {
      const j0 = busyJiffies();
      const t0 = process.hrtime.bigint();
      let serverHwmKb = 0;
      let childRssKb = 0;
      const sample = () => {
        for (const pid of fs.readdirSync('/proc')) {
          if (!/^\d+$/.test(pid)) continue;
          try {
            const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
            const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
            const hwm = Number(/VmHWM:\s+(\d+)/.exec(status)?.[1] ?? 0);
            if (cmd.startsWith(`postgres: 18/main: state ${db} `))
              serverHwmKb = Math.max(serverHwmKb, hwm);
            if (/pg_dump|pg_restore/.test(cmd)) childRssKb = Math.max(childRssKb, hwm);
          } catch {
            // عمليّةٌ انتهت بينَ القراءتين.
          }
        }
      };
      const timer = setInterval(sample, 100);
      const child = spawn(process.execPath, [path.join(dir, ver, 'run.mjs'), ...args], {
        env: { ...process.env, DATABASE_URL: connectTo },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('error', reject);
      child.on('close', (code) => {
        clearInterval(timer);
        const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
        const systemCpuMs = ((busyJiffies() - j0) * 1000) / 100;
        const ru = JSON.parse(/WL606_RUSAGE (.*)/.exec(out)?.[1] ?? '{}');
        const verifyMs = Number(
          /\[CONTENT_VERIFIED\][^\n]*\((?:\u200f)?(\d+) مللي/.exec(out)?.[1] ?? NaN,
        );
        resolve({
          code,
          ms,
          systemCpuMs,
          serverHwmKb,
          childRssKb,
          ...ru,
          verifyMs,
          tail: code === 0 ? undefined : out.slice(-400),
        });
      });
    });
  try {
    const src = `wl606b_src_${tag}`;
    await admin.query(`CREATE DATABASE ${l78Ident(src)}`);
    created.push(src);
    const sp = new pg.Pool({ connectionString: url(src), max: 4 });
    await up(sp);
    for (let t = 0; t < o.tables; t += 1) {
      await sp.query(`CREATE TABLE state.wl606_bench_${t} (id bigint PRIMARY KEY, payload text NOT NULL,
        n numeric, b bytea, ts timestamptz, note text)`);
      await sp.query(
        `INSERT INTO state.wl606_bench_${t}
         SELECT g, repeat(md5(g::text), 3), g * 1.5, decode(md5((g + ${t})::text), 'hex'),
                timestamptz '2026-01-01' + g * interval '1 second', CASE WHEN g % 7 = 0 THEN NULL ELSE 'n' || g END
           FROM generate_series(1, ${o.rows}) g`,
      );
    }
    await sp.query('VACUUM ANALYZE');
    const dbBytes = Number(
      (await sp.query('SELECT pg_database_size(current_database())::bigint AS s')).rows[0].s,
    );
    await sp.end();
    for (let rep = 0; rep < o.reps; rep += 1) {
      for (const ver of rep % 2 === 0 ? ['old', 'new'] : ['new', 'old']) {
        const dump = path.join(dir, `${ver}.dump`);
        fs.rmSync(dump, { force: true });
        fs.rmSync(`${dump}.manifest.json`, { force: true });
        const b = /** @type {any} */ (
          await measure(ver, ['backup.mjs', 'create', dump], src, url(src))
        );
        const manifest =
          b.code === 0 ? JSON.parse(fs.readFileSync(`${dump}.manifest.json`, 'utf8')) : {};
        const tgt = `wl606b_${ver}_${tag}_${rep}`;
        const r = /** @type {any} */ (
          await measure(ver, ['restore.mjs', dump, '--database', tgt], tgt, base)
        );
        created.push(tgt);
        const row = {
          label: `${o.tables}x${o.rows}`,
          rep,
          ver,
          dbBytes,
          dumpBytes: b.code === 0 ? fs.statSync(dump).size : null,
          backup: {
            ...b,
            digestMs: manifest.contentDigestMs ?? null,
            pgDurationMs: manifest.durationMs,
          },
          restore: r,
        };
        fs.appendFileSync(o.out, `${JSON.stringify(row)}\n`);
        process.stderr.write(`${JSON.stringify(row)}\n`);
        await admin.query(`DROP DATABASE IF EXISTS ${l78Ident(tgt)} WITH (FORCE)`);
        created.splice(created.indexOf(tgt), 1);
      }
    }
  } finally {
    for (const n of created) {
      await admin
        .query(`DROP DATABASE IF EXISTS ${l78Ident(n)} WITH (FORCE)`)
        .catch(() => undefined);
    }
    await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (
  process.argv[2] === 'wl606-bench' &&
  import.meta.url === (await import('node:url')).pathToFileURL(String(process.argv[1])).href
) {
  const { parseArgs } = await import('node:util');
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      tables: { type: 'string', default: '10' },
      rows: { type: 'string', default: '1000' },
      reps: { type: 'string', default: '2' },
      out: { type: 'string', default: '/tmp/wl606/results.jsonl' },
      'old-ref': { type: 'string', default: '693654d9' },
    },
  });
  const base = databaseUrl();
  if (base === undefined) throw new Error('DATABASE_URL غير معلَنة.');
  await wl606Bench(base, {
    tables: Number(values.tables),
    rows: Number(values.rows),
    reps: Number(values.reps),
    out: String(values.out),
    oldRef: String(values['old-ref']),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ‏`WL-608` — ‏`LIVE-78/DIGEST-COVERAGE`: نموذجٌ أوّليٌّ مختبريٌّ لقياسِ التغطية (‏لا مسارَ إنتاج)
//
// ‏`coverageProbe` يلتقطُ لكلِّ فئةٍ خارجَ بصمةِ `WL-606` تمثيلاً قانونيّاً (‏أسماءٌ لا OIDs، نصوصٌ من
// ‏`pg_get_*def` بـ`search_path=''` فتُؤهَّلُ الأسماءُ كاملة) وبصمتَه، فيُقاسُ في الاختبار: هل تبقى الفئةُ
// بعدَ نسخٍ/استعادةٍ حقيقيّين؟ هل يكشفُ التلاعبَ بها؟ هل التمثيلُ ثابتٌ عبرَ الصيانة؟ وكم يكلّف؟
// لا يستوردُه `scripts/` ولا `src/`؛ وبيانُ الإنتاجِ (‏`DIGEST_SCOPE`) لم يتوسّع — ‏`[CONTENT_VERIFIED]`
// يبقى معناه نطاقَ `WL-606` وحدَه. ‏`COVERAGE_MATRIX` هو الحكمُ المقيسُ لكلِّ فئة، والاختباراتُ تقارنُه
// بالسلوكِ الفعليّ فلا يصيرُ وصفاً يدويّاً.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * لكلِّ فئة: `inArchive` (‏هل تحملُها نسخةُ الإنتاجِ بأوامرِها الحاليّة)، `deterministic` (‏تمثيلٌ ثابتٌ
 * بلا OIDs/ترتيبِ تخزين)، `verifiable` (‏يمكنُ التحقّقُ منها في الهدفِ بعدَ الاستعادة)، `pgVersion`
 * (‏ما يتعلّقُ بالإصدار)، `formal` (‏فرقٌ شكليٌّ قد يظهرُ بلا فرقٍ وظيفيّ)، `unprovable` (‏ما لا يُثبَت).
 * ‏`roundTrip`: ‏'equal' = تطابقٌ مقيسٌ بعدَ نسخٍ/استعادة؛ 'lost' = تضيعُ تصميماً؛ 'cluster' = كائنٌ على
 * مستوى العنقود يظهرُ متطابقاً في اختبارٍ على العنقودِ نفسِه **بلا أن تنقلَه النسخة**.
 */
export const COVERAGE_MATRIX = Object.freeze({
  relations: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: 'relkind/relpersistence مستقرّة',
    formal: 'reloptions نصٌّ حرفيّ',
    unprovable: 'إحصاءاتُ المخطِّط (‏relpages/reltuples)',
  },
  columns: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: 'attcompression (‏PG14+)',
    formal:
      'attnum يختلفُ بعدَ الاستعادة حيثُ حُذفَ عمود (‏مقيس: state.data_assets) — فيُمثَّلُ الترتيبُ بينَ الأعمدةِ الحيّة لا attnum؛ ونصُّ pg_get_expr قد يتغيّرُ شكلاً بينَ الإصدارات',
    unprovable: 'الأعمدةُ المحذوفة (‏attisdropped) لا تُستعاد ولا يُحتاجُ إليها',
  },
  constraints: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: 'NOT NULL كقيدٍ في pg_constraint (‏PG18) — يُستثنى contype n',
    formal: 'اسمُ القيدِ المولَّدِ تلقائيّاً',
    unprovable: 'أنّ convalidated=true يعني أنّ الصفوفَ تحقّقُه فعلاً (‏قيدٌ مُدخَلٌ NOT VALID)',
  },
  indexes: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: 'نصُّ pg_get_indexdef',
    formal: 'اسمُ الفهرسِ ومعاملاتُ التخزين',
    unprovable: 'سلامةُ بنيةِ الفهرسِ على القرص (‏amcheck غيرُ مُثبَّت)',
  },
  triggers: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: 'نصُّ pg_get_triggerdef',
    formal: '—',
    unprovable: 'أنّ جسمَ دالّةِ القادحِ يفعلُ المقصود — يُقارَنُ نصّاً لا سلوكاً',
  },
  policies: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: 'polpermissive (‏PG10+)',
    formal: 'نصُّ pg_get_expr',
    unprovable:
      'أسماءُ الأدوارِ في السياسةِ تُقارَنُ اسماً؛ وجودُ الأدوارِ نفسِها على العنقودِ الهدفِ خارجَ النسخة',
  },
  routines: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: 'pg_get_functiondef، وprokind (‏PG11+)، وجسمُ SQL-standard (‏PG14+)',
    formal: 'مسافاتُ الجسم محفوظةٌ حرفيّاً (‏لا تطبيع)',
    unprovable: 'السلوكُ الفعليُّ للدالّة؛ ودوالُّ C (‏المكتبةُ خارجَ القاعدة)',
  },
  views: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: 'pg_get_viewdef يتغيّرُ شكلاً بينَ الإصدارات',
    formal: 'إعادةُ الصياغةِ من الشجرةِ المحلَّلة لا النصِّ الأصليّ',
    unprovable: 'محتوى العروضِ المجسَّدةِ (‏matview) — يتطلّبُ REFRESH',
  },
  types: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion:
      'enumsortorder أعدادٌ عشريّةٌ قد تختلفُ بعدَ ALTER TYPE … ADD VALUE — يُقارَنُ الترتيبُ لا القيمة',
    formal: '—',
    unprovable: 'أنواعُ C/الامتدادات',
  },
  sequenceDefs: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: 'pg_sequence (‏PG10+)',
    formal: '—',
    unprovable: 'القيمةُ الحاليّة (‏خارجَ MVCC — مغطّاةٌ تقدّماً في WL-606)',
  },
  comments: { inArchive: true, roundTrip: 'equal', pgVersion: '—', formal: '—', unprovable: '—' },
  fenceRows: {
    inArchive: true,
    roundTrip: 'equal',
    pgVersion: '—',
    formal:
      'fence.ddl_audit يكتبُه النسخُ نفسُه (‏إنشاءُ الجدولِ المرحليِّ وحذفُه) فيتغيّرُ المصدرُ بعدَ اللقطة — مقيس',
    unprovable:
      'أنّ صفوفَ السياجِ المستعادةَ صالحةٌ في العنقودِ الهدف — مختومةٌ بهويّةِ المصدر فتُعلنُ RECOVERY_REQUIRED (‏تصميماً)',
  },
  owners: {
    inArchive: false,
    roundTrip: 'lost',
    pgVersion: '—',
    formal: 'المالكُ في الهدفِ هو مُنفِّذُ الاستعادة (‏--no-owner)',
    unprovable: 'كلُّ شيء: لا تحملُه النسخة',
  },
  grants: {
    inArchive: false,
    roundTrip: 'lost',
    pgVersion: 'MAINTAIN (‏PG17+) يغيّرُ نصَّ ACL',
    formal: 'ترتيبُ عناصرِ ACL',
    unprovable: 'كلُّ شيء: --no-privileges في النسخِ والاستعادة',
  },
  defaultAcls: {
    inArchive: false,
    roundTrip: 'lost',
    pgVersion: '—',
    formal: '—',
    unprovable: 'كلُّ شيء: لا تحملُه النسخة',
  },
  roles: {
    inArchive: false,
    roundTrip: 'cluster',
    pgVersion: 'أعمدةُ pg_auth_members (‏inherit_option/set_option PG16+)',
    formal: '—',
    unprovable: 'كلُّ شيء: الأدوارُ على مستوى العنقود، وpg_dump بلا pg_dumpall لا ينقلُها',
  },
  largeObjects: {
    inArchive: false,
    roundTrip: 'lost',
    pgVersion: '—',
    formal: '—',
    unprovable: 'كلُّ شيء: --schema يستثني الكائناتِ الكبيرة',
  },
  eventTriggers: {
    inArchive: false,
    roundTrip: 'lost',
    pgVersion: '—',
    formal: '—',
    unprovable: 'كلُّ شيء: كائنُ قاعدةٍ لا مخطَّط',
  },
  extensions: {
    inArchive: false,
    roundTrip: 'lost',
    pgVersion: 'extversion',
    formal: '—',
    unprovable: 'كلُّ شيء: --schema لا ينقلُ CREATE EXTENSION',
  },
});

/** @type {Record<keyof typeof COVERAGE_MATRIX, string>} */
const COVERAGE_SQL = {
  relations: `SELECT n.nspname || '.' || c.relname AS k, jsonb_build_array(c.relkind, c.relpersistence, c.relrowsecurity,
      c.relforcerowsecurity, c.relreplident, coalesce(c.reloptions, '{}')) AS v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p','v','m','f','S','c') AND c.relname !~ '^__backup_schema_migrations_'`,
  columns: `SELECT n.nspname || '.' || c.relname || '.' || a.attname AS k, jsonb_build_array(row_number() OVER (PARTITION BY a.attrelid ORDER BY a.attnum), format_type(a.atttypid, a.atttypmod),
      a.attnotnull, pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated, a.attcollation::regcollation::text) AS v
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p','v','m','f','c') AND a.attnum > 0 AND NOT a.attisdropped
     AND c.relname !~ '^__backup_schema_migrations_'`,
  constraints: `SELECT coalesce(c.conrelid::regclass::text, c.contypid::regtype::text) || ':' || c.conname AS k,
      jsonb_build_array(c.contype, pg_get_constraintdef(c.oid, true), c.condeferrable, c.condeferred, c.convalidated) AS v
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE n.nspname = ANY($1) AND c.contype <> 'n' AND coalesce(c.conrelid::regclass::text, '') !~ '__backup_schema_migrations_'`,
  indexes: `SELECT x.indexrelid::regclass::text AS k, jsonb_build_array(pg_get_indexdef(x.indexrelid), x.indisunique, x.indisprimary, x.indisvalid) AS v
    FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY($1) AND c.relname !~ '^__backup_schema_migrations_'`,
  triggers: `SELECT t.tgrelid::regclass::text || ':' || t.tgname AS k, jsonb_build_array(pg_get_triggerdef(t.oid, true), t.tgenabled) AS v
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY($1) AND NOT t.tgisinternal`,
  policies: `SELECT p.polrelid::regclass::text || ':' || p.polname AS k, jsonb_build_array(p.polcmd, p.polpermissive,
      (SELECT coalesce(jsonb_agg(CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END ORDER BY 1), '[]') FROM unnest(p.polroles) r),
      pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) AS v
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY($1)`,
  routines: `SELECT p.oid::regprocedure::text AS k, jsonb_build_array(p.prokind, l.lanname, p.provolatile, p.prosecdef, p.proleakproof,
      p.proisstrict, p.proparallel, coalesce(p.proconfig, '{}'),
      CASE WHEN p.prokind IN ('f','p') THEN md5(pg_get_functiondef(p.oid)) END) AS v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = ANY($1)`,
  views: `SELECT c.oid::regclass::text AS k, jsonb_build_array(c.relkind, md5(pg_get_viewdef(c.oid, true))) AS v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY($1) AND c.relkind IN ('v','m')`,
  types: `SELECT t.oid::regtype::text AS k, jsonb_build_array(t.typtype,
      CASE WHEN t.typtype = 'e' THEN (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid) END,
      CASE WHEN t.typtype = 'd' THEN jsonb_build_array(format_type(t.typbasetype, t.typtypmod), t.typnotnull, t.typdefault) END) AS v
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = ANY($1) AND t.typtype IN ('e','d') `,
  sequenceDefs: `SELECT s.seqrelid::regclass::text AS k, jsonb_build_array(format_type(s.seqtypid, NULL), s.seqstart::text, s.seqincrement::text,
      s.seqmax::text, s.seqmin::text, s.seqcache::text, s.seqcycle,
      (SELECT d.refobjid::regclass::text || '.' || a.attname FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
        WHERE d.classid = 'pg_class'::regclass AND d.objid = s.seqrelid AND d.deptype IN ('a','i') AND d.refclassid = 'pg_class'::regclass LIMIT 1)) AS v
    FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY($1)`,
  comments: `SELECT d.classoid::regclass::text || ':' || coalesce(
        CASE d.classoid WHEN 'pg_class'::regclass THEN d.objoid::regclass::text WHEN 'pg_proc'::regclass THEN d.objoid::regprocedure::text
                        WHEN 'pg_namespace'::regclass THEN (SELECT nspname FROM pg_namespace WHERE oid = d.objoid)::text
                        WHEN 'pg_type'::regclass THEN d.objoid::regtype::text END, '?') || ':' || d.objsubid AS k, to_jsonb(d.description) AS v
    FROM pg_description d
   WHERE (d.classoid = 'pg_class'::regclass AND d.objoid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1)))
      OR (d.classoid = 'pg_proc'::regclass AND d.objoid IN (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1)))
      OR (d.classoid = 'pg_namespace'::regclass AND d.objoid IN (SELECT oid FROM pg_namespace WHERE nspname = ANY($1)))
      OR (d.classoid = 'pg_type'::regclass AND d.objoid IN (SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = ANY($1)))`,
  fenceRows: '', // يُحسَبُ جدولاً جدولاً في coverageProbe (‏صفوفُ fence.* بـmd5(record_out))
  owners: `SELECT 'rel:' || c.oid::regclass::text AS k, to_jsonb(pg_get_userbyid(c.relowner)::text) AS v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p','v','m','f','S')
      AND c.relname !~ '^__backup_schema_migrations_'
   UNION ALL SELECT 'proc:' || p.oid::regprocedure::text, to_jsonb(pg_get_userbyid(p.proowner)::text)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1)
   UNION ALL SELECT 'nsp:' || n.nspname, to_jsonb(pg_get_userbyid(n.nspowner)::text) FROM pg_namespace n WHERE n.nspname = ANY($1)`,
  grants: `SELECT 'rel:' || c.oid::regclass::text AS k, to_jsonb(coalesce(c.relacl::text[], '{}')) AS v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p','v','m','f','S')
      AND c.relname !~ '^__backup_schema_migrations_'
   UNION ALL SELECT 'col:' || a.attrelid::regclass::text || '.' || a.attname, to_jsonb(a.attacl::text[])
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY($1) AND a.attacl IS NOT NULL
   UNION ALL SELECT 'proc:' || p.oid::regprocedure::text, to_jsonb(coalesce(p.proacl::text[], '{}'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1)
   UNION ALL SELECT 'nsp:' || n.nspname, to_jsonb(coalesce(n.nspacl::text[], '{}')) FROM pg_namespace n WHERE n.nspname = ANY($1)`,
  defaultAcls: `SELECT coalesce(n.nspname, '*') || ':' || pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype::text AS k, to_jsonb(d.defaclacl::text[]) AS v
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE n.nspname = ANY($1) OR d.defaclnamespace = 0`,
  roles: `WITH r AS (SELECT DISTINCT u AS rid FROM (
        SELECT c.relowner AS u FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1)
        UNION SELECT (aclexplode(c.relacl)).grantee FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1) AND c.relacl IS NOT NULL
        UNION SELECT unnest(p.polroles) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1)) s
       WHERE u <> 0)
    SELECT a.rolname::text AS k, jsonb_build_array(a.rolsuper, a.rolinherit, a.rolcreaterole, a.rolcreatedb, a.rolcanlogin, a.rolreplication,
        a.rolbypassrls, a.rolconnlimit,
        (SELECT coalesce(jsonb_agg(pg_get_userbyid(m.roleid)::text || CASE WHEN m.admin_option THEN '+admin' ELSE '' END ORDER BY 1), '[]')
           FROM pg_auth_members m WHERE m.member = a.oid)) AS v
      FROM pg_authid a JOIN r ON r.rid = a.oid`,
  largeObjects: `SELECT m.oid::text AS k, jsonb_build_array(pg_get_userbyid(m.lomowner)::text,
      (SELECT md5(coalesce(string_agg(l.data, ''::bytea ORDER BY l.pageno), ''::bytea)) FROM pg_largeobject l WHERE l.loid = m.oid)) AS v
    FROM pg_largeobject_metadata m WHERE $1::text[] IS NOT NULL`,
  eventTriggers: `SELECT evtname::text AS k, jsonb_build_array(evtevent, evtfoid::regprocedure::text, evtenabled, coalesce(evttags, '{}')) AS v
    FROM pg_event_trigger WHERE $1::text[] IS NOT NULL`,
  extensions: `SELECT extname::text AS k, jsonb_build_array(extversion, extnamespace::regnamespace::text) AS v
    FROM pg_extension WHERE $1::text[] IS NOT NULL AND extname <> 'plpgsql'`,
};

/**
 * يلتقطُ التمثيلَ القانونيَّ لكلِّ فئةٍ داخلَ معاملةِ قراءةٍ واحدة (‏`REPEATABLE READ READ ONLY`) بإعداداتِ
 * ‏`DIGEST_SETTINGS` نفسِها — فالنصوصُ تُؤهَّلُ بالمخطّطِ ولا تتعلّقُ بجلسةِ المُستدعي.
 * @param {import('pg').Pool} pool
 * @param {{ schemas?: string[], settings: Record<string, string> }} options
 * @returns {Promise<{ pgMajor: number, ms: number, categories: Record<string, { entries: Array<[string, unknown]>, sha256: string }> }>}
 */
export async function coverageProbe(pool, options) {
  const client = await pool.connect();
  const started = process.hrtime.bigint();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const [name, value] of Object.entries(options.settings)) {
      await client.query('SELECT pg_catalog.set_config($1, $2, true)', [name, value]);
    }
    const present =
      (
        await client.query(
          `SELECT array_agg(nspname::text) AS s FROM pg_namespace WHERE nspname = ANY($1)`,
          [options.schemas ?? ['state', 'fence']],
        )
      ).rows[0]?.['s'] ?? [];
    const pgMajor = Math.floor(
      Number(
        (await client.query(`SELECT current_setting('server_version_num') AS v`)).rows[0]?.['v'],
      ) / 10000,
    );
    /** @type {Record<string, { entries: Array<[string, unknown]>, sha256: string }>} */
    const categories = {};
    for (const [name, sql] of Object.entries(COVERAGE_SQL)) {
      /** @type {Array<[string, unknown]>} */
      let entries;
      if (name === 'fenceRows') {
        entries = [];
        if (present.includes('fence')) {
          const tables = await client.query(
            `SELECT c.relname::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'fence' AND c.relkind = 'r' ORDER BY c.relname COLLATE "C"`,
          );
          for (const row of tables.rows) {
            const t = String(row['t']);
            const r = (
              await client.query(
                `SELECT count(*)::int AS n, md5(coalesce(string_agg(h, '' ORDER BY h COLLATE "C"), '')) AS h
                   FROM (SELECT md5(x::text) AS h FROM fence.${quoteIdent(t)} x) s`,
              )
            ).rows[0];
            entries.push([t, [r?.['n'], r?.['h']]]);
          }
        }
      } else {
        const rows = (await client.query(sql, [present])).rows;
        entries = rows.map((r) => /** @type {[string, unknown]} */ ([String(r['k']), r['v']]));
      }
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      categories[name] = {
        entries,
        sha256: crypto.createHash('sha256').update(JSON.stringify(entries), 'utf8').digest('hex'),
      };
    }
    await client.query('ROLLBACK');
    return { pgMajor, ms: Number((process.hrtime.bigint() - started) / 1_000_000n), categories };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * الفئاتُ المختلفةُ بينَ لقطتَين، ولكلٍّ المفاتيحُ المختلفة (‏أوّلُ خمسةٍ للقراءة).
 * @param {Awaited<ReturnType<typeof coverageProbe>>} a
 * @param {Awaited<ReturnType<typeof coverageProbe>>} b
 * @returns {Record<string, string[]>}
 */
export function coverageDiff(a, b) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const name of Object.keys(a.categories)) {
    const x = a.categories[name];
    const y = b.categories[name];
    if (!x || !y || x.sha256 === y.sha256) continue;
    const mx = new Map(x.entries.map(([k, v]) => [k, JSON.stringify(v)]));
    const my = new Map(y.entries.map(([k, v]) => [k, JSON.stringify(v)]));
    const keys = [...new Set([...mx.keys(), ...my.keys()])]
      .filter((k) => mx.get(k) !== my.get(k))
      .sort();
    out[name] = keys.slice(0, 5);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ‏`WL-608` — أصالةُ البيان: نموذجٌ أوّليٌّ مختبريٌّ للتوقيع (‏لا مسارَ إنتاج، لا مفاتيحَ إنتاج)
//
// ‏`WL-606` يُثبتُ **السلامة**: المستعادُ يطابقُ ما يصفُه البيان، والبيانُ يطابقُ نفسَه. لا يُثبتُ **المصدر**:
// مَن يملكُ الكتابةَ في موضعِ النسخِ يضعُ أرشيفاً وبياناً متّسقَين من قاعدةٍ أخرى أو من ماضٍ قديم. هذا النموذجُ
// يقيسُ ما يضيفُه توقيعٌ بمفتاحٍ مستقلٍّ (‏Ed25519 يُولَّدُ داخلَ الاختبار) على حمولةٍ قانونيّة تربطُ: بصمةَ
// الأرشيف، وبصمةَ المحتوى، ووقتَ البدء، ونسخةَ الهجرة، وهويّةَ القاعدة، ورقماً متسلسلاً، ومعرّفَ المفتاح.
// ‏**التوقيعُ وحدَه لا يمنعُ إعادةَ التشغيل**: نسخةٌ قديمةٌ موقَّعةٌ صحيحةٌ تبقى صحيحة؛ يمنعُها حدٌّ أدنى للرقمِ
// المتسلسلِ في مخزنٍ موثوق — مقيسٌ في الاختبار. إدارةُ المفاتيحِ والمخزنِ قرارُ مالك.
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const MANIFEST_AUTH_REASONS = Object.freeze({
  MISSING: 'SIGNATURE_MISSING',
  NO_TRUSTED_KEYS: 'SIGNATURE_NO_TRUSTED_KEYS',
  KEY_REVOKED: 'SIGNATURE_KEY_REVOKED',
  UNTRUSTED_KEY: 'SIGNATURE_KEY_UNTRUSTED',
  INVALID: 'SIGNATURE_INVALID',
  BINDING: 'SIGNATURE_BINDING_MISMATCH',
  DATABASE: 'SIGNATURE_DATABASE_MISMATCH',
  SEQUENCE_REFERENCE_UNAVAILABLE: 'SEQUENCE_REFERENCE_UNAVAILABLE',
  SEQUENCE_REFERENCE_NOT_INDEPENDENT: 'SEQUENCE_REFERENCE_NOT_INDEPENDENT',
  REPLAY: 'SIGNATURE_REPLAY',
  FUTURE: 'SEQUENCE_FUTURE',
  UNKNOWN: 'SEQUENCE_UNKNOWN',
  CONFLICT: 'SEQUENCE_CONFLICT',
});

/** @param {unknown} value @returns {string} */
function authCanonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(authCanonical).join(',')}]`;
  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${authCanonical(record[k])}`).join(',')}}`;
}

/**
 * الحمولةُ الموقَّعة: ما يُقرأُ من البيانِ ومن الأرشيفِ نفسِه (‏`dumpSha256` يُحسَبُ من الملفّ لا يُنقَلُ من البيان).
 * ‏`WL-610`: الإصدارُ 2 يُضيفُ `backupId` — هويّةُ النسخةِ التي يُسجِّلُها المرجعُ المستقلُّ مع رقمِها.
 * ‏`WL-612`: الإصدارُ 3 يُضيفُ `manifestSha256` — بصمةَ البيانِ كلِّه؛ كانتِ الحقولُ الأربعةُ وحدَها مربوطةً.
 * @param {Record<string, any>} manifest @param {string} dumpSha256
 * @param {{ keyId: string, sequence: number, database: string, backupId: string }} meta
 */
export function manifestAuthPayload(manifest, dumpSha256, meta) {
  return {
    format: 'xuux.backup-signature-prototype',
    version: 3,
    keyId: meta.keyId,
    backupId: meta.backupId,
    sequence: meta.sequence,
    database: meta.database,
    dumpSha256,
    manifestDumpSha256: String(manifest['sha256']),
    contentDigestSha256: String(manifest['contentDigest']?.['sha256'] ?? ''),
    startedAt: String(manifest['startedAt']),
    migrationVersion: Number(manifest['migrationVersion']),
    manifestSha256: manifestCanonicalSha256(manifest),
  };
}

/**
 * ‏`WL-612` (‏`LIVE-78/SIGNATURE-BINDING`): بصمةُ **البيانِ كلِّه** في صورتِه القانونيّة، فلا يبقى حقلٌ خارجَ
 * التوقيع (‏`rowCounts`، `contentDigest.tables`، `durationMs`، حقلٌ مُضاف…). يُمرَّرُ عبرَ JSON أوّلاً لأنّ
 * البيانَ يُقرأُ من ملفّ: ما يُسقطُه التسلسلُ (‏`undefined`) لا يُوقَّعُ ثمّ يُفتقَدُ عندَ التحقّق.
 * @param {Record<string, any>} manifest
 */
function manifestCanonicalSha256(manifest) {
  const json = JSON.stringify(manifest);
  if (typeof json !== 'string') throw new TypeError('manifest is not JSON-serialisable');
  return crypto
    .createHash('sha256')
    .update(authCanonical(JSON.parse(json)), 'utf8')
    .digest('hex');
}

/**
 * @param {Record<string, any>} manifest @param {string} dumpSha256
 * @param {{ keyId: string, sequence: number, database: string, backupId: string, privateKey: crypto.KeyObject }} signer
 */
export function signManifestPrototype(manifest, dumpSha256, signer) {
  const payload = manifestAuthPayload(manifest, dumpSha256, signer);
  const signature = crypto.sign(
    null,
    Buffer.from(authCanonical(payload), 'utf8'),
    signer.privateKey,
  );
  return { payload, signature: signature.toString('base64') };
}

// ─── ‏`WL-610` — مرجعُ التسلسلِ المستقلّ ─────────────────────────────────────────────────────
// رقمٌ متسلسلٌ داخلَ البيانِ الموقَّعِ **لا يمنعُ** إعادةَ التشغيلِ وحدَه: النسخةُ القديمةُ تحملُ رقمَها القديمَ
// موقَّعاً صحيحاً. المنعُ مقارنةٌ بمرجعٍ يحفظُه طرفٌ غيرُ موضعِ النسخ: أدنى رقمٍ مقبول (‏`floor`)، وآخرُ رقمٍ
// صدَر (‏`latestIssued`)، وسجلُّ ما صدَر (‏`issued`: رقم ⇒ `{ backupId, dumpSha256 }`). يُحمَّلُ من خارجِ مجلّدِ
// النسخة، ويُرفَضُ غائباً أو تالفاً أو داخلَ المجلّد. **حدّ:** استقلالُ المسارِ ليس استقلالَ الصلاحيّة — مرجعٌ
// يكتبُه حسابُ نظامِ التشغيلِ نفسُه الذي يكتبُ النسخَ يُزوِّرُه المهاجمُ معها؛ والتمثيلُ هنا ملفٌّ لاختبارِ المنطق.

/**
 * @typedef {{ floor: number, latestIssued: number, issued: Map<number, { backupId: string, dumpSha256: string }> }} SequenceReference
 */

/**
 * ‏`WL-611`: هل `target` هو `dir` أو داخلَه؟ الخروجُ مقطعُ `..` كاملٌ لا بادئةٌ نصّيّة: ‏`relative` يُعيدُ
 * `..trusted/x` لمجلّدٍ داخليٍّ اسمُه يبدأُ بـ`..`، وفحصُ `startsWith('..')` كانَ يعدُّه خارجاً فيقبلُ مرجعاً داخلَ مجلّدِ النسخ.
 * @param {string} dir @param {string} target مساران مُطلَقان
 */
function isWithinDirectory(dir, target) {
  const rel = path.relative(dir, target);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel.split(path.sep)[0] !== '..';
}

/**
 * يُحمِّلُ المرجعَ ويرفضُ بلا استثناء: غائب/غيرُ مقروء/مشوَّه ⇒ `UNAVAILABLE`؛ داخلَ مجلّدِ النسخة ⇒ `NOT_INDEPENDENT`.
 * @param {string} referencePath @param {string} backupDir
 * @returns {{ ok: true, reference: SequenceReference } | { ok: false, reason: string }}
 */
export function loadSequenceReference(referencePath, backupDir) {
  // مسارٌ داخلَ المجلّدِ لفظيّاً يُرفَضُ ولو كانَ رابطاً إلى خارجِه: الرابطُ نفسُه في يدِ من يكتبُ النسخ.
  if (isWithinDirectory(path.resolve(backupDir), path.resolve(referencePath))) {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_NOT_INDEPENDENT };
  }
  let real;
  let dir;
  try {
    real = fs.realpathSync(referencePath);
    dir = fs.realpathSync(backupDir);
  } catch {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE };
  }
  if (isWithinDirectory(dir, real)) {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_NOT_INDEPENDENT };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(real, 'utf8'));
    const floor = raw?.floor;
    const latest = raw?.latestIssued;
    if (
      raw?.format !== 'xuux.backup-sequence-reference' ||
      raw?.version !== 1 ||
      !Number.isSafeInteger(floor) ||
      !Number.isSafeInteger(latest) ||
      floor < 1 ||
      latest < floor ||
      raw.issued === null ||
      typeof raw.issued !== 'object' ||
      Array.isArray(raw.issued)
    ) {
      return { ok: false, reason: MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE };
    }
    /** @type {SequenceReference['issued']} */
    const issued = new Map();
    for (const [k, v] of Object.entries(raw.issued)) {
      const n = Number(k);
      if (
        !Number.isSafeInteger(n) ||
        String(n) !== k ||
        typeof v?.backupId !== 'string' ||
        typeof v?.dumpSha256 !== 'string'
      ) {
        return { ok: false, reason: MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE };
      }
      issued.set(n, { backupId: v.backupId, dumpSha256: v.dumpSha256 });
    }
    return { ok: true, reference: { floor, latestIssued: latest, issued } };
  } catch {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE };
  }
}

/**
 * يرفضُ بسببٍ مُسمّىً أو يقبل. الترتيب: وجود ⇒ مفاتيحُ موثوقةٌ موجودة ⇒ غيرُ مُلغى ⇒ موثوق ⇒ توقيع ⇒ ربطٌ
 * بالأرشيفِ والبيان ⇒ هويّةُ القاعدة ⇒ مرجعُ التسلسل (‏غائب ⇒ رفضٌ إلا بإذنٍ صريحٍ يُعلَنُ `replayProtected:false`)
 * ⇒ تحتَ الحدّ ⇒ فوقَ ما صدَر ⇒ غيرُ مُسجَّل ⇒ تعارضُ الرقمِ أو الهويّة.
 * @param {Record<string, any>} manifest @param {string} dumpSha256
 * @param {{ payload: Record<string, any>, signature: string } | undefined} envelope
 * @param {{ trustedKeys: Map<string, crypto.KeyObject>, revokedKeys?: Set<string>, database: string,
 *   sequenceReference: SequenceReference | null, allowUnprotectedReplay?: boolean }} policy
 * @returns {{ ok: true, replayProtected: boolean } | { ok: false, reason: string }}
 */
export function verifyManifestPrototype(manifest, dumpSha256, envelope, policy) {
  if (!envelope) return { ok: false, reason: MANIFEST_AUTH_REASONS.MISSING };
  if (!(policy.trustedKeys instanceof Map) || policy.trustedKeys.size === 0) {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.NO_TRUSTED_KEYS };
  }
  const keyId = String(envelope.payload['keyId']);
  if (policy.revokedKeys?.has(keyId)) {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.KEY_REVOKED };
  }
  const key = policy.trustedKeys.get(keyId);
  if (!key) return { ok: false, reason: MANIFEST_AUTH_REASONS.UNTRUSTED_KEY };
  let good;
  try {
    good = crypto.verify(
      null,
      Buffer.from(authCanonical(envelope.payload), 'utf8'),
      key,
      Buffer.from(String(envelope.signature), 'base64'),
    );
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: MANIFEST_AUTH_REASONS.INVALID };
  const sequence = Number(envelope.payload['sequence']);
  const backupId = String(envelope.payload['backupId']);
  let expected;
  try {
    expected = manifestAuthPayload(manifest, dumpSha256, {
      keyId,
      sequence,
      database: String(envelope.payload['database']),
      backupId,
    });
  } catch {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.BINDING };
  }
  if (authCanonical(expected) !== authCanonical(envelope.payload)) {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.BINDING };
  }
  if (envelope.payload['database'] !== policy.database) {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.DATABASE };
  }
  const ref = policy.sequenceReference;
  if (ref === null || ref === undefined) {
    return policy.allowUnprotectedReplay === true
      ? { ok: true, replayProtected: false }
      : { ok: false, reason: MANIFEST_AUTH_REASONS.SEQUENCE_REFERENCE_UNAVAILABLE };
  }
  if (!Number.isSafeInteger(sequence) || sequence < ref.floor) {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.REPLAY };
  }
  if (sequence > ref.latestIssued) return { ok: false, reason: MANIFEST_AUTH_REASONS.FUTURE };
  const record = ref.issued.get(sequence);
  if (!record) return { ok: false, reason: MANIFEST_AUTH_REASONS.UNKNOWN };
  if (record.backupId !== backupId || record.dumpSha256 !== dumpSha256) {
    return { ok: false, reason: MANIFEST_AUTH_REASONS.CONFLICT };
  }
  for (const [n, other] of ref.issued) {
    if (n !== sequence && other.backupId === backupId) {
      return { ok: false, reason: MANIFEST_AUTH_REASONS.CONFLICT };
    }
  }
  return { ok: true, replayProtected: true };
}
