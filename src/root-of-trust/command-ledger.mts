// جذر الثقة — دفتر معرّفات الأوامر: منع إعادة الإرسال دائماً وذرياً (M2.07).
//
// ما كان قبل هذه الخطوة، بعيوبه الأربعة:
//   1. **الفحص في الذاكرة والكتابة بعده** (`has` ثم `appendFileSync`). ولكل عملية
//      مجموعتها في ذاكرتها، فعمليتان تفحصان معاً فتمرّان معاً ثم تُلحقان معاً —
//      أي أن «منع إعادة الإرسال» كان يعمل داخل عملية واحدة فقط، وهو بعينه ما
//      ينقضه معيار هذه الخطوة: «عمليتان متزامنتان ⇒ تنفيذ واحد».
//   2. **بلا مزامنة قرص**: أمرٌ نُفّذ ثم انقطعت الطاقة قد يغيب عن الدفتر، فيُقبل
//      ثانياً بعد الإقلاع. أي أن الدوام كان ادعاءً لا ضماناً.
//   3. **سطرٌ نصفه مكتوب يُسقط الدفتر كله** (‏`JSON.parse` يرفع)، فيصير كل أمر
//      قديم مقبولاً من جديد — وهو أسوأ فشل ممكن في دفتر منعٍ.
//   4. **بلا تمييز بين «نُفّذ» و«شُرع فيه ثم مات المنفّذ»**، فلا سبيل إلى معرفة
//      هل وقع الأثر أم لا، والقرار حينها إما إعادةُ تنفيذ محتملة أو رفضٌ أعمى.
//
// ما صار الآن — والذرّية أساسه:
//   • **الحجز بإنشاء ملف حصري** (`O_CREAT|O_EXCL`) باسم مشتق من تجزئة المعرّف في
//     مجلد `<الدفتر>.claims`. وهذه عملية **ذرية على مستوى النظام**: من بين ألف
//     عملية تتسابق على نفس المعرّف ينجح واحد فقط. ولذلك لم يُستعمل قفلٌ عام:
//     القفل يُسلسل الجميع ويصير عنق زجاجة، والحجز الحصري يخصّ كل أمر بمفتاحه.
//   • **الحجز لا يُحذف عند الإتمام** — يبقى شاهدَ قبرٍ دائماً. ولو حُذف لصار
//     إنشاؤه ينجح مرة أخرى فيُنفَّذ الأمر ثانياً، فحفظُه هو ما يجعل المنع دائماً
//     لا مؤقتاً. ويُحذف في حالة واحدة فقط: إلغاءٌ صريح يعلن أن الأثر **لم يقع**.
//   • **مرحلتان**: `begin` يحجز، و`commit` يُثبت في الدفتر بمزامنة قرص، و`abort`
//     يُلغي إن عُلم أن الأثر لم يقع. والترتيب مقصود: التثبيت يُزامَن **قبل** أي
//     تغيير آخر، فالانقطاع يترك «حجزاً وتثبيتاً» (وهو صحيح) لا «لا شيء».
//   • **الحالة الغامضة تُسمّى ولا تُخمَّن**: حجزٌ صاحبه مات قبل التثبيت يعني أن
//     الأثر مجهول، فيُرفض بـ`INDETERMINATE_COMMAND` ولا يُعاد تنفيذه تلقائياً.
//     والفصل بقرار صريح (`resolveIndeterminate`) يُسجَّل في الدفتر. وهذا اختيار
//     معلن: **أمرٌ معلَّق أهون من أمرٍ نُفّذ مرتين** في نظامٍ أوامره سيادية.
//   • **الذيل المقطوع يُتجاوز، والوسط التالف يُرفض**: نفس قاعدة `M2.05` — الانقطاع
//     يقع في الطرف وحده، وسطرٌ تالف في الوسط عبثٌ لا انقطاع.
//
// ما لا يفعله (معلَن، لا مضمر):
//   • **لا تشذيب لشواهد القبور**: مجلد الحجوزات ينمو بعدد الأوامر، ولا تقسيم له
//     إلى أدلة فرعية. التشذيب يحتاج سياسة احتفاظ (كم يبقى المنع؟) وهي قرار
//     حوكمة لا قرار وحدة، وموضعها M3.
//   • **لا منع عبر آلات**: الذرّية هنا ذرّيةُ نظام ملفات واحد. عبر آلات يحتاج
//     الأمر مخزناً مشتركاً بضمان ذرّي (قاعدة بيانات أو خدمة إجماع) — موضعه M4.
//   • **الدفتر ليس موقَّعاً**: من يملك الكتابة يستطيع محو أسطره. وربطه بالتثبيت
//     الموقَّع (`M2.06`) لم يُنفَّذ هنا، وهو دينٌ معلوم.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  linkSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

/** لاحقة مجلد الحجوزات: مفتاحٌ لكل أمر، وإنشاؤه الحصري هو الذرّية نفسها. */
export const LEDGER_CLAIMS_SUFFIX = '.claims';

/** أخطاء الدفتر، مثبَّتة نصاً كي تُختبر ولا تُخمَّن من رسالة. */
export const CommandLedgerErrorCodes = [
  'REPLAYED_COMMAND',
  'COMMAND_IN_FLIGHT',
  'INDETERMINATE_COMMAND',
  'CORRUPT_COMMAND_LEDGER',
  'INVALID_COMMAND_ID',
  'UNCLAIMED_COMMAND',
  'UNKNOWN_COMMAND',
] as const;

export type CommandLedgerErrorCode = (typeof CommandLedgerErrorCodes)[number];

/**
 * خطأ الدفتر: رسالته هي رمزه — وأُبقي `REPLAYED_COMMAND` بنصّه الذي كان، لأن
 * مستدعياً قائماً (بوابة التاج واختباراتها) يطابقه نصاً.
 */
export class CommandLedgerError extends Error {
  code: CommandLedgerErrorCode;
  id?: string;
  /** رقم عملية صاحب الحجز، حين يكون الرفض بسببه. */
  pid?: number;
  detail?: string;

  /**
   * @param code - رمز الخطأ
   * @param extra - المعرّف وصاحب الحجز وتفصيل يُقرأ برمجياً
   */
  constructor(
    code: CommandLedgerErrorCode,
    extra: { id?: string; pid?: number; detail?: string } = {},
  ) {
    super(code);
    this.name = 'CommandLedgerError';
    this.code = code;
    if (extra.id !== undefined) this.id = extra.id;
    if (extra.pid !== undefined) this.pid = extra.pid;
    if (extra.detail !== undefined) this.detail = extra.detail;
  }
}

/** الحد الأدنى الذي يحتاجه الدفتر من الأمر: معرّفه فقط. */
export interface RecordedCommand {
  id: string;
}

/** حالات الأمر في الدفتر. ولا حالة صامتة: كل ما ليس فيها `unknown` صريحاً. */
export const CommandStates = [
  'unknown',
  'in-flight',
  'indeterminate',
  'committed',
  'aborted',
] as const;

export type CommandState = (typeof CommandStates)[number];

/** سطر الدفتر: قرارٌ نهائي في أمر، مع منشئه ووقته. */
export interface LedgerEntry {
  id: string;
  state: 'committed' | 'aborted';
  pid: number;
  at: string;
  reason?: string;
}

/** ما جرى إصلاحه عند التحميل — يُعلَن ولا يُخفى، لأنه أثر انقطاع. */
export interface LedgerRecovery {
  droppedTailBytes: number;
}

/** خيارات الدفتر. */
export interface CommandLedgerOptions {
  /** مزامنة القرص بعد كل تثبيت. تعطيلها يُسرّع ويُضعف الضمان. */
  fsync?: boolean;
}

/** محتوى ملف الحجز: من حجز، ومتى، وأي أمر. */
interface ClaimFile {
  id: string;
  pid: number;
  at: string;
}

export class CommandLedger {
  file: string;
  /** مجلد الحجوزات — منفصل عن ملف الدفتر بحكم كونه مجلداً بلاحقته. */
  claimsDir: string;
  /** المعرّفات المثبَّتة. أُبقي الاسم `ids` لأن مستدعياً قائماً قد يقرأه. */
  ids: Set<string>;
  recovery: LedgerRecovery = { droppedTailBytes: 0 };

  #aborted: Set<string> = new Set();
  #fsync: boolean;

  /**
   * @param file - مسار دفتر المعرّفات الدائم
   * @param options - مزامنة القرص
   */
  constructor(file: string, options: CommandLedgerOptions = {}) {
    this.file = file;
    this.claimsDir = file + LEDGER_CLAIMS_SUFFIX;
    this.ids = new Set();
    this.#fsync = options.fsync ?? true;
    mkdirSync(dirname(file), { recursive: true });
    mkdirSync(this.claimsDir, { recursive: true });
    this.load();
  }

  /**
   * يقرأ الدفتر من القرص. الذيل المقطوع يُتجاوز ويُعلَن عدد بايتاته، والسطر
   * التالف في الوسط يُرفض برمزه بموضعه.
   */
  load(): void {
    this.ids = new Set();
    this.#aborted = new Set();
    this.recovery = { droppedTailBytes: 0 };
    if (!existsSync(this.file)) return;
    const raw = readFileSync(this.file, 'utf8');
    const parts = raw.split('\n');
    const tail = parts.pop() ?? '';
    if (tail.length > 0) this.recovery.droppedTailBytes = Buffer.byteLength(tail, 'utf8');
    const lines = parts.filter((line) => line.length > 0);
    for (const [index, line] of lines.entries()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new CommandLedgerError('CORRUPT_COMMAND_LEDGER', { detail: `السطر ${index + 1}` });
      }
      const entry = parsed as Partial<LedgerEntry>;
      if (typeof entry.id !== 'string' || entry.id.length === 0) {
        throw new CommandLedgerError('CORRUPT_COMMAND_LEDGER', {
          detail: `السطر ${index + 1} بلا معرّف`,
        });
      }
      // الصيغة القديمة (M2.01) كانت `{id, recordedAt}` بلا حالة، ومعناها
      // «نُفّذ» — فتُقرأ تثبيتاً، إذ لم يكن هناك إلغاء أصلاً.
      if (entry.state === 'aborted') {
        this.#aborted.add(entry.id);
        this.ids.delete(entry.id);
      } else {
        this.ids.add(entry.id);
        this.#aborted.delete(entry.id);
      }
    }
  }

  /**
   * يجيب إن كان الأمر قد ثُبّت تنفيذه. أُبقي المعنى الذي كان: «سُجل سابقاً».
   * @param id - معرّف الأمر
   * @returns وجود تثبيت للمعرّف
   */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  /**
   * يقول حالة الأمر كما هي على القرص الآن — يقرأ الدفتر والحجز في كل نداء، لأن
   * عملية أخرى قد تكون غيّرتهما بعد إقلاعنا. ولا يخمّن: الغامض يُسمّى غامضاً.
   * @param id - معرّف الأمر
   * @returns الحالة
   */
  state(id: string): CommandState {
    this.load();
    if (this.ids.has(id)) return 'committed';
    if (this.#aborted.has(id)) return 'aborted';
    const claim = this.#readClaim(id);
    if (claim === null) return 'unknown';
    return this.#pidAlive(claim.pid) ? 'in-flight' : 'indeterminate';
  }

  /**
   * يحجز الأمر حجزاً ذرياً عبر العمليات: ينجح إنشاء ملف الحجز لواحدٍ فقط.
   * @param command - الأمر
   * @returns رقم عملية الحاجز (نحن) عند النجاح
   */
  begin(command: RecordedCommand): number {
    const id = this.#assertId(command);
    // فحص التثبيت أولاً — والذرّية لا تُنتقص بهذا الفحص، لأنها في إنشاء الحجز
    // بعده. وهو لازم لأن الحجز قد يُمحى (أو يكون سطراً بصيغة قديمة بلا حجز)
    // فينجح إنشاؤه لأمرٍ مثبَّت، فيصير المنع طبقتين: شاهد القبر ثم الدفتر.
    this.load();
    if (this.ids.has(id)) throw new CommandLedgerError('REPLAYED_COMMAND', { id });
    const path = this.#claimPath(id);
    const claim: ClaimFile = { id, pid: process.pid, at: new Date().toISOString() };
    // الترتيب مقصود: **يُكتب المحتوى كاملاً ويُزامَن ثم يُنشر الاسم** بوصلة صلبة.
    // ولو أُنشئ الاسم أولاً ثم كُتب فيه (وهو ما فعلتُه أولاً) لرأى المتسابقُ ملفاً
    // موجوداً فارغاً فسمّى الحالة غامضة ظُلماً وأوقف أمراً مشروعاً.
    const temporary = join(this.claimsDir, `.claiming-${process.pid}-${randomUUID()}`);
    const fd = openSync(temporary, 'wx');
    try {
      this.#writeAll(fd, JSON.stringify(claim) + '\n');
      if (this.#fsync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      // `link` ذرية: تفشل بـEEXIST إن سبقنا غيرُنا، فينجح واحد فقط لا أكثر.
      linkSync(temporary, path);
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
      this.#rejectExistingClaim(id);
      throw new CommandLedgerError('REPLAYED_COMMAND', { id });
    } finally {
      rmSync(temporary, { force: true });
    }
    this.#fsyncDir();
    return process.pid;
  }

  /**
   * يُثبت تنفيذ أمر محجوز: يُلحق سطراً مُزامَناً في الدفتر. والحجز يبقى شاهد
   * قبر، فلو حُذف لعاد إنشاؤه ممكناً وعاد الأمر قابلاً للتنفيذ.
   * @param command - الأمر
   * @param reason - سبب يُسجَّل عند الحاجة (كفصل حالة غامضة)
   */
  commit(command: RecordedCommand, reason?: string): void {
    const id = this.#assertId(command);
    if (!existsSync(this.#claimPath(id))) throw new CommandLedgerError('UNCLAIMED_COMMAND', { id });
    this.load();
    if (this.ids.has(id)) throw new CommandLedgerError('REPLAYED_COMMAND', { id });
    this.#appendEntry(id, 'committed', reason);
  }

  /**
   * يُلغي حجز أمر عُلم أن أثره **لم يقع**، فيُسجَّل الإلغاء ويُحذف الحجز لتصير
   * إعادة الإرسال المشروعة ممكنة. ولا يُلغى ما ثُبّت.
   * @param command - الأمر
   * @param reason - سبب الإلغاء، يُسجَّل للتدقيق
   */
  abort(command: RecordedCommand, reason = 'aborted by executor'): void {
    const id = this.#assertId(command);
    this.load();
    if (this.ids.has(id)) throw new CommandLedgerError('REPLAYED_COMMAND', { id });
    this.#appendEntry(id, 'aborted', reason);
    rmSync(this.#claimPath(id), { force: true });
    this.#fsyncDir();
  }

  /**
   * يثبت معرّف الأمر مرة واحدة فقط: حجزٌ ذري ثم تثبيت مُزامَن. وهذا هو المسار
   * الذي تستعمله بوابة التاج، فبقي اسمه وسلوكه الظاهر كما كان.
   * @param command - الأمر الذي يحمل المعرّف المراد تثبيته
   */
  record(command: RecordedCommand): void {
    this.begin(command);
    this.commit(command);
  }

  /**
   * يفصل حالة غامضة بقرار صريح: `executed` يُثبت، و`not-executed` يُلغي فيصير
   * الأمر قابلاً لإعادة إرسال مشروعة. ولا يُفصل ما ليس غامضاً.
   * @param id - معرّف الأمر
   * @param decision - القرار وسببه
   */
  resolveIndeterminate(id: string, decision: { executed: boolean; reason: string }): void {
    const current = this.state(id);
    if (current !== 'indeterminate') {
      throw new CommandLedgerError('UNKNOWN_COMMAND', { id, detail: `الحالة ${current}` });
    }
    if (decision.executed) this.#appendEntry(id, 'committed', decision.reason);
    else this.abort({ id }, decision.reason);
  }

  /** أسماء الأوامر المحجوزة التي لم تُفصل بعد — للتدقيق التشغيلي. */
  pendingClaims(): { id: string; pid: number; at: string; alive: boolean }[] {
    this.load();
    const pending: { id: string; pid: number; at: string; alive: boolean }[] = [];
    for (const name of readdirSync(this.claimsDir)) {
      // ملفات الحجز قبل نشر اسمها ليست حجوزاً بعد، فلا تُعرض تدقيقاً.
      if (name.startsWith('.')) continue;
      const claim = this.#readClaimFile(join(this.claimsDir, name));
      if (claim === null) continue;
      if (this.ids.has(claim.id)) continue;
      pending.push({ ...claim, alive: this.#pidAlive(claim.pid) });
    }
    return pending.sort((left, right) => left.at.localeCompare(right.at));
  }

  /**
   * يرفض حجزاً قائماً بالسبب الصحيح: مثبَّتٌ، أو قيد التنفيذ الآن، أو غامض.
   * @param id - معرّف الأمر
   */
  #rejectExistingClaim(id: string): void {
    this.load();
    if (this.ids.has(id)) throw new CommandLedgerError('REPLAYED_COMMAND', { id });
    const claim = this.#readClaim(id);
    if (claim === null) return;
    if (this.#pidAlive(claim.pid)) {
      throw new CommandLedgerError('COMMAND_IN_FLIGHT', { id, pid: claim.pid });
    }
    throw new CommandLedgerError('INDETERMINATE_COMMAND', {
      id,
      pid: claim.pid,
      detail: 'حُجز ولم يُثبَّت ومات صاحبه: الأثر مجهول',
    });
  }

  /**
   * يُلحق سطراً في الدفتر بكتابة كاملة ومزامنة، ويُحدّث الذاكرة.
   * @param id - معرّف الأمر
   * @param state - القرار
   * @param reason - سببه إن وُجد
   */
  #appendEntry(id: string, state: 'committed' | 'aborted', reason?: string): void {
    const entry: LedgerEntry = { id, state, pid: process.pid, at: new Date().toISOString() };
    if (reason !== undefined) entry.reason = reason;
    const fd = openSync(this.file, 'a');
    try {
      this.#writeAll(fd, JSON.stringify(entry) + '\n');
      if (this.#fsync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (state === 'committed') {
      this.ids.add(id);
      this.#aborted.delete(id);
    } else {
      this.#aborted.add(id);
      this.ids.delete(id);
    }
  }

  /**
   * يكتب النص كاملاً ولا يقبل كتابة جزئية صامتة.
   * @param fd - مِقبض الملف
   * @param text - النص
   */
  #writeAll(fd: number, text: string): void {
    const buffer = Buffer.from(text, 'utf8');
    let written = 0;
    while (written < buffer.length) written += writeSync(fd, buffer, written);
  }

  /**
   * مسار حجز أمر: تجزئة المعرّف لا المعرّف نفسه، لأن المعرّف قد يحمل محارف
   * مساراتٍ أو طولاً يفوق حدّ اسم الملف.
   * @param id - معرّف الأمر
   * @returns المسار
   */
  #claimPath(id: string): string {
    return join(this.claimsDir, createHash('sha256').update(id).digest('hex'));
  }

  /**
   * يقرأ حجز أمر إن وُجد.
   * @param id - معرّف الأمر
   * @returns الحجز أو `null`
   */
  #readClaim(id: string): ClaimFile | null {
    return this.#readClaimFile(this.#claimPath(id));
  }

  /**
   * يقرأ ملف حجز. وحجزٌ نصفَه مكتوب (انقطاعٌ قبل المزامنة) يُقرأ حجزاً بلا
   * صاحبٍ حيّ فيُعالَج كغامض — لا يُتجاوز، ولا يُظن سليماً.
   * @param path - مسار ملف الحجز
   * @returns الحجز أو `null` إن لم يوجد
   */
  #readClaimFile(path: string): ClaimFile | null {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    try {
      const parsed = JSON.parse(raw) as Partial<ClaimFile>;
      if (typeof parsed.id === 'string' && typeof parsed.pid === 'number') {
        return { id: parsed.id, pid: parsed.pid, at: parsed.at ?? '' };
      }
    } catch {
      // يقع هنا حجزٌ لم تكتمل كتابته: يُنسب إلى عملية غير موجودة كي يُسمّى غامضاً.
    }
    return { id: basename(path), pid: 0, at: '' };
  }

  /**
   * يقول إن كانت العملية حيّة. الإشارة صفر تفحص الوجود ولا تُرسل شيئاً.
   * @param pid - رقم العملية
   * @returns حياتها
   */
  #pidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as { code?: string }).code === 'EPERM';
    }
  }

  /**
   * يُزامن مجلد الحجوزات كي يصمد اسمُ الحجز نفسه لانقطاع الطاقة، لا محتواه
   * وحده. وتعذُّرها على بعض الأنظمة لا يُسقط العملية — الحجز قائم في كل حال.
   */
  #fsyncDir(): void {
    if (!this.#fsync) return;
    let fd: number | null = null;
    try {
      fd = openSync(this.claimsDir, 'r');
      fsyncSync(fd);
    } catch {
      // بعض الأنظمة لا تسمح بمزامنة مجلد؛ يُترك بلا ضمانٍ إضافي ويبقى المنع.
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }

  /**
   * يرفض معرّفاً غير صالح. ومعرّفٌ فارغ كان يُسجَّل بلا اعتراض في الصيغة
   * القديمة، فيصير كل أمرٍ بلا معرّف «الأمر نفسه» — وهو تصادمٌ لا منع.
   * @param command - الأمر
   * @returns المعرّف
   */
  #assertId(command: RecordedCommand): string {
    const id = command.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new CommandLedgerError('INVALID_COMMAND_ID');
    }
    return id;
  }
}
