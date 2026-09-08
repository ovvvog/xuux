// جذر الثقة — الزمن الموثوق: ساعة سيادية تكشف انزياحها ولا تُخفيه (M2.09).
//
// المشكلة التي لم تكن مغطاة قبل هذه الوحدة: كل قرار زمني في المشروع كان يستند
// إلى `Date.now()` — أي إلى **ساعة الجهاز التي يملكها من يملك الجهاز**. ومعيار
// «انتهاء الصلاحية» في بوابة التاج مبنيٌّ على هذه الساعة وحدها، فيلزم منه أثران
// خطيران، وكلاهما مُختبَر في `tests/root-of-trust/failure-modes.test.mjs`:
//
//   1. **ساعةٌ تُرجَع إلى الوراء تُحيي أمراً منتهي الصلاحية.** أمرٌ عمره ساعة
//      وقد وجب رفضه: يكفي أن تُضبط الساعة قبل ساعتين ليصير «عمرُه سالباً» فيُقبل.
//      فالانزياح ليس عطلاً في القياس بل **طريقُ إعادة إرسالٍ لا يمرّ بمنع
//      الإعادة أصلاً** — لأن الأمر لم يُقبل قط، فلا معرّف له في الدفتر.
//   2. **ساعةٌ تُقدَّم إلى الأمام تُعطّل الدولة كلها.** كل أمر جديد يصير «قديماً»
//      فيُرفض بـ`EXPIRED_COMMAND`، ويصير الرفض العام ظاهرُه سلامةٌ وحقيقتُه
//      إنكارُ خدمةٍ بتغيير إعداد.
//
// وحلُّ هذه الوحدة لا يزعم «زمناً صحيحاً» — لا يمكن لجهازٍ واحد أن يعرف الزمن
// الصحيح بلا شاهد خارجي. بل يزعم ما يمكن إثباته: **كشفَ الانزياح والفشلَ
// المُغلَق عنده**. وذلك بثلاث ركائز:
//
//   أ. **قياسٌ أحاديُّ الاتجاه لا يملكه المستعمل:** `process.hrtime` عدّادٌ
//      رتيب (monotonic) لا يتأثر بضبط الساعة. فمقارنة تقدّم ساعة الحائط بتقدّم
//      العدّاد الرتيب تُظهر أي وثبةٍ في الأولى بلا مقابل في الثاني.
//   ب. **حدٌّ أعلى دائم على القرص:** أعلى وقتٍ قُرئ قط يُحفظ ذرياً، فساعةٌ
//      تُرجَع إلى الوراء **بين تشغيلين** تُكشف كذلك — والعدّاد الرتيب وحده لا
//      يكشفها لأنه يُصفَّر مع كل عملية.
//   ج. **الفشل مُغلَق ولا يشفى بنفسه:** أول انزياح يُبطل ثقة الساعة **إلى
//      الأبد** حتى يشهد لها قرارٌ صريح (`attest`). ولو شُفيت بنفسها لصار
//      المهاجم يزيح الساعة ثم يعيدها فيمرّ فعلُه في النافذة بلا أثر.
//
// حدود معلَنة، لا يُدَّعى غيرها:
//   1. **لا تُثبت الوقت الصحيح.** ساعةٌ منزاحةٌ انزياحاً ثابتاً منذ الإقلاع
//      وقبل أي شهادة خارجية تُقرأ سليمةً؛ فالمرجعية الخارجية (NTP موقَّع أو
//      شاهد زمن) موضعها المسارات التالية، وهذه الوحدة تُهيّئ عقدها لا غير.
//   2. **الدقّة ليست الغرض.** الغرض كشفُ وثبةٍ تتجاوز حدَّ التسامح، لا قياسُ
//      ميلي ثانية. وحدُّ التسامح إعدادٌ معلن لأن جدولة النظام نفسها تُحدث
//      فروقاً صغيرة بين القياسين.
//   3. **الحدّ الأعلى يعيش على القرص نفسه.** من يملك القرص يمحوه — فيُقرأ محوُه
//      حالةً غير موثوقة (فشل مُغلَق) لا حالةً سليمة، وهو أقصى ما يُملك بلا
//      شاهد خارجي.

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { hrtime } from 'node:process';

/** الصيغة المثبَّتة لملف حالة الساعة؛ تُرفض أي صيغة أخرى ولا تُخمَّن. */
export const CLOCK_STATE_VERSION = 1;

/** رموز أخطاء الساعة. مثبَّتة نصاً لأن الاختبارات توازنها حرفاً بحرف. */
export const ClockErrorCodes = [
  'CLOCK_SKEW_DETECTED',
  'CLOCK_REGRESSED',
  'CLOCK_UNTRUSTED',
  'CLOCK_REQUIRED_IN_PRODUCTION',
  'CLOCK_STATE_CORRUPT',
  'CLOCK_STATE_UNREADABLE',
  'CLOCK_STATE_UNWRITABLE',
  'CLOCK_ATTESTATION_REQUIRED',
] as const;

export type ClockErrorCode = (typeof ClockErrorCodes)[number];

/**
 * خطأ الساعة. الرسالة هي الرمز، والتفاصيل في حقول مستقلة كي يُقرأ الرمز آلياً
 * ولا يُطابَق نصٌّ حرّ.
 */
export class ClockError extends Error {
  readonly code: ClockErrorCode;
  readonly driftMs: number | null;
  readonly detail: string | null;

  constructor(code: ClockErrorCode, options: { driftMs?: number; detail?: string } = {}) {
    super(code);
    this.name = 'ClockError';
    this.code = code;
    this.driftMs = options.driftMs ?? null;
    this.detail = options.detail ?? null;
  }
}

/**
 * العقد الذي تحتاجه بوابة التاج ونواة التنفيذ: وقتٌ يُقرأ، وثقةٌ تُؤكَّد.
 * أُفرِد عقداً صغيراً كي يبقى ما يعتمد على الزمن قابلاً للاختبار بساعةٍ
 * مُسيطَر عليها، بلا حقن `Date.now` عالمياً ولا تعديل ساعة الجهاز في اختبار.
 */
export interface TrustedClock {
  /** يُرجع وقت الحائط بالميلي ثانية، أو يرفع `ClockError` إن لم يكن موثوقاً. */
  now(): number;
  /** يرفع `ClockError` إن كانت الثقة مُبطَلة، ولا يقرأ وقتاً جديداً. */
  assertTrusted(): void;
}

/** وصف حالة الساعة للتدقيق التشغيلي. لا يحمل سراً ولا مساراً حسّاساً. */
export interface ClockDescription {
  trusted: boolean;
  reason: ClockErrorCode | null;
  lastDriftMs: number;
  maxDriftMs: number;
  highWaterMs: number;
  toleranceMs: number;
  readings: number;
  attestations: number;
  statePath: string | null;
}

/** حالة الساعة كما تُحفظ على القرص. */
interface ClockState {
  version: number;
  highWaterMs: number;
  updatedAt: string;
  attestations: number;
}

/** إعداد الساعة. كل الحقول اختيارية، والافتراضات محافظة. */
export interface SovereignClockOptions {
  /**
   * مسار حالة الحدّ الأعلى. إن غاب فلا يُكشف رجوعُ الساعة **بين تشغيلين** —
   * وهذا نقصٌ معلن لا افتراضٌ صامت، ويُظهره `describe().statePath === null`.
   */
  statePath?: string;
  /** أقصى فرق مقبول بين تقدّم ساعة الحائط وتقدّم العدّاد الرتيب. */
  toleranceMs?: number;
  /** أدنى تقدّم يستوجب كتابة الحدّ الأعلى على القرص؛ يمنع كتابةً عند كل قراءة. */
  persistEveryMs?: number;
  /** ساعة الحائط. تُحقن في الاختبار وحده؛ الافتراض ساعة النظام. */
  wallClock?: () => number;
  /** العدّاد الرتيب بالنانو ثانية. يُحقن في الاختبار وحده. */
  monotonic?: () => bigint;
}

/** يكتب ملفاً ذرياً: مؤقت ⇒ مزامنة ⇒ إحلال ⇒ مزامنة المجلد. */
function writeAtomic(path: string, content: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const handle = openSync(temporary, 'wx', 0o600);
  try {
    writeSync(handle, content);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, path);
  // مزامنة المجلد كي يصمد **الاسم** لا المحتوى وحده أمام انقطاع الطاقة.
  const directoryHandle = openSync(directory, 'r');
  try {
    fsyncSync(directoryHandle);
  } finally {
    closeSync(directoryHandle);
  }
}

export class SovereignClock implements TrustedClock {
  readonly statePath: string | null;
  readonly toleranceMs: number;
  readonly persistEveryMs: number;

  private readonly wall: () => number;
  private readonly mono: () => bigint;

  private anchorWallMs: number;
  private anchorMonoNs: bigint;
  private highWaterMs: number;
  private persistedHighWaterMs: number;
  private attestationCount: number;

  private untrusted: ClockErrorCode | null = null;
  private untrustedDriftMs: number | null = null;
  private lastDriftMs = 0;
  private maxDriftMs = 0;
  private readingCount = 0;

  /**
   * @param options - مسار الحالة وحدّ التسامح والساعتان المحقونتان
   */
  constructor(options: SovereignClockOptions = {}) {
    this.statePath = options.statePath ?? null;
    this.toleranceMs = options.toleranceMs ?? 2000;
    this.persistEveryMs = options.persistEveryMs ?? 1000;
    this.wall = options.wallClock ?? (() => Date.now());
    this.mono = options.monotonic ?? (() => hrtime.bigint());

    const state = this.readState();
    this.highWaterMs = state?.highWaterMs ?? 0;
    this.persistedHighWaterMs = this.highWaterMs;
    this.attestationCount = state?.attestations ?? 0;
    this.anchorWallMs = this.wall();
    this.anchorMonoNs = this.mono();
  }

  /**
   * يقرأ حالة القرص. **التلف يُرفض ولا يُتجاوز:** حالةٌ لا تُفهم تعني حدّاً
   * أعلى مجهولاً، والمضيّ بحدٍّ صفري يعني قبول أي رجوع في الزمن — أي أن
   * «التسامح» هنا يفتح الثغرة التي وُضعت الوحدة لإغلاقها.
   */
  private readState(): ClockState | null {
    if (!this.statePath) return null;
    let raw: string;
    try {
      raw = readFileSync(this.statePath, 'utf8');
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') return null;
      // مسارٌ لا يُقرأ (صلاحيات، أو مجلد مكان ملف) ليس غياباً: الغياب معلوم
      // والمنعُ مجهول، والمجهول يُرفض.
      throw new ClockError('CLOCK_STATE_UNREADABLE', { detail: code ?? 'read failed' });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ClockError('CLOCK_STATE_CORRUPT', { detail: 'not json' });
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new ClockError('CLOCK_STATE_CORRUPT', { detail: 'not an object' });
    }
    const candidate = parsed as Partial<ClockState>;
    if (candidate.version !== CLOCK_STATE_VERSION) {
      throw new ClockError('CLOCK_STATE_CORRUPT', { detail: 'version mismatch' });
    }
    if (typeof candidate.highWaterMs !== 'number' || !Number.isFinite(candidate.highWaterMs)) {
      throw new ClockError('CLOCK_STATE_CORRUPT', { detail: 'high water not a number' });
    }
    if (candidate.highWaterMs < 0) {
      throw new ClockError('CLOCK_STATE_CORRUPT', { detail: 'high water negative' });
    }
    return {
      version: CLOCK_STATE_VERSION,
      highWaterMs: candidate.highWaterMs,
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
      attestations: typeof candidate.attestations === 'number' ? candidate.attestations : 0,
    };
  }

  /** يكتب الحدّ الأعلى. فشلُ الكتابة يُبطل الثقة ولا يُتجاوز بصمت. */
  private persist(): void {
    if (!this.statePath) return;
    const state: ClockState = {
      version: CLOCK_STATE_VERSION,
      highWaterMs: this.highWaterMs,
      updatedAt: new Date(this.highWaterMs).toISOString(),
      attestations: this.attestationCount,
    };
    try {
      writeAtomic(this.statePath, `${JSON.stringify(state)}\n`);
    } catch (error) {
      // حدٌّ أعلى لا يُكتب يعني أن رجوع الساعة بعد إعادة التشغيل لن يُكشف؛
      // فتُبطل الثقة الآن بدل أن يُكتشف الأمر بعد وقوعه.
      this.invalidate('CLOCK_STATE_UNWRITABLE', null, (error as { code?: string }).code ?? null);
      throw new ClockError('CLOCK_STATE_UNWRITABLE', {
        detail: (error as { code?: string }).code ?? 'write failed',
      });
    }
    this.persistedHighWaterMs = this.highWaterMs;
  }

  /** يُبطل الثقة إبطالاً لاصقاً لا يشفى بنفسه. */
  private invalidate(code: ClockErrorCode, driftMs: number | null, _detail: string | null): void {
    if (this.untrusted === null) {
      this.untrusted = code;
      this.untrustedDriftMs = driftMs;
    }
  }

  /** يرفع الخطأ إن كانت الثقة مُبطَلة. لا يقرأ وقتاً ولا يُغيّر حالة. */
  assertTrusted(): void {
    if (this.untrusted !== null) {
      throw new ClockError(this.untrusted, {
        ...(this.untrustedDriftMs === null ? {} : { driftMs: this.untrustedDriftMs }),
        detail: 'ثقة الساعة مُبطَلة حتى تشهد لها شهادة صريحة',
      });
    }
  }

  /**
   * يقرأ الوقت مع فحص الانزياح والرجوع. **يرفع خطأً ولا يُرجع وقتاً مشكوكاً**،
   * لأن مستدعيه يبني عليه قرار قبول أو رفض، ووقتٌ مشكوك يُنتج قراراً مشكوكاً
   * بلا أن يعلم أحد.
   * @returns وقت الحائط بالميلي ثانية
   */
  now(): number {
    this.assertTrusted();
    const wallNow = this.wall();
    const monoNow = this.mono();
    if (!Number.isFinite(wallNow)) {
      this.invalidate('CLOCK_SKEW_DETECTED', null, 'wall clock not finite');
      this.assertTrusted();
    }
    const monoDeltaMs = Number(monoNow - this.anchorMonoNs) / 1e6;
    const wallDeltaMs = wallNow - this.anchorWallMs;
    const drift = wallDeltaMs - monoDeltaMs;
    this.lastDriftMs = drift;
    if (Math.abs(drift) > Math.abs(this.maxDriftMs)) this.maxDriftMs = drift;
    this.readingCount += 1;
    if (Math.abs(drift) > this.toleranceMs) {
      // وثبةٌ في ساعة الحائط لا يقابلها تقدّمٌ في العدّاد الرتيب: أُبطلت الثقة.
      this.invalidate('CLOCK_SKEW_DETECTED', drift, null);
      this.assertTrusted();
    }
    if (wallNow < this.highWaterMs - this.toleranceMs) {
      // أدنى من أعلى وقتٍ قُرئ قط: رجوعٌ في الزمن، ويُكشف بعد إعادة التشغيل
      // كذلك لأن الحدّ الأعلى على القرص لا في الذاكرة.
      this.invalidate('CLOCK_REGRESSED', wallNow - this.highWaterMs, null);
      this.assertTrusted();
    }
    if (wallNow > this.highWaterMs) {
      this.highWaterMs = wallNow;
      if (this.highWaterMs - this.persistedHighWaterMs >= this.persistEveryMs) this.persist();
    }
    return wallNow;
  }

  /**
   * شهادةٌ صريحة تُعيد الثقة بعد انزياح. **قرارٌ سيادي لا تعافٍ تلقائي:** يلزمه
   * سببٌ مكتوب، ولا يُقبل بلا سبب (`CLOCK_ATTESTATION_REQUIRED`). ورجوعُ الحدّ
   * الأعلى لا يجري إلا بطلبٍ صريح (`acceptRegression`) لأن إنزاله يُعيد فتح
   * باب إحياء الأوامر المنتهية، فلا يكون إلا بيدٍ تعلم ما تفعل.
   * @param options - سبب الشهادة، وهل تُقبل عودةُ الحدّ الأعلى إلى الوراء
   */
  attest(options: { reason: string; acceptRegression?: boolean }): ClockDescription {
    if (!options?.reason || options.reason.trim() === '') {
      throw new ClockError('CLOCK_ATTESTATION_REQUIRED', { detail: 'لا شهادة بلا سبب' });
    }
    const wallNow = this.wall();
    this.anchorWallMs = wallNow;
    this.anchorMonoNs = this.mono();
    this.lastDriftMs = 0;
    this.untrusted = null;
    this.untrustedDriftMs = null;
    this.attestationCount += 1;
    if (options.acceptRegression === true) {
      this.highWaterMs = wallNow;
    } else if (wallNow > this.highWaterMs) {
      this.highWaterMs = wallNow;
    }
    this.persist();
    return this.describe();
  }

  /** @returns وصف الحالة للتدقيق: هل الساعة موثوقة، وكم بلغ الانزياح */
  describe(): ClockDescription {
    return {
      trusted: this.untrusted === null,
      reason: this.untrusted,
      lastDriftMs: this.lastDriftMs,
      maxDriftMs: this.maxDriftMs,
      highWaterMs: this.highWaterMs,
      toleranceMs: this.toleranceMs,
      readings: this.readingCount,
      attestations: this.attestationCount,
      statePath: this.statePath,
    };
  }
}

/**
 * ساعة النظام العارية: `Date.now()` بلا كشف انزياح. أُفرِدت باسمٍ صريح كي يكون
 * اختيارُها **معلناً** في موضع الاستعمال، فمن يبني بوابةً بلا ساعة سيادية يعلم
 * أنه يأتمن ساعة الجهاز — ولا يظن أنه حصل على ضمانة لم تُعطَ له.
 */
export class SystemClock implements TrustedClock {
  now(): number {
    return Date.now();
  }

  /** لا شيء يُفحص: هذه الساعة لا تزعم ثقة، ولذلك لا تفشل ولا تُطمئن. */
  assertTrusted(): void {}
}
