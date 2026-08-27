/**
 * دفتر المحو — الخطوة `M7.06`.
 *
 * **العيب الذي تُغلقه هذه الوحدة، بنصّه كما كان:** المحو في `M3.08`
 * (`src/persistence/retention.mjs`) `DELETE` مباشر. فبعد مروره لا يبقى في
 * المستودع شيءٌ يقول إنّ صفّاً كان ثم مُحي: لا فاعل، ولا سبب، ولا تصنيفُ ما
 * مُحي، ولا شهادةٌ على نسبه قبل زواله. ومعيار قبول هذه الخطوة نصّه «دورة احتفاظ
 * كاملة **تُمحى وتُسجَّل**» — والشطر الثاني كان غائباً تماماً، والغيابُ هنا أخطر
 * من كونه ثغرة: محوٌ صحيحٌ لا يُفرَّق عن محوٍ عابث، فلا يُراجَع أحدهما.
 *
 * والدفتر **شاهدُ زوالٍ لا نسخةٌ منه**: لا يحمل مادّة ما مُحي ولا غلافه المشفَّر
 * ولا شيئاً من مفتاحه. دفترٌ يحمل المادة يُبطل المحو من باب التدقيق، فيصير
 * «الاحتفاظ» نقلاً للبيانات من جدولٍ إلى جدول.
 *
 * ولا مرجعَ فيه إلى `state.data_assets`: الهدفُ **زائلٌ بالقصد**، ومرجعٌ إليه
 * يجعل الشاهد يزول مع المشهود عليه (أو يمنع المحو أصلاً، وهو نقضُ الغرض).
 * فقيمةُ `targetId` نصٌّ محفوظ لا مفتاحٌ أجنبي.
 *
 * والسلسلة متصلة بالتجزئة كدفتر النسب (`lineage.mjs`): حذفُ شاهدٍ أو تعديلُه
 * مكشوفٌ بـ`verify()`. والتجزئة تُحسب على `recordedAt` **نصّاً** لا على عمودٍ
 * زمني، لأن فرق الدقّة بين ساعة القاعدة (ميكروثانية) و`Date` (ميليثانية) كان
 * سيكسر السلسلة على البريء — وهو انحرافٌ سقط فيه المشروع مرّةً في `M3.05`.
 *
 * **حدٌّ معلَن:** السلسلة **واحدة للدفتر كلّه** لا سلسلةٌ لكل هدف. والسبب أن
 * سلسلةً لكل هدفٍ زائلٍ تعني سلسلةً بطول صفٍّ واحد في الغالب — ووصلةٌ لا تربط
 * شيئاً لا تكشف حذفاً. وأثرُ ذلك أنّ الكتابة في الدفتر متسلسلة (`seq` فريد)،
 * فدورتان متوازيتان تتنافسان على نفس الرقم وتفشل إحداهما بتضاربٍ مُسمّى من
 * المستودع لا بكتابةٍ مزدوجة صامتة.
 */

import { createHash, randomUUID } from 'node:crypto';

/** أول وصلةٍ في السلسلة. */
export const ERASURE_GENESIS = 'genesis';

/** الأهداف التي يُشهد على محوها؛ ما ليس منها لا يُكتب له شاهد. */
export const ERASURE_TARGETS = Object.freeze(['memories', 'data_assets']);

/** أسباب المحو: دورةُ احتفاظٍ، أو محوٌ موجَّه بقرار. */
export const ERASURE_REASONS = Object.freeze(['retention', 'directed']);

export const ERASURE_ERRORS = Object.freeze({
  INPUT_INVALID: 'ERASURE_INPUT_INVALID',
  TARGET_UNKNOWN: 'ERASURE_TARGET_UNKNOWN',
  REASON_UNKNOWN: 'ERASURE_REASON_UNKNOWN',
  CHAIN_BROKEN: 'ERASURE_CHAIN_BROKEN',
});

/** خطأ دفتر محوٍ مُسمّى: الرمز للأتمتة والنص لمن يقرأ الرفض. */
export class ErasureLedgerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = 'ErasureLedgerError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * @typedef {object} DependentAttestation
 * @property {number} rows عدد صفوف التابع التي زالت مع الهدف.
 * @property {string | null} headHash تجزئة رأس سلسلة التابع قبل زواله، إن كان دفتراً متسلسلاً.
 */

/**
 * @typedef {object} ErasureRecordInput
 * @property {'memories' | 'data_assets'} target
 * @property {string} targetId
 * @property {'retention' | 'directed'} reason
 * @property {string} actorId
 * @property {string} classification تصنيفُ ما مُحي لحظة محوه.
 * @property {string} owner مالكُ ما مُحي (وكيلٌ أو جهة).
 * @property {Readonly<Record<string, DependentAttestation>>} dependents شهادةُ التوابع قبل زوالها.
 */

/**
 * تمثيلٌ قانوني لشهادة التوابع: مفاتيحُ الجداول مرتَّبة، وحقول كل شهادةٍ بترتيبٍ
 * ثابت. تجزئةٌ تتغيّر بترتيب مفاتيح كائنٍ تُبلّغ عن كسرٍ لم يقع، فيُهمَل التبليغ
 * كلّه بعد أول إنذارٍ كاذب.
 * @param {Readonly<Record<string, DependentAttestation>>} dependents
 * @returns {Array<[string, number, string | null]>}
 */
function canonicalDependents(dependents) {
  return Object.keys(dependents)
    .sort((left, right) => left.localeCompare(right))
    .map((table) => {
      const entry = dependents[table];
      return /** @type {[string, number, string | null]} */ ([
        table,
        Number(entry?.rows ?? 0),
        entry?.headHash ?? null,
      ]);
    });
}

/**
 * تجزئة شاهدٍ واحد. الترتيب ثابتٌ ومكتوبٌ مرةً واحدة، ويُستعمل للكتابة وللفحص
 * معاً: حسابان منفصلان لنفس القيمة يفترقان أوّل تعديل فيصير الفحص إنذاراً كاذباً.
 * @param {{ prevHash: string, seq: number, target: string, targetId: string, reason: string, actorId: string, classification: string, owner: string, dependents: Readonly<Record<string, DependentAttestation>>, recordedAt: string }} input
 * @returns {string}
 */
export function erasureHash({
  prevHash,
  seq,
  target,
  targetId,
  reason,
  actorId,
  classification,
  owner,
  dependents,
  recordedAt,
}) {
  const canonical = JSON.stringify([
    prevHash,
    seq,
    target,
    targetId,
    reason,
    actorId,
    classification,
    owner,
    canonicalDependents(dependents),
    recordedAt,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * عيبٌ واحد في صفٍّ من السلسلة، أو `null` إن كان سليماً. والفحص يُعيد حساب
 * التجزئة أيضاً لا الوصلة وحدها: بلا إعادة الحساب يمرّ **تعديلُ الصفّ الأخير**
 * بلا كشف، لأن لا صفَّ بعده يحمل تجزئته — وهو خطأٌ وقع فعلاً في أول تركيب دفتر
 * النسب قبل تصحيحه.
 * @param {Record<string, unknown>} row
 * @param {string} expectedPrev
 * @param {number} expectedSeq
 * @returns {string | null}
 */
export function chainFault(row, expectedPrev, expectedSeq) {
  const seq = Number(row['seq']);
  if (seq !== expectedSeq) {
    return `ثغرة في التسلسل: المتوقّع ${expectedSeq} والموجود ${seq} — شاهدٌ حُذف أو أُدرج خارج الدفتر.`;
  }
  if (row['prevHash'] !== expectedPrev) {
    return 'الوصلة بما قبله مكسورة: الشاهد السابق عُدّل أو حُذف.';
  }
  const recomputed = erasureHash({
    prevHash: String(row['prevHash']),
    seq,
    target: String(row['target']),
    targetId: String(row['targetId']),
    reason: String(row['reason']),
    actorId: String(row['actorId']),
    classification: String(row['classification']),
    owner: String(row['owner']),
    dependents: /** @type {Readonly<Record<string, DependentAttestation>>} */ (
      row['dependents'] ?? {}
    ),
    recordedAt: String(row['recordedAt']),
  });
  return recomputed === row['hash'] ? null : 'التجزئة لا تطابق حقول الشاهد: عُدّل بعد كتابته.';
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    throw new ErasureLedgerError(
      ERASURE_ERRORS.INPUT_INVALID,
      `شاهد محوٍ بلا «${field}»: شاهدٌ ناقصٌ يُقرأ لاحقاً كأنّ المحو وقع بلا فاعلٍ ولا هدف.`,
      { field },
    );
  }
  return text;
}

/** دفتر المحو: يُكتب فيه ولا يُعدَّل، ويُفحص بسلسلته. */
export class ErasureLedger {
  /**
   * @param {object} deps
   * @param {{ append: (type: string, actor: string, data: object) => unknown }} deps.log
   * @param {{ insert: (record: Record<string, unknown>) => Promise<Record<string, unknown>>, list: (query?: object) => Promise<Array<Record<string, unknown>>> }} deps.repository
   * @param {(() => Date) | undefined} [deps.now]
   */
  constructor({ log, repository, now }) {
    if (log === undefined || repository === undefined) {
      throw new ErasureLedgerError(
        ERASURE_ERRORS.INPUT_INVALID,
        'دفتر المحو يحتاج سجل أحداث ومستودعاً: دفترٌ بلا سجلٍّ شاهدٌ لا يُبلَّغ عنه، ودفترٌ بلا مستودعٍ شاهدٌ يزول بإعادة التشغيل.',
      );
    }
    this.log = log;
    this.repository = repository;
    this.now = now ?? (() => new Date());
  }

  /**
   * كل الشواهد بترتيب سلسلتها. الترتيب يُفرض هنا ولا يُفترض من المستودع: تطبيقان
   * للمستودع قد يختلفان في ترتيب الإرجاع، وسلسلةٌ تُفحص بترتيبٍ غير ترتيبها
   * تُبلّغ عن كسرٍ لم يقع.
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async entries() {
    const rows = await this.repository.list({});
    return [...rows].sort((left, right) => Number(left['seq']) - Number(right['seq']));
  }

  /**
   * وقتُ آخر شاهدٍ في الدفتر، أو `null` لدفترٍ فارغ. هو ما تقيس عليه الدورة
   * بوابةَ التكرار: تشغيلٌ يُعاد بالخطأ بعد دقيقة يُرفض لا يُضاعف.
   * @returns {Promise<Date | null>}
   */
  async lastRecordedAt() {
    const rows = await this.entries();
    const last = rows[rows.length - 1];
    if (last === undefined) return null;
    const at = new Date(String(last['recordedAt']));
    return Number.isNaN(at.getTime()) ? null : at;
  }

  /**
   * يكتب شاهد محوٍ واحداً. يُنادى **بعد** زوال الهدف وتوابعه في نفس وحدة العمل:
   * شاهدٌ يُكتب قبل المحو يبقى كذباً إن فشل المحو، وشاهدٌ يُكتب في معاملةٍ أخرى
   * يفترق عن فعله عند أول إخفاق.
   * @param {ErasureRecordInput} input
   * @returns {Promise<Record<string, unknown>>}
   */
  async record({ target, targetId, reason, actorId, classification, owner, dependents = {} }) {
    if (!ERASURE_TARGETS.includes(String(target))) {
      throw new ErasureLedgerError(
        ERASURE_ERRORS.TARGET_UNKNOWN,
        `هدفُ محوٍ غير معلَن: «${String(target)}». الأهداف المعلَنة: ${ERASURE_TARGETS.join('، ')} — وهدفٌ يُخترع في الطلب يجعل الدفتر يشهد على ما لا سياسة له.`,
        { target },
      );
    }
    if (!ERASURE_REASONS.includes(String(reason))) {
      throw new ErasureLedgerError(
        ERASURE_ERRORS.REASON_UNKNOWN,
        `سببُ محوٍ غير معلَن: «${String(reason)}». الأسباب المعلَنة: ${ERASURE_REASONS.join('، ')}.`,
        { reason },
      );
    }
    const rows = await this.entries();
    const last = rows[rows.length - 1];
    const seq = last === undefined ? 1 : Number(last['seq']) + 1;
    const prevHash = last === undefined ? ERASURE_GENESIS : String(last['hash']);
    const recordedAt = this.now().toISOString();
    const fields = {
      target: /** @type {'memories' | 'data_assets'} */ (target),
      targetId: requiredText(targetId, 'targetId'),
      reason: /** @type {'retention' | 'directed'} */ (reason),
      actorId: requiredText(actorId, 'actorId'),
      classification: requiredText(classification, 'classification'),
      owner: requiredText(owner, 'owner'),
      dependents: Object.freeze({ ...dependents }),
    };
    const hash = erasureHash({ prevHash, seq, recordedAt, ...fields });
    const row = await this.repository.insert({
      id: 'erasure:' + randomUUID(),
      ...fields,
      seq,
      recordedAt,
      prevHash,
      hash,
    });
    // الحدث يقول إنّ المحو وقع وعلى أيّ مرتبةٍ من التصنيف، ولا يحمل مادّة:
    // سجلٌّ يحمل ما مُحي يُبطل المحو من باب التدقيق.
    this.log.append('retention.erased', fields.actorId, {
      target: fields.target,
      targetId: fields.targetId,
      reason: fields.reason,
      classification: fields.classification,
      owner: fields.owner,
      dependents: fields.dependents,
      seq,
      hash,
    });
    return row;
  }

  /**
   * يفحص السلسلة كلّها. يُعيد أول عيبٍ يجده مع موضعه، أو سلامةً بعدد الشواهد.
   * @returns {Promise<{ ok: boolean, count: number, fault?: string, at?: string }>}
   */
  async verify() {
    const rows = await this.entries();
    let expectedPrev = ERASURE_GENESIS;
    let expectedSeq = 1;
    for (const row of rows) {
      const fault = chainFault(row, expectedPrev, expectedSeq);
      if (fault !== null) {
        return { ok: false, count: rows.length, fault, at: String(row['id']) };
      }
      expectedPrev = String(row['hash']);
      expectedSeq += 1;
    }
    return { ok: true, count: rows.length };
  }

  /**
   * يفحص السلسلة ويرفع خطأً مُسمّى عند أول عيب. مسارٌ لمن يريد الفشل لا التقرير.
   * @returns {Promise<number>} عدد الشواهد المفحوصة.
   */
  async assertIntact() {
    const result = await this.verify();
    if (!result.ok) {
      throw new ErasureLedgerError(
        ERASURE_ERRORS.CHAIN_BROKEN,
        `سلسلة دفتر المحو مكسورة عند «${String(result.at)}»: ${String(result.fault)}`,
        { at: result.at ?? null, count: result.count },
      );
    }
    return result.count;
  }
}
