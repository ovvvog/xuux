/**
 * الدستور — النصُّ المؤسِّس والمخزنُ المحميُّ والتحقّقُ من السلامة (الخطوة M8.01).
 *
 * **ما كان قبل هذه الوحدة:** لم يكن في المستودع دستورٌ بأي معنى. الموجودُ كان
 * `LawRegistry` (‏`M3.05`) — سجلَّ قوانينَ عادياً يقترحُ فيه أيُّ فاعلٍ نصّاً
 * وينفُذ باعتماد `'crown'` **نصّاً في وسيطٍ يُمرَّر**، ولا نصَّ أعلى منه يُقاس
 * عليه، ولا مسارَ تعديلٍ يختلف عن مسار أي قانونٍ آخر. وكان في `config/` ثلاثةُ
 * ملفّاتٍ (‏`royal-authority.yaml` و`capabilities.yaml` و`policies.yaml`) تُسنِد
 * إحدى وعشرين قاعدةً إلى **ثمانية مراجعِ قانونٍ لا وجودَ لها** (‏`law:legislation`
 * و`law:root-of-trust` و`law:sovereign-halt` … ): سلاسلُ نصٍّ زخرفيّةٍ لا يقرؤها
 * كودٌ ولا يتحقّق منها حاجز — أي أنّ «سندَ القاعدة القانونيّ» كان تعليقاً.
 *
 * **وما تفعله هذه الوحدة:** تجعل للنصّ الأعلى وجوداً مقيساً:
 *   • النصُّ المؤسِّس بياناتٌ محكومةٌ بمخطَّطٍ صارم في `config/constitution.yaml`،
 *     **وتجزئتُه تُختَم في العهد الأول** من المخزن؛ فتحريرُه بعد الختم يُكشف
 *     بـ`CONSTITUTION_FOUNDING_TEXT_DRIFT` **ويُعطِّل قراءةَ الدستور كلَّه**.
 *   • المخزنُ سلسلةُ عهودٍ **كلُّ عهدٍ فيها موقَّعٌ بمفتاح الملك** ومربوطٌ
 *     بتجزئةِ سابقه، مع **عدّاد أعلى عهدٍ بُلغ** فحذفُ آخر عهدٍ يُكشف ولا يمرّ
 *     بوصفه سلسلةً أقصرَ صحيحة.
 *   • **الفشلُ مغلق:** كلُّ ما لا يُتحقَّق منه يُقرأ رفضاً؛ فدستورٌ مشكوكٌ فيه
 *     لا يُقرأ أصلاً بدلاً من أن يُقرأ منقوصاً.
 *
 * **حدودٌ معلَنة:**
 *   1. المخزنُ **ملفٌّ ذرّيٌّ على القرص (أو ذاكرة)، لا جدولُ PostgreSQL**، وذلك
 *      **بقصد**: الدستور يُقرأ في الإقلاع **قبل** أن تُوجد قاعدةٌ أو تُشغَّل
 *      هجرة، فربطُه بها يجعل النصَّ الأعلى رهناً بأدنى مكوّنٍ تشغيليّ. وهو نفسُ
 *      اختيار `halt-switch.mjs` ولنفس السبب.
 *   2. ذرّيتُه **ذرّيةُ نظام ملفّاتٍ واحد**؛ وعبر الآلات يحتاج مخزناً مشتركاً
 *      بضمانٍ ذرّي (قرارُ نشرٍ في `M10`).
 *   3. العبثُ **يُكشف ولا يُمنع**: من ملك القرصَ ومفتاحَ الملك معاً يكتب عهداً
 *      صحيحاً. ومنعُ ذلك يحتاج عزلَ مفاتيحَ في عتادٍ (`M11`).
 *   4. التوقيعُ يُتحقَّق بالمفتاح العام الذي يُمرَّر **الآن**؛ فلو دُوِّر مفتاح
 *      الملك بلا إعادةِ توقيعِ العهود صارت السلسلةُ غيرَ قابلةٍ للتحقّق —
 *      وتُقرأ حينها رفضاً (فشلٌ مغلق) لا قبولاً. وإعادةُ التوقيع عند التدوير
 *      عملٌ غيرُ منفَّذٍ في هذه الخطوة، ومكتوبٌ في `docs/REMAINING_WORK.md`.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** مجلَّد السياسة الافتراضي. */
export const DEFAULT_CONSTITUTION_CONFIG_DIR = path.join(ROOT, 'config');

/** أوّلُ وصلةٍ في سلسلة العهود: قيمةٌ مُعلَنة لا سلسلةٌ فارغةٌ تُقرأ «لا سابقَ له». */
export const CONSTITUTION_GENESIS = 'genesis';

/** نوعا العهد: تأسيسٌ واحدٌ ثم تعديلات. */
export const RevisionKind = Object.freeze({ GENESIS: 'genesis', AMENDMENT: 'amendment' });

/**
 * رموزُ الرفض. كلُّ رمزٍ هنا مربوطٌ ببندِ ضمانٍ في `config/constitution.yaml`،
 * ويحرس الرابطةَ `npm run guard:constitution`.
 */
export const CONSTITUTION_ERRORS = Object.freeze({
  CONFIG_INVALID: 'CONSTITUTION_CONFIG_INVALID',
  FOUNDING_TEXT_DRIFT: 'CONSTITUTION_FOUNDING_TEXT_DRIFT',
  TAMPERED: 'CONSTITUTION_TAMPERED',
  EPOCH_ROLLBACK: 'CONSTITUTION_EPOCH_ROLLBACK',
  SIGNER_REQUIRED: 'CONSTITUTION_SIGNER_REQUIRED',
  STORAGE_INVALID: 'CONSTITUTION_STORAGE_INVALID',
  ARTICLE_UNKNOWN: 'CONSTITUTION_ARTICLE_UNKNOWN',
});

export class ConstitutionError extends Error {
  /**
   * @param {string} code
   * @param {string} detail
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'ConstitutionError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * مادةٌ دستورية.
 * @typedef {object} ConstitutionArticle
 * @property {string} id
 * @property {string} title
 * @property {boolean} entrenched
 * @property {string} lawRef
 * @property {readonly string[]} enforcedBy
 * @property {string} text
 */

/**
 * سياسةُ الدستور المُحمَّلة.
 * @typedef {object} ConstitutionPolicy
 * @property {number} version
 * @property {string} owner
 * @property {{ proposeAction: string, ratifyAction: string, proposerRoles: readonly string[], reviewerRoles: readonly string[], ratifierRoles: readonly string[], deliberationSeconds: number, minReasonLength: number, minOpinionLength: number, minTextLength: number, steps: readonly string[] }} amendment
 * @property {{ stateFile: string, epochFile: string, holders: readonly string[] }} integrity
 * @property {ReadonlyArray<{ id: string, clause: string, code: string, enforcedBy: string }>} guarantees
 * @property {readonly ConstitutionArticle[]} articles
 * @property {string} foundingRoot - تجزئةُ النصّ المؤسِّس كما حُسبت عند التحميل
 */

/**
 * عهدٌ في سلسلة الدستور. `kind: genesis` واحدٌ لا يتكرّر، وما بعده تعديلات.
 * @typedef {object} ConstitutionRevision
 * @property {number} epoch
 * @property {'genesis' | 'amendment'} kind
 * @property {string} foundingRoot
 * @property {string | null} articleId
 * @property {string | null} text
 * @property {string | null} amendmentId
 * @property {string | null} ratifiedBy
 * @property {string} at
 * @property {string} previousHash
 */

/** عهدٌ مع توقيعه كما يُخزَّن. */
/** @typedef {{ revision: ConstitutionRevision, signature: string }} SealedRevision */

/** الموقِّع: ما يكفي من `KingIdentity` ولا أكثر — فلا تعتمد الوحدةُ على صنفٍ بعينه. */
/** @typedef {{ id: string, sign: (payload: object) => string, verify: (payload: object, signature: string) => boolean }} ConstitutionSigner */

/**
 * تجزئةُ مادةٍ واحدة. الحقولُ الخمسةُ كلُّها تدخل التجزئة: فتغييرُ العنوان أو
 * الختم أو مرجعِ القانون تغييرٌ في المادة كتغيير نصّها بالضبط.
 * @param {ConstitutionArticle} article
 * @returns {string}
 */
export function articleHash(article) {
  return sha256(
    [
      article.id,
      article.title,
      article.entrenched ? 'entrenched' : 'amendable',
      article.lawRef,
      article.enforcedBy.join(','),
      article.text,
    ].join('\u0000'),
  );
}

/**
 * تجزئةُ النصّ كاملاً: سلسلةٌ مرتَّبةٌ على المعرّفات، فترتيبُ الموادّ في الملف
 * لا يغيّر الجذر، وحذفُ مادةٍ أو إضافتُها يغيّره.
 * @param {readonly ConstitutionArticle[]} articles
 * @returns {string}
 */
export function documentRoot(articles) {
  const ordered = [...articles].sort((a, b) => a.id.localeCompare(b.id));
  let root = CONSTITUTION_GENESIS;
  for (const article of ordered) root = sha256(`${root}\u0000${articleHash(article)}`);
  return root;
}

/**
 * تجزئةُ عهدٍ — على حقوله بترتيبٍ مثبَّتٍ لا على `JSON.stringify` لكائنٍ قد
 * يختلف ترتيبُ مفاتيحه بين تشغيلين.
 * @param {ConstitutionRevision} revision
 * @returns {string}
 */
export function revisionHash(revision) {
  return sha256(
    [
      String(revision.epoch),
      revision.kind,
      revision.foundingRoot,
      revision.articleId ?? '',
      revision.text ?? '',
      revision.amendmentId ?? '',
      revision.ratifiedBy ?? '',
      revision.at,
      revision.previousHash,
    ].join('\u0000'),
  );
}

/**
 * يحمّل سياسة الدستور ويفحص تماسكها. **الفشلُ مغلق:** ملفٌّ غائبٌ أو مخطَّطٌ
 * مخالفٌ أو تماسكٌ منقوضٌ يرفع خطأً برمزه، ولا تُعاد سياسةٌ منقوصةٌ بوصفها كاملة.
 * @param {{ dir?: string }} [options]
 * @returns {ConstitutionPolicy}
 */
export function loadConstitutionPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_CONSTITUTION_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas'))
    ? dir
    : DEFAULT_CONSTITUTION_CONFIG_DIR;
  const file = path.join(dir, 'constitution.yaml');
  if (!fs.existsSync(file)) {
    throw new ConstitutionError(
      CONSTITUTION_ERRORS.CONFIG_INVALID,
      'ملفُّ الدستور غائب؛ ودولةٌ بلا نصٍّ أعلى لا يُقاس عليها شيء.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConstitutionError(
      CONSTITUTION_ERRORS.CONFIG_INVALID,
      `تعذّرت قراءة constitution.yaml: ${errorText(error)}`,
    );
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'constitution.schema.json');
  if (!fs.existsSync(schemaPath)) {
    throw new ConstitutionError(
      CONSTITUTION_ERRORS.CONFIG_INVALID,
      'مخطَّطُ الدستور غائب؛ وبلا مخطَّطٍ يصير النصُّ الأعلى نصّاً حرّاً.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim())
      .join(' · ');
    throw new ConstitutionError(
      CONSTITUTION_ERRORS.CONFIG_INVALID,
      `constitution.yaml يخالف مخطَّطه: ${problems}`,
    );
  }
  const parsed = /** @type {ConstitutionPolicy} */ (raw);

  // فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط:
  const ids = new Set();
  for (const article of parsed.articles) {
    if (ids.has(article.id)) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.CONFIG_INVALID,
        `مادةٌ مكرَّرةُ المعرّف: ${article.id}`,
      );
    }
    ids.add(article.id);
  }
  const lawRefs = new Set();
  for (const article of parsed.articles) {
    if (lawRefs.has(article.lawRef)) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.CONFIG_INVALID,
        `مرجعُ قانونٍ مكرَّرٌ في مادّتين: ${article.lawRef} — والمرجعُ المكرَّر يجعل السندَ مبهماً.`,
      );
    }
    lawRefs.add(article.lawRef);
  }
  // المادةُ الناظمةُ لمسار التعديل يجب أن تكون **مختومة**؛ وإلا كان المسارُ
  // قابلاً لتعديلِ نفسِه بنفسِه فيصير الحرسُ حرساً على لا شيء.
  const guarding = parsed.articles.find((article) => article.lawRef === 'law:constitution');
  if (!guarding || !guarding.entrenched) {
    throw new ConstitutionError(
      CONSTITUTION_ERRORS.CONFIG_INVALID,
      'المادةُ الناظمةُ لمسار التعديل (law:constitution) غائبةٌ أو غيرُ مختومة؛ ومسارٌ يعدّل نفسه ليس مساراً.',
    );
  }
  // رمزُ الرفض هو معرّفُ البند عملياً؛ فتكرارُه يجعل الواقعةَ مبهمة. أما وجودُ
  // الرمز في وحدةِ إنفاذه فيتحقّق منه `scripts/guard-constitution.mjs` لأنه
  // فحصُ مستودعٍ لا فحصُ تحميل.
  const codes = new Set(parsed.guarantees.map((entry) => entry.code));
  if (codes.size !== parsed.guarantees.length) {
    throw new ConstitutionError(
      CONSTITUTION_ERRORS.CONFIG_INVALID,
      'رمزُ رفضٍ مكرَّرٌ في بندَي ضمانٍ مختلفين؛ فلا يُعرف أيُّهما وقع.',
    );
  }
  const frozenArticles = parsed.articles.map((article) =>
    Object.freeze({ ...article, enforcedBy: Object.freeze([...article.enforcedBy]) }),
  );
  return Object.freeze({
    ...parsed,
    amendment: Object.freeze({ ...parsed.amendment }),
    integrity: Object.freeze({ ...parsed.integrity }),
    guarantees: Object.freeze(parsed.guarantees.map((entry) => Object.freeze({ ...entry }))),
    articles: Object.freeze(frozenArticles),
    foundingRoot: documentRoot(/** @type {ConstitutionArticle[]} */ (frozenArticles)),
  });
}

/**
 * يكتب ملفاً ذرّياً: مؤقّتٌ ثم `fsync` ثم `rename`. فانقطاعُ التيار لا يخلّف
 * دستوراً نصفَ مكتوب.
 * @param {string} file
 * @param {string} content
 * @returns {void}
 */
function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/**
 * مخزنُ الدستور: سلسلةُ عهودٍ موقَّعةٍ مترابطة، على القرص أو في الذاكرة.
 *
 * لا يُعدَّل هذا المخزنُ إلا من `AmendmentPath` — وهو ما يحرسه الحاجزُ بقاعدة
 * `holders`. والقراءةُ منه تفحص السلسلةَ أوّلاً: **فشلٌ مغلق** لا قراءةٌ متساهلة.
 */
export class ConstitutionStore {
  /**
   * @param {{ policy?: ConstitutionPolicy, signer?: ConstitutionSigner, dir?: string | null, now?: () => Date }} [deps]
   */
  constructor({ policy, signer, dir = null, now } = {}) {
    if (!policy) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.CONFIG_INVALID,
        'مخزنُ الدستور بلا سياسةٍ محمَّلة؛ ولا يُقاس على نصٍّ غير مقروء.',
      );
    }
    if (!signer || typeof signer.sign !== 'function' || typeof signer.verify !== 'function') {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.SIGNER_REQUIRED,
        'مخزنُ الدستور بلا موقِّعٍ ملكيّ؛ ونصٌّ أعلى بلا توقيعٍ سطرٌ يكتبه كلُّ من ملك القرص.',
      );
    }
    /** @type {ConstitutionPolicy} */
    this.policy = policy;
    /** @type {ConstitutionSigner} */
    this.signer = signer;
    this.now = now ?? (() => new Date());
    /** @type {string | null} */
    this.stateFile = dir === null ? null : path.join(dir, policy.integrity.stateFile);
    /** @type {string | null} */
    this.epochFile = dir === null ? null : path.join(dir, policy.integrity.epochFile);
    /** @type {SealedRevision[]} */
    this.memory = [];
    /** @type {number} */
    this.memoryHighWater = 0;
    this.#seal();
  }

  /**
   * يقرأ السلسلةَ الخام من المخزن — بلا تحقّق. خاصٌّ بالوحدة: كلُّ قارئٍ عامٍّ
   * يمرّ بـ`revisions()` التي تتحقّق أوّلاً.
   * @returns {SealedRevision[]}
   */
  #read() {
    if (this.stateFile === null) return this.memory;
    if (!fs.existsSync(this.stateFile)) return [];
    /** @type {unknown} */
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch (error) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.STORAGE_INVALID,
        `مخزنُ الدستور غيرُ مقروء: ${errorText(error)}`,
      );
    }
    if (!Array.isArray(raw)) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.STORAGE_INVALID,
        'مخزنُ الدستور ليس سلسلةَ عهود.',
      );
    }
    return /** @type {SealedRevision[]} */ (raw);
  }

  /**
   * @returns {number}
   */
  #highWater() {
    if (this.epochFile === null) return this.memoryHighWater;
    if (!fs.existsSync(this.epochFile)) return 0;
    const value = Number.parseInt(fs.readFileSync(this.epochFile, 'utf8').trim(), 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  /**
   * آخرُ حلقةٍ في السلسلة، أو خطأٌ إن كانت خالية. **لا فهرسةَ عمياء**: سلسلةٌ
   * خاليةٌ تُقرأ رفضاً لا `undefined` يمرّ في حسابٍ لاحق.
   * @param {SealedRevision[]} chain
   * @returns {SealedRevision}
   */
  #last(chain) {
    const last = chain[chain.length - 1];
    if (last === undefined) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.STORAGE_INVALID,
        'سلسلةُ العهود خالية؛ ولا يُقرأ آخرُ عهدٍ من لا شيء.',
      );
    }
    return last;
  }

  /**
   * @param {SealedRevision[]} chain
   * @returns {void}
   */
  #write(chain) {
    const top = chain.length === 0 ? 0 : this.#last(chain).revision.epoch;
    if (this.stateFile === null || this.epochFile === null) {
      this.memory = chain;
      this.memoryHighWater = Math.max(this.memoryHighWater, top);
      return;
    }
    // عدّادُ العهد يُرفع **قبل** كتابة السلسلة: فلو انقطع بينهما بقي العدّادُ
    // أعلى من السلسلة فيُقرأ تراجعاً ويُرفض — وهو الفشلُ المغلق. والعكسُ (كتابةُ
    // السلسلة أوّلاً) كان يترك نافذةً يُقبل فيها حذفُ آخر عهدٍ بلا كشف.
    writeAtomic(this.epochFile, `${Math.max(this.#highWater(), top)}\n`);
    writeAtomic(this.stateFile, `${JSON.stringify(chain, null, 2)}\n`);
  }

  /**
   * يختم النصَّ المؤسِّس في العهد الأول إن لم يكن مختوماً. وهذا الفعلُ الوحيدُ
   * الذي يكتب في المخزن من غير مسار التعديل — لأنه ليس تعديلاً بل تثبيتُ الأصل.
   * @returns {void}
   */
  #seal() {
    const chain = this.#read();
    if (chain.length > 0) return;
    /** @type {ConstitutionRevision} */
    const genesis = {
      epoch: 1,
      kind: RevisionKind.GENESIS,
      foundingRoot: this.policy.foundingRoot,
      articleId: null,
      text: null,
      amendmentId: null,
      ratifiedBy: null,
      at: this.now().toISOString(),
      previousHash: CONSTITUTION_GENESIS,
    };
    this.#write([{ revision: genesis, signature: this.signer.sign(genesis) }]);
  }

  /**
   * يفحص السلسلةَ كاملةً ويعيدها. كلُّ قراءةٍ تمرّ من هنا، فلا يُقرأ دستورٌ
   * مشكوكٌ فيه أصلاً.
   * @returns {SealedRevision[]}
   */
  revisions() {
    const chain = this.#read();
    if (chain.length === 0) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.STORAGE_INVALID,
        'مخزنُ الدستور خالٍ؛ والعهدُ الأول لا يُستنتج.',
      );
    }
    const first = chain[0];
    if (first === undefined) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.STORAGE_INVALID,
        'مخزنُ الدستور خالٍ؛ والعهدُ الأول لا يُستنتج.',
      );
    }
    if (first.revision.kind !== RevisionKind.GENESIS || first.revision.epoch !== 1) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.TAMPERED,
        'العهدُ الأول ليس تأسيساً؛ فالسلسلةُ مقطوعةُ الرأس.',
      );
    }
    if (first.revision.foundingRoot !== this.policy.foundingRoot) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.FOUNDING_TEXT_DRIFT,
        `النصُّ المؤسِّس تغيّر بعد ختمه: المختومُ ${first.revision.foundingRoot.slice(0, 16)}… والمقروءُ الآن ${this.policy.foundingRoot.slice(0, 16)}… — وتعديلُ الملفّ ليس مساراً دستورياً.`,
      );
    }
    let previous = CONSTITUTION_GENESIS;
    let expected = 1;
    for (const sealed of chain) {
      const { revision, signature } = sealed;
      if (revision.epoch !== expected) {
        throw new ConstitutionError(
          CONSTITUTION_ERRORS.TAMPERED,
          `فجوةٌ في العهود: انتُظر ${expected} فوُجد ${revision.epoch}.`,
        );
      }
      if (revision.previousHash !== previous) {
        throw new ConstitutionError(
          CONSTITUTION_ERRORS.TAMPERED,
          `العهدُ ${revision.epoch} لا يُرجع إلى سابقه؛ والسلسلةُ مفكوكةٌ عنده.`,
        );
      }
      if (revision.foundingRoot !== this.policy.foundingRoot) {
        throw new ConstitutionError(
          CONSTITUTION_ERRORS.FOUNDING_TEXT_DRIFT,
          `العهدُ ${revision.epoch} يحمل جذرَ نصٍّ مؤسِّسٍ مختلفاً.`,
        );
      }
      if (!this.signer.verify(revision, signature)) {
        throw new ConstitutionError(
          CONSTITUTION_ERRORS.TAMPERED,
          `توقيعُ العهد ${revision.epoch} لا يتحقّق بمفتاح الملك.`,
        );
      }
      previous = revisionHash(revision);
      expected += 1;
    }
    const top = this.#last(chain).revision.epoch;
    const highWater = this.#highWater();
    if (top < highWater) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.EPOCH_ROLLBACK,
        `العهدُ تراجع: بُلغ ${highWater} والسلسلةُ تنتهي عند ${top} — أي أنّ عهداً حُذف.`,
      );
    }
    return chain;
  }

  /**
   * يرفع خطأً إن لم تكن السلسلةُ سليمة. تستدعيه كلُّ خطوةٍ في مسار التعديل قبل
   * أيّ فعل، فلا يُبنى تعديلٌ على نصٍّ مشكوكٍ فيه.
   * @returns {void}
   */
  assertIntact() {
    this.revisions();
  }

  /** @returns {ConstitutionRevision} */
  current() {
    const chain = this.revisions();
    return Object.freeze({ ...this.#last(chain).revision });
  }

  /** @returns {number} */
  epoch() {
    return this.current().epoch;
  }

  /**
   * الموادُّ **النافذةُ الآن**: النصُّ المؤسِّس مطبَّقاً عليه كلُّ تعديلٍ أُبرم
   * بترتيب العهود. فمن أراد النافذَ لا يقرأ `config/constitution.yaml` وحده.
   * @returns {readonly ConstitutionArticle[]}
   */
  effective() {
    const chain = this.revisions();
    /** @type {Map<string, ConstitutionArticle>} */
    const byId = new Map();
    for (const article of this.policy.articles) byId.set(article.id, { ...article });
    for (const { revision } of chain) {
      if (revision.kind !== RevisionKind.AMENDMENT) continue;
      const id = revision.articleId ?? '';
      const article = byId.get(id);
      if (!article) {
        throw new ConstitutionError(
          CONSTITUTION_ERRORS.TAMPERED,
          `العهدُ ${revision.epoch} يعدّل مادةً غيرَ موجودةٍ في النصّ المؤسِّس: ${id}.`,
        );
      }
      article.text = revision.text ?? article.text;
    }
    return Object.freeze([...byId.values()].map((article) => Object.freeze(article)));
  }

  /**
   * @param {string} id
   * @returns {ConstitutionArticle}
   */
  articleOf(id) {
    const found = this.effective().find((article) => article.id === id);
    if (!found) {
      throw new ConstitutionError(
        CONSTITUTION_ERRORS.ARTICLE_UNKNOWN,
        `لا مادةَ بهذا المعرّف في الدستور: ${id}.`,
      );
    }
    return found;
  }

  /**
   * يُلحِق عهدَ تعديلٍ مُبرَماً. **لا يفحص هذا التابعُ شروطَ المسار** — فحصُها
   * في `AmendmentPath`، وهو الوحيدُ الذي يستدعيه؛ يحرس ذلك الحاجزُ بقاعدة
   * `holders` وبقاعدةٍ تمنع نداءَه من خارجهما.
   * @param {{ articleId: string, text: string, amendmentId: string, ratifiedBy: string }} amendment
   * @returns {ConstitutionRevision}
   */
  appendAmendment({ articleId, text, amendmentId, ratifiedBy }) {
    const chain = this.revisions();
    const last = this.#last(chain).revision;
    /** @type {ConstitutionRevision} */
    const revision = {
      epoch: last.epoch + 1,
      kind: RevisionKind.AMENDMENT,
      foundingRoot: this.policy.foundingRoot,
      articleId,
      text,
      amendmentId,
      ratifiedBy,
      at: this.now().toISOString(),
      previousHash: revisionHash(last),
    };
    this.#write([...chain, { revision, signature: this.signer.sign(revision) }]);
    return Object.freeze(revision);
  }
}
