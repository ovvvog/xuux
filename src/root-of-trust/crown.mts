// جذر الثقة — بوابة التاج: التوقيع والمنع والإيقاف الآمن.
// نُقل إلى TypeScript في M2.01 بلا تغيير سلوك: نفس ترتيب الفحوص ونفس نصوص الأخطاء.

import { randomUUID } from 'node:crypto';
import type { CommandLedger } from './command-ledger.mjs';
import type { EventLog } from './event-log.mjs';
import type { Certificate, CertificateAuthority, KingIdentity } from './identity.mjs';
import type { PolicyEngine } from './policy.mjs';

/** أمر ملكي غير مقبول بعد؛ تبقى الشهادة اختيارية لأن السياسة لا تُفعّل في كل بوابة. */
export interface RoyalCommand {
  id: string;
  action: string;
  target: string;
  payload: object;
  issuedAt: string;
  certificate?: Certificate;
}

/** الأمر الملكي بعد أن ختمته البوابة بوقت القبول. */
export interface AcceptedRoyalCommand extends RoyalCommand {
  acceptedAt: string;
}

/** اعتماديات الحوكمة الاختيارية وحدود الزمن التي تضيق بوابة التاج. */
export interface CrownGatewayOptions {
  policy?: PolicyEngine | null;
  commandLedger?: CommandLedger | null;
  maxCommandAgeMs?: number;
  clockSkewMs?: number;
}

export class Veto {
  enabled = true;
  reason: string | null = null;

  /**
   * يغلق البوابة حتى يزيل التاج سبب المنع صراحة.
   * @param reason - سبب المنع المسجل
   */
  block(reason = 'blocked by crown'): void {
    this.reason = reason;
    this.enabled = false;
  }

  /** يزيل المنع ويعيد البوابة إلى حالتها القابلة لاستقبال الأوامر. */
  clear(): void {
    this.reason = null;
    this.enabled = true;
  }

  /** يرفع سبب المنع إن كانت البوابة مغلقة. */
  assertOpen(): void {
    if (!this.enabled) throw new Error(`CROWN_VETO: ${this.reason}`);
  }
}

export class CrownGateway {
  king: KingIdentity;
  ca: CertificateAuthority;
  log: EventLog;
  policy: PolicyEngine | null;
  commandLedger: CommandLedger | null;
  veto: Veto;
  stopped: boolean;
  heartbeatAt: number;
  seenCommands: Set<string>;
  maxCommandAgeMs: number;
  clockSkewMs: number;

  /**
   * @param king - هوية الملك التي تصدق الأوامر
   * @param ca - سلطة التصديق التابعة للملك
   * @param log - سجل الوقائع السيادية
   * @param options - مكونات الحوكمة وحدود الزمن
   */
  constructor(
    king: KingIdentity,
    ca: CertificateAuthority,
    log: EventLog,
    options: CrownGatewayOptions = {},
  ) {
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

  /** يثبت نبض التاج في السجل ما دامت البوابة غير موقوفة. */
  heartbeat(): void {
    if (this.stopped) throw new Error('CROWN_STOPPED');
    this.heartbeatAt = Date.now();
    this.log.append('crown.heartbeat', this.king.id, {});
  }

  /**
   * يتحقق من الأمر الملكي ثم يثبته قبل إرجاع نسخته المقبولة.
   * @param command - الأمر الملكي الموقع
   * @param signature - توقيع الملك للأمر
   * @returns الأمر بعد ختم القبول
   */
  command(command: RoyalCommand, signature: string): AcceptedRoyalCommand {
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
    const accepted: AcceptedRoyalCommand = { ...command, acceptedAt: new Date().toISOString() };
    this.log.append('crown.command.accepted', this.king.id, accepted);
    return accepted;
  }

  /**
   * يوقف البوابة فوراً ويسجل سبب التوقف الآمن.
   * @param reason - سبب الإيقاف المسجل
   */
  stop(reason = 'royal safety stop'): void {
    this.stopped = true;
    this.log.append('crown.emergency.stop', this.king.id, { reason });
  }

  /** يستأنف استقبال الأوامر ويسجل الاستئناف إذا كانت البوابة موقوفة. */
  resume(): void {
    if (this.stopped) {
      this.stopped = false;
      this.log.append('crown.resume', this.king.id, {});
    }
  }
}

/**
 * ينشئ مسودة أمر ملكي فريدة قابلة للتوقيع لاحقاً.
 * @param action - الفعل المطلوب
 * @param target - الهدف المعني بالفعل
 * @param payload - تفاصيل الفعل
 * @returns الأمر قبل التوقيع والقبول
 */
export function createRoyalCommand(
  action: string,
  target: string,
  payload: object = {},
): RoyalCommand {
  return { id: randomUUID(), action, target, payload, issuedAt: new Date().toISOString() };
}
