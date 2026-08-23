// جذر الثقة — الإيقاف الشامل القابل للتحقق (M2.08).
//
// المشكلة التي يحلّها، بدقة: «الإيقاف الشامل» كان قائماً في **ذاكرة العملية**
// وحدها — `CrownGateway.stop()` يرفع علماً في كائنٍ حيّ، و`ExecutionKernel.stop()`
// يُدخل وضعاً آمناً في كائنٍ آخر. ولكل عملية كائناتها، فإيقافُ عملية لا يوقف
// أختها، وإعادةُ التشغيل تمحو الإيقاف نفسه فتستأنف الدولة العمل بلا إذن. أي أن
// «زر الإيقاف» كان زراً محلياً مؤقتاً، وهو بعينه ما ينقضه معيار هذه الخطوة:
// «عدة عمليات، إيقاف واحد، صفر تنفيذ بعده، ثم استئناف سليم».
//
// ما صار الآن:
//   • **توجيه إيقاف واحد مركزي دائم** على القرص، **موقَّع ملكياً**: من لا يملك
//     مفتاح الملك لا يستأنف الدولة. والتوقيع يجعل الإيقاف قراراً سيادياً لا
//     سطراً يكتبه أي حاملِ صلاحية كتابة.
//   • **كل مُنفِّذ يقرأ التوجيه قبل كل فعل** — لا نسخة في الذاكرة ولا ذاكرة
//     مؤقتة بعمر: القراءة من القرص في كل فعل هي ما يجعل الإيقاف فورياً على كل
//     العمليات القائمة. الثمن نداءُ نظامٍ لكل فعل، وهو ثمن مقبول لأن البديل
//     نافذةٌ يُنفَّذ فيها فعلٌ بعد الإيقاف.
//   • **الفشل مغلق (fail-closed)**: توجيهٌ تالف، أو توقيعٌ لا يتحقق، أو توجيهٌ
//     محذوف وقد كان موجوداً، أو عهدٌ متراجع ⇒ **الحالة إيقاف**، لا تشغيل. لأن
//     شبهةَ عبثٍ في زرّ الإيقاف تعني أنه لا يُوثق به، والتشغيل حينها أخطر من
//     التوقف. وهذا تطبيقٌ للمادة 9 من القاعدة الحاكمة.
//   • **العهد لا يتراجع** (`epoch`): كل توجيه يحمل رقم عهدٍ يزيد واحداً، مع
//     عدّاد أعلى مستوى مبلوغ على القرص. فإعادةُ توجيهٍ قديم موقَّع بحالة «تشغيل»
//     — وهو هجوم إعادة إرسال على زرّ الإيقاف — تُرفض بـ`STALE_HALT_DIRECTIVE`.
//   • **التوجيهات مترابطة في سجل تاريخ** (`previousDirectiveHash` + ملف تاريخ
//     مُلحَق): فحذفُ توجيهٍ أو دسُّ آخر من فرعٍ ثانٍ يظهر انكساراً، والتوجيه
//     الحالي يجب أن يكون آخرَ سطرٍ في التاريخ.
//   • **تأكيد إيقاف من كل عقدة**: العقدة تُسجَّل، ثم تُقرّ بالإيقاف في العهد
//     الجاري بملفٍ يُنشأ إنشاءً حصرياً. والاستئناف **يُرفض** ما دامت عقدةٌ حيّة
//     لم تُقرّ — فالإيقاف «قابل للتحقق» بالإقرارات لا بالثقة. وعقدةٌ ماتت لا
//     تمنع الاستئناف: موتُها إقرارٌ بأنها لا تُنفِّذ (ويُعلَن كذلك، لا يُخفى).
//   • **أقل امتياز**: العقدة تحمل **المفتاح العام وحده** فتقرأ وتُقرّ ولا تستطيع
//     إيقافاً ولا استئنافاً (`HALT_SIGNER_REQUIRED`). فمن يملك عقدة لا يملك
//     الدولة.
//
// ما لا يفعله (معلَن، لا مضمر):
//   • **ذرّيته ذرّية نظام ملفات واحد**: عبر آلات يحتاج مخزناً مشتركاً بضمانٍ
//     ذرّي، وهو قرار نشرٍ موضعه M5 لا قرار وحدة. وحتى ذلك الحين «كل عقدة» تعني
//     كل عقدة تشترك في هذا المسار.
//   • **لا يُجهض فعلاً جارياً**: يمنع بدءَ فعلٍ جديد. مقاطعة فعلٍ في منتصفه
//     تحتاج نقاط إجهاض داخل المُعالِجات نفسها، وهي في M5.
//   • **لا يمنع من يملك القرص والمفتاح معاً**، ولا من يعطّل العملية عن القراءة
//     أصلاً (منعُ ذلك يحتاج عزلاً وصلاحيات نظام، وهي في M10).
//   • **لا زمن موثوق**: `at` معلوماتيّ للتدقيق، والقرار كله على العهد لا الوقت.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fingerprint } from './identity.mjs';

/** لاحقة مجلد الإقرارات: ملفٌ لكل عقدة في كل عهد، وإنشاؤه الحصري هو ذرّيته. */
export const HALT_ACKS_SUFFIX = '.acks';

/** لاحقة مجلد العقد المسجَّلة: من يجب أن يُقرّ حتى يصير الإيقاف متحقَّقاً منه. */
export const HALT_NODES_SUFFIX = '.nodes';

/** لاحقة عدّاد أعلى عهدٍ بُلغ — وهو ما يمنع إعادة توجيهٍ قديم. */
export const HALT_EPOCH_SUFFIX = '.epoch';

/** لاحقة تاريخ التوجيهات المُلحَق: كل توجيه صدر، بترتيب صدوره. */
export const HALT_HISTORY_SUFFIX = '.history';

/** رابط أول توجيه: لا سابق له، فيُصرَّح بذلك بدل تركه فارغاً. */
export const GENESIS_DIRECTIVE_HASH = 'GENESIS_HALT';

/** حالتا الدولة: تعمل أو موقوفة. ولا حالة ثالثة صامتة. */
export const HaltStates = ['running', 'halted'] as const;

export type HaltState = (typeof HaltStates)[number];

/** المادة التي تُوقَّع. كل ما يُحتجّ به لاحقاً يجب أن يكون داخلها. */
export interface HaltDirectiveBody {
  version: 1;
  /** عهدُ التوجيه، يزيد واحداً في كل إصدار ولا يتراجع أبداً. */
  epoch: number;
  state: HaltState;
  reason: string;
  at: string;
  kingId: string;
  /** إصدار مفتاح الملك الذي وقّع — قيدُ `M2.04`. */
  keyVersion: number;
  /** تجزئة التوجيه السابق، أو `GENESIS_HALT`. */
  previousDirectiveHash: string;
}

/** توجيه مكتمل: مادته، وتجزئتها، وتوقيع الملك عليها. */
export interface HaltDirective extends HaltDirectiveBody {
  hash: string;
  signature: string;
}

/** أعطاب القراءة. كلها تُفضي إلى حالة «موقوف»، فالفشل مغلق لا مفتوح. */
export const HaltProblems = [
  'HALT_DIRECTIVE_MISSING',
  'CORRUPT_HALT_DIRECTIVE',
  'HALT_HASH_MISMATCH',
  'HALT_SIGNATURE_INVALID',
  'HALT_KEY_VERSION_MISMATCH',
  'STALE_HALT_DIRECTIVE',
  'HALT_HISTORY_MISMATCH',
  'HALT_LINK_MISMATCH',
] as const;

export type HaltProblem = (typeof HaltProblems)[number];

/** أخطاء العمليات (لا نتائج القراءة)، مثبَّتة نصاً كي تُختبر ولا تُخمَّن. */
export const HaltErrorCodes = [
  'SOVEREIGN_HALT',
  'HALT_NOT_HALTED',
  'HALT_ALREADY_HALTED',
  'HALT_NOT_CONFIRMED',
  'UNKNOWN_HALT_NODE',
  'INVALID_HALT_NODE',
  'HALT_SIGNER_REQUIRED',
] as const;

export type HaltErrorCode = (typeof HaltErrorCodes)[number];

/** خطأ الإيقاف: رسالته هي رمزه، وتفاصيله في حقول تُقرأ برمجياً لا من نص. */
export class HaltError extends Error {
  code: HaltErrorCode;
  /** سبب الإيقاف المعلَن في التوجيه، حين يكون الرفض بسببه. */
  reason?: string;
  /** عطب القراءة الذي أغلق الباب، إن كان الرفض فشلاً مغلقاً. */
  problem?: HaltProblem;
  epoch?: number;
  /** العقد الحيّة التي لم تُقرّ، حين يكون الرفض بسببها. */
  pending?: string[];
  detail?: string;

  /**
   * @param code - رمز الخطأ
   * @param extra - السبب والعطب والعهد والعقد المعلَّقة وتفصيل برمجي
   */
  constructor(
    code: HaltErrorCode,
    extra: {
      reason?: string;
      problem?: HaltProblem;
      epoch?: number;
      pending?: string[];
      detail?: string;
    } = {},
  ) {
    super(code);
    this.name = 'HaltError';
    this.code = code;
    if (extra.reason !== undefined) this.reason = extra.reason;
    if (extra.problem !== undefined) this.problem = extra.problem;
    if (extra.epoch !== undefined) this.epoch = extra.epoch;
    if (extra.pending !== undefined) this.pending = extra.pending;
    if (extra.detail !== undefined) this.detail = extra.detail;
  }
}

/**
 * أقلّ ما تحتاجه العقدة: تحققٌ ومعرّف. ولا توقيع — وهذا هو أقل الامتياز بعينه:
 * عقدةٌ تقرأ وتُقرّ ولا تستطيع أن تُوقف الدولة ولا أن تستأنفها.
 */
export interface HaltVerifier {
  id: string;
  verify(payload: object, signature: string): boolean;
  /** إن وُجدت، أُخذ منها رقم الإصدار الذي قَبِل التوقيع (هوية متعايشة). */
  verifyingVersion?(payload: object, signature: string): number | null;
  /** إن وُجد، فهو الإصدار الذي يوقّع الآن. */
  activeVersion?: number;
}

/** من يملك إصدار التوجيهات: متحقّقٌ يستطيع التوقيع كذلك. */
export interface HaltSigner extends HaltVerifier {
  sign(payload: object): string;
}

/** أقلّ ما يُحتاج من سجل الأحداث؛ كُتب واجهةً كي لا تعتمد الوحدة على صنف بعينه. */
export interface HaltEventSink {
  append(type: string, actor: string, data: object): unknown;
}

/** ما يحتاجه كل مُنفِّذ من هذه الوحدة: سطرٌ واحد يرفع الإيقاف اعتراضاً. */
export interface HaltGuard {
  assertOperational(): void;
}

/** نتيجة قراءة التوجيه: الحالة، ومعها العطب إن كان الإغلاق فشلاً مغلقاً. */
export interface HaltReading {
  state: HaltState;
  epoch: number;
  reason: string;
  at: string | null;
  directive: HaltDirective | null;
  problem?: HaltProblem;
  detail?: string;
}

/** عقدة مسجَّلة: من هي، وأي عملية تحملها، ومتى سُجّلت. */
export interface HaltNodeRecord {
  nodeId: string;
  pid: number;
  at: string;
}

/** إقرار عقدة بالتوقف في عهدٍ بعينه. */
export interface HaltConfirmation {
  nodeId: string;
  epoch: number;
  pid: number;
  at: string;
  detail?: string;
}

/** عقدة لم تُقرّ بعد، ومعها حياتها — والميتة لا تمنع الاستئناف. */
export interface PendingConfirmation {
  nodeId: string;
  pid: number;
  alive: boolean;
}

/** خيارات المفتاح: مزامنة القرص، وسجل أحداث اختياري للتدقيق. */
export interface HaltSwitchOptions {
  /** مزامنة القرص بعد كل كتابة. تعطيلها يُسرّع ويُضعف الضمان. */
  fsync?: boolean;
  log?: HaltEventSink | null;
}

/** خلاصة تشغيلية للأداة والتدقيق. */
export interface HaltDescription {
  state: HaltState;
  epoch: number;
  reason: string;
  at: string | null;
  problem?: HaltProblem;
  nodes: HaltNodeRecord[];
  confirmed: string[];
  pending: PendingConfirmation[];
  fullyConfirmed: boolean;
}

/**
 * يجزّئ مادة التوجيه. الترتيب مثبَّت بالبناء لا بترتيب الحقول في الشيفرة، كي لا
 * تكسر إعادةُ ترتيب حقلٍ تجزئةَ توجيهاتٍ محفوظة.
 * @param body - مادة التوجيه
 * @returns تجزئة SHA-256 بترميز ست عشري
 */
export function hashHaltBody(body: HaltDirectiveBody): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        body.version,
        body.epoch,
        body.state,
        body.reason,
        body.at,
        body.kingId,
        body.keyVersion,
        body.previousDirectiveHash,
      ]),
    )
    .digest('hex');
}

/**
 * يستخرج إصدار المفتاح الذي يوقّع الآن. هويةٌ بلا تدوير إصدارها 1 حكماً.
 * @param king - الموقّع أو المتحقّق
 * @returns رقم الإصدار
 */
export function haltKeyVersion(king: HaltVerifier): number {
  return king.activeVersion ?? 1;
}

/**
 * يبني متحقّقاً من المفتاح العام وحده — وهو ما تحمله العقدة في التشغيل: تقرأ
 * التوجيه وتتحقق منه ولا تستطيع إصداره.
 * @param publicKeyPem - المفتاح العام بترميز PEM
 * @returns متحقّق بلا قدرة توقيع
 */
export function royalVerifierFromPublicKey(publicKeyPem: string): HaltVerifier {
  const publicKey = createPublicKey(publicKeyPem);
  return {
    id: 'king:' + fingerprint(publicKey).slice(0, 24),
    verify(payload: object, signature: string): boolean {
      return verifySignature(
        null,
        Buffer.from(JSON.stringify(payload)),
        publicKey,
        Buffer.from(signature, 'base64url'),
      );
    },
  };
}

/**
 * ينتزع مادة التوجيه من سجلٍ مكتمل — نفس المادة التي وُقّعت لا نسخة منها.
 * @param directive - التوجيه المكتمل
 * @returns المادة الموقَّعة
 */
function bodyOf(directive: HaltDirective): HaltDirectiveBody {
  return {
    version: directive.version,
    epoch: directive.epoch,
    state: directive.state,
    reason: directive.reason,
    at: directive.at,
    kingId: directive.kingId,
    keyVersion: directive.keyVersion,
    previousDirectiveHash: directive.previousDirectiveHash,
  };
}

/**
 * مفتاح الإيقاف الشامل: علامة مركزية دائمة موقَّعة، يقرأها كل مُنفِّذ قبل كل
 * فعل، وتُقرّ بها كل عقدة قبل أن يُسمح بالاستئناف.
 */
export class HaltSwitch implements HaltGuard {
  file: string;
  acksDir: string;
  nodesDir: string;
  epochFile: string;
  historyFile: string;
  king: HaltVerifier;

  #fsync: boolean;
  #log: HaltEventSink | null;

  /**
   * @param file - مسار ملف التوجيه الدائم
   * @param king - الملك: متحقّقٌ للعقد، وموقّعٌ لمن يُصدر
   * @param options - المزامنة وسجل الأحداث
   */
  constructor(file: string, king: HaltVerifier, options: HaltSwitchOptions = {}) {
    this.file = file;
    this.acksDir = file + HALT_ACKS_SUFFIX;
    this.nodesDir = file + HALT_NODES_SUFFIX;
    this.epochFile = file + HALT_EPOCH_SUFFIX;
    this.historyFile = file + HALT_HISTORY_SUFFIX;
    this.king = king;
    this.#fsync = options.fsync ?? true;
    this.#log = options.log ?? null;
    mkdirSync(dirname(file), { recursive: true });
    mkdirSync(this.acksDir, { recursive: true });
    mkdirSync(this.nodesDir, { recursive: true });
  }

  /**
   * يقرأ التوجيه من القرص في كل نداء — بلا ذاكرة مؤقتة، لأن عملية أخرى قد
   * تكون أوقفت الدولة قبل جزء من الثانية. وكل عطبٍ يُفضي إلى «موقوف».
   * @returns الحالة الفعلية الآن
   */
  read(): HaltReading {
    const highWater = this.#readEpoch();
    if (!existsSync(this.file)) {
      // غياب التوجيه أصلاً ليس عبثاً: دولةٌ لم تُوقف يوماً. أما غيابه مع وجود
      // أثرٍ لتوجيه سابق (عهدٌ أو تاريخ) فهو محوٌ لزرّ الإيقاف ⇒ يُغلق الباب.
      if (highWater > 0 || existsSync(this.historyFile)) {
        return this.#closed('HALT_DIRECTIVE_MISSING', highWater, `آخر عهد ${highWater}`);
      }
      return { state: 'running', epoch: 0, reason: 'لا توجيه', at: null, directive: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return this.#closed('CORRUPT_HALT_DIRECTIVE', highWater, 'تعذّر تحليل التوجيه');
    }
    const directive = this.#asDirective(parsed);
    if (directive === null) {
      return this.#closed('CORRUPT_HALT_DIRECTIVE', highWater, 'حقول التوجيه ناقصة');
    }
    const body = bodyOf(directive);
    if (directive.hash !== hashHaltBody(body)) {
      return this.#closed('HALT_HASH_MISMATCH', directive.epoch);
    }
    const acceptedBy = this.king.verifyingVersion
      ? this.king.verifyingVersion(body, directive.signature)
      : this.king.verify(body, directive.signature)
        ? haltKeyVersion(this.king)
        : null;
    if (acceptedBy === null) {
      return this.#closed('HALT_SIGNATURE_INVALID', directive.epoch);
    }
    if (acceptedBy !== directive.keyVersion) {
      return this.#closed(
        'HALT_KEY_VERSION_MISMATCH',
        directive.epoch,
        `يزعم ${directive.keyVersion} وقَبِله ${acceptedBy}`,
      );
    }
    if (directive.epoch < highWater) {
      return this.#closed(
        'STALE_HALT_DIRECTIVE',
        directive.epoch,
        `عهد ${directive.epoch} وقد بُلغ ${highWater}`,
      );
    }
    // التوجيه الحالي يجب أن يكون آخرَ ما صدر: وإلا فقد أُعيد توجيهٌ سابق موقَّع
    // بعد محو العدّاد، وهو هجوم إعادة إرسال لا خطأ قراءة.
    const last = this.#lastHistoryHash();
    if (last !== null && last !== directive.hash) {
      return this.#closed('HALT_HISTORY_MISMATCH', directive.epoch, 'ليس آخر توجيه في التاريخ');
    }
    if (directive.epoch > highWater) this.#writeEpoch(directive.epoch);
    return {
      state: directive.state,
      epoch: directive.epoch,
      reason: directive.reason,
      at: directive.at,
      directive,
    };
  }

  /**
   * يقول إن كانت الدولة موقوفة الآن.
   * @returns الإيقاف
   */
  isHalted(): boolean {
    return this.read().state === 'halted';
  }

  /**
   * الحاجز الذي يُنادى **قبل كل فعل**: يرفع `SOVEREIGN_HALT` إن كانت الدولة
   * موقوفة، ومعه سببها والعطب إن كان الإغلاق فشلاً مغلقاً.
   */
  assertOperational(): void {
    const reading = this.read();
    if (reading.state !== 'halted') return;
    const extra: { reason: string; epoch: number; problem?: HaltProblem } = {
      reason: reading.reason,
      epoch: reading.epoch,
    };
    if (reading.problem !== undefined) extra.problem = reading.problem;
    throw new HaltError('SOVEREIGN_HALT', extra);
  }

  /**
   * يُصدر إيقافاً شاملاً: توجيهٌ موقَّع بعهدٍ جديد يمنع كل فعلٍ في كل عقدة.
   * @param reason - سبب الإيقاف، يُسجَّل ويُعاد في كل رفض
   * @returns التوجيه الصادر
   */
  halt(reason = 'royal sovereign halt'): HaltDirective {
    const current = this.read();
    if (current.state === 'halted' && current.problem === undefined) {
      throw new HaltError('HALT_ALREADY_HALTED', { epoch: current.epoch, reason: current.reason });
    }
    const directive = this.#issue('halted', reason);
    this.#log?.append('halt.issued', directive.kingId, {
      epoch: directive.epoch,
      reason: directive.reason,
    });
    return directive;
  }

  /**
   * يستأنف التشغيل: يُرفض ما دامت عقدةٌ حيّة لم تُقرّ بالتوقف، فالاستئناف لا
   * يقع على ظنٍّ بأن الجميع توقف.
   * @param reason - سبب الاستئناف، يُسجَّل
   * @returns التوجيه الصادر
   */
  resume(reason = 'royal resume'): HaltDirective {
    const current = this.read();
    if (current.state !== 'halted') {
      throw new HaltError('HALT_NOT_HALTED', { epoch: current.epoch });
    }
    // توجيهٌ معطوب: عهدُه مجهول فلا تُشترط إقرارات عهدٍ لا يُعرف رقمه، ويُصدر
    // عهدٌ جديد نظيف. أما التوجيه السليم فيلزمه إقرار كل عقدة حيّة.
    if (current.problem === undefined) {
      const pending = this.pendingConfirmations().filter((node) => node.alive);
      if (pending.length > 0) {
        throw new HaltError('HALT_NOT_CONFIRMED', {
          epoch: current.epoch,
          pending: pending.map((node) => node.nodeId),
        });
      }
    }
    const directive = this.#issue('running', reason);
    this.#log?.append('halt.resumed', directive.kingId, {
      epoch: directive.epoch,
      reason: directive.reason,
      recoveredFrom: current.problem ?? null,
    });
    return directive;
  }

  /**
   * يسجّل عقدة تنفيذ: من يجب أن يُقرّ بالتوقف حتى يصير الإيقاف متحقَّقاً منه.
   * التسجيل يُحدَّث في كل إقلاع لأن رقم العملية يتغير.
   * @param nodeId - معرّف العقدة
   * @param pid - رقم عمليتها
   * @returns سجل العقدة
   */
  registerNode(nodeId: string, pid: number = process.pid): HaltNodeRecord {
    const id = this.#assertNodeId(nodeId);
    const record: HaltNodeRecord = { nodeId: id, pid, at: new Date().toISOString() };
    this.#writeAtomic(join(this.nodesDir, this.#key(id) + '.json'), JSON.stringify(record) + '\n');
    return record;
  }

  /**
   * يشطب تسجيل عقدة توقفت نهائياً، فلا تظل تمنع الاستئناف بعد رجوعها للحياة.
   * @param nodeId - معرّف العقدة
   */
  unregisterNode(nodeId: string): void {
    const id = this.#assertNodeId(nodeId);
    rmSync(join(this.nodesDir, this.#key(id) + '.json'), { force: true });
  }

  /**
   * العقد المسجَّلة ومعها حياتها.
   * @returns العقد مرتَّبة بمعرّفاتها
   */
  nodes(): (HaltNodeRecord & { alive: boolean })[] {
    const records: (HaltNodeRecord & { alive: boolean })[] = [];
    for (const name of readdirSync(this.nodesDir)) {
      if (name.startsWith('.')) continue;
      const record = this.#readJson<HaltNodeRecord>(join(this.nodesDir, name));
      if (record === null || typeof record.nodeId !== 'string') continue;
      records.push({ ...record, alive: this.#pidAlive(record.pid) });
    }
    return records.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  }

  /**
   * إقرار عقدة بالتوقف في العهد الجاري. الإقرار ثابت: نداءٌ ثانٍ لا يُنشئ
   * إقراراً ثانياً ولا يُبدّل وقت الأول، لأن وقت التوقف هو الأول لا الأخير.
   * @param nodeId - معرّف العقدة
   * @param detail - تفصيل تشغيلي يُسجَّل (كعدد الأفعال المرفوضة)
   * @returns الإقرار المحفوظ
   */
  confirmHalt(nodeId: string, detail?: string): HaltConfirmation {
    const id = this.#assertNodeId(nodeId);
    const reading = this.read();
    if (reading.state !== 'halted') {
      throw new HaltError('HALT_NOT_HALTED', { epoch: reading.epoch });
    }
    if (!existsSync(join(this.nodesDir, this.#key(id) + '.json'))) {
      throw new HaltError('UNKNOWN_HALT_NODE', { detail: id });
    }
    const path = this.#ackPath(id, reading.epoch);
    const existing = this.#readJson<HaltConfirmation>(path);
    if (existing !== null) return existing;
    const confirmation: HaltConfirmation = {
      nodeId: id,
      epoch: reading.epoch,
      pid: process.pid,
      at: new Date().toISOString(),
    };
    if (detail !== undefined) confirmation.detail = detail;
    try {
      this.#createExclusive(path, JSON.stringify(confirmation) + '\n');
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
      const raced = this.#readJson<HaltConfirmation>(path);
      if (raced !== null) return raced;
    }
    this.#log?.append('halt.confirmed', id, { epoch: confirmation.epoch });
    return confirmation;
  }

  /**
   * إقرارات عهدٍ بعينه — والافتراض العهد الجاري.
   * @param epoch - العهد المطلوب
   * @returns الإقرارات مرتَّبة بأوقاتها
   */
  confirmations(epoch: number = this.read().epoch): HaltConfirmation[] {
    const found: HaltConfirmation[] = [];
    for (const name of readdirSync(this.acksDir)) {
      if (name.startsWith('.')) continue;
      const record = this.#readJson<HaltConfirmation>(join(this.acksDir, name));
      if (record === null || record.epoch !== epoch) continue;
      found.push(record);
    }
    return found.sort((left, right) => left.at.localeCompare(right.at));
  }

  /**
   * العقد المسجَّلة التي لم تُقرّ بالعهد الجاري.
   * @returns العقد المعلَّقة ومعها حياتها
   */
  pendingConfirmations(): PendingConfirmation[] {
    const epoch = this.read().epoch;
    const confirmed = new Set(this.confirmations(epoch).map((record) => record.nodeId));
    return this.nodes()
      .filter((node) => !confirmed.has(node.nodeId))
      .map((node) => ({ nodeId: node.nodeId, pid: node.pid, alive: node.alive }));
  }

  /**
   * هل تحقّق الإيقاف من كل عقدة؟ العقدة الميتة محسوبة مُقرّة بموتها — وذلك
   * معلَن لا مضمر، لأن عملية غير موجودة لا تُنفّذ فعلاً.
   * @returns تمام التحقق
   */
  isFullyConfirmed(): boolean {
    return this.pendingConfirmations().every((node) => !node.alive);
  }

  /**
   * يتحقق من تاريخ التوجيهات كله: العهود متصلة، والروابط سليمة، والتوقيعات
   * صحيحة، والتوجيه الحالي هو آخرها.
   * @returns النتيجة، ومعها موضع الانكسار وسببه إن وُجد
   */
  verifyHistory(): { ok: boolean; directives: number; problem?: HaltProblem; problemAt?: number } {
    const directives = this.history();
    let previousHash = GENESIS_DIRECTIVE_HASH;
    let previousEpoch = 0;
    for (const [index, directive] of directives.entries()) {
      const at = index + 1;
      const body = bodyOf(directive);
      if (directive.hash !== hashHaltBody(body)) {
        return {
          ok: false,
          directives: directives.length,
          problem: 'HALT_HASH_MISMATCH',
          problemAt: at,
        };
      }
      if (directive.previousDirectiveHash !== previousHash) {
        return {
          ok: false,
          directives: directives.length,
          problem: 'HALT_LINK_MISMATCH',
          problemAt: at,
        };
      }
      if (directive.epoch !== previousEpoch + 1) {
        return {
          ok: false,
          directives: directives.length,
          problem: 'STALE_HALT_DIRECTIVE',
          problemAt: at,
        };
      }
      const accepted = this.king.verifyingVersion
        ? this.king.verifyingVersion(body, directive.signature)
        : this.king.verify(body, directive.signature)
          ? haltKeyVersion(this.king)
          : null;
      if (accepted === null) {
        return {
          ok: false,
          directives: directives.length,
          problem: 'HALT_SIGNATURE_INVALID',
          problemAt: at,
        };
      }
      previousHash = directive.hash;
      previousEpoch = directive.epoch;
    }
    return { ok: true, directives: directives.length };
  }

  /**
   * تاريخ التوجيهات كما هو على القرص. الذيل المقطوع يُتجاوز (انقطاعٌ)، والوسط
   * التالف يبقى ظاهراً في التحقق لا مسكوتاً عنه.
   * @returns التوجيهات بترتيب صدورها
   */
  history(): HaltDirective[] {
    if (!existsSync(this.historyFile)) return [];
    const parts = readFileSync(this.historyFile, 'utf8').split('\n');
    parts.pop();
    const directives: HaltDirective[] = [];
    for (const line of parts) {
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const directive = this.#asDirective(parsed);
      if (directive !== null) directives.push(directive);
    }
    return directives;
  }

  /**
   * خلاصة تشغيلية واحدة للأداة والتدقيق.
   * @returns الحالة والعقد والإقرارات والمعلَّقات
   */
  describe(): HaltDescription {
    const reading = this.read();
    const pending = this.pendingConfirmations();
    const description: HaltDescription = {
      state: reading.state,
      epoch: reading.epoch,
      reason: reading.reason,
      at: reading.at,
      nodes: this.nodes(),
      confirmed: this.confirmations(reading.epoch).map((record) => record.nodeId),
      pending,
      fullyConfirmed: pending.every((node) => !node.alive),
    };
    if (reading.problem !== undefined) description.problem = reading.problem;
    return description;
  }

  /**
   * يُصدر توجيهاً موقَّعاً بعهدٍ يزيد واحداً، ويُلحقه في التاريخ ثم ينشره ذرياً.
   * @param state - الحالة المطلوبة
   * @param reason - سببها
   * @returns التوجيه
   */
  #issue(state: HaltState, reason: string): HaltDirective {
    const signer = this.#assertSigner();
    const previous = this.#lastHistoryHash();
    const epoch = Math.max(this.#readEpoch(), this.history().length) + 1;
    const body: HaltDirectiveBody = {
      version: 1,
      epoch,
      state,
      reason,
      at: new Date().toISOString(),
      kingId: signer.id,
      keyVersion: haltKeyVersion(signer),
      previousDirectiveHash: previous ?? GENESIS_DIRECTIVE_HASH,
    };
    const directive: HaltDirective = {
      ...body,
      hash: hashHaltBody(body),
      signature: signer.sign(body),
    };
    const line = JSON.stringify(directive) + '\n';
    // الترتيب مقصود: العهد يُرفع أولاً، ثم يُلحق التاريخ، ثم يُنشر التوجيه.
    // فالانقطاع في أي موضع يترك حالةً **أشدّ إغلاقاً** لا أوسع: عهدٌ مرفوع
    // بلا توجيه ⇒ `HALT_DIRECTIVE_MISSING` ⇒ موقوف. ولو نُشر التوجيه أولاً
    // لأمكن أن يُقرأ استئنافٌ لم يُثبَّت عهده بعد.
    this.#writeEpoch(epoch);
    this.#appendLine(this.historyFile, line);
    this.#writeAtomic(this.file, line);
    return directive;
  }

  /**
   * يرفع خطأً إن كان الحامل متحقّقاً بلا قدرة توقيع — وهو حال العقدة.
   * @returns الموقّع
   */
  #assertSigner(): HaltSigner {
    const candidate = this.king as Partial<HaltSigner>;
    if (typeof candidate.sign !== 'function') {
      throw new HaltError('HALT_SIGNER_REQUIRED', { detail: this.king.id });
    }
    return this.king as HaltSigner;
  }

  /**
   * يبني قراءةً مغلقة: كل عطب يعني «موقوف» لا «يعمل».
   * @param problem - العطب
   * @param epoch - العهد المعلوم عند العطب
   * @param detail - تفصيل برمجي
   * @returns القراءة المغلقة
   */
  #closed(problem: HaltProblem, epoch: number, detail?: string): HaltReading {
    const reading: HaltReading = {
      state: 'halted',
      epoch,
      reason: `فشل مغلق: ${problem}`,
      at: null,
      directive: null,
      problem,
    };
    if (detail !== undefined) reading.detail = detail;
    return reading;
  }

  /**
   * يضيّق كائناً مقروءاً إلى توجيه، أو يرفضه.
   * @param parsed - الكائن المقروء
   * @returns التوجيه أو `null`
   */
  #asDirective(parsed: unknown): HaltDirective | null {
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<HaltDirective>;
    if (candidate.version !== 1) return null;
    if (typeof candidate.epoch !== 'number' || !Number.isInteger(candidate.epoch)) return null;
    if (candidate.state !== 'halted' && candidate.state !== 'running') return null;
    if (typeof candidate.reason !== 'string') return null;
    if (typeof candidate.at !== 'string') return null;
    if (typeof candidate.kingId !== 'string') return null;
    if (typeof candidate.keyVersion !== 'number') return null;
    if (typeof candidate.previousDirectiveHash !== 'string') return null;
    if (typeof candidate.hash !== 'string') return null;
    if (typeof candidate.signature !== 'string') return null;
    return {
      version: 1,
      epoch: candidate.epoch,
      state: candidate.state,
      reason: candidate.reason,
      at: candidate.at,
      kingId: candidate.kingId,
      keyVersion: candidate.keyVersion,
      previousDirectiveHash: candidate.previousDirectiveHash,
      hash: candidate.hash,
      signature: candidate.signature,
    };
  }

  /**
   * تجزئة آخر توجيه في التاريخ، أو `null` إن لم يصدر توجيه بعد.
   * @returns التجزئة أو `null`
   */
  #lastHistoryHash(): string | null {
    const directives = this.history();
    const last = directives[directives.length - 1];
    return last === undefined ? null : last.hash;
  }

  /**
   * أعلى عهد بُلغ. ملفٌ تالف يُقرأ صفراً؟ لا: يُقرأ **أعلى ما في التاريخ**، فلا
   * يصير محوُ العدّاد طريقاً إلى قبول توجيه قديم.
   * @returns رقم العهد
   */
  #readEpoch(): number {
    let stored = 0;
    if (existsSync(this.epochFile)) {
      const raw = Number.parseInt(readFileSync(this.epochFile, 'utf8').trim(), 10);
      if (Number.isInteger(raw) && raw > 0) stored = raw;
    }
    const directives = this.history();
    const last = directives[directives.length - 1];
    const fromHistory = last === undefined ? 0 : last.epoch;
    return Math.max(stored, fromHistory);
  }

  /**
   * يرفع عدّاد العهد ذرياً.
   * @param epoch - العهد المبلوغ
   */
  #writeEpoch(epoch: number): void {
    this.#writeAtomic(this.epochFile, String(epoch) + '\n');
  }

  /**
   * مسار إقرار عقدة في عهد.
   * @param nodeId - معرّف العقدة
   * @param epoch - العهد
   * @returns المسار
   */
  #ackPath(nodeId: string, epoch: number): string {
    return join(this.acksDir, `${this.#key(nodeId)}-${epoch}.json`);
  }

  /**
   * مفتاح ملفٍ من معرّف: تجزئته لا نصّه، لأن المعرّف قد يحمل محارف مسارات.
   * @param value - المعرّف
   * @returns المفتاح
   */
  #key(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
  }

  /**
   * يرفض معرّف عقدة فارغاً — عقدةٌ بلا اسم تصير «كل العقد» فيسقط التحقق.
   * @param nodeId - المعرّف
   * @returns المعرّف بعد تشذيبه
   */
  #assertNodeId(nodeId: string): string {
    if (typeof nodeId !== 'string' || nodeId.trim().length === 0) {
      throw new HaltError('INVALID_HALT_NODE');
    }
    return nodeId.trim();
  }

  /**
   * يقرأ كائن JSON من ملف، أو `null` إن غاب أو تلف.
   * @param path - المسار
   * @returns الكائن أو `null`
   */
  #readJson<T>(path: string): T | null {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /**
   * يكتب ملفاً ذرياً: مؤقت ثم `rename`. فلا يرى قارئٌ ملفاً نصفه مكتوب — وهو
   * لازمٌ هنا بالذات لأن القارئ يقرأ في كل فعل، والفشل المغلق يعني أن ملفاً
   * نصفه مكتوب كان سيوقف الدولة ظلماً.
   * @param path - المسار
   * @param text - المحتوى
   */
  #writeAtomic(path: string, text: string): void {
    const temporary = `${path}.writing-${process.pid}-${randomUUID()}`;
    const fd = openSync(temporary, 'wx');
    try {
      this.#writeAll(fd, text);
      if (this.#fsync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    this.#fsyncDir(dirname(path));
  }

  /**
   * يُنشئ ملفاً إنشاءً حصرياً؛ يفشل بـ`EEXIST` إن سبقه غيره.
   * @param path - المسار
   * @param text - المحتوى
   */
  #createExclusive(path: string, text: string): void {
    const fd = openSync(path, 'wx');
    try {
      this.#writeAll(fd, text);
      if (this.#fsync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * يُلحق سطراً مُزامَناً في ملف.
   * @param path - المسار
   * @param text - السطر بنهايته
   */
  #appendLine(path: string, text: string): void {
    const fd = openSync(path, 'a');
    try {
      this.#writeAll(fd, text);
      if (this.#fsync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * يكتب النص كاملاً ولا يقبل كتابة جزئية صامتة.
   * @param fd - مِقبض الملف
   * @param text - النص
   */
  #writeAll(fd: number, text: string): void {
    const buffer = Buffer.from(text, 'utf8');
    let written = 0;
    while (written < buffer.length) written += writeSync(fd, buffer, written);
  }

  /**
   * يُزامن مجلداً كي يصمد اسمُ الملف نفسه لانقطاع الطاقة، لا محتواه وحده.
   * @param path - مسار المجلد
   */
  #fsyncDir(path: string): void {
    if (!this.#fsync) return;
    let fd: number | null = null;
    try {
      fd = openSync(path, 'r');
      fsyncSync(fd);
    } catch {
      // بعض الأنظمة لا تسمح بمزامنة مجلد؛ يبقى المحتوى مُزامَناً على كل حال.
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }

  /**
   * يقول إن كانت العملية حيّة. الإشارة صفر تفحص الوجود ولا تُرسل شيئاً.
   * @param pid - رقم العملية
   * @returns حياتها
   */
  #pidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as { code?: string }).code === 'EPERM';
    }
  }
}
