#!/usr/bin/env node
// مدقق البذرة — M1.02
// يتحقق من: (1) مطابقة كل ملف بذرة لمخطط JSON Schema الخاص به،
// (2) تماسك العدّادات مع طول المصفوفات، (3) عدم تكرار المعرّفات وتسلسلها،
// (4) خلوّ حقول الأسماء من أي نص قالبي.
// رمز الخروج 1 عند أي فشل.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'seed');

// المكتبة تُصدَّر بصيغة CommonJS، فالتصدير الافتراضي عند استيراده من ESM يراه
// الفاحص فضاء أسماء لا صانعاً وإن كان دالة فعلاً في زمن التشغيل. التصريح هنا
// يصف الحقيقة كما هي بلا تغيير سطر واحد من السلوك.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
const ajv = new Ajv2020({ allErrors: true, strict: false });

// أي اسم يطابق أحد هذه الأنماط يعني أن القالب المولّد تسرّب إلى البيانات
const TEMPLATE_PATTERNS = [
  /^#/,
  /^الحالة:/m,
  /^الغرض:/m,
  /^الوظيفة:/m,
  /هيكل تأسيسي/,
  /ينتظر التنفيذ/,
  /domain name ar/,
];

/**
 * سجل بذرة عام: كل سجل يحمل معرّفاً، وبقية الحقول تُقرأ بعد التحقق من نوعها.
 * قراءة الحقول عبر `Record<string, unknown>` مقصودة: هذا مدقق يفحص بيانات
 * قد تكون مخالفة، فلا يجوز أن يفترض شكلها صحيحاً قبل أن يُثبته.
 * @typedef {{ id?: unknown } & Record<string, unknown>} SeedRecord
 */

/**
 * منظور مقروء لبذرة تحقّق مخطَّطها في السطر السابق لاستخدامه.
 * السبب: هذا الملف مدقق، فـ`load` يُرجع شكلاً مجهولاً عن قصد حتى لا يفترض
 * صحة ما يفحصه. لكن بعد نجاح `validateSchema` تكون البنية مضمونة بتحقق فعلي
 * في زمن التشغيل، فالتصريح بالنوع بعدها مسنود بذلك التحقق لا بالافتراض.
 * @template T
 * @typedef {T} Verified
 */

/** @type {string[]} */
const failures = [];

/**
 * يُسجّل مخالفة واحدة.
 * @param {string} m - نص المخالفة كما يُطبع في التقرير
 * @returns {number}
 */
const fail = (m) => failures.push(m);

/**
 * يقرأ ملف بذرة YAML.
 * @param {string} f - اسم الملف داخل seed/
 * @returns {SeedRecord}
 */
const load = (f) => YAML.parse(fs.readFileSync(path.join(SEED, f), 'utf8'));

/**
 * يقرأ مخطط JSON Schema.
 * @param {string} f - اسم الملف داخل seed/schemas/
 * @returns {object}
 */
const schema = (f) => JSON.parse(fs.readFileSync(path.join(SEED, 'schemas', f), 'utf8'));

/**
 * يتحقق من مطابقة بيانات لمخطَّطها، ويُسجّل أول اثنتي عشرة مخالفة مع عدّ الباقي.
 * @param {string} label - اسم الملف في التقرير
 * @param {unknown} data - البيانات المحمَّلة
 * @param {string} schemaFile - اسم ملف المخطَّط
 * @returns {void}
 */
function validateSchema(label, data, schemaFile) {
  const validate = ajv.compile(schema(schemaFile));
  if (!validate(data)) {
    // المكتبة تضع الأخطاء في errors عند الفشل فقط، والفحص الصريح يمنع قراءة null.
    const errors = validate.errors ?? [];
    for (const e of errors.slice(0, 12)) {
      fail(`[${label}] مخطط: ${e.instancePath || '(الجذر)'} ${e.message}`);
    }
    if (errors.length > 12) {
      fail(`[${label}] مخطط: و${errors.length - 12} خطأ إضافي`);
    }
  }
}

/**
 * يتحقق أن حقل الاسم نصّ خالٍ من بصمات القوالب المولّدة.
 * @param {SeedRecord[]} items - السجلات المفحوصة
 * @param {string} label - اسم المجموعة في التقرير
 * @param {string} [field='name_ar'] - اسم الحقل المفحوص
 * @returns {void}
 */
function checkNames(label, items, field = 'name_ar') {
  for (const it of items) {
    const v = it[field];
    if (typeof v !== 'string') {
      fail(`[${label}] ${it.id}: الحقل ${field} ليس نصاً`);
      continue;
    }
    for (const p of TEMPLATE_PATTERNS) {
      if (p.test(v)) {
        fail(`[${label}] ${it.id}: نص قالبي في ${field} (النمط ${p})`);
        break;
      }
    }
  }
}

/**
 * يتحقق من عدم تكرار قيمة مفتاح بين السجلات.
 * @param {string} label - اسم المجموعة في التقرير
 * @param {SeedRecord[]} items - السجلات المفحوصة
 * @param {string} key - المفتاح الذي يجب أن يكون فريداً
 * @returns {void}
 */
function checkUnique(label, items, key) {
  /** @type {Map<unknown, true>} */
  const seen = new Map();
  for (const it of items) {
    const v = it[key];
    if (seen.has(v)) fail(`[${label}] تكرار ${key}: ${v}`);
    seen.set(v, true);
  }
}

// ═══ المجالات ═══
const domainsRaw = load('domains.yaml');
validateSchema('domains', domainsRaw, 'domains.schema.json');
const domains = /** @type {Verified<{ count: number, domains: SeedRecord[] }>} */ (
  /** @type {unknown} */ (domainsRaw)
);
if (domains.count !== domains.domains.length) {
  fail(`[domains] العدّاد ${domains.count} لا يساوي عدد السجلات ${domains.domains.length}`);
}
checkUnique('domains', domains.domains, 'id');
checkUnique('domains', domains.domains, 'name_ar');
checkNames('domains', domains.domains);
domains.domains.forEach((/** @type {SeedRecord} */ d, /** @type {number} */ i) => {
  if (d.number !== i + 1) fail(`[domains] تسلسل مكسور عند ${d.id}: number=${d.number}`);
  if (d.id !== `${String(i + 1).padStart(3, '0')}-domain`) {
    fail(`[domains] معرّف لا يطابق الترتيب: ${d.id}`);
  }
});

// ═══ المؤسسات ═══
const instsRaw = load('institutions.yaml');
validateSchema('institutions', instsRaw, 'institutions.schema.json');
const insts = /** @type {Verified<{ count: number, institutions: SeedRecord[] }>} */ (
  /** @type {unknown} */ (instsRaw)
);
if (insts.count !== insts.institutions.length) {
  fail(`[institutions] العدّاد ${insts.count} لا يساوي ${insts.institutions.length}`);
}
checkUnique('institutions', insts.institutions, 'id');
checkUnique('institutions', insts.institutions, 'name_ar');
checkUnique('institutions', insts.institutions, 'path');
checkNames('institutions', insts.institutions);
insts.institutions.forEach((/** @type {SeedRecord} */ it, /** @type {number} */ i) => {
  if (it.number !== i + 1) fail(`[institutions] تسلسل مكسور عند ${it.id}`);
  const instPath = it.path;
  if (typeof instPath !== 'string') {
    fail(`[institutions] ${it.id}: الحقل path ليس نصاً`);
    return;
  }
  if (!instPath.startsWith(`institutions/${it.id}-`)) {
    fail(`[institutions] المسار لا يبدأ بالمعرّف: ${instPath}`);
  }
});

// ═══ الفدرالية ═══
/**
 * ولاية كما تصفها البذرة، بالحقول التي يفحصها هذا المدقق فعلاً.
 * @typedef {SeedRecord & { id: string, municipality_count: number, municipality_ids: unknown[], canonical_path: string, legacy_data_path?: string | null }} ProvinceRecord
 */
/**
 * إقليم كما تصفه البذرة.
 * @typedef {SeedRecord & { id: string, canonical_path: string, legacy_data_path?: string | null, provinces: ProvinceRecord[] }} RegionRecord
 */
const fedRaw = load('federation.yaml');
validateSchema('federation', fedRaw, 'federation.schema.json');
const fed =
  /** @type {Verified<{ counts: { regions: number, provinces: number, municipalities: number }, defects: { split_identity_provinces: number, split_identity_regions: number }, regions: RegionRecord[] }>} */ (
    /** @type {unknown} */ (fedRaw)
  );
const regions = fed.regions;
if (regions.length !== fed.counts.regions) {
  fail(`[federation] عدّاد الأقاليم ${fed.counts.regions} لا يساوي ${regions.length}`);
}
let provTotal = 0;
let munTotal = 0;
let twins = 0;
checkUnique('federation', regions, 'id');
checkNames('federation', regions);
for (const r of regions) {
  provTotal += r.provinces.length;
  checkUnique(`federation/${r.id}`, r.provinces, 'id');
  checkNames(`federation/${r.id}`, r.provinces);
  if (r.legacy_data_path) twins += 0;
  for (const p of r.provinces) {
    munTotal += p.municipality_count;
    if (p.municipality_count !== p.municipality_ids.length) {
      fail(
        `[federation] ${p.id}: العدّاد ${p.municipality_count} لا يساوي ${p.municipality_ids.length}`,
      );
    }
    if (!p.canonical_path.startsWith(r.canonical_path + '/provinces/')) {
      fail(`[federation] ${p.id}: المسار لا ينتمي للإقليم ${r.id}`);
    }
    if (p.legacy_data_path) twins += 1;
  }
}
if (provTotal !== fed.counts.provinces) {
  fail(`[federation] عدّاد الولايات ${fed.counts.provinces} لا يساوي ${provTotal}`);
}
if (munTotal !== fed.counts.municipalities) {
  fail(`[federation] عدّاد البلديات ${fed.counts.municipalities} لا يساوي ${munTotal}`);
}
if (twins !== fed.defects.split_identity_provinces) {
  fail(
    `[federation] عدّاد الهوية المزدوجة ${fed.defects.split_identity_provinces} لا يساوي ${twins}`,
  );
}

// ═══ التقرير ═══
console.log('═══ تدقيق البذرة (M1.02) ═══');
console.log(
  `المجالات:    ${domains.domains.length} (تحتاج مصادقة: ${domains.domains.filter((/** @type {SeedRecord} */ d) => d.needs_ratification).length})`,
);
console.log(`المؤسسات:    ${insts.institutions.length}`);
console.log(`الفدرالية:   ${regions.length} إقليماً / ${provTotal} ولاية / ${munTotal} بلدية`);
console.log(
  `عيوب مسجّلة: هوية مزدوجة في ${twins} ولاية و${fed.defects.split_identity_regions} إقليماً`,
);

if (failures.length > 0) {
  console.error(`\n❌ فشل التدقيق بـ ${failures.length} مخالفة:`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('\n✅ البذرة مطابقة للمخططات، والعدّادات متماسكة، ولا نص قالبي في أي حقل اسم.');
