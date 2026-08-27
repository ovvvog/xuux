/**
 * عقودُ قنوات الأحداث: تحميلُها، والتحقّقُ من رسالة عليها، وقياسُ التوافق الخلفي
 * — الخطوة `M7.07`.
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** الدولةُ كانت تنشر أحداثاً في خمسةٍ وعشرين
 * موضعاً بـ`log.append(type, actor, data)` **بلا عقد**. فلا شيءَ كان يقول ما
 * الحقولُ التي يضمنها نوعٌ لقارئه، ولا شيءَ يمنع كاتباً من إعادة تسمية حقلٍ
 * يقرؤه مستهلك، ولا نسخةَ عقدٍ تُميّز «حقلٌ لم يُرسل» من «حقلٌ حُذف من العقد».
 * والسجلُّ نفسُه لم يكن مقسوماً إلى تدفّقات: من أراد أحداث الاحتفاظ قرأ أحداث
 * الدولة كلَّها ورشّح بنفسه.
 *
 * **والعقدُ هنا لا يُكتب باليد ولا يُقاس باليد:** حقولُه مستخرجةٌ من شجرة الشيفرة
 * (‏`scripts/lib/event-emissions.mjs`) ويقايسها `npm run guard:events` بالشيفرة
 * في كل تحقّق. فهذه الوحدة تُنفّذ العقدَ ولا تخترعه.
 *
 * **وحدٌّ معلَن:** العقدُ يضمن **وجودَ المفاتيح** لا **أنواعَ قيمها**. مخطَّطُ
 * أنواعٍ لكل نوعٍ من أربعةٍ وثمانين يقتضي قياسَ كل حقلٍ على قيمةٍ حقيقية، وما لم
 * يُقَس لا يُكتب — والحدُّ مسجَّل في `docs/REMAINING_WORK.md`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** مجلد الإعدادات الافتراضي. */
export const DEFAULT_EVENTS_CONFIG_DIR = path.join(ROOT, 'config');

/** اسمُ ملف الأساس الذي يُقاس عليه التوافق الخلفي. */
export const EVENTS_BASELINE_FILE = 'events.baseline.json';

export const EVENT_ERRORS = Object.freeze({
  CONFIG_INVALID: 'EVENTS_CONFIG_INVALID',
  TYPE_UNKNOWN: 'EVENT_TYPE_UNKNOWN',
  CONTRACT_VIOLATION: 'EVENT_CONTRACT_VIOLATION',
  FORBIDDEN_FIELD: 'EVENT_FORBIDDEN_FIELD',
  VERSION_UNSUPPORTED: 'EVENT_VERSION_UNSUPPORTED',
  PUBLISH_REFUSED: 'EVENT_PUBLISH_REFUSED',
  CONSUME_REFUSED: 'EVENT_CONSUME_REFUSED',
  OFFSET_INVALID: 'EVENT_OFFSET_INVALID',
  CHAIN_BROKEN: 'EVENT_CHAIN_BROKEN',
  INPUT_INVALID: 'EVENT_INPUT_INVALID',
});

/** خطأُ القنوات: رسالتُه تفصيلٌ، ورمزُه هو ما يُختبر. */
export class EventError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'EventError';
    /** @type {string} */
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.detail = detail;
  }
}

/**
 * @typedef {object} EventTypeContract
 * @property {string} type
 * @property {number} version
 * @property {readonly string[]} required
 * @property {readonly string[]} optional
 * @property {boolean} open
 * @property {string} channel
 */

/**
 * @typedef {object} EventChannel
 * @property {string} id
 * @property {string} subject
 * @property {string} classification
 * @property {number} version
 * @property {readonly string[]} producers
 * @property {readonly string[]} consumers
 * @property {readonly EventTypeContract[]} types
 */

/**
 * @typedef {object} EventsPolicy
 * @property {number} version
 * @property {string} owner
 * @property {number} maxBatch
 * @property {readonly string[]} relayRoles
 * @property {readonly string[]} forbiddenPayloadKeys
 * @property {readonly string[]} repositoryHolders
 * @property {readonly EventChannel[]} channels
 * @property {(type: string) => EventTypeContract | null} contractFor
 * @property {(id: string) => EventChannel | null} channelFor
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function fail(code, message, detail = {}) {
  throw new EventError(code, message, detail);
}

/**
 * يحمّل سياسة القنوات ويتحقّق منها بمخطَّطها ثم بقواعدَ لا يقولها المخطَّط.
 * @param {{ dir?: string }} [options]
 * @returns {EventsPolicy}
 */
export function loadEventsPolicy({ dir = DEFAULT_EVENTS_CONFIG_DIR } = {}) {
  const file = path.join(dir, 'events.yaml');
  if (!fs.existsSync(file)) {
    fail(EVENT_ERRORS.CONFIG_INVALID, `ملف قنوات الأحداث غائب: ${file}.`, { file });
  }
  const raw = /** @type {Record<string, unknown>} */ (YAML.parse(fs.readFileSync(file, 'utf8')));
  const schemaPath = path.join(dir, 'schemas', 'events.schema.json');
  const schema = /** @type {object} */ (JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`)
      .join('؛ ');
    fail(EVENT_ERRORS.CONFIG_INVALID, `سياسة القنوات تخالف مخطَّطها: ${detail}`, { file });
  }
  const forbidden = /** @type {string[]} */ (raw['forbiddenPayloadKeys']);
  /** @type {Map<string, EventTypeContract>} */
  const byType = new Map();
  /** @type {EventChannel[]} */
  const channels = [];
  for (const entry of /** @type {Record<string, unknown>[]} */ (raw['channels'])) {
    const id = /** @type {string} */ (entry['id']);
    /** @type {EventTypeContract[]} */
    const types = [];
    for (const declared of /** @type {Record<string, unknown>[]} */ (entry['types'])) {
      const type = /** @type {string} */ (declared['type']);
      // نوعٌ في قناةٍ لا يبدأ باسمها يجعل الرسالة تُوجَّه بحسب الإعلان لا بحسب
      // النوع، فيصير نوعٌ واحد قابلاً للنشر في قناتين بتصنيفين مختلفين.
      if (type !== id && !type.startsWith(`${id}.`)) {
        fail(
          EVENT_ERRORS.CONFIG_INVALID,
          `النوع «${type}» معلَنٌ في قناة «${id}» ولا ينتسب إليها؛ توجيهُ الرسالة يجب أن يُقرأ من نوعها لا من موضع إعلانها.`,
          { channel: id, type },
        );
      }
      if (byType.has(type)) {
        fail(
          EVENT_ERRORS.CONFIG_INVALID,
          `النوع «${type}» معلَنٌ مرّتين؛ عقدان لنوعٍ واحد يجعلان القبول والرفض رهنَ ترتيب القراءة.`,
          { type },
        );
      }
      const required = Object.freeze([.../** @type {string[]} */ (declared['required'])].sort());
      const optional = Object.freeze(
        [.../** @type {string[]} */ (declared['optional'] ?? [])].sort(),
      );
      const overlap = required.filter((field) => optional.includes(field));
      if (overlap.length > 0) {
        fail(
          EVENT_ERRORS.CONFIG_INVALID,
          `حقولٌ إلزاميةٌ واختياريةٌ معاً في «${type}»: ${overlap.join('، ')}. حقلٌ بوصفين لا يُقاس عليه رفضٌ ولا قبول.`,
          { type, overlap },
        );
      }
      const banned = [...required, ...optional].filter((field) => forbidden.includes(field));
      if (banned.length > 0) {
        fail(
          EVENT_ERRORS.FORBIDDEN_FIELD,
          `عقد «${type}» يُعلن حقلاً محرَّماً: ${banned.join('، ')}. قناةٌ تحمل مادّةً تُبطل التصنيف والتشفير معاً.`,
          { type, banned },
        );
      }
      const contract = Object.freeze({
        type,
        version: /** @type {number} */ (declared['version']),
        required,
        optional,
        open: declared['open'] === true,
        channel: id,
      });
      types.push(contract);
      byType.set(type, contract);
    }
    const channel = Object.freeze({
      id,
      subject: /** @type {string} */ (entry['subject']),
      classification: /** @type {string} */ (entry['classification']),
      version: /** @type {number} */ (entry['version']),
      producers: Object.freeze([.../** @type {string[]} */ (entry['producers'])]),
      consumers: Object.freeze([.../** @type {string[]} */ (entry['consumers'])]),
      types: Object.freeze(types),
    });
    channels.push(channel);
  }
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  return Object.freeze({
    version: /** @type {number} */ (raw['version']),
    owner: /** @type {string} */ (raw['owner']),
    maxBatch: /** @type {number} */ (raw['maxBatch']),
    relayRoles: Object.freeze([.../** @type {string[]} */ (raw['relayRoles'])]),
    forbiddenPayloadKeys: Object.freeze([...forbidden]),
    repositoryHolders: Object.freeze([.../** @type {string[]} */ (raw['repositoryHolders'])]),
    channels: Object.freeze(channels),
    contractFor: (type) => byType.get(type) ?? null,
    channelFor: (id) => byId.get(id) ?? null,
  });
}

/**
 * القناةُ التي ينتسب إليها نوعُ حدثٍ: بادئتُه قبل أول نقطة، لا إعلانٌ منفصل.
 * @param {string} type
 * @returns {string}
 */
export function channelOfType(type) {
  const index = type.indexOf('.');
  return index === -1 ? type : type.slice(0, index);
}

/**
 * يتحقّق من حِمْل رسالةٍ على عقد نوعها.
 *
 * والرفضُ **مغلق**: نوعٌ غير معلَن يُرفض ولا يُنشر في قناةٍ مُخمَّنة، لأن نشرَ
 * ما لا عقدَ له يجعل المستهلك يقرأ ما لا يعرف شكله.
 * @param {EventsPolicy} policy
 * @param {string} type
 * @param {Record<string, unknown>} payload
 * @returns {EventTypeContract}
 */
export function assertPayloadValid(policy, type, payload) {
  const contract = policy.contractFor(type);
  if (contract === null) {
    fail(
      EVENT_ERRORS.TYPE_UNKNOWN,
      `نوعُ حدثٍ غير معلَن في أي قناة: «${type}». أعلِنه في config/events.yaml قبل نشره.`,
      { type },
    );
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail(EVENT_ERRORS.INPUT_INVALID, `حِمْلُ «${type}» يجب أن يكون كائناً.`, { type });
  }
  const keys = Object.keys(payload);
  const banned = keys.filter((key) => policy.forbiddenPayloadKeys.includes(key));
  if (banned.length > 0) {
    fail(
      EVENT_ERRORS.FORBIDDEN_FIELD,
      `حِمْلُ «${type}» يحمل مفتاحاً محرَّماً: ${banned.join('، ')}.`,
      { type, banned },
    );
  }
  const missing = contract.required.filter((field) => !Object.hasOwn(payload, field));
  if (missing.length > 0) {
    fail(
      EVENT_ERRORS.CONTRACT_VIOLATION,
      `حِمْلُ «${type}» يفقد حقولاً يضمنها عقدُه: ${missing.join('، ')}.`,
      { type, missing },
    );
  }
  if (!contract.open) {
    const extra = keys.filter(
      (key) => !contract.required.includes(key) && !contract.optional.includes(key),
    );
    if (extra.length > 0) {
      fail(
        EVENT_ERRORS.CONTRACT_VIOLATION,
        `حِمْلُ «${type}» يحمل حقولاً لا يعلنها عقدُه: ${extra.join('، ')}. حقلٌ غيرُ معلَن يقرؤه مستهلكٌ اليوم ويزول غداً بلا نسخةٍ تكشف زواله.`,
        { type, extra },
      );
    }
  }
  return contract;
}

/**
 * يتحقّق أن نسخةَ عقدٍ في رسالةٍ مقبولةٌ لمستهلكٍ يشترط حدّاً أدنى.
 * @param {EventTypeContract} contract
 * @param {number} messageVersion
 * @param {number} [minVersion]
 * @returns {void}
 */
export function assertVersionAcceptable(contract, messageVersion, minVersion) {
  if (messageVersion !== contract.version) {
    fail(
      EVENT_ERRORS.VERSION_UNSUPPORTED,
      `رسالةٌ بنسخة عقدٍ ${messageVersion} على نوع «${contract.type}» نسخةُ عقده ${contract.version}.`,
      { type: contract.type, messageVersion, contractVersion: contract.version },
    );
  }
  if (minVersion !== undefined && messageVersion < minVersion) {
    fail(
      EVENT_ERRORS.VERSION_UNSUPPORTED,
      `مستهلكٌ يشترط نسخة ${minVersion} فأعلى، والرسالةُ بنسخة ${messageVersion}.`,
      { type: contract.type, messageVersion, minVersion },
    );
  }
}

/**
 * @typedef {object} CompatibilityFinding
 * @property {'channel-removed' | 'type-removed' | 'field-removed' | 'field-required-added' | 'optional-promoted' | 'version-not-bumped'} kind
 * @property {string} subject
 * @property {string} detail
 */

/**
 * يقايس عقوداً جديدة بأساسٍ محفوظ ويُعيد ما هو **كاسرٌ بلا رفعِ نسخة**.
 *
 * القاعدة: إضافةُ حقلٍ اختياريٍّ أو نوعٍ أو قناةٍ توافقيّة؛ وحذفُ حقلٍ إلزامي أو
 * ترقيةُ اختياريٍّ إلى إلزامي أو حذفُ نوعٍ أو قناةٍ كاسرة. والكاسرُ ليس ممنوعاً —
 * بل ممنوعٌ **بلا رفعِ `version`**، لأن مستهلكاً يقرأ حقلاً زال بلا نسخةٍ جديدة
 * لا يعرف أنه صار يقرأ غياباً.
 * @param {{ channels: readonly { id: string, version: number, types: readonly { type: string, version: number, required: readonly string[], optional: readonly string[] }[] }[] }} baseline
 * @param {{ channels: readonly { id: string, version: number, types: readonly { type: string, version: number, required: readonly string[], optional: readonly string[] }[] }[] }} next
 * @returns {CompatibilityFinding[]}
 */
export function findBreakingChanges(baseline, next) {
  /** @type {CompatibilityFinding[]} */
  const findings = [];
  const nextChannels = new Map(next.channels.map((channel) => [channel.id, channel]));
  for (const old of baseline.channels) {
    const current = nextChannels.get(old.id);
    if (current === undefined) {
      findings.push({
        kind: 'channel-removed',
        subject: old.id,
        detail: 'قناةٌ حُذفت: مستهلكوها يقرأون تدفّقاً لا وجود له.',
      });
      continue;
    }
    const nextTypes = new Map(current.types.map((type) => [type.type, type]));
    for (const oldType of old.types) {
      const newType = nextTypes.get(oldType.type);
      if (newType === undefined) {
        if (current.version <= old.version) {
          findings.push({
            kind: 'type-removed',
            subject: oldType.type,
            detail: `نوعٌ حُذف بلا رفعِ نسخة القناة «${old.id}» (${old.version}).`,
          });
        }
        continue;
      }
      const bumped = newType.version > oldType.version;
      const removed = oldType.required.filter(
        (field) => !newType.required.includes(field) && !newType.optional.includes(field),
      );
      if (removed.length > 0 && !bumped) {
        findings.push({
          kind: 'field-removed',
          subject: oldType.type,
          detail: `حقولٌ إلزاميةٌ زالت بلا رفعِ نسخة العقد: ${removed.join('، ')}.`,
        });
      }
      const promoted = oldType.optional.filter((field) => newType.required.includes(field));
      if (promoted.length > 0 && !bumped) {
        findings.push({
          kind: 'optional-promoted',
          subject: oldType.type,
          detail: `حقولٌ اختياريةٌ صارت إلزاميةً بلا رفعِ نسخة العقد: ${promoted.join('، ')}. منتِجٌ قديم لا يُرسلها فتُرفض رسائلُه.`,
        });
      }
      const newlyRequired = newType.required.filter(
        (field) => !oldType.required.includes(field) && !oldType.optional.includes(field),
      );
      if (newlyRequired.length > 0 && !bumped) {
        findings.push({
          kind: 'field-required-added',
          subject: oldType.type,
          detail: `حقولٌ إلزاميةٌ أُضيفت بلا رفعِ نسخة العقد: ${newlyRequired.join('، ')}.`,
        });
      }
    }
  }
  return findings;
}

/**
 * يقرأ ملف الأساس المحفوظ.
 * @param {{ dir?: string }} [options]
 * @returns {{ channels: { id: string, version: number, types: { type: string, version: number, required: string[], optional: string[] }[] }[] }}
 */
export function loadEventsBaseline({ dir = DEFAULT_EVENTS_CONFIG_DIR } = {}) {
  const file = path.join(dir, EVENTS_BASELINE_FILE);
  if (!fs.existsSync(file)) {
    fail(EVENT_ERRORS.CONFIG_INVALID, `ملف أساس العقود غائب: ${file}.`, { file });
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * يُسقِط سياسةً إلى صورةِ أساسٍ قابلةٍ للحفظ والمقايسة.
 * @param {EventsPolicy} policy
 * @returns {{ channels: { id: string, version: number, types: { type: string, version: number, required: string[], optional: string[] }[] }[] }}
 */
export function toBaselineShape(policy) {
  return {
    channels: policy.channels.map((channel) => ({
      id: channel.id,
      version: channel.version,
      types: channel.types.map((type) => ({
        type: type.type,
        version: type.version,
        required: [...type.required],
        optional: [...type.optional],
      })),
    })),
  };
}
