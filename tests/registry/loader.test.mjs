// اختبار مُحمّل السجلات — M1.04
// معيار القبول: 16 إقليماً / 128 ولاية / 1536 بلدية / 125 مجالاً / 143 مؤسسة، وصفر مرجع معلّق.
// ملاحظة: الأرقام هنا مستخلصة من الشجرة الفعلية. خارطة الطريق كانت تعلن 256 ولاية،
// وثبت أن 256 هو عدد المجلدات لا عدد الولايات، لأن كل ولاية موزّعة على مجلدين.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRegistry, summarize, RegistryIntegrityError } from '../../src/registry/loader.mjs';

const registry = loadRegistry();

test('يبني السجل بالأعداد الحقيقية المستخلصة من الشجرة', () => {
  assert.equal(registry.counts.regions, 16);
  assert.equal(registry.counts.provinces, 128);
  assert.equal(registry.counts.municipalities, 1536);
  assert.equal(registry.counts.domains, 125);
  assert.equal(registry.counts.institutions, 143);
});

test('لا مراجع معلّقة ولا مخالفات ترابط', () => {
  assert.deepEqual([...registry.danglingRefs], []);
  assert.deepEqual([...registry.violations], []);
});

test('كل ولاية تنتمي لإقليم موجود ومسارها ينتمي لمساره', () => {
  for (const p of registry.provinces.values()) {
    const r = registry.regions.get(p.region_id);
    assert.ok(r, `الولاية ${p.id} بلا إقليم`);
    assert.ok(p.canonical_path.startsWith(`${r.canonical_path}/provinces/`));
  }
});

test('كل بلدية تنتمي لولاية وإقليم موجودين', () => {
  for (const m of registry.municipalities.values()) {
    assert.ok(registry.provinces.has(m.province_id));
    assert.ok(registry.regions.has(m.region_id));
  }
});

test('توزيع منتظم: 8 ولايات لكل إقليم و12 بلدية لكل ولاية', () => {
  for (const r of registry.regions.values()) {
    assert.equal(r.province_ids.length, 8, `الإقليم ${r.id}`);
  }
  for (const p of registry.provinces.values()) {
    assert.equal(p.municipality_ids.length, 12, `الولاية ${p.id}`);
  }
});

test('لا نص قالبي في أي حقل اسم', () => {
  const bad = [/^#/, /^الحالة:/, /^الغرض:/, /domain name ar/, /هيكل تأسيسي/];
  const check = (label, name) => {
    for (const p of bad) assert.ok(!p.test(name), `${label}: نص قالبي «${name}»`);
  };
  for (const d of registry.domains.values()) check(d.id, d.name_ar);
  for (const it of registry.institutions.values()) check(it.id, it.name_ar);
  for (const r of registry.regions.values()) check(r.id, r.name_ar);
  for (const p of registry.provinces.values()) check(p.id, p.name_ar);
});

test('معرّفات المجالات متسلسلة ومسارها يطابق معرّفها', () => {
  let n = 0;
  for (const d of registry.domains.values()) {
    n += 1;
    assert.equal(d.number, n);
    assert.equal(d.id, `${String(n).padStart(3, '0')}-domain`);
    assert.equal(d.path, `civilization/${d.id}`);
    assert.equal(d.layers.length, 6);
  }
});

test('عيب الهوية المزدوجة مسجّل ومطابق لعدد الولايات ذات المسار القديم', () => {
  const withLegacy = [...registry.provinces.values()].filter((p) => p.legacy_data_path).length;
  assert.equal(registry.defects.split_identity_provinces, withLegacy);
  assert.equal(withLegacy, 128);
  assert.equal(registry.defects.split_identity_regions, 16);
});

test('المجالات التي تحتاج مصادقة سيادية معلّمة صراحةً', () => {
  assert.ok(registry.domainsNeedingRatification.length > 0);
  for (const id of registry.domainsNeedingRatification) {
    assert.equal(registry.domains.get(id).needs_ratification, true);
  }
});

test('السجل غير قابل للتعديل بعد البناء', () => {
  assert.throws(() => {
    registry.counts.regions = 99;
  }, TypeError);
});

test('يرفع RegistryIntegrityError عند مرجع معلّق في بذرة معطوبة', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
  fs.writeFileSync(
    path.join(tmp, 'domains.yaml'),
    'schema: "x"\nversion: "1.0.0"\ngenerated_by: "t"\ncount: 1\ndomains:\n  - id: "001-domain"\n    number: 1\n    name_ar: "أ"\n    path: "civilization/001-domain"\n    layers: [governance, operations, education, research, registry, safety]\n    status: "planned"\n    needs_ratification: false\n    provenance: {source: "t", ref: "t"}\n',
  );
  fs.writeFileSync(
    path.join(tmp, 'institutions.yaml'),
    'schema: "x"\nversion: "1.0.0"\ngenerated_by: "t"\ncount: 0\ninstitutions: []\n',
  );
  // ولاية مسارها لا ينتمي للإقليم + عدّاد بلديات خاطئ
  fs.writeFileSync(
    path.join(tmp, 'federation.yaml'),
    'schema: "x"\nversion: "1.0.0"\ngenerated_by: "t"\ncounts: {regions: 1, provinces: 1, municipalities: 5, provinces_per_region: 1, municipalities_per_province: 1}\ndefects: {split_identity_provinces: 0, split_identity_regions: 0}\nregions:\n  - id: "R001"\n    number: 1\n    name_ar: "إقليم"\n    canonical_path: "federation/regions/001"\n    provinces:\n      - id: "P999-99"\n        name_ar: "ولاية"\n        canonical_path: "federation/regions/002/provinces/999-99"\n        municipality_count: 9\n        municipality_ids: ["001"]\n',
  );

  assert.throws(() => loadRegistry({ seedDir: tmp }), RegistryIntegrityError);
  const lax = loadRegistry({ seedDir: tmp, strict: false });
  assert.ok(lax.violations.length >= 3);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('يفشل بوضوح عند غياب ملف بذرة', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-empty-'));
  assert.throws(() => loadRegistry({ seedDir: tmp }), /ملف بذرة مفقود/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('summarize يعطي ملخّصاً يحمل الأعداد', () => {
  const s = summarize(registry);
  assert.match(s, /المجالات: 125/);
  assert.match(s, /البلديات: 1536/);
  assert.match(s, /مراجع معلّقة: 0/);
});
