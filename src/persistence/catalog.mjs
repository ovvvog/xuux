/**
 * صورةُ كتالوجِ القاعدة — المسار `M3`.
 *
 * الصورةُ نصٌّ واحدٌ يصفُ **بنيةَ** القاعدة: مخطَّطاتُها وأعمدةُ جداولِها
 * وقيودُها وفهارسُها ومجالاتُها. وُجدت لغرضٍ واحد: أن تُقايَسَ حالةُ القاعدةِ
 * قبلَ هجرةٍ بحالتِها بعدَ التراجعِ عنها مقايسةً نصّيةً قاطعة، فلا يُقبَلَ
 * «تراجعٌ يُشبِهُ الأصل» مكانَ «تراجعٍ يُعيدُ الأصل».
 *
 * كانت هذه الدالّةُ تعيشُ في `tests/helpers/pg.mjs` وحدَها، فلمّا احتاجَها
 * برهانُ الانعكاسِ في `src/persistence/reversibility.mjs` نُقلت إلى `src/`
 * لتكونَ مصدراً واحداً: نسختانِ من تعريفِ «الصورة» تعنيانِ أنّ الاختبارَ
 * والأداةَ قد يقيسانِ شيئينِ مختلفَين ويتّفقانِ على النتيجةِ صدفةً.
 *
 * ما لا تلتقطُه الصورةُ عمداً: بياناتُ الجداول، وقيمُ المتسلسلات، وصلاحياتُ
 * الأدوار. الغرضُ برهانُ انعكاسِ **المخطَّط**، وذكرُ الحدِّ خيرٌ من ادّعاءِ
 * شمولٍ لا يقوم.
 */

/** المخطَّطاتُ الداخليةُ التي لا تخصُّ المشروعَ فلا تدخلُ الصورة. */
const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema'];

/**
 * @typedef {object} CatalogQueryable
 * @property {(text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>} query
 */

/**
 * التقطْ صورةَ الكتالوجِ الحاليةَ نصّاً مُرتَّباً ثابتَ الترتيب.
 * الترتيبُ مفروضٌ في كلِّ استعلامٍ لأنّ PostgreSQL لا يضمنُ ترتيبَ الصفوفِ بلا
 * `ORDER BY`، وصورتانِ بترتيبَينِ مختلفَينِ تُقرَآنِ اختلافاً وهمياً.
 * @param {CatalogQueryable} pool
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

/**
 * أسماءُ المخطَّطاتِ الداخليةِ المستثناةِ من الصورة — تُصدَّرُ ليُوثَّقَ الحدُّ
 * ويُقرأَ في التقارير بدلَ أن يُعادَ كتابتُه في كلِّ موضع.
 * @returns {readonly string[]}
 */
export function systemSchemas() {
  return SYSTEM_SCHEMAS;
}
