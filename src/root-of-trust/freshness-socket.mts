// مقبسُ الحداثةِ — واجهةٌ مجرَّدةٌ لمرجعِ حداثةٍ خارجَ القرص.
//
// **لماذا هذا الملفُّ:** البيانُ المختومُ يمنعُ التزويرَ والتخفيضَ بالتحرير،
// لكنّه لا يمنعُ الإعادة: من ملكَ القرصَ أعادَ لقطةً كاملةً متّسقةً. والمنعُ
// الكاملُ يقتضي مرجعَ حداثةٍ لا يقدرُ الخصمُ على إعادتِه إلى الوراء — وهو إمّا
// داخلَ عتادٍ مستقلٍّ (HSM عدّادٌ رتيبٌ، TPM NV) أو خارجَ نطاقِ القرص (مُشهِدٌ
// شبكيٌّ، توقيعٌ سياديٌّ دوريٌّ).
//
// **هذه الواجهةُ عقدٌ لا تنفيذٌ:** لا تُدَّعى حمايةٌ من الإعادةِ بلا backend
// موصولٍ فعليّاً. `NullFreshnessSocket` لا يفعلُ شيئاً، وهو الافتراضُ — فالسلوكُ
// كما كان. أمّا `MockFreshnessSocket` فللاختبارِ: يُثبتُ أنَّ اللقطةَ القديمةَ
// تُرفَضُ حين يُرفعُ المرجعُ، وأنَّها تُقبَلُ حين لا يُوجدُ.
//
// **حدٌّ مُعلَنٌ:** الواجهةُ وحدَها ليست إصلاحاً. ولا backend غيرُ موصولٍ. ولا
// اختبارٌ متخطٍّ. لا يُدَّعى `VERIFIED` ولا `closed` حتى يصبحَ مصدرُ الحداثةِ
// الحقيقيُّ موصولاً ويمنعُ rollback فعليّاً. والقرارُ في اختيارِ الـbackend
// للمالك — راجع `docs/external-review/options/2026-09-30-r3-a-01-ext-6-options.md`.

/**
 * قراءةُ مرجعِ الحداثةِ — نتيجةٌ غيرُ قابلةٍ للتزويرِ من خارجِ القرص.
 * @property epoch - رقمٌ رتيبٌ لا يَرجِعُ إلى الوراء
 * @property anchor - تجزئةٌ أو مُعرِّفٌ يربطُ القراءةَ بالحالةِ المقروءة
 */
export interface FreshnessReading {
  readonly epoch: bigint;
  readonly anchor: string;
}

/**
 * مقبسُ الحداثةِ — واجهةٌ مجرَّدةٌ لمرجعِ حداثةٍ خارجَ القرص.
 *
 * @property read - يقرأُ المرجعَ الحاليَّ. إن فشلَ القراءةُ برفعٍ، يُرفَضُ الإقلاعُ
 *   مغلقَ لا يسقطُ إلى `null` ولا يعودُ إلى الحالِ السابق.
 * @property bump - يرفعُ المرجعَ بعدَ كلِّ ختم. إن فشلَ الرفعُ برفعٍ، يُرفَضُ الختمُ.
 */
export interface FreshnessSocket {
  /**
   * يقرأُ مرجعَ الحداثةِ الحاليَّ.
   * @returns القراءةُ الحاليّة
   * @throws Error إن تعذّرَتِ القراءةُ — فشلٌ مغلقٌ لا صمتٌ.
   */
  read(): Promise<FreshnessReading>;

  /**
   * يرفعُ مرجعَ الحداثةِ بعدَ كلِّ ختمٍ.
   * @returns القراءةُ بعدَ الرفع
   * @throws Error إن تعذّرَ الرفعُ — فشلٌ مغلقٌ لا صمتٌ.
   */
  bump(): Promise<FreshnessReading>;
}

/**
 * مقبسٌ فارغٌ — لا يفعلُ شيئاً، وهو الافتراضُ.
 *
 * السلوكُ معه كما كان تماماً: لا فحصَ حداثةٍ، لا رفضَ إعادةٍ. الحدُّ المُعلَنُ
 * في ADR 0006 قائمٌ.
 */
export class NullFreshnessSocket implements FreshnessSocket {
  private static instance: NullFreshnessSocket | null = null;

  static get INSTANCE(): NullFreshnessSocket {
    if (NullFreshnessSocket.instance === null) {
      NullFreshnessSocket.instance = new NullFreshnessSocket();
    }
    return NullFreshnessSocket.instance;
  }

  async read(): Promise<FreshnessReading> {
    return { epoch: 0n, anchor: 'null' };
  }

  async bump(): Promise<FreshnessReading> {
    return { epoch: 0n, anchor: 'null' };
  }
}

/**
 * مقبسُ اختبارٍ — عدّادٌ رتيبٌ في الذاكرة. لا يدومُ عبرَ إعادةِ التشغيل:
 * للاختبارِ وحدَه، لا للإنتاج.
 *
 * يُثبتُ به أنَّ اللقطةَ القديمةَ تُرفَضُ حين يُرفعُ المرجعُ، وتُقبَلُ حين
 * لا يُوجدُ.
 */
export class InMemoryFreshnessSocket implements FreshnessSocket {
  /** علامةُ أنّ هذا المقبسَ تركيبيٌّ للاختبارِ لا مصدرُ حداثةٍ إنتاجيٌّ. */
  readonly testFixture = true;
  private epoch: bigint;
  private readonly anchorPrefix: string;

  constructor(initial: bigint = 0n, anchorPrefix: string = 'test') {
    this.epoch = initial;
    this.anchorPrefix = anchorPrefix;
  }

  async read(): Promise<FreshnessReading> {
    return { epoch: this.epoch, anchor: `${this.anchorPrefix}:${this.epoch}` };
  }

  async bump(): Promise<FreshnessReading> {
    this.epoch += 1n;
    return { epoch: this.epoch, anchor: `${this.anchorPrefix}:${this.epoch}` };
  }

  /** يُرفعُ يدويّاً للاختبار — يُحاكي تقدّمَ مرجعٍ خارجيّ. */
  advance(): void {
    this.epoch += 1n;
  }

  /** يُعطّلُ القراءةَ — يُحاكي انقطاعَ مرجعٍ خارجيّ. */
  failNext(): void {
    const original = this.read.bind(this);
    this.read = async () => {
      throw new Error('FRESHNESS_SOURCE_UNAVAILABLE');
      void original;
    };
  }
}

/**
 * يُحدِّدُ هل المقبسُ فارغٌ (لا يفعلُ شيئاً) أم فعليٌّ.
 * @param socket - المقبسُ المُفحوص
 * @returns `true` إن كانَ فارغاً
 */
export function isNullFreshnessSocket(
  socket: FreshnessSocket | StateBoundFreshnessSocket | null | undefined,
): boolean {
  return socket === null || socket === undefined || socket instanceof NullFreshnessSocket;
}

/**
 * رمزُ الرفضِ عندَ اكتشافِ بيانٍ أقدمَ من المرجعِ.
 */
export const STALE_MANIFEST_EPOCH = 'STALE_MANIFEST_EPOCH' as const;

/**
 * رمزُ الرفضِ عندَ تعذُّرِ قراءةِ مرجعِ الحداثةِ.
 */
export const FRESHNESS_SOURCE_UNAVAILABLE = 'FRESHNESS_SOURCE_UNAVAILABLE' as const;

// ─────────────────────────────────────────────────────────────────────────────
// `LIVE-28` (‏`WL-326`، الخيارُ ب): مقبسُ حداثةٍ **مربوطٌ بالحالة**.
//
// `bump()` يرفعُ عدّاداً لا يعرفُ ما يشهدُ عليه، فلقطةٌ قديمةٌ تُقبَلُ إن أُعيدَ
// معها عددٌ صحيح. والعقدُ هنا انتقالٌ ذرّيٌّ مشروطٌ (compare-and-advance) من
// `(e, A_e)` إلى `(e+1, A_{e+1})` حيثُ `A` تجزئةُ الحالةِ نفسِها، فلا يتقدّمُ المرجعُ
// إلّا فوقَ الحالةِ التي يشهدُ عليها، ولا يُقبَلُ انتقالانِ مختلفانِ من العهدِ نفسِه.
//
// **حدٌّ مُعلَنٌ:** لا backend إنتاجيَّ هنا. اختيارُ العتادِ قرارُ المالكِ (‏`D2`) ولم
// يُحسَمْ. والمرجعُ الذي في الذاكرةِ أدناه مِرجعُ اختبارٍ يُرَدُّ في نقطةِ الدخولِ
// الإنتاجيّةِ (‏`testFixture`) ولا يُحسَبُ دليلاً إنتاجيّاً.
// ─────────────────────────────────────────────────────────────────────────────

/** مرساةُ النشأةِ: حالُ المرجعِ قبلَ أوّلِ ربطٍ — `(0, GENESIS)`. */
export const FRESHNESS_GENESIS_ANCHOR = 'genesis' as const;

/** أخطاءُ الانتقالِ المسمّاةُ (‏§6 من تصميمِ الخيارِ ب). */
export const FreshnessAdvanceErrorCodes = [
  /** انتقالٌ غيرُ صالحِ الشكلِ: عهدٌ غيرُ تالٍ، أو مرساةٌ فارغة. */
  'FRESHNESS_ADVANCE_INVALID',
  /** المرجعُ في العهدِ `from.epoch` بمرساةٍ أخرى: انشقاقٌ في العهدِ نفسِه. */
  'FRESHNESS_SAME_EPOCH_FORK',
  /** المرجعُ تقدّمَ إلى ما بعدَ `to`، أو إلى `to.epoch` بمرساةٍ أخرى. */
  'FRESHNESS_STALE_TRANSITION',
  /** المرجعُ أقدمُ من `from`: ما يُطلَبُ رفعُه ليس ما يشهدُ عليه المرجع. */
  'FRESHNESS_REFERENCE_BEHIND',
] as const;

export type FreshnessAdvanceErrorCode = (typeof FreshnessAdvanceErrorCodes)[number];

/** رفضٌ مسمّىً من المرجعِ: نتيجتُه معلومةٌ (لم يتقدّم)، بخلافِ الخطأِ المجهول. */
export class FreshnessAdvanceError extends Error {
  readonly code: FreshnessAdvanceErrorCode;
  readonly current: StateBoundReading | null;

  /**
   * @param code - رمزُ الرفض
   * @param current - قراءةُ المرجعِ ساعةَ الرفضِ إن عُرِفت
   */
  constructor(code: FreshnessAdvanceErrorCode, current: StateBoundReading | null = null) {
    super(code);
    this.name = 'FreshnessAdvanceError';
    this.code = code;
    this.current = current;
  }
}

/** قراءةُ مرجعٍ مربوطٍ بالحالة: عهدٌ ومرساةُ الحالةِ في ذلك العهد. */
export interface StateBoundReading {
  readonly epoch: bigint;
  readonly anchor: string;
}

/**
 * مقبسٌ مربوطٌ بالحالة. الكشفُ عنه بالعَلَمِ `stateBound` **ودالّةِ `advanceState`
 * معاً** — لا بالاسمِ `advance` الذي تحملُه مقابسُ الاختبارِ القديمةُ بمعنىً آخرَ
 * (‏افتراضُ `WL-325` الخامسُ الذي ثبتَ خطؤه).
 */
export interface StateBoundFreshnessSocket {
  readonly stateBound: true;
  /** يقرأُ المرجعَ. الفشلُ رفعٌ لا صمت. */
  read(): Promise<StateBoundReading>;
  /**
   * انتقالٌ ذرّيٌّ مشروط: ينجحُ **فقط** إن كان المرجعُ `from` الآن، فيصيرُ `to`.
   * ونداءٌ مكرَّرٌ بالحُجَجِ نفسِها بعدَ نجاحٍ يُرجِعُ `to` (‏عديمُ الأثرِ الثاني)
   * كي تكونَ إعادةُ المحاولةِ بعدَ نتيجةٍ مجهولةٍ آمنة.
   * @throws FreshnessAdvanceError رفضٌ مسمّىً — لم يتقدّمِ المرجع
   * @throws Error غيرُه — النتيجةُ **مجهولةٌ** ويلزمُ `read()` قبلَ أيِّ حكم
   */
  advanceState(from: StateBoundReading, to: StateBoundReading): Promise<StateBoundReading>;
}

/**
 * هل المقبسُ مربوطٌ بالحالة؟
 * @param socket - المقبس
 * @returns نعم إن حملَ العقدَ كاملاً
 */
export function isStateBoundFreshnessSocket(socket: unknown): socket is StateBoundFreshnessSocket {
  if (socket === null || typeof socket !== 'object') return false;
  const candidate = socket as Partial<StateBoundFreshnessSocket>;
  return (
    candidate.stateBound === true &&
    typeof candidate.advanceState === 'function' &&
    typeof candidate.read === 'function'
  );
}

/**
 * يحكمُ على انتقالٍ مطلوبٍ أمامَ قراءةٍ حاليّة — منطقُ §6 في موضعٍ واحدٍ يستعملُه
 * كلُّ مرجعٍ (‏ذاكرةٌ أو ملفٌّ أو عتادٌ لاحقاً) فلا يفترقُ العقدُ بينَها.
 * @param current - المرجعُ الآن
 * @param from - ما يُدَّعى أنّه المرجع
 * @param to - ما يُطلَبُ الانتقالُ إليه
 * @returns `'apply'` أو `'already'` (‏تكرارٌ بعدَ نجاح)، وإلّا يرفعُ رفضاً مسمّىً
 */
export function judgeStateAdvance(
  current: StateBoundReading,
  from: StateBoundReading,
  to: StateBoundReading,
): 'apply' | 'already' {
  if (
    typeof from.anchor !== 'string' ||
    typeof to.anchor !== 'string' ||
    from.anchor === '' ||
    to.anchor === '' ||
    to.epoch !== from.epoch + 1n ||
    from.epoch < 0n
  ) {
    throw new FreshnessAdvanceError('FRESHNESS_ADVANCE_INVALID', current);
  }
  if (current.epoch === to.epoch && current.anchor === to.anchor) return 'already';
  if (current.epoch === from.epoch) {
    if (current.anchor === from.anchor) return 'apply';
    throw new FreshnessAdvanceError('FRESHNESS_SAME_EPOCH_FORK', current);
  }
  if (current.epoch < from.epoch) {
    throw new FreshnessAdvanceError('FRESHNESS_REFERENCE_BEHIND', current);
  }
  throw new FreshnessAdvanceError('FRESHNESS_STALE_TRANSITION', current);
}

/**
 * مرجعٌ مربوطٌ بالحالةِ في الذاكرة — **للاختبارِ وحدَه**: لا يدومُ عبرَ العملية،
 * ويُرَدُّ في نقطةِ الدخولِ الإنتاجيّة (‏`testFixture`). يُحقَنُ فيه فشلٌ قبلَ
 * التطبيقِ أو بعدَه لقياسِ مسارِ «النتيجةِ المجهولة».
 */
export class InMemoryStateBoundFreshnessSocket implements StateBoundFreshnessSocket {
  readonly stateBound = true as const;
  readonly testFixture = true;
  #current: StateBoundReading = { epoch: 0n, anchor: FRESHNESS_GENESIS_ANCHOR };
  #faults: Array<'before' | 'after'> = [];
  #readFaults = 0;
  /** عددُ الانتقالاتِ المُطبَّقةِ فعلاً — يُقرأُ في الاختبار. */
  applied = 0;

  async read(): Promise<StateBoundReading> {
    if (this.#readFaults > 0) {
      this.#readFaults -= 1;
      throw new Error('FRESHNESS_SOURCE_UNAVAILABLE');
    }
    return this.#current;
  }

  async advanceState(from: StateBoundReading, to: StateBoundReading): Promise<StateBoundReading> {
    const fault = this.#faults.shift();
    if (fault === 'before') throw new Error('FRESHNESS_TRANSPORT_LOST');
    const verdict = judgeStateAdvance(this.#current, from, to);
    if (verdict === 'apply') {
      this.#current = { epoch: to.epoch, anchor: to.anchor };
      this.applied += 1;
    }
    if (fault === 'after') throw new Error('FRESHNESS_TRANSPORT_LOST');
    return this.#current;
  }

  /** فشلٌ نقلٌ قبلَ أن يصلَ الطلبُ — النتيجةُ: لم يتقدّم. */
  failBeforeApply(times = 1): void {
    for (let i = 0; i < times; i += 1) this.#faults.push('before');
  }

  /** فشلُ نقلٍ بعدَ التطبيق — النتيجةُ: تقدّمَ، والمتّصلُ لا يعلم. */
  failAfterApply(times = 1): void {
    for (let i = 0; i < times; i += 1) this.#faults.push('after');
  }

  /** قراءاتٌ تفشلُ — انقطاعُ المرجع. */
  failReads(times = 1): void {
    this.#readFaults += times;
  }

  /**
   * يضعُ المرجعَ على حالٍ بعينِها — يُحاكي كاتباً آخرَ تقدّمَ به (‏انشقاق) أو مرجعاً
   * أُعيدَ. للاختبارِ وحدَه.
   * @param reading - الحالُ الجديدة
   */
  force(reading: StateBoundReading): void {
    this.#current = { epoch: reading.epoch, anchor: reading.anchor };
  }
}
