// اختبار أداة التثبيت الدوري — الخطوة M2.06.
//
// لماذا اختبار للأداة وليس للوحدة وحدها: «دورياً» في المعيار لا يتحقق بدالة،
// إنما بأداة تُنادى من مُجدول فلا تثبّت قبل انقضاء الفترة ولا تُعطّل الخدمة
// التي تكتب. وأخطر ما فيها ثلاثة: أن تفتح السجل للكتابة فتأخذ قفله، وأن تثبّت
// سجلاً معطوباً فتمنحه شهادة، وأن تطبع مادة مفتاح أو توكن مخزن في مخرجاتٍ
// تُلصق في تذكرة. والثلاثة مفحوصة هنا صراحةً.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  LOG_LOCK_SUFFIX,
  LocalEncryptedKeyProvider,
  PersistentEventLog,
  provisionKingKey,
} from '../../src/root-of-trust/index.mjs';
import { formatVerification, parseArgs, readConfig } from '../../scripts/anchor-log.mjs';
import { scanPathForKeys } from '../../scripts/scan-private-keys.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = join(repoRoot, 'scripts/anchor-log.mjs');

/** @type {string[]} */
const directories = [];

/**
 * يهيّئ بيئة معزولة: مخزن مفاتيح مزوَّد، وسجل أحداث بعدد معلوم، ومخزن تثبيتات.
 * @param {number} events - عدد الأحداث المكتوبة
 * @returns {Promise<{ env: NodeJS.ProcessEnv, directory: string, logFile: string, storeFile: string }>} البيئة
 */
async function environment(events) {
  const directory = registerTmpRoot(mkdtempSync(join(tmpdir(), 'anchor-cli-')));
  directories.push(directory);
  const master = randomUUID();
  await provisionKingKey(new LocalEncryptedKeyProvider(directory, master), {
    requireProductionReady: false,
  });
  const logFile = join(directory, 'state', 'events.jsonl');
  const storeFile = join(directory, 'anchors', 'anchors.jsonl');
  const log = new PersistentEventLog(logFile);
  for (let index = 1; index <= events; index += 1) log.append('حدث', 'نظام', { index });
  log.close();
  return {
    directory,
    logFile,
    storeFile,
    env: {
      ...process.env,
      KING_KEY_DIR: directory,
      KING_KEY_MASTER: master,
      EVENT_LOG_FILE: logFile,
      ANCHOR_STORE_FILE: storeFile,
      ANCHOR_INTERVAL_MINUTES: '60',
      NODE_ENV: 'test',
    },
  };
}

/**
 * يشغّل الأداة ويجمع مخرجاتها ورمز خروجها.
 * @param {string[]} args - الوسائط
 * @param {NodeJS.ProcessEnv} env - البيئة
 * @returns {{ status: number, stdout: string, stderr: string }} الحصيلة
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
      stdout: String(failure.stdout ?? ''),
      stderr: String(failure.stderr ?? ''),
    };
  }
}

test.after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

test('فكّ الوسائط والإعداد: ما ينقص يُرفض ولا يُخترع مسار افتراضي لسجل دولة', () => {
  assert.deepEqual(parseArgs([]), {
    command: 'status',
    json: false,
    force: false,
    timeoutMs: 30_000,
  });
  assert.deepEqual(parseArgs(['anchor', '--force', '--json']), {
    command: 'anchor',
    json: true,
    force: true,
    timeoutMs: 30_000,
  });
  assert.throws(() => parseArgs(['status', '--nope']), /وسيط غير معروف/);

  assert.throws(() => readConfig({}), /EVENT_LOG_FILE/);
  assert.throws(() => readConfig({ EVENT_LOG_FILE: '/tmp/a.jsonl' }), /ANCHOR_STORE_FILE/);
  assert.throws(
    () =>
      readConfig({
        EVENT_LOG_FILE: '/tmp/a.jsonl',
        ANCHOR_STORE_FILE: '/tmp/b.jsonl',
        ANCHOR_INTERVAL_MINUTES: '0',
      }),
    /ANCHOR_INTERVAL_MINUTES/,
  );
  const config = readConfig({
    EVENT_LOG_FILE: '/tmp/a.jsonl',
    ANCHOR_STORE_FILE: '/tmp/b.jsonl',
    ANCHOR_INTERVAL_MINUTES: '15',
  });
  assert.equal(config.intervalMs, 15 * 60 * 1000);
});

test('الحالة قبل أي تثبيت تقول صراحةً إن السجل غير مُثبَت', async () => {
  const context = await environment(3);
  const result = runCli(['status'], context.env);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /أحداث على القرص: 3/);
  assert.match(result.stdout, /لا يوجد — السجل غير مُثبَت بعد/);
  assert.equal(existsSync(context.storeFile), false, 'الحالة لا تُنشئ مخزناً');
});

test('التثبيت ثم التحقق: يمرّ، ويحفظ التثبيت في المخزن المنفصل، ولا يقفل السجل', async () => {
  const context = await environment(4);
  const anchored = runCli(['anchor', '--json'], context.env);
  assert.equal(anchored.status, 0);
  const payload = JSON.parse(anchored.stdout);
  assert.equal(payload.anchored, true);
  assert.equal(payload.anchor.seq, 1);
  assert.equal(payload.anchor.count, 4);
  assert.equal(payload.anchor.keyVersion, 1);
  assert.equal(existsSync(context.logFile + LOG_LOCK_SUFFIX), false, 'الأداة لا تأخذ قفل الكاتب');

  const verified = runCli(['verify'], context.env);
  assert.equal(verified.status, 0);
  assert.match(verified.stdout, /✅ السجل مطابق لتثبيتاته/);
  assert.match(verified.stdout, /أحداث مُثبَتة: 4/);

  const status = runCli(['status', '--json'], context.env);
  const state = JSON.parse(status.stdout);
  assert.equal(state.anchors, 1);
  assert.equal(state.latestAnchor.count, 4);
  assert.deepEqual(state.acceptedKeyVersions, [1]);
});

test('الدورية محترمة: نداءٌ ثانٍ داخل الفترة لا يثبّت، و--force يثبّت الآن', async () => {
  const context = await environment(2);
  assert.equal(runCli(['anchor'], context.env).status, 0);

  const log = new PersistentEventLog(context.logFile);
  log.append('حدث', 'نظام', { index: 3 });
  log.close();

  const again = runCli(['anchor', '--json'], context.env);
  const payload = JSON.parse(again.stdout);
  assert.equal(payload.anchored, false);
  assert.equal(payload.reason, 'INTERVAL_OR_NO_NEW_EVENTS');

  const forced = runCli(['anchor', '--force', '--json'], context.env);
  assert.equal(JSON.parse(forced.stdout).anchor.seq, 2);
  assert.equal(JSON.parse(forced.stdout).anchor.count, 3);
});

test('سجل عُبث به: التحقق يفشل برمزه، والتثبيت يُرفض فلا يُمنح المعطوب شهادة', async () => {
  const context = await environment(3);
  runCli(['anchor'], context.env);

  // عبثٌ غير متسق: يكفي لقياس أن الأداة لا تثبّت معطوباً ولا تقول «سليم».
  const lines = readFileSync(context.logFile, 'utf8').split('\n').filter(Boolean);
  const record = JSON.parse(String(lines[1]));
  record.data = { index: 'مزيَّف' };
  lines[1] = JSON.stringify(record);
  writeFileSync(context.logFile, lines.join('\n') + '\n');

  const verified = runCli(['verify', '--json'], context.env);
  assert.equal(verified.status, 0);
  const result = JSON.parse(verified.stdout);
  assert.equal(result.ok, false);
  assert.equal(result.problem, 'EVENT_CHAIN_BROKEN');

  const refused = runCli(['anchor', '--force'], context.env);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /لا يُثبَّت سجل معطوب/);
});

test('المخزن غير المنفصل مرفوض من الأداة نفسها', async () => {
  const context = await environment(2);
  const env = { ...context.env, ANCHOR_STORE_FILE: context.logFile };
  const result = runCli(['status'], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ANCHOR_STORE_NOT_SEPARATE/);
});

test('لا مادة مفتاح ولا توكن مخزن في أي مخرج من مخارج الأداة', async () => {
  const context = await environment(3);
  const outputs = [
    runCli(['status'], context.env),
    runCli(['anchor', '--json'], context.env),
    runCli(['verify', '--json'], context.env),
    runCli(['status', '--json'], context.env),
    runCli(['--help'], context.env),
  ]
    .map((result) => result.stdout + result.stderr)
    .join('\n');

  assert.equal(outputs.includes('PRIVATE KEY'), false);
  assert.equal(outputs.includes(String(context.env['KING_KEY_MASTER'])), false);
  const dump = join(context.directory, 'cli-output.txt');
  writeFileSync(dump, outputs);
  assert.deepEqual(scanPathForKeys(dump), [], 'فاحص مادة المفاتيح يجب أن يخرج فارغاً');

  // ومخزن التثبيتات نفسه لا يحمل إلا تجزئات وتوقيعات، فيُفحَص كما تُفحَص المخرجات.
  assert.deepEqual(scanPathForKeys(context.storeFile), []);
});

test('صياغة تقرير التحقق تُظهر العطب وموضعه لا «فشل» مجرَّداً', () => {
  const text = formatVerification({
    ok: false,
    anchors: 2,
    provenEvents: 4,
    unanchoredEvents: 0,
    keyVersions: [1, 2],
    problem: 'LOG_DIVERGES_FROM_ANCHOR',
    problemAt: 2,
    detail: 'التثبيت عند الحدث 4',
  });
  assert.match(text, /❌/);
  assert.match(text, /LOG_DIVERGES_FROM_ANCHOR عند 2/);
  assert.match(text, /التثبيت عند الحدث 4/);
  assert.match(text, /إصدارات المفاتيح التي قَبِلت: 1، 2/);
});
