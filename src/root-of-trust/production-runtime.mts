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
import { LOG_HEAD_SUFFIX, PersistentEventLog, inspectEventLog } from './persistent-log.mjs';
import type { EventDataSealer } from './persistent-log.mjs';
import { Pkcs11HsmProvider } from './pkcs11-provider.mjs';
import {
  assertHsmRequiredInProduction,
  assertProductionKeyProviderAllowed,
  describeRootOfTrustBoot,
  isProductionRuntime,
  loadPinnedRoyalPublicKey,
  ProductionBootError,
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
import type { FreshnessSocket, StateBoundFreshnessSocket } from './freshness-socket.mjs';
import {
  FRESHNESS_GENESIS_ANCHOR,
  isNullFreshnessSocket,
  isStateBoundFreshnessSocket,
  STALE_MANIFEST_EPOCH,
  FRESHNESS_SOURCE_UNAVAILABLE,
} from './freshness-socket.mjs';
import {
  CommitCoordinator,
  computeStateDigest,
  inCommitTransaction,
  releaseCommitBarriersFor,
  stateAnchor,
  type StateLayout,
} from './commit-barrier.mjs';
import {
  HALT_ACKS_SUFFIX,
  HALT_EPOCH_SUFFIX,
  HALT_HISTORY_SUFFIX,
  HALT_NODES_SUFFIX,
} from './halt-switch.mjs';
import { LEDGER_CLAIMS_SUFFIX } from './command-ledger.mjs';
import { RootIntentProcessor, type IntentHaltSwitch } from './root-intents.mjs';
import {
  createRoyalCommandVerifier,
  royalKeyFingerprint,
  trustedRoyalVerifierFingerprint,
} from './royal-command.mjs';

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
  'PRODUCTION_QUARANTINE_WITNESS_UNREADABLE',
  'PRODUCTION_GRANTS_WITNESS_UNREADABLE',
  // `S13` (الجولةُ السادسةُ، `WL-237`): جذرٌ قائمٌ — أي بيانٌ مختومٌ كانَ على
  // القرصِ قبلَ هذا الإقلاعِ — بلا سجلِّ وقائعَ أو بلا رأسِه. غيابُ الشاهدِ
  // الثاني على جذرٍ قائمٍ محوٌ لا نشأةٌ، فيُرَدُّ فشلاً مُغلقاً كنظيرِه
  // `LEDGER_STATE_ROOT_MISSING` (‏`UF-13`) لا يُقرأُ «سجلاً من GENESIS».
  'LOG_STATE_ROOT_MISSING',
  // EXT-6 / R3-A-01: بيانٌ مختومٌ صحيحٌ لكنّه أقدمُ من مرجعِ الحداثةِ الخارجيِّ.
  // لا يُدَّعى منعُ rollback حتى يصبحَ مصدرُ الحداثةِ الحقيقيُّ موصولاً.
  'STALE_MANIFEST_EPOCH',
  // P0 Freshness: الإنتاجُ بلا مقبسِ حداثةٍ فعليٍّ — لا مسارَ بلا حمايةٍ من الإعادة.
  'PRODUCTION_FRESHNESS_SOCKET_REQUIRED',
  // P0 Freshness: البيانُ يتقدّمُ على المرجعِ الخارجيِّ بلا رفعٍ مُصرَّحٍ — تقدّمٌ غيرُ مُشروعٍ.
  'FRESHNESS_EPOCH_REGRESSION',
  // `WL-302`: مُحقِّقُ أمرٍ ملكيٍّ محقونٌ ليس مبنيّاً على مفتاحِ الملكِ في التوكن.
  'ROYAL_COMMAND_VERIFIER_UNTRUSTED',
  // `LIVE-28` (‏`WL-326`، الوضعُ المربوطُ بالحالة): رموزُ الإقلاعِ المسمّاة (‏§5).
  'FRESHNESS_SOURCE_UNAVAILABLE',
  'FRESHNESS_SAME_EPOCH_FORK',
  'FRESHNESS_STATE_DIGEST_MISMATCH',
  'FRESHNESS_BINDING_UNDECLARED',
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
   * R5-B-07 (تقرير: R5-B-05): مُحقِّقُ الأمرِ الملكيِّ لمفتاحِ الإيقاف. في
   * الإنتاجِ لا يصدرُ إيقافٌ ولا استئنافٌ إلّا بأمرٍ ملكيٍّ يُصدِّقُهُ،
   * وغيابُهُ فشلٌ مغلقٌ لا مسارٌ احتياطيّ.
   */
  royalCommandVerifier?: ((command: unknown) => boolean) | null;
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
  /**
   * مقبسُ الحداثةِ (EXT-6 / R3-A-01). إن وُجد، يُقرأُ مرجعُ الحداثةِ عندَ
   * الإقلاعِ ويُقارَنُ بالبيانِ: إن كانَ أحدثَ من البيانِ ⇒ رفضٌ مغلقٌ
   * `STALE_MANIFEST_EPOCH`. وإن لم يُوجَد (`null`) فالسلوكُ كما كان —
   * الحدُّ المُعلَنُ في ADR 0006 قائمٌ. **الواجهةُ وحدَها ليست إصلاحاً:**
   * لا يُدَّعى منعُ rollback حتى يصبحَ مصدرُ الحداثةِ الحقيقيُّ موصولاً.
   * اختيارُ الـbackend للمالك — راجع `docs/external-review/options/`.
   */
  freshnessSocket?: FreshnessSocket | StateBoundFreshnessSocket | null;
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
  /**
   * `LIVE-24`: المفتاحُ الملكيُّ العامُّ — **غيرُ** مفتاحِ المرساةِ والدفترِ، ولا خاصَّ له
   * على العُقدة. منه وحدَه يُبنى مُحقِّقُ أوامرِ الإيقافِ وهويّةُ التاجِ وحدُّ التفويض.
   */
  royalPublicKeyPem: string;
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
  /**
   * `D6`/`D3` (‏`WL-326`): حاجزُ الالتزامِ — الكاتبُ الإنتاجيُّ الواحد. كلُّ تغييرٍ في
   * الحالةِ يمرُّ عبرَ `run()`، ولا يُرجَعُ نجاحٌ قبلَ الدوامِ والترقية.
   */
  commitBarrier: CommitCoordinator;
  /**
   * سحبُ شهادةٍ عبرَ الحاجز — المسارُ الإنتاجيُّ لـ`revocationStore.revoke`.
   * @returns هل كُتِبَ السحب
   */
  revokeAsync(certificateId: string, revokedBy: string, reason: string): Promise<boolean>;
  /** تثبيتُ السجلِّ عبرَ الحاجز — المسارُ الإنتاجيُّ لـ`maybeAnchorLogWithHsm`. */
  anchorAsync(options?: {
    force?: boolean;
    intervalMs?: number;
    at?: Date;
  }): Promise<AnchorRecord | null>;
  /**
   * `D6`: يُطبِّقُ قصودَ العملياتِ الأخرى المُودَعةَ في صندوقِ الجذرِ (‏`root-intents.mts`)
   * عبرَ الحاجز — فلا كاتبَ ثانياً لـ`nodes/` و`acks/` ومخزنِ المراسي.
   * @returns عددُ القصودِ المُعالَجة
   */
  drainIntentsAsync(): Promise<number>;
  /**
   * حكمُ الإقلاعِ في الوضعِ المربوطِ بالحالة (‏`B1`/`B2`/`B3`/`B10`)، أو `null` في الوضعِ
   * القديمِ (‏`bump`). للتدقيقِ وإعادةِ القياس.
   */
  freshnessBoot: 'B1' | 'B2' | 'B3' | 'B10' | null;
  /** يُغلقُ الحاجزَ والسجلَّ وجلسةَ التوكن. */
  close(): Promise<void>;
}

/** قصدُ الربطِ الأوّلِ بالمرجعِ المربوطِ بالحالة (‏`B10`). */
const FRESHNESS_BIND_INTENT = 'freshness.bind';

/** إعلانُ ربطِ جذرٍ قائمٍ بمرجعٍ مربوطٍ لأوّلِ مرّة — إعلانٌ لا استنباط (‏كإذنِ التهيئة). */
export const FRESHNESS_BIND_DECLARED_ENV = 'XUUX_FRESHNESS_BIND_DECLARED';

/**
 * مكوّناتُ بصمةِ الحالة `V` (‏§2 من التصميم بعدَ تصحيحِ افتراضِ `WL-325` الرابع): السجلُّ
 * والدفترُ وحجوزاتُه والإيقافُ بعهدِه وتاريخِه وعُقدِه وإقراراتِه (‏`P8`/`P9` **داخلَ**
 * البصمة) والتثبيتاتُ والسحب و`clock-state.json` (‏`P13`، `LIVE-37`/`WL-331`: أرضيّةُ
 * الحدّ الأعلى للساعةِ السياديّة — استرجاعُها أقدمَ يُحيي نافذةَ الإعادةِ، فهي حالةٌ
 * تُقَرّ لا مجرّدُ أرضيّةِ قياس). ومستثنى: البيانُ ودفترُه (‏آليّةُ الختمِ نفسُها)، والأقفالُ،
 * ورأسُ السجلِّ (‏مشتقٌّ يُعادُ بناؤه، ويُسترجَعُ معَ السجلّ)، وصندوقُ القصود.
 *
 * `LIVE-37`: غابَ P13 عن جردِ P0–P12 في `WL-325` فبقيَ استرجاعُه أقدمَ بلا كشف. صارَ داخلَ
 * `V`، وكتابتُه لا تقعُ إلّا عبرَ حاجزِ الالتزام (‏معاملةُ `clock.persist` في `SovereignClock`).
 * ومعلَنٌ: جذرٌ رُبِطَ قبلَ هذا التغييرِ يحملُ بصمةً بلا P13، فأوّلُ إقلاعٍ له بعده في
 * الوضعِ المربوطِ يُرَدّ بفرقِ البصمةِ حتى تُكتَبَ الحالةُ التاليةُ — لا تُدّعى ترقيةٌ
 * صامتةٌ (والوضعُ المربوطُ اختباريٌّ اليوم، `LIVE-38`).
 * @param root - جذرُ الحالة
 * @param anchorFile - مخزنُ التثبيتات
 * @returns المكوّنات
 */
export function productionStateLayout(root: string, anchorFile: string): StateLayout {
  const halt = join(root, 'halt', 'directive.json');
  const ledger = join(root, 'commands.ledger');
  return {
    files: [
      join(root, 'events.log'),
      ledger,
      halt,
      halt + HALT_EPOCH_SUFFIX,
      halt + HALT_HISTORY_SUFFIX,
      anchorFile,
      join(root, 'revoked.jsonl'),
      join(root, 'clock-state.json'),
      // **WL-363 (‏قرارُ المالكِ):** لقطةُ منحِ القدراتِ داخلَ بصمةِ الحالةِ المختومةِ.
      // مسارُ الكتابةِ صارَ موافقَ الحاجزِ (`beforeDurableWrite` في المخزنِ) فكتابتُها
      // تُحدِّثُ الهضمَ وترفَعُ البيانَ معَ ختمِ الشاهدِ — كتلةً واحدةً.
      join(root, 'capability-grants.json'),
    ],
    dirs: [ledger + LEDGER_CLAIMS_SUFFIX, halt + HALT_NODES_SUFFIX, halt + HALT_ACKS_SUFFIX],
  };
}

/**
 * حكمُ الإقلاعِ في الوضعِ المربوطِ بالحالة (‏§5: `B0`–`B10`). يقعُ **قبلَ** فتحِ السجلِّ
 * والدفتر: الاسترجاعُ يقصُّ ما كُتِبَ بعدَ آخرِ ترقية، فلا يُقرأُ شيءٌ قبلَه.
 * @param manifest - البيانُ المفتوح
 * @param socket - المرجع
 * @param coordinator - الحاجزُ (‏للربطِ الأوّل)
 * @param context - الجذرُ والمزامنةُ والتهيئةُ والبيئة
 * @returns ما وقع — للتدقيق
 */
export async function decideStateBoundBoot(
  manifest: StateManifest,
  socket: StateBoundFreshnessSocket,
  coordinator: CommitCoordinator,
  context: {
    root: string;
    fsync: boolean;
    provisioning: boolean;
    env: NodeJS.ProcessEnv;
    layout: StateLayout;
  },
): Promise<'B1' | 'B2' | 'B3' | 'B10'> {
  let reference: { epoch: bigint; anchor: string };
  try {
    reference = await socket.read();
  } catch {
    // B0
    throw new ProductionRuntimeError('FRESHNESS_SOURCE_UNAVAILABLE', 'تعذّرت قراءةُ المرجع');
  }
  const body = manifest.read();
  const staged = body.staged ?? null;
  if (staged !== null) {
    const fromEpoch = BigInt(staged.fromEpoch);
    if (reference.epoch === fromEpoch && reference.anchor === staged.fromAnchor) {
      // B2: المرجعُ لم يتقدّمْ فوقَ المعاملة ⇒ لم يُقَرَّ بها ⇒ استرجاعٌ دقيق.
      await CommitCoordinator.rollbackStagedAsync(
        context.root,
        manifest,
        staged.txn,
        context.fsync,
      );
      if (staged.intent === FRESHNESS_BIND_INTENT) {
        // ربطٌ أوّلُ انقطعَ قبلَ الانتقال: الترحيلُ المختومُ نفسُه هو الإعلان. الحكمُ `B2`
        // (‏استرجاعٌ دقيقٌ إلى ما قبلَ الربط) ثمَّ يُعادُ الربطُ فوقَ الحالةِ نفسِها.
        await coordinator.bindAsync(FRESHNESS_BIND_INTENT);
        return 'B2';
      }
      assertDigestMatches(manifest.read(), context.layout);
      return 'B2';
    }
    if (reference.epoch === fromEpoch) {
      throw new ProductionRuntimeError(
        'FRESHNESS_SAME_EPOCH_FORK',
        `المرجعُ في العهدِ ${String(fromEpoch)} بمرساةٍ غيرِ مرساةِ الترحيل`,
      );
    }
    if (reference.epoch === fromEpoch + 1n) {
      const digest = computeStateDigest(context.layout);
      const anchor = stateAnchor(body.instanceId, Number(reference.epoch), digest);
      if (anchor === reference.anchor) {
        // B3: المرجعُ تقدّمَ فوقَ عينِ هذه الحالة ⇒ تُرقّى.
        await manifest.promoteAsync({ epoch: Number(reference.epoch), anchor, digest });
        return 'B3';
      }
      // B4: المرجعُ تقدّمَ فوقَ حالةٍ غيرِ التي على القرص.
      throw new ProductionRuntimeError(
        'FRESHNESS_SAME_EPOCH_FORK',
        `المرجعُ في ${String(reference.epoch)} يشهدُ على حالةٍ غيرِ التي على القرص`,
      );
    }
    if (reference.epoch > fromEpoch + 1n) {
      throw new ProductionRuntimeError(
        STALE_MANIFEST_EPOCH,
        `المرجعُ ${String(reference.epoch)} أحدثُ من الترحيلِ ${String(fromEpoch)}`,
      );
    }
    throw new ProductionRuntimeError(
      'FRESHNESS_EPOCH_REGRESSION',
      `الترحيلُ من ${String(fromEpoch)} والمرجعُ ${String(reference.epoch)}`,
    );
  }
  const manifestEpoch = BigInt(body.freshnessEpoch);
  if (body.freshnessAnchor === undefined || body.stateDigest === undefined) {
    // B10: لم يُربَطْ بعد. الربطُ الأوّلُ **مُعلَنٌ** لا مُستنبَط: تهيئةٌ جديدةٌ، أو إعلانٌ صريح.
    const declared = context.provisioning || context.env[FRESHNESS_BIND_DECLARED_ENV] === '1';
    // والمرجعُ في النشأةِ وحدَها: مرجعٌ تقدّمَ لا يُربَطُ به جذرٌ غيرُ مربوط. وعهدُ البيانِ
    // القديمُ (‏مقبسُ `bump`) لا يُشترَطُ صفراً عندَ الإعلان: المرجعُ المربوطُ سلسلةٌ جديدة،
    // ولقطةٌ قديمةٌ غيرُ مربوطةٍ بعدَ الربطِ تُرَدُّ هنا نفسِه (‏المرجعُ لم يعُدْ في النشأة).
    if (
      (manifestEpoch === 0n || declared) &&
      reference.epoch === 0n &&
      reference.anchor === FRESHNESS_GENESIS_ANCHOR &&
      declared
    ) {
      await coordinator.bindAsync(FRESHNESS_BIND_INTENT);
      return 'B10';
    }
    if (reference.epoch > manifestEpoch) {
      throw new ProductionRuntimeError(
        STALE_MANIFEST_EPOCH,
        `المرجعُ ${String(reference.epoch)} والبيانُ غيرُ مربوطٍ في ${String(manifestEpoch)}`,
      );
    }
    throw new ProductionRuntimeError(
      'FRESHNESS_BINDING_UNDECLARED',
      `${FRESHNESS_BIND_DECLARED_ENV}=1 مطلوبٌ لربطِ جذرٍ قائم`,
    );
  }
  if (reference.epoch > manifestEpoch) {
    // B5
    throw new ProductionRuntimeError(
      STALE_MANIFEST_EPOCH,
      `المرجعُ ${String(reference.epoch)} أحدثُ من البيانِ ${String(manifestEpoch)}`,
    );
  }
  if (manifestEpoch > reference.epoch) {
    // B7
    throw new ProductionRuntimeError(
      'FRESHNESS_EPOCH_REGRESSION',
      `البيانُ ${String(manifestEpoch)} أحدثُ من المرجعِ ${String(reference.epoch)}`,
    );
  }
  if (reference.anchor !== body.freshnessAnchor) {
    // B6: العهدُ نفسُه ومرساةٌ أخرى — لقطةٌ من فرعٍ آخر.
    throw new ProductionRuntimeError(
      'FRESHNESS_SAME_EPOCH_FORK',
      `العهدُ ${String(manifestEpoch)} بمرساتينِ مختلفتين`,
    );
  }
  // B8
  assertDigestMatches(body, context.layout);
  return 'B1';
}

/**
 * `B8`: الحالةُ على القرصِ عينُ ما خُتِمَ — بالبصمةِ الكاملةِ لا بالأعداد.
 * @param body - المتن
 * @param layout - المكوّنات
 */
function assertDigestMatches(
  body: { stateDigest?: string | undefined },
  layout: StateLayout,
): void {
  if (body.stateDigest === undefined) return;
  const digest = computeStateDigest(layout);
  if (digest !== body.stateDigest) {
    throw new ProductionRuntimeError(
      'FRESHNESS_STATE_DIGEST_MISMATCH',
      'الحالةُ على القرصِ غيرُ ما يشهدُ عليه البيانُ والمرجع',
    );
  }
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
    // P0 Freshness Enforcement: الإنتاجُ بلا مقبسِ حداثةٍ فعليٍّ لا يُقبَلُ.
    // الحدُّ المُعلَنُ في ADR 0006 كان قائماً (اللقطةُ المتّسقةُ تُقبَلُ بلا مصدرِ حداثةٍ)،
    // لكنّ المستخدمَ طلبَ تحويلَ الحداثةِ من مكوّنٍ إلى إنفاذٍ فعليّ. فالإنتاجُ الآن
    // يَفرضُ مقبسَ حداثةٍ غيرَ فارغٍ. أمّا التطويرُ والاختبارُ فيَبقيانِ على `null`.
    const freshnessSocket = options.freshnessSocket ?? null;
    if (production && isNullFreshnessSocket(freshnessSocket)) {
      throw new ProductionRuntimeError(
        'PRODUCTION_FRESHNESS_SOCKET_REQUIRED',
        'الإنتاجُ يَفرضُ مقبسَ حداثةٍ غيرَ فارغٍ — لا مسارَ بلا حمايةٍ من الإعادة',
      );
    }
    // `WL-326`: إقلاعٌ جديدٌ لهذا الجذرِ في هذه العمليةِ يأخذُ الكتابةَ من كلِّ حاجزٍ سبقَه.
    releaseCommitBarriersFor(options.root);
    const stateBoundSocket = isStateBoundFreshnessSocket(freshnessSocket) ? freshnessSocket : null;
    const anchorFile = resolveAnchorFile(options.root, env);
    const layout = productionStateLayout(options.root, anchorFile);
    let fenceLog: () => void = () => undefined;
    const coordinator = new CommitCoordinator({
      root: options.root,
      extraFiles: [anchorFile],
      manifest,
      layout,
      fsync,
      socket: stateBoundSocket,
      onFence: () => fenceLog(),
    });
    let freshnessBoot: 'B1' | 'B2' | 'B3' | 'B10' | null = null;
    if (stateBoundSocket !== null) {
      // `LIVE-28` الخيارُ ب: الحكمُ بالمرجعِ المربوطِ بالحالة، والاسترجاعُ قبلَ أيِّ فتح.
      await manifest.initJournalKey();
      freshnessBoot = await decideStateBoundBoot(manifest, stateBoundSocket, coordinator, {
        root: options.root,
        fsync,
        provisioning,
        env,
        layout,
      });
    }
    // EXT-6 / R3-A-01: فحصُ الحداثةِ الخارجيِّ. إن وُجدَ مصدرُ حداثةٍ موصولٌ،
    // يُقرأُ عَهْدُهُ ويُقارَنُ بالعَهْدِ المختومِ في البيان.
    //   Case 1: البيانُ أقدمُ من المرجعِ ⇒ STALE_MANIFEST_EPOCH (لقطةٌ قديمةٌ)
    //   Case 2: البيانُ أحدثُ من المرجعِ ⇒ FRESHNESS_EPOCH_REGRESSION (تقدّمٌ غيرُ مُشروعٍ)
    //   Case 5: البيانُ مساوٍ للمرجعِ ⇒ قبولٌ (تقدّمٌ رتيبٌ طبيعيّ)
    if (
      stateBoundSocket === null &&
      !isNullFreshnessSocket(freshnessSocket) &&
      freshnessSocket !== null
    ) {
      const freshness = await freshnessSocket.read();
      const manifestBody = manifest.read();
      const externalEpoch = Number(freshness.epoch);
      const manifestEpoch = manifestBody.freshnessEpoch;
      // R10-F-01 (WL-308): لا إعفاءَ للعهدِ الصفريِّ. بيانٌ مختومٌ عهدُه `0` ومرجعٌ
      // خارجيٌّ `> 0` تناقضٌ مُسمّىً لا «أوّلُ وصلٍ»: المرجعُ لا يتقدّمُ إلا بطيٍّ بعدَ
      // نقطةِ ضبطٍ مختومةٍ، فبيانٌ صفريٌّ معَ مرجعٍ متقدّمٍ لقطةٌ من نافذةِ الإقلاعِ الأوّلِ
      // أو من قبلِ أوّلِ طيٍّ. أوّلُ وصلٍ مشروعٌ هو `0 = 0` وحدَه (Case 5 أدناه).
      if (externalEpoch > manifestEpoch) {
        // Case 1: اللقطةُ القديمةُ المتّسقةُ تُرفَضُ
        throw new ProductionRuntimeError(
          STALE_MANIFEST_EPOCH,
          `عَهْدُ الحداثةِ الخارجيِّ ${externalEpoch} أحدثُ من البيانِ ${manifestEpoch} — اللقطةُ القديمةُ المتّسقةُ لا تُقبَلُ`,
        );
      }
      if (manifestEpoch > externalEpoch) {
        // Case 2: البيانُ تقدّمَ على المرجعِ بلا رفعٍ مُصرَّحٍ — تقدّمٌ غيرُ مُشروعٍ
        throw new ProductionRuntimeError(
          'FRESHNESS_EPOCH_REGRESSION',
          `عَهْدُ البيانِ ${manifestEpoch} أحدثُ من المرجعِ الخارجيِّ ${externalEpoch} — تقدّمٌ غيرُ مُشروعٍ`,
        );
      }
      if (externalEpoch === 0) {
        // أوّلُ وصلٍ: لا رفضَ، لكنّ العَهْدَ يُرفعُ في نقطةِ الضبطِ التاليةِ.
        void FRESHNESS_SOURCE_UNAVAILABLE;
      }
    }
    // `LIVE-36`/`LIVE-35` في الوضعِ القديم (‏`WL-326`): معاملةٌ مُرحَّلةٌ بلا مرجعٍ مربوطٍ لم
    // يُقَرَّ بها قطّ (‏لا انتقالَ في الوضعِ القديم) ⇒ تُسترجَعُ قبلَ فتحِ السجلِّ والدفتر.
    // فلا يُقرأُ دفترٌ أمامَ شاهدِه (‏`LEDGER_AHEAD_OF_WITNESS`) بعدَ انقطاعٍ في منتصفِ تثبيت.
    if (stateBoundSocket === null) {
      const staged = manifest.read().staged ?? null;
      if (staged !== null) {
        await manifest.initJournalKey();
        await CommitCoordinator.rollbackStagedAsync(options.root, manifest, staged.txn, fsync);
      }
    }
    // R4-B-01: استخرجْ مفتاحَ مصادقةِ دفترِ الرفعِ من التوكنِ بعدَ التحقّقِ من
    // الخاتَمِ، قبلَ أيِّ رفعٍ متزامنٍ. بدونِ هذا، تبقى سطورُ الدفترِ بلا مصادقةٍ،
    // فيستطيعُ مالكُ القرصِ أن يَدُسَّ سطراً غيرَ مُصادَقٍ عليه ثم يُختَمَ في المتنِ.
    await manifest.initJournalKey();
    // السجلُّ يُفتَحُ **بعدَ** التحقّقِ من الخاتَمِ: رفضُ الإقلاعِ لا يُنشئُ ملفَّ
    // وقائعَ جديداً، فلا يُقرأُ ملفٌّ فارغٌ خلَّفَه رفضٌ «سجلاً من GENESIS».
    // `S13` (`WL-237`): الشاهدُ الثاني يُفتَقَدُ **قبلَ** أن يُفتَحَ السجلُّ — ولو تأخَّرَ
    // الفحصُ لمحا فتحُ السجلِّ أثرَ المحوِ بإنشاءِ ملفٍّ فارغٍ يُقرأُ «نشأةً».
    // في الوضعِ المربوطِ بالحالةِ حكمُ الإقلاعِ (‏`B1`/`B2`/`B3`) تحقّقَ أنّ ما على القرصِ —
    // والسجلُّ منه — عينُ الحالةِ المُقَرّة؛ فغيابُ السجلِّ حينئذٍ هو الحالةُ المُقَرّةُ نفسُها
    // (‏تهيئةٌ سقطت قبلَ إنشائِه — `C11`) لا محوٌ، ومحوُه بعدَ وجودِه يُرَدُّ هناك برمزِ البصمة.
    const verifiedState =
      freshnessBoot === 'B1' || freshnessBoot === 'B2' || freshnessBoot === 'B3';
    assertSealedLogPresentOnExistingRoot(
      join(options.root, 'events.log'),
      provisioning || verifiedState,
      env,
    );
    const log = new PersistentEventLog(join(options.root, 'events.log'), {
      sealer,
      env,
      fsync,
    });
    openedOnBoot.push((): void => log.close());
    // التسييجُ يُغلِقُ السجلَّ فيُفلِتُ قفلَه: إقلاعٌ مُستعيدٌ في العمليةِ نفسِها لا يُحجَب.
    fenceLog = (): void => log.close();
    assertLogNotBehindAnchors(manifest, log, signers.anchorSigner, options, fsync, env);
    // نقطةُ ضبطٍ ثانيةٌ بعدَ فحصِ المراسي: ما يرفعُه الفحصُ (عدُّ المُثبَّتِ) يُختَمُ
    // في المتنِ الآنَ لا في الإقلاعِ التالي، فلا يبقى شاهدٌ خارجَ الخاتَم.
    await manifest.checkpointAsync();
    // EXT-6: بعدَ نقطةِ الضبطِ الأولى، إن وُجدَ مصدرُ حداثةٍ موصولٌ، يُرفعُ
    // عَهْدُهُ ويُخزَّنُ في البيان. فالبيانُ القادمُ يشهدُ على عَهْدٍ لا يُسترجَعُ.
    if (
      stateBoundSocket === null &&
      !isNullFreshnessSocket(freshnessSocket) &&
      freshnessSocket !== null
    ) {
      const bumped = await (freshnessSocket as FreshnessSocket).bump();
      manifest.raise('freshnessEpoch', Number(bumped.epoch));
      await manifest.checkpointAsync();
    }
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
      // داخلَ معاملةٍ تختمُ الترقيةُ الشاهدَ معَ الحالةِ؛ فالختمُ المنفصلُ هناك لا يلزم.
      sealWitness: (): Promise<void> =>
        inCommitTransaction(coordinator) ? Promise.resolve() : manifest.checkpointAsync(),
      onCommitSink: async (entry): Promise<void> => {
        await log.appendSealed('ledger.committed', signers.ledgerSigner.keyId, {
          id: entry.id,
          count: ledgerFloor.read(),
        });
      },
      // كالسجلّ: حالةٌ تحقّقَ حكمُ الإقلاعِ أنّها المُقَرّةُ لا يُقرأُ غيابُ مجلّدِها محواً.
      provisioning: provisioning || verifiedState,
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
    // R5-B-07: مُتحقِّقُ الأمرِ الملكيِّ يُشتَقُّ من مفتاحِ HSM العامِّ،
    // لا من callback اختياري. لا يُمرَّرُ `() => true` إطلاقاً.
    // `WL-302`: والمُحقِّقُ المحقونُ لا يُقبَلُ دالّةً مُرتجَلةً (‏`() => true`):
    // يلزمُ أن يكونَ مبنيّاً بـ`createRoyalCommandVerifier` **على مفتاحِ الملكِ
    // نفسِه في التوكن** — وإلّا فالحقنُ مسارٌ جانبيٌّ إلى السلطةِ السياديّة.
    // `LIVE-24` (‏`WL-303`): المفتاحُ الملكيُّ مصدرُه مُعلَنٌ مثبَّتٌ خارجَ التوكن، ويُرَدُّ
    // الإقلاعُ إن كانَ هو مفتاحَ المرساةِ أو الدفترِ — فلا تأمرُ العُقدةُ نفسَها بمفتاحِها.
    // وخارجَ الإنتاجِ وحدَه يُسقَطُ إلى مفتاحِ المرساةِ (‏التركيبُ القديمُ للاختبارات).
    const pinnedRoyalPem = loadPinnedRoyalPublicKey(env);
    const royalPublicKeyPem = pinnedRoyalPem ?? signers.anchorSigner.publicKeyPem;
    const royalFingerprint = royalKeyFingerprint(royalPublicKeyPem);
    if (
      pinnedRoyalPem !== null &&
      (royalFingerprint === royalKeyFingerprint(signers.anchorSigner.publicKeyPem) ||
        royalFingerprint === royalKeyFingerprint(signers.ledgerSigner.publicKeyPem))
    ) {
      throw new ProductionBootError('ROYAL_KEY_NOT_SEPARATED', 'XUUX_ROYAL_PUBLIC_KEY_PEM');
    }
    const anchorFingerprint = royalFingerprint;
    if (options.royalCommandVerifier !== undefined && options.royalCommandVerifier !== null) {
      const injected = trustedRoyalVerifierFingerprint(options.royalCommandVerifier);
      if (injected === null || injected !== anchorFingerprint) {
        throw new ProductionRuntimeError(
          'ROYAL_COMMAND_VERIFIER_UNTRUSTED',
          injected === null
            ? 'مُحقِّقٌ محقونٌ غيرُ مبنيٍّ بـcreateRoyalCommandVerifier'
            : 'مُحقِّقٌ محقونٌ على مفتاحٍ غيرِ المفتاحِ الملكيِّ المُثبَّت',
        );
      }
    }
    const royalCommandVerifier =
      options.royalCommandVerifier ?? createRoyalCommandVerifier(royalPublicKeyPem);
    const haltSwitch = new HaltSwitch(
      join(options.root, 'halt', 'directive.json'),
      signers.anchorSigner as unknown as HaltAsyncSigner,
      {
        fsync,
        log: null,
        logAsync: log,
        epochFloor,
        sealEpoch: (): Promise<void> =>
          inCommitTransaction(coordinator) ? Promise.resolve() : manifest.checkpointAsync(),
        commitBarrier: coordinator,
        royalCommandVerifier,
        env,
      },
    );
    const revocationStore =
      options.revocationStore ??
      new FileRevocationStore(join(options.root, 'revoked.jsonl'), { fsync });
    const anchorStore = options.anchorStore ?? new FileAnchorStore(anchorFile, { fsync });
    log.useCommitBarrier(coordinator);
    ledger.useCommitBarrier(coordinator);
    // آخرُ خطوةٍ في الإقلاع: بعدَها لا كتابةَ حالةٍ إلّا عبرَ الحاجز (‏`D6`).
    coordinator.activate();
    const anchorAsync = (anchorOptions: { force?: boolean; intervalMs?: number; at?: Date } = {}) =>
      coordinator.run('anchor', () => {
        const request: {
          witness: MonotonicFloor;
          force?: boolean;
          intervalMs?: number;
          at?: Date;
        } = { witness: manifest.anchoredCountFloor() };
        if (anchorOptions.force !== undefined) request.force = anchorOptions.force;
        if (anchorOptions.intervalMs !== undefined) request.intervalMs = anchorOptions.intervalMs;
        if (anchorOptions.at !== undefined) request.at = anchorOptions.at;
        return maybeAnchorLogWithHsm(anchorStore, signers.anchorSigner, log, request);
      });
    const intents = new RootIntentProcessor({
      root: options.root,
      haltSwitch: haltSwitch as unknown as IntentHaltSwitch,
      anchor: ({ force, intervalMs }) => anchorAsync({ force, intervalMs }),
      anchorVerifier: signers.anchorSigner,
      fsync: options.fsync ?? true,
    });
    return {
      log,
      ledger,
      haltSwitch,
      commitBarrier: coordinator,
      revokeAsync: (certificateId: string, revokedBy: string, reason: string) =>
        coordinator.run('revoke', () => revocationStore.revoke(certificateId, revokedBy, reason)),
      anchorAsync,
      drainIntentsAsync: () => intents.drainAsync(),
      freshnessBoot,
      sealer,
      anchorSigner: signers.anchorSigner,
      ledgerSigner: signers.ledgerSigner,
      royalPublicKeyPem,
      boot: signers.boot,
      manifest,
      raiseAnchorWitness: (count: number) => manifest.raise('anchoredCount', count),
      // R4-K3-03: مخزنُ سحبٍ دائمٌ على القرص — يُبنى من `FileRevocationStore`
      // ليُمرَّرَ إلى سلطةِ التصديقِ في الإنتاج. لا يُقبلُ `MemoryRevocationStore`
      // في الإنتاج، وهذا التنفيذُ يدومُ عبرَ إعادةِ التشغيل.
      revocationStore,
      close: async (): Promise<void> => {
        coordinator.close();
        log.close();
        await signers.close();
      },
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
 * يردُّ الإقلاعَ على **جذرٍ قائمٍ** إذا غابَ السجلُّ المختومُ أو غابَ رأسُه.
 *
 * `S13` (الجولةُ السادسةُ من `M11.04`، `WL-237`): خصمٌ يملكُ القرصَ كانَ يستعيدُ
 * بياناً مختوماً أقدمَ **ويمحو السجلَّ** ورأسَه، فيُقلِعُ الجذرُ بلا شاهدٍ ثانٍ
 * فترجعُ عدّاداتُ `ledgerCommitted`/`haltEpoch` ويُقبَلُ أمرٌ ثُبِّتَ سابقاً ثانيةً.
 * وشواهدُ `WL-184`/`R5-A-01` تُقرأُ من السجلِّ نفسِه، فمحوُه يُسقِطُها صامتةً:
 * **غيابُ الشاهدِ كانَ يُقرأُ صفراً لا تناقضاً.** فهذا الحارسُ يجعلُه تناقضاً
 * مُسمّىً يَرُدُّ الإقلاعَ، على نمطِ `LEDGER_STATE_ROOT_MISSING` نفسِه (‏`UF-13`).
 *
 * **والرأسُ مفحوصٌ معَ الملفِّ لا بعدَه:** قِيسَ أنَّ فحصَ الوجودِ وحدَه يُتجاوَزُ
 * بتركِ `events.log` فارغاً بلا رأسٍ بدلَ حذفِه (سيناريو «سجلٌّ فارغٌ» في
 * `docs/external-review/evidence/M11.04-s13-fix-genesis-window-probe.mjs`).
 *
 * **حدُّ الشرعيّةِ مقيسٌ لا مُفترَضٌ:** التهيئةُ الأولى تكتبُ البيانَ قبلَ إنشاءِ
 * السجلِّ، فانقطاعٌ بينهما يتركُ بياناً بلا سجلٍّ **شرعيّاً**. ولذلكَ لا يُفحَصُ
 * إلا حينَ لم يكنِ الإقلاعُ تهيئةً أولى (‏`provisioning === false`، وهو محسوبٌ من
 * وجودِ البيانِ **قبلَ** كتابتِه في هذا الإقلاعِ). وقِيسَ أنَّ جذرَ الانقطاعِ ذاكَ
 * مرفوضٌ اليومَ أصلاً بـ`LEDGER_STATE_ROOT_MISSING` (مجلَّدُ الحجوزاتِ لم يُنشَأْ
 * بعدُ)، فلا يُمنَعُ بهذا الحارسِ إقلاعٌ شرعيٌّ كانَ ينجحُ من قبلُ — يتغيَّرُ **اسمُ**
 * الرفضِ على ذاكَ الجذرِ وحدَه لا كونُه مرفوضاً.
 *
 * **وحدٌّ مُعلَنٌ:** هذا يسدُّ «بياناً حاضراً بلا سجلٍّ» وحدَه. أمّا لقطةٌ كاملةٌ
 * متّسقةٌ (بيانٌ **وسجلٌّ** أقدمُ معاً) فتبقى خارجَ هذا الحارسِ وداخلَ الحدِّ
 * المُعلَنِ في `docs/adr/0006-state-manifest-seal-and-anti-rollback-limit.md`،
 * فلا تُغلَقُ به `R4-K3-01`.
 *
 * @param file - مسارُ سجلِّ الوقائعِ المتوقَّعِ
 * @param provisioning - هل هذا الإقلاعُ تهيئةٌ أولى؟ (لا بيانَ على القرصِ قبلَه)
 * @param env - البيئةُ، تُمرَّرُ صريحةً لا تُستنبَطُ من العمليةِ
 * @throws {ProductionRuntimeError} `LOG_STATE_ROOT_MISSING` على جذرٍ قائمٍ بلا سجلٍّ أو بلا رأسٍ
 */
export function assertSealedLogPresentOnExistingRoot(
  file: string,
  provisioning: boolean,
  env: NodeJS.ProcessEnv,
): void {
  if (!isProductionRuntime(env)) return;
  // تهيئةٌ أولى: السجلُّ لم يُنشَأْ بعدُ، وغيابُه هو الحالُ الطبيعيُّ لا محوٌ.
  if (provisioning) return;
  // قراءةٌ بلا قفلٍ ولا كتابةٍ: الفحصُ لا يكونُ تغييراً للمفحوصِ، ولا يأخذُ
  // قفلَ الكاتبِ الواحدِ الذي يأخذُه فتحُ السجلِّ.
  const inspection = inspectEventLog(file);
  if (!inspection.exists) {
    throw new ProductionRuntimeError('LOG_STATE_ROOT_MISSING', file);
  }
  if (inspection.head === null) {
    throw new ProductionRuntimeError('LOG_STATE_ROOT_MISSING', file + LOG_HEAD_SUFFIX);
  }
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

/** محجورٌ كما يُعادُ بناؤه من السجلِّ المختوم (‏شكلُ `QuarantineWarden.restore`). */
export interface WitnessedQuarantine {
  subject: string;
  kind: string;
  incidentId: string;
  at: string;
}

/**
 * يُعيدُ بناءَ **حالةِ الحجرِ القائمةِ** من السجلِّ المختومِ (‏`R6-A-05`، `WL-305`).
 *
 * الثابتُ المنتهَكُ قبلَ الإصلاح: الحاجبُ يحفظُ المحجورينَ في الذاكرةِ، و`restore`
 * موجودٌ ولا يناديه التركيبُ الإنتاجيُّ — فإعادةُ التشغيلِ تُخرجُ المحجورَ من الحجرِ
 * بلا قرارٍ ولا سببٍ مسجَّل، والسجلُّ المختومُ نفسُه يشهدُ بـ`quarantine.isolated`.
 * فيُقرأُ الشاهدُ بترتيبِه: `quarantine.isolated`/`quarantine.restored` يُدخِلُ،
 * و`quarantine.released` يُخرِج. والفاعلُ في السجلِّ هو الموضوعُ المحجور.
 *
 * فشلُ فكِّ ختمِ واقعةِ حجرٍ يُرفَعُ برمزٍ نطاقيٍّ: واقعةُ حجرٍ لا يُقرأُ جسمُها لا
 * تُسقَطُ فيُطلَقَ صاحبُها.
 * **حدٌّ مُعلَنٌ:** من استرجعَ السجلَّ كلَّه إلى لقطةٍ أقدمَ متّسقةٍ لا يردُّه هذا
 * الفحصُ — ذاك `EXT-6`.
 * @param log - السجلُّ المحمَّلُ من القرص
 * @returns المحجورونَ الآن بحسبِ السجلّ، مرتّبينَ بأوّلِ دخول
 */
export async function quarantineFromSealedLog(
  log: PersistentEventLog,
): Promise<WitnessedQuarantine[]> {
  const current = new Map<string, WitnessedQuarantine>();
  for (const event of log.events) {
    const type = (event as { type?: unknown }).type;
    if (
      type !== 'quarantine.isolated' &&
      type !== 'quarantine.restored' &&
      type !== 'quarantine.released'
    ) {
      continue;
    }
    const subject = (event as { actor?: unknown }).actor;
    if (typeof subject !== 'string' || subject === '') {
      throw new ProductionRuntimeError(
        'PRODUCTION_QUARANTINE_WITNESS_UNREADABLE',
        String((event as { id?: unknown }).id ?? ''),
      );
    }
    if (type === 'quarantine.released') {
      current.delete(subject);
      continue;
    }
    let body: unknown;
    try {
      body = log.sealed ? await log.openEvent(event) : (event as { data?: unknown }).data;
    } catch {
      throw new ProductionRuntimeError(
        'PRODUCTION_QUARANTINE_WITNESS_UNREADABLE',
        String((event as { id?: unknown }).id ?? ''),
      );
    }
    const record = (body ?? {}) as { kind?: unknown; incidentId?: unknown };
    if (typeof record.kind !== 'string' || record.kind === '') {
      throw new ProductionRuntimeError(
        'PRODUCTION_QUARANTINE_WITNESS_UNREADABLE',
        String((event as { id?: unknown }).id ?? ''),
      );
    }
    if (current.has(subject)) continue;
    const at = (event as { at?: unknown; timestamp?: unknown }).at;
    current.set(subject, {
      subject,
      kind: record.kind,
      incidentId: typeof record.incidentId === 'string' ? record.incidentId : '',
      at: typeof at === 'string' ? at : '',
    });
  }
  return [...current.values()];
}
/** شاهدُ منحٍ مُعادُ بناؤُهُ من السجلِّ المختومِ: قيدُ الشاهدِ لكلِّ معرفِ منحٍ. */
export interface WitnessedCapabilityGrant {
  granted: {
    id: string;
    agentId: string;
    capability: string;
    grantedBy: string;
    grantorRole: string;
    grantedAt: string;
    expiresAt: string;
    reason: string;
  };
  revoked: { revokedAt: string; reason: string } | null;
}

/**
 * يعيدُ بناءَ شاهدِ منحِ القدراتِ من السجلِّ المختومِ (`WL-361`، تتمّةُ `R6-A-05`).
 *
 * **الدافعةُ:** ملفُّ `capability-grants.json` على القرصِ كانَ خارجَ بصمةِ الحالةِ المختومةِ،
 * فاسترجاعُهُ لم يُثبِتْ أنّ كلَّ منحةٍ صدرتْ فعلاً عن مانحٍ مخوَّلٍ — كانَ بالإمكانِ تعديلُ
 * الملفِّ يدوياً وإدخالُ منحةٍ مزوَّرةٍ سليمةِ البنيةِ. الآنَ كلُّ منحٍ لا تُقبَلُ بعدَ
 * الإقلاعِ إلا بشاهدٍ مختومٍ يقولُها.
 *
 * يُقرأُ الترتيبُ `capability.granted`/`capability.revoked` من `log.events` ويُفكُّ جسمُ المختومِ
 * بـ`openEvent`. الفشلُ في فكِّ ختمِ واقعةِ منحٍ أو عدمُ صلاحيةِ حقولِها يُرفَعُ برمزٍ نطاقيٍّ
 * (`PRODUCTION_GRANTS_WITNESS_UNREADABLE`) — لا يُسقَطُ القيدُ فيُقبَلَ ملفٌّ بلا شاهدٍ.
 *
 * **حدٌّ مُعلَنٌ:** من استرجعَ السجلَّ كلَّهُ إلى لقطةٍ أقدمَ متّسقةٍ لا يردُّهُ هذا الفحصُ —
 * ذاك `EXT-6` (انظر `docs/THREAT_MODEL.md`).
 * @param log - السجلُّ المحمَّلُ من القرص
 * @returns شاهدُ كلِّ منحةٍ قيدها في السجلّ
 */
export async function grantsFromSealedLog(
  log: PersistentEventLog,
): Promise<Map<string, WitnessedCapabilityGrant>> {
  const current = new Map<string, WitnessedCapabilityGrant>();
  for (const event of log.events) {
    const type = (event as { type?: unknown }).type;
    if (type !== 'capability.granted' && type !== 'capability.revoked') {
      continue;
    }
    const subject = (event as { actor?: unknown }).actor;
    if (typeof subject !== 'string' || subject === '') {
      throw new ProductionRuntimeError(
        'PRODUCTION_GRANTS_WITNESS_UNREADABLE',
        String((event as { id?: unknown }).id ?? ''),
      );
    }
    let body: unknown;
    try {
      body = log.sealed ? await log.openEvent(event) : (event as { data?: unknown }).data;
    } catch {
      throw new ProductionRuntimeError(
        'PRODUCTION_GRANTS_WITNESS_UNREADABLE',
        String((event as { id?: unknown }).id ?? ''),
      );
    }
    const record = (body ?? {}) as Record<string, unknown>;
    const grantId = record.id;
    if (typeof grantId !== 'string' || grantId === '') {
      throw new ProductionRuntimeError(
        'PRODUCTION_GRANTS_WITNESS_UNREADABLE',
        String((event as { id?: unknown }).id ?? ''),
      );
    }
    if (type === 'capability.revoked') {
      const witnessed = current.get(grantId);
      if (witnessed === undefined) {
        // سحبٌ بلا منحٍ سابقٍ في السجلِّ: تزويرٌ — لا يُوسِّعُ ولا يُضيِّقُ سوى الرفضِ.
        throw new ProductionRuntimeError('PRODUCTION_GRANTS_WITNESS_UNREADABLE', grantId);
      }
      witnessed.revoked = {
        revokedAt: typeof record.revokedAt === 'string' ? record.revokedAt : '',
        reason: typeof record.reason === 'string' ? record.reason : '',
      };
      continue;
    }
    if (current.has(grantId)) {
      throw new ProductionRuntimeError('PRODUCTION_GRANTS_WITNESS_UNREADABLE', grantId);
    }
    const grantedAt = record.grantedAt;
    const expiresAt = record.expiresAt;
    if (
      typeof grantedAt !== 'string' ||
      typeof expiresAt !== 'string' ||
      grantedAt === '' ||
      expiresAt === ''
    ) {
      throw new ProductionRuntimeError('PRODUCTION_GRANTS_WITNESS_UNREADABLE', grantId);
    }
    current.set(grantId, {
      granted: {
        id: grantId,
        agentId: typeof record.agentId === 'string' ? record.agentId : '',
        capability: typeof record.capability === 'string' ? record.capability : '',
        grantedBy: typeof record.grantedBy === 'string' ? record.grantedBy : '',
        grantorRole: typeof record.grantorRole === 'string' ? record.grantorRole : '',
        grantedAt,
        expiresAt,
        reason: typeof record.reason === 'string' ? record.reason : '',
      },
      revoked: null,
    });
  }
  return current;
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
        // LIVE-32 (WL-320): الإرجاعُ المبكّرُ بعدَ الفشلِ كانَ يتخطّى `finally`
        // فيبقى `pending` يتضخّمُ بكلِّ قيدٍ تالٍ. صارَ `finally` يُغطّي كلا المسارين.
        try {
          if (failures.length > 0) return;
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
