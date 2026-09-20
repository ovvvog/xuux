/**
 * الديوانُ الملكيُّ — الخطوة `M9.03`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** كانت السلطةُ الملكيةُ موجودةً ولا
 * مُمارَسة. بوابةُ التاج (`CrownGateway`) تقبل أمراً موقَّعاً، وزرُّ الإيقافِ
 * الشاملِ (`HaltSwitch`) يكتب توجيهاً دائماً، وحقُّ النقضِ مكتوبٌ في `Veto` —
 * ولا موضعَ واحدٌ يرى فيه الملكُ الحالةَ ويُصدر أمراً ويقرأ أثرَه في السجلِّ
 * الدائم. فكان كلُّ ذلك يُنادى من داخلِ الكودِ بيدِ كاتبِه: من كتب سطراً نادى
 * `crown.stop()` أو `veto.block()` بلا أمرٍ ولا توقيعٍ ولا قيد. وبعد `M9.02`
 * صار للدولةِ مسارُ قراءةٍ مُدقَّقٌ **قارئٌ فقط**، ودَينُ «أوّلِ مسارِ كتابةٍ
 * من الواجهة» مُعلَنٌ هناك على هذه الخطوةِ باسمِها؛ وهذه الوحدةُ تُغلقه.
 *
 * **القاعدةُ الحاكمة:** القراءةُ من طبقةِ الواجهةِ وحدها، والكتابةُ أمرٌ ملكيٌّ
 * موقَّعٌ وحده. لا مستودعَ في يدِ هذه الطبقةِ ولا مِقبضَ كتابةٍ غيرُ `issue`.
 *
 * **ترتيبُ العقباتِ على كلِّ أمرٍ (لا يُقلب):**
 * 1. **سجلٌّ دائمٌ موصول** — وبلا موضعٍ يُشهَد فيه لا أمرَ (`CONSOLE_AUDIT_REQUIRED`).
 * 2. **أمرٌ معلَنٌ** في `config/royal-console.yaml` بمعرّفِه.
 * 3. **جلسةٌ قويةٌ قائمةٌ للملك** بعاملٍ ثانٍ على جهازٍ موثوق — تُشترط على أنواعِ
 *    الأوامرِ المُعلَنةِ في `config/king-authentication.yaml`، ونقصُها
 *    `CONSOLE_AUTHENTICATION_REQUIRED` (‏`M9.04`). وجلسةُ القراءةِ في طبقةِ
 *    الواجهةِ لا تُصدر أمراً ولو كانت صحيحة.
 * 4. **مطابقةُ الفعلِ والهدفِ** لما وُقِّع عليه: من وقَّع فعلاً ثم ناداه بمعرّفِ
 *    أمرٍ آخرَ رُدَّ أمرُه (`CONSOLE_ACTION_MISMATCH` / `CONSOLE_TARGET_MISMATCH`).
 * 5. **إثباتُ السلطة**: توقيعٌ متحقَّقٌ منه، ومنعُ إعادةٍ بمعرّفٍ مستهلَك.
 * 6. **قيدُ القبولِ في السجلِّ الدائمِ قبل الأثر.**
 * 7. **أثرٌ واحدٌ معلَنٌ لنوعِ الأمر**، ثم قيدُ تنفيذٍ منفصل.
 *
 * **لماذا مسارانِ لا مسارٌ واحد (اكتشافٌ بنيويٌّ لا اختيارُ ذوق):** بوابةُ التاج
 * تفحص الإيقافَ الشاملَ ثم النقضَ **قبل** التحقّقِ من التوقيع. فأمرُ استئنافٍ
 * مرَّ بها يُرفض بـ`SOVEREIGN_HALT` لأن الدولةَ موقوفة، وأمرُ رفعِ نقضٍ يُرفض
 * بـ`CROWN_VETO` لأن النقضَ قائم. أي أنّ إمرارَ التعافي من البوابةِ يجعل
 * الإيقافَ الشاملَ والنقضَ **بلا رجعةٍ من الديوان** ويحوِّلهما إلى يدٍ خارجَ
 * الدولة. فمسارُ التعافي مُعلَنٌ منفصلاً في الوثيقة، ومحدودٌ بنوعين لا يزيدان،
 * ويتحقّق من توقيعِ الملكِ بنفسِه، ويمنع الإعادةَ بدفترِ الأوامرِ الدائم، ويُثبَّت
 * في السجلِّ الدائمِ قبل أثرِه كغيره. وحاجزُ `scripts/guard-console.mjs` يمنع
 * إعلانَ نوعٍ ثالثٍ على هذا المسار.
 *
 * **حدودٌ معلَنة:**
 * 1. **لا طبقةَ نقلٍ هنا بعد.** الديوانُ نداءٌ داخليٌّ في العمليةِ نفسِها؛
 *    ومحوِّلُ النقلِ (‏HTTP/TLS) دَينٌ مُعلَنٌ في `docs/ROYAL_CONSOLE.md`
 *    مُسنَدٌ إلى الخطوةِ التي تملك التشغيلَ (`M10`)، ولا يُدَّعى هنا أنه قائم.
 * 2. **لا واجهةَ رسوميّة.** «الديوان» في هذه الخطوةِ عقدُ نداءٍ مُعلَنٌ ومُدقَّق،
 *    لا صفحةٌ في متصفّح. ومعيارُ القبولِ يُقاس على العقدِ لا على شكلٍ مرئيّ.
 * 3. **حالةُ التاجِ في الذاكرةِ لهذه العملية.** النقضُ حقلٌ في كائنِ البوابة،
 *    فيزول بإعادةِ التشغيلِ ولا يعبر إلى عمليةٍ أخرى — بخلافِ الإيقافِ الشاملِ
 *    فتوجيهُه على القرصِ يقرأه كلُّ عقدة. وهذا تفاوتٌ مُعلَنٌ لا مسكوتٌ عنه.
 * 4. **قيدُ القبولِ قبل الأثرِ يعني احتمالَ قبولٍ بلا تنفيذ** إن أخفق الأثرُ
 *    بعده؛ وهو زائدٌ لا ناقص، ويُميّزه غيابُ قيدِ التنفيذِ ووجودُ قيدِ الرفض.
 * 5. **أفعالُ النقضِ ليست في العتبةِ السيادية** (`config/royal-authority.yaml`)
 *    لأن تلك العتبةَ تحكم كتالوجَ أفعالِ محرّكِ السياسة، والنقضُ يقع على بوابةِ
 *    التاجِ نفسِها لا على موردٍ في الكتالوج. وسلطتُه مُثبَتةٌ بالتوقيعِ لا
 *    بالعتبة، وهذا مُعلَنٌ لا مُستَنتَج.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في طبقةِ الواجهةِ ووحدةِ المراقبة.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الإعداداتِ الافتراضيُّ للديوان. */
export const DEFAULT_CONSOLE_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** رموزُ رفضِ الديوان — كلُّها مُعلَنةٌ في `config/royal-console.yaml`. */
export const CONSOLE_ERRORS = Object.freeze({
  CONFIG_INVALID: 'CONSOLE_CONFIG_INVALID',
  AUDIT_REQUIRED: 'CONSOLE_AUDIT_REQUIRED',
  VIEW_UNDECLARED: 'CONSOLE_VIEW_UNDECLARED',
  GATEWAY_REQUIRED: 'CONSOLE_GATEWAY_REQUIRED',
  VIEW_REFUSED: 'CONSOLE_VIEW_REFUSED',
  COMMAND_UNDECLARED: 'CONSOLE_COMMAND_UNDECLARED',
  ACTION_MISMATCH: 'CONSOLE_ACTION_MISMATCH',
  TARGET_MISMATCH: 'CONSOLE_TARGET_MISMATCH',
  CROWN_REQUIRED: 'CONSOLE_CROWN_REQUIRED',
  COMMAND_REJECTED: 'CONSOLE_COMMAND_REJECTED',
  KING_REQUIRED: 'CONSOLE_KING_REQUIRED',
  AUTHENTICATION_REQUIRED: 'CONSOLE_AUTHENTICATION_REQUIRED',
  SIGNATURE_INVALID: 'CONSOLE_SIGNATURE_INVALID',
  REPLAYED_COMMAND: 'CONSOLE_REPLAYED_COMMAND',
  HALT_REQUIRED: 'CONSOLE_HALT_REQUIRED',
  EFFECT_REFUSED: 'CONSOLE_EFFECT_REFUSED',
  PATH_UNDECLARED: 'CONSOLE_PATH_UNDECLARED',
});

/**
 * أنواعُ الأوامرِ التي تسلك مسارَ التعافي — **حدٌّ في الكودِ يقابله حاجزٌ على
 * الوثيقة**. وما ليس هنا لا يتجاوز بوابةَ التاجِ ولو أُعلن أنه يتجاوزها.
 */
export const RECOVERY_KINDS = Object.freeze(['halt-resume', 'veto-clear']);

/** خطأُ الديوانِ برمزٍ مُعلَن. */
export class ConsoleError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ConsoleError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  throw new ConsoleError(CONSOLE_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * رمزُ الخطأِ الأصليُّ إن حمله، وإلا نصُّه: أخطاءُ بوابةِ التاجِ ترفع نصّاً
 * بلا حقلِ رمزٍ (`INVALID_ROYAL_SIGNATURE` وأمثاله)، فيُقرأ نصُّها رمزاً كي لا
 * يضيع السببُ في التغليف.
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  const candidate = /** @type {{ code?: unknown }} */ (error)?.code;
  if (typeof candidate === 'string' && candidate !== '') return candidate;
  const text = errorText(error);
  const head = text.split(':')[0] ?? '';
  return /^[A-Z][A-Z_]+$/.test(head) ? head : 'CONSOLE_CALL_FAILED';
}

/**
 * @typedef {object} ConsoleViewSpec
 * @property {string} id
 * @property {string} route
 * @property {string} purpose
 */

/**
 * @typedef {object} ConsoleCommandSpec
 * @property {string} id
 * @property {string} action
 * @property {'halt' | 'halt-resume' | 'veto' | 'veto-clear'} kind
 * @property {'crown' | 'sovereign-recovery'} path
 * @property {string} target
 * @property {string} purpose
 * @property {boolean} [sovereignThreshold]
 */

/**
 * @typedef {object} ConsolePolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ viewEvent: string, commandExecutedEvent: string, commandRefusedEvent: string, recoveryEvent: string, statement: string }} audit
 * @property {readonly string[]} refusalCodes
 * @property {readonly ConsoleViewSpec[]} views
 * @property {readonly ConsoleCommandSpec[]} commands
 * @property {ReadonlyArray<{ id: string, statement: string, enforcedBy: string, codes: readonly string[] }>} guarantees
 */

/**
 * يقرأ وثيقةَ الديوانِ ويتحقّق منها بمخطَّطها ثم بفحوصِ تماسكٍ لا يُعبِّر عنها
 * مخطَّط: لا معرّفَ مكرَّرٌ في المشاهدِ ولا في الأوامر، ولا فعلانِ لأمرين،
 * ورموزُ الرفضِ المُعلَنةُ مطابقةٌ لرموزِ الكودِ **في الاتجاهين**، ولا نوعَ
 * أمرٍ يسلك مسارَ التعافي إلا المُعلَنُ في `RECOVERY_KINDS`.
 * @param {{ dir?: string }} [options]
 * @returns {ConsolePolicy}
 */
export function loadConsolePolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_CONSOLE_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_CONSOLE_CONFIG_DIR;
  const file = path.join(dir, 'royal-console.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ الديوانِ غائبة؛ وديوانٌ بلا وثيقةٍ تُعلن مشاهدَه وأوامرَه ديوانٌ حدُّه نيّةُ كاتبِه.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة royal-console.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'royal-console.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ الديوانِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ الأوامرِ نصّاً حرّاً كالذي جاء ليمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((/** @type {{ instancePath: string, message?: string }} */ entry) =>
        `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim(),
      )
      .join(' · ');
    invalidConfig(`royal-console.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {ConsolePolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Set<string>} */
  const viewIds = new Set();
  for (const view of parsed.views) {
    if (viewIds.has(view.id)) {
      invalidConfig(
        `المشهد ${view.id} مُعلَنٌ مرّتين؛ ولا مشهدانِ بمعرّفٍ واحدٍ يُقرأ أحدُهما بالآخر.`,
      );
    }
    viewIds.add(view.id);
  }

  /** @type {Set<string>} */
  const commandIds = new Set();
  /** @type {Set<string>} */
  const actions = new Set();
  for (const command of parsed.commands) {
    if (commandIds.has(command.id)) {
      invalidConfig(`الأمر ${command.id} مُعلَنٌ مرّتين؛ ومعرّفٌ بمعنيين يُنفَّذ أحدُهما بالآخر.`);
    }
    commandIds.add(command.id);
    if (actions.has(command.action)) {
      invalidConfig(
        `الفعل «${command.action}» مُعلَنٌ لأمرين؛ وتوقيعٌ على فعلٍ واحدٍ يصلح لأمرين توقيعٌ لا يُعرف على ماذا وقع.`,
      );
    }
    actions.add(command.action);
    const isRecoveryKind = RECOVERY_KINDS.includes(command.kind);
    if (command.path === 'sovereign-recovery' && !isRecoveryKind) {
      invalidConfig(
        `الأمر ${command.id} من نوع «${command.kind}» يُعلَن على مسارِ التعافي، وذاك المسارُ محدودٌ بـ${RECOVERY_KINDS.join('، ')} — وتوسيعُه بالوثيقةِ يفتح تجاوزاً لبوابةِ التاج.`,
      );
    }
    if (command.path === 'crown' && isRecoveryKind) {
      invalidConfig(
        `الأمر ${command.id} أمرُ تعافٍ ومُعلَنٌ على مسارِ البوابة؛ والبوابةُ ترفضه بنيويّاً لأنها موقوفةٌ أو منقوضةٌ حين يُحتاج إليه، فإعلانُه هكذا يَعِد بأمرٍ لا يقع.`,
      );
    }
  }

  /** @type {Set<string>} */
  const declared = new Set(Object.values(CONSOLE_ERRORS));
  /** @type {Set<string>} */
  const listed = new Set(parsed.refusalCodes);
  for (const code of declared) {
    if (!listed.has(code)) {
      invalidConfig(
        `الرمز ${code} يرفعه الكودُ ولا إعلانَ له في الوثيقة؛ ورفضٌ بلا نصٍّ يُعلنه رفضٌ يُفاجئ قارئه.`,
      );
    }
  }
  for (const code of listed) {
    if (!declared.has(code)) {
      invalidConfig(
        `الرمز ${code} مُعلَنٌ في الوثيقةِ ولا يرفعه كودٌ؛ ووثيقةٌ تَعِد برفضٍ لا يقع وثيقةٌ تكذب.`,
      );
    }
  }
  for (const guarantee of parsed.guarantees) {
    for (const code of guarantee.codes) {
      if (!listed.has(code)) {
        invalidConfig(
          `الضمان ${guarantee.id} يُشير إلى الرمز ${code} وهو غيرُ مُعلَنٍ في refusalCodes.`,
        );
      }
    }
  }

  return Object.freeze({
    version: parsed.version,
    statement: parsed.statement,
    audit: Object.freeze({ ...parsed.audit }),
    refusalCodes: Object.freeze([...parsed.refusalCodes]),
    views: Object.freeze(parsed.views.map((view) => Object.freeze({ ...view }))),
    commands: Object.freeze(parsed.commands.map((command) => Object.freeze({ ...command }))),
    guarantees: Object.freeze(
      parsed.guarantees.map((entry) =>
        Object.freeze({ ...entry, codes: Object.freeze([...entry.codes]) }),
      ),
    ),
  });
}

/**
 * والعقدُ يُكتب بأنواعِ الطرفِ الحقيقيِّ نفسِه لا بنوعٍ فضفاضٍ يشبهه.
 *
 * @typedef {object} ConsoleGatewayLike
 * @property {(request: { route: string, token?: string, params?: Record<string, unknown> }) => Promise<{ route: string, policyId: string | null, session: string, data: unknown }>} call
 */

/**
 * @typedef {object} ConsoleCrownLike
 * @property {(command: import('../root-of-trust/crown.mjs').RoyalCommand, signature: string) => { acceptedAt?: unknown }} command
 * @property {{ block: (reason?: string) => void, clear: () => void, enabled: boolean, reason: string | null }} veto
 * @property {boolean} stopped
 */

/**
 * @typedef {object} ConsoleHaltLike
 * @property {(reason?: string, command?: unknown) => { epoch: number, reason: string, state: string }} halt
 * @property {(reason?: string, command?: unknown) => { epoch: number, reason: string, state: string }} resume
 * @property {() => { state: string, epoch: number, reason: string, at: string | null }} read
 */

/**
 * @typedef {object} ConsoleKingLike
 * @property {string} id
 * @property {(payload: object, signature: string) => boolean} verify
 */

/**
 * مصادقةُ الملكِ القويةُ كما يراها الديوانُ: مِقبضُ اشتراطٍ واحدٌ لا أكثر —
 * `requireForCommand` يرمي عند النقصِ ويعيد وصفاً عند الكفاية. والديوانُ لا
 * يعرف كيف تُحسب العواملُ ولا أين تُخزَّن الجلسات، ولا يستورد وحدةَ المصادقةِ
 * صنفاً: يقابل شكلاً كما يقابل التاجَ وزرَّ الإيقاف.
 * @typedef {object} ConsoleAuthnLike
 * @property {(token: string | undefined, kind: string) => ({ actorId: string, deviceId: string, sessionRef: string, expiresAt: string } | null)} requireForCommand
 */

/**
 * @typedef {object} ConsoleLedgerLike
 * @property {(id: string) => boolean} has
 * @property {(command: { id: string }) => unknown} begin
 * @property {(command: { id: string }) => unknown} commit
 * @property {(command: { id: string }, reason?: string) => unknown} abort
 */

/**
 * @typedef {object} ConsoleLogLike
 * @property {(type: string, actor: string, data: Record<string, unknown>) => unknown} append
 */

/**
 * الديوانُ: مِقبضُ قراءةٍ واحدٌ (`view`) ومِقبضُ كتابةٍ واحدٌ (`issue`)، ولا
 * ثالثَ. والمستودعاتُ والتاجُ وزرُّ الإيقافِ كلُّها في حقولٍ خاصّةٍ لا تُصدَّر:
 * من ملك مرجعاً إلى الديوانِ لم يملك بذلك مرجعاً إلى ما تحته.
 */
export class RoyalConsole {
  /** @type {ConsolePolicy} */
  #policy;
  /** @type {Map<string, ConsoleViewSpec>} */
  #views = new Map();
  /** @type {Map<string, ConsoleCommandSpec>} */
  #commands = new Map();
  /** @type {ConsoleGatewayLike | null} */
  #gateway;
  /** @type {ConsoleCrownLike | null} */
  #crown;
  /** @type {ConsoleHaltLike | null} */
  #haltSwitch;
  /** @type {ConsoleKingLike | null} */
  #king;
  /** @type {ConsoleAuthnLike | null} */
  #kingAuth;
  /** @type {ConsoleLedgerLike | null} */
  #ledger;
  /** @type {ConsoleLogLike | null} */
  #log;
  /** @type {() => number} */
  #nowMs;
  /** @type {number} */
  #maxCommandAgeMs;
  /** @type {number} */
  #clockSkewMs;
  /** @type {Set<string>} */
  #seen = new Set();

  /**
   * @param {{ policy?: ConsolePolicy, dir?: string, gateway?: ConsoleGatewayLike | null, crown?: ConsoleCrownLike | null, haltSwitch?: ConsoleHaltLike | null, king?: ConsoleKingLike | null, kingAuth?: ConsoleAuthnLike | null, commandLedger?: ConsoleLedgerLike | null, log?: ConsoleLogLike | null, nowMs?: () => number, maxCommandAgeMs?: number, clockSkewMs?: number }} [deps]
   */
  constructor(deps = {}) {
    this.#policy =
      deps.policy ?? loadConsolePolicy(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#gateway = deps.gateway ?? null;
    this.#crown = deps.crown ?? null;
    this.#haltSwitch = deps.haltSwitch ?? null;
    this.#king = deps.king ?? null;
    this.#kingAuth = deps.kingAuth ?? null;
    this.#ledger = deps.commandLedger ?? null;
    this.#log = deps.log ?? null;
    this.#nowMs = deps.nowMs ?? (() => Date.now());
    this.#maxCommandAgeMs = deps.maxCommandAgeMs ?? 300000;
    this.#clockSkewMs = deps.clockSkewMs ?? 30000;
    for (const view of this.#policy.views) this.#views.set(view.id, view);
    for (const command of this.#policy.commands) this.#commands.set(command.id, command);
  }

  /** @returns {ConsolePolicy} */
  get policy() {
    return this.#policy;
  }

  /**
   * وصفُ ما يملكه الديوانُ من مشاهدَ وأوامرَ وحالةِ سلطةٍ ظاهرة — بياناتٌ تُقرأ
   * لا مِقبضٌ يُنفَّذ به شيء. وحالةُ الإيقافِ تُقرأ من التوجيهِ على القرصِ في كلِّ
   * نداءٍ لا من ذاكرةٍ مؤقّتة: عمليةٌ أخرى قد أوقفت الدولةَ قبل جزءٍ من الثانية.
   * @returns {{ views: ReadonlyArray<{ id: string, route: string, purpose: string }>, commands: ReadonlyArray<{ id: string, action: string, kind: string, path: string, target: string, purpose: string }>, authority: { halt: { state: string, epoch: number, reason: string } | null, vetoed: boolean | null, vetoReason: string | null, crownStopped: boolean | null } }}
   */
  describe() {
    const halt = this.#haltSwitch === null ? null : this.#haltSwitch.read();
    const crown = this.#crown;
    return Object.freeze({
      views: Object.freeze(
        [...this.#views.values()].map((view) =>
          Object.freeze({ id: view.id, route: view.route, purpose: view.purpose }),
        ),
      ),
      commands: Object.freeze(
        [...this.#commands.values()].map((command) =>
          Object.freeze({
            id: command.id,
            action: command.action,
            kind: command.kind,
            path: command.path,
            target: command.target,
            purpose: command.purpose,
          }),
        ),
      ),
      authority: Object.freeze({
        halt:
          halt === null
            ? null
            : Object.freeze({ state: halt.state, epoch: halt.epoch, reason: halt.reason }),
        vetoed: crown === null ? null : !crown.veto.enabled,
        vetoReason: crown === null ? null : crown.veto.reason,
        crownStopped: crown === null ? null : crown.stopped,
      }),
    });
  }

  /**
   * قراءةُ مشهدٍ معلَنٍ عبر طبقةِ الواجهةِ وحدها.
   * @param {{ view: string, token?: string, params?: Record<string, unknown> }} request
   * @returns {Promise<{ view: string, route: string, policyId: string | null, data: unknown }>}
   */
  async view(request) {
    const log = this.#log;
    if (log === null) {
      throw new ConsoleError(
        CONSOLE_ERRORS.AUDIT_REQUIRED,
        'السجلُّ الدائمُ غيرُ موصولٍ بالديوان؛ وقراءةٌ من ديوانٍ بلا أثرٍ قراءةٌ لا يُعرف من فعلها.',
      );
    }
    const viewId = typeof request?.view === 'string' ? request.view.trim() : '';
    const view = this.#views.get(viewId);
    if (view === undefined) {
      const error = new ConsoleError(
        CONSOLE_ERRORS.VIEW_UNDECLARED,
        `المشهد «${viewId}» غيرُ معلَنٍ في وثيقةِ الديوان؛ والمشاهدُ بياناتٌ في الوثيقةِ لا أسماءٌ يخترعها المُنادي.`,
      );
      this.#logRefusal(log, 'unknown', viewId, error);
      throw error;
    }
    const gateway = this.#gateway;
    if (gateway === null) {
      const error = new ConsoleError(
        CONSOLE_ERRORS.GATEWAY_REQUIRED,
        'طبقةُ الواجهةِ غيرُ موصولةٍ بالديوان؛ ولا يقرأ الديوانُ من مستودعٍ مباشرةً ولو كان في متناولِه — فالقراءةُ من طبقةٍ مُدقَّقةٍ أو لا قراءة.',
      );
      this.#logRefusal(log, 'unknown', viewId, error);
      throw error;
    }
    /** @type {{ route: string, policyId: string | null, session: string, data: unknown }} */
    let result;
    try {
      result = await gateway.call({
        route: view.route,
        ...(request.token === undefined ? {} : { token: request.token }),
        ...(request.params === undefined ? {} : { params: request.params }),
      });
    } catch (error) {
      const wrapped = new ConsoleError(
        CONSOLE_ERRORS.VIEW_REFUSED,
        `طبقةُ الواجهةِ ردَّت المشهد ${view.id} على المسار ${view.route}: ${errorText(error)}`,
        { gatewayCode: codeOf(error), route: view.route },
      );
      this.#logRefusal(log, 'unknown', viewId, wrapped);
      throw wrapped;
    }
    log.append(this.#policy.audit.viewEvent, 'console', {
      view: view.id,
      route: view.route,
      session: result.session,
      policyId: result.policyId,
    });
    return Object.freeze({
      view: view.id,
      route: view.route,
      policyId: result.policyId,
      data: result.data,
    });
  }

  /**
   * إصدارُ أمرٍ ملكيٍّ موقَّعٍ من الديوان — مِقبضُ الكتابةِ الوحيد.
   *
   * و`sovereignSession` رمزُ **جلسةٍ قويةٍ** من `src/authn/king-auth.mjs` لا رمزُ
   * جلسةِ القراءةِ في `config/api.yaml`: تلك تقرأ وهذه تُوقف دولةً — وخلطُهما
   * يجعل العاملَ الثانيَ زينة.
   * @param {{ command: string, royalCommand: Record<string, unknown>, signature: string, sovereignSession?: string }} request
   * @returns {Promise<{ command: string, action: string, kind: string, path: string, commandId: string, acceptedAt: string, status: 'executed', effect: Record<string, unknown> }>}
   */
  async issue(request) {
    const log = this.#log;
    if (log === null) {
      throw new ConsoleError(
        CONSOLE_ERRORS.AUDIT_REQUIRED,
        'السجلُّ الدائمُ غيرُ موصولٍ بالديوان؛ وأمرٌ يُنفَّذ بلا قيدٍ دائمٍ يشهد عليه أمرٌ يقع ولا يُرى، وذاك أسوأُ من أمرٍ مرفوض.',
      );
    }
    const commandKey = typeof request?.command === 'string' ? request.command.trim() : '';
    try {
      return await this.#issueChecked(request, commandKey, log);
    } catch (error) {
      const royal = /** @type {{ id?: unknown }} */ (request?.royalCommand ?? {});
      const commandId = typeof royal.id === 'string' ? royal.id : 'unknown';
      this.#logRefusal(log, commandId, commandKey, error);
      throw error;
    }
  }

  /**
   * @param {{ command: string, royalCommand: Record<string, unknown>, signature: string, sovereignSession?: string }} request
   * @param {string} commandKey
   * @param {ConsoleLogLike} log
   * @returns {Promise<{ command: string, action: string, kind: string, path: string, commandId: string, acceptedAt: string, status: 'executed', effect: Record<string, unknown> }>}
   */
  async #issueChecked(request, commandKey, log) {
    // ── (1) أمرٌ معلَنٌ بمعرّفِه ──
    const spec = this.#commands.get(commandKey);
    if (spec === undefined) {
      throw new ConsoleError(
        CONSOLE_ERRORS.COMMAND_UNDECLARED,
        `الأمر «${commandKey}» غيرُ معلَنٍ في وثيقةِ الديوان؛ والأوامرُ بياناتٌ في الوثيقةِ لا أسماءٌ يخترعها المُنادي.`,
      );
    }

    // ── (2) جلسةٌ قويةٌ للملكِ قبل أيِّ فحصٍ آخرَ للأمرِ نفسِه (`M9.04`) ──
    // وموضعُها هنا مقصود: قبل التوقيعِ وقبل التاجِ وقبل الأثر، فمن لا جلسةَ له
    // لا يُقاس أمرُه أصلاً. والاشتراطُ **بياناتٌ** في
    // `config/king-authentication.yaml` لا شرطٌ مكتوبٌ هنا؛ ووحدةُ المصادقةِ
    // غائبةً رفضٌ لا سماحٌ صامت — وإلا صار العاملُ الثاني إعداداً اختيارياً.
    const kingAuth = this.#kingAuth;
    if (kingAuth === null) {
      throw new ConsoleError(
        CONSOLE_ERRORS.AUTHENTICATION_REQUIRED,
        `الأمر ${spec.id} يشترط جلسةً قويةً للملكِ ومصادقتُه غيرُ موصولةٍ بالديوان؛ ومصادقةٌ غائبةٌ رفضٌ لا تخطٍّ، وإلا كان مفتاحُ التوقيعِ وحدَه كلَّ السلطة.`,
        { kind: spec.kind, command: spec.id },
      );
    }
    try {
      kingAuth.requireForCommand(request.sovereignSession, spec.kind);
    } catch (error) {
      throw new ConsoleError(
        CONSOLE_ERRORS.AUTHENTICATION_REQUIRED,
        `الأمر ${spec.id} لا جلسةَ قويةً تُجيزه: ${errorText(error)}`,
        { kind: spec.kind, command: spec.id, authnCode: codeOf(error) },
      );
    }

    // ── (3) مطابقةُ ما وُقِّع عليه لما يُنادى به ──
    const royal = request.royalCommand;
    if (royal === null || typeof royal !== 'object' || Array.isArray(royal)) {
      throw new ConsoleError(
        CONSOLE_ERRORS.COMMAND_REJECTED,
        'الأمرُ الملكيُّ يجب أن يكون كائناً موقَّعاً؛ وشكلٌ آخرُ ليس أمراً يُتحقَّق منه.',
      );
    }
    const signature = typeof request.signature === 'string' ? request.signature : '';
    if (signature === '') {
      throw new ConsoleError(
        CONSOLE_ERRORS.SIGNATURE_INVALID,
        `الأمر ${spec.id} بلا توقيع؛ وأمرٌ بلا توقيعٍ دعوى لا سلطة.`,
      );
    }
    if (royal['action'] !== spec.action) {
      throw new ConsoleError(
        CONSOLE_ERRORS.ACTION_MISMATCH,
        `الأمر ${spec.id} فعلُه المُعلَنُ «${spec.action}» والموقَّعُ عليه «${String(royal['action'])}»؛ وتنفيذُ فعلٍ لم يوقّعه الملكُ باسمِه انتحالٌ بتوقيعٍ صحيح.`,
      );
    }
    if (royal['target'] !== spec.target) {
      throw new ConsoleError(
        CONSOLE_ERRORS.TARGET_MISMATCH,
        `الأمر ${spec.id} هدفُه المُعلَنُ «${spec.target}» والموقَّعُ عليه «${String(royal['target'])}»؛ وتحويلُ الهدفِ بعد التوقيعِ يُنفِّذ أمراً لم يُصدَر.`,
      );
    }
    const commandId = typeof royal['id'] === 'string' ? royal['id'].trim() : '';
    if (commandId === '') {
      throw new ConsoleError(
        CONSOLE_ERRORS.COMMAND_REJECTED,
        `الأمر ${spec.id} بلا معرّف؛ وأمرٌ بلا معرّفٍ لا يُمنع تكرارُه ولا يُشار إليه في السجل.`,
      );
    }

    // ── (4) إثباتُ السلطةِ ثم (5) قيدُ القبولِ في السجلِّ الدائمِ قبل الأثر ──
    /** @type {string} */
    let acceptedAt;
    if (spec.path === 'crown') {
      acceptedAt = this.#acceptThroughCrown(spec, royal, signature);
    } else if (spec.path === 'sovereign-recovery') {
      acceptedAt = this.#acceptRecovery(spec, royal, signature, log, commandId);
    } else {
      throw new ConsoleError(
        CONSOLE_ERRORS.PATH_UNDECLARED,
        `الأمر ${spec.id} مسارُه «${String(spec.path)}» ولا مُعالِجَ له في الكود؛ ومسارٌ بلا مُعالِجٍ إعلانٌ بلا إنفاذ.`,
      );
    }

    // ── (6) الأثرُ: واحدٌ لكلِّ نوعٍ مكتوبٌ في الكودِ لا في الوثيقة ──
    /** @type {Record<string, unknown>} */
    let effect;
    try {
      effect = this.#applyEffect(spec, royal);
    } catch (error) {
      throw new ConsoleError(
        CONSOLE_ERRORS.EFFECT_REFUSED,
        `الأمر ${spec.id} قُبل وثُبِّت في السجلِّ الدائمِ ثم ردَّه أثرُه: ${errorText(error)} — والقيدُ يبقى شاهداً على قبولٍ بلا تنفيذ، ولا يُمحى.`,
        { effectCode: codeOf(error), kind: spec.kind, commandId, acceptedAt },
      );
    }

    // ── (7) قيدُ التنفيذِ: يُميّز «نُفِّذ» من «قُبل ولم يُنفَّذ» ──
    log.append(this.#policy.audit.commandExecutedEvent, this.#actorId(), {
      command: spec.id,
      commandId,
      action: spec.action,
      kind: spec.kind,
      path: spec.path,
      target: spec.target,
      acceptedAt,
      effect,
    });

    return Object.freeze({
      command: spec.id,
      action: spec.action,
      kind: spec.kind,
      path: spec.path,
      commandId,
      acceptedAt,
      status: /** @type {const} */ ('executed'),
      effect: Object.freeze({ ...effect }),
    });
  }

  /**
   * القبولُ من بوابةِ التاج: هي التي تتحقّق من التوقيعِ وتمنع الإعادةَ وتُثبِّت
   * `crown.command.accepted` في السجلِّ الدائم. ولا يُعاد هنا فحصٌ تملكه هي:
   * فحصانِ لشيءٍ واحدٍ في موضعين يتباعدان بالزمنِ فيصير أحدُهما ثقباً.
   * @param {ConsoleCommandSpec} spec
   * @param {Record<string, unknown>} royal
   * @param {string} signature
   * @returns {string}
   */
  #acceptThroughCrown(spec, royal, signature) {
    const crown = this.#crown;
    if (crown === null) {
      throw new ConsoleError(
        CONSOLE_ERRORS.CROWN_REQUIRED,
        'بوابةُ التاجِ غيرُ موصولةٍ بالديوان؛ وديوانٌ يُنفِّذ أمراً بلا بوابةٍ تتحقّق من توقيعِه ديوانٌ يمنح نفسَه السلطةَ التي جاء يُمارسها.',
      );
    }
    /** @type {{ acceptedAt?: unknown }} */
    let accepted;
    try {
      // وعقدُ البوابةِ يطلب أمراً مكتملَ الحقول، والديوانُ قد فحص فعلَه وهدفَه
      // ومعرّفَه قبلَ هذا الموضع؛ وما بقي تفحصُه البوابةُ نفسُها فتردُّه برمزِه
      // (`INVALID_COMMAND`) لا يُفترَض هنا صحيحاً.
      accepted = crown.command(
        /** @type {import('../root-of-trust/crown.mjs').RoyalCommand} */ (
          /** @type {unknown} */ (royal)
        ),
        signature,
      );
    } catch (error) {
      const code = codeOf(error);
      const mapped =
        code === 'REPLAYED_COMMAND'
          ? CONSOLE_ERRORS.REPLAYED_COMMAND
          : code === 'INVALID_ROYAL_SIGNATURE'
            ? CONSOLE_ERRORS.SIGNATURE_INVALID
            : CONSOLE_ERRORS.COMMAND_REJECTED;
      throw new ConsoleError(mapped, `بوابةُ التاجِ ردَّت الأمر ${spec.id}: ${errorText(error)}`, {
        crownCode: code,
      });
    }
    const at = accepted.acceptedAt;
    return typeof at === 'string' ? at : new Date(this.#nowMs()).toISOString();
  }

  /**
   * مسارُ التعافي: يتحقّق من توقيعِ الملكِ بنفسِه لأن البوابةَ ترفض بنيويّاً حين
   * يُحتاج إليه (انظر رأسَ الملف). وترتيبُه هو ترتيبُ البوابةِ نفسُه: توقيعٌ، ثم
   * عمرٌ، ثم منعُ إعادة، ثم حجزٌ في الدفترِ الدائم، ثم قيدٌ في السجل، ثم تثبيتُ
   * الحجز — فلو أخفق القيدُ أُلغي الحجزُ وبقي الأمرُ قابلاً لإعادةِ الإصدار.
   * @param {ConsoleCommandSpec} spec
   * @param {Record<string, unknown>} royal
   * @param {string} signature
   * @param {ConsoleLogLike} log
   * @param {string} commandId
   * @returns {string}
   */
  #acceptRecovery(spec, royal, signature, log, commandId) {
    if (!RECOVERY_KINDS.includes(spec.kind)) {
      throw new ConsoleError(
        CONSOLE_ERRORS.PATH_UNDECLARED,
        `الأمر ${spec.id} من نوع «${spec.kind}» على مسارِ التعافي، والمسارُ محدودٌ بـ${RECOVERY_KINDS.join('، ')} — والحدُّ في الكودِ لا في الوثيقةِ وحدها.`,
      );
    }
    const king = this.#king;
    if (king === null) {
      throw new ConsoleError(
        CONSOLE_ERRORS.KING_REQUIRED,
        'هويةُ الملكِ غيرُ موصولةٍ بالديوان، ومسارُ التعافي لا يمرّ ببوابةِ التاج؛ فبلا متحقِّقٍ من التوقيعِ لا تعافيَ — والغيابُ رفضٌ لا سماح.',
      );
    }
    if (!king.verify(royal, signature)) {
      throw new ConsoleError(
        CONSOLE_ERRORS.SIGNATURE_INVALID,
        `توقيعُ الأمر ${spec.id} لم يُقبل بمفتاحِ الملك؛ ومسارُ التعافي أخطرُ من غيرِه فلا يُتساهل في توقيعِه.`,
      );
    }
    const issuedAt = typeof royal['issuedAt'] === 'string' ? Date.parse(royal['issuedAt']) : NaN;
    if (!Number.isFinite(issuedAt)) {
      throw new ConsoleError(
        CONSOLE_ERRORS.COMMAND_REJECTED,
        `الأمر ${spec.id} بلا زمنِ إصدارٍ مقروء؛ وأمرٌ بلا زمنٍ لا تُعرف صلاحيتُه فيصلح إلى الأبد.`,
      );
    }
    const age = this.#nowMs() - issuedAt;
    if (age > this.#maxCommandAgeMs) {
      throw new ConsoleError(
        CONSOLE_ERRORS.COMMAND_REJECTED,
        `الأمر ${spec.id} أُصدر قبل ${Math.round(age / 1000)} ثانيةً والحدُّ ${Math.round(this.#maxCommandAgeMs / 1000)}؛ وأمرٌ قديمٌ يُنفَّذ اليومَ أمرٌ في غيرِ سياقِه.`,
      );
    }
    if (age < -this.#clockSkewMs) {
      throw new ConsoleError(
        CONSOLE_ERRORS.COMMAND_REJECTED,
        `الأمر ${spec.id} زمنُه في المستقبل بأكثرَ من ${Math.round(this.#clockSkewMs / 1000)} ثانية؛ وأمرٌ من المستقبلِ يبقى صالحاً بعد انتهاءِ صلاحيتِه.`,
      );
    }
    const ledger = this.#ledger;
    if (this.#seen.has(commandId) || (ledger !== null && ledger.has(commandId))) {
      throw new ConsoleError(
        CONSOLE_ERRORS.REPLAYED_COMMAND,
        `معرّفُ الأمر ${commandId} مستهلَكٌ؛ وإعادةُ إرسالِ أمرِ تعافٍ موقَّعٍ تُستأنَف بها دولةٌ أوقفها الملكُ بعده.`,
      );
    }
    const acceptedAt = new Date(this.#nowMs()).toISOString();
    if (ledger !== null) ledger.begin({ ...royal, id: commandId });
    try {
      log.append(this.#policy.audit.recoveryEvent, this.#actorId(), {
        command: spec.id,
        commandId,
        action: spec.action,
        kind: spec.kind,
        target: spec.target,
        acceptedAt,
        // ومسارُ التعافي يُسجَّل باسمِه لا كأمرٍ عاديّ: من قرأ السجلَّ يجب أن
        // يرى **أنّ** أمراً تجاوز بوابةَ التاجِ ولماذا جاز له ذلك.
        via: 'sovereign-recovery',
      });
    } catch (error) {
      if (ledger !== null) ledger.abort({ ...royal, id: commandId }, 'LOG_APPEND_FAILED');
      throw error;
    }
    if (ledger !== null) ledger.commit({ ...royal, id: commandId });
    this.#seen.add(commandId);
    return acceptedAt;
  }

  /**
   * أثرُ الأمرِ بحسبِ نوعِه — والأنواعُ مُغلَقةٌ في الكود، فنوعٌ لا مُعالِجَ له
   * يُرفض ولا يُهمَل صامتاً.
   * @param {ConsoleCommandSpec} spec
   * @param {Record<string, unknown>} royal
   * @returns {Record<string, unknown>}
   */
  #applyEffect(spec, royal) {
    const payload = /** @type {Record<string, unknown>} */ (
      royal['payload'] !== null && typeof royal['payload'] === 'object'
        ? royal['payload']
        : /** @type {Record<string, unknown>} */ ({})
    );
    const reason = typeof payload['reason'] === 'string' ? payload['reason'].trim() : '';
    switch (spec.kind) {
      case 'halt':
      case 'halt-resume': {
        const halt = this.#haltSwitch;
        if (halt === null) {
          throw new ConsoleError(
            CONSOLE_ERRORS.HALT_REQUIRED,
            'زرُّ الإيقافِ الشاملِ غيرُ موصولٍ بالديوان؛ وإيقافٌ يُعلَن ولا يُكتب توجيهُه على القرصِ إيقافٌ في عمليةٍ واحدةٍ لا في دولة.',
          );
        }
        // R5-B-07: الإيقافُ والاستئنافُ يُنفَّذانِ بالأمرِ الملكيِّ المقبولِ
        // نفسِه لا بنداءٍ مجرّدٍ — فالمفتاحُ يتحقّقُ من الأمرِ بوّابتِه هو.
        const directive =
          spec.kind === 'halt'
            ? halt.halt(reason === '' ? undefined : reason, royal)
            : halt.resume(reason === '' ? undefined : reason, royal);
        return { state: directive.state, epoch: directive.epoch, reason: directive.reason };
      }
      case 'veto':
      case 'veto-clear': {
        const crown = this.#crown;
        if (crown === null) {
          throw new ConsoleError(
            CONSOLE_ERRORS.CROWN_REQUIRED,
            'بوابةُ التاجِ غيرُ موصولةٍ بالديوان، والنقضُ يقع عليها؛ فلا نقضَ على بوابةٍ غائبة.',
          );
        }
        if (spec.kind === 'veto') {
          crown.veto.block(reason === '' ? undefined : reason);
        } else {
          crown.veto.clear();
        }
        return { vetoed: !crown.veto.enabled, reason: crown.veto.reason };
      }
      default: {
        throw new ConsoleError(
          CONSOLE_ERRORS.EFFECT_REFUSED,
          `نوعُ الأمر «${String(spec.kind)}» بلا أثرٍ مكتوبٍ في الكود؛ ونوعٌ يُعلَن ولا يُنفَّذ وعدٌ لا يقع.`,
        );
      }
    }
  }

  /** @returns {string} */
  #actorId() {
    return this.#king === null ? 'console' : this.#king.id;
  }

  /**
   * قيدُ الرفض: يُكتب برمزِه وتفصيلِه، ولا يُبدِّل الرفضَ إن أخفق هو نفسُه.
   * @param {ConsoleLogLike} log
   * @param {string} actor
   * @param {string} subject
   * @param {unknown} error
   * @returns {void}
   */
  #logRefusal(log, actor, subject, error) {
    try {
      const detail = error instanceof ConsoleError ? error.detail : {};
      log.append(this.#policy.audit.commandRefusedEvent, actor === '' ? 'unknown' : actor, {
        subject: subject === '' ? 'unknown' : subject,
        code: codeOf(error),
        reason: errorText(error),
        ...(Object.keys(detail).length === 0 ? {} : { detail }),
      });
    } catch {
      // من أخفق تسجيلُ رفضِه يبقى مرفوضاً، ولا يُستبدَل خطأُ التسجيلِ بخطأِ
      // السببِ فيُخفيه.
    }
  }
}
