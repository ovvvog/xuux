// جذر الثقة — دفتر معرّفات الأوامر لمنع إعادة التشغيل.
// نُقل إلى TypeScript في M2.01 بلا تغيير سلوك.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** الحد الأدنى الذي يحتاجه الدفتر من الأمر: معرّفه فقط. */
export interface RecordedCommand {
  id: string;
}

export class CommandLedger {
  file: string;
  ids: Set<unknown>;

  /**
   * @param file - مسار دفتر المعرّفات الدائم
   */
  constructor(file: string) {
    this.file = file;
    this.ids = new Set();
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file))
      for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean))
        this.ids.add((JSON.parse(line) as { id?: unknown }).id);
  }

  /**
   * يجيب إن كان المعرّف قد سُجل سابقاً لمنع إعادة تشغيل الأمر.
   * @param id - معرّف الأمر
   * @returns وجود المعرّف في الدفتر
   */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  /**
   * يثبت معرّف الأمر مرة واحدة فقط في الذاكرة والملف.
   * @param command - الأمر الذي يحمل المعرّف المراد تثبيته
   */
  record(command: RecordedCommand): void {
    if (this.has(command.id)) throw new Error('REPLAYED_COMMAND');
    appendFileSync(
      this.file,
      JSON.stringify({ id: command.id, recordedAt: new Date().toISOString() }) + '\n',
    );
    this.ids.add(command.id);
  }
}
