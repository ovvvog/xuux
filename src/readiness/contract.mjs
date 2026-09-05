/**
 * تحميلُ عقدِ تقريرِ الجاهزيّةِ وسجلِّ التأجيلاتِ والتحقّقُ من ترابطِهما — الخطوة
 * `M11.08`.
 *
 * **العقدُ يُرفَض عند التحميلِ لا في منتصفِ تقريرٍ:** حكمٌ بلا رمزِ خروجٍ مُفرَدٍ، أو
 * حكمُ إخفاقٍ يخرج صفراً، أو مصدرٌ بلا مسارٍ، أو تأجيلٌ بمخطَّطٍ مخالفٍ — كلُّ ذلك
 * لا يجوز أن يُكتشَف بعدَ أن يُنشَر تقريرٌ يُقرأ حكماً على الجاهزيّةِ.
 *
 * والضمانُ المُنفَّذُ هنا `G-READINESS-ONLY-REPORTED-EXITS-ZERO`: **الحكمُ الأوّلُ
 * وحدَه** يخرج صفراً؛ فتقريرٌ ناقصٌ يخرج صفراً بوابةٌ تقرأ نقصاً نجاحاً.
 *
 * @module readiness/contract
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Default from 'ajv/dist/2020.js';

// حزمةُ Ajv تُصدِّر صنفَها افتراضاً في ESM، فيُقرأ نوعُه صريحاً وإلا صار «غيرَ
// قابلٍ للإنشاء» في الفحصِ الصارم — كما في وحداتِ الطوارئِ والتعافي قبلَها.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
import YAML from 'yaml';

import { READINESS_ERRORS, ReadinessError } from './errors.mjs';
import { REPORTED_VERDICT } from './judgement.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** جذرُ المستودعِ المستنتَجُ من موضعِ هذه الوحدةِ. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/**
 * @param {string} file
 * @param {string} schemaFile
 * @param {string} code
 * @returns {Record<string, unknown>}
 */
function loadValidated(file, schemaFile, code) {
  if (!fs.existsSync(file)) {
    throw new ReadinessError(code, `الوثيقةُ غائبةٌ: ${file}`, { file });
  }
  const parsed = YAML.parse(fs.readFileSync(file, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(parsed)) {
    const errors = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
      .join('؛ ');
    throw new ReadinessError(code, `الوثيقةُ تخالف مخطَّطَها: ${errors}`, { file });
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {{ configDir?: string }} [options]
 * @returns {import('./judgement.mjs').ReadinessJudgement extends never ? never : any}
 */
export function loadReadinessContract(options = {}) {
  const configDir = options.configDir ?? path.join(REPO_ROOT, 'config');
  const contract = loadValidated(
    path.join(configDir, 'readiness-report.yaml'),
    path.join(configDir, 'schemas', 'readiness-report.schema.json'),
    READINESS_ERRORS.CONFIG_INVALID,
  );

  const verdicts = /** @type {{ id: string, exitCode: number }[]} */ (contract.verdicts);
  const codes = new Set(verdicts.map((verdict) => verdict.exitCode));
  if (codes.size !== verdicts.length) {
    throw new ReadinessError(
      READINESS_ERRORS.CONFIG_INVALID,
      'حكمانِ يتشاركانِ رمزَ خروجٍ واحداً — فلا يُميَّز أحدُهما من الآخرِ آلياً.',
    );
  }
  const zero = verdicts.filter((verdict) => verdict.exitCode === 0);
  if (zero.length !== 1 || zero[0]?.id !== REPORTED_VERDICT) {
    throw new ReadinessError(
      READINESS_ERRORS.CONFIG_INVALID,
      `الحكمُ «${REPORTED_VERDICT}» وحدَه يخرج صفراً — والعقدُ يخالف ذلك.`,
    );
  }
  return contract;
}

/**
 * @param {{ configDir?: string }} [options]
 * @returns {import('./deferrals.mjs').DeferralRecord[]}
 */
export function loadDeferrals(options = {}) {
  const configDir = options.configDir ?? path.join(REPO_ROOT, 'config');
  const registry = loadValidated(
    path.join(configDir, 'readiness-deferrals.yaml'),
    path.join(configDir, 'schemas', 'readiness-deferrals.schema.json'),
    READINESS_ERRORS.DEFERRALS_INVALID,
  );
  const deferrals = /** @type {import('./deferrals.mjs').DeferralRecord[]} */ (registry.deferrals);
  const ids = new Set(deferrals.map((deferral) => deferral.id));
  if (ids.size !== deferrals.length) {
    throw new ReadinessError(
      READINESS_ERRORS.DEFERRALS_INVALID,
      'بندٌ مؤجَّلٌ مذكورٌ مرّتَينِ في السجلِّ — فأيُّ سطرٍ منهما يُقرأ؟',
    );
  }
  return deferrals;
}
