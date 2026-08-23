import { createHash, randomUUID } from 'node:crypto';

/**
 * حدث ثابت التسلسل؛ يحفظ هاش السابق لتمكين كشف العبث في السجل.
 * @typedef {{id: string, type: string, actor: string, data: object, previousHash: string, at: string, hash: string}} EventRecord
 */

export class EventLog {
  constructor() {
    /** @type {EventRecord[]} */
    this.events = [];
    /** @type {string} */
    this.lastHash = 'GENESIS';
  }
  /**
   * يضيف حدثًا جديدًا مع ربطه تشفيريًا بما سبقه.
   * @param {string} type - نوع الواقعة المسجلة
   * @param {string} actor - معرّف الجهة التي أحدثتها
   * @param {object} data - تفاصيل الواقعة
   * @returns {EventRecord} الحدث الذي أُلحق بالسجل
   */
  append(type, actor, data) {
    const event = /** @type {EventRecord} */ ({
      id: randomUUID(),
      type,
      actor,
      data,
      previousHash: this.lastHash,
      at: new Date().toISOString(),
    });
    event.hash = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    this.events.push(Object.freeze(event));
    this.lastHash = event.hash;
    return event;
  }
  /**
   * يعيد حساب سلسلة الهاشات للتحقق من سلامة ترتيب الأحداث ومحتواها.
   * @returns {boolean} صحة السلسلة من حدث التكوين حتى آخر حدث
   */
  verify() {
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
   * @returns {EventRecord[]} صورة الأحداث الحالية
   */
  snapshot() {
    return this.events.map((e) => ({ ...e }));
  }
}
