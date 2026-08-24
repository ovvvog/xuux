import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadCapabilityCatalog,
  isForbidden,
  partitionCapabilities,
} from '../../src/identity/capability-catalog.mjs';

// الكتالوج بياناتٌ يتحقّق منها مخطَّط، فاختباره يجب أن يجرّب **بياناتٍ فاسدة**
// لا أن يقرأ الملف الصحيح ويطمئن: قيمة الطبقة الصلبة في أنها ترفض، لا في أنها
// تُحمّل. ومجلدٌ مؤقّت بلا `schemas/` يُقاس بمخطَّط المشروع نفسه (نفس قاعدة
// محمّل السياسات) كي لا يكتب الاختبار مخطَّطاً متساهلاً يُثبت به ما يشتهي.
/**
 * @param {string} body
 * @returns {string}
 */
function writeCatalog(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-'));
  fs.writeFileSync(path.join(dir, 'capabilities.yaml'), body, 'utf8');
  return dir;
}

test('loads the shipped catalog and freezes it', () => {
  const catalog = loadCapabilityCatalog();
  assert.equal(catalog.version >= 1, true);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(catalog.forbidden.size > 0, true, 'كتالوج بلا محرَّمات يعني السماح بكل شيء');
  assert.equal(isForbidden(catalog, 'sovereign:root'), true);
  assert.equal(isForbidden(catalog, 'action:read-registry'), false);
  for (const [id, entry] of catalog.forbidden) {
    assert.equal(entry.id, id);
    assert.equal(entry.reason.length >= 8, true, `المحرَّم ${id} بلا سبب مقروء`);
  }
  for (const [id, entry] of catalog.grantable) {
    assert.equal(entry.maxDurationSeconds > 0, true, `القدرة ${id} بلا سقف مدة`);
    assert.equal(entry.grantorRoles.size > 0, true, `القدرة ${id} بلا مانحٍ معلن`);
  }
});

test('every grantable capability names roles that exist in roles.yaml', () => {
  const catalog = loadCapabilityCatalog();
  const roles = fs.readFileSync(new URL('../../config/roles.yaml', import.meta.url), 'utf8');
  for (const entry of catalog.grantable.values()) {
    for (const role of entry.grantorRoles) {
      assert.equal(
        roles.includes(role),
        true,
        `القدرة ${entry.id} تسمّي مانحاً غير موجود في الأدوار: ${role}`,
      );
    }
  }
});

test('a missing file fails closed instead of loading an empty catalog', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-empty-'));
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CONFIG_MISSING/);
});

test('schema violations are rejected with every problem named', () => {
  const dir = writeCatalog(
    ['version: 1', 'owner: crown', 'forbidden: []', 'grantable: []'].join('\n') + '\n',
  );
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CONFIG_INVALID/);

  const bad = writeCatalog(
    [
      'version: 1',
      'owner: crown',
      'forbidden:',
      '  - id: sovereign:root',
      '    reason: صلاحية مطلقة لا تُمنح',
      'grantable:',
      '  - id: action:read-registry',
      '    maxDurationSeconds: 0',
      '    grantorRoles: [role:king]',
      '    reason: قراءة السجل للتشخيص',
    ].join('\n') + '\n',
  );
  assert.throws(() => loadCapabilityCatalog({ dir: bad }), /CAPABILITY_CONFIG_INVALID/);
});

test('a capability declared forbidden and grantable at once is incoherent', () => {
  const dir = writeCatalog(
    [
      'version: 1',
      'owner: crown',
      'forbidden:',
      '  - id: key:export',
      '    reason: تصدير المفاتيح يُفقد جذر الثقة',
      'grantable:',
      '  - id: key:export',
      '    maxDurationSeconds: 60',
      '    grantorRoles: [role:king]',
      '    reason: محاولة فتح باب خلفي',
    ].join('\n') + '\n',
  );
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CATALOG_INCOHERENT/);
});

test('a role that carries a forbidden capability is incoherent', () => {
  const dir = writeCatalog(
    [
      'version: 1',
      'owner: crown',
      'forbidden:',
      '  - id: policy:self-modify',
      '    reason: تعديل السياسة على النفس ينقض الفصل',
      'grantable:',
      '  - id: action:read-memory',
      '    maxDurationSeconds: 60',
      '    grantorRoles: [role:king]',
      '    reason: قراءة الذاكرة للتشخيص',
    ].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'roles.yaml'),
    ['version: 1', 'roles:', '  - id: role:rogue', '    capabilities: [policy:self-modify]'].join(
      '\n',
    ) + '\n',
    'utf8',
  );
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CATALOG_INCOHERENT/);
});

test('unparsable yaml is named as unparsable, not as invalid', () => {
  const dir = writeCatalog('version: 1\n  owner: [crown\n');
  assert.throws(() => loadCapabilityCatalog({ dir }), /CAPABILITY_CONFIG_UNPARSABLE/);
});

test('partitionCapabilities reports every forbidden entry, not the first', () => {
  const catalog = loadCapabilityCatalog();
  const { allowed, forbidden } = partitionCapabilities(catalog, [
    'action:read-memory',
    'sovereign:root',
    'key:export',
  ]);
  assert.deepEqual(allowed, ['action:read-memory']);
  assert.deepEqual(forbidden, ['sovereign:root', 'key:export']);
});
