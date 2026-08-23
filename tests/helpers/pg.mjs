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
      await pool.end();
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

/**
 * صورة من كتالوج القاعدة: المخطَّطات والجداول والأعمدة وقيودها وفهارسها.
 * تُستعمل لمقايسة حالة القاعدة قبل الهجرة وبعد التراجع مقايسةً نصّية.
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
export async function catalogSnapshot(pool) {
  const schemas = await pool.query(
    `SELECT nspname FROM pg_namespace
     WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
     ORDER BY nspname`,
  );
  const columns = await pool.query(
    `SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name, column_name`,
  );
  const constraints = await pool.query(
    `SELECT connamespace::regnamespace::text AS schema, conrelid::regclass::text AS rel,
            conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE connamespace::regnamespace::text NOT IN ('pg_catalog', 'information_schema')
     ORDER BY schema, rel, conname`,
  );
  const indexes = await pool.query(
    `SELECT schemaname, tablename, indexname, indexdef
     FROM pg_indexes
     WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
     ORDER BY schemaname, tablename, indexname`,
  );
  const domains = await pool.query(
    `SELECT domain_schema, domain_name, data_type
     FROM information_schema.domains
     WHERE domain_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY domain_schema, domain_name`,
  );
  return JSON.stringify(
    {
      schemas: schemas.rows,
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      domains: domains.rows,
    },
    null,
    1,
  );
}
