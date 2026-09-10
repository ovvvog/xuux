/**
 * صورةُ بياناتِ القاعدة — المسار `M3`، الخطوة `M3.03`.
 *
 * `catalogSnapshot` تصفُ **البنية**، وأعلنت في رأسِها أنّها لا تلتقطُ بياناتِ
 * الجداولِ عمداً. وهذه الوحدةُ أختُها التي تلتقطُ **الصفوفَ نفسَها**: قيمةً
 * قيمةً، لا عدداً ولا عيّنة.
 *
 * لماذا الصفوفُ كاملةً لا عدُّها: هجرةٌ تُبدّلُ قيمةَ عمودٍ في كلِّ صفٍّ ثمّ
 * لا يُرجِعُها تراجعُها تُبقي العددَ كما هو تماماً. فعدُّ الصفوفِ يُخفي أخطرَ
 * ما يُبحَثُ عنه هنا — التغييرَ الصامت — ولا يكشفُ إلا الحذف.
 *
 * والترتيبُ مفروضٌ بنصِّ الصفِّ نفسِه (`to_jsonb(t)::text`) لا بمفتاحٍ أساسيّ:
 * جداولُ هذا المخطَّطِ ليست كلُّها ذاتَ مفتاحٍ واحدٍ مرتَّب، وPostgreSQL لا
 * يضمنُ ترتيبَ الصفوفِ بلا `ORDER BY`، فصورتانِ لبياناتٍ واحدةٍ بترتيبَينِ
 * مختلفَينِ تُقرَآنِ فقداناً وهمياً.
 */

import { createHash } from 'node:crypto';

/**
 * @typedef {object} TableData
 * @property {string} table اسمُ الجدولِ مؤهَّلاً بمخطَّطِه.
 * @property {number} rows عددُ الصفوف.
 * @property {string} json الصفوفُ كلُّها نصّاً مرتَّباً ثابتَ الترتيب.
 */

/**
 * @typedef {object} DataSnapshot
 * @property {string} digest بصمةُ الصورةِ كلِّها.
 * @property {number} tables عددُ الجداولِ الملتقَطة.
 * @property {number} rows مجموعُ الصفوفِ في الصورة.
 * @property {Record<string, { rows: number, digest: string }>} perTable خلاصةٌ لكلِّ جدول.
 * @property {Record<string, string>} raw نصُّ صفوفِ كلِّ جدولٍ — مادّةُ المقايسةِ والفرق.
 */

/**
 * @param {string} text
 * @returns {string}
 */
function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * اقتباسُ معرّفٍ بأسلوبِ PostgreSQL.
 * @param {string} value
 * @returns {string}
 */
function ident(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * اقتباسُ نصٍّ حرفيٍّ بأسلوبِ PostgreSQL.
 * @param {string} value
 * @returns {string}
 */
function literal(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * التقطْ صورةَ بياناتِ مخطَّطٍ واحد.
 *
 * @param {{ query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }} pool
 * @param {object} [options]
 * @param {string} [options.schema] المخطَّطُ المقروء (افتراضُه `state`).
 * @returns {Promise<DataSnapshot>}
 */
export async function dataSnapshot(pool, options = {}) {
  const schema = options.schema ?? 'state';
  const tables = await pool.query(
    `SELECT c.relname AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r'
     ORDER BY c.relname`,
    [schema],
  );

  const names = /** @type {{ name: string }[]} */ (tables.rows).map((row) => row.name);

  /** @type {Record<string, { rows: number, digest: string }>} */
  const perTable = {};
  /** @type {Record<string, string>} */
  const raw = {};
  let total = 0;

  if (names.length > 0) {
    // استعلامٌ واحدٌ لكلِّ الجداولِ لا استعلامٌ لكلِّ جدول: البرهانُ يلتقطُ ثلاثَ
    // صورٍ لكلِّ هجرة، وثلاثونَ رحلةً لكلِّ صورةٍ على وصلةٍ بعيدةٍ (نحو ٢ ثانية
    // للرحلة) تجعلُ البرهانَ ساعاتٍ — وبرهانٌ لا يُشغَّلُ لطولِه لا يُشغَّل.
    //
    // والنصُّ يُبنى بأسماءٍ مقروءةٍ من `pg_class` لا من مُدخَل، وتُقتبَسُ مع ذلك
    // فلا يُبنى استعلامٌ بلا اقتباس. وكلُّ جدولٍ يُعادُ نصُّه كما طبعَته القاعدةُ
    // (`::text`) لا كما أعادَ تركيبَه JavaScript: إعادةُ التركيبِ تمرُّ بأعدادِ
    // JavaScript العشرية، فتفقدُ دقّةَ `numeric` وتُقرأُ فقداناً وهمياً.
    const branches = names.map(
      (name) =>
        `SELECT ${literal(name)} AS name, (SELECT coalesce(jsonb_agg(v ORDER BY v::text), '[]'::jsonb)::text ` +
        `FROM (SELECT to_jsonb(t) AS v FROM ${ident(schema)}.${ident(name)} t) AS s) AS body`,
    );
    // `to_jsonb` يُطبِّعُ القيمَ تطبيعاً واحداً لكلِّ الأنواع، فلا يختلفُ نصُّ
    // الطابعِ الزمنيِّ أو الرقمِ العشريِّ باختلافِ إعداداتِ الجلسة.
    const content = await pool.query(branches.join(' UNION ALL '));
    for (const row of /** @type {{ name: string, body: string }[]} */ (content.rows)) {
      const qualified = `${schema}.${row.name}`;
      const count = /** @type {unknown[]} */ (JSON.parse(row.body)).length;
      perTable[qualified] = { rows: count, digest: sha(row.body).slice(0, 16) };
      raw[qualified] = row.body;
      total += count;
    }
  }

  const combined = JSON.stringify(raw, Object.keys(raw).sort());
  return {
    digest: sha(combined).slice(0, 16),
    tables: Object.keys(perTable).length,
    rows: total,
    perTable,
    raw,
  };
}

/**
 * @typedef {object} DataDiff
 * @property {string} table الجدولُ الذي اختلف.
 * @property {'missing-table' | 'new-table' | 'rows-changed'} kind نوعُ الاختلاف.
 * @property {string[]} lost صفوفٌ كانت واختفت.
 * @property {string[]} gained صفوفٌ ظهرت ولم تكن.
 */

/**
 * فرِّقْ صورتَي بياناتٍ صفّاً صفّاً.
 *
 * الغرضُ رسالةُ فشلٍ تقولُ **أيُّ صفٍّ ضاع أو تبدَّل**، لا «البياناتُ اختلفت»:
 * إخفاقٌ لا يُسمّي الصفَّ الضائعَ يُحوِّلُ البرهانَ إلى إنذارٍ يُسكَت.
 *
 * @param {DataSnapshot} before
 * @param {DataSnapshot} after
 * @returns {DataDiff[]}
 */
export function diffDataSnapshots(before, after) {
  /** @type {DataDiff[]} */
  const diffs = [];
  const names = new Set([...Object.keys(before.raw), ...Object.keys(after.raw)]);
  for (const table of [...names].sort()) {
    const left = before.raw[table];
    const right = after.raw[table];
    if (left === undefined) {
      diffs.push({ table, kind: 'new-table', lost: [], gained: [] });
      continue;
    }
    if (right === undefined) {
      diffs.push({
        table,
        kind: 'missing-table',
        lost: /** @type {unknown[]} */ (JSON.parse(left)).map((row) => JSON.stringify(row)),
        gained: [],
      });
      continue;
    }
    if (left === right) continue;
    const leftRows = /** @type {unknown[]} */ (JSON.parse(left)).map((row) => JSON.stringify(row));
    const rightRows = /** @type {unknown[]} */ (JSON.parse(right)).map((row) =>
      JSON.stringify(row),
    );
    const leftSet = new Set(leftRows);
    const rightSet = new Set(rightRows);
    diffs.push({
      table,
      kind: 'rows-changed',
      lost: leftRows.filter((row) => !rightSet.has(row)),
      gained: rightRows.filter((row) => !leftSet.has(row)),
    });
  }
  return diffs;
}
