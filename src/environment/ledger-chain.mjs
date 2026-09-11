/**
 * سلسلةُ دفترِ أثرِ الإقامةِ ورأسُه الذرّيُّ — حكمٌ نقيٌّ لا يلمس قرصاً.
 *
 * **المسألةُ التي تحلُّها هذه الوحدةُ:** دفترُ أثرِ الإقامةِ القديمُ
 * (`.state/logs/environment.jsonl`) مُلحِقُ أسطرٍ بلا ترقيمٍ ولا رأسٍ، فحذفُ
 * سطرٍ منه أو تبديلُ حقلٍ فيه **لا يُكشَف بأيِّ قراءةٍ**. وهذا دَينٌ مُعلَنٌ
 * منذُ `M10.05`، وقرارُه المعتمَدُ في `docs/adr/0008-environment-bootstrap-ledger.md`.
 *
 * **حدٌّ معلَنٌ في متنِ الملفِّ لا في هامشِه — وهو أهمُّ سطرٍ هنا:** الرأسُ
 * **ذرّيٌّ لا موقَّعٌ**. لا مفتاحَ في يدِ المُقيمِ أصلاً: التوقيعُ يقع خلفَ
 * `phase:build` الذي يُنفِّذه المُقيمُ نفسُه، فمن اشترط مفتاحاً جعل الإقامةَ
 * تتوقّف على ناتجِ طورٍ لم يقع. فما تشتريه هذه السلسلةُ **هو كشفُ الضياعِ
 * والبترِ والتبديلِ الجزئيِّ والفسادِ**، ولا تشتري **صموداً أمامَ خصمٍ يملك
 * القرصَ** — فذاك يُعيد كتابةَ المتنِ والرأسِ معاً بلا أثرٍ. ولذلك
 * **`R3-A-01` تبقى مفتوحةً**، وهذه الوحدةُ لا تُغلِقها ولا تدّعي.
 *
 * @module src/environment/ledger-chain
 */

import { createHash } from 'node:crypto';

/** بذرةُ السلسلةِ المُعلَنةُ — تغييرُها يُبطِل كلَّ دفترٍ سابقٍ عن قصدٍ. */
export const LEDGER_GENESIS = 'xuux:environment-ledger:v1';

/** إصدارُ الرأسِ المُعلَن. */
export const LEDGER_VERSION = 1;

/** حالاتُ الدفترِ الممكنةُ — لا حالةَ سادسةَ عشرةَ تُخترَع في موضعِ الاستدعاء. */
export const LEDGER_STATES = Object.freeze({
  ABSENT: 'absent',
  EMPTY: 'empty',
  INTACT: 'intact',
  PENDING_TAIL: 'pending-tail',
  HEADER_MISSING: 'header-missing',
  HEADER_INVALID: 'header-invalid',
  TRUNCATED: 'truncated',
  MUTATED: 'mutated',
  HEAD_MISMATCH: 'head-mismatch',
});

/**
 * الحالاتُ التي **يُغلَق عليها مسارُ التحقّقِ**.
 *
 * `absent` و`empty` و`intact` ليست منها بداهةً. و`pending-tail` ليست منها
 * **بقرارٍ مُعلَنٍ لا بسهوٍ**: هي أثرُ انقطاعٍ بين إلحاقِ السطرِ وتثبيتِ
 * الرأسِ، ولم يَضِعْ فيها قيدٌ مُثبَّتٌ واحدٌ ولم يتبدّلْ. ومن أغلق عليها
 * جعل انقطاعَ تيّارٍ يُعطِّل الفحصَ إلى الأبد.
 */
export const LEDGER_REFUSING_STATES = /** @type {readonly string[]} */ (
  Object.freeze([
    LEDGER_STATES.HEADER_MISSING,
    LEDGER_STATES.HEADER_INVALID,
    LEDGER_STATES.TRUNCATED,
    LEDGER_STATES.MUTATED,
    LEDGER_STATES.HEAD_MISMATCH,
  ])
);

/**
 * تسلسلٌ مُستقرٌّ: ترتيبُ المفاتيحِ معجميٌّ في كلِّ عمقٍ.
 *
 * بغيرِه يختلف البصمُ باختلافِ ترتيبِ الإدخالِ، فيُقرأ اختلافُ ترتيبٍ عبثاً.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.keys(/** @type {Record<string, unknown>} */ (value))
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(/** @type {Record<string, unknown>} */ (value)[key])}`,
    );
  return `{${entries.join(',')}}`;
}

/**
 * بصمُ قيدٍ واحدٍ فوقَ سابقِه.
 *
 * @param {{ seq: number, prevHash: string, type: string, actor: string, data: unknown }} record
 * @returns {string}
 */
export function ledgerHash(record) {
  const canonical = stableStringify({
    seq: record.seq,
    prevHash: record.prevHash,
    type: record.type,
    actor: record.actor,
    data: record.data,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** بصمُ البذرةِ — رأسُ دفترٍ فارغٍ. @returns {string} */
export function genesisHash() {
  return createHash('sha256').update(LEDGER_GENESIS, 'utf8').digest('hex');
}

/**
 * بناءُ قيدٍ مُسلسَلٍ فوقَ رأسٍ قائمٍ — دالّةٌ محضةٌ لا تكتب شيئاً.
 *
 * @param {string} prevHash رأسُ السلسلةِ قبلَ هذا القيدِ.
 * @param {number} seq ترتيبُ القيدِ في الدفترِ كلِّه (يبدأ من 1).
 * @param {string} type
 * @param {string} actor
 * @param {Record<string, unknown>} data
 * @returns {{ seq: number, prevHash: string, type: string, actor: string, data: Record<string, unknown>, hash: string }}
 */
export function chainRecord(prevHash, seq, type, actor, data) {
  const base = { seq, prevHash, type, actor, data };
  return { ...base, hash: ledgerHash(base) };
}

/**
 * بناءُ الرأسِ من عدَدِ القيودِ وبصمِ آخرِها.
 *
 * @param {number} count
 * @param {string} head
 * @returns {{ version: number, genesis: string, count: number, head: string }}
 */
export function ledgerHeader(count, head) {
  return { version: LEDGER_VERSION, genesis: LEDGER_GENESIS, count, head };
}

/**
 * قراءةُ الرأسِ من نصِّه — لا ترمي، بل تُعيد `null` عندَ أيِّ عيبٍ.
 *
 * @param {string} text
 * @returns {{ version: number, genesis: string, count: number, head: string } | null}
 */
export function parseLedgerHeader(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const header = /** @type {Record<string, unknown>} */ (parsed);
  if (header.version !== LEDGER_VERSION) return null;
  if (header.genesis !== LEDGER_GENESIS) return null;
  if (typeof header.count !== 'number' || !Number.isInteger(header.count) || header.count < 0) {
    return null;
  }
  if (typeof header.head !== 'string' || !/^[0-9a-f]{64}$/u.test(header.head)) return null;
  return {
    version: LEDGER_VERSION,
    genesis: LEDGER_GENESIS,
    count: header.count,
    head: header.head,
  };
}

/**
 * الأسطرُ غيرُ الفارغةِ من متنِ الدفترِ.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function ledgerLines(text) {
  return text.split('\n').filter((line) => line.trim() !== '');
}

/** @param {string} state @returns {boolean} */
export function ledgerStateRefuses(state) {
  return LEDGER_REFUSING_STATES.includes(state);
}

/**
 * @param {string} state
 * @param {string} detail
 * @param {number} committed
 * @param {number} present
 * @returns {{ state: string, refuses: boolean, committed: number, present: number, detail: string }}
 */
function verdict(state, detail, committed, present) {
  return { state, refuses: ledgerStateRefuses(state), committed, present, detail };
}

/**
 * الحكمُ على دفترٍ كاملاً من نصِّ رأسِه ونصِّ متنِه — **لا قرصَ ولا عمليّةَ**.
 *
 * @param {{ headerText?: string | null, bodyText?: string | null }} input
 *   `null` يعني «الملفُّ غائبٌ»؛ والنصُّ الفارغُ يعني «حاضرٌ خالٍ».
 * @returns {{ state: string, refuses: boolean, committed: number, present: number, detail: string }}
 */
export function auditLedgerChain(input) {
  const headerText = input.headerText ?? null;
  const bodyText = input.bodyText ?? null;

  if (headerText === null && bodyText === null) {
    return verdict(
      LEDGER_STATES.ABSENT,
      'لا دفترَ بعدُ — ولم تقع إقامةٌ تُقيَّد؛ وغيابُ دفترٍ لم يُفتَح ليس عبثاً به.',
      0,
      0,
    );
  }

  if (headerText === null) {
    const orphan = ledgerLines(bodyText ?? '').length;
    return verdict(
      LEDGER_STATES.HEADER_MISSING,
      `متنُ الدفترِ حاضرٌ بـ${String(orphan)} قيداً ورأسُه غائبٌ — ومتنٌ بلا رأسٍ لا يُعرَف كم كان طولُه، فلا يُقال عنه «سليمٌ».`,
      0,
      orphan,
    );
  }

  const header = parseLedgerHeader(headerText);
  if (header === null) {
    return verdict(
      LEDGER_STATES.HEADER_INVALID,
      'رأسُ الدفترِ لا يُقرأ أو لا يُطابق إصدارَه وبذرتَه المُعلَنَين — ورأسٌ لا يُقرأ لا يشهد على متنٍ.',
      0,
      ledgerLines(bodyText ?? '').length,
    );
  }

  const lines = bodyText === null ? [] : ledgerLines(bodyText);
  const present = lines.length;

  if (present < header.count) {
    return verdict(
      LEDGER_STATES.TRUNCATED,
      `الرأسُ يشهد بـ${String(header.count)} قيداً والمتنُ يحمل ${String(present)} — قيودٌ ضاعت، والنقصُ يُعلَن ولا يُسكَت.`,
      header.count,
      present,
    );
  }

  let running = genesisHash();
  for (let index = 0; index < header.count; index += 1) {
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(/** @type {string} */ (lines[index]));
    } catch {
      return verdict(
        LEDGER_STATES.MUTATED,
        `القيدُ رقمَ ${String(index + 1)} ليس JSON صالحاً — ومتنٌ فاسدٌ لا يُقرأ سليماً.`,
        header.count,
        present,
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return verdict(
        LEDGER_STATES.MUTATED,
        `القيدُ رقمَ ${String(index + 1)} ليس كائناً — وشكلٌ غيرُ متوقَّعٍ في دفترٍ عبثٌ حتى يُثبَت غيرُه.`,
        header.count,
        present,
      );
    }
    const record = /** @type {Record<string, unknown>} */ (parsed);
    if (record.seq !== index + 1) {
      return verdict(
        LEDGER_STATES.MUTATED,
        `القيدُ في الموضعِ ${String(index + 1)} يحمل ترتيباً «${String(record.seq)}» — والترتيبُ يُحصي الحذفَ الذي لا يُرى.`,
        header.count,
        present,
      );
    }
    if (record.prevHash !== running) {
      return verdict(
        LEDGER_STATES.MUTATED,
        `القيدُ رقمَ ${String(index + 1)} يُشير إلى سابقٍ غيرِ الذي قبلَه فعلاً — السلسلةُ مقطوعةٌ عندَ هذا الموضعِ.`,
        header.count,
        present,
      );
    }
    const recomputed = ledgerHash({
      seq: index + 1,
      prevHash: running,
      type: String(record.type),
      actor: String(record.actor),
      data: record.data,
    });
    if (record.hash !== recomputed) {
      return verdict(
        LEDGER_STATES.MUTATED,
        `بصمُ القيدِ رقمَ ${String(index + 1)} لا يُطابق محتواه — حقلٌ بُدِّل بعدَ الكتابةِ.`,
        header.count,
        present,
      );
    }
    running = recomputed;
  }

  if (running !== header.head) {
    return verdict(
      LEDGER_STATES.HEAD_MISMATCH,
      'المتنُ متّسقٌ في ذاتِه ولا ينتهي إلى الرأسِ الذي يشهد به الدفترُ — رأسٌ ومتنٌ من دفترين.',
      header.count,
      present,
    );
  }

  if (header.count === 0 && present === 0) {
    return verdict(LEDGER_STATES.EMPTY, 'دفترٌ مفتوحٌ برأسٍ صحيحٍ ولا قيدَ فيه بعدُ.', 0, 0);
  }

  if (present > header.count) {
    return verdict(
      LEDGER_STATES.PENDING_TAIL,
      `${String(header.count)} قيداً مُثبَّتاً بالرأسِ سليمةٌ، وبعدَها ${String(present - header.count)} سطراً لم يشهد به رأسٌ — أثرُ انقطاعٍ بينَ الإلحاقِ والتثبيتِ؛ لم يَضِعْ مُثبَّتٌ ولم يتبدّل، ولذلك يُعلَن ولا يُغلَق عليه.`,
      header.count,
      present,
    );
  }

  return verdict(
    LEDGER_STATES.INTACT,
    `${String(header.count)} قيداً متسلسلةً يشهد بها رأسٌ ذرّيٌّ، وكلُّ بصمٍ أُعيد حسابُه فطابق.`,
    header.count,
    present,
  );
}
