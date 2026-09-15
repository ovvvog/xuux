#!/usr/bin/env node
/**
 * مُشغِّلُ بابِ الدولةِ للتطويرِ — سدادُ الشطرِ الثالثِ من الدَينِ `D-1`.
 *
 * **هذا السكربتُ للتطويرِ المحلّيِّ وحدَه، ولا يُقرأُ تركيبَ إنتاجٍ.** وسببُ ذلك
 * مُعلَنٌ لا مُخفىً في ثلاثةِ حدودٍ:
 *
 * 1. **`TLS` لا يُختلَقُ ولا يُزعَمُ:** بلا مادّةٍ مُعلَنةٍ يعملُ الخادمُ نصّاً
 *    صريحاً ويَرُدُّ في كلِّ ردٍّ `x-state-transport: plaintext; terminate-tls-upstream`؛
 *    ومَن أعلنَ `STATE_TLS_CERT_FILE` و`STATE_TLS_KEY_FILE` نالَ إنهاءَ `TLS`
 *    في موضعِه بتحقُّقٍ كاملٍ (`src/transport/tls.mjs`). ولا شهادةَ يُولِّدُها هذا
 *    السكربتُ لنفسِه: شهادةٌ موقَّعةٌ من نفسِها تُظهِرُ قُفلاً بلا سلطةِ تصديقٍ،
 *    وذاك إيهامُ تأمينٍ أسوأُ من انعدامِه لأنّه يُطمئِنُ من لا ينبغي أن يطمئنَّ.
 * 2. **إثباتُ الحيازةِ قائمٌ لا مُسقَطٌ (‏`WL-179`، إغلاقُ `LIVE-1`):** كان هذا
 *    النصُّ يُعلِنُ «لا إثباتَ حيازةٍ في هذا التركيبِ» **وقد صارَ لازماً افتراضاً
 *    في `SessionStore`، فكانَ الخادمُ يموتُ قبلَ الإنصاتِ** بـ`POP_REQUIRED` —
 *    فالإعلانُ كان وصفَ ماضٍ لا وصفَ حالٍ. **ولم يُعالَجْ بـ`requirePoP: false`**:
 *    يُولَّدُ للمُشغِّلِ مفتاحُ `Ed25519` **لحظيٌّ في الذاكرةِ لا يُكتَبُ على قرصٍ**،
 *    ويُسجَّلُ عامُّه، وتُفتَحُ الجلسةُ بتوقيعٍ. **ولكلِّ نداءٍ توقيعُه** — لا الفتحِ
 *    وحدَه.
 * 2ب. **وصفحةُ المتصفِّحِ لا تُوقِّعُ — والتوقيعُ صارَ في الخادمِ (‏`LIVE-5`):**
 *    لا مفتاحَ خاصَّ في الصّفحةِ، ولو حَمَلَتْهُ لكانَ مكشوفاً لكلِّ قارِئٍ.
 *    فكانَ المشهدُ **يُخدَمُ ولا يقرأُ**. **والآنَ يُوَصَلُ وسيطٌ موقِّعٌ
 *    في الخادمِ** (`scripts/dev-pop-proxy.mjs`): المفتاحُ يبقى هنا، والتوقيعُ
 *    يقعُ هنا، **وسلطتُهُ ومداهُ مُعلَنانِ** في كلِّ ردٍّ (‏ترويسةُ
 *    `x-state-pop-proxy`) وفي `docs/TRANSPORT.md` وفي واجهةِ المشهدِ نفسِها:
 *    فاعلٌ رقابيٌّ واحدٌ، **قراءةٌ فقط** (‏وكلُّ فعلٍ غيرِ `GET` يُرَدُّ `405`)،
 *    **والمضيفُ المحلّيُّ وحدَهُ** (‏وما سواهُ يُفشِلُ التركيبَ مُغلَقاً).
 *    **ولم يُغلَقْ بـ`requirePoP: false`**: الحمايةُ قائمةٌ، ونداءٌ يبلُغُ
 *    الطبقةَ الدّاخليّةَ بلا توقيعٍ يُرَدُّ `401` كما كانَ.
 * 3. **لا كتابةَ بحالٍ:** بابُ الدولةِ قارئٌ فقط، والكتابةُ أمرٌ ملكيٌّ موقَّعٌ
 *    (`M9.03`) بمفاتيحَ في وحدةِ أمانٍ.
 *
 * والهويّةُ التي تُفتَحُ بها الجلسةُ ليست مُختلَقةً: دورُها هو دورُ الرقابةِ
 * المُعلَنُ في `config/monitoring.yaml`، وقدراتُها قراءةٌ فقط، وقرارُ السماحِ
 * والمنعِ يبقى لنقطةِ التفويضِ على `config/policies.yaml` لا لهذا السكربتِ.
 *
 * الاستعمالُ:
 *   node scripts/serve-state.mjs [--port 4179] [--host 127.0.0.1] [--db]
 *
 * و`STATE_TLS_CERT_FILE` و`STATE_TLS_KEY_FILE` (ومعهما `STATE_TLS_CA_FILE`
 * اختياريّةً لجهةِ إصدارٍ موثوقةٍ) تُشغِّلُ `https`؛ ونقصُ إحداهما بعدَ إعلانِ
 * الأخرى **يُفشِلُ التشغيلَ ولا يَرجعُ إلى نصٍّ صامتاً**.
 *
 * و`--db` يقرأُ من قاعدةٍ حقيقيّةٍ عبرَ `DATABASE_URL` (ومعها `DATABASE_CA_FILE`
 * عندَ `sslmode=verify-full`)؛ وبدونِه المستودعاتُ في الذاكرةِ فالمشهدُ فارغٌ
 * والقراءةُ مسموحةٌ بصفرِ صفوفٍ — وهذا فرقٌ يُقالُ للقارئِ صريحاً في الواجهةِ.
 */

import { generateKeyPairSync } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

import { ApiGateway, SESSION_ERRORS, loadApiPolicy } from '../src/api/index.mjs';
import { createPoPClient } from '../src/api/pop-client.mjs';
import { composeEnforcementChain } from '../src/core/composition-root.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../src/observability/index.mjs';
import {
  createMemoryRepositories,
  createPostgresRepositories,
} from '../src/persistence/composition.mjs';
import { createPool } from '../src/persistence/db.mjs';
import { EventLog } from '../src/root-of-trust/index.mjs';
import { compileRoutes, createStateServer, createTlsServer } from '../src/transport/index.mjs';
import { PROXY_HEADER, assertLoopbackHost, createSigningProxyHandler } from './dev-pop-proxy.mjs';

const args = process.argv.slice(2);

/**
 * يقرأُ وسيطاً بصيغةِ `--name value`.
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function argOf(name, fallback) {
  const at = args.indexOf(name);
  if (at === -1) return fallback;
  const value = args[at + 1];
  return value === undefined || value.startsWith('--') ? fallback : value;
}

const PORT = Number(argOf('--port', '4179'));
// والافتراضُ المضيفُ المحلّيُّ لا كلُّ الواجهاتِ: خادمٌ بلا `TLS` ولا إثباتِ
// حيازةٍ يُربَطُ بكلِّ واجهاتِ الشبكةِ يصيرُ بابَ قراءةٍ لكلِّ من في الشبكةِ.
const HOST = argOf('--host', '127.0.0.1');
const USE_DB = args.includes('--db');
/**
 * `--self-check`: **إقلاعٌ يُقاسُ لا يُوصَفُ.** يُنادى البابُ على السلكِ مرّتَينِ —
 * مرّةً بلا توقيعٍ (‏فيُرَدُّ) ومرّةً بتوقيعٍ صحيحٍ (‏فيُقبَلُ) — ثمّ يُغلَقُ الخادمُ
 * ويُخرَجُ برمزٍ. **فمن قالَ «يعملُ» أعطى رمزَ استجابةٍ لا وصفاً.**
 */
const SELF_CHECK = args.includes('--self-check');
/**
 * إعلانُ مادّةِ `TLS` من البيئةِ: **مساراتٌ لا محتوىً**، فمحتوى المفتاحِ في
 * متغيّرِ بيئةٍ يُطبَعُ في كلِّ فحصِ عمليّةٍ ويُورَثُ لكلِّ ابنٍ.
 */
const TLS_CERT_FILE = process.env.STATE_TLS_CERT_FILE ?? '';
const TLS_KEY_FILE = process.env.STATE_TLS_KEY_FILE ?? '';
const USE_TLS = TLS_CERT_FILE !== '' || TLS_KEY_FILE !== '';
const CONFIG_DIR = path.join(process.cwd(), 'config');
const WEB_DIR = path.join(process.cwd(), 'web');
const ACTOR_LABEL = 'service:state-viewer-dev';

/**
 * @returns {Promise<{ repositories: unknown, close: () => Promise<void>, source: string }>}
 */
async function repositoriesFor() {
  if (!USE_DB) {
    return {
      repositories: createMemoryRepositories(),
      close: async () => {},
      source: 'مستودعاتٌ في الذاكرةِ (فارغةٌ) — لا قاعدةَ',
    };
  }
  const pool = createPool();
  return {
    repositories: createPostgresRepositories(pool),
    close: async () => {
      await pool.end();
    },
    source: 'قاعدةُ بياناتٍ حقيقيّةٌ عبرَ `DATABASE_URL`',
  };
}

/** المسارُ الذي يُقاسُ به الإقلاعُ: عدُّ الوكلاءِ — قراءةٌ بلا مُلحقاتٍ. */
const SELF_CHECK_ROUTE = 'state.agents.count';

/**
 * **فحصُ إقلاعٍ يُقاسُ على السلكِ.** يُثبِتُ أمرَينِ لا أمراً واحداً: أنّ البابَ
 * يُنصِتُ ويُجيبُ، **وأنّ الحمايةَ لم تُسقَطْ لِيُجيبَ** — فنداءٌ بلا توقيعٍ يُرَدُّ،
 * ونداءٌ بتوقيعٍ صحيحٍ يُقبَلُ. **ونجاحُ الأوّلِ وحدَه ليس نجاحاً.**
 *
 * **ومُنذُ إغلاقِ `LIVE-5` يُقاسُ أمرانِ زائدانِ:** أنَّ نداءَ المتصفِّحِ (‏بلا رمزٍ
 * ولا توقيعٍ) **يَبلُغُ ويُقبَلُ عبرَ الوسيطِ الموقِّعِ**، **وأنَّ مداهُ قراءةٌ فقط**:
 * فعلٌ كاتبٌ يُرَدُّ `405` برمزٍ مُسمَّىً. **والفحصانِ الأوّلانِ يُناديانِ الطبقةَ
 * الدّاخليّةَ مباشرةً** لأنَّ مرورَهما بالوسيطِ يُخفي ما يُقاسُ: الوسيطُ يُوقِّعُ،
 * فلا يبقى نداءٌ غيرُ موقَّعٍ يُثبِتُ أنَّ الحمايةَ قائمةٌ.
 * @param {{ base: string, proxyBase: string, token: string, sessionId: string, routeSpec: { id: string, method: string, path: string, action: string, resource: string } | null, popClient: ReturnType<typeof createPoPClient> }} ctx
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
async function selfCheck(ctx) {
  const lines = ['  فحصُ إقلاعٍ (‏`--self-check`) — مقيسٌ على السلكِ:'];
  const route = ctx.routeSpec;
  if (route === null) {
    lines.push(`    ❌ المسارُ «${SELF_CHECK_ROUTE}» غيرُ مُعلَنٍ في \`config/api.yaml\`.`);
    return { ok: false, lines };
  }
  const url = `${ctx.base}${route.path}`;

  const staticResponse = await fetch(`${ctx.proxyBase}/`);
  lines.push(
    `    مشهدٌ ساكنٌ: ‏${staticResponse.status} على \`/\` — والإنصاتُ ثابتٌ برمزٍ لا بوصفٍ.`,
  );

  const unsigned = await fetch(url, { headers: { authorization: `Bearer ${ctx.token}` } });
  const unsignedBody = await unsigned.text();
  // **و`>= 400` لا يكفي — وهذا هو دَينُ `LIVE-6` الذي مرَّ من هنا:** كان
  // هذا الفحصُ يرضى بأيِّ رقمٍ فوقَ `400`، فمرَّ `500` مرورَ الناجحِ وهو
  // **إعلانُ عَطَبٍ داخليٍّ لا رفضُ مصادقةٍ**. فصارَ الحكمُ على **رقمٍ
  // واحدٍ ورمزٍ واحدٍ**: `401` و`API_POP_REQUIRED` — وما خالفَ إخفاقٌ.
  /** @returns {unknown} رمزُ الرفضِ إن كانَ الردُّ جسماً مُفهرَساً، وإلا `null`. */
  const unsignedCodeOf = () => {
    try {
      return /** @type {{ code?: unknown }} */ (JSON.parse(unsignedBody)).code ?? null;
    } catch {
      return null;
    }
  };
  const unsignedCode = unsignedCodeOf();
  const refused = unsigned.status === 401 && unsignedCode === SESSION_ERRORS.POP_REQUIRED;
  lines.push(
    `    نداءٌ بلا توقيعٍ: ‏${unsigned.status} ‏«${String(unsignedCode)}» — ${
      refused
        ? 'مردودٌ رفضَ مصادقةٍ كما يجبُ'
        : unsigned.status < 400
          ? '❌ قُبِلَ! فالحمايةُ ساقطةٌ'
          : `❌ رُدَّ بغيرِ ‏401/\`${SESSION_ERRORS.POP_REQUIRED}\` — ورفضُ مصادقةٍ يُقالُ «عَطَباً داخليّاً» يُضلِّلُ المُنادي`
    }`,
  );

  const proof = ctx.popClient.signCall({ route, sessionId: ctx.sessionId, params: {} });
  const signed = await fetch(url, {
    headers: {
      authorization: `Bearer ${ctx.token}`,
      ...ctx.popClient.headersFor(proof),
    },
  });
  const signedBody = await signed.text();
  const accepted = signed.status === 200;
  lines.push(
    `    نداءٌ بتوقيعٍ صحيحٍ: ‏${signed.status} — ${accepted ? 'مقبولٌ' : '❌ مردودٌ: ' + signedBody.slice(0, 200)}`,
  );

  // **إغلاقُ `LIVE-5` مقيساً لا موصوفاً:** نداءٌ كنداءِ المتصفِّحِ — بلا
  // رمزٍ ولا توقيعٍ — يَبلُغُ الوسيطَ فيُوقِّعُ عنهُ فيُقبَلُ.
  const proxied = await fetch(`${ctx.proxyBase}${route.path}`, {
    headers: { accept: 'application/json' },
  });
  const proxyHeader = String(proxied.headers.get(PROXY_HEADER) ?? '');
  const proxiedOk = proxied.status === 200 && proxyHeader.includes('signed=yes');
  lines.push(
    `    نداءُ متصفِّحٍ عبرَ الوسيطِ: ‏${proxied.status} — ${
      proxiedOk
        ? 'مقبولٌ، والتوقيعُ وقعَ في الخادمِ لا في الصّفحةِ'
        : '❌ لم يُقبَلْ أو لم يُعلِنِ الوسيطُ توقيعَهُ'
    } ‏«${proxyHeader}»`,
  );

  // والمدى يُقاسُ كما تُقاسُ الميزةُ: فعلٌ كاتبٌ يُرَدُّ من الوسيطِ نفسِهِ.
  const write = await fetch(`${ctx.proxyBase}${route.path}`, { method: 'POST' });
  const writeBody = await write.text();
  const readOnly = write.status === 405 && writeBody.includes('DEV_PROXY_READ_ONLY');
  lines.push(
    `    فعلٌ كاتبٌ عبرَ الوسيطِ: ‏${write.status} — ${
      readOnly ? 'مردودٌ برمزٍ مُسمَّىً، فالمدى قراءةٌ فقط' : '❌ لم يُرَدَّ رفضَ مدىً'
    }`,
  );

  const ok = staticResponse.status === 200 && refused && accepted && proxiedOk && readOnly;
  lines.push(
    ok
      ? '    ✅ الحكمُ: البابُ يُقلِعُ ويُجيبُ، **وإثباتُ الحيازةِ قائمٌ لا مُسقَطٌ**، **والمشهدُ يقرأُ بوسيطٍ موقِّعٍ معلومِ السُّلطةِ والمدى**.'
      : '    ❌ الحكمُ: الفحصُ أخفقَ — ولا يُقالُ «يعملُ» بعدَ إخفاقٍ.',
  );
  if (!refused) lines.push(`    (‏جسمُ الردِّ غيرِ الموقَّعِ: ${unsignedBody.slice(0, 200)})`);
  return { ok, lines };
}

async function main() {
  const apiPolicy = loadApiPolicy({ dir: CONFIG_DIR });
  const monitoringPolicy = loadMonitoringPolicy({ dir: CONFIG_DIR });
  const routes = compileRoutes({ policy: apiPolicy });
  const { repositories, close, source } = await repositoriesFor();
  const log = new EventLog();

  // R6-A-04: السلسلةُ تُوصَلُ من **جذرِ التركيبِ** لا بيدِ كلِّ مُشغِّلٍ. كان هذا
  // النصُّ يُعيدُ بناءَ الهويّةِ والتفويضِ سطراً سطراً، فكانَ نسخةً ثانيةً من
  // التركيبِ تفترقُ عن غيرِها عندَ أوّلِ وصلةٍ تُضافُ. والآنَ الموضعُ واحدٌ:
  // `src/core/composition-root.mjs` — وبوابةُ الهويّةِ فيه ليست خياراً يُمرَّرُ.
  const chain = composeEnforcementChain({
    log: /** @type {never} */ (log),
    configDir: CONFIG_DIR,
    withLegislation: true,
    lawRepository: /** @type {Record<string, unknown>} */ (repositories)['laws'],
    crown: null,
  });
  const { registry, enforcementPoint } = chain;
  // تُسجَّلُ المشاهدُ في السجلِّ كي تُصدِّقَه البوابةُ: هويةٌ من جذرِ الثقةِ لا نصٌّ.
  const viewerAgent = await registry.register({
    name: 'state-viewer-dev',
    role: monitoringPolicy.role,
    capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
    kind: 'service',
  });
  const agents = {
    get: async (/** @type {string} */ id) => (id === viewerAgent.id ? viewerAgent : null),
  };

  const monitor = new MonitorAgent({
    policy: monitoringPolicy,
    repositories: /** @type {never} */ (repositories),
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  const gateway = new ApiGateway({
    policy: apiPolicy,
    log,
    agents,
    monitor,
    enforcementPoint,
  });

  // إثباتُ الحيازةِ لا إسقاطُه (‏`LIVE-1`): مفتاحٌ لحظيٌّ في الذاكرةِ، عامُّه
  // يُسجَّلُ للفاعلِ، وخاصُّه لا يُكتَبُ على قرصٍ ولا يُطبَعُ ويموتُ مع العمليّةِ.
  const popKeyPair = generateKeyPairSync('ed25519');
  const popClient = createPoPClient({ privateKey: popKeyPair.privateKey });
  gateway.registerPoPKey(
    viewerAgent.id,
    /** @type {string} */ (popKeyPair.publicKey.export({ type: 'spki', format: 'pem' })),
  );
  const session = await gateway.openSession(popClient.signOpen(viewerAgent.id));
  // ولا فرعَ ثالثَ بينَهما: إمّا تعميةٌ مُعلَنةٌ مادّتُها تُقرأُ، وإمّا نصٌّ
  // **مُصرَّحٌ به في كلِّ ردٍّ**. ونقصُ المادّةِ بعدَ إعلانِها يَرفعُ خطأً هنا.
  //
  // **طبقتانِ لا واحدةٌ — وإغلاقُ `LIVE-5`:** الدّاخليّةُ طبقةُ النقلِ نفسُها
  // بحُكمِها كامِلاً، مربوطةٌ بمنفَذٍ يَطلُبُهُ النِّطامُ على المضيفِ المحلّيِّ،
  // **وإثباتُ الحيازةِ فيها لازمٌ لم يُمسَّ**. والأماميّةُ وسيطٌ موقِّعٌ
  // يُناديها المتصفِّحُ، فيُوقِّعُ عنهُ بمفتاحِ المُشغِّلِ اللّحظيِّ **بسلطةٍ ومدىً
  // مُعلَنَيْنِ**. ولو وُقِّعَ في المتصفِّحِ لكانَ المفتاحُ في نصٍّ يقرأُهُ كلُّ مَنْ
  // فَتَحَ الصّفحةَ — وذاكَ إعلانُ مفتاحٍ لا إثباتُ حيازةٍ.
  const inner = createStateServer({
    gateway: /** @type {never} */ (gateway),
    webDir: WEB_DIR,
    routes,
  });
  await new Promise((resolve) => inner.listen(0, '127.0.0.1', () => resolve(undefined)));
  const innerAddress = inner.address();
  const innerPort =
    typeof innerAddress === 'object' && innerAddress !== null ? innerAddress.port : 0;

  // **فشلٌ مُغلَقٌ عندَ التركيبِ:** وسيطٌ يُوقِّعُ لكلِّ مُنادٍ، مربوطٌ
  // بواجهةٍ غيرِ محلّيّةٍ، **إسقاطٌ للحيازةِ بصيغةٍ أخرى** — فلا يُشَغَّلُ.
  assertLoopbackHost(HOST);
  const proxyHandler = createSigningProxyHandler({
    routes,
    specs: gateway.routes(),
    popClient,
    sessionId: session.sessionId,
    token: session.token,
    origin: `http://127.0.0.1:${innerPort}`,
  });
  // ولا فرعَ ثالثَ بينَهما: إمّا تعميةٌ مُعلَنةٌ مادّتُها تُقرأُ ويُتحَقَّقُ
  // منها في `src/transport/tls.mjs`، وإمّا نصᘑ **مُصرَّحٌ به في كلِّ ردٍّ**.
  // ونقصُ المادّةِ بعدَ إعلانِها يَرفعُ خطأً هنا ولا يَرجعُ إلى نصٍّ صامتاً.
  const server = USE_TLS
    ? createTlsServer({ handler: proxyHandler })
    : http.createServer(proxyHandler);

  await new Promise((resolve) => server.listen(PORT, HOST, () => resolve(undefined)));

  const lines = [
    '',
    '  بابُ الدولةِ — تشغيلُ تطويرٍ لا إنتاجٍ',
    '  ────────────────────────────────────',
    `  العنوانُ:      ${USE_TLS ? 'https' : 'http'}://${HOST}:${PORT}/`,
    `  المصدرُ:       ${source}`,
    `  الفاعلُ:       ${ACTOR_LABEL} بدورِ ${String(monitoringPolicy.role)}`,
    `  رمزُ الجلسةِ:   ${session.token}`,
    '',
    '  والمساراتُ القارئةُ مُشتقّةٌ من `config/api.yaml` لا مكتوبةٌ يداً:',
  ];
  for (const route of routes) {
    lines.push(`    ${String(route.method)}  ${String(route.path)}   → ${String(route.call)}`);
  }
  lines.push(
    '',
    USE_TLS
      ? `  إنهاءُ TLS في موضعِه بتحقُّقٍ كاملٍ: شهادةٌ من ${TLS_CERT_FILE}${
          process.env.STATE_TLS_CA_FILE === undefined
            ? ''
            : `، وجهةُ إصدارٍ من ${String(process.env.STATE_TLS_CA_FILE)}`
        }.`
      : '  حدودٌ مُعلَنةٌ: لا TLS في هذا التشغيلِ (تُعلَنُ مادّتُه في `STATE_TLS_CERT_FILE`).',
    '  وإثباتُ الحيازةِ لازمٌ لكلِّ نداءٍ (‏لا للفتحِ وحدَه)، ولا كتابةَ بحالٍ.',
    `  ومشهدُ الويبِ يقرأُ عبرَ وسيطٍ موقِّعٍ في الخادمِ (‏إغلاقُ \`LIVE-5\`): سلطتُهُ ${ACTOR_LABEL}،`,
    '  ومداهُ قراءةٌ فقط على المضيفِ المحلّيِّ وحدَهُ، ويُعلِنُ نفسَهُ في `x-state-pop-proxy`.',
    '  ومَن أتى برمزِهِ مُرِّرَ كما هو بلا توقيعٍ: لا ينتحِلُ الوسيطُ جلسةَ غيرِهِ.',
    '  ولا يُنشَرُ هذا على شبكةٍ عامّةٍ. (`docs/TRANSPORT.md`)',
    '',
  );
  process.stdout.write(`${lines.join('\n')}\n`);

  if (SELF_CHECK) {
    const verdict = await selfCheck({
      base: `http://127.0.0.1:${innerPort}`,
      proxyBase: `${USE_TLS ? 'https' : 'http'}://${HOST}:${PORT}`,
      token: session.token,
      sessionId: session.sessionId,
      routeSpec: gateway.routes().find((route) => route.id === SELF_CHECK_ROUTE) ?? null,
      popClient,
    });
    process.stdout.write(`${verdict.lines.join('\n')}\n`);
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    await new Promise((resolve) => inner.close(() => resolve(undefined)));
    await close();
    process.exit(verdict.ok ? 0 : 1);
  }

  /** @param {string} signal */
  const shutdown = (signal) => {
    process.stdout.write(`\nيُغلَقُ البابُ عندَ ${signal}…\n`);
    server.close(() => {
      inner.close(() => {
        void close().then(() => process.exit(0));
      });
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
