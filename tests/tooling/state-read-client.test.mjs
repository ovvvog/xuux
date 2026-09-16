// اختبارُ المستهلِكِ الخارجيِّ لطبقةِ الواجهةِ — `WL-194` (إغلاقُ الدَينِ `D-2`).
//
// **الدَينُ الذي يُقاسُ إغلاقُه بحرفِه:** «طبقةُ API بلا مستهلِكٍ خارجيٍّ»،
// ومعيارُه «مستهلِكٌ خارجُ العقدِ الداخليِّ **يُقاسُ بنداءٍ**».
//
// **ولذلك يُشغَّلُ الطرفانِ عمليَّتَينِ منفصلتَينِ:** الخادمُ بـ
// `scripts/serve-state.mjs` والعميلُ بـ`clients/state-reader/read-state.mjs`،
// **ولا يُستدعى شيءٌ منهما في هذه العمليّةِ**. فاختبارٌ يستوردُ البوابةَ ويُنادي
// دالَّتَها **لا يقيسُ مستهلِكاً خارجيّاً بل يقيسُ نفسَه**: لا سلكَ ولا ترويسةَ ولا
// جسمَ طلبٍ ولا رمزَ خروجٍ.
//
// **وما يُقاسُ ثلاثةٌ برموزِها لا بـ`>= 400`:**
//   ① نجاحٌ: `status: ok` ورمزُ خروجٍ `0` — قراءةٌ تمَّت على السلكِ بمفتاحِ العميلِ.
//   ② توقيعٌ بمفتاحٍ غيرِ المُسجَّلِ: `401` و`API_POP_INVALID` وخروجٌ غيرُ صفرٍ.
//   ③ فاعلٌ غيرُ مُسجَّلٍ: `403` و`API_IDENTITY_UNVERIFIED` وخروجٌ غيرُ صفرٍ.
//
// **والمفاتيحُ في `os.tmpdir()` لا في المستودعِ:** حاجزُ `scan:keys` يَرُدُّ أيَّ
// مادّةِ مفتاحٍ في الشجرةِ، ومفتاحٌ يُقيَّدُ «للاختبارِ» مفتاحٌ يُنشَرُ.
//
// **والمنافذُ عابرةٌ (`0`):** اختبارٌ يحجُزُ منفذاً ثابتاً يُخفِقُ إذا كان الخادمُ
// قائماً في الجهازِ نفسِه، فيُقرأُ الإخفاقُ عيباً في الشفرةِ وهو تعارضُ منافذَ.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const CLIENT = path.join(ROOT, 'clients', 'state-reader', 'read-state.mjs');
const SERVER = path.join(ROOT, 'scripts', 'serve-state.mjs');
const BOOT_TIMEOUT_MS = 120_000;

/**
 * يكتبُ زوجَ مفاتيحٍ في مجلَّدٍ موقَّتٍ خارجَ المستودعِ.
 * @param {string} dir
 * @param {string} prefix
 * @returns {{ publicFile: string, privateFile: string }}
 */
function writeKeyPair(dir, prefix) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicFile = path.join(dir, `${prefix}-public.txt`);
  const privateFile = path.join(dir, `${prefix}-private.txt`);
  fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  });
  return { publicFile, privateFile };
}

/**
 * يُشغِّلُ العميلَ **عمليّةً منفصلةً** ويُعيدُ رمزَ الخروجِ وتقريرَه المُفكَّكَ.
 * @param {NodeJS.ProcessEnv} env
 * @param {readonly string[]} argv
 * @returns {Promise<{ code: number | null, report: Record<string, unknown> }>}
 */
function runClient(env, argv = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLIENT, ...argv], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      /** @type {Record<string, unknown>} */
      let report;
      try {
        report = JSON.parse(out);
      } catch {
        reject(new Error(`مَخرَجُ العميلِ ليس JSON: ${out}\n${err}`));
        return;
      }
      resolve({ code, report });
    });
  });
}

/**
 * يُقلِعُ الخادمَ بمنفذَينِ عابرَينِ ومستهلِكٍ مُعلَنٍ، ويَنتظرُ **دليلَ إقلاعٍ
 * مقيساً**: ملفَّ التسجيلِ مكتوباً وبابَه يُجيبُ على السلكِ.
 * @param {{ dir: string, publicFile: string }} input
 * @returns {Promise<{ enrollmentFile: string, doorOrigin: string, stop: () => Promise<void> }>}
 */
async function bootServer(input) {
  const enrollmentFile = path.join(input.dir, 'enrollment.json');
  const child = spawn(process.execPath, [SERVER, '--port', '0'], {
    cwd: ROOT,
    env: {
      ...process.env,
      STATE_API_PORT: '0',
      STATE_READER_PUBLIC_KEY_FILE: input.publicFile,
      STATE_READER_ENROLLMENT_FILE: enrollmentFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    log += String(chunk);
  });
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(undefined);
        return;
      }
      child.once('close', () => resolve(undefined));
      child.kill('SIGTERM');
    });

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  /** @type {string} */
  let doorOrigin = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`الخادمُ خرجَ قبلَ الإقلاعِ برمزِ ${child.exitCode}:\n${log}`);
    }
    if (doorOrigin === '' && fs.existsSync(enrollmentFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(enrollmentFile, 'utf8'));
        doorOrigin = String(parsed['doorOrigin'] ?? '');
      } catch {
        doorOrigin = '';
      }
    }
    if (doorOrigin !== '') {
      try {
        // فعلٌ غيرُ مُعلَنٍ على مسلكِ الجلسةِ: يُجيبُ `405` — وذاك **دليلُ بابٍ
        // قائمٍ** بلا فتحِ جلسةٍ ولا استهلاكِ nonce.
        const probe = await fetch(`${doorOrigin}/state/session`, { method: 'GET' });
        if (probe.status === 405) {
          await probe.text();
          return { enrollmentFile, doorOrigin, stop };
        }
        await probe.text();
      } catch {
        // البابُ لم يُربَطْ بعدُ.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stop();
  throw new Error(`الخادمُ لم يُقلِعْ في المهلةِ المُعلَنةِ:\n${log}`);
}

test('مستهلِكٌ خارجيٌّ يقرأُ ويُرَدُّ برموزٍ مُسمّاةٍ — عمليّتانِ منفصلتانِ', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-reader-'));
  const reader = writeKeyPair(dir, 'reader');
  const stranger = writeKeyPair(dir, 'stranger');
  const booted = await bootServer({ dir, publicFile: reader.publicFile });
  t.after(async () => {
    await booted.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const enrollment = JSON.parse(fs.readFileSync(booted.enrollmentFile, 'utf8'));
  assert.match(
    String(enrollment['actorId']),
    /^agent:[0-9a-f-]{36}$/,
    'معرِّفُ الفاعلِ يُولَّدُ في سجلِّ الدولةِ ويُسلَّمُ في ملفِّ التسجيلِ',
  );
  assert.ok(
    !fs.readFileSync(booted.enrollmentFile, 'utf8').includes('PRIVATE KEY'),
    'ملفُّ التسجيلِ تسليمٌ لا يحملُ مادّةَ مفتاحٍ',
  );

  await t.test('① قراءةٌ موقَّعةٌ تنجحُ وتخرجُ صفراً', async () => {
    const outcome = await runClient(
      {
        STATE_READER_ENROLLMENT_FILE: booted.enrollmentFile,
        STATE_READER_PRIVATE_KEY_FILE: reader.privateFile,
      },
      ['--route', 'state.agents.list'],
    );
    assert.equal(outcome.report['status'], 'ok');
    assert.equal(outcome.report['httpStatus'], 200);
    assert.equal(outcome.report['route'], 'state.agents.list');
    assert.equal(outcome.report['actorId'], enrollment['actorId']);
    assert.equal(outcome.code, 0);
  });

  await t.test('② توقيعٌ بمفتاحٍ غيرِ المُسجَّلِ يُرَدُّ 401 و`API_POP_INVALID`', async () => {
    const outcome = await runClient({
      STATE_READER_ENROLLMENT_FILE: booted.enrollmentFile,
      STATE_READER_PRIVATE_KEY_FILE: stranger.privateFile,
    });
    assert.equal(outcome.report['stage'], 'session');
    assert.equal(outcome.report['status'], 401);
    assert.equal(outcome.report['code'], 'API_POP_INVALID');
    assert.notEqual(outcome.code, 0);
  });

  await t.test('③ فاعلٌ غيرُ مُسجَّلٍ يُرَدُّ 403 و`API_IDENTITY_UNVERIFIED`', async () => {
    const strangerEnrollment = path.join(dir, 'enrollment-stranger.json');
    fs.writeFileSync(
      strangerEnrollment,
      JSON.stringify({
        ...enrollment,
        actorId: 'agent:00000000-0000-0000-0000-000000000000',
      }),
      { mode: 0o600 },
    );
    const outcome = await runClient({
      STATE_READER_ENROLLMENT_FILE: strangerEnrollment,
      STATE_READER_PRIVATE_KEY_FILE: reader.privateFile,
    });
    assert.equal(outcome.report['stage'], 'session');
    assert.equal(outcome.report['status'], 403);
    assert.equal(outcome.report['code'], 'API_IDENTITY_UNVERIFIED');
    assert.notEqual(outcome.code, 0);
  });

  await t.test('④ مسلكٌ غيرُ منشورٍ في العقدِ لا يُنادى', async () => {
    const outcome = await runClient(
      {
        STATE_READER_ENROLLMENT_FILE: booted.enrollmentFile,
        STATE_READER_PRIVATE_KEY_FILE: reader.privateFile,
      },
      ['--route', 'state.agents.delete'],
    );
    assert.equal(outcome.report['stage'], 'client');
    assert.equal(outcome.report['status'], 'failed');
    assert.match(String(outcome.report['message']), /غيرُ منشورٍ/);
    assert.notEqual(outcome.code, 0);
  });
});
