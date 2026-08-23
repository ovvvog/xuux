#!/usr/bin/env node
// مولّد السجلات المشتقة — M1.03
// يولّد السجلات من البذرة وحدها، فتنتهي مشكلة تسرّب نص القوالب إلى حقول الأسماء (E5/E6/E7).
// الاستخدام:
//   node scripts/generate-registries.mjs           → يكتب السجلات
//   node scripts/generate-registries.mjs --check    → لا يكتب؛ يفشل إن اختلف المولّد عن الموجود
// معيار القبول: صفر نص قالبي في أي حقل اسم، وتطابق الأعداد مع البذرة.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// أنواع البذرة تُستورد من المُحمِّل: هو مالك عقد البذرة، فلا يُعاد وصف الشكل هنا
// حتى لا ينحرف وصفان لنفس الملف. `YAML.parse` يُرجع any، والتصريح بالنوع عند
// القراءة هو ما يجعل بقية الملف مفحوصاً فعلياً.
/**
 * @typedef {import('../src/registry/loader.mjs').DomainsSeed} DomainsSeedBase
 * @typedef {import('../src/registry/loader.mjs').InstitutionsSeed} InstitutionsSeedBase
 * @typedef {import('../src/registry/loader.mjs').FederationSeed} FederationSeedBase
 * @typedef {import('../src/registry/loader.mjs').DomainSeed} DomainSeed
 * @typedef {import('../src/registry/loader.mjs').InstitutionSeed} InstitutionSeed
 * @typedef {import('../src/registry/loader.mjs').RegionSeed} RegionSeed
 * @typedef {import('../src/registry/loader.mjs').ProvinceSeed} ProvinceSeed
 */

// المُحمِّل يصف القوائم كاختيارية لأنه مُصمَّم ليتحمّل بذرة ناقصة ويشتكي منها.
// أما هذا المولّد فالبذرة الكاملة شرط مسبق لعمله: يشغّله CI بعد validate:seed،
// فالقوائم موجودة بحكم المخطَّط. لذلك تُشتقّ هنا أنواع «كاملة» صريحة بدل نشر
// `?? []` في كل سطر، وهو ما كان سيُخفي بذرة ناقصة بصمت في مخرَج ناقص.
/** @typedef {DomainsSeedBase & { version: string, domains: DomainSeed[] }} DomainsSeedFull */
/** @typedef {InstitutionsSeedBase & { institutions: InstitutionSeed[] }} InstitutionsSeedFull */
/** @typedef {FederationSeedBase & { regions: Array<RegionSeed & { provinces: ProvinceSeed[] }> }} FederationSeedFull */

/**
 * يتحقّق أن القوائم الجوهرية موجودة في البذرة قبل التوليد، ويفشل بخطأ مُسمّى
 * لا بانهيار غامض عند أول قراءة. البديل — التسامح الصامت — يُنتج سجلات ناقصة
 * تمرّ في CI وهي كاذبة.
 * @param {unknown} value
 * @param {string} label
 * @returns {void}
 */
function assertSeedList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    console.error(`❌ بذرة ناقصة: القائمة \`${label}\` غائبة أو فارغة.`);
    console.error('   العلاج: شغّل node scripts/build-seed.mjs ثم npm run validate:seed');
    process.exit(1);
  }
}

/**
 * يقرأ ملف بذرة YAML من مجلد seed ويُحلّله.
 * @param {string} f - اسم الملف داخل seed/
 * @returns {unknown} ناتج التحليل الخام، يُصرَّح بنوعه عند نقطة الاستخدام
 */
const load = (f) => YAML.parse(fs.readFileSync(path.join(ROOT, 'seed', f), 'utf8'));

const domainsRaw = /** @type {DomainsSeedFull} */ (load('domains.yaml'));
const instsRaw = /** @type {InstitutionsSeedFull} */ (load('institutions.yaml'));
const fedRaw = /** @type {FederationSeedFull} */ (load('federation.yaml'));

assertSeedList(domainsRaw.domains, 'domains');
assertSeedList(instsRaw.institutions, 'institutions');
assertSeedList(fedRaw.regions, 'regions');
for (const region of fedRaw.regions)
  assertSeedList(region.provinces, `regions/${region.id}/provinces`);

const domains = domainsRaw;
const insts = instsRaw;
const fed = fedRaw;

/**
 * يُحوّل قيمة إلى نصّ YAML مُقتبَس، مع تهريب الشرطة المائلة العكسية والتنصيص.
 * @param {unknown} s
 * @returns {string}
 */
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const STAMP = [
  '# ⚠️ ملف مولّد آلياً. لا تحرّره يدوياً.',
  '# المصدر: seed/*.yaml — المولّد: scripts/generate-registries.mjs',
  '# أي تحرير يدوي سيسقط في فحص CI عبر: node scripts/generate-registries.mjs --check',
];

// ═══ docs/DOMAIN_REGISTRY.yaml ═══
function domainRegistry() {
  const L = [...STAMP];
  L.push('# السجل المركزي للمجالات');
  L.push(`version: ${q(domains.version)}`);
  L.push(`source: ${q('seed/domains.yaml')}`);
  L.push(`count: ${domains.count}`);
  L.push('domains:');
  for (const d of domains.domains) {
    L.push(`  - id: ${q(d.id)}`);
    L.push(`    name: ${q(d.name_ar)}`);
    L.push(`    path: ${q(d.path)}`);
    L.push(`    layers: [${d.layers.join(', ')}]`);
    L.push(`    status: ${q(d.status)}`);
    L.push(`    needs_ratification: ${d.needs_ratification}`);
  }
  return L.join('\n') + '\n';
}

// ═══ docs/STATE_TREE_CATALOG.md ═══
function stateTreeCatalog() {
  const L = [];
  L.push('# فهرس شجرة الدولة الرقمية');
  L.push('');
  L.push('> ⚠️ ملف مولّد آلياً من `seed/*.yaml` بواسطة `scripts/generate-registries.mjs`.');
  L.push('> لا تحرّره يدوياً؛ حرّر البذرة ثم أعد التوليد.');
  L.push('');
  L.push('## الأعداد المعتمدة');
  L.push('');
  L.push('| المستوى | العدد | المصدر |');
  L.push('| --- | --- | --- |');
  L.push(`| الأقاليم | ${fed.counts.regions} | \`seed/federation.yaml\` |`);
  L.push(`| الولايات | ${fed.counts.provinces} | \`seed/federation.yaml\` |`);
  L.push(`| البلديات | ${fed.counts.municipalities} | \`seed/federation.yaml\` |`);
  L.push(`| المجالات | ${domains.count} | \`seed/domains.yaml\` |`);
  L.push(`| المؤسسات | ${insts.count} | \`seed/institutions.yaml\` |`);
  L.push('');
  L.push('## عيوب بنيوية مسجّلة');
  L.push('');
  L.push(
    `- هوية مزدوجة في ${fed.defects.split_identity_provinces} ولاية و${fed.defects.split_identity_regions} إقليماً: المجلد الرقمي يحمل الأبناء والمجلد الاسمي يحمل ملفات العقدة. المسار المعتمد هو \`canonical_path\`.`,
  );
  L.push('');
  L.push('## المجالات');
  L.push('');
  L.push('| # | المعرّف | الاسم | المسار | الطبقات | الحالة | مصادقة مطلوبة |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const d of domains.domains) {
    L.push(
      `| ${d.number} | \`${d.id}\` | ${d.name_ar} | \`${d.path}\` | ${d.layers.length} | ${d.status} | ${d.needs_ratification ? 'نعم' : 'لا'} |`,
    );
  }
  L.push('');
  L.push('## الأقاليم والولايات');
  L.push('');
  L.push('| الإقليم | الاسم | عدد الولايات | عدد البلديات |');
  L.push('| --- | --- | --- | --- |');
  for (const r of fed.regions) {
    const mun = r.provinces.reduce(
      (/** @type {number} */ a, /** @type {ProvinceSeed} */ p) => a + p.municipality_count,
      0,
    );
    L.push(`| \`${r.id}\` | ${r.name_ar} | ${r.provinces.length} | ${mun} |`);
  }
  L.push('');
  return L.join('\n');
}

// ═══ institutions/INSTITUTION_INDEX.md ═══
function institutionIndex() {
  const L = [];
  L.push('# فهرس المؤسسات');
  L.push('');
  L.push(
    '> ⚠️ ملف مولّد آلياً من `seed/institutions.yaml` بواسطة `scripts/generate-registries.mjs`.',
  );
  L.push('');
  L.push(`عدد المؤسسات المعرفة: ${insts.count}`);
  L.push('');
  L.push('| # | الاسم | المسار | الحالة |');
  L.push('| --- | --- | --- | --- |');
  for (const it of insts.institutions) {
    L.push(`| ${it.id} | ${it.name_ar} | \`${it.path}/\` | ${it.status} |`);
  }
  L.push('');
  return L.join('\n');
}

// الأهداف كصفوف ثابتة الطول: [المسار النسبي، المحتوى المولّد]. الإعلان الصريح
// هو ما يضمن أن التفكيك في الحلقة يُنتج نصّين مؤكدين لا احتمالين.
/** @type {Array<[string, string]>} */
const targets = [
  ['docs/DOMAIN_REGISTRY.yaml', domainRegistry()],
  ['docs/STATE_TREE_CATALOG.md', stateTreeCatalog()],
  ['institutions/INSTITUTION_INDEX.md', institutionIndex()],
];

// ═══ فحص خلوّ الأسماء من نص قالبي ═══
const TEMPLATE_PATTERNS = [/^#/m, /^الحالة:/m, /^الغرض:/m, /domain name ar/, /هيكل تأسيسي/];
/** @type {string[]} */
const nameLeaks = [];
for (const d of domains.domains) {
  for (const p of TEMPLATE_PATTERNS) if (p.test(d.name_ar)) nameLeaks.push(`${d.id}: ${p}`);
}
for (const it of insts.institutions) {
  for (const p of TEMPLATE_PATTERNS) if (p.test(it.name_ar)) nameLeaks.push(`${it.id}: ${p}`);
}

console.log(`═══ توليد السجلات (M1.03)${CHECK ? ' — وضع الفحص' : ''} ═══`);
let drift = 0;
for (const [rel, content] of targets) {
  const abs = path.join(ROOT, rel);
  if (CHECK) {
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    const same = current === content;
    if (!same) drift += 1;
    console.log(`${same ? '✅' : '❌'} ${rel}${same ? '' : ' — مختلف عن ناتج البذرة'}`);
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    console.log(`✅ ${rel} (${content.split('\n').length} سطر)`);
  }
}
console.log(`نص قالبي في حقول الأسماء: ${nameLeaks.length}`);

if (nameLeaks.length > 0) {
  console.error('❌ تسرّب نص قالبي:');
  for (const l of nameLeaks) console.error('  - ' + l);
  process.exit(1);
}
if (CHECK && drift > 0) {
  console.error(
    `\n❌ ${drift} ملف مشتق لا يطابق البذرة. أعد التوليد بـ: node scripts/generate-registries.mjs`,
  );
  process.exit(1);
}
console.log(CHECK ? '\n✅ كل السجلات المشتقة مطابقة للبذرة.' : '\n✅ تم توليد السجلات من البذرة.');
