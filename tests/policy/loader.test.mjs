// اختبار محمّل السياسات — M4.02.
//
// لماذا اختبارٌ للمحمّل قبل المحرّك: السياسة صارت بيانات، والبيانات الفاسدة أخطر
// من الكود الفاسد لأنها تمرّ بلا تصريف. فالمقيس هنا أن التحميل **يفشل مغلقاً**
// عند كل صنف من الفساد يمكن أن يقع فعلاً: مخالفة مخطَّط، وفعل في سياسة لا يعرفه
// الكتالوج، ودور لا تعرفه الأدوار، وسياسة نافذة بلا معتمِد، وحصّة مشار إليها
// وغير معلنة. وأن بيانات المشروع نفسها تعبر كل ذلك.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';

import { CONFIG_DIR, loadPolicyBundle } from '../../src/policy/loader.mjs';

/**
 * ينسخ بيانات المشروع إلى مجلد مؤقّت كي يُفسد فيها بندٌ واحد بلا لمس المستودع.
 * @param {(docs: { roles: any, policies: any, threshold: any, quotas: any }) => void} mutate
 * @returns {{ dir: string, cleanup: () => void }}
 */
function withMutatedConfig(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-policy-'));
  cpSync(CONFIG_DIR, dir, { recursive: true });
  const read = (/** @type {string} */ f) => YAML.parse(readFileSync(join(dir, f), 'utf8'));
  const docs = {
    roles: read('roles.yaml'),
    policies: read('policies.yaml'),
    threshold: read('royal-authority.yaml'),
    quotas: read('quotas.yaml'),
  };
  mutate(docs);
  writeFileSync(join(dir, 'roles.yaml'), YAML.stringify(docs.roles));
  writeFileSync(join(dir, 'policies.yaml'), YAML.stringify(docs.policies));
  writeFileSync(join(dir, 'royal-authority.yaml'), YAML.stringify(docs.threshold));
  writeFileSync(join(dir, 'quotas.yaml'), YAML.stringify(docs.quotas));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('بيانات المشروع تعبر المخطَّط وفحص التماسك', () => {
  const bundle = loadPolicyBundle();
  assert.ok(bundle.actions.size >= 15, 'كتالوج الأفعال يجب أن يكون معلَناً لا فارغاً');
  assert.ok(bundle.policies.length >= 10, 'السياسات يجب أن تكون بيانات حقيقية لا مثالاً واحداً');
  assert.ok(bundle.roles.size >= 5);
  assert.ok(bundle.threshold.length >= 8);
  assert.ok(bundle.quotas.length >= 4);
  // كل سياسة تحمل معرّفاً ومالكاً ونسخة — نصّ معيار القبول في M4.02.
  for (const policy of bundle.policies) {
    assert.match(policy.id, /^pol:[a-z0-9-]+$/);
    assert.ok(policy.owner.trim() !== '', `سياسة بلا مالك: ${policy.id}`);
    assert.ok(Number.isInteger(policy.version) && policy.version >= 1);
    assert.ok(policy.reason.length >= 8, `سياسة بلا سبب مقروء: ${policy.id}`);
  }
});

test('البنية المحمَّلة مجمَّدة فلا تُعدَّل السياسة في زمن التشغيل', () => {
  const bundle = loadPolicyBundle();
  assert.throws(() => {
    // @ts-expect-error — التجميد مقصود، والمحاولة هي المقيس.
    bundle.policies.push({ id: 'pol:injected' });
  });
  const first = bundle.policies[0];
  assert.ok(first);
  assert.throws(() => {
    // التصريح يتجاوز `readonly` عن قصد: المقيس هو ما يفعله زمن التشغيل عند
    // محاولة التعديل، لا ما يمنعه المُصرِّف.
    /** @type {{ effect: string }} */ (/** @type {unknown} */ (first)).effect = 'allow';
  });
});

test('مخالفة المخطَّط تُفشل التحميل بخطأ يسمّي الملف', () => {
  const { dir, cleanup } = withMutatedConfig((docs) => {
    docs.policies.policies[0].effect = 'maybe';
  });
  try {
    assert.throws(() => loadPolicyBundle({ dir }), /POLICY_CONFIG_INVALID: policies\.yaml/);
  } finally {
    cleanup();
  }
});

test('سياسة تشير إلى فعل غير معلَن تُفشل التحميل', () => {
  const { dir, cleanup } = withMutatedConfig((docs) => {
    docs.policies.policies[0].actions = ['fabricate-authority'];
  });
  try {
    assert.throws(() => loadPolicyBundle({ dir }), /POLICY_CONFIG_INCOHERENT.*فعل غير معلَن/s);
  } finally {
    cleanup();
  }
});

test('سياسة تشير إلى دور غير معلَن تُفشل التحميل', () => {
  const { dir, cleanup } = withMutatedConfig((docs) => {
    docs.policies.policies[0].actors = { roles: ['role:ghost'] };
  });
  try {
    assert.throws(() => loadPolicyBundle({ dir }), /دور غير معلَن/);
  } finally {
    cleanup();
  }
});

test('سياسة نافذة بلا معتمِد تُفشل التحميل — نفس قيد القاعدة', () => {
  const { dir, cleanup } = withMutatedConfig((docs) => {
    delete docs.policies.policies[0].approvedBy;
  });
  try {
    assert.throws(() => loadPolicyBundle({ dir }), /سياسة نافذة بلا معتمِد/);
  } finally {
    cleanup();
  }
});

test('فعل يشير إلى حصّة غير معلَنة يُفشل التحميل', () => {
  const { dir, cleanup } = withMutatedConfig((docs) => {
    docs.quotas.quotas = docs.quotas.quotas.filter(
      (/** @type {{ resource: string }} */ q) => q.resource !== 'memory-writes',
    );
  });
  try {
    assert.throws(() => loadPolicyBundle({ dir }), /حصّة غير معلَنة/);
  } finally {
    cleanup();
  }
});

test('عتبة سيادية على فعل غير معلَن تُفشل التحميل', () => {
  const { dir, cleanup } = withMutatedConfig((docs) => {
    docs.threshold.threshold.push({ action: 'dissolve-state', reason: 'فعل مخترع للاختبار.' });
  });
  try {
    assert.throws(() => loadPolicyBundle({ dir }), /عتبة سيادية تشير إلى فعل غير معلَن/);
  } finally {
    cleanup();
  }
});

test('ملف مفقود يُفشل التحميل بخطأ مُسمّى لا بمجموعة فارغة', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-policy-empty-'));
  try {
    assert.throws(() => loadPolicyBundle({ dir }), /POLICY_CONFIG_MISSING: roles\.yaml/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
