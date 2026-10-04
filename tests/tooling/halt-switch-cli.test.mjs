// اختبار أداة مفتاح الإيقاف الشامل — الخطوة M2.08.
//
// لماذا اختبار للأداة لا للوحدة وحدها: الإيقاف السيادي يُصدره إنسان في لحظة
// حرجة من سطر أوامر، فمخرجُه جزءٌ من الضمان. وأخطر ما فيها ثلاثة: أن تُصدر
// إيقافاً بلا مفتاح فتصير الكتابة على القرص كافية، وأن تستأنف قبل إقرار العقد
// الحيّة، وأن تطبع مادة مفتاح أو مفتاح مخزن في مخرجاتٍ تُلصق في تذكرة. والثلاثة
// مفحوصة هنا صراحةً.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  HaltSwitch,
  LocalEncryptedKeyProvider,
  kingKeyProviderFromEnv,
  loadKingKeySet,
  provisionKingKey,
  signHaltAck,
} from '../../src/root-of-trust/index.mjs';
import { formatDescription, parseArgs, readConfig } from '../../scripts/halt-switch.mjs';
import { scanPathForKeys } from '../../scripts/scan-private-keys.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = join(repoRoot, 'scripts/halt-switch.mjs');

/** @type {string[]} */
const directories = [];

/**
 * يولّد مفتاح عقدة (Ed25519) ويكتب خاصّه إلى ملف PEM — كما تفعل العقدة في
 * التشغيل. هو ما يُتيح اختبار أمر confirm بمفتاحٍ موقَّع به (GPT-F05).
 * @param {string} directory - مجلد الكتابة
 * @returns {{ privateKeyPem: string, publicKeyPem: string, keyFile: string }} مفتاح العقدة وملفه
 */
function nodeKeyFile(directory) {
  const pair = generateKeyPairSync('ed25519');
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const keyFile = join(directory, 'node.key.pem');
  writeFileSync(keyFile, privateKeyPem, { mode: 0o600 });
  return { privateKeyPem: String(privateKeyPem), publicKeyPem: String(publicKeyPem), keyFile };
}

/**
 * يهيّئ بيئة معزولة: مخزن مفاتيح مزوَّد وملف توجيه داخله.
 * @returns {Promise<{ env: NodeJS.ProcessEnv, directory: string, file: string }>} البيئة
 */
async function environment() {
  const directory = registerTmpRoot(mkdtempSync(join(tmpdir(), 'halt-cli-')));
  directories.push(directory);
  const master = randomUUID();
  await provisionKingKey(new LocalEncryptedKeyProvider(directory, master), {
    requireProductionReady: false,
  });
  const file = join(directory, 'state', 'halt.json');
  return {
    directory,
    file,
    env: {
      ...process.env,
      KING_KEY_DIR: directory,
      KING_KEY_MASTER: master,
      HALT_SWITCH_FILE: file,
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

test('فكّ الوسائط يقبل المعروف ويرفض المجهول والسبب الفارغ', () => {
  assert.deepEqual(parseArgs(['halt', '--reason', 'سبب', '--json']), {
    command: 'halt',
    json: true,
    reason: 'سبب',
    nodeKeyFile: null,
    oldNodeKeyFile: null,
    commandFile: null,
    timeoutMs: 30_000,
  });
  assert.deepEqual(parseArgs([]), {
    command: 'status',
    json: false,
    reason: null,
    nodeKeyFile: null,
    oldNodeKeyFile: null,
    commandFile: null,
    timeoutMs: 30_000,
  });
  assert.deepEqual(parseArgs(['confirm', '--node-key', '/k.pem']), {
    command: 'confirm',
    json: false,
    reason: null,
    nodeKeyFile: '/k.pem',
    oldNodeKeyFile: null,
    commandFile: null,
    timeoutMs: 30_000,
  });
  // `LIVE-40` (أ): مفتاحُ العقدةِ القديمُ لتدويرِ مفتاحِ عقدةٍ قائمة.
  assert.deepEqual(parseArgs(['confirm', '--node-key', '/new.pem', '--old-node-key', '/old.pem']), {
    command: 'confirm',
    json: false,
    reason: null,
    nodeKeyFile: '/new.pem',
    oldNodeKeyFile: '/old.pem',
    commandFile: null,
    timeoutMs: 30_000,
  });
  assert.throws(() => parseArgs(['halt', '--force']), /وسيط غير معروف/);
  assert.throws(() => parseArgs(['halt', '--reason']), /--reason بلا قيمة/);
  assert.throws(() => parseArgs(['confirm', '--node-key']), /--node-key بلا قيمة/);
  assert.throws(() => parseArgs(['confirm', '--old-node-key']), /--old-node-key بلا قيمة/);
});

test('الإعداد يُقرأ من البيئة ولا يُخترع مسار افتراضي لزرّ إيقاف', () => {
  assert.throws(() => readConfig({}), /HALT_SWITCH_FILE/);
  const config = readConfig({ HALT_SWITCH_FILE: '/tmp/halt.json', HALT_NODE_ID: 'node-1' });
  assert.equal(config.file, '/tmp/halt.json');
  assert.equal(config.nodeId, 'node-1');
  assert.equal(config.publicKeyFile, null);
  assert.equal(config.nodeKeyFile, null);
  assert.equal(config.oldNodeKeyFile, null);
  const withKey = readConfig({ HALT_SWITCH_FILE: '/tmp/halt.json', HALT_NODE_KEY_FILE: '/k.pem' });
  assert.equal(withKey.nodeKeyFile, '/k.pem');
  const withOldKey = readConfig({
    HALT_SWITCH_FILE: '/tmp/halt.json',
    HALT_OLD_NODE_KEY_FILE: '/old.pem',
  });
  assert.equal(withOldKey.oldNodeKeyFile, '/old.pem');
});

test('التقرير النصي يُظهر الحالة والعهد والعقد التي لم تُقرّ', () => {
  const text = formatDescription({
    state: 'halted',
    epoch: 3,
    reason: 'صيانة',
    at: '2026-01-01T00:00:00.000Z',
    nodes: [{ nodeId: 'node-1', pid: 1, at: '2026-01-01T00:00:00.000Z' }],
    confirmed: [],
    pending: [{ nodeId: 'node-1', pid: 1, alive: true }],
    fullyConfirmed: false,
  });
  assert.match(text, /⛔ الدولة موقوفة/);
  assert.match(text, /العهد: 3/);
  assert.match(text, /node-1 \(حيّة\)/);
  assert.match(text, /التحقق تام: لا/);
});

test('دورة كاملة من سطر الأوامر: حالة ثم إيقاف ثم إقرار ثم استئناف ثم تحقق', async () => {
  const { env, file } = await environment();

  const before = runCli(['status', '--json'], env);
  assert.equal(before.status, 0);
  assert.equal(JSON.parse(before.stdout).state, 'running');

  const halted = runCli(['halt', '--reason', 'صيانة مجدولة', '--json'], env);
  assert.equal(halted.status, 0);
  const directive = JSON.parse(halted.stdout).directive;
  assert.equal(directive.epoch, 1);
  assert.equal(directive.state, 'halted');
  assert.equal(directive.reason, 'صيانة مجدولة');

  // عقدة حيّة مسجَّلة تمنع الاستئناف حتى تُقرّ — الإيقاف متحقَّق منه لا مظنون.
  const king = await loadKingKeySet(kingKeyProviderFromEnv(env));
  const halt = new HaltSwitch(file, king);
  const node = nodeKeyFile(env['KING_KEY_DIR'] ?? '/tmp');
  halt.registerNode('node-live', {
    pid: process.pid,
    nodeKey: { publicKeyPem: node.publicKeyPem, sign: (p) => signHaltAck(node.privateKeyPem, p) },
  });
  const blocked = runCli(['resume'], env);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /HALT_NOT_CONFIRMED/);

  const confirmed = runCli(['confirm', '--node-key', node.keyFile, '--json'], {
    ...env,
    HALT_NODE_ID: 'node-live',
  });
  assert.equal(confirmed.status, 0);
  assert.equal(JSON.parse(confirmed.stdout).confirmation.epoch, 1);

  const resumed = runCli(['resume', '--reason', 'انتهت الصيانة', '--json'], env);
  assert.equal(resumed.status, 0);
  // العهد 2 لا 3: الاستئناف المرفوض قبل الإقرار لم يُهدر عهداً.
  assert.equal(JSON.parse(resumed.stdout).directive.epoch, 2);

  const verified = runCli(['verify', '--json'], env);
  assert.equal(verified.status, 0);
  assert.equal(JSON.parse(verified.stdout).ok, true);
});

test('أمر confirm بلا معرّف عقدة يُرفض', async () => {
  const { env } = await environment();
  runCli(['halt'], env);
  const failure = runCli(['confirm'], env);
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /HALT_NODE_ID/);
});

test('أمر confirm بلا مفتاح عقدة يُرفض (GPT-F05)', async () => {
  const { env } = await environment();
  runCli(['halt'], env);
  const failure = runCli(['confirm'], { ...env, HALT_NODE_ID: 'node-bare' });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /HALT_NODE_KEY_FILE/);
});

test('وضع المفتاح العام يقرأ ويُقرّ ولا يُصدر إيقافاً', async () => {
  const { env, directory, file } = await environment();
  const king = await loadKingKeySet(kingKeyProviderFromEnv(env));
  const pemPath = join(directory, 'king.pub.pem');
  writeFileSync(pemPath, String(king.publicKey.export({ type: 'spki', format: 'pem' })));
  const nodeEnv = {
    ...process.env,
    HALT_SWITCH_FILE: file,
    HALT_PUBLIC_KEY_FILE: pemPath,
    NODE_ENV: 'test',
  };

  const cannot = runCli(['halt'], nodeEnv);
  assert.equal(cannot.status, 1);
  assert.match(cannot.stderr, /HALT_SIGNER_REQUIRED/);

  runCli(['halt', '--reason', 'إيقاف من الملك'], env);
  const status = runCli(['status', '--json'], nodeEnv);
  assert.equal(JSON.parse(status.stdout).state, 'halted');
  const node = nodeKeyFile(directory);
  const confirmed = runCli(['confirm', '--node-key', node.keyFile, '--json'], {
    ...nodeEnv,
    HALT_NODE_ID: 'node-public',
  });
  assert.equal(confirmed.status, 0);
  const cannotResume = runCli(['resume'], nodeEnv);
  assert.equal(cannotResume.status, 1);
  assert.match(cannotResume.stderr, /HALT_SIGNER_REQUIRED/);
});

test('المخرجات لا تحمل مادة مفتاح ولا مفتاح المخزن', async () => {
  const { env, directory } = await environment();
  const outputs = [
    runCli(['halt', '--reason', 'فحص المخرجات', '--json'], env).stdout,
    runCli(['status', '--json'], env).stdout,
    runCli(['verify', '--json'], env).stdout,
  ].join('\n');
  const master = String(env['KING_KEY_MASTER']);
  assert.equal(outputs.includes(master), false);
  assert.equal(outputs.includes('PRIVATE KEY'), false);
  const dump = join(directory, 'cli-output.txt');
  writeFileSync(dump, outputs);
  assert.deepEqual(scanPathForKeys(dump), []);
  assert.equal(readFileSync(dump, 'utf8').includes('BEGIN'), false);
});
