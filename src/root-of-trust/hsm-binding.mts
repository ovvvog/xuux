// src/root-of-trust/hsm-binding.mts
// جذر الثقة — الربط الإنتاجي لمفاتيح HSM بمسارات العمل (WL-088، ADR 0003).
//
// ما قبل هذه الوحدة: كان `Pkcs11HsmProvider` يقدّم قدرتين (توقيع وAEAD) داخل
// التوكن، لكن **لا مسار إنتاجي واحد** كان يستعملهما. مسار التوقيع الحقيقي كان
// `KingIdentity` وهو يحمل المادة الخاصة في ذاكرة العملية (`createPrivateKey`)،
// وسجل الأحداث كان يُكتب نصاً صريحاً على القرص. فكانت المفاتيح 05/06/07 موجودة
// في التوكن وغير مربوطة بشيء — قدرةٌ معلنة بلا استعمال.
//
// ما تفعله هذه الوحدة، بحدودٍ صريحة:
//   • F05 (`CKA_ID=05`, `event-log-aead-key`, AES-256-GCM): يُختم به **جسم**
//     بيانات الحدث داخل التوكن قبل الكتابة على القرص، ويُفكّ داخل التوكن عند
//     القراءة. لا يُشتق منه مفتاح برمجي ولا تُخرج مادته.
//   • F06 (`CKA_ID=06`, `king-signing-key`, Ed25519): يوقّع التثبيتات الدورية
//     (`anchor`) داخل التوكن.
//   • F07 (`CKA_ID=07`, `command-ledger-signing-key`, Ed25519): يوقّع قرارات
//     دفتر الأوامر داخل التوكن.
//
// ثلاث قواعد حاكمة، وكلٌّ منها اختبارٌ خصميّ لا تعليق:
//   1. **لا software fallback للمادة الخاصة.** لا `generateKeyPairSync` ولا
//      `createPrivateKey` ولا `sign()` برمجي في هذه الوحدة. التوقيع نداءٌ إلى
//      التوكن أو خطأ. والتحقق وحده برمجي — لأنه لا يحتاج إلا المفتاح **العام**،
//      وذاك يُصدَّر من التوكن قصداً.
//   2. **فشلٌ مغلق.** غياب التوكن، أو مخزنٌ يُعلن `canExport: true`، أو وجود
//      متغيّرات مخزن مفاتيح برمجي في البيئة، أو ختمٌ بمعرّف مفتاح آخر، أو صيغة
//      ختم لا تُفهم — كلّها رفضٌ برمزٍ صريح، لا تجاوزٌ ولا مسارٌ بديل.
//   3. **التوقيع غير متزامن ولا يُزيَّف تزامنه.** `AnchorSigner.sign` متزامن
//      في العقد القائم، وHSM لا يوقّع متزامناً. فبدل أن يُرجَع توقيعٌ برمجي من
//      مادة محلية (وهو عين الانهيار الذي نمنعه) يُرفع `HSM_SYNC_SIGN_UNSUPPORTED`
//      ويُستعمل `signAsync` عبر `createHsmAnchor`/`signLedgerEntry`.

import { Buffer } from 'node:buffer';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

import {
  AnchorError,
  FileAnchorStore,
  GENESIS_ANCHOR_HASH,
  hashAnchorBody,
  type AnchorBody,
  type AnchorRecord,
  type AnchorStore,
  type AnchorableLog,
} from './anchor.mjs';
import type { LedgerEntry } from './command-ledger.mjs';
import { verifyEventChain } from './event-log.mjs';
import { fingerprint } from './identity.mjs';
import type { AeadKeyHandle, SigningKeyHandle } from './pkcs11-provider.mjs';
import type { ProviderDescriptionLike } from './production-boot.mjs';
import {
  assertKingIdentityPinned,
  assertProductionKeyProviderAllowed,
  SOFTWARE_KEY_STORE_ENV_VARS,
} from './production-boot.mjs';

/**
 * أدوار المفاتيح الثلاثة كما هي في التوكن. المعرّفات والأسماء **مثبَّتة في
 * الكود** لا في البيئة: معرّفٌ يُقرأ من متغيّر بيئة يسمح بتوجيه جذر الثقة إلى
 * مفتاحٍ آخر بتعديل إعداد، وهو الهجوم نفسه الذي يمنعه تثبيت `KING_KEY_NAME`.
 */
export const HSM_KEY_ROLES = {
  eventLogAead: { keyId: '05', label: 'event-log-aead-key' },
  kingSigning: { keyId: '06', label: 'king-signing-key' },
  commandLedgerSigning: { keyId: '07', label: 'command-ledger-signing-key' },
} as const;

export type HsmKeyRole = keyof typeof HSM_KEY_ROLES;

/** خوارزمية الختم الوحيدة المقبولة. نصٌّ واحد كي يُرفض أي هبوط إليها من غيرها. */
export const SEAL_ALGORITHM = 'AES-256-GCM';

/** طول متجه التهيئة بالبايت (96 بت) — مثبَّت لأن GCM بغيره يفقد ضمانه. */
export const SEAL_IV_BYTES = 12;

/** طول علامة التوثيق بالبايت (128 بت). */
export const SEAL_TAG_BYTES = 16;

/**
 * متغيّرات بيئةٍ تدلّ على مخزن مفاتيح **برمجي**. وجود أيٍّ منها مع الربط
 * الإنتاجي يُرفض: مسارٌ برمجيٌّ مهيَّأ بجانب مسار HSM هو fallback بالفعل ولو
 * لم يُستدع، لأنه يُنتظر عند أول فشل.
 *
 * ومنذ `WL-089` صار مصدرُ هذه القائمةِ واحداً في `production-boot.mts`، ويُعاد
 * تصديرُها هنا باسمِها القائمِ حفظاً للعقدِ القائم: نسختانِ من قائمةِ منعٍ
 * تفترقانِ بمتغيّرٍ واحدٍ تُنتجانِ متغيّراً ممنوعاً في وحدةٍ مقبولاً في أخرى.
 */
export const SOFTWARE_KEY_ENV_VARS = SOFTWARE_KEY_STORE_ENV_VARS;

/** رموز أخطاء الربط، مثبَّتة نصاً كي تُختبر ولا تُخمَّن من رسالة. */
export const HsmBindingErrorCodes = [
  'HSM_SOFTWARE_FALLBACK_FORBIDDEN',
  'HSM_PROVIDER_EXPORTS_MATERIAL',
  'HSM_SYNC_SIGN_UNSUPPORTED',
  'HSM_PUBLIC_KEY_UNAVAILABLE',
  'HSM_SEAL_FORMAT_INVALID',
  'HSM_SEAL_KEY_MISMATCH',
  'HSM_SEAL_ALGORITHM_REJECTED',
  'HSM_SIGNATURE_LENGTH_INVALID',
  'HSM_LEDGER_ENTRY_INVALID',
  // `UF-05`: التوكنُ المفتوحُ ليس التوكنَ المُثبَّتَ ولو حملَ الاسمَ نفسَه.
  'HSM_TOKEN_SERIAL_MISMATCH',
] as const;

export type HsmBindingErrorCode = (typeof HsmBindingErrorCodes)[number];

/**
 * خطأ الربط. الرسالة هي الرمز، والتفصيل حقلٌ منفصل يحمل **أسماء** لا قيماً:
 * لا PIN ولا مادة ولا نص مشفَّر ولا مسار توكن يدخل رسالة خطأ.
 */
export class HsmBindingError extends Error {
  readonly code: HsmBindingErrorCode;
  readonly detail?: string;

  /**
   * @param code - رمز الخطأ
   * @param detail - تفصيلٌ يُقرأ برمجياً، بلا أسرار
   */
  constructor(code: HsmBindingErrorCode, detail?: string) {
    super(code);
    this.name = 'HsmBindingError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * أقلّ ما يحتاجه الربط من موفّر HSM. عقدٌ بنيويّ لا وراثة، كي يُختبر الربط
 * بموفّر مزيَّف في CI (بلا SoftHSM) فتُشتغَّل الاختبارات الخصمية فعلاً بدل أن
 * تُتجاوز — واختبارٌ يُتجاوز ليس اختباراً.
 */
export interface HsmKeySource {
  /**
   * وصفُ الموفّرِ **كما يُعلنه عن نفسِه**. و`kind` جزءٌ من العقدِ لا زيادةٌ فيه:
   * أثبتَ العضوُ الأولُ (‏`UF-02`) أنّ مصدراً يُعلن `canExport:false` و
   * `kind:'in-memory-opaque'` ويحملُ `PrivateKeyObject` في ذاكرةِ العمليةِ كان
   * يمرُّ من الربطِ بلا رفضٍ، لأن الفحصَ كان على `canExport` وحدَه.
   */
  describe(): {
    canExport: boolean;
    kind?: string;
    productionReady?: boolean;
    tokenSerial?: string;
  };
  getSigningKey(keyId: string): Promise<SigningKeyHandle>;
  getAeadKey(keyId: string): Promise<AeadKeyHandle>;
}

/** ختمٌ محفوظ على القرص. لا يحمل مفتاحاً، ويحمل معرّف المفتاح كي لا يُخلط. */
export interface SealedPayload {
  alg: typeof SEAL_ALGORITHM;
  keyId: string;
  iv: string;
  ct: string;
  tag: string;
}

/**
 * يرفض وجود مخزن مفاتيح برمجي في البيئة إلى جانب الربط الإنتاجي.
 * @param env - البيئة المقروءة
 */
export function assertNoSoftwareKeyFallback(env: NodeJS.ProcessEnv = process.env): void {
  const present = SOFTWARE_KEY_ENV_VARS.filter((name) => {
    const value = env[name];
    return value !== undefined && value !== '';
  });
  if (present.length > 0) {
    // أسماء المتغيّرات فقط؛ قيمها أسرار.
    throw new HsmBindingError('HSM_SOFTWARE_FALLBACK_FORBIDDEN', present.join(','));
  }
}

/**
 * يرفض موفّراً يُعلن أنه يُخرج المادة الخاصة. الربط الإنتاجي لا يقبل مخزناً
 * قابلاً للتصدير، ولو كان الاستعمال الحاضر لا يصدّر.
 * @param source - الموفّر المرشَّح
 */
export function assertNonExportingSource(source: HsmKeySource): void {
  // `!== false` نصّاً لا صدقيّةً (‏`UF-10`): `canExport: undefined` و`0` كانا
  // يمرّانِ. ومَن لم يقلْ «لا أُصدِّر» صريحاً لم يُعلِنْ أنه لا يُصدِّر.
  if (source.describe().canExport !== false) {
    throw new HsmBindingError('HSM_PROVIDER_EXPORTS_MATERIAL');
  }
}

/**
 * يحكمُ على مصدرِ المفاتيحِ بعقدِ الإقلاعِ الإنتاجيِّ كاملاً — لا بفحصِ التصديرِ
 * وحدَه. وهذا هو البابُ الذي كان مفقوداً في `UF-02`: `assertProductionKeyProviderAllowed`
 * كانت موجودةً ومُختبَرةً، **ولا مصنعَ إنتاجيٍّ ينادِيها**.
 * @param source - الموفّرُ المرشَّح
 * @param env - البيئةُ المقروءة
 */
export function assertProductionSource(
  source: HsmKeySource,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const description = source.describe();
  assertNonExportingSource(source);
  const like: ProviderDescriptionLike = {
    // موفّرٌ لا يُعلن نوعَه لا يُقرأُ نوعُه افتراضاً: `unknown` تُرَدُّ في الإنتاجِ
    // كما يُرَدُّ كلُّ ما ليس `pkcs11-hsm`.
    kind: description.kind ?? 'unknown',
    canExport: description.canExport,
  };
  if (description.productionReady !== undefined) like.productionReady = description.productionReady;
  assertProductionKeyProviderAllowed(like, env);
}

/**
 * يقابلُ الرقمَ التسلسليَّ للتوكنِ المفتوحِ بالمُثبَّتِ في البيئةِ (‏`UF-05`). في
 * الإنتاجِ التثبيتُ إلزاميٌّ (يفرضُه `assertHsmRequiredInProduction`)، وهنا تقعُ
 * **المقابلةُ** لا الإلزامُ — فالموفّرُ المزيَّفُ في الاختبارِ لا يحملُ رقماً.
 * @param source - الموفّرُ المفتوح
 * @param env - البيئةُ المقروءة
 */
export function assertPinnedToken(
  source: HsmKeySource,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const pinned = (env.XUUX_PKCS11_TOKEN_SERIAL ?? '').trim();
  if (pinned === '') return;
  const serial = source.describe().tokenSerial;
  if (serial === undefined) return;
  if (serial.trim() !== pinned) {
    throw new HsmBindingError('HSM_TOKEN_SERIAL_MISMATCH', 'XUUX_PKCS11_TOKEN_SERIAL');
  }
}

/**
 * يتحقق من أن حقلاً نصياً base64 موجودٌ وبطولٍ متوقَّع بالبايت.
 * @param value - القيمة المفحوصة
 * @param bytes - الطول المطلوب، أو `0` لأي طول موجب
 * @returns البايتات المفكوكة
 */
function decodeExact(value: unknown, bytes: number): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HsmBindingError('HSM_SEAL_FORMAT_INVALID');
  }
  const buffer = Buffer.from(value, 'base64');
  // إعادة الترميز تُكشف نصاً ليس base64 صحيحاً؛ فـ`Buffer.from` يتجاوز الحرف
  // الغريب بصمت، وتجاوزٌ صامت في فكّ ختمٍ أمنيّ ثغرة لا تسامح.
  if (buffer.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new HsmBindingError('HSM_SEAL_FORMAT_INVALID');
  }
  if (bytes > 0 ? buffer.length !== bytes : buffer.length === 0) {
    throw new HsmBindingError('HSM_SEAL_FORMAT_INVALID');
  }
  return buffer;
}

/**
 * يختم جسم بيانات حدثٍ داخل التوكن بمفتاح F05.
 * @param handle - مقبض AEAD من التوكن
 * @param data - البيانات المراد ختمها (تُرتَّب JSON)
 * @returns ختمٌ صالحٌ للكتابة على القرص
 */
export async function sealEventData(handle: AeadKeyHandle, data: unknown): Promise<SealedPayload> {
  const plaintext = Buffer.from(JSON.stringify(data ?? null), 'utf8');
  const { ciphertext, iv, tag } = await handle.encrypt(plaintext);
  if (iv.length !== SEAL_IV_BYTES || tag.length !== SEAL_TAG_BYTES) {
    throw new HsmBindingError('HSM_SEAL_FORMAT_INVALID', 'iv/tag');
  }
  return {
    alg: SEAL_ALGORITHM,
    keyId: handle.keyId,
    iv: iv.toString('base64'),
    ct: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * يفكّ ختم جسم حدثٍ داخل التوكن. كل انحرافٍ في الصيغة أو في معرّف المفتاح أو
 * في الخوارزمية رفضٌ صريح قبل أي نداء تشفير.
 * @param handle - مقبض AEAD من التوكن
 * @param sealed - الختم كما قُرئ من القرص
 * @returns البيانات الأصلية
 */
export async function openEventData(
  handle: AeadKeyHandle,
  sealed: SealedPayload | unknown,
): Promise<unknown> {
  if (sealed === null || typeof sealed !== 'object') {
    throw new HsmBindingError('HSM_SEAL_FORMAT_INVALID');
  }
  const record = sealed as Partial<SealedPayload>;
  if (record.alg !== SEAL_ALGORITHM) {
    // خوارزميةٌ أخرى — ولو كانت أقوى اسماً — رفضٌ: قبول تعدّد الخوارزميات في
    // القارئ هو باب هجوم الهبوط (downgrade).
    throw new HsmBindingError('HSM_SEAL_ALGORITHM_REJECTED', String(record.alg));
  }
  if (typeof record.keyId !== 'string' || record.keyId !== handle.keyId) {
    throw new HsmBindingError('HSM_SEAL_KEY_MISMATCH');
  }
  const iv = decodeExact(record.iv, SEAL_IV_BYTES);
  const tag = decodeExact(record.tag, SEAL_TAG_BYTES);
  const ciphertext = decodeExact(record.ct, 0);
  const plaintext = await handle.decrypt(ciphertext, iv, tag);
  try {
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new HsmBindingError('HSM_SEAL_FORMAT_INVALID', 'plaintext');
  }
}

/**
 * موقّعٌ مسنودٌ بالتوكن. يوافق `AnchorSigner` في التحقق والمعرّف، ويرفض
 * التوقيع المتزامن بدل أن يوقّع برمجياً.
 */
export class HsmSigner {
  readonly role: HsmKeyRole;
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly id: string;
  readonly activeVersion: number;
  readonly #handle: SigningKeyHandle;
  readonly #publicKey: ReturnType<typeof createPublicKey>;

  private constructor(input: {
    role: HsmKeyRole;
    handle: SigningKeyHandle;
    publicKeyPem: string;
    keyVersion: number;
  }) {
    this.role = input.role;
    this.keyId = input.handle.keyId;
    this.publicKeyPem = input.publicKeyPem;
    this.#handle = input.handle;
    this.#publicKey = createPublicKey(input.publicKeyPem);
    if (this.#publicKey.asymmetricKeyType !== 'ed25519') {
      throw new HsmBindingError('HSM_PUBLIC_KEY_UNAVAILABLE', 'not-ed25519');
    }
    // نفس اشتقاق `KingIdentity`: بصمة المفتاح العام. فمعرّف الملك لا يتغيّر
    // بتغيّر موضع المفتاح، ويتغيّر بتغيّر المفتاح — وهو عين ما يُثبت التدوير.
    const digest = fingerprint(this.#publicKey).slice(0, 24);
    this.id = (input.role === 'kingSigning' ? 'king:' : 'ledger:') + digest;
    this.activeVersion = input.keyVersion;
  }

  /**
   * يفتح موقّعاً من التوكن لدورٍ معلوم. يتحقق من عدم قابلية التصدير ومن غياب
   * مخزنٍ برمجي في البيئة **قبل** طلب المقبض.
   * @param source - موفّر التوكن
   * @param role - دور المفتاح (`kingSigning` أو `commandLedgerSigning`)
   * @param options - إصدار المفتاح والبيئة المفحوصة
   * @returns موقّعاً جاهزاً
   */
  static async open(
    source: HsmKeySource,
    role: 'kingSigning' | 'commandLedgerSigning',
    options: { keyVersion?: number; env?: NodeJS.ProcessEnv } = {},
  ): Promise<HsmSigner> {
    assertNoSoftwareKeyFallback(options.env ?? process.env);
    assertNonExportingSource(source);
    const handle = await source.getSigningKey(HSM_KEY_ROLES[role].keyId);
    let publicKeyPem: string;
    try {
      publicKeyPem = await handle.exportPublicPem();
    } catch {
      throw new HsmBindingError('HSM_PUBLIC_KEY_UNAVAILABLE', role);
    }
    return new HsmSigner({
      role,
      handle,
      publicKeyPem,
      keyVersion: options.keyVersion ?? 1,
    });
  }

  /**
   * يرفض التوقيع المتزامن. هذا **ليس** نقصاً بل هو الضمان: لو أُرجع توقيعٌ من
   * هنا لكان من مادةٍ برمجية محليّة، وذاك ما تمنعه هذه الوحدة كلّها.
   * @returns لا يُرجع شيئاً أبداً
   */
  sign(): never {
    throw new HsmBindingError('HSM_SYNC_SIGN_UNSUPPORTED', this.role);
  }

  /**
   * يوقّع مادةً داخل التوكن.
   * @param payload - المادة الكائنية (تُرتَّب JSON كما في `KingIdentity`)
   * @returns التوقيع بترميز base64url
   */
  async signAsync(payload: object): Promise<string> {
    const signature = await this.#handle.sign(Buffer.from(JSON.stringify(payload), 'utf8'));
    if (!Buffer.isBuffer(signature) || signature.length !== 64) {
      throw new HsmBindingError('HSM_SIGNATURE_LENGTH_INVALID', String(signature?.length ?? 0));
    }
    return signature.toString('base64url');
  }

  /**
   * يتحقق من توقيعٍ بالمفتاح **العام** المُصدَّر من التوكن. متزامنٌ وبرمجيٌّ
   * قصداً: التحقق لا يحتاج مادةً خاصة، فجعله نداءً إلى التوكن يزيد كلفةً بلا
   * ضمان — ويمنع التدقيق الخارجي.
   * @param payload - المادة الموقَّعة
   * @param signature - التوقيع بترميز base64url
   * @returns صحة التوقيع؛ وكل ما لا يمكن التحقق منه `false`
   */
  verify(payload: object, signature: string): boolean {
    if (typeof signature !== 'string' || signature === '') return false;
    try {
      return cryptoVerify(
        null,
        Buffer.from(JSON.stringify(payload), 'utf8'),
        this.#publicKey,
        Buffer.from(signature, 'base64url'),
      );
    } catch {
      return false;
    }
  }

  /**
   * الإصدار الذي قَبِل التوقيع، أو `null` إن لم يُقبل — يوافق عقد `AnchorSigner`.
   * @param payload - المادة الموقَّعة
   * @param signature - التوقيع
   * @returns رقم الإصدار أو `null`
   */
  verifyingVersion(payload: object, signature: string): number | null {
    return this.verify(payload, signature) ? this.activeVersion : null;
  }
}

/** ما يربطه `bindHsmRootOfTrust`: مقبض F05 وموقّعا F06/F07. */
export interface HsmRootOfTrustBinding {
  eventLogAead: AeadKeyHandle;
  kingSigner: HsmSigner;
  ledgerSigner: HsmSigner;
}

/**
 * يربط المفاتيح الثلاثة بمساراتها الإنتاجية في نداءٍ واحد. الترتيب مقصود:
 * فحوص البيئة والتصدير أولاً، ثم AEAD، ثم الموقّعان — فلا يُفتح مقبضٌ واحد إن
 * كانت البيئة أصلاً مرفوضة.
 * @param source - موفّر التوكن
 * @param options - البيئة وإصدارات المفاتيح
 * @returns المقابض الثلاثة
 */
export async function bindHsmRootOfTrust(
  source: HsmKeySource,
  options: { env?: NodeJS.ProcessEnv; kingKeyVersion?: number; ledgerKeyVersion?: number } = {},
): Promise<HsmRootOfTrustBinding> {
  const env = options.env ?? process.env;
  assertNoSoftwareKeyFallback(env);
  // العقدُ كاملاً لا شقُّه: نوعُ الموفّرِ وتصديرُه وجاهزيّتُه، ثم هويةُ التوكنِ
  // المُثبَّتة — كلُّها قبلَ فتحِ مقبضٍ واحد (‏`UF-02` و`UF-05`).
  assertProductionSource(source, env);
  assertPinnedToken(source, env);
  const eventLogAead = await source.getAeadKey(HSM_KEY_ROLES.eventLogAead.keyId);
  if (eventLogAead.keyId !== HSM_KEY_ROLES.eventLogAead.keyId) {
    throw new HsmBindingError('HSM_SEAL_KEY_MISMATCH', 'eventLogAead');
  }
  const signerOptions = (version?: number): { keyVersion?: number; env: NodeJS.ProcessEnv } =>
    version === undefined ? { env } : { keyVersion: version, env };
  const kingSigner = await HsmSigner.open(
    source,
    'kingSigning',
    signerOptions(options.kingKeyVersion),
  );
  // هويةُ الملكِ تُقابَلُ بالمُثبَّتةِ **قبلَ** فتحِ موقّعِ الدفترِ: توكنٌ بديلٌ
  // بالاسمِ نفسِه يُرَدُّ عندَ أوّلِ مفتاحٍ يُعرَف، لا بعدَ استكمالِ الربط.
  assertKingIdentityPinned(kingSigner.id, env);
  const ledgerSigner = await HsmSigner.open(
    source,
    'commandLedgerSigning',
    signerOptions(options.ledgerKeyVersion),
  );
  return { eventLogAead, kingSigner, ledgerSigner };
}

// — F06: التثبيت الموقَّع داخل التوكن —

/**
 * يبني تثبيتاً موقَّعاً داخل التوكن. نظير `createAnchor` بلا نسخ منطق التجزئة:
 * نفس `hashAnchorBody` ونفس ترتيب الحقول، فلا يتفارق تثبيتٌ برمجيٌّ وتثبيتٌ
 * عتاديّ في التحقق.
 * @param state - العدد وآخر تجزئة
 * @param previous - التثبيت السابق أو `null`
 * @param signer - موقّع F06
 * @param at - لحظة التثبيت
 * @returns تثبيت موقَّع
 */
export async function createHsmAnchor(
  state: { count: number; lastHash: string },
  previous: AnchorRecord | null,
  signer: HsmSigner,
  at: Date = new Date(),
): Promise<AnchorRecord> {
  if (state.count <= 0) throw new AnchorError('NOTHING_TO_ANCHOR', 'سجل بلا أحداث');
  if (previous && state.count < previous.count) {
    throw new AnchorError(
      'ANCHOR_BEHIND_STORE',
      `آخر تثبيت عند ${previous.count} والسجل ${state.count}`,
    );
  }
  const body: AnchorBody = {
    version: 1,
    seq: (previous?.seq ?? 0) + 1,
    count: state.count,
    lastHash: state.lastHash,
    previousAnchorHash: previous?.hash ?? GENESIS_ANCHOR_HASH,
    at: at.toISOString(),
    kingId: signer.id,
    keyVersion: signer.activeVersion,
  };
  return { ...body, hash: hashAnchorBody(body), signature: await signer.signAsync(body) };
}

/**
 * يثبّت حالة السجل الحاضرة ويحفظها، بتوقيع F06 داخل التوكن.
 * يرفض تثبيت سجلٍ سلسلته مكسورة: التوقيع لا يصحّح، إنما يُلزِم.
 * @param store - مخزن التثبيتات المنفصل
 * @param signer - موقّع F06
 * @param log - السجل
 * @param at - لحظة التثبيت
 * @returns التثبيت المحفوظ
 */
export async function anchorLogWithHsm(
  store: AnchorStore,
  signer: HsmSigner,
  log: AnchorableLog,
  at: Date = new Date(),
): Promise<AnchorRecord> {
  if (log.file !== undefined && store instanceof FileAnchorStore) {
    store.assertSeparateFrom(log.file);
  }
  const chain = verifyEventChain(log.events);
  if (!chain.ok) {
    throw new AnchorError('UNSIGNABLE_LOG', `السلسلة مكسورة عند ${chain.brokenAt ?? 0}`);
  }
  const anchors = store.read();
  const previous = anchors.length === 0 ? null : (anchors[anchors.length - 1] ?? null);
  const record = await createHsmAnchor(
    { count: chain.count, lastHash: chain.lastHash },
    previous,
    signer,
    at,
  );
  store.append(record);
  return record;
}

// — F07: قرارات دفتر الأوامر الموقَّعة داخل التوكن —

/** سطر دفترٍ موقَّع: نفس السطر القديم، مع منشئه التشفيري. */
export interface SignedLedgerEntry extends LedgerEntry {
  keyId: string;
  keyVersion: number;
  signature: string;
}

/**
 * المادة الموقَّعة من سطر الدفتر. مصفوفةٌ مبنيّةٌ بالترتيب لا كائنٌ يُرتَّب،
 * كي لا تكسر إعادةُ ترتيب حقلٍ في الشيفرة توقيعاتٍ محفوظة. و`reason` يدخل
 * التوقيع حين يوجد لأن سبب الإلغاء جزءٌ من القرار لا تعليقٌ عليه.
 * @param entry - سطر الدفتر
 * @returns المادة القابلة للتوقيع
 */
export function ledgerEntryBody(entry: LedgerEntry): (string | number | null)[] {
  if (
    typeof entry?.id !== 'string' ||
    entry.id.length === 0 ||
    (entry.state !== 'committed' && entry.state !== 'aborted') ||
    typeof entry.pid !== 'number' ||
    typeof entry.at !== 'string' ||
    entry.at.length === 0
  ) {
    throw new HsmBindingError('HSM_LEDGER_ENTRY_INVALID');
  }
  return [entry.id, entry.state, entry.pid, entry.at, entry.reason ?? null];
}

/**
 * يوقّع قرار أمرٍ بمفتاح F07 داخل التوكن.
 * @param signer - موقّع F07
 * @param entry - سطر الدفتر
 * @returns السطر نفسه مع معرّف المفتاح وإصداره وتوقيعه
 */
export async function signLedgerEntry(
  signer: HsmSigner,
  entry: LedgerEntry,
): Promise<SignedLedgerEntry> {
  const body = ledgerEntryBody(entry);
  const signature = await signer.signAsync(body);
  return { ...entry, keyId: signer.keyId, keyVersion: signer.activeVersion, signature };
}

/**
 * يتحقق من سطر دفترٍ موقَّع. يرفض سطراً يزعم معرّف مفتاح أو إصداراً غير الذي
 * قَبِله التحقق: الكذب في المنشأ عبثٌ أيضاً ولو صحّ التوقيع.
 * @param signer - موقّع F07 (يستعمل مفتاحه العام)
 * @param entry - السطر الموقَّع
 * @returns صحة السطر
 */
export function verifyLedgerEntry(signer: HsmSigner, entry: SignedLedgerEntry): boolean {
  if (entry?.keyId !== signer.keyId) return false;
  if (entry.keyVersion !== signer.activeVersion) return false;
  let body: (string | number | null)[];
  try {
    body = ledgerEntryBody(entry);
  } catch {
    return false;
  }
  return signer.verify(body, entry.signature);
}
