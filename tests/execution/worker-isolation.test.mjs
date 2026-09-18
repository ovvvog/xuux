import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { createWorker } from '../../src/execution/worker.mjs';
import { probeIsolation } from '../../src/execution/isolation.mjs';

const skip = probeIsolation().available
  ? false
  : 'العزل الحقيقي غير متاح في المضيف؛ لا يُحوّل إلى نجاح وهمي.';

function queueFixture() {
  /** @type {any} */
  const task = {
    id: 'isolated-worker-task',
    action: 'اختبار.نجاح',
    payload: { قيمة: 11 },
    timeoutMs: 2_000,
    memoryLimitMb: 1_024,
    cancelRequested: false,
  };
  let claimed = false;
  /** @type {string[]} */
  const calls = [];
  return {
    task,
    calls,
    async claim() {
      if (claimed) return [];
      claimed = true;
      calls.push('claim');
      return [task];
    },
    async heartbeat() {
      calls.push('heartbeat');
      return { cancelRequested: false, extended: true };
    },
    /** @param {{ taskId: string, result: Record<string, unknown> }} input */
    async succeed(input) {
      calls.push(`succeed:${input.taskId}`);
      task.result = input.result;
    },
    /** @param {{ code: string }} input */
    async fail(input) {
      calls.push(`fail:${input.code}`);
      task.failure = input;
    },
    async get() {
      return task;
    },
  };
}

test('العامل يمرّر المهمة إلى namespaces حقيقية ويثبت نتيجتها', { skip }, async () => {
  const queue = queueFixture();
  const outputRoot = registerTmpRoot(
    fs.mkdtempSync(path.join(process.cwd(), '.xuux-worker-isolation-')),
  );
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  const log = {
    /** @param {string} type @param {string} actor @param {object} payload */
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
  try {
    const worker = createWorker({
      queue: /** @type {any} */ (queue),
      pool: /** @type {any} */ ({}),
      haltGuard: { assertOperational() {} },
      worker: 'عامل-العزل',
      isolation: { workdir: process.cwd(), outputRoot, log },
    });
    const tick = await worker.tick();
    assert.equal(tick.outcome, 'done');
    assert.equal(queue.task.result.صدى.قيمة, 11);
    assert.ok(queue.calls.some((call) => call.startsWith('succeed:')));
    assert.ok(events.some((event) => event.type === 'isolation.started'));
    assert.ok(events.some((event) => event.type === 'isolation.completed'));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
