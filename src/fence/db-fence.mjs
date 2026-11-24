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
  randomUUID,
  sign,
} from 'node:crypto';
import { EventEmitter } from 'node:events';
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
  ORPHAN_SWEEP_INCOMPLETE: 'FENCE_ORPHAN_SWEEP_INCOMPLETE',
  BOOT_GATE_CLOSED: 'FENCE_BOOT_GATE_CLOSED',
  BOOT_GATE_STATE: 'FENCE_BOOT_GATE_STATE',
  BOOT_GATE_TIMEOUT: 'FENCE_BOOT_GATE_TIMEOUT',
  BOOT_GATE_CANCELLED: 'FENCE_BOOT_GATE_CANCELLED',
  // ‏LIVE-75 (‏WL-604): المُشرِفُ المركّب `FenceSupervisor` — رموزُ العميلِ وحدَه، لا رمزَ قاعدةٍ جديد.
  SUPERVISOR_LOCKED: 'FENCE_SUPERVISOR_LOCKED',
  SUPERVISOR_LOCK_LOST: 'FENCE_SUPERVISOR_LOCK_LOST',
  SUPERVISOR_STATE: 'FENCE_SUPERVISOR_STATE',
  SUPERVISOR_NOT_RUNNING: 'FENCE_SUPERVISOR_NOT_RUNNING',
  SUPERVISOR_REAPER_START: 'FENCE_SUPERVISOR_REAPER_START',
  SUPERVISOR_DB_UNREACHABLE: 'FENCE_SUPERVISOR_DB_UNREACHABLE',
  SUPERVISOR_WORKER_BOOT: 'FENCE_SUPERVISOR_WORKER_BOOT',
});

/** سببُ الإلغاءِ الافتراضيُّ لاعتمادٍ يتيمٍ عندَ إقلاعِ المُشرِف (‏TH-SUP-05، WL-577). */
export const ORPHAN_REVOKE_REASON = 'SUPERVISOR_BOOT_ORPHAN';

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
  {
    class: 'permanent',
    codes: [FENCE_ERRORS.REAPER_ROLE],
    why: 'الوصلةُ بدورٍ غيرِ المتوقَّع (‏xf_sovereign أو xf_reaper)',
  },
  {
    class: 'permanent',
    codes: ['XF520', 'XF521', 'XF523'],
    why: 'باب 0030: دخولٌ بغيرِ xf_reaper، أو سقفٌ/مهلةٌ خارجَ الحدود، أو إعداداتٌ دائمةٌ على xf_reaper',
  },
  {
    class: 'transient',
    codes: ['XF522', 'XF525'],
    why: 'باب 0030: النسخةُ مربوطةٌ بوصلةٍ لم تمت بعد (‏إعادةُ اتصال)، أو نتيجةُ حصادٍ غيرُ مقروءة',
  },
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
 * WL-559 (‏الخيار A، مستوى المستودعِ وحدَه — لا تنصيبَ ولا مضيف): وحدةُ systemd للحاصدِ بدورِ `xf_reaper`. نصٌّ يُولَّدُ
 * ويُراجَعُ ويُتحقَّقُ منه آليّاً (‏`systemd-analyze verify`) — **لا يُثبِتُ نشراً**.
 *
 * - **لا سرّ:** الوصلةُ peer عبرَ مقبسِ Unix (‏`user=xf_reaper` بلا كلمةِ مرور؛ الدورُ `VALID UNTIL '-infinity'` في 0030)،
 *   فلا كلمةَ مرورٍ في الوسائطِ ولا في البيئةِ ولا في السجلّ؛ والمُدخلاتُ تُرفَضُ إن حملت ما يكسرُ سطرَ الوحدة.
 * - **الإعادةُ بتصنيفِ الأخطاء:** المؤقّتُ والمجهولُ يُعادانِ داخلَ العمليّةِ بتراجع (‏WL-553)؛ فالعمليّةُ لا تخرجُ إلّا بـ0
 *   (‏إشارة) أو 2 (‏استعمالٌ/دور) أو 78 (‏دائمٌ متكرّر) أو انهيارٍ غيرِ متوقَّع. `Restart=on-failure` و
 *   `RestartPreventExitStatus=2 78` ⇒ لا إعادةَ للدائم؛ و`StartLimitBurst` في `StartLimitIntervalSec` ⇒ الانهيارُ المتكرّرُ
 *   يتوقّفُ ولا يدورُ بلا نهاية (‏الوحدةُ تصيرُ failed فتُرى).
 * - **أقلُّ امتياز:** `UMask=0077`، بلا قدرات، `NoNewPrivileges`، نظامُ ملفّاتٍ للقراءة، `PrivateNetwork` و`AF_UNIX` وحدَه،
 *   ومرشِّحُ نداءاتٍ نظاميّة. `MemoryDenyWriteExecute=no` مُعلَن: V8 يحتاجُ صفحاتٍ قابلةً للكتابةِ والتنفيذ.
 * - **الرقابةُ خارجَ مضيفِ القاعدة:** `--health` (‏بوصلةِ `xf_auditor`) من مضيفٍ آخر — الوحدةُ لا تُراقِبُ نفسَها.
 * @param {{ node?: string, script?: string, user?: string, database?: string, socketDir?: string,
 *           ceilingMs?: number, queryTimeoutMs?: number, retryMs?: number, maxRetryMs?: number, permanentLimit?: number,
 *           heartbeatMs?: number }} [o]
 * @returns {string}
 */
export function renderReaperUnit(o = {}) {
  const path = (/** @type {string} */ name, /** @type {string} */ v) => {
    if (!/^\/[A-Za-z0-9._/-]+$/.test(v) || v.includes('..') || v.includes('//')) {
      throw new TypeError(`renderReaperUnit: ${name} مسارٌ مطلقٌ بلا مسافةٍ ولا محارفَ خاصّة`);
    }
    return v;
  };
  const ident = (/** @type {string} */ name, /** @type {string} */ v) => {
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(v))
      throw new TypeError(`renderReaperUnit: ${name} ∈ [a-z_][a-z0-9_-]{0,31}`);
    return v;
  };
  const num = (
    /** @type {string} */ name,
    /** @type {number} */ v,
    /** @type {number} */ lo,
    /** @type {number} */ hi,
  ) => {
    if (!Number.isInteger(v) || v < lo || v > hi)
      throw new TypeError(`renderReaperUnit: ${name} ∈ [${lo}، ${hi}]`);
    return v;
  };
  const node = path('node', o.node ?? '/usr/bin/node');
  const script = path('script', o.script ?? '/opt/xuux/scripts/fence-sovereign-reaper.mjs');
  const user = ident('user', o.user ?? 'xuux-reaper');
  const database = ident('database', o.database ?? 'xuux');
  const socketDir = path('socketDir', o.socketDir ?? '/var/run/postgresql');
  const ceilingMs = num('ceilingMs', o.ceilingMs ?? 5000, 1, 300000);
  const queryTimeoutMs = num('queryTimeoutMs', o.queryTimeoutMs ?? 10000, 2000, 300000);
  const retryMs = num('retryMs', o.retryMs ?? 1000, 10, ceilingMs);
  const maxRetryMs = num('maxRetryMs', o.maxRetryMs ?? ceilingMs, retryMs, ceilingMs);
  const permanentLimit = num('permanentLimit', o.permanentLimit ?? 5, 1, 1000);
  const heartbeatMs = num('heartbeatMs', o.heartbeatMs ?? 10000, 0, 3600000);
  return [
    '# WL-559 — وحدةُ الحاصد (‏xf_reaper، الهجرة 0030). مولَّدةٌ بـ`fence-sovereign-reaper.mjs --print-unit`.',
    '# تصميمٌ على مستوى المستودعِ وحدَه: لا تنصيبَ ولا مضيف. التحقّقُ الآليُّ لا يُثبِتُ نشراً.',
    '# لا سرّ: peer عبرَ مقبسِ Unix. الرقابةُ من خارجِ مضيفِ القاعدة: `--health` بوصلةِ xf_auditor.',
    '[Unit]',
    'Description=XUUX fence lapse reaper (xf_reaper, peer over Unix socket)',
    'After=postgresql.service',
    'Wants=postgresql.service',
    'StartLimitIntervalSec=300',
    'StartLimitBurst=5',
    '',
    '[Service]',
    'Type=simple',
    `User=${user}`,
    `Group=${user}`,
    'UMask=0077',
    `ExecStart=${node} ${script} --role reaper --ceiling-ms ${ceilingMs} --query-timeout-ms ${queryTimeoutMs} --retry-ms ${retryMs} --max-retry-ms ${maxRetryMs} --permanent-limit ${permanentLimit} --heartbeat-ms ${heartbeatMs}`,
    `Environment=XUUX_REAPER_DATABASE_URL=postgresql:///${database}?host=${socketDir}&user=xf_reaper`,
    'Environment=NODE_OPTIONS=',
    'PassEnvironment=',
    'Restart=on-failure',
    'RestartSec=2',
    'RestartPreventExitStatus=2 78',
    'KillSignal=SIGTERM',
    'TimeoutStopSec=15',
    'StandardOutput=journal',
    'StandardError=journal',
    'NoNewPrivileges=yes',
    'CapabilityBoundingSet=',
    'AmbientCapabilities=',
    'ProtectSystem=strict',
    'ProtectHome=yes',
    'PrivateTmp=yes',
    'PrivateDevices=yes',
    'PrivateNetwork=yes',
    'IPAddressDeny=any',
    'ProtectProc=invisible',
    'ProcSubset=pid',
    'ProtectHostname=yes',
    'ProtectClock=yes',
    'ProtectKernelTunables=yes',
    'ProtectKernelModules=yes',
    'ProtectKernelLogs=yes',
    'ProtectControlGroups=yes',
    'RestrictAddressFamilies=AF_UNIX',
    'RestrictNamespaces=yes',
    'RestrictRealtime=yes',
    'RestrictSUIDSGID=yes',
    'RemoveIPC=yes',
    'LockPersonality=yes',
    'MemoryDenyWriteExecute=no',
    'SystemCallArchitectures=native',
    'SystemCallFilter=@system-service',
    'SystemCallFilter=~@privileged @resources',
    'SystemCallErrorNumber=EPERM',
    'MemoryMax=256M',
    'TasksMax=32',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

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
 *           expectRole?: string, mode?: 'sovereign' | 'reaper', instance?: string, queryTimeoutMs?: number,
 *           log?: (event: Record<string, unknown>) => void }} options
 * WL-558: `mode: 'reaper'` (‏الهجرة 0030) — دورُ `xf_reaper` وبابُه `fence.reaper_tick(instance، ceilingMs، queryTimeoutMs)`
 * بنسخةٍ (‏`instance`، افتراضاً UUID لكلِّ عمليّة) تربطُها القاعدةُ بـ(‏pid، backend_start). `tick_error` = خطأٌ بلا إسقاطِ الوصلة.
 */
export function runSovereignReaper(options) {
  const mode = options.mode ?? 'sovereign';
  if (mode !== 'sovereign' && mode !== 'reaper') {
    throw new TypeError('runSovereignReaper: mode ∈ {sovereign، reaper}');
  }
  const expectRole = options.expectRole ?? (mode === 'reaper' ? 'xf_reaper' : 'xf_sovereign');
  // WL-558: وضعُ الحاصدِ (‏0030) يُصرِّحُ للقاعدةِ بسقفِه ومهلتِه في كلِّ نبضة — فعتبةُ القِدَمِ في reaper_health هي ما
  // يعملُ به فعلاً (‏ceiling + 2 × المهلة + slack). المهلةُ نفسُها تُضبَطُ على الوصلة (‏اتصالاً ونداءً) عندَ المُستدعي.
  const instance = options.instance ?? randomUUID();
  const queryTimeoutMs = options.queryTimeoutMs;
  if (mode === 'reaper') {
    if (
      !Number.isInteger(options.ceilingMs) ||
      options.ceilingMs < 1 ||
      options.ceilingMs > 300000
    ) {
      throw new TypeError('runSovereignReaper(reaper): ceilingMs ∈ [1، 300000]');
    }
    if (
      !Number.isInteger(queryTimeoutMs) ||
      Number(queryTimeoutMs) < 2000 ||
      Number(queryTimeoutMs) > 300000
    ) {
      throw new TypeError('runSovereignReaper(reaper): queryTimeoutMs ∈ [2000، 300000]');
    }
  }
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
        log({
          ev: 'connected',
          role: expectRole,
          connects,
          ...(mode === 'reaper' ? { instance } : {}),
        });
      }
      /** @type {LapseReapResult & { tick_error?: { sqlstate?: string, message?: string } }} */
      let r;
      try {
        r =
          mode === 'reaper'
            ? (
                await client.query('SELECT fence.reaper_tick($1, $2, $3) AS r', [
                  instance,
                  options.ceilingMs,
                  queryTimeoutMs,
                ])
              ).rows[0].r
            : await new FenceSovereign(client, null).reapLapsed();
      } catch (error) {
        await drop();
        throw error;
      }
      // ‏WL-558: فشلُ الحصادِ داخلَ البابِ نبضةٌ فاشلةٌ مُسجَّلة (‏لا last_ok_at) — خطأٌ بالـSQLSTATE الداخليّ يُصنَّفُ كغيرِه،
      // والوصلةُ تبقى (‏القاعدةُ أجابت؛ لا داعيَ لإعادةِ اتصالٍ تُضاعِفُ النافذة).
      if (r !== null && typeof r === 'object' && r.tick_error !== undefined) {
        const te = r.tick_error;
        throw Object.assign(
          new Error(`reaper_tick: ${String(te?.message ?? 'فشلُ الحصاد').slice(0, 300)}`),
          {
            code: typeof te?.sqlstate === 'string' ? te.sqlstate : 'XF525',
            tickError: true,
          },
        );
      }
      consecutivePermanent = 0;
      return r;
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
    instance: () => (mode === 'reaper' ? instance : null),
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

  /**
   * WL-579: الإصدارُ يمرُّ ببوابةِ الإقلاع (‏`SupervisorBootGate`) المربوطةِ بهذا الجذر — بلا بوابةٍ أو قبلَ
   * نجاحِ كنسِها ⇒ `FENCE_BOOT_GATE_CLOSED` ولا نداءَ للقاعدة.
   * @param {string} workerId @param {string} bootId
   */
  async issueChallenge(workerId, bootId) {
    return bootGateOf(this, 'issueChallenge').issueChallenge(workerId, bootId);
  }

  /**
   * WL-579: عبرَ بوابةِ الإقلاع — التحدّي يجبُ أن تكونَ البوابةُ أصدرَته في جيلِها الحاليّ.
   * @param {string} nonce @param {Buffer} workerSignature
   */
  async completeCredential(nonce, workerSignature) {
    return bootGateOf(this, 'completeCredential').completeCredential(nonce, workerSignature);
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
   * TH-SUP-05 (‏WL-577): كنسُ الاعتماداتِ اليتيمةِ عندَ إقلاعِ المُشرِف. مُشرِفٌ انهارَ أو أُعيدَ تشغيلُه والعمّالُ
   * أحياءٌ يتركُ اعتماداتٍ ACTIVE لم يُصدِرها المُشرِفُ الحاليّ؛ إيجارُها يبقى صالحاً حتى ينقضيَ (‏≤ `lease_window_s`)
   * فيكتبُ عاملٌ لا يُراقبُه أحد. يُلغى هنا كلُّ اعتمادٍ ACTIVE ليس في `keep` (‏ما أصدرَه هذا المُشرِف؛ فارغٌ عندَ
   * الإقلاع) بـ`fence.revoke_credential` — NOLOGIN وإنهاءُ الجلساتِ ومحوُ الأثر — ثمّ يُعادُ الجردُ **وفشلٌ مغلق**:
   * اعتمادٌ يتيمٌ ظهرَ بعدَ الكنس (‏مُصدِرٌ آخرُ بدورِ الجذرِ في الوقتِ نفسِه) أو جلسةٌ لدورٍ ملغىً (‏في هذا الكنسِ أو
   * لاعتمادٍ غيرِ ACTIVE قبلَه — جلسةٌ نجت من الإنهاء، صنفُ WL-552) بقيت حيّةً بعدَ
   * `settleMs` ⇒ `FENCE_ORPHAN_SWEEP_INCOMPLETE` بالتفاصيل، فلا يُطلِقُ المُشرِفُ عمّالاً فوقَ حالةٍ لم تُحسَم.
   * **الحدود:** الجردُ والإلغاءُ لا يُقفلانِ الإصدار — مُصدِرٌ متزامنٌ يُكشَفُ بإعادةِ الجردِ لا يُمنَع؛ والجلساتُ تُرى
   * في `pg_stat_activity` بالاسمِ وحدَه (‏ما يراه `xf_root`)؛ وما التزمَ قبلَ الإلغاءِ يبقى.
   * @param {{ keep?: Iterable<string>, reason?: string, settleMs?: number, pollMs?: number }} [options]
   * @returns {Promise<{ revoked: Array<{ role_name: string, worker_id: string, boot_id: string, terminated: number }>, kept: string[] }>}
   */
  async revokeOrphanCredentials(options = {}) {
    const keep = new Set();
    for (const role of options.keep ?? []) {
      if (typeof role !== 'string' || role === '')
        throw new TypeError('revokeOrphanCredentials: keep يقبلُ أسماءَ أدوارٍ نصّيّةً غيرَ فارغة');
      keep.add(role);
    }
    const reason = options.reason ?? ORPHAN_REVOKE_REASON;
    if (typeof reason !== 'string' || reason.trim() === '')
      throw new TypeError('revokeOrphanCredentials: reason نصٌّ غيرُ فارغ');
    const settleMs = options.settleMs ?? 2_000;
    const pollMs = options.pollMs ?? 50;
    for (const [name, v] of /** @type {const} */ ([
      ['settleMs', settleMs],
      ['pollMs', pollMs],
    ]))
      if (!Number.isInteger(v) || v < 1)
        throw new TypeError(`revokeOrphanCredentials: ${name} عددٌ صحيحٌ ≥ 1`);
    const active = async () =>
      /** @type {Array<{ role_name: string, worker_id: string, boot_id: string }>} */ (
        await this.with(
          async (c) =>
            (
              await c.query(
                `SELECT role_name::text AS role_name, worker_id, boot_id FROM fence.credentials
                 WHERE status = 'ACTIVE' ORDER BY role_name`,
              )
            ).rows,
        )
      );
    const before = await active();
    /** @type {Array<{ role_name: string, worker_id: string, boot_id: string, terminated: number }>} */
    const revoked = [];
    for (const cr of before) {
      if (keep.has(cr.role_name)) continue;
      const terminated = Number(await this.revokeCredential(cr.role_name, reason));
      revoked.push({ ...cr, terminated });
      this.log({ ev: 'orphan_revoked', role: cr.role_name, worker: cr.worker_id, terminated });
    }
    const after = await active();
    const appeared = after.filter((cr) => !keep.has(cr.role_name));
    const roles = revoked.map((r) => r.role_name);
    /** @type {Array<{ role: string, pid: number }>} */
    let lingering;
    const deadline = Date.now() + settleMs;
    for (;;) {
      // ‏جلساتُ ما أُلغيَ هنا **وكلِّ** اعتمادٍ غيرِ ACTIVE (‏أُلغيَ أو انقضى قبلَ الإقلاع وبقيت جلستُه — صنفُ WL-552)،
      // ولو كانَ في `keep` (‏`keep` يُعفي اعتماداً ACTIVE من الإلغاءِ لا جلسةَ دورٍ ملغىً من الفحص):
      // المُشرِفُ لا يُطلِقُ فوقَ جلسةِ دورٍ مُسيَّجٍ لم تمُت.
      lingering = (
        await this.one(
          `SELECT coalesce(jsonb_agg(jsonb_build_object('role', a.usename, 'pid', a.pid) ORDER BY a.pid), '[]') AS r
           FROM pg_stat_activity a
           WHERE a.usename = ANY($1::text[])
              OR a.usename IN (SELECT role_name::text FROM fence.credentials WHERE status <> 'ACTIVE')`,
          [roles],
        )
      ).r;
      if (lingering.length === 0 || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    if (appeared.length || lingering.length) {
      this.log({
        ev: 'orphan_sweep_incomplete',
        appeared: appeared.length,
        lingering: lingering.length,
      });
      throw new FenceError(
        FENCE_ERRORS.ORPHAN_SWEEP_INCOMPLETE,
        'كنسُ الاعتماداتِ اليتيمةِ لم يكتمل: اعتمادٌ يتيمٌ ظهرَ بعدَ الكنسِ أو جلسةُ دورٍ ملغىً ما زالت حيّة',
        { appeared, lingering, revoked },
      );
    }
    return { revoked, kept: after.map((cr) => cr.role_name) };
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

// ── بوابةُ إقلاعِ المُشرِف (‏WL-579، TH-SUP-05) ─────────────────────────────────

/** حالاتُ البوابة. الإصدارُ والمصافحةُ في `READY` وحدَها. */
export const BOOT_GATE_STATES = Object.freeze({
  NEW: 'NEW',
  SWEEPING: 'SWEEPING',
  READY: 'READY',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED',
});

/** سببُ إلغاءِ اعتمادٍ اكتملَ إصدارُه عبرَ إيقافٍ أو إقلاعٍ جديدٍ للبوابة (‏لا يُسلَّم). */
export const BOOT_GATE_EPOCH_REVOKE_REASON = 'SUPERVISOR_BOOT_GATE_EPOCH';

/** @type {WeakMap<FenceRoot, SupervisorBootGate>} */
const BOOT_GATES = new WeakMap();

/**
 * البوابةُ المربوطةُ بالجذر أو رفضٌ مغلق — لا إصدارَ بجذرٍ بلا بوابة.
 * @param {FenceRoot} root @param {string} op
 */
function bootGateOf(root, op) {
  const gate = BOOT_GATES.get(root);
  if (gate === undefined) {
    throw new FenceError(
      FENCE_ERRORS.BOOT_GATE_CLOSED,
      `${op}: لا بوابةَ إقلاعٍ لهذا الجذر — أنشئ SupervisorBootGate وانتظر start() قبلَ أيِّ إصدار`,
      { op, state: null },
    );
  }
  return gate;
}

/**
 * النداءانِ الخامّانِ الوحيدانِ لدالّتَي الإصدارِ في المستودع (‏يفحصُ ذلك اختبارٌ ثابت). لا يُصدَّران.
 * @param {FenceRoot} root @param {string} workerId @param {string} bootId
 * @returns {Promise<any>}
 */
async function rawIssueChallenge(root, workerId, bootId) {
  return (await root.one('SELECT fence.issue_challenge($1, $2) AS r', [workerId, bootId])).r;
}

/**
 * @param {FenceRoot} root @param {string} nonce @param {Buffer} workerSignature
 * @returns {Promise<any>}
 */
async function rawCompleteCredential(root, nonce, workerSignature) {
  return (await root.one('SELECT fence.issue_credential($1, $2) AS r', [nonce, workerSignature])).r;
}

/**
 * WL-579 — بوابةُ إقلاعِ المُشرِف: كنسُ الاعتماداتِ اليتيمةِ (‏`revokeOrphanCredentials`) **شرطٌ سابقٌ فعليٌّ**
 * لكلِّ إصدار. تُربَطُ بجذرٍ واحدٍ (‏ولكلِّ جذرٍ بوابةٌ واحدة)، ومنذُ ربطِها تمرُّ `issueChallenge`
 * و`completeCredential` و`issueCredential` و`superviseWorkerHandshake` على ذلك الجذرِ بها؛ وجذرٌ بلا بوابةٍ لا يُصدِر.
 *
 * - `start()` (‏من NEW/STOPPED/FAILED): عهدٌ جديد، و`issued` يُفرَّغ، وتُنتظَرُ الإصداراتُ الجاريةُ ثمّ يُكنَسُ
 *   **بلا keep** — في إقلاعٍ لا شيءَ لهذا المُشرِف. نجاحٌ ⇒ READY؛ فشلٌ أو مهلةٌ ⇒ FAILED.
 * - `resweep()` (‏من READY/FAILED): جيلٌ جديدٌ (‏التحدّياتُ القائمةُ تُبطَل)، تُنتظَرُ الإصداراتُ الجاريةُ فتُحسَبُ
 *   في `issued`، ثمّ يُكنَسُ بـ`keep = issued` — ما أصدرَته البوابةُ في عهدِها يبقى، وغيرُه يُلغى.
 * - `stop()`: STOPPED فوراً، ويُلغى الكنسُ الجاري (‏`FENCE_BOOT_GATE_CANCELLED`)، و`issued` يُفرَّغ.
 * - **الإصدار:** في READY وحدَها؛ والتحدّي يجبُ أن تكونَ البوابةُ أصدرَته في جيلِها الحاليّ؛ واعتمادٌ اكتملَ
 *   إصدارُه بعدَ تبدّلِ العهد (‏stop أو start أثناءَه) يُلغى ولا يُسلَّم.
 * - كنسٌ سابقٌ لم يستقرَّ (‏بعدَ مهلةٍ أو إلغاء) يمنعُ كنساً جديداً — لا يتداخلُ كنسٌ قديمٌ مع عهدٍ جديد.
 *
 * **الحدود (‏معلنة):** البوابةُ في العملية؛ حاملُ `xf_root` بـSQL خامٍ (‏`root.one`/`root.with` أو عميلٌ آخر) أو
 * جذرٌ في عمليةٍ أخرى لا تمنعُه — القاعدةُ لا تعرفُ الكنس (‏فرضُه فيها هجرةٌ وقرارُ مالك). ولا مُشرِفَ إنتاجيٌّ
 * ينشئُها اليوم (‏T2 DESIGNED؛ D-SUP-1/D-ENV-1).
 */
export class SupervisorBootGate {
  /** @type {FenceRoot} */
  #root;
  /** @type {string} */
  #state = BOOT_GATE_STATES.NEW;
  #generation = 0;
  #epoch = 0;
  /** @type {Set<string>} */
  #issued = new Set();
  /** @type {Map<string, number>} */
  #challenges = new Map();
  /** @type {Set<Promise<unknown>>} */
  #inflight = new Set();
  /** @type {Promise<unknown> | null} */
  #pending = null;
  /** @type {((error: Error) => void) | null} */
  #cancel = null;
  /** @type {string | null} */
  #lastError = null;
  /** @type {{ timeoutMs: number, settleMs: number, pollMs: number, reason: string }} */
  #options;

  /**
   * @param {FenceRoot} root
   * @param {{ timeoutMs?: number, settleMs?: number, pollMs?: number, reason?: string }} [options]
   */
  constructor(root, options = {}) {
    if (!(root instanceof FenceRoot))
      throw new TypeError('SupervisorBootGate: root يجبُ أن يكونَ FenceRoot');
    const timeoutMs = options.timeoutMs ?? 30_000;
    const settleMs = options.settleMs ?? 2_000;
    const pollMs = options.pollMs ?? 50;
    for (const [name, v] of /** @type {const} */ ([
      ['timeoutMs', timeoutMs],
      ['settleMs', settleMs],
      ['pollMs', pollMs],
    ]))
      if (!Number.isInteger(v) || v < 1)
        throw new TypeError(`SupervisorBootGate: ${name} عددٌ صحيحٌ ≥ 1`);
    const reason = options.reason ?? ORPHAN_REVOKE_REASON;
    if (typeof reason !== 'string' || reason.trim() === '')
      throw new TypeError('SupervisorBootGate: reason نصٌّ غيرُ فارغ');
    if (BOOT_GATES.has(root))
      throw new FenceError(FENCE_ERRORS.BOOT_GATE_STATE, 'لهذا الجذرِ بوابةُ إقلاعٍ قائمة', {
        op: 'constructor',
      });
    this.#root = root;
    this.#options = { timeoutMs, settleMs, pollMs, reason };
    BOOT_GATES.set(root, this);
  }

  /** @returns {string} */
  get state() {
    return this.#state;
  }

  /** لقطةٌ للأدلّةِ والاختبار (‏نسخةٌ مجمَّدة). */
  snapshot() {
    return Object.freeze({
      state: this.#state,
      generation: this.#generation,
      epoch: this.#epoch,
      issued: Object.freeze([...this.#issued].sort()),
      challenges: this.#challenges.size,
      inflight: this.#inflight.size,
      sweepPending: this.#pending !== null,
      lastError: this.#lastError,
    });
  }

  /** @param {string} op @param {string[]} allowed */
  #assertState(op, allowed) {
    if (!allowed.includes(this.#state))
      throw new FenceError(
        FENCE_ERRORS.BOOT_GATE_STATE,
        `${op}: غيرُ مسموحٍ في ${this.#state} (‏المسموح: ${allowed.join('/')})`,
        { op, state: this.#state },
      );
    if (this.#pending !== null)
      throw new FenceError(
        FENCE_ERRORS.BOOT_GATE_STATE,
        `${op}: كنسٌ سابقٌ لم يستقرَّ بعد — لا كنسَ جديدٌ فوقَه`,
        { op, state: this.#state, sweepPending: true },
      );
  }

  /** كنسُ الإقلاع: لا keep — ما صدرَ قبلَ هذا العهدِ يتيمٌ بالتعريف. */
  async start() {
    this.#assertState('start', [
      BOOT_GATE_STATES.NEW,
      BOOT_GATE_STATES.STOPPED,
      BOOT_GATE_STATES.FAILED,
    ]);
    this.#epoch++;
    this.#issued.clear();
    return this.#sweep('start', () => []);
  }

  /** إعادةُ الكنسِ في عهدٍ قائم: keep = ما أصدرَته البوابةُ في هذا العهد (‏بعدَ انتظارِ الجاري). */
  async resweep() {
    this.#assertState('resweep', [BOOT_GATE_STATES.READY, BOOT_GATE_STATES.FAILED]);
    return this.#sweep('resweep', () => [...this.#issued]);
  }

  /** إيقافٌ فوريّ: لا إصدار، والكنسُ الجاري يُلغى، و`issued` يُفرَّغ (‏ما صدرَ يُكنَسُ عندَ start التالي). */
  stop() {
    if (this.#state !== BOOT_GATE_STATES.STOPPED) {
      this.#generation++;
      this.#epoch++;
      this.#issued.clear();
      this.#state = BOOT_GATE_STATES.STOPPED;
      this.#root.log({ ev: 'boot_gate_stopped', generation: this.#generation });
      if (this.#cancel !== null)
        this.#cancel(
          new FenceError(FENCE_ERRORS.BOOT_GATE_CANCELLED, 'أُلغيَ الكنسُ بإيقافِ البوابة', {
            generation: this.#generation,
          }),
        );
    }
    return this.snapshot();
  }

  /**
   * @param {string} op
   * @param {() => string[]} keepOf - تُحسَبُ بعدَ انتظارِ الإصداراتِ الجارية
   */
  async #sweep(op, keepOf) {
    const generation = ++this.#generation;
    this.#state = BOOT_GATE_STATES.SWEEPING;
    // ‏نظافةُ ذاكرةٍ لا شرطٌ أمنيّ: الحارسُ هو الجيل — كلُّ دخولٍ إلى READY يمرُّ من هنا بجيلٍ جديد.
    this.#challenges.clear();
    this.#lastError = null;
    this.#root.log({ ev: 'boot_gate_sweeping', op, generation });
    const { timeoutMs, settleMs, pollMs, reason } = this.#options;
    const work = (async () => {
      await Promise.allSettled([...this.#inflight]);
      if (generation !== this.#generation)
        throw new FenceError(FENCE_ERRORS.BOOT_GATE_CANCELLED, 'تبدّلت البوابةُ قبلَ الجرد', {
          op,
          generation,
        });
      return this.#root.revokeOrphanCredentials({ keep: keepOf(), reason, settleMs, pollMs });
    })();
    this.#pending = work;
    work.then(
      () => {
        if (this.#pending === work) this.#pending = null;
      },
      () => {
        if (this.#pending === work) this.#pending = null;
      },
    );
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const stopped = /** @type {Promise<never>} */ (
      new Promise((_, reject) => {
        this.#cancel = reject;
        timer = setTimeout(
          () =>
            reject(
              new FenceError(
                FENCE_ERRORS.BOOT_GATE_TIMEOUT,
                `${op}: انقضت مهلةُ الكنس (‏${timeoutMs} ms)`,
                { op, generation, timeoutMs },
              ),
            ),
          timeoutMs,
        );
      })
    );
    try {
      const result = await Promise.race([work, stopped]);
      if (generation !== this.#generation)
        throw new FenceError(FENCE_ERRORS.BOOT_GATE_CANCELLED, 'تبدّلت البوابةُ أثناءَ الكنس', {
          op,
          generation,
        });
      this.#state = BOOT_GATE_STATES.READY;
      this.#root.log({ ev: 'boot_gate_ready', op, generation, revoked: result.revoked.length });
      return result;
    } catch (error) {
      if (generation === this.#generation) {
        this.#state = BOOT_GATE_STATES.FAILED;
        this.#lastError =
          error instanceof FenceError
            ? error.code
            : String(/** @type {any} */ (error)?.code ?? error);
        this.#root.log({ ev: 'boot_gate_failed', op, generation, code: this.#lastError });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.#cancel = null;
    }
  }

  /** @param {string} op */
  #assertReady(op) {
    if (this.#state !== BOOT_GATE_STATES.READY)
      throw new FenceError(
        FENCE_ERRORS.BOOT_GATE_CLOSED,
        `${op}: بوابةُ الإقلاعِ ${this.#state} — لا إصدارَ قبلَ نجاحِ كنسِ الاعتمادات`,
        { op, state: this.#state },
      );
  }

  /** @param {string} workerId @param {string} bootId */
  async issueChallenge(workerId, bootId) {
    this.#assertReady('issueChallenge');
    const generation = this.#generation;
    const challenge = await rawIssueChallenge(this.#root, workerId, bootId);
    if (generation !== this.#generation || this.#state !== BOOT_GATE_STATES.READY)
      throw new FenceError(
        FENCE_ERRORS.BOOT_GATE_CLOSED,
        'issueChallenge: تبدّلت البوابةُ أثناءَ إصدارِ التحدّي — لا يُسلَّم',
        { op: 'issueChallenge', state: this.#state },
      );
    this.#challenges.set(String(challenge['nonce']), generation);
    return challenge;
  }

  /** @param {string} nonce @param {Buffer} workerSignature */
  async completeCredential(nonce, workerSignature) {
    this.#assertReady('completeCredential');
    const key = String(nonce);
    if (this.#challenges.get(key) !== this.#generation)
      throw new FenceError(
        FENCE_ERRORS.BOOT_GATE_CLOSED,
        'completeCredential: تحدٍّ لم تُصدِرْه البوابةُ في جيلِها الحاليّ',
        { op: 'completeCredential', state: this.#state },
      );
    const epoch = this.#epoch;
    const run = (async () => {
      const credential = await rawCompleteCredential(this.#root, key, workerSignature);
      const role = String(credential['role_name']);
      if (epoch !== this.#epoch) {
        // ‏اكتملَ عبرَ stop أو start: يُلغى قبلَ أن يستقرَّ الإصدارُ فلا يُسلَّمُ ولا يبقى ACTIVE.
        // ‏فشلُ الإلغاءِ لا يُسجَّلُ نجاحاً: يبقى الدورُ ACTIVE غيرَ مُسلَّمٍ حتى كنسِ start() التالي (‏مراجعةُ 565169e8).
        /** @type {string | null} */
        let revokeError = null;
        try {
          await this.#root.revokeCredential(role, BOOT_GATE_EPOCH_REVOKE_REASON);
        } catch (/** @type {any} */ e) {
          revokeError = String(e?.code ?? e?.message ?? e);
        }
        this.#root.log(
          revokeError === null
            ? { ev: 'boot_gate_epoch_revoked', role }
            : { ev: 'boot_gate_epoch_revoke_failed', role, error: revokeError },
        );
        throw new FenceError(
          FENCE_ERRORS.BOOT_GATE_CLOSED,
          revokeError === null
            ? 'completeCredential: تبدّلَ عهدُ البوابةِ أثناءَ الإصدار — الاعتمادُ أُلغيَ ولم يُسلَّم'
            : 'completeCredential: تبدّلَ عهدُ البوابةِ أثناءَ الإصدار — تعذّرَ إلغاءُ الاعتمادِ ولم يُسلَّم (‏يُلغيه كنسُ start التالي)',
          { op: 'completeCredential', state: this.#state, role, revoked: revokeError === null },
        );
      }
      this.#issued.add(role);
      return credential;
    })();
    this.#inflight.add(run);
    try {
      return await run;
    } finally {
      this.#inflight.delete(run);
    }
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

// ── المُشرِفُ المركّب (‏LIVE-75، WL-604) ──────────────────────────────────────────

/**
 * مفتاحُ القفلِ الاستشاريِّ للمُشرِف (‏الصيغةُ ذاتُ العددين: `'XUUX'` و`'SUPV'`). الأقفالُ الاستشاريّةُ لكلِّ قاعدة —
 * فـ«المورد» = القاعدةُ التي يتّصلُ بها المُشرِف.
 */
export const SUPERVISOR_LOCK_KEY = Object.freeze([0x58555558, 0x53555056]);

/** حالاتُ المُشرِف. */
export const SUPERVISOR_STATES = Object.freeze({
  NEW: 'NEW',
  LOCKING: 'LOCKING',
  SWEEPING: 'SWEEPING',
  CHECKING: 'CHECKING',
  STARTING_REAPER: 'STARTING_REAPER',
  RUNNING: 'RUNNING',
  WAITING: 'WAITING',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED',
});

/** حالاتُ العاملِ تحتَ المُشرِف. */
export const SUPERVISED_WORKER_STATES = Object.freeze({
  PENDING: 'PENDING',
  BOOTING: 'BOOTING',
  RUNNING: 'RUNNING',
  LOST: 'LOST',
  BOOT_FAILED: 'BOOT_FAILED',
  RESTARTING: 'RESTARTING',
  GAVE_UP: 'GAVE_UP',
  STOPPED: 'STOPPED',
});

/**
 * وعدٌ بمهلةٍ تُنظَّفُ دائماً (‏لا مؤقّتَ معلّقٌ يُبقي العمليّةَ حيّة).
 * @template T @param {Promise<T>} promise @param {number} ms @param {() => Error} onTimeout
 * @returns {Promise<T>}
 */
function supervisorTimeout(promise, ms, onTimeout) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, t])).finally(() => clearTimeout(timer));
}

/** @param {unknown} error */
function supervisorErrorCode(error) {
  const e = /** @type {any} */ (error);
  return String(e?.code ?? e?.message ?? e);
}

/**
 * ‏LIVE-75 — المُشرِفُ المركّب: يُركّبُ اللبناتِ القائمةَ (‏`SupervisorBootGate`، `superviseWorkerHandshake`،
 * `confirmWorkerSeal`، `startLeaseKeeper`، `startLapseReaper`، `revokeCredential`) في دورةِ حياةٍ واحدةٍ **دونَ أيِّ
 * تغييرٍ في دوالِّ السياجِ ولا بوابةٍ جديدةٍ في القاعدة**. مكتبةٌ في المستودع — لا تنصيبَ ولا تشغيلَ على مضيف.
 *
 * تسلسلُ الإقلاع (‏`start()`)، وكلُّ فشلٍ فيه ⇒ FAILED مغلق (‏لا عاملَ يُطلَق، والقفلُ يُحرَّر):
 *  1. LOCKING — `pg_try_advisory_lock(SUPERVISOR_LOCK_KEY)` على **وصلةٍ مخصّصةٍ** بدورِ الجذر تبقى مفتوحةً طوالَ
 *     العمر. مُشرِفٌ ثانٍ على القاعدةِ نفسِها ⇒ `FENCE_SUPERVISOR_LOCKED` **قبلَ** أيِّ كنس (‏فلا يُلغي اعتماداتِ الأوّل).
 *  2. SWEEPING — `SupervisorBootGate.start()`: كلُّ اعتمادٍ ACTIVE قبلَ هذا الإقلاعِ يتيمٌ ويُلغى (‏TH-SUP-05).
 *  3. CHECKING — `fence.status()`: الحالةُ الفعليّةُ RUNNING وإلا `FENCE_SUPERVISOR_NOT_RUNNING`.
 *  4. STARTING_REAPER — `startLapseReaper` داخلَ نموذجِ المُشرِف، ويُنتظَرُ **أوّلُ نداءٍ ناجح**؛ فشلُه أو مهلتُه ⇒
 *     `FENCE_SUPERVISOR_REAPER_START`.
 *  5. RUNNING — مراقِبٌ دوريٌّ (‏القفل، وحالةُ السياج)، ثمّ إطلاقُ كلِّ عاملٍ بالتسلسل: `spawnWorker` بـ
 *     `XUUX_DB_FENCE=required` ⇒ مصافحة ⇒ تأكيدُ الختم ⇒ حافظُ إيجار ⇒ مراقبةُ الموت.
 *
 * **الطابورُ التسلسليّ:** كلُّ إصدارٍ (‏issueChallenge/completeCredential) وكلُّ إلغاءٍ يمرُّ بطابورٍ واحد — لا يتداخلُ
 * نداءا إصدارٍ وإلغاءٍ من هذا المُشرِف (‏`snapshot().serial.maxConcurrent` = 1 دليلُه).
 * **الإلغاءُ قبلَ القتل:** موتُ عاملٍ أو إيقافُه ⇒ `revokeCredential` (‏NOLOGIN وإنهاءُ الجلسات — فمعاملةٌ مفتوحةٌ
 * تُلغى ولا تلتزم) ثمّ SIGTERM/SIGKILL. فشلُ الإلغاءِ يُسجَّلُ ولا يُعلَنُ نجاحاً — الإيجارُ ينقضي والحاصدُ يُلغي.
 * **المراقِب:** فقدُ القفلِ أو انقطاعُ القاعدةِ `maxDbFailures` مرّةً متتالية ⇒ FAILED (‏كلُّ العمّالِ يُلغَون ويُقتَلون)؛
 * حالةُ سياجٍ غيرُ RUNNING ⇒ WAITING (‏العمّالُ يُوقَفون ولا يُعادون) حتى RUNNING فكنسٌ جديدٌ وإطلاق.
 * **إعادةُ التشغيل:** عاملٌ مات يُعادُ بعدَ `backoffMs` ما لم يبلغْ `maxRestarts` في `windowMs` (‏ثمّ GAVE_UP). موتُ المُشرِفِ
 * نفسِه: القاعدةُ تُحرِّرُ القفلَ بموتِ وصلته، والإيجاراتُ تنقضي (‏حاصدُ السياديِّ المنفصلُ يُلغيها)، والمُشرِفُ التالي يكنسُ.
 *
 * **حدودٌ معلنة:** القفلُ استشاريٌّ تعاونيّ — حاملُ `xf_root` بـSQL خامٍ لا يمنعُه (‏لا بوابةَ في القاعدة، قرارُ مالك)؛
 * المُشرِفُ لا يرى مفتاحَ العامل (‏`spawnWorker` للمُطلِق)؛ `loginBroker` حزامُ اختبارٍ وحدَه (‏الإنتاج: peer/pg_ident —
 * D-SUP-2)؛ الحاصدُ داخلَ المُشرِفِ يموتُ بموته (‏لذا حاصدُ السياديِّ المنفصلُ قائم). وليس هذا مُشرِفاً منشوراً: T2 DESIGNED.
 */
export class FenceSupervisor {
  /** @type {FenceRoot} */
  #root;
  /** @type {any} */
  #o;
  /** @type {string} */
  #state = SUPERVISOR_STATES.NEW;
  /** @type {string | null} */
  #lastError = null;
  /** @type {any} */
  #lockClient = null;
  /** @type {SupervisorBootGate | null} */
  #gate = null;
  /** @type {ReturnType<typeof startLapseReaper> | null} */
  #reaper = null;
  /**
   * ‏ما تعذّرَ إلغاؤه أو جردُه خارجَ مسارِ الإيقاف (‏فشلُ إقلاع، فقدُ عامل): يُعلَنُ في تقريرِ الإيقافِ لا في السجلِّ وحدَه.
   * @type {Array<{ worker: string, role: string | null, boot: string | null, error: string }>}
   */
  #unresolved = [];
  #fenceRunning = false;
  #dbFailures = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #monitorTimer = null;
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  #timers = new Set();
  /** @type {Map<string, any>} */
  #workers = new Map();
  /** @type {Promise<unknown>} */
  #queue = Promise.resolve();
  #serial = { ops: 0, active: 0, maxConcurrent: 0, issue: 0, revoke: 0 };
  /** @type {Promise<any> | null} */
  #shutdown = null;
  /** @type {(v: any) => void} */
  #resolveDone = () => {};
  /** @type {Promise<any>} */
  done;
  /** @type {any} */
  #serialRoot;
  /** @type {{ assertOperational(): void }} */
  #guard;

  /**
   * @param {{ root: FenceRoot, lockConnect: () => Promise<any>,
   *           workers: Array<{ workerId: string, [k: string]: unknown }>,
   *           spawnWorker: (spec: any, ctx: { env: Record<string, string>, attempt: number }) => import('node:child_process').ChildProcess,
   *           loginBroker?: (credential: Record<string, any>) => Promise<void>,
   *           reaper?: { ceilingMs?: number, retryMs?: number, maxRetryMs?: number, firstTickTimeoutMs?: number,
   *                      target?: { reapLapsed(): Promise<any> } },
   *           gate?: { timeoutMs?: number, settleMs?: number, pollMs?: number },
   *           handshakeTimeoutMs?: number, sealTimeoutMs?: number, leaseIntervalMs?: number,
   *           monitorIntervalMs?: number, lockCheckTimeoutMs?: number, maxDbFailures?: number,
   *           restart?: { maxRestarts?: number, windowMs?: number, backoffMs?: number },
   *           killGraceMs?: number, log?: (event: Record<string, unknown>) => void }} options
   */
  constructor(options) {
    const root = options?.root;
    if (!(root instanceof FenceRoot))
      throw new TypeError('FenceSupervisor: root يجبُ أن يكونَ FenceRoot');
    if (BOOT_GATES.has(root))
      throw new TypeError(
        'FenceSupervisor: لهذا الجذرِ بوابةُ إقلاعٍ قائمة — المُشرِفُ يملكُ بوابتَه وحدَه',
      );
    if (typeof options.lockConnect !== 'function')
      throw new TypeError('FenceSupervisor: lockConnect دالّةٌ تفتحُ وصلةً مخصّصةً بدورِ الجذر');
    if (typeof options.spawnWorker !== 'function')
      throw new TypeError('FenceSupervisor: spawnWorker دالّةُ المُطلِق');
    if (!Array.isArray(options.workers) || options.workers.length === 0)
      throw new TypeError('FenceSupervisor: workers قائمةٌ غيرُ فارغة');
    const ints = {
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 15_000,
      sealTimeoutMs: options.sealTimeoutMs ?? 15_000,
      monitorIntervalMs: options.monitorIntervalMs ?? 1_000,
      lockCheckTimeoutMs: options.lockCheckTimeoutMs ?? 2_000,
      maxDbFailures: options.maxDbFailures ?? 3,
      killGraceMs: options.killGraceMs ?? 2_000,
      maxRestarts: options.restart?.maxRestarts ?? 3,
      windowMs: options.restart?.windowMs ?? 60_000,
      backoffMs: options.restart?.backoffMs ?? 500,
      reaperCeilingMs: options.reaper?.ceilingMs ?? 5_000,
      firstTickTimeoutMs: options.reaper?.firstTickTimeoutMs ?? 5_000,
    };
    for (const [k, v] of Object.entries(ints)) {
      const floor = k === 'maxRestarts' || k === 'backoffMs' ? 0 : 1;
      if (!Number.isInteger(v) || v < floor)
        throw new TypeError(`FenceSupervisor: ${k} عددٌ صحيحٌ ≥ ${floor}`);
    }
    if (
      options.leaseIntervalMs !== undefined &&
      (!Number.isInteger(options.leaseIntervalMs) || options.leaseIntervalMs < 1)
    )
      throw new TypeError('FenceSupervisor: leaseIntervalMs عددٌ صحيحٌ ≥ 1');
    const ids = new Set();
    for (const w of options.workers) {
      if (typeof w?.workerId !== 'string' || w.workerId === '' || ids.has(w.workerId))
        throw new TypeError('FenceSupervisor: لكلِّ عاملٍ workerId نصّيٌّ فريد');
      ids.add(w.workerId);
    }
    this.#root = root;
    this.#o = { ...ints, options, log: options.log ?? (() => {}) };
    for (const spec of options.workers)
      this.#workers.set(spec.workerId, {
        id: spec.workerId,
        spec,
        state: SUPERVISED_WORKER_STATES.PENDING,
        gen: 0,
        attempts: 0,
        restarts: /** @type {number[]} */ ([]),
        child: null,
        exited: null,
        boot: null,
        bootId: null,
        credential: null,
        keeper: null,
        sessions: null,
        lastError: null,
        lastExit: null,
      });
    this.done = new Promise((resolve) => {
      this.#resolveDone = resolve;
    });
    this.#serialRoot = {
      issueChallenge: (/** @type {string} */ w, /** @type {string} */ b) =>
        this.#serialized('issue', () => root.issueChallenge(w, b)),
      completeCredential: (/** @type {string} */ n, /** @type {Buffer} */ sig) =>
        this.#serialized('issue', () => root.completeCredential(n, sig)),
      credentialSeal: (/** @type {string} */ role) => root.credentialSeal(role),
      revokeCredential: (/** @type {string} */ role, /** @type {string} */ why) =>
        this.#serialized('revoke', () => root.revokeCredential(role, why)),
    };
    this.#guard = Object.freeze({
      assertOperational: () => {
        if (this.#state !== SUPERVISOR_STATES.RUNNING || !this.#fenceRunning)
          throw new FenceError(
            FENCE_ERRORS.SUPERVISOR_NOT_RUNNING,
            `المُشرِفُ ${this.#state} — لا تجديدَ إيجار`,
          );
      },
    });
  }

  get state() {
    return this.#state;
  }

  /** @param {Record<string, unknown>} event */
  #log(event) {
    try {
      this.#o.log({ ...event, t: Date.now() });
    } catch {
      // ‏سجلٌّ رمى: لا يُسقطُ المُشرِف.
    }
  }

  /**
   * الطابورُ التسلسليّ: نداءٌ واحدٌ في كلِّ لحظةٍ لإصدارٍ أو إلغاء.
   * @template T @param {'issue' | 'revoke'} kind @param {() => Promise<T>} fn @returns {Promise<T>}
   */
  #serialized(kind, fn) {
    const run = this.#queue.then(async () => {
      this.#serial.ops++;
      this.#serial[kind]++;
      this.#serial.active++;
      this.#serial.maxConcurrent = Math.max(this.#serial.maxConcurrent, this.#serial.active);
      try {
        return await fn();
      } finally {
        this.#serial.active--;
      }
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  /** لقطةٌ للأدلّةِ والاختبار. */
  snapshot() {
    return Object.freeze({
      state: this.#state,
      lastError: this.#lastError,
      fenceRunning: this.#fenceRunning,
      lockHeld: this.#lockClient !== null,
      gate: this.#gate?.snapshot() ?? null,
      reaper: this.#reaper?.stats() ?? null,
      serial: { ...this.#serial },
      workers: [...this.#workers.values()].map((w) =>
        Object.freeze({
          id: w.id,
          state: w.state,
          role: w.credential === null ? null : String(w.credential.role_name),
          attempts: w.attempts,
          restarts: w.restarts.length,
          pid: w.child?.pid ?? null,
          lastError: w.lastError,
          lastExit: w.lastExit,
        }),
      ),
    });
  }

  #accepting() {
    return this.#state === SUPERVISOR_STATES.RUNNING && this.#fenceRunning;
  }

  /** @param {string} step */
  #assertStarting(step) {
    if (this.#shutdown !== null)
      throw new FenceError(
        FENCE_ERRORS.SUPERVISOR_STATE,
        `${step}: أُوقِفَ المُشرِفُ أثناءَ الإقلاع`,
        {
          step,
          lastError: this.#lastError,
        },
      );
  }

  /** الإقلاع (‏انظر وصفَ الصنف). يرمي عندَ أيِّ فشلٍ بعدَ إيقافٍ مغلق. */
  async start() {
    if (this.#state !== SUPERVISOR_STATES.NEW)
      throw new FenceError(FENCE_ERRORS.SUPERVISOR_STATE, `start: المُشرِفُ ${this.#state} لا NEW`);
    try {
      this.#state = SUPERVISOR_STATES.LOCKING;
      this.#log({ ev: 'supervisor_locking' });
      const client = await this.#o.options.lockConnect();
      this.#lockClient = client;
      client.on?.('error', (/** @type {unknown} */ e) => void this.#lockLost(e));
      client.on?.('end', () => void this.#lockLost('end'));
      const got = (
        await client.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [...SUPERVISOR_LOCK_KEY])
      ).rows[0]?.ok;
      if (got !== true) {
        const holder = (
          await client.query(
            `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid
               AND objsubid = 2 AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
            [...SUPERVISOR_LOCK_KEY],
          )
        ).rows[0]?.pid;
        throw new FenceError(
          FENCE_ERRORS.SUPERVISOR_LOCKED,
          'مُشرِفٌ آخرُ يمسكُ قفلَ هذه القاعدة — لا كنسَ ولا إصدار',
          { holderPid: holder ?? null },
        );
      }
      this.#assertStarting('lock');
      this.#state = SUPERVISOR_STATES.SWEEPING;
      this.#gate = new SupervisorBootGate(this.#root, this.#o.options.gate ?? {});
      const swept = await this.#gate.start();
      this.#log({ ev: 'supervisor_swept', revoked: swept.revoked.length });
      this.#assertStarting('sweep');
      this.#state = SUPERVISOR_STATES.CHECKING;
      const status = await this.#root.status();
      const fenceState = status?.effective?.state;
      if (fenceState !== 'RUNNING')
        throw new FenceError(
          FENCE_ERRORS.SUPERVISOR_NOT_RUNNING,
          `حالةُ السياجِ ${fenceState} لا RUNNING — لا إطلاق`,
          { state: fenceState ?? null },
        );
      this.#assertStarting('check');
      this.#state = SUPERVISOR_STATES.STARTING_REAPER;
      await this.#startReaper();
      this.#assertStarting('reaper');
      this.#fenceRunning = true;
      this.#state = SUPERVISOR_STATES.RUNNING;
      this.#log({ ev: 'supervisor_running' });
      this.#scheduleMonitor();
      for (const rec of this.#workers.values()) {
        if (!this.#accepting()) break;
        await this.#bootWorker(rec);
      }
      return this.snapshot();
    } catch (error) {
      const code = supervisorErrorCode(error);
      this.#log({ ev: 'supervisor_start_failed', step: this.#state, code });
      if (this.#shutdown === null) {
        this.#lastError = code;
        await this.#stopAll(SUPERVISOR_STATES.FAILED, code);
      } else await this.#shutdown;
      throw error;
    }
  }

  async #startReaper() {
    const target = this.#o.options.reaper?.target ?? this.#root;
    /** @type {{ res: (v: unknown) => void, rej: (e: unknown) => void }} */
    let settle = { res: () => {}, rej: () => {} };
    const first = new Promise((res, rej) => {
      settle = { res, rej };
    });
    let firstDone = false;
    const wrapped = {
      reapLapsed: async () => {
        try {
          const r = await target.reapLapsed();
          if (!firstDone) {
            firstDone = true;
            settle.res(r);
          }
          return r;
        } catch (e) {
          if (!firstDone) {
            firstDone = true;
            settle.rej(e);
          }
          throw e;
        }
      },
    };
    const r = this.#o.options.reaper ?? {};
    try {
      this.#reaper = startLapseReaper(wrapped, {
        ceilingMs: this.#o.reaperCeilingMs,
        ...(r.retryMs === undefined ? {} : { retryMs: r.retryMs }),
        ...(r.maxRetryMs === undefined ? {} : { maxRetryMs: r.maxRetryMs }),
        onReap: (/** @type {any} */ x) =>
          this.#log({ ev: 'reaper_reaped', reaped: x?.reaped?.length ?? 0, ok: x?.ok === true }),
        onError: (/** @type {unknown} */ e, /** @type {any} */ info) =>
          this.#log({ ev: 'reaper_error', code: supervisorErrorCode(e), ...info }),
      });
    } catch (error) {
      throw new FenceError(FENCE_ERRORS.SUPERVISOR_REAPER_START, 'تعذّرَ بدءُ الحاصد', {
        cause: supervisorErrorCode(error),
      });
    }
    try {
      await supervisorTimeout(first, this.#o.firstTickTimeoutMs, () =>
        Object.assign(new Error('reaper first tick timeout'), {
          code: 'REAPER_FIRST_TICK_TIMEOUT',
        }),
      );
    } catch (error) {
      await this.#stopReaper();
      throw new FenceError(
        FENCE_ERRORS.SUPERVISOR_REAPER_START,
        'أوّلُ نداءٍ للحاصدِ فشل — لا إطلاقَ بلا حاصد',
        { cause: supervisorErrorCode(error) },
      );
    }
  }

  /**
   * يوقفُ الحاصدَ بمهلة: `stop()` ينتظرُ النداءَ الجاريَ، ونداءٌ لا يعودُ (‏وصلةٌ معلّقة — مقيسٌ في SUP-07) كان يُعلِّقُ
   * الإيقافَ والقفلَ ممسوكٌ إلى الأبد. بعدَ المهلةِ يُترَكُ النداءُ (‏الحاصدُ موقوفٌ فلا جدولةَ بعده) ويُكمَلُ الإيقاف.
   */
  async #stopReaper() {
    const reaper = this.#reaper;
    this.#reaper = null;
    if (reaper === null) return;
    await supervisorTimeout(reaper.stop(), this.#o.lockCheckTimeoutMs, () =>
      Object.assign(new Error('reaper stop timeout'), { code: 'REAPER_STOP_TIMEOUT' }),
    ).catch((e) => this.#log({ ev: 'reaper_stop_timeout', code: supervisorErrorCode(e) }));
  }

  #scheduleMonitor() {
    if (this.#shutdown !== null) return;
    this.#monitorTimer = setTimeout(() => {
      this.#monitorTimer = null;
      void this.#monitorTick().catch((e) =>
        this.#log({ ev: 'monitor_error', code: supervisorErrorCode(e) }),
      );
    }, this.#o.monitorIntervalMs);
  }

  async #monitorTick() {
    if (this.#shutdown !== null) return;
    try {
      const held = await supervisorTimeout(
        this.#lockClient.query(
          `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
             AND classid = $1::oid AND objid = $2::oid AND objsubid = 2 AND granted) AS held`,
          [...SUPERVISOR_LOCK_KEY],
        ),
        this.#o.lockCheckTimeoutMs,
        () => Object.assign(new Error('lock check timeout'), { code: 'LOCK_CHECK_TIMEOUT' }),
      );
      if (held.rows[0]?.held !== true)
        throw Object.assign(new Error('lock not held'), { code: 'LOCK_NOT_HELD' });
    } catch (error) {
      return this.#lockLost(error);
    }
    /** @type {any} */
    let status;
    try {
      status = await supervisorTimeout(this.#root.status(), this.#o.lockCheckTimeoutMs, () =>
        Object.assign(new Error('status timeout'), { code: 'STATUS_TIMEOUT' }),
      );
      this.#dbFailures = 0;
    } catch (error) {
      this.#dbFailures++;
      this.#log({
        ev: 'monitor_db_failure',
        n: this.#dbFailures,
        code: supervisorErrorCode(error),
      });
      if (this.#dbFailures >= this.#o.maxDbFailures) {
        return this.#fail(FENCE_ERRORS.SUPERVISOR_DB_UNREACHABLE);
      }
      return this.#scheduleMonitor();
    }
    if (this.#shutdown !== null) return;
    const running = status?.effective?.state === 'RUNNING';
    if (!running && this.#fenceRunning) {
      this.#fenceRunning = false;
      this.#state = SUPERVISOR_STATES.WAITING;
      this.#log({ ev: 'supervisor_waiting', fence: status?.effective?.state ?? null });
      this.#freezeWorkers();
      await this.#stopWorkers('FENCE_NOT_RUNNING');
    } else if (running && !this.#fenceRunning && this.#state === SUPERVISOR_STATES.WAITING) {
      try {
        await /** @type {SupervisorBootGate} */ (this.#gate).resweep();
      } catch (error) {
        this.#lastError = supervisorErrorCode(error);
        return this.#fail(this.#lastError);
      }
      if (this.#shutdown !== null) return;
      this.#fenceRunning = true;
      this.#state = SUPERVISOR_STATES.RUNNING;
      this.#log({ ev: 'supervisor_resumed' });
      for (const rec of this.#workers.values()) {
        rec.restarts = [];
        if (!this.#accepting()) break;
        await this.#bootWorker(rec);
      }
    }
    this.#scheduleMonitor();
  }

  /** @param {unknown} cause */
  async #lockLost(cause) {
    if (this.#shutdown !== null) return;
    this.#log({ ev: 'supervisor_lock_lost', code: supervisorErrorCode(cause) });
    return this.#fail(FENCE_ERRORS.SUPERVISOR_LOCK_LOST);
  }

  /** @param {string} code */
  async #fail(code) {
    if (this.#shutdown !== null) return this.#shutdown;
    this.#lastError = code;
    return this.#stopAll(SUPERVISOR_STATES.FAILED, code);
  }

  /** إيقافٌ منضبط: كلُّ اعتمادٍ يُلغى ثمّ كلُّ عاملٍ يُقتَل ثمّ يُحرَّرُ القفل. */
  async stop() {
    if (this.#shutdown !== null) return this.#shutdown;
    return this.#stopAll(SUPERVISOR_STATES.STOPPED, 'SUPERVISOR_STOP');
  }

  /** @param {string} final @param {string} reason */
  #stopAll(final, reason) {
    if (this.#shutdown !== null) return this.#shutdown;
    this.#shutdown = (async () => {
      this.#state = SUPERVISOR_STATES.STOPPING;
      this.#fenceRunning = false;
      this.#log({ ev: 'supervisor_stopping', reason });
      if (this.#monitorTimer !== null) clearTimeout(this.#monitorTimer);
      this.#monitorTimer = null;
      for (const t of this.#timers) clearTimeout(t);
      this.#timers.clear();
      // ‏تجميدُ كلِّ العمّالِ قبلَ أيِّ انتظار: لا حافظَ إيجارٍ يرى البوّابةَ موقوفةً فيُعلِنُ عاملاً مفقوداً
      // ‏بينما الإيقافُ يُلغي غيرَه (‏سباقٌ مقيسٌ في SUP-01: عاملٌ ثانٍ خرجَ من الإلغاءِ المرتّب).
      this.#freezeWorkers();
      this.#gate?.stop();
      const report = await this.#stopWorkers(reason);
      await this.#stopReaper();
      if (this.#lockClient !== null) {
        const c = this.#lockClient;
        this.#lockClient = null;
        c.removeAllListeners?.('end');
        c.removeAllListeners?.('error');
        c.on?.('error', () => {});
        await supervisorTimeout(
          c.query('SELECT pg_advisory_unlock($1, $2)', [...SUPERVISOR_LOCK_KEY]),
          this.#o.lockCheckTimeoutMs,
          () => new Error('unlock timeout'),
        ).catch(() => {});
        await supervisorTimeout(
          Promise.resolve(c.end?.()),
          this.#o.lockCheckTimeoutMs,
          () => new Error('end timeout'),
        ).catch(() => {});
      }
      this.#state = final;
      const result = {
        state: final,
        reason,
        ...report,
        unresolved: [...this.#unresolved],
        snapshot: this.snapshot(),
      };
      this.#log({
        ev: 'supervisor_stopped',
        state: final,
        reason,
        revokeErrors: report.revokeErrors.length,
      });
      this.#resolveDone(result);
      return result;
    })();
    return this.#shutdown;
  }

  /** يُبطِلُ مساراتِ كلِّ عاملٍ الجاريةَ (‏جيلٌ جديد) ويوقفُ حُفّاظَ الإيجارِ قبلَ أيِّ انتظار. */
  #freezeWorkers() {
    for (const rec of this.#workers.values()) {
      rec.gen++;
      rec.keeper?.stop();
      rec.keeper = null;
    }
  }

  /** @param {string} reason */
  async #stopWorkers(reason) {
    /** @type {string[]} */
    const revoked = [];
    /** @type {Array<{ role: string, error: string }>} */
    const revokeErrors = [];
    for (const rec of this.#workers.values()) {
      const booting = rec.boot;
      // ‏أيُّ اعتمادٍ ما زالَ مسجّلاً (‏RUNNING، أو LOST ومسارُ فقدِه لم يُكمِل) يُلغى هنا؛ الإلغاءُ لا يمسُّ إلا ACTIVE.
      if (rec.credential !== null && rec.state !== SUPERVISED_WORKER_STATES.BOOTING) {
        const role = String(rec.credential.role_name);
        try {
          await this.#serialRoot.revokeCredential(role, `SUPERVISOR:${reason}`);
          revoked.push(role);
        } catch (error) {
          revokeErrors.push({ role, error: supervisorErrorCode(error) });
          this.#log({
            ev: 'worker_revoke_failed',
            worker: rec.id,
            role,
            code: supervisorErrorCode(error),
          });
        }
      }
      await this.#kill(rec);
      // ‏إقلاعٌ جارٍ: قتلُ العمليّةِ يُنهي مصافحتَه أو ختمَه، ومسارُ فشلِه يُلغي ما صدر — يُنتظَرُ قبلَ الإبلاغ.
      if (booting !== null) await booting.catch(() => {});
      rec.boot = null;
      rec.credential = null;
      rec.state = SUPERVISED_WORKER_STATES.STOPPED;
    }
    return { revoked, revokeErrors };
  }

  /** @param {any} rec */
  async #kill(rec) {
    const child = rec.child;
    if (child === null || child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill('SIGTERM');
    } catch {
      // ‏عمليّةٌ ماتت للتوّ.
    }
    const hard = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ‏ماتت.
      }
    }, this.#o.killGraceMs);
    await supervisorTimeout(
      rec.exited,
      this.#o.killGraceMs * 2,
      () => new Error('kill timeout'),
    ).catch(() => this.#log({ ev: 'worker_kill_timeout', worker: rec.id, pid: child.pid ?? null }));
    clearTimeout(hard);
  }

  /**
   * يُلغي كلَّ اعتمادٍ ACTIVE لإقلاعٍ فشل (‏بمعرِّفِ الإقلاعِ من رسالةِ hello) — يسدُّ نافذةَ «صدرَ ولم يُسلَّم».
   * @param {any} rec @param {string | null} bootId @param {string} why
   */
  async #revokeLeftovers(rec, bootId, why) {
    if (bootId === null) return;
    /** @type {string[]} */
    let roles;
    try {
      roles = (
        await this.#root.with(
          async (c) =>
            (
              await c.query(
                `SELECT role_name::text AS role FROM fence.credentials WHERE worker_id = $1 AND boot_id = $2 AND status = 'ACTIVE'`,
                [rec.id, bootId],
              )
            ).rows,
        )
      ).map((/** @type {any} */ r) => String(r.role));
    } catch (error) {
      this.#unresolved.push({
        worker: rec.id,
        role: null,
        boot: bootId,
        error: supervisorErrorCode(error),
      });
      this.#log({
        ev: 'worker_leftover_lookup_failed',
        worker: rec.id,
        code: supervisorErrorCode(error),
      });
      return;
    }
    for (const role of roles) {
      try {
        await this.#serialRoot.revokeCredential(role, `SUPERVISOR_BOOT_FAILED:${why}`);
        this.#log({ ev: 'worker_leftover_revoked', worker: rec.id, role });
      } catch (error) {
        this.#unresolved.push({
          worker: rec.id,
          role,
          boot: bootId,
          error: supervisorErrorCode(error),
        });
        this.#log({
          ev: 'worker_revoke_failed',
          worker: rec.id,
          role,
          code: supervisorErrorCode(error),
        });
      }
    }
  }

  /** @param {any} rec */
  #bootWorker(rec) {
    const gen = ++rec.gen;
    rec.state = SUPERVISED_WORKER_STATES.BOOTING;
    rec.credential = null;
    rec.sessions = null;
    rec.bootId = null;
    rec.attempts++;
    const bootFailure = (/** @type {string} */ code, /** @type {unknown} */ detail = null) =>
      new FenceError(FENCE_ERRORS.SUPERVISOR_WORKER_BOOT, `إقلاعُ ${rec.id}: ${code}`, {
        code,
        detail,
      });
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      child = this.#o.options.spawnWorker(rec.spec, {
        env: { XUUX_DB_FENCE: 'required', XUUX_FENCE_WORKER_ID: rec.id },
        attempt: rec.attempts,
      });
    } catch (error) {
      rec.state = SUPERVISED_WORKER_STATES.BOOT_FAILED;
      rec.lastError = `SPAWN:${supervisorErrorCode(error)}`;
      this.#log({ ev: 'worker_spawn_failed', worker: rec.id, code: rec.lastError });
      this.#scheduleRestart(rec, gen);
      return Promise.resolve();
    }
    rec.child = child;
    child.on('error', (e) =>
      this.#log({ ev: 'worker_child_error', worker: rec.id, code: supervisorErrorCode(e) }),
    );
    /** @type {Promise<{ code: number | null, signal: string | null, error?: string }>} */
    const exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', (e) => {
        if (child.pid === undefined)
          resolve({ code: null, signal: null, error: supervisorErrorCode(e) });
      });
    });
    rec.exited = exited;
    exited.then((x) => {
      rec.lastExit = x;
    });
    const onHello = (/** @type {any} */ m) => {
      if (m?.type === 'xuux-fence/hello' && rec.bootId === null && rec.gen === gen)
        rec.bootId = String(m.boot_id);
    };
    child.on('message', onHello);
    // ‏صندوقُ رسائلِ الختم يُفتَحُ منذُ الإطلاق: العاملُ قد يُبلِغُ الختمَ أو فشلَه فورَ تسلّمِ الاعتماد، قبلَ أن ينتهيَ
    // ‏المُشرِفُ من `loginBroker` ويبدأَ `confirmWorkerSeal` بالاستماع (‏سباقٌ مقيسٌ في SUP-04: إبلاغُ فشلٍ ضاعَ فصارَ
    // ‏«timeout»). ما يصلُ قبلَ الاستماعِ يُخزَّنُ ويُعادُ بترتيبِه.
    const sealBus = new EventEmitter();
    /** @type {any[] | null} */
    let sealInbox = [];
    const onSealMessage = (/** @type {any} */ m) => {
      if (m?.type !== 'xuux-fence/sealed' && m?.type !== 'xuux-fence/seal-failed') return;
      if (sealInbox !== null) sealInbox.push(m);
      else sealBus.emit('message', m);
    };
    child.on('message', onSealMessage);
    this.#log({
      ev: 'worker_spawned',
      worker: rec.id,
      pid: child.pid ?? null,
      attempt: rec.attempts,
    });
    const boot = (async () => {
      try {
        /** @type {Record<string, any>} */
        const credential = await supervisorTimeout(
          Promise.race([
            superviseWorkerHandshake(this.#serialRoot, child, { expectedWorkerId: rec.id }),
            exited.then((x) => {
              throw bootFailure('WORKER_EXITED_DURING_HANDSHAKE', x);
            }),
          ]),
          this.#o.handshakeTimeoutMs,
          () => bootFailure('HANDSHAKE_TIMEOUT'),
        );
        // eslint-disable-next-line require-atomic-updates -- ‏التقادمُ يحرسُه rec.gen (‏يُفحَصُ في السطرِ التالي).
        rec.credential = credential;
        if (gen !== rec.gen || !this.#accepting()) throw bootFailure('SUPERVISOR_STOPPING');
        this.#log({ ev: 'worker_credential', worker: rec.id, role: String(credential.role_name) });
        if (this.#o.options.loginBroker !== undefined)
          await this.#o.options.loginBroker(credential);
        const role = String(credential.role_name);
        exited.then(() =>
          onSealMessage({
            type: 'xuux-fence/seal-failed',
            role_name: role,
            reason: 'WORKER_EXITED',
          }),
        );
        const sealed = confirmWorkerSeal(
          this.#serialRoot,
          /** @type {any} */ (sealBus),
          credential,
          {
            timeoutMs: this.#o.sealTimeoutMs,
          },
        );
        // ‏المستمعُ مُثبَّتٌ الآنَ (‏داخلَ مُنشئِ الوعد)؛ يُعادُ ما سبقَه ثمّ يصيرُ التوصيلُ مباشراً.
        const early = sealInbox ?? [];
        sealInbox = null;
        for (const m of early) sealBus.emit('message', m);
        const sessions = await sealed;
        child.off('message', onSealMessage);
        if (gen !== rec.gen || !this.#accepting()) throw bootFailure('SUPERVISOR_STOPPING');
        rec.sessions = sessions;
        rec.state = SUPERVISED_WORKER_STATES.RUNNING;
        rec.lastError = null;
        const intervalMs =
          this.#o.options.leaseIntervalMs ??
          Math.max(100, Number(credential.lease_renew_s ?? 1) * 1000);
        rec.keeper = this.#root.startLeaseKeeper(role, this.#guard, {
          intervalMs,
          onStop: (/** @type {unknown} */ why) => {
            if (
              rec.gen === gen &&
              rec.state === SUPERVISED_WORKER_STATES.RUNNING &&
              why !== 'stopped'
            )
              void this.#workerLost(rec, gen, `LEASE_KEEPER:${supervisorErrorCode(why)}`);
          },
        });
        exited.then((x) => {
          if (rec.gen === gen && rec.state === SUPERVISED_WORKER_STATES.RUNNING)
            void this.#workerLost(rec, gen, `EXIT:${x.code}/${x.signal}`);
        });
        this.#log({ ev: 'worker_running', worker: rec.id, role, sessions: sessions.length });
      } catch (error) {
        child.off('message', onHello);
        child.off('message', onSealMessage);
        const detailCode =
          error instanceof FenceError ? /** @type {any} */ (error.detail)?.code : undefined;
        const code = detailCode ? String(detailCode) : supervisorErrorCode(error);
        if (rec.gen === gen) {
          rec.state = SUPERVISED_WORKER_STATES.BOOT_FAILED;
          rec.lastError = code;
        }
        this.#log({ ev: 'worker_boot_failed', worker: rec.id, code });
        await this.#revokeLeftovers(rec, rec.bootId, code);
        await this.#kill(rec);
        if (rec.gen === gen) {
          rec.credential = null;
          this.#scheduleRestart(rec, gen);
        }
      }
    })();
    rec.boot = boot;
    return boot;
  }

  /** @param {any} rec @param {number} gen @param {string} why */
  async #workerLost(rec, gen, why) {
    if (rec.gen !== gen || rec.state !== SUPERVISED_WORKER_STATES.RUNNING) return;
    rec.state = SUPERVISED_WORKER_STATES.LOST;
    rec.lastError = why;
    rec.keeper?.stop();
    rec.keeper = null;
    this.#log({ ev: 'worker_lost', worker: rec.id, why });
    const role = rec.credential === null ? null : String(rec.credential.role_name);
    if (role !== null) {
      try {
        await this.#serialRoot.revokeCredential(role, `SUPERVISOR_WORKER_LOST:${why}`);
        this.#log({ ev: 'worker_revoked', worker: rec.id, role });
      } catch (error) {
        this.#unresolved.push({
          worker: rec.id,
          role,
          boot: rec.bootId,
          error: supervisorErrorCode(error),
        });
        this.#log({
          ev: 'worker_revoke_failed',
          worker: rec.id,
          role,
          code: supervisorErrorCode(error),
        });
      }
    }
    await this.#kill(rec);
    if (rec.gen !== gen) return;
    rec.credential = null;
    this.#scheduleRestart(rec, gen);
  }

  /** @param {any} rec @param {number} gen */
  #scheduleRestart(rec, gen) {
    if (!this.#accepting() || rec.gen !== gen) return;
    const now = Date.now();
    rec.restarts = rec.restarts.filter((/** @type {number} */ t) => now - t < this.#o.windowMs);
    if (rec.restarts.length >= this.#o.maxRestarts) {
      rec.state = SUPERVISED_WORKER_STATES.GAVE_UP;
      this.#log({ ev: 'worker_gave_up', worker: rec.id, restarts: rec.restarts.length });
      return;
    }
    rec.restarts.push(now);
    rec.state = SUPERVISED_WORKER_STATES.RESTARTING;
    const t = setTimeout(() => {
      this.#timers.delete(t);
      if (this.#accepting() && rec.gen === gen) void this.#bootWorker(rec);
    }, this.#o.backoffMs);
    this.#timers.add(t);
  }
}
