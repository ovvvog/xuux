/**
 * عميلُ سياجِ قاعدةِ البيانات (`WL-532`) — الطرفُ البرمجيُّ للهجرة `0024_fence`.
 *
 * ثلاثُ هويّاتٍ منفصلةٍ لا تتبادلُ مفاتيحَها (§4):
 *  - **السياديّ** (`FenceSovereign`): يملكُ مفتاحَ Ed25519 السياديّ، يوقّعُ RESUME/RECOVER/
 *    ROSTER_SET… ويتّصلُ بالقاعدةِ بدورِ `xf_sovereign`. القاعدةُ تتحقّقُ من التوقيعِ داخلَها.
 *  - **الجذر** (`FenceRoot`): يتّصلُ بدورِ `xf_root`، يُصدِرُ التحدّيات ويُتمُّ إصدارَ
 *    الاعتمادِ **بعدَ** أن يوقّعَ العاملُ التحدّيَ بمفتاحِه (`T-CRED-07`)، ويُجدِّدُ الإيجار،
 *    ويقودُ خطواتِ الإيقافِ الإحدى عشرة. لا يملكُ مفتاحَ أيِّ عامل.
 *  - **العامل** (`signCredentialChallenge`/`assertFencedSession`/`workerFenceHandshake`):
 *    يملكُ مفتاحَه عبرَ `KeyProvider`، يوقّعُ تحدّيَ إقلاعِه هو فقط، ويتّصلُ بدورِ إقلاعِه.
 *
 * ما لا تدّعيه: لا تحمي من superuser ولا من جذرِ نظامِ التشغيل؛ ولا تخترعُ ضماناً
 * عتادياً — `HardwareKeyProvider` واجهةٌ ترمي `KEY_PROVIDER_UNAVAILABLE` حتى يوفّرَ
 * المالكُ TPM/HSM حقيقياً (`D-11`).
 *
 * @module fence/db-fence
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createStrictHaltGuard, fileEpochFloor } from './halt-integrity.mjs';

export const SOVEREIGN_PREFIX = 'xuux-fence/sovereign/v1\n';
export const CREDENTIAL_PREFIX = 'xuux-fence/credential/v1';
export const SEAL_PREFIX = 'xuux-fence/seal/v1';

/** رموزُ أخطاءِ العميل. رموزُ القاعدةِ (`XFnnn`) تمرُّ كما هي في `error.code`. */
export const FENCE_ERRORS = Object.freeze({
  KEY_PROVIDER_UNAVAILABLE: 'FENCE_KEY_PROVIDER_UNAVAILABLE',
  CHALLENGE_MISMATCH: 'FENCE_CHALLENGE_MISMATCH',
  SESSION_NOT_FENCED: 'FENCE_SESSION_NOT_FENCED',
  HALT_INCOMPLETE: 'FENCE_HALT_INCOMPLETE',
  HANDSHAKE_FAILED: 'FENCE_HANDSHAKE_FAILED',
  WORKER_CONFIG: 'FENCE_WORKER_CONFIG',
  SEAL_REFUSED: 'FENCE_SEAL_REFUSED',
  EFFECTS_EVIDENCE_REJECTED: 'FENCE_EFFECTS_EVIDENCE_REJECTED',
  REAPER_ROLE: 'FENCE_REAPER_ROLE',
});

export class FenceError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {unknown} [detail]
   */
  constructor(code, message, detail) {
    super(message);
    this.name = 'FenceError';
    this.code = code;
    this.detail = detail;
  }
}

// ── المفاتيح ────────────────────────────────────────────────────────────────

/**
 * المفتاحُ العامُّ الخامُ (32 بايتاً) لمفتاحِ Ed25519 — الصيغةُ التي تحفظُها القاعدة.
 * @param {import('node:crypto').KeyObject | string} key - مفتاحٌ عامٌّ أو خاصّ (KeyObject أو PEM)
 * @returns {Buffer}
 */
export function rawEd25519PublicKey(key) {
  const keyObject =
    typeof key === 'string'
      ? key.includes('PRIVATE')
        ? createPublicKey(createPrivateKey(key))
        : createPublicKey(key)
      : key.type === 'private'
        ? createPublicKey(key)
        : key;
  if (keyObject.asymmetricKeyType !== 'ed25519') throw new TypeError('مفتاحُ Ed25519 مطلوب');
  const der = keyObject.export({ type: 'spki', format: 'der' });
  return Buffer.from(der.subarray(der.length - 32));
}

/**
 * مزوِّدُ مفتاحٍ: يوقّعُ ولا يُخرِجُ المفتاحَ الخاصّ. الواجهةُ نفسُها لـTPM/HSM لاحقاً.
 * @typedef {{ id: string, publicKeyRaw(): Buffer, sign(message: Buffer): Buffer, hardwareBacked: boolean }} KeyProvider
 */

/**
 * مزوِّدٌ من ملفِّ PKCS#8 — **للمختبرِ والاختبارِ فقط**؛ لا يدّعي حمايةً عتادية.
 * @param {string} path
 * @param {string} [id]
 * @returns {KeyProvider}
 */
export function fileKeyProvider(path, id = `file:${path}`) {
  const privateKey = createPrivateKey(readFileSync(path, 'utf8'));
  return keyObjectProvider(privateKey, id);
}

/**
 * مزوِّدٌ من نصِّ PKCS#8 في الذاكرة — يستعملُه العزلُ (مُقلِعُ `scripts/worker.mjs`) بعدَ قراءةِ المفتاحِ
 * من واصفٍ موروث. برمجيٌّ كالملفّ: لا يدّعي حمايةً عتادية.
 * @param {string} pem
 * @param {string} id
 * @returns {KeyProvider}
 */
export function pemKeyProvider(pem, id) {
  return keyObjectProvider(createPrivateKey(pem), id);
}

/**
 * مزوِّدٌ في الذاكرة بمفتاحٍ مولَّدٍ — اختباراتٌ فقط (`D-11`: مفاتيحُ اختبارٍ لا إنتاج).
 * @param {string} [id]
 * @returns {KeyProvider & { privateKeyPem: string }}
 */
export function generateTestKeyProvider(id = 'test') {
  const { privateKey } = generateKeyPairSync('ed25519');
  const provider = keyObjectProvider(privateKey, id);
  return {
    ...provider,
    privateKeyPem: String(privateKey.export({ type: 'pkcs8', format: 'pem' })),
  };
}

/**
 * @param {import('node:crypto').KeyObject} privateKey
 * @param {string} id
 * @returns {KeyProvider}
 */
function keyObjectProvider(privateKey, id) {
  const pub = rawEd25519PublicKey(privateKey);
  return Object.freeze({
    id,
    hardwareBacked: false,
    publicKeyRaw: () => Buffer.from(pub),
    sign: (message) => sign(null, message, privateKey),
  });
}

/**
 * واجهةُ TPM/HSM. لا تُنفَّذُ هنا: لا عتادَ في المختبر، واختراعُ ضمانٍ عتاديٍّ كذب.
 * @param {string} uri - معرّفُ المفتاحِ (مثل `pkcs11:` أو `tpm2:`)
 * @returns {KeyProvider}
 */
export function hardwareKeyProvider(uri) {
  const unavailable = () => {
    throw new FenceError(
      FENCE_ERRORS.KEY_PROVIDER_UNAVAILABLE,
      `مزوِّدُ المفاتيحِ العتاديُّ غيرُ متاح (${uri}): يتطلّبُ TPM/HSM يوفّرُه المالك — لم يُختبَر.`,
    );
  };
  return Object.freeze({
    id: uri,
    hardwareBacked: true,
    publicKeyRaw: unavailable,
    sign: unavailable,
  });
}

// ── الأوامرُ السيادية ─────────────────────────────────────────────────────────

/**
 * يبني حمولةَ أمرٍ سياديٍّ ويوقّعُها. الحمولةُ نصُّ JSON حرفياً (القاعدةُ تتحقّقُ من النصِّ
 * نفسِه، لا من إعادةِ ترميزِه).
 * @param {KeyProvider} key
 * @param {{ type: string, db: string, sysid: string, expectedEpoch: number, validitySeconds?: number,
 *           now?: Date, nonce?: string } & Record<string, unknown>} command
 * @returns {{ payload: string, signature: Buffer, nonce: string }}
 */
export function signSovereignCommand(key, command) {
  const {
    type,
    db,
    sysid,
    expectedEpoch,
    validitySeconds = 300,
    now = new Date(),
    nonce,
    ...extra
  } = command;
  const n = nonce ?? randomBytes(16).toString('hex');
  const payloadObject = {
    type,
    nonce: n,
    db,
    sysid,
    expected_epoch: expectedEpoch,
    not_before: new Date(now.getTime() - 5_000).toISOString(),
    not_after: new Date(now.getTime() + validitySeconds * 1_000).toISOString(),
    ...extra,
  };
  const payload = JSON.stringify(payloadObject);
  const signature = key.sign(Buffer.from(SOVEREIGN_PREFIX + payload, 'utf8'));
  return { payload, signature, nonce: n };
}

/**
 * يوقّعُ العاملُ تحدّيَ إقلاعِه — بعدَ أن يتحقّقَ أنّ التحدّيَ له هو، لإقلاعِه هو، وأنّ
 * الرسالةَ الموقَّعةَ هي حقولُ التحدّي نفسُها (لا يوقّعُ نصّاً يُمليه الجذرُ عمياناً).
 * @param {KeyProvider} key
 * @param {Record<string, unknown>} challenge - ما أرجعه `fence.issue_challenge`
 * @param {{ workerId: string, bootId: string }} self
 * @returns {Buffer}
 */
export function signCredentialChallenge(key, challenge, self) {
  const expected = [
    CREDENTIAL_PREFIX,
    challenge['db'],
    challenge['sysid'],
    self.workerId,
    self.bootId,
    challenge['epoch'],
    challenge['roster_version'],
    challenge['role_name'],
    challenge['nonce'],
  ]
    .map(String)
    .join('\n');
  if (
    challenge['worker_id'] !== self.workerId ||
    challenge['boot_id'] !== self.bootId ||
    challenge['message'] !== expected ||
    challenge['role_name'] !== `xw_${self.workerId}_${self.bootId.slice(0, 16)}`
  ) {
    throw new FenceError(
      FENCE_ERRORS.CHALLENGE_MISMATCH,
      'التحدّي ليس لهذا العاملِ أو لهذا الإقلاع — لا توقيع.',
    );
  }
  return key.sign(Buffer.from(expected, 'utf8'));
}

/** @returns {string} معرّفُ إقلاعٍ جديد (32 حرفاً سداسياً). */
export function newBootId() {
  return randomBytes(16).toString('hex');
}

/**
 * هاشُ JSON كما تحسبُه القاعدة (`sha256(detail::jsonb::text)`): يُحسَبُ في القاعدةِ نفسِها
 * لأنّ ترميزَ jsonb النصّيَّ يُرتِّبُ المفاتيحَ ويُباعِد — إعادةُ تنفيذِه في JS هشّة.
 * @param {{ query: Function }} db
 * @param {unknown} detail
 * @returns {Promise<string>}
 */
export async function jsonbDigest(db, detail) {
  const r = await db.query(
    "SELECT encode(sha256(convert_to($1::jsonb::text, 'UTF8')), 'hex') AS d",
    [JSON.stringify(detail)],
  );
  return String(r.rows[0].d);
}

/**
 * نتيجةُ `fence.reap_lapsed()`. `next_due_ms` (‏WL-545، الهجرة 0027): مللي ثوانٍ بساعةِ القاعدةِ حتى أقربِ انقضاءٍ لاعتمادٍ
 * نشِط — 0 لما انقضى أو سببُه قائم — ولا يتجاوزُ `lease_window_s` (‏اعتمادٌ يصدرُ بعدَ النداءِ لا ينقضي قبلَه)؛ وغائبٌ
 * (‏undefined) على قاعدةٍ قبلَ 0027، فيعودُ الحاصدُ إلى سقفِه. `lingering` (‏WL-552، الهجرة 0029): اعتماداتٌ غيرُ نشِطةٍ لها
 * جلساتٌ حيّةٌ بـ(‏pid، backend_start) — كلٌّ منها في `unresolved` أيضاً فـ`ok` = false حتى تموت؛ وغائبٌ قبلَ 0029.
 * @typedef {{ ok: boolean, reaped: Array<Record<string, unknown>>, unresolved: string[], lingering?: Array<{ role: string, status: string, signalled: number, sessions: Array<{ pid: number, backend_start: string }> }>, next_due_ms?: number | null }} LapseReapResult
 */

/** WL-548: أدنى إعادةٍ بعدَ فشلِ الحصاد (‏مث) — لا حلقةَ ساخنةً على القاعدة بأيِّ إعداد. */
export const REAPER_RETRY_FLOOR_MS = 10;

/**
 * WL-553: جدولُ تصنيفِ أخطاءِ الحاصد. **دائمٌ** = لا يزولُ بالانتظار (‏إعدادٌ أو صلاحيّةٌ أو هجرةٌ ناقصة) ⇒ بعدَ
 * `permanentLimit` متتاليةً تخرجُ العمليّةُ بـ78 (‏EX_CONFIG) فلا يُعيدُها المُشرِفُ بلا نهاية. **مؤقّتٌ** = انقطاعٌ أو إيقافٌ
 * أو ضغطُ موارد ⇒ إعادةٌ بتراجع. وما لا يطابقُ صفّاً **مجهولٌ** يُعادُ كالمؤقّت ولا يُخرِجُ — فلا يُقتَلُ الحاصدُ بخطأٍ لم يُفهَم.
 * لا كلُّ SQL دائم (‏57P01، 53300، 40001… مؤقّتة)، ولا كلُّ خطأِ اتصالٍ مؤقّت (‏28P01 وشهاداتُ TLS دائمة).
 * @type {ReadonlyArray<Readonly<{ class: 'permanent' | 'transient', codes?: readonly string[], prefixes?: readonly string[], messages?: readonly RegExp[], why: string }>>}
 */
export const REAPER_ERROR_TABLE = Object.freeze([
  {
    class: 'permanent',
    codes: ['28P01', '28000'],
    why: 'مصادقة: كلمةُ مرورٍ خاطئةٌ أو لا مدخلَ في pg_hba أو دورٌ بلا دخول',
  },
  { class: 'permanent', codes: ['3D000'], why: 'القاعدةُ المسمّاةُ في الوصلةِ غيرُ موجودة' },
  { class: 'permanent', codes: ['42501'], why: 'الدورُ لا يملكُ EXECUTE على reap_lapsed' },
  {
    class: 'permanent',
    codes: ['42883', '3F000', '42P01'],
    why: 'هجرةٌ ناقصة: دالّةٌ أو مخطّطٌ أو جدولٌ غيرُ موجود',
  },
  { class: 'permanent', codes: [FENCE_ERRORS.REAPER_ROLE], why: 'الوصلةُ بدورٍ غيرِ xf_sovereign' },
  {
    class: 'permanent',
    codes: [
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ],
    messages: [/^The server does not support SSL connections/, /^SASL: /],
    why: 'TLS أو SCRAM: شهادةٌ مرفوضةٌ أو خادمٌ بلا TLS أو كلمةُ مرورٍ غيرُ مضبوطةٍ في العميل',
  },
  { class: 'transient', prefixes: ['08'], why: 'صنفُ 08: استثناءُ اتصال (‏انقطاعٌ أو رفضٌ عابر)' },
  {
    class: 'transient',
    codes: ['57P01', '57P02', '57P03'],
    why: 'إيقافٌ إداريٌّ أو انهيارٌ أو قاعدةٌ تبدأُ/تتعافى',
  },
  {
    class: 'transient',
    prefixes: ['53'],
    why: 'صنفُ 53: نفادُ موارد (‏too_many_connections، ذاكرة، قرص)',
  },
  {
    class: 'transient',
    codes: ['40001', '40P01', '55P03', '57014', '25006'],
    why: 'تعارضٌ أو قفلٌ أو مهلةُ نداءٍ أو قاعدةٌ للقراءةِ بعدَ تحويل',
  },
  {
    class: 'transient',
    codes: [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EAI_AGAIN',
      'EPIPE',
      'ENOTFOUND',
    ],
    messages: [
      /^Connection terminated/,
      /^Query read timeout/,
      /timeout exceeded when trying to connect/,
    ],
    why: 'شبكة: المضيفُ أو المنفذُ أو الاسمُ غيرُ متاحٍ الآن، أو مهلةُ العميل (‏ENOTFOUND مؤقّتٌ: انقطاعُ DNS لا يُميَّزُ من خطأِ الاسم)',
  },
]);

/**
 * WL-553: يُصنِّفُ خطأَ الحاصدِ بـ`REAPER_ERROR_TABLE` — بالرمزِ أوّلاً (‏SQLSTATE أو رمزُ Node) ثمّ بالرسالة.
 * @param {unknown} error
 * @returns {{ class: 'permanent' | 'transient' | 'unknown', rule: string }}
 */
export function classifyReaperError(error) {
  const e = /** @type {any} */ (error);
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  for (const row of REAPER_ERROR_TABLE) {
    if (
      code !== '' &&
      (row.codes?.includes(code) ||
        row.prefixes?.some((p) => /^[0-9A-Z]{5}$/.test(code) && code.startsWith(p)))
    )
      return { class: row.class, rule: row.why };
  }
  for (const row of REAPER_ERROR_TABLE) {
    if (row.messages?.some((m) => m.test(message))) return { class: row.class, rule: row.why };
  }
  return { class: 'unknown', rule: 'لا صفَّ يطابق — يُعادُ كالمؤقّتِ ولا يُخرِج' };
}

/** WL-553: نسبةُ التذبذبِ النازل: التأخيرُ ∈ [max(retryMs، الأساس × (1 − 0.5))، الأساس]. */
export const REAPER_BACKOFF_JITTER = 0.5;

/**
 * WL-545: حاصدٌ مستقلٌّ عن حافظِ الإيجار. بلا هذا لا يُنادى `reap_lapsed` إلا عندَ رفضِ التجديدِ أو الإيقافِ أو المصافحة؛
 * فإن ماتت عمليّةُ الجذر (‏ومعها الحافظ) أو أوقفَ الحارسُ المحلّيُّ الحافظَ بقيت جلسةُ الإيجارِ المنقضي حيّةً تُرسِلُ NOTIFY
 * بلا حدّ (‏مقيسٌ على `db8de990`). يُنادي الحاصدَ عندَ `next_due_ms` (‏ساعةُ القاعدة، فلا انحرافَ بينَ ساعتَي المضيفَين)،
 * ولا ينامُ أكثرَ من `ceilingMs` (‏يلتقطُ ما لا موعدَ له: stale_epoch وno_lease وclock_regressed، وقاعدةً قبلَ 0027).
 *
 * **النشر:** يُشغَّلُ بوصلةِ السياديّ (‏`FenceSovereign`) في عمليّةٍ غيرِ عمليّةِ الجذر — فلا يموتُ معه؛ ويصحُّ بوصلةِ
 * الجذرِ كذلك. لا سلطةَ جديدة: الحاصدُ لا يُلغي إلا ما انقضى، والانقضاءُ لا يتراجع.
 * **الحدّ (‏مُعلَن):** النافذةُ = تأخّرُ المؤقِّت + زمنُ النداء، بسقفِ `ceilingMs` لما لا موعدَ له (‏وبعدَ تقصيرِ النافذةِ
 * بـlease_set تحتَ HALTED: نومٌ قائمٌ بالنافذةِ القديمةِ يحدُّه السقف)؛ وما دامت العمليّةُ نفسُها حيّة. وإن فشلَ النداءُ أُعيدَ بعدَ `retryMs` ويُبلَّغُ `onError` — لا يُعلَنُ حصادٌ لم يقع.
 * WL-546: استثناءٌ من `onReap`/`onError` لا يوقفُ الحاصد (‏يُعَدُّ في `stats().callbackErrors` ويُبلَّغُ `onCallbackError`).
 * @param {{ reapLapsed(): Promise<LapseReapResult> }} reaper - `FenceSovereign` أو `FenceRoot`
 * WL-553: **التراجعُ** — الفشلُ رقمُ n المتتالي يُعادُ بعدَ `min(maxRetryMs، retryMs × 2^(n−1))` منقوصاً بتذبذبٍ حتى النصفِ ولا
 * دونَ `retryMs` (‏أرضيّةُ #565 قائمةٌ: ≥ `REAPER_RETRY_FLOOR_MS`). `maxRetryMs` ∈ [retryMs، ceilingMs] — فالحاصدُ لا ينامُ فوقَ
 * سقفِه في أيِّ حال؛ وافتراضُه `retryMs` (‏إعادةٌ ثابتةٌ كما قبلُ لمن لم يطلبه). نداءٌ عادَ بنتيجةٍ (‏ولو ok=false) يُصفِّرُ العدّ.
 * `onError(error, { retryInMs, consecutiveErrors })`.
 * @param {{ ceilingMs: number, minDelayMs?: number, retryMs?: number, maxRetryMs?: number, random?: () => number,
 *           onReap?: (result: LapseReapResult) => void,
 *           onError?: (error: unknown, info: { retryInMs: number, consecutiveErrors: number }) => void,
 *           onCallbackError?: (error: unknown) => void }} options
 * @returns {{ stop(): Promise<void>, stopped: () => boolean, ticks: () => number,
 *             stats: () => { ticks: number, errors: number, reaped: number, unresolved: number, callbackErrors: number } }}
 */
export function startLapseReaper(reaper, options) {
  const ceilingMs = options.ceilingMs;
  if (!Number.isInteger(ceilingMs) || ceilingMs <= 0) {
    throw new TypeError('startLapseReaper: ceilingMs عددٌ صحيحٌ موجب');
  }
  const minDelayMs = options.minDelayMs ?? 5;
  const retryMs = options.retryMs ?? Math.min(1000, ceilingMs);
  // WL-548: الصفرُ كان مقبولاً — retryMs = 0 مع minDelayMs = 0 وفشلٍ دائمٍ = نحوُ 900 نداءٍ/ث على القاعدة (‏حلقةٌ ساخنة،
  // مقيسة). أرضيّةٌ لكلٍّ منهما: minDelayMs ≥ 1، وretryMs ≥ REAPER_RETRY_FLOOR_MS (‏≤ 100 محاولةٍ/ث عندَ الفشل).
  for (const [k, v, floor] of /** @type {const} */ ([
    ['minDelayMs', minDelayMs, 1],
    ['retryMs', retryMs, REAPER_RETRY_FLOOR_MS],
  ])) {
    if (!Number.isInteger(v) || Number(v) < floor || Number(v) > ceilingMs) {
      throw new TypeError(`startLapseReaper: ${k} عددٌ صحيحٌ بينَ ${floor} وceilingMs`);
    }
  }
  const maxRetryMs = options.maxRetryMs ?? retryMs;
  if (!Number.isInteger(maxRetryMs) || maxRetryMs < retryMs || maxRetryMs > ceilingMs) {
    throw new TypeError('startLapseReaper: maxRetryMs عددٌ صحيحٌ بينَ retryMs وceilingMs');
  }
  const random = options.random ?? Math.random;
  let consecutiveErrors = 0;
  /** تأخيرُ الفشلِ رقمِ n (‏≥ 1): أُسّيٌّ بسقفٍ ثمّ تذبذبٌ نازلٌ لا يعبرُ الأرضيّة. @param {number} n */
  const backoff = (n) => {
    const base = Math.min(maxRetryMs, retryMs * 2 ** Math.min(n - 1, 30));
    const jittered = Math.round(
      base * (1 - REAPER_BACKOFF_JITTER * Math.min(1, Math.max(0, random()))),
    );
    // ‏jittered ≤ base ≤ maxRetryMs، وretryMs ≤ maxRetryMs ⇒ الناتجُ في [retryMs، maxRetryMs] بلا قصٍّ ثانٍ.
    return Math.max(retryMs, jittered);
  };
  let stopped = false;
  const stats = { ticks: 0, errors: 0, reaped: 0, unresolved: 0, callbackErrors: 0 };
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** @type {Promise<void>} */
  let inflight = Promise.resolve();
  const schedule = (/** @type {number} */ ms) => {
    if (!stopped) timer = setTimeout(run, Math.max(minDelayMs, Math.min(ms, ceilingMs)));
  };
  /**
   * WL-546: استثناءٌ من نداءٍ راجعٍ (‏onReap/onError/onCallbackError) لا يُسقِطُ الجدولة: يُعَدُّ ويُبلَّغُ مرّةً
   * لـ`onCallbackError` (‏واستثناؤه هو يُبتلَع — لا سلسلةَ بلا نهاية)، والحاصدُ يمضي.
   * @param {((x: any) => void) | undefined} fn @param {unknown} arg
   */
  const safe = (fn, arg) => {
    if (fn === undefined) return;
    try {
      fn(arg);
    } catch (error) {
      stats.callbackErrors += 1;
      try {
        options.onCallbackError?.(error);
      } catch {
        // ‏مُبلِّغُ أخطاءِ النداءاتِ نفسُه رمى: لا يُعادُ إبلاغُه (‏عُدَّ أعلاه).
      }
    }
  };
  /** @param {((x: any, y: any) => void) | undefined} fn @param {unknown} arg @param {unknown} info */
  const safe2 = (fn, arg, info) => safe(fn === undefined ? undefined : (x) => fn(x, info), arg);
  const tick = async () => {
    stats.ticks += 1;
    /** @type {number} */
    let next = retryMs;
    try {
      /** @type {LapseReapResult} */
      let r;
      try {
        r = await reaper.reapLapsed();
      } catch (error) {
        stats.errors += 1;
        consecutiveErrors += 1;
        next = backoff(consecutiveErrors);
        if (!stopped) safe2(options.onError, error, { retryInMs: next, consecutiveErrors });
        return;
      }
      consecutiveErrors = 0;
      const reaped = Array.isArray(r?.reaped) ? r.reaped.length : 0;
      const unresolved = Array.isArray(r?.unresolved) ? r.unresolved.length : 0;
      stats.reaped += reaped;
      stats.unresolved += unresolved;
      if (reaped > 0 || r?.ok !== true) safe(options.onReap, r);
      // جلسةٌ بقيت حيّةً بعدَ الإلغاء (‏unresolved) أو نتيجةٌ غيرُ ok ⇒ إعادةٌ قريبة لا انتظارُ الموعد.
      if (r?.ok !== true) return;
      const due = r.next_due_ms;
      next = typeof due === 'number' && Number.isFinite(due) ? due : ceilingMs;
    } finally {
      // ‏الجدولةُ في finally: لا مسارَ (‏ولا استثناءَ غيرَ متوقَّع) يتركُ الحاصدَ بلا نداءٍ تالٍ إلا stop().
      schedule(next);
    }
  };
  const run = () => {
    timer = null;
    if (stopped) return;
    inflight = tick().catch(() => {});
  };
  run();
  return {
    stop: async () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      await inflight;
    },
    stopped: () => stopped,
    ticks: () => stats.ticks,
    stats: () => ({ ...stats }),
  };
}

/**
 * WL-546: حاصدُ عمليّةِ السياديّ — `startLapseReaper` فوقَ `FenceSovereign.reapLapsed()` بوصلةٍ تُفتَحُ عندَ الحاجة
 * وتُعادُ بعدَ كلِّ انقطاع. **بلا مفتاحِ توقيع** (‏`new FenceSovereign(client, null)`): العمليّةُ تحصدُ ولا تُصدِرُ أوامر.
 * يرفضُ البدءَ بدورٍ غيرِ `expectRole` (‏افتراضاً `xf_sovereign`) — فلا يُشغَّلُ بوصلةِ الجذرِ أو superuser صامتاً.
 * كلُّ حدثٍ سطرٌ في `log` (‏بلا سلسلةِ الاتصالِ ولا أسرار): `connected`، `reaped`، `unresolved`، `error`، `stopped`.
 * فشلُ الاتصالِ أو النداءِ = `error` وإعادةٌ بعدَ `retryMs` — لا يُعلَنُ حصادٌ لم يقع، ولا حلقةٌ ساخنة.
 * WL-553: كلُّ `error` يحملُ `class` (‏permanent/transient/unknown بـ`classifyReaperError`) و`rule` و`retry_in_ms`
 * و`consecutive_permanent` (‏الدائمةُ المتتالية؛ مؤقّتٌ أو مجهولٌ أو نداءٌ ناجحٌ يُصفِّرُها)، و`permanent_exhausted: true` مرّةً
 * عندَ بلوغِ `permanentLimit` (‏افتراضاً بلا حدّ) — والقرارُ (‏الخروجُ بـ78) لمُستدعيه.
 * @param {{ connect: () => Promise<import('pg').ClientBase & { end?: Function, on?: Function }>,
 *           ceilingMs: number, minDelayMs?: number, retryMs?: number, maxRetryMs?: number, permanentLimit?: number,
 *           expectRole?: string,
 *           log?: (event: Record<string, unknown>) => void }} options
 */
export function runSovereignReaper(options) {
  const expectRole = options.expectRole ?? 'xf_sovereign';
  const log = options.log ?? (() => {});
  /** @type {(import('pg').ClientBase & { end?: Function, on?: Function }) | null} */
  let client = null;
  let connects = 0;
  let consecutivePermanent = 0;
  const permanentLimit = options.permanentLimit ?? Number.POSITIVE_INFINITY;
  if (!(
    permanentLimit === Number.POSITIVE_INFINITY ||
    (Number.isInteger(permanentLimit) && permanentLimit >= 1)
  )) {
    throw new TypeError('runSovereignReaper: permanentLimit عددٌ صحيحٌ ≥ 1');
  }
  const drop = async () => {
    const c = client;
    client = null;
    if (c !== null && typeof c.end === 'function') await Promise.resolve(c.end()).catch(() => {});
  };
  const describe = (/** @type {any} */ e) => ({
    code: e?.code ?? null,
    message: String(e?.message ?? e).slice(0, 300),
  });
  const reaper = {
    async reapLapsed() {
      if (client === null) {
        const c = await options.connect();
        c.on?.('error', () => {});
        try {
          const who = (await c.query('SELECT current_user AS u, session_user AS s')).rows[0];
          if (who.u !== expectRole || who.s !== expectRole) {
            throw new FenceError(
              FENCE_ERRORS.REAPER_ROLE,
              `حاصدُ السياديّ: الدورُ ${who.s}/${who.u} ليس ${expectRole} — لا حصادَ بوصلةٍ أخرى`,
            );
          }
        } catch (error) {
          await Promise.resolve(c.end?.()).catch(() => {});
          throw error;
        }
        // ‏startLapseReaper لا يُداخلُ نداءَين (‏التالي يُجدوَلُ بعدَ انتهاءِ السابق) — فلا سباقَ على client.
        // eslint-disable-next-line require-atomic-updates
        client = c;
        connects += 1;
        log({ ev: 'connected', role: expectRole, connects });
      }
      try {
        const r = await new FenceSovereign(client, null).reapLapsed();
        consecutivePermanent = 0;
        return r;
      } catch (error) {
        await drop();
        throw error;
      }
    },
  };
  const handle = startLapseReaper(reaper, {
    ceilingMs: options.ceilingMs,
    ...(options.minDelayMs === undefined ? {} : { minDelayMs: options.minDelayMs }),
    ...(options.retryMs === undefined ? {} : { retryMs: options.retryMs }),
    ...(options.maxRetryMs === undefined ? {} : { maxRetryMs: options.maxRetryMs }),
    onReap: (r) => {
      for (const x of r.reaped ?? []) log({ ev: 'reaped', ...x });
      if (r.ok !== true) log({ ev: 'unresolved', unresolved: r.unresolved ?? [] });
    },
    onError: (e, info) => {
      const c = classifyReaperError(e);
      consecutivePermanent = c.class === 'permanent' ? consecutivePermanent + 1 : 0;
      log({
        ev: 'error',
        ...describe(e),
        class: c.class,
        rule: c.rule,
        retry_in_ms: info.retryInMs,
        consecutive_permanent: consecutivePermanent,
        permanent_exhausted: consecutivePermanent === permanentLimit,
      });
    },
    onCallbackError: (e) => log({ ev: 'callback_error', ...describe(e) }),
  });
  return {
    async stop() {
      await handle.stop();
      await drop();
      const st = { ...handle.stats(), connects };
      log({ ev: 'stopped', ...st });
      return st;
    },
    stats: () => ({ ...handle.stats(), connects }),
  };
}

// ── السياديّ ─────────────────────────────────────────────────────────────────

export class FenceSovereign {
  /**
   * @param {{ query: Function }} db - اتصالٌ بدورِ `xf_sovereign`
   * @param {KeyProvider | null} key - WL-546: `null` لعمليّةٍ تحصدُ ولا توقِّع (‏حاصدُ السياديّ) — فـ`sign` يرفض
   */
  constructor(db, key) {
    this.db = db;
    this.key = key;
  }

  /** @returns {Promise<Record<string, any>>} */
  async status() {
    const r = await this.db.query('SELECT fence.status() AS s');
    return r.rows[0].s;
  }

  /**
   * WL-542: حصادُ كلِّ اعتمادٍ نشِطٍ انقضى إيجارُه (‏إلغاءٌ، NOLOGIN، إنهاءُ جلساتِه) — بلا جذر.
   * `ok=false` و`unresolved` غيرُ الفارغِ يعني جلسةً بقيت حيّة: ليس نجاحاً.
   * @returns {Promise<LapseReapResult>}
   */
  async reapLapsed() {
    const r = await this.db.query('SELECT fence.reap_lapsed() AS r');
    return r.rows[0].r;
  }

  /**
   * يبني أمراً على الحالةِ الحيّةِ ويوقّعُه ويُرسلُه.
   * @param {string} fn - `resume` | `recover` | `roster_set` | `breakglass_set` | `lease_set` | `key_rotate`
   * @param {Record<string, unknown>} [extra]
   * @param {{ expectedEpoch?: number, validitySeconds?: number, nonce?: string }} [opts]
   * @returns {Promise<Record<string, any>>}
   */
  async command(fn, extra = {}, opts = {}) {
    const s = await this.status();
    const signed = this.sign(fn, s, extra, opts);
    const r = await this.db.query(`SELECT fence.${fn}($1, $2) AS r`, [
      signed.payload,
      signed.signature,
    ]);
    return r.rows[0].r;
  }

  /**
   * التوقيعُ وحده (لاختباراتِ الإعادةِ والتزوير).
   * @param {string} fn
   * @param {Record<string, any>} s - `fence.status()`
   * @param {Record<string, unknown>} extra
   * @param {{ expectedEpoch?: number, validitySeconds?: number, nonce?: string }} [opts]
   */
  sign(fn, s, extra, opts = {}) {
    if (this.key === null) {
      throw new FenceError(
        FENCE_ERRORS.KEY_PROVIDER_UNAVAILABLE,
        'FenceSovereign بلا مفتاح: لا توقيعَ لأمرٍ سياديّ',
      );
    }
    return signSovereignCommand(this.key, {
      type: fn.toUpperCase(),
      db: s.live.dbname,
      sysid: s.live.sysid,
      expectedEpoch: opts.expectedEpoch ?? Number(s.bound.epoch),
      ...(opts.validitySeconds === undefined ? {} : { validitySeconds: opts.validitySeconds }),
      ...(opts.nonce === undefined ? {} : { nonce: opts.nonce }),
      ...extra,
    });
  }

  /** @param {Array<{ worker_id: string, pubkey: Buffer, os_principal: string }>} workers */
  rosterSet(workers) {
    return this.command('roster_set', {
      workers: workers.map((w) => ({
        worker_id: w.worker_id,
        pubkey: w.pubkey.toString('hex'),
        os_principal: w.os_principal,
      })),
    });
  }

  /** @param {string[]} roles */
  breakglassSet(roles) {
    return this.command('breakglass_set', { roles });
  }

  /** يستردُّ من RECOVERY_REQUIRED مُسمِّياً التجسُّدَ الحيَّ (بعد مراجعةِ المالك). */
  async recover() {
    const s = await this.status();
    const extra = {
      pm_start_epoch: String(s.live.pm_start_epoch),
      timeline: Number(s.live.timeline),
    };
    if (s.effective.problem === 'control_seal_mismatch')
      Object.assign(extra, { reseal_from: s.bound.seal });
    const signed = this.sign('recover', s, extra);
    const r = await this.db.query('SELECT fence.recover($1, $2) AS r', [
      signed.payload,
      signed.signature,
    ]);
    return r.rows[0].r;
  }

  /**
   * يستأنفُ — بعدَ أن يراجعَ دليلَ الآثارِ ويوقّعَ هاشَه. **لا يوقّعُ عمياناً:** يرفضُ قبلَ
   * التوقيعِ إن لم يجتزِ الدليلُ `reviewEffectsEvidence` (انظرها لما يُتحقَّقُ منه وما لا يُمكن).
   * @param {string} effectsEvidenceSha256
   */
  async resume(effectsEvidenceSha256) {
    const s = await this.status();
    const review = reviewEffectsEvidence(s, effectsEvidenceSha256);
    if (!review.ok) {
      throw new FenceError(
        FENCE_ERRORS.EFFECTS_EVIDENCE_REJECTED,
        `السياديُّ يرفضُ توقيعَ RESUME: ${review.problems.join('؛ ')}`,
        review,
      );
    }
    const signed = this.sign('resume', s, {
      roster_hash: s.bound.roster_hash,
      pm_start_epoch: String(s.live.pm_start_epoch),
      effects_evidence_sha256: effectsEvidenceSha256,
    });
    const r = await this.db.query('SELECT fence.resume($1, $2) AS r', [
      signed.payload,
      signed.signature,
    ]);
    return r.rows[0].r;
  }
}

/**
 * مراجعةُ السياديِّ لدليلِ الآثارِ قبلَ توقيعِ RESUME — ما يستطيعُ التحقّقَ منه **مستقلّاً عن
 * الجذر** (من حالةِ القاعدةِ التي يقرؤها بوصلتِه هو):
 *  - الدليلُ موجودٌ في العهدِ الحاليّ، وهو آخرُ دليلِ آثار، ونوعُه EFFECTS_HALTED، وهاشُه هو
 *    الذي سيوقّعه؛
 *  - `ok === true` صريحاً، و`halt_id`/`epoch` في التفاصيلِ يطابقان ما ختمته القاعدةُ في
 *    `binding` وآخرَ إيقافٍ مكتمل؛
 *  - القائمةُ والتجسُّدُ المختومان في `binding` يطابقان الحالةَ الحيّة؛
 *  - الحالةُ HALTED فعلاً.
 * **ما لا يستطيعه:** أن يُثبتَ صدقَ الوقائعِ الخارجية (cgroup فارغ، منافذُ مغلقة) — تلك
 * ادّعاءُ الجذرِ الذي قاسها. الهاشُ يمنعُ تغييرَها بعدَ التسجيل لا كذبَها عندَه.
 * @param {Record<string, any>} status - `fence.status()`
 * @param {string} sha256
 * @returns {{ ok: boolean, problems: string[], evidence: Record<string, any> | null }}
 */
export function reviewEffectsEvidence(status, sha256) {
  const problems = [];
  const ev = status?.effects_evidence ?? null;
  const bound = status?.bound ?? {};
  if (status?.effective?.state !== 'HALTED')
    problems.push(`الحالةُ ${status?.effective?.state} لا HALTED`);
  if (ev === null) problems.push('لا دليلَ آثارٍ في هذا العهد');
  else {
    if (ev.kind !== 'EFFECTS_HALTED') problems.push(`آخرُ دليلٍ ${ev.kind}`);
    if (ev.sha256 !== sha256) problems.push('الهاشُ المطلوبُ توقيعُه ليس آخرَ دليل');
    if (ev.detail?.ok !== true) problems.push('ok ليس true');
    const b = ev.binding ?? {};
    if (Number(ev.detail?.halt_id) !== Number(b.halt_id))
      problems.push('halt_id في التفاصيلِ ≠ المختوم');
    if (Number(b.halt_id) !== Number(status?.latest_complete_halt))
      problems.push('الدليلُ ليس لآخرِ إيقافٍ مكتمل');
    if (Number(ev.detail?.epoch) !== Number(bound.epoch) || Number(b.epoch) !== Number(bound.epoch))
      problems.push('عهدُ الدليلِ ≠ العهدِ الحاليّ');
    if (b.roster_hash !== bound.roster_hash) problems.push('القائمةُ تغيّرت بعدَ الدليل');
    const inc = b.incarnation ?? {};
    const live = status?.live ?? {};
    if (
      inc.sysid !== live.sysid ||
      String(inc.pm_start_epoch) !== String(live.pm_start_epoch) ||
      Number(inc.timeline) !== Number(live.timeline)
    )
      problems.push('تجسُّدُ القاعدةِ تغيّرَ بعدَ الدليل');
  }
  return { ok: problems.length === 0, problems, evidence: ev };
}

// ── ختمُ الجلسات ─────────────────────────────────────────────────────────────

/**
 * نصُّ رسالةِ الختمِ كما تبنيه `fence.seal_sessions` حرفياً.
 * @param {{ db: string, sysid: string, workerId: string, bootId: string, epoch: number | string,
 *           roleName: string }} ctx
 * @param {Array<{ pid: number, start: string }>} sessions
 * @returns {string}
 */
export function sealMessage(ctx, sessions) {
  const list = [...sessions]
    .sort((a, b) => Number(a.pid) - Number(b.pid))
    .map((t) => `${Number(t.pid)}:${String(t.start)}`)
    .join(',');
  return [
    SEAL_PREFIX,
    ctx.db,
    ctx.sysid,
    ctx.workerId,
    ctx.bootId,
    String(ctx.epoch),
    ctx.roleName,
    list,
  ].join('\n');
}

/**
 * يختمُ العاملُ جلساتِه: يجمعُ وسمَ كلِّ وصلةٍ يملكُها، يوقّعُ المجموعةَ بمفتاحِه، ويطلبُ من
 * القاعدةِ أن تقصرَ الاعتمادَ عليها وتُغلقَ الدخول. أيُّ جلسةٍ أخرى للدورِ (عمليةٌ ثانيةٌ بالـUID
 * نفسِه) تُفشلُ الختمَ وتُلغي الاعتماد — فشلٌ مغلق.
 * @param {Array<{ query: Function }>} clients - كلُّ وصلاتِ العامل، مفتوحةً
 * @param {KeyProvider} key
 * @param {{ db: string, sysid: string, workerId: string, bootId: string, epoch: number | string,
 *           roleName: string }} ctx
 * @returns {Promise<Array<{ pid: number, start: string }>>}
 */
export async function sealFencedSessions(clients, key, ctx) {
  if (clients.length === 0) throw new FenceError(FENCE_ERRORS.SEAL_REFUSED, 'لا وصلاتٍ للختم');
  const sessions = [];
  for (const c of clients) {
    const tag = (await c.query('SELECT fence.session_tag() AS t')).rows[0].t;
    if (tag === null || tag === undefined) {
      throw new FenceError(FENCE_ERRORS.SEAL_REFUSED, 'وسمُ الجلسةِ غيرُ متاح');
    }
    sessions.push({ pid: Number(tag.pid), start: String(tag.start) });
  }
  if (new Set(sessions.map((t) => t.pid)).size !== sessions.length) {
    throw new FenceError(FENCE_ERRORS.SEAL_REFUSED, 'وصلتان بالجلسةِ نفسِها');
  }
  const signature = key.sign(Buffer.from(sealMessage(ctx, sessions), 'utf8'));
  const first = /** @type {{ query: Function }} */ (clients[0]);
  const r = (
    await first.query('SELECT fence.seal_sessions($1::jsonb, $2) AS r', [
      JSON.stringify(sessions),
      signature,
    ])
  ).rows[0].r;
  if (r?.sealed !== true) {
    throw new FenceError(
      FENCE_ERRORS.SEAL_REFUSED,
      `رفضت القاعدةُ الختم (${r?.reason}) — الاعتمادُ أُلغي`,
      r,
    );
  }
  return sessions;
}

/**
 * يفتحُ `size` وصلةً في المجمّعِ ويختمُها كلَّها، ثمّ يُعيدُها إليه. المجمّعُ في وضعِ السياجِ
 * لا يُغلقُ الخاملَ (`idleTimeoutMillis: 0`) فلا يحتاجُ وصلةً جديدة؛ وأيُّ وصلةٍ جديدةٍ بعدَ
 * الختمِ تُرفَضُ (الدورُ NOLOGIN) — انقطاعٌ يعني إقلاعاً جديداً، لا ثغرة.
 * @param {import('pg').Pool} pool
 * @param {number} size
 * @param {KeyProvider} key
 * @param {Parameters<typeof sealFencedSessions>[2]} ctx
 */
export async function sealFencedPool(pool, size, key, ctx) {
  /** @type {import('pg').PoolClient[]} */
  const held = [];
  // رفضُ الختمِ يُنهي جلساتِ الدورِ الأخرى في القاعدة؛ وصلةٌ محجوزةٌ تُطلقُ عندئذٍ 'error' بلا
  // مستمعٍ فتُسقطُ العمليةَ قبلَ أن تُبلغَ المُشرِفَ بالفشل. نستمعُ أثناءَ الحجزِ ونُعيدُ المُنهاةَ
  // إلى المجمّعِ مُتلَفة (release(err)) فلا تُعادُ إلى الاستعمال.
  /** @type {Map<import('pg').PoolClient, unknown>} */
  const broken = new Map();
  /** @type {Map<import('pg').PoolClient, (error: unknown) => void>} */
  const listeners = new Map();
  try {
    for (let i = 0; i < size; i++) {
      const c = await pool.connect();
      const onError = (/** @type {unknown} */ error) => broken.set(c, error);
      c.on('error', onError);
      listeners.set(c, onError);
      held.push(c);
    }
    return await sealFencedSessions(held, key, ctx);
  } finally {
    for (const c of held) {
      const onError = listeners.get(c);
      if (onError) c.removeListener('error', onError);
      const error = broken.get(c);
      c.release(error instanceof Error ? error : undefined);
    }
  }
}

/**
 * طرفُ المُشرِف بعدَ الإصدار: ينتظرُ إبلاغَ العاملِ بختمِه عبرَ IPC، ويقارنُه بما ختمته القاعدة.
 * غيابُ الإبلاغ، أو إبلاغُ فشل، أو اختلافُ المجموعة (عمليةٌ أخرى ختمت) ⇒ يُلغي الاعتماد.
 * @param {FenceRoot} root
 * @param {{ on: Function, off: Function }} child
 * @param {Record<string, any>} credential
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Array<{ pid: number, start: string }>>}
 */
export function confirmWorkerSeal(root, child, credential, options = {}) {
  const role = String(credential['role_name']);
  return new Promise((resolve, reject) => {
    const fail = async (/** @type {string} */ why) => {
      child.off('message', onMessage);
      clearTimeout(timer);
      await root.revokeCredential(role, `SEAL_NOT_CONFIRMED:${why}`).catch(() => {});
      reject(
        new FenceError(FENCE_ERRORS.SEAL_REFUSED, `الختمُ لم يتأكّد (${why}) — أُلغي ${role}`),
      );
    };
    const timer = setTimeout(() => void fail('timeout'), options.timeoutMs ?? 15_000);
    /** @param {any} message */
    const onMessage = async (message) => {
      if (message?.type === 'xuux-fence/seal-failed') return fail(String(message.reason));
      if (message?.type !== 'xuux-fence/sealed' || message.role_name !== role) return;
      try {
        const db = await root.credentialSeal(role);
        const reported = stableStringify(
          [...(message.sessions ?? [])].sort((a, b) => Number(a.pid) - Number(b.pid)),
        );
        if (
          db?.status !== 'ACTIVE' ||
          db?.sealed !== true ||
          stableStringify(db.sessions) !== reported
        ) {
          return fail('mismatch');
        }
        child.off('message', onMessage);
        clearTimeout(timer);
        resolve(db.sessions);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    };
    child.on('message', onMessage);
  });
}

// ── الجذر ────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ stop(): Promise<{ ok: boolean, detail: Record<string, unknown> }> }} EffectsStopper
 */

export class FenceRoot {
  /**
   * @param {() => Promise<import('pg').ClientBase & { release?: Function, end?: Function }>} connect - يفتحُ اتصالاً بدورِ `xf_root`
   * @param {{ lockTimeoutMs?: number, maxHaltAttempts?: number, log?: (event: Record<string, unknown>) => void }} [options]
   */
  constructor(connect, options = {}) {
    this.connect = connect;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.maxHaltAttempts = options.maxHaltAttempts ?? 5;
    this.log = options.log ?? (() => {});
  }

  /**
   * @template T
   * @param {(c: import('pg').ClientBase) => Promise<T>} work
   * @returns {Promise<T>}
   */
  async with(work) {
    const c = await this.connect();
    try {
      return await work(c);
    } finally {
      if (typeof c.release === 'function') c.release();
      else if (typeof c.end === 'function') await c.end();
    }
  }

  /** @param {string} sql @param {unknown[]} [params] */
  async one(sql, params = []) {
    return this.with(async (c) => (await c.query(sql, params)).rows[0]);
  }

  /** @param {string} workerId @param {string} bootId */
  async issueChallenge(workerId, bootId) {
    return (await this.one('SELECT fence.issue_challenge($1, $2) AS r', [workerId, bootId])).r;
  }

  /** @param {string} nonce @param {Buffer} workerSignature */
  async completeCredential(nonce, workerSignature) {
    return (await this.one('SELECT fence.issue_credential($1, $2) AS r', [nonce, workerSignature]))
      .r;
  }

  /**
   * الإصدارُ الكاملُ حين يكونُ مفتاحُ العاملِ في يدِ موقِّعٍ منفصل (دالّةٌ تمثّلُ العامل).
   * @param {string} workerId
   * @param {string} bootId
   * @param {(challenge: Record<string, unknown>) => Promise<Buffer> | Buffer} workerSigns
   */
  async issueCredential(workerId, bootId, workerSigns) {
    const challenge = await this.issueChallenge(workerId, bootId);
    const signature = await workerSigns(challenge);
    return this.completeCredential(String(challenge['nonce']), signature);
  }

  /** @param {string} role */
  async renewLease(role) {
    return (await this.one('SELECT fence.renew_lease($1) AS r', [role])).r;
  }

  /** @param {string} role */
  async credentialSeal(role) {
    return (await this.one('SELECT fence.credential_seal($1) AS r', [role])).r;
  }

  /** @param {string} role @param {string} reason */
  async revokeCredential(role, reason) {
    return (await this.one('SELECT fence.revoke_credential($1, $2) AS r', [role, reason])).r;
  }

  /**
   * WL-542: حصادُ الاعتماداتِ المنقضيةِ إيجاراتُها (‏انظر FenceSovereign.reapLapsed).
   * @returns {Promise<LapseReapResult>}
   */
  async reapLapsed() {
    return (await this.one('SELECT fence.reap_lapsed() AS r')).r;
  }

  async status() {
    return (await this.one('SELECT fence.status() AS r')).r;
  }

  async checkFenced() {
    return (await this.one('SELECT fence.check_fenced() AS r')).r;
  }

  /**
   * حافظُ الإيجار: يُجدِّدُ **فقط** ما دام الحارسُ الصارمُ يقرأُ RUNNING. أوّلُ قراءةٍ غيرِ
   * RUNNING أو أوّلُ رفضٍ من القاعدةِ يوقفُه ولا يُعيدُه — فالإيجارُ ينقضي وحدَه.
   * WL-542: وعندَ رفضِ القاعدةِ يُنادي الحاصدَ مرّةً (‏أفضلُ جهد) قبلَ `onStop` — فالإيجارُ المنقضي لا يُترَكُ
   * بجلساتٍ حيّةٍ تُرسِلُ NOTIFY؛ ونتيجةُ الحصادِ (‏أو خطؤه) تُمرَّرُ في `onReap`.
   * @param {string} role
   * @param {{ assertOperational(): void }} haltGuard
   * @param {{ intervalMs: number, onStop?: (reason: unknown) => void, onReap?: (result: unknown) => void }} options
   * @returns {{ stop(): void, stopped: () => boolean }}
   */
  startLeaseKeeper(role, haltGuard, options) {
    let stopped = false;
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    const stop = (/** @type {unknown} */ reason) => {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      options.onStop?.(reason);
    };
    const tick = async () => {
      if (stopped) return;
      try {
        haltGuard.assertOperational();
      } catch (error) {
        stop(error);
        return;
      }
      try {
        await this.renewLease(role);
      } catch (error) {
        if (stopped) return;
        let reap;
        try {
          reap = await this.reapLapsed();
        } catch (reapError) {
          reap = reapError;
        }
        options.onReap?.(reap);
        stop(error);
        return;
      }
      if (!stopped) timer = setTimeout(tick, options.intervalMs);
    };
    timer = setTimeout(tick, options.intervalMs);
    return { stop: () => stop('stopped'), stopped: () => stopped };
  }

  /**
   * الإيقافُ بخطواتِه الإحدى عشرة (§7). كلُّ فشلٍ يُبقي القاعدةَ مغلقة (HALT_REQUESTED
   * لا RUNNING) ويُرجِعُ `systemHaltComplete=false` مع السبب.
   *
   *  1. تسجيلُ طلبِ الإيقاف (`halt_request`) — 2. الحارسُ يرفضُ كلَّ كتابةٍ جديدةٍ فوراً
   *  3. قفلُ صفِّ التحكّمِ خطّياً (`halt_lock`، بمهلة) — 4. انتظارُ المعاملاتِ السابقة؛ إن
   *     طال: إلغاءٌ وإنهاءٌ ثمّ إعادة — 5. إلغاءُ الاعتمادات — 6. منعُ الدخول —
   *  7. إنهاءُ الجلسات — 8..10. الفحصُ الحيّ `check_fenced()` وانتقالُ HALTED —
   *  11. إيقافُ الآثارِ الخارجيةِ وتسجيلُ دليلِها.
   * @param {string} reason
   * @param {{ effects?: EffectsStopper | null, faults?: Record<string, () => void> }} [options]
   */
  async halt(reason, options = {}) {
    const faults = options.faults ?? {};
    const steps = [];
    const haltId = Number((await this.one('SELECT fence.halt_request($1) AS r', [reason])).r);
    steps.push({ step: 1, haltId });
    faults['afterRequest']?.();
    let locked = null;
    for (let attempt = 1; attempt <= this.maxHaltAttempts && locked === null; attempt++) {
      try {
        locked = await this.with(async (c) => {
          await c.query('BEGIN');
          try {
            await c.query(
              `SET LOCAL lock_timeout = '${Math.max(1, Math.trunc(this.lockTimeoutMs))}ms'`,
            );
            const r = (await c.query('SELECT fence.halt_lock($1) AS r', [haltId])).rows[0].r;
            await c.query('COMMIT');
            return r;
          } catch (error) {
            await c.query('ROLLBACK').catch(() => {});
            throw error;
          }
        });
        steps.push({ step: 3, attempt, locked });
      } catch (error) {
        const code = /** @type {{ code?: string }} */ (error).code;
        if (code !== '55P03') throw error;
        // (4) معاملةٌ سابقةٌ تمسكُ FOR SHARE: لا ننتظرُها بلا حدّ — نُلغي ونُنهي ثمّ نُعيد.
        const killed = (await this.one('SELECT fence.halt_revoke_and_terminate($1) AS r', [haltId]))
          .r;
        steps.push({ step: 4, attempt, lockTimeout: true, killed });
      }
    }
    if (locked === null) {
      return {
        haltId,
        systemHaltComplete: false,
        dbFenced: false,
        reason: 'LOCK_NOT_ACQUIRED',
        steps,
      };
    }
    faults['afterLock']?.();
    let complete = null;
    for (let attempt = 1; attempt <= this.maxHaltAttempts; attempt++) {
      const revoked = (await this.one('SELECT fence.halt_revoke_and_terminate($1) AS r', [haltId]))
        .r;
      steps.push({ step: 5, attempt, revoked });
      faults['afterRevoke']?.();
      complete = (await this.one('SELECT fence.halt_complete($1) AS r', [haltId])).r;
      steps.push({ step: 8, attempt, dbFenced: complete.db_fenced, sha256: complete.sha256 });
      if (complete.db_fenced === true) break;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
    if (complete === null || complete.db_fenced !== true) {
      return {
        haltId,
        systemHaltComplete: false,
        dbFenced: false,
        reason: 'DB_NOT_FENCED',
        check: complete?.check,
        steps,
      };
    }
    faults['afterDbFenced']?.();
    // (11) الآثارُ الخارجية. DB_FENCED وحده ليس اكتمالاً.
    if (!options.effects) {
      return {
        haltId,
        systemHaltComplete: false,
        dbFenced: true,
        reason: 'EFFECTS_NOT_STOPPED',
        steps,
      };
    }
    /** @type {{ ok: boolean, detail: Record<string, unknown> }} */
    let effects;
    try {
      effects = await options.effects.stop();
    } catch (error) {
      // موقِفُ الآثارِ نفسُه فشل: لا نعرفُ حالَ الآثار ⇒ ok=false (يُسجَّلُ إن أمكن).
      effects = {
        ok: false,
        detail: { stop_error: error instanceof Error ? error.message : String(error) },
      };
    }
    // الحقولُ المُلزِمةُ بعدَ التفاصيل: لا يكتبُ موقِفُ الآثارِ فوقَ halt_id أو epoch أو ok.
    const detail = {
      ...effects.detail,
      halt_id: haltId,
      epoch: complete.epoch,
      ok: effects.ok === true,
    };
    let digest;
    try {
      digest = await this.with((c) => jsonbDigest(c, detail));
      await this.one('SELECT fence.record_effects_evidence($1, $2::jsonb) AS r', [
        digest,
        JSON.stringify(detail),
      ]);
    } catch (error) {
      // تعذّرُ تسجيلِ الدليل: القاعدةُ مُسيَّجةٌ (HALTED) لكن RESUME مستحيلٌ بلا دليل.
      steps.push({ step: 11, effectsOk: effects.ok === true, recordError: String(error) });
      return {
        haltId,
        systemHaltComplete: false,
        dbFenced: true,
        reason: 'EFFECTS_EVIDENCE_NOT_RECORDED',
        steps,
      };
    }
    steps.push({ step: 11, effectsOk: effects.ok === true, digest });
    return {
      haltId,
      systemHaltComplete: effects.ok === true,
      dbFenced: true,
      effectsEvidenceSha256: effects.ok === true ? digest : null,
      reason: effects.ok ? null : 'EFFECTS_NOT_STOPPED',
      steps,
    };
  }
}

// ── العامل ───────────────────────────────────────────────────────────────────

/**
 * يتحقّقُ العاملُ أنّ جلستَه **الآن** هي اعتمادُ إقلاعِه النشِطُ في عهدِ RUNNING. يُنادى قبلَ
 * أيِّ عمل؛ لا يُغني عن الزنادِ (القاعدةُ تفرضُ) لكنّه يُفشِلُ الإقلاعَ مبكّراً وبوضوح.
 * @param {{ query: Function }} db
 * @param {{ workerId: string, bootId?: string }} self
 * @returns {Promise<Record<string, any>>}
 */
export async function assertFencedSession(db, self) {
  const who = (await db.query('SELECT fence.whoami() AS w')).rows[0].w;
  const ok =
    who.known === true &&
    who.worker_id === self.workerId &&
    (self.bootId === undefined || who.boot_id === self.bootId) &&
    who.credential_status === 'ACTIVE' &&
    who.sealed === true &&
    who.session_sealed === true &&
    who.state === 'RUNNING' &&
    Number(who.epoch) === Number(who.credential_epoch);
  if (!ok) {
    throw new FenceError(
      FENCE_ERRORS.SESSION_NOT_FENCED,
      `الجلسةُ ليست اعتمادَ إقلاعٍ نشِطاً: ${JSON.stringify(who)}`,
      who,
    );
  }
  return who;
}

/**
 * مصافحةُ العاملِ مع مُشرِفِه (الجذر) عبرَ قناةِ IPC لـNode: العاملُ يُعلِنُ إقلاعَه، يتلقّى
 * التحدّي، يوقّعُه بمفتاحِه هو، ويتلقّى اسمَ دورِ إقلاعِه. الجذرُ لا يرى المفتاحَ أبداً.
 * @param {KeyProvider} key
 * @param {{ workerId: string, bootId: string, timeoutMs?: number,
 *           channel?: { send: Function, on: Function, off: Function } }} self
 * @returns {Promise<{ role_name: string, epoch: number, lease_renew_s: number, db: string, sysid: string }>}
 */
export function workerFenceHandshake(key, self) {
  const channel = self.channel ?? /** @type {any} */ (process);
  if (typeof channel.send !== 'function') {
    return Promise.reject(
      new FenceError(
        FENCE_ERRORS.HANDSHAKE_FAILED,
        'لا قناةَ IPC مع المُشرِف (XUUX_DB_FENCE=required يتطلّبُ إطلاقاً من مُشرِفِ السياج).',
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.off('message', onMessage);
      reject(new FenceError(FENCE_ERRORS.HANDSHAKE_FAILED, 'انقضت مهلةُ المصافحة'));
    }, self.timeoutMs ?? 15_000);
    /** @type {Record<string, unknown> | null} */
    let seen = null;
    /** @param {any} message */
    const onMessage = (message) => {
      if (message?.type === 'xuux-fence/challenge') {
        seen = message.challenge;
        try {
          const signature = signCredentialChallenge(key, message.challenge, self);
          channel.send({
            type: 'xuux-fence/pop',
            nonce: message.challenge.nonce,
            signature: signature.toString('hex'),
          });
        } catch (error) {
          clearTimeout(timer);
          channel.off('message', onMessage);
          reject(error);
        }
      } else if (message?.type === 'xuux-fence/credential') {
        clearTimeout(timer);
        channel.off('message', onMessage);
        // سياقُ رسالةِ الختمِ من التحدّي الذي تحقّقَ منه العاملُ ووقّعه (لا ممّا يُمليه لاحقاً).
        resolve({ ...message.credential, db: seen?.['db'], sysid: seen?.['sysid'] });
      } else if (message?.type === 'xuux-fence/refused') {
        clearTimeout(timer);
        channel.off('message', onMessage);
        reject(
          new FenceError(
            FENCE_ERRORS.HANDSHAKE_FAILED,
            `رفضَ المُشرِفُ الإصدار: ${message.reason}`,
          ),
        );
      }
    };
    channel.on('message', onMessage);
    channel.send({ type: 'xuux-fence/hello', worker_id: self.workerId, boot_id: self.bootId });
  });
}

/**
 * الطرفُ المقابلُ للمصافحة في المُشرِف: يُجيبُ رسالةَ `hello` من عمليةٍ ابنةٍ بإصدارِ اعتماد.
 * @param {FenceRoot} root
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ expectedWorkerId: string }} options
 * @returns {Promise<Record<string, any>>} الاعتمادُ الصادر
 */
export function superviseWorkerHandshake(root, child, options) {
  return new Promise((resolve, reject) => {
    /** @type {Record<string, unknown> | null} */
    let challenge = null;
    /** @param {any} message */
    const onMessage = async (message) => {
      try {
        if (message?.type === 'xuux-fence/hello') {
          if (message.worker_id !== options.expectedWorkerId) throw new Error('عاملٌ غيرُ متوقَّع');
          challenge = await root.issueChallenge(message.worker_id, message.boot_id);
          child.send({ type: 'xuux-fence/challenge', challenge });
        } else if (
          message?.type === 'xuux-fence/pop' &&
          challenge !== null &&
          message.nonce === challenge['nonce']
        ) {
          const credential = await root.completeCredential(
            String(challenge['nonce']),
            Buffer.from(String(message.signature), 'hex'),
          );
          child.off('message', onMessage);
          child.send({ type: 'xuux-fence/credential', credential });
          resolve(credential);
        }
      } catch (error) {
        child.off('message', onMessage);
        child.send?.({
          type: 'xuux-fence/refused',
          reason: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      }
    };
    child.on('message', onMessage);
  });
}

/**
 * وصلةُ قاعدةٍ لدورِ إقلاع: يُستبدَلُ المستخدمُ في `DATABASE_URL` ويُحذَفُ أيُّ سرّ — الدورُ
 * بلا كلمةِ مرور ويُصادَقُ بـpeer (المقبس) أو بشهادةِ عميل (`T-CRED-05`).
 * @param {string} databaseUrl
 * @param {string} roleName
 * @returns {string}
 */
export function fencedDatabaseUrl(databaseUrl, roleName) {
  const url = new URL(databaseUrl);
  url.username = roleName;
  url.password = '';
  return url.toString();
}

/**
 * بصمةٌ ثابتةٌ لكائن (للأدلّة): SHA-256 لـJSON مرتّبِ المفاتيح.
 * @param {unknown} value
 * @returns {string}
 */
export function stableDigest(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** @param {unknown} value @returns {string} */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(/** @type {any} */ (value)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** قيمُ `XUUX_DB_FENCE` المقبولة: غيابٌ (الوضعُ القائمُ بلا سياج) أو `required`. */
export const DB_FENCE_MODES = Object.freeze(['', 'required']);

/**
 * يقرأُ وضعَ السياجِ من البيئة. قيمةٌ غيرُ معروفةٍ تُرفَضُ لا تُقرأُ «بلا سياج» صامتة.
 * @param {NodeJS.ProcessEnv} env
 * @returns {'' | 'required'}
 */
export function dbFenceMode(env) {
  const mode = (env['XUUX_DB_FENCE'] ?? '').trim();
  if (!DB_FENCE_MODES.includes(mode)) {
    throw new FenceError(
      FENCE_ERRORS.WORKER_CONFIG,
      `XUUX_DB_FENCE=«${mode}» غيرُ معروف — المقبول: required أو الغياب.`,
    );
  }
  return /** @type {'' | 'required'} */ (mode);
}

/**
 * إقلاعُ العاملِ في وضعِ السياج (`XUUX_DB_FENCE=required`) — يُستدعى من `scripts/worker.mjs`
 * قبلَ إنشاءِ مجمّعِ القاعدة. الترتيبُ مقصود:
 *  1. الحارسُ المركّب: `HaltSwitch` القائمُ **و**القراءةُ الصارمة (`D-14`) بحدِّ عهدٍ خارجيّ
 *     (`XUUX_HALT_EPOCH_FLOOR`). لا إقلاعَ إلا في RUNNING صارم.
 *  2. مصافحةٌ مع المُشرِف (الجذر) عبرَ IPC: العاملُ يوقّعُ تحدّيَ إقلاعِه بمفتاحِه
 *     (`XUUX_FENCE_WORKER_KEY`) — الجذرُ لا يرى المفتاح، ولا يُصدِرُ بدونِه (`T-CRED-07`).
 *  3. وصلةُ قاعدةٍ بدورِ الإقلاعِ بلا سرّ (peer/شهادة: `T-CRED-05`).
 *  4. `verify(db)`: يُثبتُ قبلَ أيِّ عملٍ أنّ الجلسةَ هي اعتمادُ هذا الإقلاعِ النشِط.
 * @param {{ env: NodeJS.ProcessEnv, halt: { assertOperational(): void, file: string, epochFile: string,
 *           historyFile: string, nodesDir: string, acksDir: string, king: any },
 *           channel?: { send: Function, on: Function, off: Function }, timeoutMs?: number,
 *           isolated?: { key: KeyProvider, evidence: Readonly<Record<string, unknown>> } }} input
 */
export async function prepareFencedWorker(input) {
  const { env, halt } = input;
  /** @param {string} name */
  const required = (name) => {
    const value = (env[name] ?? '').trim();
    if (value === '') {
      throw new FenceError(FENCE_ERRORS.WORKER_CONFIG, `${name} مطلوبٌ في وضعِ السياج.`);
    }
    return value;
  };
  const workerId = required('XUUX_FENCE_WORKER_ID');
  // `WL-533`: مفتاحٌ قرأه العزلُ من واصفٍ موروثٍ (العاملُ أسقطَ هويّتَه) — أو مسارُ ملفٍّ (المختبر،
  // ومكشوفٌ لعملياتِ الـUID نفسِه: `LAB-UID-05`). لا يُقبَلُ الاثنانِ معاً.
  if (input.isolated !== undefined && (env['XUUX_FENCE_WORKER_KEY'] ?? '').trim() !== '') {
    throw new FenceError(
      FENCE_ERRORS.WORKER_CONFIG,
      'مفتاحٌ معزولٌ ومسارُ ملفِّ مفتاحٍ معاً: يُرفَض.',
    );
  }
  // مراجعةُ #546: تشغيلٌ يُعلِنُ العزلَ إلزاميّاً لا يتراجعُ صامتاً إلى مسارِ الملفّ.
  if (input.isolated === undefined && (env['XUUX_FENCE_ISOLATION'] ?? '').trim() === 'required') {
    throw new FenceError(
      FENCE_ERRORS.WORKER_CONFIG,
      'XUUX_FENCE_ISOLATION=required ولا مفتاحَ معزول: لا تراجعَ إلى XUUX_FENCE_WORKER_KEY.',
    );
  }
  const keyPath = input.isolated === undefined ? required('XUUX_FENCE_WORKER_KEY') : null;
  const floorPath = required('XUUX_HALT_EPOCH_FLOOR');
  const databaseUrl = required('DATABASE_URL');
  const strict = createStrictHaltGuard(halt, { epochFloor: fileEpochFloor(floorPath) });
  const haltGuard = Object.freeze({
    assertOperational() {
      halt.assertOperational();
      strict.assertOperational();
    },
    strict,
  });
  haltGuard.assertOperational();
  const key =
    input.isolated === undefined
      ? fileKeyProvider(/** @type {string} */ (keyPath), `worker:${workerId}`)
      : input.isolated.key;
  const bootId = newBootId();
  const credential = await workerFenceHandshake(key, {
    workerId,
    bootId,
    ...(input.channel === undefined ? {} : { channel: input.channel }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  });
  const channel = input.channel ?? /** @type {any} */ (process);
  const sealCtx = {
    db: String(credential.db),
    sysid: String(credential.sysid),
    workerId,
    bootId,
    epoch: credential.epoch,
    roleName: String(credential.role_name),
  };
  return {
    workerId,
    bootId,
    credential,
    haltGuard,
    hardwareBacked: key.hardwareBacked,
    processIsolation: input.isolated?.evidence ?? null,
    databaseUrl: fencedDatabaseUrl(databaseUrl, String(credential.role_name)),
    /**
     * يختمُ كلَّ وصلاتِ المجمّعِ (`size` = حجمُه الأقصى) ويُبلغُ المُشرِف. فشلُ الختمِ يُبلَغُ
     * ثمّ يُرمى — العاملُ لا يعمل.
     * @param {import('pg').Pool} pool @param {number} size
     */
    seal: async (pool, size) => {
      try {
        const sessions = await sealFencedPool(pool, size, key, sealCtx);
        channel.send?.({ type: 'xuux-fence/sealed', role_name: sealCtx.roleName, sessions });
        return sessions;
      } catch (error) {
        channel.send?.({
          type: 'xuux-fence/seal-failed',
          role_name: sealCtx.roleName,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    /** @param {{ query: Function }} db */
    verify: (db) => assertFencedSession(db, { workerId, bootId }),
  };
}
