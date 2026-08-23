// جذر الثقة — التثبيت الدوري الموقَّع للسجل (M2.06).
//
// المشكلة التي يحلّها، بدقة: سلسلة التجزئة في `event-log` تكشف تعديلاً **غير
// متسق**، والرأس في `persistent-log` يكشف اقتطاع الطرف. وكلاهما يعيش على القرص
// نفسه الذي يعبث به العابث. فمن يملك الكتابة يستطيع أن يعيد بناء السجل كله —
// يعدّل حدثاً قديماً ثم يعيد تجزئة كل ما بعده ويعيد كتابة الرأس — فيخرج تاريخٌ
// مزيَّف متسقٌ تماماً يجتاز كل تحقق محلي. وهذا حدٌّ أُعلن صراحةً في `WL-009`
// واختبارٌ يُثبته هناك. وهذه الخطوة هي التي تُغلقه.
//
// كيف يُغلق: كل فترة تُجمع حالة السلسلة (العدد وآخر تجزئة) و**تُوقَّع ملكياً**
// وتُحفظ في مخزن **منفصل** عن ملف السجل. فالعابث بالسجل وحده لا يملك مفتاح
// الملك، فلا يستطيع أن يصنع تثبيتاً يوافق تاريخه المزيَّف. ويُطابَق السجل بأقرب
// تثبيت يُغطّي الحدث المشكوك فيه، فيظهر التعديل في موضعه.
//
// أربعة قرارات تصميم، كلٌّ منها لمنع ثغرة بعينها:
//   1. **التثبيتات نفسها مسلسلة ومترابطة** (`seq` و`previousAnchorHash` داخل
//      المادة الموقَّعة). ولولا ذلك لكان العابث — وهو يملك مخزن التثبيتات ولا
//      يملك المفتاح — يحذف التثبيتات المتأخرة ويترك قديماً يوافق تاريخه
//      المقتطع، فيصير الحذف الانتقائي هجوماً ناجحاً على مخزنٍ موقَّع.
//   2. **إصدار المفتاح مسجَّل في المادة الموقَّعة** (`keyVersion`) — وهو قيدٌ
//      أنشأته `M2.04`: بعد التدوير تبقى تثبيتات قديمة موقَّعة بإصدار متعايش،
//      ويجب أن يُعرف بأي إصدار قُبلت لا أن تُقبل بغموض. ويُرفض التوقيع الصحيح
//      الذي يزعم إصداراً غير الذي قَبِله، لأن الكذب في المنشأ عبثٌ أيضاً.
//   3. **العدد لا يتراجع أبداً**: تثبيتٌ يزعم أحداثاً أقل من سابقه مرفوض، ولو
//      كان توقيعه صحيحاً — فذلك إعادةُ التاريخ إلى الوراء بمفتاح مسروق أو بأداة
//      شُغّلت على نسخة قديمة.
//   4. **المخزن يجب أن يكون ملفاً غير ملف السجل ولا رأسه ولا قفله**، ويُرفض
//      غير ذلك برمزه. وهذا أدنى ما يمكن فرضه في الكود.
//
// ما لا يفعله (معلَن، لا مضمر):
//   • **الفصل هنا فصلُ ملف لا فصلُ وسط**. الفصل الحقيقي أن يعيش المخزن على آلة
//     أو وسط آخر (أو شهودٍ خارجيين)، وذلك قرار نشرٍ موضعه M5 لا قرار وحدة. فمن
//     يملك الجهاز كله يستطيع حذف السجل والتثبيتات معاً — و**حذف الكل يُكشف**
//     (لا تثبيت ⇒ لا إثبات، وهو ما يُعلنه التحقق صريحاً) لكنه لا يُمنع.
//   • **لا يمنع العبث، يكشفه.** وبين اللحظتين — آخر تثبيت والآن — نافذةٌ غير
//     مثبَّتة بطول الفترة، فأحداثها لا يحميها إلا سلسلتها ورأسها.
//   • **لا يتحقق من الزمن**: تثبيتٌ بساعة متراجعة يُقبل إن صحّ توقيعه وترابطه،
//     لأن رفض ذلك يحتاج مصدر زمن موثوقاً (M2.09).

import {
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { verifyEventChain, type EventRecord } from './event-log.mjs';
import { LOG_HEAD_SUFFIX, LOG_LOCK_SUFFIX } from './persistent-log.mjs';

/** رابط أول تثبيت: لا سابق له، فيُصرَّح بذلك بدل تركه فارغاً. */
export const GENESIS_ANCHOR_HASH = 'GENESIS_ANCHOR';

/** الفترة الافتراضية بين تثبيتين: ساعة. */
export const DEFAULT_ANCHOR_INTERVAL_MS = 60 * 60 * 1000;

/** المادة التي تُوقَّع. كل ما يُحتجّ به لاحقاً يجب أن يكون داخلها. */
export interface AnchorBody {
  version: 1;
  /** ترقيم التثبيتات نفسها، متصل من 1 — فحذف تثبيت من المخزن يظهر فراغاً. */
  seq: number;
  /** عدد الأحداث التي يشهد لها هذا التثبيت. */
  count: number;
  /** آخر تجزئة عند ذلك العدد — وهي تلتزم بكل ما قبلها بحكم السلسلة. */
  lastHash: string;
  /** تجزئة التثبيت السابق، أو `GENESIS_ANCHOR`. */
  previousAnchorHash: string;
  at: string;
  kingId: string;
  /** إصدار مفتاح الملك الذي وقّع — قيدُ `M2.04`. */
  keyVersion: number;
}

/** تثبيت مكتمل: مادته، وتجزئتها، وتوقيع الملك عليها. */
export interface AnchorRecord extends AnchorBody {
  hash: string;
  signature: string;
}

/** أعطاب التثبيت، مثبَّتة نصاً كي تُختبر ولا تُخمَّن من رسالة. */
export const AnchorProblems = [
  'ANCHOR_STORE_EMPTY',
  'ANCHOR_SEQUENCE_MISMATCH',
  'ANCHOR_HASH_MISMATCH',
  'ANCHOR_LINK_MISMATCH',
  'ANCHOR_SIGNATURE_INVALID',
  'ANCHOR_KEY_VERSION_MISMATCH',
  'ANCHOR_COUNT_REGRESSION',
  'LOG_TRUNCATED_BELOW_ANCHOR',
  'LOG_DIVERGES_FROM_ANCHOR',
  'EVENT_CHAIN_BROKEN',
] as const;

export type AnchorProblem = (typeof AnchorProblems)[number];

/** أخطاء عمليات التثبيت والمخزن (لا نتائج التحقق). */
export const AnchorErrorCodes = [
  'ANCHOR_STORE_NOT_SEPARATE',
  'CORRUPT_ANCHOR_STORE',
  'NOTHING_TO_ANCHOR',
  'ANCHOR_BEHIND_STORE',
  'UNSIGNABLE_LOG',
] as const;

export type AnchorErrorCode = (typeof AnchorErrorCodes)[number];

/** خطأ تثبيت: رسالته هي رمزه، وتفاصيله في حقول لا في نص. */
export class AnchorError extends Error {
  code: AnchorErrorCode;
  detail?: string;

  /**
   * @param code - رمز الخطأ
   * @param detail - تفصيل يُقرأ برمجياً لا يُنتزع من الرسالة
   */
  constructor(code: AnchorErrorCode, detail?: string) {
    super(code);
    this.name = 'AnchorError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * أقلّ ما يحتاجه التثبيت من الملك: توقيعٌ وتحقق ومعرّف. وقُصد بذلك أن يصلح
 * `KingIdentity` و`CoexistingKingIdentity` معاً بلا تفريع في المستدعي.
 */
export interface AnchorSigner {
  id: string;
  sign(payload: object): string;
  verify(payload: object, signature: string): boolean;
  /** إن وُجدت، أُخذ منها رقم الإصدار الذي قَبِل التوقيع (هوية متعايشة). */
  verifyingVersion?(payload: object, signature: string): number | null;
  /** إن وُجد، فهو الإصدار الذي يوقّع الآن. */
  activeVersion?: number;
}

/** أقلّ ما يحتاجه التثبيت من السجل: أحداثه، ومساره إن كان على قرص. */
export interface AnchorableLog {
  events: readonly EventRecord[];
  file?: string;
}

/**
 * يجزّئ مادة التثبيت. الترتيب مثبَّت بالبناء لا بترتيب الحقول في JSON، كي لا
 * تكسر إعادةُ ترتيب حقلٍ في الشيفرة تجزئةَ تثبيتاتٍ محفوظة.
 * @param body - مادة التثبيت
 * @returns تجزئة SHA-256 بترميز ست عشري
 */
export function hashAnchorBody(body: AnchorBody): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        body.version,
        body.seq,
        body.count,
        body.lastHash,
        body.previousAnchorHash,
        body.at,
        body.kingId,
        body.keyVersion,
      ]),
    )
    .digest('hex');
}

/**
 * يستخرج إصدار المفتاح الذي يوقّع الآن. هويةٌ بلا تدوير إصدارها 1 حكماً، فلا
 * يصير التدوير شرطاً لاستعمال التثبيت.
 * @param king - الموقّع
 * @returns رقم الإصدار
 */
export function signingKeyVersion(king: AnchorSigner): number {
  return king.activeVersion ?? 1;
}

/**
 * يبني تثبيتاً موقَّعاً لحالة سلسلة معلومة.
 * @param state - العدد وآخر تجزئة عند لحظة التثبيت
 * @param previous - التثبيت السابق أو `null` لأول تثبيت
 * @param king - الموقّع
 * @param at - لحظة التثبيت
 * @returns تثبيت موقَّع جاهز للحفظ
 */
export function createAnchor(
  state: { count: number; lastHash: string },
  previous: AnchorRecord | null,
  king: AnchorSigner,
  at: Date = new Date(),
): AnchorRecord {
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
    kingId: king.id,
    keyVersion: signingKeyVersion(king),
  };
  return { ...body, hash: hashAnchorBody(body), signature: king.sign(body) };
}

/** مادة التثبيت وحدها بلا التجزئة والتوقيع — وهي ما يُعاد التحقق منه. */
function bodyOf(anchor: AnchorRecord): AnchorBody {
  return {
    version: anchor.version,
    seq: anchor.seq,
    count: anchor.count,
    lastHash: anchor.lastHash,
    previousAnchorHash: anchor.previousAnchorHash,
    at: anchor.at,
    kingId: anchor.kingId,
    keyVersion: anchor.keyVersion,
  };
}

/** نتيجة تحقق: صحيحةٌ أو معطوبةٌ بموضع وسبب، ولا حالة ثالثة صامتة. */
export interface AnchorVerification {
  ok: boolean;
  /** عدد التثبيتات التي فُحصت. */
  anchors: number;
  /** عدد الأحداث التي يشهد لها آخر تثبيت صحيح — أي المدى المُثبَت فعلاً. */
  provenEvents: number;
  /** عدد الأحداث بعد آخر تثبيت: نافذة غير مثبَّتة، تُعلَن لا تُخفى. */
  unanchoredEvents: number;
  /** إصدارات المفاتيح التي قَبِلت التثبيتات — للتدقيق بعد التدوير. */
  keyVersions: number[];
  problem?: AnchorProblem;
  /** رقم التثبيت أو الحدث الذي ظهر عنده العطب. */
  problemAt?: number;
  detail?: string;
}

/**
 * يتحقق من سلسلة التثبيتات وحدها: ترقيمها وترابطها وتجزئتها وتوقيعها وإصداره،
 * وأن عددها لا يتراجع. ولا يمسّ السجل — كي يُدقَّق مخزن التثبيتات وحده.
 * @param anchors - التثبيتات بترتيب حفظها
 * @param king - المتحقق (يقبل إصدارات متعايشة إن كان هوية متعايشة)
 * @returns نتيجة التحقق
 */
export function verifyAnchorChain(
  anchors: readonly AnchorRecord[],
  king: AnchorSigner,
): AnchorVerification {
  const result: AnchorVerification = {
    ok: false,
    anchors: anchors.length,
    provenEvents: 0,
    unanchoredEvents: 0,
    keyVersions: [],
  };
  if (anchors.length === 0) return { ...result, problem: 'ANCHOR_STORE_EMPTY' };

  let previous: AnchorRecord | null = null;
  for (const [index, anchor] of anchors.entries()) {
    const at = index + 1;
    if (anchor.seq !== at) {
      return {
        ...result,
        problem: 'ANCHOR_SEQUENCE_MISMATCH',
        problemAt: at,
        detail: `الترقيم ${anchor.seq}`,
      };
    }
    if (anchor.hash !== hashAnchorBody(bodyOf(anchor))) {
      return { ...result, problem: 'ANCHOR_HASH_MISMATCH', problemAt: at };
    }
    const expectedLink = previous?.hash ?? GENESIS_ANCHOR_HASH;
    if (anchor.previousAnchorHash !== expectedLink) {
      return { ...result, problem: 'ANCHOR_LINK_MISMATCH', problemAt: at };
    }
    if (previous && anchor.count < previous.count) {
      return {
        ...result,
        problem: 'ANCHOR_COUNT_REGRESSION',
        problemAt: at,
        detail: `${previous.count} ثم ${anchor.count}`,
      };
    }
    const body = bodyOf(anchor);
    // الإصدار يُقرأ من المتحقق إن أمكن، فيُكشف توقيعٌ صحيحٌ يزعم إصداراً غير
    // إصداره؛ وإن كانت الهوية بلا تدوير فُحص التوقيع وحده.
    const acceptedBy = king.verifyingVersion
      ? king.verifyingVersion(body, anchor.signature)
      : king.verify(body, anchor.signature)
        ? signingKeyVersion(king)
        : null;
    if (acceptedBy === null) {
      return { ...result, problem: 'ANCHOR_SIGNATURE_INVALID', problemAt: at };
    }
    if (acceptedBy !== anchor.keyVersion) {
      return {
        ...result,
        problem: 'ANCHOR_KEY_VERSION_MISMATCH',
        problemAt: at,
        detail: `يزعم ${anchor.keyVersion} وقَبِله ${acceptedBy}`,
      };
    }
    result.keyVersions.push(acceptedBy);
    previous = anchor;
  }
  return { ...result, ok: true, provenEvents: previous?.count ?? 0 };
}

/**
 * يطابق السجل بتثبيتاته: يتحقق من سلسلة التثبيتات، ثم من سلسلة الأحداث، ثم من
 * أن **بادئة** الأحداث عند عدد كل تثبيت تنتهي بالتجزئة التي شهد لها. وهو موضع
 * كشف تعديل حدث قديم: التاريخ المزيَّف المتسق ينتج تجزئةً أخرى عند ذلك العدد.
 * @param input - الأحداث والتثبيتات والمتحقق
 * @returns نتيجة التحقق مع المدى المُثبَت والنافذة غير المثبَّتة
 */
export function verifyAnchoredLog(input: {
  events: readonly EventRecord[];
  anchors: readonly AnchorRecord[];
  king: AnchorSigner;
}): AnchorVerification {
  const chain = verifyAnchorChain(input.anchors, input.king);
  if (!chain.ok) return chain;

  const events = verifyEventChain(input.events);
  if (!events.ok) {
    const broken: AnchorVerification = { ...chain, ok: false, problem: 'EVENT_CHAIN_BROKEN' };
    if (events.brokenAt !== undefined) broken.problemAt = events.brokenAt;
    if (events.reason !== undefined) broken.detail = events.reason;
    return broken;
  }

  for (const anchor of input.anchors) {
    if (anchor.count > input.events.length) {
      return {
        ...chain,
        ok: false,
        problem: 'LOG_TRUNCATED_BELOW_ANCHOR',
        problemAt: anchor.seq,
        detail: `يشهد لـ${anchor.count} والسجل ${input.events.length}`,
      };
    }
    // البادئة تُعاد تجزئتها لا تُقرأ من الملف، فلا يُقبل حدثٌ حُقنت فيه تجزئة.
    const prefix = verifyEventChain(input.events.slice(0, anchor.count));
    if (prefix.lastHash !== anchor.lastHash) {
      return {
        ...chain,
        ok: false,
        problem: 'LOG_DIVERGES_FROM_ANCHOR',
        problemAt: anchor.seq,
        detail: `التثبيت عند الحدث ${anchor.count}`,
      };
    }
  }

  return {
    ...chain,
    ok: true,
    provenEvents: chain.provenEvents,
    unanchoredEvents: input.events.length - chain.provenEvents,
  };
}

/**
 * يجد أقرب تثبيت يشهد لحدث بعينه — وهو ما يُطابَق به عند الشك في حدث قديم.
 * @param anchors - التثبيتات بترتيب حفظها
 * @param eventSeq - ترقيم الحدث المشكوك فيه
 * @returns أول تثبيت يغطّيه، أو `null` إن كان الحدث بعد كل التثبيتات
 */
export function nearestAnchorFor(
  anchors: readonly AnchorRecord[],
  eventSeq: number,
): AnchorRecord | null {
  for (const anchor of anchors) if (anchor.count >= eventSeq) return anchor;
  return null;
}

/** مخزن تثبيتات: قراءةٌ وإلحاقٌ فقط. لا تعديل ولا حذف — عن قصد. */
export interface AnchorStore {
  readonly location: string;
  read(): AnchorRecord[];
  append(record: AnchorRecord): void;
}

/**
 * مخزن تثبيتات في ملف JSONL منفصل عن السجل، بإلحاق مُزامَن. والحفظ سطرٌ لكل
 * تثبيت كي يبقى المخزن مقروءاً بأدوات النظام عند التدقيق.
 */
export class FileAnchorStore implements AnchorStore {
  readonly location: string;
  #fsync: boolean;

  /**
   * @param file - مسار ملف التثبيتات
   * @param options - مزامنة القرص بعد كل إلحاق
   */
  constructor(file: string, options: { fsync?: boolean } = {}) {
    this.location = file;
    this.#fsync = options.fsync ?? true;
    mkdirSync(dirname(file), { recursive: true });
  }

  /**
   * يرفض أن يكون المخزن هو ملف السجل أو رأسه أو قفله. وهذا أدنى فصلٍ يمكن
   * فرضه في الكود؛ والفصل الحقيقي (وسطٌ أو آلة أخرى) قرار نشرٍ لا قرار وحدة.
   * @param logFile - مسار ملف السجل
   */
  assertSeparateFrom(logFile: string): void {
    const mine = resolve(this.location);
    for (const forbidden of [logFile, logFile + LOG_HEAD_SUFFIX, logFile + LOG_LOCK_SUFFIX]) {
      if (mine === resolve(forbidden)) {
        throw new AnchorError('ANCHOR_STORE_NOT_SEPARATE', `المخزن هو ${forbidden}`);
      }
    }
  }

  /**
   * يقرأ التثبيتات المحفوظة. وأي سطر غير قابل للتفسير يُرفض برمزه بموضعه، ولا
   * يُتجاوز بصمت — لأن سطراً تالفاً في مخزنٍ لا يُلحق إلا بسطر كامل عبثٌ لا انقطاع.
   * @returns التثبيتات بترتيب حفظها
   */
  read(): AnchorRecord[] {
    if (!existsSync(this.location)) return [];
    const lines = readFileSync(this.location, 'utf8').split('\n').filter(Boolean);
    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as AnchorRecord;
      } catch {
        throw new AnchorError('CORRUPT_ANCHOR_STORE', `السطر ${index + 1}`);
      }
    });
  }

  /**
   * يُلحق تثبيتاً بسطر واحد مُزامَن.
   * @param record - التثبيت
   */
  append(record: AnchorRecord): void {
    const fd = openSync(this.location, 'a');
    try {
      const line = Buffer.from(JSON.stringify(record) + '\n', 'utf8');
      let written = 0;
      while (written < line.length) written += writeSync(fd, line, written);
      if (this.#fsync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}

/** خيارات المثبِّت. */
export interface LogAnchorerOptions {
  /** الفترة بين تثبيتين بالمللي ثانية. */
  intervalMs?: number;
  /** أقلّ عدد أحداث جديدة يستحق تثبيتاً — يمنع تثبيتاً بلا جديد. */
  minNewEvents?: number;
}

/**
 * المثبِّت: يقرأ آخر تثبيت من المخزن، ويثبّت عند الطلب أو عند انقضاء الفترة،
 * ويتحقق. والفترة تُحسب من زمن **آخر تثبيت محفوظ** لا من زمن تشغيل العملية،
 * فإعادة التشغيل لا تُعيد العدّ من الصفر ولا تُسقط تثبيتاً مستحقاً.
 */
export class LogAnchorer {
  readonly store: AnchorStore;
  readonly king: AnchorSigner;
  readonly intervalMs: number;
  readonly minNewEvents: number;

  /**
   * @param store - مخزن التثبيتات المنفصل
   * @param king - الموقّع
   * @param options - الفترة وأقلّ جديد
   */
  constructor(store: AnchorStore, king: AnchorSigner, options: LogAnchorerOptions = {}) {
    this.store = store;
    this.king = king;
    this.intervalMs = options.intervalMs ?? DEFAULT_ANCHOR_INTERVAL_MS;
    this.minNewEvents = options.minNewEvents ?? 1;
  }

  /** آخر تثبيت محفوظ أو `null`. */
  latest(): AnchorRecord | null {
    const anchors = this.store.read();
    return anchors.length === 0 ? null : (anchors[anchors.length - 1] ?? null);
  }

  /**
   * يثبّت الحالة الحاضرة للسجل ويحفظها. ويرفض تثبيت سجلٍ سلسلته مكسورة، لأن
   * توقيع حالةٍ معطوبة يمنحها شهادةً كاذبة — والتوقيع لا يصحّح، إنما يُلزِم.
   * @param log - السجل
   * @param at - لحظة التثبيت
   * @returns التثبيت المحفوظ
   */
  anchor(log: AnchorableLog, at: Date = new Date()): AnchorRecord {
    if (log.file !== undefined && this.store instanceof FileAnchorStore) {
      this.store.assertSeparateFrom(log.file);
    }
    const chain = verifyEventChain(log.events);
    if (!chain.ok) {
      throw new AnchorError('UNSIGNABLE_LOG', `السلسلة مكسورة عند ${chain.brokenAt ?? 0}`);
    }
    const previous = this.latest();
    if (previous && log.events.length - previous.count < this.minNewEvents) {
      throw new AnchorError('NOTHING_TO_ANCHOR', `آخر تثبيت عند ${previous.count}`);
    }
    const record = createAnchor(
      { count: chain.count, lastHash: chain.lastHash },
      previous,
      this.king,
      at,
    );
    this.store.append(record);
    return record;
  }

  /**
   * يثبّت إن انقضت الفترة وكان جديدٌ يستحق، وإلا لم يفعل شيئاً. وهو ما يُنادى
   * من أداة دورية بلا شرطٍ في المستدعي.
   * @param log - السجل
   * @param at - اللحظة المرجعية
   * @returns التثبيت إن وقع، أو `null`
   */
  maybeAnchor(log: AnchorableLog, at: Date = new Date()): AnchorRecord | null {
    const previous = this.latest();
    if (previous) {
      if (log.events.length - previous.count < this.minNewEvents) return null;
      if (at.getTime() - Date.parse(previous.at) < this.intervalMs) return null;
    } else if (log.events.length < this.minNewEvents) return null;
    return this.anchor(log, at);
  }

  /**
   * يطابق السجل بكل تثبيتاته.
   * @param log - السجل
   * @returns نتيجة التحقق
   */
  verify(log: AnchorableLog): AnchorVerification {
    return verifyAnchoredLog({ events: log.events, anchors: this.store.read(), king: this.king });
  }
}
