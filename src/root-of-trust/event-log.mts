// جذر الثقة — سجل الأحداث بسلسلة تجزئة.
//
// نُقل إلى TypeScript في M2.01 بلا تغيير سلوك. وفي M2.05 أُضيف **ترقيم متسلسل**
// (`seq`) إلى الجسم المُجزَّأ، وهذا تغييرٌ مقصود يُبطل تجزئة كل سجل كُتب قبله —
// لأن الترتيب والمحتوى داخل `JSON.stringify` هما ما يُجزَّأ. ولذلك يرفض السجل
// الدائم أي ملف بلا `seq` برمز `LEGACY_LOG_FORMAT` بدل أن يتحقق منه فيفشل بغموض.
//
// لماذا الترقيم أصلاً وسلسلة التجزئة قائمة؟ لأن السلسلة تكشف تعديل حدث أو إعادة
// ترتيبه، ولا تكشف **حذف حدث من الوسط** إلا بمقارنة الروابط، ولا تكشف حذف حدثٍ
// من الطرف أصلاً. الترقيم يجعل الفراغ ظاهراً بذاته، ويجعل رسالة الخطأ تقول أيّ
// موضع انكسر بدل «السجل تالف».
//
// ترتيب مفاتيح الجسم المُجزَّأ: id, seq, type, actor, data, previousHash, at — ثم
// يُلحق `hash`. كل تغيير في هذا الترتيب تغييرُ صيغة يستوجب مُدخلةً في سجل الأعمال.

import { createHash, randomUUID } from 'node:crypto';

/** تجزئة ما قبل الحدث الأول: السلسلة تبدأ من ثابت معلَن لا من قيمة فارغة. */
export const GENESIS_HASH = 'GENESIS';

/** حدث ثابت التسلسل؛ يحفظ رقمه وهاش السابق لتمكين كشف العبث في السجل. */
export interface EventRecord {
  id: string;
  seq: number;
  type: string;
  actor: string;
  data: object;
  previousHash: string;
  at: string;
  hash: string;
}

/** أسباب انكسار السلسلة، مثبَّتة نصاً كي تُختبر ولا تُخمَّن من رسالة. */
export const ChainBreakReasons = [
  'SEQUENCE_MISMATCH',
  'PREVIOUS_HASH_MISMATCH',
  'HASH_MISMATCH',
] as const;

export type ChainBreakReason = (typeof ChainBreakReasons)[number];

/** نتيجة تحقق مفصّلة: أين انكسرت السلسلة ولماذا، لا «صحيحة/فاسدة» فقط. */
export interface ChainVerification {
  ok: boolean;
  count: number;
  lastHash: string;
  brokenAt?: number;
  reason?: ChainBreakReason;
}

/**
 * يحسب تجزئة جسم الحدث بلا `hash`. مُصدَّرة كي يستعملها السجل الدائم والمُفحِّص
 * الخارجي بنفس القاعدة حرفياً، فلا تتفارق نسختان من حساب واحد.
 * @param unsigned - جسم الحدث بلا تجزئته
 * @returns التجزئة السداسية
 */
export function hashEventBody(unsigned: Omit<EventRecord, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
}

/**
 * يتحقق من سلسلة أحداث معطاة: الترقيم متصل من 1، وكل حدث يشير إلى تجزئة سابقه،
 * وتجزئته تُطابق إعادة حسابها. مُصدَّرة كي تُستعمل على أحداث مقروءة من قرص قبل
 * قبولها في كائن حيّ.
 * @param events - الأحداث بترتيب كتابتها
 * @returns نتيجة التحقق المفصّلة
 */
export function verifyEventChain(events: readonly EventRecord[]): ChainVerification {
  let previous = GENESIS_HASH;
  let index = 0;
  for (const event of events) {
    index += 1;
    const { hash, ...unsigned } = event;
    const broken = (reason: ChainBreakReason): ChainVerification => ({
      ok: false,
      count: events.length,
      lastHash: previous,
      brokenAt: index,
      reason,
    });
    if (event.seq !== index) return broken('SEQUENCE_MISMATCH');
    if (event.previousHash !== previous) return broken('PREVIOUS_HASH_MISMATCH');
    if (hash !== hashEventBody(unsigned)) return broken('HASH_MISMATCH');
    previous = hash;
  }
  return { ok: true, count: events.length, lastHash: previous };
}

export class EventLog {
  events: EventRecord[] = [];
  lastHash = GENESIS_HASH;

  /**
   * يضيف حدثاً جديداً مع ربطه تشفيرياً بما سبقه وترقيمه ترقيماً متصلاً.
   * @param type - نوع الواقعة المسجلة
   * @param actor - معرّف الجهة التي أحدثتها
   * @param data - تفاصيل الواقعة
   * @returns الحدث الذي أُلحق بالسجل
   */
  append(type: string, actor: string, data: object): EventRecord {
    const unsigned: Omit<EventRecord, 'hash'> = {
      id: randomUUID(),
      seq: this.events.length + 1,
      type,
      actor,
      data,
      previousHash: this.lastHash,
      at: new Date().toISOString(),
    };
    const event: EventRecord = { ...unsigned, hash: hashEventBody(unsigned) };
    this.events.push(Object.freeze(event));
    if (this.#stepIndex !== null && typeof (data as { step?: unknown }).step === 'number') {
      let list = this.#stepIndex.get(type);
      if (list === undefined) {
        list = [];
        this.#stepIndex.set(type, list);
      }
      list.push(this.events.length - 1);
    }
    this.lastHash = event.hash;
    return event;
  }

  /**
   * يعيد حساب سلسلة الهاشات للتحقق من سلامة ترتيب الأحداث ومحتواها.
   * @returns صحة السلسلة من حدث التكوين حتى آخر حدث
   */
  verify(): boolean {
    return this.verifyChain().ok;
  }

  /**
   * تحقق مفصّل يقول أيّ موضع انكسر ولماذا — ما يحتاجه التدقيق بعد اشتباه عبث.
   * @returns نتيجة التحقق المفصّلة
   */
  verifyChain(): ChainVerification {
    return verifyEventChain(this.events);
  }

  /** فهرس مواضع الأحداث ذات data.step الرقمي، مفصول حسب نوع الحدث. */
  #stepIndex: Map<string, number[]> | null = null;

  /**
   * يبني فهرساً خطياً أثناء التحميل؛ لا ينسخ الأحداث ولا يرتبها.
   * @returns {void}
   */
  protected buildStepIndex(): void {
    this.#stepIndex = new Map();
    for (let i = 0; i < this.events.length; i += 1) {
      const data = this.events[i]?.data as { step?: unknown };
      if (typeof data?.step !== 'number') continue;
      const type = this.events[i]?.type;
      let list = this.#stepIndex.get(type);
      if (list === undefined) {
        list = [];
        this.#stepIndex.set(type, list);
      }
      list.push(i);
    }
  }

  /**
   * يعيد فقط أحداث نوع محدد ذات data.step ضمن الحد المطلوب، دون نسخ بقية السجل.
   * @param type - نوع الحدث المطلوب
   * @param minStep - أدنى خطوة مقبولة
   * @returns نسخة سطحية من الأحداث المطابقة
   */
  eventsOfTypeSinceStep(type: string, minStep: number): EventRecord[] {
    if (this.#stepIndex === null) this.buildStepIndex();
    const indices = this.#stepIndex.get(type);
    if (indices === undefined) return [];
    const result: EventRecord[] = [];
    for (const index of indices) {
      const event = this.events[index];
      const data = event?.data as { step?: unknown };
      if (event !== undefined && typeof data?.step === 'number' && data.step >= minStep) {
        result.push({ ...event });
      }
    }
    return result;
  }

  /**
   * يقدّم نسخة سطحية من الأحداث كي لا يعرض مصفوفة السجل نفسها.
   * @returns صورة الأحداث الحالية
   */
  snapshot(): EventRecord[] {
    return this.events.map((e) => ({ ...e }));
  }
}
