import { randomUUID } from 'node:crypto';
export class Veto {
  constructor() {
    this.enabled = true;
    this.reason = null;
  }
  block(reason = 'blocked by crown') {
    this.reason = reason;
    this.enabled = false;
  }
  clear() {
    this.reason = null;
    this.enabled = true;
  }
  assertOpen() {
    if (!this.enabled) throw new Error(`CROWN_VETO: ${this.reason}`);
  }
}

export class CrownGateway {
  constructor(king, ca, log, options = {}) {
    this.king = king;
    this.ca = ca;
    this.log = log;
    this.policy = options.policy ?? null;
    this.commandLedger = options.commandLedger ?? null;
    this.veto = new Veto();
    this.stopped = false;
    this.heartbeatAt = Date.now();
    this.seenCommands = new Set();
    this.maxCommandAgeMs = options.maxCommandAgeMs ?? 300000;
    this.clockSkewMs = options.clockSkewMs ?? 30000;
  }
  heartbeat() {
    if (this.stopped) throw new Error('CROWN_STOPPED');
    this.heartbeatAt = Date.now();
    this.log.append('crown.heartbeat', this.king.id, {});
  }
  command(command, signature) {
    if (this.stopped) throw new Error('CROWN_STOPPED');
    this.veto.assertOpen();
    if (!this.king.verify(command, signature)) throw new Error('INVALID_ROYAL_SIGNATURE');
    if (!command.id || !command.action || !command.target || !command.issuedAt)
      throw new Error('INVALID_COMMAND');
    if (
      this.seenCommands.has(command.id) ||
      (this.commandLedger && this.commandLedger.has(command.id))
    )
      throw new Error('REPLAYED_COMMAND');
    const issued = Date.parse(command.issuedAt);
    if (!Number.isFinite(issued)) throw new Error('INVALID_COMMAND_TIME');
    const age = Date.now() - issued;
    if (age > this.maxCommandAgeMs) throw new Error('EXPIRED_COMMAND');
    if (age < -this.clockSkewMs) throw new Error('FUTURE_COMMAND');
    this.seenCommands.add(command.id);
    if (this.policy && command.certificate)
      this.policy.authorize(command.certificate, command.action);
    if (this.commandLedger) this.commandLedger.record(command);
    const accepted = { ...command, acceptedAt: new Date().toISOString() };
    this.log.append('crown.command.accepted', this.king.id, accepted);
    return accepted;
  }
  stop(reason = 'royal safety stop') {
    this.stopped = true;
    this.log.append('crown.emergency.stop', this.king.id, { reason });
  }
  resume() {
    if (this.stopped) {
      this.stopped = false;
      this.log.append('crown.resume', this.king.id, {});
    }
  }
}

export function createRoyalCommand(action, target, payload = {}) {
  return { id: randomUUID(), action, target, payload, issuedAt: new Date().toISOString() };
}
