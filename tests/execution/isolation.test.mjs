// اختبار العزل الحقيقي — M6.04.
//
// هذه ليست اختبارات لوسيطٍ مزيّف: كل حمولة تعمل في `unshare` الحقيقي وتحاول شبكة
// أو كتابةً فعلية. إن لم تدعم النواة user namespaces يتخطى الاختبار بسبب مطبوع؛
// لا يحوّل عيب المضيف إلى نجاح كاذب.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ISOLATION_ERRORS, probeIsolation, runIsolated } from '../../src/execution/isolation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPERS = path.join(HERE, 'helpers');
const capability = probeIsolation();
const kernelSkip = capability.available ? false : `تخطٍّ معلن: ${capability.reason}`;

/** سجل صغير يقيس الحدث المُلحق فعلاً. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  return {
    events,
    /** @param {string} type @param {string} actor @param {object} payload */
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
}

/**
 * يصنع شجرة مصدر حقيقية ثم ينسخ حمولة الاختبار فيها: لا يُربط ملف الاختبار نفسه
 * من المضيف خلسةً، بل كل ما تحتاجه الحمولة تحت workdir الذي يتحقق منه المنفّذ.
 * @param {string} helper
 */
function fixture(helper) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolation-test-'));
  const writableDir = path.join(workdir, 'output');
  fs.mkdirSync(writableDir);
  fs.copyFileSync(path.join(HELPERS, helper), path.join(workdir, 'payload.mjs'));
  return { workdir, writableDir, payload: path.join(workdir, 'payload.mjs') };
}

/** @param {{ workdir: string, writableDir: string, payload: string }} spec @param {object} [extra] */
function execute(spec, extra = {}) {
  const log = memoryLog();
  return {
    log,
    run: runIsolated({
      command: process.execPath,
      args: [spec.payload],
      workdir: spec.workdir,
      writableDir: spec.writableDir,
      timeoutMs: 2_000,
      memoryLimitMb: 1_024,
      maxFileSizeMb: 4,
      processLimit: 32,
      actor: 'agent:isolation-test',
      log,
      ...extra,
    }),
  };
}

test('probeIsolation يعلن قدرة النواة بدل افتراض وجود unshare', () => {
  assert.equal(typeof capability.available, 'boolean');
  assert.equal(capability.command, 'unshare');
  if (!capability.available) assert.equal(capability.code, ISOLATION_ERRORS.UNSUPPORTED);
});

test(
  'محاولة اتصال شبكي من داخل namespace بلا شبكة تفشل وتُسجَّل',
  { skip: kernelSkip },
  async () => {
    const spec = fixture('isolation-network-escape.mjs');
    const { log, run } = execute(spec);
    const result = await run;
    assert.equal(result.ok, false);
    assert.equal(result.code, ISOLATION_ERRORS.ESCAPE_BLOCKED);
    assert.match(result.stderr, /ENETUNREACH|EAI_AGAIN|ENETDOWN|EHOSTUNREACH/i);
    assert.ok(
      log.events.some(
        (event) => event.type === 'isolation.escape-blocked' && event.payload['kind'] === 'network',
      ),
    );
  },
);

test(
  'الكتابة خارج مجلد output تفشل بـ EROFS أو EACCES وتبلّغ الحجر',
  { skip: kernelSkip },
  async () => {
    const spec = fixture('isolation-write-outside.mjs');
    /** @type {Array<{ kind: string, subject: string, detail: Record<string, unknown> }>} */
    const signals = [];
    const { log, run } = execute(spec, {
      quarantine: {
        /** @param {{ kind: string, subject: string, detail: Record<string, unknown> }} signal */
        report: (signal) => signals.push(signal),
      },
    });
    const result = await run;
    assert.equal(result.code, ISOLATION_ERRORS.ESCAPE_BLOCKED);
    assert.match(result.stderr, /EROFS|EACCES/);
    assert.equal(fs.existsSync(path.join(spec.workdir, 'read-only-target.txt')), false);
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.kind, 'egress-refused');
    assert.ok(log.events.some((event) => event.type === 'isolation.refused'));
  },
);

test('الكتابة داخل مجلد output المعلن تنجح وحده وتُسجَّل', { skip: kernelSkip }, async () => {
  const spec = fixture('isolation-write-inside.mjs');
  const { log, run } = execute(spec);
  const result = await run;
  assert.equal(result.ok, true);
  assert.equal(result.code, null);
  assert.match(result.stdout, /allowed-write-complete/);
  assert.equal(
    fs.readFileSync(path.join(spec.writableDir, 'accepted.txt'), 'utf8'),
    'نجحت الكتابة المصرح بها',
  );
  assert.ok(log.events.some((event) => event.type === 'isolation.completed'));
});

test('المهلة تقتل شجرة عملية متجمدة من خارجها', { skip: kernelSkip }, async () => {
  const spec = fixture('isolation-hang.mjs');
  const { log, run } = execute(spec, { timeoutMs: 120 });
  const result = await run;
  assert.equal(result.ok, false);
  assert.equal(result.code, ISOLATION_ERRORS.TIMEOUT);
  assert.equal(result.killed, true);
  assert.ok(log.events.some((event) => event.type === 'isolation.timeout'));
});

test('حد الذاكرة يوقف حمولة تستنزف الكومة', { skip: kernelSkip }, async () => {
  const spec = fixture('isolation-memory-hog.mjs');
  const { run } = execute(spec, { timeoutMs: 6_000, memoryLimitMb: 768 });
  const result = await run;
  assert.equal(result.ok, false);
  assert.equal(result.code, ISOLATION_ERRORS.RESOURCE_LIMIT);
  assert.match(result.stderr, /out of memory|fatal process oom|cannot allocate memory/i);
});

test('غياب unshare يرفض مغلقاً ولا يبدأ الحمولة', async () => {
  const spec = fixture('isolation-write-inside.mjs');
  const moduleUrl = new URL('../../src/execution/isolation.mjs', import.meta.url).href;
  const script = `
    import { runIsolated } from ${JSON.stringify(moduleUrl)};
    const events = [];
    const log = { append(type, actor, payload) { events.push({ type, actor, payload }); } };
    const result = await runIsolated({
      command: ${JSON.stringify(process.execPath)},
      args: [${JSON.stringify(spec.payload)}],
      workdir: ${JSON.stringify(spec.workdir)},
      writableDir: ${JSON.stringify(spec.writableDir)},
      log,
      actor: 'agent:no-isolation',
    });
    console.log(JSON.stringify({ result, events }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });
  assert.equal(child.status, 0, child.stderr);
  /** @type {{ result: { code: string }, events: Array<{ type: string, payload: Record<string, unknown> }> }} */
  const output = JSON.parse(child.stdout);
  assert.equal(output.result.code, ISOLATION_ERRORS.UNSUPPORTED);
  assert.equal(
    fs.existsSync(path.join(spec.writableDir, 'accepted.txt')),
    false,
    'رفض العزل لا يشغّل الحمولة',
  );
  assert.ok(
    output.events.some(
      (event) => event.type === 'isolation.refused' && event.payload['phase'] === 'probe',
    ),
  );
});
