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
import Ajv2020 from 'ajv/dist/2020.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'seed');
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

const failures = [];
const fail = (m) => failures.push(m);
const load = (f) => YAML.parse(fs.readFileSync(path.join(SEED, f), 'utf8'));
const schema = (f) => JSON.parse(fs.readFileSync(path.join(SEED, 'schemas', f), 'utf8'));

function validateSchema(label, data, schemaFile) {
  const validate = ajv.compile(schema(schemaFile));
  if (!validate(data)) {
    for (const e of validate.errors.slice(0, 12)) {
      fail(`[${label}] مخطط: ${e.instancePath || '(الجذر)'} ${e.message}`);
    }
    if (validate.errors.length > 12) {
      fail(`[${label}] مخطط: و${validate.errors.length - 12} خطأ إضافي`);
    }
  }
}

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

function checkUnique(label, items, key) {
  const seen = new Map();
  for (const it of items) {
    const v = it[key];
    if (seen.has(v)) fail(`[${label}] تكرار ${key}: ${v}`);
    seen.set(v, true);
  }
}

// ═══ المجالات ═══
const domains = load('domains.yaml');
validateSchema('domains', domains, 'domains.schema.json');
if (domains.count !== domains.domains.length) {
  fail(`[domains] العدّاد ${domains.count} لا يساوي عدد السجلات ${domains.domains.length}`);
}
checkUnique('domains', domains.domains, 'id');
checkUnique('domains', domains.domains, 'name_ar');
checkNames('domains', domains.domains);
domains.domains.forEach((d, i) => {
  if (d.number !== i + 1) fail(`[domains] تسلسل مكسور عند ${d.id}: number=${d.number}`);
  if (d.id !== `${String(i + 1).padStart(3, '0')}-domain`) {
    fail(`[domains] معرّف لا يطابق الترتيب: ${d.id}`);
  }
});

// ═══ المؤسسات ═══
const insts = load('institutions.yaml');
validateSchema('institutions', insts, 'institutions.schema.json');
if (insts.count !== insts.institutions.length) {
  fail(`[institutions] العدّاد ${insts.count} لا يساوي ${insts.institutions.length}`);
}
checkUnique('institutions', insts.institutions, 'id');
checkUnique('institutions', insts.institutions, 'name_ar');
checkUnique('institutions', insts.institutions, 'path');
checkNames('institutions', insts.institutions);
insts.institutions.forEach((it, i) => {
  if (it.number !== i + 1) fail(`[institutions] تسلسل مكسور عند ${it.id}`);
  if (!it.path.startsWith(`institutions/${it.id}-`)) {
    fail(`[institutions] المسار لا يبدأ بالمعرّف: ${it.path}`);
  }
});

// ═══ الفدرالية ═══
const fed = load('federation.yaml');
validateSchema('federation', fed, 'federation.schema.json');
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
  `المجالات:    ${domains.domains.length} (تحتاج مصادقة: ${domains.domains.filter((d) => d.needs_ratification).length})`,
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
