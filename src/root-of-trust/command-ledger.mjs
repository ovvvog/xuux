import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export class CommandLedger {
  constructor(file) {
    this.file = file;
    this.ids = new Set();
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file))
      for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean))
        this.ids.add(JSON.parse(line).id);
  }
  has(id) {
    return this.ids.has(id);
  }
  record(command) {
    if (this.has(command.id)) throw new Error('REPLAYED_COMMAND');
    appendFileSync(
      this.file,
      JSON.stringify({ id: command.id, recordedAt: new Date().toISOString() }) + '\n',
    );
    this.ids.add(command.id);
  }
}
