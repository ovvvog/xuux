// اختبارُ قبولِ الخطوة M9.03: **الملكُ يُصدر أمراً من الواجهة ⇒ يُنفَّذ ⇒ يظهر
// في السجلِّ الدائم**. وثلاثةُ أشقٍّ لا شقٌّ واحد، وكلٌّ يفشل وحدَه إن انكسر:
//   ١. «يُصدر من الواجهة» — عبر `RoyalConsole.issue` بأمرٍ **معلَنٍ** في
//      `config/royal-console.yaml` وبتوقيعِ مفتاحِ الملكِ الحقيقيّ، لا بنداءٍ
//      مباشرٍ على `haltSwitch.halt()` أو `crown.veto.block()`.
//   ٢. «يُنفَّذ» — يُقاس بأثرِه في العالمِ لا بقيمةٍ مُعادة: توجيهُ الإيقافِ
//      الشاملِ يُقرأ من **القرصِ** بعده فيُرى `halted`، وحقُّ النقضِ يُقرأ من
//      البوابةِ فيُرى مغلقاً.
//   ٣. «يظهر في السجلِّ الدائم» — يُقاس بقراءةِ **ملفِّ** السجلِّ من القرصِ
//      نصّاً، لا بلقطةٍ من الذاكرة: `crown.command.accepted` يكتبه التاجُ،
//      و`console.command.executed` يكتبه الديوان. فلو كان السجلُّ ذاكريّاً لمرَّ
//      الاختبارُ وسقط الوعد.
//
// والمكوّناتُ **حقيقية**: `KingIdentity` بمفتاحٍ حقيقيٍّ يوقّع ويتحقّق،
// و`CrownGateway` بدفترِ أوامرَ دائمٍ وزرِّ إيقافٍ على القرص، و`HaltSwitch` يكتب
// توجيهَه ويقرأه من ملف، و`PersistentEventLog` بملفٍّ متسلسلٍ برأسٍ متسلسل،
// و`ApiGateway` حقيقيةٌ على نقطةِ تفويضٍ حقيقيةٍ ووكيلِ مراقبةٍ حقيقيٍّ لقياسِ
// أن قراءةَ الديوانِ تمرّ بطبقةٍ مُدقَّقة. فما يُقاس هنا حكمُ النظامِ لا حكمُ
// مزيَّفٍ صُنع ليوافق.
//
// **حدٌّ معلَن أول:** لا نقلَ شبكيّاً هنا ولا واجهةَ رسوميّة — الديوانُ نداءٌ
// داخليٌّ، وطبقةُ النقلِ (HTTP/TLS) دَينٌ معلَنٌ في `docs/ROYAL_CONSOLE.md`
// مملوكٌ للخطوة M10. فما يُقاس «الملكُ يُصدر من الديوان» لا «من متصفّح».
//
// **حدٌّ معلَن ثانٍ:** حقُّ النقضِ في `Veto` حالةٌ في الذاكرةِ لا توجيهٌ على
// القرص، فنقضٌ يقع ثم تُعاد العمليةُ يزول — وذاك حدُّ `Veto` نفسِه لا حدُّ
// الديوان، وهو معلَنٌ في الوثيقةِ ولم يُخفَ بإعادةِ تشغيلٍ لا يقيسها هذا الملف.
//
// **حدٌّ معلَن ثالث:** مستودعاتُ مشهدِ القراءةِ ذاكريةٌ لا PostgreSQL، وسجلُّ
// الهوياتِ قارئٌ يُرجِع صفّاً مصنوعاً؛ فما يُقاس هنا مرورُ القراءةِ بالطبقةِ
// المُدقَّقةِ وقيدُها، وسلامةُ الطبقةِ نفسِها مقيسةٌ في `tests/api`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ApiGateway, loadApiPolicy } from '../../src/api/index.mjs';
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

const CONFIG_DIR = path.join(process.cwd(), 'config');
const CONSOLE_POLICY = loadConsolePolicy({ dir: CONFIG_DIR });
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });

const AUDITOR = 'agent:console-auditor';

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
 * ديوانٌ على جذرِ ثقةٍ حقيقيٍّ في مجلدٍ مؤقّت.
 * @param {object} [options]
 * @param {boolean} [options.withLog]
 * @param {boolean} [options.withCrown]
 * @param {boolean} [options.withHalt]
 * @param {boolean} [options.withKing]
 * @param {boolean} [options.withGateway]
 * @param {{ call: (request: { route: string, token?: string, params?: Record<string, unknown> }) => Promise<{ route: string, policyId: string | null, session: string, data: unknown }> } | null} [options.gateway]
 */
function court(options = {}) {
  const {
    withLog = true,
    withCrown = true,
    withHalt = true,
    withKing = true,
    withGateway = true,
  } = options;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'royal-console-'));
  const logFile = path.join(directory, 'events.log');
  const log = new PersistentEventLog(logFile, { fsync: false });
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const ledger = new CommandLedger(path.join(directory, 'commands.ledger'), { fsync: false });
  const haltSwitch = new HaltSwitch(path.join(directory, 'halt.directive'), king, {
    log,
    fsync: false,
  });
  const crown = new CrownGateway(king, ca, log, { commandLedger: ledger, haltSwitch });
  const gateway =
    options.gateway !== undefined ? options.gateway : withGateway ? realGateway(log) : null;
  const console_ = new RoyalConsole({
    policy: CONSOLE_POLICY,
    gateway,
    crown: withCrown ? crown : null,
    haltSwitch: withHalt ? haltSwitch : null,
    king: withKing ? king : null,
    commandLedger: ledger,
    log: withLog ? log : null,
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
  return { console: console_, crown, haltSwitch, king, ledger, log, logFile, signed, cleanup };
}

/**
 * طبقةُ واجهةٍ حقيقيةٌ بنقطةِ تفويضٍ حقيقيةٍ ووكيلِ مراقبةٍ حقيقيّ.
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
  });
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
 * @param {string} logFile
 * @param {string} type
 * @returns {boolean}
 */
function loggedOnDisk(logFile, type) {
  return onDisk(logFile).some((entry) => entry.type === type);
}

test('الملكُ يُصدر أمراً من الديوان ⇒ يُنفَّذ ⇒ يظهر في السجلِّ الدائم — نصُّ قبولِ الخطوة', async () => {
  const { console: royal, haltSwitch, signed, logFile, cleanup } = court();
  try {
    const { royalCommand, signature } = signed('stop-state', 'state:sovereign', {
      reason: 'قياسُ قبولِ الخطوة M9.03',
    });
    const result = await royal.issue({ command: 'cmd:halt', royalCommand, signature });

    // (١) صدر من الديوان وقُبل بمسارِ التاجِ المُعلَن.
    assert.equal(result.status, 'executed');
    assert.equal(result.command, 'cmd:halt');
    assert.equal(result.action, 'stop-state');
    assert.equal(result.path, 'crown');
    assert.ok(
      Object.isFrozen(result),
      'المُعادُ غيرُ مجمَّد؛ فمن أخذه بدَّل شهادةَ التنفيذِ بعدها.',
    );

    // (٢) نُفِّذ فعلاً: التوجيهُ يُقرأ من **القرصِ** لا من ذاكرةِ الكائن.
    assert.equal(
      haltSwitch.read().state,
      'halted',
      'الأمرُ أُعلن منفَّذاً ولم يقع أثرُه على القرص؛ وتلك دعوى تنفيذٍ لا تنفيذ.',
    );

    // (٣) يظهر في السجلِّ الدائم: قيدُ القبولِ من التاجِ وقيدُ التنفيذِ من الديوان.
    assert.ok(
      loggedOnDisk(logFile, 'crown.command.accepted'),
      'قيدُ قبولِ التاجِ غائبٌ من ملفِّ السجل.',
    );
    const executed = onDisk(logFile).filter(
      (entry) => entry.type === CONSOLE_POLICY.audit.commandExecutedEvent,
    );
    assert.equal(executed.length, 1, 'قيدُ التنفيذِ ليس واحداً في ملفِّ السجل.');
    assert.equal(executed[0]?.data['commandId'], royalCommand.id);
    assert.equal(executed[0]?.data['command'], 'cmd:halt');
    // وترتيبُ القيدين نصٌّ على القرص: القبولُ قبل التنفيذ، فلا يُقرأ تنفيذٌ بلا
    // قبولٍ يسبقه ولو قُرئ الملفُّ بعد سنة.
    const types = onDisk(logFile).map((entry) => entry.type);
    assert.ok(
      types.indexOf('crown.command.accepted') <
        types.indexOf(CONSOLE_POLICY.audit.commandExecutedEvent),
      'قيدُ التنفيذِ سبق قيدَ القبولِ على القرص.',
    );
  } finally {
    cleanup();
  }
});

test('الإيقافُ الشاملُ يُرفع من الديوانِ بمسارِ التعافي، ولا يمرّ ببوابةٍ أوقفها هو', async () => {
  const { console: royal, haltSwitch, signed, logFile, cleanup } = court();
  try {
    const halt = signed('stop-state', 'state:sovereign', { reason: 'إيقافٌ للقياس' });
    await royal.issue({ command: 'cmd:halt', ...halt });
    assert.equal(haltSwitch.read().state, 'halted');

    // ولو سلك الاستئنافُ بوابةَ التاجِ لرُدَّ بـ`SOVEREIGN_HALT` لأن أولَ فحصٍ
    // فيها هو التوجيهُ نفسُه — فيصير الإيقافُ الشاملُ غيرَ قابلٍ للرفعِ من
    // الديوان. ومسارُ التعافي معلَنٌ لهذا السبب لا تسهيلاً.
    const resume = signed('resume-state', 'state:sovereign', { reason: 'استئنافٌ للقياس' });
    const result = await royal.issue({ command: 'cmd:resume', ...resume });
    assert.equal(result.status, 'executed');
    assert.equal(result.path, 'sovereign-recovery');
    assert.equal(haltSwitch.read().state, 'running', 'الاستئنافُ أُعلن ولم يقع على القرص.');

    const recovery = onDisk(logFile).filter(
      (entry) => entry.type === CONSOLE_POLICY.audit.recoveryEvent,
    );
    assert.equal(recovery.length, 1, 'قيدُ التعافي ليس واحداً في ملفِّ السجل.');
    assert.equal(
      recovery[0]?.data['via'],
      'sovereign-recovery',
      'التعافي لم يُسجَّل باسمِ مسارِه؛ فمن قرأ السجلَّ لا يرى أنّ أمراً تجاوز بوابةَ التاج.',
    );
  } finally {
    cleanup();
  }
});

test('حقُّ النقضِ يُغلق البوابةَ من الديوان، ويُرفع بمسارِ التعافي', async () => {
  const { console: royal, crown, signed, cleanup } = court();
  try {
    const veto = signed('veto-commands', 'crown:gateway', { reason: 'نقضٌ للقياس' });
    const blocked = await royal.issue({ command: 'cmd:veto', ...veto });
    assert.equal(blocked.effect['vetoed'], true);
    assert.equal(crown.veto.enabled, false, 'النقضُ أُعلن ولم يقع على البوابة.');
    assert.equal(royal.describe().authority.vetoed, true);

    // والبوابةُ الآن مغلقةٌ بالنقضِ نفسِه، فأمرٌ آخر على مسارِها يُرفض — وهذا
    // معنى النقض. ولو رُفع من مسارِها لكان نقضاً لا يُرفع.
    const another = signed('stop-state', 'state:sovereign', {});
    await refuses(
      () => royal.issue({ command: 'cmd:halt', ...another }),
      CONSOLE_ERRORS.COMMAND_REJECTED,
      'أمرٌ على بوابةٍ منقوضة',
    );

    const clear = signed('clear-veto', 'crown:gateway', {});
    const cleared = await royal.issue({ command: 'cmd:veto.clear', ...clear });
    assert.equal(cleared.effect['vetoed'], false);
    assert.equal(crown.veto.enabled, true, 'رفعُ النقضِ أُعلن ولم يقع.');
  } finally {
    cleanup();
  }
});

test('توقيعٌ مُختلَقٌ أو فعلٌ أو هدفٌ غيرُ ما وُقِّع عليه يُرد — وكلُّ رفضٍ يُسجَّل برمزِه', async () => {
  const { console: royal, king, signed, logFile, cleanup } = court();
  try {
    const forged = signed('stop-state', 'state:sovereign', {});
    await refuses(
      () =>
        royal.issue({
          command: 'cmd:halt',
          royalCommand: forged.royalCommand,
          signature: king.sign({ tampered: true }),
        }),
      CONSOLE_ERRORS.SIGNATURE_INVALID,
      'توقيعٌ لأمرٍ آخر',
    );

    // فعلٌ موقَّعٌ توقيعاً **صحيحاً** وليس فعلَ الأمرِ المُعلَن: انتحالٌ بتوقيعٍ
    // سليم، وهو أخطرُ من توقيعٍ مُختلَقٍ لأنه يمرّ بكلِّ فحصٍ تشفيريّ.
    const wrongAction = signed('resume-state', 'state:sovereign', {});
    await refuses(
      () => royal.issue({ command: 'cmd:halt', ...wrongAction }),
      CONSOLE_ERRORS.ACTION_MISMATCH,
      'فعلٌ غيرُ فعلِ الأمرِ المُعلَن',
    );

    const wrongTarget = signed('stop-state', 'crown:gateway', {});
    await refuses(
      () => royal.issue({ command: 'cmd:halt', ...wrongTarget }),
      CONSOLE_ERRORS.TARGET_MISMATCH,
      'هدفٌ غيرُ هدفِ الأمرِ المُعلَن',
    );

    await refuses(
      () =>
        royal.issue({ command: 'cmd:invented', ...signed('stop-state', 'state:sovereign', {}) }),
      CONSOLE_ERRORS.COMMAND_UNDECLARED,
      'أمرٌ يخترعه المُنادي',
    );

    const refusals = onDisk(logFile).filter(
      (entry) => entry.type === CONSOLE_POLICY.audit.commandRefusedEvent,
    );
    assert.equal(refusals.length, 4, 'ليس لكلِّ رفضٍ قيدٌ في السجلِّ الدائم.');
    const codes = refusals.map((entry) => entry.data['code']);
    assert.deepEqual(
      [...codes].sort(),
      [
        CONSOLE_ERRORS.ACTION_MISMATCH,
        CONSOLE_ERRORS.COMMAND_UNDECLARED,
        CONSOLE_ERRORS.SIGNATURE_INVALID,
        CONSOLE_ERRORS.TARGET_MISMATCH,
      ].sort(),
      'قيودُ الرفضِ لا تحمل رموزَها.',
    );
  } finally {
    cleanup();
  }
});

test('أمرٌ مستهلَكٌ لا يُعاد إصدارُه — على مسارِ التاجِ وعلى مسارِ التعافي معاً', async () => {
  const { console: royal, signed, cleanup } = court();
  try {
    const veto = signed('veto-commands', 'crown:gateway', {});
    await royal.issue({ command: 'cmd:veto', ...veto });
    // نفسُ الأمرِ بنفسِ معرّفِه: بوابةُ التاجِ تمنع الإعادةَ بدفترِها الدائم.
    // (والنقضُ قائمٌ الآن، فالرفضُ الأولُ هو النقضُ لا الإعادة — فيُرفع أولاً.)
    const clear = signed('clear-veto', 'crown:gateway', {});
    await royal.issue({ command: 'cmd:veto.clear', ...clear });
    await refuses(
      () => royal.issue({ command: 'cmd:veto', ...veto }),
      CONSOLE_ERRORS.REPLAYED_COMMAND,
      'إعادةُ أمرٍ على مسارِ التاج',
    );
    // وعلى مسارِ التعافي: المنعُ في الديوانِ نفسِه بدفترِه الدائمِ وبذاكرتِه.
    await refuses(
      () => royal.issue({ command: 'cmd:veto.clear', ...clear }),
      CONSOLE_ERRORS.REPLAYED_COMMAND,
      'إعادةُ أمرٍ على مسارِ التعافي',
    );
  } finally {
    cleanup();
  }
});

test('الفشلُ مغلق (المادة 9): كلُّ وصلةٍ ناقصةٍ رفضٌ مُسمّى لا سماحٌ صامت', async () => {
  const bare = court({ withLog: false });
  try {
    await refuses(
      () => bare.console.issue({ command: 'cmd:halt', ...bare.signed('stop-state', 'x') }),
      CONSOLE_ERRORS.AUDIT_REQUIRED,
      'ديوانٌ بلا سجلٍّ دائم',
    );
    await refuses(
      () => bare.console.view({ view: 'view:agents' }),
      CONSOLE_ERRORS.AUDIT_REQUIRED,
      'قراءةٌ بلا سجلٍّ دائم',
    );
  } finally {
    bare.cleanup();
  }

  const noCrown = court({ withCrown: false });
  try {
    await refuses(
      () =>
        noCrown.console.issue({
          command: 'cmd:halt',
          ...noCrown.signed('stop-state', 'state:sovereign'),
        }),
      CONSOLE_ERRORS.CROWN_REQUIRED,
      'أمرٌ بلا بوابةِ تاجٍ تتحقّق منه',
    );
  } finally {
    noCrown.cleanup();
  }

  const noHalt = court({ withHalt: false });
  try {
    // بوابةُ التاجِ قبلته (توقيعُه صحيح) وثبَّتته، ثم ردَّه أثرُه لغيابِ زرِّ
    // الإيقاف؛ والرمزُ يُميّز «قُبل ولم يُنفَّذ» ولا يُمحى قيدُ قبولِه.
    await refuses(
      () =>
        noHalt.console.issue({
          command: 'cmd:halt',
          ...noHalt.signed('stop-state', 'state:sovereign'),
        }),
      CONSOLE_ERRORS.EFFECT_REFUSED,
      'إيقافٌ بلا زرِّ إيقاف',
    );
    const refusal = onDisk(noHalt.logFile).find(
      (entry) => entry.type === CONSOLE_POLICY.audit.commandRefusedEvent,
    );
    assert.equal(
      /** @type {Record<string, unknown>} */ (refusal?.data['detail'])?.['effectCode'],
      CONSOLE_ERRORS.HALT_REQUIRED,
      'رمزُ سببِ ردِّ الأثرِ (CONSOLE_HALT_REQUIRED) لم يُحفَظ في تفصيلِ الرفض.',
    );
    assert.ok(
      loggedOnDisk(noHalt.logFile, 'crown.command.accepted'),
      'قيدُ القبولِ مُحي بعد فشلِ الأثر؛ والقيدُ يبقى شاهداً على قبولٍ بلا تنفيذ.',
    );
  } finally {
    noHalt.cleanup();
  }

  const noKing = court({ withKing: false });
  try {
    await refuses(
      () =>
        noKing.console.issue({
          command: 'cmd:veto.clear',
          ...noKing.signed('clear-veto', 'crown:gateway'),
        }),
      CONSOLE_ERRORS.KING_REQUIRED,
      'تعافٍ بلا هويةِ ملكٍ تتحقّق من توقيعِه',
    );
  } finally {
    noKing.cleanup();
  }

  const noGateway = court({ gateway: null });
  try {
    await refuses(
      () => noGateway.console.view({ view: 'view:agents' }),
      CONSOLE_ERRORS.GATEWAY_REQUIRED,
      'قراءةٌ بلا طبقةِ واجهة',
    );
  } finally {
    noGateway.cleanup();
  }
});

test('قراءةُ الديوانِ عبر طبقةِ الواجهةِ وحدَها: مشهدٌ معلَنٌ يُقرأ ويُسجَّل، وغيرُه يُرد', async () => {
  const { console: royal, log, logFile, cleanup } = court();
  try {
    await refuses(
      () => royal.view({ view: 'view:invented' }),
      CONSOLE_ERRORS.VIEW_UNDECLARED,
      'مشهدٌ يخترعه المُنادي',
    );

    // ورفضُ الطبقةِ يُغلَّف برمزِ الديوانِ ولا يُسرَّب رمزُها خارجَ كتالوجِه:
    // نداءٌ بلا رمزِ جلسةٍ تردّه الطبقةُ، ويقرأ الديوانُ ذلك رفضَ مشهدٍ.
    await refuses(
      () => royal.view({ view: 'view:agents' }),
      CONSOLE_ERRORS.VIEW_REFUSED,
      'مشهدٌ ردَّته الطبقةُ لانعدامِ الجلسة',
    );

    const view = CONSOLE_POLICY.views[0];
    assert.ok(view !== undefined);
    const gateway = /** @type {ApiGateway} */ (
      /** @type {unknown} */ (realGateway(/** @type {never} */ (log)))
    );
    const session = await gateway.openSession({ actorId: AUDITOR });
    const opened = new RoyalConsole({ policy: CONSOLE_POLICY, gateway, log });
    const read = await opened.view({ view: view.id, token: session.token });
    assert.equal(read.view, view.id);
    assert.equal(read.route, view.route);
    assert.ok(Object.isFrozen(read), 'مُعادُ القراءةِ غيرُ مجمَّد.');
    assert.ok(
      onDisk(logFile).some(
        (entry) => entry.type === CONSOLE_POLICY.audit.viewEvent && entry.data['view'] === view.id,
      ),
      'القراءةُ وقعت ولم تُسجَّل في السجلِّ الدائم.',
    );
  } finally {
    cleanup();
  }
});

test('الديوانُ يوصف بياناتٍ مجمَّدةً لا مِقبضاً على ما تحته', async () => {
  const { console: royal, haltSwitch, signed, cleanup } = court();
  try {
    const described = royal.describe();
    assert.ok(Object.isFrozen(described));
    assert.ok(Object.isFrozen(described.views));
    assert.ok(Object.isFrozen(described.commands));
    assert.ok(Object.isFrozen(described.authority));
    assert.equal(described.views.length, CONSOLE_POLICY.views.length);
    assert.equal(described.commands.length, CONSOLE_POLICY.commands.length);
    assert.equal(described.authority.halt?.state, 'running');

    // وحالةُ الإيقافِ تُقرأ في كلِّ نداءٍ من القرصِ لا من ذاكرةٍ مؤقّتة: عمليةٌ
    // أخرى قد أوقفت الدولةَ قبل جزءٍ من الثانية.
    await royal.issue({ command: 'cmd:halt', ...signed('stop-state', 'state:sovereign') });
    assert.equal(royal.describe().authority.halt?.state, 'halted');
    assert.equal(haltSwitch.read().state, 'halted');

    // ولا مِقبضَ: من أخذ الوصفَ لا يأخذ معه بوابةَ التاجِ ولا زرَّ الإيقاف.
    assert.equal(
      Object.keys(described).sort().join(','),
      ['authority', 'commands', 'views'].join(','),
      'الوصفُ يُصدِّر أكثرَ من بياناتٍ تُقرأ.',
    );
  } finally {
    cleanup();
  }
});
