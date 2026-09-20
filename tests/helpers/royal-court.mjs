// **محكمةٌ ملكيّةٌ مؤقّتةٌ لاختبارِ الكتابةِ السياديّةِ — مُستخرَجةٌ لا مُكرَّرةٌ.**
//
// كانت هذه المحكمةُ في `tests/console/sovereign-writer.test.mjs` وحدَه، فلمّا
// احتاجَها اختبارُ أداةِ جانبِ الملكِ (`tests/tooling/royal-command-cli.test.mjs`)
// كان الطريقانِ: نسخُها — فتتفارقَ نسختانِ ويمرَّ اختبارٌ على جذرِ ثقةٍ غيرِ
// الذي يمرُّ عليه الآخرُ — أو استخراجُها. والمادّةُ الخاصّةُ هنا **لا تُصدَّرُ**:
// التوكنُ البديلُ يوقّعُ ولا يُخرِجُ إلا العامَّ، وهو عقدُ `HsmKeySource` حرفيّاً
// يُفتَحُ عليه `HsmSigner` الإنتاجيُّ نفسُه.
//
// **وحدٌّ معلَنٌ:** التوكنُ بديلٌ في العمليّةِ لا عتادٌ — وسببُه سببُ
// `tests/root-of-trust/hsm-binding.test.mjs` حرفيّاً: اختباراتُ `SoftHSM` تُتجاوَزُ
// كلُّها في CI، واختبارٌ يُتجاوَزُ لا يحمي شيئاً.

import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign as softwareSign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerTmpRoot } from './tmp-roots.mjs';

import {
  KingAuthenticator,
  factorCodeForStep,
  loadKingAuthPolicy,
} from '../../src/authn/index.mjs';
import {
  RoyalConsole,
  SovereignWriter,
  loadConsolePolicy,
  moduleSignerFromHsm,
} from '../../src/console/index.mjs';
import {
  CertificateAuthority,
  CommandLedger,
  CrownGateway,
  HaltSwitch,
  HsmSigner,
  KingIdentity,
  PersistentEventLog,
} from '../../src/root-of-trust/index.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
export const CONSOLE_POLICY = loadConsolePolicy({ dir: CONFIG_DIR });
export const AUTHN_POLICY = loadKingAuthPolicy({ dir: CONFIG_DIR });
/** بيئةُ تطويرٍ صريحةٌ: بلا أيِّ متغيّرِ مخزنِ مفاتيحَ برمجيٍّ ولا إنتاج. */
export const DEV_ENV = Object.freeze({ NODE_ENV: 'development' });
/** بيئةُ إنتاجٍ صريحةٌ لقياسِ الرفضِ الإنتاجيِّ بلا مسِّ بيئةِ العمليّة. */
export const PRODUCTION_ENV = Object.freeze({ NODE_ENV: 'production' });

/**
 * توكنٌ موقِّعٌ فقط: يحفظُ الزوجَ داخلَه ولا يُصدِّرُ إلا العامَّ. **ومَقبضُ
 * التعميةِ فيه رفضٌ مُسمّىً لا مفتاحٌ**: العقدُ `HsmKeySource` يطلبُه، والكاتبُ لا
 * يحتاجُه؛ فمَقبضٌ يُرجِعُ مفتاحاً لا يُنادى يُوهِمُ بقدرةٍ لا تُقاسُ، ومَقبضٌ
 * يَرفضُ باسمِه يقولُ حدَّه في نصِّه.
 * @param {{ privateKey: import('node:crypto').KeyObject, publicKey: import('node:crypto').KeyObject }} kingPair
 * @param {{ corrupt?: boolean }} [options]
 * @returns {import('../../src/root-of-trust/hsm-binding.d.mts').HsmKeySource}
 */
export function signingToken(kingPair, options = {}) {
  const pairs = new Map([
    ['06', kingPair],
    ['07', generateKeyPairSync('ed25519')],
  ]);
  return {
    describe: () => ({ kind: 'pkcs11-hsm', canExport: false }),
    // **ودورُ هذا التوكنِ خَتمٌ لا تعميةٌ:** العقدُ يطلبُ `getAeadKey`، فيُعطى
    // رفضاً مُسمّىً لا مفتاحاً صامتاً — فمن ناداهُ في هذا الحرَمِ نادى ما لا يملكُه.
    getAeadKey: async () => {
      throw new Error('SIGNING_ONLY_TOKEN_HAS_NO_AEAD_KEY');
    },
    getSigningKey: async (keyId) => {
      const pair = pairs.get(keyId);
      if (pair === undefined) throw new Error('KEY_NOT_FOUND');
      return {
        keyId,
        sign: async (message) =>
          options.corrupt === true ? randomBytes(64) : softwareSign(null, message, pair.privateKey),
        exportPublicPem: async () =>
          /** @type {string} */ (pair.publicKey.export({ type: 'spki', format: 'pem' })),
      };
    },
  };
}

/**
 * ديوانٌ على جذرِ ثقةٍ حقيقيٍّ في مجلدٍ مؤقّتٍ، **ومفتاحُ الملكِ هو مفتاحُ
 * التوكنِ نفسُه**: لو كانا مفتاحَينِ لكانَ توقيعُ الوحدةِ يُرَدُّ عندَ التاجِ
 * لسببٍ آخرَ غيرِ الذي يُقاس.
 * @param {{ corrupt?: boolean }} [options]
 */
export async function royalCourt(options = {}) {
  const kingPair = generateKeyPairSync('ed25519');
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-writer-')));
  const logFile = path.join(directory, 'events.log');
  const log = new PersistentEventLog(logFile, { fsync: false });
  const king = new KingIdentity(kingPair);
  const ca = new CertificateAuthority(king);
  const ledger = new CommandLedger(path.join(directory, 'commands.ledger'), { fsync: false });
  const haltSwitch = new HaltSwitch(path.join(directory, 'halt.directive'), king, {
    log,
    fsync: false,
    // R5-B-07: لا إيقافَ ولا استئنافَ إلّا بأمرٍ قُبل وثُبِّتَ في دفترِ الأوامرِ
    // (التوقيعُ فُحِصَ عندَ القبول) — الديوانُ هو مصدرُ الأمرِ لا النداءُ المجرّد.
    royalCommandVerifier: (command) => ledger.has(String(command.id)),
  });
  const crown = new CrownGateway(king, ca, log, { commandLedger: ledger, haltSwitch });
  const factorSecret = randomBytes(32).toString('hex');
  /** @type {Record<string, string>} */
  const vault = {};
  for (const device of AUTHN_POLICY.devices) vault[device.factorRef] = factorSecret;
  const kingAuth = new KingAuthenticator({
    policy: AUTHN_POLICY,
    king,
    log,
    factorSecrets: {
      /** @param {string} name */
      read: (name) => vault[name] ?? null,
    },
  });
  const trustedDevice = AUTHN_POLICY.devices[0];
  assert.ok(trustedDevice !== undefined, 'وثيقةُ المصادقةِ بلا جهازٍ موثوقٍ واحد.');
  const { stepSeconds, digits, algorithm } = AUTHN_POLICY.secondFactor;
  const session = await kingAuth.authenticate({
    actorId: king.id,
    deviceId: trustedDevice.id,
    factorCode: factorCodeForStep({
      secret: factorSecret,
      step: Math.floor(Date.now() / 1000 / stepSeconds),
      digits,
      algorithm,
    }),
  });
  const console_ = new RoyalConsole({
    policy: CONSOLE_POLICY,
    gateway: null,
    crown,
    haltSwitch,
    king,
    kingAuth,
    commandLedger: ledger,
    log,
  });
  const hsmSigner = await HsmSigner.open(signingToken(kingPair, options), 'kingSigning', {
    env: DEV_ENV,
  });
  const writer = new SovereignWriter({
    console: console_,
    signer: moduleSignerFromHsm(hsmSigner),
    env: DEV_ENV,
  });
  return {
    console: console_,
    writer,
    crown,
    king,
    kingPair,
    hsmSigner,
    log,
    logFile,
    sovereignSession: session.token,
    cleanup: () => {
      log.close?.();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * قراءةُ **ملفِّ** السجلِّ من القرصِ نصّاً — لا لقطةٌ من الذاكرة.
 * @param {string} logFile
 * @returns {ReadonlyArray<{ type: string }>}
 */
export function onDisk(logFile) {
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}
