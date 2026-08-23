// جذر الثقة — بوابة التاج: التوقيع والمنع والإيقاف الآمن.
// نُقل إلى TypeScript في M2.01 بلا تغيير سلوك: نفس ترتيب الفحوص ونفس نصوص الأخطاء.

import { randomUUID } from 'node:crypto';
import type { CommandLedger } from './command-ledger.mjs';
import type { TrustedClock } from './clock.mjs';
import type { HaltGuard } from './halt-switch.mjs';
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
  /**
   * مفتاح الإيقاف الشامل (M2.08). اختياري ومطفأ افتراضياً كي لا يتغير سلوك أي
   * مستهلك قائم؛ فإن وُصل صار كل أمرٍ يُقرأ قبله التوجيه من القرص، فيسري إيقاف
   * عمليةٍ واحدة على هذه البوابة كذلك.
   */
  haltSwitch?: HaltGuard | null;
  /**
   * ساعة موثوقة تكشف انزياحها (M2.09). اختيارية ومطفأة افتراضياً كي لا يتغير
   * سلوك مستهلك قائم؛ فإن غابت بقيت البوابة تأتمن `Date.now()` — أي **ساعة
   * الجهاز** — فيُحيي رجوعُها أمراً منتهي الصلاحية ويُعطّل تقديمُها كل أمر.
   * فإن وُصلت صار انزياح الساعة يُرفض برمزه ولا يُبنى عليه قرار قبول.
   */
  clock?: TrustedClock | null;
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
  haltSwitch: HaltGuard | null;
  clock: TrustedClock | null;
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
    this.haltSwitch = options.haltSwitch ?? null;
    this.clock = options.clock ?? null;
    this.veto = new Veto();
    this.stopped = false;
    this.heartbeatAt = Date.now();
    this.seenCommands = new Set();
    this.maxCommandAgeMs = options.maxCommandAgeMs ?? 300000;
    this.clockSkewMs = options.clockSkewMs ?? 30000;
  }

  /**
   * يقرأ الوقت من الساعة الموثوقة إن وُصلت، وإلا من ساعة الجهاز. وانزياحُ
   * الساعة يُرفع خطأً من هنا فلا يصل إلى حساب العمر أصلاً.
   * @returns الوقت بالميلي ثانية
   */
  private nowMs(): number {
    return this.clock ? this.clock.now() : Date.now();
  }

  /** يثبت نبض التاج في السجل ما دامت البوابة غير موقوفة. */
  heartbeat(): void {
    // الإيقاف الشامل يُفحص قبل الإيقاف المحلي: الأول قرارٌ سيادي دائم يعلو على
    // حالة هذا الكائن، والنبض فعلٌ كذلك فلا يُثبت في دولةٍ موقوفة.
    this.haltSwitch?.assertOperational();
    if (this.stopped) throw new Error('CROWN_STOPPED');
    this.heartbeatAt = this.nowMs();
    this.log.append('crown.heartbeat', this.king.id, {});
  }

  /**
   * يتحقق من الأمر الملكي ثم يثبته قبل إرجاع نسخته المقبولة.
   * @param command - الأمر الملكي الموقع
   * @param signature - توقيع الملك للأمر
   * @returns الأمر بعد ختم القبول
   */
  command(command: RoyalCommand, signature: string): AcceptedRoyalCommand {
    // أول فحصٍ على الإطلاق، وقبل التوقيع والمنع: أمرٌ يصل والدولة موقوفة يُرفض
    // ولا يُسجَّل في الدفتر ولا يُستهلك معرّفه، كي يبقى قابلاً للإصدار بعد
    // الاستئناف بلا اصطدام بمنع الإعادة.
    this.haltSwitch?.assertOperational();
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
    // الوقت يُقرأ من الساعة الموثوقة قبل أي استهلاك للمعرّف: انزياحها يرفع
    // خطأً هنا، فلا يُقبل أمر بزمنٍ لا يُؤتمن عليه ولا يُحرق معرّفه.
    const nowMs = this.nowMs();
    const age = nowMs - issued;
    if (age > this.maxCommandAgeMs) throw new Error('EXPIRED_COMMAND');
    if (age < -this.clockSkewMs) throw new Error('FUTURE_COMMAND');
    // الشهادة تُتحقَّق من سلطة التصديق **قبل** السياسة: السياسة تقرأ الدور
    // والقدرات من الشهادة، فلو لم يُتحقَّق من توقيعها لكان كل من يصنع كائناً
    // فيه `role` قد منح نفسه أي دور. أي أن محرّك السياسة بلا هذا الفحص كان
    // يحكم بمطالبةٍ لا بتفويض.
    if (command.certificate && !this.ca.isValid(command.certificate))
      throw new Error('FORGED_CERTIFICATE');
    if (this.policy && command.certificate)
      this.policy.authorize(command.certificate, command.action);
    const accepted: AcceptedRoyalCommand = {
      ...command,
      acceptedAt: new Date(nowMs).toISOString(),
    };
    // مرحلتان لا واحدة (M2.07): يُحجز المعرّف، ثم يُثبَّت السجل، ثم يُثبَّت
    // الحجز. فلو فشل تخزين السجل أُلغي الحجز بسببه، فالأمر **لم يُنفَّذ ولم
    // يُحرق معرّفه** ويجوز إعادة إرساله؛ ولو ثُبّت الحجز أولاً لصار فشلُ
    // التخزين يُسقط الأمر إلى الأبد بلا أثرٍ ولا سجل.
    const ledger = this.commandLedger;
    if (ledger) ledger.begin(command);
    try {
      this.log.append('crown.command.accepted', this.king.id, accepted);
    } catch (error) {
      if (ledger) ledger.abort(command, 'LOG_APPEND_FAILED');
      throw error;
    }
    if (ledger) ledger.commit(command);
    // المعرّف يُستهلك في الذاكرة **بعد** ثبوت القبول لا قبله: كان يُستهلك قبل
    // السياسة والدفتر، فأمرٌ رُفض بالسياسة أو سقط بفشل تخزين كان يصير غير
    // قابل لإعادة الإرسال أبداً وإن لم يقع له أثر.
    this.seenCommands.add(command.id);
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
