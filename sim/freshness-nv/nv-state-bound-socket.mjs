// @ts-nocheck
// sim/freshness-nv/nv-state-bound-socket.mjs
//
// WL-431 — **مجسُّ محاكاةٍ** لمرجعِ حداثةٍ مربوطٍ بالحالةِ على NV في swtpm (R3-A-01 / EXT-6).
//
// **ما ليسَهُ:** ليس `TpmNvFreshnessSocket` إنتاجيًّا، ولا backend مدعومًا في
// `SUPPORTED_FRESHNESS_BACKENDS`، ولا دليلًا على أنّ TPM عتاديًّا جاهز. يحملُ `testFixture`
// و`simulationOnly` فيرفضُه المدخلُ الإنتاجيُّ كما يرفضُ كلَّ مقبسِ اختبار.
//
// **العقدُ المُنفَّذُ:** `StateBoundFreshnessSocket` من `src/root-of-trust/freshness-socket.mts`
// (‏`stateBound` + `read()` + `advanceState(from, to)`)، والحكمُ بـ`judgeStateAdvance` نفسِه.
//
// **التخطيطُ على NV (فهرسانِ في هرمِ المالكِ، بلا `ORDERLY`):**
//   - `C` عدّادٌ (`nt=counter`): رتيبٌ لا ينقصُ حتى لمن يملكُ تفويضَ الكتابة؛ وهو **نقطةُ الالتزامِ**.
//     العهدُ = `C - base` حيثُ `base` قيمةُ `C` عندَ التهيئة (‏العدّادُ يبدأُ بأكبرِ قيمةٍ عرفَها الـTPM
//     لا بالصفر — TPM 2.0 Part 3 §31).
//   - `R` فهرسٌ عاديٌّ (128 بايتًا) يحملُ سجلًّا مختومًا بـSHA-256: `phase` (‏0 مُلتزَمٌ، 1 قصدٌ
//     معلّقٌ)، و`base`، و`epoch`، ومرساةُ العهدِ الحاليِّ، ومرساةُ العهدِ التالي (‏في القصدِ وحدَه).
//
// **ترتيبُ الكتابةِ في `advanceState` (‏وتحتَ قفلٍ حصريٍّ — انظر أدناه):**
//   1. قراءةُ `C` و`R` ⇒ المرجعُ الحاليُّ (أيُّ فشلٍ أو تناقضٍ ⇒ رفضٌ مغلق).
//   2. `judgeStateAdvance(current, from, to)` ⇒ رفضٌ مسمّىً بلا أيِّ كتابة، أو `already`، أو `apply`.
//   3. كتابةُ القصدِ في `R`: `{phase: 1, epoch: from.epoch, cur: from.anchor, next: to.anchor}`.
//   4. `TPM2_NV_Increment(C)` — **نقطةُ الالتزام**.
//   5. قراءةُ `C` ثانيةً: يجبُ أن تكونَ +1 بالضبطِ وإلّا ⇒ `FRESHNESS_NV_CONCURRENT_INCREMENT` (مغلق).
//   6. كتابةُ السجلِّ المُلتزَمِ `{phase: 0, epoch: to.epoch, cur: to.anchor}`.
//
// **نوافذُ التعطّلِ وسياستُها (المرجعُ يُحسَمُ دائمًا من `C`):**
//   - قبلَ 3: لا أثر. - بينَ 3 و4: `read()` ⇒ `(from)` — لم يتقدّم؛ وإعادةُ المحاولةِ بالحُججِ نفسِها
//     تُكمِل، وانتقالٌ آخرُ من العهدِ نفسِه يُحكَمُ بقواعدِ العقدِ (القصدُ غيرُ المُلتزَمِ لا يُعتَدُّ به).
//   - بينَ 4 و6: `read()` ⇒ `(to)` — تقدّمَ؛ وإعادةُ المحاولةِ بالحُججِ نفسِها ⇒ `already` وتُتمُّ 6.
//   - `R` تالفٌ (بصمةٌ أو سحرٌ) أو `C - base` لا يطابقُ `R` بـ0 أو +1 ⇒ `FRESHNESS_NV_INCONSISTENT`.
//   **لا ذرّيّةَ مُدّعاةً بينَ فهرسَين:** الـTPM لا يقدّمُ مقارنةً وتبديلًا على عدّادٍ، ولا كتابةً ذرّيّةً
//   لفهرسَين. ذرّيّةُ الأمرِ الواحدِ (`NV_Write` لـ`R` كاملًا) **افتراضٌ لم يُقَس هنا** — والسجلُّ
//   مختومٌ بتجزئةٍ كي يُكشفَ تمزّقُه إن وقعَ لا كي يُمنَع.
//
// **التزامنُ:** الـTPM لا يمنعُ كاتبَينِ من قراءةِ `C` معًا ثمّ زيادتِه مرّتَين. لذا كلُّ
// `advanceState` يأخذُ قفلًا حصريًّا عبرَ العملياتِ (ملفٌّ يُنشأُ بـ`O_EXCL` في `lockDir`، وقفلُ عمليّةٍ
// ميّتةٍ يُستعادُ)، والخطوةُ 5 تكشفُ ما يفلتُ منه فترفضُ مغلقًا لا صامتًا. القفلُ ترتيبٌ للتزامنِ
// لا حمايةٌ من الإعادة. **الخيارُ `unsafeNoLock` للضابطِ السلبيِّ وحدَه.**
//
// **حدٌّ لا يُثبتُه هذا المجسُّ:** المرجعُ المحاكى ملفُّ حالةٍ على قرصِ المضيف
// (`tpm2-00.permall`). من استرجعَ لقطةَ التطبيقِ **ولقطةَ حالةِ المحاكي معًا** إلى زمنٍ أقدمَ حصلَ على
// حالةٍ قديمةٍ متّسقةٍ يقبلُها المجسُّ — يُقاسُ ذلك صراحةً ضابطًا سلبيًّا ولا يُدَّعى خلافُه.

import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import {
  FRESHNESS_GENESIS_ANCHOR,
  FreshnessAdvanceError,
  judgeStateAdvance,
} from '../../src/root-of-trust/index.mjs';
import { BINDING_CODES, normalizeHandle, openBindingFile, parseNvName, sealBindingFile } from './pinned-binding.mjs';
import { codedError } from './swtpm-harness.mjs';
import { manifestFnvBindingShapeError } from '../../src/root-of-trust/fnv-binding.mjs';

export const RECORD_SIZE = 128;
const MAGIC = Buffer.from('XFN1', 'ascii');

/**
 * هويةُ TPM المعلنةُ للمحاكاةِ — ليست إثباتَ هويةِ عتادٍ (لا backend إنتاجيًّا يوفرُ
 * هويةً حقيقيّةً اليوم)؛ البنيةُ نفسُها التي سيملؤها المصدرُ الحقيقيّ.
 */
export const SIM_TPM_IDENTITY = Object.freeze({ kind: 'ek-name', value: `000b${'e'.repeat(64)}` });
const HEX64 = /^[0-9a-f]{64}$/;

/** رموزُ هذا المجسِّ (‏كلُّها «نتيجةٌ مجهولةٌ أو مرجعٌ غيرُ مقروءٍ» — ليست `FreshnessAdvanceError`). */
export const NV_PROBE_CODES = Object.freeze({
  SOURCE_UNAVAILABLE: 'FRESHNESS_SOURCE_UNAVAILABLE',
  INCONSISTENT: 'FRESHNESS_NV_INCONSISTENT',
  CONCURRENT_INCREMENT: 'FRESHNESS_NV_CONCURRENT_INCREMENT',
  LOCK_TIMEOUT: 'FRESHNESS_NV_LOCK_TIMEOUT',
  TRANSPORT_LOST: 'FRESHNESS_TRANSPORT_LOST',
  NOT_PROVISIONED: 'FRESHNESS_NV_NOT_PROVISIONED',
});

function encodeAnchor(anchor) {
  if (anchor === FRESHNESS_GENESIS_ANCHOR) return Buffer.concat([Buffer.from([0]), Buffer.alloc(32)]);
  if (typeof anchor === 'string' && HEX64.test(anchor)) {
    return Buffer.concat([Buffer.from([1]), Buffer.from(anchor, 'hex')]);
  }
  return null;
}

function decodeAnchor(buf) {
  if (buf[0] === 0 && buf.subarray(1).every((b) => b === 0)) return FRESHNESS_GENESIS_ANCHOR;
  if (buf[0] === 1) return buf.subarray(1).toString('hex');
  return null;
}

/**
 * يرمّزُ سجلَّ `R`.
 * @param {{phase: 0|1, base: bigint, epoch: bigint, cur: string, next?: string}} rec
 */
export function encodeRecord(rec) {
  const out = Buffer.alloc(RECORD_SIZE);
  MAGIC.copy(out, 0);
  out[4] = 1;
  out[5] = rec.phase;
  out.writeBigUInt64BE(rec.base, 8);
  out.writeBigUInt64BE(rec.epoch, 16);
  encodeAnchor(rec.cur).copy(out, 24);
  (rec.phase === 1 ? encodeAnchor(rec.next) : Buffer.alloc(33)).copy(out, 57);
  createHash('sha256').update(out.subarray(0, 96)).digest().copy(out, 96);
  return out;
}

/** يفكُّ سجلَّ `R` أو يرفعُ `FRESHNESS_NV_INCONSISTENT`. */
export function decodeRecord(buf) {
  const bad = (why) => codedError(NV_PROBE_CODES.INCONSISTENT, `record ${why}`);
  if (!Buffer.isBuffer(buf) || buf.length !== RECORD_SIZE) throw bad('size');
  if (!buf.subarray(0, 4).equals(MAGIC) || buf[4] !== 1) throw bad('magic/version');
  const digest = createHash('sha256').update(buf.subarray(0, 96)).digest();
  if (!digest.equals(buf.subarray(96, 128))) throw bad('checksum (torn or tampered)');
  const phase = buf[5];
  if (phase !== 0 && phase !== 1) throw bad('phase');
  const cur = decodeAnchor(buf.subarray(24, 57));
  const next = phase === 1 ? decodeAnchor(buf.subarray(57, 90)) : undefined;
  if (cur === null || (phase === 1 && next === null)) throw bad('anchor');
  return {
    phase,
    base: buf.readBigUInt64BE(8),
    epoch: buf.readBigUInt64BE(16),
    cur,
    next,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * مرجعُ حداثةٍ مربوطٌ بالحالةِ على NV في swtpm — **محاكاة**.
 */
export class SwtpmNvStateBoundSocket {
  stateBound = true;
  testFixture = true;
  simulationOnly = true;
  /** عددُ الانتقالاتِ التي زادت `C` من هذه النسخة. */
  applied = 0;
  /** طابورُ أعطالٍ يُستهلَكُ في كلِّ `advanceState`. */
  faults = [];
  /** خطّافاتُ قياسٍ اختياريّة: `afterRead`، `beforeIncrement`، `afterIncrement`. */
  hooks = {};

  /**
   * @param {{tools: () => import('./swtpm-harness.mjs').Tpm2Tools, counterIndex: string,
   *   recordIndex: string, lockDir: string, lockTimeoutMs?: number, unsafeNoLock?: boolean, pinnedBase?: bigint,
   *   binding?: {file: string, publicKey: import('node:crypto').KeyObject},
   *   manifestBinding?: () => (object|null)}} opts
   *   ‏`tools` دالّةٌ لا كائنٌ: منفذُ المحاكي يتغيّرُ عندَ إعادةِ تشغيلِه.
   *   ‏`manifestBinding` (WL-434): دالّةٌ تُقرأُ **في كلّ تحقّقٍ** من البيانِ المختومِ نفسِه —
   *   البيانُ مصدرُ الحقيقةِ الوحيدُ لا ملفٌّ جانبيٌّ ثانٍ. غيابُ الربطِ (null) رفضٌ مغلقٌ.
   */
  constructor(opts) {
    this.toolsOf = opts.tools;
    this.counterIndex = opts.counterIndex;
    this.recordIndex = opts.recordIndex;
    this.lockDir = opts.lockDir;
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 10000;
    this.unsafeNoLock = opts.unsafeNoLock === true;
    /** `base` مثبَّتٌ خارجَ `R` (‏قياسُ التخفيفِ في WL-432)؛ `null` = سلوكُ WL-431. */
    this.pinnedBase = opts.pinnedBase ?? null;
    /**
     * WL-433 (‏D1-أ): ربطٌ مختومٌ خارجَ `R` بالمقبضَين واسمَي NV و`base`. إن وُجدَ فهو مصدرُ `base`
     * الوحيد، ويُتحقَّقُ منه في كلِّ قراءةٍ وانتقال (‏`sim/freshness-nv/pinned-binding.mjs`).
     */
    this.binding = opts.binding ?? null;
    /**
     * WL-434: الربطُ من متنِ البيانِ المختومِ — يُقرأُ حديثًا في كلّ تحقّقٍ لا نسخةً واحدةً
     * عندَ البناءِ، فيبقى فحصُ كلّ قراءةٍ حاضرًا ولو حُذفَ البيانُ أو حُرّفَ بعدَها.
     */
    this.manifestBinding = opts.manifestBinding ?? null;
    mkdirSync(this.lockDir, { recursive: true });
  }

  /**
   * الربطُ المثبّتُ الفعّالُ الذي يتحقّقُ منه المقبسُ — كما يكشفُه لمسارِ الإقلاعِ
   * (WL-434): مقارنةُ البيانِ والمصدرِ إلزامٌ عندَ الإقلاعِ، وغيابُ الكشفِ ليسِ تخطيًا.
   * `base` سلسلةٌ عشريةٌ كانونيةٌ كي تُقارَنَ بالقيمةِ لا بالنوعِ. ملفُّ WL-433 الجانبيُّ
   * أقدمُ مخطّطًا ولا يحملُ الهويةَ والسياسةَ — حدٌّ معلَنٌ في المقارنةِ.
   * @returns {{counterIndex: string, recordIndex: string, counterName: string, recordName: string,
   *   base: string, tpmIdentity?: object, authPolicy?: object}|null}
   */
  pinnedBinding() {
    if (this.manifestBinding !== null) {
      let fromManifest;
      try {
        fromManifest = this.manifestBinding();
      } catch (error) {
        // بيانٌ محذوفٌ أو مُحرَّفٌ أثناءَ التشغيلِ: رفضٌ مسمّى لا خطأٌ مجهولٌ يُقرأُ B0.
        throw codedError(BINDING_CODES.INVALID, `manifest binding unreadable: ${error.code ?? error.name}`);
      }
      if (fromManifest === null) return null;
      const shapeError = manifestFnvBindingShapeError(fromManifest);
      if (shapeError !== null) throw codedError(BINDING_CODES.INVALID, `manifest binding ${shapeError}`);
      return fromManifest;
    }
    if (this.binding !== null) {
      const file = openBindingFile(this.binding.file, this.binding.publicKey);
      return {
        counterIndex: file.counterIndex,
        recordIndex: file.recordIndex,
        counterName: file.counterName,
        recordName: file.recordName,
        base: file.base.toString(),
      };
    }
    return null;
  }

  /**
   * مادّةُ الربطِ من المرجعِ الحيّ (‏WL-434، مراسمُ B10 المعلنة): المقبضانِ المضبوطانِ
   * واسمَا NV كما يُقرآنِ الآنَ من `NV_ReadPublic` و`base` كما يُقرأُ من `C`. **الهويةُ
   * والسياسةُ معلَنتانِ للمحاكاةِ** (‏`SIM_TPM_IDENTITY` ولا سياسةَ على فهرسَي المحاكاةِ)
   * لا إثباتَ هويةِ عتادٍ — ذاك حدُّ الـbackend الحقيقيّ.
   * @returns {Promise<import('../../src/root-of-trust/fnv-binding.mjs').FnvBindingMaterial>}
   */
  async fnvBindingMaterial() {
    const counterName = await this.#nvName(this.counterIndex);
    const recordName = await this.#nvName(this.recordIndex);
    return {
      counterIndex: normalizeHandle(this.counterIndex),
      recordIndex: normalizeHandle(this.recordIndex),
      counterName,
      recordName,
      base: (await this.#readCounter()).toString(),
      tpmIdentity: SIM_TPM_IDENTITY,
      authPolicy: { counter: '', record: '' },
    };
  }

  get lockFile() {
    return join(this.lockDir, `fnv-${this.counterIndex}.lock`);
  }

  async #tpm(tool, args, opts) {
    try {
      return await this.toolsOf().exec(tool, args, opts);
    } catch (error) {
      throw codedError(NV_PROBE_CODES.SOURCE_UNAVAILABLE, `${tool} failed`, { cause: error });
    }
  }

  async #readCounter() {
    const raw = await this.#tpm('tpm2_nvread', ['-C', 'o', '-s', '8', this.counterIndex]);
    if (raw.length !== 8) throw codedError(NV_PROBE_CODES.SOURCE_UNAVAILABLE, `counter read ${raw.length} bytes`);
    return raw.readBigUInt64BE(0);
  }

  async #readRecord() {
    const raw = await this.#tpm('tpm2_nvread', ['-C', 'o', '-s', String(RECORD_SIZE), this.recordIndex]);
    return decodeRecord(raw);
  }

  async #nvName(index) {
    return parseNvName(await this.#tpm('tpm2_nvreadpublic', [index]));
  }

  /**
   * `base` المثبَّت: من الربطِ المختومِ في البيانِ (‏WL-434) إن وُجدَ، أو من ملفِّ
   * الربطِ الجانبيّ (‏WL-433)، أو من `pinnedBase`، أو `null` (‏سلوكُ WL-431: `base` من `R`).
   */
  async #pinned() {
    if (this.manifestBinding !== null) {
      const b = this.pinnedBinding();
      // ‏`null` = بيانٌ تاريخيّ (v2) بلا ربطٍ: ما قبلَ المراسمِ — سلوكُ WL-431/432 (base
      // من `pinnedBase` أو `R`). أمّا بيانُ NV (v3) فربطُهُ إلزامٌ في المتنِ نفسِهِ،
      // وفقدانُهُ أو تحريرُهُ يُرفَضُ قراءةً لا يُكمَلُ استنباطًا.
      if (b !== null && b !== undefined) {
        if (
        b.counterIndex !== normalizeHandle(this.counterIndex) ||
        b.recordIndex !== normalizeHandle(this.recordIndex)
      ) {
          throw codedError(BINDING_CODES.MISMATCH, 'binding handles differ from the configured indices');
        }
        const [cn, rn] = [await this.#nvName(this.counterIndex), await this.#nvName(this.recordIndex)];
        if (cn !== b.counterName) throw codedError(BINDING_CODES.MISMATCH, 'counter NV name differs from the pinned name');
        if (rn !== b.recordName) throw codedError(BINDING_CODES.MISMATCH, 'record NV name differs from the pinned name');
        return BigInt(b.base);
      }
    }
    if (this.binding === null) return this.pinnedBase;
    const b = openBindingFile(this.binding.file, this.binding.publicKey);
    if (b.counterIndex !== normalizeHandle(this.counterIndex) || b.recordIndex !== normalizeHandle(this.recordIndex)) {
      throw codedError(BINDING_CODES.MISMATCH, 'binding handles differ from the configured indices');
    }
    const [cn, rn] = [await this.#nvName(this.counterIndex), await this.#nvName(this.recordIndex)];
    if (cn !== b.counterName) throw codedError(BINDING_CODES.MISMATCH, 'counter NV name differs from the pinned name');
    if (rn !== b.recordName) throw codedError(BINDING_CODES.MISMATCH, 'record NV name differs from the pinned name');
    return b.base;
  }

  async #writeRecord(rec) {
    await this.#tpm('tpm2_nvwrite', ['-C', 'o', '-i', '-', this.recordIndex], { input: encodeRecord(rec) });
  }

  /**
   * التهيئة: تعريفُ الفهرسَين، ورفعُ `C` مرّةً (‏كي يُقرأ)، وكتابةُ `(0, genesis)` بـ`base = C`.
   * تُرفَضُ إن وُجدَ أيُّ الفهرسَين — لا إعادةُ تهيئةٍ صامتة.
   * @param {{sign?: (bytes: Buffer) => Promise<Buffer>}} [opts] - موقِّعُ الربطِ إن كان للمقبسِ `binding`
   *   (‏الخطوةُ P5: يُختَمُ بعدَ كتابةِ `R` فاسماهما نهائيّان). سقوطٌ قبلَ ختمِه ⇒ لا ربطَ ⇒ القراءةُ ترفض،
   *   والتهيئةُ لا تُعاد (‏الفهرسانِ موجودان) — مراسمُ مالكٍ لا استردادٌ تلقائيّ.
   */
  async provision(opts = {}) {
    await this.#tpm('tpm2_nvdefine', [
      '-C', 'o', '-s', '8', '-a', 'ownerread|ownerwrite|nt=counter', this.counterIndex,
    ]);
    await this.#tpm('tpm2_nvdefine', [
      '-C', 'o', '-s', String(RECORD_SIZE), '-a', 'ownerread|ownerwrite', this.recordIndex,
    ]);
    await this.#tpm('tpm2_nvincrement', ['-C', 'o', this.counterIndex]);
    const base = await this.#readCounter();
    await this.#writeRecord({ phase: 0, base, epoch: 0n, cur: FRESHNESS_GENESIS_ANCHOR });
    if (this.binding !== null) {
      if (typeof opts.sign !== 'function') throw codedError(BINDING_CODES.INVALID, 'binding signer required');
      await sealBindingFile(
        this.binding.file,
        {
          counterIndex: this.counterIndex,
          recordIndex: this.recordIndex,
          counterName: await this.#nvName(this.counterIndex),
          recordName: await this.#nvName(this.recordIndex),
          base,
        },
        opts.sign,
      );
    }
    return { base };
  }

  /** الحالةُ الخامُّ للقياس: `C` والسجلُّ والمرجعُ المحسوب. */
  async inspect() {
    const pinned = await this.#pinned();
    const counter = await this.#readCounter();
    const record = await this.#readRecord();
    return { counter, record, reference: this.#derive(counter, record, pinned) };
  }

  #derive(counter, record, pinned) {
    if (pinned !== null && record.base !== pinned) {
      // WL-432: `base` في `R` قابلٌ لإعادةِ الكتابةِ ممّن يملكُ تفويضَ كتابةِ `R`؛ فإن ثُبِّتَ خارجَه
      // (‏مثلًا في البيانِ المختوم) فاختلافُه رفضٌ مغلق — وإلّا فإعادةُ كتابتِه استرجاعٌ كاملٌ (T7).
      throw codedError(
        this.binding === null ? NV_PROBE_CODES.INCONSISTENT : BINDING_CODES.MISMATCH,
        `record base ${record.base} != pinned ${pinned}`,
      );
    }
    if (counter < record.base) {
      throw codedError(NV_PROBE_CODES.INCONSISTENT, `counter ${counter} below base ${record.base}`);
    }
    const d = counter - record.base;
    if (record.phase === 0 && d === record.epoch) {
      return { epoch: record.epoch, anchor: record.cur, pending: null };
    }
    if (record.phase === 1 && d === record.epoch) {
      return { epoch: record.epoch, anchor: record.cur, pending: 'before-increment' };
    }
    if (record.phase === 1 && d === record.epoch + 1n) {
      return { epoch: record.epoch + 1n, anchor: record.next, pending: 'after-increment' };
    }
    throw codedError(
      NV_PROBE_CODES.INCONSISTENT,
      `counter epoch ${d} vs record epoch ${record.epoch} phase ${record.phase}`,
    );
  }

  async read() {
    const pinned = await this.#pinned();
    const counter = await this.#readCounter();
    const record = await this.#readRecord();
    const ref = this.#derive(counter, record, pinned);
    return { epoch: ref.epoch, anchor: ref.anchor };
  }

  async #lock() {
    if (this.unsafeNoLock) return () => undefined;
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        const fd = openSync(this.lockFile, 'wx');
        writeSync(fd, String(process.pid));
        closeSync(fd);
        return () => rmSync(this.lockFile, { force: true });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      let holder = NaN;
      try {
        holder = Number(readFileSync(this.lockFile, 'utf8'));
      } catch {
        /* removed between open and read */
      }
      // قفلُ عمليّةٍ ميّتةٍ (‏سقوطٌ في منتصفِ انتقال) يُستعاد؛ والحكمُ بعدَه من `C` لا من القفل.
      if (Number.isInteger(holder) && holder > 0 && !pidAlive(holder)) {
        rmSync(this.lockFile, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw codedError(NV_PROBE_CODES.LOCK_TIMEOUT, this.lockFile);
      await sleep(5);
    }
  }

  async advanceState(from, to) {
    if (encodeAnchor(to?.anchor) === null || encodeAnchor(from?.anchor) === null) {
      // المجسُّ يرمّزُ المرساةَ في 33 بايتًا: `genesis` أو SHA-256 hex فقط.
      throw new FreshnessAdvanceError('FRESHNESS_ADVANCE_INVALID', null);
    }
    const release = await this.#lock();
    try {
      const fault = this.faults.shift();
      if (fault === 'throw-before-apply') {
        throw codedError(NV_PROBE_CODES.TRANSPORT_LOST, 'before apply');
      }
      const pinned = await this.#pinned();
      const counter = await this.#readCounter();
      const record = await this.#readRecord();
      const ref = this.#derive(counter, record, pinned);
      if (this.hooks.afterRead) await this.hooks.afterRead();
      if (ref.pending === 'after-increment') {
        // إصلاحٌ عديمُ الأثرِ الثاني: الالتزامُ وقعَ في `C`، والسجلُّ يُتَمّ.
        await this.#writeRecord({ phase: 0, base: record.base, epoch: ref.epoch, cur: ref.anchor });
      }
      const current = { epoch: ref.epoch, anchor: ref.anchor };
      const verdict = judgeStateAdvance(current, from, to);
      if (verdict === 'already') return current;
      await this.#writeRecord({
        phase: 1,
        base: record.base,
        epoch: from.epoch,
        cur: from.anchor,
        next: to.anchor,
      });
      if (fault === 'kill-after-intent') process.kill(process.pid, 'SIGKILL');
      if (fault === 'throw-after-intent') {
        throw codedError(NV_PROBE_CODES.TRANSPORT_LOST, 'after intent, before increment');
      }
      if (this.hooks.beforeIncrement) await this.hooks.beforeIncrement();
      await this.#tpm('tpm2_nvincrement', ['-C', 'o', this.counterIndex]);
      this.applied += 1;
      if (this.hooks.afterIncrement) await this.hooks.afterIncrement();
      if (fault === 'kill-after-increment') process.kill(process.pid, 'SIGKILL');
      if (fault === 'throw-after-increment') {
        throw codedError(NV_PROBE_CODES.TRANSPORT_LOST, 'after increment, before finalize');
      }
      const after = await this.#readCounter();
      if (after !== counter + 1n) {
        throw codedError(
          NV_PROBE_CODES.CONCURRENT_INCREMENT,
          `counter moved ${counter} -> ${after}; expected exactly +1`,
        );
      }
      await this.#writeRecord({ phase: 0, base: record.base, epoch: to.epoch, cur: to.anchor });
      if (fault === 'throw-after-finalize') {
        throw codedError(NV_PROBE_CODES.TRANSPORT_LOST, 'after finalize');
      }
      return { epoch: to.epoch, anchor: to.anchor };
    } finally {
      release();
    }
  }

  /**
   * يكتبُ سجلًّا خامًّا في `R` — **للقياسِ وحدَه** (‏كاتبٌ يملكُ تفويضَ NV يحاولُ الإرجاع، أو تلف).
   * @param {Buffer} raw
   */
  async writeRawRecordForTest(raw) {
    await this.#tpm('tpm2_nvwrite', ['-C', 'o', '-i', '-', this.recordIndex], { input: raw });
  }
}
