/**
 * وسيطٌ موقِّعٌ للتطويرِ — إغلاقُ الدَينِ `LIVE-5`.
 *
 * **الدَينُ الذي أُغلِقَ به:** مشهدُ الويبِ في `web/` كان **يُخدَمُ ولا يقرأُ**.
 * وسببُه بنيويٌّ لا عَطَبٌ: صفحةُ متصفِّحٍ لا تحملُ مفتاحاً خاصّاً، ولو حملَتْه
 * لكانَ المفتاحُ مكشوفاً لكلِّ من يقرأُ النصَّ؛ فكلُّ نداءٍ منها يُرَدُّ في تركيبٍ
 * يُلزِمُ إثباتَ الحيازةِ (`401` ‏`API_POP_REQUIRED`). **ولا يُغلَقُ هذا بـ
 * `requirePoP: false`** — ذاك إسقاطُ الحمايةِ لِتَعملَ الواجهةُ، وهو أسوأُ من
 * واجهةٍ لا تعملُ.
 *
 * **فالعلاجُ: المفتاحُ يبقى في الخادمِ، والتوقيعُ يقعُ فيه.** يُنادى الوسيطُ من
 * المتصفِّحِ بلا رمزٍ ولا توقيعٍ، فيُوقِّعُ هو بمفتاحِ المُشغِّلِ اللحظيِّ ويُمرِّرُ
 * النداءَ إلى طبقةِ النقلِ نفسِها.
 *
 * **وسلطتُه ومداه مُعلَنانِ لا مُخفيانِ** (‏وهذا شرطُ الإغلاقِ في سجلِّ الديونِ):
 *
 * 1. **السلطةُ:** سلطةُ الفاعلِ `service:state-viewer-dev` وحدَه — دورُ رقابةٍ
 *    مُعلَنٌ في `config/monitoring.yaml` بقدراتِ قراءةٍ فقط. والوسيطُ **لا يُوسِّعُ
 *    سلطةً**: قرارُ السماحِ والمنعِ يبقى لنقطةِ التفويضِ على `config/policies.yaml`.
 * 2. **المدى:** **قراءةٌ فقط** — كلُّ فعلٍ غيرِ `GET`/`HEAD` يُرَدُّ من الوسيطِ
 *    نفسِه بـ`405` ورمزٍ مُسمّىً، فلا تُوقَّعُ كتابةٌ بحالٍ (والكتابةُ أمرٌ ملكيٌّ
 *    موقَّعٌ `M9.03` بمفاتيحَ لا يَحملُها هذا النصُّ).
 * 3. **الرَّبطُ:** **المضيفُ المحلّيُّ وحدَه.** ووسيطٌ يُوقِّعُ لكلِّ من يُنادي،
 *    مربوطٌ بواجهةٍ عامّةٍ، **يصيرُ إسقاطاً للحيازةِ على الشبكةِ** — فيَفشلُ
 *    التركيبُ مُغلَقاً (‏`assertLoopbackHost`) ولا يَعملُ بمضيفٍ غيرِ محلّيٍّ.
 * 4. **ولا انتحالَ جلسةٍ:** إن حملَ النداءُ ترويسةَ `Authorization` فالوسيطُ
 *    **يُمرِّرُه كما هو بلا توقيعٍ** — فمن أتى برمزِه فهو يَزعُمُ حيازةَ مفتاحِه،
 *    وتوقيعُ الوسيطِ فوقَ رمزِ غيرِه انتحالٌ لا خدمةٌ.
 * 5. **ولا حُكمَ في الوسيطِ:** لا يقرأُ قاعدةً، ولا يُترجِمُ رفضاً، ولا يَبتُّ في
 *    وُسطاءَ غيرِ مقبولةٍ — يُمرِّرُها فيَرُدُّها النقلُ برمزِه المُعلَنِ. وهو
 *    **لا يَرفعُ زعمَ التعميةِ**: يُمرِّرُ `x-state-transport` كما وردَ من الداخلِ،
 *    فأسوأُ ما يقعُ **تقليلُ الزعمِ لا تعظيمُه**.
 * 6. **وهو خارجَ `src/` عن قصدٍ:** نصُّ تطويرٍ لا وحدةُ إنتاجٍ. وحاجزُ النقلِ
 *    (`scripts/guard-transport.mjs`، القاعدةُ `T12`) يَرفضُ أن يستوردَه ملفٌّ
 *    واحدٌ تحتَ `src/`.
 */

import { matchRoute, paramsFor } from '../src/transport/router.mjs';

/** الفاعلُ وسلطتُه ومداه — نصٌّ واحدٌ يُقرأُ في الترويسةِ والوثيقةِ والواجهةِ. */
export const PROXY_AUTHORITY = Object.freeze({
  actor: 'service:state-viewer-dev',
  scope: 'read-only',
  binding: 'loopback-only',
  signer: 'ephemeral-ed25519-in-memory',
});

/** اسمُ الترويسةِ التي يُعلِنُ بها الوسيطُ نفسَه في كلِّ ردٍّ يَمُرُّ به. */
export const PROXY_HEADER = 'x-state-pop-proxy';

/** رموزُ رفضِ الوسيطِ — مُسمّاةٌ لا مخمَّنةٌ. */
export const PROXY_REFUSALS = Object.freeze({
  READ_ONLY: 'DEV_PROXY_READ_ONLY',
  HOST_NOT_LOOPBACK: 'DEV_PROXY_HOST_NOT_LOOPBACK',
});

/** المضيفاتُ المحلّيّةُ وحدَها: ما سواها لا يُشغَّلُ فيه الوسيطُ. */
export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '::1', 'localhost']);

/** خطأٌ مُسمّىً من الوسيطِ — لا نصٌّ حرٌّ يُقرأُ بالتخمينِ. */
export class DevProxyError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'DevProxyError';
    this.code = code;
  }
}

/**
 * قيمةُ ترويسةِ الوسيطِ: سلطتُه ومداه، **وهل وُقِّعَ هذا النداءُ أم مُرِّرَ كما هو**.
 * @param {boolean} signed
 * @returns {string}
 */
export function proxyHeaderValue(signed) {
  return [
    'dev-runner',
    `authority=${PROXY_AUTHORITY.actor}`,
    `scope=${PROXY_AUTHORITY.scope}`,
    `binding=${PROXY_AUTHORITY.binding}`,
    `signer=${PROXY_AUTHORITY.signer}`,
    `signed=${signed ? 'yes' : 'no'}`,
  ].join('; ');
}

/**
 * **فشلٌ مُغلَقٌ عندَ التركيبِ:** لا وسيطَ موقِّعاً على مضيفٍ غيرِ محلّيٍّ.
 * @param {string} host
 * @returns {void}
 */
export function assertLoopbackHost(host) {
  if (!LOOPBACK_HOSTS.includes(host)) {
    throw new DevProxyError(
      PROXY_REFUSALS.HOST_NOT_LOOPBACK,
      `الوسيطُ الموقِّعُ لا يُربَطُ بـ«${host}»: وسيطٌ يُوقِّعُ لكلِّ مُنادٍ على الشبكةِ إسقاطٌ لإثباتِ الحيازةِ بصيغةٍ أخرى. والمقبولُ: ${LOOPBACK_HOSTS.join('، ')}.`,
    );
  }
}

/**
 * @typedef {object} RouteSpec
 * @property {string} id
 * @property {string} method
 * @property {string} path
 * @property {string} action
 * @property {string} resource
 */

/**
 * يُنشِئُ مُعالِجَ الوسيطِ الموقِّعِ.
 *
 * والتوقيعُ يُصاغُ بـ`popClient.signCall` على **الوُسطاءِ التي يقرأُها النقلُ
 * نفسُه** (`paramsFor`)، لا على نسخةٍ ثانيةٍ منها: هَضْمُ الوُسطاءِ داخلٌ في
 * الرسالةِ الموقَّعةِ، فنسخةٌ ثانيةٌ تختلفُ في ترتيبِ حقلٍ تُنتِجُ توقيعاً مردوداً.
 * @param {{ routes: import('../src/transport/router.mjs').CompiledRoute[] | ReadonlyArray<import('../src/transport/router.mjs').CompiledRoute>, specs: ReadonlyArray<RouteSpec>, popClient: { signCall: (request: { route: RouteSpec, sessionId: string, params?: Record<string, unknown> }) => { signature: string, timestamp: string, nonce: string }, headersFor: (proof: { signature: string, timestamp: string, nonce: string }) => Record<string, string> }, sessionId: string, token: string, origin: string, fetchImpl?: typeof globalThis.fetch }} deps
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void}
 */
export function createSigningProxyHandler(deps) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  /**
   * @param {import('node:http').ServerResponse} response
   * @param {number} status
   * @param {unknown} body
   * @param {boolean} signed
   */
  function sendJson(response, status, body, signed) {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(Buffer.byteLength(payload)),
      [PROXY_HEADER]: proxyHeaderValue(signed),
    });
    response.end(payload);
  }

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @returns {Promise<void>}
   */
  async function relay(request, response) {
    const rawUrl = request.url ?? '/';
    const method = (request.method ?? 'GET').toUpperCase();

    // مدىً مُعلَنٌ يُقاسُ لا يُوصَفُ: الوسيطُ لا يُوقِّعُ فعلاً كاتباً ولا يُمرِّرُه.
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(
        response,
        405,
        {
          code: PROXY_REFUSALS.READ_ONLY,
          message:
            'مدى الوسيطِ الموقِّعِ قراءةٌ فقط: الكتابةُ أمرٌ ملكيٌّ موقَّعٌ (`M9.03`) بمفاتيحَ لا يَحملُها مُشغِّلُ التطويرِ.',
        },
        false,
      );
      return;
    }

    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json' };
    const accept = request.headers['accept'];
    if (typeof accept === 'string') headers['accept'] = accept;

    // ولا انتحالَ: مَن أتى برمزِه مُرَّ كما هو، ومَن لا رمزَ له وُقِّعَ له.
    const claimed = request.headers['authorization'];
    let signed = false;
    if (typeof claimed === 'string' && claimed.trim() !== '') {
      headers['authorization'] = claimed;
    } else {
      const url = new URL(rawUrl, 'http://state.invalid');
      const matched = method === 'GET' ? matchRoute(deps.routes, 'GET', url.pathname) : null;
      if (matched !== null) {
        const spec = deps.specs.find((candidate) => candidate.id === matched.route.id) ?? null;
        if (spec !== null) {
          try {
            const params = paramsFor(matched.route, matched.pathParams, url.searchParams);
            const proof = deps.popClient.signCall({
              route: spec,
              sessionId: deps.sessionId,
              params: /** @type {Record<string, unknown>} */ (params),
            });
            headers['authorization'] = `Bearer ${deps.token}`;
            Object.assign(headers, deps.popClient.headersFor(proof));
            signed = true;
          } catch {
            // وُسطاءُ غيرُ مقبولةٍ لا يَبتُّ فيها الوسيطُ: تُمرَّرُ فيَرُدُّها النقلُ
            // برمزِه المُعلَنِ — فلا حُكمانِ على شيءٍ واحدٍ يفترقانِ.
            signed = false;
          }
        }
      }
    }

    const upstream = await fetchImpl(`${deps.origin}${rawUrl}`, { method, headers });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    /** @type {Record<string, string>} */
    const out = {};
    for (const [name, value] of upstream.headers) {
      // التعميةُ والطولُ يُحسَبانِ على هذا الرَّدِّ لا يُنقَلانِ من رَدٍّ آخرَ.
      if (
        name === 'content-encoding' ||
        name === 'transfer-encoding' ||
        name === 'content-length'
      ) {
        continue;
      }
      out[name] = value;
    }
    out['content-length'] = String(buffer.byteLength);
    out[PROXY_HEADER] = proxyHeaderValue(signed);
    response.writeHead(upstream.status, out);
    response.end(method === 'HEAD' ? undefined : buffer);
  }

  return (request, response) => {
    void relay(request, response).catch((error) => {
      // انقطاعُ الوصلةِ الداخليّةِ ليس رفضاً محكوماً: يُقالُ بما هو، ولا يُلبَسُ
      // لباسَ منعٍ فيَظنَّ القارئُ أنّه مُنِعَ وقد انقطعَ الطريقُ.
      if (!response.headersSent) {
        sendJson(
          response,
          502,
          {
            code: 'DEV_PROXY_UPSTREAM_UNREACHABLE',
            message: `لم تُبلَغِ الطبقةُ الداخليّةُ: ${error instanceof Error ? error.message : 'سببٌ مجهولٌ'}`,
          },
          false,
        );
      } else response.end();
    });
  };
}
