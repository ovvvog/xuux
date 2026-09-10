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
