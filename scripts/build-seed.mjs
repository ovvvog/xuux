#!/usr/bin/env node
// مولّد البذرة — M1.02
// الغرض: استخلاص بيانات البذرة من المصادر الوثائقية الحقيقية في المستودع،
// لا من الافتراض ولا من التوليد العشوائي. كل حقل يحمل مصدره (provenance).
//
// المصادر:
//   1) document-1-state-definition-5000-lines.md → 103 باباً مؤسسياً بأسماء حقيقية
//   2) docs/FUTURE_SCIENCE_REGISTRY.md            → 17 علماً مستقبلياً بأسماء حقيقية
//   3) document-3-launch-phases-5000-lines.md     → 100 مرحلة إطلاق بأسماء حقيقية
//   4) institutions/INSTITUTION_INDEX.md          → 143 مؤسسة بأسماء حقيقية ومسارات
//   5) الشجرة الفعلية federation/regions/**       → 16 إقليماً / 128 ولاية / 1536 بلدية
//
// الاستخدام: node scripts/build-seed.mjs --src <جذر الشجرة> --out <مجلد seed>

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
/**
 * يقرأ وسيط سطر أوامر بصيغة `--name value`.
 * @param {string} n - اسم الوسيط مع الشرطتين
 * @param {string} d - القيمة الافتراضية إن غاب الوسيط أو جاء بلا قيمة
 * @returns {string}
 */
const getArg = (n, d) => {
  const i = args.indexOf(n);
  const value = args[i + 1];
  return i !== -1 && value ? value : d;
};
const SRC = path.resolve(getArg('--src', '.'));
const OUT = path.resolve(getArg('--out', 'seed'));

/**
 * يقرأ ملفاً نصياً نسبةً إلى جذر المصدر.
 * @param {string} rel
 * @returns {string}
 */
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/**
 * يُصفّر رقماً إلى عرض ثابت (001، 012…) لتوليد معرّفات مستقرة الترتيب.
 * @param {number} n
 * @param {number} [w=3] - عدد الخانات
 * @returns {string}
 */
const pad = (n, w = 3) => String(n).padStart(w, '0');

// ── اقتباس YAML آمن: نضع كل نص بين علامتي تنصيص مزدوجتين مع تهريب ما يلزم ──
/**
 * اقتباس YAML آمن.
 * @param {unknown} s
 * @returns {string}
 */
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ═══ 1) أبواب الوثيقة الأولى ═══
function chapters() {
  const text = read('document-1-state-definition-5000-lines.md');
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\d+ \| ## الباب المؤسسي (\d+): (?:الباب \d+: )?(.+?)(?: — .*)?\s*$/);
    // النمط يضمن وجود المجموعتين عند النجاح، والفحص الصريح هو ما يُثبت ذلك
    // للفاحص بدل علامة تأكيد عمياء.
    if (m && m[1] && m[2]) out.push({ n: Number(m[1]), name: m[2].trim() });
  }
  // نستبعد البابين 104 و105 لأنهما بابا خطة ومعايير، لا مجال حكم
  return out.filter((c) => c.n <= 103).sort((a, b) => a.n - b.n);
}

// ═══ 2) العلوم المستقبلية ═══
function futureSciences() {
  const text = read('docs/FUTURE_SCIENCE_REGISTRY.md');
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^## (\d+)\. (.+?)\s*$/);
    if (m && m[1] && m[2]) out.push({ n: Number(m[1]), name: m[2].trim() });
  }
  return out.sort((a, b) => a.n - b.n);
}

// ═══ 3) مراحل الإطلاق ═══
function launchPhases() {
  const text = read('document-3-launch-phases-5000-lines.md');
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\d+ \| ## المرحلة (\d+): (.+?)(?: — .*)?\s*$/);
    if (m && m[1] && m[2]) out.push({ n: Number(m[1]), name: m[2].trim() });
  }
  return out.sort((a, b) => a.n - b.n);
}

// ═══ 4) المؤسسات ═══
function institutions() {
  const text = read('institutions/INSTITUTION_INDEX.md');
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d{3})\. (.+?) — (institutions\/.+?)\/?\s*$/);
    if (m && m[1] && m[2] && m[3])
      out.push({ n: Number(m[1]), name: m[2].trim(), dir: m[3].trim() });
  }
  return out.sort((a, b) => a.n - b.n);
}

// ═══ 5) الفدرالية من الشجرة الفعلية ═══
function federationFacts() {
  const base = path.join(SRC, 'federation/regions');
  const regionIds = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{3}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const regions = regionIds.map((rid) => {
    const provDir = path.join(base, rid, 'provinces');
    const entries = fs.existsSync(provDir)
      ? fs.readdirSync(provDir, { withFileTypes: true }).filter((e) => e.isDirectory())
      : [];
    // الولاية الحقيقية هي المعرّف الرقمي NNN-NN؛ ومجلد «ولاية-NNN-NN» نسخة اسمية تحمل ملفات الولاية
    const numeric = entries
      .map((e) => e.name)
      .filter((n) => /^\d{3}-\d{2}$/.test(n))
      .sort();
    const named = entries
      .map((e) => e.name)
      .filter((n) => n.startsWith('ولاية-'))
      .sort();
    const provinces = numeric.map((pid) => {
      const munDir = path.join(provDir, pid, 'municipalities');
      const mun = fs.existsSync(munDir)
        ? fs
            .readdirSync(munDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort()
        : [];
      return { id: pid, municipalities: mun, hasNamedTwin: named.includes(`ولاية-${pid}`) };
    });
    const namedRegionDir = fs
      .readdirSync(path.join(base, rid), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('الإقليم'))
      .map((e) => e.name)[0];
    return { id: rid, provinces, namedRegionDir };
  });
  return regions;
}

// ═══ بناء قائمة المجالات: 125 اسماً حقيقياً بلا تكرار ═══
function buildDomains() {
  const chs = chapters();
  const fs17 = futureSciences();
  const phases = launchPhases();
  /** @type {Set<string>} */
  const seen = new Set();
  /**
   * مجال في طور البناء: الاسم ومصدره الوثائقي والمرجع داخل المصدر.
   * @typedef {{ name: string, source: string, ref: string }} DomainDraft
   */
  /** @type {DomainDraft[]} */
  const domains = [];
  /**
   * يُضيف مجالاً إن لم يكن اسمه مستخدَماً، بعد تطبيع المسافات.
   * @param {string} name
   * @param {string} source - ملف المصدر الوثائقي
   * @param {string} ref - المرجع داخل المصدر
   * @returns {boolean} هل أُضيف فعلاً
   */
  const push = (name, source, ref) => {
    const key = name.replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    domains.push({ name: key, source, ref });
    return true;
  };
  for (const c of chs)
    push(c.name, 'document-1-state-definition-5000-lines.md', `الباب المؤسسي ${c.n}`);
  for (const s of fs17) push(s.name, 'docs/FUTURE_SCIENCE_REGISTRY.md', `البند ${pad(s.n, 2)}`);
  for (const p of phases) {
    if (domains.length >= 125) break;
    push(p.name, 'document-3-launch-phases-5000-lines.md', `المرحلة ${pad(p.n)}`);
  }
  if (domains.length < 125) {
    throw new Error(`المصادر الوثائقية أعطت ${domains.length} اسماً فريداً فقط، والمطلوب 125.`);
  }
  return domains.slice(0, 125);
}

const LAYERS = ['governance', 'operations', 'education', 'research', 'registry', 'safety'];

// ═══ كتابة seed/domains.yaml ═══
function writeDomains() {
  const domains = buildDomains();
  const L = [];
  L.push('# بذرة المجالات — المصدر الوحيد للحقيقة لأسماء المجالات ومعرّفاتها.');
  L.push('# مولّدة بـ scripts/build-seed.mjs من المصادر الوثائقية المذكورة في provenance.');
  L.push('# لا يجوز تعديل السجلات المشتقة يدوياً؛ تُولّد من هذا الملف.');
  L.push(`schema: ${q('seed/schemas/domains.schema.json')}`);
  L.push(`version: ${q('1.0.0')}`);
  L.push(`generated_by: ${q('scripts/build-seed.mjs')}`);
  L.push(`count: ${domains.length}`);
  L.push('domains:');
  domains.forEach((d, i) => {
    const num = i + 1;
    const id = `${pad(num)}-domain`;
    L.push(`  - id: ${q(id)}`);
    L.push(`    number: ${num}`);
    L.push(`    name_ar: ${q(d.name)}`);
    L.push(`    path: ${q(`civilization/${id}`)}`);
    L.push(`    layers: [${LAYERS.join(', ')}]`);
    L.push(`    status: ${q('planned')}`);
    // الأسماء المأخوذة من وثيقة مراحل الإطلاق هي خطوات عملية لا أبواب حكم؛
    // تُعلَم لطلب المصادقة السيادية قبل تثبيتها كمجال دائم.
    L.push(`    needs_ratification: ${d.source.startsWith('document-3')}`);
    L.push('    provenance:');
    L.push(`      source: ${q(d.source)}`);
    L.push(`      ref: ${q(d.ref)}`);
  });
  fs.writeFileSync(path.join(OUT, 'domains.yaml'), L.join('\n') + '\n', 'utf8');
  return domains.length;
}

// ═══ كتابة seed/institutions.yaml ═══
function writeInstitutions() {
  const insts = institutions();
  const L = [];
  L.push('# بذرة المؤسسات — 143 مؤسسة بأسماء حقيقية.');
  L.push('# المصدر: institutions/INSTITUTION_INDEX.md، وتحقّقنا من تطابق كل اسم مع مجلد فعلي.');
  L.push(`schema: ${q('seed/schemas/institutions.schema.json')}`);
  L.push(`version: ${q('1.0.0')}`);
  L.push(`generated_by: ${q('scripts/build-seed.mjs')}`);
  L.push(`count: ${insts.length}`);
  L.push('institutions:');
  for (const it of insts) {
    const exists = fs.existsSync(path.join(SRC, it.dir));
    L.push(`  - id: ${q(pad(it.n))}`);
    L.push(`    number: ${it.n}`);
    L.push(`    name_ar: ${q(it.name)}`);
    L.push(`    path: ${q(it.dir)}`);
    L.push(`    path_verified: ${exists}`);
    L.push(`    status: ${q('planned')}`);
    L.push('    provenance:');
    L.push(`      source: ${q('institutions/INSTITUTION_INDEX.md')}`);
    L.push(`      ref: ${q(`السطر ${pad(it.n)}`)}`);
  }
  fs.writeFileSync(path.join(OUT, 'institutions.yaml'), L.join('\n') + '\n', 'utf8');
  const unverified = insts.filter((it) => !fs.existsSync(path.join(SRC, it.dir))).length;
  return { count: insts.length, unverified };
}

// ═══ كتابة seed/federation.yaml ═══
function writeFederation() {
  const regions = federationFacts();
  const provinceCount = regions.reduce((a, r) => a + r.provinces.length, 0);
  const munCount = regions.reduce(
    (a, r) => a + r.provinces.reduce((b, p) => b + p.municipalities.length, 0),
    0,
  );
  const perRegion = [...new Set(regions.map((r) => r.provinces.length))];
  const perProvince = [
    ...new Set(regions.flatMap((r) => r.provinces.map((p) => p.municipalities.length))),
  ];
  const twins = regions.reduce((a, r) => a + r.provinces.filter((p) => p.hasNamedTwin).length, 0);

  const L = [];
  L.push('# بذرة الفدرالية — الأرقام مستخلصة من الشجرة الفعلية لا من الأرقام المعلنة.');
  L.push('# عيب بنيوي مسجّل: كل عقدة إقليم/ولاية موزّعة على مجلدين، رقمي يحمل الأبناء');
  L.push('# واسمي يحمل ملفات العقدة نفسها. لذلك لا يوجد مسار قانوني واحد لأي عقدة.');
  L.push('# البذرة تثبّت المسار القانوني (canonical_path) وتسجّل المسار الاسمي كـ legacy.');
  L.push(`schema: ${q('seed/schemas/federation.schema.json')}`);
  L.push(`version: ${q('1.0.0')}`);
  L.push(`generated_by: ${q('scripts/build-seed.mjs')}`);
  L.push('counts:');
  L.push(`  regions: ${regions.length}`);
  L.push(`  provinces: ${provinceCount}`);
  L.push(`  municipalities: ${munCount}`);
  L.push(
    `  provinces_per_region: ${perRegion.length === 1 ? perRegion[0] : q('غير منتظم: ' + perRegion.join('،'))}`,
  );
  L.push(
    `  municipalities_per_province: ${perProvince.length === 1 ? perProvince[0] : q('غير منتظم: ' + perProvince.join('،'))}`,
  );
  L.push('defects:');
  L.push(`  split_identity_provinces: ${twins}`);
  L.push(`  split_identity_regions: ${regions.filter((r) => r.namedRegionDir).length}`);
  L.push('regions:');
  for (const r of regions) {
    L.push(`  - id: ${q(`R${r.id}`)}`);
    L.push(`    number: ${Number(r.id)}`);
    L.push(`    name_ar: ${q(`الإقليم الفدرالي ${r.id}`)}`);
    L.push(`    canonical_path: ${q(`federation/regions/${r.id}`)}`);
    if (r.namedRegionDir) {
      L.push(`    legacy_data_path: ${q(`federation/regions/${r.id}/${r.namedRegionDir}`)}`);
    }
    L.push('    provinces:');
    for (const p of r.provinces) {
      L.push(`      - id: ${q(`P${p.id}`)}`);
      L.push(`        name_ar: ${q(`ولاية ${p.id}`)}`);
      L.push(`        canonical_path: ${q(`federation/regions/${r.id}/provinces/${p.id}`)}`);
      if (p.hasNamedTwin) {
        L.push(
          `        legacy_data_path: ${q(`federation/regions/${r.id}/provinces/ولاية-${p.id}`)}`,
        );
      }
      L.push(`        municipality_count: ${p.municipalities.length}`);
      L.push(`        municipality_ids: [${p.municipalities.map((m) => q(m)).join(', ')}]`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'federation.yaml'), L.join('\n') + '\n', 'utf8');
  return { regions: regions.length, provinces: provinceCount, municipalities: munCount, twins };
}

fs.mkdirSync(OUT, { recursive: true });
console.log('═══ بناء البذرة (M1.02) ═══');
const d = writeDomains();
console.log(`seed/domains.yaml      → ${d} مجالاً باسم حقيقي`);
const i = writeInstitutions();
console.log(`seed/institutions.yaml → ${i.count} مؤسسة (غير متحقّق منها: ${i.unverified})`);
const f = writeFederation();
console.log(
  `seed/federation.yaml   → ${f.regions} إقليماً / ${f.provinces} ولاية / ${f.municipalities} بلدية`,
);
console.log(`عيب الهوية المزدوجة في الولايات: ${f.twins}`);
