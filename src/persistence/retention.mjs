/**
 * سياسة الاحتفاظ والمحو — الخطوة `M3.08`.
 *
 * السياسة هنا بيانات ثابتة لا نصوص SQL مصدرها المستدعي: يختار المستدعي مفتاح
 * جدول معلناً فقط، ثم تبقى أسماء العلاقات والأعمدة مقتبسة ومملوكة لهذه الوحدة.
 *
 * **حدٌّ معلن:** `state.events` مرآة سجل تجزئة متصل. حذف حدث، حتى من البادئة،
 * يجعل أول صف باقٍ يشير إلى `prev_hash` غير موجود في الجدول، فلا تبقى السلسلة
 * قابلة للتحقق من داخل المرآة. لذلك لا يوجد محو آلي أو موجّه للأحداث هنا.
 *
 * **ولا محوَ خاماً لغيرِ الأحداثِ كذلك** (نتيجةُ `R6-A-11`): هذه الوحدةُ تقرأُ
 * وتعدُّ فقط. المحوُ فعلٌ محكومٌ (`purge-data`) يقعُ عبرَ `RetentionCycle.run` في
 * `src/data/retention-cycle.mjs` وحدَه؛ و`purge` بلا `dryRun` و`eraseById` تُرفَضانِ
 * برمزِ `RETENTION_PURGE_UNAUTHORIZED` قبلَ أيِّ اتصالٍ بالقاعدة.
 */

export const RETENTION_ERRORS = Object.freeze({
  INVALID_NOW: 'RETENTION_INVALID_NOW',
  UNKNOWN_TABLE: 'RETENTION_UNKNOWN_TABLE',
  LEGAL_HOLD: 'RETENTION_LEGAL_HOLD',
  NOT_FOUND: 'RETENTION_NOT_FOUND',
  EVENTS_IMMUTABLE: 'RETENTION_EVENTS_IMMUTABLE',
  DEPENDENTS_PRESENT: 'RETENTION_DEPENDENTS_PRESENT',
  PURGE_UNAUTHORIZED: 'RETENTION_PURGE_UNAUTHORIZED',
});

/** خطأ سياسة احتفاظ يحمل رمزاً ثابتاً للمستدعي وأداة سطر الأوامر. */
export class RetentionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'RetentionError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * يترجم خطأ مرجعٍ خاماً من PostgreSQL (‏`23503`) إلى رفضٍ مُسمّى — الخطوة
 * `M7.06`.
 *
 * **العيب المُقاس:** `state.data_lineage.asset_id` و
 * `state.classification_approvals.asset_id` يرجعان إلى `state.data_assets(id)` بلا
 * `ON DELETE` — وهو مقصودٌ في الهجرة `0007`. فكان `purge` يرفع خطأ قاعدةٍ
 * خاماً بنصٍ إنجليزيٍ يسمّي القيد ولا يسمّي الفعل المطلوب، فيُقرأ خللاً لا رفضاً.
 * والفعل المطلوب معروف: دورةُ `RetentionCycle` تمحو التوابع بعد الشهادة عليها.
 *
 * وهي دالّةٌ **نقيّة ومُصدَّرة** لا شرطٌ مدفون في `catch`: الترجمة تُختبر بلا
 * قاعدةٍ حيّة، وفي بيئةٍ بلا قاعدة يبقى مسارُ الرفض مقيساً لا مدّعىً.
 * @param {unknown} error
 * @param {string} table الجدول المقصود بالمحو، ليُسمّى في الرفض.
 * @returns {RetentionError | null} رفضٌ مُسمّى، أو `null` لخطأٍ ليس خطأ مرجع.
 */
export function dependentFault(error, table) {
  if (typeof error !== 'object' || error === null) return null;
  const code = /** @type {{ code?: unknown }} */ (error).code;
  if (code !== '23503') return null;
  const constraint = /** @type {{ constraint?: unknown }} */ (error).constraint;
  const detail = typeof constraint === 'string' && constraint !== '' ? constraint : 'غير مسمّى';
  return new RetentionError(
    RETENTION_ERRORS.DEPENDENTS_PRESENT,
    `محو ${table} مرفوض: ما زالت له صفوفٌ تابعة ترجع إليه (القيد: ${detail}). والتوابع لا تُحذف أثراً جانبياً لحدفٍ عابر: امحُ بدورة الاحتفاظ المحكومة (RetentionCycle.run) فتُشهد على عدد التوابع ورأس سلسلتها قبل زوالها.`,
  );
}

/**
 * @typedef {'retention_days' | 'expires_at' | 'never'} RetentionEnd
 */

/**
 * @typedef {object} RetentionPolicy
 * @property {'data_assets' | 'memories' | 'events'} key مفتاح الأداة الآمن.
 * @property {'state.data_assets' | 'state.memories' | 'state.events'} table العلاقة المقصودة.
 * @property {string} retentionStartColumn عمود بداية الاحتفاظ.
 * @property {RetentionEnd} endsBy طريقة تحديد النهاية.
 * @property {boolean} legalHoldProtected هل الحفظ القانوني يحمي الصف.
 */

/**
 * @typedef {object} RetentionReportRow
 * @property {RetentionPolicy['table']} table
 * @property {number} eligible عدد المنتهي المسموح بمحوِه.
 * @property {number} legalHoldProtected عدد المنتهي المحمي قانوناً.
 */

/**
 * @typedef {object} RetentionReport
 * @property {Date} now
 * @property {RetentionReportRow[]} tables
 */

/**
 * @typedef {object} PurgeReportRow
 * @property {RetentionPolicy['table']} table
 * @property {number} eligible عدد ما كان مؤهلاً عند بدء المعاملة.
 * @property {number} legalHoldProtected عدد ما كان محمياً قانوناً عند بدء المعاملة.
 * @property {number} deleted عدد ما حُذف؛ يساوي صفراً في المحاكاة.
 */

/**
 * @typedef {object} PurgeReport
 * @property {Date} now
 * @property {boolean} dryRun
 * @property {PurgeReportRow[]} tables
 */

/**
 * اقتباس معرف PostgreSQL. لا يقبل هذا التابع إلا أجزاء سياسة داخلية ثابتة.
 * @param {string} identifier
 * @returns {string}
 */
function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * @param {RetentionPolicy['table']} table
 * @returns {string}
 */
function quoteRelation(table) {
  return table
    .split('.')
    .map((part) => quoteIdentifier(part))
    .join('.');
}

/**
 * السياسة المعلنة الوحيدة للمحو. لا يضاف جدول إليها إلا بعد قرار مالك البيانات
 * وتوثيق أساس احتفاظه؛ وجود جدول في المخطط وحده لا يجيز محوه.
 * @type {Readonly<Record<RetentionPolicy['key'], RetentionPolicy>>}
 */
export const RETENTION_POLICIES = Object.freeze({
  data_assets: Object.freeze({
    key: 'data_assets',
    table: 'state.data_assets',
    retentionStartColumn: 'created_at',
    endsBy: 'retention_days',
    legalHoldProtected: true,
  }),
  memories: Object.freeze({
    key: 'memories',
    table: 'state.memories',
    retentionStartColumn: 'created_at',
    endsBy: 'expires_at',
    legalHoldProtected: true,
  }),
  events: Object.freeze({
    key: 'events',
    table: 'state.events',
    retentionStartColumn: 'recorded_at',
    endsBy: 'never',
    legalHoldProtected: false,
  }),
});

const POLICY_LIST = Object.freeze(Object.values(RETENTION_POLICIES));
const PURGEABLE_POLICY_LIST = Object.freeze(
  POLICY_LIST.filter((policy) => policy.endsBy !== 'never'),
);

/**
 * @param {Date} now
 * @returns {void}
 */
function assertNow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RetentionError(
      RETENTION_ERRORS.INVALID_NOW,
      '`now` يجب أن يكون تاريخاً صالحاً؛ تاريخ غير صالح قد يمحو بحدّ غير معلوم.',
    );
  }
}

/**
 * @param {RetentionPolicy} policy
 * @returns {string | null} شرط الانتهاء، أو null لجدول له حد محو معلن.
 */
function expiryCondition(policy) {
  const start = quoteIdentifier(policy.retentionStartColumn);
  switch (policy.endsBy) {
    case 'retention_days':
      return `(${start} + make_interval(days => ${quoteIdentifier('retention_days')})) <= $1`;
    case 'expires_at':
      return `${quoteIdentifier('expires_at')} IS NOT NULL AND ${quoteIdentifier('expires_at')} <= $1`;
    case 'never':
      return null;
  }
}

/**
 * @param {RetentionPolicy} policy
 * @returns {{ eligible: string, held: string } | null}
 */
function eligibilityConditions(policy) {
  const expired = expiryCondition(policy);
  if (expired === null) return null;
  if (!policy.legalHoldProtected) return { eligible: expired, held: 'FALSE' };
  const hold = quoteIdentifier('legal_hold');
  return {
    eligible: `${expired} AND NOT ${hold}`,
    held: `${expired} AND ${hold}`,
  };
}

/**
 * @param {RetentionPolicy} policy
 * @param {import('pg').Pool | import('pg').PoolClient} client
 * @param {Date} now
 * @returns {Promise<RetentionReportRow>}
 */
async function countPolicy(policy, client, now) {
  const conditions = eligibilityConditions(policy);
  if (conditions === null) {
    return { table: policy.table, eligible: 0, legalHoldProtected: 0 };
  }
  const result = await client.query(
    `SELECT
       count(*) FILTER (WHERE ${conditions.eligible})::int AS "eligible",
       count(*) FILTER (WHERE ${conditions.held})::int AS "legalHoldProtected"
     FROM ${quoteRelation(policy.table)}`,
    [now],
  );
  const row = /** @type {Record<string, unknown> | undefined} */ (result.rows[0]);
  if (row === undefined) {
    throw new Error(`لم يُعِد عدّ الاحتفاظ صفاً للجدول ${policy.table}.`);
  }
  return {
    table: policy.table,
    eligible: Number(row['eligible']),
    legalHoldProtected: Number(row['legalHoldProtected']),
  };
}

/**
 * @param {readonly string[] | undefined} requested
 * @param {boolean} defaultToPurgeable
 * @returns {RetentionPolicy[]}
 */
function selectPolicies(requested, defaultToPurgeable) {
  if (requested === undefined)
    return [...(defaultToPurgeable ? PURGEABLE_POLICY_LIST : POLICY_LIST)];
  /** @type {RetentionPolicy[]} */
  const selected = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const key of requested) {
    const policy = RETENTION_POLICIES[/** @type {RetentionPolicy['key']} */ (key)];
    if (policy === undefined) {
      throw new RetentionError(
        RETENTION_ERRORS.UNKNOWN_TABLE,
        `جدول احتفاظ غير معلن: ${key}. المسموح: ${Object.keys(RETENTION_POLICIES).join(', ')}.`,
      );
    }
    if (!seen.has(key)) {
      selected.push(policy);
      seen.add(key);
    }
  }
  return selected;
}

/**
 * التقرير الجاف: لا يحذف شيئاً، ويعرض المنتهي المسموح وحالات الانتهاء المحمية
 * بحفظ قانوني. `state.events` يظهر بصفرين لأن له حد محو معلن لا مدة احتفاظ.
 * @param {import('pg').Pool} pool
 * @param {{ now: Date }} options
 * @returns {Promise<RetentionReport>}
 */
export async function plan(pool, { now }) {
  assertNow(now);
  const rows = await Promise.all(POLICY_LIST.map((policy) => countPolicy(policy, pool, now)));
  return { now: new Date(now.getTime()), tables: rows };
}

/**
 * رفضُ المحوِ الخامِ — نتيجةُ `R6-A-11` (مجلسُ النماذجِ).
 *
 * **العيبُ المُقاسُ:** كانت `purge` و`eraseById` تُصدِرانِ `DELETE` على
 * `state.memories` و`state.data_assets` مباشرةً — بلا نداءٍ إلى
 * `EnforcementPoint.authorize` على الفعلِ `purge-data` (وهو فوقَ العتبةِ
 * السياديّةِ)، وبلا سجلِّ محوٍ في دفترِ المحوِ. وإغلاقُ سطرِ الأوامرِ وحاجزُ
 * `scripts/` لا يُغلقانِ الدالّتينِ نفسَيهما: كلُّ مستوردٍ للوحدةِ كان يمحو.
 *
 * **والإصلاحُ إزالةٌ لا سلطةٌ ثانية:** لا مستهلِكَ إنتاجيّاً لهما في `src/` ولا
 * `scripts/`، والمسارُ المحكومُ قائمٌ: `RetentionCycle.run` في
 * `src/data/retention-cycle.mjs` يُفوِّضُ عبرَ نقطةِ التفويضِ ويستهلكُ تذكرةَ
 * القرارِ ويشهدُ في دفترِ المحوِ قبلَ الحذفِ (`R6-A-01`). وتذكرتُه تُستهلَكُ
 * داخلَ الدورةِ فلا تخرجُ منها أثراً يُمرَّرُ إلى هنا؛ فاشتراطُ «سلطةٍ» في هذه
 * الوحدةِ كان يعني اختراعَ آليّةٍ ثانيةٍ تفترقُ عن الأولى. فالحذفُ أُزيلَ من
 * هذه الوحدةِ، وما بقيَ قراءةٌ (`plan` و`purge({ dryRun: true })`).
 * @param {string} target ما طُلِبَ محوُه، ليُسمّى في الرفض.
 * @returns {RetentionError}
 */
function rawPurgeRefused(target) {
  return new RetentionError(
    RETENTION_ERRORS.PURGE_UNAUTHORIZED,
    `محوُ ${target} مرفوضٌ من هذه الوحدة: المحوُ فعلٌ محكومٌ («purge-data») فوقَ العتبةِ السياديّةِ، ولا يقعُ إلا عبرَ دورةِ الاحتفاظِ المحكومةِ (RetentionCycle.run في src/data/retention-cycle.mjs) بقرارٍ من نقطةِ التفويضِ وشاهدٍ في دفترِ المحو (R6-A-11).`,
  );
}

/**
 * التقريرُ الجافُّ للمحوِ الدوريِّ. بلا `dryRun: true` يُرفَضُ الطلبُ برمزِ
 * `RETENTION_PURGE_UNAUTHORIZED` **قبلَ أيِّ اتصالٍ بالقاعدة** (`R6-A-11`)؛
 * والتحقّقُ من المُدخلِ يسبقُ الرفضَ فتبقى رموزُه كما هي: طلبُ `events` صراحةً
 * يفشلُ بـ`RETENTION_EVENTS_IMMUTABLE`.
 * @param {import('pg').Pool} pool
 * @param {{ now: Date, tables?: readonly string[], dryRun?: boolean }} options
 * @returns {Promise<PurgeReport>}
 */
export async function purge(pool, { now, tables, dryRun = false }) {
  assertNow(now);
  const selected = selectPolicies(tables, true);
  const eventsRequested = selected.some((policy) => policy.endsBy === 'never');
  if (eventsRequested) {
    throw new RetentionError(
      RETENTION_ERRORS.EVENTS_IMMUTABLE,
      'محو state.events مرفوض: أي حذف يقطع مرآة سلسلة التجزئة المتصلة.',
    );
  }
  if (!dryRun) {
    throw rawPurgeRefused(selected.map((policy) => policy.table).join(', '));
  }
  const report = await Promise.all(selected.map((policy) => countPolicy(policy, pool, now)));
  return {
    now: new Date(now.getTime()),
    dryRun: true,
    tables: report.map((row) => ({ ...row, deleted: 0 })),
  };
}

/**
 * المحوُ الموجَّهُ مرفوضٌ من هذه الوحدةِ (`R6-A-11`): يُتحقَّقُ من مفتاحِ السياسةِ
 * ثمّ يُرفَضُ برمزِ `RETENTION_PURGE_UNAUTHORIZED` قبلَ أيِّ اتصالٍ بالقاعدة.
 * والمحوُ الموجَّهُ المحكومُ هو `RetentionCycle` في `src/data/retention-cycle.mjs`.
 * @param {import('pg').Pool} _pool
 * @param {string} table مفتاح سياسة معلن، لا اسم SQL.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function eraseById(_pool, table, id) {
  const policies = selectPolicies([table], false);
  const policy = policies[0];
  if (policy === undefined) {
    throw new Error('اختيار سياسة فارغ على خلاف العقد.');
  }
  if (policy.endsBy === 'never') {
    throw new RetentionError(
      RETENTION_ERRORS.EVENTS_IMMUTABLE,
      'محو state.events مرفوض: أي حذف يقطع مرآة سلسلة التجزئة المتصلة.',
    );
  }
  throw rawPurgeRefused(`${policy.table} بالمعرّف ${id}`);
}
