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
 * 3. **قارئةٌ فقط.** لا `POST` ولا `PUT` ولا `DELETE`، ولا جسمَ طلبٍ يُقرأُ. فتحُ
 *    الكتابةِ يلزمُه أمرٌ ملكيٌّ موقَّعٌ (`M9.03`)، والتوقيعُ لا يُنتِجُه متصفِّحٌ.
 * 4. **فتحُ الجلسةِ ليس مساراً على السلكِ.** لأنّ `config/api.yaml` لا تُعلِنُه
 *    مساراً، وإعلانُه هنا اختراعُ سطحٍ لم يأذنْ به المالكُ. فالرمزُ يُصدَرُ خارجَ
 *    السلكِ (`scripts/session-open.mjs`) ويُقدَّمُ في ترويسةِ `Authorization`.
 * 5. **لا TLS في هذه الوحدةِ.** إنهاءُ TLS عهدٌ ثانٍ منفصلٌ، وزعمُه هنا بشهادةٍ
 *    مُوقَّعةٍ ذاتيّاً يُنتِجُ **إيهامَ تأمينٍ**. فالوحدةُ تُنشِئُ خادماً غيرَ
 *    مُشفَّرٍ، وتُعلِنُ أنّه لا يُنشَرُ إلا خلفَ مُنهٍ لـTLS، ويَرُدُّ الخادمُ
 *    بترويسةٍ صريحةٍ تقولُ ذلك بدلَ أن يَسكُتَ عنه.
 */

import http from 'node:http';
import fs from 'node:fs';

import { TRANSPORT_ERRORS, codeOf, problemFor } from './problem.mjs';
import { TransportError, compileRoutes, matchRoute, paramsFor } from './router.mjs';
import { resolveStaticFile } from './static.mjs';

/** حدُّ طولِ العنوانِ: عنوانٌ بلا حدٍّ بابُ استنزافٍ رخيصٍ. */
const MAX_URL_LENGTH = 2048;

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
  // إعلانٌ صريحٌ لا سكوتٌ: هذه الطبقةُ لا تُنهي TLS.
  'x-state-transport': 'plaintext; terminate-tls-upstream',
});

/**
 * يقرأُ رمزَ الجلسةِ من ترويسةِ `Authorization`.
 * الصيغةُ `Bearer <token>` وحدَها، و**لا يُقرأُ رمزٌ من مُلحقِ استعلامٍ** لأنّ
 * المُلحقاتَ تُكتَبُ في سجلّاتِ الوسائطِ وتاريخِ المتصفِّحِ فيُسرَّبُ الرمزُ.
 * @param {http.IncomingMessage} request
 * @returns {string | undefined}
 */
function tokenOf(request) {
  const header = request.headers['authorization'];
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
  const signature = request.headers['x-state-pop-signature'];
  const timestamp = request.headers['x-state-pop-timestamp'];
  const nonce = request.headers['x-state-pop-nonce'];
  if (typeof signature !== 'string' || typeof timestamp !== 'string' || typeof nonce !== 'string') {
    return undefined;
  }
  return { signature, timestamp, nonce };
}

/**
 * @typedef {object} GatewayLike
 * @property {(request: { route: string, token?: string, params?: Record<string, unknown>, pop?: { signature: string, timestamp: string, nonce: string } }) => Promise<{ route: string, status: string, data: unknown }>} call
 */

/**
 * يُنشِئُ خادمَ الدولةِ.
 *
 * **فشلٌ مُغلَقٌ عندَ التركيبِ:** بلا بوابةٍ لا خادمَ. وخادمٌ يُنشَأُ ثمَّ يَرُدُّ
 * `503` على كلِّ نداءٍ يُوهِمُ بأنّ الدولةَ قائمةٌ وهي ليست مُركَّبةً.
 * @param {object} options
 * @param {GatewayLike} options.gateway
 * @param {string | null} [options.webDir] جذرُ ملفّاتِ الواجهةِ، أو `null` فلا واجهةَ.
 * @param {ReturnType<typeof compileRoutes>} [options.routes]
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
  const webDir = options.webDir ?? null;

  return http.createServer((request, response) => {
    void handle(request, response, { gateway, routes, webDir });
  });
}

/**
 * @param {http.ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    // بياناتُ الدولةِ لا تُخزَّنُ في وسيطٍ ولا في متصفِّحٍ: قراءةٌ محكومةٌ تُخزَّنُ
    // تصيرُ قراءةً بلا جلسةٍ بعدَ انتهاءِ الجلسةِ.
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(payload)),
  });
  response.end(payload);
}

/**
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @param {{ gateway: GatewayLike, routes: ReturnType<typeof compileRoutes>, webDir: string | null }} deps
 */
async function handle(request, response, deps) {
  try {
    const rawUrl = request.url ?? '/';
    if (rawUrl.length > MAX_URL_LENGTH) {
      const { status, body } = problemFor(TRANSPORT_ERRORS.URI_TOO_LONG);
      sendJson(response, status, body);
      return;
    }
    // جسمُ طلبٍ في قراءةٍ يُرَدُّ لا يُهمَلُ: تجاهلُه يجعلُ المُنادي يظنُّ أنّه
    // أرسلَ شيئاً ذا أثرٍ، وقراءتُه تفتحُ سطحاً لا تُعلِنُه هذه الطبقةُ.
    const declaredLength = Number.parseInt(String(request.headers['content-length'] ?? '0'), 10);
    if (Number.isFinite(declaredLength) && declaredLength > 0) {
      const { status, body } = problemFor(TRANSPORT_ERRORS.BODY_NOT_ALLOWED);
      sendJson(response, status, body);
      return;
    }
    const url = new URL(rawUrl, 'http://state.invalid');
    const method = (request.method ?? 'GET').toUpperCase();

    const matched = matchRoute(deps.routes, method, url.pathname);
    if (matched !== null) {
      const params = paramsFor(matched.route, matched.pathParams, url.searchParams);
      const pop = proofOfPossessionOf(request);
      const token = tokenOf(request);
      const result = await deps.gateway.call({
        route: matched.route.id,
        params,
        ...(token === undefined ? {} : { token }),
        ...(pop === undefined ? {} : { pop }),
      });
      sendJson(response, 200, { route: result.route, status: result.status, data: result.data });
      return;
    }

    if (deps.webDir !== null && (method === 'GET' || method === 'HEAD')) {
      const file = resolveStaticFile(deps.webDir, url.pathname);
      if (file !== null) {
        const content = fs.readFileSync(file.file);
        response.writeHead(200, {
          ...BASE_HEADERS,
          'content-type': file.type,
          'cache-control': 'no-cache',
          'content-length': String(content.byteLength),
        });
        response.end(method === 'HEAD' ? undefined : content);
        return;
      }
    }

    const { status, body } = problemFor(TRANSPORT_ERRORS.ROUTE_UNKNOWN);
    sendJson(response, status, body);
  } catch (error) {
    // كلُّ رفضٍ مُسمّىً يُترجَمُ بخريطةٍ مُعلَنةٍ، وما لا اسمَ له يُرَدُّ `500`
    // **بلا نصِّ استثناءٍ على السلكِ**: القيدُ الكاملُ في سجلِّ الأحداثِ.
    const { status, body } = problemFor(codeOf(error));
    if (!response.headersSent) sendJson(response, status, body);
    else response.end();
  }
}
