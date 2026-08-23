import { randomUUID } from 'node:crypto';
export class Veto {
  constructor() { this.enabled=true; this.reason=null; }
  block(reason='blocked by crown') { this.reason=reason; this.enabled=false; }
  clear() { this.reason=null; this.enabled=true; }
  assertOpen() { if (!this.enabled) throw new Error(`CROWN_VETO: ${this.reason}`); }
}

export class CrownGateway {
  constructor(king, ca, log) { this.king=king; this.ca=ca; this.log=log; this.veto=new Veto(); this.stopped=false; this.heartbeatAt=Date.now(); }
  heartbeat() { if (this.stopped) throw new Error('CROWN_STOPPED'); this.heartbeatAt=Date.now(); this.log.append('crown.heartbeat',this.king.id,{}); }
  command(command, signature) {
    if (this.stopped) throw new Error('CROWN_STOPPED');
    this.veto.assertOpen();
    if (!this.king.verify(command, signature)) throw new Error('INVALID_ROYAL_SIGNATURE');
    if (!command.id || !command.action || !command.target) throw new Error('INVALID_COMMAND');
    const accepted={...command, acceptedAt:new Date().toISOString()};
    this.log.append('crown.command.accepted',this.king.id,accepted); return accepted;
  }
  stop(reason='royal safety stop') { this.stopped=true; this.log.append('crown.emergency.stop',this.king.id,{reason}); }
  resume() { if (this.stopped) { this.stopped=false; this.log.append('crown.resume',this.king.id,{}); } }
}

export function createRoyalCommand(action,target,payload={}) { return {id:randomUUID(), action, target, payload, issuedAt:new Date().toISOString()}; }
