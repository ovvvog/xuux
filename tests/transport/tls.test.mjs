/**
 * اختبارُ إنهاءِ TLS في بابِ الدولةِ — الشطرُ الباقي من الدَينِ `D-1`.
 *
 * الدعوى المقيسةُ هنا أربعٌ، وكلُّ واحدةٍ تفشلُ وحدَها إن انكسرتْ:
 *
 * 1. **قناةٌ مُعمّاةٌ تعملُ فعلاً:** نداءٌ `https` حقيقيٌّ على مِقبسٍ حقيقيٍّ
 *    بشهادةٍ من جهةِ إصدارٍ مُعلَنةٍ **بتحقُّقٍ كاملٍ** يَرجعُ ببياناتِ الدولةِ من
 *    بوابةٍ حقيقيّةٍ. لا مُزيَّفَ في الطريقِ.
 * 2. **وشهادةٌ غيرُ موثوقةٍ تُرَدُّ:** بجهةِ إصدارٍ أخرى، وبلا جهةٍ مُعلَنةٍ أصلاً،
 *    تُقطَعُ المُصافحةُ **ولا تُقرأُ بايتُ بياناتٍ واحدةٌ**.
 * 3. **ولا سبيلَ إلى إسقاطِ التحقُّقِ:** لا خيارَ ولا عَلَمَ ولا متغيّرَ بيئةٍ؛ وإن
 *    كان التحقُّقُ مُعطَّلاً في العمليّةِ كلِّها رُفِضَ التشغيلُ. **ولا رجوعَ إلى
 *    نصٍّ صريحٍ عندَ نقصِ المادّةِ:** لا خادمَ، لا خادمٌ غيرُ مُشفَّرٍ «مؤقّتاً».
 * 4. **ولا تسريبَ لسرٍّ:** لا مفتاحَ في مستودعٍ، ولا مادّةَ مفتاحٍ في ردٍّ ولا في
 *    ترويسةٍ ولا في نصِّ خطأٍ. ورسالةُ الخطأِ تحملُ **المسارَ والسببَ لا المحتوى**.
 *
 * والمادّةُ تُولَّدُ في مجلَّدٍ مؤقَّتٍ **خارجَ المستودعِ** بـ`openssl` عندَ التشغيلِ،
 * وتُمحى بعدَه. وشهادةٌ مُخزَّنةٌ في المستودعِ لأجلِ اختبارٍ **مفتاحٌ مُسرَّبٌ من
 * يومِ كتابتِه**، ولو كان «للاختبارِ فقط».
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { request as httpsRequest } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import {
  TLS_ERRORS,
  TransportTlsError,
  assertVerificationEnabled,
  compileRoutes,
  createSecureStateServer,
  createStateServer,
  resolveServerTlsMaterial,
  secureClientOptions,
} from '../../src/transport/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';
import { issueMaterial } from '../helpers/tls-material.mjs';
import { listTrackedFiles } from '../../scripts/lib/git-files.mjs';

const ROOT = process.cwd();
const CONFIG_DIR = path.join(ROOT, 'config');
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });
const ROUTES = compileRoutes({ policy: API_POLICY });
const AUDITOR = 'agent:tls-auditor';

/** دولةٌ مصغَّرةٌ ببوابةٍ حقيقيّةٍ على مكوّناتٍ حقيقيّةٍ. */
function realGateway() {
  const log = new EventLog();
  const repositories = createMemoryRepositories();
  /** @type {Record<string, Record<string, unknown>>} */
  const identities = {
    [AUDITOR]: {
      id: AUDITOR,
      kind: 'service',
      state: 'active',
      role: MONITORING_POLICY.role,
      capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
    },
  };
  const agents = { get: async (/** @type {string} */ id) => identities[id] ?? null };
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: API_POLICY,
    log,
    agents,
    monitor,
    enforcementPoint: enforcementPointFor(log),
    requirePoP: false, // اختباراتٌ بلا إثباتِ حيازةٍ
  });
  return { gateway, log };
}

/**
 * نداءُ `https` بخياراتٍ صريحةٍ — يَرجعُ بالحالةِ والترويساتِ والجسمِ، أو بالخطأِ.
 * @param {{ port: number, path: string, token?: string, ca?: Buffer, rejectUnauthorized: true, minVersion: 'TLSv1.2' }} options
 * @returns {Promise<{ status: number, headers: Record<string, unknown>, body: string }>}
 */
function callSecurely(options) {
  return new Promise((resolve, reject) => {
    const call = httpsRequest(
      {
        host: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: 'GET',
        servername: 'localhost',
        rejectUnauthorized: options.rejectUnauthorized,
        minVersion: options.minVersion,
        ...(options.ca === undefined ? {} : { ca: options.ca }),
        ...(options.token === undefined
          ? {}
          : { headers: { authorization: `Bearer ${options.token}` } }),
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: /** @type {Record<string, unknown>} */ (response.headers),
            body,
          }),
        );
      },
    );
    call.on('error', reject);
    call.end();
  });
}

/**
 * يُشغِّلُ خادماً مُعمّىً على منفذٍ يختارُه النظامُ ويُغلِقُه حتماً.
 * @param {{ certFile: string, keyFile: string, caFile?: string, requestClientCertificate?: boolean }} tls
 * @param {(port: number, token: string) => Promise<void>} work
 */
async function serving(tls, work) {
  const { gateway } = realGateway();
  const session = await gateway.openSession({ actorId: AUDITOR });
  const server = createSecureStateServer({
    gateway: /** @type {never} */ (gateway),
    routes: ROUTES,
    webDir: null,
    certFile: tls.certFile,
    keyFile: tls.keyFile,
    // لا تُطلَبُ شهادةُ عميلٍ في هذه الاختباراتِ: المقيسُ تحقُّقُ العميلِ من
    // الخادمِ. وطلبُها كان سيَخلطُ دعوىً بدعوىً في اختبارٍ واحدٍ.
    requestClientCertificate: tls.requestClientCertificate ?? false,
    ...(tls.caFile === undefined ? {} : { caFile: tls.caFile }),
    env: {},
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    await work(port, String(session.token));
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}

/** مجلَّدٌ مؤقَّتٌ **خارجَ المستودعِ** لكلِّ الموادِّ، يُمحى في النهايةِ. */
const TMP = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'state-tls-')));
const TRUSTED = issueMaterial(TMP, 'trusted');
const OTHER = issueMaterial(TMP, 'other');

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('قراءةٌ عبرَ قناةٍ مُعمّاةٍ بجهةِ إصدارٍ مُعلَنةٍ وبتحقُّقٍ كاملٍ — وهذا نصُّ باقي `D-1`', async () => {
  const client = secureClientOptions({ caFile: TRUSTED.caFile, env: {} });
  // `rejectUnauthorized` مُثبَّتٌ في الوحدةِ لا مُمرَّراً من الاختبارِ.
  assert.equal(client.rejectUnauthorized, true);
  assert.equal(client.minVersion, 'TLSv1.2');
  assert.ok(client.ca instanceof Buffer, 'جهةُ الإصدارِ المُعلَنةُ لم تُحَلَّ');

  await serving(TRUSTED, async (port, token) => {
    const response = await callSecurely({ ...client, port, path: '/state/agents', token });
    assert.equal(response.status, 200);
    const body = /** @type {Record<string, unknown>} */ (JSON.parse(response.body));
    assert.equal(body.route, 'state.agents.list');
    assert.equal(body.status, 'ok');
    // والخادمُ لا يَزعُمُ نصّاً بعدَ أن أنهى التعميةَ: الترويسةُ تُقالُ عن حقيقةِ
    // المِقبسِ، ومعها `Strict-Transport-Security` التي لا تُرَدُّ على قناةِ نصٍّ.
    assert.equal(response.headers['x-state-transport'], 'tls; terminated-here');
    assert.equal(
      response.headers['strict-transport-security'],
      'max-age=31536000; includeSubDomains',
    );
    assert.equal(response.headers['cache-control'], 'no-store');
  });
});

test('شهادةٌ من جهةِ إصدارٍ غيرِ موثوقةٍ تُرَدُّ — ولا بايتَ بياناتٍ واحدةً', async () => {
  const client = secureClientOptions({ caFile: OTHER.caFile, env: {} });
  await serving(TRUSTED, async (port, token) => {
    await assert.rejects(
      () => callSecurely({ ...client, port, path: '/state/agents', token }),
      (/** @type {Error & { code?: string }} */ error) => {
        assert.ok(
          [
            'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            'SELF_SIGNED_CERT_IN_CHAIN',
            'DEPTH_ZERO_SELF_SIGNED_CERT',
            'CERT_SIGNATURE_FAILURE',
          ].includes(String(error.code)),
          `الرفضُ وقعَ لسببٍ آخرَ: ${String(error.code)} — ${error.message}`,
        );
        return true;
      },
    );
  });
});

test('وبلا جهةِ إصدارٍ مُعلَنةٍ تُرَدُّ كذلك — فالمخزنُ الموثوقُ لا يعرفُ هذه الشهادةَ', async () => {
  const client = secureClientOptions({ env: {} });
  assert.equal(client.rejectUnauthorized, true);
  assert.ok(!('ca' in client), 'جهةُ إصدارٍ غيرُ مُعلَنةٍ لا تُختلَقُ');
  await serving(TRUSTED, async (port) => {
    await assert.rejects(() => callSecurely({ ...client, port, path: '/state/agents' }));
  });
});

test('نقصُ مادّةِ TLS يَمنعُ الخادمَ — ولا رجوعَ إلى نصٍّ صريحٍ', () => {
  assert.throws(
    () => resolveServerTlsMaterial({ env: {} }),
    (/** @type {TransportTlsError} */ error) => {
      // والصنفُ مقيسٌ لا الرمزُ وحدَه: خطأٌ عامٌّ يَختلطُ بخطأِ نظامِ ملفّاتٍ
      // فيُفسَّرُ نقصُ الشهادةِ عُطلاً عارضاً ويُعادُ التشغيلُ بلا مادّةٍ.
      assert.ok(error instanceof TransportTlsError, 'نقصُ المادّةِ رُفِعَ بخطأٍ غيرِ مُصنَّفٍ');
      assert.equal(error.code, TLS_ERRORS.CERT_MISSING);
      return true;
    },
  );
  assert.throws(
    () => resolveServerTlsMaterial({ certFile: TRUSTED.certFile, env: {} }),
    (/** @type {TransportTlsError} */ error) => {
      assert.equal(error.code, TLS_ERRORS.KEY_MISSING);
      return true;
    },
  );
  // مسارٌ مُعلَنٌ لا يُقرأُ **يُفشِلُ ولا يُتجاهَلُ**: تجاهلُه يُنتِجُ خادماً بلا
  // شهادةٍ ظنَّ مُشغِّلُه أنّه أعلنَها.
  assert.throws(
    () =>
      resolveServerTlsMaterial({
        certFile: path.join(TMP, 'لا-وجودَ-له.crt'),
        keyFile: TRUSTED.keyFile,
        env: {},
      }),
    (/** @type {TransportTlsError} */ error) => {
      assert.equal(error.code, TLS_ERRORS.MATERIAL_UNREADABLE);
      return true;
    },
  );
  // وملفٌّ يُقرأُ وليس PEM يُرَدُّ كذلك.
  const junk = path.join(TMP, 'junk.crt');
  fs.writeFileSync(junk, 'هذا ليس شهادةً\n');
  assert.throws(
    () => resolveServerTlsMaterial({ certFile: junk, keyFile: TRUSTED.keyFile, env: {} }),
    (/** @type {TransportTlsError} */ error) => {
      assert.equal(error.code, TLS_ERRORS.MATERIAL_UNREADABLE);
      return true;
    },
  );
});

test('تعطيلُ التحقُّقِ في العمليّةِ كلِّها يَمنعُ التشغيلَ — لا يُتجاهَلُ', () => {
  assert.throws(
    () => assertVerificationEnabled({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
    (/** @type {TransportTlsError} */ error) => {
      assert.equal(error.code, TLS_ERRORS.VERIFICATION_DISABLED);
      return true;
    },
  );
  assert.throws(() => secureClientOptions({ env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' } }));
  assert.throws(() =>
    resolveServerTlsMaterial({
      certFile: TRUSTED.certFile,
      keyFile: TRUSTED.keyFile,
      env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    }),
  );
  // و`1` ليست تعطيلاً فلا تُمنَعُ: حاجزٌ يَمنعُ الصحيحَ يُدفَعُ إلى الالتفافِ عليه.
  assert.doesNotThrow(() => assertVerificationEnabled({ NODE_TLS_REJECT_UNAUTHORIZED: '1' }));
  assert.doesNotThrow(() => assertVerificationEnabled({}));
});

/**
 * يُجرِّدُ النصَّ من التعليقاتِ قبلَ فحصِ الشفرةِ.
 * فالتعليقُ الذي **يَنهى** عن عَلَمٍ غيرِ آمنٍ يذكرُ اسمَه، ومَسحٌ لا يُميِّزُ
 * التعليقَ من الشفرةِ يَقرأُ النهيَ أمراً فيَفشلُ على وثيقةٍ صحيحةٍ.
 * @param {string} text
 * @returns {string}
 */
function codeOf(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

test('لا سبيلَ في الشفرةِ إلى إسقاطِ التحقُّقِ، ولا مفتاحَ في المستودعِ', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'transport', 'tls.mjs'), 'utf8');
  const code = codeOf(source);
  for (const forbidden of ['rejectUnauthorized: false', 'rejectUnauthorized:false', 'insecure']) {
    assert.ok(!code.includes(forbidden), `سبيلٌ إلى إسقاطِ التحقُّقِ في الوحدةِ: ${forbidden}`);
  }
  assert.ok(
    !/rejectUnauthorized:(?!\s*true)/.test(code),
    '`rejectUnauthorized` صارَ محسوباً لا مُثبَّتاً — فقد يُصبحُ `false` ببيئةٍ.',
  );
  assert.ok(code.includes('rejectUnauthorized: true'), 'اختفى تثبيتُ `rejectUnauthorized: true`.');
  // و`NODE_TLS_REJECT_UNAUTHORIZED` تُقرأُ **لتُرفَضَ** لا لتُطاعَ: الفرقُ أنّ
  // الشفرةَ لا تُشتقُّ منها خياراً، بل تَرفعُ خطأً إن كانت مُعطِّلةً.
  assert.ok(code.includes('TLS_ERRORS.VERIFICATION_DISABLED'), 'اختفى الفشلُ المُغلَقُ.');

  // القراءةُ بـ`-z` لا سطراً سطراً (‏`DOC-11`): `git ls-files` يَهرُبُ المسارَ غيرَ
  // ASCII ويقتبسُه، فيصيرُ آخرُ السطرِ اقتباساً لا `.pem` — **فيمرُّ مفتاحٌ متعقَّبٌ
  // تحتَ مسارٍ عربيٍّ بلا صرخةٍ**. وهذا إخفاءٌ صامتٌ لا نقصُ تغطيةٍ.
  const tracked = listTrackedFiles({ cwd: ROOT });
  const suspicious = tracked.filter((file) => /\.(pem|key|p12|pfx)$/.test(file));
  assert.deepEqual(
    suspicious,
    [],
    `مادّةُ مفاتيحَ مُتتبَّعةٌ في المستودعِ: ${suspicious.join(', ')}`,
  );
});

test('لا مادّةَ مفتاحٍ في ردٍّ ولا في ترويسةٍ ولا في نصِّ خطأٍ', async () => {
  const keyPem = fs.readFileSync(TRUSTED.keyFile, 'utf8');
  const secretLine = keyPem
    .split('\n')
    .filter((line) => !line.includes('-----') && line.trim().length > 16)[0];
  assert.ok(typeof secretLine === 'string', 'لم تُقرأْ مادّةُ المفتاحِ للمقارنةِ');

  const client = secureClientOptions({ caFile: TRUSTED.caFile, env: {} });
  await serving(TRUSTED, async (port, token) => {
    for (const target of ['/state/agents', '/state/nope']) {
      const response = await callSecurely({ ...client, port, path: target, token });
      const seen = `${JSON.stringify(response.headers)}${response.body}`;
      assert.ok(!seen.includes(secretLine), `مادّةُ المفتاحِ ظهرتْ في ردِّ ${target}`);
      assert.ok(!seen.includes('PRIVATE KEY'), `وسمُ مفتاحٍ خاصٍّ في ردِّ ${target}`);
      assert.ok(!seen.includes(TRUSTED.keyFile), `مسارُ المفتاحِ ظهرَ في ردِّ ${target}`);
    }
  });

  // ورسالةُ الخطأِ تحملُ المسارَ والسببَ **ولا تحملُ المحتوى**: نصُّ خطأٍ يُطبَعُ
  // في سجلٍّ، ومفتاحٌ في سجلٍّ مُسرَّبٌ لكلِّ من يقرأُ السجلَّ.
  const notPem = path.join(TMP, 'not-a-key.key');
  fs.writeFileSync(notPem, `سرٌّ لا ينبغي أن يظهرَ: ${secretLine}\n`);
  assert.throws(
    () => resolveServerTlsMaterial({ certFile: TRUSTED.certFile, keyFile: notPem, env: {} }),
    (/** @type {Error} */ error) => {
      assert.ok(error.message.includes(notPem), 'الرسالةُ لا تُسمّي المسارَ فلا تُصلَحُ العِلّةُ');
      assert.ok(!error.message.includes(secretLine), 'محتوى الملفِّ ظهرَ في نصِّ الخطأِ');
      return true;
    },
  );
});

test('خادمُ النصِّ ما زالَ يُصرِّحُ بأنّه نصٌّ ولا يَزعُمُ `HSTS`', async () => {
  const { fetch } = globalThis;
  const { gateway } = realGateway();
  const server = createStateServer({
    gateway: /** @type {never} */ (gateway),
    routes: ROUTES,
    webDir: null,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/state/agents`);
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('x-state-transport'),
      'plaintext; terminate-tls-upstream',
      'خادمُ النصِّ زعمَ تعميةً — وهذا إيهامُ تأمينٍ',
    );
    assert.equal(
      response.headers.get('strict-transport-security'),
      null,
      '`HSTS` على قناةِ نصٍّ زعمُ تأمينٍ لم يقعْ',
    );
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});
