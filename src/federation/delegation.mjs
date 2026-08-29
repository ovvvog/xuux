/**
 * التفويضُ الترابيُّ للإقليمِ المعزول — الخطوة `M8.07`.
 *
 * **العيبُ الذي تعالجه هذه الوحدة:** كانت الفدراليةُ في المستودع **عدّاً في
 * شجرة**: `seed/federation.yaml` تُحصي الأقاليمَ والولاياتِ والبلديات،
 * و`src/registry/loader.mjs` يقرؤها ويتحقّق من مساراتها، ولم يكن مجلَّدُ
 * `src/federation` موجوداً أصلاً — لا جدولَ ترابٍ في `state`، ولا صلاحيةً واحدةً
 * مفوَّضةً إلى إقليم، ولا سحبَ تفويضٍ يوقف عملاً. فكانت الفدراليةُ رقماً صحيحاً
 * لا سلطةً تُمارَس ويُسحب سندُها.
 *
 * وهذه الوحدةُ تُنفِذ ما تُعلنه `config/federation-delegation.yaml`:
 *
 *   1. **التفويضُ صفٌّ محفوظ** لا سطرٌ في وثيقة: `activate` تكتب في
 *      `state.federation_delegations` صلاحياتِ المستوى ودورَ ممارسته وأصلَه
 *      الترابيَّ ووقتَ النفاذِ ومَن فعَّله، وقبله لا يُمارَس فعلٌ (‏`NOT_ACTIVATED`).
 *   2. **الإقليمُ يعمل مستقلاً**: `exercise` تُنتج صفَّ فعلٍ ترابيٍّ بدورِ
 *      المستوى المُعلَن **بلا إذنٍ مركزيٍّ لكلِّ فعل**؛ ودورُ التاجِ نفسُه ليس
 *      دورَ ممارسةٍ (‏`ROLE_NOT_PERMITTED`) — فمن يُفوِّض لا يمارس.
 *   3. **العزلُ مقيس**: كلُّ مستوىً يعمل في ترابه وحدَه، والخروجُ إلى ترابِ أخيه
 *      يُمنع (‏`OUT_OF_TERRITORY`)، وترابُ إقليمٍ غيرِ مُفوَّضٍ لا يُعرَف أصلاً
 *      (‏`TERRITORY_UNKNOWN`).
 *   4. **السحبُ نافذٌ فوراً**: `revoke` تكتب وقتَ السحبِ وسببَه في الصفِّ نفسِه،
 *      فأولُ فعلٍ بعده — في اللحظة نفسِها بلا تقديمِ ساعة — يُرفض ويُسجَّل. وسحبُ
 *      تفويضِ الأصلِ يوقف الفرعَ (‏`CHAIN_BROKEN`): سلطةٌ بلا مصدرٍ ليست سلطة.
 *   5. **كلُّ رفضٍ يُسجَّل صفّاً** في `state.federation_refusals` بترابه المطلوبِ
 *      ورمزِه وسببه: مُنِعَ ولم يُسجَّل يعني أنّ العزلَ بلا مادّةٍ تُراجَع.
 *
 * **حدٌّ معلَن أول:** التفعيلُ والسحبُ هنا **بأمرِ حاملِ السلطة مباشرةً**، لا
 * بأمرٍ ملكيٍّ موقَّعٍ عبر بوابة التاج ولا في سجلِّ تفويضاتٍ نافذة: ذاك نصُّ
 * `M8.08` صريحاً. وما هنا أثرُ التفويضِ وسحبِه مقيساً في صفوف.
 *
 * **حدٌّ معلَن ثانٍ:** لا دورَ «والٍ» ولا «عمدةٍ» في `config/roles.yaml`؛
 * فالمستوياتُ تُميَّز بمفتاحِ الترابِ لا بدورٍ خاصٍّ بها، والدورُ الممارسُ دورٌ
 * قائمٌ مُعلَنٌ في الوثيقة. وهو مسجَّلٌ في `docs/REMAINING_WORK.md`.
 *
 * **حدٌّ معلَن ثالث:** الفعلُ الترابيُّ صفٌّ ومخرَجٌ نصّيٌّ في الصفِّ نفسِه — لا
 * منفِّذَ أثرٍ خارجيّاً ولا مخرَجاً في مخزنٍ مستقلٍّ كما في `M8.05`. وميزانيةُ
 * الترابِ وحصصُه ليست هنا: لا سقفَ صرفٍ إقليميّاً ولا مُخصَّصاً ترابيّاً.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);

/** موضعُ الوثيقةِ والبذرةِ افتراضاً — مثلُ ما تفعله وحدةُ المؤسسات. */
export const DEFAULT_FEDERATION_CONFIG_DIR = path.join(process.cwd(), 'config');
export const DEFAULT_FEDERATION_SEED_DIR = path.join(process.cwd(), 'seed');

/**
 * رموزُ الرفض في التفويض الترابي. كلُّ رمزٍ هنا بندُ ضمانٍ في
 * `config/federation-delegation.yaml`، والبوابةُ 23 تحرس التقابل في الاتجاهين.
 */
export const FEDERATION_ERRORS = Object.freeze({
  CONFIG_INVALID: 'FEDERATION_CONFIG_INVALID',
  TERRITORY_UNKNOWN: 'FEDERATION_TERRITORY_UNKNOWN',
  NOT_ACTIVATED: 'FEDERATION_NOT_ACTIVATED',
  ALREADY_ACTIVATED: 'FEDERATION_ALREADY_ACTIVATED',
  ROLE_NOT_PERMITTED: 'FEDERATION_ROLE_NOT_PERMITTED',
  CHAIN_BROKEN: 'FEDERATION_CHAIN_BROKEN',
  DELEGATION_REVOKED: 'FEDERATION_DELEGATION_REVOKED',
  ALREADY_REVOKED: 'FEDERATION_ALREADY_REVOKED',
  REVOCATION_REASON_REQUIRED: 'FEDERATION_REVOCATION_REASON_REQUIRED',
  POWER_NOT_DELEGATED: 'FEDERATION_POWER_NOT_DELEGATED',
  POWER_RESERVED: 'FEDERATION_POWER_RESERVED',
  ACT_UNKNOWN: 'FEDERATION_ACT_UNKNOWN',
  OUT_OF_TERRITORY: 'FEDERATION_OUT_OF_TERRITORY',
  ROYAL_COMMAND_REQUIRED: 'FEDERATION_ROYAL_COMMAND_REQUIRED',
  COMMAND_ACTION_UNKNOWN: 'FEDERATION_COMMAND_ACTION_UNKNOWN',
  COMMAND_TARGET_MISMATCH: 'FEDERATION_COMMAND_TARGET_MISMATCH',
  REVOCATION_DEADLINE_MISSED: 'FEDERATION_REVOCATION_DEADLINE_MISSED',
  REGISTER_DIVERGED: 'FEDERATION_REGISTER_DIVERGED',
});

/** أنواعُ حوادثِ التفويض الترابي. وكلُّ نوعٍ عقدٌ في قناة `federation`. */
// ومواضعُ النشر تكتب النوعَ **نصّاً حرفياً** لا `FEDERATION_EVENTS.X`: حاجزُ
// القنوات يقرأ الوسيطَ الأول من شجرة الإعراب لا من قيمةٍ تُحلّ بالتشغيل، فمرجعٌ
// رمزيٌّ هناك يجعل العقدَ بلا موضعِ نشرٍ في القياس. والتقابلُ تحرسه البوابةُ 23.
export const FEDERATION_EVENTS = Object.freeze({
  ACTIVATED: 'federation.delegation.activated',
  REVOKED: 'federation.delegation.revoked',
  EXERCISED: 'federation.act.exercised',
  REFUSED: 'federation.act.refused',
  REGISTERED: 'federation.delegation.registered',
  OVERDUE: 'federation.revocation.overdue',
});

/** رفضٌ في التفويض الترابي: يحمل رمزَه وتفصيلَه. */
export class FederationError extends Error {
  /**
   * @param {string} code
   * @param {string} detail
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'FederationError';
    /** @type {string} */
    this.code = code;
    /** @type {string} */
    this.detail = detail;
  }
}

/**
 * @typedef {Readonly<{ kind: string, power: string }>} DelegatedAct
 */

/**
 * @typedef {Readonly<{
 *   level: 'region' | 'province' | 'municipality',
 *   key: string,
 *   parent: string,
 *   exercisedBy: string,
 *   powers: readonly string[],
 *   acts: readonly DelegatedAct[],
 *   statement: string,
 * }>} DelegationLevel
 */

/**
 * @typedef {Readonly<{
 *   version: number,
 *   acts: Readonly<{ activate: string, revoke: string }>,
 *   sovereignty: Readonly<{
 *     statement: string,
 *     commands: Readonly<{ activate: string, revoke: string }>,
 *     revocation: Readonly<{ deadlineMs: number, statement: string }>,
 *     register: Readonly<{ statement: string }>,
 *   }>,
 *   procedure: Readonly<{
 *     requireActivatedDelegation: true,
 *     requireDeclaredTerritory: true,
 *     requireDelegatedPower: true,
 *     enforceChainOfDelegation: true,
 *     revocationEffectiveImmediately: true,
 *     recordRefusal: true,
 *     minRefusalReasonLength: number,
 *   }>,
 *   reserved: Readonly<{ powers: readonly string[], statement: string }>,
 *   region: Readonly<{
 *     regionKey: string,
 *     provinceKey: string,
 *     municipalityKey: string,
 *     statement: string,
 *   }>,
 *   levels: readonly DelegationLevel[],
 *   guarantees: readonly Readonly<{
 *     code: string,
 *     statement: string,
 *     enforcedBy: readonly string[],
 *   }>[],
 * }>} DelegationPolicy
 */

/**
 * أمرٌ ملكيٌّ كما تقرؤه هذه الوحدة. والشكلُ من `src/root-of-trust/crown.mjs`،
 * ويُوصَف هنا بنيةً لا يُستورَد صنفاً: الوحدةُ تقيس فعلَ الأمرِ وهدفَه ثم تُسلّمه
 * للبوابة، ولا تتحقّق من توقيعه بنفسها.
 * @typedef {Readonly<{ id: string, action: string, target: string, issuedAt: string, payload: object }>} RoyalCommandLike
 */

/**
 * @typedef {{ command: (command: RoyalCommandLike, signature: string) => unknown }} CrownLike
 */

/**
 * @param {string} detail
 * @returns {never}
 */
function invalidConfig(detail) {
  throw new FederationError(FEDERATION_ERRORS.CONFIG_INVALID, detail);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * هل الترابُ `key` داخلَ ترابِ `ancestor` أو هو نفسُه؟ والقرارُ من المفتاحِ
 * وحدَه: مفاتيحُ البذرةِ متداخلةٌ بالبناء (`P001-01-001` داخلَ `P001-01`)،
 * ومفتاحُ الإقليمِ `R001` يقابل `P001-…` بالرقم لا بالحرف.
 * @param {string} ancestor
 * @param {string} key
 * @returns {boolean}
 */
export function withinTerritory(ancestor, key) {
  if (ancestor === '' || key === '') return false;
  if (ancestor === key) return true;
  if (/^R[0-9]{3}$/.test(ancestor)) {
    return key.startsWith(`P${ancestor.slice(1)}-`);
  }
  return key.startsWith(`${ancestor}-`);
}

/**
 * بذرةُ الفدرالية مقروءةً من الملفِّ الذي يقرؤه `src/registry/loader.mjs` نفسُه،
 * فلا تُنسَخ الشجرةُ هنا ولا تتخلّف عن مصدرها.
 * @param {string} seedDir
 * @returns {{ regions: Set<string>, provinces: Map<string, string>, municipalities: Set<string> }}
 */
function seedTerritories(seedDir) {
  const file = path.join(seedDir, 'federation.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      `بذرةُ الفدرالية غائبةٌ في ${file}؛ وترابٌ بلا سندٍ في شجرة الدولة ترابٌ مُختلَق لا يُفوَّض.`,
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة بذرة الفدرالية: ${errorText(error)}`);
  }
  /** @type {Set<string>} */
  const regions = new Set();
  /** @type {Map<string, string>} */
  const provinces = new Map();
  /** @type {Set<string>} */
  const municipalities = new Set();
  const list = /** @type {{ regions?: unknown }} */ (raw)?.regions;
  if (!Array.isArray(list)) return { regions, provinces, municipalities };
  for (const entry of list) {
    const region = /** @type {Record<string, unknown>} */ (entry);
    const regionId = region['id'];
    if (typeof regionId !== 'string') continue;
    regions.add(regionId);
    const inner = region['provinces'];
    if (!Array.isArray(inner)) continue;
    for (const item of inner) {
      const province = /** @type {Record<string, unknown>} */ (item);
      const provinceId = province['id'];
      if (typeof provinceId !== 'string') continue;
      provinces.set(provinceId, regionId);
      const ids = province['municipality_ids'];
      if (!Array.isArray(ids)) continue;
      for (const number of ids) {
        if (typeof number === 'string') municipalities.add(`${provinceId}-${number}`);
      }
    }
  }
  return { regions, provinces, municipalities };
}

/**
 * يقرأ وثيقةَ التفويض الترابي ويتحقّق منها مخطَّطاً وتماسكاً **وسنداً في بذرة
 * الفدرالية**: ترابٌ لا وجودَ له في الشجرةِ ترابٌ مُختلَق، وصلاحيةُ فرعٍ ليست من
 * صلاحياتِ أصله تفويضٌ لما لا يُملَك.
 * @param {{ dir?: string, seedDir?: string }} [options]
 * @returns {DelegationPolicy}
 */
export function loadDelegationPolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_FEDERATION_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_FEDERATION_CONFIG_DIR;
  const file = path.join(dir, 'federation-delegation.yaml');
  if (!fs.existsSync(file)) {
    invalidConfig(
      'وثيقةُ التفويض الترابي غائبة؛ وإقليمٌ يعمل بلا تفويضٍ معلَنٍ يعمل بسلطةِ من يستدعيه.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidConfig(`تعذّرت قراءة federation-delegation.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'federation-delegation.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidConfig(
      'مخطَّطُ وثيقةِ التفويض غائب؛ وبلا مخطَّطٍ يصير الاختصاصُ الترابيُّ نصّاً حرّاً كالذي جاء ليمنعه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim())
      .join(' · ');
    invalidConfig(`federation-delegation.yaml يخالف مخطَّطه: ${problems}`);
  }
  const parsed = /** @type {DelegationPolicy} */ (raw);

  // ── فحوصُ تماسكٍ لا يُعبِّر عنها مخطَّط ──

  /** @type {Map<string, DelegationLevel>} */
  const byLevel = new Map();
  for (const level of parsed.levels) {
    if (byLevel.has(level.level)) {
      invalidConfig(
        `المستوى ${level.level} مُعلَنٌ مرّتين؛ ولا مستويان في مرتبةٍ واحدةٍ لإقليمٍ واحد.`,
      );
    }
    byLevel.set(level.level, level);
  }
  for (const name of ['region', 'province', 'municipality']) {
    if (!byLevel.has(name)) {
      invalidConfig(
        `المستوى ${name} غيرُ مُعلَن؛ والإقليمُ المعزولُ إقليمٌ بولايةٍ وبلديةٍ لا أقلّ.`,
      );
    }
  }
  const region = /** @type {DelegationLevel} */ (byLevel.get('region'));
  const province = /** @type {DelegationLevel} */ (byLevel.get('province'));
  const municipality = /** @type {DelegationLevel} */ (byLevel.get('municipality'));

  if (
    region.key !== parsed.region.regionKey ||
    province.key !== parsed.region.provinceKey ||
    municipality.key !== parsed.region.municipalityKey
  ) {
    invalidConfig(
      'مفاتيحُ المستوياتِ لا تطابق الإقليمَ المُعلَن؛ ووثيقةٌ تُعلن ترابين تُقرأ بأيِّهما شاء قارئها.',
    );
  }
  if (region.parent !== '') {
    invalidConfig('الإقليمُ أعلى مستوىً مفوَّض، فلا أصلَ ترابيَّ له؛ وفوقَه المركزُ لا ترابٌ آخر.');
  }
  if (province.parent !== region.key || municipality.parent !== province.key) {
    invalidConfig(
      'سلسلةُ الأصولِ مقطوعة: الولايةُ فرعُ الإقليمِ والبلديةُ فرعُ الولاية؛ وسلسلةٌ مقطوعةٌ تُبقي الفرعَ عاملاً بعد سحبِ أصله.',
    );
  }
  if (
    !withinTerritory(region.key, province.key) ||
    !withinTerritory(province.key, municipality.key)
  ) {
    invalidConfig(
      'الولايةُ أو البلديةُ ليست من ترابِ أصلها بحسب مفتاحها؛ وتفويضٌ عبرَ حدٍّ ترابيٍّ ليس تفويضاً في الترابِ نفسه.',
    );
  }

  // الصلاحياتُ متداخلةٌ نزولاً: لا يُفوَّض ما لا يُملَك.
  /** @type {Array<[DelegationLevel, DelegationLevel]>} */
  const descents = [
    [province, region],
    [municipality, province],
  ];
  for (const [child, parent] of descents) {
    for (const power of child.powers) {
      if (!parent.powers.includes(power)) {
        invalidConfig(
          `الصلاحية ${power} مفوَّضةٌ إلى ${child.key} وليست من صلاحياتِ أصله ${parent.key}؛ ولا يُفوَّض ما لا يُملَك.`,
        );
      }
    }
  }

  // الصلاحياتُ المحفوظةُ لا تُفوَّض ولو أُعلنت — والرفضُ عند التحميل لا عند أول فعل.
  for (const level of parsed.levels) {
    for (const power of level.powers) {
      if (parsed.reserved.powers.includes(power)) {
        invalidConfig(
          `${FEDERATION_ERRORS.POWER_RESERVED}: الصلاحية ${power} محفوظةٌ للمركزِ ولا تُفوَّض إلى ${level.key}.`,
        );
      }
    }
  }

  /** @type {Set<string>} */
  const kinds = new Set();
  for (const level of parsed.levels) {
    if (level.exercisedBy === parsed.acts.activate || level.exercisedBy === parsed.acts.revoke) {
      invalidConfig(
        `دورُ ممارسةِ ${level.key} هو نفسُه دورُ التفويضِ أو سحبِه؛ ومن يُفوِّض لا يمارس الفعلَ اليوميَّ في الترابِ ومن يمارسه لا يسحب تفويضَ نفسه.`,
      );
    }
    for (const act of level.acts) {
      if (!level.powers.includes(act.power)) {
        invalidConfig(
          `النوع ${act.kind} يقتضي الصلاحية ${act.power} وهي غيرُ مفوَّضةٍ إلى ${level.key}؛ ونوعٌ بلا صلاحيةٍ مفوَّضةٍ فعلٌ بلا سند.`,
        );
      }
      if (kinds.has(act.kind)) {
        invalidConfig(
          `النوع ${act.kind} مُعلَنٌ لأكثرِ من مستوى؛ ونوعٌ في مستويين لا يُعرَف أيُّ ترابٍ يمارسه.`,
        );
      }
      kinds.add(act.kind);
    }
  }

  // فعلا الأمرِ الملكيِّ متمايزان: اسمٌ واحدٌ للفعلين يجعل أمرَ المنحِ صالحاً
  // للسحبِ وبالعكس، فيصير التمييزُ بنيّةِ المستدعي لا بنصِّ الأمر.
  if (parsed.sovereignty.commands.activate === parsed.sovereignty.commands.revoke) {
    invalidConfig(
      'فعلُ أمرِ التفويضِ وفعلُ أمرِ سحبه اسمٌ واحد؛ وأمرٌ يصلح للمنحِ والسحبِ معاً أمرٌ لا يُقرأ منه ما أمر به التاج.',
    );
  }

  // ── السندُ في بذرة الفدرالية ──
  const seeded = seedTerritories(options.seedDir ?? DEFAULT_FEDERATION_SEED_DIR);
  if (!seeded.regions.has(region.key)) {
    invalidConfig(
      `الإقليم ${region.key} لا وجودَ له في بذرة الفدرالية؛ وترابٌ بلا سندٍ في شجرة الدولة لا يُفوَّض.`,
    );
  }
  const seededRegion = seeded.provinces.get(province.key);
  if (seededRegion === undefined) {
    invalidConfig(
      `الولاية ${province.key} لا وجودَ لها في بذرة الفدرالية؛ ولا تُفوَّض ولايةٌ مُختلَقة.`,
    );
  }
  if (seededRegion !== region.key) {
    invalidConfig(
      `الولاية ${province.key} من الإقليم ${seededRegion} لا من ${region.key}؛ وتفويضٌ يعبر حدَّ إقليمين يُبطل العزل.`,
    );
  }
  if (!seeded.municipalities.has(municipality.key)) {
    invalidConfig(
      `البلدية ${municipality.key} ليست في قائمةِ بلديات ولايتها في البذرة؛ وترابٌ لا تعرفه الشجرةُ لا تُمارَس فيه سلطة.`,
    );
  }

  return parsed;
}

/**
 * مستوى ترابٍ بمفتاحه، أو رفضٌ إن لم يكن مُعلَناً في الوثيقة.
 * @param {DelegationPolicy} policy
 * @param {string} territoryKey
 * @returns {DelegationLevel}
 */
export function levelFor(policy, territoryKey) {
  const found = policy.levels.find((entry) => entry.key === territoryKey);
  if (found === undefined) {
    throw new FederationError(
      FEDERATION_ERRORS.TERRITORY_UNKNOWN,
      `الترابُ ${territoryKey} غيرُ مفوَّضٍ في config/federation-delegation.yaml؛ وإقليمٌ واحدٌ هو المفوَّضُ وما عداه بلا سلطةٍ مفوَّضة.`,
    );
  }
  return found;
}

/**
 * سلسلةُ أصولِ الترابِ من الأدنى إلى الأعلى، مقروءةً من الوثيقة لا مُستنبَطةً من
 * شكلِ المفتاح.
 * @param {DelegationPolicy} policy
 * @param {string} territoryKey
 * @returns {readonly DelegationLevel[]}
 */
export function ancestorsOf(policy, territoryKey) {
  /** @type {DelegationLevel[]} */
  const chain = [];
  let current = levelFor(policy, territoryKey);
  while (current.parent !== '') {
    const parent = levelFor(policy, current.parent);
    chain.push(parent);
    current = parent;
  }
  return Object.freeze(chain);
}

/**
 * @param {import('../persistence/entities.mjs').EntityRecord} record
 * @param {string} key
 * @returns {string}
 */
function readText(record, key) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/**
 * التفويضُ الترابيُّ نافذاً: يُفعَّل ويُسحب ويُمارَس، وكلُّ رفضٍ يُسجَّل صفّاً.
 */
export class RegionalDelegation {
  /**
   * @param {object} deps
   * @param {DelegationPolicy} deps.policy وثيقةُ التفويض المُحمَّلة.
   * @param {import('../root-of-trust/event-log.mjs').EventLog} deps.log
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.delegations
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.acts
   * @param {import('../persistence/repository-memory.mjs').Repository} deps.refusals
   * @param {import('./sovereignty.mjs').DelegationRegister} deps.register سجلُّ التفويضاتِ النافذة.
   * @param {CrownLike | null} [deps.crown] بوابةُ التاج؛ وبلاها لا تفعيلَ ولا سحب.
   * @param {() => Date} [deps.now]
   */
  constructor({ policy, log, delegations, acts, refusals, register, crown = null, now }) {
    if (!policy) throw new Error('FEDERATION_POLICY_REQUIRED');
    if (!log) throw new Error('FEDERATION_EVENT_LOG_REQUIRED');
    // مستودعُ الرفوضِ لازمٌ لا اختياري: بلا صفٍّ يُكتب فيه الرفضُ يصير «يُمنع
    // ويُسجَّل» نصفَ شرطٍ، والعزلُ بلا سجلٍّ عزلٌ لا يُراجَع.
    if (!delegations || !acts || !refusals) throw new Error('FEDERATION_REPOSITORY_REQUIRED');
    // وسجلُّ التفويضاتِ النافذةِ لازمٌ كذلك (`M8.08`): أثرُ الأمرِ الملكيِّ يُكتب
    // فيه، وبلاه يصير التفويضُ حالةً حاضرةً لا سلسلةَ أوامرَ تُراجَع.
    if (!register) throw new Error('FEDERATION_REGISTER_REQUIRED');
    this.policy = policy;
    this.log = log;
    this.delegations = delegations;
    this.acts = acts;
    this.refusals = refusals;
    this.register = register;
    this.crown = crown;
    this.now = now ?? (() => new Date());
  }

  /**
   * يُمرِّر أمرَ التفويضِ أو سحبِه ببوابة التاج، ويرفض ما ليس أمراً ملكيّاً على
   * فعلِه وهدفِه.
   *
   * والترتيبُ مقصود: الفعلُ والهدفُ يُقاسان **قبل** البوابة كي لا يُحرَق معرّفُ
   * أمرٍ على نداءٍ في غير موضعه؛ ثم البوابةُ وحدَها تُثبت التوقيعَ وتمنع الإعادةَ
   * وتُسقط الأمرَ القديمَ وتردّه في دولةٍ موقوفة. فبلا بوابةٍ لا سيادةَ أصلاً:
   * مقارنةُ اسمِ دورٍ بالنصِّ سلطةٌ مُدَّعاةٌ لا سلطةٌ مُفوَّضة.
   * @param {'activate' | 'revoke'} act
   * @param {string} territoryKey
   * @param {RoyalCommandLike | undefined} command
   * @param {string | undefined} signature
   * @returns {{ issuedAt: Date, acceptedAt: Date, commandId: string, action: string }}
   */
  #royal(act, territoryKey, command, signature) {
    if (this.crown === null) {
      throw new FederationError(
        FEDERATION_ERRORS.ROYAL_COMMAND_REQUIRED,
        `لا بوابةَ تاجٍ مركَّبةٌ في التفويض الترابي؛ و${act} بلا بوابةٍ فعلٌ يقع بمقارنةِ اسمِ دورٍ بالنصِّ لا بأمرٍ موقَّع.`,
      );
    }
    if (command === undefined || command === null || typeof signature !== 'string') {
      throw new FederationError(
        FEDERATION_ERRORS.ROYAL_COMMAND_REQUIRED,
        `${act} على ${territoryKey} يقتضي أمراً ملكيّاً موقَّعاً؛ ونداءٌ بلا أمرٍ نداءٌ بلا سلطة.`,
      );
    }
    const expected = this.policy.sovereignty.commands[act];
    if (command.action !== expected) {
      throw new FederationError(
        FEDERATION_ERRORS.COMMAND_ACTION_UNKNOWN,
        `فعلُ الأمر ${String(command.action)} ليس فعلَ ${act} المُعلَن (${expected})؛ وأمرٌ يُقبل على غير فعلِه أمرٌ يُنقل بتوقيعٍ صحيح.`,
      );
    }
    if (command.target !== territoryKey) {
      throw new FederationError(
        FEDERATION_ERRORS.COMMAND_TARGET_MISMATCH,
        `هدفُ الأمر ${String(command.target)} ليس الترابَ ${territoryKey}؛ وأثرٌ يقع في ترابٍ لم يأمر به أمرٌ لم يُصدَر.`,
      );
    }
    const accepted = /** @type {{ acceptedAt?: unknown }} */ (
      this.crown.command(command, signature)
    );
    const issuedAt = new Date(String(command.issuedAt));
    const acceptedAt =
      accepted && typeof accepted.acceptedAt === 'string'
        ? new Date(accepted.acceptedAt)
        : this.now();
    return {
      issuedAt,
      acceptedAt,
      commandId: String(command.id),
      action: String(command.action),
    };
  }

  /**
   * التفويضاتُ النافذةُ الآن مقروءةً من سجلِّ التفويضاتِ النافذةِ **بعد** مقابلتها
   * بالصفوف؛ وتباعدُ الاثنين يُردّ ولا يُقرأ أحدُهما وحدَه.
   * @returns {Promise<ReadonlyMap<string, import('../persistence/entities.mjs').EntityRecord>>}
   */
  async effective() {
    return this.register.assertConsistent(this.delegations);
  }

  /**
   * يتحقّق أنّ الدورَ حاملُ فعلِ التفويض في الوثيقة.
   * @param {'activate' | 'revoke'} act
   * @param {string} role
   * @returns {void}
   */
  #permit(act, role) {
    const holder = this.policy.acts[act];
    if (holder !== role) {
      throw new FederationError(
        FEDERATION_ERRORS.ROLE_NOT_PERMITTED,
        `الدور ${role} لا يملك الفعل ${act}؛ وحاملُه المُعلَن ${holder}.`,
      );
    }
  }

  /**
   * صفُّ تفويضِ ترابٍ إن وُجد.
   * @param {string} territoryKey
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord | undefined>}
   */
  async #row(territoryKey) {
    const [row] = await this.delegations.list({ filter: { territoryKey }, limit: 1 });
    return row;
  }

  /**
   * يُفعِّل تفويضَ ترابٍ: صلاحياتُه ودورُ ممارستها وأصلُه الترابيُّ تُكتب صفّاً
   * واحداً مقروءاً، فلا تبقى سلطتُه نصّاً في وثيقة.
   *
   * ولا يقع الفعلُ إلا بأمرٍ ملكيٍّ موقَّعٍ مقبولٍ في بوابة التاج (`M8.08`)، ويُكتب
   * أثرُ الأمرِ صفّاً في سجلِّ التفويضاتِ النافذة.
   * @param {{ territoryKey: string, actorRole: string, command?: RoyalCommandLike, signature?: string }} input
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async activate({ territoryKey, actorRole, command, signature }) {
    this.#permit('activate', actorRole);
    const level = levelFor(this.policy, territoryKey);
    const existing = await this.#row(territoryKey);
    if (existing !== undefined && existing['revokedAt'] === null) {
      throw new FederationError(
        FEDERATION_ERRORS.ALREADY_ACTIVATED,
        `تفويضُ ${territoryKey} نافذٌ فعلاً؛ وتفعيلٌ ثانٍ يُنشئ سلطتين في ترابٍ واحدٍ لا يُعرَف أيُّهما النافذة.`,
      );
    }
    if (existing !== undefined) {
      throw new FederationError(
        FEDERATION_ERRORS.DELEGATION_REVOKED,
        `تفويضُ ${territoryKey} مسحوبٌ في ${readText(existing, 'revokedAt') || 'وقتٍ مسجَّل'}؛ وإعادةُ التفويضِ بعد سحبه أمرٌ سياديٌّ موضعُه M8.08 لا تفعيلٌ ثانٍ يمحو لحظةَ السحب.`,
      );
    }
    // وأصلُ الترابِ يجب أن يكون **مفوَّضاً نافذاً** قبل فرعه: تفويضٌ لفرعٍ بلا
    // أصلٍ نافذٍ سلطةٌ بلا مصدرٍ يُقرأ منه سحبُها، ويصير الصفُّ قائماً في القاعدة
    // بينما كلُّ فعلٍ به مرفوضٌ بانكسارِ السلسلة — حالٌ تُقرأ تفويضاً وهي معطَّلة.
    for (const ancestor of ancestorsOf(this.policy, territoryKey)) {
      const row = await this.#row(ancestor.key);
      if (row === undefined) {
        throw new FederationError(
          FEDERATION_ERRORS.CHAIN_BROKEN,
          `أصلُ ${territoryKey} الترابيُّ ${ancestor.key} لم يُفوَّض بعد؛ ولا يُفوَّض فرعٌ قبل أصله.`,
        );
      }
      if (row['revokedAt'] !== null) {
        throw new FederationError(
          FEDERATION_ERRORS.CHAIN_BROKEN,
          `أصلُ ${territoryKey} الترابيُّ ${ancestor.key} تفويضُه مسحوب؛ ولا يُفوَّض فرعٌ من أصلٍ لا سلطةَ له.`,
        );
      }
    }
    // البوابةُ **آخرَ** الشروطِ المقروءةِ من الحالة: أمرٌ يُقبل ثم يُردّ لانكسارِ
    // سلسلةٍ أمرٌ أُحرِق معرّفُه بلا أثر، فلا يُعاد استعمالُه ولو كان الردُّ صحيحاً.
    const royal = this.#royal('activate', territoryKey, command, signature);
    const at = this.now();
    const record = await this.delegations.insert({
      id: `delegation:${territoryKey}`,
      territoryKey,
      level: level.level,
      parentKey: level.parent === '' ? null : level.parent,
      exercisedBy: level.exercisedBy,
      powers: [...level.powers],
      kinds: level.acts.map((entry) => entry.kind),
      modelVersion: this.policy.version,
      activatedAt: at,
      activatedBy: actorRole,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
    });
    await this.register.record({
      commandId: royal.commandId,
      action: royal.action,
      effect: 'GRANT',
      territoryKey,
      level: level.level,
      actorRole,
      issuedAt: royal.issuedAt,
      acceptedAt: royal.acceptedAt,
      effectiveAt: this.now(),
      deadlineMs: null,
      reason: null,
    });
    this.log.append('federation.delegation.activated', 'role:king', {
      territoryKey,
      level: level.level,
      parentKey: level.parent,
      exercisedBy: level.exercisedBy,
      powers: [...level.powers].join(','),
    });
    return record;
  }

  /**
   * يسحب تفويضَ ترابٍ. والنفاذُ **في اللحظة نفسِها**: وقتُ السحبِ يُكتب في الصفِّ
   * فأولُ فعلٍ بعده يُرفض بلا تقديمِ ساعةٍ ولا نافذةِ سماح.
   *
   * وهو أمرٌ ملكيٌّ بمهلةٍ مُعلَنةٍ ومقيسة (`M8.08`): أمرٌ بلغ عمرُه المهلةَ قبل
   * تطبيقه يُردّ ويُسجَّل صفّاً ولا يُطبَّق بأثرٍ متأخِّرٍ يُدَّعى أنه وقع في المهلة،
   * وسحبٌ طُبِّق ثم تجاوز قياسُه المهلةَ يُكتب متجاوِزاً وتُنشر له حادثة.
   * @param {{ territoryKey: string, actorRole: string, reason: string, command?: RoyalCommandLike, signature?: string }} input
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async revoke({ territoryKey, actorRole, reason, command, signature }) {
    this.#permit('revoke', actorRole);
    const level = levelFor(this.policy, territoryKey);
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (text.length < this.policy.procedure.minRefusalReasonLength) {
      throw new FederationError(
        FEDERATION_ERRORS.REVOCATION_REASON_REQUIRED,
        `سببُ سحبِ تفويضِ ${territoryKey} أقصرُ من الحدِّ المُعلَن (${this.policy.procedure.minRefusalReasonLength} حرفاً)؛ وسحبٌ بلا سببٍ مكتوبٍ قرارٌ لا يُراجَع.`,
      );
    }
    const row = await this.#row(territoryKey);
    if (row === undefined) {
      throw new FederationError(
        FEDERATION_ERRORS.NOT_ACTIVATED,
        `تفويضُ ${territoryKey} لم يُفعَّل بعد؛ ولا يُسحب ما لم يُمنح.`,
      );
    }
    if (row['revokedAt'] !== null) {
      throw new FederationError(
        FEDERATION_ERRORS.ALREADY_REVOKED,
        `تفويضُ ${territoryKey} مسحوبٌ سلفاً؛ وسحبٌ ثانٍ يمحو لحظةَ السحبِ الأولى وهي مادّةُ المراجعة.`,
      );
    }
    const royal = this.#royal('revoke', territoryKey, command, signature);
    const deadlineMs = this.policy.sovereignty.revocation.deadlineMs;
    const at = this.now();
    const age = at.getTime() - royal.issuedAt.getTime();
    if (age > deadlineMs) {
      // الردُّ قبل التطبيق: أمرٌ انقضت مهلتُه لا يُطبَّق ثم يُوصَف بأنه نفذ في
      // مهلته. والصفُّ يبقى شاهداً على التأخُّر، والتاجُ يُصدر أمراً جديداً.
      return this.#refuse({
        code: FEDERATION_ERRORS.REVOCATION_DEADLINE_MISSED,
        detail: `أمرُ سحبِ تفويضِ ${territoryKey} بلغ عمرُه ${age}ms وهو فوق المهلةِ المُعلَنة (${deadlineMs}ms)؛ فلم يُطبَّق، ويُصدر التاجُ أمراً جديداً يُقاس نفاذُه من إصداره.`,
        territoryKey,
        requestedTerritoryKey: territoryKey,
        level: level.level,
        actorRole,
      });
    }
    const updated = await this.delegations.update(String(row['id']), Number(row['version'] ?? 1), {
      revokedAt: at,
      revokedBy: actorRole,
      revocationReason: text,
    });
    // زمنُ النفاذِ يُقرأ **بعد** كتابةِ الصفِّ لا قبلها: قياسٌ يُؤخَذ قبل الكتابةِ
    // يقيس عزمَ السحبِ لا نفاذَه، وكتابةٌ بطيئةٌ تجعل السحبَ متجاوِزاً فيُعلَن.
    await this.register.record({
      commandId: royal.commandId,
      action: royal.action,
      effect: 'REVOKE',
      territoryKey,
      level: level.level,
      actorRole,
      issuedAt: royal.issuedAt,
      acceptedAt: royal.acceptedAt,
      effectiveAt: this.now(),
      deadlineMs,
      reason: text,
    });
    this.log.append('federation.delegation.revoked', 'role:king', {
      territoryKey,
      level: readText(row, 'level'),
      revokedBy: actorRole,
      reason: text,
    });
    return updated;
  }

  /**
   * يُسجِّل الرفضَ صفّاً بترابه المطلوبِ ورمزِه وسببه، ثم يرفض.
   *
   * والتسجيلُ **قبل** الرفض: رفضٌ يُرمى بلا صفٍّ محفوظٍ يجعل العزلَ بلا مادّةٍ
   * تُراجَع، ويجعل الترابَ المتجاوِزَ لا يُقرأ في أيِّ جدول.
   * @param {{
   *   code: string,
   *   detail: string,
   *   territoryKey: string,
   *   requestedTerritoryKey: string,
   *   level?: string,
   *   kind?: string,
   *   power?: string,
   *   actorRole?: string,
   * }} input
   * @returns {Promise<never>}
   */
  async #refuse({
    code,
    detail,
    territoryKey,
    requestedTerritoryKey,
    level = '',
    kind = '',
    power = '',
    actorRole = '',
  }) {
    const at = this.now();
    await this.refusals.insert({
      id: `refusal:${requestedTerritoryKey}:${at.getTime()}:${code}`,
      territoryKey: territoryKey === '' ? null : territoryKey,
      requestedTerritoryKey,
      level: level === '' ? null : level,
      kind: kind === '' ? null : kind,
      power: power === '' ? null : power,
      code,
      reason: detail,
      actorRole: actorRole === '' ? null : actorRole,
      refusedAt: at,
    });
    this.log.append('federation.act.refused', 'role:auditor', {
      requestedTerritoryKey,
      code,
      territoryKey,
      level,
      kind,
      power,
    });
    throw new FederationError(code, detail);
  }

  /**
   * يُمارِس فعلاً ترابيّاً في ترابٍ مفوَّض — أو **يمنعه ويُسجِّله**.
   *
   * وهذا هو معيارُ قبولِ الخطوة بشقّيه: الإقليمُ يعمل مستقلاً — فالفعلُ يُنتج
   * صفّاً بدورِ مستواه بلا إذنٍ مركزيٍّ لكلِّ فعل — وسحبُ التفويضِ يوقفه فوراً،
   * سحبَ تفويضِه أو سحبَ تفويضِ أصله. والمنعُ يقع **قبل أن يُفتح للفعل صفّ**.
   * @param {{
   *   id: string,
   *   territoryKey: string,
   *   kind: string,
   *   subject: string,
   *   actorRole: string,
   *   actingKey?: string,
   * }} input
   * @returns {Promise<import('../persistence/entities.mjs').EntityRecord>}
   */
  async exercise({ id, territoryKey, kind, subject, actorRole, actingKey }) {
    const declared = typeof territoryKey === 'string' ? territoryKey.trim() : '';
    const acting = actingKey === undefined || actingKey === '' ? declared : actingKey;
    if (declared === '') {
      throw new FederationError(
        FEDERATION_ERRORS.TERRITORY_UNKNOWN,
        'الفعلُ رُفع بلا ترابٍ معلَن؛ وترابٌ غيرُ معلَنٍ لا يُقاس تجاوزُه لأنّ المتجاوِزَ لا يُعلن.',
      );
    }
    // الترابُ الممارسُ أولاً. ومفتاحٌ غيرُ مُعلَنٍ في الوثيقةِ لا مستوى له، فيُسجَّل
    // رفضُه **بلا مستوى** ولا يُنسَب إلى مرتبةٍ لا وجودَ لها: وهذا هو أثرُ العزلِ
    // على الأقاليمِ الخمسةَ عشرَ الباقيةِ في البذرة — كلُّ فعلٍ لها يُرفض ويُسجَّل.
    /** @type {DelegationLevel} */
    let level;
    try {
      level = levelFor(this.policy, acting);
    } catch (error) {
      if (error instanceof FederationError && error.code === FEDERATION_ERRORS.TERRITORY_UNKNOWN) {
        return this.#refuse({
          code: FEDERATION_ERRORS.TERRITORY_UNKNOWN,
          detail: error.detail,
          territoryKey: '',
          requestedTerritoryKey: acting === declared ? declared : acting,
          kind,
          actorRole,
        });
      }
      throw error;
    }
    if (!withinTerritory(acting, declared)) {
      return this.#refuse({
        code: FEDERATION_ERRORS.OUT_OF_TERRITORY,
        detail: `المستوى ${acting} لا يعمل في الترابِ ${declared}؛ فالعملُ في ترابه وحدَه وفي فروعه، لا في ترابِ أخيه ولا في إقليمٍ غيرِ مُفوَّض.`,
        territoryKey: acting,
        requestedTerritoryKey: declared,
        level: level.level,
        kind,
        actorRole,
      });
    }
    const row = await this.#row(acting);
    if (row === undefined) {
      return this.#refuse({
        code: FEDERATION_ERRORS.NOT_ACTIVATED,
        detail: `تفويضُ ${acting} لم يُفعَّل بعد؛ ولا يُمارَس فعلٌ ترابيٌّ قبل أن يكون للتفويضِ صفٌّ محفوظ.`,
        territoryKey: acting,
        requestedTerritoryKey: declared,
        level: level.level,
        kind,
        actorRole,
      });
    }
    if (row['revokedAt'] !== null) {
      return this.#refuse({
        code: FEDERATION_ERRORS.DELEGATION_REVOKED,
        detail: `تفويضُ ${acting} مسحوبٌ، والسحبُ نافذٌ في اللحظة نفسِها؛ فلا فعلَ بعده ولو كان مبدوءاً قبله.`,
        territoryKey: acting,
        requestedTerritoryKey: declared,
        level: level.level,
        kind,
        actorRole,
      });
    }
    // سلسلةُ التفويضِ لا تنكسر: أصلٌ غيرُ مفوَّضٍ أو مسحوبُ التفويضِ يوقف فرعَه.
    for (const ancestor of ancestorsOf(this.policy, acting)) {
      const parentRow = await this.#row(ancestor.key);
      if (parentRow === undefined || parentRow['revokedAt'] !== null) {
        return this.#refuse({
          code: FEDERATION_ERRORS.CHAIN_BROKEN,
          detail: `تفويضُ الأصل ${ancestor.key} ${parentRow === undefined ? 'لم يُفعَّل' : 'مسحوب'}، فلا سلطةَ لفرعه ${acting}؛ وسلطةٌ بلا مصدرٍ ليست سلطة.`,
          territoryKey: acting,
          requestedTerritoryKey: declared,
          level: level.level,
          kind,
          actorRole,
        });
      }
    }
    if (actorRole !== level.exercisedBy) {
      return this.#refuse({
        code: FEDERATION_ERRORS.ROLE_NOT_PERMITTED,
        detail: `الدور ${actorRole} لا يمارس فعلَ ${acting}؛ ودورُه المُعلَن ${level.exercisedBy}، ومن يُفوِّض لا يمارس الفعلَ اليوميَّ في الترابِ.`,
        territoryKey: acting,
        requestedTerritoryKey: declared,
        level: level.level,
        kind,
        actorRole,
      });
    }
    const act = level.acts.find((entry) => entry.kind === kind);
    if (act === undefined) {
      return this.#refuse({
        code: FEDERATION_ERRORS.ACT_UNKNOWN,
        detail: `النوع ${kind} غيرُ مُعلَنٍ للمستوى ${acting}؛ وأنواعُه المُعلَنة: ${level.acts.map((entry) => entry.kind).join('، ')}.`,
        territoryKey: acting,
        requestedTerritoryKey: declared,
        level: level.level,
        kind,
        actorRole,
      });
    }
    if (this.policy.reserved.powers.includes(act.power)) {
      return this.#refuse({
        code: FEDERATION_ERRORS.POWER_RESERVED,
        detail: `الصلاحية ${act.power} محفوظةٌ للمركزِ ولا تُمارَس في ترابٍ مفوَّض.`,
        territoryKey: acting,
        requestedTerritoryKey: declared,
        level: level.level,
        kind,
        power: act.power,
        actorRole,
      });
    }
    /** @type {unknown} */
    const granted = row['powers'];
    if (!Array.isArray(granted) || !granted.includes(act.power)) {
      return this.#refuse({
        code: FEDERATION_ERRORS.POWER_NOT_DELEGATED,
        detail: `الصلاحية ${act.power} غيرُ مفوَّضةٍ في صفِّ تفويضِ ${acting}؛ وصلاحيةٌ غيرُ مفوَّضةٍ لا تُستعار من مستوىً آخرَ ولا تُشتقّ من قرابةِ الترابين.`,
        territoryKey: acting,
        requestedTerritoryKey: declared,
        level: level.level,
        kind,
        power: act.power,
        actorRole,
      });
    }
    const record = await this.acts.insert({
      id,
      territoryKey: declared,
      actingKey: acting,
      level: level.level,
      kind,
      power: act.power,
      subject: typeof subject === 'string' ? subject.trim() : '',
      exercisedBy: actorRole,
      exercisedAt: this.now(),
    });
    this.log.append('federation.act.exercised', level.exercisedBy, {
      id,
      territoryKey: declared,
      actingKey: acting,
      kind,
      power: act.power,
    });
    return record;
  }

  /**
   * حالُ تفويضِ ترابٍ مقروءةً من صفِّه: نافذٌ أو مسحوبٌ أو لم يُفعَّل. وتُشتقّ من
   * الصفوفِ لا من عدّادٍ يُزاد بيد.
   * @param {string} territoryKey
   * @returns {Promise<Readonly<{ state: 'active' | 'revoked' | 'absent', level: string, powers: readonly string[], revokedAt: Date | null }>>}
   */
  async status(territoryKey) {
    levelFor(this.policy, territoryKey);
    const row = await this.#row(territoryKey);
    if (row === undefined) {
      return Object.freeze({ state: 'absent', level: '', powers: [], revokedAt: null });
    }
    const revokedAt = row['revokedAt'];
    /** @type {unknown} */
    const powers = row['powers'];
    return Object.freeze({
      state: revokedAt === null ? 'active' : 'revoked',
      level: readText(row, 'level'),
      powers: Object.freeze(Array.isArray(powers) ? powers.map((entry) => String(entry)) : []),
      revokedAt: revokedAt instanceof Date ? revokedAt : null,
    });
  }
}
