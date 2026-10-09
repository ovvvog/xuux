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
 * 4. **جهةُ الإصدارِ تُعلَنُ ولا يُسقَطُ التحقُّقُ** (سدادُ الدَينِ `D-12`).
 *    كانت الوصلةُ تُنشَأُ بـ`rejectUnauthorized: true` **بلا سبيلٍ إلى تمريرِ شهادةِ
 *    جهةٍ مُصدِّرةٍ**، فكلُّ قاعدةٍ مُدارةٍ تُوقِّعُ شهادتَها بجهةٍ خاصّةٍ بها — وهي
 *    الحالةُ الشائعةُ في الخدماتِ المُدارةِ — كانت **غيرَ قابلةٍ للوصلِ أصلاً**،
 *    وقِيسَ ذلك بفشلٍ حقيقيٍّ برمزِ `SELF_SIGNED_CERT_IN_CHAIN`. والطريقُ الذي
 *    يسلكُه الناسُ عند هذا الفشلِ هو `rejectUnauthorized: false`، وهو **إبطالُ
 *    التشفيرِ المُوثَّقِ** لا إصلاحُه: يبقى النقلُ مُعمّىً ويسقطُ التحقُّقُ من
 *    الطرفِ، فيُقبَلُ وسيطٌ يعترضُ. فالحلُّ هنا: **تُعلَنُ الشهادةُ** في
 *    `DATABASE_CA_FILE` (مسارٌ) أو `DATABASE_CA` (نصُّ PEM)، **ولا يوجدُ في هذه
 *    الوحدةِ مفتاحٌ يُسقِطُ التحقُّقَ بحالٍ** — لا متغيّرَ بيئةٍ ولا وسيطَ نداءٍ.
 *    ومَن أعلنَ مساراً لا يُقرأُ فَشِلَ صراحةً بـ`DB_CA_UNREADABLE` عند حلِّ
 *    الإعدادِ، لا عندَ أوّلِ استعلامٍ، ولا سقطَ صامتاً إلى مخزنِ الثقةِ الافتراضيِّ.
 */

import fs from 'node:fs';

import pg from 'pg';

import { loadClassificationLattice } from '../data/classification.mjs';
import { assertSecureTransport, loadEncryptionPolicy } from '../data/encryption.mjs';
import { isProductionRuntime } from '../root-of-trust/production-boot.mjs';

/**
 * يُرجِعُ اسمَ بيئةِ التشغيلِ المعتمدَ بتعريفِ جذرِ الثقةِ لا بتعريفٍ محلّيٍّ.
 * @param {NodeJS.ProcessEnv} env - بيئةُ العملية
 * @returns {string} اسمُ البيئة
 */
function resolveRuntimeEnvironment(env) {
  if (isProductionRuntime(env)) return 'production';
  const stateEnv = (env.STATE_ENV ?? '').trim();
  if (stateEnv !== '') return stateEnv;
  const nodeEnv = (env.NODE_ENV ?? '').trim();
  return nodeEnv !== '' ? nodeEnv : 'development';
}

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
  CA_UNREADABLE: 'DB_CA_UNREADABLE',
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
 * يُعلِنُ شهادةَ جهةِ الإصدارِ إن أُعلِنتْ، ويُفشِلُ مُغلَقاً إن أُعلِنَ ما لا يُقرأُ.
 * الترتيبُ مقصودٌ: وسيطُ النداءِ يسبقُ البيئةَ كي يُختبَرَ بلا تلويثِ `process.env`،
 * والمسارُ يسبقُ النصَّ لأنّ ملفاً على القرصِ لا يُسرَّبُ في قائمةِ عمليّاتٍ.
 * @param {object} options
 * @param {string | undefined} [options.ca] نصُّ PEM مُمرَّرٌ صراحةً.
 * @param {string | undefined} [options.caFile] مسارُ ملفِّ PEM.
 * @returns {string | null}
 */
function resolveCertificateAuthority(options) {
  const inlineArg = options.ca;
  if (typeof inlineArg === 'string' && inlineArg.trim() !== '') return inlineArg;

  const fileArg = options.caFile ?? process.env.DATABASE_CA_FILE;
  if (typeof fileArg === 'string' && fileArg.trim() !== '') {
    try {
      const pem = fs.readFileSync(fileArg.trim(), 'utf8');
      if (!pem.includes('BEGIN CERTIFICATE')) {
        throw new DatabaseConfigError(
          DB_ERRORS.CA_UNREADABLE,
          `DATABASE_CA_FILE لا يحملُ شهادةً بصيغةِ PEM: ${fileArg.trim()}`,
        );
      }
      return pem;
    } catch (error) {
      if (error instanceof DatabaseConfigError) throw error;
      throw new DatabaseConfigError(
        DB_ERRORS.CA_UNREADABLE,
        `DATABASE_CA_FILE مُعلَنٌ ولا يُقرأُ: ${fileArg.trim()} — ${/** @type {Error} */ (error).message}`,
      );
    }
  }

  const inlineEnv = process.env.DATABASE_CA;
  if (typeof inlineEnv === 'string' && inlineEnv.trim() !== '') {
    if (!inlineEnv.includes('BEGIN CERTIFICATE')) {
      throw new DatabaseConfigError(
        DB_ERRORS.CA_UNREADABLE,
        'DATABASE_CA مُعلَنٌ وليس شهادةً بصيغةِ PEM.',
      );
    }
    return inlineEnv;
  }

  return null;
}

/**
 * تحقّق من صلاحية وصلة قاعدة البيانات في البيئة المعطاة، وأعِد أجزاءها.
 * تُصدَّر منفردة كي يُختبر الحرس بلا فتح وصلة فعلية.
 * @param {object} [options]
 * @param {string | undefined} [options.url] الوصلة؛ الافتراضي `process.env.DATABASE_URL`.
 * @param {string | undefined} [options.environment] وضع التشغيل؛ الافتراضي `STATE_ENV` ثم `NODE_ENV`.
 * @param {string | undefined} [options.ca] شهادةُ جهةِ الإصدارِ نصّاً (PEM).
 * @param {string | undefined} [options.caFile] مسارُ ملفِّ شهادةِ جهةِ الإصدارِ.
 * @returns {{ url: URL, environment: string, tls: boolean, ca: string | null }}
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

  // `UF-15`: كان `??` يقرأُ `STATE_ENV=''` قيمةً حاضرةً فيُقرأُ غيرَ إنتاجٍ،
  // وكان التعليقُ يدّعي تكافؤاً مع جذرِ الثقةِ بلا تكافؤ. المصدرُ الآن واحدٌ:
  // `isProductionRuntime`، وهو يقصُّ الفراغَ ويرفضُ القيمَ غيرَ المعلَنة.
  const environment = options.environment ?? resolveRuntimeEnvironment(process.env);
  const production = environment === 'production';
  const tls = requestsTls(url);
  if (production && !tls) {
    throw new DatabaseConfigError(
      DB_ERRORS.INSECURE_IN_PRODUCTION,
      'وصلة بلا TLS مرفوضة في وضع الإنتاج: أضف sslmode=require إلى DATABASE_URL.',
    );
  }
  // ثم شرط المضيف (M7.03): يُطبَّق في كل بيئة، فلا يمرّ نقلٌ نصّي إلى قاعدةٍ على
  // الشبكة لأن اسم البيئة `staging`. والخطأ يُرفع برمز التشفير لا برمز الوصلة،
  // لأن ما اختُرق ليس شكل الوصلة بل سرّية ما يُنقل فيها.
  assertSecureTransport({ host: url.hostname, tls, environment, policy: policy() });

  // الشهادةُ تُحَلُّ هنا لا في `createPool`: مسارٌ مُعلَنٌ لا يُقرأُ عَيبُ إعدادٍ
  // يُكشَفُ عندَ التحقُّقِ، لا عَطَبٌ يظهرُ عندَ أوّلِ استعلامٍ في الإنتاجِ.
  const ca = tls ? resolveCertificateAuthority(options) : null;

  return { url, environment, tls, ca };
}

/**
 * أنشئ مجمّع وصلات. المهلات مُعلنة لا متروكة للافتراض: وصلةٌ تنتظر بلا حدّ
 * تُخفي انقطاعاً وتُحوّله إلى تعليق صامت.
 * @param {object} [options]
 * @param {string | undefined} [options.url]
 * @param {string | undefined} [options.environment]
 * @param {string | undefined} [options.caFile] مسارُ شهادةِ جهةِ الإصدارِ — يُمرَّرُ إلى `resolveDatabaseConfig` كما هو.
 * @param {string | undefined} [options.ca] شهادةُ جهةِ الإصدارِ نصّاً (PEM).
 * @param {number} [options.max]
 * @returns {import('pg').Pool}
 */
export function createPool(options = {}) {
  const { url, tls, ca } = resolveDatabaseConfig(options);
  // `sslmode` يُقرأُ في هذه الوحدةِ وُيُحذَفُ من الوصلةِ قبلَ تمريرِها إلى `pg`.
  // والسببُ مقيسٌ لا نظريٌّ: `pg` يشتقُّ من `sslmode` إعدادَ TLS الخاصَّ به
  // **فيُلغي به كائنَ `ssl` المُمرَّرَ**، فتضيعُ شهادةُ جهةِ الإصدارِ وتفشلُ الوصلةُ
  // بـ`SELF_SIGNED_CERT_IN_CHAIN` مع أنّ الشهادةَ مُعلَنةٌ وصحيحةٌ. فمصدرُ الحقيقةِ
  // واحدٌ: الوصلةُ تُعلِنُ النيّةَ، وهذه الوحدةُ تترجمُها إلى خيارٍ واحدٍ لا يُنازَعُ.
  const dsn = new URL(url.toString());
  dsn.searchParams.delete('sslmode');
  const pool = new pg.Pool({
    connectionString: dsn.toString(),
    max: options.max ?? 8,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    application_name: 'digital-state',
    // `rejectUnauthorized` مُثبَّتٌ على `true` ولا يُمرَّرُ من وسيطٍ ولا من بيئةٍ:
    // خيارٌ واحدٌ يُسقِطُ التحقُّقَ يُستَعمَلُ يومَ يضيقُ الوقتُ، ويبقى. ومَن لزمتْه
    // جهةُ إصدارٍ خاصّةٌ أعلَنَها فَوَصَلَ بتحقُّقٍ كاملٍ، لا أسقطَ التحقُّقَ ليمرُّ.
    ...(tls ? { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } } : {}),
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
