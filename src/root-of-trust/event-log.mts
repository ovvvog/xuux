// جذر الثقة — سجل الأحداث بسلسلة تجزئة. نُقل إلى TypeScript في M2.01 بلا تغيير سلوك:
// نفس ترتيب مفاتيح الكائن المُجزَّأ (id, type, actor, data, previousHash, at ثم hash)،
// لأن أي تغيير في الترتيب يغيّر ناتج JSON.stringify فيبطل كل تجزئة سابقة.

import { createHash, randomUUID } from 'node:crypto';

/** حدث ثابت التسلسل؛ يحفظ هاش السابق لتمكين كشف العبث في السجل. */
export interface EventRecord {
  id: string;
  type: string;
  actor: string;
  data: object;
  previousHash: string;
  at: string;
  hash: string;
}

export class EventLog {
  events: EventRecord[] = [];
  lastHash = 'GENESIS';

  /**
   * يضيف حدثاً جديداً مع ربطه تشفيرياً بما سبقه.
   * @param type - نوع الواقعة المسجلة
   * @param actor - معرّف الجهة التي أحدثتها
   * @param data - تفاصيل الواقعة
   * @returns الحدث الذي أُلحق بالسجل
   */
  append(type: string, actor: string, data: object): EventRecord {
    // الجسم بلا `hash` هو بعينه ما كان يُجزَّأ قبل النقل، وترتيب مفاتيحه محفوظ.
    const unsigned: Omit<EventRecord, 'hash'> = {
      id: randomUUID(),
      type,
      actor,
      data,
      previousHash: this.lastHash,
      at: new Date().toISOString(),
    };
    const hash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    const event: EventRecord = { ...unsigned, hash };
    this.events.push(Object.freeze(event));
    this.lastHash = event.hash;
    return event;
  }

  /**
   * يعيد حساب سلسلة الهاشات للتحقق من سلامة ترتيب الأحداث ومحتواها.
   * @returns صحة السلسلة من حدث التكوين حتى آخر حدث
   */
  verify(): boolean {
    let previous = 'GENESIS';
    for (const event of this.events) {
      const { hash, ...unsigned } = event;
      const expected = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
      if (event.previousHash !== previous || hash !== expected) return false;
      previous = hash;
    }
    return true;
  }

  /**
   * يقدّم نسخة سطحية من الأحداث كي لا يعرض مصفوفة السجل نفسها.
   * @returns صورة الأحداث الحالية
   */
  snapshot(): EventRecord[] {
    return this.events.map((e) => ({ ...e }));
  }
}
