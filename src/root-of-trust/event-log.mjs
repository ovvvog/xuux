import { createHash, randomUUID } from 'node:crypto';
export class EventLog {
  constructor() { this.events=[]; this.lastHash='GENESIS'; }
  append(type, actor, data) {
    const event={id:randomUUID(), type, actor, data, previousHash:this.lastHash, at:new Date().toISOString()};
    event.hash=createHash('sha256').update(JSON.stringify(event)).digest('hex');
    this.events.push(Object.freeze(event)); this.lastHash=event.hash; return event;
  }
  verify() {
    let previous='GENESIS';
    for (const event of this.events) {
      const {hash,...unsigned}=event;
      const expected=createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
      if (event.previousHash!==previous || hash!==expected) return false;
      previous=hash;
    }
    return true;
  }
  snapshot() { return this.events.map(e=>({...e})); }
}
