import { randomUUID } from 'node:crypto';

/** @typedef {import('./command-ledger.mjs').CommandLedger} CommandLedgerType */
/** @typedef {import('./event-log.mjs').EventLog} EventLogType */
/** @typedef {import('./identity.mjs').Certificate} CertificateType */
/** @typedef {import('./identity.mjs').KingIdentity} KingIdentityType */
/** @typedef {import('./policy.mjs').PolicyEngine} PolicyEngineType */
/**
 * أمر ملكي غير مقبول بعد؛ تبقى الشهادة اختيارية لأن السياسة لا تُفعّل في كل بوابة.
 * @typedef {{id: string, action: string, target: string, payload: object, issuedAt: string, certificate?: CertificateType}} RoyalCommand
 */
/** @typedef {RoyalCommand & {acceptedAt: string}} AcceptedRoyalCommand */
/**
 * اعتماديات الحوكمة الاختيارية وحدود الزمن التي تضيق بوابة التاج.
 * @typedef {{policy?: PolicyEngineType | null, commandLedger?: CommandLedgerType | null, maxCommandAgeMs?: number, clockSkewMs?: number}} CrownGatewayOptions
 */

export class Veto {
  constructor() {
    /** @type {boolean} */
    this.enabled = true;
    /** @type {string | null} */
    this.reason = null;
  }
  /**
   * يغلق البوابة حتى يزيل التاج سبب المنع صراحة.
   * @param {string} [reason='blocked by crown'] - سبب المنع المسجل
   */
  block(reason = 'blocked by crown') {
    this.reason = reason;
    this.enabled = false;
  }
  /** يزيل المنع ويعيد البوابة إلى حالتها القابلة لاستقبال الأوامر. */
  clear() {
    this.reason = null;
    this.enabled = true;
  }
  /** يرفع سبب المنع إن كانت البوابة مغلقة. */
  assertOpen() {
    if (!this.enabled) throw new Error(`CROWN_VETO: ${this.reason}`);
  }
}

export class CrownGateway {
  /**
   * @param {KingIdentityType} king - هوية الملك التي تصدق الأوامر
   * @param {import('./identity.mjs').CertificateAuthority} ca - سلطة التصديق التابعة للملك
   * @param {EventLogType} log - سجل الوقائع السيادية
   * @param {CrownGatewayOptions} [options={}] - مكونات الحوكمة وحدود الزمن
   */
  constructor(king, ca, log, options = {}) {
    /** @type {KingIdentityType} */
    this.king = king;
    /** @type {import('./identity.mjs').CertificateAuthority} */
    this.ca = ca;
    /** @type {EventLogType} */
    this.log = log;
    /** @type {PolicyEngineType | null} */
    this.policy = options.policy ?? null;
    /** @type {CommandLedgerType | null} */
    this.commandLedger = options.commandLedger ?? null;
    /** @type {Veto} */
    this.veto = new Veto();
    /** @type {boolean} */
    this.stopped = false;
    /** @type {number} */
    this.heartbeatAt = Date.now();
    /** @type {Set<string>} */
    this.seenCommands = new Set();
    /** @type {number} */
    this.maxCommandAgeMs = options.maxCommandAgeMs ?? 300000;
    /** @type {number} */
    this.clockSkewMs = options.clockSkewMs ?? 30000;
  }
  /** يثبت نبض التاج في السجل ما دامت البوابة غير موقوفة. */
  heartbeat() {
    if (this.stopped) throw new Error('CROWN_STOPPED');
    this.heartbeatAt = Date.now();
    this.log.append('crown.heartbeat', this.king.id, {});
  }
  /**
   * يتحقق من الأمر الملكي ثم يثبته قبل إرجاع نسخته المقبولة.
   * @param {RoyalCommand} command - الأمر الملكي الموقع
   * @param {string} signature - توقيع الملك للأمر
   * @returns {AcceptedRoyalCommand} الأمر بعد ختم القبول
   */
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
  /**
   * يوقف البوابة فورًا ويسجل سبب التوقف الآمن.
   * @param {string} [reason='royal safety stop'] - سبب الإيقاف المسجل
   */
  stop(reason = 'royal safety stop') {
    this.stopped = true;
    this.log.append('crown.emergency.stop', this.king.id, { reason });
  }
  /** يستأنف استقبال الأوامر ويسجل الاستئناف إذا كانت البوابة موقوفة. */
  resume() {
    if (this.stopped) {
      this.stopped = false;
      this.log.append('crown.resume', this.king.id, {});
    }
  }
}

/**
 * ينشئ مسودة أمر ملكي فريدة قابلة للتوقيع لاحقًا.
 * @param {string} action - الفعل المطلوب
 * @param {string} target - الهدف المعني بالفعل
 * @param {object} [payload={}] - تفاصيل الفعل
 * @returns {RoyalCommand} الأمر قبل التوقيع والقبول
 */
export function createRoyalCommand(action, target, payload = {}) {
  return { id: randomUUID(), action, target, payload, issuedAt: new Date().toISOString() };
}
