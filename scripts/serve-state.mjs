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
 * 2ب. **وصفحةُ المتصفِّحِ لا تُوقِّعُ:** لا مفتاحَ خاصَّ فيها، فمشهدُ الويبِ
 *    **يُخدَمُ ساكناً ولا تنجحُ نداءاتُه** في تركيبٍ يُلزِمُ الحيازةَ. **وهذا حدٌّ
 *    مقيسٌ لا مستورٌ**، قُيِّدَ ديناً باسمِه (`LIVE-5`) في سجلِّ الديونِ.
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
import path from 'node:path';
import process from 'node:process';

import { ApiGateway, loadApiPolicy } from '../src/api/index.mjs';
import { createPoPClient } from '../src/api/pop-client.mjs';
import { composeEnforcementChain } from '../src/core/composition-root.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../src/observability/index.mjs';
import {
  createMemoryRepositories,
  createPostgresRepositories,
} from '../src/persistence/composition.mjs';
import { createPool } from '../src/persistence/db.mjs';
import { EventLog } from '../src/root-of-trust/index.mjs';
import {
  compileRoutes,
  createSecureStateServer,
  createStateServer,
} from '../src/transport/index.mjs';

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
 * @param {{ base: string, token: string, sessionId: string, routeSpec: { id: string, method: string, path: string, action: string, resource: string } | null, popClient: ReturnType<typeof createPoPClient> }} ctx
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

  const staticResponse = await fetch(`${ctx.base}/`);
  lines.push(
    `    مشهدٌ ساكنٌ: ‏${staticResponse.status} على \`/\` — والإنصاتُ ثابتٌ برمزٍ لا بوصفٍ.`,
  );

  const unsigned = await fetch(url, { headers: { authorization: `Bearer ${ctx.token}` } });
  const unsignedBody = await unsigned.text();
  const refused = unsigned.status >= 400;
  lines.push(
    `    نداءٌ بلا توقيعٍ: ‏${unsigned.status} — ${refused ? 'مردودٌ كما يجبُ' : '❌ قُبِلَ! فالحمايةُ ساقطةٌ'}`,
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

  const ok = staticResponse.status === 200 && refused && accepted;
  lines.push(
    ok
      ? '    ✅ الحكمُ: البابُ يُقلِعُ ويُجيبُ، **وإثباتُ الحيازةِ قائمٌ لا مُسقَطٌ**.'
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
  const server = USE_TLS
    ? createSecureStateServer({
        gateway: /** @type {never} */ (gateway),
        webDir: WEB_DIR,
        routes,
      })
    : createStateServer({
        gateway: /** @type {never} */ (gateway),
        webDir: WEB_DIR,
        routes,
      });

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
    '  وصفحةُ المتصفِّحِ لا تُوقِّعُ، فنداءاتُها تُرَدُّ — والحدُّ مُقيَّدٌ ديناً `LIVE-5`.',
    '  ولا يُنشَرُ هذا على شبكةٍ عامّةٍ. (`docs/TRANSPORT.md`)',
    '',
  );
  process.stdout.write(`${lines.join('\n')}\n`);

  if (SELF_CHECK) {
    const verdict = await selfCheck({
      base: `${USE_TLS ? 'https' : 'http'}://${HOST}:${PORT}`,
      token: session.token,
      sessionId: session.sessionId,
      routeSpec: gateway.routes().find((route) => route.id === SELF_CHECK_ROUTE) ?? null,
      popClient,
    });
    process.stdout.write(`${verdict.lines.join('\n')}\n`);
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    await close();
    process.exit(verdict.ok ? 0 : 1);
  }

  /** @param {string} signal */
  const shutdown = (signal) => {
    process.stdout.write(`\nيُغلَقُ البابُ عندَ ${signal}…\n`);
    server.close(() => {
      void close().then(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
