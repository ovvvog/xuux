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
import { ledgerEntryBody } from './hsm-binding.mjs';
import { isProductionRuntime } from './production-boot.mjs';
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
  'SIGNED_LEDGER_REQUIRES_ASYNC',
  'LEDGER_ENTRY_UNSIGNED',
  'LEDGER_SIGNATURE_INVALID',
  'LEDGER_KEY_MISMATCH',
  'LEDGER_SIGNER_MISSING',
  // `UF-07`: الدفترُ أقصرُ ممّا يشهدُ له الشاهدُ الخارجيُّ — محوٌ لا انقطاع.
  'LEDGER_BEHIND_WITNESS',
  // `UF-13`: مجلَّدُ الحجوزاتِ مفقودٌ — خطأٌ مُسمَّى لا `ENOENT` خامٌ.
  'LEDGER_STATE_ROOT_MISSING',
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
  /**
   * موقّعُ قراراتِ الدفترِ (F07 داخلَ التوكن، `WL-092`). إن وُصِل:
   *   • كلُّ سطرٍ يُكتبُ موقَّعاً عبر `commitSigned`/`abortSigned` غيرِ المتزامنين،
   *   • والمساراتُ المتزامنةُ تُرفَض (`SIGNED_LEDGER_REQUIRES_ASYNC`) لأنّ التوكنَ
   *     لا يوقّعُ متزامناً، وتوقيعٌ برمجيٌّ بديلاً عنه هو عينُ ما يُمنَع،
   *   • والتحميلُ يرفضُ سطراً غيرَ موقّعٍ أو مُعدَّلاً أو منسوباً إلى مفتاحٍ آخر.
   */
  signer?: LedgerDecisionSigner | null;
  /**
   * شاهدٌ خارجيٌّ لعدَّ الأوامرِ المُثبَّتةِ (‏`UF-07`، بقيةُ `WL-011`).
   * أثبتَ العضوُ الأولُ أنّ حذفَ ملفِّ الدفترِ **ومجلَّدِ حجوزاتِه معاً**
   * يُعيدُ قبولَ أمرٍ ثُبِّتَ، لأن شاهدَ الدفترِ كان الدفترَ نفسَه.
   */
  witness?: LedgerWitness | null;
  /**
   * ختمُ الشاهدِ بعدَ إلحاقِ قرارٍ موقَّعٍ (‏`R3-A-01`). الإلحاقُ يرفعُ الشاهدَ
   * متزامناً، والختمُ لا يكونُ إلا لا-متزامناً؛ فيُنادى هنا حيثُ يجوزُ الانتظارُ.
   */
  sealWitness?: (() => Promise<void>) | null;
  /**
   * تهيئةٌ أولى مُعلَنةٌ لجذرِ الحالة. يُمرِّرُها المصنعُ الإنتاجيُّ وحدَه حين
   * يقولُ بيانُ الجذرِ إنه لم يُهيَّأ بعد؛ وعندَها يُنشَأُ المجلَّدانِ. وفي كلِّ
   * إقلاعٍ بعدَها غيابُ المجلَّدِ **محوٌ يُرَدُّ** لا نقصٌ يُكمَّل (‏`UF-13`).
   */
  provisioning?: boolean;
  /** بيئةُ التشغيلِ — تُقرأُ لمعرفةِ هل يُنشأُ مجلَّدُ الحجوزاتِ ضمناً أم لا. */
  env?: NodeJS.ProcessEnv;
}

/**
 * شاهدٌ دائمٌ لعدَّ المُثبَّتاتِ يسكنُ **خارجَ الدفترِ ومجلَّدِ حجوزاتِه**.
 * عقدٌ بنيويٌّ لا اقترانٌ بوحدةٍ، يُملأُ في الإنتاجِ من `StateManifest`.
 */
export interface LedgerWitness {
  read(): number;
  raise(value: number): void;
}

/**
 * أقلُّ ما يحتاجُه الدفترُ من موقّعِ F07. عقدٌ بنيويٌّ يُوافقُ `HsmSigner` ولا
 * يورِّثُه: الدفترُ لا يعرفُ PKCS#11، والتوقيعُ نداءٌ غيرُ متزامنٍ إلى التوكن،
 * والتحقّقُ متزامنٌ بالمفتاحِ العامِّ المُصدَّرِ من التوكن.
 */
export interface LedgerDecisionSigner {
  /** معرّفُ المفتاحِ في التوكن (F07 = `07`). */
  readonly keyId: string;
  /** إصدارُ المفتاحِ الذي يوقّعُ الآن. */
  readonly activeVersion: number;
  /**
   * يوقّعُ مادةً داخلَ التوكن.
   * @param payload - المادةُ المنضبطة
   * @returns التوقيعُ بترميز base64url
   */
  signAsync(payload: object): Promise<string>;
  /**
   * يتحقّقُ بالمفتاحِ العامّ.
   * @param payload - المادةُ الموقّعة
   * @param signature - التوقيع
   * @returns صحّتُه
   */
  verify(payload: object, signature: string): boolean;
}

/** سطرُ دفترٍ موقَّعٌ كما يُكتبُ ويُقرأُ من القرص. */
export interface SignedLedgerEntryRecord extends LedgerEntry {
  keyId: string;
  keyVersion: number;
  signature: string;
}

/** خلاصةُ تحقّقٍ من توقيعاتِ الدفترِ كاملاً — للتدقيقِ ولحزمِ الأدلة. */
export interface LedgerSignatureAudit {
  ok: boolean;
  entries: number;
  signed: number;
  problemAt?: number;
  problem?: CommandLedgerErrorCode;
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
  readonly #signer: LedgerDecisionSigner | null;
  readonly #witness: LedgerWitness | null;
  readonly #sealWitness: (() => Promise<void>) | null;

  /**
   * @param file - مسار دفتر المعرّفات الدائم
   * @param options - مزامنة القرص
   */
  constructor(file: string, options: CommandLedgerOptions = {}) {
    this.file = file;
    this.claimsDir = file + LEDGER_CLAIMS_SUFFIX;
    this.ids = new Set();
    this.#fsync = options.fsync ?? true;
    // الموقّعُ يُثبَّتُ قبلَ `load()`: التحميلُ نفسُه يتحقّقُ من التوقيعاتِ، فلو
    // أُسنِدَ بعدَه لكان أولُ تحميلٍ يقبلُ سطراً غيرَ موقّعٍ صامتاً.
    this.#signer = options.signer ?? null;
    this.#witness = options.witness ?? null;
    this.#sealWitness = options.sealWitness ?? null;
    // خارجَ الإنتاجِ يُنشأُ المجلَّدانِ ضمناً كما كان؛ أمّا في الإنتاجِ فلا:
    // مجلَّدُ حجوزاتٍ مفقودٌ قد يكونُ محواً، وإنشاءُه صامتاً يمحو أثرَ المحو
    // (‏`UF-13`).
    if (isProductionRuntime(options.env ?? process.env) && options.provisioning !== true) {
      if (!existsSync(dirname(file)) || !existsSync(this.claimsDir)) {
        throw new CommandLedgerError('LEDGER_STATE_ROOT_MISSING', { detail: basename(file) });
      }
    } else {
      mkdirSync(dirname(file), { recursive: true });
      mkdirSync(this.claimsDir, { recursive: true });
    }
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
    if (!existsSync(this.file)) {
      // مراجعة R4-B-02: غيابُ ملفِّ الدفترِ لا يتجاوزُ الشاهدَ — دفترٌ مفقودٌ
      // بشاهدٍ غيرِ صفريٍّ هو دفترٌ مُحيّاً لا دفترٌ جديد. الفشلُ مغلقٌ.
      if (this.#witness !== null) {
        const witnessed = this.#witness.read();
        if (witnessed > 0) {
          throw new CommandLedgerError('LEDGER_BEHIND_WITNESS', {
            detail: `الدفتر 0 والشاهد ${String(witnessed)}`,
          });
        }
      }
      return;
    }
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
      // سطرٌ موقَّعٌ يُتحقَّقُ منه **قبلَ** أن يدخلَ الذاكرة: دفترٌ يُحمَّلُ ثم
      // يُتحقَّقُ منه لاحقاً هو دفترٌ عملَ بسطرٍ مزوَّرٍ لحظةً واحدةً على الأقل.
      if (this.#signer !== null) this.#assertEntrySigned(entry, index + 1);
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
    // الشاهدُ يُقابَلُ **بعدَ** القراءةِ وقبلَ أوّلِ استعمالٍ: دفترٌ فيه من
    // المُثبَّتاتِ أقلُّ ممّا شهدَ له الشاهدُ ليس دفتراً ناقصاً بل دفتراً مُحيّاً
    // (‏`UF-07`). والفشلُ مغلقٌ: لا يُقبَلُ أمرٌ على دفترٍ لا يُوافقُ شاهدَه.
    if (this.#witness !== null) {
      const witnessed = this.#witness.read();
      if (this.ids.size < witnessed) {
        throw new CommandLedgerError('LEDGER_BEHIND_WITNESS', {
          detail: `الدفتر ${String(this.ids.size)} والشاهد ${String(witnessed)}`,
        });
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
    this.#assertSyncAllowed();
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
    this.#assertSyncAllowed();
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
    this.#assertSyncAllowed();
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
    this.#assertSyncAllowed();
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
    // مجلَّدٌ مفقودٌ يُرفَعُ برمزِه لا بـ`ENOENT` خامٍ يُقرأُ عطلَ قراءةٍ (‏`UF-13`).
    this.#assertClaimsDir();
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
   * يُثبت تنفيذَ أمرٍ محجوزٍ **بقرارٍ موقَّعٍ داخلَ التوكن** (F07). نظيرُ `commit`
   * بنفسِ ترتيبِ الفحوصِ ونفسِ الأخطاء، والتوقيعُ يقعُ **قبلَ** الكتابةِ: فلا
   * يُكتبُ سطرٌ ثم يُطلبُ له توقيعٌ قد لا يأتي، ولا يُكتبُ سطرٌ بلا منشأٍ تشفيريّ.
   * @param command - الأمر
   * @param reason - سببٌ يُسجَّلُ عند الحاجة
   * @returns السطرُ الموقَّعُ كما كُتب
   */
  async commitSigned(command: RecordedCommand, reason?: string): Promise<SignedLedgerEntryRecord> {
    const signer = this.#assertSigner();
    const id = this.#assertId(command);
    if (!existsSync(this.#claimPath(id))) throw new CommandLedgerError('UNCLAIMED_COMMAND', { id });
    this.load();
    if (this.ids.has(id)) throw new CommandLedgerError('REPLAYED_COMMAND', { id });
    return this.#appendSignedEntry(signer, id, 'committed', reason);
  }

  /**
   * يُلغي حجزَ أمرٍ عُلم أن أثرَه لم يقع، بقرارٍ موقَّعٍ داخلَ التوكن.
   * @param command - الأمر
   * @param reason - سببُ الإلغاء، يُسجَّلُ ويدخلُ التوقيع
   * @returns السطرُ الموقَّعُ كما كُتب
   */
  async abortSigned(
    command: RecordedCommand,
    reason = 'aborted by executor',
  ): Promise<SignedLedgerEntryRecord> {
    const signer = this.#assertSigner();
    const id = this.#assertId(command);
    this.load();
    if (this.ids.has(id)) throw new CommandLedgerError('REPLAYED_COMMAND', { id });
    const entry = await this.#appendSignedEntry(signer, id, 'aborted', reason);
    rmSync(this.#claimPath(id), { force: true });
    this.#fsyncDir();
    return entry;
  }

  /**
   * حجزٌ ذريٌّ ثم تثبيتٌ موقَّعٌ — نظيرُ `record` في المسارِ الإنتاجيّ.
   * @param command - الأمر
   * @returns السطرُ الموقَّع
   */
  async recordSigned(command: RecordedCommand): Promise<SignedLedgerEntryRecord> {
    this.begin(command);
    return this.commitSigned(command);
  }

  /**
   * يفصلُ حالةً غامضةً بقرارٍ موقَّعٍ صريح.
   * @param id - معرّفُ الأمر
   * @param decision - القرارُ وسببُه
   * @returns السطرُ الموقَّع
   */
  async resolveIndeterminateSigned(
    id: string,
    decision: { executed: boolean; reason: string },
  ): Promise<SignedLedgerEntryRecord> {
    const signer = this.#assertSigner();
    const current = this.state(id);
    if (current !== 'indeterminate') {
      throw new CommandLedgerError('UNKNOWN_COMMAND', { id, detail: `الحالة ${current}` });
    }
    if (decision.executed) {
      return this.#appendSignedEntry(signer, id, 'committed', decision.reason);
    }
    return this.abortSigned({ id }, decision.reason);
  }

  /**
   * يتحقّقُ من توقيعاتِ الدفترِ كاملاً بلا تحميلٍ للحالة — للتدقيقِ ولحزمِ الأدلة.
   * ولا يرفعُ خطأً: يُرجعُ موضعَ أولِ سطرٍ مرفوضٍ ورمزَه، فالتقريرُ لا يُسقِطُ
   * مُستدعيَه، والحكمُ يبقى في `load()`.
   * @returns خلاصةُ التحقّق
   */
  auditSignatures(): LedgerSignatureAudit {
    if (this.#signer === null) {
      return { ok: false, entries: 0, signed: 0, problem: 'LEDGER_SIGNER_MISSING' };
    }
    if (!existsSync(this.file)) return { ok: true, entries: 0, signed: 0 };
    const lines = readFileSync(this.file, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    let signed = 0;
    for (const [index, line] of lines.entries()) {
      let entry: Partial<SignedLedgerEntryRecord>;
      try {
        entry = JSON.parse(line) as Partial<SignedLedgerEntryRecord>;
      } catch {
        return {
          ok: false,
          entries: lines.length,
          signed,
          problemAt: index + 1,
          problem: 'CORRUPT_COMMAND_LEDGER',
        };
      }
      try {
        this.#assertEntrySigned(entry, index + 1);
        signed += 1;
      } catch (error) {
        const code = (error as CommandLedgerError).code;
        return { ok: false, entries: lines.length, signed, problemAt: index + 1, problem: code };
      }
    }
    return { ok: true, entries: lines.length, signed };
  }

  /**
   * يرفعُ خطأً إن كان الدفترُ موقَّعاً وطُلب منه مسارٌ متزامن. الرفضُ صريحٌ لا
   * توقيعٌ برمجيٌّ بديل: التوكنُ لا يوقّعُ متزامناً، والبديلُ البرمجيُّ هو الانهيارُ
   * الذي تُبنى هذه الوحدةُ لمنعِه.
   */
  #assertSyncAllowed(): void {
    if (this.#signer !== null) {
      throw new CommandLedgerError('SIGNED_LEDGER_REQUIRES_ASYNC', {
        detail: 'استعمل commitSigned/abortSigned/recordSigned',
      });
    }
  }

  /**
   * يُرجعُ الموقّعَ أو يرفضُ فشلاً مغلقاً.
   * @returns الموقّع
   */
  #assertSigner(): LedgerDecisionSigner {
    if (this.#signer === null) throw new CommandLedgerError('LEDGER_SIGNER_MISSING');
    return this.#signer;
  }

  /**
   * يتحقّقُ من سطرٍ موقَّعٍ: حضورُ حقولِ المنشأِ، ثم مطابقةُ المفتاحِ وإصدارِه،
   * ثم التوقيعُ فوقَ المادةِ نفسِها التي يبنيها `ledgerEntryBody` — مصدرٌ واحدٌ
   * للمادةِ، فلا يتفارقُ ما وُقّع عمّا يُتحقَّقُ منه.
   * @param entry - السطرُ كما قُرئ
   * @param line - رقمُ السطرِ للتشخيص
   */
  #assertEntrySigned(entry: Partial<SignedLedgerEntryRecord>, line: number): void {
    const signer = this.#assertSigner();
    const at = `السطر ${line}`;
    if (
      typeof entry.signature !== 'string' ||
      entry.signature.length === 0 ||
      typeof entry.keyId !== 'string' ||
      typeof entry.keyVersion !== 'number'
    ) {
      throw new CommandLedgerError('LEDGER_ENTRY_UNSIGNED', { detail: at });
    }
    // منشأٌ مكذوبٌ عبثٌ ولو صحَّ التوقيعُ: مفتاحٌ آخرُ أو إصدارٌ آخرُ يُرفَض.
    if (entry.keyId !== signer.keyId || entry.keyVersion !== signer.activeVersion) {
      throw new CommandLedgerError('LEDGER_KEY_MISMATCH', { detail: at });
    }
    let body: (string | number | null)[];
    try {
      body = ledgerEntryBody(entry as LedgerEntry);
    } catch {
      throw new CommandLedgerError('LEDGER_SIGNATURE_INVALID', { detail: `${at}: مادةٌ ناقصة` });
    }
    if (!signer.verify(body as unknown as object, entry.signature)) {
      throw new CommandLedgerError('LEDGER_SIGNATURE_INVALID', { detail: at });
    }
  }

  /**
   * يبني سطراً ثم يوقّعُه داخلَ التوكنِ ثم يكتبُه مُزامَناً. الترتيبُ مقصودٌ:
   * لا سطرَ على القرصِ إلا وقد صار له توقيعٌ.
   * @param signer - موقّعُ F07
   * @param id - معرّفُ الأمر
   * @param state - القرار
   * @param reason - سببُه إن وُجد
   * @returns السطرُ الموقَّع
   */
  async #appendSignedEntry(
    signer: LedgerDecisionSigner,
    id: string,
    state: 'committed' | 'aborted',
    reason?: string,
  ): Promise<SignedLedgerEntryRecord> {
    const entry: LedgerEntry = { id, state, pid: process.pid, at: new Date().toISOString() };
    if (reason !== undefined) entry.reason = reason;
    const signature = await signer.signAsync(ledgerEntryBody(entry) as unknown as object);
    const signedEntry: SignedLedgerEntryRecord = {
      ...entry,
      keyId: signer.keyId,
      keyVersion: signer.activeVersion,
      signature,
    };
    this.#writeEntry(signedEntry);
    if (this.#sealWitness !== null) await this.#sealWitness();
    return signedEntry;
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
    this.#writeEntry(entry);
  }

  /**
   * يكتبُ سطراً — موقَّعاً أو غيرَ موقَّعٍ — بكتابةٍ كاملةٍ ومزامنةٍ، ويُحدّثُ
   * الذاكرةَ. مسارُ كتابةٍ واحدٌ للمسارين، فلا يفترقُ ضمانُ الدوامِ بينهما.
   * @param entry - السطرُ كما سيُكتب
   */
  #writeEntry(entry: LedgerEntry | SignedLedgerEntryRecord): void {
    const state = entry.state;
    const id = entry.id;
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
      // الشاهدُ يُرفَعُ من مسارِ الكتابةِ الواحدِ لا من `commit` وحدَه: وإلا كان
      // المسارُ الموقَّعُ (F07) يُثبِّتُ بلا شاهدٍ فيعودُ محوُه ممكناً (‏`UF-07`).
      this.#witness?.raise(this.ids.size);
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
   * يرفعُ خطأً مُسمَّى إن اختفى مجلَّدُ الحجوزاتِ بعدَ التركيبِ (‏`UF-13`).
   * فالمستدعي يحتاجُ أن يعرفَ «جذرُ الحالةِ ناقصٌ» لا «تعذرت قراءةُ مسارٍ».
   */
  #assertClaimsDir(): void {
    if (!existsSync(this.claimsDir)) {
      throw new CommandLedgerError('LEDGER_STATE_ROOT_MISSING', {
        detail: basename(this.claimsDir),
      });
    }
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
