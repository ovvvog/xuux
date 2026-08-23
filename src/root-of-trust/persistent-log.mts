// جذر الثقة — سجل أحداث دائم على القرص. نُقل إلى TypeScript في M2.01 بلا تغيير سلوك.
// لا يُعاد تعريف الحقلين `events` و`lastHash` هنا لأن `useDefineForClassFields` يجعل
// إعادة إعلانهما في الصنف الوارث تصفيرَ ما بناه المُنشئ الأب.

import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventLog, type EventRecord } from './event-log.mjs';

export class PersistentEventLog extends EventLog {
  file: string;

  /**
   * @param file - مسار ملف الأحداث المتسلسل
   */
  constructor(file: string) {
    super();
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
    this.load();
  }

  /** يعيد بناء حالة السجل من الملف ويتحقق من سلسلة الهاشات قبل قبولها. */
  load(): void {
    try {
      const rows = readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EventRecord);
      this.events = rows;
      this.lastHash = rows.at(-1)?.hash ?? 'GENESIS';
      if (!this.verify()) throw new Error('CORRUPT_EVENT_LOG');
    } catch (e) {
      if ((e as { code?: unknown }).code !== 'ENOENT') throw e;
    }
  }

  /**
   * يثبت الحدث في الذاكرة والملف بالترتيب نفسه كي تبقى السلسلة قابلة للتحقق.
   * @param type - نوع الواقعة المسجلة
   * @param actor - معرّف الجهة التي أحدثتها
   * @param data - تفاصيل الواقعة
   * @returns الحدث الذي أُلحق بالسجل
   */
  override append(type: string, actor: string, data: object): EventRecord {
    const event = super.append(type, actor, data);
    appendFileSync(this.file, JSON.stringify(event) + '\n', { encoding: 'utf8', flag: 'a' });
    return event;
  }
}
