// حاجزُ الالتزامِ — نقطةُ الالتزامِ الإنتاجيّةُ الواحدة (‏`LIVE-28`، الخيارُ ب، `WL-326`).
//
// **القراران السياديّان اللذانِ يُنفَّذانِ هنا (‏لا يُقرَّرانِ):**
//   • `D6` — كاتبٌ إنتاجيٌّ واحد: كلُّ تغييرٍ في حالةِ الجذرِ يمرُّ عبرَ `run()` في عمليةِ
//     الجذرِ وحدَها. كتابةُ حالةٍ خارجَ معاملةٍ — من هذه العمليةِ أو من غيرِها عبرَ وحداتِ
//     الجذر — تُرفَضُ برمزِها (‏`STATE_WRITE_OUTSIDE_BARRIER`)، وكتابةٌ أجنبيّةٌ بغيرِ
//     الوحداتِ تُكشَفُ ببصمةِ الحالةِ في الوضعِ المربوط (‏`STATE_FOREIGN_WRITE_DETECTED`).
//   • `D3` — لا إقرارَ قبلَ الدوام: `run()` لا تُرجِعُ نجاحاً إلّا بعدَ
//     كتابةِ الحالةِ ← مزامنتِها ← تقدّمِ المرجعِ الخارجيِّ ← ترقيةِ البيانِ المختوم.
//
// **مراحلُ المعاملة (‏§4 من التصميم):**
//   S2  سجلُّ تراجعٍ جديدٌ مُزامَنٌ، ثمَّ ختمُ `staged = {txn, from: (e, A_e)}` في البيان.
//   S3  تنفيذُ الفعل. كلُّ كتابةٍ دائمةٍ تُنادي `beforeDurableWrite` **قبلَ** أن تمسَّ
//       القرص، فيُكتَبُ ما كان قبلَها في سجلِّ التراجعِ مُزامَناً.
//   S4  (‏الوضعُ المربوطُ وحدَه) `V' = بصمةُ الحالة`، `A' = H(domain‖instanceId‖e+1‖V')`،
//       ثمَّ `advanceState((e, A_e) → (e+1, A'))` مع إعادةِ محاولةٍ آمنةٍ لنتيجةٍ مجهولة.
//   S5  الترقية: ختمُ `(e+1, A', V')` والرفوعِ المعلَّقةِ و`staged = null` معاً. ثمَّ الإقرار.
//
// **ما بعدَ رفضِ المرجعِ (‏`C12`):** الأثرُ **كُتِبَ** على القرصِ قبلَ الرفض، فليس «بلا
// أثر» (‏افتراضُ `WL-325` السادسُ الذي ثبتَ خطؤه). لا يُسترجَعُ في العمليةِ ولا يُقَرُّ به:
// يُسيَّجُ الحاجزُ (‏كلُّ نداءٍ بعدَه `COMMIT_BARRIER_FENCED`)، ويبقى `staged` مختوماً،
// فيحكمُ الإقلاعُ التالي بالمرجع: إن بقيَ المرجعُ على `from` ⇒ استرجاعٌ دقيقٌ من سجلِّ
// التراجع (‏`B2`)؛ وإلّا ⇒ رفضٌ مسمّىً لا يُتجاوَزُ إلّا بإعادةِ ربطٍ سياديّةٍ (‏`D7`، لم
// يُحسَمْ). هذا هو العقدُ الصريح، ولا يُدَّعى غيرُه.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  FRESHNESS_GENESIS_ANCHOR,
  FreshnessAdvanceError,
  type StateBoundFreshnessSocket,
  type StateBoundReading,
} from './freshness-socket.mjs';
import type { MonotonicKey, StateManifest, StateManifestBody } from './state-manifest.mjs';

/** سجلُّ التراجعِ في جذرِ الحالة — لا يُقرأُ إلّا والبيانُ يحملُ `staged` بالمعرّفِ نفسِه. */
export const STATE_UNDO_FILE = 'root-of-trust.undo.jsonl';

/** نطاقُ تجزئةِ المرساة — يدخلُ كلَّ `A_e` فلا تُنقَلُ مرساةٌ بينَ مخطّطين. */
export const STATE_ANCHOR_DOMAIN = 'xuux/state/v1';

/** أخطاءُ الحاجزِ — نصّاً كي تُختبَرَ ولا تُخمَّن. */
export const CommitBarrierErrorCodes = [
  'STATE_WRITE_OUTSIDE_BARRIER',
  'COMMIT_BARRIER_FENCED',
  'COMMIT_BARRIER_CLOSED',
  'STATE_FOREIGN_WRITE_DETECTED',
  'STATE_UNDO_INVALID',
  'STATE_UNDO_MISMATCH',
  'FRESHNESS_ADVANCE_UNRESOLVED',
] as const;

export type CommitBarrierErrorCode = (typeof CommitBarrierErrorCodes)[number];

/** خطأُ الحاجز: رمزُه رسالتُه، وسببُه الأصليُّ إن وُجِد. */
export class CommitBarrierError extends Error {
  readonly code: CommitBarrierErrorCode;
  readonly detail?: string;

  /**
   * @param code - الرمز
   * @param detail - تفصيلٌ بلا سرّ
   * @param cause - السببُ الأصليّ
   */
  constructor(code: CommitBarrierErrorCode, detail?: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'CommitBarrierError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** نوعُ الكتابةِ الدائمة: إلحاقٌ (‏يُسترجَعُ بالقصّ) أو استبدالٌ/إنشاءٌ/حذف (‏بالمحتوى). */
export type DurableWriteKind = 'append' | 'replace';

/** مكوّناتُ بصمةِ الحالة `V`: ملفّاتٌ ومجلّداتٌ بعينِها، لا جذرُ الحالةِ كلُّه. */
export interface StateLayout {
  /** ملفّاتٌ تدخلُ البصمة (‏الغائبُ والفارغُ سواء). */
  files: string[];
  /** مجلّداتٌ تدخلُ البصمةَ بأسماءِ ملفّاتِها ومحتواها (‏المؤقّتُ مستثنى). */
  dirs: string[];
}

/** سطرُ سجلِّ التراجع. */
type UndoRecord =
  | { t: 'header'; txn: string; intent: string; at: string }
  | { t: 'append'; path: string; size: number }
  | { t: 'replace'; path: string; content: string | null };

/** معاملةٌ جارية — تُحمَلُ في `AsyncLocalStorage` فتُعرَفُ كتاباتُها مهما تشعّبت. */
interface Transaction {
  readonly coordinator: CommitCoordinator;
  readonly txn: string;
  readonly intent: string;
  readonly touched: Set<string>;
  undoFd: number | null;
  done: boolean;
}

const context = new AsyncLocalStorage<Transaction>();
const registry = new Set<CommitCoordinator>();

/**
 * يُنادى **قبلَ** كلِّ كتابةٍ دائمةٍ في حالةِ الجذر. بلا حاجزٍ مُسجَّلٍ يغطّي المسارَ
 * (‏تطويرٌ، اختبارٌ، أداةٌ خارجَ جذرٍ) لا يفعلُ شيئاً. ومعه: داخلَ معاملتِه يحفظُ ما
 * قبلَ الكتابةِ مُزامَناً، وخارجَها يرفضُ — وهو عينُ `D6`.
 * @param path - المسارُ الذي سيُكتَب
 * @param kind - نوعُ الكتابة
 */
export function beforeDurableWrite(path: string, kind: DurableWriteKind): void {
  if (registry.size === 0) return;
  const absolute = resolve(path);
  for (const coordinator of registry) {
    if (coordinator.covers(absolute)) {
      coordinator.noteWrite(absolute, kind);
      return;
    }
  }
}

/**
 * هل نحنُ داخلَ معاملةٍ حيّةٍ لحاجزٍ بعينِه؟
 * @param coordinator - الحاجز
 * @returns نعم أو لا
 */
function activeTransaction(coordinator: CommitCoordinator): Transaction | null {
  const txn = context.getStore();
  if (txn === undefined || txn.coordinator !== coordinator || txn.done) return null;
  return txn;
}

/**
 * هل نحنُ داخلَ معاملةٍ حيّةٍ لهذا الحاجز؟ (‏ليُستغنى عن ختمٍ منفصلٍ تؤدّيه الترقية.)
 * @param coordinator - الحاجز
 * @returns نعم أو لا
 */
export function inCommitTransaction(coordinator: CommitCoordinator): boolean {
  return activeTransaction(coordinator) !== null;
}

/**
 * يُغلِقُ كلَّ حاجزٍ مُسجَّلٍ لجذرٍ — إقلاعٌ جديدٌ للجذرِ نفسِه في العمليةِ نفسِها يأخذُ
 * الكتابةَ ممّا سبقَه، فلا يبقى كاتبانِ في عمليةٍ واحدة.
 * @param root - جذرُ الحالة
 */
export function releaseCommitBarriersFor(root: string): void {
  const absolute = resolve(root);
  for (const coordinator of [...registry]) {
    if (coordinator.root === absolute) coordinator.close();
  }
}

/**
 * مرساةُ الحالةِ في عهدٍ: `H(domain ‖ instanceId ‖ e ‖ V)`.
 * @param instanceId - نسخةُ الجذر
 * @param epoch - العهد
 * @param digest - بصمةُ الحالة
 * @returns المرساة
 */
export function stateAnchor(instanceId: string, epoch: number, digest: string): string {
  return createHash('sha256')
    .update(`${STATE_ANCHOR_DOMAIN}\u0000${instanceId}\u0000${String(epoch)}\u0000${digest}`)
    .digest('hex');
}

/** اسمٌ مؤقّتٌ لا يدخلُ البصمة: كتابةٌ ذرّيّةٌ جاريةٌ أو حجزٌ قيدَ النشر. */
function transientName(name: string): boolean {
  return name.startsWith('.') || name.includes('.writing-') || name.endsWith('.tmp');
}

/**
 * بصمةُ الحالةِ `V` — تجزئةٌ قانونيّةٌ لمكوّناتِها. الغائبُ والفارغُ سواءٌ عمداً: فتحُ
 * سجلٍّ يُنشئُ ملفّاً فارغاً ليس تغييرَ حالة.
 * @param layout - المكوّنات
 * @returns البصمة
 */
export function computeStateDigest(layout: StateLayout): string {
  const outer = createHash('sha256');
  for (const file of [...layout.files].sort()) {
    outer.update(`f\u0000${file}\u0000${fileDigest(file)}\n`);
  }
  for (const dir of [...layout.dirs].sort()) {
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => !transientName(name));
    } catch {
      names = [];
    }
    names.sort();
    outer.update(`d\u0000${dir}\u0000${String(names.length)}\n`);
    for (const name of names) outer.update(`e\u0000${name}\u0000${fileDigest(join(dir, name))}\n`);
  }
  return outer.digest('hex');
}

/** تجزئةُ ملفٍّ، والغائبُ تجزئةُ الفارغ. */
function fileDigest(file: string): string {
  const hash = createHash('sha256');
  try {
    hash.update(readFileSync(file));
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }
  return hash.digest('hex');
}

/** كتابةٌ كاملةٌ في مقبض. */
function writeFully(fd: number, text: string): void {
  const buffer = Buffer.from(text, 'utf8');
  let written = 0;
  while (written < buffer.length) written += writeSync(fd, buffer, written);
}

/** مزامنةُ مجلّدٍ بلا رفعٍ حيثُ لا يُسمَح. */
function syncDir(dir: string, fsync: boolean): void {
  if (!fsync) return;
  let fd: number | null = null;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    /* بعضُ الأنظمةِ لا تُزامِنُ مجلّداً */
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** هل الخطأُ فشلُ إدخالٍ/إخراجٍ (‏لا رفضٌ مسمّىً من المجال)؟ */
function isIoFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return true;
  const candidate = error as { errno?: unknown; code?: unknown };
  if (typeof candidate.errno === 'number') return true;
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  return code === 'PARTIAL_WRITE' || code === 'LOG_CLOSED' || code === '';
}

/** خياراتُ الحاجز. */
export interface CommitCoordinatorOptions {
  /** جذرُ الحالة — كلُّ كتابةٍ تحتَه تمرُّ بالحاجز. */
  root: string;
  /** ملفّاتُ حالةٍ خارجَ الجذر (‏مخزنُ تثبيتاتٍ مُعلَنٌ بالبيئة). */
  extraFiles?: string[];
  manifest: StateManifest;
  /** مكوّناتُ البصمة. */
  layout: StateLayout;
  fsync?: boolean;
  /** المرجعُ المربوطُ بالحالة، أو `null` للوضعِ القديم (‏`bump()` في الإقلاعِ وحدَه). */
  socket: StateBoundFreshnessSocket | null;
  /** عددُ إعاداتِ الانتقالِ بعدَ نتيجةٍ مجهولة (‏الافتراض ٣). */
  advanceRetries?: number;
  /** يُنادى عندَ التسييج — يُغلِقُ الجذرُ به السجلَّ فيُفلِتُ قفلَه لإقلاعٍ مُستعيد. */
  onFence?: (error: Error) => void;
}

/** خلاصةُ معاملةٍ أُقِرَّت — للتدقيقِ وللاختبار. */
export interface CommitReceipt {
  txn: string;
  intent: string;
  epoch: number;
  anchor: string | null;
}

/**
 * الحاجز. واحدٌ لكلِّ جذرٍ في عمليةِ الجذرِ وحدَها.
 */
export class CommitCoordinator {
  readonly root: string;
  readonly undoFile: string;
  readonly #rootPrefix: string;
  readonly #extra: Set<string>;
  readonly #manifest: StateManifest;
  readonly #layout: StateLayout;
  readonly #fsync: boolean;
  readonly #socket: StateBoundFreshnessSocket | null;
  readonly #retries: number;
  readonly #onFence: ((error: Error) => void) | null;
  #queue: Promise<void> = Promise.resolve();
  #fence: Error | null = null;
  #closed = false;
  /** آخرُ إيصالٍ — يُقرأُ في الاختبارِ لإثباتِ الترتيب. */
  lastReceipt: CommitReceipt | null = null;
  /** مراقبُ مراحلَ — للاختبارِ وحدَه (‏تتبُّعُ الترتيب)، لا يُغيّرُ السلوك. */
  onStage: ((stage: 'S2' | 'S3' | 'S4' | 'S5' | 'ACK', intent: string) => void) | null = null;

  /**
   * @param options - الخيارات
   */
  constructor(options: CommitCoordinatorOptions) {
    this.root = resolve(options.root);
    this.#rootPrefix = this.root.endsWith(sep) ? this.root : this.root + sep;
    this.undoFile = join(this.root, STATE_UNDO_FILE);
    this.#extra = new Set((options.extraFiles ?? []).map((file) => resolve(file)));
    this.#manifest = options.manifest;
    this.#layout = options.layout;
    this.#fsync = options.fsync ?? true;
    this.#socket = options.socket;
    this.#retries = options.advanceRetries ?? 3;
    this.#onFence = options.onFence ?? null;
  }

  /** هل الحاجزُ في الوضعِ المربوطِ بالحالة؟ */
  get stateBound(): boolean {
    return this.#socket !== null;
  }

  /** سببُ التسييجِ إن سُيِّج. */
  get fenced(): Error | null {
    return this.#fence;
  }

  /**
   * يُفعِّلُ الحاجز: بعدَه كلُّ كتابةِ حالةٍ تحتَ الجذرِ خارجَ معاملةٍ مرفوضة، وكلُّ رفعٍ
   * في البيانِ داخلَ معاملةٍ يُعلَّقُ إلى الترقية. يُنادى في آخرِ الإقلاع.
   */
  activate(): void {
    for (const other of [...registry]) {
      if (other.root === this.root && other !== this) other.close();
    }
    registry.add(this);
    this.#manifest.useRaiseRouter((key: MonotonicKey) => {
      if (activeTransaction(this) !== null) return 'buffer';
      if (this.#closed) return 'journal';
      throw new CommitBarrierError('STATE_WRITE_OUTSIDE_BARRIER', `manifest:${key}`);
    });
  }

  /** يُعطِّلُ الحاجزَ ويفكُّ تسجيلَه — عندَ إغلاقِ الجذر. */
  close(): void {
    this.#closed = true;
    registry.delete(this);
    this.#manifest.useRaiseRouter(null);
  }

  /**
   * هل يغطّي الحاجزُ هذا المسار؟
   * @param absolute - مسارٌ مطلق
   * @returns نعم أو لا
   */
  covers(absolute: string): boolean {
    return absolute.startsWith(this.#rootPrefix) || this.#extra.has(absolute);
  }

  /**
   * خطّافُ الكتابة: داخلَ المعاملةِ يحفظُ ما قبلَها، وخارجَها يرفض.
   * @param absolute - المسار
   * @param kind - النوع
   */
  noteWrite(absolute: string, kind: DurableWriteKind): void {
    const txn = activeTransaction(this);
    if (txn === null) {
      throw new CommitBarrierError('STATE_WRITE_OUTSIDE_BARRIER', this.#rel(absolute));
    }
    if (txn.touched.has(absolute)) return;
    let record: UndoRecord;
    if (kind === 'append') {
      let size = 0;
      try {
        size = statSync(absolute).size;
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      }
      record = { t: 'append', path: this.#rel(absolute), size };
    } else {
      let content: string | null = null;
      try {
        content = readFileSync(absolute).toString('base64');
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      }
      record = { t: 'replace', path: this.#rel(absolute), content };
    }
    this.#appendUndo(txn, record);
    txn.touched.add(absolute);
  }

  /**
   * ينفّذُ فعلاً إنتاجيّاً عبرَ الحاجز. لا يُرجِعُ نجاحاً إلّا بعدَ الدوامِ والترقية.
   * والنداءُ من داخلِ معاملةٍ جاريةٍ يُضَمُّ إليها (‏لا تتداخلُ المعاملات).
   * @param intent - القصدُ المُعلَن
   * @param fn - الفعل
   * @returns نتيجةُ الفعل
   */
  async run<T>(intent: string, fn: () => Promise<T> | T): Promise<T> {
    return this.#enqueue(intent, fn, false);
  }

  /**
   * `B10`: الربطُ الأوّلُ بالمرجعِ المربوط — معاملةٌ بلا فعلٍ تنقلُ المرجعَ من
   * `(0, GENESIS)` إلى `(1, A_1)` فوقَ الحالةِ القائمة. يُنادى من الإقلاعِ وحدَه.
   * @param intent - القصد
   */
  async bindAsync(intent: string): Promise<void> {
    await this.#enqueue(intent, () => undefined, true);
  }

  async #enqueue<T>(intent: string, fn: () => Promise<T> | T, bind: boolean): Promise<T> {
    if (activeTransaction(this) !== null) return await fn();
    if (this.#closed) throw new CommitBarrierError('COMMIT_BARRIER_CLOSED', intent);
    if (this.#fence !== null) {
      throw new CommitBarrierError('COMMIT_BARRIER_FENCED', intent, this.#fence);
    }
    let release: () => void = () => undefined;
    const previous = this.#queue;
    this.#queue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;
    try {
      if (this.#fence !== null) {
        throw new CommitBarrierError('COMMIT_BARRIER_FENCED', intent, this.#fence);
      }
      return await this.#transact(intent, fn, bind);
    } finally {
      release();
    }
  }

  /** جسمُ المعاملة: S2 ← S3 ← S4 ← S5. */
  async #transact<T>(intent: string, fn: () => Promise<T> | T, bind: boolean): Promise<T> {
    const body = this.#manifest.read();
    // الربطُ الأوّلُ (‏`B10`) يبدأُ سلسلةَ المرجعِ المربوطِ من النشأة، أيّاً كانَ عهدُ البيانِ
    // على المسارِ القديم.
    const from = bind ? { epoch: 0n, anchor: FRESHNESS_GENESIS_ANCHOR } : this.#fromOf(body);
    if (this.#socket !== null && !bind) {
      // فحصُ الكاتبِ الأجنبيّ (‏`D6`): الحالةُ على القرصِ قبلَ المعاملةِ يجبُ أن تكونَ
      // عينَ ما خُتِمَ آخرَ مرّة. وإلّا فقد كتبَ غيرُ الكاتبِ الواحد.
      const before = computeStateDigest(this.#layout);
      if (before !== body.stateDigest) {
        throw this.#fenceWith(
          new CommitBarrierError('STATE_FOREIGN_WRITE_DETECTED', `${intent}: V_disk ≠ V_m`),
        );
      }
    }
    const txn: Transaction = {
      coordinator: this,
      txn: randomUUID(),
      intent,
      touched: new Set(),
      undoFd: null,
      done: false,
    };
    // S2: سجلُّ تراجعٍ جديدٌ مُزامَنٌ **ثمَّ** ختمُ الترحيل — فلا يوجدُ `staged` بلا سجلّ.
    this.#openUndo(txn);
    try {
      await this.#manifest.stageAsync({
        txn: txn.txn,
        intent,
        fromEpoch: Number(from.epoch),
        fromAnchor: from.anchor,
        at: new Date().toISOString(),
      });
    } catch (error) {
      this.#closeUndo(txn);
      throw error;
    }
    this.onStage?.('S2', intent);
    // S3
    let result: T | undefined;
    let failure: unknown = null;
    let failed = false;
    try {
      result = await context.run(txn, async () => await fn());
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      txn.done = true;
      this.#closeUndo(txn);
    }
    this.onStage?.('S3', intent);
    if (failed && txn.touched.size > 0 && isIoFailure(failure)) {
      // كتابةٌ انقطعت في منتصفِها: الحالةُ في الذاكرةِ والقرصِ قد افترقتا. لا يُقَرُّ بها
      // ولا يُتقدَّمُ فوقَها؛ يبقى `staged` فيسترجعُها الإقلاعُ التالي (‏`B2`).
      throw this.#fenceWith(failure as Error);
    }
    if (!bind && txn.touched.size === 0 && !this.#manifest.hasPendingRaises) {
      // لا أثرَ على القرص: لا حالةَ جديدةَ يُشهَدُ عليها.
      await this.#manifest.clearStagedAsync().catch((error: unknown) => {
        throw this.#fenceWith(error as Error);
      });
      if (failed) throw failure;
      return result as T;
    }
    // S4 + S5
    try {
      const receipt = await this.#commit(txn, body, from);
      this.lastReceipt = receipt;
    } catch (error) {
      throw this.#fenceWith(error as Error);
    }
    this.onStage?.('ACK', intent);
    // الرفضُ المسمّى من المجالِ (‏إيقافٌ مرفوضٌ كُتِبَ قيدُه) يُرفَعُ **بعدَ** دوامِ قيدِه.
    if (failed) throw failure;
    return result as T;
  }

  /** S4 ثمَّ S5. */
  async #commit(
    txn: Transaction,
    body: StateManifestBody,
    from: StateBoundReading,
  ): Promise<CommitReceipt> {
    if (this.#socket === null) {
      this.onStage?.('S4', txn.intent);
      await this.#manifest.promoteAsync(null);
      this.onStage?.('S5', txn.intent);
      return { txn: txn.txn, intent: txn.intent, epoch: body.freshnessEpoch, anchor: null };
    }
    const digest = computeStateDigest(this.#layout);
    const epoch = Number(from.epoch) + 1;
    const anchor = stateAnchor(body.instanceId, epoch, digest);
    await this.#advance(from, { epoch: BigInt(epoch), anchor });
    this.onStage?.('S4', txn.intent);
    await this.#manifest.promoteAsync({ epoch, anchor, digest });
    this.onStage?.('S5', txn.intent);
    return { txn: txn.txn, intent: txn.intent, epoch, anchor };
  }

  /**
   * الانتقالُ مع إعادةِ المحاولةِ الآمنة: رفضٌ مسمّىً نهائيٌّ؛ ونتيجةٌ مجهولةٌ تُحسَمُ
   * بالقراءة: `cur = to` ⇒ نجح؛ `cur = from` ⇒ يُعادُ بالحُجَجِ نفسِها؛ غيرُهما ⇒ رفض.
   * @param from - من
   * @param to - إلى
   */
  async #advance(from: StateBoundReading, to: StateBoundReading): Promise<void> {
    const socket = this.#socket as StateBoundFreshnessSocket;
    let lastUnknown: unknown = null;
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      try {
        const now = await socket.advanceState(from, to);
        if (now.epoch === to.epoch && now.anchor === to.anchor) return;
        throw new FreshnessAdvanceError('FRESHNESS_STALE_TRANSITION', now);
      } catch (error) {
        if (error instanceof FreshnessAdvanceError) throw error;
        lastUnknown = error;
      }
      let current: StateBoundReading;
      try {
        current = await socket.read();
      } catch (error) {
        lastUnknown = error;
        continue;
      }
      if (current.epoch === to.epoch && current.anchor === to.anchor) return;
      if (current.epoch === from.epoch && current.anchor === from.anchor) continue;
      if (current.epoch === from.epoch) {
        throw new FreshnessAdvanceError('FRESHNESS_SAME_EPOCH_FORK', current);
      }
      throw new FreshnessAdvanceError(
        current.epoch < from.epoch ? 'FRESHNESS_REFERENCE_BEHIND' : 'FRESHNESS_STALE_TRANSITION',
        current,
      );
    }
    throw new CommitBarrierError(
      'FRESHNESS_ADVANCE_UNRESOLVED',
      `بعدَ ${String(this.#retries + 1)} محاولات`,
      lastUnknown,
    );
  }

  /** من أين تبدأُ المعاملة. */
  #fromOf(body: StateManifestBody): StateBoundReading {
    return {
      epoch: BigInt(body.freshnessEpoch),
      anchor: body.freshnessAnchor ?? FRESHNESS_GENESIS_ANCHOR,
    };
  }

  /** يُسيِّجُ الحاجزَ ويُرجِعُ الخطأ. */
  #fenceWith(error: Error): Error {
    if (this.#fence === null) {
      this.#fence = error;
      this.#manifest.dropPendingRaises();
      try {
        this.#onFence?.(error);
      } catch {
        /* التسييجُ لا يُحجَبُ بفشلِ تنظيف */
      }
    }
    return error;
  }

  #rel(absolute: string): string {
    return absolute.startsWith(this.#rootPrefix) ? relative(this.root, absolute) : absolute;
  }

  #openUndo(txn: Transaction): void {
    mkdirSync(this.root, { recursive: true });
    const temporary = `${this.undoFile}.tmp`;
    const fd = openSync(temporary, 'w', 0o600);
    try {
      const header: UndoRecord = {
        t: 'header',
        txn: txn.txn,
        intent: txn.intent,
        at: new Date().toISOString(),
      };
      writeFully(fd, JSON.stringify(header) + '\n');
      if (this.#fsync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.undoFile);
    syncDir(this.root, this.#fsync);
    txn.undoFd = openSync(this.undoFile, 'a');
  }

  #appendUndo(txn: Transaction, record: UndoRecord): void {
    if (txn.undoFd === null) throw new CommitBarrierError('STATE_UNDO_INVALID', 'مقبضٌ مغلق');
    writeFully(txn.undoFd, JSON.stringify(record) + '\n');
    if (this.#fsync) fsyncSync(txn.undoFd);
  }

  #closeUndo(txn: Transaction): void {
    if (txn.undoFd !== null) {
      closeSync(txn.undoFd);
      txn.undoFd = null;
    }
  }

  /**
   * `B2`: استرجاعٌ دقيقٌ لمعاملةٍ مُرحَّلةٍ لم يتقدّمْ فوقَها المرجع. يُطبَّقُ سجلُّ التراجعِ
   * بعكسِ ترتيبِه، ثمَّ يُمحى `staged`. يُنادى في الإقلاعِ قبلَ فتحِ السجلِّ والدفتر.
   * @param root - جذرُ الحالة
   * @param manifest - البيان
   * @param txnId - معرّفُ المعاملةِ المختومُ في `staged`
   * @param fsync - المزامنة
   * @returns عددُ ما استُرجِع
   */
  static async rollbackStagedAsync(
    root: string,
    manifest: StateManifest,
    txnId: string,
    fsync: boolean,
  ): Promise<number> {
    const undoFile = join(resolve(root), STATE_UNDO_FILE);
    const records = readUndo(undoFile, txnId);
    let restored = 0;
    for (const record of records.reverse()) {
      const target = record.path.startsWith(sep) ? record.path : join(resolve(root), record.path);
      if (record.t === 'append') {
        if (!existsSync(target)) {
          if (record.size === 0) continue;
          throw new CommitBarrierError('STATE_UNDO_INVALID', `${record.path}: غائبٌ وكان أكبر`);
        }
        const size = statSync(target).size;
        if (size < record.size) {
          throw new CommitBarrierError('STATE_UNDO_INVALID', `${record.path}: أقصرُ ممّا كان`);
        }
        const fd = openSync(target, 'r+');
        try {
          ftruncateSync(fd, record.size);
          if (fsync) fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      } else if (record.t === 'replace') {
        if (record.content === null) {
          rmSync(target, { force: true });
        } else {
          mkdirSync(dirname(target), { recursive: true });
          const temporary = `${target}.undo-tmp`;
          const fd = openSync(temporary, 'w', 0o600);
          try {
            const buffer = Buffer.from(record.content, 'base64');
            let written = 0;
            while (written < buffer.length) written += writeSync(fd, buffer, written);
            if (fsync) fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          renameSync(temporary, target);
        }
        syncDir(dirname(target), fsync);
      }
      restored += 1;
    }
    await manifest.clearStagedAsync();
    return restored;
  }
}

/**
 * يقرأُ سجلَّ التراجعِ ويتحقّقُ أنّه لهذه المعاملة. سطرٌ أخيرٌ مقطوعٌ يُهمَل (‏كُتِبَ قبلَ
 * أن تمسَّ الكتابةُ الأصلُ، فلم تقعْ)؛ غيرُه عطبٌ مسمّى.
 * @param file - الملف
 * @param txnId - المعاملة
 * @returns السطورُ بعدَ الرأس
 */
function readUndo(file: string, txnId: string): Array<Exclude<UndoRecord, { t: 'header' }>> {
  if (!existsSync(file)) {
    throw new CommitBarrierError('STATE_UNDO_MISMATCH', 'لا سجلَّ تراجعٍ لمعاملةٍ مُرحَّلة');
  }
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const complete = text.endsWith('\n') ? lines.slice(0, -1) : lines.slice(0, -1);
  const records: UndoRecord[] = [];
  for (const line of complete) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line) as UndoRecord);
    } catch {
      throw new CommitBarrierError('STATE_UNDO_INVALID', 'سطرٌ لا يُحلَّل');
    }
  }
  const header = records.shift();
  if (header === undefined || header.t !== 'header' || header.txn !== txnId) {
    throw new CommitBarrierError('STATE_UNDO_MISMATCH', 'رأسُ السجلِّ لمعاملةٍ أخرى');
  }
  const body: Array<Exclude<UndoRecord, { t: 'header' }>> = [];
  for (const record of records) {
    if (
      (record.t === 'append' &&
        typeof record.path === 'string' &&
        Number.isSafeInteger(record.size)) ||
      (record.t === 'replace' &&
        typeof record.path === 'string' &&
        (record.content === null || typeof record.content === 'string'))
    ) {
      body.push(record);
      continue;
    }
    throw new CommitBarrierError('STATE_UNDO_INVALID', 'سطرٌ بشكلٍ غيرِ معروف');
  }
  return body;
}
