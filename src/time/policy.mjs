/**
 * سياسةُ الوقتِ المُبرهَنِ — بياناتٌ تُقرأُ وتُفحَصُ لا أرقامٌ في الكودِ
 * (‏`D-7`، `WL-192`).
 *
 * **العيبُ الذي تُغلقُه هذه الوحدةُ، بنصِّه كما كان:** «لا وقتَ مُبرهَناً من
 * مصدرٍ موقَّعٍ (‏Roughtime/NTS)». وكانت الساعةُ السياديّةُ
 * (‏`src/root-of-trust/clock.mts`) تكشفُ **انزياحَ** ساعةِ الجهازِ ورجوعَها
 * بمقارنةِ مقياسٍ رتيبٍ وعلامةٍ عاليةٍ على القرصِ، وهذا يكشفُ الاضطرابَ ولا
 * يُثبتُ الوقتَ: جهازٌ يبدأُ عمرَه بساعةٍ مكذوبةٍ تتقدّمُ رتيباً يُقبَلُ وقتُه
 * كلَّه، ومُهلةٌ تُقاسُ عليه ليست مُهلةً.
 *
 * وأربعةُ فحوصِ تماسكٍ لا يُغنى عنها بمخطَّطٍ نحويٍّ:
 *
 *  1. **النِّصابُ لا يتجاوزُ عددَ المصادرِ.** نِصابٌ أكبرُ من المصادرِ يجعلُ كلَّ
 *     محاولةِ إبرهانٍ تفشلُ حتماً — فهو تعطيلٌ مكتوبٌ سياسةً، ورفضُه عندَ
 *     التحميلِ أَولى من كشفِه بعدَ انقطاعِ خدمةٍ.
 *  2. **لا مصدرَ مكرَّرَ اسماً ولا مِفتاحاً ولا عنواناً.** نِصابٌ يُستوفى من
 *     مصدرٍ واحدٍ مكتوبٍ مرّتين ليس نِصاباً بل توهُّمُ اتّفاقٍ.
 *  3. **حدُّ العمرِ أوسعُ من نصفِ القُطرِ.** عمرٌ أضيقُ من فترةِ عدمِ اليقينِ
 *     يجعلُ كلَّ بُرهانٍ يُقرأُ قديماً في اللحظةِ التي يصلُ فيها.
 *  4. **اللهجةُ مُنفَّذةٌ.** مصدرٌ بلهجةٍ لا مُفكِّكَ لها يُسأَلُ ولا يُفهَمُ
 *     رَدُّه، فيُترجَمُ العجزُ عن الفكِّ رفضاً غامضاً وقتَ الحاجةِ.
 *
 * @module time/policy
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

import { TIME_ERRORS, TimeError } from './errors.mjs';
import { DIALECTS, PUBLIC_KEY_LENGTH } from './roughtime.mjs';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** مجلدُ الإعداداتِ الافتراضيُّ. */
export const DEFAULT_TIME_CONFIG_DIR = path.join(ROOT, 'config');

/**
 * @typedef {object} TimeSourceShape
 * @property {string} id
 * @property {string} dialect
 * @property {string} host
 * @property {number} port
 * @property {string} publicKey
 */

/**
 * @typedef {object} TimePolicyShape
 * @property {number} version
 * @property {number} quorum
 * @property {number} maxRadiusMs
 * @property {number} maxAgeMs
 * @property {number} maxLocalSkewMs
 * @property {number} requestTimeoutMs
 * @property {{ requireAttestedTime: boolean }} sovereign
 * @property {TimeSourceShape[]} sources
 */

/** مصدرُ وقتٍ مُعلَنٌ ومُتحقَّقٌ من شكلِ مِفتاحِه. */
export class TimeSource {
  /** @param {TimeSourceShape} shape */
  constructor(shape) {
    this.id = shape.id;
    this.dialect = shape.dialect;
    this.host = shape.host;
    this.port = shape.port;
    /** المِفتاحُ العامُّ خامّاً: اثنانِ وثلاثونَ بايتاً. */
    this.publicKey = Buffer.from(shape.publicKey, 'base64');
    this.publicKeyBase64 = shape.publicKey;
    Object.freeze(this);
  }

  /** وصفٌ نصّيٌّ للعرضِ في التقاريرِ. */
  get endpoint() {
    return `${this.host}:${this.port}`;
  }
}

/** سياسةُ وقتٍ محمَّلةٌ ومُتحقَّقٌ من تماسكِها. */
export class TimePolicy {
  /** @param {TimePolicyShape} shape */
  constructor(shape) {
    this.version = shape.version;
    this.quorum = shape.quorum;
    this.maxRadiusMs = shape.maxRadiusMs;
    this.maxAgeMs = shape.maxAgeMs;
    this.maxLocalSkewMs = shape.maxLocalSkewMs;
    this.requestTimeoutMs = shape.requestTimeoutMs;
    this.requireAttestedTime = shape.sovereign.requireAttestedTime;
    /** @type {ReadonlyArray<TimeSource>} */
    this.sources = Object.freeze(shape.sources.map((source) => new TimeSource(source)));
    /** @type {ReadonlyMap<string, TimeSource>} */
    this.byId = Object.freeze(new Map(this.sources.map((source) => [source.id, source])));
    Object.freeze(this);
  }

  /**
   * مصدرٌ باسمِه، ورفضٌ مُسمّى لما ليس معلَناً: رَدٌّ من مصدرٍ لا إعلانَ له لا
   * مِفتاحَ يُتحقَّقُ به، فقبولُه قبولٌ لمن على المسارِ.
   *
   * @param {string} sourceId
   * @returns {TimeSource}
   */
  source(sourceId) {
    const source = this.byId.get(sourceId);
    if (source === undefined) {
      throw new TimeError(
        TIME_ERRORS.SOURCE_UNKNOWN,
        `لا مصدرَ وقتٍ باسمِ «${sourceId}» في السياسةِ المُعلَنةِ؛ ومصدرٌ بلا إعلانٍ لا مِفتاحَ يُتحقَّقُ به.`,
        { sourceId },
      );
    }
    return source;
  }
}

/**
 * @param {string} dir
 * @returns {unknown}
 */
function readTimeConfig(dir) {
  const file = path.join(dir, 'time.yaml');
  if (!fs.existsSync(file)) {
    throw new TimeError(
      TIME_ERRORS.CONFIG_INVALID,
      `سياسةُ الوقتِ مفقودةٌ: ${file}. وبلا سياسةٍ مُعلَنةٍ تعودُ المصادرُ والحدودُ إلى الكودِ، وهي التي أُخرجَت منه.`,
      { file },
    );
  }
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * يحمّلُ سياسةَ الوقتِ ويتحقّقُ منها ضدَّ مخطَّطها ثمّ يفحصُ تماسكَها.
 *
 * @param {{ dir?: string }} [options]
 * @returns {TimePolicy}
 */
export function loadTimePolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_TIME_CONFIG_DIR;
  const raw = readTimeConfig(dir);
  const schemaFile = path.join(dir, 'schemas', 'time.schema.json');
  if (!fs.existsSync(schemaFile)) {
    throw new TimeError(
      TIME_ERRORS.CONFIG_INVALID,
      `مخطَّطُ سياسةِ الوقتِ مفقودٌ: ${schemaFile}.`,
      {
        schemaFile,
      },
    );
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
      .join('؛ ');
    throw new TimeError(TIME_ERRORS.CONFIG_INVALID, `سياسةُ الوقتِ لا تطابقُ مخطَّطها: ${detail}`, {
      detail,
    });
  }
  const parsed = /** @type {TimePolicyShape} */ (raw);

  /** @type {string[]} */
  const problems = [];
  const ids = new Set();
  const keys = new Set();
  const endpoints = new Set();
  for (const source of parsed.sources) {
    if (ids.has(source.id)) problems.push(`مصدرٌ مكرَّرُ الاسمِ: «${source.id}»`);
    ids.add(source.id);
    if (keys.has(source.publicKey)) {
      problems.push(`مِفتاحٌ مكرَّرٌ في مصدرَينِ عندَ «${source.id}» — نِصابٌ من مِفتاحٍ واحدٍ`);
    }
    keys.add(source.publicKey);
    const endpoint = `${source.host}:${source.port}`;
    if (endpoints.has(endpoint)) {
      problems.push(`عنوانٌ مكرَّرٌ في مصدرَينِ: «${endpoint}» — نِصابٌ من خادمٍ واحدٍ`);
    }
    endpoints.add(endpoint);
    if (Buffer.from(source.publicKey, 'base64').length !== PUBLIC_KEY_LENGTH) {
      problems.push(
        `مِفتاحُ «${source.id}» ليس ${PUBLIC_KEY_LENGTH} بايتاً بعدَ فكِّ الترميزِ — ومِفتاحٌ بطولٍ آخرَ لا يُتحقَّقُ به توقيعُ ed25519`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(DIALECTS, source.dialect)) {
      problems.push(
        `لهجةُ «${source.dialect}» في المصدرِ «${source.id}» غيرُ مُنفَّذةٍ — مصدرٌ يُسأَلُ ولا يُفهَمُ رَدُّه`,
      );
    }
  }
  if (parsed.quorum > parsed.sources.length) {
    problems.push(
      `النِّصابُ (${parsed.quorum}) أكبرُ من عددِ المصادرِ (${parsed.sources.length}) — تعطيلٌ مكتوبٌ سياسةً لا تشديدٌ`,
    );
  }
  if (parsed.maxAgeMs <= parsed.maxRadiusMs) {
    problems.push(
      `حدُّ العمرِ (${parsed.maxAgeMs}) ليس أوسعَ من نصفِ القُطرِ (${parsed.maxRadiusMs}) — فكلُّ بُرهانٍ يُقرأُ قديماً حينَ يصلُ`,
    );
  }
  if (parsed.maxLocalSkewMs < parsed.maxRadiusMs) {
    problems.push(
      `حدُّ انزياحِ ساعةِ الجهازِ (${parsed.maxLocalSkewMs}) أضيقُ من نصفِ القُطرِ (${parsed.maxRadiusMs}) — فكلُّ ساعةٍ تُعلَنُ منزاحةً بلا دليلٍ`,
    );
  }
  if (parsed.requestTimeoutMs >= parsed.maxAgeMs) {
    problems.push(
      `مُهلةُ السؤالِ (${parsed.requestTimeoutMs}) ليست أقصرَ من حدِّ العمرِ (${parsed.maxAgeMs}) — فسؤالٌ واحدٌ قد يُنهي صلاحيّةَ ما يجلبُه`,
    );
  }
  if (problems.length > 0) {
    throw new TimeError(
      TIME_ERRORS.CONFIG_INVALID,
      `سياسةُ الوقتِ غيرُ متماسكةٍ: ${problems.join('؛ ')}.`,
      { problems },
    );
  }
  return new TimePolicy(parsed);
}
