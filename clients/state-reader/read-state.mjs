#!/usr/bin/env node
/**
 * **مستهلِكُ قراءةٍ خارجَ العقدِ الداخليِّ** — `WL-194`، إغلاقُ الدَينِ `D-2`.
 *
 * **الدَينُ الذي يُسدَّدُ بحرفِه:** «طبقةُ API بلا مستهلِكٍ خارجيٍّ»، ومعيارُ
 * إغلاقِه «مستهلِكٌ خارجُ العقدِ الداخليِّ **يُقاسُ بنداءٍ**». فهذا الملفُّ ليس
 * مثالاً في وثيقةٍ ولا اختباراً يستدعي البوابةَ في العمليّةِ نفسِها: هو **عمليّةٌ
 * منفصلةٌ** تُشغَّلُ فتفتحُ جلسةً على السلكِ وتُوقِّعُ نداءً بمفتاحِها هي.
 *
 * **وحدودُه المُعلَنةُ — وهي التي تجعلُه شاهداً لا شريكاً:**
 *   1. **لا يستوردُ من `src/` إلا `src/api/pop-canonical.mjs`**: صياغةُ التوقيعِ
 *      عقدٌ بينَ طرفَينِ، ونسخُها في العميلِ يُنشئُ مصدرَينِ للحقيقةِ (‏علّةُ وجودِ
 *      ذاك الملفِّ، `WL-179`). وما عداها لا يُستوردُ: **عميلٌ يستوردُ البوابةَ
 *      يختبرُ نفسَه لا السلكَ**.
 *   2. **لا يقرأُ ملفاً من `config/`**: ما يعرفُه يقرأُه من **العقدِ المنشورِ**
 *      `docs/API_CONTRACT.json` — المساراتُ والترويساتُ ومسلكُ الجلسةِ. فما لم
 *      يُنشَرْ في العقدِ **لا سبيلَ للعميلِ إليه**، وهذا هو المقياسُ بعينِه.
 *   3. **لا يعرفُ هويتَه من الشفرةِ ولا من الوثيقةِ**: معرِّفُ الفاعلِ وموضعُ
 *      البابِ يُسلَّمانِ إليه في **ملفِّ تسجيلٍ** يكتبُه المُشغِّلُ عندَ الإقلاعِ
 *      (‏`STATE_READER_ENROLLMENT_FILE`)؛ فالمعرِّفُ يُولَّدُ في سجلِّ الدولةِ ولا
 *      يُعلَنُ سابقاً له، **ولا مسلكَ على السلكِ يقولُ «مَن أنا»**.
 *   4. **مفتاحُه الخاصُّ في بيئتِه وحدَه** (‏`STATE_READER_PRIVATE_KEY_FILE`) ولا
 *      يُقيَّدُ في المستودعِ بحالٍ؛ والخادمُ لا يعرفُ منه إلا العامَّ.
 *
 * **والرفضُ يُقالُ لا يُلَيَّنُ:** كلُّ ردٍّ غيرِ ناجحٍ يُطبَعُ برمزِه المُسمّى
 * والخروجُ غيرُ صفرٍ — عميلٌ يخرجُ صفراً على رفضٍ يُحوِّلُ الحاجزَ إلى زينةٍ.
 *
 * الاستعمالُ:
 *   STATE_READER_ENROLLMENT_FILE=... STATE_READER_PRIVATE_KEY_FILE=... \
 *     node clients/state-reader/read-state.mjs [--route <id>] [--json]
 */

import { Buffer } from 'node:buffer';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  canonicalCallPayload,
  canonicalOpenPayload,
  popMessage,
} from '../../src/api/pop-canonical.mjs';

// `fetch` عالميٌّ في Node 20 وليس في قائمةِ العوالمِ المُعلَنةِ لأداةِ التدقيقِ؛
// فيُقرأُ من `globalThis` صراحةً بدلَ توسيعِ الإعداداتِ لأجلِ ملفٍّ واحدٍ.
const { fetch } = globalThis;

/**
 * يقرأُ قيمةً لازمةً من البيئةِ. **وغيابُها توقُّفٌ لا تخمينٌ**: عميلٌ يُخمِّنُ
 * موضعَ مفتاحِه يُوقِّعُ بما لا يعرفُ صاحبَه.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @returns {string}
 */
function requiredEnv(env, name) {
  const value = env[name] ?? '';
  if (value === '') {
    throw new Error(`المتغيِّرُ «${name}» لازمٌ ولم يُعلَنْ؛ ولا تخمينَ لموضعِ هويةٍ أو مفتاحٍ.`);
  }
  return value;
}

/**
 * @param {readonly string[]} argv
 * @param {string} name
 * @returns {string | undefined}
 */
function argOf(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

/**
 * يُوقِّعُ رسالةَ إثباتِ الحيازةِ ويُخرِجُ حقولَها الثلاثةَ **مجتمعةً**.
 * @param {import('node:crypto').KeyObject} privateKey
 * @param {string} canonicalPayload
 * @returns {{ signature: string, timestamp: string, nonce: string }}
 */
function proofFor(privateKey, canonicalPayload) {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const signature = sign(
    null,
    Buffer.from(popMessage(canonicalPayload, timestamp, nonce), 'utf8'),
    privateKey,
  ).toString('base64');
  return { signature, timestamp, nonce };
}

/**
 * ردٌّ مقروءٌ: الحالةُ والجسمُ المُفكَّكُ إن كان JSON.
 * @param {Response} response
 * @returns {Promise<{ status: number, body: Record<string, unknown> | null, text: string }>}
 */
async function readResponse(response) {
  const text = await response.text();
  /** @type {Record<string, unknown> | null} */
  let body = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = /** @type {Record<string, unknown>} */ (parsed);
    }
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}

/**
 * يُنفِّذُ قراءةً واحدةً كاملةً: فتحُ جلسةٍ موقَّعةٍ ثمّ نداءٌ موقَّعٌ.
 * @param {{ argv?: readonly string[], env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 * @returns {Promise<{ code: number, report: Record<string, unknown> }>}
 */
export async function readState(options = {}) {
  const argv = options.argv ?? [];
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const enrollmentFile = requiredEnv(env, 'STATE_READER_ENROLLMENT_FILE');
  const privateKeyFile = requiredEnv(env, 'STATE_READER_PRIVATE_KEY_FILE');
  const enrollment = /** @type {Record<string, unknown>} */ (
    JSON.parse(fs.readFileSync(enrollmentFile, 'utf8'))
  );
  const actorId = String(enrollment['actorId'] ?? '');
  const doorOrigin = String(enrollment['doorOrigin'] ?? '');
  const contractFile = String(enrollment['contract'] ?? '');
  if (actorId === '' || doorOrigin === '' || contractFile === '') {
    throw new Error(
      `ملفُّ التسجيلِ «${enrollmentFile}» ناقصٌ (‏يلزمُ actorId وdoorOrigin وcontract)؛ وتسليمٌ ناقصٌ لا يُكمَلُ بالتخمينِ.`,
    );
  }
  const contract = /** @type {Record<string, unknown>} */ (
    JSON.parse(
      fs.readFileSync(
        path.isAbsolute(contractFile) ? contractFile : path.join(cwd, contractFile),
        'utf8',
      ),
    )
  );
  const session = /** @type {Record<string, string>} */ (contract['session']);
  const headers = /** @type {Record<string, string>} */ (contract['headers']);
  const routes = /** @type {Array<Record<string, string>>} */ (contract['routes']);
  const wantedRoute = argOf(argv, 'route');
  const route =
    wantedRoute === undefined
      ? routes[0]
      : routes.find((candidate) => candidate['id'] === wantedRoute);
  if (route === undefined) {
    throw new Error(
      `المسلكُ «${String(wantedRoute)}» غيرُ منشورٍ في العقدِ؛ وما لم يُنشَرْ لا يُنادى.`,
    );
  }

  const privateKey = createPrivateKey(fs.readFileSync(privateKeyFile, 'utf8'));

  // ① فتحُ الجلسةِ: إثباتُ حيازةٍ على حمولةِ الفتحِ، في **جسمِ** الطلبِ لا في ترويسةٍ.
  const openProof = proofFor(privateKey, canonicalOpenPayload(actorId));
  const opened = await readResponse(
    await fetch(`${doorOrigin}${session['path']}`, {
      method: session['method'],
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorId, pop: openProof }),
    }),
  );
  if (opened.status !== 200 || opened.body === null || typeof opened.body['token'] !== 'string') {
    return {
      code: 2,
      report: {
        stage: 'session',
        status: opened.status,
        code: opened.body === null ? null : (opened.body['code'] ?? null),
        message:
          opened.body === null ? opened.text.slice(0, 200) : (opened.body['message'] ?? null),
      },
    };
  }
  const token = String(opened.body['token']);
  const sessionId = String(opened.body['sessionId']);

  // ② النداءُ: توقيعٌ على حمولةٍ تُلزِمُ الجلسةَ والمسارَ والفعلَ والمَورِدَ.
  const callProof = proofFor(
    privateKey,
    canonicalCallPayload(
      {
        method: route['method'],
        path: route['path'],
        action: route['action'],
        resource: route['resource'],
      },
      sessionId,
      {},
    ),
  );
  const read = await readResponse(
    await fetch(`${doorOrigin}${route['path']}`, {
      method: route['method'],
      headers: {
        [headers['token']]: `${headers['tokenScheme']} ${token}`,
        [headers['popSignature']]: callProof.signature,
        [headers['popTimestamp']]: callProof.timestamp,
        [headers['popNonce']]: callProof.nonce,
      },
    }),
  );
  if (read.status !== 200 || read.body === null) {
    return {
      code: 3,
      report: {
        stage: 'call',
        route: route['id'],
        status: read.status,
        code: read.body === null ? null : (read.body['code'] ?? null),
        message: read.body === null ? read.text.slice(0, 200) : (read.body['message'] ?? null),
      },
    };
  }
  return {
    code: 0,
    report: {
      stage: 'call',
      route: route['id'],
      status: 'ok',
      httpStatus: read.status,
      actorId,
      sessionId,
      data: read.body['data'] ?? null,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  try {
    const outcome = await readState({ argv });
    process.stdout.write(
      `${JSON.stringify(outcome.report, null, argv.includes('--json') ? 0 : 2)}\n`,
    );
    process.exit(outcome.code);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ stage: 'client', status: 'failed', message: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exit(1);
  }
}
