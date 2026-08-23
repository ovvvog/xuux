import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventLog } from './event-log.mjs';

/** @typedef {import('./event-log.mjs').EventRecord} EventRecordType */

export class PersistentEventLog extends EventLog {
  /**
   * @param {string} file - مسار ملف الأحداث المتسلسل
   */
  constructor(file) {
    super();
    /** @type {string} */
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
    this.load();
  }
  /** يعيد بناء حالة السجل من الملف ويتحقق من سلسلة الهاشات قبل قبولها. */
  load() {
    try {
      const rows = readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(
          /** @type {(value: string, index: number, array: string[]) => EventRecordType} */ (
            /** @type {unknown} */ (JSON.parse)
          ),
        );
      this.events = rows;
      this.lastHash = rows.at(-1)?.hash ?? 'GENESIS';
      if (!this.verify()) throw new Error('CORRUPT_EVENT_LOG');
    } catch (e) {
      if (/** @type {{code?: unknown}} */ (e).code !== 'ENOENT') throw e;
    }
  }
  /**
   * يثبت الحدث في الذاكرة والملف بالترتيب نفسه كي تبقى السلسلة قابلة للتحقق.
   * @override
   * @param {string} type - نوع الواقعة المسجلة
   * @param {string} actor - معرّف الجهة التي أحدثتها
   * @param {object} data - تفاصيل الواقعة
   * @returns {EventRecordType} الحدث الذي أُلحق بالسجل
   */
  append(type, actor, data) {
    const event = super.append(type, actor, data);
    appendFileSync(this.file, JSON.stringify(event) + '\n', { encoding: 'utf8', flag: 'a' });
    return event;
  }
}
