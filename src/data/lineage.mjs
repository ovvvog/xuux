/**
 * نسب البيانات — M7.04.
 *
 * **العيب الذي تُغلقه هذه الوحدة، بنصّه:** كان في `state.data_assets` عمودٌ اسمه
 * `lineage` من نوع `jsonb`، و`DataCatalog.register` يقبل في طلبه مصفوفةً باسم
 * `lineage` ويكتبها كما هي: `['command']`، `[{ from: 'seed' }]`، أو `[]`. أي أن
 * «النسب» كان **ادّعاءً في الطلب** — يكتبه نفس من قد يريد إخفاء مصدره، ولا يُقاس
 * على شيء: لا معرّف أصلٍ يُتحقّق، ولا مصدرَ خارجياً يُربط، ولا تصنيفَ يُقارن. وهو
 * بعينه نمطُ العيب الذي أُغلق مرّتين: **الاعتماد حقلٌ في الطلب** (‏M7.01)
 * و**التخليص قيمةٌ في الطلب** (‏M7.02).
 *
 * وأسوأ منه أنه لم يكن هناك **استعلام نسب** أصلاً: سؤال «من حوّل هذا الأصل ومن
 * قرأه» لا جواب له في المستودع؛ القراءات كانت أحداثاً في سجل الأحداث فقط، وسجل
 * الأحداث يُقرأ بالتسلسل لا بالأصل، فلا يُجيب عن أصلٍ بعينه إلا بمسحٍ كامل.
 *
 * **فصار النسب صفوفاً تكتبها المسارات نفسها** في `state.data_lineage`:
 *
 *  1. **لا ادّعاء:** كلُّ سلفٍ **معرّفُ أصلٍ مفهرس** يُقرأ من الفهرس؛ وسلفٌ غير
 *     موجود يُرفض بـ`LINEAGE_PARENT_UNKNOWN` ولا يُكتب اسماً حرّاً.
 *  2. **الاشتقاق لا ينزل بالتصنيف:** أصلٌ مشتقٌّ من «سيادي» لا يكون «داخلياً»؛
 *     وإلا صار **التحويل** غسلاً للتصنيف يتجاوز اعتماد التخفيض الذي بُني في
 *     M7.01 — تُنسخ المادة إلى أصلٍ أدنى ثم تُقرأ بتخليصٍ أدنى.
 *  3. **لا دورات:** أصلٌ يكون سلفَ نفسه يجعل «السلسلة كاملة» غير منتهية ويجعل
 *     المصدر كذبة؛ فيُرفض بـ`LINEAGE_CYCLE_REFUSED` عند التسجيل لا عند الاستعلام.
 *  4. **سلسلة تجزئة لكل أصل:** كل صفٍّ يحمل `prevHash` للصفّ الذي قبله في نفس
 *     الأصل. فحذفُ صفٍّ أو تعديلُه في القاعدة **يُكشف** بـ`verify()`؛ ونسبٌ
 *     يُعدَّل بلا كشف ليس نسباً بل روايةً.
 *  5. **لا تعديل ولا حذف:** ليس في هذه الوحدة `update` ولا `delete` — والحذف
 *     الذي يقتضيه الاحتفاظ فعلٌ محكوم في M7.06 لا فعلٌ عابر هنا.
 *
 * **قرارٌ يستحقّ التسبيب:** القيد يُكتب **قبل** الأثر (‏`recordBeforeEffect`).
 * التسجيل بعد الأثر يفقد كل قراءةٍ سقطت العملية بعدها، فيصير سجلُّ النسب أقلَّ من
 * الواقع — وهذا أخطر الاتجاهين. والاتجاه المقبول عكسُه: قيدٌ لقراءةٍ أخفق أثرُها
 * بعد إذنها. وهو **حدٌّ معلَن** لا يُسكت عنه: `LineageEntry.kind === 'read'` يعني
 * «أُذن وقُيّد»، لا «تمّت المادة إلى يد الفاعل».
 *
 * **وحدٌّ معلَن ثانٍ:** `recordedAt` يُخزَّن **نصّاً** بصيغة ISO لا عموداً زمنياً.
 * السبب أنّ دقّة القاعدة ميكروثانية ودقّة `Date` في JavaScript ميليثانية، فتجزئةُ
 * قيمةٍ زمنية تُقرأ من القاعدة قد تخالف تجزئتها عند الكتابة — وهو انحرافٌ سقط فيه
 * المشروع مرّةً في `M3.05`. وسلسلةٌ تنكسر بفرق دقّة تنبح على البريء.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

import { DATA_LINEAGE_SPEC } from '../persistence/entities.mjs';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** مجلد الإعدادات الافتراضي. */
export const DEFAULT_LINEAGE_CONFIG_DIR = path.join(ROOT, 'config');

/** قيمة `prevHash` للصفّ الأول في سلسلة أصل: تُصرّح بالبداية ولا تُترك فراغاً. */
export const LINEAGE_GENESIS = 'genesis';

export const LINEAGE_ERRORS = Object.freeze({
  DEPENDENCY_MISSING: 'LINEAGE_DEPENDENCY_MISSING',
  CONFIG_INVALID: 'LINEAGE_CONFIG_INVALID',
  INPUT_INVALID: 'LINEAGE_INPUT_INVALID',
  KIND_UNKNOWN: 'LINEAGE_KIND_UNKNOWN',
  CLAIM_REFUSED: 'LINEAGE_CLAIM_REFUSED',
  ASSET_UNKNOWN: 'LINEAGE_ASSET_UNKNOWN',
  PARENT_UNKNOWN: 'LINEAGE_PARENT_UNKNOWN',
  SELF_PARENT: 'LINEAGE_SELF_PARENT',
  CYCLE_REFUSED: 'LINEAGE_CYCLE_REFUSED',
  DECLASSIFYING_DERIVATION: 'LINEAGE_DECLASSIFYING_DERIVATION',
  DEPTH_EXCEEDED: 'LINEAGE_DEPTH_EXCEEDED',
  CHAIN_BROKEN: 'LINEAGE_CHAIN_BROKEN',
});

/** خطأ نسبٍ مُسمّى: الرمز للأتمتة والنص لمن يراجع الرفض. */
export class LineageError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'LineageError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/**
 * @typedef {object} LineageKindSpec
 * @property {string} id
 * @property {boolean} requiresParents
 * @property {string} describes
 */

/**
 * @typedef {object} LineageEntry
 * @property {string} id
 * @property {string} assetId
 * @property {number} seq
 * @property {string} kind
 * @property {string} actorId
 * @property {string[]} parents
 * @property {string} purpose
 * @property {string} recordedAt - نصّ ISO؛ نصّاً لا زمناً لثبات التجزئة
 * @property {string} prevHash
 * @property {string} hash
 */

/** @typedef {import('./classification.mjs').ClassificationLattice} LineageLattice */

/**
 * @typedef {object} LineageAsset
 * @property {string} id
 * @property {string} owner
 * @property {import('./classification.mjs').ClassificationValue} classification
 */

/**
 * @typedef {object} LineageCatalogReader
 * @property {(id: string) => Promise<Record<string, unknown> | null>} get
 */

/**
 * سياسة النسب مقروءةً من `config/lineage.yaml`: بيانٌ محكوم بمخطَّط، لا ثوابت في
 * الكود. ومن غيّر ملفاً ولم يتبعه الآخر سقط التحميل ولم يمشِ التشغيل ناقصاً.
 */
export class LineagePolicy {
  /**
   * @param {{ version: number, owner: string, kinds: LineageKindSpec[], rules: { requireMonotonicClassification: boolean, refuseCycles: boolean, maxDepth: number, recordBeforeEffect: boolean }, chain: { hash: string, perAsset: boolean }, recorders: Array<{ module: string, kinds: string[] }>, store: { table: string, dbConstraints: string[] }, retiredClaimColumn?: { table: string, column: string } }} parsed
   */
  constructor(parsed) {
    this.version = parsed.version;
    this.owner = parsed.owner;
    /** @type {ReadonlyArray<LineageKindSpec>} */
    this.kinds = Object.freeze(parsed.kinds.map((kind) => Object.freeze({ ...kind })));
    this.rules = Object.freeze({ ...parsed.rules });
    this.chain = Object.freeze({ ...parsed.chain });
    /** @type {ReadonlyArray<{ module: string, kinds: ReadonlyArray<string> }>} */
    this.recorders = Object.freeze(
      parsed.recorders.map((entry) =>
        Object.freeze({ module: entry.module, kinds: Object.freeze([...entry.kinds]) }),
      ),
    );
    this.store = Object.freeze({
      table: parsed.store.table,
      dbConstraints: Object.freeze([...parsed.store.dbConstraints]),
    });
    /** @type {{ table: string, column: string } | null} */
    this.retiredClaimColumn =
      parsed.retiredClaimColumn === undefined
        ? null
        : Object.freeze({ ...parsed.retiredClaimColumn });
  }

  /** @returns {string[]} */
  get kindIds() {
    return this.kinds.map((kind) => kind.id);
  }

  /**
   * @param {unknown} kind
   * @returns {LineageKindSpec}
   */
  kindSpec(kind) {
    const found = this.kinds.find((entry) => entry.id === kind);
    if (found === undefined) {
      throw new LineageError(
        LINEAGE_ERRORS.KIND_UNKNOWN,
        `نوع النسب «${String(kind)}» غير معلَن في config/lineage.yaml؛ المعلَن: ${this.kindIds.join('، ')}. ونوعٌ لا يعرفه الإعداد يصير صفّاً لا يقرؤه استعلام.`,
        { kind: String(kind) },
      );
    }
    return found;
  }
}

/**
 * @param {string} dir
 * @returns {unknown}
 */
function readLineageConfig(dir) {
  const file = path.join(dir, 'lineage.yaml');
  if (!fs.existsSync(file)) {
    throw new LineageError(
      LINEAGE_ERRORS.CONFIG_INVALID,
      `سياسة النسب مفقودة: ${file}. وغيابُها رفضٌ لا افتراضُ «لا نسب مطلوب».`,
    );
  }
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * يحمّل سياسة النسب ويتحقّق من تماسكها مع سلّم التصنيف ومع أنواع المسجّلين.
 * @param {{ dir?: string, lattice: LineageLattice }} options
 * @returns {LineagePolicy}
 */
export function loadLineagePolicy({ dir = DEFAULT_LINEAGE_CONFIG_DIR, lattice }) {
  if (lattice === undefined || typeof lattice.rank !== 'function') {
    throw new LineageError(
      LINEAGE_ERRORS.CONFIG_INVALID,
      'تحميل سياسة النسب يشترط سلّم التصنيف: قاعدةُ «الاشتقاق لا ينزل بالتصنيف» تُقاس على السلّم، وسياسةٌ بلا سلّم كانت ستُعلن قاعدةً لا تستطيع فحصها.',
    );
  }
  const raw = readLineageConfig(dir);
  const schemaFile = path.join(dir, 'schemas', 'lineage.schema.json');
  if (!fs.existsSync(schemaFile)) {
    throw new LineageError(
      LINEAGE_ERRORS.CONFIG_INVALID,
      `مخطَّط سياسة النسب مفقود: ${schemaFile}.`,
    );
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
      .join('؛ ');
    throw new LineageError(LINEAGE_ERRORS.CONFIG_INVALID, `سياسة النسب لا تطابق مخططها: ${detail}`);
  }
  const parsed =
    /** @type {{ version: number, owner: string, kinds: LineageKindSpec[], rules: { requireMonotonicClassification: boolean, refuseCycles: boolean, maxDepth: number, recordBeforeEffect: boolean }, chain: { hash: string, perAsset: boolean }, recorders: Array<{ module: string, kinds: string[] }>, store: { table: string, dbConstraints: string[] }, retiredClaimColumn?: { table: string, column: string } }} */ (
      raw
    );

  const seen = new Set();
  for (const kind of parsed.kinds) {
    if (seen.has(kind.id)) {
      throw new LineageError(
        LINEAGE_ERRORS.CONFIG_INVALID,
        `نوع النسب «${kind.id}» معلَن مرّتين؛ نوعان بنفس المعرّف يجعلان «هل يشترط أسلافاً» رهنَ ترتيب القراءة.`,
      );
    }
    seen.add(kind.id);
  }
  for (const declared of ['origin', 'derivation']) {
    if (!seen.has(declared)) {
      throw new LineageError(
        LINEAGE_ERRORS.CONFIG_INVALID,
        `النوع «${declared}» غير معلَن؛ بلا أصلٍ أوّل وبلا اشتقاق لا تُبنى سلسلة نسبٍ أصلاً.`,
      );
    }
  }
  const policy = new LineagePolicy(parsed);
  if (policy.kindSpec('derivation').requiresParents !== true) {
    throw new LineageError(
      LINEAGE_ERRORS.CONFIG_INVALID,
      'الاشتقاق معلَنٌ بلا اشتراط أسلاف؛ اشتقاقٌ بلا سلف ليس اشتقاقاً بل أصلاً أوّل بمسمّى آخر.',
    );
  }
  if (policy.kindSpec('origin').requiresParents !== false) {
    throw new LineageError(
      LINEAGE_ERRORS.CONFIG_INVALID,
      'الأصل الأوّل معلَنٌ باشتراط أسلاف؛ فلن يُسجَّل أصلٌ جديد أبداً ويصير كل تسجيلٍ مرفوضاً.',
    );
  }
  const recorderKinds = new Set(policy.recorders.flatMap((entry) => entry.kinds));
  for (const kind of recorderKinds) {
    if (!seen.has(kind)) {
      throw new LineageError(
        LINEAGE_ERRORS.CONFIG_INVALID,
        `مسجّلٌ معلَن لنوع «${kind}» غير معلَن في الأنواع؛ فمسارٌ يُطالَب بتسجيل نوعٍ يرفضه الدفتر.`,
      );
    }
  }
  for (const kind of policy.kindIds) {
    if (!recorderKinds.has(kind)) {
      throw new LineageError(
        LINEAGE_ERRORS.CONFIG_INVALID,
        `النوع «${kind}» معلَنٌ ولا مسارَ مسجّلاً له؛ نوعٌ لا يكتبه أحد يجعل السلسلة ناقصةً بلا أن يشتكي شيء.`,
      );
    }
  }
  return policy;
}

/**
 * تجزئة الصفّ: تربطه بما قبله في نفس الأصل وبكل حقوله المعنوية.
 * @param {{ prevHash: string, assetId: string, seq: number, kind: string, actorId: string, parents: string[], purpose: string, recordedAt: string }} input
 * @returns {string}
 */
export function lineageHash({
  prevHash,
  assetId,
  seq,
  kind,
  actorId,
  parents,
  purpose,
  recordedAt,
}) {
  // ترتيبٌ ثابت ومصفوفةٌ مرتَّبة: تجزئةٌ تتغيّر بترتيب المفاتيح أو بترتيب الأسلاف
  // تُبلّغ عن كسرٍ لم يقع، فيُهمَل التبليغ كلّه بعد أول إنذارٍ كاذب.
  const canonical = JSON.stringify([
    prevHash,
    assetId,
    seq,
    kind,
    actorId,
    [...parents].sort((left, right) => left.localeCompare(right)),
    purpose,
    recordedAt,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {LineageEntry}
 */
function toEntry(row) {
  return /** @type {LineageEntry} */ (
    /** @type {unknown} */ (
      Object.freeze({
        ...row,
        parents: Object.freeze([.../** @type {string[]} */ (row['parents'] ?? [])]),
      })
    )
  );
}

/**
 * عيبٌ واحد في صفٍّ من السلسلة، أو `null` إن كان سليماً.
 *
 * الفحص واحدٌ للاستعلام ولـ`verify()` معاً قصداً: فحصان منفصلان يعنيان أن
 * الاستعلام قد يقبل ما ترفضه المراجعة — وقد وقع هذا فعلاً في أول تركيبٍ لهذه
 * الوحدة: كان الاستعلام يفحص الوصلة وحدها فيمرّ **تعديلُ الصفّ الأخير** بلا كشف،
 * لأن لا صفّ بعده يحمل تجزئته. فصار الفحص يعيد حساب التجزئة أيضاً.
 * @param {LineageEntry} entry
 * @param {string} expectedPrev
 * @param {number} expectedSeq
 * @returns {string | null}
 */
function chainFault(entry, expectedPrev, expectedSeq) {
  if (entry.seq !== expectedSeq) {
    return `ثغرة في التسلسل: المتوقّع ${expectedSeq} والموجود ${entry.seq} — صفٌّ حُذف أو أُدرج خارج الدفتر.`;
  }
  if (entry.prevHash !== expectedPrev) {
    return 'الوصلة بما قبله مكسورة: الصفّ السابق عُدّل أو حُذف.';
  }
  const recomputed = lineageHash({
    prevHash: entry.prevHash,
    assetId: entry.assetId,
    seq: entry.seq,
    kind: entry.kind,
    actorId: entry.actorId,
    parents: [...entry.parents],
    purpose: entry.purpose,
    recordedAt: entry.recordedAt,
  });
  return recomputed === entry.hash ? null : 'التجزئة لا تطابق حقول الصفّ: عُدّل بعد كتابته.';
}

/**
 * دفتر النسب: يُكتب فيه ولا يُعدَّل، ويُستعلَم منه بالأصل.
 */
export class LineageLedger {
  /**
   * @param {{ log?: import('../root-of-trust/event-log.mjs').EventLog, repository?: import('./data-catalog.mjs').DataRepository, catalog?: LineageCatalogReader, lattice?: LineageLattice, policy?: LineagePolicy, now?: () => Date }} [deps]
   */
  constructor({ log, repository, catalog, lattice, policy, now } = {}) {
    if (!log || !repository || !catalog || !lattice) {
      throw new LineageError(
        LINEAGE_ERRORS.DEPENDENCY_MISSING,
        'دفتر النسب يحتاج سجلاً ومستودعاً وفهرساً وسلّم تصنيف: بلا فهرسٍ يصير السلف اسماً حرّاً، وبلا سلّمٍ لا تُقاس قاعدةُ «الاشتقاق لا ينزل بالتصنيف».',
      );
    }
    this.log = log;
    /** @type {import('./data-catalog.mjs').DataRepository} */
    this.repository = repository;
    /** @type {LineageCatalogReader} */
    this.catalog = catalog;
    /** @type {LineageLattice} */
    this.lattice = lattice;
    /** @type {LineagePolicy} */
    this.policy = policy ?? loadLineagePolicy({ lattice });
    this.now = now ?? (() => new Date());
  }

  /** @returns {import('../persistence/entities.mjs').EntitySpec} */
  static get spec() {
    return DATA_LINEAGE_SPEC;
  }

  /**
   * يُسجّل قيد نسبٍ واحداً. لا `update` ولا `delete` في هذه الوحدة قصداً.
   * @param {object} input
   * @param {string} input.assetId
   * @param {string} input.kind
   * @param {string} input.actorId
   * @param {string[]} [input.parents]
   * @param {string} [input.purpose]
   * @param {Record<string, unknown> | null} [input.asset] سجلُّ الأصل إن كان
   *   المُنادي قرأه أصلاً (بوابة الوصول تقرؤه لبناء قرارها) — فلا يُقرأ مرّتين.
   * @returns {Promise<LineageEntry>}
   */
  async record({ assetId, kind, actorId, parents = [], purpose = 'unspecified', asset = null }) {
    const spec = this.policy.kindSpec(kind);
    const id = text(assetId);
    const actor = text(actorId);
    if (id === '') {
      throw new LineageError(
        LINEAGE_ERRORS.INPUT_INVALID,
        'قيد نسبٍ بلا معرّف أصل: قيدٌ لا يُعلَم موضعه لا يُستعلَم عنه أبداً.',
      );
    }
    if (actor === '') {
      throw new LineageError(
        LINEAGE_ERRORS.INPUT_INVALID,
        'قيد نسبٍ بلا فاعل: «من حوّله ومن قرأه» هو نصفُ ما يُسأل عنه النسب.',
      );
    }
    if (!Array.isArray(parents)) {
      throw new LineageError(
        LINEAGE_ERRORS.INPUT_INVALID,
        'الأسلاف يجب أن تكون مصفوفة معرّفات أصولٍ مفهرسة.',
      );
    }
    const parentIds = parents.map((parent) => text(parent));
    if (parentIds.some((parent) => parent === '')) {
      throw new LineageError(
        LINEAGE_ERRORS.INPUT_INVALID,
        'سلفٌ فارغ في قيد النسب: النسب معرّفات أصولٍ لا نصوصٌ وصفية — والوصفُ الحرّ هو العيب الذي أُغلق في هذه الخطوة.',
      );
    }
    if (new Set(parentIds).size !== parentIds.length) {
      throw new LineageError(
        LINEAGE_ERRORS.INPUT_INVALID,
        'سلفٌ مكرَّر في قيد النسب؛ التكرار يضاعف وزن مصدرٍ واحد في كل استعلام.',
      );
    }
    if (spec.requiresParents && parentIds.length === 0) {
      throw new LineageError(
        LINEAGE_ERRORS.INPUT_INVALID,
        `النوع «${spec.id}» يشترط أسلافاً معلَنة؛ اشتقاقٌ بلا سلف يقطع السلسلة عند أول تحويل.`,
        { kind: spec.id },
      );
    }
    if (!spec.requiresParents && parentIds.length > 0) {
      throw new LineageError(
        LINEAGE_ERRORS.INPUT_INVALID,
        `النوع «${spec.id}» لا يحمل أسلافاً؛ قراءةٌ أو أصلٌ أوّل يحمل أسلافاً يخلط الاشتقاق بالوصول فيصير الاستعلام كذباً.`,
        { kind: spec.id },
      );
    }
    if (parentIds.includes(id)) {
      throw new LineageError(
        LINEAGE_ERRORS.SELF_PARENT,
        `الأصل «${id}» سلفُ نفسه؛ هذا يجعل مصدره نفسه ويجعل السلسلة غير منتهية.`,
        { assetId: id },
      );
    }

    const record = asset ?? (await this.catalog.get(id));
    if (record === null) {
      throw new LineageError(
        LINEAGE_ERRORS.ASSET_UNKNOWN,
        `أصل البيانات «${id}» غير مفهرس؛ نسبٌ لأصلٍ لا وجود له في الفهرس يُنتج سلاسلَ معلَّقة.`,
        { assetId: id },
      );
    }
    const classification = /** @type {string} */ (record['classification']);

    for (const parent of parentIds) {
      const parentRecord = await this.catalog.get(parent);
      if (parentRecord === null) {
        throw new LineageError(
          LINEAGE_ERRORS.PARENT_UNKNOWN,
          `السلف «${parent}» غير مفهرس؛ ولا يُقبل سلفاً نصٌّ حرّ — فالنسب المُدّعى هو بعينه ما أُغلق في هذه الخطوة.`,
          { assetId: id, parent },
        );
      }
      const parentTier = /** @type {string} */ (parentRecord['classification']);
      if (
        this.policy.rules.requireMonotonicClassification &&
        this.lattice.rank(classification) < this.lattice.rank(parentTier)
      ) {
        throw new LineageError(
          LINEAGE_ERRORS.DECLASSIFYING_DERIVATION,
          `اشتقاقٌ ينزل بالتصنيف: الأصل «${id}» مصنّف «${classification}» وسلفُه «${parent}» مصنّف «${parentTier}». هذا هو طريقُ غسل التصنيف بالتحويل — تُنسخ المادة إلى أصلٍ أدنى ثم تُقرأ بتخليصٍ أدنى بلا اعتماد تخفيض.`,
          { assetId: id, parent, classification, parentClassification: parentTier },
        );
      }
      if (this.policy.rules.refuseCycles && (await this.#reaches(parent, id))) {
        throw new LineageError(
          LINEAGE_ERRORS.CYCLE_REFUSED,
          `دورةٌ في النسب: السلف «${parent}» يبلغ «${id}» عبر سلسلته، فيصير الأصل سلفَ نفسه. تُرفض عند التسجيل لا عند الاستعلام، لأن دفتراً فيه دورةٌ لا يُصلحه استعلام.`,
          { assetId: id, parent },
        );
      }
    }

    const previous = await this.#entriesOf(id);
    const last = previous.at(-1) ?? null;
    const seq = last === null ? 1 : last.seq + 1;
    const prevHash = last === null ? LINEAGE_GENESIS : last.hash;
    const recordedAt = this.now().toISOString();
    const reason = text(purpose) === '' ? 'unspecified' : text(purpose);
    const hash = lineageHash({
      prevHash,
      assetId: id,
      seq,
      kind: spec.id,
      actorId: actor,
      parents: parentIds,
      purpose: reason,
      recordedAt,
    });
    const row = await this.repository.insert({
      id: 'lineage:' + randomUUID(),
      assetId: id,
      seq,
      kind: spec.id,
      actorId: actor,
      parents: [...parentIds],
      purpose: reason,
      recordedAt,
      prevHash,
      hash,
    });
    this.log.append('data.lineage.recorded', actor, {
      assetId: id,
      kind: spec.id,
      seq,
      parents: [...parentIds],
      purpose: reason,
      hash,
    });
    return toEntry(row);
  }

  /**
   * **استعلام النسب** — معيار قبول `M7.04`: يُعيد السلسلة كاملة لأي أصل: أسلافه
   * كلَّهم إلى جذورهم، ومصادرَ تلك الجذور، وكلَّ من قرأ وكتب في الأصل وفي أسلافه.
   *
   * ولا يُعاد أثرٌ منقوص بوصفه كاملاً: تجاوزُ العمق المعلَن **يُرفض** بخطأ
   * `LINEAGE_DEPTH_EXCEEDED`، وسلسلةٌ مكسورة تُرفض بـ`LINEAGE_CHAIN_BROKEN`.
   * @param {string} assetId
   * @returns {Promise<{ assetId: string, depth: number, complete: boolean, nodes: Array<{ assetId: string, owner: string, classification: string, source: string | null, depth: number }>, edges: Array<{ child: string, parent: string }>, origins: Array<{ assetId: string, actorId: string, source: string | null, recordedAt: string }>, reads: Array<{ assetId: string, actorId: string, purpose: string, recordedAt: string }>, writes: Array<{ assetId: string, actorId: string, purpose: string, recordedAt: string }>, entries: LineageEntry[] }>}
   */
  async trace(assetId) {
    const id = text(assetId);
    const root = id === '' ? null : await this.catalog.get(id);
    if (root === null) {
      throw new LineageError(
        LINEAGE_ERRORS.ASSET_UNKNOWN,
        `أصل البيانات «${id}» غير مفهرس؛ استعلامُ نسبٍ لأصلٍ لا وجود له يُرفض بدل أن يُعيد سلسلةً فارغة تُقرأ «لا مصدر له».`,
        { assetId: id },
      );
    }

    /** @type {Map<string, { assetId: string, owner: string, classification: string, source: string | null, depth: number }>} */
    const nodes = new Map();
    /** @type {Array<{ child: string, parent: string }>} */
    const edges = [];
    /** @type {Array<{ assetId: string, actorId: string, source: string | null, recordedAt: string }>} */
    const origins = [];
    /** @type {Array<{ assetId: string, actorId: string, purpose: string, recordedAt: string }>} */
    const reads = [];
    /** @type {Array<{ assetId: string, actorId: string, purpose: string, recordedAt: string }>} */
    const writes = [];
    /**
     * كل القيود في الرسم لا قيودَ الأصل المسؤول عنه وحدها: «السلسلة كاملة» تعني
     * قيود الأسلاف أيضاً، ومن أعاد قيود العقدة الأولى وحدها أعاد طرفاً وسمّاه سلسلة.
     * @type {LineageEntry[]}
     */
    const allEntries = [];
    let maxDepth = 0;

    /** @type {Array<{ id: string, record: Record<string, unknown>, depth: number }>} */
    const queue = [{ id, record: root, depth: 0 }];
    while (queue.length > 0) {
      const current =
        /** @type {{ id: string, record: Record<string, unknown>, depth: number }} */ (
          queue.shift()
        );
      if (current.depth > this.policy.rules.maxDepth) {
        throw new LineageError(
          LINEAGE_ERRORS.DEPTH_EXCEEDED,
          `سلسلة النسب تجاوزت العمق المعلَن (${this.policy.rules.maxDepth}) عند «${current.id}»؛ تُرفض ولا تُعاد منقوصةً بوصفها كاملة.`,
          { assetId: id, at: current.id, maxDepth: this.policy.rules.maxDepth },
        );
      }
      if (nodes.has(current.id)) continue;
      const source = typeof current.record['source'] === 'string' ? current.record['source'] : null;
      nodes.set(current.id, {
        assetId: current.id,
        owner: /** @type {string} */ (current.record['owner']),
        classification: /** @type {string} */ (current.record['classification']),
        source,
        depth: current.depth,
      });
      if (current.depth > maxDepth) maxDepth = current.depth;

      const entries = await this.#entriesOf(current.id, { verify: true });
      allEntries.push(...entries);
      for (const entry of entries) {
        if (entry.kind === 'origin') {
          origins.push({
            assetId: current.id,
            actorId: entry.actorId,
            source,
            recordedAt: entry.recordedAt,
          });
        }
        if (entry.kind === 'read') {
          reads.push({
            assetId: current.id,
            actorId: entry.actorId,
            purpose: entry.purpose,
            recordedAt: entry.recordedAt,
          });
        }
        if (entry.kind === 'write') {
          writes.push({
            assetId: current.id,
            actorId: entry.actorId,
            purpose: entry.purpose,
            recordedAt: entry.recordedAt,
          });
        }
        for (const parent of entry.parents) {
          edges.push({ child: current.id, parent });
          if (nodes.has(parent)) continue;
          const parentRecord = await this.catalog.get(parent);
          if (parentRecord === null) {
            // سلفٌ اختفى من الفهرس بعد تسجيله: لا يُسكت عنه ولا يُعاد «سلسلة كاملة».
            throw new LineageError(
              LINEAGE_ERRORS.PARENT_UNKNOWN,
              `السلف «${parent}» مقيَّد في نسب «${current.id}» وغير موجود في الفهرس؛ سلسلةٌ فيها سلفٌ مفقود ليست كاملة، فتُرفض ولا تُعاد ناقصة.`,
              { assetId: id, parent },
            );
          }
          queue.push({ id: parent, record: parentRecord, depth: current.depth + 1 });
        }
      }
    }

    return {
      assetId: id,
      depth: maxDepth,
      complete: true,
      nodes: [...nodes.values()].sort((left, right) => left.depth - right.depth),
      edges,
      origins,
      reads,
      writes,
      entries: allEntries.sort(
        (left, right) => left.assetId.localeCompare(right.assetId) || left.seq - right.seq,
      ),
    };
  }

  /**
   * يفحص سلاسل التجزئة لكل الأصول: صفٌّ حُذف أو عُدّل في القاعدة يُكشف هنا.
   * @param {{ assetId?: string }} [options]
   * @returns {Promise<{ ok: boolean, assets: number, entries: number, broken: Array<{ assetId: string, seq: number, reason: string }> }>}
   */
  async verify(options = {}) {
    const filter = options.assetId === undefined ? {} : { assetId: options.assetId };
    const rows = await this.repository.list({ filter });
    /** @type {Map<string, LineageEntry[]>} */
    const byAsset = new Map();
    for (const row of rows) {
      const entry = toEntry(row);
      const bucket = byAsset.get(entry.assetId) ?? [];
      bucket.push(entry);
      byAsset.set(entry.assetId, bucket);
    }
    /** @type {Array<{ assetId: string, seq: number, reason: string }>} */
    const broken = [];
    let entries = 0;
    for (const [assetId, bucket] of byAsset) {
      bucket.sort((left, right) => left.seq - right.seq);
      let expectedPrev = LINEAGE_GENESIS;
      let expectedSeq = 1;
      for (const entry of bucket) {
        entries += 1;
        const fault = chainFault(entry, expectedPrev, expectedSeq);
        if (fault !== null) broken.push({ assetId, seq: entry.seq, reason: fault });
        expectedPrev = entry.hash;
        expectedSeq = entry.seq + 1;
      }
    }
    return { ok: broken.length === 0, assets: byAsset.size, entries, broken };
  }

  /**
   * @param {string} assetId
   * @param {{ verify?: boolean }} [options]
   * @returns {Promise<LineageEntry[]>}
   */
  async #entriesOf(assetId, options = {}) {
    const rows = await this.repository.list({ filter: { assetId } });
    const entries = rows.map((row) => toEntry(row)).sort((left, right) => left.seq - right.seq);
    if (options.verify === true) {
      let expectedPrev = LINEAGE_GENESIS;
      let expectedSeq = 1;
      for (const entry of entries) {
        const fault = chainFault(entry, expectedPrev, expectedSeq);
        if (fault !== null) {
          throw new LineageError(
            LINEAGE_ERRORS.CHAIN_BROKEN,
            `سلسلة نسب الأصل «${assetId}» مكسورة عند التسلسل ${entry.seq}: ${fault} استعلامٌ يُعيد سلسلةً مكسورة بوصفها كاملة أسوأ من استعلامٍ يرفض.`,
            { assetId, seq: entry.seq, reason: fault },
          );
        }
        expectedPrev = entry.hash;
        expectedSeq = entry.seq + 1;
      }
    }
    return entries;
  }

  /**
   * هل يبلغ `from` الهدفَ `target` صعوداً في سلاسل الاشتقاق؟ يُستعمل لمنع الدورات
   * **قبل** الكتابة، فلا يدخل الدفتر ما لا يخرج منه استعلام.
   * @param {string} from
   * @param {string} target
   * @returns {Promise<boolean>}
   */
  async #reaches(from, target) {
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {string[]} */
    const stack = [from];
    let steps = 0;
    while (stack.length > 0) {
      const current = /** @type {string} */ (stack.pop());
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      if (++steps > this.policy.rules.maxDepth) {
        throw new LineageError(
          LINEAGE_ERRORS.DEPTH_EXCEEDED,
          `فحصُ الدورات تجاوز العمق المعلَن (${this.policy.rules.maxDepth}) من «${from}»؛ الرفض أسلمُ من قبول قيدٍ لا يُفحص.`,
          { from, target, maxDepth: this.policy.rules.maxDepth },
        );
      }
      for (const entry of await this.#entriesOf(current)) {
        for (const parent of entry.parents) stack.push(parent);
      }
    }
    return false;
  }
}
