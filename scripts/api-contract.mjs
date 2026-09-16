#!/usr/bin/env node
/**
 * **مولِّدُ العقدِ المنشورِ لطبقةِ الواجهةِ** — `WL-194`، إغلاقُ الدَينِ `D-2`.
 *
 * **الدَينُ الذي يُسدَّدُ:** كانت الطبقةُ مُعلَنةً كاملةً في `config/api.yaml`
 * **ولا مستهلِكَ قراءةٍ خارجَ العقدِ الداخليِّ يُقاسُ بنداءٍ**. وأحدُ أسبابِه أنّ
 * ما يلزمُ العميلَ (المسالكُ، الترويساتُ، صياغةُ التوقيعِ، رموزُ الرفضِ وحالاتُها)
 * كان **مبثوثاً في مصادرَ لا يقرأُها إلا مَن يقرأُ الشفرةَ**. فمن أرادَ أن يُنادي
 * نسخَ ما فهِمَه، ونسخةٌ تفترقُ عن الأصلِ عندَ أوّلِ تعديلٍ.
 *
 * **وهذا الملفُّ لا يكتبُ عقداً؛ يُخرِجُه:** كلُّ حقلٍ **مُشتَقٌّ** من
 * `config/api.yaml` أو من خريطةِ الحالاتِ في `src/transport/problem.mjs` أو من
 * أسماءِ الترويساتِ في `src/transport/wire-headers.mjs` أو من صياغةِ التوقيعِ في
 * `src/api/pop-canonical.mjs`. **ولا سطرَ فيه يُعلِنُ مساراً أو ترويسةً من عندِه** —
 * فعقدٌ مكتوبٌ يداً يَعِدُ بما لا يُخدَمُ، وذاك أسوأُ من غيابِ عقدٍ.
 *
 * **والانزياحُ يُقاسُ لا يُرجى:** `scripts/guard-api-contract.mjs` يُعيدُ التوليدَ
 * ويُقارِنُ بايتاً ببايتٍ بالمُقيَّدِ في المستودعِ، كما يفعلُ حاجزُ تقريرِ الجاهزيّةِ.
 *
 * الاستعمالُ:
 *   node scripts/api-contract.mjs            # يكتبُ الملفَّ المُعلَنَ في الوثيقةِ
 *   node scripts/api-contract.mjs --stdout   # يطبعُه ولا يكتبُ
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  canonicalCallPayload,
  canonicalOpenPayload,
  popMessage,
} from '../src/api/pop-canonical.mjs';
import { TRANSPORT_ERRORS, WIRE_HEADERS, problemFor } from '../src/transport/index.mjs';
import { POP_KEY_TYPE, loadApiPolicy } from '../src/api/index.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');

/**
 * يبني العقدَ من الحقيقةِ الراهنةِ. **ولا قيمةَ فيه مكتوبةٌ يداً إلا نصوصُ
 * الشرحِ**، وهي تصفُ ولا تُعلِنُ سطحاً.
 * @param {{ dir?: string }} [options]
 * @returns {Record<string, unknown>}
 */
export function buildApiContract(options = {}) {
  const policy = loadApiPolicy(options.dir === undefined ? {} : { dir: options.dir });
  // رموزُ الرفضِ: ما تُعلِنُه الوثيقةُ **ورموزُ النقلِ نفسِه** — فالمُنادي يلقاهما
  // كلَيهما على السلكِ، وعقدٌ يُعلِنُ أحدَهما يُفاجئُ قارئَه بالآخرِ.
  const codes = [...new Set([...policy.refusalCodes, ...Object.values(TRANSPORT_ERRORS)])].sort();
  const refusals = codes.map((code) => {
    const { status, body } = problemFor(code);
    const detail = /** @type {Record<string, unknown>} */ (body);
    return {
      code,
      status,
      message: typeof detail['message'] === 'string' ? detail['message'] : '',
    };
  });
  // وصياغةُ التوقيعِ **تُعرَضُ بمثالٍ مُولَّدٍ من نفسِ الدالَّةِ** لا بشرحٍ نصّيٍّ:
  // شرحٌ منسوخٌ يفترقُ عن الدالَّةِ، ومثالٌ مُولَّدٌ لا يفترقُ.
  const exampleRoute = policy.routes[0];
  return {
    contract: 'state-api',
    version: policy.version,
    statement: policy.wire.statement,
    generatedBy: policy.wire.contract.generatedBy,
    guard: 'scripts/guard-api-contract.mjs',
    door: {
      portEnv: policy.wire.doorPortEnv,
      note: 'المنفَذُ عابرٌ ما لم يُعلَنْ في هذا المتغيِّرِ؛ والمضيفُ محلّيٌّ في تشغيلِ التطويرِ.',
    },
    session: {
      id: policy.wire.sessionEndpoint.id,
      method: policy.wire.sessionEndpoint.method,
      path: policy.wire.sessionEndpoint.path,
      purpose: policy.wire.sessionEndpoint.purpose,
      requestBody: {
        actorId: 'string',
        pop: { signature: 'base64', timestamp: 'ISO-8601', nonce: 'string' },
      },
      responseBody: { token: 'string', sessionId: 'string', expiresAt: 'ISO-8601' },
      ttlSeconds: policy.session.ttlSeconds,
      note: 'مصادقةٌ تُصدِرُ رمزاً لا كتابةَ بياناتٍ. ولا مسلكَ لرفعِ مفتاحٍ: التسجيلُ فعلُ مُشغِّلٍ قبلَ الإقلاعِ.',
    },
    headers: {
      token: WIRE_HEADERS.authorization,
      tokenScheme: 'Bearer',
      popSignature: WIRE_HEADERS.popSignature,
      popTimestamp: WIRE_HEADERS.popTimestamp,
      popNonce: WIRE_HEADERS.popNonce,
      note: 'ترويساتُ الإثباتِ ثلاثٌ مجتمعةً؛ وناقصُها يُقرأُ غيابَ إثباتٍ.',
    },
    signing: {
      module: 'src/api/pop-canonical.mjs',
      algorithm: POP_KEY_TYPE,
      keyFormat: 'SPKI PEM',
      digest: policy.session.digest,
      openPayloadExample: canonicalOpenPayload('agent:00000000-0000-0000-0000-000000000000'),
      callPayloadExample:
        exampleRoute === undefined
          ? null
          : canonicalCallPayload(
              {
                method: exampleRoute.method,
                path: exampleRoute.path,
                action: exampleRoute.action,
                resource: exampleRoute.resource,
              },
              'session-id',
              {},
            ),
      messageExample: popMessage('<payload>', '<timestamp>', '<nonce>'),
      note: 'الرسالةُ: حمولةٌ ثمّ طابعٌ زمنيٌّ ثمّ مُعرِّفٌ لا يُقبَلُ مرّتَينِ، مفصولةٌ بـ«|».',
    },
    routes: policy.routes.map((route) => ({
      id: route.id,
      method: route.method,
      path: route.path,
      action: route.action,
      resource: route.resource,
      purpose: route.purpose,
      rateLimit: route.rateLimit ?? policy.rateLimit,
    })),
    refusals,
    guarantees: policy.guarantees.map((entry) => ({
      id: entry.id,
      statement: entry.statement,
      enforcedBy: entry.enforcedBy,
      codes: [...entry.codes],
    })),
  };
}

/**
 * نصُّ الملفِّ كما يُقيَّدُ: JSON بإزاحةِ مسافتَينِ وسطرٍ أخيرٍ — صيغةٌ واحدةٌ كي
 * تكونَ المقارنةُ بايتاً ببايتٍ ممكنةً بلا تطبيعٍ.
 * @param {{ dir?: string }} [options]
 * @returns {string}
 */
export function renderApiContract(options = {}) {
  return `${JSON.stringify(buildApiContract(options), null, 2)}\n`;
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
export function run(argv = []) {
  const policy = loadApiPolicy({ dir: CONFIG_DIR });
  const text = renderApiContract({ dir: CONFIG_DIR });
  if (argv.includes('--stdout')) {
    process.stdout.write(text);
    return 0;
  }
  const target = path.join(process.cwd(), policy.wire.contract.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, 'utf8');
  process.stdout.write(`العقدُ المنشورُ كُتِبَ في ${policy.wire.contract.file}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(run(process.argv.slice(2)));
}
