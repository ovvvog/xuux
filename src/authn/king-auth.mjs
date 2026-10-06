/**
 * مصادقةُ الملكِ القوية — الخطوة `M9.04`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة، وقد قِيس لا افتُرض:** بعد `M9.03` صار للملكِ
 * ديوانٌ يُصدر منه أمراً موقَّعاً يُنفَّذ ويُسجَّل، وكان **إثباتُ سلطتِه عاملاً
 * واحداً**: مفتاحُ التوقيع. ونصُّ `config/api.yaml` يقول ذلك بحرفه — «ولا عاملَ
 * ثانٍ هنا: المصادقةُ القويةُ للملكِ نصُّ `M9.04`». فمن ملك المفتاحَ — بنسخةٍ
 * احتياطيةٍ منسيّةٍ أو بجهازٍ مسروقٍ أو بلقطةِ ذاكرة — أوقف الدولةَ ونقض أوامرَها
 * بلا عاملٍ ثانٍ ولا جهازٍ موثوقٍ ولا جلسةٍ تنتهي. وهذه الوحدةُ تُغلق ذلك.
 *
 * **ترتيبُ العقباتِ على كلِّ مصادقة (لا يُقلب):**
 * 1. **سجلٌّ دائمٌ موصول** — وبلا موضعٍ يُشهَد فيه لا مصادقةَ (`AUTHN_AUDIT_REQUIRED`).
 * 2. **الملكُ نفسُه** — لا وكيلٌ ولا وزيرٌ ولا مراقب (`AUTHN_IDENTITY_UNVERIFIED`).
 * 3. **جهازٌ موثوقٌ معلَنٌ** في `config/king-authentication.yaml`، والمسحوبُ منه
 *    الثقةُ يُرفض **باسمِه** لا مجهولاً (`AUTHN_DEVICE_REVOKED`).
 * 4. **عاملٌ ثانٍ حاضرٌ** ثم **صحيحٌ لخطوةٍ زمنيةٍ مقبولة** ثم **غيرُ مستهلَك**.
 * 5. **جلسةٌ قصيرةٌ** رمزُها يُعاد مرّةً واحدةً ويُخزَّن ببصمتِه وحدَها.
 *
 * **قرارٌ مقصودٌ لا ذوق — الرمزُ يُقارَن مقارنةً ثابتةَ الزمن:** مقارنةُ نصٍّ
 * بـ`===` تُخرج من أولِ حرفٍ مختلف، وفرقُ الزمنِ ذاك قابلٌ للقياسِ على شبكةٍ
 * محلّية، فيُستخرَج الرمزُ حرفاً حرفاً. فالمقارنةُ بـ`timingSafeEqual` على طولٍ
 * ثابت.
 *
 * **حدودٌ معلَنة:**
 * 1. **الجلساتُ في الذاكرةِ لهذه العملية** — تزول بإعادةِ التشغيل، ولا يعرفها
 *    عنقودٌ من عدّةِ نسخ؛ والمخزنُ المشتركُ قرارُ تشغيلٍ في `M10` كحالِ جلسةِ
 *    `config/api.yaml`. وأثرُ الحدِّ **مغلق**: من فقد جلستَه يُصادق من جديد.
 * 2. **استهلاكُ رمزِ العاملِ يُستعاد من السجلِّ الدائمِ لا من الذاكرةِ وحدَها**
 *    — وهذا كان دَيناً مفتوحاً كشفه المجلسُ (`R5-B-03`): نسخةٌ جديدةٌ من
 *    المصادقِ كانت تبدأ بمجموعةِ استهلاكٍ فارغةٍ، فرمزٌ استُهلك وقُيِّد على
 *    القرصِ يُقبل ثانيةً داخلَ نافذةِ خطوتِه. وقد أُغلق بأن تُقرأ قيودُ
 *    `audit.factorConsumedEvent` من السجلِّ الموصولِ نفسِه عند أولِ مصادقةٍ، فلا
 *    مخزنَ جديدٌ ولا استيرادَ طبقةٍ. **والباقي معلَنٌ:** نسختانِ تعملانِ **معاً**
 *    على سجلٍّ واحدٍ لا ترى إحداهما ما استهلكته الأخرى بعد لحظةِ قراءتِها، لأن
 *    السجلَّ لا يُعاد تحميلُه من الملفِّ عند كلِّ إلحاق؛ وذاك دَينُ المخزنِ
 *    المشتركِ في `M10` لا دَينُ هذه القراءة. وسجلٌّ **لا يُقرأ منه** يُرَدُّ
 *    بـ`AUTHN_FACTOR_LEDGER_UNREADABLE` ولا يُدَّعى معه منعُ إعادة.
 * 3. **سرُّ العاملِ يُقرأ من مزوِّدٍ خارجَ هذه الوحدة** — وهي لا تولّده ولا
 *    تُخزّنه ولا تكتبه في قيدٍ ولا رسالة؛ وربطُ المزوِّدِ بمخزنِ الأسرارِ
 *    البعيدِ (`src/root-of-trust/key-provider-remote.mts`) قرارُ تشغيلٍ لا
 *    يُتَّخذ من هذه الطبقة.
 * 4. **لا طبقةَ نقلٍ ولا واجهةَ رسومية** — المصادقةُ نداءٌ داخليٌّ في العملية،
 *    كالديوانِ نفسِه؛ وذاك دَينُ `M10` المُعلَن في `docs/ROYAL_CONSOLE.md`.
 * 5. **العاملُ الثاني عاملُ «ما تملك» لا عاملُ «ما أنت»** — لا بصمةَ ولا مفتاحَ
 *    أجهزةٍ (WebAuthn) هنا؛ وذاك يحتاج طبقةَ نقلٍ ومتصفّحاً، فلا يُدَّعى.
 */

import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في الديوانِ وطبقةِ الواجهة.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الإعداداتِ الافتراضيُّ لمصادقةِ الملك. */
export const DEFAULT_KING_AUTH_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/** رموزُ رفضِ المصادقة — كلُّها مُعلَنةٌ في `config/king-authentication.yaml`. */
export const AUTHN_ERRORS = Object.freeze({
  CONFIG_INVALID: 'AUTHN_CONFIG_INVALID',
  AUDIT_REQUIRED: 'AUTHN_AUDIT_REQUIRED',
  IDENTITY_UNVERIFIED: 'AUTHN_IDENTITY_UNVERIFIED',
  DEVICE_UNKNOWN: 'AUTHN_DEVICE_UNKNOWN',
  DEVICE_REVOKED: 'AUTHN_DEVICE_REVOKED',
  FACTOR_REQUIRED: 'AUTHN_FACTOR_REQUIRED',
  FACTOR_INVALID: 'AUTHN_FACTOR_INVALID',
  FACTOR_REPLAYED: 'AUTHN_FACTOR_REPLAYED',
  FACTOR_LEDGER_UNREADABLE: 'AUTHN_FACTOR_LEDGER_UNREADABLE',
  SECRET_MISSING: 'AUTHN_SECRET_MISSING',
  SESSION_INVALID: 'AUTHN_SESSION_INVALID',
  SESSION_EXPIRED: 'AUTHN_SESSION_EXPIRED',
  ASSURANCE_INSUFFICIENT: 'AUTHN_ASSURANCE_INSUFFICIENT',
});

/** خطأُ المصادقةِ برمزٍ مُعلَن. */
export class AuthnError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'AuthnError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalidConfig(message) {
  throw new AuthnError(AUTHN_ERRORS.CONFIG_INVALID, message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @typedef {object} KingAuthDevice
 * @property {string} id
 * @property {string} purpose
 * @property {'trusted' | 'revoked'} state
 * @property {string} factorRef
 */

/**
 * @typedef {object} KingAuthPolicy
 * @property {number} version
 * @property {string} statement
 * @property {{ ttlSeconds: number, tokenBytes: number, digest: 'sha256' | 'sha512', statement: string }} session
 * @property {{ algorithm: 'hmac-sha256' | 'hmac-sha512', digits: number, stepSeconds: number, acceptedSkewSteps: number, singleUse: boolean, statement: string }} secondFactor
 * @property {readonly KingAuthDevice[]} devices
 * @property {{ requiredForCommandKinds: readonly string[], statement: string }} assurance
 * @property {{ sessionOpenedEvent: string, sessionClosedEvent: string, refusedEvent: string, factorConsumedEvent: string, statement: string }} audit
 * @property {readonly string[]} refusalCodes
 * @property {ReadonlyArray<{ id: string, statement: string, enforcedBy: string, codes: readonly string[] }>} guarantees
 */

/**
 * يقرأ وثيقةَ المصادقةِ ويتحقّق منها بمخطَّطها ثم بفحوصِ تماسكٍ لا يُعبِّر عنها
 * مخطَّط: لا معرّفَ جهازٍ مكرَّرٌ، ولا جهازٌ موثوقٌ بلا اسمِ سرٍّ، وجهازٌ موثوقٌ
 * واحدٌ على الأقل (وثيقةٌ كلُّ أجهزتِها مسحوبةٌ تمنع الملكَ من دولتِه)، ورموزُ
 * الرفضِ المُعلَنةُ مطابقةٌ لرموزِ الكودِ **في الاتجاهين**.
 * @param {{ dir?: string }} [options]
 * @returns {KingAuthPolicy}
 */
export function loadKingAuthPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_KING_AUTH_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_KING_AUTH_CONFIG_DIR;
  const file = path.join(dir, 'king-authentication.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ مصادقةِ الملكِ غائبة؛ ومصادقةٌ بلا وثيقةٍ تُعلن أجهزتَها ومهلتَها مصادقةٌ حدُّها نيّةُ كاتبِها.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة king-authentication.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'king-authentication.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ المصادقةِ غائب؛ وبلا مخطَّطٍ يصير إعلانُ الأجهزةِ والمهلةِ نصّاً حرّاً كالذي جاء ليمنعه.',
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
    invalidConfig(`king-authentication.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {KingAuthPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Set<string>} */
  const deviceIds = new Set();
  for (const device of parsed.devices) {
    if (deviceIds.has(device.id)) {
      invalidConfig(
        `الجهاز ${device.id} مُعلَنٌ مرّتين؛ وجهازٌ بحالتين يُقرأ موثوقاً بإحداهما ومسحوباً بالأخرى.`,
      );
    }
    deviceIds.add(device.id);
  }
  if (!parsed.devices.some((device) => device.state === 'trusted')) {
    invalidConfig(
      'لا جهازَ موثوقاً واحداً في الوثيقة؛ ووثيقةٌ كلُّ أجهزتِها مسحوبةٌ تمنع الملكَ من دولتِه وتُقرأ صرامةً وهي عطل.',
    );
  }

  /** @type {Set<string>} */
  const declared = new Set(Object.values(AUTHN_ERRORS));
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
    session: Object.freeze({ ...parsed.session }),
    secondFactor: Object.freeze({ ...parsed.secondFactor }),
    devices: Object.freeze(parsed.devices.map((device) => Object.freeze({ ...device }))),
    assurance: Object.freeze({
      ...parsed.assurance,
      requiredForCommandKinds: Object.freeze([...parsed.assurance.requiredForCommandKinds]),
    }),
    audit: Object.freeze({ ...parsed.audit }),
    refusalCodes: Object.freeze([...parsed.refusalCodes]),
    guarantees: Object.freeze(
      parsed.guarantees.map((entry) =>
        Object.freeze({ ...entry, codes: Object.freeze([...entry.codes]) }),
      ),
    ),
  });
}

/**
 * رمزُ العاملِ الثاني لخطوةٍ زمنية — تابعٌ خالصٌ يُستعمل في طرفَي القياس: جهازُ
 * الملكِ يحسبه ليعرضه، والمصادقةُ تحسبه لتقابله. ولا موضعَ ثالثٌ يحسبه بطريقةٍ
 * أخرى فيتفارق الطرفان.
 * @param {{ secret: string, step: number, digits: number, algorithm: 'hmac-sha256' | 'hmac-sha512' }} input
 * @returns {string}
 */
export function factorCodeForStep({ secret, step, digits, algorithm }) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.max(0, Math.trunc(step))));
  const digest = createHmac(algorithm === 'hmac-sha512' ? 'sha512' : 'sha256', secret)
    .update(counter)
    .digest();
  // اقتطاعٌ ديناميٌّ كاقتطاعِ RFC 4226: أربعةُ بايتاتٍ يُختار موضعُها من آخرِ
  // نصفِ بايتٍ في البصمة، فلا يُقتطع الرمزُ من موضعٍ ثابتٍ يُعرَف مقدّماً.
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * مقارنةٌ ثابتةُ الزمنِ لنصّين: تُسوّى الأطوالُ ببصمةٍ قبل المقارنةِ كي لا يُقاس
 * طولُ المتوقَّعِ من زمنِ الردّ ولا يرمي `timingSafeEqual` على اختلافِ الطول.
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function constantTimeEqual(left, right) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

/**
 * @typedef {object} AuthnKingLike
 * @property {string} id
 */

/**
 * @typedef {object} AuthnLogLike
 * @property {(type: string, actor: string, data: Record<string, unknown>) => unknown} append
 * @property {(() => ReadonlyArray<{ type?: unknown, data?: unknown }>) | undefined} [snapshot]
 * @property {((type: string, minStep: number) => ReadonlyArray<{ type?: unknown, data?: unknown }>) | undefined} [eventsOfTypeSinceStep]
 * @property {(type: string, actor: string, data: Record<string, unknown>) => Promise<unknown>} [appendSealed]
 *   (‏`WL-348`) إلحاقٌ يُنتظَرُ ختمُه — يُستعمَلُ حيثُ يختمُ السجلُّ فعلاً (‏`sealingLog`).
 * @property {() => Promise<void>} [flush]
 * @property {unknown} [sealed]
 */

/**
 * `WL-348`: هل يختمُ هذا السجلُّ ما يُلحَقُ به؟ — القاعدةُ نفسُها في `royal-console.mjs`:
 * `PersistentEventLog` يحملُ `appendSealed` دائماً ويردُّه بلا خاتم، فالحضورُ وحدَه لا يكفي.
 * @param {AuthnLogLike} log
 * @returns {boolean}
 */
function sealingLog(log) {
  if (typeof log.appendSealed !== 'function') return false;
  return log.sealed === true || typeof log.flush === 'function';
}

/**
 * قيدٌ يُنتظَرُ ختمُه حيثُ يختمُ السجلّ، وإلحاقٌ عاديٌّ حيثُ لا يختم.
 * @param {AuthnLogLike} log
 * @param {string} type
 * @param {string} actor
 * @param {Record<string, unknown>} data
 * @returns {Promise<void>}
 */
async function recordSealed(log, type, actor, data) {
  if (sealingLog(log) && typeof log.appendSealed === 'function') {
    await log.appendSealed(type, actor, data);
    return;
  }
  log.append(type, actor, data);
}

/**
 * مزوِّدُ أسرارِ العوامل: يُسأل **باسمِ** السرِّ المُعلَنِ في الوثيقة، ولا تعرف
 * هذه الوحدةُ من أين يجيء.
 * @typedef {object} FactorSecretsLike
 * @property {(name: string) => (string | null | Promise<string | null>)} read
 */

/**
 * @typedef {object} StrongSession
 * @property {string} actorId
 * @property {string} deviceId
 * @property {string} sessionRef
 * @property {number} expiresAtMs
 */

/**
 * المصادقةُ القويةُ للملك: مِقبضٌ للفتحِ (`authenticate`) ومِقبضٌ للسؤالِ
 * (`resolve` و`requireForCommand`) ومِقبضٌ للإغلاق (`close`)، ولا رابعَ. ولا
 * تُصدَّر الجلساتُ ولا بصماتُها ولا الأسرارُ: من ملك مرجعاً إلى المصادقةِ لم
 * يملك بذلك رمزَ جلسةٍ ولا سرَّ جهاز.
 */
export class KingAuthenticator {
  /** @type {KingAuthPolicy} */
  #policy;
  /** @type {Map<string, KingAuthDevice>} */
  #devices = new Map();
  /** @type {AuthnKingLike | null} */
  #king;
  /** @type {AuthnLogLike | null} */
  #log;
  /** @type {FactorSecretsLike | null} */
  #secrets;
  /** @type {() => number} */
  #nowMs;
  /** بصمةُ الرمزِ ⇒ الجلسة. ولا رمزَ نصّاً في هذه الخريطة. @type {Map<string, StrongSession>} */
  #sessions = new Map();
  /** «جهاز:خطوة» لكلِّ عاملٍ استُهلك. @type {Set<string>} */
  #consumed = new Set();
  /**
   * هل استُعيدَ قيدُ الاستهلاكِ الدائمُ في هذه النسخةِ؟ — يُقرأ **مرّةً واحدةً**
   * لكلِّ نسخةٍ عند أولِ مصادقةٍ، لا عند التركيبِ: التركيبُ يقع دائماً في جذرِ
   * التركيبِ ولو لم يُصادِق أحدٌ، فقراءةُ سجلٍّ كاملٍ فيه ثمنٌ يُدفع بلا سبب.
   * @type {boolean}
   */
  #consumedRestored = false;

  /**
   * @param {{ policy?: KingAuthPolicy, dir?: string, king?: AuthnKingLike | null, log?: AuthnLogLike | null, factorSecrets?: FactorSecretsLike | null, nowMs?: () => number }} [deps]
   */
  constructor(deps = {}) {
    this.#policy =
      deps.policy ?? loadKingAuthPolicy(deps.dir === undefined ? {} : { dir: deps.dir });
    this.#king = deps.king ?? null;
    this.#log = deps.log ?? null;
    this.#secrets = deps.factorSecrets ?? null;
    this.#nowMs = deps.nowMs ?? (() => Date.now());
    for (const device of this.#policy.devices) this.#devices.set(device.id, device);
  }

  /** @returns {KingAuthPolicy} */
  get policy() {
    return this.#policy;
  }

  /** عددُ الجلساتِ القائمةِ بعد إسقاطِ المنتهية — عددٌ يُقرأ لا مِقبضٌ عليها. @returns {number} */
  get size() {
    this.#prune();
    return this.#sessions.size;
  }

  /**
   * فتحُ جلسةٍ قويةٍ للملك. والرمزُ يُعاد **مرّةً واحدةً** ولا يُخزَّن إلا
   * ببصمتِه، فمن فقده صادق من جديد ولا يُستخرَج من الذاكرة.
   * @param {{ actorId?: string, deviceId?: string, factorCode?: string }} request
   * @returns {Promise<{ token: string, actorId: string, deviceId: string, sessionRef: string, expiresAt: string, ttlSeconds: number }>}
   */
  async authenticate(request) {
    const log = this.#log;
    if (log === null) {
      throw new AuthnError(
        AUTHN_ERRORS.AUDIT_REQUIRED,
        'السجلُّ الدائمُ غيرُ موصولٍ بالمصادقة؛ ومصادقةٌ لا يُعرف من فتحها ولا متى مصادقةٌ لا تُراجَع في حادثة.',
      );
    }
    const actorId = typeof request?.actorId === 'string' ? request.actorId.trim() : '';
    const deviceId = typeof request?.deviceId === 'string' ? request.deviceId.trim() : '';
    try {
      return await this.#authenticateChecked(actorId, deviceId, request, log);
    } catch (error) {
      this.#logRefusal(log, actorId, deviceId, error);
      throw error;
    }
  }

  /**
   * @param {string} actorId
   * @param {string} deviceId
   * @param {{ factorCode?: string }} request
   * @param {AuthnLogLike} log
   * @returns {Promise<{ token: string, actorId: string, deviceId: string, sessionRef: string, expiresAt: string, ttlSeconds: number }>}
   */
  async #authenticateChecked(actorId, deviceId, request, log) {
    // ── (1) الملكُ نفسُه ──
    const king = this.#king;
    if (king === null) {
      throw new AuthnError(
        AUTHN_ERRORS.IDENTITY_UNVERIFIED,
        'هويةُ الملكِ غيرُ موصولةٍ بالمصادقة؛ فبلا مرجعٍ يُقابَل به المُصادِقُ لا تُفتح جلسةٌ قوية — والغيابُ رفضٌ لا سماح.',
      );
    }
    if (actorId === '' || actorId !== king.id) {
      throw new AuthnError(
        AUTHN_ERRORS.IDENTITY_UNVERIFIED,
        'الجلسةُ القويةُ للملكِ وحدَه؛ ومن فتحها لغيرِه منح سلطةَ إيقافِ الدولةِ لمن لا يملكها.',
      );
    }

    // ── (2) جهازٌ موثوقٌ معلَن ──
    const device = this.#devices.get(deviceId);
    if (device === undefined) {
      throw new AuthnError(
        AUTHN_ERRORS.DEVICE_UNKNOWN,
        `الجهاز «${deviceId}» غيرُ معلَنٍ في وثيقةِ المصادقة؛ والأجهزةُ بياناتٌ في الوثيقةِ لا أسماءٌ يخترعها المُنادي.`,
      );
    }
    if (device.state !== 'trusted') {
      throw new AuthnError(
        AUTHN_ERRORS.DEVICE_REVOKED,
        `الجهاز ${device.id} مسحوبةٌ ثقتُه بقرارٍ في الوثيقة؛ ورفضُه باسمِه لا مجهولاً كي يُقرأ في التحقيقِ قراراً لا عطلاً.`,
      );
    }

    // ── (3) عاملٌ ثانٍ حاضرٌ ثم صحيحٌ ثم غيرُ مستهلَك ──
    const { digits, stepSeconds, acceptedSkewSteps, algorithm } = this.#policy.secondFactor;
    const raw = typeof request?.factorCode === 'string' ? request.factorCode.trim() : '';
    if (raw === '') {
      throw new AuthnError(
        AUTHN_ERRORS.FACTOR_REQUIRED,
        'الجلسةُ القويةُ تشترط عاملاً ثانياً ولم يُقدَّم؛ ومفتاحُ التوقيعِ وحدَه عاملٌ واحدٌ، وهو ما جاءت هذه الخطوةُ لتغلقه.',
      );
    }
    if (!new RegExp(`^\\d{${digits}}$`).test(raw)) {
      throw new AuthnError(
        AUTHN_ERRORS.FACTOR_INVALID,
        `رمزُ العاملِ الثاني ليس على شكلِ ${digits} رقماً؛ ولا يُقاس ما ليس على شكلِ الرمزِ أصلاً.`,
      );
    }
    const secret = await this.#readSecret(device);
    const nowMs = this.#nowMs();
    const currentStep = Math.floor(nowMs / 1000 / stepSeconds);
    /** @type {number | null} */
    let matchedStep = null;
    for (let delta = -acceptedSkewSteps; delta <= acceptedSkewSteps; delta += 1) {
      const step = currentStep + delta;
      const expected = factorCodeForStep({ secret, step, digits, algorithm });
      // ولا خروجَ مبكرٌ عند أولِ مطابقة: الحلقةُ تمضي على كلِّ الخطواتِ المقبولةِ
      // كي لا يُقاس **أيُّ** خطوةٍ طابقت من زمنِ الردّ.
      if (constantTimeEqual(expected, raw) && matchedStep === null) matchedStep = step;
    }
    if (matchedStep === null) {
      throw new AuthnError(
        AUTHN_ERRORS.FACTOR_INVALID,
        'رمزُ العاملِ الثاني لا يطابق أيَّ خطوةٍ زمنيةٍ مقبولة؛ ولا يُذكر الرمزُ في هذه الرسالةِ ولا في قيدِها.',
      );
    }
    const stamp = `${device.id}:${matchedStep}`;
    if (this.#policy.secondFactor.singleUse) {
      // R5-B-03: القيدُ الدائمُ يُقرأ **قبل** سؤالِ الاستهلاكِ وبالأرضيّةِ نفسِها
      // التي يُقلِّم بها `#pruneConsumed`، وإلا اختلف ما يُحفظ عمّا يُستعاد.
      this.#restoreConsumed(log, currentStep - acceptedSkewSteps - 1);
    }
    if (this.#policy.secondFactor.singleUse && this.#consumed.has(stamp)) {
      throw new AuthnError(
        AUTHN_ERRORS.FACTOR_REPLAYED,
        `رمزُ العاملِ لخطوةِ ${matchedStep} مستهلَكٌ على الجهاز ${device.id}؛ ورمزٌ رُئي مرّةً — على شاشةٍ أو في لقطة — لا يفتح جلسةً ثانية.`,
      );
    }
    this.#consumed.add(stamp);
    this.#pruneConsumed(currentStep);
    // `WL-348`: منعُ إعادةِ الرمزِ بعدَ إعادةِ التشغيلِ يُقرأُ من هذا القيدِ (‏`#restoreConsumed`)،
    // فلا جلسةَ تُفتَحُ قبلَ أن يُختَمَ — وإلّا سقطَت العمليّةُ بعدَ الجلسةِ وقبلَ الختمِ فعادَ
    // الرمزُ نفسُه صالحاً. والبصمةُ تبقى مستهلَكةً في الذاكرةِ ولو سقطَ الختمُ (‏فشلٌ مغلق).
    await recordSealed(log, this.#policy.audit.factorConsumedEvent, actorId, {
      device: device.id,
      // خطوةُ الزمنِ تُسجَّل ولا يُسجَّل الرمز: من قرأ السجلَّ يعرف **أنّ** عاملاً
      // استُهلك ومتى، ولا يستخرج منه ما يُنتحل به.
      step: matchedStep,
    });

    // ── (4) جلسةٌ قصيرةٌ رمزُها ببصمتِه ──
    const { ttlSeconds, tokenBytes, digest } = this.#policy.session;
    const token = randomBytes(tokenBytes).toString('base64url');
    const fingerprint = createHash(digest).update(token).digest('hex');
    const expiresAtMs = nowMs + ttlSeconds * 1000;
    const sessionRef = randomBytes(8).toString('hex');
    this.#prune();
    this.#sessions.set(fingerprint, { actorId, deviceId: device.id, sessionRef, expiresAtMs });
    try {
      await recordSealed(log, this.#policy.audit.sessionOpenedEvent, actorId, {
        device: device.id,
        sessionRef,
        expiresAt: new Date(expiresAtMs).toISOString(),
        ttlSeconds,
      });
    } catch (error) {
      // جلسةٌ لم يُختَم قيدُ فتحِها لا تُسلَّم: تُحذَفُ ويُرفَعُ الخطأ.
      this.#sessions.delete(fingerprint);
      throw error;
    }
    return Object.freeze({
      token,
      actorId,
      deviceId: device.id,
      sessionRef,
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlSeconds,
    });
  }

  /**
   * حلُّ رمزِ جلسةٍ قويةٍ إلى وصفٍ يُقرأ. ولا تمديدَ هنا: المهلةُ من لحظةِ
   * الفتحِ لا من آخرِ استعمال — وجلسةٌ تُمدَّد بكلِّ نداءٍ جلسةٌ دائمةٌ اسمُها
   * قصيرة.
   * @param {string} token
   * @returns {{ actorId: string, deviceId: string, sessionRef: string, expiresAt: string }}
   */
  resolve(token) {
    const presented = typeof token === 'string' ? token : '';
    if (presented === '') {
      throw new AuthnError(
        AUTHN_ERRORS.SESSION_INVALID,
        'لا رمزَ جلسةٍ قويةٍ في النداء؛ وغيابُ الرمزِ غيابُ الجلسةِ لا حالةٌ وسطى تُتساهل فيها.',
      );
    }
    const fingerprint = createHash(this.#policy.session.digest).update(presented).digest('hex');
    const session = this.#sessions.get(fingerprint);
    if (session === undefined) {
      throw new AuthnError(
        AUTHN_ERRORS.SESSION_INVALID,
        'رمزُ الجلسةِ لا تعرفه المصادقة؛ ورمزٌ مجهولٌ يُرفض ولا يُبحث عن تأويلٍ يجعله مقبولاً.',
      );
    }
    if (this.#nowMs() >= session.expiresAtMs) {
      this.#sessions.delete(fingerprint);
      throw new AuthnError(
        AUTHN_ERRORS.SESSION_EXPIRED,
        'الجلسةُ القويةُ انتهت مهلتُها؛ والمهلةُ من لحظةِ الفتحِ لا من آخرِ استعمال، فلا تُمدَّد بالعملِ عليها.',
      );
    }
    return Object.freeze({
      actorId: session.actorId,
      deviceId: session.deviceId,
      sessionRef: session.sessionRef,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
    });
  }

  /**
   * الاشتراطُ على نوعِ أمرٍ: يرمي رفضاً مُسمّىً إن كان النوعُ مشترطاً ولم تُقدَّم
   * جلسةٌ قويةٌ قائمة. والقائمةُ **بياناتٌ** في الوثيقةِ لا شرطٌ في الكود.
   * @param {string | undefined} token
   * @param {string} kind
   * @returns {{ actorId: string, deviceId: string, sessionRef: string, expiresAt: string } | null}
   */
  requireForCommand(token, kind) {
    if (!this.#policy.assurance.requiredForCommandKinds.includes(kind)) return null;
    if (typeof token !== 'string' || token.trim() === '') {
      throw new AuthnError(
        AUTHN_ERRORS.ASSURANCE_INSUFFICIENT,
        `الأمرُ من نوع «${kind}» يشترط جلسةً قويةً بعاملٍ ثانٍ ولم تُقدَّم؛ وجلسةُ القراءةِ لا تُصدر أمراً سياديّاً.`,
        { kind },
      );
    }
    const resolved = this.resolve(token);
    const king = this.#king;
    if (king === null || resolved.actorId !== king.id) {
      throw new AuthnError(
        AUTHN_ERRORS.IDENTITY_UNVERIFIED,
        'الجلسةُ القويةُ المُقدَّمةُ ليست للملكِ الحاضرِ في هذا التركيب؛ وجلسةٌ لهويةٍ أخرى لا تُصدر أمراً سياديّاً.',
        { kind },
      );
    }
    return resolved;
  }

  /**
   * إغلاقُ جلسةٍ صراحةً — وإغلاقٌ صريحٌ أصدقُ من انتظارِ مهلةٍ تنقضي.
   * @param {string} token
   * @returns {boolean}
   */
  close(token) {
    const presented = typeof token === 'string' ? token : '';
    if (presented === '') return false;
    const fingerprint = createHash(this.#policy.session.digest).update(presented).digest('hex');
    const session = this.#sessions.get(fingerprint);
    if (session === undefined) return false;
    this.#sessions.delete(fingerprint);
    const log = this.#log;
    if (log !== null) {
      log.append(this.#policy.audit.sessionClosedEvent, session.actorId, {
        device: session.deviceId,
        sessionRef: session.sessionRef,
        reason: 'closed',
      });
    }
    return true;
  }

  /**
   * @param {KingAuthDevice} device
   * @returns {Promise<string>}
   */
  async #readSecret(device) {
    const secrets = this.#secrets;
    if (secrets === null) {
      throw new AuthnError(
        AUTHN_ERRORS.SECRET_MISSING,
        `مزوِّدُ أسرارِ العواملِ غيرُ موصولٍ بالمصادقة، وسرُّ ${device.factorRef} لا يُقرأ؛ فلا مصادقةَ — والغيابُ رفضٌ لا تخطٍّ للعاملِ الثاني.`,
      );
    }
    /** @type {string | null} */
    let material;
    try {
      material = await secrets.read(device.factorRef);
    } catch (error) {
      throw new AuthnError(
        AUTHN_ERRORS.SECRET_MISSING,
        `تعذّرت قراءةُ سرِّ العاملِ ${device.factorRef}: ${errorText(error)} — ولا يُتخطّى العاملُ الثاني لتعذُّرِ قراءةِ سرِّه.`,
      );
    }
    if (typeof material !== 'string' || material === '') {
      throw new AuthnError(
        AUTHN_ERRORS.SECRET_MISSING,
        `سرُّ العاملِ ${device.factorRef} غائبٌ من المزوِّد؛ وجهازٌ موثوقٌ بلا سرٍّ لا يُصادَق به ولا يُقبل بغيرِ عامل.`,
      );
    }
    return material;
  }

  /** يُسقط الجلساتَ المنتهيةَ — فذاكرةٌ تنمو بجلساتٍ ميّتةٍ ثغرةُ خدمةٍ لا حفظ. @returns {void} */
  #prune() {
    const now = this.#nowMs();
    for (const [fingerprint, session] of this.#sessions) {
      if (now >= session.expiresAtMs) this.#sessions.delete(fingerprint);
    }
  }

  /**
   * استعادةُ قيدِ الاستهلاكِ من **السجلِّ الدائمِ نفسِه** الذي تكتبُ فيه هذه
   * الطبقةُ كلَّ عاملٍ يُستهلَك (`audit.factorConsumedEvent` بجهازِه وخطوتِه).
   *
   * **العيبُ الذي يُغلقه هذا التابعُ، وقد قِيس لا افتُرض (نتيجةُ المجلسِ
   * `R5-B-03`):** كان `#consumed` مجموعةً في ذاكرةِ النسخةِ وحدَها، فنسخةٌ
   * جديدةٌ — بإعادةِ تشغيلِ العمليةِ أو بـ`new KingAuthenticator` بالسياسةِ
   * والمزوّدِ نفسيهما — تبدأ بمجموعةٍ فارغةٍ، فرمزٌ استُهلك وقُيِّد **على
   * القرصِ** يُقبل مرّةً ثانيةً داخلَ نافذةِ خطوتِه. والمِجسُّ أثبت ذلك: قيدا
   * استهلاكٍ على القرصِ وجلستانِ بالرمزِ الواحد.
   *
   * ولا مخزنَ جديدٍ هنا ولا استيرادَ من طبقةٍ أخرى: القيدُ الدائمُ كان مكتوباً
   * ولم يكن **مقروءاً**، وهذا التابعُ يقرأُه. وما لا يُغلقه معلَنٌ في حدودِ
   * الوحدةِ: نسختانِ تعملانِ **معاً** على سجلٍّ واحدٍ لا ترى إحداهما استهلاكَ
   * الأخرى بعد لحظةِ قراءتِها، وذاك دَينُ المخزنِ المشتركِ لا دَينُ هذا التابع.
   *
   * @param {AuthnLogLike} log
   * @param {number} floorStep أدنى خطوةٍ ما زالت في نافذةِ القبول
   * @returns {void}
   */
  #restoreConsumed(log, floorStep) {
    if (this.#consumedRestored) return;
    const reader = /** @type {{ eventsOfTypeSinceStep?: unknown }} */ (log).eventsOfTypeSinceStep;
    // والفشلُ مغلقٌ: القراءة المحدودة هي عقدُ الاستعادةِ؛ لا fallback إلى snapshot،
    // لأن ذلك يعيد نسخَ كاملِ التاريخ في كل إعادة تشغيل.
    if (typeof reader !== 'function') {
      throw new AuthnError(
        AUTHN_ERRORS.FACTOR_LEDGER_UNREADABLE,
        'قيدُ استهلاكِ العواملِ غيرُ مقروءٍ بواجهةِ القراءةِ المحدودة، ومنعُ الإعادةِ بلا قراءةٍ دائمةٍ لا يُدَّعى.',
      );
    }
    const events =
      /** @type {(type: string, minStep: number) => ReadonlyArray<{ type?: unknown, data?: unknown }>} */ (
        reader
      ).call(log, this.#policy.audit.factorConsumedEvent, floorStep);
    const consumedEvent = this.#policy.audit.factorConsumedEvent;
    for (const event of events) {
      if (event?.type !== undefined && event.type !== consumedEvent) continue;
      const data = /** @type {{ device?: unknown, step?: unknown }} */ (event.data ?? {});
      const { device, step } = data;
      if (typeof device === 'string' && typeof step === 'number' && step >= floorStep) {
        this.#consumed.add(`${device}:${step}`);
      }
    }
    this.#consumedRestored = true;
  }

  /**
   * يُسقط بصماتِ العواملِ التي خرجت خطوتُها من نافذةِ القبولِ أصلاً: رمزٌ خطوتُه
   * ماضيةٌ يُرفض بـ`AUTHN_FACTOR_INVALID` قبل أن يُسأل عن استهلاكِه، فحفظُه بعد
   * ذلك نموٌّ بلا فائدة.
   * @param {number} currentStep
   * @returns {void}
   */
  #pruneConsumed(currentStep) {
    const floor = currentStep - this.#policy.secondFactor.acceptedSkewSteps - 1;
    for (const stamp of this.#consumed) {
      const step = Number(stamp.slice(stamp.lastIndexOf(':') + 1));
      if (Number.isFinite(step) && step < floor) this.#consumed.delete(stamp);
    }
  }

  /**
   * قيدُ الرفض: برمزِه وسببِه، **بلا رمزِ عاملٍ ولا رمزِ جلسةٍ ولا بصمة**؛ ولا
   * يُبدِّل الرفضَ إن أخفق هو نفسُه.
   * @param {AuthnLogLike} log
   * @param {string} actorId
   * @param {string} deviceId
   * @param {unknown} error
   * @returns {void}
   */
  #logRefusal(log, actorId, deviceId, error) {
    try {
      log.append(this.#policy.audit.refusedEvent, actorId === '' ? 'unknown' : actorId, {
        device: deviceId === '' ? 'unknown' : deviceId,
        code: error instanceof AuthnError ? error.code : 'unnamed',
        reason: errorText(error),
      });
    } catch {
      // من أخفق تسجيلُ رفضِه يبقى مرفوضاً، ولا يُستبدَل خطأُ التسجيلِ بخطأِ
      // السببِ فيُخفيه.
    }
  }
}
