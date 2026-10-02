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
      // eslint-disable-next-line no-unreachable
      void original;
    };
  }
}

/**
 * يُحدِّدُ هل المقبسُ فارغٌ (لا يفعلُ شيئاً) أم فعليٌّ.
 * @param socket - المقبسُ المُفحوص
 * @returns `true` إن كانَ فارغاً
 */
export function isNullFreshnessSocket(socket: FreshnessSocket | null | undefined): boolean {
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
