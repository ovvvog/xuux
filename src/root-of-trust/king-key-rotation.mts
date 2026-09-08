// جذر الثقة — تدوير مفتاح الملك (الخطوة M2.04).
//
// المشكلة التي تحلّها هذه الوحدة: بعد M2.03 صار لمفتاح الملك موضعٌ ثابت في
// مخزن خارجي، فثبتت هوية الملك عبر التشغيلات. لكن مفتاحاً ثابتاً بلا تدوير
// يعني أن أي تسرّب — الآن أو بعد سنوات — يُسقط الجذر إلى الأبد، وأن كل
// إجراءات الطوارئ تنتهي إلى «أعِد التزويد من الصفر» أي إبطال كل شهادة صدرت.
//
// والتدوير الساذج أسوأ من عدمه: استبدال المادة في موضعها يجعل كل توقيع سابق
// وكل شهادة قائمة غير قابلة للتحقق **لحظةَ** الاستبدال، فتتوقف الدولة بلا
// إعلان. ولذلك التدوير هنا أربعة أجزاء لا جزء واحد، وهي حرفياً معيار M2.04:
//   1. **إصدار جديد**: كل مفتاح يسكن مفتاحاً مستقلاً في المخزن برقم إصدار،
//      ولا تُطمس مادة إصدار قائم أبداً.
//   2. **فترة تعايش**: الإصدار السابق يبقى **مقبولاً للتحقق** ومُمتنعاً عن
//      التوقيع مدةً معلَنة، فتُعطى الأنظمة القائمة وقتاً لإعادة التوقيع.
//   3. **إبطال القديم**: إبطال صريح يمحو المادة من المخزن ويسجّل السبب،
//      فيصير كل توقيع بذلك الإصدار مرفوضاً — لا «منتهياً» فقط.
//   4. **إعادة توقيع الشهادات**: شهادة صدرت عن إصدار قديم يُعاد إصدارها عن
//      الفعّال بنفس معرّفها، فتبقى قوائم السحب القائمة نافذة عليها.
//
// حدود معلَنة:
//   - البيان (manifest) يقيم في المخزن نفسه بلا توقيع. وذلك **قصدٌ لا سهو**:
//     من يملك الكتابة في المخزن يملك قراءة مادة المفاتيح أيضاً، فتوقيع البيان
//     بمفتاح ساكن في المخزن ذاته لا يضيف حماية حقيقية بل يوهم بها. حمايته
//     الحقيقية صلاحيات المخزن، وهي إعداد تشغيلي لا كود (M5).
//   - التعايش يُقاس بساعة المستدعي؛ وانزياح الساعة سطح هجوم معروف موضعه
//     M2.09. ولذلك انتهاء التعايش **لا يمحو** المادة: المحو لا يقع إلا
//     بإبطال صريح، فلا تُهدم القدرة على التحقق بساعةٍ مغشوشة.
//   - لا توقيع داخل حدود HSM هنا أيضاً: الوحدة تعمل على مخزن يُخرج المادة،
//     كما في M2.03، ويُرفض غيره صراحةً.

import { generateKeyPairSync } from 'node:crypto';
import type { Certificate, CertificateBody } from './identity.mjs';
import { KingIdentity } from './identity.mjs';
import type { KeyProvider } from './key-provider.mjs';
import {
  KING_KEY_NAME,
  KingKeyError,
  assertKingKeyProviderFit,
  kingIdentityFromMaterial,
  type KingKeyOptions,
} from './king-key.mjs';

/** موضع بيان الإصدارات في المخزن. اسمٌ مستقل عن مادة المفاتيح ولا يحمل سرًّا. */
export const KING_KEY_MANIFEST_NAME = 'king-key-manifest';

/** فترة التعايش الافتراضية: يوم واحد. معلَنة رقماً لا مخفية في الكود. */
export const DEFAULT_COEXISTENCE_MS = 24 * 60 * 60 * 1000;

/** حالات الإصدار. الفعّال يوقّع، والمتعايش يُتحقَّق به فقط، والمُبطَل يُرفض. */
export const KingKeyVersionStatuses = ['active', 'retiring', 'revoked'] as const;

export type KingKeyVersionStatus = (typeof KingKeyVersionStatuses)[number];

/** رموز أخطاء التدوير. مثبَّتة نصاً لأن الاختبارات توازنها. */
export const KingKeyRotationErrorCodes = [
  'MANIFEST_INVALID',
  'VERSION_NOT_FOUND',
  'CANNOT_REVOKE_ACTIVE_VERSION',
  'VERSION_ALREADY_REVOKED',
  'ACTIVE_VERSION_REVOKED',
  'COEXISTENCE_WINDOW_INVALID',
] as const;

export type KingKeyRotationErrorCode = (typeof KingKeyRotationErrorCodes)[number];

/** خطأ التدوير. الرسالة هي الرمز، ولا تحمل مادة ولا اسم مخزن ولا توكن. */
export class KingKeyRotationError extends Error {
  readonly code: KingKeyRotationErrorCode;

  constructor(code: KingKeyRotationErrorCode) {
    super(code);
    this.name = 'KingKeyRotationError';
    this.code = code;
  }
}

/** سجل إصدار واحد. يحمل المفتاح **العام** وحالته، ولا يحمل مادة خاصة قطعاً. */
export interface KingKeyVersion {
  version: number;
  keyName: string;
  kingId: string;
  publicKeyPem: string;
  status: KingKeyVersionStatus;
  createdAt: string;
  retiredAt?: string;
  coexistUntil?: string;
  revokedAt?: string;
  revocationReason?: string;
}

/** بيان الإصدارات: أيّها يوقّع، وأيّها ما زال مقبولاً، وأيّها أُبطل ولماذا. */
export interface KingKeyManifest {
  baseKeyName: string;
  activeVersion: number;
  versions: KingKeyVersion[];
}

/** خيارات مشتركة: القيد الإنتاجي من M2.03، وساعةٌ قابلة للحقن للاختبار. */
export interface RotationOptions extends KingKeyOptions {
  now?: Date;
}

/** خيارات التدوير: مدة التعايش بالمللي ثانية. */
export interface RotateOptions extends RotationOptions {
  coexistenceMs?: number;
}

/** حصيلة التدوير: معلومة عامة فقط، ولا تُرجَع المادة الجديدة إلى المستدعي. */
export interface RotationResult {
  version: number;
  previousVersion: number;
  kingId: string;
  publicKeyPem: string;
  coexistUntil: string;
  manifest: KingKeyManifest;
}

/**
 * يبني اسم مفتاح الإصدار في المخزن.
 * الإصدار الأول يحتفظ بالاسم القديم `king-signing-key` قصداً: مخزنٌ زُوِّد في
 * M2.03 يصير إصداراً أولَ بلا نقل مادة ولا هجرة، و`loadKingIdentity` القديمة
 * تبقى تعمل عليه حرفياً. ونقل المادة كان سيعني كتابتها مرة أخرى بلا حاجة.
 * @param version - رقم الإصدار
 * @returns اسم المفتاح في المخزن
 */
export function kingKeyNameForVersion(version: number): string {
  return version === 1 ? KING_KEY_NAME : `${KING_KEY_NAME}:v${version}`;
}

/**
 * يتحقق من شكل البيان قبل الاعتماد عليه. بيانٌ تالف يُرفض ولا يُصلَح تخميناً،
 * لأن «إصلاح» بيان جذر الثقة تلقائياً قد يعني ترقية إصدار مُبطَل إلى فعّال.
 * @param value - القيمة المقروءة من المخزن
 * @returns البيان بعد التحقق
 */
function assertManifest(value: unknown): KingKeyManifest {
  if (typeof value !== 'object' || value === null)
    throw new KingKeyRotationError('MANIFEST_INVALID');
  const candidate = value as Partial<KingKeyManifest>;
  if (
    typeof candidate.baseKeyName !== 'string' ||
    typeof candidate.activeVersion !== 'number' ||
    !Array.isArray(candidate.versions) ||
    candidate.versions.length === 0
  ) {
    throw new KingKeyRotationError('MANIFEST_INVALID');
  }
  for (const version of candidate.versions) {
    if (
      typeof version?.version !== 'number' ||
      typeof version.keyName !== 'string' ||
      typeof version.kingId !== 'string' ||
      typeof version.publicKeyPem !== 'string' ||
      typeof version.createdAt !== 'string' ||
      !KingKeyVersionStatuses.includes(version.status)
    ) {
      throw new KingKeyRotationError('MANIFEST_INVALID');
    }
  }
  if (!candidate.versions.some((version) => version.version === candidate.activeVersion)) {
    throw new KingKeyRotationError('MANIFEST_INVALID');
  }
  return candidate as KingKeyManifest;
}

/**
 * يقرأ البيان من المخزن إن وُجد. **قراءة محضة**: لا يكتب شيئاً، لأن دالة قراءة
 * تكتب في مخزن جذر الثقة تُفاجئ من يستدعيها للتدقيق وحده.
 * @param provider - المخزن المقروء
 * @returns البيان أو `null` إن لم يُنشأ بعد
 */
export async function readKingKeyManifest(provider: KeyProvider): Promise<KingKeyManifest | null> {
  if (!(await provider.has(KING_KEY_MANIFEST_NAME))) return null;
  const raw = await provider.get(KING_KEY_MANIFEST_NAME);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KingKeyRotationError('MANIFEST_INVALID');
  }
  return assertManifest(parsed);
}

/**
 * يكتب البيان مع الطمس، لأن البيان حالةٌ تتغير بطبيعتها بخلاف مادة المفتاح.
 * @param provider - المخزن المكتوب فيه
 * @param manifest - البيان الجديد
 */
async function writeManifest(provider: KeyProvider, manifest: KingKeyManifest): Promise<void> {
  await provider.put(KING_KEY_MANIFEST_NAME, JSON.stringify(manifest, null, 2), {
    overwrite: true,
  });
}

/**
 * يضمن وجود بيان: إن غاب بُني من المفتاح المزوَّد في M2.03 كإصدار أول.
 * @param provider - المخزن
 * @param options - قيود الربط والساعة
 * @returns البيان الموجود أو المُنشأ
 */
export async function ensureKingKeyManifest(
  provider: KeyProvider,
  options: RotationOptions = {},
): Promise<KingKeyManifest> {
  const existing = await readKingKeyManifest(provider);
  if (existing) return existing;
  if (!(await provider.has(KING_KEY_NAME))) {
    // لا بيان ولا مفتاح: لا يُزوَّد مفتاح ملك ضمناً من دالة تدوير. التزويد
    // فعلٌ سيادي له مساره المعلَن في M2.03.
    throw new KingKeyError('KING_KEY_NOT_PROVISIONED');
  }
  const king = await loadVersionIdentity(provider, KING_KEY_NAME, options);
  const created = (await provider.list()).find((record) => record.name === KING_KEY_NAME);
  const manifest: KingKeyManifest = {
    baseKeyName: KING_KEY_NAME,
    activeVersion: 1,
    versions: [
      {
        version: 1,
        keyName: KING_KEY_NAME,
        kingId: king.id,
        publicKeyPem: king.publicKey.export({ type: 'spki', format: 'pem' }) as string,
        status: 'active',
        createdAt: created?.createdAt ?? (options.now ?? new Date()).toISOString(),
      },
    ],
  };
  await writeManifest(provider, manifest);
  return manifest;
}

/**
 * يُحضر هوية إصدار من مادته في المخزن.
 * @param provider - المخزن
 * @param keyName - اسم المفتاح في المخزن
 * @param options - قيود الربط
 * @returns هوية الملك لذلك الإصدار
 */
async function loadVersionIdentity(
  provider: KeyProvider,
  keyName: string,
  options: KingKeyOptions = {},
): Promise<KingIdentity> {
  assertKingKeyProviderFit(provider, options);
  if (!(await provider.has(keyName))) throw new KingKeyError('KING_KEY_NOT_PROVISIONED');
  return kingIdentityFromMaterial(await provider.get(keyName));
}

/**
 * هوية الملك في فترة التعايش: **توقّع بالفعّال وحده**، وتتحقق بكل إصدار مقبول.
 *
 * ولماذا وراثة لا واجهة جديدة: `CrownGateway` وسلطة التصديق تستهلكان
 * `KingIdentity`. لو صيغ التعايش نوعاً جديداً لتغيّر كل مستدعٍ، فصار التدوير
 * تعديلاً واسعاً يُخشى منه. والوراثة تجعل التعايش قابلاً للتمرير في موضع
 * الملك بلا تعديل سطر عند المستهلكين — وهو ما يجعل التدوير عملية تشغيل لا
 * مشروع تطوير.
 */
export class CoexistingKingIdentity extends KingIdentity {
  /** الإصدار الذي يوقّع. */
  readonly activeVersion: number;

  /** الإصدارات المقبولة للتحقق مرتبةً: الفعّال أولاً ثم المتعايشة. */
  readonly verifiers: readonly { version: number; identity: KingIdentity }[];

  /**
   * @param active - الإصدار الفعّال وهويته
   * @param coexisting - إصدارات متعايشة مقبولة للتحقق فقط
   */
  constructor(
    active: { version: number; identity: KingIdentity },
    coexisting: readonly { version: number; identity: KingIdentity }[] = [],
  ) {
    super({ privateKey: active.identity.privateKey, publicKey: active.identity.publicKey });
    this.activeVersion = active.version;
    this.verifiers = [active, ...coexisting];
  }

  /** الإصدارات المقبولة للتحقق بأرقامها. */
  get acceptedVersions(): number[] {
    return this.verifiers.map((entry) => entry.version);
  }

  /**
   * يتحقق بأي إصدار مقبول، فيبقى توقيعٌ صدر قبل التدوير مقبولاً خلال التعايش.
   * @param payload - المادة الموقعة
   * @param signature - التوقيع بترميز base64url
   * @returns صحة التوقيع عند أي إصدار مقبول
   */
  override verify(payload: object, signature: string): boolean {
    return this.verifyingVersion(payload, signature) !== null;
  }

  /**
   * يكشف **أي** إصدار قَبِل التوقيع، وهو ما يحتاجه التدقيق وإعادة التوقيع:
   * توقيعٌ قَبِله إصدار متعايش يعني شهادة تحتاج إعادة إصدار قبل الإبطال.
   * @param payload - المادة الموقعة
   * @param signature - التوقيع بترميز base64url
   * @returns رقم الإصدار أو `null` إن لم يقبله أحد
   */
  verifyingVersion(payload: object, signature: string): number | null {
    for (const entry of this.verifiers) {
      if (entry.identity.verify(payload, signature)) return entry.version;
    }
    return null;
  }
}

/**
 * يُحضر مجموعة مفاتيح الملك: الفعّال للتوقيع، والمتعايش غير المنتهي للتحقق.
 * المُبطَل لا يُحضَر أبداً ولو بقيت مادته، والمنتهي تعايشُه لا يُحضَر ولو بقيت
 * مادته أيضاً — فالقبول قرار البيان لا وجود الملف.
 * @param provider - المخزن
 * @param options - قيود الربط والساعة
 * @returns هوية ملك تتحقق بكل إصدار مقبول وتوقّع بالفعّال
 */
export async function loadKingKeySet(
  provider: KeyProvider,
  options: RotationOptions = {},
): Promise<CoexistingKingIdentity> {
  const manifest = await readKingKeyManifest(provider);
  const now = options.now ?? new Date();
  if (!manifest) {
    // مخزنٌ لم يُدوَّر بعد: الإصدار الأول هو مفتاح M2.03 نفسه. ولا يُكتب بيان
    // هنا لأن الإحضار قراءة.
    const identity = await loadVersionIdentity(provider, KING_KEY_NAME, options);
    return new CoexistingKingIdentity({ version: 1, identity });
  }
  const activeRecord = manifest.versions.find(
    (version) => version.version === manifest.activeVersion,
  );
  if (!activeRecord) throw new KingKeyRotationError('MANIFEST_INVALID');
  if (activeRecord.status === 'revoked') throw new KingKeyRotationError('ACTIVE_VERSION_REVOKED');

  const active = {
    version: activeRecord.version,
    identity: await loadVersionIdentity(provider, activeRecord.keyName, options),
  };
  const coexisting: { version: number; identity: KingIdentity }[] = [];
  for (const record of manifest.versions) {
    if (record.version === activeRecord.version) continue;
    if (record.status !== 'retiring') continue;
    if (record.coexistUntil !== undefined && Date.parse(record.coexistUntil) <= now.getTime()) {
      continue;
    }
    if (!(await provider.has(record.keyName))) continue;
    coexisting.push({
      version: record.version,
      identity: await loadVersionIdentity(provider, record.keyName, options),
    });
  }
  coexisting.sort((left, right) => right.version - left.version);
  return new CoexistingKingIdentity(active, coexisting);
}

/**
 * يدوّر مفتاح الملك: إصدار جديد يوقّع، والسابق يتعايش مدةً معلَنة.
 *
 * ترتيب الكتابة مقصود: تُكتب المادة الجديدة أولاً ثم البيان. فإن انقطع
 * التنفيذ بينهما بقيت مادةٌ يتيمة لا يقبلها أحد — وهذا اتجاه الفشل الآمن.
 * والعكس (بيان يشير إلى مادة غير موجودة) كان سيُوقف التوقيع كلياً.
 * @param provider - المخزن
 * @param options - مدة التعايش والقيود والساعة
 * @returns حصيلة التدوير والبيان الجديد
 */
export async function rotateKingKey(
  provider: KeyProvider,
  options: RotateOptions = {},
): Promise<RotationResult> {
  assertKingKeyProviderFit(provider, options);
  const coexistenceMs = options.coexistenceMs ?? DEFAULT_COEXISTENCE_MS;
  if (!Number.isFinite(coexistenceMs) || coexistenceMs < 0) {
    throw new KingKeyRotationError('COEXISTENCE_WINDOW_INVALID');
  }
  const manifest = await ensureKingKeyManifest(provider, options);
  const now = options.now ?? new Date();
  const nextVersion = Math.max(...manifest.versions.map((version) => version.version)) + 1;
  const keyName = kingKeyNameForVersion(nextVersion);

  const keys = generateKeyPairSync('ed25519');
  const material = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  await provider.put(keyName, material);
  const king = new KingIdentity({ privateKey: keys.privateKey, publicKey: keys.publicKey });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const coexistUntil = new Date(now.getTime() + coexistenceMs).toISOString();

  const versions = manifest.versions.map((version) =>
    version.version === manifest.activeVersion && version.status === 'active'
      ? {
          ...version,
          status: 'retiring' as KingKeyVersionStatus,
          retiredAt: now.toISOString(),
          coexistUntil,
        }
      : version,
  );
  versions.push({
    version: nextVersion,
    keyName,
    kingId: king.id,
    publicKeyPem,
    status: 'active',
    createdAt: now.toISOString(),
  });
  const updated: KingKeyManifest = {
    baseKeyName: manifest.baseKeyName,
    activeVersion: nextVersion,
    versions,
  };
  await writeManifest(provider, updated);

  return {
    version: nextVersion,
    previousVersion: manifest.activeVersion,
    kingId: king.id,
    publicKeyPem,
    coexistUntil,
    manifest: updated,
  };
}

/**
 * يُبطل إصداراً: يمحو مادته من المخزن ويسجّل السبب، فيصير كل توقيع به مرفوضاً.
 *
 * ولا يُبطَل الإصدار الفعّال: إبطاله يُخلي الدولة من موقِّع، فتصير كل عملية
 * لاحقة مستحيلة بنداء واحد. من أراد إبطال الفعّال يدوّر أولاً ثم يُبطل.
 * @param provider - المخزن
 * @param version - رقم الإصدار المُبطَل
 * @param reason - سبب الإبطال المسجَّل
 * @param options - الساعة
 * @returns سجل الإصدار بعد الإبطال
 */
export async function revokeKingKeyVersion(
  provider: KeyProvider,
  version: number,
  reason: string,
  options: RotationOptions = {},
): Promise<KingKeyVersion> {
  assertKingKeyProviderFit(provider, options);
  const manifest = await ensureKingKeyManifest(provider, options);
  const record = manifest.versions.find((entry) => entry.version === version);
  if (!record) throw new KingKeyRotationError('VERSION_NOT_FOUND');
  if (version === manifest.activeVersion) {
    throw new KingKeyRotationError('CANNOT_REVOKE_ACTIVE_VERSION');
  }
  if (record.status === 'revoked') throw new KingKeyRotationError('VERSION_ALREADY_REVOKED');

  const now = options.now ?? new Date();
  // المحو أولاً ثم البيان: لو انقطع التنفيذ بينهما بقي إصدار بلا مادة، وهو
  // مرفوض فعلياً عند الإحضار. والعكس كان سيُعلن الإبطال ويُبقي المادة.
  if (await provider.has(record.keyName)) await provider.destroy(record.keyName);
  const revoked: KingKeyVersion = {
    ...record,
    status: 'revoked',
    revokedAt: now.toISOString(),
    revocationReason: reason,
  };
  await writeManifest(provider, {
    baseKeyName: manifest.baseKeyName,
    activeVersion: manifest.activeVersion,
    versions: manifest.versions.map((entry) => (entry.version === version ? revoked : entry)),
  });
  return revoked;
}

/**
 * يعيد إصدار شهادة عن الملك الحالي بنفس معرّفها وموضوعها ودورها وقدراتها.
 *
 * والمعرّف يبقى قصداً: قوائم السحب القائمة مبنيّة على المعرّفات، فتغييره كان
 * سيُعيد الحياة إلى شهادة مسحوبة. ووقت الإصدار الأصلي يبقى أيضاً لأن الشهادة
 * هي هي، والذي تغيّر مُصدِّرها لا تاريخ منحها.
 * @param certificate - الشهادة القديمة
 * @param king - الملك الذي سيوقّع من جديد
 * @returns شهادة موقّعة عن الملك الحالي
 */
export function reissueCertificate(certificate: Certificate, king: KingIdentity): Certificate {
  const body: CertificateBody = {
    id: certificate.id,
    subject: certificate.subject,
    issuer: king.id,
    role: certificate.role,
    capabilities: [...certificate.capabilities],
    issuedAt: certificate.issuedAt,
    // انتهاءُ الصلاحيّةِ يُحفَظُ كما هو: الشهادةُ هي هي، تغيَّرَ مُصدِّرُها لا
    // أجلُها. فإعادةُ التوقيعِ بعدَ تدويرِ مفتاحِ الملكِ لا تُمدِّدُ صلاحيّةَ
    // شهادةٍ منتهيةٍ ولا تُعيدُها (`Grok-F03`).
    notAfter: certificate.notAfter,
  };
  return { ...body, signature: king.sign(body) };
}

/**
 * يعيد توقيع مجموعة شهادات عن الملك الحالي.
 * @param certificates - الشهادات القائمة
 * @param king - الملك الذي سيوقّع من جديد
 * @returns الشهادات بعد إعادة الإصدار بنفس ترتيبها
 */
export function reissueCertificates(
  certificates: readonly Certificate[],
  king: KingIdentity,
): Certificate[] {
  return certificates.map((certificate) => reissueCertificate(certificate, king));
}

/**
 * يصف حالة التدوير للتدقيق: الإصدارات وحالاتها ومَن يوقّع ومَن ما زال مقبولاً.
 * لا يلمس مادة خاصة ولا يُخرج شيئاً منها.
 * @param provider - المخزن المفحوص
 * @param options - الساعة
 * @returns وصفاً صالحاً للعرض والتسجيل
 */
export async function describeKingKeyRotation(
  provider: KeyProvider,
  options: RotationOptions = {},
): Promise<{
  initialized: boolean;
  activeVersion: number | null;
  versions: (KingKeyVersion & { materialPresent: boolean; acceptedNow: boolean })[];
}> {
  const manifest = await readKingKeyManifest(provider);
  const now = options.now ?? new Date();
  if (!manifest) {
    const present = await provider.has(KING_KEY_NAME);
    return { initialized: false, activeVersion: present ? 1 : null, versions: [] };
  }
  const versions = [];
  for (const record of manifest.versions) {
    const materialPresent = await provider.has(record.keyName);
    const coexistValid =
      record.status === 'retiring' &&
      (record.coexistUntil === undefined || Date.parse(record.coexistUntil) > now.getTime());
    versions.push({
      ...record,
      materialPresent,
      acceptedNow:
        materialPresent && (record.version === manifest.activeVersion ? true : coexistValid),
    });
  }
  return { initialized: true, activeVersion: manifest.activeVersion, versions };
}
