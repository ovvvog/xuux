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
 * 3. **والكتابةُ السياديّةُ صارت قائمةً على السلكِ — وهي مقيسةٌ لا موصوفةٌ
 *    (`WL-193`، سدادُ الشطرِ الأخيرِ من `D-1`):** كان هذا النصُّ يُعلِنُ «لا كتابةَ
 *    بحالٍ» **ولم يكن ذاك حَدّاً بل نقصَ وصلةٍ**: مسارُ `POST /state/console/<action>`
 *    مُشتقٌّ من `config/royal-console.yaml` في `src/transport/router.mjs` منذُ
 *    `M9.03`، لكنَّ هذا المُشغِّلَ **لم يكن يُمرِّرُ ديواناً**، فكانَ كلُّ نداءِ كتابةٍ
 *    يُرَدُّ `CONSOLE_GATEWAY_REQUIRED` — أي «لا بابَ» لا «مرفوضٌ». **والآنَ
 *    يُوصَلُ الديوانُ الحقيقيُّ**، فيُرَدُّ غيرُ الموقَّعِ `403`
 *    و`CONSOLE_SIGNATURE_INVALID` — **رفضُ سلطةٍ من الديوانِ لا نقصُ تركيبٍ**.
 *    **والتوقيعُ لا يقعُ عندَ البابِ:** البابُ يتحقَّقُ ولا يوقِّعُ، والخَتمُ في
 *    جانبِ الملكِ (`scripts/royal-command.mjs` على `SovereignWriter.seal`).
 * 3ب. **وحدُّ هذا التشغيلِ مُعلَنٌ: الموقِّعُ هنا موقِّعُ تطويرٍ لا وحدةُ عتادٍ.**
 *    مادّتُه في ذاكرةِ هذه العمليّةِ، ولذلك **يُعلِنُ نفسَه `productionReady: false`
 *    فيَرُدُّه `SovereignWriter` في بيئةِ إنتاجٍ** بحُكمِ مخازنِ المفاتيحِ نفسِه
 *    (`scripts/dev-royal-signer.mjs`). والإنتاجُ سبيلُه `moduleSignerFromHsm(HsmSigner)`
 *    بلا تعديلِ سطرٍ في المُنادي. **وأثرُ الأمرِ في هذا التشغيلِ محصورٌ في محكمةٍ
 *    مؤقّتةٍ** (‏تاجٌ ودفترُ أوامرٍ وزرُّ إيقافٍ وسجلٌّ دائمٌ في مجلدٍ يُمحى عندَ
 *    الإغلاقِ) — فلا يمسُّ أمرُ تطويرٍ حالةَ دولةٍ حقيقيّةً.
 * 3ج. **والخادمُ لا يحملُ مادّةَ خَتمٍ ملكيٍّ أصلاً:** التاجُ والديوانُ لا
 *    يستعملانِ من الملكِ إلاّ `id` و`verify` (‏`src/root-of-trust/crown.mts:286`)،
 *    فيُعطَيانِ هنا `royalVerifierFromPublicKey` — مُتحقِّقاً من مفتاحٍ عامٍّ
 *    وحدَه، لا هويّةً تُوقِّعُ. ومعرّفُ الملكِ واحدٌ في الحالَتَينِ
 *    (`'king:' + fingerprint(publicKey).slice(0, 24)`)، فلا تختلفُ جلسةٌ ولا قيدٌ.
 *    **وأثرُ هذا أنّ سرقةَ الخادمِ كلِّه لا تُعطي سارقَه أمراً واحداً
 *    مقبولاً**، والموقِّعُ في `--self-check` في العمليّةِ نفسِها لأنّ الفحصَ
 *    يلعبُ دورَ الملكِ ودورَ البابِ معاً — وذاك حدُّ الفحصِ لا حدُّ البابِ.
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

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { ApiGateway, SESSION_ERRORS, loadApiPolicy } from '../src/api/index.mjs';
import { createPoPClient } from '../src/api/pop-client.mjs';
import { KingAuthenticator, factorCodeForStep, loadKingAuthPolicy } from '../src/authn/index.mjs';
import {
  CONSOLE_ERRORS,
  RoyalConsole,
  SovereignWriter,
  loadConsolePolicy,
} from '../src/console/index.mjs';
import { composeEnforcementChain } from '../src/core/composition-root.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../src/observability/index.mjs';
import {
  createMemoryRepositories,
  createPostgresRepositories,
} from '../src/persistence/composition.mjs';
import { createPool } from '../src/persistence/db.mjs';
import {
  CertificateAuthority,
  CommandLedger,
  CrownGateway,
  EventLog,
  HaltSwitch,
  KingIdentity,
  PersistentEventLog,
  createRoyalCommand,
  royalVerifierFromPublicKey,
} from '../src/root-of-trust/index.mjs';
import {
  compileCommandRoutes,
  compileRoutes,
  compileSessionRoute,
  createStateServer,
  createTlsServer,
} from '../src/transport/index.mjs';
import { PROXY_HEADER, assertLoopbackHost, createSigningProxyHandler } from './dev-pop-proxy.mjs';
import { createDevRoyalSigner } from './dev-royal-signer.mjs';

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

/**
 * **محكمةُ أمرٍ موقَّتةٌ للتطويرِ:** ديوانٌ موصولٌ بجذرِ ثقةٍ حقيقيٍّ
 * (‏تاجٌ، دفترُ أوامرٍ، زرُّ إيقافٍ، سجلٌّ دائمٌ على قرصٍ)، **وكاتبٌ سياديٌّ يوقّعُ
 * بموقِّعٍ يُعلِنُ أنّه غيرُ إنتاجيٍّ**.
 *
 * **ولماذا مجلَدٌ موقَّتٌ لا مواضعُ الإنتاجِ؟** لأنّ أمرَ الإيقافِ يُكتَبُ
 * توجيهاً على قرصٍ، وأمرُ تطويرٍ يكتبُ توجيهَ إيقافٍ حيثُ يقرأُه تركيبٌ آخرُ
 * **يُوقِفُ دولةً لم يُرِدْ أحدٌ إيقافَها** — وذاك أسوأُ ما يفعلُه مُشغِّلُ تطويرٍ.
 *
 * **ومفتاحُ الملكِ لحظيٌّ في الذاكرةِ لا يُكتَبُ ولا يُطبَعُ**، وهو مفتاحٌ واحدٌ
 * يُعطى للتاجِ وللموقِّعِ معاً: ولو كانا مفتاحَينِ لَرَدَّ التاجُ توقيعَ الوحدةِ
 * لسببٍ لا علاقةَ له بما يُقاس.
 * @returns {Promise<{ console: RoyalConsole, writer: SovereignWriter, sovereignSession: string, logFile: string, close: () => void }>}
 */
async function royalCourtFor() {
  const consolePolicy = loadConsolePolicy({ dir: CONFIG_DIR });
  const authnPolicy = loadKingAuthPolicy({ dir: CONFIG_DIR });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-royal-court-'));
  const logFile = path.join(directory, 'sovereign-events.log');
  const royalLog = new PersistentEventLog(logFile, { fsync: false });
  const keys = generateKeyPairSync('ed25519');
  const king = new KingIdentity(keys);
  const ca = new CertificateAuthority(king);
  const commandLedger = new CommandLedger(path.join(directory, 'commands.ledger'), {
    fsync: false,
  });
  const haltSwitch = new HaltSwitch(path.join(directory, 'halt.directive'), king, {
    log: royalLog,
    fsync: false,
  });
  // **والبابُ يتحقَّقُ بمفتاحٍ عامٍّ لا يملكُ به خَتماً:** التاجُ والديوانُ لا
  // يستعملانِ من الملكِ إلاّ `id` و`verify` (‏`crown.mts:286` و`:321`)، فيُعطَيانِ
  // مُتحقِّقاً من مفتاحٍ عامٍّ وحدَه. وبهذا يكونُ إثباتُ `D-1` أقوى: لو سُرِقَ
  // الخادمُ كلُّه لم يُوجَدْ فيه ما يُصدَرُ به أمرٌ ملكيّ. والخَتمُ في جانبِ الملكِ.
  const royalVerifier = royalVerifierFromPublicKey(
    keys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  );
  const crown = new CrownGateway(/** @type {never} */ (royalVerifier), ca, royalLog, {
    commandLedger,
    haltSwitch,
  });
  // سرُّ العاملِ الزّائدِ لحظيٌّ أيضاً، وواحدٌ لكلِّ الأجهزةِ المُعلَنةِ في
  // `config/king-authentication.yaml` — فالمقيسُ أنّ الجلسةَ القويّةَ لازمةٌ، لا أنّ
  // لكلِّ جهازٍ سرّاً مختلفاً.
  const factorSecret = randomBytes(32).toString('hex');
  /** @type {Record<string, string>} */
  const vault = {};
  for (const device of authnPolicy.devices) vault[device.factorRef] = factorSecret;
  const kingAuth = new KingAuthenticator({
    policy: authnPolicy,
    king,
    log: royalLog,
    factorSecrets: { read: (/** @type {string} */ name) => vault[name] ?? null },
  });
  const trustedDevice = authnPolicy.devices[0];
  if (trustedDevice === undefined) {
    throw new Error('KING_AUTH_POLICY_WITHOUT_TRUSTED_DEVICE');
  }
  const { stepSeconds, digits, algorithm } = authnPolicy.secondFactor;
  const strongSession = await kingAuth.authenticate({
    actorId: king.id,
    deviceId: trustedDevice.id,
    factorCode: factorCodeForStep({
      secret: factorSecret,
      step: Math.floor(Date.now() / 1000 / stepSeconds),
      digits,
      algorithm,
    }),
  });
  const royalConsole = new RoyalConsole({
    policy: consolePolicy,
    gateway: null,
    crown,
    haltSwitch,
    king: /** @type {never} */ (royalVerifier),
    kingAuth,
    commandLedger,
    log: royalLog,
  });
  // والكاتبُ يُرفَضُ مُغلَقاً إن كانتِ البيئةُ إنتاجاً: موقِّعُ التطويرِ يُعلِنُ
  // `productionReady: false`، والرفضُ يقعُ **عندَ التركيبِ** فيموتُ المُشغِّلُ
  // قبلَ أن يُنصِتَ — لا أن يُنصِتَ ثمّ يَرُدَّ أوّلَ أمرٍ.
  const writer = new SovereignWriter({
    console: royalConsole,
    signer: createDevRoyalSigner(keys),
  });
  return {
    console: royalConsole,
    writer,
    sovereignSession: strongSession.token,
    logFile,
    close: () => {
      royalLog.close?.();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** المسارُ الذي يُقاسُ به الإقلاعُ: عدُّ الوكلاءِ — قراءةٌ بلا مُلحقاتٍ. */
const SELF_CHECK_ROUTE = 'state.agents.count';
/**
 * والأمرُ الذي تُقاسُ به الكتابةُ: أمرُ نقضٍ على بوابةِ تاجِ **محكمةِ التطويرِ
 * الموقَّتةِ** وحدَها. ولَم لا `cmd:halt`؟ لأنّ الإيقافَ يُكتَبُ توجيهاً على قرصٍ
 * ويُغلِقُ ما بعدَه، ففحصُ إقلاعٍ يُوقِفُ ما يفحصُه لا يقيسُ إلاّ نفسَه.
 */
const SELF_CHECK_COMMAND = 'cmd:veto';

/**
 * يُحرِّفُ توقيعاً تحريفاً لا يُخطئُ: يُفكُّ الترميزُ ويُقلَبُ أوّلُ بايتٍ ثم يُعادُ.
 * @param {string} signature - التوقيعُ الصحيحُ بترميزِ `base64url`
 * @returns {string} توقيعٌ مُحرَّفٌ بالطولِ نفسِه
 */
function forgeSignature(signature) {
  const bytes = Buffer.from(signature, 'base64url');
  const first = bytes[0];
  if (bytes.length === 0 || first === undefined) throw new Error('SELF_CHECK_EMPTY_SIGNATURE');
  bytes[0] = first ^ 0xff;
  return bytes.toString('base64url');
}

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
 * **ومنذُ سدادِ الشطرِ الأخيرِ من `D-1` يُقاسُ معَ القراءةِ **الكتابةُ** على
 * السلكِ أربعَ مرّاتٍ:** أمرٌ بلا توقيعٍ يُرَدُّ، وأمرٌ مختومٌ من موقِّعٍ يُقبَلُ،
 * **وأثرُه يُقرأُ من ملفِّ السجلِّ الدائمِ لا من ردِّ الخادمِ**، وإعادةُ الظرفِ نفسِه
 * تُرَدُّ `409`. **وقبولُ الموقَّعِ وحدَه ليس نجاحاً**: بابٌ يقبلُ الكلَّ يقبلُ
 * الموقَّعَ أيضاً، وبابٌ بلا ديوانٍ يَرُدُّ الكلَّ بـ`CONSOLE_GATEWAY_REQUIRED` — ولذلك
 * يُحكَمُ على **رمزٍ واحدٍ ورقمٍ واحدٍ** في كلِّ فحصٍ لا على `>= 400` (‏دَينُ `LIVE-6`).
 * @param {{ base: string, proxyBase: string, token: string, sessionId: string, routeSpec: { id: string, method: string, path: string, action: string, resource: string } | null, popClient: ReturnType<typeof createPoPClient>, commandPath: string | null, court: Awaited<ReturnType<typeof royalCourtFor>> }} ctx
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

  const writeVerdict = await writeChecks(ctx, lines);

  const ok =
    staticResponse.status === 200 &&
    refused &&
    accepted &&
    proxiedOk &&
    readOnly &&
    writeVerdict.ok;
  lines.push(
    ok
      ? '    ✅ الحكمُ: البابُ يُقلِعُ ويُجيبُ، **وإثباتُ الحيازةِ قائمٌ لا مُسقَطٌ**، **والمشهدُ يقرأُ بوسيطٍ موقِّعٍ معلومِ السُّلطةِ والمدى**، **والكتابةُ السياديّةُ تمرُّ بتوقيعٍ ويُرَدُّ غيرُ الموقَّعِ**.'
      : '    ❌ الحكمُ: الفحصُ أخفقَ — ولا يُقالُ «يعملُ» بعدَ إخفاقٍ.',
  );
  if (!refused) lines.push(`    (‏جسمُ الردِّ غيرِ الموقَّعِ: ${unsignedBody.slice(0, 200)})`);
  return { ok, lines };
}

/**
 * **الكتابةُ السياديّةُ مقيسةً على السلكِ** — ومفصولةٌ لأنّ لها أربعَ
 * قياساتٍ مستقلّةٍ، ودمجُها في دالّةٍ واحدةٍ يُخفي أيُّها أخفق.
 * @param {{ base: string, commandPath: string | null, court: Awaited<ReturnType<typeof royalCourtFor>> }} ctx
 * @param {string[]} lines
 * @returns {Promise<{ ok: boolean }>}
 */
async function writeChecks(ctx, lines) {
  if (ctx.commandPath === null) {
    lines.push(
      `    ❌ الأمرُ «${SELF_CHECK_COMMAND}» غيرُ مُعلَنٍ في \`config/royal-console.yaml\`، فلا مسارَ كتابةٍ يُقاس.`,
    );
    return { ok: false };
  }
  const url = `${ctx.base}${ctx.commandPath}`;
  /**
   * @param {Record<string, unknown>} envelope
   * @returns {Promise<{ status: number, code: string, body: Record<string, unknown> }>}
   */
  const post = async (envelope) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const text = await response.text();
    /** @type {Record<string, unknown>} */
    let body;
    try {
      body = /** @type {Record<string, unknown>} */ (JSON.parse(text));
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    return { status: response.status, code: String(body['code'] ?? body['status'] ?? ''), body };
  };

  // ١. **غيرُ الموقَّعِ يُرَدُّ — وهو الشاهدُ الحرفيُّ الذي يطلبُه معيارُ `D-1`.**
  const unsigned = await post({
    royalCommand: createRoyalCommand('veto-commands', 'crown:gateway', {}),
    signature: '',
    sovereignSession: ctx.court.sovereignSession,
  });
  const unsignedRefused =
    unsigned.status === 403 && unsigned.code === CONSOLE_ERRORS.SIGNATURE_INVALID;
  lines.push(
    `    أمرٌ بلا توقيعٍ على السلكِ: ‏${unsigned.status} ‏«${unsigned.code}» — ${
      unsignedRefused
        ? 'مردودٌ رفضَ سلطةٍ كما يجبُ'
        : `❌ المطلوبُ ‏403/\`${CONSOLE_ERRORS.SIGNATURE_INVALID}\` — ورفضٌ يُقالُ «لا ديوانَ» أو «عَطَبٌ» ليس رفضَ سلطةٍ`
    }`,
  );

  // ٢. **وتوقيعٌ مُحرَّفٌ يُرَدُّ أيضاً — فالبابُ يتحقَّقُ ولا يكتفي بوجودِ حقلٍ:**
  //    فحصٌ يرضى بـ`signature` غيرِ فارغٍ ليس فحصَ توقيعٍ، وهو عينُ درسِ «حاجزٌ يفحصُ
  //    وجودَ الردِّ ولا يفحصُ صحّتَه لا يحمي». ومعرّفُ الأمرِ لا يُستهلَكُ هنا لأنّ
  //    فحصَ التوقيعِ في التاجِ **قبلَ** دفترِ الإعادةِ.
  const forgedSeal = await ctx.court.writer.seal({
    command: SELF_CHECK_COMMAND,
    royalCommand: /** @type {Record<string, unknown>} */ (
      /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
    ),
    sovereignSession: ctx.court.sovereignSession,
  });
  const forged = await post({
    royalCommand: forgedSeal.royalCommand,
    // **بايتٌ واحدٌ يُقلَبُ في المادّةِ لا حرفٌ في نصِّها:** أوّلُ محاولةٍ قلبَتْ
    // آخرَ حرفٍ من `base64url`، وآخرُ حرفٍ في ٨٦ حرفاً يحملُ بتَّينِ معنويَّينِ
    // وأربعةَ مُهمَلةٍ — فكانَ التحريفُ يقعُ في المُهمَلِ أحياناً فتعودُ البايتاتُ
    // نفسَها ويُقبَلُ «المُحرَّفُ». فالتحريفُ الآنَ على البايتِ الأوّلِ بعدَ فكِّ
    // الترميزِ: تحريفٌ لا يُخطئُ. (وهذا درسُ «فحصٌ يمرُّ لسببٍ غيرِ الذي يُقاسُ له».)
    signature: forgeSignature(forgedSeal.signature),
    sovereignSession: forgedSeal.sovereignSession,
  });
  const forgedRefused = forged.status === 403 && forged.code === CONSOLE_ERRORS.SIGNATURE_INVALID;
  lines.push(
    `    توقيعٌ مُحرَّفٌ ببايتٍ واحدٍ: ‏${forged.status} ‏«${forged.code}» — ${
      forgedRefused
        ? 'مردودٌ — فالبابُ يتحقَّقُ لا يكتفي بوجودِ حقلٍ'
        : `❌ المطلوبُ ‏403/\`${CONSOLE_ERRORS.SIGNATURE_INVALID}\``
    }`,
  );

  // ٣. **موقَّعٌ من الموقِّعِ يُقبَلُ.** والخَتمُ في جانبِ الملكِ لا عندَ البابِ:
  //    `seal` تُرجِعُ الظرفَ ولا تُرسِلُ، والإرسالُ هنا بـ`fetch` كما يفعلُ
  //    `scripts/royal-command.mjs`.
  const envelope = await ctx.court.writer.seal({
    command: SELF_CHECK_COMMAND,
    royalCommand: /** @type {Record<string, unknown>} */ (
      /** @type {unknown} */ (createRoyalCommand('veto-commands', 'crown:gateway', {}))
    ),
    sovereignSession: ctx.court.sovereignSession,
  });
  const signed = await post({
    royalCommand: envelope.royalCommand,
    signature: envelope.signature,
    sovereignSession: envelope.sovereignSession,
  });
  const signedAccepted = signed.status === 200 && signed.body['status'] === 'executed';
  lines.push(
    `    أمرٌ مختومٌ من موقِّعٍ على السلكِ: ‏${signed.status} ‏«${String(signed.body['status'] ?? signed.code)}» — ${
      signedAccepted ? 'مقبولٌ ومُنفَّذٌ' : '❌ لم يُنفَّذ'
    }`,
  );

  // ٤. **والأثرُ يُقرأُ من ملفِّ السجلِّ الدائمِ لا من ردِّ الخادمِ:** ردٌّ يقولُ
  //    «نُفِّذَ» وسجلٌّ لا يحملُ قيداً إعلانُ أثرٍ لا إثباتُه.
  const logged = fs.existsSync(ctx.court.logFile)
    ? fs.readFileSync(ctx.court.logFile, 'utf8').includes('console.command.executed')
    : false;
  lines.push(
    `    قيدُ التنفيذِ في ملفِّ السجلِّ الدائمِ: ${
      logged ? 'موجودٌ — فالأثرُ مشهودٌ على قرصٍ' : '❌ غائبٌ'
    }`,
  );

  // **ولماذا لا يُقاسُ منعُ الإعادةِ هنا؟** لأنّ أمرَ النقضِ يُغلِقُ بوابةَ التاجِ،
  // وبوابةٌ مغلقةٌ تَرُدُّ الإعادةَ **قبلَ أن تبلُغَ دفترَ الأوامرِ** (`crown.mts:285`
  // قبلَ `:293`)، فيُقرأُ رفضُ النقضِ منعَ إعادةٍ وهو غيرُه — وفحصٌ يمرُّ لسببٍ غيرِ
  // الذي يُقاسُ له أسوأُ من لا فحصٍ. ومنعُ الإعادةِ مقيسٌ في
  // `tests/console/royal-console.test.mjs` و`tests/root-of-trust/crown.test.mjs`.
  return { ok: unsignedRefused && forgedRefused && signedAccepted && logged };
}

/**
 * **يُسجِّلُ المستهلِكينَ المُعلَنينَ في `config/api.yaml`** — `WL-194`، إغلاقُ `D-2`.
 *
 * **والتسجيلُ فعلُ مُشغِّلٍ قبلَ الإقلاعِ لا مسلكٌ على السلكِ:** مَن أعلنَ موضعَ مفتاحٍ
 * عامٍ في متغيِّرِ البيئةِ المُعلَنِ نالَ هويةً من سجلِّ الدولةِ ومفتاحَ حيازةٍ مربوطاً
 * بها، ومَن لم يُعلِنْ فلا هويةَ له ويُقالُ ذلك في اللوحةِ **صريحاً لا صامتاً**.
 *
 * **ومادّةُ المفتاحِ تُقرأُ ولا تُخمَّنُ:** ملفٌ مُعلَنٌ ومفقودٌ يُرفعُ خطأً ولا
 * يُتجاوَزُ، وملفٌ يحملُ مفتاحاً خاصّاً يُرفَضُ: مَن أعطى خاصَّه للخادمِ لم يُثبِتْ
 * حيازةً بل أدّاها إليه.
 *
 * **والقدراتُ تُشتَقُّ من أفعالِ المساراتِ المُعلَنةِ لا تُكتَبُ هنا:** قائمةٌ مكتوبةٌ
 * يداً تفترقُ عن الوثيقةِ في أوّلِ مسارٍ يُضافُ. والتفويضُ بعدَها يُقرِّرُ لا هي.
 * @param {{ policy: import('../src/api/gateway.mjs').ApiPolicy, registry: { register: (input: { name: string, role: string, capabilities: string[], kind: string }) => Promise<{ id: string }> }, gateway: { registerPoPKey: (actorId: string, pem: string) => boolean }, identities: Map<string, { id: string, state: string }>, env: NodeJS.ProcessEnv, doorOrigin: string }} input
 * @returns {Promise<Array<{ id: string, actorId: string | null, role: string, note: string }>>}
 */
async function enrollDeclaredConsumers(input) {
  const { policy, registry, gateway, identities, env, doorOrigin } = input;
  const capabilities = [...new Set(policy.routes.map((route) => `action:${route.action}`))];
  /** @type {Array<{ id: string, actorId: string | null, role: string, note: string }>} */
  const enrolled = [];
  for (const consumer of policy.wire.consumers) {
    const keyFile = env[consumer.publicKeyEnv] ?? '';
    if (keyFile === '') {
      enrolled.push({
        id: consumer.id,
        actorId: null,
        role: consumer.role,
        note: `غيرُ مُسجَّلٍ: لا مفتاحَ مُعلَناً في ${consumer.publicKeyEnv}`,
      });
      continue;
    }
    const pem = fs.readFileSync(keyFile, 'utf8');
    if (pem.includes('PRIVATE KEY')) {
      throw new Error(
        `الملفُ المُعلَنُ في ${consumer.publicKeyEnv} يحملُ مفتاحاً خاصّاً؛ والمُسجَّلُ عامٌ وحدَه: مَن أعطى خاصَّه لم يُثبِتْ حيازةً بل أدّاها.`,
      );
    }
    const agent = await registry.register({
      name: consumer.name,
      role: consumer.role,
      capabilities,
      kind: 'service',
    });
    identities.set(agent.id, /** @type {never} */ (agent));
    if (!gateway.registerPoPKey(agent.id, pem)) {
      throw new Error(
        `مفتاحُ المستهلِكِ ${consumer.id} لم يُقبَلْ من ${keyFile}؛ ومفتاحٌ لا يُقرأُ لا يُتجاوَزُ.`,
      );
    }
    // **ملفُّ التسجيلِ تسليمٌ خارجَ السلكِ:** فيه معرِّفُ الفاعلِ وموضعُ البابِ
    // وموضعُ العقدِ، وليس فيه مادّةُ مفتاحٍ ألبتّةً.
    const enrollmentFile = env[consumer.enrollmentFileEnv] ?? '';
    if (enrollmentFile !== '') {
      fs.writeFileSync(
        enrollmentFile,
        `${JSON.stringify(
          {
            consumer: consumer.id,
            actorId: agent.id,
            role: consumer.role,
            doorOrigin,
            contract: policy.wire.contract.file,
            enrolledAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
    }
    enrolled.push({
      id: consumer.id,
      actorId: agent.id,
      role: consumer.role,
      note:
        enrollmentFile === ''
          ? `مُسجَّلٌ ولا ملفَ تسجيلٍ (‏يُعلَنُ في ${consumer.enrollmentFileEnv})`
          : `مُسجَّلٌ، وتسليمُه في ${enrollmentFile}`,
    });
  }
  return enrolled;
}

async function main() {
  // P0 Production Root of Trust Integration: هذا السكربتُ للتطويرِ وحدَه.
  // في بيئةِ الإنتاجِ يجبَ أن يُستعمَلَ `src/production/entrypoint.mts` الذي يربطُ
  // جذرَ الثقةِ بسلسلةِ الإنفاذِ والنواةِ. هذا السكربتُ لا يمرُّ عبر Root of Trust.
  if (process.env.NODE_ENV === 'production' || process.env.STATE_ENV === 'production') {
    console.error(
      'SERVE_STATE_NOT_PRODUCTION_PATH: هذا السكربت للتطوير فقط. استخدم src/production/entrypoint.mts للإنتاج.',
    );
    process.exit(1);
  }
  const apiPolicy = loadApiPolicy({ dir: CONFIG_DIR });
  const monitoringPolicy = loadMonitoringPolicy({ dir: CONFIG_DIR });
  const routes = compileRoutes({ policy: apiPolicy });
  // ومسلكُ فتحِ الجلسةِ مُشتَقٌّ من الوثيقةِ نفسِها لا مكتوبٌ هنا (`WL-194`).
  const sessionRoute = compileSessionRoute({ policy: apiPolicy });
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
  // وسجلُّ الهويّاتِ الموصولُ بالبوابةِ خريطةٌ لا مقارنةُ معرِّفٍ واحدٍ: المستهلِكونَ
  // المُعلَنونَ يُسجَّلونَ فيها بعدَ الربطِ (‏`WL-194`)، ومَن لم يُسجَّلْ فليس فيها.
  /** @type {Map<string, { id: string, state: string }>} */
  const identities = new Map([[viewerAgent.id, /** @type {never} */ (viewerAgent)]]);
  const agents = {
    get: async (/** @type {string} */ id) => identities.get(id) ?? null,
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
  // **والديوانُ يُوصَلُ حقيقيّاً لا يُمرَّرُ `null` (‏سدادُ آخرِ `D-1`):** مسارُ
  // الكتابةِ مُشتقٌّ من `config/royal-console.yaml`، وبلا ديوانٍ يُرَدُّ كلُّ أمرٍ
  // بـ`CONSOLE_GATEWAY_REQUIRED` — وذاك «لا بابَ» لا «مرفوضٌ»، فلا يُقاسُ به رفضُ
  // غيرِ الموقَّعِ ولا قبولُ الموقَّعِ.
  const court = await royalCourtFor();
  const commandRoutes = compileCommandRoutes();
  const inner = createStateServer({
    gateway: /** @type {never} */ (gateway),
    webDir: WEB_DIR,
    routes,
    commandRoutes,
    sessionRoute,
    console: /** @type {never} */ (court.console),
  });
  // **ومنفَذُ البابِ الدّاخليِّ مُعلَنٌ لا عابرٌ إن أُريدَ مستهلِكٌ خارجيٌّ** — `WL-194`:
  // الوسيطُ الأماميُّ قارئٌ يُوقِّعُ بسلطتِه هو، فلا يعبرُه فتحُ جلسةٍ ولا نداءٌ
  // موقَّعٌ من غيرِه. ومن ثمَّ يُعلَنُ منفَذُ البابِ نفسِه في متغيِّرٍ مُعلَنٍ في
  // الوثيقةِ (`wire.doorPortEnv`)، **والأصلُ منفَذٌ عابرٌ على المضيفِ المحلّيِّ**
  // فلا يُفتَحُ بابٌ ثابتٌ لمَن لم يُرِدْه.
  const doorPortDeclared = process.env[apiPolicy.wire.doorPortEnv] ?? '';
  const doorPort = doorPortDeclared === '' ? 0 : Number(doorPortDeclared);
  if (!Number.isInteger(doorPort) || doorPort < 0 || doorPort > 65535) {
    throw new Error(
      `منفَذُ البابِ المُعلَنُ في ${apiPolicy.wire.doorPortEnv} ليس منفَذاً: «${doorPortDeclared}».`,
    );
  }
  await new Promise((resolve) => inner.listen(doorPort, '127.0.0.1', () => resolve(undefined)));
  const innerAddress = inner.address();
  const innerPort =
    typeof innerAddress === 'object' && innerAddress !== null ? innerAddress.port : 0;
  // والتسجيلُ بعدَ الربطِ لا قبلَه: ملفُّ التسليمِ يحملُ موضعَ البابِ، وموضعٌ
  // يُكتَبُ قبلَ أن يُعرَفَ تسليمٌ لعنوانٍ لا يُطرَقُ.
  const enrolledConsumers = await enrollDeclaredConsumers({
    policy: apiPolicy,
    registry: /** @type {never} */ (registry),
    gateway: /** @type {never} */ (gateway),
    identities,
    env: process.env,
    doorOrigin: `http://127.0.0.1:${innerPort}`,
  });

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
    '  وإثباتُ الحيازةِ لازمٌ لكلِّ نداءٍ (‏لا للفتحِ وحدَه).',
    '',
    // ── المستهلِكُ الخارجيُّ (‏`WL-194` — إغلاقُ `D-2`) ──
    `  وبابُ المستهلِكِ الخارجيِّ مباشرةً: http://127.0.0.1:${innerPort}/ (‏يُعلَنُ ثابتاً في \`${apiPolicy.wire.doorPortEnv}\`)`,
    `  ومسلكُ فتحِ الجلسةِ مُشتَقٌّ من الوثيقةِ: ${sessionRoute.method} ${sessionRoute.path}   → ${sessionRoute.id}`,
    `  والعقدُ المنشورُ للمستهلِكِ: ${apiPolicy.wire.contract.file} (‏يُولِّدُه \`${apiPolicy.wire.contract.generatedBy}\`)`,
    '  والمستهلِكونَ المُعلَنونَ وحالُ تسجيلِهم — **ولا تسجيلَ على السلكِ بحالٍ**:',
    ...enrolledConsumers.map(
      (entry) =>
        `    ${entry.id} بدورِ ${entry.role} → ${entry.actorId ?? 'لا هويةَ'}   (${entry.note})`,
    ),
    '',
    `  ومشهدُ الويبِ يقرأُ عبرَ وسيطٍ موقِّعٍ في الخادمِ (‏إغلاقُ \`LIVE-5\`): سلطتُهُ ${ACTOR_LABEL}،`,
    '  ومداهُ قراءةٌ فقط على المضيفِ المحلّيِّ وحدَهُ، ويُعلِنُ نفسَهُ في `x-state-pop-proxy`.',
    '  ومَن أتى برمزِهِ مُرِّرَ كما هو بلا توقيعٍ: لا ينتحِلُ الوسيطُ جلسةَ غيرِهِ.',
    '  ولا يُنشَرُ هذا على شبكةٍ عامّةٍ. (`docs/TRANSPORT.md`)',
    '',
    '  والكتابةُ السياديّةُ قائمةٌ ومساراتُها مُشتقّةٌ من `config/royal-console.yaml`:',
  );
  for (const route of commandRoutes) {
    lines.push(`    ${String(route.method)} ${String(route.path)}   → ${String(route.id)}`);
  }
  const declaration = court.writer.describe();
  lines.push(
    `  وموقِّعُ الأمرِ هنا «${declaration.kind}»: لا يُصدِّرُ مادّتَه، **ويُعلِنُ أنّه غيرُ إنتاجيٍّ**`,
    `  (‏${declaration.productionReady ? 'إنتاجيٌّ' : 'غيرُ إنتاجيٍّ'}) فيَرُدُّه الكاتبُ في بيئةِ إنتاجٍ؛ والإنتاجُ سبيلُه \`moduleSignerFromHsm(HsmSigner)\`.`,
    '  **والبابُ يتحقَّقُ ولا يوقِّعُ**: تاجُهُ وديوانُهُ يُعطَيانِ مُتحقِّقاً من مفتاحٍ عامٍّ',
    '  وحدَهُ (`royalVerifierFromPublicKey`)، فلا مادّةَ خَتمٍ ملكيٍّ في هذا الخادمِ أصلاً.',
    '  وأمرٌ بلا توقيعٍ أو بتوقيعٍ مُحرَّفٍ يُرَدُّ',
    `  ‏403 و\`${CONSOLE_ERRORS.SIGNATURE_INVALID}\`؛ والخَتمُ في جانبِ الملكِ: \`node scripts/royal-command.mjs --help\`.`,
    '  **وأثرُ الأمرِ في هذا التشغيلِ محصورٌ في محكمةٍ موقَّتةٍ تُمحى عندَ الإغلاقِ**،',
    '  فلا يمسُّ أمرُ تطويرٍ حالةَ دولةٍ حقيقيّةً.',
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
      commandPath: commandRoutes.find((route) => route.id === SELF_CHECK_COMMAND)?.path ?? null,
      court,
    });
    process.stdout.write(`${verdict.lines.join('\n')}\n`);
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    await new Promise((resolve) => inner.close(() => resolve(undefined)));
    await close();
    court.close();
    process.exit(verdict.ok ? 0 : 1);
  }

  /** @param {string} signal */
  const shutdown = (signal) => {
    process.stdout.write(`\nيُغلَقُ البابُ عندَ ${signal}…\n`);
    server.close(() => {
      inner.close(() => {
        void close().then(() => {
          // ومحكمةُ التطويرِ تُمحى: توجيهُ إيقافٍ يبقى بعدَ الإغلاقِ أثرٌ لا يعرفُ
          // أحدٌ من أحدثَه، ومفتاحٌ لحطيٌّ يموتُ مع العمليّةِ فلا يُقرأُ بعدَها أمرٌ.
          court.close();
          process.exit(0);
        });
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
