/**
 * `R6-B-03` — القياسُ على قاعدةِ PostgreSQL **حقيقيّةٍ** عبرَ TLS، لا على مُحاكيٍ.
 *
 * النتيجةُ: وصلةُ `DATABASE_URL` المُعلَنةُ للجولةِ (‏`sslmode=require` إلى قاعدةٍ
 * تُوقِّعُ شهادتَها جهةٌ خاصّةٌ) كانت تَسقُطُ بـ`SELF_SIGNED_CERT_IN_CHAIN`. والإصلاحُ
 * (‏`PR #99`) قُرِئَ في الجولةِ السابعةِ ولم يُقَسْ على قاعدةٍ حقيقيّةٍ: «لا قياسَ لاتصالِ
 * قاعدةٍ حقيقيّة» (‏`gpt_6_astra`) و«فرعُ الشهادةِ الذاتيّةِ لم يُشغَّل» (‏`grok_4_7`).
 *
 * فقياسُ `WL-357` (‏`tests/persistence/db-tls-handshake.test.mjs`) أغلقَ شطرَ **السلكِ**
 * من الفجوةِ: خادمٌ يتكلّمُ بروتوكولَ PostgreSQL على مِقبسٍ حقيقيٍّ — **مُحاكٍ لا
 * PostgreSQL نفسُه**، وحدُّه المُعلَنُ هناك. وهذا الملفُّ يقيسُ الشطرَ الثاني: خادمُ
 * `postgres` حقيقيٌّ مُشغَّلٌ بـ`ssl=on` وشهادةٍ موقَّعةٍ من جهةِ إصدارٍ مولَّدةٍ في
 * التشغيلةِ (خطوةُ CI المخصّصةِ)، فتُقاسُ المصافحةُ والاعتمادُ والحاجزُ على القاعدةِ
 * الحقيقيّةِ نفسِها.
 *
 * **عقدٌ لا رغبةٌ (عُرفُ `UF-14`/`XUUX_HSM_TEST`):** `XUUX_REAL_PG_TLS=1` مع غيابِ
 * الخادمِ **فشلٌ باسمِه** لا تخطٍّ؛ وبلا إعلانِ المتغيّرِ ⇒ تخطٍّ مُعلَّنٌ بسببِه —
 * فالقاعدةُ الحقيقيّةُ لا تتوفّرُ إلا في خطوةِ CI (‏ولا Docker في بيئةِ القياسِ).
 *
 * والدعاوى المقيسةُ، وكلٌّ يسقطُ وحدَه إن انكسر:
 * 1. المصافحةُ تعبرُ بالشهادةِ المُعلَنةِ (‏`DATABASE_CA_FILE`) والقناةُ مُعمّاةٌ
 *    **مقروءةً من القاعدةِ نفسِها** (‏`pg_stat_ssl`)، والخادمُ PostgreSQL فعلاً.
 * 2. بلا شهادةٍ مُعلَنةٍ ⇐ `SELF_SIGNED_CERT_IN_CHAIN` (مسارُ النتيجةِ بحرفِه على قاعدةٍ
 *    حقيقيّةٍ هذه المرّة).
 * 3. بجهةِ إصدارٍ أخرى ⇐ رفضٌ: الشهادةُ المُعلَنةُ مِرساةٌ لا إسقاطُ تحقُّق.
 * 4. `guard:encryption` **عمليّةً منفصلةً** بالوصلةِ المُعلَنةِ والشهادةِ ⇐ يخرجُ `0`
 *    ويقرأُ كلَّ مخزنٍ معلَنٍ عبرَ القناةِ المُعمّاةِ؛ وبلا الشهادةِ ⇐ يخرجُ غيرَ صفريٍّ
 *    بالرمزِ نفسِه.
 *
 * **حدٌّ مُعلَنٌ:** الخادمُ حاويةُ `postgres:18.6-alpine` في CI — قاعدةٌ حقيقيّةٌ كاملةً
 * لا مُحاكيُ بروتوكولٍ، لكنّها ليست قاعدةَ مزوِّدٍ مُدارٍ بإدارةٍ بشريّةٍ؛ ولا يُقاسُ هنا
 * توزيعُ الشهاداتِ ولا تدويرُها.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import test, { describe } from 'node:test';

import { createPool } from '../../src/persistence/db.mjs';

const execFileAsync = promisify(execFile);

const ENABLED = process.env.XUUX_REAL_PG_TLS === '1';
const TLS_URL = process.env.DATABASE_URL ?? '';
const CA_FILE = process.env.DATABASE_CA_FILE ?? '';

// تخطٍّ مُعلَّلٌ كما في عُرفِ `UF-14`: الغيابُ في بيئةٍ بلا خادمِ قاعدةٍ حقيقيٍّ
// (المنفِّذُ وقياسُ خطِّ الأساسِ) تخطٍّ بسببِه، لا نجاحٌ صامتٌ يُقرأُ قياساً.
const skip = !ENABLED;
const skipReason = skip
  ? 'XUUX_REAL_PG_TLS=1 غيرُ مُعلَنٍ — يحتاجُ خادمَ PostgreSQL حقيقيّاً مُشغَّلاً بـTLS (خطوةُ CI المخصّصةُ، لا بيئةَ المنفِّذِ)'
  : false;
/**
 * اختبارٌ مُخطَّى بسببهِ عندَ غيابِ عقدِ البيئةِ (نمطُ `UF-14`).
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
function gatedTest(name, fn) {
  test(name, { skip: skipReason }, fn);
}
const it = skipReason ? gatedTest : test;

/**
 * يعزلُ الاختبارَ عن شهادةٍ في بيئةِ المُشغِّلِ: «بلا شهادةٍ مُعلَنةٍ» يعني بلا شهادةٍ فعلاً.
 * @returns {() => void} مُعيدُ البيئةِ كما كانت
 */
function isolateCaEnv() {
  const saved = { file: process.env['DATABASE_CA_FILE'], pem: process.env['DATABASE_CA'] };
  delete process.env['DATABASE_CA_FILE'];
  delete process.env['DATABASE_CA'];
  return () => {
    if (saved.file !== undefined) process.env['DATABASE_CA_FILE'] = saved.file;
    if (saved.pem !== undefined) process.env['DATABASE_CA'] = saved.pem;
  };
}

/**
 * يُبدِّلُ المِرساةَ المُعلَنةَ مؤقّتاً ويُعيدُ البيئةَ كما كانت — لإحاكاةِ الوصلةِ
 * بجهةِ إصدارٍ أجنبيّةٍ دونَ مساسٍ ببقيّةِ البيئةِ.
 * @param {string} file
 * @returns {() => void}
 */
function swapCaFile(file) {
  const saved = process.env['DATABASE_CA_FILE'];
  process.env['DATABASE_CA_FILE'] = file;
  return () => {
    if (saved === undefined) delete process.env['DATABASE_CA_FILE'];
    else process.env['DATABASE_CA_FILE'] = saved;
  };
}

/**
 * يُعيدُ رمزَ خطأِ الوصلةِ أوّلَ استعلامٍ — أو `null` إن نجح.
 * @param {import('pg').Pool} pool
 * @returns {Promise<string | null>}
 */
async function firstQueryError(pool) {
  try {
    await pool.query('SELECT 1');
    return null;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code ?? String(error);
  } finally {
    await pool.end();
  }
}

/**
 * يُشغِّلُ الحاجزَ عمليّةً منفصلةً ببيئةٍ مُعدَّلةٍ ويُعيدَ { code, stderr }.
 * @param {{ caFile?: string }} env
 * @returns {Promise<{ code: number | string | null, stderr: string }>}
 */
async function runGuard(env) {
  try {
    await execFileAsync(process.execPath, ['scripts/guard-encryption.mjs'], {
      env: { ...process.env, ...(env.caFile ? { DATABASE_CA_FILE: env.caFile } : {}) },
    });
    return { code: 0, stderr: '' };
  } catch (error) {
    const err = /** @type {import('node:child_process').ExecFileException} */ (error);
    return { code: err.code ?? null, stderr: err.stderr ?? '' };
  }
}

describe('R6-B-03 على قاعدةِ PostgreSQL حقيقيّةٍ عبرَ TLS (خطوةُ CI المخصّصةُ)', () => {
  it('XUUX_REAL_PG_TLS=1 عقدٌ: الوصلةُ والشهادةُ المُعلَنتانِ في البيئةِ شرطا القياسِ', () => {
    assert.match(TLS_URL, /^postgresql:\/\//, 'DATABASE_URL غائبٌ أو ليس وصلةَ PostgreSQL');
    assert.match(TLS_URL, /sslmode=require/u, 'الوصلةُ المُعلَنةُ ليست بـsslmode=require');
    assert.notEqual(CA_FILE, '', 'DATABASE_CA_FILE غائبٌ — القياسُ بلا مِرساةٍ ليس قياساً');
  });

  it('المصافحةُ تعبرُ بالشهادةِ والقناةُ مُعمّاةٌ مقروءةً من القاعدةِ نفسِها والخادمُ PostgreSQL فعلاً', async () => {
    const pool = createPool();
    try {
      const version = /** @type {{ rows: { version: string }[] }} */ (
        await pool.query('SELECT version()')
      );
      assert.match(
        String(version.rows[0]?.version ?? ''),
        /PostgreSQL/u,
        'الخادمُ ليس PostgreSQL — القياسُ على غيرِ المُدَّعى',
      );
      // القناةُ المُعمّاةُ تُقرأُ من القاعدةِ نفسِها لا من تفسيرِ العميلِ: عمودُ `ssl`
      // في `pg_stat_ssl` لوصلتِنا هو شهادةُ الخادمِ على أنّ التشفيرَ وقعَ فعلاً.
      // (‏`pg` يُعيدُ العمودَ البوليانيَّ `true` لا الحرفَ `'t'` — يُقبلُ الاثنانِ فلا
      // يعتمدُ القياسُ على تمثيلِ المُشغِّلِ.)
      const ssl = /** @type {{ rows: { ssl: string | boolean }[] }} */ (
        await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')
      );
      assert.ok(
        ssl.rows[0]?.ssl === 't' || ssl.rows[0]?.ssl === true,
        'القناةُ ليست مُعمّاةً في رأيِ القاعدةِ نفسِها',
      );
    } finally {
      await pool.end();
    }
  });

  it('بلا شهادةٍ مُعلَنةٍ تسقُطُ المصافحةُ بـSELF_SIGNED_CERT_IN_CHAIN على القاعدةِ الحقيقيّةِ', async () => {
    const restore = isolateCaEnv();
    try {
      const code = await firstQueryError(createPool());
      assert.equal(code, 'SELF_SIGNED_CERT_IN_CHAIN');
    } finally {
      restore();
    }
  });

  it('بجهةِ إصدارٍ أخرى يُرفَضُ الاتصالُ: الشهادةُ المُعلَنةُ مِرساةٌ لا إسقاطُ تحقُّق', async () => {
    // جهةُ إصدارٍ أجنبيّةٌ تولّدها خطوةُ CI في `DATABASE_FOREIGN_CA_FILE`؛ فإن غابَت
    // (تشغيلٌ يدويٌّ ناقصُ التجهيزِ) فالاختبارُ يسقُطُ باسمِه لا يتخطّى.
    const foreign = process.env.DATABASE_FOREIGN_CA_FILE ?? '';
    assert.notEqual(foreign, '', 'DATABASE_FOREIGN_CA_FILE غائبٌ — لا قياسَ للرفضِ بجهةٍ أجنبيّةٍ');
    // المِرساةُ تُبدَّلُ فعلاً لا يُكتفَى بوجودِها: فالوصلةُ تُحاكَمُ بالأجنبيّةِ.
    const restoreCa = swapCaFile(foreign);
    try {
      const code = await firstQueryError(createPool());
      assert.notEqual(code, null, 'اتصالٌ بجهةِ إصدارٍ أجنبيّةٍ لم يُرفَض');
    } finally {
      restoreCa();
    }
  });

  it('guard:encryption عمليّةً منفصلةً: بالشهادةِ يخرجُ 0 ويقرأُ المخازنَ عبرَ القناةِ، وبلاها يسقُطُ بالرمزِ نفسِه', async () => {
    const withCa = await runGuard({ caFile: CA_FILE });
    assert.equal(withCa.code, 0, `الحاجزُ بالشهادةِ لم ينجح:\n${withCa.stderr}`);

    const restore = isolateCaEnv();
    try {
      const withoutCa = await runGuard({});
      assert.notEqual(withoutCa.code, 0);
      assert.match(withoutCa.stderr, /SELF_SIGNED_CERT_IN_CHAIN/u);
    } finally {
      restore();
    }
  });
});
