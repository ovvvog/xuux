// مصنعُ التركيبِ الإنتاجيِّ لجذرِ الثقة (`WL-092`).
//
// المشكلةُ التي يحلُّها: كانت مساراتُ HSM (F05/F06/F07) موجودةً ومختبَرةً، لكن
// لا مستهلكَ إنتاجيَّ يربطُها؛ فالسجلُّ يُكتبُ نصاً ظاهراً، وقراراتُ الدفترِ بلا
// توقيعٍ، والتثبيتُ برمجيٌّ. هذه الوحدةُ هي **البابُ الوحيدُ** الذي تُبنى منه
// عقدةُ إنتاجٍ، وثلاثُ قواعدَ تحكمُها:
//
//   1. فشلٌ مغلقٌ قبلَ أيِّ فتحِ ملفٍ: غيابُ توكنٍ أو PIN أو وضعُ `software`
//      يرفعُ خطأً من `assertHsmRequiredInProduction` قبلَ أن يُمسَّ القرص.
//   2. لا سقوطَ إلى مخزنٍ برمجيٍّ ولا إلى `KingIdentity`: `bindHsmRootOfTrust`
//      يرفضُ بيئةً فيها متغيّراتُ مخزنٍ برمجيٍّ، ويرفضُ مصدراً يُصدِّرُ مفاتيحَه.
//   3. مصدرُ المفاتيحِ قابلٌ للحقنِ (`deps.openSource`) كي تُختبرَ **الأصنافُ
//      الإنتاجيةُ نفسُها** بتوكنٍ مزيَّفٍ يستعملُ تعمِيةً حقيقيّة؛ والافتراضُ
//      يبقى `Pkcs11HsmProvider.fromEnv` — أي توكنٌ حقيقيّ.
//
// حدٌّ يُصرَّحُ به ولا يُخفى: التوقيعُ الملكيُّ البرمجيُّ (`KingIdentity`) يبقى
// ممنوعاً في الإنتاج، فمفتاحُ F06 هنا يخدمُ التثبيتَ وتوجيهاتِ الإيقافِ فقط.

import { join } from 'node:path';
import { DEFAULT_ANCHOR_INTERVAL_MS } from './anchor.mjs';
import type { AnchorRecord, AnchorStore, AnchorableLog } from './anchor.mjs';
import { CommandLedger } from './command-ledger.mjs';
import type { LedgerWitness } from './command-ledger.mjs';
import type { LedgerDecisionSigner } from './command-ledger.mjs';
import { HaltSwitch } from './halt-switch.mjs';
import type { HaltAsyncSigner, HaltEpochFloor } from './halt-switch.mjs';
import {
  anchorLogWithHsm,
  bindHsmRootOfTrust,
  openEventData,
  sealEventData,
} from './hsm-binding.mjs';
import type { HsmSigner } from './hsm-binding.mjs';
import type { HsmKeySource, SealedPayload } from './hsm-binding.mjs';
import { PersistentEventLog } from './persistent-log.mjs';
import type { EventDataSealer } from './persistent-log.mjs';
import { Pkcs11HsmProvider } from './pkcs11-provider.mjs';
import {
  assertHsmRequiredInProduction,
  assertProductionKeyProviderAllowed,
  describeRootOfTrustBoot,
  isProductionRuntime,
} from './production-boot.mjs';
import { FileAnchorStore, verifyAnchoredLog } from './anchor.mjs';
import type { MonotonicFloor } from './state-manifest.mjs';
import {
  StateManifest,
  stateManifestBinding,
  stateManifestPath,
  stateProvisionDeclared,
} from './state-manifest.mjs';
import { FileRevocationStore } from './identity.mjs';
import type { RevocationStore } from './identity.mjs';

/** أخطاءُ المصنعِ الإنتاجيّ، مثبَّتةٌ نصاً كي تُختبرَ ولا تُخمَّن. */
export const ProductionRuntimeErrorCodes = [
  'PRODUCTION_RUNTIME_REQUIRES_HSM',
  'PRODUCTION_RUNTIME_ROOT_MISSING',
  // `UF-01`: جذرُ حالةٍ إنتاجيٌّ بلا بيانٍ لا يُقرأُ «جديداً» بل يُرفَض.
  'PRODUCTION_STATE_ROOT_UNPROVISIONED',
  // `UF-01`: البيانُ يشهدُ بتثبيتٍ ومخزنُ التثبيتاتِ خالٍ أو السجلُ أقصر.
  'PRODUCTION_LOG_BEHIND_ANCHOR',
  // `UF-01`: سلسلةُ التثبيتاتِ أو سلسلةُ الوقائعِ لا تتحقّق عندَ الإقلاع.
  'PRODUCTION_ANCHOR_CHAIN_INVALID',
  // `R4-B-03`/`M11.04-F05` (‏`WL-165`): توقيعُ مرساةٍ بلا مصرفٍ يرفعُ شاهدَ
  // البيانِ يُرفَضُ **قبلَ** التوقيعِ: مرساةٌ موقَّعةٌ لا أثرَ لها في الخاتَمِ
  // هي بعينِها النتيجةُ المفتوحةُ، فلا تُنتَجُ بسهوِ مُستدعٍ.
  'ANCHOR_WITNESS_SINK_MISSING',
  // `M11.04-F07` (الشطرُ الثاني): واقعةُ إيقافٍ مختومةٌ في السجلِّ لا يُفَكُّ
  // ختمُها عندَ الإقلاعِ — إفسادُ الجسمِ لا يُسقِطُ الشاهدَ بل يردُّ الإقلاعَ.
  'PRODUCTION_HALT_WITNESS_UNREADABLE',
  // `R5-A-01`: واقعةُ التزامٍ مختومةٌ في السجلِّ لا يُفَكُّ ختمُها عندَ الإقلاعِ —
  // إفسادُ الجسمِ لا يُسقِطُ الشاهدَ بل يردُّ الإقلاعَ.
  'PRODUCTION_LEDGER_WITNESS_UNREADABLE',
] as const;

export type ProductionRuntimeErrorCode = (typeof ProductionRuntimeErrorCodes)[number];

/** خطأُ المصنع: رسالتُه رمزُه. */
export class ProductionRuntimeError extends Error {
  code: ProductionRuntimeErrorCode;
  detail?: string;

  /**
   * @param code - رمزُ الخطأ
   * @param detail - تفصيلٌ يُقرأُ برمجياً، بلا قيمةِ سرٍّ فيه
   */
  constructor(code: ProductionRuntimeErrorCode, detail?: string) {
    super(code);
    this.name = 'ProductionRuntimeError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** مصدرُ مفاتيحٍ مفتوحٌ مع طريقةِ إغلاقِه — جلسةُ التوكنِ تُغلقُ حيث فُتحت. */
export interface OpenedKeySource {
  source: HsmKeySource;
  close(): Promise<void>;
}

/** بدائلُ الحقنِ للاختبار. الافتراضُ في الإنتاجِ توكنٌ حقيقيٌّ عبر PKCS#11. */
export interface ProductionRuntimeDeps {
  /**
   * يفتحُ مصدرَ المفاتيح.
   * @param env - البيئةُ المفحوصة
   * @returns المصدرُ وطريقةُ إغلاقِه
   */
  openSource?(env: NodeJS.ProcessEnv): Promise<OpenedKeySource>;
}

/** خياراتُ بناءِ التركيبِ الإنتاجيّ. */
export interface ProductionRuntimeOptions {
  /** جذرُ حالةِ العقدة: منه تُشتقُّ مساراتُ السجلِّ والدفترِ والإيقاف. */
  root: string;
  /** إصدارُ مفتاحِ F06 المطلوب، إن أُريد إصدارٌ بعينه. */
  kingKeyVersion?: number;
  /** إصدارُ مفتاحِ F07 المطلوب، إن أُريد إصدارٌ بعينه. */
  ledgerKeyVersion?: number;
  /** مزامنةُ القرصِ. لا تُعطَّلُ في الإنتاج، وتُعطَّلُ في الاختبارِ للسرعة. */
  fsync?: boolean;
  /**
   * مخزنُ التثبيتاتِ المقروءُ عندَ الإقلاعِ (‏`UF-01`). الافتراضُ
   * `XUUX_ANCHOR_STORE` ثمَّ `anchors.jsonl` داخلَ الجذر. وحقنُه للاختبارِ لا
   * لتخفيفِ الشرطِ: الفحصُ يقعُ عليه أيّاً كان.
   */
  anchorStore?: AnchorStore;
  /**
   * مخزنُ سحبِ الشهاداتِ الدائم (‏`R4-K3-03`). الافتراضُ `revoked.jsonl` داخلَ
   * الجذر. يُبنى من `FileRevocationStore` فيُستعملُ عندَ بناءِ سلطةِ التصديقِ في
   * الإنتاج. وحقنُه للاختبارِ لا لتخفيفِ الشرطِ.
   */
  revocationStore?: RevocationStore;
}

/** التركيبُ الإنتاجيُّ كما يُسلَّمُ للمستهلك. */
export interface ProductionRootOfTrust {
  /** سجلُّ وقائعَ مختومٌ: كلُّ بيانِ واقعةٍ مشفَّرٌ بمفتاحِ F05 داخلَ التوكن. */
  log: PersistentEventLog;
  /** دفترُ أوامرَ لا يقبلُ قراراً غيرَ موقَّعٍ بمفتاحِ F07. */
  ledger: CommandLedger;
  /** مفتاحُ الإيقافِ الشاملِ، توجيهاتُه تُوقَّعُ بمفتاحِ F06 داخلَ التوكن. */
  haltSwitch: HaltSwitch;
  /** ختّامُ بياناتِ الوقائع (F05). */
  sealer: EventDataSealer;
  /** موقّعُ التثبيتِ وتوجيهاتِ الإيقاف (F06). */
  anchorSigner: HsmSigner;
  /** موقّعُ قراراتِ الدفتر (F07). */
  ledgerSigner: HsmSigner & LedgerDecisionSigner;
  /** خلاصةُ الإقلاعِ للتدقيقِ — بلا أيِّ سرٍّ فيها. */
  boot: ReturnType<typeof describeRootOfTrustBoot>;
  /** بيانُ جذرِ الحالةِ المختومُ — مرجعُ الشواهدِ الرتيبةِ للمثبَّتِ والعهدِ والقرار. */
  manifest: StateManifest;
  /** يرفعُ شاهدَ المرساةِ في البيانِ عندَ إنجازِها — لا يؤجَّلُ إلى الإقلاعِ القادمِ (‏`UF-01`). */
  raiseAnchorWitness(count: number): void;
  /**
   * مخزنُ سحبِ الشهاداتِ الدائم (‏`R4-K3-03`). يُمرَّرُ إلى سلطةِ التصديقِ في
   * الإنتاجِ كي يدومَ السحبُ عبرَ إعادةِ التشغيل.
   */
  revocationStore: RevocationStore;
  /** يُغلقُ جلسةَ التوكن. */
  close(): Promise<void>;
}

/**
 * يبني ختّاماً لبياناتِ الوقائعِ من مقبضِ AEAD. التعميةُ وفكُّها يقعان داخلَ
 * التوكنِ عبر `sealEventData`/`openEventData` — لا نسخَ لمنطقِ التعميةِ هنا.
 * @param handle - مقبضُ مفتاحِ F05
 * @returns ختّامٌ بالعقدِ الذي يعرفُه السجل
 */
export function sealerFromAeadHandle(handle: {
  readonly keyId: string;
  encrypt(plaintext: Buffer): Promise<{ ciphertext: Buffer; iv: Buffer; tag: Buffer }>;
  decrypt(ciphertext: Buffer, iv: Buffer, tag: Buffer): Promise<Buffer>;
}): EventDataSealer {
  return {
    keyId: handle.keyId,
    seal: async (data: unknown): Promise<SealedPayload> => sealEventData(handle, data),
    open: async (sealed: unknown): Promise<unknown> =>
      openEventData(handle, sealed as SealedPayload),
  };
}

/**
 * يبني جذرَ الثقةِ الإنتاجيَّ: يفحصُ البيئةَ فشلاً مغلقاً، ثم يفتحُ التوكنَ، ثم
 * يربطُ المفاتيحَ الثلاثةَ بمساراتِها الحقيقيّة، ثم يبني السجلَّ والدفترَ ومفتاحَ
 * الإيقافِ **مربوطةً** بها. أيُّ نقصٍ في التوكنِ أو الـPIN أو الوضعِ يرفعُ خطأً
 * قبلَ أن يُفتحَ ملفٌ واحد.
 * @param env - بيئةُ التشغيل
 * @param options - جذرُ الحالةِ وإصداراتُ المفاتيح
 * @param deps - بدائلُ الحقنِ للاختبار
 * @returns التركيبُ الإنتاجيُّ الجاهز
 */
export interface ProductionSigners {
  /** ختّامُ بياناتِ الوقائع (F05). */
  sealer: EventDataSealer;
  /** موقّعُ التثبيتِ وتوجيهاتِ الإيقاف (F06). */
  anchorSigner: HsmSigner;
  /** موقّعُ قراراتِ الدفتر (F07). */
  ledgerSigner: HsmSigner & LedgerDecisionSigner;
  /** خلاصةُ الإقلاعِ للتدقيق. */
  boot: ReturnType<typeof describeRootOfTrustBoot>;
  /** يُغلقُ جلسةَ التوكن. */
  close(): Promise<void>;
}

/**
 * يفتحُ مفاتيحَ جذرِ الثقةِ الثلاثةَ وحدَها، بلا بناءِ سجلٍّ ولا دفترٍ ولا حالةٍ
 * على القرص. هذا بابُ **أدواتِ التشغيل**: أداةُ التثبيتِ وأداةُ الإيقافِ تحتاجان
 * موقّعاً لا عقدةً كاملة، وفتحُ ملفاتِ حالةٍ لأداةِ قراءةٍ عبثٌ وخطرُ تعارض.
 * @param env - بيئةُ التشغيل
 * @param deps - بدائلُ الحقنِ للاختبار
 * @param versions - إصداراتُ مفاتيحَ بعينِها إن أُريدت
 * @returns المفاتيحُ الثلاثةُ وطريقةُ الإغلاق
 */
export async function openProductionSigners(
  env: NodeJS.ProcessEnv,
  deps: ProductionRuntimeDeps = {},
  versions: { kingKeyVersion?: number; ledgerKeyVersion?: number } = {},
): Promise<ProductionSigners> {
  // الترتيبُ مقصود: فحصُ البيئةِ أولاً — فلا تُحمَّلُ وحدةُ PKCS#11 ولا يُفتحُ
  // ملفٌ في بيئةٍ مرفوضةٍ أصلاً.
  assertHsmRequiredInProduction(env);
  const boot = describeRootOfTrustBoot(env);
  const opened = await (deps.openSource ?? defaultOpenSource)(env);
  try {
    const bindOptions: {
      env: NodeJS.ProcessEnv;
      kingKeyVersion?: number;
      ledgerKeyVersion?: number;
    } = { env };
    if (versions.kingKeyVersion !== undefined) bindOptions.kingKeyVersion = versions.kingKeyVersion;
    if (versions.ledgerKeyVersion !== undefined) {
      bindOptions.ledgerKeyVersion = versions.ledgerKeyVersion;
    }
    // `UF-02`: الحراسةُ تُستدعى من **المصنعِ** لا من الربطِ وحدَه: كانت
    // الحراسةُ موجودةً ومختبَرةً ولا مستدعٍي لها من أيِّ مسارِ إنتاج، فكان
    // موفّرٌ غيرُ `pkcs11-hsm` يمرُّ متى ادّعى `canExport:false`.
    const described = opened.source.describe();
    assertProductionKeyProviderAllowed(
      {
        kind: described.kind ?? 'unknown',
        canExport: described.canExport,
        ...(described.productionReady === undefined
          ? {}
          : { productionReady: described.productionReady }),
      },
      env,
    );
    const binding = await bindHsmRootOfTrust(opened.source, bindOptions);
    return {
      sealer: sealerFromAeadHandle(binding.eventLogAead),
      anchorSigner: binding.kingSigner,
      ledgerSigner: binding.ledgerSigner,
      boot,
      close: opened.close,
    };
  } catch (error) {
    // فشلٌ بعدَ فتحِ الجلسةِ يُغلقُها: توكنٌ يبقى مسجَّلَ الدخولِ بعدَ فشلِ
    // الإقلاعِ خطرٌ لا مجردُ تسريبِ موردٍ.
    await opened.close().catch(() => undefined);
    throw error;
  }
}

/**
 * يثبّتُ سجلاً بمفتاحِ التوكنِ **بشرطِ الدوريّة** — نظيرُ `LogAnchorer.maybeAnchor`
 * في المسارِ العتاديّ. القرارُ هنا والتوقيعُ في `anchorLogWithHsm`، فلا يُنسَخُ
 * منطقُ التوقيعِ ولا منطقُ السلسلة.
 *
 * `R5-B-02`: لا يُستقبَلُ callbackٌ عامٌّ بعدَ اليوم. يُستقبَلُ شاهدٌ موثوقٌ
 * (`MonotonicFloor`) ويُرفَعُ مباشرةً بعدَ التوقيعِ، ثمّ يُتحقَّقُ من ارتفاعِهِ —
 * فلا يمرُّ مرساةٌ موقَّعةٌ بلا شاهدٍ مهما كانَ المستدعي. والتحقّقُ **بعدَ** الرفعِ لا
 * قبله: الرفعُ نفسُهُ قد يُخفِقُ أو يتجاهلَ القيمة، فالقراءةُ بعدَهُ هي الدليلُ.
 * @param store - مخزنُ التثبيتات
 * @param signer - موقّعُ F06
 * @param log - السجلُّ المقروء
 * @param options - الفترةُ وأقلُّ جديدٍ والإجبارُ واللحظةُ والشاهدُ الموثوق
 * @returns التثبيتُ إن وقع، أو `null` إن لم يستحقّ
 */
export async function maybeAnchorLogWithHsm(
  store: AnchorStore,
  signer: HsmSigner,
  log: AnchorableLog,
  options: {
    intervalMs?: number;
    minNewEvents?: number;
    force?: boolean;
    at?: Date;
    witness?: MonotonicFloor;
  } = {},
): Promise<AnchorRecord | null> {
  // R5-B-02: لا مرساةً موقَّعةً بلا شاهدٍ موثوقٍ. الشاهدُ (`MonotonicFloor`) يُرفَعُ
  // ويُتحقَّقُ منه مباشرةً بعدَ التوقيعِ. لا callbackٌ عامٌّ بعدَ اليوم.
  const witness = options.witness ?? null;
  if (witness === null) {
    throw new ProductionRuntimeError('ANCHOR_WITNESS_SINK_MISSING', 'options.witness');
  }
  const at = options.at ?? new Date();
  const intervalMs = options.intervalMs ?? DEFAULT_ANCHOR_INTERVAL_MS;
  const minNewEvents = options.minNewEvents ?? 1;
  const anchors = store.read();
  const previous = anchors.length === 0 ? null : (anchors[anchors.length - 1] ?? null);
  if (!options.force) {
    if (previous === null) {
      if (log.events.length < minNewEvents) return null;
    } else {
      if (log.events.length - previous.count < minNewEvents) return null;
      if (at.getTime() - Date.parse(previous.at) < intervalMs) return null;
    }
  }
  const record = await anchorLogWithHsm(store, signer, log, at);
  // R5-B-02: الشاهدُ الموثوقُ يُرفَعُ مباشرةً. والتحقّقُ بعدَ الرفعِ:
  // قراءةُ الشاهدِ أقلُّ من عدَّ المرساةِ تعني أنَّ الرفعَ لم يقعَ، فالمرساةُ الموقَّفةُ
  // تبقى بلا شاهدٍ — وهو عينُ ما نقضَه `R4-B-03`.
  witness.raise(record.count);
  if (witness.read() < record.count) {
    throw new ProductionRuntimeError(
      'ANCHOR_WITNESS_SINK_MISSING',
      'witness.read() < record.count',
    );
  }
  return record;
}

/**
 * يبني جذرَ الثقةِ الإنتاجيَّ كاملاً: مفاتيحَ ثم سجلاً ودفتراً ومفتاحَ إيقافٍ
 * مربوطةً بها. أيُّ نقصٍ في التوكنِ أو الـPIN أو الوضعِ يرفعُ خطأً قبلَ أن
 * يُفتحَ ملفٌ واحد.
 * @param env - بيئةُ التشغيل
 * @param options - جذرُ الحالةِ وإصداراتُ المفاتيح
 * @param deps - بدائلُ الحقنِ للاختبار
 * @returns التركيبُ الإنتاجيُّ الجاهز
 */
export async function createProductionRootOfTrust(
  env: NodeJS.ProcessEnv,
  options: ProductionRuntimeOptions,
  deps: ProductionRuntimeDeps = {},
): Promise<ProductionRootOfTrust> {
  if (typeof options.root !== 'string' || options.root.length === 0) {
    throw new ProductionRuntimeError('PRODUCTION_RUNTIME_ROOT_MISSING', 'options.root');
  }
  const versions: { kingKeyVersion?: number; ledgerKeyVersion?: number } = {};
  if (options.kingKeyVersion !== undefined) versions.kingKeyVersion = options.kingKeyVersion;
  if (options.ledgerKeyVersion !== undefined) versions.ledgerKeyVersion = options.ledgerKeyVersion;
  const signers = await openProductionSigners(env, deps, versions);
  // مواردُ تُفتَحُ داخلَ الإقلاعِ وتُغلَقُ إن سقطَ بعدَ فتحِها: السجلُّ الدائمُ
  // يأخذُ **قفلَ كاتبٍ واحدٍ** على القرصِ، فإقلاعٌ يفشلُ بعدَ فتحِه كان يتركُ
  // القفلَ قائماً والمِقبضَ مفتوحاً، فيُردُّ كلُّ إقلاعٍ تالٍ في العمليةِ نفسِها
  // بـ`LOG_ALREADY_LOCKED` — تعطيلٌ ذاتيٌّ لجذرِ الثقةِ لا يُرفَعُ إلا بحذفٍ يدويٍّ.
  const openedOnBoot: Array<() => void> = [];
  try {
    const sealer = signers.sealer;
    const fsync = options.fsync ?? true;
    // بيانُ جذرِ الحالةِ **المختومُ داخلَ التوكن** (‏`UF-01`، ‏`UF-03`، ‏`UF-07`،
    // ‏`R3-A-01`): مرساةٌ محليّةٌ واحدةٌ تحملُ ما لا يجوزُ أن يرجعَ — عدَّ المُثبَّتِ
    // وعهدَ الإيقافِ وعدَّ المُقرَّرِ — ومتنُها موقَّعٌ Ed25519 بمفتاحِ F06 **داخلَ
    // HSM** ومربوطٌ بالهويةِ والسياقِ والتوكنِ وبصمةِ الموديولِ والإصدار.
    // نقضَت الجولةُ الثالثةُ النسخةَ الأولى: كانت JSON بلا خاتَمٍ، فمن ملكَ القرصَ
    // خفَضَ أعدادَها وحذفَ الملفّاتِ التابعةَ معاً فعادَ إلى GENESIS و`running`
    // وقَبِلَ أمراً مكرَّراً. الخاتَمُ يسدُّ التزييفَ والتخفيضَ، **ولا يُدَّعى** أنّه
    // يسدُّ إعادةَ لقطةٍ كاملةٍ متّسقةٍ: ذاك قرارٌ معماريٌّ مُعلَنٌ في
    // `docs/adr/0006-state-manifest-seal-and-anti-rollback-limit.md`.
    const manifest = new StateManifest(stateManifestPath(options.root), {
      fsync,
      sealer: signers.anchorSigner,
      // R4-K3-02: البيئةُ تُمرَّرُ صريحةً لا تُستنبَطُ من العمليةِ — فمصادقةُ دفترِ
      // الرفعِ إلزامٌ في الإنتاجِ، ولا يُسقَطُ الدفترُ إلى تجزئةٍ عاريّةٍ يحسبُها
      // مالكُ القرصِ.
      env,
    });
    const production = isProductionRuntime(env);
    // تهيئةٌ أولى مُعلَنةٌ أم إقلاعٌ على جذرٍ قائم؟ الفرقُ هو كلُّ الفرقِ في
    // `UF-13`: مجلَّدٌ مفقودٌ عندَ التهيئةِ الأولى يُنشَأُ، ومجلَّدٌ مفقودٌ بعدَها
    // محوٌ يُرَدُّ. ولا يُخمَّنُ الفرقُ: بيانُ الجذرِ يقولُه.
    const provisioning = !manifest.exists();
    if (production && !manifest.exists() && !stateProvisionDeclared(env)) {
      // جذرٌ ممسوحٌ لا يُقرأُ «نشأةً جديدةً»: تلك كانت ثغرةَ `UF-01` بعينِها.
      throw new ProductionRuntimeError(
        'PRODUCTION_STATE_ROOT_UNPROVISIONED',
        stateManifestPath(options.root),
      );
    }
    // التحقّقُ **قبلَ** الوثوقِ بأيِّ حقلٍ: خاتَمٌ ثمَّ رِباطٌ ثمَّ دفترُ الرفعِ،
    // ثمَّ نقطةُ ضبطٍ مختومةٌ تطوي ما رُفِعَ متزامناً منذ الإقلاعِ السابق.
    await manifest.provisionAsync(stateManifestBinding(signers.anchorSigner.id, env), env);
    manifest.assertKing(signers.anchorSigner.id);
    // R4-B-01: استخرجْ مفتاحَ مصادقةِ دفترِ الرفعِ من التوكنِ بعدَ التحقّقِ من
    // الخاتَمِ، قبلَ أيِّ رفعٍ متزامنٍ. بدونِ هذا، تبقى سطورُ الدفترِ بلا مصادقةٍ،
    // فيستطيعُ مالكُ القرصِ أن يَدُسَّ سطراً غيرَ مُصادَقٍ عليه ثم يُختَمَ في المتنِ.
    await manifest.initJournalKey();
    // السجلُّ يُفتَحُ **بعدَ** التحقّقِ من الخاتَمِ: رفضُ الإقلاعِ لا يُنشئُ ملفَّ
    // وقائعَ جديداً، فلا يُقرأُ ملفٌّ فارغٌ خلَّفَه رفضٌ «سجلاً من GENESIS».
    const log = new PersistentEventLog(join(options.root, 'events.log'), {
      sealer,
      env,
      fsync,
    });
    openedOnBoot.push((): void => log.close());
    assertLogNotBehindAnchors(manifest, log, signers.anchorSigner, options, fsync, env);
    // نقطةُ ضبطٍ ثانيةٌ بعدَ فحصِ المراسي: ما يرفعُه الفحصُ (عدُّ المُثبَّتِ) يُختَمُ
    // في المتنِ الآنَ لا في الإقلاعِ التالي، فلا يبقى شاهدٌ خارجَ الخاتَم.
    await manifest.checkpointAsync();
    // R5-A-01: شاهدُ العهدِ المزدوجُ — من البيانِ ومن السجلِّ المختومِ. وذاك
    // لأنّ بياناً أقدمَ صحيحَ الخاتَمِ + دفتراً فارغاً يُعيدُ قبولَ أمرٍ ثُبِّتَ،
    // لو كانَ الشاهدُ في البيانِ وحدَه. فالسجلُّ المختومُ شاهدٌ ثانٍ لا يُسترجَعُ
    // معَ البيانِ، وقراءتُه عندَ الإقلاعِ تجعلُ الشاهدَ مزدوجاً.
    const witnessedLedgerCommitted = await ledgerCommittedFromSealedLog(log);
    const manifestLedgerFloor = manifest.ledgerWitness();
    if (witnessedLedgerCommitted > manifestLedgerFloor.read()) {
      manifestLedgerFloor.raise(witnessedLedgerCommitted);
      await manifest.checkpointAsync();
    }
    // أرضيّةٌ مركَّبةٌ: أعلى الشاهدين. الرفعُ يذهبُ إلى البيانِ، والسجلُّ يُكتبُ
    // عبرَ `onCommitSink` بعدَ الكتابةِ وقبلَ الختمِ.
    const ledgerFloor: LedgerWitness = {
      read: (): number => Math.max(manifestLedgerFloor.read(), witnessedLedgerCommitted),
      raise: (value: number): void => manifestLedgerFloor.raise(value),
    };
    const ledger = new CommandLedger(join(options.root, 'commands.ledger'), {
      signer: signers.ledgerSigner,
      fsync,
      witness: ledgerFloor,
      sealWitness: (): Promise<void> => manifest.checkpointAsync(),
      onCommitSink: async (entry): Promise<void> => {
        await log.appendSealed('ledger.committed', signers.ledgerSigner.keyId, {
          id: entry.id,
          count: ledgerFloor.read(),
        });
      },
      provisioning,
      env,
    });
    // `M11.04-F07`: شاهدُ العهدِ يُقرأُ من **مصدرين** لا من واحدٍ — البيانُ
    // المختومُ، والسجلُّ المختومُ. وذاك لأن البيانَ وحدَه يُسترجَعُ أقدمَ منه
    // بخاتَمٍ صحيحٍ (لقطةٌ جزئيّةٌ)، والسجلُّ يبقى شاهداً لا يُصطنَعُ ولا يُقصُّ
    // منه سطرٌ بلا كسرِ سلسلةٍ يُقاس.
    const witnessedHaltEpoch = await haltEpochFromSealedLog(log);
    const manifestHaltFloor = manifest.haltEpochFloor();
    if (witnessedHaltEpoch > manifestHaltFloor.read()) {
      // البيانُ رجعَ والسجلُّ لم يرجع: يُرفَعُ البيانُ إلى ما يشهدُ به السجلُّ
      // ويُختَمُ الآنَ، فلا يبقى شاهدٌ خارجَ الخاتَمِ إلى الإقلاعِ التالي.
      manifestHaltFloor.raise(witnessedHaltEpoch);
      await manifest.checkpointAsync();
    }
    // أرضيّةٌ مركَّبةٌ: أعلى الشاهدين. ولا تُخترَعُ هنا «عدّادٌ رتيبٌ» ثالثٌ في
    // ملفٍّ على القرصِ — ذاك ممنوعٌ نصّاً في `docs/adr/0006-…`؛ وإنّما يُقرأُ
    // شاهدٌ قائمٌ أصلاً في جذرِ الثقة.
    const epochFloor: HaltEpochFloor = {
      read: (): number => Math.max(manifestHaltFloor.read(), witnessedHaltEpoch),
      raise: (value: number): void => manifestHaltFloor.raise(value),
    };
    // مفتاحُ الإيقافِ يأخذُ موقّعَ F06 نفسَه: التوجيهُ قرارٌ ملكيٌّ، ومصدرُه
    // مفتاحُ المملكةِ لا مفتاحُ الدفتر.
    // والسجلُّ المختومُ يُوصَلُ بمسارَيه غيرِ المتزامنين وحدَهما (‏`logAsync`):
    // `append` المتزامنُ يرفضُه السجلُّ المختومُ بحقٍّ، و`appendSealed` يُنتظَرُ
    // حيثُ يجوزُ الانتظار. وتاريخُ التوجيهاتِ موقَّعٌ ومسلسلٌ في ملفِّه أيضاً.
    const haltSwitch = new HaltSwitch(
      join(options.root, 'halt', 'directive.json'),
      signers.anchorSigner as unknown as HaltAsyncSigner,
      {
        fsync,
        log: null,
        logAsync: log,
        epochFloor,
        sealEpoch: (): Promise<void> => manifest.checkpointAsync(),
        env,
      },
    );
    return {
      log,
      ledger,
      haltSwitch,
      sealer,
      anchorSigner: signers.anchorSigner,
      ledgerSigner: signers.ledgerSigner,
      boot: signers.boot,
      manifest,
      raiseAnchorWitness: (count: number) => manifest.raise('anchoredCount', count),
      // R4-K3-03: مخزنُ سحبٍ دائمٌ على القرص — يُبنى من `FileRevocationStore`
      // ليُمرَّرَ إلى سلطةِ التصديقِ في الإنتاج. لا يُقبلُ `MemoryRevocationStore`
      // في الإنتاج، وهذا التنفيذُ يدومُ عبرَ إعادةِ التشغيل.
      revocationStore:
        options.revocationStore ??
        new FileRevocationStore(join(options.root, 'revoked.jsonl'), { fsync }),
      close: signers.close,
    };
  } catch (error) {
    // فشلٌ بعدَ فتحِ الجلسةِ يُغلقُها: توكنٌ يبقى مسجَّلَ الدخولِ بعدَ فشلِ
    // الإقلاعِ خطرٌ لا مجردُ تسريبِ موردٍ.
    // وما فُتِحَ في الإقلاعِ يُغلَقُ بعكسِ ترتيبِ فتحِه: إقلاعٌ مردودٌ لا يجوزُ أن
    // يتركَ قفلَ كاتبٍ يمنعُ الإقلاعَ المُصلَحَ بعدَه. وإن تعذّرَ الإغلاقُ لم يُبتلَعْ
    // خطأُ الإقلاعِ الأصليُّ: هو السببُ وهو المرفوع.
    for (const closeOpened of openedOnBoot.reverse()) {
      try {
        closeOpened();
      } catch {
        /* إغلاقٌ متعذّرٌ لا يحجبُ سببَ الفشلِ الأصليَّ */
      }
    }
    await signers.close().catch(() => undefined);
    throw error;
  }
}

/**
 * يحلُّ ملفَ مخزنِ التثبيتاتِ من البيئةِ ثمَّ من الجذر.
 * @param root - جذرُ الحالة
 * @param env - البيئة
 * @returns مسارُ مخزنِ التثبيتات
 */
function resolveAnchorFile(root: string, env: NodeJS.ProcessEnv): string {
  const declared = (env.XUUX_ANCHOR_STORE ?? '').trim();
  return declared !== '' ? declared : join(root, 'anchors.jsonl');
}

/**
 * يقرأُ **أعلى عهدِ إيقافٍ يشهدُ به السجلُّ المختوم** (‏`M11.04-F07`).
 *
 * الثابتُ المنتهَكُ قبلَ الإصلاحِ مقيسٌ: استرجاعُ بيانٍ **أقدمَ صحيحِ الخاتَمِ**
 * معَ محوِ `halt/` وحدَه وإبقاءِ الدفترِ بايتاً ببايتٍ أعادَ التركيبَ
 * `running`/`epoch=0` بعدَ إيقافٍ سياديٍّ. والسببُ أنّ شاهدَ العهدِ كانَ في موضعٍ
 * واحدٍ يُسترجَعُ كلُّه.
 *
 * وكلُّ فشلٍ في فكِّ الختمِ يُرفَعُ ولا يُتجاوَزُ: واقعةُ إيقافٍ لا يُقرأُ جسمُها
 * أسوأُ من واقعةٍ غائبةٍ، فالفشلُ مغلقٌ عندَ الإقلاعِ.
 *
 * **حدٌّ مُعلَنٌ:** من محا السجلَّ والمراسي والبيانَ **معاً** في لقطةٍ واحدةٍ
 * متّسقةٍ لا يردُّه هذا الفحصُ؛ وذاك هو الخطرُ المتبقّي المُعلَنُ في
 * `docs/adr/0006-state-manifest-seal-and-anti-rollback-limit.md`، ومنعُه التامُّ
 * يحتاجُ مرساةً خارجَ القرصِ (‏`R3-A-01`).
 * @param log - السجلُّ المحمَّلُ من القرص
 * @returns أعلى عهدٍ مشهودٍ، أو صفرٌ إن لم يكن في السجلِّ واقعةُ إيقاف
 */
export async function haltEpochFromSealedLog(log: PersistentEventLog): Promise<number> {
  let highest = 0;
  for (const event of log.events) {
    const type = (event as { type?: unknown }).type;
    if (type !== 'halt.issued' && type !== 'halt.resumed') continue;
    // فشلُ فكِّ الختمِ **يُرفَعُ برمزٍ نطاقيٍّ** لا يُتجاوَزُ ولا يُسلَّمُ خطأً
    // نيئاً من طبقةِ التعمية: واقعةُ إيقافٍ لا يُقرأُ جسمُها أسوأُ من غائبةٍ،
    // لأنّ من ملكَ القرصَ يستطيعُ إفسادَ الجسمِ ليُسقِطَ الشاهدَ. والرمزُ في
    // نطاقِ `PRODUCTION_` كي يُختبَرَ ولا يُخمَّنَ.
    let body: unknown;
    try {
      body = log.sealed ? await log.openEvent(event) : (event as { data?: unknown }).data;
    } catch {
      throw new ProductionRuntimeError(
        'PRODUCTION_HALT_WITNESS_UNREADABLE',
        String((event as { id?: unknown }).id ?? ''),
      );
    }
    const epoch = (body as { epoch?: unknown } | null)?.epoch;
    if (typeof epoch === 'number' && Number.isInteger(epoch) && epoch > highest) highest = epoch;
  }
  return highest;
}

/**
 * يقرأُ **أعلى عدِّ التزامٍ يشهدُ به السجلُّ المختوم** (‏`R5-A-01`).
 *
 * الثابتُ المنتهَكُ قبلَ الإصلاح: بيانٌ أقدمُ صحيحُ الخاتَمِ + دفترٌ فارغٌ يُعيدُ
 * قبولَ أمرٍ ثُبِّتَ، لأنّ شاهدَ العهدِ كانَ في البيانِ وحدَه. والسجلُّ المختومُ
 * شاهدٌ لا يُسترجَعُ معَ البيانِ، فالقراءةُ منه تجعلُ الشاهدَ مزدوجاً.
 *
 * **حدٌّ مُعلَنٌ:** من محا السجلَّ والبيانَ معاً في لقطةٍ واحدةٍ متّسقةٍ لا يردُّه
 * هذا الفحصُ؛ وذاك هو الخطرُ المتبقّي المُعلَنُ في `docs/adr/0006-…`.
 * @param log - السجلُّ المحمَّلُ من القرص
 * @returns أعلى عدِّ التزامٍ مشهودٍ، أو صفرٌ إن لم يكن في السجلِّ واقعةُ التزام
 */
export async function ledgerCommittedFromSealedLog(log: PersistentEventLog): Promise<number> {
  let highest = 0;
  for (const event of log.events) {
    const type = (event as { type?: unknown }).type;
    if (type !== 'ledger.committed') continue;
    let body: unknown;
    try {
      body = log.sealed ? await log.openEvent(event) : (event as { data?: unknown }).data;
    } catch {
      throw new ProductionRuntimeError(
        'PRODUCTION_LEDGER_WITNESS_UNREADABLE',
        String((event as { id?: unknown }).id ?? ''),
      );
    }
    const count = (body as { count?: unknown } | null)?.count;
    if (typeof count === 'number' && Number.isInteger(count) && count > highest) highest = count;
  }
  return highest;
}

/**
 * يرفضُ إقلاعاً على سجلٍ أقصرَ ممّا تشهدُ به المرساةُ (‏`UF-01`).
 *
 * الثابتُ المنتهَكُ قبلَ الإصلاح: حذفُ ملفِ الوقائعِ ورأسِه كان يُقرأُ
 * «سجلاً جديداً من GENESIS» فيُقبَلُ بلا مرساةٍ موثوقة، فيمحو التاريخَ من
 * يملكُ القرصَ دونَ أن يملكَ التوكن.
 * @param manifest - بيانُ الجذر
 * @param log - السجلُ المبنيُّ
 * @param king - موقّعُ التثبيت (F06)
 * @param options - خياراتُ المصنع
 * @param fsync - مزامنةُ القرص
 * @param env - البيئة
 */
function assertLogNotBehindAnchors(
  manifest: StateManifest,
  log: PersistentEventLog,
  king: HsmSigner,
  options: ProductionRuntimeOptions,
  fsync: boolean,
  env: NodeJS.ProcessEnv,
): void {
  const store =
    options.anchorStore ?? new FileAnchorStore(resolveAnchorFile(options.root, env), { fsync });
  if (store instanceof FileAnchorStore) store.assertSeparateFrom(log.file);
  log.load();
  const anchors = store.read();
  const witnessed = manifest.read().anchoredCount;
  if (anchors.length === 0) {
    // لا تثبيتاتٍ والبيانُ يشهدُ بواحدٍ: المخزنُ مُزيلٌ لا فارغٌ أصلاً.
    if (witnessed > 0) {
      throw new ProductionRuntimeError(
        'PRODUCTION_LOG_BEHIND_ANCHOR',
        `البيانُ يشهدُ بـ${String(witnessed)} ولا تثبيتات`,
      );
    }
    return;
  }
  const verification = verifyAnchoredLog({ events: log.events, anchors, king });
  if (!verification.ok) {
    throw new ProductionRuntimeError(
      'PRODUCTION_ANCHOR_CHAIN_INVALID',
      verification.problem ?? 'unknown',
    );
  }
  const last = anchors[anchors.length - 1] as { count: number };
  const floor = Math.max(witnessed, last.count);
  if (log.events.length < floor) {
    throw new ProductionRuntimeError(
      'PRODUCTION_LOG_BEHIND_ANCHOR',
      `السجلُ ${String(log.events.length)} والمرساةُ ${String(floor)}`,
    );
  }
  manifest.raise('anchoredCount', last.count);
}

/**
 * المصدرُ الافتراضيّ: توكنٌ حقيقيٌّ من متغيّراتِ البيئة.
 * @param env - البيئة
 * @returns المصدرُ وطريقةُ إغلاقِه
 */
async function defaultOpenSource(env: NodeJS.ProcessEnv): Promise<OpenedKeySource> {
  const provider = await Pkcs11HsmProvider.fromEnv(env);
  return { source: provider, close: () => provider.close() };
}

/** مصرِفُ وقائعَ متزامنُ العقدِ فوقَ سجلٍّ مختومٍ غيرِ متزامن. */
export interface SealedEventSink {
  /**
   * يُدرِجُ واقعةً في طابورٍ مرتَّبٍ ويُرجعُ فوراً — نفسُ عقدِ `EventLog.append`
   * الذي تعرفُه المستهلكاتُ القائمة.
   * @param type - نوعُ الواقعة
   * @param actor - فاعلُها
   * @param data - جسمُها
   */
  append(type: string, actor: string, data: object): void;
  /**
   * ينتظرُ استقرارَ كلِّ ما أُدرِج، ويرفعُ أولَ فشلٍ وقع.
   * @returns وعدٌ يستقرُّ بعدَ آخرِ كتابة
   */
  drain(): Promise<void>;
  /** عددُ ما لم يستقرَّ بعد — يُقرأُ للتشخيص. */
  readonly pending: number;
}

/**
 * يبني مصرِفاً متزامنَ العقدِ فوقَ سجلٍّ مختوم. المشكلةُ التي يحلُّها: مستهلكاتٌ
 * قائمةٌ (عزلُ التنفيذِ مثلاً) تُنادي `append` نداءً متزامناً وتُهمِلُ راجعَه،
 * والختمُ غيرُ متزامن. فالحلُّ طابورٌ **مرتَّبٌ** لا نداءاتٌ متطايرة: كلُّ كتابةٍ
 * تُسلسَلُ بعدَ سابقتِها فيبقى ترتيبُ الوقائعِ كما وقع، وأولُ فشلٍ يُحفَظُ
 * ويُرفَعُ عندَ `drain` — فلا واقعةٌ تُفقَدُ بصمت. والمستدعي يُصرِّفُ عندَ حدودِ
 * المهامِّ وقبلَ الإغلاق، فالفشلُ يُوقفُ العاملَ ولا يُتجاوَز.
 * @param log - السجلُّ المختوم
 * @returns المصرِف
 */
export function createSealedEventSink(log: PersistentEventLog): SealedEventSink {
  let chain: Promise<void> = Promise.resolve();
  // الفشلُ يُجمَعُ في مصفوفةٍ لا في متغيّرٍ يُعادُ إسنادُه بعدَ `await`: إسنادٌ
  // كذلك يقرأُ حالةً قديمةً إن تسابقتِ الكتاباتُ، والدفعُ إلى مصفوفةٍ لا يُسنِد.
  const failures: unknown[] = [];
  let pending = 0;
  return {
    append(type: string, actor: string, data: object): void {
      pending += 1;
      chain = chain.then(async () => {
        if (failures.length > 0) return;
        try {
          await log.appendSealed(type, actor, data);
        } catch (error) {
          failures.push(error);
        } finally {
          pending -= 1;
        }
      });
    },
    async drain(): Promise<void> {
      await chain;
      if (failures.length > 0) throw failures[0];
    },
    get pending(): number {
      return pending;
    },
  };
}

/** سجلٌّ مختومٌ مفتوحٌ مع مصرِفِه وطريقةِ إغلاقِ التوكن. */
export interface OpenedSealedLog {
  log: PersistentEventLog;
  sink: SealedEventSink;
  sealer: EventDataSealer;
  close(): Promise<void>;
}

/**
 * يفتحُ سجلَّ وقائعَ مختوماً وحدَه — لمن يحتاجُ سجلاً لا عقدةً كاملة (العامل).
 * @param env - البيئة
 * @param file - ملفُّ السجل
 * @param deps - بدائلُ الحقنِ للاختبار
 * @param options - مزامنةُ القرص
 * @returns السجلُّ ومصرِفُه وطريقةُ الإغلاق
 */
export async function openProductionEventLog(
  env: NodeJS.ProcessEnv,
  file: string,
  deps: ProductionRuntimeDeps = {},
  options: { fsync?: boolean } = {},
): Promise<OpenedSealedLog> {
  const signers = await openProductionSigners(env, deps);
  try {
    const log = new PersistentEventLog(file, {
      sealer: signers.sealer,
      env,
      fsync: options.fsync ?? true,
    });
    return { log, sink: createSealedEventSink(log), sealer: signers.sealer, close: signers.close };
  } catch (error) {
    await signers.close().catch(() => undefined);
    throw error;
  }
}

/**
 * يُلزِمُ العقدةَ بالمصنعِ الإنتاجيِّ: يُستدعى من نقاطِ الإقلاعِ التي كانت تبني
 * مكوّناتِها يدوياً، فيرفضُ بناءً يدوياً في الإنتاج.
 * @param env - البيئة
 * @param what - اسمُ المكوّنِ الذي حُوول بناؤه، للتشخيص
 */
export function assertProductionUsesFactory(env: NodeJS.ProcessEnv, what: string): void {
  if (isProductionRuntime(env)) {
    throw new ProductionRuntimeError('PRODUCTION_RUNTIME_REQUIRES_HSM', what);
  }
}

/**
 * يتحقّقُ من الأدلّةِ الثلاثةِ بعدَ الإقلاع: السجلُّ مختومٌ، والدفترُ موقَّعٌ،
 * والتوجيهُ يُصدَرُ بمفتاحِ التوكن. تُستعملُ في الاختباراتِ وفي أدواتِ التدقيق.
 * @param runtime - التركيبُ المبنيّ
 * @returns وصفٌ موجزٌ لكلِّ ربطٍ
 */
export function describeProductionBindings(runtime: ProductionRootOfTrust): {
  sealedLog: boolean;
  sealKeyId: string;
  ledgerSigned: boolean;
  ledgerKeyId: string;
  anchorKeyId: string;
} {
  return {
    sealedLog: runtime.log.sealed,
    sealKeyId: runtime.sealer.keyId,
    ledgerSigned: runtime.ledger.auditSignatures().problem !== 'LEDGER_SIGNER_MISSING',
    ledgerKeyId: runtime.ledgerSigner.keyId,
    anchorKeyId: runtime.anchorSigner.keyId,
  };
}
