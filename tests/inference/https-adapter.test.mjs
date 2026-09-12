// اختبارُ مُوائمِ مزوّدٍ عبرَ `https` — سدادُ `D-11` (الشوطُ الثاني).
//
// **ما يُقاسُ هنا مِقبسٌ حقيقيٌّ لا دالّةٌ مزيّفةٌ:** يُرفَعُ خادمُ `https` على
// `127.0.0.1` بشهادةٍ صادرةٍ من جهةِ إصدارٍ تُولَّدُ في المُهلةِ نفسِها، ويُنادى
// المُوائمُ عليه عبرَ عقدِه، ثمَّ عبرَ **بوابةِ الاستدلالِ نفسِها** بنموذجٍ
// نافذٍ ونقطةِ تفويضٍ حقيقيّةٍ. فما يُقاسُ سلسلةٌ كاملةٌ: تفويضٌ، ثمَّ نداءُ
// شبكةٍ مُعمّىً مُتحقَّقٌ من شهادتِه، ثمَّ عقدُ ناتجٍ، ثمَّ خصمٌ من ميزانيّةٍ،
// ثمَّ قيدٌ في السجلِّ.
//
// **والمقيسُ الأثقلُ هو الرفضُ:** شهادةٌ من جهةٍ غيرِ موثوقةٍ تُرَدُّ، ومفتاحٌ
// غائبٌ من البيئةِ يُرفَضُ قبلَ النداءِ، وعنوانٌ بلا تعميةٍ يُرفَضُ، وردٌّ لا
// يُطابِقُ المسارَ المُعلَنَ يُرفَضُ ولا يُخمَّنُ، وردٌّ بلا نهايةٍ يُقطَعُ عندَ
// سقفِه، ومزوّدٌ يُبدِّلُ النموذجَ يُكشَفُ، ومزوّدٌ يُرَدِّدُ المفتاحَ في رسالةِ
// خطئِه لا يُخرِجُه المُوائمُ إلى قارئٍ.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { ADAPTER_ERRORS, executorFor } from '../../src/inference/adapters/contract.mjs';
import {
  createHttpsAdapter,
  HTTPS_ADAPTER_MAX_RESPONSE_BYTES,
  httpsExecutor,
  pluck,
  redact,
  REDACTION_MARK,
} from '../../src/inference/adapters/https.mjs';
import { gateWithAdapter, minister } from '../helpers/inference-gate.mjs';
import { issueMaterial } from '../helpers/tls-material.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'https-adapter-'));
const TRUSTED = issueMaterial(TMP, 'trusted');
const FOREIGN = issueMaterial(TMP, 'foreign');
const KEY_ENV = 'PROVIDER_TEST_API_KEY';
const CA_ENV = 'PROVIDER_TEST_CA_FILE';
const SECRET = 'sk-test-0123456789';

/**
 * @typedef {object} Captured
 * @property {string} url
 * @property {Record<string, string | string[] | undefined>} headers
 * @property {string} body
 */

/**
 * خادمُ مزوّدٍ مُصطَنَعٌ **بتعميةٍ حقيقيّةٍ**: مِقبسٌ يُنهي TLS بشهادةٍ موقَّعةٍ،
 * ومُعالِجٌ يُمرَّرُ من الاختبارِ فلا فرعَ في الخادمِ لكلِّ حالةٍ.
 *
 * @param {(captured: Captured, response: import('node:http').ServerResponse) => void} handler
 * @param {{ material?: { certFile: string, keyFile: string } }} [options]
 * @returns {Promise<{ port: number, calls: Captured[], close: () => Promise<void> }>}
 */
async function provider(handler, options = {}) {
  const material = options.material ?? TRUSTED;
  /** @type {Captured[]} */
  const calls = [];
  const server = createServer(
    {
      cert: fs.readFileSync(material.certFile),
      key: fs.readFileSync(material.keyFile),
      minVersion: 'TLSv1.2',
    },
    (request, response) => {
      /** @type {Buffer[]} */
      const chunks = [];
      request.on('data', (/** @type {Buffer} */ chunk) => chunks.push(chunk));
      request.on('end', () => {
        const captured = {
          url: request.url ?? '',
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        calls.push(captured);
        handler(captured, response);
      });
    },
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    port,
    calls,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve(undefined));
      }),
  };
}

/**
 * إعلانُ مُوائمٍ على خادمِ الاختبارِ: العنوانُ `https` على المِقبسِ المحلّيِّ،
 * والمفتاحُ باسمِ متغيّرٍ، وشهادةُ جهةِ الإصدارِ بمسارٍ في متغيّرٍ.
 *
 * @param {number} port
 * @param {Record<string, unknown>} [overrides]
 * @returns {import('../../src/inference/adapters/https.mjs').HttpsAdapterOptions}
 */
function declarationFor(port, overrides = {}) {
  return /** @type {import('../../src/inference/adapters/https.mjs').HttpsAdapterOptions} */ ({
    id: 'adapter:provider-test',
    provider: 'مزوّدُ اختبارٍ',
    endpoint: `https://127.0.0.1:${port}/v1/infer`,
    apiKeyEnv: KEY_ENV,
    caFileEnv: CA_ENV,
    timeoutMs: 5_000,
    requestFields: { model: 'model', input: 'prompt', purpose: 'purpose' },
    outputPath: ['choices', 0, 'text'],
    usagePaths: {
      inputTokens: ['usage', 'prompt_tokens'],
      outputTokens: ['usage', 'completion_tokens'],
    },
    env: { ...process.env, [KEY_ENV]: SECRET, [CA_ENV]: TRUSTED.caFile },
    ...overrides,
  });
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {(captured: Captured, response: import('node:http').ServerResponse) => void}
 */
function respondJson(payload) {
  return (_captured, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  };
}

test('نداءٌ حقيقيٌّ على مِقبسٍ مُعمّىً: المفتاحُ من البيئةِ في الترويسةِ، والمُخرَجُ من المسارِ المُعلَنِ', async () => {
  const server = await provider(
    respondJson({
      choices: [{ text: 'جوابُ المزوّدِ' }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }),
  );
  try {
    const execute = httpsExecutor(declarationFor(server.port));
    const result = await execute({
      model: { id: 'model:test', purpose: 'planning' },
      purpose: 'planning',
      input: 'سؤالٌ',
    });
    assert.equal(result.output, 'جوابُ المزوّدِ');
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7 });
    assert.equal(server.calls.length, 1);
    const call = /** @type {Captured} */ (server.calls[0]);
    assert.equal(call.headers['authorization'], `Bearer ${SECRET}`);
    assert.equal(call.headers['content-type'], 'application/json');
    assert.equal(call.url, '/v1/infer');
    assert.deepEqual(JSON.parse(call.body), {
      model: 'model:test',
      prompt: 'سؤالٌ',
      purpose: 'planning',
    });
  } finally {
    await server.close();
  }
});

test('شهادةٌ من جهةٍ غيرِ موثوقةٍ تُرَدُّ: لا رجوعَ صامتاً إلى قناةٍ لا يُعرَفُ مَن أنهاها', async () => {
  const server = await provider(respondJson({ choices: [{ text: 'لن يُقرأَ' }] }), {
    material: FOREIGN,
  });
  try {
    const execute = httpsExecutor(declarationFor(server.port));
    await assert.rejects(
      execute({
        model: { id: 'model:test', purpose: 'planning' },
        purpose: 'planning',
        input: 'سؤالٌ',
      }),
      (/** @type {Error & { code?: string }} */ error) =>
        error.code === ADAPTER_ERRORS.TRANSPORT_FAILED,
    );
  } finally {
    await server.close();
  }
});

test('المفتاحُ يُقرأُ عندَ كلِّ نداءٍ: غيابُه عن البيئةِ رفضٌ مُسمّىً قبلَ فتحِ مِقبسٍ', async () => {
  const server = await provider(respondJson({ choices: [{ text: 'لن يُنادى' }] }));
  try {
    const adapter = createHttpsAdapter(
      declarationFor(server.port, { env: { [CA_ENV]: TRUSTED.caFile } }),
    );
    await assert.rejects(
      Promise.resolve().then(() =>
        adapter.invoke({
          model: { id: 'model:test', purpose: 'planning' },
          purpose: 'planning',
          input: 'س',
          signal: new AbortController().signal,
        }),
      ),
      (/** @type {Error & { code?: string, message: string } }*/ error) =>
        error.code === ADAPTER_ERRORS.KEY_ABSENT && error.message.includes(KEY_ENV),
    );
    assert.equal(server.calls.length, 0, 'لا مِقبسَ يُفتَحُ قبلَ وجودِ المفتاحِ');
  } finally {
    await server.close();
  }
});

test('عنوانٌ بلا تعميةٍ أو بسرٍّ في نفسِه يُرفَضُ قبلَ أيِّ نداءٍ', () => {
  assert.throws(
    () => createHttpsAdapter(declarationFor(443, { endpoint: 'http://localhost/v1' })),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.ENDPOINT_INSECURE,
  );
  assert.throws(
    () => createHttpsAdapter(declarationFor(443, { endpoint: 'لا-عنوانَ' })),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.ENDPOINT_INSECURE,
  );
  assert.throws(
    () =>
      createHttpsAdapter(declarationFor(443, { endpoint: 'https://user:pass@provider/v1/infer' })),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.SECRET_INLINE,
  );
  assert.throws(
    () => createHttpsAdapter(declarationFor(443, { headers: { authorization: 'Bearer x' } })),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.SECRET_INLINE,
  );
  assert.throws(
    () => createHttpsAdapter(declarationFor(443, { headers: { 'x-key': 'sk-live-abcdef' } })),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.SECRET_INLINE,
  );
  assert.throws(
    () => createHttpsAdapter(declarationFor(443, { requestExtras: { token: 'ghp_abcdefghij' } })),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.SECRET_INLINE,
  );
  assert.throws(
    () => createHttpsAdapter(declarationFor(443, { outputPath: [] })),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('مزوّدٌ يَرُدُّ بحالةِ خطأٍ ويُرَدِّدُ المفتاحَ: الرفضُ مُسمّىً والمفتاحُ محجوبٌ', async () => {
  const server = await provider((_captured, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `مفتاحٌ مرفوضٌ: ${SECRET}` }));
  });
  try {
    const execute = httpsExecutor(declarationFor(server.port));
    await assert.rejects(
      execute({
        model: { id: 'model:test', purpose: 'planning' },
        purpose: 'planning',
        input: 'س',
      }),
      (
        /** @type {Error & { code?: string, message: string, detail?: Record<string, unknown> }} */
        error,
      ) =>
        error.code === ADAPTER_ERRORS.PROVIDER_REFUSED &&
        error.detail?.['status'] === 401 &&
        !error.message.includes(SECRET) &&
        error.message.includes(REDACTION_MARK),
    );
  } finally {
    await server.close();
  }
});

test('ردٌّ لا يُطابِقُ المسارَ المُعلَنَ يُرفَضُ ولا يُخمَّنُ من حقلٍ يُشبِهُه', async () => {
  const server = await provider(respondJson({ output: 'في حقلٍ آخرَ' }));
  try {
    const execute = httpsExecutor(declarationFor(server.port));
    await assert.rejects(
      execute({
        model: { id: 'model:test', purpose: 'planning' },
        purpose: 'planning',
        input: 'س',
      }),
      (/** @type {Error & { code?: string }} */ error) =>
        error.code === ADAPTER_ERRORS.RESPONSE_UNREADABLE,
    );
  } finally {
    await server.close();
  }
});

test('ردٌّ ليس JSON يُرفَضُ بلا انفجارٍ في التحليلِ', async () => {
  const server = await provider((_captured, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('<html>ليس JSON</html>');
  });
  try {
    const execute = httpsExecutor(declarationFor(server.port));
    await assert.rejects(
      execute({
        model: { id: 'model:test', purpose: 'planning' },
        purpose: 'planning',
        input: 'س',
      }),
      (/** @type {Error & { code?: string }} */ error) =>
        error.code === ADAPTER_ERRORS.RESPONSE_UNREADABLE,
    );
  } finally {
    await server.close();
  }
});

test('ردٌّ يتجاوزُ السقفَ يُقطَعُ: استنزافُ الذاكرةِ ليس بطءَ مزوّدٍ', async () => {
  const server = await provider((_captured, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    const block = 'ب'.repeat(64 * 1024);
    // يُكتَبُ أكثرُ من السقفِ ثمَّ لا يُغلَقُ: القطعُ يجبُ أن يأتيَ من المُوائمِ.
    for (let written = 0; written < HTTPS_ADAPTER_MAX_RESPONSE_BYTES * 2; written += block.length) {
      response.write(block);
    }
  });
  try {
    const execute = httpsExecutor(declarationFor(server.port));
    await assert.rejects(
      execute({
        model: { id: 'model:test', purpose: 'planning' },
        purpose: 'planning',
        input: 'س',
      }),
      (/** @type {Error & { code?: string }} */ error) =>
        error.code === ADAPTER_ERRORS.RESPONSE_TOO_LARGE,
    );
  } finally {
    await server.close();
  }
});

test('مزوّدٌ يُبدِّلُ النموذجَ يُكشَفُ بالعقدِ: نموذجُ الردِّ يُقابَلُ بما وجَّهَ إليه السجلُّ', async () => {
  const server = await provider(
    respondJson({ choices: [{ text: 'جوابٌ' }], model: 'model:رخيصٌ' }),
  );
  try {
    const execute = httpsExecutor(declarationFor(server.port, { modelPath: ['model'] }));
    await assert.rejects(
      execute({
        model: { id: 'model:test', purpose: 'planning' },
        purpose: 'planning',
        input: 'س',
      }),
      (/** @type {Error & { code?: string }} */ error) =>
        error.code === ADAPTER_ERRORS.MODEL_MISMATCH,
    );
  } finally {
    await server.close();
  }
});

test('مزوّدٌ لا يَرُدُّ: المُهلةُ تُجهِضُ النداءَ بإشارةٍ يَراها المِقبسُ', async () => {
  /** @type {Array<import('node:http').ServerResponse>} */
  const held = [];
  /** @type {boolean[]} */
  const aborted = [];
  const server = await provider((_captured, response) => {
    held.push(response);
    response.on('close', () => aborted.push(response.writableFinished === false));
  });
  try {
    const execute = httpsExecutor(declarationFor(server.port, { timeoutMs: 300 }));
    await assert.rejects(
      execute({
        model: { id: 'model:test', purpose: 'planning' },
        purpose: 'planning',
        input: 'س',
      }),
      (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.TIMED_OUT,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(
      aborted.some((flag) => flag),
      'الخادمُ رأى النداءَ مقطوعاً؛ فمُهلةٌ تُهمِلُ النداءَ تَستهلكُ الحصّةَ بلا مُخرَجٍ',
    );
  } finally {
    for (const response of held) response.destroy();
    await server.close();
  }
});

test('شهادةُ جهةِ إصدارٍ مُعلَنةٌ ولا وجودَ لها: رفضٌ لا سقوطٌ إلى المخزنِ الافتراضيِّ', async () => {
  const adapter = createHttpsAdapter(
    declarationFor(443, {
      env: { [KEY_ENV]: SECRET, [CA_ENV]: path.join(TMP, 'لا-وجودَ-له.crt') },
    }),
  );
  await assert.rejects(
    Promise.resolve().then(() =>
      adapter.invoke({
        model: { id: 'model:test', purpose: 'planning' },
        purpose: 'planning',
        input: 'س',
        signal: new AbortController().signal,
      }),
    ),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('الاستدلالُ يمرُّ بالبوابةِ نفسِها إلى مزوّدٍ عبرَ الشبكةِ: تفويضٌ ثمَّ نداءٌ ثمَّ خصمٌ ثمَّ قيدٌ', async () => {
  const server = await provider(
    respondJson({
      choices: [{ text: 'جوابٌ عبرَ الشبكةِ' }],
      usage: { prompt_tokens: 13, completion_tokens: 5 },
    }),
  );
  try {
    const { gate, log, purpose } = await gateWithAdapter({
      execute: httpsExecutor(declarationFor(server.port)),
    });
    const outcome = await gate.infer({
      actor: minister(),
      purpose,
      input: 'اكتُبْ خُطّةً',
      inputClassification: 'internal',
    });
    assert.equal(outcome.output, 'جوابٌ عبرَ الشبكةِ');
    assert.equal(outcome.usage.inputTokens, 13);
    const completed = log.events.filter((event) => event.type === 'inference.completed');
    assert.equal(completed.length, 1);
    assert.equal(server.calls.length, 1);
    const call = /** @type {Captured} */ (server.calls[0]);
    assert.equal(call.headers['authorization'], `Bearer ${SECRET}`);
    // ولا مفتاحَ في القيدِ: السجلُّ يُقرأُ ويُصدَّرُ، فمفتاحٌ فيه مفتاحٌ مُذاعٌ.
    assert.ok(!JSON.stringify(log.events).includes(SECRET));
  } finally {
    await server.close();
  }
});

test('الحجبُ والقراءةُ بالمسارِ دالّتانِ مقيستانِ لا تفصيلٌ داخليٌّ', () => {
  assert.equal(redact(`قبلَ ${SECRET} بعدَ`, SECRET), `قبلَ ${REDACTION_MARK} بعدَ`);
  assert.equal(redact('نصٌّ بلا سرٍّ', ''), 'نصٌّ بلا سرٍّ');
  assert.equal(pluck({ a: [{ b: 'ج' }] }, ['a', 0, 'b']), 'ج');
  assert.equal(pluck({ a: 1 }, ['a', 'b']), undefined);
  assert.equal(pluck(null, ['a']), undefined);
});

test('لا طريقَ إلى البوابةِ إلا عبرَ العقدِ: المُوائمُ يُغلَّفُ بـ`executorFor` نفسِه', () => {
  const adapter = createHttpsAdapter(declarationFor(443));
  assert.equal(adapter.declaration.transport, 'https');
  assert.equal(adapter.declaration.network, 'https-only');
  assert.equal(adapter.declaration.apiKeyEnv, KEY_ENV);
  assert.equal(typeof executorFor(adapter), 'function');
});
