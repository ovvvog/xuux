/**
 * تحميلُ عقدِ الأقاليمِ والتحقّقُ من ترابطِه — الخطوة `M10.07`.
 *
 * **العقدُ يُرفَض عند التحميلِ لا عند الاستعمال:** فكاتبانِ معلَنانِ، أو أولويّتانِ
 * متساويتانِ، أو حكمُ صحّةٍ يُطلَق التجاوزُ عليه ولا رمزَ خروجٍ له، لا يجوز أن
 * تظهر في منتصفِ سقوطِ إقليمٍ وقد توقّفت الكتابة.
 *
 * والضمانُ المُنفَّذُ هنا `G-REGION-SINGLE-SOURCE-BUDGET`: **نافذةُ الفقدِ**
 * المقبولةُ عند تجاوزِ الفشلِ تُشتقُّ من `consistency.maxReplicationLagMs` وحدَها
 * وتُلحَق بالعقدِ عند تحميلِه؛ ولا يحمل قسمُ الأثرِ رقماً لها أصلاً — يُثبت ذلك
 * المخطَّطُ الصارمُ ويحرسه الحاجزُ نصّاً. فمن كتب العتبةَ مرّتين شدّد إحداهما
 * يوماً ونسي الأخرى، فبقي يقول «الفقدُ ضمن العهد» على عهدٍ لم يعد قائماً.
 *
 * @module regions/contract
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// وحزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحدتَي البيئةِ والنشرِ قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { REGION_ERRORS, RegionError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** مجلَّدُ الوثائقِ الافتراضيُّ لعقدِ الأقاليم. */
export const DEFAULT_REGIONS_CONFIG_DIR = path.resolve(HERE, '..', '..', 'config');

/**
 * @typedef {object} RegionDeclaration
 * @property {string} id
 * @property {'writer' | 'reader'} role
 * @property {number} priority
 * @property {string} statePath
 * @property {string} statement
 */

/**
 * @typedef {object} RegionHealthVerdict
 * @property {string} id
 * @property {number} exitCode
 * @property {string} statement
 */

/**
 * @typedef {object} RegionsContract
 * @property {number} version
 * @property {string} statement
 * @property {{ model: string, maxReplicationLagMs: number, readerGuarantee: string, writerGuarantee: string, statement: string }} consistency
 * @property {RegionDeclaration[]} regions
 * @property {RegionHealthVerdict[]} health
 * @property {{ automatic: boolean, triggerOn: string[], maxFailoverMs: number, minHealthyRegions: number, statement: string }} failover
 * @property {{ maxUnavailableMs: number, statement: string }} impact
 * @property {{ path: string, pointerPath: string, statement: string }} ledger
 * @property {{ events: { type: string, statement: string }[] }} audit
 * @property {{ code: string, statement: string }[]} refusalCodes
 * @property {{ id: string, file: string, statement: string }[]} guarantees
 * @property {number} maxDataLossMs نافذةُ الفقدِ المشتقّةُ من عهدِ الاتساقِ — مصدرُها واحد.
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [detail]
 * @returns {never}
 */
function refuse(code, message, detail = {}) {
  throw new RegionError(code, message, detail);
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} message @returns {never} */
function invalidContract(message) {
  refuse(REGION_ERRORS.CONFIG_INVALID, message);
}

/**
 * تحميلُ عقدِ الأقاليمِ من `config/regions.yaml` والتحقّقُ منه بمخطَّطِه الصارمِ
 * ثم بترابطِه، ثم اشتقاقُ نافذةِ الفقدِ من عهدِ الاتساق.
 *
 * @param {{ dir?: string }} [options]
 * @returns {RegionsContract}
 */
export function loadRegionsContract(options = {}) {
  const dir = options.dir ?? DEFAULT_REGIONS_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_REGIONS_CONFIG_DIR;
  const file = path.join(dir, 'regions.yaml');
  if (!fs.existsSync(file)) {
    invalidContract(
      'عقدُ الأقاليمِ غائب؛ ودولةٌ بلا عقدِ أقاليمَ دولةٌ بموضعٍ واحدٍ لا يُقال إنه سقط لأنه لا ثانيَ له.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    invalidContract(`تعذّرت قراءة regions.yaml: ${errorText(error)}`);
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'regions.schema.json');
  if (!fs.existsSync(schemaPath)) {
    invalidContract(
      'مخطَّطُ عقدِ الأقاليمِ غائب؛ وبلا مخطَّطٍ يصير العقدُ نصّاً حرّاً كالحالِ الذي جاء ليُغلقه.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map(
        (/** @type {{ instancePath: string, message?: string }} */ entry) =>
          `${entry.instancePath || '/'}: ${entry.message ?? 'مخالفة'}`,
      )
      .join('؛ ');
    invalidContract(`عقدُ الأقاليمِ يخالف مخطَّطَه: ${problems}`);
  }
  const parsed = /** @type {RegionsContract} */ (raw);

  assertRegions(parsed);
  assertHealth(parsed);
  assertFailover(parsed);
  assertGuarantees(parsed);

  return Object.freeze({ ...parsed, maxDataLossMs: parsed.consistency.maxReplicationLagMs });
}

/** @param {RegionsContract} contract */
function assertRegions(contract) {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<number>} */
  const priorities = new Set();
  /** @type {string[]} */
  const paths = [];
  let writers = 0;
  for (const region of contract.regions) {
    if (ids.has(region.id)) {
      invalidContract(`الإقليم «${region.id}» مُعلَنٌ مرّتين — وإقليمٌ بدورين إقليمانِ لا إقليم.`);
    }
    if (priorities.has(region.priority)) {
      refuse(
        REGION_ERRORS.PRIORITY_INVALID,
        `الأولويّة ${String(region.priority)} مُعلَنةٌ لإقليمين — وترتيبٌ ملتبسٌ يُقرَّر بالحظِّ لا بالعقد.`,
        { region: region.id, priority: region.priority },
      );
    }
    if (region.role === 'writer') {
      writers += 1;
    }
    ids.add(region.id);
    priorities.add(region.priority);
    paths.push(region.statePath.replace(/\/+$/u, ''));
  }
  if (writers === 0) {
    refuse(
      REGION_ERRORS.WRITER_MISSING,
      'لا إقليمَ كاتبٌ في العقد — ودولةٌ بلا كاتبٍ دولةٌ لا تقبل كتابةً أصلاً.',
    );
  }
  if (writers > 1) {
    refuse(
      REGION_ERRORS.WRITER_NOT_UNIQUE,
      `العقدُ يُعلن ${String(writers)} أقاليمَ كاتبةً — وكاتبانِ في وقتٍ واحدٍ كتابتانِ لا تلتقيان أبداً.`,
      { writers },
    );
  }
  for (const [index, statePath] of paths.entries()) {
    for (const [other, otherPath] of paths.entries()) {
      if (index === other) {
        continue;
      }
      if (statePath === otherPath || otherPath.startsWith(`${statePath}/`)) {
        refuse(
          REGION_ERRORS.PATH_CONFLICT,
          `جذرا حالةِ إقليمين متداخلان (${statePath} و${otherPath}) — وموضعٌ واحدٌ لإقليمين يُفسدهما معاً.`,
          { first: statePath, second: otherPath },
        );
      }
    }
  }
  const ledgerRoots = [contract.ledger.path, contract.ledger.pointerPath];
  if (new Set(ledgerRoots).size !== ledgerRoots.length) {
    invalidContract(
      'مسارُ الدفترِ ومسارُ المؤشِّرِ واحدٌ — ومعنيانِ في موضعٍ واحدٍ يُفسدانِ معاً.',
    );
  }
}

/** @param {RegionsContract} contract */
function assertHealth(contract) {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<number>} */
  const codes = new Set();
  for (const verdict of contract.health) {
    if (ids.has(verdict.id)) {
      invalidContract(`الحكم «${verdict.id}» مُعلَنٌ مرّتين — وحكمٌ برمزَي خروجٍ حكمانِ لا حكم.`);
    }
    if (codes.has(verdict.exitCode)) {
      invalidContract(
        `رمزُ الخروج ${String(verdict.exitCode)} مُعلَنٌ لحكمين — والمسارُ الآليُّ يقرأ الرمزَ لا الاسمَ.`,
      );
    }
    ids.add(verdict.id);
    codes.add(verdict.exitCode);
  }
  for (const required of ['health:up', 'health:down', 'health:unmeasured']) {
    if (!ids.has(required)) {
      refuse(
        REGION_ERRORS.HEALTH_UNDECLARED,
        `الحكم «${required}» غيرُ مُعلَنٍ في العقد — وثلاثةُ أحوالٍ لا اثنان.`,
        { verdict: required },
      );
    }
  }
  const up = contract.health.find((verdict) => verdict.id === 'health:up');
  if (up !== undefined && up.exitCode !== 0) {
    invalidContract(
      'رمزُ خروجِ الحكمِ الصحيحِ ليس صفراً — والمسارُ الآليُّ يقرأ الصفرَ نجاحاً، فمن غيّره جعل نجاحَه فشلاً.',
    );
  }
}

/** @param {RegionsContract} contract */
function assertFailover(contract) {
  const declared = new Set(contract.health.map((verdict) => verdict.id));
  for (const trigger of contract.failover.triggerOn) {
    if (!declared.has(trigger)) {
      refuse(
        REGION_ERRORS.HEALTH_UNDECLARED,
        `سياسةُ التجاوزِ تُطلَق على الحكم «${trigger}» ولا إعلانَ له في العقد.`,
        { verdict: trigger },
      );
    }
  }
  if (contract.failover.triggerOn.includes('health:up')) {
    invalidContract('التجاوزُ مُطلَقٌ على الحكمِ الصحيح — وذلك عقدٌ لا يستقرّ فيه كاتبٌ أبداً.');
  }
  if (contract.failover.minHealthyRegions > contract.regions.length) {
    invalidContract(
      'الحدُّ الأدنى للأقاليمِ القائمةِ أكبرُ من عددِ الأقاليمِ المعلَنةِ — وشرطٌ لا يُستوفى أبداً شرطٌ يوقف الدولةَ لا يحرسها.',
    );
  }
}

/** @param {RegionsContract} contract */
function assertGuarantees(contract) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const guarantee of contract.guarantees) {
    if (ids.has(guarantee.id)) {
      invalidContract(`الضمان «${guarantee.id}» مُعلَنٌ مرّتين في العقد.`);
    }
    ids.add(guarantee.id);
  }
}

/**
 * قراءةُ إقليمٍ معلَنٍ بمعرّفِه، ورَدُّ ما ليس معلَناً.
 *
 * @param {RegionsContract} contract
 * @param {string} regionId
 * @returns {RegionDeclaration}
 */
export function requireRegion(contract, regionId) {
  const region = contract.regions.find((entry) => entry.id === regionId);
  if (region === undefined) {
    refuse(
      REGION_ERRORS.UNDECLARED,
      `الإقليم «${regionId}» لا إعلانَ له في العقد — ولا يُسقَط ولا يُنصَّب ما ليس معلَناً.`,
      { region: regionId },
    );
  }
  return region;
}

/**
 * رمزُ خروجِ حكمِ صحّةٍ معلَنٍ.
 *
 * @param {RegionsContract} contract
 * @param {string} verdictId
 * @returns {number}
 */
export function exitCodeFor(contract, verdictId) {
  const verdict = contract.health.find((entry) => entry.id === verdictId);
  if (verdict === undefined) {
    refuse(REGION_ERRORS.HEALTH_UNDECLARED, `الحكم «${verdictId}» غيرُ مُعلَنٍ في العقد.`, {
      verdict: verdictId,
    });
  }
  return verdict.exitCode;
}
