// مُحمّل السجلات — M1.04
// يقرأ البذرة، يبني السجل في الذاكرة، ويتحقق من الترابط المرجعي.
// ملاحظة انحراف موثّقة: خارطة الطريق نصّت على src/registry/loader.ts، والمنجز .mjs
// لأن الكود الحقيقي في هذا المستودع يُنفّذ ويُختبر بـ node:test بلا خطوة بناء (قرار M0).
// يُعاد النظر في التحويل إلى TypeScript في M2.01 عند إدخال خطوة البناء.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/**
 * المجال كما تظهر خصائصه الأساسية في السجل المحمّل.
 * @typedef {Readonly<{id: string, number: number, name_ar: string, path: string, layers: readonly string[], status: string, needs_ratification: boolean, provenance: Readonly<{source: string, ref: string}>}>} RegistryDomain
 */
/**
 * المؤسسة المحمّلة؛ تبقى الحقول الإضافية من البذرة محفوظة كما وردت.
 * @typedef {Readonly<{id: string, name_ar: string, path: string} & Record<string, unknown>>} RegistryInstitution
 */
/** @typedef {Readonly<{id: string, number: number, name_ar: string, canonical_path: string, legacy_data_path: string | null, province_ids: readonly string[]}>} RegistryRegion */
/** @typedef {Readonly<{id: string, name_ar: string, region_id: string, canonical_path: string, legacy_data_path: string | null, municipality_ids: readonly string[]}>} RegistryProvince */
/** @typedef {Readonly<{id: string, local_id: string, province_id: string, region_id: string, canonical_path: string}>} RegistryMunicipality */
/** @typedef {Readonly<{domains: number, institutions: number, regions: number, provinces: number, municipalities: number}>} RegistryCounts */
/**
 * السجل الناتج بعد بناء العلاقات المرجعية بين البذور.
 * @typedef {Readonly<{domains: Map<string, RegistryDomain>, institutions: Map<string, RegistryInstitution>, regions: Map<string, RegistryRegion>, provinces: Map<string, RegistryProvince>, municipalities: Map<string, RegistryMunicipality>, danglingRefs: readonly string[], violations: readonly string[], counts: RegistryCounts, defects: Readonly<Record<string, unknown>>, domainsNeedingRatification: readonly string[]}>} Registry
 */
/** @typedef {{id: string, number: number, name_ar: string, path: string, layers: string[], status: string, needs_ratification: boolean, provenance: {source: string, ref: string}}} DomainSeed */
/** @typedef {{id: string, name_ar: string, path: string} & Record<string, unknown>} InstitutionSeed */
/** @typedef {{id: string, name_ar: string, canonical_path: string, legacy_data_path?: string | null, municipality_ids?: string[], municipality_count: number}} ProvinceSeed */
/** @typedef {{id: string, number: number, name_ar: string, canonical_path: string, legacy_data_path?: string | null, provinces?: ProvinceSeed[]}} RegionSeed */
/** @typedef {{domains?: DomainSeed[], count: number}} DomainsSeed */
/** @typedef {{institutions?: InstitutionSeed[], count: number}} InstitutionsSeed */
/** @typedef {{counts: {regions: number, provinces: number, municipalities: number}, regions?: RegionSeed[], defects: Record<string, unknown>}} FederationSeed */
/** @typedef {{seedDir?: string, strict?: boolean}} RegistryLoadOptions */

/** خطأ ترابط مرجعي في البذرة. */
export class RegistryIntegrityError extends Error {
  /**
   * @param {string[]} violations - المخالفات التي اكتشفت أثناء البناء
   */
  constructor(violations) {
    super(`فشل الترابط المرجعي بـ ${violations.length} مخالفة`);
    this.name = 'RegistryIntegrityError';
    /** @type {string[]} */
    this.violations = violations;
  }
}

/**
 * يقرأ ملف بذرة واحدًا ويترك التحقق البنيوي لمسار بناء السجل.
 * @param {string} seedDir - المجلد الذي يحتوي ملفات البذرة
 * @param {string} file - اسم ملف البذرة المطلوب
 * @returns {unknown} محتوى YAML قبل تثبيت شكله المتوقع
 */
function readSeed(seedDir, file) {
  const abs = path.join(seedDir, file);
  if (!fs.existsSync(abs)) throw new Error(`ملف بذرة مفقود: ${file}`);
  return YAML.parse(fs.readFileSync(abs, 'utf8'));
}

/**
 * يبني السجل في الذاكرة من البذرة.
 * @param {RegistryLoadOptions} [opts={}] خيارات موقع البذرة وصرامة الترابط
 * @returns {Registry} السجل المكتمل والعلاقات التي استخلصت منه
 */
export function loadRegistry(opts = {}) {
  const seedDir = opts.seedDir ?? path.join(REPO_ROOT, 'seed');
  const strict = opts.strict ?? true;
  /** @type {string[]} */
  const violations = [];
  /** @param {string} m - وصف المخالفة المكتشفة */
  const v = (m) => violations.push(m);

  const rawDomains = /** @type {DomainsSeed} */ (readSeed(seedDir, 'domains.yaml'));
  const rawInsts = /** @type {InstitutionsSeed} */ (readSeed(seedDir, 'institutions.yaml'));
  const rawFed = /** @type {FederationSeed} */ (readSeed(seedDir, 'federation.yaml'));

  // ── المجالات ──
  /** @type {Map<string, RegistryDomain>} */
  const domains = new Map();
  /** @type {Set<string>} */
  const domainPaths = new Set();
  for (const d of rawDomains.domains ?? []) {
    if (domains.has(d.id)) v(`مجال مكرر: ${d.id}`);
    if (domainPaths.has(d.path)) v(`مسار مجال مكرر: ${d.path}`);
    domainPaths.add(d.path);
    domains.set(d.id, Object.freeze({ ...d, layers: Object.freeze([...d.layers]) }));
  }
  if (rawDomains.count !== domains.size) {
    v(`عدّاد المجالات ${rawDomains.count} لا يساوي ${domains.size}`);
  }

  // ── المؤسسات ──
  /** @type {Map<string, RegistryInstitution>} */
  const institutions = new Map();
  /** @type {Set<string>} */
  const instPaths = new Set();
  for (const it of rawInsts.institutions ?? []) {
    if (institutions.has(it.id)) v(`مؤسسة مكررة: ${it.id}`);
    if (instPaths.has(it.path)) v(`مسار مؤسسة مكرر: ${it.path}`);
    instPaths.add(it.path);
    institutions.set(it.id, Object.freeze({ ...it }));
  }
  if (rawInsts.count !== institutions.size) {
    v(`عدّاد المؤسسات ${rawInsts.count} لا يساوي ${institutions.size}`);
  }

  // ── الفدرالية ──
  /** @type {Map<string, RegistryRegion>} */
  const regions = new Map();
  /** @type {Map<string, RegistryProvince>} */
  const provinces = new Map();
  /** @type {Map<string, RegistryMunicipality>} */
  const municipalities = new Map();

  for (const r of rawFed.regions ?? []) {
    if (regions.has(r.id)) v(`إقليم مكرر: ${r.id}`);
    const provIds = [];
    for (const p of r.provinces ?? []) {
      if (provinces.has(p.id)) v(`ولاية مكررة: ${p.id}`);
      // الترابط: مسار الولاية يجب أن ينتمي لمسار الإقليم
      if (!p.canonical_path.startsWith(`${r.canonical_path}/provinces/`)) {
        v(`الولاية ${p.id} لا تنتمي لمسار الإقليم ${r.id}`);
      }
      const munIds = [];
      for (const m of p.municipality_ids ?? []) {
        const key = `${p.id}/${m}`;
        if (municipalities.has(key)) v(`بلدية مكررة: ${key}`);
        municipalities.set(
          key,
          Object.freeze({
            id: key,
            local_id: m,
            province_id: p.id,
            region_id: r.id,
            canonical_path: `${p.canonical_path}/municipalities/${m}`,
          }),
        );
        munIds.push(key);
      }
      if (p.municipality_count !== munIds.length) {
        v(`الولاية ${p.id}: عدّاد البلديات ${p.municipality_count} لا يساوي ${munIds.length}`);
      }
      provinces.set(
        p.id,
        Object.freeze({
          id: p.id,
          name_ar: p.name_ar,
          region_id: r.id,
          canonical_path: p.canonical_path,
          legacy_data_path: p.legacy_data_path ?? null,
          municipality_ids: Object.freeze(munIds),
        }),
      );
      provIds.push(p.id);
    }
    regions.set(
      r.id,
      Object.freeze({
        id: r.id,
        number: r.number,
        name_ar: r.name_ar,
        canonical_path: r.canonical_path,
        legacy_data_path: r.legacy_data_path ?? null,
        province_ids: Object.freeze(provIds),
      }),
    );
  }

  if (rawFed.counts.regions !== regions.size) {
    v(`عدّاد الأقاليم ${rawFed.counts.regions} لا يساوي ${regions.size}`);
  }
  if (rawFed.counts.provinces !== provinces.size) {
    v(`عدّاد الولايات ${rawFed.counts.provinces} لا يساوي ${provinces.size}`);
  }
  if (rawFed.counts.municipalities !== municipalities.size) {
    v(`عدّاد البلديات ${rawFed.counts.municipalities} لا يساوي ${municipalities.size}`);
  }

  // ── مراجع معلّقة: كل أب مذكور في الأبناء موجود فعلاً ──
  /** @type {string[]} */
  const dangling = [];
  for (const p of provinces.values()) {
    if (!regions.has(p.region_id))
      dangling.push(`الولاية ${p.id} → إقليم غير موجود ${p.region_id}`);
  }
  for (const m of municipalities.values()) {
    if (!provinces.has(m.province_id)) dangling.push(`البلدية ${m.id} → ولاية غير موجودة`);
    if (!regions.has(m.region_id)) dangling.push(`البلدية ${m.id} → إقليم غير موجود`);
  }
  for (const d of dangling) v(d);

  const registry = Object.freeze({
    domains,
    institutions,
    regions,
    provinces,
    municipalities,
    danglingRefs: Object.freeze(dangling),
    violations: Object.freeze(violations),
    counts: Object.freeze({
      domains: domains.size,
      institutions: institutions.size,
      regions: regions.size,
      provinces: provinces.size,
      municipalities: municipalities.size,
    }),
    defects: Object.freeze({ ...rawFed.defects }),
    domainsNeedingRatification: Object.freeze(
      [...domains.values()].filter((d) => d.needs_ratification).map((d) => d.id),
    ),
  });

  if (strict && violations.length > 0) throw new RegistryIntegrityError(violations);
  return registry;
}

/**
 * يعيد ملخّصاً نصياً للسجل.
 * @param {Registry} registry - السجل المراد تلخيص أعداده
 * @returns {string} ملخص الأعداد والمراجع المعلقة
 */
export function summarize(registry) {
  const c = registry.counts;
  return [
    `المجالات: ${c.domains}`,
    `المؤسسات: ${c.institutions}`,
    `الأقاليم: ${c.regions}`,
    `الولايات: ${c.provinces}`,
    `البلديات: ${c.municipalities}`,
    `مراجع معلّقة: ${registry.danglingRefs.length}`,
  ].join(' | ');
}

export default { loadRegistry, summarize, RegistryIntegrityError, REPO_ROOT };
