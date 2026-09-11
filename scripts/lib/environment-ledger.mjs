/**
 * دفترُ أثرِ الإقامةِ على القرص — الخطوة `M10.05`، وقرارُه `ADR 0008`.
 *
 * **ما تغيَّر عن الصيغةِ الأولى:** كان مُلحِقَ أسطرٍ بلا ترقيمٍ ولا رأسٍ، فحذفُ
 * سطرٍ منه أو تبديلُ حقلٍ فيه لا يُكشَف. صار الآن **دفتراً مستقلّاً بسلسلةِ
 * بصماتٍ ورأسٍ ذرّيٍّ**: كلُّ قيدٍ يحمل ترتيبَه وبصمَ سابقِه وبصمَ نفسِه، ورأسٌ
 * منفصلٌ يشهد بعدَدِ القيودِ وبصمِ آخرِها ويُثبَّت بإحلالٍ ذرّيٍّ (`rename`).
 * والحكمُ على الدفترِ في وحدةٍ نقيّةٍ لا تلمس قرصاً: `src/environment/ledger-chain.mjs`.
 *
 * **وثلاثةُ حدودٍ مُعلَنةٍ في المتنِ لا في الهامشِ:**
 *
 * 1. **الرأسُ ذرّيٌّ لا موقَّعٌ.** لا مفتاحَ في يدِ المُقيمِ: التوقيعُ خلفَ
 *    `phase:build` الذي يُنفِّذه المُقيمُ نفسُه. فهذا الدفترُ يكشف **الضياعَ
 *    والبترَ والتبديلَ الجزئيَّ**، ولا يصمد أمامَ خصمٍ يملك القرصَ فيُعيد كتابةَ
 *    المتنِ والرأسِ معاً. و**`R3-A-01` تبقى مفتوحةً** — هذا الدفترُ لا يُغلِقها.
 * 2. **الإقامةُ لا تتعطّل بعطبِ دفترِها.** لو وُجِد الدفترُ معطوباً عندَ الإقامةِ
 *    دخل **الحجرَ**: لا يُكتَب فيه حرفٌ (فيُصان الدليلُ كما وُجِد)، ويُحصى كلُّ
 *    قيدٍ **مُسقَطاً مُعلَناً**، وتمضي الإقامةُ. ومن عطّل الإقامةَ هنا سلّم لمن
 *    أفسد ملفَّ سجلٍّ مفتاحَ تعطيلِ الدولةِ.
 * 3. **مسارُ التحقّقِ يُغلَق عليه.** ما تتسامح معه الإقامةُ **يرفضه الفاحصُ**:
 *    `verify:env` يُصدِر `ENV_LEDGER_BROKEN` ويخرج برمزِ `unfit`.
 *
 * والملفُّ القديمُ `.state/logs/environment.jsonl` **مُجمَّدٌ**: لا يُكتَب فيه،
 * ولا يُهاجَر منه، ولا يُحذَف — يُعلَن حضورُه شاهداً على ما قبلَ `ADR 0008`.
 *
 * @module scripts/lib/environment-ledger
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  auditLedgerChain,
  chainRecord,
  genesisHash,
  ledgerHeader,
  parseLedgerHeader,
} from '../../src/environment/ledger-chain.mjs';

/** اسمُ الدفترِ المُجمَّدِ الذي سبقَ `ADR 0008` — يُقرأ ولا يُكتَب. */
export const FROZEN_LEDGER_BASENAME = 'environment.jsonl';

/** اسمُ متنِ الدفترِ الجاري. */
export const LEDGER_BASENAME = 'environment-ledger.jsonl';

/** اسمُ رأسِ الدفترِ الجاري. */
export const LEDGER_HEAD_BASENAME = 'environment-ledger.head.json';

/**
 * مسارُ متنِ الدفترِ الافتراضيُّ.
 *
 * @param {string} cwd
 * @returns {string}
 */
export function defaultLedgerPath(cwd) {
  return path.join(cwd, '.state', 'logs', LEDGER_BASENAME);
}

/**
 * مسارُ الملفِّ المُجمَّدِ المقابلِ لمتنِ دفترٍ.
 *
 * @param {string} ledgerFile
 * @returns {string}
 */
export function frozenLedgerPath(ledgerFile) {
  return path.join(path.dirname(path.resolve(ledgerFile)), FROZEN_LEDGER_BASENAME);
}

/**
 * مسارُ الرأسِ المقابلِ لمتنٍ.
 *
 * @param {string} ledgerFile
 * @returns {string}
 */
export function headPathFor(ledgerFile) {
  const resolved = path.resolve(ledgerFile);
  return resolved.endsWith(`.jsonl`)
    ? `${resolved.slice(0, -'.jsonl'.length)}.head.json`
    : `${resolved}.head.json`;
}

/**
 * قراءةُ نصِّ ملفٍّ أو `null` إن غاب — لا تُنشئ شيئاً.
 *
 * @param {string} file
 * @returns {string | null}
 */
function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * الحكمُ على دفترٍ من مسارِ متنِه — قراءةٌ محضةٌ لا تُنشئ مجلَّداً ولا ملفّاً.
 *
 * @param {string} ledgerFile
 * @returns {{ state: string, refuses: boolean, committed: number, present: number, detail: string }}
 */
export function auditLedgerFile(ledgerFile) {
  return auditLedgerChain({
    headerText: readOrNull(headPathFor(ledgerFile)),
    bodyText: readOrNull(path.resolve(ledgerFile)),
  });
}

/**
 * دفترُ أثرِ الإقامةِ: سلسلةُ بصماتٍ ورأسٌ ذرّيٌّ، يُطابق عقدَ
 * `append(type, actor, data)` المُحقَنَ في `src/environment/`.
 *
 * **و`createDir` عَلَمٌ حاكمٌ لا تفصيلٌ:** المُقيمُ (`bootstrap`) يُنشئ مجلَّدَ
 * السجلِّ لأنّ إنشاءَ المجلَّداتِ **طورٌ من عملِه المُعلَن**؛ والفاحصُ
 * (`verify:env`) **لا يُنشئ شيئاً** — ولو أنشأه لكان الفحصُ يُصلِح المجلَّدَ
 * الذي يفحص مجسٌّ حاسمٌ حضورَه، فيسقط المجسُّ مرّةً ثم يقوم بلا إقامةٍ:
 * **فحصٌ يُخضِّر نفسَه بالتشغيلِ الثاني**. وعندَ غيابِ المجلَّدِ يُحصى القيدُ
 * **مُسقَطاً مُعلَناً** في `dropped` ويُطبَع — فالإسقاطُ يُقال ولا يُسكَت.
 */
export class EnvironmentLedger {
  /** @type {string} */
  #file;
  /** @type {string} */
  #head;
  /** @type {boolean} */
  #createDir;
  /** @type {number} */
  #count = 0;
  /** @type {number} */
  #dropped = 0;
  /** @type {boolean} */
  #loaded = false;
  /** @type {string} */
  #chain = genesisHash();
  /** @type {number} */
  #seq = 0;
  /** @type {string | null} */
  #quarantine = null;

  /**
   * @param {string} file مسارُ متنِ الدفترِ.
   * @param {{ createDir?: boolean }} [options]
   */
  constructor(file, options = {}) {
    this.#file = path.resolve(file);
    this.#head = headPathFor(this.#file);
    this.#createDir = options.createDir === true;
  }

  /**
   * قراءةُ الحالةِ القائمةِ مرّةً واحدةً قبلَ أوّلِ إلحاقٍ.
   *
   * **الدفترُ المعطوبُ يدخل الحجرَ ولا يُصلَّح ولا يُستأنَف فوقَه:** الكتابةُ
   * فوقَ سلسلةٍ مكسورةٍ تُخفي الكسرَ تحتَ قيودٍ جديدةٍ.
   *
   * @returns {void}
   */
  #load() {
    if (this.#loaded) return;
    this.#loaded = true;
    const audit = auditLedgerFile(this.#file);
    if (audit.refuses) {
      this.#quarantine = `${audit.state}: ${audit.detail}`;
      return;
    }
    if (audit.state === 'pending-tail') {
      this.#quarantine = `pending-tail: ${audit.detail}`;
      return;
    }
    const header = parseLedgerHeader(readOrNull(this.#head) ?? '');
    if (header === null) {
      this.#chain = genesisHash();
      this.#seq = 0;
      return;
    }
    this.#chain = header.head;
    this.#seq = header.count;
  }

  /**
   * إلحاقُ قيدٍ واحدٍ ثم تثبيتُ الرأسِ بإحلالٍ ذرّيٍّ.
   *
   * **الترتيبُ مقصودٌ:** المتنُ أوّلاً ثمّ الرأسُ. فانقطاعٌ بينهما يترك سطراً
   * زائداً لا يشهد به رأسٌ — وتلك حالةُ `pending-tail` المُعلَنةُ: لم يَضِعْ
   * قيدٌ مُثبَّتٌ ولم يتبدّل. ولو عُكِس الترتيبُ لشهِد الرأسُ بقيدٍ لا وجودَ له،
   * وذاك بترٌ يُقرأ عبثاً.
   *
   * @param {string} type
   * @param {string} actor
   * @param {Record<string, unknown>} data
   * @returns {number} ترتيبُ القيدِ في الدفترِ كلِّه، أو 0 إن أُسقِط.
   */
  append(type, actor, data) {
    this.#load();
    if (this.#quarantine !== null) {
      this.#dropped += 1;
      return 0;
    }
    const dir = path.dirname(this.#file);
    if (!fs.existsSync(dir)) {
      if (!this.#createDir) {
        this.#dropped += 1;
        return 0;
      }
      fs.mkdirSync(dir, { recursive: true });
    }
    const record = chainRecord(this.#chain, this.#seq + 1, type, actor, data);
    fs.appendFileSync(this.#file, `${JSON.stringify(record)}\n`, 'utf8');
    this.#chain = record.hash;
    this.#seq = record.seq;
    const temporary = `${this.#head}.tmp`;
    fs.writeFileSync(
      temporary,
      `${JSON.stringify(ledgerHeader(this.#seq, this.#chain))}\n`,
      'utf8',
    );
    fs.renameSync(temporary, this.#head);
    this.#count += 1;
    return record.seq;
  }

  /** عدَدُ ما أُلحِق في هذه العمليةِ. */
  get count() {
    return this.#count;
  }

  /** عدَدُ ما أُسقِط لغيابِ المجلَّدِ أو لحجرِ دفترٍ معطوبٍ — **يُعلَن ولا يُسكَت**. */
  get dropped() {
    return this.#dropped;
  }

  /** سببُ الحجرِ إن وقع، وإلّا `null`. */
  get quarantine() {
    this.#load();
    return this.#quarantine;
  }

  /** مسارُ متنِ الدفترِ. */
  get file() {
    return this.#file;
  }

  /** مسارُ رأسِ الدفترِ. */
  get headFile() {
    return this.#head;
  }
}
