/**
 * كتالوج القدرات — M6.03
 *
 * المسألة التي يحلّها: القدرات المحرَّمة كانت `new Set([...])` في سجل الوكلاء،
 * ثلاث قيم في مسارٍ واحد. فمن سجّل وكيلاً مُرّ عليه الفحص، ومن **منح** قدرةً بعد
 * التسجيل لم يمرّ به، ومن طلب تفويضاً بقدرة محرَّمة في شهادته لم يُفحص أصلاً.
 * فكان الخط الأحمر خطاً في مكانٍ لا طبقةً.
 *
 * فصار الكتالوج **بياناتٍ** في `config/capabilities.yaml` يتحقّق منها مخطَّط
 * قبل أن يراها الكود (نفس قاعدة `src/policy/loader.mjs`)، وصار المحرَّم يُرفض في
 * ثلاثة مواضع لا موضع واحد: التسجيل، والمنح، والتفويض.
 *
 * وفشل التحميل **مغلق**: ملفٌ غائب أو فاسد أو مخالفٌ لمخطَّطه يرفع خطأً يسمّي
 * الملف والبند، ولا يسقط إلى كتالوجٍ فارغ — لأن كتالوج محرَّماتٍ فارغ يعني
 * السماح بكل شيء، وهو أسوأ من التوقّف.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

// نفس سبب التصريح في `src/policy/loader.mjs`: المكتبة CommonJS، وتصديرها
// الافتراضي يُرى فضاء أسماء لا صانعاً وإن كان دالة في زمن التشغيل.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_DIR = path.join(ROOT, 'config');

/**
 * قدرة محرَّمة: لا مدة ولا مانح، لأن غياب الحقلين تصريحٌ بأن لا طريق للمنح.
 * @typedef {object} ForbiddenCapability
 * @property {string} id
 * @property {string} reason
 * @property {string | null} lawRef
 */

/**
 * قدرة قابلة للمنح المؤقّت.
 * @typedef {object} GrantableCapability
 * @property {string} id
 * @property {number} maxDurationSeconds
 * @property {ReadonlySet<string>} grantorRoles
 * @property {string} reason
 */

/**
 * الكتالوج المحمَّل والمجمَّد.
 * @typedef {object} CapabilityCatalog
 * @property {number} version
 * @property {string} owner
 * @property {ReadonlyMap<string, ForbiddenCapability>} forbidden
 * @property {ReadonlyMap<string, GrantableCapability>} grantable
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * يحمّل الكتالوج ويتحقّق من مخطَّطه ومن تماسكه مع `roles.yaml`، ثم يجمّده.
 *
 * فحص التماسك ليس زيادة: قدرةٌ محرَّمة تظهر في دورٍ في `roles.yaml` تعني أن كل
 * من حمل الدور حملها بلا منحٍ ولا مدة — وهذا نقضٌ للطبقة الصلبة من بابٍ خلفي.
 * @param {{ dir?: string }} [options] - `dir` لاختبارات تُحمّل بيانات بديلة
 * @returns {CapabilityCatalog}
 */
export function loadCapabilityCatalog(options = {}) {
  const dir = options.dir ?? CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : CONFIG_DIR;
  const file = path.join(dir, 'capabilities.yaml');
  if (!fs.existsSync(file)) throw new Error('CAPABILITY_CONFIG_MISSING: capabilities.yaml');

  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`CAPABILITY_CONFIG_UNPARSABLE: capabilities.yaml: ${errorText(error)}`, {
      cause: error,
    });
  }

  const schemaPath = path.join(schemaDir, 'schemas', 'capabilities.schema.json');
  if (!fs.existsSync(schemaPath)) throw new Error('CAPABILITY_SCHEMA_MISSING');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
      .join(' | ');
    throw new Error(`CAPABILITY_CONFIG_INVALID: capabilities.yaml: ${problems}`);
  }

  const doc =
    /** @type {{ version: number, owner: string, forbidden: Array<{ id: string, reason: string, lawRef?: string }>, grantable: Array<{ id: string, maxDurationSeconds: number, grantorRoles: string[], reason: string }> }} */ (
      raw
    );

  /** @type {string[]} */
  const problems = [];

  /** @type {Map<string, ForbiddenCapability>} */
  const forbidden = new Map();
  for (const entry of doc.forbidden) {
    if (forbidden.has(entry.id)) problems.push(`قدرة محرَّمة مكرَّرة: ${entry.id}`);
    forbidden.set(
      entry.id,
      Object.freeze({ id: entry.id, reason: entry.reason, lawRef: entry.lawRef ?? null }),
    );
  }

  /** @type {Map<string, GrantableCapability>} */
  const grantable = new Map();
  for (const entry of doc.grantable) {
    if (grantable.has(entry.id)) problems.push(`قدرة قابلة للمنح مكرَّرة: ${entry.id}`);
    if (forbidden.has(entry.id)) {
      problems.push(`قدرة معلَنة محرَّمة وقابلة للمنح في وقتٍ واحد: ${entry.id}`);
    }
    grantable.set(
      entry.id,
      Object.freeze({
        id: entry.id,
        maxDurationSeconds: entry.maxDurationSeconds,
        grantorRoles: Object.freeze(new Set(entry.grantorRoles)),
        reason: entry.reason,
      }),
    );
  }

  // تماسكٌ مع الأدوار: يُقرأ `roles.yaml` نصّاً لا عبر محمّل السياسات، كي لا
  // يصير تحميل القدرات مرهوناً بصحّة كل ملفات السياسة الأربعة.
  const rolesFile = path.join(dir, 'roles.yaml');
  if (fs.existsSync(rolesFile)) {
    /** @type {unknown} */
    let rolesRaw;
    try {
      rolesRaw = YAML.parse(fs.readFileSync(rolesFile, 'utf8'));
    } catch (error) {
      throw new Error(`CAPABILITY_CONFIG_UNPARSABLE: roles.yaml: ${errorText(error)}`, {
        cause: error,
      });
    }
    const rolesDoc = /** @type {{ roles?: Array<{ id?: string, capabilities?: string[] }> }} */ (
      rolesRaw === null || typeof rolesRaw !== 'object' ? {} : rolesRaw
    );
    for (const role of rolesDoc.roles ?? []) {
      for (const capability of role.capabilities ?? []) {
        if (forbidden.has(capability)) {
          problems.push(`دورٌ يحمل قدرة محرَّمة: ${role.id ?? '—'} ← ${capability}`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`CAPABILITY_CATALOG_INCOHERENT: ${problems.join(' | ')}`);
  }

  return Object.freeze({
    version: doc.version,
    owner: doc.owner,
    forbidden: forbidden,
    grantable: grantable,
  });
}

/**
 * الطبقة الصلبة كدالة واحدة: هل القدرة محرَّمة؟
 * @param {CapabilityCatalog} catalog
 * @param {string} capability
 * @returns {boolean}
 */
export function isForbidden(catalog, capability) {
  return catalog.forbidden.has(capability);
}

/**
 * يفرز قائمة قدرات إلى مقبولة ومحرَّمة، بلا رفعِ خطأ — يستدعيها من يريد **تسجيل**
 * الحادثة على كل محرَّم لا الاكتفاء بأول واحد.
 * @param {CapabilityCatalog} catalog
 * @param {readonly string[]} capabilities
 * @returns {{ allowed: string[], forbidden: string[] }}
 */
export function partitionCapabilities(catalog, capabilities) {
  /** @type {string[]} */
  const allowed = [];
  /** @type {string[]} */
  const banned = [];
  for (const capability of capabilities) {
    if (catalog.forbidden.has(capability)) banned.push(capability);
    else allowed.push(capability);
  }
  return { allowed, forbidden: banned };
}
