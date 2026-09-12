/**
 * اختبارُ واجهةِ مشهدِ الدولةِ — سدادُ الشطرِ الثالثِ من الدَينِ `D-1`.
 *
 * والواجهةُ تُقاسُ كما يُقاسُ سواها. وهذا الملفُّ لا يَقيسُ «هل تظهرُ الصفحةُ
 * جميلةً» — ذاك ذوقٌ لا يُختبَرُ — بل يَقيسُ العهودَ التي إن انكسرتْ صارتِ
 * الواجهةُ **ثقباً في الحُكمِ** لا نافذةً عليه:
 *
 * 1. أنّ الصفحةَ تُخدَمُ فعلاً من طبقةِ النقلِ بترويسةِ سياسةِ محتوىً صارمةٍ.
 * 2. أنّها لا تَحمِلُ شفرةً ولا نمطاً داخليّاً، فالسياسةُ الصارمةُ لا تُبطِلُها.
 * 3. أنّ الشفرةَ لا تستعملُ `innerHTML`: بياناتُ الدولةِ يكتبُها غيرُ من يقرأُها.
 * 4. أنّ الرمزَ يُحمَلُ في الترويسةِ، ولا يُكتَبُ في عنوانٍ ولا ذاكرةٍ دائمةٍ.
 * 5. أنّ الواجهةَ قارئةٌ: لا فعلَ غيرَ `GET` في شفرتِها.
 * 6. أنّها لا تُصرِّحُ بجدولِ مساراتٍ مكتوبٍ يداً يفترقُ عن `config/api.yaml`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import { EventLog } from '../../src/root-of-trust/index.mjs';
import { compileRoutes, createStateServer } from '../../src/transport/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';

const { fetch } = globalThis;

const ROOT = process.cwd();
const WEB_DIR = path.join(ROOT, 'web');
const HTML = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
const SCRIPT_TEXT = fs.readFileSync(path.join(WEB_DIR, 'app.mjs'), 'utf8');

/**
 * يُجرِّدُ التعليقاتَ قبلَ الفحصِ. وبدونِه يفشلُ الفحصُ على تعليقٍ يقولُ «لا
 * `innerHTML` بحالٍ» — أي يُعاقِبُ التصريحَ بالعهدِ بدلَ أن يَقيسَه، فيدفعُ
 * الكاتبَ إلى حذفِ التوثيقِ لا إلى الالتزامِ.
 * @param {string} text
 * @returns {string}
 */
function codeOf(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const SCRIPT = codeOf(SCRIPT_TEXT);

test('صفحةُ المشهدِ تُخدَمُ من طبقةِ النقلِ بسياسةِ محتوىً صارمةٍ', async () => {
  const log = new EventLog();
  const policy = loadApiPolicy();
  const monitoringPolicy = loadMonitoringPolicy();
  const agents = { get: async () => null };
  const gateway = new ApiGateway({
    policy,
    log,
    agents: /** @type {never} */ (agents),
    monitor: new MonitorAgent({
      policy: monitoringPolicy,
      repositories: createMemoryRepositories(),
      agents: /** @type {never} */ (agents),
      log: /** @type {never} */ (log),
    }),
    enforcementPoint: enforcementPointFor(log),
  });
  const server = createStateServer({
    gateway: /** @type {never} */ (gateway),
    webDir: WEB_DIR,
    routes: compileRoutes({ policy }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get('content-type')), /text\/html/);
    const csp = String(response.headers.get('content-security-policy'));
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    // ولا نموذجَ يُرسَلُ إلى وجهةٍ: الإرسالُ يُمنَعُ في الشفرةِ ويُقرأُ بـ`fetch`.
    assert.match(csp, /form-action 'none'/);
    // `unsafe-inline` في سياسةٍ يُبطِلُ أثرَها كلَّه: يكفي حَقْنُ وسمٍ واحدٍ.
    assert.ok(!csp.includes('unsafe-inline'), 'سياسةٌ تُجيزُ `unsafe-inline` ليست سياسةً');
    assert.ok(!csp.includes('unsafe-eval'), 'سياسةٌ تُجيزُ `unsafe-eval` ليست سياسةً');
    const body = await response.text();
    assert.ok(body.includes('مشهدُ الدولةِ'), 'الصفحةُ المُخدَّمةُ ليست صفحةَ المشهدِ');
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test('صفحةُ المشهدِ بلا شفرةٍ ولا نمطٍ داخليٍّ ولا مصدرٍ خارجيٍّ', () => {
  assert.ok(
    !/<script(?![^>]*\ssrc=)[^>]*>/i.test(HTML),
    'وسمُ شفرةٍ بلا `src` يعني شفرةً داخليّةً تُلزِمُ بتخفيفِ السياسةِ',
  );
  assert.ok(!/<style[\s>]/i.test(HTML), 'نمطٌ داخليٌّ يُلزِمُ بتخفيفِ السياسةِ كذلك');
  assert.ok(!/\son\w+\s*=/i.test(HTML), 'مُعالِجُ حدثٍ في الوسمِ شفرةٌ داخليّةٌ مُقنَّعةٌ');
  // ولا مصدرَ بعيداً: كلُّ فتحةٍ للصفحةِ كانت ستُخبِرُ طرفاً ثالثاً بوقتِ القراءةِ.
  for (const remote of ['http://', 'https://', '//cdn', 'fonts.googleapis']) {
    assert.ok(!HTML.includes(remote), `مصدرٌ خارجيٌّ في الصفحةِ: ${remote}`);
  }
});

test('شفرةُ الواجهةِ لا تكتبُ بياناتَ الدولةِ كوسومٍ (`innerHTML`)', () => {
  for (const forbidden of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
    assert.ok(!SCRIPT.includes(forbidden), `${forbidden} يُحوِّلُ صفّاً في القاعدةِ إلى شفرةٍ`);
  }
  assert.ok(SCRIPT.includes('textContent'), 'النصُّ يُكتَبُ بـ`textContent`');
  assert.ok(!SCRIPT.includes('eval('), 'لا تقويمَ نصٍّ شفرةً');
});

test('رمزُ الجلسةِ في الترويسةِ لا في العنوانِ ولا في ذاكرةٍ دائمةٍ', () => {
  assert.match(SCRIPT, /headers\['authorization'\] = `Bearer \$\{token\}`/);
  // رمزٌ في العنوانِ يُكتَبُ في سجلّاتِ الوسائطِ وتاريخِ المتصفِّحِ فيُسرَّبُ بعدَ
  // انتهاءِ الجلسةِ؛ وذاكرةٌ دائمةٌ تُقرأُ بأيِّ شفرةٍ تعملُ في الأصلِ لاحقاً.
  assert.ok(
    !/searchParams\.set\(\s*['"](token|access_token|authorization)['"]/.test(SCRIPT),
    'رمزٌ في مُلحقِ الاستعلامِ',
  );
  for (const store of ['localStorage', 'sessionStorage', 'document.cookie']) {
    assert.ok(!SCRIPT.includes(store), `الرمزُ يُخزَّنُ في ${store}`);
  }
  assert.match(HTML, /id="token"[\s\S]{0,120}type="password"/);
});

test('الواجهةُ قارئةٌ فقط — لا فعلَ غيرَ `GET` في شفرتِها', () => {
  assert.ok(SCRIPT.includes("method: 'GET'"), 'الفعلُ مُصرَّحٌ به `GET`');
  for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok(!SCRIPT.includes(`'${verb}'`), `فعلُ كتابةٍ في واجهةٍ قارئةٍ: ${verb}`);
  }
});

test('الواجهةُ لا تُصرِّحُ بجدولِ مساراتٍ ثانٍ يفترقُ عن وثيقةِ الواجهةِ', () => {
  // جدولٌ مكتوبٌ في الصفحةِ نسخةٌ ثانيةٌ من `config/api.yaml` تفترقُ عنها في أوّلِ
  // تعديلٍ؛ فمصدرُ المساراتِ الوثيقةُ، والصفحةُ تُرسِلُ ما يكتبُه القارئُ.
  const declared = compileRoutes({ policy: loadApiPolicy() });
  const mentioned = declared.filter(
    (route) => HTML.includes(String(route.path)) || SCRIPT.includes(String(route.path)),
  );
  assert.ok(
    mentioned.length <= 1,
    `مساراتٌ مكتوبةٌ يداً في الواجهةِ: ${mentioned.map((route) => String(route.path)).join(', ')}`,
  );
});

test('مُشغِّلُ التطويرِ يُعلِنُ حدودَه ولا يُنشَرُ افتراضاً على كلِّ الواجهاتِ', () => {
  const serve = fs.readFileSync(path.join(ROOT, 'scripts', 'serve-state.mjs'), 'utf8');
  assert.ok(serve.includes("argOf('--host', '127.0.0.1')"), 'الافتراضُ محلّيٌّ لا مُعلَنٌ للشبكةِ');
  assert.ok(!serve.includes('0.0.0.0'), 'خادمٌ بلا TLS لا يُربَطُ بكلِّ الواجهاتِ');
  for (const limit of ['TLS', 'requirePoP', 'M9.03']) {
    assert.ok(serve.includes(limit), `حدٌّ غيرُ مُعلَنٍ في المُشغِّلِ: ${limit}`);
  }
});
