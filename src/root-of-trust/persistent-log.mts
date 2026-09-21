// جذر الثقة — سجل أحداث دائم على القرص (M2.05).
//
// ما كان قبل هذه الخطوة: `appendFileSync` بلا مزامنة قرص، وتحميلٌ يرفع أي سطر
// نصفَه مكتوباً إلى استثناء JSON فيصير السجل كله غير قابل للتحميل، وحذفُ أسطر من
// طرف الملف لا يُكتشف أصلاً لأن سلسلة أقصر سلسلةٌ صحيحة، وكاتبان متزامنان يهدمان
// السلسلة بلا إنذار. أي أن الانقطاع كان يُفسد السجل عملياً — وهو بعينه ما يمنعه
// معيار هذه الخطوة.
//
// ما صار الآن:
//   1. **ترقيم متسلسل** في الجسم المُجزَّأ، فحذفُ حدث من الوسط يظهر فراغاً.
//   2. **رأسٌ منفصل** (`<الملف>.head`) يحمل العدد وآخر تجزئة، يُكتب ذرياً
//      (ملف مؤقت ثم `rename`) بعد كل إلحاق. فحذفُ أحداث من الطرف — وهو ما لا
//      تكشفه سلسلةٌ وحدها — يصير تناقضاً معلَناً.
//   3. **كتابة ذرية ومُزامَنة**: مِقبضٌ واحد مفتوح بـ`O_APPEND`، وحلقة كتابة
//      تُكمل السطر ولا تقبل كتابة جزئية، ثم `fsync` قبل تحديث الرأس. فترتيب
//      الفشل معلوم: حدثٌ بلا رأس مُحدَّث (يُصلَح)، لا رأسٌ يزعم حدثاً غير مكتوب.
//   4. **استرداد من كتابة مقطوعة**: السطر الأخير غير المكتمل يُقتطع ويُسجَّل عدد
//      بايتاته، ولا يُقبل مثل ذلك في وسط الملف — لأن الانقطاع يقع في الطرف وحده،
//      وسطرٌ تالف في الوسط عبثٌ لا انقطاع.
//   5. **كاتب واحد**: قفلٌ بملف (`<الملف>.lock`) يحمل رقم العملية، ويُنتزع إن
//      كانت العملية مالكته ميتة — فقفلٌ يبقى بعد قتل العملية كان سيمنع الإقلاع.
//
// ما لا يفعله (معلَن، لا مضمر): الرأس **غير موقَّع**، فمن يملك الكتابة على القرص
// يستطيع إعادة بناء السجل والرأس معاً بلا كشف. حدّ ذلك هو التثبيت الموقَّع
// المنفصل (`M2.06`)، ويوجد اختبار يُثبت هذا العجز صراحةً كي لا يُظن مغلقاً.
//
// إضافةُ `WL-092` — **الختمُ الإنتاجيُّ بمفتاحِ F05 داخلَ التوكن**: كان جسمُ كلِّ
// حدثٍ يُكتب نصّاً صريحاً على القرص، وكان `sealEventData`/`openEventData` قدرةً
// في `hsm-binding.mts` بلا مستهلكٍ واحدٍ. فصار السجلُّ يقبل **خاتماً** (`sealer`)
// يختمُ جسمَ الحدثِ داخلَ التوكنِ قبلَ الكتابة، وثلاثُ قواعدَ تحكمُه:
//   1. **لا مسارَ نصٍّ صريحٍ في الإنتاج**: مُنشئُ السجلِّ يرفضُ بلا خاتمٍ فشلاً
//      مغلقاً (`EVENT_LOG_SEAL_REQUIRED_IN_PRODUCTION`).
//   2. **لا تزييفَ تزامنٍ**: الختمُ نداءٌ غيرُ متزامنٍ إلى التوكن، فـ`append`
//      المتزامنُ **يُرفَض** حين يوجد خاتمٌ (`SEALED_LOG_REQUIRES_ASYNC_APPEND`)
//      ويُستعمل `appendSealed`. ولو أُرجع من `append` نصٌّ صريحٌ لصار الخاتمُ
//      زينةً يُتجاوَزُ بأولِ نداءٍ قديم.
//   3. **السلسلةُ تبقى فوقَ ما يُكتب فعلاً**: التجزئةُ تُحسَب على الجسمِ المختومِ
//      كما هو على القرص، فالتحقّقُ من السلسلةِ يبقى بلا مفتاحٍ ولا توكن — وهو
//      شرطُ التدقيقِ الخارجيّ.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { isProductionRuntime } from './production-boot.mjs';
import {
  EventLog,
  GENESIS_HASH,
  verifyEventChain,
  type ChainBreakReason,
  type EventRecord,
} from './event-log.mjs';

/** لاحقة ملف الرأس: العدد وآخر تجزئة، منفصلان عن الأحداث كي يتناقضا إن عُبث. */
export const LOG_HEAD_SUFFIX = '.head';

/** لاحقة ملف القفل: كاتبٌ واحد لكل سجل. */
export const LOG_LOCK_SUFFIX = '.lock';

/** أخطاء السجل الدائم، مثبَّتة نصاً كي تُختبر ولا تُخمَّن من رسالة. */
export const PersistentLogErrorCodes = [
  'CORRUPT_EVENT_LOG',
  'LEGACY_LOG_FORMAT',
  'TRUNCATED_EVENT_LOG',
  'HEAD_MISMATCH',
  'HEAD_MISSING',
  'LOG_ALREADY_LOCKED',
  'LOG_CLOSED',
  'PARTIAL_WRITE',
  'EVENT_LOG_SEAL_REQUIRED_IN_PRODUCTION',
  'SEALED_LOG_REQUIRES_ASYNC_APPEND',
  'EVENT_LOG_SEALER_MISSING',
] as const;

export type PersistentLogErrorCode = (typeof PersistentLogErrorCodes)[number];

/** خطأ السجل الدائم: رسالته هي رمزه، وتفاصيله في حقول لا في نص. */
export class PersistentLogError extends Error {
  code: PersistentLogErrorCode;
  brokenAt?: number;
  reason?: ChainBreakReason;
  detail?: string;

  /**
   * @param code - رمز الخطأ
   * @param extra - تفاصيل موضع الانكسار وسببه إن وُجدت
   */
  constructor(
    code: PersistentLogErrorCode,
    extra: { brokenAt?: number; reason?: ChainBreakReason; detail?: string } = {},
  ) {
    super(code);
    this.name = 'PersistentLogError';
    this.code = code;
    if (extra.brokenAt !== undefined) this.brokenAt = extra.brokenAt;
    if (extra.reason !== undefined) this.reason = extra.reason;
    if (extra.detail !== undefined) this.detail = extra.detail;
  }
}

/** رأس السجل: ما يقوله القرص عن طول السلسلة وآخر تجزئة فيها. */
export interface LogHead {
  version: 1;
  count: number;
  lastHash: string;
  updatedAt: string;
}

/** ما جرى إصلاحه عند التحميل — يُعلَن ولا يُخفى، لأنه أثر انقطاع أو تعطُّل. */
export interface LogRecovery {
  droppedTailBytes: number;
  repairedHead: boolean;
  acceptedMissingHead: boolean;
  stolenLockPid: number | null;
}

/**
 * خاتمُ أجسامِ الأحداث. عقدٌ بنيويٌّ لا وراثةٌ ولا استيرادٌ من `hsm-binding`:
 * السجلُّ لا يعرف PKCS#11 ولا يستوردُه، إنما يقبلُ من يختمُ ويفكُّ. وهذا يُتيح
 * تشغيلَ المسارِ الإنتاجيِّ نفسِه في CI بخلفيةِ توكنٍ مزيَّفةٍ **بتشفيرٍ حقيقيٍّ**،
 * فتُشتغَّل الاختباراتُ الخصميّةُ فعلاً بدل أن تُتجاوز.
 */
export interface EventDataSealer {
  /** معرّفُ مفتاحِ الختمِ في التوكن (F05 = `05`) — يُقرأ للتدقيقِ لا للاشتقاق. */
  readonly keyId: string;
  /**
   * يختمُ جسمَ الحدثِ داخلَ التوكن.
   * @param data - الجسمُ الصريح
   * @returns الختمُ الصالحُ للكتابةِ على القرص
   */
  seal(data: unknown): Promise<object>;
  /**
   * يفكُّ ختمَ جسمِ حدثٍ داخلَ التوكن.
   * @param sealed - الختمُ كما قُرئ من القرص
   * @returns الجسمُ الصريح
   */
  open(sealed: unknown): Promise<unknown>;
}

/** خيارات السجل الدائم. */
export interface PersistentEventLogOptions {
  /** قفل الكاتب الواحد. يُعطَّل في القراءة الفاحصة فقط. */
  lock?: boolean;
  /** مزامنة القرص بعد كل إلحاق. تعطيلها يُسرّع ويُضعف الضمان. */
  fsync?: boolean;
  /** قبول سجلٍ بلا رأس (تبنٍّ أول أو استعادة نسخة) — يُسجَّل في `recovery`. */
  acceptMissingHead?: boolean;
  /**
   * خاتمُ أجسامِ الأحداثِ (F05). إلزاميٌّ في الإنتاج: بدونه يُرفض المُنشئ.
   */
  sealer?: EventDataSealer | null;
  /** البيئةُ التي يُقرأ منها حكمُ الإنتاج — تُمرَّر في الاختبارِ كائناً صريحاً. */
  env?: NodeJS.ProcessEnv;
}

/** نتيجة فحص قراءة محضة لملف سجل، بلا قفل وبلا كتابة حرف واحد. */
export interface EventLogInspection {
  file: string;
  exists: boolean;
  count: number;
  lastHash: string;
  tailComplete: boolean;
  chainOk: boolean;
  brokenAt?: number;
  reason?: ChainBreakReason;
  head: LogHead | null;
  headAgrees: boolean;
  /**
   * الأحداث المقروءة كما هي على القرص. أُضيفت في M2.06 كي تُطابَق بالتثبيتات
   * الموقَّعة **بلا قفل وبلا كتابة**؛ ولولاها لكان التدقيق يحتاج فتح السجل
   * للكتابة، فيصير الفحصُ نفسه تغييراً للمفحوص.
   */
  events: readonly EventRecord[];
  problem?: PersistentLogErrorCode;
}

/**
 * يفصل أسطر ملف السجل ويقول إن كان طرفه مكتملاً.
 * @param raw - محتوى الملف الخام
 * @returns الأسطر الكاملة، والذيل غير المكتمل إن وُجد
 */
function splitLines(raw: string): { lines: string[]; tail: string } {
  const parts = raw.split('\n');
  const tail = parts.pop() ?? '';
  return { lines: parts.filter((line) => line.length > 0), tail };
}

/**
 * يحوّل أسطراً إلى أحداث، ويرفض ما ليس فيه ترقيم بصيغةٍ قديمة.
 * @param lines - أسطر JSON كاملة
 * @returns الأحداث، أو موضع أول سطر لا يُقرأ
 */
function parseLines(lines: string[]): { events: EventRecord[]; badAt: number | null } {
  const events: EventRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { events, badAt: index + 1 };
    }
    const record = parsed as Partial<EventRecord>;
    if (typeof record.seq !== 'number') throw new PersistentLogError('LEGACY_LOG_FORMAT');
    events.push(record as EventRecord);
  }
  return { events, badAt: null };
}

/**
 * يقرأ ملف الرأس إن وُجد. رأسٌ لا يُقرأ تناقضٌ لا غياب.
 * @param path - مسار ملف الرأس
 * @returns الرأس أو `null` إن لم يوجد
 */
function readHead(path: string): LogHead | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new PersistentLogError('HEAD_MISMATCH', { detail: 'رأس غير قابل للقراءة' });
  }
  const head = parsed as Partial<LogHead>;
  if (typeof head.count !== 'number' || typeof head.lastHash !== 'string')
    throw new PersistentLogError('HEAD_MISMATCH', { detail: 'رأس ناقص الحقول' });
  return {
    version: 1,
    count: head.count,
    lastHash: head.lastHash,
    updatedAt: head.updatedAt ?? '',
  };
}

/**
 * فحصٌ قرائي محض لملف سجل: لا يقفل ولا يكتب ولا يقتطع — للتدقيق على سجلٍ حيّ
 * أو على نسخة محفوظة، ولمعرفة سبب رفض التحميل قبل تغيير أي بايت.
 * @param file - مسار ملف الأحداث
 * @returns وصف الحالة وموضع الانكسار إن وُجد
 */
export function inspectEventLog(file: string): EventLogInspection {
  const headPath = file + LOG_HEAD_SUFFIX;
  if (!existsSync(file)) {
    let head: LogHead | null = null;
    let problem: PersistentLogErrorCode | undefined;
    try {
      head = readHead(headPath);
    } catch {
      problem = 'HEAD_MISMATCH';
    }
    if (head && head.count > 0) problem = 'TRUNCATED_EVENT_LOG';
    const base: EventLogInspection = {
      file,
      exists: false,
      count: 0,
      lastHash: GENESIS_HASH,
      tailComplete: true,
      chainOk: true,
      head,
      headAgrees: head === null,
      events: [],
    };
    return problem === undefined ? base : { ...base, problem };
  }

  const raw = readFileSync(file, 'utf8');
  const { lines, tail } = splitLines(raw);
  let events: EventRecord[] = [];
  let badAt: number | null = null;
  let problem: PersistentLogErrorCode | undefined;
  try {
    const parsedLines = parseLines(lines);
    events = parsedLines.events;
    badAt = parsedLines.badAt;
  } catch (error) {
    if (error instanceof PersistentLogError) problem = error.code;
    else throw error;
  }
  if (badAt !== null) problem ??= 'CORRUPT_EVENT_LOG';

  const chain = verifyEventChain(events);
  if (!chain.ok) problem ??= 'CORRUPT_EVENT_LOG';

  let head: LogHead | null = null;
  try {
    head = readHead(headPath);
  } catch {
    problem ??= 'HEAD_MISMATCH';
  }
  const headAgrees =
    head !== null && head.count === chain.count && head.lastHash === chain.lastHash;
  if (head !== null && !headAgrees && problem === undefined)
    problem = head.count > chain.count ? 'TRUNCATED_EVENT_LOG' : 'HEAD_MISMATCH';

  const inspection: EventLogInspection = {
    file,
    exists: true,
    count: chain.count,
    lastHash: chain.lastHash,
    tailComplete: tail.length === 0,
    chainOk: chain.ok,
    head,
    headAgrees,
    events,
  };
  if (chain.brokenAt !== undefined) inspection.brokenAt = chain.brokenAt;
  else if (badAt !== null) inspection.brokenAt = badAt;
  if (chain.reason !== undefined) inspection.reason = chain.reason;
  if (problem !== undefined) inspection.problem = problem;
  return inspection;
}

export class PersistentEventLog extends EventLog {
  file: string;
  headFile: string;
  lockFile: string;
  recovery: LogRecovery = {
    droppedTailBytes: 0,
    repairedHead: false,
    acceptedMissingHead: false,
    stolenLockPid: null,
  };

  #fd: number | null = null;
  #locked = false;
  #fsync: boolean;
  #closed = false;
  readonly #sealer: EventDataSealer | null;

  /**
   * @param file - مسار ملف الأحداث المتسلسل
   * @param options - القفل والمزامنة وقبول رأس مفقود والخاتم
   */
  constructor(file: string, options: PersistentEventLogOptions = {}) {
    super();
    this.#sealer = options.sealer ?? null;
    // الفحصُ قبلَ إنشاءِ مجلدٍ أو أخذِ قفلٍ أو فتحِ مقبضٍ: تركيبٌ مرفوضٌ
    // لا يتركُ أثراً على القرص، ولا يُنتزعُ قفلٌ من كاتبٍ شرعيٍّ لأجلِ مُنشئٍ سيُردُّ.
    if (this.#sealer === null && isProductionRuntime(options.env ?? process.env)) {
      throw new PersistentLogError('EVENT_LOG_SEAL_REQUIRED_IN_PRODUCTION', {
        detail: 'سجلُّ أحداثٍ بلا ختمٍ في الإنتاج: الجسمُ سيُكتب نصّاً صريحاً',
      });
    }
    this.file = file;
    this.headFile = file + LOG_HEAD_SUFFIX;
    this.lockFile = file + LOG_LOCK_SUFFIX;
    this.#fsync = options.fsync ?? true;
    mkdirSync(dirname(file), { recursive: true });
    if (options.lock ?? true) this.#acquireLock();
    try {
      this.load({ acceptMissingHead: options.acceptMissingHead ?? false });
      // رأسٌ لسجل فارغ يُكتب عند الإنشاء لا عند أول إلحاق. ولولا ذلك لكان غياب
      // الرأس بعد تعطُّلٍ في نافذة أول حدث لا يُفرَّق عن حذفِ رأسٍ عن عمد، فيُرفض
      // سجلٌ سليم بعد قتل العملية — وهو الخطأ الذي كشفه قياس القتل على سجل ضخم.
      if (!existsSync(this.headFile)) this.#writeHead();
      this.#fd = openSync(this.file, 'a');
    } catch (error) {
      this.#releaseLock();
      this.#closed = true;
      throw error;
    }
  }

  /** يأخذ قفل الكاتب الواحد، وينتزعه إن كانت العملية المالكة له ميتة. */
  #acquireLock(): void {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(this.lockFile, 'wx');
        writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        closeSync(fd);
        this.#locked = true;
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
        const owner = this.#lockOwner();
        if (owner !== null && this.#pidAlive(owner))
          throw new PersistentLogError('LOG_ALREADY_LOCKED', { detail: `العملية ${owner}` });
        // قفلٌ لعملية ميتة (أو قفل تالف) أثرُ تعطُّل لا ملكية: يُنتزع ويُعلَن.
        rmSync(this.lockFile, { force: true });
        this.recovery.stolenLockPid = owner;
      }
    }
    throw new PersistentLogError('LOG_ALREADY_LOCKED', { detail: 'تعذّر أخذ القفل' });
  }

  /**
   * يقرأ رقم العملية المالكة للقفل.
   * @returns رقم العملية أو `null` إن كان القفل غير مقروء
   */
  #lockOwner(): number | null {
    try {
      const parsed = JSON.parse(readFileSync(this.lockFile, 'utf8')) as { pid?: unknown };
      return typeof parsed.pid === 'number' ? parsed.pid : null;
    } catch {
      return null;
    }
  }

  /**
   * يسأل نظام التشغيل إن كانت العملية حيّة، بلا إرسال إشارة فعلية.
   * @param pid - رقم العملية
   * @returns حياتها
   */
  #pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as { code?: string }).code === 'EPERM';
    }
  }

  /** يفلت القفل إن كان مملوكاً لهذه العملية. */
  #releaseLock(): void {
    if (!this.#locked) return;
    rmSync(this.lockFile, { force: true });
    this.#locked = false;
  }

  /**
   * يعيد بناء الحالة من الملف: يقتطع كتابةً مقطوعة في الطرف، ويرفض العبث في
   * الوسط، ويطابق الرأس، ولا يقبل أحداثاً في الذاكرة قبل نجاح التحقق.
   * @param options - قبول رأس مفقود
   */
  load(options: { acceptMissingHead?: boolean } = {}): void {
    if (!existsSync(this.file)) {
      const head = readHead(this.headFile);
      if (head !== null && head.count > 0)
        throw new PersistentLogError('TRUNCATED_EVENT_LOG', {
          detail: `الرأس يعلن ${head.count} حدثاً والملف غائب`,
        });
      this.events = [];
      this.lastHash = GENESIS_HASH;
      return;
    }

    const raw = readFileSync(this.file, 'utf8');
    const { lines, tail } = splitLines(raw);
    const { events, badAt } = parseLines(lines);

    // الانقطاع يقع في الطرف وحده: ذيلٌ بلا سطر جديد، أو سطرٌ أخير لا يُقرأ.
    let droppedBytes = Buffer.byteLength(tail, 'utf8');
    if (badAt !== null) {
      if (badAt !== lines.length)
        throw new PersistentLogError('CORRUPT_EVENT_LOG', {
          brokenAt: badAt,
          detail: 'سطر لا يُقرأ في وسط الملف: عبثٌ لا انقطاع',
        });
      droppedBytes += Buffer.byteLength((lines[badAt - 1] as string) + '\n', 'utf8');
    }
    if (droppedBytes > 0) {
      truncateSync(this.file, Buffer.byteLength(raw, 'utf8') - droppedBytes);
      this.recovery.droppedTailBytes = droppedBytes;
    }

    const chain = verifyEventChain(events);
    if (!chain.ok) {
      const extra: { brokenAt?: number; reason?: ChainBreakReason } = {};
      if (chain.brokenAt !== undefined) extra.brokenAt = chain.brokenAt;
      if (chain.reason !== undefined) extra.reason = chain.reason;
      throw new PersistentLogError('CORRUPT_EVENT_LOG', extra);
    }

    rmSync(this.headFile + '.tmp', { force: true });
    const head = readHead(this.headFile);
    if (head === null) {
      if (events.length > 0 && !(options.acceptMissingHead ?? false))
        throw new PersistentLogError('HEAD_MISSING', {
          detail: 'سجل بلا رأس لا يمكن كشف اقتطاع طرفه',
        });
      if (events.length > 0) this.recovery.acceptedMissingHead = true;
    } else if (head.count > chain.count) {
      // الرأس يُكتب **بعد** مزامنة الحدث، فتقدُّمه يعني حدثاً مكتملاً اختفى.
      throw new PersistentLogError('TRUNCATED_EVENT_LOG', {
        detail: `الرأس يعلن ${head.count} حدثاً والملف يحمل ${chain.count}`,
      });
    } else if (head.count === chain.count) {
      if (head.lastHash !== chain.lastHash)
        throw new PersistentLogError('HEAD_MISMATCH', { detail: 'تجزئة الرأس تخالف السلسلة' });
    } else if (
      head.count === chain.count - 1 &&
      head.lastHash === (events[chain.count - 2]?.hash ?? GENESIS_HASH)
    ) {
      // تعطُّلٌ بين مزامنة الحدث وتحديث الرأس: نافذة معلومة بحدث واحد، تُصلَح.
      this.recovery.repairedHead = true;
    } else {
      throw new PersistentLogError('HEAD_MISMATCH', {
        detail: `الرأس ${head.count} والسلسلة ${chain.count}`,
      });
    }

    this.events = events.map((event) => Object.freeze(event));
    this.buildStepIndex();
    this.lastHash = chain.lastHash;
    if (this.recovery.repairedHead || this.recovery.droppedTailBytes > 0 || head === null)
      this.#writeHead();
  }

  /** يكتب الرأس ذرياً: ملف مؤقت مُزامَن ثم `rename`، فلا يُقرأ رأس نصفه مكتوب. */
  #writeHead(): void {
    const head: LogHead = {
      version: 1,
      count: this.events.length,
      lastHash: this.lastHash,
      updatedAt: new Date().toISOString(),
    };
    // اسمٌ ثابت لا يحمل رقم عملية: الكاتب واحد بالقفل، فبقاءُ مؤقتٍ من تعطُّل
    // سابق يُكتب فوقه ولا يتكاثر في المجلد.
    const temp = `${this.headFile}.tmp`;
    writeFileSync(temp, JSON.stringify(head) + '\n', { encoding: 'utf8', mode: 0o600 });
    if (this.#fsync) {
      const fd = openSync(temp, 'r+');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    renameSync(temp, this.headFile);
  }

  /**
   * يثبت الحدث في الملف ثم يُزامنه ثم يُحدّث الرأس. ترتيبٌ مقصود: الرأس لا يزعم
   * أبداً حدثاً غير مكتوب، وأسوأ ما يتركه التعطُّل رأسٌ متأخر بحدث واحد يُصلَح.
   * @param type - نوع الواقعة المسجلة
   * @param actor - معرّف الجهة التي أحدثتها
   * @param data - تفاصيل الواقعة
   * @returns الحدث الذي أُلحق بالسجل
   */
  override append(type: string, actor: string, data: object): EventRecord {
    // خاتمٌ موصولٌ ونداءٌ متزامنٌ: رفضٌ صريحٌ لا كتابةٌ نصٍّ صريحٍ. وهذا
    // هو موضعُ الفشلِ المغلقِ الأول، فمن لم يُهاجر إلى `appendSealed` يُردُّ
    // عندَ أولِ إلحاقٍ لا يُكتبُ له حدثٌ مقروءٌ.
    if (this.#sealer !== null) throw new PersistentLogError('SEALED_LOG_REQUIRES_ASYNC_APPEND');
    return this.#appendRecord(type, actor, data);
  }

  /**
   * يختمُ جسمَ الحدثِ داخلَ التوكنِ (F05) ثمَّ يُلحقُ المختومَ وحدَه. والمسارُ
   * الإنتاجيُّ هو هذا لا `append`: لا جسمَ حدثٍ يمسُّ القرصَ إلاّ مختوماً.
   * @param type - نوع الواقعة المسجلة
   * @param actor - معرّف الجهة التي أحدثتها
   * @param data - تفاصيل الواقعة الصريحة (لا تُكتب كما هي)
   * @returns الحدث كما أُلحق بالسجل (جسمُه مختومٌ)
   */
  async appendSealed(type: string, actor: string, data: object): Promise<EventRecord> {
    if (this.#sealer === null) throw new PersistentLogError('EVENT_LOG_SEALER_MISSING');
    if (this.#closed || this.#fd === null) throw new PersistentLogError('LOG_CLOSED');
    const sealed = await this.#sealer.seal(data);
    return this.#appendRecord(type, actor, sealed);
  }

  /**
   * يفكُّ ختمَ جسمِ حدثٍ مقروءٍ. وكلُّ عبثٍ في المختومِ يُرفعُ خطأً من التوكن،
   * لا يُرجعُ جسماً مشكوكاً فيه: علامةُ GCM ترفضُ ولا تُصلِح.
   * @param event - الحدث كما قُرئ من القرص
   * @returns جسمُه الصريح
   */
  async openEvent(event: EventRecord): Promise<unknown> {
    if (this.#sealer === null) throw new PersistentLogError('EVENT_LOG_SEALER_MISSING');
    return this.#sealer.open((event as { data?: unknown }).data);
  }

  /** هل هذا السجلُّ مختومٌ فعلاً؟ يُقرأ للتدقيقِ وللتقارير، ولا يُغني عن الفحص. */
  get sealed(): boolean {
    return this.#sealer !== null;
  }

  /**
   * جسمُ الإلحاقِ المشتركُ بين المسارين: نفسُ ترتيبِ الكتابةِ والمزامنةِ
   * وتحديثِ الرأس، فلا يتفارقُ مسارٌ مختومٌ ومسارٌ صريحٌ في ضمانِ الدوام.
   * @param type - نوع الواقعة
   * @param actor - معرّف الفاعل
   * @param data - الجسمُ كما سيُكتب على القرص
   * @returns الحدث المُلحَق
   */
  #appendRecord(type: string, actor: string, data: object): EventRecord {
    if (this.#closed || this.#fd === null) throw new PersistentLogError('LOG_CLOSED');
    const event = super.append(type, actor, data);
    try {
      const buffer = Buffer.from(JSON.stringify(event) + '\n', 'utf8');
      let written = 0;
      while (written < buffer.length) {
        const chunk = writeSync(this.#fd, buffer, written, buffer.length - written);
        if (chunk <= 0) throw new PersistentLogError('PARTIAL_WRITE');
        written += chunk;
      }
      if (this.#fsync) fsyncSync(this.#fd);
      this.#writeHead();
    } catch (error) {
      // الذاكرة تقدّمت والقرص لم يلحق: هذا الكائن لم يعد جديراً بالكتابة.
      this.#closed = true;
      throw error;
    }
    return event;
  }

  /** يُغلق المِقبض ويفلت القفل. بعده لا إلحاق: كائنٌ مغلق يرفض لا يتظاهر. */
  close(): void {
    if (this.#fd !== null) {
      closeSync(this.#fd);
      this.#fd = null;
    }
    this.#releaseLock();
    this.#closed = true;
  }
}
