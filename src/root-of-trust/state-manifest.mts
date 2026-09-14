// جذرُ الثقة — بيانُ جذرِ الحالةِ الدائمُ، **مختوماً داخلَ التوكن** (`WL-098`).
//
// **لماذا كُتِبت هذه النسخةُ الثانيةُ** — الجولةُ الثالثةُ (العضو A، تقريرُ
// `M11.04-round-3-model-council-report-gpt-5-6-terra.md`) نفّذت مجَسّاً أثبتَ أنّ
// النسخةَ الأولى كانت **شاهداً بلا خاتَم**: ملفُّ JSON على القرصِ يقرؤُه الإقلاعُ
// ويثقُ بأعدادِه. فمن ملكَ القرصَ خفَضَ الأعدادَ يدوياً وحذفَ الملفّاتِ التابعةَ
// معاً، فوقعَ الثلاثةُ التي زعمَ الإصلاحُ سدَّها:
//   • `UF-01`: `anchoredCount=0` + حذفُ السجلِّ ورأسِه ومخزنِ المراسي ⇒ إقلاعٌ
//     بلا رمي، أي عودةٌ إلى `GENESIS` من بابٍ آخر.
//   • `UF-03`: `haltEpoch=0` + مسحُ `halt/` ⇒ `running` و`epoch=0` بعدَ إيقافٍ.
//   • `UF-07`: `ledgerCommitted=0` + إفراغُ الدفترِ وإعادةُ إنشاءِ الحجوزاتِ ⇒
//     قبولُ أمرٍ مكرَّرٍ ثُبِّت.
// وهي مُسجَّلةٌ نتيجةً جديدةً باسمِ `R3-A-01`.
//
// **ما يفعلُه هذا الملفُّ الآن:**
//   1. **خاتَمٌ داخلَ التوكن**: متنُ البيانِ يُوقَّعُ Ed25519 بمفتاحِ الملكِ (F06)
//      **داخلَ HSM**، ويُتحقَّقُ منه بالمفتاحِ العامِّ المُصدَّرِ منه. فلا مادةَ
//      خاصّةً في الذاكرةِ، ولا اعتمادَ شبكيَّ، ولا عتادَ جديدٌ.
//   2. **ربطُ الخاتَمِ بالهويةِ والسياقِ والإصدارِ**: `kingId` و`tokenSerial`
//      و`moduleSha256` و`context` و`version` و`instanceId` كلُّها **داخلَ المتنِ
//      الموقَّعِ**، فلا يُنقَلُ بيانُ نشرٍ إلى نشرٍ آخرَ ولا إلى توكنٍ آخرَ.
//   3. **دفترُ رفعٍ متسلسلٌ بالتجزئة**: الرفعُ متزامنٌ (يناديه الدفترُ ومفتاحُ
//      الإيقافِ من مسارٍ متزامنٍ) والتوقيعُ لا يكونُ إلا لا-متزامناً. فبدلَ ادّعاءِ
//      توقيعٍ متزامنٍ — وهو لا يكونُ إلا بمادةٍ برمجيّةٍ محليّةٍ، وذاك عينُ ما
//      يُمنَعُ — تُلحَقُ كلُّ زيادةٍ سطراً في دفترٍ **مُسلسَلٍ بالتجزئةِ** رأسُه
//      مختومٌ عندَ كلِّ نقطةِ ضبطٍ (`checkpointAsync`).
//
// **منعُ الإعادةِ (rollback/replay) — قرارٌ معماريٌّ لا ادعاءٌ:**
//   • الخاتَمُ يمنعُ **التزييفَ والتخفيضَ بالتحريرِ**: لا يُخفَضُ حقلٌ ولا يُستبدَلُ
//     بيانٌ بآخرَ من نشرٍ أو توكنٍ أو هويةٍ أخرى.
//   • ولا يمنعُ **الإعادةَ**: من ملكَ القرصَ وأعادَ لقطةً كاملةً متّسقةً (البيانُ
//     المختومُ ودفترُ الرفعِ وحالةُ التوكنِ نفسُها) فتوقيعُها صحيحٌ لأنّه وقّعَ
//     حالةً كانت صحيحةً يوماً. **صحّةُ التوقيعِ ليست حمايةً من الإعادة.**
//   • ولا يُصطنَعُ هنا «عدّادٌ رتيبٌ» في ملفٍّ آخرَ على القرصِ يُسمَّى منعَ إعادةٍ:
//     مصدرُ الحقيقةِ يبقى البيانَ المختومَ وحدَه، ودفترُ الرفعِ لا يُقرأُ إلا
//     مُسلسَلاً بالتجزئةِ إلى رأسٍ **داخلَ المتنِ الموقَّعِ** ومربوطاً بنسخةِ
//     الجذرِ؛ فهو امتدادٌ للجذرِ المختومِ لا جذرٌ ثانٍ.
//   • المنعُ الكاملُ يقتضي عدّاداً رتيباً **داخلَ عتادٍ** أو مرساةً **خارجَ نطاقِ
//     القرصِ**، وكلاهما ممنوعٌ في هذه الدفعةِ نصّاً. فالحدُّ مُعلَنٌ خطراً
//     متبقّياً في `docs/adr/0006-state-manifest-seal-and-anti-rollback-limit.md`، ولا يُسجَّلُ
//     إغلاقاً.
//   • وأقوى ضمانٍ محليٍّ مُطبَّقٌ الآن: نقطةُ ضبطٍ مختومةٌ عندَ كلِّ إقلاعٍ تُقلِّصُ
//     نافذةَ الإعادةِ غيرِ المكشوفةِ إلى ما بينَ إقلاعينِ، مع الفحوصِ المتقاطعةِ
//     القائمةِ (المراسي والدفترُ ومفتاحُ الإيقافِ) التي تكشفُ اللقطةَ الجزئيّة.

import { createHash, createHmac } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { isProductionRuntime } from './production-boot.mjs';

/** اسمُ الملفِّ في جذرِ الحالةِ — مثبَّتٌ كي لا يُخترَع في موضعينِ. */
export const STATE_MANIFEST_FILE = 'root-of-trust.manifest.json';

/** دفترُ الرفعِ المتسلسلُ بالتجزئةِ — يجاورُ البيانَ ويُطوى عندَ نقطةِ الضبط. */
export const STATE_JOURNAL_FILE = 'root-of-trust.manifest.journal';

/**
 * قفلُ الكاتبِ الواحدِ على دفترِ الرفعِ (‏`WL-165`، امتدادُ `R4-B-03`/`M11.04-F05`).
 *
 * **لماذا صارَ لازماً:** الرفعُ كان يقرأُ الرأسَ ثمَّ يُلحِقُ سطراً بلا أيِّ حجزٍ،
 * والقيمةُ المقروءةُ من ذاكرةِ العمليةِ لا من القرصِ. فعمليّتانِ ترفعانِ الشاهدَ
 * نفسَه — وهو ما يفعلُه بالضبطِ مُثبِّتُ السجلِّ خارجَ العمليةِ (`scripts/anchor-log.mjs`)
 * معَ الخدمةِ العاملةِ — تكتبانِ سطرينِ يحملانِ `prev` نفسَه أو قيمةً غيرَ صاعدةٍ،
 * فيُقرأُ الدفترُ عندَ الإقلاعِ التالي `STATE_MANIFEST_JOURNAL_INVALID` ولا يُقلعُ
 * جذرُ الثقةِ إلّا بحذفٍ يدويٍّ. أي أنَّ تعدُّدَ الكُتّابِ كان تعطيلاً ذاتيّاً
 * كامناً لا مجرَّدَ سباقٍ. فالرفعُ ونقطةُ الضبطِ صارا داخلَ قفلٍ حصريٍّ، والقراءةُ
 * داخلَ القفلِ **من القرصِ** لا من الذاكرةِ.
 */
export const STATE_JOURNAL_LOCK_SUFFIX = '.lock';

/** المتغيّرُ الذي يُعلَنُ به إذنُ التهيئةِ — إعلانٌ لا استنباط. */
export const STATE_PROVISION_ENV = 'XUUX_ROOT_OF_TRUST_PROVISION';

/** سياقُ النشرِ المُعلَنُ — يدخلُ المتنَ الموقَّعَ فلا يُنقَلُ بيانٌ بينَ نشرينِ. */
export const STATE_CONTEXT_ENV = 'XUUX_STATE_CONTEXT';

/** إصدارُ صيغةِ البيانِ. يدخلُ المتنَ الموقَّعَ: صيغةٌ أقدمُ لا تُقبَلُ صامتةً. */
export const STATE_MANIFEST_VERSION = 2;

/** أخطاءُ البيانِ، مثبَّتةٌ نصاً كي تُختبرَ ولا تُخمَّن. */
export const StateManifestErrorCodes = [
  'STATE_ROOT_UNPROVISIONED',
  'STATE_MANIFEST_CORRUPT',
  'STATE_MANIFEST_KING_MISMATCH',
  'STATE_MANIFEST_REGRESSION',
  'STATE_PROVISION_NOT_DECLARED',
  'STATE_MANIFEST_SEAL_MISSING',
  'STATE_MANIFEST_SEAL_INVALID',
  'STATE_MANIFEST_BINDING_MISMATCH',
  'STATE_MANIFEST_VERSION_UNSUPPORTED',
  'STATE_MANIFEST_JOURNAL_INVALID',
  'STATE_MANIFEST_JOURNAL_UNAUTHENTICATED',
  'STATE_MANIFEST_ROLLBACK_DETECTED',
  'STATE_MANIFEST_SEALER_REQUIRED',
  'STATE_MANIFEST_JOURNAL_LOCKED',
] as const;

export type StateManifestErrorCode = (typeof StateManifestErrorCodes)[number];

/** خطأُ البيان: رسالتُه رمزُه، وتفصيلُه أسماءٌ وأعدادٌ لا أسرار. */
export class StateManifestError extends Error {
  readonly code: StateManifestErrorCode;
  readonly detail?: string;

  /**
   * @param code - رمزُ الخطأ
   * @param detail - تفصيلٌ يُقرأُ برمجياً، بلا قيمةِ سرٍّ فيه
   */
  constructor(code: StateManifestErrorCode, detail?: string) {
    super(code);
    this.name = 'StateManifestError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** الحقولُ الثلاثةُ الرتيبةُ التي لا تنزلُ. */
export type MonotonicKey = 'anchoredCount' | 'haltEpoch' | 'ledgerCommitted';

/** ما يربطُ البيانَ بنظامِه: هويةٌ وسياقٌ وتوكنٌ وموديول. */
export interface StateManifestBinding {
  kingId: string;
  context: string;
  tokenSerial: string;
  moduleSha256: string;
}

/** متنُ البيانِ كما يُوقَّعُ ويُحفَظُ. لا يحملُ مادةَ مفتاحٍ ولا سرّاً. */
export interface StateManifestBody extends StateManifestBinding {
  version: number;
  /** مُعرِّفُ نسخةِ الجذرِ — عشوائيٌّ عندَ التهيئةِ، يربطُ المواضعَ الثلاثةَ. */
  instanceId: string;
  createdAt: string;
  sealedAt: string;
  /** عدّادُ نقاطِ الضبطِ — يعلو ولا ينزل. */
  sequence: number;
  anchoredCount: number;
  haltEpoch: number;
  ledgerCommitted: number;
  /** رأسُ دفترِ الرفعِ لحظةَ الختمِ — يمنعُ قصَّ الدفترِ إلى ما قبلَ الختم. */
  journalHead: string;
}

/** البيانُ كما يُكتَبُ: متنٌ وخاتَمُه. */
export interface SealedStateManifest {
  body: StateManifestBody;
  seal: { alg: 'ed25519'; signerId: string; signature: string };
}

/** أقلُّ ما يلزمُ من الموقّعِ — يوافقُ `HsmSigner` بلا اقترانٍ بوحدتِه. */
export interface ManifestSealer {
  readonly id: string;
  signAsync(payload: object): Promise<string>;
  verify(payload: object, signature: string): boolean;
  /**
   * يستخرجُ مفتاحَ مصادقةٍ لدفترِ الرفعِ من التوكن (R4-B-01). إن وُجد، صارتْ
   * تجزئةُ سطرِ الدفترِ HMAC لا SHA-256 عاريّاً، فلا يستطيعُ مالكُ القرصِ أن
   * يَدُسَّ سطراً غيرَ مُصادَقٍ عليه ثم يُختَمَ في المتنِ. مفتاحٌ واحدٌ يُستخرجُ
   * مرةً واحدةً عندَ الإقلاع.
   */
  deriveJournalKey?(instanceId: string): Promise<string>;
}

/** حدٌّ أدنى دائمٌ: يُقرأُ ويُرفَعُ ولا يُخفَض. عقدٌ بنيويٌّ كي يُحقَنَ في الاختبار. */
export interface MonotonicFloor {
  read(): number;
  raise(value: number): void;
}

/** سطرُ دفترِ الرفعِ — مُسلسَلٌ بالتجزئةِ فلا يُقَصُّ ولا يُدَسُّ فيه. */
interface JournalEntry {
  seq: number;
  key: MonotonicKey;
  value: number;
  at: string;
  prev: string;
  hash: string;
  /**
   * مصادقةُ السطرِ بمفتاحٍ مستخرجٍ من التوكن (R4-B-01). إن وُجد، فالتجزئةُ
   * `hash` صارتْ HMAC-SHA256 لا SHA-256 عاريّاً. إن لم يكن للموقّعِ
   * `deriveJournalKey`، يبقى السطرُ بلا `mac` — وهذا مسارُ الاختبارِ فقط.
   */
  mac?: string;
}

/**
 * يقرأُ إعلانَ إذنِ التهيئةِ من البيئةِ. الإذنُ **يُعلَن** ولا يُستنبَطُ من
 * فراغِ القرصِ: جذرٌ ممحوٌّ وجذرٌ جديدٌ لا يُفرَّقانِ بالنظرِ إلى القرصِ وحدَه.
 * @param env - البيئةُ المقروءة
 * @returns هل أُعلِنَ الإذن
 */
export function stateProvisionDeclared(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[STATE_PROVISION_ENV] ?? '').trim() === '1';
}

/**
 * يبني مسارَ البيانِ من جذرِ الحالة.
 * @param root - جذرُ الحالة
 * @returns مسارُ الملف
 */
export function stateManifestPath(root: string): string {
  return join(root, STATE_MANIFEST_FILE);
}

/**
 * يقرأُ رِباطَ البيانِ من البيئةِ: الهويةُ والسياقُ والتوكنُ والموديول.
 * @param kingId - هويةُ الملكِ الحاضرة
 * @param env - البيئةُ المقروءة
 * @returns الرِباطُ كما يدخلُ المتنَ الموقَّع
 */
export function stateManifestBinding(
  kingId: string,
  env: NodeJS.ProcessEnv = process.env,
): StateManifestBinding {
  return {
    kingId,
    context: (env[STATE_CONTEXT_ENV] ?? '').trim(),
    tokenSerial: (env.XUUX_PKCS11_TOKEN_SERIAL ?? '').trim(),
    moduleSha256: (env.XUUX_PKCS11_MODULE_SHA256 ?? '').trim(),
  };
}

/** تجزئةُ سطرٍ في دفترِ الرفعِ — تشملُ السابقَ فتصيرُ سلسلةً لا كومةً. */
function journalHash(
  instanceId: string,
  entry: Omit<JournalEntry, 'hash' | 'mac'>,
  key?: string | null,
): string {
  const data = JSON.stringify({
    instanceId,
    seq: entry.seq,
    key: entry.key,
    value: entry.value,
    at: entry.at,
    prev: entry.prev,
  });
  if (key) {
    return createHmac('sha256', key).update(data).digest('hex');
  }
  return createHash('sha256').update(data).digest('hex');
}

/** كتابةٌ ذريّةٌ: ملفٌّ مؤقّتٌ ثمَّ `rename`، فلا يُقرأُ نصفُ ملفٍّ عطباً. */
function writeAtomic(file: string, text: string, fsync: boolean): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${String(process.pid)}`;
  const line = Buffer.from(text, 'utf8');
  const fd = openSync(temporary, 'w');
  try {
    let written = 0;
    while (written < line.length) written += writeSync(fd, line, written);
    if (fsync) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
}

/** إلحاقٌ كاملٌ لا جزئيٌّ صامتٌ — سطرُ دفترِ رفعٍ ناقصٌ يُقرأُ عبثاً بحقٍّ. */
function appendLine(file: string, text: string, fsync: boolean): void {
  mkdirSync(dirname(file), { recursive: true });
  const buffer = Buffer.from(text, 'utf8');
  const fd = openSync(file, 'a');
  try {
    let written = 0;
    while (written < buffer.length) written += writeSync(fd, buffer, written);
    if (fsync) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * مالكُ قفلِ الدفترِ إن كان مقروءاً.
 * @param file - ملفُّ القفل
 * @returns رقمُ العمليةِ المالكةِ أو `null`
 */
function journalLockOwner(file: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { pid?: unknown };
    return typeof parsed.pid === 'number' ? parsed.pid : null;
  } catch {
    return null;
  }
}

/**
 * هل العمليةُ حيّةٌ؟ قفلٌ لعمليةٍ ميتةٍ أثرُ تعطُّلٍ لا ملكيّةٌ.
 * @param pid - رقمُ العملية
 * @returns حياتُها
 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

/**
 * بيانُ جذرِ الحالةِ المختومُ: يُقرأُ بعدَ التحقّقِ، ويُرفَعُ ولا يُخفَض.
 *
 * دورةُ الحياةِ: `provisionAsync` مرّةً واحدةً ⇒ `openAsync` عندَ كلِّ إقلاعٍ
 * (تحقُّقٌ ثمَّ نقطةُ ضبطٍ) ⇒ `raise` متزامنٌ في مسارِ العملِ ⇒ `checkpointAsync`
 * يطوي دفترَ الرفعِ في متنٍ مختومٍ جديد.
 */
export class StateManifest {
  readonly location: string;
  readonly journalFile: string;
  /** قفلُ الكاتبِ الواحدِ على الدفترِ (‏`WL-165`). */
  readonly journalLockFile: string;
  /** هل هذه النسخةُ تحملُ القفلَ الآنَ؟ يمنعُ فكَّ قفلٍ مُتشعِّبٍ. */
  #journalLockDepth = 0;
  readonly #fsync: boolean;
  #sealer: ManifestSealer | null;
  #verified: StateManifestBody | null = null;
  /**
   * مفتاحُ مصادقةِ دفترِ الرفعِ (R4-B-01). يُستخرجُ من التوكن مرةً واحدةً عندَ
   * الإقلاعِ، فيُستعملُ في تجزئةِ سطورِ الدفترِ HMAC لا SHA-256 عاريّاً.
   */
  #journalKey: string | null = null;
  /**
   * البيئةُ التي يُقرأُ منها إعلانُ الوضعِ (‏`R4-K3-02`). تُحقَنُ في الاختبارِ
   * وتُقرأُ من العمليةِ في الإنتاجِ، فيُعرَفُ متى تكونُ مصادقةُ دفترِ الرفعِ
   * **إلزاماً** لا خياراً.
   */
  readonly #env: NodeJS.ProcessEnv;

  /**
   * @param file - مسارُ ملفِّ البيان
   * @param options - مزامنةُ القرصِ، والموقّعُ الذي يختمُ ويتحقّق، والبيئة
   */
  constructor(
    file: string,
    options: { fsync?: boolean; sealer?: ManifestSealer; env?: NodeJS.ProcessEnv } = {},
  ) {
    this.location = file;
    this.journalFile = join(dirname(file), STATE_JOURNAL_FILE);
    this.journalLockFile = this.journalFile + STATE_JOURNAL_LOCK_SUFFIX;
    this.#fsync = options.fsync ?? true;
    this.#sealer = options.sealer ?? null;
    this.#env = options.env ?? process.env;
  }

  /**
   * هل مصادقةُ دفترِ الرفعِ إلزامٌ؟ (‏`R4-K3-02`) في الإنتاجِ نعم بلا استثناءٍ:
   * تجزئةٌ عاريّةٌ (SHA-256 بلا مفتاحٍ) يقدرُ مالكُ القرصِ على حسابِها بنفسِه،
   * فسطرٌ «متّسقُ التجزئةِ» يرفعُ العدّاداتِ قسريّاً. والمصادقةُ وحدَها هي التي
   * تجعلُ الاتّساقَ برهاناً.
   * @returns هل المصادقةُ إلزامٌ في هذا الوضع
   */
  #journalAuthRequired(): boolean {
    return isProductionRuntime(this.#env);
  }

  /**
   * هل البيانُ موجودٌ على القرصِ الآن؟ يُقرأُ في كلِّ نداءٍ بلا ذاكرةٍ مؤقّتةٍ،
   * لأن عمليةً أخرى قد تكون حذفَتْه قبلَ جزءٍ من الثانية.
   * @returns وجودُه
   */
  exists(): boolean {
    return existsSync(this.location);
  }

  /**
   * يُثبِّتُ الموقّعَ الذي يُختَمُ به ويُتحقَّقُ. بلا موقّعٍ لا يُقرأُ بيانٌ في
   * مسارٍ إنتاجيٍّ — وذاك مقصودٌ: خاتَمٌ لا يُتحقَّقُ منه ليس خاتَماً.
   * @param sealer - الموقّعُ المسنودُ بالتوكن
   */
  useSealer(sealer: ManifestSealer): void {
    this.#sealer = sealer;
    this.#verified = null;
  }

  /**
   * يستخرجُ مفتاحَ مصادقةِ دفترِ الرفعِ من التوكن (R4-B-01). يُستدعى مرةً واحدةً
   * عندَ الإقلاعِ بعدَ `provisionAsync`. إن لم يكن للموقّعِ `deriveJournalKey`،
   * يبقى المفتاحُ `null` فيُسقُطُ الدفترُ إلى تجزئةٍ عاريّةٍ (مسارُ الاختبارِ).
   * بعدَ الاستخراجِ يُبطَلُ المتنُ المُتحقَّقُ مِن قبلُ ليُعادَ التحقّقُ بالمفتاح.
   */
  async initJournalKey(): Promise<void> {
    const sealer = this.#sealer;
    if (sealer === null || typeof sealer.deriveJournalKey !== 'function') {
      this.#assertJournalKeyAvailable('لا مُشتِقَّ مفتاحٍ في الموقّع');
      return;
    }
    const body = this.read();
    const key = await sealer.deriveJournalKey(body.instanceId);
    if (key === '') this.#assertJournalKeyAvailable('مفتاحٌ فارغٌ من التوكن');
    this.#journalKey = key === '' ? null : key;
    // أبطِلْ المتنَ المُتحقَّقَ مِن قبلُ ليُعادَ طيُّ الدفترِ بالمفتاحِ الآن.
    this.#verified = null;
  }

  /**
   * فشلٌ مغلقٌ حينَ تكونُ المصادقةُ إلزاماً ولا مفتاحَ (‏`R4-K3-02`). لا يُسقَطُ
   * الدفترُ إلى تجزئةٍ عاريّةٍ في الإنتاجِ: ذاك عينُ ما يجعلُ السطرَ المدسوسَ
   * مقبولاً.
   * @param detail - سببُ غيابِ المفتاحِ، اسماً لا سرّاً
   */
  #assertJournalKeyAvailable(detail: string): void {
    if (!this.#journalAuthRequired()) return;
    throw new StateManifestError('STATE_MANIFEST_JOURNAL_UNAUTHENTICATED', detail);
  }

  /**
   * يستخرجُ مفتاحَ مصادقةِ دفترِ الرفعِ من التوكنِ داخليّاً (R4-B-01). يُستدعى
   * من `openAsync` بعدَ التحقّقِ من الخاتَمِ وقبلَ طيِّ الدفترِ.
   */
  async #deriveJournalKey(instanceId: string): Promise<void> {
    const sealer = this.#sealer;
    if (sealer === null || typeof sealer.deriveJournalKey !== 'function') {
      this.#assertJournalKeyAvailable('لا مُشتِقَّ مفتاحٍ في الموقّع');
      return;
    }
    const key = await sealer.deriveJournalKey(instanceId);
    if (key === '') this.#assertJournalKeyAvailable('مفتاحٌ فارغٌ من التوكن');
    this.#journalKey = key === '' ? null : key;
  }

  /**
   * يُهيّئ جذرَ الحالةِ مختوماً، أو يفتحُ جذراً قائماً بالتحقّقِ الكامل.
   * @param binding - الرِباطُ المُعلَنُ (هويةٌ وسياقٌ وتوكنٌ وموديول)
   * @param env - البيئةُ المقروءة
   */
  async provisionAsync(
    binding: StateManifestBinding,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<void> {
    const sealer = this.#requireSealer();
    if (existsSync(this.location)) {
      await this.openAsync(binding);
      return;
    }
    if (!stateProvisionDeclared(env)) {
      throw new StateManifestError('STATE_PROVISION_NOT_DECLARED', STATE_PROVISION_ENV);
    }
    if (binding.kingId !== sealer.id) {
      throw new StateManifestError('STATE_MANIFEST_KING_MISMATCH', `يُنتظَرُ ${sealer.id}`);
    }
    const now = new Date().toISOString();
    const body: StateManifestBody = {
      version: STATE_MANIFEST_VERSION,
      kingId: binding.kingId,
      context: binding.context,
      tokenSerial: binding.tokenSerial,
      moduleSha256: binding.moduleSha256,
      instanceId: createHash('sha256')
        .update(`${binding.kingId}|${now}|${String(process.pid)}|${String(Math.random())}`)
        .digest('hex'),
      createdAt: now,
      sealedAt: now,
      sequence: 1,
      anchoredCount: 0,
      haltEpoch: 0,
      ledgerCommitted: 0,
      journalHead: 'genesis',
    };
    await this.#seal(body);
    rmSync(this.journalFile, { force: true });
    this.#verified = body;
  }

  /**
   * يفتحُ بياناً قائماً: خاتَمٌ ثمَّ رِباطٌ ثمَّ دفترُ رفعٍ ثمَّ مرساةُ حدٍّ أعلى.
   * ولا يُوثَقُ بحقلٍ واحدٍ قبلَ تمامِ الأربعةِ — وذاك عينُ ما نقضَه `R3-A-01`.
   * @param binding - الرِباطُ المُعلَنُ
   * @returns المتنُ الفعّالُ بعدَ طيِّ دفترِ الرفع
   */
  async openAsync(binding: StateManifestBinding): Promise<StateManifestBody> {
    // R4-B-01: استخرجْ مفتاحَ المصادقةِ قبلَ طيِّ الدفترِ، فلا يُقبَلُ سطرٌ غيرُ
    // مُصادَقٍ عليه. الترتيبُ مقصودٌ: الخاتَمُ أولاً، ثمَّ المفتاحُ، ثمَّ الطيُّ.
    const sealedBody = this.#verifySeal(binding);
    await this.#deriveJournalKey(sealedBody.instanceId);
    const folded = this.#foldJournal(sealedBody);
    this.#verified = folded.body;
    await this.checkpointAsync();
    return folded.body;
  }

  /**
   * نقطةُ ضبطٍ: يطوي دفترَ الرفعِ في متنٍ جديدٍ ويختمُه داخلَ التوكن. تُنادى
   * عندَ كلِّ إقلاعٍ، فنافذةُ الإعادةِ المُعلَنةُ ما بينَ إقلاعينِ لا أكثر.
   */
  async checkpointAsync(): Promise<void> {
    // WL-165: الطيُّ يحذفُ الدفترَ، فلو وقعَ رفعٌ من عمليةٍ أخرى بينَ الختمِ
    // والحذفِ لَضاعَ شاهدٌ مرفوعٌ بلا أثرٍ — وهو عينُ ما تقولُه `R4-B-03`:
    // شاهدٌ يبقى خارجَ الخاتَمِ. فالطيُّ داخلَ القفلِ والقراءةُ من القرصِ داخلَه.
    this.#acquireJournalLock();
    try {
      this.#verified = null;
      const body = this.#verify(null);
      const next: StateManifestBody = {
        ...body,
        sequence: body.sequence + 1,
        sealedAt: new Date().toISOString(),
        journalHead: 'checkpoint:' + String(body.sequence + 1),
      };
      await this.#seal(next);
      rmSync(this.journalFile, { force: true });
      this.#verified = next;
    } finally {
      this.#releaseJournalLock();
    }
  }

  /**
   * يأخذُ قفلَ الكاتبِ الواحدِ على دفترِ الرفعِ (‏`WL-165`). قفلٌ لعمليةٍ حيّةٍ
   * أخرى رفضٌ مغلقٌ برمزِه، وقفلٌ لعمليةٍ ميتةٍ أو لا يُقرأُ يُنتزَعُ مرّةً واحدةً:
   * أثرُ تعطُّلٍ لا ملكيّةٌ قائمةٌ، ولو بقيَ لعطَّلَ الرفعَ أبداً.
   */
  #acquireJournalLock(): void {
    if (this.#journalLockDepth > 0) {
      this.#journalLockDepth += 1;
      return;
    }
    mkdirSync(dirname(this.journalFile), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(this.journalLockFile, 'wx', 0o600);
        try {
          writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        } finally {
          closeSync(fd);
        }
        this.#journalLockDepth = 1;
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
        const owner = journalLockOwner(this.journalLockFile);
        if (owner !== null && owner !== process.pid && pidAlive(owner)) {
          throw new StateManifestError('STATE_MANIFEST_JOURNAL_LOCKED', `العملية ${String(owner)}`);
        }
        rmSync(this.journalLockFile, { force: true });
      }
    }
    throw new StateManifestError('STATE_MANIFEST_JOURNAL_LOCKED', 'تعذّرَ أخذُ القفل');
  }

  /** يفكُّ قفلَ الدفترِ عندَ الخروجِ من أعمقِ مستوى أُخِذَ فيه. */
  #releaseJournalLock(): void {
    this.#journalLockDepth -= 1;
    if (this.#journalLockDepth > 0) return;
    this.#journalLockDepth = 0;
    rmSync(this.journalLockFile, { force: true });
  }

  /**
   * يقرأُ المتنَ الفعّالَ. غيابُ البيانِ أو خاتَمِه أو مرساتِه فشلٌ مغلقٌ لا
   * صفرٌ صامت.
   * @returns المتنُ الفعّال
   */
  read(): StateManifestBody {
    return this.#verified ?? this.#verify(null);
  }

  /**
   * يقابلُ هويةَ الملكِ الحاضرةَ بالتي هُيِّئ بها الجذرُ.
   * @param kingId - هويةُ الملكِ الحاضرة
   */
  assertKing(kingId: string): void {
    const body = this.read();
    if (body.kingId !== kingId) {
      throw new StateManifestError('STATE_MANIFEST_KING_MISMATCH', `يُنتظَرُ ${body.kingId}`);
    }
  }

  /**
   * يرفعُ حدّاً أعلى متزامناً: سطرٌ في دفترِ الرفعِ المُسلسَلِ ثمَّ مرساةُ الحدِّ.
   * القيمةُ الأدنى تُهمَلُ بلا خطأٍ (قراءةٌ متأخّرةٌ ليست عبثاً)، والسالبةُ تُرَدُّ.
   * @param key - الحدُّ المرفوع
   * @param value - القيمةُ الجديدة
   */
  raise(key: MonotonicKey, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new StateManifestError('STATE_MANIFEST_REGRESSION', `${key}=${String(value)}`);
    }
    // R4-K3-02: لا يُكتَبُ سطرٌ غيرُ مُصادَقٍ عليه في الإنتاجِ أصلاً. ولو كُتِبَ
    // لصارَ في الدفترِ سطرٌ لا يفرقُ عن سطرِ المهاجمِ، فيُختَمُ معه في المتن.
    if (this.#journalKey === null) {
      this.#assertJournalKeyAvailable('رفعٌ بلا مفتاحِ مصادقةٍ');
    }
    // WL-165: القفلُ يلزمُ قبلَ **القراءةِ** لا قبلَ الكتابةِ وحدَها، والقيمةُ
    // والرأسُ يُقرآنِ داخلَ القفلِ ومن القرصِ لا من الذاكرةِ. فلا يُلحَقُ سطرٌ
    // برأسٍ أو بقيمةٍ قدَّمَهما كاتبٌ آخرُ في الأثناءِ فيُقرأَ الدفترُ منقطعاً.
    this.#acquireJournalLock();
    try {
      this.#verified = null;
      const body = this.#verify(null);
      if (value <= body[key]) return;
      const head = this.#journalHead(body);
      const at = new Date().toISOString();
      const seq = body.sequence;
      const entry: Omit<JournalEntry, 'hash' | 'mac'> = { seq, key, value, at, prev: head };
      const hash = journalHash(body.instanceId, entry, this.#journalKey);
      const full: JournalEntry = { ...entry, hash };
      // R4-B-01: إن وُجدَ مفتاحٌ من التوكن، فاكتبْ الـ HMAC كحقلٍ مُنفصلٍ أيضاً
      // كي يُعرفَ عندَ التحقّقِ أنَّ السطرَ مُصادَقٌ عليه لا عارٍ.
      if (this.#journalKey) {
        full.mac = hash;
      }
      appendLine(this.journalFile, JSON.stringify(full) + '\n', this.#fsync);
      this.#verified = { ...body, [key]: value };
    } finally {
      this.#releaseJournalLock();
    }
  }

  /**
   * حدُّ عهدِ الإيقافِ كواجهةٍ صغيرةٍ تُحقَنُ في `HaltSwitch` بلا اقترانٍ بالوحدة.
   * @returns الحدُّ الأدنى الدائم
   */
  haltEpochFloor(): MonotonicFloor {
    return {
      read: (): number => this.read().haltEpoch,
      raise: (value: number): void => {
        this.raise('haltEpoch', value);
      },
    };
  }

  /**
   * شاهدُ عَدِّ الأوامرِ المُثبَّتةِ كواجهةٍ صغيرةٍ تُحقَنُ في `CommandLedger`.
   * @returns الحدُّ الأدنى الدائم
   */
  ledgerWitness(): MonotonicFloor {
    return {
      read: (): number => this.read().ledgerCommitted,
      raise: (value: number): void => {
        this.raise('ledgerCommitted', value);
      },
    };
  }

  /** الموقّعُ أو خطأٌ: مسارٌ إنتاجيٌّ بلا خاتَمٍ ليس مساراً مقبولاً. */
  #requireSealer(): ManifestSealer {
    if (this.#sealer === null) {
      throw new StateManifestError('STATE_MANIFEST_SEALER_REQUIRED', this.location);
    }
    return this.#sealer;
  }

  /** يختمُ متناً ويكتبُه ذريّاً. التوقيعُ داخلَ التوكنِ لا في هذه العملية. */
  async #seal(body: StateManifestBody): Promise<void> {
    const sealer = this.#requireSealer();
    const signature = await sealer.signAsync(body);
    const sealed: SealedStateManifest = {
      body,
      seal: { alg: 'ed25519', signerId: sealer.id, signature },
    };
    writeAtomic(this.location, JSON.stringify(sealed, null, 2) + '\n', this.#fsync);
  }

  /**
   * التحقّقُ الكاملُ ثمَّ الطيُّ: خاتَمٌ، رِباطٌ، سلسلةُ دفترِ الرفعِ، مرساةُ
   * الحدِّ الأعلى. كلُّ فشلٍ رمزُه، ولا واحدَ منها يُقرأُ «حالةً افتراضيّةً».
   */
  #verify(binding: StateManifestBinding | null): StateManifestBody {
    const sealedBody = this.#verifySeal(binding);
    const folded = this.#foldJournal(sealedBody);
    this.#verified = folded.body;
    return folded.body;
  }

  /**
   * يتحقّقُ من الخاتَمِ والرباطِ فقط — بلا طيِّ دفترِ الرفعِ (R4-B-01). يُستدعى
   * أولاً، ثمَّ يُستخرجُ مفتاحُ المصادقةِ، ثمَّ يُطوى الدفترُ بالمفتاح.
   */
  #verifySeal(binding: StateManifestBinding | null): StateManifestBody {
    const sealer = this.#requireSealer();
    if (!existsSync(this.location)) {
      throw new StateManifestError('STATE_ROOT_UNPROVISIONED', this.location);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.location, 'utf8'));
    } catch {
      throw new StateManifestError('STATE_MANIFEST_CORRUPT', 'تعذّر التحليل');
    }
    const file = parsed as Partial<SealedStateManifest>;
    const body = file.body as Partial<StateManifestBody> | undefined;
    const seal = file.seal;
    if (body === undefined || typeof body !== 'object') {
      // صيغةُ ما قبلَ الختمِ: حقولٌ في جذرِ الملفِّ بلا متنٍ ولا خاتَم. تُقرأُ
      // «خاتَماً غائباً» لا «ملفاً عاطباً»، ولا تُرقَّى ضمناً بحالٍ: الترقيةُ
      // الصامتةُ هي البابُ الذي نقضَه `R3-A-01`.
      const legacy = parsed as { kingId?: unknown; anchoredCount?: unknown };
      if (typeof legacy.kingId === 'string' || typeof legacy.anchoredCount === 'number') {
        throw new StateManifestError('STATE_MANIFEST_SEAL_MISSING', 'صيغةٌ بلا خاتَم');
      }
      throw new StateManifestError('STATE_MANIFEST_CORRUPT', 'لا متنَ في الملف');
    }
    if (seal === undefined || typeof seal.signature !== 'string' || seal.signature === '') {
      // بيانٌ بلا خاتَمٍ: هذا هو شكلُ النسخةِ الأولى، وهو المسارُ الذي نقضَه
      // `R3-A-01`. لا يُقبَلُ ولا يُرقَّى صامتاً.
      throw new StateManifestError('STATE_MANIFEST_SEAL_MISSING', this.location);
    }
    if (body.version !== STATE_MANIFEST_VERSION) {
      throw new StateManifestError(
        'STATE_MANIFEST_VERSION_UNSUPPORTED',
        String(body.version ?? 'غائب'),
      );
    }
    if (
      typeof body.kingId !== 'string' ||
      body.kingId.length === 0 ||
      typeof body.context !== 'string' ||
      typeof body.tokenSerial !== 'string' ||
      typeof body.moduleSha256 !== 'string' ||
      typeof body.instanceId !== 'string' ||
      body.instanceId.length === 0 ||
      typeof body.createdAt !== 'string' ||
      typeof body.sealedAt !== 'string' ||
      typeof body.journalHead !== 'string' ||
      !Number.isSafeInteger(body.sequence) ||
      !Number.isSafeInteger(body.anchoredCount) ||
      !Number.isSafeInteger(body.haltEpoch) ||
      !Number.isSafeInteger(body.ledgerCommitted) ||
      (body.sequence as number) < 1 ||
      (body.anchoredCount as number) < 0 ||
      (body.haltEpoch as number) < 0 ||
      (body.ledgerCommitted as number) < 0
    ) {
      throw new StateManifestError('STATE_MANIFEST_CORRUPT', 'حقولٌ ناقصةٌ أو غيرُ صحيحة');
    }
    const sealedBody = body as StateManifestBody;
    // ترتيبٌ مقصودٌ: الهويةُ والرِباطُ **يُرفَضانِ قبلَ** التحقّقِ من الخاتَمِ، كي
    // يبقى الرمزُ المُبلَّغُ دقيقاً (بيانُ ملكٍ آخرَ = `KING_MISMATCH` لا خاتَمٌ
    // عاطبٌ). ولا يُوثَقُ بحقلٍ بهذا الترتيبِ: الرفضُ لا يمنحُ ثقةً، والثقةُ لا
    // تُمنَحُ إلا بعدَ نجاحِ الخاتَمِ أسفلَ هذه الفحوص.
    if (seal.signerId !== sealer.id || sealedBody.kingId !== sealer.id) {
      throw new StateManifestError('STATE_MANIFEST_KING_MISMATCH', `يُنتظَرُ ${sealer.id}`);
    }
    if (binding !== null) {
      for (const key of ['kingId', 'context', 'tokenSerial', 'moduleSha256'] as const) {
        if (sealedBody[key] !== binding[key]) {
          throw new StateManifestError('STATE_MANIFEST_BINDING_MISMATCH', key);
        }
      }
    }
    if (!sealer.verify(sealedBody, seal.signature)) {
      throw new StateManifestError('STATE_MANIFEST_SEAL_INVALID', this.location);
    }
    return sealedBody;
  }

  /** يقرأُ دفترَ الرفعِ ويتحقّقُ من سلسلتِه ثمَّ يطويه في المتن. */
  #foldJournal(body: StateManifestBody): { body: StateManifestBody; head: string } {
    if (!existsSync(this.journalFile)) return { body, head: body.journalHead };
    const lines = readFileSync(this.journalFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    // R4-K3-02: دفترٌ غيرُ فارغٍ بلا مفتاحِ مصادقةٍ في الإنتاجِ لا يُطوى: طيُّه
    // بتجزئةٍ عاريّةٍ يجعلُ كلَّ سطرٍ يحسبُه مالكُ القرصِ سطراً «صحيحاً».
    if (lines.length > 0 && this.#journalKey === null) {
      this.#assertJournalKeyAvailable('طيُّ دفترٍ بلا مفتاحِ مصادقةٍ');
    }
    let head = body.journalHead;
    const folded: StateManifestBody = { ...body };
    let first = true;
    for (const line of lines) {
      let entry: JournalEntry;
      try {
        entry = JSON.parse(line) as JournalEntry;
      } catch {
        throw new StateManifestError('STATE_MANIFEST_JOURNAL_INVALID', 'سطرٌ لا يُحلَّل');
      }
      if (entry.prev !== head) {
        // أوّلُ سطرٍ لا يتّصلُ برأسِ المتنِ المختومِ = بيانٌ أقدمُ تحتَ دفترٍ أحدثَ،
        // وهذا استرجاعٌ جزئيٌّ مكشوفٌ لا سلسلةٌ عاطبةٌ فقط.
        throw new StateManifestError(
          first ? 'STATE_MANIFEST_ROLLBACK_DETECTED' : 'STATE_MANIFEST_JOURNAL_INVALID',
          first ? 'متنٌ أقدمُ من دفترِ الرفع' : 'سلسلةٌ منقطعة',
        );
      }
      first = false;
      const { hash, mac, ...rest } = entry;
      // R4-B-01: إن وُجدَ مفتاحٌ من التوكن، فالتجزئةُ المتوقَّعةُ HMAC لا SHA-256.
      // والسطرُ المزوَّرُ بلا `mac` يُرفَضُ هنا — لا بـ`hash` الذي لا يُطابقُ HMAC.
      let nextHead: string;
      if (this.#journalKey) {
        // المفتاحُ موجودٌ: كلُّ سطرٍ يجبُ أن يحملَ `mac` يُطابقُ الـ HMAC.
        // وإن لم يكن له `mac`، فهو سطرٌ غيرُ مُصادَقٍ عليه — يُرفَضُ.
        const expected = journalHash(body.instanceId, rest, this.#journalKey);
        if (mac !== expected) {
          throw new StateManifestError(
            'STATE_MANIFEST_JOURNAL_UNAUTHENTICATED',
            'سطرٌ بلا مصادقةٍ أو بمصادقةٍ لا تُطابق',
          );
        }
        nextHead = mac;
      } else {
        // لا مفتاحَ: مسارُ الاختبارِ — تجزئةٌ عاريّةٌ. وسطرٌ يحملُ `mac` بلا
        // مفتاحٍ يُتحقَّقُ به تخفيضٌ لا سهوٌ (‏`R4-K3-02`): دفترٌ كُتِبَ مُصادَقاً
        // ثمَّ قُرِئَ بلا مفتاحٍ — يُرفَضُ في كلِّ البيئاتِ ولا يُقرأُ عاريّاً.
        if (mac !== undefined) {
          throw new StateManifestError(
            'STATE_MANIFEST_JOURNAL_UNAUTHENTICATED',
            'سطرٌ مُصادَقٌ يُقرأُ بلا مفتاحٍ',
          );
        }
        if (hash !== journalHash(body.instanceId, rest)) {
          throw new StateManifestError('STATE_MANIFEST_JOURNAL_INVALID', 'تجزئةٌ لا تُطابق');
        }
        nextHead = hash;
      }
      if (
        (entry.key !== 'anchoredCount' &&
          entry.key !== 'haltEpoch' &&
          entry.key !== 'ledgerCommitted') ||
        !Number.isSafeInteger(entry.value) ||
        entry.value <= folded[entry.key]
      ) {
        throw new StateManifestError('STATE_MANIFEST_JOURNAL_INVALID', 'قيمةٌ غيرُ صاعدة');
      }
      folded[entry.key] = entry.value;
      head = nextHead;
    }
    return { body: folded, head };
  }

  /** رأسُ دفترِ الرفعِ الحاليُّ — من الدفترِ إن وُجِدَ، وإلا من المتنِ المختوم. */
  #journalHead(body: StateManifestBody): string {
    if (!existsSync(this.journalFile)) return body.journalHead;
    const lines = readFileSync(this.journalFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const last = lines[lines.length - 1];
    if (last === undefined) return body.journalHead;
    try {
      const entry = JSON.parse(last) as JournalEntry;
      // R4-B-01: إن وُجدَ `mac`، فهو رأسُ السلسلةِ المُصادَقِ عليها.
      return entry.mac ?? entry.hash;
    } catch {
      throw new StateManifestError('STATE_MANIFEST_JOURNAL_INVALID', 'سطرٌ أخيرٌ لا يُحلَّل');
    }
  }
}
