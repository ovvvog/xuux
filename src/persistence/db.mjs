/**
 * وصلة قاعدة البيانات — الخطوة `M3.01`.
 *
 * قاعدتان تحكمان هذه الوحدة:
 *
 * 1. **لا وصلة افتراضية.** لا مُضيف ولا مستخدم ولا كلمة مرور في الكود. الوصلة
 *    تُقرأ من `DATABASE_URL` وحدها، ومن لم يضعها فَشِل صراحةً بـ`DB_URL_MISSING`
 *    لا سقط صامتاً إلى `localhost`. السقوط الصامت إلى قاعدة أخرى هو الطريق إلى
 *    اختبارٍ يكتب في قاعدة إنتاج.
 * 2. **الفشل مُغلَق في الإنتاج** (المادة 9). وصلةٌ بلا TLS في وضع الإنتاج تُرفض
 *    بـ`DB_INSECURE_IN_PRODUCTION`؛ فتسهيلُ `docker-compose.yml` بمصادقة `trust`
 *    لا يُستعمل من حيث لا يُقصد.
 * 3. **التشفير عند النقل شرطٌ على المضيف لا على اسم البيئة** (الخطوة `M7.03`).
 *    القاعدة قبل هذه الخطوة كانت تشترط TLS **في الإنتاج وحده**، فبيئةٌ اسمها
 *    `staging` تحمل بيانات حقيقية كانت تنقل كل صفٍّ نصّاً على الشبكة — والاسم ليس
 *    هو ما يحمي الأسلاك. فصار الشرط: مضيفٌ غير محلي بلا TLS مرفوض في **كل** بيئة
 *    بـ`ENCRYPTION_TRANSPORT_INSECURE`، ولا يُستثنى إلا `loopback` في غير الإنتاج
 *    حيث لا شبكة تُنصت أصلاً. والاستثناء نفسه **بيانٌ** في `config/encryption.yaml`
 *    لا شرطٌ في هذا الملف.
 */

import pg from 'pg';

import { loadClassificationLattice } from '../data/classification.mjs';
import { assertSecureTransport, loadEncryptionPolicy } from '../data/encryption.mjs';

/**
 * سياسة التشفير تُقرأ مرّة واحدة لكل عملية: قراءتها عند كل وصلة تفتح ملفين على
 * كل اتصال، وتجعل تعديلاً وسط التشغيل يُطبَّق على بعض الوصلات دون بعض.
 * @type {import('../data/encryption.mjs').EncryptionPolicy | null}
 */
let transportPolicy = null;

/**
 * @returns {import('../data/encryption.mjs').EncryptionPolicy}
 */
function policy() {
  transportPolicy ??= loadEncryptionPolicy({ lattice: loadClassificationLattice() });
  return transportPolicy;
}

/** رموز أخطاء الوحدة — مثبَّتة نصاً لأن المستدعي يفرّق بها لا بنص الرسالة. */
export const DB_ERRORS = Object.freeze({
  URL_MISSING: 'DB_URL_MISSING',
  URL_INVALID: 'DB_URL_INVALID',
  INSECURE_IN_PRODUCTION: 'DB_INSECURE_IN_PRODUCTION',
});

/** خطأ وصلة يحمل رمزاً مسمّى. */
export class DatabaseConfigError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'DatabaseConfigError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * هل الوصلة تطلب TLS؟ يُقرأ من `sslmode` في الوصلة نفسها لا من متغيّر منفصل،
 * كي لا تتناقض بيئةٌ مع وصلة.
 * @param {URL} url
 * @returns {boolean}
 */
function requestsTls(url) {
  const mode = url.searchParams.get('sslmode');
  return mode === 'require' || mode === 'verify-ca' || mode === 'verify-full';
}

/**
 * تحقّق من صلاحية وصلة قاعدة البيانات في البيئة المعطاة، وأعِد أجزاءها.
 * تُصدَّر منفردة كي يُختبر الحرس بلا فتح وصلة فعلية.
 * @param {object} [options]
 * @param {string | undefined} [options.url] الوصلة؛ الافتراضي `process.env.DATABASE_URL`.
 * @param {string | undefined} [options.environment] وضع التشغيل؛ الافتراضي `STATE_ENV` ثم `NODE_ENV`.
 * @returns {{ url: URL, environment: string, tls: boolean }}
 */
export function resolveDatabaseConfig(options = {}) {
  const raw = options.url ?? process.env.DATABASE_URL;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new DatabaseConfigError(
      DB_ERRORS.URL_MISSING,
      'DATABASE_URL غير معلَنة. لا وصلة افتراضية في هذا المشروع: أعلنها أو شغّل docker compose up -d.',
    );
  }

  /** @type {URL} */
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new DatabaseConfigError(DB_ERRORS.URL_INVALID, 'DATABASE_URL ليست وصلة صالحة.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new DatabaseConfigError(
      DB_ERRORS.URL_INVALID,
      `مخطَّط وصلة غير مدعوم: ${url.protocol} — المدعوم postgres:// وحده (قرار docs/adr/0001-postgresql.md).`,
    );
  }

  const environment =
    options.environment ?? process.env.STATE_ENV ?? process.env.NODE_ENV ?? 'development';
  const tls = requestsTls(url);
  if (environment === 'production' && !tls) {
    throw new DatabaseConfigError(
      DB_ERRORS.INSECURE_IN_PRODUCTION,
      'وصلة بلا TLS مرفوضة في وضع الإنتاج: أضف sslmode=require إلى DATABASE_URL.',
    );
  }
  // ثم شرط المضيف (M7.03): يُطبَّق في كل بيئة، فلا يمرّ نقلٌ نصّي إلى قاعدةٍ على
  // الشبكة لأن اسم البيئة `staging`. والخطأ يُرفع برمز التشفير لا برمز الوصلة،
  // لأن ما اختُرق ليس شكل الوصلة بل سرّية ما يُنقل فيها.
  assertSecureTransport({ host: url.hostname, tls, environment, policy: policy() });

  return { url, environment, tls };
}

/**
 * أنشئ مجمّع وصلات. المهلات مُعلنة لا متروكة للافتراض: وصلةٌ تنتظر بلا حدّ
 * تُخفي انقطاعاً وتُحوّله إلى تعليق صامت.
 * @param {object} [options]
 * @param {string | undefined} [options.url]
 * @param {string | undefined} [options.environment]
 * @param {number} [options.max]
 * @returns {import('pg').Pool}
 */
export function createPool(options = {}) {
  const { url, tls } = resolveDatabaseConfig(options);
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: options.max ?? 8,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    application_name: 'digital-state',
    ...(tls ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  // خطأ في وصلة خاملة يرفعه المجمّع على مستوى المجمّع لا على مستوى الاستعلام،
  // ومن لم يستمع له أسقط العملية كلها بخطأ غير ممسوك.
  pool.on('error', (error) => {
    console.error('[db] خطأ في وصلة خاملة:', error.message);
  });
  return pool;
}

/**
 * نفّذ عملاً داخل معاملة واحدة: `COMMIT` عند النجاح و`ROLLBACK` عند أي إخفاق.
 * أساسُ الذرّية التي تُثبَّت في الخطوة `M3.06`، ويستعملها المُهاجر اليوم.
 * @template T
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // الاستعادة نفسها قد تفشل إن سقطت الوصلة؛ يُطبع سببها ويُرفع الخطأ الأصلي
    // لأنه هو ما يفسّر ما جرى، لا فشل التنظيف بعده.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        '[db] تعذّر التراجع بعد إخفاق:',
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
