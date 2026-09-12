/**
 * دورة الاحتفاظ والمحو المحكومة — الخطوة `M7.06`.
 *
 * **العيوب التي تُغلقها هذه الوحدة، بنصّها كما كانت:**
 *
 *  1. **محوٌ لا يُسجَّل.** `src/persistence/retention.mjs` (‏`M3.08`) يحذف الصفوف
 *     المنتهية بـ`DELETE` مباشرةً بلا شاهد. ومعيار قبول هذه الخطوة نصّه «دورة
 *     احتفاظ كاملة **تُمحى وتُسجَّل**»، والشطر الثاني كان غائباً تماماً.
 *  2. **دورةٌ تفشل على مرجع.** `state.data_lineage.asset_id` و
 *     `state.classification_approvals.asset_id` يرجعان إلى `state.data_assets(id)`
 *     بلا `ON DELETE` — وهذا مقصودٌ في الهجرة `0007`: «المحوُ فعلٌ محكوم في
 *     M7.06 لا أثرٌ جانبي لحذفٍ عابر». لكن `purge` لا يعرف التوابع، فمحوُ أصلٍ
 *     له صفّ نسبٍ واحد كان يفشل بخطأ مرجعٍ خام (‏`23503`) ويُرجع المعاملة كلها،
 *     فلا يُمحى شيءٌ ولو كان مؤهّلاً. وهذه الدورة تمحو التابع **بعد إثبات عدده
 *     وشهادة رأس سلسلته** في دفتر المحو، فيبقى الجواب عن «من قرأ هذا الأصل»
 *     شهادةً بعد زوال صفوفه.
 *  3. **ذاكرةٌ تُمحى وعقدها يبقى.** `AgentMemoryStore.sweepExpired` (‏`M7.05`)
 *     يحذف صفّ الذاكرة ويترك عقد بياناته في الفهرس يتيماً بلا مادّة؛ وتعليقُه في
 *     الكود يُحيل الدورة الكاملة إلى هذه الخطوة بالاسم.
 *  4. **ترتيبٌ غير معلَن.** `state.memories.dataset_id` يرجع إلى الأصل بـ
 *     `ON DELETE RESTRICT`، فمحوُ الأصل قبل ذاكرته مرفوضٌ في القاعدة؛ وكان
 *     الترتيب مصادفةَ ترتيبِ مفاتيحٍ في كائنٍ لا قراراً معلَناً. صار معلَناً في
 *     `config/retention.yaml` ويرفض المُحمِّل عكسه.
 *
 * **وحدٌّ معلَن:** الدورة **لا تُجدول نفسها**. تشغيلُها قرارٌ منفصل
 * (`node scripts/retention.mjs cycle`)، وبوابةُ `minHoursBetweenRuns` تمنع
 * تكرارها بالخطأ لا تُغني عن مُجدوِل. وربطُها بطابور المهام يقتضي عاملاً يحمل
 * تركيب الدولة كاملاً بقاعدةٍ حيّة، ولم تتوفّر قاعدةٌ في بيئة هذه الخطوة فلم
 * يُكتب ما لا يُقاس — وهو مسجَّل في `docs/REMAINING_WORK.md`.
 *
 * **والعيبُ الخامسُ أُغلقَ في `R6-A-01`** (مجلسُ النماذجِ، الجولةُ `M11.06`):
 * كان حارسُ المحوِ الوحيدُ `assertSweeper` يقرأُ `actor.role` **نصّاً يُرسلُه
 * المُنادي** ويقارنُه بأدوارِ المطهِّرِ المُعلَنةِ — بلا بوابةِ هويةٍ، وبلا نداءٍ
 * إلى `EnforcementPoint.authorize`، وبلا أمرٍ ملكيٍّ. وقياسُ المجلسِ: فاعلٌ
 * `{ id: 'nobody:unregistered', role: 'role:operator' }` غيرُ مسجَّلٍ ولا شهادةَ
 * له محا صفَّينِ فعلاً بصفرِ نداءاتٍ إلى `authorize`. وفي الوقتِ نفسِه كان
 * `purge-data` مُعلَناً فوقَ العتبةِ السياديّةِ (`config/royal-authority.yaml`،
 * `delegable: false`) **بلا مستهلِكٍ واحدٍ في `src/`** — فالعتبةُ تُعلَن على فعلٍ
 * لا يُنادى عليه أحدٌ، والمحوُ يقعُ من مسارٍ لا يعرفُه القانونُ.
 *
 * فصارَ المحوُ الفعليُّ (`run` و`eraseDirected`) يمرُّ **فعلاً** بنقطةِ التفويضِ
 * على الفعلِ `purge-data`: هويةُ الفاعلِ تُستبدَلُ بما يقولُه جذرُ الثقةِ في
 * بوابةِ الهويةِ، والسياسةُ تُقيَّم، والعتبةُ السياديّةُ تطلبُ أمراً ملكيّاً،
 * وتذكرةُ القرارِ تُستهلَكُ قبلَ أوّلِ حذفٍ. وغيابُ نقطةِ التفويضِ أو غيابُ بوابةِ
 * الهويةِ فيها **رفضٌ مُسمّىً** (`RETENTION_AUTHORIZER_REQUIRED`) لا سقوطٌ إلى
 * حارسِ الدورِ النصّيِّ: تركيبٌ صامتٌ يمحو هو العيبُ بعينِه. وحارسُ الدورِ باقٍ
 * **مُرشِّحاً ثانياً** لا سلطةً: ما يحكمُ هو القرارُ لا نصُّ المُنادي.
 *
 * **وحدٌّ معلَن ثانٍ:** الكتابةُ في الذاكرة لا تُشغّل دورةً لتحرير الحصّة. وهذا
 * **قرارٌ لا نقص**: أدوار المطهِّر لا تشمل الوكيل قصداً (`config/memory.yaml`)،
 * فمحوٌ يُشغّله فعلُ الوكيل يمنحه سلطةً منعتها السياسة عنه. فالحصّة تُحرَّر بمرور
 * الدورة التشغيلية، ورفضُ الحصّة يبقى رفضاً مُسمّى إلى أن تمرّ.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

import { loadMemoryPolicy } from './memory-limits.mjs';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** مجلد الإعدادات الافتراضي. */
export const DEFAULT_RETENTION_CONFIG_DIR = path.join(ROOT, 'config');

/** مفاتيح الأهداف المعلَنة؛ ووجود جدولٍ في المخطَّط لا يجيز محوه. */
export const RETENTION_TARGETS = Object.freeze(['memories', 'data_assets']);

export const RETENTION_CYCLE_ERRORS = Object.freeze({
  CONFIG_INVALID: 'RETENTION_CONFIG_INVALID',
  INPUT_INVALID: 'RETENTION_INPUT_INVALID',
  SWEEP_REFUSED: 'RETENTION_SWEEP_REFUSED',
  TOO_SOON: 'RETENTION_TOO_SOON',
  LEGAL_HOLD: 'RETENTION_LEGAL_HOLD',
  DEPENDENT_PRESENT: 'RETENTION_DEPENDENT_PRESENT',
  NOT_FOUND: 'RETENTION_NOT_FOUND',
  NOT_DUE: 'RETENTION_NOT_DUE',
  // `R6-A-01`: غيابُ نقطةِ التفويضِ (أو غيابُ بوابةِ الهويةِ فيها) رفضٌ مُسمّىً.
  AUTHORIZER_REQUIRED: 'RETENTION_AUTHORIZER_REQUIRED',
  NOT_AUTHORIZED: 'RETENTION_NOT_AUTHORIZED',
});

/**
 * الفعلُ المحكومُ الذي يُنادى عليه المحوُ (‏`R6-A-01`). مُعلَنٌ في
 * `config/policies.yaml` وفوقَ العتبةِ السياديّةِ في `config/royal-authority.yaml`،
 * وكان قبلَ هذه الخطوةِ بلا مستهلِكٍ واحدٍ في `src/`.
 */
export const PURGE_ACTION = 'purge-data';

/** خطأ دورةٍ مُسمّى: الرمز للأتمتة والنص لمن يقرأ الرفض. */
export class RetentionCycleError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = 'RetentionCycleError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

/**
 * @typedef {object} TableReference
 * @property {string} table
 * @property {string} column
 * @property {true} [attest]
 */

/**
 * @typedef {object} RetentionPolicyShape
 * @property {number} version
 * @property {string} owner
 * @property {{ order: string[], sweeperRoles: string[], maxErasuresPerRun: number, minHoursBetweenRuns: number }} cycle
 * @property {Record<string, Record<string, unknown>>} targets
 * @property {{ table: string, dbConstraints: string[] }} ledger
 * @property {Array<{ module: string, methods: string[] }>} guardedPaths
 * @property {string[]} ledgerHolders
 */

/** سياسة دورةٍ محمَّلة ومُتحقَّقة. */
export class RetentionCyclePolicy {
  /** @param {RetentionPolicyShape} shape */
  constructor(shape) {
    this.version = shape.version;
    this.owner = shape.owner;
    this.cycle = Object.freeze({
      order: Object.freeze([...shape.cycle.order]),
      sweeperRoles: Object.freeze([...shape.cycle.sweeperRoles]),
      maxErasuresPerRun: shape.cycle.maxErasuresPerRun,
      minHoursBetweenRuns: shape.cycle.minHoursBetweenRuns,
    });
    this.targets =
      /** @type {Readonly<{ memories: Record<string, unknown>, data_assets: Record<string, unknown> }>} */ (
        Object.freeze({
          memories: Object.freeze({ ...shape.targets['memories'] }),
          data_assets: Object.freeze({
            ...shape.targets['data_assets'],
            dependents: Object.freeze(
              /** @type {TableReference[]} */ (
                shape.targets['data_assets']?.['dependents'] ?? []
              ).map((entry) => Object.freeze({ ...entry })),
            ),
            blockedBy: Object.freeze(
              /** @type {TableReference[]} */ (
                shape.targets['data_assets']?.['blockedBy'] ?? []
              ).map((entry) => Object.freeze({ ...entry })),
            ),
          }),
        })
      );
    this.ledger = Object.freeze({
      table: shape.ledger.table,
      dbConstraints: Object.freeze([...shape.ledger.dbConstraints]),
    });
    this.guardedPaths = Object.freeze(
      shape.guardedPaths.map((entry) =>
        Object.freeze({ module: entry.module, methods: Object.freeze([...entry.methods]) }),
      ),
    );
    this.ledgerHolders = Object.freeze([...shape.ledgerHolders]);
    Object.freeze(this);
  }

  /**
   * هل يجوز لهذا الدور تشغيل الدورة؟
   * @param {string} role
   * @returns {boolean}
   */
  isSweeper(role) {
    return this.cycle.sweeperRoles.includes(role);
  }

  /** @returns {readonly TableReference[]} */
  get assetDependents() {
    return /** @type {readonly TableReference[]} */ (this.targets.data_assets['dependents'] ?? []);
  }

  /** @returns {readonly TableReference[]} */
  get assetBlockers() {
    return /** @type {readonly TableReference[]} */ (this.targets.data_assets['blockedBy'] ?? []);
  }
}

/**
 * يحمّل سياسة الدورة ويتحقّق منها ضدّ مخطَّطها، ثم يفحص تماسكها **مع سياسة
 * الذاكرة**: أدوار المطهِّر معلَنة في الملفّين، وقائمتان مختلفتان تعنيان أنّ
 * المحو يقع بدورٍ لا يملكه في الملف الآخر.
 * @param {{ dir?: string }} [options]
 * @returns {RetentionCyclePolicy}
 */
export function loadRetentionPolicy({ dir = DEFAULT_RETENTION_CONFIG_DIR } = {}) {
  const file = path.join(dir, 'retention.yaml');
  if (!fs.existsSync(file)) {
    throw new RetentionCycleError(
      RETENTION_CYCLE_ERRORS.CONFIG_INVALID,
      `سياسة الاحتفاظ مفقودة: ${file}. ودورةُ محوٍ بلا سياسةٍ معلَنة تعود إلى أرقامٍ في الكود، وهو ما أُخرج منه.`,
    );
  }
  const raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  const schemaFile = path.join(dir, 'schemas', 'retention.schema.json');
  if (!fs.existsSync(schemaFile)) {
    throw new RetentionCycleError(
      RETENTION_CYCLE_ERRORS.CONFIG_INVALID,
      `مخطَّط سياسة الاحتفاظ مفقود: ${schemaFile}.`,
    );
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
      .join('؛ ');
    throw new RetentionCycleError(
      RETENTION_CYCLE_ERRORS.CONFIG_INVALID,
      `سياسة الاحتفاظ لا تطابق مخططها: ${detail}`,
    );
  }
  const parsed = /** @type {RetentionPolicyShape} */ (raw);
  for (const key of RETENTION_TARGETS) {
    if (!parsed.cycle.order.includes(key)) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.CONFIG_INVALID,
        `الهدف «${key}» معلَنٌ في targets وغائبٌ عن ترتيب الدورة؛ هدفٌ لا موضع له في الترتيب لا يُمحى أبداً وتبقى سياستُه زينة.`,
        { key },
      );
    }
  }
  if (new Set(parsed.cycle.order).size !== parsed.cycle.order.length) {
    throw new RetentionCycleError(
      RETENTION_CYCLE_ERRORS.CONFIG_INVALID,
      'هدفٌ مذكورٌ مرّتين في ترتيب الدورة؛ مرورٌ مضاعف على نفس الجدول يكتب شاهدَي محوٍ لصفٍّ واحد.',
    );
  }
  if (parsed.cycle.order.indexOf('memories') > parsed.cycle.order.indexOf('data_assets')) {
    throw new RetentionCycleError(
      RETENTION_CYCLE_ERRORS.CONFIG_INVALID,
      'ترتيب الدورة يمحو عقود البيانات قبل الذاكرة؛ و`state.memories.dataset_id` يرجع إلى الأصل بـ`ON DELETE RESTRICT` فالمحو مرفوضٌ محتوماً في القاعدة. الذاكرة قبل عقدها.',
    );
  }
  const memory = loadMemoryPolicy({ dir });
  const declared = [...parsed.cycle.sweeperRoles].sort((a, b) => a.localeCompare(b));
  const inMemory = [...memory.expiry.sweeperRoles].sort((a, b) => a.localeCompare(b));
  if (declared.join('|') !== inMemory.join('|')) {
    throw new RetentionCycleError(
      RETENTION_CYCLE_ERRORS.CONFIG_INVALID,
      `أدوار المطهِّر تختلف بين config/retention.yaml (${declared.join('، ')}) وconfig/memory.yaml (${inMemory.join('، ')})؛ قائمتان مختلفتان في ملفّين تعنيان أنّ المحو يقع بدورٍ لا يملكه في الملف الآخر.`,
      { declared, inMemory },
    );
  }
  return new RetentionCyclePolicy(parsed);
}

/**
 * @param {Date | string | null | undefined} value
 * @returns {Date | null}
 */
function toDate(value) {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * @param {unknown} now
 * @returns {Date}
 */
function assertNow(now) {
  const at = toDate(/** @type {Date} */ (now));
  if (at === null) {
    throw new RetentionCycleError(
      RETENTION_CYCLE_ERRORS.INPUT_INVALID,
      '«now» يجب أن يكون تاريخاً صالحاً؛ تاريخٌ غير صالح يمحو بحدٍّ غير معلوم.',
    );
  }
  return at;
}

/**
 * @param {{ id?: unknown, role?: unknown }} actor
 * @param {RetentionCyclePolicy} policy
 * @returns {{ id: string, role: string }}
 */
function assertSweeper(actor, policy) {
  if (
    actor === undefined ||
    actor === null ||
    typeof actor.id !== 'string' ||
    typeof actor.role !== 'string'
  ) {
    throw new RetentionCycleError(
      RETENTION_CYCLE_ERRORS.INPUT_INVALID,
      'دورةُ محوٍ بلا فاعل: شاهدُ المحو يُنسب إلى فاعل، ومحوٌ بلا فاعلٍ محوٌ لا يُراجَع.',
    );
  }
  if (!policy.isSweeper(actor.role)) {
    throw new RetentionCycleError(
      RETENTION_CYCLE_ERRORS.SWEEP_REFUSED,
      `الدور «${actor.role}» ليس من أدوار المطهِّر المعلَنة (${policy.cycle.sweeperRoles.join('، ')}): من يمحو ما انتهت مدّته يمحو دليلاً، فلا يكون صاحبه.`,
      { role: actor.role },
    );
  }
  return { id: actor.id, role: actor.role };
}

/**
 * دورة الاحتفاظ: تخطيطٌ يقرأ ولا يمحو، وتشغيلٌ يمحو ويشهد.
 *
 * والمستودعات تُمرَّر من الخارج كما في كل سجلات `M3.05`: وحدةٌ تفتح وصلتها بنفسها
 * تكتب خارج المعاملة، فتفترق الشهادة عن فعلها عند أول إخفاق.
 */
export class RetentionCycle {
  /**
   * @param {object} deps
   * @param {{ append: (type: string, actor: string, data: object) => unknown }} deps.log
   * @param {import('./erasure-ledger.mjs').ErasureLedger} deps.erasureLedger
   * @param {{ dataAssets: any, memories: any, dataLineage: any, classificationApprovals: any }} deps.repositories
   * @param {RetentionCyclePolicy} [deps.policy]
   * @param {{ authorize: (request: import('../policy/model.mjs').PolicyRequest, measurement?: { measured?: Record<string, unknown> }) => Promise<{ decision: { allowed: boolean, code: string, reason: string }, token: string | null }>, verify: (token: string | undefined, expected: { actorId: string, action: string, resourceKey: string, royalCommandId?: string, royalCommandDigest?: string }) => unknown, identityGate?: unknown } | null} [deps.authorizer]
   *   نقطةُ التفويضِ (‏`R6-A-01`). وتركُها لا يفتحُ الباب بل يُغلقُه: المحوُ
   *   يُرفَضُ برمزٍ مُسمّىً، إذ محوٌ يقعُ بتركيبٍ صامتٍ هو العيبُ المُغلَق.
   */
  constructor({ log, erasureLedger, repositories, policy, authorizer = null }) {
    if (log === undefined || erasureLedger === undefined || repositories === undefined) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.INPUT_INVALID,
        'الدورة تحتاج سجلاً ودفتر محوٍ ومستودعات: دورةٌ بلا دفترٍ تمحو بلا شاهد، وهو العيب الذي أُغلق في هذه الخطوة.',
      );
    }
    this.log = log;
    this.erasureLedger = erasureLedger;
    this.repositories = repositories;
    this.policy = policy ?? loadRetentionPolicy();
    this.authorizer = authorizer;
  }

  /**
   * تفويضُ المحوِ (‏`R6-A-01`): نداءٌ **فعليٌّ** إلى نقطةِ التفويضِ على الفعلِ
   * `purge-data` قبلَ أوّلِ حذفٍ، وتذكرةُ القرارِ تُستهلَكُ بعدَه.
   *
   * وثلاثةُ حدودٍ مُعلَنةٍ لا تُتجاوَز:
   *  1. **لا نقطةَ تفويضٍ ⇒ لا محوَ.** الرفضُ `RETENTION_AUTHORIZER_REQUIRED`.
   *  2. **لا بوابةَ هويةٍ في النقطةِ ⇒ لا محوَ.** نقطةٌ بلا بوابةٍ تقبلُ الفاعلَ
   *     كما وصفَ نفسَه، وهو نصُّ العيبِ المقيسِ: فاعلٌ غيرُ مسجَّلٍ محا صفَّينِ.
   *  3. **رفضُ القرارِ ⇒ لا محوَ**، ورمزُ الرفضِ يُنقلُ كما هو لا يُترجَمُ إلى
   *     «رفضِ دورٍ»: العتبةُ السياديّةُ ترفضُ بلا أمرٍ ملكيٍّ، وبوابةُ الهويةِ
   *     ترفضُ الفاعلَ المجهولَ، وهما رفضانِ مختلفانِ يُقرآنِ مختلفَينِ.
   * @param {{ actor: { id?: unknown, role?: unknown, kind?: unknown, state?: unknown }, resourceKey: string, resourceId: string, context?: Record<string, unknown>, royalCommand?: { id: string, digest: string } }} request
   * @returns {Promise<{ id: string, role: string }>}
   */
  async #authorizeSweep({ actor, resourceKey, resourceId, context = {}, royalCommand }) {
    const sweeper = assertSweeper(actor, this.policy);
    if (this.authorizer === null || typeof this.authorizer.authorize !== 'function') {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.AUTHORIZER_REQUIRED,
        `المحوُ فعلٌ محكومٌ («${PURGE_ACTION}») فوقَ العتبةِ السياديّةِ، ولم تُمرَّر نقطةُ تفويضٍ؛ ومحوٌ يقعُ بلا قرارٍ هو تصعيدُ صلاحيةٍ لا دورةُ احتفاظٍ.`,
        { action: PURGE_ACTION },
      );
    }
    if (
      this.authorizer.identityGate === null ||
      this.authorizer.identityGate === undefined ||
      typeof (/** @type {{ verify?: unknown }} */ (this.authorizer.identityGate).verify) !==
        'function'
    ) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.AUTHORIZER_REQUIRED,
        'نقطةُ التفويضِ الممرَّرةُ بلا بوابةِ هويةٍ موصولةٍ؛ فتقبلُ الفاعلَ كما وصفَ نفسَه، والمحوُ لا يقعُ على وصفٍ يُرسلُه المُنادي.',
        { action: PURGE_ACTION },
      );
    }
    const { decision, token } = await this.authorizer.authorize({
      actor: {
        id: sweeper.id,
        role: sweeper.role,
        kind: /** @type {import('../policy/model.mjs').ActorKind} */ (
          typeof actor.kind === 'string' ? actor.kind : 'human'
        ),
        state: typeof actor.state === 'string' ? actor.state : 'active',
      },
      action: PURGE_ACTION,
      resource: { type: 'data', id: resourceId, classification: 'secret' },
      context,
      // الأمرُ الملكيُّ حقلٌ في الطلبِ لا في السياقِ (‏`engine.mjs` L296–320):
      // العتبةُ السياديّةُ تقرؤه من هناك، ووضعُه في السياقِ يجعلُه بلا أثرٍ.
      ...(royalCommand === undefined
        ? {}
        : { royalCommandId: royalCommand.id, royalCommandDigest: royalCommand.digest }),
    });
    if (!decision.allowed) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.NOT_AUTHORIZED,
        `نقطةُ التفويضِ رفضت المحوَ برمز ${decision.code}: ${decision.reason}`,
        { action: PURGE_ACTION, code: decision.code },
      );
    }
    // التذكرةُ تُستهلَكُ قبلَ أوّلِ حذفٍ لا بعدَه: قرارٌ لا تُستهلَكُ تذكرتُه يبقى
    // قابلاً لإعادةِ الاستعمالِ على محوٍ ثانٍ.
    try {
      this.authorizer.verify(token ?? undefined, {
        actorId: sweeper.id,
        action: PURGE_ACTION,
        resourceKey,
        // ربطُ الأمرِ الملكيِّ يُقدَّم للتحقّقِ كما هو: تذكرةٌ صدرتْ لأمرٍ ثمّ
        // قُدِّمتْ بأمرٍ آخرَ تُرفَض، ولا يُستهلَكُ قرارُ أمرٍ على أمرٍ غيرِه.
        ...(royalCommand === undefined
          ? {}
          : { royalCommandId: royalCommand.id, royalCommandDigest: royalCommand.digest }),
      });
    } catch (error) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.NOT_AUTHORIZED,
        `تذكرةُ قرارِ المحوِ غيرُ مقبولةٍ: ${error instanceof Error ? error.message : String(error)}`,
        { action: PURGE_ACTION },
      );
    }
    this.log.append('retention.authorized', sweeper.id, {
      action: PURGE_ACTION,
      resourceKey,
    });
    return sweeper;
  }

  /**
   * هل انتهت مدّة مدخل ذاكرةٍ؟ الحفظ القانوني يمنع الانتهاء لا يؤجّله.
   * @param {Record<string, unknown>} row
   * @param {Date} now
   * @returns {boolean}
   */
  #memoryExpired(row, now) {
    if (row['legalHold'] === true) return false;
    const at = toDate(/** @type {Date | null} */ (row['expiresAt'] ?? null));
    return at !== null && at.getTime() <= now.getTime();
  }

  /**
   * هل انتهت مدّة أصلٍ؟ النهاية `created_at + retention_days`، وهي نفس معادلة
   * `M3.08` في القاعدة — ومعادلتان لمعنىً واحد تفترقان أوّل تعديل.
   * @param {Record<string, unknown>} row
   * @param {Date} now
   * @returns {boolean}
   */
  #assetExpired(row, now) {
    if (row['legalHold'] === true) return false;
    const created = toDate(/** @type {Date | null} */ (row['createdAt'] ?? null));
    const days = Number(row['retentionDays']);
    if (created === null || !Number.isFinite(days)) return false;
    return created.getTime() + days * 86400000 <= now.getTime();
  }

  /**
   * مداخل ذاكرةٍ ما زالت تُرجع إلى أصل. هذا هو المانع المعلَن `blockedBy`، ومرجعُ
   * القاعدة `ON DELETE RESTRICT` هو الضمان الأخير خلفه.
   * @param {string} assetId
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async #memoriesOf(assetId) {
    const rows = await this.repositories.memories.list({ filter: { datasetId: assetId } });
    return rows;
  }

  /**
   * شهادةُ توابع أصلٍ قبل زوالها: العدد، ورأسُ سلسلة النسب. تُقرأ **قبل** الحذف
   * ولا تُستنتج بعده: بعد الحذف لا يبقى ما يُشهد عليه.
   * @param {string} assetId
   * @returns {Promise<{ dependents: Record<string, { rows: number, headHash: string | null }>, rows: Array<{ repository: any, row: Record<string, unknown> }> }>}
   */
  async #attestDependents(assetId) {
    /** @type {Record<string, { rows: number, headHash: string | null }>} */
    const dependents = {};
    /** @type {Array<{ repository: any, row: Record<string, unknown> }>} */
    const doomed = [];
    for (const reference of this.policy.assetDependents) {
      const repository =
        reference.table === 'state.data_lineage'
          ? this.repositories.dataLineage
          : reference.table === 'state.classification_approvals'
            ? this.repositories.classificationApprovals
            : null;
      if (repository === null) {
        throw new RetentionCycleError(
          RETENTION_CYCLE_ERRORS.CONFIG_INVALID,
          `التابع «${reference.table}» معلَنٌ في السياسة ولا مستودعَ له في التركيب؛ تابعٌ لا يُقرأ لا يُشهد عليه ويبقى المحو يفشل على مرجعه.`,
          { table: reference.table },
        );
      }
      const rows = await repository.list({ filter: { assetId } });
      const ordered = [...rows].sort((left, right) => Number(left['seq']) - Number(right['seq']));
      const head = ordered[ordered.length - 1];
      dependents[reference.table] = {
        rows: rows.length,
        headHash: head === undefined ? null : (toText(head['hash']) ?? null),
      };
      for (const row of rows) doomed.push({ repository, row });
    }
    return { dependents, rows: doomed };
  }

  /**
   * يمحو أصلاً واحداً بتوابعه ويكتب شاهده. يُنادى من الدورة ومن المحو الموجَّه
   * معاً: مسارَان يمحوان بمنطقين يفترقان، فأحدهما يبقى بلا شاهد.
   * @param {{ asset: Record<string, unknown>, actorId: string, reason: 'retention' | 'directed' }} input
   * @returns {Promise<Record<string, unknown>>}
   */
  async #eraseAsset({ asset, actorId, reason }) {
    const assetId = String(asset['id']);
    if (asset['legalHold'] === true) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.LEGAL_HOLD,
        `محوُ الأصل «${assetId}» مرفوض: محفوظٌ قانوناً. ورفعُ الحفظ قرارُ صاحب السلطة القانونية لا فعلُ أداةِ الاحتفاظ.`,
        { assetId },
      );
    }
    const holding = await this.#memoriesOf(assetId);
    if (holding.length > 0) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.DEPENDENT_PRESENT,
        `محوُ الأصل «${assetId}» مرفوض: ما زال ${holding.length} مدخل ذاكرةٍ يرجع إليه. الذاكرة تُمحى قبل عقدها، ومرجعُ القاعدة ON DELETE RESTRICT هو الضمان الأخير خلف هذا الرفض.`,
        { assetId, memories: holding.length },
      );
    }
    const attested = await this.#attestDependents(assetId);
    for (const { repository, row } of attested.rows) {
      await repository.remove(String(row['id']), Number(row['version']));
    }
    await this.repositories.dataAssets.remove(assetId, Number(asset['version']));
    return this.erasureLedger.record({
      target: 'data_assets',
      targetId: assetId,
      reason,
      actorId,
      classification: String(asset['classification']),
      owner: String(asset['owner']),
      dependents: attested.dependents,
    });
  }

  /**
   * يمحو مدخل ذاكرةٍ واحداً ويكتب شاهده، ثم **يمحو عقد بياناته** إن أذنت
   * السياسة: عقدٌ يبقى بعد مادّته أصلٌ يتيمٌ في الفهرس — وهو العيب الثالث.
   * @param {{ row: Record<string, unknown>, actorId: string, reason: 'retention' | 'directed' }} input
   * @returns {Promise<{ memory: string, asset: string | null, assetRefusal: { code: string, message: string } | null }>}
   */
  async #eraseMemory({ row, actorId, reason }) {
    const id = String(row['id']);
    if (row['legalHold'] === true) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.LEGAL_HOLD,
        `محوُ المدخل «${id}» مرفوض: محفوظٌ قانوناً.`,
        { id },
      );
    }
    const datasetId = toText(row['datasetId']);
    const asset =
      datasetId === null ? null : await this.repositories.dataAssets.findById(datasetId);
    // تصنيفُ ما مُحي يُقرأ من عقده **قبل** زواله. وبلا عقدٍ يُكتب `unknown`
    // صراحةً: قيمةٌ تُخترع هنا تُقرأ لاحقاً كأنّها مقيسة.
    const classification = asset === null ? 'unknown' : String(asset['classification']);
    await this.repositories.memories.remove(id, Number(row['version']));
    await this.erasureLedger.record({
      target: 'memories',
      targetId: id,
      reason,
      actorId,
      classification,
      owner: String(row['agentId']),
      dependents: {},
    });
    if (asset === null || this.policy.targets.memories['erasesOwningAsset'] !== true) {
      return { memory: id, asset: null, assetRefusal: null };
    }
    try {
      await this.#eraseAsset({ asset, actorId, reason });
      return { memory: id, asset: String(asset['id']), assetRefusal: null };
    } catch (error) {
      // رفضُ محو العقد **لا يُلغي** محو المادّة ولا يُسقط الدورة: المادّة زالت
      // وشاهدُها مكتوب، والعقدُ يبقى برفضٍ مُسمّى يُقرأ في التقرير. وإسقاطُ
      // الدورة هنا كان سيمنع محو كل ما بعده بسبب حفظٍ قانوني على أصلٍ واحد.
      if (!(error instanceof RetentionCycleError)) throw error;
      return {
        memory: id,
        asset: null,
        assetRefusal: { code: error.code, message: error.message },
      };
    }
  }

  /**
   * تخطيطٌ جافّ: يقرأ ولا يمحو. ويحتاج فاعلاً مطهِّراً لأنه يسمّي **معرّفات** ما
   * سيُمحى، ومن لا يجوز له المحو لا يجوز له جردُ ما سيُمحى ومتى.
   * @param {{ actor: { id: string, role: string }, now?: Date }} request
   * @returns {Promise<{ now: Date, targets: Array<{ key: string, table: string, eligible: number, legalHoldProtected: number, blocked: number, ids: string[] }> }>}
   */
  async plan({ actor, now = new Date() }) {
    const at = assertNow(now);
    const sweeper = assertSweeper(actor, this.policy);
    /** @type {Array<{ key: string, table: string, eligible: number, legalHoldProtected: number, blocked: number, ids: string[] }>} */
    const targets = [];
    for (const key of this.policy.cycle.order) {
      if (key === 'memories') {
        const rows = /** @type {Array<Record<string, unknown>>} */ (
          await this.repositories.memories.list({})
        );
        const eligible = rows.filter((row) => this.#memoryExpired(row, at));
        targets.push({
          key,
          table: String(this.policy.targets.memories['table']),
          eligible: eligible.length,
          legalHoldProtected: rows.filter((row) => row['legalHold'] === true).length,
          blocked: 0,
          ids: eligible.map((row) => String(row['id'])),
        });
        continue;
      }
      const rows = /** @type {Array<Record<string, unknown>>} */ (
        await this.repositories.dataAssets.list({})
      );
      const expired = rows.filter((row) => this.#assetExpired(row, at));
      /** @type {string[]} */
      const free = [];
      let blocked = 0;
      for (const row of expired) {
        const holding = await this.#memoriesOf(String(row['id']));
        if (holding.length > 0) blocked += 1;
        else free.push(String(row['id']));
      }
      targets.push({
        key,
        table: String(this.policy.targets.data_assets['table']),
        eligible: free.length,
        legalHoldProtected: rows.filter((row) => row['legalHold'] === true).length,
        blocked,
        ids: free,
      });
    }
    this.log.append('retention.planned', sweeper.id, {
      now: at.toISOString(),
      targets: targets.map((entry) => ({
        key: entry.key,
        eligible: entry.eligible,
        blocked: entry.blocked,
      })),
    });
    return { now: at, targets };
  }

  /**
   * الدورة الكاملة: تمحو ما انتهت مدّته وتشهد على كل محوٍ في الدفتر.
   *
   * والترتيب من السياسة لا من ترتيب المفاتيح: الذاكرة قبل عقدها. والسقفُ
   * `maxErasuresPerRun` يجعل أثر تشغيلةٍ واحدة محدوداً ومراجَعاً.
   * @param {{ actor: { id: string, role: string }, now?: Date, royalCommand?: { id: string, digest: string } }} request
   *   و`royalCommand` مطلوبٌ لأنّ `purge-data` فوقَ العتبةِ السياديّةِ
   *   (‏`R6-A-01`): دورةٌ تمحو بلا أمرٍ تُرفَض برمزِ نقطةِ التفويضِ.
   * @returns {Promise<{ now: Date, erased: Array<{ target: string, id: string }>, refused: Array<{ target: string, id: string, code: string, message: string }>, ledgerSeq: number, capped: boolean }>}
   */
  async run({ actor, now = new Date(), royalCommand }) {
    const at = assertNow(now);
    // التفويضُ **قبلَ** أيِّ قراءةٍ أو حذفٍ (‏`R6-A-01`): جردُ ما سيُمحى بنفسِه
    // إفصاحٌ عن الأصولِ المنتهيةِ، فلا يُسبَقُ به القرارُ.
    const sweeper = await this.#authorizeSweep({
      actor,
      resourceKey: 'data:retention-cycle',
      resourceId: 'retention-cycle',
      context: { reason: 'retention', now: at.toISOString() },
      ...(royalCommand === undefined ? {} : { royalCommand }),
    });
    // بوابةُ التكرار: تشغيلٌ يُعاد بالخطأ بعد دقيقة يُرفض لا يُضاعف. وتُقاس على
    // آخر شاهدٍ في الدفتر لا على متغيّرٍ في الذاكرة الحيّة: متغيّرٌ يُصفَّر بإعادة
    // التشغيل يجعل البوابة تُفتح بأرخص فعل.
    const hours = this.policy.cycle.minHoursBetweenRuns;
    if (hours > 0) {
      const last = await this.erasureLedger.lastRecordedAt();
      if (last !== null && at.getTime() - last.getTime() < hours * 3600000) {
        throw new RetentionCycleError(
          RETENTION_CYCLE_ERRORS.TOO_SOON,
          `آخر محوٍ سُجّل في ${last.toISOString()} والمدّة الدنيا بين دورتين ${hours} ساعة؛ تشغيلٌ يُعاد قبلها يُرفض. والمحو الموجَّه بقرارٍ مسارٌ آخر لا تحجبه هذه البوابة.`,
          { last: last.toISOString(), hours },
        );
      }
    }
    /** @type {Array<{ target: string, id: string }>} */
    const erased = [];
    /** @type {Array<{ target: string, id: string, code: string, message: string }>} */
    const refused = [];
    const cap = this.policy.cycle.maxErasuresPerRun;
    let capped = false;
    for (const key of this.policy.cycle.order) {
      if (erased.length >= cap) {
        capped = true;
        break;
      }
      if (key === 'memories') {
        const rows = await this.repositories.memories.list({});
        for (const row of rows) {
          if (erased.length >= cap) {
            capped = true;
            break;
          }
          if (!this.#memoryExpired(row, at)) continue;
          const result = await this.#eraseMemory({
            row,
            actorId: sweeper.id,
            reason: 'retention',
          });
          erased.push({ target: 'memories', id: result.memory });
          if (result.asset !== null) erased.push({ target: 'data_assets', id: result.asset });
          if (result.assetRefusal !== null) {
            refused.push({
              target: 'data_assets',
              id: String(row['datasetId']),
              ...result.assetRefusal,
            });
          }
        }
        continue;
      }
      const rows = await this.repositories.dataAssets.list({});
      for (const row of rows) {
        if (erased.length >= cap) {
          capped = true;
          break;
        }
        if (!this.#assetExpired(row, at)) continue;
        try {
          await this.#eraseAsset({ asset: row, actorId: sweeper.id, reason: 'retention' });
          erased.push({ target: 'data_assets', id: String(row['id']) });
        } catch (error) {
          if (!(error instanceof RetentionCycleError)) throw error;
          refused.push({
            target: 'data_assets',
            id: String(row['id']),
            code: error.code,
            message: error.message,
          });
        }
      }
    }
    const ledgerSeq = await this.erasureLedger.assertIntact();
    this.log.append('retention.cycle.completed', sweeper.id, {
      now: at.toISOString(),
      erased: erased.length,
      refused: refused.length,
      capped,
      ledgerSeq,
    });
    return { now: at, erased, refused, ledgerSeq, capped };
  }

  /**
   * محوٌ موجَّه بقرار: هدفٌ واحد بمعرّفه، وسببُه `directed` في الدفتر. لا يُنتظر
   * به انتهاء المدّة — والحفظُ القانوني والتوابع الحيّة يبقيان مانعين، فالتوجيه
   * سلطةٌ على **الوقت** لا على القيود.
   * @param {{ actor: { id: string, role: string }, target: 'memories' | 'data_assets', id: string, royalCommand?: { id: string, digest: string } }} request
   * @returns {Promise<{ target: string, id: string, seq: number }>}
   */
  async eraseDirected({ actor, target, id, royalCommand }) {
    if (!RETENTION_TARGETS.includes(target)) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.INPUT_INVALID,
        `هدفُ محوٍ غير معلَن: «${String(target)}». المعلَن: ${RETENTION_TARGETS.join('، ')}.`,
        { target },
      );
    }
    // والمحوُ الموجَّهُ أخطرُ من الدوريِّ: لا يَنتظرُ انتهاءَ مدّةٍ. فيمرُّ بنفسِ
    // نقطةِ التفويضِ على هدفِه بعينِه (‏`R6-A-01`)، ولا يُقرأُ الصفُّ قبلَ القرارِ.
    const sweeper = await this.#authorizeSweep({
      actor,
      resourceKey: `data:${target}:${id}`,
      resourceId: `${target}:${id}`,
      context: { reason: 'directed', target, targetId: id },
      ...(royalCommand === undefined ? {} : { royalCommand }),
    });
    const repository =
      target === 'memories' ? this.repositories.memories : this.repositories.dataAssets;
    const row = await repository.findById(id);
    if (row === null) {
      throw new RetentionCycleError(
        RETENTION_CYCLE_ERRORS.NOT_FOUND,
        `لا صفَّ بالمعرّف «${id}» في «${target}»؛ ولا يُكتب شاهدُ محوٍ لما لم يكن.`,
        { target, id },
      );
    }
    const record =
      target === 'memories'
        ? await this.#eraseMemory({ row, actorId: sweeper.id, reason: 'directed' })
        : await this.#eraseAsset({ asset: row, actorId: sweeper.id, reason: 'directed' });
    const seq = await this.erasureLedger.assertIntact();
    this.log.append('retention.directed', sweeper.id, { target, id, ledgerSeq: seq });
    void record;
    return { target, id, seq };
  }
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function toText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
