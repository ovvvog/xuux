/**
 * اختباراتُ إعلانِ شهادةِ جهةِ الإصدارِ في وصلةِ القاعدةِ — سدادُ الدَينِ `D-12`.
 *
 * العَيبُ المقيسُ الذي أُغلِقَ: كانت `createPool` تُثبِّتُ `rejectUnauthorized: true`
 * **بلا سبيلٍ إلى تمريرِ شهادةِ جهةٍ مُصدِّرةٍ**، فكلُّ قاعدةٍ مُدارةٍ تُوقِّعُ شهادتَها
 * بجهةٍ خاصّةٍ كانت غيرَ قابلةٍ للوصلِ، وقِيسَ الفشلُ برمزِ `SELF_SIGNED_CERT_IN_CHAIN`.
 *
 * والاختبارُ هنا يقيسُ أمرَينِ لا أمراً واحداً:
 *
 * 1. **أنّ الشهادةَ تُعلَنُ وتُقرأُ**، وأنّ إعلاناً لا يُقرأُ يَفشلُ **مُغلَقاً** عند
 *    حلِّ الإعدادِ لا عند أوّلِ استعلامٍ — فالعَطَبُ يُكشَفُ قبلَ الإنتاجِ.
 * 2. **أنّه لا يوجدُ في الوحدةِ طريقٌ يُسقِطُ التحقُّقَ** — وهذا هو الاختبارُ الذي
 *    يمنعُ الارتدادَ الحقيقيَّ: مَن أراد أن يَصِلَ بسرعةٍ يومَ يضيقُ الوقتُ سيكتبُ
 *    `rejectUnauthorized: false`، فيَمُرُّ النقلُ مُعمّىً بلا تحقُّقٍ من الطرفِ
 *    ويُقبَلُ وسيطٌ يعترضُ. فالنصُّ نفسُه مقيسٌ هنا.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  DB_ERRORS,
  DatabaseConfigError,
  resolveDatabaseConfig,
} from '../../src/persistence/db.mjs';

const MODULE_PATH = fileURLToPath(new URL('../../src/persistence/db.mjs', import.meta.url));

/** وصلةٌ بعيدةٌ تطلبُ TLS — مضيفٌ غيرُ محلّيٍّ كي يُقاسَ مسارُ الشهادةِ فعلاً. */
const REMOTE_TLS_URL = 'postgresql://u:p@db.example.com:5432/postgres?sslmode=verify-full';

/** شهادةٌ صوريّةٌ: المقصودُ صيغةُ الإعلانِ لا صلاحيةُ التوقيعِ. */
const FAKE_PEM = '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n';

/**
 * يكتبُ ملفاً مؤقتاً ويُعيدُ مسارَه.
 * @param {string} contents
 * @param {string} [name]
 * @returns {string}
 */
function tempFile(contents, name = 'ca.crt') {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'db-ca-')));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

test('الشهادةُ المُمرَّرةُ نصّاً تُعادُ في الإعدادِ', () => {
  const config = resolveDatabaseConfig({
    url: REMOTE_TLS_URL,
    environment: 'development',
    ca: FAKE_PEM,
  });
  assert.equal(config.tls, true);
  assert.equal(config.ca, FAKE_PEM);
});

test('الشهادةُ تُقرأُ من مسارٍ مُمرَّرٍ', () => {
  const file = tempFile(FAKE_PEM);
  const config = resolveDatabaseConfig({
    url: REMOTE_TLS_URL,
    environment: 'development',
    caFile: file,
  });
  assert.equal(config.ca, FAKE_PEM);
});

test('الشهادةُ تُقرأُ من `DATABASE_CA_FILE` حين لا يُمرَّرُ وسيطٌ', () => {
  const file = tempFile(FAKE_PEM);
  const previous = process.env.DATABASE_CA_FILE;
  process.env.DATABASE_CA_FILE = file;
  try {
    const config = resolveDatabaseConfig({ url: REMOTE_TLS_URL, environment: 'development' });
    assert.equal(config.ca, FAKE_PEM);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_CA_FILE;
    else process.env.DATABASE_CA_FILE = previous;
  }
});

test('وسيطُ النداءِ يسبقُ البيئةَ فلا يُلوَّثُ الاختبارُ بمتغيّرٍ عالميٍّ', () => {
  const envFile = tempFile('-----BEGIN CERTIFICATE-----\nRU5W\n-----END CERTIFICATE-----\n');
  const previous = process.env.DATABASE_CA_FILE;
  process.env.DATABASE_CA_FILE = envFile;
  try {
    const config = resolveDatabaseConfig({
      url: REMOTE_TLS_URL,
      environment: 'development',
      ca: FAKE_PEM,
    });
    assert.equal(config.ca, FAKE_PEM);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_CA_FILE;
    else process.env.DATABASE_CA_FILE = previous;
  }
});

test('مسارُ شهادةٍ لا يُقرأُ يَفشلُ مُغلَقاً بـ`DB_CA_UNREADABLE`', () => {
  assert.throws(
    () =>
      resolveDatabaseConfig({
        url: REMOTE_TLS_URL,
        environment: 'development',
        caFile: path.join(os.tmpdir(), 'لا-وجود-له-قطعاً.crt'),
      }),
    (error) => {
      assert.ok(error instanceof DatabaseConfigError);
      assert.equal(error.code, DB_ERRORS.CA_UNREADABLE);
      return true;
    },
  );
});

test('ملفٌّ حاضرٌ بلا صيغةِ PEM يَفشلُ مُغلَقاً لا يُقبَلُ صامتاً', () => {
  const file = tempFile('هذا ليس شهادةً\n');
  assert.throws(
    () => resolveDatabaseConfig({ url: REMOTE_TLS_URL, environment: 'development', caFile: file }),
    (error) => {
      assert.equal(/** @type {DatabaseConfigError} */ (error).code, DB_ERRORS.CA_UNREADABLE);
      return true;
    },
  );
});

test('`DATABASE_CA` نصّاً بلا صيغةِ PEM يَفشلُ مُغلَقاً', () => {
  const previous = process.env.DATABASE_CA;
  process.env.DATABASE_CA = 'ليس شهادةً';
  try {
    assert.throws(
      () => resolveDatabaseConfig({ url: REMOTE_TLS_URL, environment: 'development' }),
      (error) => {
        assert.equal(/** @type {DatabaseConfigError} */ (error).code, DB_ERRORS.CA_UNREADABLE);
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.DATABASE_CA;
    else process.env.DATABASE_CA = previous;
  }
});

test('بلا إعلانٍ تبقى الشهادةُ `null` — أي مخزنُ الثقةِ الافتراضيُّ لا إسقاطُ تحقُّقٍ', () => {
  const previousFile = process.env.DATABASE_CA_FILE;
  const previousInline = process.env.DATABASE_CA;
  delete process.env.DATABASE_CA_FILE;
  delete process.env.DATABASE_CA;
  try {
    const config = resolveDatabaseConfig({ url: REMOTE_TLS_URL, environment: 'development' });
    assert.equal(config.tls, true);
    assert.equal(config.ca, null);
  } finally {
    if (previousFile !== undefined) process.env.DATABASE_CA_FILE = previousFile;
    if (previousInline !== undefined) process.env.DATABASE_CA = previousInline;
  }
});

test('وصلةٌ بلا TLS لا تحملُ شهادةً ولو أُعلِنَت — فلا تُوهِمُ بتأمينٍ لا يقعُ', () => {
  const config = resolveDatabaseConfig({
    url: 'postgresql://u:p@127.0.0.1:5432/postgres',
    environment: 'development',
    ca: FAKE_PEM,
  });
  assert.equal(config.tls, false);
  assert.equal(config.ca, null);
});

test('لا طريقَ في الوحدةِ يُسقِطُ التحقُّقَ من الشهادةِ', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  // النصُّ يُقاسُ بعد نزعِ التعليقاتِ: الترويسةُ تشرحُ الخطرَ فتذكرُ اللفظَ، وذِكرُه
  // شرحاً ليس استعمالاً — ولولا النزعُ لكان الاختبارُ يُخفِقُ على توثيقٍ صحيحٍ.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  for (const forbidden of ['rejectUnauthorized: false', 'rejectUnauthorized:false', 'NODE_TLS_']) {
    assert.ok(
      !code.includes(forbidden),
      `وُجِدَ في الكودِ ما يُسقِطُ التحقُّقَ: ${forbidden} — وهذا ارتدادٌ لا تخفيفٌ.`,
    );
  }
  assert.ok(
    code.includes('rejectUnauthorized: true'),
    'اختفى تثبيتُ `rejectUnauthorized: true` من الوحدةِ.',
  );
  // ولا يُشتقُّ التحقُّقُ من متغيّرٍ: `true` مثبَّتةٌ حرفاً لا محسوبةً من بيئةٍ.
  assert.ok(
    !/rejectUnauthorized:(?!\s*true)/.test(code),
    '`rejectUnauthorized` صار محسوباً لا مثبَّتاً — فقد يُصبحُ `false` ببيئةٍ.',
  );
});
