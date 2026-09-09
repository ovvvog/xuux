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
import type { LedgerDecisionSigner } from './command-ledger.mjs';
import { HaltSwitch } from './halt-switch.mjs';
import type { HaltAsyncSigner } from './halt-switch.mjs';
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
  describeRootOfTrustBoot,
  isProductionRuntime,
} from './production-boot.mjs';

/** أخطاءُ المصنعِ الإنتاجيّ، مثبَّتةٌ نصاً كي تُختبرَ ولا تُخمَّن. */
export const ProductionRuntimeErrorCodes = [
  'PRODUCTION_RUNTIME_REQUIRES_HSM',
  'PRODUCTION_RUNTIME_ROOT_MISSING',
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
 * @param store - مخزنُ التثبيتات
 * @param signer - موقّعُ F06
 * @param log - السجلُّ المقروء
 * @param options - الفترةُ وأقلُّ جديدٍ والإجبارُ واللحظة
 * @returns التثبيتُ إن وقع، أو `null` إن لم يستحقّ
 */
export async function maybeAnchorLogWithHsm(
  store: AnchorStore,
  signer: HsmSigner,
  log: AnchorableLog,
  options: { intervalMs?: number; minNewEvents?: number; force?: boolean; at?: Date } = {},
): Promise<AnchorRecord | null> {
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
  return anchorLogWithHsm(store, signer, log, at);
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
  try {
    const sealer = signers.sealer;
    const fsync = options.fsync ?? true;
    const log = new PersistentEventLog(join(options.root, 'events.log'), {
      sealer,
      env,
      fsync,
    });
    const ledger = new CommandLedger(join(options.root, 'commands.ledger'), {
      signer: signers.ledgerSigner,
      fsync,
    });
    // مفتاحُ الإيقافِ يأخذُ موقّعَ F06 نفسَه: التوجيهُ قرارٌ ملكيٌّ، ومصدرُه
    // مفتاحُ المملكةِ لا مفتاحُ الدفتر.
    // ولا يُوصَلُ السجلُّ المختومُ سِنكاً لمفتاحِ الإيقاف: `HaltSwitch` يُلحقُ
    // متزامناً، والسجلُّ المختومُ يرفضُ الإلحاقَ المتزامنَ بحقٍّ. وتاريخُ
    // التوجيهاتِ موقَّعٌ ومسلسلٌ في ملفِّه، فالتدقيقُ لا يفقدُ شيئاً.
    const haltSwitch = new HaltSwitch(
      join(options.root, 'halt', 'directive.json'),
      signers.anchorSigner as unknown as HaltAsyncSigner,
      { fsync, log: null },
    );
    return {
      log,
      ledger,
      haltSwitch,
      sealer,
      anchorSigner: signers.anchorSigner,
      ledgerSigner: signers.ledgerSigner,
      boot: signers.boot,
      close: signers.close,
    };
  } catch (error) {
    // فشلٌ بعدَ فتحِ الجلسةِ يُغلقُها: توكنٌ يبقى مسجَّلَ الدخولِ بعدَ فشلِ
    // الإقلاعِ خطرٌ لا مجردُ تسريبِ موردٍ.
    await signers.close().catch(() => undefined);
    throw error;
  }
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
