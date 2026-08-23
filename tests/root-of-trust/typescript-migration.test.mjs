// اختبار نقل جذر الثقة إلى TypeScript — يحرس ما أُنجز في M2.01 من الانحدار.
// السبب: النقل قابل للتراجع بصمت. يكفي أن يُنشئ أحدهم ملف `.mjs` بيده داخل
// src/root-of-trust فيصير نصف الجذر مفحوصاً بـ TypeScript ونصفه بـ JSDoc،
// أو أن تُحذف خطوة البناء من `pretest` فتُختبر شجرة قديمة مولّدة سابقاً.
// هذا الاختبار يجعل كلا الارتدادين مكشوفاً.
// التشغيل: node --test tests/root-of-trust/typescript-migration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const trustDir = join(repoRoot, 'src', 'root-of-trust');

// الوحدات تُشتق من ملفات .mts على القرص لا من قائمة مكتوبة بيد. السبب: القائمة
// اليدوية تُنسى عند إضافة وحدة — وقد حدث ذلك فعلاً في M2.02 حين أُضيفت ثلاث
// وحدات — فتمرّ وحدة جديدة بلا حراسة. والاشتقاق من القرص لا من Git بقصد: قياس
// حالة Git هنا كان يُفشل الاختبار على وحدة كُتبت ولم تُدرَج بعد، وهو إزعاج بلا
// فائدة. وحراسة Git تبقى في موضعها الصحيح: منع التزام أي .mjs في هذا المجلد.
// والاشتقاق ليس دورانياً، لأن قائمة النواة الإلزامية أدناه تحرس الاشتقاق نفسه.
const MODULES = readdirSync(trustDir)
  .filter((f) => f.endsWith('.mts') && !f.endsWith('.d.mts'))
  .map((f) => f.replace(/\.mts$/, ''))
  .sort();

/** نواة لا يجوز أن تغيب بحال؛ حراسة على الاشتقاق نفسه. */
const REQUIRED_MODULES = [
  'identity',
  'event-log',
  'crown',
  'policy',
  'persistent-log',
  'key-store',
  'key-provider',
  'king-key',
  'king-key-rotation',
  'command-ledger',
  'index',
];

test('اشتقاق وحدات الجذر سليم: النواة الإلزامية كلها حاضرة', () => {
  assert.ok(MODULES.length >= REQUIRED_MODULES.length, 'اشتقاق الوحدات أرجع قائمة ناقصة');
  for (const name of REQUIRED_MODULES) {
    assert.ok(MODULES.includes(name), `الوحدة الإلزامية ${name} غائبة عن جذر الثقة`);
  }
});

test('كل وحدة في جذر الثقة مصدرها TypeScript', () => {
  for (const name of MODULES) {
    assert.ok(
      existsSync(join(trustDir, `${name}.mts`)),
      `الوحدة ${name} لا تملك مصدراً بامتداد .mts`,
    );
  }
});

test('لا ملف .mjs مكتوب بيد الإنسان داخل جذر الثقة', () => {
  const tracked = execFileSync('git', ['-C', repoRoot, 'ls-files', 'src/root-of-trust'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const handWritten = tracked.filter((p) => p.endsWith('.mjs'));
  assert.deepEqual(
    handWritten,
    [],
    'ملفات .mjs مُلتزمة في جذر الثقة: الناتج مولّد ولا يُلتزم، والمصدر يجب أن يكون .mts',
  );
  assert.ok(
    tracked.some((p) => p.endsWith('.mts')),
    'لا مصادر .mts متعقَّبة في جذر الثقة',
  );
});

test('خطوة البناء تُخرج .mjs و.d.mts بجوار كل مصدر', () => {
  for (const name of MODULES) {
    assert.ok(existsSync(join(trustDir, `${name}.mjs`)), `ناتج البناء ${name}.mjs غائب`);
    assert.ok(existsSync(join(trustDir, `${name}.d.mts`)), `ملف الأنواع ${name}.d.mts غائب`);
  }
});

test('الناتج مُصرَّف لا منسوخ: لا صيغة أنواع في ملفات .mjs', () => {
  for (const file of readdirSync(trustDir).filter((f) => f.endsWith('.mjs'))) {
    const source = readFileSync(join(trustDir, file), 'utf8');
    assert.ok(!/^\s*(export\s+)?interface\s/m.test(source), `${file} يحمل صيغة أنواع غير مصرَّفة`);
    assert.ok(!/\bimport\s+type\b/.test(source), `${file} يحمل استيراد أنواع غير مصرَّف`);
  }
});

test('لا إسكات للمدقّق في مصادر جذر الثقة', () => {
  for (const name of MODULES) {
    const source = readFileSync(join(trustDir, `${name}.mts`), 'utf8');
    for (const escape of ['@ts-ignore', '@ts-nocheck', '@ts-expect-error', ': any', '<any>']) {
      assert.ok(!source.includes(escape), `${name}.mts يستخدم ${escape} وهذا محظور بمعيار الأنواع`);
    }
  }
});

test('خطوة البناء موصولة بالاختبار والتحقق ولا تخرج إلى dist', () => {
  const pkg = /** @type {{ scripts?: Record<string, string> }} */ (
    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  );
  const scripts = pkg.scripts ?? {};
  assert.equal(scripts.build, 'tsc -p tsconfig.build.json', 'أمر البناء غائب أو مغيَّر');
  assert.ok(scripts.pretest?.includes('build'), 'pretest لا يبني: الاختبار سيمرّ على ناتج قديم');
  assert.ok(scripts.validate?.includes('npm run build'), 'أمر التحقق الشامل لا يشمل البناء');

  const build = /** @type {{ compilerOptions?: Record<string, unknown> }} */ (
    JSON.parse(
      readFileSync(join(repoRoot, 'tsconfig.build.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
    )
  );
  assert.equal(
    build.compilerOptions?.outDir,
    '.',
    'الإخراج ليس في الموضع: مسارات الاستيراد عند المستهلكين ستنكسر',
  );
});

test('الوحدة المصرَّفة تصدّر كل رموز الجذر وتعمل كما كانت', async () => {
  const rot = await import('../../src/root-of-trust/index.mjs');
  // القراءة بمفتاح نصي متغيّر تحتاج توصيفاً صريحاً؛ النسخة نفسها لا تُغيَّر.
  const exported = /** @type {Record<string, unknown>} */ (rot);
  for (const symbol of [
    'KingIdentity',
    'CertificateAuthority',
    'AgentIdentity',
    'fingerprint',
    'EventLog',
    'PersistentEventLog',
    'CrownGateway',
    'Veto',
    'createRoyalCommand',
    'PolicyEngine',
    'EncryptedKeyStore',
    'CommandLedger',
    'LocalEncryptedKeyProvider',
    'RemoteSecretStoreKeyProvider',
    'KingKeyError',
    'provisionKingKey',
    'loadKingIdentity',
    'kingIdentityFromMaterial',
    'describeKingKeyBinding',
    'kingKeyProviderFromEnv',
    'assertKingKeyProviderFit',
    'verifyEventChain',
    'hashEventBody',
    'inspectEventLog',
    'PersistentLogError',
  ]) {
    assert.equal(typeof exported[symbol], 'function', `الرمز ${symbol} مفقود من الوحدة المصرَّفة`);
  }
  const log = new rot.EventLog();
  log.append('test.migration', 'test', { ok: true });
  assert.equal(log.verify(), true, 'سلسلة التجزئة انكسرت بعد النقل');
});

test('حاجز عدد الملفات يعدّ المتعقَّب لا المولَّد', () => {
  const trackedCount = execFileSync(
    'git',
    ['-C', repoRoot, 'ls-files', '--cached', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean).length;
  const output = execFileSync('node', [join(repoRoot, 'scripts', 'guard-filecount.mjs')], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  assert.match(output, /أساس العدّ:\s+ملفات Git المتعقَّبة/, 'الحاجز لا يعدّ ملفات Git المتعقَّبة');
  assert.match(
    output,
    new RegExp(`عدد الملفات:\\s+${trackedCount}\\b`),
    'عدد الحاجز يخالف عدد الملفات المتعقَّبة: الناتج المولَّد يُحسب خطأً',
  );
});
