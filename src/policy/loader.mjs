/**
 * محمّل السياسات — M4.02
 *
 * يقرأ `config/*.yaml` ويتحقّق من كل ملف بمخطَّط JSON Schema الخاص به **قبل**
 * أن يراه المحرّك، ثم يفحص تماسكاً لا يعبّر عنه المخطَّط: أن كل فعل في سياسة
 * معلَنٌ في الكتالوج، وأن كل دور في سياسة معلَنٌ في `roles.yaml`، وأن كل فعل في
 * العتبة السيادية معلَنٌ في الكتالوج، وأن كل حصّة مشار إليها في الكتالوج معلَنة
 * في `quotas.yaml`.
 *
 * السبب أن هذا الفحص هنا لا في المحرّك: المحرّك يقرّر في مسار ساخن ولا يجوز أن
 * يكتشف فساد البيانات وقتها، فيصير الاكتشاف عند التحميل — والتحميل يفشل مغلقاً
 * (المادة 9) بخطأ يسمّي الملف والبند.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

/** @typedef {import('./model.mjs').PolicyRecord} PolicyRecord */
/** @typedef {import('./model.mjs').ActionDefinition} ActionDefinition */
/** @typedef {import('./model.mjs').SovereignThresholdEntry} SovereignThresholdEntry */
/** @typedef {import('./model.mjs').QuotaDefinition} QuotaDefinition */

// نفس سبب التصريح في `scripts/validate-seed.mjs`: المكتبة CommonJS، والتصدير
// الافتراضي يُرى فضاء أسماء لا صانعاً وإن كان دالة في زمن التشغيل.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_DIR = path.join(ROOT, 'config');

/**
 * مجموعة السياسات المحمَّلة: هذه هي الوحدة التي يُبنى عليها المحرّك، ولا يُبنى
 * على ملفٍ واحد منفرد لأن التماسك بين الملفات جزءٌ من صحّة كل ملف.
 * @typedef {object} PolicyBundle
 * @property {ReadonlyMap<string, ActionDefinition>} actions
 * @property {readonly PolicyRecord[]} policies - المفعّلة والمعلَّقة معاً؛ التصفية قرار المحرّك لا المحمّل
 * @property {ReadonlyMap<string, { id: string, capabilities: ReadonlySet<string> }>} roles
 * @property {readonly SovereignThresholdEntry[]} threshold
 * @property {readonly QuotaDefinition[]} quotas
 * @property {{ policies: number, roles: number, royalAuthority: number, quotas: number }} versions
 */

/**
 * يجمّد كائناً ومصفوفاته المتداخلة وكائناته الفرعية البسيطة. على عكس
 * `Object.freeze` السطحي، يمنع `push`/`splice` على المصفوفات المتداخلة (تُلقي
 * في الوضع الصارم) ويجمّد `actors`/`conditions`/`value` المتداخلة. وهو ما يُغلق
 * به عيبُ `GPT-F03`: التجميد السطحي لسجلّ السياسة كان يترك `p.actions` و`p.resources`
 * و`p.actors.roles` قابلةً للتعديل بعد التحقّق من YAML، فيتغيّر القرار الحي.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreezeValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeValue(item);
    Object.freeze(value);
    return value;
  }
  // كائن بسيط فقط: لا نُجمّد نسخ الصنف (Date/Map/Set/Buffer) له معالَجٌ خاصّ،
  // ولا نُجمّد ما ليس لنا ملكُه بمعنًى يتلفه التجميد.
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    for (const key of Object.keys(value))
      deepFreezeValue(/** @type {Record<string, unknown>} */ (value)[key]);
    Object.freeze(value);
  }
  return value;
}

/**
 * خطأٌ واحدٌ مُسمّى يُلقى عند كل محاولة تعديل بنية السياسات بعد التحميل.
 */
class PolicyBundleImmutableError extends TypeError {
  constructor() {
    super('POLICY_BUNDLE_IMMUTABLE: لا يُسمح بتعديل خريطة/مجموعة السياسات بعد التحميل (GPT-F03).');
  }
}

const MUTATION_BLOCKED = () => {
  throw new PolicyBundleImmutableError();
};

/**
 * يُغلّف خريطةً بغلافٍ يمنع `set`/`delete`/`clear` ويُمرّر القراءة. `Object.freeze`
 * على `Map` لا يمنع `Map.prototype.set` (يكتب في [[MapData]] الداخلي)، فالخريطة
 * «المجمّدة» تبقى قابلةً للحقن. هذا الغلاف يُلقي عند كل محاولة كتابة على الخريطة
 * أو على خصائصها، بينما تمرّ `has`/`get`/`values`/`entries`/`forEach`/`size`.
 * @template K, V
 * @param {Map<K, V>} map
 * @returns {ReadonlyMap<K, V>}
 */
function readOnlyMap(map) {
  return /** @type {ReadonlyMap<K, V>} */ (
    new Proxy(map, {
      get(target, prop) {
        if (prop === 'set' || prop === 'delete' || prop === 'clear') return MUTATION_BLOCKED;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set: MUTATION_BLOCKED,
      deleteProperty: MUTATION_BLOCKED,
      defineProperty: MUTATION_BLOCKED,
      setPrototypeOf: MUTATION_BLOCKED,
    })
  );
}

/**
 * نظيرُ `readOnlyMap` للمجموعة: يمنع `add`/`delete`/`clear` ويُمرّر القراءة.
 * @template V
 * @param {Set<V>} set
 * @returns {ReadonlySet<V>}
 */
function readOnlySet(set) {
  return /** @type {ReadonlySet<V>} */ (
    new Proxy(set, {
      get(target, prop) {
        if (prop === 'add' || prop === 'delete' || prop === 'clear') return MUTATION_BLOCKED;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set: MUTATION_BLOCKED,
      deleteProperty: MUTATION_BLOCKED,
      defineProperty: MUTATION_BLOCKED,
      setPrototypeOf: MUTATION_BLOCKED,
    })
  );
}

/**
 * يقرأ ملف YAML ويرفع خطأً يسمّيه إن غاب أو فسد نصّه.
 * @param {string} dir - مجلد البيانات
 * @param {string} file - اسم الملف داخل المجلد
 * @returns {unknown} الشكل الخام قبل أي تحقّق — مجهول عن قصد
 */
function readYaml(dir, file) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) throw new Error(`POLICY_CONFIG_MISSING: ${file}`);
  try {
    return YAML.parse(fs.readFileSync(full, 'utf8'));
  } catch (error) {
    throw new Error(`POLICY_CONFIG_UNPARSABLE: ${file}: ${errorText(error)}`, { cause: error });
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
 * يتحقّق من مطابقة البيانات لمخطَّطها ويجمع كل المخالفات لا أولها.
 * @param {import('ajv').default} ajv
 * @param {string} dir - مجلد البيانات الذي فيه `schemas/`؛ الاختبار قد يمرّر غيره
 * @param {string} file - اسم ملف البيانات، يظهر في نص الخطأ
 * @param {string} schemaFile - اسم ملف المخطَّط داخل `config/schemas/`
 * @param {unknown} data - البيانات المقروءة
 * @returns {void}
 */
function assertSchema(ajv, dir, file, schemaFile, data) {
  const schemaPath = path.join(dir, 'schemas', schemaFile);
  if (!fs.existsSync(schemaPath)) throw new Error(`POLICY_SCHEMA_MISSING: ${schemaFile}`);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    const problems = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
      .join(' | ');
    throw new Error(`POLICY_CONFIG_INVALID: ${file}: ${problems}`);
  }
}

/**
 * يحمّل مجموعة السياسات كاملةً ويتحقّق منها ثم يجمّدها.
 *
 * التجميد ليس تجميلاً: المحرّك يقرأ هذه البنية في كل قرار، وتعديلُها في زمن
 * التشغيل يعني تعديل السياسة بلا اعتماد ولا سجل — وهو بالضبط ما يمنعه M4.06.
 * @param {{ dir?: string }} [options] - `dir` لاختبارات تُحمّل بيانات بديلة
 * @returns {PolicyBundle}
 */
export function loadPolicyBundle(options = {}) {
  const dir = options.dir ?? CONFIG_DIR;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  // مجلد المخطَّطات يبقى مجلد المشروع إن لم يحمل مجلد البيانات البديل مخطَّطاته:
  // اختبارٌ يجرّب بيانات مخالفة يجب أن يُقاس بنفس المخطَّط لا بمخطَّط يكتبه هو.
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : CONFIG_DIR;

  const rolesRaw = readYaml(dir, 'roles.yaml');
  const policiesRaw = readYaml(dir, 'policies.yaml');
  const thresholdRaw = readYaml(dir, 'royal-authority.yaml');
  const quotasRaw = readYaml(dir, 'quotas.yaml');

  assertSchema(ajv, schemaDir, 'roles.yaml', 'roles.schema.json', rolesRaw);
  assertSchema(ajv, schemaDir, 'policies.yaml', 'policies.schema.json', policiesRaw);
  assertSchema(ajv, schemaDir, 'royal-authority.yaml', 'royal-authority.schema.json', thresholdRaw);
  assertSchema(ajv, schemaDir, 'quotas.yaml', 'quotas.schema.json', quotasRaw);

  // التصريح بعد التحقّق مسنودٌ بتحقّق فعلي في زمن التشغيل لا بافتراض — نفس
  // القاعدة المتبعة في مدقق البذرة.
  const rolesDoc =
    /** @type {{ version: number, roles: Array<{ id: string, capabilities: string[], inherits?: string[] }> }} */ (
      rolesRaw
    );
  const policiesDoc =
    /** @type {{ version: number, actions: ActionDefinition[], policies: PolicyRecord[] }} */ (
      policiesRaw
    );
  const thresholdDoc = /** @type {{ version: number, threshold: SovereignThresholdEntry[] }} */ (
    thresholdRaw
  );
  const quotasDoc = /** @type {{ version: number, quotas: QuotaDefinition[] }} */ (quotasRaw);

  /** @type {string[]} */
  const problems = [];

  /** @type {Map<string, { id: string, capabilities: Set<string> }>} */
  const roles = new Map();
  for (const role of rolesDoc.roles) {
    if (roles.has(role.id)) problems.push(`دور مكرَّر: ${role.id}`);
    roles.set(role.id, { id: role.id, capabilities: new Set(role.capabilities) });
  }
  // الوراثة تُحلّ عند التحميل لا عند القرار: حلُّها في المسار الساخن يجعل عمق
  // السلسلة يؤثّر في زمن القرار، ودورةً فيها تُعلَّق المحرّك بلا سبب مقروء.
  for (const role of rolesDoc.roles) {
    const seen = new Set([role.id]);
    /** @type {string[]} */
    const stack = [...(role.inherits ?? [])];
    const target = roles.get(role.id);
    while (stack.length > 0) {
      const parentId = stack.pop();
      if (parentId === undefined) break;
      if (seen.has(parentId)) {
        problems.push(`دورة وراثة في الأدوار عند: ${parentId}`);
        continue;
      }
      seen.add(parentId);
      const parent = roles.get(parentId);
      if (parent === undefined) {
        problems.push(`دور يورّث من دور غير معلَن: ${role.id} ← ${parentId}`);
        continue;
      }
      if (target !== undefined) {
        for (const capability of parent.capabilities) {
          /** @type {Set<string>} */ (target.capabilities).add(capability);
        }
      }
      const parentDoc = rolesDoc.roles.find((r) => r.id === parentId);
      stack.push(...(parentDoc?.inherits ?? []));
    }
  }

  /** @type {Map<string, ActionDefinition>} */
  const actions = new Map();
  for (const action of policiesDoc.actions) {
    if (actions.has(action.id)) problems.push(`فعل مكرَّر في الكتالوج: ${action.id}`);
    actions.set(action.id, Object.freeze({ ...action }));
  }

  const quotaResources = new Set(quotasDoc.quotas.map((q) => q.resource));
  for (const action of actions.values()) {
    if (action.quotaResource !== undefined && !quotaResources.has(action.quotaResource)) {
      problems.push(`فعل يشير إلى حصّة غير معلَنة: ${action.id} ← ${action.quotaResource}`);
    }
  }

  /** @type {Set<string>} */
  const policyIds = new Set();
  for (const policy of policiesDoc.policies) {
    if (policyIds.has(policy.id)) problems.push(`سياسة مكرَّرة: ${policy.id}`);
    policyIds.add(policy.id);
    if (policy.enabled && (policy.approvedBy === undefined || policy.approvedBy.trim() === '')) {
      // نفس قيد القاعدة `policies_enabled_needs_approver`: سياسة نافذة بلا
      // اعتماد هي توسيع صلاحيات بلا قرار.
      problems.push(`سياسة نافذة بلا معتمِد: ${policy.id}`);
    }
    for (const action of policy.actions) {
      if (action !== '*' && !actions.has(action)) {
        problems.push(`سياسة تشير إلى فعل غير معلَن: ${policy.id} ← ${action}`);
      }
    }
    for (const role of policy.actors.roles ?? []) {
      if (role !== '*' && !roles.has(role)) {
        problems.push(`سياسة تشير إلى دور غير معلَن: ${policy.id} ← ${role}`);
      }
    }
  }

  for (const entry of thresholdDoc.threshold) {
    if (!actions.has(entry.action)) {
      problems.push(`عتبة سيادية تشير إلى فعل غير معلَن: ${entry.action}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`POLICY_CONFIG_INCOHERENT: ${problems.join(' | ')}`);
  }

  // تجميدٌ عميقٌ لا سطحيٌّ (GPT-F03): `Object.freeze` على `Map`/`Set` لا يمنع
  // `.set`/`.add`، والتجميد السطحي لسجلّ السياسة لا يجمّد `actions`/`resources`/
  // `actors` المتداخلة فيبقى `push` يُغيّر القرار بعد التحقّق. فالخريطتان للقراءة
  // فقط، والمصفوفات والكائنات المتداخلة مجمّدةٌ كلّها.
  const frozenActions = new Map();
  for (const [id, action] of actions) {
    frozenActions.set(id, deepFreezeValue({ ...action }));
  }
  const frozenRoles = new Map();
  for (const [id, role] of roles) {
    frozenRoles.set(
      id,
      deepFreezeValue({ id: role.id, capabilities: readOnlySet(role.capabilities) }),
    );
  }

  return Object.freeze({
    actions: readOnlyMap(frozenActions),
    policies: Object.freeze(policiesDoc.policies.map((p) => deepFreezeValue({ ...p }))),
    roles: readOnlyMap(frozenRoles),
    threshold: Object.freeze(thresholdDoc.threshold.map((t) => deepFreezeValue({ ...t }))),
    quotas: Object.freeze(quotasDoc.quotas.map((q) => deepFreezeValue({ ...q }))),
    versions: Object.freeze({
      policies: policiesDoc.version,
      roles: rolesDoc.version,
      royalAuthority: thresholdDoc.version,
      quotas: quotasDoc.version,
    }),
  });
}
