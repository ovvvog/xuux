import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventLog } from './event-log.mjs';
export class PersistentEventLog extends EventLog {
  constructor(file) {
    super();
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
    this.load();
  }
  load() {
    try {
      const rows = readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      this.events = rows;
      this.lastHash = rows.at(-1)?.hash ?? 'GENESIS';
      if (!this.verify()) throw new Error('CORRUPT_EVENT_LOG');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  append(type, actor, data) {
    const event = super.append(type, actor, data);
    appendFileSync(this.file, JSON.stringify(event) + '\n', { encoding: 'utf8', flag: 'a' });
    return event;
  }
}
