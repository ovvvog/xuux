// اختبار أداة تدوير مفتاح الملك — الخطوة M2.04.
//
// لماذا اختبار للأداة وليس للوحدة وحدها: الأداة هي ما يُشغَّل تحت الضغط بعد
// اشتباه تسرّب، وخطؤها لا يظهر في اختبار وحدة. وأخطر ما فيها احتمال أن تطبع
// مادة مفتاح خاص أو توكن المخزن في مخرجات تُنسخ إلى تذكرة حادثة، فهذا مفحوص
// هنا صراحةً على كل مخرجات كل أمر.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  LocalEncryptedKeyProvider,
  provisionKingKey,
  readKingKeyManifest,
} from '../../src/root-of-trust/index.mjs';
import { scanPathForKeys } from '../../scripts/scan-private-keys.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = join(repoRoot, 'scripts/rotate-king-key.mjs');

/** @type {string[]} */
const directories = [];

/**
 * يهيّئ مخزناً محلياً مزوَّداً بمفتاح ملك، ويعيد بيئة تشغيل الأداة عليه.
 * @returns {Promise<{ env: NodeJS.ProcessEnv, directory: string, provider: LocalEncryptedKeyProvider }>} بيئة معزولة
 */
async function provisionedEnvironment() {
  const directory = registerTmpRoot(mkdtempSync(join(tmpdir(), 'rotate-cli-')));
  directories.push(directory);
  const master = randomUUID();
  const provider = new LocalEncryptedKeyProvider(directory, master);
  await provisionKingKey(provider, { requireProductionReady: false });
  return {
    directory,
    provider,
    env: { ...process.env, KING_KEY_DIR: directory, KING_KEY_MASTER: master, NODE_ENV: 'test' },
  };
}

/**
 * يشغّل الأداة ويجمع مخرجاتها ورمز خروجها.
 * @param {string[]} args - وسائط الأداة
 * @param {NodeJS.ProcessEnv} env - بيئة التشغيل
 * @returns {{ status: number, stdout: string, stderr: string }} حصيلة التشغيل
 */
function runCli(args, env) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = /** @type {{ status: number, stdout: string, stderr: string }} */ (
      /** @type {unknown} */ (error)
    );
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

test.after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

test('الأداة تدوّر ثم تُبطل، والبيان يوافق ما أعلنته المخرجات', async () => {
  const { env, provider } = await provisionedEnvironment();

  const before = runCli(['status'], env);
  assert.equal(before.status, 0);
  assert.match(before.stdout, /مفتاح مزوَّد بلا بيان إصدارات/);

  const rotated = runCli(['rotate', '--coexist-hours', '2', '--json'], env);
  assert.equal(rotated.status, 0, rotated.stderr);
  const result = JSON.parse(rotated.stdout);
  assert.equal(result.version, 2);
  assert.equal(result.previousVersion, 1);
  const remainingHours = (Date.parse(result.coexistUntil) - Date.now()) / 3600000;
  assert.equal(remainingHours > 1.9 && remainingHours <= 2, true);

  const manifest = await readKingKeyManifest(provider);
  assert.equal(manifest?.activeVersion, 2);
  assert.equal(manifest?.versions.find((v) => v.version === 1)?.status, 'retiring');

  const status = runCli(['status'], env);
  assert.match(status.stdout, /الإصدار الفعّال: 2/);
  assert.match(status.stdout, /👑 فعّال/);
  assert.match(status.stdout, /🕒 متعايش/);
  assert.match(status.stdout, /الإصدارات المقبولة للتحقق الآن: 2 · 1/);

  const revoked = runCli(['revoke', '--version', '1', '--reason', 'اشتباه تسرّب', '--json'], env);
  assert.equal(revoked.status, 0, revoked.stderr);
  const record = JSON.parse(revoked.stdout);
  assert.equal(record.status, 'revoked');
  assert.equal(record.revocationReason, 'اشتباه تسرّب');
  assert.equal(await provider.has('king-signing-key'), false, 'الإبطال يمحو المادة فعلاً');

  const after = runCli(['status'], env);
  assert.match(after.stdout, /⛔ مُبطَل/);
  assert.match(after.stdout, /الإصدارات المقبولة للتحقق الآن: 2$/m);
});

test('الأداة لا تطبع مادة مفتاح خاص ولا توكن المخزن في أي أمر', async () => {
  const { env } = await provisionedEnvironment();
  const outputs = [
    runCli(['rotate', '--json'], env),
    runCli(['status'], env),
    runCli(['status', '--json'], env),
    runCli(['revoke', '--version', '1', '--reason', 'تدوير مخطَّط'], env),
    runCli(['--help'], env),
  ];
  for (const output of outputs) {
    const text = output.stdout + output.stderr;
    assert.doesNotMatch(text, /PRIVATE KEY/);
    assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE/);
    // المفتاح الرئيس للتشفير المحلي يقوم مقام التوكن في هذا المخزن.
    assert.equal(text.includes(String(env.KING_KEY_MASTER)), false, 'سرّ المخزن ظهر في المخرجات');
    assert.equal(text.includes(String(env.KING_KEY_DIR)), false, 'موضع المخزن ظهر في المخرجات');
  }
});

test('الإبطال بلا سبب أو بلا إصدار يُرفض، والأمر المجهول يُرفض', async () => {
  const { env } = await provisionedEnvironment();
  runCli(['rotate'], env);

  const noReason = runCli(['revoke', '--version', '1'], env);
  assert.equal(noReason.status, 2);
  assert.match(noReason.stderr, /يلزم --reason/);

  const noVersion = runCli(['revoke', '--reason', 'بلا إصدار'], env);
  assert.equal(noVersion.status, 2);
  assert.match(noVersion.stderr, /يلزم --version/);

  const unknown = runCli(['حذف-الجذر'], env);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /أمر غير معروف/);

  const badFlag = runCli(['status', '--force'], env);
  assert.equal(badFlag.status, 1);
  assert.match(badFlag.stderr, /وسيط غير معروف/);
});

test('بلا مخزن معلَن في البيئة تتوقف الأداة برمز خطأ صريح ولا تعمل على القرص', () => {
  const env = { ...process.env };
  delete env.KING_KEY_DIR;
  delete env.KING_KEY_MASTER;
  delete env.KING_KEY_STORE_ENDPOINT;
  delete env.KING_KEY_STORE_TOKEN;
  const output = runCli(['status'], env);
  assert.equal(output.status, 1);
  assert.match(output.stderr, /KEY_STORE_NOT_CONFIGURED/);
});

test('مخزن الأداة بعد التدوير والإبطال يخلو من مادة مفتاح صريحة (فحص M2.03)', async () => {
  const { env, directory } = await provisionedEnvironment();
  runCli(['rotate'], env);
  runCli(['revoke', '--version', '1', '--reason', 'تدوير مخطَّط'], env);

  const findings = scanPathForKeys(directory);
  // المخزن المحلي مشفَّر: فلا مادة صريحة، والمشفَّر يُذكر بخطورة الإنتاج فقط.
  assert.deepEqual(
    findings.filter((finding) => finding.severity === 'error'),
    [],
  );
  // والبيان نفسه لا يحمل شيئاً من المادة.
  assert.equal(
    readFileSync(join(directory, 'king-key-manifest.key.json'), 'utf8').includes('PRIVATE'),
    false,
  );
});

test('الأداة موصولة بالتوثيق: package.json يعلن أمر rotate:king-key', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['rotate:king-key'], 'node scripts/rotate-king-key.mjs');
});
