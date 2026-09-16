/**
 * بابُ الدولةِ — طبقةُ نقلٍ HTTP فوقَ `ApiGateway`. سدادُ الدَينِ `D-1`.
 *
 * الدَينُ مُعلَنٌ بنصِّ المشروعِ في `docs/REMAINING_WORK.md` عن `M9.03`: «والدَينُ
 * الباقي منها يُسمّى: لا طبقةَ نقلٍ (HTTP/TLS) ولا واجهةَ رسوميّة — مُسنَدٌ إلى
 * `M10`»، و`M10` أُغلِقتْ ٩/٩ بلا سدادٍ. فكانت الدولةُ كلَّها تعملُ داخلَ عمليّةِ
 * Node واحدةٍ **لا يبلغُها إنسانٌ ولا نظامٌ خارجيٌّ**.
 *
 * وحدودُ هذه الطبقةِ مُعلَنةٌ لأنّ طبقةَ نقلٍ تَزيدُ سلطةً أخطرُ من غيابِها:
 *
 * 1. **لا سلطةَ في النقلِ.** لا يُقرَّرُ إذنٌ هنا، ولا تُختصَرُ عقبةٌ من العقباتِ
 *    الخمسِ، ولا تُقرأُ قاعدةٌ مباشرةً. كلُّ نداءٍ يمرُّ بـ`gateway.call` كما هو،
 *    فتبقى العقباتُ الخمسُ (مسارٌ مُعلَنٌ، جلسةٌ، حدُّ معدَّلٍ يَعُدُّ المرفوضَ،
 *    نقطةُ التفويضِ المركزيّةُ وتذكرتُها، ثمَّ المشهدُ المقروءُ) في موضعِها.
 * 2. **جدولُ المساراتِ مُشتَقٌّ** من `config/api.yaml` (انظر `router.mjs`): ما لم
 *    تُعلِنْه الوثيقةُ يُرَدُّ `404`.
 * 3. **قارئةٌ للقراءةِ، كاتبةٌ بالأمرِ الملكيِّ.** لا `POST` على مسارِ قراءةٍ ولا
 *    `PUT` ولا `DELETE`، ولا جسمَ طلبٍ يُقرأُ للقراءةِ. وفتحُ الكتابةِ يلزمُه أمرٌ
 *    ملكيٌّ موقَّعٌ (`M9.03`) بمسارٍ مُشتَقٍّ من `config/royal-console.yaml`، والتوقيعُ
 *    لا يُنتِجُه متصفِّحٌ ولا خادمٌ — يقبلُ النقلُ الظرفَ المُوقَّعَ ويُمرِّرُه للديوانِ.
 * 4. **فتحُ الجلسةِ مسلكٌ مُعلَنٌ مُشتَقٌّ — `WL-194`، إغلاقُ `D-2`.** وكان قبلَها لا
 *    يُفتَحُ إلا داخلَ العمليةِ (`scripts/serve-state.mjs`)، **وأثرُه المقيسُ أنّ كلَّ مَن
 *    قرأَ من خارجٍ قرأَ بسلطةِ وسيطٍ يُوقِّعُ عنه لا بمفتاحِ نفسِه** — فلم يكنِ القيدُ
 *    ينسبُ النداءَ إلى فاعلِه. والمسلكُ الآنَ مُشتَقٌّ من `wire.sessionEndpoint` في
 *    `config/api.yaml` **لا مكتوبٌ هنا**، وهو مصادقةٌ تُصدِرُ رمزاً لا كتابةَ
 *    بياناتٍ، ولا يُفتَحُ إلا لهويةٍ سُجِّلَ مفتاحُها قبلَ الإقلاعِ. **ولا مسلكَ
 *    لرفعِ مفتاحٍ بحالٍ:** تسجيلٌ على السلكِ بلا مُصادِقٍ يُمكِّنُ كلَّ مَن بلغَ
 *    المنفَذَ من أن يُسجِّلَ نفسَه.
 * 5. **إنهاءُ TLS في وحدةٍ مُنفصلةٍ** (`tls.mjs`، سدادُ باقي `D-1`): مَن أعلنَ
 *    مادّةَ TLS نالَ خادماً مُعمّىً بـ`createSecureStateServer`، ومَن لم يُعلِنْها
 *    نالَ خادماً نصّيّاً **يُصرِّحُ في كلِّ ردٍّ** أنّه لا يُنشَرُ إلا خلفَ مُنهٍ.
 *    ولا رجوعَ صامتاً من الأوّلِ إلى الثاني: نقصُ المادّةِ يَرفعُ خطأً ولا يُنشِئُ
 *    خادماً نصّيّاً «مؤقّتاً».
 */

import http from 'node:http';
import fs from 'node:fs';

import { TRANSPORT_ERRORS, codeOf, problemFor } from './problem.mjs';
import {
  TransportError,
  compileCommandRoutes,
  compileRoutes,
  compileSessionRoute,
  matchRoute,
  paramsFor,
} from './router.mjs';
import { resolveStaticFile } from './static.mjs';
import { createTlsServer } from './tls.mjs';
import { WIRE_HEADERS } from './wire-headers.mjs';

/** حدُّ طولِ العنوانِ: عنوانٌ بلا حدٍّ بابُ استنزافٍ رخيصٍ. */
const MAX_URL_LENGTH = 2048;

/** حدُّ حجمِ جسمِ الأمرِ السياديِّ: أمرٌ موقَّعٌ لا ملفٌّ يُرفَع. */
const MAX_COMMAND_BODY = 16 * 1024;

/**
 * ترويساتٌ تُرَدُّ على كلِّ ردٍّ. وكلُّ واحدةٍ لسببٍ لا للعادةِ.
 * @type {Readonly<Record<string, string>>}
 */
const BASE_HEADERS = Object.freeze({
  // لا تخمينَ لنوعِ المحتوى: تخمينُه يُحوِّلُ نصّاً إلى شفرةٍ تُنفَّذُ.
  'x-content-type-options': 'nosniff',
  // لا تأطيرَ: نقرةٌ مُختطَفةٌ على مشهدِ الدولةِ.
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  // واجهةٌ بلا شفرةٍ خارجيّةٍ ولا `inline`: هذا ما يُمكِّنُ منعَ `unsafe-inline`.
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  // إعلانٌ صريحٌ لا سكوتٌ: هذا الردُّ خرجَ من قناةٍ غيرِ مُعمّاةٍ.
  'x-state-transport': 'plaintext; terminate-tls-upstream',
});

/**
 * ترويساتُ ردٍّ خرجَ من قناةٍ **مُعمّاةٍ أُنهِيَتْ في هذا الخادمِ**.
 *
 * و`Strict-Transport-Security` **لا تُرَدُّ إلا هنا**: رَدُّها على قناةٍ نصّيّةٍ
 * إمّا مُهمَلٌ من المتصفِّحِ أو مُضِرٌّ، وفي الحالَينِ هو **زعمُ تأمينٍ لم يقعْ**.
 * @type {Readonly<Record<string, string>>}
 */
const SECURE_HEADERS = Object.freeze({
  ...BASE_HEADERS,
  'x-state-transport': 'tls; terminated-here',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
});

/**
 * يَشتقُّ ترويساتَ الردِّ من **حقيقةِ المِقبسِ** لا من إعدادٍ يُوصَفُ.
 *
 * فالخادمُ لا يَزعُمُ تعميةً: إن كان المِقبسُ مُعمّىً قالها، وإلا صرَّحَ بأنّه نصٌّ.
 * @param {http.IncomingMessage} request
 * @returns {Readonly<Record<string, string>>}
 */
function headersFor(request) {
  const socket = /** @type {{ encrypted?: boolean }} */ (/** @type {unknown} */ (request.socket));
  return socket.encrypted === true ? SECURE_HEADERS : BASE_HEADERS;
}

/**
 * يقرأُ رمزَ الجلسةِ من ترويسةِ `Authorization`.
 * الصيغةُ `Bearer <token>` وحدَها، و**لا يُقرأُ رمزٌ من مُلحقِ استعلامٍ** لأنّ
 * المُلحقاتَ تُكتَبُ في سجلّاتِ الوسائطِ وتاريخِ المتصفِّحِ فيُسرَّبُ الرمزُ.
 * @param {http.IncomingMessage} request
 * @returns {string | undefined}
 */
function tokenOf(request) {
  const header = request.headers[WIRE_HEADERS.authorization];
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer[ ]+(\S+)$/.exec(header.trim());
  return match === null ? undefined : match[1];
}

/**
 * يقرأُ إثباتَ الحيازةِ من ترويساتٍ مُعلَنةٍ — **نقلاً لا تحقُّقاً**.
 *
 * التركيبُ الرسميُّ في `src/persistence/composition.mjs` يُركِّبُ البوابةَ بـ
 * `requirePoP: true`، ونصُّه: «لا تُفتَحُ جلسةٌ ولا يُحَلُّ طلبٌ بمعرّفٍ عامٍّ
 * وحدَه». فطبقةُ نقلٍ لا تحملُ هذه الحقولَ **لا تستطيعُ مُخاطبةَ التركيبِ الرسميِّ
 * أصلاً** — تُرَدُّ كلُّ قراءةٍ بـ`API_IDENTITY_UNVERIFIED`. وهذا ليس عيباً في
 * البوابةِ بل شرطٌ أعلنتْه، فتُحمَلُ حقولُه كما هي.
 *
 * و**لا تحقُّقَ هنا بحالٍ:** التوقيعُ يُتحَقَّقُ في `SessionStore#verifyPoP` وحدَه.
 * لو زعمَ النقلُ تحقُّقاً لصارَ فيه سلطةٌ، ولو أغفلَ الحملَ لصارَ الشرطُ مُسقَطاً
 * بلا قرارٍ. فالثالثُ: يُحمَلُ ويُحكَمُ فوقَ.
 *
 * وتُحمَلُ الحقولُ الثلاثةُ **مجتمعةً أو لا تُحمَلُ**: إثباتٌ ناقصٌ يُمرَّرُ
 * يُنتِجُ رفضاً بسببٍ مُشوَّشٍ، والأوضحُ أن يُرَدَّ بغيابِ الإثباتِ كلِّه.
 * @param {http.IncomingMessage} request
 * @returns {{ signature: string, timestamp: string, nonce: string } | undefined}
 */
function proofOfPossessionOf(request) {
  const signature = request.headers[WIRE_HEADERS.popSignature];
  const timestamp = request.headers[WIRE_HEADERS.popTimestamp];
  const nonce = request.headers[WIRE_HEADERS.popNonce];
  if (typeof signature !== 'string' || typeof timestamp !== 'string' || typeof nonce !== 'string') {
    return undefined;
  }
  return { signature, timestamp, nonce };
}

/**
 * @typedef {object} GatewayLike
 * @property {(request: { route: string, token?: string, params?: Record<string, unknown>, pop?: { signature: string, timestamp: string, nonce: string } }) => Promise<{ route: string, status: string, data: unknown }>} call
 * @property {((request: { actorId: string, pop?: { signature: string, timestamp: string, nonce: string } }) => Promise<{ token: string, sessionId: string, expiresAt: string }>) | undefined} [openSession] فتحُ الجلسةِ — وغيابُه يُردُّ `TRANSPORT_SESSION_UNSERVED` لا يُتجاوَزُ.
 */

/**
 * @typedef {object} ConsoleLike
 * @property {(request: { command: string, royalCommand: Record<string, unknown>, signature: string, sovereignSession?: string }) => Promise<{ command: string, action: string, kind: string, path: string, commandId: string, acceptedAt: string, status: 'executed', effect: Record<string, unknown> }>} issue
 */

/**
 * @typedef {object} StateServerOptions
 * @property {GatewayLike} gateway
 * @property {ConsoleLike | null} [console] الديوانُ الملكيُّ — إن وُصل فُتحَ مسارُ الكتابةِ السياديّةِ المُوقَّعةِ.
 * @property {string | null} [webDir] جذرُ ملفّاتِ الواجهةِ، أو `null` فلا واجهةَ.
 * @property {ReturnType<typeof compileRoutes>} [routes]
 * @property {ReturnType<typeof compileCommandRoutes>} [commandRoutes]
 * @property {ReturnType<typeof compileSessionRoute>} [sessionRoute] مسلكُ فتحِ الجلسةِ المُشتَقُّ.
 * @property {string} [certFile]
 * @property {string} [keyFile]
 * @property {string} [caFile]
 * @property {boolean} [requestClientCertificate]
 * @property {NodeJS.ProcessEnv} [env]
 */

/**
 * يُنشِئُ خادمَ الدولةِ.
 *
 * **فشلٌ مُغلَقٌ عندَ التركيبِ:** بلا بوابةٍ لا خادمَ. وخادمٌ يُنشَأُ ثمَّ يَرُدُّ
 * `503` على كلِّ نداءٍ يُوهِمُ بأنّ الدولةَ قائمةٌ وهي ليست مُركَّبةً.
 * @param {StateServerOptions} options
 * @returns {http.Server}
 */
export function createStateServer(options) {
  const gateway = options?.gateway;
  if (gateway === null || gateway === undefined || typeof gateway.call !== 'function') {
    throw new TransportError(
      TRANSPORT_ERRORS.GATEWAY_REQUIRED,
      'لا خادمَ بلا بوابةٍ: النقلُ يَنقُلُ ولا يَحكُمُ، فبلا مَن يَحكُمُ لا نقلَ.',
    );
  }
  const routes = options.routes ?? compileRoutes();
  const commandRoutes = options.commandRoutes ?? compileCommandRoutes();
  const sessionRoute = options.sessionRoute ?? compileSessionRoute();
  const webDir = options.webDir ?? null;
  const console_ = options.console ?? null;

  return http.createServer(
    handlerFor({ gateway, routes, commandRoutes, sessionRoute, console: console_, webDir }),
  );
}

/**
 * يُنشِئُ **مُعالِجَ الطلبِ** وحدَه، مُنفصلاً عن نوعِ الخادمِ.
 *
 * وفَصلُه ليس تجميلاً: خادمُ النصِّ وخادمُ TLS **يتشاركانِ المُعالِجَ نفسَه**، فلا
 * تنشأُ نسخةٌ ثانيةٌ من الحُكمِ تفترقُ عن الأولى فيَمُرُّ على إحداهما ما رُدَّ على
 * الأخرى.
 * @param {{ gateway: GatewayLike, routes: ReturnType<typeof compileRoutes>, commandRoutes: ReturnType<typeof compileCommandRoutes>, sessionRoute: ReturnType<typeof compileSessionRoute>, console: ConsoleLike | null, webDir: string | null }} deps
 * @returns {(request: http.IncomingMessage, response: http.ServerResponse) => void}
 */
function handlerFor(deps) {
  return (request, response) => {
    void handle(request, response, deps);
  };
}

/**
 * يُنشِئُ خادمَ الدولةِ **مُنهياً لـTLS في موضعِه** — سدادُ باقي `D-1`.
 *
 * والمادّةُ تُقرأُ من مساراتٍ مُعلَنةٍ في البيئةِ (`STATE_TLS_CERT_FILE`،
 * `STATE_TLS_KEY_FILE`، و`STATE_TLS_CA_FILE` اختياريّةً)، **ولا رجوعَ إلى نصٍّ
 * صريحٍ إن نقصتْ**: يُرفَعُ `TransportTlsError` ولا يُنشَأُ خادمٌ. ومَن يُخفي هذا
 * الخطأَ ويُشغِّلُ النصَّ الصريحَ يُعطي المُنادي **إيهامَ قناةٍ مُعمّاةٍ**.
 * @param {StateServerOptions} options
 * @returns {import('node:https').Server}
 */
export function createSecureStateServer(options) {
  const gateway = options?.gateway;
  if (gateway === null || gateway === undefined || typeof gateway.call !== 'function') {
    throw new TransportError(
      TRANSPORT_ERRORS.GATEWAY_REQUIRED,
      'لا خادمَ بلا بوابةٍ: النقلُ يَنقُلُ ولا يَحكُمُ، فبلا مَن يَحكُمُ لا نقلَ.',
    );
  }
  const routes = options.routes ?? compileRoutes();
  const commandRoutes = options.commandRoutes ?? compileCommandRoutes();
  const sessionRoute = options.sessionRoute ?? compileSessionRoute();
  const webDir = options.webDir ?? null;
  const console_ = options.console ?? null;
  return createTlsServer({
    handler: handlerFor({
      gateway,
      routes,
      commandRoutes,
      sessionRoute,
      console: console_,
      webDir,
    }),
    ...(options.certFile === undefined ? {} : { certFile: options.certFile }),
    ...(options.keyFile === undefined ? {} : { keyFile: options.keyFile }),
    ...(options.caFile === undefined ? {} : { caFile: options.caFile }),
    ...(options.requestClientCertificate === undefined
      ? {}
      : { requestClientCertificate: options.requestClientCertificate }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
}

/**
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(request, response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...headersFor(request),
    'content-type': 'application/json; charset=utf-8',
    // بياناتُ الدولةِ لا تُخزَّنُ في وسيطٍ ولا في متصفِّحٍ: قراءةٌ محكومةٌ تُخزَّنُ
    // تصيرُ قراءةً بلا جلسةٍ بعدَ انتهاءِ الجلسةِ.
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(payload)),
  });
  response.end(payload);
}

/**
 * يقرأُ جسمَ طلبٍ بحدٍّ مُعلَنٍ — للمسارِ السياديِّ وحدَه.
 * @param {http.IncomingMessage} request
 * @returns {Promise<string>}
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    request.on('data', (/** @type {Buffer} */ chunk) => {
      total += chunk.length;
      if (total > MAX_COMMAND_BODY) {
        reject(
          new TransportError(
            TRANSPORT_ERRORS.BODY_NOT_ALLOWED,
            `جسمُ الأمرِ تجاوزَ الحدَّ المُعلَنَ (${MAX_COMMAND_BODY} بايت).`,
          ),
        );
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @param {{ gateway: GatewayLike, routes: ReturnType<typeof compileRoutes>, commandRoutes: ReturnType<typeof compileCommandRoutes>, sessionRoute: ReturnType<typeof compileSessionRoute>, console: ConsoleLike | null, webDir: string | null }} deps
 */
async function handle(request, response, deps) {
  try {
    const rawUrl = request.url ?? '/';
    if (rawUrl.length > MAX_URL_LENGTH) {
      const { status, body } = problemFor(TRANSPORT_ERRORS.URI_TOO_LONG);
      sendJson(request, response, status, body);
      return;
    }
    const url = new URL(rawUrl, 'http://state.invalid');
    const method = (request.method ?? 'GET').toUpperCase();

    // قراءةٌ (`GET`) تَرفضُ الجسمَ: لا حاجةَ له، وقراءتُه سطحٌ لا تُعلِنُه الطبقةُ.
    if (method === 'GET') {
      const declaredLength = Number.parseInt(String(request.headers['content-length'] ?? '0'), 10);
      if (Number.isFinite(declaredLength) && declaredLength > 0) {
        const { status, body } = problemFor(TRANSPORT_ERRORS.BODY_NOT_ALLOWED);
        sendJson(request, response, status, body);
        return;
      }
    }

    // جدولُ القراءةِ وجدولُ الكتابةِ مُدمَجانِ: المطابقةُ تَفحَصُ المسارَ والفعلَ معاً،
    // فلا يَعبرُ `POST` مساراً قارئاً ولا `GET` مساراً كاتباً.
    // ومسلكُ فتحِ الجلسةِ يدخلُ الجدولَ المدموجَ لا جدولاً ثالثاً يُفتَشُ قبلَهما:
    // جدولٌ موازٍ يسبقُ المطابقةَ يجعلُ مسلكاً يُخفي مساراً مُعلَناً بلا ردَّ.
    const allRoutes = [...deps.routes, ...deps.commandRoutes, deps.sessionRoute];
    const matched = matchRoute(allRoutes, method, url.pathname);
    if (matched !== null) {
      if (matched.route.id === deps.sessionRoute.id) {
        await handleSessionOpen(request, response, deps);
        return;
      }
      if (method === 'POST') {
        await handleCommand(request, response, deps, matched.route);
        return;
      }
      const params = paramsFor(matched.route, matched.pathParams, url.searchParams);
      const pop = proofOfPossessionOf(request);
      const token = tokenOf(request);
      const result = await deps.gateway.call({
        route: matched.route.id,
        params,
        ...(token === undefined ? {} : { token }),
        ...(pop === undefined ? {} : { pop }),
      });
      sendJson(request, response, 200, {
        route: result.route,
        status: result.status,
        data: result.data,
      });
      return;
    }

    if (deps.webDir !== null && (method === 'GET' || method === 'HEAD')) {
      const file = resolveStaticFile(deps.webDir, url.pathname);
      if (file !== null) {
        const content = fs.readFileSync(file.file);
        response.writeHead(200, {
          ...headersFor(request),
          'content-type': file.type,
          'cache-control': 'no-cache',
          'content-length': String(content.byteLength),
        });
        response.end(method === 'HEAD' ? undefined : content);
        return;
      }
    }

    const { status, body } = problemFor(TRANSPORT_ERRORS.ROUTE_UNKNOWN);
    sendJson(request, response, status, body);
  } catch (error) {
    // كلُّ رفضٍ مُسمّىً يُترجَمُ بخريطةٍ مُعلَنةٍ، وما لا اسمَ له يُرَدُّ `500`
    // **بلا نصِّ استثناءٍ على السلكِ**: القيدُ الكاملُ في سجلِّ الأحداثِ.
    const { status, body } = problemFor(codeOf(error));
    if (!response.headersSent) sendJson(request, response, status, body);
    else response.end();
  }
}

/**
 * **فتحُ الجلسةِ على السلكِ** — `WL-194`، إغلاقُ `D-2`.
 *
 * والنقلُ هنا **بلا سلطةٍ** كما في كلِّ مسلكٍ: يقرأُ الهويةَ والإثباتَ من جسمٍ
 * محدودِ الحجمِ ويُمرِّرُهما إلى `gateway.openSession`. **ولا يُخترعُ هنا مفتاحٌ ولا
 * تُفحَصُ هويةٌ:** مَن لم يُسجَّلْ مفتاحُه قبلَ الإقلاعِ ترفضُه البوابةُ برمزِها المُعلَنِ،
 * والنقلُ لا يُلَطِّفُ الرفضَ ولا يُبهِمُه.
 *
 * **وبوابةٌ لا تُصدِرُ جلساتٍ تُردُّ برمزٍ مُسمّىً** لا بـ`500` ولا بتجاوزٍ صامتٍ.
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @param {{ gateway: GatewayLike }} deps
 */
async function handleSessionOpen(request, response, deps) {
  // **يُفحَصُ الوجودُ ويُنادى على المالكِ:** استخراجُ التابعِ ثمّ نداؤُه مُفرَداً
  // يفقدُ `this` فيسقطُ في عَطَبٍ داخليٍّ بدلَ رفضٍ مُسمّىً — فحصٌ هنا ونداءٌ هناك.
  if (typeof deps.gateway.openSession !== 'function') {
    const { status, body } = problemFor(TRANSPORT_ERRORS.SESSION_UNSERVED);
    sendJson(request, response, status, body);
    return;
  }
  const raw = await readBody(request);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const { status, body } = problemFor(TRANSPORT_ERRORS.BODY_NOT_ALLOWED);
    sendJson(request, response, status, body);
    return;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const { status, body } = problemFor(TRANSPORT_ERRORS.BODY_NOT_ALLOWED);
    sendJson(request, response, status, body);
    return;
  }
  const envelope = /** @type {Record<string, unknown>} */ (parsed);
  const actorId = envelope['actorId'];
  if (typeof actorId !== 'string' || actorId.length === 0) {
    const { status, body } = problemFor(TRANSPORT_ERRORS.BODY_NOT_ALLOWED);
    sendJson(request, response, status, body);
    return;
  }
  // الإثباتُ يُقرأُ من الجسمِ لا من الترويساتِ: حمولةُ الفتحِ لا مسارَ لها ولا
  // رمزَ جلسةٍ، وخلطُ حمولتَينِ في ترويساتٍ واحدةٍ يُتيحُ تقديمَ توقيعِ أحدِهما مكانَ الآخرِ.
  const popRaw = envelope['pop'];
  /** @type {{ signature: string, timestamp: string, nonce: string } | undefined} */
  let pop;
  if (popRaw !== null && typeof popRaw === 'object' && !Array.isArray(popRaw)) {
    const fields = /** @type {Record<string, unknown>} */ (popRaw);
    const signature = fields['signature'];
    const timestamp = fields['timestamp'];
    const nonce = fields['nonce'];
    if (
      typeof signature === 'string' &&
      typeof timestamp === 'string' &&
      typeof nonce === 'string'
    ) {
      pop = { signature, timestamp, nonce };
    }
  }
  const opened = await deps.gateway.openSession({
    actorId,
    ...(pop === undefined ? {} : { pop }),
  });
  sendJson(request, response, 200, {
    token: opened.token,
    sessionId: opened.sessionId,
    expiresAt: opened.expiresAt,
  });
}

/**
 * مسارُ الكتابةِ السياديّةِ المُوقَّعةِ: يقرأُ الظرفَ المُوقَّعَ ويُمرِّرُه للديوانِ.
 *
 * والنقلُ هنا **بلا سلطةٍ**: لا يُوقِّعُ ولا يُتحقَّقُ ولا يُنفِّذُ. كلُّ ما يفعلُه أن
 * يقرأَ الجسمَ ويُمرِّرَه إلى `console.issue` — فالتحقُّقُ والتوقيعُ والقيدُ قبلَ الأثرِ
 * كلُّها في الديوانِ، لا هنا.
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @param {{ console: ConsoleLike | null }} deps
 * @param {import('./router.mjs').CompiledRoute} route
 */
async function handleCommand(request, response, deps, route) {
  const console_ = deps.console;
  if (console_ === null || typeof console_.issue !== 'function') {
    const { status, body } = problemFor('CONSOLE_GATEWAY_REQUIRED');
    sendJson(request, response, status, body);
    return;
  }
  const raw = await readBody(request);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const { status, body } = problemFor(TRANSPORT_ERRORS.BODY_NOT_ALLOWED);
    sendJson(request, response, status, body);
    return;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const { status, body } = problemFor(TRANSPORT_ERRORS.BODY_NOT_ALLOWED);
    sendJson(request, response, status, body);
    return;
  }
  const envelope = /** @type {Record<string, unknown>} */ (parsed);
  const royalCommand = envelope['royalCommand'];
  const signature = envelope['signature'];
  const sovereignSession = envelope['sovereignSession'];
  if (
    royalCommand === null ||
    typeof royalCommand !== 'object' ||
    Array.isArray(royalCommand) ||
    typeof signature !== 'string'
  ) {
    const { status, body } = problemFor(TRANSPORT_ERRORS.BODY_NOT_ALLOWED);
    sendJson(request, response, status, body);
    return;
  }
  const result = await console_.issue({
    command: route.id,
    royalCommand: /** @type {Record<string, unknown>} */ (royalCommand),
    signature,
    ...(typeof sovereignSession === 'string' ? { sovereignSession } : {}),
  });
  sendJson(request, response, 200, result);
}
