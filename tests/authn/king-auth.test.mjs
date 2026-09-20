// اختبارُ قبولِ الخطوة M9.04: **لا أمرَ سياديٌّ إلا من جلسةٍ قويةٍ فُتحت بعاملٍ
// ثانٍ على جهازٍ موثوق**. وثلاثةُ أشقٍّ لا شقٌّ واحد، وكلٌّ يفشل وحدَه إن انكسر:
//   ١. «جلسةُ القراءةِ لا تكفي» — رمزُ جلسةٍ **حقيقيٍّ** يُفتح من طبقةِ الواجهةِ
//      (`ApiGateway.openSession`) يُقدَّم للديوانِ كجلسةٍ سيادية، فيُرَد بـ
//      `CONSOLE_AUTHENTICATION_REQUIRED`. ولو مرَّ لكان العاملُ الثاني زخرفةً.
//   ٢. «بلا عاملٍ ثانٍ لا جلسة» — `authenticate` بلا رمزِ عاملٍ يُرَد بـ
//      `AUTHN_FACTOR_REQUIRED`، ومفتاحُ الملكِ وحدَه لا يفتح شيئاً.
//   ٣. «وبها يُنفَّذ ويُسجَّل» — جلسةٌ قويةٌ صحيحةٌ ⇒ أمرُ الإيقافِ الشاملِ يقع
//      أثرُه على **القرصِ** ويظهر `authn.session.opened` في **ملفِّ** السجل.
//
// والمكوّناتُ **حقيقية**: `KingIdentity` بمفتاحٍ حقيقيّ، و`CrownGateway` بدفترٍ
// دائم، و`HaltSwitch` يكتب توجيهَه على القرصِ ويقرأه منه، و`PersistentEventLog`
// ملفٌّ متسلسلٌ يُقرأ نصّاً بعد الحدث، و`ApiGateway` حقيقيةٌ على نقطةِ تفويضٍ
// حقيقية. ورمزُ العاملِ يُحسب بـ`factorCodeForStep` — التابعِ الذي تقابله
// المصادقةُ نفسُه — لا بتزييفٍ صُنع ليوافق. وأسرارُ العواملِ تُولَّد في زمنِ
// التشغيلِ بـ`randomBytes`، فلا سرَّ في هذا الملفِّ نصّاً.
//
// **حدٌّ معلَن أول:** الجلساتُ واستهلاكُ العواملِ في ذاكرةِ العملية (حدٌّ معلَنٌ
// في `src/authn/king-auth.mjs` و`docs/KING_AUTHENTICATION.md`)، فلا يقيس هذا
// الملفُّ بقاءَ جلسةٍ بعد إعادةِ تشغيلٍ ولا يدَّعيه.
//
// **حدٌّ معلَن ثانٍ:** لا طبقةَ نقلٍ هنا ولا متصفّح — المصادقةُ نداءٌ داخليّ،
// فما يُقاس «عاملٌ ثانٍ يُشترَط ويُتحقَّق منه» لا «شاشةُ إدخالِ رمز».

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
import {
  AUTHN_ERRORS,
  AuthnError,
  KingAuthenticator,
  factorCodeForStep,
  loadKingAuthPolicy,
} from '../../src/authn/index.mjs';
import { CONSOLE_ERRORS, RoyalConsole, loadConsolePolicy } from '../../src/console/index.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../src/observability/index.mjs';
import { createMemoryRepositories } from '../../src/persistence/composition.mjs';
import {
  CertificateAuthority,
  CommandLedger,
  CrownGateway,
  HaltSwitch,
  KingIdentity,
  PersistentEventLog,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';
import { enforcementPointFor } from '../helpers/authorization.mjs';

const ROOT = process.cwd();
const CONFIG_DIR = path.join(ROOT, 'config');
const AUTHN_POLICY = loadKingAuthPolicy({ dir: CONFIG_DIR });
const CONSOLE_POLICY = loadConsolePolicy({ dir: CONFIG_DIR });
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });

const AUDITOR = 'agent:console-auditor';

const TRUSTED_DEVICE = (() => {
  const device = AUTHN_POLICY.devices.find((entry) => entry.state === 'trusted');
  if (device === undefined) {
    throw new Error('وثيقةُ المصادقةِ بلا جهازٍ موثوق؛ فلا جلسةَ قويةً تُفتح ولا شيءَ يُقاس.');
  }
  return device;
})();

/**
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(/** @type {{ code: unknown }} */ (error).code)
    : `بلا رمز: ${String(error)}`;
}

/**
 * @param {() => unknown | Promise<unknown>} work
 * @param {string} expected
 * @param {string} what
 */
async function refuses(work, expected, what) {
  try {
    await work();
    assert.fail(`${what}: مرّ ولم يُرفض — والمرورُ هنا هو العيبُ نفسُه.`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.equal(codeOf(error), expected, `${what}: رُفض برمزٍ آخر`);
  }
}

/**
 * قراءةُ **ملفِّ** السجلِّ من القرص — لا لقطةٌ من الذاكرة.
 * @param {string} logFile
 * @returns {ReadonlyArray<{ type: string, actor: string, data: Record<string, unknown> }>}
 */
function onDisk(logFile) {
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/**
 * تركيبٌ حقيقيٌّ في مجلدٍ مؤقّت: جذرُ ثقةٍ وديوانٌ ومصادقةٌ قويةٌ وسرُّ عاملٍ
 * مولَّدٌ في زمنِ التشغيل.
 * @param {object} [options]
 * @param {KingAuthPolicyLike} [options.policy]
 * @param {boolean} [options.withLog]
 * @param {boolean} [options.withSecrets]
 * @param {boolean} [options.withKingAuth]
 * @param {(() => number) | undefined} [options.nowMs]
 */
function realm(options = {}) {
  const {
    policy = AUTHN_POLICY,
    withLog = true,
    withSecrets = true,
    withKingAuth = true,
    nowMs,
  } = options;
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'king-auth-')));
  const logFile = path.join(directory, 'events.log');
  const log = new PersistentEventLog(logFile, { fsync: false });
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const ledger = new CommandLedger(path.join(directory, 'commands.ledger'), { fsync: false });
  const haltSwitch = new HaltSwitch(path.join(directory, 'halt.directive'), king, {
    log,
    fsync: false,
    // R5-B-07: مُحقِّقُ الأمرِ الملكيِّ — لا يُوقفُ ولا يُستأنفُ إلّا بأمرٍ
    // قُبل وثُبِّتَ في دفترِ الأوامرِ (التوقيعُ فُحِصَ عندَ القبول).
    royalCommandVerifier: (command) => ledger.has(String(command.id)),
  });
  const crown = new CrownGateway(king, ca, log, { commandLedger: ledger, haltSwitch });
  const factorSecret = randomBytes(32).toString('hex');
  /** @type {Record<string, string>} */
  const vault = {};
  for (const device of policy.devices) vault[device.factorRef] = factorSecret;
  const kingAuth = new KingAuthenticator({
    policy: /** @type {never} */ (policy),
    king,
    log: withLog ? log : null,
    factorSecrets: withSecrets
      ? {
          /** @param {string} name */
          read: (name) => vault[name] ?? null,
        }
      : null,
    ...(nowMs === undefined ? {} : { nowMs }),
  });
  const console_ = new RoyalConsole({
    policy: CONSOLE_POLICY,
    gateway: realGateway(log),
    crown,
    haltSwitch,
    king,
    kingAuth: withKingAuth ? kingAuth : null,
    commandLedger: ledger,
    log,
  });
  /**
   * رمزُ العاملِ للخطوةِ الحاضرةِ — يُحسب بالتابعِ نفسِه الذي تقابله المصادقة.
   * @param {number} [deltaSteps]
   * @param {number} [atMs]
   * @returns {string}
   */
  const factorCode = (deltaSteps = 0, atMs = nowMs === undefined ? Date.now() : nowMs()) => {
    const { stepSeconds, digits, algorithm } = policy.secondFactor;
    return factorCodeForStep({
      secret: factorSecret,
      step: Math.floor(atMs / 1000 / stepSeconds) + deltaSteps,
      digits,
      algorithm,
    });
  };
  /**
   * @param {object} [request]
   * @param {string} [request.deviceId]
   * @param {string} [request.actorId]
   * @param {string} [request.factorCode]
   */
  const authenticate = (request = {}) =>
    kingAuth.authenticate({
      actorId: request.actorId ?? king.id,
      deviceId: request.deviceId ?? TRUSTED_DEVICE.id,
      ...(request.factorCode === undefined ? { factorCode: factorCode() } : {}),
      ...(request.factorCode === undefined ? {} : { factorCode: request.factorCode }),
    });
  /** @param {string} action @param {string} target @param {Record<string, unknown>} [payload] */
  const signed = (action, target, payload = {}) => {
    const royal = createRoyalCommand(action, target, payload);
    return {
      royalCommand: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (royal)),
      signature: king.sign(royal),
    };
  };
  const cleanup = () => {
    log.close?.();
    fs.rmSync(directory, { recursive: true, force: true });
  };
  return {
    console: console_,
    kingAuth,
    king,
    crown,
    haltSwitch,
    log,
    logFile,
    factorCode,
    authenticate,
    signed,
    cleanup,
  };
}

/**
 * @typedef {import('../../src/authn/king-auth.mjs').KingAuthPolicy} KingAuthPolicyLike
 */

/**
 * طبقةُ واجهةٍ حقيقيةٌ — منها يُفتح رمزُ جلسةِ **قراءةٍ** حقيقيٌّ لا مُختلَق.
 * @param {PersistentEventLog} log
 */
function realGateway(log) {
  const repositories = createMemoryRepositories();
  const identity = {
    id: AUDITOR,
    kind: 'service',
    state: 'active',
    role: MONITORING_POLICY.role,
    capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
  };
  const agents = {
    /** @param {string} id */
    get: async (id) => (id === AUDITOR ? identity : null),
  };
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  return new ApiGateway({
    policy: API_POLICY,
    log: /** @type {never} */ (log),
    agents: /** @type {never} */ (agents),
    monitor,
    enforcementPoint: enforcementPointFor(/** @type {never} */ (log)),
    requirePoP: false, // اختباراتٌ بلا إثباتِ حيازةٍ
  });
}

test('نصُّ قبولِ الخطوة M9.04: جلسةُ القراءةِ تُرَد، وبلا عاملٍ ثانٍ لا جلسة، وبالجلسةِ القويةِ يُنفَّذ ويُسجَّل', async () => {
  const {
    console: royal,
    kingAuth,
    king,
    log,
    haltSwitch,
    signed,
    logFile,
    authenticate,
    cleanup,
  } = realm();
  try {
    // (١) رمزُ جلسةِ قراءةٍ **حقيقيٌّ** من طبقةِ الواجهةِ يُقدَّم كجلسةٍ سيادية.
    const reader = await realGateway(log).openSession({ actorId: AUDITOR });
    await refuses(
      () =>
        royal.issue({
          sovereignSession: reader.token,
          command: 'cmd:halt',
          ...signed('stop-state', 'state:sovereign'),
        }),
      CONSOLE_ERRORS.AUTHENTICATION_REQUIRED,
      'أمرٌ سياديٌّ برمزِ جلسةِ قراءة',
    );
    assert.equal(
      haltSwitch.read().state,
      'running',
      'الأمرُ رُدَّ ووقع أثرُه؛ ورفضٌ يقع أثرُه ليس رفضاً.',
    );

    // (٢) بلا عاملٍ ثانٍ لا جلسة — ومفتاحُ الملكِ حاضرٌ وصحيحٌ في هذا النداء.
    await refuses(
      () => authenticate({ factorCode: '' }),
      AUTHN_ERRORS.FACTOR_REQUIRED,
      'مصادقةٌ بلا عاملٍ ثانٍ',
    );

    // (٣) جلسةٌ قويةٌ صحيحةٌ ⇒ الأمرُ يُنفَّذ ويقع أثرُه على القرص.
    const session = await authenticate();
    assert.equal(session.actorId, king.id, 'الجلسةُ فُتحت لغيرِ الملك.');
    assert.equal(session.deviceId, TRUSTED_DEVICE.id);
    assert.ok(session.token.length >= 32, 'رمزُ الجلسةِ أقصرُ من إعلانِ الوثيقة.');
    assert.equal(kingAuth.size, 1, 'الجلسةُ فُتحت ولا تُحسب في المصادقة.');

    const result = await royal.issue({
      sovereignSession: session.token,
      command: 'cmd:halt',
      ...signed('stop-state', 'state:sovereign', { reason: 'قياسُ قبولِ الخطوة M9.04' }),
    });
    assert.equal(result.status, 'executed');
    assert.equal(
      haltSwitch.read().state,
      'halted',
      'الأمرُ أُعلن منفَّذاً ولم يقع أثرُه على القرص؛ وتلك دعوى تنفيذٍ لا تنفيذ.',
    );

    // والقيدُ في **ملفِّ** السجل: فتحُ الجلسةِ واستهلاكُ العاملِ ثم تنفيذُ الأمر.
    const types = onDisk(logFile).map((entry) => entry.type);
    assert.ok(types.includes('authn.session.opened'), 'قيدُ فتحِ الجلسةِ غائبٌ من ملفِّ السجل.');
    assert.ok(
      types.includes(AUTHN_POLICY.audit.factorConsumedEvent),
      'قيدُ استهلاكِ العاملِ غائبٌ من ملفِّ السجل.',
    );
    assert.ok(
      types.indexOf('authn.session.opened') <
        types.indexOf(CONSOLE_POLICY.audit.commandExecutedEvent),
      'قيدُ التنفيذِ سبق قيدَ فتحِ الجلسةِ على القرص.',
    );

    // ولا سرَّ ولا رمزَ في السجل: من سرق الملفَّ لم يسرق سلطةً.
    const text = fs.readFileSync(logFile, 'utf8');
    assert.ok(!text.includes(session.token), 'رمزُ الجلسةِ مكتوبٌ في السجلِّ نصّاً.');
    assert.ok(!/"factorCode"|"material"|"secret"/.test(text), 'السجلُّ يحمل سرّاً أو رمزَ عامل.');
  } finally {
    cleanup();
  }
});

test('كتالوجُ الرموزِ نصٌّ مُعلَنٌ لا اصطلاحٌ في الذاكرة — وكلُّه في وثيقةِ المصادقة', () => {
  assert.equal(AUTHN_ERRORS.AUDIT_REQUIRED, 'AUTHN_AUDIT_REQUIRED');
  assert.equal(AUTHN_ERRORS.IDENTITY_UNVERIFIED, 'AUTHN_IDENTITY_UNVERIFIED');
  assert.equal(AUTHN_ERRORS.DEVICE_UNKNOWN, 'AUTHN_DEVICE_UNKNOWN');
  assert.equal(AUTHN_ERRORS.DEVICE_REVOKED, 'AUTHN_DEVICE_REVOKED');
  assert.equal(AUTHN_ERRORS.FACTOR_REQUIRED, 'AUTHN_FACTOR_REQUIRED');
  assert.equal(AUTHN_ERRORS.FACTOR_INVALID, 'AUTHN_FACTOR_INVALID');
  assert.equal(AUTHN_ERRORS.FACTOR_REPLAYED, 'AUTHN_FACTOR_REPLAYED');
  assert.equal(AUTHN_ERRORS.SECRET_MISSING, 'AUTHN_SECRET_MISSING');
  assert.equal(AUTHN_ERRORS.SESSION_EXPIRED, 'AUTHN_SESSION_EXPIRED');
  assert.equal(CONSOLE_ERRORS.AUTHENTICATION_REQUIRED, 'CONSOLE_AUTHENTICATION_REQUIRED');
  for (const code of Object.values(AUTHN_ERRORS)) {
    assert.ok(
      AUTHN_POLICY.refusalCodes.includes(code),
      `الرمز ${code} يرفعه الكودُ ولا إعلانَ له في وثيقةِ المصادقة.`,
    );
  }
  assert.equal(AUTHN_POLICY.audit.refusedEvent, 'authn.refused');
  assert.equal(AUTHN_POLICY.audit.sessionOpenedEvent, 'authn.session.opened');
});

test('الجهازُ بياناتٌ في الوثيقة: مجهولٌ يُرَد، ومسحوبُ الثقةِ يُرَد باسمِه لا مجهولاً', async () => {
  const { authenticate, logFile, cleanup } = realm();
  try {
    await refuses(
      () => authenticate({ deviceId: 'device:king-phone-invented' }),
      AUTHN_ERRORS.DEVICE_UNKNOWN,
      'جهازٌ يخترعه المُنادي',
    );
    const refusal = onDisk(logFile).find((entry) => entry.type === 'authn.refused');
    assert.equal(
      refusal?.data['code'],
      AUTHN_ERRORS.DEVICE_UNKNOWN,
      'الرفضُ لم يُسجَّل برمزِه في السجلِّ الدائم.',
    );
  } finally {
    cleanup();
  }

  // ووثيقةٌ فيها جهازٌ مسحوبةٌ ثقتُه: نسخةٌ مؤقّتةٌ من الوثيقةِ نفسِها لا وثيقةٌ
  // مصنوعةٌ بيدٍ، فما يُقاس قراءةُ الحالةِ من النصِّ لا شرطٌ في الكود.
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'king-auth-config-')));
  try {
    fs.mkdirSync(path.join(directory, 'schemas'), { recursive: true });
    fs.copyFileSync(
      path.join(CONFIG_DIR, 'schemas', 'king-authentication.schema.json'),
      path.join(directory, 'schemas', 'king-authentication.schema.json'),
    );
    const source = fs.readFileSync(path.join(CONFIG_DIR, 'king-authentication.yaml'), 'utf8');
    const revokedId = 'device:king-console-retired';
    fs.writeFileSync(
      path.join(directory, 'king-authentication.yaml'),
      source.replace(
        /^devices:\n/m,
        [
          'devices:',
          `  - id: ${revokedId}`,
          '    purpose: جهازٌ سُحبت ثقتُه بقرارٍ — يُقاس رفضُه باسمِه.',
          '    state: revoked',
          '    factorRef: KING_FACTOR_CONSOLE_RETIRED',
          '',
        ].join('\n'),
      ),
      'utf8',
    );
    const policy = loadKingAuthPolicy({ dir: directory });
    const revoked = realm({ policy });
    try {
      await refuses(
        () => revoked.authenticate({ deviceId: revokedId }),
        AUTHN_ERRORS.DEVICE_REVOKED,
        'جهازٌ مسحوبةٌ ثقتُه في الوثيقة',
      );
      const refusal = onDisk(revoked.logFile).find((entry) => entry.type === 'authn.refused');
      assert.equal(
        refusal?.data['device'],
        revokedId,
        'قيدُ الرفضِ لا يحمل اسمَ الجهازِ المسحوب؛ فمن قرأه في تحقيقٍ لا يعرف أيَّ جهازٍ حاول.',
      );
    } finally {
      revoked.cleanup();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('العاملُ الثاني: شكلٌ خاطئٌ ورمزٌ خاطئٌ يُرَدّان، ورمزٌ استُهلك لا يفتح جلسةً ثانية', async () => {
  const { authenticate, factorCode, cleanup } = realm();
  try {
    await refuses(
      () => authenticate({ factorCode: 'رمزٌ لا أرقام' }),
      AUTHN_ERRORS.FACTOR_INVALID,
      'رمزٌ ليس على شكلِ الرمز',
    );
    await refuses(
      () => authenticate({ factorCode: '00000000'.slice(0, AUTHN_POLICY.secondFactor.digits) }),
      AUTHN_ERRORS.FACTOR_INVALID,
      'رمزٌ على الشكلِ ولا يطابق خطوةً',
    );
    // ورمزُ خطوةٍ خارجَ مدى الانزياحِ المقبول: صحيحُ الحسابِ ومرفوضُ الزمن.
    await refuses(
      () =>
        authenticate({ factorCode: factorCode(AUTHN_POLICY.secondFactor.acceptedSkewSteps + 5) }),
      AUTHN_ERRORS.FACTOR_INVALID,
      'رمزُ خطوةٍ خارجَ نافذةِ القبول',
    );

    const code = factorCode();
    const first = await authenticate({ factorCode: code });
    assert.ok(first.token !== '');
    await refuses(
      () => authenticate({ factorCode: code }),
      AUTHN_ERRORS.FACTOR_REPLAYED,
      'رمزُ عاملٍ استُهلك مرّةً',
    );
  } finally {
    cleanup();
  }
});

test('الفشلُ مغلق (المادة 9): بلا سجلٍّ ولا مزوِّدِ أسرارٍ ولا هويةِ ملكٍ لا مصادقة', async () => {
  const noLog = realm({ withLog: false });
  try {
    await refuses(
      () => noLog.authenticate(),
      AUTHN_ERRORS.AUDIT_REQUIRED,
      'مصادقةٌ بلا سجلٍّ دائمٍ تُشهَد فيه',
    );
  } finally {
    noLog.cleanup();
  }

  const noSecrets = realm({ withSecrets: false });
  try {
    await refuses(
      () => noSecrets.authenticate({ factorCode: '12345678'.slice(0, 8) }),
      AUTHN_ERRORS.SECRET_MISSING,
      'مصادقةٌ بلا مزوِّدِ أسرارٍ يُقرأ منه سرُّ الجهاز',
    );
  } finally {
    noSecrets.cleanup();
  }

  const { authenticate, cleanup } = realm();
  try {
    await refuses(
      () => authenticate({ actorId: 'agent:minister' }),
      AUTHN_ERRORS.IDENTITY_UNVERIFIED,
      'جلسةٌ قويةٌ لغيرِ الملك',
    );
  } finally {
    cleanup();
  }

  // وديوانٌ بلا مصادقةٍ موصولةٍ يُرَد ولا يُسمح صامتاً: غيابُ الوصلةِ رفض.
  const noAuth = realm({ withKingAuth: false });
  try {
    await refuses(
      () =>
        noAuth.console.issue({
          sovereignSession: 'رمزٌ أيُّ رمز',
          command: 'cmd:halt',
          ...noAuth.signed('stop-state', 'state:sovereign'),
        }),
      CONSOLE_ERRORS.AUTHENTICATION_REQUIRED,
      'أمرٌ سياديٌّ في ديوانٍ بلا مصادقةٍ قوية',
    );
    assert.equal(
      noAuth.haltSwitch.read().state,
      'running',
      'الديوانُ بلا مصادقةٍ نفَّذ الأمرَ؛ وذاك سماحٌ صامتٌ لا فشلٌ مغلق.',
    );
  } finally {
    noAuth.cleanup();
  }
});

test('الجلسةُ قصيرةٌ ولا تُمدَّد بالعملِ عليها، وتُغلَق صراحةً فلا تُقبل بعدها', async () => {
  let clock = Date.UTC(2026, 0, 1, 12, 0, 0);
  const nowMs = () => clock;
  const { kingAuth, authenticate, cleanup } = realm({ nowMs });
  try {
    const session = await authenticate();
    const { ttlSeconds } = AUTHN_POLICY.session;
    assert.equal(kingAuth.resolve(session.token).deviceId, TRUSTED_DEVICE.id);

    // عملٌ متكرّرٌ داخلَ المهلةِ لا يمدُّها: المهلةُ من لحظةِ الفتح.
    clock += (ttlSeconds - 1) * 1000;
    assert.equal(kingAuth.resolve(session.token).sessionRef, session.sessionRef);
    clock += 2000;
    await refuses(
      () => kingAuth.requireForCommand(session.token, 'halt'),
      AUTHN_ERRORS.SESSION_EXPIRED,
      'جلسةٌ انقضت مهلتُها',
    );
    assert.equal(kingAuth.size, 0, 'الجلسةُ المنتهيةُ ما زالت محفوظةً في الذاكرة.');

    // وإغلاقٌ صريحٌ: جلسةٌ ثانيةٌ تُغلَق فتُرَدّ بعدها ولا تُنتظر مهلتُها.
    clock += 60_000;
    const second = await authenticate({ factorCode: undefined });
    assert.equal(kingAuth.close(second.token), true);
    assert.equal(kingAuth.close(second.token), false, 'إغلاقُ ما أُغلق يُعلن نجاحاً كاذباً.');
    await refuses(
      () => kingAuth.requireForCommand(second.token, 'halt'),
      AUTHN_ERRORS.SESSION_INVALID,
      'جلسةٌ أُغلقت صراحةً',
    );
  } finally {
    cleanup();
  }
});

test('الاشتراطُ بياناتٌ في الوثيقةِ لا شرطٌ في الكود، ورمزٌ مجهولٌ يُرَدّ', async () => {
  const { kingAuth, cleanup } = realm();
  try {
    for (const kind of AUTHN_POLICY.assurance.requiredForCommandKinds) {
      await refuses(
        () => kingAuth.requireForCommand(undefined, kind),
        AUTHN_ERRORS.ASSURANCE_INSUFFICIENT,
        `نوعُ الأمر «${kind}» بلا جلسةٍ قوية`,
      );
    }
    await refuses(
      () => kingAuth.requireForCommand('رمزٌ لا تعرفه المصادقة', 'halt'),
      AUTHN_ERRORS.SESSION_INVALID,
      'رمزُ جلسةٍ مجهول',
    );
    assert.ok(
      new AuthnError(AUTHN_ERRORS.SESSION_INVALID, 'رفضٌ برمزٍ') instanceof Error,
      'خطأُ المصادقةِ ليس خطأً يُلقى ويُقبض.',
    );
  } finally {
    cleanup();
  }
});

test('حاجزُ `scripts/guard-king-auth.mjs` يمرّ على المستودعِ ويرفض تركيباً مكسوراً', () => {
  const pass = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'guard-king-auth.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(pass, /✅/, 'الحاجزُ لا يمرّ على المستودعِ نفسِه؛ فالمقياسُ مكسورٌ أو الكودُ كذلك.');

  // ونسخةٌ مكسورةٌ بيدٍ: يُحذف اشتراطُ الجلسةِ من الديوان، فيجب أن يرفض الحاجزُ
  // برمزِ خروجٍ غيرِ صفر. ولو مرَّ لكان حاجزاً يُطمئن ولا يمنع.
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'king-auth-guard-')));
  try {
    for (const entry of ['config', 'src', 'scripts', 'tests', 'package.json', '.github']) {
      fs.cpSync(path.join(ROOT, entry), path.join(directory, entry), { recursive: true });
    }
    const consoleFile = path.join(directory, 'src', 'console', 'royal-console.mjs');
    const broken = fs
      .readFileSync(consoleFile, 'utf8')
      .replace(
        'kingAuth.requireForCommand(request.sovereignSession',
        'void (request.sovereignSession',
      );
    fs.writeFileSync(consoleFile, broken, 'utf8');
    let exitCode = 0;
    let output = '';
    try {
      output = execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'guard-king-auth.mjs'), '--root', directory],
        { cwd: ROOT, encoding: 'utf8' },
      );
    } catch (error) {
      const failure = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (error);
      exitCode = failure.status ?? -1;
      output = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`;
    }
    assert.equal(exitCode, 1, 'الحاجزُ مرَّ على ديوانٍ لا يشترط جلسةً قويةً؛ وذاك حاجزٌ لا يحجز.');
    assert.match(output, /R6/, 'الحاجزُ رفض ولم يُسمِّ القاعدةَ التي انكسرت.');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
