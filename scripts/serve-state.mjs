#!/usr/bin/env node
/**
 * مُشغِّلُ بابِ الدولةِ للتطويرِ — سدادُ الشطرِ الثالثِ من الدَينِ `D-1`.
 *
 * **هذا السكربتُ للتطويرِ المحلّيِّ وحدَه، ولا يُقرأُ تركيبَ إنتاجٍ.** وسببُ ذلك
 * مُعلَنٌ لا مُخفىً في ثلاثةِ حدودٍ:
 *
 * 1. **لا إنهاءَ `TLS` هنا:** طبقةُ النقلِ نصٌّ صريحٌ تَرُدُّ ترويسةَ
 *    `x-state-transport: plaintext; terminate-tls-upstream`. وشهادةٌ موقَّعةٌ من
 *    نفسِها كانت ستُظهِرُ قُفلاً في المتصفِّحِ بلا سلطةِ تصديقٍ — وذاك إيهامُ
 *    تأمينٍ أسوأُ من انعدامِه، لأنّه يُطمئِنُ من لا ينبغي أن يطمئنَّ.
 * 2. **لا إثباتَ حيازةٍ (`PoP`) في هذا التركيبِ:** التوقيعُ يقتضي مفتاحاً خاصّاً
 *    لا يَحملُه متصفِّحٌ، والتركيبُ الرسميُّ يُشدِّدُه (`requirePoP`). فمن أرادَ
 *    قراءةً بإثباتِ حيازةٍ فمَحلُّها عميلٌ يَحملُ مفتاحَه لا صفحةٌ.
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
 * و`--db` يقرأُ من قاعدةٍ حقيقيّةٍ عبرَ `DATABASE_URL` (ومعها `DATABASE_CA_FILE`
 * عندَ `sslmode=verify-full`)؛ وبدونِه المستودعاتُ في الذاكرةِ فالمشهدُ فارغٌ
 * والقراءةُ مسموحةٌ بصفرِ صفوفٍ — وهذا فرقٌ يُقالُ للقارئِ صريحاً في الواجهةِ.
 */

import path from 'node:path';
import process from 'node:process';

import { ApiGateway, loadApiPolicy } from '../src/api/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../src/observability/index.mjs';
import {
  createMemoryRepositories,
  createPostgresRepositories,
} from '../src/persistence/composition.mjs';
import { createPool } from '../src/persistence/db.mjs';
import { createPolicyDecisionPoint } from '../src/policy/engine.mjs';
import { EnforcementPoint } from '../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../src/policy/loader.mjs';
import { EventLog } from '../src/root-of-trust/index.mjs';
import { compileRoutes, createStateServer } from '../src/transport/index.mjs';

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
const CONFIG_DIR = path.join(process.cwd(), 'config');
const WEB_DIR = path.join(process.cwd(), 'web');
const ACTOR_ID = 'service:state-viewer-dev';

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

async function main() {
  const apiPolicy = loadApiPolicy({ dir: CONFIG_DIR });
  const monitoringPolicy = loadMonitoringPolicy({ dir: CONFIG_DIR });
  const routes = compileRoutes({ policy: apiPolicy });
  const { repositories, close, source } = await repositoriesFor();
  const log = new EventLog();

  /** @type {Record<string, unknown>} */
  const viewer = {
    id: ACTOR_ID,
    kind: 'service',
    state: 'active',
    role: monitoringPolicy.role,
    capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
  };
  const agents = { get: async (/** @type {string} */ id) => (id === ACTOR_ID ? viewer : null) };

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
    enforcementPoint: new EnforcementPoint({
      decisionPoint: createPolicyDecisionPoint({ bundle: loadPolicyBundle() }),
      log: /** @type {never} */ (log),
    }),
  });

  const session = await gateway.openSession({ actorId: ACTOR_ID });
  const server = createStateServer({
    gateway: /** @type {never} */ (gateway),
    webDir: WEB_DIR,
    routes,
  });

  await new Promise((resolve) => server.listen(PORT, HOST, () => resolve(undefined)));

  const lines = [
    '',
    '  بابُ الدولةِ — تشغيلُ تطويرٍ لا إنتاجٍ',
    '  ────────────────────────────────────',
    `  العنوانُ:      http://${HOST}:${PORT}/`,
    `  المصدرُ:       ${source}`,
    `  الفاعلُ:       ${ACTOR_ID} بدورِ ${String(monitoringPolicy.role)}`,
    `  رمزُ الجلسةِ:   ${session.token}`,
    '',
    '  والمساراتُ القارئةُ مُشتقّةٌ من `config/api.yaml` لا مكتوبةٌ يداً:',
  ];
  for (const route of routes) {
    lines.push(`    ${String(route.method)}  ${String(route.path)}   → ${String(route.call)}`);
  }
  lines.push(
    '',
    '  حدودٌ مُعلَنةٌ: لا TLS، ولا إثباتَ حيازةٍ في هذا التركيبِ، ولا كتابةَ.',
    '  ولا يُنشَرُ هذا على شبكةٍ عامّةٍ. (`docs/TRANSPORT.md`)',
    '',
  );
  process.stdout.write(`${lines.join('\n')}\n`);

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
