// اختبارُ مزوّدي الاستدلالِ كبياناتٍ — سدادُ `D-11` (الشوطُ الثالثُ).
//
// **ما يُقاسُ هنا وثيقةٌ حقيقيّةٌ لا كائنٌ في الذاكرةِ:** تُكتَبُ وثائقُ مزوّدينَ
// في مجلَّداتٍ مؤقَّتةٍ، فتُقرَأُ ويُتحقَّقُ منها بمخطَّطِها، ثمَّ يُبنى المُوائمُ
// منها ويُنادى على **مِقبسٍ حقيقيٍّ بتعميةٍ حقيقيّةٍ** عبرَ بوابةِ الاستدلالِ
// نفسِها. والوثيقةُ النافذةُ في `config/` تُقرَأُ كما هي، فما يُقاسُ إعلانُ
// الدولةِ لا إعلانَ اختبارٍ.
//
// **والمقيسُ الأثقلُ هو الرفضُ:** وثيقةٌ غائبةٌ، وعنوانٌ بلا تعميةٍ، ومعرّفٌ
// مكرَّرٌ، ومفتاحٌ مكتوبٌ في الوثيقةِ بدلَ اسمِ متغيّرِه، وترويسةُ تفويضٍ ثابتةٌ،
// ومُهلةٌ فوقَ سقفِ العقدِ، ومزوّدٌ غيرُ مُعلَنٍ يُطلَبُ باسمِه.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { ADAPTER_ERRORS, MAX_ADAPTER_TIMEOUT_MS } from '../../src/inference/adapters/contract.mjs';
import {
  createDeclaredHttpsAdapter,
  declaredHttpsExecutor,
  declaredProvider,
  describeInferenceProviders,
  INFERENCE_PROVIDERS_FILE,
  loadInferenceProviders,
} from '../../src/inference/providers.mjs';
import { gateWithAdapter, minister } from '../helpers/inference-gate.mjs';
import { issueMaterial } from '../helpers/tls-material.mjs';

const TMP = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'inference-providers-')));
const TRUSTED = issueMaterial(TMP, 'declared');
const KEY_ENV = 'DECLARED_PROVIDER_API_KEY';
const CA_ENV = 'DECLARED_PROVIDER_CA_FILE';
// قيمةٌ مُختلَقةٌ لمِقبسٍ محلِّيٍّ في هذا الاختبارِ وحدَه، لا مفتاحَ مزوّدٍ:
const SECRET = 'sk-declared-0123456789'; // secret-scan:allow

/**
 * يكتبُ وثيقةَ مزوّدينَ في مجلَّدٍ مؤقَّتٍ بلا `schemas/` — فالمخطَّطُ يُقرأُ من
 * موضعِه الواحدِ في `config/schemas`، ولو نُسِخَ لصارَ للوثيقةِ مخطَّطانِ.
 *
 * @param {unknown} document
 * @returns {string}
 */
function writeDocument(document) {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(TMP, 'dir-')));
  fs.writeFileSync(path.join(dir, INFERENCE_PROVIDERS_FILE), JSON.stringify(document), 'utf8');
  return dir;
}

/**
 * إعلانُ مزوّدٍ صحيحٍ يُعدَّلُ منه ما يُقاسُ رفضُه.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function providerEntry(overrides = {}) {
  return {
    id: 'adapter:probe',
    provider: 'مزوّدُ اختبارٍ',
    transport: 'https',
    endpoint: 'https://provider.invalid/v1/infer',
    apiKeyEnv: KEY_ENV,
    timeoutMs: 5000,
    requestFields: { model: 'model', input: 'prompt', purpose: 'purpose' },
    outputPath: ['choices', 0, 'text'],
    usagePaths: {
      inputTokens: ['usage', 'prompt_tokens'],
      outputTokens: ['usage', 'completion_tokens'],
    },
    statement: 'إعلانُ مزوّدٍ للاختبارِ وحدَه.',
    ...overrides,
  };
}

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function documentWith(overrides = {}) {
  return { version: 1, owner: 'crown', providers: [providerEntry(overrides)] };
}

/**
 * خادمُ مزوّدٍ مُصطَنَعٌ بتعميةٍ حقيقيّةٍ: مِقبسٌ يُنهي TLS بشهادةٍ موقَّعةٍ من
 * جهةِ إصدارٍ تُولَّدُ في المُهلةِ نفسِها.
 *
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ port: number, calls: Array<{ url: string, headers: import('node:http').IncomingHttpHeaders, body: string }>, close: () => Promise<void> }>}
 */
async function provider(payload) {
  /** @type {Array<{ url: string, headers: import('node:http').IncomingHttpHeaders, body: string }>} */
  const calls = [];
  const server = createServer(
    {
      cert: fs.readFileSync(TRUSTED.certFile),
      key: fs.readFileSync(TRUSTED.keyFile),
      minVersion: 'TLSv1.2',
    },
    (request, response) => {
      /** @type {Buffer[]} */
      const chunks = [];
      request.on('data', (/** @type {Buffer} */ chunk) => chunks.push(chunk));
      request.on('end', () => {
        calls.push({
          url: request.url ?? '',
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
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

test('الوثيقةُ النافذةُ في `config/` تُقرأُ وتمرُّ بمخطَّطِها، وكلُّ مزوّدٍ فيها يُبنى مُوائماً بعنوانِه المُعلَنِ', () => {
  const document = loadInferenceProviders();
  assert.ok(document.providers.length >= 1);
  for (const entry of document.providers) {
    const adapter = createDeclaredHttpsAdapter({ id: entry.id, env: { [KEY_ENV]: SECRET } });
    assert.equal(adapter.declaration.id, entry.id);
    assert.equal(adapter.declaration.transport, 'https');
    assert.equal(adapter.declaration.network, 'https-only');
    assert.equal(adapter.declaration.apiKeyEnv, entry.apiKeyEnv);
    assert.equal(adapter.endpoint.protocol, 'https:');
    assert.equal(adapter.endpoint.href, entry.endpoint);
  }
});

test('وثيقةٌ مُجمَّدةٌ: تعديلُ إعلانٍ بعدَ تحميلِه لا يُغيِّرُ ما تقرأُه الدولةُ', () => {
  const document = loadInferenceProviders();
  const first = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (document.providers[0])
  );
  assert.throws(() => {
    first['endpoint'] = 'https://attacker.invalid/v1';
  }, TypeError);
});

test('وثيقةٌ غائبةٌ رفضٌ مُسمّىً: لا سجلَّ مزوّدينَ فارغٌ يُقرأُ «لا مزوّدَ»', () => {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(TMP, 'empty-')));
  assert.throws(
    () => loadInferenceProviders({ dir }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('عنوانٌ بلا تعميةٍ يُرفَضُ في المخطَّطِ: ومفتاحٌ يُرسَلُ بلا تعميةٍ مفتاحٌ مقروءٌ على الطريقِ', () => {
  const dir = writeDocument(documentWith({ endpoint: 'http://provider.invalid/v1/infer' }));
  assert.throws(
    () => loadInferenceProviders({ dir }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('عنوانٌ يحمِلُ اسماً وكلمةَ مرورٍ في نفسِه يُرفَضُ: والعنوانُ يُكتَبُ في السجلّاتِ', () => {
  const dir = writeDocument(documentWith({ endpoint: 'https://user:pass@provider.invalid/v1' }));
  assert.throws(
    () => loadInferenceProviders({ dir }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('مفتاحٌ مكتوبٌ في الوثيقةِ بدلَ اسمِ متغيّرِه: رفضٌ برمزِ السرِّ لا برمزِ الشكلِ', () => {
  const dir = writeDocument(documentWith({ apiKeyEnv: SECRET }));
  assert.throws(
    () => loadInferenceProviders({ dir }),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.SECRET_INLINE,
  );
});

test('اسمُ متغيّرٍ بشكلٍ غيرِ مُعلَنٍ يُرفَضُ: `apiKeyEnv` اسمٌ لا قيمةٌ', () => {
  const dir = writeDocument(documentWith({ apiKeyEnv: 'provider-key' }));
  assert.throws(
    () => loadInferenceProviders({ dir }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('ترويسةُ تفويضٍ ثابتةٌ في الوثيقةِ رفضٌ: التفويضُ يُبنى عندَ النداءِ من البيئةِ', () => {
  const dir = writeDocument(documentWith({ headers: { authorization: 'Basic ثابتٌ' } }));
  assert.throws(
    () => loadInferenceProviders({ dir }),
    (/** @type {Error & { code?: string }} */ error) => error.code === ADAPTER_ERRORS.SECRET_INLINE,
  );
});

test('قيمةٌ تُشبِهُ مفتاحاً في ترويسةٍ ثابتةٍ أو في حقلِ طلبٍ ثابتٍ: رفضٌ في الحالَينِ', () => {
  for (const document of [
    documentWith({ headers: { 'x-vendor-key': SECRET } }),
    documentWith({ requestExtras: { token: SECRET } }),
  ]) {
    const dir = writeDocument(document);
    assert.throws(
      () => loadInferenceProviders({ dir }),
      (/** @type {Error & { code?: string }} */ error) =>
        error.code === ADAPTER_ERRORS.SECRET_INLINE,
    );
  }
});

test('معرّفٌ مكرَّرٌ رفضٌ: ومعرّفٌ يُشيرُ إلى عنوانينِ عنوانٌ لا يُعرَفُ أيُّهما النافذُ', () => {
  const dir = writeDocument({
    version: 1,
    owner: 'crown',
    providers: [providerEntry(), providerEntry({ endpoint: 'https://other.invalid/v1' })],
  });
  assert.throws(
    () => loadInferenceProviders({ dir }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('مُهلةٌ فوقَ سقفِ العقدِ رفضٌ: وما فوقَ السقفِ انتظارٌ لا مُهلةٌ', () => {
  const dir = writeDocument(documentWith({ timeoutMs: MAX_ADAPTER_TIMEOUT_MS + 1 }));
  assert.throws(
    () => loadInferenceProviders({ dir }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('مزوّدٌ غيرُ مُعلَنٍ يُطلَبُ باسمِه: رفضٌ ولا مُوائمَ بعنوانٍ مُخمَّنٍ', () => {
  const dir = writeDocument(documentWith());
  assert.throws(
    () => declaredProvider({ id: 'adapter:not-declared', dir }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === ADAPTER_ERRORS.DECLARATION_INVALID,
  );
});

test('وصفُ المزوّدينَ يُخرِجُ اسمَ متغيّرِ المفتاحِ وحضورَه ولا يُخرِجُ قيمتَه', () => {
  const dir = writeDocument(documentWith());
  const absent = describeInferenceProviders({ dir, env: {} });
  assert.deepEqual(absent, [
    {
      id: 'adapter:probe',
      provider: 'مزوّدُ اختبارٍ',
      endpoint: 'https://provider.invalid/v1/infer',
      apiKeyEnv: KEY_ENV,
      keyPresent: false,
      timeoutMs: 5000,
    },
  ]);
  const present = describeInferenceProviders({ dir, env: { [KEY_ENV]: SECRET } });
  assert.equal(present[0]?.keyPresent, true);
  assert.ok(!JSON.stringify(present).includes(SECRET));
});

test('مزوّدٌ مُعلَنٌ في وثيقةٍ يُنادى عبرَ البوابةِ على مِقبسٍ مُعمّىً حقيقيٍّ، والمفتاحُ من البيئةِ', async () => {
  const server = await provider({
    choices: [{ text: 'جوابُ مزوّدٍ مُعلَنٍ' }],
    usage: { prompt_tokens: 9, completion_tokens: 4 },
  });
  try {
    const dir = writeDocument(
      documentWith({
        endpoint: `https://127.0.0.1:${server.port}/v1/infer`,
        caFileEnv: CA_ENV,
      }),
    );
    const execute = declaredHttpsExecutor({
      id: 'adapter:probe',
      dir,
      env: { ...process.env, [KEY_ENV]: SECRET, [CA_ENV]: TRUSTED.caFile },
    });
    const { gate, log, purpose, model } = await gateWithAdapter({ execute });
    const answer = await gate.infer({
      actor: minister(),
      purpose,
      input: 'سؤالٌ إلى مزوّدٍ مُعلَنٍ',
      inputClassification: 'internal',
    });
    assert.equal(answer.output, 'جوابُ مزوّدٍ مُعلَنٍ');
    assert.equal(answer.modelId, model.id);
    assert.equal(server.calls.length, 1);
    const call =
      /** @type {{ url: string, headers: import('node:http').IncomingHttpHeaders, body: string }} */ (
        server.calls[0]
      );
    assert.equal(call.url, '/v1/infer');
    assert.equal(call.headers['authorization'], `Bearer ${SECRET}`);
    assert.deepEqual(JSON.parse(call.body), {
      model: model.id,
      prompt: 'سؤالٌ إلى مزوّدٍ مُعلَنٍ',
      purpose,
    });
    assert.ok(log.events.some((event) => event.type === 'inference.completed'));
  } finally {
    await server.close();
  }
});
