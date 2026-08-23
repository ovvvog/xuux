import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** @typedef {{id: string}} RecordedCommand */

export class CommandLedger {
  /**
   * @param {string} file - مسار دفتر المعرّفات الدائم
   */
  constructor(file) {
    /** @type {string} */
    this.file = file;
    /** @type {Set<unknown>} */
    this.ids = new Set();
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file))
      for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean))
        this.ids.add(JSON.parse(line).id);
  }
  /**
   * يجيب إن كان المعرّف قد سُجل سابقًا لمنع إعادة تشغيل الأمر.
   * @param {string} id - معرّف الأمر
   * @returns {boolean} وجود المعرّف في الدفتر
   */
  has(id) {
    return this.ids.has(id);
  }
  /**
   * يثبت معرّف الأمر مرة واحدة فقط في الذاكرة والملف.
   * @param {RecordedCommand} command - الأمر الذي يحمل المعرّف المراد تثبيته
   */
  record(command) {
    if (this.has(command.id)) throw new Error('REPLAYED_COMMAND');
    appendFileSync(
      this.file,
      JSON.stringify({ id: command.id, recordedAt: new Date().toISOString() }) + '\n',
    );
    this.ids.add(command.id);
  }
}
